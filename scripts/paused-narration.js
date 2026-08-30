'use strict';

/*
 * FINAL PAUSED NARRATION — the V2 timing authority.
 *
 * canonical script -> synthetic speech units -> pause plan -> click-free
 * silence insertion -> one measured, hash-bound WAV whose timeline governs
 * visual intervals, backgrounds, overlays, music duration, and assembly
 * (doctrine timing_authority = FINAL_PAUSED_NARRATION). Nothing downstream may
 * schedule against the pre-pause duration.
 *
 * Word immutability is proven, not assumed: the exact word token sequence of
 * the speech units is compared per section against the canonical dialogue and
 * the build fails closed on any difference. Pause insertion changes timing
 * only.
 *
 * Click safety: units adjacent to an inserted pause get an 8 ms edge fade
 * (into/out of digital silence), so a junction can never step mid-waveform.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const provider = require('./synthetic-narration-provider.js');
const pausePlanner = require('./natural-pause-planner.js');
const doctrineModule = require('./visual-draft-doctrine.js');
const { probeAudio } = require('./audio-render-evidence.js');

const MANIFEST_SCHEMA = 'vidtoolz.finalPausedNarration.v1';
const ASSEMBLED_NAME = 'final-paused-narration.wav';
const EDGE_FADE_SECONDS = 0.008;

class PausedNarrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PausedNarrationError';
    this.code = code;
  }
}

function fail(code, message) { throw new PausedNarrationError(code, message); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sha256Text(text) { return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'); }

function ffmpeg(args, timeoutMs = 180000) {
  try { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: timeoutMs }); }
  catch (error) { fail('PAUSED_NARRATION_FFMPEG_FAILED', `ffmpeg ${args[0]}…: ${String(error.message).slice(0, 200)}`); }
}

/*
 * Split each section's dialogue into contiguous speech units at the planned
 * pause boundaries. A unit is one or more whole sentences; no sentence is ever
 * cut, so a pause can never land inside a phrase.
 */
function buildSpeechUnits(sections, plan) {
  pausePlanner.validatePausePlan(plan, sections);
  const pausesByKey = new Map(plan.pauses.map((pause) => [`${pause.section_id}:${pause.after_sentence_index}`, pause]));
  const units = [];
  for (const section of sections) {
    const sentences = pausePlanner.splitSentences(section.text);
    if (sentences.length === 0) continue;
    let current = [];
    for (let index = 0; index < sentences.length; index += 1) {
      current.push(sentences[index]);
      const pause = pausesByKey.get(`${section.section_id}:${index}`);
      const isLast = index === sentences.length - 1;
      if (pause || isLast) {
        units.push({
          unit_id: `U${String(units.length + 1).padStart(2, '0')}`,
          section_id: section.section_id,
          order: section.order,
          text: current.join(' '),
          followed_by_pause: pause ? pause.pause_id : null,
        });
        current = [];
      }
    }
  }
  if (units.length === 0) fail('PAUSED_NARRATION_NO_UNITS', 'no speech units to render');
  return units;
}

/*
 * Byte-level word-sequence proof: for every section, the concatenated unit
 * word tokens must equal the canonical dialogue word tokens exactly.
 */
function verifyWordSequence(sections, units) {
  const mismatches = [];
  const proof = [];
  for (const section of sections) {
    const original = pausePlanner.words(section.text);
    const reassembled = units.filter((unit) => unit.section_id === section.section_id).flatMap((unit) => pausePlanner.words(unit.text));
    const ok = original.length === reassembled.length && original.every((token, index) => token === reassembled[index]);
    if (!ok) mismatches.push(section.section_id);
    proof.push({
      section_id: section.section_id,
      word_count: original.length,
      original_words_sha256: sha256Text(original.join(' ')),
      reassembled_words_sha256: sha256Text(reassembled.join(' ')),
      match: ok,
    });
  }
  return { ok: mismatches.length === 0, mismatches, sections: proof };
}

function renderSilence(target, durationSeconds, timeoutMs) {
  ffmpeg(['-f', 'lavfi', '-i', `anullsrc=channel_layout=mono:sample_rate=${provider.TARGET_SAMPLE_RATE}`,
    '-t', durationSeconds.toFixed(6), '-c:a', provider.TARGET_CODEC, target], timeoutMs);
}

