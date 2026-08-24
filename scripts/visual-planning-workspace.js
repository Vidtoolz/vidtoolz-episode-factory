'use strict';

// Visual Planning Workspace V1 is deliberately a projection, not a filesystem
// API.  The only accepted identity is an exact canonical runner invocation;
// the artifact path comes from its hash-bound invocation evidence.

const fs = require('node:fs');
const path = require('node:path');
const agentControls = require('./agent-controls.js');
const cancellationAdapters = require('./agent-cancellation-adapters.js');
const decisionQueue = require('./decision-queue.js');
const executionOwnership = require('./execution-ownership.js');
const operationalRationale = require('./operational-rationale.js');
const runner = require('./agent-run.js');
const successorTaskContract = require('./successor-task-contract.js');
const visualPlan = require('./visual-plan.js');
const workspaceContract = require('./visual-planning-workspace-contract.js');

const { WORKSPACE_SCHEMA_VERSION, WORKSPACE_SCHEMA_ID, WORKSPACE_STABLE_FIELDS } = workspaceContract;
const AGENT_ID = 'visual_planning_director';
const ARTIFACT_ID = 'visual_plan';
const APPROVAL_SCOPE = 'VISUAL_PLAN_APPROVAL';
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const UNKNOWN = 'UNKNOWN';

class VisualPlanningWorkspaceError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = 'VisualPlanningWorkspaceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode = 409) {
  throw new VisualPlanningWorkspaceError(code, message, statusCode);
}

function assertRequestedVersion(request) {
  const requestedVersion = request?.workspace_schema_version;
  const requestedId = request?.workspace_schema_id;
  if (requestedVersion !== undefined && typeof requestedVersion !== 'number') {
    fail('WORKSPACE_SCHEMA_VERSION_INVALID', 'workspace_schema_version must be the numeric value 1', 400);
  }
  if (requestedVersion !== undefined && requestedVersion !== WORKSPACE_SCHEMA_VERSION) {
    fail('WORKSPACE_SCHEMA_VERSION_UNSUPPORTED', `workspace schema version ${requestedVersion} is unsupported`, 406);
  }
  if (requestedId !== undefined && typeof requestedId !== 'string') {
    fail('WORKSPACE_SCHEMA_ID_INVALID', 'workspace_schema_id must be a string', 400);
  }
  if (requestedId !== undefined && requestedId !== WORKSPACE_SCHEMA_ID) {
    fail('WORKSPACE_SCHEMA_ID_UNSUPPORTED', `workspace schema ${requestedId} is unsupported`, 406);
  }
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertNoSymlink(parent, candidate) {
  const relative = path.relative(parent, candidate);
  if (!contained(parent, candidate)) fail('WORKSPACE_ARTIFACT_PATH_INVALID', 'Visual Plan evidence escapes the exact invocation directory');
  let cursor = parent;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (_) { fail('WORKSPACE_ARTIFACT_MISSING', 'Visual Plan evidence is missing', 404); }
    if (stat.isSymbolicLink()) fail('WORKSPACE_ARTIFACT_SYMLINK_REJECTED', 'Visual Plan evidence may not be resolved through a symbolic link');
  }
}

function readBoundedJson(file, label, maxBytes = MAX_ARTIFACT_BYTES) {
  let stat;
  try { stat = fs.statSync(file); }
  catch (_) { fail('WORKSPACE_EVIDENCE_MISSING', `${label} is missing`, 404); }
  if (!stat.isFile()) fail('WORKSPACE_EVIDENCE_INVALID', `${label} is not a regular file`);
  if (stat.size > maxBytes) fail('WORKSPACE_ARTIFACT_TOO_LARGE', `${label} exceeds the bounded workspace limit`, 413);
  const bytes = fs.readFileSync(file);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch (_) { fail('WORKSPACE_EVIDENCE_INVALID', `${label} is not valid JSON`); }
  return { bytes, value, sha256: runner.sha256(bytes) };
}

