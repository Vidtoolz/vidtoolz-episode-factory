'use strict';

/*
 * Draft music coherence authority — the SOLID_SONG gate.
 *
 * Answers one bounded question about a generated track: "does this feel like
 * ONE intentional piece of music rather than disconnected generated
 * sections?" It exists because the first real blind audition (2026-08-31,
 * Mikko) rejected two of three candidates precisely for "not offering a
 * single solid/coherent song" while the automated ranking had preferred one
 * of them. These metrics catch obvious not-one-song failures; they are NOT a
 * judge of musical artistry, and the human verdict always outranks them.
 *
 * Evidence classes (deterministic, dependency-free — ffmpeg decode + the
 * in-process FFT already used by draft-music-qc):
 *   - timbral flow: adjacent 5 s log-band spectral profiles must not jump —
 *     wholesale instrumentation/sonic-identity replacement is the strongest
 *     labeled discriminator (USE track p90 0.003 vs REJECT tracks 0.036/0.039).
 *   - energy continuity: interior >6 dB block-to-block level resets (the
 *     ending region is excluded so a deliberate fade never counts).
 *   - ending relation: the QC ending class plus how the final block relates
 *     to the body material.
 *   - progression: some development is healthy; a wild interior level ride
 *     is not (deliberate build vs arbitrary jumps).
 *   - material identity/recurrence + tonal context are computed as ADVISORY
 *     diagnostics only: chroma continuity proved genre-confounded on the
 *     calibration corpus (legitimate acoustic harmonic movement scores below
 *     an incoherent electronic track), so it must not gate.
 */

const qc = require('./draft-music-qc.js');

const SCHEMA = 'vidtoolz.draftMusicCoherence.v1';
const RATE = 22050;
const FFT = 2048;
const BLOCK_S = 5;
const BANDS = 24;
const BAND_LO_HZ = 40;
const BAND_HI_HZ = 10000;

/* Calibrated on the 2026-08-31 real dual-model canary (human-labeled:
 * A=USE sha 5063d12f…, B/C=REJECT_COHERENCE sha 45e2ece8…/3f503939…) plus
 * unlabeled plausibly-coherent controls (matched-pair SA3M, precalibration
 * SA3M attempts, legacy 237 s bed). Sample size is honestly SMALL (3 labeled
 * files); thresholds sit with >=1.6x margin to every calibration point and
 * must be revisited as human verdicts accumulate. */
const COHERENCE_CONTRACT = Object.freeze({
  concept: 'SOLID_SONG',
  question: 'does this track feel like one intentional piece of music rather than disconnected generated sections?',
  floors: {
    timbral_flow_p90_max: 0.020,
    timbral_flow_mean_max: 0.010,
    interior_energy_jump_rate_max: 0.14,
    min_blocks: 4,
    min_score: 6.0,
  },
  catastrophic: { timbral_flow_p90: 0.03, score_below: 3.0 },
  score_weights: { timbral_flow: 4, energy_continuity: 2, ending: 2, identity: 1, progression: 1 },
  advisory_only: ['tonal_context', 'recurrence', 'novelty'],
  calibration: 'outputs/claude-stable-audio-draft-music-coherence-2026-09-01/COHERENCE-CALIBRATION.json',
});

const CLASSES = Object.freeze(['SOLID_SONG', 'LOW_COHERENCE', 'CATASTROPHIC_INCOHERENCE', 'NOT_ASSESSABLE']);

class DraftMusicCoherenceError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftMusicCoherenceError'; this.code = code; }
}
function fail(code, message) { throw new DraftMusicCoherenceError(code, message); }

