#!/usr/bin/env node
'use strict';

/*
 * PRESENTER DIRECTOR V2 — PRODUCTION-PATH PROOF
 *
 * Criterion #4 of docs/implementation-promotion-criteria.md: the canonical
 * dispatch chain executes end to end against an ISOLATED test-root registry
 * whose presenter_director entry carries IMPLEMENTATION_PROVEN. The live
 * production registry is never modified here, even temporarily, and is proven
 * unchanged by hash before and after.
 *
 *   resolve -> implementation readiness -> module load + identity ->
 *   action validation -> invocation -> canonical envelope validation ->
 *   result writing -> invocation completion
 *
 * Scope boundary, stated rather than implied: presenter_director's
 * prepare_delivery and evaluate_takes paths call a model, and a model adapter
 * cannot cross the runner's process boundary. This proof therefore drives the
 * model-FREE production paths — `status`, and the preflight refusals that are
 * decided before any routing or model use — which is exactly the dispatch chain
 * criterion #4 names. The model-bearing paths are covered in-process, with an
 * injected adapter, by tests/presenter-director.test.js (91 cases). Neither
 * suite substitutes for the other and this file does not pretend otherwise.
 *
 * This is evidence, not promotion. The registry flip is Mikko's decision alone.
 *
 * Usage:
 *   node scripts/presenter-director-proof-v2.js                 # library
 *   node scripts/presenter-director-proof-v2.js --emit <dir>    # one-shot
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const AGENT_ID = 'presenter_director';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

/*
 * An isolated root carrying a copy of scripts/ and a fixture registry. Only the
 * fixture registry is edited, and only its implementation_state — no source
 * change, no authority change, no lifecycle change.
 */
function buildIsolatedRoot(options = {}) {
  const root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'pd-prodpath-'));
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  copyTree(path.join(sourceRoot, 'scripts'), path.join(root, 'scripts'));
  for (const file of ['agent-registry.json', 'agent-contract.json', 'system-registry.json', 'media-routing.json']) {
    const from = path.join(sourceRoot, 'config', file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(root, 'config', file));
  }
  const registryPath = path.join(root, 'config', 'agent-registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const registration = registry.agents.find((agent) => agent.agent_id === AGENT_ID);
  if (!registration) throw new Error('fixture registry lost presenter_director');
  const before = {
    implementation_state: registration.implementation_state ?? null,
    proven: registration.lifecycle?.proven ?? null,
    autonomous_dispatch: registration.lifecycle?.autonomous_dispatch ?? null,
  };
  if (options.flip !== false) {
    registration.implementation_state = 'IMPLEMENTATION_PROVEN';
    registration.lifecycle.proven = 'PROVEN';
    registration.lifecycle.autonomous_dispatch = 'ENABLED';
    delete registration.lifecycle.dispatch_blocked_reason;
    fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  }
  return { root, fixtureFlippedFrom: before };
}

const STORY_APPROVED = Object.freeze({
  project_id: 'pd-proof-project',
  version_id: 'pd-proof-v1',
  content_hash: 'a'.repeat(64),
  approval_state: 'approved',
  central_claim: 'One claim, delivered once.',
  narrative_spine: ['hook', 'claim', 'proof', 'close'],
});

/*
 * Model-free production cases. Each exercises the full dispatch chain and
 * asserts a canonical envelope, not a hand-built object.
 */
function cases(runId) {
  const base = {
    task_id: 'pd-proof-task',
    package_run_id: runId,
    project_id: 'pd-proof-project',
    privacy: { local_only: true },
  };
  return [
    {
      id: 'status-dispatch',
      // The plainest proof that dispatch reaches THIS agent and nothing else.
      task: { ...base, task_id: 'pd-status', action: 'status', story: STORY_APPROVED },
      expect: { agent_id: AGENT_ID, infrastructure_state: 'COMPLETE' },
    },
    {
      id: 'unapproved-story-refused',
      // Refused before routing or any model use: an unapproved script is not
      // something a presenter should be asked to perform.
      task: {
        ...base,
        task_id: 'pd-draft-story',
        action: 'prepare_delivery',
        story: { ...STORY_APPROVED, approval_state: 'draft' },
      },
      expect: { agent_id: AGENT_ID, blocked: true },
    },
    {
      id: 'unsupported-action-refused',
      task: { ...base, task_id: 'pd-bad-action', action: 'select_best_take', story: STORY_APPROVED },
      // Selection is not in the action surface at all, so the runner refuses it
      // before the module is even asked.
      expect: { runner_error: 'RUNNER_ACTION_UNSUPPORTED' },
    },
  ];
}

