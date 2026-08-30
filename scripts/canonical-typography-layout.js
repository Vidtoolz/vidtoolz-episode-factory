'use strict';

/*
 * One canonical typography-fit authority for V2 VISUAL_DRAFT.
 *
 * Measurement and final rendering both use FFmpeg drawtext with this exact
 * font, size and line-spacing configuration.  The layout authority inserts
 * deterministic line breaks, including grapheme-level emergency breaks for
 * strings without whitespace, then chooses the largest fitting integer font
 * size at or above the readable minimum.  Impossible content fails closed.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LAYOUT_SCHEMA = 'vidtoolz.canonicalTypographyLayout.v1';
const FONT_FILE = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const MIN_FONT_SIZE_PX = 24;
const MAX_FONT_SIZE_PX = 128;
const DEFAULT_BACKING_PADDING_PX = 18;
const FINAL_OUTPUT_GUARD_PX = 2;
const MEASUREMENT_DOMAIN = 'VIDTOOLZ_FFMPEG_DRAWTEXT_METRICS_V1';
const measurementCache = new Map();
const renderedBoundsCache = new Map();
const baseFrameCache = new Map();

class TypographyLayoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TypographyLayoutError';
    this.code = code;
  }
}
function fail(code, message) { throw new TypographyLayoutError(code, message); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(canonicalize(value)).digest('hex'); }
function fileDigest(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function normalizeText(value) { return String(value).replaceAll('\r\n', '\n').replaceAll('\r', '\n'); }
function lineSpacing(fontSizePx) { return Math.max(2, Math.round(fontSizePx * 0.2)); }
function graphemes(value) {
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  return [...segmenter.segment(value)].map((item) => item.segment);
}

/* Actual FFmpeg drawtext metrics, batched so validation remains bounded. */
function measureTextBatch(values, fontSizePx, spacingPx = lineSpacing(fontSizePx)) {
  if (!Number.isInteger(fontSizePx) || fontSizePx < 1 || !Number.isInteger(spacingPx)) fail('COMPOSITION_TYPOGRAPHY_MEASUREMENT_FAILED', 'integer font size and line spacing required');
  if (!fs.existsSync(FONT_FILE)) fail('COMPOSITION_TYPOGRAPHY_MEASUREMENT_FAILED', `${FONT_FILE}: canonical font unavailable`);
  const normalized = values.map(normalizeText);
  const results = new Array(normalized.length);
  const missing = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const key = digest({ domain: MEASUREMENT_DOMAIN, text: normalized[index], fontSizePx, spacingPx });
    if (measurementCache.has(key)) results[index] = measurementCache.get(key);
    else missing.push({ index, key, text: normalized[index] });
  }
  if (missing.length === 0) return results.map((item) => ({ ...item }));

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vidtoolz-type-metrics-'));
  try {
    const filters = [];
    for (let offset = 0; offset < missing.length; offset += 1) {
      const item = missing[offset];
      const textPath = path.join(temporary, `text-${offset}.txt`);
      fs.writeFileSync(textPath, item.text, 'utf8');
      const marker = 1000000000 + offset * 1000000;
      filters.push(`drawtext=fontfile=${FONT_FILE}:textfile=${textPath}:fontsize=${fontSizePx}:line_spacing=${spacingPx}:text_shaping=1:expansion=none:x='print(text_w+${marker})':y='print(text_h+${marker + 500000})'`);
    }
    const run = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'info',
      '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=1',
      '-vf', filters.join(','), '-frames:v', '1', '-f', 'null', '-',
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (run.status !== 0) fail('COMPOSITION_TYPOGRAPHY_MEASUREMENT_FAILED', String(run.stderr || run.error || 'ffmpeg drawtext measurement failed').slice(0, 500));
    const printed = [...String(run.stderr).matchAll(/^\s*(-?\d+(?:\.\d+)?)\s*$/gm)].map((match) => Number(match[1]));
    for (let offset = 0; offset < missing.length; offset += 1) {
      const marker = 1000000000 + offset * 1000000;
      const widthValue = printed.find((value) => value >= marker && value < marker + 500000);
      const heightValue = printed.find((value) => value >= marker + 500000 && value < marker + 1000000);
      if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue)) fail('COMPOSITION_TYPOGRAPHY_MEASUREMENT_FAILED', `drawtext did not report metrics for item ${offset}`);
      const metric = Object.freeze({ width: Math.round(widthValue - marker), height: Math.round(heightValue - marker - 500000) });
      measurementCache.set(missing[offset].key, metric);
      results[missing[offset].index] = metric;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return results.map((item) => ({ ...item }));
}

