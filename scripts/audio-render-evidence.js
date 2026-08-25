'use strict';

/*
 * audio-render-evidence.js
 *
 * Deterministic AUDIO_RENDER evidence attester for package runs.
 *
 * Semantic contract
 * -----------------
 * AUDIO_RENDER attests that a REAL rendered audio asset from the authorized
 * music lane exists and is technically valid:
 *
 *   - a Scorecraft music-candidate record (music-candidate.json) produced by
 *     the music_generation lane exists, status 'completed', with complete
 *     provenance (generation job id, workflow hash, brief hash)
 *   - its production.wav is present, non-empty, decodable (ffprobe), and its
 *     bytes hash to the record's output_sha256
 *   - measured duration matches the record's ffprobe measurement within
 *     tolerance
 *
 * What AUDIO_RENDER is NOT:
 *   - not the final program mix (dialogue + music). No program-mix render
 *     path exists yet; when one lands it needs its own evidence kind, not a
 *     reuse of this one. Flagged in docs/audio-render-evidence.md.
 *   - not aesthetic judgment, not human music approval. A candidate's human
 *     verdict is recorded truthfully; AWAITING_HUMAN_REVIEW never becomes
 *     APPROVED here. Mikko's Scorecraft two-step gate remains the only
 *     approval authority.
 *
 * Producer identity
 * -----------------
 * produced_by = sound_music_director: the department that owns audio
 * direction and the candidate records this evidence attests. The render
 * itself is infrastructure (music_generation lane); the attester is
 * deterministic (producer_type: deterministic_attestation) — no agent
 * invocation is fabricated. QC remediation routes to the department per
 * REMEDIATION_OWNER.
 *
 * Hash binding: evidence carries the exact wav sha256. If the bytes change,
 * verifyExistingEvidence reports stale — no filename-only trust.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const evidencePolicy = require('./qc-evidence-policy.js');

const ATTESTER_ID = 'audio-render-attester-v2';
const PRODUCER = 'sound_music_director';
const EVIDENCE_KIND = 'AUDIO_RENDER';
/*
 * Schema history:
 *   v1 — proven render attestation without a fidelity class (legacy). Legacy
 *        evidence stays v1 on disk; verify classifies it as CLASS_UNKNOWN and
 *        class-sensitive QC cannot consume it. Re-attest to upgrade.
 *   v2 — adds `render_class` from the canonical fidelity vocabulary
 *        (qc-evidence-policy.js RENDER_CLASSES), validated + producer-
 *        authorized at attestation time. Adding a semantic dimension to the
 *        evidence contract is a schema change: v2, not silent v1 mutation.
 */
const SCHEMA_VERSION = 2;
const DEFAULT_RENDER_CLASS = 'MUSIC_CANDIDATE';
const EVIDENCE_FILE = 'audio-render-evidence.json';
const STATES = Object.freeze(['PRODUCTION_READY', 'NOT_PRODUCTION_READY']);
const DURATION_TOLERANCE_S = 0.5;

class AudioRenderEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudioRenderEvidenceError';
    this.code = code;
  }
}

function fail(code, message) { throw new AudioRenderEvidenceError(code, message); }

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowIso() { return new Date().toISOString(); }

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function evidencePath(runDir) {
  return path.join(path.resolve(runDir), EVIDENCE_FILE);
}

/* ---------------------------------------------------------- ffprobe -------- */

function probeAudio(filePath) {
  let raw;
  try {
    raw = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', filePath], { encoding: 'utf8', timeout: 30000 });
  } catch (error) {
    fail('AUDIO_RENDER_UNDECODABLE', `ffprobe could not decode the audio artifact: ${String(error.message).slice(0, 200)}`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { fail('AUDIO_RENDER_PROBE_MALFORMED', 'ffprobe returned unparseable output'); }
  const stream = (parsed.streams || []).find((s) => s.codec_type === 'audio' || s.codec_name);
  if (!stream) fail('AUDIO_RENDER_NO_AUDIO_STREAM', 'artifact carries no audio stream');
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    fail('AUDIO_RENDER_DURATION_INVALID', 'artifact duration missing or not positive');
  }
  const sampleRate = Number(stream.sample_rate);
  const channels = Number(stream.channels);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) fail('AUDIO_RENDER_SAMPLE_RATE_INVALID', 'sample rate missing or not positive');
  if (!Number.isInteger(channels) || channels <= 0) fail('AUDIO_RENDER_CHANNELS_INVALID', 'channel count missing or not positive');
  return {
    codec: stream.codec_name || null,
    sample_rate: sampleRate,
    channels,
    duration_seconds: duration,
    format: parsed.format?.format_name || null,
  };
}

