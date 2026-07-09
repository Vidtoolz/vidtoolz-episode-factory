'use strict';

// Pure, dependency-free helpers for the three-panel Script Evaluator workspace.
//
// It turns a normalized evaluation (from script-evaluator.js) into a set of
// NON-OVERLAPPING highlight spans mapped back to the EXACT original script text,
// and renders them to safe (HTML-escaped) markup. No network, no model output is
// ever rendered as raw HTML: every character that reaches the DOM is escaped
// here first, so a script that contains "<script>" can never inject anything.

// Sentence statuses (from script-evaluator.js) → highlight kind.
// strong/okay = keep (green); revise/cut = needs revision (red); anything else
// (e.g. unevaluated) = neutral bridge text.
const APPROVED_STATUSES = ['strong', 'okay'];
const DISAPPROVED_STATUSES = ['revise', 'cut'];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Map the evaluation's sentences back to exact [start,end) offsets in the
// original text. Sentences come from splitScriptIntoSentences (derived FROM the
// original, in order), so a forward-moving cursor + indexOf finds each one
// exactly. A sentence that cannot be located is NOT invented as a span — it is
// returned in `unmatched` so the caller can surface it as a note.
function mapSentenceSpans(originalText, sentences) {
  const text = String(originalText == null ? '' : originalText);
  const matched = [];
  const unmatched = [];
  let cursor = 0;
  for (const s of (Array.isArray(sentences) ? sentences : [])) {
    const excerpt = String(s && s.text != null ? s.text : '').trim();
    if (!excerpt) { continue; }
    const idx = text.indexOf(excerpt, cursor);
    if (idx < 0) {
      // Try once from the start (in case ordering drifted); still exact-match only.
      const fromStart = text.indexOf(excerpt);
      if (fromStart < 0) { unmatched.push(s); continue; }
      matched.push({ sentence: s, start: fromStart, end: fromStart + excerpt.length });
      continue;
    }
    matched.push({ sentence: s, start: idx, end: idx + excerpt.length });
    cursor = idx + excerpt.length;
  }
  return { matched, unmatched };
}

function kindForStatus(status) {
  const s = String(status || '').toLowerCase();
  if (APPROVED_STATUSES.indexOf(s) !== -1) return 'approved';
  if (DISAPPROVED_STATUSES.indexOf(s) !== -1) return 'disapproved';
  return 'neutral';
}

function firstNonEmpty(list) {
  for (const x of (Array.isArray(list) ? list : [])) {
    const t = String(x == null ? '' : x).trim();
    if (t) return t;
  }
  return '';
}

