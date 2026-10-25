// Where people come from: turns a list of located rows into the counts the insights map and its
// side lists need (countries, states/regions, cities). Pure functions, no database, no I/O.
//
// Every item is { code, country, region, city, lat, lon }:
//   code    ISO country code (IN, AE, ...) when the lookup produced one
//   country full country name, when the lookup produced one (preferred over the code)
//   region  state / province, city  city name; lat / lon the point to place on the map.
// A row without usable coordinates still counts in `unknown` but never appears on the map.

const MAX = 200;                                      // never hand the browser an unbounded list

/** ISO 3166-1 alpha-2 -> English name, only for the countries this form's phone list can produce. */
const COUNTRY_NAMES = {
  IN: 'India', AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', KW: 'Kuwait', OM: 'Oman',
  BH: 'Bahrain', US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', SG: 'Singapore'
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A point is usable when both coordinates are real numbers inside the valid ranges. */
function point(lat, lon) {
  const a = num(lat), o = num(lon);
  if (a == null || o == null) return null;
  if (Math.abs(a) > 90 || Math.abs(o) > 180) return null;      // out of range = a bad lookup, not a place
  return { lat: a, lon: o };
}

/** Sorted { name, n } list from a name -> count map, biggest first, ties alphabetical, capped at `max`. */
function rank(map, max) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([name, n]) => ({ name, n }));
}

/**
 * Aggregate located rows.
 * @returns {{ countries: Array, regions: Array, cities: Array, located: number, points: Array }}
 *   countries / regions / cities are ranked lists for the side panels;
 *   located is how many rows had a usable point; points is the raw { lat, lon, ... } list for the map itself.
 */
function aggregateGeo(items) {
  const countries = new Map(), regions = new Map(), cities = new Map();
  const points = [];
  let located = 0;

  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || typeof raw !== 'object') continue;
    const p = point(raw.lat, raw.lon);
    const country = text(raw.country) || COUNTRY_NAMES[text(raw.code)] || text(raw.code);
    const region = text(raw.region);
    const city = text(raw.city);

    // a row counts as located when it has a city, a region, a country, or a point — any of those can be shown
    if (!p && !country && !region && !city) continue;
    located++;

    if (country) countries.set(country, (countries.get(country) || 0) + 1);
    if (region && country) {
      const key = region + '\u0000' + country;
      const prev = regions.get(key);
      if (prev) prev.n++;
      else regions.set(key, { key, name: region, country, n: 1 });
    }
    if (city) {
      const key = city + '\u0000' + (region || '') + '\u0000' + (country || '');
      const prev = cities.get(key);
      if (prev) prev.n++;
      else cities.set(key, { key, name: city, region, country, n: 1 });
    }
    if (p) points.push({ lat: p.lat, lon: p.lon, name: city || region || country || '', region, country });
  }

  const byCount = (list) => [...list.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, MAX);
  return {
    countries: rank(countries, MAX),
    regions: byCount(regions).map(({ name, country, n }) => ({ name, country, n })),
    cities: byCount(cities).map(({ name, region, country, n }) => ({ name, region, country, n })),
    located,
    points
  };
}

/** Same aggregation under the older `aggregate` name (used by the funnel / people counts). */
function aggregate(items) {
  return aggregateGeo(items);
}

module.exports = { aggregate, aggregateGeo, COUNTRY_NAMES };