/* ---------------------------------------------------- candidate record ----- */

/*
 * Validate the Scorecraft candidate record this evidence attests.
 * Fail closed on every way it can be insufficient.
 */
function loadCandidateRecord(recordDir) {
  const dir = path.resolve(recordDir);
  const metaPath = path.join(dir, 'music-candidate.json');
  const wavPath = path.join(dir, 'production.wav');
  if (!fs.existsSync(metaPath)) fail('AUDIO_RENDER_RECORD_MISSING', `music-candidate.json not found in ${dir}`);
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch (_) { fail('AUDIO_RENDER_RECORD_MALFORMED', 'music-candidate.json is not valid JSON'); }
  if (meta.status !== 'completed') {
    fail('AUDIO_RENDER_NOT_COMPLETED', `candidate status is ${meta.status ?? '(absent)'}; only completed renders may be attested`);
  }
  if (!fs.existsSync(wavPath)) fail('AUDIO_RENDER_FILE_MISSING', 'production.wav missing from candidate record');
  const stat = fs.statSync(wavPath);
  if (!stat.isFile() || stat.size === 0) fail('AUDIO_RENDER_FILE_EMPTY', 'production.wav is empty or not a regular file');
  return { dir, meta, metaPath, wavPath };
}

function validateProvenance(meta) {
  const problems = [];
  if (!meta.generation_job_id) problems.push('generation_job_id missing');
  if (!meta.workflow_hash) problems.push('workflow_hash missing');
  if (!meta.brief_hash) problems.push('brief_hash missing');
  if (!meta.output_sha256) problems.push('output_sha256 missing');
  return { ok: problems.length === 0, problems };
}

/*
 * Resolve and authorize the render class. Fail closed:
 *   - the class must exist in the canonical vocabulary
 *   - this attester only mints music-lane classes: the assembled program
 *     mix (PRODUCTION_MIX) is owned by the program-mix attester, never by
 *     the music attester, regardless of policy-level authorization
 *   - the attesting producer must be authorized for that class
 * No free-text classes, no inference from filename or bytes.
 */
const MUSIC_LANE_CLASSES = Object.freeze(['MUSIC_CANDIDATE', 'DRAFT_TEMPORARY']);

function resolveRenderClass(renderClass, producer) {
  const cls = renderClass || DEFAULT_RENDER_CLASS;
  if (!evidencePolicy.RENDER_CLASSES[cls]) {
    fail('AUDIO_RENDER_CLASS_UNKNOWN',
      `render_class ${JSON.stringify(cls)} is not in the canonical vocabulary (allowed: ${Object.keys(evidencePolicy.RENDER_CLASSES).join(', ')})`);
  }
  if (!MUSIC_LANE_CLASSES.includes(cls)) {
    fail('AUDIO_RENDER_CLASS_UNAUTHORIZED',
      `the music attester cannot attest render class ${cls}; ${cls} evidence requires its own canonical producer path`);
  }
  if (!evidencePolicy.producerAuthorizedForClass(producer, cls)) {
    fail('AUDIO_RENDER_CLASS_UNAUTHORIZED',
      `producer ${producer} is not authorized to attest render class ${cls}`);
  }
  return cls;
}

/* ------------------------------------------------------------- attest ------ */

function attestAudioRender(recordDir, options = {}) {
  const { dir, meta, wavPath } = loadCandidateRecord(recordDir);
  const renderClass = resolveRenderClass(options.renderClass, options.producer || PRODUCER);
  const provenance = validateProvenance(meta);

  const bytes = fs.readFileSync(wavPath);
  const observedSha = sha256(bytes);
  if (observedSha !== meta.output_sha256) {
    fail('AUDIO_RENDER_HASH_MISMATCH', 'production.wav bytes do not match the candidate record output_sha256');
  }

  const probe = probeAudio(wavPath);

  // Duration cross-check against the record's own ffprobe measurement.
  const recordedDuration = Number(meta.measured_duration_seconds);
  const durationDeviation = Number.isFinite(recordedDuration) && recordedDuration > 0
    ? Math.round((probe.duration_seconds - recordedDuration) * 1000) / 1000
    : null;
  const durationOk = durationDeviation === null || Math.abs(durationDeviation) <= DURATION_TOLERANCE_S;

  if (!provenance.ok) fail('AUDIO_RENDER_PROVENANCE_INCOMPLETE', `render provenance incomplete: ${provenance.problems.join('; ')}`);
  if (!durationOk) fail('AUDIO_RENDER_DURATION_MISMATCH', `measured duration deviates ${durationDeviation}s from the recorded measurement beyond ${DURATION_TOLERANCE_S}s tolerance`);

  // Human approval is recorded truthfully, never invented.
  const approved = meta.human_verdict === 'use';
  const humanApproval = approved
    ? { state: 'APPROVED', verdict: meta.human_verdict, approved_by: meta.approved_by || null, approved_at: meta.approved_at || null, scope: 'FINAL_MUSIC_APPROVAL' }
    : { state: 'AWAITING_HUMAN_REVIEW', verdict: meta.human_verdict || 'unreviewed', approved_by: null, approved_at: null, scope: 'FINAL_MUSIC_APPROVAL' };

  const state = 'PRODUCTION_READY';
  const payload = {
    schema_version: SCHEMA_VERSION,
    artifact_type: 'audio-render',
    evidence_kind: EVIDENCE_KIND,
    render_class: renderClass,
    state,
    production_mix_sha256: observedSha,
    duration_seconds: probe.duration_seconds,
    audio: {
      codec: probe.codec, sample_rate: probe.sample_rate, channels: probe.channels,
      format: probe.format, byte_size: bytes.length,
      measured_duration_seconds: probe.duration_seconds,
      recorded_duration_seconds: Number.isFinite(recordedDuration) ? recordedDuration : null,
      duration_deviation_seconds: durationDeviation,
    },
    candidate: {
      candidate_id: meta.candidate_id || null,
      project_id: meta.project_id || options.projectId || null,
      backend: meta.backend || null,
      generation_status: meta.status,
      human_verdict: meta.human_verdict || null,
      human_approval: humanApproval,
    },
    provenance: {
      producer: PRODUCER,
      producer_type: 'deterministic_attestation',
      attester: ATTESTER_ID,
      generation_job_id: meta.generation_job_id || null,
      workflow_hash: meta.workflow_hash || null,
      brief_hash: meta.brief_hash || null,
      candidate_record_path: options.recordPath || dir,
    },
    note: 'Rendered-audio technical attestation only. Not aesthetic judgment; not human approval; not the final program mix.',
  };
  const digest = sha256(JSON.stringify(payload));
  return {
    schema_version: SCHEMA_VERSION,
    evidence_kind: EVIDENCE_KIND,
    render_class: renderClass,
    producer: options.producer || PRODUCER,
    attester: ATTESTER_ID,
    state,
    production_mix_sha256: observedSha,
    duration_seconds: probe.duration_seconds,
    audio: payload.audio,
    candidate: payload.candidate,
    provenance: payload.provenance,
    note: payload.note,
    payload_digest_sha256: digest,
    produced_by: PRODUCER,
    created_at: options.createdAt || nowIso(),
    package_run_id: options.runId || null,
  };
}

/* -------------------------------------------------------- materialize ------ */

function materializeAudioRenderEvidence(runDir, recordDir, options = {}) {
  const dir = path.resolve(runDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail('AUDIO_RENDER_RUN_NOT_FOUND', `package run folder not found: ${runDir}`);
  }
  const evidence = attestAudioRender(recordDir, options);
  const target = evidencePath(dir);
  // Idempotent: unchanged substantive digest keeps existing bytes/created_at.
  if (!options.force && fs.existsSync(target)) {
    try {
      const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (existing?.payload_digest_sha256 === evidence.payload_digest_sha256) {
        const existingBytes = fs.readFileSync(target);
        return { ok: true, written: false, path: target, sha256: sha256(existingBytes), state: evidence.state, production_mix_sha256: evidence.production_mix_sha256, payload_digest_sha256: evidence.payload_digest_sha256 };
      }
    } catch (_) { /* malformed evidence overwritten below */ }
  }
  const contents = `${JSON.stringify(evidence, null, 2)}\n`;
  atomicWrite(target, contents);
  return { ok: true, written: true, path: target, sha256: sha256(contents), state: evidence.state, production_mix_sha256: evidence.production_mix_sha256, payload_digest_sha256: evidence.payload_digest_sha256 };
}

