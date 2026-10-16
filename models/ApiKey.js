const { Schema, model } = require('mongoose');

const apiKeySchema = new Schema(
  {
    app: { type: Schema.Types.ObjectId, ref: 'App', required: true, index: true },
    label: { type: String, trim: true, maxlength: 60, default: 'default' },
    prefix: { type: String, required: true, unique: true },
    hash: { type: String, required: true },
    last4: { type: String },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = model('ApiKey', apiKeySchema);
