/* Ad analytics: polls /admin/api/analytics every second and redraws only when the numbers changed.
   Everything from the server goes in with textContent / createElementNS (never innerHTML), so lead data can't inject markup. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const NO_COURSE = '__none';
  const CAMP_COLORS = ['#01c289', '#2f7de1', '#d9962b', '#7b61c9', '#e0704a', '#16a39a'];
  const MAX_CAMP_CHIPS = 10;
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

  const state = { status: '', course: '', campaign: '', channel: '', medium: '', platform: '', days: '14', from: '', to: '', mode: 'daily', showTotal: true, showAvg: false, showPrev: false,
    hidden: new Set(), shown: new Set(), hiddenCh: new Set(), hiddenCp: new Set(), paused: false, seq: 0, lastOk: 0, failures: 0, sig: '', data: null, built: false };
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
    if (q.get('campaign')) state.campaign = q.get('campaign').slice(0, 120);
    if (q.get('channel')) state.channel = q.get('channel').slice(0, 60);
    if (q.get('medium')) state.medium = q.get('medium').slice(0, 120);
    if (q.get('platform')) state.platform = q.get('platform').slice(0, 40);
    if (PRESETS.indexOf(q.get('days')) >= 0) state.days = q.get('days');
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('from') || '')) state.from = q.get('from');
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('to') || '')) state.to = q.get('to');
    if (q.get('mode') === 'cumulative') state.mode = 'cumulative';
  }
  function apiQuery() {
    const p = new URLSearchParams();
    if (state.status) p.set('status', state.status);
    if (state.course) p.set('course', state.course);
    if (state.campaign) p.set('campaign', state.campaign);
    if (state.channel) p.set('channel', state.channel);
    if (state.medium) p.set('medium', state.medium);
    if (state.platform) p.set('platform', state.platform);
    if (state.from || state.to) { if (state.from) p.set('from', state.from); if (state.to) p.set('to', state.to); } else p.set('days', state.days);
    return p;
  }
  function writeUrl() {
    const p = apiQuery(); if (state.mode !== 'daily') p.set('mode', state.mode);
    const qs = p.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) { /* ignore */ }
  }

  /* ---------- ad spend (kept in this browser, per period) ---------- */
  const spendKey = () => 'knoa.spend.' + (state.from || state.to ? state.from + '_' + state.to : state.days) + '.' + (state.course || 'all') + '.' + (state.campaign || 'all') + '.' + (state.channel || 'all') + '.' + (state.medium || 'all') + '.' + (state.platform || 'all');
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
    let cfg = null, hover = -1, geo = null, zoom = null, drag = null, onZoom = null, nTotal = 0;
    function draw(next) {
      if (next) { if (cfg && cfg.labels.length !== next.labels.length) zoom = null; cfg = next; }
      if (!cfg) return;
      nTotal = cfg.labels.length;
      if (zoom && (zoom[1] >= nTotal || zoom[0] >= zoom[1])) zoom = null;
      const lo = zoom ? zoom[0] : 0, hi = zoom ? zoom[1] : nTotal - 1, full = !!wrap.closest('.fs-open');
      const view = { labels: cfg.labels.slice(lo, hi + 1), series: cfg.series.map((s) => Object.assign({}, s, { data: s.data.slice(lo, hi + 1) })), cumulative: cfg.cumulative, title: cfg.title, partialLast: cfg.partialLast && hi === nTotal - 1 };
      if (onZoom) onZoom(!!zoom);
      return drawView(view, full);
    }
    function drawView(cfgv, full) {
      const cfg = cfgv;
      const W = Math.max(280, Math.floor(wrap.clientWidth - 2)), H = full ? Math.max(360, Math.floor(wrap.clientHeight - 6)) : wrap.classList.contains('short') ? 230 : 320;
      const pad = { l: 40, r: 16, t: 16, b: 30 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
      const n = cfg.labels.length, vis = cfg.series;
      let max = 1; vis.forEach((s) => s.data.forEach((v) => { if (v > max) max = v; }));
      const step = niceStep(max), top = Math.ceil(max / step) * step;
      const x = (i) => pad.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const y = (v) => pad.t + ph - (v / top) * ph;
      geo = { W, H, pad, pw, ph, n, x, y, vis, labels: cfg.labels, cfg: cfg };
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
      svg.appendChild(sv('g', { class: 'sel' }));
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
      tip.appendChild(el('b', 'tip-d', long(geo.labels[hover]) + (hover === geo.n - 1 && geo.cfg.partialLast ? ' · today so far' : '')));
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
    const px = (ev) => { const r = svg.getBoundingClientRect(); return (ev.clientX - r.left) * (geo.W / r.width); };
    const idxAt = (p) => Math.min(geo.n - 1, Math.max(0, Math.round(((p - geo.pad.l) / geo.pw) * (geo.n - 1))));
    function paintSel() {
      const g = svg.querySelector('.sel'); if (!g) return; g.textContent = '';
      if (drag && Math.abs(drag.b - drag.a) > 4) g.appendChild(sv('rect', { x: Math.min(drag.a, drag.b), y: geo.pad.t, width: Math.abs(drag.b - drag.a), height: geo.ph, class: 'zsel' }));
    }
    svg.addEventListener('pointerdown', (ev) => { at(ev); if (geo && geo.n > 2) { drag = { a: px(ev), b: px(ev) }; try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } } });
    svg.addEventListener('pointermove', (ev) => { at(ev); if (drag) { drag.b = px(ev); paintSel(); } });
    svg.addEventListener('pointerup', () => {                  // drag across the chart = zoom to that range (needs at least 3 days)
      if (!drag) return; const d = drag; drag = null; paintSel();
      if (Math.abs(d.b - d.a) < 12) return;
      const a = idxAt(Math.min(d.a, d.b)), b = idxAt(Math.max(d.a, d.b)); if (b - a < 2) return;
      const base = zoom ? zoom[0] : 0; zoom = [base + a, base + b]; draw();
    });
    svg.addEventListener('pointercancel', () => { drag = null; paintSel(); });
    svg.addEventListener('dblclick', () => { if (zoom) { zoom = null; draw(); } });
    svg.addEventListener('pointerleave', () => { hover = -1; drawHover(); });
    function zoomBy(dir) {                                      // +: show about half as many days around the middle; -: twice as many
      const lo = zoom ? zoom[0] : 0, hi = zoom ? zoom[1] : nTotal - 1, len = hi - lo + 1, mid = (lo + hi) / 2;
      const nl = dir > 0 ? Math.max(3, Math.round(len / 2)) : Math.min(nTotal, len * 2);
      if (nl >= nTotal) zoom = null; else { let a = Math.round(mid - (nl - 1) / 2); a = Math.max(0, Math.min(nTotal - nl, a)); zoom = [a, a + nl - 1]; }
      draw();
    }
    return { draw: draw, zoomBy: zoomBy, reset: () => { zoom = null; draw(); }, onZoom: (fn) => { onZoom = fn; }, isZoomed: () => !!zoom };
  }
  const chartCourse = LineChart($('chartCourse'), $('wrapCourse'), $('tipCourse'), 'cc');
  const chartChannel = LineChart($('chartChannel'), $('wrapChannel'), $('tipChannel'), 'ch');
  const chartStatus = LineChart($('chartStatus'), $('wrapStatus'), $('tipStatus'), 'cs');
  const chartCampaign = LineChart($('chartCampaign'), $('wrapCampaign'), $('tipCampaign'), 'cp');
  /* zoom (+ / − / reset, or drag across the chart, double-click to reset) and full screen on every line chart */
  [[chartCourse, 'wrapCourse'], [chartChannel, 'wrapChannel'], [chartStatus, 'wrapStatus'], [chartCampaign, 'wrapCampaign']].forEach(([chart, wid]) => {
    const wrap = $(wid), card = wrap.closest('.fx-card'), bar = el('div', 'ztools'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Chart zoom');
    const mkb = (t, label, fn) => { const b = el('button', 'kbtn sm', t); b.type = 'button'; b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; };
    const reset = mkb('Reset zoom', 'Reset zoom', () => chart.reset()); reset.hidden = true;
    bar.appendChild(mkb('+', 'Zoom in', () => chart.zoomBy(1))); bar.appendChild(mkb('−', 'Zoom out', () => chart.zoomBy(-1))); bar.appendChild(reset);
    bar.appendChild(el('span', 'zhint', 'Drag across the chart to zoom')); bar.appendChild(window.KnoaFS ? window.KnoaFS.button(card, () => chart.draw()) : el('span'));
    chart.onZoom((z) => { reset.hidden = !z; });
    wrap.parentNode.insertBefore(bar, wrap);
  });

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

    const cps = (d.campaignSeries || []).map((s, i) => ({ key: s.key, name: s.name, color: CAMP_COLORS[i % CAMP_COLORS.length], total: s.total, data: cum ? cumulative(s.data) : s.data }));
    legend($('legendCampaign'), cps, state.hiddenCp);
    chartCampaign.draw({ labels: d.labels, series: cps.filter((s) => !state.hiddenCp.has(s.key)), cumulative: cum, title: 'Registrations by campaign', partialLast: partialLast });
    $('emptyCampaign').hidden = cps.length > 0;
    $('campSub').textContent = cps.length ? 'Top ' + cps.length + ' campaign' + (cps.length === 1 ? '' : 's') + ' · ' + filterText(d) : 'Top campaigns per day';

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
  /* Meta ads: Facebook vs Instagram (registrations + link opens per app, and per placement). Uses Meta's own {{site_source_name}} / {{placement}}. */
  const PLATFORM_COLORS = { 'Facebook': '#1877f2', 'Instagram': '#d6249f', 'Messenger': '#0a7cff', 'Audience Network': '#7c3aed', 'Meta (unknown)': '#94a3b8' };
  function renderMeta(d) {
    const m = d.meta, t = $('metaTable'), empty = m.total === 0 && !(m.opens > 0);
    $('emptyMeta').hidden = !empty; $('metaCard').classList.toggle('is-empty', empty);
    t.hidden = empty; $('metaPlacements').hidden = empty;
    const hint = $('metaHint');
    if (empty) { hint.hidden = true; t.tHead.textContent = ''; t.tBodies[0].textContent = ''; $('metaPlacements').textContent = ''; return; }
    head(t, [{ t: 'Meta app' }, { t: 'Link opens', r: 1 }, { t: 'Registrations' }, { t: 'Conversion', r: 1 }, { t: 'Share', r: 1 }, { t: 'Students', r: 1 }, { t: 'Professionals', r: 1 }]);
    const max = Math.max.apply(null, m.platforms.map((x) => x.n)) || 1;
    m.platforms.forEach((p) => {
      const tr = el('tr', state.platform === p.name ? 'sel' : ''), td = el('td', 'nm');
      const sw = el('i', 'sw'); sw.style.background = PLATFORM_COLORS[p.name] || '#64748b'; td.appendChild(sw);
      const b = el('button', 'linkbtn', p.name); b.type = 'button'; b.title = 'Show only ' + p.name;
      b.addEventListener('click', () => { state.platform = state.platform === p.name ? '' : p.name; changed(); });
      td.appendChild(b); tr.appendChild(td);
      tr.appendChild(el('td', 'r' + (p.opens ? '' : ' zero'), p.opens == null ? '–' : num(p.opens)));
      tr.appendChild(cellBar(p.n, max)); tr.appendChild(el('td', 'r', p.conversionPct == null ? '–' : p.conversionPct + '%')); tr.appendChild(el('td', 'r', p.share + '%'));
      tr.appendChild(el('td', 'r' + (p.students ? '' : ' zero'), num(p.students))); tr.appendChild(el('td', 'r' + (p.professionals ? '' : ' zero'), num(p.professionals)));
      t.tBodies[0].appendChild(tr);
    });
    rank($('metaPlacements'), m.placements.map((p) => ({ name: p.name, n: p.n, app: p.app, opens: p.opens })), (r) => r.name + (r.opens ? '  (' + num(r.opens) + ' opens)' : ''), '');
    const unknown = m.total - m.known;
    if (m.total && unknown > 0) {
      hint.hidden = false;
      hint.textContent = num(unknown) + ' of ' + num(m.total) + ' Meta registrations (' + Math.round((unknown / m.total) * 100) + '%) cannot be split: those links do not say Facebook or Instagram. Add site_source_name={{site_source_name}} and placement={{placement}} to the ad\u2019s URL parameters in Meta Ads Manager (the Ad link builder shows the exact text).';
    } else hint.hidden = true;
  }
  function renderTree(d) {
    const host = $('tree'); host.textContent = ''; $('emptyTree').hidden = d.tree.length > 0;
    d.tree.forEach((node) => {
      const box = el('div', 'tnode' + (state.course === node.key && !state.campaign ? ' on' : ''));
      const head = el('button', 'thead'); head.type = 'button';
      const sw = el('i', 'sw'); sw.style.background = colorFor(node.key); head.appendChild(sw);
      head.appendChild(el('span', 'tname', node.course)); head.appendChild(el('b', null, num(node.n)));
      head.addEventListener('click', () => { state.course = node.key; state.campaign = ''; changed(); });
      box.appendChild(head);
      const maxN = node.campaigns.length ? node.campaigns[0].n : 1, ul = el('ul', 'tcamps');
      node.campaigns.forEach((c) => {
        const li = el('li'), b = el('button', 'tcamp' + (state.course === node.key && state.campaign === c.key ? ' on' : '')); b.type = 'button';
        b.appendChild(el('span', 'cname' + (c.key === NO_COURSE ? ' muted' : ''), c.name));
        const bar = el('span', 'tbar'), fill = el('i'); fill.style.width = Math.max(4, Math.round((c.n / maxN) * 100)) + '%'; bar.appendChild(fill); b.appendChild(bar);
        b.appendChild(el('b', null, num(c.n)));
        b.title = c.students + ' students · ' + c.professionals + ' professionals';
        b.addEventListener('click', () => { state.course = node.key; state.campaign = c.key; changed(); });
        li.appendChild(b); ul.appendChild(li);
      });
      if (node.moreCampaigns) ul.appendChild(el('li', 'tmore muted', '+ ' + node.moreCampaigns + ' more campaign' + (node.moreCampaigns === 1 ? '' : 's')));
      box.appendChild(ul); host.appendChild(box);
    });
  }
  function miniSpark(data) {
    const svg = sv('svg', { viewBox: '0 0 80 22', class: 'mspark', 'aria-hidden': 'true' }), n = data.length, max = Math.max.apply(null, data) || 1;
    const x = (i) => (n === 1 ? 40 : (i / (n - 1)) * 80), y = (v) => 20 - (v / max) * 18;
    svg.appendChild(sv('path', { d: data.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' '), fill: 'none', stroke: '#01a876', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    return svg;
  }
  function renderCampTable(d) {
    const t = $('campTable'), rows = d.campaignTable;
    $('emptyCampTable').hidden = rows.length > 0; t.hidden = rows.length === 0;
    const cn = state.course ? (d.courses.find((c) => c.slug === state.course) || { name: state.course }).name : '';
    $('hCampTable').textContent = cn ? 'Campaign performance · ' + cn : 'Campaign performance';
    if (!rows.length) return;
    head(t, [{ t: 'Campaign' }, { t: 'Link opens', r: 1 }, { t: 'Registrations' }, { t: 'Conversion', r: 1 }, { t: 'Share', r: 1 }, { t: 'Students', r: 1 }, { t: 'Professionals', r: 1 }, { t: 'Trend' }, { t: 'Top channel' }, { t: 'Top master class' }, { t: 'Last' }]);
    const max = Math.max.apply(null, rows.map((x) => x.n)) || 1;
    rows.forEach((r) => {
      const tr = el('tr', state.campaign === r.key ? 'sel' : ''), td = el('td', 'nm');
      const b = el('button', 'linkbtn', r.campaign); b.type = 'button'; b.title = 'Show only this campaign';
      b.addEventListener('click', () => { state.campaign = state.campaign === r.key ? '' : r.key; changed(); });
      td.appendChild(b); tr.appendChild(td);
      tr.appendChild(el('td', 'r' + (r.opens ? '' : ' zero'), r.opens == null ? '–' : num(r.opens)));
      tr.appendChild(cellBar(r.n, max)); tr.appendChild(el('td', 'r', r.conversionPct == null ? '–' : r.conversionPct + '%')); tr.appendChild(el('td', 'r', r.share + '%'));
      tr.appendChild(el('td', 'r' + (r.students ? '' : ' zero'), num(r.students))); tr.appendChild(el('td', 'r' + (r.professionals ? '' : ' zero'), num(r.professionals)));
      const sp = el('td'); sp.appendChild(miniSpark(r.data)); tr.appendChild(sp);
      tr.appendChild(el('td', null, r.topChannel)); tr.appendChild(el('td', null, r.topCourse));
      const l = el('td', 'nowrap muted', r.lastLeadAt ? ago(r.lastLeadAt) : '–'); if (r.lastLeadAt) l.setAttribute('data-t', r.lastLeadAt); tr.appendChild(l);
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
    if (camp) host.appendChild(signal('#0d1211', ['Top campaign' + (d.filters.course ? ' in ' + (d.courses.find((c) => c.slug === d.filters.course) || { name: d.filters.course }).name : '') + ': ', camp.name, ' · ' + num(camp.n) + ' registrations.']));
    const direct = d.channels.find((c) => c.name === 'Direct / no tag');
    if (direct && direct.share >= 50) host.appendChild(signal('#d9962b', [direct.share + '%', ' of registrations carry no ad tag, so they cannot be matched to an ad. Use the ', 'Ad link builder', ' for every ad.'], true));
    const vv = d.visits;
    if (vv && vv.available && vv.window > 0 && vv.conversionPct != null) host.appendChild(signal('#2f7de1', [num(vv.window), ' visits to the link and ', num(t.window) + ' registered', ' (' + vv.conversionPct + '%).']));
    const flat = []; d.heatmap.forEach((row, di) => row.forEach((v, h) => { if (v > 0) flat.push({ di: di, h: h, v: v }); })); flat.sort((a, b) => b.v - a.v);
    if (flat[0]) host.appendChild(signal('#065f4e', ['Busiest slot: ', DAYS_LONG[flat[0].di] + ' ' + hour12(flat[0].h) + ' – ' + hour12((flat[0].h + 1) % 24), ' (' + flat[0].v + '). Schedule ads just before it.']));
    const mob = d.devices.find((x) => x.name === 'Mobile');
    if (mob && mob.share >= 60) host.appendChild(signal('#01a876', [mob.share + '%', ' register on a phone: keep creatives and the form phone-first.']));
  }

  function setKpi(key, text) {
    const c = document.querySelector('[data-stat="' + key + '"]'); if (!c) return;
    if (c.textContent !== text) { c.textContent = text; if (prevKpi[key] !== undefined) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); } }
    prevKpi[key] = text;
  }
  const campLabel = (k) => (k === NO_COURSE ? '(no campaign)' : k);
  const mediumLabel = (k) => (k === NO_COURSE ? '(none)' : k);
  function filterText(d) {
    const f = d.filters, st = f.status ? (f.status === 'Student / Fresher' ? 'Students' : 'Professionals') : 'Students + professionals';
    const c = f.course ? (d.courses.find((x) => x.slug === f.course) || { name: f.course }).name : 'All master classes';
    return [c, f.campaign ? 'Campaign ' + campLabel(f.campaign) : '', f.channel ? f.channel : '', f.medium ? 'Medium ' + mediumLabel(f.medium) : '', f.platform ? 'Meta app ' + (f.platform === NO_COURSE ? 'not Meta' : f.platform) : '', st].filter(Boolean).join(' · ');
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
    const v = d.visits || { available: false };
    if (!v.available) { setKpi('opens', '–'); $('kOpens').textContent = 'Not shown for one "I am a" group'; $('kOpens').title = 'Visitors who only opened the link have not chosen Student or Professional yet.'; }
    else {
      setKpi('opens', num(v.window));
      const since = v.since && v.since.slice(0, 10) > w.from ? 'counting since ' + short(v.since.slice(0, 10)) : '';
      const parts = !v.since ? ['counting starts with the next visitor'] : v.window ? [v.conversionPct != null ? v.conversionPct + '% registered' : '', since] : ['no opens in this period', since];
      const txt = parts.filter(Boolean).join(' · ');
      $('kOpens').textContent = txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : '\u00a0'; $('kOpens').title = 'Visits to the registration link: one per visitor, per day, per link (a person opening two different ad links counts twice). Bots and link previews are not counted.';
    }
    sparkline(d);
  }

  /* ---------- filter controls ---------- */
  function buildControls(d) {
    const seg = $('segStatus'); seg.textContent = '';
    [{ v: '', t: 'All' }].concat((d.statuses || DEFAULT_STATUSES).map((s) => ({ v: s, t: s }))).forEach((o) => {
      const b = el('button', null, o.t); b.type = 'button'; b.setAttribute('data-v', o.v);
      b.addEventListener('click', () => { state.status = o.v; state.campaign = ''; changed(); }); seg.appendChild(b);
    });
    state.built = true;
  }

  /* chips / selects are updated in place when only the numbers change, so a live update never steals focus or closes an open dropdown */
  function syncChips(host, items, selected, pick, colorOf) {
    const keySig = items.map((i) => i.key).join('\u0001');
    if (host.getAttribute('data-sig') !== keySig) {
      host.textContent = ''; host.setAttribute('data-sig', keySig);
      items.forEach((it) => {
        const b = el('button', 'chip'); b.type = 'button'; b.setAttribute('data-v', it.key);
        if (colorOf && colorOf(it)) { const sw = el('i', 'sw'); sw.style.background = colorOf(it); b.appendChild(sw); }
        b.appendChild(el('span', 'cl', it.name)); b.appendChild(el('b', 'cn', ''));
        b.addEventListener('click', () => pick(it.key)); host.appendChild(b);
      });
    }
    const btns = host.children;
    items.forEach((it, i) => {
      const b = btns[i], on = it.key === selected;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      b.querySelector('.cl').textContent = it.name;
      const cn = b.querySelector('.cn'); cn.textContent = it.n == null ? '' : num(it.n); cn.hidden = it.n == null;
      b.classList.toggle('zero', it.n === 0 && !on);
    });
  }
  function syncSelect(sel, allLabel, facet, selected, extra) {
    const items = [{ key: '', name: allLabel + (facet.total != null ? ' (' + num(facet.total) + ')' : '') }].concat(facet.items.map((o) => ({ key: o.key, name: (extra ? extra(o.key, o.name) : o.name) + ' (' + num(o.n) + ')' })));
    const keySig = items.map((i) => i.key).join('\u0001');
    if (sel.getAttribute('data-sig') !== keySig) {
      sel.textContent = ''; sel.setAttribute('data-sig', keySig);
      items.forEach((it) => { const o = document.createElement('option'); o.value = it.key; o.textContent = it.name; sel.appendChild(o); });
    } else items.forEach((it, i) => { if (sel.options[i].textContent !== it.name) sel.options[i].textContent = it.name; });
    if (sel.value !== selected) sel.value = selected;
  }
  function syncFacets(d) {
    const f = d.facets;
    syncChips($('chipCourse'), [{ key: '', name: 'All', n: f.total }].concat(d.courses.map((c) => ({ key: c.slug, name: c.name, n: c.n }))),
      state.course, (k) => { state.course = k; state.campaign = ''; changed(); }, (it) => (it.key ? colorFor(it.key) : ''));

    // campaigns: the ones that ran inside the selected master class (all of them when "All" is picked)
    const courseName = state.course ? (d.courses.find((c) => c.slug === state.course) || { name: state.course }).name : '';
    $('lblCampaign').textContent = courseName ? 'Campaign · in ' + courseName : 'Campaign · all master classes';
    const camps = f.campaign.items;
    let chips = camps.slice(0, MAX_CAMP_CHIPS);
    const sel = camps.find((c) => c.key === state.campaign);
    if (sel && chips.indexOf(sel) < 0) chips = chips.slice(0, MAX_CAMP_CHIPS - 1).concat(sel);
    const host = $('chipCampaign');
    if (!camps.length) { host.textContent = ''; host.removeAttribute('data-sig'); host.appendChild(el('span', 'muted small-note', 'No campaigns in this period yet. Tag your ads with the Ad link builder to see them here.')); }
    else {
      if (host.querySelector('.small-note')) host.textContent = '';
      syncChips(host, [{ key: '', name: 'All campaigns', n: f.campaign.total }].concat(chips.map((c) => ({ key: c.key, name: c.name, n: c.n }))), state.campaign, (k) => { state.campaign = k; changed(); });
    }
    let more = $('moreCampaign');
    const rest = camps.filter((c) => chips.indexOf(c) < 0);
    if (rest.length) {
      if (!more) { more = document.createElement('select'); more.id = 'moreCampaign'; more.className = 'control sm more'; more.setAttribute('aria-label', 'More campaigns'); more.addEventListener('change', () => { if (more.value) { state.campaign = more.value; changed(); } }); host.parentNode.appendChild(more); }
      const sig = rest.map((c) => c.key).join('\u0001');
      if (more.getAttribute('data-sig') !== sig) {
        more.textContent = ''; more.setAttribute('data-sig', sig);
        const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'More campaigns (' + rest.length + ')…'; more.appendChild(o0);
        rest.forEach((c) => { const o = document.createElement('option'); o.value = c.key; o.textContent = c.name + ' (' + num(c.n) + ')'; more.appendChild(o); });
      }
      more.value = '';
    } else if (more) more.remove();

    syncSelect($('selChannel'), 'All channels', f.channel, state.channel);
    syncSelect($('selMedium'), 'All mediums', f.medium, state.medium, mediumLabel);
    renderCrumbs(d);
  }

  function renderCrumbs(d) {
    const host = $('crumbs'); host.textContent = '';
    const f = d.filters, items = [];
    if (f.status) items.push(['status', f.status === 'Student / Fresher' ? 'Students' : 'Professionals']);
    if (f.course) items.push(['course', (d.courses.find((c) => c.slug === f.course) || { name: f.course }).name]);
    if (f.campaign) items.push(['campaign', 'Campaign: ' + campLabel(f.campaign)]);
    if (f.channel) items.push(['channel', 'Channel: ' + f.channel]);
    if (f.medium) items.push(['medium', 'Medium: ' + mediumLabel(f.medium)]);
    if (f.platform) items.push(['platform', 'Meta app: ' + (f.platform === NO_COURSE ? 'not Meta' : f.platform)]);
    if (!items.length) { host.appendChild(el('span', 'muted small-note', 'Everything: all master classes, campaigns and channels')); return; }
    items.forEach((it) => {
      const b = el('button', 'crumb'); b.type = 'button'; b.setAttribute('aria-label', 'Remove filter ' + it[1]);
      b.appendChild(el('span', null, it[1])); b.appendChild(el('i', null, '×'));
      b.addEventListener('click', () => { state[it[0]] = ''; if (it[0] === 'course' || it[0] === 'status') state.campaign = ''; changed(); });
      host.appendChild(b);
    });
  }
  function syncControls() {
    document.querySelectorAll('#segStatus button').forEach((b) => { const on = b.getAttribute('data-v') === state.status; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#segMode button').forEach((b) => { const on = b.getAttribute('data-mode') === state.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    [['togTotal', 'showTotal'], ['togAvg', 'showAvg'], ['togPrev', 'showPrev']].forEach((p) => { $(p[0]).classList.toggle('on', state[p[1]]); $(p[0]).setAttribute('aria-pressed', String(state[p[1]])); });
    const custom = Boolean(state.from || state.to), sel = $('winDays');
    sel.querySelector('[value="custom"]').hidden = !custom; sel.value = custom ? 'custom' : state.days;
    $('fFrom').value = state.from; $('fTo').value = state.to;
    const sp = readSpend(); if (document.activeElement !== $('spend')) $('spend').value = sp > 0 ? String(sp) : '';
  }
  function changed() { state.sig = ''; state.hidden.clear(); state.shown.clear(); state.hiddenCh.clear(); state.hiddenCp.clear(); syncControls(); if (state.data) renderCrumbs({ ...state.data, filters: { status: state.status || null, course: state.course || null, campaign: state.campaign || null, channel: state.channel || null, medium: state.medium || null, platform: state.platform || null } }); writeUrl(); refresh(); }

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
    renderKpis(d); renderSignals(d); renderCharts(); renderAdTable(d); renderMeta(d); renderMatrix(d.matrix); renderDayTable(d); renderHeat(d.heatmap); renderFeed(d.recent);
    syncFacets(d); renderTree(d); renderCampTable(d);
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
    } catch (e) {
      if (my !== state.seq) return;
      state.failures++; paintLive();
    } finally { clearTimeout(kill); }
    if (my === state.seq) schedule(state.failures ? Math.min(5000, POLL_MS * (state.failures + 1)) : Math.max(250, POLL_MS - (performance.now() - t0)));
  }
  function schedule(ms) { clearTimeout(timer); if (!state.paused) timer = setTimeout(tick, ms); }
  function refresh() { clearTimeout(timer); tick(); }
  function redrawLocal() { if (state.data) { renderKpis(state.data); renderCharts(); } }

  /* ---------- link finder: paste a link -> the normal filters are set for you ---------- */
  const looksLikeLink = (t) => /^https?:\/\//i.test(t) || /utm_[a-z]+=/i.test(t) || /^[^\s/]+\.[a-z]{2,}(\/|\?|$)/i.test(t) || /^[^\s/]+:\d+(\/|\?|$)/.test(t) || /^\//.test(t);
  function lfMsg(text, kind) { const m = $('findMsg'); m.textContent = text || ''; m.className = 'lf-msg' + (kind === 'warn' ? ' warn' : kind ? ' bad' : ''); }   // kind: true = error, 'warn' = note
  function lfClearSuggest() { $('findSuggest').textContent = ''; }
  function lfApply(f) {
    /* the link only sets the normal filters (master class, campaign, channel, medium); the page below then shows that link's numbers */
    state.status = ''; state.course = f.course || ''; state.channel = f.channel || ''; state.medium = f.medium || ''; state.campaign = f.campaign || ''; state.platform = f.platform || '';
    if (!state.from && !state.to && state.days !== '90') state.days = '90';          // a link is judged over its whole life, not just the last two weeks
    $('findClear').hidden = false;
    changed();
  }
  function lfTextSearch(text) {
    const d = state.data; if (!d) return lfMsg('Loading… try again in a second.', true);
    const q = text.toLowerCase(), out = [];
    d.courses.forEach((c) => { if (c.name.toLowerCase().includes(q) || c.slug.includes(q)) out.push({ label: 'Master class · ' + c.name, f: { course: c.slug } }); });
    d.facets.campaign.items.forEach((c) => { if (c.name.toLowerCase().includes(q)) out.push({ label: 'Campaign · ' + c.name + ' (' + num(c.n) + ')', f: { course: state.course, campaign: c.key } }); });
    d.facets.channel.items.forEach((c) => { if (c.name.toLowerCase().includes(q)) out.push({ label: 'Channel · ' + c.name + ' (' + num(c.n) + ')', f: { course: state.course, channel: c.key } }); });
    d.facets.medium.items.forEach((c) => { if (c.key !== NO_COURSE && c.name.toLowerCase().includes(q)) out.push({ label: 'Medium · ' + c.name + ' (' + num(c.n) + ')', f: { course: state.course, medium: c.key } }); });
    lfClearSuggest();
    if (!out.length) return lfMsg('Nothing matches "' + text.slice(0, 40) + '" in this period. Paste the full link, or press Reset and try again.', true);
    if (out.length === 1) { lfMsg('Found: ' + out[0].label.replace(/ \(\d[\d,]*\)$/, '')); return lfApply(out[0].f); }
    lfMsg(out.length + ' matches. Pick one:');
    out.slice(0, 12).forEach((o) => { const b = el('button', 'chip', o.label); b.type = 'button'; b.addEventListener('click', () => { lfClearSuggest(); lfMsg('Showing: ' + o.label.replace(/ \(\d[\d,]*\)$/, '')); lfApply(o.f); }); $('findSuggest').appendChild(b); });
  }
  let lfSeq = 0;
  function lfSearch() {
    const text = $('findInput').value.trim(); lfClearSuggest();
    if (!text) { lfMsg(''); return; }
    if (!looksLikeLink(text)) return lfTextSearch(text);
    const my = ++lfSeq; lfMsg('Reading the link…');
    fetch('/admin/api/link-lookup?url=' + encodeURIComponent(text), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then((r) => { if (r.status === 401) { location.replace('/admin/login'); throw new Error('signed out'); } return r.json(); })
      .then((r) => {
        if (my !== lfSeq) return;
        if (!r.ok) return lfMsg(r.error || 'Could not read that link.', true);
        const bits = [r.course ? r.course.name : r.plain ? 'plain link' : '', r.channel, r.medium, r.campaign].filter(Boolean);
        const notes = [];
        if (r.unknownCourse) notes.push('The part after the website address is not a master class on this site, so the master class is not filtered.');
        if (r.sameHost === false) notes.push('This link is on another website: only its tags were read.');
        if (!r.source && !r.medium && !r.campaign) notes.push('It has no tracking tags, so every ad is included. Use the Ad link builder to make a tagged link.');
        lfMsg('Filters set: ' + (bits.join(' · ') || 'a link with no tags') + (notes.length ? '. ' + notes.join(' ') : ''), notes.length ? 'warn' : false);
        lfApply(r.filters);
      }).catch((e) => { if (e.message !== 'signed out' && my === lfSeq) lfMsg('Could not search right now. Check your connection and try again.', true); });
  }
  let lfTimer = null;
  $('findBtn').addEventListener('click', lfSearch);
  $('findInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(lfTimer); lfSearch(); } });
  $('findInput').addEventListener('paste', () => { clearTimeout(lfTimer); lfTimer = setTimeout(lfSearch, 60); });       // pasting searches by itself
  $('findInput').addEventListener('input', () => { clearTimeout(lfTimer); const t = $('findInput').value.trim(); if (!t) { lfMsg(''); lfClearSuggest(); return; } if (looksLikeLink(t) && /utm_|\/[a-z0-9-]+/i.test(t) && t.length > 12) lfTimer = setTimeout(lfSearch, 700); });
  $('findClear').addEventListener('click', () => { $('findInput').value = ''; lfMsg(''); lfClearSuggest(); state.status = ''; state.course = ''; state.campaign = ''; state.channel = ''; state.medium = ''; state.platform = ''; $('findClear').hidden = true; changed(); $('findInput').focus(); });

  /* ---------- events ---------- */
  $('winDays').addEventListener('change', (e) => { if (e.target.value === 'custom') return; state.days = e.target.value; state.from = ''; state.to = ''; changed(); });
  $('fFrom').addEventListener('change', (e) => { state.from = e.target.value; changed(); });
  $('fTo').addEventListener('change', (e) => { state.to = e.target.value; changed(); });
  $('selChannel').addEventListener('change', (e) => { state.channel = e.target.value; changed(); });
  $('selMedium').addEventListener('change', (e) => { state.medium = e.target.value; changed(); });
  $('clear').addEventListener('click', () => { $('findInput').value = ''; lfMsg(''); lfClearSuggest(); $('findClear').hidden = true; state.status = ''; state.course = ''; state.campaign = ''; state.channel = ''; state.medium = ''; state.platform = ''; state.days = '14'; state.from = ''; state.to = ''; changed(); });
  $('spend').addEventListener('input', (e) => { const v = Number(e.target.value); writeSpend(v > 0 && isFinite(v) ? v : 0); if (state.data) renderKpis(state.data); });
  document.querySelectorAll('#segMode button').forEach((b) => b.addEventListener('click', () => { state.mode = b.getAttribute('data-mode'); syncControls(); writeUrl(); redrawLocal(); }));
  [['togTotal', 'showTotal'], ['togAvg', 'showAvg'], ['togPrev', 'showPrev']].forEach((p) => $(p[0]).addEventListener('click', () => { state[p[1]] = !state[p[1]]; syncControls(); renderCharts(); }));
  $('pauseBtn').addEventListener('click', () => { state.paused = !state.paused; $('pauseBtn').textContent = state.paused ? 'Resume' : 'Pause'; paintLive(); if (!state.paused) refresh(); else { clearTimeout(timer); if (ctrl) ctrl.abort(); state.seq++; } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.paused) { state.built = false; refresh(); } });   // forms and master classes may have changed in another tab
  document.addEventListener('knoa:courses-changed', () => { state.built = false; state.sig = ''; refresh(); });     // a master class was added / deleted
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
