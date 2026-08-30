'use strict';

/*
 * Deterministic semantic pause planner for DRAFT narration.
 *
 * Doctrine (config/visual-draft-production-doctrine-v1.json, voiceover_pauses):
 * occasional ~0.5 s pauses at natural rhetorical boundaries, never after every
 * sentence, and the canonical words are immutable — this module plans TIMING
 * only. It never rewrites, paraphrases, adds, removes, or reorders a word: it
 * only names sentence boundaries where silence may be inserted.
 *
 * The planner is a pure function of the spoken text. No model call: a bounded
 * deterministic heuristic satisfies the contract, and determinism is worth
 * more here than taste — the human reviews the finished draft, not the plan.
 *
 * Placement rules, in priority order at each sentence boundary:
 *   argument boundary   the boundary between two Story sections
 *   before contrast     next sentence opens with a contrast marker
 *   before conclusion   next sentence opens with a conclusion marker
 *   rhetorical turn     the sentence just spoken was a question
 *   after dense sentence the sentence just spoken is long enough to need a beat
 *
 * Guards: no pause after the final sentence, no two adjacent boundaries both
 * paused (minimum one unpaused boundary between pauses), and a hard ceiling of
 * half the available boundaries so the result is structurally "occasional".
 */

const doctrineModule = require('./visual-draft-doctrine.js');

const PLAN_SCHEMA = 'vidtoolz.naturalPausePlan.v1';
const PLANNER_ID = 'deterministic-semantic-v1';

const CONTRAST_RE = /^(?:but|yet|however|instead|still|and yet|on the other hand|except)\b/i;
const CONCLUSION_RE = /^(?:so\b|that's why|that is why|the point\b|which means|this means|in the end|the lesson|here's the thing|that's the)/i;
const DENSE_WORD_COUNT = 18;

class PausePlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PausePlanError';
    this.code = code;
  }
}

function fail(code, message) { throw new PausePlanError(code, message); }

/*
 * Deterministic sentence split on terminal punctuation. Trailing quotes and
 * parentheses stay attached to their sentence. No word is altered: joining the
 * returned sentences with single spaces preserves the exact word sequence.
 */
