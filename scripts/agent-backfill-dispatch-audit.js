'use strict';

/*
 * 5ca7334 BACKFILL CLASS — PRODUCTION-PATH DISPATCH AUDIT
 *
 * The implementation_state field was introduced one commit earlier, by f87c26c,
 * which gated three agents at CANDIDATE. The very next commit, 5ca7334
 * ("fix(agents): enforce canonical implementation readiness"), extended the
 * field to the remaining seven agents and set every one of them straight to
 * IMPLEMENTATION_PROVEN - the opposite default - while leaving the original
 * three at CANDIDATE. None of the seven demonstrated anything to earn it: the
 * state was backfilled, not earned.
 *
 * Two members of that class later turned out to be untrue in different ways, so
 * this audit tests the whole population the same way, through the REAL
 * production path rather than by inspection:
 *
 *   A. direct module      — module loads and its own surface works
 *   B. canonical runner   — scripts/agent-run.js resolves, invokes, persists
 *   C. dispatch authority — implementationReadiness authorizes it
 *
 * An agent that passes A but fails B is not dispatch-proven.
 *
 * It uses each agent's cheapest bounded action (status) and never triggers
 * generation, rendering, research or any external job. It touches no Earth
 * Studio file and no specialist reasoning.
 *
 * Usage:
 *   node scripts/agent-backfill-dispatch-audit.js --emit <dir>
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKFILL_COMMIT = '5ca7334d49fc5209612f3b889a4170df86c3025a';

const runner = require('./agent-run.js');
const dispatchAuthority = require('./agent-dispatch-authority.js');

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}
function git(...args) { return cp.execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }); }

/** Derive the audit population from the commit itself, never from a hardcoded list. */
function backfillPopulation() {
  const before = JSON.parse(git('show', `${BACKFILL_COMMIT}^:config/agent-registry.json`));
  const after = JSON.parse(git('show', `${BACKFILL_COMMIT}:config/agent-registry.json`));
  const map = (r) => Object.fromEntries((r.agents || []).map((a) => [a.agent_id, a]));
  const [b, a] = [map(before), map(after)];
  const population = [];
  for (const id of Object.keys(a)) {
    const was = b[id]?.implementation_state ?? null;
    const now = a[id]?.implementation_state ?? null;
    if (was !== now && now === 'IMPLEMENTATION_PROVEN') {
      population.push({ agent_id: id, before: was ?? 'FIELD_ABSENT', after: now });
    }
  }
  return {
    commit: BACKFILL_COMMIT,
    subject: git('log', '-1', '--format=%s', BACKFILL_COMMIT).trim(),
    // The field already existed (f87c26c gated three agents at CANDIDATE); this
    // commit extended it to the rest and defaulted them all to PROVEN.
    field_existed_before: Object.values(b).some((x) => x.implementation_state !== undefined),
    pre_existing_states: Object.fromEntries(Object.entries(b)
      .filter(([, x]) => x.implementation_state !== undefined)
      .map(([id, x]) => [id, x.implementation_state])),
    population,
  };
}

/** Durable proof / governance evidence present for an agent today. */
function durableEvidence(agentId) {
  const slug = agentId.replaceAll('_', '-');
  const governance = fs.existsSync(path.join(REPO_ROOT, 'governance'))
    ? fs.readdirSync(path.join(REPO_ROOT, 'governance')).filter((f) => f.startsWith(slug)) : [];
  const proofs = fs.readdirSync(path.join(REPO_ROOT, 'package-runs'))
    .filter((r) => r.includes(slug) && /proof/i.test(r));
  return { governance_records: governance, proof_packages: proofs, has_durable_evidence: governance.length > 0 || proofs.length > 0 };
}

function moduleContract(agentId) {
  const modulePath = dispatchAuthority.modulePathFor(REPO_ROOT, agentId);
  const contract = {
    module_path: path.relative(REPO_ROOT, modulePath),
    module_exists: fs.existsSync(modulePath),
    module_sha256: null, declares_agent_id: null, identity_matches: null,
    exports_actions: null, actions: null, exports_run: null, exports_control_room_view: null,
    safe_for_identity_inspection: null,
  };
  if (!contract.module_exists) return contract;
  const source = fs.readFileSync(modulePath, 'utf8');
  contract.module_sha256 = sha256(source);
  contract.safe_for_identity_inspection = /require\.main\s*===\s*module/.test(source);
  try {
    const loaded = require(modulePath);
    contract.declares_agent_id = loaded.AGENT_ID ?? null;
    contract.identity_matches = loaded.AGENT_ID === agentId;
    contract.exports_actions = Array.isArray(loaded.ACTIONS);
    contract.actions = Array.isArray(loaded.ACTIONS) ? [...loaded.ACTIONS] : null;
    contract.exports_run = typeof loaded.run === 'function';
    contract.exports_control_room_view = typeof loaded.controlRoomView === 'function';
  } catch (error) { contract.load_error = error.message.slice(0, 160); }
  return contract;
}

