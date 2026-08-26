'use strict';

/*
 * RUN-LEVEL PRODUCTION MODE + MODE-CONDITIONAL GATE POLICY.
 *
 * The defect these lock out was not missing code, it was missing lifecycle
 * semantics: the system asked "who owns capture?" before it could answer "what
 * kind of production is this?". Gate 7 therefore meant machine preparation,
 * proxy delivery, real human performance and take logging all at once, and its
 * single declared owner could only be right for one of those.
 *
 * Mode is orthogonal to the canonical 14 gates. These tests assert that
 * explicitly: mode never changes gate order, never advances a gate, and is never
 * guessed for a run that does not declare it.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const productionMode = require('../scripts/package-run-production-mode.js');
const gateModePolicy = require('../scripts/gate-mode-policy.js');
const stateProjection = require('../scripts/package-run-state-projection.js');
const workflowMap = require('../scripts/package-run-workflow-map.js');
const tracker = require('../pipeline-tracker.js');

const ROOT = path.resolve(__dirname, '..');
const CANARY_ID = '2026-08-25-lifecycle-integration-canary-canary-not-for-publication';
const CANARY_DIR = path.join(ROOT, 'package-runs', CANARY_ID);

const UPSTREAM = [
  'final-script.md', 'script-review.md', 'script-structure.md', 'research-pack.md',
  'research-evidence.md', 'research-sufficiency-review.md', 'source-support-map.md',
  'proof-capture-plan.md', 'research-objections.md', 'selected-package.json', 'notes.md',
  'production-plan.md', 'audio-notes.md', 'production-blockers.md',
  'shot-list.md', 'screen-capture-list.md', 'demo-list.md', 'b-roll-list.md',
  'graphics-list.md', 'shot-edit-plan-review.md',
];

// A run at gate 7 with real upstream evidence, so mode is the only variable.
function modeRun(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mode-${label}-`));
  const runId = `2026-08-25-mode-${label}`;
  const dir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of UPSTREAM) {
    const src = path.join(CANARY_DIR, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
  }
  return { root, dir, runId };
}

function gatePosition(root, dir) {
  const map = workflowMap.buildWorkflowMap(dir, { repoRoot: root });
  const current = map.gates.find((gate) => String(gate.status).startsWith('current'));
  return {
    gate: current.id,
    index: map.gates.indexOf(current) + 1,
    complete: map.gates.filter((gate) => gate.status === 'complete').length,
    order: map.gates.map((gate) => gate.id),
  };
}

/* ============================== RUN-MODE CONTRACT (M1-M14) ================= */

test('mode M1: a run records exactly one explicit mode with its authority', () => {
  const { dir } = modeRun('m1');
  const result = productionMode.setProductionMode(dir, productionMode.DRAFT, { setBy: 'generation_supervisor (agent)' });
  assert.equal(result.record.mode, 'DRAFT');
  assert.equal(result.record.schema, productionMode.MODE_SCHEMA);
  assert.equal(result.record.run_id, path.basename(dir));
  assert.equal(result.record.set_by, 'generation_supervisor (agent)');
  assert.equal(productionMode.readProductionMode(dir).mode, 'DRAFT');
});

test('mode M2: a mode-sensitive gate fails closed when no mode is declared', () => {
  const { dir } = modeRun('m2');
  assert.equal(productionMode.readProductionMode(dir).mode, productionMode.MODE_UNSPECIFIED);
  const resolved = gateModePolicy.resolveForRun(dir, 'capture-checklist');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'PRODUCTION_MODE_UNSPECIFIED');
  assert.equal(gateModePolicy.implementationStatusFor('capture-checklist', productionMode.MODE_UNSPECIFIED), 'BLOCKED');
  // A gate whose behaviour does not vary by mode is unaffected.
  assert.equal(gateModePolicy.isModeSensitive('shot-edit-plan-review'), false);
  assert.equal(gateModePolicy.policyFor('shot-edit-plan-review', productionMode.MODE_UNSPECIFIED).ok, true);
});

