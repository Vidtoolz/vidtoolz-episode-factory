'use strict';

const path = require('node:path');
const ledger = require('./operator-action-ledger.js');
const storyReview = require('./story-revision-review.js');
const assertions = require('./story-assertion-continuity.js');

const AGENT_ID = 'story_editor';
const VALIDATOR_ID = 'STORY_EDITOR_SUCCESSOR_V1';
const ARTIFACT_ID = 'story_candidate';
const REQUIRED_NEXT_GATE = 'PLAN_SCRIPT_APPROVAL';
const REQUIRED_NEXT_SPECIALIST = AGENT_ID;
const CONTINUATION_ACTION = 'review_successor';
const POLICY_ID = 'PROVEN_SPECIALIST_SUCCESSOR_ADAPTERS_V2';

function versionsFor(task) {
  const root = path.resolve(task.script_builder_root || '/home/vidtoolz/vidtoolz-script-builder');
  return require(path.join(root, 'lib', 'versions.js'));
}

function versionArtifact(version, task, bindings = task.script_claim_bindings || []) {
  return {
    schema_version: 1,
    artifact_type: 'story-script-version',
    project_id: version.project_id,
    version_id: version.id,
    parent_version: version.parent_version || null,
    content_hash: version.content_hash,
    central_claim: version.central_claim == null ? null : String(version.central_claim),
    narrative_spine: version.narrative_spine == null ? null : String(version.narrative_spine),
    sections: structuredClone(version.sections || []),
    approval: structuredClone(version.approval || { state: 'none', at: null, note: null }),
    research: {
      bindings: structuredClone(bindings || []),
      result_refs: structuredClone(task.research_result_refs || []),
      run_dir: task.research?.run_dir || null,
      as_of: task.research?.asOf || null,
    },
  };
}

function validateShape(value) {
  const reasons = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) reasons.push('STORY_ARTIFACT_OBJECT_REQUIRED');
  else {
    if (value.schema_version !== 1) reasons.push('STORY_ARTIFACT_SCHEMA_VERSION_INVALID');
    if (value.artifact_type !== 'story-script-version') reasons.push('STORY_ARTIFACT_TYPE_INVALID');
    for (const field of ['project_id', 'version_id', 'content_hash']) if (typeof value[field] !== 'string' || !value[field]) reasons.push(`STORY_${field.toUpperCase()}_INVALID`);
    if (!Array.isArray(value.sections) || !value.sections.length) reasons.push('STORY_SECTIONS_REQUIRED');
    for (const [index, section] of (Array.isArray(value.sections) ? value.sections : []).entries()) {
      if (!section || typeof section !== 'object' || Array.isArray(section)
          || typeof section.id !== 'string' || !section.id
          || !Number.isInteger(section.order) || section.order < 1
          || typeof section.dialogue !== 'string') reasons.push(`STORY_SECTION_${index}_INVALID`);
    }
    if (!value.research || typeof value.research !== 'object' || Array.isArray(value.research)
        || !Array.isArray(value.research.bindings) || !Array.isArray(value.research.result_refs)) reasons.push('STORY_RESEARCH_BINDING_SHAPE_INVALID');
  }
  return { ok: reasons.length === 0, reason_codes: reasons };
}

function changedSectionIds(before, after) {
  const projection = (section) => ledger.canonicalize(section);
  const first = new Map((before.sections || []).map((section) => [String(section.id), projection(section)]));
  const second = new Map((after.sections || []).map((section) => [String(section.id), projection(section)]));
  return [...new Set([...first.keys(), ...second.keys()].filter((id) => first.get(id) !== second.get(id)))];
}

function carryResearchBindings(previous, next) {
  const previousSections = new Map((previous.sections || []).map((section) => [String(section.id), String(section.dialogue || '')]));
  const nextSections = new Map((next.sections || []).map((section) => [String(section.id), String(section.dialogue || '')]));
  const carried = [], invalidated = [];
  for (const binding of previous.research?.bindings || []) {
    const sectionId = String(binding.section_id);
    const before = previousSections.get(sectionId);
    const after = nextSections.get(sectionId);
    const continuity = typeof before === 'string' && typeof after === 'string'
      ? assertions.assertionContinuity(before, after, binding.assertion_text) : { retained: false };
    if (continuity.retained) carried.push(structuredClone(binding));
    else invalidated.push(binding.binding_id || null);
  }
  return { carried, invalidated: invalidated.filter(Boolean) };
}

