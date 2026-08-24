'use strict';

// Visual Planning Workspace V1 bounded edit normalization. The operator may
// propose only named creative values. IDs, lineage, prompt bindings, digests,
// timestamps and artifact hashes are derived here and are never client
// authority.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const agentControls = require('./agent-controls.js');
const ownership = require('./execution-ownership.js');
const ledger = require('./operator-action-ledger.js');
const runner = require('./agent-run.js');
const successor = require('./successor-task-contract.js');
const visualPlan = require('./visual-plan.js');
const promptAdapter = require('./visual-plan-prompt-adapter.js');

const AGENT_ID = 'visual_planning_director';
const ACTION = 'EDIT_MANUAL_ARTIFACT';
const SCHEMA_VERSION = 1;
const EDITABLE_SHOT_FIELDS = Object.freeze(['shot_brief', 'narrative_function', 'edit_placement', 'priority', 'continuity_notes']);
const SEMANTIC_SHOT_FIELDS = Object.freeze(['shot_brief', 'narrative_function']);
const SYSTEM_MAINTAINED_FIELDS = Object.freeze([
  'plan_id', 'plan_revision', 'supersedes', 'created_at', 'created_by', 'plan_digest_sha256',
  'shot_id', 'prompt_id', 'prompt_revision', 'shot_intent_digest_sha256', 'artifact_sha256',
  'story', 'required_beats', 'coverage bindings', 'research_refs', 'approval bindings', 'ownership',
]);
const HASH_RE = /^[a-f0-9]{64}$/;
const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

class VisualPlanningManualEditError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = 'VisualPlanningManualEditError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value, allowed, label) {
  if (!plain(value)) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PATCH_INVALID', `${label} must be an object`, 400);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_FIELD_FORBIDDEN', `${label}.${key} is not human-editable`, 400);
    }
  }
}

function boundedText(value, field, max) {
  if (typeof value !== 'string') throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_VALUE_INVALID', `${field} must be text`, 400);
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized || normalized.length > max) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_VALUE_INVALID', `${field} must contain 1-${max} characters`, 400);
  return normalized;
}

function normalizedSet(value) {
  exactKeys(value, EDITABLE_SHOT_FIELDS, 'creative_patch.shot_edits[].set');
  if (!Object.keys(value).length) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PATCH_INVALID', 'shot edit set is empty', 400);
  const out = {};
  if (Object.prototype.hasOwnProperty.call(value, 'shot_brief')) out.shot_brief = boundedText(value.shot_brief, 'shot_brief', 4000);
  if (Object.prototype.hasOwnProperty.call(value, 'narrative_function')) out.narrative_function = boundedText(value.narrative_function, 'narrative_function', 2000);
  if (Object.prototype.hasOwnProperty.call(value, 'edit_placement')) out.edit_placement = boundedText(value.edit_placement, 'edit_placement', 1000);
  if (Object.prototype.hasOwnProperty.call(value, 'priority')) {
    if (!PRIORITIES.has(value.priority)) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_VALUE_INVALID', 'priority is outside the canonical vocabulary', 400);
    out.priority = value.priority;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'continuity_notes')) {
    if (!Array.isArray(value.continuity_notes) || value.continuity_notes.length > 20) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_VALUE_INVALID', 'continuity_notes must contain at most 20 bounded notes', 400);
    out.continuity_notes = value.continuity_notes.map((note) => boundedText(note, 'continuity_notes[]', 1000));
  }
  return out;
}

function normalizePatch(value) {
  exactKeys(value, ['shot_edits'], 'creative_patch');
  if (!Array.isArray(value.shot_edits) || !value.shot_edits.length || value.shot_edits.length > 50) {
    throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PATCH_INVALID', 'creative_patch.shot_edits must contain 1-50 edits', 400);
  }
  const seen = new Set();
  return { shot_edits: value.shot_edits.map((edit, index) => {
    exactKeys(edit, ['shot_ref', 'set'], `creative_patch.shot_edits[${index}]`);
    if (typeof edit.shot_ref !== 'string' || !/^shot-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(edit.shot_ref) || seen.has(edit.shot_ref)) {
      throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_TARGET_INVALID', 'each shot_ref must identify one unique canonical shot', 400);
    }
    seen.add(edit.shot_ref);
    return { shot_ref: edit.shot_ref, set: normalizedSet(edit.set) };
  }) };
}

