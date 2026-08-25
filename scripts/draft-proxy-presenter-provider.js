'use strict';

/*
 * Bounded proxy-presenter renderer: a duration in, real video bytes out.
 *
 * This is the Draft's visible speaker, and it is deliberately obviously not a
 * person. A stick figure drawn from ffmpeg primitives over a flat background,
 * with a standing "PROXY PRESENTER — NOT FINAL" label burned into every frame,
 * cannot be mistaken for Mikko or for final visuals.
 *
 * Why ffmpeg rather than a generative video model: it is already a dependency,
 * it is deterministic, it needs no GPU, it renders about 18x faster than
 * realtime, it cannot drift off the requested duration, and it never fails in
 * the interesting ways a sampler does. A Draft has to be producible for EVERY
 * run, cheaply, so reliability and exact timing beat realism. Photorealism would
 * actively hurt: the proxy must look like a placeholder.
 *
 * Motion is a small deterministic sine so pacing is watchable, and it is
 * declared heuristic. There is no lip sync and nothing here claims any.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const RENDERER = 'ffmpeg-stickman';
const RENDERER_VERSION = 'v1';
const STYLE = 'STICK_FIGURE_SILHOUETTE';
const PROXY_LABEL = 'PROXY PRESENTER — NOT FINAL';

// Motion is a visual aid, not an analysis of the audio.
const MOTION_MODEL = 'DETERMINISTIC_IDLE_SINE';
const LIP_SYNC = 'NONE';

const FPS = 30;
const CODEC = 'libx264';
const PIXEL_FORMAT = 'yuv420p';
const CRF = 26;

// Repo convention: 1080x1920 vertical, 1920x1080 horizontal.
const VERTICAL = { width: 1080, height: 1920 };
const HORIZONTAL = { width: 1920, height: 1080 };

const BACKGROUND = '0x0E1116';
const FIGURE = '0x8AB4F8';
const LABEL_COLOR = '0x5F6368';
const BEAT_COLOR = '0x9AA0A6';

const RENDER_TIMEOUT_MS = 120000;

class ProxyPresenterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProxyPresenterError';
    this.code = code;
  }
}

function fail(code, message) { throw new ProxyPresenterError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function which(binary) {
  try { execFileSync('command', ['-v', binary], { shell: '/bin/bash', stdio: 'ignore', timeout: 10000 }); return true; }
  catch (_) {
    try { execFileSync(binary, ['-version'], { stdio: 'ignore', timeout: 15000 }); return true; }
    catch (__) { return false; }
  }
}

function findFont() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function frameFor(orientation) {
  return String(orientation).toLowerCase() === 'horizontal' ? { ...HORIZONTAL } : { ...VERTICAL };
}

/* -------------------------------------------------------------- readiness -- */

function rendererReadiness() {
  const font = findFont();
  const ffmpeg = which('ffmpeg');
  const ffprobe = which('ffprobe');
  const blockers = [];
  if (!ffmpeg) blockers.push('ffmpeg is required to render the proxy presenter');
  if (!ffprobe) blockers.push('ffprobe is required to validate rendered video');
  if (!font) blockers.push('no usable TrueType font found for the proxy label');
  return {
    renderer: RENDERER,
    version: RENDERER_VERSION,
    style: STYLE,
    actionable: blockers.length === 0,
    blockers,
    font,
    fps: FPS,
    codec: CODEC,
    pixel_format: PIXEL_FORMAT,
    motion_model: MOTION_MODEL,
    lip_sync: LIP_SYNC,
    is_real_presenter: false,
    is_mikko_likeness: false,
  };
}

/* ----------------------------------------------------------------- probe --- */

