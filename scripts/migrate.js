// npm run migrate           apply pending migrations
// npm run migrate:status    show applied / pending
const db = require('../src/db');
const migrate = require('../src/migrate');

(async () => {
  try {
    const pool = db.init();
    if (process.argv[2] === 'status') {
      const s = await migrate.status(pool);
      s.applied.forEach((m) => console.log(`  applied  ${m.version}_${m.name}  ${new Date(m.applied_at).toISOString()}${m.modified ? '  !! FILE CHANGED AFTER APPLY' : ''}`));
      s.pending.forEach((m) => console.log(`  PENDING  ${m.file}`));
      s.unknown.forEach((v) => console.log(`  !! ${v} applied in DB but file missing`));
      console.log(`${s.applied.length} applied, ${s.pending.length} pending`);
    } else {
      const r = await migrate.run(pool, { log: (m) => console.log(' ', m) });
      console.log(r.applied.length ? `Done: ${r.applied.length} migration(s) applied.` : 'Database is up to date.');
    }
    await pool.end();
  } catch (e) {
    console.error('Migration error:', e.message);
    process.exit(1);
  }
})();
