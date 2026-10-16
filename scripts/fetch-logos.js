/**
 * Downloads each provider's icon into public/img/providers/: npm run fetch-logos
 *
 * It reads the provider's home page, picks the best icon the page declares
 * (SVG first, then the largest raster), and normalises it to a 128px PNG.
 * Anything it cannot fetch keeps the built-in drawn mark, so a failure here
 * never breaks the storage pages. Restart the server to pick up new files.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const providers = require('../utils/providers');

const OUT_DIR = path.join(__dirname, '..', 'public', 'img', 'providers');
const SIZE = 128;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

async function get(url, as = 'text') {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: { 'user-agent': UA, accept: as === 'text' ? 'text/html,*/*' : 'image/*,*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (as === 'text') return res.text();
  return { buffer: Buffer.from(await res.arrayBuffer()), type: (res.headers.get('content-type') || '').split(';')[0] };
}

/** <link rel="icon|apple-touch-icon" ...> entries, best first. */
function findIcons(html, base) {
  const found = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!/\b(icon|apple-touch-icon|mask-icon)\b/i.test(rel)) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || href.startsWith('data:')) continue;

    const type = ((tag.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
    const sizes = ((tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
    const px = Math.max(0, ...(sizes.match(/\d+/g) || []).map(Number));
    const isSvg = type.includes('svg') || /\.svg(\?|$)/i.test(href);

    let url;
    try {
      url = new URL(href, base).toString();
    } catch {
      continue;
    }
    // An SVG scales to any size, so it always wins. A mask-icon is a flat
    // silhouette with no brand colour, so it ranks below a real raster icon.
    const score = isSvg ? (/mask-icon/i.test(rel) ? 500 : 10000) : px || (/apple-touch/i.test(rel) ? 180 : 32);
    found.push({ url, isSvg, score });
  }
  return found.sort((a, b) => b.score - a.score);
}

/* ---- Format sniffing ------------------------------------------------------
   Servers lie: Cloudflare serves a PNG as image/vnd.microsoft.icon at
   /favicon.ico. Decide from the bytes, never from the header or the URL. */

const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isGif = (b) => b.length > 3 && b.toString('latin1', 0, 3) === 'GIF';
const isWebp = (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
const isIco = (b) => b.length > 6 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1;
const isSvg = (b) => /^\s*(<\?xml|<!--|<svg)/i.test(b.toString('utf8', 0, 200)) && /<svg[\s>]/i.test(b.toString('utf8', 0, 4000));

/** The ICO directory entry with the most pixels. */
function bestIcoEntry(buffer) {
  const count = buffer.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    if (entry + 16 > buffer.length) break;
    const width = buffer[entry] || 256;
    const height = buffer[entry + 1] || 256;
    const size = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (!size || offset + size > buffer.length) continue;
    const area = width * height;
    if (!best || area > best.area) best = { area, data: buffer.subarray(offset, offset + size) };
  }
  return best;
}

/**
 * An ICO entry is either a whole PNG or a headerless BMP stored upside down,
 * with a 1-bit transparency mask after the colour rows. sharp reads neither,
 * so the BMP case is unpacked to raw RGBA here.
 */
function icoEntryToSharp(data) {
  if (isPng(data)) return sharp(data);
  if (data.length < 40) return null;

  const headerSize = data.readUInt32LE(0);
  const width = data.readInt32LE(4);
  // The stored height covers the colour rows and the mask rows
  const height = Math.abs(data.readInt32LE(8)) / 2;
  const bpp = data.readUInt16LE(14);
  if (width <= 0 || height <= 0 || (bpp !== 32 && bpp !== 24)) return null;

  const rowBytes = bpp === 32 ? width * 4 : ((width * 3 + 3) & ~3);
  const maskRow = ((width + 31) >> 5) * 4;
  const maskStart = headerSize + rowBytes * height;
  const pixels = Buffer.alloc(width * height * 4);
  let anyAlpha = false;

  for (let y = 0; y < height; y += 1) {
    const row = headerSize + (height - 1 - y) * rowBytes; // rows are bottom-up
    for (let x = 0; x < width; x += 1) {
      const src = row + x * (bpp === 32 ? 4 : 3);
      const dst = (y * width + x) * 4;
      if (src + 2 >= data.length) continue;
      pixels[dst] = data[src + 2];
      pixels[dst + 1] = data[src + 1];
      pixels[dst + 2] = data[src];

      let alpha = bpp === 32 ? data[src + 3] : 255;
      if (bpp === 24) {
        const maskByte = maskStart + (height - 1 - y) * maskRow + (x >> 3);
        if (maskByte < data.length && (data[maskByte] >> (7 - (x & 7))) & 1) alpha = 0;
      }
      if (alpha) anyAlpha = true;
      pixels[dst + 3] = alpha;
    }
  }

  // Some 32bpp icons leave the alpha channel empty, which would render blank
  if (!anyAlpha) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  return sharp(pixels, { raw: { width, height, channels: 4 } });
}

/** Whatever came off the wire, turned into an SVG or a square PNG. */
async function normalise(buffer) {
  if (isSvg(buffer)) return { ext: 'svg', data: buffer };

  let image = null;
  if (isIco(buffer)) {
    const entry = bestIcoEntry(buffer);
    if (entry) image = icoEntryToSharp(entry.data);
  } else if (isPng(buffer) || isJpeg(buffer) || isGif(buffer) || isWebp(buffer)) {
    image = sharp(buffer);
  }
  if (!image) return null;

  // Webclip icons are often a square canvas holding a wide logo in a sea of
  // transparency. Trimming exposes the real shape, so the aspect check below
  // can tell a square mark from a lockup. Only fully transparent pixels go,
  // which leaves icons with a solid brand background untouched.
  try {
    const meta = await image.metadata();
    if (meta.hasAlpha) {
      const trimmed = await image.clone().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 }).png().toBuffer();
      if (trimmed && trimmed.length) image = sharp(trimmed);
    }
  } catch {
    // Nothing to trim, or an all-transparent image: keep the original
  }

  const data = await image
    .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const meta = await sharp(data).metadata();
  return { ext: 'png', data, width: meta.width, height: meta.height };
}

