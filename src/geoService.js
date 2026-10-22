// Wires src/geo.js to the app: one shared instance, and enrichLead(), which runs AFTER the registration response.
// It never throws and never blocks a registration. With GEO_PROVIDER=none (the default) it does nothing at all.
const config = require('./config');
const log = require('./logger');
const db = require('./db');
const G = require('./geo');

let instance = null, opening = null;

async function openMaxmind() {
  if (!config.geo.dbPath) return null;
  try { const maxmind = require('maxmind'); return await maxmind.open(config.geo.dbPath); }   // optional dependency: absent = no fallback
  catch (e) { log.warn({ err: e.message }, 'GEOIP_DB_PATH is set but the MaxMind database could not be opened; continuing without the fallback'); return null; }
}

function build(extra = {}) {
  return G.createGeo({ provider: config.geo.provider, apiKey: config.geo.apiKey, ipApiComKey: config.geo.ipApiComKey, dailyLimit: config.geo.dailyLimit, storePostal: config.geo.storePostal, salt: config.geo.ipSalt, store: G.dbStore(db), ...extra });
}
function get() {
  if (instance) return instance;
  instance = build();
  if (config.geo.dbPath && !opening) opening = openMaxmind().then((reader) => { if (reader) instance = build({ maxmind: reader }); });
  return instance;
}
/** For tests: replace or reset the shared instance. */
function set(next) { instance = next; }

const COLUMNS = ['ip_hash', 'ip_version', 'geo_status', 'geo_source', 'geo_precision', 'geo_looked_up_at', 'geo_city', 'geo_region', 'geo_region_code', 'geo_country_code', 'geo_country',
  'geo_lat', 'geo_lon', 'geo_timezone', 'geo_utc_offset', 'geo_calling_code', 'geo_asn', 'geo_org', 'geo_in_eu', 'phone_country_mismatch'];   // a fixed whitelist: column names never come from data

/** Look the IP up and write the result onto the lead. Fire and forget: `enrichLead(...).catch(() => {})` is safe. */
async function enrichLead({ leadId, ip, formDialCode }) {
  try {
    const geo = get();
    if (!geo.enabled || !leadId) return null;
    const res = await geo.lookup(ip);
    const cols = G.leadColumns(res, { ip, salt: config.geo.ipSalt, formDialCode });
    const sets = COLUMNS.map((c, i) => `${c}=$${i + 2}`).join(', ');
    await db.query(`UPDATE leads SET ${sets} WHERE id=$1`, [leadId, ...COLUMNS.map((c) => cols[c] ?? null)]);
    return cols.geo_status;
  } catch (e) { log.warn({ err: e.message, leadId }, 'geo enrichment failed; the lead is saved without a location'); return null; }
}

/** Visitor location (only when GEO_VISITORS is on): one lookup per new visitor, written onto the visitor row. Never throws. */
async function enrichVisitor({ visitorId, ip }) {
  try {
    const geo = get();
    if (!geo.enabled || !visitorId) return null;
    const res = await geo.lookup(ip), d = res.data || {};
    await db.query('UPDATE visitors SET geo_status=$2, geo_country_code=$3, geo_region=$4, geo_city=$5, geo_lat=$6, geo_lon=$7 WHERE visitor_id=$1',
      [visitorId, res.status, d.geo_country_code || null, d.geo_region || null, d.geo_city || null, d.geo_lat ?? null, d.geo_lon ?? null]);
    return res.status;
  } catch (e) { log.warn({ err: e.message }, 'visitor geo enrichment failed'); return null; }
}

module.exports = { get, set, enrichLead, enrichVisitor, COLUMNS };
