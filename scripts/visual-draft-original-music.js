'use strict';

/*
 * ORIGINAL_DRAFT_MUSIC for V2 VISUAL_DRAFT — the smallest orchestration over
 * the existing canonical route (doctrine music rule):
 *
 *   score-lane.createScoreProject  (duration + script + tone binding)
 *     -> generateCuesForProject    (rule-based cue sheet)
 *     -> approveCueSheet           (autonomous for DRAFT visual-draft scores;
 *                                   authority basis below)
 *     -> music-dispatch            (MusicRenderBrief v1 -> MiniMax Music 3)
 *
 * No parallel music system, no new architecture (MUSIC-PIPELINE-AUDIT).
 *
 * Authority note: the cue-sheet approval flag is a lane-level editorial step.
 * For DRAFT visual-draft music the human decision already exists — Mikko's
 * approved V2 contract (doctrine music: music_theory_questions_to_human =
 * false, autonomy target 0) — so this module approves the DRAFT cue sheet
 * itself and records that basis in provenance. The production Scorecraft
 * lane and sound-music-director keep their human-approval behavior untouched.
 *
 * Duration authority: the requested duration MUST be the final paused
 * narration duration. Deriving it from anything else fails closed.
 *
 * Fallback: placeholder music stays legal but is DRAFT_MUSIC_PLACEHOLDER with
 * ORIGINAL_MUSIC_REQUIREMENT = DEGRADED_NOT_MET — never a quiet success.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const doctrineModule = require('./visual-draft-doctrine.js');

const MANIFEST_SCHEMA = 'vidtoolz.visualDraftMusic.v1';
const ORIGINAL = 'ORIGINAL_DRAFT_MUSIC';
const PLACEHOLDER = 'DRAFT_MUSIC_PLACEHOLDER';
const APPROVAL_BASIS = 'AUTONOMOUS_DRAFT_CUE_APPROVAL under human doctrine VISUAL_DRAFT_PRODUCTION_DOCTRINE v1 (Mikko Pakkala, 2026-08-30): draft music direction is autonomous; no music-theory questions to the human';

class DraftMusicError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftMusicError';
    this.code = code;
  }
}
function fail(code, message) { throw new DraftMusicError(code, message); }

function lazyLane() { return require('../score-engine/score-lane.js'); }
function lazyDispatch() { return require('../score-engine/music-dispatch.js'); }

/* The one legal duration source: the measured final paused narration. */
function assertDurationFromTimingAuthority(pausedManifest, requestedSeconds) {
  if (pausedManifest?.schema !== 'vidtoolz.finalPausedNarration.v1') fail('MUSIC_TIMING_AUTHORITY_REQUIRED', 'final paused narration manifest required');
  if (!(typeof requestedSeconds === 'number' && requestedSeconds > 0)) fail('MUSIC_DURATION_INVALID', String(requestedSeconds));
  if (Math.abs(requestedSeconds - pausedManifest.final_duration_seconds) > 0.001) {
    fail('MUSIC_DURATION_NOT_FROM_TIMING_AUTHORITY', `requested ${requestedSeconds}s but the final paused narration is ${pausedManifest.final_duration_seconds}s — music binds to the paused timeline, never the pre-pause duration`);
  }
  return true;
}

/* Deterministic plain-language music direction from script + creative tone. */
function deriveMusicDirection({ creativeTone } = {}) {
  const mood = { CALM: 'warm', ENERGETIC: 'urgent', INVESTIGATIVE: 'tense', REFLECTIVE: 'melancholy' }[creativeTone] || 'curious';
  return { overall_mood: mood, music_role: 'underscore', dialogue_density: 'high' };
}

/*
 * Create + cue + approve + export one duration-bound draft score project.
 * Returns { project_id, brief, requested_duration_s }.
 */
function planOriginalDraftMusic({ name, scriptText, pausedManifest, creativeTone, seed }, options = {}) {
  const doctrine = options.doctrineRules || doctrineModule.activeDoctrine(options).rules.music;
  if (doctrine.normal !== ORIGINAL) fail('MUSIC_DOCTRINE_INVALID', 'doctrine no longer names ORIGINAL_DRAFT_MUSIC as the normal path');
  const requestedSeconds = pausedManifest?.final_duration_seconds;
  assertDurationFromTimingAuthority(pausedManifest, requestedSeconds);
  if (typeof scriptText !== 'string' || scriptText.trim().length < 20) fail('MUSIC_SCRIPT_REQUIRED', 'the draft track is composed from the actual script');
  const lane = lazyLane();
  const direction = deriveMusicDirection({ creativeTone });
  const { project } = lane.createScoreProject({
    name: name || 'visual-draft-v2 original music',
    duration_seconds: requestedSeconds,
    script_text: scriptText,
    seed: seed ?? 100,
    target_platform: 'generic_video',
    ...direction,
  }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  const exported = lane.exportMusicRenderBrief(project.project_id, options);
  if (Math.abs(exported.brief.target_duration_s - requestedSeconds) > 0.001) fail('MUSIC_DURATION_BINDING_BROKEN', `brief carries ${exported.brief.target_duration_s}s`);
  return {
    project_id: project.project_id,
    brief: exported.brief,
    brief_file: exported.file,
    requested_duration_s: requestedSeconds,
    direction,
    approval: { flag: 'cue_sheet_approved', basis: APPROVAL_BASIS, doctrine: options.doctrineBinding || doctrineModule.doctrineBinding(options) },
  };
}

/* Dispatch through the existing bridge; all seams injectable for tests. */
async function dispatchOriginalDraftMusic(planned, options = {}) {
  const dispatch = lazyDispatch();
  return dispatch.requestMusicGeneration(planned.project_id, { candidate_count: options.candidateCount || 1, seed: options.seed, prepare_only: options.prepareOnly }, options);
}

function probeDurationSeconds(filePath) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath], { encoding: 'utf8', timeout: 30000 });
    return Number(out.trim());
  } catch (_) { return null; }
}

