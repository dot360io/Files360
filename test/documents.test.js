const test = require('node:test');
const assert = require('node:assert');

const documents = require('../utils/documents');
const { createZip, xlsx, docx, pptx, archive } = require('./helpers/zip-writer');
const { createCfb } = require('./helpers/cfb-writer');

const read = (buffer, name, mime) => {
  const detected = documents.detect(buffer, name, mime);
  if (!detected) return null;
  return { format: detected.type.format, preview: documents.preview(detected.type, buffer, detected.source) };
};

// A PDF small enough to read, with two page objects and a page tree
const PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n' +
    '4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n'
);

test('detects every accepted type from its bytes', () => {
  assert.strictEqual(read(PDF, 'a.pdf').format, 'pdf');
  assert.strictEqual(read(xlsx(), 'a.xlsx').format, 'xlsx');
  assert.strictEqual(read(docx(), 'a.docx').format, 'docx');
  assert.strictEqual(read(pptx(), 'a.pptx').format, 'pptx');
  assert.strictEqual(read(archive(), 'a.zip').format, 'zip');
  assert.strictEqual(read(createCfb({ bodyName: 'WordDocument' }), 'a.doc').format, 'doc');
  assert.strictEqual(read(createCfb({ bodyName: 'Workbook' }), 'a.xls').format, 'xls');
  assert.strictEqual(read(createCfb({ bodyName: 'PowerPoint Document' }), 'a.ppt').format, 'ppt');
  assert.strictEqual(read(Buffer.from('a,b\n1,2\n'), 'a.csv').format, 'csv');
  assert.strictEqual(read(Buffer.from('just words\n'), 'a.txt').format, 'txt');
});

test('the name does not decide the type, the bytes do', () => {
  // A spreadsheet called .txt is still a spreadsheet
  assert.strictEqual(read(xlsx(), 'notes.txt').format, 'xlsx');
  // And a CSV is recognised from the declared type when the name says nothing
  assert.strictEqual(read(Buffer.from('a,b\n1,2\n'), 'blob', 'text/csv').format, 'csv');
});

test('images and unknown bytes are left to the image pipeline', () => {
  assert.strictEqual(read(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), 'a.png'), null);
  assert.strictEqual(read(Buffer.alloc(0), 'a.txt'), null);
  assert.strictEqual(read(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]), 'a.txt'), null);
});

test('recognised but unsupported formats say what to do instead', () => {
  const odf = createZip({ mimetype: 'application/vnd.oasis.opendocument.text' });
  assert.throws(() => documents.detect(odf, 'a.odt'), (err) => {
    assert.strictEqual(err.status, 415);
    assert.strictEqual(err.code, 'unsupported_document');
    assert.match(err.message, /OpenDocument/);
    return true;
  });

  const macro = createZip({ 'xl/workbook.xml': '<workbook/>', 'xl/vbaProject.bin': 'x' });
  assert.throws(() => documents.detect(macro, 'a.xlsm'), /[Mm]acro/);
});

test('pdf: counts pages', () => {
  const { preview } = read(PDF, 'a.pdf');
  assert.strictEqual(preview.kind, 'pdf');
  assert.strictEqual(preview.pages, 2);
  assert.strictEqual(preview.version, '1.4');
  assert.strictEqual(preview.encrypted, false);
});

test('xlsx: shared strings, inline strings, dates, booleans and sparse columns', () => {
  const { preview } = read(xlsx(), 'a.xlsx');
  assert.strictEqual(preview.kind, 'sheet');
  assert.deepStrictEqual(preview.sheets, ['Hidden', 'Data & more']);
  assert.strictEqual(preview.sheet, 'Data & more', 'a hidden sheet is skipped');

  assert.deepStrictEqual(preview.rows[0], ['Product', 'Rich text', 'Inline', 'Café & Bar']);
  assert.strictEqual(preview.rows[1][1], '2023-01-01', 'a date serial becomes a date');
  assert.strictEqual(preview.rows[1][2], '2023-03-15 18:00', 'a custom date format keeps its time');
  assert.strictEqual(preview.rows[1][3], '0.3', 'floating point noise is trimmed');
  assert.strictEqual(preview.rows[3][1], 'TRUE');
  assert.strictEqual(preview.rows[3][2], '#DIV/0!');

  assert.strictEqual(preview.colCount, 17, 'the far column still counts');
  assert.ok(preview.truncated, 'a column beyond the cap means truncated');
  assert.ok(preview.header);
});

test('docx: headings, runs, tabs, breaks and table text', () => {
  const { preview } = read(docx(), 'a.docx');
  assert.strictEqual(preview.kind, 'text');
  assert.strictEqual(preview.blocks[0].level, 1, 'Title is a heading');
  assert.strictEqual(preview.blocks[0].text, 'Quarterly report');
  assert.strictEqual(preview.blocks[1].level, 2, 'Heading 2 is a heading');
  assert.strictEqual(preview.blocks[2].text, 'Revenue was up 12%. See table.\nNew line here.');
  assert.strictEqual(preview.blocks[3].text, 'Cell A', 'text inside a table is picked up');
  assert.strictEqual(preview.blocks.length, 4, 'deleted and field text are skipped');
  assert.strictEqual(preview.pages, 7);
  assert.strictEqual(preview.words, 1523);
  assert.strictEqual(preview.tables, 1);
});

