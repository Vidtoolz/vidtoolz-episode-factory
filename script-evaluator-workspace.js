'use strict';

// Standalone persistence for the three-panel Script Evaluator workspace.
//
// This is DELIBERATELY separate from Super Focus project state: the workspace is
// a scratch bench for pasting, evaluating, rewriting, and hand-assembling a
// final script. Saving here writes ONLY the manually-assembled final script (and
// light provenance) to its own file — it never touches super-focus.json, an
// original source script, or any evaluation. Atomic tmp+rename writes; local
// filesystem only (no VIDNAS, no binaries).

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const WORKSPACE_SUBDIR = 'script-evaluator-workspace';
// Strict slug so an id can never escape the workspace root (path-traversal safe).
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertValidWorkspaceId(id) {
  const s = String(id == null ? '' : id);
  if (!ID_RE.test(s)) {
    const e = new Error('Invalid workspace id. Use lower-case letters, digits and hyphens (max 64).');
    e.statusCode = 400;
    throw e;
  }
  return s;
}

function workspaceRoot(options = {}) {
  return options.workspaceRoot
    || process.env.SCRIPT_EVALUATOR_WORKSPACE_ROOT
    || path.join(__dirname, WORKSPACE_SUBDIR);
}

function workspaceFilePath(id, options = {}) {
  const safeId = assertValidWorkspaceId(id);
  // path.basename is a second guard: even a hypothetical bad id can't add a slash.
  return path.join(workspaceRoot(options), `${path.basename(safeId)}.json`);
}

// Persist the manually-assembled final script. Only the final script + light
// provenance are stored. Returns the saved record.
function saveFinalScript({ id, finalScript, source } = {}, options = {}) {
  const safeId = assertValidWorkspaceId(id);
  const text = String(finalScript == null ? '' : finalScript);
  const root = workspaceRoot(options);
  fs.mkdirSync(root, { recursive: true });
  const outPath = workspaceFilePath(safeId, options);
  const record = {
    schema_version: SCHEMA_VERSION,
    id: safeId,
    final_script: text,
    source: String(source || 'script-evaluator-three-panel'),
    saved_at: options.now || new Date().toISOString(),
  };
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  return record;
}

// Read-only load of a saved final script (or null when none exists yet).
function readFinalScript(id, options = {}) {
  const outPath = workspaceFilePath(id, options);
  if (!fs.existsSync(outPath)) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    return rec && typeof rec === 'object' ? rec : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  SCHEMA_VERSION,
  assertValidWorkspaceId,
  workspaceRoot,
  workspaceFilePath,
  saveFinalScript,
  readFinalScript,
};
