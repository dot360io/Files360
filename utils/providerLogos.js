/**
 * Provider marks for the storage pages: <%- logo('hetzner') %>
 *
 * Each provider's real icon is used when public/img/providers/<id>.(svg|png|webp)
 * exists — run `npm run fetch-logos` to download them, or drop your own file
 * there. Anything without a file falls back to a simplified mark drawn here in
 * the provider's brand colour. The directory is read at startup, so new files
 * need a restart.
 */
const fs = require('fs');
const path = require('path');

const OVERRIDE_DIR = path.join(__dirname, '..', 'public', 'img', 'providers');

// id -> { file, v }. The stamp lets the files be cached hard but still replaced.
const FILE_TYPES = ['svg', 'png', 'webp'];
const overrides = new Map();
try {
  for (const name of fs.readdirSync(OVERRIDE_DIR)) {
    const ext = path.extname(name).slice(1).toLowerCase();
    const id = name.slice(0, -(ext.length + 1));
    if (!FILE_TYPES.includes(ext)) continue;
    // svg beats png beats webp when a provider somehow has several
    const existing = overrides.get(id);
    if (existing && FILE_TYPES.indexOf(existing.ext) <= FILE_TYPES.indexOf(ext)) continue;
    const stat = fs.statSync(path.join(OVERRIDE_DIR, name));
    overrides.set(id, { ext, v: Math.round(stat.mtimeMs).toString(36) });
  }
} catch {
  // No override directory: the built-in marks are used
}

const MARKS = {
  hetzner:
    '<rect width="32" height="32" rx="8" fill="#D50C2D"/>' +
    '<path d="M10.4 8.5h3.7v5.7h3.8V8.5h3.7v15h-3.7v-6.2h-3.8v6.2h-3.7z" fill="#fff"/>',

  digitalocean:
    '<circle cx="18" cy="12.4" r="8" fill="none" stroke="#0080FF" stroke-width="4.8"/>' +
    '<rect x="10.2" y="19.8" width="7" height="7" fill="#0080FF"/>' +
    '<rect x="4.8" y="24.8" width="5" height="5" fill="#0080FF"/>',

  aws:
    '<rect width="32" height="32" rx="8" fill="#232F3E"/>' +
    '<path d="M5.6 12.4h2.9l1.8 5.7 1.6-5.7h2.5l1.6 5.7 1.8-5.7h2.9l-3.1 9h-2.6l-1.8-6-1.8 6h-2.6z" fill="#fff"/>' +
    '<path d="M5.8 24.6c5.8 3.6 14.6 3.6 20.4 0" stroke="#FF9900" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
    '<path d="m22.6 22.5 4 1.9-2.3 3.4" stroke="#FF9900" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',

  r2:
    '<path d="M23.9 12.9a6.7 6.7 0 0 0-12.6-2.1A5.7 5.7 0 0 0 8.4 22h15.2a4.6 4.6 0 0 0 .3-9.1Z" fill="#F6821F"/>' +
    '<path d="M8.4 22h15.2" stroke="#F6821F" stroke-width="2.4" stroke-linecap="round"/>',

  backblaze:
    '<path d="M16 2.5c.9 3.6.2 6-2.1 8.4-2.9 3-5.9 5.1-5.9 9.5A8 8 0 0 0 24 20.4c0-4-2-6-3.6-8.6-.8 1-1.2 2-1.2 2S18.6 7.9 16 2.5Z" fill="#E21E29"/>' +
    '<path d="M16 29a4.4 4.4 0 0 1-4.4-4.4c0-2.3 1.7-3.4 2.9-5 .8-1.1 1.3-2.2 1.5-3.4 1.7 2 4.4 4.3 4.4 8.4A4.4 4.4 0 0 1 16 29Z" fill="#fff" opacity=".45"/>',

  wasabi:
    '<path d="M16 2.6c5.4 5.9 8.6 10 8.6 14.6a8.6 8.6 0 1 1-17.2 0c0-4.6 3.2-8.7 8.6-14.6Z" fill="#01CD3E"/>' +
    '<path d="M11.4 17.6a4.8 4.8 0 0 0 4.8 4.8" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>',

  scaleway:
    '<rect width="32" height="32" rx="8" fill="#4F0599"/>' +
    '<rect x="8.6" y="8.6" width="6" height="14.8" rx="3" fill="#fff"/>' +
    '<rect x="17.4" y="8.6" width="6" height="6" rx="3" fill="#fff" opacity=".55"/>' +
    '<rect x="17.4" y="17.4" width="6" height="6" rx="3" fill="#fff"/>',

  minio:
    '<path d="M6.2 5.4 16 13.2l9.8-7.8v5.7L16 18.9 6.2 11.1Z" fill="#C72E49"/>' +
    '<path d="M6.2 16.6 16 24.4l9.8-7.8v5.7L16 30.1l-9.8-7.8Z" fill="#C72E49" opacity=".55"/>',

  custom:
    '<ellipse cx="16" cy="8.6" rx="10.4" ry="3.4" fill="#94A3B8"/>' +
    '<path d="M5.6 9.6h20.8l-2.3 17a2.4 2.4 0 0 1-2.4 2h-11.4a2.4 2.4 0 0 1-2.4-2Z" fill="#64748B"/>' +
    '<ellipse cx="16" cy="8.6" rx="7.2" ry="2.2" fill="#CBD5E1"/>',
};

module.exports = function logo(id, cls = '') {
  const key = String(id || '');
  const file = overrides.get(key);
  if (file) {
    return `<img class="provider-logo ${cls}" src="/public/img/providers/${key}.${file.ext}?v=${file.v}" alt="" width="32" height="32" loading="lazy">`;
  }
  const body = MARKS[key] || MARKS.custom;
  return `<svg class="provider-logo ${cls}" viewBox="0 0 32 32" fill="none" aria-hidden="true">${body}</svg>`;
};

module.exports.hasArtwork = (id) => overrides.has(String(id || ''));
