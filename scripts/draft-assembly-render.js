'use strict';

/*
 * Bounded ffmpeg renderer for Draft Assembly V0: a plan in, one watchable MP4
 * out, plus the ffprobe evidence that it really is one.
 *
 * Rendering is two-stage on purpose.
 *
 *   stage 1  each segment becomes its own normalized, silent MP4 in work/
 *   stage 2  the segments are joined and the audio is mixed onto them
 *
 * The reason is recovery, not elegance. Stage 1 is the expensive part, it is
 * per-segment independent, and each segment's filename carries the digest of
 * the inputs that produced it. An interrupted run therefore resumes: segments
 * whose digest still matches are reused untouched, and a segment whose inputs
 * changed simply has a different name and is rebuilt. Nothing is "probably
 * still fine".
 *
 * Everything is written to a .part file and renamed only after it validates, so
 * an interrupted render can never leave a file that looks finished.
 *
 * This module renders. It does not decide eligibility, does not write run
 * state, and does not attest anything.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const timeline = require('./draft-assembly-timeline.js');

const RENDERER = 'ffmpeg-draft-assembler';
const RENDERER_VERSION = 'v0';

const CRF = 23;
const PRESET = 'veryfast';
const AUDIO_BITRATE = '192k';

// Ceiling on a single ffmpeg invocation. A long draft is many short segment
// renders plus one mux, so no single call should approach this.
const SEGMENT_TIMEOUT_MS = 600000;
const MUX_TIMEOUT_MS = 1800000;
const PROBE_TIMEOUT_MS = 60000;

// Duration agreement between the plan and the rendered file. Container
// timestamps and the final AAC frame make exact equality the wrong test; a
// third of a second is far tighter than any real assembly error.
const DURATION_TOLERANCE_SECONDS = 0.34;

// -1 dBFS. amix can sum narration and music above full scale; the limiter is
// what makes "no clipping" a property of the render rather than a hope.
const LIMITER_CEILING = 0.891;

class DraftAssemblyRenderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftAssemblyRenderError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftAssemblyRenderError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function which(binary) {
  try { execFileSync(binary, ['-version'], { stdio: 'ignore', timeout: 15000 }); return true; }
  catch (_) { return false; }
}

function rendererReadiness() {
  const blockers = [];
  if (!which('ffmpeg')) blockers.push('ffmpeg is required to render a draft');
  if (!which('ffprobe')) blockers.push('ffprobe is required to validate a rendered draft');
  let version = null;
  try {
    const out = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 15000 });
    version = (/^ffmpeg version (\S+)/m.exec(out) || [])[1] || null;
  } catch (_) { version = null; }
  return {
    renderer: RENDERER,
    version: RENDERER_VERSION,
    ffmpeg_version: version,
    actionable: blockers.length === 0,
    blockers,
    is_production_edit: false,
    is_resolve_automation: false,
  };
}

/* ------------------------------------------------------------------ probe -- */

