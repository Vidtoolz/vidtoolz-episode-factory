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

function normalizeCategory(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim();
  if (!CATEGORY_ID_RE.test(id)) return null;
  return {
    id,
    name: String(entry.name || id).trim(),
    description: String(entry.description || '').trim(),
    channel_relevance: String(entry.channel_relevance || '').trim(),
    generation_guidance: String(entry.generation_guidance || '').trim(),
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
    const normalized = existing.categories.map(normalizeCategory).filter(Boolean);
    if (normalized.length > 0) return normalized;
  }
  const seeded = DEFAULT_CATEGORIES.map(normalizeCategory).filter(Boolean);
  writeJsonAtomic(file, {
    schema_version: SCHEMA_VERSION,
    seeded_at: nowIso(),
    updated_at: nowIso(),
    categories: seeded,
  });
  return seeded;
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
  return {
    id,
    category_id: String(entry.category_id || '').trim(),
    title: String(entry.title || '').trim(),
    premise: String(entry.premise || '').trim(),
    why_vidtoolz: String(entry.why_vidtoolz || '').trim(),
    why_short: String(entry.why_short || '').trim(),
    tension: String(entry.tension || '').trim(),
    hook: typeof entry.hook === 'string' ? entry.hook.trim() : '',
    status: IDEA_STATUSES.includes(entry.status) ? entry.status : 'generated',
    reviewed_at: typeof entry.reviewed_at === 'string' ? entry.reviewed_at : null,
    created_at: typeof entry.created_at === 'string' ? entry.created_at : nowIso(),
    batch_id: String(entry.batch_id || '').trim(),
    promotion: {
      state: PROMOTION_STATES.includes(promotion.state) ? promotion.state : 'none',
      project_id: typeof promotion.project_id === 'string' ? promotion.project_id : null,
      promoted_at: typeof promotion.promoted_at === 'string' ? promotion.promoted_at : null,
      error: typeof promotion.error === 'string' ? promotion.error : null,
    },
  };
}

function emptyCategoryBlock() {
  return { batch: null, ideas: [], last_failure: null, promoted_history: [] };
}

