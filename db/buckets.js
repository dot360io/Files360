const { knex } = require('./connection');
const { newId, bool, date, ms } = require('./util');
const providers = require('../utils/providers');
const secretBox = require('../utils/secretBox');

function fromRow(r) {
  if (!r) return null;
  return {
    _id: r.id,
    name: r.name,
    provider: r.provider,
    // Bucket or Space name at the provider
    bucket: r.bucket,
    region: r.region || '',
    // Cloudflare R2 account id, unused by the other providers
    account: r.account || '',
    // S3 API endpoint. Empty means the SDK default, which only AWS uses.
    endpoint: r.endpoint || '',
    // Base URL the stored objects are served from, CDN domain included
    publicUrl: r.public_url || '',
    accessKey: r.access_key,
    // AES-256-GCM, never rendered
    secretEnc: r.secret_enc,
    forcePathStyle: bool(r.force_path_style),
    // Providers without per-object ACLs (R2, B2) rely on bucket-level access
    supportsAcl: bool(r.supports_acl),
    isDefault: bool(r.is_default),
    active: bool(r.active),
    // Result of the last connection test
    status: {
      ok: bool(r.status_ok),
      publicOk: bool(r.status_public_ok),
      checkedAt: date(r.status_checked_at),
      error: r.status_error || null,
    },
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
}

function toRow(b) {
  const status = b.status || {};
  return {
    name: b.name,
    provider: b.provider,
    bucket: b.bucket,
    region: b.region || '',
    account: b.account || '',
    endpoint: b.endpoint || '',
    public_url: b.publicUrl || '',
    access_key: b.accessKey,
    secret_enc: b.secretEnc,
    force_path_style: Boolean(b.forcePathStyle),
    supports_acl: b.supportsAcl !== false,
    is_default: Boolean(b.isDefault),
    active: b.active !== false,
    status_ok: status.ok === undefined ? null : status.ok,
    status_public_ok: status.publicOk === undefined ? null : status.publicOk,
    status_checked_at: ms(status.checkedAt),
    status_error: status.error || null,
  };
}

/** An unsaved bucket with an ID already, so it can be verified before it is stored. */
function build(fields = {}) {
  return {
    _id: newId(),
    name: '',
    provider: '',
    bucket: '',
    region: '',
    account: '',
    endpoint: '',
    publicUrl: '',
    accessKey: '',
    secretEnc: '',
    forcePathStyle: false,
    supportsAcl: true,
    isDefault: false,
    active: true,
    status: { ok: null, publicOk: null, checkedAt: null, error: null },
    ...fields,
  };
}

async function insert(b) {
  const now = Date.now();
  await knex()('buckets').insert({ id: b._id, ...toRow(b), created_at: now, updated_at: now });
  return get(b._id);
}

async function save(b) {
  await knex()('buckets').where({ id: b._id }).update({ ...toRow(b), updated_at: Date.now() });
  return get(b._id);
}

async function get(id) {
  return fromRow(await knex()('buckets').where({ id }).first());
}

async function list() {
  return (await knex()('buckets').orderBy([{ column: 'is_default', order: 'desc' }, { column: 'name', order: 'asc' }])).map(fromRow);
}

async function count({ active } = {}) {
  const q = knex()('buckets');
  if (active !== undefined) q.where({ active });
  const [row] = await q.count({ count: '*' });
  return Number(row.count);
}

async function remove(id) {
  return knex()('buckets').where({ id }).del();
}

/** The bucket apps without their own use: the default, else any working one. */
async function defaultBucket() {
  const k = knex();
  const row =
    (await k('buckets').where({ is_default: true, active: true }).first()) ||
    (await k('buckets').where({ active: true }).orderBy('name').first());
  return fromRow(row);
}

async function firstActive() {
  return fromRow(await knex()('buckets').where({ active: true }).orderBy('name').first());
}

/** Exactly one default, switched in one transaction so there is never zero or two. */
async function makeDefault(id) {
  await knex().transaction(async (trx) => {
    await trx('buckets').whereNot({ id }).update({ is_default: false });
    await trx('buckets').where({ id }).update({ is_default: true, updated_at: Date.now() });
  });
}

async function publicUrls() {
  return (await knex()('buckets').select('public_url')).map((r) => r.public_url).filter(Boolean);
}

/* Helpers over a bucket record */

function secretOf(b) {
  return secretBox.decrypt(b.secretEnc);
}

function setSecret(b, plain) {
  b.secretEnc = secretBox.encrypt(plain);
}

function presetOf(b) {
  return providers.get(b.provider);
}

/** Identity of the connection, used to drop cached S3 clients after an edit. */
function signature(b) {
  return [b.endpoint, b.region, b.accessKey, b.forcePathStyle, b.secretEnc].join('|');
}

function label(b) {
  const preset = presetOf(b);
  return preset ? `${preset.label} ${preset.product}` : b.provider;
}

/** Safe view for templates: no secret, ever. */
function card(b) {
  return {
    _id: b._id,
    name: b.name,
    provider: b.provider,
    providerLabel: label(b),
    bucket: b.bucket,
    region: b.region,
    endpoint: b.endpoint,
    publicUrl: b.publicUrl,
    accessKeyMasked: secretBox.mask(b.accessKey),
    supportsAcl: b.supportsAcl,
    isDefault: b.isDefault,
    active: b.active,
    status: b.status,
  };
}

module.exports = {
  fromRow,
  build,
  insert,
  save,
  get,
  list,
  count,
  remove,
  defaultBucket,
  firstActive,
  makeDefault,
  publicUrls,
  secretOf,
  setSecret,
  presetOf,
  signature,
  label,
  card,
};