function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function std(values) { const m = mean(values); return Math.sqrt(mean(values.map((v) => (v - m) * (v - m)))); }
function l2(vector) { const norm = Math.hypot(...vector); return norm > 0 ? vector.map((v) => v / norm) : vector.slice(); }
function cosineSimilarity(a, b) {
  const na = l2(a); const nb = l2(b);
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += na[i] * nb[i];
  return sum;
}
function meanVectors(rows) {
  const out = new Float64Array(rows[0].length);
  for (const row of rows) for (let i = 0; i < out.length; i += 1) out[i] += row[i];
  return Array.from(out, (v) => v / rows.length);
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
/* Piecewise-linear map through calibration anchor points [x, y] (x ascending). */
function piecewise(x, points) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1]; const [x1, y1] = points[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/* Per-second log-band spectral profiles + chroma; averaged into 5 s blocks. */
function trackProfile(file) {
  const samples = qc.decodeMono(file);
  const framesPerSecond = Math.floor(RATE / FFT);
  const perSecond = [];
  for (let second = 0; (second + 1) * RATE <= samples.length; second += 1) {
    const bands = new Float64Array(BANDS);
    const chroma = new Float64Array(12);
    let rmsSum = 0; let frames = 0;
    for (let f = 0; f < framesPerSecond; f += 1) {
      const start = second * RATE + f * FFT;
      if (start + FFT > samples.length) break;
      const frame = samples.subarray(start, start + FFT);
      let sumSquares = 0;
      for (let i = 0; i < FFT; i += 1) sumSquares += frame[i] * frame[i];
      rmsSum += Math.sqrt(sumSquares / FFT);
      const mags = qc.fftMagnitudes(frame);
      for (let bin = 1; bin < mags.length; bin += 1) {
        const hz = bin * (RATE / FFT);
        if (hz >= BAND_LO_HZ && hz < BAND_HI_HZ) {
          const band = Math.min(BANDS - 1, Math.floor(BANDS * (Math.log(hz / BAND_LO_HZ) / Math.log(BAND_HI_HZ / BAND_LO_HZ))));
          bands[band] += mags[bin];
        }
        if (hz >= 55 && hz <= 4000) {
          const pitchClass = ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12;
          chroma[pitchClass] += mags[bin] * mags[bin];
        }
      }
      frames += 1;
    }
    if (!frames) break;
    perSecond.push({
      bands: Array.from(bands, (v) => Math.log10(1 + v / frames)),
      chroma: Array.from(chroma, (v) => v / frames),
      rms_db: 20 * Math.log10(rmsSum / frames + 1e-9),
    });
  }
  const blocks = [];
  for (let start = 0; start + BLOCK_S <= perSecond.length; start += BLOCK_S) {
    const rows = perSecond.slice(start, start + BLOCK_S);
    blocks.push({
      start_s: start,
      bands: meanVectors(rows.map((row) => row.bands)),
      chroma: meanVectors(rows.map((row) => row.chroma)),
      rms_db: mean(rows.map((row) => row.rms_db)),
    });
  }
  return { blocks, seconds: perSecond.length };
}

function analyzeBlocks(blocks) {
  const n = blocks.length;
  const adjacent = [];
  for (let i = 1; i < n; i += 1) adjacent.push(1 - cosineSimilarity(blocks[i - 1].bands, blocks[i].bands));
  const sortedAdjacent = [...adjacent].sort((a, b) => a - b);
  const p90 = sortedAdjacent.length ? sortedAdjacent[Math.floor(0.9 * (sortedAdjacent.length - 1))] : 0;

  /* Interior energy jumps: the last two boundaries belong to the ending
   * region — a deliberate fade-out never counts against continuity. */
  const interiorJumps = [];
  for (let i = 1; i < n - 2; i += 1) interiorJumps.push(Math.abs(blocks[i].rms_db - blocks[i - 1].rms_db));
  const jumpCount = interiorJumps.filter((jump) => jump > 6).length;
  const jumpRate = interiorJumps.length ? jumpCount / interiorJumps.length : 0;
  const interiorRms = blocks.slice(0, Math.max(1, n - 2)).map((block) => block.rms_db);

  /* Material identity + recurrence (advisory). */
  const pairSimilarities = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + Math.ceil(30 / BLOCK_S); j < n; j += 1) pairSimilarities.push(cosineSimilarity(blocks[i].bands, blocks[j].bands));
  }
  const recurrence = [];
  for (let i = Math.floor(n / 2); i < n; i += 1) {
    let best = -1;
    for (let j = 0; j < i - Math.ceil(30 / BLOCK_S); j += 1) best = Math.max(best, cosineSimilarity(blocks[i].bands, blocks[j].bands));
    if (best >= 0) recurrence.push(best);
  }

  /* 15 s novelty (advisory): section-transition candidates. */
  const noveltyWindow = 3;
  const novelty = [];
  for (let i = noveltyWindow; i <= n - noveltyWindow; i += 1) {
    const before = meanVectors(blocks.slice(i - noveltyWindow, i).map((block) => block.bands));
    const after = meanVectors(blocks.slice(i, i + noveltyWindow).map((block) => block.bands));
    novelty.push(1 - cosineSimilarity(before, after));
  }

  /* Tonal context (ADVISORY ONLY — genre-confounded, see module header). */
  const chromaAdjacent = [];
  for (let i = 1; i < n; i += 1) chromaAdjacent.push(cosineSimilarity(blocks[i - 1].chroma, blocks[i].chroma));
  const globalChroma = meanVectors(blocks.map((block) => block.chroma));

  const body = blocks.slice(1, Math.max(2, n - 2));
  return {
    block_count: n,
    timbral_flow: {
      adjacent_discontinuity_mean: +mean(adjacent).toFixed(4),
      adjacent_discontinuity_p90: +p90.toFixed(4),
      adjacent_discontinuity_max: +(adjacent.length ? Math.max(...adjacent) : 0).toFixed(4),
    },
    energy_continuity: {
      interior_jumps_over_6db: jumpCount,
      interior_jump_rate: +jumpRate.toFixed(4),
      interior_jump_max_db: +(interiorJumps.length ? Math.max(...interiorJumps) : 0).toFixed(2),
      interior_rms_std_db: +std(interiorRms).toFixed(2),
    },
    identity: {
      global_selfsim_mean: +(pairSimilarities.length ? mean(pairSimilarities) : 1).toFixed(4),
      global_selfsim_min: +(pairSimilarities.length ? Math.min(...pairSimilarities) : 1).toFixed(4),
    },
    recurrence: {
      advisory: true,
      mean: +(recurrence.length ? mean(recurrence) : 1).toFixed(4),
      min: +(recurrence.length ? Math.min(...recurrence) : 1).toFixed(4),
    },
    novelty: {
      advisory: true,
      max: +(novelty.length ? Math.max(...novelty) : 0).toFixed(4),
      events_over_002: novelty.filter((value) => value > 0.02).length,
    },
    tonal_context: {
      advisory: true,
      reason_excluded_from_gate: 'genre-confounded: legitimate acoustic harmonic movement scores below incoherent electronic material on the calibration corpus',
      chroma_adjacent_mean: +(chromaAdjacent.length ? mean(chromaAdjacent) : 1).toFixed(4),
      chroma_global_mean: +mean(blocks.map((block) => cosineSimilarity(block.chroma, globalChroma))).toFixed(4),
    },
    ending_body_similarity: +cosineSimilarity(blocks[n - 1].bands, meanVectors(body.map((block) => block.bands))).toFixed(4),
    energy_series_db: blocks.map((block) => +block.rms_db.toFixed(2)),
  };
}

