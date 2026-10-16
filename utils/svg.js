/**
 * SVG is XML, and XML that a browser will happily run scripts from when the
 * file is opened directly. Everything uploaded is rewritten through this
 * allowlist before it is stored or rasterized: only known drawing elements
 * and attributes survive, links may only point inside the document, and
 * anything that could reach the network or the file system is dropped.
 */

// Drawing elements, the gradient and filter machinery, nothing that loads or runs
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'title', 'desc', 'style', 'image',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'marker', 'pattern', 'mask', 'clippath',
  'lineargradient', 'radialgradient', 'stop',
  'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite',
  'feflood', 'femerge', 'femergenode', 'femorphology', 'fedropshadow', 'feturbulence',
  'fedisplacementmap', 'fetile', 'fepointlight', 'fespotlight', 'fedistantlight',
  'fediffuselighting', 'fespecularlighting', 'fefunca', 'fefuncr', 'fefuncg', 'fefuncb',
  'fecomponenttransfer',
]);

// Elements whose children go with them, rather than being pulled up
const WITH_CHILDREN = new Set(['script', 'foreignobject', 'metadata', 'iframe', 'object', 'embed', 'video', 'audio', 'handler', 'set', 'animate', 'animatetransform', 'animatemotion']);

// <a> is a link, but its children are ordinary drawing, so it becomes a group
const RENAMED = { a: 'g' };

const CASE_SENSITIVE = [
  'viewBox', 'preserveAspectRatio', 'baseProfile', 'clipPath', 'clipPathUnits', 'gradientTransform',
  'gradientUnits', 'patternContentUnits', 'patternTransform', 'patternUnits', 'maskContentUnits',
  'maskUnits', 'markerHeight', 'markerUnits', 'markerWidth', 'primitiveUnits', 'refX', 'refY',
  'spreadMethod', 'startOffset', 'stdDeviation', 'stopColor', 'stopOpacity', 'textLength',
  'lengthAdjust', 'pathLength', 'requiredFeatures', 'systemLanguage', 'baseFrequency',
  'numOctaves', 'specularExponent', 'surfaceScale', 'diffuseConstant', 'kernelMatrix',
  'tableValues', 'xChannelSelector', 'yChannelSelector', 'filterUnits', 'colorInterpolationFilters',
];
const CANONICAL = new Map(CASE_SENSITIVE.map((name) => [name.toLowerCase(), name]));

const ELEMENT_CASE = new Map(
  [
    'clipPath', 'linearGradient', 'radialGradient', 'textPath', 'feGaussianBlur', 'feOffset', 'feBlend',
    'feColorMatrix', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode', 'feMorphology', 'feDropShadow',
    'feTurbulence', 'feDisplacementMap', 'feTile', 'fePointLight', 'feSpotLight', 'feDistantLight',
    'feDiffuseLighting', 'feSpecularLighting', 'feFuncA', 'feFuncR', 'feFuncG', 'feFuncB',
    'feComponentTransfer',
  ].map((name) => [name.toLowerCase(), name])
);

const SAFE_HREF = /^#[^\s"'<>]*$/;
const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

class SvgError extends Error {}

/** Does this look like an SVG file rather than a raster image? */
function looksLikeSvg(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const head = buffer.subarray(0, 4096).toString('latin1').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<svg') || /^<svg[\s>]/i.test(head)) return true;
  // An XML declaration or a doctype may come first
  return /^<(\?xml|!doctype svg)[\s>]/i.test(head) && /<svg[\s>]/i.test(head);
}

function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return buffer.toString('latin1');
  }
}

const escapeText = (text) => text.replace(/[<>]/g, (ch) => (ch === '<' ? '&lt;' : '&gt;'));
const escapeAttr = (value) => value.replace(/[<>"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// url(...) may only point inside the document, and no CSS may fetch anything
function cleanStyle(css) {
  return css
    .replace(/@import[^;}]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'void(')
    .replace(/-moz-binding[^;}]*;?/gi, '')
    .replace(/behavior\s*:[^;}]*;?/gi, '')
    .replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (match, quote, target) => {
      const value = target.trim();
      return SAFE_HREF.test(value) || SAFE_IMAGE.test(value) ? match : 'none';
    })
    .replace(/javascript\s*:/gi, 'void:');
}

