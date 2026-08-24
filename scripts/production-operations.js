#!/usr/bin/env node
'use strict';

/*
 * Production Operations Director — V1 IMPLEMENTATION CANDIDATE.
 *
 * Mandate (config/agent-contract.json role_roster.production_operations):
 * owns infrastructure, execution availability, workflow state, machine/resource
 * problems, run-state maintenance. Must never convert a creative problem into
 * an infrastructure problem merely because the workflow is blocked.
 *
 * V1 scope: READ-ONLY diagnosis and bounded recommendation.
 *   Actions: status | diagnose_blocker | recommend_remediation | prepare_route
 *   Consumes canonical evidence only: package-run workflow map, doctor report,
 *   system registry, prior specialist invocation evidence supplied in the task.
 *   No shell execution, no model calls, no writes outside the runner envelope,
 *   no RETRY/CANCEL execution (operator control plane only), no approvals.
 *
 * READINESS GATE: this module is an implementation CANDIDATE. Its registry
 * entry carries implementation_state: 'CANDIDATE'. When executed directly
 * (require.main), the module refuses with BLOCKED_IMPLEMENTATION_NOT_PROVEN
 * until Mikko promotes implementation_state to 'IMPLEMENTATION_PROVEN'.
 * Importing the module stays side-effect-free for tests and projections.
 */

const fs = require('node:fs');
const path = require('node:path');

const AGENT_ID = 'production_operations';
const LANE = 'local_readonly';
const ACTIONS = Object.freeze(['status', 'diagnose_blocker', 'recommend_remediation', 'prepare_route']);
const ATTENTION_LEVELS = Object.freeze(['INFORMATION', 'REVIEW', 'DECISION']);

// Prohibited authority — structural, tested. This role recommends; it never
// decides creative, human, or operator questions.
const PROHIBITED_ACTIONS = Object.freeze([
  'approve', 'record_approval', 'greenlight', 'publish', 'retry_execute',
  'cancel_execute', 'rewrite_script', 'route_disabled_role', 'dispatch_agent',
]);

const IMPLEMENTATION_STATE_CANDIDATE = 'CANDIDATE';
const IMPLEMENTATION_STATE_PROVEN = 'IMPLEMENTATION_PROVEN';

class ProductionOperationsError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductionOperationsError'; this.code = code; }
}

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function registration(root) {
  const registry = JSON.parse(fs.readFileSync(path.join(root || repoRoot(), 'config', 'agent-registry.json'), 'utf8'));
  return (registry.agents || []).find((agent) => agent.agent_id === AGENT_ID) || null;
}

function implementationState(registrationEntry) {
  const value = registrationEntry?.implementation_state;
  return value === IMPLEMENTATION_STATE_PROVEN ? IMPLEMENTATION_STATE_PROVEN : IMPLEMENTATION_STATE_CANDIDATE;
}

// ── canonical evidence readers (all read-only, all repo-local) ───────────────

function readWorkflowMap(runId, options = {}) {
  const root = options.root || repoRoot();
  const mapModule = require('./package-run-workflow-map.js');
  try {
    return { source: 'WORKFLOW_MAP', ok: true, map: mapModule.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: root }) };
  } catch (error) {
    return { source: 'WORKFLOW_MAP', ok: false, error: error.message };
  }
}

function readSystemRegistry(options = {}) {
  const root = options.root || repoRoot();
  try {
    const registry = require('./system-registry.js').loadRegistry(path.join(root, 'config', 'system-registry.json'));
    return { source: 'SYSTEM_REGISTRY', ok: true, components: (registry.components || []).map((component) => ({ id: component.id, name: component.name })) };
  } catch (error) {
    return { source: 'SYSTEM_REGISTRY', ok: false, error: error.message };
  }
}

