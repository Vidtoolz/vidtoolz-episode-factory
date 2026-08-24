#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWrite, safeId } = require('./agent-run');
const { sha256 } = require('./agent-contract-validator.js');
const researchAuthority = require('./research-result-authority.js');
const humanIdentity = require('./human-approval-identity.js');

const DEFAULT_SCRIPT_BUILDER_ROOT = '/home/vidtoolz/vidtoolz-script-builder';
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

function typedError(code, message) { const error = new Error(message); error.code = code; return error; }

function loadResearchContext({ repoRoot = DEFAULT_REPO_ROOT, runId, projectId, version }) {
  const packageRunsRoot = path.resolve(repoRoot, 'package-runs');
  const runDir = path.resolve(packageRunsRoot, safeId(runId, 'run_id'));
  if (runDir !== path.join(packageRunsRoot, runId)) throw typedError('RESEARCH_CONTEXT_INVALID', 'Research run identity is not canonical');
  const resultsPath = path.join(runDir, 'research-results.json');
  const bindingsPath = path.join(runDir, 'script-claim-bindings.json');
  const hasResults = fs.existsSync(resultsPath), hasBindings = fs.existsSync(bindingsPath);
  if (!hasResults && !hasBindings) return {
    status: 'NO_RESEARCH_REQUIRED', run_dir: null, research_results_sha256: null,
    bindings_sha256: null, bindings: [], result_refs: [], asOf: null,
  };
  if (!hasResults) throw typedError('RESEARCH_CONTEXT_MISSING', 'Story bindings exist without canonical research-results.json');
  const realRunDir = fs.realpathSync(runDir);
  const realRunsRoot = fs.realpathSync(packageRunsRoot);
  if (realRunDir !== path.join(realRunsRoot, runId)) throw typedError('RESEARCH_CONTEXT_INVALID', 'Research run resolves outside canonical package-runs storage');
  const resultsBytes = fs.readFileSync(resultsPath);
  const results = JSON.parse(resultsBytes);
  if (results.package_run_id !== runId) throw typedError('RESEARCH_CONTEXT_IDENTITY_MISMATCH', 'research-results.json package_run_id does not match the Story task run');
  if (!hasBindings) return {
    status: 'RESEARCH_AVAILABLE_NO_BINDINGS', run_dir: realRunDir, research_results_sha256: sha256(resultsBytes),
    bindings_sha256: null, bindings: [], result_refs: [], asOf: null,
  };
  const bindingsBytes = fs.readFileSync(bindingsPath);
  const bindingsDoc = JSON.parse(bindingsBytes);
  if (bindingsDoc.project_id !== projectId || bindingsDoc.script_version_id !== version.id || bindingsDoc.script_content_hash !== version.content_hash) {
    throw typedError('RESEARCH_CONTEXT_IDENTITY_MISMATCH', 'Story binding document is detached from the exact canonical Story version');
  }
  const sectionTextById = Object.fromEntries((version.sections || []).flatMap((section) => [[section.id, section.dialogue], [section.order, section.dialogue]]));
  const verified = researchAuthority.verifyStoryBindings(bindingsDoc, realRunDir, {
    currentScriptRef: { script_version_id: version.id, script_content_hash: version.content_hash }, sectionTextById,
  });
  if (!verified.ok) throw typedError('RESEARCH_CONTEXT_INVALID', `canonical Story Research bindings are invalid: ${(verified.errors || []).slice(0, 3).join('; ')}`);
  const bindings = structuredClone(bindingsDoc.bindings);
  return {
    status: 'VERIFIED', run_dir: realRunDir, research_results_sha256: sha256(resultsBytes),
    bindings_sha256: sha256(bindingsBytes), bindings,
    result_refs: bindings.map((binding) => structuredClone(binding.research_result_ref)), asOf: null,
  };
}

