// VIDTOOLZ Score Engine — deterministic seeded composition engine.
// Turns an approved cue sheet + palette + seed into concrete note events per
// lane (pulse, bass, harmony, texture, melody, impact). Same input + same seed
// always produces the same notes. No AI writes raw MIDI here (§5B).
"use strict";

const { PPQ } = require("./midi-writer.js");
const { parseSupportedKey, SUPPORTED_TIME_SIGNATURES } = require("./score-schemas.js");

// Persisted provenance binds candidates to this explicit algorithm contract.
// Any material change to note generation or its defaults must bump the version.
const COMPOSER_CONTRACT = Object.freeze({
  schema_version: 1,
  algorithm_version: "scorecraft-deterministic-composer-v1.5",
  ppq: PPQ,
  default_pulse_register: "low_mid",
  default_harmonic_drift: false,
  default_harmonic_drift_threshold_seconds: 35,
  lanes: ["pulse", "bass", "harmony", "texture", "melody", "impact"],
  supported_time_signatures: SUPPORTED_TIME_SIGNATURES,
});

// ── seeded PRNG (mulberry32) ──
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let h = 2166136261 >>> 0;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ── musical primitives ──
const PITCH_CLASSES = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

function parseKey(keyText) {
  const parsed = parseSupportedKey(keyText);
  if (!parsed) throw new Error(`Unsupported musical key: ${JSON.stringify(keyText)}. Correct the cue before composing.`);
  return { tonic: PITCH_CLASSES[parsed.tonic], mode: parsed.mode, intervals: MODES[parsed.mode], label: parsed.label };
}

// Scale degree (0-based, any octave offset) to MIDI note around a center.
function degreeToMidi(key, degree, octaveBase) {
  const oct = Math.floor(degree / 7);
  const step = ((degree % 7) + 7) % 7;
  return octaveBase * 12 + key.tonic + key.intervals[step] + oct * 12;
}

// Chord degree pools per emotion — roman-numeral degrees (0-based) within the mode.
const PROGRESSION_POOLS = {
  curious: [[0, 5, 3, 6], [0, 2, 5, 4], [0, 3, 5, 4]],
  tense: [[0, 1, 0, 1], [0, 5, 1, 0], [0, 1, 5, 0]],
  warm: [[0, 3, 4, 0], [0, 5, 3, 4], [0, 3, 0, 4]],
  clinical: [[0, 0, 3, 3], [0, 4, 0, 4]],
  playful: [[0, 4, 5, 3], [0, 2, 4, 0]],
  dark: [[0, 5, 2, 3], [0, 2, 0, 5]],
  optimistic: [[0, 4, 5, 4], [0, 3, 0, 4]],
  urgent: [[0, 6, 0, 6], [0, 2, 1, 0]],
};

function chordPitches(key, degree, octaveBase) {
  // Triad by stacking scale thirds; light voice-leading handled by caller.
  return [degreeToMidi(key, degree, octaveBase), degreeToMidi(key, degree + 2, octaveBase), degreeToMidi(key, degree + 4, octaveBase)];
}

// Move each voice to the nearest chord tone of the next chord (simple voice-leading).
function voiceLead(previousVoicing, targetPitches) {
  if (!previousVoicing) return targetPitches;
  return previousVoicing.map((prev, i) => {
    const target = targetPitches[i % targetPitches.length];
    let best = target;
    for (const shift of [-12, 0, 12]) {
      if (Math.abs(target + shift - prev) < Math.abs(best - prev)) best = target + shift;
    }
    return best;
  });
}

const noteEvent = (lane, seconds, durSeconds, tick, durTicks, note, velocity) => ({
  // Preserve authoritative fractional cue boundaries. Millisecond rounding can
  // move a clipped note past a legal sub-millisecond cue end.
  lane, seconds, dur_seconds: durSeconds, tick: Math.round(tick), dur_ticks: Math.max(1, Math.round(durTicks)), note, velocity,
});

// Effective per-cue constraints once dialogue-safe rules apply (§12, §13).
function effectiveCueSettings(cue, options = {}) {
  const dialogueSafe = Boolean(cue.dialogue_safe) || options.dialogue_density === "high";
  let density = Math.max(1, Math.min(5, cue.density));
  let energy = Math.max(1, Math.min(5, cue.energy));
  if (dialogueSafe) density = Math.min(density, 2);
  const velocityCeiling = dialogueSafe ? 72 : 108;
  const allowMelody = !dialogueSafe && ["hook", "reveal", "outro", "climax"].includes(cue.function) && density >= 2;
  return { dialogueSafe, density, energy, velocityCeiling, allowMelody };
}

