'use strict';

// Motion Graphics Studio — local, file-backed project state.
//
// Canonical state lives LOCALLY (never on VIDNAS): one JSON file per project
// under motion-graphics-projects/<project_id>/motion-graphics.json. Atomic
// tmp+rename writes; no binaries in JSON (media lands in the VIDNAS media
// namespace later and is referenced only by path). Separate from Super Focus.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const templates = require('./motion-graphics-templates.js');

const SCHEMA_VERSION = 1;
const STATE_FILENAME = 'motion-graphics.json';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const CARD_ID_RE = /^card-[a-f0-9]{6,16}$/;

function nowIso() { return new Date().toISOString(); }
function shortId() { return crypto.randomBytes(4).toString('hex'); }

function slugify(text) {
  const base = String(text || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return base || 'untitled';
}

function assertValidProjectId(projectId) {
  const id = String(projectId == null ? '' : projectId).trim();
  if (!ID_RE.test(id)) { const e = new Error('Invalid Motion Graphics project id.'); e.statusCode = 400; throw e; }
  return id;
}
function assertValidCardId(cardId) {
  const id = String(cardId == null ? '' : cardId).trim();
  if (!CARD_ID_RE.test(id)) { const e = new Error('Invalid Motion Graphics card id.'); e.statusCode = 400; throw e; }
  return id;
}

function resolveRoot(options = {}) {
  return options.root || process.env.MOTION_GRAPHICS_ROOT || path.join(__dirname, 'motion-graphics-projects');
}
function projectDir(projectId, options = {}) {
  // path.basename is a second guard even though the id is slug-validated.
  return path.join(resolveRoot(options), path.basename(assertValidProjectId(projectId)));
}
function projectFile(projectId, options = {}) {
  return path.join(projectDir(projectId, options), STATE_FILENAME);
}

function writeJsonAtomic(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function saveState(state, options = {}) {
  state.updated_at = options.now || nowIso();
  writeJsonAtomic(projectFile(state.project_id, options), state);
  return state;
}

function createProject(input = {}, options = {}) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const slug = slugify(title || 'untitled-motion');
  const projectId = `${slug}-${shortId()}`;
  const state = {
    schema_version: SCHEMA_VERSION,
    project_id: projectId,
    slug,
    title,
    source: { type: 'manual', source_id: null, script_hash: null, script: '' },
    cards: [],
    jobs: [],
    created_at: options.now || nowIso(),
    updated_at: options.now || nowIso(),
  };
  return saveState(state, options);
}

function loadProject(projectId, options = {}) {
  const file = projectFile(projectId, options);
  if (!fs.existsSync(file)) { const e = new Error('Motion Graphics project not found.'); e.statusCode = 404; throw e; }
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(state.cards)) state.cards = [];
  if (!Array.isArray(state.jobs)) state.jobs = [];
  if (!state.source || typeof state.source !== 'object') state.source = { type: 'manual', source_id: null, script_hash: null, script: '' };
  return state;
}

function listProjects(options = {}) {
  const root = resolveRoot(options);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ID_RE.test(d.name))
    .map((d) => {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(root, d.name, STATE_FILENAME), 'utf8'));
        return { project_id: state.project_id, title: state.title || '', card_count: (state.cards || []).length, updated_at: state.updated_at || null };
      } catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

function saveProjectTitle(projectId, title, options = {}) {
  const state = loadProject(projectId, options);
  state.title = typeof title === 'string' ? title.trim() : '';
  return saveState(state, options);
}

// Save the source script/idea text (manual paste). Read-only w.r.t. Super Focus;
// this never writes back to any Super Focus project.
function saveSource(projectId, source = {}, options = {}) {
  const state = loadProject(projectId, options);
  state.source = {
    type: typeof source.type === 'string' ? source.type : 'manual',
    source_id: source.source_id || null,
    script_hash: source.script_hash || null,
    script: typeof source.script === 'string' ? source.script : (state.source.script || ''),
  };
  return saveState(state, options);
}

function addCard(projectId, input = {}, options = {}) {
  const state = loadProject(projectId, options);
  const type = templates.templateFor(input.type) ? input.type : 'title';
  const card = Object.assign({ card_id: `card-${shortId()}${shortId().slice(0, 2)}` }, templates.buildDefaultCard(type, input));
  state.cards.push(card);
  saveState(state, options);
  return { state, card };
}

function findCard(state, cardId) {
  const id = assertValidCardId(cardId);
  return (state.cards || []).find((c) => c.card_id === id) || null;
}

// Update a card's params/format/style/type/engine (draft edits only — never a
// render). Returns { state, card }.
function updateCardParams(projectId, cardId, patch = {}, options = {}) {
  const state = loadProject(projectId, options);
  const card = findCard(state, cardId);
  if (!card) { const e = new Error('Card not found.'); e.statusCode = 404; throw e; }
  if (patch.type && templates.templateFor(patch.type) && patch.type !== card.type) {
    // Switching type resets to that type's default params + recommendation.
    const fresh = templates.buildDefaultCard(patch.type, { params: patch.params, format: patch.format, style: patch.style });
    card.type = fresh.type;
    card.params = fresh.params;
    card.recommended_engine = fresh.recommended_engine;
    card.recommendation_reason = fresh.recommendation_reason;
    card.candidate_only = fresh.candidate_only;
  } else if (patch.params && typeof patch.params === 'object') {
    card.params = Object.assign({}, templates.defaultParamsForType(card.type), card.params, patch.params);
  }
  if (patch.format && typeof patch.format === 'object') card.format = templates.normalizeFormat(Object.assign({}, card.format, patch.format));
  if (patch.style && typeof patch.style === 'object') card.style = templates.normalizeStyle(Object.assign({}, card.style, patch.style));
  if (typeof patch.engine === 'string' && ['hyperframes', 'remotion'].indexOf(patch.engine) !== -1) card.engine = patch.engine;
  card.status = 'draft';
  saveState(state, options);
  return { state, card };
}

module.exports = {
  SCHEMA_VERSION,
  STATE_FILENAME,
  ID_RE,
  CARD_ID_RE,
  slugify,
  assertValidProjectId,
  assertValidCardId,
  resolveRoot,
  projectDir,
  projectFile,
  createProject,
  loadProject,
  listProjects,
  saveProjectTitle,
  saveSource,
  addCard,
  findCard,
  updateCardParams,
};