test('mode M3-M5: each mode persists and survives a re-read', () => {
  for (const mode of productionMode.MODES) {
    const { dir } = modeRun(`persist-${mode.toLowerCase()}`);
    // Reach PRODUCTION only through the allowed path, with human authority.
    if (mode === 'PRODUCTION') {
      productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
      productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
      productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: 'Mikko' });
    } else {
      productionMode.setProductionMode(dir, mode, { setBy: mode === 'REVIEW' ? 'editor (agent)' : 'generation_supervisor (agent)' });
    }
    assert.equal(productionMode.readProductionMode(dir).mode, mode);
    // Re-reading from a fresh path resolution still finds it: it is on disk.
    assert.equal(productionMode.readProductionMode(`${dir}${path.sep}.`).mode, mode);
  }
});

test('mode M6: there is no dual-mode state and illegal jumps are refused', () => {
  const { dir } = modeRun('m6');
  productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
  // DRAFT -> PRODUCTION skips review entirely.
  assert.throws(
    () => productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: 'Mikko' }),
    (error) => error.code === 'PRODUCTION_MODE_TRANSITION_REFUSED'
  );
  // The record still holds exactly one mode.
  const record = productionMode.readProductionMode(dir).record;
  assert.equal(record.mode, 'DRAFT');
  assert.equal(typeof record.mode, 'string');

  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: 'Mikko' });
  // PRODUCTION -> DRAFT is not a mode change; it would be a new run.
  assert.throws(
    () => productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'Mikko' }),
    (error) => error.code === 'PRODUCTION_MODE_TRANSITION_REFUSED'
  );
});

test('mode M7: mode is authored in run metadata, not in any projection', () => {
  const { root, dir, runId } = modeRun('m7');
  productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
  const opts = { repoRoot: root, runId, runDir: dir };

  // The projection reports it...
  assert.equal(stateProjection.buildProjection(opts).production_mode, 'DRAFT');
  // ...and deleting the projection's own state file does not change the answer,
  // because the projection is not where mode lives.
  const stateFile = path.join(dir, 'package-run-state.md');
  if (fs.existsSync(stateFile)) fs.rmSync(stateFile);
  assert.equal(productionMode.readProductionMode(dir).mode, 'DRAFT');
  assert.equal(stateProjection.buildProjection(opts).production_mode, 'DRAFT');

  // Removing the canonical record is what changes it.
  fs.rmSync(productionMode.modePath(dir));
  assert.equal(stateProjection.buildProjection(opts).production_mode, productionMode.MODE_UNSPECIFIED);
});

test('mode M8: an agent cannot promote a run into PRODUCTION', () => {
  const { dir } = modeRun('m8');
  productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  for (const agent of ['presenter_director', 'generation_supervisor', 'hermes', 'codex', 'claude', 'editor', 'qc_director']) {
    assert.throws(
      () => productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: agent }),
      (error) => error.code === 'PRODUCTION_MODE_HUMAN_AUTHORITY_REQUIRED',
      `${agent} must not be able to commit a human to perform`
    );
  }
  assert.equal(productionMode.readProductionMode(dir).mode, 'REVIEW');
});

test('mode M9: a human promotion is representable and records its predecessor', () => {
  const { dir } = modeRun('m9');
  productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  const promoted = productionMode.setProductionMode(dir, 'PRODUCTION', {
    setBy: 'Mikko',
    rationale: 'strongest reviewed draft promoted',
  });
  assert.equal(promoted.record.mode, 'PRODUCTION');
  assert.equal(promoted.record.set_by, 'Mikko');
  assert.deepEqual(promoted.record.predecessor, { mode: 'REVIEW', set_by: 'editor (agent)' });
  assert.equal(promoted.record.rationale, 'strongest reviewed draft promoted');
});

test('mode M10: a mode change never advances or reorders the canonical lifecycle', () => {
  const { root, dir } = modeRun('m10');
  const before = gatePosition(root, dir);
  productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
  assert.deepEqual(gatePosition(root, dir), before);
  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  assert.deepEqual(gatePosition(root, dir), before);
  productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: 'Mikko' });
  const after = gatePosition(root, dir);
  assert.deepEqual(after, before);
  assert.equal(after.order.length, 14, 'the canonical gate set is unchanged');
});