// ── per-lane generators (all deterministic from rng) ──

// Pulse register options (validation defect #3): 'low_mid' is the original
// D3-A3 placement; 'mid_high' (default for dialogue-heavy projects) lifts the
// pulse an octave so it clears male-narration fundamentals; 'high' goes above.
const PULSE_REGISTER_BASES = { low_mid: 4, mid_high: 5, high: 6 };

// Candidate interpretation axes (quality gate 2026-08-21, QG-LIVE-1): before
// this, every candidate shared one palette/key/tempo/cue-sheet and seeds only
// jittered ornamentation, so "Generate Options" produced one arrangement
// repeated. These axes give each candidate an audible arrangement character
// WITHOUT touching the approved cue sheet (structure/timing/energy stay the
// plan's) and are recorded per candidate so recomposition stays
// byte-identical. Defaults reproduce pre-v1.2 output exactly.
const TEMPO_FEELS = { as_planned: 1, lifted: 1.08, relaxed: 0.92 };
const PULSE_STYLES = ["as_planned", "driving", "sparse"];
const MELODY_BIASES = ["as_planned", "forward", "minimal"];

function composePulse(ctx) {
  const { cue, eff, rng, grid, out } = ctx;
  if (ctx.rhythmStrategy === "no_pulse") return;
  if (ctx.isFirstCue && (ctx.openingStrategy === "ambient_intro" || ctx.openingStrategy === "sparse_entry")) return;
  let stepBeats;
  let restBias;
  if (!ctx.hasInterpretation) {
    // v1.4 exact rules (incl. dialogue-safe gating) for stored candidates.
    stepBeats = eff.dialogueSafe || eff.density <= 2 ? 0.5 : eff.density >= 4 ? 0.25 : 0.5;
    restBias = 0;
    if (!eff.dialogueSafe && ctx.pulseStyle === "driving") { stepBeats = 0.25; restBias = -0.1; }
    if (ctx.pulseStyle === "sparse") { stepBeats = 1; restBias = 0.15; }
  } else {
    stepBeats = eff.dialogueSafe || eff.density <= 2 ? 0.5 : eff.density >= 4 ? 0.25 : 0.5;
    restBias = 0;
    if (ctx.rhythmStrategy === "driving_pulse") { stepBeats = 0.25; restBias = -0.1; }
    if (ctx.rhythmStrategy === "sparse_pulse") { stepBeats = 1; restBias = 0.15; }
    if (ctx.rhythmStrategy === "syncopated_pulse") { stepBeats = 0.5; restBias = 0.05; }
    if (ctx.densityStrategy === "very_sparse") restBias += 0.15;
    if (ctx.densityStrategy === "climax_only_dense" && !ctx.isClimaxCue) restBias += 0.2;
  }
  const gate = 0.55 + rng() * 0.15;
  const baseVel = Math.min(eff.velocityCeiling, 42 + eff.energy * 9);
  const restProbability = Math.min(0.6, Math.max(0.02, (eff.dialogueSafe ? 0.3 : Math.max(0.02, 0.28 - eff.density * 0.05)) + restBias));
  const registerBase = PULSE_REGISTER_BASES[ctx.pulseRegister] || PULSE_REGISTER_BASES.low_mid;
  const pitchRoot = degreeToMidi(ctx.key, 0, registerBase);
  const pitchAlt = degreeToMidi(ctx.key, 4, registerBase);
  const syncopated = ctx.rhythmStrategy === "syncopated_pulse";
  const spaceBeat = ctx.spaceSeconds ? grid.secondsToBeat(ctx.spaceSeconds) || 0 : 0;
  for (let beat = 0; beat + stepBeats <= grid.beats + 1e-9; beat += stepBeats) {
    if (rng() < restProbability) continue;
    const placed = syncopated ? beat + 0.25 : beat;
    if (placed < spaceBeat) continue;
    if (ctx.waves && Math.floor(placed / 8) % 2 === 1 && rng() < 0.5) continue;
    const accent = Math.abs(placed % 1) < 1e-9 ? 6 : Math.abs(placed % 0.5) < 1e-9 ? 0 : -6;
    const note = rng() < 0.82 ? pitchRoot : pitchAlt;
    out.push(grid.event("pulse", placed, stepBeats * gate, note, baseVel + accent + Math.round(rng() * 6 - 3)));
  }
}