/* Render the exact drawtext operation on a larger opaque probe surface, pass
 * through the final yuv420p domain, decode back to RGBA, and scan pixel deltas
 * from the uniform background. This captures bearings, multiline box
 * behavior, antialiasing, padding, and final chroma-domain edge spread that
 * text_w/text_h or a transparent-only probe do not describe. */
function measureRenderedBounds(text, fontSizePx, spacingPx, x, y, region, alignment, paddingPx, includeBacking) {
  const key = digest({ domain: MEASUREMENT_DOMAIN, mode: 'RGBA_BOUNDS', text, fontSizePx, spacingPx, x, y, region, alignment, paddingPx, includeBacking });
  if (renderedBoundsCache.has(key)) return { ...renderedBoundsCache.get(key) };
  const probeGuard = MAX_FONT_SIZE_PX + 64;
  const unroundedWidth = region.width + probeGuard * 2;
  const unroundedHeight = region.height + probeGuard * 2;
  const width = unroundedWidth + (unroundedWidth % 2);
  const height = unroundedHeight + (unroundedHeight % 2);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vidtoolz-type-bounds-'));
  try {
    const textPath = path.join(temporary, 'text.txt');
    fs.writeFileSync(textPath, text, 'utf8');
    const align = { LEFT: 'L', CENTER: 'C', RIGHT: 'R' }[alignment];
    const backing = includeBacking ? `:box=1:boxcolor=0x3C3C3C@0.56:boxborderw=${paddingPx}` : '';
    const filter = `format=rgba,drawtext=fontfile=${FONT_FILE}:textfile=${textPath}:fontcolor=white:fontsize=${fontSizePx}:line_spacing=${spacingPx}:text_align=${align}:text_shaping=1:expansion=none:x=${x + probeGuard}:y=${y + probeGuard}${backing},format=yuv420p,format=rgba`;
    const run = spawnSync('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x123456:s=${width}x${height}:r=1:d=1`,
      '-vf', filter, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
    ], { timeout: 60000, maxBuffer: width * height * 4 + 1024 * 1024 });
    if (run.status !== 0 || !Buffer.isBuffer(run.stdout) || run.stdout.length !== width * height * 4) fail('COMPOSITION_TYPOGRAPHY_MEASUREMENT_FAILED', String(run.stderr || run.error || `RGBA probe returned ${run.stdout?.length || 0} bytes`).slice(0, 500));
    const baseKey = `${width}x${height}`;
    let baseFrame = baseFrameCache.get(baseKey);
    if (!baseFrame) {
      const base = spawnSync('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=0x123456:s=${width}x${height}:r=1:d=1`,
        '-vf', 'format=rgba,format=yuv420p,format=rgba', '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
      ], { timeout: 60000, maxBuffer: width * height * 4 + 1024 * 1024 });
      if (base.status !== 0 || !Buffer.isBuffer(base.stdout) || base.stdout.length !== width * height * 4) fail('COMPOSITION_TYPOGRAPHY_MEASUREMENT_FAILED', String(base.stderr || base.error || `base RGBA probe returned ${base.stdout?.length || 0} bytes`).slice(0, 500));
      baseFrame = base.stdout;
      baseFrameCache.set(baseKey, baseFrame);
    }
    let minX = width; let minY = height; let maxX = -1; let maxY = -1;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const at = pixel * 4;
      if (run.stdout[at] === baseFrame[at] && run.stdout[at + 1] === baseFrame[at + 1] && run.stdout[at + 2] === baseFrame[at + 2]) continue;
      const pixelX = pixel % width; const pixelY = Math.floor(pixel / width);
      minX = Math.min(minX, pixelX); minY = Math.min(minY, pixelY); maxX = Math.max(maxX, pixelX); maxY = Math.max(maxY, pixelY);
    }
    const bounds = maxX < 0 ? null : Object.freeze({ x: minX - probeGuard, y: minY - probeGuard, width: maxX - minX + 1, height: maxY - minY + 1 });
    renderedBoundsCache.set(key, bounds);
    return bounds ? { ...bounds } : null;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function wrapParagraph(paragraph, fontSizePx, spacingPx, maximumWidthPx) {
  if (paragraph === '') return [''];
  let remaining = graphemes(paragraph);
  const lines = [];
  while (remaining.length > 0) {
    const prefixes = [];
    let candidate = '';
    for (const item of remaining) { candidate += item; prefixes.push(candidate); }
    const metrics = measureTextBatch(prefixes, fontSizePx, spacingPx);
    let fittingCount = 0;
    for (let index = 0; index < metrics.length; index += 1) {
      if (metrics[index].width <= maximumWidthPx) fittingCount = index + 1;
      else break;
    }
    if (fittingCount === 0) return null;
    if (fittingCount < remaining.length) {
      // Prefer a natural whitespace break. If no useful break exists, use the
      // largest measured grapheme prefix: URLs, hashes and long words cannot
      // escape merely because they contain no spaces.
      let whitespaceBreak = 0;
      for (let index = 1; index <= fittingCount; index += 1) {
        if (/^\s$/u.test(remaining[index - 1]) && remaining.slice(0, index).join('').trim().length > 0) whitespaceBreak = index;
      }
      if (whitespaceBreak > 0) fittingCount = whitespaceBreak;
    }
    const rawLine = remaining.slice(0, fittingCount).join('');
    const renderedLine = rawLine.replace(/\s+$/u, '');
    if (renderedLine === '' && rawLine !== '') {
      // Whitespace-only paragraphs have no visible glyphs; preserve one
      // deterministic space instead of creating an unbounded empty loop.
      lines.push(' ');
    } else lines.push(renderedLine);
    remaining = remaining.slice(fittingCount);
    while (remaining.length > 0 && /^\s$/u.test(remaining[0])) remaining.shift();
  }
  return lines;
}

