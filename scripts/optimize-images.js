// Shrinks the raster images that ship with the public page.
// public/logo.png is a 512x512 PNG but is only ever drawn at 34x34 css px, so it is downscaled to 2x (68px);
// favicon.png goes to 32px. Pure Node (zlib only) so no image dependency is added to the project.
// Run: node scripts/optimize-images.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Decode an 8-bit RGBA or RGB non-interlaced PNG into { w, h, px } (4 bytes per pixel, straight alpha). */
function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), name = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (name === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 6 && type !== 2)) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {                                        // Paeth
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp, d = (y * w + x) * 4;
      px[d] = line[s]; px[d + 1] = line[s + 1]; px[d + 2] = line[s + 2]; px[d + 3] = bpp === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { w, h, px };
}

/** Box-filter downscale: average every source pixel that falls inside the target pixel. Keeps hard logo edges crisp. */
function resize(src, tw, th) {
  const out = Buffer.alloc(tw * th * 4), xr = src.w / tw, yr = src.h / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * yr), y1 = Math.max(y0 + 1, Math.ceil((y + 1) * yr));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * xr), x1 = Math.max(x0 + 1, Math.ceil((x + 1) * xr));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * src.w + sx) * 4, alpha = src.px[i + 3];
        if (!alpha) continue;                                          // fully transparent pixels must not darken the edge
        r += src.px[i] * alpha; g += src.px[i + 1] * alpha; b += src.px[i + 2] * alpha; a += alpha; n++;
      }
      const d = (y * tw + x) * 4;
      if (!n) { out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0; continue; }
      out[d] = Math.round(r / a); out[d + 1] = Math.round(g / a); out[d + 2] = Math.round(b / a); out[d + 3] = Math.round(a / n);
    }
  }
  return { w: tw, h: th, px: out };
}

/** Encode RGBA as a PNG (filter 0 on every scanline, then deflate). */
function encode({ w, h, px }) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

const JOBS = [
  { file: 'logo.png', size: 68 },      // drawn at 34 css px -> 2x for a crisp result on a retina screen
  { file: 'favicon.png', size: 32 }
];

for (const job of JOBS) {
  const p = path.join(__dirname, '..', 'public', job.file);
  const before = fs.statSync(p).size;
  const img = resize(decode(fs.readFileSync(p)), job.size, job.size);
  const out = encode(img);
  fs.writeFileSync(p, out);
  console.log(`${job.file}: ${(before / 1024).toFixed(1)} KB -> ${(out.length / 1024).toFixed(1)} KB (${job.size}x${job.size})`);
}