function readPredecessor(context, manual) {
  const binding = context.invocation?.artifacts?.find((item) => item.field === manual.metadata.artifact_id);
  if (!binding) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREDECESSOR_INVALID', 'predecessor Visual Plan binding is missing');
  const file = path.resolve(context.directory, binding.path);
  const relative = path.relative(context.directory, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(file)) {
    throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREDECESSOR_INVALID', 'predecessor Visual Plan path is unavailable');
  }
  const bytes = fs.readFileSync(file);
  if (runner.sha256(bytes) !== binding.sha256 || binding.sha256 !== manual.metadata.source_artifact_sha256) {
    throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREDECESSOR_STALE', 'predecessor Visual Plan no longer matches immutable invocation evidence');
  }
  let value;
  try { value = JSON.parse(bytes); } catch (_) { throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREDECESSOR_INVALID', 'predecessor Visual Plan is malformed'); }
  return { binding, file, bytes, value };
}

function replaceShotReference(plan, oldId, newId) {
  for (const coverage of plan.coverage || []) coverage.shot_ids = (coverage.shot_ids || []).map((id) => id === oldId ? newId : id);
  for (const prompt of plan.prompts || []) if (prompt.shot_id === oldId) prompt.shot_id = newId;
}

function deterministicShotId(nowMs, seed) {
  const timePrefix = visualPlan.ulid(nowMs).slice(0, 10);
  const bytes = crypto.createHash('sha256').update(seed).digest();
  let entropy = '';
  for (let index = 0; index < 16; index += 1) entropy += ULID_ALPHABET[bytes[index] % 32];
  return `shot-${timePrefix}${entropy}`;
}

function regeneratePrompt(plan, shot, priorPromptById) {
  for (const promptId of shot.prompt_refs || []) {
    const prompt = (plan.prompts || []).find((item) => item.prompt_id === promptId);
    if (!prompt) continue;
    const prior = priorPromptById.get(promptId);
    prompt.shot_id = shot.shot_id;
    prompt.prompt_revision = Math.max(Number(prompt.prompt_revision || 0), Number(prior?.prompt_revision || 0)) + 1;
    prompt.shot_intent_digest_sha256 = visualPlan.shotIntentDigest(shot);
    prompt.prompt_text = promptAdapter.promptTextFor(shot);
    prompt.prompt_type = promptAdapter.promptTypeFor(shot);
    prompt.created_by = 'visual-planning-workspace-manual-edit';
  }
}

function derivePlan(predecessor, current, patch, options = {}) {
  const next = structuredClone(current);
  const predecessorShots = new Map(predecessor.shots.map((shot) => [shot.shot_id, shot]));
  const predecessorPrompts = new Map(predecessor.prompts.map((prompt) => [prompt.prompt_id, prompt]));
  const changes = [];
  const regenerated = new Set(['plan_revision', 'supersedes', 'created_at', 'created_by', 'plan_digest_sha256', 'artifact_sha256']);
  for (const edit of patch.shot_edits) {
    const shot = next.shots.find((item) => item.shot_id === edit.shot_ref);
    if (!shot) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_TARGET_INVALID', `shot_ref ${edit.shot_ref} is not in the current manual Visual Plan`, 400);
    const oldId = shot.shot_id;
    for (const [field, after] of Object.entries(edit.set)) {
      const before = structuredClone(shot[field]);
      if (visualPlan.canonicalize(before) === visualPlan.canonicalize(after)) continue;
      shot[field] = structuredClone(after);
      changes.push({ shot_ref: oldId, field, before, after: structuredClone(after) });
    }
    if (!changes.some((change) => change.shot_ref === oldId && SEMANTIC_SHOT_FIELDS.includes(change.field))) continue;
    const prior = predecessorShots.get(oldId);
    if (prior && visualPlan.shotIntentDigest(prior) !== visualPlan.shotIntentDigest(shot)) {
      const identitySeed = ledger.canonicalize({ plan_id: predecessor.plan_id, predecessor_digest: predecessor.plan_digest_sha256,
        old_shot_id: oldId, creative_set: edit.set, created_at: options.createdAt });
      const newId = (options.newShotId || deterministicShotId)(options.nowMs, identitySeed);
      shot.shot_id = newId;
      replaceShotReference(next, oldId, newId);
      regenerated.add('shot_id');
    }
    regeneratePrompt(next, shot, predecessorPrompts);
    if ((shot.prompt_refs || []).length) {
      regenerated.add('prompt_revision');
      regenerated.add('prompt_text');
      regenerated.add('shot_intent_digest_sha256');
    }
  }
  if (!changes.length) return { no_op: true, plan: current, changes: [], regenerated: [] };
  next.plan_id = predecessor.plan_id;
  next.plan_revision = predecessor.plan_revision + 1;
  next.supersedes = { plan_revision: predecessor.plan_revision, plan_digest_sha256: predecessor.plan_digest_sha256 };
  next.created_at = options.createdAt || new Date().toISOString();
  next.created_by = 'visual-planning-workspace-manual-edit';
  next.lifecycle_state = 'AWAITING_HUMAN_REVIEW';
  next.plan_digest_sha256 = visualPlan.planDigest(next);
  return { no_op: false, plan: next, changes, regenerated: [...regenerated].sort() };
}

function previewToken(context, owner, manual, patch, proposedSha, createdAt, reason, ledgerHead) {
  return runner.sha256(Buffer.from(ledger.canonicalize({
    action: ACTION, run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id,
    invocation_id: context.invocationId, task_sha256: runner.sha256(context.taskBytes), reason,
    ownership_revision: owner.revision, ownership_state_hash: owner.current_state_hash,
    current_artifact_sha256: manual.sha256, proposed_artifact_sha256: proposedSha,
    creative_patch: patch, preview_created_at: createdAt, ledger_head: ledgerHead,
  })));
}

function normalizeReason(value) {
  if (typeof value !== 'string') throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_REASON_REQUIRED', 'a bounded operator reason is required', 400);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 600) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_REASON_REQUIRED', 'a bounded operator reason is required', 400);
  return normalized;
}

