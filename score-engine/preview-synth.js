// VIDTOOLZ Score Engine — offline preview synthesizer.
// Renders the composed note events to a 16-bit stereo WAV *mockup* so Mikko can
// judge structure/energy/timing before opening a DAW. This is deliberately a
// sketch renderer — the real sound comes from Omnisphere/UVI/Arturia/Ableton
// via the REAPER/Ableton handoff. Deterministic; no external processes.
"use strict";

const LANE_TIMBRES = {
  pulse: { wave: "squareish", attack: 0.004, release: 0.05, gain: 0.5, pan: -0.18 },
  bass: { wave: "sub", attack: 0.008, release: 0.08, gain: 0.62, pan: 0 },
  harmony: { wave: "pad", attack: 0.25, release: 0.4, gain: 0.3, pan: 0.15 },
  texture: { wave: "air", attack: 0.05, release: 0.5, gain: 0.22, pan: 0.35 },
  melody: { wave: "triangle", attack: 0.01, release: 0.12, gain: 0.42, pan: -0.1 },
  impact: { wave: "boom", attack: 0.002, release: 0.35, gain: 0.7, pan: 0 },
};

// Dialogue-safe mix pulls everything down and softens low end under narration (§13).
const DIALOGUE_SAFE_GAINS = { pulse: 0.55, bass: 0.5, harmony: 0.65, texture: 0.6, melody: 0.45, impact: 0.55 };

function midiToFreq(note) { return 440 * Math.pow(2, (note - 69) / 12); }

function renderNoteInto(buffer, sampleRate, note, timbre, gainScale) {
  const startSample = Math.floor(note.seconds * sampleRate);
  const durSamples = Math.max(1, Math.floor(note.dur_seconds * sampleRate));
  const releaseSamples = Math.floor(timbre.release * sampleRate);
  const totalSamples = Math.min(durSamples + releaseSamples, buffer.length - startSample);
  if (totalSamples <= 0 || startSample >= buffer.length) return;
  const freq = midiToFreq(note.note);
  const velocity = (note.velocity / 127) * timbre.gain * gainScale;
  const attackSamples = Math.max(1, Math.floor(timbre.attack * sampleRate));
  const twoPi = Math.PI * 2;
  let phase = 0;
  let phaseB = 0; // detune voice for pads
  const detune = timbre.wave === "pad" ? 1.004 : 1;
  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    let f = freq;
    if (timbre.wave === "boom") f = freq * (1 + Math.exp(-t * 14) * 1.2); // pitch drop
    phase += (twoPi * f) / sampleRate;
    phaseB += (twoPi * f * detune) / sampleRate;
    let sample;
    switch (timbre.wave) {
      case "squareish": sample = Math.tanh(Math.sin(phase) * 3) * 0.7 + Math.sin(phase) * 0.3; break;
      case "sub": sample = Math.sin(phase) * 0.85 + Math.sin(phase * 2) * 0.15; break;
      case "pad": sample = (sawFromPhase(phase) + sawFromPhase(phaseB)) * 0.32 + Math.sin(phase) * 0.25; break;
      case "air": sample = Math.sin(phase) * (0.8 + 0.2 * Math.sin(twoPi * 5.3 * t)); break;
      case "triangle": sample = triFromPhase(phase); break;
      case "boom": sample = Math.sin(phase) * 0.9 + (pseudoNoise(startSample + i) * Math.exp(-t * 30)) * 0.3; break;
      default: sample = Math.sin(phase);
    }
    // Envelope: linear attack, sustain, linear release after note-off.
    let env = 1;
    if (i < attackSamples) env = i / attackSamples;
    if (i > durSamples) env *= Math.max(0, 1 - (i - durSamples) / Math.max(1, releaseSamples));
    buffer[startSample + i] += sample * env * velocity;
  }
}

