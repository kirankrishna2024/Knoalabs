// npm run db:check : read-only health check of the configured database (no writes, no secrets printed).
require('dotenv').config();
const config = require('./../src/config');
const db = require('./../src/db');
const migrate = require('./../src/migrate');
(async () => {
  const problems = config.validate(); if (problems.length) { console.error('Config problems:\n - ' + problems.join('\n - ')); process.exit(1); }
  const c = db.connection(); const u = new URL(c.url);
  console.log(`Target   : ${u.hostname}:${u.port || 5432}${u.pathname}  (TLS ${c.ssl ? (c.ssl.rejectUnauthorized ? 'verified' : 'on, certificate not verified') : 'off'})`);
  if (/ondigitalocean\.com$/.test(u.hostname) && u.port === '25061') console.warn('Warning : port 25061 is the connection pool; use 25060 (direct) so migration locks work.');
  const pool = db.init();
  try {
    const { rows: [i] } = await db.query('SELECT current_database() AS db, current_user AS usr, current_schema() AS sch, split_part(version(), \',\', 1) AS v');
    console.log(`Connected: ${i.v} · db=${i.db} user=${i.usr} schema=${i.sch}`);
    const s = await migrate.status(pool);
    console.log(`Migrations: ${s.applied.length} applied, ${s.pending.length} pending${s.pending.length ? ' (' + s.pending.map((p) => p.file).join(', ') + ')' : ''}`);
    s.applied.filter((a) => a.modified).forEach((a) => console.error(`  ! ${a.version} was edited after being applied`));
    s.unknown.forEach((v) => console.error(`  ! ${v} is applied but its file is missing`));
    const { rows: idx } = await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'leads' ORDER BY 1").catch(() => ({ rows: [] }));
    const need = ['leads_client_id_key', 'leads_created_at_idx', 'leads_phone_idx', 'leads_course_slug_idx', 'leads_status_idx'];
    if (idx.length) { const miss = need.filter((n) => !idx.some((r) => r.indexname === n)); console.log(miss.length ? `Missing indexes: ${miss.join(', ')} (run: npm run migrate)` : 'Indexes   : all present'); }
    for (const t of ['leads', 'courses', 'admin_users']) { try { const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${t}`); console.log(`${t.padEnd(11)}: ${rows[0].n} rows`); } catch { console.log(`${t.padEnd(11)}: not created yet`); } }
  } catch (e) { console.error('FAILED   :', e.message); process.exitCode = 1; }
  finally { await db.close(); }
})();