function writeTask(dir, task) {
  const p = path.join(dir, 'task.json');
  fs.writeFileSync(p, `${JSON.stringify(task, null, 2)}\n`);
  return p;
}

/** Execution level C then B: authority, then real canonical dispatch. */
async function dispatchProbe(agentId, registration) {
  const runId = `backfill-audit-${agentId.replaceAll('_', '-')}`;
  const runDir = path.join(REPO_ROOT, 'package-runs', runId);
  const readiness = dispatchAuthority.implementationReadiness(REPO_ROOT, registration);
  const result = {
    authority: { authorized: readiness.authorized, code: readiness.code, module_exists: readiness.module_exists },
    positive: null, negative: null,
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-audit-'));
  try {
    // POSITIVE — cheapest bounded action. Never triggers external work.
    try {
      const taskPath = writeTask(tmp, {
        task_id: `backfill-audit-${agentId}-status`, package_run_id: runId,
        project_id: 'backfill-audit-probe', requested_by: 'hermes', assignment: { action: 'status' },
      });
      const out = await runner.runRegisteredAgent({ repoRoot: REPO_ROOT, agentId, runId, taskPath });
      result.positive = {
        dispatched: true,
        infrastructure_state: out.infrastructure_state,
        envelope_error: out.invocation?.envelope_error ?? null,
        envelope_valid: out.invocation ? out.invocation.envelope_error === null : false,
        semantic_state: out.invocation?.semantic_state ?? null,
        exit_code: out.invocation?.exit_code ?? null,
        result_agent_id: out.result?.agent_id ?? null,
        has_control_room: Boolean(out.result?.control_room),
        result_persisted: Boolean(out.invocation?.result_sha256),
        result_sha256: out.invocation?.result_sha256 ?? null,
        module_sha256: out.invocation?.module_sha256 ?? null,
      };
    } catch (error) { result.positive = { dispatched: false, error_code: error.code, error: error.message.slice(0, 160) }; }

    // NEGATIVE — unsupported action through the same production path.
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-audit-neg-'));
    try {
      const taskPath = writeTask(tmp2, {
        task_id: `backfill-audit-${agentId}-badaction`, package_run_id: runId,
        project_id: 'backfill-audit-probe', requested_by: 'hermes', assignment: { action: 'obliterate_everything' },
      });
      const out = await runner.runRegisteredAgent({ repoRoot: REPO_ROOT, agentId, runId, taskPath });
      result.negative = {
        refused_at_runner_gate: false,
        infrastructure_state: out.infrastructure_state,
        semantic_state: out.invocation?.semantic_state ?? null,
        exit_code: out.invocation?.exit_code ?? null,
        reason: (out.result?.reason || out.result?.errors?.[0] || '').slice(0, 160),
        failed_closed: out.invocation?.semantic_state !== 'COMPLETE',
      };
    } catch (error) {
      result.negative = { refused_at_runner_gate: true, error_code: error.code, error: error.message.slice(0, 160), failed_closed: true };
    }
    fs.rmSync(tmp2, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  return result;
}

function classify(agent) {
  const { contract, dispatch, evidence } = agent;
  if (!contract.module_exists) return { classification: 'FALSE_BACKFILL', reason: 'no module exists at the canonical path' };
  if (!dispatch.positive?.dispatched) {
    return { classification: 'MODULE_CONTRACT_REGRESSION', reason: `canonical dispatch fails: ${dispatch.positive?.error_code}` };
  }
  if (dispatch.positive.infrastructure_state !== 'COMPLETE' || !dispatch.positive.envelope_valid) {
    return { classification: 'MODULE_CONTRACT_REGRESSION', reason: 'dispatch completed but the canonical envelope is invalid' };
  }
  if (!dispatch.negative?.failed_closed) {
    return { classification: 'MODULE_CONTRACT_REGRESSION', reason: 'an unsupported action did not fail closed' };
  }
  if (evidence.has_durable_evidence) {
    return { classification: 'BACKFILL_SUPERSEDED_BY_REAL_PROOF', reason: 'a later production-path proof and/or governance record re-earned this state' };
  }
  return {
    classification: 'PROOF_MISSING_BUT_RUNTIME_VALID',
    reason: 'canonical dispatch is verified today, but the original 5ca7334 promotion carried no evidence',
  };
}

async function runAudit() {
  const backfill = backfillPopulation();
  const registry = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const agents = [];
  for (const entry of backfill.population) {
    const registration = registry.agents.find((a) => a.agent_id === entry.agent_id);
    if (!registration) {
      agents.push({ agent_id: entry.agent_id, backfill: entry, note: 'no longer present in the registry' });
      continue;
    }
    const contract = moduleContract(entry.agent_id);
    const dispatch = await dispatchProbe(entry.agent_id, registration);
    const evidence = durableEvidence(entry.agent_id);
    const agent = {
      agent_id: entry.agent_id,
      backfill: entry,
      current_registry_state: registration.implementation_state,
      lifecycle: registration.lifecycle,
      historical_promotion_evidence: 'ORIGINAL_PROMOTION_EVIDENCE_ABSENT',
      contract, dispatch, evidence,
    };
    Object.assign(agent, classify(agent));
    agents.push(agent);
  }
  return { backfill, agents };
}

if (require.main === module) {
  const emitIndex = process.argv.indexOf('--emit');
  if (emitIndex < 0) { console.error('usage: agent-backfill-dispatch-audit.js --emit <dir>'); process.exit(2); }
  const emitDir = path.resolve(process.argv[emitIndex + 1]);
  fs.mkdirSync(emitDir, { recursive: true });
  (async () => {
    const registryBefore = fs.readFileSync(path.join(REPO_ROOT, 'config', 'agent-registry.json'), 'utf8');
    const audit = await runAudit();
    const registryAfter = fs.readFileSync(path.join(REPO_ROOT, 'config', 'agent-registry.json'), 'utf8');

    const summary = {
      schema_version: 1,
      audit: 'AGENT_BACKFILL_PRODUCTION_PATH_DISPATCH_AUDIT_V2',
      generated_at: new Date().toISOString(),
      backfill_commit: audit.backfill,
      standard: 'production-path dispatch through scripts/agent-run.js — module existence, unit tests, direct CLI '
        + 'and registry claims are explicitly NOT accepted as sufficient evidence',
      execution_levels_tested: ['A direct module surface', 'B canonical runner', 'C dispatch authority'],
      bounded_workload: {
        action_used: 'status (cheapest bounded action for every audited agent)',
        external_jobs_triggered: false,
        earth_studio_touched: false,
      },
      registry_unchanged_by_audit: registryBefore === registryAfter,
      agents: audit.agents,
      classification_counts: audit.agents.reduce((acc, a) => {
        acc[a.classification] = (acc[a.classification] || 0) + 1; return acc;
      }, {}),
      verdict: null,
    };

    const failures = [];
    for (const a of audit.agents) {
      if (a.classification === 'FALSE_BACKFILL' || a.classification === 'MODULE_CONTRACT_REGRESSION') {
        failures.push(`${a.agent_id}: ${a.classification} — ${a.reason}`);
      }
      if (a.current_registry_state === 'IMPLEMENTATION_PROVEN' && !a.dispatch?.positive?.dispatched) {
        failures.push(`${a.agent_id}: marked proven but canonical dispatch failed`);
      }
    }
    if (!summary.registry_unchanged_by_audit) failures.push('the audit mutated the live registry');

    summary.unresolved_defects = failures;
    summary.verdict = failures.length === 0
      ? 'BACKFILL_CLASS_DISPATCH_VERIFIED'
      : `BACKFILL_CLASS_DEFECTS_PRESENT — ${failures.join('; ')}`;

    fs.writeFileSync(path.join(emitDir, 'backfill-audit-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      verdict: summary.verdict,
      population: audit.backfill.population.length,
      classifications: summary.classification_counts,
    }, null, 2)}\n`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  })().catch((error) => {
    process.stdout.write(`${JSON.stringify({ verdict: 'AUDIT_FAILED', error: error.message, stack: error.stack }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { BACKFILL_COMMIT, backfillPopulation, moduleContract, dispatchProbe, durableEvidence, classify, runAudit };
