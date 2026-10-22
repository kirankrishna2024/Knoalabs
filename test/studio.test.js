// Form Studio API, publishing, campaigns, base-link redirect, generated links, same-person detection. Run: node test/studio.test.js
process.env.LOG_LEVEL = 'silent'; process.env.RATE_LIMIT_MAX = '500'; process.env.ADMIN_USERNAME = 'studio.admin'; process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'y'.repeat(40); process.env.ADMIN_LOGIN_MAX = '50';
const assert = require('assert');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const forms = require('../src/forms');
const F = require('../src/formdef');
const campaigns = require('../src/campaigns');
const { createApp, seedAdmin } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ S${++n}. ${m}`);
const clone = (o) => JSON.parse(JSON.stringify(o));

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false }); await seedAdmin(); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  // locked without login
  for (const [m, p] of [['GET', '/admin/api/forms'], ['GET', '/admin/api/campaigns'], ['PUT', '/admin/api/forms/1/draft'], ['POST', '/admin/api/forms/1/publish'], ['GET', '/admin/api/audit'], ['GET', '/admin/api/leads/1/related']]) assert.strictEqual((await call(m, p, m === 'GET' ? undefined : {})).status, 401, p);
  for (const p of ['/admin/forms', '/admin/forms/1', '/admin/forms/1/preview', '/admin/campaigns']) assert.strictEqual((await call('GET', p)).status, 302, p);
  ok('every Form Studio / campaign API answers 401 and every page redirects to the sign-in without a session');
  const login = await call('POST', '/admin/api/login', { username: 'studio.admin', password: 'correct-horse-battery' }); cookie = login.headers.get('set-cookie').split(';')[0];

  let r = await call('GET', '/admin/api/forms'); assert.strictEqual(r.json.forms.length, 3); const ds = r.json.forms.find((f) => f.course_slug === 'datascience'); assert(ds.url.endsWith('/datascience') && ds.published_version === 1 && !ds.has_draft);
  r = await call('GET', `/admin/api/forms/${ds.id}`); assert.strictEqual(r.json.published.version, 1); assert.deepStrictEqual(r.json.problems, []); assert.strictEqual(r.json.working.fields.length, 13); ok('forms list and form detail: published version 1 with the 13 built-in fields, no problems');
  for (const p of ['/admin/forms', `/admin/forms/${ds.id}`, `/admin/forms/${ds.id}/preview`, '/admin/campaigns']) { const x = await call('GET', p); assert.strictEqual(x.status, 200, p); assert(/frame-ancestors/.test(x.headers.get('content-security-policy'))); }
  assert(/frame-src 'self'/.test((await call('GET', `/admin/forms/${ds.id}`)).headers.get('content-security-policy'))); assert(/frame-ancestors 'self'/.test((await call('GET', `/admin/forms/${ds.id}/preview`)).headers.get('content-security-policy'))); assert(/frame-ancestors 'none'/.test((await call('GET', '/admin/forms')).headers.get('content-security-policy')));
  ok('studio pages load under a strict CSP; only the studio may frame the preview, nothing else may be framed');

  /* ---- draft + publish ---- */
  const def = clone(r.json.working);
  def.copy.headline = 'Join the {name} {type} — free'; def.copy.extra = 'Limited seats.';
  const add = (f) => { f.order = def.fields.length; def.fields.push(f); };
  add({ key: 'city', label: 'City', type: 'text', section: 'contact', width: 'half', required: true, maxLength: 40, column: 'job_role' });  // a client-supplied column must be ignored for a new field
  add({ key: 'interests', label: 'Interests', type: 'multiselect', section: 'contact', width: 'full', required: false, options: [{ value: 'ai', label: 'AI' }, { value: 'sec', label: 'Security' }] });
  let d = await call('PUT', `/admin/api/forms/${ds.id}/draft`, { definition: def }); assert.strictEqual(d.status, 200); assert.deepStrictEqual(d.json.problems, []);
  r = await call('GET', `/admin/api/forms/${ds.id}`); assert(r.json.draft && r.json.form.has_draft); assert.strictEqual(r.json.working.fields.find((f) => f.key === 'city').column, undefined); ok('autosave stores one draft; a column sent for a new field is dropped (new fields are custom fields)');
  let page = await (await fetch(base + '/datascience')).text(); assert(!/Limited seats/.test(page)); ok('a draft is not public: the live page still shows version 1');
  d = await call('PUT', `/admin/api/forms/${ds.id}/draft`, { definition: { ...def, fields: def.fields.map((f) => (f.key === 'interests' ? { ...f, options: [] } : f)) } });
  assert(d.json.problems.some((p) => /option/.test(p))); r = await call('POST', `/admin/api/forms/${ds.id}/publish`, { note: 'x' }); assert.strictEqual(r.status, 422); assert(r.json.problems.length); ok('autosave accepts work in progress but reports problems, and publishing is refused until they are fixed');
  await call('PUT', `/admin/api/forms/${ds.id}/draft`, { definition: def });
  r = await call('POST', `/admin/api/forms/${ds.id}/publish`, { note: 'Added city + interests' }); assert.strictEqual(r.json.version, 2);
  page = await (await fetch(base + '/datascience')).text(); const emb = JSON.parse(/id="knoaForm">([\s\S]*?)<\/script>/.exec(page)[1]); assert.strictEqual(emb.version, 2); assert.strictEqual(emb.copy.headline, 'Join the Data Science Master Class — free'); assert(emb.fields.some((f) => f.key === 'city')); assert.strictEqual(emb.copy.extra, 'Limited seats.');
  r = await call('GET', `/admin/api/forms/${ds.id}`); assert(!r.json.draft); ok('publishing creates version 2, clears the draft and the public page switches to it at once');
  assert.strictEqual((await call('GET', `/admin/api/forms/${ds.id}/versions/1`)).json.definition.fields.length, 13);
  r = await call('GET', `/admin/api/forms/${ds.id}/versions`); assert.deepStrictEqual(r.json.versions.map((v) => [v.version, v.live]), [[2, true], [1, false]]); assert.strictEqual(r.json.versions[0].note, 'Added city + interests');
  r = await call('GET', `/admin/api/forms/${ds.id}/versions/2`); assert.deepStrictEqual(r.json.changes.filter((c) => c.kind === 'added').map((c) => c.key), ['city', 'interests']); ok('history lists both versions (who, when, note, which is live) and shows what changed');

  /* ---- a lead on the new form keeps custom answers; one on the old version still works ---- */
  const post = (b) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course: 'datascience', first_name: 'Ravi', last_name: 'K', country: 'IN', phone: '9000000001', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', ...b }) });
  let res = await post({ client_id: 'c'.repeat(20), form_version: 2 }); assert.strictEqual(res.status, 422); assert((await res.json()).errors.city); ok('the new required field is enforced by the server for version 2');
  res = await post({ client_id: 'd'.repeat(20), form_version: 2, city: 'Kochi', interests: ['ai', 'ai'] }); assert.strictEqual(res.status, 201);
  let lead = (await db.query('SELECT * FROM leads WHERE client_id=$1', ['d'.repeat(20)])).rows[0]; const cf = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : lead.custom_fields; assert.deepStrictEqual(cf, { city: 'Kochi', interests: ['ai'] }); assert.strictEqual(lead.form_version, 2);
  res = await post({ client_id: 'e'.repeat(20), form_version: 1, phone: '9000000002' }); assert.strictEqual(res.status, 201); lead = (await db.query('SELECT form_version, custom_fields FROM leads WHERE client_id=$1', ['e'.repeat(20)])).rows[0]; assert.strictEqual(lead.form_version, 1); assert(lead.custom_fields == null);
  ok('custom answers go to custom_fields; a page still showing version 1 can finish its registration (stored as version 1)');

  /* ---- rules for changing a published form ---- */
  r = await call('GET', `/admin/api/forms/${ds.id}`); const w3 = clone(r.json.working); w3.fields.find((f) => f.key === 'city').type = 'textarea'; w3.fields.find((f) => f.key === 'status').column = 'job_role';
  r = await call('PUT', `/admin/api/forms/${ds.id}/draft`, { definition: w3 }); assert(r.json.problems.some((p) => /type cannot change/.test(p)));
  r = await call('POST', `/admin/api/forms/${ds.id}/publish`, {}); assert.strictEqual(r.status, 422); ok('a published field cannot change its type or data column (the editor is told in plain words)');
  const w4 = clone((await call('GET', `/admin/api/forms/${ds.id}/versions/2`)).json.definition); w4.fields.find((f) => f.key === 'college_name').deleted = true; w4.fields.find((f) => f.key === 'city').label = 'Your city'; w4.fields.find((f) => f.key === 'city').order = 0;
  await call('PUT', `/admin/api/forms/${ds.id}/draft`, { definition: w4 }); r = await call('POST', `/admin/api/forms/${ds.id}/publish`, { note: 'Removed college' }); assert.strictEqual(r.json.version, 3);
  res = await post({ client_id: 'f'.repeat(20), phone: '9000000003', city: 'Pune', college_name: 'ignored' }); assert.strictEqual(res.status, 201); lead = (await db.query('SELECT college_name, form_version FROM leads WHERE client_id=$1', ['f'.repeat(20)])).rows[0]; assert.strictEqual(lead.college_name, null); assert.strictEqual(lead.form_version, 3);
  ok('deleting a field removes it from the public form and from validation; version 3 is live and old leads keep their data');
  r = await call('POST', `/admin/api/forms/${ds.id}/publish`, {}); assert.strictEqual(r.status, 422); // no draft
  await call('PUT', `/admin/api/forms/${ds.id}/draft`, { definition: clone((await call('GET', `/admin/api/forms/${ds.id}`)).json.working) }); r = await call('POST', `/admin/api/forms/${ds.id}/publish`, {}); assert(r.json.unchanged); ok('publishing with no real change creates no new version');

  /* ---- restore, rollback ---- */
  r = await call('POST', `/admin/api/forms/${ds.id}/restore`, { version: 1 }); assert.strictEqual(r.json.working.fields.length, 13); assert((await call('GET', `/admin/api/forms/${ds.id}`)).json.form.has_draft);
  assert.strictEqual(JSON.parse(/id="knoaForm">([\s\S]*?)<\/script>/.exec(await (await fetch(base + '/datascience')).text())[1]).version, 3); ok('restoring an old version only fills the draft; the live form does not change until published');
  r = await call('POST', `/admin/api/forms/${ds.id}/rollback`, { version: 1 }); assert.strictEqual(r.json.published_version, 1); assert.strictEqual(JSON.parse(/id="knoaForm">([\s\S]*?)<\/script>/.exec(await (await fetch(base + '/datascience')).text())[1]).version, 1);
  r = await call('POST', `/admin/api/forms/${ds.id}/rollback`, { version: 99 }); assert.strictEqual(r.status, 404); await call('POST', `/admin/api/forms/${ds.id}/rollback`, { version: 3 }); ok('rollback makes an existing version live immediately (and an unknown version is a 404)');

  /* ---- pause / archive ---- */
  r = await call('PATCH', `/admin/api/forms/${ds.id}`, { status: 'paused' }); assert.strictEqual(r.json.form.status, 'paused');
  const closed = JSON.parse(/id="knoaForm">([\s\S]*?)<\/script>/.exec(await (await fetch(base + '/datascience')).text())[1]); assert.strictEqual(closed.closed, true);
  res = await post({ client_id: 'g'.repeat(20), phone: '9000000004', city: 'X1y' }); assert.strictEqual(res.status, 409); ok('a paused form shows the closed notice and refuses registrations (409), nothing is stored');
  await call('PATCH', `/admin/api/forms/${ds.id}`, { status: 'active' }); res = await post({ client_id: 'h'.repeat(20), phone: '9000000004', city: 'Kochi' }); assert.strictEqual(res.status, 201); ok('active again: registrations flow');
  assert.strictEqual((await call('PATCH', `/admin/api/forms/${ds.id}`, { status: 'nonsense' })).status, 422);

  /* ---- same person ---- */
  const a = (await db.query("SELECT id FROM leads WHERE client_id=$1", ['h'.repeat(20)])).rows[0].id;
  res = await post({ client_id: 'i'.repeat(20), phone: '+91 90000 00004', city: 'Kochi', visitor_id: 'visitor-one-123' }); lead = (await db.query('SELECT * FROM leads WHERE client_id=$1', ['i'.repeat(20)])).rows[0];
  assert.strictEqual(lead.is_returning_lead, true); assert.strictEqual(Number(lead.previous_lead_id), Number(a)); assert.strictEqual(lead.match_basis, 'phone'); assert.strictEqual(lead.submission_count, 2);
  res = await post({ client_id: 'j'.repeat(20), phone: '9000000010', email: 'Same@Example.com', city: 'Kochi', visitor_id: 'visitor-two-456' }); res = await post({ client_id: 'k'.repeat(20), phone: '9000000011', email: 'same@example.com', city: 'Kochi', visitor_id: 'visitor-two-456' });
  lead = (await db.query('SELECT * FROM leads WHERE client_id=$1', ['k'.repeat(20)])).rows[0]; assert.strictEqual(lead.match_basis, 'email,device'); res = await post({ client_id: 'l'.repeat(20), phone: '9000000012', city: 'Kochi', visitor_id: 'visitor-fresh-789' });
  lead = (await db.query('SELECT is_returning_lead, match_basis FROM leads WHERE client_id=$1', ['l'.repeat(20)])).rows[0]; assert.strictEqual(lead.is_returning_lead, false); assert.strictEqual(lead.match_basis, null);
  ok('same person: same phone (any spelling) or e-mail (any case) or browser is flagged with the evidence; a stranger is not; nothing is blocked or merged');
  const kid = (await db.query('SELECT id FROM leads WHERE client_id=$1', ['k'.repeat(20)])).rows[0].id; r = await call('GET', `/admin/api/leads/${kid}/related`); assert.strictEqual(r.json.related.length, 1); assert.deepStrictEqual(r.json.related[0].basis, ['email', 'device']); assert.strictEqual((await call('GET', '/admin/api/leads/999999/related')).status, 404); ok('the admin can list the registrations that look like the same person, with the reason');

  /* ---- a form created on its own (name only) ---- */
  r = await call('POST', '/admin/api/forms', { name: 'Student Intake' }); assert.strictEqual(r.status, 201); const nf = r.json.form;
  assert.strictEqual(nf.path, 'student-intake'); assert.strictEqual(nf.course_slug, 'student-intake'); assert.strictEqual(nf.name, 'Student Intake'); assert.strictEqual(nf.status, 'active'); assert.strictEqual(nf.published_version, 1); assert(nf.url.endsWith('/student-intake'));
  let own = await call('GET', '/student-intake'); assert.strictEqual(own.status, 200); let ownData = JSON.parse(/id="knoaForm">([\s\S]*?)<\/script>/.exec(own.text)[1]); assert.strictEqual(ownData.form_id, nf.id); assert.strictEqual(ownData.version, 1); assert.strictEqual(ownData.name, 'Student Intake');
  r = await call('GET', '/api/forms/student-intake'); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.form_id, nf.id);
  assert.strictEqual((await call('POST', '/admin/api/forms', { name: 'Student Intake' })).status, 409); assert.strictEqual((await call('POST', '/admin/api/forms', { name: 'x' })).status, 422); assert.strictEqual((await call('POST', '/admin/api/forms', { name: 'Admin' })).status, 422);
  r = await call('GET', '/admin/api/forms'); const nfRow = r.json.forms.find((f) => f.id === nf.id); assert(nfRow && nfRow.campaigns === 0 && nfRow.ad_running === false);
  r = await call('GET', '/admin/api/link-lookup?url=' + encodeURIComponent(base + '/student-intake')); assert(r.json.ok); assert.strictEqual(r.json.course.slug, 'student-intake'); assert.strictEqual(r.json.filters.course, 'student-intake'); assert.strictEqual(r.json.unknownCourse, false);
  await fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/122 Mobile Safari' }, body: JSON.stringify({ vid: 'student-intake-visitor', course: 'student-intake', click_ids: { ttclid: true }, geo: { lat: 12.971599, lon: 77.594566, accuracy: 20 } }) });
  const pv = (await db.query("SELECT source_detected, source_method, browser_lat, browser_lon, browser_accuracy FROM page_visits WHERE course_slug='student-intake'")).rows[0]; assert(pv); assert.strictEqual(pv.source_detected, 'TikTok'); assert.strictEqual(pv.source_method, 'click_id');
  assert.strictEqual(Number(pv.browser_lat), 12.971599); assert.strictEqual(Number(pv.browser_lon), 77.594566); assert.strictEqual(Number(pv.browser_accuracy), 20);
  ok('a form can be created on its own with a name only: /student-intake serves the standard form, goes live at once, and its link opens auto-detect the ad source; duplicates and reserved names are refused');

  /* ---- campaigns belong to a form ---- */
  r = await call('POST', '/admin/api/campaigns', { name: 'DS Oct Reels', form_id: ds.id }); assert.strictEqual(r.status, 201); const c1 = r.json.campaign;
  assert.strictEqual(c1.utm_campaign, 'ds-oct-reels'); assert.strictEqual(c1.utm_source, null); assert.strictEqual(c1.utm_medium, 'paid'); assert.strictEqual(c1.status, 'draft'); assert.strictEqual(Number(c1.form_id), Number(ds.id));
  assert.strictEqual((await call('POST', '/admin/api/campaigns', { name: 'DS Oct Reels', form_id: ds.id })).status, 409);
  assert.strictEqual((await call('POST', '/admin/api/campaigns', { name: 'x', form_id: ds.id })).status, 422); assert.strictEqual((await call('POST', '/admin/api/campaigns', { name: 'Campaign 2', form_id: ds.id })).status, 422);
  assert.strictEqual((await call('POST', '/admin/api/campaigns', { name: 'Fine name' })).status, 422); assert.strictEqual((await call('POST', '/admin/api/campaigns', { name: 'Fine name', form_id: 999999 })).status, 422);
  assert.strictEqual((await call('POST', '/admin/api/campaigns', { name: 'Fine name', form_id: ds.id, starts_on: '2026-11-05', ends_on: '2026-11-01' })).status, 422);
  ok('a campaign belongs to a form and has no source: the name must be letters only (3-40); duplicates, unknown forms and reversed dates are refused');
  r = await call('POST', '/admin/api/campaigns', { name: 'DS Search', form_id: ds.id }); const c2 = r.json.campaign; assert.strictEqual(c2.utm_medium, 'paid');
  r = await call('POST', `/admin/api/campaigns/${c1.id}/status`, { status: 'active' }); assert.strictEqual(r.json.campaign.status, 'active');
  r = await call('POST', `/admin/api/campaigns/${c2.id}/status`, { status: 'active' }); assert.strictEqual(r.status, 409); assert.strictEqual(r.json.active.id, c1.id);
  r = await call('POST', `/admin/api/campaigns/${c2.id}/status`, { status: 'active', replace: true }); assert.strictEqual(r.json.campaign.status, 'active'); assert.strictEqual(r.json.paused.id, c1.id);
  const act = (await db.query('SELECT COUNT(*)::int n FROM campaigns WHERE form_id=$1 AND status=$2', [ds.id, 'active'])).rows[0].n; assert.strictEqual(act, 1);
  const dsRow = (await call('GET', '/admin/api/forms')).json.forms.find((f) => f.id === ds.id); assert.strictEqual(dsRow.active_campaigns, 1); assert.strictEqual(dsRow.campaigns, 2); assert.strictEqual(dsRow.ad_running, true);
  ok('at most one active campaign per form: a second activation is refused (409, naming the active one) unless it replaces it, and the forms list shows Ad running with its campaign count');
  campaigns.invalidate();

  /* ---- plain-link redirect ---- */
  let rd = await fetch(base + '/datascience', { redirect: 'manual' }); assert.strictEqual(rd.status, 302); assert.strictEqual(rd.headers.get('location'), '/datascience?utm_medium=paid&utm_campaign=ds-search'); assert(/no-store/.test(rd.headers.get('cache-control')));
  rd = await fetch(base + '/datascience?fbclid=abc', { redirect: 'manual' }); assert(/fbclid=abc/.test(rd.headers.get('location')) && /utm_campaign=ds-search/.test(rd.headers.get('location')) && !/utm_source/.test(rd.headers.get('location')));
  assert.strictEqual((await fetch(base + '/datascience', { redirect: 'manual', headers: { 'user-agent': 'facebookexternalhit/1.1' } })).status, 200);
  assert.strictEqual((await fetch(base + '/datascience?utm_campaign=other', { redirect: 'manual' })).status, 200); assert.strictEqual((await fetch(base + '/datascience?nocampaign=1', { redirect: 'manual' })).status, 200);
  assert.strictEqual((await fetch(base + '/cybersecurity', { redirect: 'manual' })).status, 200); assert.strictEqual((await fetch(base + '/', { redirect: 'manual' })).status, 200);
  ok('the plain form link forwards to the active campaign tags (no source written), keeps other parameters and skips tagged links, bots and other forms');
  res = await post({ client_id: 'm'.repeat(20), phone: '9000000020', city: 'Kochi', utm_campaign: 'ds-search', click_ids: { gclid: true } }); lead = (await db.query('SELECT campaign_id, source_detected, source_method FROM leads WHERE client_id=$1', ['m'.repeat(20)])).rows[0]; assert.strictEqual(Number(lead.campaign_id), c2.id); assert.strictEqual(lead.source_detected, 'Google'); assert.strictEqual(lead.source_method, 'click_id');
  r = await call('GET', '/admin/api/campaigns'); const row = r.json.campaigns.find((c) => c.id === c2.id); assert.strictEqual(row.leads, 1); assert(row.link.endsWith('/datascience?utm_medium=paid&utm_campaign=ds-search')); ok('a registration through the tagged link is attached to its campaign, and the ad source is auto-detected from the click id (no typed source)');
  assert.strictEqual((await call('DELETE', `/admin/api/campaigns/${c2.id}`)).status, 409); await call('POST', `/admin/api/campaigns/${c2.id}/status`, { status: 'ended' }); assert.strictEqual((await fetch(base + '/datascience', { redirect: 'manual' })).status, 200); assert.strictEqual((await call('DELETE', `/admin/api/campaigns/${c1.id}`)).json.ok, true); ok('ending a campaign stops the redirect; a campaign with registrations cannot be deleted, an empty one can');
  r = await call('PATCH', `/admin/api/campaigns/${c2.id}`, { notes: 'Notes here', name: 'DS Search Renamed' }); assert.strictEqual(r.json.campaign.notes, 'Notes here'); assert.strictEqual(r.json.campaign.name, 'DS Search Renamed'); assert.strictEqual(r.json.campaign.utm_campaign, 'ds-search');   // renaming never changes the tag: printed links keep working

  /* ---- generated links ---- */
  r = await call('POST', `/admin/api/forms/${ds.id}/links`, { platform: 'meta', campaign_name: 'DS Nov Launch', medium: 'paid' }); assert.strictEqual(r.status, 201); const u = new URL(r.json.link.url); assert.strictEqual(u.pathname, '/datascience'); assert.deepStrictEqual([...u.searchParams], [['utm_source', 'meta'], ['utm_medium', 'paid'], ['utm_campaign', 'ds-nov-launch']]);
  r = await call('POST', `/admin/api/forms/${ds.id}/links`, { platform: 'qr', campaign_name: 'Poster', label: 'Campus poster' }); assert.strictEqual(new URL(r.json.link.url).searchParams.get('utm_medium'), 'qr'); const lid = r.json.link.id;
  assert.strictEqual((await call('POST', `/admin/api/forms/${ds.id}/links`, { platform: 'meta' })).status, 422); assert.strictEqual((await call('POST', `/admin/api/forms/${ds.id}/links`, { platform: 'zzz', campaign_name: 'abc' })).status, 422);
  r = await call('GET', `/admin/api/forms/${ds.id}/links`); assert.strictEqual(r.json.links.length, 2); assert.strictEqual(r.json.links[0].label, 'Campus poster'); assert.strictEqual((await call('DELETE', `/admin/api/forms/${ds.id}/links/${lid}`)).json.ok, true); assert.strictEqual((await call('GET', `/admin/api/forms/${ds.id}/links`)).json.links.length, 1);
  ok('link generator: complete tagged links (meta / qr ...), saved per form, listed, deletable; incomplete or unknown input is refused');

  /* ---- audit + new master class gets its own form ---- */
  r = await call('GET', '/admin/api/audit'); const acts = r.json.rows.map((x) => x.action); for (const a2 of ['form.publish', 'form.restore', 'form.rollback', 'campaign.create', 'campaign.status', 'link.create']) assert(acts.includes(a2), a2); assert(r.json.rows.every((x) => x.admin === 'studio.admin')); ok('every change is in the audit log with the admin who made it');
  r = await call('POST', '/admin/api/courses', { name: 'Machine Learning' }); assert.strictEqual(r.status, 201); r = await call('GET', '/admin/api/forms'); assert(r.json.forms.find((f) => f.course_slug === 'machinelearning')); await call('DELETE', '/admin/api/courses/machinelearning'); r = await call('GET', '/admin/api/forms'); assert.strictEqual(r.json.forms.find((f) => f.course_slug === 'machinelearning').status, 'archived'); ok('a new master class gets its form at once; deleting the master class archives its form (history kept)');
  server.close(); await db.close();
  console.log(`\nAll ${n} Form Studio checks passed`);
})().catch((e) => { console.error('STUDIO TEST FAILED:', e); process.exit(1); });
