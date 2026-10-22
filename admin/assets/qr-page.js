/* QR generator tab: link (built with tags, or any link) -> live preview -> PNG / JPEG / SVG download. Text only, never innerHTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var UI = window.KnoaUI, QR = window.KnoaQR;
  var st = { mode: 'build', url: '', builder: { course: null, source: 'meta', medium: '', campaign: '' } };
  var bld = null, base = location.origin, info = null;

  function opts() { return { size: Number($('optSize').value), ecc: $('optEcc').value, fg: $('optFg').value, margin: Number($('optMargin').value), logo: $('optLogo').checked }; }
  function fileBase() {
    var b = st.builder, k = window.KnoaBuilder.clean;
    if (st.mode === 'any') { try { return 'knoalabs-qr-' + new URL(st.url).hostname; } catch (e) { return 'knoalabs-qr'; } }
    return 'knoalabs-qr-' + (b.course || 'general') + (b.campaign ? '-' + k(b.campaign) : '') + '-' + k(b.source);
  }
  function currentUrl() { return st.mode === 'any' ? $('anyLink').value.trim() : (bld ? bld.url() : ''); }

  function paint() {
    st.url = currentUrl();
    $('qrUrl').textContent = st.url || '–';
    var ok = Boolean(st.url);
    /* the link, its buttons and the QR controls only appear once there is a complete link (build mode: master class + medium + campaign) */
    $('qrLinkBox').hidden = !ok; $('qrBody').hidden = !ok; $('qrWait').hidden = ok;
    $('qrWait').textContent = st.mode === 'any' ? 'Enter a link to get the QR code.' : 'Choose a master class, medium and campaign name to get the link and QR code.';
    ['dlPng', 'dlJpg', 'dlSvg', 'cpImg'].forEach(function (i) { $(i).disabled = !ok; });
    var warn = $('qrWarn'), host = '';
    try { host = new URL(/^[a-z]+:\/\//i.test(st.url) ? st.url : 'https://' + st.url).hostname; } catch (e) { host = ''; }
    var local = /^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(host) || /\.local$/.test(host);
    warn.hidden = !(ok && local);
    if (!warn.hidden) warn.textContent = 'This link points to your own computer (' + host + '). People scanning the code will not be able to open it. Open this admin panel on your live website address and make the QR code there.';
    if (!ok) { var c = $('qrCanvas'); c.width = c.height = 1; $('qrDim').textContent = ''; return; }
    try {
      var prev = QR.draw($('qrCanvas'), st.url, Object.assign(opts(), { size: 640 }));
      var big = Math.max(opts().size, prev.modules + opts().margin * 2);
      $('qrDim').textContent = 'Downloads at ' + big + ' × ' + big + ' px · ' + prev.modules + ' × ' + prev.modules + ' squares' + (prev.modules > 53 ? ' · long link: keep it short for easier scanning' : '');
    } catch (e) { $('qrDim').textContent = e.message || 'This link is too long for a QR code.'; }
  }
  function repaint() { (opts().logo ? QR.loadLogo() : Promise.resolve()).then(paint); }

  function download(format) {
    if (!st.url) return;
    var btn = format === 'png' ? $('dlPng') : format === 'jpeg' ? $('dlJpg') : $('dlSvg'); btn.disabled = true;
    QR.download(st.url, opts(), format, fileBase() + '-' + opts().size)
      .then(function (i) { UI.toast((format === 'svg' ? 'SVG' : format.toUpperCase()) + ' saved' + (i && i.px && format !== 'svg' ? ' (' + i.px + ' × ' + i.px + ' px)' : '')); })
      .catch(function (e) { UI.toast(e.message, true); }).then(function () { btn.disabled = false; });
  }
  function copyImage() {
    if (!st.url) return;
    if (!(navigator.clipboard && window.ClipboardItem && window.isSecureContext)) return UI.toast('Your browser cannot copy images here. Use Download instead.', true);
    var cv = document.createElement('canvas');
    (opts().logo ? QR.loadLogo() : Promise.resolve()).then(function () { QR.draw(cv, st.url, Object.assign(opts(), { size: 1024 })); return new Promise(function (r) { cv.toBlob(r, 'image/png'); }); })
      .then(function (b) { return navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); })
      .then(function () { UI.toast('QR image copied. Paste it in your design or message.'); }, function () { UI.toast('Could not copy the image. Use Download instead.', true); });
  }

  function setMode(m) {
    st.mode = m;
    document.querySelectorAll('#qrMode button').forEach(function (b) { var on = b.getAttribute('data-mode') === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('paneBuild').hidden = m !== 'build'; $('paneAny').hidden = m !== 'any';
    paint();
  }

  function init(courses) {
    var q = new URLSearchParams(location.search), given = (q.get('link') || '').slice(0, 1000);
    bld = window.KnoaBuilder.mount($('paneBuild'), { base: base, courses: courses, state: st.builder, onChange: function () { if (st.mode === 'build') repaint(); } });
    var row = $('linkRow'), cp = document.createElement('button'); cp.type = 'button'; cp.className = 'kbtn'; cp.textContent = 'Copy link';
    cp.addEventListener('click', function () { if (!st.url) return; UI.copy(st.url).then(function (ok) { UI.toast(ok ? 'Link copied.' : 'Could not copy automatically.', !ok); }); });
    var op = document.createElement('a'); op.className = 'kbtn'; op.textContent = 'Open link'; op.target = '_blank'; op.rel = 'noopener'; op.style.textDecoration = 'none';
    op.addEventListener('click', function (e) { if (!st.url) e.preventDefault(); else op.href = st.url; });
    row.appendChild(cp); row.appendChild(op);
    document.querySelectorAll('#qrMode button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
    $('anyLink').addEventListener('input', function () { if (st.mode === 'any') repaint(); });
    ['optSize', 'optEcc', 'optFg', 'optMargin', 'optLogo'].forEach(function (i) { $(i).addEventListener('change', repaint); });
    $('optLogo').addEventListener('change', function () { $('optEcc').disabled = this.checked; });
    $('dlPng').addEventListener('click', function () { download('png'); });
    $('dlJpg').addEventListener('click', function () { download('jpeg'); });
    $('dlSvg').addEventListener('click', function () { download('svg'); });
    $('cpImg').addEventListener('click', copyImage);
    if (given) { $('anyLink').value = given; setMode('any'); } else setMode('build');
  }

  fetch('/admin/api/me', { credentials: 'same-origin' }).then(function (r) { return r.status === 401 ? (location.replace('/admin/login'), null) : r.json(); }).then(function (m) { if (m && m.username) $('who').textContent = m.username; }).catch(function () {});
  fetch('/admin/api/courses', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { if (r.status === 401) { location.replace('/admin/login'); throw new Error('signed out'); } return r.json(); })
    .then(function (d) { if (!d.ok) throw new Error(d.error || 'Could not load the master classes'); base = d.base || base; init(d.courses); })
    .catch(function (e) { if (e.message === 'signed out') return; $('paneBuild').textContent = ''; var m = document.createElement('div'); m.className = 'ladd-msg bad'; m.textContent = 'Could not load the master classes: ' + e.message + '. You can still use any link.'; $('paneBuild').appendChild(m); init([]); });
  $('logout').addEventListener('click', function () {
    fetch('/admin/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {}).then(function () { location.replace('/admin/login'); });
  });
})();
