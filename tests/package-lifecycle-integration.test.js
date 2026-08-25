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
  let primaryError = null;
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
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = teardownRealRepoTempRun(runId);
    if (primaryError) throw primaryError; // the canary's own failure wins; cleanup is logged below
    if (cleanupErrors.length) {
      throw new Error(`lifecycle integration teardown failed: ${cleanupErrors.join('; ')}`);
    }
  }
});

/**
 * Teardown for temporary runs created in the REAL repository (LI1 only — every
 * other LI test works in a scratch root). The production creation path
 * refreshes package-runs-index.json when the run appears; deletion must also
 * leave the derived discovery index consistent, or a ghost entry survives
 * until a manual rebuild. Ownership stays with the canary: remove the run
 * FIRST, rebuild the index AFTER (rebuilding before removal would re-record
 * the ghost).
 *
 * The index is non-authoritative, so a rebuild failure is a cleanup problem,
 * never a lifecycle one. This helper returns cleanup errors instead of
 * throwing so the caller can preserve a primary assertion failure: cleanup
 * errors are always logged, but they only become a test failure when the
 * canary itself succeeded.
 */
function teardownRealRepoTempRun(runId) {
  const cleanupErrors = [];
  const runDir = path.join(ROOT, 'package-runs', runId);
  try {
    fs.rmSync(runDir, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(`remove temporary run ${runId}: ${error.message}`);
  }
  try {
    packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: ROOT });
  } catch (error) {
    cleanupErrors.push(`rebuild package-runs-index after removing ${runId}: ${error.message}`);
  }
  if (cleanupErrors.length) {
    console.error(`lifecycle integration teardown: ${cleanupErrors.join('; ')}`);
  }
  return cleanupErrors;
}

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

// ── teardown hygiene (§10–§16): the canary must leave the derived discovery
// index exactly as consistent as the filesystem, every time, even when it
// fails. These tests operate on the real repository root (the creation path
// hard-roots to it), so they assert SEMANTIC truth — my temporary runs are
// gone, the filesystem and index agree — never hardcoded counts, because
// concurrent lifecycle canaries may legitimately own other genuine runs.

function runIdSet() {
  return new Set(packageRunsIndex.buildPackageRunsIndex({ repoRoot: ROOT }).runs.map((run) => run.runId));
}

test('LI7: teardown leaves the index consistent — create, index, delete, rebuild, no ghost', () => {
  const runId = '2099-02-07-teardown-normal';
  const creation = require('../scripts/package-engine-new-run.js');
  assert.equal(creation.main(['teardown normal', '--date', '2099-02-07']), 0);
  try {
    // The production creation hook indexed the run immediately.
    assert.ok(runIdSet().has(runId), 'the production creation path must index the new run');
    const teardownErrors = teardownRealRepoTempRun(runId);
    assert.deepEqual(teardownErrors, [], 'teardown must complete without cleanup errors');
    assert.ok(!fs.existsSync(path.join(ROOT, 'package-runs', runId)), 'the temporary run directory must be gone');
    const check = packageRunsIndex.checkPackageRunsIndex({ repoRoot: ROOT });
    assert.equal(check.ok, true, `index check after teardown: ${check.defects.map((d) => d.code).join(', ')}`);
    assert.ok(!runIdSet().has(runId), 'no ghost entry may survive teardown');
  } finally {
    teardownRealRepoTempRun(runId); // idempotent safety net — see LI10
  }
});

test('LI8: a failing canary still tears down — delete and rebuild happen, primary error wins', () => {
  const runId = '2099-02-08-teardown-failure';
  const creation = require('../scripts/package-engine-new-run.js');
  assert.equal(creation.main(['teardown failure', '--date', '2099-02-08']), 0);
  let primaryError = null;
  try {
    assert.ok(runIdSet().has(runId), 'the temporary run is indexed before the failure');
    assert.equal(true, false, 'primary canary failure (forced)');
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = teardownRealRepoTempRun(runId);
    assert.deepEqual(cleanupErrors, [], 'cleanup must still succeed after a primary failure');
  }
  assert.ok(primaryError, 'the primary failure must remain visible');
  assert.match(primaryError.message, /primary canary failure/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'package-runs', runId)), 'teardown deleted the run despite the failure');
  assert.ok(!runIdSet().has(runId), 'teardown rebuilt the index despite the failure');
  assert.equal(packageRunsIndex.checkPackageRunsIndex({ repoRoot: ROOT }).ok, true);
});