function composeBass(ctx) {
  const { eff, rng, grid, out, chords } = ctx;
  const baseVel = Math.min(eff.velocityCeiling, 40 + eff.energy * 8);
  if (ctx.isFirstCue && ctx.openingStrategy === "ambient_intro") return;
  if (ctx.isFirstCue && ctx.openingStrategy === "sparse_entry") {
    out.push(grid.event("bass", 0, grid.beats * 0.96, degreeToMidi(ctx.key, chords[0].degree, 2), baseVel - 6));
    return;
  }
  const sparseHold = eff.dialogueSafe || eff.density <= 2
    || ctx.densityStrategy === "very_sparse" || ctx.harmonicChar === "static"
    || (ctx.densityStrategy === "climax_only_dense" && !ctx.isClimaxCue);
  for (const bar of grid.bars) {
    const chord = chords[bar.index % chords.length];
    const root = degreeToMidi(ctx.key, chord.degree, 2); // low register
    if (sparseHold) {
      out.push(grid.event("bass", bar.startBeat, bar.beats * 0.96, root, baseVel - 6));
    } else {
      out.push(grid.event("bass", bar.startBeat, bar.beats / 2 * 0.9, root, baseVel));
      const second = rng() < 0.5 ? root : root + 7; // fifth
      out.push(grid.event("bass", bar.startBeat + bar.beats / 2, bar.beats / 2 * 0.9, second, baseVel - 8));
      if (eff.energy >= 4 && rng() < 0.5) {
        out.push(grid.event("bass", bar.startBeat + bar.beats - 0.5, 0.4, root + 12, baseVel - 14));
      }
    }
  }
}

// Harmonic drift (validation defect #4): long static cues get subtle, seeded
// per-phrase movement — a mediant chord substitution, an occasional octave
// voicing lift, and a soft sustained color tone at phrase starts. Off unless
// the compose caller enables it AND the cue exceeds the threshold; short cues
// keep the plain progression. Dialogue-safe velocities are respected.
const DRIFT_PHRASE_BARS = 8;

function composeHarmony(ctx) {
  const { eff, rng, grid, out, chords } = ctx;
  const baseVel = Math.min(eff.velocityCeiling - 8, 34 + eff.energy * 6);
  const driftActive = ctx.driftActive || ctx.harmonicChar === "evolving";
  const variants = [];
  if (driftActive) {
    const phraseCount = Math.ceil(grid.bars.length / DRIFT_PHRASE_BARS);
    for (let p = 0; p < phraseCount; p += 1) {
      variants.push(p === 0
        ? { substitute: false, lift: 0, colorTone: false }
        : { substitute: rng() < 0.5, lift: rng() < 0.4 ? 12 : 0, colorTone: rng() < 0.6 });
    }
  }
  const staticVoicing = ctx.harmonicChar === "static";
  let voicing = null;
  for (const bar of grid.bars) {
    const chord = chords[bar.index % chords.length];
    let degree = chord.degree;
    let lift = 0;
    const variant = driftActive ? variants[Math.floor(bar.index / DRIFT_PHRASE_BARS)] : null;
    if (variant) {
      if (variant.substitute) degree = (degree + 3) % 7; // gentle mediant shift for the phrase
      lift = variant.lift;
      if (variant.colorTone && bar.index % DRIFT_PHRASE_BARS === 0 && bar.index > 0) {
        // Soft sustained 9th above the root — a drift event, not a melody.
        out.push(grid.event("harmony", bar.startBeat, bar.beats * 1.9, degreeToMidi(ctx.key, degree + 8, 4) + lift, Math.max(20, baseVel - 12)));
      }
    }
    if (staticVoicing && voicing) {
      for (const pitch of voicing) {
        out.push(grid.event("harmony", bar.startBeat, bar.beats * 0.98, pitch, baseVel));
      }
      continue;
    }
    let pitches;
    if (ctx.harmonicChar === "open") {
      pitches = [degreeToMidi(ctx.key, degree, 4), degreeToMidi(ctx.key, degree + 4, 4), degreeToMidi(ctx.key, degree, 5)];
    } else {
      pitches = chordPitches(ctx.key, degree, 4).map((p) => p + lift);
    }
    if (ctx.harmonicChar === "tense") pitches = pitches.map((p, i) => (i === pitches.length - 1 ? p + 1 : p));
    voicing = voiceLead(voicing, pitches);
    if (ctx.harmonicChar === "warm" && bar.index % 4 === 0) {
      out.push(grid.event("harmony", bar.startBeat, bar.beats * 1.9, degreeToMidi(ctx.key, degree + 5, 4), Math.max(20, baseVel - 10)));
    }
    for (const pitch of voicing) {
      out.push(grid.event("harmony", bar.startBeat, bar.beats * 0.98, pitch, baseVel));
    }
  }
}

