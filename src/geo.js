// IP intelligence (R13). Provider interface behind one factory so the provider can change without touching the rest.
//
//   const geo = createGeo({ provider:'ip-api'|'ipapi'|'maxmind'|'none', apiKey, ipApiComKey, dailyLimit, storePostal, salt, fetch, store, now, maxmind })
//   'ip-api'  = http://ip-api.com/json/{ip}  (no key needed, the default choice); falls back to ipapi.co, then MaxMind, when it fails
//   'ipapi'   = https://ipapi.co/{ip}/json/  (no key needed up to ipapi.co's free limit)
//   await geo.lookup(ip)        -> { status, source, data|null, cached }   NEVER throws, never blocks registration (callers run it after the response)
//   geo.maskIp(ip) / geo.hashIp(ip)
//
// Spending lookups: the caller decides (always for a new lead, once per new visitor id). Everything else is cached by ip hash for 30 days.
// Status values: ok | private_ip | not_found | rate_limited | quota | error | disabled
// Nothing here stores or returns the raw IP. `network` and the other ipapi fields without analytic value are dropped in normalise().
const net = require('net');
const crypto = require('crypto');

const POSITIVE_TTL_MS = 30 * 24 * 3600e3;
const NEGATIVE_TTL_MS = 3600e3;
const TIMEOUT_MS = 2500;
const PRECISION = 'approximate_city';

/* ---------------- IP helpers ---------------- */
/** ::ffff:1.2.3.4 -> 1.2.3.4. Returns '' for anything that is not an IP. */
function cleanIp(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(s)) s = s.slice(7);
  s = s.replace(/%.+$/, '');                                          // IPv6 zone id
  return net.isIP(s) ? s : '';
}
const ipVersion = (ip) => { const v = net.isIP(cleanIp(ip)); return v || null; };

function v4Parts(ip) { return ip.split('.').map(Number); }
/** Loopback, private, link-local, CGNAT, multicast, reserved: never sent to a provider. */
function isPublicIp(raw) {
  const ip = cleanIp(raw);
  if (!ip) return false;
  if (net.isIPv4(ip)) {
    const [a, b] = v4Parts(ip);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;               // CGNAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;                           // 192.0.0.0/24, 192.0.2.0/24 documentation
    if (a === 198 && (b === 18 || b === 19)) return false;            // benchmarking
    if (a === 198 && b === 51) return false; if (a === 203 && b === 0) return false;   // documentation ranges
    return true;
  }
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return false;
  if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s)) return false;     // unique local, link-local, multicast
  if (s.startsWith('2001:db8')) return false;                                       // documentation
  return true;
}

/** 117.251.10.20 -> 117.251.x.x ; 2401:4900:1234:5678::1 -> 2401:4900:x:x:x:x:x:x */
function maskIp(raw) {
  const ip = cleanIp(raw);
  if (!ip) return null;
  if (net.isIPv4(ip)) { const p = ip.split('.'); return `${p[0]}.${p[1]}.x.x`; }
  const groups = ip.includes('::') ? expandV6(ip) : ip.split(':');
  return `${groups[0]}:${groups[1]}:x:x:x:x:x:x`;
}
function expandV6(ip) {
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
}
function hashIp(raw, salt) {
  const ip = cleanIp(raw);
  if (!ip || !salt) return null;                                      // without a salt nothing is hashed (an unsalted IP hash is reversible)
  return crypto.createHmac('sha256', String(salt)).update(ip.toLowerCase()).digest('hex');
}

/* ---------------- provider response -> the fields we keep ---------------- */
const round2 = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
const text = (v, max) => { const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : ''; return s || null; };

/** Error objects ({"error":true,"reason":"..."}) are never a location. */
function classifyIpapiError(body) {
  const why = String((body && (body.reason || body.message)) || '');
  if (/rate|quota|limit|too many/i.test(why)) return /quota/i.test(why) ? 'quota' : 'rate_limited';
  if (/reserved|private/i.test(why)) return 'private_ip';
  if (/invalid|not found|no data/i.test(why)) return 'not_found';
  return 'error';
}

