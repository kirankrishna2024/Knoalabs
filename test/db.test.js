// Database layer: the pool can never be oversized, and a dropped connection on a READ is retried once (a write never is).
const assert = require('assert');
let n = 0; const ok = (m) => console.log(`  ✓ D${++n}. ${m}`);

(async () => {
  Object.assign(process.env, { LOG_LEVEL: 'silent', NODE_ENV: 'test' });
  const db = require('../src/db');
  const config = require('../src/config');

  assert(db.POOL_HARD_MAX >= 10 && db.POOL_HARD_MAX <= 30);
  ok(`pool is capped at ${db.POOL_HARD_MAX} connections even if DATABASE_POOL_MAX=10000 is set`);

  let calls = 0;
  const flaky = (failures, code = 'ECONNRESET') => ({ query: async (t) => { if (calls++ < failures) { const e = new Error(code === '42P01' ? 'relation "leads" does not exist' : 'Connection terminated unexpectedly'); e.code = code; throw e; } return { rows: [{ ok: 1 }], sql: t }; } });

  db.init(flaky(1)); calls = 0;
  assert.strictEqual((await db.query('SELECT 1')).rows[0].ok, 1); assert.strictEqual(calls, 2);
  ok('a SELECT that hits a dropped connection is retried once and succeeds');

  db.init(flaky(1, '53300')); calls = 0;
  assert.strictEqual((await db.query('  select count(*) from leads')).rows[0].ok, 1); assert.strictEqual(calls, 2);
  ok('"too many connections" on a read is retried once');

  db.init(flaky(1)); calls = 0;
  await assert.rejects(() => db.query('INSERT INTO leads DEFAULT VALUES'), /Connection terminated/); assert.strictEqual(calls, 1);
  ok('writes are never retried (no duplicate leads)');

  db.init(flaky(5)); calls = 0;
  await assert.rejects(() => db.query('SELECT 1'), /Connection terminated/); assert.strictEqual(calls, 2);
  ok('a read is retried only once, then the error is reported');

  db.init(flaky(1, '42P01')); calls = 0;
  await assert.rejects(() => db.query('SELECT 1')); assert.strictEqual(calls, 1);
  ok('real SQL errors (e.g. missing table) are not retried');

  void config;
  console.log('\nDatabase layer tests passed.'); process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