function composeTexture(ctx) {
  const { eff, rng, grid, out } = ctx;
  let probability = (eff.dialogueSafe ? 0.05 : 0.1) + eff.density * 0.02;
  if (ctx.textureKind === "atmospheric") probability *= 1.6;
  if (ctx.textureKind === "granular") probability *= 1.3;
  if (ctx.densityStrategy === "climax_only_dense" && !ctx.isClimaxCue) probability *= 0.4;
  const baseVel = Math.min(56, 22 + eff.energy * 5);
  if (ctx.textureKind === "sustained") {
    for (const bar of grid.bars) {
      if (rng() >= probability * 2) continue;
      const degree = [7, 9, 11, 14][Math.floor(rng() * 4)];
      out.push(grid.event("texture", bar.startBeat, bar.beats * 0.98, degreeToMidi(ctx.key, degree, 4), baseVel));
    }
    return;
  }
  const spaceBeat = ctx.spaceSeconds ? grid.secondsToBeat(ctx.spaceSeconds) || 0 : 0;
  for (let beat = 0; beat + 0.5 <= grid.beats + 1e-9; beat += 1) {
    if (rng() >= probability) continue;
    const degree = [7, 9, 11, 14][Math.floor(rng() * 4)];
    // RNG order matters: v1.4 consumed placement BEFORE duration; the neutral
    // path must keep that order for byte-identical recomposition.
    const placed = beat + (rng() < 0.5 ? 0 : 0.5);
    let dur = 0.5 + rng();
    if (ctx.textureKind === "atmospheric") dur = 1.5 + rng() * 2;
    if (ctx.textureKind === "granular" || ctx.textureKind === "percussive") dur = 0.2 + rng() * 0.3;
    if (placed < spaceBeat) continue;
    out.push(grid.event("texture", placed, dur, degreeToMidi(ctx.key, degree, 4), baseVel));
  }
}

// v1.4 motif emitter, extracted so v1.5 melodic strategies can reuse it with
// a different statement cadence. RNG order is identical to v1.4.
function emitMotif(ctx, everyBars) {
  const { eff, rng, grid, out } = ctx;
  // Short seeded motif (3-5 notes), stated once per `everyBars` bars, never busy (§12.5).
  const motifLength = 3 + Math.floor(rng() * 3);
  const degrees = [];
  let degree = [0, 2, 4][Math.floor(rng() * 3)] + 7;
  for (let i = 0; i < motifLength; i += 1) {
    degrees.push(degree);
    degree += [-2, -1, 1, 2][Math.floor(rng() * 4)];
  }
  const baseVel = Math.min(eff.velocityCeiling - 4, 48 + eff.energy * 7);
  for (let bar = 0; bar < grid.bars.length; bar += everyBars) {
    const startBeat = grid.bars[bar].startBeat + (rng() < 0.5 ? 0 : 2);
    degrees.forEach((d, i) => {
      const beat = startBeat + i * (rng() < 0.3 ? 1 : 0.5);
      if (beat + 0.5 > grid.beats) return;
      out.push(grid.event("melody", beat, 0.45 + rng() * 0.4, degreeToMidi(ctx.key, d, 4), baseVel - i * 3));
    });
  }
}

