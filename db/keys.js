const { knex } = require('./connection');
const { newId, date } = require('./util');

function fromRow(r) {
  if (!r) return null;
  return {
    _id: r.id,
    app: r.app_id,
    label: r.label,
    // Stored in clear for lookup; the key itself only as a SHA-256 hash
    prefix: r.prefix,
    hash: r.hash,
    last4: r.last4,
    lastUsedAt: date(r.last_used_at),
    revokedAt: date(r.revoked_at),
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
}

async function create({ app, label, prefix, hash, last4 }) {
  const now = Date.now();
  const id = newId();
  await knex()('api_keys').insert({ id, app_id: app, label, prefix, hash, last4, created_at: now, updated_at: now });
  return fromRow(await knex()('api_keys').where({ id }).first());
}

async function findByPrefix(prefix) {
  return fromRow(await knex()('api_keys').where({ prefix }).first());
}

async function touch(id) {
  await knex()('api_keys').where({ id }).update({ last_used_at: Date.now() });
}

/** Active keys first, then revoked ones by when they were revoked; newest first within each. */
async function listForApp(appId) {
  const rows = await knex()('api_keys')
    .where({ app_id: appId })
    .orderByRaw('CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END')
    .orderBy([{ column: 'revoked_at', order: 'asc' }, { column: 'created_at', order: 'desc' }]);
  return rows.map(fromRow);
}

async function countActive(appId) {
  const [row] = await knex()('api_keys').where({ app_id: appId }).whereNull('revoked_at').count({ count: '*' });
  return Number(row.count);
}

/** app id -> number of keys not revoked */
async function activeCounts() {
  const rows = await knex()('api_keys').whereNull('revoked_at').select('app_id').count({ count: '*' }).groupBy('app_id');
  return new Map(rows.map((r) => [r.app_id, Number(r.count)]));
}

async function revoke(appId, keyId) {
  const now = Date.now();
  return knex()('api_keys').where({ id: keyId, app_id: appId }).whereNull('revoked_at').update({ revoked_at: now, updated_at: now });
}

async function removeForApp(appId) {
  return knex()('api_keys').where({ app_id: appId }).del();
}

module.exports = { fromRow, create, findByPrefix, touch, listForApp, countActive, activeCounts, revoke, removeForApp };
