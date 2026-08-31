'use strict';

/*
 * Model-specific prompt serialization for Draft music candidates.
 *
 * One shared semantic authority (master MusicRenderBrief v1 + a candidate
 * concept from DraftMusicAnalysis) is serialized per model:
 *   - MiniMax Music 3: derive a per-candidate MusicRenderBrief (existing
 *     interpretations.briefOverridesForConcept vocabulary) and render it
 *     through the EXISTING canonical caption adapter — no second caption
 *     grammar.
 *   - Stable Audio 3 Medium: one deterministic descriptive text prompt
 *     (SA3M native semantics: a single vivid description), built only from
 *     canonical fields. The internal ComfyUI "reprompt" LLM stays DISABLED so
 *     prompt authority remains here with exact provenance.
 * Same brief+concept in → byte-identical prompts out. No LLM, no I/O.
 */

const crypto = require('node:crypto');
const interpretations = require('../score-engine/interpretations.js');
const briefContract = require('../score-engine/music-render-brief.js');
const captionAdapter = require('../score-engine/adapters/minimax-caption-reference.js');

class DraftMusicPromptError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftMusicPromptError'; this.code = code; }
}
function fail(code, message) { throw new DraftMusicPromptError(code, message); }
function sha256Text(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

const TEMPO_WORDS = Object.freeze({ slow: 'slow, unhurried tempo', moderate: 'moderate steady tempo', driving: 'driving forward tempo', free: 'free tempo, no strict grid' });
const BRIGHTNESS_WORDS = Object.freeze({ dark: 'dark low-register tonality', dusky: 'dusky muted tonality', neutral: 'balanced tonality', bright: 'bright open tonality' });
const SPACE_WORDS = Object.freeze({ dry_close: 'dry close acoustic space', intimate: 'intimate small-room space', roomy: 'natural roomy space', wide_cinematic: 'wide cinematic stereo space', cavernous: 'huge cavernous reverberant space' });
const VALENCE_WORDS = Object.freeze({ dark: 'ominous and serious', tense: 'tense and suspenseful', neutral: 'focused and neutral', warm: 'warm and human', uplifting: 'uplifting and optimistic' });
const FORM_WORDS = Object.freeze({
  through_composed: 'through-composed, continuously evolving with no verse repeats',
  verse_like_cycles: 'cyclical sections that return with variation',
  build_release_arc: 'one long build-and-release arc',
  layered_loop_evolution: 'evolving layered groove that adds and removes layers',
  episodic: 'episodic contrasting sections joined by transitions',
});
const GENRE_WORDS = Object.freeze({
  electronic: 'modern electronic instrumental', orchestral_cinematic: 'cinematic orchestral instrumental',
  acoustic_organic: 'organic acoustic instrumental', hybrid: 'hybrid orchestral-electronic instrumental',
  ambient_textural: 'ambient textural instrumental', percussive_world: 'percussive world-instrument piece',
  jazz_leaning: 'jazz-leaning instrumental', lofi_beat: 'lofi instrumental beat',
});
const INSTRUMENT_WORDS = Object.freeze({
  synths: 'analog and digital synthesizers', strings_orchestral: 'orchestral strings',
  piano_keys: 'piano and keyboards', guitars: 'clean and textured guitars',
  world_percussion: 'hand percussion and world drums', hybrid_orchestral_electronic: 'strings blended with synthesizers',
  textural_sound_design: 'textural sound design elements',
});
const PERC_WORDS = Object.freeze({
  none: 'no drums', soft_brushed: 'soft brushed percussion', electronic_kit: 'electronic drum programming',
  organic_hand: 'organic hand percussion', cinematic_hits: 'sparse cinematic percussion hits', full_kit: 'full drum kit',
});

/* Stable Audio 3 Medium — one deterministic descriptive prompt. */
function stableAudioPrompt(brief, candidate) {
  const errors = briefContract.validateMusicRenderBrief(brief);
  if (errors.length) fail('DRAFT_MUSIC_BRIEF_INVALID', errors[0]);
  const v = candidate?.diversity_vector;
  if (!v) fail('DRAFT_MUSIC_CONCEPT_REQUIRED', candidate?.concept_label || 'candidate');
  const avoid = [...new Set([...(brief.avoid || []), 'lead vocals', 'singing', 'spoken words', 'harsh piercing highs'])];
  const parts = [
    `Instrumental background track: ${GENRE_WORDS[v.genre_family]}, ${Math.round(brief.target_duration_s)} seconds, ${TEMPO_WORDS[v.tempo_feel]}${brief.tempo && brief.tempo !== 'free' ? ` around ${brief.tempo} BPM` : ''}.`,
    `${candidate.character}`,
    `Primary palette: ${INSTRUMENT_WORDS[v.instrumentation_family]} with ${PERC_WORDS[v.percussion_style]}; ${BRIGHTNESS_WORDS[v.tonal_brightness]}; ${SPACE_WORDS[v.spatial_character]}; ${VALENCE_WORDS[v.emotional_valence]} mood.`,
    `Structure: ${FORM_WORDS[v.structural_form]}; energy ${brief.energy_curve.replace(/-/g, ' ')} across the full duration; ${describeEnding(v.ending_style)}.`,
    'Made to sit under continuous spoken narration: keep the speech midrange uncluttered, no constant lead melody on top, controlled dynamics.',
    `Avoid: ${avoid.join(', ')}.`,
  ];
  const prompt = parts.join(' ');
  return { prompt, prompt_sha256: sha256Text(prompt) };
}

function describeEnding(ending) {
  return {
    'clear-button': 'end on a clear intentional button, not a fade',
    fade: 'end with a gentle controlled fade',
    sting: 'end with a short final sting',
    'loop-ready-tail': 'end with a clean loop-ready tail',
  }[ending] || 'end intentionally';
}

/* MiniMax Music 3 — per-candidate brief through the EXISTING caption adapter. */
function minimaxCandidateBrief(brief, candidate) {
  const errors = briefContract.validateMusicRenderBrief(brief);
  if (errors.length) fail('DRAFT_MUSIC_BRIEF_INVALID', errors[0]);
  const axes = candidate?.interpretation_axes;
  if (!axes) fail('DRAFT_MUSIC_CONCEPT_REQUIRED', candidate?.concept_label || 'candidate');
  const overrides = interpretations.briefOverridesForConcept({ character: candidate.character, axes });
  const derived = structuredClone(brief);
  derived.brief_id = `${brief.brief_id}-${String(candidate.candidate_slot || 'x').toLowerCase()}`.slice(0, 80);
  if (overrides.ending) derived.ending = overrides.ending;
  const avoid = new Set([...(brief.avoid || []), ...(overrides.avoid || [])]);
  if (avoid.size) derived.avoid = [...avoid].slice(0, 12).map((item) => item.slice(0, 60));
  const requirement = (overrides.required || []).join('; ');
  if (derived.sections?.length && (requirement || overrides.section_note)) {
    const note = [overrides.section_note, requirement].filter(Boolean).join('. ');
    derived.sections = derived.sections.map((section) => ({
      ...section,
      notes: `${section.notes ? `${section.notes}. ` : ''}${note}`.slice(0, 300),
    }));
  }
  const derivedErrors = briefContract.validateMusicRenderBrief(derived);
  if (derivedErrors.length) fail('DRAFT_MUSIC_CANDIDATE_BRIEF_INVALID', derivedErrors[0]);
  return derived;
}

function minimaxCaption(brief, candidate) {
  const derived = minimaxCandidateBrief(brief, candidate);
  const rendered = captionAdapter.renderMiniMaxCaption(derived);
  return { candidate_brief: derived, caption: rendered.caption, caption_sha256: sha256Text(rendered.caption) };
}

/* One canonical prompt bundle per candidate+model — the provenance unit. */
function promptFor(model, brief, candidate) {
  if (model === 'stable_audio_3_medium') {
    const built = stableAudioPrompt(brief, candidate);
    return { model, kind: 'SA3M_TEXT_PROMPT', prompt_text: built.prompt, prompt_sha256: built.prompt_sha256, candidate_brief: null };
  }
  if (model === 'minimax_music_3') {
    const built = minimaxCaption(brief, candidate);
    return { model, kind: 'MINIMAX_CAPTION', prompt_text: built.caption, prompt_sha256: built.caption_sha256, candidate_brief: built.candidate_brief };
  }
  fail('DRAFT_MUSIC_MODEL_UNKNOWN', String(model));
}

module.exports = {
  DraftMusicPromptError, stableAudioPrompt, minimaxCandidateBrief, minimaxCaption, promptFor, sha256Text,
};
