const crypto = require('crypto');

/* ---------------- passwords: salted scrypt ---------------- */
const N = 16384, R = 8, P = 1, KEYLEN = 64;
const scrypt = (pw, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4], 'base64'), want = Buffer.from(parts[5], 'base64');
  const got = await scrypt(String(password), salt);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** A real hash of a random password: compared against when the user does not exist, so timing does not reveal valid IDs. */
let dummy = null;
const dummyHash = () => (dummy = dummy || hashPassword(crypto.randomBytes(12).toString('hex')));

/* ---------------- sessions: signed, expiring cookie ---------------- */
const COOKIE = 'knoa_admin';
const b64 = (b) => Buffer.from(b).toString('base64url');
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
/** Changes when the password changes, so changing a password logs that user out everywhere. */
const fingerprint = (secret, passwordHash) => hmac(secret, 'pw:' + passwordHash).slice(0, 16);

function signSession(secret, { username, passwordHash, hours }) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64(JSON.stringify({ u: username, v: fingerprint(secret, passwordHash), iat: now, exp: now + hours * 3600 }));
  return `${body}.${hmac(secret, body)}`;
}

/** Returns { username, v } for a valid, unexpired token; otherwise null. */
function readSession(secret, token) {
  const [body, sig, extra] = String(token || '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(hmac(secret, body)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!s || typeof s.u !== 'string' || typeof s.v !== 'string' || !(s.exp > Date.now() / 1000)) return null;
    return { username: s.u, v: s.v };
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } }
  });
  return out;
}

function sessionCookie(token, { maxAgeSeconds, secure }) {
  return `${COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

module.exports = { hashPassword, verifyPassword, dummyHash, signSession, readSession, fingerprint, parseCookies, sessionCookie, COOKIE };
