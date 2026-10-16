const { Schema, model } = require('mongoose');
const providers = require('../utils/providers');
const secretBox = require('../utils/secretBox');

const bucketSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    provider: { type: String, required: true, enum: providers.IDS },
    // Bucket or Space name at the provider
    bucket: { type: String, required: true, trim: true, maxlength: 120 },
    region: { type: String, trim: true, maxlength: 40, default: '' },
    // Cloudflare R2 account id, unused by the other providers
    account: { type: String, trim: true, maxlength: 80, default: '' },
    // S3 API endpoint. Empty means the SDK default, which only AWS uses.
    endpoint: { type: String, trim: true, maxlength: 255, default: '' },
    // Base URL the stored objects are served from, CDN domain included
    publicUrl: { type: String, trim: true, maxlength: 255, default: '' },
    accessKey: { type: String, required: true, trim: true, maxlength: 255 },
    // AES-256-GCM, never rendered
    secretEnc: { type: String, required: true },
    forcePathStyle: { type: Boolean, default: false },
    // Providers without per-object ACLs (R2, B2) rely on bucket-level access
    supportsAcl: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    // Result of the last connection test
    status: {
      ok: { type: Boolean, default: null },
      checkedAt: { type: Date },
      error: { type: String },
      publicOk: { type: Boolean, default: null },
    },
  },
  { timestamps: true }
);

bucketSchema.index({ isDefault: -1, name: 1 });

bucketSchema.methods.setSecret = function setSecret(plain) {
  this.secretEnc = secretBox.encrypt(plain);
};

bucketSchema.methods.secret = function secret() {
  return secretBox.decrypt(this.secretEnc);
};

bucketSchema.methods.preset = function preset() {
  return providers.get(this.provider);
};

/** Identity of the connection, used to drop cached S3 clients after an edit. */
bucketSchema.methods.signature = function signature() {
  return [this.endpoint, this.region, this.accessKey, this.forcePathStyle, this.secretEnc].join('|');
};

bucketSchema.methods.label = function label() {
  const preset = this.preset();
  return preset ? `${preset.label} ${preset.product}` : this.provider;
};

/** Safe view for templates: no secret, ever. */
bucketSchema.methods.toCard = function toCard() {
  return {
    _id: this._id,
    name: this.name,
    provider: this.provider,
    providerLabel: this.label(),
    bucket: this.bucket,
    region: this.region,
    endpoint: this.endpoint,
    publicUrl: this.publicUrl,
    accessKeyMasked: secretBox.mask(this.accessKey),
    supportsAcl: this.supportsAcl,
    isDefault: this.isDefault,
    active: this.active,
    status: this.status,
  };
};

module.exports = model('Bucket', bucketSchema);
