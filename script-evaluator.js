'use strict';

// VIDTOOLZ script evaluator — pure, dependency-light, testable module (Slice 1).
//
// It evaluates a VIDTOOLZ short-form script against ONE standard and hands back
// concrete improvements — not a grammar check, not a generic writing coach:
//
//   A VIDTOOLZ script is good when it gives the viewer a sharper way to think
//   AND gives the production system clear things to build.
//
// This module is ADVISORY ONLY. It never approves a script, never advances
// downstream state, never generates media. It performs no network I/O itself:
// the server injects a `generate(prompt) -> rawString` provider (local Ollama,
// semantic pass only). Everything here is deterministic and unit-testable; the
// value is the rewrites (edit_suggestion / optional_rewrite / fix_plan /
// next_edit), not the number.

const crypto = require('crypto');

const SCHEMA_VERSION = 1;

const VIDTOOLZ_STANDARD =
  'A VIDTOOLZ script is good when it gives the viewer a sharper way to think ' +
  'AND gives the production system clear things to build.';

// Weighted categories (sum = 100). "Judgment & taste" is NOT a separate row: it
// modifies channel_fit, accuracy_trust, production_feasibility, and the written
// recommendation (does the script reject bad options, treat generation as
// material to curate rather than success, keep human approval as authority?).
const CATEGORIES = [
  { id: 'core_claim', label: 'Core claim / argument spine', weight: 15,
    guidance: 'One central claim, sayable in one sentence, sharp; every part supports it; a clear wrong-way/better-way contrast.' },
  { id: 'audience_pain', label: 'Audience pain', weight: 15,
    guidance: 'A real solo-creator/editor problem — not "AI is changing everything".' },
  { id: 'channel_fit', label: 'VIDTOOLZ channel fit', weight: 15,
    guidance: 'Belongs specifically on VIDTOOLZ (AI-native production systems for serious solo creators); sounds like a working editor built it; no influencer language, no tool-chasing. [judgment modifier applies]' },
  { id: 'spoken_voice', label: 'Spoken voice (Mikko-to-a-friend)', weight: 15,
    guidance: 'Blunt, funny, practical, clear, slightly impatient with nonsense; readable aloud; zero LinkedIn/blog register.' },
  { id: 'structure_retention', label: 'Structure & retention', weight: 10,
    guidance: 'Real hook, tension in the first 30s, a middle that progresses (does not repeat), lands the point, honest outro/click-through.' },
  { id: 'visual_potential', label: 'Visual potential', weight: 10,
    guidance: 'Sections become concrete image prompts and useful background plates; room for the presenter overlay; NO generic "glowing AI robot city" nonsense.' },
  { id: 'production_feasibility', label: 'Production feasibility (fits Super Focus)', weight: 10,
    guidance: 'Producible fast in Super Focus: ~5–10 good image prompts + 1–3 motion clips; no exact-UI proof, tiny text, long screen recordings, or manual compositing. [judgment modifier applies]' },
  { id: 'accuracy_trust', label: 'Accuracy & trust (anti-hype, scoped claims)', weight: 5,
    guidance: 'Claims supportable and scoped; no invented stats/studies; no "AI replaces everything"; opinions/operating-principles flagged as such. Do NOT fact-check the internet. [judgment modifier applies]' },
  { id: 'duration_density', label: 'Duration & density (~2–3 min spoken)', weight: 5,
    guidance: 'Close to short-form length, dense enough to be useful, every sentence earns its place.' },
];

const HARD_GATES = [
  { id: 'central_claim_one_sentence', label: 'Claim statable in one sentence?' },
  { id: 'speakable_naturally', label: 'Speakable naturally on camera?' },
  { id: 'generates_useful_visuals', label: 'Generates useful (non-generic) visuals?' },
];

