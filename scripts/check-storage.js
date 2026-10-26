// Tests every connected bucket end to end: npm run check-storage
const db = require('../db');
const { connectConfigured } = require('../utils/boot');
const storage = require('../utils/storage');

(async () => {
  await connectConfigured();
  const buckets = await db.buckets.list();

  if (buckets.length === 0) {
    console.log('No storage connected. Add one in the dashboard under Storage.');
    await db.close();
    process.exit(1);
  }

  let failed = 0;
  for (const bucket of buckets) {
    const tag = `${bucket.name} (${db.buckets.label(bucket)}, ${bucket.bucket})${bucket.isDefault ? ' [default]' : ''}`;
    const result = await storage.verify(bucket);
    bucket.status = { ok: result.ok, publicOk: result.publicOk, error: result.error, checkedAt: new Date() };
    await db.buckets.save(bucket);

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

  await db.close();
  process.exit(failed ? 1 : 0);
})().catch(async (err) => {
  console.error('Storage check failed:', err.name, err.message);
  await db.close();
  process.exit(1);
});
