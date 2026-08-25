'use strict';

// REAL LIFECYCLE INTEGRATION — one strong invariant, not a re-run of the
// 14-gate unit tests.
//
// Every lifecycle component had been proven in isolation; none had been proven
// against a genuine package run. This asserts the property that matters when
// they meet: a run created through the REAL creation path is immediately and
// consistently visible to every state surface, and stays consistent as it
// advances.
//
// It also locks in the defect the first real run exposed: parking a run made
// two projection consumers disagree, one of them reporting the LAST gate for a
// run that never passed gate two.

const { assert, fs, os, path, test } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const workflowMap = require('../scripts/package-run-workflow-map.js');
const stageProjection = require('../scripts/workflow-stage-projection.js');
const runStateProjection = require('../scripts/package-run-state-projection.js');
const runStateOps = require('../scripts/package-run-state-operations.js');
const packageRunsIndex = require('../scripts/package-runs-index.js');

function scratchRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-integration-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'config', 'agent-registry.json'), path.join(root, 'config', 'agent-registry.json'));
  return root;
}

/** Sample every state surface for one run. */
function surfaces(repoRoot, runId) {
  const runDir = path.join(repoRoot, 'package-runs', runId);
  const map = workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot });
  const gate = stageProjection.currentCanonicalGate(map.gates || []);
  const statePath = path.join(runDir, 'package-run-state.md');
  const projection = runStateProjection.buildProjection({
    repoRoot, runId,
    existingText: fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '',
  });
  const check = runStateOps.checkRunState({ repoRoot, runId });
  const projected = gate ? stageProjection.projectGate(gate.id, projection.workflow_path || 'horizontal') : null;
  return {
    genuine: packageRunsIndex.isPackageRunDir(runDir),
    canonicalGate: gate ? gate.id : null,
    completeCount: (map.gates || []).filter((g) => g.status === 'complete').length,
    stateGate: projection.current_gate,
    stateValue: projection.state,
    trackerStage: projected && projected.ok ? projected.stageKey : null,
    trackerIndex: projected && projected.ok ? projected.stageIndex : null,
    consistent: check.ok,
    defects: check.defects.map((d) => d.code),
    drift: stageProjection.detectDrift({
      runId, gateId: gate ? gate.id : null,
      workflowPath: projection.workflow_path || 'horizontal',
      evidenceCurrentStage: projected && projected.ok ? projected.stageIndex : null,
    }),
  };
}