const CHECKLIST = [
  { id: 'central_claim_sharp', label: 'Central claim sharp?' },
  { id: 'real_creator_pain', label: 'Solves a real creator pain?' },
  { id: 'fits_vidtoolz', label: 'Fits VIDTOOLZ, not generic AI YouTube?' },
  { id: 'sounds_like_mikko', label: 'Sounds like Mikko to a friend?' },
  { id: 'clear_structure', label: 'Clear argument structure?' },
  { id: 'usable_visuals', label: 'Every section creates usable visuals?' },
  { id: 'producible_fast', label: 'Producible fast in Super Focus?' },
  { id: 'truthful_non_hype', label: 'Truthful and non-hype?' },
  { id: 'duration_density_right', label: 'Duration/density right?' },
  { id: 'judgment_taste', label: 'Demonstrates judgment and taste?' },
];

const SENTENCE_ROLES = ['hook', 'setup', 'problem', 'claim', 'example', 'reframe', 'framework', 'visual_beat', 'transition', 'outro', 'filler', 'unclear'];
const SENTENCE_STATUSES = ['strong', 'okay', 'revise', 'cut'];
const GATE_STATUSES = ['pass', 'warn', 'fail'];

const TOTAL_WEIGHT = CATEGORIES.reduce((sum, c) => sum + c.weight, 0); // 100

// ── helpers ──────────────────────────────────────────────────────────────────

function hashScriptText(scriptText) {
  return crypto.createHash('sha1').update(String(scriptText == null ? '' : scriptText)).digest('hex');
}

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asStringList(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : (x && typeof x.text === 'string' ? x.text : '')))
    .map((s) => String(s).trim())
    .filter(Boolean);
}

function asStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normStatus(v, allowed, fallback) {
  const s = String(v || '').trim().toLowerCase();
  return allowed.indexOf(s) !== -1 ? s : fallback;
}

// ── deterministic sentence splitter (backend owns the IDs) ───────────────────

function splitScriptIntoSentences(scriptText) {
  const text = String(scriptText == null ? '' : scriptText).replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const pieces = [];
  // Line breaks are hard boundaries (script lines); within a line, split on
  // sentence-ending punctuation. Deterministic for a given input.
  text.split('\n').forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;
    const matches = trimmedLine.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    if (!matches) { pieces.push(trimmedLine); return; }
    matches.forEach((m) => { const t = m.trim(); if (t) pieces.push(t); });
  });
  return pieces.map((t, i) => ({ sentence_id: i + 1, text: t }));
}

// ── prompt builder ───────────────────────────────────────────────────────────

// JSON schema handed to the local model (Ollama `format`). Kept moderate so a
// small model can satisfy it; the parser is tolerant regardless.
function scriptEvaluationSchema() {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      hard_gates: { type: 'array', items: { type: 'object' } },
      categories: { type: 'array', items: { type: 'object' } },
      checklist: { type: 'array', items: { type: 'object' } },
      sentences: { type: 'array', items: { type: 'object' } },
      top_strengths: { type: 'array', items: { type: 'string' } },
      top_problems: { type: 'array', items: { type: 'string' } },
      fix_plan: { type: 'array', items: { type: 'string' } },
      next_edit: { type: 'string' },
    },
    required: ['categories', 'hard_gates', 'checklist', 'sentences', 'fix_plan', 'next_edit'],
  };
}

const EVAL_SYSTEM =
  'You are the VIDTOOLZ script evaluator — a production-readiness reviewer for a working editor\'s ' +
  'YouTube channel, NOT a grammar checker and NOT a generic writing coach. Judge only against the ' +
  'VIDTOOLZ standard and rubric given. If a suggestion would fit any YouTube script, it is wrong. ' +
  'Every improvement must be specific enough to act on without re-reading the rubric ("Cut the first ' +
  'two sentences; open on the line about the plate not rendering" — not "make the hook sharper"). ' +
  'Return ONLY strict JSON matching the schema — no preamble, no markdown fences, no commentary.';

