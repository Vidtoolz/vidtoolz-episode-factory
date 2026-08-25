#!/usr/bin/env node
'use strict';

/*
 * GENERATION SUPERVISOR V2 — PRODUCTION-PATH PROOF
 *
 * Unlike Production Operations and QC Director, this agent was ALREADY marked
 * IMPLEMENTATION_PROVEN in the live registry while the canonical runner could
 * not dispatch it at all. So this proof carries an extra obligation: it must
 * reproduce the BEFORE state as durable evidence, not just demonstrate AFTER.
 *
 *   BEFORE  registry claimed IMPLEMENTATION_PROVEN, canonical runner refused
 *           with RUNNER_AGENT_ID_MISMATCH because the module exported nothing.
 *   AFTER   registry claims IMPLEMENTATION_PROVEN and the canonical runner
 *           loads it, verifies declared identity, dispatches, and persists.
 *
 * The BEFORE case is reproduced faithfully by running the REAL runner against
 * a module copy with its `module.exports` block removed - the exact historical
 * shape - inside an isolated root. The live registry and the live module are
 * never modified.
 *
 * Usage:
 *   node scripts/generation-supervisor-proof-v2.js                 # library
 *   node scripts/generation-supervisor-proof-v2.js --emit <dir>    # one-shot
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const AGENT_ID = 'generation_supervisor';

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

// The isolated root carries the real scripts/ and the real config/, plus the
// root-level modules generation-supervisor.js requires (media-routing.js).
function buildIsolatedRoot(options = {}) {
  const root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'gs-prodpath-'));
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  copyTree(path.join(sourceRoot, 'scripts'), path.join(root, 'scripts'));
  for (const file of fs.readdirSync(sourceRoot)) {
    if (file.endsWith('.js') && fs.statSync(path.join(sourceRoot, file)).isFile()) {
      fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file));
    }
  }
  for (const file of fs.readdirSync(path.join(sourceRoot, 'config'))) {
    const from = path.join(sourceRoot, 'config', file);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(root, 'config', file));
  }
  return { root, sourceRoot };
}

// Reproduce the historical module shape: identical implementation, no exports.
function regressModuleIdentity(root) {
  const modulePath = path.join(root, 'scripts', 'generation-supervisor.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  const stripped = source.replace(
    /module\.exports = \{[\s\S]*?\};\n/,
    '// (historical shape: module declared no identity to the runner)\n'
  );
  if (stripped === source) throw new Error('could not reproduce the pre-repair module shape');
  fs.writeFileSync(modulePath, stripped);
  return { modulePath, repaired_sha256: sha256(source), regressed_sha256: sha256(stripped) };
}

function writeTask(dir, name, task) {
  const taskPath = path.join(dir, name);
  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);
  return taskPath;
}

function cases(runId) {
  return [
    {
      id: 'A-status-availability',
      task: {
        task_id: 'gs-v2-A-status', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'status' },
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'COMPLETE', attention: 'INFORMATION', next_owner: 'hermes', exit_code: 0 },
    },
    {
      id: 'B-supervise-bounded-brief',
      // Bounded positive canary: real routing policy, real endpoint probe, real
      // provenance. It resolves a lane and fails closed at the dispatch bridge
      // rather than starting any render workload.
      task: {
        task_id: 'gs-v2-B-supervise', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'supervise_generation' },
        project_id: 'gs-proof', artifact_class: 'image',
        brief: { purpose: 'bounded production-path canary', input_artifacts: [] },
        routing: { lane: 'text_to_image_generation' }, max_attempts: 2,
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE', attention: 'INFORMATION', next_owner: 'production_operations', exit_code: 1 },
    },
    {
      id: 'C-negative-ineligible-lane',
      task: {
        task_id: 'gs-v2-C-bad-lane', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'supervise_generation' },
        project_id: 'gs-proof', artifact_class: 'image',
        brief: { purpose: 'negative canary', input_artifacts: [] },
        routing: { lane: 'nonexistent_lane' }, max_attempts: 2,
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'NO_ELIGIBLE_ROUTE', attention: 'INFORMATION', next_owner: 'production_operations', exit_code: 1 },
    },
    {
      id: 'D-negative-policy-violation',
      task: {
        task_id: 'gs-v2-D-engine-policy', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'supervise_generation' },
        project_id: 'gs-proof', artifact_class: 'image',
        brief: { purpose: 'policy fail-closed canary', input_artifacts: [] },
        routing: { lane: 'text_to_image_generation', allowed_engines: ['unapproved-engine'] },
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'NO_ELIGIBLE_ROUTE', attention: 'INFORMATION', next_owner: 'production_operations', exit_code: 1 },
    },
    {
      id: 'E-negative-missing-inputs',
      task: {
        task_id: 'gs-v2-E-missing-input', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'supervise_generation' },
        project_id: 'gs-proof', artifact_class: 'image',
        brief: { purpose: 'missing input canary', input_artifacts: ['/tmp/gs-proof-definitely-absent.png'] },
        routing: { lane: 'text_to_image_generation' },
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'INPUT_MISSING', attention: 'INFORMATION', next_owner: 'production_operations', exit_code: 1 },
    },
    {
      id: 'F-negative-unsupported-action',
      // Refused by the runner BEFORE the module is invoked, using the action
      // list the module now declares.
      task: {
        task_id: 'gs-v2-F-bad-action', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'publish_video' },
      },
      expect: { runner_error_code: 'RUNNER_ACTION_UNSUPPORTED' },
    },
  ];
}

async function runProductionPath(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..'));
  const { root } = buildIsolatedRoot({ ...options, sourceRoot });
  const runner = require(path.join(root, 'scripts', 'agent-run.js'));
  const runId = options.runId || 'gs-production-path-canary';
  const workDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(workDir, { recursive: true });

  // ── BEFORE: the historical module shape, through the real runner ─────────
  const regression = regressModuleIdentity(root);
  const beforeTaskPath = writeTask(workDir, 'BEFORE-identity-task.json', {
    task_id: 'gs-v2-BEFORE-identity', package_run_id: runId, requested_by: 'hermes',
    assignment: { action: 'status' },
  });
  let before = null;
  try {
    const output = await runner.runRegisteredAgent({ repoRoot: root, agentId: AGENT_ID, runId, taskPath: beforeTaskPath });
    before = { refused: false, infrastructure_state: output.infrastructure_state };
  } catch (error) {
    before = { refused: true, code: error.code, reason: error.message };
  }
  // Restore the repaired module for the AFTER cases. The runner loads modules
  // with require(), so the regressed copy must also be evicted from the module
  // cache or every AFTER case would keep seeing the BEFORE shape.
  fs.copyFileSync(path.join(sourceRoot, 'scripts', 'generation-supervisor.js'), regression.modulePath);
  try { delete require.cache[require.resolve(fs.realpathSync(regression.modulePath))]; } catch (_) { /* not yet cached */ }

  // ── AFTER: the repaired module, same runner, same root ───────────────────
  const results = [];
  for (const entry of cases(runId)) {
    const taskPath = writeTask(workDir, `${entry.id}-task.json`, entry.task);
    let output = null;
    let error = null;
    try {
      output = await runner.runRegisteredAgent({ repoRoot: root, agentId: AGENT_ID, runId, taskPath });
    } catch (err) { error = { code: err.code, message: err.message }; }
    results.push({ id: entry.id, expect: entry.expect, error, output });
  }
  return { root, runId, before, regression, results };
}