function potentialUnsupportedAssertions(previous, next, retainedBindings = []) {
  const before = new Map((previous.sections || []).map((section) => [String(section.id), new Set(assertions.sentenceUnits(section.dialogue))]));
  const boundUnits = new Set();
  const nextSections = new Map((next.sections || []).map((section) => [String(section.id), String(section.dialogue || '')]));
  for (const binding of retainedBindings) {
    const units = assertions.containingUnits(nextSections.get(String(binding.section_id)), binding.assertion_text);
    if (units.length === 1) boundUnits.add(`${binding.section_id}|${units[0]}`);
  }
  const factualSignal = /(?:\b\d+(?:[.,]\d+)?\s*%|[$€£]\s*\d|\b(?:benchmark|study|research|report|data|evidence)\s+(?:shows?|finds?|found|says?)\b|\b(?:faster|slower|cheaper|costlier|higher|lower|outperforms?|increases?|decreases?|reduces?|improves?|prevents?|requires?|supports?)\b)/iu;
  const unsupported = [];
  for (const section of next.sections || []) {
    const prior = before.get(String(section.id)) || new Set();
    for (const unit of assertions.sentenceUnits(section.dialogue)) {
      if (!prior.has(unit) && factualSignal.test(unit) && !boundUnits.has(`${section.id}|${unit}`)) {
        unsupported.push({ section_id: section.id, assertion_text: unit, classification: 'POTENTIAL_FACTUAL_ASSERTION' });
      }
    }
  }
  return unsupported;
}

function currentManualArtifact(context, metadata) {
  const versions = versionsFor(context.task);
  const list = versions.listVersions(context.task.data_root, context.task.project_id);
  const current = list.at(-1);
  if (!current) { const error = new Error('canonical Script Builder has no current version'); error.code = 'SUCCESSOR_UPSTREAM_DEPENDENCY_UNAVAILABLE'; throw error; }
  const previous = JSON.parse(require('node:fs').readFileSync(path.join(context.root, 'package-runs', context.runId, 'agents', 'manual-work', context.agentId, context.record.task_id, 'artifact.json'), 'utf8'));
  const previousShape = validateShape(previous);
  if (!previousShape.ok) { const error = new Error(`manual Story artifact is structurally invalid: ${previousShape.reason_codes.join(', ')}`); error.code = 'SUCCESSOR_ARTIFACT_SCHEMA_INVALID'; throw error; }
  if (current.id !== previous.version_id && current.parent_version !== previous.version_id) {
    const error = new Error('current Script Builder version is not the predecessor or its direct immutable successor'); error.code = 'SUCCESSOR_LINEAGE_INVALID'; throw error;
  }
  const bindings = current.id === previous.version_id ? previous.research.bindings : carryResearchBindings(previous, current).carried;
  const value = versionArtifact(current, context.task, bindings);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return {
    value, bytes, sha256: require('./agent-run.js').sha256(bytes),
    relative_path: current._file || `script-builder://${current.project_id}/${current.id}`,
    workspace: {
      kind: 'SCRIPT_BUILDER', project_id: current.project_id, version_id: current.id,
      path: current._file || null, url: 'http://127.0.0.1:8030/',
      instruction: `Open Script Builder project ${current.project_id}, edit the working script, then Snapshot version before Return to automation.`,
    },
    metadata,
  };
}

