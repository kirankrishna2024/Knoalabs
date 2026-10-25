const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DIR = path.join(__dirname, '..', 'migrations');
const LOCK_ID = 727274; // arbitrary app-wide advisory lock key
const FILE_RE = /^(\d{3,})_([a-z0-9_]+)\.sql$/;
// A file that starts with the comment "-- migrate:allow-edit" may be corrected after it was applied (its SQL must be safe to run again):
// the runner then stores the new checksum instead of refusing. Used only to repair migrations that were edited in the past.
const EDITABLE_RE = /^--\s*migrate:\s*allow-edit\b/m;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function readMigrations(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set();
  return files.map((file) => {
    const m = FILE_RE.exec(file);
    if (!m) throw new Error(`Bad migration file name "${file}". Use 001_short_name.sql (lowercase, digits, underscores).`);
    if (seen.has(m[1])) throw new Error(`Duplicate migration number ${m[1]}`);
    seen.add(m[1]);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    return { version: m[1], name: m[2], file, sql, checksum: sha(sql), editable: EDITABLE_RE.test(sql) };
  });
}

async function ensureTable(q) {
  const { rows } = await q("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'schema_migrations'");
  if (rows.length) return;
  await q(`CREATE TABLE schema_migrations (
    version    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

/** Compare files on disk with what the database has applied. */
async function status(pool, { dir = DEFAULT_DIR } = {}) {
  const q = (s, p) => pool.query(s, p);
  await ensureTable(q);
  const applied = new Map((await q('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version')).rows.map((r) => [r.version, r]));
  const files = readMigrations(dir);
  const known = new Set(files.map((f) => f.version));
  return {
    applied: files.filter((f) => applied.has(f.version)).map((f) => ({ ...applied.get(f.version), modified: !f.editable && applied.get(f.version).checksum !== f.checksum })),
    pending: files.filter((f) => !applied.has(f.version)),
    unknown: [...applied.keys()].filter((v) => !known.has(v))   // applied in DB but file missing
  };
}

/**
 * Apply all pending migrations, each in its own transaction.
 * - refuses to run if an already-applied file was edited (checksum) or is missing
 *   (allowMissing: only warn about a missing file: the database is newer than this build, e.g. after a rollback of the app)
 * - uses a Postgres advisory lock so two app instances starting together don't race
 */
async function run(pool, { dir = DEFAULT_DIR, lock = true, log = () => {}, allowMissing = false } = {}) {
  const client = await pool.connect();
  const q = (s, p) => client.query(s, p);
  try {
    // migrations may take longer than the 10s request timeout; the lock needs a direct (non-pooled) connection, port 25060 on DigitalOcean
    await q('SET statement_timeout = 120000').catch(() => {});
    if (lock) await q(`SELECT pg_advisory_lock(${LOCK_ID})`);
    await ensureTable(q);
    const done = new Map((await q('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]));
    const files = readMigrations(dir);

    for (const v of done.keys()) {
      if (files.some((f) => f.version === v)) continue;
      const msg = `Migration ${v} is applied in the database but its file is missing.`;
      if (!allowMissing) throw new Error(msg);
      log(`WARNING: ${msg} The database is newer than this build; continuing.`);
    }
    for (const f of files) {
      if (!done.has(f.version) || done.get(f.version) === f.checksum) continue;
      if (!f.editable) throw new Error(`Migration ${f.file} was modified after it was applied. Never edit applied migrations; add a new one.`);
      await q('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [f.version, f.checksum]);   // allow-edit: accept the corrected file
      done.set(f.version, f.checksum); log(`checksum of ${f.file} updated (allow-edit)`);
    }

    const applied = [];
    for (const f of files.filter((x) => !done.has(x.version))) {
      log(`applying ${f.file}`);
      try {
        await q('BEGIN');
        await q(f.sql);
        await q('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1,$2,$3)', [f.version, f.name, f.checksum]);
        await q('COMMIT');
      } catch (e) {
        await q('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${f.file} failed and was rolled back: ${e.message}`);
      }
      applied.push(f.file);
    }
    return { applied, total: files.length };
  } finally {
    if (lock) await client.query(`SELECT pg_advisory_unlock(${LOCK_ID})`).catch(() => {});
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
}

module.exports = { run, status, readMigrations, DEFAULT_DIR };