function evaluate(before, results) {
  const failures = [];
  if (!before?.refused || before.code !== 'RUNNER_AGENT_ID_MISMATCH') {
    failures.push(`BEFORE: expected RUNNER_AGENT_ID_MISMATCH, got ${before?.code || before?.infrastructure_state}`);
  }
  for (const result of results) {
    const expect = result.expect;
    if (expect.runner_error_code) {
      if (result.error?.code !== expect.runner_error_code) {
        failures.push(`${result.id}: expected runner refusal ${expect.runner_error_code}, got ${result.error?.code || 'none'}`);
      }
      continue;
    }
    if (result.error) { failures.push(`${result.id}: runner error ${result.error.code}`); continue; }
    if (result.output?.infrastructure_state !== expect.infrastructure_state) {
      failures.push(`${result.id}: infrastructure_state ${result.output?.infrastructure_state}`); continue;
    }
    const semantic = result.output.result;
    if (!semantic) { failures.push(`${result.id}: no semantic result`); continue; }
    if (result.output.invocation?.envelope_error !== null) failures.push(`${result.id}: envelope_error ${result.output.invocation?.envelope_error}`);
    if (semantic.agent_id !== AGENT_ID) failures.push(`${result.id}: agent_id ${semantic.agent_id}`);
    if (expect.state && semantic.state !== expect.state) failures.push(`${result.id}: state ${semantic.state}`);
    if (expect.attention && semantic.attention !== expect.attention) failures.push(`${result.id}: attention ${semantic.attention}`);
    if (expect.next_owner && semantic.handoff?.next_owner !== expect.next_owner) failures.push(`${result.id}: next_owner ${semantic.handoff?.next_owner}`);
    if (expect.exit_code !== undefined && result.output.invocation?.exit_code !== expect.exit_code) {
      failures.push(`${result.id}: exit_code ${result.output.invocation?.exit_code}`);
    }
    if (!semantic.control_room || semantic.control_room.role !== AGENT_ID) failures.push(`${result.id}: control_room projection missing`);
    if (semantic.control_room?.qc_verdict_claimed !== false) failures.push(`${result.id}: claimed a QC verdict`);
    if (semantic.control_room?.human_approval_claimed !== false) failures.push(`${result.id}: claimed human approval`);
  }
  return failures;
}

