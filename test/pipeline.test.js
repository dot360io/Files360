/**
 * The ingest pipeline end to end, with in-memory SQLite and the bucket replaced
 * by a recorder: detection, the per-app gates, dedupe, the stored layout, the
 * stats, and what happens when storage fails.
 */
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');

process.env.STORAGE_KEY = 'test-storage-key';

const db = require('../db');
const storage = require('../utils/storage');
const { ingest, removeImage } = require('../utils/assetPipeline');
const { xlsx, archive } = require('./helpers/zip-writer');

const bucket = { puts: [], deletes: [], failNext: false };
const target = { _id: 'c'.repeat(24), name: 'test bucket', publicUrl: 'https://cdn.test', supportsAcl: true, active: true };

test.before(async () => {
  await db.connect({ client: 'sqlite', filename: ':memory:' }, __dirname);
  await db.migrate();
  storage.forApp = async () => target;
  storage.forImage = async () => target;
  storage.putObject = async (b, object) => {
    if (bucket.failNext) {
      bucket.failNext = false;
      throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    }
    bucket.puts.push(object);
  };
  storage.deleteObjects = async (b, keys) => {
    bucket.deletes.push(...keys.filter(Boolean));
  };
});

test.after(() => db.close());

test.beforeEach(() => {
  bucket.puts = [];
  bucket.deletes = [];
});

const png = (width = 1200, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } }).png().toBuffer();

let slugs = 0;
const newApp = (settings = {}) => db.apps.create({ name: 'Test', slug: `test-${(slugs += 1)}`, ...settings });

async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (err) => {
    assert.strictEqual(err.code, code);
    assert.strictEqual(err.status, status);
    return true;
  });
}

test('an image becomes every configured size under <slug>/<folder>/<hash>/', async () => {
  const app = await newApp();
  const { image, duplicate } = await ingest({ app, buffer: await png(), originalName: 'Photo.PNG', folder: 'products', ref: 'p-1' });

  assert.strictEqual(duplicate, false);
  assert.strictEqual(image.kind, 'image');
  assert.deepStrictEqual(image.variants.map((v) => v.name), ['thumb', 'medium', 'large']);
  const thumb = image.variants.find((v) => v.name === 'thumb');
  assert.deepStrictEqual([thumb.width, thumb.height], [320, 320]);
  const large = image.variants.find((v) => v.name === 'large');
  assert.strictEqual(large.width, 1200, 'never upscaled');

  for (const put of bucket.puts) {
    assert.match(put.key, new RegExp(`^${app.slug}/products/[a-f0-9]{24}/(thumb|medium|large)\\.webp$`));
    assert.strictEqual(put.isPublic, true);
    assert.strictEqual(put.contentType, 'image/webp');
  }
  assert.strictEqual(large.url, `https://cdn.test/${large.key}`);

  const stats = (await db.apps.get(app._id)).stats;
  assert.strictEqual(stats.images, 1);
  assert.strictEqual(stats.bytesOut, image.bytesOut);
});

test('the same file in the same folder is stored once; another folder is another file', async () => {
  const app = await newApp();
  const buffer = await png(400, 300);
  const first = await ingest({ app, buffer, originalName: 'a.png', folder: 'x' });
  const again = await ingest({ app, buffer, originalName: 'renamed.png', folder: 'x' });
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(again.image._id, first.image._id);
  assert.strictEqual(bucket.puts.length, 3, 'the duplicate wrote nothing');

  const elsewhere = await ingest({ app, buffer, originalName: 'a.png', folder: 'y' });
  assert.strictEqual(elsewhere.duplicate, false);
  assert.strictEqual((await db.apps.get(app._id)).stats.images, 2);
});

test('changing the settings changes the folder, so old URLs never point at new pixels', async () => {
  const app = await newApp();
  const buffer = await png(500, 500);
  const before = await ingest({ app, buffer, folder: 'a' });
  const changed = await db.apps.update(app._id, { quality: 50 });
  const after = await ingest({ app: changed, buffer, folder: 'b' });
  const dir = (asset) => asset.variants[0].key.split('/').slice(-2, -1)[0];
  assert.notStrictEqual(dir(before.image), dir(after.image));
});

