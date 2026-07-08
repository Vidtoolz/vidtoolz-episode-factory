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

function resolveRoot(options = {}) {
  if (options && options.root) return options.root;
  if (process.env.SUPER_FOCUS_ROOT) return process.env.SUPER_FOCUS_ROOT;
  return path.join(__dirname, 'super-focus-projects');
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
    created_at: created,
    updated_at: fields.updated_at || created,
  };
}

function scriptHash(script) {
  return crypto.createHash('sha1').update(String(script || '')).digest('hex').slice(0, 16);
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

function stateDir(projectId, options) {
  return path.join(resolveRoot(options), assertValidProjectId(projectId));
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
  const parsed = JSON.parse(raw);
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
  if (fs.existsSync(dir)) {
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

function listProjects(options = {}) {
  const root = resolveRoot(options);
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
  state.stage = inferStage(state);
  state.updated_at = nowIso();
  writeStateAtomic(dir, state);
  return state;
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
    if (set.has(r.index) && r.image_stale) { delete r.image_stale; changed = true; }
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
function upsertPromptSlot(records, index, text) {
  const idx = Math.round(Number(index));
  if (!Number.isFinite(idx) || idx < 1) {
    const e = new Error('Prompt index must be a positive integer.'); e.statusCode = 400; throw e;
  }
  const clean = typeof text === 'string' ? text.trim() : '';
  const existing = (Array.isArray(records) ? records : []).find((r) => r.index === idx) || null;
  const list = (Array.isArray(records) ? records : []).filter((r) => r.index !== idx);
  if (clean) {
    // Preserve downstream fields (i2v_prompt, images) attached to this row; only
    // the text changes. If the source text changed, flag the derived work as
    // possibly stale — never delete it: the i2v prompt (if any) AND any image
    // that was generated from the old text (it no longer cleanly matches).
    const merged = Object.assign({}, existing || {}, { index: idx, text: clean, status: 'saved' });
    if (existing && existing.text !== clean) {
      if (merged.i2v_prompt) merged.i2v_prompt = Object.assign({}, merged.i2v_prompt, { stale: true });
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
  state.image_prompts = upsertPromptSlot(state.image_prompts, index, text);
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

module.exports = {
  SCHEMA_VERSION,
  STATE_FILENAME,
  STAGES,
  APPROVAL_KEYS,
  PROJECT_ID_RE,
  resolveRoot,
  slugify,
  assertValidProjectId,
  emptyState,
  inferStage,
  createProject,
  loadProject,
  listProjects,
  saveTitle,
  saveScript,
  saveImagePrompts,
  saveInfographicPrompts,
  saveImagePrompt,
  saveInfographicPrompt,
  setI2vPrompt,
  clearImageStale,
};
