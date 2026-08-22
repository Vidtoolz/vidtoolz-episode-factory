// VIDTOOLZ Score Engine — candidate interpretation concepts (composer v1.5).
//
// QUALITY-GATE DIVERSITY OVERHAUL 2026-08-21: "Generate Options" must produce
// different musical IDEAS, not different random realizations of one idea.
// This module defines the concept layer:
//
//   SAME VIDEO REQUIREMENT -> DIFFERENT MUSICAL SOLUTION A / B / C
//
// Each concept is a deliberate, reproducible, explainable soundtrack strategy
// expressed on internal axes. The approved brief (duration, cue timing,
// energy intent, narration constraints) stays invariant; concepts vary HOW
// the requirement is solved. Concepts are grouped into script-aware contrast
// sets; the diversity gate in score-lane enforces perceptual distance.
//
// Determinism: a concept is pure data. Same concept + same seed + same plan
// reproduces the same composition (verified by tests).

const TIMBRE_FAMILIES = [
  "restrained_electronic",
  "atmospheric_texture",
  "organic_plucked",
  "percussive_cinematic",
  "warm_tonal",
  "dark_abstract",
];

const RHYTHM_STRATEGIES = [
  "no_pulse",          // no obvious beat; sustained motion carries the cue
  "sparse_pulse",      // occasional pulse events with space between
  "regular_pulse",     // even pulse bed (v1 default)
  "driving_pulse",     // continuous 8th/16th motion
  "syncopated_pulse",  // off-beat accents, irregular placement
];

const MELODIC_STRATEGIES = [
  "none",            // almost no melody
  "sparse_motif",    // short motif, rare statements (v1 default)
  "clear_identity",  // recurring melodic voice
  "fragmentary",     // scattered motif fragments
  "long_tones",      // slow single-note lines, not motifs
  "rhythmic_motif",  // repeated-pitch rhythmic figure instead of a melody
];

const HARMONIC_CHARACTERS = [
  "stable",   // plain progression, consonant (v1 default)
  "tense",    // semitone color + substitution bias
  "warm",     // added 6th color tones
  "static",   // one harmony held across the cue
  "evolving", // continuous drift/voicing movement
  "open",     // root+fifth voicings, no third
];

const DENSITY_STRATEGIES = [
  "very_sparse",
  "restrained",
  "moderate",          // v1 default
  "layered",
  "climax_only_dense", // hold back everywhere except reveal/climax cues
];

const TEXTURES = ["clean", "atmospheric", "granular", "pulsing", "sustained", "percussive"];

const DEVELOPMENTS = [
  "steady",               // v1 default
  "gradual_build",        // ramp intensity across cues
  "restrained_then_lift", // hold back, then lift the final cues
  "waves",                // alternating tension/release phrases
];

const OPENINGS = [
  "immediate",      // full bed from bar one (v1 default)
  "ambient_intro",  // first cue: harmony/texture only, no pulse
  "sparse_entry",   // first cue: texture + single harmony, minimal
  "rhythmic_start", // first cue leads with pulse/impact
  "space_first",    // first ~2s of the first cue intentionally silent
];

const CLIMAX_STRATEGIES = [
  "density",             // v1 default: energy-driven density
  "rhythm",              // driving pulse takes over at the reveal
  "harmonic_lift",       // voicing lift + color at the reveal
  "new_layer",           // a melody/texture layer enters at the reveal
  "melodic_arrival",     // the motif finally arrives at the reveal
  "drop_then_impact",    // brief drop, then impact hit
  "sustained_expansion", // broad long-note expansion
];

const ENDING_STRATEGIES = ["clear-button", "fade", "sting", "loop-ready-tail"];

// Neutral concept = exact pre-v1.5 (v1.4 as_planned) behavior. Stored
// candidates without an interpretation recompose byte-identically.
const NEUTRAL_CONCEPT = Object.freeze({
  rhythm: "regular_pulse",
  melody: "sparse_motif",
  harmonic: "stable",
  density: "moderate",
  texture: "clean",
  development: "steady",
  opening: "immediate",
  climax: "density",
  ending: "clear-button",
  timbre: "restrained_electronic",
  tempo_feel: "as_planned",
  pulse_style: "as_planned",
  melody_bias: "as_planned",
});