async function previewVisualPlanManualEdit(input, options = {}) {
  const context = agentControls.locateInvocation(options.root, input);
  if (context.agentId !== AGENT_ID) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_SPECIALIST_UNSUPPORTED', 'bounded Visual Plan editing is available only for Visual Planning Director', 403);
  if (input.task_id !== context.record.task_id) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_TARGET_INVALID', 'task identity does not match the exact invocation', 400);
  const owner = ownership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  if (owner.current_owner !== 'HUMAN') throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_REQUIRES_HUMAN_OWNERSHIP', `current execution owner is ${owner.current_owner}`);
  if (input.expected_ownership_revision !== owner.revision) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREVIEW_STALE', 'ownership revision changed since the edit form loaded');
  if (!HASH_RE.test(input.expected_artifact_sha256 || '')) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_ARTIFACT_HASH_REQUIRED', 'exact current manual artifact hash is required', 400);
  const manual = successor.readManualArtifact(context);
  if (manual.sha256 !== input.expected_artifact_sha256) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREVIEW_STALE', 'manual artifact bytes changed since the edit form loaded');
  const normalizedReason = normalizeReason(input.reason);
  const patch = normalizePatch(input.creative_patch);
  const predecessor = readPredecessor(context, manual);
  const baseValidation = visualPlan.validatePlan(manual.value, { currentStory: context.task.story });
  const isOriginal = manual.sha256 === manual.metadata.source_artifact_sha256;
  const baseLineage = isOriginal ? { valid: true, reason_codes: [] } : visualPlan.validateSuccessorPlan(predecessor.value, manual.value);
  if (!baseValidation.ok || !baseLineage.valid) {
    throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_BASE_INVALID', `current manual Visual Plan is not a valid editable base: ${[...baseValidation.reason_codes, ...baseLineage.reason_codes].join(', ')}`);
  }
  if (input.preview_created_at !== undefined && options.allowPreviewReplay !== true) {
    throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_FIELD_FORBIDDEN', 'preview_created_at is server-issued and may only be round-tripped to apply', 400);
  }
  const createdAt = options.allowPreviewReplay ? input.preview_created_at : options.now || new Date().toISOString();
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREVIEW_STALE', 'server-issued edit preview timestamp is invalid');
  }
  const derived = derivePlan(predecessor.value, manual.value, patch, { createdAt, nowMs: Date.parse(createdAt), newShotId: options.newShotId });
  if (derived.no_op) return {
    schema_version: SCHEMA_VERSION, action: ACTION, read_only: true, eligible: false, no_op: true,
    target: { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id, invocation_id: context.invocationId },
    current_artifact: { sha256: manual.sha256, plan_id: manual.value.plan_id, plan_revision: manual.value.plan_revision },
    creative_changes: [], system_regenerated: [], changes_approval: false, preview_created_at: createdAt, preview_token: null,
  };
  const proposedBytes = Buffer.from(`${JSON.stringify(derived.plan, null, 2)}\n`);
  const proposed = { ...manual, value: derived.plan, bytes: proposedBytes, sha256: runner.sha256(proposedBytes) };
  let proposal;
  try {
    proposal = successor.buildProposal(context, owner, proposed, { ...(options.successorValidation || {}), createdAt, reason: normalizedReason });
  } catch (error) {
    throw new VisualPlanningManualEditError(error.code || 'VISUAL_PLAN_EDIT_VALIDATION_FAILED', error.message, error.statusCode || 409);
  }
  const currentLedger = ledger.readLedger(context.root, context.runId);
  const eligible = proposal.eligible === true;
  return {
    schema_version: SCHEMA_VERSION, action: ACTION, read_only: true, eligible, no_op: false,
    target: { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id, invocation_id: context.invocationId },
    current_artifact: { sha256: manual.sha256, plan_id: manual.value.plan_id, plan_revision: manual.value.plan_revision },
    proposed_artifact: { sha256: proposed.sha256, plan_id: derived.plan.plan_id, plan_revision: derived.plan.plan_revision, plan_digest_sha256: derived.plan.plan_digest_sha256 },
    proposed_visual_plan: derived.plan,
    creative_changes: derived.changes,
    system_regenerated: derived.regenerated,
    validation: proposal.validation,
    stale_consequences: { scopes: proposal.validation.approvals_invalidated || [], gates: proposal.validation.gates_invalidated || [] },
    changes_approval: false,
    preview_created_at: createdAt,
    preview_token: eligible ? previewToken(context, owner, manual, patch, proposed.sha256, createdAt, normalizedReason, currentLedger.head_hash) : null,
  };
}