function buildScriptEvaluationPrompt(scriptText, sentenceList, options = {}) {
  const sentences = Array.isArray(sentenceList) ? sentenceList : [];
  const catLines = CATEGORIES.map((c) => `- ${c.id} (${c.label}) [weight ${c.weight}]: ${c.guidance}`);
  const gateLines = HARD_GATES.map((g, i) => `${i + 1}. ${g.id} — ${g.label}`);
  const checklistLines = CHECKLIST.map((c, i) => `${i + 1}. ${c.id} — ${c.label}`);
  const user = [
    'THE VIDTOOLZ STANDARD (everything rolls up to this):',
    VIDTOOLZ_STANDARD,
    '',
    'Score the whole script /100 using these weighted categories (weights sum to 100).',
    'Each category returns: score (0–100), status (pass|warn|fail), positives[], negatives[], recommendation (name the fix, not the symptom):',
    ...catLines,
    '',
    'Judgment & taste is NOT a separate score — it modifies channel_fit, accuracy_trust, and production_feasibility, and it drives the written recommendation (does the script reject bad options, treat generation as material to curate rather than success, keep human approval as the authority?).',
    '',
    'THREE HARD GATES (each: status pass|warn|fail, reason, suggested_fix). A failing gate means the script is NOT ready regardless of score:',
    ...gateLines,
    '',
    '10-ITEM CHECKLIST (each: status pass|warn|fail + one-sentence reason):',
    ...checklistLines,
    '',
    'In categories[], hard_gates[], and checklist[], put the EXACT id shown above in an "id" field on each object (e.g. {"id":"core_claim",...}). Keep them in the order listed.',
    '',
    'RULES:',
    '- Anti-fact-checking: do NOT pretend to verify the internet. Flag claims as supportable / needs support / too broad / likely hype / unsupported as written.',
    '- Do NOT reward influencer / LinkedIn / corporate language — penalize it.',
    '- Good visual beats = concrete plates / metaphors / objects / rooms / machines / timelines / gates / pipelines / systems / motion. PENALIZE generic glowing-AI / robot / futuristic-city visuals.',
    '',
    'SENTENCE-LEVEL: evaluate EVERY sentence below, keyed by its exact sentence_id. Do NOT invent, merge, renumber, or add sentence IDs. Each sentence returns: sentence_id, role (' + SENTENCE_ROLES.join('|') + '), score 0–100, status (' + SENTENCE_STATUSES.join('|') + '), positives[], negatives[], highlighted_phrases[] ({text, type: positive|negative, reason}), edit_suggestion (one concrete instruction), optional_rewrite (an actual rewritten line, when it clearly helps).',
    '',
    'Deterministic sentence list (evaluate exactly these IDs):',
    JSON.stringify(sentences),
    '',
    'Also return: summary, top_strengths[], top_problems[], fix_plan[] (3–5 changes, highest-leverage first, that would move the verdict up a band), next_edit (the single most important thing to do right now).',
    '',
    'Full script (for context):',
    String(scriptText == null ? '' : scriptText).trim(),
    '',
    'Return ONLY strict JSON. Do not invent extra sentence IDs.',
  ].join('\n');
  void options;
  return { system: EVAL_SYSTEM, user, schema: scriptEvaluationSchema() };
}

// ── tolerant parser ──────────────────────────────────────────────────────────

