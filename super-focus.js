'use strict';

// Super Focus — standalone, local-first, file-backed project model.
//
// Slice 1 scope: project folder + one versioned state JSON per project, plus
// title/script persistence and a live directory-scan listing. No generation,
// no network, no VIDNAS. Media (later slices) is referenced by path only;
// binaries are never stored in the JSON.
//
// Deliberately dependency-free and separate from the aigen "project" resolver
// (project-state-resolver.js) and the package-runs model. Each Super Focus
// project is a self-describing folder that owns a single super-focus.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Shared hash so stale detection here matches the hash the evaluator stores.
// (script-evaluator.js depends only on `crypto` — no import cycle.)
const scriptEvaluator = require('./script-evaluator.js');
// Visual Plan domain logic (pure, no I/O — persistence stays in this module).
const visualPlan = require('./super-focus-visual-plan.js');

const SCHEMA_VERSION = 1;
const STATE_FILENAME = 'super-focus.json';

// Linear production stages, in order. Slice 1 only actively writes title/script;
// the later stages are scaffolded so downstream slices extend without migration.
const STAGES = [
  'title',
  'script',
  'image_prompts',
  'images',
  'infographic_prompts',
  'i2v_prompts',
  'videos',
];

const APPROVAL_KEYS = [
  'title',
  'script',
  'image_prompts',
  'images',
  'infographic_prompts',
  'i2v_prompts',
  'videos',
];

// Project ids are folder names; keep them strictly filesystem- and URL-safe so a
// caller-supplied id can never escape the projects root.
const PROJECT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Lifecycle directories live INSIDE the projects root. Both names start with a
// dot, which PROJECT_ID_RE can never match, so neither is ever listed or
// openable as a project. `.archived/<id>` holds archived projects (reversible);
// `.trash/` holds staged permanent deletions (never listed, never restored).
const ARCHIVED_DIRNAME = '.archived';
const TRASH_DIRNAME = '.trash';

function resolveRoot(options = {}) {
  if (options && options.root) return options.root;
  if (process.env.SUPER_FOCUS_ROOT) return process.env.SUPER_FOCUS_ROOT;
  return path.join(__dirname, 'super-focus-projects');
}

function resolveArchivedRoot(options = {}) {
  return path.join(resolveRoot(options), ARCHIVED_DIRNAME);
}

function resolveTrashRoot(options = {}) {
  return path.join(resolveRoot(options), TRASH_DIRNAME);
}