function splitSentences(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/(?<=[.!?…]["')\]]?)\s+/);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function words(text) { return String(text || '').split(/\s+/).filter((token) => token.length > 0); }

function categorize(sentence, nextSentence, isSectionBoundary) {
  if (isSectionBoundary) return { category: 'argument boundary', reason: 'boundary between Story sections' };
  if (nextSentence && CONTRAST_RE.test(nextSentence)) return { category: 'before contrast', reason: `next sentence opens with a contrast marker: "${words(nextSentence).slice(0, 3).join(' ')}…"` };
  if (nextSentence && CONCLUSION_RE.test(nextSentence)) return { category: 'before conclusion', reason: `next sentence opens with a conclusion marker: "${words(nextSentence).slice(0, 3).join(' ')}…"` };
  if (/\?["')\]]?$/.test(sentence)) return { category: 'rhetorical turn', reason: 'the sentence just spoken is a question; the silence lets it land' };
  if (words(sentence).length >= DENSE_WORD_COUNT) return { category: 'after dense sentence', reason: `dense idea landing point (${words(sentence).length} words)` };
  return null;
}

/*
 * sections: [{ section_id, order, text }] — spoken dialogue in Story order.
 * Returns the typed pause plan. Positions are sentence boundaries only, so a
 * pause can never fall inside a phrase.
 */
function planPauses(sections, options = {}) {
  if (!Array.isArray(sections) || sections.length === 0) fail('PAUSE_PLAN_SECTIONS_REQUIRED', 'spoken sections are required');
  const doctrine = options.doctrine || doctrineModule.activeDoctrine(options).rules.voiceover_pauses;
  const targetSeconds = options.targetSeconds ?? doctrine.target_seconds;
  if (!(targetSeconds > 0)) fail('PAUSE_PLAN_TARGET_INVALID', String(targetSeconds));

  const boundaries = [];
  const sentenceMap = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    if (!section.section_id || typeof section.text !== 'string') fail('PAUSE_PLAN_SECTION_INVALID', String(section.section_id));
    const sentences = splitSentences(section.text);
    if (sentences.length === 0) continue;
    sentenceMap.push({ section_id: section.section_id, sentences });
    for (let index = 0; index < sentences.length; index += 1) {
      const isLastOfSection = index === sentences.length - 1;
      const isLastOfProgramme = isLastOfSection && sectionIndex === sections.length - 1;
      const nextSentence = isLastOfSection
        ? splitSentences(sections[sectionIndex + 1]?.text || '')[0] || null
        : sentences[index + 1];
      boundaries.push({
        section_id: section.section_id,
        after_sentence_index: index,
        sentence: sentences[index],
        next_sentence: nextSentence,
        section_boundary: isLastOfSection && !isLastOfProgramme,
        programme_end: isLastOfProgramme,
      });
    }
  }
  const totalSentences = boundaries.length;
  if (totalSentences === 0) fail('PAUSE_PLAN_NO_SENTENCES', 'no spoken sentences to plan against');

  const eligible = boundaries.filter((boundary) => !boundary.programme_end);
  const ceiling = Math.floor(eligible.length / 2);
  const pauses = [];
  let lastPausedGlobalIndex = -2;
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    if (boundary.programme_end) continue;
    if (pauses.length >= ceiling) break;
    if (index - lastPausedGlobalIndex < 2) continue; // never two adjacent boundaries
    const match = categorize(boundary.sentence, boundary.next_sentence, boundary.section_boundary);
    if (!match) continue;
    pauses.push({
      pause_id: `P${String(pauses.length + 1).padStart(2, '0')}`,
      section_id: boundary.section_id,
      after_sentence_index: boundary.after_sentence_index,
      after_sentence_text: boundary.sentence,
      duration_seconds: targetSeconds,
      category: match.category,
      reason: match.reason,
    });
    lastPausedGlobalIndex = index;
  }

  return {
    schema: PLAN_SCHEMA,
    planner: PLANNER_ID,
    target_seconds: targetSeconds,
    sentence_count: totalSentences,
    eligible_boundary_count: eligible.length,
    pause_ceiling: ceiling,
    pause_count: pauses.length,
    paused_every_sentence: eligible.length > 0 && pauses.length >= eligible.length,
    pauses,
    guards: {
      words_immutable: true,
      timing_only: true,
      sentence_boundaries_only: true,
      no_adjacent_pauses: true,
      no_pause_after_final_sentence: true,
    },
  };
}

/* Fail-closed structural validation of a pause plan against its sections. */
function validatePausePlan(plan, sections) {
  if (plan?.schema !== PLAN_SCHEMA) fail('PAUSE_PLAN_SCHEMA_INVALID', String(plan?.schema));
  const sentencesBySection = new Map();
  for (const section of sections) sentencesBySection.set(section.section_id, splitSentences(section.text));
  const seen = new Set();
  const eligibleTotal = [...sentencesBySection.values()].reduce((sum, list) => sum + list.length, 0) - 1;
  if (plan.pauses.length > Math.floor(Math.max(0, eligibleTotal) / 2)) fail('PAUSE_PLAN_TOO_DENSE', 'pause plan exceeds the occasional ceiling');
  const lastSection = sections[sections.length - 1];
  const lastSentences = sentencesBySection.get(lastSection.section_id) || [];
  for (const pause of plan.pauses) {
    const key = `${pause.section_id}:${pause.after_sentence_index}`;
    if (seen.has(key)) fail('PAUSE_PLAN_DOUBLED', key);
    seen.add(key);
    const sentences = sentencesBySection.get(pause.section_id);
    if (!sentences || !Number.isInteger(pause.after_sentence_index) || pause.after_sentence_index < 0 || pause.after_sentence_index >= sentences.length) fail('PAUSE_PLAN_POSITION_INVALID', key);
    if (sentences[pause.after_sentence_index] !== pause.after_sentence_text) fail('PAUSE_PLAN_TEXT_DRIFT', key);
    if (!(pause.duration_seconds > 0)) fail('PAUSE_PLAN_DURATION_INVALID', key);
    if (pause.section_id === lastSection.section_id && pause.after_sentence_index === lastSentences.length - 1) fail('PAUSE_PLAN_AFTER_FINAL_SENTENCE', key);
  }
  return true;
}

module.exports = {
  PLAN_SCHEMA,
  PLANNER_ID,
  DENSE_WORD_COUNT,
  PausePlanError,
  splitSentences,
  words,
  planPauses,
  validatePausePlan,
};
