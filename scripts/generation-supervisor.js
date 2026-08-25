// Generation Supervisor: bounded execution of approved generation briefs
// through EXISTING routing abstractions. It never invents machine health
// (Production Operations owns readiness), never grants approval, never writes
// promotion state, and never bypasses lane no-fallback policy.
//
// Usage:
//   node scripts/generation-supervisor.js --task <task.json> [--out <status.json>] [--repo <path>]
//
// Task envelope (see scripts/generation-task-schema.json):
// {
//   "task_id": "GEN-0001", "project_id": "...", "artifact_class": "image",
//   "requested_by": "hermes", "brief": {...}, "routing": {"lane": "text_to_image_generation"},
//   "max_attempts": 2
// }
//
// Execution strategy for this phase: the supervisor validates the brief,
// resolves the lane through media-routing.js (single source of routing truth),
// probes the lane endpoint's health, and either dispatches through the
// existing engine bridge (when a safe, registered dispatch path exists) or
// fails closed with a precise state. It never fabricates outputs.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { guardExecutableLifecycle } = require('./agent-executable-boundary.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const mediaRouting = require(path.join(REPO_ROOT, 'media-routing.js'));

const AGENT_ID = 'generation_supervisor';
const STATE_OWNERS = {
  INPUT_MISSING: 'production_operations',
  NO_ELIGIBLE_ROUTE: 'production_operations',
  RESOURCE_UNAVAILABLE: 'production_operations',
  DISPATCH_FAILED: 'generation_supervisor',
  GENERATION_FAILED: 'generation_supervisor',
  OUTPUT_MISSING: 'generation_supervisor',
  OUTPUT_INVALID: 'generation_supervisor',
  QC_PENDING: 'qc_director',
  QC_FAILED: 'generation_supervisor',
  WAITING_FOR_HUMAN: 'mikko',
  COMPLETE: null,
};

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function probeHttp(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ reachable: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, reason: 'timeout' }); });
    req.on('error', (e) => resolve({ reachable: false, reason: e.code || e.message }));
  });
}

// The canonical runner reads ACTIONS to validate a requested action before it
// invokes the module. A task with no action keeps the historical direct-CLI
// behaviour and is treated as a supervision request.
const ACTIONS = Object.freeze(['supervise_generation', 'status']);
const DEFAULT_ACTION = 'supervise_generation';

function requestedAction(task) {
  return (task && (task.assignment?.action || task.action)) || DEFAULT_ACTION;
}

// Attention comes from the registry escalation contract, not from invention.
// Only WAITING_FOR_HUMAN is owned by Mikko; every other current state routes to
// Production Operations or back to this agent, which the contract treats as
// AUTONOMOUS/INFORMATION. This agent never manufactures a DECISION it cannot
// justify by owner.
function deriveAttention(status) {
  return STATE_OWNERS[status.state] === 'mikko' ? 'DECISION' : 'INFORMATION';
}

// Read-only projection over state this agent already produced. It exposes no
// generation operation and creates no new authority.
function controlRoomView(status) {
  const attention = status.attention || deriveAttention(status);
  return {
    role: AGENT_ID,
    action: status.action || null,
    state: status.state,
    attention,
    attention_level: attention,
    artifact_class: status.artifact_class,
    route: status.route
      ? { lane: status.route.lane, machine: status.route.machine, engine: status.route.engine, model: status.route.model }
      : null,
    readiness_probe: status.readiness_probe
      ? { endpoint: status.readiness_probe.endpoint, reachable: status.readiness_probe.reachable, owner: status.readiness_probe.owner }
      : null,
    outputs: Array.isArray(status.outputs) ? status.outputs.length : 0,
    qc: status.qc || null,
    retry: status.retry || null,
    blocker: status.reason || null,
    // Generation Supervisor never issues QC verdicts or human approval.
    qc_verdict_claimed: false,
    human_approval_claimed: false,
    operational_rationale: {
      decision: status.state,
      reason: status.reason || `generation supervisor state is ${status.state}`,
      evidence_refs: [
        status.route ? { ref: 'route', summary: `${status.route.machine}/${status.route.engine} via ${status.route.lane}` } : null,
        status.provenance?.source_commit ? { ref: 'source_commit', summary: status.provenance.source_commit } : null,
      ].filter(Boolean),
      confidence: null,
      escalation_reason: ['REVIEW', 'DECISION'].includes(attention) ? (status.reason || null) : null,
    },
    owner: AGENT_ID,
    next_owner: status.handoff?.next_owner || null,
    latest_event: status.events?.at(-1) || null,
  };
}

