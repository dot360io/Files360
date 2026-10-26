const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { readConfig, ConfigError } = require('../src/config');
const { startMockApi, KEY } = require('./helpers/mockApi');

const BIN = path.join(__dirname, '..', 'bin', 'files360-mcp.js');

test('readConfig accepts a valid environment and trims the base URL', () => {
  const config = readConfig({ FILES360_API_URL: 'https://files.example.com/v1/', FILES360_API_KEY: KEY });
  assert.equal(config.apiUrl, 'https://files.example.com');
  assert.equal(config.apiKey, KEY);
  assert.equal(config.timeoutMs, 60_000);
  assert.equal(config.uploadDir, null);
});

test('readConfig keeps a path prefix for instances behind a sub path', () => {
  const config = readConfig({ FILES360_API_URL: 'https://example.com/files360', FILES360_API_KEY: KEY });
  assert.equal(config.apiUrl, 'https://example.com/files360');
});

test('readConfig lists every problem at once', () => {
  assert.throws(() => readConfig({}), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /FILES360_API_URL is not set/);
    assert.match(err.message, /FILES360_API_KEY is not set/);
    return true;
  });
  assert.throws(() => readConfig({ FILES360_API_URL: 'ftp://x', FILES360_API_KEY: 'sk-123' }), /not a valid http or https address[\s\S]*does not look like a Files360 key/);
  assert.throws(() => readConfig({ FILES360_API_URL: 'https://x.example', FILES360_API_KEY: KEY, FILES360_TIMEOUT_MS: 'soon' }), /FILES360_TIMEOUT_MS/);
});

test('the binary exits with a readable message when unconfigured', () => {
  const env = { ...process.env };
  delete env.FILES360_API_URL;
  delete env.FILES360_API_KEY;
  const run = spawnSync(process.execPath, [BIN], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /files360-mcp cannot start:\nFILES360_API_URL is not set/);
});

test('the binary serves tools over stdio', async () => {
  const api = await startMockApi();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN],
    env: { PATH: process.env.PATH, FILES360_API_URL: api.url, FILES360_API_KEY: api.key },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'files360_get_config', arguments: {} });
    assert.equal(result.structuredContent.app.folder, 'shop');
  } finally {
    await client.close();
    await api.close();
  }
});