async function runProductionPath(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..'));
  const liveRegistryPath = path.join(sourceRoot, 'config', 'agent-registry.json');
  const liveBefore = sha256(fs.readFileSync(liveRegistryPath));

  const runner = require(path.join(sourceRoot, 'scripts', 'agent-run.js'));
  const { root, fixtureFlippedFrom } = buildIsolatedRoot({ ...options, sourceRoot });
  const runId = options.runId || 'pd-production-path-canary';
  fs.mkdirSync(path.join(root, 'package-runs', runId), { recursive: true });

  const results = [];
  for (const entry of cases(runId)) {
    const taskPath = path.join(root, 'package-runs', runId, `${entry.id}-task.json`);
    fs.writeFileSync(taskPath, `${JSON.stringify(entry.task, null, 2)}\n`);
    let output = null;
    let error = null;
    try {
      output = await runner.runRegisteredAgent({ repoRoot: root, agentId: AGENT_ID, runId, taskPath });
    } catch (err) { error = { code: err.code, message: err.message }; }
    results.push({ id: entry.id, expect: entry.expect, error, output });
  }

  /*
   * Criterion #3: while implementation_state is CANDIDATE (or absent, as it is
   * today) the same production path must refuse. Proven on a second isolated
   * root that is NOT flipped, so the refusal is observed rather than assumed.
   */
  const unflipped = buildIsolatedRoot({ sourceRoot, flip: false });
  fs.mkdirSync(path.join(unflipped.root, 'package-runs', runId), { recursive: true });
  const refusalTaskPath = path.join(unflipped.root, 'package-runs', runId, 'refusal-task.json');
  fs.writeFileSync(refusalTaskPath, `${JSON.stringify({
    task_id: 'pd-refusal', package_run_id: runId, project_id: 'pd-proof-project',
    action: 'status', privacy: { local_only: true }, story: STORY_APPROVED,
  }, null, 2)}\n`);
  let refusal = null;
  let refusalError = null;
  try {
    refusal = await runner.runRegisteredAgent({
      repoRoot: unflipped.root, agentId: AGENT_ID, runId, taskPath: refusalTaskPath,
    });
  } catch (err) { refusalError = { code: err.code, message: err.message }; }

  const liveAfter = sha256(fs.readFileSync(liveRegistryPath));
  return {
    root,
    runId,
    fixtureFlippedFrom,
    results,
    unflipped_refusal: { output: refusal, error: refusalError },
    live_registry: { before: liveBefore, after: liveAfter, unchanged: liveBefore === liveAfter },
  };
}

function evaluate(proof) {
  const failures = [];

  // The live registry must be untouched by the proof itself.
  if (!proof.live_registry.unchanged) failures.push('live registry changed during the proof');

  for (const result of proof.results) {
    const expect = result.expect;
    if (expect.runner_error) {
      if (result.error?.code !== expect.runner_error) {
        failures.push(`${result.id}: expected runner error ${expect.runner_error}, got ${result.error?.code || 'none'}`);
      }
      continue;
    }
    if (result.error) { failures.push(`${result.id}: runner error ${result.error.code}`); continue; }
    if (!result.output) { failures.push(`${result.id}: no runner output`); continue; }
    // Identity: the runner must name exactly this agent, never a fallback. It
    // appears on the semantic result and on the invocation record; both must
    // agree, since a mismatch is how a generic fallback would hide.
    if (result.output.result?.agent_id !== AGENT_ID) {
      failures.push(`${result.id}: result.agent_id ${result.output.result?.agent_id}`);
    }
    if (result.output.invocation?.agent_id !== AGENT_ID) {
      failures.push(`${result.id}: invocation.agent_id ${result.output.invocation?.agent_id}`);
    }
    if (expect.infrastructure_state && result.output.infrastructure_state !== expect.infrastructure_state) {
      failures.push(`${result.id}: infrastructure_state ${result.output.infrastructure_state}`);
    }
    const semantic = result.output.result;
    if (expect.blocked) {
      if (!semantic || !semantic.state) failures.push(`${result.id}: expected a semantic refusal payload`);
      else if (semantic.state !== 'BLOCKED') failures.push(`${result.id}: state ${semantic.state}`);
      // A refusal must say why: the rationale is what makes it actionable.
      else if (!semantic.operational_rationale?.reason) failures.push(`${result.id}: refusal carries no operational rationale`);
      if (semantic && semantic.next_owner !== 'hermes') failures.push(`${result.id}: next_owner ${semantic?.next_owner}`);
    }
    // Authority: no dispatch of this agent may ever carry selection or approval.
    const text = JSON.stringify(result.output);
    for (const forbidden of ['human_selection', 'selection_binding_sha256', 'performance_approved', 'take_selected']) {
      if (new RegExp(forbidden, 'i').test(text)) {
        failures.push(`${result.id}: envelope carries ${forbidden}`);
      }
    }
  }

  // Criterion #3 refusal.
  const refusalCode = proof.unflipped_refusal.output?.infrastructure_state
    || proof.unflipped_refusal.error?.code;
  if (!['BLOCKED_AGENT_NOT_ENABLED', 'BLOCKED_IMPLEMENTATION_NOT_PROVEN'].includes(refusalCode)) {
    failures.push(`unflipped root did not refuse dispatch (got ${refusalCode || 'nothing'})`);
  }

  return { ok: failures.length === 0, failures };
}

module.exports = { AGENT_ID, sha256, buildIsolatedRoot, cases, runProductionPath, evaluate };

if (require.main === module) {
  (async () => {
    const proof = await runProductionPath({});
    const verdict = evaluate(proof);
    const emitIndex = process.argv.indexOf('--emit');
    const payload = {
      agent_id: AGENT_ID,
      criterion: 'implementation-promotion-criteria #3 and #4',
      live_registry_unchanged: proof.live_registry.unchanged,
      fixture_flipped_from: proof.fixtureFlippedFrom,
      cases: proof.results.map((r) => ({
        id: r.id,
        agent_id: r.output?.result?.agent_id ?? r.output?.invocation?.agent_id ?? null,
        infrastructure_state: r.output?.infrastructure_state ?? null,
        runner_error: r.error?.code ?? null,
      })),
      unflipped_refusal: proof.unflipped_refusal.output?.infrastructure_state
        || proof.unflipped_refusal.error?.code || null,
      verdict: verdict.ok ? 'PRODUCTION_PATH_PROVEN' : 'FAILED',
      failures: verdict.failures,
    };
    if (emitIndex >= 0 && process.argv[emitIndex + 1]) {
      const dir = path.resolve(process.argv[emitIndex + 1]);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'presenter-director-production-path.json'), `${JSON.stringify(payload, null, 2)}\n`);
    }
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = verdict.ok ? 0 : 1;
  })();
}