function layoutAtFontSize(text, region, alignment, safeMarginPx, paddingPx, fontSizePx) {
  const spacingPx = lineSpacing(fontSizePx);
  const insetPx = Math.max(safeMarginPx, paddingPx);
  const maximumWidthPx = region.width - insetPx * 2;
  const maximumHeightPx = region.height - insetPx * 2;
  if (maximumWidthPx <= 0 || maximumHeightPx <= 0) return null;
  const lines = [];
  for (const paragraph of text.split('\n')) {
    const wrapped = wrapParagraph(paragraph, fontSizePx, spacingPx, maximumWidthPx);
    if (!wrapped) return null;
    lines.push(...wrapped);
  }
  const renderedText = lines.join('\n');
  const metrics = measureTextBatch([renderedText], fontSizePx, spacingPx)[0];
  if (metrics.width > maximumWidthPx || metrics.height > maximumHeightPx) return null;
  let x = alignment === 'LEFT'
    ? region.x + insetPx
    : alignment === 'RIGHT'
      ? region.x + region.width - insetPx - metrics.width
      : region.x + Math.floor((region.width - metrics.width) / 2);
  let y = region.y + Math.floor((region.height - metrics.height) / 2);
  const localRegion = { width: region.width, height: region.height };
  let paintedLocal = measureRenderedBounds(renderedText, fontSizePx, spacingPx, x - region.x, y - region.y, localRegion, alignment, paddingPx, true);
  if (!paintedLocal || paintedLocal.width > region.width - FINAL_OUTPUT_GUARD_PX * 2 || paintedLocal.height > region.height - FINAL_OUTPUT_GUARD_PX * 2) return null;
  let correctionX = 0; let correctionY = 0;
  if (paintedLocal.x < FINAL_OUTPUT_GUARD_PX) correctionX += FINAL_OUTPUT_GUARD_PX - paintedLocal.x;
  if (paintedLocal.x + paintedLocal.width > region.width - FINAL_OUTPUT_GUARD_PX) correctionX -= paintedLocal.x + paintedLocal.width - (region.width - FINAL_OUTPUT_GUARD_PX);
  if (paintedLocal.y < FINAL_OUTPUT_GUARD_PX) correctionY += FINAL_OUTPUT_GUARD_PX - paintedLocal.y;
  if (paintedLocal.y + paintedLocal.height > region.height - FINAL_OUTPUT_GUARD_PX) correctionY -= paintedLocal.y + paintedLocal.height - (region.height - FINAL_OUTPUT_GUARD_PX);
  x += correctionX; y += correctionY;
  if (correctionX || correctionY) paintedLocal = measureRenderedBounds(renderedText, fontSizePx, spacingPx, x - region.x, y - region.y, localRegion, alignment, paddingPx, true);
  const glyphLocal = measureRenderedBounds(renderedText, fontSizePx, spacingPx, x - region.x, y - region.y, localRegion, alignment, paddingPx, false);
  if (!paintedLocal || !glyphLocal || paintedLocal.x < FINAL_OUTPUT_GUARD_PX || paintedLocal.y < FINAL_OUTPUT_GUARD_PX || paintedLocal.x + paintedLocal.width > region.width - FINAL_OUTPUT_GUARD_PX || paintedLocal.y + paintedLocal.height > region.height - FINAL_OUTPUT_GUARD_PX) return null;
  const glyphBounds = { x: region.x + glyphLocal.x, y: region.y + glyphLocal.y, width: glyphLocal.width, height: glyphLocal.height };
  const paintedBounds = { x: region.x + paintedLocal.x, y: region.y + paintedLocal.y, width: paintedLocal.width, height: paintedLocal.height };
  return { fontSizePx, spacingPx, insetPx, renderedText, lines, drawtextOrigin: { x, y }, glyphBounds, paintedBounds };
}

