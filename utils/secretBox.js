/**
 * Encrypts storage secrets before they are written to the database.
 *
 * The key comes from STORAGE_KEY, or the one generated into data/secrets.json
 * on first start. Changing that value makes stored secrets unreadable, and the
 * buckets have to be reconnected.
 */
const crypto = require('crypto');
const config = require('../config/env');

const VERSION = 'v1';
// Fixed salt: the secret it protects is already high-entropy, and a stored
// random salt would need a second round trip on every decrypt.
// Never change it: this salt derives the key that encrypts stored bucket
// secrets, so touching it makes every secret already in a database unreadable.
const SALT = Buffer.from('files360.storage.v1');

let cachedKey = null;
function key() {
  if (!cachedKey) cachedKey = crypto.scryptSync(config.storageKey, SALT, 32);
  return cachedKey;
}

function encrypt(plain) {
  const text = String(plain == null ? '' : plain);
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

function decrypt(packed) {
  if (!packed) return '';
  const [version, iv, tag, body] = String(packed).split('.');
  if (version !== VERSION || !iv || !tag || !body) {
    throw new Error('Stored credential is not readable. Reconnect the bucket.');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key, or the document was tampered with
    throw new Error('Stored credential could not be decrypted. It was saved with a different STORAGE_KEY.');
  }
}

/** "DO00ABC...XYZ" -> "DO00…6XYZ", for showing which key is configured. */
function mask(value) {
  const text = String(value || '');
  if (text.length <= 8) return text ? '•'.repeat(text.length) : '';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

module.exports = { encrypt, decrypt, mask };
