const db = require('../db');
const storage = require('./storage');
const optimizer = require('./optimizer');
const documents = require('./documents');
const svg = require('./svg');
const { sha256 } = require('./keys');
const { HttpError } = require('./errors');

// Same file + same settings always produce the same folder, so URLs are immutable
function renderSignature(app) {
  return JSON.stringify({
    format: app.format,
    quality: app.quality,
    variants: app.variants.map((v) => [v.name, v.width || 0, v.height || 0, v.fit]),
  });
}

const storageFailed = (target, err, what) => {
  console.error(`[storage] upload to "${target.name}" failed:`, err && err.message);
  return new HttpError(502, 'storage_error', `Storage "${target.name}" rejected the ${what}: ${storage.describe(err, 'try again')}`);
};

/**
 * Optimizes one image and stores every size on the app's bucket.
 * Bucket layout: <app slug>/<folder>/<hash>/<size>.<ext>
 */
async function storeImage({ app, target, buffer, folder, hash, originalName, vector }) {
  const source = vector ? vector.svg : buffer;
  const info = await optimizer.inspect(source);
  const rendered = await optimizer.render(source, info, app);

  const dir = [app.slug, folder, sha256(hash + renderSignature(app)).slice(0, 24)].filter(Boolean).join('/');
  const outputs = rendered.map((r) => ({ ...r, key: `${dir}/${r.name}.${optimizer.EXT[r.format]}` }));

  const uploads = outputs.map((o) =>
    storage.putObject(target, { key: o.key, body: o.data, contentType: optimizer.MIME[o.format], isPublic: true })
  );

  // The cleaned vector is published next to the sizes, so it stays usable as one
  let file;
  if (vector) {
    const name = documents.safeFileName(originalName, 'svg');
    const key = `${dir}/${name}`;
    uploads.push(
      storage.putObject(target, {
        key,
        body: vector.svg,
        contentType: 'image/svg+xml',
        isPublic: true,
        disposition: `inline; filename="${name}"`,
      })
    );
    file = { key, url: storage.publicUrl(target, key), name, mime: 'image/svg+xml', bytes: vector.svg.length };
  }

  // A vector needs no private backup: what is published is already the whole file
  let originalKey = null;
  if (app.keepOriginal && !vector) {
    originalKey = `${dir}/original.${optimizer.ORIGINAL_EXT[info.format] || 'bin'}`;
    uploads.push(
      storage.putObject(target, {
        key: originalKey,
        body: buffer,
        contentType: optimizer.ORIGINAL_MIME[info.format] || 'application/octet-stream',
        isPublic: false,
      })
    );
  }

  const results = await Promise.allSettled(uploads);
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) {
    await storage.deleteObjects(target, [...outputs.map((o) => o.key), originalKey, file && file.key]).catch(() => {});
    throw storageFailed(target, failure.reason, 'upload');
  }

  return {
    kind: 'image',
    input: { format: info.format, width: info.width, height: info.height, bytes: buffer.length },
    original: originalKey ? { key: originalKey, bytes: buffer.length } : undefined,
    file,
    preview: vector ? vector.preview : undefined,
    variants: outputs.map((o) => ({
      name: o.name,
      key: o.key,
      url: storage.publicUrl(target, o.key),
      width: o.width,
      height: o.height,
      bytes: o.bytes,
      format: o.format,
      fit: o.fit,
    })),
    bytesOut: outputs.reduce((sum, o) => sum + o.bytes, 0) + (file ? file.bytes : 0),
  };
}

/**
 * Rewrites an uploaded vector through the SVG allowlist. What comes out is
 * what gets published and rasterized, never the bytes that arrived.
 */
function cleanVector(buffer) {
  let cleaned;
  try {
    cleaned = svg.sanitize(buffer);
  } catch (err) {
    throw new HttpError(415, 'unsupported_image', `This SVG could not be read: ${err.message}`);
  }
  const { elements, attributes } = cleaned.removed;
  return {
    svg: cleaned.svg,
    preview: {
      kind: 'vector',
      removedElements: elements,
      removedAttributes: attributes,
      note: elements.length || attributes.length ? null : 'Nothing had to be removed from this file.',
    },
  };
}