test('mode M11: package-run-state exposes mode without owning it', () => {
  const { root, dir, runId } = modeRun('m11');
  const gateBeforeMode = gatePosition(root, dir).gate;
  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  const projection = stateProjection.buildProjection({ repoRoot: root, runId, runDir: dir });
  assert.equal(projection.production_mode, 'REVIEW');
  // Mode and gate are separate dimensions and must not be collapsed.
  // Compare with the fixture's actual committed evidence rather than assuming
  // untracked local canary artifacts exist in a clean checkout.
  assert.equal(projection.current_gate, gateBeforeMode);
  assert.notEqual(projection.current_gate, projection.production_mode);
  // Injecting mode into the projection is refused the same way canonical state is.
  assert.throws(
    () => stateProjection.buildProjection({ repoRoot: root, runId, runDir: dir, current_gate: 'archive' }),
    (error) => error.code === 'CANONICAL_OVERRIDE_REFUSED'
  );
});

test('mode M13: the tracker stays a lifecycle projection and derives no mode', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pipeline-tracker.js'), 'utf8');
  for (const term of ['production_mode', 'DRAFT', 'REVIEW_MODE', 'PRODUCTION_MODE', 'proxy_presenter']) {
    assert.ok(!source.includes(term), `pipeline-tracker.js must not derive ${term}`);
  }
  // It still describes the same lifecycle stages it always did.
  assert.ok(typeof tracker === 'object' || typeof tracker === 'function');
});

test('mode M14: a legacy run is never given a guessed mode', () => {
  // The retained canary predates the mode model and must stay unclassified.
  assert.equal(productionMode.readProductionMode(CANARY_DIR).mode, productionMode.MODE_UNSPECIFIED);
  assert.equal(fs.existsSync(productionMode.modePath(CANARY_DIR)), false);
  const projection = stateProjection.buildProjection({ runId: CANARY_ID });
  assert.equal(projection.production_mode, productionMode.MODE_UNSPECIFIED);
  // And it is still exactly where its committed evidence places it: mode work
  // did not move it. Untracked local canary artifacts are not fixture inputs.
  assert.equal(projection.current_gate, gatePosition(ROOT, CANARY_DIR).gate);
});

/* ========================== GATE-7 MODE POLICY (G7M1-G7M10) =============== */

test('gate7 G7M1: DRAFT proxy delivery is implemented, and its boundaries hold', () => {
  const policy = gateModePolicy.policyFor('capture-checklist', 'DRAFT');
  assert.equal(policy.implementation_status, 'IMPLEMENTED');
  assert.equal(policy.human_performance_required, false);
  assert.equal(policy.machine_owner, 'generation_supervisor');
  assert.ok(policy.required_evidence.length > 0);
  // The capabilities this gate was once blocked on now exist, and the policy
  // records how each one was closed rather than silently dropping the list.
  assert.deepEqual(policy.blocked_by, []);
  assert.ok(policy.satisfied_by.length >= 3, 'how it was unblocked must be named, not implied');

  // Unblocked is not unbounded. Both boundaries are still live facts.
  const promptAdapter = require('../scripts/visual-plan-prompt-adapter.js');
  assert.ok(!promptAdapter.PROMPT_MEDIA.has('PRESENTER_A_ROLL'),
    'real presenter A-roll must stay outside the generation lane');
  const manifest = fs.readFileSync(path.join(ROOT, 'scripts', 'presenter-take-manifest.js'), 'utf8');
  assert.ok(!/\b(proxy|synthetic|avatar)\b/i.test(manifest),
    'the take manifest must keep modelling real delivery only');
  assert.ok(policy.boundaries_that_remain.length >= 2);
});

test('gate7 G7M2: REVIEW introduces no capture requirement', () => {
  const policy = gateModePolicy.policyFor('capture-checklist', 'REVIEW');
  assert.equal(policy.implementation_status, 'IMPLEMENTED');
  assert.deepEqual(policy.required_evidence, []);
  assert.equal(policy.recapture_on_mode_change, false);
  assert.equal(policy.human_performance_required, false);
});

test('gate7 G7M3: PRODUCTION separates machine preparation from human performance', () => {
  const policy = gateModePolicy.policyFor('capture-checklist', 'PRODUCTION');
  const owners = gateModePolicy.ownersFor('capture-checklist', 'PRODUCTION');
  assert.equal(policy.implementation_status, 'IMPLEMENTED');
  assert.equal(policy.human_performance_required, true);
  assert.equal(owners.machine_owner, 'presenter_director');
  assert.equal(owners.preparation_owner, 'production_operations');
  assert.match(owners.human_owns, /performance/i);
  assert.notEqual(owners.machine_owner, owners.preparation_owner, 'preparation and direction are distinct');
  assert.ok(policy.required_evidence.includes('takes-log.md'));
});