test('pptx: slides in numeric order, title and lines apart', () => {
  const { preview } = read(pptx(), 'a.pptx');
  assert.strictEqual(preview.kind, 'slides');
  assert.strictEqual(preview.slideCount, 3);
  assert.strictEqual(preview.slides[0].title, 'Files360 roadmap', 'runs are joined');
  assert.deepStrictEqual(preview.slides[0].lines, ['Q1: onboarding & billing', 'Q2: fleet module']);
  assert.strictEqual(preview.slides[1].title, 'Second slide');
  assert.strictEqual(preview.slides[2].title, 'Last slide', 'slide10 sorts after slide2');
});

test('zip: lists what is inside without unpacking it', () => {
  const { preview } = read(archive(), 'a.zip');
  assert.strictEqual(preview.kind, 'list');
  assert.strictEqual(preview.entryCount, 3, 'directories are not files');
  assert.strictEqual(preview.totalBytes, 3000 + '# bundle\n'.length + '{"a":1}'.length);
  assert.ok(preview.entries.find((e) => e.name === 'sub/').directory);
  assert.strictEqual(preview.entries.find((e) => e.name === 'blob.bin').bytes, 3000);
});

test('csv: quoting, delimiters and encodings', () => {
  const semicolons = Buffer.from(
    'id;name;price;notes\r\n1;"Chair, oak";129,90;"He said ""ok""\nsecond line"\r\n2;Table;249,00;\r\n\r\n3;Lamp;19,50;plain\r\n'
  );
  const { preview } = read(semicolons, 'a.csv');
  assert.strictEqual(preview.delimiter, ';');
  assert.strictEqual(preview.rowCount, 4, 'a blank line is not a row');
  assert.ok(preview.header);
  assert.strictEqual(preview.rows[1][1], 'Chair, oak', 'a quoted delimiter is not a delimiter');
  assert.strictEqual(preview.rows[1][3], 'He said "ok" second line', 'doubled quotes and newlines survive');

  const latin1 = Buffer.from('name,city\nJos\xe9,M\xe1laga\n', 'latin1');
  const fallback = read(latin1, 'b.csv').preview;
  assert.strictEqual(fallback.rows[1][0], 'José');
  assert.match(fallback.note, /windows-1252|latin-1/);
});

test('csv: a big file is capped but still counted', () => {
  const rows = ['col1,col2,col3'];
  for (let i = 0; i < 500; i += 1) rows.push(`v${i},v${i},v${i}`);
  const { preview } = read(Buffer.from(rows.join('\n')), 'big.csv');

  assert.strictEqual(preview.rowCount, 501, 'every row is counted');
  assert.ok(preview.rows.length <= documents.LIMITS.rows, 'only the first rows are kept');
  assert.ok(preview.truncated);
  assert.ok(JSON.stringify(preview).length < documents.LIMITS.bytes, 'the stored preview stays small');
});

test('txt: numbered lines, tabs expanded, long lines clipped', () => {
  const text = `one\ttab\nsecond line\n\n${'x'.repeat(400)}\n`;
  const { preview } = read(Buffer.from(text), 'a.txt');
  assert.strictEqual(preview.kind, 'plain');
  assert.strictEqual(preview.lineCount, 4);
  assert.strictEqual(preview.lines[0], 'one    tab');
  assert.ok(preview.lines[3].length <= documents.LIMITS.line);
  assert.ok(preview.lines[3].endsWith('…'));
});

test('doc, xls and ppt: properties and the macro flag', () => {
  const { preview } = read(createCfb(), 'a.doc');
  assert.strictEqual(preview.kind, 'meta');
  assert.deepStrictEqual(
    preview.properties.map((p) => p.label),
    ['Title', 'Author', 'Created']
  );
  assert.strictEqual(preview.properties[0].value, 'Quarterly report');
  assert.strictEqual(preview.pages, 12);
  assert.strictEqual(preview.words, 2481);
  assert.strictEqual(preview.macros, false);

  const withMacros = read(createCfb({ extraStorages: ['_VBA_PROJECT'] }), 'b.doc').preview;
  assert.strictEqual(withMacros.macros, true);
  assert.match(withMacros.note, /macros/i);
});

test('a preview never throws, however broken the file is', () => {
  const broken = [
    createZip({ 'xl/workbook.xml': '<not xml at all' }),
    createZip({ 'word/document.xml': '' }),
    createZip({ 'ppt/presentation.xml': '<p/>' }), // declares slides it does not have
  ];
  for (const buffer of broken) {
    const detected = documents.detect(buffer, 'x');
    const preview = documents.preview(detected.type, buffer, detected.source);
    assert.ok(preview.kind, 'a preview object is always returned');
    assert.ok(typeof preview.note === 'string' || preview.note === null);
  }
});

test('stored file names are reduced to something safe', () => {
  assert.strictEqual(documents.safeFileName('Quarterly Report (FINAL).xlsx', 'xlsx'), 'quarterly-report-final.xlsx');
  assert.strictEqual(documents.safeFileName('../../etc/passwd', 'txt'), 'passwd.txt');
  assert.strictEqual(documents.safeFileName('Κινήσεις.csv', 'csv'), 'file.csv');
  assert.strictEqual(documents.safeFileName('', 'pdf'), 'file.pdf');
  assert.ok(!documents.safeFileName('a"b;rm -rf.pdf', 'pdf').match(/["';]/), 'nothing that breaks a header');
});
