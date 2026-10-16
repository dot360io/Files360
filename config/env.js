const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function num(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const stripSlash = (s) => String(s || '').replace(/\/+$/, '');
const port = num('PORT', 4360);
const sessionSecret = required('SESSION_SECRET');

module.exports = {
  isProd: process.env.NODE_ENV === 'production',
  host: process.env.HOST || '127.0.0.1',
  port,
  appName: process.env.APP_NAME || 'Files360',
  publicUrl: stripSlash(process.env.PUBLIC_URL || `http://localhost:${port}`),
  timezone: process.env.TIMEZONE || 'UTC',
  mongoUri: required('MONGO_URI'),
  sessionSecret,
  // Encrypts bucket secrets at rest. Falls back to the session secret so no new
  // env var is needed; set it explicitly to rotate sessions without losing buckets.
  storageKey: process.env.STORAGE_KEY || sessionSecret,
  admin: {
    email: required('ADMIN_EMAIL').trim().toLowerCase(),
    passwordHash: required('ADMIN_PASSWORD_HASH'),
  },
  // Buckets are configured in the dashboard and stored in MongoDB.
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
