const config = require('../config/env');

function bytes(n) {
  if (!n || n < 1) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function date(d) {
  if (!d) return 'Never';
  return new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timezone });
}

function ago(d) {
  if (!d) return 'Never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'Just now';
  const units = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, name] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'Just now';
}

// Percentage reduction of b compared to a
function reduction(a, b) {
  if (!a) return 0;
  return Math.max(0, Math.round((1 - b / a) * 100));
}

const number = (n) => new Intl.NumberFormat('en-GB').format(n || 0);

function initials(name) {
  const words = String(name || '?').replace(/[^\p{L}\p{N}\s.]/gu, ' ').split(/[\s.]+/).filter(Boolean);
  const first = words[0] || '?';
  const second = words[1] && !/^\d+$/.test(words[1]) ? words[1][0] : first[1] || '';
  return (first[0] + second).toUpperCase();
}

// Stable color per app for avatars
function hue(value) {
  let h = 0;
  for (const ch of String(value)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Smallest size that shows the whole image, for thumbnails
function thumbOf(variants) {
  const sorted = [...(variants || [])].sort((a, b) => a.width - b.width);
  return sorted.find((v) => v.fit !== 'cover' && v.fit !== 'fill') || sorted[0];
}

function largestOf(variants) {
  const sorted = [...(variants || [])].sort((a, b) => a.width - b.width);
  return sorted[sorted.length - 1];
}

const FORMAT_NAMES = {
  webp: 'WebP',
  avif: 'AVIF',
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  heif: 'HEIF',
  tiff: 'TIFF',
  svg: 'SVG',
  pdf: 'PDF',
  xlsx: 'XLSX',
  xls: 'XLS',
  docx: 'DOCX',
  doc: 'DOC',
  pptx: 'PPTX',
  ppt: 'PPT',
  csv: 'CSV',
  txt: 'TXT',
  zip: 'ZIP',
};

const formatName = (f) => FORMAT_NAMES[f] || String(f || '').toUpperCase();

/* ---------- documents ---------- */

// Badge, full name, icon and colour of every document format
const DOCUMENTS = {
  pdf: { badge: 'PDF', name: 'PDF document', icon: 'filePdf', tone: 'pdf' },
  xlsx: { badge: 'XLSX', name: 'Excel spreadsheet', icon: 'fileSheet', tone: 'sheet' },
  xls: { badge: 'XLS', name: 'Excel 97-2003 workbook', icon: 'fileSheet', tone: 'sheet' },
  csv: { badge: 'CSV', name: 'CSV table', icon: 'fileSheet', tone: 'sheet' },
  docx: { badge: 'DOCX', name: 'Word document', icon: 'fileText', tone: 'doc' },
  doc: { badge: 'DOC', name: 'Word 97-2003 document', icon: 'fileText', tone: 'doc' },
  pptx: { badge: 'PPTX', name: 'PowerPoint presentation', icon: 'fileSlides', tone: 'slides' },
  ppt: { badge: 'PPT', name: 'PowerPoint 97-2003 presentation', icon: 'fileSlides', tone: 'slides' },
  txt: { badge: 'TXT', name: 'Text file', icon: 'fileText', tone: 'text' },
  zip: { badge: 'ZIP', name: 'ZIP archive', icon: 'fileArchive', tone: 'archive' },
};

const isDocument = (asset) => Boolean(asset) && asset.kind === 'document';

const documentType = (format) =>
  DOCUMENTS[format] || { badge: formatName(format) || 'FILE', name: 'File', icon: 'file', tone: 'file' };

/** The URL to copy or open for an asset: the document itself, or its largest size. */
function assetUrl(asset) {
  if (isDocument(asset)) return asset.file ? asset.file.url : null;
  const largest = largestOf(asset.variants);
  return largest ? largest.url : null;
}

/** The image to show as a thumbnail, or null for anything without one. */
function assetThumb(asset) {
  if (isDocument(asset)) return null;
  return thumbOf(asset.variants);
}

function assetBadge(asset) {
  if (isDocument(asset)) return documentType(asset.input.format).badge;
  // A vector says so, rather than naming the raster it was turned into
  if (asset.input && asset.input.format === 'svg') return 'SVG';
  const largest = largestOf(asset.variants);
  return formatName(largest ? largest.format : '');
}

/** True for an image that also has its source vector stored. */
const hasVector = (asset) => !isDocument(asset) && Boolean(asset.file && asset.file.url);

/** The short line under a file name: pixels for images, pages or rows for documents. */
function assetDetail(asset) {
  if (!isDocument(asset)) return `${asset.input.width}×${asset.input.height}`;
  const preview = asset.preview || {};
  if (preview.pages) return `${number(preview.pages)} ${preview.pages === 1 ? 'page' : 'pages'}`;
  if (preview.slideCount) return `${number(preview.slideCount)} ${preview.slideCount === 1 ? 'slide' : 'slides'}`;
  if (preview.rowCount) return `${number(preview.rowCount)} ${preview.rowCount === 1 ? 'row' : 'rows'}`;
  if (preview.entryCount) return `${number(preview.entryCount)} ${preview.entryCount === 1 ? 'file' : 'files'}`;
  if (preview.lineCount) return `${number(preview.lineCount)} ${preview.lineCount === 1 ? 'line' : 'lines'}`;
  if (preview.words) return `${number(preview.words)} words`;
  if (preview.blockCount) return `${number(preview.blockCount)} ${preview.blockCount === 1 ? 'paragraph' : 'paragraphs'}`;
  return documentType(asset.input.format).name;
}

/** One line under a file name: pages, rows or paragraphs, whatever it has. */
function previewSummary(asset) {
  const preview = asset.preview;
  if (!preview) return null;
  const parts = [];
  if (preview.pages) parts.push(`${number(preview.pages)} ${preview.pages === 1 ? 'page' : 'pages'}`);
  if (preview.rowCount) parts.push(`${number(preview.rowCount)} ${preview.rowCount === 1 ? 'row' : 'rows'}`);
  if (preview.colCount) parts.push(`${number(preview.colCount)} ${preview.colCount === 1 ? 'column' : 'columns'}`);
  if (preview.sheets && preview.sheets.length > 1) parts.push(`${preview.sheets.length} sheets`);
  if (preview.words) parts.push(`${number(preview.words)} words`);
  if (preview.blockCount) parts.push(`${number(preview.blockCount)} ${preview.blockCount === 1 ? 'paragraph' : 'paragraphs'}`);
  if (preview.tables) parts.push(`${number(preview.tables)} ${preview.tables === 1 ? 'table' : 'tables'}`);
  if (preview.slideCount) parts.push(`${number(preview.slideCount)} ${preview.slideCount === 1 ? 'slide' : 'slides'}`);
  if (preview.lineCount) parts.push(`${number(preview.lineCount)} ${preview.lineCount === 1 ? 'line' : 'lines'}`);
  if (preview.entryCount) {
    parts.push(`${number(preview.entryCount)} ${preview.entryCount === 1 ? 'file' : 'files'}`);
    if (preview.totalBytes) parts.push(`${bytes(preview.totalBytes)} unpacked`);
  }
  return parts.join(', ') || null;
}

module.exports = {
  bytes,
  date,
  ago,
  reduction,
  number,
  initials,
  hue,
  thumbOf,
  largestOf,
  formatName,
  isDocument,
  hasVector,
  documentType,
  assetUrl,
  assetThumb,
  assetBadge,
  assetDetail,
  previewSummary,
};
