'use strict';

/*
 * Draft music human audition verdict — canonical quality authority.
 *
 * Mikko's blind listening verdict OUTRANKS the machine ranking. This module
 * registers a verdict durably next to the audition/package it judges, binds
 * it to the exact track bytes, and computes machine/human alignment. The
 * historical machine ranking is PRESERVED as-is (never rewritten to agree);
 * the verdict record is immutable once registered.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'vidtoolz.draftMusicHumanVerdict.v1';
const VERDICT_FILE = 'draft-music-human-verdict.json';
const VERDICTS = Object.freeze(['USE', 'REJECT_COHERENCE', 'REJECT_QUALITY', 'REJECT_FIT', 'REJECT_OTHER']);

class DraftMusicHumanVerdictError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftMusicHumanVerdictError'; this.code = code; }
}
function fail(code, message) { throw new DraftMusicHumanVerdictError(code, message); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/* Slot → provenance from a Draft music package (v1 or v2 shape). */
function trackProvenance(pkg) {
  const bySlot = {};
  for (const candidate of pkg.candidates || []) {
    bySlot[candidate.candidate_slot] = {
      candidate_id: candidate.candidate_id,
      model: candidate.model,
      output_sha256: candidate.output_sha256,
    };
  }
  return bySlot;
}

/*
 * Register a human blind-audition verdict for a completed Draft music run.
 *   outRoot: the run's output root (holds draft-music-package.json).
 *   input: {
 *     decided_at, authority, source (how the verdict reached the system),
 *     verbatim_comments?: { <label>: 'exact human words' },
 *     tracks: { A: { verdict, solid_song?, quality_10?, fit_10?, interest_10? }, ... },
 *     human_ranking?: ['A','C','B'],
 *   }
 * Immutable: a second registration must be byte-identical or it fails.
 */
function registerHumanVerdict(outRoot, input, options = {}) {
  const packagePath = path.join(outRoot, 'draft-music-package.json');
  if (!fs.existsSync(packagePath)) fail('DRAFT_MUSIC_VERDICT_PACKAGE_MISSING', packagePath);
  const pkg = readJson(packagePath);
  const provenance = trackProvenance(pkg);
  if (!input || typeof input !== 'object') fail('DRAFT_MUSIC_VERDICT_INVALID', 'verdict input required');
  if (!input.authority || typeof input.authority !== 'string') fail('DRAFT_MUSIC_VERDICT_INVALID', 'authority (the human) is required');
  if (!input.decided_at || Number.isNaN(Date.parse(input.decided_at))) fail('DRAFT_MUSIC_VERDICT_INVALID', 'decided_at ISO timestamp required');
  const labels = Object.keys(input.tracks || {}).sort();
  if (!labels.length) fail('DRAFT_MUSIC_VERDICT_INVALID', 'at least one track verdict required');
  const tracks = {};
  for (const label of labels) {
    if (!provenance[label]) fail('DRAFT_MUSIC_VERDICT_UNKNOWN_LABEL', label);
    const entry = input.tracks[label];
    if (!VERDICTS.includes(entry?.verdict)) fail('DRAFT_MUSIC_VERDICT_INVALID', `${label}: verdict must be one of ${VERDICTS.join('|')}`);
    for (const field of ['quality_10', 'fit_10', 'interest_10']) {
      if (entry[field] !== undefined && !(Number.isFinite(entry[field]) && entry[field] >= 0 && entry[field] <= 10)) {
        fail('DRAFT_MUSIC_VERDICT_INVALID', `${label}.${field}: 0-10`);
      }
    }
    tracks[label] = {
      verdict: entry.verdict,
      solid_song: entry.solid_song ?? (entry.verdict === 'USE' ? true : entry.verdict === 'REJECT_COHERENCE' ? false : null),
      quality_10: entry.quality_10 ?? null,
      fit_10: entry.fit_10 ?? null,
      interest_10: entry.interest_10 ?? null,
      ...provenance[label],
    };
  }
  if (input.human_ranking) {
    if (!Array.isArray(input.human_ranking) || input.human_ranking.some((label) => !provenance[label])) {
      fail('DRAFT_MUSIC_VERDICT_INVALID', 'human_ranking must list known labels');
    }
  }
  const machineLabel = pkg.recommended_candidate
    ? (pkg.candidates.find((candidate) => candidate.candidate_id === pkg.recommended_candidate)?.candidate_slot ?? null)
    : null;
  const core = {
    schema: SCHEMA,
    package_digest_sha256: pkg.package_digest_sha256,
    run_id: pkg.run_id,
    authority: input.authority,
    authority_type: 'HUMAN',
    decided_at: input.decided_at,
    source: input.source || null,
    verbatim_comments: input.verbatim_comments || null,
    tracks,
    human_ranking: input.human_ranking || null,
    machine_recommended_label: machineLabel,
    machine_ranking_preserved: pkg.ranking,
    alignment: alignment(machineLabel, tracks, pkg, input.human_ranking || null),
    verdict_outranks_machine: true,
  };
  const record = { ...core, verdict_digest_sha256: digest(core) };
  const file = path.join(outRoot, VERDICT_FILE);
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('DRAFT_MUSIC_VERDICT_IMMUTABLE', `${file} already holds a different human verdict — human verdicts are never rewritten`);
    return { registered: false, record, path: file };
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  /* Corpus accumulation is an EXPLICIT act, never a side effect of registering
   * a verdict. The first cut appended by default, and the existing verdict
   * tests - which register synthetic verdicts under the authority string
   * 'Mikko Pakkala' - immediately wrote seven fabricated entries into the
   * repository's real dataset. A calibration corpus polluted with test rows
   * attributed to a real person is worse than no corpus at all, so the caller
   * must ask. */
  const corpus = (options.corpus === true || options.corpusFile)
    ? appendCalibrationCorpus(record, pkg, options)
    : { appended: 0, ok: true, skipped: 'CORPUS_APPEND_NOT_REQUESTED' };
  return { registered: true, record, path: file, corpus };
}