function cleanAttributes(tag, element, dropped) {
  const pattern = /([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  const out = [];

  for (const match of tag.matchAll(pattern)) {
    const raw = match[1];
    const name = raw.toLowerCase();
    const value = (match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] || '').trim();

    if (name.startsWith('on')) {
      dropped.add(raw);
      continue;
    }
    if (name === 'href' || name === 'xlink:href' || name === 'src') {
      const isImage = element === 'image' || element === 'feimage';
      const ok = isImage ? SAFE_IMAGE.test(value) : SAFE_HREF.test(value) || SAFE_IMAGE.test(value);
      if (!ok) {
        dropped.add(raw);
        continue;
      }
    }
    if (/^(javascript|data\s*:\s*text|vbscript)/i.test(value.replace(/\s/g, ''))) {
      dropped.add(raw);
      continue;
    }
    if (name === 'style') {
      out.push(`style="${escapeAttr(cleanStyle(value))}"`);
      continue;
    }
    // XML is case sensitive, so attributes keep the spelling SVG expects
    const canonical = CANONICAL.get(name) || raw;
    out.push(`${canonical}="${escapeAttr(value)}"`);
  }
  return out;
}

/**
 * Rewrites an SVG with only allowlisted elements and attributes.
 * Returns the cleaned source and what was taken out.
 */
function sanitize(buffer) {
  const source = decode(buffer);
  if (!/<svg[\s>]/i.test(source)) throw new SvgError('The file does not contain an <svg> element');

  let out = '';
  let at = 0;
  let dropName = null;
  let dropDepth = 0;
  let inStyle = false;
  let roots = 0;
  const removedElements = new Set();
  const removedAttributes = new Set();

  while (at < source.length) {
    const lt = source.indexOf('<', at);
    if (lt === -1) {
      if (!dropName) out += escapeText(source.slice(at));
      break;
    }
    if (!dropName) {
      const text = source.slice(at, lt);
      out += inStyle ? cleanStyle(text) : escapeText(text);
    }

    // Comments, CDATA, doctypes with their entity declarations, and processing
    // instructions are all dropped: none of them are needed to draw anything
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      at = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt);
      removedElements.add('CDATA');
      at = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt)) {
      let end = lt;
      let depth = 0;
      while (end < source.length) {
        const ch = source[end];
        if (ch === '[') depth += 1;
        else if (ch === ']') depth -= 1;
        else if (ch === '>' && depth <= 0) break;
        end += 1;
      }
      if (/^<!doctype/i.test(source.slice(lt, lt + 9))) removedElements.add('DOCTYPE');
      at = end + 1;
      continue;
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt);
      at = end === -1 ? source.length : end + 2;
      continue;
    }

    // Read the whole tag, honouring quotes so a ">" inside a value is not an end
    let end = lt + 1;
    let quote = null;
    while (end < source.length) {
      const ch = source[end];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      end += 1;
    }
    const tag = source.slice(lt, Math.min(end + 1, source.length));
    at = end + 1;

    const parsed = /^<\s*(\/?)\s*([a-z_][-a-z0-9_:.]*)/i.exec(tag);
    if (!parsed) continue;
    const closing = parsed[1] === '/';
    const name = parsed[2].toLowerCase().replace(/^svg:/, '');
    const selfClosing = /\/\s*>$/.test(tag);

    if (dropName) {
      if (name === dropName) {
        if (closing) {
          dropDepth -= 1;
          if (dropDepth <= 0) dropName = null;
        } else if (!selfClosing) dropDepth += 1;
      }
      continue;
    }

    const renamed = RENAMED[name] || name;
    if (!ELEMENTS.has(renamed)) {
      removedElements.add(name);
      // Children of a script or a foreignObject go with it; for anything else
      // unknown the children are kept, which preserves odd but harmless wrappers
      if (!closing && !selfClosing && WITH_CHILDREN.has(name)) {
        dropName = name;
        dropDepth = 1;
      }
      continue;
    }

    const printable = ELEMENT_CASE.get(renamed) || renamed;
    if (closing) {
      if (renamed === 'style') inStyle = false;
      out += `</${printable}>`;
      continue;
    }

    if (renamed === 'svg') roots += 1;
    if (renamed === 'style' && !selfClosing) inStyle = true;

    const attributes = cleanAttributes(tag, renamed, removedAttributes);
    out += `<${printable}${attributes.length ? ` ${attributes.join(' ')}` : ''}${selfClosing ? '/>' : '>'}`;
  }

  if (!roots) throw new SvgError('The file has no usable <svg> element after cleaning');

  return {
    svg: Buffer.from(out.trim(), 'utf8'),
    removed: {
      elements: [...removedElements].sort(),
      attributes: [...removedAttributes].sort(),
    },
  };
}

module.exports = { looksLikeSvg, sanitize, SvgError };
