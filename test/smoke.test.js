/**
 * Boots the real server against a fresh SQLite data directory and walks it the
 * way a new operator would: setup token, wizard, sign in, app, API key, API.
 * Everything stays on 127.0.0.1.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const port = 41000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files360-smoke-'));
let server;
let log = '';

function waitFor(pattern, ms = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not print ${pattern} in time:\n${log}`)), ms);
    const check = () => {
      const match = pattern.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      } else setTimeout(check, 50);
    };
    check();
  });
}

/** A tiny browser: keeps cookies, never follows redirects. */
function browser() {
  const jar = new Map();
  return async function request(pathname, { form, headers = {}, method } = {}) {
    const res = await fetch(base + pathname, {
      method: method || (form ? 'POST' : 'GET'),
      redirect: 'manual',
      headers: {
        ...headers,
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, ...value] = pair.split('=');
      jar.set(name, value.join('='));
    }
    const text = await res.text();
    const csrf = (/name="_csrf" value="([^"]+)"/.exec(text) || [])[1];
    return { status: res.status, location: res.headers.get('location'), text, csrf };
  };
}

test.before(async () => {
  // dotenv never overrides a variable that is already set, even to '', so this
  // keeps a developer's own .env out of the test
  const blank = ['DATABASE_URL', 'SESSION_SECRET', 'STORAGE_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'PUBLIC_URL'];
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...Object.fromEntries(blank.map((name) => [name, ''])),
    DATA_DIR: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
  };
  server = spawn(process.execPath, ['server.js'], { cwd: root, env });
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  await waitFor(/running on/);
});

test.after(() => {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a fresh install walks from the setup wizard to a working API key', async () => {
  const [, token] = await waitFor(/setup\?token=([a-f0-9]+)/);
  const anon = browser();

  // Locked without the token, the API included
  assert.strictEqual((await anon('/apps')).location, '/setup');
  assert.match((await anon('/setup')).text, /paste the setup token/);
  assert.strictEqual((await anon('/setup?token=wrong')).status, 403);
  const api = await fetch(`${base}/v1/me`);
  assert.strictEqual(api.status, 503);

  const b = browser();
  assert.strictEqual((await b(`/setup?token=${token}`)).location, '/setup');
  assert.strictEqual((await b('/setup')).location, '/setup/database');

  let page = await b('/setup/database');
  assert.strictEqual((await b('/setup/database', { form: { _csrf: page.csrf, client: 'sqlite', action: 'save' } })).location, '/setup/admin');

  page = await b('/setup/admin');
  const short = await b('/setup/admin', { form: { _csrf: page.csrf, email: 'owner@example.com', password: 'short', confirm: 'short' } });
  assert.strictEqual(short.status, 400);
  const admin = await b('/setup/admin', { form: { _csrf: page.csrf, email: 'owner@example.com', password: 'a-long-test-password', confirm: 'a-long-test-password' } });
  assert.strictEqual(admin.location, '/setup/storage');

  page = await b('/setup/storage');
  assert.match(page.text, /href="\/setup\/storage\/hetzner"/);
  assert.strictEqual((await b('/setup/storage/skip', { form: { _csrf: page.csrf } })).location, '/setup/app');

  page = await b('/setup/app');
  const done = await b('/setup/app', { form: { _csrf: page.csrf, name: 'Smoke Shop', slug: '', action: 'create' } });
  assert.match(done.text, /Setup is finished/);

  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.deepStrictEqual(saved.database, { client: 'sqlite', filename: 'files360.sqlite' });
  assert.strictEqual(fs.statSync(path.join(dataDir, 'secrets.json')).mode & 0o077, 0, 'secrets are private to the owner');

  // The wizard is gone, for this browser and for anyone else
  assert.strictEqual((await anon(`/setup?token=${token}`)).location, '/login?next=%2Fsetup%3Ftoken%3D' + token);

  const user = browser();
  page = await user('/login');
  const login = await user('/login', { form: { _csrf: page.csrf, email: 'OWNER@example.com', password: 'a-long-test-password', next: '/' } });
  assert.strictEqual(login.location, '/');
  assert.strictEqual((await user('/setup')).status, 404);

  page = await user('/apps');
  const appId = (/href="\/apps\/([a-f0-9]{24})"/.exec(page.text) || [])[1];
  assert.ok(appId, 'the wizard created the first app');

  page = await user(`/apps/${appId}/keys`);
  assert.match(page.text, /No keys yet/, 'no key is made until the operator asks');
  await user(`/apps/${appId}/keys`, { form: { _csrf: page.csrf, label: 'smoke' } });
  const key = (/(f360_[a-f0-9]{12}_[a-f0-9]{48})/.exec((await user(`/apps/${appId}/keys`)).text) || [])[1];
  assert.ok(key, 'the new key is shown once');

  const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${key}` } });
  assert.strictEqual(me.status, 200);
  assert.strictEqual((await me.json()).app.folder, 'smoke-shop');

  const list = await fetch(`${base}/v1/files`, { headers: { 'x-api-key': key } });
  assert.deepStrictEqual(await list.json(), { page: 1, limit: 50, total: 0, items: [] });

  const upload = new FormData();
  upload.append('file', new Blob([Buffer.from('a,b\n1,2\n')]), 'x.csv');
  const noStorage = await fetch(`${base}/v1/files`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: upload });
  assert.strictEqual(noStorage.status, 503);
  assert.strictEqual((await noStorage.json()).error.code, 'storage_unconfigured');

  assert.strictEqual((await fetch(`${base}/v1/images`, { headers: { authorization: `Bearer ${key}` } })).status, 404);
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.strictEqual(spec.openapi, '3.1.0');
  assert.ok(spec.paths['/v1/files']);
  assert.match(await (await fetch(`${base}/llms.txt`)).text(), /POST \/v1\/files/);

  const health = await (await fetch(`${base}/health`)).json();
  assert.strictEqual(health.ok, true);
});
