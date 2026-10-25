// Response compression with Node's built-in zlib (no extra dependency).
// Text is the whole cost of this site on a phone connection, so every GET answer is compressed:
// HTML / CSS / JS / JSON / SVG. Images and the Excel export are already compressed and are skipped.
//
// `br` is offered first (smallest on modern browsers), then `gzip`. Responses below MIN_BYTES are
// not worth the CPU, and anything larger than MAX_BUFFER (the Excel export) streams through untouched.
'use strict';
const zlib = require('zlib');

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|x-ndjson)|image\/svg\+xml)/i;
const MIN_BYTES = 1024;
const MAX_BUFFER = 8 * 1024 * 1024;           // the worldwide map outlines (states.json) are ~2.5 MB of JSON and must be compressed too

/** Best encoding the browser accepts, in our preference order. */
function pick(req) {
  const raw = String(req.headers['accept-encoding'] || '');
  if (!raw) return null;
  const offered = raw.split(',').map((part) => {
    const bits = part.trim().split(';'), name = bits[0].trim().toLowerCase();
    const q = part.match(/\bq=([0-9.]+)/i);
    return { name, q: q ? parseFloat(q[1]) : 1 };
  }).filter((e) => e.name && e.q > 0);
  if (!offered.length) return null;
  for (const enc of ['br', 'gzip', 'deflate']) if (offered.some((e) => e.name === enc || e.name === '*')) return enc;
  return null;
}

function streamFor(enc, level) {
  if (enc === 'br') return zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } });
  if (enc === 'gzip') return zlib.createGzip({ level, memLevel: 8 });
  return zlib.createDeflate({ level });
}

function toBuffer(chunk, encoding) {
  if (Buffer.isBuffer(chunk)) return chunk;
  return Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined);
}

module.exports = function compression({ level = 6 } = {}) {
  return function (req, res, next) {
    if (req.method !== 'GET' || res.getHeader('Content-Encoding')) return next();
    if (req.path && req.path.endsWith('.xlsx')) return next();          // a zip already: never re-compress it
    const enc = pick(req);
    if (!enc) return next();

    const origWrite = res.write, origEnd = res.end;
    let buffered = [], size = 0, passthrough = false;

    function flushBuffered() { for (const c of buffered) origWrite.call(res, c); buffered = null; }

    res.write = function (chunk, encoding, callback) {
      if (passthrough) return origWrite.call(res, chunk, encoding, callback);
      if (chunk && chunk.length) { buffered.push(toBuffer(chunk, encoding)); size += chunk.length; }
      if (size > MAX_BUFFER) { passthrough = true; flushBuffered(); }   // too big to hold: hand the body straight through
      if (typeof encoding === 'function') encoding();
      else if (typeof callback === 'function') callback();
      return true;
    };

    res.end = function (chunk, encoding, callback) {
      if (passthrough) return origEnd.call(res, chunk, encoding, callback);
      res.write = origWrite; res.end = origEnd;
      if (chunk && chunk.length) { buffered.push(toBuffer(chunk, encoding)); size += chunk.length; }
      const body = Buffer.concat(buffered); buffered = null;
      const type = String(res.getHeader('Content-Type') || '');
      const status = res.statusCode;
      const canCompress = body.length >= MIN_BYTES && COMPRESSIBLE.test(type) && status >= 200 && status !== 204 && status !== 304;
      const done = typeof encoding === 'function' ? encoding : callback;
      if (!canCompress) {
        if (status !== 204 && status !== 304) res.setHeader('Content-Length', body.length);
        return done ? origEnd.call(res, body, done) : origEnd.call(res, body);
      }
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', enc);
      res.setHeader('Vary', 'Accept-Encoding');
      const out = streamFor(enc, level);
      out.on('error', () => origEnd.call(res, body));                    // a compression failure must never lose the answer
      out.pipe(res);
      out.end(body);
    };
    next();
  };
};
