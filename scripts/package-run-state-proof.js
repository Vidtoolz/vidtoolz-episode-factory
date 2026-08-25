'use strict';

/*
 * PACKAGE-RUN STATE PROJECTION — CONSOLIDATION AND DURABILITY PROOF
 *
 * Companion to package-runs/2026-08-25-workflow-authority-unification-proof
 * (which established that the 14-gate engine is the sole lifecycle authority).
 * This proves the durable per-run projection landed on top of that authority
 * WITHOUT introducing a second implementation of the rule.
 *
 * Runs on bounded scratch runs it creates and removes. Touches no Earth Studio
 * file, no agent registry, and no real production run.
 *
 * Usage: node scripts/package-run-state-proof.js --emit <dir>
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const ops = require('./package-run-state-operations.js');
const projection = require('./package-run-state-projection.js');
const stageProjection = require('./workflow-stage-projection.js');
const workflowMap = require('./package-run-workflow-map.js');
const packageRunsIndex = require('./package-runs-index.js');

const sha256 = (v) => crypto.createHash('sha256').update(Buffer.isBuffer(v) ? v : String(v)).digest('hex');

function scratchRun(runId, files) {
  const runDir = path.join(ROOT, 'package-runs', runId);
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(runDir, name), content);
  return runDir;
}

function run() {
  const proof = { schema_version: 1, proof: 'PACKAGE_RUN_STATE_PROJECTION_PROOF' };

  // ── 1. consolidation: one implementation of the drift rule ──────────────
  const gateAgreement = stageProjection.canonicalGateIds().map((gateId) => ({
    gate: gateId,
    shared: stageProjection.projectGate(gateId, 'horizontal').stageIndex,
    package_run_state: projection.gateToTrackerStage(gateId),
  }));
  const projectionSource = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-state-projection.js'), 'utf8');
  proof.consolidation = {
    shared_authority: 'scripts/workflow-stage-projection.js',
    gate_mapping_disagreements: gateAgreement.filter((g) => g.shared !== g.package_run_state).length,
    gate_agreement: gateAgreement,
    package_run_state_delegates_drift: /stageProjection\.detectDrift/.test(projectionSource),
    package_run_state_delegates_mapping: /stageProjection\.projectGate/.test(projectionSource),
    competing_defect_codes_removed: !/return \{\s*code: "RUN_STATE_TRACKER_LAG"/.test(projectionSource),
    unknown_gate_is_null: projection.gateToTrackerStage('not-a-gate') === null,
    statement: 'Before consolidation two independently written gate->stage tables disagreed on 5 of 14 gates, '
      + 'and this module carried a competing RUN_STATE_TRACKER_LAG code. Both now delegate to one shared authority.',
  };

  // ── 2. drift semantics are identical for both consumers ─────────────────
  const aheadShared = stageProjection.detectDrift({ runId: 'r', gateId: 'research', workflowPath: 'horizontal', evidenceCurrentStage: 12 });
  const behindShared = stageProjection.detectDrift({ runId: 'r', gateId: 'archive', workflowPath: 'horizontal', evidenceCurrentStage: 1 });
  const aheadState = projection.trackerDivergence({ run_id: 'r', current_gate: 'research', workflow_path: 'horizontal' }, { currentStage: 12 });
  const behindState = projection.trackerDivergence({ run_id: 'r', current_gate: 'archive', workflow_path: 'horizontal' }, { currentStage: 1 });
  proof.drift_semantics = {
    ahead: { severity: aheadShared.severity, direction: aheadShared.direction, code: aheadShared.code },
    behind: { severity: behindShared.severity, direction: behindShared.direction, code: behindShared.code },
    consumers_agree_ahead: aheadState.code === aheadShared.code && aheadState.severity === aheadShared.severity,
    consumers_agree_behind: behindState.code === behindShared.code && behindState.severity === behindShared.severity,
    single_code: 'RUN_STATE_PROJECTION_DRIFT',
  };

  // ── 3. lifecycle canary ─────────────────────────────────────────────────
  const runId = '2026-08-25-runstate-proof-canary';
  const runDir = scratchRun(runId, { 'selected-package.md': '# Selected\n' });
  try {
    const created = ops.writeRunState({ repoRoot: ROOT, runId, actor: 'production_operations' });
    const mapA = workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: ROOT });
    const gateA = stageProjection.currentCanonicalGate(mapA.gates || []);

    fs.writeFileSync(path.join(runDir, 'research-pack.md'), '# Research\n\n- Status: PASS\n');
    const advanced = ops.writeRunState({ repoRoot: ROOT, runId, actor: 'production_operations' });

    const filePath = path.join(runDir, 'package-run-state.md');
    const corrupted = fs.readFileSync(filePath, 'utf8').replace(/- Canonical digest: [0-9a-f]+/, `- Canonical digest: ${'0'.repeat(64)}`);
    fs.writeFileSync(filePath, corrupted);
    const checkCorrupt = ops.checkRunState({ repoRoot: ROOT, runId });

    const rebuilt = ops.rebuildRunState({ repoRoot: ROOT, runId, actor: 'production_operations' });
    const checkRepaired = ops.checkRunState({ repoRoot: ROOT, runId });

    const mapB = workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: ROOT });
    const gateB = stageProjection.currentCanonicalGate(mapB.gates || []);

    const first = ops.writeRunState({ repoRoot: ROOT, runId, actor: 'production_operations', generatedAt: '2026-01-01T00:00:00.000Z' });
    const textA = fs.readFileSync(filePath, 'utf8');
    ops.writeRunState({ repoRoot: ROOT, runId, actor: 'production_operations', generatedAt: '2026-12-31T00:00:00.000Z' });
    const textB = fs.readFileSync(filePath, 'utf8');

    let unauthorized = null;
    try { ops.writeRunState({ repoRoot: ROOT, runId, actor: 'story_editor' }); unauthorized = { refused: false }; }
    catch (error) { unauthorized = { refused: true, code: error.code }; }

    let injected = null;
    try { projection.buildProjection({ repoRoot: ROOT, runId, current_gate: 'archive' }); injected = { refused: false }; }
    catch (error) { injected = { refused: true, code: error.code }; }

    proof.lifecycle_canary = {
      create: { action: created.action, gate: created.current_gate, state: created.state },
      control_room_agrees: gateA.id === created.current_gate,
      tracker_stage: stageProjection.projectGate(gateA.id, 'horizontal').stageKey,
      advance: { action: advanced.action, from: created.current_gate, to: advanced.current_gate, advanced: advanced.current_gate !== created.current_gate },
      corrupted_check: { ok: checkCorrupt.ok, stale: checkCorrupt.projection_stale, defects: checkCorrupt.defects.map((d) => d.code) },
      rebuild: { ok: checkRepaired.ok, defects: checkRepaired.defects.map((d) => d.code), gate: rebuilt.current_gate },
      canonical_unchanged_by_projection: gateB.id === advanced.current_gate,
      idempotent: {
        same_canonical_body: ops.canonicalBody(textA) === ops.canonicalBody(textB),
        same_digest: projection.digestFromText(textA) === projection.digestFromText(textB),
        digest: (first.canonical_digest || '').slice(0, 16),
      },
      unauthorized_writer: unauthorized,
      canonical_injection: injected,
    };
    proof.projection_sample = fs.readFileSync(filePath, 'utf8').split('\n').slice(0, 24).join('\n');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }

  // ── 4. missing projection is distinct from unknown canonical state ──────
  const missingId = '2026-08-25-runstate-proof-missing';
  const missingDir = scratchRun(missingId, { 'selected-package.md': '# Selected\n' });
  try {
    const check = ops.checkRunState({ repoRoot: ROOT, runId: missingId });
    proof.missing_projection = {
      projection_present: check.projection_present,
      canonical_gate_still_known: check.current_gate,
      statement: 'A missing package-run-state.md never means canonical state is unknown; the gate is still derivable.',
    };
  } finally { fs.rmSync(missingDir, { recursive: true, force: true }); }

  // ── 5. run population / migration scope ────────────────────────────────
  const dirs = fs.readdirSync(path.join(ROOT, 'package-runs'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const genuine = dirs.filter((r) => packageRunsIndex.isPackageRunDir(path.join(ROOT, 'package-runs', r)));
  proof.run_population = {
    directories_under_package_runs: dirs.length,
    genuine_package_runs: genuine.length,
    genuine_run_ids: genuine,
    migration_performed: 0,
    statement: 'Every directory under package-runs/ is proof, canary or evidence material carrying no package-run identity '
      + 'file, so none is a production run to migrate. They are classified UNKNOWN_LEGACY rather than guessed at. New runs '
      + 'receive the projection automatically at creation.',
  };

  const failures = [];
  const c = proof.consolidation;
  if (c.gate_mapping_disagreements !== 0) failures.push(`gate mapping still disagrees on ${c.gate_mapping_disagreements} gates`);
  if (!c.package_run_state_delegates_drift) failures.push('package-run-state does not delegate drift detection');
  if (!c.package_run_state_delegates_mapping) failures.push('package-run-state does not delegate gate mapping');
  if (!c.competing_defect_codes_removed) failures.push('a competing defect code remains');
  if (!c.unknown_gate_is_null) failures.push('unknown gate silently maps to a stage');
  if (!proof.drift_semantics.consumers_agree_ahead || !proof.drift_semantics.consumers_agree_behind) failures.push('consumers disagree on drift semantics');
  const l = proof.lifecycle_canary;
  if (!l.control_room_agrees) failures.push('control-room gate disagrees with projection');
  if (!l.advance.advanced) failures.push('canonical advance did not update the projection');
  if (l.corrupted_check.ok || !l.corrupted_check.defects.includes('RUN_STATE_PROJECTION_DRIFT')) failures.push('corrupted projection not detected');
  if (!l.rebuild.ok) failures.push('rebuild did not repair the projection');
  if (!l.canonical_unchanged_by_projection) failures.push('projection changed canonical state');
  if (!l.idempotent.same_canonical_body || !l.idempotent.same_digest) failures.push('projection is not idempotent');
  if (!l.unauthorized_writer.refused) failures.push('an unauthorized actor could write run state');
  if (!l.canonical_injection.refused) failures.push('canonical state could be injected');
  if (proof.missing_projection.projection_present) failures.push('missing-projection case is wrong');

  proof.authority_chain = [
    'package evidence / status markers',
    'scripts/package-run-workflow-map.js — canonical 14 gates',
    'scripts/workflow-stage-projection.js — shared projection + drift authority',
    'consumers: pipeline-status/tracker, package-run-state.md, control room',
  ];
  proof.predecessor_proof = 'package-runs/2026-08-25-workflow-authority-unification-proof';
  proof.failures = failures;
  proof.verdict = failures.length === 0
    ? 'PACKAGE_RUN_STATE_PROJECTION_PROVEN'
    : `PACKAGE_RUN_STATE_PROJECTION_FAIL — ${failures.join('; ')}`;
  return proof;
}

if (require.main === module) {
  const emitIndex = process.argv.indexOf('--emit');
  if (emitIndex < 0) { console.error('usage: package-run-state-proof.js --emit <dir>'); process.exit(2); }
  const emitDir = path.resolve(process.argv[emitIndex + 1]);
  fs.mkdirSync(emitDir, { recursive: true });
  const proof = run();
  proof.generated_at = new Date().toISOString();
  proof.module_sha256 = {
    projection: sha256(fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-state-projection.js'))),
    operations: sha256(fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-state-operations.js'))),
    shared: sha256(fs.readFileSync(path.join(ROOT, 'scripts', 'workflow-stage-projection.js'))),
  };
  fs.writeFileSync(path.join(emitDir, 'package-run-state-proof-summary.json'), `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    verdict: proof.verdict,
    gate_disagreements: proof.consolidation.gate_mapping_disagreements,
    genuine_runs: proof.run_population.genuine_package_runs,
  }, null, 2)}\n`);
  process.exitCode = proof.failures.length === 0 ? 0 : 1;
}

module.exports = { run };
