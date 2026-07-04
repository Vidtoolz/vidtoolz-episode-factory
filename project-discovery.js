/*
 * VIDTOOLZ project discovery.
 *
 * Lists aigen script-packages and returns compact summaries for the projects
 * board (id, title, stage, status, next-task label, counts, last updated). Each
 * summary is derived from package files via the state resolver + next-task
 * engine, so the board shows where every project is and what to do next.
 *
 * Read-only. Errors on a single package degrade to a minimal entry rather than
 * failing the whole listing.
 */

const fs = require('fs');
const path = require('path');

const { resolveProjectState } = require('./project-state-resolver.js');
const { chooseNextTask } = require('./next-task-engine.js');

const DEFAULT_PACKAGES_ROOT = '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages';

// Names that are test/smoke/validation fixtures rather than real projects.
const DIAGNOSTIC_RE = /^_|smoke|xval|mini-e2e|real-image-mini|validation-2026|-validation-/i;

function summarizeProject(packageDir) {
  const id = path.basename(packageDir);
  const base = {
    project_id: id,
    title: id,
    package_path: packageDir,
    status: 'active',
    stage: 'idea',
    diagnostic: DIAGNOSTIC_RE.test(id),
    archived: false,
    last_updated: null,
  };
  try {
    base.last_updated = fs.statSync(packageDir).mtime.toISOString();
  } catch (e) { /* ignore */ }
  // Provenance: promoted-from-idea marker or manifest.source.
  let source = 'package';
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(packageDir, 'promoted-from-idea.json'), 'utf8'));
    if (marker && marker.source) source = marker.source;
  } catch (e) {
    try {
      const man = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
      if (man && man.source) source = man.source;
    } catch (e2) { /* ignore */ }
  }
  base.source = source;
  try {
    const state = resolveProjectState(packageDir);
    const next = chooseNextTask(state);
    return Object.assign(base, {
      source,
      title: state.title,
      pathway: state.pathway,
      status: state.status,
      archived: state.status === 'archived',
      stage: state.stage,
      stage_index: state.stage_index,
      stage_total: state.stage_total,
      counts: state.counts,
      blockers: state.blockers,
      next_task: { id: next.id, label: next.label, why: next.why, blocked: next.blocked, done: next.done },
    });
  } catch (e) {
    base.error = e.message;
    return base;
  }
}

function listProjects(options = {}) {
  const root = options.packagesRoot || DEFAULT_PACKAGES_ROOT;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return { root, projects: [], error: `Packages root not readable: ${root}` };
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && e.name !== 'stale-runs' && e.name !== '.git')
    .map((e) => path.join(root, e.name));

  const projects = dirs.map(summarizeProject);
  // Newest first by last_updated, then id.
  projects.sort((a, b) => {
    const at = a.last_updated || '';
    const bt = b.last_updated || '';
    if (at !== bt) return bt.localeCompare(at);
    return a.project_id.localeCompare(b.project_id);
  });

  return {
    root,
    count: projects.length,
    real_count: projects.filter((p) => !p.diagnostic).length,
    archived_count: projects.filter((p) => p.archived).length,
    // "current" = real (non-diagnostic) projects that are not archived — what the
    // Projects board shows by default.
    current_count: projects.filter((p) => !p.diagnostic && !p.archived).length,
    projects,
  };
}

module.exports = { DEFAULT_PACKAGES_ROOT, DIAGNOSTIC_RE, summarizeProject, listProjects };
