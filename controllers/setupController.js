/**
 * First-run setup wizard: database, administrator, storage, first app.
 *
 * Answers only while there is no config file and no administrator, and only
 * to a browser that has shown the one-time token printed to stdout at startup.
 * An exposed, unauthenticated setup page is how self-hosted apps get taken
 * over, and "it is only open for a minute" is how that happens anyway.
 *
 * Nothing is written until the last step. A restart halfway through starts the
 * wizard again with a new token, rather than leaving a half-made install that
 * the lock then refuses to finish.
 */
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const config = require('../config/env');
const database = require('../config/database');
const db = require('../db');
const storage = require('../utils/storage');
const providers = require('../utils/providers');
const { readForm, validate, apply, blank } = require('../utils/bucketForm');
const { csrf } = require('../middleware/auth');
const errorHandler = require('../middleware/errorHandler');
const { HttpError } = require('../utils/errors');
const v = require('../utils/validate');

const STEPS = [
  { id: 'database', label: 'Database' },
  { id: 'admin', label: 'Administrator' },
  { id: 'storage', label: 'Storage' },
  { id: 'app', label: 'First app' },
];
const MIN_PASSWORD = 10;

const token = crypto.randomBytes(24).toString('hex');

// Held in memory until the last step, see the note at the top
const state = {
  database: null,
  admin: null,
  bucket: null,
  storageSkipped: false,
  done: false,
};

function announce() {
  // Inside a container HOST is 0.0.0.0, which no browser can open
  const host = ['0.0.0.0', '::'].includes(config.host) ? 'localhost' : config.host;
  const base = config.publicUrl.startsWith('http://localhost') ? `http://${host}:${config.port}` : config.publicUrl;
  console.log('');
  console.log('[files360] setup is needed. Open this address to start; the token in it is valid until the next restart:');
  console.log(`[files360]   ${base}/setup?token=${token}`);
  console.log('');
}

function tokenMatches(sent) {
  const a = Buffer.from(String(sent || ''));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The database step is decided by DATABASE_URL when it is set. */
function databaseFixed() {
  return config.databaseSource === 'env';
}

function stepDone(id) {
  if (id === 'database') return Boolean(state.database) || databaseFixed();
  if (id === 'admin') return Boolean(state.admin);
  if (id === 'storage') return Boolean(state.bucket) || state.storageSkipped;
  return false;
}

function firstOpenStep() {
  return STEPS.find((s) => !stepDone(s.id)).id;
}

/** Sends the browser back to the first unfinished step before this one. */
function ensureReached(id) {
  const index = STEPS.findIndex((s) => s.id === id);
  const missing = STEPS.slice(0, index).find((s) => !stepDone(s.id));
  return missing ? `/setup/${missing.id}` : null;
}

function render(res, view, locals = {}, status = 200) {
  res.status(status).render(`setup/${view}`, {
    title: 'Set up',
    steps: STEPS.map((s) => ({ ...s, done: stepDone(s.id) })),
    step: locals.step || null,
    ...locals,
  });
}

/* Gate */

async function locked() {
  if (state.done || config.hasConfigFile) return true;
  return db.connected && (await db.admins.count()) > 0;
}

async function gate(req, res, next) {
  if (await locked()) return next(new HttpError(404, 'not_found', 'This page does not exist'));
  if (req.path.startsWith('/v1')) {
    return res.status(503).json({ error: { code: 'setup_needed', message: 'This instance is not set up yet. Finish the setup wizard in a browser first.' } });
  }
  if (req.session.setupOk) return next();
  if (req.method === 'GET' && req.path === '/setup' && req.query.token !== undefined) {
    if (tokenMatches(req.query.token)) {
      await regenerate(req);
      req.session.setupOk = true;
      return res.redirect('/setup');
    }
    return render(res, 'token', { error: 'That token is not the one printed in the server log. Copy it again from the latest start-up.' }, 403);
  }
  if (req.method === 'POST' && req.path === '/setup/token') return next();
  if (req.path !== '/setup') return res.redirect('/setup');
  render(res, 'token', { error: null });
}

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

const tokenLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => render(res, 'token', { error: 'Too many attempts. Wait 15 minutes and try again.' }, 429),
});

async function submitToken(req, res) {
  if (!tokenMatches((req.body || {}).token)) {
    return render(res, 'token', { error: 'That token is not the one printed in the server log. Copy it again from the latest start-up.' }, 403);
  }
  await regenerate(req);
  req.session.setupOk = true;
  // regenerate dropped the CSRF token with the old session
  res.redirect('/setup');
}

/* Step 1: database */

