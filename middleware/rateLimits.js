const rateLimit = require('express-rate-limit');
const config = require('../config/env');

const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: config.limits.apiRatePerMin,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.appDoc._id),
  handler: (req, res) =>
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests, retry in a minute' } }),
});

const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) =>
    res.status(429).render('auth/login', {
      title: 'Sign in',
      error: 'Too many attempts. Wait 15 minutes and try again.',
      next: '/',
    }),
});

module.exports = { apiRateLimit, loginRateLimit };
