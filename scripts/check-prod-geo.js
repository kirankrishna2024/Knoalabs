const { createGeo } = require('../src/geo');
(async () => {
  const g = createGeo({ provider: 'ipapi', fetch: globalThis.fetch, salt: 't' });
  const r = await g.lookup('8.8.8.8');
  console.log(JSON.stringify({ status: r.status, source: r.source, data: r.data }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
