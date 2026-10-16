const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');

const config = require('./config/env');
const { connectDatabase, mongoose } = require('./config/database');

const { csrf, flash, requireAdmin, loadNav } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { HttpError } = require('./utils/errors');
const optimizer = require('./utils/optimizer');
const storage = require('./utils/storage');
const fmt = require('./utils/format');
const icon = require('./utils/icons');
const logo = require('./utils/providerLogos');

const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const libraryRoutes = require('./routes/library');
const appRoutes = require('./routes/apps');
const bucketRoutes = require('./routes/buckets');

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

app.get('/health', (req, res) => {
  res.json({
    ok: mongoose.connection.readyState === 1,
    queue: optimizer.queueStats(),
    uptime: Math.round(process.uptime()),
  });
});

app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Public API: API keys, no cookies
app.use('/v1', apiRoutes);

// Dashboard: session cookie
app.use(
  session({
    name: 'files360.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: config.mongoUri, ttl: 7 * 24 * 3600 }),
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 24 * 3600 * 1000 },
  })
);
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(csrf);
app.use(flash);

app.use(authRoutes);

app.use(requireAdmin, loadNav);
app.use('/', dashboardRoutes);
app.use('/library', libraryRoutes);
app.use('/apps', appRoutes);
app.use('/storage', bucketRoutes);

app.use((req, res, next) => next(new HttpError(404, 'not_found', 'This page does not exist')));
app.use(errorHandler);

async function start() {
  await connectDatabase();

  await storage.refreshOrigins();
  const originTimer = setInterval(() => storage.refreshOrigins().catch(() => {}), 60_000);
  originTimer.unref();

  const server = app.listen(config.port, config.host, () => {
    console.log(`[files360] running on http://${config.host}:${config.port}`);
  });

  const shutdown = (signal) => {
    console.log(`[files360] ${signal}, shutting down`);
    server.close(async () => {
      await mongoose.disconnect().catch(() => {});
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
