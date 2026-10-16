const config = require('../config/env');
const App = require('../models/App');
const ApiKey = require('../models/ApiKey');
const Image = require('../models/Image');
const Bucket = require('../models/Bucket');
const storage = require('../utils/storage');
const { ingest } = require('../utils/assetPipeline');
const { generateKey } = require('../utils/keys');
const { buildDocs } = require('../utils/docs');
const { HttpError } = require('../utils/errors');
const v = require('../utils/validate');

async function createKey(appDoc, label) {
  const k = generateKey();
  const cleanLabel = String(label || '').trim().slice(0, 60) || 'default';
  await ApiKey.create({ app: appDoc._id, label: cleanLabel, prefix: k.prefix, hash: k.hash, last4: k.last4 });
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
  const apps = await App.find().sort({ name: 1 }).lean();
  const [keyCounts, previews] = await Promise.all([
    ApiKey.aggregate([{ $match: { revokedAt: null } }, { $group: { _id: '$app', count: { $sum: 1 } } }]),
    Promise.all(
      apps.map((a) => Image.find({ app: a._id }, 'kind variants input.format').sort({ createdAt: -1 }).limit(4).lean())
    ),
  ]);
  const keysByApp = new Map(keyCounts.map((k) => [String(k._id), k.count]));

  res.render('apps/index', {
    title: 'Apps',
    section: 'apps',
    apps: apps.map((a, i) => ({ ...a, keyCount: keysByApp.get(String(a._id)) || 0, previews: previews[i] })),
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
    const apps = await App.find().sort({ name: 1 }).lean();
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
  if (await App.exists({ slug })) return fail(`The folder "${slug}" is already used by another app.`);

  const appDoc = await App.create({ name, slug });
  req.session.newKey = { appId: String(appDoc._id), ...(await createKey(appDoc, 'default')) };
  req.flash('ok', `${name} is ready. Copy its API key below.`);
  res.redirect(`/apps/${appDoc._id}/keys`);
};

// App pages

exports.overview = async (req, res) => {
  const [recent, activeKeys] = await Promise.all([
    Image.find({ app: req.appDoc._id }).sort({ createdAt: -1 }).limit(8).populate('app', 'name slug').lean(),
    ApiKey.countDocuments({ app: req.appDoc._id, revokedAt: null }),
  ]);
  const locals = await withStorage(baseLocals(req, 'overview'), req.appDoc);
  res.render('apps/show', { ...locals, recent, activeKeys, publicUrl: config.publicUrl });
};

exports.keys = async (req, res) => {
  const keys = await ApiKey.find({ app: req.appDoc._id }).sort({ revokedAt: 1, createdAt: -1 }).lean();
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
  if (!v.OBJECT_ID_RE.test(req.params.keyId)) throw new HttpError(404, 'not_found', 'Key not found');
  await ApiKey.updateOne({ _id: req.params.keyId, app: req.appDoc._id, revokedAt: null }, { revokedAt: new Date() });
  req.flash('ok', 'Key revoked. Requests using it now get a 401.');
  res.redirect(`/apps/${req.appDoc._id}/keys`);
};

exports.settings = async (req, res) => {
  const [imageCount, buckets] = await Promise.all([
    Image.countDocuments({ app: req.appDoc._id }),
    Bucket.find().sort({ isDefault: -1, name: 1 }),
  ]);
  res.render('apps/settings', {
    ...(await withStorage(baseLocals(req, 'settings'), req.appDoc)),
    imageCount,
    buckets: buckets.map((b) => b.toCard()),
    globalMaxMB: config.limits.maxUploadMB,
    fits: v.FITS,
  });
};

exports.updateSettings = async (req, res) => {
  const appDoc = req.appDoc;
  const body = req.body || {};
  try {
    appDoc.variants = v.parseVariantRows(body);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    req.flash('error', err.message);
    return res.redirect(`/apps/${appDoc._id}/settings`);
  }
  const name = String(body.name || '').trim().slice(0, 80);
  if (name) appDoc.name = name;
  if (v.FORMATS.includes(body.format)) appDoc.format = body.format;
  appDoc.quality = v.clampInt(body.quality, appDoc.quality, 30, 100);
  appDoc.maxUploadMB = v.clampInt(body.maxUploadMB, appDoc.maxUploadMB, 1, config.limits.maxUploadMB);
  appDoc.keepOriginal = body.keepOriginal === 'on';
  appDoc.allowDocuments = body.allowDocuments === 'on';
  appDoc.allowArchives = body.allowArchives === 'on';

  const wanted = String(body.bucket || '').trim();
  if (wanted === '') {
    appDoc.bucket = null;
  } else if (v.OBJECT_ID_RE.test(wanted)) {
    const chosen = await Bucket.findById(wanted);
    if (!chosen) {
      req.flash('error', 'That storage no longer exists.');
      return res.redirect(`/apps/${appDoc._id}/settings`);
    }
    appDoc.bucket = chosen._id;
  }
  await appDoc.save();

  req.flash('ok', 'Settings saved. New uploads use them, existing files keep theirs and their URLs.');
  res.redirect(`/apps/${appDoc._id}/settings`);
};

exports.toggle = async (req, res) => {
  req.appDoc.active = !req.appDoc.active;
  await req.appDoc.save();
  req.flash('ok', req.appDoc.active ? 'App enabled. Its keys work again.' : 'App disabled. Its keys are rejected until you enable it.');
  res.redirect(`/apps/${req.appDoc._id}/settings`);
};

exports.destroy = async (req, res) => {
  const appDoc = req.appDoc;
  const count = await Image.countDocuments({ app: appDoc._id });
  if (count > 0) {
    req.flash('error', `Delete the ${count} ${count === 1 ? 'file' : 'files'} of this app first.`);
    return res.redirect(`/apps/${appDoc._id}/settings`);
  }
  if ((req.body || {}).confirm !== appDoc.slug) {
    req.flash('error', `Type "${appDoc.slug}" to confirm.`);
    return res.redirect(`/apps/${appDoc._id}/settings`);
  }
  await ApiKey.deleteMany({ app: appDoc._id });
  await App.deleteOne({ _id: appDoc._id });
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
  res.attachment(`${req.appDoc.slug}-image-api.md`);
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
  res.status(duplicate ? 200 : 201).json({ ...image.toApi(), duplicate });
};