function readDatabaseForm(body) {
  const client = database.CLIENTS.includes(body.client) ? body.client : 'sqlite';
  if (client === 'sqlite') return { client, settings: { ...database.DEFAULT_SQLITE }, form: { client } };
  const form = {
    client,
    host: String(body.host || '').trim().slice(0, 255),
    port: v.clampInt(body.port, database.DEFAULT_PORTS[client], 1, 65535),
    user: String(body.user || '').trim().slice(0, 120),
    password: String(body.password || ''),
    database: String(body.database || '').trim().slice(0, 120),
    ssl: body.ssl === 'on',
  };
  return { client, settings: { ...form }, form };
}

function databaseError(form) {
  if (form.client === 'sqlite') return null;
  if (!form.host) return 'Enter the host name of the database server.';
  if (!form.user) return 'Enter the user name Files360 should connect as.';
  if (!form.database) return 'Enter the name of the database. Create an empty one first if you have not.';
  return null;
}

function showDatabase(req, res) {
  const saved = state.database;
  const form = saved && saved.client !== 'sqlite' ? { ...saved } : { client: saved ? saved.client : 'sqlite' };
  render(res, 'database', {
    step: 'database',
    form,
    fixed: databaseFixed() ? database.describe(config.database, config.dataDir) : null,
    sqlitePath: database.describe(database.DEFAULT_SQLITE, config.dataDir),
    defaultPorts: database.DEFAULT_PORTS,
    result: null,
    error: null,
  });
}

const PROBE_STEPS = { settings: 'Reading the settings', connect: 'Connecting', create: 'Creating a table' };

async function saveDatabase(req, res) {
  if (databaseFixed()) return res.redirect('/setup/admin');
  const body = req.body || {};
  const { settings, form } = readDatabaseForm(body);
  const locals = {
    step: 'database',
    form,
    fixed: null,
    sqlitePath: database.describe(database.DEFAULT_SQLITE, config.dataDir),
    defaultPorts: database.DEFAULT_PORTS,
    result: null,
    error: databaseError(form),
  };
  if (locals.error) return render(res, 'database', locals, 400);

  const probe = await db.probe(settings, config.dataDir);
  if (!probe.ok) {
    locals.error = `${PROBE_STEPS[probe.step] || 'Testing'} failed. ${probe.error}`;
    return render(res, 'database', locals, 400);
  }
  if (body.action === 'test') {
    locals.result = `Connected to ${database.describe(settings, config.dataDir)}, and this user can create tables.`;
    return render(res, 'database', locals);
  }

  try {
    await db.connect(settings, config.dataDir);
    await db.migrate();
  } catch (err) {
    locals.error = `The connection worked but the tables could not be created. ${db.explain(err)}`;
    return render(res, 'database', locals, 400);
  }
  // A database that already has an administrator belongs to another install
  if ((await db.admins.count()) > 0) {
    await db.close();
    locals.error = 'This database already has an administrator, so it belongs to an existing install. Choose an empty database, or set DATABASE_URL to it and sign in as usual.';
    return render(res, 'database', locals, 400);
  }
  state.database = settings;
  res.redirect('/setup/admin');
}

/* Step 2: administrator */

function showAdmin(req, res) {
  const back = ensureReached('admin');
  if (back) return res.redirect(back);
  render(res, 'admin', { step: 'admin', form: { email: state.admin ? state.admin.email : '' }, error: null, minPassword: MIN_PASSWORD });
}

async function saveAdmin(req, res) {
  const back = ensureReached('admin');
  if (back) return res.redirect(back);
  const body = req.body || {};
  const email = db.admins.normalise(body.email);
  const password = String(body.password || '');
  const fail = (error) => render(res, 'admin', { step: 'admin', form: { email }, error, minPassword: MIN_PASSWORD }, 400);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail('Enter the email address you will sign in with.');
  if (password.length < MIN_PASSWORD) return fail(`Use a password of at least ${MIN_PASSWORD} characters.`);
  if (password !== String(body.confirm || '')) return fail('The two passwords do not match. Type them again.');

  state.admin = { email, passwordHash: await bcrypt.hash(password, 12) };
  res.redirect('/setup/storage');
}

/* Step 3: storage */

function showStorage(req, res) {
  const back = ensureReached('storage');
  if (back) return res.redirect(back);
  render(res, 'storage', {
    step: 'storage',
    providers: providers.PROVIDERS,
    connected: state.bucket ? db.buckets.card(state.bucket) : null,
  });
}

function storageForm(res, { status = 200, preset, form, error = null }) {
  render(
    res,
    'storage-form',
    { step: 'storage', preset, form, error, bucketDoc: null, catalog: providers.clientCatalog() },
    status
  );
}

