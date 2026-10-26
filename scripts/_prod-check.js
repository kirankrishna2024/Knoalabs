// Inspect the LIVE analytics API using the admin credentials stored in .env.
// The credentials are read from the file and never printed.
const fs = require('fs');
const BASE = process.env.PROD || 'https://knoalabsmasterclass-fgsgb.ondigitalocean.app';

const env = {};
fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((l) => {
  const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) env[l.slice(0, i)] = l.slice(i + 1);
});
const user = env.ADMIN_USERNAME, pass = env.ADMIN_PASSWORD;

(async () => {
  const lr = await fetch(BASE + '/admin/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass })
  });
  const login = await lr.json().catch(() => ({}));
  if (!login.ok) { console.log('LOGIN FAILED status=' + lr.status + ' error=' + (login.error || '?')); process.exit(2); }
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
  console.log('logged in as the configured admin account');

  const r = await fetch(BASE + '/admin/api/analytics?days=14', { headers: { Cookie: cookie, Accept: 'application/json' } });
  console.log('GET /admin/api/analytics -> ' + r.status);
  const d = await r.json().catch((e) => { console.log('NOT JSON: ' + e.message); return null; });
  if (!d) process.exit(1);
  console.log('keys:', Object.keys(d).join(', '));
  console.log('ok:', d.ok, 'error:', d.error);
  console.log('has detected:', 'detected' in d, typeof d.detected);
  if (d.detected) {
    console.log('detected keys:', Object.keys(d.detected).join(', '));
    console.log('items:', JSON.stringify((d.detected.items || []).map((x) => [x.name, x.n, x.opens])));
    console.log('methods:', JSON.stringify(d.detected.methods));
    console.log('hosts:', JSON.stringify((d.detected.hosts || []).map((h) => h.name)));
  }
  console.log('visitors:', JSON.stringify(d.visitors && { available: d.visitors.available, total: d.visitors.total }));
  console.log('window:', JSON.stringify(d.window), 'totals.window:', d.totals && d.totals.window);
  console.log('campaigns:', JSON.stringify((d.campaigns || []).map((c) => c.name)));
  console.log('courses:', JSON.stringify((d.courses || []).map((c) => c.slug)));
  console.log('recent sample:', JSON.stringify((d.recent || []).slice(0, 2)));
  console.log('adTable:', JSON.stringify((d.adTable || []).slice(0, 3)));
  console.log('meta:', JSON.stringify(d.meta && { total: d.meta.total, platforms: d.meta.platforms && d.meta.platforms.length, placements: d.meta.placements && d.meta.placements.length }));
  console.log('tree:', JSON.stringify((d.tree || []).map((t) => [t.course, t.n])));
  console.log('campaignTable:', JSON.stringify((d.campaignTable || []).slice(0, 3).map((c) => [c.campaign, c.n])));
  fs.writeFileSync('_prod_an.json', JSON.stringify(d));

  const lr2 = await fetch(BASE + '/admin/api/analytics/leads?kind=registered&pageSize=25&page=1', { headers: { Cookie: cookie, Accept: 'application/json' } });
  const leads = await lr2.json().catch(() => null);
  console.log('GET leads -> ' + lr2.status, leads && Object.keys(leads).join(','));
  if (leads) console.log('leads ok:', leads.ok, 'error:', leads.error, 'total:', leads.total, 'rows:', (leads.rows || []).length, 'counts:', JSON.stringify(leads.counts));
  fs.writeFileSync('_prod_leads.json', JSON.stringify(leads));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });