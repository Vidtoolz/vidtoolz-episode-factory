#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWrite, safeId } = require('./agent-run');

const DEFAULT_SCRIPT_BUILDER_ROOT = '/home/vidtoolz/vidtoolz-script-builder';

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
    script_claim_bindings: [],
    research_result_refs: [],
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

module.exports = { DEFAULT_SCRIPT_BUILDER_ROOT, loadStoryAuthority, assembleStoryEditorTask, parseArgs };

if (require.main === module) main();
