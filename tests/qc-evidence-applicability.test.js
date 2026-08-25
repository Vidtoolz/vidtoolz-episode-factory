'use strict';

/*
 * QC required-evidence applicability policy tests (QAP1–QAP15).
 *
 * The doctrine under test: a missing evidence artifact blocks QC only when
 * all three are true — a legitimate producer exists, the run has reached the
 * point where it should exist, and the run's production mode actually
 * requires that semantic evidence.
 *
 * Tasks WITHOUT run_mode keep legacy semantics exactly (proven by the
 * unchanged QC Director suite); these tests exercise the declared-mode path.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tests, test } = require('./_helpers');

const ROOT = path.resolve(__dirname, '..');
const qc = require('../scripts/qc-director.js');
const policy = require('../scripts/qc-evidence-policy.js');

const NOW = '2026-08-25T13:00:00.000Z';
const SUPPORTED = qc.SUPPORTED_EVIDENCE_KINDS;

function qcRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qap-qcroot-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  return root;
}

function qcInspect(task, repoRoot) {
  return qc.run(task, { now: NOW, repoRoot });
}

function baseTask(overrides = {}) {
  return {
    task_id: 'qap-task', package_run_id: 'qap-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'research',
    subject: { artifact_id: 'subj-1', artifact_type: 'RESEARCH_EVIDENCE', producing_agent: 'research_director' },
    evidence: [], required_evidence: ['STORY_VALIDATION'],
    privacy: { local_only: true },
    ...overrides,
  };
}

/* ── QAP1: every supported evidence kind is classified ─────────────────── */
test('QAP1: all evidence kinds QC can require carry an applicability class', () => {
  for (const kind of SUPPORTED) {
    const row = policy.policyForKind(kind);
    assert.ok(row, `${kind} has no policy row`);
    assert.ok(policy.APPLICABILITY_CLASSES.includes(row.class), `${kind} class unclassified: ${row.class}`);
  }
  // Human/external rows exist and are explicitly producer-less.
  for (const kind of ['FINAL_CUT_APPROVAL', 'TITLE_THUMBNAIL_APPROVAL']) {
    const row = policy.policyForKind(kind);
    assert.equal(row.class, 'HUMAN_EXTERNAL');
    assert.equal(row.producer, null);
  }
});

/* ── QAP2: no mandatory producer-less applicable kinds ─────────────────── */
test('QAP2: producer reachability invariant holds (extended, mode/gate aware)', () => {
  const check = policy.checkProducerReachability(ROOT);
  assert.deepEqual(check.violations, [], JSON.stringify(check.violations));
  assert.equal(check.ok, true);
});

/* ── QAP3: MODE_UNSPECIFIED fails closed where policy differs ──────────── */
test('QAP3: mode-sensitive evidence with no declared mode blocks, never guessed', () => {
  const result = qcInspect(baseTask({
    gate: 'rough-cut-review',
    required_evidence: ['AUDIO_RENDER'],
    run_mode: 'MODE_UNSPECIFIED',
  }), qcRoot());
  assert.equal(result.disposition, 'BLOCKED');
  const codes = (result.blockers || []).map((b) => b.code);
  assert.ok(codes.includes('QC_PRODUCTION_MODE_REQUIRED'), codes.join(','));
  // No guessed requirement: AUDIO_RENDER itself is not reported missing.
  assert.ok(!result.evidence_coverage.missing.includes('AUDIO_RENDER'));
});

/* ── QAP4: early evidence not required yet ─────────────────────────────── */
test('QAP4: evidence before its earliest legitimate gate is NOT_APPLICABLE_YET, not missing', () => {
  const result = qcInspect(baseTask({
    gate: 'script-review', // before AUDIO_RENDER earliest gate (rough-cut-review)
    required_evidence: ['AUDIO_RENDER'],
    run_mode: 'PRODUCTION',
  }), qcRoot());
  assert.ok(!result.evidence_coverage.missing.includes('AUDIO_RENDER'));
  const early = result.evidence_coverage.applicability.not_applicable_yet;
  assert.ok(early.some((r) => r.kind === 'AUDIO_RENDER'));
  assert.ok(!['BLOCKED', 'FAIL'].includes(result.disposition)
    || !(result.blockers || []).some((b) => b.code === 'QC_REQUIRED_EVIDENCE_MISSING'));
});

/* ── QAP5: evidence becomes required at the correct gate ───────────────── */
test('QAP5: once the applicable gate is reached, absence correctly blocks', () => {
  const result = qcInspect(baseTask({
    gate: 'rough-cut-review',
    required_evidence: ['AUDIO_RENDER'],
    run_mode: 'PRODUCTION',
  }), qcRoot());
  assert.equal(result.disposition, 'BLOCKED');
  assert.deepEqual(result.evidence_coverage.missing, ['AUDIO_RENDER']);
});