/* ----------------------------------------------------------- verify -------- */

/*
 * Re-check already-materialized evidence against the live audio bytes.
 * Stale audio invalidates the evidence — never a silent pass.
 */
function verifyExistingEvidence(runDir, options = {}) {
  const target = evidencePath(runDir);
  if (!fs.existsSync(target)) fail('AUDIO_RENDER_EVIDENCE_MISSING', `${EVIDENCE_FILE} not found in run`);
  let recorded;
  try { recorded = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (_) { fail('AUDIO_RENDER_EVIDENCE_MALFORMED', `${EVIDENCE_FILE} is not valid JSON`); }
  if (recorded?.schema_version !== SCHEMA_VERSION && recorded?.schema_version !== 1) {
    fail('AUDIO_RENDER_SCHEMA_UNSUPPORTED', `evidence schema_version is ${recorded?.schema_version}`);
  }
  // Legacy v1 evidence carries no fidelity class. It remains historical and
  // technically valid, but class-sensitive QC cannot consume it — it must be
  // re-attested, never silently promoted.
  const legacy = recorded?.schema_version === 1;
  if (!legacy && !evidencePolicy.RENDER_CLASSES[recorded?.render_class]) {
    fail('AUDIO_RENDER_CLASS_UNKNOWN', `evidence render_class ${JSON.stringify(recorded?.render_class ?? null)} is not canonical`);
  }
  if (!recorded.provenance?.candidate_record_path) {
    return { ok: false, stale: true, reason: 'AUDIO_RENDER_RECORD_UNRESOLVABLE', message: 'evidence carries no candidate record path' };
  }
  const wavPath = path.join(path.resolve(recorded.provenance.candidate_record_path), 'production.wav');
  if (!fs.existsSync(wavPath)) {
    return { ok: false, stale: true, reason: 'AUDIO_RENDER_FILE_MISSING', message: 'attested production.wav no longer exists' };
  }
  const liveSha = sha256(fs.readFileSync(wavPath));
  if (liveSha !== recorded.production_mix_sha256) {
    return { ok: false, stale: true, reason: 'AUDIO_RENDER_STALE', message: 'audio bytes changed after evidence was recorded' };
  }
  return {
    ok: true, stale: false, legacy,
    render_class: legacy ? 'AUDIO_RENDER_CLASS_UNKNOWN' : recorded.render_class,
    production_mix_sha256: liveSha, recorded_state: recorded.state,
  };
}

/* ----------------------------------------------------------------- CLI ----- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') out.runDir = argv[++i];
    else if (arg === '--record') out.recordDir = argv[++i];
    else if (arg === '--project') out.projectId = argv[++i];
    else if (arg === '--render-class') out.renderClass = argv[++i];
    else if (arg === '--verify') out.verify = true;
    else if (arg === '--repo-root') out.repoRoot = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.runDir) throw new Error('--run is required');
    if (!options.verify && !options.recordDir) throw new Error('--record is required');
    const result = options.verify
      ? verifyExistingEvidence(path.resolve(options.runDir))
      : materializeAudioRenderEvidence(path.resolve(options.runDir), path.resolve(options.recordDir), { projectId: options.projectId, renderClass: options.renderClass });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'AUDIO_RENDER_FAILED', message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ATTESTER_ID, PRODUCER, EVIDENCE_KIND, EVIDENCE_FILE, STATES,
  SCHEMA_VERSION, DEFAULT_RENDER_CLASS, MUSIC_LANE_CLASSES,
  AudioRenderEvidenceError, probeAudio, loadCandidateRecord, validateProvenance,
  resolveRenderClass, attestAudioRender, materializeAudioRenderEvidence, verifyExistingEvidence,
  evidencePath, main,
};

if (require.main === module) main();