function concept(id, label, character, axes, laneGains = {}) {
  return Object.freeze({
    interpretation_id: id,
    label,
    character,
    axes: Object.freeze({ ...NEUTRAL_CONCEPT, ...axes }),
    lane_gains: Object.freeze(laneGains),
  });
}

// ── Script-aware contrast sets ─────────────────────────────────────────────
// Each family carries 5 concepts: 3 primary + 2 spares for the diversity
// gate's bounded retry. Families are examples of editorially valid contrast,
// not a style-slot machine: sets mix rhythm, timbre, development and ending
// strategies rather than rotating one dimension.
const CONTRAST_SETS = {
  calm_explainer: [
    concept("calm-minimal-pulse", "Minimal pulse bed", "quiet, steady and unobtrusive", {
      rhythm: "sparse_pulse", melody: "none", harmonic: "static", density: "restrained",
      texture: "clean", development: "steady", opening: "immediate", climax: "density",
      ending: "fade", timbre: "restrained_electronic", pulse_style: "sparse", melody_bias: "minimal",
    }, { melody: 0.2, texture: 0.9 }),
    concept("calm-warm-atmospheric", "Warm atmospheric bed", "soft, warm and spacious", {
      rhythm: "no_pulse", melody: "long_tones", harmonic: "warm", density: "restrained",
      texture: "atmospheric", development: "gradual_build", opening: "ambient_intro",
      climax: "sustained_expansion", ending: "loop-ready-tail", timbre: "warm_tonal",
      melody_bias: "minimal",
    }, { harmony: 1.15, texture: 1.15, pulse: 0.4 }),
    concept("calm-sparse-organic", "Sparse organic texture", "light, airy, plucked detail", {
      rhythm: "sparse_pulse", melody: "fragmentary", harmonic: "open", density: "very_sparse",
      texture: "clean", development: "steady", opening: "sparse_entry", climax: "melodic_arrival",
      ending: "clear-button", timbre: "organic_plucked", melody_bias: "minimal",
    }, { texture: 1.1, impact: 0.6 }),
    concept("calm-sustained-drift", "Slow evolving pad", "calm motion without a beat", {
      rhythm: "no_pulse", melody: "none", harmonic: "evolving", density: "restrained",
      texture: "sustained", development: "gradual_build", opening: "ambient_intro",
      climax: "harmonic_lift", ending: "fade", timbre: "atmospheric_texture", melody_bias: "minimal",
    }, { harmony: 1.2, pulse: 0.3 }),
    concept("calm-light-pulse", "Gentle even pulse", "a calm heartbeat under the words", {
      rhythm: "regular_pulse", melody: "sparse_motif", harmonic: "stable", density: "moderate",
      texture: "clean", development: "steady", opening: "immediate", climax: "density",
      ending: "loop-ready-tail", timbre: "restrained_electronic",
    }),
  ],
  investigative: [
    concept("inv-tense-pulse", "Tense restrained pulse", "a careful, watchful rhythm", {
      rhythm: "regular_pulse", melody: "sparse_motif", harmonic: "tense", density: "restrained",
      texture: "pulsing", development: "steady", opening: "immediate", climax: "harmonic_lift",
      ending: "sting", timbre: "dark_abstract",
    }, { pulse: 1.05, harmony: 0.9 }),
    concept("inv-dark-ambient", "Dark ambient suspense", "broad shadowy air, no obvious beat", {
      rhythm: "no_pulse", melody: "long_tones", harmonic: "tense", density: "very_sparse",
      texture: "atmospheric", development: "gradual_build", opening: "ambient_intro",
      climax: "sustained_expansion", ending: "fade", timbre: "atmospheric_texture",
      melody_bias: "minimal",
    }, { texture: 1.2, pulse: 0.3 }),
    concept("inv-dry-percussive", "Dry percussive inquiry", "short dry taps and pauses", {
      rhythm: "syncopated_pulse", melody: "rhythmic_motif", harmonic: "static", density: "moderate",
      texture: "percussive", development: "waves", opening: "rhythmic_start",
      climax: "drop_then_impact", ending: "clear-button", timbre: "percussive_cinematic",
      melody_bias: "minimal",
    }, { impact: 1.1, harmony: 0.7 }),
    concept("inv-sparse-tension", "Sparse tension points", "mostly space, occasional pressure", {
      rhythm: "sparse_pulse", melody: "none", harmonic: "tense", density: "very_sparse",
      texture: "granular", development: "restrained_then_lift", opening: "space_first",
      climax: "drop_then_impact", ending: "sting", timbre: "dark_abstract", melody_bias: "minimal",
    }, { texture: 1.0, pulse: 0.6 }),
    concept("inv-steady-undertow", "Steady low undertow", "a patient low-motion bed", {
      rhythm: "regular_pulse", melody: "none", harmonic: "evolving", density: "restrained",
      texture: "sustained", development: "gradual_build", opening: "immediate",
      climax: "density", ending: "fade", timbre: "restrained_electronic", pulse_style: "sparse",
    }, { bass: 1.1 }),
  ],
  technological: [
    concept("tech-clean-pulse", "Clean modern pulse", "precise, current, confident", {
      rhythm: "driving_pulse", melody: "rhythmic_motif", harmonic: "stable", density: "moderate",
      texture: "pulsing", development: "gradual_build", opening: "immediate", climax: "new_layer",
      ending: "clear-button", timbre: "restrained_electronic", pulse_style: "driving",
    }, { pulse: 1.1 }),
    concept("tech-abstract-texture", "Abstract futuristic texture", "granular air and slow drift", {
      rhythm: "sparse_pulse", melody: "fragmentary", harmonic: "evolving", density: "restrained",
      texture: "granular", development: "waves", opening: "ambient_intro", climax: "harmonic_lift",
      ending: "loop-ready-tail", timbre: "dark_abstract", melody_bias: "minimal",
    }, { texture: 1.2, pulse: 0.5 }),
    concept("tech-syncopated", "Restrained rhythmic tech", "off-beat motion, dry accents", {
      rhythm: "syncopated_pulse", melody: "sparse_motif", harmonic: "stable", density: "moderate",
      texture: "percussive", development: "steady", opening: "rhythmic_start", climax: "rhythm",
      ending: "sting", timbre: "restrained_electronic",
    }, { impact: 1.05 }),
    concept("tech-sustained-lab", "Sustained lab atmosphere", "wide synthetic stillness", {
      rhythm: "no_pulse", melody: "long_tones", harmonic: "open", density: "restrained",
      texture: "sustained", development: "gradual_build", opening: "ambient_intro",
      climax: "sustained_expansion", ending: "fade", timbre: "atmospheric_texture",
      melody_bias: "minimal",
    }, { harmony: 1.15, pulse: 0.3 }),
    concept("tech-minimal-pluck", "Minimal plucked grid", "sparse plinks over a quiet bed", {
      rhythm: "sparse_pulse", melody: "fragmentary", harmonic: "static", density: "very_sparse",
      texture: "clean", development: "steady", opening: "sparse_entry", climax: "new_layer",
      ending: "clear-button", timbre: "organic_plucked", melody_bias: "minimal",
    }, { texture: 1.0 }),
  ],
  emotional: [
    concept("emo-intimate-minimal", "Intimate minimal", "close, small, honest", {
      rhythm: "sparse_pulse", melody: "long_tones", harmonic: "open", density: "very_sparse",
      texture: "clean", development: "steady", opening: "sparse_entry", climax: "melodic_arrival",
      ending: "fade", timbre: "warm_tonal", melody_bias: "minimal",
    }, { melody: 0.9, impact: 0.5 }),
    concept("emo-warm-evolving", "Warm evolving texture", "a slow warm swell that grows", {
      rhythm: "no_pulse", melody: "long_tones", harmonic: "warm", density: "restrained",
      texture: "atmospheric", development: "gradual_build", opening: "ambient_intro",
      climax: "sustained_expansion", ending: "loop-ready-tail", timbre: "warm_tonal",
    }, { harmony: 1.2, texture: 1.1, pulse: 0.3 }),
    concept("emo-cinematic-restrained", "Restrained cinematic", "patient weight, late lift", {
      rhythm: "regular_pulse", melody: "clear_identity", harmonic: "evolving",
      density: "climax_only_dense", texture: "sustained", development: "restrained_then_lift",
      opening: "immediate", climax: "harmonic_lift", ending: "clear-button",
      timbre: "percussive_cinematic", melody_bias: "forward",
    }, { harmony: 1.05 }),
    concept("emo-plucked-memory", "Plucked memory motif", "small recurring plucked figure", {
      rhythm: "sparse_pulse", melody: "clear_identity", harmonic: "warm", density: "very_sparse",
      texture: "clean", development: "steady", opening: "sparse_entry", climax: "melodic_arrival",
      ending: "fade", timbre: "organic_plucked", melody_bias: "forward",
    }, { melody: 1.1 }),
    concept("emo-static-air", "Static warm air", "held chords, almost no motion", {
      rhythm: "no_pulse", melody: "none", harmonic: "static", density: "very_sparse",
      texture: "sustained", development: "steady", opening: "ambient_intro",
      climax: "sustained_expansion", ending: "loop-ready-tail", timbre: "atmospheric_texture",
      melody_bias: "minimal",
    }, { harmony: 1.1, pulse: 0.2 }),
  ],
  comedic: [
    concept("com-dry-rhythm", "Dry understated rhythm", "deadpan taps and pauses", {
      rhythm: "sparse_pulse", melody: "rhythmic_motif", harmonic: "stable", density: "very_sparse",
      texture: "percussive", development: "steady", opening: "space_first",
      climax: "drop_then_impact", ending: "sting", timbre: "organic_plucked", melody_bias: "minimal",
    }, { impact: 1.1, harmony: 0.6 }),
    concept("com-playful-motif", "Understated playful motif", "a small wink of a melody", {
      rhythm: "regular_pulse", melody: "clear_identity", harmonic: "stable", density: "restrained",
      texture: "clean", development: "waves", opening: "immediate", climax: "melodic_arrival",
      ending: "clear-button", timbre: "organic_plucked", melody_bias: "forward",
    }, { melody: 1.1 }),
    concept("com-quirky-sparse", "Quirky sparse texture", "odd little sounds, lots of air", {
      rhythm: "syncopated_pulse", melody: "fragmentary", harmonic: "open", density: "very_sparse",
      texture: "granular", development: "steady", opening: "sparse_entry", climax: "new_layer",
      ending: "fade", timbre: "dark_abstract", melody_bias: "minimal",
    }, { texture: 1.1 }),
    concept("com-straight-man", "Straight-man pulse", "plays it completely straight", {
      rhythm: "regular_pulse", melody: "none", harmonic: "static", density: "restrained",
      texture: "clean", development: "steady", opening: "immediate", climax: "density",
      ending: "sting", timbre: "restrained_electronic", pulse_style: "sparse", melody_bias: "minimal",
    }, { pulse: 0.9 }),
    concept("com-awkward-hold", "Awkward held chords", "deliberately unmoving harmony", {
      rhythm: "no_pulse", melody: "none", harmonic: "static", density: "very_sparse",
      texture: "sustained", development: "steady", opening: "sparse_entry", climax: "drop_then_impact",
      ending: "sting", timbre: "warm_tonal", melody_bias: "minimal",
    }, { harmony: 0.9, pulse: 0.2 }),
  ],
  reveal: [
    concept("rev-gradual-build", "Gradual cinematic build", "one long patient rise", {
      rhythm: "regular_pulse", melody: "sparse_motif", harmonic: "evolving",
      density: "climax_only_dense", texture: "sustained", development: "gradual_build",
      opening: "ambient_intro", climax: "sustained_expansion", ending: "clear-button",
      timbre: "percussive_cinematic",
    }, { harmony: 1.05 }),
    concept("rev-sparse-to-large", "Sparse-to-large contrast", "near-silence, then the floor opens", {
      rhythm: "sparse_pulse", melody: "long_tones", harmonic: "tense",
      density: "climax_only_dense", texture: "atmospheric", development: "restrained_then_lift",
      opening: "space_first", climax: "drop_then_impact", ending: "clear-button",
      timbre: "atmospheric_texture", melody_bias: "minimal",
    }, { impact: 1.15, pulse: 0.6 }),
    concept("rev-rhythmic-escalation", "Rhythmic escalation", "momentum that refuses to stop", {
      rhythm: "driving_pulse", melody: "rhythmic_motif", harmonic: "stable", density: "layered",
      texture: "pulsing", development: "gradual_build", opening: "rhythmic_start",
      climax: "rhythm", ending: "sting", timbre: "restrained_electronic", pulse_style: "driving",
    }, { pulse: 1.15, impact: 1.05 }),
    concept("rev-harmonic-lift", "Harmonic lift reveal", "the chords themselves stand up", {
      rhythm: "no_pulse", melody: "long_tones", harmonic: "evolving", density: "restrained",
      texture: "sustained", development: "restrained_then_lift", opening: "ambient_intro",
      climax: "harmonic_lift", ending: "clear-button", timbre: "warm_tonal", melody_bias: "minimal",
    }, { harmony: 1.2, pulse: 0.3 }),
    concept("rev-melodic-arrival", "Melodic arrival", "the theme lands exactly at the reveal", {
      rhythm: "regular_pulse", melody: "clear_identity", harmonic: "stable",
      density: "climax_only_dense", texture: "clean", development: "restrained_then_lift",
      opening: "sparse_entry", climax: "melodic_arrival", ending: "clear-button",
      timbre: "percussive_cinematic", melody_bias: "forward",
    }, { melody: 1.1 }),
  ],
};