/** ipapi.co JSON -> only what R13 keeps. `network`, capital, tld, currency, languages, area, population ... are dropped on purpose. */
function normalizeIpapi(body, { storePostal = false } = {}) {
  const b = body || {};
  const out = {
    ip_version: b.version === 'IPv6' ? 6 : b.version === 'IPv4' ? 4 : null,
    geo_city: text(b.city, 80), geo_region: text(b.region, 80), geo_region_code: text(b.region_code, 12),
    geo_country_code: text(b.country_code || b.country, 2), geo_country: text(b.country_name, 80),
    geo_lat: round2(b.latitude), geo_lon: round2(b.longitude),
    geo_timezone: text(b.timezone, 60), geo_utc_offset: text(b.utc_offset, 10),
    geo_calling_code: text(b.country_calling_code, 8),
    geo_asn: text(b.asn, 20), geo_org: text(b.org, 120),
    geo_in_eu: typeof b.in_eu === 'boolean' ? b.in_eu : null
  };
  if (storePostal) out.geo_postal = text(b.postal, 12);
  return out;
}

/* ---------- ip-api.com (http://ip-api.com/json/{ip}), no key needed ---------- */
// ISO country -> calling code. ip-api.com does not return it, and the "phone country differs from IP country" check needs it.
const CALLING_CODES = { IN: '+91', AE: '+971', SA: '+966', QA: '+974', KW: '+965', OM: '+968', BH: '+973', US: '+1', CA: '+1', GB: '+44', AU: '+61', SG: '+65', NZ: '+64', IE: '+353', DE: '+49', FR: '+33', IT: '+39', ES: '+34',
  PT: '+351', NL: '+31', BE: '+32', CH: '+41', AT: '+43', SE: '+46', NO: '+47', DK: '+45', FI: '+358', PL: '+48', CZ: '+420', GR: '+30', TR: '+90', RU: '+7', UA: '+380', IL: '+972', EG: '+20', ZA: '+27', NG: '+234', KE: '+254',
  GH: '+233', MA: '+212', PK: '+92', BD: '+880', LK: '+94', NP: '+977', BT: '+975', MV: '+960', AF: '+93', IR: '+98', IQ: '+964', JO: '+962', LB: '+961', CN: '+86', HK: '+852', TW: '+886', JP: '+81', KR: '+82', TH: '+66',
  VN: '+84', MY: '+60', ID: '+62', PH: '+63', MM: '+95', KH: '+855', BR: '+55', AR: '+54', CL: '+56', CO: '+57', MX: '+52', PE: '+51', MU: '+230' };
const EU_CODES = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
const IPAPI_COM_FIELDS = 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,offset,isp,org,as,query';
const formatOffset = (sec) => { const x = Number(sec); if (sec == null || !Number.isFinite(x)) return null; const a = Math.abs(x); return `${x < 0 ? '-' : '+'}${String(Math.floor(a / 3600)).padStart(2, '0')}${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}`; };

/** ip-api.com JSON -> the same fields normalizeIpapi() keeps. e.g. {"status":"success","country":"India","countryCode":"IN","regionName":"Kerala","city":"Pathanāmthitta","lat":9.2612,"lon":76.7833,"as":"AS9829 National Internet Backbone", ...} */
function normalizeIpApiCom(body, { storePostal = false } = {}) {
  const b = body || {};
  const as = text(b.as, 120) || '', m = /^(AS\d+)\s*(.*)$/i.exec(as);
  const cc = text(b.countryCode, 2), CC = cc ? cc.toUpperCase() : null;
  const out = {
    ip_version: net.isIP(String(b.query || '')) || null,
    geo_city: text(b.city, 80), geo_region: text(b.regionName, 80), geo_region_code: text(b.region, 12),
    geo_country_code: CC, geo_country: text(b.country, 80),
    geo_lat: b.lat == null ? null : round2(b.lat), geo_lon: b.lon == null ? null : round2(b.lon),
    geo_timezone: text(b.timezone, 60), geo_utc_offset: formatOffset(b.offset),
    geo_calling_code: CC ? (CALLING_CODES[CC] || null) : null,
    geo_asn: m ? m[1].toUpperCase() : null,
    geo_org: text(b.org, 120) || text(b.isp, 120) || (m && m[2] ? text(m[2], 120) : null),
    geo_in_eu: CC ? EU_CODES.has(CC) : null
  };
  if (storePostal) out.geo_postal = text(b.zip, 12);
  return out;
}