function stripThinkingAndFences(raw) {
  let text = String(raw == null ? '' : raw);
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<think>[\s\S]*$/i, ''); // unterminated think block
  text = text.replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, '$1');
  text = text.replace(/```/g, '');
  return text.trim();
}

function firstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function looksLikeEvaluation(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj)
    && (obj.categories || obj.sentences || obj.hard_gates || obj.checklist || obj.fix_plan || obj.next_edit);
}

// Returns a plain object, or throws an Error with statusCode 502 when no usable
// JSON can be extracted. Never silently accepts garbage.
function parseScriptEvaluationOutput(rawModelOutput) {
  const text = stripThinkingAndFences(rawModelOutput);
  let obj = null;
  try { obj = JSON.parse(text); } catch (_) { /* fall through */ }
  if (!obj) {
    const block = firstBalancedObject(text);
    if (block) { try { obj = JSON.parse(block); } catch (_) { /* ignore */ } }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    const e = new Error('Could not parse a JSON evaluation from the model output.');
    e.statusCode = 502;
    throw e;
  }
  // Unwrap a single wrapper key, e.g. { "evaluation": { ... } }.
  if (!looksLikeEvaluation(obj)) {
    const keys = Object.keys(obj);
    for (const k of keys) {
      if (looksLikeEvaluation(obj[k])) { obj = obj[k]; break; }
    }
  }
  if (!looksLikeEvaluation(obj)) {
    const e = new Error('Model output JSON did not contain an evaluation.');
    e.statusCode = 502;
    throw e;
  }
  return obj;
}

// ── normalizer (ignores invented IDs, warns on missing) ──────────────────────

function indexBy(list, key) {
  const map = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (item && item[key] != null) map[String(item[key])] = item;
  });
  return map;
}

// Align a model-provided list of objects to canonical definitions (given IN
// ORDER). Small local models are inconsistent about the identifier key: some
// return `{"id": "core_claim"}`, some `{"name": "core_claim"}` or
// `{"item": "..."}`, and some return an ordered list with NO id field at all
// (relying on position, as the prompt numbers them). Match by any id-like key
// first (case-insensitive); if the model exposed NO recognizable id keys, fall
// back to positional alignment so we don't discard a perfectly good, ordered
// evaluation over a key-name mismatch. Returns get(defId, index) -> src|null.
function alignToDefs(list, idKeys) {
  const arr = Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : [];
  const byId = {};
  let anyKeyed = false;
  arr.forEach((item) => {
    idKeys.forEach((k) => {
      if (item[k] != null && String(item[k]).trim()) {
        anyKeyed = true;
        const norm = String(item[k]).trim().toLowerCase();
        if (!(norm in byId)) byId[norm] = item;
      }
    });
  });
  return function get(defId, index) {
    const hit = byId[String(defId).trim().toLowerCase()];
    if (hit) return hit;
    // Positional fallback ONLY when the model returned an unkeyed ordered list;
    // if it keyed some rows, an absent id genuinely means "not evaluated".
    if (!anyKeyed && arr[index]) return arr[index];
    return null;
  };
}

function normalizeScriptEvaluation(parsed, sentenceList) {
  const warnings = [];
  const p = parsed && typeof parsed === 'object' ? parsed : {};

  // Categories/gates/checklist: match by any id-like key the model used (id,
  // name, category, item…) with a positional fallback for unkeyed ordered
  // lists. An object keyed by id is also accepted (get() reads the array form;
  // object form is handled below).
  const catList = Array.isArray(p.categories) ? p.categories
    : (p.categories && typeof p.categories === 'object'
      ? Object.keys(p.categories).map((k) => Object.assign({ id: k }, p.categories[k])) : []);
  const getCat = alignToDefs(catList, ['id', 'name', 'category', 'key']);
  const categories = CATEGORIES.map((def, i) => {
    const src = getCat(def.id, i) || {};
    const missing = !getCat(def.id, i);
    if (missing) warnings.push(`category "${def.id}" missing from model output`);
    return {
      id: def.id,
      label: def.label,
      weight: def.weight,
      score: missing ? 0 : clampScore(src.score),
      weighted_score: 0, // filled by scoreScriptEvaluation
      status: normStatus(src.status, GATE_STATUSES, missing ? 'fail' : 'warn'),
      positives: asStringList(src.positives),
      negatives: asStringList(src.negatives),
      recommendation: asStr(src.recommendation),
    };
  });

  const gateList = Array.isArray(p.hard_gates) ? p.hard_gates
    : (p.hard_gates && typeof p.hard_gates === 'object'
      ? Object.keys(p.hard_gates).map((k) => Object.assign({ id: k }, p.hard_gates[k])) : []);
  const getGate = alignToDefs(gateList, ['id', 'name', 'gate', 'key']);
  const hard_gates = HARD_GATES.map((def, i) => {
    const src = getGate(def.id, i) || {};
    const missing = !getGate(def.id, i);
    if (missing) warnings.push(`hard gate "${def.id}" missing from model output`);
    // Hard gates are readiness gates: a missing or unrecognized status must NOT
    // read as pass-through. Default to 'fail' (conservative) so an omitted gate
    // or a near-miss token ("failed", "no") still caps the verdict — matching
    // the "a failing gate blocks PRODUCE" contract (categories likewise default
    // missing -> fail). A legitimate 'warn' from the model is preserved.
    const gateStatus = normStatus(src.status, GATE_STATUSES, 'fail');
    if (missing && gateStatus === 'fail') warnings.push(`hard gate "${def.id}" treated as FAIL (missing) — verdict will not be PRODUCE`);
    return {
      id: def.id,
      label: def.label,
      status: gateStatus,
      reason: asStr(src.reason),
      suggested_fix: asStr(src.suggested_fix),
    };
  });

  const checkList = Array.isArray(p.checklist) ? p.checklist
    : (p.checklist && typeof p.checklist === 'object'
      ? Object.keys(p.checklist).map((k) => Object.assign({ id: k }, p.checklist[k])) : []);
  const getCheck = alignToDefs(checkList, ['id', 'item', 'name', 'key']);
  const checklist = CHECKLIST.map((def, i) => {
    const src = getCheck(def.id, i) || {};
    return {
      id: def.id,
      label: def.label,
      status: normStatus(src.status, GATE_STATUSES, 'warn'),
      reason: asStr(src.reason),
    };
  });

  // Sentences: validate IDs against the backend-owned list; ignore invented IDs.
  const validIds = new Set((Array.isArray(sentenceList) ? sentenceList : []).map((s) => Number(s.sentence_id)));
  const bySentenceId = {};
  (Array.isArray(p.sentences) ? p.sentences : []).forEach((s) => {
    if (!s || typeof s !== 'object') return;
    const sid = Number(s.sentence_id);
    if (!Number.isInteger(sid)) return;
    if (!validIds.has(sid)) { warnings.push(`ignored invented sentence id ${sid} from model output`); return; }
    bySentenceId[sid] = s;
  });
  const sentences = (Array.isArray(sentenceList) ? sentenceList : []).map((base) => {
    const sid = Number(base.sentence_id);
    const src = bySentenceId[sid];
    if (!src) {
      warnings.push(`sentence ${sid} was not evaluated by the model`);
      return {
        sentence_id: sid, text: base.text, role: 'unclear', score: 0, status: 'unevaluated',
        positives: [], negatives: [], highlighted_phrases: [], edit_suggestion: '', optional_rewrite: '',
      };
    }
    const phrases = (Array.isArray(src.highlighted_phrases) ? src.highlighted_phrases : [])
      .map((h) => ({
        text: asStr(h && h.text),
        type: (String(h && h.type).toLowerCase() === 'positive') ? 'positive' : 'negative',
        reason: asStr(h && h.reason),
      }))
      .filter((h) => h.text);
    return {
      sentence_id: sid,
      text: base.text, // backend text is authoritative
      role: normStatus(src.role, SENTENCE_ROLES, 'unclear'),
      score: clampScore(src.score),
      status: normStatus(src.status, SENTENCE_STATUSES, 'okay'),
      positives: asStringList(src.positives),
      negatives: asStringList(src.negatives),
      highlighted_phrases: phrases,
      edit_suggestion: asStr(src.edit_suggestion),
      optional_rewrite: asStr(src.optional_rewrite),
    };
  });

  return {
    schema_version: SCHEMA_VERSION,
    summary: asStr(p.summary),
    hard_gates,
    categories,
    checklist,
    sentences,
    top_strengths: asStringList(p.top_strengths),
    top_problems: asStringList(p.top_problems),
    fix_plan: asStringList(p.fix_plan),
    next_edit: asStr(p.next_edit),
    warnings,
  };
}

// ── scorer (weights → total → band → verdict, with hard-gate cap) ────────────

function bandFor(total) {
  if (total >= 90) return { score_band: 'PRODUCE', verdict: 'PRODUCE' };
  if (total >= 80) return { score_band: 'PRODUCE_MINOR_EDITS', verdict: 'PRODUCE' };
  if (total >= 70) return { score_band: 'REVISE', verdict: 'REVISE' };
  return { score_band: 'REWRITE', verdict: 'REWRITE' };
}

const VERDICT_RANK = { PRODUCE: 2, REVISE: 1, REWRITE: 0 };

function scoreScriptEvaluation(normalized) {
  const categories = (normalized.categories || []).map((c) => {
    const weight = Number(c.weight) || 0;
    return Object.assign({}, c, { weighted_score: Math.round((clampScore(c.score) / 100) * weight * 10) / 10 });
  });
  const total_score = Math.round(categories.reduce((sum, c) => sum + c.weighted_score, 0));
  const band = bandFor(total_score);
  let verdict = band.verdict;
  const warnings = (normalized.warnings || []).slice();

  // Any hard-gate FAIL caps the verdict at REVISE or worse (never PRODUCE).
  const failedGate = (normalized.hard_gates || []).find((g) => g.status === 'fail');
  let verdict_capped_by_gate = false;
  if (failedGate && VERDICT_RANK[verdict] > VERDICT_RANK.REVISE) {
    verdict = 'REVISE';
    verdict_capped_by_gate = true;
    warnings.push(`verdict capped at REVISE by failing hard gate: ${failedGate.id}`);
  }

  return Object.assign({}, normalized, {
    categories,
    total_score,
    score_band: band.score_band,
    verdict,
    verdict_capped_by_gate,
    warnings,
  });
}

// ── orchestration (no network here — server injects `generate`) ──────────────

// generate: async (prompt:{system,user,schema}) => rawString
async function evaluateScriptWithProvider(args = {}) {
  const scriptText = args.scriptText;
  const generate = args.generate || args.modelProvider;
  const options = args.options || {};
  if (typeof generate !== 'function') {
    throw new Error('evaluateScriptWithProvider requires a generate(prompt) function.');
  }
  const trimmed = String(scriptText == null ? '' : scriptText).trim();
  if (!trimmed) {
    const e = new Error('Cannot evaluate an empty script. Save a script first.');
    e.statusCode = 400;
    throw e;
  }
  const sentences = splitScriptIntoSentences(scriptText);
  const prompt = buildScriptEvaluationPrompt(scriptText, sentences, options);
  const raw = await generate(prompt);
  const parsed = parseScriptEvaluationOutput(raw);
  const normalized = normalizeScriptEvaluation(parsed, sentences);
  const scored = scoreScriptEvaluation(normalized);
  return Object.assign({}, scored, {
    script_hash: hashScriptText(scriptText),
    evaluated_at: options.now || new Date().toISOString(),
    model: options.model || null,
  });
}

module.exports = {
  SCHEMA_VERSION,
  VIDTOOLZ_STANDARD,
  CATEGORIES,
  HARD_GATES,
  CHECKLIST,
  TOTAL_WEIGHT,
  SENTENCE_ROLES,
  SENTENCE_STATUSES,
  hashScriptText,
  splitScriptIntoSentences,
  scriptEvaluationSchema,
  buildScriptEvaluationPrompt,
  parseScriptEvaluationOutput,
  normalizeScriptEvaluation,
  scoreScriptEvaluation,
  bandFor,
  evaluateScriptWithProvider,
};
