const db = require('../db');
const storage = require('../utils/storage');
const providers = require('../utils/providers');
const { HttpError } = require('../utils/errors');
const v = require('../utils/validate');
const { readForm, validate, apply, blank } = require('../utils/bucketForm');

async function renderForm(res, { status = 200, preset, bucketDoc = null, form, error = null }) {
  res.status(status).render('buckets/form', {
    title: bucketDoc ? `Edit ${bucketDoc.name}` : `Connect ${preset.label}`,
    section: 'storage',
    preset,
    bucketDoc,
    form,
    error,
    catalog: providers.clientCatalog(),
  });
}

/* List */

exports.index = async (req, res) => {
  const [buckets, apps, images, unassigned] = await Promise.all([
    db.buckets.list(),
    db.apps.countsByBucket(),
    db.assets.countsByBucket(),
    db.apps.countWithoutBucket(),
  ]);

  res.render('buckets/index', {
    title: 'Storage',
    section: 'storage',
    buckets: buckets.map((b) => ({
      ...db.buckets.card(b),
      appCount: apps.get(b._id) || 0,
      imageCount: images.get(b._id) || 0,
    })),
    unassigned,
    providers: providers.PROVIDERS,
  });
};

/* Connect */

exports.choose = (req, res) => {
  res.render('buckets/choose', { title: 'Connect storage', section: 'storage', providers: providers.PROVIDERS });
};

exports.newForm = async (req, res) => {
  const preset = providers.get(req.params.provider);
  if (!preset) throw new HttpError(404, 'not_found', 'Unknown storage provider');
  await renderForm(res, { preset, form: blank(preset) });
};

exports.create = async (req, res) => {
  const preset = providers.get((req.body || {}).provider);
  if (!preset) throw new HttpError(400, 'invalid_provider', 'Unknown storage provider');

  const form = readForm(req.body || {}, preset);
  const error = validate(form, preset, { requireSecret: true });
  if (error) return renderForm(res, { status: 400, preset, form, error });

  const doc = db.buckets.build();
  apply(doc, form);
  doc.isDefault = (await db.buckets.count()) === 0;

  const result = await storage.verify(doc);
  doc.status = { ok: result.ok, publicOk: result.publicOk, error: result.error, checkedAt: new Date() };
  if (!result.ok) {
    return renderForm(res, { status: 400, preset, form, error: result.error });
  }

  await db.buckets.insert(doc);
  await storage.refreshOrigins();
  req.flash(
    'ok',
    result.publicOk === false
      ? `${doc.name} is connected, but the public URL did not return the test file. Check that the bucket is public.`
      : `${doc.name} is connected and ready.`
  );
  res.redirect('/storage');
};

/* Edit */

exports.editForm = async (req, res) => {
  const doc = req.bucketDoc;
  const preset = db.buckets.presetOf(doc);
  await renderForm(res, {
    preset,
    bucketDoc: doc,
    form: {
      name: doc.name,
      region: doc.region,
      bucket: doc.bucket,
      account: doc.account,
      endpoint: doc.endpoint,
      publicUrl: doc.publicUrl,
      accessKey: doc.accessKey,
      forcePathStyle: doc.forcePathStyle,
    },
  });
};

exports.update = async (req, res) => {
  const doc = req.bucketDoc;
  const preset = db.buckets.presetOf(doc);
  const form = readForm(req.body || {}, preset);
  const error = validate(form, preset, { requireSecret: false });
  if (error) return renderForm(res, { status: 400, preset, bucketDoc: doc, form, error });

  const movedUrl = doc.publicUrl !== form.publicUrl;
  const imageCount = await db.assets.count({ bucketId: doc._id });
  if (movedUrl && imageCount > 0 && (req.body || {}).confirmUrlChange !== 'on') {
    return renderForm(res, {
      status: 400,
      preset,
      bucketDoc: doc,
      form,
      error: `${imageCount} stored ${imageCount === 1 ? 'image still points' : 'images still point'} at the old public URL. Tick the confirmation box to change it anyway.`,
    });
  }

  apply(doc, form);
  storage.forget(doc._id);

  const result = await storage.verify(doc);
  doc.status = { ok: result.ok, publicOk: result.publicOk, error: result.error, checkedAt: new Date() };
  if (!result.ok) return renderForm(res, { status: 400, preset, bucketDoc: doc, form, error: result.error });

  await db.buckets.save(doc);
  await storage.refreshOrigins();
  req.flash('ok', `${doc.name} saved and verified.`);
  res.redirect('/storage');
};