function sawFromPhase(phase) { const x = phase / (Math.PI * 2); return 2 * (x - Math.floor(x + 0.5)); }
function triFromPhase(phase) { return Math.asin(Math.sin(phase)) * (2 / Math.PI); }
// Deterministic noise (no Math.random — determinism is a contract here).
function pseudoNoise(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

// Render one lane to a mono Float64Array.
function renderLane(notes, lane, durationSeconds, sampleRate, gainScale = 1) {
  const buffer = new Float64Array(Math.ceil(durationSeconds * sampleRate) + sampleRate);
  const timbre = LANE_TIMBRES[lane];
  for (const note of notes) {
    if (note.lane !== lane) continue;
    renderNoteInto(buffer, sampleRate, note, timbre, gainScale);
  }
  return buffer;
}

function writeWavBuffer(left, right, sampleRate, bitDepth = 16) {
  const frames = left.length;
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const dataBytes = frames * 2 * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2 * bytesPerSample, 28);
  buffer.writeUInt16LE(2 * bytesPerSample, 32); buffer.writeUInt16LE(bitDepth, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (const sample of [left[i], right[i]]) {
      const clamped = Math.max(-1, Math.min(1, sample));
      if (bitDepth === 24) {
        const v = Math.round(clamped * 8388607);
        buffer.writeIntLE(v, offset, 3); offset += 3;
      } else {
        buffer.writeInt16LE(Math.round(clamped * 32767), offset); offset += 2;
      }
    }
  }
  return buffer;
}

// Render the full mix (and optionally per-lane stems) from composed notes.
// options: { sampleRate, bitDepth, dialogueSafe, laneGains: {bass: 0.5,...}, stems: true,
//   durationExact: true } — durationExact trims the output to EXACTLY the target
// duration (video-package delivery), fading the last 150ms into the boundary so
// release tails never push the export past the video length (validation defect #1).
function renderMix(composition, durationSeconds, options = {}) {
  const sampleRate = options.sampleRate || 48000;
  const bitDepth = options.bitDepth || 16;
  const laneGains = options.laneGains || {};
  const lanes = composition.meta.lanes;
  const frames = options.durationExact
    ? Math.max(1, Math.round(durationSeconds * sampleRate))
    : Math.ceil(durationSeconds * sampleRate) + sampleRate;
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  const stems = {};

  for (const lane of lanes) {
    let gain = laneGains[lane] !== undefined ? laneGains[lane] : 1;
    if (options.dialogueSafe) gain *= DIALOGUE_SAFE_GAINS[lane] !== undefined ? DIALOGUE_SAFE_GAINS[lane] : 0.6;
    const mono = renderLane(composition.notes, lane, durationSeconds, sampleRate, gain);
    const pan = LANE_TIMBRES[lane].pan;
    const leftGain = Math.min(1, 1 - pan);
    const rightGain = Math.min(1, 1 + pan);
    for (let i = 0; i < frames; i += 1) {
      left[i] += mono[i] * leftGain;
      right[i] += mono[i] * rightGain;
    }
    if (options.stems) stems[lane] = mono;
  }

  // Normalize to a conservative ceiling, then soft clip stragglers.
  let peak = 0;
  for (let i = 0; i < frames; i += 1) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const target = options.dialogueSafe ? 0.5 : 0.85;
  const scale = peak > 0 ? Math.min(1, target / peak) : 1;
  for (let i = 0; i < frames; i += 1) {
    left[i] = Math.tanh(left[i] * scale * 1.1) / 1.1;
    right[i] = Math.tanh(right[i] * scale * 1.1) / 1.1;
  }
  const fadeSamples = options.durationExact ? Math.min(frames, Math.round(sampleRate * 0.15)) : 0;
  if (fadeSamples > 0) {
    for (let i = frames - fadeSamples; i < frames; i += 1) {
      const gain = (frames - i) / fadeSamples;
      left[i] *= gain;
      right[i] *= gain;
    }
  }

  const result = { mix: writeWavBuffer(left, right, sampleRate, bitDepth), sampleRate, bitDepth, peak, scale, durationExact: Boolean(options.durationExact) };
  if (options.stems) {
    result.stems = {};
    for (const lane of Object.keys(stems)) {
      // renderLane always allocates a padded buffer — clip stems to the same
      // frame count as the mix so duration-exact exports match everywhere.
      const mono = stems[lane].subarray(0, frames);
      for (let i = 0; i < frames; i += 1) mono[i] = Math.tanh(mono[i] * scale * 1.1) / 1.1;
      for (let i = frames - fadeSamples; i < frames && fadeSamples > 0; i += 1) mono[i] *= (frames - i) / fadeSamples;
      result.stems[lane] = writeWavBuffer(mono, mono, sampleRate, bitDepth);
    }
  }
  return result;
}

module.exports = { renderMix, renderLane, writeWavBuffer, LANE_TIMBRES, DIALOGUE_SAFE_GAINS };