// Mechanical vs creative retry classification.
function classifyFailure(state) {
  const MECHANICAL = ['RESOURCE_UNAVAILABLE', 'DISPATCH_FAILED', 'OUTPUT_MISSING'];
  const CREATIVE = ['OUTPUT_INVALID'];
  if (MECHANICAL.includes(state)) return { class: 'mechanical', retry_allowed: true };
  if (CREATIVE.includes(state)) return { class: 'creative', retry_allowed: false };
  return { class: 'unknown', retry_allowed: false };
}

// run() is the pure agent surface: task in, canonical status envelope out. It
// performs no argv parsing, no stdout writing and no process exit, so the
// control room can load and inspect this module the same way it inspects every
// other mature specialist. Generation behaviour below is unchanged.
async function run(task, options = {}) {
  const action = requestedAction(task);
  const events = [];
  const ev = (state, detail) => events.push({ at: new Date().toISOString(), agent: AGENT_ID, state, detail: detail || null });

  const status = {
    schema_version: 1,
    agent_id: AGENT_ID,
    task_id: task.task_id || null,
    project_id: task.project_id || null,
    artifact_class: task.artifact_class || null,
    action,
    state: null,
    owner_history: [{ agent: AGENT_ID, state: 'REQUESTED' }],
    route: null,
    attempts: 0,
    max_attempts: task.max_attempts || 2,
    outputs: [],
    provenance: null,
    qc: { required: true, state: 'QC_PENDING', verdict: null },
    handoff: null,
    events,
  };

  // ── status: bounded availability report ──────────────────────────────────
  // Cheapest legitimate action. It resolves no lane, probes no endpoint and
  // dispatches nothing, so it can never start a render workload.
  if (action === 'status') {
    status.state = 'COMPLETE';
    status.reason = 'generation supervisor is available; no generation brief was submitted';
    status.qc = { required: false, state: 'NOT_APPLICABLE', verdict: null };
    status.supported_actions = [...ACTIONS];
    status.policy_source = 'config/media-routing.json';
    status.handoff = { next_owner: 'hermes', next_action: 'DISPATCH_GENERATION_BRIEF' };
    ev('STATUS_REPORTED', status.reason);
    return finish();
  }

  // ── brief/input validation ────────────────────────────────────────────────
  const brief = task.brief || {};
  const requiredInputs = brief.input_artifacts || [];
  const missing = requiredInputs.filter((p) => !fs.existsSync(path.resolve(p)));
  if (!brief.purpose || !task.artifact_class || !task.routing || !task.routing.lane) {
    status.state = 'INPUT_MISSING';
    status.reason = 'brief incomplete: purpose, artifact_class and routing.lane are required';
    return finish();
  }
  if (missing.length) {
    status.state = 'INPUT_MISSING';
    status.reason = `missing input artifacts: ${missing.join(', ')}`;
    return finish();
  }
  ev('INPUT_VALIDATED', `${requiredInputs.length} inputs present`);

  // ── route resolution through existing routing policy ─────────────────────
  const laneId = task.routing.lane;
  let lane = null;
  try {
    lane = mediaRouting.getLane(laneId);
  } catch (e) {
    lane = null;
    status.reason = `unknown lane "${laneId}" — routing policy defines the eligible set`;
  }
  if (!lane) {
    if (!status.reason) status.reason = `unknown lane "${laneId}" — routing policy defines the eligible set`;
    status.state = 'NO_ELIGIBLE_ROUTE';
    return finish();
  }
  if (task.routing.allowed_engines && !task.routing.allowed_engines.includes(lane.engine)) {
    status.state = 'NO_ELIGIBLE_ROUTE';
    status.reason = `lane engine "${lane.engine}" is not in allowed_engines ${JSON.stringify(task.routing.allowed_engines)}`;
    return finish();
  }
  const endpoint = mediaRouting.resolveEndpoint(laneId);
  const model = mediaRouting.resolveModel(laneId);
  ev('ROUTE_RESOLVED', `${lane.host}/${lane.engine} via ${endpoint}`);

  // ── resource readiness probe (report only — Ops owns the verdict) ────────
  let readiness = { reachable: true, skipped: true };
  if (endpoint && endpoint.startsWith('http')) {
    readiness = await probeHttp(endpoint);
  }
  status.readiness_probe = { endpoint, ...readiness, owner: 'production_operations' };
  if (!readiness.reachable) {
    status.state = 'RESOURCE_UNAVAILABLE';
    status.reason = `lane endpoint ${endpoint} unreachable (${readiness.reason || readiness.status}) — no-fallback policy forbids rerouting`;
    return finish();
  }

  // ── dispatch: bounded, through registered bridges only ───────────────────
  // This phase implements the DISPATCH-PROOF contract: route selection,
  // readiness, policy compliance and provenance scaffolding are fully proven;
  // actual engine submission is delegated to the engine's existing operator
  // bridge (package-engine FLUX submit / comfy CLI) which requires a package
  // context and operator authorization not present in a bare task file.
  status.state = 'READY';
  status.route = {
    lane: laneId, machine: lane.host, engine: lane.engine,
    model: model || null, workflow: lane.preferred_workflow || null,
    endpoint, fallback_allowed: lane.fallback_allowed === true,
  };
  status.provenance = {
    generating_agent: AGENT_ID,
    route: status.route,
    input_artifacts: requiredInputs,
    source_commit: (() => { try { return require('node:child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })(),
    policy_source: 'config/media-routing.json',
  };
  status.state = 'DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE';
  status.reason = 'route resolved and healthy, but no registered programmatic dispatch bridge accepts a bare task file; engine submission requires the operator bridge (package-engine /api/flux/submit) with package context — fail-closed rather than bypassing policy';
  status.qc.state = 'QC_PENDING';
  status.handoff = { next_owner: STATE_OWNERS[status.state] || 'production_operations',
    next_action: 'REGISTER_DISPATCH_BRIDGE_OR_SUBMIT_VIA_OPERATOR_BRIDGE' };
  ev(status.state, status.reason);
  return finish();

  function finish() {
    if (STATE_OWNERS[status.state] !== undefined && STATE_OWNERS[status.state] !== null) {
      status.handoff = { next_owner: STATE_OWNERS[status.state],
        next_action: status.handoff ? status.handoff.next_action : 'REMEDIATE' };
    }
    const failure = classifyFailure(status.state);
    status.retry = { attempts: status.attempts, max: status.max_attempts,
      classification: failure.class, retry_allowed: failure.retry_allowed };
    // Canonical envelope fields the shared runner validates.
    status.attention = deriveAttention(status);
    status.attention_level = status.attention;
    status.control_room = controlRoomView(status);
    status.operational_rationale = status.control_room.operational_rationale;
    return status;
  }
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--task') args.task = process.argv[++i];
    else if (process.argv[i] === '--out') args.out = process.argv[++i];
    else if (process.argv[i] === '--repo') args.repo = process.argv[++i];
  }
  if (!args.task) {
    console.error('usage: generation-supervisor.js --task <task.json> [--out <status.json>]');
    process.exit(2);
  }
  const status = await run(JSON.parse(fs.readFileSync(args.task, 'utf8')), { repo: args.repo });
  const payload = `${JSON.stringify(status, null, 2)}\n`;
  if (args.out) fs.writeFileSync(args.out, payload);
  process.stdout.write(payload);
  // process.exitCode, never process.exit(): the canonical runner reads this
  // module's stdout over a pipe, and an immediate exit can truncate it.
  process.exitCode = status.state === 'COMPLETE' ? 0 : 1;
}

// The canonical runner (scripts/agent-run.js) verifies module-declared identity
// against the requested registry id before it will dispatch. Without these
// exports the runner refuses with RUNNER_AGENT_ID_MISMATCH, however healthy the
// implementation is.
module.exports = {
  AGENT_ID, ACTIONS, DEFAULT_ACTION, STATE_OWNERS,
  sha256, requestedAction, deriveAttention, controlRoomView, classifyFailure, run, main,
};

if (require.main === module && guardExecutableLifecycle(AGENT_ID)) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
