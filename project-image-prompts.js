/*
 * VIDTOOLZ project-scoped image-prompt generation (pure: prompt + parse/validate).
 *
 * Turns a project's APPROVED final script into a set of FLUX image prompts in the
 * exact schema the editor + resolver expect ({image_prompts:[{index, prompt, ...}]}).
 * The LLM call itself stays in the server (callOllamaChat → local Ollama on
 * vidnux, no cloud fallback); this module builds the instruction, and
 * parses/normalizes/validates the model output. It does NOT generate images.
 *
 * Quality contract enforced here:
 *  - every prompt is NORMALIZED to carry the same constraint line: photorealistic,
 *    vertical 1080x1920, presenter-safe negative space lower-right, and the
 *    anti-text doctrine (no readable text/captions/signs/logos/UI);
 *  - the batch is REJECTED (502, nothing written) if the count is wrong, if
 *    near-duplicate prompts appear (model looping), or if too many screen/
 *    interface prompts appear; too many face close-ups is a warning.
 */

const DEFAULT_COUNT = 25;
const MIN_PROMPT_LEN = 40;
const MAX_SCREEN_PROMPTS = 3;
const MAX_FACE_CLOSEUPS = 3;
const DUP_SIMILARITY = 0.82;

// The single constraint line appended to every prompt (guarantees the global
// language regardless of what the model returns).
const CONSTRAINTS = 'Photorealistic, vertical 1080x1920 composition, strong presenter-safe negative space in the lower-right for an on-camera host. No readable text, captions, signs, logos, or UI.';
const NO_TEXT_CLAUSE = CONSTRAINTS; // back-compat export

const BEATS = ['opening hook', 'problem', 'contrast', 'example / proof', 'decision point', 'process / gates', 'conclusion'];

