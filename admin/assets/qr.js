/* QR code maker used by the QR generator tab and the "QR code" button of the ad link builder.
   Runs fully in the browser (vendor/qrcode.js, MIT): the link never leaves the page, there is no third-party request,
   and the image is drawn at any size, so PNG / JPEG downloads are sharp enough for print.
   KnoaQR.draw(canvas, text, opts)        -> { px, modules }       preview / export on a canvas
   KnoaQR.download(text, opts, format)    -> Promise               format: 'png' | 'jpeg' | 'svg'
   KnoaQR.open(url, title)                -> modal with preview + download buttons (used by the link builder) */
(function () {
  'use strict';
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var LEVELS = { L: 'L', M: 'M', Q: 'Q', H: 'H' };
  var LOGO_SRC = '/logo.png', logoImg = null, logoTried = false;
  var DEFAULTS = { size: 1024, margin: 4, ecc: 'Q', fg: '#0d1211', bg: '#ffffff', logo: false };

  function loadLogo() {
    return new Promise(function (resolve) {
      if (logoImg || logoTried) return resolve(logoImg);
      logoTried = true;
      var i = new Image(); i.onload = function () { logoImg = i; resolve(i); }; i.onerror = function () { resolve(null); }; i.src = LOGO_SRC;
    });
  }

  function model(text, o) {
    if (!window.qrcode) throw new Error('QR library did not load');
    window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    var qr = window.qrcode(0, o.logo ? 'H' : LEVELS[o.ecc] || 'Q');      // a logo hides ~15% of the code: always the strongest error correction
    qr.addData(String(text), 'Byte'); qr.make();
    return qr;
  }
  function opts(o) { var r = {}, k; for (k in DEFAULTS) r[k] = o && o[k] != null ? o[k] : DEFAULTS[k]; r.size = Math.min(8192, Math.max(128, Number(r.size) || DEFAULTS.size)); r.margin = Math.min(10, Math.max(0, Number(r.margin))); return r; }

  /** Draws on `canvas`, exactly o.size pixels wide. Every dark square is a whole number of pixels, so edges stay razor sharp at any size. */
  function draw(canvas, text, o0) {
    var o = opts(o0), qr = model(text, o), n = qr.getModuleCount(), total = n + o.margin * 2;
    var mp = Math.max(1, Math.floor(o.size / total)), code = mp * total, px = Math.max(o.size, code), off = Math.floor((px - code) / 2);   // exactly the size you chose: the spare pixels widen the white border
    canvas.width = px; canvas.height = px;
    var c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.fillStyle = o.bg; c.fillRect(0, 0, px, px);
    c.fillStyle = o.fg;
    for (var r = 0; r < n; r++) for (var q = 0; q < n; q++) if (qr.isDark(r, q)) c.fillRect(off + (q + o.margin) * mp, off + (r + o.margin) * mp, mp, mp);
    if (o.logo && logoImg) {
      var box = Math.round(n * 0.22) * mp, pad = Math.max(mp, Math.round(box * 0.1)), x = Math.round((px - box) / 2);
      c.fillStyle = o.bg; roundRect(c, x - pad, x - pad, box + pad * 2, box + pad * 2, Math.round(box * 0.18)); c.fill();
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      var iw = logoImg.naturalWidth || box, ih = logoImg.naturalHeight || box, s = Math.min(box / iw, box / ih);
      c.drawImage(logoImg, x + (box - iw * s) / 2, x + (box - ih * s) / 2, iw * s, ih * s);
    }
    return { px: px, modules: n };
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function svgText(text, o0) {
    var o = opts(o0), qr = model(text, o), n = qr.getModuleCount(), total = n + o.margin * 2, d = [];
    for (var r = 0; r < n; r++) { var q = 0; while (q < n) { if (qr.isDark(r, q)) { var s = q; while (q < n && qr.isDark(r, q)) q++; d.push('M' + (s + o.margin) + ' ' + (r + o.margin) + 'h' + (q - s) + 'v1h-' + (q - s) + 'z'); } else q++; } }
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + o.size + '" height="' + o.size + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + o.bg + '"/><path fill="' + o.fg + '" d="' + d.join('') + '"/>';
    if (o.logo && logoImg) {
      var box = Math.round(n * 0.22), pad = box * 0.1, x = (total - box) / 2, cv = document.createElement('canvas'); cv.width = logoImg.naturalWidth; cv.height = logoImg.naturalHeight; cv.getContext('2d').drawImage(logoImg, 0, 0);
      out += '<rect x="' + (x - pad) + '" y="' + (x - pad) + '" width="' + (box + pad * 2) + '" height="' + (box + pad * 2) + '" rx="' + box * 0.18 + '" fill="' + o.bg + '"/><image x="' + x + '" y="' + x + '" width="' + box + '" height="' + box + '" preserveAspectRatio="xMidYMid meet" href="' + cv.toDataURL('image/png') + '"/>';
    }
    return out + '</svg>';
  }

  function save(blob, name) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000);
  }
  function fileName(base, ext, o) { return (base || 'knoalabs-qr').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) + '.' + ext; }

  function download(text, o0, format, base) {
    var o = opts(o0);
    return (o.logo ? loadLogo() : Promise.resolve(null)).then(function () {
      if (format === 'svg') { save(new Blob([svgText(text, o)], { type: 'image/svg+xml' }), fileName(base, 'svg', o)); return { px: o.size }; }
      var cv = document.createElement('canvas'), info = draw(cv, text, o), jpeg = format === 'jpeg';
      return new Promise(function (resolve, reject) {
        cv.toBlob(function (b) { if (!b) return reject(new Error('Could not create the image. Try a smaller size.')); save(b, fileName(base, jpeg ? 'jpg' : 'png', o)); resolve(info); }, jpeg ? 'image/jpeg' : 'image/png', 0.98);   // PNG is lossless; JPEG at 98% quality
      });
    });
  }

  /* ---------- modal used from the ad link builder ---------- */
  function open(url, title, base) {
    var back = el('div', 'kmodal-back'), box = el('div', 'kmodal qrmodal'), prev = document.activeElement;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'qrmTitle');
    var h = el('h3', null, title || 'QR code'); h.id = 'qrmTitle';
    var cv = el('canvas', 'qr-canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'QR code for ' + url);
    var u = el('div', 'kmodal-detail', url), row = el('div', 'kmodal-row'), msg = el('p', 'qr-msg');
    var close = el('button', 'kbtn', 'Close'), png = el('button', 'kbtn primary', 'Download PNG'), jpg = el('button', 'kbtn', 'Download JPEG'), more = el('a', 'kbtn', 'More options');
    close.type = png.type = jpg.type = 'button'; more.href = '/admin/qr?link=' + encodeURIComponent(url);
    row.appendChild(close); row.appendChild(more); row.appendChild(jpg); row.appendChild(png);
    box.appendChild(h); box.appendChild(cv); box.appendChild(u); box.appendChild(msg); box.appendChild(row); back.appendChild(box); document.body.appendChild(back);
    try { draw(cv, url, { size: 640 }); } catch (e) { msg.textContent = e.message; }
    function done() { document.removeEventListener('keydown', key, true); back.remove(); if (prev && prev.focus) prev.focus(); }
    function key(e) { if (e.key === 'Escape') { e.preventDefault(); done(); } }
    document.addEventListener('keydown', key, true);
    back.addEventListener('mousedown', function (e) { if (e.target === back) done(); });
    close.addEventListener('click', done);
    [[png, 'png'], [jpg, 'jpeg']].forEach(function (p) {
      p[0].addEventListener('click', function () {
        p[0].disabled = true;
        download(url, { size: 2048, ecc: 'Q' }, p[1], base).then(function (i) { if (window.KnoaUI) window.KnoaUI.toast('QR saved (' + i.px + ' × ' + i.px + ' px)'); })
          .catch(function (e) { msg.textContent = e.message; }).then(function () { p[0].disabled = false; });
      });
    });
    png.focus();
  }

  window.KnoaQR = { draw: draw, download: download, open: open, loadLogo: loadLogo, DEFAULTS: DEFAULTS };
})();
