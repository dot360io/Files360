const zip = require('./zip');
const cfb = require('./cfb');
const { HttpError } = require('./errors');

/**
 * Documents and archives next to images.
 *
 * They are stored as uploaded, without any processing, and every one gets a
 * small preview that is read once at upload time and kept on the record:
 *  - PDF             the browser renders the file itself, so only page count is read
 *  - XLSX, CSV       first rows
 *  - DOCX, TXT       first paragraphs or lines
 *  - PPTX            text of the first slides
 *  - ZIP             the list of what is inside, never extracted
 *  - DOC, XLS, PPT   title, author and counts from the document properties
 *
 * Nothing here needs a native dependency. The 2007 and later Office formats
 * are ZIP archives of XML (utils/zip.js) and the older ones are compound
 * files (utils/cfb.js), whose bodies are left alone: parsing BIFF records or
 * Word piece tables would be a project of its own for very little gain.
 */

const TYPES = {
  pdf: {
    format: 'pdf',
    ext: 'pdf',
    mime: 'application/pdf',
    label: 'PDF document',
    preview: 'pdf',
    // Browsers show PDFs in place, the rest are downloads
    disposition: 'inline',
  },
  xlsx: {
    format: 'xlsx',
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel spreadsheet',
    preview: 'sheet',
    disposition: 'attachment',
  },
  docx: {
    format: 'docx',
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word document',
    preview: 'text',
    disposition: 'attachment',
  },
  csv: {
    format: 'csv',
    ext: 'csv',
    mime: 'text/csv; charset=utf-8',
    label: 'CSV table',
    preview: 'sheet',
    disposition: 'attachment',
  },
  pptx: {
    format: 'pptx',
    ext: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PowerPoint presentation',
    preview: 'slides',
    disposition: 'attachment',
  },
  txt: {
    format: 'txt',
    ext: 'txt',
    mime: 'text/plain; charset=utf-8',
    label: 'Text file',
    preview: 'plain',
    disposition: 'inline',
  },
  doc: {
    format: 'doc',
    ext: 'doc',
    mime: 'application/msword',
    label: 'Word 97-2003 document',
    preview: 'meta',
    disposition: 'attachment',
  },
  xls: {
    format: 'xls',
    ext: 'xls',
    mime: 'application/vnd.ms-excel',
    label: 'Excel 97-2003 workbook',
    preview: 'meta',
    disposition: 'attachment',
  },
  ppt: {
    format: 'ppt',
    ext: 'ppt',
    mime: 'application/vnd.ms-powerpoint',
    label: 'PowerPoint 97-2003 presentation',
    preview: 'meta',
    disposition: 'attachment',
  },
  zip: {
    format: 'zip',
    ext: 'zip',
    mime: 'application/zip',
    label: 'ZIP archive',
    preview: 'list',
    disposition: 'attachment',
    // Archives are gated by their own per-app switch
    archive: true,
  },
};

const FORMATS = Object.keys(TYPES);
const ARCHIVE_FORMATS = FORMATS.filter((f) => TYPES[f].archive);
const DOCUMENT_FORMATS = FORMATS.filter((f) => !TYPES[f].archive);

// A preview is stored on the record, so it stays small on purpose
const LIMITS = {
  rows: 40,
  cols: 15,
  cell: 140,
  blocks: 60,
  chars: 6000,
  lines: 60,
  line: 200,
  slides: 20,
  slideLines: 12,
  entries: 80,
  text: 6 * 1024 * 1024,
  bytes: 96_000,
};

/* ---------- detection ---------- */

const unsupported = (message) => new HttpError(415, 'unsupported_document', message);

function extensionOf(name) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, i) => buffer[i] === byte);
}

// Text is anything without NUL bytes and without a pile of control characters
function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 4096);
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control <= sample.length * 0.02;
}

function readOffice(buffer) {
  let archive;
  try {
    archive = zip.open(buffer);
  } catch {
    throw unsupported('The file looks like a ZIP archive but could not be read');
  }
  if (archive.has('xl/vbaProject.bin') || archive.has('word/vbaProject.bin')) {
    throw unsupported('Macro-enabled Office files are not accepted. Save the file as .xlsx, .docx or PDF');
  }
  if (archive.has('xl/workbook.xml')) return { type: TYPES.xlsx, source: archive };
  if (archive.has('word/document.xml')) return { type: TYPES.docx, source: archive };
  if (archive.has('ppt/presentation.xml')) return { type: TYPES.pptx, source: archive };

  // An OpenDocument file is a ZIP too, but storing it under a .zip name would
  // leave the owner with something their office suite no longer opens
  const odf = archive.has('mimetype') ? (archive.text('mimetype', 256) || '') : '';
  if (odf.includes('opendocument')) {
    throw unsupported('OpenDocument files are not supported. Save as .xlsx, .docx, .pptx or PDF');
  }
  return { type: TYPES.zip, source: archive };
}

