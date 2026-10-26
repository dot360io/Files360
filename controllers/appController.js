const config = require('../config/env');
const db = require('../db');
const storage = require('../utils/storage');
const { ingest } = require('../utils/assetPipeline');
const { generateKey } = require('../utils/keys');
const { buildDocs } = require('../utils/docs');
const { HttpError } = require('../utils/errors');
const v = require('../utils/validate');

async function createKey(appDoc, label) {
  const k = generateKey();
  const cleanLabel = String(label || '').trim().slice(0, 60) || 'default';
  await db.keys.create({ app: appDoc._id, label: cleanLabel, prefix: k.prefix, hash: k.hash, last4: k.last4 });
  return { key: k.key, label: cleanLabel };
}

function baseLocals(req, tab) {
  return {
    title: req.appDoc.name,
    section: 'apps',
    tab,
    app: req.appDoc,
    // Filled in by withStorage for the pages that show where files land
    bucket: null,
  };
}

/** The bucket this app really uploads to, or null when none is connected. */
async function withStorage(locals, appDoc) {
  const target = await storage.forApp(appDoc).catch(() => null);
  return {
    ...locals,
    bucket: target ? target.bucket : null,
    storageName: target ? target.name : null,
    storageIsFallback: Boolean(target && !appDoc.bucket),
  };
}

// Apps list

exports.index = async (req, res) => {
  const apps = await db.apps.list();
  const [keysByApp, previews] = await Promise.all([
    db.keys.activeCounts(),
    Promise.all(apps.map((a) => db.assets.recent({ appId: a._id, limit: 4 }))),
  ]);

  res.render('apps/index', {
    title: 'Apps',
    section: 'apps',
    apps: apps.map((a, i) => ({ ...a, keyCount: keysByApp.get(a._id) || 0, previews: previews[i] })),
    error: null,
    form: {},
    openCreate: req.query.new === '1',
  });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim().slice(0, 80);
  const slug = v.slugify(body.slug || name);

  const fail = async (error) => {
    const apps = await db.apps.list();
    res.status(400).render('apps/index', {
      title: 'Apps',
      section: 'apps',
      apps: apps.map((a) => ({ ...a, keyCount: 0, previews: [] })),
      error,
      form: { name, slug: body.slug || '' },
      openCreate: true,
    });
  };

  if (!name) return fail('Give the app a name.');
  if (!v.SLUG_RE.test(slug)) return fail('The folder needs 2 to 40 latin letters, numbers or dashes. Type one in the folder field.');
  if (await db.apps.slugTaken(slug)) return fail(`The folder "${slug}" is already used by another app.`);

  const appDoc = await db.apps.create({ name, slug });
  req.flash('ok', `${name} is ready. Open its integration guide, then generate an API key when you are ready to connect it.`);
  res.redirect(`/apps/${appDoc._id}`);
};

// App pages

exports.overview = async (req, res) => {
  const [recent, activeKeys] = await Promise.all([
    db.assets.recent({ appId: req.appDoc._id, limit: 8 }),
    db.keys.countActive(req.appDoc._id),
  ]);
  const locals = await withStorage(baseLocals(req, 'overview'), req.appDoc);
  res.render('apps/show', { ...locals, recent, activeKeys, publicUrl: config.publicUrl });
};

exports.keys = async (req, res) => {
  const keys = await db.keys.listForApp(req.appDoc._id);
  let newKey = null;
  if (req.session.newKey && req.session.newKey.appId === String(req.appDoc._id)) {
    newKey = req.session.newKey;
    delete req.session.newKey;
  }
  res.render('apps/keys', { ...(await withStorage(baseLocals(req, 'keys'), req.appDoc)), keys, newKey });
};

exports.createKey = async (req, res) => {
  req.session.newKey = { appId: String(req.appDoc._id), ...(await createKey(req.appDoc, (req.body || {}).label)) };
  res.redirect(`/apps/${req.appDoc._id}/keys`);
};

exports.revokeKey = async (req, res) => {
  if (!v.ID_RE.test(req.params.keyId)) throw new HttpError(404, 'not_found', 'Key not found');
  await db.keys.revoke(req.appDoc._id, req.params.keyId);
  req.flash('ok', 'Key revoked. Requests using it now get a 401.');
  res.redirect(`/apps/${req.appDoc._id}/keys`);
};

