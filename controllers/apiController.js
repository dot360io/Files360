const config = require('../config/env');
const db = require('../db');
const { ingest, removeImage } = require('../utils/assetPipeline');
const documents = require('../utils/documents');
const { fetchRemote } = require('../utils/fetchRemote');
const { HttpError } = require('../utils/errors');
const { sanitizeFolder, sanitizeRef, clampInt, ID_RE } = require('../utils/validate');

async function findOwnImage(req) {
  if (!ID_RE.test(req.params.id)) throw new HttpError(404, 'not_found', 'File not found');
  const image = await db.assets.getForApp(req.params.id, req.appDoc._id);
  if (!image) throw new HttpError(404, 'not_found', 'File not found');
  return image;
}

exports.me = (req, res) => {
  const appDoc = req.appDoc;
  res.json({
    app: {
      name: appDoc.name,
      folder: appDoc.slug,
      format: appDoc.format,
      quality: appDoc.quality,
      keepOriginal: appDoc.keepOriginal,
      maxUploadMB: Math.min(appDoc.maxUploadMB, config.limits.maxUploadMB),
      allowDocuments: appDoc.allowDocuments !== false,
      allowArchives: appDoc.allowArchives === true,
      accepts: {
        images: ['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'svg'],
        documents: appDoc.allowDocuments === false ? [] : documents.DOCUMENT_FORMATS,
        archives: appDoc.allowArchives === true ? documents.ARCHIVE_FORMATS : [],
      },
      variants: appDoc.variants.map((v) => ({ name: v.name, width: v.width || null, height: v.height || null, fit: v.fit })),
    },
    key: { label: req.apiKey.label },
  });
};

exports.upload = async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, 'missing_file', 'Send the file as multipart/form-data in a field named "file"');
  }
  const body = req.body || {};
  const { image, duplicate } = await ingest({
    app: req.appDoc,
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    folder: sanitizeFolder(body.folder),
    ref: sanitizeRef(body.ref),
    source: 'upload',
    apiKeyId: req.apiKey._id,
  });
  res.status(duplicate ? 200 : 201).json({ ...db.assets.toApi(image), duplicate });
};

exports.importFromUrl = async (req, res) => {
  const body = req.body || {};
  if (typeof body.url !== 'string' || !body.url) {
    throw new HttpError(400, 'invalid_url', 'Send a JSON body like {"url": "https://..."}');
  }
  const folder = sanitizeFolder(body.folder);
  const ref = sanitizeRef(body.ref);
  const maxBytes = Math.min(req.appDoc.maxUploadMB, config.limits.maxUploadMB) * 1024 * 1024;
  const { buffer, filename, contentType } = await fetchRemote(body.url, maxBytes);

  const { image, duplicate } = await ingest({
    app: req.appDoc,
    buffer,
    originalName: filename,
    mimetype: contentType,
    folder,
    ref,
    source: 'url',
    apiKeyId: req.apiKey._id,
  });
  res.status(duplicate ? 200 : 201).json({ ...db.assets.toApi(image), duplicate });
};

exports.list = async (req, res) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const limit = clampInt(req.query.limit, 50, 1, 200);
  const { items, total } = await db.assets.listForApi({
    appId: req.appDoc._id,
    folder: req.query.folder !== undefined ? sanitizeFolder(req.query.folder) : undefined,
    ref: req.query.ref !== undefined ? sanitizeRef(req.query.ref) : undefined,
    page,
    limit,
  });
  res.json({ page, limit, total, items: items.map(db.assets.toApi) });
};

exports.show = async (req, res) => {
  const image = await findOwnImage(req);
  res.json(db.assets.toApi(image));
};

exports.destroy = async (req, res) => {
  const image = await findOwnImage(req);
  await removeImage(image);
  res.status(204).end();
};