function probeMedia(filePath) {
  let raw;
  try {
    raw = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', filePath], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  } catch (error) {
    fail('DRAFT_RENDER_UNDECODABLE', `ffprobe could not read ${path.basename(filePath)}: ${String(error.message).slice(0, 200)}`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { return fail('DRAFT_RENDER_PROBE_MALFORMED', `ffprobe returned unparseable output for ${path.basename(filePath)}`); }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === 'video') || null;
  const audio = streams.find((s) => s.codec_type === 'audio') || null;

  // A PNG is a one-frame "video stream" with no duration. That is a still, not
  // a broken clip, so duration stays null rather than becoming a failure.
  const container = Number(parsed.format?.duration);
  const streamDuration = Number(video?.duration ?? audio?.duration);
  const duration = Number.isFinite(container) && container > 0
    ? container
    : (Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : null);

  const [num, den] = String(video?.r_frame_rate || '0/1').split('/').map(Number);
  const fps = video && den ? num / den : null;
  const frames = Number(video?.nb_frames);

  return {
    format_name: parsed.format?.format_name || null,
    has_video: Boolean(video),
    has_audio: Boolean(audio),
    video_codec: video?.codec_name || null,
    audio_codec: audio?.codec_name || null,
    width: video ? Number(video.width) || null : null,
    height: video ? Number(video.height) || null : null,
    fps: Number.isFinite(fps) && fps > 0 ? fps : null,
    frames: Number.isFinite(frames) && frames > 0 ? frames : null,
    pixel_format: video?.pix_fmt || null,
    sample_rate: audio ? Number(audio.sample_rate) || null : null,
    channels: audio ? Number(audio.channels) || null : null,
    duration_seconds: duration,
  };
}

/* ----------------------------------------------------------------- slate --- */

/*
 * A burned-in review slate.
 *
 * This exists because of what the draft is FOR. A reviewer asked "is section 3
 * too long?" cannot answer without knowing where section 3 starts and stops,
 * and a file that leaves the run cannot be allowed to look like a finished cut.
 * The estate already burns "PROXY PRESENTER - NOT FINAL" into proxy A-roll for
 * the same reason; this is the same discipline one layer up.
 *
 * Three fixed marks, no animation, no styling choices: a standing DRAFT notice,
 * the section position and beat name, and a running timecode a note can cite.
 */
const SLATE_NOTICE = 'DRAFT - NOT FOR PUBLICATION';
const SLATE_FONT_CANDIDATES = Object.freeze([
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
]);

function findFont() {
  return SLATE_FONT_CANDIDATES.find((file) => { try { return fs.existsSync(file); } catch (_) { return false; } }) || null;
}

/*
 * drawtext parses its own text after the filtergraph parser has already had a
 * pass at it, so anything clever in a beat name gets two chances to break the
 * graph. Beats come from a human-authored Story, so the safe move is to reduce
 * the label to characters that cannot mean anything to either parser.
 */
function slateSafeText(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9 ._\/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/*
 * Layout: the DRAFT notice and the timecode share the top row, the section
 * label sits alone at the bottom. Both bottom corners were tried first and the
 * two collided on a 1080-wide vertical frame with a long beat name — which is
 * exactly the frame a Shorts-shaped run renders.
 *
 * The label is also budgeted against the frame width rather than a fixed
 * character count, because a beat name that overflows the frame is worse than
 * one that is visibly truncated.
 */
function slateFilter(slate, output, font) {
  if (!slate || !font) return null;
  const size = Math.max(18, Math.round(Math.min(output.height, output.width * 16 / 9) / 40));
  const margin = Math.round(output.height / 45);
  const common = `fontfile=${font}:fontsize=${size}:fontcolor=0xE8EAED@0.85:box=1:boxcolor=0x000000@0.45:boxborderw=${Math.round(size / 3)}`;
  // DejaVu at this size averages a little over half the point size per glyph;
  // two thirds of the frame is the budget, and the estimate stays conservative.
  const labelBudget = Math.max(12, Math.floor((output.width * 0.66) / (size * 0.58)));
  const label = truncateLabel(slateSafeText(slate.label), labelBudget);
  // The colons inside the pts expansion belong to drawtext, not to the
  // filtergraph, so they are escaped here and nowhere else.
  const offset = Number(slate.timecode_offset_seconds || 0).toFixed(3);
  return [
    `drawtext=${common}:text='${slateSafeText(SLATE_NOTICE)}':x=${margin}:y=${margin}`,
    `drawtext=${common}:text='%{pts\\:hms\\:${offset}}':x=w-tw-${margin}:y=${margin}`,
    `drawtext=${common}:text='${label}':x=${margin}:y=h-th-${margin}`,
  ].join(',');
}

function truncateLabel(value, budget) {
  const text = String(value);
  if (text.length <= budget) return text;
  return `${text.slice(0, Math.max(1, budget - 1)).trimEnd()}.`;
}

/* ------------------------------------------------------------- geometry ---- */

/*
 * FIT never loses picture: scale inside the frame and pad the rest. COVER fills
 * the frame and throws away whatever does not fit. FIT is the V0 default
 * because a draft exists to judge what is in the shot.
 */
function geometryFilter(output, fit) {
  const { width, height } = output;
  if (String(fit).toUpperCase() === 'COVER') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
}

function runFfmpeg(args, timeoutMs, code, what) {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim().split('\n').slice(-4).join(' | ') : '';
    fail(code, `${what} failed: ${stderr || String(error.message).slice(0, 300)}`);
  }
}

/* -------------------------------------------------------------- segments --- */

/*
 * The segment identity. Two renders agree on a segment only when the frame, the
 * codec settings, the source bytes, the duration and the fill strategy all
 * agree — which is exactly when reusing the earlier file is safe.
 */
function segmentDigest(segment, output, fit, slate) {
  return timeline.digestOf({
    asset_sha256: segment.visual.sha256,
    slate: slate ? { label: slateSafeText(slate.label), offset: Number(slate.timecode_offset_seconds || 0).toFixed(3) } : null,
    kind: segment.visual.kind,
    fill: segment.visual.fill,
    render_duration: segment.render_duration_seconds,
    width: output.width,
    height: output.height,
    fps: output.fps,
    fit,
    crf: CRF,
    preset: PRESET,
    renderer: `${RENDERER}/${RENDERER_VERSION}`,
  });
}

function segmentFileName(segment, digest) {
  return `seg-${String(segment.order).padStart(3, '0')}-${digest.slice(0, 12)}.mp4`;
}

function renderSegment({ segment, sourcePath, output, fit, workDir, slate, font }) {
  const digest = segmentDigest(segment, output, fit, slate);
  const target = path.join(workDir, segmentFileName(segment, digest));

  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    // Reuse only after re-reading the bytes. A truncated leftover from a kill
    // is the exact case this guards, and it is cheap to check.
    try {
      const probe = probeMedia(target);
      const expected = segment.render_duration_seconds;
      if (probe.has_video && probe.width === output.width && probe.height === output.height
        && Number.isFinite(probe.duration_seconds)
        && Math.abs(probe.duration_seconds - expected) <= DURATION_TOLERANCE_SECONDS) {
        return { path: target, digest, reused: true, probe };
      }
    } catch (_) { /* fall through and rebuild */ }
    fs.rmSync(target, { force: true });
  }

  const part = `${target}.part`;
  fs.rmSync(part, { force: true });

  const duration = segment.render_duration_seconds;
  const slateChain = slateFilter(slate, output, font);
  const vf = [
    geometryFilter(output, fit),
    `fps=${output.fps}`,
    slateChain,
    'format=yuv420p',
    'setsar=1',
  ].filter(Boolean).join(',');
  const common = ['-an', '-c:v', 'libx264', '-preset', PRESET, '-crf', String(CRF),
    '-pix_fmt', 'yuv420p', '-video_track_timescale', String(output.fps * 1000),
    '-t', String(duration), '-vf', vf, '-f', 'mp4', part];

  if (segment.visual.kind === 'IMAGE') {
    runFfmpeg(['-loop', '1', '-framerate', String(output.fps), '-i', sourcePath, ...common],
      SEGMENT_TIMEOUT_MS, 'DRAFT_RENDER_SEGMENT_FAILED', `still segment ${segment.order}`);
  } else {
    // -stream_loop -1 with -t gives an exact duration whether the source is
    // shorter (it repeats) or longer (it is cut). The plan already recorded
    // which of those is happening, so the file and the manifest agree.
    const loop = segment.visual.fill === timeline.FILL_LOOP ? ['-stream_loop', '-1'] : [];
    runFfmpeg([...loop, '-i', sourcePath, ...common],
      SEGMENT_TIMEOUT_MS, 'DRAFT_RENDER_SEGMENT_FAILED', `video segment ${segment.order}`);
  }

  if (!fs.existsSync(part) || fs.statSync(part).size === 0) {
    fail('DRAFT_RENDER_SEGMENT_EMPTY', `segment ${segment.order} rendered nothing`);
  }
  const probe = probeMedia(part);
  if (!probe.has_video || !probe.frames) {
    fail('DRAFT_RENDER_SEGMENT_NO_FRAMES', `segment ${segment.order} carries no video frames`);
  }
  if (probe.width !== output.width || probe.height !== output.height) {
    fail('DRAFT_RENDER_SEGMENT_GEOMETRY', `segment ${segment.order} is ${probe.width}x${probe.height}, expected ${output.width}x${output.height}`);
  }
  if (!Number.isFinite(probe.duration_seconds)
    || Math.abs(probe.duration_seconds - duration) > DURATION_TOLERANCE_SECONDS) {
    fail('DRAFT_RENDER_SEGMENT_DURATION', `segment ${segment.order} is ${probe.duration_seconds}s, expected ${duration}s`);
  }
  fs.renameSync(part, target);
  return { path: target, digest, reused: false, probe };
}

