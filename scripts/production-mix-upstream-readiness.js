'use strict';

/*
 * production-mix-upstream-readiness.js
 *
 * Deterministic upstream-material auditor for PRODUCTION_MIX.
 *
 * The PRODUCTION_MIX producer path is closed (producer = editor, attester =
 * scripts/production-mix-evidence.js, render_class = PRODUCTION_MIX). What
 * this module answers is the NEXT question:
 *
 *   Does the Editor actually have the authoritative material to mix?
 *
 * It creates nothing, renders nothing, scans no directories. It consumes
 * EXPLICIT artifact references and reports, in dependency order, which
 * canonical program-audio inputs are missing — each with a typed block,
 * the rightful owner, the lifecycle gate where it becomes legitimate, and
 * the expected artifact shape.
 *
 * Upstream block taxonomy (dependency order — earliest root first):
 *
 *   REAL_PRESENTER_AUDIO_MISSING
 *     Production requires real presenter performance (production-mode
 *     doctrine). No synthetic narration, no proxy presenter may substitute.
 *     Owner: capture lane, exercised by Mikko. Gate: capture-evidence.
 *
 *   EDIT_PLAN_MISSING
 *     All sources may exist, but without a canonical Edit Plan V1 there is
 *     no timeline authority telling the Editor how to combine them.
 *     Owner: editor. Gate: after capture, before rough-cut-review.
 *
 *   MUSIC_RUN_BINDING_MISSING
 *     Scorecraft candidates exist and the two-step human gate selects them,
 *     but a package run needs an explicit binding of ONE selected candidate
 *     as its program music. Owner: sound_music_director + human Scorecraft
 *     verdict. Gate: rough-cut assembly.
 *
 *   PROGRAM_RENDER_MISSING
 *     With sources and timeline present, the renderer (DaVinci Resolve,
 *     external) must still produce the actual program audio bytes.
 *     Owner: DaVinci Resolve. Gate: rough-cut-review.
 *
 * EFFECTS is OPTIONAL: explicit absence (NOT_USED) never blocks.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;

/* Source-class requirements for a complete Production program mix.
 * Derived from the live edit-plan contract (presenter_sources /
 * sound_sources / timeline) — no invented requirements. */
const SOURCE_CLASSES = Object.freeze({
  presenter: Object.freeze({ required: true, reason: 'PRODUCTION requires real presenter performance' }),
  music: Object.freeze({ required: true, reason: 'program music selected for the edit' }),
  effects: Object.freeze({ required: false, reason: 'optional; explicit NOT_USED never blocks' }),
});

const UPSTREAM_BLOCKS = Object.freeze([
  Object.freeze({
    block: 'REAL_PRESENTER_AUDIO_MISSING',
    owner: 'capture lane (Mikko real performance)',
    lifecycle_gate: 'capture-evidence',
    artifact_expected: 'presenter take manifest: take with recording_unit_id, media sha256, fidelity record',
    source_class: 'presenter',
  }),
  Object.freeze({
    block: 'EDIT_PLAN_MISSING',
    owner: 'editor',
    lifecycle_gate: 'rough-cut assembly (after capture, before rough-cut-review)',
    artifact_expected: 'Edit Plan V1: presenter_sources + sound_sources + timeline with digest',
    source_class: null,
  }),
  Object.freeze({
    block: 'MUSIC_RUN_BINDING_MISSING',
    owner: 'sound_music_director + human Scorecraft two-step verdict',
    lifecycle_gate: 'rough-cut assembly',
    artifact_expected: 'selected music binding: candidate_id + production.wav sha256 (human_verdict use)',
    source_class: 'music',
  }),
  Object.freeze({
    block: 'PROGRAM_RENDER_MISSING',
    owner: 'DaVinci Resolve (external renderer)',
    lifecycle_gate: 'rough-cut-review',
    artifact_expected: 'program audio bytes (complete mix) bound to the edit plan identity',
    source_class: null,
  }),
]);

const OPTIONAL_ABSENT = Object.freeze({
  effects: 'NOT_USED',
});

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(block, detail) {
  const err = new Error(`${block}: ${detail}`);
  err.code = block;
  throw err;
}

