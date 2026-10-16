/* Ad analytics: polls /admin/api/analytics every second and redraws only when the numbers changed.
   Everything from the server goes in with textContent / createElementNS (never innerHTML), so lead data can't inject markup. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const NO_COURSE = '__none';
  const COURSE_COLORS = { datascience: '#01c289', cybersecurity: '#0d1211', generativeai: '#2f7de1', [NO_COURSE]: '#98a2a8' };
  const PALETTE = ['#d9962b', '#065f4e', '#e0704a', '#2f7de1', '#c24a4a', '#16a39a', '#7b61c9', '#6aa82b'];
  const CHANNEL_COLORS = ['#01c289', '#0d1211', '#2f7de1', '#d9962b', '#7b61c9', '#e0704a', '#16a39a', '#c24a4a'];
  const DEVICE_COLORS = { Mobile: '#01c289', Desktop: '#0d1211', Tablet: '#2f7de1', Unknown: '#98a2a8' };
  const STATUS_COLORS = { 'Student / Fresher': '#2dd4bf', 'Working Professional': '#818cf8' };
  const DEFAULT_STATUSES = ['Student / Fresher', 'Working Professional'];
  const PRESETS = ['7', '14', '30', '60', '90'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const POLL_MS = 1000;
  const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  const colorFor = (key) => COURSE_COLORS[key] || PALETTE[hash(key) % PALETTE.length];
  window.KnoaColors = colorFor;                                   // the course-link cards use the same colours as the lines

  const state = { status: '', course: '', days: '14', from: '', to: '', mode: 'daily', showTotal: true, showAvg: false, showPrev: false,
    hidden: new Set(), shown: new Set(), hiddenCh: new Set(), paused: false, seq: 0, lastOk: 0, failures: 0, sig: '', data: null, built: false,
    campaign: '', cohort: '', source: '', resCampaign: '', resCohort: '', resSource: '' };
  let timer = null, ctrl = null, prevKpi = {};

  /* ---------- tiny helpers ---------- */
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function sv(tag, attrs) { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }
  const num = (n) => Number(n || 0).toLocaleString('en-IN');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const short = (ymd) => { const p = ymd.split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1]; };
  const long = (ymd) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const hour12 = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM');
  const cumulative = (a) => { let t = 0; return a.map((v) => (t += v)); };
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  function ago(iso) {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }

  /* ---------- URL <-> state (filters survive refresh and can be shared) ---------- */
  function readUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('status')) state.status = q.get('status');
    if (q.get('course')) state.course = q.get('course');
    if (PRESETS.indexOf(q.get('days')) >= 0) state.days = q.get('days');
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('from') || '')) state.from = q.get('from');
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('to') || '')) state.to = q.get('to');
    if (q.get('campaign')) state.campaign = q.get('campaign');
    if (q.get('cohort')) state.cohort = q.get('cohort');
    if (q.get('source')) state.source = q.get('source');
    if (q.get('mode') === 'cumulative') state.mode = 'cumulative';
  }
  function apiQuery() {
    const p = new URLSearchParams();
    if (state.status) p.set('status', state.status);
    if (state.course) p.set('course', state.course);
    if (state.campaign) p.set('campaign', state.campaign);
    if (state.cohort) p.set('cohort', state.cohort);
    if (state.source) p.set('source', state.source);
    if (state.from || state.to) { if (state.from) p.set('from', state.from); if (state.to) p.set('to', state.to); } else p.set('days', state.days);
    return p;
  }
  function writeUrl() {
    const p = apiQuery(); if (state.mode !== 'daily') p.set('mode', state.mode);
    const qs = p.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) { /* ignore */ }
  }

  /* ---------- ad spend (kept in this browser, per period) ---------- */
  const spendKey = () => 'knoa.spend.' + (state.from || state.to ? state.from + '_' + state.to : state.days) + '.' + (state.course || 'all');
  function readSpend() { try { return Number(localStorage.getItem(spendKey())) || 0; } catch (e) { return 0; } }
  function writeSpend(v) { try { if (v > 0) localStorage.setItem(spendKey(), String(v)); else localStorage.removeItem(spendKey()); } catch (e) { /* storage blocked: still works for this visit */ } }

  /* ---------- line chart (glow, gradient area, hover tooltip) ---------- */
  const isOff = (s) => (s.total === 0 && s.autoOff ? !state.shown.has(s.key) : state.hidden.has(s.key));
  function niceStep(max) {
    const raw = Math.max(1, max) / 4, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow, mult = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return Math.max(1, mult * pow);
  }
  function LineChart(svg, wrap, tip, id) {
    let cfg = null, hover = -1, geo = null;
    function draw(next) {
      if (next) cfg = next;
      if (!cfg) return;
      const W = Math.max(280, Math.floor(wrap.clientWidth - 2)), H = wrap.classList.contains('short') ? 230 : 320;
      const pad = { l: 40, r: 16, t: 16, b: 30 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
      const n = cfg.labels.length, vis = cfg.series;
      let max = 1; vis.forEach((s) => s.data.forEach((v) => { if (v > max) max = v; }));
      const step = niceStep(max), top = Math.ceil(max / step) * step;
      const x = (i) => pad.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const y = (v) => pad.t + ph - (v / top) * ph;
      geo = { W, H, pad, pw, ph, n, x, y, vis };
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.textContent = '';
      const defs = sv('defs', {}), glow = sv('filter', { id: id + '-glow', x: '-20%', y: '-20%', width: '140%', height: '140%' });
      glow.appendChild(sv('feGaussianBlur', { stdDeviation: '2.6', result: 'b' }));
      const mg = sv('feMerge', {}); mg.appendChild(sv('feMergeNode', { in: 'b' })); mg.appendChild(sv('feMergeNode', { in: 'SourceGraphic' })); glow.appendChild(mg); defs.appendChild(glow);
      vis.forEach((s, i) => {
        if (s.aux) return;
        const g = sv('linearGradient', { id: id + '-g' + i, x1: 0, y1: 0, x2: 0, y2: 1 });
        g.appendChild(sv('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': vis.filter((v) => !v.aux).length > 3 ? '0.10' : '0.30' }));
        g.appendChild(sv('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': '0' })); defs.appendChild(g);
      });
      svg.appendChild(defs);
      for (let v = 0; v <= top; v += step) {
        svg.appendChild(sv('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: v === 0 ? 'ax' : 'gl' }));
        const t = sv('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tk' }); t.textContent = num(v); svg.appendChild(t);
      }
      const every = Math.max(1, Math.ceil(n / (W < 520 ? 5 : 9)));
      for (let i = 0; i < n; i += every) {
        const t = sv('text', { x: x(i), y: H - 9, 'text-anchor': i === 0 ? 'start' : 'middle', class: 'tk' }); t.textContent = short(cfg.labels[i]); svg.appendChild(t);
      }
      vis.forEach((s, i) => {
        const d = s.data.map((v, k) => (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
        if (!s.aux) svg.appendChild(sv('path', { d: d + ' L' + x(n - 1).toFixed(1) + ' ' + y(0) + ' L' + x(0).toFixed(1) + ' ' + y(0) + ' Z', fill: 'url(#' + id + '-g' + i + ')' }));
        const p = sv('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.aux ? '1.8' : '2.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', filter: s.aux ? 'none' : 'url(#' + id + '-glow)' });
        if (s.dashed) p.setAttribute('stroke-dasharray', '5 4');
        svg.appendChild(p);
        if (!s.aux && n <= 31) s.data.forEach((v, k) => { if (v > 0) svg.appendChild(sv('circle', { cx: x(k), cy: y(v), r: 3, fill: '#ffffff', stroke: s.color, 'stroke-width': '1.8' })); });
      });
      svg.appendChild(sv('g', { class: 'hv' }));
      svg.appendChild(sv('rect', { x: pad.l, y: pad.t, width: pw, height: ph, fill: 'transparent', class: 'hit' }));
      svg.setAttribute('aria-label', (cfg.title || 'Chart') + ': ' + vis.filter((s) => !s.aux).map((s) => s.name + ' ' + (cfg.cumulative ? s.data[s.data.length - 1] : sum(s.data))).join(', '));
      drawHover();
    }
    function drawHover() {
      const g = svg.querySelector('.hv'); if (!g) return; g.textContent = '';
      if (hover < 0 || !geo || hover >= geo.n) { tip.hidden = true; return; }
      const gx = geo.x(hover);
      g.appendChild(sv('line', { x1: gx, x2: gx, y1: geo.pad.t, y2: geo.pad.t + geo.ph, class: 'cursor', 'stroke-dasharray': '3 3' }));
      const rows = geo.vis.map((s) => ({ s: s, v: s.data[hover] })).sort((a, b) => b.v - a.v);
      rows.forEach((r) => g.appendChild(sv('circle', { cx: gx, cy: geo.y(r.v), r: 4.5, fill: r.s.color, stroke: '#ffffff', 'stroke-width': 2 })));
      tip.textContent = '';
      tip.appendChild(el('b', 'tip-d', long(cfg.labels[hover]) + (hover === geo.n - 1 && cfg.partialLast ? ' · today so far' : '')));
      rows.forEach((r) => {
        const row = el('div', 'tip-r'), sw = el('i', 'sw'); sw.style.background = r.s.color;
        row.appendChild(sw); row.appendChild(el('span', 'tip-n', r.s.name)); row.appendChild(el('b', null, num(r.v))); tip.appendChild(row);
      });
      tip.hidden = false;
      const tw = tip.offsetWidth, left = gx + 14 + tw > geo.W ? gx - 14 - tw : gx + 14;
      tip.style.left = Math.max(4, left) + 'px'; tip.style.top = geo.pad.t + 'px';
    }
    function at(ev) {
      if (!geo) return;
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (geo.W / r.width);
      hover = Math.min(geo.n - 1, Math.max(0, Math.round(((px - geo.pad.l) / geo.pw) * (geo.n - 1)))); drawHover();
    }
    svg.addEventListener('pointermove', at); svg.addEventListener('pointerdown', at);
    svg.addEventListener('pointerleave', () => { hover = -1; drawHover(); });
    return { draw: draw };
  }
  const chartCourse = LineChart($('chartCourse'), $('wrapCourse'), $('tipCourse'), 'cc');
  const chartChannel = LineChart($('chartChannel'), $('wrapChannel'), $('tipChannel'), 'ch');
  const chartStatus = LineChart($('chartStatus'), $('wrapStatus'), $('tipStatus'), 'cs');

  const mk = (list, keyOf, nameOf, colorOf, auto) => list.map((s, i) => ({ autoOff: auto, key: keyOf(s), name: nameOf(s), color: colorOf(s, i), dashed: keyOf(s) === NO_COURSE, total: s.total, data: state.mode === 'cumulative' ? cumulative(s.data) : s.data }));

  function legend(host, items, hiddenSet) {
    host.textContent = '';
    items.forEach((s) => {
      const off = hiddenSet ? hiddenSet.has(s.key) : isOff(s), b = el('button', 'legend-item' + (off ? ' off' : ''));
      b.type = 'button'; b.setAttribute('aria-pressed', String(!off));
      const sw = el('i', 'sw'); sw.style.background = s.color; b.appendChild(sw);
      b.appendChild(el('span', 'legend-lab', s.name)); b.appendChild(el('b', null, num(s.total)));
      b.addEventListener('click', () => {
        if (hiddenSet) { if (hiddenSet.has(s.key)) hiddenSet.delete(s.key); else hiddenSet.add(s.key); }
        else if (s.total === 0 && s.autoOff) { if (state.shown.has(s.key)) state.shown.delete(s.key); else state.shown.add(s.key); }
        else if (state.hidden.has(s.key)) state.hidden.delete(s.key); else state.hidden.add(s.key);
        renderCharts();
      });
      host.appendChild(b);
    });
  }

  function renderCharts() {
    const d = state.data; if (!d) return;
    const cum = state.mode === 'cumulative', partialLast = !d.window.custom;
    const all = mk(d.series, (s) => s.key, (s) => s.name, (s) => colorFor(s.key), true);
    legend($('legendCourse'), all);
    const vis = all.filter((s) => !isOff(s));
    const dailyTotal = d.labels.map((_, i) => sum(d.series.filter((s) => !isOff({ key: s.key, total: s.total, autoOff: true })).map((s) => s.data[i])));
    const lines = vis.slice();
    if (state.showTotal && vis.length > 1) lines.unshift({ key: '_t', name: 'Total', color: '#e8f0ff', aux: true, data: cum ? cumulative(dailyTotal) : dailyTotal });
    if (state.showAvg && !cum) lines.push({ key: '_a', name: '7-day average', color: '#d9962b', aux: true, data: dailyTotal.map((_, i) => { const a = dailyTotal.slice(Math.max(0, i - 6), i + 1); return Math.round((sum(a) / a.length) * 100) / 100; }) });
    if (state.showPrev) lines.push({ key: '_p', name: 'Previous period (all)', color: '#94a3b8', aux: true, dashed: true, data: cum ? cumulative(d.previousOverall) : d.previousOverall });
    chartCourse.draw({ labels: d.labels, series: lines, cumulative: cum, title: 'Registrations by master class', partialLast: partialLast });
    $('emptyCourse').hidden = d.totals.window > 0;

    const chs = d.channelSeries.map((s, i) => ({ key: s.name, name: s.name, color: CHANNEL_COLORS[i % CHANNEL_COLORS.length], total: s.total, data: cum ? cumulative(s.data) : s.data }));
    legend($('legendChannel'), chs, state.hiddenCh);
    chartChannel.draw({ labels: d.labels, series: chs.filter((s) => !state.hiddenCh.has(s.key)), cumulative: cum, title: 'Registrations by channel', partialLast: partialLast });
    $('emptyChannel').hidden = chs.length > 0;

    const ss = mk(d.statusSeries, (s) => 's:' + s.status, (s) => s.status, (s) => STATUS_COLORS[s.status] || '#94a3b8');
    legend($('legendStatus'), ss);
    chartStatus.draw({ labels: d.labels, series: ss.filter((s) => !isOff(s)), cumulative: cum, title: 'Registrations by I am a', partialLast: partialLast });
  }

  /* ---------- donut ---------- */
  function donut(svg, list, items, centerLabel) {
    svg.textContent = ''; list.textContent = '';
    const total = sum(items.map((i) => i.n)), cx = 70, cy = 70, r = 54, C = 2 * Math.PI * r;
    svg.appendChild(sv('circle', { cx: cx, cy: cy, r: r, class: 'ring' }));
    let off = 0;
    items.forEach((it) => {
      if (!total || !it.n) return;
      const len = (C * it.n) / total, dash = Math.max(0, len - (items.length > 1 ? 2.5 : 0));
      svg.appendChild(sv('circle', { cx: cx, cy: cy, r: r, class: 'seg-arc', stroke: it.color, 'stroke-dasharray': dash.toFixed(2) + ' ' + (C - dash).toFixed(2), 'stroke-dashoffset': (-off).toFixed(2), transform: 'rotate(-90 ' + cx + ' ' + cy + ')' }));
      off += len;
    });
    const t = sv('text', { x: cx, y: cy + 6 }); t.textContent = num(total); svg.appendChild(t);
    const l = sv('text', { x: cx, y: cy + 22, class: 'sm' }); l.textContent = centerLabel; svg.appendChild(l);
    if (!items.length || !total) { const li = el('li', 'muted', 'No data in this period'); list.appendChild(li); return; }
    items.forEach((it) => {
      const li = el('li'), sw = el('i', 'sw'); sw.style.background = it.color;
      li.appendChild(sw); li.appendChild(el('span', 'nm', it.name)); li.appendChild(el('b', null, num(it.n))); li.appendChild(el('em', null, (it.share != null ? it.share : Math.round((it.n / total) * 1000) / 10) + '%'));
      list.appendChild(li);
    });
  }

  /* ---------- panels ---------- */
  function rank(host, rows, label, empty) {
    host.textContent = '';
    if (!rows.length) { if (empty !== '') host.appendChild(el('div', 'muted small-note', empty || 'No data in this period')); return; }
    const max = Math.max.apply(null, rows.map((r) => r.n)) || 1;
    rows.forEach((r) => {
      const row = el('div', 'rank-row'), t = el('div', 'rank-top'), bar = el('div', 'rank-bar'), fill = el('i');
      t.appendChild(el('span', null, label(r)));
      t.appendChild(el('span', null, num(r.n) + (r.share != null ? '  ·  ' + r.share + '%' : '')));
      fill.style.width = Math.max(3, Math.round((r.n / max) * 100)) + '%';
      bar.appendChild(fill); row.appendChild(t); row.appendChild(bar); host.appendChild(row);
    });
  }
  function head(table, cols) {
    table.tHead.textContent = ''; table.tBodies[0].textContent = '';
    const tr = el('tr'); cols.forEach((c) => tr.appendChild(el('th', c.r ? 'r' : '', c.t))); table.tHead.appendChild(tr);
  }
  function cellBar(n, max) {
    const td = el('td'), w = el('div', 'cellbar'), i = el('i'); i.style.width = Math.max(3, Math.round((n / (max || 1)) * 90)) + 'px';
    w.appendChild(i); w.appendChild(el('b', null, num(n))); td.appendChild(w); return td;
  }
  function renderAdTable(d) {
    const t = $('adTable'), rows = d.adTable;
    $('emptyAd').hidden = rows.length > 0; t.hidden = rows.length === 0;
    if (!rows.length) return;
    head(t, [{ t: 'Channel' }, { t: 'Medium' }, { t: 'Campaign' }, { t: 'Registrations' }, { t: 'Share', r: 1 }, { t: 'Students', r: 1 }, { t: 'Professionals', r: 1 }, { t: 'Top master class' }, { t: 'Last' }]);
    const max = rows[0].n;
    rows.forEach((r) => {
      const tr = el('tr'); tr.appendChild(el('td', 'nm', r.channel));
      const m = el('td'); m.appendChild(el('span', 'pill', r.medium)); tr.appendChild(m);
      tr.appendChild(el('td', r.campaign === '(no campaign)' ? 'muted' : 'nm', r.campaign));
      tr.appendChild(cellBar(r.n, max));
      tr.appendChild(el('td', 'r', r.share + '%')); tr.appendChild(el('td', 'r' + (r.students ? '' : ' zero'), num(r.students))); tr.appendChild(el('td', 'r' + (r.professionals ? '' : ' zero'), num(r.professionals)));
      tr.appendChild(el('td', null, r.topCourse)); const l = el('td', 'nowrap muted', ago(r.lastLeadAt)); l.setAttribute('data-t', r.lastLeadAt); tr.appendChild(l);
      t.tBodies[0].appendChild(tr);
    });
  }
  function renderMatrix(m) {
    const t = $('matrix');
    $('emptyMatrix').hidden = m.rows.length > 0; t.hidden = m.rows.length === 0;
    if (!m.rows.length) return;
    head(t, [{ t: 'Master class' }].concat(m.statuses.map((s) => ({ t: s === 'Student / Fresher' ? 'Students' : s === 'Working Professional' ? 'Professionals' : s, r: 1 })), [{ t: 'Total', r: 1 }]));
    const sums = {}; let all = 0;
    m.rows.forEach((r) => {
      const tr = el('tr'); tr.appendChild(el('td', 'nm', r.course));
      m.statuses.forEach((s) => { tr.appendChild(el('td', 'r', num(r.counts[s]))); sums[s] = (sums[s] || 0) + r.counts[s]; });
      tr.appendChild(el('td', 'r strong', num(r.total))); all += r.total; t.tBodies[0].appendChild(tr);
    });
    const tr = el('tr', 'sum'); tr.appendChild(el('td', 'nm', 'All'));
    m.statuses.forEach((s) => tr.appendChild(el('td', 'r', num(sums[s])))); tr.appendChild(el('td', 'r strong', num(all))); t.tBodies[0].appendChild(tr);
  }
  function renderDayTable(d) {
    const t = $('dayTable'), cs = d.series.filter((s) => s.total > 0), stu = (d.statusSeries.find((s) => s.status === 'Student / Fresher') || { data: [] }).data, pro = (d.statusSeries.find((s) => s.status === 'Working Professional') || { data: [] }).data;
    head(t, [{ t: 'Date' }, { t: 'Total' }].concat(cs.map((s) => ({ t: s.name, r: 1 })), [{ t: 'Students', r: 1 }, { t: 'Professionals', r: 1 }, { t: '7-day avg', r: 1 }, { t: 'vs day before', r: 1 }]));
    const max = Math.max.apply(null, d.overall) || 1;
    for (let i = d.labels.length - 1; i >= 0; i--) {
      const tr = el('tr'), v = d.overall[i], a = d.overall.slice(Math.max(0, i - 6), i + 1);
      tr.appendChild(el('td', 'nm nowrap', long(d.labels[i]) + (i === d.labels.length - 1 && !d.window.custom ? ' · today' : '')));
      tr.appendChild(cellBar(v, max));
      cs.forEach((s) => tr.appendChild(el('td', 'r' + (s.data[i] ? '' : ' zero'), num(s.data[i]))));
      tr.appendChild(el('td', 'r' + (stu[i] ? '' : ' zero'), num(stu[i] || 0))); tr.appendChild(el('td', 'r' + (pro[i] ? '' : ' zero'), num(pro[i] || 0)));
      tr.appendChild(el('td', 'r', (Math.round((sum(a) / a.length) * 10) / 10).toString()));
      let txt = '–', cls = 'r flat';
      if (i > 0) { const diff = v - d.overall[i - 1]; txt = diff > 0 ? '▲ ' + diff : diff < 0 ? '▼ ' + Math.abs(diff) : '= 0'; cls = 'r ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'); }
      tr.appendChild(el('td', cls, txt));
      t.tBodies[0].appendChild(tr);
    }
  }
  function renderHeat(grid) {
    const host = $('heat'); host.textContent = '';
    const flat = []; grid.forEach((row, di) => row.forEach((v, h) => { if (v > 0) flat.push({ di: di, h: h, v: v }); }));
    flat.sort((a, b) => b.v - a.v || a.di - b.di || a.h - b.h);
    const max = flat.length ? flat[0].v : 0, topKeys = new Set(flat.slice(0, 3).map((c) => c.di + ':' + c.h));
    host.appendChild(el('span'));
    for (let h = 0; h < 24; h++) host.appendChild(el('span', 'hh', h % 3 === 0 ? (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'a' : 'p') : ''));
    grid.forEach((row, di) => {
      host.appendChild(el('span', 'hl', DAYS[di]));
      row.forEach((v, h) => {
        const c = el('span', 'hc' + (topKeys.has(di + ':' + h) ? ' top' : ''));
        if (v > 0) { const k = v / max; c.style.background = k < 0.5 ? 'rgba(1,194,137,' + (0.18 + k * 0.9).toFixed(2) + ')' : k < 0.8 ? '#01a876' : '#065f4e'; c.style.opacity = String(0.55 + k * 0.45); }
        c.title = DAYS_LONG[di] + ' ' + hour12(h) + ': ' + v + (v === 1 ? ' registration' : ' registrations');
        host.appendChild(c);
      });
    });
    const slots = $('slots'); slots.textContent = '';
    if (!flat.length) slots.appendChild(el('li', 'none', 'No registrations in this period yet.'));
    flat.slice(0, 3).forEach((c) => { const li = el('li'); li.appendChild(el('span', null, DAYS_LONG[c.di] + ', ' + hour12(c.h) + ' – ' + hour12((c.h + 1) % 24))); li.appendChild(el('em', null, c.v + (c.v === 1 ? ' registration' : ' registrations'))); slots.appendChild(li); });
    rank($('weekdays'), grid.map((row, di) => ({ name: DAYS_LONG[di], n: sum(row) })).sort((a, b) => b.n - a.n), (r) => r.name);
  }
  function renderFeed(list) {
    const host = $('feed'); host.textContent = ''; $('emptyFeed').hidden = list.length > 0;
    list.forEach((r) => {
      const li = el('li'), t = el('span', 'rel', ago(r.created_at)); t.setAttribute('data-t', r.created_at);
      li.appendChild(t); li.appendChild(el('b', null, r.full_name || '—'));
      li.appendChild(el('span', 'tag' + (r.status === 'Working Professional' ? ' pro' : ''), r.status)); li.appendChild(el('span', 'muted', r.course));
      host.appendChild(li);
    });
  }
  function sparkline(d) {
    const s = $('spkWin'); s.textContent = '';
    const v = d.overall, n = v.length, max = Math.max.apply(null, v) || 1;
    const x = (i) => (n === 1 ? 60 : (i / (n - 1)) * 120), y = (k) => 31 - (k / max) * 28;
    const line = v.map((k, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(k).toFixed(1)).join(' ');
    const defs = sv('defs', {}), g = sv('linearGradient', { id: 'spk-g', x1: 0, y1: 0, x2: 0, y2: 1 });
    g.appendChild(sv('stop', { offset: '0%', 'stop-color': '#01c289', 'stop-opacity': '.45' })); g.appendChild(sv('stop', { offset: '100%', 'stop-color': '#01c289', 'stop-opacity': '0' })); defs.appendChild(g); s.appendChild(defs);
    s.appendChild(sv('path', { d: line + ' L120 34 L0 34 Z', fill: 'url(#spk-g)' }));
    s.appendChild(sv('path', { d: line, fill: 'none', stroke: '#01c289', 'stroke-width': '1.8', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
  }

  /* ---------- signals (plain-language findings) ---------- */
  function signal(color, pieces, warn) {
    const s = el('div', 'signal' + (warn ? ' warn' : '')), dot = el('i'); dot.style.setProperty('--sg', color); s.appendChild(dot);
    const p = el('span'); pieces.forEach((t, i) => p.appendChild(i % 2 ? el('b', null, t) : document.createTextNode(t))); s.appendChild(p); return s;
  }
  function renderSignals(d) {
    const host = $('signals'); host.textContent = '';
    if (!d.totals.window) { host.appendChild(signal('#d9962b', ['No registrations in this period. Share a master class link from the panel above, or widen the period.'], true)); return; }
    const t = d.totals;
    if (t.deltaPct != null) host.appendChild(signal(t.deltaPct >= 0 ? '#01a876' : '#d64545', ['Registrations are ', (t.deltaPct >= 0 ? 'up ' : 'down ') + Math.abs(t.deltaPct) + '%', ' compared with the previous ' + d.window.days + ' days (' + num(t.window) + ' vs ' + num(t.previous) + ').']));
    if (d.byCourse[0]) host.appendChild(signal(colorFor(d.byCourse[0].course_slug || NO_COURSE), [d.byCourse[0].course, ' brings the most registrations: ', d.byCourse[0].share + '%', ' of the period.']));
    const real = d.channels.filter((c) => c.name !== 'Direct / no tag');
    if (real[0]) host.appendChild(signal('#01c289', ['Best channel: ', real[0].name, ' with ' + num(real[0].n) + ' registrations (' + real[0].share + '%).']));
    const camp = d.campaigns.find((c) => c.name !== '(no campaign)');
    if (camp) host.appendChild(signal('#0d1211', ['Top campaign: ', camp.name, ' · ' + num(camp.n) + ' registrations.']));
    const direct = d.channels.find((c) => c.name === 'Direct / no tag');
    if (direct && direct.share >= 50) host.appendChild(signal('#d9962b', [direct.share + '%', ' of registrations carry no ad tag, so they cannot be matched to an ad. Use the ', 'Ad link builder', ' for every ad.'], true));
    const flat = []; d.heatmap.forEach((row, di) => row.forEach((v, h) => { if (v > 0) flat.push({ di: di, h: h, v: v }); })); flat.sort((a, b) => b.v - a.v);
    if (flat[0]) host.appendChild(signal('#065f4e', ['Busiest slot: ', DAYS_LONG[flat[0].di] + ' ' + hour12(flat[0].h) + ' – ' + hour12((flat[0].h + 1) % 24), ' (' + flat[0].v + '). Schedule ads just before it.']));
    const mob = d.devices.find((x) => x.name === 'Mobile');
    if (mob && mob.share >= 60) host.appendChild(signal('#01a876', [mob.share + '%', ' register on a phone: keep creatives and the form phone-first.']));
  }

  /* ---------- result panel ---------- */
  const resSeriesKey = (d) => d && d.campaignSeries ? 'c:' + d.campaigns.map((c) => c.name).join(',') + '|' + d.campaigns.map((c) => c.share).join(',') : '';
  let resSeriesCache = null;
  function resSeriesKeyFn(d) { return resSeriesKey(d); }
  function renderResultPanel(d) {
    if (!d) return;
    const $resSignals = $('resSignals'), $resLivePill = $('resLivePill'), $resLiveText = $('resLiveText');
    $resLivePill.setAttribute('data-state', d.totals.window ? 'live' : 'connecting');
    $resLiveText.textContent = d.totals.window ? 'Live · ' + num(d.totals.window) + ' registrations' : 'No data yet';
    const host = $resSignals; host.textContent = '';
    if (d.totals.window) {
      const t = d.totals;
      if (t.deltaPct != null) host.appendChild(signal(t.deltaPct >= 0 ? '#01a876' : '#d64545', ['Registrations are ', (t.deltaPct >= 0 ? 'up ' : 'down ') + Math.abs(t.deltaPct) + '%', ' vs last ' + d.window.days + ' days (' + num(t.window) + ' vs ' + num(t.previous) + ').']));
      const camp = d.campaigns.find((c) => c.name !== '(no campaign)');
      if (camp) host.appendChild(signal('#0d1211', ['Top campaign: ', camp.name, ' · ' + num(camp.n) + ' registrations.']));
      const best = d.campaigns.slice().sort((a, b) => (b.n || 0) - (a.n || 0))[0];
      if (best && (best.n || 0) > 0) host.appendChild(signal(colorFor(best.name === '(no campaign)' ? 'Direct' : best.name), ['Best campaign: ', best.name, ' with ' + num(best.n) + ' registrations.']));
      const direct = d.channels.find((c) => c.name === 'Direct / no tag');
      if (direct && direct.share >= 50) host.appendChild(signal('#d9962b', [direct.share + '%', ' of registrations carry no ad tag, so they cannot be matched to an ad. Use the ', 'Ad link builder', ' for every ad.'], true));
      const flat = []; d.heatmap.forEach((row, di) => row.forEach((v, h) => { if (v > 0) flat.push({ di: di, h: h, v: v }); })); flat.sort((a, b) => b.v - a.v);
      if (flat[0]) host.appendChild(signal('#065f4e', ['Busiest slot: ', DAYS_LONG[flat[0].di] + ' ' + hour12(flat[0].h) + ' – ' + hour12((flat[0].h + 1) % 24), ' (' + flat[0].v + '). Schedule ads just before it.']));
      const mob = d.devices.find((x) => x.name === 'Mobile');
      if (mob && mob.share >= 60) host.appendChild(signal('#01a876', [mob.share + '%', ' register on a phone: keep creatives and the form phone-first.']));
    } else {
      host.appendChild(signal('#d9962b', ['No registrations in this period. Share a master class link from the panel above, or widen the period.'], true));
    }
    $('resDayNote').textContent = 'Last ' + d.window.days + ' days · ' + d.window.labels[d.window.labels.length - 1];

    /* chart */
    const $resChart = $('resChart'), $resLegend = $('resLegend'), $resTip = $('resTip');
    const cum = state.mode === 'cumulative', partialLast = !d.window.custom;
    const all = mk(d.campaignSeries || [], (s) => s.key, (s) => s.name, (s) => colorFor(s.key), true);
    legend($resLegend, all);
    const vis = all.filter((s) => !isOff(s));
    const dailyTotal = d.labels.map((_, i) => sum(d.campaignSeries.filter((s) => !isOff({ key: s.key, total: s.total, autoOff: true })).map((s) => s.data[i])));
    const lines = vis.slice();
    if (state.showTotal && vis.length > 1) lines.unshift({ key: '_t', name: 'Total', color: '#e8f0ff', aux: true, data: cum ? cumulative(dailyTotal) : dailyTotal });
    if (state.showAvg && !cum) lines.push({ key: '_a', name: '7-day average', color: '#d9962b', aux: true, data: dailyTotal.map((_, i) => { const a = dailyTotal.slice(Math.max(0, i - 6), i + 1); return Math.round((sum(a) / a.length) * 100) / 100; }) });
    if (state.showPrev) lines.push({ key: '_p', name: 'Previous period (all)', color: '#94a3b8', aux: true, dashed: true, data: cum ? cumulative(d.previousOverall) : d.previousOverall });
    chartCourse.draw({ labels: d.labels, series: lines, cumulative: cum, title: 'Registrations by campaign', partialLast: partialLast });
    $('resChart').hidden = d.totals.window === 0;

    /* campaign breakdown */
    const $resCampaignBreakdown = $('resCampaignBreakdown');
    rank($resCampaignBreakdown, d.campaigns || [], (c) => c.name || '(no campaign)', 'No campaign data in this period');

    /* medium breakdown */
    rank($('resMediumBreakdown'), d.mediums || [], (m) => m.name || '(none)', 'No medium data in this period');

    /* device donut */
    const $resDeviceDonut = $('resDeviceDonut'), $resDeviceLegend = $('resDeviceLegend');
    donut($resDeviceDonut, $resDeviceLegend, d.devices || [], 'leads');

    /* country */
    rank($('resCountryBreakdown'), d.countries || [], (c) => c.name || 'Other', 'No country data in this period');

    /* per-campaign table */
    const $resCampaignTable = $('resCampaignTable');
    $('resEmptyAd').hidden = false;
    if (d.campaigns && d.campaigns.length) {
      $('resEmptyAd').hidden = true;
      head($resCampaignTable, [{ t: 'Campaign' }, { t: 'Source' }, { t: 'Medium' }, { t: 'Spend' }, { t: 'Registrations' }, { t: 'Share', r: 1 }, { t: 'Students', r: 1 }, { t: 'Professionals', r: 1 }, { t: 'Last', r: 1 }]);
      const max = Math.max.apply(null, d.campaigns.map((c) => c.n || 0)) || 1;
      d.campaigns.forEach((c) => {
        const tr = el('tr');
        tr.appendChild(el('td', 'nm', c.name || '(no campaign)'));
        tr.appendChild(el('td', 'muted', c.channel || ''));
        const m = el('td'); m.appendChild(el('span', 'pill', c.medium || '(none)')); tr.appendChild(m);
        tr.appendChild(el('td', 'r', c.spend ? '₹' + num(c.spend) : '–'));
        tr.appendChild(cellBar(c.n || 0, max));
        tr.appendChild(el('td', 'r', c.share != null ? c.share + '%' : '–'));
        tr.appendChild(el('td', 'r' + (c.students ? '' : ' zero'), num(c.students || 0))); tr.appendChild(el('td', 'r' + (c.professionals ? '' : ' zero'), num(c.professionals || 0)));
        const l = el('td', 'nowrap muted', c.lastLeadAt ? ago(c.lastLeadAt) : '–'); l.setAttribute('data-t', c.lastLeadAt || ''); tr.appendChild(l);
        $resCampaignTable.tBodies[0].appendChild(tr);
      });
    }

    /* top courses */
    rank($('resTopCourse'), d.byCourse || [], (c) => c.course || 'No course in link', 'No course data in this period');
    rank($('resTopStudentBranch'), d.students && d.students.courses ? d.students.courses : [], (c) => c.name || 'No course', 'No student course data in this period');
    rank($('resTopProRole'), d.professionals && d.professionals.roles ? d.professionals.roles : [], (c) => c.name || 'No role', 'No professional role data in this period');

    /* day table */
    const $resDayTable = $('resDayTable');
    if (d.labels && d.overall) {
      $('resEmptyAd').hidden = true;
      head($resDayTable, [{ t: 'Date' }, { t: 'Total' }].concat(d.series.filter((s) => s.total > 0).map((s) => ({ t: s.name || s.key, r: 1 })), [{ t: 'Students', r: 1 }, { t: 'Professionals', r: 1 }, { t: '7-day avg', r: 1 }, { t: 'vs day before', r: 1 }]));
      const max = Math.max.apply(null, d.overall) || 1;
      for (let i = d.labels.length - 1; i >= 0; i--) {
        const tr = el('tr'), v = d.overall[i], a = d.overall.slice(Math.max(0, i - 6), i + 1);
        tr.appendChild(el('td', 'nm nowrap', long(d.labels[i]) + (i === d.labels.length - 1 && !d.window.custom ? ' · today' : '')));
        tr.appendChild(cellBar(v, max));
        d.series.filter((s) => s.total > 0).forEach((s) => tr.appendChild(el('td', 'r' + (s.data[i] ? '' : ' zero'), num(s.data[i]))));
        tr.appendChild(el('td', 'r' + (d.students && d.students.courses.length ? (d.students.courses[0].data[i] || 0) : '') , num(0)));
        const proData = d.professionals && d.professionals.roles && d.professionals.roles.length ? (d.professionals.roles[0].data || []) : [];
        tr.appendChild(el('td', 'r' + (proData.length ? '' : ' zero'), num(proData[i] || 0)));
        tr.appendChild(el('td', 'r', (Math.round((sum(a) / a.length) * 10) / 10).toString()));
        let txt = '–', cls = 'r flat';
        if (i > 0) { const diff = v - d.overall[i - 1]; txt = diff > 0 ? '▲ ' + diff : diff < 0 ? '▼ ' + Math.abs(diff) : '= 0'; cls = 'r ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'); }
        tr.appendChild(el('td', cls, txt));
        $resDayTable.tBodies[0].appendChild(tr);
      }
    }

    /* ad table */
    renderAdTable(d);

    /* heatmap */
    renderHeat(d.heatmap || []);

    /* slots */
    const flat = []; (d.heatmap || []).forEach((row, di) => row.forEach((v, h) => { if (v > 0) flat.push({ di: di, h: h, v: v }); }));
    flat.sort((a, b) => b.v - a.v || a.di - b.di || a.h - b.h);
    const slots = $('resSlots'); slots.textContent = '';
    if (!flat.length) slots.appendChild(el('li', 'none', 'No registrations in this period yet.'));
    flat.slice(0, 3).forEach((c) => { const li = el('li'); li.appendChild(el('span', null, DAYS_LONG[c.di] + ', ' + hour12(c.h) + ' – ' + hour12((c.h + 1) % 24))); li.appendChild(el('em', null, c.v + (c.v === 1 ? ' registration' : ' registrations'))); slots.appendChild(li); });
    rank($('resWeekdays'), (d.heatmap || []).map((row, di) => ({ name: DAYS_LONG[di], n: sum(row) })).sort((a, b) => b.n - a.n), (r) => r.name);
  }

  /* ---------- KPIs ---------- */
  function setKpi(key, text) {
    const c = document.querySelector('[data-stat="' + key + '"]'); if (!c) return;
    if (c.textContent !== text) { c.textContent = text; if (prevKpi[key] !== undefined) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); } }
    prevKpi[key] = text;
  }
  function filterText(d) {
    const st = d.filters.status ? (d.filters.status === 'Student / Fresher' ? 'Students' : 'Professionals') : 'Students + professionals';
    const c = d.filters.course ? (d.courses.find((x) => x.slug === d.filters.course) || { name: d.filters.course }).name : 'All master classes';
    return c + ' · ' + st;
  }
  function renderKpis(d) {
    const t = d.totals, w = d.window;
    $('kWinLabel').textContent = 'Registrations · ' + (w.custom ? short(w.from) + ' – ' + short(w.to) : 'last ' + w.days + ' days');
    setKpi('window', num(t.window)); setKpi('today', num(t.today)); setKpi('avgPerDay', String(t.avgPerDay)); setKpi('peak', t.peak ? num(t.peak.n) : '–');
    setKpi('email', t.window ? d.quality.emailPct + '%' : '–');
    const spend = readSpend();
    if (spend > 0 && t.window > 0) { setKpi('cpl', '₹' + num(Math.round(spend / t.window))); $('kCpl').textContent = '₹' + num(spend) + ' over ' + num(t.window) + ' leads'; }
    else { setKpi('cpl', '–'); $('kCpl').textContent = spend > 0 ? 'No leads yet in this period' : 'Enter ad spend above'; }
    const dl = $('kDelta'); dl.className = 'delta';
    if (t.deltaPct == null) { dl.textContent = t.window > 0 ? 'No registrations in the previous ' + w.days + ' days' : ''; dl.classList.add('flat'); }
    else { dl.textContent = (t.deltaPct > 0 ? '▲ ' : t.deltaPct < 0 ? '▼ ' : '') + Math.abs(t.deltaPct) + '% vs previous ' + w.days + ' days'; dl.classList.add(t.deltaPct > 0 ? 'up' : t.deltaPct < 0 ? 'down' : 'flat'); }
    $('kLast').textContent = t.lastLeadAt ? 'Latest ' + ago(t.lastLeadAt) : 'No registrations yet'; $('kLast').setAttribute('data-t', t.lastLeadAt || ''); $('kLast').setAttribute('data-prefix', 'Latest ');
    $('kRange').textContent = 'over ' + w.days + ' days · all time ' + (t.allTime == null ? '–' : num(t.allTime));
    $('kPeak').textContent = t.peak ? long(t.peak.date) : 'No registrations in this period';
    $('kAll').textContent = t.window ? num(d.quality.withEmail) + ' of ' + num(t.window) + ' left an email' : filterText(d);
    $('cSub').textContent = w.days + ' days · ' + short(w.from) + ' – ' + short(w.to) + ' · ' + d.tz + (state.mode === 'cumulative' ? ' · running total' : '') + ' · ' + filterText(d);
    sparkline(d);
  }

  /* ---------- filter controls ---------- */
  function buildControls(d) {
    const seg = $('segStatus'); seg.textContent = '';
    [{ v: '', t: 'All' }].concat((d.statuses || DEFAULT_STATUSES).map((s) => ({ v: s, t: s }))).forEach((o) => {
      const b = el('button', null, o.t); b.type = 'button'; b.setAttribute('data-v', o.v);
      b.addEventListener('click', () => { state.status = o.v; changed(); }); seg.appendChild(b);
    });
    const chips = $('chipCourse'); chips.textContent = '';
    [{ slug: '', name: 'All' }].concat(d.courses).forEach((c) => {
      const b = el('button', 'chip', c.name); b.type = 'button'; b.setAttribute('data-v', c.slug);
      if (c.slug) { const sw = el('i', 'sw'); sw.style.background = colorFor(c.slug); b.insertBefore(sw, b.firstChild); }
      b.addEventListener('click', () => { state.course = c.slug; changed(); }); chips.appendChild(b);
    });
    const campHost = $('chipCampaign'); campHost.textContent = '';
    [{ name: '', label: 'All campaigns' }].concat((d.campaigns || []).map((c) => ({ name: c.name || '(no campaign)', label: c.name || '(no campaign)' }))).forEach((c) => {
      const b = el('button', 'chip', c.label); b.type = 'button'; b.setAttribute('data-v', c.name);
      b.addEventListener('click', () => { state.campaign = c.name; changed(); }); campHost.appendChild(b);
    });
    const cohHost = $('chipCohort'); cohHost.textContent = '';
    [{ name: '', label: 'All cohorts' }].concat((d.cohorts || []).map((c) => ({ name: c, label: c }))).forEach((c) => {
      const b = el('button', 'chip', c.label); b.type = 'button'; b.setAttribute('data-v', c.name);
      b.addEventListener('click', () => { state.cohort = c.name; changed(); }); cohHost.appendChild(b);
    });
    const srcHost = $('chipSource'); srcHost.textContent = '';
    [{ name: '', label: 'All sources' }].concat((d.sources || []).map((c) => ({ name: c, label: c }))).forEach((c) => {
      const b = el('button', 'chip', c.label); b.type = 'button'; b.setAttribute('data-v', c.name);
      b.addEventListener('click', () => { state.source = c.name; changed(); }); srcHost.appendChild(b);
    });
    state.built = true;
  }
  function syncControls() {
    document.querySelectorAll('#segStatus button').forEach((b) => { const on = b.getAttribute('data-v') === state.status; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#chipCourse button').forEach((b) => { const on = b.getAttribute('data-v') === state.course; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#chipCampaign button').forEach((b) => { const on = b.getAttribute('data-v') === state.campaign; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#chipCohort button').forEach((b) => { const on = b.getAttribute('data-v') === state.cohort; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#chipSource button').forEach((b) => { const on = b.getAttribute('data-v') === state.source; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#segMode button').forEach((b) => { const on = b.getAttribute('data-mode') === state.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const custom = Boolean(state.from || state.to), sel = $('winDays');
    sel.querySelector('[value="custom"]').hidden = !custom; sel.value = custom ? 'custom' : state.days;
    $('fFrom').value = state.from; $('fTo').value = state.to;
    const sp = readSpend(); if (document.activeElement !== $('spend')) $('spend').value = sp > 0 ? String(sp) : '';
  }
  function changed() { state.sig = ''; state.hidden.clear(); state.shown.clear(); state.hiddenCh.clear(); syncControls(); writeUrl(); refresh(); }

  /* ---------- live loop ---------- */
  function setLive(mode, text) { $('livePill').setAttribute('data-state', mode); $('liveText').textContent = text; }
  function paintLive() {
    if (state.paused) return setLive('paused', 'Paused');
    if (state.failures >= 2) return setLive('offline', 'Reconnecting…');
    if (!state.lastOk) return setLive('connecting', 'Connecting…');
    const s = Math.round((Date.now() - state.lastOk) / 1000);
    setLive('live', 'Live · ' + (s < 2 ? 'updated just now' : 'updated ' + s + 's ago'));
  }
  const signature = (d) => JSON.stringify(d, (k, v) => (k === 'generatedAt' ? undefined : v));
  function render(d) {
    state.data = d;
    if (!state.built) { buildControls(d); syncControls(); }
    const sig = signature(d);
    if (sig === state.sig) return;                         // nothing changed: leave the page (and any hover) alone
    state.sig = sig;
    renderKpis(d); renderSignals(d); renderCharts(); renderAdTable(d); renderMatrix(d.matrix); renderDayTable(d); renderHeat(d.heatmap); renderFeed(d.recent);
    donut($('donutChannel'), $('dlegChannel'), d.channels.map((c, i) => ({ name: c.name, n: c.n, share: c.share, color: CHANNEL_COLORS[i % CHANNEL_COLORS.length] })), 'leads');
    donut($('donutCourse'), $('dlegCourse'), d.byCourse.map((c) => ({ name: c.course, n: c.n, share: c.share, color: colorFor(c.course_slug || NO_COURSE) })), 'leads');
    donut($('donutDevice'), $('dlegDevice'), d.devices.map((c) => ({ name: c.name, n: c.n, share: c.share, color: DEVICE_COLORS[c.name] || '#64748b' })), 'leads');
    rank($('campaigns'), d.campaigns, (r) => r.name); rank($('mediums'), d.mediums, (r) => r.name); rank($('countries'), d.countries, (r) => r.name);
    rank($('stuCourse'), d.students.courses, (r) => r.name, 'No students in this period');
    rank($('stuYear'), d.students.statuses, (r) => r.name, ''); rank($('stuSpec'), d.students.specializations, (r) => r.name, ''); rank($('stuCollege'), d.colleges, (r) => r.name, '');
    rank($('proRole'), d.professionals.roles, (r) => r.name, 'No professionals in this period');
    rank($('proExp'), d.professionals.experience, (r) => r.name, ''); rank($('proQual'), d.professionals.qualifications, (r) => r.name, '');
    $('main').setAttribute('aria-busy', 'false');
    document.title = (d.totals.window ? '(' + d.totals.window + ') ' : '') + 'Live Analytics | KnoaLabs Admin';
  }
  async function tick() {
    if (state.paused) return;
    if (document.hidden) return schedule(POLL_MS);
    const my = ++state.seq; if (ctrl) ctrl.abort(); ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), 8000), t0 = performance.now();
    try {
      const res = await fetch('/admin/api/analytics?' + apiQuery().toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (res.status === 401) { location.replace('/admin/login'); return; }
      const d = await res.json();
      if (my !== state.seq) return;                        // a newer request (filters changed) owns the screen now
      if (!res.ok || !d.ok) throw new Error(d.error || 'Request failed');
      state.failures = 0; state.lastOk = Date.now(); render(d); paintLive();
      renderResultPanel(d);
      if (state.resCampaign) document.querySelector('#chipCampaign [data-v="' + state.resCampaign + '"]')?.click();
      if (state.resCohort) document.querySelector('#chipCohort [data-v="' + state.resCohort + '"]')?.click();
      if (state.resSource) document.querySelector('#chipSource [data-v="' + state.resSource + '"]')?.click();
    } catch (e) {
      if (my !== state.seq) return;
      state.failures++; paintLive();
    } finally { clearTimeout(kill); }
    if (my === state.seq) schedule(state.failures ? Math.min(5000, POLL_MS * (state.failures + 1)) : Math.max(250, POLL_MS - (performance.now() - t0)));
  }
  function schedule(ms) { clearTimeout(timer); if (!state.paused) timer = setTimeout(tick, ms); }
  function refresh() { clearTimeout(timer); tick(); }
  function redrawLocal() { if (state.data) { renderKpis(state.data); renderCharts(); } }

  /* ---------- events ---------- */
  $('winDays').addEventListener('change', (e) => { if (e.target.value === 'custom') return; state.days = e.target.value; state.from = ''; state.to = ''; changed(); });
  $('fFrom').addEventListener('change', (e) => { state.from = e.target.value; changed(); });
  $('fTo').addEventListener('change', (e) => { state.to = e.target.value; changed(); });
  $('clear').addEventListener('click', () => { state.status = ''; state.course = ''; state.days = '14'; state.from = ''; state.to = ''; changed(); });
  $('spend').addEventListener('input', (e) => { const v = Number(e.target.value); writeSpend(v > 0 && isFinite(v) ? v : 0); if (state.data) renderKpis(state.data); });
  document.querySelectorAll('#segMode button').forEach((b) => b.addEventListener('click', () => { state.mode = b.getAttribute('data-mode'); syncControls(); writeUrl(); redrawLocal(); }));
  [['togTotal', 'showTotal'], ['togAvg', 'showAvg'], ['togPrev', 'showPrev']].forEach((p) => $(p[0]).addEventListener('click', () => { state[p[1]] = !state[p[1]]; syncControls(); renderCharts(); }));
  $('pauseBtn').addEventListener('click', () => { state.paused = !state.paused; $('pauseBtn').textContent = state.paused ? 'Resume' : 'Pause'; paintLive(); if (!state.paused) refresh(); else { clearTimeout(timer); if (ctrl) ctrl.abort(); state.seq++; } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.paused) refresh(); });
  document.addEventListener('knoa:courses-changed', () => { state.built = false; state.sig = ''; refresh(); });
  document.addEventListener('knoa:lead-deleted', () => { state.sig = ''; refresh(); });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderCharts, 120); });
  $('logout').addEventListener('click', () => {
    fetch('/admin/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(() => {}).then(() => location.replace('/admin/login'));
  });
  setInterval(() => {                                       // once a second: "x s ago" labels
    paintLive();
    document.querySelectorAll('[data-t]').forEach((n) => { if (n.getAttribute('data-t')) n.textContent = (n.getAttribute('data-prefix') || '') + ago(n.getAttribute('data-t')); });
  }, 1000);

  /* ---------- start ---------- */
  readUrl(); syncControls();
  $('main').setAttribute('aria-busy', 'true');
  fetch('/admin/api/me', { credentials: 'same-origin' }).then((r) => (r.status === 401 ? (location.replace('/admin/login'), null) : r.json())).then((m) => { if (m && m.username) $('who').textContent = m.username; }).catch(() => {});
  tick();
})();
