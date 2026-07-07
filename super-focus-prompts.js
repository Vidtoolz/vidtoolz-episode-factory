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

function buildImagePromptsRequest(script, count) {
  const n = clampCount(count, IMAGE_PROMPT_MAX);
  const user = [
    `Based on this script, create ${n} distinct vertical background image prompts for an AI-native video production systems YouTube Short.`,
    '',
    'Script:',
    String(script || '').trim(),
    '',
    'Requirements:',
    '- 1080x1920 vertical composition implied',
    '- visually varied',
    '- useful behind a presenter',
    '- no text-heavy poster designs unless explicitly needed',
    '- no fake screenshots of real tools',
    '- no copyrighted characters',
    '- no copyrighted logos',
    '- no claims of real evidence',
    '- clear visual metaphor or scene',
    '- suitable for local image generation',
    '- each prompt should be specific enough for FLUX',
    '- each prompt should be different from the others',
    '',
    'Return strict JSON:',
    '[',
    '  "prompt 1",',
    '  "prompt 2"',
    ']',
    '',
    `Return up to ${n} strings and no commentary.`,
  ].join('\n');
  return { system: PROMPTS_SYSTEM, user, schema: promptArraySchema() };
}

function buildInfographicPromptsRequest(script, count) {
  const n = clampCount(count, INFOGRAPHIC_PROMPT_MAX);
  const user = [
    `Based on this script, create ${n} infographic image prompts.`,
    '',
    'Script:',
    String(script || '').trim(),
    '',
    'Requirements:',
    '- explain concepts visually',
    '- clean editorial design',
    '- suitable as background or cutaway graphics',
    '- no tiny unreadable text',
    '- no fake UI screenshots',
    '- no copyrighted logos',
    '- no unsupported factual claims',
    '- each prompt should describe the infographic clearly',
    '- suitable for local image generation',
    '',
    `Return a strict JSON array of up to ${n} strings and no commentary.`,
  ].join('\n');
  return { system: PROMPTS_SYSTEM, user, schema: promptArraySchema() };
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
  promptArraySchema,
  clampCount,
  stripThinkingAndFences,
  stripWrappingQuotes,
  cleanTopic,
  cleanScript,
  parsePromptArray,
};