async function grab(provider) {
  const candidates = [];
  try {
    const html = await get(provider.site);
    candidates.push(...findIcons(html, provider.site));
  } catch (err) {
    console.log(`      home page unreadable (${err.message}), trying the usual paths`);
  }
  const origin = new URL(provider.site).origin;
  candidates.push(
    { url: `${origin}/favicon.svg`, isSvg: true, score: 1 },
    { url: `${origin}/apple-touch-icon.png`, isSvg: false, score: 1 },
    { url: `${origin}/favicon.ico`, isSvg: false, score: 0 }
  );

  const seen = new Set();
  const found = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    try {
      const { buffer } = await get(candidate.url, 'binary');
      if (!buffer.length) continue;
      const result = await normalise(buffer);
      if (!result) continue;
      // A vector scales to any size, so nothing beats it
      if (result.ext === 'svg') return { ...result, from: candidate.url };
      found.push({ ...result, from: candidate.url });
    } catch {
      // Try the next candidate
    }
  }
  if (!found.length) return null;

  // Sites offer both a compact mark and a wide logo lockup. The lockup reads as
  // a sliver in a square tile, so shape counts for more than resolution here.
  const score = (r) => {
    const ratio = r.width / r.height;
    const squareness = 1 / Math.max(ratio, 1 / ratio);
    return squareness * squareness * Math.sqrt(r.width * r.height);
  };
  found.sort((a, b) => score(b) - score(a));
  const best = found[0];
  best.wide = best.width / best.height > 1.7 || best.height / best.width > 1.7;
  return best;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = providers.PROVIDERS.filter((p) => p.site && (only.length === 0 || only.includes(p.id)));
  let ok = 0;

  for (const provider of targets) {
    process.stdout.write(`${provider.id.padEnd(14)} `);
    const result = await grab(provider);
    if (!result) {
      console.log('no usable icon found, keeping the built-in mark');
      continue;
    }
    // Only one file per provider, so a png never shadows an older svg
    for (const ext of ['svg', 'png', 'webp']) {
      const stale = path.join(OUT_DIR, `${provider.id}.${ext}`);
      if (ext !== result.ext && fs.existsSync(stale)) fs.unlinkSync(stale);
    }
    fs.writeFileSync(path.join(OUT_DIR, `${provider.id}.${result.ext}`), result.data);
    ok += 1;
    const dims = result.width ? `${result.width}x${result.height}`.padEnd(8) : 'vector  ';
    console.log(
      `${result.ext.toUpperCase().padEnd(4)} ${dims} ${String(Math.round(result.data.length / 102.4) / 10).padStart(6)} KB  ${result.wide ? '(non-square) ' : ''}${result.from}`
    );
  }

  console.log(`\n${ok}/${targets.length} saved to public/img/providers. Restart the server to use them.`);
})();