// Infrastructure blocker classifier — deterministic pattern set over canonical
// escalation reasons. Creative-sounding blockers are explicitly NOT claimed:
// converting creative problems into infrastructure problems is prohibited.
const INFRASTRUCTURE_PATTERNS = Object.freeze([
  { pattern: /fetch failed|econnrefused|etimedout|enotfound/i, kind: 'NETWORK_ENDPOINT_UNAVAILABLE', attention: 'REVIEW' },
  { pattern: /model_failed|model unavailable|ollama|llm route/i, kind: 'MODEL_LANE_UNAVAILABLE', attention: 'REVIEW' },
  { pattern: /vram|gpu|out of memory/i, kind: 'COMPUTE_EXHAUSTED', attention: 'REVIEW' },
  { pattern: /disk|no space/i, kind: 'STORAGE_EXHAUSTED', attention: 'DECISION' },
  { pattern: /resource|presto|comfyui|flux|remotion lane/i, kind: 'RESOURCE_LANE_UNAVAILABLE', attention: 'REVIEW' },
  { pattern: /lock|pid no longer alive|abandoned invocation/i, kind: 'INVOCATION_ABANDONED', attention: 'REVIEW' },
]);

const CREATIVE_BLOCKER_GUARDS = Object.freeze([
  /narrative|spine|script|argument|story|claim|research finding|framing taste|aesthetic|creative/i,
]);

function classifyBlocker(reasonText) {
  const reason = String(reasonText || '');
  // Guard clause: anything matching creative vocabulary is refused as
  // out-of-mandate regardless of whether an infra pattern also matches.
  if (CREATIVE_BLOCKER_GUARDS.some((guard) => guard.test(reason))) {
    return { in_mandate: false, kind: 'OUT_OF_MANDATE_CREATIVE', attention: null };
  }
  const match = INFRASTRUCTURE_PATTERNS.find((entry) => entry.pattern.test(reason));
  if (!match) return { in_mandate: false, kind: 'UNCLASSIFIED', attention: null };
  return { in_mandate: true, kind: match.kind, attention: match.attention };
}

// ── bounded remediation recommendations (recommend-only, never execute) ──────

function recommendRemediation(kind, evidence = {}) {
  const remediations = Object.freeze({
    NETWORK_ENDPOINT_UNAVAILABLE: {
      recommendation: 'VERIFY_ENDPOINT_THEN_RERUN_SPECIALIST',
      steps: ['probe the endpoint named in the blocker reason', 'if reachable, request specialist rerun through the operator control plane', 'if unreachable, surface host/network state to Hermes'],
      resume_condition: 'BLOCKER_RESOLVED',
    },
    MODEL_LANE_UNAVAILABLE: {
      recommendation: 'RESTORE_MODEL_LANE_OR_ESCALATE_HOST_DECISION',
      steps: ['check configured model endpoint health', 'lane fallback that changes the approved production baseline requires Mikko', 'otherwise rerun the source specialist once the lane recovers'],
      resume_condition: 'WAITING_FOR_RESOURCE',
    },
    COMPUTE_EXHAUSTED: {
      recommendation: 'WAIT_FOR_COMPUTE_THEN_RERUN_SPECIALIST',
      steps: ['observe GPU/compute readiness', 'do not start new generation work', 'rerun source specialist when compute reports available'],
      resume_condition: 'WAITING_FOR_RESOURCE',
    },
    STORAGE_EXHAUSTED: {
      recommendation: 'HUMAN_DECISION_ON_STORAGE_RECOVERY',
      steps: ['storage recovery may involve deleting/archiving production evidence — that is always a human decision', 'present VIDNAS/archive state to Mikko'],
      resume_condition: 'BLOCKER_RESOLVED',
    },
    RESOURCE_LANE_UNAVAILABLE: {
      recommendation: 'OBSERVE_RESOURCE_READINESS_THEN_RERUN',
      steps: ['check live resource probe state for the named lane', 'rerun source specialist when the lane reports AVAILABLE'],
      resume_condition: 'WAITING_FOR_RESOURCE',
    },
    INVOCATION_ABANDONED: {
      recommendation: 'OPERATOR_RETRY_REQUIRED',
      steps: ['abandoned invocations recover only through the human operator control plane (RETRY)', 'surface the exact invocation id to the operator dashboard'],
      resume_condition: 'SPECIALIST_RERUN_REQUIRED',
    },
  });
  const base = remediations[kind] || {
    recommendation: 'ESCALATE_TO_HERMES_UNCLASSIFIED',
    steps: ['blocker does not match a known infrastructure class', 'summarize evidence and return routing to Hermes'],
    resume_condition: 'BLOCKER_RESOLVED',
  };
  return { ...base, executes_retry: false, executes_cancel: false, approval_requested: false };
}