test('LI1: a run created by the real creation path is consistent across every surface', () => {
  // The real creation entry point, invoked in-process. Shelling out made this
  // inherit the parent's environment, and under the full suite that surfaced as
  // an unrelated crypto failure inside the child. Calling main() exercises the
  // same code path without importing an unrelated process's environment.
  const runId = '2099-02-02-integration-test-run';
  const runDir = path.join(ROOT, 'package-runs', runId);
  fs.rmSync(runDir, { recursive: true, force: true });
  const creation = require('../scripts/package-engine-new-run.js');
  const exitCode = creation.main(['integration test run', '--date', '2099-02-02']);
  try {
    assert.equal(exitCode, 0, 'the real creation path must succeed');
    assert.ok(fs.existsSync(runDir), 'creation must produce the run directory');
    assert.ok(fs.existsSync(path.join(runDir, 'package-run-state.md')),
      'creation must write the durable projection immediately — a new run is never UNKNOWN');

    const s = surfaces(ROOT, runId);
    assert.equal(s.genuine, true, 'the real creation path must produce a genuine package run');
    assert.equal(s.canonicalGate, 'package-selection');
    assert.equal(s.stateGate, s.canonicalGate, 'package-run-state must match canonical');
    assert.equal(s.trackerStage, 'idea', 'tracker projects the canonical gate');
    assert.equal(s.consistent, true, `projection defects: ${s.defects.join(', ')}`);
    assert.equal(s.drift, null, 'a fresh run must have no projection drift');
    assert.notEqual(s.stateValue, 'UNKNOWN_LEGACY', 'a new run is never UNKNOWN');
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('LI2: earning real evidence advances every surface together', () => {
  const root = scratchRepo();
  const runId = '2099-02-03-integration-advance';
  const runDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(runDir, 'package-candidates.json'), JSON.stringify({ candidates: [] }));
    runStateOps.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });
    const before = surfaces(root, runId);
    assert.equal(before.canonicalGate, 'package-selection');
    assert.equal(before.completeCount, 0);

    // Real evidence for gate 1: the operator selection contract.
    fs.writeFileSync(path.join(runDir, 'selected-package.json'),
      JSON.stringify({ package: { proposedTitle: 'Integration test package' } }, null, 2));
    runStateOps.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });
    const after = surfaces(root, runId);

    assert.equal(after.canonicalGate, 'research', 'canonical advanced on real evidence');
    assert.equal(after.completeCount, 1);
    assert.equal(after.stateGate, 'research', 'durable projection followed');
    assert.equal(after.trackerStage, 'research', 'tracker followed');
    assert.equal(after.consistent, true);
    assert.equal(after.drift, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('LI3: artifact presence alone cannot advance any surface', () => {
  const root = scratchRepo();
  const runId = '2099-02-04-integration-noselfpromote';
  const runDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(runDir, 'selected-package.json'),
      JSON.stringify({ package: { proposedTitle: 'No self promotion' } }, null, 2));
    // Late-stage artifacts declaring PASS, with none of the prerequisites.
    fs.writeFileSync(path.join(runDir, 'final-review.md'), '# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n');
    fs.writeFileSync(path.join(runDir, 'export-checklist.md'), '# Export\n\n- Export checklist status: PASS\n- Manual approval: APPROVED\n');
    runStateOps.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });
    const s = surfaces(root, runId);

    assert.equal(s.canonicalGate, 'research', 'downstream artifacts must not advance canonical state');
    assert.equal(s.completeCount, 1);
    assert.equal(s.trackerStage, 'research', 'tracker must not display beyond canonical');
    assert.equal(s.drift, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('LI4: an inactive run reports no canonical gate, not the first or last one', () => {
  // Regression for the defect the first real run exposed: parking made the two
  // projection consumers disagree, one reporting `repurposing` — the LAST gate —
  // for a run that never passed gate two.
  const root = scratchRepo();
  const runId = '2099-02-05-integration-parked';
  const runDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(runDir, 'selected-package.json'),
      JSON.stringify({ package: { proposedTitle: 'Parked run' } }, null, 2));
    runStateOps.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });
    const active = surfaces(root, runId);
    assert.equal(active.canonicalGate, 'research');

    // Park it through the human-owned marker block.
    const statePath = path.join(runDir, 'package-run-state.md');
    fs.writeFileSync(statePath, fs.readFileSync(statePath, 'utf8').replace('- Package run state: active', '- Package run state: parked'));
    runStateOps.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });

    const map = workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: root });
    assert.ok((map.gates || []).every((g) => g.status === 'inactive'), 'precondition: parking marks every gate inactive');

    // Both consumers must agree there is no position, rather than inventing one.
    assert.equal(stageProjection.currentCanonicalGate(map.gates || []), null);
    assert.equal(runStateProjection.currentGateIdFromMap(map), '');

    const parked = surfaces(root, runId);
    assert.equal(parked.stateValue, 'PARKED');
    assert.equal(parked.canonicalGate, null, 'a parked run has no canonical gate');
    assert.notEqual(parked.stateGate, 'repurposing', 'a parked early run must never read as nearly finished');
    assert.equal(parked.consistent, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('LI5: a parked run resumes on a correctly scoped human approval and advances exactly one gate', () => {
  // The highest-value regression from the real run: human authority must be
  // neither bypassable nor accidentally global. A recorded approval at one gate
  // must advance that gate and grant nothing to later ones.
  const root = scratchRepo();
  const runId = '2099-02-06-integration-human-approval';
  const runDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(runDir, 'selected-package.json'),
      JSON.stringify({ package: { proposedTitle: 'Human approval run' } }, null, 2));
    // Research evidence complete, but no approval marker yet.
    fs.writeFileSync(path.join(runDir, 'research-pack.md'), '# Research Pack\n\n- Status: PARTIAL\n');
    fs.writeFileSync(path.join(runDir, 'source-support-map.md'),
      '# Source Support Map\n\n| source/reference | claim supported | evidence type | reliability note | status |\n'
      + '| --- | --- | --- | --- | --- |\n'
      + '| scripts/package-run-workflow-map.js | fourteen canonical gates | primary source | authoritative | closed |\n'
      + '| docs/workflow-state-authority.md | projections are not authorities | primary source | authoritative | closed |\n');
    fs.writeFileSync(path.join(runDir, 'proof-capture-plan.md'),
      '# Proof Capture Plan\n\n| proof item | what it proves | local capture method | file/app/source | status |\n'
      + '| --- | --- | --- | --- | --- |\n'
      + '| gate timeline | run crosses real gates | sample each surface | package-run-state.md | closed |\n');
    fs.writeFileSync(path.join(runDir, 'research-objections.md'),
      '# Research Objections\n\n| objection/counterexample | why it matters | evidence needed | response plan | status |\n'
      + '| --- | --- | --- | --- | --- |\n'
      + '| canary may not match production | proof would be void | isPackageRunDir true | verified | closed |\n');
    fs.writeFileSync(path.join(runDir, 'research-evidence.md'),
      '# Research Evidence\n\n## Human Evidence Notes\n\n- Evidence recorded in the mapped files.\n\n## Approval Marker\n\n- Research approval: TODO\n');
    // Park it, as the real canary was.
    runStateOps.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });
    const statePath = path.join(runDir, 'package-run-state.md');
    fs.writeFileSync(statePath, fs.readFileSync(statePath, 'utf8').replace('- Package run state: active', '- Package run state: parked'));
    runStateOps.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });

    const parked = surfaces(root, runId);
    assert.equal(parked.stateValue, 'PARKED');
    assert.equal(parked.canonicalGate, null, 'a parked run has no canonical gate');

    // Record the human approval through the canonical marker, then resume.
    fs.writeFileSync(path.join(runDir, 'research-evidence.md'),
      fs.readFileSync(path.join(runDir, 'research-evidence.md'), 'utf8')
        .replace('- Research approval: TODO', '- Research approval: PASS\n- Approved by: Mikko'));
    fs.writeFileSync(statePath, fs.readFileSync(statePath, 'utf8').replace('- Package run state: parked', '- Package run state: active'));
    runStateOps.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });

    const resumed = surfaces(root, runId);
    assert.equal(resumed.stateValue !== 'PARKED', true, 'the run resumed');
    assert.equal(resumed.canonicalGate, 'script-structure', 'the approval advanced exactly the research gate');
    assert.equal(resumed.completeCount, 2, 'package-selection and research are complete — and nothing beyond');
    assert.equal(resumed.consistent, true);
    assert.equal(resumed.drift, null, 'no projection drift across a human-approval transition');

    // The approval must not have leaked forward into any later gate.
    const map = workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: root });
    const later = (map.gates || []).filter((g) => ['script-review', 'production-plan', 'shot-edit-plan-review', 'final-review'].includes(g.id));
    for (const gate of later) {
      assert.notEqual(gate.status, 'complete', `${gate.id} must not be satisfied by a research approval`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('LI6: a recorded approval is evaluated against the current artifact, not the run id', () => {
  // Approval binding: the marker alone must not hold a PASS once the governed
  // evidence is materially revised.
  const researchEvidence = require('../scripts/package-run-research-evidence.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-binding-'));
  try {
    fs.writeFileSync(path.join(dir, 'selected-package.json'), JSON.stringify({ package: { proposedTitle: 'Binding' } }));
    fs.writeFileSync(path.join(dir, 'source-support-map.md'),
      '# Source Support Map\n\n| source/reference | claim supported | evidence type | reliability note | status |\n'
      + '| --- | --- | --- | --- | --- |\n'
      + '| scripts/package-run-workflow-map.js | fourteen gates | primary source | authoritative | closed |\n'
      + '| docs/workflow-state-authority.md | projections are views | primary source | authoritative | closed |\n');
    fs.writeFileSync(path.join(dir, 'proof-capture-plan.md'),
      '# Proof Capture Plan\n\n| proof item | what it proves | local capture method | file/app/source | status |\n'
      + '| --- | --- | --- | --- | --- |\n'
      + '| timeline | gates crossed | sample surfaces | package-run-state.md | closed |\n');
    fs.writeFileSync(path.join(dir, 'research-objections.md'),
      '# Research Objections\n\n| objection/counterexample | why it matters | evidence needed | response plan | status |\n'
      + '| --- | --- | --- | --- | --- |\n'
      + '| canary divergence | proof void | isPackageRunDir | verified | closed |\n');
    fs.writeFileSync(path.join(dir, 'research-evidence.md'),
      '# Research Evidence\n\n## Approval Marker\n\n- Research approval: PASS\n- Approved by: Mikko\n');

    assert.equal(researchEvidence.evaluateResearchEvidence(dir).status, 'PASS');

    // Materially revise the governed artifact; the marker is untouched.
    fs.writeFileSync(path.join(dir, 'source-support-map.md'),
      '# Source Support Map\n\n| source/reference | claim supported | evidence type | reliability note | status |\n'
      + '| --- | --- | --- | --- | --- |\n| TODO | TODO | TODO | TODO | open |\n');
    const revised = researchEvidence.evaluateResearchEvidence(dir);
    assert.equal(revised.approval, true, 'the marker is still literally present');
    assert.notEqual(revised.status, 'PASS', 'but it no longer carries the gate — approval binds the reviewed evidence');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