const LEGACY_STREAMS = [
  ['WordDocument', TYPES.doc],
  ['Workbook', TYPES.xls],
  ['Book', TYPES.xls],
  ['PowerPoint Document', TYPES.ppt],
];

function readLegacy(buffer) {
  let container;
  try {
    container = cfb.open(buffer);
  } catch {
    throw unsupported('The file looks like an old Office document but could not be read');
  }
  for (const [stream, type] of LEGACY_STREAMS) {
    if (container.has(stream)) return { type, source: container };
  }
  throw unsupported('This is an old Office container we cannot identify. Save it as .docx, .xlsx, .pptx or PDF');
}

/**
 * What kind of file this is, read from its bytes rather than its name.
 * Returns null for anything that should go through the image pipeline,
 * and throws for formats that are recognised but not supported.
 */
function detect(buffer, originalName, declaredMime) {
  if (!buffer || buffer.length < 4) return null;
  const ext = extensionOf(originalName);
  const mime = String(declaredMime || '').toLowerCase().split(';')[0].trim();

  // The header is allowed a little junk in front, which some writers leave behind
  if (buffer.subarray(0, 1024).includes('%PDF-')) return { type: TYPES.pdf };

  if (zip.looksLikeZip(buffer)) return readOffice(buffer);

  if (cfb.looksLikeCfb(buffer)) return readLegacy(buffer);

  if (looksLikeText(buffer)) {
    const saysCsv = ext === 'csv' || ext === 'tsv' || mime === 'text/csv' || mime === 'application/csv';
    if (saysCsv) return { type: TYPES.csv };
    // Plain text is only taken when the name or the sender says so: an
    // unknown extension still belongs to the image pipeline and its checks
    const saysText = ext === 'txt' || ext === 'text' || ext === 'log' || ext === 'md' || mime === 'text/plain';
    if (saysText) return { type: TYPES.txt };
  }
  return null;
}

/** File name inside the bucket: keeps the original name, minus surprises. */
function safeFileName(originalName, ext) {
  const withoutPath = String(originalName || '').split(/[\\/]/).pop();
  const base = withoutPath
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 60);
  return `${base || 'file'}.${ext}`;
}

/* ---------- small XML helpers ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeXml(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(point) || point <= 0 || point > 0x10ffff) return '';
      try {
        return String.fromCodePoint(point);
      } catch {
        return '';
      }
    }
    const name = code.toLowerCase();
    return name in ENTITIES ? ENTITIES[name] : match;
  });
}

/** <name ...>captured</name>, never matching the self-closing <name/> form. */
function tagPattern(name, global = true) {
  return new RegExp(`<${name}\\b(?![^>]*/>)[^>]*>([\\s\\S]*?)</${name}>`, global ? 'g' : '');
}

// Every bit of text inside a fragment, e.g. the runs of one shared string
function textOf(fragment) {
  let text = '';
  for (const run of fragment.matchAll(tagPattern('t'))) text += decodeXml(run[1]);
  return text;
}

function attr(tag, name) {
  const match = new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]) : null;
}

const clip = (value, max = LIMITS.cell) => {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function decodeText(buffer) {
  const bytes = buffer.subarray(0, LIMITS.text);
  let text;
  let encoding = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Spreadsheet exports are still full of windows-1252
    try {
      text = new TextDecoder('windows-1252').decode(bytes);
      encoding = 'windows-1252';
    } catch {
      text = bytes.toString('latin1');
      encoding = 'latin-1';
    }
  }
  return {
    text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
    encoding,
    clipped: buffer.length > LIMITS.text,
  };
}

/* ---------- CSV ---------- */

const DELIMITERS = [',', ';', '\t', '|'];