function operationalRationale(state, reason, refs = []) {
  return {
    source: 'AGENT',
    decision: state,
    reason: String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    evidence_refs: (refs || []).slice(0, 20).map((ref) => (
      typeof ref === 'string' ? { ref: ref.slice(0, 256) } : { ref: String(ref.ref).slice(0, 256), summary: ref.summary == null ? undefined : String(ref.summary).slice(0, 256) }
    )),
    confidence: null,
    escalation_reason: state === 'REVIEW' || state === 'DECISION' ? String(reason || '').slice(0, 600) : null,
  };
}

function finish(task, out, state, attention, nextOwner, reason, refs) {
  out.state = state;
  out.attention = attention;
  out.reason = reason || null;
  out.operational_rationale = operationalRationale(attention, reason, refs);
  out.handoff = { next_owner: nextOwner, next_action: nextOwner === 'hermes' ? 'ESCALATE_WITH_EVIDENCE' : nextOwner === 'production_operations' ? null : 'REMEDIATE' };
  out.provenance = { acting_agent: AGENT_ID, lane: LANE, recorded_at: new Date().toISOString(), implementation_state: implementationState(registration()) };
  out.events.push({ at: new Date().toISOString(), actor: AGENT_ID, state, detail: reason || null });
  return out;
}

// ── task validation (canonical envelope, no arbitrary fields executed) ───────

function preflight(task) {
  const errors = [];
  if (!task || typeof task !== 'object') { errors.push('task is not an object'); return errors; }
  if (!task.task_id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(task.task_id))) errors.push('task_id missing or invalid');
  if (!ACTIONS.includes(task.assignment?.action)) errors.push(`unsupported action ${task.assignment?.action}`);
  for (const banned of ['approval', 'approved_by', 'greenlight', 'publication']) {
    if (JSON.stringify(task).toLowerCase().includes(`"${banned}"`)) errors.push(`task carries forbidden ${banned} metadata`);
  }
  return errors;
}

async function run(task, options = {}) {
  const root = options.root || repoRoot();
  const out = {
    schema_version: 1, agent_id: AGENT_ID, role_id: AGENT_ID,
    task_id: task.task_id, package_run_id: task.package_run_id ?? null,
    requested_by: task.requested_by || 'hermes',
    state: null, attention: 'INFORMATION', reason: null,
    diagnosis: null, recommendation: null, route_preparation: null,
    disagreement_state: 'NONE', handoff: null, provenance: null, events: [],
  };
  const action = task.assignment?.action;
  out.events.push({ at: new Date().toISOString(), actor: AGENT_ID, state: 'ASSIGNMENT_RECEIVED', detail: `${action} from ${out.requested_by}` });

  const preErrors = preflight(task);
  if (preErrors.length) {
    return finish(task, out, 'BLOCKED', 'REVIEW', 'hermes', `deterministic preflight failed: ${preErrors.join('; ')}`, []);
  }

  if (action === 'status') {
    const systems = readSystemRegistry({ root });
    const healthy = systems.ok;
    return finish(task, out, 'COMPLETE', 'INFORMATION', null,
      healthy ? 'systems registry readable; no operational anomaly asserted' : `systems registry unreadable: ${systems.error}`,
      [systems.source]);
  }

  // diagnose_blocker / recommend_remediation / prepare_route all consume the
  // same bounded evidence block carried on the task.
  const evidence = task.blocker_evidence || {};
  const classification = classifyBlocker(evidence.reason);

  if (!classification.in_mandate) {
    return finish(task, out, 'REFUSED_OUT_OF_MANDATE', 'REVIEW', 'hermes',
      `blocker classified ${classification.kind}: production operations does not own creative problems`,
      [{ ref: 'blocker_reason', summary: String(evidence.reason || '').slice(0, 200) }]);
  }

  out.diagnosis = { kind: classification.kind, in_mandate: true, source_reason: String(evidence.reason || '').slice(0, 600) };

  if (action === 'diagnose_blocker' || action === 'recommend_remediation') {
    const remediation = recommendRemediation(classification.kind, evidence);
    out.recommendation = remediation;
    const state = classification.attention; // REVIEW or DECISION per class
    return finish(task, out, state === 'DECISION' ? 'AWAITING_HUMAN_DECISION' : 'REMEDIATION_RECOMMENDED',
      state, state === 'DECISION' ? 'mikko' : 'hermes',
      `${classification.kind}: ${remediation.recommendation}`,
      [{ ref: 'source_invocation', summary: String(evidence.source_invocation_id || '').slice(0, 256) }]);
  }

  if (action === 'prepare_route') {
    const target = task.route_target_agent_id || null;
    if (target && target !== 'hermes' && target !== AGENT_ID) {
      const registry = JSON.parse(fs.readFileSync(path.join(root, 'config', 'agent-registry.json'), 'utf8'));
      const targetRegistration = (registry.agents || []).find((agent) => agent.agent_id === target);
      const lc = targetRegistration?.lifecycle || {};
      const enabled = lc.proven === 'PROVEN' && lc.autonomous_dispatch === 'ENABLED';
      if (!enabled) {
        return finish(task, out, 'BLOCKED', 'REVIEW', 'hermes', `route target ${target} is not lifecycle-enabled — routing refused`, []);
      }
      out.route_preparation = {
        target, lifecycle_enabled: true,
        implementation_ready: targetRegistration?.implementation_state === IMPLEMENTATION_STATE_PROVEN
          || fs.existsSync(path.join(root, 'scripts', `${String(target).replaceAll('_', '-')}.js`)),
        dispatched: false, note: 'preparation only — launch remains a separate authorized orchestration action',
      };
    } else {
      out.route_preparation = { target: target || 'hermes', dispatched: false, note: 'preparation only' };
    }
    return finish(task, out, 'COMPLETE', 'INFORMATION', 'hermes', 'route prepared; no dispatch performed', []);
  }

  return finish(task, out, 'BLOCKED', 'REVIEW', 'hermes', `unreachable action branch: ${action}`, []);
}