function composeMelody(ctx) {
  const { eff, rng, grid, out } = ctx;
  if (!ctx.hasInterpretation) {
    // v1.4 semantics for stored candidates: byte-identical recomposition.
    if (ctx.melodyBias === "minimal") return;
    const forward = ctx.melodyBias === "forward";
    const allowMelody = forward
      ? (!eff.dialogueSafe && eff.density >= 2)
      : eff.allowMelody;
    if (!allowMelody) return;
    emitMotif(ctx, 4);
    return;
  }
  switch (ctx.melodicStrategy) {
    case "none":
      return;
    case "sparse_motif":
      if (!eff.allowMelody) return;
      emitMotif(ctx, 4);
      return;
    case "clear_identity":
      if (eff.dialogueSafe) return;
      emitMotif(ctx, 2);
      return;
    case "fragmentary": {
      if (eff.dialogueSafe || eff.density < 2) return;
      const baseVel = Math.min(eff.velocityCeiling - 4, 48 + eff.energy * 7);
      for (let beat = 0; beat + 0.5 <= grid.beats; beat += 2) {
        if (rng() < 0.7) continue;
        const d = [7, 9, 11][Math.floor(rng() * 3)];
        out.push(grid.event("melody", beat, 0.4, degreeToMidi(ctx.key, d, 4), baseVel - 6));
      }
      return;
    }
    case "long_tones": {
      if (eff.dialogueSafe) return;
      const baseVel = Math.min(eff.velocityCeiling - 6, 40 + eff.energy * 5);
      for (let bar = 0; bar < grid.bars.length; bar += 4) {
        const d = [0, 2, 4][Math.floor(rng() * 3)];
        const span = Math.min(16, grid.beats - grid.bars[bar].startBeat);
        if (span < 2) continue;
        out.push(grid.event("melody", grid.bars[bar].startBeat, span * 0.9, degreeToMidi(ctx.key, d + 7, 4), baseVel));
      }
      return;
    }
    case "rhythmic_motif": {
      if (eff.dialogueSafe) return;
      const baseVel = Math.min(eff.velocityCeiling - 4, 46 + eff.energy * 6);
      const pitch = degreeToMidi(ctx.key, 7, 4);
      for (let beat = 0; beat + 0.5 <= grid.beats; beat += 2) {
        out.push(grid.event("melody", beat, 0.25, pitch, baseVel));
        if (rng() < 0.5) out.push(grid.event("melody", beat + 0.75, 0.25, pitch, baseVel - 6));
      }
      return;
    }
    default:
      if (!eff.allowMelody) return;
      emitMotif(ctx, 4);
  }
}

function composeImpacts(ctx) {
  const { cue, eff, grid, out, isLastCue } = ctx;
  const lowRoot = degreeToMidi(ctx.key, 0, 1);
  if (ctx.isFirstCue && (ctx.openingStrategy === "ambient_intro" || ctx.openingStrategy === "sparse_entry")) return;
  const spaceBeat = ctx.spaceSeconds ? grid.secondsToBeat(ctx.spaceSeconds) || 0 : 0;
  if (["hook", "climax", "reveal", "turn"].includes(cue.function) && eff.energy >= 2) {
    const suppressed = ctx.climaxStrategy === "drop_then_impact" && ctx.isClimaxCue;
    if (!suppressed) {
      out.push(grid.event("impact", Math.max(spaceBeat, 0), 2, lowRoot, Math.min(112, 70 + eff.energy * 8)));
    }
  }
  for (const hit of cue.hit_points || []) {
    const beat = grid.secondsToBeat(hit);
    if (beat !== null && beat >= spaceBeat) out.push(grid.event("impact", beat, 1, lowRoot + 12, 84));
  }
  if (ctx.isClimaxCue) {
    if (ctx.climaxStrategy === "drop_then_impact") {
      out.push(grid.event("impact", Math.max(spaceBeat, 2), 1, lowRoot, 96));
    }
    if (ctx.climaxStrategy === "rhythm") {
      out.push(grid.event("impact", Math.max(spaceBeat, 0), 1, lowRoot + 12, 88));
      out.push(grid.event("impact", Math.max(0, grid.beats - 2), 1, lowRoot + 12, 88));
    }
    if (ctx.climaxStrategy === "sustained_expansion") {
      out.push(grid.event("impact", Math.max(spaceBeat, 0), Math.min(4, grid.beats), lowRoot, 80));
    }
  }
  if (ctx.isFirstCue && ctx.openingStrategy === "rhythmic_start") {
    out.push(grid.event("impact", 0, 1, lowRoot + 12, 86));
    out.push(grid.event("impact", 1, 1, lowRoot + 12, 80));
  }
  if (isLastCue) {
    if (ctx.endingStrategy === "clear-button") {
      // Final confident button: root stab + low anchor on the last beat (§13).
      const buttonBeat = Math.max(0, grid.beats - 1);
      out.push(grid.event("impact", buttonBeat, 1, lowRoot, 104));
      out.push(grid.event("impact", buttonBeat, 1, degreeToMidi(ctx.key, 0, 3), 92));
    } else if (ctx.endingStrategy === "sting") {
      out.push(grid.event("impact", Math.max(0, grid.beats - 0.5), 0.5, lowRoot + 12, 100));
    } else if (ctx.endingStrategy === "loop-ready-tail") {
      out.push(grid.event("impact", Math.max(0, grid.beats - 2), 2, lowRoot, 70));
    }
    // "fade": no final impact — the tail simply stays quiet.
  }
}