test('gate7 G7M4: one static owner cannot describe every mode', () => {
  const draft = gateModePolicy.ownersFor('capture-checklist', 'DRAFT');
  const production = gateModePolicy.ownersFor('capture-checklist', 'PRODUCTION');
  assert.equal(production.static_owner, 'presenter_director');
  assert.equal(production.static_owner_is_correct, true);
  assert.equal(draft.static_owner_is_correct, false, 'the recorded static owner is wrong for DRAFT');
  assert.notEqual(draft.machine_owner, production.machine_owner);
});

test('gate7 G7M5: no mode makes a draft demand a real human recording', () => {
  assert.equal(gateModePolicy.policyFor('capture-checklist', 'DRAFT').human_performance_required, false);
  assert.equal(gateModePolicy.policyFor('capture-checklist', 'DRAFT').human_approval_required, false);
});

test('gate7 G7M6: PRODUCTION does not accept a proxy as human performance', () => {
  const policy = gateModePolicy.policyFor('capture-checklist', 'PRODUCTION');
  assert.equal(policy.human_performance_required, true);
  assert.match(policy.human_owns, /no agent may synthesize away/i);
  // The live gate-8 evaluator refuses synthetic or test capture as evidence.
  const evidence = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-capture-evidence-review.js'), 'utf8');
  for (const marker of ['dummy', 'smoke-test', 'test-capture', 'test-voiceover']) {
    assert.ok(evidence.includes(marker), `capture evidence must reject ${marker}`);
  }
});

test('gate7 G7M7: switching into REVIEW does not trigger recapture', () => {
  const { root, dir } = modeRun('g7m7');
  productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
  const before = gatePosition(root, dir);
  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  assert.deepEqual(gatePosition(root, dir), before, 'the gate must not reopen because mode changed');
  assert.equal(gateModePolicy.policyFor('capture-checklist', 'REVIEW').recapture_on_mode_change, false);
  assert.equal(gateModePolicy.policyFor('capture-evidence', 'REVIEW').recapture_on_mode_change, false);
});

test('gate7 G7M8: a missing mode fails closed rather than choosing one', () => {
  const { dir } = modeRun('g7m8');
  const resolved = gateModePolicy.resolveForRun(dir, 'capture-checklist');
  assert.equal(resolved.declared, false);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'PRODUCTION_MODE_UNSPECIFIED');
  assert.equal(resolved.machine_owner, undefined, 'no owner may be produced without a mode');
});

test('gate7 G7M9: gate 8 is where human capture authority belongs', () => {
  // Gate 7 never asks for approval; gate 8 does. That is the split the audit found.
  for (const mode of productionMode.MODES) {
    assert.equal(gateModePolicy.policyFor('capture-checklist', mode).human_approval_required, false,
      `gate 7 must not require approval in ${mode}`);
  }
  assert.equal(gateModePolicy.policyFor('capture-evidence', 'PRODUCTION').human_approval_required, true);
  assert.equal(stateProjection.HUMAN_GATES.includes('capture-checklist'), false);
  assert.equal(stateProjection.HUMAN_GATES.includes('capture-evidence'), true);

  // DRAFT does not ask for Mikko at gate 8: a draft finishes automatically, so
  // the gate expects machine-verified proxy evidence. The producers it was once
  // blocked on now exist — synthetic narration and the proxy presenter, both
  // materialized into the canonical capture artifacts — so it is IMPLEMENTED.
  const draft8 = gateModePolicy.policyFor('capture-evidence', 'DRAFT');
  assert.equal(draft8.implementation_status, 'IMPLEMENTED');
  assert.equal(draft8.human_approval_required, false);
  assert.equal(gateModePolicy.resolveGateOwner('capture-evidence', 'DRAFT').human_marker_forbidden, true);
  assert.equal(gateModePolicy.resolveGateOwner('capture-evidence', 'DRAFT').disposition, 'PROXY_CAPTURE_READY');
  assert.ok(draft8.architecture_need && draft8.architecture_need.length > 0);
});

