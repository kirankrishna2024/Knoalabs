require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const crypto = require('crypto');
const path = require('path');

const config = require('./src/config');
const log = require('./src/logger');
const db = require('./src/db');
const migrate = require('./src/migrate');
const auth = require('./src/auth');
const Admin = require('./src/models/Admin');
const leadsRouter = require('./src/leads');
const { createAdminRouter } = require('./src/admin');
const { COUNTRIES } = require('./src/countries');
const O = require('./src/options');
const { resolveCourse } = require('./src/validate');
const courses = require('./src/courses');
const fs = require('fs');
const { version: VERSION } = require('./package.json');

let shuttingDown = false;
const PUBLIC = path.join(__dirname, 'public');

/** Strict CSP for the registration page: only our own scripts/styles and Google Fonts, no framing. */
function registerCsp() {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
  ].join('; ');
}

function createApp() {
  const app = express();
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.disable('x-powered-by');

  /* ---- request id + structured access log (no bodies, no query strings, no personal data) ---- */
  app.use(pinoHttp({
    logger: log,
    genReqId: (req, res) => {
      const given = String(req.headers['x-request-id'] || '');
      const id = /^[\w-]{8,64}$/.test(given) ? given : crypto.randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url === '/health' },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: String(r.url).split('?')[0] }), res: (r) => ({ statusCode: r.statusCode }) }
  }));

  /* ---- security headers (CSP is set per page) ---- */
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));

  /* ---- liveness / readiness ---- */
  app.get('/health', (_req, res) => res.send('ok'));                 // process is up (use for restart checks)
  const ready = async (_req, res) => {                               // can serve traffic: DB reachable, not shutting down
    if (shuttingDown) return res.status(503).json({ ok: false, status: 'shutting-down', version: VERSION });
    try { await db.ping(); res.json({ ok: true, db: 'up', version: VERSION }); }   // version: lets you confirm which build is live
    catch { res.status(503).json({ ok: false, db: 'down', version: VERSION }); }
  };
  app.get('/ready', ready);
  app.get('/api/health', ready);

  /* ---- form choices for the browser (same lists the server validates against) ---- */
  app.get('/config.js', async (_req, res) => {
    await courses.ensureFresh();
    const cfg = {
      countries: COUNTRIES,
      statuses: O.STATUSES,
      statusSubtitles: O.STATUS_SUBTITLES,
      studentCourses: O.STUDENT_COURSES,
      studentStatuses: O.STUDENT_STATUSES,
      specializations: O.SPECIALIZATIONS,
      qualifications: O.QUALIFICATIONS,
      experienceOptions: O.EXPERIENCE,
      currentRoles: O.ROLES,
      courses: O.COURSES,
      aliases: O.ALIASES
    };
    res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.send('window.KNOA_CONFIG=' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';');
  });

  /* ---- admin panel (/admin): login page, dashboard, JSON API. Must come before the /:course catch-all ---- */
  app.use('/admin', createAdminRouter());

  /* ---- static files ---- */
  app.use(express.static(PUBLIC, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, file) => {
      if (/(register\.(html|js|css)|ui\.css)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');   // always revalidate (etag)
      if (file.endsWith('register.html')) res.setHeader('Content-Security-Policy', registerCsp());
    }
  }));

  /* ---- public JSON API: only POST /api/leads ---- */
  app.use('/api', express.json({ limit: '20kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (_req, _res, next) => { courses.ensureFresh().then(() => next(), () => next()); });
  app.use('/api', leadsRouter);
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  /* ---- registration pages: /  /cybersecurity  /datascience  /generative-ai  (+ aliases like /genai) ----
     Must stay after static + /api + /admin. The HTML is the same file for every link; the server only fills in the
     <title> / share text with the master class name so ad previews and browser tabs say the right thing. */
  const registerHtml = fs.readFileSync(path.join(PUBLIC, 'register.html'), 'utf8');
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pageFor = new Map();                                          // "slug|name" -> html (a handful of entries at most)
  function registerPage(raw) {
    const { slug, name } = resolveCourse(raw);
    if (!name) return registerHtml;
    const key = slug + '|' + name;                                    // the name is part of the key: renaming never serves a stale page
    if (pageFor.has(key)) return pageFor.get(key);
    const title = `Register for the ${escHtml(name)} Master Class | KnoaLabs`;
    const desc = `Register for the KnoaLabs ${escHtml(name)} Master Class.`;
    const html = registerHtml
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${desc}">\n<meta property="og:title" content="${title}">\n<meta property="og:description" content="${desc}">`)
      .replace('<body class="bg-brand">', `<body class="bg-brand" data-course="${escHtml(slug)}" data-course-name="${escHtml(name)}">`);
    if (pageFor.size < 200) pageFor.set(key, html);
    return html;
  }
  app.get(['/', '/:course'], async (req, res, next) => {
    if ((req.params.course || '').includes('.')) return next();
    await courses.ensureFresh();
    res.set({ 'Content-Security-Policy': registerCsp(), 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' });
    res.send(registerPage(req.params.course));
  });

  /* ---- error handling: never leak stack traces or internals ---- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) req.log.error({ err: err.message, stack: err.stack }, 'unhandled error');
    const message = err.type === 'entity.parse.failed' ? 'Invalid JSON'
      : err.type === 'entity.too.large' ? 'Request too large'
      : status >= 500 ? 'Something went wrong. Please try again.' : err.message;
    if (req.path.startsWith('/api') || req.path.startsWith('/admin/api')) return res.status(status).json({ ok: false, error: message });
    res.status(status).type('text').send(message);
  });

  return app;
}

/** Create the first admin from ADMIN_USERNAME / ADMIN_PASSWORD when that user does not exist yet. */
async function seedAdmin() {
  const { username, password } = config.admin;
  if (username && password && !(await Admin.findByUsername(username))) {
    await Admin.upsert(username, await auth.hashPassword(password));
    log.info({ admin: username }, 'admin user created from ADMIN_USERNAME / ADMIN_PASSWORD');
  }
  if ((await Admin.count()) === 0) log.warn('No admin user exists: set ADMIN_USERNAME and ADMIN_PASSWORD, or run "npm run admin:set"');
}

const exit_handlers_enabled = () => require.main === module || process.env.KNOA_HANDLE_SIGNALS === '1';

async function start({ pool: injectedPool } = {}) {
  const problems = config.validate();
  if (problems.length) throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));

  const pool = db.init(injectedPool);
  if (config.autoMigrate) {
    const r = await migrate.run(pool, { log: (m) => log.info(m) });
    log.info({ appliedNow: r.applied.length, total: r.total }, 'database schema up to date');
  } else {
    const s = await migrate.status(pool);
    if (s.pending.length) throw new Error(`${s.pending.length} pending migration(s). Run "npm run migrate" (AUTO_MIGRATE is off).`);
    log.info('database schema verified');
  }
  await seedAdmin();

  /* Listen, and say something useful when the port is taken: a stale instance of an older build is
     the usual reason a "live" dashboard answers with old routes (e.g. 404 Not found on the counts). */
  const server = await new Promise((resolve, reject) => {
    const s = createApp().listen(config.port, '0.0.0.0', () => {
      log.info({ port: config.port, env: config.nodeEnv }, 'listening');
      resolve(s);
    });
    s.once('error', (e) => reject(e.code === 'EADDRINUSE'
      ? new Error(`Port ${config.port} is already in use. Another instance (possibly an older build) is still running: stop it first, then start again.`)
      : e));
  });
  // Longer than typical load-balancer idle timeouts (60s) to avoid spurious 502s.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 30000;

  /* Stop fast and always exit. Ctrl+C (SIGINT), SIGTERM (App Platform / docker stop) and SIGBREAK (Windows) all land here.
     In-flight requests get a short grace period, then every remaining connection (the analytics page polls
     every second, so connections are never idle) is closed, the DB pool is released and the process ends. */
  async function shutdown(signal, { exit = true } = {}) {
    if (shuttingDown) { if (exit && signal === 'SIGINT') process.exit(0); return; }   // second Ctrl+C = leave now
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    const hard = setTimeout(() => { log.error('forced exit'); if (exit) process.exit(1); }, 5000);
    hard.unref();
    const grace = setTimeout(() => { server.closeAllConnections && server.closeAllConnections(); }, 1500);
    grace.unref();
    server.closeIdleConnections && server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close().catch((e) => log.error({ err: e.message }, 'error closing db pool'));
    clearTimeout(hard); clearTimeout(grace);
    log.info('stopped');
    shuttingDown = false;
    if (exit) process.exit(0);
  }
  if (exit_handlers_enabled()) {
    ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'].forEach((sig) => process.on(sig, () => shutdown(sig)));
  }
  return { server, shutdown };
}

if (require.main === module) {
  process.on('unhandledRejection', (e) => log.error({ err: String(e && e.message || e) }, 'unhandled promise rejection'));
  process.on('uncaughtException', (e) => { log.fatal({ err: e.message, stack: e.stack }, 'uncaught exception'); process.exit(1); });
  start().catch((e) => { log.fatal({ err: e.message }, 'startup failed'); process.exit(1); });
}

module.exports = { createApp, start, seedAdmin };