/* ------------------------------------------------------------------ audio -- */

/*
 * Narration at unity, music attenuated by the planned gain, summed and limited.
 *
 * This is deliberately NOT a mix. There is no ducking, no EQ, no compression
 * beyond the safety limiter, and no loudness target. It exists so a reviewer can
 * hear whether the music helps or fights the words — a judgement that a real
 * mix would then have to earn separately.
 */
function audioFilterGraph(plan, narrationIndex, musicIndex) {
  const total = plan.timeline.total_duration_seconds;
  const chains = [];
  chains.push(`[${narrationIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:${total},asetpts=PTS-STARTPTS[nar]`);

  if (musicIndex === null) {
    chains.push(`[nar]alimiter=limit=${LIMITER_CEILING}:level=disabled[aout]`);
    return chains.join(';');
  }

  const music = plan.music;
  const fadeOutStart = Math.max(0, total - music.fade_out_seconds);
  const musicChain = [
    `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`,
    `atrim=0:${total}`,
    'asetpts=PTS-STARTPTS',
    `volume=${music.gain_db}dB`,
    `afade=t=in:st=0:d=${music.fade_in_seconds}`,
    `afade=t=out:st=${fadeOutStart}:d=${music.fade_out_seconds}`,
  ].join(',');
  chains.push(`[${musicIndex}:a]${musicChain}[mus]`);

  chains.push('[nar][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]');
  chains.push(`[mixed]alimiter=limit=${LIMITER_CEILING}:level=disabled[aout]`);
  return chains.join(';');
}

