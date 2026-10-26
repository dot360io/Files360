const path = require('path');
const express = require('express');
const session = require('express-session');
const { ConnectSessionKnexStore } = require('connect-session-knex');
const helmet = require('helmet');

const config = require('./config/env');
const db = require('./db');
const { boot } = require('./utils/boot');

const { csrf, flash, requireAdmin, loadNav } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { HttpError } = require('./utils/errors');
const optimizer = require('./utils/optimizer');
const storage = require('./utils/storage');
const fmt = require('./utils/format');
const icon = require('./utils/icons');
const logo = require('./utils/providerLogos');
const openapi = require('./utils/openapi');
const setup = require('./controllers/setupController');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.locals.appName = config.appName;
app.locals.fmt = fmt;
app.locals.icon = icon;
app.locals.logo = logo;
// Static assets are cached for a day, so their URLs carry a build stamp.
// Without it a deploy leaves browsers on the previous CSS.
app.locals.assetV = ['css/app.css', 'js/app.js']
  .map((f) => {
    try {
      return Math.round(require('fs').statSync(path.join(__dirname, 'public', f)).mtimeMs).toString(36);
    } catch {
      return '0';
    }
  })
  .join('');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        // Buckets are added and removed at runtime, so the allowed image
        // origins are read from the cache on every request.
        'img-src': ["'self'", 'data:', 'blob:', () => storage.cachedOrigins().join(' ') || "'self'"],
        // Documents are previewed straight from the bucket, PDFs inside a frame
        'frame-src': ["'self'", 'blob:', () => storage.cachedOrigins().join(' ') || "'self'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
  })
);

app.get('/health', async (req, res) => {
  res.json({
    ok: config.setupNeeded ? true : await db.ping(),
    ...(config.setupNeeded ? { setup: true } : {}),
    queue: optimizer.queueStats(),
    uptime: Math.round(process.uptime()),
  });
});

app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Public descriptions of the API for tools and agents, pointed at this instance
app.get('/openapi.json', (req, res) => res.json(openapi.spec(config.publicUrl)));
app.get('/llms.txt', (req, res) => res.type('text/plain; charset=utf-8').send(openapi.llmsTxt(config.publicUrl)));

/**
 * Everything after this point is one of two routers: the setup wizard while
 * the install is unconfigured, the real app afterwards. Finishing the wizard
 * swaps them in place, so nobody has to restart anything.
 */
let current = null;
app.use((req, res, next) => current(req, res, next));

let originTimer = null;

function mainRouter() {
  const router = express.Router();

  // Public API: API keys, no cookies
  router.use('/v1', require('./routes/api'));

  // Dashboard: session cookie
  router.use(
    session({
      name: 'files360.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new ConnectSessionKnexStore({ knex: db.knex(), tableName: 'sessions', cleanupInterval: 15 * 60_000 }),
      cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 24 * 3600 * 1000 },
    })
  );
  router.use(express.urlencoded({ extended: false, limit: '256kb' }));
  router.use(csrf);
  router.use(flash);

  router.use(require('./routes/auth'));

  router.use(requireAdmin, loadNav);
  router.use('/', require('./routes/dashboard'));
  router.use('/library', require('./routes/library'));
  router.use('/apps', require('./routes/apps'));
  router.use('/storage', require('./routes/buckets'));

  router.use((req, res, next) => next(new HttpError(404, 'not_found', 'This page does not exist')));
  router.use(errorHandler);
  return router;
}

async function startMain() {
  await storage.refreshOrigins();
  clearInterval(originTimer);
  originTimer = setInterval(() => storage.refreshOrigins().catch(() => {}), 60_000);
  originTimer.unref();
  config.setupNeeded = false;
  current = mainRouter();
}

async function start() {
  const { setupNeeded } = await boot();

  if (setupNeeded) {
    config.setupNeeded = true;
    current = setup.router({ onComplete: startMain });
  } else {
    await startMain();
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(`[files360] running on http://${config.host}:${config.port}`);
    if (setupNeeded) setup.announce();
  });

  const shutdown = (signal) => {
    console.log(`[files360] ${signal}, shutting down`);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 12_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[files360] failed to start', err);
  process.exit(1);
});
