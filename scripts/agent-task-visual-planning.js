#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite, safeId } = require('./agent-run.js');
const visualPlan = require('./visual-plan.js');
const humanIdentity = require('./human-approval-identity.js');
const scriptBuilderAuthority = require('./script-builder-authority.js');

const DEFAULT_SCRIPT_BUILDER_ROOT = scriptBuilderAuthority.defaultCandidates()[0].root;

function canonicalApproval(project, version) {
  const approved = version.approval?.state === 'approved' && project.approved_version_id === version.id;
  if (!approved) {
    return { state: 'none', approved_by: null, approved_at: null, version_id: version.id, content_hash: version.content_hash };
  }
  const approvedBy = version.approval.approved_by || project.approved_version?.approved_by || null;
  const approvedAt = version.approval.approved_at || version.approval.at || project.approved_version?.approved_at || null;
  if (!humanIdentity.verifyLocalHumanApprover(approvedBy)) { const error = new Error('canonical PLAN_SCRIPT_APPROVAL approver is not an explicit local human identity'); error.code = 'PLAN_SCRIPT_APPROVER_NOT_HUMAN'; throw error; }
  if (Number.isNaN(Date.parse(approvedAt || ''))) throw new Error('canonical approved Story is missing exact human approval evidence');
  return { state: 'approved', approved_by: approvedBy, approved_at: approvedAt, version_id: version.id, content_hash: version.content_hash };
}

function loadCanonicalStory({ scriptBuilderRoot = DEFAULT_SCRIPT_BUILDER_ROOT, projectId, versionId }) {
  scriptBuilderRoot = scriptBuilderAuthority.resolveScriptBuilderRoot(scriptBuilderRoot).root;
  safeId(projectId, 'project_id');
  safeId(versionId, 'version_id');
  const root = path.resolve(scriptBuilderRoot);
  const dataRoot = path.join(root, 'data');
  const versions = require(path.join(root, 'lib', 'versions.js'));
  const store = require(path.join(root, 'lib', 'store.js'));
  const project = store.loadProject(dataRoot, projectId);
  if (!project) throw new Error(`canonical Script Builder project not found: ${projectId}`);
  const version = versions.loadVersion(dataRoot, projectId, versionId);
  if (!version) throw new Error(`canonical Script Builder version not found: ${versionId}`);
  const current = versions.listVersions(dataRoot, projectId).at(-1);
  if (!current || current.id !== versionId) throw new Error(`requested Story version is stale: ${versionId}`);
  const contentHash = versions.scriptContentHash(version.sections);
  if (contentHash !== version.content_hash) throw new Error('canonical Story content hash is invalid');
  const approval = canonicalApproval(project, version);
  const requiredBeats = visualPlan.deriveRequiredBeats({ project_id: project.id, version_id: version.id, sections: version.sections });
  const sections = version.sections.map((section) => ({
    section_id: section.id,
    order: section.order,
    beat: section.beat ?? null,
    type: section.type ?? null,
    background: section.background ?? null,
    framing_preset: section.framing_preset ?? null,
    dialogue: section.dialogue,
    visual_notes: section.visual_notes ?? '',
    media_refs: Array.isArray(section.media_refs) ? structuredClone(section.media_refs) : [],
  }));
  return {
    project,
    version,
    story: {
      project_id: project.id,
      version_id: version.id,
      content_hash: contentHash,
      approval,
      central_claim: version.central_claim ?? null,
      narrative_spine: version.narrative_spine ?? null,
      sections,
    },
    requiredBeats,
    authority: {
      current: true,
      approval_state: approval.state,
      human_approval_present: approval.state === 'approved',
      section_count: sections.length,
      content_hash: contentHash,
    },
  };
}

/*
 * A package run names its canonical Story through story-binding.json. Resolving
 * it here is what lets visual_planning_director be dispatched for a real run at
 * all: without it, a caller had to know the Script Builder project/version by
 * hand, which no package-run surface recorded.
 *
 * The binding is a reference, never a fallback: an unbound run fails closed
 * rather than guessing a Story.
 */
function resolveStoryOptionsForRun(options) {
  if (!options.runDir) return options;
  if (options.projectId || options.versionId) {
    throw new Error('pass either --run or explicit --project/--version, not both');
  }
  const storyBinding = require('./package-run-story-binding.js');
  const resolved = storyBinding.resolveBoundStory(options.runDir, {
    scriptBuilderRoot: options.scriptBuilderRoot,
  });
  return {
    ...options,
    projectId: resolved.projectId,
    versionId: resolved.versionId,
    scriptBuilderRoot: options.scriptBuilderRoot || resolved.scriptBuilderRoot,
    runId: options.runId || resolved.binding.run_id,
  };
}

function assembleVisualPlanningTask(inputOptions) {
  const options = resolveStoryOptionsForRun(inputOptions);
  const loaded = loadCanonicalStory(options);
  const taskId = safeId(options.taskId, 'task_id');
  const runId = safeId(options.runId, 'run_id');
  if (options.operatorInstructions !== undefined && typeof options.operatorInstructions !== 'string') throw new Error('operator instructions must be text');
  const outputClass = loaded.project.output_class || {};
  const task = {
    task_id: taskId,
    action: 'plan_visuals',
    requested_by: options.requestedBy || 'mikko',
    project_id: loaded.project.id,
    package_run_id: runId,
    risk_level: 'LOCAL_AUTO',
    privacy: { local_only: true },
    retry_budget: 2,
    cost_budget: { max_model_calls: 2 },
    story: loaded.story,
    required_beats: loaded.requiredBeats,
    research: { bindings_doc: { bindings: [] }, current_result_refs: [], required_constraint_ids: [], authority_by_binding: {} },
    output_target: {
      aspect_ratio: outputClass.aspect_ratio || null,
      orientation: outputClass.orientation || null,
      length_class: outputClass.length_class || null,
      max_duration_minutes: outputClass.max_duration_minutes ?? null,
    },
  };
  if (options.operatorInstructions !== undefined) task.operator_instructions = options.operatorInstructions;
  return { task, authority: loaded.authority };
}

function writeTask(outPath, task) {
  const target = path.resolve(outPath);
  atomicWrite(target, `${JSON.stringify(task, null, 2)}\n`);
  return target;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') out.runDir = argv[++i];
    else if (arg === '--project') out.projectId = argv[++i];
    else if (arg === '--version') out.versionId = argv[++i];
    else if (arg === '--run-id') out.runId = argv[++i];
    else if (arg === '--task-id') out.taskId = argv[++i];
    else if (arg === '--requested-by') out.requestedBy = argv[++i];
    else if (arg === '--operator-instructions') out.operatorInstructions = argv[++i];
    else if (arg === '--script-builder-root') out.scriptBuilderRoot = argv[++i];
    else if (arg === '--out') out.outPath = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.outPath) throw new Error('--out is required');
    const assembled = assembleVisualPlanningTask(options);
    const taskPath = writeTask(options.outPath, assembled.task);
    process.stdout.write(`${JSON.stringify({ task_path: taskPath, authority: assembled.authority }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { DEFAULT_SCRIPT_BUILDER_ROOT, canonicalApproval, loadCanonicalStory, resolveStoryOptionsForRun, assembleVisualPlanningTask, writeTask, parseArgs };

if (require.main === module) main();
