// Forms in the database: default-form seed, public definition endpoint, source detection and async geo on a real lead POST.
// Run: node test/forms.test.js
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_MAX = '500';
process.env.GEO_PROVIDER = 'none';          // this test asserts the no-lookup behaviour; the ipapi path is tested explicitly below
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const config = require('../src/config');
const migrate = require('../src/migrate');
const forms = require('../src/forms');
const F = require('../src/formdef');
const G = require('../src/geo');
const geoService = require('../src/geoService');
const Lead = require('../src/models/Lead');
const { createApp } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ FM${++n}. ${m}`);
const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ipapi-sample.json'), 'utf8'));
const UA_IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/21A329 Instagram 310.0.0.24.109 (iPhone14,2; iOS 17_0)';
const UA_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(10); } return null; }

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });

  /* a lead recorded BEFORE the seed (legacy) must be linked to its form but keep form_version NULL */
  const old = await Lead.create({ first_name: 'Old', last_name: 'Lead', full_name: 'Old Lead', phone: '+919876500001', status: 'Student / Fresher', course: 'Cyber Security', course_slug: 'cybersecurity' });

  /* ---- seed ---- */
  let r = await forms.seedDefaultForms();
  assert.deepStrictEqual(r.created.sort(), ['cybersecurity', 'datascience', 'generativeai']);
  assert.strictEqual((await db.query('SELECT COUNT(*)::int n FROM forms')).rows[0].n, 3); assert.strictEqual((await db.query('SELECT COUNT(*)::int n FROM form_versions')).rows[0].n, 3);
  const v1 = (await db.query('SELECT definition FROM form_versions ORDER BY id LIMIT 1')).rows[0].definition; const def = typeof v1 === 'string' ? JSON.parse(v1) : v1;
  assert.deepStrictEqual(def, JSON.parse(JSON.stringify(F.defaultDefinition()))); assert.deepStrictEqual(F.validateDefinition(def), []);
  ok('each existing master class gets the default form, version 1, stored exactly as today\'s definition');
  r = await forms.seedDefaultForms(); assert.deepStrictEqual(r.created, []); assert.strictEqual((await db.query('SELECT COUNT(*)::int n FROM forms')).rows[0].n, 3); assert.strictEqual((await db.query('SELECT COUNT(*)::int n FROM form_versions')).rows[0].n, 3);
  ok('running the seed again creates nothing (idempotent)');
  const ol = (await db.query('SELECT form_id, form_version, phone, full_name FROM leads WHERE id=$1', [old.id])).rows[0];
  assert(ol.form_id != null); assert.strictEqual(ol.form_version, null); assert.strictEqual(ol.phone, '+919876500001'); assert.strictEqual(ol.full_name, 'Old Lead');
  ok('a historical lead is linked to its form (form_id) with form_version left NULL (= legacy); its data is untouched');
  await db.query("INSERT INTO courses (slug, name, path, is_default, sort_order) VALUES ('machinelearning','Machine Learning','machine-learning',false,50)");
  r = await forms.seedDefaultForms(); assert.deepStrictEqual(r.created, ['machinelearning']); ok('a master class added later gets its default form on the next seed');

  /* ---- server ---- */
  const server = createApp().listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, h = {}) => fetch(base + p, { headers: h });

  let res = await get('/api/forms/cybersecurity'); let body = await res.json();
  assert.strictEqual(res.status, 200); assert.strictEqual(body.version, 1); assert.strictEqual(body.copy.headline, 'Register for the Cyber Security Master Class');
  assert.strictEqual(body.copy.subheadline, 'Share your details and our team will contact you about the Cyber Security session.'); assert.strictEqual(body.fields[0].key, 'first_name'); assert.strictEqual(body.fields.length, 13); assert.strictEqual(body.button, 'Register now');
  assert(res.headers.get('cache-control') === 'no-cache');
  ok('GET /api/forms/:path returns the published definition with the headline already filled in, 13 fields, and always revalidates');
  const etag = res.headers.get('etag'); assert(etag);
  res = await get('/api/forms/cybersecurity', { 'If-None-Match': etag }); assert.strictEqual(res.status, 304); ok('the ETag is honoured: If-None-Match gives 304 with no body');
  res = await get('/api/forms/genai'); assert.strictEqual((await res.json()).name, 'Generative AI'); res = await get('/api/forms/generative-ai'); assert.strictEqual(res.status, 200); ok('aliases and hyphenated paths resolve to the same form (/genai, /generative-ai)');
  for (const bad of ['nothing', 'admin', '..%2f..%2fetc', '%3Cscript%3E']) { res = await get('/api/forms/' + bad); assert.strictEqual(res.status, 404, bad); }
  ok('unknown, reserved and hostile paths are a clean 404');
  await db.query("UPDATE forms SET status='archived' WHERE course_slug='datascience'"); assert.strictEqual((await get('/api/forms/datascience')).status, 404); await db.query("UPDATE forms SET status='active' WHERE course_slug='datascience'"); ok('an archived form is not served');
  // publish a changed version: deleted fields never reach the browser, copy edits show up, ETag changes
  const edited = JSON.parse(JSON.stringify(F.defaultDefinition())); edited.copy.headline = 'Join the {name} {type} <b>now</b>'; edited.fields.find((f) => f.key === 'college_name').deleted = true;
  assert.deepStrictEqual(F.validateDefinition(edited), []);
  const fid = (await db.query("SELECT id FROM forms WHERE course_slug='cybersecurity'")).rows[0].id;
  await db.query("INSERT INTO form_versions (form_id, version, definition, author) VALUES ($1,2,$2,'test')", [fid, JSON.stringify(edited)]); await db.query('UPDATE forms SET current_version=2, published_version=2 WHERE id=$1', [fid]);
  res = await get('/api/forms/cybersecurity'); body = await res.json(); assert.strictEqual(body.version, 2); assert(!body.fields.some((f) => f.key === 'college_name')); assert.notStrictEqual(res.headers.get('etag'), etag);
  assert.strictEqual(body.copy.headline, 'Join the Cyber Security Master Class <b>now</b>');   // plain text: the renderer must use textContent
  assert.strictEqual((await db.query('SELECT COUNT(*)::int n FROM form_versions WHERE form_id=$1', [fid])).rows[0].n, 2); // version 1 still there
  ok('publishing version 2: new copy and the field list change, the deleted field is not sent, version 1 stays stored; markup in copy is returned as plain text for textContent rendering');

  /* ---- a real lead POST: source detection + async geo ---- */
  const post = (o, ua = UA_SAFARI) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify({ first_name: 'Asha', last_name: 'N' + o.i, country: 'IN', phone: '98765' + String(20000 + o.i), status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', course: 'cybersecurity', client_id: 'forms-test-client-' + o.i, ...o.extra }) });
  res = await post({ i: 1, extra: { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'launch' } });
  assert.strictEqual(res.status, 201); let id = (await res.json()).id; let row = (await db.query('SELECT source_detected, source_method, geo_status FROM leads WHERE id=$1', [id])).rows[0];
  assert.deepStrictEqual(row, { source_detected: 'Meta', source_method: 'utm', geo_status: null }); ok('a tagged lead stores source_detected=Meta / source_method=utm; with GEO_PROVIDER off no geo columns are written');
  res = await post({ i: 2, extra: {} }, UA_IG); id = (await res.json()).id; row = (await db.query('SELECT source_detected, source_method FROM leads WHERE id=$1', [id])).rows[0];
  assert.deepStrictEqual(row, { source_detected: 'Meta', source_method: 'in_app' }); ok('an untagged lead opened inside the Instagram app is detected as Meta via the in-app browser');
  res = await post({ i: 3, extra: { referrer: 'https://chatgpt.com/' } }); id = (await res.json()).id; row = (await db.query('SELECT source_detected, source_method FROM leads WHERE id=$1', [id])).rows[0];
  assert.deepStrictEqual(row, { source_detected: 'ChatGPT / AI', source_method: 'referrer' }); ok('an untagged lead from chatgpt.com is detected as ChatGPT / AI via the referrer');
  res = await post({ i: 11, extra: { geo: { lat: 9.931233, lon: 76.267304, accuracy: 35.5 } } }); id = (await res.json()).id;
  row = (await db.query('SELECT browser_lat, browser_lon, browser_accuracy, browser_geo_at FROM leads WHERE id=$1', [id])).rows[0];
  assert.strictEqual(Number(row.browser_lat), 9.931233); assert.strictEqual(Number(row.browser_lon), 76.267304); assert.strictEqual(Number(row.browser_accuracy), 35.5); assert(row.browser_geo_at);
  res = await post({ i: 12, extra: { geo: { lat: 999, lon: 0 } } }); id = (await res.json()).id; row = (await db.query('SELECT browser_lat FROM leads WHERE id=$1', [id])).rows[0]; assert.strictEqual(row.browser_lat, null);
  ok('the exact browser location is stored when the person allowed it (and impossible coordinates are ignored)');
  res = await post({ i: 4, extra: {} }); id = (await res.json()).id; row = (await db.query('SELECT source_detected, source_method FROM leads WHERE id=$1', [id])).rows[0];
  assert.deepStrictEqual(row, { source_detected: 'Direct', source_method: 'direct' }); ok('no evidence at all is stored as Direct');

  // geo on, with the fixture (no live call)
  config.geo.ipSalt = 'forms-test-salt-1234567';
  const calls = []; const geo = G.createGeo({ provider: 'ipapi', salt: config.geo.ipSalt, store: G.dbStore(db), fetch: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => SAMPLE }; } });
  geoService.set(geo);
  res = await post({ i: 5, extra: {} }); assert.strictEqual(res.status, 201); id = (await res.json()).id;
  row = await until(async () => { const x = (await db.query('SELECT * FROM leads WHERE id=$1', [id])).rows[0]; return x.geo_status ? x : null; }); assert(row, 'geo columns were never written');
  // in the test the request comes from 127.0.0.1, which is private: the provider must not be called and the status says so
  assert.strictEqual(row.geo_status, 'private_ip'); assert.strictEqual(calls.length, 0); assert.strictEqual(row.geo_city, null);
  ok('a lead from a private/loopback address gets geo_status=private_ip and the provider is not called');
  // enrich directly with a public IP (the same code path the route uses)
  await geoService.enrichLead({ leadId: id, ip: '117.251.10.20', formDialCode: '+971' });
  row = (await db.query('SELECT * FROM leads WHERE id=$1', [id])).rows[0];
  assert.strictEqual(row.geo_status, 'ok'); assert.strictEqual(row.geo_city, 'Kochi'); assert.strictEqual(row.geo_region, 'Kerala'); assert.strictEqual(row.geo_country_code, 'IN'); assert.strictEqual(row.geo_timezone, 'Asia/Kolkata'); assert.strictEqual(row.geo_asn, 'AS9829'); assert.strictEqual(row.geo_org, 'National Internet Backbone');
  assert.strictEqual(row.geo_calling_code, '+91'); assert.strictEqual(row.phone_country_mismatch, true); assert.strictEqual(Number(row.geo_lat), 9.93); assert.strictEqual(row.geo_source, 'ipapi.co'); assert.strictEqual(row.geo_precision, 'approximate_city'); assert.strictEqual(row.ip_version, 4);
  assert(/^[0-9a-f]{64}$/.test(row.ip_hash)); assert(!JSON.stringify(Object.entries(row).filter(([k]) => k !== 'ip')).includes('117.251.10.20'));
  ok('a lead looked up with the ipapi.co fixture stores city, region, country, timezone, ASN/ISP, calling code and the mismatch flag (form says +91 vs chosen +971 here), a hashed IP and no raw IP in any new column');
  // failures never break a registration
  geoService.set(G.createGeo({ provider: 'ipapi', salt: config.geo.ipSalt, store: G.dbStore(db), fetch: async () => { throw new Error('boom'); } }));
  res = await post({ i: 6, extra: {} }); assert.strictEqual(res.status, 201); id = (await res.json()).id; assert((await db.query('SELECT id FROM leads WHERE id=$1', [id])).rows.length === 1);
  const broken = { enabled: true, lookup: async () => { throw new Error('geo exploded'); } }; geoService.set(broken);
  res = await post({ i: 7, extra: {} }); assert.strictEqual(res.status, 201); await sleep(50); assert.strictEqual((await db.query('SELECT COUNT(*)::int n FROM leads WHERE client_id=$1', ['forms-test-client-7'])).rows[0].n, 1);
  assert.strictEqual(await geoService.enrichLead({ leadId: id, ip: '117.251.10.20' }), null);
  ok('a provider that errors, or a geo module that throws, never fails or loses a registration');
  geoService.set(G.createGeo({ provider: 'ipapi', salt: config.geo.ipSalt, store: G.dbStore(db), fetch: async () => ({ ok: true, status: 429, json: async () => ({}) }) }));
  const st = await geoService.enrichLead({ leadId: id, ip: '117.251.10.21', formDialCode: '+91' }); row = (await db.query('SELECT geo_status, geo_city, phone_country_mismatch FROM leads WHERE id=$1', [id])).rows[0];
  assert.deepStrictEqual(row, { geo_status: 'rate_limited', geo_city: null, phone_country_mismatch: null }); ok('when ipapi.co answers 429 the lead is saved with geo_status=rate_limited and an unknown location');

  await new Promise((resolve) => server.close(resolve)); await db.close();
  console.log(`\nAll ${n} form storage / wiring checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
