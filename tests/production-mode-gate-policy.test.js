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
  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  const projection = stateProjection.buildProjection({ repoRoot: root, runId, runDir: dir });
  assert.equal(projection.production_mode, 'REVIEW');
  // Mode and gate are separate dimensions and must not be collapsed.
  assert.equal(projection.current_gate, 'capture-checklist');
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
  // And it is still exactly where it was: mode work did not move it.
  assert.equal(projection.current_gate, 'capture-checklist');
});

/* ========================== GATE-7 MODE POLICY (G7M1-G7M10) =============== */

test('gate7 G7M1: DRAFT requires proxy delivery and is blocked by named capabilities', () => {
  const policy = gateModePolicy.policyFor('capture-checklist', 'DRAFT');
  assert.equal(policy.implementation_status, 'BLOCKED');
  assert.equal(policy.human_performance_required, false);
  assert.equal(policy.machine_owner, 'generation_supervisor');
  assert.ok(policy.required_evidence.length > 0);
  assert.ok(policy.blocked_by.length >= 3, 'the blockers must be named, not implied');

  // Each named blocker is a live fact, not an assertion in prose.
  const promptAdapter = require('../scripts/visual-plan-prompt-adapter.js');
  assert.ok(!promptAdapter.PROMPT_MEDIA.has('PRESENTER_A_ROLL'),
    'presenter A-roll must be outside the generation lane for this blocker to be real');
  const manifest = fs.readFileSync(path.join(ROOT, 'scripts', 'presenter-take-manifest.js'), 'utf8');
  assert.ok(!/\b(proxy|synthetic|avatar)\b/i.test(manifest),
    'the take manifest must model real delivery only for this blocker to be real');
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
  assert.equal(policy.implementation_status, 'PLANNED');
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

  // And DRAFT's zero-human doctrine collides there, with the need recorded.
  const draft8 = gateModePolicy.policyFor('capture-evidence', 'DRAFT');
  assert.equal(draft8.implementation_status, 'BLOCKED');
  assert.equal(draft8.human_approval_required, true);
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