/* --------------------------------------------------------------- assemble -- */

function writeConcatList(file, segmentPaths) {
  fs.writeFileSync(file, `${segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')}\n`);
}

/*
 * Join the rendered segments. CUT concatenates without re-encoding video, so the
 * picture is byte-identical to what stage 1 validated. CROSSFADE has to
 * re-encode, and each segment was rendered one crossfade longer for exactly
 * that reason, so the joined result still lands on the narration spine.
 */
function assembleVideo({ plan, segmentPaths, workDir }) {
  const target = path.join(workDir, 'video-track.mp4');
  const part = `${target}.part`;
  fs.rmSync(part, { force: true });

  if (plan.policy.transition === 'CROSSFADE' && segmentPaths.length > 1) {
    const x = plan.policy.crossfade_seconds;
    const inputs = segmentPaths.flatMap((p) => ['-i', p]);
    const chains = [];
    let label = '0:v';
    let offset = 0;
    for (let i = 1; i < segmentPaths.length; i += 1) {
      offset = Number((offset + plan.segments[i - 1].duration_seconds).toFixed(6));
      const out = i === segmentPaths.length - 1 ? 'vfade' : `v${i}`;
      chains.push(`[${label}][${i}:v]xfade=transition=fade:duration=${x}:offset=${offset}[${out}]`);
      label = out;
    }
    runFfmpeg([...inputs, '-filter_complex', chains.join(';'), '-map', '[vfade]',
      '-t', String(plan.timeline.total_duration_seconds),
      '-c:v', 'libx264', '-preset', PRESET, '-crf', String(CRF), '-pix_fmt', 'yuv420p',
      '-r', String(plan.output.fps), '-an', '-f', 'mp4', part],
    MUX_TIMEOUT_MS, 'DRAFT_RENDER_JOIN_FAILED', 'crossfade join');
  } else {
    const listFile = path.join(workDir, 'segments.concat.txt');
    writeConcatList(listFile, segmentPaths);
    runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-f', 'mp4', part],
      MUX_TIMEOUT_MS, 'DRAFT_RENDER_JOIN_FAILED', 'segment concat');
  }

  if (!fs.existsSync(part) || fs.statSync(part).size === 0) {
    fail('DRAFT_RENDER_JOIN_EMPTY', 'joined video track is missing or empty');
  }
  fs.renameSync(part, target);
  return target;
}