test('keepOriginal stores the upload privately next to the sizes', async () => {
  const app = await newApp({ keepOriginal: true });
  const { image } = await ingest({ app, buffer: await png(300, 200), originalName: 'x.png' });
  const original = bucket.puts.find((p) => p.key.endsWith('/original.png'));
  assert.ok(original);
  assert.strictEqual(original.isPublic, false);
  assert.strictEqual(image.original.key, original.key);
});

test('documents are stored byte for byte with a preview, and are gated per app', async () => {
  const app = await newApp();
  const csv = Buffer.from('name,qty\nbolts,40\nnuts,12\n');
  const { image } = await ingest({ app, buffer: csv, originalName: 'Stock List.csv', folder: 'docs' });
  assert.strictEqual(image.kind, 'document');
  assert.strictEqual(bucket.puts.length, 1);
  assert.ok(bucket.puts[0].body.equals(csv));
  assert.match(bucket.puts[0].key, /\/stock-list\.csv$/);
  assert.strictEqual(image.preview.kind, 'sheet');
  assert.strictEqual(db.assets.toApi(image).preview.rows, 3);

  const sheet = await ingest({ app, buffer: xlsx(), originalName: 'book.xlsx' });
  assert.strictEqual(sheet.image.input.format, 'xlsx');

  const imagesOnly = await newApp({ allowDocuments: false });
  await rejectsWith(ingest({ app: imagesOnly, buffer: csv, originalName: 'a.csv' }), 415, 'documents_disabled');
});

test('archives are off until an app turns them on', async () => {
  const zip = archive();
  await rejectsWith(ingest({ app: await newApp(), buffer: zip, originalName: 'bundle.zip' }), 415, 'archives_disabled');
  const { image } = await ingest({ app: await newApp({ allowArchives: true }), buffer: zip, originalName: 'bundle.zip' });
  assert.strictEqual(image.preview.kind, 'list');
  assert.strictEqual(image.preview.entryCount, 3, 'files only, the directory entry is not counted');
});

test('SVG is sanitized before it is stored or rasterized', async () => {
  const app = await newApp();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" onload="alert(1)"><script>alert(2)</script><circle cx="12" cy="12" r="10" fill="red"/></svg>');
  const { image } = await ingest({ app, buffer: svg, originalName: 'icon.svg' });
  const vector = bucket.puts.find((p) => p.contentType === 'image/svg+xml');
  assert.ok(vector);
  assert.ok(!/script|onload/i.test(vector.body.toString()));
  assert.ok(image.preview.removedElements.includes('script'));
  assert.strictEqual(image.variants.length, 3, 'raster sizes rendered from the clean vector');
  assert.ok(db.assets.toApi(image).file.url.endsWith('/icon.svg'));
});

test('refusals: disabled app, empty file, unreadable bytes', async () => {
  await rejectsWith(ingest({ app: await newApp({ active: false }), buffer: await png(10, 10) }), 403, 'app_disabled');
  await rejectsWith(ingest({ app: await newApp(), buffer: Buffer.alloc(0) }), 400, 'empty_file');
  await rejectsWith(ingest({ app: await newApp(), buffer: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]), originalName: 'x.bin' }), 415, 'unsupported_image');
});

test('a storage failure cleans up what was written and records nothing', async () => {
  const app = await newApp();
  bucket.failNext = true;
  await rejectsWith(ingest({ app, buffer: await png(200, 200) }), 502, 'storage_error');
  assert.strictEqual(bucket.deletes.length, 3, 'every size is removed again');
  assert.strictEqual(await db.assets.count({ appId: app._id }), 0);
  assert.strictEqual((await db.apps.get(app._id)).stats.images, 0);
});

test('delete removes every object and moves the stats exactly once', async () => {
  const app = await newApp({ keepOriginal: true });
  const { image } = await ingest({ app, buffer: await png(300, 300) });
  await removeImage(image);
  assert.strictEqual(bucket.deletes.length, 4, 'three sizes and the original');
  await removeImage(image);
  const stats = (await db.apps.get(app._id)).stats;
  assert.deepStrictEqual(stats, { images: 0, bytesIn: 0, bytesOut: 0 });
  assert.strictEqual(await db.assets.get(image._id), null);
});
