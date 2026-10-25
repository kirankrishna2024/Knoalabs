// Builds admin/assets/vendor/states.json: state / province outlines for the analytics map, drawn on top of the country map
// (same 1000 x 500 equirectangular space as world.json, so the dots line up).
// Source: Natural Earth 10m admin-1 (public domain). Download once, then run:
//   curl -L -o ne_admin1.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
//   node scripts/build-states-map.js ne_admin1.geojson
const fs = require('fs'), path = require('path');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('Usage: node scripts/build-states-map.js <ne_10m_admin_1_states_provinces.geojson>'); process.exit(1); }

const W = 1000, H = 500, X = (lon) => ((lon + 180) / 360) * W, Y = (lat) => ((90 - lat) / 180) * H;
// the countries the registration form can produce (see src/countries.js); the United Kingdom is left at country level (232 districts)
const KEEP = null;                                  // every country that has admin-1 data (the whole world)
const TOL = { IN: 0.04, CN: 0.14, RU: 0.2, CA: 0.2, US: 0.14, BR: 0.14, AU: 0.14, SA: 0.12 }, DEFAULT_TOL = 0.09;   // simplification in map units (1 unit = 0.36 degrees): India is drawn finer because the map zooms into it
const MIN_AREA = { IN: 0.004, CA: 0.1, US: 0.04, RU: 0.1 }, DEFAULT_MIN_AREA = 0.012;

// names an IP lookup may return that differ from the Natural Earth name (all compared after norm())
const ALIASES = {
  IN: { Odisha: ['Orissa'], Uttarakhand: ['Uttaranchal'], Puducherry: ['Pondicherry'], Telangana: ['Telengana'], Delhi: ['NCT', 'NCT of Delhi', 'National Capital Territory of Delhi', 'New Delhi'],
    'Andaman and Nicobar': ['Andaman and Nicobar Islands', 'Andaman & Nicobar Islands', 'Andaman Nicobar'], 'Jammu and Kashmir': ['Jammu & Kashmir', 'J&K'],
    'Dadra and Nagar Haveli and Daman and Diu': ['Dadra and Nagar Haveli', 'Daman and Diu', 'Dadra & Nagar Haveli', 'Daman & Diu'], Chhattisgarh: ['Chattisgarh'], 'West Bengal': ['Paschim Banga'] },
  AE: { Dubay: ['Dubai', 'Dubayy'], 'Abu Dhabi': ['Abu Zaby', 'Abu Dhabi Emirate'], 'Ras Al Khaymah': ['Ras Al Khaimah'], 'Umm Al Qaywayn': ['Umm Al Quwain'], Fujayrah: ['Fujairah'], Sharjah: ['Ash Shariqah'] },
  SA: {}, QA: { 'Ad Dawhah': ['Doha', 'Ad Dawhah'] }, KW: {}, OM: { Muscat: ['Masqat'] }, BH: {}, US: {}, CA: {}, AU: {}, SG: {}
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function dp(pts, tol) {                         // Douglas-Peucker (iterative), keeps the first and last point
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]; let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0; t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = Math.sqrt(ex * ex + ey * ey);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };
const f = (n) => String(Math.round(n * 100) / 100);

const geo = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = { w: W, h: H, c: {}, m: {} }, cent = {};
let bytes = 0;
for (const ft of geo.features) {
  const p = ft.properties || {}, cc = p.iso_a2; if (!/^[A-Z]{2}$/.test(cc || '') || (KEEP && !KEEP.includes(cc)) || !ft.geometry) continue;
  if (/^~|X\d/.test(String(p.iso_3166_2 || '').split('-')[1] || '') || p.name === 'Neutral Zone') continue;   // disputed neutral zones are not places people live
  const g = ft.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates, tol = TOL[cc] || DEFAULT_TOL, minA = MIN_AREA[cc] || DEFAULT_MIN_AREA;
  let d = '', best = null;
  for (const poly of polys) for (let k = 0; k < poly.length; k++) {
    let r = poly[k].map(([lon, lat]) => [X(lon), Y(lat)]);
    if (poly[k].some((q, i) => i && Math.abs(q[0] - poly[k][i - 1][0]) > 180)) continue;   // rings that jump across the antimeridian
    const a = area(r); if (!best || a > best.a) best = { a, r };
    if (k > 0 ? a < minA / 2 : a < minA) continue;                                           // drop specks (keep every state's biggest ring below)
    r = dp(r, tol); if (r.length < 3) continue;
    d += r.map((q, i) => (i ? 'L' : 'M') + f(q[0]) + ' ' + f(q[1])).join('') + 'Z';
  }
  if (!d && best) d = dp(best.r, tol).map((q, i) => (i ? 'L' : 'M') + f(q[0]) + ' ' + f(q[1])).join('') + 'Z';
  if (!d) continue;
  const name = p.name_en || p.name, code = String(p.iso_3166_2 || '').split('-')[1] || '';
  const alias = [...((ALIASES[cc] || {})[p.name] || (ALIASES[cc] || {})[name] || []), ...String(p.name_alt || '').split('|'), p.name, p.woe_name, p.name_local, p.gn_name, p.abbrev, p.postal].filter(Boolean).map(norm).filter((v, i, a) => v && v !== norm(name) && a.indexOf(v) === i);
  const bb = best ? best.r.reduce((o, q) => ({ x0: Math.min(o.x0, q[0]), x1: Math.max(o.x1, q[0]), y0: Math.min(o.y0, q[1]), y1: Math.max(o.y1, q[1]) }), { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }) : null;
  const cx = bb ? f((bb.x0 + bb.x1) / 2) : null, cy = bb ? f((bb.y0 + bb.y1) / 2) : null;       // where an area-only dot (no city known) is drawn
  (out.c[cc] = out.c[cc] || []).push({ n: name, k: norm(name), c: code, a: alias, d, x: Number(cx), y: Number(cy) });
  if (best && (!cent[cc] || best.a > cent[cc].a)) cent[cc] = { a: best.a, x: Number(cx), y: Number(cy) };
  bytes += d.length;
}
for (const cc of Object.keys(cent)) out.m[cc] = [cent[cc].x, cent[cc].y];
for (const cc of Object.keys(out.c)) out.c[cc].sort((a, b) => a.n.localeCompare(b.n));
const file = path.join(__dirname, '..', 'admin', 'assets', 'vendor', 'states.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log('states.json', fs.statSync(file).size, 'bytes;', Object.entries(out.c).map(([k, v]) => k + ':' + v.length).join(' '));