function exactArtifact(context, request) {
  const artifacts = Array.isArray(context.invocation?.artifacts) ? context.invocation.artifacts : [];
  const matches = artifacts.filter((artifact) => (artifact.field || artifact.artifact_id) === ARTIFACT_ID);
  if (matches.length !== 1) fail('WORKSPACE_VISUAL_PLAN_BINDING_INVALID', 'the invocation must bind exactly one Visual Plan artifact');
  const binding = matches[0];
  if (request.artifact_id && request.artifact_id !== ARTIFACT_ID) {
    fail('WORKSPACE_ARTIFACT_ID_MISMATCH', 'requested artifact does not match the Visual Plan binding', 404);
  }
  if (typeof binding.path !== 'string' || !binding.path || path.isAbsolute(binding.path)) {
    fail('WORKSPACE_ARTIFACT_PATH_INVALID', 'Visual Plan binding path is invalid');
  }
  const artifactPath = path.resolve(context.directory, binding.path);
  assertNoSymlink(context.directory, artifactPath);
  const artifact = readBoundedJson(artifactPath, 'Visual Plan artifact');
  if (binding.sha256 !== artifact.sha256) fail('WORKSPACE_ARTIFACT_HASH_DRIFT', 'Visual Plan bytes no longer match invocation evidence');
  if (request.artifact_sha256 && request.artifact_sha256 !== artifact.sha256) {
    fail('WORKSPACE_ARTIFACT_HASH_MISMATCH', 'requested Visual Plan hash does not match canonical evidence', 409);
  }
  return { binding, artifactPath, ...artifact };
}

function exactResult(context, plan) {
  if (!context.invocation) fail('WORKSPACE_INVOCATION_INCOMPLETE', 'workspace requires a completed, canonical invocation', 409);
  const resultPath = path.join(context.directory, 'result.json');
  assertNoSymlink(context.directory, resultPath);
  const result = readBoundedJson(resultPath, 'agent result', 8 * 1024 * 1024);
  if (result.sha256 !== context.invocation.result_sha256) fail('WORKSPACE_RESULT_HASH_DRIFT', 'agent result bytes no longer match invocation evidence');
  if (result.value.agent_id !== context.agentId || result.value.task_id !== context.record.task_id) {
    fail('WORKSPACE_RESULT_IDENTITY_MISMATCH', 'agent result is detached from the exact task or invocation');
  }
  if (!result.value.visual_plan || visualPlan.canonicalize(result.value.visual_plan) !== visualPlan.canonicalize(plan)) {
    fail('WORKSPACE_RESULT_ARTIFACT_MISMATCH', 'Visual Plan artifact does not match the invocation result');
  }
  return result;
}

function exactContext(root, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('WORKSPACE_CONTEXT_REQUIRED', 'exact workspace context is required', 400);
  if (request.agent_id !== AGENT_ID) fail('WORKSPACE_AGENT_UNSUPPORTED', 'this workspace is restricted to Visual Planning Director', 403);
  if (!request.run_id || !request.task_id || !request.invocation_id) {
    fail('WORKSPACE_CONTEXT_INCOMPLETE', 'run_id, agent_id, task_id, and invocation_id are required', 400);
  }
  if ([request.run_id, request.agent_id, request.task_id, request.invocation_id].some((value) => typeof value !== 'string')) {
    fail('WORKSPACE_CONTEXT_INVALID', 'workspace identity fields must be strings', 400);
  }
  let context;
  try { context = agentControls.locateInvocation(root, request); }
  catch (error) { fail(error.code || 'WORKSPACE_CONTEXT_INVALID', error.message, error.statusCode || 409); }
  const packageRunsRoot = path.join(root, 'package-runs');
  assertNoSymlink(root, packageRunsRoot);
  assertNoSymlink(packageRunsRoot, path.join(packageRunsRoot, context.runId, 'agents', 'index.json'));
  assertNoSymlink(packageRunsRoot, context.directory);
  assertNoSymlink(context.directory, context.taskPath);
  assertNoSymlink(context.directory, path.join(context.directory, 'invocation.json'));
  if (context.record.task_id !== request.task_id || context.task.task_id !== request.task_id) {
    fail('WORKSPACE_TASK_IDENTITY_MISMATCH', 'task_id does not match the exact invocation', 404);
  }
  if (context.invocation?.invocation_id !== request.invocation_id) {
    fail('WORKSPACE_INVOCATION_IDENTITY_MISMATCH', 'invocation identity is incomplete or detached', 404);
  }
  return context;
}

