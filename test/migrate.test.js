// Run: npm test   (in-memory Postgres, no real database needed)
process.env.LOG_LEVEL = 'silent';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { newDb } = require('pg-mem');
const migrate = require('../src/migrate');
const db = require('../src/db');
const Lead = require('../src/models/Lead');
const Admin = require('../src/models/Admin');

const freshPool = () => new (newDb().adapters.createPg().Pool)();
const tmpDir = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const [n, sql] of Object.entries(files)) fs.writeFileSync(path.join(d, n), sql);
  return d;
};
let n = 0; const ok = (m) => console.log(`  ✓ M${++n}. ${m}`);
const cols = async (pool, t = 'leads') => (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${t}'`)).rows.map((r) => r.column_name);

(async () => {
  /* 1. fresh database */
  let pool = freshPool();
  let r = await migrate.run(pool, { lock: false });
  const ALL = migrate.readMigrations(migrate.DEFAULT_DIR).map((m) => m.file);
  assert.deepStrictEqual(r.applied, ALL); ok(`fresh DB: all ${ALL.length} migrations applied in order`);
  const c = await cols(pool);
  for (const k of ['id', 'created_at', 'phone', 'course_slug', 'student_course', 'student_status', 'college_name', 'experience_level', 'job_role', 'current_company', 'specialization', 'highest_qualification', 'client_id', 'meta_platform', 'meta_placement']) assert(c.includes(k), k);
  for (const k of ['crm_status', 'crm_error', 'crm_attempts', 'crm_next_attempt_at']) assert(!c.includes(k), k + ' should be gone');
  ok('leads table has the form columns and no CRM columns');
  assert((await cols(pool, 'admin_users')).includes('password_hash')); ok('admin_users table exists');

  /* 2. idempotent re-run */
  r = await migrate.run(pool, { lock: false });
  assert.strictEqual(r.applied.length, 0); ok('second run applies nothing');
  const s = await migrate.status(pool);
  assert.strictEqual(s.pending.length, 0); assert(s.applied.every((m) => !m.modified)); ok('status: all applied, none modified');

  /* 3. upgrade of a database that already ran 001-004 (the real production case) keeps its leads */
  const upTo4 = tmpDir(Object.fromEntries(migrate.readMigrations(migrate.DEFAULT_DIR).filter((m) => m.version <= '004').map((m) => [m.file, m.sql])));
  pool = freshPool();
  await migrate.run(pool, { dir: upTo4, lock: false });
  await pool.query(`INSERT INTO leads (first_name,last_name,full_name,phone,status,experience_level,intent,crm_status)
                    VALUES ('Old','Row','Old Row','+919876543210','Student / Fresher','0-2 yrs','Get course details','sent')`);
  r = await migrate.run(pool, { lock: false });
  assert.deepStrictEqual(r.applied, ALL.slice(ALL.indexOf('005_remove_crm_add_admin.sql')));   // everything after the 001-004 that were applied by hand
  assert.deepStrictEqual((await pool.query('SELECT slug, path, is_default FROM courses ORDER BY sort_order')).rows.map((x) => x.slug + ':' + x.path + ':' + x.is_default), ['datascience:datascience:true', 'cybersecurity:cybersecurity:true', 'generativeai:generative-ai:true']);
  const old = (await pool.query("SELECT full_name, intent, experience_level FROM leads")).rows;
  assert.strictEqual(old.length, 1); assert.strictEqual(old[0].intent, 'Get course details'); assert.strictEqual(old[0].experience_level, '0-2 yrs');
  assert(!(await cols(pool)).includes('crm_status'));
  await pool.query(`INSERT INTO leads (first_name,last_name,full_name,phone,status) VALUES ('New','Row','New Row','+919876543211','Student / Fresher')`);
  ok('005 on a live 001-004 database: old leads (and their old answers) kept, CRM columns dropped, new rows need no intent/experience');

  /* 4. runner safety */
  const dir = tmpDir({ '001_a.sql': 'CREATE TABLE a (id INT);', '002_b.sql': 'CREATE TABLE b (id INT);' });
  pool = freshPool();
  fs.renameSync(path.join(dir, '002_b.sql'), path.join(dir, '002_b.sql.off'));
  await migrate.run(pool, { dir, lock: false });
  fs.renameSync(path.join(dir, '002_b.sql.off'), path.join(dir, '002_b.sql'));
  r = await migrate.run(pool, { dir, lock: false }); assert.deepStrictEqual(r.applied, ['002_b.sql']); ok('adding 002 later applies only 002');
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INT, extra INT);');
  await assert.rejects(migrate.run(pool, { dir, lock: false }), /modified after it was applied/); ok('edited applied migration is refused');
  fs.unlinkSync(path.join(dir, '002_b.sql')); fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INT);');
  await assert.rejects(migrate.run(pool, { dir, lock: false }), /file is missing/); ok('applied migration with missing file is refused');
  const bad = tmpDir({ '001_bad.sql': 'CREATE TABLE ok_table (id INT); INSERT INTO nope VALUES (1);' });
  pool = freshPool();
  await assert.rejects(migrate.run(pool, { dir: bad, lock: false }), /failed and was rolled back/);
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n, 0); ok('failing migration is not recorded');
  assert.throws(() => migrate.readMigrations(tmpDir({ 'create_leads.sql': 'x' })), /Bad migration file name/);
  assert.throws(() => migrate.readMigrations(tmpDir({ '001_a.sql': 'x', '001_b.sql': 'y' })), /Duplicate migration number/); ok('bad names and duplicate numbers rejected');

  /* 5. Lead model */
  pool = freshPool(); db.init(pool); await migrate.run(pool, { lock: false });
  const base = { first_name: 'Asha', last_name: 'Nair', full_name: 'Asha Nair', phone: '+919876543210', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', course: 'Cyber Security', course_slug: 'cybersecurity' };
  const lead = await Lead.create(base);
  assert(lead.id && lead.created_at && lead.updated_at); ok('Lead.create inserts and fills id/timestamps');
  assert.strictEqual((await Lead.findById(lead.id)).student_course, 'BCA'); assert.strictEqual(await Lead.findById(99999), null); ok('findById works, null when missing');
  const noPhone = await Lead.create({ ...base, phone: null, email: 'kept@example.com', status: null }); assert(noPhone && noPhone.id); await pool.query('DELETE FROM leads WHERE id = $1', [noPhone.id]); ok('a lead without phone or "I am a" is accepted (migration 024: forms may drop those questions; the form itself must keep a phone or email)');
  const o1 = await Lead.createOnce({ ...base, phone: '+919000000001', client_id: 'abcdefghijklmnop' });
  const o2 = await Lead.createOnce({ ...base, phone: '+919000000002', client_id: 'abcdefghijklmnop' });
  assert(!o1.duplicate && o2.duplicate && o1.lead.id === o2.lead.id); ok('createOnce: same client_id returns the original lead');

  await Lead.create({ ...base, first_name: 'Ravi', full_name: 'Ravi Kumar', last_name: 'Kumar', phone: '+919111111111', status: 'Working Professional', student_course: null, student_status: null, experience_level: '2-5 yrs', job_role: 'QA / Tester', current_company: 'Acme Labs', course: null, course_slug: null });
  const all = await Lead.list({ limit: 10, offset: 0 });
  assert.strictEqual(all.total, 3); assert.strictEqual(all.rows[0].first_name, 'Ravi'); ok('list: newest first with total');
  assert.strictEqual((await Lead.list({ limit: 1, offset: 1 })).rows.length, 1); ok('list: pagination');
  assert.strictEqual((await Lead.list({ status: 'Working Professional' })).total, 1); ok('filter by status');
  assert.strictEqual((await Lead.list({ course: 'cybersecurity' })).total, 2); assert.strictEqual((await Lead.list({ course: Lead.NO_COURSE })).total, 1); ok('filter by course, and "no course in link"');
  assert.strictEqual((await Lead.list({ q: 'acme' })).total, 1); assert.strictEqual((await Lead.list({ q: '9111' })).total, 1); ok('search by company / phone part');
  assert.strictEqual((await Lead.list({ from: new Date(Date.now() + 3600e3) })).total, 0); assert.strictEqual((await Lead.list({ to: new Date(Date.now() + 3600e3) })).total, 3); ok('date range filters');
  assert.strictEqual((await Lead.all({ status: 'Student / Fresher' })).length, 2); ok('Lead.all honours filters (used by the Excel export)');
  const st = await Lead.stats({ tz: 'Asia/Kolkata' });
  assert.strictEqual(st.total, 3); assert.strictEqual(st.today, 3); assert.strictEqual(st.last7, 3); assert.strictEqual(st.last30, 3);
  assert(!('trend' in st));
  assert.strictEqual(st.byStatus.find((x) => x.status === 'Student / Fresher').n, 2);
  assert(st.byCourse.find((x) => x.course_slug === 'cybersecurity').n === 2 && st.byCourse.some((x) => x.course_slug === null)); ok('stats: total/today/7d/30d, by status, by course');

  /* 6. Admin model */
  assert.strictEqual(await Admin.count(), 0);
  assert.strictEqual(await Admin.upsert('Boss', 'hash1'), 'created');
  assert.strictEqual(await Admin.upsert('boss', 'hash2'), 'updated');
  const a = await Admin.findByUsername(' BOSS '); assert.strictEqual(a.password_hash, 'hash2'); assert.strictEqual(await Admin.count(), 1);
  ok('Admin: usernames are case-insensitive, upsert creates then updates'); 

  console.log(`\nAll ${n} migration/model checks passed`); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
