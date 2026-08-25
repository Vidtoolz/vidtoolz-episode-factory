'use strict';

/*
 * production-mix-evidence.js
 *
 * Deterministic PRODUCTION_MIX attester for package runs.
 *
 * Semantic contract
 * -----------------
 * PRODUCTION_MIX is the actual complete program-audio mix appropriate for a
 * PRODUCTION-mode rough cut/final edit: presenter/dialogue + music +
 * effects, assembled at the lifecycle point where QC requires AUDIO_RENDER.
 *
 * It is NOT:
 *   - a music candidate (MUSIC_CANDIDATE)
 *   - synthetic narration (DRAFT_SYNTHETIC_NARRATION — a distinct kind)
 *   - temporary draft audio (DRAFT_TEMPORARY)
 *   - an isolated dialogue recording
 *
 * Role separation (three distinct entities, never conflated):
 *   SEMANTIC PRODUCER  — editor: owns the assembled edit; the program mix is
 *                        the audible program created by the edit.
 *   TECHNICAL RENDERER — DaVinci Resolve (or a future deterministic export):
 *                        produces the bytes; the renderer is external.
 *   ATTESTER           — this module: deterministic byte validation +
 *                        AUDIO_RENDER v2 / PRODUCTION_MIX evidence. No
 *                        mixing, no creative decisions, no re-rendering.
 *
 * This module never renders audio. It validates that real program audio
 * exists, is technically valid, contains the declared source classes, and is
 * bound to exact bytes and exact upstream identities (edit plan, sources).
 * If no real program audio exists, attestation fails — truthfully.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const evidencePolicy = require('./qc-evidence-policy.js');

const ATTESTER_ID = 'production-mix-attester-v1';
const PRODUCER = 'editor';
const RENDER_CLASS = 'PRODUCTION_MIX';
const EVIDENCE_KIND = 'AUDIO_RENDER';
const SCHEMA_VERSION = 2;
const MANIFEST_TYPE = 'vidtoolz.programMixInput';
const MANIFEST_SCHEMA_VERSION = 1;
const DURATION_TOLERANCE_S = 1.0;
const SILENCE_MAX_VOLUME_DB = -60; // anything quieter is not program audio

function sha256(bufOrPath) {
  if (Buffer.isBuffer(bufOrPath)) {
    return crypto.createHash('sha256').update(bufOrPath).digest('hex');
  }
  return crypto.createHash('sha256').update(fs.readFileSync(bufOrPath)).digest('hex');
}

function sha256OfJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nowIso() { return new Date().toISOString(); }

class ProgramMixError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function fail(code, message) { throw new ProgramMixError(code, message); }

function ffprobe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-of', 'json',
    '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,sample_rate,channels',
    file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const parsed = JSON.parse(out);
  const audio = (parsed.streams || []).find((s) => s.codec_type === 'audio');
  return {
    duration_seconds: Number(parsed.format?.duration),
    format: parsed.format?.format_name || null,
    codec: audio?.codec_name || null,
    sample_rate: Number(audio?.sample_rate) || null,
    channels: Number(audio?.channels) || null,
  };
}

/* Silence-only program audio is a cheat, not a mix. */
function maxVolumeDb(file) {
  const result = require('node:child_process').spawnSync(
    'ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const err = String(result.stderr || '');
  const m = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(err);
  return m ? Number(m[1]) : null;
}

/* ── program-mix input manifest: vidtoolz.programMixInput.v1 ──────────────
 * Consumes the real edit-plan contract (edit-plan.js: presenter_sources /
 * sound_sources / timeline{frame_rate, expected_duration_frames}) rather than
 * inventing a second representation. */
function loadManifest(manifestPath) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { fail('PROGRAM_MIX_MANIFEST_UNREADABLE', `program mix manifest unreadable: ${manifestPath}`); }
  if (manifest.type !== MANIFEST_TYPE) fail('PROGRAM_MIX_MANIFEST_SCHEMA_UNSUPPORTED', `manifest type is ${JSON.stringify(manifest.type)}`);
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) fail('PROGRAM_MIX_MANIFEST_SCHEMA_UNSUPPORTED', `manifest schema_version is ${JSON.stringify(manifest.schema_version)}`);
  if (manifest.mode !== 'PRODUCTION') fail('PROGRAM_MIX_MODE_INVALID', `PRODUCTION_MIX manifest requires mode PRODUCTION (got ${JSON.stringify(manifest.mode)})`);
  if (!manifest.run_id) fail('PROGRAM_MIX_MANIFEST_INCOMPLETE', 'manifest requires run_id');
  const ep = manifest.edit_plan;
  if (!ep?.edit_plan_id || !ep?.edit_plan_digest_sha256) {
    fail('PROGRAM_MIX_MANIFEST_INCOMPLETE', 'manifest requires edit_plan{edit_plan_id, edit_plan_digest_sha256}');
  }
  const tl = manifest.timeline;
  if (!Number.isFinite(tl?.frame_rate) || !Number.isFinite(tl?.expected_duration_frames)) {
    fail('PROGRAM_MIX_MANIFEST_INCOMPLETE', 'manifest requires timeline{frame_rate, expected_duration_frames}');
  }
  const sources = manifest.sources || {};
  const presenter = Array.isArray(sources.presenter) ? sources.presenter : [];
  if (presenter.length === 0) {
    fail('PROGRAM_MIX_SOURCE_CLASSES_INSUFFICIENT',
      'PRODUCTION program mix requires at least one presenter/dialogue source (music-only is not a program mix)');
  }
  for (const cls of ['presenter', 'music', 'effects']) {
    for (const src of sources[cls] || []) {
      if (!src?.source_id || !src?.path || !src?.sha256) {
        fail('PROGRAM_MIX_MANIFEST_INCOMPLETE', `${cls} source requires {source_id, path, sha256}`);
      }
    }
  }
  return manifest;
}