function registryTruth(context) {
  const registryPath = path.join(context.root, 'config', 'agent-registry.json');
  const registry = readBoundedJson(registryPath, 'agent registry', 2 * 1024 * 1024).value;
  const registration = registry.agents?.find((entry) => entry.agent_id === AGENT_ID);
  if (!registration) fail('WORKSPACE_AGENT_UNREGISTERED', 'Visual Planning Director is not registered');
  return { registry, registration };
}

function boundedText(value, max = 600) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function buildCoverage(plan, validation) {
  const coverage = Array.isArray(validation.coverage) ? validation.coverage : [];
  const covered = coverage.filter((item) => item.state === 'PLAN_SHOTS' || item.state === 'INTENTIONAL_NO_VISUAL');
  const uncovered = coverage.filter((item) => item.state === 'MISSING');
  return {
    required_beats: (plan.required_beats || []).map((beat) => ({
      beat_id: beat.canonical_beat_id, section_id: beat.section_id, source_provenance: beat.source_provenance || null,
    })),
    covered_beats: covered.map((item) => ({ beat_id: item.canonical_beat_id, state: item.state, shot_ids: item.shot_ids || [], reason: item.reason || null })),
    uncovered_beats: uncovered.map((item) => ({ beat_id: item.canonical_beat_id, section_id: item.section_id })),
    warnings: (validation.findings || []).filter((item) => item.code?.startsWith('COVERAGE_') || item.code === 'SHOT_NOT_COVERED')
      .map((item) => ({ code: item.code, message: boundedText(item.message), path: item.path || null })),
    complete: validation.coverage_complete === true,
  };
}

function whyByShot(result, plan) {
  const output = new Map();
  const semanticByBeat = new Map((result.semantic?.beats || []).map((beat) => [beat.canonical_beat_id, beat]));
  for (const coverage of plan.coverage || []) {
    const proposed = semanticByBeat.get(coverage.beat_ref?.canonical_beat_id)?.shots || [];
    (coverage.shot_ids || []).forEach((shotId, index) => {
      const why = boundedText(proposed[index]?.why_it_serves_story);
      if (why) output.set(shotId, why);
    });
  }
  return output;
}

function buildShots(plan, result) {
  const promptById = new Map((plan.prompts || []).map((prompt) => [prompt.prompt_id, prompt]));
  const rationale = whyByShot(result, plan);
  return (plan.shots || []).map((shot) => {
    const prompts = (shot.prompt_refs || []).map((id) => promptById.get(id)).filter(Boolean);
    return {
      shot_id: shot.shot_id,
      beat_id: shot.beat_ref?.canonical_beat_id || null,
      section_id: shot.section_ref?.section_id || shot.beat_ref?.section_id || null,
      purpose: shot.narrative_function || null,
      media_type: shot.media_type || UNKNOWN,
      framing_composition: { shot_brief: boundedText(shot.shot_brief), camera_intent: shot.camera_intent || null, presenter_relation: shot.presenter_relation || null },
      prompt_state: prompts.length ? (prompts.every((prompt) => prompt.shot_intent_digest_sha256) ? 'READY' : 'INVALID') : 'NOT_REQUIRED',
      generation_state: shot.status || UNKNOWN,
      warnings: [...(shot.continuity_notes || []).map((text) => boundedText(text)).filter(Boolean)],
      story_linkage: { project_id: plan.story?.project_id || null, version_id: plan.story?.version_id || null, section_id: shot.section_ref?.section_id || null },
      research_linkage: { sensitive: shot.research_sensitive === true, refs: shot.research_refs || [] },
      why_it_serves_story: rationale.get(shot.shot_id) || null,
    };
  });
}

function artifactMatchesObligation(obligation, artifact) {
  const bindings = Array.isArray(obligation.artifacts) ? obligation.artifacts : [];
  if (!bindings.length) return true;
  return bindings.some((entry) => entry.artifact_id === ARTIFACT_ID && entry.sha256 === artifact.sha256);
}

function exactObligationContext(item, context, artifact) {
  return item.run_id === context.runId && item.agent_id === context.agentId
    && item.task_id === context.record.task_id && item.invocation_id === context.invocationId
    && item.owning_gate === APPROVAL_SCOPE && item.approval_scope_required === APPROVAL_SCOPE
    && artifactMatchesObligation(item, artifact);
}

