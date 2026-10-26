// Open the analytics page in real Chrome and report what "Traffic sources detected"
// and "How the source was found" actually render, plus console errors.
const puppeteer = require('puppeteer-core');
const BASE = 'http://127.0.0.1:4600';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 300)));
  page.on('requestfailed', (r) => logs.push('reqfail: ' + r.url().slice(0, 160) + ' ' + (r.failure() || {}).errorText));
  page.on('response', (r) => { if (r.status() >= 400) logs.push('http ' + r.status() + ': ' + r.url().slice(0, 160)); });

  // sign in
  await page.goto(BASE + '/admin/login', { waitUntil: 'networkidle2' });
  await page.type('#u', process.env.AU || 'admin');
  await page.type('#p', process.env.AP || 'Admin!secret993329');
  await page.click('#loginBtn');
  await page.waitForFunction(() => location.pathname.indexOf('/admin/login') === -1, { timeout: 15000 }).catch(() => logs.push('login did not navigate away'));

  await page.goto(BASE + '/admin/analytics?days=14', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#detGrid .src-tile', { timeout: 15000 }).catch(() => logs.push('NO .src-tile appeared within 15s'));
  await sleep(2500);

  const report = await page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 700) : null);
    const grid = document.getElementById('detGrid');
    const meth = document.getElementById('detMethods');
    const hosts = document.getElementById('detHosts');
    const card = document.getElementById('detCard');
    return {
      live: txt(document.getElementById('liveText')),
      gridTiles: grid ? grid.querySelectorAll('.src-tile').length : -1,
      gridHTMLlen: grid ? grid.innerHTML.length : -1,
      gridText: txt(grid),
      gridRect: grid ? JSON.stringify(grid.getBoundingClientRect()) : null,
      cardRect: card ? JSON.stringify(card.getBoundingClientRect()) : null,
      methodsText: txt(meth),
      methodsRect: meth ? JSON.stringify(meth.getBoundingClientRect()) : null,
      hostsText: txt(hosts),
      firstTileStyle: grid && grid.firstElementChild ? getComputedStyle(grid.firstElementChild).display + '/' + getComputedStyle(grid.firstElementChild).visibility + '/' + getComputedStyle(grid.firstElementChild).opacity : null,
      tileButtons: [...(grid ? grid.querySelectorAll('button.src-tile') : [])].map((b) => b.textContent.replace(/\s+/g, ' ').trim())
    };
  });
  console.log('LIVE:', report.live);
  console.log('tiles:', report.gridTiles, 'htmlLen:', report.gridHTMLlen, 'style:', report.firstTileStyle);
  console.log('GRID TEXT:', report.gridText);
  console.log('GRID RECT:', report.gridRect);
  console.log('CARD RECT:', report.cardRect);
  console.log('METHODS TEXT:', report.methodsText);
  console.log('METHODS RECT:', report.methodsRect);
  console.log('HOSTS TEXT:', report.hostsText);
  console.log('TILE LABELS:', JSON.stringify(report.tileButtons, null, 0));

  // click the first tile with data and see whether the page filters
  const clicked = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#detGrid .src-tile')].find((b) => !/\bzero\b/.test(b.className));
    if (!t) return null;
    t.click();
    return t.textContent.replace(/\s+/g, ' ').trim();
  });
  await sleep(2500);
  const after = await page.evaluate(() => ({
    crumbs: (document.getElementById('crumbs') || {}).textContent,
    url: location.search,
    grid: (document.getElementById('detGrid') || {}).textContent
  }));
  console.log('CLICKED:', clicked);
  console.log('AFTER CRUMBS:', after.crumbs, '| URL:', after.url);
  console.log('AFTER GRID:', (after.grid || '').replace(/\s+/g, ' ').slice(0, 400));

  const card = await page.$('#detCard');
  if (card) await card.screenshot({ path: 'scripts/_detcard.png' });
  console.log('CONSOLE/NETWORK ISSUES:', JSON.stringify(logs.slice(0, 30), null, 1));
  await browser.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