/** {"status":"fail","message":"private range" | "reserved range" | "invalid query" | ...} is never a location. */
function classifyIpApiComError(body) {
  const why = String((body && body.message) || '');
  if (/private|reserved/i.test(why)) return 'private_ip';
  if (/invalid/i.test(why)) return 'not_found';
  if (/limit|quota|too many|banned/i.test(why)) return 'rate_limited';
  return 'error';
}

/* ---------------- stores ---------------- */
/** In-memory store: used by tests and as the safe default when no database is wired. */
function memoryStore(now = () => Date.now()) {
  const cache = new Map(), budget = new Map();
  return {
    async getCache(h) { const e = cache.get(h); return e && e.expires > now() ? e : null; },
    async setCache(h, status, data, ttlMs) { cache.set(h, { status, data, expires: now() + ttlMs }); },
    async takeBudget(day, limit) { const u = budget.get(day) || 0; if (u >= limit) return { ok: false, used: u }; budget.set(day, u + 1); return { ok: true, used: u + 1 }; },
    async usedToday(day) { return budget.get(day) || 0; },
    _cache: cache, _budget: budget
  };
}

/** PostgreSQL store (geo_cache + geo_budget from migration 013). */
function dbStore(db) {
  return {
    async getCache(h) {
      const { rows } = await db.query('SELECT status, data, expires_at FROM geo_cache WHERE ip_hash=$1 AND expires_at > now()', [h]);
      return rows[0] ? { status: rows[0].status, data: rows[0].data, expires: new Date(rows[0].expires_at).getTime() } : null;
    },
    async setCache(h, status, data, ttlMs) {
      const exp = new Date(Date.now() + ttlMs);
      await db.query(`INSERT INTO geo_cache (ip_hash, status, data, looked_up_at, expires_at) VALUES ($1,$2,$3,now(),$4)
                      ON CONFLICT (ip_hash) DO UPDATE SET status=$2, data=$3, looked_up_at=now(), expires_at=$4`, [h, status, data ? JSON.stringify(data) : null, exp]);
    },
    async takeBudget(day, limit) {
      await db.query('INSERT INTO geo_budget (day, used) VALUES ($1, 0) ON CONFLICT (day) DO NOTHING', [day]);
      const { rows } = await db.query('UPDATE geo_budget SET used = used + 1 WHERE day=$1 AND used < $2 RETURNING used', [day, limit]);
      if (rows.length) return { ok: true, used: rows[0].used };
      const cur = await db.query('SELECT used FROM geo_budget WHERE day=$1', [day]);
      return { ok: false, used: cur.rows[0] ? cur.rows[0].used : limit };
    },
    async usedToday(day) { const { rows } = await db.query('SELECT used FROM geo_budget WHERE day=$1', [day]); return rows[0] ? rows[0].used : 0; }
  };
}

/* ---------------- the provider adapter ---------------- */
function ipapiProvider({ apiKey, fetchImpl, timeoutMs = TIMEOUT_MS, storePostal }) {
  return {
    name: 'ipapi.co',
    async lookup(ip) {
      const url = `https://ipapi.co/${encodeURIComponent(ip)}/json/` + (apiKey ? `?key=${encodeURIComponent(apiKey)}` : '');
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'knoalabs-masterclass/geo' } });
        if (res.status === 429) return { status: 'rate_limited' };
        if (res.status === 403 || res.status === 401) return { status: 'error' };
        if (!res.ok) return { status: 'error' };
        let body; try { body = await res.json(); } catch { return { status: 'error' }; }
        if (!body || typeof body !== 'object') return { status: 'error' };
        if (body.error) return { status: classifyIpapiError(body) };
        const data = normalizeIpapi(body, { storePostal });
        if (!data.geo_country_code && !data.geo_city) return { status: 'not_found' };
        return { status: 'ok', data };
      } catch { return { status: 'error' };                       // timeout (AbortError), DNS failure, TLS ...: never an exception for the caller
      } finally { clearTimeout(timer); }
    }
  };
}

