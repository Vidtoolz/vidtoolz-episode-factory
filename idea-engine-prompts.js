/*
 * Idea Engine — prompt/specification layer (pure: no fs, no network).
 *
 * Separates generation instructions from GUI and server code. The channel
 * positioning below is distilled from the Tier-1 doctrine documents
 * (hermes-organiser/brain/content/vidtoolz-manifesto-and-formats.md,
 * vidtoolz-strategy-and-schedule.md, vidtoolz-brand-bible-and-operations.md,
 * vidtoolz-platform-playbook.md, 2026-07-06) — the same sources the Idea
 * Module's knowledge snapshots mirror. If the doctrine changes, update this
 * block deliberately; it is a specification, not decoration.
 *
 * Builders return { system, user, schema } as one unit (beat-sheet convention)
 * so prompt and schema can never drift. Model output remains untrusted input:
 * parsing here never throws, and idea-engine.js validates every field.
 */
'use strict';

const IDEAS_PER_CATEGORY = 30;
// Chunked generation asks for a handful of ideas per call; a single call is
// never asked for more than this (oversized requests time out and degrade
// quality on local models).
const MAX_IDEAS_PER_CALL = 10;
// Exclusion lists are capped so the prompt stays within a sane local-model
// context. Promoted titles are passed first by callers (they matter most).
// 200 keeps a mid-estate list (accepted-so-far + ~150 estate titles) fully
// visible; a full 360-idea estate still truncates — the validator sees all.
const MAX_EXCLUSION_TITLES = 200;
// Titles the model just produced and had rejected, echoed back verbatim in
// the retry prompt. Small on purpose: it is a "stop resubmitting these"
// signal, not a second exclusion list.
const MAX_REJECTED_FEEDBACK_TITLES = 18;

// Prompt versions: every builder stamps its returned request with a stable
// identifier so provenance can answer "which prompt produced this topic?".
// Bump the version when a builder's behavioral content changes materially
// (doctrine text, shape rotation, exclusion rules, field spec) — not for
// whitespace or comment edits. Accepted ideas, batch metadata, and the
// promotion sidecar all record this value.
const PROMPT_VERSIONS = {
  category_ideas: 'ie-category-ideas.v1',
  replacement: 'ie-replacement.v1',
};

const CHANNEL_POSITIONING = [
  'You generate YouTube Shorts topic ideas for VIDTOOLZ, a Shorts-native expert channel about AI video production systems for serious solo creators.',
  'Channel promise: help serious video creators use AI in real production without drowning in tools, losing creative control, or mistaking generated assets for finished videos.',
  'Audience: serious solo and small-team creators already experimenting with AI who struggle to turn generated material into finished work. Speak to them as peers, never as beginners.',
  'Voice: the blunt production realist — direct, dryly funny, practical, skeptical of hype but not anti-AI. Every video is a spoken-to-camera monologue of roughly 2:15–2:50 (a miniature evergreen explainer, vertical 9:16).',
  'Doctrine: one durable production principle per video. The script is the spine. Human judgment is the moat. The tool is not the workflow. Tool videos age quickly; principle videos age slowly.',
].join('\n');

const SUITABLE_TOPIC_SPEC = [
  'A suitable idea passes ALL of these tests:',
  '1. It teaches one fundamental, durable idea (still useful 18 months from now).',
  '2. It matters concretely to AI-assisted video creators.',
  '3. It can be explained bluntly in under 3 minutes by one presenter, without specialist knowledge.',
  '4. It is narrow enough to cover coherently, yet substantial enough to justify a video.',
  '5. It can be clarified with generated images, infographics, demonstrations, or contrasts.',
  'Titles sound like blunt claims (e.g. "Prompts Are Not a Production Plan", "The Script Is the Spine"), never like "tips and tricks".',
].join('\n');

