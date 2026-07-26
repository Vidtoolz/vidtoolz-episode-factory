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
const MAX_EXCLUSION_TITLES = 120;

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
  'The strongest shape is misconception-first: "Most creators think X. Actually, the important thing is Y. Here is the practical rule."',
  'Titles sound like blunt claims (e.g. "Prompts Are Not a Production Plan", "The Script Is the Spine"), never like "tips and tricks".',
].join('\n');

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
    },
    required: ['title', 'premise', 'why_vidtoolz', 'why_short', 'tension'],
    additionalProperties: false,
  };
}

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
    EXCLUSIONS_SPEC,
    '',
    'For each idea provide:',
    '- title: a blunt claim-style working title (under 100 characters)',
    '- premise: 1–2 sentences on what the video examines (concrete, not vague)',
    '- why_vidtoolz: 1–2 sentences on why this matters to VIDTOOLZ viewers specifically',
    '- why_short: 1–2 sentences on why this works as one ~3-minute vertical Short',
    '- tension: the central misconception, tension, problem, or decision the video exposes',
    '- hook: (optional) a blunt spoken first line for the video',
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
  if (opts && opts.retry) {
    lines.push('', DIVERSIFICATION_HINT);
  }
  lines.push('', `Return exactly ${n} ideas as JSON matching the required schema. No commentary.`);
  return {
    system: CHANNEL_POSITIONING,
    user: lines.join('\n'),
    schema: ideaBatchSchema(),
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
  const items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.ideas) ? parsed.ideas : null);
  if (!items) return { ok: false, error: 'model output has no ideas array' };
  return { ok: true, items };
}

module.exports = {
  IDEAS_PER_CATEGORY,
  MAX_IDEAS_PER_CALL,
  MAX_EXCLUSION_TITLES,
  CHANNEL_POSITIONING,
  SUITABLE_TOPIC_SPEC,
  EXCLUSIONS_SPEC,
  ideaBatchSchema,
  buildCategoryIdeasRequest,
  stripThinkingAndFences,
  firstBalancedObject,
  parseIdeaBatch,
};
