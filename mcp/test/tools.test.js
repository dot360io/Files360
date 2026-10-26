const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../src/server');
const { Files360Client } = require('../src/client');
const { startMockApi, image, documentAsset } = require('./helpers/mockApi');

let api;
let tmp;

async function connect(clientOptions = {}) {
  const server = createServer({ config: { apiUrl: api.url, apiKey: api.key, timeoutMs: 5000, ...clientOptions } });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

before(async () => {
  api = await startMockApi();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'files360-mcp-'));
  // the bytes only need to be recognisable by the mock, not valid images
  fs.writeFileSync(path.join(tmp, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  fs.writeFileSync(path.join(tmp, 'terms.pdf'), '%PDF-1.7\n%fake\n');
  fs.writeFileSync(path.join(tmp, 'huge.jpg'), 'TOO-BIG');
});

after(async () => {
  await api.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('lists the six tools with the right hints', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), [
    'files360_delete_file',
    'files360_get_config',
    'files360_get_file',
    'files360_import_url',
    'files360_list_files',
    'files360_upload_file',
  ]);
  assert.equal(byName.files360_delete_file.annotations.destructiveHint, true);
  assert.equal(byName.files360_list_files.annotations.readOnlyHint, true);
  assert.equal(byName.files360_upload_file.annotations.readOnlyHint, false);
  assert.deepEqual(byName.files360_upload_file.inputSchema.required, ['path']);
});

test('get_config sends the key and summarises the app', async () => {
  const client = await connect();
  const result = await client.callTool({ name: 'files360_get_config', arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.app.name, 'Shop');
  assert.match(result.content[0].text, /App "Shop", folder shop/);
  assert.match(result.content[0].text, /thumb \(200x200, cover\)/);
  const req = api.requests.at(-1);
  assert.equal(req.headers.authorization, `Bearer ${api.key}`);
  assert.match(req.headers['user-agent'], /^files360-mcp\//);
});

test('upload_file sends multipart with folder and ref, then reports a duplicate', async () => {
  const client = await connect();
  const file = path.join(tmp, 'photo.jpg');
  const first = await client.callTool({ name: 'files360_upload_file', arguments: { path: file, folder: 'shop/products', ref: 'product-1042' } });
  assert.equal(first.isError, undefined);
  assert.equal(first.structuredContent.kind, 'image');
  assert.equal(first.structuredContent.duplicate, false);
  assert.match(first.content[0].text, /^Uploaded\./);
  assert.match(first.content[0].text, /large: 1600x1067 webp/);
  assert.match(first.content[0].text, /srcset: /);

  const sent = api.requests.at(-1);
  assert.equal(sent.method, 'POST');
  assert.equal(sent.path, '/v1/files');
  assert.match(sent.headers['content-type'], /^multipart\/form-data; boundary=/);
  const body = sent.body.toString('latin1');
  assert.match(body, /name="file"; filename="photo.jpg"/);
  assert.match(body, /name="folder"\r\n\r\nshop\/products/);
  assert.match(body, /name="ref"\r\n\r\nproduct-1042/);

  const again = await client.callTool({ name: 'files360_upload_file', arguments: { path: file, folder: 'shop/products' } });
  assert.equal(again.structuredContent.duplicate, true);
  assert.match(again.content[0].text, /^Already stored/);
});

test('upload_file handles documents', async () => {
  const client = await connect();
  const result = await client.callTool({ name: 'files360_upload_file', arguments: { path: path.join(tmp, 'terms.pdf') } });
  assert.equal(result.structuredContent.kind, 'document');
  assert.match(result.content[0].text, /Document .*terms\.pdf, application\/pdf/);
  assert.match(result.content[0].text, /URL: https:\/\/cdn\.example\.com\/.*terms\.pdf/);
  assert.match(result.content[0].text, /Preview: pages 4/);
  assert.doesNotMatch(api.requests.at(-1).body.toString('latin1'), /name="folder"/);
});

test('upload_file turns API errors into tool errors with the API message', async () => {
  const client = await connect();
  const result = await client.callTool({ name: 'files360_upload_file', arguments: { path: path.join(tmp, 'huge.jpg') } });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'Files360 error 413 file_too_large: File exceeds the 10 MB limit');
  assert.deepEqual(result.structuredContent.error, { status: 413, code: 'file_too_large', message: 'File exceeds the 10 MB limit' });
});

test('upload_file reports a missing file without calling the API', async () => {
  const client = await connect();
  const count = api.requests.length;
  const result = await client.callTool({ name: 'files360_upload_file', arguments: { path: path.join(tmp, 'nope.png') } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No file at .*nope\.png/);
  assert.equal(api.requests.length, count);
});

test('upload_file refuses paths outside FILES360_UPLOAD_DIR, symlinks included', async () => {
  const allowed = path.join(tmp, 'allowed');
  fs.mkdirSync(allowed, { recursive: true });
  fs.copyFileSync(path.join(tmp, 'photo.jpg'), path.join(allowed, 'ok.jpg'));
  fs.symlinkSync(path.join(tmp, 'terms.pdf'), path.join(allowed, 'sneaky.pdf'));

  const client = await connect({ uploadDir: allowed });
  const inside = await client.callTool({ name: 'files360_upload_file', arguments: { path: path.join(allowed, 'ok.jpg') } });
  assert.equal(inside.isError, undefined);

  for (const p of [path.join(tmp, 'photo.jpg'), path.join(allowed, 'sneaky.pdf'), path.join(allowed, '..', 'terms.pdf')]) {
    const outside = await client.callTool({ name: 'files360_upload_file', arguments: { path: p } });
    assert.equal(outside.isError, true, p);
    assert.match(outside.content[0].text, /outside/);
  }
});

test('import_url posts JSON and surfaces blocked URLs', async () => {
  const client = await connect();
  const result = await client.callTool({ name: 'files360_import_url', arguments: { url: 'https://example.com/a.jpg', folder: 'imports', ref: 'r1' } });
  assert.equal(result.isError, undefined);
  const sent = api.requests.at(-1);
  assert.equal(sent.path, '/v1/files/from-url');
  assert.equal(sent.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(sent.body), { url: 'https://example.com/a.jpg', folder: 'imports', ref: 'r1' });

  const blocked = await client.callTool({ name: 'files360_import_url', arguments: { url: 'http://internal.example/a.jpg' } });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /400 blocked_url/);
});

test('list_files passes filters as query parameters', async () => {
  const client = await connect();
  const result = await client.callTool({ name: 'files360_list_files', arguments: { page: 2, limit: 10, folder: 'shop/products', ref: 'product-1042' } });
  assert.deepEqual(api.requests.at(-1).query, { page: '2', limit: '10', folder: 'shop/products', ref: 'product-1042' });
  assert.equal(result.structuredContent.items.length, 2);
  assert.match(result.content[0].text, /Files 11-12 of 2 \(page 2, 10 per page\)/);
  assert.match(result.content[0].text, new RegExp(`${image().id} image shop/products ref=product-1042 photo\\.jpg .*large\\.webp`));
  assert.match(result.content[0].text, new RegExp(`${documentAsset().id} document shop/contracts terms\\.pdf`));
});

test('list_files rejects a limit above 200 before calling the API', async () => {
  const client = await connect();
  const count = api.requests.length;
  const result = await client.callTool({ name: 'files360_list_files', arguments: { limit: 500 } });
  assert.equal(result.isError, true);
  assert.equal(api.requests.length, count);
});

test('get_file returns one file and maps 404', async () => {
  const client = await connect();
  const found = await client.callTool({ name: 'files360_get_file', arguments: { id: documentAsset().id } });
  assert.equal(found.structuredContent.kind, 'document');

  const missing = await client.callTool({ name: 'files360_get_file', arguments: { id: 'ffffffffffffffffffffffff' } });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /404 not_found: File not found/);
});

