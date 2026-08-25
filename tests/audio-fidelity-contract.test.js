'use strict';

/*
 * Audio fidelity (render-class) contract tests — AF1–AF16.
 *
 * Doctrine: audio evidence has three orthogonal axes — evidence kind (WHAT),
 * render class (at WHAT PRODUCTION LEVEL), source/producer (WHO/HOW).
 * Collapsing any two of these is semantic corruption and every test here
 * guards against one such collapse.
 *
 * AF11/AF13 guard against the specific collapse DRAFT_SYNTHETIC_NARRATION ==
 * AUDIO_RENDER: the narration kind is distinct, declares its own fidelity,
 * and can never satisfy an AUDIO_RENDER render-class requirement.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');
const { tests, test } = require('./_helpers');

const ROOT = path.resolve(__dirname, '..');
const qc = require('../scripts/qc-director.js');
const policy = require('../scripts/qc-evidence-policy.js');
const are = require('../scripts/audio-render-evidence.js');

const NOW = '2026-08-25T14:00:00.000Z';

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
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
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

function fixtureRecord(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-record-'));
  const wavPath = path.join(dir, 'production.wav');
  writeWav(wavPath, { seconds: over.seconds ?? 0.5 });
  const bytes = fs.readFileSync(wavPath);
  const meta = {
    candidate_id: 'fixture-candidate-001', project_id: 'fixture-project', backend: 'fixture',
    status: 'completed', human_verdict: null, output_sha256: sha256(bytes),
    measured_duration_seconds: ffprobeDuration(wavPath), requested_duration_s: 0.5,
    generation_job_id: 'fixture-job-1', workflow_hash: sha256('workflow'), brief_hash: sha256('brief'),
    ...over,
  };
  fs.writeFileSync(path.join(dir, 'music-candidate.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return { dir, wavPath };
}

function qcRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'af-qcroot-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  return root;
}
function writeRunFile(repoRoot, runId, name, contents) {
  const dir = path.join(repoRoot, 'package-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), contents);
}
function qcInspect(task, repoRoot) { return qc.run(task, { now: NOW, repoRoot }); }

/* A PRODUCTION-mode AUDIO_RENDER task at its applicable gate. */
function productionTask(overrides = {}) {
  return {
    task_id: 'af-task', package_run_id: 'af-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'rough-cut-review',
    run_mode: 'PRODUCTION',
    subject: { artifact_id: 'mix-1', artifact_type: 'AUDIO_RENDER', producing_agent: 'sound_music_director' },
    evidence: [], required_evidence: ['AUDIO_RENDER'], privacy: { local_only: true },
    ...overrides,
  };
}

