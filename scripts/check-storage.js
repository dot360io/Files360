// Tests every connected bucket end to end: npm run check-storage
const { connectDatabase, mongoose } = require('../config/database');
const Bucket = require('../models/Bucket');
const storage = require('../utils/storage');

(async () => {
  await connectDatabase();
  const buckets = await Bucket.find().sort({ isDefault: -1, name: 1 });

  if (buckets.length === 0) {
    console.log('No storage connected. Add one in the dashboard under Storage.');
    await mongoose.disconnect();
    process.exit(1);
  }

  let failed = 0;
  for (const bucket of buckets) {
    const tag = `${bucket.name} (${bucket.label()}, ${bucket.bucket})${bucket.isDefault ? ' [default]' : ''}`;
    const result = await storage.verify(bucket);
    bucket.status = { ok: result.ok, publicOk: result.publicOk, error: result.error, checkedAt: new Date() };
    await bucket.save();

    if (!result.ok) {
      failed += 1;
      console.error(`FAIL  ${tag}\n      ${result.error}`);
    } else if (result.publicOk === false) {
      failed += 1;
      console.error(`FAIL  ${tag}\n      Uploads work but ${bucket.publicUrl} did not serve the test file. Is the bucket public?`);
    } else {
      console.log(`OK    ${tag}\n      upload, public read and delete all succeeded`);
    }
  }

  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (err) => {
  console.error('Storage check failed:', err.name, err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
