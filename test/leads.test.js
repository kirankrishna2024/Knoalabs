// Public registration API + page. Run: npm test
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_MAX = '50';
const assert = require('assert');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const Lead = require('../src/models/Lead');
const { createApp } = require('../server');

const student = {
  first_name: ' Asha ', last_name: 'Nair', country: 'IN', phone: '098765 43210', email: 'asha@example.com',
  status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', college_name: 'MES College',
  course: 'cybersecurity', page_url: 'https://x.test/cybersecurity?utm_source=wa', utm_source: 'wa'
};
const pro = {
  first_name: 'Ravi', last_name: 'Kumar', country: 'IN', phone: '9876543211',
  status: 'Working Professional', experience: '2-5 yrs', current_role: 'QA / Tester', current_company: 'Acme Labs', course: 'ds'
};

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let n = 0; const ok = (m) => console.log(`  ✓ ${++n}. ${m}`);

  /* ---- page + config ---- */
  const cfg = await (await fetch(base + '/config.js')).text();
  assert(cfg.includes('"statuses":["Student / Fresher","Working Professional"]') && cfg.includes('"currentRoles"') && cfg.includes('"experienceOptions"'));
  assert(!cfg.includes('apiBaseUrl')); ok('/config.js serves the form choices and no backend link');
  for (const u of ['/', '/cybersecurity', '/register.html']) {
    const r = await fetch(base + u); assert.strictEqual(r.status, 200, u); assert((await r.text()).includes('formMount'), u);
  }
  ok('/, /cybersecurity and /register.html serve the registration page');
  assert.strictEqual((await fetch(base + '/nope.png')).status, 404); ok('missing files 404');
  for (const u of ['/index.html', '/check.html', '/api/check', '/api/whoami', '/api/stats', '/api/leads.csv']) assert.strictEqual((await fetch(base + u)).status, 404, u);
  ok('old landing page, diagnostics and old token endpoints are gone (404)');
  assert.strictEqual((await fetch(base + '/api/leads')).status, 404); ok('GET /api/leads does not exist: leads can only be read through the admin login');

  /* ---- valid leads ---- */
  let r = await post(student), j = await r.json();
  assert.strictEqual(r.status, 201); assert(j.ok && j.id); ok('student lead saved (201)');
  r = await post(pro); assert.strictEqual(r.status, 201); ok('working professional lead saved (201)');
  await post({ ...pro, first_name: 'Mia', course: 'ai-ml', country: 'XX', phone: '+4915112345678' });

  const rows = (await Lead.list({ limit: 10 })).rows, by = Object.fromEntries(rows.map((x) => [x.first_name, x]));
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(by.Asha.phone, '+919876543210'); ok('phone normalised to E.164');
  assert.strictEqual(by.Asha.student_course, 'BCA'); assert.strictEqual(by.Asha.student_status, 'Final year'); assert.strictEqual(by.Asha.college_name, 'MES College');
  assert.strictEqual(by.Asha.experience_level, null); assert.strictEqual(by.Asha.job_role, null); ok('student answers stored, professional fields empty');
  assert.strictEqual(by.Ravi.experience_level, '2-5 yrs'); assert.strictEqual(by.Ravi.job_role, 'QA / Tester'); assert.strictEqual(by.Ravi.current_company, 'Acme Labs'); assert.strictEqual(by.Ravi.student_course, null); ok('professional answers stored, student fields empty');
  assert.strictEqual(by.Asha.course, 'Cyber Security'); assert.strictEqual(by.Ravi.course, 'Data Science'); assert.strictEqual(by.Mia.course, 'Ai Ml'); ok('course resolved from the link (slug, alias, unknown slug)');
  assert.strictEqual(by.Asha.utm_source, 'wa'); assert(by.Asha.page_url.includes('/cybersecurity')); ok('page link and UTM stored with the lead');
  assert.strictEqual(by.Mia.phone, '+4915112345678'); ok('"Other" country number stored');

  /* ---- validation ---- */
  r = await post({ ...student, phone: '123' }); j = await r.json(); assert.strictEqual(r.status, 422); assert(j.errors.phone); ok('bad phone rejected (422)');
  r = await post({}); j = await r.json(); assert.strictEqual(r.status, 422); assert(j.errors.first_name && j.errors.phone && j.errors.status); ok('empty body: field errors');
  r = await post({ ...student, student_course: '', student_status: '' }); j = await r.json(); assert(j.errors.student_course && j.errors.student_status); ok('student needs course + current status');
  r = await post({ ...pro, experience: '', current_role: '' }); j = await r.json(); assert(j.errors.experience && j.errors.current_role); ok('professional needs experience + role');
  r = await post({ ...pro, current_company: '', first_name: 'NoCo' }); assert.strictEqual(r.status, 201); ok('company is optional');
  r = await post({ ...student, college_name: '', email: '', first_name: 'NoCol' }); assert.strictEqual(r.status, 201); ok('college and email are optional');
  r = await post({ ...student, first_name: 'Spec', specialization: 'Computer Science', phone: '9876500111', client_id: 'spec-client-id-0001' }); assert.strictEqual(r.status, 201);
  assert.strictEqual((await Lead.findById((await r.json()).id)).specialization, 'Computer Science'); r = await post({ ...student, specialization: 'Nonsense', phone: '9876500112' }); assert.strictEqual(r.status, 422);
  r = await post({ ...pro, first_name: 'Qual', highest_qualification: "Master's degree", phone: '9876500113', client_id: 'qual-client-id-0001' }); assert.strictEqual(r.status, 201);
  assert.strictEqual((await Lead.findById((await r.json()).id)).highest_qualification, "Master's degree"); ok('specialization (student) and highest qualification (professional) are saved, and must come from the lists');
  r = await post({ ...student, email: 'not-an-email' }); j = await r.json(); assert(j.errors.email); ok('bad email rejected');
  for (const bad of [{ status: 'Other' }, { status: 'Hacker' }, { student_course: 'Wizardry' }, { student_status: 'Eternal' }]) {
    r = await post({ ...student, ...bad }); assert.strictEqual(r.status, 422, JSON.stringify(bad));
  }
  r = await post({ ...pro, experience: '40 yrs' }); assert.strictEqual(r.status, 422); r = await post({ ...pro, current_role: 'King' }); assert.strictEqual(r.status, 422);
  ok('values outside the allowed lists are rejected');
  const cnt = (await Lead.list({ limit: 1 })).total;
  r = await post({ ...student, website: 'http://spam' }); assert((await r.json()).ok); assert.strictEqual((await Lead.list({ limit: 1 })).total, cnt); ok('honeypot: pretends success, stores nothing');

  /* ---- duplicates ---- */
  const cid = 'client-id-abcdef123456';
  const a = await post({ ...student, first_name: 'Dup', client_id: cid }), b = await post({ ...student, first_name: 'Dup', client_id: cid });
  const ja = await a.json(), jb = await b.json();
  assert.strictEqual(a.status, 201); assert.strictEqual(b.status, 200); assert(jb.duplicate && ja.id === jb.id); ok('same client_id twice: 201 then 200 duplicate, same lead');
  assert.strictEqual((await Lead.list({ q: 'Dup' })).total, 1); ok('only one row stored for the double submit');

  assert.strictEqual((await fetch(base + '/api/health')).status, 200); ok('/api/health db up');
  server.close(); console.log(`\nAll ${n} registration checks passed`); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
