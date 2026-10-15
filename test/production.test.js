// Production-hardening tests. Run: npm test  (in-memory Postgres)
const assert = require('assert');
const { newDb, DataType } = require('pg-mem');

let n = 0; const ok = (m) => console.log(`  ✓ P${++n}. ${m}`);

(async () => {
  Object.assign(process.env, { LOG_LEVEL: 'silent', NODE_ENV: 'test', RATE_LIMIT_MAX: '14', SESSION_SECRET: 'p'.repeat(40) });
  const config = require('../src/config');
  const db = require('../src/db');
  const migrate = require('../src/migrate');
  const { createApp, start } = require('../server');

  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const good = { first_name: 'Asha', last_name: 'Nair', country: 'IN', phone: '9876543210', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', course: 'cybersecurity' };
  const post = (b) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

  /* ---- headers / CSP ---- */
  let r = await fetch(base + '/cybersecurity');
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff'); assert(!r.headers.get('x-powered-by'));
  assert(/^[\w-]{8,}$/.test(r.headers.get('x-request-id'))); ok('security headers set, X-Powered-By removed, X-Request-Id present');
  for (const u of ['/', '/cybersecurity', '/register.html']) {
    const csp = (await fetch(base + u)).headers.get('content-security-policy');
    assert(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'") && csp.includes("connect-src 'self'") && !/https?:\/\/(?!fonts)/.test(csp.replace(/https:\/\/fonts\.\w+\.com/g, '')), u);
  }
  ok('registration page: strict CSP (own scripts only, only same-origin requests, no framing)');
  r = await fetch(base + '/x', { headers: { 'x-request-id': 'my-trace-id-12345' } }); assert.strictEqual(r.headers.get('x-request-id'), 'my-trace-id-12345'); ok('incoming X-Request-Id is honoured');

  /* ---- no leftovers from the CRM / old admin ---- */
  const html = await (await fetch(base + '/register.html')).text(), js = await (await fetch(base + '/register.js')).text(), cfg = await (await fetch(base + '/config.js')).text();
  for (const bad of ['crm', 'CRM', 'apiBaseUrl', 'API_BASE_URL', 'ADMIN_TOKEN']) assert(!(html + js + cfg).includes(bad), bad);
  ok('browser files contain no CRM key, API base link or admin token');

  /* ---- error handling ---- */
  r = await fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  let j = await r.json(); assert.strictEqual(r.status, 400); assert.strictEqual(j.error, 'Invalid JSON'); assert(!JSON.stringify(j).includes('at ')); ok('malformed JSON -> 400 JSON error, no stack trace');
  r = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' }); assert.strictEqual(r.status, 400); assert.strictEqual((await r.json()).ok, false); ok('malformed JSON on the admin API -> JSON 400 too');
  r = await post({ ...good, pad: 'x'.repeat(30000) }); assert.strictEqual(r.status, 413); ok('oversized body -> 413');
  r = await fetch(base + '/api/nothing'); assert.strictEqual(r.status, 404); assert.strictEqual((await r.json()).ok, false); ok('unknown API route -> JSON 404');
  r = await fetch(base + '/admin/nothing'); assert.strictEqual(r.status, 404); ok('unknown /admin path -> 404');
  r = await fetch(base + '/ready'); assert.strictEqual(r.status, 200); ok('/ready reports DB up');

  /* ---- rate limit ---- */
  let got429 = false;
  for (let i = 0; i < 20 && !got429; i++) got429 = (await post({ ...good, client_id: 'rl-' + 'x'.repeat(16) + i })).status === 429;
  assert(got429); ok('public POST /api/leads is rate limited per IP');

  /* ---- config validation ---- */
  const A = config.admin;
  const bad = config.validate({ ...config, nodeEnv: 'production', port: 99999, timezone: 'Mars/Base', admin: { ...A, username: 'x!', password: 'short', sessionSecret: '' } });
  for (const frag of ['PORT', 'TIMEZONE', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET is required']) assert(bad.some((e) => e.includes(frag)), frag);
  assert(config.validate({ ...config, admin: { ...A, username: 'boss', password: '' } }).some((e) => e.includes('ADMIN_PASSWORD is required')));
  assert(config.validate({ ...config, admin: { ...A, sessionSecret: 'short' } }).some((e) => e.includes('at least 32')));
  assert.deepStrictEqual(config.validate(config), []); ok('config validation reports every bad setting at once; valid config passes');

  /* ---- start + graceful shutdown ---- */
  server.close();
  process.env.PORT = '38917'; config.port = 38917;
  config.admin.username = 'owner'; config.admin.password = 'owner-password-123';
  const mem = newDb(); const lockCalls = [];
  mem.public.registerFunction({ name: 'pg_advisory_lock', args: [DataType.integer], returns: DataType.bool, implementation: (k) => { lockCalls.push('lock:' + k); return true; } });
  mem.public.registerFunction({ name: 'pg_advisory_unlock', args: [DataType.integer], returns: DataType.bool, implementation: (k) => { lockCalls.push('unlock:' + k); return true; } });
  const app2 = await start({ pool: new (mem.adapters.createPg().Pool)() });
  assert.deepStrictEqual(lockCalls, ['lock:727274', 'unlock:727274']); ok('startup migration takes the advisory lock and releases it');
  const login = await fetch('http://127.0.0.1:38917/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'owner-password-123' }) });
  assert.strictEqual(login.status, 200); ok('start() creates the admin from ADMIN_USERNAME / ADMIN_PASSWORD, so you can sign in right away');
  assert.strictEqual((await fetch('http://127.0.0.1:38917/ready')).status, 200);
  await app2.shutdown('TEST', { exit: false });
  await assert.rejects(fetch('http://127.0.0.1:38917/ready')); ok('shutdown() drains, stops accepting connections and closes the DB pool');

  console.log(`\nAll ${n} production checks passed`); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