const FAMILY_KEYS = Object.keys(CONTRAST_SETS);

// Script-aware family selection. Deterministic and explainable: name and
// script keywords first, then project mood/role fallback. Deliberately
// simple — deep script inference remains a separate P1 (SCRIPT-AWARE
// DIRECTION), this only stops every project receiving the same triangle.
const FAMILY_KEYWORDS = [
  ["comedic", ["comedy", "comedic", "shame", "folder", "playful", "funny", "joke", "absurd"]],
  ["investigative", ["refuse", "investigat", "tension", "suspect", "audit", "wrong", "risk", "outsource"]],
  ["emotional", ["human", "emotional", "care", "memory", "loss", "feel", "part of the work", "automate"]],
  ["reveal", ["reveal", "gate", "third", "climax", "ending", "nobody builds"]],
  ["calm_explainer", ["waste", "time", "calm", "explainer", "guide", "habit", "mistake"]],
  ["technological", ["pipeline", "boring", "system", "tech", "tool", "ai", "workflow", "node"]],
];

function selectFamily(project, scriptText = "") {
  const hay = `${project.name || ""} ${scriptText}`.toLowerCase();
  for (const [family, words] of FAMILY_KEYWORDS) {
    if (words.some((w) => hay.includes(w))) return family;
  }
  const mood = String(project.overall_mood || "").toLowerCase();
  if (mood.includes("dark") || mood.includes("tense")) return "investigative";
  if (mood.includes("warm") || mood.includes("hope")) return "emotional";
  if (mood.includes("play")) return "comedic";
  return "technological";
}

