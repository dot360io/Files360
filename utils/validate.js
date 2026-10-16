const { HttpError } = require('./errors');

const FOLDER_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*){0,4}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const FITS = ['cover', 'contain', 'inside', 'outside', 'fill'];
const FORMATS = ['webp', 'avif', 'jpeg'];
const MAX_VARIANTS = 8;

// Sub folder inside the app folder, e.g. "products" or "products/2026"
function sanitizeFolder(input) {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string') throw new HttpError(400, 'invalid_folder', 'folder must be a string');
  const folder = input.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  if (!folder) return '';
  if (folder.length > 100 || !FOLDER_RE.test(folder)) {
    throw new HttpError(
      400,
      'invalid_folder',
      'folder may contain a-z, 0-9, "-" and "_", with up to 5 levels separated by "/"'
    );
  }
  return folder;
}

function sanitizeRef(input) {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string' || input.length > 120) {
    throw new HttpError(400, 'invalid_ref', 'ref must be a string of up to 120 characters');
  }
  return input.trim() || undefined;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const toArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

// Sizes come from the settings form as parallel arrays: v_name[], v_width[], v_height[], v_fit[]
function parseVariantRows(body) {
  const names = toArray(body.v_name);
  const widths = toArray(body.v_width);
  const heights = toArray(body.v_height);
  const fits = toArray(body.v_fit);

  const rows = names
    .map((name, i) => ({
      name: String(name || '').trim().toLowerCase(),
      width: String(widths[i] || '').trim(),
      height: String(heights[i] || '').trim(),
      fit: String(fits[i] || '').trim().toLowerCase(),
    }))
    .filter((r) => r.name || r.width || r.height);

  if (rows.length === 0) throw new HttpError(400, 'invalid_variants', 'Add at least one size');
  if (rows.length > MAX_VARIANTS) throw new HttpError(400, 'invalid_variants', `Use at most ${MAX_VARIANTS} sizes`);

  const seen = new Set();
  return rows.map((r, i) => {
    const label = r.name ? `Size "${r.name}"` : `Row ${i + 1}`;
    if (!/^[a-z0-9_-]{1,20}$/.test(r.name)) {
      throw new HttpError(400, 'invalid_variants', `${label}: names use a-z, 0-9, "-" or "_" (max 20)`);
    }
    if (r.name === 'original') throw new HttpError(400, 'invalid_variants', '"original" is a reserved name');
    if (seen.has(r.name)) throw new HttpError(400, 'invalid_variants', `The name "${r.name}" is used twice`);
    seen.add(r.name);

    const dims = [r.width, r.height].map((d) => {
      if (d === '') return undefined;
      const n = Number(d);
      if (!Number.isInteger(n) || n < 1 || n > 8000) {
        throw new HttpError(400, 'invalid_variants', `${label}: width and height must be whole numbers from 1 to 8000`);
      }
      return n;
    });
    if (!dims[0] && !dims[1]) throw new HttpError(400, 'invalid_variants', `${label}: set a width, a height or both`);

    const fit = r.fit || (dims[0] && dims[1] ? 'cover' : 'inside');
    if (!FITS.includes(fit)) throw new HttpError(400, 'invalid_variants', `${label}: unknown fit "${fit}"`);
    return { name: r.name, width: dims[0], height: dims[1], fit };
  });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  FITS,
  FORMATS,
  SLUG_RE,
  OBJECT_ID_RE,
  sanitizeFolder,
  sanitizeRef,
  slugify,
  clampInt,
  parseVariantRows,
  escapeRegex,
};