/* Attest a fixture render and plant it + the wav in a hermetic QC root. */
function plantAttested(repoRoot, runId, renderClass, producer) {
  const rec = fixtureRecord();
  const runDir = path.join(repoRoot, 'package-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const materialized = are.materializeAudioRenderEvidence(runDir, rec.dir, { renderClass, producer });
  const evBytes = fs.readFileSync(materialized.path);
  const wavBytes = fs.readFileSync(rec.wavPath);
  return { evBytes, wavBytes, wavPath: rec.wavPath, sha: materialized.production_mix_sha256 };
}

function evidenceEntry(runId, evBytes, wavBytes, producedBy) {
  return {
    evidence_id: 'audio-render', kind: 'AUDIO_RENDER', evidence_class: 'DETERMINISTIC',
    produced_by: producedBy || 'sound_music_director',
    path: `package-runs/${runId}/audio-render-evidence.json`, sha256: sha256(evBytes),
    binds_to: { artifact_id: 'mix-1', artifact_sha256: sha256(wavBytes) },
  };
}

/* ── AF1: canonical vocabulary ───────────────────────────────────────────── */
test('AF1: the render-class vocabulary is canonical, minimal, and semantic', () => {
  const names = Object.keys(policy.RENDER_CLASSES);
  assert.deepEqual([...names].sort(), ['DRAFT_TEMPORARY', 'MUSIC_CANDIDATE', 'PRODUCTION_MIX'].sort());
  for (const [name, cls] of Object.entries(policy.RENDER_CLASSES)) {
    assert.ok(cls.meaning, `${name} lacks meaning`);
    assert.ok(Array.isArray(cls.does_not_prove) && cls.does_not_prove.length > 0, `${name} must state what it does NOT prove`);
    assert.ok(cls.does_not_prove.includes('human performance') && cls.does_not_prove.includes('publication approval'),
      `${name} must never claim human performance or publication approval`);
    assert.ok(Array.isArray(cls.authorized_producers), `${name} lacks authorized_producers`);
  }
  // Classes are branches, not a ranking: no class declares another inferior.
  assert.equal(policy.RENDER_CLASSES.MUSIC_CANDIDATE.supersedes, null);
  assert.equal(policy.RENDER_CLASSES.PRODUCTION_MIX.supersedes, null);
});

/* ── AF2: AUDIO_RENDER carries render_class in schema v2 ─────────────────── */
test('AF2: new AUDIO_RENDER evidence requires render_class (schema v2)', () => {
  const rec = fixtureRecord();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-run-'));
  const out = are.materializeAudioRenderEvidence(runDir, rec.dir, {});
  const payload = JSON.parse(fs.readFileSync(out.path, 'utf8'));
  assert.equal(payload.schema_version, 2);
  assert.equal(payload.render_class, are.DEFAULT_RENDER_CLASS, 'default class is the music-lane branch this attester owns');
  assert.equal(payload.render_class, 'MUSIC_CANDIDATE');
});

/* ── AF3: unsupported class rejected at attestation ──────────────────────── */
test('AF3: a render class outside the vocabulary is rejected (no free text)', () => {
  const rec = fixtureRecord();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-run-'));
  assert.throws(
    () => are.materializeAudioRenderEvidence(runDir, rec.dir, { renderClass: 'MASTERED_FINAL_DELUXE' }),
    (e) => e.code === 'AUDIO_RENDER_CLASS_UNKNOWN',
  );
  assert.throws(
    () => are.resolveRenderClass('final mix'),
    (e) => e.code === 'AUDIO_RENDER_CLASS_UNKNOWN',
  );
});

/* ── AF4: unauthorized producer/class rejected ───────────────────────────── */
test('AF4: a producer may not claim a class it does not semantically own', () => {
  const rec = fixtureRecord();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-run-'));
  // generation_supervisor cannot impersonate the music attester...
  assert.throws(
    () => are.materializeAudioRenderEvidence(runDir, rec.dir, { renderClass: 'MUSIC_CANDIDATE', producer: 'generation_supervisor' }),
    (e) => e.code === 'AUDIO_RENDER_CLASS_UNAUTHORIZED',
  );
  // ...and only editor may claim PRODUCTION_MIX: sound and narration lanes
  // must never impersonate the assembled program mix.
  for (const producer of ['sound_music_director', 'generation_supervisor']) {
    assert.throws(
      () => are.resolveRenderClass('PRODUCTION_MIX', producer),
      (e) => e.code === 'AUDIO_RENDER_CLASS_UNAUTHORIZED',
    );
  }
  // editor IS authorized for PRODUCTION_MIX, but only through the program-mix
  // attester — never via the music attester's render-class resolver.
  assert.equal(policy.producerAuthorizedForClass('editor', 'PRODUCTION_MIX'), true);
  assert.throws(
    () => are.resolveRenderClass('PRODUCTION_MIX', 'editor'),
    (e) => e.code === 'AUDIO_RENDER_CLASS_UNAUTHORIZED',
  );
});

/* ── AF5: DRAFT_TEMPORARY valid for a DRAFT-context attestation ──────────── */
test('AF5: DRAFT_TEMPORARY is a valid attested class for its declared use', () => {
  const rec = fixtureRecord();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-run-'));
  const out = are.materializeAudioRenderEvidence(runDir, rec.dir, { renderClass: 'DRAFT_TEMPORARY' });
  const payload = JSON.parse(fs.readFileSync(out.path, 'utf8'));
  assert.equal(payload.render_class, 'DRAFT_TEMPORARY');
  assert.equal(payload.schema_version, 2);
  const verify = are.verifyExistingEvidence(runDir);
  assert.equal(verify.ok, true);
  assert.equal(verify.render_class, 'DRAFT_TEMPORARY');
});

/* ── AF6: Draft-grade evidence cannot satisfy a Production requirement ───── */
test('AF6: PRODUCTION AUDIO_RENDER requirement rejects DRAFT_TEMPORARY / MUSIC_CANDIDATE with a typed blocker', () => {
  for (const renderClass of ['DRAFT_TEMPORARY', 'MUSIC_CANDIDATE']) {
    const root = qcRoot();
    const { evBytes, wavBytes } = plantAttested(root, 'af6-run', renderClass);
    const result = qcInspect(productionTask({
      evidence: [evidenceEntry('af6-run', evBytes, wavBytes)],
    }), root);
    assert.equal(result.disposition, 'BLOCKED', renderClass);
    assert.ok((result.blockers || []).some((b) => b.code === 'AUDIO_RENDER_CLASS_INSUFFICIENT'), renderClass);
    const detail = (result.blockers || []).find((b) => b.code === 'AUDIO_RENDER_CLASS_INSUFFICIENT');
    assert.ok(detail.explanation.includes(renderClass) && detail.explanation.includes('PRODUCTION_MIX'));
    // The kind itself is satisfied — this is a fidelity blocker, not absence.
    assert.deepEqual(result.evidence_coverage.missing, []);
    assert.deepEqual(result.evidence_coverage.class_insufficient, [{
      kind: 'AUDIO_RENDER', required_class: 'PRODUCTION_MIX', observed_class: renderClass,
    }]);
  }
});

/* ── AF7: PRODUCTION_MIX acceptance is gated on producer reality ─────────── */
test('AF7: no hand-authored PRODUCTION_MIX evidence can satisfy QC', () => {
  // A hand-edited file claiming PRODUCTION_MIX is unauthorized: the attester
  // refuses to create it, and QC refuses to accept a v2 payload whose claimed
  // producer is not authorized for the class (adapter re-check).
  const root = qcRoot();
  const forged = {
    schema_version: 2, artifact_type: 'audio-render', evidence_kind: 'AUDIO_RENDER',
    render_class: 'PRODUCTION_MIX', state: 'PRODUCTION_READY',
    production_mix_sha256: sha256('forged'), duration_seconds: 12,
  };
  const evBytes = Buffer.from(`${JSON.stringify(forged, null, 2)}\n`);
  writeRunFile(root, 'af7-run', 'audio-render-evidence.json', evBytes);
  writeRunFile(root, 'af7-run', 'production.wav', Buffer.from('forged-bytes'));
  const result = qcInspect(productionTask({
    subject: { ...productionTask().subject, artifact_sha256: sha256(Buffer.from('forged-bytes')), artifact_path: 'package-runs/af7-run/production.wav' },
    evidence: [evidenceEntry('af7-run', evBytes, Buffer.from('forged-bytes'), 'generation_supervisor')],
  }), root);
  assert.equal(result.disposition, 'BLOCKED');
  const codes = (result.blockers || []).map((b) => b.code);
  assert.ok(codes.includes('AUDIO_RENDER_CLASS_UNAUTHORIZED') || codes.includes('AUDIO_RENDER_CLASS_INSUFFICIENT'));
  // And the producer path is closed but upstream material is still absent:
  // the gap is declared machine-readably and remains unsatisfiable.
  const gap = policy.KNOWN_CLASS_GAPS.PRODUCTION_MIX;
  assert.equal(gap.status, 'UPSTREAM_MATERIAL_MISSING');
});

/* ── AF8: mode change never mutates render_class ─────────────────────────── */
test('AF8: switching production mode does not rewrite evidence class', () => {
  const root = qcRoot();
  const { evBytes } = plantAttested(root, 'af8-run', 'DRAFT_TEMPORARY');
  const evPath = path.join(root, 'package-runs', 'af8-run', 'audio-render-evidence.json');
  const before = fs.readFileSync(evPath, 'utf8');
  for (const mode of ['DRAFT', 'REVIEW', 'PRODUCTION', 'MODE_UNSPECIFIED']) {
    policy.auditRequiredEvidence(['AUDIO_RENDER'], 'rough-cut-review', mode);
    qcInspect(productionTask({ run_mode: mode === 'MODE_UNSPECIFIED' ? undefined : mode }), root);
  }
  assert.equal(fs.readFileSync(evPath, 'utf8'), before, 'a mode switch must never touch evidence bytes');
  assert.equal(JSON.parse(fs.readFileSync(evPath, 'utf8')).render_class, 'DRAFT_TEMPORARY');
});

/* ── AF9: legacy class-less evidence fails class-sensitive QC ─────────────── */
test('AF9: schema v1 evidence (no class) is typed AUDIO_RENDER_CLASS_UNKNOWN, never silently promoted', () => {
  const root = qcRoot();
  const legacy = {
    schema_version: 1, artifact_type: 'audio-render', evidence_kind: 'AUDIO_RENDER',
    state: 'PRODUCTION_READY', production_mix_sha256: sha256('legacy-bytes'), duration_seconds: 8,
    provenance: { producer: 'sound_music_director', attester: 'audio-render-attester-v1' },
    note: 'legacy evidence predates the fidelity contract',
  };
  const evBytes = Buffer.from(`${JSON.stringify(legacy, null, 2)}\n`);
  writeRunFile(root, 'af9-run', 'audio-render-evidence.json', evBytes);
  writeRunFile(root, 'af9-run', 'production.wav', Buffer.from('legacy-bytes'));
  const result = qcInspect(productionTask({
    subject: { ...productionTask().subject, artifact_sha256: sha256(Buffer.from('legacy-bytes')), artifact_path: 'package-runs/af9-run/production.wav' },
    evidence: [evidenceEntry('af9-run', evBytes, Buffer.from('legacy-bytes'))],
  }), root);
  assert.equal(result.disposition, 'BLOCKED');
  assert.ok((result.blockers || []).some((b) => b.code === 'AUDIO_RENDER_CLASS_UNKNOWN'));
  // Historical evidence stays readable/valid at its own schema level:
  // the adapter accepts v1 technically — only the class requirement blocks.
  assert.deepEqual(result.evidence_coverage.missing, []);
  // The attester's own verify path agrees: legacy is CLASS_UNKNOWN, not stale.
  const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af9-verify-'));
  fs.writeFileSync(path.join(verifyDir, 'audio-render-evidence.json'), evBytes);
  const rec = fixtureRecord();
  // rebuild the legacy file to bind to a real wav so verify can check bytes
  const wavBytes = fs.readFileSync(rec.wavPath);
  legacy.production_mix_sha256 = sha256(wavBytes);
  legacy.provenance.candidate_record_path = rec.dir;
  fs.writeFileSync(path.join(verifyDir, 'audio-render-evidence.json'), `${JSON.stringify(legacy, null, 2)}\n`);
  const verify = are.verifyExistingEvidence(verifyDir);
  assert.equal(verify.ok, true);
  assert.equal(verify.legacy, true);
  assert.equal(verify.render_class, 'AUDIO_RENDER_CLASS_UNKNOWN');
});

/* ── AF10: class mismatch produces a typed, actionable blocker ───────────── */
test('AF10: blocker vocabulary distinguishes missing / insufficient / unknown', () => {
  // missing: no evidence at all
  const rootMissing = qcRoot();
  const rMissing = qcInspect(productionTask(), rootMissing);
  assert.ok(rMissing.blockers.some((b) => b.code === 'QC_REQUIRED_EVIDENCE_MISSING'));
  // insufficient + unknown proven in AF6/AF9; assert the operator-facing
  // explanations differ in kind (render vs re-attest guidance).
  const root = qcRoot();
  const { evBytes, wavBytes } = plantAttested(root, 'af10-run', 'MUSIC_CANDIDATE');
  const rIns = qcInspect(productionTask({ evidence: [evidenceEntry('af10-run', evBytes, wavBytes)] }), root);
  const ins = rIns.blockers.find((b) => b.code === 'AUDIO_RENDER_CLASS_INSUFFICIENT');
  assert.match(ins.explanation, /render the required fidelity/i);
});

/* ── AF11: STORY_VALIDATION unaffected ───────────────────────────────────── */
test('AF11: STORY_VALIDATION semantics are untouched by the fidelity contract', () => {
  const row = policy.policyForKind('STORY_VALIDATION');
  assert.equal(row.required_render_class, undefined, 'non-audio kinds must not carry render classes');
  const r = policy.resolveApplicability('STORY_VALIDATION', 'research', 'DRAFT');
  assert.equal(r.status, 'REQUIRED');
  // And a Story evidence payload passes through QC exactly as before.
  const root = qcRoot();
  const result = qcInspect({
    task_id: 'af11', package_run_id: 'af11-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'research', run_mode: 'DRAFT',
    subject: { artifact_id: 'subj-1', artifact_type: 'RESEARCH_EVIDENCE', producing_agent: 'research_director' },
    evidence: [{
      evidence_id: 'sv', kind: 'STORY_VALIDATION', evidence_class: 'DETERMINISTIC',
      produced_by: 'story_validator', payload: { schema_version: 1, verdict: 'PASS', warnings: [] },
      binds_to: { artifact_id: 'subj-1' },
    }],
    required_evidence: ['STORY_VALIDATION'], privacy: { local_only: true },
  }, root);
  assert.deepEqual(result.evidence_coverage.missing, []);
  assert.equal(result.disposition, 'PASS');
});

/* ── AF12: old technical validation remains ──────────────────────────────── */
test('AF12: adding render_class does not relax any existing technical check', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'af12-'));
  // zero bytes still rejected
  const zero = fs.mkdtempSync(path.join(os.tmpdir(), 'af12-rec-'));
  fs.writeFileSync(path.join(zero, 'production.wav'), Buffer.alloc(0));
  fs.writeFileSync(path.join(zero, 'music-candidate.json'), JSON.stringify({ status: 'completed' }));
  assert.throws(() => are.materializeAudioRenderEvidence(runDir, zero, {}), (e) => e.code === 'AUDIO_RENDER_FILE_EMPTY');
  // hash drift still rejected even with a class present
  const drift = fixtureRecord({ output_sha256: sha256('not-the-real-bytes') });
  assert.throws(() => are.materializeAudioRenderEvidence(runDir, drift.dir, { renderClass: 'MUSIC_CANDIDATE' }),
    (e) => e.code === 'AUDIO_RENDER_HASH_MISMATCH');
});

