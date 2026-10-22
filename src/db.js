const { Pool } = require('pg');
const config = require('./config');
const log = require('./logger');

let pool = null;

// Managed PostgreSQL allows only a few dozen connections in total. A huge pool (e.g. DATABASE_POOL_MAX=10000)
// does not make the app faster: every dashboard poll opens a fresh connection until the server answers
// "too many connections" and the admin panel shows HTTP 500. Keep the pool small and reuse it.
const POOL_HARD_MAX = 20;
const TRANSIENT_CODES = new Set(['53300', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);
const isTransient = (e) => Boolean(e) && (TRANSIENT_CODES.has(e.code) || /Connection terminated|timeout exceeded when trying to connect|too many clients|remaining connection slots/i.test(String(e.message)));

/**
 * TLS for managed PostgreSQL (DigitalOcean etc.).
 * - DATABASE_SSL=true, or sslmode=require/verify-* in the URL, or a *.db.ondigitalocean.com host turns TLS on.
 * - DATABASE_SSL_CA (the cluster CA certificate from the DO dashboard) -> certificate is verified.
 * - without the CA the connection is encrypted but not verified (DO clusters use a private CA).
 * - DATABASE_SSL=false forces TLS off (local Postgres only).
 * sslmode / uselibpqcompat are removed from the URL so `pg` can never override the options built here.
 */
function connection() {
  let url = config.databaseUrl, mode = '', host = '';
  try {
    const u = new URL(config.databaseUrl);
    host = u.hostname; mode = u.searchParams.get('sslmode') || '';
    u.searchParams.delete('sslmode'); u.searchParams.delete('uselibpqcompat'); u.searchParams.delete('sslrootcert');
    url = u.toString();
  } catch { /* leave the URL as is; pg reports a clear error */ }
  const explicit = process.env.DATABASE_SSL;
  // Explicit false always wins (user wants no TLS even for managed DBs)
  if (explicit === '' || explicit === 'false' || explicit === '0' || explicit === 'no' || explicit === 'off') {
    return { url, ssl: false };
  }
  const forcedOff = explicit !== undefined && explicit !== '' && !config.databaseSsl;
  const wanted = !forcedOff && (config.databaseSsl || (mode && mode !== 'disable') || /\.db\.ondigitalocean\.com$/i.test(host));
  if (!wanted) return { url, ssl: false };
  if (config.databaseSslCa) return { url, ssl: { ca: config.databaseSslCa, rejectUnauthorized: true } };
  // No CA available: connection is encrypted (TLS) but the server cert is not verified.
  // This is common with managed DBs that use a private CA not in Node's default trust store.
  return { url, ssl: { rejectUnauthorized: false } };
}

/** Create the pool (or accept an injected one — used by tests). */
function init(injectedPool) {
  if (injectedPool) { pool = injectedPool; return pool; }
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  const c = connection();
  const max = Math.min(Math.max(1, config.databasePoolMax), POOL_HARD_MAX);
  if (max !== config.databasePoolMax) log.warn({ requested: config.databasePoolMax, using: max }, 'DATABASE_POOL_MAX is too high for a managed PostgreSQL; using a safe pool size. Set DATABASE_POOL_MAX=10 in your environment.');
  pool = new Pool({
    connectionString: c.url,
    ssl: c.ssl,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,                                   // managed databases drop silent idle connections
    statement_timeout: config.statementTimeoutMs,      // a stuck query can never hold a connection forever
    query_timeout: config.statementTimeoutMs + 2000,
    application_name: config.appName
  });
  pool.on('error', (e) => log.error({ err: e.message }, 'idle database client error'));
  return pool;
}

const get = () => { if (!pool) throw new Error('DB not initialised'); return pool; };
/** Read-only statements (SELECT / WITH) are retried once on a dropped or refused connection; writes never are. */
async function query(text, params) {
  try { return await get().query(text, params); }
  catch (e) {
    if (!isTransient(e) || !/^\s*(select|with)\b/i.test(String(text))) throw e;
    log.warn({ code: e.code, err: e.message }, 'transient database error on a read; retrying once');
    await new Promise((r) => setTimeout(r, 250));
    return get().query(text, params);
  }
}
/** Run fn(client) inside BEGIN/COMMIT on one connection; rolls back and rethrows on error. */
async function tx(fn) {
  const client = await get().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw e;
  } finally { client.release(); }
}
const ping = () => query('SELECT 1');
const close = async () => { if (pool) { const p = pool; pool = null; await p.end(); } };

module.exports = { init, get, query, tx, ping, close, connection, POOL_HARD_MAX };
