/**
 * The repositories, against in-memory SQLite by default. Point
 * TEST_DATABASE_URL at an empty Postgres or MySQL database to run the same
 * tests there; its tables are dropped and recreated.
 */
const test = require('node:test');
const assert = require('node:assert');

// Bucket secrets are encrypted with this; without it config would generate
// one and write data/secrets.json into the working tree
process.env.STORAGE_KEY = 'test-storage-key';

const db = require('../db');
const { parseDatabaseUrl } = require('../config/database');
const { generateKey, parseKey, verifyKey } = require('../utils/keys');

const target = parseDatabaseUrl(process.env.TEST_DATABASE_URL) || { client: 'sqlite', filename: ':memory:' };

test.before(async () => {
  await db.connect(target, __dirname);
  await db.knex().migrate.rollback(undefined, true);
  await db.migrate();
});

test.after(async () => {
  if (target.filename !== ':memory:') await db.knex().migrate.rollback(undefined, true);
  await db.close();
});

const sampleAsset = (appId, overrides = {}) => ({
  appId,
  folder: '',
  hash: Math.random().toString(16).slice(2).padEnd(64, '0'),
  kind: 'image',
  originalName: 'photo.jpg',
  input: { format: 'jpeg', width: 4032, height: 3024, bytes: 1000 },
  variants: [
    { name: 'large', key: 'a/large.webp', url: 'https://cdn.test/a/large.webp', width: 1600, height: 1200, bytes: 300, format: 'webp', fit: 'inside' },
    { name: 'thumb', key: 'a/thumb.webp', url: 'https://cdn.test/a/thumb.webp', width: 320, height: 320, bytes: 20, format: 'webp', fit: 'cover' },
  ],
  bytesOut: 320,
  ...overrides,
});

test('ids are 24 hex characters', async () => {
  const app = await db.apps.create({ name: 'Shape', slug: 'shape' });
  assert.match(app._id, /^[a-f0-9]{24}$/);
});

test('apps: defaults, settings and stats round trip with real types', async () => {
  const app = await db.apps.create({ name: 'Shop', slug: 'shop' });
  assert.strictEqual(app.active, true);
  assert.strictEqual(app.allowDocuments, true);
  assert.strictEqual(app.allowArchives, false);
  assert.strictEqual(app.bucket, null);
  assert.deepStrictEqual(app.variants.map((v) => v.name), ['thumb', 'medium', 'large']);
  assert.ok(app.createdAt instanceof Date);
  assert.strictEqual(await db.apps.slugTaken('shop'), true);

  const updated = await db.apps.update(app._id, { quality: 65, keepOriginal: true, variants: [{ name: 'only', width: 100, fit: 'inside' }], slug: 'moved' });
  assert.strictEqual(updated.quality, 65);
  assert.strictEqual(updated.keepOriginal, true);
  assert.deepStrictEqual(updated.variants, [{ name: 'only', width: 100, fit: 'inside' }]);
  assert.strictEqual(updated.slug, 'shop', 'the slug is immutable');

  await db.apps.addStats(app._id, { images: 2, bytesIn: 5_000_000_000, bytesOut: 10 });
  await db.apps.addStats(app._id, { images: -1, bytesIn: -1, bytesOut: -4 });
  const stats = (await db.apps.get(app._id)).stats;
  assert.deepStrictEqual(stats, { images: 1, bytesIn: 4_999_999_999, bytesOut: 6 });
});

test('keys: parse, lookup by prefix, revoke, counts', async () => {
  const app = await db.apps.create({ name: 'Keys', slug: 'keys' });
  const k = generateKey();
  assert.match(k.key, /^f360_[a-f0-9]{12}_[a-f0-9]{48}$/);
  assert.deepStrictEqual(parseKey(k.key), { prefix: k.prefix });
  assert.strictEqual(parseKey(`img_${'a'.repeat(12)}_${'b'.repeat(48)}`), null);
  assert.strictEqual(parseKey('f360_short_key'), null);

  const stored = await db.keys.create({ app: app._id, label: 'default', prefix: k.prefix, hash: k.hash, last4: k.last4 });
  const found = await db.keys.findByPrefix(k.prefix);
  assert.strictEqual(found._id, stored._id);
  assert.strictEqual(found.revokedAt, null);
  assert.ok(verifyKey(k.key, found.hash));

  const other = generateKey();
  await db.keys.create({ app: app._id, label: 'second', prefix: other.prefix, hash: other.hash, last4: other.last4 });
  assert.strictEqual(await db.keys.countActive(app._id), 2);

  await db.keys.revoke(app._id, stored._id);
  assert.strictEqual(await db.keys.countActive(app._id), 1);
  assert.strictEqual((await db.keys.activeCounts()).get(app._id), 1);
  const listed = await db.keys.listForApp(app._id);
  assert.deepStrictEqual(listed.map((x) => x.label), ['second', 'default'], 'active keys come first');
  assert.ok(listed[1].revokedAt instanceof Date);
});

