// VIDTOOLZ Score Engine — deterministic seeded composition engine.
// Turns an approved cue sheet + palette + seed into concrete note events per
// lane (pulse, bass, harmony, texture, melody, impact). Same input + same seed
// always produces the same notes. No AI writes raw MIDI here (§5B).
"use strict";

const { PPQ } = require("./midi-writer.js");

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
  const match = /^([A-G](?:#|b)?)\s+(major|minor|dorian|lydian|mixolydian|phrygian)$/i.exec(String(keyText || "").trim());
  if (!match) return { tonic: 2, mode: "minor", intervals: MODES.minor, label: "D minor" };
  const tonicName = match[1][0].toUpperCase() + match[1].slice(1);
  const mode = match[2].toLowerCase();
  return { tonic: PITCH_CLASSES[tonicName] ?? 2, mode, intervals: MODES[mode] || MODES.minor, label: `${tonicName} ${mode}` };
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
  lane, seconds: round3(seconds), dur_seconds: round3(durSeconds), tick: Math.round(tick), dur_ticks: Math.max(1, Math.round(durTicks)), note, velocity,
});
function round3(v) { return Math.round(v * 1000) / 1000; }

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

function composePulse(ctx) {
  const { cue, eff, rng, grid, out } = ctx;
  const stepBeats = eff.dialogueSafe || eff.density <= 2 ? 0.5 : eff.density >= 4 ? 0.25 : 0.5;
  const gate = 0.55 + rng() * 0.15;
  const baseVel = Math.min(eff.velocityCeiling, 42 + eff.energy * 9);
  const restProbability = eff.dialogueSafe ? 0.3 : Math.max(0.02, 0.28 - eff.density * 0.05);
  const pitchRoot = degreeToMidi(ctx.key, 0, 4); // around C4 region
  const pitchAlt = degreeToMidi(ctx.key, 4, 4);
  for (let beat = 0; beat + stepBeats <= grid.beats + 1e-9; beat += stepBeats) {
    if (rng() < restProbability) continue;
    const accent = Math.abs(beat % 1) < 1e-9 ? 6 : Math.abs(beat % 0.5) < 1e-9 ? 0 : -6;
    const note = rng() < 0.82 ? pitchRoot : pitchAlt;
    out.push(grid.event("pulse", beat, stepBeats * gate, note, baseVel + accent + Math.round(rng() * 6 - 3)));
  }
}

