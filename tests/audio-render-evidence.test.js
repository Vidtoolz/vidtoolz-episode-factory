'use strict';

/*
 * AUDIO_RENDER evidence bridge tests.
 *
 * Covers: RED missing-evidence control; real decodable audio acceptance;
 * zero-byte, undecodable, wrong-hash, provenance-gap, duration-mismatch
 * rejection; content-drift staleness; wrong-run binding; idempotency;
 * supersession; human-authority truthfulness; and the required-evidence
 * invariant extended so no mandatory producer-less kind remains.
 *
 * Fixture WAVs are synthesized deterministically (valid RIFF/pcm_s16le), so
 * ffprobe validation runs on real decodable audio without touching any
 * production asset.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');
const { tests, test } = require('./_helpers');

const ROOT = path.resolve(__dirname, '..');
const are = require('../scripts/audio-render-evidence.js');
const policy = require('../scripts/qc-evidence-policy.js');
const qc = require('../scripts/qc-director.js');

const REAL_CANARY = '2026-08-25-audio-render-evidence-canary';
const REAL_CANARY_DIR = path.join(ROOT, 'package-runs', REAL_CANARY);
const NOW = '2026-08-25T12:00:00.000Z';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/* ----------------------------------------------------- WAV synthesis ------- */

function writeWav(filePath, { seconds = 0.5, sampleRate = 44100, channels = 2 } = {}) {
  const numFrames = Math.max(1, Math.floor(seconds * sampleRate));
  const dataSize = numFrames * channels * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // fmt chunk size
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);            // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  const data = Buffer.alloc(dataSize);
  for (let i = 0; i < numFrames; i += 1) {
    const sample = Math.round(3000 * Math.sin((2 * Math.PI * 220 * i) / sampleRate));
    for (let c = 0; c < channels; c += 1) data.writeInt16LE(sample, (i * channels + c) * 2);
  }
  fs.writeFileSync(filePath, Buffer.concat([header, data]));
  return filePath;
}

function ffprobeDuration(filePath) {
  const raw = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', filePath], { encoding: 'utf8' });
  return Number(JSON.parse(raw).format.duration);
}

/* ------------------------------------------------- candidate record -------- */

function fixtureRecord(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-record-'));
  const wavPath = path.join(dir, 'production.wav');
  writeWav(wavPath, { seconds: over.seconds ?? 0.5, sampleRate: over.sampleRate ?? 44100, channels: over.channels ?? 2 });
  const bytes = fs.readFileSync(wavPath);
  const meta = {
    candidate_id: over.candidateId || 'fixture-candidate-001',
    project_id: over.projectId || 'fixture-project',
    backend: 'fixture',
    status: over.status ?? 'completed',
    human_verdict: over.humanVerdict ?? null,
    approved_by: over.approvedBy ?? null,
    approved_at: over.approvedAt ?? null,
    output_sha256: over.outputSha256 ?? sha256(bytes),
    measured_duration_seconds: over.measuredDuration ?? ffprobeDuration(wavPath),
    requested_duration_s: over.requestedDuration ?? 0.5,
    generation_job_id: 'generationJobId' in over ? over.generationJobId : 'fixture-job-1',
    workflow_hash: over.workflowHash ?? sha256('workflow'),
    brief_hash: 'briefHash' in over ? over.briefHash : sha256('brief'),
  };
  fs.writeFileSync(path.join(dir, 'music-candidate.json'), JSON.stringify(meta, null, 2) + '\n');
  return { dir, wavPath, meta };
}

function qcRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-qcroot-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  return root;
}

function qcInspect(task, repoRoot) {
  return qc.run(task, { now: NOW, repoRoot });
}

