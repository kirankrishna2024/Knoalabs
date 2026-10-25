/* Analytics page, part 2: visitor journey (funnel + drop-off), devices, map of where registrations come from, IP and location quality.
   Data: GET /admin/api/insights (same period / master class / campaign as the filters above). Everything is inserted as text. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', host = document.getElementById('insights'), lastQs = null, data = null, world = null, states = null, timer = null, map = null, geoKey = 'today', mapKeep = null, mapShown = { reg: true, unreg: true }, listTab = 0, secs = null, sigs = {}, fitNext = true;
  if (!host) return;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sv(tag, attrs) { var n = document.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  var num = function (n) { return n == null ? '–' : Number(n).toLocaleString('en-IN'); };
  function card(title, note) { var c = el('section', 'fx-card'); c.appendChild(el('h2', null, title)); if (note) c.appendChild(el('p', 'muted small-note', note)); return c; }
  function rank(rows, empty) {
    var box = el('div', 'rank'); if (!rows || !rows.length) { box.appendChild(el('div', 'muted small-note', empty || 'Nothing yet.')); return box; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; })) || 1;
    rows.forEach(function (r) { var row = el('div', 'rank-row'), top = el('div', 'rank-top'); top.appendChild(el('span', null, r.name)); top.appendChild(el('span', null, num(r.n))); var bar = el('div', 'rank-bar'), i = el('i'); i.style.width = Math.max(2, (r.n / max) * 100) + '%'; bar.appendChild(i); row.appendChild(top); row.appendChild(bar); box.appendChild(row); });
    return box;
  }
  function scroll(box) { box.classList.add('scroll'); return box; }
  function minutes(s) { if (s == null) return '–'; if (s < 60) return s + ' sec'; var m = Math.floor(s / 60), r = s % 60; return m + ' min' + (r ? ' ' + r + ' sec' : ''); }

  /* ---------- journey ---------- */
  function journey(d) {
    var c = card('Visitor journey', 'From opening the form to registering, counted per visit (a visit = one session on the page). Only visits seen by the page tracker are included.');
    var f = el('div', 'funnel'), max = d.funnel[0].n || 1;
    d.funnel.forEach(function (s) {
      var row = el('div', 'fun-row'); row.appendChild(el('span', null, s.label));
      var bar = el('div', 'fun-bar'), i = el('i'); i.style.width = Math.max(s.n ? 2 : 0, (s.n / max) * 100) + '%'; bar.appendChild(i); row.appendChild(bar);
      var r = el('div'); r.appendChild(el('b', null, num(s.n))); if (s.pctOfPrev != null) r.appendChild(el('span', 'pc', '  ' + s.pctOfPrev + '% of the step before')); row.appendChild(r); f.appendChild(row);
    });
    c.appendChild(f);
    var g = el('div', 'grid2'); g.style.marginTop = '14px';
    var a = el('div'); a.appendChild(el('h3', 'ins-sub', 'Where people stop')); a.appendChild(el('p', 'muted small-note', 'The last field a person touched before leaving without registering.')); a.appendChild(rank(d.dropoff.lastField, 'No one has left a started form in this period.'));
    var b = el('div'); b.appendChild(el('h3', 'ins-sub', 'Fields that fail the check')); b.appendChild(el('p', 'muted small-note', 'How often a field blocked a registration attempt.')); b.appendChild(rank(d.dropoff.errors, 'No failed attempts in this period.'));
    g.appendChild(a); g.appendChild(b); c.appendChild(g);
    var t = el('div', 'grid2'); t.style.marginTop = '14px';
    var l = el('div'); l.appendChild(el('h3', 'ins-sub', 'Time from opening to registering')); l.appendChild(el('p', 'muted small-note', 'Median ' + minutes(d.timeToRegister.medianSeconds) + (d.timeToRegister.avgVisitsBeforeSignup != null ? ' · ' + d.timeToRegister.avgVisitsBeforeSignup + ' visits on average before registering' : ''))); l.appendChild(rank(d.timeToRegister.buckets.map(function (x) { return { name: x.label, n: x.n }; }), 'No data yet.'));
    var r = el('div'); r.appendChild(el('h3', 'ins-sub', 'New and returning')); var p = d.people;
    r.appendChild(el('p', 'muted small-note', 'A registration is "returning" when the same phone, e-mail or browser registered before. Nothing is merged or blocked.'));
    r.appendChild(rank([{ name: 'First registration', n: p.newPeople }, { name: 'Returning (same person)', n: p.returning }]));
    r.appendChild(el('p', 'muted small-note', num(p.visitors) + ' visitors seen · ' + num(p.returningVisitors) + ' came back'));
    t.appendChild(l); t.appendChild(r); c.appendChild(t); return c;
  }
  function devices(d) {
    var c = card('Devices and browsers', 'Of the people who registered in this period.'), g = el('div', 'grid3');
    [['Device', d.devices.type], ['System', d.devices.os], ['Browser', d.devices.browser]].forEach(function (x) { var b = el('div'); b.appendChild(el('h3', 'ins-sub', x[0])); b.appendChild(rank(x[1])); g.appendChild(b); });
    c.appendChild(g);
    var vb = el('div'); vb.style.marginTop = '12px'; vb.appendChild(el('h3', 'ins-sub', 'Browsers of everyone who opened the page')); vb.appendChild(el('p', 'muted small-note', 'Includes visitors who did not register. Links opened inside an app show as that app\u2019s own browser.')); vb.appendChild(rank(d.devices.visitorsBrowser, 'No visitors tracked in this period.')); c.appendChild(vb);
    var inapp = el('div'); inapp.style.marginTop = '12px'; inapp.appendChild(el('h3', 'ins-sub', 'Opened inside an app')); inapp.appendChild(el('p', 'muted small-note', 'Instagram, Facebook and similar apps open links in their own browser.')); inapp.appendChild(rank(d.devices.inApp, 'Nobody registered from an in-app browser in this period.')); c.appendChild(inapp); return c;
  }

  /* ---------- map ---------- */
  // Two layers that are always kept apart: people who registered (solid green dot) and visitors who opened the page and did NOT register
  // (amber ring). Each layer can be switched off. Hover / tap a circle for the numbers of both layers at that place.
  function Map2(box, svg, layers) {
    var vb = { x: 0, y: 0, w: 1000, h: 500 }, tip = el('div', 'map-tip'); tip.hidden = true; box.appendChild(tip);
    var P = function (lon, lat) { return [((lon + 180) / 360) * 1000, ((90 - lat) / 180) * 500]; };
    var maxN = 1; layers.forEach(function (L) { L.cities.forEach(function (c) { if (c.n > maxN) maxN = c.n; }); });
    var at = {}; layers.forEach(function (L) { L.cities.forEach(function (c) { var k = c.lat + '|' + c.lon; (at[k] = at[k] || {})[L.key] = c; }); });
    var dots = [], groups = {};
    layers.forEach(function (L) {                       // drawn in the order given: the first layer ends up underneath
      var g = sv('g', { 'class': 'map-layer map-' + L.key }); svg.appendChild(g); groups[L.key] = g;
      L.cities.forEach(function (c) {
        var p = P(c.lon, c.lat), dot = sv('circle', { cx: p[0], cy: p[1], 'class': 'map-dot ' + L.cls, tabindex: '0', role: 'img', 'aria-label': L.label + ': ' + c.name + ', ' + c.country + ': ' + c.n });
        dot._n = c.n; dot._s = L.key === 'unreg' ? 0.78 : 1; dot.addEventListener('mouseenter', function () { show(c, dot); }); dot.addEventListener('focus', function () { show(c, dot); }); dot.addEventListener('click', function () { show(c, dot); });
        g.appendChild(dot); dots.push(dot);
      });
    });
    function show(c, dot) {
      dots.forEach(function (x) { x.classList.toggle('on', x === dot); });
      var both = at[c.lat + '|' + c.lon] || {}, parts = [];
      layers.forEach(function (L) { var h = both[L.key]; if (h) parts.push(num(h.n) + ' ' + L.noun); });      // registered first
      tip.textContent = c.name + (c.region ? ', ' + c.region : '') + ', ' + c.country + ': ' + parts.join(' · '); tip.hidden = false;
    }
    function apply() {
      svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map(function (n) { return n.toFixed(2); }).join(' '));
      var k = vb.w / 1000; dots.forEach(function (d) { d.setAttribute('r', ((3 + Math.sqrt(d._n / maxN) * 11) * (d._s || 1) * Math.max(k, 0.04)).toFixed(2)); });
    }
    function clamp() { vb.w = Math.min(1000, Math.max(8, vb.w)); vb.h = vb.w / 2; vb.x = Math.min(1000 - vb.w, Math.max(0, vb.x)); vb.y = Math.min(500 - vb.h, Math.max(0, vb.y)); }
    function zoom(f, cx, cy) { var nw = vb.w * f; cx = cx == null ? vb.x + vb.w / 2 : cx; cy = cy == null ? vb.y + vb.h / 2 : cy; var rx = (cx - vb.x) / vb.w, ry = (cy - vb.y) / vb.h; vb.w = nw; vb.h = nw / 2; vb.x = cx - rx * vb.w; vb.y = cy - ry * vb.h; clamp(); apply(); }
    function view(x, y, w) { vb.x = x; vb.y = y; vb.w = w; vb.h = w / 2; clamp(); apply(); }
    var drag = null;
    box.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('.map-dot')) return; drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y }; try { box.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } });
    box.addEventListener('pointermove', function (e) { if (!drag) return; var r = svg.getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height); vb.x = drag.vx - (e.clientX - drag.x) * s; vb.y = drag.vy - (e.clientY - drag.y) * s; clamp(); apply(); });
    box.addEventListener('pointerup', function () { drag = null; }); box.addEventListener('pointercancel', function () { drag = null; });
    box.addEventListener('wheel', function (e) { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); var r = svg.getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height); zoom(e.deltaY < 0 ? 0.8 : 1.25, vb.x + (e.clientX - r.left) * s, vb.y + (e.clientY - r.top) * s); }, { passive: false });
    box.addEventListener('dblclick', function (e) { var r = svg.getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height); zoom(0.5, vb.x + (e.clientX - r.left) * s, vb.y + (e.clientY - r.top) * s); });
    box.tabIndex = 0; box.setAttribute('role', 'application'); box.setAttribute('aria-label', 'Map of registered people and visitors who did not register. Arrow keys move, plus and minus zoom.');
    box.addEventListener('keydown', function (e) {
      var st = vb.w * 0.15; if (e.key === 'ArrowLeft') vb.x -= st; else if (e.key === 'ArrowRight') vb.x += st; else if (e.key === 'ArrowUp') vb.y -= st; else if (e.key === 'ArrowDown') vb.y += st; else if (e.key === '+' || e.key === '=') return zoom(0.7), e.preventDefault(); else if (e.key === '-') return zoom(1.4), e.preventDefault(); else return;
      clamp(); apply(); e.preventDefault();
    });
    apply();
    var shown = {}; layers.forEach(function (L) { shown[L.key] = true; });
    return { zoom: zoom, view: view, getView: function () { return { x: vb.x, y: vb.y, w: vb.w }; }, world: function () { view(0, 0, 1000); }, india: function () { view(676, 136, 110); },
      layer: function (key, on) { shown[key] = on; mapKeep && (mapKeep.layers = mapKeep.layers || {}, mapKeep.layers[key] = on); groups[key].style.display = on ? '' : 'none'; if (!on) tip.hidden = true; },
      fit: function () {
        var pts = []; layers.forEach(function (L) { if (shown[L.key]) L.cities.forEach(function (c) { pts.push(P(c.lon, c.lat)); }); });
        if (!pts.length) return; var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
        var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), w = Math.max((x1 - x0) * 1.4, (y1 - y0) * 2.8, 40);
        view((x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - w / 4, w);
      } };
  }
  /* State / province borders (admin/assets/vendor/states.json): EVERY state, province and territory of EVERY country, plus the country borders (world.json "b").
     A state is shaded green by the registered people there and amber when only visitors who did not register came from it; hover or tap gives both numbers.
     A region name from the location lookup is matched to a state by name, alias (other spellings and languages) or region code. */
  function norm(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  var NOISE = /\b(state of|state|province|region|governorate|emirate|county|district|prefecture|department|territory|municipality|division|oblast|krai|autonomous|city of)\b/g;
  function stateOf(code, name, rc) {
    var list = states && states.c && states.c[code]; if (!list || !name) return null;
    var k = norm(name), k2 = k.replace(NOISE, ' ').replace(/\s+/g, ' ').trim(), r = rc ? String(rc).toUpperCase() : '';
    for (var i = 0; i < list.length; i++) { var st = list[i]; if (st.k === k || (k2 && st.k === k2) || st.a.indexOf(k) !== -1 || (k2 && st.a.indexOf(k2) !== -1) || (r && st.c === r)) return st; }
    return null;
  }
  var cnames = null; function countryOf(code) { try { cnames = cnames || new Intl.DisplayNames(['en'], { type: 'region' }); return cnames.of(code) || code; } catch (e) { return code; } }
  function xy2ll(x, y) { return [(x / 1000) * 360 - 180, 90 - (y / 500) * 180]; }
  /* People whose lookup gave a state or a country but no city still have to be on the map: they are drawn at the middle of that state / country (named "area only"). */
  function withAreaDots(src) {
    var out = (src.cities || []).slice(), placedRegion = {}, placedCountry = {};
    out.forEach(function (c) { placedRegion[c.code + '|' + c.region] = (placedRegion[c.code + '|' + c.region] || 0) + c.n; placedCountry[c.code] = (placedCountry[c.code] || 0) + c.n; });
    var regionSum = {};
    (src.regions || []).forEach(function (r) {
      regionSum[r.code] = (regionSum[r.code] || 0) + r.n;
      var rem = r.n - (placedRegion[r.code + '|' + r.name] || 0); if (rem <= 0) return;
      var st = stateOf(r.code, r.name, r.rc), pt = st && st.x != null ? [st.x, st.y] : (states && states.m && states.m[r.code]); if (!pt) return;
      var ll = xy2ll(pt[0], pt[1]); out.push({ name: (st ? st.n : r.name) + ' (area only)', region: '', code: r.code, country: r.country, lat: ll[1], lon: ll[0], n: rem, area: true });
      placedCountry[r.code] = (placedCountry[r.code] || 0) + rem;
    });
    (src.countries || []).forEach(function (c) {
      var rem = c.n - (placedCountry[c.code] || 0); if (rem <= 0 || !(states && states.m && states.m[c.code])) return;
      var pt = states.m[c.code], ll = xy2ll(pt[0], pt[1]); out.push({ name: c.name + ' (country only)', region: '', code: c.code, country: c.name, lat: ll[1], lon: ll[0], n: rem, area: true });
    });
    return out;
  }
  var stateTpl = null;                                   // the ~4,400 outlines are built once and copied on every redraw (cheap), not rebuilt from the path text
  function stateGroup() {
    if (stateTpl) return stateTpl.cloneNode(true);
    var grp = sv('g', { 'class': 'map-states' });
    Object.keys(states.c).forEach(function (cc) { states.c[cc].forEach(function (st) { grp.appendChild(sv('path', { d: st.d, 'class': 'map-state', 'data-id': cc + ':' + st.k, 'data-state': st.n, 'data-country': cc })); }); });
    stateTpl = grp; return grp.cloneNode(true);
  }
  function drawStates(svg, box, g, u) {
    if (!states || !states.c) return;
    var counts = {}, info = {};
    function tally(src, key) {
      (src.regions || []).forEach(function (r) {
        var st = stateOf(r.code, r.name, r.rc); if (!st) return; var id = r.code + ':' + st.k;
        (counts[id] = counts[id] || { reg: 0, unreg: 0 })[key] += r.n; info[id] = { n: st.n, cc: r.code };
      });
    }
    tally(g, 'reg'); tally(u, 'unreg');
    var max = 1; Object.keys(counts).forEach(function (k) { if (counts[k].reg > max) max = counts[k].reg; });
    var grp = stateGroup(); svg.appendChild(grp);
    Object.keys(counts).forEach(function (id) {
      var p = grp.querySelector('[data-id="' + id.replace(/"/g, '') + '"]'), c = counts[id]; if (!p) return;
      p.setAttribute('class', 'map-state' + (c.reg ? ' has' : '') + (c.unreg ? ' has-unreg' : ''));
      if (c.reg) p.style.fillOpacity = (0.25 + 0.6 * Math.sqrt(c.reg / max)).toFixed(2);
    });
    function show(e) {
      var t = e.target; if (!t || !t.getAttribute) return; var id = t.getAttribute('data-id'); if (!id) return;
      var cc = id.split(':')[0], c = counts[id] || { reg: 0, unreg: 0 }, inf = info[id], tip = box.querySelector('.map-tip'); if (!tip) return;
      var st = (states.c[cc] || []).filter(function (x) { return cc + ':' + x.k === id; })[0], parts = [];
      if (c.reg) parts.push(num(c.reg) + ' registered'); if (c.unreg) parts.push(num(c.unreg) + ' did not register');
      tip.textContent = (inf ? inf.n : st ? st.n : id) + ', ' + countryOf(cc) + (parts.length ? ': ' + parts.join(' · ') : ': nobody yet'); tip.hidden = false;
    }
    grp.addEventListener('mouseover', show); grp.addEventListener('click', show);
    if (world && world.b) svg.appendChild(sv('path', { d: world.b, 'class': 'map-borders' }));     // country borders on top of the state lines
  }
  function mapCard(d) {
    var g = d.geo, u = g.unregistered || { cities: [], countries: [], regions: [], located: 0, unknown: 0, total: 0 };
    var c = card('Where people come from', 'Approximate location of the internet connection (city level, not an address). Registered people and visitors who did not register are shown separately. Phones on mobile data often show the nearest city of the carrier.');
    var layers = [                                       // drawn in this order: registered underneath, the amber "did not register" dots on top so they are never hidden
      { key: 'reg', label: 'Registered', noun: 'registered', cls: 'reg', cities: withAreaDots(g) },
      { key: 'unreg', label: 'Did not register', noun: 'did not register', cls: 'unreg', cities: withAreaDots(u) }
    ];
    var per = el('div', 'geo-period'); per.setAttribute('role', 'group'); per.setAttribute('aria-label', 'Period of the map');
    per.appendChild(el('span', 'flabel', 'Period'));
    (g.period ? g.period.options : []).forEach(function (o) {
      var b = el('button', 'kbtn sm' + (o.key === g.period.key ? ' on' : ''), o.label); b.type = 'button'; b.setAttribute('aria-pressed', String(o.key === g.period.key));
      b.addEventListener('click', function () { if (geoKey === o.key) return; geoKey = o.key; fitNext = true; load(true); }); per.appendChild(b);
    });
    c.appendChild(per);
    var tools = el('div', 'map-tools'); c.appendChild(tools);
    var box = el('div', 'map-box'), svg = sv('svg', { viewBox: '0 0 1000 500', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'World map: green dots are registered people, amber rings are visitors who did not register' });
    box.appendChild(svg); c.appendChild(box);
    if (world) { var land = sv('path', { d: world.d, 'class': 'map-land' }); svg.appendChild(land); }
    drawStates(svg, box, g, u);
    map = Map2(box, svg, layers);
    if (!layers[0].cities.length && !layers[1].cities.length) box.appendChild(el('div', 'map-empty', 'Nobody with a known location in "' + ((g.period && g.period.label) || 'this period') + '". Try Last 7 days, Last 14 days or All time above.'));
    var keep = mapKeep;
    var mk = function (t, label, fn) { var b = el('button', 'kbtn sm', t); b.type = 'button'; b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; };
    var legend = el('div', 'map-legend'); legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', 'Map layers');
    function toggle(key, cls, text, n) {
      var b = el('button', 'map-key on ' + cls); b.type = 'button'; b.setAttribute('aria-pressed', 'true'); b.appendChild(el('i', 'sw')); b.appendChild(el('span', null, text + ' (' + num(n) + ')'));
      b.addEventListener('click', function () { var on = b.getAttribute('aria-pressed') !== 'true'; mapShown[key] = on; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); map.layer(key, on); });
      if (mapShown[key] === false) { b.setAttribute('aria-pressed', 'false'); b.classList.remove('on'); map.layer(key, false); }
      legend.appendChild(b);
    }
    toggle('reg', 'reg', 'Registered', g.located); toggle('unreg', 'unreg', 'Did not register', u.located);
    c.insertBefore(legend, tools);
    tools.appendChild(mk('World', 'Show the whole world', function () { map.world(); })); tools.appendChild(mk('India', 'Zoom to India', function () { map.india(); })); tools.appendChild(mk('Fit to data', 'Zoom to the people on the map', function () { map.fit(); }));
    tools.appendChild(mk('+', 'Zoom in', function () { map.zoom(0.6); })); tools.appendChild(mk('−', 'Zoom out', function () { map.zoom(1.6); }));
    tools.appendChild(el('span', 'zhint', 'Drag to move · double-click or + to zoom')); if (window.KnoaFS) tools.appendChild(window.KnoaFS.button(c, function () {}));
    c.appendChild(el('p', 'muted small-note', num(g.located) + ' of ' + num(g.total) + ' registrations (' + ((g.period && g.period.label) || 'this period').toLowerCase() + ') have a location' + (g.exactLocated ? ' (' + num(g.exactLocated) + ' shared their exact browser location)' : '') + ' · ' + num(u.located) + ' of ' + num(u.total) + ' visitors who did not register have a location. Unknown = location lookup off, failed, or a private address.'));
    /* top places: a switch between the two groups */
    var seg = el('div', 'seg compact'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Show places for'); seg.style.margin = '10px 0 0';
    var lists = el('div', 'grid3'); lists.style.marginTop = '10px';
    function fillLists(src, word) {
      lists.textContent = '';
      var a = el('div'); a.appendChild(el('h3', 'ins-sub', 'Countries')); a.appendChild(scroll(rank(src.countries.slice(0, 80).map(function (x) { return { name: x.name, n: x.n }; }), 'No ' + word + ' locations yet.')));
      var b = el('div'); b.appendChild(el('h3', 'ins-sub', 'States / regions')); b.appendChild(scroll(rank(src.regions.slice(0, 300).map(function (x) { return { name: x.name + ', ' + x.country, n: x.n }; }), 'No ' + word + ' locations yet.')));
      var e = el('div'); e.appendChild(el('h3', 'ins-sub', 'Cities')); e.appendChild(scroll(rank(src.cities.slice(0, 200).map(function (x) { return { name: x.name + (x.region ? ', ' + x.region : ''), n: x.n }; }), 'No ' + word + ' locations yet.')));
      lists.appendChild(a); lists.appendChild(b); lists.appendChild(e);
    }
    [['Registered', g, 'registered'], ['Did not register', u, 'unregistered']].forEach(function (t, i) {
      var b = el('button', i === listTab ? 'on' : '', t[0]); b.type = 'button'; b.setAttribute('aria-pressed', i === listTab ? 'true' : 'false');
      b.addEventListener('click', function () { Array.prototype.forEach.call(seg.children, function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); listTab = i; fillLists(t[1], t[2]); });
      seg.appendChild(b);
    });
    fillLists(listTab ? u : g, listTab ? 'unregistered' : 'registered'); c.appendChild(seg); c.appendChild(lists);
    if (fitNext || !keep) { if (layers[0].cities.length || layers[1].cities.length) map.fit(); fitNext = false; } else map.view(keep.x, keep.y, keep.w);   // a refresh keeps the zoom and position
    mapKeep = Object.assign({}, map.getView());
    box.addEventListener('pointerup', function () { mapKeep = Object.assign({}, map.getView()); }); box.addEventListener('wheel', function () { setTimeout(function () { mapKeep = Object.assign({}, map.getView()); }, 0); }, { passive: true }); box.addEventListener('dblclick', function () { mapKeep = Object.assign({}, map.getView()); }); box.addEventListener('keyup', function () { mapKeep = Object.assign({}, map.getView()); });
    tools.addEventListener('click', function () { setTimeout(function () { mapKeep = Object.assign({}, map.getView()); }, 0); });
    return c;
  }

  /* ---------- IP and location quality ---------- */
  function ipCard(d) {
    var ip = d.ip, c = card('IP and location quality', 'IP addresses are shown masked and never stored in full. A location lookup runs after the registration is saved, so it can never block one.');
    var tiles = el('div', 'ip-grid');
    function tile(v, l) { var t = el('div', 'ip-k'); t.appendChild(el('b', null, v)); t.appendChild(el('span', null, l)); tiles.appendChild(t); }
    var h = ip.health;
    tile(ip.enabled ? 'On' : 'Off', 'Location lookup (' + (h ? h.provider : 'none') + ')');
    if (h && h.usedToday != null) tile(num(h.usedToday) + ' / ' + num(h.dailyLimit), 'Provider calls today / daily limit');
    if (h && h.cacheHitRate != null) tile(h.cacheHitRate + '%', 'Answered from the cache');
    tile(d.geo.total ? Math.round((d.geo.located / d.geo.total) * 100) + '%' : '–', 'Registrations with a location');
    tile(num(ip.hosting), 'From data centres / VPNs (likely not a person)');
    tile(num(ip.mismatch) + (ip.mismatchPct != null ? ' (' + ip.mismatchPct + '%)' : ''), 'Phone country differs from IP country');
    tile(num(ip.v6), 'On IPv6');
    c.appendChild(tiles);
    if (h && h.breakerOpen) { var w = el('p', 'pill bad', 'Lookups are paused for a few minutes after repeated provider errors.'); c.appendChild(w); }
    var g = el('div', 'grid2');
    var a = el('div'); a.appendChild(el('h3', 'ins-sub', 'Lookup results')); a.appendChild(rank(ip.status.map(function (x) { return { name: x.name.replace(/_/g, ' '), n: x.n }; }), 'No registrations in this period.'));
    var b = el('div'); b.appendChild(el('h3', 'ins-sub', 'Internet providers')); b.appendChild(rank(ip.orgs.map(function (x) { return { name: x.name + (x.hosting ? '  ⚠ data centre' : ''), n: x.n }; }), 'No provider data (free lookups do not always include it).'));
    g.appendChild(a); g.appendChild(b); c.appendChild(g);
    c.appendChild(el('h3', 'ins-sub', 'Latest registrations'));
    var wrap = el('div', 'table-wrap'), t = el('table', 'tbl mini fxtbl'), hd = el('thead'), hr = el('tr');
    ['When', 'IP (masked)', 'Place', 'Provider', 'Master class', 'Checks'].forEach(function (x) { hr.appendChild(el('th', null, x)); }); hd.appendChild(hr); t.appendChild(hd);
    var tb = el('tbody');
    ip.recent.forEach(function (r) {
      var tr = el('tr'); tr.appendChild(el('td', 'nowrap', new Date(r.at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })));
      tr.appendChild(el('td', null, (r.ip || '–') + (r.version === 6 ? ' (v6)' : ''))); tr.appendChild(el('td', null, [r.city, r.region, r.country].filter(Boolean).join(', ') || (r.status ? r.status.replace(/_/g, ' ') : '–')));
      tr.appendChild(el('td', null, r.org || '–')); tr.appendChild(el('td', null, r.course || '–'));
      var tdc = el('td'); if (r.hosting) tdc.appendChild(el('span', 'pill warn', 'data centre')); if (r.mismatch) tdc.appendChild(el('span', 'pill warn', 'country differs')); if (r.returning) tdc.appendChild(el('span', 'pill', 'returning')); if (!tdc.childNodes.length) tdc.appendChild(el('span', 'pill good', 'looks normal')); tr.appendChild(tdc); tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); c.appendChild(wrap);
    if (!ip.recent.length) c.appendChild(el('div', 'empty', 'No registrations in this period.'));
    return c;
  }

  function section(key, build, sig) {
    if (!secs[key]) { secs[key] = document.createElement('div'); host.appendChild(secs[key]); }
    if (sigs[key] === sig) return;                                         // nothing changed: leave the card (and any zoom or hover on it) alone
    if (secs[key].querySelector('.fx-card.fs-open')) return;               // open full screen: redraw once it is closed
    secs[key].textContent = ''; secs[key].appendChild(build()); sigs[key] = sig;
  }
  function render(d) {
    if (!secs) { secs = {}; host.textContent = ''; host.appendChild(el('h2', 'ins-h', 'Visitors, devices and locations')); }
    var ipSig = JSON.stringify(d.ip, function (k, v) { return k === 'health' ? undefined : v; });
    section('journey', function () { return journey(d); }, JSON.stringify([d.funnel, d.dropoff, d.timeToRegister, d.people]));
    section('devices', function () { return devices(d); }, JSON.stringify(d.devices));
    section('map', function () { return mapCard(d); }, JSON.stringify([d.geo, geoKey]));
    section('ip', function () { return ipCard(d); }, ipSig);
  }
  function query() {
    var q = new URLSearchParams(location.search), p = new URLSearchParams();
    ['status', 'course', 'campaign', 'channel', 'medium', 'platform', 'from', 'to'].forEach(function (k) { if (q.get(k)) p.set(k, q.get(k)); }); if (q.get('days')) p.set('days', q.get('days'));
    p.set('geo', geoKey);
    return p.toString();
  }
  function load(force) {
    var qs = query(); if (!force && qs === lastQs && data && Date.now() - data.at < 5000) return;
    lastQs = qs;
    var p = world ? Promise.resolve() : fetch('/admin/assets/vendor/world.json', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (w) { world = w; }, function () { world = null; });
    if (!states) p = p.then(function () { return fetch('/admin/assets/vendor/states.json', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (x) { states = x; }, function () { states = null; }); });
    p.then(function () { return fetch('/admin/api/insights?' + qs, { credentials: 'same-origin', cache: 'no-store' }); }).then(function (r) { if (r.status === 401) { location.replace('/admin/login'); throw new Error('signed out'); } return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || 'failed'); data = d; data.at = Date.now(); render(d); }, function (e) { if (!host.firstChild) host.appendChild(el('p', 'muted', 'Could not load the visitor insights (' + e.message + '). They retry automatically.')); });
  }
  load(true); timer = setInterval(function () { if (!document.hidden) load(false); }, 3000);
  window.__insights = { reload: function () { load(true); } };
  void timer;
})();
