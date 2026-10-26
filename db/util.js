const crypto = require('crypto');

// 96 random bits: unguessable in a URL, and short enough to read in a log
const newId = () => crypto.randomBytes(12).toString('hex');

// SQLite and MySQL hand booleans back as 0/1; a null stays "unknown"
const bool = (v) => (v === null || v === undefined ? null : Boolean(v));
const num = (v) => (v === null || v === undefined ? null : Number(v));
const date = (v) => (v === null || v === undefined ? null : new Date(Number(v)));
const ms = (v) => (v === null || v === undefined ? null : v instanceof Date ? v.getTime() : Number(v));

// pg and mysql2 parse JSON columns themselves, SQLite returns the text
function json(v) {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}
const toJson = (v) => (v === null || v === undefined ? null : JSON.stringify(v));

// LIKE treats "_" and "%" as wildcards, and folder names contain "_".
// "!" is the escape because a backslash means different things per engine.
const likeEscape = (s) => String(s).replace(/[!%_]/g, (c) => `!${c}`);

/** COUNT and SUM come back under different types per driver. */
const count = (rows, field = 'count') => Number((rows[0] && rows[0][field]) || 0);

module.exports = { newId, bool, num, date, ms, json, toJson, likeEscape, count };
