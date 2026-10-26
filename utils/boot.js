/**
 * Decides at startup whether the app can run or has to show the setup wizard,
 * and leaves the database connected and migrated whenever one is known.
 */
const bcrypt = require('bcryptjs');
const config = require('../config/env');
const db = require('../db');

async function connectConfigured() {
  if (!config.database) {
    throw new Error('Files360 is not set up yet. Start the server and finish the setup wizard first, or set DATABASE_URL.');
  }
  await db.connect(config.database, config.dataDir);
  // Every boot brings the schema up to date, so an upgrade is a restart
  await db.migrate();
}

/** Returns { setupNeeded }. */
async function boot() {
  if (!config.database) return { setupNeeded: true };

  await connectConfigured();
  console.log(`[database] ${db.describe(config.dataDir)}`);

  let admins = await db.admins.count();
  if (admins === 0 && config.envAdmin) {
    const { email, password, passwordHash } = config.envAdmin;
    if (password !== null && password.length < 10) {
      throw new Error('ADMIN_PASSWORD needs at least 10 characters.');
    }
    await db.admins.create({ email, passwordHash: passwordHash || (await bcrypt.hash(password, 12)) });
    admins = 1;
    console.log(`[files360] created the administrator ${email} from the environment`);
  }

  if (admins > 0) return { setupNeeded: false };

  // The database came from DATABASE_URL but nobody can sign in yet: the wizard
  // runs without its database step
  if (!config.hasConfigFile) return { setupNeeded: true };

  // Setup finished once, so the wizard stays shut; the environment is the way back in
  console.warn('[files360] no administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) and restart to create one.');
  return { setupNeeded: false };
}

module.exports = { boot, connectConfigured };
