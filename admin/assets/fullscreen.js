/* Full screen for a card (chart, map, table). Uses an overlay class instead of the browser Fullscreen API so it also works inside
   iframes and on phones; Esc or the button closes it. Calls onChange so a chart can redraw at the new size. */
(function () {
  'use strict';
  var open = null;
  function setOpen(card, on, onChange) {
    card.classList.toggle('fs-open', on); document.documentElement.classList.toggle('fs-lock', on);
    var b = card.querySelector('[data-fs]'); if (b) { b.textContent = on ? 'Close' : 'Full screen'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    open = on ? { card: card, onChange: onChange } : null;
    if (on) card.setAttribute('role', 'dialog'); else card.removeAttribute('role');
    if (onChange) setTimeout(onChange, 30);
    if (on && b) b.focus();
  }
  function button(card, onChange) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'kbtn sm'; b.setAttribute('data-fs', ''); b.setAttribute('aria-pressed', 'false'); b.textContent = 'Full screen';
    b.addEventListener('click', function () { setOpen(card, !card.classList.contains('fs-open'), onChange); });
    return b;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) setOpen(open.card, false, open.onChange); });
  window.addEventListener('resize', function () { if (open && open.onChange) open.onChange(); });

  /* Every other graph (donuts, ranked bars, heatmap, funnel, tables ...) gets the same Full screen button automatically, plus + / - zoom while it is open.
     Cards that already carry their own button (line charts, the map) are left alone. Cards drawn later (the visitor insights) are picked up too. */
  var SKIP = '.filterbar, .linkfind', VISUAL = 'svg, .rank, .browser-split, .heat, .heatmap, .funnel, .donut-row, table, canvas, .chart-wrap, .spark';
  function mk(text, label, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'kbtn sm'; b.textContent = text; b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; }
  function decorate(card) {
    if (card.querySelector('[data-fs]') || card.matches(SKIP) || !card.querySelector(VISUAL)) return;
    var bar = document.createElement('div'), z = 1, pct = document.createElement('span');
    bar.className = 'fs-bar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Full screen and zoom');
    pct.className = 'fs-pct'; pct.textContent = '100%';
    function setZoom(v) { z = Math.max(0.6, Math.min(3, Math.round(v * 10) / 10)); card.style.setProperty('--fs-zoom', String(z)); pct.textContent = Math.round(z * 100) + '%'; }
    var zin = mk('+', 'Zoom in', function () { setZoom(z + 0.2); }), zout = mk('−', 'Zoom out', function () { setZoom(z - 0.2); }), zreset = mk('100%', 'Reset zoom', function () { setZoom(1); });
    [zout, pct, zin, zreset].forEach(function (x) { x.classList.add('fs-z'); bar.appendChild(x); });
    bar.appendChild(button(card, function () {
      if (!card.classList.contains('fs-open')) { card.style.removeProperty('--fs-zoom'); z = 1; pct.textContent = '100%'; }
      else if (z === 1 && !card.style.getPropertyValue('--fs-zoom')) setZoom(1.4);          // a bigger first view: the point of full screen
    }));
    card.classList.add('fs-auto'); card.insertBefore(bar, card.firstChild);
  }
  var scanTimer = null;
  function scan() { scanTimer = null; Array.prototype.forEach.call(document.querySelectorAll('.fx-card'), decorate); }
  function later() { if (!scanTimer) scanTimer = setTimeout(scan, 250); }
  function start() {
    later();
    if (window.MutationObserver) new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.KnoaFS = { button: button, set: setOpen };
})();
