/*
 * Idea Engine — domain + persistence (pure fs + validation, NO model calls).
 *
 * Generates nothing itself: the server calls Ollama via callOllamaChat with
 * prompts from idea-engine-prompts.js (same separation as topic-idea-scout.js).
 * This module owns: the 12 configurable category definitions, the idea state
 * store (12 x 30 sub-topics), strict set validation, last-known-good
 * preservation, review/promotion bookkeeping, and atomic writes.
 *
 * Relationship to the existing Idea Module (~/vidtoolz-idea-module): Idea
 * Engine is a SEPARATE bounded exploration layer upstream of that module's
 * curation gate. It never reads or writes the Idea Module's data, never
 * bypasses its WIP limits, and promotes into Super Focus (this repo) only.
 *
 * Storage: <root>/categories.json + <root>/ideas.json (root git-ignored,
 * env-overridable via IDEA_ENGINE_ROOT). Single-writer model: the server
 * serializes mutations per category; every write is tmp+rename atomic.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const CATEGORIES_FILENAME = 'categories.json';
const IDEAS_FILENAME = 'ideas.json';

const CATEGORY_COUNT = 12;
const IDEAS_PER_CATEGORY = 30;

// Field bounds: model output is untrusted input; anything outside these is
// rejected during validation, never truncated silently.
const MAX_TITLE_LEN = 120;
const MAX_FIELD_LEN = 700;
const MAX_HOOK_LEN = 300;
const MIN_FIELD_LEN = 10;

const IDEA_ID_RE = /^ie-[a-f0-9]{8}$/;
const CATEGORY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PROMOTION_STATES = ['none', 'promoted', 'failed'];
const IDEA_STATUSES = ['generated', 'reviewed'];

// How the CURRENT content of an idea came to be. A record is born 'generated',
// 'replacement_generated', or 'manual' (typed in by the operator, no model
// involved); any manual edit moves it to 'manually_edited' (the pre-edit
// content survives in edit_history / original_content).
const CONTENT_ORIGINS = ['generated', 'manually_edited', 'replacement_generated', 'manual'];
// Origins that make a topic AUTHORITATIVE: refresh and vacancy fill must
// never replace it. Promoted and reviewed topics are protected independently.
const AUTHORITATIVE_ORIGINS = ['manual', 'manually_edited'];

// The fields a manual edit may change. Everything else (id, category,
// provenance, promotion) is server-owned and immutable through editing.
const EDITABLE_FIELDS = [
  'title', 'premise', 'why_vidtoolz', 'why_short', 'tension',
  'hook', 'viewer_takeaway', 'visual_opportunity',
];
const OPTIONAL_EDIT_FIELDS = ['hook', 'viewer_takeaway', 'visual_opportunity'];

// Structured removal reasons (bounded editorial metadata — these enum values
// may steer replacement prompts; free-text notes never enter a prompt).
// 'superseded_by_refresh' is system-assigned by a full category refresh and is
// excluded from duplicate-exclusion logic so a refresh never poisons future
// generation the way a deliberate human removal should.
const REMOVAL_REASONS = [
  'duplicate', 'too_broad', 'too_narrow', 'weak_vidtoolz_fit', 'poor_shorts_fit',
  'already_covered', 'too_tool_specific', 'weak_tension', 'not_visually_explainable',
  'inaccurate', 'superseded_by_refresh', 'other',
];
const MAX_REMOVAL_NOTE_LEN = 500;

// Reject tag-like sequences in content fields ("<script", "</b", "<!--");
// plain "<" followed by space/digit stays legal ("a < b", "<3 minutes").
const TAG_LIKE_RE = /<[a-z!/]/i;

// Initial configurable category set. No canonical 12-category taxonomy exists
// in the estate (verified 2026-07-26: the only 12-item doctrine artifact is the
// 12-EPISODE doctrine series in vidtoolz-strategy-and-schedule.md), so this is
// seeded domain data grounded in the five content pillars + doctrine docs, and
// persisted to categories.json where Mikko can edit it without code changes.
const DEFAULT_CATEGORIES = [
  {
    id: 'ai-video-production-systems',
    name: 'AI Video Production Systems',
    description: 'How a real AI-assisted video production system is put together: pipelines, gates, handoffs, and the boundary between generating assets and finishing videos.',
    channel_relevance: 'This is the channel’s core promise — systems over tools. VIDTOOLZ exists to show how AI becomes part of a production system instead of a pile of generated assets.',
    generation_guidance: 'Prefer durable system-design principles (gates, stages, approval points, asset flow) over any specific tool. Every idea should expose a system failure or a system rule.',
  },
  {
    id: 'prompting-and-specification',
    name: 'Prompting and Specification',
    description: 'Treating prompts as production specifications: what a prompt can and cannot commit a video to, and where specification beats improvisation.',
    channel_relevance: 'Viewers drown in prompt tips. VIDTOOLZ reframes prompting as specification work — a production discipline, not a magic phrase collection.',
    generation_guidance: 'Avoid prompt-pack listicles and tool-specific syntax. Prefer ideas about intent, constraints, review of generated output, and why "better prompts" cannot replace production decisions.',
  },
  {
    id: 'human-ai-collaboration',
    name: 'Human–AI Collaboration',
    description: 'The working split between human and machine in real production: what to delegate, what to keep, and how collaboration changes the creator’s job.',
    channel_relevance: 'The channel’s worldview is that human judgment is the moat. Collaboration mechanics — not replacement fantasies — are what serious creators actually need.',
    generation_guidance: 'Prefer concrete delegation decisions and their consequences. Avoid "will AI replace you" hype in both directions.',
  },
  {
    id: 'creative-direction-and-taste',
    name: 'Creative Direction and Taste',
    description: 'Taste, direction, and editorial authority when the raw material is generated: choosing, rejecting, and shaping instead of producing from scratch.',
    channel_relevance: 'AI makes production cheap and direction expensive. VIDTOOLZ argues taste and approval are the creator’s real product — this category carries that argument.',
    generation_guidance: 'Prefer ideas that expose how taste operates in practice (rejection rates, reference frames, style consistency). Avoid abstract philosophy without a production consequence.',
  },
  {
    id: 'scripts-and-storytelling',
    name: 'Scripts and Storytelling',
    description: 'The script as the production spine: claims, structure, hooks, and why spoken-word writing decides what the visuals are allowed to do.',
    channel_relevance: 'VIDTOOLZ doctrine: the script is the spine, visuals serve the spoken idea. Script craft for short AI-assisted videos is a core teaching lane.',
    generation_guidance: 'Prefer script-level rules (one claim per video, misconception-first openings, endings without needy CTAs). Avoid generic screenwriting theory for films.',
  },
  {
    id: 'visual-planning-and-communication',
    name: 'Visual Planning and Communication',
    description: 'Planning what appears on screen and why: mapping script beats to visuals, visual functions (clarify, contrast, evidence), and avoiding decorative filler.',
    channel_relevance: 'The gap between "generated a nice image" and "the visual explains the idea" is where most AI videos fail — exactly the failure VIDTOOLZ teaches viewers to close.',
    generation_guidance: 'Prefer ideas about visual intent, beat mapping, infographics vs atmosphere, and when a visual should be rejected. Avoid tool-specific image-generation tips.',
  },
  {
    id: 'generation-review-and-quality-control',
    name: 'Generation, Review, and Quality Control',
    description: 'Review gates for generated material: what to check, when to regenerate, when to stop, and how quality control differs from perfectionism.',
    channel_relevance: 'Review is the invisible half of AI production. VIDTOOLZ’s own gate-driven system is the proof material for this category.',
    generation_guidance: 'Prefer decision rules (accept/reject criteria, batch review, provenance) over tool features. Avoid "top mistakes" listicles without a specific reviewing principle.',
  },
  {
    id: 'automation-agents-and-workflows',
    name: 'Automation, Agents, and Workflows',
    description: 'What is safe to automate in a creative pipeline, what agents actually do well, and where automation quietly destroys editorial control.',
    channel_relevance: 'Serious creators are being sold full automation. VIDTOOLZ’s position — automate transport, never approval — needs concrete, durable arguments.',
    generation_guidance: 'Prefer boundaries (what to automate vs supervise) and failure stories with a rule. Avoid agent-framework news and product comparisons.',
  },
  {
    id: 'creator-productivity-and-bottlenecks',
    name: 'Creator Productivity and Bottlenecks',
    description: 'Where solo creator time actually goes in AI-assisted production: real bottlenecks, decision fatigue, unfinished-work piles, and throughput rules.',
    channel_relevance: 'The audience’s stated pain is drowning — in tools, assets, and half-finished experiments. Naming and fixing bottlenecks is direct service to that pain.',
    generation_guidance: 'Prefer ideas grounded in the finish-rate problem (assets vs finished videos, decision load, WIP limits). Avoid generic productivity advice that fits any office job.',
  },
  {
    id: 'ai-era-creative-careers',
    name: 'AI-Era Creative Careers',
    description: 'What durable creative work looks like as generation gets cheap: skills that compound, skills that evaporate, and honest positioning for working creators.',
    channel_relevance: 'Viewers fear obsolescence. VIDTOOLZ answers with a grounded operator’s view — which capabilities keep value and why — without hype or doom.',
    generation_guidance: 'Prefer specific capability arguments (direction, judgment, finishing, ownership of a system) over economy-wide speculation. Avoid "make money with AI" framings.',
  },
  {
    id: 'ai-doctrine-misconceptions-philosophy',
    name: 'AI Doctrine, Misconceptions, and Philosophy',
    description: 'The channel’s argumentative lane: naming widespread misconceptions about AI video and replacing them with a working model a creator can verify.',
    channel_relevance: 'The strongest VIDTOOLZ format is misconception-first ("Most creators think X. Actually Y."). This category is that format’s home.',
    generation_guidance: 'Every idea must name a real, common misconception and the working model that replaces it. Avoid strawmen and avoid tool-news reactions.',
  },
  {
    id: 'building-vidtoolz-in-public',
    name: 'Building VIDTOOLZ in Public',
    description: 'Lessons from building the actual VIDTOOLZ production system: what broke, what rule fixed it, and what a solo creator can copy — proof, not product demo.',
    channel_relevance: 'The working system is the channel’s evidence base. System lessons convert authority into teachable, durable principles.',
    generation_guidance: 'Use the system as proof of a general principle, never as a software tour. Each idea must end in a rule any solo creator could apply without VIDTOOLZ’s stack.',
  },
];

function resolveRoot(options = {}) {
  if (options && options.root) return options.root;
  if (process.env.IDEA_ENGINE_ROOT) return process.env.IDEA_ENGINE_ROOT;
  return path.join(__dirname, 'idea-engine-state');
}

function nowIso() {
  return new Date().toISOString();
}

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function newIdeaId() {
  return `ie-${shortId()}`;
}

function newBatchId() {
  return `ieb-${Date.now().toString(36)}-${shortId()}`;
}

function assertValidIdeaId(value) {
  const id = String(value || '').trim();
  if (!IDEA_ID_RE.test(id)) {
    const error = new Error('Invalid Idea Engine idea id.');
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function assertValidCategoryId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 80 || !CATEGORY_ID_RE.test(id)) {
    const error = new Error('Invalid Idea Engine category id.');
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
  return filePath;
}

function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null; // absent is normal (first run)
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch (_) {
    const error = new Error(`Idea Engine ${label} file is corrupt or unreadable (invalid JSON).`);
    error.statusCode = 422;
    throw error;
  }
}

// ── Categories ───────────────────────────────────────────────────────────────

const CATEGORY_STATUSES = ['active', 'removed'];
const CATEGORY_SOURCES = ['seed', 'manual'];
const MAX_CATEGORY_NAME_LEN = 80;

function normalizeCategory(entry, index = 0) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim();
  if (!CATEGORY_ID_RE.test(id)) return null;
  const created = typeof entry.created_at === 'string' ? entry.created_at : null;
  return {
    id,
    name: String(entry.name || id).trim(),
    description: String(entry.description || '').trim(),
    channel_relevance: String(entry.channel_relevance || '').trim(),
    generation_guidance: String(entry.generation_guidance || '').trim(),
    // Management metadata (Phase 3). Legacy entries normalize to seed/active
    // with their file order as position — deterministic across loads because
    // the file order is stable and positions are persisted on first mutation.
    source: CATEGORY_SOURCES.includes(entry.source) ? entry.source : 'seed',
    status: CATEGORY_STATUSES.includes(entry.status) ? entry.status : 'active',
    position: Number.isInteger(entry.position) ? entry.position : index,
    created_at: created,
    updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : created,
    removed_at: typeof entry.removed_at === 'string' ? entry.removed_at : null,
  };
}

// Loads category definitions, seeding categories.json with the default set on
// first use. Categories are persisted domain data (editable on disk), not
// hard-coded UI strings; unknown/malformed entries are dropped, and an empty
// or missing file falls back to the defaults without overwriting user edits
// beyond the initial seed.
function loadCategories(options = {}) {
  const file = path.join(resolveRoot(options), CATEGORIES_FILENAME);
  const existing = readJsonFile(file, 'categories');
  if (existing && Array.isArray(existing.categories)) {
    const normalized = existing.categories
      .map((entry, index) => normalizeCategory(entry, index))
      .filter(Boolean)
      .sort((a, b) => a.position - b.position);
    if (normalized.length > 0) return normalized;
  }
  const seeded = DEFAULT_CATEGORIES.map((entry, index) => normalizeCategory(entry, index)).filter(Boolean);
  writeJsonAtomic(file, {
    schema_version: SCHEMA_VERSION,
    seeded_at: nowIso(),
    updated_at: nowIso(),
    categories: seeded,
  });
  return seeded;
}

// Removed categories stay on disk (their idea blocks and history remain in
// ideas.json untouched) but are hidden from every view and generation path.
function activeCategories(options = {}) {
  return loadCategories(options).filter((c) => c.status === 'active');
}

function writeCategories(categories, options = {}) {
  if (!Array.isArray(categories) || categories.length === 0) {
    const error = new Error('Refusing to write an empty or invalid category list.');
    error.statusCode = 500;
    throw error;
  }
  const normalized = categories.map((entry, index) => normalizeCategory(entry, index)).filter(Boolean);
  if (normalized.length !== categories.length) {
    const error = new Error('Refusing to write categories: one or more entries failed validation.');
    error.statusCode = 500;
    throw error;
  }
  const file = path.join(resolveRoot(options), CATEGORIES_FILENAME);
  const existing = readJsonFile(file, 'categories') || {};
  writeJsonAtomic(file, {
    schema_version: SCHEMA_VERSION,
    seeded_at: typeof existing.seeded_at === 'string' ? existing.seeded_at : nowIso(),
    updated_at: nowIso(),
    categories: normalized,
  });
  return normalized;
}

function normalizeCategoryName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function categorySlug(name) {
  const slug = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'category';
}

function assertCategoryName(name, categories, selfId = null) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const error = new Error('A category name is required.');
    error.statusCode = 400;
    error.code = 'category_name_required';
    throw error;
  }
  if (trimmed.length > MAX_CATEGORY_NAME_LEN) {
    const error = new Error(`Category name exceeds ${MAX_CATEGORY_NAME_LEN} characters.`);
    error.statusCode = 400;
    error.code = 'category_name_too_long';
    throw error;
  }
  if (TAG_LIKE_RE.test(trimmed)) {
    const error = new Error('Category name contains HTML-like markup.');
    error.statusCode = 400;
    error.code = 'category_name_invalid';
    throw error;
  }
  const normalized = normalizeCategoryName(trimmed);
  const clash = categories.find((c) => c.status === 'active' && c.id !== selfId
    && normalizeCategoryName(c.name) === normalized);
  if (clash) {
    const error = new Error(`A category named "${clash.name}" already exists.`);
    error.statusCode = 409;
    error.code = 'category_name_duplicate';
    throw error;
  }
  return trimmed;
}

// Creates a MANUAL category. No topics are generated; the category starts
// empty and the operator adds or generates topics explicitly.
function createCategory(fields, options = {}) {
  const source = fields && typeof fields === 'object' ? fields : {};
  const categories = loadCategories(options);
  const name = assertCategoryName(source.name, categories);
  const description = String(source.description || '').trim().slice(0, MAX_FIELD_LEN);
  if (TAG_LIKE_RE.test(description)) {
    const error = new Error('Category description contains HTML-like markup.');
    error.statusCode = 400;
    throw error;
  }
  let id = categorySlug(name);
  while (categories.some((c) => c.id === id)) id = `${categorySlug(name)}-${shortId().slice(0, 4)}`;
  const category = normalizeCategory({
    id,
    name,
    description,
    source: 'manual',
    status: 'active',
    position: categories.reduce((max, c) => Math.max(max, c.position), -1) + 1,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  writeCategories(categories.concat([category]), options);
  return category;
}

// Rename / edit description. The category ID is stable across renames — all
// topic records reference the ID, so child topics and history are untouched.
function updateCategory(categoryId, fields, options = {}) {
  const id = assertValidCategoryId(categoryId);
  const source = fields && typeof fields === 'object' ? fields : {};
  const categories = loadCategories(options);
  const category = categories.find((c) => c.id === id);
  if (!category) {
    const error = new Error('Unknown Idea Engine category id.');
    error.statusCode = 404;
    throw error;
  }
  let changed = false;
  if (source.name !== undefined) {
    const name = assertCategoryName(source.name, categories, id);
    if (name !== category.name) { category.name = name; changed = true; }
  }
  if (source.description !== undefined) {
    const description = String(source.description || '').trim().slice(0, MAX_FIELD_LEN);
    if (TAG_LIKE_RE.test(description)) {
      const error = new Error('Category description contains HTML-like markup.');
      error.statusCode = 400;
      throw error;
    }
    if (description !== category.description) { category.description = description; changed = true; }
  }
  if (!changed) {
    const error = new Error('No changes to save.');
    error.statusCode = 400;
    error.code = 'no_changes';
    throw error;
  }
  category.updated_at = nowIso();
  writeCategories(categories, options);
  return category;
}

// Move a category one step up or down in the persisted display order.
function moveCategory(categoryId, direction, options = {}) {
  const id = assertValidCategoryId(categoryId);
  if (direction !== 'up' && direction !== 'down') {
    const error = new Error('direction must be "up" or "down".');
    error.statusCode = 400;
    throw error;
  }
  const categories = loadCategories(options);
  const actives = categories.filter((c) => c.status === 'active');
  const index = actives.findIndex((c) => c.id === id);
  if (index === -1) {
    const error = new Error('Unknown Idea Engine category id.');
    error.statusCode = 404;
    throw error;
  }
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= actives.length) {
    const error = new Error(`Category is already at the ${direction === 'up' ? 'top' : 'bottom'}.`);
    error.statusCode = 400;
    error.code = 'already_at_edge';
    throw error;
  }
  const a = actives[index];
  const b = actives[target];
  const tmp = a.position; a.position = b.position; b.position = tmp;
  a.updated_at = nowIso(); b.updated_at = nowIso();
  writeCategories(categories, options);
  return a;
}

// Archive a category: status -> removed. Its topics are NOT deleted — the
// ideas.json block (active topics, removal history, promoted history) stays
// intact and out of view, so removal never orphans or destroys topic data and
// is reversible by flipping status back to active. Promoted Super Focus
// projects are independent copies and are unaffected.
function removeCategory(categoryId, options = {}) {
  const id = assertValidCategoryId(categoryId);
  const categories = loadCategories(options);
  const category = categories.find((c) => c.id === id);
  if (!category) {
    const error = new Error('Unknown Idea Engine category id.');
    error.statusCode = 404;
    throw error;
  }
  if (category.status === 'removed') {
    const error = new Error('This category is already removed.');
    error.statusCode = 409;
    error.code = 'category_already_removed';
    throw error;
  }
  category.status = 'removed';
  category.removed_at = nowIso();
  category.updated_at = category.removed_at;
  writeCategories(categories, options);
  const state = loadState(options);
  const block = state.categories[id];
  return {
    category,
    archived_active_topics: block ? block.ideas.length : 0,
  };
}

function categoryById(categories, categoryId) {
  return categories.find((c) => c.id === categoryId) || null;
}

// ── Idea state ───────────────────────────────────────────────────────────────

function emptyPromotion() {
  return { state: 'none', project_id: null, promoted_at: null, error: null };
}

function normalizeIdea(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim();
  if (!IDEA_ID_RE.test(id)) return null;
  const promotion = entry.promotion && typeof entry.promotion === 'object' ? entry.promotion : {};
  const created = typeof entry.created_at === 'string' ? entry.created_at : nowIso();
  const removed = entry.removed && typeof entry.removed === 'object'
    ? {
        at: typeof entry.removed.at === 'string' ? entry.removed.at : nowIso(),
        reason: REMOVAL_REASONS.includes(entry.removed.reason) ? entry.removed.reason : 'other',
        note: typeof entry.removed.note === 'string' ? entry.removed.note.slice(0, MAX_REMOVAL_NOTE_LEN) : '',
      }
    : null;
  return {
    id,
    category_id: String(entry.category_id || '').trim(),
    title: String(entry.title || '').trim(),
    premise: String(entry.premise || '').trim(),
    why_vidtoolz: String(entry.why_vidtoolz || '').trim(),
    why_short: String(entry.why_short || '').trim(),
    tension: String(entry.tension || '').trim(),
    hook: typeof entry.hook === 'string' ? entry.hook.trim() : '',
    viewer_takeaway: typeof entry.viewer_takeaway === 'string' ? entry.viewer_takeaway.trim() : '',
    visual_opportunity: typeof entry.visual_opportunity === 'string' ? entry.visual_opportunity.trim() : '',
    status: IDEA_STATUSES.includes(entry.status) ? entry.status : 'generated',
    reviewed_at: typeof entry.reviewed_at === 'string' ? entry.reviewed_at : null,
    created_at: created,
    updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : created,
    batch_id: String(entry.batch_id || '').trim(),
    model: typeof entry.model === 'string' ? entry.model : '',
    // Editorial lifecycle (Phase 2). Legacy records normalize to the defaults:
    // model-generated, unedited, active.
    content_origin: CONTENT_ORIGINS.includes(entry.content_origin) ? entry.content_origin : 'generated',
    edit_revision: Number.isInteger(entry.edit_revision) && entry.edit_revision >= 0 ? entry.edit_revision : 0,
    edit_history: Array.isArray(entry.edit_history) ? entry.edit_history.filter((e) => e && typeof e === 'object') : [],
    original_content: entry.original_content && typeof entry.original_content === 'object' ? entry.original_content : null,
    removed,
    removal_history: Array.isArray(entry.removal_history) ? entry.removal_history.filter((e) => e && typeof e === 'object') : [],
    replacement_for_idea_id: typeof entry.replacement_for_idea_id === 'string' ? entry.replacement_for_idea_id : null,
    replaced_by_idea_id: typeof entry.replaced_by_idea_id === 'string' ? entry.replaced_by_idea_id : null,
    promotion: {
      state: PROMOTION_STATES.includes(promotion.state) ? promotion.state : 'none',
      project_id: typeof promotion.project_id === 'string' ? promotion.project_id : null,
      promoted_at: typeof promotion.promoted_at === 'string' ? promotion.promoted_at : null,
      promoted_revision: Number.isInteger(promotion.promoted_revision) ? promotion.promoted_revision : null,
      error: typeof promotion.error === 'string' ? promotion.error : null,
    },
  };
}

// Snapshot of the editable content of an idea (for edit history / provenance).
function contentSnapshot(idea) {
  const out = {};
  for (const field of EDITABLE_FIELDS) out[field] = idea[field] || '';
  return out;
}

function emptyCategoryBlock() {
  return { batch: null, ideas: [], removed: [], last_failure: null, promoted_history: [], revision: 0 };
}

function normalizeCategoryBlock(block) {
  const src = block && typeof block === 'object' ? block : {};
  return {
    batch: src.batch && typeof src.batch === 'object' ? src.batch : null,
    // `ideas` is the ACTIVE list (≤ IDEAS_PER_CATEGORY). Removed topics move to
    // `removed` — history, never physically deleted by ordinary use. Legacy
    // Phase 1 state has no `removed`/`revision`; the defaults migrate it.
    ideas: Array.isArray(src.ideas) ? src.ideas.map(normalizeIdea).filter(Boolean) : [],
    removed: Array.isArray(src.removed) ? src.removed.map(normalizeIdea).filter(Boolean) : [],
    last_failure: src.last_failure && typeof src.last_failure === 'object' ? src.last_failure : null,
    promoted_history: Array.isArray(src.promoted_history)
      ? src.promoted_history.map(normalizeIdea).filter(Boolean)
      : [],
    // Category revision: bumped on every content mutation so long-running
    // generation can detect that the category changed under it (stale-write
    // protection at the category level).
    revision: Number.isInteger(src.revision) && src.revision >= 0 ? src.revision : 0,
  };
}

// Loads the full idea state, normalized so missing/older fields never crash a
// reader (schema evolution mirrors super-focus.js readStateDir).
function loadState(options = {}) {
  const file = path.join(resolveRoot(options), IDEAS_FILENAME);
  const parsed = readJsonFile(file, 'ideas');
  const state = {
    schema_version: SCHEMA_VERSION,
    updated_at: parsed && typeof parsed.updated_at === 'string' ? parsed.updated_at : null,
    categories: {},
  };
  const rawCategories = parsed && parsed.categories && typeof parsed.categories === 'object' ? parsed.categories : {};
  for (const key of Object.keys(rawCategories)) {
    if (CATEGORY_ID_RE.test(key)) state.categories[key] = normalizeCategoryBlock(rawCategories[key]);
  }
  return state;
}

function writeState(state, options = {}) {
  const file = path.join(resolveRoot(options), IDEAS_FILENAME);
  state.updated_at = nowIso();
  writeJsonAtomic(file, state);
  return state;
}

function categoryBlock(state, categoryId) {
  if (!state.categories[categoryId]) state.categories[categoryId] = emptyCategoryBlock();
  return state.categories[categoryId];
}

function findIdea(state, ideaId) {
  for (const key of Object.keys(state.categories)) {
    const block = state.categories[key];
    for (const idea of block.ideas) if (idea.id === ideaId) return { idea, category_id: key, from: 'active' };
    for (const idea of block.removed) if (idea.id === ideaId) return { idea, category_id: key, from: 'removed' };
    for (const idea of block.promoted_history) if (idea.id === ideaId) return { idea, category_id: key, from: 'history' };
  }
  return null;
}

// ── Title normalization / duplicate detection ────────────────────────────────

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleTokens(title) {
  return new Set(normalizeTitle(title).split(' ').filter((t) => t.length > 2));
}

// Title-formula diversity (Phase 0 calibration, 2026-07-26): local models
// collapse batches onto one title mold — 48/60 titles were "AI Can't/Doesn't
// Replace X", and prompt-side shape rotation alone still left 22/30. These
// deterministic per-batch caps make the surplus rejectable so the chunked
// generation loop must supply structurally different ideas instead.
const TITLE_FORMULA_FAMILY_RE = /^ai\s+(?:can|does|won|is)n?[''`’]?t\b/i;
const MAX_SAME_OPENING_PER_BATCH = 3; // identical first-two-word opening
const MAX_FORMULA_FAMILY_PER_BATCH = Math.ceil(IDEAS_PER_CATEGORY / 3); // the known-degenerate family

function titleOpeningBigram(title) {
  return normalizeTitle(title).split(' ').slice(0, 2).join(' ');
}

// Near-duplicate check for cosmetic variations: token Jaccard over normalized
// titles. Cheap, deterministic, and deliberately conservative (0.8) so honest
// same-theme neighbours are not rejected.
function titlesNearDuplicate(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return normalizeTitle(a) === normalizeTitle(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.8;
}

// All normalized titles that a new set for `categoryId` must not collide with:
// every other category's active ideas, plus every promoted idea anywhere
// (history included), plus the target category's own current titles (a refresh
// should produce fresh ideas, not echoes of the set it replaces), plus the
// target category's DELIBERATELY removed topics (a human said no to those;
// refresh-superseded history is excluded so old batches don't poison future
// generation forever).
function exclusionTitles(state, categoryId) {
  const titles = [];
  for (const key of Object.keys(state.categories)) {
    const block = state.categories[key];
    for (const idea of block.ideas) titles.push(idea.title);
    for (const idea of block.promoted_history) titles.push(idea.title);
    if (key === categoryId) {
      for (const idea of block.removed) {
        if (idea.removed && idea.removed.reason !== 'superseded_by_refresh') titles.push(idea.title);
      }
    }
  }
  return titles.filter(Boolean);
}

// ── Model-output validation ─────────────────────────────────────────────────
// Validates one candidate item from the model (untrusted). Returns a list of
// human-readable problems; empty list = acceptable.

const REQUIRED_TEXT_FIELDS = ['title', 'premise', 'why_vidtoolz', 'why_short', 'tension'];

function validateCandidate(item) {
  const problems = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return ['item is not an object'];
  }
  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = item[field];
    if (typeof value !== 'string' || !value.trim()) {
      problems.push(`missing or empty ${field}`);
      continue;
    }
    const len = value.trim().length;
    const max = field === 'title' ? MAX_TITLE_LEN : MAX_FIELD_LEN;
    if (len > max) problems.push(`${field} exceeds ${max} characters`);
    if (field !== 'title' && len < MIN_FIELD_LEN) problems.push(`${field} is too short to be useful`);
  }
  for (const field of OPTIONAL_EDIT_FIELDS) {
    if (item[field] === undefined || item[field] === null) continue;
    if (typeof item[field] !== 'string') { problems.push(`${field} is not a string`); continue; }
    const max = field === 'hook' ? MAX_HOOK_LEN : MAX_FIELD_LEN;
    if (item[field].trim().length > max) problems.push(`${field} exceeds ${max} characters`);
  }
  for (const field of EDITABLE_FIELDS) {
    if (typeof item[field] === 'string' && TAG_LIKE_RE.test(item[field])) {
      problems.push(`${field} contains HTML-like markup`);
    }
  }
  return problems;
}

// Accepts raw model items into server-owned idea objects. IDs are ALWAYS
// server-generated (model-provided ids/paths are ignored entirely). Rejects
// duplicates (exact + near) within the batch and against `existingTitles`.
// Returns { accepted, rejected } — rejected entries carry their reasons so
// failures are explainable, never silent.
function acceptCandidates(rawItems, { categoryId, batchId, existingTitles = [], acceptedSoFar = [], model = '', contentOrigin = 'generated' } = {}) {
  const accepted = [];
  const rejected = [];
  const seenNormalized = new Set(existingTitles.map(normalizeTitle));
  const seenTitles = existingTitles.slice();
  for (const prior of acceptedSoFar) {
    seenNormalized.add(normalizeTitle(prior.title));
    seenTitles.push(prior.title);
  }
  const items = Array.isArray(rawItems) ? rawItems : [];
  // Per-batch formula counters seeded from what this batch already accepted
  // (cross-category/global exclusions deliberately do NOT count — the caps
  // govern diversity WITHIN the set being built).
  const openingCounts = new Map();
  let formulaFamilyCount = 0;
  for (const prior of acceptedSoFar) {
    const bigram = titleOpeningBigram(prior.title);
    openingCounts.set(bigram, (openingCounts.get(bigram) || 0) + 1);
    if (TITLE_FORMULA_FAMILY_RE.test(prior.title)) formulaFamilyCount += 1;
  }
  for (const item of items) {
    const problems = validateCandidate(item);
    if (problems.length > 0) {
      rejected.push({ title: item && item.title ? String(item.title).slice(0, 140) : '(unparseable)', reasons: problems });
      continue;
    }
    const title = item.title.trim();
    const normalized = normalizeTitle(title);
    if (!normalized) {
      rejected.push({ title, reasons: ['title normalizes to empty'] });
      continue;
    }
    if (seenNormalized.has(normalized)) {
      rejected.push({ title, reasons: ['duplicate title'] });
      continue;
    }
    const near = seenTitles.find((t) => titlesNearDuplicate(t, title));
    if (near) {
      rejected.push({ title, reasons: [`near-duplicate of "${String(near).slice(0, 80)}"`] });
      continue;
    }
    const bigram = titleOpeningBigram(title);
    if ((openingCounts.get(bigram) || 0) >= MAX_SAME_OPENING_PER_BATCH) {
      rejected.push({ title, reasons: [`opening "${bigram}" already used ${MAX_SAME_OPENING_PER_BATCH}x in this batch`] });
      continue;
    }
    const inFamily = TITLE_FORMULA_FAMILY_RE.test(title);
    if (inFamily && formulaFamilyCount >= MAX_FORMULA_FAMILY_PER_BATCH) {
      rejected.push({ title, reasons: [`"AI can't/doesn't" title mold capped at ${MAX_FORMULA_FAMILY_PER_BATCH} per batch`] });
      continue;
    }
    openingCounts.set(bigram, (openingCounts.get(bigram) || 0) + 1);
    if (inFamily) formulaFamilyCount += 1;
    seenNormalized.add(normalized);
    seenTitles.push(title);
    accepted.push(normalizeIdea({
      id: newIdeaId(),
      category_id: categoryId,
      title,
      premise: item.premise.trim(),
      why_vidtoolz: item.why_vidtoolz.trim(),
      why_short: item.why_short.trim(),
      tension: item.tension.trim(),
      hook: typeof item.hook === 'string' ? item.hook.trim() : '',
      viewer_takeaway: typeof item.viewer_takeaway === 'string' ? item.viewer_takeaway.trim() : '',
      visual_opportunity: typeof item.visual_opportunity === 'string' ? item.visual_opportunity.trim() : '',
      status: 'generated',
      reviewed_at: null,
      created_at: nowIso(),
      batch_id: batchId,
      model,
      content_origin: contentOrigin === 'replacement_generated' ? 'replacement_generated' : 'generated',
      promotion: emptyPromotion(),
    }));
  }
  return { accepted, rejected };
}

// Final gate before activation: the replacement set must be EXACTLY the
// required count of valid, internally-unique ideas for the right category.
// 28, 29 or 31 is a failure, never silently accepted.
function assertCompleteSet(ideas, categoryId, count = IDEAS_PER_CATEGORY) {
  const problems = [];
  if (!Array.isArray(ideas)) problems.push('idea set is not an array');
  else {
    if (ideas.length !== count) problems.push(`idea set has ${ideas.length} items; exactly ${count} are required`);
    const ids = new Set();
    const normalized = new Set();
    for (const idea of ideas) {
      const itemProblems = validateCandidate(idea);
      if (itemProblems.length > 0) problems.push(`"${String(idea && idea.title || '?').slice(0, 60)}": ${itemProblems.join(', ')}`);
      if (!idea || !IDEA_ID_RE.test(String(idea.id || ''))) problems.push('idea has an invalid id');
      else if (ids.has(idea.id)) problems.push(`duplicate idea id ${idea.id}`);
      else ids.add(idea.id);
      if (idea && idea.category_id !== categoryId) problems.push(`idea "${String(idea.title || '?').slice(0, 60)}" has category ${idea.category_id}, expected ${categoryId}`);
      const norm = normalizeTitle(idea && idea.title);
      if (normalized.has(norm)) problems.push(`duplicate normalized title "${norm.slice(0, 80)}"`);
      else if (norm) normalized.add(norm);
    }
  }
  if (problems.length > 0) {
    const error = new Error(`Idea set rejected: ${problems.slice(0, 8).join('; ')}${problems.length > 8 ? ` (+${problems.length - 8} more)` : ''}`);
    error.statusCode = 502;
    error.code = 'idea_set_invalid';
    throw error;
  }
  return true;
}

// ── Transactional activation (last-known-good preservation) ─────────────────

// Replaces one category's idea set. Runs the complete-set gate FIRST, then
// re-reads the state from disk (stale in-memory copies can never clobber a
// newer accepted set), archives the outgoing set (promoted ideas into
// promoted_history, everything else — including manual edits — into `removed`
// as 'superseded_by_refresh' so no history is ever physically deleted),
// replaces the set, clears last_failure, and writes atomically. The previous
// valid set is only ever replaced by a fully valid successor.
// options.expectedRevision: category revision captured when generation began —
// if the category changed since (edit/remove/restore landed mid-generation),
// activation refuses with 409 rather than silently archiving newer work.
// True when a refresh must keep this active idea in place: the operator
// wrote it, edited it, reviewed it, or promoted it. Only untouched generated
// ideas are eligible for replacement.
function ideaIsRetained(idea) {
  if (!idea) return false;
  if (AUTHORITATIVE_ORIGINS.includes(idea.content_origin)) return true;
  if (idea.status === 'reviewed') return true;
  if (idea.promotion && idea.promotion.state === 'promoted') return true;
  return false;
}

function activateCategorySet(categoryId, ideas, batchMeta, options = {}) {
  const id = assertValidCategoryId(categoryId);
  const state = loadState(options);
  const block = categoryBlock(state, id);
  if (options.expectedRevision !== undefined && options.expectedRevision !== null
      && block.revision !== options.expectedRevision) {
    const error = new Error('Category changed while generating (an edit, removal, or restore landed); the generated set was NOT activated. Refresh again if still wanted.');
    error.statusCode = 409;
    error.code = 'category_revision_conflict';
    throw error;
  }
  // Retained topics (manual, edited, reviewed, promoted) stay ACTIVE and are
  // never superseded by a refresh; only untouched generated ideas rotate out.
  const retained = block.ideas.filter(ideaIsRetained);
  assertCompleteSet(ideas, id, IDEAS_PER_CATEGORY - retained.length);
  const combined = new Set(retained.map((idea) => normalizeTitle(idea.title)));
  for (const idea of ideas) {
    const norm = normalizeTitle(idea.title);
    if (combined.has(norm)) {
      const error = new Error(`Generated set collides with a retained topic: "${String(idea.title).slice(0, 60)}". The set was NOT activated.`);
      error.statusCode = 502;
      error.code = 'idea_set_invalid';
      throw error;
    }
    combined.add(norm);
  }
  const supersededAt = nowIso();
  const superseded = block.ideas
    .filter((idea) => !ideaIsRetained(idea))
    .map((idea) => Object.assign(idea, {
      removed: { at: supersededAt, reason: 'superseded_by_refresh', note: '' },
    }));
  block.removed = block.removed.concat(superseded);
  block.ideas = retained.concat(ideas);
  block.batch = {
    batch_id: String(batchMeta && batchMeta.batch_id || newBatchId()),
    generated_at: String(batchMeta && batchMeta.generated_at || nowIso()),
    model: String(batchMeta && batchMeta.model || ''),
    provider: String(batchMeta && batchMeta.provider || 'ollama-local'),
    requested: Number(batchMeta && batchMeta.requested) || ideas.length,
    accepted: ideas.length,
    duration_ms: Number(batchMeta && batchMeta.duration_ms) || 0,
    chunks: Number(batchMeta && batchMeta.chunks) || 0,
    rejected_candidates: Number(batchMeta && batchMeta.rejected_candidates) || 0,
  };
  block.last_failure = null;
  block.revision += 1;
  writeState(state, options);
  return state;
}

// Records a generation failure WITHOUT touching the existing valid set.
function recordCategoryFailure(categoryId, failure, options = {}) {
  const id = assertValidCategoryId(categoryId);
  const state = loadState(options);
  const block = categoryBlock(state, id);
  block.last_failure = {
    at: nowIso(),
    message: String(failure && failure.message || 'generation failed').slice(0, 500),
    code: String(failure && failure.code || ''),
    status: Number(failure && failure.status) || null,
  };
  writeState(state, options);
  return state;
}

// ── Topic editing / removal / restore / replacement (Phase 2) ────────────────

function notFoundError() {
  const error = new Error('Unknown Idea Engine idea id.');
  error.statusCode = 404;
  return error;
}

// Validates a full edited-content object (all EDITABLE_FIELDS present after
// merging) against field rules + duplicate titles across ALL active ideas
// (excluding the idea itself). Returns [] when acceptable.
// Field checks for MANUAL records: a title is required, everything else is
// optional (empty rationale is a valid state) — only bounds and markup are
// enforced. Generated records keep the full completeness gate.
function validateManualContent(content) {
  const problems = [];
  const title = String(content && content.title || '').trim();
  if (!title) problems.push('missing or empty title');
  if (title.length > MAX_TITLE_LEN) problems.push(`title exceeds ${MAX_TITLE_LEN} characters`);
  for (const field of EDITABLE_FIELDS) {
    if (field === 'title') continue;
    const value = content[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') { problems.push(`${field} is not a string`); continue; }
    const max = field === 'hook' ? MAX_HOOK_LEN : MAX_FIELD_LEN;
    if (value.trim().length > max) problems.push(`${field} exceeds ${max} characters`);
  }
  for (const field of EDITABLE_FIELDS) {
    if (typeof content[field] === 'string' && TAG_LIKE_RE.test(content[field])) {
      problems.push(`${field} contains HTML-like markup`);
    }
  }
  return problems;
}

function validateEditedContent(content, state, selfId, { manual = false } = {}) {
  const problems = manual ? validateManualContent(content) : validateCandidate(content);
  const normalized = normalizeTitle(content.title);
  for (const key of Object.keys(state.categories)) {
    for (const other of state.categories[key].ideas) {
      if (other.id === selfId) continue;
      if (normalizeTitle(other.title) === normalized) {
        problems.push(`duplicate title (matches active idea "${other.title.slice(0, 60)}")`);
      } else if (titlesNearDuplicate(other.title, content.title)) {
        problems.push(`near-duplicate title of active idea "${other.title.slice(0, 60)}"`);
      }
    }
  }
  return problems;
}

// Manual edit: content-only, id/category/provenance/promotion immutable, no
// model involvement. `expectedRevision` is the edit_revision the client loaded
// — a stale tab gets a 409 instead of clobbering a newer revision.
function editIdea(ideaId, fields, expectedRevision, options = {}) {
  const id = assertValidIdeaId(ideaId);
  const state = loadState(options);
  const found = findIdea(state, id);
  if (!found) throw notFoundError();
  if (found.from !== 'active') {
    const error = new Error('Only active suggestions can be edited. Restore the topic first.');
    error.statusCode = 409;
    error.code = 'idea_not_active';
    throw error;
  }
  const idea = found.idea;
  if (!Number.isInteger(expectedRevision) || expectedRevision !== idea.edit_revision) {
    const error = new Error(`Stale edit: this topic is at revision ${idea.edit_revision}, but the edit was based on revision ${String(expectedRevision)}. Reload and re-apply.`);
    error.statusCode = 409;
    error.code = 'stale_revision';
    throw error;
  }
  const source = fields && typeof fields === 'object' ? fields : {};
  const next = contentSnapshot(idea);
  let changed = false;
  for (const field of EDITABLE_FIELDS) {
    if (source[field] === undefined) continue;
    if (typeof source[field] !== 'string') {
      const error = new Error(`Field ${field} must be a string.`);
      error.statusCode = 400;
      throw error;
    }
    const value = source[field].trim();
    if (value !== next[field]) { next[field] = value; changed = true; }
  }
  if (!changed) {
    const error = new Error('No changes to save.');
    error.statusCode = 400;
    error.code = 'no_changes';
    throw error;
  }
  const problems = validateEditedContent(next, state, idea.id, { manual: idea.content_origin === 'manual' });
  if (problems.length > 0) {
    const error = new Error(`Edit rejected: ${problems.slice(0, 5).join('; ')}`);
    error.statusCode = 400;
    error.code = 'edit_invalid';
    throw error;
  }
  const previous = contentSnapshot(idea);
  if (!idea.original_content) idea.original_content = previous;
  idea.edit_history.push({ revision: idea.edit_revision, edited_at: nowIso(), previous });
  Object.assign(idea, next);
  idea.edit_revision += 1;
  idea.updated_at = nowIso();
  // A manual record stays 'manual' through edits (it was never model content);
  // editing a generated record moves it to 'manually_edited'. Both origins are
  // authoritative: refresh and vacancy fill never replace them.
  if (idea.content_origin !== 'manual') idea.content_origin = 'manually_edited';
  categoryBlock(state, found.category_id).revision += 1;
  writeState(state, options);
  return idea;
}

function normalizeRemovalReason(reason) {
  const value = String(reason || '').trim();
  if (!value) return 'other';
  return REMOVAL_REASONS.includes(value) && value !== 'superseded_by_refresh' ? value : 'other';
}

// Removal: moves an active idea into the category's removed history. Never
// deletes the record, never touches promotion state or any Super Focus
// project. Removing an already-removed idea is a clear 409 conflict.
function removeIdea(ideaId, { reason, note } = {}, options = {}) {
  const id = assertValidIdeaId(ideaId);
  const state = loadState(options);
  const found = findIdea(state, id);
  if (!found) throw notFoundError();
  if (found.from === 'removed') {
    const error = new Error('This topic is already removed.');
    error.statusCode = 409;
    error.code = 'already_removed';
    throw error;
  }
  if (found.from !== 'active') {
    const error = new Error('Only active suggestions can be removed.');
    error.statusCode = 409;
    error.code = 'idea_not_active';
    throw error;
  }
  const block = categoryBlock(state, found.category_id);
  const idea = found.idea;
  idea.removed = {
    at: nowIso(),
    reason: normalizeRemovalReason(reason),
    note: String(note || '').slice(0, MAX_REMOVAL_NOTE_LEN),
  };
  idea.updated_at = nowIso();
  block.ideas = block.ideas.filter((i) => i.id !== idea.id);
  block.removed.push(idea);
  block.revision += 1;
  writeState(state, options);
  return { idea, category_id: found.category_id };
}

// Restore: moves a removed idea back to the active list under the SAME id.
// Refuses when the category is full (never silently displaces another topic)
// or when restoration would create a duplicate against the active set.
function restoreIdea(ideaId, options = {}) {
  const id = assertValidIdeaId(ideaId);
  const state = loadState(options);
  const found = findIdea(state, id);
  if (!found) throw notFoundError();
  if (found.from === 'active') {
    const error = new Error('This topic is already active.');
    error.statusCode = 409;
    error.code = 'already_active';
    throw error;
  }
  if (found.from !== 'removed') {
    const error = new Error('Only removed suggestions can be restored.');
    error.statusCode = 409;
    error.code = 'idea_not_removed';
    throw error;
  }
  const block = categoryBlock(state, found.category_id);
  if (block.ideas.length >= IDEAS_PER_CATEGORY) {
    const error = new Error(`Category already has ${IDEAS_PER_CATEGORY} active topics. Remove one first, then restore.`);
    error.statusCode = 409;
    error.code = 'category_full';
    throw error;
  }
  const idea = found.idea;
  const problems = validateEditedContent(contentSnapshot(idea), state, idea.id);
  if (problems.some((p) => p.includes('duplicate'))) {
    const error = new Error(`Restore rejected: ${problems.filter((p) => p.includes('duplicate')).slice(0, 3).join('; ')}`);
    error.statusCode = 409;
    error.code = 'restore_duplicate';
    throw error;
  }
  idea.removal_history.push({ restored_at: nowIso(), previous_removal: idea.removed });
  idea.removed = null;
  idea.updated_at = nowIso();
  block.removed = block.removed.filter((i) => i.id !== idea.id);
  block.ideas.push(idea);
  block.revision += 1;
  writeState(state, options);
  return { idea, category_id: found.category_id };
}

// Activates ONE validated replacement candidate into a category vacancy and
// links it to the removed topic it replaces (both directions). The removed
// record is never restored, reused, or overwritten. Capacity and duplicates
// re-checked against CURRENT disk state at activation (stale-safe).
function activateReplacement(categoryId, newIdea, removedIdeaId, options = {}) {
  const id = assertValidCategoryId(categoryId);
  const problems = validateCandidate(newIdea);
  if (problems.length > 0 || !IDEA_ID_RE.test(String(newIdea && newIdea.id || ''))) {
    const error = new Error(`Replacement rejected: ${problems.concat(!IDEA_ID_RE.test(String(newIdea && newIdea.id || '')) ? ['invalid id'] : []).slice(0, 5).join('; ')}`);
    error.statusCode = 502;
    error.code = 'replacement_invalid';
    throw error;
  }
  const state = loadState(options);
  const block = categoryBlock(state, id);
  if (block.ideas.length >= IDEAS_PER_CATEGORY) {
    const error = new Error(`Category already has ${IDEAS_PER_CATEGORY} active topics; no vacancy to fill.`);
    error.statusCode = 409;
    error.code = 'category_full';
    throw error;
  }
  let removedRef = null;
  if (removedIdeaId) {
    const removedFound = findIdea(state, removedIdeaId);
    if (removedFound && removedFound.category_id === id && removedFound.from === 'removed') {
      removedRef = removedFound.idea;
    }
  }
  const dupProblems = validateEditedContent(contentSnapshot(newIdea), state, newIdea.id);
  // Beyond active ideas: promoted history, deliberately removed titles in this
  // category, and the specific topic being replaced (a replacement must not be
  // a reworded copy of what the human just rejected).
  for (const key of Object.keys(state.categories)) {
    for (const promoted of state.categories[key].promoted_history) {
      if (titlesNearDuplicate(promoted.title, newIdea.title)) {
        dupProblems.push(`too similar to promoted idea "${promoted.title.slice(0, 60)}"`);
      }
    }
  }
  for (const past of block.removed) {
    if (past.removed && past.removed.reason !== 'superseded_by_refresh'
        && titlesNearDuplicate(past.title, newIdea.title)) {
      dupProblems.push(`too similar to removed idea "${past.title.slice(0, 60)}"`);
    }
  }
  if (removedRef && titlesNearDuplicate(removedRef.title, newIdea.title)) {
    dupProblems.push(`too similar to the replaced idea "${removedRef.title.slice(0, 60)}"`);
  }
  if (dupProblems.length > 0) {
    const error = new Error(`Replacement rejected: ${dupProblems.slice(0, 3).join('; ')}`);
    error.statusCode = 502;
    error.code = 'replacement_duplicate';
    throw error;
  }
  newIdea.category_id = id;
  newIdea.content_origin = 'replacement_generated';
  if (removedRef) {
    newIdea.replacement_for_idea_id = removedRef.id;
    removedRef.replaced_by_idea_id = newIdea.id;
  }
  block.ideas.push(newIdea);
  block.revision += 1;
  writeState(state, options);
  return { idea: newIdea, category_id: id, active_count: block.ideas.length };
}

// Removed-topics view for one category (most recent removal first).
function listRemoved(categoryId, options = {}) {
  const id = assertValidCategoryId(categoryId);
  const state = loadState(options);
  const block = state.categories[id] || emptyCategoryBlock();
  return block.removed.slice().sort((a, b) => {
    const ta = a.removed ? a.removed.at : '';
    const tb = b.removed ? b.removed.at : '';
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
}

// ── Review / promotion bookkeeping ───────────────────────────────────────────

function markReviewed(ideaId, options = {}) {
  const id = assertValidIdeaId(ideaId);
  const state = loadState(options);
  const found = findIdea(state, id);
  if (!found) {
    const error = new Error('Unknown Idea Engine idea id.');
    error.statusCode = 404;
    throw error;
  }
  if (found.idea.status === 'generated') {
    found.idea.status = 'reviewed';
    found.idea.reviewed_at = nowIso();
    writeState(state, options);
  }
  return found.idea;
}

// Records the outcome of a promotion attempt. A failed create NEVER marks the
// idea promoted; a success stores the Super Focus project id as provenance.
function recordPromotionResult(ideaId, result, options = {}) {
  const id = assertValidIdeaId(ideaId);
  const state = loadState(options);
  const found = findIdea(state, id);
  if (!found) {
    const error = new Error('Unknown Idea Engine idea id.');
    error.statusCode = 404;
    throw error;
  }
  if (result && result.ok) {
    found.idea.promotion = {
      state: 'promoted',
      project_id: String(result.project_id || ''),
      promoted_at: nowIso(),
      // The edit revision whose content went into the project — the GUI flags
      // "edited after promotion" when edit_revision has moved past this.
      promoted_revision: found.idea.edit_revision,
      error: null,
    };
  } else {
    found.idea.promotion = {
      state: 'failed',
      project_id: found.idea.promotion && found.idea.promotion.project_id || null,
      promoted_at: found.idea.promotion && found.idea.promotion.promoted_at || null,
      promoted_revision: found.idea.promotion && Number.isInteger(found.idea.promotion.promoted_revision)
        ? found.idea.promotion.promoted_revision : null,
      error: String(result && result.error || 'promotion failed').slice(0, 500),
    };
  }
  writeState(state, options);
  return found.idea;
}

// ── Read views ───────────────────────────────────────────────────────────────

function summarizeCategory(category, block) {
  const ideas = block ? block.ideas : [];
  const removed = block ? block.removed : [];
  const vacancies = Math.max(0, IDEAS_PER_CATEGORY - ideas.length);
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    channel_relevance: category.channel_relevance,
    generation_guidance: category.generation_guidance,
    idea_count: ideas.length,
    active_count: ideas.length,
    removed_count: removed.length,
    // Deliberate human removals awaiting replacement (refresh-superseded
    // history is archival, not a vacancy driver).
    vacancy_count: vacancies,
    completeness: vacancies === 0 && ideas.length > 0 ? 'complete' : (ideas.length === 0 ? 'empty' : 'incomplete'),
    reviewed_count: ideas.filter((i) => i.status === 'reviewed').length,
    promoted_count: ideas.filter((i) => i.promotion.state === 'promoted').length
      + (block ? block.promoted_history.length : 0)
      + removed.filter((i) => i.promotion.state === 'promoted').length,
    failed_count: ideas.filter((i) => i.promotion.state === 'failed').length,
    edited_count: ideas.filter((i) => i.content_origin === 'manually_edited').length,
    manual_count: ideas.filter((i) => i.content_origin === 'manual').length,
    // Topics a refresh will KEEP (manual, edited, reviewed, promoted) vs rotate.
    retained_count: ideas.filter(ideaIsRetained).length,
    revision: block ? block.revision : 0,
    batch: block ? block.batch : null,
    last_failure: block ? block.last_failure : null,
  };
}

// Manual topic entry: the operator types a topic directly into a category.
// No model call, no batch, no quota. Title is required; every other field is
// optional (an empty rationale is valid and shown as an honest empty state).
// Duplicate checks run against ALL active topics exactly like manual edits.
function createManualIdea(categoryId, fields, options = {}) {
  const id = assertValidCategoryId(categoryId);
  const categories = loadCategories(options);
  const category = categories.find((c) => c.id === id && c.status === 'active');
  if (!category) {
    const error = new Error('Unknown Idea Engine category id.');
    error.statusCode = 404;
    throw error;
  }
  const source = fields && typeof fields === 'object' ? fields : {};
  const title = String(source.title || '').trim();
  if (!title) {
    const error = new Error('A topic title is required.');
    error.statusCode = 400;
    error.code = 'title_required';
    throw error;
  }
  if (title.length > MAX_TITLE_LEN) {
    const error = new Error(`Title exceeds ${MAX_TITLE_LEN} characters.`);
    error.statusCode = 400;
    throw error;
  }
  const content = { title };
  for (const field of EDITABLE_FIELDS) {
    if (field === 'title') continue;
    const value = source[field];
    if (value === undefined || value === null) { content[field] = ''; continue; }
    if (typeof value !== 'string') {
      const error = new Error(`Field ${field} must be a string.`);
      error.statusCode = 400;
      throw error;
    }
    const max = field === 'hook' ? MAX_HOOK_LEN : MAX_FIELD_LEN;
    if (value.trim().length > max) {
      const error = new Error(`${field} exceeds ${max} characters.`);
      error.statusCode = 400;
      throw error;
    }
    content[field] = value.trim();
  }
  for (const field of EDITABLE_FIELDS) {
    if (TAG_LIKE_RE.test(content[field] || '')) {
      const error = new Error(`${field} contains HTML-like markup.`);
      error.statusCode = 400;
      throw error;
    }
  }
  const state = loadState(options);
  const block = categoryBlock(state, id);
  if (block.ideas.length >= IDEAS_PER_CATEGORY) {
    const error = new Error(`Category already has ${IDEAS_PER_CATEGORY} active topics. Remove one first.`);
    error.statusCode = 409;
    error.code = 'category_full';
    throw error;
  }
  const normalized = normalizeTitle(title);
  for (const key of Object.keys(state.categories)) {
    for (const other of state.categories[key].ideas) {
      if (normalizeTitle(other.title) === normalized) {
        const error = new Error(`Duplicate title: matches active topic "${other.title.slice(0, 60)}".`);
        error.statusCode = 409;
        error.code = 'duplicate_title';
        throw error;
      }
      if (titlesNearDuplicate(other.title, title)) {
        const error = new Error(`Near-duplicate title of active topic "${other.title.slice(0, 60)}".`);
        error.statusCode = 409;
        error.code = 'duplicate_title';
        throw error;
      }
    }
  }
  const idea = normalizeIdea(Object.assign({}, content, {
    id: newIdeaId(),
    category_id: id,
    status: 'generated',
    batch_id: '',
    model: '',
    content_origin: 'manual',
    created_at: nowIso(),
    updated_at: nowIso(),
  }));
  block.ideas.push(idea);
  block.revision += 1;
  writeState(state, options);
  return { idea, category };
}

// Full GUI view: category definitions + summaries + ideas, one fetch.
function stateView(options = {}) {
  const all = loadCategories(options);
  const categories = all.filter((c) => c.status === 'active');
  const state = loadState(options);
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: state.updated_at,
    ideas_per_category: IDEAS_PER_CATEGORY,
    category_count: categories.length,
    removed_category_count: all.length - categories.length,
    categories: categories.map((category) => {
      const block = state.categories[category.id] || emptyCategoryBlock();
      return Object.assign(summarizeCategory(category, block), {
        ideas: block.ideas,
        removed: block.removed,
        promoted_history: block.promoted_history,
      });
    }),
  };
}

module.exports = {
  SCHEMA_VERSION,
  CATEGORY_COUNT,
  IDEAS_PER_CATEGORY,
  MAX_TITLE_LEN,
  MAX_FIELD_LEN,
  MAX_HOOK_LEN,
  DEFAULT_CATEGORIES,
  CATEGORIES_FILENAME,
  IDEAS_FILENAME,
  resolveRoot,
  loadCategories,
  activeCategories,
  writeCategories,
  createCategory,
  updateCategory,
  moveCategory,
  removeCategory,
  createManualIdea,
  ideaIsRetained,
  categoryById,
  loadState,
  writeState,
  findIdea,
  normalizeTitle,
  titlesNearDuplicate,
  titleOpeningBigram,
  TITLE_FORMULA_FAMILY_RE,
  MAX_SAME_OPENING_PER_BATCH,
  MAX_FORMULA_FAMILY_PER_BATCH,
  exclusionTitles,
  validateCandidate,
  acceptCandidates,
  assertCompleteSet,
  activateCategorySet,
  recordCategoryFailure,
  markReviewed,
  recordPromotionResult,
  summarizeCategory,
  stateView,
  assertValidIdeaId,
  assertValidCategoryId,
  newBatchId,
  newIdeaId,
  EDITABLE_FIELDS,
  REMOVAL_REASONS,
  contentSnapshot,
  editIdea,
  removeIdea,
  restoreIdea,
  activateReplacement,
  listRemoved,
};