/* Actions */

exports.test = async (req, res) => {
  const doc = req.bucketDoc;
  storage.forget(doc._id);
  const result = await storage.verify(doc);
  doc.status = { ok: result.ok, publicOk: result.publicOk, error: result.error, checkedAt: new Date() };
  await db.buckets.save(doc);

  if (!result.ok) req.flash('error', `${doc.name}: ${result.error}`);
  else if (result.publicOk === false) req.flash('error', `${doc.name} accepts uploads, but ${doc.publicUrl} did not serve the test file.`);
  else req.flash('ok', `${doc.name} works. Upload, public read and delete all succeeded.`);
  res.redirect('/storage');
};

exports.makeDefault = async (req, res) => {
  const doc = req.bucketDoc;
  if (!doc.active) {
    req.flash('error', 'Turn the storage on before making it the default.');
    return res.redirect('/storage');
  }
  await db.buckets.makeDefault(doc._id);
  req.flash('ok', `New apps and any app without its own storage now use ${doc.name}.`);
  res.redirect('/storage');
};

exports.toggle = async (req, res) => {
  const doc = req.bucketDoc;
  if (doc.active && doc.isDefault) {
    req.flash('error', 'Make another storage the default before turning this one off.');
    return res.redirect('/storage');
  }
  doc.active = !doc.active;
  await db.buckets.save(doc);
  req.flash(
    'ok',
    doc.active ? `${doc.name} is on again.` : `${doc.name} is off. Uploads to it are rejected, existing images stay online.`
  );
  res.redirect('/storage');
};

exports.destroy = async (req, res) => {
  const doc = req.bucketDoc;
  const [imageCount, appCount] = await Promise.all([
    db.assets.count({ bucketId: doc._id }),
    db.apps.countUsingBucket(doc._id),
  ]);

  if (imageCount > 0) {
    req.flash('error', `${doc.name} still holds ${imageCount} ${imageCount === 1 ? 'image' : 'images'}. Delete them in the library first.`);
    return res.redirect('/storage');
  }
  if (appCount > 0) {
    req.flash(
      'error',
      `${appCount} ${appCount === 1 ? 'app still uploads' : 'apps still upload'} to ${doc.name}. Point ${appCount === 1 ? 'it' : 'them'} somewhere else first.`
    );
    return res.redirect('/storage');
  }
  if ((req.body || {}).confirm !== doc.name) {
    req.flash('error', `Type "${doc.name}" to confirm.`);
    return res.redirect('/storage');
  }

  await db.buckets.remove(doc._id);
  storage.forget(doc._id);
  await storage.refreshOrigins();
  if (doc.isDefault) {
    const next = await db.buckets.firstActive();
    if (next) await db.buckets.makeDefault(next._id);
  }
  req.flash('ok', `Removed ${doc.name}. Nothing was deleted at the provider.`);
  res.redirect('/storage');
};

/* router.param */

exports.load = async function load(req, res, next, id) {
  try {
    if (!v.ID_RE.test(id)) throw new HttpError(404, 'not_found', 'Storage not found');
    const doc = await db.buckets.get(id);
    if (!doc) throw new HttpError(404, 'not_found', 'Storage not found');
    if (!db.buckets.presetOf(doc)) throw new HttpError(400, 'invalid_provider', 'This storage uses an unknown provider');
    req.bucketDoc = doc;
    next();
  } catch (err) {
    next(err);
  }
};