function editLockPath(manual) { return `${manual.paths.artifactPath}.edit.lock`; }
function acquireEditLock(file) {
  try { fs.closeSync(fs.openSync(file, 'wx', 0o600)); }
  catch (error) {
    if (error.code === 'EEXIST') throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_BUSY', 'another bounded Visual Plan edit is applying');
    throw error;
  }
}

async function applyVisualPlanManualEdit(input, options = {}) {
  const initialContext = agentControls.locateInvocation(options.root, input);
  const initialManual = successor.readManualArtifact(initialContext);
  const lock = editLockPath(initialManual);
  acquireEditLock(lock);
  try {
    const preview = await previewVisualPlanManualEdit(input, { ...options, allowPreviewReplay: true });
    if (!preview.eligible || preview.no_op) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_NOT_ELIGIBLE', 'bounded edit preview is not eligible');
    if (input.preview_token !== preview.preview_token || input.preview_created_at !== preview.preview_created_at) {
      throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREVIEW_STALE', 'bounded edit preview is missing or stale');
    }
    const context = agentControls.locateInvocation(options.root, input);
    const manual = successor.readManualArtifact(context);
    const nextBytes = Buffer.from(`${JSON.stringify(preview.proposed_visual_plan, null, 2)}\n`);
    if (runner.sha256(nextBytes) !== preview.proposed_artifact.sha256) throw new VisualPlanningManualEditError('VISUAL_PLAN_EDIT_PREVIEW_STALE', 'proposed bytes do not match the preview');
    const previousBytes = manual.bytes;
    successor.atomicWrite(manual.paths.artifactPath, nextBytes);
    let mutation;
    try {
      const owner = ownership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
      mutation = ownership.recordHumanOwnedMutation(context.root, {
        run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id,
        expected_revision: owner.revision, expected_state_hash: owner.current_state_hash,
        originating_invocation_id: context.invocationId, artifact_id: manual.metadata.artifact_id,
        predecessor_artifact_sha256: preview.current_artifact.sha256, resulting_artifact_sha256: preview.proposed_artifact.sha256,
        task_sha256: runner.sha256(context.taskBytes), reason: input.reason,
        requested_parameters: { preview_token: input.preview_token, preview_created_at: input.preview_created_at, creative_patch_sha256: runner.sha256(Buffer.from(ledger.canonicalize(normalizePatch(input.creative_patch)))), proposed_artifact_sha256: preview.proposed_artifact.sha256 },
        result_details: { creative_changes: preview.creative_changes, system_regenerated: preview.system_regenerated, resulting_artifact_sha256: preview.proposed_artifact.sha256, stale_scopes: preview.stale_consequences.scopes, stale_gates: preview.stale_consequences.gates },
      }, { actor: options.actor || ledger.localActorContext(), now: options.applyNow || options.now, recordId: options.recordId });
    } catch (error) {
      successor.atomicWrite(manual.paths.artifactPath, previousBytes);
      throw error;
    }
    return {
      schema_version: SCHEMA_VERSION, action: ACTION, result_status: 'COMPLETED', action_record_id: mutation.action_record.record_id,
      execution_owner: 'HUMAN', ownership_revision: mutation.state.revision, ownership_state_hash: mutation.state.current_state_hash,
      artifact_sha256: preview.proposed_artifact.sha256, plan_id: preview.proposed_artifact.plan_id,
      plan_revision: preview.proposed_artifact.plan_revision, plan_digest_sha256: preview.proposed_artifact.plan_digest_sha256,
      creative_changes: preview.creative_changes, system_regenerated: preview.system_regenerated,
      stale_consequences: preview.stale_consequences, return_to_automation_required: true, changes_approval: false,
    };
  } finally {
    try { fs.unlinkSync(lock); } catch (_) { /* next apply will fail closed if a live lock remains */ }
  }
}

module.exports = {
  AGENT_ID, ACTION, SCHEMA_VERSION, EDITABLE_SHOT_FIELDS, SEMANTIC_SHOT_FIELDS, SYSTEM_MAINTAINED_FIELDS,
  VisualPlanningManualEditError, normalizePatch, deterministicShotId, derivePlan, previewVisualPlanManualEdit, applyVisualPlanManualEdit,
};