function writeRunFile(repoRoot, runId, name, contents) {
  const dir = path.join(repoRoot, 'package-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), contents);
  return path.join(dir, name);
}

/* ------------------------------------------------------- RED baseline ------ */

test('AR1 (RED negative control): no AUDIO_RENDER evidence keeps the QC blocker', () => {
  const repoRoot = qcRoot();
  const result = qcInspect({
    task_id: 'ar-red-1', package_run_id: 'ar-fixture', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'export-check',
    subject: { artifact_id: 'mix-1', artifact_type: 'AUDIO_RENDER', producing_agent: 'sound_music_director' },
    evidence: [], required_evidence: ['AUDIO_RENDER'], privacy: { local_only: true },
  }, repoRoot);
  assert.equal(result.disposition, 'BLOCKED');
  assert.ok((result.blockers || []).some((b) => b.code === 'QC_REQUIRED_EVIDENCE_MISSING'));
  assert.ok(JSON.stringify(result.blockers).includes('AUDIO_RENDER'));
});

/* ------------------------------------------------------- GREEN baseline ---- */

test('AR2: real decodable audio attests PRODUCTION_READY and satisfies QC', () => {
  const rec = fixtureRecord();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-run-'));
  fs.writeFileSync(path.join(runDir, 'final-script.md'), '# x\n');
  const materialized = are.materializeAudioRenderEvidence(runDir, rec.dir, { projectId: 'fixture-project' });
  assert.equal(materialized.state, 'PRODUCTION_READY');

  const evBytes = fs.readFileSync(materialized.path);
  const payload = JSON.parse(evBytes.toString('utf8'));
  assert.equal(payload.schema_version, are.SCHEMA_VERSION);
  assert.equal(payload.evidence_kind, 'AUDIO_RENDER');
  assert.equal(payload.produced_by, 'sound_music_director');
  assert.equal(payload.production_mix_sha256, sha256(fs.readFileSync(rec.wavPath)));
  assert.ok(payload.audio.sample_rate > 0);
  assert.ok(payload.audio.channels > 0);

  // QC consumption in a hermetic repo.
  const repoRoot = qcRoot();
  writeRunFile(repoRoot, 'ar2-run', 'audio-render-evidence.json', evBytes);
  const wavBytes = fs.readFileSync(rec.wavPath);
  writeRunFile(repoRoot, 'ar2-run', 'production.wav', wavBytes);
  const result = qcInspect({
    task_id: 'ar-green-1', package_run_id: 'ar2-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'export-check',
    subject: {
      artifact_id: 'mix-1', artifact_type: 'AUDIO_RENDER', producing_agent: 'sound_music_director',
      artifact_path: 'package-runs/ar2-run/production.wav', artifact_sha256: sha256(wavBytes),
      version_id: 'fixture-candidate-001',
    },
    evidence: [{
      evidence_id: 'audio-render', kind: 'AUDIO_RENDER', evidence_class: 'DETERMINISTIC',
      produced_by: 'sound_music_director', path: 'package-runs/ar2-run/audio-render-evidence.json',
      sha256: sha256(evBytes),
      binds_to: { artifact_id: 'mix-1', artifact_sha256: sha256(wavBytes), version_id: 'fixture-candidate-001' },
    }],
    required_evidence: ['AUDIO_RENDER'], privacy: { local_only: true },
  }, repoRoot);
  assert.notEqual(result.disposition, 'BLOCKED');
  assert.deepEqual(result.evidence_coverage.missing, []);
});

/* ------------------------------------------------------- zero byte --------- */

test('AR3: zero-byte production.wav is rejected', () => {
  const rec = fixtureRecord();
  fs.writeFileSync(rec.wavPath, Buffer.alloc(0));
  assert.throws(
    () => are.attestAudioRender(rec.dir),
    (e) => e.code === 'AUDIO_RENDER_FILE_EMPTY',
  );
});

/* ------------------------------------------------------- undecodable ------- */

test('AR4: undecodable audio is rejected', () => {
  const rec = fixtureRecord();
  fs.writeFileSync(rec.wavPath, Buffer.from('this is not audio at all'));
  // fix the record hash so we pass the hash check and hit ffprobe instead
  const meta = JSON.parse(fs.readFileSync(path.join(rec.dir, 'music-candidate.json'), 'utf8'));
  meta.output_sha256 = sha256(fs.readFileSync(rec.wavPath));
  fs.writeFileSync(path.join(rec.dir, 'music-candidate.json'), JSON.stringify(meta, null, 2) + '\n');
  assert.throws(
    () => are.attestAudioRender(rec.dir),
    (e) => ['AUDIO_RENDER_UNDECODABLE', 'AUDIO_RENDER_NO_AUDIO_STREAM', 'AUDIO_RENDER_DURATION_INVALID'].includes(e.code),
  );
});

/* ------------------------------------------------------- wrong hash -------- */

test('AR5: bytes not matching the recorded output_sha256 are rejected', () => {
  const rec = fixtureRecord({ outputSha256: 'f'.repeat(64) });
  assert.throws(
    () => are.attestAudioRender(rec.dir),
    (e) => e.code === 'AUDIO_RENDER_HASH_MISMATCH',
  );
});

/* ------------------------------------------------------- provenance -------- */

test('AR8: incomplete render provenance is rejected', () => {
  const rec = fixtureRecord({ generationJobId: null, briefHash: null });
  assert.throws(
    () => are.attestAudioRender(rec.dir),
    (e) => e.code === 'AUDIO_RENDER_PROVENANCE_INCOMPLETE',
  );
});

/* ------------------------------------------------------- duration ---------- */

test('AR9: materially wrong duration is rejected beyond tolerance', () => {
  const rec = fixtureRecord({ measuredDuration: 999.0 });
  assert.throws(
    () => are.attestAudioRender(rec.dir),
    (e) => e.code === 'AUDIO_RENDER_DURATION_MISMATCH',
  );
});

test('AR10: channel and sample rate are measured, not invented', () => {
  const rec = fixtureRecord({ sampleRate: 48000, channels: 1 });
  const evidence = are.attestAudioRender(rec.dir);
  assert.equal(evidence.audio.sample_rate, 48000);
  assert.equal(evidence.audio.channels, 1);
});

/* ------------------------------------------------------- content drift ----- */

test('AR6: audio changed after evidence is reported stale', () => {
  const rec = fixtureRecord();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-run6-'));
  fs.writeFileSync(path.join(runDir, 'final-script.md'), '# x\n');
  are.materializeAudioRenderEvidence(runDir, rec.dir);
  // mutate the audio bytes, update the record hash so the record stays valid
  fs.writeFileSync(rec.wavPath, Buffer.concat([fs.readFileSync(rec.wavPath), Buffer.from('x')]));
  const meta = JSON.parse(fs.readFileSync(path.join(rec.dir, 'music-candidate.json'), 'utf8'));
  meta.output_sha256 = sha256(fs.readFileSync(rec.wavPath));
  meta.measured_duration_seconds = ffprobeDuration(rec.wavPath);
  fs.writeFileSync(path.join(rec.dir, 'music-candidate.json'), JSON.stringify(meta, null, 2) + '\n');
  const verify = are.verifyExistingEvidence(runDir);
  assert.equal(verify.ok, false);
  assert.equal(verify.stale, true);
  assert.equal(verify.reason, 'AUDIO_RENDER_STALE');
});

/* ------------------------------------------------------- wrong run --------- */

test('AR7: evidence bound to a different artifact is rejected by QC', () => {
  const rec = fixtureRecord();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-run7-'));
  fs.writeFileSync(path.join(runDir, 'final-script.md'), '# x\n');
  const materialized = are.materializeAudioRenderEvidence(runDir, rec.dir);
  const evBytes = fs.readFileSync(materialized.path);
  const repoRoot = qcRoot();
  writeRunFile(repoRoot, 'ar7-run', 'audio-render-evidence.json', evBytes);
  const wavBytes = fs.readFileSync(rec.wavPath);
  writeRunFile(repoRoot, 'ar7-run', 'production.wav', wavBytes);
  const result = qcInspect({
    task_id: 'ar-wrongrun', package_run_id: 'ar7-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'export-check',
    subject: {
      artifact_id: 'mix-OTHER', artifact_type: 'AUDIO_RENDER', producing_agent: 'sound_music_director',
      artifact_path: 'package-runs/ar7-run/production.wav', artifact_sha256: sha256(wavBytes),
    },
    evidence: [{
      evidence_id: 'audio-render', kind: 'AUDIO_RENDER', evidence_class: 'DETERMINISTIC',
      produced_by: 'sound_music_director', path: 'package-runs/ar7-run/audio-render-evidence.json',
      sha256: sha256(evBytes),
      binds_to: { artifact_id: 'mix-1', artifact_sha256: sha256(wavBytes) },
    }],
    required_evidence: ['AUDIO_RENDER'], privacy: { local_only: true },
  }, repoRoot);
  assert.equal(result.disposition, 'BLOCKED');
  assert.ok((result.blockers || []).some((b) => b.code === 'QC_EVIDENCE_ARTIFACT_MISMATCH'));
});

/* ------------------------------------------------------- idempotency ------- */

test('AR11: same audio bytes + same metadata = no churn', () => {
  const rec = fixtureRecord();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-run11-'));
  fs.writeFileSync(path.join(runDir, 'final-script.md'), '# x\n');
  const first = are.materializeAudioRenderEvidence(runDir, rec.dir);
  const second = are.materializeAudioRenderEvidence(runDir, rec.dir);
  assert.equal(second.written, false);
  assert.equal(second.sha256, first.sha256);
  assert.equal(second.payload_digest_sha256, first.payload_digest_sha256);
});

/* ------------------------------------------------------- supersession ------ */

test('AR12: superseding render invalidates v1 evidence for the v2 context', () => {
  const rec = fixtureRecord({ candidateId: 'cand-v1' });
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-run12-'));
  fs.writeFileSync(path.join(runDir, 'final-script.md'), '# x\n');
  are.materializeAudioRenderEvidence(runDir, rec.dir);
  // v2 render: different audio bytes in the same record location
  writeWav(rec.wavPath, { seconds: 0.8 });
  const meta = JSON.parse(fs.readFileSync(path.join(rec.dir, 'music-candidate.json'), 'utf8'));
  meta.candidate_id = 'cand-v2';
  meta.output_sha256 = sha256(fs.readFileSync(rec.wavPath));
  meta.measured_duration_seconds = ffprobeDuration(rec.wavPath);
  fs.writeFileSync(path.join(rec.dir, 'music-candidate.json'), JSON.stringify(meta, null, 2) + '\n');
  const verify = are.verifyExistingEvidence(runDir);
  assert.equal(verify.ok, false, 'v1 evidence must not satisfy a superseded render');
  assert.equal(verify.stale, true);
});

/* ------------------------------------------------------- human authority --- */

test('AR13: human approval state is recorded truthfully, never invented', () => {
  const unreviewed = fixtureRecord({ humanVerdict: null });
  const ev1 = are.attestAudioRender(unreviewed.dir);
  assert.equal(ev1.candidate.human_approval.state, 'AWAITING_HUMAN_REVIEW');
  assert.equal(ev1.state, 'PRODUCTION_READY', 'technical readiness does not require human approval');

  const approved = fixtureRecord({ humanVerdict: 'use', approvedBy: 'mikko', approvedAt: '2026-08-25T09:00:00Z' });
  const ev2 = are.attestAudioRender(approved.dir);
  assert.equal(ev2.candidate.human_approval.state, 'APPROVED');
  assert.equal(ev2.candidate.human_approval.approved_by, 'mikko');
});

/* ------------------------------------------------------- real canary ------- */

test('AR14: the bounded canary evidence satisfies QC (hermetic copy)', () => {
  const srcBytes = fs.readFileSync(path.join(REAL_CANARY_DIR, 'audio-render-evidence.json'));
  const payload = JSON.parse(srcBytes.toString('utf8'));
  const wavBytes = fs.readFileSync(path.join(REAL_CANARY_DIR, 'audio/production.wav'));
  assert.equal(payload.production_mix_sha256, sha256(wavBytes), 'canary evidence is bound to the real audio bytes');
  const repoRoot = qcRoot();
  writeRunFile(repoRoot, REAL_CANARY, 'audio-render-evidence.json', srcBytes);
  writeRunFile(repoRoot, REAL_CANARY, 'production.wav', wavBytes);
  const result = qcInspect({
    task_id: 'ar-canary-green', package_run_id: REAL_CANARY, requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'export-check',
    subject: {
      artifact_id: 'ar-canary-production-wav', artifact_type: 'AUDIO_RENDER', producing_agent: 'sound_music_director',
      artifact_path: `package-runs/${REAL_CANARY}/production.wav`, artifact_sha256: sha256(wavBytes),
      version_id: 'music-candidate-004',
    },
    evidence: [{
      evidence_id: 'audio-render', kind: 'AUDIO_RENDER', evidence_class: 'DETERMINISTIC',
      produced_by: payload.produced_by, path: `package-runs/${REAL_CANARY}/audio-render-evidence.json`,
      sha256: sha256(srcBytes),
      binds_to: { artifact_id: 'ar-canary-production-wav', artifact_sha256: payload.production_mix_sha256, version_id: 'music-candidate-004' },
    }],
    required_evidence: ['AUDIO_RENDER'], privacy: { local_only: true },
  }, repoRoot);
  assert.notEqual(result.disposition, 'BLOCKED');
  assert.deepEqual(result.evidence_coverage.missing, []);
});

/* ------------------------------------------------------- invariant --------- */

test('AR15: after this mission no mandatory QC evidence kind lacks a reachable producer', () => {
  for (const kind of qc.SUPPORTED_EVIDENCE_KINDS) {
    const row = policy.EVIDENCE_POLICY[kind];
    assert.ok(row, `required evidence ${kind} has no applicability policy row`);
    assert.ok(row.producer_module, `required evidence ${kind} has no declared producer module`);
    assert.ok(fs.existsSync(path.join(ROOT, row.producer_module)), `${kind}: producer module missing: ${row.producer_module}`);
  }
  // AUDIO_RENDER specifically must no longer be the conditional gap.
  const source = fs.readFileSync(path.join(ROOT, 'scripts/audio-render-evidence.js'), 'utf8');
  assert.ok(source.includes('AUDIO_RENDER'), 'attester module owns the AUDIO_RENDER contract');
});

module.exports = { tests };
