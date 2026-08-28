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
const fs = require('node:fs');
const path = require('node:path');
const styleAdapter = require('./style-reference-adapter.js');
const cd = require('./creative-direction.js');
const { loadCanonicalStory, DEFAULT_SCRIPT_BUILDER_ROOT } = require('./agent-task-visual-planning.js');

const DEFAULT_DISCOVERY_ROOT = '/home/vidtoolz/vidtoolz-mindmap/data-gdocs/claim-packages';

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

class CreativeDirectionTaskError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

function containedWithin(rootReal, candidateReal) {
  return candidateReal === rootReal || candidateReal.startsWith(`${rootReal}${path.sep}`);
}

function candidateScriptFromDiscoveryPackage(packagePath, variant = 'structure_a', options = {}) {
  const rootReal = fs.realpathSync(path.resolve(options.discoveryRoot || DEFAULT_DISCOVERY_ROOT));
  let fileReal;
  try { fileReal = fs.realpathSync(path.resolve(packagePath)); }
  catch (error) { throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_UNREADABLE', `${packagePath}: ${error.message}`); }
  if (!containedWithin(rootReal, fileReal)) {
    throw new CreativeDirectionTaskError('STORY_AUTHORITY_INVALID',
      `candidate package escapes the canonical Discovery store (${rootReal}); a package outside the store carries no authority`);
  }
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(fileReal, 'utf8')); }
  catch (error) { throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_UNREADABLE', `${fileReal}: ${error.message}`); }
  if (pkg.generation_state !== 'COMPLETE') throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_INCOMPLETE', `generation_state ${pkg.generation_state}`);
  const idea = norm(pkg.canonical_idea_id);
  const title = norm(pkg.datasheet?.best_title || pkg.claim_snapshot?.title);
  const script = pkg[`${variant}_script`];
  if (!idea || !title || !script || !Array.isArray(script.beats) || !script.beats.length) {
    throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_INVALID', 'missing idea id, title, or script beats');
  }
  const isCanary = /canary|not for publication|lifecycle integration/i.test(title);
  if (isCanary) throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_IS_CANARY', 'canary/shell/trial scripts are not valid creative-direction subjects');
  const sourceFingerprint = pkg.source_fingerprint;
  const datasheetFingerprint = pkg.generation_metadata?.datasheet_fingerprint;
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint || '') || !/^[a-f0-9]{64}$/.test(datasheetFingerprint || '')) {
    throw new CreativeDirectionTaskError('STORY_AUTHORITY_INVALID', 'candidate package lacks canonical fingerprints');
  }
  const recordedDatasheetFingerprint = pkg.validation?.datasheet?.fingerprint;
  if (recordedDatasheetFingerprint && recordedDatasheetFingerprint !== datasheetFingerprint) {
    throw new CreativeDirectionTaskError('STORY_AUTHORITY_INVALID',
      'candidate package datasheet fingerprint is internally inconsistent (generation_metadata vs validation record)');
  }
  if (pkg.validation?.datasheet && pkg.validation.datasheet.status !== 'PASS') {
    throw new CreativeDirectionTaskError('STORY_AUTHORITY_INVALID', 'candidate package datasheet validation is not PASS');
  }
  if (pkg.validation?.scripts && pkg.validation.scripts.status !== 'PASS') {
    throw new CreativeDirectionTaskError('STORY_AUTHORITY_INVALID', 'candidate package script validation is not PASS');
  }
  const sections = script.beats.map((text, index) => ({ section_ref: `beat-${String(index + 1).padStart(2, '0')}`, text: norm(text) }));
  const scriptSha = sha256(sections.map((s) => s.text).join('\n\n'));
  return {
    script_identity: {
      kind: 'CANDIDATE_SCRIPT',
      source: 'DISCOVERY_PACKAGE',
      canonical_idea_id: idea,
      source_fingerprint: sourceFingerprint,
      datasheet_fingerprint: datasheetFingerprint,
      script_variant: variant,
      script_sha256: scriptSha,
      authority_verified: true,
      authority_root: rootReal,
    },
    script_content: { title, sections },
  };
}

/*
 * Canonical Story: resolved through the canonical authority, never accepted
 * from the caller. `expected` fields, when supplied, are cross-checked against
 * the RESOLVED identity and any mismatch fails closed — a wrong project, a
 * stale version, or a forged hash can therefore never enter a task.
 */
function canonicalStoryScript(request, options = {}) {
  const projectId = norm(request?.project_id || request?.projectId);
  const versionId = norm(request?.version_id || request?.versionId);
  if (!projectId || !versionId) {
    throw new CreativeDirectionTaskError('STORY_AUTHORITY_INVALID', 'canonical Story requests must name project_id and version_id for authority resolution');
  }
  let loaded;
  try {
    loaded = loadCanonicalStory({ scriptBuilderRoot: options.scriptBuilderRoot || DEFAULT_SCRIPT_BUILDER_ROOT, projectId, versionId });
  } catch (error) {
    throw new CreativeDirectionTaskError('STORY_AUTHORITY_INVALID', `canonical Story authority refused: ${error.message}`);
  }
  const story = loaded.story;
  if (request.content_hash && request.content_hash !== story.content_hash) {
    throw new CreativeDirectionTaskError('STORY_AUTHORITY_INVALID',
      `caller-supplied content hash does not match the canonical Story authority (expected ${story.content_hash})`);
  }
  const sections = story.sections.map((s) => ({ section_ref: s.section_id, text: norm(s.dialogue) })).filter((s) => s.text);
  if (!sections.length) throw new CreativeDirectionTaskError('STORY_SECTIONS_EMPTY', 'Story carries no dialogue sections');
  return {
    script_identity: {
      kind: 'CANONICAL_STORY',
      project_id: story.project_id,
      version_id: story.version_id,
      content_hash: story.content_hash,
      approval: structuredClone(story.approval),
      authority_verified: true,
      authority_source: 'script-builder canonical store (current head, hash recomputed)',
    },
    script_content: { title: norm(loaded.project.title || story.central_claim || story.project_id), sections },
  };
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
  let bound;
  if (script?.discoveryPackagePath) bound = candidateScriptFromDiscoveryPackage(script.discoveryPackagePath, script.variant || 'structure_a', { discoveryRoot: script.discoveryRoot });
  else if (script?.story) bound = canonicalStoryScript(script.story, { scriptBuilderRoot: script.scriptBuilderRoot });
  else throw new CreativeDirectionTaskError('SCRIPT_SOURCE_REQUIRED', 'script.discoveryPackagePath or script.story required');
  const task = {
    task_id: taskId,
    requested_by: requestedBy,
    project_id: projectId,
    package_run_id: packageRunId || null,
    action,
    agent_id: 'creative_director',
    privacy: { local_only: true },
    risk_level: riskLevel || 'LOCAL_AUTO',
    script_identity: bound.script_identity,
    script_content: bound.script_content,
    style_reference: loadStyleReferenceInput(styleReference),
    human_constraints: validateConstraints(humanConstraints),
  };
  if (retryBudget !== undefined) task.retry_budget = retryBudget;
  if (norm(operatorInstructions)) task.operator_instructions = norm(operatorInstructions);
  return task;
}

module.exports = { CreativeDirectionTaskError, DEFAULT_DISCOVERY_ROOT, assembleCreativeDirectionTask, candidateScriptFromDiscoveryPackage, canonicalStoryScript, loadStyleReferenceInput, validateConstraints };