/* ── per-input validators ─────────────────────────────────────────────── */

function checkPresenterTakes(ref) {
  if (!ref) return { ok: false, block: 'REAL_PRESENTER_AUDIO_MISSING', detail: 'no presenter take manifest reference supplied' };
  const file = ref.manifest_path;
  if (!file || !fs.existsSync(file)) return { ok: false, block: 'REAL_PRESENTER_AUDIO_MISSING', detail: 'presenter take manifest file missing' };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { ok: false, block: 'REAL_PRESENTER_AUDIO_MISSING', detail: 'presenter take manifest unreadable' }; }
  const takes = Array.isArray(manifest.takes) ? manifest.takes : [];
  if (!takes.length) return { ok: false, block: 'REAL_PRESENTER_AUDIO_MISSING', detail: 'presenter take manifest contains no takes' };
  for (const take of takes) {
    if (!take.media || !take.media.sha256) return { ok: false, block: 'REAL_PRESENTER_AUDIO_MISSING', detail: 'presenter take lacks bound media sha256' };
    if (take.fidelity_record && ['UNREVIEWED', 'HUMAN_VERIFIED_REQUIRED'].includes(take.fidelity_record.classification)) {
      return { ok: false, block: 'REAL_PRESENTER_AUDIO_MISSING', detail: 'presenter take fidelity unresolved' };
    }
    if (take.origin === 'DRAFT_SYNTHETIC_NARRATION' || take.origin === 'PROXY_PRESENTER' || take.proxy === true) {
      fail('PROGRAM_MIX_PRESENTER_SOURCE_PROXY_FORBIDDEN',
        'Draft synthetic narration / proxy presenter can never satisfy a Production presenter source');
    }
  }
  return { ok: true, takes: takes.length };
}

function checkEditPlan(ref) {
  if (!ref) return { ok: false, block: 'EDIT_PLAN_MISSING', detail: 'no edit plan reference supplied' };
  const file = ref.path;
  if (!file || !fs.existsSync(file)) return { ok: false, block: 'EDIT_PLAN_MISSING', detail: 'edit plan file missing' };
  let plan;
  try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { ok: false, block: 'EDIT_PLAN_MISSING', detail: 'edit plan unreadable' }; }
  if (!plan.edit_plan_id || !plan.edit_plan_digest_sha256) return { ok: false, block: 'EDIT_PLAN_MISSING', detail: 'edit plan lacks identity/digest' };
  if (!Array.isArray(plan.presenter_sources) || !plan.presenter_sources.length) return { ok: false, block: 'EDIT_PLAN_MISSING', detail: 'edit plan has no presenter_sources' };
  if (!plan.timeline || !plan.timeline.expected_duration_frames) return { ok: false, block: 'EDIT_PLAN_MISSING', detail: 'edit plan timeline lacks expected duration' };
  return { ok: true, edit_plan_id: plan.edit_plan_id, digest: plan.edit_plan_digest_sha256 };
}

function checkMusicBinding(ref) {
  if (!ref) return { ok: false, block: 'MUSIC_RUN_BINDING_MISSING', detail: 'no music binding reference supplied' };
  const binding = ref.binding || {};
  if (!binding.candidate_id || !binding.production_wav_sha256) {
    return { ok: false, block: 'MUSIC_RUN_BINDING_MISSING', detail: 'music binding lacks candidate_id or production.wav sha256' };
  }
  // Bind against the exact Scorecraft candidate record — never an arbitrary file.
  if (ref.candidate_record_path) {
    if (!fs.existsSync(ref.candidate_record_path)) return { ok: false, block: 'MUSIC_RUN_BINDING_MISSING', detail: 'candidate record missing' };
    let rec;
    try { rec = JSON.parse(fs.readFileSync(ref.candidate_record_path, 'utf8')); }
    catch { return { ok: false, block: 'MUSIC_RUN_BINDING_MISSING', detail: 'candidate record unreadable' }; }
    if (rec.candidate_id !== binding.candidate_id) return { ok: false, block: 'MUSIC_RUN_BINDING_MISSING', detail: 'binding candidate_id does not match candidate record' };
    if (rec.meta && rec.meta.human_verdict !== 'use') return { ok: false, block: 'MUSIC_RUN_BINDING_MISSING', detail: 'candidate lacks human verdict use (Scorecraft two-step gate)' };
    if (ref.production_wav_path) {
      if (!fs.existsSync(ref.production_wav_path)) return { ok: false, block: 'MUSIC_RUN_BINDING_MISSING', detail: 'bound production.wav missing' };
      const live = sha256File(ref.production_wav_path);
      if (live !== binding.production_wav_sha256) return { ok: false, block: 'MUSIC_RUN_BINDING_MISSING', detail: 'bound production.wav hash mismatch' };
    }
  }
  return { ok: true, candidate_id: binding.candidate_id };
}