function layoutTypography(typography) {
  const text = normalizeText(typography?.content ?? '');
  if (text.includes('\0')) fail('COMPOSITION_TYPOGRAPHY_TEXT_UNSUPPORTED', 'NUL is not legal canonical typography content');
  const region = typography?.region;
  if (!region || !Number.isInteger(region.width) || !Number.isInteger(region.height)) fail('COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID', 'integer region required');
  const safeMarginPx = typography.safe_margin_px;
  if (!Number.isInteger(safeMarginPx) || safeMarginPx < 0) fail('COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID', 'non-negative safe_margin_px required');
  const paddingPx = typography.backing?.padding_px ?? DEFAULT_BACKING_PADDING_PX;
  const preferredFontSizePx = Math.max(MIN_FONT_SIZE_PX, Math.min(MAX_FONT_SIZE_PX, Math.floor(region.height / 4)));
  let low = MIN_FONT_SIZE_PX;
  let high = preferredFontSizePx;
  let best = null;
  while (low <= high) {
    const candidateSize = Math.floor((low + high) / 2);
    const candidate = layoutAtFontSize(text, region, typography.alignment, safeMarginPx, paddingPx, candidateSize);
    if (candidate) { best = candidate; low = candidateSize + 1; }
    else high = candidateSize - 1;
  }
  if (!best) fail('COMPOSITION_TYPOGRAPHY_OVERFLOW', `content cannot fit ${region.width}x${region.height} region at minimum readable ${MIN_FONT_SIZE_PX}px`);
  const fontSha256 = fileDigest(FONT_FILE);
  const layout = {
    schema: LAYOUT_SCHEMA,
    measurement_authority: MEASUREMENT_DOMAIN,
    font_file: FONT_FILE,
    font_file_sha256: fontSha256,
    font_size_px: best.fontSizePx,
    minimum_font_size_px: MIN_FONT_SIZE_PX,
    maximum_font_size_px: MAX_FONT_SIZE_PX,
    line_spacing_px: best.spacingPx,
    line_count: best.lines.length,
    lines: best.lines,
    rendered_text: best.renderedText,
    normalized_content_sha256: digest(text),
    alignment: typography.alignment,
    region: { x: region.x, y: region.y, width: region.width, height: region.height },
    internal_inset_px: best.insetPx,
    backing_padding_px: paddingPx,
    final_output_guard_px: FINAL_OUTPUT_GUARD_PX,
    drawtext_origin: best.drawtextOrigin,
    glyph_bounds: best.glyphBounds,
    painted_bounds: best.paintedBounds,
  };
  layout.layout_digest_sha256 = digest(layout);
  return Object.freeze(layout);
}

function confinedPreRenderedTypography(typography) {
  const region = typography.region;
  const layout = {
    schema: LAYOUT_SCHEMA,
    measurement_authority: 'PIXEL_DOMAIN_CONFINEMENT',
    mode: 'PRE_RENDERED_CONFINED',
    normalized_content_sha256: digest(normalizeText(typography.content)),
    region: { x: region.x, y: region.y, width: region.width, height: region.height },
  };
  layout.layout_digest_sha256 = digest(layout);
  return Object.freeze(layout);
}

function assertCanonicalLayout(typography, layout) {
  if (!layout || layout.schema !== LAYOUT_SCHEMA) fail('COMPOSITION_TYPOGRAPHY_LAYOUT_REQUIRED', 'validated canonical typography layout required');
  const copy = { ...layout };
  delete copy.layout_digest_sha256;
  if (digest(copy) !== layout.layout_digest_sha256 || layout.normalized_content_sha256 !== digest(normalizeText(typography.content))) fail('COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID', 'layout digest/content binding mismatch');
  if (layout.mode !== 'PRE_RENDERED_CONFINED') {
    if (layout.font_file !== FONT_FILE || layout.font_file_sha256 !== fileDigest(FONT_FILE) || layout.minimum_font_size_px !== MIN_FONT_SIZE_PX || layout.font_size_px < MIN_FONT_SIZE_PX || layout.font_size_px > MAX_FONT_SIZE_PX) fail('COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID', 'canonical font authority mismatch');
  }
  return true;
}

module.exports = {
  LAYOUT_SCHEMA,
  FONT_FILE,
  MIN_FONT_SIZE_PX,
  MAX_FONT_SIZE_PX,
  DEFAULT_BACKING_PADDING_PX,
  FINAL_OUTPUT_GUARD_PX,
  MEASUREMENT_DOMAIN,
  TypographyLayoutError,
  normalizeText,
  lineSpacing,
  measureTextBatch,
  measureRenderedBounds,
  layoutTypography,
  confinedPreRenderedTypography,
  assertCanonicalLayout,
};