function fadeEdges(source, target, { fadeIn, fadeOut, durationSeconds }, timeoutMs) {
  const filters = [];
  if (fadeIn) filters.push(`afade=t=in:st=0:d=${EDGE_FADE_SECONDS}`);
  if (fadeOut) filters.push(`afade=t=out:st=${Math.max(0, durationSeconds - EDGE_FADE_SECONDS).toFixed(6)}:d=${EDGE_FADE_SECONDS}`);
  ffmpeg(['-i', source, '-af', filters.join(','), '-c:a', provider.TARGET_CODEC, target], timeoutMs);
}

/*
 * Build the final paused narration.
 *
 *   sections   [{ section_id, order, text }] — canonical spoken dialogue
 *   plan       pause plan from natural-pause-planner (or omitted to plan here)
 *   mediaDir   output directory
 *   options.renderUnit(text, outputPath) — injectable synthesis seam; defaults
 *              to the canonical Piper provider.
 */
function buildPausedNarration({ sections, plan, mediaDir }, options = {}) {
  if (!mediaDir) fail('PAUSED_NARRATION_MEDIA_DIR_REQUIRED', 'mediaDir is required');
  const doctrinePin = options.doctrineBinding || doctrineModule.doctrineBinding(options);
  const pausePlan = plan || pausePlanner.planPauses(sections, options);
  const units = buildSpeechUnits(sections, pausePlan);
  const wordProof = verifyWordSequence(sections, units);
  if (!wordProof.ok) fail('PAUSED_NARRATION_WORD_SEQUENCE_CHANGED', `spoken word sequence changed in: ${wordProof.mismatches.join(', ')}`);

  fs.mkdirSync(mediaDir, { recursive: true });
  const renderUnit = options.renderUnit || ((text, outputPath) => provider.renderSyntheticNarration({ text, outputPath, voice: options.voice, timeoutMs: options.timeoutMs }));

  const rendered = [];
  for (const unit of units) {
    const target = path.join(mediaDir, `unit-${unit.unit_id}.wav`);
    const result = renderUnit(unit.text, target);
    const probe = probeAudio(target);
    if (probe.sample_rate !== provider.TARGET_SAMPLE_RATE || probe.channels !== provider.TARGET_CHANNELS) fail('PAUSED_NARRATION_UNIT_FORMAT_INVALID', unit.unit_id);
    rendered.push({ ...unit, audio_path: target, duration_seconds: probe.duration_seconds, source_text_sha256: sha256Text(unit.text), audio_sha256: sha256File(target), request: result || null });
  }

  // Edge fades around inserted pauses, then one concat of matched-format WAVs.
  const pieces = [];
  for (let index = 0; index < rendered.length; index += 1) {
    const unit = rendered[index];
    const fadeOut = unit.followed_by_pause !== null;
    const fadeIn = index > 0 && rendered[index - 1].followed_by_pause !== null;
    let audioPath = unit.audio_path;
    if (fadeIn || fadeOut) {
      const faded = path.join(mediaDir, `unit-${unit.unit_id}.faded.wav`);
      fadeEdges(unit.audio_path, faded, { fadeIn, fadeOut, durationSeconds: unit.duration_seconds }, options.timeoutMs);
      audioPath = faded;
    }
    pieces.push({ kind: 'SPEECH', unit, path: audioPath });
    if (unit.followed_by_pause) {
      const pause = pausePlan.pauses.find((candidate) => candidate.pause_id === unit.followed_by_pause);
      const silence = path.join(mediaDir, `pause-${pause.pause_id}.wav`);
      renderSilence(silence, pause.duration_seconds, options.timeoutMs);
      pieces.push({ kind: 'PAUSE', pause, path: silence, duration_seconds: pause.duration_seconds });
    }
  }
  const listFile = path.join(mediaDir, 'paused-concat.txt');
  fs.writeFileSync(listFile, pieces.map((piece) => `file '${piece.path.replace(/'/g, "'\\''")}'`).join('\n'));
  const assembledPath = path.join(mediaDir, ASSEMBLED_NAME);
  try { ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', assembledPath], options.timeoutMs); }
  finally { try { fs.rmSync(listFile); } catch (_) { /* best effort */ } }
  const assembledProbe = probeAudio(assembledPath);

  // Paused timeline: cursor walk over speech + silence, with each pause
  // attributed to the section that precedes it so sections stay contiguous.
  let cursor = 0;
  const unitTimeline = [];
  const pauseTimeline = [];
  const sectionWindows = new Map();
  for (const piece of pieces) {
    const durationSeconds = piece.kind === 'SPEECH' ? piece.unit.duration_seconds : piece.duration_seconds;
    const start = cursor;
    cursor += durationSeconds;
    if (piece.kind === 'SPEECH') {
      const sectionId = piece.unit.section_id;
      const window = sectionWindows.get(sectionId) || { section_id: sectionId, order: piece.unit.order, in_seconds: start, out_seconds: cursor };
      window.out_seconds = cursor;
      sectionWindows.set(sectionId, window);
      unitTimeline.push({ unit_id: piece.unit.unit_id, section_id: sectionId, text: piece.unit.text, source_text_sha256: piece.unit.source_text_sha256, audio_sha256: piece.unit.audio_sha256, start_seconds: Number(start.toFixed(6)), end_seconds: Number(cursor.toFixed(6)), duration_seconds: durationSeconds, followed_by_pause: piece.unit.followed_by_pause });
    } else {
      const owner = [...sectionWindows.values()].at(-1);
      owner.out_seconds = cursor; // pause extends the preceding section
      pauseTimeline.push({ pause_id: piece.pause.pause_id, category: piece.pause.category, reason: piece.pause.reason, start_seconds: Number(start.toFixed(6)), end_seconds: Number(cursor.toFixed(6)), duration_seconds: durationSeconds });
    }
  }
  const baseDuration = rendered.reduce((sum, unit) => sum + unit.duration_seconds, 0);
  const addedPause = pauseTimeline.reduce((sum, pause) => sum + pause.duration_seconds, 0);
  const sorted = pauseTimeline.map((pause) => pause.duration_seconds).sort((a, b) => a - b);
  const median = sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const manifest = {
    schema: MANIFEST_SCHEMA,
    timing_authority: 'FINAL_PAUSED_NARRATION',
    source_class: 'SYNTHETIC_DRAFT_NARRATION',
    doctrine: doctrinePin,
    pause_plan: { schema: pausePlan.schema, planner: pausePlan.planner, digest_sha256: doctrineModule.digest(pausePlan) },
    pause_count: pauseTimeline.length,
    total_added_pause_seconds: Number(addedPause.toFixed(6)),
    median_pause_seconds: Number(median.toFixed(6)),
    max_pause_seconds: Number((sorted.at(-1) || 0).toFixed(6)),
    base_duration_seconds: Number(baseDuration.toFixed(6)),
    final_duration_seconds: assembledProbe.duration_seconds,
    pauses: pauseTimeline,
    units: unitTimeline,
    sections: [...sectionWindows.values()].map((window) => ({
      section_id: window.section_id,
      order: window.order,
      in_ms: Math.round(window.in_seconds * 1000),
      out_ms: Math.round(window.out_seconds * 1000),
      duration_ms: Math.round(window.out_seconds * 1000) - Math.round(window.in_seconds * 1000),
    })),
    word_sequence_proof: wordProof,
    audio: {
      path: assembledPath,
      sha256: sha256File(assembledPath),
      bytes: fs.statSync(assembledPath).size,
      duration_seconds: assembledProbe.duration_seconds,
      codec: assembledProbe.codec,
      sample_rate: assembledProbe.sample_rate,
      channels: assembledProbe.channels,
    },
    edge_fade_seconds: EDGE_FADE_SECONDS,
  };
  const durationDrift = Math.abs(manifest.final_duration_seconds - (baseDuration + addedPause));
  if (durationDrift > 0.05) fail('PAUSED_NARRATION_DURATION_INCONSISTENT', `assembled ${manifest.final_duration_seconds}s vs expected ${(baseDuration + addedPause).toFixed(6)}s`);
  return manifest;
}

/*
 * The narration-alignment sections for the render spec MUST come from here —
 * the paused timeline — never from the pre-pause narration manifest.
 */
function deriveAlignmentSections(manifest, scriptBeatIdsBySection) {
  if (manifest?.schema !== MANIFEST_SCHEMA) fail('PAUSED_NARRATION_MANIFEST_INVALID', String(manifest?.schema));
  return manifest.sections.map((section, index) => {
    const beatIds = scriptBeatIdsBySection?.[section.section_id];
    if (!Array.isArray(beatIds) || beatIds.length === 0) fail('PAUSED_NARRATION_BEAT_BINDING_REQUIRED', section.section_id);
    return {
      section_id: section.section_id,
      story_order: index + 1,
      in_ms: section.in_ms,
      out_ms: section.out_ms,
      duration_ms: section.duration_ms,
      script_beat_ids: beatIds,
    };
  });
}

module.exports = {
  MANIFEST_SCHEMA,
  ASSEMBLED_NAME,
  EDGE_FADE_SECONDS,
  PausedNarrationError,
  buildSpeechUnits,
  verifyWordSequence,
  buildPausedNarration,
  deriveAlignmentSections,
};
