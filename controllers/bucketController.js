const Bucket = require('../models/Bucket');
const App = require('../models/App');
const Image = require('../models/Image');
const storage = require('../utils/storage');
const providers = require('../utils/providers');
const { HttpError } = require('../utils/errors');
const v = require('../utils/validate');

const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,119}$/i;
const trim = (value, max = 255) => String(value == null ? '' : value).trim().slice(0, max);

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Fields the connect form posts, normalised and checked against the preset. */
function readForm(body, preset) {
  const form = {
    name: trim(body.name, 60),
    provider: preset.id,
    bucket: trim(body.bucket, 120),
    region: trim(body.region, 40),
    account: trim(body.account, 80),
    endpoint: trim(body.endpoint).replace(/\/+$/, ''),
    publicUrl: trim(body.publicUrl).replace(/\/+$/, ''),
    accessKey: trim(body.accessKey),
    secret: String(body.secret == null ? '' : body.secret).trim(),
  };

  // The preset fills in anything the admin left blank
  const derived = providers.derive(preset.id, form);
  form.endpoint = form.endpoint || derived.endpoint;
  form.publicUrl = form.publicUrl || derived.publicUrl;
  form.region = form.region || derived.region;
  form.forcePathStyle = body.forcePathStyle === undefined ? derived.forcePathStyle : body.forcePathStyle === 'on';
  form.supportsAcl = derived.supportsAcl;
  return form;
}

function validate(form, preset, { requireSecret }) {
  if (!form.name) return 'Give this storage a name you will recognise.';
  if (!form.bucket) return 'Enter the bucket name, exactly as it appears at the provider.';
  if (!BUCKET_RE.test(form.bucket)) return 'The bucket name may use letters, numbers, dots, dashes and underscores.';
  if (preset.needsAccount && !form.account) return `Enter your ${preset.accountLabel || 'account ID'}.`;
  if (preset.regions && !form.region) return `Choose a ${(preset.regionLabel || 'region').toLowerCase()}.`;
  if (!form.accessKey) return 'Enter the access key.';
  if (requireSecret && !form.secret) return 'Enter the secret key.';
  if (form.endpoint && !isHttpUrl(form.endpoint)) return 'The endpoint must be a full URL starting with https://';
  if (!form.endpoint && preset.id !== 'aws') return 'Enter the S3 endpoint URL for this provider.';
  if (!form.publicUrl) return 'Enter the public base URL the images are served from.';
  if (!isHttpUrl(form.publicUrl)) return 'The public URL must be a full URL starting with https://';
  return null;
}

function apply(doc, form) {
  doc.name = form.name;
  doc.provider = form.provider;
  doc.bucket = form.bucket;
  doc.region = form.region;
  doc.account = form.account;
  doc.endpoint = form.endpoint;
  doc.publicUrl = form.publicUrl;
  doc.accessKey = form.accessKey;
  doc.forcePathStyle = form.forcePathStyle;
  doc.supportsAcl = form.supportsAcl;
  if (form.secret) doc.setSecret(form.secret);
}

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
  const buckets = await Bucket.find().sort({ isDefault: -1, name: 1 });
  const [appCounts, imageCounts] = await Promise.all([
    App.aggregate([{ $match: { bucket: { $ne: null } } }, { $group: { _id: '$bucket', count: { $sum: 1 } } }]),
    Image.aggregate([{ $group: { _id: '$bucket', count: { $sum: 1 } } }]),
  ]);
  const apps = new Map(appCounts.map((a) => [String(a._id), a.count]));
  const images = new Map(imageCounts.map((i) => [String(i._id), i.count]));
  const unassigned = await App.countDocuments({ bucket: null });

  res.render('buckets/index', {
    title: 'Storage',
    section: 'storage',
    buckets: buckets.map((b) => ({
      ...b.toCard(),
      appCount: apps.get(String(b._id)) || 0,
      imageCount: images.get(String(b._id)) || 0,
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
  const first = preset.regions ? preset.regions[0].id : '';
  await renderForm(res, {
    preset,
    form: {
      name: `${preset.label} ${preset.product}`,
      region: first,
      bucket: '',
      account: '',
      endpoint: providers.fill(preset.endpoint, { region: first }),
      publicUrl: '',
      accessKey: '',
      forcePathStyle: Boolean(preset.forcePathStyle),
    },
  });
};

exports.create = async (req, res) => {
  const preset = providers.get((req.body || {}).provider);
  if (!preset) throw new HttpError(400, 'invalid_provider', 'Unknown storage provider');

  const form = readForm(req.body || {}, preset);
  const error = validate(form, preset, { requireSecret: true });
  if (error) return renderForm(res, { status: 400, preset, form, error });

  const doc = new Bucket({ secretEnc: 'placeholder' });
  apply(doc, form);
  doc.isDefault = (await Bucket.countDocuments()) === 0;

  const result = await storage.verify(doc);
  doc.status = { ok: result.ok, publicOk: result.publicOk, error: result.error, checkedAt: new Date() };
  if (!result.ok) {
    return renderForm(res, { status: 400, preset, form, error: result.error });
  }

  await doc.save();
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
  const preset = doc.preset();
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
  const preset = doc.preset();
  const form = readForm(req.body || {}, preset);
  const error = validate(form, preset, { requireSecret: false });
  if (error) return renderForm(res, { status: 400, preset, bucketDoc: doc, form, error });

  const movedUrl = doc.publicUrl !== form.publicUrl;
  const imageCount = await Image.countDocuments({ bucket: doc._id });
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

  await doc.save();
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
  await doc.save();

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
  await Bucket.updateMany({ _id: { $ne: doc._id } }, { isDefault: false });
  doc.isDefault = true;
  await doc.save();
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
  await doc.save();
  req.flash(
    'ok',
    doc.active ? `${doc.name} is on again.` : `${doc.name} is off. Uploads to it are rejected, existing images stay online.`
  );
  res.redirect('/storage');
};

exports.destroy = async (req, res) => {
  const doc = req.bucketDoc;
  const [imageCount, appCount] = await Promise.all([
    Image.countDocuments({ bucket: doc._id }),
    App.countDocuments({ bucket: doc._id }),
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

  await Bucket.deleteOne({ _id: doc._id });
  storage.forget(doc._id);
  await storage.refreshOrigins();
  if (doc.isDefault) {
    const next = await Bucket.findOne({ active: true }).sort({ name: 1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }
  req.flash('ok', `Removed ${doc.name}. Nothing was deleted at the provider.`);
  res.redirect('/storage');
};

/* router.param */

exports.load = async function load(req, res, next, id) {
  try {
    if (!v.OBJECT_ID_RE.test(id)) throw new HttpError(404, 'not_found', 'Storage not found');
    const doc = await Bucket.findById(id);
    if (!doc) throw new HttpError(404, 'not_found', 'Storage not found');
    if (!doc.preset()) throw new HttpError(400, 'invalid_provider', 'This storage uses an unknown provider');
    req.bucketDoc = doc;
    next();
  } catch (err) {
    next(err);
  }
};