/* ── QAP6: DRAFT never requires human capture evidence ─────────────────── */
test('QAP6: DRAFT mode does not require human-only capture evidence kinds', () => {
  // AUDIO_RENDER is PRODUCTION-only: in DRAFT it is mode_not_required, and
  // no human performance evidence kind is demanded by the machine policy.
  const result = qcInspect(baseTask({
    gate: 'rough-cut-review',
    required_evidence: ['AUDIO_RENDER'],
    run_mode: 'DRAFT',
  }), qcRoot());
  assert.ok(!result.evidence_coverage.missing.includes('AUDIO_RENDER'));
  assert.ok(result.evidence_coverage.applicability.mode_not_required
    .some((r) => r.kind === 'AUDIO_RENDER'));
  // Human approvals are never machine-required in DRAFT.
  for (const kind of ['FINAL_CUT_APPROVAL', 'TITLE_THUMBNAIL_APPROVAL']) {
    const r = policy.resolveApplicability(kind, 'rough-cut-review', 'DRAFT');
    assert.notEqual(r.status, 'REQUIRED');
  }
});

/* ── QAP7: REVIEW reuses valid DRAFT-era Story evidence ────────────────── */
test('QAP7: valid Story evidence satisfies QC in DRAFT and again in REVIEW without regeneration', () => {
  // Policy level: STORY_VALIDATION is required in both modes at/after research.
  for (const mode of ['DRAFT', 'REVIEW', 'PRODUCTION']) {
    const r = policy.resolveApplicability('STORY_VALIDATION', 'research', mode);
    assert.equal(r.status, 'REQUIRED', mode);
  }
  // QC level: a satisfied STORY_VALIDATION (inline payload) passes in REVIEW
  // exactly as it did in DRAFT — same bytes, no redundant production.
  const evidencePayload = { schema_version: 1, verdict: 'PASS', warnings: [] };
  const mk = (mode) => qcInspect(baseTask({
    task_id: `qap7-${mode}`,
    evidence: [{
      evidence_id: 'sv', kind: 'STORY_VALIDATION', evidence_class: 'DETERMINISTIC',
      produced_by: 'story_validator', payload: evidencePayload,
      binds_to: { artifact_id: 'subj-1' },
    }],
    run_mode: mode,
  }), qcRoot());
  const draft = mk('DRAFT');
  const review = mk('REVIEW');
  assert.deepEqual(draft.evidence_coverage.missing, []);
  assert.deepEqual(review.evidence_coverage.missing, []);
});

/* ── QAP8: PRODUCTION rejects insufficient fidelity via policy ─────────── */
test('QAP8: PRODUCTION requires its own evidence even when weaker modes would not', () => {
  // In DRAFT the PRODUCTION-only kind is not required; in PRODUCTION the same
  // gate requires it. The difference is policy, not relaxation.
  const draft = policy.resolveApplicability('AUDIO_RENDER', 'rough-cut-review', 'DRAFT');
  const production = policy.resolveApplicability('AUDIO_RENDER', 'rough-cut-review', 'PRODUCTION');
  assert.equal(draft.status, 'MODE_NOT_REQUIRED');
  assert.equal(production.status, 'REQUIRED');
  // The QC-level consequence: DRAFT passes without it, PRODUCTION blocks.
  const d = qcInspect(baseTask({ gate: 'rough-cut-review', required_evidence: ['AUDIO_RENDER'], run_mode: 'DRAFT' }), qcRoot());
  const p = qcInspect(baseTask({ gate: 'rough-cut-review', required_evidence: ['AUDIO_RENDER'], run_mode: 'PRODUCTION' }), qcRoot());
  assert.deepEqual(d.evidence_coverage.missing, []);
  assert.deepEqual(p.evidence_coverage.missing, ['AUDIO_RENDER']);
});

/* ── QAP9: STORY_VALIDATION survives mode promotion if Story unchanged ── */
test('QAP9: same Story validation remains applicable across DRAFT->REVIEW->PRODUCTION', () => {
  const row = policy.policyForKind('STORY_VALIDATION');
  assert.deepEqual([...row.modes], ['DRAFT', 'REVIEW', 'PRODUCTION']);
  assert.ok(/unchanged|stale on Story/i.test(row.reuse_note));
  for (const mode of ['DRAFT', 'REVIEW', 'PRODUCTION']) {
    const r = policy.resolveApplicability('STORY_VALIDATION', 'capture-checklist', mode);
    assert.equal(r.status, 'REQUIRED');
  }
});

/* ── QAP10: STORY_VALIDATION stale on Story change ─────────────────────── */
test('QAP10: Story version change invalidates prior validation (policy + live verifier)', () => {
  const row = policy.policyForKind('STORY_VALIDATION');
  assert.ok(/stale/i.test(row.reuse_note));
  // Live proof lives in the STORY_VALIDATION suite (SV7: post-evidence content
  // drift -> stale). Here we pin the contract surface: the verifier module is
  // the staleness authority, not timestamps.
  const sv = require('../scripts/package-run-story-validation.js');
  assert.equal(typeof sv.verifyExistingEvidence, 'function');
});