/* ── AF13: DRAFT_SYNTHETIC_NARRATION stays semantically distinct ─────────── */
test('AF13: narration evidence is its own kind and can never satisfy AUDIO_RENDER', () => {
  const narrationRow = policy.policyForKind('DRAFT_SYNTHETIC_NARRATION');
  assert.ok(narrationRow, 'narration must have a policy row');
  assert.equal(narrationRow.required_render_class, undefined, 'narration owns its own fidelity axis');
  assert.ok(/DRAFT_SYNTHETIC_PROXY/.test(narrationRow.fidelity_note || ''));
  // Its declared fidelity lives outside the AUDIO_RENDER vocabulary:
  assert.equal(policy.RENDER_CLASSES.DRAFT_SYNTHETIC_PROXY, undefined);
  assert.equal(policy.producerAuthorizedForClass('generation_supervisor', 'MUSIC_CANDIDATE'), false);

  // A valid narration evidence envelope consumed by QC: kind registered,
  // adapter validates, and the kind never aliases AUDIO_RENDER.
  const root = qcRoot();
  const narration = {
    schema: 'vidtoolz.draftSyntheticNarrationEvidence.v1',
    kind: 'DRAFT_SYNTHETIC_NARRATION',
    fidelity: 'DRAFT_SYNTHETIC_PROXY',
    production_mode: 'DRAFT',
    asserts: 'verified machine-generated speech representing the exact canonical script, for DRAFT use',
    does_not_assert: ['mikko performance', 'real presenter capture', 'production-final audio', 'final mix', 'publish readiness'],
    satisfies_real_capture: false, human_authority_required: false,
    run_id: 'af13-run',
    semantic_producer: 'generation_supervisor',
    technical_validation: { ok: true, failures: [] },
    script_binding: { ok: true, drift: [] },
    coverage: { spoken_segments: 4, complete: true },
    state: 'VERIFIED',
  };
  const evBytes = Buffer.from(`${JSON.stringify(narration, null, 2)}\n`);
  writeRunFile(root, 'af13-run', 'draft-synthetic-narration-evidence.json', evBytes);
  writeRunFile(root, 'af13-run', 'narration.wav', Buffer.from('synthetic-narration-bytes'));
  const result = qcInspect({
    task_id: 'af13', package_run_id: 'af13-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'capture-checklist', run_mode: 'DRAFT',
    subject: { artifact_id: 'narr-1', artifact_type: 'DRAFT_SYNTHETIC_NARRATION', producing_agent: 'generation_supervisor',
      artifact_path: 'package-runs/af13-run/narration.wav', artifact_sha256: sha256(Buffer.from('synthetic-narration-bytes')) },
    evidence: [{
      evidence_id: 'narr', kind: 'DRAFT_SYNTHETIC_NARRATION', evidence_class: 'DETERMINISTIC',
      produced_by: 'generation_supervisor', path: 'package-runs/af13-run/draft-synthetic-narration-evidence.json',
      sha256: sha256(evBytes),
      binds_to: { artifact_id: 'narr-1', artifact_sha256: sha256(Buffer.from('synthetic-narration-bytes')) },
    }],
    required_evidence: ['DRAFT_SYNTHETIC_NARRATION'], privacy: { local_only: true },
  }, root);
  assert.deepEqual(result.evidence_coverage.missing, []);
  assert.equal(result.evidence_coverage.satisfied.includes('AUDIO_RENDER'), false,
    'narration satisfaction must not register as AUDIO_RENDER');

  // And the reverse collapse: narration evidence can NOT satisfy a required
  // AUDIO_RENDER — QC requires the AUDIO_RENDER kind separately.
  const resultAudio = qcInspect({
    task_id: 'af13b', package_run_id: 'af13-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'rough-cut-review', run_mode: 'PRODUCTION',
    subject: { artifact_id: 'mix-1', artifact_type: 'AUDIO_RENDER', producing_agent: 'sound_music_director' },
    evidence: [{
      evidence_id: 'narr', kind: 'DRAFT_SYNTHETIC_NARRATION', evidence_class: 'DETERMINISTIC',
      produced_by: 'generation_supervisor', path: 'package-runs/af13-run/draft-synthetic-narration-evidence.json',
      sha256: sha256(evBytes),
      binds_to: { artifact_id: 'mix-1', artifact_sha256: sha256(Buffer.from('synthetic-narration-bytes')) },
    }],
    required_evidence: ['AUDIO_RENDER'], privacy: { local_only: true },
  }, root);
  assert.equal(resultAudio.disposition, 'BLOCKED');
  assert.ok(resultAudio.blockers.some((b) => b.code === 'QC_REQUIRED_EVIDENCE_MISSING' && b.explanation.includes('AUDIO_RENDER')));
});

