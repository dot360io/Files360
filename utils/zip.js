const zlib = require('zlib');

/**
 * Minimal reader for the ZIP container behind .xlsx and .docx files.
 * Office files are small, machine written archives, so only the two
 * compression methods they use are supported: stored and deflate.
 * Reading happens entry by entry and every entry is capped, so a
 * crafted file cannot inflate into more memory than it is allowed.
 */

const EOCD = 0x06054b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT = 65_535;
const MAX_ENTRY_BYTES = 12 * 1024 * 1024;

class ZipError extends Error {}

function findSignature(buf, signature, from, to) {
  for (let i = Math.min(from, buf.length - 4); i >= to; i -= 1) {
    if (buf.readUInt32LE(i) === signature) return i;
  }
  return -1;
}

// The end of central directory record sits at the very end of the file,
// unless the archive carries a comment, so it is searched for backwards.
function readEnd(buf) {
  const at = findSignature(buf, EOCD, buf.length - 22, Math.max(0, buf.length - 22 - MAX_COMMENT));
  if (at < 0) throw new ZipError('Not a ZIP archive');

  let count = buf.readUInt16LE(at + 10);
  let offset = buf.readUInt32LE(at + 16);

  // Zip64 keeps the real numbers in its own record, pointed at by a locator
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = findSignature(buf, ZIP64_LOCATOR, at - 20, Math.max(0, at - 100));
    if (locator < 0) throw new ZipError('Damaged Zip64 archive');
    const zip64At = Number(buf.readBigUInt64LE(locator + 8));
    if (zip64At < 0 || zip64At + 56 > buf.length || buf.readUInt32LE(zip64At) !== ZIP64_EOCD) {
      throw new ZipError('Damaged Zip64 archive');
    }
    count = Number(buf.readBigUInt64LE(zip64At + 32));
    offset = Number(buf.readBigUInt64LE(zip64At + 48));
  }
  return { count, offset };
}

// Zip64 moves sizes and offsets that no longer fit into an extra field
function readZip64Extra(extra, entry) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    const end = at + 4 + size;
    if (end > extra.length) break;
    if (id === 0x0001) {
      let field = at + 4;
      const next = () => {
        const value = Number(extra.readBigUInt64LE(field));
        field += 8;
        return value;
      };
      // The fields are only present for the values that overflowed, in this order
      if (entry.size === 0xffffffff && field + 8 <= end) entry.size = next();
      if (entry.compressedSize === 0xffffffff && field + 8 <= end) entry.compressedSize = next();
      if (entry.offset === 0xffffffff && field + 8 <= end) entry.offset = next();
      break;
    }
    at = end;
  }
}

function readDirectory(buf) {
  const { count, offset } = readEnd(buf);
  const entries = new Map();
  let at = offset;

  for (let i = 0; i < count; i += 1) {
    if (at < 0 || at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL) break;
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const entry = {
      name: buf.toString('utf8', at + 46, at + 46 + nameLength),
      flags: buf.readUInt16LE(at + 8),
      method: buf.readUInt16LE(at + 10),
      compressedSize: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
    };
    if (extraLength) readZip64Extra(buf.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), entry);
    entries.set(entry.name, entry);
    at += 46 + nameLength + extraLength + commentLength;
  }

  if (entries.size === 0) throw new ZipError('The archive has no readable entries');
  return entries;
}

function inflate(entry, data, maxBytes) {
  if (entry.method === 0) return data.subarray(0, Math.min(data.length, maxBytes));
  if (entry.method !== 8) throw new ZipError(`Unsupported compression in "${entry.name}"`);
  try {
    return zlib.inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch (err) {
    throw new ZipError(`Could not read "${entry.name}": ${err.message}`);
  }
}

class Archive {
  constructor(buffer) {
    this.buffer = buffer;
    this.entries = readDirectory(buffer);
  }

  names() {
    return [...this.entries.keys()];
  }

  has(name) {
    return this.entries.has(name);
  }

  /** Inflated bytes of one entry, or null when it is not in the archive. */
  read(name, maxBytes = MAX_ENTRY_BYTES) {
    const entry = this.entries.get(name);
    if (!entry) return null;
    // Bit 0 marks the classic ZIP password, which Office files never use
    if (entry.flags & 0x1) throw new ZipError(`"${entry.name}" is encrypted`);
    if (entry.size > maxBytes) {
      throw new ZipError(`"${entry.name}" is above the ${Math.round(maxBytes / 1048576)} MB preview limit`);
    }

    const at = entry.offset;
    if (at + LOCAL_HEADER_SIZE > this.buffer.length) throw new ZipError(`"${entry.name}" points outside the file`);
    // The local header repeats the name and may carry a different extra field
    const start = at + LOCAL_HEADER_SIZE + this.buffer.readUInt16LE(at + 26) + this.buffer.readUInt16LE(at + 28);
    const end = start + entry.compressedSize;
    if (end > this.buffer.length) throw new ZipError(`"${entry.name}" is truncated`);

    return inflate(entry, this.buffer.subarray(start, end), maxBytes);
  }

  /** Every entry, for showing what is inside an archive without opening it. */
  list() {
    return [...this.entries.values()].map((entry) => ({
      name: entry.name,
      bytes: entry.size,
      compressed: entry.compressedSize,
      directory: entry.name.endsWith('/'),
    }));
  }

  text(name, maxBytes) {
    const data = this.read(name, maxBytes);
    return data ? data.toString('utf8') : null;
  }
}

/** "PK" followed by a local header, an empty archive or a spanned marker. */
function looksLikeZip(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const kind = (buffer[2] << 8) | buffer[3];
  return kind === 0x0304 || kind === 0x0506 || kind === 0x0708;
}

function open(buffer) {
  return new Archive(buffer);
}

module.exports = { open, looksLikeZip, ZipError, MAX_ENTRY_BYTES };