/* SOLID_SONG verdict for one generated track. `endingClass` comes from the
 * QC inspection (draft-music-qc classifyEnding). */
function coherenceReport(file, options = {}) {
  const endingClass = options.endingClass || 'ABRUPT_END';
  if (!qc.ENDINGS.includes(endingClass)) fail('DRAFT_MUSIC_COHERENCE_ENDING_INVALID', String(endingClass));
  const profile = options.profile || trackProfile(file);
  const floors = COHERENCE_CONTRACT.floors;
  if (profile.blocks.length < floors.min_blocks) {
    return {
      schema: SCHEMA, coherence_class: 'NOT_ASSESSABLE', solid_song: false,
      coherence_score: 0, metrics: { block_count: profile.blocks.length }, scores: null,
      floor_failures: ['DRAFT_MUSIC_COHERENCE_TOO_SHORT_TO_ASSESS'],
      contract: COHERENCE_CONTRACT,
    };
  }
  const metrics = analyzeBlocks(profile.blocks);

  const weights = COHERENCE_CONTRACT.score_weights;
  const scores = {
    /* anchors from the calibration corpus: USE 0.003 → full; controls <=0.012
     * → high; floor edge 0.020 → mid; REJECT tracks 0.036/0.039 → near zero */
    timbral_flow: +(weights.timbral_flow * piecewise(metrics.timbral_flow.adjacent_discontinuity_p90,
      [[0.008, 1], [0.020, 0.55], [0.045, 0]])).toFixed(3),
    energy_continuity: +(weights.energy_continuity * piecewise(metrics.energy_continuity.interior_jump_rate,
      [[0, 1], [0.14, 0.5], [0.25, 0]])).toFixed(3),
    ending: +(weights.ending * ({ CLEAN_END: 1, FADE_ACCEPTABLE: 0.8, ABRUPT_END: 0.3, TRUNCATED: 0 }[endingClass])).toFixed(3),
    identity: +(weights.identity * piecewise(metrics.identity.global_selfsim_min,
      [[0.85, 0], [0.97, 1]])).toFixed(3),
    progression: +(weights.progression * piecewise(metrics.energy_continuity.interior_rms_std_db,
      [[0, 0.3], [0.5, 1], [4, 1], [8, 0.2]])).toFixed(3),
  };
  const coherenceScore = +Object.values(scores).reduce((a, b) => a + b, 0).toFixed(3);

  const floorFailures = [];
  if (metrics.timbral_flow.adjacent_discontinuity_p90 > floors.timbral_flow_p90_max) floorFailures.push('TIMBRAL_FLOW_P90');
  if (metrics.timbral_flow.adjacent_discontinuity_mean > floors.timbral_flow_mean_max) floorFailures.push('TIMBRAL_FLOW_MEAN');
  if (metrics.energy_continuity.interior_jump_rate > floors.interior_energy_jump_rate_max) floorFailures.push('INTERIOR_ENERGY_JUMPS');
  if (endingClass === 'TRUNCATED') floorFailures.push('ENDING_TRUNCATED');
  if (coherenceScore < floors.min_score) floorFailures.push('COHERENCE_SCORE_FLOOR');

  const catastrophic = metrics.timbral_flow.adjacent_discontinuity_p90 > COHERENCE_CONTRACT.catastrophic.timbral_flow_p90
    || coherenceScore < COHERENCE_CONTRACT.catastrophic.score_below;
  const coherenceClass = floorFailures.length === 0 ? 'SOLID_SONG'
    : catastrophic ? 'CATASTROPHIC_INCOHERENCE' : 'LOW_COHERENCE';
  return {
    schema: SCHEMA,
    coherence_class: coherenceClass,
    solid_song: coherenceClass === 'SOLID_SONG',
    coherence_score: coherenceScore,
    scores,
    metrics,
    ending_class: endingClass,
    floor_failures: floorFailures,
    contract: COHERENCE_CONTRACT,
  };
}