/**
 * ip-api.com: GET http://ip-api.com/json/{ip}?fields=...   No key. The free endpoint is HTTP only and allows 45 requests a minute, so calls
 * are spaced (minIntervalMs) and queued for up to maxWaitMs: lookups run after the registration response, so waiting costs nobody anything.
 * With a paid key (ipApiComKey) the HTTPS pro endpoint is used and the spacing is off.
 */
function ipApiComProvider({ apiKey, fetchImpl, timeoutMs = 4000, storePostal, minIntervalMs, maxWaitMs = 20000, sleep }) {
  const spacing = minIntervalMs != null ? minIntervalMs : (apiKey ? 0 : 1400);
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let nextAt = 0;
  async function slot() {
    if (!spacing) return true;
    const t = Date.now(), at = Math.max(t, nextAt);
    if (at - t > maxWaitMs) return false;
    nextAt = at + spacing;
    if (at > t) await pause(at - t);
    return true;
  }
  return {
    name: 'ip-api.com',
    async lookup(ip) {
      if (!(await slot())) return { status: 'rate_limited', retryAfterMs: 15000 };
      const url = apiKey ? `https://pro.ip-api.com/json/${encodeURIComponent(ip)}?fields=${IPAPI_COM_FIELDS}&key=${encodeURIComponent(apiKey)}` : `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${IPAPI_COM_FIELDS}`;
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'knoalabs-masterclass/geo' } });
        if (res.status === 429) { const ttl = Number(res.headers && res.headers.get && res.headers.get('x-ttl')); return { status: 'rate_limited', retryAfterMs: Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : undefined }; }
        if (!res.ok) return { status: 'error' };
        let body; try { body = await res.json(); } catch { return { status: 'error' }; }
        if (!body || typeof body !== 'object') return { status: 'error' };
        if (body.status === 'fail') return { status: classifyIpApiComError(body) };
        const data = normalizeIpApiCom(body, { storePostal });
        if (!data.geo_country_code && !data.geo_city) return { status: 'not_found' };
        return { status: 'ok', data };
      } catch { return { status: 'error' }; } finally { clearTimeout(timer); }
    }
  };
}

/** MaxMind GeoLite2 fallback. `reader` is a `maxmind` Reader (optional dependency, loaded by the caller from GEOIP_DB_PATH). */
function maxmindProvider(reader) {
  return {
    name: 'maxmind',
    async lookup(ip) {
      try {
        const r = reader.get(ip);
        if (!r) return { status: 'not_found' };
        const subdivision = (r.subdivisions && r.subdivisions[0]) || {};
        return { status: 'ok', data: {
          ip_version: net.isIP(ip), geo_city: text(r.city && r.city.names && r.city.names.en, 80), geo_region: text(subdivision.names && subdivision.names.en, 80), geo_region_code: text(subdivision.iso_code, 12),
          geo_country_code: text(r.country && r.country.iso_code, 2), geo_country: text(r.country && r.country.names && r.country.names.en, 80),
          geo_lat: round2(r.location && r.location.latitude), geo_lon: round2(r.location && r.location.longitude), geo_timezone: text(r.location && r.location.time_zone, 60),
          geo_utc_offset: null, geo_calling_code: null, geo_asn: null, geo_org: null, geo_in_eu: null } };
      } catch { return { status: 'error' }; }
    }
  };
}