function checkRenderOutput(ref) {
  if (!ref) return { ok: false, block: 'PROGRAM_RENDER_MISSING', detail: 'no program render reference supplied' };
  const file = ref.audio_path;
  if (!file || !fs.existsSync(file)) return { ok: false, block: 'PROGRAM_RENDER_MISSING', detail: 'program audio bytes missing' };
  const bytes = fs.statSync(file).size;
  if (!bytes) return { ok: false, block: 'PROGRAM_RENDER_MISSING', detail: 'program audio is zero bytes' };
  return { ok: true, sha256: sha256File(file), byte_size: bytes };
}

/* ── the audit ────────────────────────────────────────────────────────── */

/**
 * Audit upstream material readiness for a PRODUCTION program mix.
 *
 * @param {object} refs explicit artifact references (never directory scans):
 *   { presenterTakes, editPlan, musicBinding, renderOutput }
 * @returns deterministic readiness report: ordered blockers with owners.
 */
function auditUpstreamMaterial(refs = {}) {
  const blockers = [];
  const satisfied = [];
  const optionalAbsent = [];

  const presenter = checkPresenterTakes(refs.presenterTakes);
  if (presenter.ok) satisfied.push('presenter');
  else blockers.push({ ...UPSTREAM_BLOCKS[0], detail: presenter.detail });

  const plan = checkEditPlan(refs.editPlan);
  if (plan.ok) satisfied.push('edit_plan');
  else blockers.push({ ...UPSTREAM_BLOCKS[1], detail: plan.detail });

  const music = checkMusicBinding(refs.musicBinding);
  if (music.ok) satisfied.push('music');
  else blockers.push({ ...UPSTREAM_BLOCKS[2], detail: music.detail });

  // Effects: optional — explicit absence is a valid state, never a blocker.
  if (refs.effects && refs.effects.used === true) {
    if (!Array.isArray(refs.effects.sources) || !refs.effects.sources.length) {
      blockers.push({
        block: 'EFFECTS_SOURCES_INCOMPLETE', owner: 'editor', lifecycle_gate: 'rough-cut assembly',
        artifact_expected: 'declared effect sources with sha256', source_class: 'effects',
        detail: 'effects declared used but no bound sources',
      });
    } else satisfied.push('effects');
  } else {
    optionalAbsent.push({ source_class: 'effects', state: OPTIONAL_ABSENT.effects });
  }

  const render = checkRenderOutput(refs.renderOutput);
  if (render.ok) satisfied.push('render_output');
  else blockers.push({ ...UPSTREAM_BLOCKS[3], detail: render.detail });

  const next = blockers[0] || null;
  return {
    schema_version: SCHEMA_VERSION,
    ready: blockers.length === 0,
    blockers,
    next_blocker: next ? next.block : null,
    next_owner: next ? next.owner : null,
    next_gate: next ? next.lifecycle_gate : null,
    satisfied,
    optional_absent: optionalAbsent,
    source_classes: SOURCE_CLASSES,
  };
}

module.exports = {
  SCHEMA_VERSION, SOURCE_CLASSES, UPSTREAM_BLOCKS, OPTIONAL_ABSENT,
  auditUpstreamMaterial,
  checkPresenterTakes, checkEditPlan, checkMusicBinding, checkRenderOutput,
};