/* ── the durable calibration corpus ──────────────────────────────────────────
 * A per-run verdict answered "which bed does this video use". It did NOT
 * accumulate: the labelled corpus that every coherence threshold rests on is a
 * hand-built file in outputs/, still holding six labels whose USE/REJECT split
 * coincides exactly with Stable Audio vs MiniMax. Nothing grew it from use, so
 * it would have stayed at six forever.
 *
 * This appends one line PER TRACK to an append-only JSONL dataset, keyed by the
 * track's own sha256, so future calibration has real single-model positives AND
 * negatives to work from.
 *
 * It deliberately does NOT retune anything. Gate V2 stays the anti-degeneracy
 * layer and reads none of this; quality calibration is a separate system that
 * does not exist yet. Appending is best-effort: a corpus write must never cost
 * Mikko a registered verdict, so a failure here is reported, not thrown. */
const CORPUS_FILE = path.join('data', 'music-human-verdict-corpus.jsonl');
const CORPUS_SCHEMA = 'vidtoolz.musicHumanVerdictCorpusEntry.v1';

function corpusPath(options = {}) {
  return options.corpusFile
    ? path.resolve(options.corpusFile)
    : path.join(path.resolve(__dirname, '..'), CORPUS_FILE);
}

function corpusEntriesFor(record, pkg) {
  const bySlot = new Map((pkg.candidates || []).map((candidate) => [candidate.candidate_slot, candidate]));
  return Object.keys(record.tracks).sort().map((label) => {
    const track = record.tracks[label];
    const candidate = bySlot.get(label) || {};
    const coherence = candidate.coherence || {};
    const development = coherence.metrics ? coherence.metrics.development || null : null;
    return {
      schema: CORPUS_SCHEMA,
      /* identity: the bytes, not the slot - a slot is reused every run */
      track_sha256: track.output_sha256 || null,
      run_id: record.run_id,
      candidate_slot: label,
      candidate_id: track.candidate_id || null,
      decided_at: record.decided_at,
      authority: record.authority,
      /* the human decision */
      human_verdict: track.verdict,
      human_solid_song: track.solid_song,
      human_quality_10: track.quality_10,
      human_fit_10: track.fit_10,
      human_interest_10: track.interest_10,
      human_rank: Array.isArray(record.human_ranking) && record.human_ranking.includes(label)
        ? record.human_ranking.indexOf(label) + 1 : null,
      verbatim: record.verbatim_comments ? record.verbatim_comments[label] || null : null,
      /* generation configuration - what produced these bytes */
      model: candidate.model || null,
      model_contract: candidate.model_contract || null,
      concept_label: candidate.concept_label || null,
      prompt_sha256: candidate.prompt_sha256 || null,
      seed: candidate.seed === undefined ? null : candidate.seed,
      requested_duration_s: candidate.qc ? candidate.qc.requested_duration_s : null,
      /* measurements at the time of judgement */
      measured_duration_s: candidate.qc ? candidate.qc.duration_s : null,
      integrated_lufs: candidate.qc ? candidate.qc.integrated_lufs : null,
      true_peak_dbfs: candidate.qc ? candidate.qc.true_peak_dbfs : null,
      ending_class: candidate.qc ? candidate.qc.ending_class : null,
      coherence_class: coherence.coherence_class || null,
      coherence_score: coherence.coherence_score === undefined ? null : coherence.coherence_score,
      development_degenerate: coherence.development_degenerate === true,
      gate_v2_development: development,
      /* provenance of the judgement itself */
      package_digest_sha256: record.package_digest_sha256,
      verdict_digest_sha256: record.verdict_digest_sha256,
      corpus_note: 'append-only observation; NOT an input to Gate V2, which is an anti-degeneracy gate and is never retuned from this dataset',
    };
  });
}