function showStorageForm(req, res) {
  const back = ensureReached('storage');
  if (back) return res.redirect(back);
  const preset = providers.get(req.params.provider);
  if (!preset) throw new HttpError(404, 'not_found', 'Unknown storage provider');
  storageForm(res, { preset, form: blank(preset) });
}

async function saveStorage(req, res) {
  const back = ensureReached('storage');
  if (back) return res.redirect(back);
  const preset = providers.get((req.body || {}).provider);
  if (!preset) throw new HttpError(400, 'invalid_provider', 'Unknown storage provider');

  const form = readForm(req.body || {}, preset);
  const error = validate(form, preset, { requireSecret: true });
  if (error) return storageForm(res, { status: 400, preset, form, error });

  const doc = db.buckets.build({ isDefault: true });
  apply(doc, form);
  const result = await storage.verify(doc);
  storage.forget(doc._id);
  doc.status = { ok: result.ok, publicOk: result.publicOk, error: result.error, checkedAt: new Date() };
  if (!result.ok) return storageForm(res, { status: 400, preset, form, error: result.error });

  state.bucket = doc;
  state.storageSkipped = false;
  res.redirect('/setup/app');
}

function skipStorage(req, res) {
  const back = ensureReached('storage');
  if (back) return res.redirect(back);
  state.bucket = null;
  state.storageSkipped = true;
  res.redirect('/setup/app');
}

/* Step 4: first app, then everything is written */

function showApp(req, res) {
  const back = ensureReached('app');
  if (back) return res.redirect(back);
  render(res, 'app', { step: 'app', form: {}, error: null, storageWarning: !state.bucket });
}

function finisher(onComplete) {
  return async function finish(req, res) {
    const back = ensureReached('app');
    if (back) return res.redirect(back);
    const body = req.body || {};
    const skip = body.action === 'skip';
    const name = String(body.name || '').trim().slice(0, 80);
    const slug = v.slugify(body.slug || name);
    const fail = (error) => render(res, 'app', { step: 'app', form: { name, slug: body.slug || '' }, error, storageWarning: !state.bucket }, 400);

    if (!skip) {
      if (!name) return fail('Give the app a name, or skip this step.');
      if (!v.SLUG_RE.test(slug)) return fail('The folder needs 2 to 40 latin letters, numbers or dashes. Type one in the folder field.');
      if (await db.apps.slugTaken(slug)) return fail(`The folder "${slug}" is already used by another app.`);
    }

    // Storage and app first, administrator last: the administrator row is what
    // shuts the wizard, so a failure before it leaves the wizard able to retry
    if (state.bucket && !(await db.buckets.get(state.bucket._id))) {
      if ((await db.buckets.count()) > 0) state.bucket.isDefault = false;
      await db.buckets.insert(state.bucket);
    }
    if (!skip) await db.apps.create({ name, slug });
    await db.admins.create(state.admin);
    // Settings from the environment stay there; only the wizard's choice is saved
    config.saveConfigFile(databaseFixed() ? {} : { database: state.database });
    state.done = true;

    await onComplete();
    console.log(`[files360] setup finished. Sign in as ${state.admin.email}.`);
    req.session.destroy(() => render(res, 'done', { email: state.admin.email, appCreated: !skip, storageConnected: Boolean(state.bucket) }));
  };
}

/* Router */

function router({ onComplete }) {
  const r = express.Router();
  r.use(
    session({
      // A cookie of its own, kept in memory: there is no database to hold it yet,
      // and it means nothing to the app once setup is finished
      name: 'files360.setup',
      secret: config.sessionSecret,
      store: new session.MemoryStore(),
      resave: false,
      saveUninitialized: true,
      cookie: { httpOnly: true, sameSite: 'strict', secure: 'auto', maxAge: 2 * 3600 * 1000 },
    })
  );
  r.use(express.urlencoded({ extended: false, limit: '64kb' }));
  r.use(gate);
  r.post('/setup/token', tokenLimit, submitToken);
  r.use(csrf);

  r.get('/setup', (req, res) => res.redirect(`/setup/${firstOpenStep()}`));
  r.get('/setup/database', showDatabase);
  r.post('/setup/database', saveDatabase);
  r.get('/setup/admin', showAdmin);
  r.post('/setup/admin', saveAdmin);
  r.get('/setup/storage', showStorage);
  r.post('/setup/storage', saveStorage);
  r.post('/setup/storage/skip', skipStorage);
  r.get('/setup/storage/:provider', showStorageForm);
  r.get('/setup/app', showApp);
  r.post('/setup/app', finisher(onComplete));

  // Every other address waits for setup
  r.use((req, res) => res.redirect('/setup'));
  r.use(errorHandler);
  return r;
}

module.exports = { router, announce, STEPS, _state: state, _token: token };