/* ---------------- the facade ---------------- */
function createGeo(opts = {}) {
  const provider = opts.provider || 'none';
  const dailyLimit = Number.isInteger(opts.dailyLimit) ? opts.dailyLimit : 900;
  const now = opts.now || (() => Date.now());
  const store = opts.store || memoryStore(now);
  const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  const salt = opts.salt || '';
  const storePostal = Boolean(opts.storePostal);
  const breakerLimit = opts.breakerFailures || 5, breakerCooldown = opts.breakerCooldownMs || 60e3, rateCooldown = opts.rateLimitCooldownMs || 15 * 60e3;
  const primary = !fetchImpl ? null
    : provider === 'ipapi' ? ipapiProvider({ apiKey: opts.apiKey, fetchImpl, timeoutMs: opts.timeoutMs, storePostal })
    : provider === 'ip-api' ? ipApiComProvider({ apiKey: opts.ipApiComKey, fetchImpl, timeoutMs: opts.timeoutMs, storePostal, minIntervalMs: opts.minIntervalMs, sleep: opts.sleep })
    : null;
  const maxmindFb = opts.maxmind ? maxmindProvider(opts.maxmind) : (provider === 'maxmind' && opts.maxmindReader ? maxmindProvider(opts.maxmindReader) : null);
  // when ip-api.com is the primary, ipapi.co (HTTPS, no key needed) is the second opinion, then MaxMind
  const fallbacks = [];
  if (provider === 'ip-api' && fetchImpl) fallbacks.push(ipapiProvider({ apiKey: opts.apiKey, fetchImpl, timeoutMs: opts.timeoutMs, storePostal }));
  if (maxmindFb) fallbacks.push(maxmindFb);
  const dayOf = () => new Date(now()).toISOString().slice(0, 10);

  const stats = { lookups: 0, cacheHits: 0, calls: 0, errors: 0, byStatus: {} };
  const breaker = { failures: 0, openUntil: 0, lastStatus: null };
  const bump = (s) => { stats.byStatus[s] = (stats.byStatus[s] || 0) + 1; };

  function result(status, source, data, cached = false) {
    bump(status);
    return { status, source: data ? source : (source || null), data: data || null, cached, precision: data ? PRECISION : null };
  }
  const breakerOpen = () => now() < breaker.openUntil;
  function recordProviderOutcome(status, retryAfterMs) {
    if (status === 'ok' || status === 'not_found' || status === 'private_ip') { breaker.failures = 0; return; }
    breaker.failures++; breaker.lastStatus = status;
    if (status === 'rate_limited' || status === 'quota') breaker.openUntil = now() + (retryAfterMs ? Math.min(rateCooldown, Math.max(5000, retryAfterMs)) : rateCooldown);      // a 429 opens it at once; ip-api.com says for how long (X-Ttl)
    else if (breaker.failures >= breakerLimit) breaker.openUntil = now() + breakerCooldown;
  }

  async function viaFallback(ip, why) {
    for (const fb of fallbacks) {
      const r = await fb.lookup(ip);
      if (r.status === 'ok') return result('ok', fb.name, r.data);
    }
    return result(why, null, null);                                   // the primary's reason stays the status; location stays unknown
  }

  /** Never throws. */
  async function lookup(rawIp) {
    stats.lookups++;
    try {
      if (provider === 'none' && !fallbacks.length) return result('disabled', null, null);
      const ip = cleanIp(rawIp);
      if (!ip || !isPublicIp(ip)) return result('private_ip', null, null);
      const h = hashIp(ip, salt || 'unsalted-cache-key');            // the cache key is only ever a hash; with no salt a fixed one keeps the key non-reversible enough for a cache
      const hit = await store.getCache(h).catch(() => null);
      if (hit) { stats.cacheHits++; return result(hit.status, hit.data ? (hit.data._source || 'cache') : null, stripSource(hit.data), true); }
      if (!primary) { const r = await viaFallback(ip, 'disabled'); if (r.status === 'ok') await store.setCache(h, 'ok', withSource(r.data, r.source), POSITIVE_TTL_MS).catch(() => {}); return r; }
      if (breakerOpen()) return viaFallback(ip, breaker.lastStatus === 'rate_limited' || breaker.lastStatus === 'quota' ? breaker.lastStatus : 'error');
      const budget = await store.takeBudget(dayOf(), dailyLimit).catch(() => ({ ok: true, used: 0 }));   // a broken counter must not stop leads; the provider itself still limits us
      if (!budget.ok) return viaFallback(ip, 'quota');
      stats.calls++;
      const r = await primary.lookup(ip);
      recordProviderOutcome(r.status, r.retryAfterMs);
      if (r.status === 'ok') { await store.setCache(h, 'ok', withSource(r.data, primary.name), POSITIVE_TTL_MS).catch(() => {}); return result('ok', primary.name, r.data); }
      if (r.status === 'not_found') await store.setCache(h, 'not_found', null, NEGATIVE_TTL_MS).catch(() => {});
      if (r.status === 'error' || r.status === 'rate_limited' || r.status === 'quota') stats.errors++;
      if (r.status === 'private_ip' || r.status === 'not_found') return result(r.status, null, null);
      return viaFallback(ip, r.status);
    } catch { stats.errors++; return result('error', null, null); }
  }
  const withSource = (d, s) => (d ? Object.assign({}, d, { _source: s }) : d);
  const stripSource = (d) => { if (!d) return null; const o = Object.assign({}, d); delete o._source; return o; };

  /** For the dashboard's lookup-health card: today's use, hit rate, error count. Counters are per process; `used` is the persisted day counter. */
  async function health() {
    const used = await store.usedToday(dayOf()).catch(() => null);
    return { provider, dailyLimit, usedToday: used, lookups: stats.lookups, cacheHitRate: stats.lookups ? Math.round((stats.cacheHits / stats.lookups) * 1000) / 10 : null,
      providerCalls: stats.calls, errors: stats.errors, byStatus: Object.assign({}, stats.byStatus), breakerOpen: breakerOpen(), enabled: provider !== 'none' || fallbacks.length > 0 };
  }

  return { lookup, health, maskIp, hashIp: (ip) => hashIp(ip, salt), enabled: provider !== 'none' || fallbacks.length > 0, provider, _breaker: breaker, _store: store };
}

