const { knex } = require('./connection');
const { newId, bool, num, date, json, toJson } = require('./util');

const DEFAULT_VARIANTS = [
  { name: 'thumb', width: 320, height: 320, fit: 'cover' },
  { name: 'medium', width: 800, fit: 'inside' },
  { name: 'large', width: 1600, fit: 'inside' },
];

function fromRow(r) {
  if (!r) return null;
  return {
    _id: r.id,
    name: r.name,
    // Folder name in the bucket. Never changes after creation.
    slug: r.slug,
    active: bool(r.active),
    // Where this app's files are stored. Null means the default bucket.
    bucket: r.bucket_id || null,
    format: r.format,
    quality: num(r.quality),
    keepOriginal: bool(r.keep_original),
    // PDF, Office files, CSV and text. Stored as they arrive, not optimized.
    allowDocuments: bool(r.allow_documents),
    // ZIP archives. Off by default: a public bucket would serve whatever is inside.
    allowArchives: bool(r.allow_archives),
    maxUploadMB: num(r.max_upload_mb),
    variants: json(r.variants) || [],
    stats: { images: num(r.stats_images) || 0, bytesIn: num(r.stats_bytes_in) || 0, bytesOut: num(r.stats_bytes_out) || 0 },
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
}

// The settings a save may touch. The slug is deliberately not one of them.
const COLUMNS = {
  name: 'name',
  active: 'active',
  bucket: 'bucket_id',
  format: 'format',
  quality: 'quality',
  keepOriginal: 'keep_original',
  allowDocuments: 'allow_documents',
  allowArchives: 'allow_archives',
  maxUploadMB: 'max_upload_mb',
  variants: 'variants',
};

function toRow(patch) {
  const row = {};
  for (const [field, column] of Object.entries(COLUMNS)) {
    if (patch[field] === undefined) continue;
    row[column] = field === 'variants' ? toJson(patch[field]) : field === 'bucket' ? patch[field] || null : patch[field];
  }
  return row;
}

const SORTS = {
  name: [{ column: 'name', order: 'asc' }],
  bytesOut: [{ column: 'stats_bytes_out', order: 'desc' }, { column: 'name', order: 'asc' }],
};

async function list({ sort = 'name' } = {}) {
  return (await knex()('apps').orderBy(SORTS[sort] || SORTS.name)).map(fromRow);
}

async function get(id) {
  return fromRow(await knex()('apps').where({ id }).first());
}

async function slugTaken(slug) {
  return Boolean(await knex()('apps').where({ slug }).first('id'));
}

async function create({ name, slug, ...rest }) {
  const now = Date.now();
  const id = newId();
  await knex()('apps').insert({
    id,
    name,
    slug,
    format: 'webp',
    quality: 80,
    max_upload_mb: 15,
    ...toRow({ variants: DEFAULT_VARIANTS.map((v) => ({ ...v })), ...rest }),
    created_at: now,
    updated_at: now,
  });
  return get(id);
}

async function update(id, patch) {
  await knex()('apps').where({ id }).update({ ...toRow(patch), updated_at: Date.now() });
  return get(id);
}

async function remove(id) {
  return knex()('apps').where({ id }).del();
}

/** Stats move by a delta in SQL, so two uploads at once never lose a count. */
async function addStats(id, { images = 0, bytesIn = 0, bytesOut = 0 }) {
  const k = knex();
  await k('apps')
    .where({ id })
    .update({
      stats_images: k.raw('stats_images + ?', [images]),
      stats_bytes_in: k.raw('stats_bytes_in + ?', [bytesIn]),
      stats_bytes_out: k.raw('stats_bytes_out + ?', [bytesOut]),
    });
}

/** bucket id -> number of apps pointed at it */
async function countsByBucket() {
  const rows = await knex()('apps').whereNotNull('bucket_id').select('bucket_id').count({ count: '*' }).groupBy('bucket_id');
  return new Map(rows.map((r) => [r.bucket_id, Number(r.count)]));
}

async function countUsingBucket(bucketId) {
  const [row] = await knex()('apps').where({ bucket_id: bucketId }).count({ count: '*' });
  return Number(row.count);
}

async function countWithoutBucket() {
  const [row] = await knex()('apps').whereNull('bucket_id').count({ count: '*' });
  return Number(row.count);
}

module.exports = {
  DEFAULT_VARIANTS,
  fromRow,
  list,
  get,
  slugTaken,
  create,
  update,
  remove,
  addStats,
  countsByBucket,
  countUsingBucket,
  countWithoutBucket,
};