exports.settings = async (req, res) => {
  const [imageCount, buckets] = await Promise.all([
    db.assets.count({ appId: req.appDoc._id }),
    db.buckets.list(),
  ]);
  res.render('apps/settings', {
    ...(await withStorage(baseLocals(req, 'settings'), req.appDoc)),
    imageCount,
    buckets: buckets.map(db.buckets.card),
    globalMaxMB: config.limits.maxUploadMB,
    fits: v.FITS,
  });
};

exports.updateSettings = async (req, res) => {
  const appDoc = req.appDoc;
  const body = req.body || {};
  const patch = {};
  try {
    patch.variants = v.parseVariantRows(body);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/apps/${appDoc._id}/settings`);
  }
  const name = String(body.name || '').trim().slice(0, 80);
  if (name) patch.name = name;
  if (v.FORMATS.includes(body.format)) patch.format = body.format;
  patch.quality = v.clampInt(body.quality, appDoc.quality, 30, 100);
  patch.maxUploadMB = v.clampInt(body.maxUploadMB, appDoc.maxUploadMB, 1, config.limits.maxUploadMB);
  patch.keepOriginal = body.keepOriginal === 'on';
  patch.allowDocuments = body.allowDocuments === 'on';
  patch.allowArchives = body.allowArchives === 'on';

  const wanted = String(body.bucket || '').trim();
  if (wanted === '') {
    patch.bucket = null;
  } else if (v.ID_RE.test(wanted)) {
    const chosen = await db.buckets.get(wanted);
    if (!chosen) {
      req.flash('error', 'That storage no longer exists.');
      return res.redirect(`/apps/${appDoc._id}/settings`);
    }
    patch.bucket = chosen._id;
  }
  await db.apps.update(appDoc._id, patch);

  req.flash('ok', 'Settings saved. New uploads use them, existing files keep theirs and their URLs.');
  res.redirect(`/apps/${appDoc._id}/settings`);
};

exports.toggle = async (req, res) => {
  const appDoc = await db.apps.update(req.appDoc._id, { active: !req.appDoc.active });
  req.flash('ok', appDoc.active ? 'App enabled. Its keys work again.' : 'App disabled. Its keys are rejected until you enable it.');
  res.redirect(`/apps/${req.appDoc._id}/settings`);
};

exports.destroy = async (req, res) => {
  const appDoc = req.appDoc;
  const count = await db.assets.count({ appId: appDoc._id });
  if (count > 0) {
    req.flash('error', `Delete the ${count} ${count === 1 ? 'file' : 'files'} of this app first.`);
    return res.redirect(`/apps/${appDoc._id}/settings`);
  }
  if ((req.body || {}).confirm !== appDoc.slug) {
    req.flash('error', `Type "${appDoc.slug}" to confirm.`);
    return res.redirect(`/apps/${appDoc._id}/settings`);
  }
  await db.keys.removeForApp(appDoc._id);
  await db.apps.remove(appDoc._id);
  req.flash('ok', `Deleted ${appDoc.name}.`);
  res.redirect('/apps');
};

// Integration guide

exports.integration = async (req, res) => {
  res.render('apps/integration', {
    ...(await withStorage(baseLocals(req, 'integration'), req.appDoc)),
    publicUrl: config.publicUrl,
    rate: config.limits.apiRatePerMin,
    markdown: await buildDocs(req.appDoc),
  });
};

exports.downloadGuide = async (req, res) => {
  res.attachment(`${req.appDoc.slug}-files-api.md`);
  res.type('text/markdown; charset=utf-8');
  res.send(await buildDocs(req.appDoc));
};

// Upload from the dashboard dialog (JSON). Images and documents both land here.

exports.upload = async (req, res) => {
  if (!req.file) throw new HttpError(400, 'missing_file', 'Choose a file to upload');
  const { image, duplicate } = await ingest({
    app: req.appDoc,
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    folder: v.sanitizeFolder((req.body || {}).folder),
    source: 'dashboard',
  });
  res.status(duplicate ? 200 : 201).json({ ...db.assets.toApi(image), duplicate });
};
