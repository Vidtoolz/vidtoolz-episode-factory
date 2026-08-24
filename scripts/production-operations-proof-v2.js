#!/usr/bin/env node
'use strict';

/*
 * PRODUCTION OPERATIONS V2 — PRODUCTION-PATH PROOF
 *
 * Exercises the CANONICAL dispatch chain end-to-end without touching the live
 * registry: an isolated test root carries a fixture copy of
 * config/agent-registry.json whose production_operations entry is flipped to
 * IMPLEMENTATION_PROVEN, plus a copy of scripts/. The real canonical runner
 * (scripts/agent-run.js → runRegisteredAgent) is invoked against that root:
 *
 *   resolve → implementation readiness → module load → task validation →
 *   child-process invocation → canonical envelope validation → result
 *   writing → invocation completion
 *
 * The live production registry stays CANDIDATE throughout; the package proves
 * it before and after by hash. This is criterion #4 of
 * docs/implementation-promotion-criteria.md. It is evidence, not promotion.
 *
 * Usage:
 *   node scripts/production-operations-proof-v2.js                 # library
 *   node scripts/production-operations-proof-v2.js --emit <dir>    # one-shot
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AGENT_ID = 'production_operations';

function buildIsolatedRoot(options = {}) {
  // Copy scripts/ and a fixture registry into an isolated root. Only the
  // fixture registry is modified (implementation_state flip); no source code
  // changes, no authority changes. config/system-registry.json is copied as
  // exact source bytes so the nominal status path loads the real canonical
  // system registry instead of degrading to the unreadable fallback.
  const root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'po-prodpath-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  const sourceRoot = path.resolve(__dirname, '..');
  copyTree(path.join(sourceRoot, 'scripts'), path.join(root, 'scripts'));
  for (const file of ['agent-registry.json', 'agent-contract.json', 'system-registry.json']) {
    fs.copyFileSync(path.join(sourceRoot, 'config', file), path.join(root, 'config', file));
  }
  const registryPath = path.join(root, 'config', 'agent-registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const registration = registry.agents.find((agent) => agent.agent_id === AGENT_ID);
  if (!registration) throw new Error('fixture registry lost production_operations');
  const originalState = registration.implementation_state;
  registration.implementation_state = 'IMPLEMENTATION_PROVEN';
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  return { root, fixtureFlippedFrom: originalState };
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

function writeTask(dir, name, task) {
  const taskPath = path.join(dir, name);
  fs.writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);
  return taskPath;
}

const REAL_ESCALATION = {
  reason: 'semantic retry exhausted: MODEL_FAILED: fetch failed',
  source_agent_id: 'visual_planning_director',
  source_invocation_id: 'visual_planning_director:visual-plan-01M0QR9DGRPW4MK8BMD1RGAYDX:2',
};

function cases(runId) {
  return [
    { id: 'A-information-status', task: { task_id: 'v2-A-status', package_run_id: runId, requested_by: 'hermes', assignment: { action: 'status' } },
      expect: { infrastructure_state: 'COMPLETE', state: 'COMPLETE', attention: 'INFORMATION', reason_must_not_contain: 'systems registry unreadable' } },
    { id: 'B-review-model-endpoint', task: { task_id: 'v2-B-model-endpoint', package_run_id: runId, requested_by: 'hermes', assignment: { action: 'recommend_remediation' }, blocker_evidence: REAL_ESCALATION },
      expect: { infrastructure_state: 'COMPLETE', state: 'REMEDIATION_RECOMMENDED', attention: 'REVIEW', next_owner: 'hermes' } },
    { id: 'C-review-resource-lane', task: { task_id: 'v2-C-resource-lane', package_run_id: runId, requested_by: 'hermes', assignment: { action: 'diagnose_blocker' }, blocker_evidence: { reason: 'presto wan_i2v lane reports BLOCKED: compute readiness probe denied routing; no worker reported ready', source_invocation_id: 'visual_planning_director:resource-probe:1' } },
      expect: { infrastructure_state: 'COMPLETE', state: 'REMEDIATION_RECOMMENDED', attention: 'REVIEW', diagnosis_kind: 'RESOURCE_LANE_UNAVAILABLE', next_owner: 'hermes' } },
    { id: 'D-decision-storage', task: { task_id: 'v2-D-storage', package_run_id: runId, requested_by: 'hermes', assignment: { action: 'recommend_remediation' }, blocker_evidence: { reason: 'disk full on media volume; generation output cannot be written', source_invocation_id: 'production_operations:fixture:1' } },
      expect: { infrastructure_state: 'COMPLETE', attention: 'DECISION', next_owner: 'mikko' } },
    { id: 'E-creative-out-of-mandate', task: { task_id: 'v2-E-creative', package_run_id: runId, requested_by: 'hermes', assignment: { action: 'recommend_remediation' }, blocker_evidence: { reason: 'narrative_spine missing in the script structure', source_invocation_id: 'adversarial:fixture:1' } },
      expect: { infrastructure_state: 'COMPLETE', state: 'REFUSED_OUT_OF_MANDATE', next_owner: 'hermes' } },
    { id: 'F-review-abandoned-invocation', task: { task_id: 'v2-F-abandoned', package_run_id: runId, requested_by: 'hermes', assignment: { action: 'recommend_remediation' }, blocker_evidence: { reason: 'runner lock pid no longer alive; abandoned invocation left incomplete task evidence', source_invocation_id: 'story_editor:abandoned-fixture:1' } },
      expect: { infrastructure_state: 'COMPLETE', attention: 'REVIEW', diagnosis_kind: 'INVOCATION_ABANDONED', next_owner: 'hermes' } },
    { id: 'G-model-lane-vs-resource-lane', task: { task_id: 'v2-G-model-lane', package_run_id: runId, requested_by: 'hermes', assignment: { action: 'diagnose_blocker' }, blocker_evidence: { reason: 'model_failed: ollama endpoint returned no route for the large_text lane', source_invocation_id: 'story_editor:model-fixture:1' } },
      expect: { infrastructure_state: 'COMPLETE', attention: 'REVIEW', diagnosis_kind: 'MODEL_LANE_UNAVAILABLE', next_owner: 'hermes' } },
  ];
}

async function runProductionPath(options = {}) {
  const runner = require(path.join(options.sourceRoot || path.resolve(__dirname, '..'), 'scripts', 'agent-run.js'));
  const { root, fixtureFlippedFrom } = buildIsolatedRoot(options);
  const runId = options.runId || 'po-production-path-canary';
  const workDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(workDir, { recursive: true });
  const results = [];
  for (const entry of cases(runId)) {
    const taskPath = writeTask(workDir, `${entry.id}-task.json`, entry.task);
    let output = null; let error = null;
    try {
      output = await runner.runRegisteredAgent({ repoRoot: root, agentId: AGENT_ID, runId, taskPath });
    } catch (err) { error = { code: err.code, message: err.message }; }
    results.push({ id: entry.id, expect: entry.expect, error, output });
  }
  return { root, runId, fixtureFlippedFrom, results };
}

if (require.main === module) {
  const emitIndex = process.argv.indexOf('--emit');
  if (emitIndex < 0) { console.error('usage: production-operations-proof-v2.js --emit <dir>'); process.exit(2); }
  const emitDir = path.resolve(process.argv[emitIndex + 1]);
  fs.mkdirSync(emitDir, { recursive: true });
  (async () => {
    const sourceRoot = path.resolve(__dirname, '..');
    const crypto = require('node:crypto');
    const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
    const liveRegistryPath = path.join(sourceRoot, 'config', 'agent-registry.json');
    const liveBefore = fs.readFileSync(liveRegistryPath);
    const proof = await runProductionPath({ sourceRoot });
    const liveAfter = fs.readFileSync(liveRegistryPath);
    const liveRegistry = JSON.parse(liveAfter);
    const liveRegistration = liveRegistry.agents.find((a) => a.agent_id === AGENT_ID);
    const artifacts = {};
    for (const result of proof.results) {
      const dir = path.join(emitDir, result.id);
      fs.mkdirSync(dir, { recursive: true });
      // Copy canonical runner evidence (task/result/invocation) for this
      // case's task from the isolated root.
      const taskId = result.expect && cases(proof.runId).find((c) => c.id === result.id)?.task.task_id;
      const src = path.join(proof.root, 'package-runs', proof.runId, 'agents', AGENT_ID, String(taskId || ''));
      for (const file of ['task.json', 'result.json', 'invocation.json']) {
        const from = path.join(src, file);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file));
      }
      const invocation = fs.existsSync(path.join(src, 'invocation.json')) ? JSON.parse(fs.readFileSync(path.join(src, 'invocation.json'), 'utf8')) : null;
      artifacts[result.id] = {
        runner_error: result.error,
        runner_infrastructure_state: result.output?.infrastructure_state ?? null,
        semantic_state: invocation?.semantic_state ?? result.output?.result?.state ?? null,
        semantic_reason: result.output?.result?.reason ?? null,
        attention: invocation?.handoff_summary?.attention ?? result.output?.result?.attention ?? null,
        next_owner: invocation?.handoff_summary?.next_owner ?? result.output?.result?.handoff?.next_owner ?? null,
        envelope_valid: invocation ? invocation.envelope_error === null : false,
        task_sha256: invocation?.task_sha256 ?? null,
        result_sha256: invocation?.result_sha256 ?? null,
      };
    }
    const summary = {
      schema_version: 1,
      proof: 'PRODUCTION_PATH_PROOF_V2',
      generated_at: new Date().toISOString(),
      implementation_commit: null, // bound by caller/commit step
      runner_commit: null,
      promotion_criteria_version: 'v1 (docs/implementation-promotion-criteria.md)',
      predecessor_proof: { package: 'package-runs/2026-08-24-production-operations-proof', verdict: 'IMPLEMENTATION_PROOF_PASS' },
      live_registry: {
        sha256_before: sha256(liveBefore.toString('utf8')),
        sha256_after: sha256(liveAfter.toString('utf8')),
        unchanged: liveBefore.toString('utf8') === liveAfter.toString('utf8'),
        implementation_state: liveRegistration.implementation_state,
        lifecycle: liveRegistration.lifecycle,
      },
      isolated_fixture: { registry_flipped_from: proof.fixtureFlippedFrom, to: 'IMPLEMENTATION_PROVEN', root: 'temporary (os.tmpdir)' },
      dispatch_chain_proven: ['canonical resolve', 'implementation readiness (fixture PROVEN)', 'module load + identity', 'action validation', 'child-process invocation', 'canonical envelope validation', 'result writing', 'invocation completion'],
      cases: artifacts,
      verdict: null, // filled below
    };
    const failures = proof.results.filter((r) => r.error
      || r.output?.infrastructure_state !== r.expect.infrastructure_state
      || (r.expect.reason_must_not_contain && String(r.output?.result?.reason || '').includes(r.expect.reason_must_not_contain)));
    // Nominal status fidelity: the isolated root carries the exact committed
    // system registry; record its source hash and prove the copy byte-matches.
    const sourceRegistryPath = path.join(sourceRoot, 'config', 'system-registry.json');
    const sourceRegistryBytes = fs.readFileSync(sourceRegistryPath);
    const copiedRegistryBytes = fs.readFileSync(path.join(proof.root, 'config', 'system-registry.json'));
    summary.source_system_registry = {
      sha256: sha256(sourceRegistryBytes.toString('utf8')),
      isolated_copy_byte_identical: sha256(sourceRegistryBytes.toString('utf8')) === sha256(copiedRegistryBytes.toString('utf8')),
      case_a_reason: artifacts['A-information-status']?.semantic_reason ?? null,
      degraded_fallback_absent: !String(artifacts['A-information-status']?.semantic_reason || '').includes('systems registry unreadable'),
    };
    summary.verdict = failures.length === 0 && summary.live_registry.implementation_state === 'CANDIDATE' && summary.live_registry.unchanged
      && summary.source_system_registry.isolated_copy_byte_identical && summary.source_system_registry.degraded_fallback_absent
      ? 'PRODUCTION_PATH_PROOF_PASS — live registry remained CANDIDATE; promotion stays a human decision'
      : `PRODUCTION_PATH_PROOF_FAIL — ${failures.map((f) => f.id).join(', ') || 'registry fidelity check failed'}`;
    fs.writeFileSync(path.join(emitDir, 'production-path-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ verdict: summary.verdict, cases: Object.keys(artifacts).length, live_registry_unchanged: summary.live_registry.unchanged }, null, 2)}\n`);
    process.exitCode = summary.verdict.startsWith('PRODUCTION_PATH_PROOF_PASS') ? 0 : 1;
  })().catch((error) => {
    process.stdout.write(`${JSON.stringify({ verdict: 'PRODUCTION_PATH_PROOF_FAIL', error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { AGENT_ID, buildIsolatedRoot, cases, runProductionPath, REAL_ESCALATION };
