'use strict';

/*
 * Bounded Piper adapter: text in, verified speech bytes out.
 *
 * This is the Draft presenter's VOICE, not the Draft presenter. It makes no
 * lifecycle decision, knows nothing about gates, and never decides whether a run
 * may proceed. It renders, validates, and reports.
 *
 * Piper is local and offline. The voice is a neutral synthetic identity: it is
 * deliberately NOT Mikko, and nothing here may be configured to imitate him.
 *
 * Output is normalized to the project audio standard (48 kHz / 24-bit) through
 * ffmpeg, because Piper emits 22.05 kHz 16-bit mono. Both the raw provider hash
 * and the normalized hash are reported, so the conversion is auditable rather
 * than invisible.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Technical validation is shared with the landed AUDIO_RENDER work, read-only.
// Sharing the probe does NOT make this AUDIO_RENDER evidence: the semantic
// evidence class stays separate on purpose.
const { probeAudio } = require('./audio-render-evidence.js');

const PROVIDER = 'piper';
const PROVIDER_VERSION_PIN = '1.7.0';
const TOOLS_ROOT = '/home/vidtoolz/vidtoolz-tools/piper';
const BINARY = path.join(TOOLS_ROOT, 'venv', 'bin', 'piper');
const VOICE_DIR = path.join(TOOLS_ROOT, 'voices');

// One neutral English draft voice. Not a voice library, and not Mikko.
const DEFAULT_VOICE = 'en_US-lessac-medium';
const VOICE_IDENTITY = 'synthetic proxy narrator (not the presenter)';

// The project audio standard, per score-provenance defaults.
const TARGET_SAMPLE_RATE = 48000;
const TARGET_BIT_DEPTH = 24;
const TARGET_CODEC = 'pcm_s24le';
const TARGET_CHANNELS = 1;

const RENDER_TIMEOUT_MS = 120000;

class SyntheticNarrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SyntheticNarrationError';
    this.code = code;
  }
}

function fail(code, message) { throw new SyntheticNarrationError(code, message); }

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function voicePaths(voice = DEFAULT_VOICE) {
  return {
    model: path.join(VOICE_DIR, `${voice}.onnx`),
    config: path.join(VOICE_DIR, `${voice}.onnx.json`),
  };
}

/* -------------------------------------------------------------- readiness -- */

/*
 * Is the provider actionable right now? Reported rather than thrown, so a
 * package run can be created and inspected on a machine where Piper is absent.
 */
function providerReadiness(options = {}) {
  const voice = options.voice || DEFAULT_VOICE;
  const paths = voicePaths(voice);
  const binaryExists = fs.existsSync(BINARY);
  const modelExists = fs.existsSync(paths.model);
  const configExists = fs.existsSync(paths.config);

  let version = null;
  let voiceMeta = null;
  if (binaryExists) {
    try {
      const pip = path.join(TOOLS_ROOT, 'venv', 'bin', 'pip');
      const shown = execFileSync(pip, ['show', 'piper-tts'], { encoding: 'utf8', timeout: 20000 });
      version = (/^Version:\s*(.+)$/m.exec(shown) || [])[1] || null;
    } catch (_) { version = null; }
  }
  if (configExists) {
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
      voiceMeta = {
        sample_rate: parsed.audio?.sample_rate ?? null,
        language: parsed.language?.code ?? null,
        dataset: parsed.dataset ?? null,
        quality: parsed.audio_quality ?? parsed.audio?.quality ?? null,
      };
    } catch (_) { voiceMeta = null; }
  }

  const blockers = [];
  if (!binaryExists) blockers.push(`piper binary not found at ${BINARY}`);
  if (!modelExists) blockers.push(`voice model not found: ${paths.model}`);
  if (!configExists) blockers.push(`voice config not found: ${paths.config}`);
  if (!hasFfmpeg()) blockers.push('ffmpeg is required to normalize provider output to the project audio standard');

  return {
    provider: PROVIDER,
    actionable: blockers.length === 0,
    blockers,
    binary: BINARY,
    binary_present: binaryExists,
    version,
    voice,
    voice_identity: VOICE_IDENTITY,
    voice_model: paths.model,
    voice_model_present: modelExists,
    voice_model_sha256: modelExists ? sha256File(paths.model) : null,
    voice_metadata: voiceMeta,
    target_format: { sample_rate: TARGET_SAMPLE_RATE, bit_depth: TARGET_BIT_DEPTH, channels: TARGET_CHANNELS, codec: TARGET_CODEC },
  };
}

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 15000 }); return true; }
  catch (_) { return false; }
}

/* ----------------------------------------------------------------- render -- */

/*
 * Render one text segment to verified audio. Fails closed on every way this can
 * go wrong: empty text, missing provider, non-zero exit, absent output, zero
 * bytes, undecodable audio, or a format that does not match the target.
 */