if (require.main === module) {
  const emitIndex = process.argv.indexOf('--emit');
  if (emitIndex < 0) { console.error('usage: generation-supervisor-proof-v2.js --emit <dir>'); process.exit(2); }
  const emitDir = path.resolve(process.argv[emitIndex + 1]);
  fs.mkdirSync(emitDir, { recursive: true });
  (async () => {
    const sourceRoot = path.resolve(__dirname, '..');
    const liveRegistryPath = path.join(sourceRoot, 'config', 'agent-registry.json');
    const liveModulePath = path.join(sourceRoot, 'scripts', 'generation-supervisor.js');
    const registryBefore = fs.readFileSync(liveRegistryPath).toString('utf8');
    const moduleBefore = fs.readFileSync(liveModulePath).toString('utf8');

    const proof = await runProductionPath({ sourceRoot });

    const registryAfter = fs.readFileSync(liveRegistryPath).toString('utf8');
    const moduleAfter = fs.readFileSync(liveModulePath).toString('utf8');
    const registration = JSON.parse(registryAfter).agents.find((a) => a.agent_id === AGENT_ID);

    const artifacts = {};
    const caseList = cases(proof.runId);
    for (const result of proof.results) {
      const dir = path.join(emitDir, result.id);
      fs.mkdirSync(dir, { recursive: true });
      const taskId = caseList.find((c) => c.id === result.id)?.task.task_id;
      const src = path.join(proof.root, 'package-runs', proof.runId, 'agents', AGENT_ID, String(taskId || ''));
      for (const file of ['task.json', 'result.json', 'invocation.json']) {
        const from = path.join(src, file);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file));
      }
      const invocationPath = path.join(src, 'invocation.json');
      const invocation = fs.existsSync(invocationPath) ? JSON.parse(fs.readFileSync(invocationPath, 'utf8')) : null;
      const semantic = result.output?.result || null;
      artifacts[result.id] = {
        runner_error: result.error,
        runner_infrastructure_state: result.output?.infrastructure_state ?? null,
        semantic_state: invocation?.semantic_state ?? semantic?.state ?? null,
        reason: semantic?.reason ?? null,
        attention: invocation?.handoff_summary?.attention ?? semantic?.attention ?? null,
        next_owner: invocation?.handoff_summary?.next_owner ?? semantic?.handoff?.next_owner ?? null,
        exit_code: invocation?.exit_code ?? null,
        envelope_valid: invocation ? invocation.envelope_error === null : false,
        module_declared_agent_id: semantic?.agent_id ?? null,
        control_room_role: semantic?.control_room?.role ?? null,
        qc_verdict_claimed: semantic?.control_room?.qc_verdict_claimed ?? null,
        human_approval_claimed: semantic?.control_room?.human_approval_claimed ?? null,
        route: semantic?.route ? { lane: semantic.route.lane, machine: semantic.route.machine, engine: semantic.route.engine } : null,
        task_sha256: invocation?.task_sha256 ?? null,
        result_sha256: invocation?.result_sha256 ?? null,
        module_sha256: invocation?.module_sha256 ?? null,
      };
    }

    const failures = evaluate(proof.before, proof.results);
    const summary = {
      schema_version: 1,
      proof: 'GENERATION_SUPERVISOR_PRODUCTION_PATH_PROOF_V2',
      generated_at: new Date().toISOString(),
      promotion_criteria_version: 'v1 (docs/implementation-promotion-criteria.md)',
      defect_under_investigation: {
        claim: 'registry marked IMPLEMENTATION_PROVEN while the canonical runner could not dispatch the module',
        before: proof.before,
        before_module_shape: 'module.exports block removed - the exact historical shape (module.exports never existed in any commit of this file)',
        after: 'canonical runner loads the module, verifies declared identity against the requested registry id, and dispatches',
        module_identity_verified_by_runner: AGENT_ID,
      },
      live_state_untouched: {
        registry_sha256_before: sha256(registryBefore),
        registry_sha256_after: sha256(registryAfter),
        registry_unchanged: registryBefore === registryAfter,
        module_sha256_before: sha256(moduleBefore),
        module_sha256_after: sha256(moduleAfter),
        module_unchanged: moduleBefore === moduleAfter,
        implementation_state: registration.implementation_state,
        lifecycle: registration.lifecycle,
      },
      dispatch_chain_proven: [
        'canonical resolve', 'implementation readiness', 'module load + AGENT_ID identity verification',
        'declared action validation', 'child-process invocation', 'canonical envelope validation',
        'result writing', 'invocation completion',
      ],
      bounded_workload: {
        statement: 'no render workload is started anywhere in this proof; the supervision cases resolve routing policy and fail closed at the dispatch bridge',
        generation_dispatched: false,
      },
      cases: artifacts,
      verdict: null,
    };
    summary.verdict = failures.length === 0 && summary.live_state_untouched.registry_unchanged && summary.live_state_untouched.module_unchanged
      ? 'PRODUCTION_PATH_PROOF_PASS'
      : `PRODUCTION_PATH_PROOF_FAIL — ${failures.join('; ') || 'live state fidelity check failed'}`;

    fs.writeFileSync(path.join(emitDir, 'production-path-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    fs.rmSync(proof.root, { recursive: true, force: true });
    process.stdout.write(`${JSON.stringify({
      verdict: summary.verdict, cases: Object.keys(artifacts).length,
      before: proof.before, live_unchanged: summary.live_state_untouched.registry_unchanged && summary.live_state_untouched.module_unchanged,
    }, null, 2)}\n`);
    process.exitCode = summary.verdict.startsWith('PRODUCTION_PATH_PROOF_PASS') ? 0 : 1;
  })().catch((error) => {
    process.stdout.write(`${JSON.stringify({ verdict: 'PRODUCTION_PATH_PROOF_FAIL', error: error.message, stack: error.stack }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { AGENT_ID, sha256, buildIsolatedRoot, regressModuleIdentity, cases, runProductionPath, evaluate };