function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'untitled';
}

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function assertValidProjectId(projectId) {
  const id = String(projectId || '').trim();
  if (!id || !PROJECT_ID_RE.test(id)) {
    const error = new Error('Invalid Super Focus project id.');
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function emptyApproval() {
  const approval = {};
  for (const key of APPROVAL_KEYS) approval[key] = 'draft';
  return approval;
}

function emptyState(fields = {}) {
  const created = fields.created_at || nowIso();
  return {
    schema_version: SCHEMA_VERSION,
    project_id: fields.project_id || '',
    slug: fields.slug || '',
    title: typeof fields.title === 'string' ? fields.title : '',
    script: typeof fields.script === 'string' ? fields.script : '',
    stage: 'title',
    approval: emptyApproval(),
    // Scaffolded for later slices; empty slots are not persisted individually.
    image_prompts: [],
    infographic_prompts: [],
    jobs: [],
    // Hashes of the upstream text each derived set was generated from, so a later
    // upstream edit can flag the set as possibly stale (never delete it).
    sources: {},
    // Staleness flags: set true when upstream text changed after a derived set
    // existed. Downstream is preserved; the operator regenerates explicitly.
    stale: {},
    // Advisory script evaluation (set by the evaluator endpoint). Never approves
    // or advances anything; marked stale (never deleted) when the script changes.
    script_evaluation: null,
    // Visual Plan (beats + visual assignments) — the authoritative upstream
    // object image prompts are derived from. null = not created (legacy
    // projects open unchanged and simply show "not created").
    visual_plan: null,
    created_at: created,
    updated_at: fields.updated_at || created,
  };
}

function scriptHash(script) {
  return crypto.createHash('sha1').update(String(script || '')).digest('hex').slice(0, 16);
}

function generatedPromptHash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function normalizeGeneratedPromptHash(value) {
  const hash = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

function generatedPromptHashesByIndex(options = {}) {
  const source = options.generatedPromptHashesByIndex || options.generated_prompt_hashes_by_index || {};
  const out = {};
  Object.keys(source || {}).forEach((key) => {
    const idx = Math.round(Number(key));
    const hash = normalizeGeneratedPromptHash(source[key]);
    if (Number.isInteger(idx) && idx >= 1 && hash) out[idx] = hash;
  });
  return out;
}

// Furthest-evidence-wins stage inference, mirroring the aigen resolver's spirit.
// Extended per slice; still limited to the text spine (through image_prompts).
function inferStage(state) {
  let stage = 'title';
  if (state.title && String(state.title).trim()) stage = 'title';
  if (state.script && String(state.script).trim()) stage = 'script';
  if (Array.isArray(state.image_prompts) && state.image_prompts.length > 0) stage = 'image_prompts';
  return stage;
}

// Defense-in-depth containment check. PROJECT_ID_RE already makes traversal
// impossible, but every lifecycle filesystem operation re-verifies that the
// candidate is a strict child of its expected root using path boundaries
// (path.relative), never naive string prefixes ("/projects/foo" is not the
// parent of "/projects/foobar").
function assertContainedIn(candidate, root, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (
    !rel || rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ||
    resolvedCandidate === resolvedRoot || resolvedCandidate === path.parse(resolvedCandidate).root
  ) {
    const error = new Error(`Refusing unsafe ${label || 'project'} path.`);
    error.statusCode = 403;
    throw error;
  }
  return resolvedCandidate;
}

// Lifecycle operations refuse project directories that are symlinks: a rename
// or recursive delete must never follow a link out of the managed roots.
function assertNotSymlink(dir, label) {
  let st = null;
  try { st = fs.lstatSync(dir); } catch (_) { return; /* absent is handled by callers */ }
  if (st.isSymbolicLink()) {
    const error = new Error(`Refusing ${label || 'lifecycle operation'}: project directory is a symlink.`);
    error.statusCode = 403;
    throw error;
  }
}

function hasStateFile(dir) {
  return fs.existsSync(path.join(dir, STATE_FILENAME));
}

// Where a project currently lives: 'active' | 'archived' | null (not found).
// Staged deletions under .trash/ are deliberately invisible here — a staged
// project can never be resolved, opened, or restored.
function projectLifecycle(projectId, options = {}) {
  const id = assertValidProjectId(projectId);
  if (hasStateFile(path.join(resolveRoot(options), id))) return 'active';
  if (hasStateFile(path.join(resolveArchivedRoot(options), id))) return 'archived';
  return null;
}

// Canonical directory for a project, lifecycle-aware: the active location wins,
// then the archived location. Every read AND write re-resolves through here,
// so opening/editing an archived project keeps all saves inside the archive
// directory, and a stale request after archive/restore follows the project to
// its current canonical location instead of recreating the old path. Falls
// back to the active path when the project exists nowhere (callers that need
// existence go through loadProject, which 404s).
function stateDir(projectId, options) {
  const id = assertValidProjectId(projectId);
  const activeDir = path.join(resolveRoot(options), id);
  if (hasStateFile(activeDir)) return activeDir;
  const archivedDir = path.join(resolveArchivedRoot(options), id);
  if (hasStateFile(archivedDir)) return archivedDir;
  return activeDir;
}

function statePath(projectId, options) {
  return path.join(stateDir(projectId, options), STATE_FILENAME);
}

function writeStateAtomic(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, STATE_FILENAME);
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  return outPath;
}

function readStateDir(dir) {
  const file = path.join(dir, STATE_FILENAME);
  const raw = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    // Corrupt state (truncated write, disk full, manual edit) must surface as a
    // clear 422, not an opaque 500 — otherwise the project lists but can never
    // be opened/repaired. (listProjects wraps this and skips corrupt entries.)
    const e = new Error('Super Focus project state is corrupt or unreadable (invalid JSON).');
    e.statusCode = 422;
    throw e;
  }
  if (!parsed || typeof parsed !== 'object') {
    const e = new Error('Super Focus project state is not a valid object.');
    e.statusCode = 422;
    throw e;
  }
  // Normalize so missing/older fields never crash a reader.
  return Object.assign(emptyState(), parsed, {
    approval: Object.assign(emptyApproval(), parsed.approval || {}),
  });
}

function createProject(input = {}, options = {}) {
  const title = typeof input.title === 'string' ? input.title : '';
  const slug = slugify(title || 'untitled-video');
  const projectId = `${slug}-${shortId()}`;
  const created = nowIso();
  const state = emptyState({
    project_id: projectId,
    slug,
    title,
    created_at: created,
    updated_at: created,
  });
  state.stage = inferStage(state);
  const dir = path.join(resolveRoot(options), projectId);
  // Collision includes the archived location: a new project must never shadow
  // an archived one with the same id (restore would then be ambiguous).
  if (fs.existsSync(dir) || fs.existsSync(path.join(resolveArchivedRoot(options), projectId))) {
    const error = new Error('Super Focus project id collision.');
    error.statusCode = 409;
    throw error;
  }
  writeStateAtomic(dir, state);
  return state;
}

function loadProject(projectId, options = {}) {
  const dir = stateDir(projectId, options);
  if (!fs.existsSync(path.join(dir, STATE_FILENAME))) {
    const error = new Error('Super Focus project not found.');
    error.statusCode = 404;
    throw error;
  }
  return readStateDir(dir);
}

// Shared directory scan for both lifecycle lists. Only direct children whose
// name is a valid project id AND that contain a readable state file are
// projects — dot-directories (.archived, .trash), staging leftovers, and
// corrupt entries are skipped, never listed.
function scanProjectsRoot(root) {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!PROJECT_ID_RE.test(entry.name)) continue;
    const file = path.join(root, entry.name, STATE_FILENAME);
    if (!fs.existsSync(file)) continue;
    let state;
    try {
      state = readStateDir(path.join(root, entry.name));
    } catch (err) {
      continue; // Skip unreadable/corrupt project rather than fail the whole list.
    }
    projects.push({
      project_id: state.project_id || entry.name,
      slug: state.slug || '',
      title: state.title || '',
      stage: state.stage || 'title',
      created_at: state.created_at || '',
      updated_at: state.updated_at || '',
    });
  }
  projects.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return projects;
}