// The delimiter that appears most often outside quotes in the first lines
function sniffDelimiter(text) {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 20; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '\n') lines += 1;
    else if (counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  let best = ',';
  for (const [delimiter, count] of counts) {
    if (count > counts.get(best)) best = delimiter;
  }
  return counts.get(best) > 0 ? best : ',';
}

// Squares the table off on the widest row that actually holds something
function square(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (const row of rows) {
    while (row.length < width) row.push('');
  }
  return width;
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let cells = 0;
  let touched = false;
  let rowCount = 0;
  let colCount = 0;

  const endCell = () => {
    cells += 1;
    if (row.length < LIMITS.cols) row.push(clip(cell));
    cell = '';
  };
  const endRow = () => {
    endCell();
    colCount = Math.max(colCount, cells);
    rowCount += 1;
    if (rows.length < LIMITS.rows) rows.push(row);
    row = [];
    cells = 0;
    touched = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      touched = true;
    } else if (ch === delimiter) {
      endCell();
      touched = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      // Blank lines, including the one after the last row, are not rows
      if (touched || cell !== '') endRow();
    } else {
      cell += ch;
      touched = true;
    }
  }
  if (touched || cell !== '') endRow();

  return { rows, rowCount, colCount };
}

// A first row of short, non numeric labels is almost always a header
function looksLikeHeader(rows) {
  if (rows.length < 2) return false;
  const first = [...rows[0]];
  while (first.length && first[first.length - 1] === '') first.pop();
  if (first.length < 2 || first.some((c) => c === '')) return false;
  const numeric = first.filter((c) => /^[-+]?[\d\s.,%€$]+$/.test(c)).length;
  return numeric * 2 <= first.length;
}

function previewCsv(buffer) {
  const { text, encoding, clipped } = decodeText(buffer);
  const delimiter = sniffDelimiter(text);
  const { rows, rowCount, colCount } = parseDelimited(text, delimiter);
  const width = square(rows);
  const notes = [];
  if (clipped) notes.push('only the first few MB were read');
  if (encoding !== 'utf-8') notes.push(`decoded as ${encoding}`);

  return {
    kind: 'sheet',
    rows,
    header: looksLikeHeader(rows),
    rowCount: clipped ? null : rowCount,
    colCount,
    truncated: clipped || rows.length < rowCount || colCount > width,
    delimiter: delimiter === '\t' ? 'tab' : delimiter,
    note: notes.join(', ') || null,
  };
}

/* ---------- XLSX ---------- */

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormat(code) {
  if (!code) return false;
  const bare = code
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '');
  return /[ymdhs]/i.test(bare);
}

// Excel stores dates as days since its epoch, with a phantom 29 February 1900
function serialToText(serial, is1904, withTime) {
  let days = Math.floor(serial);
  const fraction = serial - days;
  if (!is1904 && days < 61) days += 1;
  const epoch = is1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const at = new Date(epoch + days * 86_400_000 + Math.round(fraction * 86_400) * 1000);
  if (Number.isNaN(at.getTime())) return String(serial);

  const iso = at.toISOString();
  if (serial < 1) return iso.slice(11, 19);
  return withTime || fraction > 0 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function tidyNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  // 0.30000000000000004 and friends, straight from the file
  return String(value).length > 12 ? String(Number(n.toPrecision(12))) : String(value);
}

function readSharedStrings(archive) {
  const xml = archive.text('xl/sharedStrings.xml');
  if (!xml) return [];
  const strings = [];
  // The self-closing form comes first: an empty <si/> still holds an index
  for (const item of xml.matchAll(/<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    strings.push(item[1] === undefined ? '' : textOf(item[1]));
  }
  return strings;
}

// Cell style index -> is this style a date format
function readDateStyles(archive) {
  const xml = archive.text('xl/styles.xml');
  if (!xml) return [];
  const custom = new Map();
  for (const format of xml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const id = Number(attr(format[0], 'numFmtId'));
    if (Number.isFinite(id)) custom.set(id, attr(format[0], 'formatCode') || '');
  }
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!block) return [];
  return [...block[1].matchAll(/<xf\b[^>]*>/g)].map((xf) => {
    const id = Number(attr(xf[0], 'numFmtId'));
    if (!Number.isFinite(id)) return false;
    return custom.has(id) ? isDateFormat(custom.get(id)) : BUILTIN_DATE_FORMATS.has(id);
  });
}