function renderSyntheticNarration(request) {
  const text = typeof request?.text === 'string' ? request.text.trim() : '';
  if (!text) {
    fail('NARRATION_TEXT_EMPTY', 'refusing to synthesize empty narration; an intentionally silent beat must be declared, not rendered');
  }
  const outputPath = request?.outputPath;
  if (!outputPath) fail('NARRATION_OUTPUT_PATH_REQUIRED', 'outputPath is required');

  const voice = request.voice || DEFAULT_VOICE;
  const readiness = providerReadiness({ voice });
  if (!readiness.actionable) {
    fail('NARRATION_PROVIDER_UNAVAILABLE', `synthetic narration provider is not actionable: ${readiness.blockers.join('; ')}`);
  }

  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const rawPath = `${target}.provider.wav`;

  // 1. provider render
  try {
    execFileSync(BINARY, ['-m', readiness.voice_model, '-f', rawPath], {
      input: text,
      encoding: 'utf8',
      timeout: request.timeoutMs || RENDER_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    safeUnlink(rawPath);
    const detail = String(error.stderr || error.message || '').slice(0, 300);
    if (error.killed || /ETIMEDOUT/i.test(String(error.code))) {
      fail('NARRATION_PROVIDER_TIMEOUT', `piper timed out: ${detail}`);
    }
    fail('NARRATION_PROVIDER_FAILED', `piper exited non-zero: ${detail}`);
  }
  if (!fs.existsSync(rawPath)) fail('NARRATION_OUTPUT_MISSING', 'piper reported success but produced no file');
  if (fs.statSync(rawPath).size === 0) { safeUnlink(rawPath); fail('NARRATION_OUTPUT_EMPTY', 'piper produced a zero-byte file'); }

  // 2. validate what the provider actually produced
  let rawProbe;
  try { rawProbe = probeAudio(rawPath); }
  catch (error) { safeUnlink(rawPath); fail('NARRATION_OUTPUT_UNDECODABLE', `provider output is not decodable audio: ${error.message}`); }
  const rawSha = sha256File(rawPath);

  // 3. normalize to the project audio standard
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath,
      '-ar', String(TARGET_SAMPLE_RATE), '-ac', String(TARGET_CHANNELS), '-c:a', TARGET_CODEC, target],
      { timeout: request.timeoutMs || RENDER_TIMEOUT_MS });
  } catch (error) {
    safeUnlink(rawPath); safeUnlink(target);
    fail('NARRATION_NORMALIZE_FAILED', `ffmpeg could not normalize provider output: ${String(error.message).slice(0, 200)}`);
  }
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    safeUnlink(rawPath); safeUnlink(target);
    fail('NARRATION_NORMALIZE_EMPTY', 'normalization produced no usable audio');
  }

  const probe = probeAudio(target);
  if (probe.sample_rate !== TARGET_SAMPLE_RATE || probe.channels !== TARGET_CHANNELS) {
    safeUnlink(rawPath); safeUnlink(target);
    fail('NARRATION_FORMAT_MISMATCH',
      `normalized audio is ${probe.sample_rate} Hz / ${probe.channels}ch, expected ${TARGET_SAMPLE_RATE} Hz / ${TARGET_CHANNELS}ch`);
  }

  safeUnlink(rawPath); // the normalized artifact is the one that is kept

  return {
    provider: PROVIDER,
    provider_version: readiness.version,
    voice: readiness.voice,
    voice_identity: VOICE_IDENTITY,
    voice_model_sha256: readiness.voice_model_sha256,
    // Piper is not bit-deterministic, so the REQUEST digest is what is stable;
    // the resulting bytes are recorded as measured rather than predicted.
    request_digest: requestDigest({ text, voice: readiness.voice, provider: PROVIDER, target: readiness.target_format }),
    source_text_sha256: sha256Text(text),
    audio_path: target,
    audio_sha256: sha256File(target),
    bytes: fs.statSync(target).size,
    duration_seconds: probe.duration_seconds,
    codec: probe.codec,
    sample_rate: probe.sample_rate,
    channels: probe.channels,
    provider_raw: { sha256: rawSha, sample_rate: rawProbe.sample_rate, channels: rawProbe.channels, duration_seconds: rawProbe.duration_seconds },
  };
}

/*
 * Same script text + same voice + same provider configuration yields the same
 * request digest. This is the reproducibility guarantee that is actually true;
 * byte identity is not claimed because the provider does not offer it.
 */
function requestDigest(parts) {
  const canonical = JSON.stringify({
    provider: parts.provider,
    voice: parts.voice,
    target: parts.target,
    text_sha256: sha256Text(parts.text),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function safeUnlink(file) {
  try { if (file && fs.existsSync(file)) fs.rmSync(file); } catch (_) { /* best effort */ }
}

module.exports = {
  PROVIDER,
  PROVIDER_VERSION_PIN,
  TOOLS_ROOT,
  BINARY,
  VOICE_DIR,
  DEFAULT_VOICE,
  VOICE_IDENTITY,
  TARGET_SAMPLE_RATE,
  TARGET_BIT_DEPTH,
  TARGET_CODEC,
  TARGET_CHANNELS,
  SyntheticNarrationError,
  sha256File,
  sha256Text,
  voicePaths,
  providerReadiness,
  renderSyntheticNarration,
  requestDigest,
};
