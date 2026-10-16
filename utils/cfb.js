/**
 * Minimal reader for the Compound File Binary container behind the pre-2007
 * Office formats: .doc, .xls and .ppt. The container is a little file system
 * of "storages" and "streams", and that is all this reads: which streams are
 * present, which tells the format apart, plus the property sets that hold the
 * title, the author and the page, word and slide counts.
 *
 * The actual document bodies (BIFF records, Word piece tables) are not parsed.
 */

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const DIFAT_SECTOR = 0xfffffffc;
const FAT_SECTOR = 0xfffffffd;
const DIRECTORY_ENTRY = 128;
const MAX_STREAM = 4 * 1024 * 1024;

class CfbError extends Error {}

/** The magic alone: a truncated file should still be reported as what it is. */
function looksLikeCfb(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(SIGNATURE);
}

class Container {
  constructor(buffer) {
    if (!looksLikeCfb(buffer)) throw new CfbError('Not a compound file');
    if (buffer.length < 1024) throw new CfbError('The compound file is truncated');
    this.buf = buffer;
    this.sectorSize = 1 << buffer.readUInt16LE(0x1e);
    this.miniSectorSize = 1 << buffer.readUInt16LE(0x20);
    this.miniCutoff = buffer.readUInt32LE(0x38);
    if (this.sectorSize < 128 || this.sectorSize > 65_536) throw new CfbError('Unusable sector size');

    this.fat = this.readFat();
    this.entries = this.readDirectory();
    // The mini FAT is itself stored in a chain of ordinary sectors
    this.miniFat = this.entriesOf(this.readChain(buffer.readUInt32LE(0x3c)));
    const root = this.entries[0];
    this.miniChain = root ? this.readChain(root.start) : [];
  }

  sectorAt(sector) {
    const start = (sector + 1) * this.sectorSize;
    if (start < 0 || start + this.sectorSize > this.buf.length) throw new CfbError('Sector outside the file');
    return this.buf.subarray(start, start + this.sectorSize);
  }

  // The FAT lives in sectors listed by the DIFAT, which itself can spill over
  readFat() {
    const sectors = [];
    for (let i = 0; i < 109; i += 1) {
      const sector = this.buf.readUInt32LE(0x4c + i * 4);
      if (sector === FREE_SECTOR || sector === END_OF_CHAIN) break;
      sectors.push(sector);
    }

    let next = this.buf.readUInt32LE(0x44);
    const perSector = this.sectorSize / 4;
    let guard = 0;
    // DIFAT sectors are walked directly: the FAT they describe does not exist yet
    while (next !== END_OF_CHAIN && next !== FREE_SECTOR && guard < 4096) {
      const data = this.sectorAt(next);
      for (let i = 0; i < perSector - 1; i += 1) {
        const sector = data.readUInt32LE(i * 4);
        if (sector !== FREE_SECTOR && sector !== END_OF_CHAIN) sectors.push(sector);
      }
      next = data.readUInt32LE((perSector - 1) * 4);
      guard += 1;
    }

    const fat = this.entriesOf(sectors);
    if (!fat.length) throw new CfbError('The allocation table is empty');
    return fat;
  }

  /** The sector numbers packed into these sectors, four bytes each. */
  entriesOf(sectors) {
    const entries = [];
    for (const sector of sectors) {
      const data = this.sectorAt(sector);
      for (let i = 0; i < this.sectorSize / 4; i += 1) entries.push(data.readUInt32LE(i * 4));
    }
    return entries;
  }