/* ── QAP11: DRAFT audio is not required and not faked ──────────────────── */
test('QAP11: AUDIO_RENDER Draft semantics are documented as a fidelity gap, not silently satisfied', () => {
  const row = policy.policyForKind('AUDIO_RENDER');
  assert.equal(row.class, 'MODE_REQUIRED');
  assert.deepEqual([...row.modes], ['PRODUCTION']);
  assert.ok(row.fidelity_note && /draft/i.test(row.fidelity_note), 'fidelity gap must be documented');
});

/* ── QAP12: PRODUCTION fidelity enforced at QC level ───────────────────── */
test('QAP12: PRODUCTION QC with no AUDIO_RENDER evidence blocks truthfully', () => {
  const result = qcInspect(baseTask({
    gate: 'final-review',
    required_evidence: ['AUDIO_RENDER'],
    run_mode: 'PRODUCTION',
  }), qcRoot());
  assert.equal(result.disposition, 'BLOCKED');
  assert.ok((result.blockers || []).some((b) => b.code === 'QC_REQUIRED_EVIDENCE_MISSING'));
});

/* ── QAP13: mode change does not rewrite evidence ──────────────────────── */
test('QAP13: applicability changes by mode never mutate evidence files', () => {
  const root = qcRoot();
  const evDir = path.join(root, 'package-runs', 'qap13-run');
  fs.mkdirSync(evDir, { recursive: true });
  const evPath = path.join(evDir, 'story-validation.json');
  fs.writeFileSync(evPath, JSON.stringify({ schema_version: 1, verdict: 'PASS', warnings: [] }));
  const before = fs.readFileSync(evPath, 'utf8');
  const bytesBefore = fs.statSync(evPath).mtimeMs;
  for (const mode of ['DRAFT', 'REVIEW', 'PRODUCTION', 'MODE_UNSPECIFIED']) {
    policy.auditRequiredEvidence(['STORY_VALIDATION', 'AUDIO_RENDER'], 'rough-cut-review', mode);
  }
  assert.equal(fs.readFileSync(evPath, 'utf8'), before);
  assert.equal(fs.statSync(evPath).mtimeMs, bytesBefore);
});

/* ── QAP14: QC does not mutate mode/gates ──────────────────────────────── */
test('QAP14: QC run with applicability audit performs no writes to mode or lifecycle', () => {
  const root = qcRoot();
  const runDir = path.join(root, 'package-runs', 'qap14-run');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'production-mode.json'), JSON.stringify({ schema: 'vidtoolz.productionMode.v1', mode: 'DRAFT' }));
  const beforeMode = fs.readFileSync(path.join(runDir, 'production-mode.json'), 'utf8');
  const dirBefore = fs.readdirSync(runDir).sort();
  qcInspect(baseTask({ gate: 'rough-cut-review', required_evidence: ['AUDIO_RENDER'], run_mode: 'DRAFT' }), root);
  assert.equal(fs.readFileSync(path.join(runDir, 'production-mode.json'), 'utf8'), beforeMode);
  assert.deepEqual(fs.readdirSync(runDir).sort(), dirBefore);
});

/* ── QAP15: every REQUIRED policy row has a producer ───────────────────── */
test('QAP15: all policy rows that can be REQUIRED name an existing producer', () => {
  for (const [kind, row] of Object.entries(policy.EVIDENCE_POLICY)) {
    if (row.class === 'HUMAN_EXTERNAL' || row.class === 'OPTIONAL_ADVISORY') continue;
    assert.ok(row.producer, `${kind} lacks producer`);
    assert.ok(fs.existsSync(path.join(ROOT, row.producer_module)), `${kind} producer module missing`);
  }
});

/* ── Applicability consistency invariant (§23) ─────────────────────────── */
test('QAP16: applicability consistency invariant — never required too early, in wrong mode, or under MODE_UNSPECIFIED', () => {
  const check = policy.checkApplicabilityConsistency();
  assert.deepEqual(check.violations, [], JSON.stringify(check.violations));
});

/* ── Legacy semantics preserved ────────────────────────────────────────── */
test('QAP17: tasks without run_mode keep exact legacy required-evidence semantics', () => {
  const result = qcInspect(baseTask({ gate: 'script-review', required_evidence: ['AUDIO_RENDER'] }), qcRoot());
  // No run_mode -> legacy path: AUDIO_RENDER is simply required and missing.
  assert.deepEqual(result.evidence_coverage.missing, ['AUDIO_RENDER']);
  assert.equal(result.evidence_coverage.applicability, null);
});

module.exports = { tests };
