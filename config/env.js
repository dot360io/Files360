/**
 * Configuration, in priority order: environment variables, then
 * data/config.json written by the setup wizard, then defaults.
 *
 * Nothing here throws for a missing value. An install with no database chosen
 * boots into the setup wizard instead, which is decided in server.js once the
 * database (if any) has been asked whether an administrator exists.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { parseDatabaseUrl, DEFAULT_SQLITE } = require('./database');

function num(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`${file} could not be read (${err.message}). Fix or delete it, then start again.`);
  }
}

// Written with 0600 so a shared volume does not hand the secrets to other users
function writeJson(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(tmp, file);
}

const stripSlash = (s) => String(s || '').replace(/\/+$/, '');
const port = num('PORT', 4360);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const configFile = path.join(dataDir, 'config.json');
const secretsFile = path.join(dataDir, 'secrets.json');

const fileConfig = readJson(configFile);

// A plain ADMIN_PASSWORD is hashed at boot and never stored; a hash is used as is
const envAdmin =
  process.env.ADMIN_EMAIL && (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD)
    ? {
        email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
        passwordHash: process.env.ADMIN_PASSWORD_HASH || null,
        password: process.env.ADMIN_PASSWORD_HASH ? null : process.env.ADMIN_PASSWORD,
      }
    : null;

/**
 * Where the data lives. DATABASE_URL wins; then the wizard's choice; then, for
 * a deployment configured entirely from the environment (an admin is given),
 * SQLite on the data volume so it never has to see the wizard.
 */
function resolveDatabase() {
  const fromEnv = parseDatabaseUrl(process.env.DATABASE_URL);
  if (fromEnv) return { database: fromEnv, source: 'env' };
  if (fileConfig && fileConfig.database) return { database: fileConfig.database, source: 'file' };
  if (envAdmin) return { database: { ...DEFAULT_SQLITE }, source: 'default' };
  return { database: null, source: null };
}
const resolved = resolveDatabase();

/**
 * Generated once and kept in data/secrets.json, never asked of a human. They
 * are separate values so rotating the session secret does not lock the stored
 * bucket credentials away.
 */
let secrets = null;
function loadSecrets() {
  if (secrets) return secrets;
  const stored = readJson(secretsFile) || {};
  const next = {
    sessionSecret: stored.sessionSecret || crypto.randomBytes(32).toString('hex'),
    storageKey: stored.storageKey || crypto.randomBytes(32).toString('hex'),
  };
  if (next.sessionSecret !== stored.sessionSecret || next.storageKey !== stored.storageKey) {
    writeJson(secretsFile, { ...stored, ...next });
  }
  secrets = next;
  return secrets;
}

const config = {
  isProd: process.env.NODE_ENV === 'production',
  host: process.env.HOST || '127.0.0.1',
  port,
  appName: process.env.APP_NAME || 'Files360',
  publicUrl: stripSlash(process.env.PUBLIC_URL || `http://localhost:${port}`),
  timezone: process.env.TIMEZONE || 'UTC',
  dataDir,
  configFile,
  hasConfigFile: Boolean(fileConfig),
  database: resolved.database,
  // 'env' | 'file' | 'default' | null: the wizard skips its database step for 'env'
  databaseSource: resolved.source,
  // Only used to create the first administrator when the database has none
  envAdmin,
  // Set by server.js at boot
  setupNeeded: false,
  get sessionSecret() {
    return process.env.SESSION_SECRET || loadSecrets().sessionSecret;
  },
  // Encrypts bucket secrets at rest
  get storageKey() {
    return process.env.STORAGE_KEY || loadSecrets().storageKey;
  },
  // Buckets are configured in the dashboard and stored in the database.
  // No storage credentials are read from the environment.
  limits: {
    maxUploadMB: num('MAX_UPLOAD_MB', 25),
    maxInputPixels: num('MAX_INPUT_PIXELS', 60_000_000),
    maxConcurrentJobs: num('MAX_CONCURRENT_JOBS', 2),
    maxQueue: num('MAX_QUEUE', 50),
    sharpThreads: num('SHARP_THREADS', 2),
    apiRatePerMin: num('API_RATE_LIMIT_PER_MIN', 120),
  },
};

/** What the wizard saves. Env settings are never copied into the file. */
config.saveConfigFile = function saveConfigFile(values) {
  writeJson(configFile, { ...values, savedAt: new Date().toISOString() });
  config.hasConfigFile = true;
  if (values.database) {
    config.database = values.database;
    config.databaseSource = 'file';
  }
};

module.exports = config;
