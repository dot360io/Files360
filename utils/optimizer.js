const sharp = require('sharp');
const config = require('../config/env');
const createLimiter = require('./limiter');
const { HttpError } = require('./errors');

sharp.concurrency(config.limits.sharpThreads);
sharp.cache(false);

const limit = createLimiter(config.limits.maxConcurrentJobs, config.limits.maxQueue);

const INPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff', 'svg']);
const EXT = { webp: 'webp', avif: 'avif', jpeg: 'jpg' };
const MIME = { webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg' };
const ORIGINAL_EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', avif: 'avif', heif: 'heic', tiff: 'tiff', svg: 'svg' };
const ORIGINAL_MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heif: 'image/heic',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
};

async function inspect(buffer) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new HttpError(
      415,
      'unsupported_image',
      'This file is neither a readable image nor a supported document. Use JPEG, PNG, WebP, GIF, AVIF, TIFF, PDF, XLSX, DOCX or CSV'
    );
  }

  if (meta.format === 'heif' && meta.compression === 'hevc') {
    throw new HttpError(415, 'heic_not_supported', 'HEIC images are not supported. Convert to JPEG before uploading');
  }
  if (!INPUT_FORMATS.has(meta.format)) {
    throw new HttpError(
      415,
      'unsupported_format',
      `Format "${meta.format}" is not supported. Use JPEG, PNG, WebP, GIF, AVIF, TIFF or SVG`
    );
  }
  if (!meta.width || !meta.height) {
    throw new HttpError(415, 'unsupported_image', 'Could not read the image dimensions');
  }
  const pixels = meta.width * meta.height;
  if (pixels > config.limits.maxInputPixels) {
    const maxMp = Math.round(config.limits.maxInputPixels / 1e6);
    throw new HttpError(413, 'image_too_large', `Image is ${meta.width}x${meta.height}, above the ${maxMp} megapixel limit`);
  }

  // EXIF orientations 5 to 8 swap width and height once auto-rotated
  const swap = (meta.orientation || 1) >= 5;
  return {
    format: meta.format,
    width: swap ? meta.height : meta.width,
    height: swap ? meta.width : meta.height,
    pages: meta.pages || 1,
    hasAlpha: Boolean(meta.hasAlpha),
  };
}

function encoderOptions(app) {
  switch (app.format) {
    case 'avif':
      // AVIF looks as good as WebP at a much lower quality number
      return { quality: Math.max(30, app.quality - 25), effort: 4 };
    case 'jpeg':
      return { quality: app.quality, mozjpeg: true };
    default:
      return { quality: app.quality, effort: 4, smartSubsample: true };
  }
}

/**
 * A vector has no pixels of its own, so it is drawn at whatever resolution the
 * size being produced needs, rather than at its nominal one. Without this a
 * 24 px icon would stay 24 px in every size, since nothing is ever upscaled.
 */
function svgDensity(info, variant) {
  const byWidth = variant.width ? variant.width / info.width : 0;
  const byHeight = variant.height ? variant.height / info.height : 0;
  const ceiling = Math.sqrt(config.limits.maxInputPixels / (info.width * info.height));
  const scale = Math.min(Math.max(byWidth, byHeight, 1), ceiling, 20);
  return Math.max(72, Math.round(72 * scale));
}

async function renderVariant(buffer, info, app, variant) {
  const animated = info.pages > 1 && app.format === 'webp';
  const density = info.format === 'svg' ? svgDensity(info, variant) : undefined;
  let img = sharp(buffer, { limitInputPixels: config.limits.maxInputPixels, animated, density });

  if (!animated) img = img.rotate();

  const resize = { fit: variant.fit, withoutEnlargement: true };
  if (variant.width) resize.width = variant.width;
  if (variant.height) resize.height = variant.height;
  img = img.resize(resize);

  if (app.format === 'jpeg' && info.hasAlpha) img = img.flatten({ background: '#ffffff' });

  const { data, info: out } = await img
    .toFormat(app.format, encoderOptions(app))
    .toBuffer({ resolveWithObject: true });

  return {
    name: variant.name,
    fit: variant.fit,
    format: app.format,
    data,
    bytes: out.size,
    width: out.width,
    height: out.pageHeight || out.height,
  };
}

// Renders every size of the app. Runs through the queue so at most
// MAX_CONCURRENT_JOBS images are processed at the same time.
function render(buffer, info, app) {
  return limit(async () => {
    try {
      return await Promise.all(app.variants.map((v) => renderVariant(buffer, info, app, v)));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error('[optimizer]', err.message);
      throw new HttpError(422, 'processing_failed', 'The image could not be processed, it may be corrupt');
    }
  });
}

module.exports = { inspect, render, EXT, MIME, ORIGINAL_EXT, ORIGINAL_MIME, queueStats: () => limit.stats() };
