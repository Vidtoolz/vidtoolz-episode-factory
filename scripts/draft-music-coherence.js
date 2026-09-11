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
 *
 * GATE V2 (2026-09-10 audit repair). Every floor above is an ABSENCE-OF-BADNESS
 * measure, so they all reach their best value when nothing happens: a 3-minute
 * unchanging two-sine drone measured timbral-flow p90 0.0000, scored 7.90 and
 * was classified SOLID_SONG - the top class - outranking two of the three
 * tracks Mikko had actually approved. A gate built only from upper bounds
 * cannot distinguish music from silence-with-a-pitch.
 *
 * V2 therefore adds the LOWER side: POSITIVE measurements of development
 * (measureDevelopment) and one falsifiable degeneracy floor
 * (classifyDevelopment). The degeneracy floor needs no human labels - it asks
 * "did anything happen at all?", not "is this good?" - which is why it can ship
 * before the calibration corpus exists. Everything else V2 measures is recorded
 * as an UNCALIBRATED candidate signal and gates nothing.
 */

const qc = require('./draft-music-qc.js');

const SCHEMA = 'vidtoolz.draftMusicCoherence.v1';
const RATE = 22050;
const FFT = 2048;
const BLOCK_S = 5;
const BANDS = 24;
const BAND_LO_HZ = 40;
const BAND_HI_HZ = 10000;

/* Human-calibrated on BOTH real blind auditions (2026-09-01 recalibration):
 *   2026-08-31 dual-model: A(SA3M)=USE, B/C(MiniMax)=REJECT "not a single
 *   solid/coherent song".
 *   2026-09-01 all-SA3M: A=USE(rank 1), B=USE(rank 2), C=USE(rank 3) — ALL
 *   three usable to the human, though the machine had failed B and C.
 * The feature audit across all six labeled tracks (+3 coherent controls)
 * found exactly ONE feature that separates human-USE from human-REJECT:
 * adjacent timbral-flow p90 (usable <= 0.024, reject >= 0.0358). Every other
 * hard floor of the first gate misfired on human-usable material:
 *   - timbral_flow_mean OVERLAPS (usable new-C 0.0154 > reject old-C 0.0150),
 *   - interior_energy_jump_rate OVERLAPS (usable 0.1515 vs reject 0.1563),
 *   - timbral_flow_max INVERTS (one intentional big transition inside one
 *     song reads larger than a wandering track's steps),
 * so those are demoted to score/diagnostics and must never gate again.
 *
 * Three-state model (the gate answers a DRAFT question — "usable enough to
 * judge the video with?" — never publication quality):
 *   SOLID_SONG          strongly coherent, clearly usable
 *   DRAFT_MUSIC_USABLE  coherent enough for Draft use, weaker than the best
 *   REJECT_COHERENCE    does not function as one usable song
 * Sample size is honestly SMALL (6 human-labeled files across two blind
 * auditions); the usability floor 0.029 sits with only ~1.2x margin to the
 * nearest labeled points on each side — revisit as verdicts accumulate. */