function composeBass(ctx) {
  const { eff, rng, grid, out, chords } = ctx;
  const baseVel = Math.min(eff.velocityCeiling, 40 + eff.energy * 8);
  for (const bar of grid.bars) {
    const chord = chords[bar.index % chords.length];
    const root = degreeToMidi(ctx.key, chord.degree, 2); // low register
    if (eff.dialogueSafe || eff.density <= 2) {
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

function composeHarmony(ctx) {
  const { eff, grid, out, chords } = ctx;
  const baseVel = Math.min(eff.velocityCeiling - 8, 34 + eff.energy * 6);
  let voicing = null;
  for (const bar of grid.bars) {
    const chord = chords[bar.index % chords.length];
    voicing = voiceLead(voicing, chordPitches(ctx.key, chord.degree, 4));
    for (const pitch of voicing) {
      out.push(grid.event("harmony", bar.startBeat, bar.beats * 0.98, pitch, baseVel));
    }
  }
}

function composeTexture(ctx) {
  const { eff, rng, grid, out } = ctx;
  const probability = (eff.dialogueSafe ? 0.05 : 0.1) + eff.density * 0.02;
  const baseVel = Math.min(56, 22 + eff.energy * 5);
  for (let beat = 0; beat + 0.5 <= grid.beats + 1e-9; beat += 1) {
    if (rng() >= probability) continue;
    const degree = [7, 9, 11, 14][Math.floor(rng() * 4)];
    out.push(grid.event("texture", beat + (rng() < 0.5 ? 0 : 0.5), 0.5 + rng(), degreeToMidi(ctx.key, degree, 4), baseVel));
  }
}

function composeMelody(ctx) {
  const { eff, rng, grid, out } = ctx;
  if (!eff.allowMelody) return;
  // Short seeded motif (3-5 notes), stated once per 4 bars, never busy (§12.5).
  const motifLength = 3 + Math.floor(rng() * 3);
  const degrees = [];
  let degree = [0, 2, 4][Math.floor(rng() * 3)] + 7;
  for (let i = 0; i < motifLength; i += 1) {
    degrees.push(degree);
    degree += [-2, -1, 1, 2][Math.floor(rng() * 4)];
  }
  const baseVel = Math.min(eff.velocityCeiling - 4, 48 + eff.energy * 7);
  for (let bar = 0; bar < grid.bars.length; bar += 4) {
    const startBeat = grid.bars[bar].startBeat + (rng() < 0.5 ? 0 : 2);
    degrees.forEach((d, i) => {
      const beat = startBeat + i * (rng() < 0.3 ? 1 : 0.5);
      if (beat + 0.5 > grid.beats) return;
      out.push(grid.event("melody", beat, 0.45 + rng() * 0.4, degreeToMidi(ctx.key, d, 4), baseVel - i * 3));
    });
  }
}

function composeImpacts(ctx) {
  const { cue, eff, grid, out, isLastCue } = ctx;
  const lowRoot = degreeToMidi(ctx.key, 0, 1);
  if (["hook", "climax", "reveal", "turn"].includes(cue.function) && eff.energy >= 2) {
    out.push(grid.event("impact", 0, 2, lowRoot, Math.min(112, 70 + eff.energy * 8)));
  }
  for (const hit of cue.hit_points || []) {
    const beat = grid.secondsToBeat(hit);
    if (beat !== null) out.push(grid.event("impact", beat, 1, lowRoot + 12, 84));
  }
  if (isLastCue) {
    // Final confident button: root stab + low anchor on the last beat (§13).
    const buttonBeat = Math.max(0, grid.beats - 1);
    out.push(grid.event("impact", buttonBeat, 1, lowRoot, 104));
    out.push(grid.event("impact", buttonBeat, 1, degreeToMidi(ctx.key, 0, 3), 92));
  }
}

const LANES = ["pulse", "bass", "harmony", "texture", "melody", "impact"];
const LANE_GENERATORS = { pulse: composePulse, bass: composeBass, harmony: composeHarmony, texture: composeTexture, melody: composeMelody, impact: composeImpacts };

// ── main entry: compose(cueSheet, options) → {notes, tempoMap, markers, meta} ──
// options: { seed, palette_id, dialogue_density, lane_gains }
function compose(cueSheet, options = {}) {
  const seed = Number.isInteger(options.seed) ? options.seed : 1;
  const cues = cueSheet.cues || [];
  const notes = [];
  const tempoMap = [];
  const markers = [];
  let cueStartTick = 0;

  cues.forEach((cue, cueIndex) => {
    const key = parseKey(cue.key);
    const eff = effectiveCueSettings(cue, options);
    const cueSeconds = cue.end_seconds - cue.start_seconds;
    const beatSeconds = 60 / cue.tempo_bpm;
    const beats = cueSeconds / beatSeconds;
    const beatsPerBar = Number(String(cue.time_signature || "4/4").split("/")[0]) || 4;
    const barCount = Math.max(1, Math.ceil(beats / beatsPerBar));
    const bars = [];
    for (let i = 0; i < barCount; i += 1) {
      bars.push({ index: i, startBeat: i * beatsPerBar, beats: Math.min(beatsPerBar, beats - i * beatsPerBar) });
    }

    tempoMap.push({ tick: cueStartTick, bpm: cue.tempo_bpm, time_signature: cue.time_signature || "4/4" });
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
      LANE_GENERATORS[lane]({ cue, eff, rng, grid, out, key, chords, isLastCue: cueIndex === cues.length - 1 });
    });

    // Generators push grid.event() results directly; clipped-out notes are null.
    notes.push(...out.filter(Boolean));
    cueStartTick += Math.round(beats * PPQ);
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
      cue_count: cues.length,
      total_ticks: cueStartTick,
      note_count: notes.length,
      lanes: LANES.filter((lane) => notes.some((n) => n.lane === lane)),
    },
  };
}

module.exports = { compose, mulberry32, hashString, parseKey, effectiveCueSettings, LANES, PROGRESSION_POOLS, MODES };
