/**
 * Database settings: parsing, the Knex configuration for each engine, and a
 * one-line description for logs and the setup wizard.
 *
 * A database setting is a plain object so it can live in data/config.json:
 *   { client: 'sqlite', filename: 'files360.sqlite' }
 *   { client: 'postgres' | 'mysql', host, port, user, password, database, ssl }
 *   { client: 'postgres' | 'mysql', url }
 */
const path = require('path');

const CLIENTS = ['sqlite', 'postgres', 'mysql'];
const DEFAULT_PORTS = { postgres: 5432, mysql: 3306 };
const DEFAULT_SQLITE = { client: 'sqlite', filename: 'files360.sqlite' };

/** DATABASE_URL: sqlite:files360.sqlite, sqlite:///abs/path.db, postgres://..., mysql://... */
function parseDatabaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^sqlite:/i.test(raw)) {
    const filename = raw.replace(/^sqlite:(\/\/)?/i, '');
    if (!filename) throw new Error('DATABASE_URL names SQLite but no file. Use sqlite:files360.sqlite or sqlite:///absolute/path.db');
    return { client: 'sqlite', filename };
  }
  if (/^postgres(ql)?:\/\//i.test(raw)) return { client: 'postgres', url: raw };
  if (/^mysql:\/\//i.test(raw)) return { client: 'mysql', url: raw };
  throw new Error('DATABASE_URL must start with sqlite:, postgres:// or mysql://');
}

function sqlitePath(database, dataDir) {
  if (database.filename === ':memory:') return ':memory:';
  return path.resolve(dataDir, database.filename || DEFAULT_SQLITE.filename);
}

// pg returns BIGINT and NUMERIC as strings to protect precision. Every such
// column here is a byte count or epoch milliseconds, far below 2^53.
let pgTypesSet = false;
function numericPg() {
  if (pgTypesSet) return;
  const { types } = require('pg');
  types.setTypeParser(20, (v) => Number(v));
  types.setTypeParser(1700, (v) => Number(v));
  pgTypesSet = true;
}

function knexConfig(database, dataDir) {
  const migrations = { directory: path.join(__dirname, '..', 'db', 'migrations'), tableName: 'knex_migrations', loadExtensions: ['.js'] };

  if (database.client === 'sqlite') {
    return {
      client: 'better-sqlite3',
      connection: { filename: sqlitePath(database, dataDir) },
      useNullAsDefault: true,
      migrations,
      pool: {
        afterCreate(conn, done) {
          // WAL lets the dashboard read while an upload writes its record and stats
          conn.pragma('journal_mode = WAL');
          conn.pragma('busy_timeout = 5000');
          done();
        },
      },
    };
  }

  if (database.client === 'postgres') {
    numericPg();
    const connection = database.url
      ? { connectionString: database.url }
      : { host: database.host, port: database.port || DEFAULT_PORTS.postgres, user: database.user, password: database.password, database: database.database };
    if (database.ssl) connection.ssl = { rejectUnauthorized: false };
    return { client: 'pg', connection, pool: { min: 0, max: 10 }, migrations };
  }

  if (database.client === 'mysql') {
    const base = database.url
      ? { uri: database.url }
      : { host: database.host, port: database.port || DEFAULT_PORTS.mysql, user: database.user, password: database.password, database: database.database };
    return {
      client: 'mysql2',
      connection: {
        ...base,
        charset: 'utf8mb4',
        // SUM() comes back as DECIMAL and BIGINT may exceed 32 bits: both as numbers
        supportBigNumbers: true,
        decimalNumbers: true,
        ...(database.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      },
      pool: { min: 0, max: 10 },
      migrations,
    };
  }

  throw new Error(`Unknown database client "${database.client}". Use sqlite, postgres or mysql.`);
}

/** "SQLite at /data/files360.sqlite", "Postgres at db:5432/files360". Never includes a password. */
function describe(database, dataDir) {
  if (!database) return 'no database';
  if (database.client === 'sqlite') return `SQLite at ${sqlitePath(database, dataDir)}`;
  const name = database.client === 'postgres' ? 'Postgres' : 'MySQL';
  if (database.url) {
    try {
      const u = new URL(database.url);
      return `${name} at ${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
    } catch {
      return name;
    }
  }
  return `${name} at ${database.host}:${database.port || DEFAULT_PORTS[database.client]}/${database.database}`;
}

module.exports = { CLIENTS, DEFAULT_PORTS, DEFAULT_SQLITE, parseDatabaseUrl, knexConfig, describe, sqlitePath };
