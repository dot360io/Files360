/**
 * Builds a Compound File Binary container in memory, the format behind .doc,
 * .xls and .ppt. Real Office files put their property sets in the mini stream,
 * so the fixture does too: that is the path worth testing.
 */

const SECTOR = 512;
const MINI = 64;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FATSECT = 0xfffffffd;

const SUMMARY = '\u0005SummaryInformation';
const DOC_SUMMARY = '\u0005DocumentSummaryInformation';

/* ---------- property set values ---------- */

const lpstr = (text) => {
  const bytes = Buffer.from(`${text}\0`, 'latin1');
  const out = Buffer.alloc(4 + bytes.length);
  out.writeUInt32LE(bytes.length, 0);
  bytes.copy(out, 4);
  return out;
};

const lpwstr = (text) => {
  const bytes = Buffer.from(`${text}\0`, 'utf16le');
  const out = Buffer.alloc(4 + bytes.length);
  out.writeUInt32LE(text.length + 1, 0);
  bytes.copy(out, 4);
  return out;
};

const int32 = (n) => {
  const out = Buffer.alloc(4);
  out.writeInt32LE(n, 0);
  return out;
};

// VT_I2 is a signed field, but Office writes code pages above 32767 into it
// anyway, so 65001 lands there as a negative number. utils/cfb.js masks it back.
const int16 = (n) => {
  const out = Buffer.alloc(4);
  out.writeUInt16LE(n & 0xffff, 0);
  return out;
};

// FILETIME: 100 nanosecond ticks since 1601
const filetime = (iso) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(Date.parse(iso) + 11_644_473_600_000) * 10_000n, 0);
  return out;
};

/** properties: [[id, type, Buffer], ...] */
function propertySet(properties) {
  const pairs = Buffer.alloc(8 + properties.length * 8);
  const values = [];
  let at = pairs.length;

  properties.forEach(([id, type, value], i) => {
    pairs.writeUInt32LE(id, 8 + i * 8);
    pairs.writeUInt32LE(at, 8 + i * 8 + 4);
    const body = Buffer.alloc(4 + value.length + ((4 - (value.length % 4)) % 4));
    body.writeUInt32LE(type, 0);
    value.copy(body, 4);
    values.push(body);
    at += body.length;
  });

  pairs.writeUInt32LE(at, 0);
  pairs.writeUInt32LE(properties.length, 4);

  const section = Buffer.concat([pairs, ...values]);
  const header = Buffer.alloc(48);
  header.writeUInt16LE(0xfffe, 0);
  header.writeUInt32LE(0x0a04, 4);
  header.writeUInt32LE(1, 24);
  Buffer.alloc(16, 1).copy(header, 28);
  header.writeUInt32LE(48, 44);
  return Buffer.concat([header, section]);
}

function directoryEntry(name, type, start, size) {
  const entry = Buffer.alloc(128);
  entry.write(name, 0, 'utf16le');
  entry.writeUInt16LE(name.length * 2 + 2, 0x40);
  entry.writeUInt8(type, 0x42);
  entry.writeUInt32LE(start, 0x74);
  entry.writeUInt32LE(size, 0x78);
  return entry;
}

const pad = (buf) => Buffer.concat([buf, Buffer.alloc((SECTOR - (buf.length % SECTOR)) % SECTOR)]);

/**
 * One body stream (what identifies the format) plus a summary property set in
 * the mini stream. `extraStorages` adds empty storages, e.g. a macro project.
 */
function createCfb({ bodyName = 'WordDocument', bodyBytes = 5000, summary, extraStorages = [] } = {}) {
  const properties = summary || propertySet([
    [1, 0x02, int16(1252)], // code page
    [2, 0x1e, lpstr('Quarterly report')], // Title
    [4, 0x1f, lpwstr('Åsa Lindström')], // Author, wide string
    [12, 0x40, filetime('2026-03-04T09:15:00Z')], // Created
    [14, 0x03, int32(12)], // Pages
    [15, 0x03, int32(2481)], // Words
  ]);

  const body = Buffer.alloc(bodyBytes, 0x41);
  const bodySectors = Math.ceil(body.length / SECTOR);
  const miniSectors = Math.ceil(properties.length / MINI);
  const miniStream = Buffer.alloc(miniSectors * MINI);
  properties.copy(miniStream, 0);

  const header = Buffer.alloc(SECTOR, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(9, 0x1e); // 512 byte sectors
  header.writeUInt16LE(6, 0x20); // 64 byte mini sectors
  header.writeUInt32LE(1, 0x2c); // one FAT sector
  header.writeUInt32LE(1, 0x30); // directory at sector 1
  header.writeUInt32LE(4096, 0x38); // mini stream cutoff
  header.writeUInt32LE(2, 0x3c); // mini FAT at sector 2
  header.writeUInt32LE(1, 0x40);
  header.writeUInt32LE(END, 0x44);
  header.writeUInt32LE(0, 0x4c); // DIFAT[0]: the FAT is in sector 0
  for (let i = 1; i < 109; i += 1) header.writeUInt32LE(FREE, 0x4c + i * 4);

  // 0 FAT, 1 directory, 2 mini FAT, 3 mini stream, 4.. the body
  const fat = Buffer.alloc(SECTOR, 0xff);
  [FATSECT, END, END, END].forEach((value, i) => fat.writeUInt32LE(value, i * 4));
  for (let i = 0; i < bodySectors; i += 1) {
    fat.writeUInt32LE(i === bodySectors - 1 ? END : 5 + i, (4 + i) * 4);
  }

  const miniFat = Buffer.alloc(SECTOR, 0xff);
  for (let i = 0; i < miniSectors; i += 1) {
    miniFat.writeUInt32LE(i === miniSectors - 1 ? END : i + 1, i * 4);
  }

  const directory = Buffer.concat([
    directoryEntry('Root Entry', 5, 3, miniStream.length),
    directoryEntry(SUMMARY, 2, 0, properties.length),
    directoryEntry(bodyName, 2, 4, body.length),
    ...extraStorages.map((name) => directoryEntry(name, 1, 0, 0)),
    Buffer.alloc(128),
  ]);

  return Buffer.concat([header, fat, pad(directory), miniFat, pad(miniStream), pad(body)]);
}

module.exports = { createCfb, propertySet, lpstr, lpwstr, int32, int16, filetime, SUMMARY, DOC_SUMMARY };
