'use strict';

/*
 * agent-task-creative-direction.js — task assembler for creative_director.
 *
 * AUTHORITY REPAIR (2026-08-28): the assembler no longer trusts caller-supplied
 * Story identity. Canonical Story authority is resolved through the SAME
 * mechanism visual planning uses — agent-task-visual-planning.loadCanonicalStory
 * (script-builder-authority root resolution, project existence, CURRENT-HEAD
 * staleness refusal, content-hash recomputation from store sections, human
 * approver verification). One authority; no duplicated Story rules.
 * Caller-supplied identity fields are treated as EXPECTATIONS: any mismatch
 * with the resolved authority is STORY_AUTHORITY_INVALID, never a fallback.
 *
 * Discovery candidates remain legal under their own authority contract:
 * the package must resolve INSIDE the canonical Discovery claim-packages root
 * (realpath containment), be generation-COMPLETE with PASS validations, carry
 * internally consistent fingerprints, and the script hash is recomputed from
 * the package's own beat bytes.
 *
 * CUSTOM human constraints must carry a machine-verifiable protected scope;
 * an unstructured CUSTOM fails the assembly closed
 * (HUMAN_CONSTRAINT_REQUIRES_SEMANTIC_VALIDATION) before any model call.
 *
 * Library only: no CLI, no AGENT_ID, read-only against every source.
 */

const crypto = require('node:crypto');
const styleAdapter = require('./style-reference-adapter.js');
const cd = require('./creative-direction.js');
const storyAuthority = require('./creative-story-authority.js');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

class CreativeDirectionTaskError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

/*
 * SUCCESSOR REPAIR (2026-08-28, fc2c6f0 child): the Discovery root is NOT a
 * caller option — it is the pinned deployment authority, and the package must
 * be STORE-ADDRESSABLE (<root>/<canonical_idea_id>.json). A caller-selected
 * store or a hand-copied package under a caller directory therefore cannot be
 * treated as canonical. Only the canonical_idea_id + variant are honored.
 */
function candidateScriptFromDiscoveryPackage(canonicalIdeaId, variant = 'structure_a') {
  try {
    return storyAuthority.resolveDiscoveryCandidate({ canonicalIdeaId, variant });
  } catch (error) {
    throw new CreativeDirectionTaskError(error.code || 'STORY_AUTHORITY_INVALID', error.message.replace(/^[A-Z_]+:\s*/, ''));
  }
}

/*
 * Canonical Story: resolved through the PINNED Script Builder authority (never
 * a caller-selected root). Caller hash is only cross-checked.
 */
function canonicalStoryScript(request) {
  try {
    return storyAuthority.resolveCanonicalStory({
      projectId: request?.project_id || request?.projectId,
      versionId: request?.version_id || request?.versionId,
      expectedContentHash: request?.content_hash,
    });
  } catch (error) {
    throw new CreativeDirectionTaskError(error.code || 'STORY_AUTHORITY_INVALID', error.message.replace(/^[A-Z_]+:\s*/, ''));
  }
}

function loadStyleReferenceInput(config) {
  if (!config) return null;
  const loaded = styleAdapter.loadStyleReference({ referencePath: config.referencePath, expectedBinding: config.expectedBinding });
  return {
    binding: { reference_id: loaded.binding.reference_id, sha256: loaded.binding.sha256 },
    consumption: 'ACTIVE_ADVISORY',
    human_approved: Boolean(loaded.binding.approved_by),
    projection: styleAdapter.projectForRole(loaded, 'creative_director'),
  };
}

function validateConstraints(constraints) {
  const seen = new Set();
  for (const [i, c] of (constraints || []).entries()) {
    if (!norm(c?.constraint_id) || seen.has(c.constraint_id)) throw new CreativeDirectionTaskError('CONSTRAINT_INVALID', `human_constraints[${i}] id missing or duplicate`);
    seen.add(c.constraint_id);
    if (!cd.CONSTRAINT_TYPES.includes(c.type)) throw new CreativeDirectionTaskError('CONSTRAINT_INVALID', `human_constraints[${i}] type ${c.type}`);
    if (!norm(c.text)) throw new CreativeDirectionTaskError('CONSTRAINT_INVALID', `human_constraints[${i}] text required`);
    if (['KEEP_MEDIA', 'NO_CARDS_SECTION'].includes(c.type) && !norm(c.scope)) {
      throw new CreativeDirectionTaskError('CONSTRAINT_INVALID', `human_constraints[${i}] ${c.type} requires a scope`);
    }
  }
  // Unenforceable CUSTOM constraints fail the ASSEMBLY closed, before any
  // model call or downstream consumption (fail-safe, mission doctrine).
  const derived = cd.deriveProtectedDomains(constraints || []);
  if (derived.unenforceable.length) {
    const first = derived.unenforceable[0];
    throw new CreativeDirectionTaskError(first.code, `${first.constraint_id}: ${first.detail}`);
  }
  return structuredClone(constraints || []);
}

function assembleCreativeDirectionTask(options) {
  const { taskId, requestedBy, projectId, packageRunId, action = 'recommend_direction', script, humanConstraints, styleReference, operatorInstructions, riskLevel, retryBudget } = options || {};
  if (!norm(taskId) || !norm(requestedBy) || !norm(projectId)) throw new CreativeDirectionTaskError('TASK_IDENTITY_INCOMPLETE', 'taskId, requestedBy, projectId required');
  // Roots are the pinned deployment authority, never caller-selectable: only a
  // canonical_idea_id (Discovery) or a project/version (Story) is honored.
  // Resolve once at assembly for fail-fast, then DISCARD the resolved content:
  // the task carries only a STABLE STORY REFERENCE (opaque ids). Content, hash,
  // approval, and lineage are never task fields — they are re-resolved from the
  // pinned store at preflight/run so ordinary task data can never shape Story
  // authority (boundary redesign, mission §4).
  let bound;
  if (script?.canonicalIdeaId) bound = candidateScriptFromDiscoveryPackage(script.canonicalIdeaId, script.variant || 'structure_a');
  else if (script?.story) bound = canonicalStoryScript(script.story);
  else throw new CreativeDirectionTaskError('SCRIPT_SOURCE_REQUIRED', 'script.canonicalIdeaId or script.story required');
  let reference;
  try { reference = storyAuthority.storyReferenceOf(bound.script_identity); }
  catch (error) { throw new CreativeDirectionTaskError(error.code || 'STORY_AUTHORITY_INVALID', error.message.replace(/^[A-Z_]+:\s*/, '')); }
  const task = {
    task_id: taskId,
    requested_by: requestedBy,
    project_id: projectId,
    package_run_id: packageRunId || null,
    action,
    agent_id: 'creative_director',
    privacy: { local_only: true },
    risk_level: riskLevel || 'LOCAL_AUTO',
    script_identity: reference,
    style_reference: loadStyleReferenceInput(styleReference),
    human_constraints: validateConstraints(humanConstraints),
  };
  if (retryBudget !== undefined) task.retry_budget = retryBudget;
  if (norm(operatorInstructions)) task.operator_instructions = norm(operatorInstructions);
  return task;
}

module.exports = { CreativeDirectionTaskError, assembleCreativeDirectionTask, candidateScriptFromDiscoveryPackage, canonicalStoryScript, loadStyleReferenceInput, validateConstraints };
