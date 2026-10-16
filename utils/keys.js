const crypto = require('crypto');

// Key format: img_<12 hex prefix>_<48 hex secret>
// The prefix is stored in clear for lookup, the full key only as a SHA-256 hash.
const KEY_RE = /^img_([a-f0-9]{12})_([a-f0-9]{48})$/;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function generateKey() {
  const prefix = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(24).toString('hex');
  const key = `img_${prefix}_${secret}`;
  return { key, prefix, hash: sha256(key), last4: secret.slice(-4) };
}

function parseKey(raw) {
  const match = KEY_RE.exec(raw || '');
  return match ? { prefix: match[1] } : null;
}

function verifyKey(raw, storedHash) {
  const a = Buffer.from(sha256(raw), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { generateKey, parseKey, verifyKey, sha256 };
