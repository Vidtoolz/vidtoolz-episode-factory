'use strict';

// Super Focus — pure prompt builders + robust output parsing for local Ollama.
//
// No network, no fs, no deps: everything here is deterministic and unit-testable.
// The server calls callOllamaChat with these builders and feeds the raw model
// output back through the parsers. Output is always English (enforced in the
// system prompt); we never fall back to a cloud model.

const IMAGE_PROMPT_MAX = 100;
const INFOGRAPHIC_PROMPT_MAX = 30;

const TOPIC_SYSTEM =
  'You are a topic generator for the VIDTOOLZ YouTube channel. Always write in English. ' +
  'Return only what is asked — no preamble, no explanation, no markdown, no quotes.';

const SCRIPT_SYSTEM =
  'You are a scriptwriter for the VIDTOOLZ YouTube channel, written from the perspective of a ' +
  'working editor and video-production-systems builder. Always write in English. ' +
  'Return only the requested text — no preamble, no headings, no stage directions, no markdown fences.';

const PROMPTS_SYSTEM =
  'You generate image-generation prompts for the VIDTOOLZ YouTube channel. Always write in English. ' +
  'Return ONLY a strict JSON array of strings and nothing else — no commentary, no markdown fences.';

function buildTopicRequest() {
  const user = [
    'Generate one practical VIDTOOLZ video topic for an English-language YouTube Short.',
    '',
    'The topic must be about AI-native video production systems for serious solo creators.',
    '',
    'Requirements:',
    '- direct',
    '- concrete',
    '- non-hype',
    '- suitable for a 3-minute explainer',
    '- not a generic AI influencer topic',
    '- useful to a working creator/editor',
    '- no fake evidence',
    '- no unsupported claims',
    '',
    'Return only the title/topic text.',
  ].join('\n');
  return { system: TOPIC_SYSTEM, user };
}

function buildScriptRequest(title) {
  const user = [
    'Write a 3-minute English YouTube Shorts voiceover/dialogue for the VIDTOOLZ channel.',
    '',
    'Topic/title:',
    String(title || '').trim(),
    '',
    'Style:',
    '- spoken to a friend',
    '- blunt',
    '- funny',
    '- informative',
    '- practical',
    '- grounded',
    '- no fake evidence',
    '- no hype',
    '- no exaggerated claims',
    '- no generic AI influencer language',
    '- from the perspective of a working editor/video production systems builder',
    '',
    'The script should be understandable when spoken aloud.',
    '',
    'Return only the script text.',
  ].join('\n');
  return { system: SCRIPT_SYSTEM, user };
}

function promptArraySchema() {
  return { type: 'array', items: { type: 'string' } };
}

// `existingPrompts` (optional) are prompts the project already has; they are
// passed as "do not repeat" context so a top-up run yields distinct prompts.
// The list is bounded to keep the request small and maintainable.
function buildImagePromptsRequest(script, count, existingPrompts) {
  const n = clampCount(count, IMAGE_PROMPT_MAX);
  const lines = [
    `Based on this script, create exactly ${n} distinct vertical background image prompts for an AI-native video production systems YouTube Short.`,
    '',
    'Script:',
    String(script || '').trim(),
    '',
    'These are BACKGROUND PLATES that sit behind a presenter overlay added later.',
    '',
    'Requirements:',
    '- 1080x1920 vertical composition implied',
    '- background-plate style; leave clean, uncluttered space in the lower-right for a presenter overlay',
    '- visually varied across the set',
    '- no readable text, no fake text, no garbled letters, no lettering of any kind',
    '- no screenshots or mock-ups of real or fake software UIs',
    '- no presenter, no human, no host, no influencer, no editor figure, no camera operator, no people at all',
    '- no copyrighted characters or logos',
    '- no claims of real evidence',
    '- prefer visual metaphors, objects, rooms, machines, timelines, gates, pipelines, abstract systems',
    '- each prompt a clear single scene, specific enough for FLUX',
    '- each prompt different from the others',
  ];
  const exclusions = (Array.isArray(existingPrompts) ? existingPrompts : [])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .slice(0, 40);
  if (exclusions.length) {
    lines.push(
      '',
      'These prompts already exist — do NOT repeat or lightly reword any of them:',
      ...exclusions.map((p) => `- ${p}`),
      'Every new prompt must be clearly different from all of the above.'
    );
  }
  lines.push(
    '',
    'Return strict JSON:',
    '[',
    '  "prompt 1",',
    '  "prompt 2"',
    ']',
    '',
    `Return exactly ${n} strings and no commentary.`
  );
  return { system: PROMPTS_SYSTEM, user: lines.join('\n'), schema: promptArraySchema() };
}

// `existingPrompts` (optional) are infographic prompts the project already has;
// passed as "do not repeat" context so a top-up run yields distinct prompts.
function buildInfographicPromptsRequest(script, count, existingPrompts) {
  const n = clampCount(count, INFOGRAPHIC_PROMPT_MAX);
  const lines = [
    `Based on this script, create exactly ${n} infographic image prompts.`,
    '',
    'Script:',
    String(script || '').trim(),
    '',
    'Requirements:',
    '- explain concepts visually',
    '- clean editorial design',
    '- suitable as background or cutaway graphics',
    '- no readable text, no fake text, no garbled letters',
    '- no screenshots or mock-ups of real or fake software UIs',
    '- no people (no presenter, host, or editor figure)',
    '- no copyrighted logos',
    '- no unsupported factual claims',
    '- each prompt should describe the infographic clearly',
    '- suitable for local image generation',
  ];
  const exclusions = (Array.isArray(existingPrompts) ? existingPrompts : [])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .slice(0, 30);
  if (exclusions.length) {
    lines.push(
      '',
      'These prompts already exist — do NOT repeat or lightly reword any of them:',
      ...exclusions.map((p) => `- ${p}`),
      'Every new prompt must be clearly different from all of the above.'
    );
  }
  lines.push('', `Return a strict JSON array of exactly ${n} strings and no commentary.`);
  return { system: PROMPTS_SYSTEM, user: lines.join('\n'), schema: promptArraySchema() };
}

