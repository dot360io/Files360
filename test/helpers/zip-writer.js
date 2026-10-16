/**
 * A ZIP writer just large enough to build test fixtures in memory, so the
 * repository carries readable XML instead of binary blobs. Entries are stored
 * uncompressed, which is a valid ZIP and keeps this short.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

function crc32(buf) {
  let crc = -1;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

/**
 * createZip({ 'path/in/archive.xml': 'contents', ... }) -> Buffer
 * A name ending in "/" is written as a directory entry.
 */
function createZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const [name, contents] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const body = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), 'utf8');
    const sum = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(CENTRAL, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, directory, end]);
}

/* ---------- the Office shapes the preview readers care about ---------- */

const XLSX = {
  'xl/workbook.xml':
    '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Hidden" sheetId="1" state="hidden" r:id="rId9"/>' +
    '<sheet name="Data &amp; more" sheetId="2" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':
    '<?xml version="1.0"?><Relationships><Relationship Id="rId9" Target="worksheets/hidden.xml"/>' +
    '<Relationship Id="rId1" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
  // The empty <si/> comes first on purpose: it still occupies index 0
  'xl/sharedStrings.xml':
    '<?xml version="1.0"?><sst count="4"><si/><si><t xml:space="preserve">Product </t></si>' +
    '<si><r><t>Rich</t></r><r><t> text</t></r></si><si><t>Caf&#233; &amp; Bar</t></si></sst>',
  'xl/styles.xml':
    '<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>' +
    '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"><alignment horizontal="left"/></xf>' +
    '<xf numFmtId="2"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet2.xml':
    '<?xml version="1.0"?><worksheet><dimension ref="A1:D4"/><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>2</v></c>' +
    '<c r="C1" t="inlineStr"><is><t>Inline</t></is></c><c r="D1" t="s"><v>3</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" s="1"><v>44927</v></c>' +
    '<c r="C2" s="2"><v>45000.75</v></c><c r="D2"><v>0.30000000000000004</v></c></row>' +
    '<row r="3"/>' +
    '<row r="4"><c r="A4"/><c r="B4" t="b"><v>1</v></c><c r="C4" t="e"><v>#DIV/0!</v></c>' +
    '<c r="Q4"><v>9</v></c></row></sheetData></worksheet>',
  'xl/worksheets/hidden.xml': '<?xml version="1.0"?><worksheet><sheetData/></worksheet>',
};

const DOCX = {
  'word/document.xml':
    '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p>' +
    '<w:p/>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading 2"/></w:pPr><w:r><w:t>Summary &amp; scope</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Revenue was </w:t></w:r><w:r><w:t>up 12%.</w:t></w:r>' +
    '<w:r><w:tab/><w:t>See table.</w:t></w:r><w:r><w:br/><w:t>New line here.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:delText>deleted words</w:delText></w:r><w:r><w:instrText>HYPERLINK x</w:instrText></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '</w:body></w:document>',
  'docProps/app.xml': '<?xml version="1.0"?><Properties><Pages>7</Pages><Words>1523</Words></Properties>',
};

const PPTX = {
  'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation xmlns:p="p"/>',
  'ppt/slides/slide1.xml':
    '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>' +
    '<p:sp><p:txBody><a:p><a:r><a:t>Files360 </a:t></a:r><a:r><a:t>roadmap</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:txBody><a:p><a:r><a:t>Q1: onboarding &amp; billing</a:t></a:r></a:p>' +
    '<a:p><a:r><a:t>Q2: fleet module</a:t></a:r></a:p><a:p/></p:txBody></p:sp>' +
    '</p:spTree></p:cSld></p:sld>',
  'ppt/slides/slide2.xml': '<?xml version="1.0"?><p:sld xmlns:a="a"><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>',
  // Numbered out of order so the reader has to sort by number, not by name
  'ppt/slides/slide10.xml': '<?xml version="1.0"?><p:sld xmlns:a="a"><a:p><a:r><a:t>Last slide</a:t></a:r></a:p></p:sld>',
};

const ARCHIVE = {
  'readme.md': '# bundle\n',
  'sub/': '',
  'sub/data.json': '{"a":1}',
  'blob.bin': Buffer.alloc(3000, 7),
};

module.exports = {
  createZip,
  crc32,
  xlsx: () => createZip(XLSX),
  docx: () => createZip(DOCX),
  pptx: () => createZip(PPTX),
  archive: () => createZip(ARCHIVE),
  shapes: { XLSX, DOCX, PPTX, ARCHIVE },
};
