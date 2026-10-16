const { Schema, model } = require('mongoose');

const outputSchema = new Schema(
  {
    name: String,
    key: String,
    url: String,
    width: Number,
    height: Number,
    bytes: Number,
    format: String,
    fit: String,
  },
  { _id: false }
);

// Read once at upload time so the library can show a document without
// downloading it again. Kept small on purpose, see utils/documents.js.
const previewSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['pdf', 'sheet', 'text', 'plain', 'slides', 'list', 'meta', 'vector', 'none'],
      default: 'none',
    },
    note: String,
    truncated: Boolean,
    // Spreadsheets and CSV
    rows: [[String]],
    header: Boolean,
    rowCount: Number,
    colCount: Number,
    sheets: [String],
    sheet: String,
    delimiter: String,
    // Word documents
    blocks: [new Schema({ level: Number, text: String }, { _id: false })],
    blockCount: Number,
    tables: Number,
    words: Number,
    // Plain text
    lines: [String],
    lineCount: Number,
    // Presentations
    slides: [new Schema({ title: String, lines: [String] }, { _id: false })],
    slideCount: Number,
    // Archives
    entries: [new Schema({ name: String, bytes: Number, directory: Boolean }, { _id: false })],
    entryCount: Number,
    totalBytes: Number,
    // Word, Excel and PowerPoint of the 97-2003 era: properties only
    properties: [new Schema({ label: String, value: String }, { _id: false })],
    macros: Boolean,
    // What the SVG allowlist took out before the file was stored
    removedElements: [String],
    removedAttributes: [String],
    // PDF, and page count of a Word document
    pages: Number,
    version: String,
    encrypted: Boolean,
  },
  { _id: false }
);

const imageSchema = new Schema(
  {
    app: { type: Schema.Types.ObjectId, ref: 'App', required: true },
    // The bucket the files really live in, so moving an app never orphans them
    bucket: { type: Schema.Types.ObjectId, ref: 'Bucket', index: true },
    // Images are resized into variants, documents are stored as they arrived
    kind: { type: String, enum: ['image', 'document'], default: 'image' },
    folder: { type: String, default: '' },
    // SHA-256 of the uploaded file, used to skip duplicates
    hash: { type: String, required: true },
    ref: { type: String, maxlength: 120 },
    originalName: { type: String, maxlength: 255 },
    source: { type: String, enum: ['upload', 'url', 'dashboard'], default: 'upload' },
    input: {
      format: String,
      width: Number,
      height: Number,
      bytes: Number,
    },
    original: {
      key: String,
      bytes: Number,
    },
    variants: [outputSchema],
    // The stored file itself: the document, or the cleaned vector of an SVG
    file: {
      key: String,
      url: String,
      name: String,
      mime: String,
      bytes: Number,
    },
    preview: previewSchema,
    bytesOut: { type: Number, default: 0 },
    apiKey: { type: Schema.Types.ObjectId, ref: 'ApiKey' },
  },
  { timestamps: true }
);

imageSchema.index({ app: 1, folder: 1, hash: 1 }, { unique: true });
imageSchema.index({ app: 1, createdAt: -1 });
imageSchema.index({ app: 1, ref: 1 });

// The full preview can hold dozens of rows, so API responses get the shape only
function previewSummary(preview) {
  if (!preview || !preview.kind || preview.kind === 'none') return null;
  const summary = { kind: preview.kind };
  if (preview.pages != null) summary.pages = preview.pages;
  if (preview.rowCount != null) summary.rows = preview.rowCount;
  if (preview.colCount != null) summary.columns = preview.colCount;
  if (preview.sheets && preview.sheets.length) summary.sheets = [...preview.sheets];
  if (preview.words != null) summary.words = preview.words;
  if (preview.lineCount != null) summary.lines = preview.lineCount;
  if (preview.slideCount != null) summary.slides = preview.slideCount;
  if (preview.entryCount != null) summary.entries = preview.entryCount;
  if (preview.totalBytes != null) summary.unpackedBytes = preview.totalBytes;
  if (preview.macros) summary.macros = true;
  return summary;
}

// An SVG is published as a vector as well as its raster sizes
function vectorSummary(image) {
  if (!image.file || !image.file.url) return null;
  const removed = [...(image.preview ? image.preview.removedElements || [] : [])];
  return {
    url: image.file.url,
    name: image.file.name,
    mime: image.file.mime,
    bytes: image.file.bytes,
    ...(removed.length ? { sanitizedAway: removed } : {}),
  };
}

imageSchema.methods.toApi = function toApi() {
  const base = {
    id: this._id.toString(),
    kind: this.kind || 'image',
    folder: this.folder,
    ref: this.ref || null,
    hash: this.hash,
  };

  if (this.kind === 'document') {
    return {
      ...base,
      input: {
        name: this.originalName || null,
        format: this.input.format,
        bytes: this.input.bytes,
      },
      file: {
        url: this.file.url,
        name: this.file.name,
        mime: this.file.mime,
        bytes: this.file.bytes,
      },
      preview: previewSummary(this.preview),
      bytesOut: this.bytesOut,
      createdAt: this.createdAt,
    };
  }

  const variants = {};
  for (const v of this.variants) {
    variants[v.name] = { url: v.url, width: v.width, height: v.height, bytes: v.bytes, format: v.format };
  }

  // Cropped sizes have a different aspect ratio, so they stay out of srcset
  const srcset = this.variants
    .filter((v) => v.fit !== 'cover' && v.fit !== 'fill')
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');

  const vector = vectorSummary(this);
  return {
    ...base,
    input: {
      name: this.originalName || null,
      format: this.input.format,
      width: this.input.width,
      height: this.input.height,
      bytes: this.input.bytes,
    },
    variants,
    srcset,
    ...(vector ? { file: vector } : {}),
    bytesOut: this.bytesOut,
    createdAt: this.createdAt,
  };
};

module.exports = model('Image', imageSchema);
