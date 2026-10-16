const ApiKey = require('../models/ApiKey');
const { parseKey, verifyKey } = require('../utils/keys');
const { HttpError } = require('../utils/errors');

module.exports = async function apiKeyAuth(req, res, next) {
  const auth = req.get('authorization') || '';
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.get('x-api-key') || '').trim();

  if (!raw) throw new HttpError(401, 'missing_api_key', 'Send your key in the header "Authorization: Bearer <key>"');

  const parsed = parseKey(raw);
  if (!parsed) throw new HttpError(401, 'invalid_api_key', 'The API key is malformed');

  const key = await ApiKey.findOne({ prefix: parsed.prefix }).populate('app');
  if (!key || key.revokedAt || !key.app || !verifyKey(raw, key.hash)) {
    throw new HttpError(401, 'invalid_api_key', 'The API key is invalid or has been revoked');
  }
  if (!key.app.active) throw new HttpError(403, 'app_disabled', 'This app is disabled');

  req.apiKey = key;
  req.appDoc = key.app;

  // Write lastUsedAt at most once a minute per key
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    ApiKey.updateOne({ _id: key._id }, { lastUsedAt: new Date() }).catch(() => {});
  }
  next();
};