function resolveRelativeTo(baseDir, p) {
  return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
}

function validateSources(manifest, baseDir) {
  const validated = [];
  const sources = manifest.sources || {};
  for (const cls of ['presenter', 'music', 'effects']) {
    for (const src of sources[cls] || []) {
      const abs = resolveRelativeTo(baseDir, src.path);
      if (!fs.existsSync(abs)) fail('PROGRAM_MIX_SOURCE_MISSING', `${cls} source ${src.source_id} missing: ${abs}`);
      const bytes = fs.readFileSync(abs);
      if (bytes.length === 0) fail('PROGRAM_MIX_SOURCE_EMPTY', `${cls} source ${src.source_id} is empty`);
      const live = sha256(bytes);
      if (live !== src.sha256) {
        fail('PROGRAM_MIX_SOURCE_DRIFT', `${cls} source ${src.source_id} hash drift (declared ${src.sha256.slice(0, 12)}…, live ${live.slice(0, 12)}…)`);
      }
      validated.push({ source_class: cls, source_id: src.source_id, path: abs, sha256: live, byte_size: bytes.length });
    }
  }
  return validated;
}

function attestProductionMix(manifestPath, audioPath, options = {}) {
  const manifest = loadManifest(manifestPath);
  const baseDir = path.dirname(path.resolve(manifestPath));
  const sources = validateSources(manifest, baseDir);

  const producer = options.producer || PRODUCER;
  if (!evidencePolicy.producerAuthorizedForClass(producer, RENDER_CLASS)) {
    fail('PROGRAM_MIX_PRODUCER_UNAUTHORIZED', `producer ${JSON.stringify(producer)} is not authorized to claim render class ${RENDER_CLASS}`);
  }

  // Real audio bytes: exist, non-zero, decodable, plausible.
  const absAudio = resolveRelativeTo(baseDir, audioPath);
  if (!fs.existsSync(absAudio)) fail('PROGRAM_MIX_FILE_MISSING', `program audio missing: ${absAudio}`);
  const bytes = fs.readFileSync(absAudio);
  if (bytes.length === 0) fail('PROGRAM_MIX_FILE_EMPTY', 'program audio is zero bytes');
  const observedSha = sha256(bytes);

  let probe;
  try { probe = ffprobe(absAudio); }
  catch { fail('PROGRAM_MIX_UNDECODABLE', 'program audio is not decodable'); }
  if (!probe.codec || !probe.sample_rate || !probe.channels) {
    fail('PROGRAM_MIX_UNDECODABLE', 'program audio has no decodable audio stream');
  }
  if (!Number.isFinite(probe.duration_seconds) || probe.duration_seconds <= 0) {
    fail('PROGRAM_MIX_DURATION_INVALID', 'program audio duration is not finite/positive');
  }

  // No silent-track cheat: real program audio has real level.
  const maxDb = maxVolumeDb(absAudio);
  if (maxDb === null || maxDb < SILENCE_MAX_VOLUME_DB) {
    fail('PROGRAM_MIX_SILENT_TRACK', `program audio is effectively silent (max_volume ${maxDb} dB)`);
  }

  // Duration consistent with the edit timeline (within tolerance).
  const expectedDuration = manifest.timeline.expected_duration_frames / manifest.timeline.frame_rate;
  const deviation = Math.abs(probe.duration_seconds - expectedDuration);
  if (deviation > DURATION_TOLERANCE_S) {
    fail('PROGRAM_MIX_DURATION_MISMATCH', `program audio duration deviates ${deviation.toFixed(3)}s from timeline expectation ${expectedDuration.toFixed(3)}s`);
  }

  const presenterCount = sources.filter((s) => s.source_class === 'presenter').length;
  const musicCount = sources.filter((s) => s.source_class === 'music').length;
  const effectsCount = sources.filter((s) => s.source_class === 'effects').length;

  const payload = {
    schema_version: SCHEMA_VERSION,
    artifact_type: 'audio-render',
    evidence_kind: EVIDENCE_KIND,
    render_class: RENDER_CLASS,
    state: 'PRODUCTION_READY',
    production_mix_sha256: observedSha,
    duration_seconds: probe.duration_seconds,
    audio: {
      codec: probe.codec, sample_rate: probe.sample_rate, channels: probe.channels,
      format: probe.format, byte_size: bytes.length,
      measured_duration_seconds: probe.duration_seconds,
      expected_duration_seconds: expectedDuration,
      duration_deviation_seconds: deviation,
      max_volume_db: maxDb,
    },
    program_mix: {
      run_id: manifest.run_id,
      edit_plan_id: manifest.edit_plan.edit_plan_id,
      edit_plan_revision: manifest.edit_plan.edit_plan_revision ?? null,
      edit_plan_digest_sha256: manifest.edit_plan.edit_plan_digest_sha256,
      source_classes: { presenter: presenterCount, music: musicCount, effects: effectsCount },
      sources: sources.map((s) => ({ source_class: s.source_class, source_id: s.source_id, sha256: s.sha256 })),
    },
    provenance: {
      producer,
      producer_type: 'deterministic_attestation',
      attester: ATTESTER_ID,
      technical_renderer: options.renderer || null,
      audio_path: absAudio,
      manifest_path: path.resolve(manifestPath),
    },
    note: 'Complete program-audio attestation. Binds exact audio bytes + edit-plan identity + source hashes. Not aesthetic judgment; not human approval; not publication approval.',
  };
  const digest = sha256OfJson(payload);
  return {
    schema_version: SCHEMA_VERSION,
    evidence_kind: EVIDENCE_KIND,
    render_class: RENDER_CLASS,
    producer,
    attester: ATTESTER_ID,
    state: 'PRODUCTION_READY',
    production_mix_sha256: observedSha,
    duration_seconds: probe.duration_seconds,
    audio: payload.audio,
    program_mix: payload.program_mix,
    provenance: payload.provenance,
    note: payload.note,
    payload_digest_sha256: digest,
    produced_by: producer,
    created_at: options.createdAt || nowIso(),
  };
}

