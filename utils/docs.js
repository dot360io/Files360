const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const storage = require('./storage');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'integration-template.md'), 'utf8');
const EXT = { webp: 'webp', avif: 'avif', jpeg: 'jpg' };

// Output size of a variant for a sample 4032x3024 photo
function sampleSize(v, W = 4032, H = 3024) {
  if (v.width && v.height && (v.fit === 'cover' || v.fit === 'fill')) return [v.width, v.height];
  const rw = v.width ? v.width / W : null;
  const rh = v.height ? v.height / H : null;
  const ratios = [rw, rh].filter((r) => r !== null);
  let scale = v.fit === 'outside' ? Math.max(...ratios) : Math.min(...ratios);
  scale = Math.min(scale, 1);
  return [Math.round(W * scale), Math.round(H * scale)];
}

function describe(v) {
  const box = `${v.width || 'auto'} x ${v.height || 'auto'}`;
  const how = {
    cover: 'cropped to fill the box exactly',
    contain: 'fits inside the box, padded',
    inside: 'fits inside the box, keeps aspect ratio',
    outside: 'covers the box, keeps aspect ratio',
    fill: 'stretched to the box',
  }[v.fit];
  return `| \`${v.name}\` | ${box} | ${v.fit} | ${how} |`;
}

async function buildDocs(app) {
  const variants = app.variants;
  const hash = '3f9a1c7e5b2d8a4f6e0c9b1d';
  const ext = EXT[app.format];

  // Sample URLs must match the bucket this app actually uploads to
  const target = await storage.forApp(app).catch(() => null);
  const cdnBase = target ? String(target.publicUrl || '').replace(/\/+$/, '') : 'https://your-cdn.example.com';

  const sampleVariants = {};
  for (const variant of variants) {
    const [w, h] = sampleSize(variant);
    sampleVariants[variant.name] = {
      url: `${cdnBase}/${app.slug}/products/${hash}/${variant.name}.${ext}`,
      width: w,
      height: h,
      bytes: Math.round(w * h * 0.07),
      format: app.format,
    };
  }
  const srcset = variants
    .filter((x) => x.fit !== 'cover' && x.fit !== 'fill')
    .map((x) => ({ name: x.name, width: sampleVariants[x.name].width }))
    .sort((a, b) => a.width - b.width)
    .map((x) => `${sampleVariants[x.name].url} ${x.width}w`)
    .join(', ');

  const sample = {
    id: '66f1c2a9e4b0a1d2c3f4e5a6',
    kind: 'image',
    folder: 'products',
    ref: 'product-1042',
    hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    input: { name: 'IMG_2231.jpg', format: 'jpeg', width: 4032, height: 3024, bytes: 3482112 },
    variants: sampleVariants,
    srcset,
    bytesOut: Object.values(sampleVariants).reduce((s, x) => s + x.bytes, 0),
    createdAt: '2026-01-15T10:24:00.000Z',
    duplicate: false,
  };

  const documentsOn = app.allowDocuments !== false;
  const sampleDocument = {
    id: '66f1c2a9e4b0a1d2c3f4e5a7',
    kind: 'document',
    folder: 'contracts',
    ref: 'booking-5521',
    hash: '9f2b4c8d1e0a7f6b3c5d8e2a4b6c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c',
    input: { name: 'rental-terms.pdf', format: 'pdf', bytes: 184320 },
    file: {
      url: `${cdnBase}/${app.slug}/contracts/8b1f0c2ad4e69137aa02c5be/rental-terms.pdf`,
      name: 'rental-terms.pdf',
      mime: 'application/pdf',
      bytes: 184320,
    },
    preview: { kind: 'pdf', pages: 12 },
    bytesOut: 184320,
    createdAt: '2026-01-15T10:26:00.000Z',
    duplicate: false,
  };

  const byWidth = [...variants].sort((a, b) => (a.width || 0) - (b.width || 0));
  const vars = {
    SERVICE_NAME: config.appName,
    APP_NAME: app.name,
    FOLDER: app.slug,
    BASE_URL: config.publicUrl,
    CDN_BASE: cdnBase,
    FORMAT: { webp: 'WebP', avif: 'AVIF', jpeg: 'JPEG' }[app.format],
    FORMAT_LOWER: app.format,
    QUALITY: String(app.quality),
    MAX_MB: String(Math.min(app.maxUploadMB, config.limits.maxUploadMB)),
    MAX_MP: String(Math.round(config.limits.maxInputPixels / 1e6)),
    KEEP_ORIGINAL: app.keepOriginal
      ? 'Yes. The uploaded file is also kept privately as a backup (not public).'
      : 'No. Only the optimized sizes are stored.',
    RATE: String(config.limits.apiRatePerMin),
    VARIANTS_TABLE: ['| Size | Box (px) | Fit | Result |', '| --- | --- | --- | --- |', ...variants.map(describe)].join('\n'),
    EXAMPLE_RESPONSE: JSON.stringify(sample, null, 2),
    DOC_LIST: 'PDF, Word, Excel, PowerPoint, CSV or text',
    DOCUMENTS: documentsOn
      ? 'PDF, DOCX, DOC, XLSX, XLS, PPTX, PPT, CSV, TXT'
      : 'None. This app takes images only.',
    ARCHIVES: app.allowArchives === true
      ? 'ZIP. The archive is stored and listed, never unpacked.'
      : 'None. ZIP uploads answer `415 archives_disabled`.',
    DOCUMENTS_INTRO: documentsOn
      ? 'Same endpoint, same fields. A document is stored as it arrives instead of being resized, and comes back with one URL and a summary of what is inside it.'
      : 'This app is set to images only, so document uploads answer `415 documents_disabled`. Turn them on in the dashboard under Sizes and format.',
    DOCUMENT_RESPONSE: JSON.stringify(sampleDocument, null, 2),
    V_SMALL: byWidth[0].name,
    V_LARGE: byWidth[byWidth.length - 1].name,
    DATE: new Date().toISOString().slice(0, 10),
  };

  return TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (match, name) => (name in vars ? vars[name] : match));
}

module.exports = { buildDocs };