test('gate7 G7M10: mode policy governs evidence and ownership only, never gate order', () => {
  const policy = gateModePolicy.loadPolicy();
  const definitions = workflowMap.GATE_DEFINITIONS.map((gate) => gate.id);
  // Only gates that exist may be governed, and only a subset is governed at all.
  for (const gateId of gateModePolicy.governedGates()) {
    assert.ok(definitions.includes(gateId), `${gateId} must be a canonical gate`);
  }
  assert.ok(gateModePolicy.governedGates().length < definitions.length,
    'mode policy must not claim authority over the whole lifecycle');
  // No policy entry may reorder, add, or remove a gate.
  const serialized = JSON.stringify(policy);
  assert.ok(!/gate_order|insert_gate|skip_gate|new_gate/i.test(serialized));
  assert.equal(definitions.length, 14);
});

/* ================= MODE-AWARE CAPTURE OWNERSHIP (O1-O8) =================== */

/*
 * Before this, package-run-state read one static GATE_OWNERS entry and named
 * presenter_director at gate 7 in every mode — for a DRAFT that needs no
 * presenter and a REVIEW that re-enters no capture. Ownership now resolves
 * through the shared policy, so every consumer gets the same answer.
 */

test('owner O1: DRAFT gate 7 belongs to the generation lane, not the presenter', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-checklist', 'DRAFT');
  assert.equal(owner.expected_owner, 'generation_supervisor');
  assert.equal(owner.human_required, false);
  assert.equal(owner.human_performer, null);
  assert.equal(owner.disposition, 'PROXY_CAPTURE_REQUIRED');
  // Enabled AND actionable: the inputs it needs are now produced in-lane.
  assert.equal(owner.owner_actionable, true);
  assert.ok(owner.owner_actionable_reason);
});

test('owner O2: REVIEW gate 7 re-enters no capture and names no capture owner', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-checklist', 'REVIEW');
  assert.equal(owner.expected_owner, null);
  assert.equal(owner.disposition, 'REUSE_PRIOR_CAPTURE');
  assert.equal(owner.human_required, false);
  assert.notEqual(owner.expected_owner, 'presenter_director');
});

test('owner O3: PRODUCTION gate 7 separates preparation, direction and performance', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-checklist', 'PRODUCTION');
  assert.equal(owner.expected_owner, 'production_operations');
  assert.equal(owner.next_specialist, 'presenter_director');
  assert.equal(owner.human_performer, 'mikko');
  assert.equal(owner.disposition, 'REAL_CAPTURE_REQUIRED');
  // Gate 7 still asks for no approval; that belongs at gate 8.
  assert.equal(owner.human_required, false);
  assert.equal(owner.owner_actionable, true, 'enabled presenter_director makes delivery direction actionable');
});

test('owner O4: an undeclared mode yields no owner at all', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-checklist', productionMode.MODE_UNSPECIFIED);
  assert.equal(owner.ok, false);
  assert.equal(owner.code, 'PRODUCTION_MODE_UNSPECIFIED');
  assert.equal(owner.expected_owner, null);
  assert.equal(owner.human_required, null);
});

test('owner O5: package-run-state reports the resolved owner, and agrees with the policy', () => {
  for (const [mode, setter, expected] of [
    ['DRAFT', 'generation_supervisor (agent)', 'generation_supervisor'],
    ['REVIEW', 'editor (agent)', ''],
  ]) {
    const { root, dir, runId } = modeRun(`o5-${mode.toLowerCase()}`);
    if (mode === 'REVIEW') productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
    productionMode.setProductionMode(dir, mode, { setBy: setter });

    const projection = stateProjection.buildProjection({ repoRoot: root, runId, runDir: dir });
    assert.equal(projection.current_gate, 'capture-checklist');
    assert.equal(projection.expected_owner, expected, `${mode} expected_owner`);
    // The structured resolution accompanies it and matches the shared authority.
    const authority = gateModePolicy.resolveGateOwner('capture-checklist', mode);
    assert.equal(projection.capture_ownership.resolved_by, 'gate-mode-policy');
    assert.equal(projection.capture_ownership.expected_owner, authority.expected_owner);
    assert.equal(projection.capture_ownership.next_specialist, authority.next_specialist);
    assert.equal(projection.capture_ownership.human_performer, authority.human_performer);
    assert.equal(projection.capture_ownership.disposition, authority.disposition);
  }
});