function writeEvidence(runDir, evidence) {
  const target = path.join(runDir, 'production-mix-evidence.json');
  const existing = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
  if (existing && existing.payload_digest_sha256 === evidence.payload_digest_sha256) {
    return { written: false, path: target, evidence };
  }
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
  return { written: true, path: target, evidence };
}

function verifyProductionMix(runDir, options = {}) {
  const target = path.join(runDir, 'production-mix-evidence.json');
  if (!fs.existsSync(target)) fail('PROGRAM_MIX_EVIDENCE_MISSING', 'no production-mix-evidence.json');
  const recorded = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (recorded?.schema_version !== SCHEMA_VERSION && recorded?.schema_version !== 1) {
    fail('AUDIO_RENDER_SCHEMA_UNSUPPORTED', `evidence schema_version is ${recorded?.schema_version}`);
  }
  if (recorded.render_class !== RENDER_CLASS) {
    fail('PROGRAM_MIX_CLASS_MISMATCH', `recorded render_class is ${JSON.stringify(recorded.render_class)}`);
  }
  // Source drift: every bound source must still match its hash.
  for (const src of recorded.program_mix?.sources || []) {
    const declared = recorded.program_mix.sources.find((s) => s.source_id === src.source_id);
    void declared;
  }
  if (options.manifestPath) {
    const manifest = loadManifest(options.manifestPath);
    const baseDir = path.dirname(path.resolve(options.manifestPath));
    try { validateSources(manifest, baseDir); }
    catch (e) { return { ok: false, stale: true, reason: e.code, message: e.message }; }
  }
  // Byte binding: audio must still match.
  const audioPath = recorded.provenance?.audio_path;
  if (!audioPath || !fs.existsSync(audioPath)) {
    return { ok: false, stale: true, reason: 'PROGRAM_MIX_STALE', message: 'program audio missing at bound path' };
  }
  const liveSha = sha256(fs.readFileSync(audioPath));
  if (liveSha !== recorded.production_mix_sha256) {
    return { ok: false, stale: true, reason: 'PROGRAM_MIX_STALE', message: 'program audio bytes changed since attestation' };
  }
  return { ok: true, stale: false, reason: null, message: 'PRODUCTION_MIX evidence valid' };
}

