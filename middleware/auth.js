const crypto = require('crypto');
const db = require('../db');
const { HttpError } = require('../utils/errors');

function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;

  if (req.method === 'GET' || req.method === 'HEAD') return next();

  const sent = Buffer.from(String((req.body && req.body._csrf) || req.get('x-csrf-token') || ''));
  const expected = Buffer.from(req.session.csrf);
  if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    throw new HttpError(403, 'csrf_failed', 'Your session expired. Reload the page and try again');
  }
  next();
}

// One-time messages shown after a redirect
function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, msg) => {
    req.session.flash = { type, msg };
  };
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.admin) {
    res.locals.admin = req.session.admin;
    return next();
  }
  if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  throw new HttpError(401, 'unauthorized', 'Sign in again to continue');
}

// Apps for the sidebar and the upload dialog
async function loadNav(req, res, next) {
  const [navApps, storageCount] = await Promise.all([
    db.apps.list(),
    db.buckets.count({ active: true }),
  ]);
  res.locals.navApps = navApps;
  // Drives the warning dot next to Storage when nothing is connected
  res.locals.storageCount = storageCount;
  res.locals.currentPath = req.path;
  next();
}

function safeNext(value, fallback = '/') {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

module.exports = { csrf, flash, requireAdmin, loadNav, safeNext };