function validate(context, previous, next, options = {}) {
  const reasons = [];
  const shape = validateShape(next);
  if (!shape.ok) reasons.push(...shape.reason_codes);
  if (context.agentId !== AGENT_ID) reasons.push('SPECIALIST_OWNER_MISMATCH');
  if (!shape.ok) return result(false, reasons, null, [], []);
  const previousShape = validateShape(previous);
  if (!previousShape.ok) reasons.push('SUCCESSOR_PREDECESSOR_SCHEMA_INVALID');
  if ((previous.research?.bindings || []).length && !context.task.research?.run_dir) reasons.push('RESEARCH_CONTEXT_MISSING');
  if (context.task.research?.status === 'VERIFIED') {
    try {
      const fs = require('node:fs');
      const resultsBytes = fs.readFileSync(path.join(context.task.research.run_dir, 'research-results.json'));
      const bindingsBytes = fs.readFileSync(path.join(context.task.research.run_dir, 'script-claim-bindings.json'));
      const hash = require('./agent-contract-validator.js').sha256;
      if (hash(resultsBytes) !== context.task.research.research_results_sha256 || hash(bindingsBytes) !== context.task.research.bindings_sha256) reasons.push('STORY_RESEARCH_CONTEXT_HASH_CHANGED');
    } catch { reasons.push('RESEARCH_CONTEXT_MISSING'); }
  }
  if (next.project_id !== previous.project_id || next.project_id !== context.task.project_id) reasons.push('STORY_PROJECT_IDENTITY_MISMATCH');
  if (next.version_id === previous.version_id || next.parent_version !== previous.version_id) reasons.push('STORY_PREDECESSOR_LINEAGE_INVALID');
  let versions, current;
  try {
    versions = versionsFor(context.task);
    current = versions.loadVersion(context.task.data_root, next.project_id, next.version_id);
    const latest = versions.listVersions(context.task.data_root, next.project_id).at(-1);
    if (!latest || latest.id !== next.version_id) reasons.push('UPSTREAM_STORY_HEAD_CHANGED');
    if (versions.scriptContentHash(next.sections) !== next.content_hash || current.content_hash !== next.content_hash) reasons.push('STORY_CONTENT_HASH_INVALID');
    const canonical = versionArtifact(current, context.task, next.research.bindings);
    if (ledger.canonicalize(canonical) !== ledger.canonicalize(next)) reasons.push('STORY_CANONICAL_VERSION_MISMATCH');
  } catch (error) {
    const failure = new Error(`canonical Script Builder dependency is unavailable: ${error.message}`);
    failure.code = 'SUCCESSOR_UPSTREAM_DEPENDENCY_UNAVAILABLE';
    throw failure;
  }
  if (next.approval?.state === 'approved') reasons.push('SUCCESSOR_REQUIRES_FRESH_PLAN_SCRIPT_APPROVAL');
  const bindingImpact = carryResearchBindings(previous, next);
  if (ledger.canonicalize(bindingImpact.carried) !== ledger.canonicalize(next.research.bindings)) reasons.push('STORY_RESEARCH_BINDING_DRIFT');
  if (bindingImpact.invalidated.length) reasons.push('STORY_RESEARCH_REVIEW_REQUIRED');
  const unsupportedAssertions = potentialUnsupportedAssertions(previous, next, bindingImpact.carried);
  if (unsupportedAssertions.length) reasons.push('STORY_NEW_FACTUAL_ASSERTION_UNSUPPORTED');
  let review = null;
  if (!reasons.length) {
    review = storyReview.buildReview({
      script_builder_root: context.task.script_builder_root,
      data_root: context.task.data_root,
      project_id: next.project_id,
      source_version: { version_id: previous.version_id, content_hash: previous.content_hash },
      candidate_version: { version_id: next.version_id, content_hash: next.content_hash },
      change_rationales: [],
      research: context.task.research?.run_dir ? {
        run_dir: context.task.research.run_dir,
        source_bindings_doc: { schema_version: 1, project_id: previous.project_id, script_version_id: previous.version_id, script_content_hash: previous.content_hash, bindings: previous.research.bindings },
        candidate_bindings_doc: { schema_version: 1, project_id: next.project_id, script_version_id: next.version_id, script_content_hash: next.content_hash, bindings: next.research.bindings },
        asOf: context.task.research.asOf,
        human_exception: context.task.research.human_exception,
        current_exception_bytes: context.task.research.current_exception_bytes,
      } : undefined,
    });
    if (review.bundle && options.createdAt) review.bundle.generated_at = options.createdAt;
    if (!review.ok || review.state === 'BLOCKED') reasons.push('STORY_SPECIALIST_VALIDATION_BLOCKED');
    else if (review.state === 'RETURN_TO_RESEARCH') reasons.push('STORY_RESEARCH_REVIEW_REQUIRED');
  }
  return result(reasons.length === 0, reasons, review?.bundle || null, bindingImpact.invalidated, changedSectionIds(previous, next), unsupportedAssertions);
}