function assertExactWorkspaceLink(item, context) {
  if (typeof item.workspace !== 'string' || !item.workspace) {
    fail('WORKSPACE_QUEUE_LINK_INVALID', 'queue obligation lacks an exact workspace link');
  }
  let link;
  try { link = new URL(item.workspace, 'http://workspace.invalid'); }
  catch (_) { fail('WORKSPACE_QUEUE_LINK_INVALID', 'queue obligation workspace link is malformed'); }
  const expected = { run: context.runId, agent: context.agentId, task: context.record.task_id, invocation: context.invocationId };
  for (const [key, value] of Object.entries(expected)) {
    if (link.searchParams.get(key) !== value) fail('WORKSPACE_QUEUE_LINK_INVALID', `queue obligation workspace link has a mismatched ${key}`);
  }
}

function decisionQueueProjection(root, registry, context, artifact, options = {}) {
  let queue;
  if (options.decisionQueueProjection) queue = options.decisionQueueProjection;
  else {
    queue = decisionQueue.buildDecisionQueue(root, registry, options.decisionQueueOptions || {});
  }
  const queueAvailable = queue?.available !== false && queue?.status !== 'INVALID';
  const active = Array.isArray(queue?.human_decision_queue) ? queue.human_decision_queue : [];
  const history = Array.isArray(queue?.human_decision_history) ? queue.human_decision_history : [];
  const obligations = queueAvailable ? active.filter((item) => item.state === 'ACTIVE'
    && ['REVIEW', 'DECISION'].includes(item.attention)
    && exactObligationContext(item, context, artifact)) : [];
  if (obligations.length > 1) fail('WORKSPACE_QUEUE_BINDING_AMBIGUOUS', 'more than one active obligation claims the exact workspace context');
  obligations.forEach((item) => assertExactWorkspaceLink(item, context));
  const historical = history.filter((item) => ['RESOLVED', 'SUPERSEDED', 'STALE', 'INVALID'].includes(item.state)
    && exactObligationContext(item, context, artifact));
  const exact = obligations[0] || historical[historical.length - 1] || null;
  const diagnostics = Array.isArray(queue?.diagnostics)
    ? queue.diagnostics.filter((item) => !item?.run_id || item.run_id === context.runId)
    : [];
  return {
    obligations: obligations.map((item) => {
      const rationale = operationalRationale.normalizeOperationalRationale(item.operational_rationale);
      if (!rationale) fail('WORKSPACE_DECISION_RATIONALE_INVALID', 'exact REVIEW/DECISION obligation lacks bounded operational rationale');
      return {
        queue_item_id: item.queue_item_id, attention: item.attention, reason: boundedText(item.reason), blocker: boundedText(item.blocker),
        owning_gate: item.owning_gate, approval_scope_required: item.approval_scope_required,
        operational_rationale: rationale,
        hermes_orchestration: {
          state: item.handoff?.next_owner === 'hermes' ? 'AWAITING_HERMES' : item.resolution?.state || 'NOT_REQUIRED',
          blocker: boundedText(item.blocker), resume_condition: boundedText(item.resolution?.resume_condition || item.handoff?.next_action),
        },
        workspace: item.workspace || null,
      };
    }),
    binding: {
      status: !queueAvailable ? 'UNAVAILABLE' : obligations.length ? 'VERIFIED' : historical.length ? 'HISTORICAL' : 'NOT_BOUND',
      queue_available: queueAvailable,
      obligation_id: exact?.queue_item_id || exact?.obligation_id || null,
      obligation_state: exact?.state || null,
      diagnostic_codes: diagnostics.map((item) => item.code).filter(Boolean),
    },
    diagnostics,
  };
}

function capabilityFromPreview(previewFn, input, options, defaultReason) {
  try {
    const preview = previewFn({ ...input, reason: 'Read-only workspace capability projection.' }, options);
    return { allowed: preview.eligible === true, reason: preview.eligible === true ? null : preview.blocked_reason || preview.support || defaultReason };
  } catch (error) {
    return { allowed: false, reason: error.code || defaultReason };
  }
}