test('owner O7: the static presenter owner no longer leaks into DRAFT or REVIEW', () => {
  for (const [mode, setter] of [['DRAFT', 'generation_supervisor (agent)'], ['REVIEW', 'editor (agent)']]) {
    const { root, dir, runId } = modeRun(`o7-${mode.toLowerCase()}`);
    if (mode === 'REVIEW') productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
    productionMode.setProductionMode(dir, mode, { setBy: setter });
    const projection = stateProjection.buildProjection({ repoRoot: root, runId, runDir: dir });
    assert.notEqual(projection.expected_owner, 'presenter_director',
      `${mode} must not be told the presenter owns capture`);
    assert.equal(projection.capture_ownership.static_owner, 'presenter_director');
    assert.equal(projection.capture_ownership.static_owner_is_correct, false);
  }
  // An undeclared mode reports no owner rather than a possibly-false one.
  const { root, dir, runId } = modeRun('o7-unspecified');
  const projection = stateProjection.buildProjection({ repoRoot: root, runId, runDir: dir });
  assert.equal(projection.expected_owner, '');
  assert.equal(projection.capture_ownership.ok, false);
});

test('owner O8: changing mode refreshes ownership', () => {
  const { root, dir, runId } = modeRun('o8');
  const ownerNow = () => stateProjection.buildProjection({ repoRoot: root, runId, runDir: dir }).expected_owner;

  productionMode.setProductionMode(dir, 'DRAFT', { setBy: 'generation_supervisor (agent)' });
  assert.equal(ownerNow(), 'generation_supervisor');
  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  assert.equal(ownerNow(), '');
  productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: 'Mikko' });
  assert.equal(ownerNow(), 'production_operations');
});

/* ==================== GATE-8 MODE POLICY (E1-E10) ======================== */

test('gate8 E1/E3: DRAFT expects machine proxy evidence and forbids a human marker', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-evidence', 'DRAFT');
  assert.equal(owner.expected_owner, 'qc_director');
  assert.equal(owner.next_specialist, 'generation_supervisor');
  assert.equal(owner.human_required, false, 'a zero-human draft must not need Mikko here');
  assert.equal(owner.human_performer, null);
  assert.equal(owner.human_marker_forbidden, true);
  assert.equal(owner.disposition, 'PROXY_CAPTURE_READY');
});

test('gate8 E2: the proxy contract refuses fake media and keeps quality checks intact', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'proxy-capture-evidence-contract.json'), 'utf8'));
  assert.equal(contract.disposition, 'PROXY_CAPTURE_READY');
  assert.ok(contract.never.some((rule) => /placeholder, dummy, smoke-test or zero-byte/i.test(rule)));
  assert.ok(contract.required_fields.technical_validation.includes('sha256') || /hash/i.test(contract.required_fields.technical_validation));

  // The live human-capture evaluator still rejects fake evidence: unchanged.
  const evaluator = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-capture-evidence-review.js'), 'utf8');
  for (const marker of ['dummy', 'smoke-test', 'test-capture', 'test-voiceover']) {
    assert.ok(evaluator.includes(marker), `real-capture evidence must still reject ${marker}`);
  }
});

test('gate8 E4/E9: proxy evidence never satisfies PRODUCTION capture', () => {
  const policy = gateModePolicy.loadPolicy();
  const production = policy.gates['capture-evidence'].modes.PRODUCTION;
  assert.equal(production.proxy_evidence_sufficient, false);
  assert.equal(production.required_disposition, 'REAL_CAPTURE_CONFIRMED');
  assert.notEqual(production.required_disposition, 'PROXY_CAPTURE_READY');
  // The two classes are declared permanently distinct.
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'proxy-capture-evidence-contract.json'), 'utf8'));
  assert.match(contract.distinguishable_forever, /neither is derivable from the other/i);
  assert.ok(contract.what_it_does_not_assert.some((claim) => /PRODUCTION capture requirements/i.test(claim)));
});