const COHERENCE_CONTRACT = Object.freeze({
  concept: 'SOLID_SONG / DRAFT_MUSIC_USABLE / REJECT_COHERENCE',
  question: 'is this track usable enough as ONE song to judge the Draft video with?',
  usability_floors: {
    timbral_flow_p90_max: 0.029, // labeled gap: usable <= 0.024 / reject >= 0.0358
    degenerate_score_min: 2.5, // far below every human-usable observation (min 4.2)
    min_blocks: 4,
    truncated_fails: true,
  },
  solid: { min_score: 7.0, timbral_flow_p90_max: 0.015 },
  catastrophic: { timbral_flow_p90: 0.05, score_below: 1.5 },
  score_weights: { timbral_flow: 4, energy_continuity: 2, ending: 2, identity: 1, progression: 1 },
  score_role: 'RANKING quality signal + SOLID band + degenerate guard — NOT the usability gate (it does not separate the labeled classes: usable new-C scored 4.2 vs reject old-C 3.5)',
  advisory_only: ['tonal_context', 'recurrence', 'novelty', 'timbral_flow_max', 'timbral_flow_mean', 'interior_energy_jump_rate'],
  demoted_from_gate_2026_09_01: {
    timbral_flow_mean_max: 'overlaps labeled classes — punished human-usable dynamics',
    interior_energy_jump_rate_max: 'overlaps labeled classes — dynamics are not incoherence',
    min_score_as_usability: 'score ranks; it does not separate usable from reject',
  },
  calibration: 'outputs/claude-stable-audio-human-calibration-2026-09-01/COHERENCE-RECALIBRATION.json',

  /* ---- GATE V2: the lower side (2026-09-10) --------------------------------
   * A track that does not move on at least two of these three axes is not a
   * song, whatever its coherence numbers say. These floors are NOT a quality
   * judgement and are NOT calibrated against human verdicts: they separate
   * MUSIC from NON-MUSIC, which is a far easier question than usable-vs-reject
   * and needs no labels. Each floor sits below EVERY track ever measured -
   * including r2_bed, the most minimal human-approved bed in the corpus - and
   * far above the synthetic degenerate control.
   *
   * Measured 2026-09-10 over all 6 human-labeled tracks + 1 control + the
   * legacy r2 bed + 2 synthetic controls (see margins_observed below). Note
   * timbral flow is deliberately NOT a degeneracy axis: human-USE old_A sits at
   * tf_mean 0.0015, BELOW the synthetic music control at 0.0047, so legitimate
   * music can be extremely smooth. Spectral spread, dynamic range and
   * worst-case self-dissimilarity are what separate music from non-music. */
  development_floors: {
    band_profile_std_mean_min: 0.02,
    energy_range_db_min: 0.5,
    dissimilarity_max_min: 0.004,
    degenerate_when_axes_below_floor: 2, // of 3
  },
  development_margins_observed_2026_09_10: {
    band_profile_std_mean: { floor: 0.02, lowest_music: 0.0732, lowest_music_id: 'r2_bed (human USE)', margin: '3.7x', degenerate_control: 0.0001 },
    energy_range_db: { floor: 0.5, lowest_music: 1.4413, lowest_music_id: 'synthetic evolving control', lowest_labeled: 4.661, margin: '2.9x (9.3x to nearest labeled)', degenerate_control: 0.0004 },
    dissimilarity_max: { floor: 0.004, lowest_music: 0.0135, lowest_music_id: 'r2_bed (human USE)', margin: '3.4x', degenerate_control: 0.0 },
    note: 'all 10 measured music tracks clear ALL THREE floors; the degenerate control fails ALL THREE by 200-1250x. No labeled track is within 2.9x of any floor.',
  },
  development_role: 'DEGENERACY GATE ONLY - answers "did anything happen?", never "is this good?". It cannot rank and must never be read as a quality score.',
  development_advisory_uncalibrated: [
    'timbral_flow_p10', 'band_profile_std_max', 'energy_std_db', 'energy_trend_r',
    'event_density_mean', 'event_density_p90', 'event_density_std',
  ],
  v2_validation_status: 'GATE V2 IS NOT VALIDATED AGAINST HUMAN JUDGEMENT. It is proven only to (a) reject a categorically degenerate track and (b) not reject any of the 10 tracks measured on 2026-09-10. The corpus still holds 6 exact labels whose USE/REJECT split coincides exactly with Stable Audio vs MiniMax, so NO threshold here - old or new - has been shown to track musical quality on single-model output. Do not present a coherence class as a quality verdict until the calibration corpus carries real Stable Audio REJECTs.',
});

const CLASSES = Object.freeze(['SOLID_SONG', 'DRAFT_MUSIC_USABLE', 'REJECT_COHERENCE', 'NOT_ASSESSABLE']);

/* Pure three-state classifier — the calibration authority. Unit-testable
 * against the exact labeled measurements without decoding audio. */
function classifyCoherence({ timbralFlowP90, coherenceScore, endingClass, blockCount }) {
  const floors = COHERENCE_CONTRACT.usability_floors;
  if (!(blockCount >= floors.min_blocks)) {
    return { coherence_class: 'NOT_ASSESSABLE', draft_usable: false, solid_song: false, catastrophic: false, floor_failures: ['DRAFT_MUSIC_COHERENCE_TOO_SHORT_TO_ASSESS'] };
  }
  const floorFailures = [];
  if (timbralFlowP90 > floors.timbral_flow_p90_max) floorFailures.push('TIMBRAL_FLOW_P90');
  if (coherenceScore < floors.degenerate_score_min) floorFailures.push('DEGENERATE_SCORE');
  if (endingClass === 'TRUNCATED') floorFailures.push('ENDING_TRUNCATED');
  const catastrophic = timbralFlowP90 > COHERENCE_CONTRACT.catastrophic.timbral_flow_p90
    || coherenceScore < COHERENCE_CONTRACT.catastrophic.score_below;
  if (floorFailures.length) {
    return { coherence_class: 'REJECT_COHERENCE', draft_usable: false, solid_song: false, catastrophic, floor_failures: floorFailures };
  }
  const solid = coherenceScore >= COHERENCE_CONTRACT.solid.min_score
    && timbralFlowP90 <= COHERENCE_CONTRACT.solid.timbral_flow_p90_max;
  return {
    coherence_class: solid ? 'SOLID_SONG' : 'DRAFT_MUSIC_USABLE',
    draft_usable: true,
    solid_song: solid,
    catastrophic: false,
    floor_failures: [],
  };
}