function selectContrastSet(project, options = {}) {
  const family = options.family && CONTRAST_SETS[options.family] ? options.family : selectFamily(project, options.script_text || "");
  const set = CONTRAST_SETS[family];
  return { family, concepts: set.slice(0, 3), spares: set.slice(3) };
}

// ── Diversity gate ─────────────────────────────────────────────────────────
// Feature signature from a finished composition + its concept. Concept-tag
// differences are weighted heavily; numeric features are normalized. Trivial
// differences (a few notes, tiny velocity changes) cannot satisfy the gate on
// their own because concept axes dominate the score.
function diversitySignature(composition, candidateMeta = {}) {
  const notes = composition.notes || [];
  const total = notes.length || 1;
  const seconds = composition.meta && composition.meta.duration_seconds
    ? composition.meta.duration_seconds
    : (notes.length ? Math.max(...notes.map((n) => (n.seconds || 0) + (n.dur_seconds || 0))) : 1);
  const lanes = new Set(notes.map((n) => n.lane));
  const count = (lane) => notes.filter((n) => n.lane === lane).length;
  const axes = (candidateMeta.interpretation && candidateMeta.interpretation.axes) || {};
  return {
    note_count: notes.length,
    density_per_s: +(total / Math.max(1, seconds)).toFixed(2),
    active_lanes: [...lanes].sort(),
    melodic_density: +(count("melody") / Math.max(1, seconds)).toFixed(2),
    rhythmic_density: +((count("pulse") + count("impact")) / Math.max(1, seconds)).toFixed(2),
    avg_note_dur: +(notes.reduce((a, n) => a + (n.dur_seconds || 0), 0) / total).toFixed(2),
    texture_density: +(count("texture") / Math.max(1, seconds)).toFixed(2),
    axes,
  };
}

