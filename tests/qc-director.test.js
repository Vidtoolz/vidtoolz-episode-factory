'use strict';

// QC Director V1 — deterministic QC authority tests.
//
// These tests prove the QC contract without depending on any producing
// department's implementation: every adapter is exercised through the DURABLE
// result schema that department persists, never by importing its module. In
// particular no Earth Studio source is loaded here; the camera adapter is
// driven by synthetic camera-quality.json-shaped objects.

const { assert, fs, os, path, test } = require('./_helpers.js');
const childProcess = require('node:child_process');
const qc = require('../scripts/qc-director.js');
const runner = require('../scripts/agent-run.js');
const dispatchAuthority = require('../scripts/agent-dispatch-authority.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const NOW = '2026-08-25T09:00:00.000Z';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-director-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

function writeArtifact(relative, content) {
  const target = path.join(TMP, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return { relative, absolute: target, sha256: qc.sha256(Buffer.from(content)) };
}

function inspect(task, options = {}) {
  return qc.run(task, { now: NOW, repoRoot: TMP, ...options });
}

function baseTask(overrides = {}) {
  return {
    task_id: 'qc-test',
    action: 'inspect_artifact',
    package_run_id: '2026-08-25-qc-tests',
    project_id: 'qc-project',
    gate: 'production-plan',
    subject: {
      artifact_id: 'artifact-1',
      artifact_type: 'EARTH_STUDIO_PROJECT',
      producing_agent: 'camera_director',
      version_id: 'v1',
    },
    evidence: [],
    required_evidence: [],
    ...overrides,
  };
}

const CAMERA_PASS = { schema_version: 1, verdict: 'PASS_FOR_HUMAN_REVIEW', errors: [], warnings: [] };

function cameraEvidence(payload, overrides = {}) {
  return {
    evidence_id: 'cq-1',
    kind: 'CAMERA_QUALITY',
    evidence_class: 'DETERMINISTIC',
    produced_by: 'earth-studio-camera-quality',
    binds_to: { artifact_id: 'artifact-1', version_id: 'v1' },
    payload,
    ...overrides,
  };
}

// ── module shape ──────────────────────────────────────────────────────────

test('qc director exposes the canonical agent runner interface', () => {
  assert.equal(qc.AGENT_ID, 'qc_director');
  assert.deepEqual([...qc.ACTIONS], ['inspect_artifact', 'status']);
  assert.equal(typeof qc.run, 'function');
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'qc-director.js'), 'utf8');
  assert.match(source, /require\.main\s*===\s*module/, 'module must be safe for runner identity inspection');
  assert.equal(
    dispatchAuthority.modulePathFor(REPO_ROOT, 'qc_director'),
    path.join(REPO_ROOT, 'scripts', 'qc-director.js'),
    'module must live at the canonical dispatch-derived path'
  );
});

test('qc director import is side-effect free under a pristine root', () => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-import-probe-'));
  const script = 'const before=require("node:fs").readdirSync(process.cwd());'
    + `require(${JSON.stringify(path.join(REPO_ROOT, 'scripts', 'qc-director.js'))});`
    + 'const after=require("node:fs").readdirSync(process.cwd());'
    + 'process.stdout.write(JSON.stringify({before,after}));';
  const out = childProcess.execFileSync(process.execPath, ['-e', script], { cwd: probe, encoding: 'utf8' });
  const { before, after } = JSON.parse(out);
  assert.deepEqual(after, before, 'require() must not write to the filesystem');
  fs.rmSync(probe, { recursive: true, force: true });
});

test('qc director uses only the authoritative 14-gate model', () => {
  const workflowMap = require('../scripts/package-run-workflow-map.js');
  assert.equal(qc.CANONICAL_GATES.length, 14);
  assert.deepEqual([...qc.CANONICAL_GATES], workflowMap.GATE_DEFINITIONS.map((gate) => gate.id));
  const blocked = inspect(baseTask({ gate: 'stage-17-legacy-pipeline' }));
  assert.equal(blocked.disposition, 'BLOCKED');
  assert.equal(blocked.blockers[0].code, 'QC_GATE_UNKNOWN');
});

// ── input validation ──────────────────────────────────────────────────────

test('qc director rejects malformed and unknown-field tasks', () => {
  const unknownField = inspect(baseTask({ rogue_field: true }));
  assert.equal(unknownField.disposition, 'BLOCKED');
  assert.equal(unknownField.blockers[0].code, 'QC_TASK_INVALID');

  const noAction = inspect({ task_id: 'x', action: 'repair_artifact' });
  assert.equal(noAction.disposition, 'BLOCKED');
  assert.equal(noAction.blockers[0].code, 'QC_ACTION_UNSUPPORTED');

  const noSubject = inspect({ task_id: 'x', action: 'inspect_artifact' });
  assert.equal(noSubject.disposition, 'BLOCKED');
  assert.match(noSubject.reason, /requires subject/);
});