function appendCalibrationCorpus(record, pkg, options = {}) {
  const file = corpusPath(options);
  try {
    const entries = corpusEntriesFor(record, pkg);
    /* append-only and idempotent: a re-registration of the same verdict must
     * not double-count a track. Keyed by (verdict digest, track sha). */
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const seen = new Set(existing.split('\n').filter(Boolean).map((line) => {
      try { const parsed = JSON.parse(line); return `${parsed.verdict_digest_sha256}:${parsed.track_sha256}`; } catch (_) { return ''; }
    }));
    const fresh = entries.filter((entry) => !seen.has(`${entry.verdict_digest_sha256}:${entry.track_sha256}`));
    if (!fresh.length) return { file, appended: 0, total_entries: seen.size, ok: true };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${fresh.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    return { file, appended: fresh.length, total_entries: seen.size + fresh.length, ok: true };
  } catch (error) {
    return { file, appended: 0, ok: false, error: error.message };
  }
}

function readCalibrationCorpus(options = {}) {
  const file = corpusPath(options);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/* HUMAN_RANKING_ALIGNMENT: how the machine ranking relates to the human
 * verdict — deliberately NOT one number. Components:
 *   top_1: did the machine's pick land inside the human USE set?
 *   usable_reject_agreement: per label, machine usable-gate vs human USE.
 *   pairwise_ranking_agreement: of the human ranking's ordered pairs, how
 *     many does the machine ranking order preserve?
 * MISS entries are the calibration debt of the ranking system. */
function alignment(machineLabel, tracks, pkg = null, humanRanking = null) {
  const humanUsable = Object.keys(tracks).filter((label) => tracks[label].verdict === 'USE').sort();
  const top1 = machineLabel === null ? 'NO_MACHINE_PICK'
    : humanUsable.includes(machineLabel) ? 'MATCH' : 'MISS';
  const result = { metric: 'HUMAN_RANKING_ALIGNMENT', machine_recommended_label: machineLabel, human_usable_labels: humanUsable, verdict: top1, top_1: top1 };
  if (pkg && Array.isArray(pkg.ranking)) {
    const machineUsableBySlot = Object.fromEntries(pkg.ranking.map((entry) => [entry.slot, entry.usable === true]));
    const detail = {};
    let agree = 0; let total = 0;
    for (const label of Object.keys(tracks).sort()) {
      if (!(label in machineUsableBySlot)) continue;
      const humanUse = tracks[label].verdict === 'USE';
      const machineUse = machineUsableBySlot[label];
      detail[label] = { human: humanUse ? 'USE' : 'REJECT', machine: machineUse ? 'USABLE' : 'UNUSABLE', agree: humanUse === machineUse };
      total += 1; if (humanUse === machineUse) agree += 1;
    }
    result.usable_reject_agreement = { agree, total, fraction: total ? +(agree / total).toFixed(3) : null, detail };
    if (Array.isArray(humanRanking) && humanRanking.length >= 2) {
      const machineOrder = pkg.ranking.map((entry) => entry.slot);
      let pairAgree = 0; let pairTotal = 0;
      for (let i = 0; i < humanRanking.length; i += 1) {
        for (let j = i + 1; j < humanRanking.length; j += 1) {
          const a = machineOrder.indexOf(humanRanking[i]); const b = machineOrder.indexOf(humanRanking[j]);
          if (a < 0 || b < 0) continue;
          pairTotal += 1; if (a < b) pairAgree += 1;
        }
      }
      result.pairwise_ranking_agreement = { agree: pairAgree, total: pairTotal, fraction: pairTotal ? +(pairAgree / pairTotal).toFixed(3) : null };
    }
  }
  return result;
}

function loadHumanVerdict(outRoot) {
  const file = path.join(outRoot, VERDICT_FILE);
  if (!fs.existsSync(file)) return null;
  const record = readJson(file);
  verifyHumanVerdict(record);
  return record;
}

function verifyHumanVerdict(record) {
  if (record?.schema !== SCHEMA) fail('DRAFT_MUSIC_VERDICT_INVALID', 'schema mismatch');
  const core = { ...record }; delete core.verdict_digest_sha256;
  if (digest(core) !== record.verdict_digest_sha256) fail('DRAFT_MUSIC_VERDICT_TAMPERED', 'digest mismatch');
  if (record.verdict_outranks_machine !== true) fail('DRAFT_MUSIC_VERDICT_INVALID', 'human verdict must outrank machine ranking');
  return true;
}

/* Effective selection under human authority: the machine recommendation is
 * provisional; once a verdict exists the human USE set decides. */
function effectiveSelection(pkg, verdictRecord) {
  if (!verdictRecord) {
    return {
      source: 'MACHINE_PROVISIONAL',
      selected_label: pkg.recommended_candidate
        ? pkg.candidates.find((candidate) => candidate.candidate_id === pkg.recommended_candidate)?.candidate_slot ?? null
        : null,
      note: 'no human verdict registered yet; machine recommendation is provisional',
    };
  }
  verifyHumanVerdict(verdictRecord);
  const usable = (verdictRecord.human_ranking || Object.keys(verdictRecord.tracks).sort())
    .filter((label) => verdictRecord.tracks[label]?.verdict === 'USE');
  if (!usable.length) return { source: 'HUMAN', selected_label: null, state: 'NO_HUMAN_USABLE_DRAFT_MUSIC' };
  return { source: 'HUMAN', selected_label: usable[0], state: 'HUMAN_SELECTED' };
}

module.exports = {
  SCHEMA, VERDICT_FILE, VERDICTS, DraftMusicHumanVerdictError,
  registerHumanVerdict, loadHumanVerdict, verifyHumanVerdict, effectiveSelection, alignment, trackProvenance, digest,
  CORPUS_FILE, CORPUS_SCHEMA, corpusPath, corpusEntriesFor, appendCalibrationCorpus, readCalibrationCorpus,
};
