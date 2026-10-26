/**
 * Holds the one Knex instance. Split from db/index.js so the repositories can
 * reach it without a require cycle.
 */
const fs = require('fs');
const path = require('path');
const knexFactory = require('knex');
const { knexConfig, describe } = require('../config/database');

let instance = null;
let current = null;

function knex() {
  if (!instance) throw new Error('The database is not connected yet');
  return instance;
}

/** Opens a connection, replacing any previous one, and proves it with a query. */
async function connect(database, dataDir) {
  const settings = knexConfig(database, dataDir);
  if (settings.client === 'better-sqlite3' && settings.connection.filename !== ':memory:') {
    fs.mkdirSync(path.dirname(settings.connection.filename), { recursive: true });
  }
  const next = knexFactory(settings);
  try {
    await next.raw('select 1');
  } catch (err) {
    await next.destroy().catch(() => {});
    throw err;
  }
  await close();
  instance = next;
  current = database;
  return instance;
}

/**
 * Tries a database without keeping it: connect, then create and drop a table,
 * so a user who can log in but not create tables fails here and not halfway
 * through the migrations. Never throws; names the step that failed.
 */
async function probe(database, dataDir) {
  let conn;
  try {
    const settings = knexConfig(database, dataDir);
    if (settings.client === 'better-sqlite3' && settings.connection.filename !== ':memory:') {
      fs.mkdirSync(path.dirname(settings.connection.filename), { recursive: true });
    }
    // Quiet: a refused connection is the expected answer here, and it is shown
    // to the operator on the page rather than as a stack trace in the log
    const quiet = () => {};
    conn = knexFactory({ ...settings, pool: { min: 0, max: 1 }, acquireConnectionTimeout: 8000, log: { warn: quiet, error: quiet, debug: quiet, deprecate: quiet } });
  } catch (err) {
    return { ok: false, step: 'settings', error: err.message };
  }
  try {
    try {
      await conn.raw('select 1');
    } catch (err) {
      return { ok: false, step: 'connect', error: explain(err) };
    }
    const table = `files360_probe_${process.pid}`;
    try {
      await conn.schema.dropTableIfExists(table);
      await conn.schema.createTable(table, (t) => t.string('id', 24));
      await conn.schema.dropTable(table);
    } catch (err) {
      return { ok: false, step: 'create', error: `Connected, but this user cannot create tables: ${explain(err)}` };
    }
    return { ok: true, step: null, error: null };
  } finally {
    await conn.destroy().catch(() => {});
  }
}

function explain(err) {
  const code = err && err.code;
  const map = {
    ECONNREFUSED: 'Nothing is listening at that host and port.',
    ENOTFOUND: 'The host name does not resolve.',
    EAI_AGAIN: 'The host name does not resolve.',
    ETIMEDOUT: 'The server did not answer in time. Check the host, the port and the firewall.',
    28000: 'The server refused that user name or password.',
    '28P01': 'The server refused that user name or password.',
    '3D000': 'No database with that name exists on the server. Create it first.',
    ER_ACCESS_DENIED_ERROR: 'The server refused that user name or password.',
    ER_BAD_DB_ERROR: 'No database with that name exists on the server. Create it first.',
    SQLITE_CANTOPEN: 'The SQLite file could not be opened. Check that the data directory is writable.',
  };
  if (map[code]) return map[code];
  if (err && /Knex: Timeout acquiring a connection/.test(err.message)) return 'The server did not answer in time. Check the host, the port and the firewall.';
  return (err && err.message) || 'Unknown error';
}

async function migrate() {
  await knex().migrate.latest();
}

async function close() {
  if (!instance) return;
  const old = instance;
  instance = null;
  current = null;
  await old.destroy().catch(() => {});
}

async function ping() {
  if (!instance) return false;
  try {
    await instance.raw('select 1');
    return true;
  } catch {
    return false;
  }
}

/** Unique index violations, as each driver reports them. */
function isUniqueViolation(err) {
  if (!err) return false;
  return (
    err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    err.code === '23505' ||
    err.code === 'ER_DUP_ENTRY' ||
    err.errno === 1062
  );
}

module.exports = {
  knex,
  connect,
  probe,
  explain,
  migrate,
  close,
  ping,
  isUniqueViolation,
  describe: (dataDir) => describe(current, dataDir),
  get connected() {
    return Boolean(instance);
  },
};