test('delete_file handles 204 and escapes the id', async () => {
  const client = await connect();
  const result = await client.callTool({ name: 'files360_delete_file', arguments: { id: image().id } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { id: image().id, deleted: true });
  assert.equal(api.requests.at(-1).method, 'DELETE');

  await client.callTool({ name: 'files360_delete_file', arguments: { id: '../me' } });
  assert.equal(api.requests.at(-1).path, '/v1/files/..%2Fme');
});

test('a wrong key comes back as the API message', async () => {
  const client = await connect({ apiKey: 'f360_000000000000_' + '0'.repeat(48) });
  const result = await client.callTool({ name: 'files360_get_config', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /401 invalid_api_key/);
});

test('client: timeouts, non-JSON bodies and unreachable hosts read clearly', async () => {
  const slow = new Files360Client({ apiUrl: api.url, apiKey: api.key, timeoutMs: 200 });
  await assert.rejects(slow.request('GET', '/slow'), { code: 'timeout', message: /did not answer within/ });

  const html = new Files360Client({ apiUrl: api.url, apiKey: api.key });
  await assert.rejects(html.request('GET', '/html'), { status: 502, code: 'http_error' });

  const down = new Files360Client({ apiUrl: 'http://127.0.0.1:1', apiKey: api.key, timeoutMs: 2000 });
  await assert.rejects(down.getConfig(), { code: 'unreachable', message: /Could not reach Files360/ });
});
