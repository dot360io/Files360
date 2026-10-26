const test = require('node:test');
const assert = require('node:assert');

const { parseDatabaseUrl, describe, knexConfig } = require('../config/database');

test('DATABASE_URL: the three engines, and nothing else', () => {
  assert.strictEqual(parseDatabaseUrl(''), null);
  assert.deepStrictEqual(parseDatabaseUrl('sqlite:files360.sqlite'), { client: 'sqlite', filename: 'files360.sqlite' });
  assert.deepStrictEqual(parseDatabaseUrl('sqlite:///var/lib/files360/db.sqlite'), { client: 'sqlite', filename: '/var/lib/files360/db.sqlite' });
  assert.deepStrictEqual(parseDatabaseUrl('postgresql://u:p@db/files360'), { client: 'postgres', url: 'postgresql://u:p@db/files360' });
  assert.deepStrictEqual(parseDatabaseUrl('mysql://u:p@db:3306/files360'), { client: 'mysql', url: 'mysql://u:p@db:3306/files360' });
  assert.throws(() => parseDatabaseUrl('redis://localhost/files360'), /must start with/);
  assert.throws(() => parseDatabaseUrl('sqlite:'), /no file/);
});

test('describe never prints a password', () => {
  const text = describe({ client: 'postgres', url: 'postgres://user:hunter2@db.internal:5433/files360' }, '/data');
  assert.strictEqual(text, 'Postgres at db.internal:5433/files360');
  assert.ok(!describe({ client: 'mysql', host: 'db', user: 'u', password: 'hunter2', database: 'f' }, '/data').includes('hunter2'));
  assert.strictEqual(describe({ client: 'sqlite', filename: 'files360.sqlite' }, '/data'), 'SQLite at /data/files360.sqlite');
});

test('SQLite files resolve inside the data directory', () => {
  assert.strictEqual(knexConfig({ client: 'sqlite', filename: 'x.sqlite' }, '/data').connection.filename, '/data/x.sqlite');
  assert.throws(() => knexConfig({ client: 'oracle' }, '/data'), /Unknown database client/);
});