test('buckets: secrets stay encrypted, one default at a time', async () => {
  const a = db.buckets.build({ name: 'A', provider: 'minio', bucket: 'a', accessKey: 'AKIAEXAMPLE', publicUrl: 'https://a.test' });
  db.buckets.setSecret(a, 'secret-a');
  a.isDefault = true;
  await db.buckets.insert(a);
  const b = db.buckets.build({ name: 'B', provider: 'minio', bucket: 'b', accessKey: 'AKIAEXAMPLE2', publicUrl: 'https://b.test' });
  db.buckets.setSecret(b, 'secret-b');
  await db.buckets.insert(b);

  const loaded = await db.buckets.get(a._id);
  assert.notStrictEqual(loaded.secretEnc, 'secret-a');
  assert.strictEqual(db.buckets.secretOf(loaded), 'secret-a');
  assert.strictEqual(loaded.status.ok, null, 'an untested bucket is unknown, not failing');
  assert.strictEqual('secretEnc' in db.buckets.card(loaded), false);

  await db.buckets.makeDefault(b._id);
  const list = await db.buckets.list();
  assert.deepStrictEqual(list.filter((x) => x.isDefault).map((x) => x.name), ['B']);
  assert.strictEqual(list[0].name, 'B', 'the default sorts first');
  assert.strictEqual((await db.buckets.defaultBucket()).name, 'B');

  loaded.status = { ok: false, publicOk: null, error: 'Wrong region', checkedAt: new Date() };
  await db.buckets.save(loaded);
  assert.strictEqual((await db.buckets.get(a._id)).status.ok, false);
  assert.deepStrictEqual((await db.buckets.publicUrls()).sort(), ['https://a.test', 'https://b.test']);
});

test('assets: the same file in the same folder is stored once', async () => {
  const app = await db.apps.create({ name: 'Dedupe', slug: 'dedupe' });
  const record = sampleAsset(app._id, { folder: 'products' });
  await db.assets.create(record);
  await assert.rejects(db.assets.create(record), (err) => db.isUniqueViolation(err));
  // Another folder is another file
  await db.assets.create({ ...record, folder: 'other' });
  assert.ok(await db.assets.findDuplicate(app._id, 'products', record.hash));
});

test('assets: nested shapes and the API response survive the round trip', async () => {
  const app = await db.apps.create({ name: 'Shapes', slug: 'shapes' });
  const doc = await db.assets.create(
    sampleAsset(app._id, {
      kind: 'document',
      variants: [],
      input: { format: 'xlsx', bytes: 2048 },
      file: { key: 'k/sheet.xlsx', url: 'https://cdn.test/k/sheet.xlsx', name: 'sheet.xlsx', mime: 'application/vnd.ms-excel', bytes: 2048 },
      preview: { kind: 'sheet', rows: [['a', 'b'], ['1', '2']], rowCount: 2, colCount: 2, sheets: ['One', 'Two'] },
    })
  );
  const api = db.assets.toApi(await db.assets.get(doc._id));
  assert.strictEqual(api.id, doc._id);
  assert.deepStrictEqual(api.preview, { kind: 'sheet', rows: 2, columns: 2, sheets: ['One', 'Two'] });
  assert.strictEqual(api.file.url, 'https://cdn.test/k/sheet.xlsx');

  const image = db.assets.toApi(await db.assets.create(sampleAsset(app._id)));
  assert.deepStrictEqual(Object.keys(image.variants), ['large', 'thumb']);
  assert.strictEqual(image.srcset, 'https://cdn.test/a/large.webp 1600w', 'cropped sizes stay out of srcset');
});