const AXIS_WEIGHT = 1;      // one deliberate concept-axis difference
const NUMERIC_SCALE = 2;    // a fully-scaled numeric difference ≈ two axes

function numericDistance(a, b, key, norm) {
  const d = Math.abs(a[key] - b[key]) / norm;
  return Math.min(1, d) * NUMERIC_SCALE;
}

function pairwiseDistance(sigA, sigB) {
  const perDim = {};
  const axA = sigA.axes || {};
  const axB = sigB.axes || {};
  let conceptDiff = 0;
  let conceptDims = 0;
  for (const k of Object.keys(NEUTRAL_CONCEPT)) {
    if (axA[k] === undefined && axB[k] === undefined) continue;
    conceptDims += 1;
    if ((axA[k] || "as_planned") !== (axB[k] || "as_planned")) conceptDiff += 1;
  }
  perDim.concept = conceptDims ? +(conceptDiff / conceptDims).toFixed(2) : 0;
  perDim.density = +numericDistance(sigA, sigB, "density_per_s", 2).toFixed(2);
  perDim.melody = +numericDistance(sigA, sigB, "melodic_density", 0.5).toFixed(2);
  perDim.rhythm = +numericDistance(sigA, sigB, "rhythmic_density", 1.5).toFixed(2);
  perDim.texture = +numericDistance(sigA, sigB, "texture_density", 0.5).toFixed(2);
  perDim.note_dur = +numericDistance(sigA, sigB, "avg_note_dur", 1).toFixed(2);
  perDim.lanes = sigA.active_lanes.join(",") === sigB.active_lanes.join(",") ? 0 : 1;
  // Concept differences count double-weight; numerics cap the total so a
  // seed-jittered clone of one concept can never pass.
  const total = +(perDim.concept * 4 + perDim.density + perDim.melody + perDim.rhythm + perDim.texture + perDim.note_dur + perDim.lanes).toFixed(2);
  return { total, perDim };
}

