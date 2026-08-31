'use strict';

/*
 * Draft music analysis authority — script → DraftMusicAnalysis.
 *
 * One canonical, script-conditioned document (vidtoolz.draftMusicAnalysis.v1)
 * that carries: the narrative/emotional analysis, a timeline-aware music
 * function map, ONE master MusicRenderBrief v1 (the frozen generator-neutral
 * contract — reused, not duplicated), and EXACTLY THREE diversity-separated
 * candidate concepts. Generation never starts from a generic prompt: the
 * analysis is produced from the actual script text by the routed local model
 * and validated fail-closed against canonical vocabulary.
 *
 * Vocabulary reuse: interpretation axes/enums come from
 * score-engine/interpretations.js and MusicRenderBrief enums from
 * score-engine/music-render-brief.js — no duplicate taxonomy.
 */

const crypto = require('node:crypto');

const interpretations = require('../score-engine/interpretations.js');
const briefContract = require('../score-engine/music-render-brief.js');
const director = require('./visual-planning-director.js');

const SCHEMA = 'vidtoolz.draftMusicAnalysis.v1';
const TARGET_DURATION_S = 180;
const MAX_MODEL_ATTEMPTS = 3;
const DEFAULT_MODEL_TIMEOUT_MS = 540000;

/* §9 music function map vocabulary (narrative function → musical function). */
const MUSIC_FUNCTIONS = Object.freeze([
  'OPENING_TENSION', 'FORWARD_MOTION', 'REFLECTION', 'EXPLANATION', 'BUILD',
  'RELEASE', 'HUMOR', 'CONTRAST', 'REFRAME', 'RESOLUTION', 'ENDING',
]);

/* Diversity vector: mission dimensions, reusing existing enums wherever one
 * exists. New enums are defined once here and validated fail-closed. */
const NEW_ENUMS = Object.freeze({
  genre_family: ['electronic', 'orchestral_cinematic', 'acoustic_organic', 'hybrid', 'ambient_textural', 'percussive_world', 'jazz_leaning', 'lofi_beat'],
  tempo_feel: ['slow', 'moderate', 'driving', 'free'],
  instrumentation_family: ['synths', 'strings_orchestral', 'piano_keys', 'guitars', 'world_percussion', 'hybrid_orchestral_electronic', 'textural_sound_design'],
  acoustic_electronic_balance: ['acoustic', 'leaning_acoustic', 'balanced', 'leaning_electronic', 'electronic'],
  percussion_style: ['none', 'soft_brushed', 'electronic_kit', 'organic_hand', 'cinematic_hits', 'full_kit'],
  tonal_brightness: ['dark', 'dusky', 'neutral', 'bright'],
  spatial_character: ['dry_close', 'intimate', 'roomy', 'wide_cinematic', 'cavernous'],
  emotional_valence: ['dark', 'tense', 'neutral', 'warm', 'uplifting'],
  structural_form: ['through_composed', 'verse_like_cycles', 'build_release_arc', 'layered_loop_evolution', 'episodic'],
  motif_strategy: ['single_recurring_motif', 'fragmentary_motifs', 'rhythmic_motif', 'no_motif_texture'],
  production_aesthetic: ['clean_modern', 'warm_analog', 'cinematic_polished', 'lofi_textured', 'raw_organic'],
});

const VECTOR_ENUMS = Object.freeze({
  genre_family: NEW_ENUMS.genre_family,
  tempo_feel: NEW_ENUMS.tempo_feel,
  instrumentation_family: NEW_ENUMS.instrumentation_family,
  acoustic_electronic_balance: NEW_ENUMS.acoustic_electronic_balance,
  pulse_style: interpretations.RHYTHM_STRATEGIES,
  percussion_style: NEW_ENUMS.percussion_style,
  rhythmic_density: interpretations.DENSITY_STRATEGIES,
  melodic_density: interpretations.MELODIC_STRATEGIES,
  harmonic_tension: interpretations.HARMONIC_CHARACTERS,
  tonal_brightness: NEW_ENUMS.tonal_brightness,
  textural_density: interpretations.DENSITY_STRATEGIES,
  spatial_character: NEW_ENUMS.spatial_character,
  emotional_valence: NEW_ENUMS.emotional_valence,
  intensity_curve: briefContract.ENERGY_CURVES,
  structural_form: NEW_ENUMS.structural_form,
  motif_strategy: NEW_ENUMS.motif_strategy,
  production_aesthetic: NEW_ENUMS.production_aesthetic,
  ending_style: interpretations.ENDING_STRATEGIES,
  texture: interpretations.TEXTURES,
  development: interpretations.DEVELOPMENTS,
  opening: interpretations.OPENINGS,
  climax: interpretations.CLIMAX_STRATEGIES,
  timbre: interpretations.TIMBRE_FAMILIES,
});
const VECTOR_FIELDS = Object.freeze(Object.keys(VECTOR_ENUMS));