const LANES = ["pulse", "bass", "harmony", "texture", "melody", "impact"];
const LANE_GENERATORS = { pulse: composePulse, bass: composeBass, harmony: composeHarmony, texture: composeTexture, melody: composeMelody, impact: composeImpacts };

// ── main entry: compose(cueSheet, options) → {notes, tempoMap, markers, meta} ──
// options: { seed, palette_id, dialogue_density, lane_gains,
//   pulse_register: 'low_mid'|'mid_high'|'high' (default low_mid = pre-v1.1 behavior),
//   harmonic_drift: boolean (default false = pre-v1.1 behavior),
//   harmonic_drift_threshold: seconds (default 35) }
// Defaults deliberately reproduce v1.0 output so stored candidates recompose
// byte-identically; new candidates opt in via recorded generation settings.
function compose(cueSheet, options = {}) {
  const seed = Number.isInteger(options.seed) ? options.seed : 1;
  const pulseRegister = PULSE_REGISTER_BASES[options.pulse_register] ? options.pulse_register : "low_mid";
  const driftEnabled = options.harmonic_drift === true;
  const driftThreshold = Number(options.harmonic_drift_threshold) > 0 ? Number(options.harmonic_drift_threshold) : 35;
  // Interpretation axes (QG-LIVE-1): default to pre-v1.2 behavior so stored
  // candidates recompose byte-identically; new candidates opt in via
  // recorded generation settings.
  const tempoFeel = TEMPO_FEELS[options.tempo_feel] ? options.tempo_feel : "as_planned";
  const tempoFactor = TEMPO_FEELS[tempoFeel];
  const pulseStyle = PULSE_STYLES.includes(options.pulse_style) ? options.pulse_style : "as_planned";
  const melodyBias = MELODY_BIASES.includes(options.melody_bias) ? options.melody_bias : "as_planned";
  // Concept normalization (v1.5 diversity overhaul): a full interpretation
  // object wins; individual v1.4 axes remain honored for stored candidates;
  // everything else defaults to the neutral concept = pre-v1.5 output.
  const conceptAxes = options.interpretation && options.interpretation.axes ? options.interpretation.axes : options;
  const rhythmStrategy = conceptAxes.rhythm
    || (pulseStyle === "driving" ? "driving_pulse" : pulseStyle === "sparse" ? "sparse_pulse" : "regular_pulse");
  const melodicStrategy = conceptAxes.melody
    || (melodyBias === "forward" ? "clear_identity" : melodyBias === "minimal" ? "none" : "sparse_motif");
  const harmonicChar = conceptAxes.harmonic || "stable";
  const densityStrategy = conceptAxes.density || "moderate";
  const textureKind = conceptAxes.texture || "clean";
  const development = conceptAxes.development || "steady";
  const openingStrategy = conceptAxes.opening || "immediate";
  const climaxStrategy = conceptAxes.climax || "density";
  const endingStrategy = conceptAxes.ending || "clear-button";
  const cues = cueSheet.cues || [];
  const notes = [];
  const tempoMap = [];
  const markers = [];
  let cueStartTick = 0;

  cues.forEach((cue, cueIndex) => {
    const key = parseKey(cue.key);
    // Timing must be validated before any math: `end_seconds - start_seconds`
    // with a missing/non-finite bound yields NaN, which then flows through the
    // grid (whose NaN comparisons fail open) into note seconds/durations and a
    // corrupt-but-plausible MIDI file. Fail loudly here instead.
    if (!Number.isFinite(cue.start_seconds) || !Number.isFinite(cue.end_seconds) || cue.end_seconds <= cue.start_seconds) {
      throw new Error(`Invalid cue timing for ${cue.cue_id || `cue ${cueIndex + 1}`}: start_seconds=${cue.start_seconds}, end_seconds=${cue.end_seconds} (need finite numbers with end > start)`);
    }
    if (!Number.isFinite(cue.tempo_bpm) || cue.tempo_bpm < 40 || cue.tempo_bpm > 220) throw new Error(`Unsupported tempo_bpm for ${cue.cue_id || `cue ${cueIndex + 1}`}: ${cue.tempo_bpm}`);
    if (!SUPPORTED_TIME_SIGNATURES.includes(cue.time_signature)) throw new Error(`Unsupported time_signature for ${cue.cue_id || `cue ${cueIndex + 1}`}: ${cue.time_signature}`);
    // energy/density govern velocity and note density. A non-integer or
    // out-of-range value silently produced velocity-0 (== note-off) MIDI and
    // NaN WAV samples — inaudible, no error. This module must not trust that
    // schema validation ran upstream: fail loudly on its own contract.
    if (!Number.isInteger(cue.energy) || cue.energy < 1 || cue.energy > 5) throw new Error(`Invalid energy for ${cue.cue_id || `cue ${cueIndex + 1}`}: ${cue.energy} (need integer 1..5)`);
    if (!Number.isInteger(cue.density) || cue.density < 1 || cue.density > 5) throw new Error(`Invalid density for ${cue.cue_id || `cue ${cueIndex + 1}`}: ${cue.density} (need integer 1..5)`);
    const eff = effectiveCueSettings(cue, options);
    const cueSeconds = cue.end_seconds - cue.start_seconds;
    // Tempo feel (QG-LIVE-1): the cue sheet's tempo_bpm is the plan; the
    // candidate's interpretation may run it lifted/relaxed. Seconds stay
    // locked to the cue window; only the beat grid and tempoMap change.
    const effectiveBpm = Math.round(cue.tempo_bpm * tempoFactor);
    const beatSeconds = 60 / effectiveBpm;
    const beats = cueSeconds / beatSeconds;
    // Leading silence before the FIRST cue must offset the whole tick timeline.
    // Note seconds/.rpp items/WAV are anchored to cue.start_seconds, but the
    // tick timeline started at 0 — so a cold-open cue (start > 0) made every
    // MIDI note play early. Convert the lead-in at this cue's tempo; the tempo
    // event is pinned at tick 0 below so ticks 0..lead map to real time. A
    // first cue at start_seconds === 0 leaves cueStartTick at 0 → byte-identical
    // to prior output. Inter-cue gaps (loop tail) are unchanged: no double count.
    if (cueIndex === 0 && cue.start_seconds > 0) {
      cueStartTick = Math.round((cue.start_seconds / beatSeconds) * PPQ);
    }
    const [meterNumerator, meterDenominator] = cue.time_signature.split("/").map(Number);
    const beatsPerBar = meterNumerator * 4 / meterDenominator;
    const barCount = Math.max(1, Math.ceil(beats / beatsPerBar));
    const bars = [];
    for (let i = 0; i < barCount; i += 1) {
      bars.push({ index: i, startBeat: i * beatsPerBar, beats: Math.min(beatsPerBar, beats - i * beatsPerBar) });
    }

    // Pin the first cue's tempo at tick 0 so any leading-silence ticks convert
    // at the real tempo (not the SMF 120bpm default); later cues keep their own
    // tick. For a first cue at start 0 this is tick 0 either way (byte-identical).
    tempoMap.push({ tick: cueIndex === 0 ? 0 : cueStartTick, bpm: effectiveBpm, time_signature: cue.time_signature || "4/4" });
    markers.push({ tick: cueStartTick, name: `${cue.cue_id} ${cue.name}` });

    // Deterministic chord plan for the cue.
    const progressionRng = mulberry32(seed ^ hashString(`${cue.cue_id}:progression`));
    const pool = PROGRESSION_POOLS[cue.emotion] || PROGRESSION_POOLS.curious;
    const degrees = pool[Math.floor(progressionRng() * pool.length)];
    const chords = degrees.map((degree) => ({ degree }));

    const out = [];
    const grid = {
      beats,
      bars,
      // beat (cue-local) → note event with absolute seconds/ticks, clipped to the cue.
      event(lane, beat, durBeats, note, velocity) {
        const startSec = cue.start_seconds + beat * beatSeconds;
        let endSec = startSec + durBeats * beatSeconds;
        // Never emit a non-finite note — NaN/Infinity seconds or durations would
        // be coerced into the MIDI bytes and surface as corruption in the DAW.
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
        if (startSec >= cue.end_seconds - 1e-6) return null;
        if (endSec > cue.end_seconds) endSec = cue.end_seconds; // duration-locked: never loop past cue boundary
        const tick = cueStartTick + beat * PPQ;
        const durTicks = (endSec - startSec) / beatSeconds * PPQ;
        return noteEvent(lane, startSec, endSec - startSec, tick, durTicks, note, velocity);
      },
      secondsToBeat(sec) {
        if (sec < cue.start_seconds || sec > cue.end_seconds) return null;
        return (sec - cue.start_seconds) / beatSeconds;
      },
    };
    LANES.forEach((lane, laneIndex) => {
      const rng = mulberry32(seed ^ hashString(`${cue.cue_id}:${lane}`) ^ (laneIndex * 2654435761));
      // v1.5 concept context: per-cue derived flags. Neutral values reproduce
      // v1.3/v1.4 output exactly (velScale 1, no caps, no overrides).
      const cueCount = Math.max(1, cues.length);
      let velScale = 1;
      let densityCap = 5;
      if (development === "gradual_build") velScale = 0.8 + 0.4 * (cueIndex / cueCount);
      if (development === "restrained_then_lift") {
        const lift = cueIndex >= cueCount - 2;
        velScale = lift ? 1.15 : 0.8;
        if (!lift) densityCap = 2;
      }
      const isClimaxCue = ["reveal", "climax"].includes(cue.function);
      const isFirstCue = cueIndex === 0;
      LANE_GENERATORS[lane]({
        cue, eff, rng, grid, out, key, chords,
        isLastCue: cueIndex === cues.length - 1,
        isFirstCue,
        isClimaxCue,
        hasInterpretation: Boolean(options.interpretation && options.interpretation.axes),
        pulseRegister,
        pulseStyle,
        melodyBias,
        rhythmStrategy,
        melodicStrategy,
        harmonicChar,
        densityStrategy,
        textureKind,
        development,
        openingStrategy,
        climaxStrategy,
        endingStrategy,
        velScale,
        densityCap,
        waves: development === "waves",
        spaceSeconds: openingStrategy === "space_first" && isFirstCue ? 2 : 0,
        driftActive: driftEnabled && cueSeconds >= driftThreshold,
      });
    });

    // Generators push grid.event() results directly; clipped-out notes are null.
    notes.push(...out.filter(Boolean));
    // Advance by the cue length PLUS any silence gap before the next cue —
    // gaps are a supported scoring choice, and dropping them made every MIDI
    // deliverable play post-gap material early relative to the video (the
    // seconds-based WAV previews and .rpp items were unaffected, so the
    // deliverables contradicted each other). Gap ticks use this cue's tempo,
    // which is the tempo in force until the next cue's tempo event.
    const nextCue = cues[cueIndex + 1];
    const gapSeconds = nextCue ? Math.max(0, nextCue.start_seconds - cue.end_seconds) : 0;
    cueStartTick += Math.round((beats + gapSeconds / beatSeconds) * PPQ);
  });

  notes.sort((a, b) => a.tick - b.tick || a.lane.localeCompare(b.lane) || a.note - b.note);
  return {
    notes,
    tempoMap,
    markers,
    meta: {
      seed,
      palette_id: options.palette_id || null,
      dialogue_density: options.dialogue_density || null,
      pulse_register: pulseRegister,
      harmonic_drift: driftEnabled,
      tempo_feel: tempoFeel,
      pulse_style: pulseStyle,
      melody_bias: melodyBias,
      interpretation: options.interpretation ? {
        interpretation_id: options.interpretation.interpretation_id || null,
        label: options.interpretation.label || null,
        axes: options.interpretation.axes || null,
      } : null,
      cue_count: cues.length,
      total_ticks: cueStartTick,
      note_count: notes.length,
      lanes: LANES.filter((lane) => notes.some((n) => n.lane === lane)),
    },
  };
}

module.exports = { compose, mulberry32, hashString, parseKey, effectiveCueSettings, LANES, PROGRESSION_POOLS, MODES, PULSE_REGISTER_BASES, COMPOSER_CONTRACT };
