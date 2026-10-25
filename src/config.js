require('dotenv').config();

const env = process.env;
const bool = (s, dflt = false) => (s === undefined || s === '' ? dflt : /^(1|true|yes|on)$/i.test(String(s)));
const int = (s, dflt) => (s === undefined || s === '' ? dflt : Number(s));

const config = {
  nodeEnv: env.NODE_ENV || 'development',
  port: int(env.PORT, 8080),
  trustProxy: env.TRUST_PROXY || '1',
  clientIpHeader: String(env.CLIENT_IP_HEADER || '').trim().toLowerCase(),   // e.g. do-connecting-ip on DigitalOcean App Platform
  logLevel: env.LOG_LEVEL || 'info',
  appName: env.APP_NAME || 'knoalabs-landing',

  databaseUrl: env.DATABASE_URL || '',
  databasePoolMax: int(env.DATABASE_POOL_MAX, 10),
  statementTimeoutMs: int(env.DB_STATEMENT_TIMEOUT_MS, 10000),
  autoMigrate: bool(env.AUTO_MIGRATE, true),

  rateLimitMax: int(env.RATE_LIMIT_MAX, 10),
  timezone: env.TIMEZONE || 'Asia/Kolkata',          // used for "today", date filters and Excel times

  geo: {                                              // IP intelligence (src/geo.js). Off by default; GEO_PROVIDER=ip-api turns on the keyless ip-api.com lookup.
    provider: String(env.GEO_PROVIDER || 'none').trim().toLowerCase(),   // ip-api | ipapi | maxmind | none
    apiKey: env.GEO_API_KEY || '',                       // optional ipapi.co key (also used by the ipapi.co second opinion)
    ipApiComKey: env.GEO_IPAPI_COM_KEY || '',            // optional ip-api.com paid key: HTTPS pro endpoint, no 45/min limit. Leave empty for the free endpoint
    dailyLimit: int(env.GEO_DAILY_LIMIT, 900),
    storePostal: bool(env.GEO_STORE_POSTAL, false),
    dbPath: env.GEOIP_DB_PATH || '',
    ipSalt: env.GEO_IP_SALT || '',
    trackVisitors: bool(env.GEO_VISITORS, true)       // also look up visitors (not only registrations); uses the same daily budget
  },

  publicBaseUrl: String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),   // e.g. https://register.knoalabs.com ; used for generated links, else the address the admin opened
  campaignEnforce: bool(env.CAMPAIGN_ENFORCE, true),         // only campaigns added in the Campaigns tab and running count; any other utm_campaign goes to the running campaign (or none)
  campaignRedirect: bool(env.CAMPAIGN_REDIRECT, true),   // base link (/datascience) forwards to the active campaign's tagged link

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
  if (c.clientIpHeader && !/^[a-z][a-z0-9-]{1,63}$/.test(c.clientIpHeader)) errors.push('CLIENT_IP_HEADER must be a header name such as do-connecting-ip');
  try { new Intl.DateTimeFormat('en', { timeZone: c.timezone }); } catch { errors.push(`TIMEZONE "${c.timezone}" is not a valid IANA time zone (e.g. Asia/Kolkata)`); }

  const g = c.geo || {};
  if (g.provider && !['ip-api', 'ipapi', 'maxmind', 'none'].includes(g.provider)) errors.push('GEO_PROVIDER must be ip-api, ipapi, maxmind or none');
  if (!Number.isInteger(g.dailyLimit) || g.dailyLimit < 1) errors.push('GEO_DAILY_LIMIT must be a positive integer');
  if (g.ipSalt && g.ipSalt.length < 16) errors.push('GEO_IP_SALT must be at least 16 characters');
  if (g.provider && g.provider !== 'none' && !g.ipSalt && c.nodeEnv === 'production') errors.push('GEO_IP_SALT is required in production when GEO_PROVIDER is on (IP addresses are stored only as salted hashes)');

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
