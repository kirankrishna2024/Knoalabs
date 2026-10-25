// Builds admin/assets/vendor/world.json: the country outlines (Natural Earth 50m via the world-atlas package, public domain)
// as one equirectangular SVG path (1000 x 500) used by the analytics map. Run: node scripts/build-world-map.js
const fs = require('fs'), path = require('path');
const topo = require('topojson-client');
const world = require('world-atlas/countries-50m.json');
const W = 1000, H = 500, X = (lon) => ((lon + 180) / 360) * W, Y = (lat) => ((90 - lat) / 180) * H;
const f = (n) => Math.round(n * 10) / 10;   // 0.1 map unit ~ 0.036 degrees
const geo = topo.feature(world, world.objects.countries);
let d = '';
const ring = (r) => r.map((p, i) => (i ? 'L' : 'M') + f(X(p[0])) + ' ' + f(Y(p[1]))).join('') + 'Z';
for (const ft of geo.features) {
  const g = ft.geometry; if (!g) continue;
  for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const r of poly) {
    // the antimeridian: skip rings that jump across the whole map (Russia / Fiji in 110m data are split already)
    if (r.some((p, i) => i && Math.abs(p[0] - r[i - 1][0]) > 180)) continue;
    d += ring(r);
  }
}
// every country border as one path (shared borders drawn once), for the thin dark lines between countries
let b = '';
const mesh = topo.mesh(world, world.objects.countries, (x, y) => x !== y);
for (const line of mesh.coordinates) { if (line.some((p, i) => i && Math.abs(p[0] - line[i - 1][0]) > 180)) continue; b += line.map((p, i) => (i ? 'L' : 'M') + f(X(p[0])) + ' ' + f(Y(p[1]))).join(''); }
const out = { w: W, h: H, d, b };
fs.writeFileSync(path.join(__dirname, '..', 'admin', 'assets', 'vendor', 'world.json'), JSON.stringify(out));
console.log('world.json', JSON.stringify(out).length, 'bytes');
