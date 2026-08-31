'use strict';

/*
 * Draft music technical QC + structural/diversity diagnostics.
 *
 * Deterministic, dependency-free (ffmpeg/ffprobe + a small in-process FFT).
 * QC verdicts are technical facts; structural and diversity numbers are
 * DIAGNOSTICS for gates and ranking, never artistic truth.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const childProcess = require('node:child_process');

const ENDINGS = Object.freeze(['CLEAN_END', 'FADE_ACCEPTABLE', 'ABRUPT_END', 'TRUNCATED']);
const FEATURE_RATE = 22050;
const WINDOW_S = 5;
const FFT_SIZE = 2048;

class DraftMusicQcError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftMusicQcError'; this.code = code; }
}
function fail(code, message) { throw new DraftMusicQcError(code, message); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function ffprobe(file) {
  const out = childProcess.execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration,size', '-of', 'json', file],
  { encoding: 'utf8', timeout: 60000 });
  return JSON.parse(out);
}

function ffmpegStderr(args, timeout = 300000) {
  const result = childProcess.spawnSync('ffmpeg', ['-v', 'info', ...args], { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stderr: result.stderr || '' };
}

/* Decode to mono PCM float for feature analysis. */
function decodeMono(file) {
  const result = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(FEATURE_RATE), '-f', 's16le', '-'],
    { timeout: 300000, maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) fail('DRAFT_MUSIC_DECODE_FAILED', file);
  const raw = result.stdout;
  const samples = new Float32Array(Math.floor(raw.length / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = raw.readInt16LE(index * 2) / 32768;
  return samples;
}

/* Iterative radix-2 FFT magnitude spectrum (real input). */
function fftMagnitudes(frame) {
  const n = frame.length;
  const real = Float64Array.from(frame);
  const imag = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = real[i]; real[i] = real[j]; real[j] = tr; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle); const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curR = 1; let curI = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const evenR = real[i + k]; const evenI = imag[i + k];
        const oddR = real[i + k + len / 2] * curR - imag[i + k + len / 2] * curI;
        const oddI = real[i + k + len / 2] * curI + imag[i + k + len / 2] * curR;
        real[i + k] = evenR + oddR; imag[i + k] = evenI + oddI;
        real[i + k + len / 2] = evenR - oddR; imag[i + k + len / 2] = evenI - oddI;
        const nextR = curR * wr - curI * wi; curI = curR * wi + curI * wr; curR = nextR;
      }
    }
  }
  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) mags[i] = Math.hypot(real[i], imag[i]);
  return mags;
}

/* Windowed features: RMS, zero-crossing rate, spectral centroid, spectral
 * flux (onset-activity proxy). */