function ownershipProjection(context, options = {}) {
  let state;
  try { state = executionOwnership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id }); }
  catch (error) { fail(error.code || 'WORKSPACE_OWNERSHIP_INVALID', error.message); }
  const controlInput = { run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId };
  const manual = agentControls.manualControlEligibility(controlInput, { root: context.root });
  const retry = capabilityFromPreview(agentControls.previewRetry, controlInput, { root: context.root }, 'RETRY_NOT_ELIGIBLE');
  const cancel = capabilityFromPreview(agentControls.previewCancel, controlInput, { root: context.root, cancelProvider: options.cancelProvider }, 'CANCELLATION_PROVIDER_NOT_SUPPORTED');
  const successorPolicy = successorTaskContract.successorAdapterPolicy(context.agentId);
  const latestSuccessorTransition = Array.isArray(state.history)
    ? state.history.slice().reverse().find((entry) => entry.successor?.task_id)
    : null;
  const resumption = context.task?.resumption_context || null;
  let resumptionContract = null;
  if (resumption) {
    try { resumptionContract = successorTaskContract.assertRunnableSuccessor(context.root, context.agentId, context.task, context.taskBytes); }
    catch (error) { fail(error.code || 'WORKSPACE_SUCCESSOR_CONTRACT_INVALID', error.message); }
  }
  return {
    current_owner: state.current_owner, revision: state.revision, state_hash: state.current_state_hash || null,
    capabilities: {
      take_manual_control: { allowed: manual.take_manual_control === true, reason: manual.take_manual_control ? null : manual.reason || 'NOT_ELIGIBLE' },
      return_to_automation: { allowed: manual.return_to_automation === true, reason: manual.return_to_automation ? null : manual.reason || 'NOT_ELIGIBLE' },
      retry,
      cancel,
    },
    manual_artifact: state.current_owner === 'HUMAN' && manual.manual_artifact ? {
      artifact_id: manual.manual_artifact.artifact_id, reference: manual.manual_artifact.path, sha256: manual.manual_artifact.sha256,
      trusted_handoff: manual.manual_artifact.workspace || {
        kind: 'TRUSTED_OS_FILE_REVEAL', method: 'POST', endpoint: '/api/package-runs/open-file',
        reference: manual.manual_artifact.path, write_api: null,
      },
    } : null,
    predecessor_task_id: resumption?.predecessor_task_id || context.invocation?.predecessor_task_id || null,
    successor_task_id: resumption ? context.record.task_id : latestSuccessorTransition?.successor?.task_id || null,
    stale_approvals: resumptionContract?.approvals_invalidated || [],
    stale_gates: resumptionContract?.gates_invalidated || [],
    successor_capability: {
      available: Boolean(successorPolicy), adapter_id: successorPolicy?.adapter_id || null,
      artifact_id: successorPolicy?.artifact_id || null, required_next_gate: successorPolicy?.required_next_gate || null,
      required_next_specialist: successorPolicy?.required_next_specialist || null,
      continuation_action: successorPolicy?.continuation_action || null,
    },
  };
}

function resourceProjection(context, result, snapshot) {
  let binding = null;
  try { binding = cancellationAdapters.readBinding(context); } catch (_) { binding = null; }
  const provider = binding?.provider_id || null;
  const jobSnapshot = provider && snapshot?.jobs ? snapshot.jobs[provider] : null;
  const active = jobSnapshot?.active && typeof jobSnapshot.active === 'object' ? jobSnapshot.active : null;
  const observedJobId = active?.job_id || active?.id || active?.packageId || active?.package_id || null;
  const exactLiveJob = Boolean(binding && observedJobId === binding.job_id);
  const compute = snapshot?.compute || null;
  const explicitHealth = compute?.ok === true ? 'AVAILABLE' : compute?.ok === false ? 'UNAVAILABLE' : UNKNOWN;
  return {
    lane: result.route?.lane || context.task?.lane || context.task?.execution?.lane || UNKNOWN,
    model: result.route?.model || context.task?.model || context.task?.execution?.model || UNKNOWN,
    host: binding?.host || result.route?.host || context.lock?.host || UNKNOWN,
    worker: (exactLiveJob && (active.worker || active.host)) || binding?.host || UNKNOWN,
    job_id: binding?.job_id || UNKNOWN,
    job_state: exactLiveJob ? 'RUNNING' : binding ? UNKNOWN : 'NOT_BOUND',
    health: snapshot ? explicitHealth : UNKNOWN,
    telemetry_source: snapshot?.source || 'INVOCATION_EVIDENCE_ONLY',
    probed_at: snapshot?.probed_at || null,
  };
}