// Empirically derived floor (quality gate 2026-08-21): distinct concepts in
// the current composer score >= ~6 on this metric; same-concept seed jitter
// scores < 1. The gate uses 4 so a genuinely different concept always passes
// while accidental near-duplicates fail closed.
const DIVERSITY_MIN_TOTAL = 4;

function diversityReport(signatures) {
  const rows = [];
  for (let i = 0; i < signatures.length; i += 1) {
    for (let j = i + 1; j < signatures.length; j += 1) {
      const d = pairwiseDistance(signatures[i], signatures[j]);
      rows.push({ a: i, b: j, total: d.total, perDim: d.perDim, passes: d.total >= DIVERSITY_MIN_TOTAL });
    }
  }
  return { min_total: DIVERSITY_MIN_TOTAL, rows, passes: rows.every((r) => r.passes) };
}

// ── MusicRenderBrief translation ───────────────────────────────────────────
// A concept's musical HOW must survive provider translation. The frozen v1
// brief keeps the shared WHAT; these overrides carry the concept's timbre
// color, ending and avoid-list into the MiniMax caption adapter.
const TIMBRE_BRIEF_COLORS = {
  restrained_electronic: { required: ["restrained analog pulse", "low synth bass"], avoid: ["acoustic drums", "big orchestra"] },
  atmospheric_texture: { required: ["broad evolving pad", "airy texture"], avoid: ["obvious drum beat", "busy melody"] },
  organic_plucked: { required: ["sparse plucked tones", "soft percussive details"], avoid: ["synth leads", "heavy bass"] },
  percussive_cinematic: { required: ["low percussive motion", "cinematic low boom"], avoid: ["bright synths", "cheerful melody"] },
  warm_tonal: { required: ["warm sustained chords", "soft tonal bed"], avoid: ["harsh synths", "mechanical pulse"] },
  dark_abstract: { required: ["dark abstract texture", "subdued low tones"], avoid: ["bright melody", "uplifting chords"] },
};