const I2V_SYSTEM =
  'You generate one image-to-video motion prompt for the VIDTOOLZ channel, for PRESTO ComfyUI (Wan2.2). ' +
  'Always write in English. Return ONLY the video prompt text — no preamble, no headings, no markdown, no quotes.';

function buildI2vPromptRequest(fields = {}) {
  const user = [
    'Create one image-to-video prompt for PRESTO ComfyUI based on this still image prompt and the script context.',
    '',
    'Script:',
    String(fields.script || '').trim(),
    '',
    'Image prompt:',
    String(fields.imagePrompt || '').trim(),
    '',
    'Image path/metadata:',
    String(fields.imageMetadata || '(still not generated yet; base the motion on the image prompt)').trim(),
    '',
    'Requirements:',
    '- describe motion/evolution from the still image',
    '- keep it grounded and controllable',
    '- no camera chaos',
    '- no impossible object transformations unless appropriate',
    '- suitable for a vertical AI video background',
    '- avoid duration/fps/resolution unless required by the existing PRESTO workflow',
    '- return only the video prompt text',
  ].join('\n');
  return { system: I2V_SYSTEM, user };
}

// One grounded motion prompt: strip think/fences/quotes, collapse to a tidy
// single block (newlines -> spaces so it drops cleanly into a workflow field).
function cleanI2vPrompt(raw) {
  let t = stripThinkingAndFences(raw);
  t = t.replace(/\s+/g, ' ').trim();
  t = stripWrappingQuotes(t);
  return t.trim();
}

function clampCount(count, max) {
  let n = Number(count);
  if (!Number.isFinite(n) || n < 1) n = max;
  return Math.min(max, Math.round(n));
}

// Strip qwen-style <think> blocks and markdown code fences from raw model text.
function stripThinkingAndFences(raw) {
  let text = String(raw == null ? '' : raw);
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<think>[\s\S]*$/i, ''); // unterminated think block
  // Remove ```json ... ``` or ``` ... ``` fences, keeping the inner content.
  text = text.replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, '$1');
  text = text.replace(/```/g, '');
  return text.trim();
}

function stripWrappingQuotes(text) {
  let t = String(text || '').trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      t = t.slice(1, -1).trim();
    }
  }
  return t;
}

// Single-line topic: collapse whitespace, drop a leading "Title:"/"Topic:" label.
function cleanTopic(raw) {
  let t = stripThinkingAndFences(raw);
  t = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || '';
  t = t.replace(/^(title|topic)\s*[:\-]\s*/i, '');
  t = stripWrappingQuotes(t);
  return t.trim();
}

// Multi-line script: keep paragraph structure, drop fences/think, tidy edges.
function cleanScript(raw) {
  let t = stripThinkingAndFences(raw);
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function firstBalancedBlock(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function coerceToStringArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const keys = ['prompts', 'image_prompts', 'infographic_prompts', 'infographics', 'items', 'data'];
    for (const key of keys) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) return value;
    }
  }
  return null;
}

function normalizeItems(items, maxCount) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    let text;
    if (typeof item === 'string') text = item;
    else if (item && typeof item === 'object') text = item.prompt || item.text || item.description || '';
    else text = '';
    text = stripWrappingQuotes(String(text).replace(/\s+/g, ' ').trim());
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxCount) break;
  }
  return out;
}

// Robust: parse an "up to N strings" prompt array from raw model output.
// Tries strict JSON, then a balanced [ ] / { } substring, then a line-split
// fallback. Deduplicates (case-insensitive), caps at maxCount, and throws a 502
// only when nothing usable can be extracted.
function parsePromptArray(raw, maxCount) {
  const max = Math.max(1, Math.round(Number(maxCount) || 1));
  const text = stripThinkingAndFences(raw);

  let items = null;

  // 1. Whole thing is JSON.
  try {
    items = coerceToStringArray(JSON.parse(text));
  } catch (_) { /* fall through */ }

  // 2. First balanced [ ... ] or { ... } block.
  if (!items) {
    const arrBlock = firstBalancedBlock(text, '[', ']');
    if (arrBlock) {
      try { items = coerceToStringArray(JSON.parse(arrBlock)); } catch (_) { /* ignore */ }
    }
  }
  if (!items) {
    const objBlock = firstBalancedBlock(text, '{', '}');
    if (objBlock) {
      try { items = coerceToStringArray(JSON.parse(objBlock)); } catch (_) { /* ignore */ }
    }
  }

  // 3. Line-split fallback: one prompt per non-empty line, drop numbering/bullets.
  if (!items) {
    items = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/,\s*$/, '').trim())
      .filter(Boolean);
  }

  const normalized = normalizeItems(items || [], max);
  if (normalized.length === 0) {
    const error = new Error('Could not parse any prompts from the model output.');
    error.statusCode = 502;
    throw error;
  }
  return normalized;
}

module.exports = {
  IMAGE_PROMPT_MAX,
  INFOGRAPHIC_PROMPT_MAX,
  buildTopicRequest,
  buildScriptRequest,
  buildImagePromptsRequest,
  buildInfographicPromptsRequest,
  buildI2vPromptRequest,
  promptArraySchema,
  clampCount,
  stripThinkingAndFences,
  stripWrappingQuotes,
  cleanTopic,
  cleanScript,
  cleanI2vPrompt,
  parsePromptArray,
};