/* Prior draft-music identities across package runs: reuse is not original. */
function collectPriorMusicShas(packageRunsRoot) {
  const shas = new Set();
  if (!packageRunsRoot || !fs.existsSync(packageRunsRoot)) return shas;
  for (const run of fs.readdirSync(packageRunsRoot)) {
    for (const file of ['visual-draft-render-spec.json', 'visual-draft-release-packet.json']) {
      const candidate = path.join(packageRunsRoot, run, file);
      if (!fs.existsSync(candidate)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        const music = parsed.music || parsed.music_policy || {};
        if (/^[a-f0-9]{64}$/.test(music.sha256 || '')) shas.add(music.sha256);
        for (const entry of music.policy_history || []) if (/^[a-f0-9]{64}$/.test(entry.music_sha256 || '')) shas.add(entry.music_sha256);
      } catch (_) { /* unreadable run files never grant or deny identity */ }
    }
  }
  return shas;
}

/*
 * The ONLY producer of the music classification. Honest by construction:
 * anything short of a new, duration-matched, completed render is DEGRADED.
 */
function classifyDraftMusicResult({ candidate, requestedDurationSeconds, priorMusicShas = new Set() }, options = {}) {
  const reasons = [];
  let measured = null;
  if (!candidate || candidate.status !== 'completed' || !/^[a-f0-9]{64}$/.test(candidate.output_sha256 || '')) {
    reasons.push('no completed original render');
  } else {
    if (priorMusicShas.has(candidate.output_sha256)) reasons.push('track bytes were already used by an earlier video — reuse is not original');
    measured = candidate.measured_duration_seconds ?? (candidate.local_deliverable_path ? (options.probeDuration || probeDurationSeconds)(candidate.local_deliverable_path) : null);
    if (typeof measured !== 'number' || Number.isNaN(measured)) reasons.push('deliverable duration unmeasurable');
    // Same acceptance window the production contract uses: -0.05s .. +1s tail.
    else if (measured < requestedDurationSeconds - 0.05 || measured > requestedDurationSeconds + 1 + 0.05) reasons.push(`duration ${measured}s does not serve the ${requestedDurationSeconds}s programme`);
  }
  const ok = reasons.length === 0;
  return {
    classification: ok ? ORIGINAL : PLACEHOLDER,
    original_music_requirement: ok ? 'MET' : 'DEGRADED_NOT_MET',
    measured_duration_seconds: measured,
    requested_duration_seconds: requestedDurationSeconds,
    reasons,
  };
}

/*
 * Renderer-compatible append-only music policy entry. The HUMAN authority the
 * renderer requires is Mikko's standing approved V2 contract; the basis says
 * exactly which classification this track carries so a placeholder can never
 * pose as original.
 */
function buildMusicPolicyEntry({ decisionId, predecessorDecisionId = null, musicSha256, classification, requirement }, options = {}) {
  if (![ORIGINAL, PLACEHOLDER].includes(classification)) fail('MUSIC_CLASSIFICATION_INVALID', String(classification));
  if (classification === PLACEHOLDER && requirement !== 'DEGRADED_NOT_MET') fail('MUSIC_CLASSIFICATION_INVALID', 'placeholder music is always DEGRADED_NOT_MET');
  if (classification === ORIGINAL && requirement !== 'MET') fail('MUSIC_CLASSIFICATION_INVALID', 'original classification requires a MET requirement');
  const renderer = require('./production-assembly-renderer.js');
  const pin = options.doctrineBinding || doctrineModule.doctrineBinding(options);
  const entry = {
    decision_id: decisionId,
    predecessor_decision_id: predecessorDecisionId,
    status: 'ACTIVE',
    policy: 'FULL_PROGRAMME',
    authority: { type: 'HUMAN', id: 'Mikko Pakkala' },
    decided_at: options.now || new Date().toISOString(),
    music_sha256: musicSha256,
    basis: `${classification} / ORIGINAL_MUSIC_REQUIREMENT=${requirement}; standing human authority: FINAL-HUMAN-CREATIVE-AMENDMENT-PLAN 2026-08-30 via doctrine ${pin.doctrine_id} v${pin.version} (${pin.binding_digest_sha256.slice(0, 12)}…)`,
  };
  return { ...entry, binding_digest_sha256: renderer.musicDecisionDigest(entry) };
}

module.exports = {
  MANIFEST_SCHEMA,
  ORIGINAL,
  PLACEHOLDER,
  APPROVAL_BASIS,
  DraftMusicError,
  assertDurationFromTimingAuthority,
  deriveMusicDirection,
  planOriginalDraftMusic,
  dispatchOriginalDraftMusic,
  collectPriorMusicShas,
  classifyDraftMusicResult,
  buildMusicPolicyEntry,
};
