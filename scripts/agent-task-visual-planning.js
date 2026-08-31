#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite, safeId } = require('./agent-run.js');
const visualPlan = require('./visual-plan.js');
const humanIdentity = require('./human-approval-identity.js');
const scriptBuilderAuthority = require('./script-builder-authority.js');
const productionMode = require('./package-run-production-mode.js');
const visualPlanningDirector = require('./visual-planning-director.js');

// Lazy require: creative-director.js -> creative-story-authority.js already
// requires THIS module (loadCanonicalStory), so a top-level require here would
// create a load cycle. Resolving at call time keeps one clean direction.
function creativeDirector() {
  return require('./creative-director.js');
}

const DEFAULT_SCRIPT_BUILDER_ROOT = scriptBuilderAuthority.defaultCandidates()[0].root;

function canonicalApproval(project, version) {
  // Script Builder's current authority is the hash-bound `approved_version`
  // record.  Early episode-factory fixtures used the now-obsolete scalar
  // `approved_version_id`; accepting only that field made a genuine current
  // Script Builder approval appear absent in production.
  const approvedRef = project.approved_version || (project.approved_version_id ? {
    version_id: project.approved_version_id,
    content_hash: version.content_hash,
    at: version.approval?.at || version.approval?.approved_at || null,
    approved_by: version.approval?.approved_by || null,
  } : null);
  const approved = version.approval?.state === 'approved'
    && approvedRef?.version_id === version.id
    && approvedRef?.content_hash === version.content_hash;
  if (!approved) {
    return { state: 'none', approved_by: null, approved_at: null, version_id: version.id, content_hash: version.content_hash };
  }
  const versionAt = version.approval.approved_at || version.approval.at || null;
  const approvedAt = approvedRef.approved_at || approvedRef.at || versionAt;
  if (!approvedAt || approvedAt !== versionAt) {
    const error = new Error('canonical PLAN_SCRIPT_APPROVAL timestamp differs between project and version authority');
    error.code = 'PLAN_SCRIPT_APPROVAL_EVIDENCE_MISMATCH';
    throw error;
  }
  const recordedApprover = version.approval.approved_by || approvedRef.approved_by || null;
  const explicitHumanInCanonicalNote = /^.*?Human authority:\s*([^(.]+?)(?:\s*\(|\.|$)/i.exec(String(version.approval.note || ''))?.[1]?.trim() || null;
  const approvedBy = recordedApprover || explicitHumanInCanonicalNote;
  // Current Script Builder approval records predate an approved_by field.  In
  // that schema the explicit human gate is represented by two matching durable
  // records (project approved_version + immutable version approval), including
  // the exact timestamp and non-empty decision note.  This accepts that
  // canonical evidence without inventing an actor.  A partial/mismatched pair
  // still fails closed; when an explicit actor exists it must be human.
  const matchingCanonicalRecords = Boolean(recordedApprover) || (typeof approvedRef.note === 'string' && approvedRef.note.trim()
    && approvedRef.note === version.approval.note);
  if (!matchingCanonicalRecords || !humanIdentity.verifyLocalHumanApprover(approvedBy)) {
    const error = new Error('canonical PLAN_SCRIPT_APPROVAL approver is not an explicit local human identity');
    error.code = 'PLAN_SCRIPT_APPROVER_NOT_HUMAN';
    throw error;
  }
  if (Number.isNaN(Date.parse(approvedAt || ''))) throw new Error('canonical approved Story is missing exact human approval evidence');
  return {
    state: 'approved', approved_by: approvedBy, approved_at: approvedAt,
    version_id: version.id, content_hash: version.content_hash,
  };
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

/*
 * C2 — safe Creative Direction context for VPD (Approval C, 2026-08-29).
 *
 * VPD consumes Creative Direction ONLY through an explicit canonical
 * creative_direction_id:
 *
 *   creative_direction_id
 *     → canonical Creative Direction registry (resolveCanonicalDirectionById)
 *     → certified projectForSpecialistById / safe projection
 *     → CURRENT canonical human authority re-resolved at use time
 *     → VPD-safe structured projection (enum-only, zero prose)
 *
 * No caller-provided direction objects, no caller-provided projection
 * objects, no raw model output, and NO Creative Director dispatch (the
 * canonical registry holds only directions minted by the pipeline's trusted
 * entry, and dispatch remains DISABLED). With no explicit id, assembly keeps
 * its exact legacy behavior (NO_CREATIVE_DIRECTION_CONTEXT) — never a new
 * blocker, never an inferred "latest" direction.
 */
function resolveCreativeDirectionContext(options) {
  const id = options.creativeDirectionId;
  if (id === undefined || id === null) return { state: 'NO_CREATIVE_DIRECTION_CONTEXT', taskField: null };
  if (typeof id !== 'string' || !id.trim()) {
    const e = new Error('CREATIVE_DIRECTION_CONTEXT_REJECTED: creative_direction_id must be a non-empty canonical id');
    e.code = 'CREATIVE_DIRECTION_CONTEXT_REJECTED';
    throw e;
  }
  let projection;
  try {
    // Canonical resolution + current-human-authority reauthorization happen
    // INSIDE the certified seam; the caller supplies only the id.
    projection = creativeDirector().projectForSpecialistById(id.trim(), 'visual_planning_director', {});
  } catch (error) {
    const e = new Error(`CREATIVE_DIRECTION_CONTEXT_REJECTED: ${error.message}`);
    e.code = 'CREATIVE_DIRECTION_CONTEXT_REJECTED';
    e.cause_code = error.code || null;
    throw e;
  }
  return { state: 'CANONICAL_SAFE_PROJECTION', taskField: projection };
}

function productionGrammarForRun(runDir) {
  const mode = productionMode.readProductionMode(path.resolve(runDir));
  return [productionMode.DRAFT, productionMode.REVIEW].includes(mode.mode)
    ? visualPlanningDirector.DRAFT_BESPOKE_STILL_GRAMMAR
    : null;
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
  if (options.runDir) {
    task.run_dir = path.resolve(options.runDir);
    const grammar = productionGrammarForRun(options.runDir);
    if (grammar) task.production_grammar = grammar;
  }
  // C2: explicit canonical Creative Direction context only. Without a
  // supplied canonical id the task is byte-identical to the pre-C shape.
  const creativeDirection = resolveCreativeDirectionContext(options);
  if (creativeDirection.state === 'CANONICAL_SAFE_PROJECTION') {
    task.creative_direction = creativeDirection.taskField;
  }
  return { task, authority: loaded.authority, creative_direction_state: creativeDirection.state };
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
    else if (arg === '--creative-direction-id') out.creativeDirectionId = argv[++i];
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

module.exports = { DEFAULT_SCRIPT_BUILDER_ROOT, canonicalApproval, loadCanonicalStory, resolveStoryOptionsForRun, productionGrammarForRun, assembleVisualPlanningTask, writeTask, parseArgs };

if (require.main === module) main();