function windowedFeatures(samples) {
  const windowSamples = WINDOW_S * FEATURE_RATE;
  const windows = [];
  let previousSpectrum = null;
  for (let start = 0; start + windowSamples <= samples.length; start += windowSamples) {
    let sumSquares = 0; let crossings = 0;
    for (let i = start; i < start + windowSamples; i += 1) {
      sumSquares += samples[i] * samples[i];
      if (i > start && (samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings += 1;
    }
    const frame = samples.subarray(start + ((windowSamples - FFT_SIZE) >> 1), start + ((windowSamples - FFT_SIZE) >> 1) + FFT_SIZE);
    const spectrum = fftMagnitudes(frame);
    let weighted = 0; let total = 0; let flux = 0;
    for (let bin = 1; bin < spectrum.length; bin += 1) {
      weighted += bin * spectrum[bin]; total += spectrum[bin];
      if (previousSpectrum) { const d = spectrum[bin] - previousSpectrum[bin]; if (d > 0) flux += d; }
    }
    previousSpectrum = spectrum;
    windows.push({
      rms_db: 20 * Math.log10(Math.sqrt(sumSquares / windowSamples) + 1e-9),
      zcr: crossings / windowSamples,
      centroid_hz: total > 0 ? (weighted / total) * (FEATURE_RATE / FFT_SIZE) : 0,
      flux: total > 0 ? flux / total : 0,
    });
  }
  return windows;
}

function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function variance(values) { const m = mean(values); return mean(values.map((v) => (v - m) * (v - m))); }

function classifyEnding(windows, actualDurationS, requestedDurationS, tolerance) {
  if (actualDurationS < requestedDurationS - tolerance) return 'TRUNCATED';
  if (windows.length < 4) return 'TRUNCATED';
  const body = windows.slice(1, -2).map((w) => w.rms_db);
  const bodyLevel = median(body);
  const last = windows[windows.length - 1].rms_db;
  const secondLast = windows[windows.length - 2].rms_db;
  if (last <= bodyLevel - 12) return secondLast <= bodyLevel - 4 ? 'FADE_ACCEPTABLE' : 'CLEAN_END';
  if (last <= bodyLevel - 4) return 'CLEAN_END';
  return 'ABRUPT_END';
}

/* Structural development diagnostics: does the track move, or is it a static
 * 3-minute loop? */
function structureDiagnostics(windows) {
  const rms = windows.map((w) => w.rms_db);
  const centroid = windows.map((w) => w.centroid_hz);
  const flux = windows.map((w) => w.flux);
  const half = Math.floor(windows.length / 2);
  const sectionChanges = rms.slice(1).filter((value, index) => Math.abs(value - rms[index]) >= 3).length;
  return {
    window_s: WINDOW_S,
    window_count: windows.length,
    energy_range_db: +(Math.max(...rms) - Math.min(...rms)).toFixed(2),
    energy_std_db: +Math.sqrt(variance(rms)).toFixed(2),
    section_change_events: sectionChanges,
    spectral_development_hz: +Math.abs(mean(centroid.slice(half)) - mean(centroid.slice(0, half))).toFixed(1),
    onset_activity_mean: +mean(flux).toFixed(4),
    development_score: +Math.min(10, Math.sqrt(variance(rms)) * 1.5 + sectionChanges * 0.8).toFixed(2),
  };
}

/* §21/§22 technical QC for one generated track. */
function inspectTrack(file, options = {}) {
  const requested = Number(options.requestedDurationS) || 180;
  const tolerance = Number(options.durationToleranceS) || 15;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    return { ok: false, failures: ['DRAFT_MUSIC_FILE_MISSING_OR_EMPTY'] };
  }
  let probe;
  try { probe = ffprobe(file); } catch { return { ok: false, failures: ['DRAFT_MUSIC_UNREADABLE'] }; }
  const stream = probe.streams?.[0];
  const durationS = Number(probe.format?.duration);
  if (!stream || !Number.isFinite(durationS)) return { ok: false, failures: ['DRAFT_MUSIC_NO_AUDIO_STREAM'] };
  const decode = ffmpegStderr(['-i', file, '-f', 'null', '-']);
  const failures = [];
  if (decode.status !== 0) failures.push('DRAFT_MUSIC_DECODE_FAILED');
  const loudness = ffmpegStderr(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  // ebur128 logs a running I: per frame starting at -70; only the LAST match
  // (the summary block) is the integrated verdict.
  const lufsMatches = [...loudness.stderr.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)];
  const peakMatches = [...loudness.stderr.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/g)];
  const lufsMatch = lufsMatches.at(-1) || null;
  const peakMatch = peakMatches.at(-1) || null;
  const stats = ffmpegStderr(['-i', file, '-af', 'astats=measure_overall=Peak_level+Flat_factor:measure_perchannel=none', '-f', 'null', '-']);
  const samplePeakDb = Number(([...stats.stderr.matchAll(/Peak level dB:\s*(-?[\d.]+)/g)].at(-1) || [])[1]);
  const flatFactor = Number(([...stats.stderr.matchAll(/Flat factor:\s*([\d.]+)/g)].at(-1) || [])[1]);
  const silence = ffmpegStderr(['-i', file, '-af', 'silencedetect=noise=-50dB:d=2', '-f', 'null', '-']);
  const silentSpans = (silence.stderr.match(/silence_duration:\s*([\d.]+)/g) || [])
    .map((token) => Number(token.split(':')[1])).filter(Number.isFinite);
  const totalSilenceS = silentSpans.reduce((a, b) => a + b, 0);
  let samples = null; let windows = [];
  try { samples = decodeMono(file); windows = windowedFeatures(samples); } catch { failures.push('DRAFT_MUSIC_FEATURE_DECODE_FAILED'); }
  const integratedLufs = lufsMatch ? Number(lufsMatch[1]) : null;
  const truePeakDbfs = peakMatch ? Number(peakMatch[1]) : null;
  if (integratedLufs !== null && integratedLufs < -55) failures.push('DRAFT_MUSIC_SILENT');
  if (totalSilenceS > requested * 0.4) failures.push('DRAFT_MUSIC_MOSTLY_SILENT');
  // §19: only CATASTROPHIC clipping is a technical failure — sustained
  // flat-top saturation or gross intersample overs. A hot master (a few
  // full-scale samples, small dBTP overs) is recorded as a headroom warning:
  // the Draft mix chain (-14 dB music gain + limiter) absorbs it by design.
  const flatTopClipping = Number.isFinite(samplePeakDb) && samplePeakDb >= -0.01 && Number.isFinite(flatFactor) && flatFactor > 10;
  const grossOver = truePeakDbfs !== null && truePeakDbfs > 1.5;
  if (grossOver || flatTopClipping) failures.push('DRAFT_MUSIC_CLIPPING');
  const headroomWarning = !grossOver && !flatTopClipping && truePeakDbfs !== null && truePeakDbfs > 0.3;
  if (durationS < requested - tolerance) failures.push('DRAFT_MUSIC_TOO_SHORT');
  if (durationS > requested + tolerance * 2) failures.push('DRAFT_MUSIC_TOO_LONG');
  const ending = windows.length ? classifyEnding(windows, durationS, requested, tolerance) : 'TRUNCATED';
  if (ending === 'TRUNCATED') failures.push('DRAFT_MUSIC_TRUNCATED_ENDING');
  return {
    ok: failures.length === 0,
    failures,
    sha256: sha256File(file),
    size_bytes: fs.statSync(file).size,
    codec: stream.codec_name,
    sample_rate: Number(stream.sample_rate),
    channels: stream.channels,
    duration_s: +durationS.toFixed(2),
    requested_duration_s: requested,
    integrated_lufs: integratedLufs,
    true_peak_dbfs: truePeakDbfs,
    sample_peak_db: Number.isFinite(samplePeakDb) ? samplePeakDb : null,
    flat_factor: Number.isFinite(flatFactor) ? flatFactor : null,
    headroom_warning: headroomWarning,
    total_silence_s: +totalSilenceS.toFixed(2),
    full_decode: decode.status === 0 ? 'PASS' : 'FAIL',
    ending_class: ending,
    structure: windows.length ? structureDiagnostics(windows) : null,
    features: windows,
  };
}

