#!/usr/bin/env node
'use strict';

/*
 * Additive integration view for the three independent Final Production lanes.
 * This module owns no media, selection, lock or package authority. It reads
 * the canonical visual, performance and music authorities and projects their
 * current state into one operator-facing view.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('./final-production-package.js');
const directed = require('./directed-draft-assembly-handoff.js');
const laneStateAuthority = require('./final-production-lane-state.js');

const SCHEMA = 'vidtoolz.finalProductionCoreLanesProjection.v1';
const AUTHORITY_DIR = 'final-production/core-lanes';

function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function paths(runDir) { const base = path.join(path.resolve(runDir), AUTHORITY_DIR); return { base, projection: path.join(base, 'resolve-core-lanes-projection.json') }; }

function visualStatus(runDir, options = {}) {
  return laneStateAuthority.deriveFinalProductionLaneStates(runDir, options).visual.status;
}

function laneState(runDir, options = {}) {
  const lock = require('./final-production-lock.js').lockStatus(runDir, options);
  if (lock.state !== 'FINAL_PRODUCTION_LOCKED') return { run_id: lock.run_id, package_state: lock.state, lock, lanes: null };
  const packagePaths = pkg.packagePaths(runDir);
  if (!fs.existsSync(packagePaths.package)) return { run_id: lock.run_id, package_state: 'FINAL_PRODUCTION_LOCKED', lock, lanes: null };
  const lanes = laneStateAuthority.deriveFinalProductionLaneStates(runDir, options);
  const visual = lanes.visual.status;
  const performance = lanes.performance.status;
  const finalMusic = lanes.music.status;
  return {
    run_id: lock.run_id,
    package_state: 'FINAL_PRODUCTION_PACKAGE_READY',
    lock_id: lock.lock_id,
    lock_digest_sha256: lock.lock_digest_sha256,
    lanes: {
      visual: lanes.visual,
      performance: lanes.performance,
      music: lanes.music,
    },
    final_edit_complete: false,
    final_qc_pass: false,
    publication_approved: false,
  };
}

function nextActions(runDir, options = {}) {
  const snapshot = laneState(runDir, options);
  return nextActionsFromSnapshot(snapshot);
}

function nextActionsFromSnapshot(snapshot) {
  if (!snapshot.lanes) return { ...snapshot, ready: [], waiting_on_mikko: [], blocked: [{ task: 'FINAL_PRODUCTION_LOCK', state: snapshot.package_state }] };
  const { visual, performance, music: finalMusic } = snapshot.lanes;
  const ready = [];
  const waiting = [];
  const blocked = [];
  if (!visual.complete) ready.push({ task: 'VISUAL_READY', lane: 'FINAL_VISUAL_ASSETS', state: 'READY', detail: 'Generate or select the next Final visual asset; visual production is independent' });
  if (!performance.complete) {
    const action = performance.status.next_action;
    const state = performance.status.takes === 0 ? 'WAITING_FOR_MIKKO' : 'READY';
    ready.push({ task: 'PERFORMANCE_READY', lane: 'FINAL_HUMAN_PERFORMANCE', state, detail: action, missing_sections: performance.status.coverage?.filter((x) => x.status !== 'COVERED_BY_SELECTED_TAKE').map((x) => x.section_id) || [] });
  }
  if (!finalMusic.complete) {
    const action = finalMusic.status?.next_action;
    if (finalMusic.state === 'BLOCKED') blocked.push({ task: 'FINAL_MUSIC', lane: 'MUSIC', code: finalMusic.code, blocked_by: finalMusic.reason });
    else {
      const state = action.task === 'CREATE_FINAL_MUSIC_CANDIDATE' ? 'WAITING_FOR_MIKKO' : 'READY';
      ready.push({ task: 'MUSIC_READY', lane: 'FINAL_MUSIC', state, detail: action.detail, commands: action.commands || [action.command].filter(Boolean) });
    }
  }
  if (visual.complete && performance.complete && finalMusic.complete) waiting.push({ task: 'ASSEMBLE_FINAL_EDIT_IN_RESOLVE', state: 'WAITING_FOR_FINAL_EDIT_AUTHORITY', detail: 'All lanes are complete; edit, QC and publication remain separate authorities' });
  return { ...snapshot, ready, waiting_on_mikko: waiting, blocked, independent_lanes: true, next_action: ready[0]?.detail || waiting[0]?.detail || 'All core lanes are complete' };
}

function projection(runDir, options = {}) {
  const snapshot = laneState(runDir, options);
  if (options.write === false) return projectionFromSnapshot(snapshot);
  const value = projectionFromSnapshot(snapshot, readJson(pkg.packagePaths(runDir).package).components?.final_resolve_blueprint?.sha256 || null, options.now);
  if (value.state === 'UNRESOLVED') return value;
  fs.mkdirSync(paths(runDir).base, { recursive: true }); fs.writeFileSync(paths(runDir).projection, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function projectionFromSnapshot(snapshot, blueprintSha256 = null, projectedAt = new Date().toISOString()) {
  if (!snapshot.lanes) return { schema: SCHEMA, run_id: snapshot.run_id, state: 'UNRESOLVED', canonical_resolve_blueprint_mutated: false, lanes: null };
  const value = {
    schema: SCHEMA, artifact_type: 'final-resolve-core-lanes-projection', run_id: snapshot.run_id,
    lock_id: snapshot.lock_id, lock_digest_sha256: snapshot.lock_digest_sha256,
    blueprint_sha256: blueprintSha256, canonical_resolve_blueprint_mutated: false,
    final_edit_created: false, final_qc_pass: false, publication_approved: false,
    lanes: {
      visual: snapshot.lanes.visual.complete ? { state: 'RESOLVED', selected_beats: snapshot.lanes.visual.status.selected } : { state: 'PLACEHOLDER', placeholder: 'FINAL_VISUAL_ASSETS' },
      performance: snapshot.lanes.performance.complete ? { state: 'RESOLVED', projection: 'final-resolve-performance-projection' } : { state: 'PLACEHOLDER', placeholder: 'FINAL_HUMAN_PERFORMANCE' },
      music: snapshot.lanes.music.complete ? { state: 'RESOLVED', projection: 'final-resolve-music-projection' } : { state: 'PLACEHOLDER', placeholder: 'FINAL_MUSIC' },
    },
    projected_at: projectedAt,
  };
  value.projection_digest_sha256 = digest(value);
  return value;
}

function resolveRun(repo, runId) { return directed.resolveRunDir(path.resolve(repo), runId); }
function main(argv = process.argv.slice(2)) {
  const command = argv[0]; const runIndex = argv.indexOf('--run-id'); const repoIndex = argv.indexOf('--repo');
  if (!['status', 'next', 'project'].includes(command) || (runIndex < 0) || !argv[runIndex + 1]) { process.stderr.write('FINAL_CORE_LANES_ARGUMENT_INVALID: command and --run-id are required\n'); return 1; }
  try { const repo = repoIndex >= 0 ? argv[repoIndex + 1] : path.resolve(__dirname, '..'); const run = resolveRun(repo, argv[runIndex + 1]); const value = command === 'status' ? laneState(run) : command === 'next' ? nextActions(run) : projection(run); process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); return 0; } catch (error) { process.stderr.write(`${error.code || 'FINAL_CORE_LANES_FAILED'}: ${error.message}\n`); return 1; }
}

module.exports = { SCHEMA, AUTHORITY_DIR, paths, visualStatus, laneState, nextActions, nextActionsFromSnapshot, projection, projectionFromSnapshot, resolveRun, main };
if (require.main === module) process.exitCode = main();
