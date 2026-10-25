// npm run local : the whole app on an in-memory PostgreSQL (no Docker, no database server).
// Data lives in memory for as long as this process runs and is gone after a restart.
process.env.KNOA_HANDLE_SIGNALS = '1';   // Ctrl+C shuts the server down cleanly
process.env.AUTO_MIGRATE = 'false';      // migrations are applied below, without pg_advisory_lock (pg-mem has no advisory locks)

const config = require('../src/config');
const { newDb } = require('pg-mem');
const migrate = require('../src/migrate');
const { start } = require('../server');
const log = require('../src/logger');
const { version } = require('../package.json');

(async () => {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const pool = new (mem.adapters.createPg().Pool)();

  await migrate.run(pool, { lock: false, log: (m) => log.info(m) });
  const { shutdown } = await start({ pool });
  log.info({ version }, 'local test database: in-memory PostgreSQL, nothing is written to disk');

  const url = `http://localhost:${config.port}`;
  console.log(`\n  KnoaLabs ${version} (local)`);
  console.log(`  Registration form  ${url}/cybersecurity`);
  console.log(`  Admin panel        ${url}/admin`);
  console.log('  Database           in-memory test database (data is lost when this process stops)\n');

  process.once('SIGINT', () => shutdown('SIGINT').catch(() => process.exit(1)));
})().catch(async (e) => {
  log.fatal({ err: e.message }, 'local start failed');
  process.exit(1);
});