function result(valid, reasons, review, invalidatedBindings, changedSections, unsupportedAssertions = []) {
  return {
    valid, validator_id: VALIDATOR_ID, reason_codes: [...new Set(reasons)],
    story_revision_review: review,
    changed_sections: changedSections,
    upstream_dependencies: [{ artifact_type: 'research-bindings', current: valid && !(review?.research_impact?.blocked || []).length }],
    research_bindings_invalidated: invalidatedBindings,
    unsupported_factual_assertions: unsupportedAssertions,
    approvals_invalidated: ['PLAN_SCRIPT_APPROVAL'],
    gates_invalidated: ['PLAN_SCRIPT_APPROVAL'],
    downstream_impacts: [{ specialist: 'visual_planning_director', effect: 'MUST_REEVALUATE_STORY_DEPENDENCY_FRESHNESS' }],
    approvals_still_valid: [], required_next_gate: REQUIRED_NEXT_GATE,
    required_next_specialist: REQUIRED_NEXT_SPECIALIST, continuation_action: CONTINUATION_ACTION,
    reason: valid ? 'Canonical Story successor is structurally valid and bound to the current immutable Script Builder version; fresh script approval remains required.' : `Story successor refused: ${[...new Set(reasons)].join(', ')}`,
  };
}

function buildTask(context, next, successorTaskId, contractPath, artifactSha256) {
  const task = structuredClone(context.task);
  task.task_id = successorTaskId;
  task.assignment = { ...(task.assignment || {}), action: CONTINUATION_ACTION, editorial_goal: 'Review the exact human-edited immutable Story successor; do not approve it.' };
  task.script_version_id = next.version_id;
  task.script_content_hash = next.content_hash;
  task.script_sections = structuredClone(next.sections);
  task.central_claim = next.central_claim;
  task.narrative_spine = next.narrative_spine;
  task.script_claim_bindings = structuredClone(next.research.bindings);
  task.research_result_refs = structuredClone(next.research.result_refs);
  task.resumption_review = { fresh_plan_script_approval_required: true, research_bindings_invalidated: carryResearchBindings(JSON.parse(require('node:fs').readFileSync(path.join(context.root, 'package-runs', context.runId, 'agents', 'manual-work', context.agentId, context.record.task_id, 'artifact.json'), 'utf8')), next).invalidated };
  task.resumption_context = {
    schema_version: 1, contract_type: 'successor-task-resumption', predecessor_task_id: context.record.task_id,
    predecessor_invocation_id: context.invocationId, predecessor_task_sha256: context.invocation.task_sha256,
    artifact_sha256: artifactSha256, validator_id: VALIDATOR_ID, contract_path: contractPath,
  };
  return task;
}

function manualControlDetails(context, artifact) {
  return {
    artifact_path: artifact.relative_path,
    artifact_sha256: artifact.sha256,
    editing_method: 'TRUSTED_SCRIPT_BUILDER_WORKSPACE',
    workspace: artifact.workspace,
    warning: 'Automation is fenced for this exact Story task. Editing or snapshotting a script does not approve it.',
  };
}

module.exports = {
  AGENT_ID, VALIDATOR_ID, ARTIFACT_ID, REQUIRED_NEXT_GATE, REQUIRED_NEXT_SPECIALIST,
  CONTINUATION_ACTION, POLICY_ID, versionArtifact, validateShape, carryResearchBindings, potentialUnsupportedAssertions,
  currentManualArtifact, validate, buildTask, manualControlDetails,
};
