/**
 * One stored asset, image or document. Rows come back as nested records
 * (input, file, preview) because that is the shape the views and the API use.
 */
const { knex } = require('./connection');
const { newId, num, date, json, toJson, likeEscape } = require('./util');

const A = 'assets';

function fromRow(r) {
  if (!r) return null;
  const record = {
    _id: r.id,
    appId: r.app_id,
    // The bucket the files really live in, so moving an app never orphans them
    bucket: r.bucket_id || null,
    apiKey: r.api_key_id || null,
    // Images are resized into variants, documents are stored as they arrived
    kind: r.kind || 'image',
    folder: r.folder || '',
    // SHA-256 of the uploaded file, used to skip duplicates
    hash: r.hash,
    ref: r.ref || null,
    originalName: r.original_name || null,
    source: r.source,
    input: { format: r.input_format, width: num(r.input_width), height: num(r.input_height), bytes: num(r.input_bytes) },
    original: r.original_key ? { key: r.original_key, bytes: num(r.original_bytes) } : null,
    variants: json(r.variants) || [],
    // The stored file itself: the document, or the cleaned vector of an SVG
    file: json(r.file),
    // Read once at upload time so the library can show a document without
    // downloading it again. Kept small on purpose, see utils/documents.js.
    preview: json(r.preview),
    bytesOut: num(r.bytes_out) || 0,
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
  // Present only on queries that join the owner: null means the app is gone
  if ('app_name' in r) record.app = r.app_slug ? { _id: r.app_id, name: r.app_name, slug: r.app_slug } : null;
  return record;
}

function toRow(a) {
  const input = a.input || {};
  return {
    app_id: a.appId,
    bucket_id: a.bucket || null,
    api_key_id: a.apiKey || null,
    kind: a.kind || 'image',
    folder: a.folder || '',
    hash: a.hash,
    ref: a.ref || null,
    original_name: a.originalName || null,
    source: a.source || 'upload',
    input_format: input.format || null,
    input_width: input.width || null,
    input_height: input.height || null,
    input_bytes: input.bytes || null,
    original_key: (a.original && a.original.key) || null,
    original_bytes: (a.original && a.original.bytes) || null,
    variants: toJson(a.variants || []),
    file: toJson(a.file || null),
    preview: toJson(a.preview || null),
    bytes_out: a.bytesOut || 0,
  };
}

/** Selects every asset column plus the owning app's name and slug. */
function withApp() {
  return knex()(A).leftJoin('apps', 'apps.id', `${A}.app_id`).select(`${A}.*`, 'apps.name as app_name', 'apps.slug as app_slug');
}

/** Throws the driver's unique violation when the same file lands twice; callers check db.isUniqueViolation. */
async function create(record) {
  const now = Date.now();
  const id = newId();
  await knex()(A).insert({ id, ...toRow(record), created_at: now, updated_at: now });
  return get(id);
}

async function get(id) {
  return fromRow(await knex()(A).where({ id }).first());
}

async function getWithApp(id) {
  return fromRow(await withApp().where(`${A}.id`, id).first());
}

async function getForApp(id, appId) {
  return fromRow(await knex()(A).where({ id, app_id: appId }).first());
}

async function findDuplicate(appId, folder, hash) {
  return fromRow(await knex()(A).where({ app_id: appId, folder, hash }).first());
}

async function findMany(ids) {
  if (!ids.length) return [];
  return (await knex()(A).whereIn('id', ids)).map(fromRow);
}

async function remove(id) {
  return knex()(A).where({ id }).del();
}

const newestFirst = [{ column: `${A}.created_at`, order: 'desc' }, { column: `${A}.id`, order: 'desc' }];

/** API listing: exact folder and ref, newest first. */
async function listForApi({ appId, folder, ref, page, limit }) {
  const filter = (q) => {
    q.where(`${A}.app_id`, appId);
    if (folder !== undefined) q.where(`${A}.folder`, folder);
    if (ref !== undefined) q.where(`${A}.ref`, ref);
    return q;
  };
  const [rows, [{ count }]] = await Promise.all([
    filter(knex()(A)).orderBy(newestFirst).offset((page - 1) * limit).limit(limit),
    filter(knex()(A)).count({ count: '*' }),
  ]);
  return { items: rows.map(fromRow), total: Number(count) };
}

const LIBRARY_SORTS = {
  newest: newestFirst,
  oldest: [{ column: `${A}.created_at`, order: 'asc' }, { column: `${A}.id`, order: 'asc' }],
  largest: [{ column: `${A}.input_bytes`, order: 'desc' }, { column: `${A}.id`, order: 'desc' }],
  name: [{ column: `${A}.original_name`, order: 'asc' }, { column: `${A}.id`, order: 'asc' }],
};

/**
 * Library: one app or all, a folder and everything beneath it, and a case
 * insensitive search over file name and ref.
 */
async function search({ appId, folder, q, sort = 'newest', page = 1, perPage = 40 }) {
  const filter = (query) => {
    if (appId) query.where(`${A}.app_id`, appId);
    if (appId && folder) {
      query.where((w) => w.where(`${A}.folder`, folder).orWhereRaw(`${A}.folder LIKE ? ESCAPE '!'`, [`${likeEscape(folder)}/%`]));
    }
    if (q) {
      const pattern = `%${likeEscape(q.toLowerCase())}%`;
      query.where((w) =>
        w.whereRaw(`LOWER(${A}.original_name) LIKE ? ESCAPE '!'`, [pattern]).orWhereRaw(`LOWER(${A}.ref) LIKE ? ESCAPE '!'`, [pattern])
      );
    }
    return query;
  };
  const [rows, [{ count }]] = await Promise.all([
    filter(withApp())
      .orderBy(LIBRARY_SORTS[sort] || LIBRARY_SORTS.newest)
      .offset((page - 1) * perPage)
      .limit(perPage),
    filter(knex()(A)).count({ count: '*' }),
  ]);
  return { items: rows.map(fromRow), total: Number(count) };
}

/** Newest assets, optionally for one app, with the owner joined for display. */
async function recent({ appId, limit }) {
  const q = withApp().orderBy(newestFirst).limit(limit);
  if (appId) q.where(`${A}.app_id`, appId);
  return (await q).map(fromRow);
}

async function count({ appId, bucketId } = {}) {
  const q = knex()(A);
  if (appId) q.where({ app_id: appId });
  if (bucketId) q.where({ bucket_id: bucketId });
  const [row] = await q.count({ count: '*' });
  return Number(row.count);
}

/** bucket id -> number of assets stored in it */
async function countsByBucket() {
  const rows = await knex()(A).select('bucket_id').count({ count: '*' }).groupBy('bucket_id');
  return new Map(rows.map((r) => [r.bucket_id, Number(r.count)]));
}

/** [{ appId, folder, count }] for the library's folder tree */
async function folderCounts() {
  const rows = await knex()(A).select('app_id', 'folder').count({ count: '*' }).groupBy('app_id', 'folder');
  return rows.map((r) => ({ appId: r.app_id, folder: r.folder || '', count: Number(r.count) }));
}

const SLOT_MS = 15 * 60_000;

/**
 * Uploads since a moment, in 15-minute slots of UTC epoch time. Engines
 * disagree on time zone functions, so the caller folds the slots into local
 * days; a quarter hour lines up with every real UTC offset, :30 and :45 too.
 */
async function uploadSlots(sinceMs) {
  const slot = `created_at - (created_at % ${SLOT_MS})`;
  const rows = await knex()(A)
    .where('created_at', '>=', sinceMs)
    .select(knex().raw(`${slot} as slot`))
    .count({ count: '*' })
    .sum({ bytes: 'bytes_out' })
    .groupByRaw(slot);
  return rows.map((r) => ({ at: Number(r.slot), count: Number(r.count), bytes: Number(r.bytes) || 0 }));
}

// The full preview can hold dozens of rows, so API responses get the shape only
function previewSummary(preview) {
  if (!preview || !preview.kind || preview.kind === 'none') return null;
  const summary = { kind: preview.kind };
  if (preview.pages != null) summary.pages = preview.pages;
  if (preview.rowCount != null) summary.rows = preview.rowCount;
  if (preview.colCount != null) summary.columns = preview.colCount;
  if (preview.sheets && preview.sheets.length) summary.sheets = [...preview.sheets];
  if (preview.words != null) summary.words = preview.words;
  if (preview.lineCount != null) summary.lines = preview.lineCount;
  if (preview.slideCount != null) summary.slides = preview.slideCount;
  if (preview.entryCount != null) summary.entries = preview.entryCount;
  if (preview.totalBytes != null) summary.unpackedBytes = preview.totalBytes;
  if (preview.macros) summary.macros = true;
  return summary;
}

// An SVG is published as a vector as well as its raster sizes
function vectorSummary(asset) {
  if (!asset.file || !asset.file.url) return null;
  const removed = [...(asset.preview ? asset.preview.removedElements || [] : [])];
  return {
    url: asset.file.url,
    name: asset.file.name,
    mime: asset.file.mime,
    bytes: asset.file.bytes,
    ...(removed.length ? { sanitizedAway: removed } : {}),
  };
}

/** The public API shape. Integrations parse it, so fields are only ever added. */
function toApi(asset) {
  const base = {
    id: asset._id,
    kind: asset.kind || 'image',
    folder: asset.folder,
    ref: asset.ref || null,
    hash: asset.hash,
  };

  if (asset.kind === 'document') {
    return {
      ...base,
      input: {
        name: asset.originalName || null,
        format: asset.input.format,
        bytes: asset.input.bytes,
      },
      file: {
        url: asset.file.url,
        name: asset.file.name,
        mime: asset.file.mime,
        bytes: asset.file.bytes,
      },
      preview: previewSummary(asset.preview),
      bytesOut: asset.bytesOut,
      createdAt: asset.createdAt,
    };
  }

  const variants = {};
  for (const v of asset.variants) {
    variants[v.name] = { url: v.url, width: v.width, height: v.height, bytes: v.bytes, format: v.format };
  }

  // Cropped sizes have a different aspect ratio, so they stay out of srcset
  const srcset = asset.variants
    .filter((v) => v.fit !== 'cover' && v.fit !== 'fill')
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');

  const vector = vectorSummary(asset);
  return {
    ...base,
    input: {
      name: asset.originalName || null,
      format: asset.input.format,
      width: asset.input.width,
      height: asset.input.height,
      bytes: asset.input.bytes,
    },
    variants,
    srcset,
    ...(vector ? { file: vector } : {}),
    bytesOut: asset.bytesOut,
    createdAt: asset.createdAt,
  };
}

module.exports = {
  fromRow,
  create,
  get,
  getWithApp,
  getForApp,
  findDuplicate,
  findMany,
  remove,
  listForApi,
  search,
  recent,
  count,
  countsByBucket,
  folderCounts,
  uploadSlots,
  toApi,
};