/* THE ONE DOOR. coherenceReport must not compose the two classifiers itself:
 * a law enforced at the call site is a property of that call site, not of the
 * gate. Every coherence class for an assessable track is produced here, so a
 * track cannot acquire SOLID_SONG or draft_usable without clearing BOTH the
 * calibrated coherence floors and the falsifiable degeneracy floor.
 *
 * A degenerate track is REJECTED, not merely denied SOLID_SONG. The audit found
 * two distinct harms - the drone was classified SOLID_SONG, and it OUTRANKED
 * human-approved music. Only draft_usable:false fixes the second, because
 * rankCandidates sorts usable candidates above unusable ones unconditionally
 * and generateDraftMusic selects only from the usable tier. */
function classifyTrack({ timbralFlowP90, coherenceScore, endingClass, blockCount, development }) {
  const coherence = classifyCoherence({ timbralFlowP90, coherenceScore, endingClass, blockCount });
  if (coherence.coherence_class === 'NOT_ASSESSABLE') return { ...coherence, development_degenerate: false, development_axes_below_floor: [] };
  const dev = classifyDevelopment(development);
  if (!dev.development_degenerate) return { ...coherence, ...dev };
  return {
    coherence_class: 'REJECT_COHERENCE',
    draft_usable: false,
    solid_song: false,
    /* Degeneracy is NOT catastrophic: catastrophic triggers a targeted
     * regeneration retry, and a static output is a prompt/model problem that a
     * reworded coherence retry will not fix. Preserve whatever the calibrated
     * classifier concluded rather than inventing a retry. */
    catastrophic: coherence.catastrophic,
    floor_failures: [...coherence.floor_failures, 'DEVELOPMENT_DEGENERATE'],
    ...dev,
  };
}

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
  /* GATE V2 event density (ADVISORY, uncalibrated): positive spectral flux
   * across the 24 log bands between consecutive SECONDS, level-normalised.
   * Dense by construction - every second, not one 93 ms frame per 5 s window
   * as the qc feature proxy does - so a static track reads exactly 0. */
  const flux = [];
  for (let i = 1; i < perSecond.length; i += 1) {
    let positive = 0; let total = 0;
    for (let b = 0; b < BANDS; b += 1) {
      const delta = perSecond[i].bands[b] - perSecond[i - 1].bands[b];
      if (delta > 0) positive += delta;
      total += perSecond[i].bands[b];
    }
    flux.push(total > 0 ? positive / total : 0);
  }
  const sortedFlux = [...flux].sort((a, b) => a - b);
  const eventDensity = {
    advisory: true,
    mean: +mean(flux).toFixed(5),
    std: +std(flux).toFixed(5),
    p90: +(sortedFlux.length ? sortedFlux[Math.floor(0.9 * (sortedFlux.length - 1))] : 0).toFixed(5),
  };
  return { blocks, seconds: perSecond.length, event_density: eventDensity };
}

/* ── GATE V2: positive development measurement ───────────────────────────────
 * Every number here rises when the music DOES something. Three of them carry a
 * degeneracy floor (see COHERENCE_CONTRACT.development_floors); the rest are
 * recorded as uncalibrated candidate signals for the calibration mission and
 * gate nothing. This function decides nothing - classifyDevelopment does. */