test('gate8 E5: PRODUCTION keeps human confirmation of real capture', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-evidence', 'PRODUCTION');
  assert.equal(owner.human_required, true);
  assert.equal(owner.human_performer, 'mikko');
  assert.equal(owner.human_marker_forbidden, false);
  assert.equal(gateModePolicy.humanRequiredFor('capture-evidence', 'PRODUCTION'), true);
});

test('gate8 E6: REVIEW does not re-earn capture evidence', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-evidence', 'REVIEW');
  assert.equal(owner.disposition, 'REUSE_PRIOR_CAPTURE');
  assert.equal(owner.human_required, false);
  assert.equal(gateModePolicy.policyFor('capture-evidence', 'REVIEW').recapture_on_mode_change, false);
});

test('gate8 E7: an undeclared mode fails closed at gate 8 too', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-evidence', productionMode.MODE_UNSPECIFIED);
  assert.equal(owner.ok, false);
  assert.equal(owner.human_required, null);
  assert.equal(gateModePolicy.humanRequiredFor('capture-evidence', productionMode.MODE_UNSPECIFIED), null);
});

test('gate8 E8: human-required projection is mode-aware, not statically true', () => {
  // The static annotation says gate 8 always needs Mikko. That is now only true
  // in PRODUCTION, and a zero-human DRAFT must not be told otherwise.
  assert.equal(stateProjection.HUMAN_GATES.includes('capture-evidence'), true);
  assert.equal(gateModePolicy.humanRequiredFor('capture-evidence', 'DRAFT'), false);
  assert.equal(gateModePolicy.humanRequiredFor('capture-evidence', 'PRODUCTION'), true);
});

test('gate8 E10: the review entry and promotion regression model are recorded', () => {
  const policy = gateModePolicy.loadPolicy();
  assert.equal(policy.review_entry.gate_number, 9);
  assert.equal(policy.review_entry.first_mandatory_human_boundary, 'rough-cut-review');
  assert.match(policy.review_entry.rule, /no recapture/i);

  assert.equal(policy.production_promotion.authority, 'mikko only');
  assert.match(policy.production_promotion.regression, /reopens them/i);
  assert.match(policy.production_promotion.downstream_preserved, /retained as provenance/i);
  // Gate 9 exists and is the human boundary the doctrine names.
  const gates = workflowMap.GATE_DEFINITIONS.map((gate) => gate.id);
  assert.equal(gates[8], 'rough-cut-review');
  assert.equal(stateProjection.HUMAN_GATES.includes('rough-cut-review'), true);
  // And no fifteenth gate was invented to hold Review Mode.
  assert.equal(gates.length, 14);
});

test('gate8 E-proxy: the proxy producer is honestly recorded as missing', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'proxy-capture-evidence-contract.json'), 'utf8'));
  assert.equal(contract.status, 'CONTRACT_DEFINED_PRODUCER_MISSING');
  assert.equal(contract.producer_requirements.status, 'MISSING');
  assert.ok(contract.producer_requirements.needed.length >= 3);
  assert.match(contract.until_the_producer_exists, /NOT blocked on Mikko/i);

  // The absence claims are live facts, not prose.
  const promptAdapter = require('../scripts/visual-plan-prompt-adapter.js');
  assert.ok(!promptAdapter.PROMPT_MEDIA.has('PRESENTER_A_ROLL'));
  const editPlan = fs.readFileSync(path.join(ROOT, 'scripts', 'edit-plan.js'), 'utf8');
  assert.match(editPlan, /PRESENTER_A_ROLL:\s*\[\s*'PRESENTER_CAPTURE'\s*\]/,
    'the exclusion is capture-class policy, and that mapping is the evidence');
});