function muxDraft({ plan, videoTrack, narrationPath, musicPath, targetPath }) {
  const part = `${targetPath}.part`;
  fs.rmSync(part, { force: true });

  const inputs = ['-i', videoTrack, '-i', narrationPath];
  let musicIndex = null;
  if (musicPath) {
    // Looping happens at the input, so the filter graph never has to know
    // whether the bed was long enough.
    if (plan.music.fill === timeline.FILL_LOOP) inputs.push('-stream_loop', '-1');
    inputs.push('-i', musicPath);
    musicIndex = 2;
  }

  runFfmpeg([
    ...inputs,
    '-filter_complex', audioFilterGraph(plan, 1, musicIndex),
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-t', String(plan.timeline.total_duration_seconds),
    '-f', 'mp4', part,
  ], MUX_TIMEOUT_MS, 'DRAFT_RENDER_MUX_FAILED', 'audio mux');

  if (!fs.existsSync(part) || fs.statSync(part).size === 0) {
    fail('DRAFT_RENDER_MUX_EMPTY', 'muxed draft is missing or empty');
  }
  return part;
}

/* -------------------------------------------------------------- validate --- */

/*
 * Everything a caller would otherwise have to take on trust. A render that
 * cannot answer these questions is not a draft, whatever its file size says.
 */
function validateDraft(filePath, plan) {
  const failures = [];
  if (!fs.existsSync(filePath)) {
    return { ok: false, failures: ['rendered draft does not exist'], probe: null, decode_ok: false };
  }
  const bytes = fs.statSync(filePath).size;
  if (bytes === 0) {
    return { ok: false, failures: ['rendered draft is zero bytes'], probe: null, decode_ok: false };
  }

  let probe = null;
  try { probe = probeMedia(filePath); }
  catch (error) { return { ok: false, failures: [`rendered draft is not decodable: ${error.message}`], probe: null, decode_ok: false }; }

  if (!probe.has_video) failures.push('rendered draft carries no video stream');
  if (!probe.has_audio) failures.push('rendered draft carries no audio stream');
  if (probe.width !== plan.output.width || probe.height !== plan.output.height) {
    failures.push(`resolution is ${probe.width}x${probe.height}, expected ${plan.output.width}x${plan.output.height}`);
  }
  if (probe.fps === null || Math.abs(probe.fps - plan.output.fps) > 0.01) {
    failures.push(`frame rate is ${probe.fps}, expected ${plan.output.fps}`);
  }
  if (!probe.frames || probe.frames < 1) failures.push('rendered draft reports no video frames');
  const expected = plan.timeline.total_duration_seconds;
  if (!Number.isFinite(probe.duration_seconds) || probe.duration_seconds <= 0) {
    failures.push('rendered draft has no positive duration');
  } else if (Math.abs(probe.duration_seconds - expected) > DURATION_TOLERANCE_SECONDS) {
    failures.push(`duration is ${probe.duration_seconds.toFixed(3)}s, expected ${expected}s (tolerance ${DURATION_TOLERANCE_SECONDS}s)`);
  }
  if (probe.sample_rate && probe.sample_rate !== plan.output.audio_sample_rate) {
    failures.push(`audio sample rate is ${probe.sample_rate}, expected ${plan.output.audio_sample_rate}`);
  }

  // A full decode pass. ffprobe reads headers; this reads every packet, which is
  // what catches a truncated or corrupt stream that still probes cleanly.
  let decodeOk = true;
  let decodeDetail = null;
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror',
      '-i', filePath, '-f', 'null', '-'], { timeout: MUX_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    decodeOk = false;
    decodeDetail = error.stderr ? String(error.stderr).trim().split('\n').slice(-3).join(' | ') : String(error.message).slice(0, 200);
    failures.push(`full decode pass reported errors: ${decodeDetail}`);
  }

  return { ok: failures.length === 0, failures, probe, bytes, decode_ok: decodeOk, decode_detail: decodeDetail };
}