/* §12 hard diversity: candidates must differ on many MAJOR axes, not on seeds
 * or wording. */
const MAJOR_AXES = Object.freeze([
  'genre_family', 'instrumentation_family', 'acoustic_electronic_balance',
  'pulse_style', 'percussion_style', 'emotional_valence', 'structural_form',
  'tonal_brightness', 'production_aesthetic', 'timbre', 'spatial_character',
]);
const DIVERSITY_MIN_MAJOR_DIFF = 5;

class DraftMusicAnalysisError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftMusicAnalysisError'; this.code = code; }
}
function fail(code, message) { throw new DraftMusicAnalysisError(code, message); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex'); }
function nonempty(v) { return typeof v === 'string' && v.trim().length > 0; }
function stringArray(v, max) { return Array.isArray(v) && v.length <= max && v.every((x) => nonempty(x)); }

function majorAxisDifference(a, b) {
  return MAJOR_AXES.filter((axis) => a[axis] !== b[axis]).length;
}

/* Interpretation-axes projection: the existing caption/brief override system
 * (interpretations.briefOverridesForConcept) speaks the original axis names. */
function interpretationAxesFor(vector) {
  return {
    rhythm: vector.pulse_style,
    melody: vector.melodic_density,
    harmonic: vector.harmonic_tension,
    density: vector.textural_density,
    texture: vector.texture,
    development: vector.development,
    opening: vector.opening,
    climax: vector.climax,
    ending: vector.ending_style,
    timbre: vector.timbre,
    tempo_feel: 'as_planned',
    pulse_style: 'as_planned',
    melody_bias: 'as_planned',
  };
}

function validateVector(vector, label, errors) {
  if (!vector || typeof vector !== 'object' || Array.isArray(vector)) { errors.push(`${label}: diversity_vector must be an object`); return; }
  for (const field of VECTOR_FIELDS) {
    if (!VECTOR_ENUMS[field].includes(vector[field])) errors.push(`${label}.${field}: must be one of ${VECTOR_ENUMS[field].join('|')}`);
  }
  for (const key of Object.keys(vector)) if (!VECTOR_FIELDS.includes(key)) errors.push(`${label}.${key}: unknown diversity dimension`);
}

function validateAnalysisDocument(doc) {
  const errors = [];
  const a = doc?.analysis;
  if (!a || typeof a !== 'object') errors.push('analysis: required object');
  else {
    for (const field of ['video_purpose', 'core_claim', 'emotional_arc', 'pacing', 'beginning_function', 'middle_development', 'ending_function']) {
      if (!nonempty(a[field])) errors.push(`analysis.${field}: required non-empty string`);
    }
    if (!['high', 'medium', 'low'].includes(a.narration_density)) errors.push('analysis.narration_density: high|medium|low');
    if (!briefContract.ENERGY_CURVES.includes(a.energy_progression)) errors.push(`analysis.energy_progression: one of ${briefContract.ENERGY_CURVES.join('|')}`);
    for (const field of ['tension_points', 'light_sections', 'reveals', 'sections_needing_space']) {
      if (a[field] !== undefined && !stringArray(a[field], 12)) errors.push(`analysis.${field}: array of up to 12 non-empty strings`);
    }
  }
  const map = doc?.music_function_map;
  if (!Array.isArray(map) || map.length < 3 || map.length > 16) errors.push('music_function_map: 3-16 entries required');
  else map.forEach((item, index) => {
    if (!nonempty(item?.section)) errors.push(`music_function_map[${index}].section: required`);
    if (!MUSIC_FUNCTIONS.includes(item?.music_function)) errors.push(`music_function_map[${index}].music_function: one of ${MUSIC_FUNCTIONS.join('|')}`);
  });
  const briefErrors = briefContract.validateMusicRenderBrief(doc?.master_brief || {});
  for (const item of briefErrors) errors.push(`master_brief.${item}`);
  if (doc?.master_brief?.mix_role !== 'underlay') errors.push('master_brief.mix_role: Draft narration-bed music must be underlay');
  if (doc?.master_brief && Math.abs(Number(doc.master_brief.target_duration_s) - doc.target_duration_s) > 0.001) {
    errors.push('master_brief.target_duration_s: must equal the requested target duration');
  }
  const candidates = doc?.candidates;
  if (!Array.isArray(candidates) || candidates.length !== 3) errors.push('candidates: exactly 3 required');
  else {
    const slots = candidates.map((c) => c?.candidate_slot);
    if (JSON.stringify(slots) !== JSON.stringify(['A', 'B', 'C'])) errors.push('candidates: slots must be exactly A, B, C in order');
    candidates.forEach((c, index) => {
      if (!nonempty(c?.concept_label)) errors.push(`candidates[${index}].concept_label: required`);
      if (!nonempty(c?.character) || c.character.length < 30) errors.push(`candidates[${index}].character: required (>=30 chars) — describe the musical interpretation`);
      validateVector(c?.diversity_vector, `candidates[${index}].diversity_vector`, errors);
    });
    if (!errors.length) {
      for (let i = 0; i < 3; i += 1) {
        for (let j = i + 1; j < 3; j += 1) {
          const diff = majorAxisDifference(candidates[i].diversity_vector, candidates[j].diversity_vector);
          if (diff < DIVERSITY_MIN_MAJOR_DIFF) {
            errors.push(`candidates ${candidates[i].candidate_slot}/${candidates[j].candidate_slot}: only ${diff} major-axis differences (need >= ${DIVERSITY_MIN_MAJOR_DIFF}) — seeds/wording/BPM tweaks are not diversity`);
          }
        }
      }
    }
  }
  return errors;
}

function buildPrompt(input, priorErrors) {
  const schemaHint = {
    analysis: {
      video_purpose: 'string', core_claim: 'string', emotional_arc: 'string', pacing: 'string',
      narration_density: 'high|medium|low', energy_progression: briefContract.ENERGY_CURVES.join('|'),
      tension_points: ['string'], light_sections: ['string'], reveals: ['string'], sections_needing_space: ['string'],
      beginning_function: 'string', middle_development: 'string', ending_function: 'string',
    },
    music_function_map: [{ section: 'string (script section/beat name)', music_function: MUSIC_FUNCTIONS.join('|') }],
    master_brief: {
      brief_id: 'lowercase-slug', brief_version: 1, purpose: 'string 8-400 chars', target_duration_s: input.targetDurationS,
      energy_curve: briefContract.ENERGY_CURVES.join('|'), tempo: '"free" or BPM like "92" or "90-100"',
      emotion_curve: ['string'], sections: [{ name: 'string', start_s: 0, end_s: input.targetDurationS, notes: 'string' }],
      avoid: ['string'], narration_density: [{ start_s: 0, end_s: input.targetDurationS, density: 'high|medium|low' }],
      ending: briefContract.ENDINGS.join('|'), mix_role: 'underlay',
    },
    candidates: [{ candidate_slot: 'A then B then C', concept_label: 'short name', character: 'one-paragraph musical interpretation', diversity_vector: Object.fromEntries(VECTOR_FIELDS.map((f) => [f, VECTOR_ENUMS[f].join('|')])) }],
  };
  return [
    'You are the music department analyst for a narrated vertical video. Analyze the EXACT script below and design background music direction for it.',
    'The music sits UNDER continuous spoken narration: interesting but never competing (avoid congestion in the speech midrange, avoid constant lead melody, no vocals).',
    'Produce ONE JSON object only, exactly matching the schema. Every enum value must be copied exactly from the allowed list.',
    'The three candidates must be THREE SUBSTANTIALLY DIFFERENT musical interpretations of this same video — different genre/instrumentation/energy territories, not three seeds of one idea. Candidate C must occupy musical territory that A and B leave open.',
    `Each pair of candidates must differ on at least ${DIVERSITY_MIN_MAJOR_DIFF} of these major axes: ${MAJOR_AXES.join(', ')}.`,
    `Target track duration: ${input.targetDurationS} seconds. Sections in master_brief must tile 0..${input.targetDurationS}s and follow the script's arc.`,
    `Output schema: ${JSON.stringify(schemaHint)}`,
    priorErrors && priorErrors.length ? `Your previous answer failed validation. Fix EXACTLY these problems and change nothing else conceptually:\n${priorErrors.slice(0, 25).join('\n')}` : '',
    `SCRIPT (authoritative, hash ${input.scriptSha256}):\n${input.scriptText}`,
  ].filter(Boolean).join('\n\n');
}

async function analyzeScript(input, options = {}) {
  if (!nonempty(input?.scriptText) || input.scriptText.trim().length < 80) fail('DRAFT_MUSIC_SCRIPT_REQUIRED', 'a real script text is required');
  const scriptSha256 = digest(input.scriptText);
  if (input.scriptSha256 && input.scriptSha256 !== scriptSha256) fail('DRAFT_MUSIC_SCRIPT_HASH_MISMATCH', 'provided script hash does not match script bytes');
  const targetDurationS = Number(input.targetDurationS) || TARGET_DURATION_S;
  const route = options.route || director.selectComputeRoute();
  const request = { scriptText: input.scriptText, scriptSha256, targetDurationS };
  let errors = null; let parsed = null; let attempts = 0; let modelLatencyMs = 0;
  while (attempts < (options.maxAttempts || MAX_MODEL_ATTEMPTS)) {
    attempts += 1;
    const startedAt = Date.now();
    let raw;
    try {
      raw = await director.invokeModel(buildPrompt(request, errors), route, { timeoutMs: options.timeoutMs || DEFAULT_MODEL_TIMEOUT_MS, modelAdapter: options.modelAdapter });
    } catch (error) {
      modelLatencyMs += Date.now() - startedAt;
      errors = [`MODEL_FAILED: ${error.message}`];
      continue;
    }
    modelLatencyMs += Date.now() - startedAt;
    let value;
    try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (error) { errors = [`invalid JSON: ${error.message}`]; continue; }
    const validation = validateAnalysisDocument({ ...value, target_duration_s: targetDurationS });
    if (!validation.length) { parsed = value; break; }
    errors = validation;
  }
  if (!parsed) fail('DRAFT_MUSIC_ANALYSIS_FAILED', `analysis rejected after ${attempts} attempts: ${(errors || ['no output']).slice(0, 6).join('; ')}`);
  const core = {
    schema: SCHEMA,
    script: { sha256: scriptSha256, story: input.story || null },
    target_duration_s: targetDurationS,
    analysis: parsed.analysis,
    music_function_map: parsed.music_function_map,
    master_brief: parsed.master_brief,
    candidates: parsed.candidates.map((candidate) => ({
      ...candidate,
      interpretation_axes: interpretationAxesFor(candidate.diversity_vector),
    })),
    diversity: {
      major_axes: MAJOR_AXES,
      min_major_axis_difference: DIVERSITY_MIN_MAJOR_DIFF,
      pairwise_major_axis_differences: {
        AB: majorAxisDifference(parsed.candidates[0].diversity_vector, parsed.candidates[1].diversity_vector),
        AC: majorAxisDifference(parsed.candidates[0].diversity_vector, parsed.candidates[2].diversity_vector),
        BC: majorAxisDifference(parsed.candidates[1].diversity_vector, parsed.candidates[2].diversity_vector),
      },
    },
    route: { lane: route.lane, host: route.host, model: route.model, attempts, model_latency_ms: modelLatencyMs },
    publication_authority: false,
    final_music_authority: false,
  };
  return { ...core, analysis_digest_sha256: digest(core) };
}

function verifyAnalysisDocument(doc) {
  if (doc?.schema !== SCHEMA) fail('DRAFT_MUSIC_ANALYSIS_INVALID', 'schema mismatch');
  const core = { ...doc }; delete core.analysis_digest_sha256;
  if (digest(core) !== doc.analysis_digest_sha256) fail('DRAFT_MUSIC_ANALYSIS_INVALID', 'digest mismatch');
  const errors = validateAnalysisDocument(doc);
  if (errors.length) fail('DRAFT_MUSIC_ANALYSIS_INVALID', errors.slice(0, 6).join('; '));
  if (doc.publication_authority !== false || doc.final_music_authority !== false) fail('DRAFT_MUSIC_AUTHORITY_ESCALATION', 'analysis must stay non-final');
  return true;
}

module.exports = {
  SCHEMA, TARGET_DURATION_S, MUSIC_FUNCTIONS, VECTOR_ENUMS, VECTOR_FIELDS,
  MAJOR_AXES, DIVERSITY_MIN_MAJOR_DIFF, NEW_ENUMS,
  DraftMusicAnalysisError, digest, canonicalize,
  majorAxisDifference, interpretationAxesFor, validateVector, validateAnalysisDocument,
  buildPrompt, analyzeScript, verifyAnalysisDocument,
};