function listProjects(options = {}) {
  return scanProjectsRoot(resolveRoot(options));
}

// Archived projects only — never mixed into the normal list.
function listArchivedProjects(options = {}) {
  return scanProjectsRoot(resolveArchivedRoot(options));
}

// ── Project lifecycle: archive / restore / permanent delete ─────────────────
// All three are single atomic renames on the same filesystem (archive root and
// trash root live inside the projects root). Each operation validates identity,
// refuses symlinked project directories, and re-verifies path containment.

function archiveProject(projectId, options = {}) {
  const id = assertValidProjectId(projectId);
  const root = resolveRoot(options);
  const archivedRoot = resolveArchivedRoot(options);
  const source = assertContainedIn(path.join(root, id), root, 'archive source');
  const dest = assertContainedIn(path.join(archivedRoot, id), archivedRoot, 'archive destination');
  assertNotSymlink(source, 'archive');
  if (!hasStateFile(source)) {
    if (hasStateFile(dest)) {
      const error = new Error('Project is already archived.');
      error.statusCode = 409;
      error.code = 'already_archived';
      throw error;
    }
    const error = new Error('Super Focus project not found.');
    error.statusCode = 404;
    throw error;
  }
  if (fs.existsSync(dest)) {
    const error = new Error('An archived project with this id already exists. Refusing to overwrite it.');
    error.statusCode = 409;
    error.code = 'archive_collision';
    throw error;
  }
  fs.mkdirSync(archivedRoot, { recursive: true });
  fs.renameSync(source, dest);
  const state = readStateDir(dest);
  return {
    project_id: state.project_id || id,
    title: state.title || '',
    status: 'archived',
  };
}

function restoreProject(projectId, options = {}) {
  const id = assertValidProjectId(projectId);
  const root = resolveRoot(options);
  const archivedRoot = resolveArchivedRoot(options);
  const source = assertContainedIn(path.join(archivedRoot, id), archivedRoot, 'restore source');
  const dest = assertContainedIn(path.join(root, id), root, 'restore destination');
  assertNotSymlink(source, 'restore');
  if (!hasStateFile(source)) {
    if (hasStateFile(dest)) {
      const error = new Error('Project is already in the normal project list.');
      error.statusCode = 409;
      error.code = 'already_active';
      throw error;
    }
    const error = new Error('Archived Super Focus project not found.');
    error.statusCode = 404;
    throw error;
  }
  if (fs.existsSync(dest)) {
    const error = new Error(`A normal project with id "${id}" already exists. Refusing to overwrite it; resolve the conflict manually.`);
    error.statusCode = 409;
    error.code = 'restore_collision';
    throw error;
  }
  fs.renameSync(source, dest);
  const state = readStateDir(dest);
  return {
    project_id: state.project_id || id,
    title: state.title || '',
    status: 'active',
  };
}