function buildImagePromptRequest(ctx = {}) {
  const count = ctx.count || DEFAULT_COUNT;
  const script = String(ctx.script || '').slice(0, 8000);
  const system = [
    'You write FLUX text-to-image prompts for VIDTOOLZ — vertical YouTube videos for serious solo AI-video creators.',
    'Each prompt describes ONE photorealistic background/source image that will sit BEHIND an on-camera presenter and later be animated (image-to-video).',
    '',
    'HARD RULES for EVERY prompt:',
    '- photorealistic; vertical 1080x1920 composition;',
    '- strong presenter-safe NEGATIVE SPACE in the lower-right (leave room for a host); the main subject sits left/upper or off-centre;',
    '- NO readable text, captions, signs, labels, logos, or UI anywhere in the image; no fake charts/graphs with unreadable text;',
    '- AVOID visible computer interfaces/screens; if a screen must appear it is powered-off, abstract glow, or heavily blurred — and use at most ' + MAX_SCREEN_PROMPTS + ' such prompts total;',
    '- at most ' + MAX_FACE_CLOSEUPS + ' tight face close-ups in the whole set;',
    '- NO repeated shot template — every prompt is a distinct scene/subject/angle;',
    '- strong clear subject, cinematic lighting, shallow depth of field where useful; usable as an I2V background.',
    '',
    'SCRIPT-SPECIFIC EXTRACTION (important): read the script and turn ITS OWN concrete metaphors, named examples, analogies, and turning points into images.',
    'If the script names a band/musicians, show a recording studio / session players. If it mentions automation or agents doing busywork, show an automated/robotic work area with no human. If it mentions a hollow or copied version of a person, show an empty chair / faceless mannequin / glitching duplicate. Depict specific human quirks/flaws as candid, imperfect, real moments — not generic "determined" faces.',
    'Cover the narrative arc across the set: ' + BEATS.join(', ') + '. Make the set genuinely varied.',
    '',
    'Return STRICT JSON only — no prose, no markdown fences. Do NOT put the global constraints in each prompt; describe only the SCENE (the system appends the constraints).',
  ].join('\n');
  const user = [
    `Project title: ${ctx.title || ''}`,
    ctx.premise ? `Topic / premise: ${ctx.premise}` : '',
    ctx.scoreSummary ? `Why it matters: ${ctx.scoreSummary}` : '',
    '',
    'APPROVED SCRIPT (extract its real imagery):',
    script || '(script unavailable)',
    '',
    `Return exactly ${count} DISTINCT image prompts as JSON:`,
    '{"prompts":[{"index","category","beat","intended_use","prompt"}]}',
    'index: 1..N. category: short shot type. beat: which narrative beat. intended_use: the exact script moment it depicts.',
    'prompt: the photorealistic SCENE description only (no global constraint boilerplate — that is appended automatically).',
    'No two prompts may describe the same scene.',
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

// A scene that BAKES IN readable text is rejected. "no readable text" is fine.
function bakesInText(p) {
  const s = String(p).toLowerCase();
  return /(text|caption|sign|label|words?|title)\s+(that\s+)?(say|says|reading|reads)/.test(s)
    || /\b(says|reads|reading)\s+["“]/.test(s);
}
function hasNoTextClause(p) {
  return /no\s+(readable\s+)?(text|caption|words|signage|ui)/i.test(String(p));
}
function isScreenScene(s) {
  return /\b(screen|monitor|laptop|interface|dashboard|timeline|ui|display|tablet)\b/i.test(String(s));
}
function isFaceCloseup(s) {
  const t = String(s).toLowerCase();
  return /close-?up/.test(t) && /\b(face|eyes|expression)\b/.test(t);
}

function stripFences(content) {
  return String(content == null ? '' : content).replace(/```(?:json)?/gi, '').trim();
}
// Remove any global-constraint boilerplate the model echoed, so we can compare
// SCENES and append exactly one canonical constraint line.
function sceneOnly(prompt) {
  return String(prompt)
    .replace(/no\s+readable\s+text[^.]*\.?/ig, '')
    .replace(/photorealistic[,]?\s*/ig, '')
    .replace(/vertical\s*1080x1920[^.]*\.?/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenSet(s) {
  return new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) || []);
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// Parse + normalize + validate model output into exactly `count` clean records.
// Throws 502 (no partial write) on malformed/insufficient/duplicate/over-screen output.
function parseImagePrompts(content, count, ctx = {}) {
  let parsed;
  try { parsed = typeof content === 'string' ? JSON.parse(stripFences(content)) : content; } catch (e) {
    const err = new Error('Image-prompt model did not return valid JSON.'); err.statusCode = 502; throw err;
  }
  const list = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.prompts) ? parsed.prompts
      : (parsed && Array.isArray(parsed.image_prompts) ? parsed.image_prompts : null));
  if (!list) { const e = new Error('Model returned no prompts array.'); e.statusCode = 502; throw e; }

  // Greedy selection: keep `count` DISTINCT, presenter-safe scenes — skipping
  // near-duplicates (model looping), too-short/baked, and screen/face over the
  // caps. The endpoint over-generates candidates so dedup has headroom; we only
  // fail (502) when the model genuinely can't supply `count` distinct prompts.
  const scenes = [];
  const keptSets = [];
  let screens = 0;
  let faces = 0;
  const skipped = { dup: 0, screen: 0, face: 0, short: 0 };
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const raw = String(it.prompt == null ? '' : it.prompt).trim();
    if (raw.length < MIN_PROMPT_LEN || bakesInText(raw)) { skipped.short += 1; continue; }
    const scene = sceneOnly(raw);
    if (scene.length < MIN_PROMPT_LEN) { skipped.short += 1; continue; }
    const set = tokenSet(scene);
    if (keptSets.some((k) => jaccard(k, set) >= DUP_SIMILARITY)) { skipped.dup += 1; continue; }
    const screen = isScreenScene(scene);
    const face = isFaceCloseup(scene);
    if (screen && screens >= MAX_SCREEN_PROMPTS) { skipped.screen += 1; continue; }
    if (face && faces >= MAX_FACE_CLOSEUPS) { skipped.face += 1; continue; }
    scenes.push({
      scene,
      category: String(it.category || 'cinematic').trim(),
      beat: String(it.beat || '').trim(),
      intended_use: String(it.intended_use || it.beat || '').trim(),
    });
    keptSets.push(set);
    if (screen) screens += 1;
    if (face) faces += 1;
    if (scenes.length === count) break;
  }
  if (scenes.length < count) {
    const e = new Error(`Model produced only ${scenes.length} distinct presenter-safe prompt(s); ${count} required (skipped ${skipped.dup} near-duplicate, ${skipped.screen} extra-screen, ${skipped.face} extra-face, ${skipped.short} too-short/text). Try again.`);
    e.statusCode = 502; throw e;
  }

  const nowIso = ctx.nowIso || new Date().toISOString();
  const records = scenes.map((s, i) => ({
    index: i + 1,
    category: s.category,
    intended_use: s.intended_use,
    beat: s.beat,
    prompt: `${s.scene} ${CONSTRAINTS}`,       // normalized: every prompt carries the global rules
    prompt_provider: 'ollama',
    prompt_host: 'vidnux',
    source: 'local_ollama_vidnux',
    generated_from: 'approved_script',
    generated_at: nowIso,
    project_id: ctx.projectId || '',
  }));
  return records;
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
  MAX_SCREEN_PROMPTS,
  MAX_FACE_CLOSEUPS,
  DUP_SIMILARITY,
  CONSTRAINTS,
  NO_TEXT_CLAUSE,
  BEATS,
  buildImagePromptRequest,
  parseImagePrompts,
  buildManifest,
  bakesInText,
  hasNoTextClause,
  isScreenScene,
  isFaceCloseup,
};