function probeVideo(filePath) {
  let raw;
  try {
    raw = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', filePath], { encoding: 'utf8', timeout: 30000 });
  } catch (error) {
    fail('PROXY_PRESENTER_UNDECODABLE', `ffprobe could not decode the video: ${String(error.message).slice(0, 200)}`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { return fail('PROXY_PRESENTER_PROBE_MALFORMED', 'ffprobe returned unparseable output'); }
  const stream = (parsed.streams || []).find((s) => s.codec_type === 'video');
  if (!stream) fail('PROXY_PRESENTER_NO_VIDEO_STREAM', 'artifact carries no video stream');
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) fail('PROXY_PRESENTER_DURATION_INVALID', 'video duration missing or not positive');
  const [num, den] = String(stream.r_frame_rate || '0/1').split('/').map(Number);
  const fps = den ? num / den : 0;
  const frames = Number(stream.nb_frames);
  return {
    codec: stream.codec_name || null,
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    fps,
    frames: Number.isFinite(frames) && frames > 0 ? frames : null,
    duration_seconds: duration,
    pixel_format: stream.pix_fmt || null,
  };
}

/* ---------------------------------------------------------------- render --- */

/*
 * A stick figure built from rectangles, because ffmpeg's drawbox is exact and
 * cheap. Coordinates scale off the frame so both orientations look sane.
 */
function figureFilter(frame, font, label) {
  const cx = Math.round(frame.width / 2);
  const unit = Math.round(Math.min(frame.width, frame.height) / 20);
  const bob = `${Math.round(unit * 0.4)}*sin(2*PI*t*0.5)`;
  const swing = `${Math.round(unit * 0.25)}*sin(2*PI*t*1.2)`;
  const headSize = unit * 2;
  const headY = Math.round(frame.height * 0.22);
  const torsoY = headY + headSize;
  const torsoH = unit * 5;
  const armY = torsoY + unit;
  const armW = unit * 2.2;
  const legY = torsoY + torsoH;
  const legH = unit * 4;

  const parts = [
    // head
    `drawbox=x=${cx - headSize / 2}:y=${headY}+${bob}:w=${headSize}:h=${headSize}:color=${FIGURE}@1:t=fill`,
    // torso
    `drawbox=x=${cx - unit}:y=${torsoY}+${bob}:w=${unit * 2}:h=${torsoH}:color=${FIGURE}@1:t=fill`,
    // arms, counter-swinging so the idle reads as alive
    `drawbox=x=${cx - unit - armW}:y=${armY}+${bob}+${swing}:w=${armW}:h=${Math.round(unit * 0.55)}:color=${FIGURE}@1:t=fill`,
    `drawbox=x=${cx + unit}:y=${armY}+${bob}-${swing}:w=${armW}:h=${Math.round(unit * 0.55)}:color=${FIGURE}@1:t=fill`,
    // legs
    `drawbox=x=${cx - Math.round(unit * 0.9)}:y=${legY}+${bob}:w=${Math.round(unit * 0.55)}:h=${legH}:color=${FIGURE}@1:t=fill`,
    `drawbox=x=${cx + Math.round(unit * 0.35)}:y=${legY}+${bob}:w=${Math.round(unit * 0.55)}:h=${legH}:color=${FIGURE}@1:t=fill`,
  ];
  // The standing disclaimer is burned into every frame on purpose: a viewer or a
  // later reviewer can never mistake this track for finished visuals.
  parts.push(`drawtext=fontfile=${font}:text='${escapeText(PROXY_LABEL)}':fontcolor=${LABEL_COLOR}:fontsize=${Math.round(unit * 1.1)}:x=(w-text_w)/2:y=${Math.round(frame.height * 0.9)}`);
  if (label) {
    parts.push(`drawtext=fontfile=${font}:text='${escapeText(label)}':fontcolor=${BEAT_COLOR}:fontsize=${Math.round(unit * 1.4)}:x=(w-text_w)/2:y=${Math.round(frame.height * 0.58)}`);
  }
  return parts.join(',');
}

// drawtext is its own little language; keep text boring and escaped.
function escapeText(text) {
  return String(text).replace(/\\/g, '').replace(/[:']/g, ' ').replace(/[^\w \-—.,]/g, '').slice(0, 80);
}

function renderProxyPresenterSegment(request) {
  const duration = Number(request?.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    fail('PROXY_PRESENTER_DURATION_REQUIRED', 'durationSeconds must be a positive number');
  }
  const outputPath = request?.outputPath;
  if (!outputPath) fail('PROXY_PRESENTER_OUTPUT_PATH_REQUIRED', 'outputPath is required');

  const readiness = rendererReadiness();
  if (!readiness.actionable) {
    fail('PROXY_PRESENTER_RENDERER_UNAVAILABLE', `renderer not actionable: ${readiness.blockers.join('; ')}`);
  }
  const frame = request.frame || frameFor(request.orientation);
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${BACKGROUND}:s=${frame.width}x${frame.height}:r=${FPS}:d=${duration.toFixed(3)}`,
      '-vf', figureFilter(frame, readiness.font, request.label),
      '-c:v', CODEC, '-preset', 'veryfast', '-crf', String(CRF), '-pix_fmt', PIXEL_FORMAT,
      target], { timeout: request.timeoutMs || RENDER_TIMEOUT_MS });
  } catch (error) {
    safeUnlink(target);
    fail('PROXY_PRESENTER_RENDER_FAILED', `ffmpeg failed: ${String(error.stderr || error.message).slice(0, 300)}`);
  }
  if (!fs.existsSync(target)) fail('PROXY_PRESENTER_OUTPUT_MISSING', 'renderer reported success but produced no file');
  if (fs.statSync(target).size === 0) { safeUnlink(target); fail('PROXY_PRESENTER_OUTPUT_EMPTY', 'renderer produced a zero-byte file'); }

  const probe = probeVideo(target);
  if (probe.width !== frame.width || probe.height !== frame.height) {
    safeUnlink(target);
    fail('PROXY_PRESENTER_RESOLUTION_MISMATCH', `rendered ${probe.width}x${probe.height}, expected ${frame.width}x${frame.height}`);
  }
  if (Math.abs(probe.fps - FPS) > 0.01) {
    safeUnlink(target);
    fail('PROXY_PRESENTER_FRAME_RATE_MISMATCH', `rendered ${probe.fps} fps, expected ${FPS}`);
  }
  if (!probe.frames || probe.frames < 1) {
    safeUnlink(target);
    fail('PROXY_PRESENTER_NO_FRAMES', 'rendered video carries no frames');
  }

  return {
    renderer: RENDERER,
    renderer_version: RENDERER_VERSION,
    style: STYLE,
    motion_model: MOTION_MODEL,
    lip_sync: LIP_SYNC,
    is_real_presenter: false,
    is_mikko_likeness: false,
    video_path: target,
    video_sha256: sha256File(target),
    bytes: fs.statSync(target).size,
    duration_seconds: probe.duration_seconds,
    requested_duration_seconds: duration,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    frames: probe.frames,
    codec: probe.codec,
    pixel_format: probe.pixel_format,
  };
}

function concatSegments(segmentPaths, targetPath, options = {}) {
  if (!segmentPaths.length) fail('PROXY_PRESENTER_NOTHING_TO_ASSEMBLE', 'no rendered segments to assemble');
  const listFile = `${targetPath}.concat.txt`;
  fs.writeFileSync(listFile, segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
      '-i', listFile, '-c', 'copy', targetPath], { timeout: options.timeoutMs || 300000 });
  } catch (error) {
    fail('PROXY_PRESENTER_ASSEMBLE_FAILED', `ffmpeg concat failed: ${String(error.message).slice(0, 200)}`);
  } finally {
    try { fs.rmSync(listFile); } catch (_) { /* best effort */ }
  }
  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size === 0) {
    fail('PROXY_PRESENTER_ASSEMBLE_EMPTY', 'assembled presenter video is missing or empty');
  }
  return probeVideo(targetPath);
}

function safeUnlink(file) {
  try { if (file && fs.existsSync(file)) fs.rmSync(file); } catch (_) { /* best effort */ }
}

module.exports = {
  RENDERER,
  RENDERER_VERSION,
  STYLE,
  PROXY_LABEL,
  MOTION_MODEL,
  LIP_SYNC,
  FPS,
  CODEC,
  PIXEL_FORMAT,
  VERTICAL,
  HORIZONTAL,
  ProxyPresenterError,
  sha256File,
  findFont,
  frameFor,
  rendererReadiness,
  probeVideo,
  figureFilter,
  renderProxyPresenterSegment,
  concatSegments,
};