// Permanent deletion, staged: the project directory is atomically renamed into
// .trash/ first (it disappears from every list and every resolvable path in one
// step — stale writes then 404), then removed recursively. fs.rmSync does not
// follow symlinks (links are unlinked, their targets untouched), so referenced
// external media — VIDNAS media dirs, handoffs, other projects — is preserved.
// If recursive cleanup fails the staged remains are reported honestly
// (cleanup_complete:false) and stay invisible to all listings.
function deleteProject(projectId, options = {}) {
  const id = assertValidProjectId(projectId);
  const root = resolveRoot(options);
  const lifecycle = projectLifecycle(id, options);
  if (!lifecycle) {
    const error = new Error('Super Focus project not found.');
    error.statusCode = 404;
    throw error;
  }
  const sourceRoot = lifecycle === 'archived' ? resolveArchivedRoot(options) : root;
  const source = assertContainedIn(path.join(sourceRoot, id), sourceRoot, 'delete target');
  assertNotSymlink(source, 'delete');
  const trashRoot = resolveTrashRoot(options);
  fs.mkdirSync(trashRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let staged = assertContainedIn(path.join(trashRoot, `${id}.${stamp}.${process.pid}`), trashRoot, 'delete staging');
  let n = 1;
  while (fs.existsSync(staged)) {
    staged = assertContainedIn(path.join(trashRoot, `${id}.${stamp}.${process.pid}-${n}`), trashRoot, 'delete staging');
    n += 1;
  }
  fs.renameSync(source, staged);
  let cleanupComplete = true;
  try {
    fs.rmSync(staged, { recursive: true, force: true });
    cleanupComplete = !fs.existsSync(staged);
  } catch (_) {
    cleanupComplete = false;
  }
  return {
    project_id: id,
    previous_status: lifecycle,
    cleanup_complete: cleanupComplete,
  };
}

function saveTitle(projectId, title, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  state.title = typeof title === 'string' ? title : '';
  state.slug = state.slug || slugify(state.title || 'untitled-video');
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

function saveScript(projectId, script, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  state.script = typeof script === 'string' ? script : '';
  // If a derived prompt set exists and the script has changed since it was
  // generated, flag it as possibly stale. Never delete it; the operator
  // regenerates (or keeps their edits) explicitly.
  const newHash = scriptHash(state.script);
  state.sources = state.sources || {};
  state.stale = state.stale || {};
  const markStale = (records, srcKey, staleKey) => {
    if (!Array.isArray(records) || records.length === 0) return;
    const src = state.sources[srcKey];
    if (!src) return;
    if (src !== newHash) state.stale[staleKey] = true;
    else delete state.stale[staleKey]; // reverted to the generating script -> fresh again
  };
  markStale(state.image_prompts, 'image_prompts_script_hash', 'image_prompts');
  markStale(state.infographic_prompts, 'infographic_prompts_script_hash', 'infographic_prompts');
  // A saved script change makes any existing evaluation stale (never delete it;
  // re-evaluation is always explicit). If the script reverts to exactly the
  // evaluated text, the evaluation becomes fresh again.
  if (state.script_evaluation && state.script_evaluation.script_hash) {
    const changed = scriptEvaluator.hashScriptText(state.script) !== state.script_evaluation.script_hash;
    state.script_evaluation.stale = changed;
    if (changed) state.script_evaluation.stale_reason = 'Script changed after this evaluation. Re-run evaluation.';
    else delete state.script_evaluation.stale_reason;
  }
  // A saved script change marks the visual plan stale (never deleted; the
  // operator re-anchors or re-creates beats explicitly). A byte-identical
  // revert makes it fresh again.
  if (state.visual_plan) {
    state.visual_plan = visualPlan.refreshPlanStaleness(state.visual_plan, state.script);
  }
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Persist a fresh script evaluation (from the evaluator endpoint). Replaces any
// prior evaluation, clears stale, and stamps the current script hash. This is
// the ONLY downstream write the evaluator makes — it never approves the script
// or generates prompts/media.
function saveScriptEvaluation(projectId, evaluation, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const ev = Object.assign({}, evaluation || {});
  ev.stale = false;
  delete ev.stale_reason;
  if (!ev.script_hash) ev.script_hash = scriptEvaluator.hashScriptText(state.script);
  state.script_evaluation = ev;
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Read-only: the saved evaluation with a freshly-computed `stale` (compares the
// current script against the evaluated hash). Does not mutate state.
function readScriptEvaluation(projectId, options = {}) {
  const state = loadProject(projectId, options);
  const ev = state.script_evaluation;
  if (!ev) return null;
  const stale = Boolean(ev.stale) || (ev.script_hash ? scriptEvaluator.hashScriptText(state.script) !== ev.script_hash : false);
  return Object.assign({}, ev, {
    stale,
    stale_reason: stale ? (ev.stale_reason || 'Script changed after this evaluation. Re-run evaluation.') : undefined,
  });
}

// Store an "up to N" set of generated prompts as numbered, index-keyed records.
// Empty entries are dropped (empty slots are never persisted). Existing per-row
// image metadata (images/i2v/video) is intentionally not created here — Slice 2
// only writes the prompt text; later slices attach media to each row.
function normalizePromptRecords(texts) {
  const records = [];
  (Array.isArray(texts) ? texts : []).forEach((text) => {
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean) return;
    records.push({ index: records.length + 1, text: clean, status: 'saved' });
  });
  return records;
}

// Regenerate the prompt set while preserving each row's downstream work BY INDEX
// (never a blanket wipe). New prompt text at an index that DIFFERS from the
// previous text at that index flags the carried-over i2v prompt AND any image
// generated for that row as possibly stale — never deletes them. Identical text
// keeps the row's derived state clean. New indexes (beyond the old set) start
// fresh; indexes that fall away when the set shrinks are dropped.
function mergeRegeneratedPrompts(previous, texts) {
  const byIndex = {};
  (Array.isArray(previous) ? previous : []).forEach((r) => { if (r && r.index != null) byIndex[r.index] = r; });
  const records = [];
  (Array.isArray(texts) ? texts : []).forEach((text) => {
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean) return;
    const index = records.length + 1;
    const old = byIndex[index] || null;
    const rec = { index, text: clean, status: 'saved' };
    if (old) {
      const changed = old.text !== clean;
      const oldGeneratedHash = normalizeGeneratedPromptHash(old.generated_prompt_hash);
      if (oldGeneratedHash) rec.generated_prompt_hash = oldGeneratedHash;
      // Image review is a production record tied to the IMAGE bytes and the
      // assignment criteria — it must survive prompt-set regeneration
      // (currency is recomputed from hashes at read time, never trusted).
      if (old.image_review) rec.image_review = old.image_review;
      if (old.video_review) rec.video_review = old.video_review;
      if (old.i2v_prompt) {
        rec.i2v_prompt = Object.assign({}, old.i2v_prompt);
        if (changed) rec.i2v_prompt.stale = true;
      }
      // A changed prompt (or an already-flagged row) leaves its generated image
      // mismatched until the image is regenerated.
      if (changed || old.image_stale) rec.image_stale = true;
    }
    records.push(rec);
  });
  return records;
}

// Clear the per-row image-mismatch flag for the given indexes. Called when a
// fresh image will actually be (re)generated for a row, so the on-disk image
// matches the current prompt again. Never touches i2v staleness.
function clearImageStale(projectId, indexes, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const set = new Set((Array.isArray(indexes) ? indexes : []).map((n) => Math.round(Number(n))));
  let changed = false;
  (Array.isArray(state.image_prompts) ? state.image_prompts : []).forEach((r) => {
    if (!set.has(r.index)) return;
    if (r.image_stale) { delete r.image_stale; changed = true; }
    // Backward compatibility: legacy rows without generated_prompt_hash are
    // treated as unknown and are NOT mass-flagged on load. We only stamp the
    // hash when an image is actually generated/confirmed for the row, so future
    // prompt replacements can be compared honestly by exact sha256(text).
    if (typeof r.text === 'string' && r.text.trim()) {
      const hash = generatedPromptHash(r.text.trim());
      if (r.generated_prompt_hash !== hash) { r.generated_prompt_hash = hash; changed = true; }
    }
  });
  if (changed) {
    state.updated_at = nowIso();
    writeStateAtomic(dir, state);
  }
  return state;
}

function saveImagePrompts(projectId, texts, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  state.image_prompts = mergeRegeneratedPrompts(state.image_prompts, texts);
  state.sources = state.sources || {};
  state.stale = state.stale || {};
  // Record the script this set was generated from; clear any stale flag.
  state.sources.image_prompts_script_hash = scriptHash(state.script);
  delete state.stale.image_prompts;
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Image-prompt slot capacity. Mirrors super-focus-prompts.IMAGE_PROMPT_MAX; the
// server passes the canonical value via options.capacity, this is the fallback.
const IMAGE_PROMPT_CAPACITY = 100;

// Fill the currently-empty image-prompt slots (up to capacity) with newly
// generated prompt texts, BY INDEX. Existing filled rows are left untouched —
// their text, i2v prompt, image state, and stale flags are all preserved; they
// are never renumbered. New rows land in the empty index gaps (scattered or a
// trailing block) as fresh source prompts. `texts` are consumed in slot order.
function fillEmptyImagePrompts(projectId, texts, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const capacity = Number(options.capacity) > 0 ? Math.round(Number(options.capacity)) : IMAGE_PROMPT_CAPACITY;
  const knownGeneratedHashes = generatedPromptHashesByIndex(options);
  const byIndex = {};
  (Array.isArray(state.image_prompts) ? state.image_prompts : []).forEach((r) => {
    if (r && r.index != null && typeof r.text === 'string' && r.text.trim()) byIndex[r.index] = r;
  });
  const emptyIndexes = [];
  for (let i = 1; i <= capacity; i += 1) if (!byIndex[i]) emptyIndexes.push(i);
  const clean = (Array.isArray(texts) ? texts : [])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean);
  const fillCount = Math.min(emptyIndexes.length, clean.length);
  for (let k = 0; k < fillCount; k += 1) {
    const idx = emptyIndexes[k];
    const rec = { index: idx, text: clean[k], status: 'saved' };
    const generatedHash = knownGeneratedHashes[idx];
    if (generatedHash) {
      rec.generated_prompt_hash = generatedHash;
      if (generatedHash !== generatedPromptHash(clean[k])) rec.image_stale = true;
    }
    byIndex[idx] = rec;
  }
  state.image_prompts = Object.values(byIndex).sort((a, b) => a.index - b.index);
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Infographic-prompt slot capacity. Mirrors super-focus-prompts.INFOGRAPHIC_PROMPT_MAX;
// the server passes the canonical value via options.capacity, this is the fallback.
const INFOGRAPHIC_PROMPT_CAPACITY = 30;

// Fill the currently-empty infographic-prompt slots (up to capacity) with newly
// generated texts, BY INDEX. Existing filled rows are preserved untouched and
// never renumbered; new rows land in the empty index gaps (scattered or a
// trailing block). Mirrors fillEmptyImagePrompts (infographics have no
// downstream media). `texts` are consumed in slot order.
function fillEmptyInfographicPrompts(projectId, texts, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const capacity = Number(options.capacity) > 0 ? Math.round(Number(options.capacity)) : INFOGRAPHIC_PROMPT_CAPACITY;
  const byIndex = {};
  (Array.isArray(state.infographic_prompts) ? state.infographic_prompts : []).forEach((r) => {
    if (r && r.index != null && typeof r.text === 'string' && r.text.trim()) byIndex[r.index] = r;
  });
  const emptyIndexes = [];
  for (let i = 1; i <= capacity; i += 1) if (!byIndex[i]) emptyIndexes.push(i);
  const clean = (Array.isArray(texts) ? texts : [])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean);
  const fillCount = Math.min(emptyIndexes.length, clean.length);
  for (let k = 0; k < fillCount; k += 1) {
    const idx = emptyIndexes[k];
    byIndex[idx] = { index: idx, text: clean[k], status: 'saved' };
  }
  state.infographic_prompts = Object.values(byIndex).sort((a, b) => a.index - b.index);
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

function saveInfographicPrompts(projectId, texts, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  state.infographic_prompts = normalizePromptRecords(texts);
  state.sources = state.sources || {};
  state.stale = state.stale || {};
  state.sources.infographic_prompts_script_hash = scriptHash(state.script);
  delete state.stale.infographic_prompts;
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Save/clear a single prompt slot by 1-based index (per-row "Save changes").
// Empty text removes the slot (empty slots are never persisted). Editing one
// row does not change the set's script-derived staleness — it is a manual edit.
function upsertPromptSlot(records, index, text, options = {}) {
  const idx = Math.round(Number(index));
  if (!Number.isFinite(idx) || idx < 1) {
    const e = new Error('Prompt index must be a positive integer.'); e.statusCode = 400; throw e;
  }
  const clean = typeof text === 'string' ? text.trim() : '';
  const existing = (Array.isArray(records) ? records : []).find((r) => r.index === idx) || null;
  const knownGeneratedHash = generatedPromptHashesByIndex(options)[idx] || '';
  const list = (Array.isArray(records) ? records : []).filter((r) => r.index !== idx);
  if (clean) {
    // Preserve downstream fields (i2v_prompt, images) attached to this row; only
    // the text changes. If the source text changed, flag the derived work as
    // possibly stale — never delete it: the i2v prompt (if any) AND any image
    // that was generated from the old text (it no longer cleanly matches).
    const merged = Object.assign({}, existing || {}, { index: idx, text: clean, status: 'saved' });
    const previousHash = normalizeGeneratedPromptHash(merged.generated_prompt_hash) || knownGeneratedHash;
    if (previousHash) merged.generated_prompt_hash = previousHash;
    // Assignment-provenance rows: prompt_hash tracks the CURRENT prompt text
    // (assignment_id/assignment_hash keep the upstream link; the text hash
    // must not go stale when the operator hand-edits the prompt).
    if (merged.prompt_hash) merged.prompt_hash = generatedPromptHash(clean);
    if (existing && existing.text !== clean) {
      if (merged.i2v_prompt) merged.i2v_prompt = Object.assign({}, merged.i2v_prompt, { stale: true });
      merged.image_stale = true;
    } else if (!existing && previousHash && previousHash !== generatedPromptHash(clean)) {
      merged.image_stale = true;
    }
    list.push(merged);
  }
  list.sort((a, b) => a.index - b.index);
  return list;
}

function saveImagePrompt(projectId, index, text, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  state.image_prompts = upsertPromptSlot(state.image_prompts, index, text, options);
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

function saveInfographicPrompt(projectId, index, text, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  state.infographic_prompts = upsertPromptSlot(state.infographic_prompts, index, text);
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Attach/replace the image-to-video prompt on one image-prompt row. status is
// 'generated' (from PRESTO Ollama) or 'saved' (operator edit). source_hash lets
// a later image-prompt edit flag it stale; setting it here clears any stale flag.
function setI2vPrompt(projectId, index, text, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const idx = Math.round(Number(index));
  const row = (Array.isArray(state.image_prompts) ? state.image_prompts : []).find((r) => r.index === idx);
  if (!row) {
    const e = new Error(`No image prompt at index ${index}.`); e.statusCode = 400; throw e;
  }
  row.i2v_prompt = {
    text: typeof text === 'string' ? text.trim() : '',
    status: options.status === 'generated' ? 'generated' : 'saved',
    source_hash: scriptHash(row.text),
    stale: false,
    updated_at: nowIso(),
  };
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Manually clear a row's image-to-video prompt (operator "Clear i2v prompt").
// Removes the i2v_prompt entirely so the row becomes eligible for normal i2v
// generation again. No-op if the row or its i2v prompt is absent.
function clearI2vPrompt(projectId, index, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const idx = Math.round(Number(index));
  const row = (Array.isArray(state.image_prompts) ? state.image_prompts : []).find((r) => r.index === idx);
  if (row && row.i2v_prompt) {
    delete row.i2v_prompt;
    state.updated_at = nowIso();
    writeStateAtomic(dir, state);
  }
  return state;
}

// True when a row has a non-empty i2v prompt (a populated i2v slot).
function hasI2vPrompt(row) {
  return Boolean(row && row.i2v_prompt && typeof row.i2v_prompt.text === 'string' && row.i2v_prompt.text.trim());
}

// Set (or delete, when `review` is null) one image-prompt row's image_review.
// The row must exist — a review can only attach to a real prompt slot.
function setImageReview(projectId, index, review, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const idx = Math.round(Number(index));
  const row = (Array.isArray(state.image_prompts) ? state.image_prompts : []).find((r) => r.index === idx);
  if (!row) {
    const e = new Error(`No image prompt at index ${index}.`); e.statusCode = 404; throw e;
  }
  if (review == null) delete row.image_review;
  else row.image_review = review;
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Set (or delete, when `review` is null) one row's video_review. The row must
// exist — a review can only attach to a real prompt slot.
function setVideoReview(projectId, index, review, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const idx = Math.round(Number(index));
  const row = (Array.isArray(state.image_prompts) ? state.image_prompts : []).find((r) => r.index === idx);
  if (!row) {
    const e = new Error(`No image prompt at index ${index}.`); e.statusCode = 404; throw e;
  }
  if (review == null) delete row.video_review;
  else row.video_review = review;
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// ── Visual Plan persistence (domain logic lives in super-focus-visual-plan.js) ──

// Recompute per-row assignment provenance staleness on the image prompts.
// Rows created from an assignment carry assignment_id + assignment_hash; when
// the assignment's content hash changes the row is flagged (never deleted),
// and a byte-identical assignment revert clears the flag. Legacy rows without
// provenance are left alone (unknown, never mass-flagged).
function applyAssignmentStaleness(state) {
  const plan = state.visual_plan;
  const rows = Array.isArray(state.image_prompts) ? state.image_prompts : [];
  rows.forEach((row) => {
    if (!row || !row.assignment_id) return;
    const current = plan
      ? (plan.assignments || []).find((a) => a.assignment_id === row.assignment_id) || null
      : null;
    if (!current) {
      row.assignment_stale = true;
      row.assignment_stale_reason = 'The assignment this prompt came from no longer exists.';
      return;
    }
    if (row.assignment_hash && current.assignment_hash !== row.assignment_hash) {
      row.assignment_stale = true;
      row.assignment_stale_reason = 'Assignment changed — review this prompt against it.';
    } else {
      delete row.assignment_stale;
      delete row.assignment_stale_reason;
    }
  });
}

// Read-only: the plan with freshly computed staleness against the saved script.
function readVisualPlan(projectId, options = {}) {
  const state = loadProject(projectId, options);
  if (!state.visual_plan) return null;
  return visualPlan.refreshPlanStaleness(state.visual_plan, state.script);
}

// Persist a plan produced by a domain operation. Validates before writing (a
// stale plan skips range validation — it references the old script), then
// refreshes downstream prompt provenance flags.
function saveVisualPlan(projectId, plan, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const refreshed = visualPlan.refreshPlanStaleness(plan, state.script);
  visualPlan.validatePlan(refreshed, refreshed.stale ? undefined : state.script);
  state.visual_plan = refreshed;
  applyAssignmentStaleness(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
}

// Fill empty image-prompt slots with prompts created FROM approved assignments,
// carrying full provenance. Existing rows are never touched; new rows land in
// the first empty index gaps (same slot discipline as fillEmptyImagePrompts).
function fillPromptsFromAssignments(projectId, items, options = {}) {
  const dir = stateDir(projectId, options);
  const state = loadProject(projectId, options);
  const capacity = Number(options.capacity) > 0 ? Math.round(Number(options.capacity)) : IMAGE_PROMPT_CAPACITY;
  const byIndex = {};
  (Array.isArray(state.image_prompts) ? state.image_prompts : []).forEach((r) => {
    if (r && r.index != null && typeof r.text === 'string' && r.text.trim()) byIndex[r.index] = r;
  });
  const emptyIndexes = [];
  for (let i = 1; i <= capacity; i += 1) if (!byIndex[i]) emptyIndexes.push(i);
  const clean = (Array.isArray(items) ? items : []).filter((it) => it
    && typeof it.text === 'string' && it.text.trim()
    && it.assignment && it.assignment.assignment_id);
  const placed = [];
  const overflow = [];
  clean.forEach((it, k) => {
    if (k >= emptyIndexes.length) { overflow.push(it.assignment.assignment_id); return; }
    const idx = emptyIndexes[k];
    byIndex[idx] = {
      index: idx,
      text: it.text.trim(),
      status: 'saved',
      prompt_source: 'assignment',
      assignment_id: it.assignment.assignment_id,
      assignment_hash: it.assignment.assignment_hash,
      prompt_hash: generatedPromptHash(it.text.trim()),
      beat_id: it.assignment.beat_id,
    };
    placed.push({ index: idx, assignment_id: it.assignment.assignment_id });
  });
  state.image_prompts = Object.values(byIndex).sort((a, b) => a.index - b.index);
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return { state, placed, overflow };
}

module.exports = {
  SCHEMA_VERSION,
  STATE_FILENAME,
  STAGES,
  APPROVAL_KEYS,
  PROJECT_ID_RE,
  ARCHIVED_DIRNAME,
  TRASH_DIRNAME,
  resolveRoot,
  resolveArchivedRoot,
  resolveTrashRoot,
  slugify,
  assertValidProjectId,
  emptyState,
  inferStage,
  createProject,
  loadProject,
  listProjects,
  listArchivedProjects,
  projectLifecycle,
  archiveProject,
  restoreProject,
  deleteProject,
  saveTitle,
  saveScript,
  IMAGE_PROMPT_CAPACITY,
  INFOGRAPHIC_PROMPT_CAPACITY,
  generatedPromptHash,
  normalizeGeneratedPromptHash,
  saveImagePrompts,
  fillEmptyImagePrompts,
  fillEmptyInfographicPrompts,
  saveInfographicPrompts,
  saveImagePrompt,
  saveInfographicPrompt,
  setI2vPrompt,
  clearI2vPrompt,
  hasI2vPrompt,
  clearImageStale,
  saveScriptEvaluation,
  readScriptEvaluation,
  readVisualPlan,
  saveVisualPlan,
  fillPromptsFromAssignments,
  setImageReview,
  setVideoReview,
};