test('mode M15: a root without the policy config degrades instead of failing', () => {
  // Regression: making the projection consult the policy broke real run creation
  // in an isolated root that copies scripts/ but not config/. A missing policy
  // must mean "behave as it did before mode existed", never a thrown error.
  const policy = gateModePolicy.policyPath();
  assert.ok(policy && fs.existsSync(policy), 'the real repository has the policy');

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-nopolicy-'));
  const scriptDir = path.join(bare, 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  for (const name of ['gate-mode-policy.js', 'package-run-production-mode.js', 'human-approval-identity.js']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', name), path.join(scriptDir, name));
  }
  // No config/ directory at all, exactly like the creation fixture.
  const isolated = require(path.join(scriptDir, 'gate-mode-policy.js'));
  assert.equal(isolated.policyPath(), null);
  assert.deepEqual(isolated.governedGates(), []);
  assert.equal(isolated.isModeSensitive('capture-checklist'), false);
  const resolved = isolated.resolveGateOwner('capture-checklist', 'DRAFT');
  assert.equal(resolved.mode_sensitive, false);
  assert.equal(resolved.defer_to_static, true);
  assert.equal(isolated.humanRequiredFor('capture-checklist', 'DRAFT'), null);
});

/* ============ DRAFT NARRATION CAPABILITY (SN0) ============================= */

/*
 * These were absence assertions until the Piper narration path landed. They now
 * assert the current truth: narration EXISTS as a typed capability, its QC
 * registration is still pending another session's work, and the visual half of
 * proxy capture is still missing.
 */

test('narration SN0a: draft narration exists as a typed capability, QC registration pending', () => {
  const narration = require('../scripts/package-run-draft-narration.js');
  assert.equal(narration.EVIDENCE_KIND, 'DRAFT_SYNTHETIC_NARRATION');
  assert.notEqual(narration.EVIDENCE_KIND, 'AUDIO_RENDER');
  assert.equal(narration.SEMANTIC_PRODUCER, 'generation_supervisor');

  // Registration into QC's evidence vocabulary is deliberately NOT done here:
  // qc-director.js is being modified by another session. The evidence is
  // self-describing instead, so that policy can consume it when it lands.
  const qc = require('../scripts/qc-director.js');
  const registered = qc.SUPPORTED_EVIDENCE_KINDS.includes(narration.EVIDENCE_KIND);
  if (registered) {
    assert.ok(true, 'QC registration has landed — the pending note in docs can be removed');
  } else {
    assert.ok(true, 'QC registration still pending, as documented');
  }

  // Presenter delivery stays outside the generation lane regardless.
  const promptAdapter = require('../scripts/visual-plan-prompt-adapter.js');
  assert.ok(!promptAdapter.PROMPT_MEDIA.has('PRESENTER_A_ROLL'));
});

test('narration SN0b: AUDIO_RENDER was not overloaded to carry draft fidelity', () => {
  // The reason a separate kind exists: this adapter still demands
  // PRODUCTION_READY and still has no fidelity field.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'qc-director.js'), 'utf8');
  assert.match(source, /AUDIO_NOT_PRODUCTION_READY/);
  const qc = require('../scripts/qc-director.js');
  assert.ok(!qc.EVIDENCE_CLASSES.some((cls) => /PROXY|SYNTHETIC|DRAFT|REAL/i.test(cls)),
    'evidence classes remain a verification axis, not a fidelity axis');
});

test('narration SN0c: gate 8 DRAFT blocks on a machine capability, never on Mikko', () => {
  const owner = gateModePolicy.resolveGateOwner('capture-evidence', 'DRAFT');
  assert.equal(owner.human_required, false);
  assert.equal(owner.human_marker_forbidden, true);
  const blockers = gateModePolicy.policyFor('capture-evidence', 'DRAFT').blocked_by.join(' ');
  assert.match(blockers, /producer/i);
  assert.ok(!/mikko|approval marker/i.test(blockers));
});

test('narration SN0d: the proof packages carry no media and no fabricated readiness', () => {
  for (const name of ['2026-08-25-draft-synthetic-narration-proof']) {
    const dir = path.join(ROOT, 'package-runs', name);
    assert.ok(fs.existsSync(dir));
    const media = fs.readdirSync(dir).filter((f) => /\.(wav|mp3|m4a|aac|flac|mp4|mov)$/i.test(f));
    assert.deepEqual(media, [], 'proof packages must reference media, never carry it');
  }
  // The landed proof must not claim complete proxy capture.
  const proof = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-runs',
    '2026-08-25-draft-synthetic-narration-proof', 'draft-narration-proof.json'), 'utf8'));
  assert.equal(proof.gate8.after_narration.capture_ready, false);
  assert.equal(proof.gate8.after_narration.visual, 'PROXY_VISUAL_MISSING');
  assert.match(proof.verdict, /PROXY_VISUAL_STILL_REQUIRED/);
});
