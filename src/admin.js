const path = require('path');
const express = require('express');
const config = require('./config');
const log = require('./logger');
const rateLimit = require('./rateLimit');
const Lead = require('./models/Lead');
const Admin = require('./models/Admin');
const auth = require('./auth');
const { buildWorkbook } = require('./export');
const { STATUSES, COURSES, COURSE_PATHS, DEFAULT_SLUGS } = require('./options');  const courses = require('./courses');
  const Course = require('./models/Course');
const Visit = require('./models/Visit');
const { getAnalytics, visitPlatform, NO_PLATFORM } = require('./analytics');
const { zonedMidnight, parseYMD, ymd } = require('./time');
const crypto = require('crypto');
const { parseLink, pathOf } = require('./linkparse');
const { mountStudio } = require('./studio');
const { getInsights } = require('./insights');
const forms = require('./forms');
const campaigns = require('./campaigns');
const db = require('./db');

const VIEWS = path.join(__dirname, '..', 'admin', 'views');
const COUNTRIES = require('./countries').COUNTRIES;
const ASSETS = path.join(__dirname, '..', 'admin', 'assets');

/** Same locked-down policy as the registration page: only our own scripts and styles, no framing. */
const PAGE_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
  "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');

const noStore = (res) => res.set('Cache-Control', 'no-store');
/** The studio embeds its own preview page in a frame; the preview may only be framed by the admin itself. */
const STUDIO_CSP = PAGE_CSP.replace("default-src 'none'", "default-src 'none'; frame-src 'self'");
const PREVIEW_CSP = PAGE_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
const sendPage = (res, file, csp = PAGE_CSP) => {
  res.set({ 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.sendFile(path.join(VIEWS, file));
};

function createAdminRouter() {
  const secret = config.admin.sessionSecret || crypto.randomBytes(32).toString('hex');
  if (!config.admin.sessionSecret) log.warn('SESSION_SECRET is not set: using a temporary secret, admins are signed out on every restart');
  const maxAge = config.admin.sessionHours * 3600;
  const tz = config.timezone;
  const router = express.Router();

  /** The signed-in admin for this request, or null. Re-checks the database, so a changed password signs the user out. */
  async function currentAdmin(req) {
    const s = auth.readSession(secret, auth.parseCookies(req.headers.cookie)[auth.COOKIE]);
    if (!s) return null;
    const admin = await Admin.findByUsername(s.username);
    if (!admin || auth.fingerprint(secret, admin.password_hash) !== s.v) return null;
    return admin;
  }
  const guard = (kind) => async (req, res, next) => {
    try {
      const admin = await currentAdmin(req);
      if (admin) { req.admin = admin; return next(); }
      noStore(res);
      if (kind === 'page') return res.redirect('/admin/login');
      res.status(401).json({ ok: false, error: 'Please sign in again.' });
    } catch (e) { next(e); }
  };
  const needPage = guard('page'), needApi = guard('api');
  router.use((_req, _res, next) => { courses.ensureFresh().then(() => next(), () => next()); });   // master classes follow the database
  const jsonOnly = (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ ok: false, error: 'Send JSON' }));

  /* ---------- pages ---------- */
  router.get('/login', async (req, res, next) => {
    try { if (await currentAdmin(req)) return res.redirect('/admin'); sendPage(res, 'login.html'); } catch (e) { next(e); }
  });
  router.get('/', needPage, (_req, res) => sendPage(res, 'dashboard.html'));
  router.get('/analytics', needPage, (_req, res) => sendPage(res, 'analytics.html'));
  router.get('/qr', needPage, (_req, res) => sendPage(res, 'qr.html'));
  mountStudio(router, { needApi, needPage, jsonOnly, sendPage, studioCsp: STUDIO_CSP, previewCsp: PREVIEW_CSP, origin: (req) => require('./campaigns').origin(req) });
  router.get('/config.js', (req, res) => {
    const cfg = {
      courses: COURSES,
      aliases: Object.assign({}, O.ALIASES),
      countries: COUNTRIES,
      statuses: STATUSES,
      cities: []
    };
    res.set({ 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' });
    res.type('js').send('window.KNOA_CONFIG = ' + JSON.stringify(cfg) + ';');
  });

  router.use('/assets', express.static(ASSETS, { index: false, maxAge: 0, etag: true }));

  /* ---------- browser config (generated: master classes / countries / settings, no DB query for the lists) ---------- */
  router.get('/config.js', (req, res) => {
    const cfg = {
      courses: COURSES,
      aliases: Object.assign({}, O.ALIASES),
      countries: COUNTRIES,
      statuses: STATUSES,
      cities: []
    };
    res.set({ 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' });
    res.type('js').send('window.KNOA_CONFIG = ' + JSON.stringify(cfg) + ';');
  });

  /* ---------- auth API ---------- */
  router.post('/api/login', rateLimit({ max: config.admin.loginMax }), jsonOnly, express.json({ limit: '2kb' }), async (req, res, next) => {
    try {
      noStore(res);
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 100 || password.length > 200) {
        return res.status(400).json({ ok: false, error: 'Enter your ID and password.' });
      }
      const admin = await Admin.findByUsername(username);
      const good = await auth.verifyPassword(password, admin ? admin.password_hash : await auth.dummyHash());
      if (!admin || !good) {
        req.log.warn('admin login failed');
        return res.status(401).json({ ok: false, error: 'Incorrect ID or password.' });
      }
      await Admin.touchLogin(admin.id);
      const token = auth.signSession(secret, { username: admin.username, passwordHash: admin.password_hash, hours: config.admin.sessionHours });
      res.set('Set-Cookie', auth.sessionCookie(token, { maxAgeSeconds: maxAge, secure: req.secure }));
      req.log.info({ admin: admin.username }, 'admin signed in');
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.post('/api/logout', jsonOnly, express.json({ limit: '2kb' }), (req, res) => {
    noStore(res);
    res.set('Set-Cookie', auth.sessionCookie('', { maxAgeSeconds: 0, secure: req.secure }));
    res.json({ ok: true });
  });

  router.get('/api/me', needApi, (req, res) => { noStore(res); res.json({ ok: true, username: req.admin.username, timezone: tz }); });

  /* ---------- data API ---------- */
  /** Turn query-string filters into safe, typed filters. Dates are whole days in the configured time zone. */
  function parseFilters(q = {}) {
    const f = {};
    const text = String(q.q || '').trim().slice(0, 100);
    if (text) f.q = text;
    if (STATUSES.includes(q.status)) f.status = q.status;
    if (q.course === Lead.NO_COURSE) f.course = Lead.NO_COURSE;
    else if (/^[a-z0-9-]{1,80}$/.test(String(q.course || ''))) f.course = q.course;
    const from = parseYMD(q.from), to = parseYMD(q.to);
    if (from) f.from = zonedMidnight(tz, from.y, from.m, from.d);
    if (to) f.to = zonedMidnight(tz, to.y, to.m, to.d + 1);        // "to" day included -> exclusive next midnight
    return f;
  }
  const describe = (q) => {
    const bits = [];
    if (q.q) bits.push(`search "${String(q.q).slice(0, 100)}"`);
    if (STATUSES.includes(q.status)) bits.push(`I am a: ${q.status}`);
    if (q.course) bits.push(`course: ${q.course === Lead.NO_COURSE ? 'no course in link' : q.course}`);
    if (parseYMD(q.from)) bits.push(`from ${q.from}`);
    if (parseYMD(q.to)) bits.push(`to ${q.to}`);
    return bits.join(', ');
  };

  const publicRow = (l) => {
    const { ip, user_agent, client_id, ip_hash, visitor_id, session_id, ...rest } = l;       // never send these to the browser
    return rest;
  };

  /**
   * Every master class is always selectable in the filters, even before its first lead arrives. Forms created on their own are
   * not master classes, but their leads carry their link key, so they are listed too (and form creation never needs a course row).
   */
  const courseChoices = async () => {
    const list = Object.entries(COURSES).map(([slug, name]) => ({ slug, name }));
    try {
      const { rows } = await db.query('SELECT course_slug, name FROM forms ORDER BY id');
      for (const f of rows) if (!list.some((c) => c.slug === f.course_slug)) list.push({ slug: f.course_slug, name: f.name });
    } catch { /* the built-in master classes still work when the database cannot be read */ }
    list.push({ slug: Lead.NO_COURSE, name: 'No course in link' });
    return list;
  };

  /**
   * Choices for the "I am a" and "Master class" dropdowns. Needs no database query (the lists live in memory and
   * follow the courses table), so the dropdowns work even while the counts are failing.
   */
  router.get('/api/filters', needApi, async (_req, res) => {
    noStore(res);
    res.json({ ok: true, statuses: STATUSES, courses: await courseChoices() });
  });


  /* ---------- auth API ---------- */

  router.get('/api/stats', needApi, async (req, res) => {
    noStore(res);
    try { res.json({ ok: true, ...(await Lead.stats({ tz })), statuses: STATUSES, courses: await courseChoices() }); }
    catch (e) { req.log.error({ err: e.message, code: e.code }, 'admin stats failed'); res.status(500).json({ ok: false, error: 'Database error' }); }
  });

  /**
   * Live analytics (polled every second by /admin/analytics). Filters: status ("I am a"), course (master class slug or
   * __none), and the window: days=7|14|30|60|90, or from / to (YYYY-MM-DD). See src/analytics.js for the response.
   */
  router.get('/api/analytics', needApi, async (req, res) => {
    noStore(res);
    try { res.json({ ok: true, ...(await getAnalytics({ tz, query: req.query })) }); }
    catch (e) { log.error({ err: e.message }, 'admin analytics failed'); res.status(500).json({ ok: false, error: 'Database error' }); }
  });

  router.get('/api/insights', needApi, async (req, res) => {
    noStore(res);
    try { res.json({ ok: true, ...(await getInsights({ tz, query: req.query })) }); }
    catch (e) { log.error({ err: e.message }, 'admin insights failed'); res.status(500).json({ ok: false, error: 'Database error' }); }
  });

  /**
   * Link search on the analytics page: paste any registration / ad link and get back the master class, channel, medium and
   * campaign it carries, as the filters the analytics page understands. Nothing is stored and the link is never fetched.
   */
  router.get('/api/link-lookup', needApi, async (req, res, next) => {
    noStore(res);
    try {
      const r = typeof req.query.url === 'string' ? parseLink(req.query.url, req.hostname) : { ok: false, error: 'Paste a link first.' };   // a repeated ?url=a&url=b is not a link
      if (!r.ok) return res.status(422).json(r);
      /* a form created on its own is not a master class: recognise its path so a pasted link still selects it */
      if (r.unknownCourse) {
        const seg = pathOf(req.query.url);
        const found = seg ? await forms.findForPath(seg) : null;
        if (found && found.form && found.form.status !== 'archived') {
          r.course = { slug: found.form.course_slug, name: found.form.name, path: found.form.path };
          r.filters.course = found.form.course_slug;
          r.unknownCourse = false;
        }
      }
      res.json(r);
    } catch (e) { next(e); }
  });

  router.get('/api/leads', needApi, async (req, res) => {
    noStore(res);
    const pageSize = [10, 25, 50, 100].includes(+req.query.pageSize) ? +req.query.pageSize : 25;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    try {
      const r = await Lead.list({ limit: pageSize, offset: (page - 1) * pageSize, ...parseFilters(req.query) });
      res.json({ ok: true, page, pageSize, total: r.total, pages: Math.max(1, Math.ceil(r.total / pageSize)), rows: r.rows.map(publicRow) });
    } catch (e) { log.error({ err: e.message }, 'admin list failed'); res.status(500).json({ ok: false, error: 'Database error' }); }
  });

  router.get('/api/leads.xlsx', needApi, async (req, res) => {
    noStore(res);
    try {
      const [leads, stats] = await Promise.all([Lead.all(parseFilters(req.query)), Lead.stats({ tz })]);
      const wb = await buildWorkbook({ leads, stats, filtersText: describe(req.query), tz });
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="knoalabs-leads-${ymd(tz, new Date())}.xlsx"`
      });
      await wb.xlsx.write(res);
      res.end();
      req.log.info({ admin: req.admin.username, rows: leads.length }, 'leads exported to Excel');
    } catch (e) {
      log.error({ err: e.message }, 'excel export failed');
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'Could not build the Excel file' });
      else res.end();
    }
  });


  /* ---------- master classes (course links) ---------- */
  const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
  /* Link opens per master class, with the Meta app they came from (Facebook / Instagram / ...). Opens that are not Meta
     traffic are only in the total. slug (null = plain link) -> { Instagram: n, Facebook: n, ... } */
  const opensByApp = (groups) => {
    const by = new Map();
    for (const g of groups) {
      const app = visitPlatform(g);
      if (app === NO_PLATFORM) continue;
      const m = by.get(g.course_slug || null) || {};
      m[app] = (m[app] || 0) + g.n; by.set(g.course_slug || null, m);
    }
    return by;
  };
  const courseView = (req, c, counts, opens, apps) => ({
    slug: c.slug, name: c.name, path: c.path, url: `${baseUrl(req)}/${c.path}`,
    is_default: Boolean(c.is_default), leads: counts.get(c.slug) || 0, opens: opens.get(c.slug) || 0, opensByApp: apps.get(c.slug) || {}, created_at: c.created_at
  });

  router.get('/api/courses', needApi, async (req, res) => {
    noStore(res);
    try {
      const [rows, counts, opens, groups] = await Promise.all([Course.all(), Course.leadCounts(), Visit.countsByCourse(), Visit.countsByCourseSource()]);
      const apps = opensByApp(groups);
      res.json({ ok: true, base: baseUrl(req), courses: rows.map((c) => courseView(req, c, counts, opens, apps)), plain: { url: baseUrl(req) + '/', leads: counts.get(null) || 0, opens: opens.get(null) || 0, opensByApp: apps.get(null) || {} } });
    } catch (e) { log.error({ err: e.message }, 'admin courses failed'); res.status(500).json({ ok: false, error: 'Database error' }); }
  });

  router.post('/api/courses', needApi, jsonOnly, express.json({ limit: '2kb' }), async (req, res) => {
    noStore(res);
    try {
      const r = await courses.create((req.body || {}).name);
      if (r.error) return res.status(r.duplicate ? 409 : 422).json({ ok: false, error: r.error });
      await db.query("UPDATE forms SET status='active', updated_at=now() WHERE course_slug=$1 AND status='archived'", [r.course.slug]).catch(() => {});
      await forms.seedDefaultForms().catch((e) => log.warn({ err: e.message }, 'form not created for the new master class'));
      req.log.info({ admin: req.admin.username, course: r.course.slug }, 'master class added');
      res.status(201).json({ ok: true, course: courseView(req, r.course, new Map(), new Map(), new Map()) });
    } catch (e) { log.error({ err: e.message }, 'admin add course failed'); res.status(500).json({ ok: false, error: 'Could not add the master class' }); }
  });

  router.delete('/api/courses/:slug', needApi, async (req, res) => {
    noStore(res);
    try {
      const slug = String(req.params.slug || '');
      if (!/^[a-z0-9]{1,80}$/.test(slug)) return res.status(404).json({ ok: false, error: 'Master class not found.' });
      const r = await courses.remove(slug);
      if (r.error) return res.status(r.status || 400).json({ ok: false, error: r.error });
      await db.query("UPDATE forms SET status='archived', updated_at=now() WHERE course_slug=$1", [slug]).catch(() => {});
      req.log.info({ admin: req.admin.username, course: slug }, 'master class deleted');
      res.json({ ok: true });
    } catch (e) { log.error({ err: e.message }, 'admin delete course failed'); res.status(500).json({ ok: false, error: 'Could not delete the master class' }); }
  });

  /* ---------- delete one lead ---------- */
  router.delete('/api/leads/:id', needApi, async (req, res) => {
    noStore(res);
    const id = String(req.params.id || '');
    if (!/^\d{1,18}$/.test(id)) return res.status(404).json({ ok: false, error: 'Lead not found.' });
    try {
      if (!(await Lead.remove(id))) return res.status(404).json({ ok: false, error: 'Lead not found (already deleted?).' });
      req.log.info({ admin: req.admin.username, leadId: id }, 'lead deleted');
      res.json({ ok: true });
    } catch (e) { log.error({ err: e.message }, 'admin delete lead failed'); res.status(500).json({ ok: false, error: 'Could not delete the lead' }); }
  });

  router.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  router.use((_req, res) => res.status(404).type('text').send('Not found'));
  return router;
}

module.exports = { createAdminRouter };