/* Audio-level candidate distance (0..1): normalized differences over the
 * windowed RMS shape, spectral centroid profile, onset activity and dynamics.
 * DIAGNOSTIC: complements (never replaces) declared concept distance. */
function resample(series, n) {
  if (!series.length) return new Array(n).fill(0);
  return Array.from({ length: n }, (_, index) => series[Math.min(series.length - 1, Math.round((index * (series.length - 1)) / Math.max(1, n - 1)))]);
}
function correlation(a, b) {
  const ma = mean(a); const mb = mean(b);
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i += 1) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 1;
}
function audioDistance(inspectA, inspectB) {
  const fa = inspectA.features || []; const fb = inspectB.features || [];
  if (!fa.length || !fb.length) fail('DRAFT_MUSIC_FEATURES_REQUIRED', 'both tracks need feature windows');
  const n = 24;
  const rmsCorr = correlation(resample(fa.map((w) => w.rms_db), n), resample(fb.map((w) => w.rms_db), n));
  const centroidA = mean(fa.map((w) => w.centroid_hz)); const centroidB = mean(fb.map((w) => w.centroid_hz));
  const fluxA = mean(fa.map((w) => w.flux)); const fluxB = mean(fb.map((w) => w.flux));
  const zcrA = mean(fa.map((w) => w.zcr)); const zcrB = mean(fb.map((w) => w.zcr));
  const dynA = Math.sqrt(variance(fa.map((w) => w.rms_db))); const dynB = Math.sqrt(variance(fb.map((w) => w.rms_db)));
  const centroidDiff = Math.min(1, Math.abs(centroidA - centroidB) / 1500);
  const fluxDiff = Math.min(1, Math.abs(fluxA - fluxB) / 0.15);
  const zcrDiff = Math.min(1, Math.abs(zcrA - zcrB) / 0.08);
  const dynDiff = Math.min(1, Math.abs(dynA - dynB) / 6);
  const shapeDiff = Math.min(1, Math.max(0, (1 - rmsCorr) / 1.2));
  const distance = +(0.3 * centroidDiff + 0.2 * fluxDiff + 0.15 * zcrDiff + 0.15 * dynDiff + 0.2 * shapeDiff).toFixed(4);
  return { distance, components: { centroid_diff: +centroidDiff.toFixed(4), flux_diff: +fluxDiff.toFixed(4), zcr_diff: +zcrDiff.toFixed(4), dynamics_diff: +dynDiff.toFixed(4), energy_shape_diff: +shapeDiff.toFixed(4), rms_correlation: +rmsCorr.toFixed(4) } };
}

module.exports = {
  ENDINGS, WINDOW_S, DraftMusicQcError, sha256File,
  decodeMono, windowedFeatures, classifyEnding, structureDiagnostics,
  inspectTrack, audioDistance, fftMagnitudes,
};