// Concept shapes, rotated per generation chunk. Phase 0 calibration
// (2026-07-26) showed that leading every request with the misconception shape
// collapses a batch onto one title mold ("AI Can't Replace X" was 48/60);
// rotating the requested shape forces structural diversity at the source.
const CONCEPT_SHAPES = [
  'Shape for THIS batch — MISCONCEPTION: each idea names something most creators believe, shows why it is wrong in practice, and gives the working rule. ("Most creators think X. Actually Y. Here is the rule.")',
  'Shape for THIS batch — INVERSION: each idea takes an accepted best practice or popular habit and shows a concrete situation where following it backfires, ending with the sharper rule. No idea may be phrased as "AI can\'t/doesn\'t do X".',
  'Shape for THIS batch — FAILURE STORY: each idea is built around one specific, recognizable production failure (a wasted day, a broken handoff, a video that died at review) and the durable rule that prevents it. Name the failure concretely in the premise. No idea may be phrased as "AI can\'t/doesn\'t do X".',
  'Shape for THIS batch — HARD DECISION: each idea centers a real trade-off a solo creator must decide (speed vs review, generate more vs finish, automate vs supervise), and gives a usable decision rule. No idea may be phrased as "AI can\'t/doesn\'t do X".',
];

const TITLE_VARIETY_RULE = [
  'TITLE VARIETY (hard rule): do not begin more than ONE title in this batch with the same two words.',
  'Do not overuse any single title formula — in particular "AI Can\'t …", "AI Doesn\'t …", and "X Is Not Y" must not dominate.',
  'Vary the grammatical form: statements, warnings, rules, questions turned into claims.',
].join('\n');

// Injected by the generation loop once the "AI Can't/Doesn't" family quota for
// the batch is used up — the validator rejects further family titles anyway,
// so telling the model directly recovers chunk yield instead of wasting calls.
const FORMULA_BAN_LINE =
  'HARD BAN for this batch: no title may begin with "AI Can\'t", "AI Doesn\'t", "AI Won\'t", or "AI Isn\'t" — that title family is already used up. Every title must take a different grammatical form (rule, warning, contrast, consequence, decision).';

const EXCLUSIONS_SPEC = [
  'Never propose:',
  '- tool news, model releases, product reviews, or anything that merely advertises a tool',
  '- vague subjects ("The Future of AI", "AI changes everything")',
  '- generic listicles without one clear argument',
  '- "make money with AI" or faceless-automation angles',
  '- beginner camera/editing basics or generic YouTube growth advice',
  '- subjects too broad for one short video',
  '- cosmetic variations of any excluded or already-listed title',
].join('\n');

function ideaItemSchema() {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      premise: { type: 'string' },
      why_vidtoolz: { type: 'string' },
      why_short: { type: 'string' },
      tension: { type: 'string' },
      hook: { type: 'string' },
      viewer_takeaway: { type: 'string' },
      visual_opportunity: { type: 'string' },
    },
    required: ['title', 'premise', 'why_vidtoolz', 'why_short', 'tension'],
    additionalProperties: false,
  };
}

const IDEA_FIELD_SPEC = [
  'For each idea provide:',
  '- title: a blunt claim-style working title (under 100 characters)',
  '- premise: 1–2 sentences on what the video examines (concrete, not vague)',
  '- why_vidtoolz: 1–2 sentences on why this matters to VIDTOOLZ viewers specifically',
  '- why_short: 1–2 sentences on why this works as one ~3-minute vertical Short',
  '- tension: the central misconception, tension, problem, or decision the video exposes',
  '- hook: (optional) a blunt spoken first line for the video',
  '- viewer_takeaway: the one practical rule or model the viewer leaves with',
  '- visual_opportunity: how generated images, infographics, demonstrations, or contrasts could clarify it',
  'Every field value must be a plain JSON string — never null and never a list or object. Leave an optional field out entirely if you have nothing for it.',
];

function ideaBatchSchema() {
  return {
    type: 'object',
    properties: {
      ideas: { type: 'array', items: ideaItemSchema() },
    },
    required: ['ideas'],
    additionalProperties: false,
  };
}

function clampCallCount(n) {
  const count = Math.round(Number(n));
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(MAX_IDEAS_PER_CALL, count);
}