async function buildVisualPlanningWorkspace(request, options = {}) {
  assertRequestedVersion(request);
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const context = exactContext(root, request);
  const artifact = exactArtifact(context, request);
  const resultRecord = exactResult(context, artifact.value);
  const result = resultRecord.value;
  const { registry, registration } = registryTruth(context);
  const validation = visualPlan.validatePlan(artifact.value, { currentStory: context.task.story || artifact.value.story });
  if (!validation.structurally_valid) fail('WORKSPACE_VISUAL_PLAN_INVALID', 'canonical Visual Plan failed structural validation');
  const queue = decisionQueueProjection(root, registry, context, artifact, options);
  const ownership = ownershipProjection(context, options);
  const snapshot = options.liveResourceProvider ? await options.liveResourceProvider([{
    agent_id: context.agentId, runtime_active: context.runtime_status === 'RUNNING',
    lane: result.route?.lane || context.task?.lane || null,
    resource_dependency: context.task?.resource_dependency || null,
  }]) : null;
  const artifactReference = path.relative(root, artifact.artifactPath);
  const payload = {
    workspace_schema_version: WORKSPACE_SCHEMA_VERSION,
    workspace_schema_id: WORKSPACE_SCHEMA_ID,
    schema_version: WORKSPACE_SCHEMA_VERSION,
    workspace_type: 'VISUAL_PLANNING_WORKSPACE_V1',
    read_only: true,
    context: {
      run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id, invocation_id: context.invocationId,
      runtime_state: context.runtime_status, semantic_state: context.invocation.semantic_state || result.state || UNKNOWN,
      lifecycle: registration.lifecycle, implementation_state: registration.implementation_state || registration.lifecycle?.implementation_state || null,
    },
    visual_plan: {
      artifact_id: ARTIFACT_ID, artifact_reference: artifactReference, sha256: artifact.sha256,
      plan_id: artifact.value.plan_id, plan_revision: artifact.value.plan_revision, plan_digest_sha256: artifact.value.plan_digest_sha256,
      story_dependency: {
        project_id: artifact.value.story?.project_id || null, version_id: artifact.value.story?.version_id || null,
        content_hash: artifact.value.story?.content_hash || null,
        freshness_state: context.task?.story?.version_id === artifact.value.story?.version_id
          && context.task?.story?.content_hash === artifact.value.story?.content_hash ? 'CURRENT' : 'UNKNOWN',
      },
      approval_state: result.authority?.approval || { state: 'INVALID', valid: false, reason_codes: ['PLAN_APPROVAL_MISSING'] },
      gate_state: { gate: APPROVAL_SCOPE, state: result.authority?.state || artifact.value.lifecycle_state || UNKNOWN, authorization_ok: result.authority?.authorization_ok === true },
      coverage: buildCoverage(artifact.value, validation),
      shots: buildShots(artifact.value, result),
    },
    human_attention: queue.obligations,
    queue_binding: queue.binding,
    decision_queue_diagnostics: queue.diagnostics,
    ownership,
    resource_tool: resourceProjection(context, result, snapshot),
    links: {
      control_room: `/api/agent-control-room`,
      takeover_preview: '/api/agent-control-room/take-manual-control/preview',
      takeover_apply: '/api/agent-control-room/take-manual-control/apply',
      return_preview: '/api/agent-control-room/return-to-automation/preview',
      return_apply: '/api/agent-control-room/return-to-automation/apply',
      manual_artifact_read: ownership.manual_artifact ? '/api/agent-control-room/manual-artifact' : null,
    },
  };
  try { return workspaceContract.assertWorkspaceV1(payload); }
  catch (error) { fail(error.code || 'WORKSPACE_CONTRACT_INVALID', error.message, error.statusCode || 409); }
}

module.exports = {
  WORKSPACE_SCHEMA_VERSION, WORKSPACE_SCHEMA_ID, WORKSPACE_STABLE_FIELDS,
  AGENT_ID, ARTIFACT_ID, APPROVAL_SCOPE, UNKNOWN,
  VisualPlanningWorkspaceError, exactContext, exactArtifact, exactResult,
  assertRequestedVersion, decisionQueueProjection, resourceProjection, buildVisualPlanningWorkspace,
};