/* Script-fit diagnostic: how well the measured energy trajectory matches the
 * brief's declared energy curve. Graded 0..1; a floor on it is deliberately
 * permissive — script fit ranks, coherence gates. */
const ENERGY_CURVE_TEMPLATES = Object.freeze({
  'flat-low': null, 'flat-high': null,
  'slow-build': [0, 0.14, 0.29, 0.43, 0.57, 0.71, 0.86, 1],
  'build-release': [0, 0.35, 0.7, 1, 1, 0.75, 0.45, 0.15],
  'two-peak': [0.1, 0.7, 1, 0.35, 0.4, 1, 0.8, 0.2],
});
function scriptFitScore(energySeriesDb, energyCurve) {
  if (!Array.isArray(energySeriesDb) || energySeriesDb.length < 4) return { score: 0.5, basis: 'TOO_SHORT_TO_ASSESS' };
  const interior = energySeriesDb.slice(0, Math.max(4, energySeriesDb.length - 2));
  const template = ENERGY_CURVE_TEMPLATES[energyCurve];
  if (template === undefined) fail('DRAFT_MUSIC_SCRIPT_FIT_CURVE_UNKNOWN', String(energyCurve));
  if (template === null) {
    const spread = std(interior);
    return { score: +piecewise(spread, [[1, 1], [6, 0]]).toFixed(3), basis: `FLAT_CURVE interior std ${spread.toFixed(2)} dB` };
  }
  const resampled = Array.from({ length: template.length }, (_, i) => interior[Math.min(interior.length - 1, Math.round((i * (interior.length - 1)) / (template.length - 1)))]);
  const meanMeasured = mean(resampled); const meanTemplate = mean(template);
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < template.length; i += 1) {
    num += (resampled[i] - meanMeasured) * (template[i] - meanTemplate);
    da += (resampled[i] - meanMeasured) ** 2; db += (template[i] - meanTemplate) ** 2;
  }
  const correlation = da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
  return { score: +clamp01((correlation + 1) / 2).toFixed(3), basis: `curve ${energyCurve} correlation ${correlation.toFixed(3)}` };
}

module.exports = {
  SCHEMA, COHERENCE_CONTRACT, CLASSES, BLOCK_S, DraftMusicCoherenceError,
  trackProfile, analyzeBlocks, coherenceReport, scriptFitScore, ENERGY_CURVE_TEMPLATES,
  cosineSimilarity, piecewise,
};
