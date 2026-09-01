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
function registerHumanVerdict(outRoot, input) {
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
  return { registered: true, record, path: file };
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
};