test('qc director refuses to inspect its own output (independence doctrine)', () => {
  const result = inspect(baseTask({
    subject: { artifact_id: 'a', artifact_type: 'QC_RESULT', producing_agent: 'qc_director' },
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_INDEPENDENCE_VIOLATION');
});

test('qc director refuses path traversal and absolute escapes', () => {
  const escape = inspect(baseTask({
    subject: { ...baseTask().subject, artifact_path: '../../etc/passwd' },
  }));
  assert.equal(escape.disposition, 'BLOCKED');
  assert.equal(escape.blockers[0].code, 'QC_ARTIFACT_PATH_UNSAFE');

  const evidenceEscape = inspect(baseTask({
    evidence: [cameraEvidence(null, { payload: undefined, path: '/etc/hosts' })],
  }));
  assert.equal(evidenceEscape.disposition, 'BLOCKED');
  assert.equal(evidenceEscape.blockers[0].code, 'QC_EVIDENCE_PATH_UNSAFE');
});

// ── the core doctrine: no hidden pass ─────────────────────────────────────

test('missing required evidence blocks instead of passing on defect absence', () => {
  const result = inspect(baseTask({ evidence: [], required_evidence: ['CAMERA_QUALITY'] }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.next_gate_allowed, false);
  assert.equal(result.blockers[0].code, 'QC_REQUIRED_EVIDENCE_MISSING');
  assert.match(result.blockers[0].explanation, /absence of a known defect is not proof of quality/);
  assert.deepEqual(result.evidence_coverage.missing, ['CAMERA_QUALITY']);
});

test('unbound evidence blocks — provenance to the artifact must be proven', () => {
  const result = inspect(baseTask({
    evidence: [cameraEvidence(CAMERA_PASS, { binds_to: undefined })],
    required_evidence: ['CAMERA_QUALITY'],
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_EVIDENCE_UNBOUND');
});

test('evidence bound to a different artifact blocks', () => {
  const result = inspect(baseTask({
    evidence: [cameraEvidence(CAMERA_PASS, { binds_to: { artifact_id: 'some-other-artifact' } })],
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_EVIDENCE_ARTIFACT_MISMATCH');
});

test('stale evidence blocks on hash lineage, not on file mtime', () => {
  const artifact = writeArtifact('runs/artifact.esp', 'CURRENT ARTIFACT BYTES');
  const result = inspect(baseTask({
    subject: { ...baseTask().subject, artifact_path: artifact.relative, artifact_sha256: artifact.sha256 },
    evidence: [cameraEvidence(CAMERA_PASS, {
      binds_to: { artifact_id: 'artifact-1', artifact_sha256: qc.sha256('AN OLDER REVISION') },
    })],
    required_evidence: ['CAMERA_QUALITY'],
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_EVIDENCE_STALE');
  assert.match(result.blockers[0].explanation, /different artifact revision/);
});

test('cross-version mismatch blocks', () => {
  const result = inspect(baseTask({
    evidence: [cameraEvidence(CAMERA_PASS, { binds_to: { artifact_id: 'artifact-1', version_id: 'v0' } })],
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_EVIDENCE_VERSION_MISMATCH');
});

test('artifact hash mismatch blocks', () => {
  const artifact = writeArtifact('runs/mutated.esp', 'REAL BYTES');
  const result = inspect(baseTask({
    subject: { ...baseTask().subject, artifact_path: artifact.relative, artifact_sha256: qc.sha256('CLAIMED BYTES') },
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_ARTIFACT_HASH_MISMATCH');
});

test('unreadable artifact and unreadable evidence both block', () => {
  const missingArtifact = inspect(baseTask({
    subject: { ...baseTask().subject, artifact_path: 'runs/does-not-exist.esp' },
  }));
  assert.equal(missingArtifact.blockers[0].code, 'QC_ARTIFACT_UNREADABLE');

  const missingEvidence = inspect(baseTask({
    evidence: [cameraEvidence(undefined, { payload: undefined, path: 'runs/no-report.json' })],
  }));
  assert.equal(missingEvidence.blockers[0].code, 'QC_EVIDENCE_UNREADABLE');
});

test('malformed evidence json blocks rather than being ignored', () => {
  writeArtifact('runs/broken.json', '{ not json');
  const result = inspect(baseTask({
    evidence: [cameraEvidence(undefined, { payload: undefined, path: 'runs/broken.json' })],
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_EVIDENCE_MALFORMED');
});

test('unsupported evidence kind fails closed', () => {
  const result = inspect(baseTask({
    evidence: [cameraEvidence(CAMERA_PASS, { kind: 'VIBES_REPORT' })],
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_EVIDENCE_KIND_UNSUPPORTED');
});

// ── camera adapter (read-only consumption of a durable Earth Studio result) ─

test('camera-quality PASS is consumed but never becomes an aesthetic pass', () => {
  const result = inspect(baseTask({
    evidence: [cameraEvidence(CAMERA_PASS)],
    required_evidence: ['CAMERA_QUALITY'],
  }));
  assert.equal(result.disposition, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(result.next_gate_allowed, false);
  assert.equal(result.checks[0].applied, true);
  assert.equal(result.evidence[0].summary.verdict, 'PASS_FOR_HUMAN_REVIEW');
  assert.match(result.reason, /not an aesthetic approval/);
  assert.equal(result.aesthetic_authority.claimed, false);
  assert.equal(result.aesthetic_authority.owner, 'mikko');
});

test('camera-quality hard defect fails QC', () => {
  const result = inspect(baseTask({
    evidence: [cameraEvidence({
      schema_version: 1, verdict: 'FAIL',
      errors: ['segment 2 (fly_to) arrives 12.4 deg from Mount Fuji'], warnings: [],
    })],
    required_evidence: ['CAMERA_QUALITY'],
  }));
  assert.equal(result.disposition, 'FAIL');
  assert.equal(result.next_gate_allowed, false);
  assert.equal(result.defects[0].code, 'CAMERA_QUALITY_DEFECT');
  assert.equal(result.defects[0].severity, 'ERROR');
  assert.equal(result.defects[0].source, 'camera_director');
  assert.equal(result.handoff.next_owner, 'camera_director', 'failures route to the producing department');
});

test('camera-quality warnings are preserved and never silently dropped', () => {
  const result = inspect(baseTask({
    evidence: [cameraEvidence({
      schema_version: 1, verdict: 'FAIL',
      errors: [], warnings: ['orbit moves only 3.1% closer — indistinguishable from a hold'],
    })],
    required_evidence: ['CAMERA_QUALITY'],
  }));
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].severity, 'WARNING');
  assert.match(result.warnings[0].explanation, /indistinguishable from a hold/);
  // verdict FAIL with no explicit error still yields a synthesised defect
  assert.equal(result.disposition, 'FAIL');
});

test('camera-quality unknown schema version fails closed', () => {
  const future = inspect(baseTask({
    evidence: [cameraEvidence({ schema_version: 99, verdict: 'PASS_FOR_HUMAN_REVIEW', errors: [], warnings: [] })],
    required_evidence: ['CAMERA_QUALITY'],
  }));
  assert.equal(future.disposition, 'BLOCKED');
  assert.equal(future.blockers[0].code, 'QC_EVIDENCE_SCHEMA_UNSUPPORTED');

  const unknownVerdict = inspect(baseTask({
    evidence: [cameraEvidence({ schema_version: 1, verdict: 'LOOKS_GREAT', errors: [], warnings: [] })],
  }));
  assert.equal(unknownVerdict.disposition, 'BLOCKED');
  assert.equal(unknownVerdict.blockers[0].code, 'QC_EVIDENCE_SCHEMA_UNSUPPORTED');
});

test('camera-quality absent when required blocks', () => {
  const result = inspect(baseTask({ evidence: [], required_evidence: ['CAMERA_QUALITY'] }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.deepEqual(result.evidence_coverage.missing, ['CAMERA_QUALITY']);
});

test('camera adapter consumes the committed durable camera-quality artifact shape', () => {
  // Shape parity check against a real committed Earth Studio report. The file
  // is READ ONLY here; no Earth Studio module is imported or executed.
  const committed = path.join(
    REPO_ROOT, 'package-runs', '2026-08-19-earth-studio-director-acceptance',
    'canaries', 'DIRECTOR-HERO-landmark-reveal', 'earth-studio', 'camera-quality.json'
  );
  if (!fs.existsSync(committed)) return;
  const payload = JSON.parse(fs.readFileSync(committed, 'utf8'));
  const outcome = qc.ADAPTERS.CAMERA_QUALITY(payload, { artifactId: 'a', evidenceId: 'e', gate: null });
  assert.equal(outcome.schema_supported, true, 'the live durable camera-quality schema must remain supported');
  assert.equal(typeof outcome.summary.verdict, 'string');
});

// ── generation / edit / audio / story adapters ────────────────────────────

test('generation evidence: complete run with provenance passes', () => {
  const result = inspect(baseTask({
    subject: { artifact_id: 'gen-1', artifact_type: 'GENERATED_IMAGE', producing_agent: 'generation_supervisor' },
    evidence: [{
      evidence_id: 'gen-status', kind: 'GENERATION_RESULT', evidence_class: 'SPECIALIST',
      produced_by: 'generation_supervisor', binds_to: { artifact_id: 'gen-1' },
      payload: {
        schema_version: 1, state: 'COMPLETE',
        outputs: [{ path: 'out/img-01.png', sha256: qc.sha256('x') }],
        provenance: { generating_agent: 'generation_supervisor', route: { lane: 'text_to_image_generation' } },
      },
    }],
    required_evidence: ['GENERATION_RESULT'],
  }));
  assert.equal(result.disposition, 'PASS');
  assert.equal(result.next_gate_allowed, true);
});

test('generation evidence: complete without provenance or outputs blocks', () => {
  const noProvenance = inspect(baseTask({
    subject: { artifact_id: 'gen-1', artifact_type: 'GENERATED_IMAGE', producing_agent: 'generation_supervisor' },
    evidence: [{
      evidence_id: 'gen-status', kind: 'GENERATION_RESULT', produced_by: 'generation_supervisor',
      binds_to: { artifact_id: 'gen-1' },
      payload: { schema_version: 1, state: 'COMPLETE', outputs: [{ path: 'x' }] },
    }],
  }));
  assert.equal(noProvenance.disposition, 'BLOCKED');
  assert.equal(noProvenance.blockers[0].code, 'GENERATION_PROVENANCE_ABSENT');

  const noOutputs = inspect(baseTask({
    subject: { artifact_id: 'gen-1', artifact_type: 'GENERATED_IMAGE', producing_agent: 'generation_supervisor' },
    evidence: [{
      evidence_id: 'gen-status', kind: 'GENERATION_RESULT', produced_by: 'generation_supervisor',
      binds_to: { artifact_id: 'gen-1' },
      payload: { schema_version: 1, state: 'COMPLETE', outputs: [], provenance: { generating_agent: 'x' } },
    }],
  }));
  assert.equal(noOutputs.blockers[0].code, 'GENERATION_OUTPUT_ABSENT');
});

test('generation evidence: incomplete run fails and routes to the generator', () => {
  const result = inspect(baseTask({
    subject: { artifact_id: 'gen-1', artifact_type: 'GENERATED_IMAGE', producing_agent: 'generation_supervisor' },
    evidence: [{
      evidence_id: 'gen-status', kind: 'GENERATION_RESULT', produced_by: 'generation_supervisor',
      binds_to: { artifact_id: 'gen-1' },
      payload: {
        schema_version: 1, state: 'DISPATCH_FAILED', reason: 'lane endpoint unreachable',
        outputs: [], provenance: { generating_agent: 'generation_supervisor' },
        retry: { retry_allowed: true },
      },
    }],
  }));
  assert.equal(result.disposition, 'FAIL');
  assert.equal(result.defects[0].code, 'GENERATION_NOT_COMPLETE');
  assert.equal(result.defects[0].auto_repairable, true);
  assert.equal(result.handoff.next_owner, 'generation_supervisor');
});

test('edit evidence: export byte identity is verified', () => {
  const exported = writeArtifact('runs/rough-cut.mp4', 'ROUGH CUT BYTES');
  const handoff = (sha) => ({
    evidence_id: 'edit-qc', kind: 'EDIT_QC_HANDOFF', evidence_class: 'SPECIALIST',
    produced_by: 'editor', binds_to: { artifact_id: 'edit-1' },
    payload: {
      artifact_type: 'edit-plan-qc-handoff', edit_plan_id: 'edit-1', edit_plan_revision: 2,
      edit_plan_digest_sha256: qc.sha256('plan'), findings: [],
      rendered_media_ref: { path_or_artifact_ref: exported.relative, sha256: sha, byte_size: 15 },
    },
  });
  const subject = { artifact_id: 'edit-1', artifact_type: 'EDIT_EXPORT', producing_agent: 'editor' };

  const good = inspect(baseTask({ subject, evidence: [handoff(exported.sha256)], required_evidence: ['EDIT_QC_HANDOFF'] }));
  assert.equal(good.disposition, 'PASS');
  assert.equal(good.next_gate_allowed, true);

  const tampered = inspect(baseTask({ subject, evidence: [handoff(qc.sha256('DIFFERENT'))] }));
  assert.equal(tampered.disposition, 'BLOCKED');
  assert.equal(tampered.blockers[0].code, 'EDIT_EXPORT_HASH_MISMATCH');
});

test('edit evidence: wrong artifact_type is refused', () => {
  const result = inspect(baseTask({
    subject: { artifact_id: 'edit-1', artifact_type: 'EDIT_EXPORT', producing_agent: 'editor' },
    evidence: [{
      evidence_id: 'edit-qc', kind: 'EDIT_QC_HANDOFF', produced_by: 'editor',
      binds_to: { artifact_id: 'edit-1' }, payload: { artifact_type: 'something-else' },
    }],
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QC_EVIDENCE_SCHEMA_UNSUPPORTED');
});

test('audio evidence: technical validity is checked, musical fit is not', () => {
  const subject = { artifact_id: 'mix-1', artifact_type: 'PRODUCTION_MIX', producing_agent: 'sound_music_director' };
  const ok = inspect(baseTask({
    subject,
    evidence: [{
      evidence_id: 'audio-1', kind: 'AUDIO_RENDER', evidence_class: 'SPECIALIST',
      produced_by: 'sound_music_director', binds_to: { artifact_id: 'mix-1' },
      payload: { schema_version: 1, state: 'PRODUCTION_READY', production_mix_sha256: qc.sha256('mix'), duration_seconds: 42.5 },
    }],
    required_evidence: ['AUDIO_RENDER'],
  }));
  assert.equal(ok.disposition, 'PASS');
  // A technical audio PASS must carry no musical/emotional verdict: every
  // finding is empty, and music_fit stays on the fenced list QC refuses to judge.
  assert.deepEqual(ok.defects, []);
  assert.deepEqual(ok.warnings, []);
  assert.ok(qc.AESTHETIC_DIMENSIONS.includes('music_fit'));
  assert.ok(qc.AESTHETIC_DIMENSIONS.includes('emotional_effect'));
  assert.equal(ok.aesthetic_authority.claimed, false);

  const badDuration = inspect(baseTask({
    subject,
    evidence: [{
      evidence_id: 'audio-1', kind: 'AUDIO_RENDER', produced_by: 'sound_music_director',
      binds_to: { artifact_id: 'mix-1' },
      payload: { schema_version: 1, state: 'PRODUCTION_READY', production_mix_sha256: qc.sha256('mix'), duration_seconds: 0 },
    }],
  }));
  assert.equal(badDuration.disposition, 'FAIL');
  assert.equal(badDuration.defects[0].code, 'AUDIO_DURATION_INVALID');
});

test('story evidence is consumed, not re-derived', () => {
  const subject = { artifact_id: 'story-1', artifact_type: 'STORY', producing_agent: 'story_editor' };
  const passed = inspect(baseTask({
    subject,
    evidence: [{
      evidence_id: 'story-val', kind: 'STORY_VALIDATION', evidence_class: 'SPECIALIST',
      produced_by: 'story_editor', binds_to: { artifact_id: 'story-1' },
      payload: { schema_version: 1, verdict: 'PASS', warnings: [] },
    }],
    required_evidence: ['STORY_VALIDATION'],
  }));
  assert.equal(passed.disposition, 'PASS');

  const warned = inspect(baseTask({
    subject,
    evidence: [{
      evidence_id: 'story-val', kind: 'STORY_VALIDATION', produced_by: 'story_editor',
      binds_to: { artifact_id: 'story-1' },
      payload: { schema_version: 1, verdict: 'PASS', warnings: ['hook is long'] },
    }],
  }));
  assert.equal(warned.disposition, 'PASS_WITH_WARNINGS');
  assert.equal(warned.next_gate_allowed, true, 'warnings alone do not block the next gate');

  const rejected = inspect(baseTask({
    subject,
    evidence: [{
      evidence_id: 'story-val', kind: 'STORY_VALIDATION', produced_by: 'story_editor',
      binds_to: { artifact_id: 'story-1' },
      payload: { schema_version: 1, verdict: 'REJECTED', warnings: [] },
    }],
  }));
  assert.equal(rejected.disposition, 'FAIL');
  assert.equal(rejected.handoff.next_owner, 'story_editor');
});

test('qc normalizes evidence from more than one department in one pass', () => {
  const result = inspect(baseTask({
    subject: { artifact_id: 'edit-1', artifact_type: 'EDIT_EXPORT', producing_agent: 'editor' },
    evidence: [
      {
        evidence_id: 'edit-qc', kind: 'EDIT_QC_HANDOFF', produced_by: 'editor', binds_to: { artifact_id: 'edit-1' },
        payload: { artifact_type: 'edit-plan-qc-handoff', edit_plan_id: 'edit-1', edit_plan_digest_sha256: qc.sha256('p'), findings: [] },
      },
      {
        evidence_id: 'audio-1', kind: 'AUDIO_RENDER', produced_by: 'sound_music_director', binds_to: { artifact_id: 'edit-1' },
        payload: { schema_version: 1, state: 'PRODUCTION_READY', production_mix_sha256: qc.sha256('m'), duration_seconds: 30 },
      },
      {
        evidence_id: 'story-val', kind: 'STORY_VALIDATION', produced_by: 'story_editor', binds_to: { artifact_id: 'edit-1' },
        payload: { schema_version: 1, verdict: 'PASS', warnings: [] },
      },
    ],
    required_evidence: ['EDIT_QC_HANDOFF', 'AUDIO_RENDER', 'STORY_VALIDATION'],
  }));
  assert.equal(result.disposition, 'PASS');
  assert.equal(result.checks.length, 3);
  assert.deepEqual(result.evidence_coverage.missing, []);
});

// ── human authority fence ─────────────────────────────────────────────────

const HUMAN_GATE_SUBJECT = { artifact_id: 'cut-1', artifact_type: 'ROUGH_CUT', producing_agent: 'editor' };

function humanGateTask(overrides = {}) {
  return baseTask({ gate: 'rough-cut-review', subject: HUMAN_GATE_SUBJECT, ...overrides });
}

test('technical pass without human authority yields HUMAN_REVIEW_REQUIRED', () => {
  const result = inspect(humanGateTask({
    evidence: [{
      evidence_id: 'edit-qc', kind: 'EDIT_QC_HANDOFF', produced_by: 'editor', binds_to: { artifact_id: 'cut-1' },
      payload: { artifact_type: 'edit-plan-qc-handoff', edit_plan_id: 'cut-1', edit_plan_digest_sha256: qc.sha256('p'), findings: [] },
    }],
    required_evidence: ['EDIT_QC_HANDOFF'],
  }));
  assert.equal(result.disposition, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(result.next_gate_allowed, false);
  assert.equal(result.human_authority.required_scope, 'FINAL_CUT_APPROVAL');
  assert.equal(result.human_authority.verdict, 'ABSENT');
  assert.equal(result.handoff.next_owner, 'mikko');
  assert.equal(result.control_room.human_review_required, true);
});

test('valid human approval bound to the exact bytes permits the gate', () => {
  const cut = writeArtifact('runs/cut-approved.mp4', 'APPROVED CUT BYTES');
  const result = inspect(humanGateTask({
    subject: { ...HUMAN_GATE_SUBJECT, artifact_path: cut.relative, artifact_sha256: cut.sha256 },
    evidence: [{
      evidence_id: 'edit-qc', kind: 'EDIT_QC_HANDOFF', produced_by: 'editor',
      binds_to: { artifact_id: 'cut-1', artifact_sha256: cut.sha256 },
      payload: { artifact_type: 'edit-plan-qc-handoff', edit_plan_id: 'cut-1', edit_plan_digest_sha256: qc.sha256('p'), findings: [] },
    }],
    required_evidence: ['EDIT_QC_HANDOFF'],
    human_authority: {
      artifact_path: cut.relative, artifact_sha256: cut.sha256, commit: 'abc1234',
      approved_by: 'Mikko', approved_at: NOW, scope: 'FINAL_CUT_APPROVAL', decision: 'APPROVE',
    },
  }));
  assert.equal(result.disposition, 'PASS');
  assert.equal(result.next_gate_allowed, true);
  assert.equal(result.human_authority.verdict, 'VALID');
});

test('valid human rejection fails QC', () => {
  const cut = writeArtifact('runs/cut-rejected.mp4', 'REJECTED CUT BYTES');
  const result = inspect(humanGateTask({
    subject: { ...HUMAN_GATE_SUBJECT, artifact_path: cut.relative, artifact_sha256: cut.sha256 },
    evidence: [{
      evidence_id: 'edit-qc', kind: 'EDIT_QC_HANDOFF', produced_by: 'editor',
      binds_to: { artifact_id: 'cut-1', artifact_sha256: cut.sha256 },
      payload: { artifact_type: 'edit-plan-qc-handoff', edit_plan_id: 'cut-1', edit_plan_digest_sha256: qc.sha256('p'), findings: [] },
    }],
    human_authority: {
      artifact_path: cut.relative, artifact_sha256: cut.sha256, commit: 'abc1234',
      approved_by: 'Mikko', approved_at: NOW, scope: 'FINAL_CUT_APPROVAL', decision: 'REJECT',
    },
  }));
  assert.equal(result.disposition, 'FAIL');
  assert.equal(result.next_gate_allowed, false);
  assert.match(result.reason, /human authority rejected/);
});

test('stale human approval blocks — it does not survive an artifact change', () => {
  const cut = writeArtifact('runs/cut-changed.mp4', 'VERSION TWO BYTES');
  const result = inspect(humanGateTask({
    subject: { ...HUMAN_GATE_SUBJECT, artifact_path: cut.relative },
    human_authority: {
      artifact_path: cut.relative, artifact_sha256: qc.sha256('VERSION ONE BYTES'), commit: 'abc1234',
      approved_by: 'Mikko', approved_at: NOW, scope: 'FINAL_CUT_APPROVAL',
    },
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.equal(result.blockers.some((b) => b.code === 'QC_HUMAN_AUTHORITY_STALE'), true);
});

test('detached or wrong-scope human approval blocks', () => {
  const cut = writeArtifact('runs/cut-scope.mp4', 'SCOPE BYTES');
  const detached = inspect(humanGateTask({
    subject: { ...HUMAN_GATE_SUBJECT, artifact_path: cut.relative },
    human_authority: { artifact_path: cut.relative, artifact_sha256: cut.sha256, approved_by: 'Mikko', approved_at: NOW, scope: 'FINAL_CUT_APPROVAL' },
  }));
  assert.equal(detached.disposition, 'BLOCKED');
  assert.match(detached.blockers.map((b) => b.explanation).join(' '), /missing commit/);

  const wrongScope = inspect(humanGateTask({
    subject: { ...HUMAN_GATE_SUBJECT, artifact_path: cut.relative },
    human_authority: {
      artifact_path: cut.relative, artifact_sha256: cut.sha256, commit: 'abc', approved_by: 'Mikko',
      approved_at: NOW, scope: 'CANDIDATE_SELECTION',
    },
  }));
  assert.equal(wrongScope.disposition, 'BLOCKED');
  assert.match(wrongScope.blockers.map((b) => b.explanation).join(' '), /scope mismatch/);
});

test('qc never claims an aesthetic verdict in any disposition', () => {
  const dispositions = new Set();
  const samples = [
    inspect(baseTask({ evidence: [cameraEvidence(CAMERA_PASS)] })),
    inspect(baseTask({ evidence: [cameraEvidence({ schema_version: 1, verdict: 'FAIL', errors: ['bad'], warnings: [] })] })),
    inspect(baseTask({ required_evidence: ['CAMERA_QUALITY'] })),
    inspect(baseTask({
      subject: { artifact_id: 's', artifact_type: 'STORY', producing_agent: 'story_editor' },
      evidence: [{
        evidence_id: 'v', kind: 'STORY_VALIDATION', produced_by: 'story_editor', binds_to: { artifact_id: 's' },
        payload: { schema_version: 1, verdict: 'PASS', warnings: ['note'] },
      }],
    })),
  ];
  for (const sample of samples) {
    dispositions.add(sample.disposition);
    assert.equal(sample.aesthetic_authority.claimed, false);
    assert.equal(sample.aesthetic_authority.owner, 'mikko');
    assert.equal(sample.control_room.aesthetic_authority_claimed, false);
    assert.deepEqual([...sample.aesthetic_authority.fenced_dimensions], [...qc.AESTHETIC_DIMENSIONS]);
  }
  assert.ok(dispositions.size >= 3, 'sampled dispositions must be varied');
});

// ── gate lifecycle relationship ───────────────────────────────────────────

test('only PASS and PASS_WITH_WARNINGS permit the next gate', () => {
  for (const disposition of qc.DISPOSITIONS) {
    const allowed = qc.NEXT_GATE_ALLOWED.includes(disposition);
    assert.equal(allowed, disposition === 'PASS' || disposition === 'PASS_WITH_WARNINGS');
  }
  const fail = inspect(baseTask({ evidence: [cameraEvidence({ schema_version: 1, verdict: 'FAIL', errors: ['x'], warnings: [] })] }));
  assert.equal(fail.next_gate_allowed, false);
  const blocked = inspect(baseTask({ required_evidence: ['CAMERA_QUALITY'] }));
  assert.equal(blocked.next_gate_allowed, false);
  const human = inspect(baseTask({ evidence: [cameraEvidence(CAMERA_PASS)] }));
  assert.equal(human.next_gate_allowed, false, 'human review required must never auto-promote');
});

test('qc attention never escalates to DECISION — QC fails closed instead', () => {
  const samples = [
    inspect(baseTask({ required_evidence: ['CAMERA_QUALITY'] })),
    inspect(baseTask({ evidence: [cameraEvidence({ schema_version: 1, verdict: 'FAIL', errors: ['x'], warnings: [] })] })),
    inspect(humanGateTask({})),
    inspect(baseTask({ evidence: [] })),
  ];
  for (const sample of samples) assert.notEqual(sample.attention, 'DECISION');
});

// ── output contract, provenance, idempotency, mutation safety ─────────────

test('qc result carries a stable provenance-bearing schema', () => {
  const result = inspect(baseTask({ evidence: [cameraEvidence(CAMERA_PASS)], required_evidence: ['CAMERA_QUALITY'] }));
  for (const field of [
    'schema_version', 'qc_director_version', 'agent_id', 'task_id', 'package_run_id',
    'gate', 'subject', 'observed', 'evidence', 'evidence_coverage', 'checks',
    'blockers', 'defects', 'warnings', 'human_authority', 'disposition', 'reason',
    'next_gate_allowed', 'inspected_at', 'qc_result_digest_sha256', 'events', 'control_room',
  ]) assert.ok(field in result, `qc result must expose ${field}`);
  assert.equal(result.schema_version, 1);
  assert.equal(result.qc_director_version, 'qc-director-v1');
  assert.equal(result.agent_id, 'qc_director');
  assert.match(result.qc_result_digest_sha256, /^[0-9a-f]{64}$/);
});

test('qc is idempotent over identical immutable inputs', () => {
  const task = baseTask({ evidence: [cameraEvidence(CAMERA_PASS)], required_evidence: ['CAMERA_QUALITY'] });
  const first = qc.run(JSON.parse(JSON.stringify(task)), { now: '2026-01-01T00:00:00.000Z', repoRoot: TMP });
  const second = qc.run(JSON.parse(JSON.stringify(task)), { now: '2026-12-31T23:59:59.000Z', repoRoot: TMP });
  assert.equal(first.disposition, second.disposition);
  assert.equal(
    first.qc_result_digest_sha256, second.qc_result_digest_sha256,
    'canonical digest must exclude timestamps'
  );
  assert.notEqual(first.inspected_at, second.inspected_at);
});

test('qc does not mutate the artifact or the evidence it inspects', () => {
  const artifact = writeArtifact('runs/immutable.esp', 'DO NOT TOUCH');
  const evidenceFile = writeArtifact('runs/immutable-cq.json', `${JSON.stringify(CAMERA_PASS)}\n`);
  const before = { artifact: qc.sha256(fs.readFileSync(artifact.absolute)), evidence: qc.sha256(fs.readFileSync(evidenceFile.absolute)) };
  const task = baseTask({
    subject: { ...baseTask().subject, artifact_path: artifact.relative, artifact_sha256: artifact.sha256 },
    evidence: [cameraEvidence(undefined, {
      payload: undefined, path: evidenceFile.relative, sha256: evidenceFile.sha256,
      binds_to: { artifact_id: 'artifact-1', artifact_sha256: artifact.sha256 },
    })],
    required_evidence: ['CAMERA_QUALITY'],
  });
  const frozenTask = JSON.stringify(task);
  const result = inspect(task);
  assert.equal(result.disposition, 'HUMAN_REVIEW_REQUIRED');
  const after = { artifact: qc.sha256(fs.readFileSync(artifact.absolute)), evidence: qc.sha256(fs.readFileSync(evidenceFile.absolute)) };
  assert.deepEqual(after, before, 'QC must never modify what it evaluates');
  assert.equal(JSON.stringify(task), frozenTask, 'QC must not mutate the task it was given');
});

test('qc never leaks raw evidence payloads into the durable result', () => {
  const result = inspect(baseTask({ evidence: [cameraEvidence(CAMERA_PASS)] }));
  for (const record of result.evidence) assert.ok(!('payload' in record), 'evidence payload must be summarised, not echoed');
});

// ── canonical envelope + control room projection ──────────────────────────

test('every qc disposition emits a runner-valid canonical envelope', () => {
  const samples = [
    inspect(baseTask({ evidence: [cameraEvidence(CAMERA_PASS)] })),
    inspect(baseTask({ evidence: [cameraEvidence({ schema_version: 1, verdict: 'FAIL', errors: ['x'], warnings: [] })] })),
    inspect(baseTask({ required_evidence: ['CAMERA_QUALITY'] })),
    inspect({ task_id: 'qc-test', action: 'status' }),
    inspect({ task_id: 'qc-test', action: 'nonsense' }),
    inspect(humanGateTask({})),
  ];
  for (const sample of samples) {
    const error = runner.validateEnvelope(sample, 'qc_director', 'qc-test');
    assert.equal(error, null, `envelope invalid for ${sample.disposition}: ${error}`);
  }
});

test('control room projection exposes the operator-critical QC facts', () => {
  const result = inspect(humanGateTask({
    evidence: [cameraEvidence(CAMERA_PASS, { binds_to: { artifact_id: 'cut-1' } })],
    required_evidence: ['CAMERA_QUALITY', 'EDIT_QC_HANDOFF'],
  }));
  const view = result.control_room;
  assert.equal(view.role, 'qc_director');
  assert.equal(view.owner, 'qc_director');
  assert.equal(view.disposition, result.disposition);
  assert.equal(view.attention, view.attention_level);
  assert.equal(view.next_gate_allowed, false);
  assert.equal(view.gate, 'rough-cut-review');
  assert.deepEqual(view.missing_evidence, ['EDIT_QC_HANDOFF']);
  assert.ok(Array.isArray(view.blockers) && view.blockers.length > 0);
  assert.equal(view.current_artifact.producing_agent, 'editor');
  assert.equal(view.evidence_total, 1);
  assert.ok(view.operational_rationale.decision);
  assert.ok(view.operational_rationale.reason);
});

test('status action reports availability without asserting artifact quality', () => {
  const result = inspect({ task_id: 'qc-status', action: 'status' });
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.attention, 'INFORMATION');
  assert.equal(result.next_gate_allowed, false, 'status must never authorize a gate');
  assert.equal(result.subject, null);
  assert.deepEqual([...result.supported_evidence_kinds], [...qc.SUPPORTED_EVIDENCE_KINDS]);
});

// ── registry / dispatch authority state ───────────────────────────────────

test('qc director registry entry matches the contract and the canonical module', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'agent-contract.json'), 'utf8'));
  const registration = registry.agents.find((agent) => agent.agent_id === 'qc_director');
  const role = contract.role_roster.find((entry) => entry.role_id === 'qc_director');
  assert.ok(registration && role);
  assert.equal(role.status, 'BUILT');
  assert.equal(registration.lifecycle.proven, 'PROVEN');
  assert.ok(['CANDIDATE', 'IMPLEMENTATION_PROVEN'].includes(registration.implementation_state));

  const readiness = dispatchAuthority.implementationReadiness(REPO_ROOT, registration);
  assert.equal(readiness.module_exists, true, 'the canonical QC module must exist on disk');
  if (registration.implementation_state === 'CANDIDATE') {
    assert.equal(readiness.authorized, false);
    assert.equal(readiness.code, 'BLOCKED_IMPLEMENTATION_NOT_PROVEN');
  } else {
    assert.equal(readiness.authorized, true, 'a proven QC implementation must be dispatch-authorized');
  }
});

test('dispatch authority refuses a candidate implementation even when the module exists', () => {
  const candidate = { agent_id: 'qc_director', lifecycle: { proven: 'PROVEN', autonomous_dispatch: 'ENABLED' }, implementation_state: 'CANDIDATE' };
  const readiness = dispatchAuthority.implementationReadiness(REPO_ROOT, candidate);
  assert.equal(readiness.authorized, false);
  assert.equal(readiness.code, 'BLOCKED_IMPLEMENTATION_NOT_PROVEN');
  assert.equal(readiness.module_exists, true);
});

// ── C1 style-reference ADVISORY consumption (Approval C, 2026-08-29) ─────
// The certified fixture is copied into the hermetic QC repo root so the
// advisory seam consumes it through the SAME certified adapter + binding
// machinery production uses. Nothing here may block, score, or mutate.

const STYLE_FIXTURE_SRC = path.join(REPO_ROOT, 'tests', 'fixtures', 'style-reference', 'VIDTOOLZ_STYLE_REFERENCE_V1.json');
const STYLE_SHA = 'b357d23956bc3fd7a956372347e59cae4b10bb0064d3e9b19ec2819207fa8e41';
const styleRef = writeArtifact('style/VIDTOOLZ_STYLE_REFERENCE_V1.json', fs.readFileSync(STYLE_FIXTURE_SRC, 'utf8'));
assert.equal(styleRef.sha256, STYLE_SHA, 'fixture must be the approved V1 reference');

function styleAdvisoryTask(programme, extra = {}) {
  return baseTask({
    style_reference: {
      reference_path: 'style/VIDTOOLZ_STYLE_REFERENCE_V1.json',
      expected_binding: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: STYLE_SHA },
      programme,
      ...extra,
    },
  });
}

// Human-reference-like programme: ~26 meaningful events/min, no long dead
// gaps, presenter-free but visually alive spans, designed ending.
function referenceLikeProgramme() {
  const duration_s = 60;
  const b_events = [];
  for (let i = 0; i < 26; i += 1) b_events.push({ t_s: Number((1 + i * 2.2).toFixed(2)), kind: 'CARD_STATE_CHANGE', asset_id: `card-${i}` });
  return {
    duration_s,
    spans: [
      { start_s: 0, end_s: 30, presenter: 'ABSENT', level_c: { class: 'GRAPHIC_EVOLUTION' }, density: 'READABLE', text_bearing: false },
      { start_s: 30, end_s: 60, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'QUIET', text_bearing: false },
    ],
    b_events,
    ending: { designed_card: true },
  };
}

test('C1-QC1: reference-like programme yields advisory findings and cannot change the disposition', () => {
  const withStyle = inspect(styleAdvisoryTask(referenceLikeProgramme()));
  const baseline = inspect(baseTask());
  assert.equal(withStyle.disposition, baseline.disposition, 'style advisory must never move the disposition');
  assert.equal(withStyle.blockers.length, baseline.blockers.length, 'style advisory must never add blockers');
  assert.ok(withStyle.style_advisory, 'advisory context must be attached');
  assert.equal(withStyle.style_advisory.state, 'ADVISORY_ONLY');
  assert.equal(withStyle.style_advisory.tier, 'ADVISORY_ONLY');
  assert.equal(withStyle.style_advisory.advisory_only, true);
  assert.equal(withStyle.style_advisory.affected_disposition, false);
  assert.equal(withStyle.style_advisory.no_aggregate_score, true);
  assert.ok(!Object.keys(withStyle.style_advisory).some((key) => key !== 'no_aggregate_score' && /score/i.test(key)), 'no aggregate style score field may exist');
  assert.ok(withStyle.style_advisory.findings.every((f) => !('score' in f)), 'findings carry evidence, never a score');
  // Exact canonical binding surfaces in the advisory evidence.
  assert.equal(withStyle.style_advisory.style_binding.reference_id, 'VIDTOOLZ_STYLE_REFERENCE_V1');
  assert.equal(withStyle.style_advisory.style_binding.sha256, STYLE_SHA);
  assert.equal(withStyle.style_advisory.style_binding.approved_by, 'Mikko');
  assert.ok(withStyle.style_advisory.findings.some((f) => f.verdict === 'REFERENCE_MATCH'), 'a reference-like programme matches');
});

test('C1-QC2: Level A/B/C remain separate in the advisory evidence', () => {
  const result = inspect(styleAdvisoryTask(referenceLikeProgramme()));
  const sep = result.style_advisory.level_separation;
  assert.ok(sep && Number.isInteger(sep.level_a) && Number.isInteger(sep.level_b) && Number.isInteger(sep.level_c), 'levels are reported separately, never collapsed');
  for (const f of result.style_advisory.findings) assert.ok(['A', 'B', 'C', 'GRAMMAR'].includes(f.level), `finding carries its own level: ${f.level}`);
  const collapsed = JSON.stringify(result.style_advisory);
  assert.equal(/cut_count|motion_count|single_style_score/.test(collapsed), false, 'no collapsed single-metric reporting');
});

test('C1-QC3: weak Level-B programme warns but disposition stays unchanged (advisory only)', () => {
  const weak = {
    duration_s: 60,
    spans: [{ start_s: 0, end_s: 60, presenter: 'ABSENT', level_c: { class: 'STATIC', reason: 'explicit_creative_choice' }, density: 'QUIET', text_bearing: false }],
    b_events: [
      { t_s: 2, kind: 'CARD_STATE_CHANGE' }, { t_s: 15, kind: 'REFRAME' },
      { t_s: 40, kind: 'LABEL_REVEAL' }, { t_s: 55, kind: 'COMPOSITION_CHANGE' },
    ],
    ending: { designed_card: true },
  };
  const withStyle = inspect(styleAdvisoryTask(weak));
  const baseline = inspect(baseTask());
  assert.equal(withStyle.disposition, baseline.disposition, 'weak style never blocks, fails, or escalates');
  assert.equal(withStyle.blockers.length, 0);
  const verdicts = withStyle.style_advisory.findings.map((f) => f.verdict);
  assert.ok(verdicts.includes('REFERENCE_WARNING'), 'below-band Level-B density warns');
  for (const v of verdicts) assert.ok(['REFERENCE_MATCH', 'REFERENCE_WARNING', 'REFERENCE_OUTLIER'].includes(v), `verdict is advisory vocabulary only: ${v}`);
});

test('C1-QC4: presenter-free but visually alive draft does not warn on presenter absence alone', () => {
  const alive = referenceLikeProgramme();
  const result = inspect(styleAdvisoryTask(alive));
  assert.equal(result.style_advisory.findings.some((f) => f.warning_id === 'W-08'), false, 'presenter absence with continuous visual life is legal');
  // Same programme with a dead, unexplained presenter-free span: advisory W-08
  // concern, still never a failure.
  const dead = referenceLikeProgramme();
  dead.spans.push({ start_s: 60, end_s: 90, presenter: 'ABSENT', level_c: { class: 'STATIC' }, density: 'QUIET', text_bearing: false });
  dead.duration_s = 90;
  dead.b_events.push({ t_s: 75, kind: 'CARD_STATE_CHANGE' });
  const deadResult = inspect(styleAdvisoryTask(dead));
  assert.ok(deadResult.style_advisory.findings.some((f) => f.warning_id === 'W-08'), 'uncovered presenter-free span raises an advisory concern');
  assert.equal(deadResult.blockers.length, 0, 'the concern is advisory only — presenter absence is never a failure');
});

test('C1-QC5: declared episode deviation resolves to DEVIATION_ACKNOWLEDGED and stays advisory', () => {
  const weak = {
    duration_s: 60,
    spans: [{ start_s: 0, end_s: 60, presenter: 'ABSENT', level_c: { class: 'STATIC', reason: 'explicit_creative_choice' }, density: 'QUIET', text_bearing: false }],
    b_events: [{ t_s: 2, kind: 'CARD_STATE_CHANGE' }, { t_s: 55, kind: 'REFRAME' }],
    ending: { designed_card: true },
  };
  const result = inspect(styleAdvisoryTask(weak, { deviations: [{ dimension: 'b_density', reason: 'deliberate slow opening approved by Mikko' }] }));
  const density = result.style_advisory.findings.find((f) => f.dimension === 'b_density');
  assert.ok(density, 'the warning exists');
  assert.equal(density.status, 'DEVIATION_ACKNOWLEDGED', 'declared deviation is acknowledged, never enforced');
});

test('C1-QC6: wrong reference hash degrades to STYLE_REFERENCE_UNAVAILABLE — never a blocker, never silent defaults', () => {
  const task = styleAdvisoryTask(referenceLikeProgramme());
  task.style_reference.expected_binding = { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: '0'.repeat(64) };
  const result = inspect(task);
  const baseline = inspect(baseTask());
  assert.equal(result.style_advisory.state, 'STYLE_REFERENCE_UNAVAILABLE');
  assert.equal(result.style_advisory.code, 'STYLE_REFERENCE_BINDING_MISMATCH');
  assert.deepEqual(result.style_advisory.findings, []);
  assert.equal(result.disposition, baseline.disposition, 'unavailable style never blocks');
  assert.equal(result.blockers.length, 0);
});

test('C1-QC7: absent style_reference keeps legacy QC semantics exactly (no advisory field change)', () => {
  const legacy = inspect(baseTask());
  assert.equal(legacy.style_advisory, null, 'no style_reference declared => no advisory context');
});
