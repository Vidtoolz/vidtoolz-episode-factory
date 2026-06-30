/*
 * VIDTOOLZ media provenance + lightweight validation helpers.
 *
 * Builds manifest entries that always carry explicit provenance (local vs
 * manual_external; which provider/host) and normalizes legacy entries that
 * predate provenance. Dependency-free: image dimensions are read from file
 * headers in pure JS (no new packages); video validation reuses the project's
 * existing ffprobe helper, injected by the caller.
 */

const fs = require('fs');
const path = require('path');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv'];

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const TARGET_FPS = 30;

function extname(p) {
  return path.extname(String(p || '')).toLowerCase();
}
function isImageFile(p) {
  return IMAGE_EXTS.includes(extname(p));
}
function isVideoFile(p) {
  return VIDEO_EXTS.includes(extname(p));
}

// ── Pure-JS image dimensions (png/jpeg/gif/webp). Returns {width,height} or null.
function imageDimensionsFromBuffer(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG: \x89PNG\r\n\x1a\n then IHDR(width,height) big-endian at 16/20.
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: "GIF8" then logical screen width/height little-endian at 6/8.
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WEBP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    const fourcc = buf.toString('ascii', 12, 16);
    if (fourcc === 'VP8X' && buf.length >= 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      // lossy: width/height are 14-bit at offset 26/28 (little-endian, masked).
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      if (w && h) return { width: w, height: h };
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      const w = 1 + (b & 0x3fff);
      const h = 1 + ((b >> 14) & 0x3fff);
      return { width: w, height: h };
    }
    return null;
  }
  // JPEG: scan SOF markers.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off += 1; continue; }
      const marker = buf[off + 1];
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(off + 5);
        const width = buf.readUInt16BE(off + 7);
        return { width, height };
      }
      const segLen = buf.readUInt16BE(off + 2);
      if (segLen < 2) break;
      off += 2 + segLen;
    }
  }
  return null;
}

function imageDimensions(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      return imageDimensionsFromBuffer(buf.subarray(0, bytes));
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return null;
  }
}

// ── Validation: collect warnings (never hard-reject external media; Mikko decides).
function validateImage(filePath) {
  const dims = imageDimensions(filePath);
  const warnings = [];
  if (!dims) {
    warnings.push('Could not read image dimensions.');
    return { width: null, height: null, warnings };
  }
  if (dims.width !== TARGET_WIDTH || dims.height !== TARGET_HEIGHT) {
    warnings.push(`Resolution ${dims.width}x${dims.height} is not the target ${TARGET_WIDTH}x${TARGET_HEIGHT}.`);
  }
  if (dims.height <= dims.width) {
    warnings.push('Image is not vertical (portrait 9:16 expected).');
  }
  return { width: dims.width, height: dims.height, warnings };
}

// Validate a video using the project's existing ffprobe helper (injected).
// ffprobe(filePath) should return { duration, codec, resolution: "WxH", frameRate, audioPresent, metadataUnavailable }.
function validateVideo(filePath, ffprobe) {
  const warnings = [];
  let meta = null;
  if (typeof ffprobe === 'function') {
    try { meta = ffprobe(filePath); } catch (e) { meta = null; }
  }
  if (!meta || meta.metadataUnavailable) {
    warnings.push('Could not read video metadata (ffprobe unavailable or failed).');
    return { width: null, height: null, fps: null, codec: null, duration: null, warnings };
  }
  let width = null;
  let height = null;
  if (typeof meta.resolution === 'string' && /^\d+x\d+$/.test(meta.resolution)) {
    const [w, h] = meta.resolution.split('x').map(Number);
    width = w; height = h;
  }
  const fps = Number(meta.frameRate) || null;
  const codec = meta.codec || null;
  if (width !== null && (width !== TARGET_WIDTH || height !== TARGET_HEIGHT)) {
    warnings.push(`Resolution ${width}x${height} is not the target ${TARGET_WIDTH}x${TARGET_HEIGHT}.`);
  }
  if (height !== null && height <= width) {
    warnings.push('Video is not vertical (portrait 9:16 expected).');
  }
  if (fps !== null && Math.abs(fps - TARGET_FPS) > 1) {
    warnings.push(`Frame rate ${fps}fps is not the target ${TARGET_FPS}fps.`);
  }
  if (codec && !/h264|avc/i.test(codec)) {
    warnings.push(`Codec ${codec} is not h264 — confirm Resolve compatibility.`);
  }
  return { width, height, fps, codec, duration: meta.duration || null, warnings };
}

// Infer provenance for a media file that has no explicit record yet, from its
// path/source hints. Used for backward compatibility with legacy manifests.
function inferProvenance(relPath, hint) {
  const p = String(relPath || '').toLowerCase();
  const h = String(hint || '').toLowerCase();
  if (/flux-local|flux-/.test(p) || h === 'flux-local') {
    return { generation_mode: 'local', generation_provider: 'flux', generation_host: 'vidnux', variant: 'flux-local' };
  }
  if (/videos\/mp4|wan22|wan-/.test(p) || h === 'wan22') {
    return { generation_mode: 'local', generation_provider: 'wan22', generation_host: 'presto', variant: 'wan22-local' };
  }
  if (/gpt-manual|gpt[-_]/.test(p) || h === 'gpt' || h === 'gpt_manual') {
    return { generation_mode: 'manual_external', generation_provider: 'gpt_manual', generation_host: 'external_browser', variant: 'gpt-manual' };
  }
  if (/kling/.test(p) || h === 'klingai' || h === 'klingai_manual') {
    return { generation_mode: 'manual_external', generation_provider: 'klingai_manual', generation_host: 'external_browser', variant: 'klingai-manual' };
  }
  return { generation_mode: 'unknown', generation_provider: 'unknown_manual', generation_host: 'unknown', variant: 'manual-import' };
}

module.exports = {
  IMAGE_EXTS,
  VIDEO_EXTS,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  TARGET_FPS,
  extname,
  isImageFile,
  isVideoFile,
  imageDimensions,
  imageDimensionsFromBuffer,
  validateImage,
  validateVideo,
  inferProvenance,
};