/* ---------------- derived facts ---------------- */
/** Does the IP's country calling code differ from the country code the person chose on the form? null = cannot tell (no data, or "Other" country). */
function phoneCountryMismatch(geoCallingCode, formDialCode) {
  const a = String(geoCallingCode || '').replace(/[^\d+]/g, ''), b = String(formDialCode || '').replace(/[^\d+]/g, '');
  if (!a || !b || b === '+') return null;
  const norm = (x) => (x.startsWith('+') ? x : '+' + x);
  return norm(a) !== norm(b);
}

/** Registration time in the lead's own time zone ({ hour, label }) or null when the zone is unknown or invalid. */
function localTime(timezone, at) {
  if (!timezone) return null;
  try {
    const d = at instanceof Date ? at : new Date(at);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const hour = Number(parts.find((p) => p.type === 'hour').value), minute = parts.find((p) => p.type === 'minute').value;
    return { hour, label: `${String(hour).padStart(2, '0')}:${minute}` };
  } catch { return null; }
}

const HOSTING = /amazon|\baws\b|google (cloud|llc)|microsoft (corp|azure)|digitalocean|\bovh|hetzner|linode|akamai|vultr|oracle (cloud|corp)|cloudflare|m247|datacamp|leaseweb|contabo|choopa|scaleway|alibaba cloud|tencent cloud|hosting|datacenter|data center|colocation|vpn|proxy/i;
/** Datacenter / cloud / VPN-style organisation name: a quality warning, not proof. */
const isLikelyHosting = (org) => HOSTING.test(String(org || ''));

/** Columns to write on a lead for one lookup result (no raw IP). */
function leadColumns(res, { ip, salt, formDialCode, now = new Date() } = {}) {
  const d = res.data || {};
  const cols = {
    ip_hash: hashIp(ip, salt), ip_version: ipVersion(ip) || d.ip_version || null,
    geo_status: res.status, geo_source: res.data ? (res.source || null) : null, geo_precision: res.data ? PRECISION : null, geo_looked_up_at: now,
    geo_city: d.geo_city || null, geo_region: d.geo_region || null, geo_region_code: d.geo_region_code || null, geo_country_code: d.geo_country_code || null, geo_country: d.geo_country || null,
    geo_lat: d.geo_lat ?? null, geo_lon: d.geo_lon ?? null, geo_timezone: d.geo_timezone || null, geo_utc_offset: d.geo_utc_offset || null,
    geo_calling_code: d.geo_calling_code || null, geo_asn: d.geo_asn || null, geo_org: d.geo_org || null, geo_in_eu: d.geo_in_eu ?? null,
    phone_country_mismatch: res.data ? phoneCountryMismatch(d.geo_calling_code, formDialCode) : null
  };
  return cols;
}

module.exports = { createGeo, memoryStore, dbStore, ipapiProvider, ipApiComProvider, maxmindProvider, normalizeIpapi, normalizeIpApiCom, classifyIpapiError, classifyIpApiComError, CALLING_CODES, cleanIp, isPublicIp, maskIp, hashIp, ipVersion,
  phoneCountryMismatch, localTime, isLikelyHosting, leadColumns, POSITIVE_TTL_MS, NEGATIVE_TTL_MS, TIMEOUT_MS };