function measureDevelopment(blocks, adjacent) {
  const n = blocks.length;
  const bandCount = blocks[0].bands.length;
  const bandStd = [];
  for (let b = 0; b < bandCount; b += 1) bandStd.push(std(blocks.map((block) => block.bands[b])));
  const rms = blocks.map((block) => block.rms_db);
  /* worst-case self-dissimilarity anywhere in the track: the single strongest
   * evidence that the piece is not one frozen frame repeated. */
  let dissimilarityMax = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = 1 - cosineSimilarity(blocks[i].bands, blocks[j].bands);
      if (d > dissimilarityMax) dissimilarityMax = d;
    }
  }
  /* energy trend (ADVISORY): correlation of level with time - does the track go
   * anywhere, as opposed to merely wobbling? */
  const times = blocks.map((_, index) => index);
  const mt = mean(times); const mr = mean(rms);
  let num = 0; let dt = 0; let dr = 0;
  for (let i = 0; i < n; i += 1) { num += (times[i] - mt) * (rms[i] - mr); dt += (times[i] - mt) ** 2; dr += (rms[i] - mr) ** 2; }
  const trend = dt > 0 && dr > 0 ? num / Math.sqrt(dt * dr) : 0;
  const sortedAdjacent = [...adjacent].sort((a, b) => a - b);
  return {
    /* --- degeneracy axes (these three gate) --- */
    band_profile_std_mean: +mean(bandStd).toFixed(5),
    energy_range_db: +(Math.max(...rms) - Math.min(...rms)).toFixed(4),
    dissimilarity_max: +dissimilarityMax.toFixed(5),
    /* --- uncalibrated candidate signals (these gate nothing) --- */
    advisory_uncalibrated: {
      band_profile_std_max: +Math.max(...bandStd).toFixed(5),
      energy_std_db: +std(rms).toFixed(4),
      energy_trend_r: +trend.toFixed(4),
      timbral_flow_p10: +(sortedAdjacent.length ? sortedAdjacent[Math.floor(0.1 * (sortedAdjacent.length - 1))] : 0).toFixed(5),
    },
  };
}

/* Pure degeneracy classifier - the falsifiable half of Gate V2. Independently
 * unit-testable against the 2026-09-10 measurement table without decoding
 * audio. It answers "did anything happen at all?" and nothing else. */
function classifyDevelopment(development) {
  const floors = COHERENCE_CONTRACT.development_floors;
  if (!development || typeof development !== 'object') {
    fail('DRAFT_MUSIC_COHERENCE_DEVELOPMENT_REQUIRED', 'Gate V2 requires a development measurement; a coherence class must never be derived without one');
  }
  const below = [];
  if (!(development.band_profile_std_mean >= floors.band_profile_std_mean_min)) below.push('BAND_PROFILE_STATIC');
  if (!(development.energy_range_db >= floors.energy_range_db_min)) below.push('ENERGY_STATIC');
  if (!(development.dissimilarity_max >= floors.dissimilarity_max_min)) below.push('SELF_IDENTICAL');
  return {
    development_degenerate: below.length >= floors.degenerate_when_axes_below_floor,
    development_axes_below_floor: below,
    development_axes_required: floors.degenerate_when_axes_below_floor,
  };
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
    development: measureDevelopment(blocks, adjacent),
  };
}

/* SOLID_SONG verdict for one generated track. `endingClass` comes from the
 * QC inspection (draft-music-qc classifyEnding). */
function coherenceReport(file, options = {}) {
  const endingClass = options.endingClass || 'ABRUPT_END';
  if (!qc.ENDINGS.includes(endingClass)) fail('DRAFT_MUSIC_COHERENCE_ENDING_INVALID', String(endingClass));
  const profile = options.profile || trackProfile(file);
  if (profile.blocks.length < COHERENCE_CONTRACT.usability_floors.min_blocks) {
    return {
      schema: SCHEMA, coherence_class: 'NOT_ASSESSABLE', draft_usable: false, solid_song: false, catastrophic: false,
      coherence_score: 0, metrics: { block_count: profile.blocks.length }, scores: null,
      floor_failures: ['DRAFT_MUSIC_COHERENCE_TOO_SHORT_TO_ASSESS'],
      development_degenerate: false, development_axes_below_floor: [],
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

  if (profile.event_density) metrics.event_density = profile.event_density;
  const classified = classifyTrack({
    timbralFlowP90: metrics.timbral_flow.adjacent_discontinuity_p90,
    coherenceScore,
    endingClass,
    blockCount: metrics.block_count,
    development: metrics.development,
  });
  return {
    schema: SCHEMA,
    ...classified,
    coherence_score: coherenceScore,
    scores,
    metrics,
    ending_class: endingClass,
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
  classifyCoherence, classifyDevelopment, classifyTrack, measureDevelopment,
  trackProfile, analyzeBlocks, coherenceReport, scriptFitScore, ENERGY_CURVE_TEMPLATES,
  cosineSimilarity, piecewise,
};
