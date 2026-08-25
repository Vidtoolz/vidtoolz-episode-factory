'use strict';

/*
 * PACKAGE-RUN STATE SPLIT-BRAIN CANARY
 *
 * Companion to package-runs/2026-08-25-package-run-state-projection-proof.
 * Runs fully isolated in a scratch repo root under os.tmpdir(): it never
 * touches the real package-runs/, the real index, or any active-run guidance.
 *
 * POSITIVE canary — one authority, all views advance together:
 *   1. create a bounded run via the real creation script (package-engine-new-run.js)
 *   2. derive canonical 14-gate state (the control-room engine)
 *   3. verify package-run-state.md exists, ACTIVE, digest matches
 *   4. advance canonical evidence (research PASS)
 *   5. refresh the projection; verify ALL derived views advance together:
 *      projection gate/state, durable file digest, tracker stage projection,
 *      and the pipeline-status endpoint's canonical block (clamped strip).
 *
 * NEGATIVE canary — split-brain attempt:
 *   6. forge the tracker strip AND hand-edit the durable projection ahead of
 *      canonical state (run claims "published" while evidence is at research)
 *   7. the shared drift detector reports RUN_STATE_PROJECTION_DRIFT with
 *      direction PROJECTION_AHEAD_OF_CANONICAL, severity BLOCKER
 *   8. canonical 14-gate state is byte-for-byte unchanged by the forgery
 *   9. rebuild restores the projection; drift clears; markers survive.
 *
 * Usage: node scripts/package-run-state-splitbrain-canary.js --emit <dir>
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const workflowMap = require('./package-run-workflow-map.js');
const stageProjection = require('./workflow-stage-projection.js');
const ops = require('./package-run-state-operations.js');
const projection = require('./package-run-state-projection.js');
const packageRunsIndex = require('./package-runs-index.js');
const workflowPathModel = require('../workflow-path.js');

const sha256 = (v) => crypto.createHash('sha256').update(Buffer.isBuffer(v) ? v : String(v)).digest('hex');

function scratchRepoRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prss-canary-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  return root;
}

// Bounded run creation: same file sequence package-engine-new-run.js writes,
// performed inside the scratch root (the real script hard-roots to this repo,
// so the canary replays its exact creation contract in isolation).
function createBoundedRun(root, runId) {
  const runDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'generation-prompt.md'), '# Generation prompt (canary)\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'package-candidates.json'), JSON.stringify({ topic: 'canary', candidates: [] }, null, 2), 'utf8');
  // Creation-time projection, exactly as scripts/package-engine-new-run.js does.
  const created = ops.writeRunState({ repoRoot: root, runId, actor: 'production_operations', workflowPath: 'horizontal' });
  return { runDir, created };
}

function canonicalState(root, runId) {
  const map = workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: root });
  const gate = stageProjection.currentCanonicalGate(map.gates || []);
  return {
    map,
    gate: gate ? gate.id : null,
    digest: projection.canonicalDigest(map),
    trackerStage: gate ? stageProjection.projectGate(gate.id, 'horizontal').stageIndex : null,
  };
}

function simulatePipelineStatus(root, runId) {
  // Mirrors handlePipelineStatus authority logic (package-engine-server.js):
  // raw tracker strip from file evidence, then clamped under the canonical
  // gate ceiling by the shared projection module.
  const runDir = path.join(root, 'package-runs', runId);
  const anyDetectedFile = packageRunsIndex.DETECTED_FILES.some((filename) => fs.existsSync(path.join(runDir, filename)));
  const evidenceStages = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((id) => ({ id, completed: anyDetectedFile }));
  const evidenceCurrentStage = 12; // the tracker, unsupervised, always claims "published"
  const map = workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: root });
  const gate = stageProjection.currentCanonicalGate(map.gates || []);
  const runWorkflowPath = workflowPathModel.readWorkflowPathFromState(
    fs.existsSync(path.join(root, 'package-runs', runId, 'package-run-state.md'))
      ? fs.readFileSync(path.join(root, 'package-runs', runId, 'package-run-state.md'), 'utf8')
      : '');
  const proj = stageProjection.projectGate(gate ? gate.id : null, runWorkflowPath);
  const clamped = stageProjection.clampToCanonical(evidenceStages, evidenceCurrentStage, proj);
  const drift = stageProjection.detectDrift({ runId, gateId: gate ? gate.id : null, workflowPath: runWorkflowPath, evidenceCurrentStage });
  return { canonicalGate: gate ? gate.id : null, projectedCurrentStage: clamped.currentStage, clamped: clamped.clamped, drift };
}

function run() {
  const proof = { schema_version: 1, proof: 'PACKAGE_RUN_STATE_SPLIT_BRAIN_CANARY' };
  const failures = [];
  const root = scratchRepoRoot();
  const runId = '2026-08-25-splitbrain-canary';
  const runDir = path.join(root, 'package-runs', runId);
  try {
    // ── POSITIVE: create → derive → advance → all views advance together ──
    const { created } = createBoundedRun(root, runId);
    const stateA = canonicalState(root, runId);
    const fileA = fs.readFileSync(path.join(runDir, 'package-run-state.md'), 'utf8');
    const endpointA = simulatePipelineStatus(root, runId);

    // Advance canonical evidence.
    fs.writeFileSync(path.join(runDir, 'research-pack.md'), '# Research Pack\n\n- Status: PASS\n', 'utf8');
    const refreshed = ops.writeRunState({ repoRoot: root, runId, actor: 'production_operations' });
    const stateB = canonicalState(root, runId);
    const fileB = fs.readFileSync(path.join(runDir, 'package-run-state.md'), 'utf8');
    const endpointB = simulatePipelineStatus(root, runId);

    proof.positive = {
      create: { action: created.action, gate: created.current_gate, state: created.state, is_package_run: created.run_id === runId },
      derived_before: { gate: stateA.gate, digest: stateA.digest.slice(0, 16), tracker_stage: stateA.trackerStage, endpoint_stage: endpointA.projectedCurrentStage, endpoint_clamped: endpointA.clamped },
      advance_evidence: 'research-pack.md - Status: PASS',
      derived_after: { gate: stateB.gate, digest: stateB.digest.slice(0, 16), tracker_stage: stateB.trackerStage, endpoint_stage: endpointB.projectedCurrentStage, endpoint_clamped: endpointB.clamped },
      refreshed: { action: refreshed.action, gate: refreshed.current_gate, state: refreshed.state },
      all_views_advanced_together:
        refreshed.current_gate === stateB.gate &&
        projection.digestFromText(fileB) === stateB.digest &&
        endpointB.canonicalGate === stateB.gate &&
        endpointB.projectedCurrentStage === stateB.trackerStage,
      canonical_digest_changed: stateA.digest !== stateB.digest,
      durable_file_digest_matches_canonical: projection.digestFromText(fileB) === stateB.digest,
    };
    if (!proof.positive.all_views_advanced_together) failures.push('derived views did not advance together after canonical evidence advanced');
    if (!proof.positive.canonical_digest_changed) failures.push('canonical digest did not change when evidence advanced');
    if (projection.digestFromText(fileA) !== stateA.digest) failures.push('initial durable digest did not match canonical state');

    // ── NEGATIVE: forge tracker + projection ahead of canonical state ─────
    const canonicalBeforeForgery = fs.readFileSync(path.join(runDir, 'research-pack.md'), 'utf8');
    const canonicalMapBefore = sha256(JSON.stringify(workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: root }).gates));

    // Forgery 1: hand-edit the durable projection to claim COMPLETE.
    fs.writeFileSync(path.join(runDir, 'package-run-state.md'),
      '# Package Run State\n\n- Package run state: active\n- Workflow path: horizontal\n\n## Projection status: COMPLETE\n\nGates complete: 14/14\n', 'utf8');
    // Forgery 2: tracker snapshot claiming published (stage 12) while the
    // canonical gate sits at script-structure.
    const forgedTracker = { currentStage: 12 };
    const projAfterForgery = projection.buildProjection({ repoRoot: root, runId, existingText: fs.readFileSync(path.join(runDir, 'package-run-state.md'), 'utf8') });
    const splitBrainReport = ops.checkRunState({ repoRoot: root, runId, trackerSnapshot: forgedTracker });
    const driftVerdict = projection.trackerDivergence(projAfterForgery, forgedTracker);

    proof.negative = {
      forged_projection_claim: 'COMPLETE (14/14 gates)',
      forged_tracker_stage: forgedTracker.currentStage,
      canonical_state_after_forgery: { gate: projAfterForgery.current_gate, state: projAfterForgery.state },
      canonical_state_not_fooled: projAfterForgery.state !== 'COMPLETE' && projAfterForgery.gates_complete < 14,
      split_brain_report: { ok: splitBrainReport.ok, defects: splitBrainReport.defects.map((d) => d.code) },
      shared_drift_detector: { code: driftVerdict.code, severity: driftVerdict.severity, direction: driftVerdict.direction },
      canonical_evidence_unchanged: sha256(fs.readFileSync(path.join(runDir, 'research-pack.md'), 'utf8')) === sha256(canonicalBeforeForgery),
      canonical_map_unchanged: sha256(JSON.stringify(workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: root }).gates)) === canonicalMapBefore,
    };
    if (proof.negative.canonical_state_not_fooled !== true) failures.push('forged projection changed canonical state');
    if (!proof.negative.split_brain_report.defects.includes('RUN_STATE_PROJECTION_DRIFT')) failures.push('split-brain report missed projection drift');
    if (driftVerdict.code !== 'RUN_STATE_PROJECTION_DRIFT' || driftVerdict.direction !== 'PROJECTION_AHEAD_OF_CANONICAL' || driftVerdict.severity !== 'BLOCKER') {
      failures.push('shared drift detector did not report PROJECTION_AHEAD_OF_CANONICAL/BLOCKER');
    }
    if (!proof.negative.canonical_evidence_unchanged || !proof.negative.canonical_map_unchanged) failures.push('forgery mutated canonical evidence or gate map');

    // ── RECOVERY: rebuild restores the projection from canonical truth ────
    const rebuilt = ops.rebuildRunState({ repoRoot: root, runId, actor: 'production_operations' });
    const healed = ops.checkRunState({ repoRoot: root, runId });
    const healedText = fs.readFileSync(path.join(runDir, 'package-run-state.md'), 'utf8');
    proof.recovery = {
      rebuilt: { action: rebuilt.action, gate: rebuilt.current_gate, state: rebuilt.state },
      drift_cleared: healed.ok,
      remaining_defects: healed.defects.map((d) => d.code),
      digest_matches_canonical: projection.digestFromText(healedText) === canonicalState(root, runId).digest,
      forged_claim_gone: !/Projection status: COMPLETE/.test(healedText),
      markers_preserved: /Package run state: active/.test(healedText) && /Workflow path: horizontal/.test(healedText),
    };
    if (!proof.recovery.drift_cleared) failures.push('rebuild did not clear drift');
    if (!proof.recovery.digest_matches_canonical) failures.push('rebuilt projection digest does not match canonical state');
    if (!proof.recovery.forged_claim_gone) failures.push('forged COMPLETE claim survived rebuild');
    if (!proof.recovery.markers_preserved) failures.push('human marker lines lost during rebuild');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  proof.authority_chain = [
    'package evidence / status markers',
    'scripts/package-run-workflow-map.js — canonical 14 gates',
    'scripts/workflow-stage-projection.js — shared projection + drift authority',
    'consumers: pipeline-status/tracker, package-run-state.md, control room',
  ];
  proof.failures = failures;
  proof.verdict = failures.length === 0 ? 'SPLIT_BRAIN_CANARY_PROVEN' : `SPLIT_BRAIN_CANARY_FAIL — ${failures.join('; ')}`;
  return proof;
}

if (require.main === module) {
  const emitIndex = process.argv.indexOf('--emit');
  if (emitIndex < 0) { console.error('usage: package-run-state-splitbrain-canary.js --emit <dir>'); process.exit(2); }
  const emitDir = path.resolve(process.argv[emitIndex + 1]);
  fs.mkdirSync(emitDir, { recursive: true });
  const proof = run();
  proof.generated_at = new Date().toISOString();
  proof.module_sha256 = {
    projection: sha256(fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-state-projection.js'))),
    operations: sha256(fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-state-operations.js'))),
    shared: sha256(fs.readFileSync(path.join(ROOT, 'scripts', 'workflow-stage-projection.js'))),
  };
  fs.writeFileSync(path.join(emitDir, 'splitbrain-canary-summary.json'), `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ verdict: proof.verdict, failures: proof.failures }, null, 2)}\n`);
  process.exitCode = proof.failures.length === 0 ? 0 : 1;
}

module.exports = { run };
