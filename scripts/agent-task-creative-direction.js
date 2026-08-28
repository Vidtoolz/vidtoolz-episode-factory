'use strict';

/*
 * agent-task-creative-direction.js — task assembler for creative_director.
 *
 * Builds the persisted task.json the Creative Director consumes. All authority
 * enters HERE (the runner injects nothing):
 *   - script identity: a canonical Story (project/version/content_hash,
 *     human-approver verified upstream) OR a real Discovery candidate package
 *     (canonical_idea_id + fingerprints + script bytes hash)
 *   - style reference: loaded fail-closed through the style-reference adapter
 *     (sha-pinned, human-approval-verified) and projected for creative_director
 *     (tendencies only — the projection deliberately withholds numeric bands)
 *   - human constraints: typed hard local constraints (KEEP/locks/tone/…)
 *
 * Library only: no CLI, no AGENT_ID, read-only against every source.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const styleAdapter = require('./style-reference-adapter.js');
const cd = require('./creative-direction.js');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

class CreativeDirectionTaskError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

function candidateScriptFromDiscoveryPackage(packagePath, variant = 'structure_a') {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')); }
  catch (error) { throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_UNREADABLE', `${packagePath}: ${error.message}`); }
  if (pkg.generation_state !== 'COMPLETE') throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_INCOMPLETE', `generation_state ${pkg.generation_state}`);
  const idea = norm(pkg.canonical_idea_id);
  const title = norm(pkg.datasheet?.best_title || pkg.claim_snapshot?.title);
  const script = pkg[`${variant}_script`];
  if (!idea || !title || !script || !Array.isArray(script.beats) || !script.beats.length) {
    throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_INVALID', 'missing idea id, title, or script beats');
  }
  const isCanary = /canary|not for publication|lifecycle integration/i.test(title);
  if (isCanary) throw new CreativeDirectionTaskError('CANDIDATE_PACKAGE_IS_CANARY', 'canary/shell/trial scripts are not valid creative-direction subjects');
  const sections = script.beats.map((text, index) => ({ section_ref: `beat-${String(index + 1).padStart(2, '0')}`, text: norm(text) }));
  const scriptSha = sha256(sections.map((s) => s.text).join('\n\n'));
  return {
    script_identity: {
      kind: 'CANDIDATE_SCRIPT',
      source: 'DISCOVERY_PACKAGE',
      canonical_idea_id: idea,
      source_fingerprint: pkg.source_fingerprint,
      datasheet_fingerprint: pkg.generation_metadata?.datasheet_fingerprint,
      script_variant: variant,
      script_sha256: scriptSha,
    },
    script_content: { title, sections },
  };
}

function canonicalStoryScript(story) {
  if (!story || !norm(story.project_id) || !norm(story.version_id) || !/^[a-f0-9]{64}$/.test(story.content_hash || '')) {
    throw new CreativeDirectionTaskError('STORY_IDENTITY_INCOMPLETE', 'canonical Story identity required');
  }
  const sections = (story.sections || []).map((s) => ({ section_ref: s.section_id, text: norm(s.dialogue) })).filter((s) => s.text);
  if (!sections.length) throw new CreativeDirectionTaskError('STORY_SECTIONS_EMPTY', 'Story carries no dialogue sections');
  return {
    script_identity: { kind: 'CANONICAL_STORY', project_id: story.project_id, version_id: story.version_id, content_hash: story.content_hash, approval: story.approval ? structuredClone(story.approval) : null },
    script_content: { title: norm(story.title || story.central_claim || story.project_id), sections },
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
  return structuredClone(constraints || []);
}

function assembleCreativeDirectionTask(options) {
  const { taskId, requestedBy, projectId, packageRunId, action = 'recommend_direction', script, humanConstraints, styleReference, operatorInstructions, riskLevel, retryBudget } = options || {};
  if (!norm(taskId) || !norm(requestedBy) || !norm(projectId)) throw new CreativeDirectionTaskError('TASK_IDENTITY_INCOMPLETE', 'taskId, requestedBy, projectId required');
  let bound;
  if (script?.discoveryPackagePath) bound = candidateScriptFromDiscoveryPackage(script.discoveryPackagePath, script.variant || 'structure_a');
  else if (script?.story) bound = canonicalStoryScript(script.story);
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

module.exports = { CreativeDirectionTaskError, assembleCreativeDirectionTask, candidateScriptFromDiscoveryPackage, canonicalStoryScript, loadStyleReferenceInput };