  readChain(start) {
    const chain = [];
    let sector = start;
    while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && sector !== FAT_SECTOR && sector !== DIFAT_SECTOR) {
      if (sector >= this.fat.length || chain.length > 1 << 20) break;
      chain.push(sector);
      sector = this.fat[sector];
    }
    return chain;
  }

  readDirectory() {
    const entries = [];
    for (const sector of this.readChain(this.buf.readUInt32LE(0x30))) {
      const data = this.sectorAt(sector);
      for (let at = 0; at + DIRECTORY_ENTRY <= data.length; at += DIRECTORY_ENTRY) {
        const nameLength = data.readUInt16LE(at + 0x40);
        const type = data.readUInt8(at + 0x42);
        if (type === 0 || nameLength < 2 || nameLength > 64) continue;
        entries.push({
          // The name is UTF-16 and includes its terminator; control characters
          // prefix the special streams, e.g. SummaryInformation
          name: data.toString('utf16le', at, at + nameLength - 2),
          type,
          start: data.readUInt32LE(at + 0x74),
          size: data.readUInt32LE(at + 0x78),
        });
      }
    }
    if (!entries.length) throw new CfbError('The compound file has no directory');
    return entries;
  }

  names() {
    return this.entries.map((e) => e.name);
  }

  /** True when a storage or stream with this name exists anywhere in the file. */
  has(name) {
    return this.entries.some((e) => e.name === name);
  }

  find(name) {
    return this.entries.find((e) => e.name === name && e.type === 2) || null;
  }

  /** Bytes of one stream, or null when it is not there. */
  read(name, maxBytes = MAX_STREAM) {
    const entry = this.find(name);
    if (!entry) return null;
    if (entry.size > maxBytes) throw new CfbError(`"${name}" is larger than the preview limit`);

    // Small streams live inside the root stream, cut into mini sectors
    if (entry.size < this.miniCutoff) {
      const out = Buffer.alloc(entry.size);
      let written = 0;
      let sector = entry.start;
      const perSector = this.sectorSize / this.miniSectorSize;
      let guard = 0;
      while (sector !== END_OF_CHAIN && written < entry.size && guard < 1 << 20) {
        const host = this.miniChain[Math.floor(sector / perSector)];
        if (host === undefined) break;
        const offset = (sector % perSector) * this.miniSectorSize;
        const slice = this.sectorAt(host).subarray(offset, offset + this.miniSectorSize);
        written += slice.copy(out, written);
        sector = this.miniFat[sector];
        if (sector === undefined) break;
        guard += 1;
      }
      return out.subarray(0, written);
    }

    const out = Buffer.alloc(entry.size);
    let written = 0;
    for (const sector of this.readChain(entry.start)) {
      if (written >= entry.size) break;
      written += this.sectorAt(sector).copy(out, written);
    }
    return out.subarray(0, Math.min(written, entry.size));
  }
}

/* ---------- property sets ---------- */

// The handful of value types Office actually writes into these streams
function readValue(buf, at, codepage) {
  const type = buf.readUInt16LE(at);
  const body = at + 4;
  switch (type) {
    case 0x02:
      return buf.readInt16LE(body);
    case 0x03:
      return buf.readInt32LE(body);
    case 0x0b:
      return buf.readInt16LE(body) !== 0;
    case 0x1e: {
      const length = buf.readUInt32LE(body);
      if (length < 1 || body + 4 + length > buf.length) return null;
      const bytes = buf.subarray(body + 4, body + 4 + length - 1);
      if (codepage === 65001) return bytes.toString('utf8');
      try {
        return new TextDecoder('windows-1252').decode(bytes);
      } catch {
        return bytes.toString('latin1');
      }
    }
    case 0x1f: {
      const length = buf.readUInt32LE(body);
      if (length < 1 || body + 4 + length * 2 > buf.length) return null;
      return buf.toString('utf16le', body + 4, body + 4 + (length - 1) * 2);
    }
    case 0x40: {
      // FILETIME: 100 ns ticks since 1601
      const ticks = buf.readBigUInt64LE(body);
      const ms = Number(ticks / 10_000n) - 11_644_473_600_000;
      const at1601 = new Date(ms);
      return Number.isNaN(at1601.getTime()) || ms <= 0 ? null : at1601.toISOString();
    }
    default:
      return null;
  }
}

/** { propertyId: value } of the first section of a property set stream. */
function readPropertySet(stream) {
  if (!stream || stream.length < 48 || stream.readUInt16LE(0) !== 0xfffe) return {};
  const sectionAt = stream.readUInt32LE(44);
  if (sectionAt + 8 > stream.length) return {};

  const count = stream.readUInt32LE(sectionAt + 4);
  if (count > 256) return {};

  const raw = new Map();
  for (let i = 0; i < count; i += 1) {
    const pair = sectionAt + 8 + i * 8;
    if (pair + 8 > stream.length) break;
    const id = stream.readUInt32LE(pair);
    const offset = sectionAt + stream.readUInt32LE(pair + 4);
    if (offset + 4 > stream.length) continue;
    raw.set(id, offset);
  }

  // Property 1 is the code page every VT_LPSTR in the section is written in
  const codepageAt = raw.get(1);
  const codepage = codepageAt === undefined ? 1252 : Number(readValue(stream, codepageAt, 1252)) & 0xffff;

  const values = {};
  for (const [id, offset] of raw) {
    if (id === 1) continue;
    const value = readValue(stream, offset, codepage);
    if (value !== null && value !== '') values[id] = value;
  }
  return values;
}

module.exports = { looksLikeCfb, open: (buffer) => new Container(buffer), readPropertySet, CfbError };
