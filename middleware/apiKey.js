const db = require('../db');
const { parseKey, verifyKey } = require('../utils/keys');
const { HttpError } = require('../utils/errors');

module.exports = async function apiKeyAuth(req, res, next) {
  const auth = req.get('authorization') || '';
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.get('x-api-key') || '').trim();

  if (!raw) throw new HttpError(401, 'missing_api_key', 'Send your key in the header "Authorization: Bearer <key>"');

  const parsed = parseKey(raw);
  if (!parsed) throw new HttpError(401, 'invalid_api_key', 'The API key is malformed');

  const key = await db.keys.findByPrefix(parsed.prefix);
  const appDoc = key && !key.revokedAt && verifyKey(raw, key.hash) ? await db.apps.get(key.app) : null;
  if (!appDoc) throw new HttpError(401, 'invalid_api_key', 'The API key is invalid or has been revoked');
  if (!appDoc.active) throw new HttpError(403, 'app_disabled', 'This app is disabled');

  req.apiKey = key;
  req.appDoc = appDoc;

  // Write lastUsedAt at most once a minute per key
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    db.keys.touch(key._id).catch(() => {});
  }
  next();
};
