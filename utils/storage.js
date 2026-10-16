const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const Bucket = require('../models/Bucket');
const { HttpError } = require('./errors');

// One S3Client per bucket, rebuilt when the connection details change
const clients = new Map();

function clientFor(bucketDoc) {
  const id = String(bucketDoc._id);
  const signature = bucketDoc.signature();
  const cached = clients.get(id);
  if (cached && cached.signature === signature) return cached.client;

  const client = new S3Client({
    // Empty endpoint means AWS, where the SDK derives the host from the region
    ...(bucketDoc.endpoint ? { endpoint: bucketDoc.endpoint } : {}),
    region: bucketDoc.region || 'us-east-1',
    forcePathStyle: Boolean(bucketDoc.forcePathStyle),
    credentials: { accessKeyId: bucketDoc.accessKey, secretAccessKey: bucketDoc.secret() },
    // Newer SDK versions add checksums by default that some S3-compatible
    // providers reject. Only send them when the operation requires it.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  clients.set(id, { signature, client });
  return client;
}

function forget(bucketId) {
  clients.delete(String(bucketId));
}

async function putObject(bucketDoc, { key, body, contentType, isPublic, disposition }) {
  await clientFor(bucketDoc).send(
    new PutObjectCommand({
      Bucket: bucketDoc.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Documents say how they open: PDFs in the browser, the rest as downloads
      ...(disposition ? { ContentDisposition: disposition } : {}),
      // R2 and B2 reject x-amz-acl: those buckets are public or private as a whole
      ...(bucketDoc.supportsAcl ? { ACL: isPublic ? 'public-read' : 'private' } : {}),
      // Keys contain a content hash, so files never change and can be cached forever
      CacheControl: isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store',
    })
  );
}

// Single deletes in small parallel batches. DeleteObjects needs Content-MD5,
// which is not reliable across SDK versions on S3-compatible storage.
async function deleteObjects(bucketDoc, keys) {
  const list = [...new Set(keys.filter(Boolean))];
  const client = clientFor(bucketDoc);
  for (let i = 0; i < list.length; i += 10) {
    await Promise.all(
      list.slice(i, i + 10).map((Key) => client.send(new DeleteObjectCommand({ Bucket: bucketDoc.bucket, Key })))
    );
  }
}

function publicUrl(bucketDoc, key) {
  const base = String(bucketDoc.publicUrl || '').replace(/\/+$/, '');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function ping(bucketDoc) {
  await clientFor(bucketDoc).send(new HeadBucketCommand({ Bucket: bucketDoc.bucket }));
  return true;
}

/**
 * Full round trip: credentials, write access, public readability, delete access.
 * Never throws, so the dashboard can show the failing step.
 */
async function verify(bucketDoc) {
  const key = `_files360-check/${bucketDoc._id}.txt`;
  try {
    await ping(bucketDoc);
  } catch (err) {
    return { ok: false, publicOk: null, error: describe(err, 'Could not reach the bucket') };
  }

  try {
    await putObject(bucketDoc, { key, body: Buffer.from('ok'), contentType: 'text/plain', isPublic: true });
  } catch (err) {
    return { ok: false, publicOk: null, error: describe(err, 'The credentials cannot write to this bucket') };
  }

  let publicOk = null;
  if (bucketDoc.publicUrl) {
    try {
      const res = await fetch(publicUrl(bucketDoc, key), { signal: AbortSignal.timeout(8000) });
      publicOk = res.ok;
    } catch {
      publicOk = false;
    }
  }

  await deleteObjects(bucketDoc, [key]).catch(() => {});
  return { ok: true, publicOk, error: null };
}

function describe(err, fallback) {
  const name = err && (err.name || err.Code);
  // Node wraps connection failures, so the useful code sits one or two levels down
  const causes = [err && err.cause, ...((err && err.errors) || [])].filter(Boolean);
  const codes = [err && err.code, ...causes.map((c) => c.code)].filter(Boolean);
  if (codes.some((c) => c === 'ECONNREFUSED')) return 'Nothing is listening at that endpoint. Check the URL and the port.';
  if (codes.some((c) => c === 'ENOTFOUND' || c === 'EAI_AGAIN')) return 'The endpoint host does not resolve. Check the region and the URL.';
  if (codes.some((c) => c === 'ETIMEDOUT' || c === 'ECONNRESET')) return 'The endpoint did not answer in time. Check the URL and the firewall.';
  if (codes.some((c) => String(c).startsWith('ERR_TLS') || c === 'CERT_HAS_EXPIRED')) return 'The endpoint has an invalid TLS certificate.';
  const map = {
    InvalidAccessKeyId: 'The access key is not valid for this provider.',
    SignatureDoesNotMatch: 'The secret key does not match the access key.',
    AccessDenied: 'The key is valid but not allowed on this bucket.',
    NoSuchBucket: 'No bucket with that name exists at this endpoint.',
    NotFound: 'No bucket with that name exists at this endpoint.',
    PermanentRedirect: 'Wrong region or endpoint for this bucket.',
    AuthorizationHeaderMalformed: 'Wrong region for this bucket.',
    CredentialsProviderError: 'The access key or secret is missing.',
  };
  if (map[name]) return map[name];
  const message = (err && err.message) || '';
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(message)) return 'The endpoint host does not resolve. Check the region.';
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) return 'The endpoint did not answer. Check the URL and the firewall.';
  return message ? `${fallback}: ${message}` : fallback;
}

/* Which bucket an upload or a delete belongs to */

async function defaultBucket() {
  return (await Bucket.findOne({ isDefault: true, active: true })) || (await Bucket.findOne({ active: true }));
}

async function forApp(app) {
  if (app.bucket) {
    const own = await Bucket.findById(app.bucket);
    if (own && own.active) return own;
    if (own) throw new HttpError(503, 'storage_disabled', `The storage "${own.name}" is turned off`);
  }
  const fallback = await defaultBucket();
  if (!fallback) {
    throw new HttpError(503, 'storage_unconfigured', 'No storage is connected yet. Add one in Storage.');
  }
  return fallback;
}

/** Images keep their own bucket so re-pointing an app never orphans old files. */
async function forImage(image) {
  if (image.bucket) {
    const own = await Bucket.findById(image.bucket);
    if (own) return own;
  }
  const fallback = await defaultBucket();
  if (!fallback) {
    throw new HttpError(503, 'storage_unconfigured', 'The storage holding this image is no longer connected.');
  }
  return fallback;
}

/**
 * Origins the browser may load images from, for the Content-Security-Policy.
 * Helmet builds the header per request, so the list is cached and refreshed
 * whenever a bucket changes and on a timer, which also covers PM2 clusters.
 */
let originCache = [];

function cachedOrigins() {
  return originCache;
}

async function refreshOrigins() {
  originCache = await publicOrigins();
  return originCache;
}

async function publicOrigins() {
  const buckets = await Bucket.find({}, 'publicUrl').lean();
  const origins = new Set();
  for (const b of buckets) {
    try {
      if (b.publicUrl) origins.add(new URL(b.publicUrl).origin);
    } catch {
      // A malformed URL just does not widen the policy
    }
  }
  return [...origins];
}

module.exports = {
  clientFor,
  forget,
  putObject,
  deleteObjects,
  publicUrl,
  ping,
  verify,
  describe,
  defaultBucket,
  forApp,
  forImage,
  publicOrigins,
  cachedOrigins,
  refreshOrigins,
};