function sheetPath(archive, relationId) {
  const rels = archive.text('xl/_rels/workbook.xml.rels') || '';
  for (const rel of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    if (attr(rel[0], 'Id') !== relationId) continue;
    const target = attr(rel[0], 'Target') || '';
    if (!target) break;
    const full = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    // Targets may walk up out of xl/, e.g. ../worksheets/sheet1.xml
    const parts = [];
    for (const part of full.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }
  return null;
}

// A1 -> 0, B1 -> 1, AA1 -> 26
function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(String(ref || '').toUpperCase());
  if (!letters) return null;
  let index = 0;
  for (const letter of letters[1]) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function cellText(tag, inner, shared, dateStyles, is1904) {
  const type = attr(tag, 't') || 'n';
  if (type === 'inlineStr') return textOf(inner);

  const value = tagPattern('v', false).exec(inner);
  if (!value) return '';
  const raw = decodeXml(value[1]);

  if (type === 's') {
    const index = Number(raw);
    return Number.isInteger(index) && shared[index] !== undefined ? shared[index] : '';
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (type === 'str' || type === 'e' || type === 'd') return raw;

  const style = Number(attr(tag, 's'));
  const serial = Number(raw);
  if (Number.isFinite(serial) && dateStyles[style]) return serialToText(serial, is1904, false);
  return tidyNumber(raw);
}

function previewXlsx(archive) {
  const workbook = archive.text('xl/workbook.xml');
  if (!workbook) throw new zip.ZipError('the workbook is missing xl/workbook.xml');

  const is1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].map((sheet) => ({
    name: attr(sheet[0], 'name') || 'Sheet',
    id: attr(sheet[0], 'r:id'),
    hidden: Boolean(attr(sheet[0], 'state')) && attr(sheet[0], 'state') !== 'visible',
  }));

  const chosen = sheets.find((s) => !s.hidden) || sheets[0];
  const names = sheets.map((s) => s.name);
  const path =
    (chosen && chosen.id && sheetPath(archive, chosen.id)) ||
    archive.names().find((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name));

  const xml = path ? archive.text(path) : null;
  if (!xml) throw new zip.ZipError('the first worksheet could not be read');

  const shared = readSharedStrings(archive);
  const dateStyles = readDateStyles(archive);
  const rowCount = (xml.match(/<row[\s>]/g) || []).length;

  const rows = [];
  let colCount = 0;
  for (const rowMatch of xml.matchAll(/<row\b[^>]*\/>|<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    let widest = 0;
    for (const cellMatch of (rowMatch[1] || '').matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const selfClosing = cellMatch[1] !== undefined;
      const tag = selfClosing ? cellMatch[1] : cellMatch[2];
      const inner = selfClosing ? '' : cellMatch[3];
      const at = columnIndex(attr(tag, 'r'));
      const index = at === null ? cells.length : at;
      widest = Math.max(widest, index + 1);
      if (index >= LIMITS.cols) continue;
      while (cells.length < index) cells.push('');
      cells[index] = selfClosing ? '' : clip(cellText(tag, inner, shared, dateStyles, is1904));
    }
    colCount = Math.max(colCount, widest);
    rows.push(cells);
    if (rows.length >= LIMITS.rows) break;
  }

  const width = square(rows);

  return {
    kind: 'sheet',
    rows,
    header: looksLikeHeader(rows),
    rowCount,
    colCount,
    sheets: names,
    sheet: chosen ? chosen.name : null,
    truncated: rows.length < rowCount || colCount > width,
    note: null,
  };
}

/* ---------- DOCX ---------- */

function headingLevel(paragraph) {
  const style = /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(paragraph);
  if (!style) return 0;
  const name = style[1].toLowerCase();
  if (name === 'title') return 1;
  const heading = /^heading\s?([1-6])$/.exec(name);
  return heading ? Math.min(3, Number(heading[1])) : 0;
}

function paragraphText(paragraph) {
  let text = '';
  const runs = /<w:t\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*>|<w:br\b[^>]*>|<w:cr\b[^>]*>/g;
  for (const run of paragraph.matchAll(runs)) {
    if (run[1] !== undefined) text += decodeXml(run[1]);
    else text += run[0].startsWith('<w:tab') ? ' ' : '\n';
  }
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function previewDocx(archive) {
  const xml = archive.text('word/document.xml');
  if (!xml) throw new zip.ZipError('the document body is missing');

  const blocks = [];
  let chars = 0;
  let total = 0;
  let truncated = false;

  for (const match of xml.matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const text = match[1] === undefined ? '' : paragraphText(match[1]);
    if (!text) continue;
    total += 1;
    if (blocks.length >= LIMITS.blocks || chars >= LIMITS.chars) {
      truncated = true;
      continue;
    }
    const level = headingLevel(match[1]);
    const clipped = text.length > 900 ? `${text.slice(0, 899)}…` : text;
    blocks.push({ level, text: clipped });
    chars += clipped.length;
  }

  const properties = archive.text('docProps/app.xml') || '';
  const numberOf = (tag) => {
    const found = new RegExp(`<${tag}>(\\d+)</${tag}>`).exec(properties);
    return found ? Number(found[1]) : null;
  };

  return {
    kind: 'text',
    blocks,
    blockCount: total,
    tables: (xml.match(/<w:tbl>/g) || []).length,
    pages: numberOf('Pages'),
    words: numberOf('Words'),
    truncated,
    note: null,
  };
}

/* ---------- PPTX ---------- */

// ppt/slides/slide2.xml sorts after slide10.xml unless the number is read out
const slideNumber = (name) => Number((/slide(\d+)\.xml$/.exec(name) || [])[1] || 0);

function previewPptx(archive) {
  const names = archive
    .names()
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (!names.length) throw new zip.ZipError('the presentation has no slides');

  const slides = [];
  for (const name of names.slice(0, LIMITS.slides)) {
    const xml = archive.text(name) || '';
    const lines = [];
    // Every shape on the slide holds its own paragraphs of text runs
    for (const paragraph of xml.matchAll(tagPattern('a:p'))) {
      const text = clip(textOf(paragraph[1].replace(/<a:t/g, '<t').replace(/<\/a:t>/g, '</t>')), LIMITS.line);
      if (text) lines.push(text);
      if (lines.length >= LIMITS.slideLines) break;
    }
    slides.push({ title: lines[0] || '', lines: lines.slice(1) });
  }

  return {
    kind: 'slides',
    slides,
    slideCount: names.length,
    truncated: names.length > slides.length,
    note: null,
  };
}

/* ---------- plain text ---------- */

function previewTxt(buffer) {
  const { text, encoding, clipped } = decodeText(buffer);
  const all = text.split(/\r\n|\r|\n/);
  // A trailing newline is not a line of its own
  if (all.length && all[all.length - 1] === '') all.pop();

  const lines = all.slice(0, LIMITS.lines).map((line) => {
    const tidy = line.replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
    return tidy.length > LIMITS.line ? `${tidy.slice(0, LIMITS.line - 1)}…` : tidy;
  });

  const notes = [];
  if (clipped) notes.push('only the first few MB were read');
  if (encoding !== 'utf-8') notes.push(`decoded as ${encoding}`);

  return {
    kind: 'plain',
    lines,
    lineCount: clipped ? null : all.length,
    truncated: clipped || all.length > lines.length,
    note: notes.join(', ') || null,
  };
}

/* ---------- ZIP ---------- */

function previewZip(archive) {
  const all = archive.list();
  const files = all.filter((entry) => !entry.directory);
  const entries = all
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, LIMITS.entries)
    .map((entry) => ({
      name: clip(entry.name, LIMITS.line),
      bytes: entry.bytes,
      directory: entry.directory,
    }));

  return {
    kind: 'list',
    entries,
    entryCount: files.length,
    totalBytes: files.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
    truncated: all.length > entries.length,
    note: null,
  };
}

/* ---------- DOC, XLS and PPT ---------- */

const SUMMARY_STREAM = '\u0005SummaryInformation';
const DOC_SUMMARY_STREAM = '\u0005DocumentSummaryInformation';
const MACRO_STORAGES = ['Macros', '_VBA_PROJECT', '_VBA_PROJECT_CUR'];

// Property ids, the same in every Office file of that era
const SUMMARY_FIELDS = [
  [2, 'Title'],
  [3, 'Subject'],
  [4, 'Author'],
  [8, 'Last saved by'],
  [12, 'Created'],
  [13, 'Last saved'],
];

function previewLegacy(container) {
  const summary = readPropertiesOf(container, SUMMARY_STREAM);
  const extra = readPropertiesOf(container, DOC_SUMMARY_STREAM);

  const properties = [];
  for (const [id, label] of SUMMARY_FIELDS) {
    const value = summary[id];
    if (value === undefined) continue;
    const text = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : String(value);
    properties.push({ label, value: clip(text, LIMITS.line) });
  }
  if (extra[15]) properties.push({ label: 'Company', value: clip(String(extra[15]), LIMITS.line) });

  const macros = MACRO_STORAGES.some((name) => container.has(name));
  return {
    kind: 'meta',
    properties,
    pages: typeof summary[14] === 'number' && summary[14] > 0 ? summary[14] : null,
    words: typeof summary[15] === 'number' && summary[15] > 0 ? summary[15] : null,
    slides: typeof extra[7] === 'number' && extra[7] > 0 ? extra[7] : null,
    macros,
    truncated: false,
    note: macros
      ? 'This file carries macros. It is stored as uploaded and never run here, but treat it as you would any macro file.'
      : 'Only the document properties are read from this format. Download the file to see its contents.',
  };
}

function readPropertiesOf(container, stream) {
  try {
    return cfb.readPropertySet(container.read(stream, 1024 * 1024));
  } catch {
    return {};
  }
}

/* ---------- PDF ---------- */

function countMarker(buffer, needles) {
  let count = 0;
  for (const needle of needles) {
    let at = 0;
    while ((at = buffer.indexOf(needle, at)) !== -1) {
      // "s" means /Pages, a node of the page tree rather than a page
      if (buffer[at + needle.length] !== 0x73) count += 1;
      at += needle.length;
    }
  }
  return count;
}

// Page trees carry /Count, which survives when the objects are compressed
function largestCount(buffer) {
  let best = 0;
  let at = 0;
  while ((at = buffer.indexOf('/Count', at)) !== -1) {
    const digits = /^\s*(\d{1,7})/.exec(buffer.toString('latin1', at + 6, at + 20));
    if (digits) best = Math.max(best, Number(digits[1]));
    at += 6;
  }
  return best;
}

function previewPdf(buffer) {
  const header = buffer.toString('latin1', 0, 1024);
  const version = /%PDF-(\d\.\d)/.exec(header);
  const encrypted = buffer.includes('/Encrypt');
  const pages = countMarker(buffer, ['/Type/Page', '/Type /Page']) || largestCount(buffer) || null;

  return {
    kind: 'pdf',
    pages,
    version: version ? version[1] : null,
    encrypted,
    note: encrypted ? 'The file is password protected, so it may not open in the browser' : null,
  };
}

/* ---------- entry point ---------- */

// Previews are stored on the record, so they get a hard size budget
function fit(preview) {
  const size = () => JSON.stringify(preview).length;
  while (size() > LIMITS.bytes) {
    if (Array.isArray(preview.rows) && preview.rows.length > 1) preview.rows.pop();
    else if (Array.isArray(preview.blocks) && preview.blocks.length > 1) preview.blocks.pop();
    else if (Array.isArray(preview.lines) && preview.lines.length > 1) preview.lines.pop();
    else if (Array.isArray(preview.entries) && preview.entries.length > 1) preview.entries.pop();
    else if (Array.isArray(preview.slides) && preview.slides.length > 1) preview.slides.pop();
    else break;
    preview.truncated = true;
  }
  return preview;
}

/**
 * Reads the preview of an already detected document. Never throws: a file we
 * cannot read still uploads, it just shows no preview.
 */
function preview(type, buffer, source) {
  try {
    if (type.format === 'pdf') return fit(previewPdf(buffer));
    if (type.format === 'csv') return fit(previewCsv(buffer));
    if (type.format === 'txt') return fit(previewTxt(buffer));
    if (type.preview === 'meta') return fit(previewLegacy(source || cfb.open(buffer)));

    const opened = source || zip.open(buffer);
    if (type.format === 'xlsx') return fit(previewXlsx(opened));
    if (type.format === 'docx') return fit(previewDocx(opened));
    if (type.format === 'pptx') return fit(previewPptx(opened));
    return fit(previewZip(opened));
  } catch (err) {
    console.error(`[documents] preview of a ${type.format} failed:`, err.message);
    return { kind: 'none', note: `No preview could be read from this file (${err.message})` };
  }
}

module.exports = {
  TYPES,
  FORMATS,
  ARCHIVE_FORMATS,
  DOCUMENT_FORMATS,
  LIMITS,
  detect,
  preview,
  safeFileName,
  extensionOf,
  decodeXml,
};
