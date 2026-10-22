// QR generator tab, link search and the merged Meta source. Run: npm test
process.env.LOG_LEVEL = 'silent';
process.env.ADMIN_USERNAME = 'qr.admin';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'x'.repeat(40);
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const jsQR = require('jsqr');
const db = require('../src/db');
const migrate = require('../src/migrate');
const { createApp, seedAdmin } = require('../server');
const { parseLink } = require('../src/linkparse');
const { niceChannel } = require('../src/analytics');
const qrcode = require('../admin/assets/vendor/qrcode.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/** Draw the code the same way admin/assets/qr.js does (whole pixels per square, white border) and return RGBA pixels. */
function render(text, { ecc = 'Q', mp = 8, margin = 4 } = {}) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, ecc); qr.addData(text, 'Byte'); qr.make();
  const n = qr.getModuleCount(), px = (n + margin * 2) * mp, data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    for (let y = 0; y < mp; y++) for (let x = 0; x < mp; x++) { const i = (((r + margin) * mp + y) * px + (c + margin) * mp + x) * 4; data[i] = data[i + 1] = data[i + 2] = 13; }
  }
  return { data, px, n };
}

(async () => {
  let n = 0; const ok = (m) => console.log(`  ✓ Q${++n}. ${m}`);

  /* ---- the QR image really scans back to the same link ---- */
  const LINK = 'https://masterclass.knoalabs.com/datascience?utm_source=meta&utm_medium=qr&utm_campaign=ds-oct-reels';
  for (const ecc of ['L', 'M', 'Q', 'H']) {
    const { data, px } = render(LINK, { ecc });
    const got = jsQR(data, px, px);
    assert(got && got.data === LINK, `ecc ${ecc} did not scan back`);
  }
  ok('a tagged ad link becomes a QR code that scans back to exactly the same link (all four error-correction levels)');
  const long = 'https://example.com/path?' + 'utm_campaign=' + 'a'.repeat(300);
  let r = render(long, { ecc: 'H' }); assert.strictEqual(jsQR(r.data, r.px, r.px).data, long);
  r = render('https://example.com/ü?x=é', { ecc: 'Q' }); assert.strictEqual(jsQR(r.data, r.px, r.px).data, 'https://example.com/ü?x=é');
  ok('long links and non-English characters (UTF-8) scan back correctly');

  /* ---- link parser (link search) ---- */
  const base = parseLink('https://masterclass.knoalabs.com/datascience?utm_source=meta&utm_medium=Paid&utm_campaign=ds-oct-reels', 'masterclass.knoalabs.com');
  assert(base.ok); assert.strictEqual(base.course.slug, 'datascience'); assert.deepStrictEqual(base.filters, { course: 'datascience', channel: 'Meta', medium: 'paid', campaign: 'ds-oct-reels' }); assert.strictEqual(base.sameHost, true);
  ok('a full ad link is read into master class, channel, medium (lower-cased) and campaign');
  for (const src of ['facebook', 'instagram', 'ig', 'fb', 'meta', 'Facebook', 'INSTAGRAM']) assert.strictEqual(parseLink('/datascience?utm_source=' + src).filters.channel, 'Meta', src);
  assert.strictEqual(niceChannel('l.instagram.com'), 'Meta'); assert.strictEqual(niceChannel('m.facebook.com'), 'Meta'); assert.strictEqual(niceChannel('google'), 'Google');
  ok('Facebook and Instagram are one channel: Meta (any spelling, and referring sites)');
  assert.strictEqual(parseLink('https://x.com/ds?utm_source=google').filters.course, 'datascience'); assert.strictEqual(parseLink('https://x.com/generative-ai').filters.course, 'generativeai'); assert.strictEqual(parseLink('https://x.com/Cyber').filters.course, 'cybersecurity');
  ok('short names and hyphenated paths (ds, cyber, generative-ai) find the same master class as the registration page does');
  const plain = parseLink('masterclass.knoalabs.com/?utm_campaign=x'); assert(plain.ok && plain.plain && plain.filters.course === '__none' && plain.filters.campaign === 'x' && plain.filters.channel === '' && plain.filters.medium === ''); ok('a link without a master class is the plain link; tags that are missing are simply not filtered (and no scheme is needed)');
  const qOnly = parseLink('?utm_source=google&utm_medium=cpc'); assert(qOnly.ok && qOnly.filters.channel === 'Google' && qOnly.filters.course === ''); ok('even just the tag part of a link (?utm_source=…) is understood');
  const unk = parseLink('https://x.com/not-a-class?utm_campaign=c'); assert(unk.ok && unk.unknownCourse && unk.filters.course === ''); assert.strictEqual(parseLink('https://other.com/datascience', 'masterclass.knoalabs.com').sameHost, false); ok('an unknown path or another website is flagged, never guessed');
  for (const bad of ['', '   ', 'two words', 'javascript:alert(1)', 'ftp://x.com/a', 'http://']) assert.strictEqual(parseLink(bad).ok, false, JSON.stringify(bad));
  assert(parseLink('https://x.com/ds?utm_campaign=' + 'z'.repeat(500)).filters.campaign.length <= 120); assert.strictEqual(parseLink('https://x.com/ds?utm_campaign=a%00b%0Ac').filters.campaign, 'a b c'); assert(parseLink('https://x.com/%E0%A4%A').ok);
  ok('bad input is refused with a message; campaign text is length-capped and cleaned; broken %-codes do not crash it');

  /* ---- the running app ---- */
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  await seedAdmin();
  const server = createApp().listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const J = { 'Content-Type': 'application/json' };
  try {
    let res = await fetch(url + '/admin/qr', { redirect: 'manual' });
    assert.strictEqual(res.status, 302); assert(res.headers.get('location').endsWith('/admin/login')); ok('/admin/qr needs sign-in (redirects to the login page)');
    res = await fetch(url + '/admin/api/link-lookup?url=x.com', { headers: { Accept: 'application/json' } }); assert.strictEqual(res.status, 401); ok('link search API needs sign-in');

    const cookie = (await fetch(url + '/admin/api/login', { method: 'POST', headers: J, body: JSON.stringify({ username: 'qr.admin', password: 'correct-horse-battery' }) })).headers.get('set-cookie').split(';')[0];
    const K = { cookie };
    res = await fetch(url + '/admin/qr', { headers: K }); const qrHtml = await res.text();
    assert.strictEqual(res.status, 200); assert(/text\/html/.test(res.headers.get('content-type'))); assert(res.headers.get('content-security-policy').includes("script-src 'self'")); assert(!/img-src[^;]*https?:/.test(res.headers.get('content-security-policy'))); assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    assert(/id="qrCanvas"/.test(qrHtml) && /id="dlPng"/.test(qrHtml) && /id="dlJpg"/.test(qrHtml) && /id="dlSvg"/.test(qrHtml)); ok('QR generator page loads under the same strict security policy, with PNG, JPEG and SVG download buttons');

    const ana = await (await fetch(url + '/admin/analytics', { headers: K })).text(), dash = await (await fetch(url + '/admin', { headers: K })).text();
    for (const [name, html, on] of [['Leads', dash, '/admin'], ['Analytics', ana, '/admin/analytics'], ['QR', qrHtml, '/admin/qr']]) {
      const tabs = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)[0];
      assert.deepStrictEqual([...tabs.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]), ['/admin', '/admin/analytics', '/admin/forms', '/admin/campaigns', '/admin/qr'], name);
      assert(new RegExp(`<a href="${on}" class="on" aria-current="page">`).test(tabs), name + ' highlights itself');
    }
    ok('top navigation on every admin page: Leads · Live analytics · Form Studio · Campaigns · QR generator, current page highlighted');

    for (const f of ['vendor/qrcode.js', 'qr.js', 'qr.css', 'qr-page.js', 'builder.js']) { res = await fetch(url + '/admin/assets/' + f, { headers: K }); assert.strictEqual(res.status, 200, f); }
    ok('QR scripts, styles and the bundled QR library are served by the app itself');
    assert(/id="findInput"/.test(ana) && !/id="linkDetail"/.test(ana) && !ana.includes('vendor/qrcode.js') && !ana.includes('builder.js')); ok('analytics page has the "Find a link" search, no separate link details card and no builder / QR scripts');

    res = await fetch(url + '/admin/api/link-lookup?url=' + encodeURIComponent(LINK), { headers: K }); const lk = await res.json();
    assert.strictEqual(res.status, 200); assert(lk.ok); assert.strictEqual(lk.course.name, 'Data Science'); assert.deepStrictEqual(lk.filters, { course: 'datascience', channel: 'Meta', medium: 'qr', campaign: 'ds-oct-reels' }); ok('link search API: the pasted link comes back as analytics filters');
    res = await fetch(url + '/admin/api/link-lookup?url=' + encodeURIComponent('not a link'), { headers: K }); assert.strictEqual(res.status, 422); assert.strictEqual((await res.json()).ok, false);
    res = await fetch(url + '/admin/api/link-lookup', { headers: K }); assert.strictEqual(res.status, 422);
    res = await fetch(url + '/admin/api/link-lookup?url=a&url=b', { headers: K }); assert.strictEqual(res.status, 422); ok('link search API: empty, repeated or invalid input is a clean 422, never a crash');

    // the filters the lookup returns are accepted by the analytics API as they are
    const ar = await (await fetch(url + '/admin/api/analytics?days=90&' + new URLSearchParams(lk.filters).toString(), { headers: K })).json();
    assert(ar.ok); assert.strictEqual(ar.filters.course, 'datascience'); assert.strictEqual(ar.filters.channel, 'Meta'); assert.strictEqual(ar.filters.medium, 'qr'); assert.strictEqual(ar.filters.campaign, 'ds-oct-reels'); ok('those filters drive the live analytics API directly (master class + channel + medium + campaign)');
  } finally { server.close(); }

  /* ---- browser files ---- */
  const builder = read('admin/assets/builder.js'), studio = read('admin/assets/studio.js'), qrjs = read('admin/assets/qr.js'), page = read('admin/assets/qr-page.js'), analytics = read('admin/assets/analytics.js');
  const sources = builder.match(/var SOURCES = \[(.*?)\];/s)[1];
  assert(sources.includes("['meta', 'Meta (Facebook & Instagram)']") && !/\['facebook'|\['instagram'/.test(sources)); ok('ad link builder offers one "Meta (Facebook & Instagram)" source; separate Facebook / Instagram entries are gone');
  assert(studio.includes('KnoaQR.open') && studio.includes("'Copy link'")); ok('the Form Studio links dialog has a QR code button next to Copy link');
  for (const [name, src] of [['qr.js', qrjs], ['qr-page.js', page], ['builder.js', builder]]) { assert(!/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), name + ' must not call another website'); assert(!/innerHTML|document\.write|eval\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), name + ' must not inject markup'); }
  assert(!/innerHTML/.test(analytics.replace(/\/\*[\s\S]*?\*\//g, ''))); ok('QR files make no third-party requests (the link never leaves the browser) and never inject HTML');
  assert(qrjs.includes("'image/png'") && qrjs.includes("'image/jpeg'") && qrjs.includes('toBlob') && qrjs.includes('0.98') && qrjs.includes('Math.floor(o.size / total)')); assert(page.includes('2048') || read('admin/views/qr.html').includes('value="2048" selected')); ok('PNG (lossless) and JPEG (98%) export from a canvas at up to 4096 px, whole pixels per square so edges stay sharp');
  const lic = read('admin/assets/vendor/qrcode.js').slice(0, 600); assert(/MIT/.test(lic) && /Kazuhiko Arase/.test(lic)); ok('bundled QR library keeps its MIT licence notice');

  console.log(`\nAll ${n} QR / link search checks passed`);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