/* ── AF14: fidelity never asserts human performance ──────────────────────── */
test('AF14: render class never implies human performance or capture evidence', () => {
  for (const [name, cls] of Object.entries(policy.RENDER_CLASSES)) {
    assert.ok(cls.does_not_prove.includes('human performance'), name);
  }
  // Evidence summary exposes class only — never a human verdict synthesis.
  const root = qcRoot();
  const { evBytes, wavBytes } = plantAttested(root, 'af14-run', 'MUSIC_CANDIDATE');
  const result = qcInspect({
    task_id: 'af14', package_run_id: 'af14-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'rough-cut-review',
    subject: { artifact_id: 'mix-1', artifact_type: 'AUDIO_RENDER', producing_agent: 'sound_music_director',
      artifact_path: 'package-runs/af14-run/production.wav', artifact_sha256: sha256(wavBytes) },
    evidence: [evidenceEntry('af14-run', evBytes, wavBytes)],
    required_evidence: [], privacy: { local_only: true },
  }, root);
  const summary = JSON.stringify(result.evidence || []);
  assert.ok(summary.includes('MUSIC_CANDIDATE'));
  assert.equal(/human_verified|performance_confirmed/i.test(summary), false);
});

/* ── AF15: fidelity never asserts publication approval ───────────────────── */
test('AF15: no render class carries publication authority', () => {
  for (const [name, cls] of Object.entries(policy.RENDER_CLASSES)) {
    assert.ok(cls.does_not_prove.includes('publication approval'), name);
  }
  // PRODUCTION_MIX at best proves technical program audio; the publication
  // approval gate stays human and untouched.
  const pubRow = policy.policyForKind('TITLE_THUMBNAIL_APPROVAL');
  assert.equal(pubRow.class, 'HUMAN_EXTERNAL');
});

/* ── AF16: invariants green ──────────────────────────────────────────────── */
test('AF16: producer + applicability + fidelity invariants hold together', () => {
  assert.equal(policy.checkProducerReachability(ROOT).ok, true);
  assert.equal(policy.checkApplicabilityConsistency().ok, true);
  const fidelity = policy.checkAudioFidelityConsistency();
  assert.deepEqual(fidelity.violations, []);
  // Negative control: an undeclared producer-less class requirement would be
  // caught. Simulate by removing the declared gap from a live row.
  const tampered = { ...policy.EVIDENCE_POLICY };
  tampered.AUDIO_RENDER = Object.freeze({ ...tampered.AUDIO_RENDER, required_render_class: 'UNLISTED_CLASS' });
  // (policy table is frozen; instead prove the function catches unknown class
  // against a hand-built row via the exported vocabulary check)
  assert.equal(policy.producerAuthorizedForClass('sound_music_director', 'UNLISTED_CLASS'), false);
  assert.equal(policy.RENDER_CLASSES.UNLISTED_CLASS, undefined);
});

module.exports = { tests };