function loadStoryAuthority({ scriptBuilderRoot = DEFAULT_SCRIPT_BUILDER_ROOT, projectId, versionId }) {
  safeId(projectId, 'project_id');
  safeId(versionId, 'version_id');
  const dataRoot = path.join(scriptBuilderRoot, 'data');
  const versions = require(path.join(scriptBuilderRoot, 'lib', 'versions.js'));
  const store = require(path.join(scriptBuilderRoot, 'lib', 'store.js'));
  const project = store.loadProject(dataRoot, projectId);
  if (!project) throw new Error(`canonical Script Builder project not found: ${projectId}`);
  const version = versions.loadVersion(dataRoot, projectId, versionId);
  if (!version) throw new Error(`canonical Script Builder version not found: ${versionId}`);
  const current = versions.listVersions(dataRoot, projectId).at(-1);
  if (!current || current.id !== versionId) throw new Error(`requested Story version is stale: ${versionId}`);
  const computedHash = versions.scriptContentHash(version.sections);
  if (computedHash !== version.content_hash) throw new Error('canonical Story content hash is invalid');
  const approved = version.approval?.state === 'approved' && project.approved_version_id === versionId;
  const approvedBy = approved ? humanIdentity.canonicalStoryApprover(project, version) : null;
  if (approved && !humanIdentity.verifyLocalHumanApprover(approvedBy)) {
    throw typedError('PLAN_SCRIPT_APPROVER_NOT_HUMAN', 'canonical PLAN_SCRIPT_APPROVAL requires an explicit local human approver identity');
  }
  return {
    dataRoot, project, version,
    authority: {
      project_id: projectId,
      version_id: versionId,
      content_hash: version.content_hash,
      current: true,
      approval_state: approved ? 'approved' : (version.approval?.state || 'none'),
      approved_version_id: project.approved_version_id || null,
      human_approval_present: approved,
      approved_by: approvedBy,
      narrative_spine_present: typeof version.narrative_spine === 'string' && version.narrative_spine.trim().length > 0,
    },
  };
}

function assembleStoryEditorTask(options) {
  const action = options.action || 'review_script';
  if (action !== 'review_script') throw new Error('Story assembler V1 supports review_script only');
  const loaded = loadStoryAuthority(options);
  const taskId = safeId(options.taskId, 'task_id');
  const runId = safeId(options.runId, 'run_id');
  const research = loadResearchContext({ ...options, runId, projectId: loaded.project.id, version: loaded.version });
  const task = {
    task_id: taskId,
    project_id: loaded.project.id,
    package_run_id: runId,
    requested_by: options.requestedBy || 'mikko',
    assignment: {
      action,
      editorial_goal: 'Review the exact current canonical Story without revising or approving it.',
      controversial_change: false,
    },
    script_version_id: loaded.version.id,
    script_content_hash: loaded.version.content_hash,
    script_sections: loaded.version.sections,
    central_claim: loaded.version.central_claim,
    narrative_spine: loaded.version.narrative_spine,
    script_claim_bindings: research.bindings,
    research_result_refs: research.result_refs,
    research: {
      status: research.status, run_dir: research.run_dir, research_results_sha256: research.research_results_sha256,
      bindings_sha256: research.bindings_sha256, asOf: research.asOf,
    },
    data_root: loaded.dataRoot,
    script_builder_root: path.resolve(options.scriptBuilderRoot || DEFAULT_SCRIPT_BUILDER_ROOT),
    risk_level: 'LOCAL_AUTO',
    retry_budget: 2,
    cost_budget: { max_model_calls: 2 },
    privacy: { local_only: true },
  };
  return { task, authority: loaded.authority };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') out.projectId = argv[++i];
    else if (arg === '--version') out.versionId = argv[++i];
    else if (arg === '--run-id') out.runId = argv[++i];
    else if (arg === '--task-id') out.taskId = argv[++i];
    else if (arg === '--requested-by') out.requestedBy = argv[++i];
    else if (arg === '--script-builder-root') out.scriptBuilderRoot = argv[++i];
    else if (arg === '--repo-root') out.repoRoot = argv[++i];
    else if (arg === '--out') out.outPath = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const assembled = assembleStoryEditorTask(options);
    if (options.outPath) atomicWrite(path.resolve(options.outPath), `${JSON.stringify(assembled.task, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ...assembled, task_path: options.outPath ? path.resolve(options.outPath) : null }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { DEFAULT_SCRIPT_BUILDER_ROOT, DEFAULT_REPO_ROOT, loadStoryAuthority, loadResearchContext, assembleStoryEditorTask, parseArgs };

if (require.main === module) main();