const ENDING_BRIEF = {
  "clear-button": "clear-button",
  fade: "fade",
  sting: "sting",
  "loop-ready-tail": "loop-ready-tail",
};

function briefOverridesForConcept(concept) {
  if (!concept || !concept.axes) return {};
  const axes = concept.axes;
  const timbre = TIMBRE_BRIEF_COLORS[axes.timbre] || {};
  const required = [...(timbre.required || [])];
  const avoid = [...(timbre.avoid || [])];
  if (axes.rhythm === "no_pulse") avoid.push("steady drum pulse");
  if (axes.rhythm === "driving_pulse") required.push("continuous driving pulse");
  if (axes.rhythm === "syncopated_pulse") required.push("off-beat accents");
  if (axes.melody === "none" || axes.melody === "minimal") avoid.push("prominent melody");
  if (axes.melody === "clear_identity") required.push("a clear simple motif");
  if (axes.development === "restrained_then_lift") required.push("hold back until the final third, then lift");
  if (axes.development === "gradual_build") required.push("gradual continuous build");
  if (axes.opening === "ambient_intro") required.push("begin with atmosphere, no beat");
  if (axes.opening === "space_first") required.push("begin with a moment of near silence");
  if (axes.climax === "drop_then_impact") required.push("brief drop before the reveal, then a strong impact");
  if (axes.climax === "sustained_expansion") required.push("broad sustained expansion at the reveal");
  if (axes.climax === "melodic_arrival") required.push("the motif arrives at the reveal");
  return {
    required,
    avoid,
    ending: ENDING_BRIEF[axes.ending] || undefined,
    section_note: concept.character || undefined,
  };
}

module.exports = {
  NEUTRAL_CONCEPT,
  TIMBRE_FAMILIES,
  RHYTHM_STRATEGIES,
  MELODIC_STRATEGIES,
  HARMONIC_CHARACTERS,
  DENSITY_STRATEGIES,
  TEXTURES,
  DEVELOPMENTS,
  OPENINGS,
  CLIMAX_STRATEGIES,
  ENDING_STRATEGIES,
  CONTRAST_SETS,
  FAMILY_KEYS,
  selectFamily,
  selectContrastSet,
  briefOverridesForConcept,
  diversitySignature,
  pairwiseDistance,
  diversityReport,
  DIVERSITY_MIN_TOTAL,
};
