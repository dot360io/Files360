const path = require('node:path');

const KEY_RE = /^f360_[a-f0-9]{12}_[a-f0-9]{48}$/;
const DEFAULT_TIMEOUT_MS = 60_000;

class ConfigError extends Error {}

/**
 * Reads the server settings from the environment. Everything that can be wrong
 * is reported at once, so an operator fixing a client config edits it one time.
 */
function readConfig(env = process.env) {
  const problems = [];

  const rawUrl = (env.FILES360_API_URL || '').trim();
  let apiUrl = null;
  if (!rawUrl) {
    problems.push('FILES360_API_URL is not set. Use the base address of your Files360 instance, for example https://files.example.com');
  } else {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol');
      // people paste the address from the integration guide, which ends in /v1
      apiUrl = parsed.href.replace(/\/+$/, '').replace(/\/v1$/, '');
    } catch {
      problems.push(`FILES360_API_URL is not a valid http or https address: ${rawUrl}`);
    }
  }

  const apiKey = (env.FILES360_API_KEY || '').trim();
  if (!apiKey) {
    problems.push('FILES360_API_KEY is not set. Create a key in the app\'s Keys tab of your Files360 dashboard.');
  } else if (!KEY_RE.test(apiKey)) {
    problems.push('FILES360_API_KEY does not look like a Files360 key. It should read f360_ followed by 12 and then 48 hex characters.');
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (env.FILES360_TIMEOUT_MS) {
    timeoutMs = Number(env.FILES360_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      problems.push('FILES360_TIMEOUT_MS must be a whole number of milliseconds.');
    }
  }

  const uploadDir = env.FILES360_UPLOAD_DIR ? path.resolve(env.FILES360_UPLOAD_DIR) : null;

  if (problems.length) throw new ConfigError(problems.join('\n'));
  return { apiUrl, apiKey, timeoutMs, uploadDir };
}

module.exports = { readConfig, ConfigError, KEY_RE };
