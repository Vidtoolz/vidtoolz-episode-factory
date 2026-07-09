'use strict';

// Chunked evaluation support for the Script Evaluator workspace.
//
// A full ~3-minute script is too big for one Ollama request (qwen3:14b times
// out). This splits the deterministic sentence list into small, ordered chunks,
// each evaluated separately; the per-chunk results are combined deterministically
// into ONE evaluation object. Highlight offset-mapping is NOT done here — the
// combined `sentences` list stays in original order with exact original text, so
// script-highlight.buildHighlightModel maps every span to the full-script
// offsets by its existing forward scan (no offset arithmetic, no injected HTML).

const scriptEvaluator = require('./script-evaluator.js');

// Conservative defaults: a real ~3-min script measured ~100s per 6-sentence
// chunk on qwen3:14b (close to the 120s ceiling), so keep chunks small for
// comfortable timeout headroom. All three are env/option tunable.
const DEFAULT_MAX_CHUNK_CHARS = 1000; // SCRIPT_EVALUATOR_MAX_CHUNK_CHARS
const DEFAULT_CHUNK_SENTENCES = 4;    // SCRIPT_EVALUATOR_CHUNK_SIZE
const DEFAULT_TIMEOUT_MS = 120000;    // SCRIPT_EVALUATOR_TIMEOUT_MS

function intFromEnvOrOpt(optVal, envName, fallback) {
  if (Number(optVal) > 0) return Math.floor(Number(optVal));
  if (Number(process.env[envName]) > 0) return Math.floor(Number(process.env[envName]));
  return fallback;
}

function resolveChunking(options = {}) {
  return {
    maxChars: intFromEnvOrOpt(options.scriptEvaluatorMaxChunkChars, 'SCRIPT_EVALUATOR_MAX_CHUNK_CHARS', DEFAULT_MAX_CHUNK_CHARS),
    maxSentences: intFromEnvOrOpt(options.scriptEvaluatorChunkSize, 'SCRIPT_EVALUATOR_CHUNK_SIZE', DEFAULT_CHUNK_SENTENCES),
  };
}

function resolveTimeoutMs(options = {}) {
  return intFromEnvOrOpt(options.scriptEvaluatorTimeoutMs, 'SCRIPT_EVALUATOR_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
}

// Group an ordered sentence list into ordered chunks bounded by BOTH a sentence
// count and a character budget. Each chunk carries its own 1..M sentence ids and
// a joined text to send to the model. A single over-long sentence still becomes
// its own chunk (never an empty chunk, never an infinite loop).
function chunkScriptSentences(sentences, options = {}) {
  const { maxChars, maxSentences } = resolveChunking(options);
  const list = Array.isArray(sentences) ? sentences.filter((s) => s && typeof s.text === 'string' && s.text.trim()) : [];
  const chunks = [];
  let cur = [];
  let curChars = 0;
  const flush = () => {
    if (!cur.length) return;
    const reid = cur.map((s, i) => ({ sentence_id: i + 1, text: s.text }));
    chunks.push({ index: chunks.length, sentences: reid, text: reid.map((s) => s.text).join('\n') });
    cur = [];
    curChars = 0;
  };
  for (const s of list) {
    const len = s.text.length + 1;
    if (cur.length && (cur.length >= maxSentences || (curChars + len) > maxChars)) flush();
    cur.push(s);
    curChars += len;
  }
  flush();
  return chunks;
}

function uniqCap(items, cap) {
  const out = [];
  const seen = new Set();
  for (const x of (Array.isArray(items) ? items : [])) {
    const t = String(x == null ? '' : x).trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

function statusForScore(score) {
  if (score >= 70) return 'pass';
  if (score >= 40) return 'warn';
  return 'fail';
}

// Combine per-chunk SCORED evaluations into one evaluation object. Sentence-level
// judgments (used for highlighting) are concatenated in order; category scores
// are averaged across the chunks that reported them and re-scored with the
// canonical weights so total_score/verdict stay consistent with a single-pass
// evaluation. hard_gates/checklist are left empty (the workspace UI does not use
// them, and averaging gates across chunks is not meaningful).
function combineChunkEvaluations(chunkEvals) {
  const evals = Array.isArray(chunkEvals) ? chunkEvals.filter(Boolean) : [];
  const sentences = [];
  evals.forEach((ev) => {
    (ev.sentences || []).forEach((s) => { sentences.push(Object.assign({}, s, { sentence_id: sentences.length + 1 })); });
  });
  const categories = scriptEvaluator.CATEGORIES.map((def) => {
    const scores = [];
    const negatives = [];
    const positives = [];
    let recommendation = '';
    evals.forEach((ev) => {
      const c = (ev.categories || []).find((x) => x.id === def.id);
      if (!c) return;
      if (Number.isFinite(Number(c.score))) scores.push(Number(c.score));
      (c.negatives || []).forEach((n) => negatives.push(n));
      (c.positives || []).forEach((p) => positives.push(p));
      if (!recommendation && c.recommendation) recommendation = c.recommendation;
    });
    const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return {
      id: def.id, label: def.label, weight: def.weight,
      score, status: statusForScore(score),
      positives: uniqCap(positives, 3), negatives: uniqCap(negatives, 3),
      recommendation,
    };
  });
  const combined = {
    summary: uniqCap(evals.map((e) => e.summary), 4).join(' '),
    categories,
    hard_gates: [],
    checklist: [],
    sentences,
    top_strengths: uniqCap([].concat(...evals.map((e) => e.top_strengths || [])), 8),
    top_problems: uniqCap([].concat(...evals.map((e) => e.top_problems || [])), 8),
    fix_plan: uniqCap([].concat(...evals.map((e) => e.fix_plan || [])), 8),
    next_edit: (evals.map((e) => e.next_edit).find((x) => x && String(x).trim())) || '',
    warnings: [],
  };
  // Re-score with canonical weights so total_score/verdict are consistent.
  return scriptEvaluator.scoreScriptEvaluation(combined);
}

module.exports = {
  DEFAULT_MAX_CHUNK_CHARS,
  DEFAULT_CHUNK_SENTENCES,
  DEFAULT_TIMEOUT_MS,
  resolveChunking,
  resolveTimeoutMs,
  chunkScriptSentences,
  combineChunkEvaluations,
};
