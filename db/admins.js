const { knex } = require('./connection');
const { newId, date } = require('./util');

function fromRow(r) {
  if (!r) return null;
  return { _id: r.id, email: r.email, passwordHash: r.password_hash, createdAt: date(r.created_at) };
}

const normalise = (email) => String(email || '').trim().toLowerCase();

async function count() {
  const [row] = await knex()('admins').count({ count: '*' });
  return Number(row.count);
}

async function findByEmail(email) {
  return fromRow(await knex()('admins').where({ email: normalise(email) }).first());
}

async function create({ email, passwordHash }, trx) {
  const now = Date.now();
  const id = newId();
  await (trx || knex())('admins').insert({ id, email: normalise(email), password_hash: passwordHash, created_at: now, updated_at: now });
  return { _id: id, email: normalise(email) };
}

module.exports = { count, findByEmail, create, normalise };