function normalizeCategoryBlock(block) {
  const src = block && typeof block === 'object' ? block : {};
  return {
    batch: src.batch && typeof src.batch === 'object' ? src.batch : null,
    ideas: Array.isArray(src.ideas) ? src.ideas.map(normalizeIdea).filter(Boolean) : [],
    last_failure: src.last_failure && typeof src.last_failure === 'object' ? src.last_failure : null,
    promoted_history: Array.isArray(src.promoted_history)
      ? src.promoted_history.map(normalizeIdea).filter(Boolean)
      : [],
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
// should produce fresh ideas, not echoes of the set it replaces).
function exclusionTitles(state, categoryId) {
  const titles = [];
  for (const key of Object.keys(state.categories)) {
    const block = state.categories[key];
    for (const idea of block.ideas) titles.push(idea.title);
    for (const idea of block.promoted_history) titles.push(idea.title);
  }
  void categoryId; // target category titles are already included above
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
  if (item.hook !== undefined && item.hook !== null) {
    if (typeof item.hook !== 'string') problems.push('hook is not a string');
    else if (item.hook.trim().length > MAX_HOOK_LEN) problems.push(`hook exceeds ${MAX_HOOK_LEN} characters`);
  }
  return problems;
}

// Accepts raw model items into server-owned idea objects. IDs are ALWAYS
// server-generated (model-provided ids/paths are ignored entirely). Rejects
// duplicates (exact + near) within the batch and against `existingTitles`.
// Returns { accepted, rejected } — rejected entries carry their reasons so
// failures are explainable, never silent.
function acceptCandidates(rawItems, { categoryId, batchId, existingTitles = [], acceptedSoFar = [] } = {}) {
  const accepted = [];
  const rejected = [];
  const seenNormalized = new Set(existingTitles.map(normalizeTitle));
  const seenTitles = existingTitles.slice();
  for (const prior of acceptedSoFar) {
    seenNormalized.add(normalizeTitle(prior.title));
    seenTitles.push(prior.title);
  }
  const items = Array.isArray(rawItems) ? rawItems : [];
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
    seenNormalized.add(normalized);
    seenTitles.push(title);
    accepted.push({
      id: newIdeaId(),
      category_id: categoryId,
      title,
      premise: item.premise.trim(),
      why_vidtoolz: item.why_vidtoolz.trim(),
      why_short: item.why_short.trim(),
      tension: item.tension.trim(),
      hook: typeof item.hook === 'string' ? item.hook.trim() : '',
      status: 'generated',
      reviewed_at: null,
      created_at: nowIso(),
      batch_id: batchId,
      promotion: emptyPromotion(),
    });
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
// newer accepted set), moves the outgoing set's promoted ideas into
// promoted_history (promotion provenance survives every refresh), replaces
// the set, clears last_failure, and writes atomically. The previous valid set
// is only ever replaced by a fully valid successor.
function activateCategorySet(categoryId, ideas, batchMeta, options = {}) {
  const id = assertValidCategoryId(categoryId);
  assertCompleteSet(ideas, id);
  const state = loadState(options);
  const block = categoryBlock(state, id);
  const keptHistory = block.ideas.filter((idea) => idea.promotion && idea.promotion.state === 'promoted');
  block.promoted_history = block.promoted_history.concat(keptHistory);
  block.ideas = ideas;
  block.batch = {
    batch_id: String(batchMeta && batchMeta.batch_id || newBatchId()),
    generated_at: String(batchMeta && batchMeta.generated_at || nowIso()),
    model: String(batchMeta && batchMeta.model || ''),
    provider: String(batchMeta && batchMeta.provider || 'ollama-local'),
    requested: IDEAS_PER_CATEGORY,
    accepted: ideas.length,
    duration_ms: Number(batchMeta && batchMeta.duration_ms) || 0,
    chunks: Number(batchMeta && batchMeta.chunks) || 0,
    rejected_candidates: Number(batchMeta && batchMeta.rejected_candidates) || 0,
  };
  block.last_failure = null;
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
      error: null,
    };
  } else {
    found.idea.promotion = {
      state: 'failed',
      project_id: found.idea.promotion && found.idea.promotion.project_id || null,
      promoted_at: found.idea.promotion && found.idea.promotion.promoted_at || null,
      error: String(result && result.error || 'promotion failed').slice(0, 500),
    };
  }
  writeState(state, options);
  return found.idea;
}

// ── Read views ───────────────────────────────────────────────────────────────

function summarizeCategory(category, block) {
  const ideas = block ? block.ideas : [];
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    channel_relevance: category.channel_relevance,
    generation_guidance: category.generation_guidance,
    idea_count: ideas.length,
    reviewed_count: ideas.filter((i) => i.status === 'reviewed').length,
    promoted_count: ideas.filter((i) => i.promotion.state === 'promoted').length
      + (block ? block.promoted_history.length : 0),
    failed_count: ideas.filter((i) => i.promotion.state === 'failed').length,
    batch: block ? block.batch : null,
    last_failure: block ? block.last_failure : null,
  };
}

// Full GUI view: category definitions + summaries + ideas, one fetch.
function stateView(options = {}) {
  const categories = loadCategories(options);
  const state = loadState(options);
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: state.updated_at,
    ideas_per_category: IDEAS_PER_CATEGORY,
    category_count: categories.length,
    categories: categories.map((category) => {
      const block = state.categories[category.id] || emptyCategoryBlock();
      return Object.assign(summarizeCategory(category, block), {
        ideas: block.ideas,
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
  categoryById,
  loadState,
  writeState,
  findIdea,
  normalizeTitle,
  titlesNearDuplicate,
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
};