test('assets: library search covers subfolders, escapes wildcards, ignores case', async () => {
  const app = await db.apps.create({ name: 'Library', slug: 'library' });
  await db.assets.create(sampleAsset(app._id, { folder: 'a_b', originalName: 'Invoice-2026.pdf' }));
  await db.assets.create(sampleAsset(app._id, { folder: 'a_b/deep', originalName: 'cat.png', ref: 'ORDER-7' }));
  await db.assets.create(sampleAsset(app._id, { folder: 'axb', originalName: 'dog.png' }));
  await db.assets.create(sampleAsset(app._id, { folder: 'a_bc', originalName: '100%.png' }));

  const folder = await db.assets.search({ appId: app._id, folder: 'a_b' });
  assert.deepStrictEqual(folder.items.map((i) => i.folder).sort(), ['a_b', 'a_b/deep'], '"_" is not a wildcard and a_bc is a sibling');
  assert.strictEqual(folder.total, 2);
  assert.strictEqual(folder.items[0].app.slug, 'library');

  assert.deepStrictEqual((await db.assets.search({ appId: app._id, q: 'invoice' })).items.map((i) => i.originalName), ['Invoice-2026.pdf']);
  assert.deepStrictEqual((await db.assets.search({ appId: app._id, q: 'order-7' })).items.map((i) => i.originalName), ['cat.png']);
  assert.deepStrictEqual((await db.assets.search({ appId: app._id, q: '%' })).items.map((i) => i.originalName), ['100%.png']);

  const page = await db.assets.search({ appId: app._id, sort: 'oldest', page: 2, perPage: 3 });
  assert.strictEqual(page.items.length, 1);
  assert.strictEqual(page.total, 4);
});

test('assets: API listing filters by exact folder and ref', async () => {
  const app = await db.apps.create({ name: 'Api', slug: 'api' });
  await db.assets.create(sampleAsset(app._id, { folder: 'x', ref: 'r1' }));
  await db.assets.create(sampleAsset(app._id, { folder: 'x/y', ref: 'r1' }));
  await db.assets.create(sampleAsset(app._id, { folder: '', ref: 'r2' }));
  assert.strictEqual((await db.assets.listForApi({ appId: app._id, page: 1, limit: 50 })).total, 3);
  assert.strictEqual((await db.assets.listForApi({ appId: app._id, folder: 'x', page: 1, limit: 50 })).total, 1);
  assert.strictEqual((await db.assets.listForApi({ appId: app._id, folder: '', page: 1, limit: 50 })).total, 1);
  assert.strictEqual((await db.assets.listForApi({ appId: app._id, ref: 'r1', page: 1, limit: 50 })).total, 2);
});

test('assets: the group-bys that replaced the aggregations', async () => {
  const app = await db.apps.create({ name: 'Groups', slug: 'groups' });
  const bucketId = 'b'.repeat(24);
  await db.assets.create(sampleAsset(app._id, { folder: 'p', bucket: bucketId, bytesOut: 100 }));
  await db.assets.create(sampleAsset(app._id, { folder: 'p', bucket: bucketId, bytesOut: 50 }));
  await db.assets.create(sampleAsset(app._id, { folder: 'p/q', bytesOut: 1 }));

  const folders = (await db.assets.folderCounts()).filter((f) => f.appId === app._id);
  assert.deepStrictEqual(folders.map((f) => [f.folder, f.count]).sort(), [['p', 2], ['p/q', 1]]);
  assert.strictEqual((await db.assets.countsByBucket()).get(bucketId), 2);
  assert.strictEqual(await db.assets.count({ appId: app._id }), 3);

  const since = Date.now() - 60 * 60_000;
  const slots = await db.assets.uploadSlots(since);
  const total = slots.reduce((t, s) => ({ count: t.count + s.count, bytes: t.bytes + s.bytes }), { count: 0, bytes: 0 });
  assert.ok(total.count >= 3);
  assert.ok(slots.every((s) => s.at % (15 * 60_000) === 0), 'slots sit on quarter hours');
  assert.ok(slots.every((s) => typeof s.bytes === 'number'));
});

test('assets: delete reports whether a row went, so stats move once', async () => {
  const app = await db.apps.create({ name: 'Delete', slug: 'delete' });
  const asset = await db.assets.create(sampleAsset(app._id));
  assert.strictEqual(await db.assets.remove(asset._id), 1);
  assert.strictEqual(await db.assets.remove(asset._id), 0);
});

test('admins: emails are matched case-insensitively', async () => {
  await db.admins.create({ email: ' Owner@Example.com ', passwordHash: '$2a$12$abcdefghijklmnopqrstuv' });
  assert.strictEqual(await db.admins.count(), 1);
  assert.strictEqual((await db.admins.findByEmail('OWNER@example.COM')).email, 'owner@example.com');
});

test('probe names the step that failed', async () => {
  const result = await db.probe({ client: 'postgres', host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'x' }, __dirname);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.step, 'connect');
  assert.ok(result.error.length > 0);
  assert.deepStrictEqual(await db.probe({ client: 'sqlite', filename: ':memory:' }, __dirname), { ok: true, step: null, error: null });
});
