/*
 * VIDTOOLZ project-scoped image-prompt generation (pure: prompt + parse/validate).
 *
 * Turns a project's APPROVED final script into a set of FLUX image prompts in the
 * exact schema the editor + resolver expect ({image_prompts:[{index, prompt, ...}]}).
 * The LLM call itself stays in the server (callOllamaChat → local Ollama on
 * vidnux, no cloud fallback); this module builds the prompt, and parses/validates
 * the model output into clean records. It does NOT generate images.
 *
 * Anti-text doctrine: FLUX prompts must not bake in readable text/captions/logos.
 * The builder instructs this and the parser enforces it (rejects positive
 * "text that says…" instructions; appends a no-text clause when missing).
 */

const DEFAULT_COUNT = 25;
const MIN_PROMPT_LEN = 40;
const NO_TEXT_CLAUSE = 'No readable text, captions, labels, logos, or UI.';

// Beats the script should be mapped across (variety + narrative coverage).
const BEATS = ['opening hook', 'problem', 'contrast', 'example / proof', 'decision point', 'process / gates', 'conclusion'];

function buildImagePromptRequest(ctx = {}) {
  const count = ctx.count || DEFAULT_COUNT;
  const script = String(ctx.script || '').slice(0, 8000);
  const system = [
    'You write FLUX text-to-image prompts for VIDTOOLZ — vertical YouTube videos for serious solo AI-video creators.',
    'Each prompt describes ONE photorealistic background/source image to sit behind a presenter.',
    'HARD RULES for every prompt:',
    '- vertical 1080x1920 composition; photorealistic unless the project clearly needs another style;',
    '- NO readable text, captions, labels, logos, signage, or UI text inside the image; no fake charts with unreadable text;',
    '- strong, clear subject and composition; cinematic lighting; shallow depth of field where useful;',
    '- leave safe negative space (often upper-left or top) so a presenter can sit lower-right;',
    '- no misleading "proof" visuals unless clearly conceptual.',
    'Make the set VARIED (no repeated visual idea) and map it across the script\'s narrative beats: ' + BEATS.join(', ') + '.',
    'Return STRICT JSON only — no prose, no markdown fences.',
  ].join('\n');
  const user = [
    `Project title: ${ctx.title || ''}`,
    ctx.premise ? `Topic / premise: ${ctx.premise}` : '',
    ctx.scoreSummary ? `Why it matters: ${ctx.scoreSummary}` : '',
    '',
    'APPROVED SCRIPT:',
    script || '(script unavailable)',
    '',
    `Return exactly ${count} image prompts as JSON:`,
    '{"prompts":[{"index","category","beat","intended_use","prompt"}]}',
    'index: 1..N. category: short shot type (e.g. cinematic, editorial, broll, conceptual).',
    'beat: which narrative beat it serves. intended_use: the script moment it supports.',
    'prompt: the full photorealistic FLUX description (follow the hard rules above).',
  ].filter((l) => l !== '').join('\n');
  const schema = {
    type: 'object',
    properties: {
      prompts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' }, category: { type: 'string' }, beat: { type: 'string' },
            intended_use: { type: 'string' }, prompt: { type: 'string' },
          },
          required: ['prompt'],
        },
      },
    },
    required: ['prompts'],
  };
  return { system, user, schema };
}

// A prompt that BAKES IN readable text is rejected. "no readable text" is fine.
function bakesInText(p) {
  const s = String(p).toLowerCase();
  return /(text|caption|sign|label|words?|title)\s+(that\s+)?(say|says|reading|reads)/.test(s)
    || /\b(says|reads|reading)\s+["“]/.test(s);
}
function hasNoTextClause(p) {
  return /no\s+(readable\s+)?(text|caption|words|signage|ui)/i.test(String(p));
}

function stripFences(content) {
  return String(content == null ? '' : content).replace(/```(?:json)?/gi, '').trim();
}

// Parse + validate model output into exactly `count` clean records in the
// editor's schema. Throws 502 on malformed / insufficient output (no partial write).
function parseImagePrompts(content, count, ctx = {}) {
  let parsed;
  try { parsed = typeof content === 'string' ? JSON.parse(stripFences(content)) : content; } catch (e) {
    const err = new Error('Image-prompt model did not return valid JSON.'); err.statusCode = 502; throw err;
  }
  const list = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.prompts) ? parsed.prompts
      : (parsed && Array.isArray(parsed.image_prompts) ? parsed.image_prompts : null));
  if (!list) { const e = new Error('Model returned no prompts array.'); e.statusCode = 502; throw e; }

  const nowIso = ctx.nowIso || new Date().toISOString();
  const clean = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    let prompt = String(it.prompt == null ? '' : it.prompt).trim();
    if (prompt.length < MIN_PROMPT_LEN) continue;          // drop too-short/generic
    if (bakesInText(prompt)) continue;                      // drop "text that says …"
    if (!hasNoTextClause(prompt)) prompt = `${prompt} ${NO_TEXT_CLAUSE}`; // enforce doctrine
    clean.push({
      category: String(it.category || 'cinematic').trim(),
      beat: String(it.beat || '').trim(),
      intended_use: String(it.intended_use || it.beat || '').trim(),
      prompt,
    });
    if (clean.length === count) break;
  }
  if (clean.length < count) {
    const e = new Error(`Model produced ${clean.length} usable prompt(s); ${count} required. Try again.`);
    e.statusCode = 502; throw e;
  }
  // Assign sequential 1..N indexes + provenance; passes saveImagePrompts validation.
  return clean.map((r, i) => Object.assign({
    index: i + 1,
    category: r.category,
    intended_use: r.intended_use,
    beat: r.beat,
    prompt: r.prompt,
    prompt_provider: 'ollama',
    prompt_host: 'vidnux',
    source: 'local_ollama_vidnux',
    generated_from: 'approved_script',
    generated_at: nowIso,
    project_id: ctx.projectId || '',
  }));
}

function buildManifest(records, ctx = {}) {
  return {
    generator: 'project-image-prompts',
    provider: 'ollama',
    provider_host: 'vidnux',
    model: ctx.model || '',
    source: 'local_ollama_vidnux',
    generated_from: 'approved_script',
    generated_at: ctx.nowIso || new Date().toISOString(),
    project_id: ctx.projectId || '',
    script_path: ctx.scriptPath || '',
    prompt_count: records.length,
  };
}

module.exports = {
  DEFAULT_COUNT,
  MIN_PROMPT_LEN,
  NO_TEXT_CLAUSE,
  BEATS,
  buildImagePromptRequest,
  parseImagePrompts,
  buildManifest,
  bakesInText,
  hasNoTextClause,
};