test('LI9: multiple temporary runs — every deleted entry disappears, retained runs survive', () => {
  const runA = '2099-02-09-teardown-multi-a';
  const runB = '2099-02-09-teardown-multi-b';
  const retained = '2026-08-25-lifecycle-integration-canary-canary-not-for-publication';
  const retainedOnDisk = fs.existsSync(path.join(ROOT, 'package-runs', retained));
  const creation = require('../scripts/package-engine-new-run.js');
  assert.equal(creation.main(['teardown multi a', '--date', '2099-02-09']), 0);
  try {
    // A second temporary run the same day (creation appends a suffix on id collision).
    assert.equal(creation.main(['teardown multi b', '--date', '2099-02-09']), 0);
    const indexed = runIdSet();
    assert.ok(indexed.has(runA), 'first temporary run indexed');
    assert.ok([...indexed].some((id) => id.startsWith('2099-02-09-teardown-multi')), 'second temporary run indexed');
    if (retainedOnDisk) assert.ok(indexed.has(retained), 'the retained real canary must remain indexed while it exists');
    teardownRealRepoTempRun(runA);
    teardownRealRepoTempRun(runB);
    teardownRealRepoTempRun('2099-02-09-teardown-multi-b'); // any suffixed sibling of the same day
    const after = runIdSet();
    assert.ok(![...after].some((id) => id.startsWith('2099-02-09-teardown-multi')), 'every temporary run of this test must be gone');
    if (retainedOnDisk) assert.ok(after.has(retained), 'teardown must never remove or exclude the retained real canary');
    assert.equal(packageRunsIndex.checkPackageRunsIndex({ repoRoot: ROOT }).ok, true);
    // Proof packages stay excluded regardless of the rebuild.
    const built = packageRunsIndex.buildPackageRunsIndex({ repoRoot: ROOT });
    assert.ok(built.scope.excluded.proof > 0, 'proof packages remain excluded after teardown rebuild');
  } finally {
    teardownRealRepoTempRun(runA);
    teardownRealRepoTempRun(runB);
  }
});

test('LI10: teardown is idempotent — a second pass after removal is harmless', () => {
  const runId = '2099-02-10-teardown-idempotent';
  const creation = require('../scripts/package-engine-new-run.js');
  assert.equal(creation.main(['teardown idempotent', '--date', '2099-02-10']), 0);
  const first = teardownRealRepoTempRun(runId);
  assert.deepEqual(first, [], 'first teardown clean');
  // Second pass: the directory is already gone (rmSync force tolerates it) and
  // the rebuild over an unchanged tree must agree with the first.
  const digestBefore = packageRunsIndex.buildPackageRunsIndex({ repoRoot: ROOT }).sourceDigest;
  const second = teardownRealRepoTempRun(runId);
  assert.deepEqual(second, [], 'second teardown clean — no ENOENT cascade');
  const digestAfter = packageRunsIndex.buildPackageRunsIndex({ repoRoot: ROOT }).sourceDigest;
  assert.equal(digestBefore, digestAfter, 'unchanged filesystem, unchanged substantive digest');
  assert.ok(!runIdSet().has(runId), 'no ghost, no duplicate entries');
  assert.equal(packageRunsIndex.checkPackageRunsIndex({ repoRoot: ROOT }).ok, true);
});

test('LI11: teardown with an already-missing temp directory — rebuild still succeeds', () => {
  const runId = '2099-02-11-teardown-missing';
  // Never created: teardown against a directory that does not exist.
  const teardownErrors = teardownRealRepoTempRun(runId);
  assert.deepEqual(teardownErrors, [], 'missing temp directory must not cascade');
  assert.ok(!runIdSet().has(runId), 'nothing to ghost, nothing ghosted');
  assert.equal(packageRunsIndex.checkPackageRunsIndex({ repoRoot: ROOT }).ok, true);
});