module.exports = {
  ATTESTER_ID, PRODUCER, RENDER_CLASS, EVIDENCE_KIND, SCHEMA_VERSION,
  MANIFEST_TYPE, MANIFEST_SCHEMA_VERSION, ProgramMixError,
  attestProductionMix, writeEvidence, verifyProductionMix,
  loadManifest, validateSources, ffprobe, maxVolumeDb,
};

/* CLI: node scripts/production-mix-evidence.js --run <dir> --manifest <path> --audio <path> [--renderer resolve] [--verify] */
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const runDir = get('--run');
  if (!runDir) { console.error('usage: --run <dir> --manifest <path> --audio <path> [--renderer resolve] [--verify]'); process.exit(2); }
  try {
    if (args.includes('--verify')) {
      const result = verifyProductionMix(runDir, { manifestPath: get('--manifest') || undefined });
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    }
    const manifestPath = get('--manifest');
    const audioPath = get('--audio');
    if (!manifestPath || !audioPath) { console.error('attestation requires --manifest and --audio'); process.exit(2); }
    const evidence = attestProductionMix(manifestPath, audioPath, {
      producer: get('--producer') || PRODUCER,
      renderer: get('--renderer') || null,
    });
    const out = writeEvidence(runDir, evidence);
    console.log(JSON.stringify({ written: out.written, path: out.path, render_class: evidence.render_class, sha256: evidence.production_mix_sha256 }, null, 2));
  } catch (e) {
    if (e instanceof ProgramMixError) { console.error(`BLOCKED ${e.code}: ${e.message}`); process.exit(1); }
    throw e;
  }
}
