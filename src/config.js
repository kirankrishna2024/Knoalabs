require('dotenv').config();

const env = process.env;
const bool = (s, dflt = false) => (s === undefined || s === '' ? dflt : /^(1|true|yes|on)$/i.test(String(s)));
const int = (s, dflt) => (s === undefined || s === '' ? dflt : Number(s));

const config = {
  nodeEnv: env.NODE_ENV || 'development',
  port: int(env.PORT, 8080),
  trustProxy: env.TRUST_PROXY || '1',
  logLevel: env.LOG_LEVEL || 'info',
  appName: env.APP_NAME || 'knoalabs-landing',

  databaseUrl: env.DATABASE_URL || '',
  databaseSsl: bool(env.DATABASE_SSL),
  databaseSslCa: (env.DATABASE_SSL_CA || '').replace(/\\n/g, '\n'),   // PEM; when set the server certificate is verified
  databasePoolMax: int(env.DATABASE_POOL_MAX, 10),
  statementTimeoutMs: int(env.DB_STATEMENT_TIMEOUT_MS, 10000),
  autoMigrate: bool(env.AUTO_MIGRATE, true),

  rateLimitMax: int(env.RATE_LIMIT_MAX, 10),
  timezone: env.TIMEZONE || 'Asia/Kolkata',          // used for "today", date filters and Excel times

  admin: {
    username: String(env.ADMIN_USERNAME || '').trim().toLowerCase(),   // seeds the first admin on start
    password: env.ADMIN_PASSWORD || '',
    sessionSecret: env.SESSION_SECRET || '',
    sessionHours: int(env.ADMIN_SESSION_HOURS, 8),
    loginMax: int(env.ADMIN_LOGIN_MAX, 10)             // login attempts per IP per 10 minutes
  }
};

/** Fail fast with every problem listed, instead of misbehaving later. */
function validate(c = config) {
  const errors = [];
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) errors.push('PORT must be 1-65535');
  if (!Number.isInteger(c.rateLimitMax) || c.rateLimitMax < 1) errors.push('RATE_LIMIT_MAX must be a positive integer');
  if (!Number.isInteger(c.databasePoolMax) || c.databasePoolMax < 1) errors.push('DATABASE_POOL_MAX must be a positive integer');
  try { new Intl.DateTimeFormat('en', { timeZone: c.timezone }); } catch { errors.push(`TIMEZONE "${c.timezone}" is not a valid IANA time zone (e.g. Asia/Kolkata)`); }

  const a = c.admin;
  if (a.username && !/^[a-z0-9._-]{3,40}$/.test(a.username)) errors.push('ADMIN_USERNAME must be 3-40 characters: letters, digits, dot, dash, underscore');
  if (a.username && !a.password) errors.push('ADMIN_PASSWORD is required when ADMIN_USERNAME is set');
  if (a.password && a.password.length < 10) errors.push('ADMIN_PASSWORD must be at least 10 characters');
  if (a.sessionSecret && a.sessionSecret.length < 32) errors.push('SESSION_SECRET must be at least 32 characters (generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  if (!a.sessionSecret && c.nodeEnv === 'production') errors.push('SESSION_SECRET is required in production (admin login sessions are signed with it)');
  if (!Number.isInteger(a.sessionHours) || a.sessionHours < 1 || a.sessionHours > 168) errors.push('ADMIN_SESSION_HOURS must be 1-168');
  if (!Number.isInteger(a.loginMax) || a.loginMax < 1) errors.push('ADMIN_LOGIN_MAX must be a positive integer');
  return errors;
}

module.exports = config;
module.exports.validate = validate;
