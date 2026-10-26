/**
 * The connect-storage form, shared by the Storage pages and the setup wizard:
 * read what was posted, fill the gaps from the provider preset, check it.
 */
const providers = require('./providers');
const buckets = require('../db/buckets');

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
  if (form.secret) buckets.setSecret(doc, form.secret);
}

/** Blank form for a provider, with its first region and endpoint filled in. */
function blank(preset) {
  const first = preset.regions ? preset.regions[0].id : '';
  return {
    name: `${preset.label} ${preset.product}`,
    region: first,
    bucket: '',
    account: '',
    endpoint: providers.fill(preset.endpoint, { region: first }),
    publicUrl: '',
    accessKey: '',
    forcePathStyle: Boolean(preset.forcePathStyle),
  };
}

module.exports = { readForm, validate, apply, blank };
