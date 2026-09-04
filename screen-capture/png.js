'use strict';
// Minimal dependency-free PNG reader: CRC-checked chunk walk (structure) and a
// decoder for 8-bit RGB/RGBA/grey non-interlaced images (pixel QC). Used by QC
// to look at rendered pixels instead of trusting metadata.
const fs = require('node:fs');
const zlib = require('node:zlib');

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function parse(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(SIG)) throw new Error('PNG_SIGNATURE_INVALID');
  let at = 8; let width = null; let height = null; let bitDepth = null; let colorType = null; let interlace = null; let hasIend = false; const idat = [];
  while (at + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(at); const type = bytes.subarray(at + 4, at + 8).toString('ascii');
    if (at + 12 + len > bytes.length) throw new Error('PNG_TRUNCATED');
    if (crc32(bytes.subarray(at + 4, at + 8 + len)) !== bytes.readUInt32BE(at + 8 + len)) throw new Error('PNG_CRC_INVALID');
    if (type === 'IHDR') { width = bytes.readUInt32BE(at + 8); height = bytes.readUInt32BE(at + 12); bitDepth = bytes[at + 16]; colorType = bytes[at + 17]; interlace = bytes[at + 20]; }
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + len));
    if (type === 'IEND') { hasIend = true; break; }
    at += 12 + len;
  }
  if (!width || !height || !hasIend) throw new Error('PNG_STRUCTURE_INVALID');
  return { width, height, bitDepth, colorType, interlace, idat, bytes: bytes.length };
}
function parseFile(file) { return parse(fs.readFileSync(file)); }

// Decodes to { width, height, channels, data(Uint8Array) } for 8-bit non-interlaced images.
function decode(bytes) {
  const info = parse(bytes);
  if (info.bitDepth !== 8 || info.interlace !== 0) throw new Error('PNG_UNSUPPORTED_ENCODING');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[info.colorType];
  if (!channels) throw new Error('PNG_UNSUPPORTED_COLOR_TYPE');
  const raw = zlib.inflateSync(Buffer.concat(info.idat));
  const stride = info.width * channels; const out = new Uint8Array(stride * info.height);
  let pos = 0;
  for (let y = 0; y < info.height; y += 1) {
    const filter = raw[pos]; pos += 1;
    const row = raw.subarray(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null; const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0; const b = prev ? prev[i] : 0; const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = row[i];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error('PNG_FILTER_INVALID');
      cur[i] = v & 255;
    }
  }
  return { width: info.width, height: info.height, channels, data: out };
}
function luma(img, x, y) {
  const i = (y * img.width + x) * img.channels;
  if (img.channels < 3) return img.data[i];
  return Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
}
// Region statistics: mean/stddev luma and the estimated text glyph height from
// bright-row runs (rows whose bright-pixel count exceeds a threshold).
function regionStats(img, box, { brightThreshold = 150, minBrightPerRow = 3 } = {}) {
  const x0 = Math.max(0, box.x); const y0 = Math.max(0, box.y); const x1 = Math.min(img.width, box.x + box.width); const y1 = Math.min(img.height, box.y + box.height);
  let sum = 0; let sumSq = 0; let n = 0; const rows = [];
  for (let y = y0; y < y1; y += 1) { let bright = 0; for (let x = x0; x < x1; x += 1) { const l = luma(img, x, y); sum += l; sumSq += l * l; n += 1; if (l > brightThreshold) bright += 1; } rows.push(bright >= minBrightPerRow); }
  const mean = n ? sum / n : 0; const stddev = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;
  const runs = []; let run = 0;
  for (const r of rows) { if (r) run += 1; else if (run) { runs.push(run); run = 0; } }
  if (run) runs.push(run);
  const glyphRuns = runs.filter((r) => r >= 4).sort((a, b) => a - b);
  return { mean, stddev, bright_row_runs: runs.length, median_glyph_run_px: glyphRuns.length ? glyphRuns[Math.floor(glyphRuns.length / 2)] : 0, max_glyph_run_px: glyphRuns.length ? glyphRuns[glyphRuns.length - 1] : 0 };
}

module.exports = { parse, parseFile, decode, luma, regionStats, crc32 };