/* ----------------------------------------------------------------- render -- */

/*
 * Render the whole plan. `sourceFor` maps a plan segment to the absolute path of
 * its already-verified asset, so this module never resolves a binding itself.
 */
function renderDraft({ plan, workDir, targetPath, narrationPath, musicPath, sourceFor, onProgress }) {
  const readiness = rendererReadiness();
  if (!readiness.actionable) {
    fail('DRAFT_RENDER_PROVIDER_UNAVAILABLE', `renderer not actionable: ${readiness.blockers.join('; ')}`);
  }
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const fit = plan.policy.fit;
  const font = plan.policy.review_slate ? findFont() : null;
  if (plan.policy.review_slate && !font) {
    fail('DRAFT_RENDER_SLATE_FONT_MISSING',
      'the review slate is enabled but no usable TrueType font was found; disable review_slate or install one');
  }
  const rendered = [];
  for (const segment of plan.segments) {
    const sourcePath = sourceFor(segment);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      fail('DRAFT_RENDER_SOURCE_MISSING', `segment ${segment.order} source is missing: ${sourcePath}`);
    }
    // Position always; the beat name only when the Story actually supplied one.
    // The section id is an identifier, not a name, and burning it into the
    // frame would tell a reviewer something editorial that nobody wrote.
    const slate = plan.policy.review_slate
      ? {
        label: [`${segment.order}/${plan.timeline.segment_count}`, segment.beat].filter(Boolean).join('  '),
        timecode_offset_seconds: segment.start_seconds,
      }
      : null;
    const result = renderSegment({ segment, sourcePath, output: plan.output, fit, workDir, slate, font });
    rendered.push({ order: segment.order, ...result });
    if (typeof onProgress === 'function') {
      onProgress({ stage: 'segment', order: segment.order, total: plan.segments.length, reused: result.reused });
    }
  }

  if (typeof onProgress === 'function') onProgress({ stage: 'join', total: plan.segments.length });
  const videoTrack = assembleVideo({ plan, segmentPaths: rendered.map((r) => r.path), workDir });

  if (typeof onProgress === 'function') onProgress({ stage: 'mux' });
  const part = muxDraft({ plan, videoTrack, narrationPath, musicPath, targetPath });

  // Validate the .part, and only then let it become the draft. An invalid
  // render never occupies the name a caller would treat as finished.
  const validation = validateDraft(part, plan);
  if (!validation.ok) {
    fs.rmSync(part, { force: true });
    const error = new DraftAssemblyRenderError('DRAFT_RENDER_INVALID',
      `rendered draft failed validation: ${validation.failures.join('; ')}`);
    error.validation = validation;
    throw error;
  }
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(part, targetPath);

  return {
    renderer: readiness,
    output_path: targetPath,
    output_sha256: sha256File(targetPath),
    bytes: fs.statSync(targetPath).size,
    validation: { ...validation, failures: [] },
    segments: rendered.map((r) => ({
      order: r.order,
      work_file: path.basename(r.path),
      segment_digest: r.digest,
      reused: r.reused,
      duration_seconds: r.probe.duration_seconds,
      frames: r.probe.frames,
    })),
    reused_segments: rendered.filter((r) => r.reused).length,
  };
}

module.exports = {
  RENDERER,
  RENDERER_VERSION,
  CRF,
  PRESET,
  DURATION_TOLERANCE_SECONDS,
  LIMITER_CEILING,
  DraftAssemblyRenderError,
  sha256File,
  rendererReadiness,
  probeMedia,
  findFont,
  slateSafeText,
  truncateLabel,
  slateFilter,
  SLATE_NOTICE,
  geometryFilter,
  segmentDigest,
  segmentFileName,
  renderSegment,
  audioFilterGraph,
  assembleVideo,
  muxDraft,
  validateDraft,
  renderDraft,
};