// Normalize a list of judged spans into a gap-free, NON-OVERLAPPING tiling of
// [0, text.length): overlaps are clipped (earlier span wins), out-of-range spans
// are dropped/clipped, and gaps become neutral bridge spans. The result always
// covers the whole text exactly once — corrupt/overlapping input can never
// produce corrupt output.
function normalizeSpans(judged, textLength) {
  const len = Math.max(0, Number(textLength) || 0);
  const clean = (Array.isArray(judged) ? judged : [])
    .map((s) => ({ ...s, start: Math.max(0, Math.min(len, Math.round(Number(s.start)))), end: Math.max(0, Math.min(len, Math.round(Number(s.end)))) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => (a.start - b.start) || (a.end - b.end));
  const out = [];
  let cursor = 0;
  for (const s of clean) {
    let start = s.start;
    if (start < cursor) start = cursor; // clip overlap: earlier span keeps its text
    if (start >= s.end) continue;       // fully swallowed by a previous span
    if (start > cursor) out.push({ start: cursor, end: start, kind: 'neutral' });
    out.push({ ...s, start, end: s.end });
    cursor = s.end;
  }
  if (cursor < len) out.push({ start: cursor, end: len, kind: 'neutral' });
  return out;
}

// Build the full highlight model for a script + its normalized evaluation.
// Returns { spans, approved, disapproved, notes } where `spans` tiles the whole
// original text (for rendering) and approved/disapproved are the judged subsets
// (for the API schema). Feedback for sentences that could not be located exactly
// goes into `notes` — never invented as a span.
function buildHighlightModel(originalText, evaluation) {
  const text = String(originalText == null ? '' : originalText);
  const ev = evaluation && typeof evaluation === 'object' ? evaluation : {};
  const { matched, unmatched } = mapSentenceSpans(text, ev.sentences || []);
  const judged = matched.map(({ sentence, start, end }) => {
    const kind = kindForStatus(sentence.status);
    const reason = kind === 'approved'
      ? (firstNonEmpty(sentence.positives) || 'Works well — keep.')
      : (firstNonEmpty(sentence.negatives) || String(sentence.edit_suggestion || '').trim() || 'Needs revision.');
    const suggestion = kind === 'disapproved'
      ? (String(sentence.edit_suggestion || '').trim() || String(sentence.optional_rewrite || '').trim())
      : '';
    return {
      start, end, kind,
      text: text.slice(start, end),
      sentence_id: sentence.sentence_id,
      reason,
      suggestion,
      status: sentence.status,
    };
  });
  const spans = normalizeSpans(judged, text.length);
  const approved = spans.filter((s) => s.kind === 'approved')
    .map((s) => ({ start: s.start, end: s.end, text: s.text, reason: s.reason }));
  const disapproved = spans.filter((s) => s.kind === 'disapproved')
    .map((s) => ({ start: s.start, end: s.end, text: s.text, reason: s.reason, suggestion: s.suggestion }));
  const notes = unmatched.map((s) => ({
    sentence_id: s.sentence_id,
    status: s.status,
    text: String(s.text || ''),
    reason: firstNonEmpty(s.negatives) || firstNonEmpty(s.positives) || String(s.edit_suggestion || ''),
    note: 'Could not map this passage to the exact original text; shown as a note instead of a highlight.',
  }));
  return { spans, approved, disapproved, notes };
}

// Render tiling spans to safe HTML. Every slice of the ORIGINAL text is escaped
// before it is placed in the DOM, and every model-authored reason/suggestion is
// escaped before it goes into a title attribute. Line breaks are preserved by
// the caller styling the container with white-space: pre-wrap.
function renderHighlightedHtml(originalText, spans) {
  const text = String(originalText == null ? '' : originalText);
  const list = Array.isArray(spans) ? spans : [];
  const parts = [];
  for (const s of list) {
    const raw = text.slice(s.start, s.end);
    const esc = escapeHtml(raw);
    if (s.kind === 'approved' || s.kind === 'disapproved') {
      const cls = s.kind === 'approved' ? 'approved-highlight' : 'rejected-highlight';
      const tip = s.suggestion ? `${s.reason} — Fix: ${s.suggestion}` : (s.reason || '');
      parts.push(`<span class="${cls}" title="${escapeHtml(tip)}">${esc}</span>`);
    } else {
      parts.push(`<span class="neutral-text">${esc}</span>`);
    }
  }
  return parts.join('');
}

// Map the evaluator's weighted categories onto the task's five headline scores
// (best-effort; falls back to null when a category is absent), and carry the
// verdict/total so the panel can show a compact summary.
function summarizeScores(evaluation) {
  const ev = evaluation && typeof evaluation === 'object' ? evaluation : {};
  const byId = {};
  for (const c of (Array.isArray(ev.categories) ? ev.categories : [])) {
    if (c && c.id) byId[c.id] = c;
  }
  const pick = (id) => (byId[id] && Number.isFinite(Number(byId[id].score)) ? Number(byId[id].score) : null);
  return {
    clarity: pick('core_claim'),
    structure: pick('structure_retention'),
    voice: pick('spoken_voice'),
    retention: pick('duration_density') != null ? pick('duration_density') : pick('structure_retention'),
    production_fit: pick('production_feasibility'),
    total_score: Number.isFinite(Number(ev.total_score)) ? Number(ev.total_score) : null,
    verdict: ev.verdict || null,
  };
}

module.exports = {
  escapeHtml,
  mapSentenceSpans,
  normalizeSpans,
  buildHighlightModel,
  renderHighlightedHtml,
  summarizeScores,
  APPROVED_STATUSES,
  DISAPPROVED_STATUSES,
};
