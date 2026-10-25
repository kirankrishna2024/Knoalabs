// Every admin page must load the scripts its own code depends on. This is the check that was missing when the Leads page
// crashed with "Cannot read properties of undefined (reading 'mount')". It also checks that the master class links block is
// gone from the Leads and Live analytics pages, and that the Find a link box still drives the normal filters.
// Run: node test/pages.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const strip = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
let n = 0; const ok = (m) => console.log(`  ✓ P${++n}. ${m}`);

/* what each script provides (window.X = ...) and what it needs (window.X.something) */
const PROVIDES = {
  'admin/assets/builder.js': ['KnoaBuilder'], 'admin/assets/qr.js': ['KnoaQR'],
  'admin/assets/kit.js': ['KnoaUI'], 'admin/assets/vendor/qrcode.js': ['qrcode']
};
const NEEDS = { KnoaBuilder: /window\.KnoaBuilder\b/, KnoaQR: /window\.KnoaQR\b/, KnoaUI: /window\.KnoaUI\b/, qrcode: /window\.qrcode\b/ };

for (const page of ['dashboard', 'analytics', 'forms', 'campaigns', 'qr', 'studio']) {
  const file = page === 'studio' ? 'studio.html' : `${page}.html`;
  const html = read(`admin/views/${file}`);
  const srcs = [...html.matchAll(/<script src="\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert(srcs.length, page + ' loads scripts');
  const have = new Set();
  for (const s of srcs) {
    assert(fs.existsSync(path.join(root, s)), `${page}: ${s} must exist on the server`);
    const code = strip(read(s));
    for (const [name, re] of Object.entries(NEEDS)) {
      if (!re.test(code) || (PROVIDES[s] || []).includes(name)) continue;
      assert(srcs.some((x) => (PROVIDES[x] || []).includes(name)), `${page}: ${s} uses ${name} but the page never loads the script that provides it`);
    }
    for (const x of PROVIDES[s] || []) have.add(x);
  }
  ok(`${page} page: every script its code depends on is loaded (${srcs.map((s) => s.split('/').pop()).join(', ')})`);
}

/* the master class links block is gone from the two analytics dashboards, along with the builder / QR scripts it loaded */
const dash = read('admin/views/dashboard.html'), ana = read('admin/views/analytics.html');
for (const [name, html] of [['Leads', dash], ['Live analytics', ana]]) {
  assert(!html.includes('linksMount'), name + ': the master class links block is gone');
  assert(!/admin\/assets\/(links|builder|qr)\.js/.test(html) && !html.includes('vendor/qrcode.js'), name + ': no builder / QR scripts');
}
assert(dash.includes('/admin/assets/kit.js') && dash.includes('/admin/assets/dashboard.js'));
ok('Leads and Live analytics no longer show one link per master class and load only the shared UI kit (no builder, QR or links.js)');

/* everything else still loads the kit before its own script */
for (const page of ['forms', 'campaigns', 'qr', 'studio']) {
  const html = read(`admin/views/${page}.html`);
  assert(html.includes('/admin/assets/kit.js'), page + ' loads kit.js');
}
ok('Form Studio, Campaigns, QR generator and the studio load the shared kit (confirm, copy, toast)');

/* ad link builder (still used by the QR generator and the studio Links dialog): the link, copy and QR download only */
const b = read('admin/assets/builder.js'), studio = read('admin/assets/studio.js'), css = read('admin/assets/links.css');
for (const gone of ['Website URL (no tags)', 'URL parameters', 'Ads Manager', '{{site_source_name}}', '{{placement}}', 'meta-box', 'metaParams']) assert(!b.replace(/\/\*[\s\S]*?\*\//g, '').includes(gone) && !studio.includes(gone) && !css.includes(gone), 'removed: ' + gone);
assert(studio.includes("'Copy link'") && studio.includes('KnoaQR.open'));
ok('the ad link builder shows only the link with Copy link and a QR code (no Meta Ads Manager paste-boxes)');


/* Meta Pixel + optional exact location on the registration page */
const regHtml = read('public/register.html'), pixel = read('public/pixel.js'), regJs = read('public/register.js');
assert(regHtml.includes('src="/pixel.js"') && regHtml.includes('facebook.com/tr?id=') && pixel.includes('connect.facebook.net/en_US/fbevents.js') && regJs.includes("fbq('track', 'Lead')") && regJs.includes('knoa_geo'));
// the pixel is the manager's snippet: init + PageView in /pixel.js, loaded from <head>; no admin setting, no id sent from register.js
assert(pixel.includes("fbq('init', '2822992388094391')") && pixel.includes("fbq('track', 'PageView')") && /<head>[\s\S]*src="\/pixel\.js"[\s\S]*<\/head>/.test(regHtml));
assert(!regJs.includes('meta_pixel_id') && !regJs.includes("fbq('init'") && !read('admin/views/dashboard.html').includes('metaPixelId') && !read('admin/views/dashboard.html').includes('Ad tracking') && !read('admin/assets/dashboard.js').includes('metaPixelId') && !read('src/admin.js').includes('meta_pixel_id') && !read('server.js').includes('meta_pixel_id'));
assert(regJs.includes('navigator.permissions.query') && regJs.includes('getCurrentPosition') && regJs.includes('knoa_geo') && regJs.includes('geo: geoBody()') && regJs.includes("fbq('track', 'Lead')"));
assert(/connect\.facebook\.net/.test(read('server.js')) && /www\.facebook\.com/.test(read('server.js')));
ok('registration page carries the Meta Pixel (PageView + Lead) and asks for exact location only when the browser allows it');
// /config.js is generated at runtime (server.js), so the static public/config.js does not exist on disk.

/* Find a link: a pasted link selects the normal filters, no separate details card */
const a = read('admin/assets/analytics.js'), ah = read('admin/views/analytics.html'), ac = read('admin/assets/analytics.css');
assert(!ah.includes('linkDetail') && !a.includes('renderLinkDetail') && !a.includes('linkInfo') && !ac.includes('.lf-detail') && !ac.includes('.lf-stat')); ok('Find a link: the separate "Link details" card is gone');
const apply = a.slice(a.indexOf('function lfApply'), a.indexOf('function lfTextSearch'));
for (const k of ['state.course', 'state.channel', 'state.medium', 'state.campaign', 'state.platform', 'changed()']) assert(apply.includes(k), 'lfApply sets ' + k);
ok('Find a link: a pasted link sets master class, campaign, channel and medium in the normal filters and refreshes the page');

console.log(`\nAll ${n} page checks passed`);
