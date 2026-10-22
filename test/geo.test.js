// IP intelligence: ipapi.co adapter against a fixture (never the live API), budget, circuit breaker, cache, fallback, masking, mismatch flag.
// Run: node test/geo.test.js
process.env.LOG_LEVEL = 'silent';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const G = require('../src/geo');
const db = require('../src/db');
const migrate = require('../src/migrate');
let n = 0; const ok = (m) => console.log(`  ✓ GE${++n}. ${m}`);
const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ipapi-sample.json'), 'utf8'));
const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const PUBLIC_IP = '117.251.10.20';

/** A fetch double that records every call: no test can reach the network. */
function fakeFetch(handler) { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); }; f.calls = calls; return f; }
const make = (handler, extra = {}) => { const f = fakeFetch(handler); const clock = { t: Date.parse('2026-10-22T10:00:00Z') }; const geo = G.createGeo({ provider: 'ipapi', fetch: f, salt: 'test-salt', now: () => clock.t, ...extra }); return { geo, f, clock }; };

(async () => {
  /* ---- normalisation: keep what R13 lists, drop the rest ---- */
  const d = G.normalizeIpapi(SAMPLE);
  assert.deepStrictEqual(d, { ip_version: 4, geo_city: 'Kochi', geo_region: 'Kerala', geo_region_code: 'KL', geo_country_code: 'IN', geo_country: 'India', geo_lat: 9.93, geo_lon: 76.27,
    geo_timezone: 'Asia/Kolkata', geo_utc_offset: '+0530', geo_calling_code: '+91', geo_asn: 'AS9829', geo_org: 'National Internet Backbone', geo_in_eu: false });
  const dump = JSON.stringify(d);
  for (const dropped of ['117.251', 'network', 'New Delhi', '.in', 'INR', 'Rupee', 'IND', 'AS', '1352617328', 'postal', '682001']) if (dropped !== 'AS') assert(!dump.includes(dropped), 'kept ' + dropped);
  assert(!('geo_postal' in d));
  ok('only the fields listed in R13 are kept (city, region, country, lat/lon rounded to 2 decimals, timezone, offset, calling code, ASN, org, EU flag, IP version); ip, network, capital, currency, languages, population are dropped');
  assert.strictEqual(G.normalizeIpapi(SAMPLE, { storePostal: true }).geo_postal, '682001'); ok('postal code is stored only when GEO_STORE_POSTAL is switched on');

  /* ---- happy path, request shape ---- */
  let { geo, f } = make(() => jsonRes(SAMPLE));
  let r = await geo.lookup(PUBLIC_IP);
  assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.source, 'ipapi.co'); assert.strictEqual(r.data.geo_city, 'Kochi'); assert.strictEqual(r.precision, 'approximate_city');
  assert.strictEqual(f.calls.length, 1); assert.strictEqual(f.calls[0].url, `https://ipapi.co/${PUBLIC_IP}/json/`); assert(f.calls[0].init.signal, 'abort signal for the timeout');
  ok('lookup calls GET https://ipapi.co/{ip}/json/ with an abort signal and returns the normalised, approximate location');
  ({ geo, f } = make(() => jsonRes(SAMPLE), { apiKey: 'k e/y' })); await geo.lookup(PUBLIC_IP);
  assert.strictEqual(f.calls[0].url, `https://ipapi.co/${PUBLIC_IP}/json/?key=k%20e%2Fy`); ok('the optional API key is added as ?key= (URL-encoded) only when configured');
  ({ geo, f } = make(() => jsonRes(SAMPLE))); await geo.lookup('2401:4900:1234:5678::1'); assert.strictEqual(f.calls[0].url, 'https://ipapi.co/2401%3A4900%3A1234%3A5678%3A%3A1/json/'); ok('IPv6 addresses are looked up (URL-encoded)');

  /* ---- failures are statuses, never locations, never exceptions ---- */
  const cases = [
    ['HTTP 429', () => jsonRes({}, 429), 'rate_limited'],
    ['error object: rate limited', () => jsonRes({ error: true, reason: 'RateLimited', message: 'Rate limit exceeded' }), 'rate_limited'],
    ['error object: quota', () => jsonRes({ error: true, reason: 'Quota exceeded' }), 'quota'],
    ['error object: reserved IP', () => jsonRes({ error: true, reason: 'Reserved IP Address' }), 'private_ip'],
    ['error object: invalid', () => jsonRes({ error: true, reason: 'Invalid IP Address' }), 'not_found'],
    ['error object: other', () => jsonRes({ error: true, reason: 'Something odd' }), 'error'],
    ['HTTP 500', () => jsonRes({}, 500), 'error'],
    ['HTTP 403', () => jsonRes({}, 403), 'error'],
    ['broken JSON', () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }), 'error'],
    ['JSON null', () => jsonRes(null), 'error'],
    ['empty object', () => jsonRes({}), 'not_found'],
    ['network exception', () => { throw new Error('ECONNRESET'); }, 'error']
  ];
  for (const [label, handler, expect] of cases) {
    const t = make(handler); const res = await t.geo.lookup(PUBLIC_IP);
    assert.strictEqual(res.status, expect, label); assert.strictEqual(res.data, null, label + ' must not carry a location');
  }
  ok(`${cases.length} failure shapes (429, error objects, 4xx/5xx, bad JSON, empty, network error) become a status, never a location, never an exception`);

  /* ---- timeout ---- */
  const slow = make((_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))), { timeoutMs: 40 });
  const t0 = Date.now(); const rt = await slow.geo.lookup(PUBLIC_IP); const took = Date.now() - t0;
  assert.strictEqual(rt.status, 'error'); assert(took < 1000, 'took ' + took); ok(`a provider that never answers is cut off by the timeout (${took} ms) and reported as error`);
  assert.strictEqual(G.TIMEOUT_MS, 2500); ok('the default timeout is 2.5 s');

  /* ---- private / reserved / malformed IPs: no network call ---- */
  ({ geo, f } = make(() => jsonRes(SAMPLE)));
  for (const ip of ['10.0.0.5', '192.168.1.9', '172.16.4.4', '172.31.255.255', '127.0.0.1', '::1', 'fc00::1', 'fe80::1', '100.64.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '::ffff:10.1.2.3', '203.0.113.9', 'not-an-ip', '', null, undefined, '999.1.1.1', '1.2.3']) {
    const res = await geo.lookup(ip); assert.strictEqual(res.status, 'private_ip', String(ip)); assert.strictEqual(res.data, null);
  }
  assert.strictEqual(f.calls.length, 0); ok('private, loopback, link-local, CGNAT, multicast, documentation, IPv4-mapped private and malformed addresses never reach the provider');
  assert.strictEqual(G.isPublicIp('::ffff:117.251.10.20'), true); assert.strictEqual(G.isPublicIp('2401:4900:1234::1'), true); assert.strictEqual(G.isPublicIp('8.8.8.8'), true); ok('public IPv4, IPv6 and IPv4-mapped public addresses are accepted');

  /* ---- cache ---- */
  let t = make(() => jsonRes(SAMPLE)); await t.geo.lookup(PUBLIC_IP); const again = await t.geo.lookup(PUBLIC_IP);
  assert.strictEqual(t.f.calls.length, 1); assert.strictEqual(again.cached, true); assert.strictEqual(again.data.geo_city, 'Kochi'); assert(!JSON.stringify(again).includes('_source'));
  t.clock.t += 29 * 24 * 3600e3; await t.geo.lookup(PUBLIC_IP); assert.strictEqual(t.f.calls.length, 1, 'still cached after 29 days');
  t.clock.t += 2 * 24 * 3600e3; await t.geo.lookup(PUBLIC_IP); assert.strictEqual(t.f.calls.length, 2, 'looked up again after 31 days');
  ok('the second lookup of an IP is served from the cache (no provider call): still cached after 29 days, looked up again after 31');
  t = make(() => jsonRes({ error: true, reason: 'Invalid IP Address' })); await t.geo.lookup(PUBLIC_IP); const neg = await t.geo.lookup(PUBLIC_IP);
  assert.strictEqual(t.f.calls.length, 1); assert.strictEqual(neg.status, 'not_found');
  t.clock.t += 59 * 60e3; await t.geo.lookup(PUBLIC_IP); assert.strictEqual(t.f.calls.length, 1, 'still negative-cached at 59 min');
  t.clock.t += 2 * 60e3; await t.geo.lookup(PUBLIC_IP); assert.strictEqual(t.f.calls.length, 2, 'retried after 61 min');
  ok('"not found" is cached for 1 hour (not retried at 59 min, retried at 61 min) so a bad address is not looked up in a loop');
  assert.strictEqual(G.POSITIVE_TTL_MS, 30 * 86400e3); assert.strictEqual(G.NEGATIVE_TTL_MS, 3600e3); ok('cache lifetimes are 30 days (found) and 1 hour (not found)');

  /* ---- daily budget ---- */
  const fb = { get: (ip) => ({ city: { names: { en: 'Mumbai' } }, subdivisions: [{ iso_code: 'MH', names: { en: 'Maharashtra' } }], country: { iso_code: 'IN', names: { en: 'India' } }, location: { latitude: 19.07612, longitude: 72.87771, time_zone: 'Asia/Kolkata' } }) };
  t = make(() => jsonRes(SAMPLE), { dailyLimit: 3 });
  for (let k = 1; k <= 3; k++) assert.strictEqual((await t.geo.lookup(`117.251.10.${k}`)).status, 'ok');
  const over = await t.geo.lookup('117.251.10.99'); assert.strictEqual(over.status, 'quota'); assert.strictEqual(t.f.calls.length, 3); ok('when GEO_DAILY_LIMIT is reached the lookup is marked quota and the provider is not called');
  t = make(() => jsonRes(SAMPLE), { dailyLimit: 1, maxmind: fb }); await t.geo.lookup('117.251.10.1'); const viaMm = await t.geo.lookup('117.251.10.2');
  assert.strictEqual(viaMm.status, 'ok'); assert.strictEqual(viaMm.source, 'maxmind'); assert.strictEqual(viaMm.data.geo_city, 'Mumbai'); assert.strictEqual(viaMm.data.geo_asn, null); assert.strictEqual(t.f.calls.length, 1);
  ok('over the daily budget the local MaxMind fallback fills in the location (source recorded as maxmind, no ISP data)');
  t.clock.t += 24 * 3600e3; await t.geo.lookup('117.251.10.3'); assert.strictEqual(t.f.calls.length, 2); ok('the budget counter is per day: the next day lookups resume');

  /* ---- circuit breaker ---- */
  t = make(() => { throw new Error('down'); });
  for (let k = 0; k < 5; k++) await t.geo.lookup(`117.251.20.${k}`);
  assert.strictEqual(t.f.calls.length, 5); const open = await t.geo.lookup('117.251.20.50'); assert.strictEqual(t.f.calls.length, 5, 'breaker must stop calls'); assert.strictEqual(open.status, 'error');
  t.clock.t += 61e3; await t.geo.lookup('117.251.20.51'); assert.strictEqual(t.f.calls.length, 6); ok('after 5 failures in a row the circuit breaker opens (no tight retry loop) and tries again after the cool-down');
  t = make(() => jsonRes({}, 429)); await t.geo.lookup('117.251.30.1'); const afterLimit = await t.geo.lookup('117.251.30.2');
  assert.strictEqual(t.f.calls.length, 1); assert.strictEqual(afterLimit.status, 'rate_limited'); t.clock.t += 16 * 60e3; await t.geo.lookup('117.251.30.3'); assert.strictEqual(t.f.calls.length, 2);
  ok('a 429 opens the breaker immediately for 15 minutes');
  t = make(() => jsonRes({}, 500), { maxmind: fb }); const fall = await t.geo.lookup(PUBLIC_IP); assert.strictEqual(fall.status, 'ok'); assert.strictEqual(fall.source, 'maxmind'); ok('when ipapi.co fails, the MaxMind fallback is used; with no fallback the lead keeps an unknown location and the failure status (checked above)');

  /* ---- ip-api.com: keyless, the model from the requirements (http://ip-api.com/json/117.202.180.86) ---- */
  const IPAPI_COM = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ip-api-sample.json'), 'utf8'));
  const makeCom = (handler, extra = {}) => { const f = fakeFetch(handler); const clock = { t: Date.parse('2026-10-22T10:00:00Z') }; const geo = G.createGeo({ provider: 'ip-api', fetch: f, salt: 'test-salt', now: () => clock.t, minIntervalMs: 0, ...extra }); return { geo, f, clock }; };
  const dc = G.normalizeIpApiCom(IPAPI_COM);
  assert.deepStrictEqual(dc, { ip_version: 4, geo_city: 'Pathanāmthitta', geo_region: 'Kerala', geo_region_code: 'KL', geo_country_code: 'IN', geo_country: 'India', geo_lat: 9.26, geo_lon: 76.78,
    geo_timezone: 'Asia/Kolkata', geo_utc_offset: '+0530', geo_calling_code: '+91', geo_asn: 'AS9829', geo_org: 'BSNL Internet', geo_in_eu: false });
  assert(!JSON.stringify(dc).includes('117.202'), 'no raw IP kept'); assert(!('geo_postal' in dc)); assert.strictEqual(G.normalizeIpApiCom(IPAPI_COM, { storePostal: true }).geo_postal, '689602');
  assert.strictEqual(G.normalizeIpApiCom({ ...IPAPI_COM, org: 'Acme Org' }).geo_org, 'Acme Org'); assert.strictEqual(G.normalizeIpApiCom({ ...IPAPI_COM, org: '', isp: '' }).geo_org, 'National Internet Backbone');
  assert.strictEqual(G.normalizeIpApiCom({ ...IPAPI_COM, countryCode: 'DE', offset: -3600 }).geo_in_eu, true); assert.strictEqual(G.normalizeIpApiCom({ ...IPAPI_COM, offset: -12600 }).geo_utc_offset, '-0330');
  ok('ip-api.com model (status, country, regionName, city, zip, lat, lon, timezone, offset, isp/org, as) maps to the same fields as ipapi.co; coordinates rounded, ASN split from the AS name, calling code and EU flag derived, no raw IP');
  let c = makeCom(() => jsonRes(IPAPI_COM)); let cr = await c.geo.lookup('117.202.180.86');
  assert.strictEqual(cr.status, 'ok'); assert.strictEqual(cr.source, 'ip-api.com'); assert.strictEqual(cr.data.geo_city, 'Pathanāmthitta'); assert.strictEqual(c.f.calls.length, 1);
  assert(c.f.calls[0].url.startsWith('http://ip-api.com/json/117.202.180.86?fields=')); assert(!/key=/.test(c.f.calls[0].url)); assert(c.f.calls[0].init.signal);
  ok('lookup calls GET http://ip-api.com/json/{ip} with no API key and an abort signal');
  await c.geo.lookup('117.202.180.86'); assert.strictEqual(c.f.calls.length, 1, 'second lookup comes from the cache'); ok('ip-api.com answers are cached by IP hash like every other provider');
  c = makeCom(() => jsonRes(IPAPI_COM), { ipApiComKey: 'k e/y' }); await c.geo.lookup('117.202.180.86'); assert(c.f.calls[0].url.startsWith('https://pro.ip-api.com/json/117.202.180.86?') && c.f.calls[0].url.endsWith('&key=k%20e%2Fy')); ok('an optional paid ip-api.com key switches to the HTTPS pro endpoint');
  c = makeCom(() => jsonRes({ status: 'fail', message: 'private range', query: '10.0.0.1' })); assert.strictEqual((await c.geo.lookup('117.202.180.87')).status, 'private_ip');
  c = makeCom(() => jsonRes({ status: 'fail', message: 'invalid query' })); assert.strictEqual((await c.geo.lookup('117.202.180.88')).status, 'not_found'); ok('{"status":"fail"} answers are never a location (private range -> private_ip, invalid query -> not_found)');
  c = makeCom((u) => (u.startsWith('http://ip-api.com') ? { ok: false, status: 429, headers: { get: (h) => (h === 'x-ttl' ? '30' : null) }, json: async () => ({}) } : jsonRes(SAMPLE)));
  const viaSecond = await c.geo.lookup('117.202.180.89'); assert.strictEqual(viaSecond.status, 'ok'); assert.strictEqual(viaSecond.source, 'ipapi.co'); assert.strictEqual(viaSecond.data.geo_city, 'Kochi');
  const callsBefore = c.f.calls.length; await c.geo.lookup('117.202.180.90'); assert(c.f.calls.slice(callsBefore).every((x) => x.url.startsWith('https://ipapi.co/')), 'breaker is open: ip-api.com is not hit again'); c.clock.t += 31e3; await c.geo.lookup('117.202.180.91');
  assert(c.f.calls[c.f.calls.length - 2].url.startsWith('http://ip-api.com/'), 'ip-api.com is tried again after the X-Ttl wait');
  ok('a 429 from ip-api.com falls back to ipapi.co and pauses ip-api.com for the time its X-Ttl header names');
  c = makeCom(() => jsonRes({}, 500), { maxmind: fb }); const m2 = await c.geo.lookup('117.202.180.92'); assert.strictEqual(m2.status, 'ok'); assert.strictEqual(m2.source, 'maxmind'); ok('ip-api.com and ipapi.co both failing: MaxMind (when configured) is the last fallback');
  {
    const slept = []; const p = G.ipApiComProvider({ fetchImpl: async () => jsonRes(IPAPI_COM), sleep: async (ms) => { slept.push(ms); } });
    await Promise.all([p.lookup('117.202.180.93'), p.lookup('117.202.180.94'), p.lookup('117.202.180.95')]);
    assert.strictEqual(slept.length, 2); assert(slept[1] > slept[0] && slept[0] > 0 && slept[0] <= 1400 * 1.01); ok('the free endpoint allows 45 requests a minute: calls are spaced out (queued after the registration response), never sent in a burst');
  }
  {
    const cfg = require('../src/config'), withProvider = (provider) => cfg.validate({ ...cfg, nodeEnv: 'test', geo: { ...cfg.geo, provider, ipSalt: 'x'.repeat(20) } }).filter((e) => /GEO_PROVIDER/.test(e));
    assert.deepStrictEqual(withProvider('ip-api'), []); assert.strictEqual(withProvider('bogus').length, 1); assert(/ip-api/.test(withProvider('bogus')[0]));
    ok('GEO_PROVIDER=ip-api is accepted by the config validation (and the error message lists it)');
  }

  /* ---- disabled ---- */
  const off = G.createGeo({ provider: 'none' }); const offRes = await off.lookup(PUBLIC_IP); assert.strictEqual(offRes.status, 'disabled'); assert.strictEqual(off.enabled, false); ok('GEO_PROVIDER=none: nothing is looked up, status disabled');

  /* ---- masking and hashing: no raw IP anywhere ---- */
  assert.strictEqual(G.maskIp('117.251.10.20'), '117.251.x.x'); assert.strictEqual(G.maskIp('2401:4900:1234:5678::1'), '2401:4900:x:x:x:x:x:x'); assert.strictEqual(G.maskIp('::1'), '0:0:x:x:x:x:x:x'); assert.strictEqual(G.maskIp('garbage'), null); assert.strictEqual(G.maskIp('::ffff:1.2.3.4'), '1.2.x.x');
  const h1 = G.hashIp(PUBLIC_IP, 's1'), h2 = G.hashIp(PUBLIC_IP, 's2'); assert(/^[0-9a-f]{64}$/.test(h1)); assert.notStrictEqual(h1, h2); assert.strictEqual(h1, G.hashIp(' ' + PUBLIC_IP, 's1')); assert.strictEqual(G.hashIp(PUBLIC_IP, ''), null); assert(!h1.includes('117'));
  ok('IPs are masked for display (117.251.x.x) and hashed with a salt (HMAC-SHA256); without a salt nothing is hashed');
  const cols = G.leadColumns(r, { ip: PUBLIC_IP, salt: 'test-salt', formDialCode: '+91', now: new Date('2026-10-22T10:00:00Z') });
  assert(!JSON.stringify(cols).includes(PUBLIC_IP) && !JSON.stringify(r).includes(PUBLIC_IP)); assert.strictEqual(cols.geo_status, 'ok'); assert.strictEqual(cols.geo_source, 'ipapi.co'); assert.strictEqual(cols.geo_precision, 'approximate_city'); assert.strictEqual(cols.ip_version, 4); assert.strictEqual(cols.phone_country_mismatch, false);
  ok('the columns written for a lead (and the lookup result) contain no raw IP; status, source, precision, IP version and lookup time are recorded');

  /* ---- mismatch flag, local time, hosting ---- */
  assert.strictEqual(G.phoneCountryMismatch('+91', '+91'), false); assert.strictEqual(G.phoneCountryMismatch('+91', '+971'), true); assert.strictEqual(G.phoneCountryMismatch('+1', '+1'), false); assert.strictEqual(G.phoneCountryMismatch('+91', null), null); assert.strictEqual(G.phoneCountryMismatch('+91', '+'), null); assert.strictEqual(G.phoneCountryMismatch(null, '+91'), null); assert.strictEqual(G.phoneCountryMismatch('91', '+91'), false);
  assert.strictEqual(G.leadColumns(r, { ip: PUBLIC_IP, salt: 's', formDialCode: '+971' }).phone_country_mismatch, true);
  assert.strictEqual(G.leadColumns({ status: 'error', data: null }, { ip: PUBLIC_IP, salt: 's', formDialCode: '+971' }).phone_country_mismatch, null);
  ok('country mismatch (IP calling code vs the country chosen on the form): true / false, and null when either side is unknown ("Other" country, failed lookup)');
  const lt = G.localTime('Asia/Kolkata', new Date('2026-10-22T10:00:00Z')); assert.deepStrictEqual(lt, { hour: 15, label: '15:30' }); assert.strictEqual(G.localTime('Not/AZone', new Date()), null); assert.strictEqual(G.localTime(null, new Date()), null); assert.strictEqual(G.localTime('America/New_York', new Date('2026-10-22T10:00:00Z')).label, '06:00');
  ok('registration time is shown in the lead\'s own time zone (10:00 UTC = 15:30 in Asia/Kolkata); unknown zones give null');
  for (const org of ['Amazon.com, Inc.', 'DigitalOcean, LLC', 'Hetzner Online GmbH', 'Google LLC', 'NordVPN hosting']) assert(G.isLikelyHosting(org), org);
  for (const org of ['National Internet Backbone', 'Bharti Airtel Ltd', 'Reliance Jio Infocomm', '', null]) assert(!G.isLikelyHosting(org), String(org));
  ok('datacenter / cloud / VPN organisations are flagged as likely non-human; home and mobile carriers are not');

  /* ---- health card ---- */
  t = make(() => jsonRes(SAMPLE)); await t.geo.lookup('117.251.1.1'); await t.geo.lookup('117.251.1.1'); await t.geo.lookup('10.0.0.1');
  const h = await t.geo.health(); assert.strictEqual(h.usedToday, 1); assert.strictEqual(h.dailyLimit, 900); assert.strictEqual(h.lookups, 3); assert.strictEqual(h.providerCalls, 1); assert.strictEqual(h.cacheHitRate, 33.3); assert.strictEqual(h.breakerOpen, false);
  ok('lookup health: used today / daily limit (default 900), cache hit rate, provider calls, errors');

  /* ---- the PostgreSQL store (geo_cache + geo_budget) ---- */
  db.init(new (newDb().adapters.createPg().Pool)()); await migrate.run(db.get(), { lock: false });
  const dbs = G.dbStore(db); const live = G.createGeo({ provider: 'ipapi', fetch: fakeFetch(() => jsonRes(SAMPLE)), salt: 'x', store: dbs, dailyLimit: 2 });
  assert.strictEqual((await live.lookup('117.251.5.1')).status, 'ok'); assert.strictEqual((await live.lookup('117.251.5.1')).cached, true);
  assert.strictEqual((await live.lookup('117.251.5.2')).status, 'ok'); assert.strictEqual((await live.lookup('117.251.5.3')).status, 'quota');
  const rows = (await db.query('SELECT ip_hash, status FROM geo_cache')).rows; assert.strictEqual(rows.length, 2); assert(rows.every((x) => /^[0-9a-f]{64}$/.test(x.ip_hash))); assert(!JSON.stringify((await db.query('SELECT * FROM geo_cache')).rows).includes('117.251.5'));
  const day = (await db.query('SELECT used FROM geo_budget')).rows; assert.strictEqual(day[0].used, 2);
  ok('PostgreSQL store (pg-mem): the daily counter stops at the limit, cache rows are keyed by a hash and hold no raw IP');
  await db.close();

  console.log(`\nAll ${n} geo checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
