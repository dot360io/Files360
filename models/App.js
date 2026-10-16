const { Schema, model } = require('mongoose');
const { FITS, FORMATS, SLUG_RE } = require('../utils/validate');

const DEFAULT_VARIANTS = [
  { name: 'thumb', width: 320, height: 320, fit: 'cover' },
  { name: 'medium', width: 800, fit: 'inside' },
  { name: 'large', width: 1600, fit: 'inside' },
];

const variantSchema = new Schema(
  {
    name: { type: String, required: true, match: /^[a-z0-9_-]{1,20}$/ },
    width: { type: Number, min: 1, max: 8000 },
    height: { type: Number, min: 1, max: 8000 },
    fit: { type: String, enum: FITS, default: 'inside' },
  },
  { _id: false }
);

const appSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Folder name in the bucket. Never changes after creation.
    slug: { type: String, required: true, unique: true, match: SLUG_RE, immutable: true },
    active: { type: Boolean, default: true },
    // Where this app's images are stored. Unset means the default bucket.
    bucket: { type: Schema.Types.ObjectId, ref: 'Bucket', default: null },
    format: { type: String, enum: FORMATS, default: 'webp' },
    quality: { type: Number, min: 30, max: 100, default: 80 },
    keepOriginal: { type: Boolean, default: false },
    // PDF, Office files, CSV and text. Stored as they arrive, not optimized.
    allowDocuments: { type: Boolean, default: true },
    // ZIP archives. Off by default: a public bucket would serve whatever is inside.
    allowArchives: { type: Boolean, default: false },
    maxUploadMB: { type: Number, min: 1, max: 100, default: 15 },
    variants: {
      type: [variantSchema],
      default: () => DEFAULT_VARIANTS.map((v) => ({ ...v })),
      validate: {
        validator: (list) => list.length >= 1 && list.length <= 8,
        message: 'An app needs between 1 and 8 sizes',
      },
    },
    stats: {
      images: { type: Number, default: 0 },
      bytesIn: { type: Number, default: 0 },
      bytesOut: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = model('App', appSchema);