function controlRoomView(result) {
  return {
    role: 'Production Operations Director', state: result.state, current_task: result.task_id,
    owner: AGENT_ID, next_owner: result.handoff ? result.handoff.next_owner : null,
    attention_level: result.attention, blocker: result.reason || null,
    unresolved_disagreement: result.disagreement_state,
    diagnosis: result.diagnosis, recommendation: result.recommendation, route_preparation: result.route_preparation,
    operational_rationale: {
      decision: result.state,
      reason: result.reason || `Production Operations state is ${result.state}`,
      evidence_refs: [{ ref: 'task', summary: String(result.task_id || '') }],
      confidence: null,
      escalation_reason: ['REVIEW', 'DECISION'].includes(result.attention) ? result.reason : null,
    },
    latest_event: Array.isArray(result.events) && result.events.length ? result.events[result.events.length - 1] : null,
  };
}

module.exports = { AGENT_ID, LANE, ACTIONS, ATTENTION_LEVELS, PROHIBITED_ACTIONS,
  IMPLEMENTATION_STATE_CANDIDATE, IMPLEMENTATION_STATE_PROVEN,
  ProductionOperationsError, classifyBlocker, recommendRemediation,
  preflight, run, controlRoomView, implementationState, registration };

// Direct execution gate: even though the registry currently says ENABLED,
// this module is an implementation CANDIDATE and refuses direct dispatch
// until implementation_state is promoted by Mikko. Fail closed.
if (require.main === module) {
  const state = implementationState(registration());
  if (state !== IMPLEMENTATION_STATE_PROVEN) {
    process.stdout.write(`${JSON.stringify({
      schema_version: 1, agent_id: AGENT_ID,
      infrastructure_state: 'BLOCKED_IMPLEMENTATION_NOT_PROVEN',
      implementation_state: state,
      reason: 'implementation is a candidate; direct dispatch requires Mikko to promote implementation_state to IMPLEMENTATION_PROVEN after proof',
    }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    let args = {};
    for (let i = 2; i < process.argv.length; i += 1) {
      if (process.argv[i] === '--task') args.task = process.argv[++i];
    }
    if (!args.task) { console.error('usage: production-operations.js --task <task.json>'); process.exitCode = 2; }
    else {
      run(JSON.parse(fs.readFileSync(path.resolve(args.task), 'utf8'))).then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.exitCode = ['COMPLETE'].includes(result.state) ? 0 : 1;
      }).catch((error) => {
        process.stdout.write(`${JSON.stringify({ schema_version: 1, agent_id: AGENT_ID, infrastructure_state: 'PRODUCTION_OPERATIONS_FAILED', reason: error.message }, null, 2)}\n`);
        process.exitCode = 1;
      });
    }
  }
}