// Extra instruction for retry chunks: local models at fixed temperature tend
// to re-emit their favourite doctrine titles once the obvious angles are
// excluded; an explicit diversification push breaks that loop.
const DIVERSIFICATION_HINT = [
  'IMPORTANT: a previous batch repeated already-used titles and was rejected.',
  'Every idea in THIS batch must take a clearly different angle from every excluded title:',
  'a different production stage, a different failure story, a different decision, a different misconception.',
  'Prefer unexplored corners of the category (economics, review habits, tooling psychology, team-of-one dynamics, history, client work) over restating its core doctrine.',
].join(' ');

// Builds one chunked generation request for `count` new sub-topic ideas in one
// category. `exclusions` are working titles that must not be repeated or
// lightly reworded (already-generated, already-promoted, other categories).
// opts.retry adds the diversification push after a rejected/stalled chunk.
// opts.chunkIndex (0-based) rotates the requested concept shape so successive
// chunks approach the category from different structural angles.
function conceptShapeFor(chunkIndex) {
  const idx = Number.isInteger(chunkIndex) && chunkIndex >= 0 ? chunkIndex : 0;
  return CONCEPT_SHAPES[idx % CONCEPT_SHAPES.length];
}

function buildCategoryIdeasRequest(category, count, exclusions = [], opts = {}) {
  const n = clampCallCount(count);
  const excluded = (Array.isArray(exclusions) ? exclusions : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, MAX_EXCLUSION_TITLES);
  const lines = [
    `Generate exactly ${n} distinct YouTube Shorts video ideas for the VIDTOOLZ topic category below.`,
    '',
    `CATEGORY: ${category.name}`,
    `WHAT THIS CATEGORY COVERS: ${category.description}`,
    `WHY THE CHANNEL COVERS IT: ${category.channel_relevance}`,
  ];
  if (category.generation_guidance) {
    lines.push(`CATEGORY GUIDANCE: ${category.generation_guidance}`);
  }
  lines.push(
    '',
    SUITABLE_TOPIC_SPEC,
    '',
    conceptShapeFor(opts && opts.chunkIndex),
    '',
    TITLE_VARIETY_RULE,
    ...(opts && opts.banFormulaFamily ? ['', FORMULA_BAN_LINE] : []),
    '',
    EXCLUSIONS_SPEC,
    '',
    ...IDEA_FIELD_SPEC,
    '',
    'Every idea must be clearly distinct from the others in this batch — different principle, different failure, or different decision. No two ideas may share their core claim.'
  );
  if (excluded.length > 0) {
    lines.push(
      '',
      'ALREADY USED — do NOT repeat or lightly reword any of these titles:',
      ...excluded.map((t) => `- ${t}`)
    );
  }
  const justRejected = (Array.isArray(opts && opts.rejectedTitles) ? opts.rejectedTitles : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(-MAX_REJECTED_FEEDBACK_TITLES);
  if (justRejected.length > 0) {
    lines.push(
      '',
      'JUST REJECTED — you already submitted these in this batch and they were rejected as duplicates or invalid. Submitting them again, or a light rewording of them, wastes the attempt. Take a genuinely different angle:',
      ...justRejected.map((t) => `- ${t}`)
    );
  }
  if (opts && opts.retry) {
    lines.push('', DIVERSIFICATION_HINT);
  }
  lines.push('', `Return exactly ${n} ideas as JSON matching the required schema. No commentary.`);
  return {
    system: CHANNEL_POSITIONING,
    user: lines.join('\n'),
    schema: ideaBatchSchema(),
    prompt_version: PROMPT_VERSIONS.category_ideas,
  };
}

// Fixed guidance per structured removal reason. Removal reasons are bounded
// editorial metadata: only these enum-mapped strings ever enter a prompt —
// free-text removal notes are NEVER injected (untrusted-instruction guard).
const REMOVAL_REASON_GUIDANCE = {
  duplicate: 'The removed topic was a duplicate. Generate a conceptually different topic, not a renamed version.',
  too_broad: 'The removed topic was too broad. Generate a narrower, directly actionable topic within the category.',
  too_narrow: 'The removed topic was too narrow. Generate a topic with wider creator relevance while staying concrete.',
  weak_vidtoolz_fit: 'The removed topic fit the channel poorly. Anchor the new topic firmly in AI video production systems for serious solo creators.',
  poor_shorts_fit: 'The removed topic did not suit a short video. The new topic must be explainable bluntly in under 3 minutes.',
  already_covered: 'The removed topic was already covered. Generate a clearly distinct subject.',
  too_tool_specific: 'The removed topic was too tool-specific. Generate a durable production principle, not a tool feature.',
  weak_tension: 'The removed topic lacked tension. The new topic must expose a sharp misconception, problem, or decision.',
  not_visually_explainable: 'The removed topic could not be shown visually. The new topic must be clarifiable with generated images, infographics, demonstrations, or contrasts.',
  inaccurate: 'The removed topic was inaccurate or misleading. The new topic must be verifiably true for working creators.',
};

// Builds a request for exactly ONE replacement sub-topic filling a vacancy.
// Dedicated builder (not the 30-set prompt): it carries the removed topic,
// its structured removal reason, the current active set, deliberately removed
// neighbours, promoted history, and the other categories to avoid drifting
// into. Output shape/schema matches the batch builder so parsing is shared.
function buildReplacementRequest(category, opts = {}) {
  const removedIdea = opts.removedIdea || null;
  const activeTitles = (Array.isArray(opts.activeTitles) ? opts.activeTitles : []).filter(Boolean).slice(0, MAX_EXCLUSION_TITLES);
  const removedTitles = (Array.isArray(opts.removedTitles) ? opts.removedTitles : []).filter(Boolean).slice(0, 20);
  const promotedTitles = (Array.isArray(opts.promotedTitles) ? opts.promotedTitles : []).filter(Boolean).slice(0, 20);
  const otherCategories = (Array.isArray(opts.otherCategories) ? opts.otherCategories : []).filter(Boolean).slice(0, 12);
  const lines = [
    'Generate exactly 1 distinct replacement YouTube Shorts video idea for the VIDTOOLZ topic category below. A weak suggestion was removed from the category and you are filling its slot with a BETTER, DIFFERENT idea.',
    '',
    `CATEGORY: ${category.name}`,
    `WHAT THIS CATEGORY COVERS: ${category.description}`,
    `WHY THE CHANNEL COVERS IT: ${category.channel_relevance}`,
  ];
  if (category.generation_guidance) lines.push(`CATEGORY GUIDANCE: ${category.generation_guidance}`);
  if (removedIdea) {
    lines.push(
      '',
      'THE REMOVED TOPIC (do NOT reproduce its premise, angle, or a reworded version of it):',
      `- Title: ${String(removedIdea.title || '').slice(0, 140)}`,
      `- Premise: ${String(removedIdea.premise || '').slice(0, 300)}`
    );
    const guidance = REMOVAL_REASON_GUIDANCE[opts.removalReason];
    if (guidance) lines.push(guidance);
  }
  lines.push('', SUITABLE_TOPIC_SPEC, '', EXCLUSIONS_SPEC, '', ...IDEA_FIELD_SPEC);
  if (activeTitles.length > 0) {
    lines.push('', 'CURRENT ACTIVE TOPICS in this category and its neighbours — the new idea must be clearly distinct from every one of these:', ...activeTitles.map((t) => `- ${t}`));
  }
  if (promotedTitles.length > 0) {
    lines.push('', 'ALREADY PROMOTED TO PRODUCTION — never propose these or close variants:', ...promotedTitles.map((t) => `- ${t}`));
  }
  if (removedTitles.length > 0) {
    lines.push('', 'PREVIOUSLY REMOVED BY THE EDITOR — do not bring these back:', ...removedTitles.map((t) => `- ${t}`));
  }
  if (otherCategories.length > 0) {
    lines.push('', `STAY INSIDE THIS CATEGORY. The channel has separate categories for: ${otherCategories.join('; ')}. If the idea belongs more naturally in one of those, discard it and propose one that is unmistakably "${category.name}".`);
  }
  if (opts.retry) lines.push('', DIVERSIFICATION_HINT);
  lines.push('', 'Return exactly 1 idea as JSON matching the required schema. No commentary.');
  return {
    system: CHANNEL_POSITIONING,
    user: lines.join('\n'),
    schema: ideaBatchSchema(),
    prompt_version: PROMPT_VERSIONS.replacement,
  };
}

// ── Untrusted-output parsing (never throws) ──────────────────────────────────

// Local reasoning models (e.g. qwen3 via Ollama) can prepend <think> blocks
// that contain braces; strip them (including unterminated ones) and markdown
// fences before locating JSON. Same defence as super-focus-prompts.js.
function stripThinkingAndFences(raw) {
  let text = String(raw || '');
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<think>[\s\S]*$/i, '');
  text = text.replace(/```(?:json)?/gi, '');
  return text.trim();
}

// First balanced {...} block, string- and escape-aware (a naive first-{ to
// last-} slice breaks on braces inside strings).
function firstBalancedObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// Parses one model reply into a raw candidate array. Accepts {"ideas":[...]}
// (the schema shape) or a bare array. Returns {ok, items} | {ok:false, error};
// validation of each item happens in idea-engine.js (this only locates JSON).
// The candidate fields the schema requests — mirror of ideaItemSchema().
const CANDIDATE_FIELDS = [
  'title', 'premise', 'why_vidtoolz', 'why_short', 'tension',
  'hook', 'viewer_takeaway', 'visual_opportunity',
];

// qwen3.5:9b intermittently violates the JSON-schema `format` grammar and
// emits null / arrays / wrapper objects for string fields (live 2026-07-27:
// whole categories stalled on "visual_opportunity is not a string"). Coerce
// the obviously-recoverable shapes into strings BEFORE validation; anything
// genuinely uncoercible is left as-is so the validator still rejects it
// honestly. Coercion never invents content — it only unwraps or joins what
// the model already wrote.
function coerceFieldValue(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(coerceFieldValue).filter((s) => typeof s === 'string' && s.trim());
    if (parts.length === value.length || parts.length > 0) return parts.join(' ');
    return value; // nothing string-like inside: reject downstream
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'value', 'description', 'content']) {
      if (typeof value[key] === 'string') return value[key];
    }
    const strings = Object.keys(value).map((k) => value[k]).filter((v) => typeof v === 'string');
    if (strings.length === 1) return strings[0];
  }
  return value; // uncoercible: validator rejects with the honest reason
}

function coerceCandidate(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const out = Object.assign({}, item);
  for (const field of CANDIDATE_FIELDS) {
    if (field in out) out[field] = coerceFieldValue(out[field]);
  }
  return out;
}

function parseIdeaBatch(raw) {
  const cleaned = stripThinkingAndFences(raw);
  if (!cleaned) return { ok: false, error: 'model returned empty output' };
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    const block = firstBalancedObject(cleaned);
    if (block) {
      try { parsed = JSON.parse(block); } catch (_) { parsed = null; }
    }
  }
  if (parsed === null || parsed === undefined) return { ok: false, error: 'model output is not parseable JSON' };
  // Accept the three shapes local models actually produce for the same
  // schema: the requested {ideas:[...]} wrapper, a bare top-level array, and
  // — for single-item requests — one bare idea object (qwen3.5:9b does this
  // for replacement calls, observed live 2026-07-27). The validator judges
  // every item either way; this only normalizes the envelope.
  const items = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.ideas))
    ? parsed.ideas
    : (parsed && typeof parsed === 'object' && typeof parsed.title === 'string')
    ? [parsed]
    : null;
  if (!items) return { ok: false, error: 'model output has no ideas array' };
  return { ok: true, items: items.map(coerceCandidate) };
}

module.exports = {
  IDEAS_PER_CATEGORY,
  MAX_IDEAS_PER_CALL,
  MAX_EXCLUSION_TITLES,
  MAX_REJECTED_FEEDBACK_TITLES,
  PROMPT_VERSIONS,
  CHANNEL_POSITIONING,
  SUITABLE_TOPIC_SPEC,
  EXCLUSIONS_SPEC,
  ideaBatchSchema,
  buildCategoryIdeasRequest,
  buildReplacementRequest,
  CONCEPT_SHAPES,
  conceptShapeFor,
  TITLE_VARIETY_RULE,
  FORMULA_BAN_LINE,
  REMOVAL_REASON_GUIDANCE,
  stripThinkingAndFences,
  coerceFieldValue,
  coerceCandidate,
  firstBalancedObject,
  parseIdeaBatch,
};