/**
 * Stores a document untouched and keeps a small preview of its contents.
 * Bucket layout: <app slug>/<folder>/<hash>/<file name>.<ext>
 */
async function storeDocument({ app, target, buffer, folder, hash, originalName, detected }) {
  const { type } = detected;
  const dir = [app.slug, folder, sha256(`${hash}:document`).slice(0, 24)].filter(Boolean).join('/');
  const name = documents.safeFileName(originalName, type.ext);
  const key = `${dir}/${name}`;
  const preview = documents.preview(type, buffer, detected.source);

  try {
    await storage.putObject(target, {
      key,
      body: buffer,
      contentType: type.mime,
      isPublic: true,
      // The name is already reduced to a-z, 0-9, "." "-" and "_"
      disposition: `${type.disposition}; filename="${name}"`,
    });
  } catch (err) {
    throw storageFailed(target, err, 'file');
  }

  return {
    kind: 'document',
    input: { format: type.format, bytes: buffer.length },
    file: { key, url: storage.publicUrl(target, key), name, mime: type.mime, bytes: buffer.length },
    preview,
    bytesOut: buffer.length,
  };
}

/**
 * Takes one uploaded file, works out whether it is an image or a document,
 * stores it and writes the record. Uploading the same file into the same
 * folder twice returns the first record instead of storing it again.
 */
async function ingest({ app, buffer, originalName, mimetype, folder = '', ref, source = 'upload', apiKeyId }) {
  if (!app.active) throw new HttpError(403, 'app_disabled', 'This app is disabled');
  if (!buffer || buffer.length === 0) throw new HttpError(400, 'empty_file', 'The uploaded file is empty');

  const vector = svg.looksLikeSvg(buffer) ? cleanVector(buffer) : null;
  const detected = vector ? null : documents.detect(buffer, originalName, mimetype);

  if (detected && detected.type.archive && app.allowArchives !== true) {
    throw new HttpError(
      415,
      'archives_disabled',
      'This app does not accept archives. Turn on archive uploads in its settings to send ZIP files.'
    );
  }
  if (detected && !detected.type.archive && app.allowDocuments === false) {
    throw new HttpError(
      415,
      'documents_disabled',
      `This app only accepts images. Turn on document uploads in its settings to send ${detected.type.label}s.`
    );
  }

  const hash = sha256(buffer);
  const existing = await db.assets.findDuplicate(app._id, folder, hash);
  if (existing) return { image: existing, duplicate: true };

  const target = await storage.forApp(app);
  const stored = detected
    ? await storeDocument({ app, target, buffer, folder, hash, originalName, detected })
    : await storeImage({ app, target, buffer, folder, hash, originalName, vector });

  let image;
  try {
    image = await db.assets.create({
      appId: app._id,
      bucket: target._id,
      folder,
      hash,
      ref,
      originalName: originalName ? String(originalName).slice(0, 255) : undefined,
      source,
      apiKey: apiKeyId,
      ...stored,
    });
  } catch (err) {
    // Two identical uploads at the same moment: return the one that won
    if (db.isUniqueViolation(err)) {
      const winner = await db.assets.findDuplicate(app._id, folder, hash);
      if (winner) return { image: winner, duplicate: true };
    }
    throw err;
  }

  await db.apps.addStats(app._id, { images: 1, bytesIn: buffer.length, bytesOut: stored.bytesOut });

  return { image, duplicate: false };
}

/** Every object this record owns in the bucket. */
function keysOf(image) {
  const keys = image.variants.map((v) => v.key);
  if (image.original && image.original.key) keys.push(image.original.key);
  if (image.file && image.file.key) keys.push(image.file.key);
  return keys;
}

async function removeImage(image) {
  await storage.deleteObjects(await storage.forImage(image), keysOf(image));

  // Only the request that really deleted the row moves the stats, so a double
  // click on delete cannot count the same file out twice
  const deleted = await db.assets.remove(image._id);
  if (deleted) {
    await db.apps.addStats(image.appId, {
      images: -1,
      bytesIn: -((image.input && image.input.bytes) || 0),
      bytesOut: -(image.bytesOut || 0),
    });
  }
}

module.exports = { ingest, removeImage };
