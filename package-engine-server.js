#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const os = require('os');

const packageRunDoctor = require('./scripts/package-run-doctor.js');
const roughCutReviewScript = require('./scripts/package-run-rough-cut-review.js');
const finalReviewScript = require('./scripts/package-run-final-review.js');
const exportChecklistScript = require('./scripts/package-run-export-checklist.js');
const publicationMetadataScript = require('./scripts/package-run-publication-metadata.js');
const archiveManifestScript = require('./scripts/package-run-archive-manifest.js');
const nextSafeActionScript = require('./scripts/package-run-next-safe-action.js');
const activeStateAuditScript = require('./scripts/package-run-active-state-audit.js');
const packageRunsIndexScript = require('./scripts/package-runs-index.js');
const systemRegistryScript = require('./scripts/system-registry.js');
const dailyIdeaScout = require('./scripts/daily-idea-scout.js');
const visualBeatMapParser = require('./scripts/visual-beat-map-parser.js');
const submittedTopics = require('./scripts/submitted-topics.js');
const remotionLane = require('./remotion-lane.js');
const packageEngineModel = require('./package-engine-model.js');
const workflowPathModel = require('./workflow-path.js');
const scriptCommitmentModel = require('./script-commitment-check.js');
const resolveReadinessModel = require('./resolve-handoff-readiness.js');
const { slugify, escapeXml, markdownCell, markdownText, lineValue } = require('./package-engine-text-utils.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8010);
const HOST = process.env.HOST || '127.0.0.1';
const API_PREFIX = '/api/package-engine/thumbnails';
const STATUS_API = '/api/package-engine/status';
const CAPTURE_EVIDENCE_PREVIEW_API = '/api/package-runs/capture-evidence/preview';
const CAPTURE_EVIDENCE_APPLY_API = '/api/package-runs/capture-evidence/apply';
const EVIDENCE_INTAKE_STATUS_API = '/api/package-runs/evidence-intake/status';
const EVIDENCE_INTAKE_PREVIEW_API = '/api/package-runs/evidence-intake/preview';
const EVIDENCE_INTAKE_SAVE_API = '/api/package-runs/evidence-intake/save';
const ROUGH_CUT_STATUS_API = '/api/package-runs/rough-cut/status';
const NEXT_SAFE_ACTION_API = '/api/package-runs/next-safe-action';
const PRODUCTION_GPS_API = '/api/package-runs/production-gps';
const SECOND_CUT_INSPECTOR_API = '/api/package-runs/second-cut-inspector';
const SECOND_CUT_CANDIDATE_PREVIEW_API = '/api/package-runs/second-cut-candidate/preview';
const SECOND_CUT_CANDIDATE_APPLY_API = '/api/package-runs/second-cut-candidate/apply';
const SECOND_CUT_WATCH_NOTES_SAVE_API = '/api/package-runs/second-cut-watch-notes/save';
const SECOND_CUT_REVIEW_REGENERATE_API = '/api/package-runs/second-cut-review/regenerate-derived';
const FINAL_CANDIDATE_PREVIEW_API = '/api/package-runs/final-candidate/preview';
const FINAL_CANDIDATE_APPLY_API = '/api/package-runs/final-candidate/apply';
const FINAL_WATCH_NOTES_SAVE_API = '/api/package-runs/final-watch-notes/save';
const FINAL_REVIEW_REGENERATE_API = '/api/package-runs/final-review/regenerate-derived';
const EXPORT_MASTER_PREVIEW_API = '/api/package-runs/export-master/preview';
const EXPORT_MASTER_APPLY_API = '/api/package-runs/export-master/apply';
const DELIVERY_READINESS_SAVE_API = '/api/package-runs/delivery-readiness/save';
const EXPORT_CHECKLIST_REGENERATE_API = '/api/package-runs/export-checklist/regenerate-derived';
const PACKAGE_RUNS_LIST_API = '/api/package-runs/list';
const PACKAGE_RUNS_CANDIDATES_API = '/api/package-runs/candidates';
const PACKAGE_RUNS_CANDIDATE_UPDATE_API = '/api/package-runs/candidates/update';
const PACKAGE_RUNS_CANDIDATE_DELETE_API = '/api/package-runs/candidates/delete';
const REMOTION_STATUS_API = '/api/remotion/status';
const REMOTION_RENDER_API = '/api/remotion/render';
const REMOTION_JOB_STATUS_API = '/api/remotion/job-status';
const REMOTION_CANCEL_API = '/api/remotion/cancel';
const HYPERFRAMES_STATUS_API = '/api/hyperframes/status';
const HYPERFRAMES_PREVIEW_API = '/api/hyperframes/preview';
const HYPERFRAMES_RENDER_API = '/api/hyperframes/render';
// Motion Graphics Studio — standalone deterministic motion-card workspace.
const MOTION_GRAPHICS_TEMPLATES_API = '/api/motion-graphics/templates';
const MOTION_GRAPHICS_PROJECTS_API = '/api/motion-graphics/projects';
const MOTION_GRAPHICS_PROJECT_API = '/api/motion-graphics/project';
const MOTION_GRAPHICS_PROJECT_TITLE_API = '/api/motion-graphics/project-title';
const MOTION_GRAPHICS_SOURCE_API = '/api/motion-graphics/source';
const MOTION_GRAPHICS_CARD_API = '/api/motion-graphics/card';
const MOTION_GRAPHICS_CARD_PARAMS_API = '/api/motion-graphics/card-params';
const MOTION_GRAPHICS_PREVIEW_API = '/api/motion-graphics/preview';
const MOTION_GRAPHICS_RENDER_CARD_API = '/api/motion-graphics/render-card';
const MOTION_GRAPHICS_RENDER_STATUS_API = '/api/motion-graphics/render-status';
const MOTION_GRAPHICS_MEDIA_API = '/api/motion-graphics/media';
const MOTION_GRAPHICS_REMOTION_SPEC_API = '/api/motion-graphics/remotion-spec';
const FINAL_REVIEW_API = '/api/package-runs/final-review';
const EXPORT_CHECKLIST_API = '/api/package-runs/export-checklist';
const PUBLICATION_METADATA_API = '/api/package-runs/publication-metadata';
const ARCHIVE_MANIFEST_API = '/api/package-runs/archive-manifest';
const ROUGH_CUT_SAVE_API = '/api/package-runs/rough-cut/watch-notes';
const ROUGH_CUT_REVIEW_API = '/api/package-runs/rough-cut/review';
const PUBLISH_GATE_DECISION_API = '/api/package-runs/publish-gate/decision';
const PUBLISH_GATE_APPROVE_API = '/api/package-runs/publish-gate/approve';
const PUBLISH_GATE_REJECT_API = '/api/package-runs/publish-gate/reject';
const PUBLISH_GATE_REVOKE_API = '/api/package-runs/publish-gate/revoke';
const ROUGH_CUT_REGENERATE_DERIVED_API = '/api/package-runs/rough-cut/regenerate-derived';
const ROUGH_CUT_OPEN_API = '/api/package-runs/rough-cut/open';
const PACKAGE_RUNS_OPEN_API = '/api/package-runs/open';
const PACKAGE_RUNS_ARCHIVE_API = '/api/package-runs/archive';
const ARTIFACT_TEXT_API = '/api/package-runs/artifact-text';
const ARTIFACTS_LIST_API = '/api/package-runs/artifacts';
const OPEN_FILE_API = '/api/package-runs/open-file';
const PICKUP_PLAN_SAVE_API = '/api/package-runs/pickup-plan/save';
const AIGEN_STATUS_API = '/api/aigen/production-pipeline/status';
const AIGEN_RESOLVE_ASSEMBLY_API = '/api/aigen/resolve-assembly/create';
const MEDIA_ROUTING_API = '/api/media-routing';
const PACKAGE_MEDIA_INDEX_API = '/api/aigen/package-media-index';
const PROJECTS_LIST_API = '/api/projects';
const PROJECT_STATE_API = '/api/project-state';
const PROJECT_IMPORT_MEDIA_API = '/api/project/import-media';
const PROJECT_STATUS_API = '/api/project/status';
const PROJECT_SCRIPT_API = '/api/project/script';
const PROJECT_SCRIPT_SAVE_DRAFT_API = '/api/project/script/save-draft';
const PROJECT_SCRIPT_APPROVE_API = '/api/project/script/approve';
const PROJECT_IMAGE_PROMPTS_GENERATE_API = '/api/project/image-prompts/generate';
const PROJECT_I2V_PROMPTS_API = '/api/project/i2v-prompts';
const PROJECT_I2V_PROMPTS_GENERATE_API = '/api/project/i2v-prompts/generate';
const PROJECT_I2V_PROMPTS_SAVE_API = '/api/project/i2v-prompts/save';
const PROJECT_VIDEO_REVIEW_API = '/api/project/video-review';
const PROJECT_VIDEO_VARIANTS_API = '/api/project/video-variants';
const PROJECT_MEDIA_KIT_API = '/api/project/media-kit';
const PROJECT_YOUTUBE_DRAFT_API = '/api/project/youtube-draft';
const PROJECT_YOUTUBE_DRAFT_SAVE_API = '/api/project/youtube-draft/save';
const SUPER_FOCUS_PROJECTS_API = '/api/super-focus/projects';
const SUPER_FOCUS_ARCHIVED_PROJECTS_API = '/api/super-focus/archived-projects';
const SUPER_FOCUS_ARCHIVE_PROJECT_API = '/api/super-focus/archive-project';
const SUPER_FOCUS_RESTORE_PROJECT_API = '/api/super-focus/restore-project';
const SUPER_FOCUS_DELETE_PROJECT_API = '/api/super-focus/delete-project';
const SUPER_FOCUS_PROJECT_API = '/api/super-focus/project';
const SUPER_FOCUS_PROVIDERS_API = '/api/super-focus/providers';
const SUPER_FOCUS_EVALUATE_SCRIPT_API = '/api/super-focus/evaluate-script';
const SUPER_FOCUS_SCRIPT_EVALUATION_API = '/api/super-focus/script-evaluation';
const SUPER_FOCUS_OLLAMA_BENCHMARK_API = '/api/super-focus/ollama-benchmark';
const SUPER_FOCUS_VISUAL_PLAN_API = '/api/super-focus/visual-plan';
const SUPER_FOCUS_VISUAL_PLAN_READINESS_API = '/api/super-focus/visual-plan/readiness';
const SUPER_FOCUS_VISUAL_PLAN_ACTION_PREFIX = '/api/super-focus/visual-plan/';
const SUPER_FOCUS_PROMPTS_FROM_ASSIGNMENTS_API = '/api/super-focus/image-prompts/from-assignments';
const SUPER_FOCUS_IMAGE_REVIEW_API = '/api/super-focus/image-review';
const SUPER_FOCUS_IMAGE_REVIEW_ACTION_PREFIX = '/api/super-focus/image-review/';
const SUPER_FOCUS_IMAGE_REVIEW_WORKBENCH_API = '/api/super-focus/image-review-workbench';
const SUPER_FOCUS_VIDEO_REVIEW_API = '/api/super-focus/video-review';
const SUPER_FOCUS_ATTEMPT_STORAGE_API = '/api/super-focus/attempt-storage';
const SUPER_FOCUS_VIDEO_QUEUE_AUDIT_API = '/api/super-focus/video-queue-audit';
const SUPER_FOCUS_VIDEO_REVIEW_ACTION_PREFIX = '/api/super-focus/video-review/';
const SUPER_FOCUS_TITLE_API = '/api/super-focus/title';
const SUPER_FOCUS_SCRIPT_API = '/api/super-focus/script';
const SUPER_FOCUS_GENERATE_TOPIC_API = '/api/super-focus/generate-topic';
const SUPER_FOCUS_GENERATE_SCRIPT_API = '/api/super-focus/generate-script';
const SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API = '/api/super-focus/generate-image-prompts';
const SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API = '/api/super-focus/generate-remaining-image-prompts';
const SUPER_FOCUS_GENERATE_INFOGRAPHIC_PROMPTS_API = '/api/super-focus/generate-infographic-prompts';
const SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API = '/api/super-focus/generate-missing-infographic-prompts';
const SUPER_FOCUS_IMAGE_PROMPT_API = '/api/super-focus/image-prompt';
const SUPER_FOCUS_INFOGRAPHIC_PROMPT_API = '/api/super-focus/infographic-prompt';
const SUPER_FOCUS_CLEAR_UNLINKED_PREVIEW_API = '/api/super-focus/image-prompts/clear-unlinked-preview';
const SUPER_FOCUS_CLEAR_UNLINKED_API = '/api/super-focus/image-prompts/clear-unlinked';
const SUPER_FOCUS_GENERATE_IMAGES_API = '/api/super-focus/generate-images';
const SUPER_FOCUS_IMAGES_STATUS_API = '/api/super-focus/images-status';
const SUPER_FOCUS_IMAGES_CANCEL_API = '/api/super-focus/images-cancel';
const SUPER_FOCUS_IMAGE_FILE_API = '/api/super-focus/image';
const SUPER_FOCUS_GENERATE_I2V_PROMPT_API = '/api/super-focus/generate-i2v-prompt';
const SUPER_FOCUS_GENERATE_MISSING_I2V_PROMPTS_API = '/api/super-focus/generate-missing-i2v-prompts';
const SUPER_FOCUS_I2V_PROMPT_API = '/api/super-focus/i2v-prompt';
const SUPER_FOCUS_CLEAR_I2V_PROMPT_API = '/api/super-focus/clear-i2v-prompt';
const SUPER_FOCUS_CLEAR_IMAGE_API = '/api/super-focus/clear-image';
const SUPER_FOCUS_REGENERATE_IMAGE_API = '/api/super-focus/regenerate-image';
const SUPER_FOCUS_GENERATE_VIDEOS_API = '/api/super-focus/generate-videos';
const SUPER_FOCUS_CLEAR_VIDEO_API = '/api/super-focus/clear-video';
const SUPER_FOCUS_REGENERATE_VIDEO_API = '/api/super-focus/regenerate-video';
const SUPER_FOCUS_VIDEOS_STATUS_API = '/api/super-focus/videos-status';
const SUPER_FOCUS_VIDEOS_CANCEL_API = '/api/super-focus/videos-cancel';
const SUPER_FOCUS_QUEUE_VIDEO_API = '/api/super-focus/queue-video';
const SUPER_FOCUS_QUEUE_MISSING_VIDEOS_API = '/api/super-focus/queue-missing-videos';
const SUPER_FOCUS_VIDEO_QUEUE_API = '/api/super-focus/video-queue';
const SUPER_FOCUS_VIDEO_QUEUE_PAUSE_API = '/api/super-focus/video-queue/pause';
const SUPER_FOCUS_VIDEO_QUEUE_RESUME_API = '/api/super-focus/video-queue/resume';
const SUPER_FOCUS_VIDEO_QUEUE_STOP_CURRENT_API = '/api/super-focus/video-queue/stop-current';
const SUPER_FOCUS_CANCEL_QUEUED_VIDEO_API = '/api/super-focus/cancel-queued-video';
const SUPER_FOCUS_VIDEO_FILE_API = '/api/super-focus/video';
const EARTH_STUDIO_STATUS_API = '/api/earth-studio/status';
const EARTH_STUDIO_PLAN_API = '/api/earth-studio/plan';
const EARTH_STUDIO_RENDER_API = '/api/earth-studio/render';
const EARTH_STUDIO_JOB_STATUS_API = '/api/earth-studio/job-status';
const EARTH_STUDIO_CANCEL_API = '/api/earth-studio/cancel';
const EARTH_STUDIO_STAGE_API = '/api/earth-studio/stage';
const SCORE_SETTINGS_API = '/api/score/settings';
const SCORE_PROJECTS_API = '/api/score/projects';
const SCORE_PROJECT_API = '/api/score/project';
const SCORE_PROFILES_API = '/api/score/profiles';
const SCORE_PROFILE_DELETE_API = '/api/score/profiles/delete';
const SCORE_CUES_GENERATE_API = '/api/score/cues/generate';
const SCORE_CUES_SAVE_API = '/api/score/cues/save';
const SCORE_CUES_APPROVE_API = '/api/score/cues/approve';
const SCORE_PALETTE_API = '/api/score/palette';
const SCORE_CANDIDATES_GENERATE_API = '/api/score/candidates/generate';
const SCORE_CANDIDATE_STATUS_API = '/api/score/candidates/status';
const SCORE_CANDIDATE_APPROVE_API = '/api/score/candidates/approve';
const SCORE_CANDIDATE_REVISE_API = '/api/score/candidates/revise';
const SCORE_REAPER_BUILD_API = '/api/score/reaper/build';
const SCORE_REAPER_OPEN_API = '/api/score/reaper/open';
const SCORE_ABLETON_BUILD_API = '/api/score/ableton/build';
const SCORE_PROBE_API = '/api/score/probe';
const SCORE_PROMPT_API = '/api/score/prompt';
const SCORE_AI_APPLY_API = '/api/score/cues/ai-apply';
const SCORE_AI_CALL_API = '/api/score/cues/ai-call';
const SCORE_VERIFY_API = '/api/score/verify';
const SCORE_OPEN_FOLDER_API = '/api/score/open-folder';
const SCORE_FILE_API = '/api/score/file';
const PROJECT_VIDEO_REVIEW_SAVE_API = '/api/project/video-review/save';
const PROJECT_ALLOWED_STATUSES = ['active', 'parked', 'blocked', 'editing', 'publish_prep', 'published', 'archived'];
const AIGEN_FLUX_IMAGES_API_PREFIX = '/api/aigen/flux-images/';
const AIGEN_SELECTED_IMAGES_API = '/api/aigen/selected-images';
const AIGEN_UPLOAD_IMAGE_API = '/api/aigen/upload-image';
const AIGEN_ASSETS_PREFIX = '/aigen-assets/';
const PRESTO_SUBMIT_API = '/api/presto/submit';
const PRESTO_JOB_STATUS_API = '/api/presto/job-status';
const PRESTO_CANCEL_API = '/api/presto/cancel';
const PRESTO_RESULTS_API = '/api/presto/results';
const COMPUTE_STATUS_API = '/api/compute/status';
const COMPUTE_SELECT_API = '/api/compute/select';
const PACKAGE_VIDEO_PROMPTS_API = '/api/package/video-prompts';
const FLUX_SUBMIT_API = '/api/flux/submit';
const FLUX_JOB_STATUS_API = '/api/flux/job-status';
const FLUX_CANCEL_API = '/api/flux/cancel';
const FLUX_RESULTS_API = '/api/flux/results';
const IMAGE_PROMPTS_READ_API = '/api/image-prompts/read';
const IMAGE_PROMPTS_VALIDATE_API = '/api/image-prompts/validate';
const IMAGE_PROMPTS_SAVE_API = '/api/image-prompts/save';
const DAILY_SCOUT_TODAY_API = '/api/daily-idea-scout/today';
const DAILY_SCOUT_ARCHIVE_API = '/api/daily-idea-scout/archive';
const DAILY_SCOUT_DATES_API = '/api/daily-idea-scout/dates';
const DAILY_SCOUT_RUN_API = '/api/daily-idea-scout/run';
const IDEAS_TRIAGE_API = '/api/ideas/triage';
const IDEAS_STATUS_API = '/api/ideas/status';
const IDEAS_PROMOTE_API = '/api/ideas/promote';
const IDEAS_GENERATE_FROM_TOPIC_API = '/api/ideas/generate-from-topic';
const IDEAS_TOPIC_RUNS_API = '/api/ideas/topic-runs';
const IDEAS_TOPIC_RUN_API = '/api/ideas/topic-run';
const PACKAGE_RUNS_REINDEX_API = '/api/package-runs/reindex';
const TOPIC_SCOUT_LIST_API = '/api/topic-scout/list';
const TOPIC_SCOUT_SUBMIT_API = '/api/topic-scout/submit';
const TOPIC_SCOUT_GET_API = '/api/topic-scout/get';
const TOPIC_SCOUT_UPDATE_STATUS_API = '/api/topic-scout/update-status';
const SAVE_SELECTED_PACKAGE_API = '/api/package-engine/save-selected';
const GENERATE_OUTLINE_PROMPT_API = '/api/package-engine/generate-outline-prompt';
const SAVE_OUTLINE_API = '/api/package-engine/save-outline';
const BEGINNING_TRIAGE_GENERATE_API = '/api/beginning-triage/generate';
const WORKFLOW_PATH_API = '/api/package-runs/workflow-path';
const RESOLVE_READINESS_API = '/api/package-runs/resolve-readiness';
const SHORTS_SCRIPT_OPTIONS_API = '/api/shorts/script-options';
const SHORTS_SAVE_SCRIPT_API = '/api/shorts/save-script';
const SHORTS_SCRIPT_COMMITMENT_CHECK_API = '/api/shorts/script-commitment-check';
const SHORTS_SAVE_SCRIPT_COMMITMENT_CHECK_API = '/api/shorts/save-script-commitment-check';
const TOPIC_SCOUT_GENERATE_ONE_API = '/api/topic-scout/generate-one';
const SHORTS_I2V_PROMPTS_API = '/api/shorts/i2v-prompts';
const SHORTS_SAVE_I2V_PROMPTS_API = '/api/shorts/save-i2v-prompts';
const SERVE_ROOT = ROOT;
const PACKAGE_RUNS_DIR = 'package-runs';
const VIDNAS_AIGEN_ROOT = '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen';
const VIDNAS_SCRIPT_PACKAGES = path.join(VIDNAS_AIGEN_ROOT, 'script-packages');
const VIDNAS_WAN_LANE = path.join(VIDNAS_AIGEN_ROOT, 'image-to-video', 'production', 'wan22-81f');
// Per-project generated media (FLUX stills + kling-video-candidates) lives under
// here, one folder per project. A run is linked to its folder via the folder's
// generation-manifest.json -> source.source_path (which embeds the runId).
const VIDNAS_SCRIPT_IMAGE_ASSETS_ROOT = path.join(VIDNAS_AIGEN_ROOT, 'script-image-assets');
// Archive destination on the VIDNAS EXT4 share (PRESTO sees this as V:\MEDIA EXT4\ARCHIVED MEDIA).
const VIDNAS_ARCHIVED_MEDIA_ROOT = '/mnt/vidnas_ext4/MEDIA EXT4/ARCHIVED MEDIA';
const VIDNAS_ARCHIVED_STILL_DIR = path.join(VIDNAS_ARCHIVED_MEDIA_ROOT, 'STILL');
const VIDNAS_ARCHIVED_VIDEO_DIR = path.join(VIDNAS_ARCHIVED_MEDIA_ROOT, 'VIDEO');
const ARCHIVE_IMAGE_EXT = /\.(png|jpg|jpeg|webp|gif|bmp)$/i;
const ARCHIVE_VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv)$/i;
const PRESTO_BASE_URL = 'http://192.168.50.187:8188';

// ---------------------------------------------------------------------------
// Compute registry integration (read-only, vidnux-owned lane selector)
// The selector lives at ~/vidtoolz-compute/vidtoolz-compute.py and provides
// lane-keyed readiness checks (SSH, ComfyUI, Resolve-not-running, workflow
// hash). This integration adds a gate before PRESTO submit: if the selector
// says BLOCKED, the submit is rejected with a clear reason.
// ---------------------------------------------------------------------------
const { execFile } = childProcess;
const COMPUTE_REGISTRY_DIR = path.join(process.env.HOME || '/home/vidtoolz', 'vidtoolz-compute');
const COMPUTE_SELECTOR = path.join(COMPUTE_REGISTRY_DIR, 'vidtoolz-compute.py');
const COMPUTE_REGISTRY_TIMEOUT_MS = 20000;
// The only compute lane this cockpit integration supports (Wan I2V → PRESTO).
// Image routing and other hosts (e.g. vidlap2) are deliberately out of scope for
// this branch; any other lane id is rejected before the selector is ever spawned.
const COMPUTE_LANES = new Set(['wan_i2v']);
// The host a wan_i2v ROUTE must resolve to for a PRESTO submit to proceed.
const COMPUTE_WAN_I2V_HOST = 'presto';

// Strict lane-id validation for the query-facing selector route: charset + length
// bound first (so traversal, shell metacharacters, and overlong input can never
// reach the spawned child), then a registered-lane allowlist. Selector invocation
// uses execFile with an argument array — no shell — so even a well-formed value is
// never interpreted; this guard additionally prevents a stray child process.
function isValidComputeLane(lane) {
  return typeof lane === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(lane) && COMPUTE_LANES.has(lane);
}

function computeRegistrySelect(lane) {
  return new Promise((resolve) => {
    // Defense in depth: never spawn the selector for an unregistered/unsafe lane.
    if (!isValidComputeLane(lane)) {
      resolve({ ok: false, decision: 'BLOCKED', reason: `invalid or unregistered lane '${String(lane).slice(0, 64)}'`, checks: {}, fallback_used: false });
      return;
    }
    execFile('python3', [COMPUTE_SELECTOR, 'select', lane, '--json'], {
      cwd: COMPUTE_REGISTRY_DIR,
      timeout: COMPUTE_REGISTRY_TIMEOUT_MS,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, decision: 'BLOCKED', reason: `selector error: ${(stderr || err.message || '').slice(0, 300)}`, checks: {}, fallback_used: false });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseErr) {
        resolve({ ok: false, decision: 'BLOCKED', reason: `selector JSON parse error: ${(parseErr.message || '').slice(0, 200)}`, checks: {}, fallback_used: false });
      }
    });
  });
}

async function computeReadinessGate(lane) {
  const result = await computeRegistrySelect(lane);
  return result;
}

// Fail-closed verdict on a selector result, evaluated fresh before every PRESTO
// submit. A submit is allowed ONLY when the result is internally consistent for
// the requested lane: a genuine ROUTE decision, to the canonical PRESTO host,
// with no fallback. "ROUTE" is never accepted as a bare boolean — any
// missing/unknown/mismatched identity field blocks. It matches the selector's
// observed ROUTE shape ({decision:'ROUTE', selected_host:'presto', ...}): fields
// the selector may legitimately omit (lane, fallback_used) only block when
// PRESENT and wrong, never merely by being absent. Returns { allow, code, reason }.
function computeGateVerdict(gateResult, expectedLane) {
  if (!gateResult || typeof gateResult !== 'object') {
    return { allow: false, code: 'gate_malformed', reason: 'selector returned no usable result' };
  }
  if (gateResult.ok === false || gateResult.decision === 'BLOCKED') {
    return { allow: false, code: 'lane_blocked', reason: gateResult.reason || 'blocked by selector' };
  }
  if (gateResult.decision !== 'ROUTE') {
    return { allow: false, code: 'unexpected_decision', reason: `unexpected selector decision '${String(gateResult.decision).slice(0, 40)}'` };
  }
  if (gateResult.lane != null && gateResult.lane !== expectedLane) {
    return { allow: false, code: 'lane_mismatch', reason: `selector routed lane '${String(gateResult.lane).slice(0, 40)}', expected '${expectedLane}'` };
  }
  if (gateResult.selected_host !== COMPUTE_WAN_I2V_HOST) {
    return { allow: false, code: 'host_mismatch', reason: `selector routed to host '${String(gateResult.selected_host).slice(0, 40)}', expected '${COMPUTE_WAN_I2V_HOST}'` };
  }
  if (gateResult.fallback_used === true) {
    return { allow: false, code: 'fallback_used', reason: 'selector used a fallback route; refusing PRESTO submit' };
  }
  return { allow: true, code: 'route', reason: 'ok' };
}

// sha256 of a file's bytes, or null if absent/unreadable/too large. Never throws.
function sha256FileSafe(filePath, maxBytes = 5 * 1024 * 1024) {
  try {
    if (!filePath) return null;
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size > maxBytes) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return null;
  }
}

// Job-level binding to the exact rendered inputs: a stable hash over the two
// dispatch input manifests (which stills, which motion prompts). null when the
// package dir has neither (e.g. a non-aigen lane). This is provenance evidence,
// not a gate — it never blocks a dispatch.
function hashDispatchInputs(packageDir) {
  const parts = [];
  for (const name of ['selected-images.json', 'video-prompts.json']) {
    const h = sha256FileSafe(path.join(packageDir, name));
    if (h) parts.push(`${name}:${h}`);
  }
  return parts.length ? crypto.createHash('sha256').update(parts.join('|')).digest('hex') : null;
}

// Build the durable provenance receipt for a compute-gated PRESTO dispatch from
// the selector result that authorized it. Fields the selector legitimately omits
// (registry_version, fallback_used) are recorded as null = UNKNOWN — never
// fabricated. Dynamic fields (job_id, dispatch_timestamp, workflow_hash,
// inputs_hash) are filled in at spawn time by launchPrestoProductionJob.
function buildComputeDispatchReceipt(input = {}) {
  const g = input.gateResult && typeof input.gateResult === 'object' ? input.gateResult : {};
  const verdict = input.verdict || {};
  return {
    schema_version: 1,
    lane: input.lane || null,
    decision: g.decision || null,
    gate_code: verdict.code || null,
    selected_host: g.selected_host || null,
    selected_endpoint: g.endpoint || g.selected_endpoint || null,
    selector_reason: g.reason || null,
    registry_version: g.registry_version || null,
    fallback_used: g.fallback_used === true ? true : (g.fallback_used === false ? false : null),
    checks: g.checks && typeof g.checks === 'object' ? g.checks : {},
    profile: input.profile || null,
    comfyui_url: input.comfyuiUrl || null,
    job_id: null,
    dispatch_timestamp: null,
    workflow_hash: null,
    inputs_hash: null,
  };
}

// Best-effort durable write of the dispatch receipt into the package dir. A
// write failure NEVER fails a dispatch — the in-memory receipt (surfaced via the
// job-status API) is authoritative; the file is an additive provenance artifact.
function persistDispatchReceipt(packageDir, receipt) {
  try {
    const outPath = path.join(packageDir, 'presto-dispatch-receipt.json');
    const tmp = `${outPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, outPath);
    return outPath;
  } catch (_) {
    return null;
  }
}

// Shared Super Focus Wan I2V lane gate. Same fail-closed, route-identity policy
// the AIGEN PRESTO submit path enforces, evaluated fresh at each SF dispatch.
// Returns { allow, gateResult, verdict }. Injectable via options.computeGateFn so
// tests never touch the real selector; a throw/reject is itself a fail-closed
// BLOCK. The queue pump treats a non-allow as a HOLD (item stays queued); the
// direct batch/regenerate handlers turn it into a 503 (see superFocusLaneBlockedError).
async function evaluateSuperFocusComputeLane(options = {}) {
  const gate = options.computeGateFn || computeReadinessGate;
  let gateResult;
  try {
    gateResult = await gate('wan_i2v');
  } catch (gateErr) {
    gateResult = { ok: false, decision: 'BLOCKED', reason: `gate error: ${(((gateErr && gateErr.message) || 'exception')).slice(0, 200)}`, checks: {} };
  }
  const verdict = computeGateVerdict(gateResult, 'wan_i2v');
  return { allow: verdict.allow, gateResult, verdict };
}

function superFocusLaneBlockedError(verdict) {
  const e = new Error(`Compute registry: Wan I2V lane is BLOCKED — ${(verdict && verdict.reason) || 'unknown reason'}`);
  e.statusCode = 503;
  e.code = 'compute_lane_blocked';
  return e;
}
const RESOLVE_HANDOFF_FILES = ['assembly-plan.md', 'assembly-plan.csv', 'media-manifest.json'];
const PRESTO_OUTPUT_LIMIT_BYTES = 100 * 1024;
const PRESTO_OUTPUT_TAIL_BYTES = 4 * 1024;
const PRESTO_COMPLETED_TTL_MS = 10 * 60 * 1000;
const PRESTO_STATE = {
  activeJob: null,
  defaultUrl: PRESTO_BASE_URL,
  productionScript: path.join(VIDNAS_WAN_LANE, 'run-production.py'),
  runsDir: path.join(VIDNAS_WAN_LANE, 'runs'),
};
const FLUX_STATE = {
  activeJob: null,
  script: path.join(VIDNAS_AIGEN_ROOT, 'image-generation', 'flux-gguf', 'run-handoff.py'),
};
// The FLUX dispatch chain shells out to the ComfyUI CLI (`comfy run`) from
// run-handoff.py. When the cockpit runs under systemd (user unit) the service
// PATH is the bare system default and lacks ~/.local/bin — where pip/pipx puts
// comfy-cli — so the spawned chain failed per-row with the raw Python error
// "[Errno 2] No such file or directory: 'comfy'". Two-part repair:
//   1. every FLUX spawn gets a repaired PATH (fluxDispatchPath), and
//   2. dispatch pre-flights CLI resolvability (comfyCliResolvable) so a missing
//      CLI is a clear 503 blocked state, never a doomed spawned job.
// SUPER_FOCUS_COMFY_BIN_DIR adds one extra directory without code edits.
function fluxDispatchPath(basePath) {
  const base = basePath != null ? String(basePath) : String(process.env.PATH || '');
  const parts = base.split(path.delimiter).filter(Boolean);
  const have = new Set(parts);
  const extras = [path.join(os.homedir(), '.local', 'bin')];
  const envDir = String(process.env.SUPER_FOCUS_COMFY_BIN_DIR || '').trim();
  if (envDir) extras.push(envDir);
  extras.forEach((dir) => {
    if (!have.has(dir)) { parts.push(dir); have.add(dir); }
  });
  return parts.join(path.delimiter);
}

// True when the `comfy` CLI resolves from the repaired dispatch PATH.
// Injectable (options.comfyCliCheck) for tests; performs only fs access checks.
function comfyCliResolvable(options = {}) {
  if (typeof options.comfyCliCheck === 'function') return Boolean(options.comfyCliCheck());
  for (const dir of fluxDispatchPath().split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, 'comfy'), fs.constants.X_OK);
      return true;
    } catch (_) { /* keep scanning */ }
  }
  return false;
}

// Clear blocked-state error for a missing image CLI: names the lane, host,
// engine, and remedy. Thrown BEFORE any spawn so no per-row failure occurs.
function comfyCliBlockedError() {
  const e = new Error(
    'Text-to-image lane blocked: the ComfyUI CLI (`comfy`) is not available to the cockpit process. '
    + 'FLUX images run locally on vidnux via comfy-cli → ComfyUI (http://127.0.0.1:8188). '
    + 'Fix: ensure ~/.local/bin is on the cockpit service PATH, or set SUPER_FOCUS_COMFY_BIN_DIR to the directory containing `comfy`.'
  );
  e.statusCode = 503;
  e.code = 'image_lane_blocked_cli_missing';
  return e;
}
// VIDTOOLZ policy: OpenAI must NOT be used for image generation. Image generation
// runs locally via vidnux ComfyUI / FLUX. The OpenAI Images API path has been
// removed; any image/thumbnail request for provider=openai is hard-disabled below
// and cannot call OpenAI even if OPENAI_API_KEY is set.
const OPENAI_IMAGE_DISABLED_REASON =
  'OpenAI image generation is disabled by VIDTOOLZ policy. Image generation uses the local vidnux ComfyUI / FLUX path.';
const LOCAL_IMAGE_PROVIDER = Object.freeze({
  id: 'vidnux-comfyui',
  name: 'vidnux ComfyUI / FLUX',
  url: 'http://127.0.0.1:8188',
  workflow: '/home/vidtoolz/comfy/ComfyUI/user/default/workflows/flux-gguf-1080x1920.json',
});
// Local Ollama LLM (no credentials, localhost only). Used for browser-local
// idea-triage drafting. Configurable via env so a different host/model can be used.
const OLLAMA_BASE_URL = String(process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || 'qwen3:14b');
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) > 0 ? Number(process.env.OLLAMA_TIMEOUT_MS) : 120000;
// Media routing policy: image prompts -> vidnux Ollama (above); I2V prompts ->
// PRESTO Ollama (below). These are SEPARATE hosts by hard policy — I2V prompts
// must NOT fall back to vidnux Ollama. Endpoints are env-overridable so the
// policy can follow the real LAN. See media-routing.js / config/media-routing.json.
const mediaRouting = require('./media-routing.js');
const packageMediaIndex = require('./package-media-index.js');
const { buildPackageMediaIndex } = packageMediaIndex;
const { importManualMedia, readSidecar, writeSidecar } = require('./manual-media-import.js');
const { resolveProjectState } = require('./project-state-resolver.js');
const { chooseNextTask } = require('./next-task-engine.js');
const projectDiscovery = require('./project-discovery.js');
const earthStudioLane = require('./earth-studio-lane.js');
const scoreLane = require('./score-engine/score-lane.js');
const { verifyApprovedExports, formatVerifierReport } = require('./score-engine/score-readiness.js');
const scorePlanner = require('./score-engine/cue-planner.js');
const ideaPromotion = require('./idea-promotion.js');
const topicScout = require('./topic-idea-scout.js');
const projectScript = require('./project-script.js');
const projectImagePrompts = require('./project-image-prompts.js');
const projectI2vPrompts = require('./project-i2v-prompts.js');
const projectVideoReview = require('./project-video-review.js');
const publishGateDecision = require('./publish-gate-decision.js');
const superFocus = require('./super-focus.js');
const superFocusVisualPlan = require('./super-focus-visual-plan.js');
const superFocusImageReview = require('./super-focus-image-review.js');
const superFocusVideoReview = require('./super-focus-video-review.js');
const superFocusPrompts = require('./super-focus-prompts.js');
const superFocusMedia = require('./super-focus-media.js');
const superFocusRouter = require('./super-focus-router.js');
const scriptEvaluator = require('./script-evaluator.js');
const motionGraphicsState = require('./motion-graphics-state.js');
const motionGraphicsTemplates = require('./motion-graphics-templates.js');
const motionGraphicsRenderers = require('./motion-graphics-renderers.js');
const motionGraphicsRemotion = require('./motion-graphics-remotion.js');
// Super Focus keeps its own local, file-backed project state (never on VIDNAS).
// Root is env-overridable so it can follow a different disk without code edits.
const SUPER_FOCUS_ROOT = process.env.SUPER_FOCUS_ROOT || path.join(ROOT, 'super-focus-projects');
// Generated media (media-only) lives on VIDNAS under a dedicated Super Focus
// namespace, separate from aigen script-packages. Env-overridable.
const SUPER_FOCUS_MEDIA_ROOT = process.env.SUPER_FOCUS_MEDIA_ROOT || path.join(VIDNAS_AIGEN_ROOT, 'super-focus');
// Motion Graphics Studio media namespace (VIDNAS, media-only; used from Slice 2
// when rendering. Canonical project STATE stays local, see motion-graphics-state.js).
const MOTION_GRAPHICS_MEDIA_ROOT = process.env.MOTION_GRAPHICS_MEDIA_ROOT || path.join(VIDNAS_AIGEN_ROOT, 'motion-graphics');
// Approved HyperFrames version for TRANSPARENT lower-third renders (alpha
// slice spec §14): alpha encode behavior (pix_fmt/profile/metadata) is version-
// sensitive and the global CLI self-updates, so transparent renders refuse on
// any other version (409). Opaque renders keep the advisory-only drift warning.
// Deliberate remedies on refusal: review + update this constant, or reinstall
// the approved CLI. Never auto-upgrade/downgrade.
const MOTION_GRAPHICS_APPROVED_HYPERFRAMES_VERSION = '0.7.65';

// Validate an optional operator-supplied count/limit for Super Focus. Absent
// (undefined/null/'') returns `fallback`; otherwise it must be an integer 1..max.
function validateSuperFocusCount(value, max, label = 'count') {
  if (value === undefined || value === null || value === '') return max;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    const e = new Error(`${label} must be an integer between 1 and ${max}.`);
    e.statusCode = 400;
    throw e;
  }
  return n;
}
// Visual Plan governance: once a project has one or more visual assignments,
// assignment-derived prompt creation is the canonical path and script-wide
// generation is a LEGACY EXCEPTION requiring an explicit override flag.
// Projects with no plan — or a plan with no assignments yet — keep the
// historic behavior unchanged. Cancellation (no override) mutates nothing.
function assertScriptWideLegacyAllowed(state, payload) {
  const plan = state && state.visual_plan;
  const assignments = plan && Array.isArray(plan.assignments) ? plan.assignments.length : 0;
  if (assignments === 0) return;
  if (payload && payload.legacy_override === true) return;
  const e = new Error(
    `This project has a Visual Plan with ${assignments} assignment(s) — assignment-derived prompt creation is the canonical path. `
    + 'Script-wide generation is a legacy exception: the resulting prompts will NOT be linked to beats or assignments, '
    + 'will NOT inherit viewer tasks or acceptance criteria, cannot satisfy Visual Plan provenance, and may occupy '
    + 'capacity needed by approved assignments. Re-submit with legacy_override:true to use script-wide legacy generation anyway.'
  );
  e.statusCode = 409;
  e.code = 'visual_plan_governs';
  throw e;
}

// Shared read-only preview for the unlinked-prompt recovery workflow:
// eligibility, refusals (linked rows; rows guarded by a live video-queue
// item), per-row downstream artifacts (image/video on disk), and the capacity
// consequence for approved assignments. Never mutates anything.
//
// FAIL-CLOSED contract: this preview gates a destructive clear, so it never
// treats an unreadable protection signal as "no protection". A corrupt video
// queue (readVideoQueue throws video_queue_unreadable) and any reconcile
// failure other than a legitimately-absent media directory refuse the whole
// preview with a 409 — the operator inspects and repairs instead of clearing
// blind. "Media dir absent" alone means no artifacts, and stays non-fatal.
function buildClearUnlinkedPreview(id, state, indexes, sfRoot, sfMediaRoot) {
  const capacity = superFocusPrompts.IMAGE_PROMPT_MAX;
  const protectedBy = {};
  // Queue read errors propagate (video_queue_unreadable → 409): a queue that
  // cannot be read is NOT an empty queue, and clearing must not proceed on
  // the assumption that no row is guarded by a live queued/running item.
  const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
  (queue.items || []).forEach((it) => {
    if (it && (it.status === 'queued' || it.status === 'running') && Number.isInteger(it.index)) {
      protectedBy[it.index] = `Row has a ${it.status} video-queue item — clearing is refused while the job is live.`;
    }
  });
  const selection = superFocus.selectClearableUnlinkedPrompts(state, indexes, { protected: protectedBy });
  // Absent media directory is a legitimate "no artifacts yet" state (ENOENT);
  // anything else — including the corrupt-queue error reconcileVideos can
  // surface — must refuse rather than report a false "no artifacts".
  const mediaDirMissing = (err) => err && err.code === 'ENOENT';
  const reconcileRefusal = (lane, err) => {
    const e = new Error(`Cannot establish ${lane} artifact truth for project "${id}" (${err && err.message ? err.message : err}). Refusing to preview a clear without it — inspect or repair the media state.`);
    e.statusCode = 409;
    e.code = 'artifact_truth_unavailable';
    throw e;
  };
  let imageByIndex = {};
  let videoByIndex = {};
  try {
    (superFocusMedia.reconcileImages(id, state.image_prompts, { mediaRoot: sfMediaRoot }).images || [])
      .forEach((r) => { imageByIndex[r.index] = Boolean(r.has_image); });
  } catch (err) { if (mediaDirMissing(err)) { /* no media dir -> no image artifacts */ } else reconcileRefusal('image', err); }
  try {
    ((superFocusMedia.reconcileVideos(id, state.image_prompts, undefined, { mediaRoot: sfMediaRoot }) || {}).videos || [])
      .forEach((r) => { videoByIndex[r.index] = Boolean(r.has_video); });
  } catch (err) { if (mediaDirMissing(err)) { /* no media dir -> no video artifacts */ } else reconcileRefusal('video', err); }
  const eligible = selection.eligible.map((r) => ({
    index: r.index,
    text_preview: String(r.text || '').slice(0, 120),
    has_image: Boolean(imageByIndex[r.index]),
    has_video: Boolean(videoByIndex[r.index]),
  }));
  const artifactImages = eligible.filter((r) => r.has_image).length;
  const artifactVideos = eligible.filter((r) => r.has_video).length;
  const plan = state.visual_plan || null;
  const integrity = superFocusVisualPlan.computePlanIntegrity(plan, state.image_prompts, capacity);
  const emptyAfter = integrity.empty_slots + eligible.length;
  return {
    project_id: id,
    capacity,
    eligible,
    eligible_count: eligible.length,
    eligible_indexes: eligible.map((r) => r.index),
    refused: selection.refused,
    missing: selection.missing,
    protected_by: protectedBy,
    artifacts: { images: artifactImages, videos: artifactVideos },
    requires_artifact_acknowledgement: artifactImages + artifactVideos > 0,
    approved_needing_prompts: integrity.approved_needing_prompts,
    empty_slots_now: integrity.empty_slots,
    empty_slots_after: emptyAfter,
    blocked_by_capacity_after: Math.max(0, integrity.approved_needing_prompts - emptyAfter),
    integrity,
  };
}

const OLLAMA_PRESTO_BASE_URL = mediaRouting.resolveEndpoint(mediaRouting.LANE.I2V_PROMPT);
const OLLAMA_PRESTO_MODEL = mediaRouting.resolveModel(mediaRouting.LANE.I2V_PROMPT);

// Read-only routing status: the policy plus the resolved local endpoints/models
// for each lane. Used by the cockpit to make machine/provider routing obvious
// and to state the no-fallback doctrine. Performs no network calls.
function buildMediaRoutingStatus() {
  const L = mediaRouting.LANE;
  return {
    ok: true,
    operator_summary: mediaRouting.operatorSummary(),
    lanes: {
      image_prompt_generation: {
        host: 'vidnux', engine: 'ollama', locality: 'local', fallback_allowed: false,
        endpoint: OLLAMA_BASE_URL, model: OLLAMA_MODEL,
        label: 'LOCAL · vidnux · Ollama',
      },
      text_to_image_generation: {
        host: 'vidnux', engine: 'comfyui', locality: 'local', fallback_allowed: false,
        endpoint: LOCAL_IMAGE_PROVIDER.url, workflow: 'flux-gguf-1080x1920',
        label: 'LOCAL · vidnux · ComfyUI FLUX',
      },
      i2v_prompt_generation: {
        host: 'presto', engine: 'ollama', locality: 'local', fallback_allowed: false,
        endpoint: OLLAMA_PRESTO_BASE_URL, model: OLLAMA_PRESTO_MODEL,
        label: 'LOCAL · PRESTO · Ollama',
      },
      image_to_video_generation: {
        host: 'presto', engine: 'comfyui', locality: 'local', fallback_allowed: false,
        endpoint: (process.env.AIGEN_PRESTO_BASE_URL || PRESTO_BASE_URL), workflow: 'wan22_i2v_vertical_1080x1920_30fps',
        label: 'LOCAL · PRESTO · ComfyUI Wan2.2',
      },
      manual_external_image_generation: {
        actor: 'human_operator', automation_allowed: false, import_allowed: true,
        label: 'MANUAL EXTERNAL · GPT image',
      },
      manual_external_i2v_generation: {
        actor: 'human_operator', automation_allowed: false, import_allowed: true,
        label: 'MANUAL EXTERNAL · KlingAI video',
      },
    },
    openai_image_generation: 'disabled',
    non_goals: mediaRouting.POLICY.non_goals,
    // referenced so the lane constants stay wired to this status payload
    lane_keys: Object.values(L),
  };
}
const DEFAULT_THUMBNAIL_PROVIDER = 'placeholder';
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';
const DEFAULT_OPENAI_IMAGE_SIZE = '1536x1024';
const DEFAULT_OPENAI_IMAGE_QUALITY = 'auto';
const DEFAULT_OPENAI_IMAGE_FORMAT = 'png';
const DEFAULT_OPENAI_IMAGE_TIMEOUT_MS = 120000;
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111827"/><text x="32" y="40" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#f9fafb">EF</text></svg>';
const CAPTURE_EVIDENCE_TARGETS = [
  'takes-log.md',
  'screen-recording-checklist.md',
  'audio-capture-checklist.md',
];
const CAPTURE_EVIDENCE_AUDIT_FILE = 'capture-evidence-intake-log.md';
const ROUGH_CUT_WATCH_NOTES_FILE = 'rough-cut-watch-notes.md';
const SECOND_CUT_CANDIDATE_FILE = 'second-cut-candidate.md';
const SECOND_CUT_WATCH_NOTES_FILE = 'second-cut-watch-notes.md';
const SECOND_CUT_REVIEW_FILE = 'second-cut-review.md';
const FINAL_CANDIDATE_FILE = 'final-candidate.md';
const FINAL_WATCH_NOTES_FILE = 'final-watch-notes.md';
const FINAL_REVIEW_FILE = 'final-review.md';
const EXPORT_CHECKLIST_FILE = 'export-checklist.md';
const MASTER_FILE_MANIFEST_FILE = 'master-file-manifest.md';
const CAPTION_CHECK_FILE = 'caption-check.md';
const LOUDNESS_CHECK_FILE = 'loudness-check.md';
const DELIVERY_READINESS_FILE = 'delivery-readiness.md';
const ROUGH_CUT_DERIVED_FILES = ['rough-cut-review.md', 'pickup-list.md', 'edit-fix-list.md'];
const SECOND_CUT_CANDIDATE_SECTION_START = '<!-- second-cut-candidate:start -->';
const SECOND_CUT_CANDIDATE_SECTION_END = '<!-- second-cut-candidate:end -->';
const SECOND_CUT_WATCH_NOTES_SECTION_START = '<!-- second-cut-watch-notes:start -->';
const SECOND_CUT_WATCH_NOTES_SECTION_END = '<!-- second-cut-watch-notes:end -->';
const SECOND_CUT_REVIEW_SECTION_START = '<!-- second-cut-review:start -->';
const SECOND_CUT_REVIEW_SECTION_END = '<!-- second-cut-review:end -->';
const FINAL_CANDIDATE_SECTION_START = '<!-- final-candidate:start -->';
const FINAL_CANDIDATE_SECTION_END = '<!-- final-candidate:end -->';
const FINAL_WATCH_NOTES_SECTION_START = '<!-- final-watch-notes:start -->';
const FINAL_WATCH_NOTES_SECTION_END = '<!-- final-watch-notes:end -->';
const FINAL_REVIEW_SECTION_START = '<!-- final-review:start -->';
const FINAL_REVIEW_SECTION_END = '<!-- final-review:end -->';
const MASTER_FILE_MANIFEST_SECTION_START = '<!-- master-file-manifest:start -->';
const MASTER_FILE_MANIFEST_SECTION_END = '<!-- master-file-manifest:end -->';
const DELIVERY_READINESS_SECTION_START = '<!-- delivery-readiness:start -->';
const DELIVERY_READINESS_SECTION_END = '<!-- delivery-readiness:end -->';
const CAPTION_CHECK_SECTION_START = '<!-- caption-check:start -->';
const CAPTION_CHECK_SECTION_END = '<!-- caption-check:end -->';
const LOUDNESS_CHECK_SECTION_START = '<!-- loudness-check:start -->';
const LOUDNESS_CHECK_SECTION_END = '<!-- loudness-check:end -->';
const EXPORT_CHECKLIST_SECTION_START = '<!-- export-checklist:start -->';
const EXPORT_CHECKLIST_SECTION_END = '<!-- export-checklist:end -->';
const PRODUCTION_GPS_ARTIFACTS = [
  'rough-cut-watch-notes.md',
  'second-cut-candidate.md',
  'second-cut-watch-notes.md',
  'final-candidate.md',
  'final-watch-notes.md',
  'manual-approval-notes.md',
  'rough-cut-review.md',
  'second-cut-review.md',
  'final-review.md',
  'master-file-manifest.md',
  'caption-check.md',
  'loudness-check.md',
  'delivery-readiness.md',
  'pickup-list.md',
  'edit-fix-list.md',
  'capture-evidence-review.md',
  'export-checklist.md',
  'publish-metadata-review.md',
  'package-run-state.md',
  'capture-checklist.md',
  'takes-log.md',
  'screen-recording-checklist.md',
  'audio-capture-checklist.md',
  'missing-shot-tracker.md',
];
const MEDIA_FILE_PATTERN = /\.(?:mp4|mov|mkv|webm|m4v|avi)$/i;
const ROUGH_CUT_APPROVAL_VALUES = ['NOT GIVEN', 'NEEDS PICKUPS', 'NEEDS EDIT FIXES', 'PASS'];
const SECOND_CUT_REVIEW_MARKERS = ['NEEDS MORE PICKUPS', 'NEEDS EDIT FIXES', 'READY FOR SECOND CUT'];
const FINAL_REVIEW_MARKERS = ['NEEDS FINAL FIXES', 'PASS'];
const DELIVERY_READINESS_MARKERS = ['NEEDS EXPORT CHECK', 'PASS'];
const PICKUP_ITEM_TYPES = ['presenter closeup', 'AI B-roll', 'screen zoom', 'graphic', 'edit-only fix', 'other'];
const PICKUP_REQUIRED_VALUES = ['yes', 'no'];
const PICKUP_SOURCES = ['existing material', 'new recording', 'AI generation', 'editing only'];
const PICKUP_PURPOSES = ['clarify message', 'add human presence', 'visual variety', 'proof support', 'pacing', 'other'];
const PICKUP_STATUSES = ['proposed', 'accepted', 'rejected', 'done'];
const CAPTURE_EVIDENCE_SECTION_START = '<!-- capture-evidence-intake:start -->';
const CAPTURE_EVIDENCE_SECTION_END = '<!-- capture-evidence-intake:end -->';
const EVIDENCE_INTAKE_DRAFT_SECTION_START = '<!-- evidence-intake-draft:start -->';
const EVIDENCE_INTAKE_DRAFT_SECTION_END = '<!-- evidence-intake-draft:end -->';
const LOCAL_WRITE_NONCE = crypto.randomBytes(24).toString('hex');
const LOCAL_WRITE_NONCE_HEADER = 'x-vidtoolz-local-write-nonce';
const HYPERFRAMES_DIR = 'hyperframes';
const HYPERFRAMES_COMPOSITIONS_DIR = 'compositions';
const HYPERFRAMES_RENDERS_DIR = 'renders';
const HYPERFRAMES_LOGS_DIR = 'logs';
const HYPERFRAMES_MANIFEST_FILE = 'hyperframes.json';
const HYPERFRAMES_PROBE_COMMAND = ['npx', '--no-install', 'hyperframes', '--help'];
const HYPERFRAMES_RENDER_COMMAND = ['npx', '--no-install', 'hyperframes', 'render'];
const HYPERFRAMES_PROBE_TTL_MS = 60 * 1000;
let hyperframesAvailabilityCache = null;
const EVIDENCE_INTAKE_MEDIA_TYPES = [
  'screen_capture',
  'camera_capture',
  'audio_capture',
  'generated_still',
  'generated_video',
  'kling_candidate',
  'resolve_timeline_test',
  'export_candidate',
  'other',
];
const EVIDENCE_INTAKE_SOURCE_CATEGORIES = [
  'A-roll',
  'B-roll',
  'screen proof',
  'generated asset',
  'Resolve test',
  'audio',
  'export',
  'other',
];
const EVIDENCE_INTAKE_STATUSES = [
  'planned',
  'exists_on_vidnas',
  'imported_to_resolve',
  'tested_in_resolve',
  'usable',
  'rejected',
  'missing',
];

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function loadPackageCandidates() {
  const candidatesPath = path.join(ROOT, 'package-candidates.json');
  if (fs.existsSync(candidatesPath)) {
    return readJsonFile(candidatesPath);
  }
  return null;
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function sendError(res, statusCode, message, code, extra) {
  send(res, statusCode, Object.assign({ ok: false, error: message || 'An error occurred', code: code || null }, extra || {}));
}

function sendJSON(res, statusCode, data) {
  send(res, statusCode, { ok: true, data: data });
}

function safeJoin(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0]);
  } catch (err) {
    return null;
  }
  const normalized = path.posix.normalize(decoded).replace(/^([.]{2}[\/])+/, '');
  const joined = path.join(root, normalized);
  if (!joined.startsWith(root)) return null;
  return joined;
}

function inferMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function makeDataUrl(label, idx) {
  const seed = crypto.createHash('sha1').update(`${label}:${idx}`).digest('hex').slice(0, 10);
  const hue = parseInt(seed.slice(0, 2), 16) % 360;
  const hue2 = (hue + 40) % 360;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="hsl(${hue} 75% 18%)"/>
          <stop offset="100%" stop-color="hsl(${hue2} 78% 52%)"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#g)"/>
      <rect x="72" y="72" width="1136" height="576" rx="36" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.24)"/>
      <text x="96" y="190" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700">${escapeXml(label)}</text>
      <text x="96" y="270" fill="#dbeafe" font-family="Arial, Helvetica, sans-serif" font-size="30">Generated thumbnail ${idx + 1}</text>
      <text x="96" y="340" fill="#bfdbfe" font-family="Arial, Helvetica, sans-serif" font-size="24">gpt-image-2</text>
    </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function captureEvidenceInputDefaults() {
  return {
    takeName: '',
    takeSource: '',
    takeReference: '',
    takeNotes: '',
    screenName: '',
    screenPurpose: '',
    screenReference: '',
    audioItem: '',
    audioRequirement: '',
    audioReference: '',
  };
}

function normalizeCaptureEvidenceFields(fields = {}) {
  const defaults = captureEvidenceInputDefaults();
  return Object.keys(defaults).reduce((result, key) => {
    result[key] = markdownCell(fields[key]);
    return result;
  }, {});
}

function missingRequiredCaptureFields(fields = {}) {
  const values = normalizeCaptureEvidenceFields(fields);
  const missing = [];
  if (!values.takeName) missing.push('take name');
  if (!values.takeReference) missing.push('take media reference');
  if (!values.screenName) missing.push('screen recording name');
  if (!values.screenReference) missing.push('screen recording file/reference');
  if (!values.audioItem) missing.push('audio item');
  if (!values.audioReference) missing.push('audio file/reference');
  return missing;
}

function formatCaptureEvidenceRows(fields = {}) {
  const input = normalizeCaptureEvidenceFields({ ...captureEvidenceInputDefaults(), ...fields });
  const missing = missingRequiredCaptureFields(input);
  const takeSource = input.takeSource || 'shot-list.md';
  const takeNotes = input.takeNotes || 'Human-reviewed captured take; add quality notes, timestamp, or issue.';
  const screenPurpose = input.screenPurpose || 'Capture proof for the approved production plan.';
  const audioRequirement = input.audioRequirement || 'Final script narration or A-roll audio.';
  return {
    valid: missing.length === 0,
    missing,
    targets: {
      'takes-log.md': `| ${input.takeName} | ${takeSource} | ${input.takeReference} | ${takeNotes} | captured |`,
      'screen-recording-checklist.md': `| ${input.screenName} | ${screenPurpose} | ${input.screenReference} | captured |`,
      'audio-capture-checklist.md': `| ${input.audioItem} | ${audioRequirement} | ${input.audioReference} | recorded |`,
    },
  };
}

function validateCaptureEvidenceRunId(runId) {
  const normalized = String(runId || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    const error = new Error('Invalid package-run id.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function validatePackageRunId(runId) {
  return validateCaptureEvidenceRunId(runId);
}

function validateCaptureEvidenceTargets(targets = CAPTURE_EVIDENCE_TARGETS) {
  const requested = Array.isArray(targets) && targets.length ? targets : CAPTURE_EVIDENCE_TARGETS;
  const unique = [...new Set(requested.map((target) => String(target || '').trim()))];
  const invalid = unique.filter((target) => !CAPTURE_EVIDENCE_TARGETS.includes(target));
  if (invalid.length) {
    const error = new Error(`Unapproved capture evidence target: ${invalid[0]}`);
    error.statusCode = 400;
    throw error;
  }
  return unique;
}

function resolvePackageRunDir(runId, options = {}) {
  const root = path.resolve(options.root || options.repoRoot || ROOT);
  const runsRoot = path.resolve(root, PACKAGE_RUNS_DIR);
  const safeRunId = validateCaptureEvidenceRunId(runId);
  const runDir = path.resolve(runsRoot, safeRunId);
  if (!runDir.startsWith(runsRoot + path.sep)) {
    const error = new Error('Package-run path escaped package-runs.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    const error = new Error('Package-run folder does not exist.');
    error.statusCode = 404;
    throw error;
  }
  return { root, runsRoot, runId: safeRunId, runDir };
}

// Find the script-image-assets folder(s) that belong to a run. The reliable
// link is each folder's generation-manifest.json -> source.source_path, which
// embeds the absolute path of a file inside package-runs/<runId>/. Title-based
// slug matching is NOT reliable (the asset folder is named from the script
// headline, which often differs from the package title), so we match the
// runId as a full path segment in the manifest instead. Read-only.
function findRunAssetFolders(runId, options = {}) {
  const safeRunId = validateCaptureEvidenceRunId(runId);
  const assetsRoot = path.resolve(options.assetsRoot || VIDNAS_SCRIPT_IMAGE_ASSETS_ROOT);
  if (!fs.existsSync(assetsRoot)) return [];
  const runSegment = new RegExp(`(^|[\\/])package-runs[\\/]${safeRunId}(?:[\\/]|$)`);
  const folders = [];
  let entries;
  try {
    entries = fs.readdirSync(assetsRoot, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.resolve(assetsRoot, entry.name);
    // Stay strictly inside the assets root.
    if (!folder.startsWith(assetsRoot + path.sep)) continue;
    const manifestPath = path.join(folder, 'generation-manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      continue;
    }
    const sourcePath = manifest && manifest.source ? String(manifest.source.source_path || '') : '';
    if (sourcePath && runSegment.test(sourcePath)) {
      folders.push(folder);
    }
  }
  return folders;
}

function sha256LocalFile(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunk = Buffer.allocUnsafe(8 * 1024 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

// Move one file into a flat destination directory without ever overwriting an
// existing archived file. On a name clash with a byte-identical file we treat it
// as already archived (and remove the source); on a clash with a different file
// we keep both by appending a disambiguator. Cross-share "move" = copy + verify
// + unlink, because the assets share and the archive share are different mounts
// (a plain rename would fail with EXDEV).
function moveFileNoClobber(srcPath, destDir, disambiguator) {
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(srcPath);
  const base = path.basename(srcPath, ext);
  const srcSize = fs.statSync(srcPath).size;
  let dest = path.join(destDir, base + ext);
  if (fs.existsSync(dest)) {
    // Identical file already archived — drop the source, report as deduped.
    if (fs.statSync(dest).size === srcSize && sha256LocalFile(dest) === sha256LocalFile(srcPath)) {
      fs.rmSync(srcPath, { force: true });
      return { dest, deduped: true };
    }
    // Different file with the same name — keep both.
    const tag = String(disambiguator || 'dup').replace(/[^A-Za-z0-9._-]+/g, '_');
    let n = 0;
    do {
      const suffix = n === 0 ? `__${tag}` : `__${tag}-${n}`;
      dest = path.join(destDir, base + suffix + ext);
      n += 1;
    } while (fs.existsSync(dest));
  }
  fs.copyFileSync(srcPath, dest);
  // Verify the copy landed fully before deleting the source.
  if (fs.statSync(dest).size !== srcSize) {
    fs.rmSync(dest, { force: true });
    const error = new Error('Copy verification failed (size mismatch).');
    error.statusCode = 500;
    throw error;
  }
  fs.rmSync(srcPath, { force: true });
  return { dest, deduped: false };
}

// Relocate a run's generated media to the ARCHIVED MEDIA folders: images -> STILL,
// videos -> VIDEO (both flat). Non-media files (manifests, script-blocks.json,
// image-prompts.json) are left in place on the Public share. Best-effort: per-file
// errors are collected, not thrown, so a single bad file never blocks the delete.
function relocateRunMedia(runId, options = {}) {
  const stillDir = options.archiveStillDir || VIDNAS_ARCHIVED_STILL_DIR;
  const videoDir = options.archiveVideoDir || VIDNAS_ARCHIVED_VIDEO_DIR;
  const folders = findRunAssetFolders(runId, options);
  const stats = { folders: [], stills: 0, videos: 0, deduped: 0, errors: [] };

  for (const folder of folders) {
    stats.folders.push(folder);
    const tag = path.basename(folder);
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        stats.errors.push({ path: dir, error: e.message });
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const isImage = ARCHIVE_IMAGE_EXT.test(entry.name);
          const isVideo = ARCHIVE_VIDEO_EXT.test(entry.name);
          if (!isImage && !isVideo) continue; // leave manifests/JSON in place
          try {
            const result = moveFileNoClobber(full, isVideo ? videoDir : stillDir, tag);
            if (result.deduped) stats.deduped += 1;
            else if (isVideo) stats.videos += 1;
            else stats.stills += 1;
          } catch (e) {
            stats.errors.push({ path: full, error: e.message });
          }
        }
      }
    };
    walk(folder);
  }
  return stats;
}

// Archive (non-destructive "delete") a package run. Two parts:
//   1. Relocate the run's generated media (FLUX stills + kling videos) to the
//      VIDNAS ARCHIVED MEDIA/STILL and /VIDEO folders. Non-media files stay put.
//   2. Move the run folder into package-runs/stale-runs/<runId>/ so it drops off
//      the resume list (stale-runs/ is excluded from the index) while every file
//      is preserved and recoverable.
// Confined to the resolved run dir + the assets/archive roots; gated on a local
// write nonce by the route handler.
function archivePackageRun(payload = {}, options = {}) {
  const resolved = resolvePackageRunDir(payload.runId, options);
  const staleRoot = path.join(resolved.runsRoot, 'stale-runs');
  // Collision-proof destination. A previous archive of the same run id used to
  // make this throw a 409 ("already exists in stale-runs"), which blocked the
  // Resume-page Delete button. Instead, keep the plain run id when free and
  // append a timestamp (then a counter) when it is taken — we never overwrite an
  // existing archive entry, and deletion always succeeds.
  let destName = resolved.runId;
  if (fs.existsSync(path.join(staleRoot, destName))) {
    const stamp = String(options.now || new Date().toISOString()).replace(/[-:.TZ]/g, '').slice(0, 14);
    destName = `${resolved.runId}-${stamp}`;
    let n = 1;
    while (fs.existsSync(path.join(staleRoot, destName))) {
      n += 1;
      destName = `${resolved.runId}-${stamp}-${n}`;
    }
  }
  const destDir = path.join(staleRoot, destName);
  // Relocate media first (run dir still in place), then archive the run folder.
  const media = relocateRunMedia(resolved.runId, options);
  fs.mkdirSync(staleRoot, { recursive: true });
  fs.renameSync(resolved.runDir, destDir);
  const archivedTo = `${PACKAGE_RUNS_DIR}/stale-runs/${destName}`;
  return {
    ok: true,
    runId: resolved.runId,
    run_id: resolved.runId,
    deleted: true,
    archivedTo,
    archived_to: archivedTo,
    recoverable: true,
    media,
  };
}

function readPackageRunState(runDir) {
  const statePath = path.join(runDir, 'package-run-state.md');
  if (!fs.existsSync(statePath)) return { explicit: false, state: 'active', raw: '' };
  const text = fs.readFileSync(statePath, 'utf8');
  const stateLine = text.match(/^\s*(?:[-*]\s*)?(?:State|Package run state):\s*([A-Za-z -]+)\s*$/im);
  const raw = stateLine ? stateLine[1].trim().toLowerCase() : '';
  const bodyActive = /\bactive\b/i.test(text) && !/\b(?:parked|superseded)\b/i.test(raw);
  const state = raw || (bodyActive ? 'active' : '');
  return { explicit: Boolean(raw || bodyActive), state: state || 'active', raw: state || '' };
}

function findActivePackageRun(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const runsRoot = path.resolve(root, PACKAGE_RUNS_DIR);
  if (!fs.existsSync(runsRoot)) {
    const error = new Error('package-runs folder does not exist.');
    error.statusCode = 404;
    throw error;
  }
  const dirs = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(name));
  const explicitActive = dirs.filter((runId) => {
    const state = readPackageRunState(path.join(runsRoot, runId));
    return state.explicit && state.state === 'active';
  });
  if (explicitActive.length === 1) {
    const runId = explicitActive[0];
    return { root, runsRoot, runId, runDir: path.join(runsRoot, runId) };
  }
  if (explicitActive.length > 1) {
    const error = new Error(`Multiple active package runs found: ${explicitActive.join(', ')}.`);
    error.statusCode = 409;
    throw error;
  }
  const activeByDefault = dirs.filter((runId) => {
    const state = readPackageRunState(path.join(runsRoot, runId));
    return !state.explicit || state.state === 'active';
  });
  if (activeByDefault.length === 1) {
    const runId = activeByDefault[0];
    return { root, runsRoot, runId, runDir: path.join(runsRoot, runId) };
  }
  const error = new Error('Could not determine exactly one active package run.');
  error.statusCode = 409;
  throw error;
}

function resolveRunFromPayload(payload = {}, options = {}) {
  if (payload.runId) return resolvePackageRunDir(payload.runId, options);
  return findActivePackageRun(options);
}

function validateHyperframesCompositionId(id = '') {
  const normalized = String(id || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    const error = new Error('Invalid HyperFrames composition id.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function hyperframesPaths(runDir) {
  const baseDir = path.join(runDir, HYPERFRAMES_DIR);
  return {
    baseDir,
    compositionsDir: path.join(baseDir, HYPERFRAMES_COMPOSITIONS_DIR),
    rendersDir: path.join(baseDir, HYPERFRAMES_RENDERS_DIR),
    logsDir: path.join(baseDir, HYPERFRAMES_LOGS_DIR),
    manifestPath: path.join(baseDir, HYPERFRAMES_MANIFEST_FILE),
  };
}

function hyperframesRelative(...parts) {
  return path.posix.join(HYPERFRAMES_DIR, ...parts);
}

function titleFromCompositionId(id = '') {
  return String(id || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Untitled composition';
}

function normalizeHyperframesStatus(value = '') {
  const status = String(value || '').trim();
  return ['not_rendered', 'rendered', 'failed', 'rendering'].includes(status) ? status : 'not_rendered';
}

function readHyperframesManifest(runDir) {
  const { manifestPath } = hyperframesPaths(runDir);
  if (!fs.existsSync(manifestPath)) {
    return { schema_version: 1, updated_at: null, compositions: [] };
  }
  try {
    const parsed = readJsonFile(manifestPath);
    return {
      schema_version: Number(parsed.schema_version) || 1,
      updated_at: parsed.updated_at || null,
      compositions: Array.isArray(parsed.compositions) ? parsed.compositions : [],
    };
  } catch (error) {
    return { schema_version: 1, updated_at: null, compositions: [], manifest_error: error.message };
  }
}

function compositionFromManifestItem(item = {}, fallbackId = '') {
  const id = validateHyperframesCompositionId(item.id || fallbackId);
  return {
    id,
    title: String(item.title || titleFromCompositionId(id)),
    source_html: String(item.source_html || hyperframesRelative(HYPERFRAMES_COMPOSITIONS_DIR, `${id}.html`)),
    preview_url: String(item.preview_url || `${HYPERFRAMES_PREVIEW_API}?runId=&id=${encodeURIComponent(id)}`),
    rendered_mp4: String(item.rendered_mp4 || hyperframesRelative(HYPERFRAMES_RENDERS_DIR, `${id}.mp4`)),
    status: normalizeHyperframesStatus(item.status),
    last_rendered_at: item.last_rendered_at || null,
    last_error: item.last_error || null,
    approved: Boolean(item.approved),
  };
}

function buildHyperframesComposition(runId, id, manifestItem = {}, renderedExists = false) {
  const base = compositionFromManifestItem({ ...manifestItem, id }, id);
  const renderedPath = hyperframesRelative(HYPERFRAMES_RENDERS_DIR, `${id}.mp4`);
  return {
    ...base,
    source_html: hyperframesRelative(HYPERFRAMES_COMPOSITIONS_DIR, `${id}.html`),
    preview_url: `${HYPERFRAMES_PREVIEW_API}?runId=${encodeURIComponent(runId)}&id=${encodeURIComponent(id)}`,
    rendered_mp4: renderedPath,
    status: base.status === 'not_rendered' && renderedExists ? 'rendered' : base.status,
    last_rendered_at: renderedExists && !base.last_rendered_at ? null : base.last_rendered_at,
  };
}

function discoverHyperframesCompositions(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const paths = hyperframesPaths(resolved.runDir);
  const manifest = readHyperframesManifest(resolved.runDir);
  const manifestById = new Map();
  manifest.compositions.forEach((item) => {
    try {
      const composition = compositionFromManifestItem(item);
      manifestById.set(composition.id, composition);
    } catch (_error) {
      // Invalid manifest ids are ignored so discovered HTML files can still show.
    }
  });
  const hasHyperframesDir = fs.existsSync(paths.baseDir) && fs.statSync(paths.baseDir).isDirectory();
  const hasCompositionsDir = fs.existsSync(paths.compositionsDir) && fs.statSync(paths.compositionsDir).isDirectory();
  const discoveredIds = hasCompositionsDir
    ? fs.readdirSync(paths.compositionsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.html$/i.test(entry.name))
        .map((entry) => path.basename(entry.name, path.extname(entry.name)))
        .filter((id) => /^[a-z0-9][a-z0-9-]*$/.test(id))
        .sort()
    : [];
  const allIds = [...new Set([...discoveredIds, ...manifestById.keys()])].sort();
  const compositions = allIds.map((id) => {
    const renderedPath = path.join(paths.rendersDir, `${id}.mp4`);
    return buildHyperframesComposition(resolved.runId, id, manifestById.get(id) || {}, fs.existsSync(renderedPath));
  });
  let laneStatus = 'no_directory';
  if (hasHyperframesDir && !compositions.length) laneStatus = 'no_compositions';
  if (compositions.some((item) => item.status === 'failed')) laneStatus = 'failed';
  else if (compositions.some((item) => item.status === 'rendering')) laneStatus = 'rendering';
  else if (compositions.some((item) => item.status === 'rendered')) laneStatus = 'rendered';
  else if (compositions.length) laneStatus = 'not_rendered';
  return {
    ok: true,
    runId: resolved.runId,
    runPath: path.relative(resolved.root, resolved.runDir).replace(/\\/g, '/'),
    availability: probeHyperframesAvailability(options),
    lane: {
      status: laneStatus,
      hasHyperframesDir,
      hasCompositionsDir,
      compositionsCount: compositions.length,
      manifestPath: fs.existsSync(paths.manifestPath) ? hyperframesRelative(HYPERFRAMES_MANIFEST_FILE) : '',
      manifestError: manifest.manifest_error || null,
    },
    manifest: {
      schema_version: manifest.schema_version,
      updated_at: manifest.updated_at,
      compositions,
    },
  };
}

function writeHyperframesManifest(runDir, compositions = []) {
  const paths = hyperframesPaths(runDir);
  fs.mkdirSync(paths.baseDir, { recursive: true });
  const manifest = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    compositions: compositions.map((item) => compositionFromManifestItem(item)),
  };
  fs.writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function updateHyperframesComposition(runDir, runId, id, patch = {}, options = {}) {
  const paths = hyperframesPaths(runDir);
  fs.mkdirSync(paths.rendersDir, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const discovered = discoverHyperframesCompositions({ runId }, { root: options.root || path.dirname(path.dirname(runDir)) });
  const current = discovered.manifest.compositions;
  const existing = current.find((item) => item.id === id) || buildHyperframesComposition(runId, id);
  const next = current.filter((item) => item.id !== id);
  next.push({ ...existing, ...patch, id, approved: Boolean(existing.approved && patch.approved !== false) });
  return writeHyperframesManifest(runDir, next.sort((a, b) => a.id.localeCompare(b.id)));
}

function resolveHyperframesCompositionFile(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const id = validateHyperframesCompositionId(payload.id || payload.compositionId);
  const paths = hyperframesPaths(resolved.runDir);
  const sourcePath = path.resolve(paths.compositionsDir, `${id}.html`);
  const compositionRoot = path.resolve(paths.compositionsDir);
  if (!sourcePath.startsWith(compositionRoot + path.sep)) {
    const error = new Error('HyperFrames preview path escaped compositions directory.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    const error = new Error('HyperFrames composition HTML does not exist.');
    error.statusCode = 404;
    throw error;
  }
  return { ...resolved, id, ...paths, sourcePath };
}

function parseHyperframesVersion(output = '') {
  const text = String(output || '');
  const explicit = text.match(/\b(?:hyperframes\s+)?v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i);
  return explicit ? explicit[1] : '';
}

// Condense a failed HyperFrames probe's stdout/stderr into ONE concise line.
// The raw output can be a multi-line Node stack trace; the dashboard/mission-control
// availability cards render this verbatim, so it must stay short and friendly.
function condenseHyperframesProbeError(combined, fallback) {
  const text = String(combined || '').trim();
  if (!text) return fallback || 'HyperFrames CLI unavailable.';
  // Node ESM/version mismatch (e.g. `styleText` import requires Node >= 20).
  if (/styleText|does not provide an export/i.test(text)) {
    const nodeVer = (text.match(/Node\.js\s+v?(\d+)/i) || [])[1];
    return `HyperFrames CLI needs Node >= 20${nodeVer ? ` (probe ran under Node ${nodeVer})` : ''}.`;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errLine = lines.find((l) => /(error|not found|cannot|enoent|command not found)/i.test(l)) || lines[0] || '';
  return errLine.length > 200 ? `${errLine.slice(0, 197)}…` : errLine;
}

function probeHyperframesAvailability(options = {}) {
  const now = Date.now();
  if (!options.force && hyperframesAvailabilityCache && now - hyperframesAvailabilityCache.checkedAtMs < HYPERFRAMES_PROBE_TTL_MS) {
    return hyperframesAvailabilityCache.value;
  }
  const command = options.probeCommand || HYPERFRAMES_PROBE_COMMAND;
  const runner = options.runner || childProcess.spawnSync;
  const checkedAt = new Date().toISOString();
  let result;
  try {
    result = runner(command[0], command.slice(1), {
      cwd: options.cwd || ROOT,
      encoding: 'utf8',
      timeout: options.timeoutMs || 15000,
      env: { ...process.env, npm_config_yes: 'false' },
    });
  } catch (error) {
    const value = {
      available: false,
      command: command.join(' '),
      version: '',
      error: error.message,
      checked_at: checkedAt,
    };
    hyperframesAvailabilityCache = { checkedAtMs: now, value };
    return value;
  }
  const stdout = result && result.stdout ? String(result.stdout) : '';
  const stderr = result && result.stderr ? String(result.stderr) : '';
  const combined = `${stdout}\n${stderr}`.trim();
  const value = {
    available: Boolean(result && result.status === 0),
    command: command.join(' '),
    version: parseHyperframesVersion(combined),
    error: result && result.status === 0 ? '' : condenseHyperframesProbeError(combined, result && result.error && result.error.message),
    checked_at: checkedAt,
  };
  hyperframesAvailabilityCache = { checkedAtMs: now, value };
  return value;
}

function hyperframesRenderCommand(sourcePath, outputPath, renderFormat) {
  // hyperframes 0.7.x renders a PROJECT DIR: `render <dir> -c <composition> -o <output>`.
  // The run's hyperframes/ dir is the project (it carries an index.html marker); the
  // composition is referenced relative to it. (Earlier `render <file> <output>` form was
  // incompatible with the installed CLI.)
  // renderFormat (alpha slice 2026-07-21): 'mov' appends `--format mov` (ProRes
  // 4444 with alpha). Absent/null keeps the command byte-identical to before.
  const projectDir = path.dirname(path.dirname(sourcePath));
  const compositionRel = path.relative(projectDir, sourcePath);
  const formatArgs = renderFormat === 'mov' ? ['--format', 'mov'] : [];
  return [...HYPERFRAMES_RENDER_COMMAND, projectDir, '-c', compositionRel, '-o', outputPath, ...formatArgs];
}

function runHyperframesRenderCommand(sourcePath, outputPath, logPath, options = {}) {
  const command = options.renderCommand || hyperframesRenderCommand(sourcePath, outputPath, options.renderFormat);
  const runner = options.runner || childProcess.spawnSync;
  const result = runner(command[0], command.slice(1), {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    timeout: options.timeoutMs || 5 * 60 * 1000,
    env: { ...process.env, npm_config_yes: 'false' },
  });
  const stdout = result && result.stdout ? String(result.stdout) : '';
  const stderr = result && result.stderr ? String(result.stderr) : '';
  fs.writeFileSync(logPath, [
    `Command: ${command.join(' ')}`,
    `Exit code: ${result && typeof result.status === 'number' ? result.status : 'unknown'}`,
    '',
    'STDOUT:',
    stdout,
    '',
    'STDERR:',
    stderr,
  ].join('\n'), 'utf8');
  if (!result || result.status !== 0) {
    const error = new Error((stderr || stdout || (result && result.error && result.error.message) || 'HyperFrames render failed.').trim());
    error.statusCode = 500;
    error.command = command.join(' ');
    throw error;
  }
  return {
    ok: true,
    command: command.join(' '),
    stdout,
    stderr,
  };
}

function renderHyperframesComposition(payload = {}, options = {}) {
  const target = resolveHyperframesCompositionFile(payload, options);
  const outputPath = path.join(target.rendersDir, `${target.id}.mp4`);
  const logPath = path.join(target.logsDir, `${target.id}.log`);
  fs.mkdirSync(target.rendersDir, { recursive: true });
  fs.mkdirSync(target.logsDir, { recursive: true });
  updateHyperframesComposition(target.runDir, target.runId, target.id, {
    status: 'rendering',
    last_error: null,
    rendered_mp4: hyperframesRelative(HYPERFRAMES_RENDERS_DIR, `${target.id}.mp4`),
  }, { root: target.root });
  try {
    const renderResult = (options.renderer || runHyperframesRenderCommand)(target.sourcePath, outputPath, logPath, options);
    const manifest = updateHyperframesComposition(target.runDir, target.runId, target.id, {
      status: 'rendered',
      last_rendered_at: new Date().toISOString(),
      last_error: null,
      rendered_mp4: hyperframesRelative(HYPERFRAMES_RENDERS_DIR, `${target.id}.mp4`),
      approved: false,
    }, { root: target.root });
    return {
      ok: true,
      runId: target.runId,
      id: target.id,
      source_html: hyperframesRelative(HYPERFRAMES_COMPOSITIONS_DIR, `${target.id}.html`),
      rendered_mp4: hyperframesRelative(HYPERFRAMES_RENDERS_DIR, `${target.id}.mp4`),
      log: hyperframesRelative(HYPERFRAMES_LOGS_DIR, `${target.id}.log`),
      command: renderResult.command || hyperframesRenderCommand(target.sourcePath, outputPath).join(' '),
      approved: false,
      manifest,
    };
  } catch (error) {
    const message = String(error.message || 'HyperFrames render failed.');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, `${message}\n`, 'utf8');
    }
    const manifest = updateHyperframesComposition(target.runDir, target.runId, target.id, {
      status: 'failed',
      last_error: message,
      rendered_mp4: hyperframesRelative(HYPERFRAMES_RENDERS_DIR, `${target.id}.mp4`),
      approved: false,
    }, { root: target.root });
    error.manifest = manifest;
    error.statusCode = error.statusCode || 500;
    throw error;
  }
}

function roughCutInputDefaults() {
  return {
    reviewedFilePath: '',
    reviewedFileType: '',
    watchDate: new Date().toISOString().slice(0, 10),
    reviewer: 'Mikko',
    first30SecondsNotes: '',
    clarityNotes: '',
    pacingNotes: '',
    proofEvidenceNotes: '',
    missingVisuals: '',
    audioProblems: '',
    graphicsProblems: '',
    confusingSections: '',
    sectionsToCutTighten: '',
    pickupsNeeded: '',
    editFixesNeeded: '',
    secondCutRecommendation: '',
    roughCutApprovalMarker: 'NOT GIVEN',
  };
}

function normalizeRoughCutFields(fields = {}) {
  const defaults = roughCutInputDefaults();
  const normalized = Object.keys(defaults).reduce((result, key) => {
    result[key] = typeof defaults[key] === 'string' ? markdownText(fields[key], '') : fields[key];
    return result;
  }, {});
  normalized.watchDate = markdownCell(normalized.watchDate || defaults.watchDate);
  normalized.reviewer = markdownCell(normalized.reviewer || defaults.reviewer);
  normalized.reviewedFilePath = markdownCell(normalized.reviewedFilePath);
  normalized.reviewedFileType = markdownCell(normalized.reviewedFileType);
  normalized.roughCutApprovalMarker = String(fields.roughCutApprovalMarker || defaults.roughCutApprovalMarker).trim().toUpperCase();
  if (!ROUGH_CUT_APPROVAL_VALUES.includes(normalized.roughCutApprovalMarker)) {
    const error = new Error(`Invalid rough-cut approval marker: ${normalized.roughCutApprovalMarker}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function missingRequiredRoughCutFields(fields = {}) {
  const values = normalizeRoughCutFields(fields);
  return [
    ['reviewedFilePath', 'reviewed file path'],
    ['reviewedFileType', 'reviewed file type'],
    ['watchDate', 'watch date'],
    ['reviewer', 'reviewer'],
    ['first30SecondsNotes', 'first 30 seconds notes'],
    ['clarityNotes', 'clarity notes'],
    ['pacingNotes', 'pacing notes'],
    ['proofEvidenceNotes', 'proof/evidence notes'],
    ['secondCutRecommendation', 'second-cut recommendation'],
  ].filter(([key]) => !String(values[key] || '').trim()).map(([, label]) => label);
}

function buildRoughCutWatchNotesMarkdown(runId, fields = {}) {
  const input = normalizeRoughCutFields(fields);
  const markerLine = input.roughCutApprovalMarker === 'PASS'
    ? 'Rough-cut approval: PASS'
    : `Rough-cut approval: ${input.roughCutApprovalMarker}`;
  return `# Rough-Cut Watch Notes

- Run: ${runId}
- Tool: package-runs dashboard rough-cut input console
- Status: human-entered review notes
- External APIs called: no

## Rough-Cut Version Reviewed

- Reviewed file path: ${input.reviewedFilePath}
- Reviewed file type: ${input.reviewedFileType}

## Watch Date

${input.watchDate}

## Reviewer

${input.reviewer}

## First 30 Seconds Notes

${markdownText(input.first30SecondsNotes)}

## Clarity Notes

${markdownText(input.clarityNotes)}

## Pacing Notes

${markdownText(input.pacingNotes)}

## Proof / Evidence Notes

${markdownText(input.proofEvidenceNotes)}

## Missing Visuals

${markdownText(input.missingVisuals)}

## Audio Problems

${markdownText(input.audioProblems)}

## Graphics Problems

${markdownText(input.graphicsProblems)}

## Confusing Sections

${markdownText(input.confusingSections)}

## Sections to Cut / Tighten

${markdownText(input.sectionsToCutTighten)}

## Pickups Needed

${markdownText(input.pickupsNeeded)}

## Edit Fixes Needed

${markdownText(input.editFixesNeeded)}

## Second-Cut Recommendation

${markdownText(input.secondCutRecommendation)}

## Manual Rough-Cut Approval Marker

${markerLine}
`;
}

function extractReviewedFilePath(markdown = '') {
  const text = String(markdown || '');
  const explicit = text.match(/Reviewed file(?: path)?:\s*(.+)$/im);
  if (explicit) return explicit[1].trim();
  const version = text.match(/## Rough-Cut Version Reviewed\s+([\s\S]*?)(?:\n## |\s*$)/i);
  if (!version) return '';
  const candidate = version[1].split(/\r?\n/).map((line) => line.replace(/^\s*[-*]\s*/, '').trim()).find((line) => /\.(?:mp4|mov|mkv|webm|m4v)\b/i.test(line));
  return candidate || '';
}

function detectRoughCutCandidate(runDir) {
  const watchNotes = fs.existsSync(path.join(runDir, ROUGH_CUT_WATCH_NOTES_FILE))
    ? fs.readFileSync(path.join(runDir, ROUGH_CUT_WATCH_NOTES_FILE), 'utf8')
    : '';
  const fromNotes = extractReviewedFilePath(watchNotes);
  if (fromNotes) return { path: fromNotes, source: ROUGH_CUT_WATCH_NOTES_FILE };
  const mediaExt = /\.(?:mp4|mov|mkv|webm|m4v)$/i;
  const found = [];
  function walk(dir, depth = 0) {
    if (depth > 4 || found.length) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (found.length) return;
      if (entry.name.startsWith('.')) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (mediaExt.test(entry.name) && /rough|cut|review|candidate|timeline|edit/i.test(fullPath)) {
        found.push(fullPath);
      }
    });
  }
  walk(runDir);
  if (found.length) return { path: path.relative(runDir, found[0]).replace(/\\/g, '/'), source: 'media scan' };
  return { path: '', source: '' };
}

function parseRoughCutReviewStdout(stdout = '') {
  const text = String(stdout || '');
  const line = (label) => {
    const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
    return match ? match[1].trim() : '';
  };
  const written = [...text.matchAll(/^(created|overwritten|unchanged):\s*(.+)$/gim)].map((match) => ({
    status: match[1],
    path: match[2],
  }));
  return {
    roughCutReviewStatus: line('rough-cut review'),
    secondCutReady: /^yes$/i.test(line('second-cut ready')),
    reason: line('reason'),
    written,
    pickupListStatus: (written.find((item) => /pickup-list\.md$/.test(item.path)) || {}).status || '',
    editFixListStatus: (written.find((item) => /edit-fix-list\.md$/.test(item.path)) || {}).status || '',
  };
}

function parseRoughCutReviewFile(runDir) {
  const reviewPath = path.join(runDir, 'rough-cut-review.md');
  const text = fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, 'utf8') : '';
  const pickupPath = path.join(runDir, 'pickup-list.md');
  const fixPath = path.join(runDir, 'edit-fix-list.md');
  const watchNotes = fs.existsSync(path.join(runDir, ROUGH_CUT_WATCH_NOTES_FILE))
    ? fs.readFileSync(path.join(runDir, ROUGH_CUT_WATCH_NOTES_FILE), 'utf8')
    : '';
  let currentReview = { verdict: { status: '', secondCutReady: false, reason: '' }, context: { pickups: [], editFixes: [] } };
  try {
    currentReview = roughCutReviewScript.buildOutputs(runDir);
  } catch (_error) {
    currentReview = { verdict: { status: '', secondCutReady: false, reason: '' }, context: { pickups: [], editFixes: [] } };
  }
  const roughCutReviewStatus = lineValue(text, 'Rough-cut review status') || 'NOT STARTED';
  const currentWatchNotesMarker = lineValue(watchNotes, 'Rough-cut approval') || lineValue(watchNotes, 'Manual approval') || 'NOT GIVEN';
  const reviewClaimsStarterTemplate =
    /Rough-cut notes source:\s*created starter template/i.test(text) ||
    /starter template created|watch-notes\.md was missing/i.test(text);
  const currentHasHumanWatchNotes = Boolean(watchNotes) && !roughCutReviewScript.isStarterWatchNotes(watchNotes);
  const derivedArtifactStale =
    Boolean(text) &&
    currentHasHumanWatchNotes &&
    (
      reviewClaimsStarterTemplate ||
      (currentReview.verdict.status && currentReview.verdict.status !== roughCutReviewStatus) ||
      (currentReview.verdict.secondCutReady !== /^yes$/i.test(lineValue(text, 'Second-cut ready')))
    );
  const staleReason = derivedArtifactStale
    ? `Current watch notes say ${currentWatchNotesMarker}; regenerated rough-cut review would report ${currentReview.verdict.status || 'unknown'}, while rough-cut-review.md reports ${roughCutReviewStatus}.`
    : '';
  return {
    roughCutReviewStatus,
    secondCutReady: /^yes$/i.test(lineValue(text, 'Second-cut ready')),
    reason: lineValue(text, 'Reason') || lineValue(text, 'Status') || '',
    reviewedFilePath: extractReviewedFilePath(watchNotes),
    approvalMarker: currentWatchNotesMarker,
    currentWatchNotesMarker,
    pickupListStatus: fs.existsSync(pickupPath) ? summarizeListStatus(fs.readFileSync(pickupPath, 'utf8')) : 'missing',
    editFixListStatus: fs.existsSync(fixPath) ? summarizeListStatus(fs.readFileSync(fixPath, 'utf8')) : 'missing',
    currentDerivedStatus: currentReview.verdict.status || '',
    currentDerivedSecondCutReady: Boolean(currentReview.verdict.secondCutReady),
    currentPickupsDetected: Array.isArray(currentReview.context.pickups) ? currentReview.context.pickups.length : 0,
    currentEditFixesDetected: Array.isArray(currentReview.context.editFixes) ? currentReview.context.editFixes.length : 0,
    derivedArtifactStale,
    staleReason,
    regenerationRecommended: derivedArtifactStale,
    artifactPath: 'rough-cut-review.md',
  };
}

function summarizeListStatus(markdown = '') {
  const text = String(markdown || '');
  if (/\|\s*open\s*\|?\s*$/im.test(text)) return 'open';
  if (/\|\s*blocked\s*\|?\s*$/im.test(text)) return 'blocked';
  if (/\|\s*accepted\s*\|?\s*$/im.test(text)) return 'accepted';
  if (/\|\s*proposed\s*\|?\s*$/im.test(text)) return 'proposed';
  if (/\|\s*done\s*\|?\s*$/im.test(text)) return 'done';
  if (/\|\s*closed\s*\|?\s*$/im.test(text)) return 'closed';
  return text.trim() ? 'present' : 'empty';
}

function dashboardIndexStatus(resolved) {
  const indexPath = path.join(resolved.root, 'package-runs-index.json');
  if (!fs.existsSync(indexPath)) return { exists: false, updatedForActiveRun: false, reason: 'package-runs-index.json is missing.' };
  const indexMtime = fs.statSync(indexPath).mtimeMs;
  let newestRunMtime = 0;
  fs.readdirSync(resolved.runDir, { withFileTypes: true }).forEach((entry) => {
    if (!entry.isFile()) return;
    newestRunMtime = Math.max(newestRunMtime, fs.statSync(path.join(resolved.runDir, entry.name)).mtimeMs);
  });
  return {
    exists: true,
    updatedForActiveRun: indexMtime >= newestRunMtime,
    indexPath: 'package-runs-index.json',
    indexUpdatedAt: new Date(indexMtime).toISOString(),
    newestRunArtifactAt: newestRunMtime ? new Date(newestRunMtime).toISOString() : '',
    reason: indexMtime >= newestRunMtime
      ? 'package-runs-index.json is at least as new as active run root files.'
      : 'package-runs-index.json is older than one or more active run root files.',
  };
}

function gateStatus(label, status, reason, artifactPath, allowedNextAction) {
  return { label, status, reason, artifactPath, allowedNextAction };
}

function buildGateTimeline(doctor = {}, roughCut = {}) {
  const gate = doctor.lifecycleGate || {};
  const researchStatus = gate.researchSufficiencyReviewStatus === 'PASS' || gate.researchApprovalMarker === 'PASS' ? 'PASS' : gate.researchGateStatus || 'NOT STARTED';
  const scriptStatus = gate.scriptReviewStatus === 'PASS' ? 'PASS' : gate.scriptReviewStatus || (gate.readyToDraft ? 'NEEDS REVIEW' : 'NOT STARTED');
  const productionStatus =
    gate.productionPlanningBlocked || gate.productionApprovalBlocked || gate.productionBlockersOpen
      ? 'BLOCKED'
      : gate.productionPlanStatus === 'READY TO SHOOT'
        ? 'PASS'
        : gate.productionPlanStatus
          ? 'NEEDS WORK'
          : 'NOT STARTED';
  const captureStatus = gate.captureEvidenceAccepted ? 'PASS' : gate.hasCaptureEvidenceReview ? 'NEEDS REVIEW' : 'NOT STARTED';
  const roughStatus = roughCut.roughCutReviewStatus === 'READY FOR SECOND CUT'
    ? 'PASS'
    : roughCut.roughCutReviewStatus === 'NOT STARTED'
      ? 'NOT STARTED'
      : roughCut.roughCutReviewStatus || 'NOT STARTED';
  const pickupsStatus =
    roughStatus === 'NEEDS PICKUPS' || roughCut.pickupListStatus === 'open' || roughCut.pickupListStatus === 'accepted' || roughCut.pickupListStatus === 'proposed'
      ? 'NEEDS WORK'
      : roughCut.pickupListStatus === 'done' || roughCut.pickupListStatus === 'closed'
        ? 'PASS'
        : roughStatus === 'PASS'
          ? 'PASS'
          : 'LOCKED';
  const secondCutStatus = gate.secondCutReady ? 'PASS' : gate.roughCutStatus ? 'LOCKED' : 'NOT STARTED';
  return [
    gateStatus('Research', researchStatus, `Research review: ${gate.researchSufficiencyReviewStatus || gate.researchGateStatus || 'missing'}.`, 'research-sufficiency-review.md', researchStatus === 'PASS' ? 'Continue to package/script gates.' : 'Complete research review.'),
    gateStatus('Package', doctor.title ? 'PASS' : 'NEEDS REVIEW', doctor.title ? `Selected package: ${doctor.title}.` : 'Selected package is missing.', 'selected-package.md', 'Keep selected package aligned with proof.'),
    gateStatus('Script', scriptStatus, `Script review status: ${gate.scriptReviewStatus || 'missing'}.`, 'script-review.md', scriptStatus === 'PASS' ? 'Continue to production planning.' : 'Repair script and rerun script review.'),
    gateStatus('Production Plan', productionStatus, `Production plan status: ${gate.productionPlanStatus || 'missing'}.`, 'production-plan.md', productionStatus === 'PASS' ? 'Use approved planning scope only.' : gate.productionPlanningNextSafeAction || 'Repair production plan.'),
    gateStatus('Capture Evidence', captureStatus, `Capture evidence status: ${gate.captureEvidenceReviewStatus || 'missing'}; accepted: ${gate.captureEvidenceAccepted ? 'yes' : 'no'}.`, 'capture-evidence-review.md', gate.captureEvidenceAccepted ? 'Proceed to rough-cut review.' : gate.captureEvidenceNextSafeAction || 'Complete capture evidence review.'),
    gateStatus('Rough Cut', roughStatus, roughCut.reason || `Rough-cut status: ${roughCut.roughCutReviewStatus || gate.roughCutStatus || 'missing'}.`, 'rough-cut-review.md', roughStatus === 'PASS' ? 'Proceed to second cut.' : 'Enter Mikko watch notes and resolve review result.'),
    gateStatus('Pickups', pickupsStatus, `Pickup list status: ${roughCut.pickupListStatus || 'missing'}.`, 'pickup-list.md', pickupsStatus === 'NEEDS WORK' ? 'Accept, reject, or complete proposed pickups.' : 'No pickup action available until rough-cut review requires it.'),
    gateStatus('Second Cut', secondCutStatus, `Second-cut ready: ${gate.secondCutReady ? 'yes' : 'no'}.`, 'rough-cut-review.md', gate.secondCutReady ? 'Create second cut and move to final review.' : 'Locked until rough cut passes.'),
    gateStatus('Final Review', gate.finalReviewStatus === 'PASS' ? 'PASS' : gate.secondCutReady ? 'NEEDS REVIEW' : 'LOCKED', `Final review status: ${gate.finalReviewStatus || 'missing'}.`, 'final-review.md', gate.secondCutReady ? 'Run final review after second cut.' : 'Locked until second cut is ready.'),
    gateStatus('Export', gate.effectiveReadyToUpload ? 'PASS' : gate.finalReviewStatus ? 'NEEDS REVIEW' : 'LOCKED', `Export status: ${gate.exportStatus || 'missing'}.`, 'export-checklist.md', 'Run export check after final review.'),
    gateStatus('Publish', gate.effectiveReadyToSchedule ? 'PASS' : gate.effectiveReadyToUpload ? 'NEEDS REVIEW' : 'LOCKED', `Publication metadata status: ${gate.publicationMetadataStatus || 'missing'}.`, 'publish-metadata-review.md', 'Prepare publish metadata after export check.'),
    gateStatus('Archive', gate.effectiveReadyToArchive ? 'PASS' : gate.effectiveReadyToSchedule ? 'NEEDS REVIEW' : 'LOCKED', `Archive status: ${gate.archiveStatus || 'missing'}.`, 'archive-manifest.md', 'Archive only after publication metadata is ready.'),
  ];
}

function collectMediaRows(resolved, roughCutCandidate) {
  const rows = [];
  const add = (filePath, type, status) => {
    if (!filePath) return;
    rows.push({
      path: filePath,
      type,
      status,
      openAllowed: isSafeOpenPath(filePath, resolved),
    });
  };
  add(roughCutCandidate.path, 'reviewed file', roughCutCandidate.path ? 'reviewed/current' : 'missing');
  const mediaFiles = [];
  function walk(dir, depth = 0) {
    if (depth > 4 || mediaFiles.length > 60) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.name.startsWith('.')) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(fullPath, depth + 1);
      if (!/\.(?:mp4|mov|mkv|webm|m4v|wav|mp3|m4a|flac)$/i.test(entry.name)) return;
      mediaFiles.push(fullPath);
    });
  }
  walk(resolved.runDir);
  mediaFiles.forEach((fullPath) => {
    const rel = path.relative(resolved.runDir, fullPath).replace(/\\/g, '/');
    const lower = rel.toLowerCase();
    const type = /\.(?:wav|mp3|m4a|flac)$/i.test(rel)
      ? 'audio clip'
      : /screen|capture|recording/.test(lower)
        ? 'candidate screen recording'
        : /a-?roll|talk|presenter|camera/.test(lower)
          ? 'A-roll clip'
          : 'media candidate';
    add(rel, type, 'detected');
  });
  return rows.filter((row, index, list) => list.findIndex((item) => item.path === row.path) === index);
}

function walkMediaFiles(rootDir, options = {}) {
  const found = [];
  const maxDepth = options.maxDepth ?? 6;
  const maxFiles = options.maxFiles ?? 240;
  function walk(dir, depth = 0) {
    if (!dir || depth > maxDepth || found.length >= maxFiles || !fs.existsSync(dir)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    entries.forEach((entry) => {
      if (entry.name.startsWith('.') || found.length >= maxFiles) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (MEDIA_FILE_PATTERN.test(entry.name)) {
        found.push(fullPath);
      }
    });
  }
  walk(rootDir);
  return found;
}

function mediaSearchRoots(resolved, options = {}) {
  const videoRoot = path.resolve(options.videoRoot || path.join(process.env.HOME || '', 'Videos'));
  return [
    resolved.runDir,
    path.join(videoRoot, 'vidtoolz-captures', resolved.runId),
    path.join(videoRoot, resolved.runId),
  ].filter((item, index, list) => item && fs.existsSync(item) && list.indexOf(item) === index);
}

function ffprobeMetadata(filePath, options = {}) {
  const base = {
    duration: '',
    codec: '',
    resolution: '',
    frameRate: '',
    audioPresent: false,
    audioStreamPresent: false,
    metadataUnavailable: true,
  };
  const runner = options.ffprobeRunner || childProcess.spawnSync;
  let result;
  try {
    result = runner('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], {
      encoding: 'utf8',
      timeout: 8000,
    });
  } catch (_error) {
    return base;
  }
  if (!result || result.status !== 0 || !result.stdout) return base;
  try {
    const payload = JSON.parse(result.stdout);
    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video') || {};
    const audio = streams.some((stream) => stream.codec_type === 'audio');
    const rate = String(video.avg_frame_rate || video.r_frame_rate || '');
    const frameRate = rate && rate.includes('/')
      ? (() => {
          const [num, den] = rate.split('/').map(Number);
          return den ? String(Math.round((num / den) * 1000) / 1000) : '';
        })()
      : rate;
    return {
      duration: payload.format && payload.format.duration ? String(Math.round(Number(payload.format.duration) * 100) / 100) : '',
      codec: video.codec_name || '',
      resolution: video.width && video.height ? `${video.width}x${video.height}` : '',
      frameRate,
      audioPresent: audio,
      audioStreamPresent: audio,
      metadataUnavailable: false,
    };
  } catch (_error) {
    return base;
  }
}

function mediaFileBase(filePath) {
  const stat = fs.statSync(filePath);
  return {
    filename: path.basename(filePath),
    path: filePath,
    exists: true,
    modifiedTime: stat.mtime.toISOString(),
    size: stat.size,
  };
}

function validateSecondCutCandidatePath(candidatePath, label = 'second-cut candidate') {
  const title = label.replace(/^\w/, (char) => char.toUpperCase());
  const requested = markdownCell(candidatePath || '');
  if (!requested) {
    const error = new Error(`${title} path is required.`);
    error.statusCode = 400;
    throw error;
  }
  if (!path.isAbsolute(requested)) {
    const error = new Error(`${title} path must be an absolute path.`);
    error.statusCode = 400;
    throw error;
  }
  const absolute = path.resolve(requested);
  if (!MEDIA_FILE_PATTERN.test(absolute)) {
    const error = new Error(`Unsupported ${label} extension.`);
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(absolute)) {
    const error = new Error(`${title} file does not exist.`);
    error.statusCode = 404;
    throw error;
  }
  if (!fs.statSync(absolute).isFile()) {
    const error = new Error(`${title} path must be a file.`);
    error.statusCode = 400;
    throw error;
  }
  return absolute;
}

function likelyMediaRole(filePath) {
  const text = filePath.toLowerCase();
  const reasons = [];
  if (/(second[-_ ]?cut|secondcut|second_cut|cut[-_ ]?2|\bv2\b)/i.test(text)) {
    reasons.push('filename/path suggests second cut');
    return { likelyRole: 'second-cut candidate', confidence: 'high', reasons };
  }
  if (/(candidate|review)/i.test(text) && !/pickup/i.test(text)) {
    reasons.push('filename/path suggests review candidate');
    return { likelyRole: 'second-cut candidate', confidence: 'medium', reasons };
  }
  if (/pickup|closeup|b-roll|broll|hands|keyboard|mouse|over[-_ ]?shoulder|talking/i.test(text)) {
    reasons.push('filename/path suggests pickup media');
    return { likelyRole: 'pickup media', confidence: 'medium', reasons };
  }
  if (/rough[-_ ]?cut|cut[-_ ]?1|\bv1\b/i.test(text)) {
    reasons.push('filename/path suggests rough cut');
    return { likelyRole: 'rough cut', confidence: 'medium', reasons };
  }
  return { likelyRole: 'unknown', confidence: 'low', reasons: ['no reliable role pattern matched'] };
}

function classifyPickupCategory(filePath) {
  const text = filePath.toLowerCase();
  if (/notes?|checklist|paper|notebook/.test(text)) return 'notes/checklist';
  if (/over[-_ ]?shoulder|shoulder|context/.test(text)) return 'over-shoulder';
  if (/talking|head|face|presenter|closeup|close-up/.test(text)) return 'talking-head presence';
  if (/keyboard|mouse|hands?|typing/.test(text)) return 'hands';
  if (/screen|workflow|desktop|ui/.test(text)) return 'screen/workflow';
  return 'unknown';
}

function mediaOrientation(resolution = '') {
  const match = String(resolution || '').match(/^(\d+)x(\d+)$/);
  if (!match) return '';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return '';
  if (width > height) return 'landscape';
  if (height > width) return 'portrait';
  return 'square';
}

function buildMediaDescriptor(filePath, options = {}) {
  const role = likelyMediaRole(filePath);
  const metadata = ffprobeMetadata(filePath, options);
  return {
    ...mediaFileBase(filePath),
    ...metadata,
    orientation: mediaOrientation(metadata.resolution),
    likelyRole: role.likelyRole,
    confidence: role.confidence,
    reasons: role.reasons,
  };
}

function isSafeOpenPath(filePath, resolved, options = {}) {
  const requested = markdownCell(filePath || '');
  if (!requested) return false;
  const absolute = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(resolved.runDir, requested);
  const allowedRoots = [resolved.runDir, path.resolve(options.videoRoot || path.join(process.env.HOME || '', 'Videos'))].filter(Boolean);
  return allowedRoots.some((root) => absolute === root || absolute.startsWith(root + path.sep)) && fs.existsSync(absolute);
}

function gpsArtifactKind(filename) {
  if (/^(rough-cut-watch-notes|final-watch-notes|manual-approval-notes|second-cut-candidate|second-cut-watch-notes|final-candidate)\.md$/i.test(filename)) return 'source / human-authored';
  if (/^(package-run-state\.md|package-runs-index\.json)$/i.test(filename)) return 'state / lifecycle';
  if (/^(rough-cut-review|second-cut-review|final-review|pickup-list|edit-fix-list|capture-evidence-review|export-checklist|publish-metadata-review|master-file-manifest|caption-check|loudness-check|delivery-readiness)\.md$/i.test(filename)) return 'derived / generated';
  if (/^(capture-checklist|takes-log|screen-recording-checklist|audio-capture-checklist|missing-shot-tracker)\.md$/i.test(filename)) return 'evidence / media reference';
  return 'unclear';
}

function containsApprovalMarker(markdown = '') {
  return /(?:approval|accepted|ready|second-cut ready|capture evidence accepted):\s*(?:PASS|yes|READY|READY TO SHOOT|READY FOR ROUGH CUT|NEEDS PICKUPS|NEEDS EDIT FIXES)/i.test(String(markdown || ''));
}

function gpsArtifactCanChangeReadiness(filename, kind) {
  return kind !== 'unclear' && (
    kind === 'state / lifecycle' ||
    kind === 'source / human-authored' ||
    /(?:review|checklist|metadata|pickup-list|edit-fix-list|tracker)/i.test(filename)
  );
}

function buildArtifactTrail(resolved) {
  const items = PRODUCTION_GPS_ARTIFACTS.map((filename) => {
    const artifactPath = path.join(resolved.runDir, filename);
    const exists = fs.existsSync(artifactPath);
    const text = exists ? fs.readFileSync(artifactPath, 'utf8') : '';
    const kind = gpsArtifactKind(filename);
    const safeToRegenerate = exists && kind === 'derived / generated' && ROUGH_CUT_DERIVED_FILES.includes(filename);
    return {
      path: filename,
      exists,
      kind,
      canChangeReadiness: gpsArtifactCanChangeReadiness(filename, kind),
      containsApprovalMarker: containsApprovalMarker(text),
      safeToRegenerate,
      requiresHumanReview: kind === 'source / human-authored' || kind === 'state / lifecycle' || containsApprovalMarker(text) || gpsArtifactCanChangeReadiness(filename, kind),
      summary: exists ? 'present' : 'missing',
    };
  });
  return {
    groups: {
      sourceHumanAuthored: items.filter((item) => item.kind === 'source / human-authored'),
      derivedGenerated: items.filter((item) => item.kind === 'derived / generated'),
      stateLifecycle: items.filter((item) => item.kind === 'state / lifecycle'),
      evidenceMediaReferences: items.filter((item) => item.kind === 'evidence / media reference'),
    },
    items,
  };
}

function gpsStatus(done, current, blocked, needsHuman, needsArtifact) {
  if (current) return 'current';
  if (blocked) return 'blocked';
  if (needsHuman) return 'needs human review';
  if (needsArtifact) return 'needs artifact';
  return done ? 'done / pass' : 'not reached';
}

function buildProductionGpsTimeline(doctor = {}, roughCut = {}) {
  const gate = doctor.lifecycleGate || {};
  const roughNeedsWork = ['NEEDS PICKUPS', 'NEEDS EDIT FIXES'].includes(roughCut.roughCutReviewStatus);
  const roughStarted = Boolean(roughCut.roughCutReviewStatus && roughCut.roughCutReviewStatus !== 'NOT STARTED');
  const pickupCurrent = roughNeedsWork;
  const roughCurrent = roughStarted && !roughNeedsWork && roughCut.roughCutReviewStatus !== 'READY FOR SECOND CUT';
  const secondCutReached = Boolean(gate.secondCutReady);
  const finalReached = Boolean(gate.finalReviewStatus);
  const exportReached = Boolean(gate.exportStatus);
  const publishReached = Boolean(gate.publicationMetadataStatus);
  const archiveReached = Boolean(gate.archiveStatus || gate.readyToArchive);
  return [
    { label: 'Topic / Package', status: gpsStatus(Boolean(doctor.title), false, false, false, !doctor.title), reason: doctor.title ? `Selected package: ${doctor.title}.` : 'Selected package missing.', artifactPath: 'selected-package.md' },
    { label: 'Research Evidence', status: gpsStatus(gate.researchSufficiencyReviewStatus === 'PASS' || gate.researchApprovalMarker === 'PASS', false, false, gate.researchSufficiencyReviewStatus && gate.researchSufficiencyReviewStatus !== 'PASS', !gate.researchSufficiencyReviewStatus), reason: `Research status: ${gate.researchSufficiencyReviewStatus || gate.researchGateStatus || 'missing'}.`, artifactPath: 'research-sufficiency-review.md' },
    { label: 'Script Structure', status: gpsStatus(Boolean(gate.readyToDraft), false, false, false, !gate.scriptStructureStatus), reason: `Script structure: ${gate.scriptStructureStatus || 'missing'}.`, artifactPath: 'script-structure.md' },
    { label: 'Script Review', status: gpsStatus(gate.scriptReviewStatus === 'PASS', false, gate.scriptReviewStatus && gate.scriptReviewStatus !== 'PASS', false, !gate.scriptReviewStatus), reason: `Script review: ${gate.scriptReviewStatus || 'missing'}.`, artifactPath: 'script-review.md' },
    { label: 'Production Planning', status: gpsStatus(gate.productionPlanStatus === 'READY TO SHOOT' && !gate.productionPlanningBlocked, false, gate.productionPlanningBlocked, gate.productionPlanStatus && gate.productionPlanStatus !== 'READY TO SHOOT', !gate.productionPlanStatus), reason: `Production plan: ${gate.productionPlanStatus || 'missing'}.`, artifactPath: 'production-plan.md' },
    { label: 'Shot/Edit Plan Review', status: gpsStatus(Boolean(gate.shotEditPlanAccepted), false, gate.hasShotEditPlanReview && !gate.shotEditPlanAccepted, false, !gate.hasShotEditPlanReview), reason: `Shot/edit review: ${gate.shotEditPlanReviewStatus || 'missing'}; accepted: ${gate.shotEditPlanAccepted ? 'yes' : 'no'}.`, artifactPath: 'shot-edit-plan-review.md' },
    { label: 'Capture Checklist', status: gpsStatus(gate.captureStatus === 'READY FOR ROUGH CUT' || gate.readyForRoughCut, false, false, false, !gate.captureStatus), reason: `Capture checklist: ${gate.captureStatus || 'missing'}.`, artifactPath: 'capture-checklist.md' },
    { label: 'Capture Evidence Review', status: gpsStatus(Boolean(gate.captureEvidenceAccepted), false, false, gate.hasCaptureEvidenceReview && !gate.captureEvidenceAccepted, !gate.hasCaptureEvidenceReview), reason: `Capture evidence: ${gate.captureEvidenceReviewStatus || 'missing'}; accepted: ${gate.captureEvidenceAccepted ? 'yes' : 'no'}.`, artifactPath: 'capture-evidence-review.md' },
    { label: 'Rough Cut Review', status: roughCurrent ? 'current' : gpsStatus(roughCut.roughCutReviewStatus === 'READY FOR SECOND CUT', false, roughCut.roughCutReviewStatus === 'BLOCKED', roughNeedsWork, !roughStarted), reason: `Rough-cut review: ${roughCut.roughCutReviewStatus || 'missing'}.`, artifactPath: 'rough-cut-review.md', current: roughCurrent },
    { label: 'Pickup / Edit-Fix Planning', status: pickupCurrent ? 'current' : gpsStatus(!roughNeedsWork && roughCut.roughCutReviewStatus === 'READY FOR SECOND CUT', false, false, roughNeedsWork, !roughStarted), reason: roughNeedsWork ? 'Pickup/edit-fix work is active before second-cut readiness.' : `Pickup list status: ${roughCut.pickupListStatus || 'missing'}.`, artifactPath: 'pickup-list.md', current: pickupCurrent },
    { label: 'Second Cut Candidate', status: gpsStatus(secondCutReached, false, roughNeedsWork || roughCut.secondCutReady === false, false, !roughStarted), reason: `Second-cut ready: ${gate.secondCutReady || roughCut.secondCutReady ? 'yes' : 'no'}.`, artifactPath: 'rough-cut-review.md' },
    { label: 'Final Review', status: !secondCutReached ? 'not reached' : gpsStatus(gate.finalReviewStatus === 'PASS', false, false, Boolean(finalReached && gate.finalReviewStatus !== 'PASS'), false), reason: `Final review: ${gate.finalReviewStatus || 'missing'}.`, artifactPath: 'final-review.md' },
    { label: 'Export Check', status: !finalReached ? 'not reached' : gpsStatus(Boolean(gate.effectiveReadyToUpload), false, false, Boolean(exportReached && !gate.effectiveReadyToUpload), false), reason: `Export: ${gate.exportStatus || 'missing'}.`, artifactPath: 'export-checklist.md' },
    { label: 'Publish Metadata', status: !exportReached ? 'not reached' : gpsStatus(Boolean(gate.effectiveReadyToSchedule), false, false, Boolean(publishReached && !gate.effectiveReadyToSchedule), false), reason: `Publish metadata: ${gate.publicationMetadataStatus || 'missing'}.`, artifactPath: 'publish-metadata-review.md' },
    { label: 'Archive / Repurpose', status: !publishReached ? 'not reached' : gpsStatus(Boolean(gate.effectiveReadyToArchive), false, false, Boolean(archiveReached && !gate.effectiveReadyToArchive), false), reason: `Archive: ${gate.archiveStatus || 'missing'}.`, artifactPath: 'archive-manifest.md' },
  ];
}

function buildProductionGps(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const runInput = `${PACKAGE_RUNS_DIR}/${resolved.runId}`;
  const doctor = packageRunDoctor.buildDoctorReport(runInput, { repoRoot: resolved.root });
  const roughCutResult = parseRoughCutReviewFile(resolved.runDir);
  const secondCutInspector = buildSecondCutInspector(payload, options);
  const finalReviewConsole = buildFinalReviewConsole(payload, options);
  const exportDeliveryConsole = buildExportDeliveryConsole(payload, options);
  const gate = doctor.lifecycleGate || {};
  const artifactTrail = buildArtifactTrail(resolved);
  const gateTimeline = buildProductionGpsTimeline(doctor, roughCutResult);
  const currentTimelineGate = gateTimeline.find((item) => item.current) || gateTimeline.find((item) => item.status === 'blocked' || item.status === 'needs human review' || item.status === 'needs artifact') || gateTimeline[0];
  const roughNeedsPickups = roughCutResult.roughCutReviewStatus === 'NEEDS PICKUPS';
  const roughNeedsEditFixes = roughCutResult.roughCutReviewStatus === 'NEEDS EDIT FIXES';
  const registeredCandidateReadyForReview = secondCutInspector.candidateStatus === 'found_needs_review' && secondCutInspector.registeredCandidate && secondCutInspector.registeredCandidate.exists;
  const secondCutStatus = secondCutInspector.secondCutReviewStatus || '';
  const currentGate = exportDeliveryConsole.readyToUpload
    ? 'Publish Metadata Review'
    : finalReviewConsole.publishReady && !exportDeliveryConsole.masterFileManifestExists
      ? 'Export Master Preparation'
      : finalReviewConsole.publishReady && exportDeliveryConsole.masterFileManifestExists && (!exportDeliveryConsole.captionCheckExists || !exportDeliveryConsole.loudnessCheckExists || !exportDeliveryConsole.deliveryReadinessExists)
        ? 'Export / Delivery Check'
        : finalReviewConsole.publishReady && exportDeliveryConsole.exportChecklistExists && !exportDeliveryConsole.readyToUpload
          ? 'Export Fixes / Delivery Check'
          : finalReviewConsole.publishReady
            ? 'Export / Delivery Check'
    : finalReviewConsole.finalReviewStatus === 'NEEDS FINAL FIXES'
      ? 'Final Fixes'
      : finalReviewConsole.finalWatchNotesExists && finalReviewConsole.staleDerivedReview
        ? 'Final Review Derivation'
        : finalReviewConsole.finalCandidateExists && !finalReviewConsole.finalWatchNotesExists
          ? 'Final Watch Review'
          : secondCutInspector.secondCutReady && !finalReviewConsole.finalCandidateExists
            ? 'Final Candidate Preparation'
            : registeredCandidateReadyForReview
              ? secondCutStatus === 'READY FOR SECOND CUT' && secondCutInspector.secondCutReady
                ? 'Final Review Preparation'
                : secondCutStatus === 'NEEDS MORE PICKUPS'
                  ? 'Pickup / Edit-Fix Planning'
                  : secondCutStatus === 'NEEDS EDIT FIXES'
                    ? 'Edit Fix Planning'
                    : 'Second-Cut Candidate Review'
    : roughNeedsPickups || roughNeedsEditFixes
      ? 'Pickup / Edit-Fix Planning'
      : currentTimelineGate.label;
  const gateStatus = roughNeedsPickups || roughNeedsEditFixes ? 'needs human review' : currentTimelineGate.status;
  const blockedActions = [...new Set([
    ...((doctor.conservativeBlockedActions || []).map((item) => item === 'upload' ? 'upload' : item)),
    gate.productionPlanStatus === 'READY TO SHOOT' && !gate.productionPlanningBlocked ? '' : 'mark ready to shoot',
    roughCutResult.secondCutReady ? '' : 'mark second-cut ready',
    'approve final',
    'publish',
    'archive',
    'promote project state',
    'commit state file',
  ].filter(Boolean))];
  const nextSafeAction =
    exportDeliveryConsole.readyToUpload
      ? 'Prepare/review publish metadata; scheduling, upload, archive, and state promotion remain separate gates.'
      : finalReviewConsole.publishReady && !exportDeliveryConsole.masterFileManifestExists
        ? 'Export/register master file for delivery review.'
        : finalReviewConsole.publishReady && exportDeliveryConsole.masterFileManifestExists && (!exportDeliveryConsole.captionCheckExists || !exportDeliveryConsole.loudnessCheckExists || !exportDeliveryConsole.deliveryReadinessExists)
          ? 'Record export metadata, loudness, captions, and delivery readiness.'
          : finalReviewConsole.publishReady && exportDeliveryConsole.exportChecklistExists && !exportDeliveryConsole.readyToUpload
            ? 'Resolve export/checklist blockers before upload.'
            : finalReviewConsole.publishReady
              ? 'Record delivery checks and regenerate export-checklist.md before upload readiness.'
      : finalReviewConsole.finalReviewStatus === 'NEEDS FINAL FIXES'
        ? 'Address final-watch fixes before any publish/export/upload/archive work.'
        : finalReviewConsole.finalWatchNotesExists && finalReviewConsole.staleDerivedReview
          ? 'Regenerate derived final review from current final-watch notes.'
          : finalReviewConsole.finalCandidateExists && !finalReviewConsole.finalWatchNotesExists
            ? 'Mikko watches final candidate and records final-watch notes.'
            : secondCutInspector.secondCutReady && !finalReviewConsole.finalCandidateExists
              ? 'Export/register final candidate for human final-watch review.'
              : registeredCandidateReadyForReview && secondCutStatus === 'READY FOR SECOND CUT' && secondCutInspector.secondCutReady
      ? 'Prepare separate final watch review; publish/export/upload/archive remain blocked.'
      : registeredCandidateReadyForReview && secondCutStatus === 'NEEDS MORE PICKUPS'
        ? 'Address remaining pickups from second-cut watch notes before any final review.'
        : registeredCandidateReadyForReview && secondCutStatus === 'NEEDS EDIT FIXES'
          ? 'Address edit fixes from second-cut watch notes before any final review.'
          : registeredCandidateReadyForReview
      ? 'Mikko must watch the registered second-cut candidate and record review notes before any readiness decision.'
      : roughNeedsPickups
      ? 'Place/review pickup inserts and edit-fix work before any second-cut readiness decision.'
      : roughNeedsEditFixes
        ? 'Apply and review edit fixes before any second-cut readiness decision.'
        : doctor.nextSafeAction || doctor.nextRecommendedCommand || doctor.firstBlockerReason || 'Inspect the current gate before downstream work.';
  const staleWarnings = roughCutResult.derivedArtifactStale ? [{
    title: 'Derived rough-cut review artifact may be stale',
    detail: roughCutResult.staleReason || `Current watch notes say ${roughCutResult.currentWatchNotesMarker || roughCutResult.approvalMarker || 'NOT GIVEN'}.`,
    artifactPath: 'rough-cut-review.md',
  }] : [];
  finalReviewConsole.warnings.forEach((warning) => {
    if (/stale|missing/i.test(warning)) {
      staleWarnings.push({
        title: /stale/i.test(warning) ? 'Derived final-review artifact may be stale' : 'Final review artifact warning',
        detail: warning,
        artifactPath: 'final-review.md',
      });
    }
  });
  exportDeliveryConsole.warnings.forEach((warning) => {
    if (/stale|missing/i.test(warning)) {
      staleWarnings.push({
        title: /stale/i.test(warning) ? 'Derived export-checklist artifact may be stale' : 'Export readiness warning',
        detail: warning,
        artifactPath: 'export-checklist.md',
      });
    }
  });
  const humanGateRequired = gateStatus !== 'done / pass' || roughNeedsPickups || roughNeedsEditFixes;
  const latestRelevantArtifact = roughCutResult.reviewedFilePath ? 'rough-cut-watch-notes.md' : currentTimelineGate.artifactPath || '';
  return {
    ok: true,
    readOnly: true,
    externalApisCalled: false,
    runId: resolved.runId,
    runPath: runInput,
    summary: {
      runId: resolved.runId,
      title: doctor.title || '',
      stateLabel: (doctor.packageRunState || readPackageRunState(resolved.runDir)).state || 'active',
      currentLocation: `Package Run -> ${roughNeedsPickups || roughNeedsEditFixes ? 'Rough Cut Review -> Pickup Execution -> Waiting for Mikko / Edit Work' : currentGate}`,
      currentInferredStage: doctor.currentInferredStage || doctor.lifecycleStatus || '',
      currentGate,
      gateStatus,
      nextSafeAction,
      blockedActions,
      requiredHumanDecision: humanGateRequired
        ? 'Mikko must review the current gate before any readiness transition.'
        : 'No human decision is currently reported by this read-only model.',
      latestRelevantArtifact,
      missingExpectedArtifact: (doctor.missingExpectedArtifacts || [])[0] || (roughCutResult.secondCutReady ? '' : 'second-cut candidate'),
      aiMayAct: true,
      mikkoApprovalRequired: humanGateRequired,
    },
    gateTimeline,
    artifactTrail,
    humanGate: {
      required: humanGateRequired,
      title: 'Human Gate Required',
      decision: roughNeedsPickups || roughNeedsEditFixes
        ? 'Mikko must decide whether pickup/edit-fix work satisfies the rough-cut notes before any second-cut readiness decision.'
        : 'Mikko must review the current gate before any approval marker or readiness transition is added.',
      reviewArtifact: latestRelevantArtifact || currentTimelineGate.artifactPath || '',
      doNotApproveYet: 'Do not approve rough cut, mark second-cut ready, publish, archive, or update durable state from this dashboard.',
      aiAllowed: ['inspect files', 'classify clips', 'draft pickup placement plan', 'summarize blockers', 'propose non-approval next steps'],
      aiBlocked: ['approve rough cut', 'mark second-cut ready', 'approve final', 'publish', 'archive', 'update package-run-state.md', 'update package-runs-index.json'],
    },
    blockedActions,
    staleWarnings,
    roughCutResult,
    secondCutInspector,
    finalReviewConsole,
    exportDeliveryConsole,
    mediaRows: collectMediaRows(resolved, detectRoughCutCandidate(resolved.runDir)),
  };
}

function secondCutCandidateWarnings(descriptor) {
  const warnings = [];
  if (descriptor.metadataUnavailable) warnings.push('ffprobe metadata unavailable; file existence and filesystem metadata were recorded only.');
  if (!descriptor.audioStreamPresent && !descriptor.audioPresent) warnings.push('No audio stream detected or audio metadata unavailable.');
  const duration = Number(descriptor.duration || 0);
  if (duration > 0 && duration < 30) warnings.push('Candidate appears very short; confirm this is the exported second-cut candidate.');
  if (/pickup|pickups|visual-variety|keyboard|mouse|hands|over[-_ ]?shoulder|talking/i.test(descriptor.path)) {
    warnings.push('Path looks like pickup media rather than an edited second-cut export.');
  }
  return warnings;
}

function secondCutCandidateManagedMarkdown(runId, descriptor, payload = {}) {
  const reviewer = markdownCell(payload.reviewer || 'Mikko');
  const notes = markdownText(payload.notes || '', 'No registration notes provided.');
  const exportedAt = markdownCell(payload.exportedAt || payload.reviewedAt || '');
  return [
    SECOND_CUT_CANDIDATE_SECTION_START,
    '# Second-Cut Candidate',
    '',
    `- Run: ${runId}`,
    '- Artifact purpose: second-cut candidate reference for human review',
    '- Review status: READY FOR HUMAN REVIEW',
    '- Second-cut ready: no',
    '- Rough cut approval: not granted here',
    '- Human approval required: yes',
    '- External APIs called: no',
    '',
    '## Candidate File',
    '',
    `- Path: ${descriptor.path}`,
    `- Exists: ${descriptor.exists ? 'yes' : 'no'}`,
    `- Duration: ${descriptor.duration || 'metadata unavailable'}`,
    `- Codec: ${descriptor.codec || 'metadata unavailable'}`,
    `- Resolution: ${descriptor.resolution || 'metadata unavailable'}`,
    `- Frame rate: ${descriptor.frameRate || 'metadata unavailable'}`,
    `- Audio present: ${descriptor.audioStreamPresent || descriptor.audioPresent ? 'yes' : 'no/unknown'}`,
    `- Size: ${descriptor.size}`,
    `- Modified: ${descriptor.modifiedTime || ''}`,
    `- Reviewer: ${reviewer}`,
    exportedAt ? `- Exported/review timestamp: ${exportedAt}` : '',
    '',
    '## Registration Notes',
    '',
    notes,
    '',
    '## Review Boundary',
    '',
    '- This artifact records a candidate file for review.',
    '- It does not approve the rough cut.',
    '- It does not mark second-cut ready.',
    '- It does not start final review.',
    '- It does not update package-run state.',
    '- Mikko must watch and explicitly approve any readiness transition.',
    '',
    '## Human Review Checklist',
    '',
    '- [ ] Watch the full second-cut candidate.',
    '- [ ] Confirm pickup inserts are actually used.',
    '- [ ] Confirm long screen-only stretches are reduced.',
    '- [ ] Confirm no important screen detail is covered.',
    '- [ ] Confirm no private/sensitive detail is visible.',
    '- [ ] Confirm B-roll is not implied as proof evidence.',
    '- [ ] Confirm pacing and clarity improved.',
    '- [ ] Decide whether more pickups/edit fixes are needed.',
    '- [ ] Do not mark second-cut ready unless explicitly approved by Mikko.',
    SECOND_CUT_CANDIDATE_SECTION_END,
    '',
  ].filter((line) => line !== '').join('\n');
}

function replaceSecondCutCandidateManagedSection(existing = '', managedMarkdown = '') {
  const text = String(existing || '');
  const start = text.indexOf(SECOND_CUT_CANDIDATE_SECTION_START);
  const end = text.indexOf(SECOND_CUT_CANDIDATE_SECTION_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = text.slice(0, start).replace(/\s*$/, '\n\n');
    const after = text.slice(end + SECOND_CUT_CANDIDATE_SECTION_END.length).replace(/^\s*/, '\n');
    return `${before}${managedMarkdown}${after}`.replace(/\n{4,}/g, '\n\n\n');
  }
  if (text.trim()) return `${text.replace(/\s*$/, '\n\n')}${managedMarkdown}`;
  return `${managedMarkdown}`;
}

function buildSecondCutCandidateRegistration(payload = {}, options = {}) {
  if (!payload.runId) {
    const error = new Error('runId is required for second-cut candidate registration.');
    error.statusCode = 400;
    throw error;
  }
  const resolved = resolveRunFromPayload(payload, options);
  const candidatePath = validateSecondCutCandidatePath(payload.candidatePath);
  const descriptor = buildMediaDescriptor(candidatePath, options);
  descriptor.likelyRole = 'second-cut candidate';
  descriptor.confidence = /second[-_ ]?cut|secondcut|second_cut|cut[-_ ]?2|\bv2\b|candidate|review/i.test(candidatePath)
    ? descriptor.confidence === 'low' ? 'medium' : descriptor.confidence
    : 'low';
  descriptor.reasons = descriptor.reasons && descriptor.reasons.length ? descriptor.reasons : ['registered explicitly by Mikko for review'];
  const warnings = secondCutCandidateWarnings(descriptor);
  const artifactPreview = secondCutCandidateManagedMarkdown(resolved.runId, descriptor, payload);
  return {
    ok: true,
    readOnly: options.mode !== 'apply',
    externalApisCalled: false,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    candidatePath,
    candidateExists: true,
    metadata: {
      duration: descriptor.duration,
      codec: descriptor.codec,
      resolution: descriptor.resolution,
      frameRate: descriptor.frameRate,
      audioStreamPresent: Boolean(descriptor.audioStreamPresent || descriptor.audioPresent),
      size: descriptor.size,
      modifiedTime: descriptor.modifiedTime,
      metadataUnavailable: Boolean(descriptor.metadataUnavailable),
    },
    warnings,
    artifactFilename: SECOND_CUT_CANDIDATE_FILE,
    artifactPreview,
    humanGateRequired: true,
    secondCutReady: false,
    roughCutApproved: false,
    aiAllowed: ['validate file existence', 'inspect technical metadata', 'record review-needed candidate reference'],
    aiBlocked: ['approve rough cut', 'mark second-cut ready', 'mark final review ready', 'update package-run-state.md', 'update package-runs-index.json', 'move/delete/rename media'],
  };
}

function applySecondCutCandidateRegistration(payload = {}, options = {}) {
  const registration = buildSecondCutCandidateRegistration(payload, { ...options, mode: 'apply' });
  const resolved = resolvePackageRunDir(registration.runId, options);
  const targetPath = path.resolve(resolved.runDir, SECOND_CUT_CANDIDATE_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved second-cut candidate artifact path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  const next = replaceSecondCutCandidateManagedSection(existing, registration.artifactPreview);
  fs.writeFileSync(targetPath, next, 'utf8');
  return {
    ...registration,
    readOnly: false,
    written: [SECOND_CUT_CANDIDATE_FILE],
    warning: 'Registered second-cut candidate for human review only. Rough cut is not approved and second-cut readiness is not changed.',
  };
}

function parseSecondCutCandidateArtifact(runDir) {
  const artifactPath = path.join(runDir, SECOND_CUT_CANDIDATE_FILE);
  if (!fs.existsSync(artifactPath)) return { exists: false, path: '', artifactPath: SECOND_CUT_CANDIDATE_FILE };
  const text = fs.readFileSync(artifactPath, 'utf8');
  return {
    exists: true,
    path: lineValue(text, 'Path'),
    reviewStatus: lineValue(text, 'Review status') || '',
    secondCutReady: /^yes$/i.test(lineValue(text, 'Second-cut ready')),
    artifactPath: SECOND_CUT_CANDIDATE_FILE,
  };
}

function secondCutReviewStatusFromMarker(marker = '') {
  const normalized = String(marker || '').trim().toUpperCase();
  if (SECOND_CUT_REVIEW_MARKERS.includes(normalized)) return normalized;
  return 'NEEDS HUMAN REVIEW';
}

function parseSecondCutWatchNotes(content = '') {
  const text = String(content || '');
  const marker = secondCutReviewStatusFromMarker(lineValue(text, 'Second-cut review marker'));
  const starter = !text.trim() || /starter template|TODO|TBD|placeholder/i.test(text);
  return {
    candidatePath: lineValue(text, 'Candidate file reviewed') || lineValue(text, 'Path'),
    reviewer: lineValue(text, 'Reviewer'),
    watchDate: lineValue(text, 'Watch date'),
    status: marker,
    marker,
    secondCutReady: marker === 'READY FOR SECOND CUT',
    remainingPickupsNeeded: lineValue(text, 'Remaining pickups needed') || '',
    editFixesNeeded: lineValue(text, 'Remaining edit fixes needed') || '',
    privacyWarnings: /privacy|sensitive/i.test(text) ? 'privacy/sensitive detail notes present' : '',
    trustWarnings: /AI-generated|B-roll|proof evidence|misleading/i.test(text) ? 'visual trust/disclosure notes present' : '',
    isStarter: starter || marker === 'NEEDS HUMAN REVIEW',
  };
}

function parseSecondCutReviewFile(runDir) {
  const reviewPath = path.join(runDir, SECOND_CUT_REVIEW_FILE);
  if (!fs.existsSync(reviewPath)) {
    return { exists: false, status: 'NEEDS HUMAN REVIEW', secondCutReady: false, candidatePath: '', reason: 'second-cut-review.md is missing.' };
  }
  const text = fs.readFileSync(reviewPath, 'utf8');
  const status = secondCutReviewStatusFromMarker(lineValue(text, 'Review status') || lineValue(text, 'Status'));
  return {
    exists: true,
    status,
    secondCutReady: /^yes$/i.test(lineValue(text, 'Second-cut ready')) && status === 'READY FOR SECOND CUT',
    candidatePath: lineValue(text, 'Candidate file'),
    reason: lineValue(text, 'Reason'),
  };
}

function secondCutCandidateExportRoot(options = {}) {
  return path.resolve(options.videoRoot || path.join(process.env.HOME || '/home/vidtoolz', 'Videos'));
}

function suggestSecondCutCandidateExportTarget(runId, options = {}) {
  const safeRunId = validatePackageRunId(runId || '');
  const expectedCandidateFolder = path.join(
    secondCutCandidateExportRoot(options),
    'vidtoolz-captures',
    safeRunId,
    'second-cut-candidates'
  );
  const expectedCandidateFilename = `${safeRunId}-second-cut-candidate-01.mp4`;
  return {
    expectedCandidateFolder,
    expectedCandidateFilename,
    expectedCandidatePath: path.join(expectedCandidateFolder, expectedCandidateFilename),
  };
}

function enteredSecondCutCandidatePathStatus(candidatePath = '') {
  const entered = markdownCell(candidatePath || '');
  if (!entered) return 'missing';
  if (!path.isAbsolute(entered) || !MEDIA_FILE_PATTERN.test(entered)) return 'invalid';
  if (!fs.existsSync(entered) || !fs.statSync(entered).isFile()) return 'invalid';
  return 'present';
}

function buildSecondCutCandidatePreflight(payload = {}, options = {}) {
  const normalizedPayload = typeof payload === 'string' ? { runId: payload } : payload;
  const resolved = resolveRunFromPayload(normalizedPayload, options);
  const suggestion = suggestSecondCutCandidateExportTarget(resolved.runId, options);
  const inspector = buildSecondCutInspector(normalizedPayload, options);
  const registered = parseSecondCutCandidateArtifact(resolved.runDir);
  const registeredFileExists = Boolean(registered.exists && registered.path && fs.existsSync(registered.path) && fs.statSync(registered.path).isFile());
  const watchNotesPath = path.join(resolved.runDir, SECOND_CUT_WATCH_NOTES_FILE);
  const reviewPath = path.join(resolved.runDir, SECOND_CUT_REVIEW_FILE);
  const watchNotesExists = fs.existsSync(watchNotesPath);
  const reviewExists = fs.existsSync(reviewPath);
  const watchNotesText = watchNotesExists ? fs.readFileSync(watchNotesPath, 'utf8') : '';
  const watchNotes = parseSecondCutWatchNotes(watchNotesText);
  const derivedReview = parseSecondCutReviewFile(resolved.runDir);
  const derivedMissingOrStale = Boolean(
    watchNotesExists && !reviewExists ||
    (watchNotesExists && reviewExists && watchNotes.status !== derivedReview.status) ||
    (watchNotesExists && reviewExists && fs.statSync(watchNotesPath).mtimeMs > fs.statSync(reviewPath).mtimeMs) ||
    (watchNotesExists && reviewExists && watchNotes.candidatePath && derivedReview.candidatePath && watchNotes.candidatePath !== derivedReview.candidatePath)
  );
  const registeredCandidateStatus =
    !registered.exists
      ? 'missing'
      : registered.path && !registeredFileExists
        ? 'registered_missing_file'
        : registered.path && watchNotes.candidatePath && watchNotes.candidatePath !== registered.path
          ? 'stale'
          : registered.path
            ? 'registered'
            : 'unknown';
  const candidateFileStatus =
    registeredCandidateStatus === 'registered_missing_file' || registeredCandidateStatus === 'missing'
      ? 'missing'
      : registeredFileExists
        ? 'exists'
        : inspector.registeredCandidate && inspector.registeredCandidate.metadataUnavailable
          ? 'metadata_unavailable'
          : 'unknown';
  let humanReviewStatus = 'not_started';
  if (registered.exists && !watchNotesExists) humanReviewStatus = 'watch_notes_missing';
  if (watchNotesExists && derivedMissingOrStale) humanReviewStatus = 'derived_review_missing';
  if (watchNotesExists && !derivedMissingOrStale && watchNotes.status === 'NEEDS MORE PICKUPS') humanReviewStatus = 'needs_more_pickups';
  if (watchNotesExists && !derivedMissingOrStale && watchNotes.status === 'NEEDS EDIT FIXES') humanReviewStatus = 'needs_edit_fixes';
  if (watchNotesExists && !derivedMissingOrStale && derivedReview.status === 'READY FOR SECOND CUT' && derivedReview.secondCutReady) humanReviewStatus = 'ready_for_second_cut';
  if (watchNotesExists && !derivedMissingOrStale && watchNotes.status === 'NEEDS HUMAN REVIEW') humanReviewStatus = 'blocked';
  const secondCutReady = humanReviewStatus === 'ready_for_second_cut';
  const warnings = [
    ...inspector.warnings,
    registeredCandidateStatus === 'missing' ? 'Second-cut candidate is not registered.' : '',
    registeredCandidateStatus === 'registered_missing_file' ? 'Registered second-cut candidate file is missing.' : '',
    registeredCandidateStatus === 'stale' ? 'Registered candidate path may be stale against current second-cut watch notes.' : '',
    watchNotesExists && !reviewExists ? 'Derived second-cut review missing; regenerate second-cut-review.md.' : '',
    watchNotesExists && reviewExists && derivedMissingOrStale ? 'Derived second-cut review may be stale or conflict with current watch notes.' : '',
    secondCutReady ? '' : 'Second-cut approval is not granted by candidate existence, registration, metadata, or inspection.',
  ].filter(Boolean);
  const nextSafeAction =
    registeredCandidateStatus === 'registered_missing_file'
      ? 'Fix or re-register the second-cut candidate path before Mikko review.'
      : registeredCandidateStatus === 'missing'
        ? 'Export the second-cut candidate from Resolve, register the absolute path in Second-Cut Candidate Registration, and save it for human review.'
        : humanReviewStatus === 'watch_notes_missing'
          ? 'Mikko should inspect metadata, watch the full registered second-cut candidate, and record second-cut watch notes.'
          : humanReviewStatus === 'derived_review_missing'
            ? 'Regenerate the derived second-cut review from current human watch notes before any downstream gate.'
            : humanReviewStatus === 'needs_more_pickups'
              ? 'Return to pickup/edit work and address remaining pickups before another second-cut candidate.'
              : humanReviewStatus === 'needs_edit_fixes'
                ? 'Return to edit fixes before another second-cut readiness decision.'
                : humanReviewStatus === 'ready_for_second_cut'
                  ? 'Proceed to final candidate/final review preparation. Final/export/publish/archive remain separate blocked gates.'
                  : 'Export and register a second-cut candidate, then Mikko must watch it before any readiness decision.';
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    readOnly: true,
    externalApisCalled: false,
    currentGate: inspector.currentGate,
    roughCutStatus: inspector.roughCutStatus,
    secondCutReady,
    ...suggestion,
    enteredCandidatePathStatus: enteredSecondCutCandidatePathStatus(normalizedPayload.candidatePath || ''),
    registeredCandidateStatus,
    candidateFileStatus,
    inspectionStatus: inspector.candidateStatus || 'unknown',
    humanReviewStatus,
    downstreamStatus: {
      finalReview: 'blocked',
      exportDelivery: 'blocked',
      publishMetadata: 'blocked',
      archive: 'blocked',
    },
    registeredCandidatePath: registered.path || '',
    secondCutWatchNotesExists: watchNotesExists,
    secondCutReviewExists: reviewExists,
    nextSafeAction,
    aiAllowed: ['inspect metadata', 'surface missing candidate', 'summarize gate status', 'draft review checklist'],
    aiBlocked: ['approve rough cut', 'mark second-cut ready', 'mark final review ready', 'mark export/upload ready', 'publish', 'archive', 'update state/index', 'move/delete/rename media'],
    warnings,
  };
}

function normalizeSecondCutWatchFields(fields = {}, resolved) {
  const registered = parseSecondCutCandidateArtifact(resolved.runDir);
  const candidatePath = markdownCell(fields.candidatePath || registered.path || '');
  if (!candidatePath) {
    const error = new Error('Second-cut candidate file is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
    const error = new Error('Second-cut candidate file does not exist.');
    error.statusCode = 404;
    throw error;
  }
  const watchDate = markdownCell(fields.watchDate || '');
  const reviewer = markdownCell(fields.reviewer || '');
  if (!watchDate) {
    const error = new Error('Second-cut watch date is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!reviewer) {
    const error = new Error('Second-cut reviewer is required.');
    error.statusCode = 400;
    throw error;
  }
  const decisionMarker = secondCutReviewStatusFromMarker(fields.decisionMarker || fields.marker || '');
  if (!SECOND_CUT_REVIEW_MARKERS.includes(decisionMarker)) {
    const error = new Error(`Invalid second-cut review marker: ${fields.decisionMarker || fields.marker || ''}`);
    error.statusCode = 400;
    throw error;
  }
  return {
    candidatePath,
    watchDate,
    reviewer,
    openingNotes: markdownText(fields.openingNotes || '', ''),
    pickupPlacementNotes: markdownText(fields.pickupPlacementNotes || '', ''),
    screenOnlyStretchNotes: markdownText(fields.screenOnlyStretchNotes || '', ''),
    pacingClarityNotes: markdownText(fields.pacingClarityNotes || '', ''),
    visualTrustDisclosureNotes: markdownText(fields.visualTrustDisclosureNotes || '', ''),
    privacySensitiveNotes: markdownText(fields.privacySensitiveNotes || '', ''),
    remainingPickupsNotes: markdownText(fields.remainingPickupsNotes || '', ''),
    remainingEditFixesNotes: markdownText(fields.remainingEditFixesNotes || '', ''),
    decisionMarker,
  };
}

function secondCutWatchNotesMarkdown(runId, fields, roughCutResult) {
  return [
    SECOND_CUT_WATCH_NOTES_SECTION_START,
    '# Second-Cut Watch Notes',
    '',
    `- Run: ${runId}`,
    `- Candidate file reviewed: ${fields.candidatePath}`,
    `- Watch date: ${fields.watchDate}`,
    `- Reviewer: ${fields.reviewer}`,
    '- Review type: second-cut candidate review',
    '',
    '## Candidate Context',
    '',
    `- Source candidate artifact: ${SECOND_CUT_CANDIDATE_FILE}`,
    `- Rough-cut review status before second-cut review: ${roughCutResult.roughCutReviewStatus || 'unknown'}`,
    `- Second-cut ready before review: ${roughCutResult.secondCutReady ? 'yes' : 'no'}`,
    '',
    '## Opening / Viewer Promise',
    '',
    'Notes:',
    fields.openingNotes || 'No notes provided.',
    '',
    '## Pickup Placement',
    '',
    'Notes:',
    fields.pickupPlacementNotes || 'No notes provided.',
    '',
    '## Screen-Only Stretches',
    '',
    'Notes:',
    fields.screenOnlyStretchNotes || 'No notes provided.',
    '',
    '## Pacing / Clarity',
    '',
    'Notes:',
    fields.pacingClarityNotes || 'No notes provided.',
    '',
    '## Visual Trust / Disclosure',
    '',
    'Notes:',
    fields.visualTrustDisclosureNotes || 'No notes provided.',
    '',
    '## Privacy / Sensitive Details',
    '',
    'Notes:',
    fields.privacySensitiveNotes || 'No notes provided.',
    '',
    '## Remaining Pickups Needed',
    '',
    'Notes:',
    fields.remainingPickupsNotes || 'No notes provided.',
    '',
    '## Remaining Edit Fixes Needed',
    '',
    'Notes:',
    fields.remainingEditFixesNotes || 'No notes provided.',
    '',
    '## Human Decision',
    '',
    `Second-cut review marker: ${fields.decisionMarker}`,
    '',
    '- READY FOR SECOND CUT is a human approval marker.',
    '- Do not generate READY FOR SECOND CUT automatically.',
    '- Mikko must explicitly choose it.',
    SECOND_CUT_WATCH_NOTES_SECTION_END,
    '',
  ].join('\n');
}

function replaceManagedSection(existing = '', managed = '', startMarker, endMarker) {
  const text = String(existing || '');
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start !== -1 && end !== -1 && end > start) {
    const before = text.slice(0, start).replace(/\s*$/, '\n\n');
    const after = text.slice(end + endMarker.length).replace(/^\s*/, '\n');
    return `${before}${managed}${after}`.replace(/\n{4,}/g, '\n\n\n');
  }
  if (text.trim()) return `${text.replace(/\s*$/, '\n\n')}${managed}`;
  return managed;
}

function saveSecondCutWatchNotes(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const fields = normalizeSecondCutWatchFields(payload.fields || payload, resolved);
  const roughCutResult = parseRoughCutReviewFile(resolved.runDir);
  const managed = secondCutWatchNotesMarkdown(resolved.runId, fields, roughCutResult);
  const targetPath = path.resolve(resolved.runDir, SECOND_CUT_WATCH_NOTES_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved second-cut watch notes path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  fs.writeFileSync(targetPath, replaceManagedSection(existing, managed, SECOND_CUT_WATCH_NOTES_SECTION_START, SECOND_CUT_WATCH_NOTES_SECTION_END), 'utf8');
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written: [SECOND_CUT_WATCH_NOTES_FILE],
    secondCutReady: fields.decisionMarker === 'READY FOR SECOND CUT',
    warning: fields.decisionMarker === 'READY FOR SECOND CUT'
      ? 'Human READY FOR SECOND CUT marker recorded. Regenerate derived review before downstream final-review work.'
      : 'Second-cut watch notes saved. Second-cut readiness remains blocked.',
  };
}

function buildSecondCutReviewFromWatchNotes(runId, options = {}) {
  const resolved = resolvePackageRunDir(runId, options);
  const notesPath = path.join(resolved.runDir, SECOND_CUT_WATCH_NOTES_FILE);
  const candidate = parseSecondCutCandidateArtifact(resolved.runDir);
  const notesText = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : '';
  const parsed = parseSecondCutWatchNotes(notesText);
  const status = parsed.status;
  const candidatePath = parsed.candidatePath || candidate.path || '';
  const candidateExists = Boolean(candidatePath && fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile());
  const secondCutReady = status === 'READY FOR SECOND CUT';
  const reason =
    !notesText.trim() ? 'second-cut-watch-notes.md is missing.'
      : status === 'NEEDS MORE PICKUPS' ? 'Human second-cut notes request more pickups.'
        : status === 'NEEDS EDIT FIXES' ? 'Human second-cut notes request edit fixes.'
          : status === 'READY FOR SECOND CUT' ? 'Mikko explicitly marked READY FOR SECOND CUT.'
            : 'Missing exact second-cut review marker.';
  return {
    status,
    secondCutReady,
    reason,
    candidatePath,
    candidateExists,
    sourceExists: Boolean(notesText.trim()),
    sourceIsStarter: parsed.isStarter,
    parsed,
    markdown: [
      SECOND_CUT_REVIEW_SECTION_START,
      '# Second-Cut Review',
      '',
      `- Run: ${resolved.runId}`,
      `- Source watch notes: ${SECOND_CUT_WATCH_NOTES_FILE}`,
      `- Registered candidate: ${SECOND_CUT_CANDIDATE_FILE}`,
      `- Review status: ${status}`,
      `- Second-cut ready: ${secondCutReady ? 'yes' : 'no'}`,
      '- Human approval required: yes',
      '- External APIs called: no',
      '',
      '## Gate Result',
      '',
      `- Status: ${status}`,
      `- Reason: ${reason}`,
      `- Candidate file: ${candidatePath || 'not recorded'}`,
      `- Candidate exists: ${candidateExists ? 'yes' : 'no'}`,
      `- Required next action: ${secondCutReady ? 'Proceed to separate final watch review; publishing/export remain blocked.' : 'Resolve the human second-cut review blocker before final review.'}`,
      '',
      '## Boundary',
      '',
      '- This review is derived from human second-cut watch notes.',
      '- It does not approve final review.',
      '- It does not approve publishing.',
      '- It does not update package-run state.',
      '- It does not update package-runs-index.json.',
      '',
      '## Blocked Actions',
      '',
      '- final review',
      '- export/upload',
      '- publish',
      '- archive',
      '- state promotion',
      secondCutReady ? '- Final review still requires a separate final-watch review later.' : '',
      SECOND_CUT_REVIEW_SECTION_END,
      '',
    ].filter((line) => line !== '').join('\n'),
  };
}

function regenerateSecondCutReviewDerived(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const review = buildSecondCutReviewFromWatchNotes(resolved.runId, options);
  const targetPath = path.resolve(resolved.runDir, SECOND_CUT_REVIEW_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved second-cut review path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  fs.writeFileSync(targetPath, replaceManagedSection(existing, review.markdown, SECOND_CUT_REVIEW_SECTION_START, SECOND_CUT_REVIEW_SECTION_END), 'utf8');
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written: [SECOND_CUT_REVIEW_FILE],
    review,
    approvedForFinalReview: false,
    warning: 'Regenerated derived second-cut-review.md only. Final review, publish/export, state, and index remain blocked.',
  };
}

function finalReviewStatusFromMarker(marker = '') {
  const normalized = String(marker || '').trim().toUpperCase();
  if (FINAL_REVIEW_MARKERS.includes(normalized)) return normalized;
  return 'NEEDS HUMAN REVIEW';
}

function parseFinalCandidateArtifact(runDir) {
  const artifactPath = path.join(runDir, FINAL_CANDIDATE_FILE);
  if (!fs.existsSync(artifactPath)) return { exists: false, path: '', artifactPath: FINAL_CANDIDATE_FILE };
  const text = fs.readFileSync(artifactPath, 'utf8');
  return {
    exists: true,
    path: lineValue(text, 'Path'),
    reviewStatus: lineValue(text, 'Review status') || '',
    finalApproved: /^yes$/i.test(lineValue(text, 'Final approved')),
    publishReady: /^yes$/i.test(lineValue(text, 'Publish ready')),
    artifactPath: FINAL_CANDIDATE_FILE,
  };
}

function finalCandidateWarnings(descriptor, upstream) {
  const warnings = [];
  if (descriptor.metadataUnavailable) warnings.push('ffprobe metadata unavailable; file existence and filesystem metadata were recorded only.');
  if (!descriptor.audioStreamPresent && !descriptor.audioPresent) warnings.push('No audio stream detected or audio metadata unavailable.');
  if (!upstream.secondCutReady) warnings.push('Second-cut review is not READY FOR SECOND CUT; final candidate registration is blocked.');
  const duration = Number(descriptor.duration || 0);
  if (duration > 0 && duration < 30) warnings.push('Final candidate appears very short; confirm this is the final export candidate.');
  return warnings;
}

function finalCandidateManagedMarkdown(runId, descriptor, payload, upstream) {
  const notes = markdownText(payload.notes || '', 'No registration notes provided.');
  const exportedAt = markdownCell(payload.exportedAt || payload.reviewedAt || '');
  return [
    FINAL_CANDIDATE_SECTION_START,
    '# Final Candidate',
    '',
    `- Run: ${runId}`,
    '- Artifact purpose: final candidate reference for human final-watch review',
    '- Review status: READY FOR HUMAN FINAL REVIEW',
    '- Final approved: no',
    '- Publish ready: no',
    '- Human approval required: yes',
    '- External APIs called: no',
    '',
    '## Candidate File',
    '',
    `- Path: ${descriptor.path}`,
    `- Exists: ${descriptor.exists ? 'yes' : 'no'}`,
    `- Duration: ${descriptor.duration || 'metadata unavailable'}`,
    `- Codec: ${descriptor.codec || 'metadata unavailable'}`,
    `- Resolution: ${descriptor.resolution || 'metadata unavailable'}`,
    `- Frame rate: ${descriptor.frameRate || 'metadata unavailable'}`,
    `- Audio present: ${descriptor.audioStreamPresent || descriptor.audioPresent ? 'yes' : 'no/unknown'}`,
    `- Size: ${descriptor.size}`,
    `- Modified: ${descriptor.modifiedTime || ''}`,
    exportedAt ? `- Exported/review timestamp: ${exportedAt}` : '',
    '',
    '## Upstream Context',
    '',
    `- Second-cut review status: ${upstream.secondCutReviewStatus}`,
    `- Second-cut ready: ${upstream.secondCutReady ? 'yes' : 'no'}`,
    `- Source second-cut review artifact: ${SECOND_CUT_REVIEW_FILE}`,
    `- Source second-cut candidate artifact: ${SECOND_CUT_CANDIDATE_FILE}`,
    '',
    '## Registration Notes',
    '',
    notes,
    '',
    '## Review Boundary',
    '',
    '- This artifact records a final candidate file for review.',
    '- It does not approve final review.',
    '- It does not approve publishing.',
    '- It does not approve upload.',
    '- It does not approve archive.',
    '- It does not update package-run state.',
    '- Mikko must watch and explicitly approve final readiness.',
    FINAL_CANDIDATE_SECTION_END,
    '',
  ].filter((line) => line !== '').join('\n');
}

function buildFinalCandidateRegistration(payload = {}, options = {}) {
  if (!payload.runId) {
    const error = new Error('runId is required for final candidate registration.');
    error.statusCode = 400;
    throw error;
  }
  const resolved = resolveRunFromPayload(payload, options);
  const candidatePath = validateSecondCutCandidatePath(payload.candidatePath, 'final candidate');
  const descriptor = buildMediaDescriptor(candidatePath, options);
  descriptor.likelyRole = 'final candidate';
  descriptor.confidence = /final|master|export|candidate|review/i.test(candidatePath) ? 'medium' : 'low';
  descriptor.reasons = ['registered explicitly by Mikko for final review'];
  const secondCutReview = parseSecondCutReviewFile(resolved.runDir);
  const upstream = {
    secondCutReady: Boolean(secondCutReview.secondCutReady && secondCutReview.status === 'READY FOR SECOND CUT'),
    secondCutReviewStatus: secondCutReview.status || 'MISSING',
  };
  const warnings = finalCandidateWarnings(descriptor, upstream);
  const artifactPreview = finalCandidateManagedMarkdown(resolved.runId, descriptor, payload, upstream);
  return {
    ok: true,
    readOnly: options.mode !== 'apply',
    externalApisCalled: false,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    candidatePath,
    candidateExists: true,
    metadata: {
      duration: descriptor.duration,
      codec: descriptor.codec,
      resolution: descriptor.resolution,
      frameRate: descriptor.frameRate,
      audioStreamPresent: Boolean(descriptor.audioStreamPresent || descriptor.audioPresent),
      size: descriptor.size,
      modifiedTime: descriptor.modifiedTime,
      metadataUnavailable: Boolean(descriptor.metadataUnavailable),
    },
    upstream,
    warnings,
    artifactFilename: FINAL_CANDIDATE_FILE,
    artifactPreview,
    humanGateRequired: true,
    finalApproved: false,
    publishReady: false,
    aiAllowed: ['validate file existence', 'inspect technical metadata', 'record final-review-needed candidate reference'],
    aiBlocked: ['approve final review', 'mark publish ready', 'mark upload ready', 'archive', 'update package-run-state.md', 'update package-runs-index.json', 'move/delete/rename media'],
  };
}

function applyFinalCandidateRegistration(payload = {}, options = {}) {
  const registration = buildFinalCandidateRegistration(payload, { ...options, mode: 'apply' });
  if (!registration.upstream.secondCutReady) {
    const error = new Error('Second-cut review is not READY FOR SECOND CUT; final candidate registration is blocked.');
    error.statusCode = 409;
    throw error;
  }
  const resolved = resolvePackageRunDir(registration.runId, options);
  const targetPath = path.resolve(resolved.runDir, FINAL_CANDIDATE_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved final candidate artifact path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  fs.writeFileSync(targetPath, replaceManagedSection(existing, registration.artifactPreview, FINAL_CANDIDATE_SECTION_START, FINAL_CANDIDATE_SECTION_END), 'utf8');
  return {
    ...registration,
    readOnly: false,
    written: [FINAL_CANDIDATE_FILE],
    warning: 'Registered final candidate for human final-watch review only. Final review and publish readiness are not approved.',
  };
}

function normalizeFinalWatchFields(fields = {}, resolved) {
  const candidate = parseFinalCandidateArtifact(resolved.runDir);
  const candidatePath = markdownCell(fields.candidatePath || candidate.path || '');
  if (!candidatePath) {
    const error = new Error('Final candidate file is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
    const error = new Error('Final candidate file does not exist.');
    error.statusCode = 404;
    throw error;
  }
  const watchDate = markdownCell(fields.watchDate || '');
  const reviewer = markdownCell(fields.reviewer || '');
  if (!watchDate) {
    const error = new Error('Final watch date is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!reviewer) {
    const error = new Error('Final reviewer is required.');
    error.statusCode = 400;
    throw error;
  }
  const decisionMarker = finalReviewStatusFromMarker(fields.decisionMarker || fields.marker || '');
  if (!FINAL_REVIEW_MARKERS.includes(decisionMarker)) {
    const error = new Error(`Invalid final review marker: ${fields.decisionMarker || fields.marker || ''}`);
    error.statusCode = 400;
    throw error;
  }
  return {
    candidatePath,
    watchDate,
    reviewer,
    viewerPromiseDelivery: markdownText(fields.viewerPromiseDelivery || '', ''),
    openingStrength: markdownText(fields.openingStrength || '', ''),
    clarity: markdownText(fields.clarity || '', ''),
    pacing: markdownText(fields.pacing || '', ''),
    proofEvidence: markdownText(fields.proofEvidence || '', ''),
    audioQuality: markdownText(fields.audioQuality || '', ''),
    visualSupport: markdownText(fields.visualSupport || '', ''),
    graphicsCaptions: markdownText(fields.graphicsCaptions || '', ''),
    titleThumbnailFit: markdownText(fields.titleThumbnailFit || '', ''),
    ethicalAccuracyRisks: markdownText(fields.ethicalAccuracyRisks || '', ''),
    uploadMetadataReadiness: markdownText(fields.uploadMetadataReadiness || '', ''),
    archiveReadiness: markdownText(fields.archiveReadiness || '', ''),
    remainingFinalFixes: markdownText(fields.remainingFinalFixes || '', ''),
    decisionMarker,
  };
}

function finalWatchNotesMarkdown(runId, fields) {
  return [
    FINAL_WATCH_NOTES_SECTION_START,
    '# Final-Watch Notes',
    '',
    `- Run: ${runId}`,
    '- Review type: final candidate review',
    '- External APIs called: no',
    '',
    '## Final Version Reviewed',
    '',
    fields.candidatePath,
    '',
    '## Watch Date',
    '',
    fields.watchDate,
    '',
    '## Reviewer',
    '',
    fields.reviewer,
    '',
    '## Final-Watch Issues',
    '',
    fields.decisionMarker === 'NEEDS FINAL FIXES' ? (fields.remainingFinalFixes || 'Needs final fixes.') : 'No unresolved final-watch issues listed.',
    '',
    '## Viewer Promise Delivery',
    '',
    fields.viewerPromiseDelivery || 'TODO',
    '',
    '## Opening Strength',
    '',
    fields.openingStrength || 'TODO',
    '',
    '## Clarity',
    '',
    fields.clarity || 'TODO',
    '',
    '## Pacing',
    '',
    fields.pacing || 'TODO',
    '',
    '## Proof / Evidence',
    '',
    fields.proofEvidence || 'TODO',
    '',
    '## Audio Quality',
    '',
    fields.audioQuality || 'TODO',
    '',
    '## Visual Support',
    '',
    fields.visualSupport || 'TODO',
    '',
    '## Graphics / Captions',
    '',
    fields.graphicsCaptions || 'TODO',
    '',
    '## Title / Thumbnail Fit',
    '',
    fields.titleThumbnailFit || 'TODO',
    '',
    '## Ethical / Accuracy Risks',
    '',
    fields.ethicalAccuracyRisks || 'TODO',
    '',
    '## Upload Metadata Readiness',
    '',
    fields.uploadMetadataReadiness || 'TODO',
    '',
    '## Archive Readiness',
    '',
    fields.archiveReadiness || 'TODO',
    '',
    '## Publication Blockers',
    '',
    fields.decisionMarker === 'NEEDS FINAL FIXES' ? (fields.remainingFinalFixes || 'Needs final fixes.') : 'No publication blockers listed by final watch.',
    '',
    '## Final Approval Marker',
    '',
    fields.decisionMarker === 'PASS'
      ? 'Final approval: PASS'
      : 'Final approval marker not granted. Current decision: NEEDS FINAL FIXES',
    '',
    '- PASS is a human final approval marker.',
    '- Do not generate PASS automatically.',
    '- Mikko must explicitly choose it after watching the full final candidate.',
    FINAL_WATCH_NOTES_SECTION_END,
    '',
  ].join('\n');
}

function saveFinalWatchNotes(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const fields = normalizeFinalWatchFields(payload.fields || payload, resolved);
  const managed = finalWatchNotesMarkdown(resolved.runId, fields);
  const targetPath = path.resolve(resolved.runDir, FINAL_WATCH_NOTES_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved final watch notes path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  fs.writeFileSync(targetPath, replaceManagedSection(existing, managed, FINAL_WATCH_NOTES_SECTION_START, FINAL_WATCH_NOTES_SECTION_END), 'utf8');
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written: [FINAL_WATCH_NOTES_FILE],
    publishReady: false,
    warning: fields.decisionMarker === 'PASS'
      ? 'Human Final approval: PASS marker recorded in source notes. Regenerate derived final-review.md before any publish readiness decision.'
      : 'Final-watch notes saved. Publish readiness remains blocked.',
  };
}

function parseFinalWatchNotes(content = '') {
  const text = String(content || '');
  const hasPass = /^(?:[-*]\s*)?(?:Manual approval|Final-watch approval|Final approval):\s*PASS\s*$/im.test(text);
  const marker = hasPass ? 'PASS' : (/NEEDS FINAL FIXES/i.test(text) ? 'NEEDS FINAL FIXES' : 'NEEDS HUMAN REVIEW');
  return {
    candidatePath: lineValue(text, 'Candidate file reviewed') || finalReviewScript.sectionTextAny(text, ['Final Version Reviewed']),
    reviewer: finalReviewScript.sectionTextAny(text, ['Reviewer']),
    watchDate: finalReviewScript.sectionTextAny(text, ['Watch Date']),
    status: marker,
    marker,
    finalApproved: marker === 'PASS',
    publishReady: false,
    remainingFinalFixes: finalReviewScript.sectionTextAny(text, ['Final-Watch Issues', 'Publication Blockers']),
    missingRequiredSections: finalReviewScript.missingRequiredFinalWatchSections(text),
    isStarter: finalReviewScript.isStarterFinalWatchNotes(text),
  };
}

function parseFinalReviewFile(runDir) {
  const reviewPath = path.join(runDir, FINAL_REVIEW_FILE);
  if (!fs.existsSync(reviewPath)) {
    return { exists: false, status: 'NEEDS HUMAN REVIEW', publishReady: false, candidatePath: '', reason: 'final-review.md is missing.' };
  }
  const text = fs.readFileSync(reviewPath, 'utf8');
  const status = (lineValue(text, 'Final review status') || lineValue(text, 'Review status') || lineValue(text, 'Status') || 'NEEDS HUMAN REVIEW').toUpperCase();
  return {
    exists: true,
    status,
    publishReady: /^yes$/i.test(lineValue(text, 'Publish ready')) && status === 'PASS',
    candidatePath: lineValue(text, 'Final version reviewed') || lineValue(text, 'Candidate file'),
    reason: lineValue(text, 'Reason'),
  };
}

function buildFinalReviewFromWatchNotes(runId, options = {}) {
  const resolved = resolvePackageRunDir(runId, options);
  const notesPath = path.join(resolved.runDir, FINAL_WATCH_NOTES_FILE);
  const notesText = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : '';
  const parsed = parseFinalWatchNotes(notesText);
  const finalCandidate = parseFinalCandidateArtifact(resolved.runDir);
  const secondCutReview = parseSecondCutReviewFile(resolved.runDir);
  const secondCutReady = Boolean(secondCutReview.secondCutReady && secondCutReview.status === 'READY FOR SECOND CUT');
  const candidatePath = markdownCell(parsed.candidatePath || finalCandidate.path || '');
  const candidateExists = Boolean(candidatePath && fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile());
  let status = parsed.status;
  const blockers = [];
  if (!notesText.trim()) blockers.push('final-watch-notes.md is missing.');
  if (parsed.isStarter) blockers.push('final-watch-notes.md is starter/template or lacks real final-watch evidence.');
  if (!secondCutReady) blockers.push('second-cut review is not READY FOR SECOND CUT.');
  if (!candidateExists) blockers.push('registered final candidate file is missing.');
  if (parsed.missingRequiredSections.length) blockers.push(`Required final-watch sections are not assessed: ${parsed.missingRequiredSections.join(', ')}.`);
  if (status !== 'PASS' && parsed.remainingFinalFixes && !/no (?:unresolved )?(?:publication blockers|final-watch issues)|none/i.test(parsed.remainingFinalFixes)) {
    status = 'NEEDS FINAL FIXES';
  }
  if (blockers.length) status = 'BLOCKED';
  const publishReady = status === 'PASS' && secondCutReady && candidateExists && !parsed.isStarter && parsed.missingRequiredSections.length === 0;
  const reason = blockers.length
    ? blockers.join(' ')
    : status === 'PASS'
      ? 'Exact Final approval: PASS marker is present with required final-watch sections and upstream second-cut readiness.'
      : status === 'NEEDS FINAL FIXES'
        ? 'Human final-watch notes request final fixes or do not include final approval.'
        : 'Missing exact final approval marker.';
  return {
    status,
    publishReady,
    reason,
    candidatePath,
    candidateExists,
    secondCutReady,
    secondCutReviewStatus: secondCutReview.status,
    sourceExists: Boolean(notesText.trim()),
    sourceIsStarter: parsed.isStarter,
    parsed,
    markdown: [
      FINAL_REVIEW_SECTION_START,
      '# Final Review',
      '',
      `- Run: ${resolved.runId}`,
      `- Source watch notes: ${FINAL_WATCH_NOTES_FILE}`,
      `- Registered final candidate: ${FINAL_CANDIDATE_FILE}`,
      `- Second-cut review status: ${secondCutReview.status}`,
      `- Second-cut ready: ${secondCutReady ? 'yes' : 'no'}`,
      `- Final version reviewed: ${candidatePath || 'not recorded'}`,
      `- Final review status: ${status}`,
      `- Publish ready: ${publishReady ? 'yes' : 'no'}`,
      '- External APIs called: no',
      '',
      '## Gate Result',
      '',
      `- Status: ${status}`,
      `- Reason: ${reason}`,
      `- Candidate file: ${candidatePath || 'not recorded'}`,
      `- Candidate exists: ${candidateExists ? 'yes' : 'no'}`,
      `- Required next action: ${publishReady ? 'Proceed to separate export/upload readiness checks; upload, archive, and state promotion remain separate gates.' : 'Resolve the final-watch blocker before publish/export/upload/archive work.'}`,
      '',
      '## Review Boundary',
      '',
      '- This review is derived from human final-watch notes.',
      '- It does not approve upload.',
      '- It does not approve archive.',
      '- It does not update package-run state.',
      '- It does not update package-runs-index.json.',
      '',
      '## Blocked Actions',
      '',
      '- export/upload readiness',
      '- publish metadata approval',
      '- upload',
      '- archive',
      '- state promotion',
      FINAL_REVIEW_SECTION_END,
      '',
    ].join('\n'),
  };
}

function regenerateFinalReviewDerived(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const review = buildFinalReviewFromWatchNotes(resolved.runId, options);
  const targetPath = path.resolve(resolved.runDir, FINAL_REVIEW_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved final review path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  fs.writeFileSync(targetPath, replaceManagedSection(existing, review.markdown, FINAL_REVIEW_SECTION_START, FINAL_REVIEW_SECTION_END), 'utf8');
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written: [FINAL_REVIEW_FILE],
    review,
    publishReady: review.publishReady,
    warning: 'Regenerated derived final-review.md only. Export/upload, publish metadata, archive, state, and index remain separate gates.',
  };
}

function buildFinalReviewConsole(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const finalCandidate = parseFinalCandidateArtifact(resolved.runDir);
  const finalWatchPath = path.join(resolved.runDir, FINAL_WATCH_NOTES_FILE);
  const finalReviewPath = path.join(resolved.runDir, FINAL_REVIEW_FILE);
  const finalWatchNotesExists = fs.existsSync(finalWatchPath);
  const finalReviewExists = fs.existsSync(finalReviewPath);
  const finalWatchText = finalWatchNotesExists ? fs.readFileSync(finalWatchPath, 'utf8') : '';
  const watchNotes = parseFinalWatchNotes(finalWatchText);
  const finalReview = parseFinalReviewFile(resolved.runDir);
  const derived = finalReviewExists ? finalReview : buildFinalReviewFromWatchNotes(resolved.runId, options);
  const secondCutReview = parseSecondCutReviewFile(resolved.runDir);
  const finalCandidateFileExists = Boolean(finalCandidate.path && fs.existsSync(finalCandidate.path) && fs.statSync(finalCandidate.path).isFile());
  const stale =
    finalWatchNotesExists && !finalReviewExists ||
    (finalWatchNotesExists && finalReviewExists && watchNotes.status !== finalReview.status && !(watchNotes.status === 'PASS' && finalReview.status === 'PASS')) ||
    (finalWatchNotesExists && finalReviewExists && fs.statSync(finalWatchPath).mtimeMs > fs.statSync(finalReviewPath).mtimeMs) ||
    (finalCandidate.exists && finalReviewExists && finalCandidate.path && finalReview.candidatePath && finalCandidate.path !== finalReview.candidatePath) ||
    (finalCandidate.exists && !finalCandidateFileExists);
  const warnings = [
    secondCutReview.secondCutReady ? '' : 'Second-cut review is not READY FOR SECOND CUT.',
    finalCandidate.exists && !finalCandidateFileExists ? 'Registered final candidate file is missing.' : '',
    finalWatchNotesExists && !finalReviewExists ? 'Derived final review missing; regenerate final-review.md.' : '',
    stale && finalReviewExists ? 'Derived final-review.md may be stale against final-watch notes or final candidate.' : '',
  ].filter(Boolean);
  const candidateStatus = !finalCandidate.exists ? 'not_registered' : finalCandidateFileExists ? 'registered_needs_final_watch' : 'missing_registered_file';
  return {
    ok: true,
    readOnly: true,
    externalApisCalled: false,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    secondCutReady: Boolean(secondCutReview.secondCutReady && secondCutReview.status === 'READY FOR SECOND CUT'),
    secondCutReviewStatus: secondCutReview.status,
    finalCandidateExists: finalCandidate.exists,
    finalCandidatePath: finalCandidate.path || '',
    finalCandidateFileExists,
    finalCandidateStatus: candidateStatus,
    finalWatchNotesExists,
    finalWatchNotesStatus: watchNotes.status,
    finalReviewExists,
    finalReviewStatus: derived.status,
    publishReady: Boolean(finalReviewExists && finalReview.publishReady),
    humanGateRequired: true,
    staleDerivedReview: stale,
    warnings,
    aiAllowed: ['inspect file metadata', 'prepare review checklist', 'parse final-watch notes', 'regenerate derived final review'],
    aiBlocked: ['choose PASS', 'approve publishing', 'upload', 'archive', 'update package-run-state.md', 'update package-runs-index.json', 'move/delete media'],
    blockedActions: ['approve publishing', 'mark upload ready', 'mark archive ready', 'update package-run state', 'commit state markers', 'upload', 'archive'],
    nextSafeAction: !secondCutReview.secondCutReady
      ? 'Complete explicit second-cut readiness before registering a final candidate.'
      : !finalCandidate.exists
        ? 'Export/register final candidate for human final-watch review.'
        : !finalWatchNotesExists
          ? 'Mikko watches final candidate and records final-watch notes.'
          : stale
            ? 'Regenerate derived final review from current final-watch notes.'
            : finalReview.publishReady
              ? 'Proceed only to separate export/upload readiness checks; upload/archive remain blocked.'
              : 'Resolve final-watch blockers before publish/export/upload/archive work.',
  };
}

function parseMasterFileManifest(runDir) {
  const artifactPath = path.join(runDir, MASTER_FILE_MANIFEST_FILE);
  if (!fs.existsSync(artifactPath)) return { exists: false, path: '', artifactPath: MASTER_FILE_MANIFEST_FILE };
  const text = fs.readFileSync(artifactPath, 'utf8');
  return {
    exists: true,
    path: lineValue(text, 'Final export file') || lineValue(text, 'Master file') || lineValue(text, 'Master file path') || lineValue(text, 'File name'),
    codec: lineValue(text, 'Codec') || lineValue(text, 'Video codec'),
    container: lineValue(text, 'Container') || lineValue(text, 'File container'),
    resolution: lineValue(text, 'Resolution'),
    frameRate: lineValue(text, 'Frame rate') || lineValue(text, 'Framerate') || lineValue(text, 'FPS'),
    audioSettings: lineValue(text, 'Audio settings') || lineValue(text, 'Audio export settings'),
    artifactPath: MASTER_FILE_MANIFEST_FILE,
  };
}

function parseExportChecklistFile(runDir) {
  const artifactPath = path.join(runDir, EXPORT_CHECKLIST_FILE);
  if (!fs.existsSync(artifactPath)) {
    return { exists: false, status: 'NEEDS EXPORT CHECK', readyToUpload: false, masterFilePath: '', reason: 'export-checklist.md is missing.' };
  }
  const text = fs.readFileSync(artifactPath, 'utf8');
  const status = (lineValue(text, 'Export checklist status') || lineValue(text, 'Status') || 'NEEDS EXPORT CHECK').toUpperCase();
  return {
    exists: true,
    status,
    readyToUpload: /^yes$/i.test(lineValue(text, 'Ready to upload')) && status === 'READY TO UPLOAD',
    masterFilePath: lineValue(text, 'Final export file') || lineValue(text, 'Master file'),
    reason: lineValue(text, 'Reason'),
  };
}

function exportMasterWarnings(descriptor, upstream) {
  const warnings = [];
  if (descriptor.metadataUnavailable) warnings.push('ffprobe metadata unavailable; file existence and filesystem metadata were recorded only.');
  if (!descriptor.audioStreamPresent && !descriptor.audioPresent) warnings.push('No audio stream detected or audio metadata unavailable.');
  if (!upstream.publishReady || upstream.finalReviewStatus !== 'PASS') warnings.push('Final review is not PASS with Publish ready: yes; export master registration is blocked.');
  return warnings;
}

function masterFileManifestManagedMarkdown(runId, descriptor, payload, upstream) {
  const notes = markdownText(payload.notes || '', 'No registration notes provided.');
  const exportTimestamp = markdownCell(payload.exportTimestamp || payload.exportedAt || '');
  const exportPreset = markdownCell(payload.exportPreset || payload.profile || '');
  const targetPlatform = markdownCell(payload.targetPlatform || 'YouTube');
  const audioSettings = descriptor.audioSampleRate || descriptor.audioChannels
    ? `${descriptor.audioSampleRate || 'sample rate unknown'} / ${descriptor.audioChannels || 'channels unknown'}`
    : 'metadata unavailable';
  return [
    MASTER_FILE_MANIFEST_SECTION_START,
    '# Master File Manifest',
    '',
    `- Run: ${runId}`,
    '- Artifact purpose: final export/master file reference for delivery review',
    '- Ready to upload: no',
    '- Human approval required: yes',
    '- External APIs called: no',
    '',
    '## Master File',
    '',
    `- Final export file: ${descriptor.path}`,
    `- Master file path: ${descriptor.path}`,
    `- Exists: ${descriptor.exists ? 'yes' : 'no'}`,
    `- Codec: ${descriptor.codec || 'metadata unavailable'}`,
    `- Container: ${path.extname(descriptor.path || '').replace(/^\./, '').toUpperCase() || 'metadata unavailable'}`,
    `- Resolution: ${descriptor.resolution || 'metadata unavailable'}`,
    `- Frame rate: ${descriptor.frameRate || 'metadata unavailable'}`,
    `- Audio settings: ${audioSettings}`,
    `- Duration: ${descriptor.duration || 'metadata unavailable'}`,
    `- Size: ${descriptor.size}`,
    `- Modified: ${descriptor.modifiedTime || ''}`,
    `- Target platform: ${targetPlatform}`,
    exportPreset ? `- Export preset/profile: ${exportPreset}` : '',
    exportTimestamp ? `- Export timestamp: ${exportTimestamp}` : '',
    '',
    '## Upstream Context',
    '',
    `- Final review status: ${upstream.finalReviewStatus}`,
    `- Publish ready from final review: ${upstream.publishReady ? 'yes' : 'no'}`,
    `- Source final review artifact: ${FINAL_REVIEW_FILE}`,
    '',
    '## Registration Notes',
    '',
    notes,
    '',
    '## Review Boundary',
    '',
    '- This artifact records a master/export file for delivery review.',
    '- It does not mark ready to upload.',
    '- It does not approve publish metadata, scheduling, upload, or archive.',
    '- It does not update package-run state.',
    MASTER_FILE_MANIFEST_SECTION_END,
    '',
  ].filter((line) => line !== '').join('\n');
}

function buildExportMasterRegistration(payload = {}, options = {}) {
  if (!payload.runId) {
    const error = new Error('runId is required for export master registration.');
    error.statusCode = 400;
    throw error;
  }
  const resolved = resolveRunFromPayload(payload, options);
  const masterFilePath = validateSecondCutCandidatePath(payload.masterFilePath, 'export master');
  const descriptor = buildMediaDescriptor(masterFilePath, options);
  descriptor.likelyRole = 'export master';
  descriptor.confidence = /final|master|export|upload|deliver/i.test(masterFilePath) ? 'medium' : 'low';
  descriptor.reasons = ['registered explicitly by Mikko for delivery review'];
  const finalReview = parseFinalReviewFile(resolved.runDir);
  const upstream = {
    finalReviewStatus: finalReview.status || 'MISSING',
    publishReady: Boolean(finalReview.publishReady && finalReview.status === 'PASS'),
  };
  const warnings = exportMasterWarnings(descriptor, upstream);
  const artifactPreview = masterFileManifestManagedMarkdown(resolved.runId, descriptor, payload, upstream);
  return {
    ok: true,
    readOnly: options.mode !== 'apply',
    externalApisCalled: false,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    masterFilePath,
    masterFileExists: true,
    metadata: {
      duration: descriptor.duration,
      codec: descriptor.codec,
      container: path.extname(masterFilePath).replace(/^\./, '').toUpperCase(),
      resolution: descriptor.resolution,
      frameRate: descriptor.frameRate,
      audioStreams: descriptor.audioStreamPresent || descriptor.audioPresent ? 1 : 0,
      audioSampleRate: descriptor.audioSampleRate || '',
      audioChannels: descriptor.audioChannels || '',
      size: descriptor.size,
      modified: descriptor.modifiedTime,
      metadataUnavailable: Boolean(descriptor.metadataUnavailable),
    },
    upstream,
    warnings,
    artifactFilename: MASTER_FILE_MANIFEST_FILE,
    artifactPreview,
    humanGateRequired: true,
    readyToUpload: false,
    aiAllowed: ['validate file existence', 'inspect technical metadata', 'record master file reference'],
    aiBlocked: ['choose delivery PASS', 'mark ready to upload', 'upload', 'publish', 'archive', 'update package-run-state.md', 'update package-runs-index.json', 'move/delete/transcode media'],
  };
}

function applyExportMasterRegistration(payload = {}, options = {}) {
  const registration = buildExportMasterRegistration(payload, { ...options, mode: 'apply' });
  if (!registration.upstream.publishReady || registration.upstream.finalReviewStatus !== 'PASS') {
    const error = new Error('Final review is not PASS with Publish ready: yes; export master registration is blocked.');
    error.statusCode = 409;
    throw error;
  }
  const resolved = resolvePackageRunDir(registration.runId, options);
  const targetPath = path.resolve(resolved.runDir, MASTER_FILE_MANIFEST_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved master file manifest path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  fs.writeFileSync(targetPath, replaceManagedSection(existing, registration.artifactPreview, MASTER_FILE_MANIFEST_SECTION_START, MASTER_FILE_MANIFEST_SECTION_END), 'utf8');
  return {
    ...registration,
    readOnly: false,
    written: [MASTER_FILE_MANIFEST_FILE],
    warning: 'Registered export master for delivery review only. Upload readiness is not approved.',
  };
}

function deliveryReadinessStatusFromMarker(marker = '') {
  const normalized = String(marker || '').trim().toUpperCase();
  if (DELIVERY_READINESS_MARKERS.includes(normalized)) return normalized;
  return 'NEEDS EXPORT CHECK';
}

function normalizeDeliveryReadinessFields(fields = {}, resolved) {
  const manifest = parseMasterFileManifest(resolved.runDir);
  const masterFilePath = markdownCell(fields.masterFilePath || manifest.path || '');
  if (!masterFilePath) {
    const error = new Error('Master file path is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(masterFilePath) || !fs.statSync(masterFilePath).isFile()) {
    const error = new Error('Master file does not exist.');
    error.statusCode = 404;
    throw error;
  }
  const rawDecisionMarker = String(fields.decisionMarker || fields.marker || '').trim().toUpperCase();
  if (!DELIVERY_READINESS_MARKERS.includes(rawDecisionMarker)) {
    const error = new Error(`Invalid delivery readiness marker: ${fields.decisionMarker || fields.marker || ''}`);
    error.statusCode = 400;
    throw error;
  }
  const decisionMarker = deliveryReadinessStatusFromMarker(rawDecisionMarker);
  return {
    masterFilePath,
    intendedPlatform: markdownCell(fields.intendedPlatform || 'YouTube'),
    exportPreset: markdownCell(fields.exportPreset || ''),
    containerCodecConfirmation: markdownText(fields.containerCodecConfirmation || '', ''),
    resolutionConfirmation: markdownText(fields.resolutionConfirmation || '', ''),
    frameRateConfirmation: markdownText(fields.frameRateConfirmation || '', ''),
    audioSettingsConfirmation: markdownText(fields.audioSettingsConfirmation || '', ''),
    loudnessStatus: markdownText(fields.loudnessStatus || '', ''),
    captionsStatus: markdownText(fields.captionsStatus || '', ''),
    qcNotes: markdownText(fields.qcNotes || '', ''),
    decisionMarker,
  };
}

function deliveryArtifactMarkdowns(runId, fields) {
  const ready = fields.decisionMarker === 'PASS';
  const status = ready ? 'READY TO UPLOAD' : 'NEEDS EXPORT CHECK';
  const loudness = fields.loudnessStatus || 'TODO';
  const captions = fields.captionsStatus || 'TODO';
  return {
    [CAPTION_CHECK_FILE]: [
      CAPTION_CHECK_SECTION_START,
      '# Caption Check',
      '',
      `- Captions/subtitles status: ${captions}`,
      '',
      '## Review Boundary',
      '',
      '- This records caption/subtitle status for delivery review only.',
      '- It does not mark ready to upload.',
      CAPTION_CHECK_SECTION_END,
      '',
    ].join('\n'),
    [LOUDNESS_CHECK_FILE]: [
      LOUDNESS_CHECK_SECTION_START,
      '# Loudness Check',
      '',
      `- Loudness check: ${loudness}`,
      '',
      '## Approval Marker',
      '',
      '- Add `Mastering approval: PASS` only after real loudness/mastering review.',
      ready ? 'Mastering approval: PASS' : '',
      LOUDNESS_CHECK_SECTION_END,
      '',
    ].filter((line) => line !== '').join('\n'),
    [DELIVERY_READINESS_FILE]: [
      DELIVERY_READINESS_SECTION_START,
      '# Delivery Readiness',
      '',
      `- Export checklist status: ${status}`,
      `- Ready to upload: ${ready ? 'yes' : 'no'}`,
      `- Master file path: ${fields.masterFilePath}`,
      `- Intended platform: ${fields.intendedPlatform}`,
      fields.exportPreset ? `- Export preset/profile: ${fields.exportPreset}` : '',
      `- Container/codec confirmation: ${fields.containerCodecConfirmation || 'TODO'}`,
      `- Resolution confirmation: ${fields.resolutionConfirmation || 'TODO'}`,
      `- Frame rate confirmation: ${fields.frameRateConfirmation || 'TODO'}`,
      `- Audio settings confirmation: ${fields.audioSettingsConfirmation || 'TODO'}`,
      `- Loudness check: ${loudness}`,
      `- Captions/subtitles status: ${captions}`,
      '',
      '## QC Notes',
      '',
      fields.qcNotes || 'TODO',
      '',
      '## Approval Marker',
      '',
      '- Add `Delivery approval: PASS` only after the export is ready for upload.',
      ready ? 'Delivery approval: PASS' : 'Delivery approval marker not granted. Current decision: NEEDS EXPORT CHECK',
      '',
      '## Upload Readiness Gate',
      '',
      `- Status: ${status}`,
      `- Reason: ${ready ? 'Mikko explicitly marked Delivery approval: PASS.' : 'Delivery approval has not been granted.'}`,
      DELIVERY_READINESS_SECTION_END,
      '',
    ].filter((line) => line !== '').join('\n'),
  };
}

function saveDeliveryReadiness(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const fields = normalizeDeliveryReadinessFields(payload.fields || payload, resolved);
  const markdowns = deliveryArtifactMarkdowns(resolved.runId, fields);
  const written = [];
  Object.entries(markdowns).forEach(([filename, markdown]) => {
    const targetPath = path.resolve(resolved.runDir, filename);
    if (!targetPath.startsWith(resolved.runDir + path.sep)) {
      const error = new Error('Resolved delivery artifact path is outside the approved write scope.');
      error.statusCode = 400;
      throw error;
    }
    const markers = {
      [CAPTION_CHECK_FILE]: [CAPTION_CHECK_SECTION_START, CAPTION_CHECK_SECTION_END],
      [LOUDNESS_CHECK_FILE]: [LOUDNESS_CHECK_SECTION_START, LOUDNESS_CHECK_SECTION_END],
      [DELIVERY_READINESS_FILE]: [DELIVERY_READINESS_SECTION_START, DELIVERY_READINESS_SECTION_END],
    }[filename];
    const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
    fs.writeFileSync(targetPath, replaceManagedSection(existing, markdown, markers[0], markers[1]), 'utf8');
    written.push(filename);
  });
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written,
    readyToUpload: false,
    warning: fields.decisionMarker === 'PASS'
      ? 'Human Delivery approval: PASS marker recorded. Regenerate derived export-checklist.md before any upload readiness decision.'
      : 'Delivery checks saved. Upload readiness remains blocked.',
  };
}

function buildExportChecklistFromDelivery(runId, options = {}) {
  const resolved = resolvePackageRunDir(runId, options);
  const context = exportChecklistScript.readContext(resolved.runDir);
  context.targetArtifactsMissing = [
    MASTER_FILE_MANIFEST_FILE,
    CAPTION_CHECK_FILE,
    LOUDNESS_CHECK_FILE,
    DELIVERY_READINESS_FILE,
  ].some((filename) => !context.files[filename]);
  const readiness = exportChecklistScript.determineExportReadiness(context);
  return {
    status: readiness.status,
    readyToUpload: readiness.readyToUpload,
    reason: readiness.reason,
    blockers: readiness.blockers,
    nextActions: readiness.nextActions,
    context,
    markdown: [
      EXPORT_CHECKLIST_SECTION_START,
      exportChecklistScript.buildExportChecklist(context, readiness),
      EXPORT_CHECKLIST_SECTION_END,
      '',
    ].join('\n'),
  };
}

function regenerateExportChecklistDerived(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const review = buildExportChecklistFromDelivery(resolved.runId, options);
  const targetPath = path.resolve(resolved.runDir, EXPORT_CHECKLIST_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved export checklist path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  fs.writeFileSync(targetPath, replaceManagedSection(existing, review.markdown, EXPORT_CHECKLIST_SECTION_START, EXPORT_CHECKLIST_SECTION_END), 'utf8');
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written: [EXPORT_CHECKLIST_FILE],
    review,
    readyToUpload: review.readyToUpload,
    warning: 'Regenerated derived export-checklist.md only. Publish metadata, scheduling, upload, archive, state, and index remain separate gates.',
  };
}

function buildExportDeliveryConsole(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const finalReview = parseFinalReviewFile(resolved.runDir);
  const manifest = parseMasterFileManifest(resolved.runDir);
  const checklist = parseExportChecklistFile(resolved.runDir);
  const paths = {
    manifest: path.join(resolved.runDir, MASTER_FILE_MANIFEST_FILE),
    caption: path.join(resolved.runDir, CAPTION_CHECK_FILE),
    loudness: path.join(resolved.runDir, LOUDNESS_CHECK_FILE),
    delivery: path.join(resolved.runDir, DELIVERY_READINESS_FILE),
    checklist: path.join(resolved.runDir, EXPORT_CHECKLIST_FILE),
    finalReview: path.join(resolved.runDir, FINAL_REVIEW_FILE),
  };
  const masterFileExists = Boolean(manifest.path && fs.existsSync(manifest.path) && fs.statSync(manifest.path).isFile());
  const captionCheckExists = fs.existsSync(paths.caption);
  const loudnessCheckExists = fs.existsSync(paths.loudness);
  const deliveryReadinessExists = fs.existsSync(paths.delivery);
  const exportChecklistExists = fs.existsSync(paths.checklist);
  const context = exportChecklistScript.readContext(resolved.runDir);
  const readiness = exportChecklistScript.determineExportReadiness(context);
  const stale =
    (fs.existsSync(paths.manifest) && exportChecklistExists && fs.statSync(paths.manifest).mtimeMs > fs.statSync(paths.checklist).mtimeMs) ||
    (deliveryReadinessExists && exportChecklistExists && fs.statSync(paths.delivery).mtimeMs > fs.statSync(paths.checklist).mtimeMs) ||
    (captionCheckExists && exportChecklistExists && fs.statSync(paths.caption).mtimeMs > fs.statSync(paths.checklist).mtimeMs) ||
    (loudnessCheckExists && exportChecklistExists && fs.statSync(paths.loudness).mtimeMs > fs.statSync(paths.checklist).mtimeMs) ||
    (fs.existsSync(paths.finalReview) && exportChecklistExists && fs.statSync(paths.finalReview).mtimeMs > fs.statSync(paths.checklist).mtimeMs) ||
    (checklist.readyToUpload && !masterFileExists) ||
    (checklist.readyToUpload && !context.deliveryApproved);
  const warnings = [
    finalReview.publishReady ? '' : 'Final review is not PASS with Publish ready: yes.',
    manifest.exists && !masterFileExists ? 'Registered master file is missing.' : '',
    exportChecklistExists && stale ? 'Derived export-checklist.md may be stale against current delivery artifacts.' : '',
  ].filter(Boolean);
  return {
    ok: true,
    readOnly: true,
    externalApisCalled: false,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    finalReviewStatus: finalReview.status,
    publishReady: Boolean(finalReview.publishReady && finalReview.status === 'PASS'),
    masterFileManifestExists: manifest.exists,
    masterFilePath: manifest.path || '',
    masterFileExists,
    exportChecklistExists,
    exportReadinessStatus: exportChecklistExists ? checklist.status : readiness.status,
    readyToUpload: Boolean(exportChecklistExists && checklist.readyToUpload),
    loudnessCheckExists,
    captionCheckExists,
    deliveryReadinessExists,
    deliveryApproved: context.deliveryApproved,
    humanGateRequired: true,
    staleDerivedChecklist: stale,
    warnings,
    aiAllowed: ['inspect file metadata', 'prepare checklist', 'parse artifacts', 'regenerate derived export checklist'],
    aiBlocked: ['choose delivery PASS', 'upload', 'publish', 'schedule', 'archive', 'update package-run-state.md', 'update package-runs-index.json', 'move/delete/transcode media'],
    blockedActions: ['upload', 'publish', 'schedule', 'archive', 'update package-run state', 'commit state markers'],
    nextSafeAction: !finalReview.publishReady
      ? 'Complete final review PASS before export/master registration.'
      : !manifest.exists
        ? 'Export/register master file for delivery review.'
        : !captionCheckExists || !loudnessCheckExists || !deliveryReadinessExists
          ? 'Record export metadata, loudness, captions, and delivery readiness.'
          : stale
            ? 'Regenerate derived export-checklist.md from current delivery artifacts.'
            : checklist.readyToUpload
              ? 'Proceed to separate publish metadata review; upload/archive remain blocked.'
              : 'Resolve export/checklist blockers before upload.',
  };
}

function markdownTableItems(markdown = '') {
  return String(markdown || '')
    .split(/\r?\n/)
    .filter((line) => /^\s*\|/.test(line) && !/\|\s*-+\s*\|/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => markdownCell(cell)))
    .filter((cells) => cells.length && !/^none\.?$/i.test(cells[0]) && !/^item title$|^pickup shot/i.test(cells[0]));
}

function readRunFile(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function runArtifactStatus(runDir, filenames = []) {
  return filenames.map((filename) => {
    const filePath = path.join(runDir, filename);
    const exists = fs.existsSync(filePath);
    return {
      filename,
      status: exists ? 'present' : 'missing',
      exists,
      modifiedAt: exists ? new Date(fs.statSync(filePath).mtimeMs).toISOString() : '',
    };
  });
}

function extractReferencedMediaPaths(markdown = '') {
  const text = String(markdown || '');
  const matches = [
    ...text.matchAll(/`([^`\n]+\.(?:mp4|mov|mkv|webm|m4v|wav|mp3|m4a|flac|png|jpe?g|svg))`/gi),
    ...text.matchAll(/\b((?:\/|\.{0,2}\/)?[A-Za-z0-9_./ -]+\.(?:mp4|mov|mkv|webm|m4v|wav|mp3|m4a|flac|png|jpe?g|svg))\b/gi),
  ];
  return [...new Set(matches.map((match) => markdownCell(match[1]).replace(/[),.;:]+$/, '')).filter(Boolean))]
    .filter((item) => !/^https?:\/\//i.test(item));
}

function groupSecondCutSourcePaths(roughCutResult = {}, sourceText = {}, secondCutInspector = {}) {
  const seen = new Set();
  const unique = (items = []) => items
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
  const take = (items = []) => unique(items).filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
  const supportMapReferences = extractReferencedMediaPaths(sourceText.supportMap || '');
  const roughAndNotesReferences = [
    ...extractReferencedMediaPaths(sourceText.roughReview || ''),
    ...extractReferencedMediaPaths(sourceText.notes || ''),
  ];
  const pickupMedia = (secondCutInspector.pickupMedia || []).map((item) => item.path || item.filename);
  const candidates = (secondCutInspector.candidates || []).map((item) => item.path || item.filename);
  const screenRecordingCandidates = unique([
    ...candidates.filter((item) => /screen-recording-candidates/i.test(String(item || ''))),
    ...supportMapReferences.filter((item) => /screen-recording-candidates/i.test(item)),
    ...roughAndNotesReferences.filter((item) => /screen-recording-candidates/i.test(item)),
  ]);
  const reviewed = take([roughCutResult.reviewedFilePath]);
  const pickups = take(pickupMedia);
  const screenCandidates = take(screenRecordingCandidates);
  const supportRefs = take(supportMapReferences);
  const other = take([
    ...roughAndNotesReferences,
    ...candidates,
  ]);
  return [
    { key: 'reviewedRoughCut', label: 'reviewed rough cut', source: 'rough-cut watch notes', paths: reviewed.length ? reviewed : ['missing'] },
    { key: 'pickupMedia', label: 'pickup media', source: 'discovered pickup media / second-cut inspector', paths: pickups.length ? pickups : ['missing'] },
    { key: 'screenRecordingCandidates', label: 'screen-recording candidates', source: 'referenced candidates', paths: screenCandidates.length ? screenCandidates : ['missing'] },
    { key: 'supportMapReferences', label: 'support-map references', source: 'second-cut-visual-support-map.md', paths: supportRefs.length ? supportRefs : ['missing'] },
    { key: 'otherReferencedPaths', label: 'other referenced paths', source: 'rough-cut-review.md / notes.md / candidate discovery', paths: other.length ? other : ['missing'] },
  ];
}

function buildSecondCutNextActionPacket(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const roughCutResult = parseRoughCutReviewFile(resolved.runDir);
  const secondCutInspector = buildSecondCutInspector(payload, options);
  const pickupRequirements = secondCutInspector.pickupRequirements || buildPickupRequirements(resolved, roughCutResult);
  const indexStatus = dashboardIndexStatus(resolved);
  const filenames = [
    'rough-cut-review.md',
    'pickup-list.md',
    'edit-fix-list.md',
    'second-cut-visual-support-map.md',
    'notes.md',
    'package-runs-index.json',
  ];
  const runArtifacts = runArtifactStatus(resolved.runDir, filenames.filter((filename) => filename !== 'package-runs-index.json'));
  const indexPath = path.join(resolved.root, 'package-runs-index.json');
  const indexArtifact = {
    filename: 'package-runs-index.json',
    status: fs.existsSync(indexPath) ? 'present' : 'missing',
    exists: fs.existsSync(indexPath),
    modifiedAt: fs.existsSync(indexPath) ? new Date(fs.statSync(indexPath).mtimeMs).toISOString() : '',
  };
  const supportMap = readRunFile(resolved.runDir, 'second-cut-visual-support-map.md');
  const notes = readRunFile(resolved.runDir, 'notes.md');
  const roughReview = readRunFile(resolved.runDir, 'rough-cut-review.md');
  const allSourceText = [supportMap, notes, roughReview].join('\n');
  const groupedSourcePaths = groupSecondCutSourcePaths(roughCutResult, { supportMap, notes, roughReview }, secondCutInspector);
  const referencedPaths = [
    roughCutResult.reviewedFilePath,
    ...extractReferencedMediaPaths(allSourceText),
    ...((secondCutInspector.pickupMedia || []).map((item) => item.path || item.filename)),
    ...((secondCutInspector.candidates || []).map((item) => item.path || item.filename)),
  ].filter(Boolean);
  const pickupNeeds = [
    ...((pickupRequirements.pickupsRequested || []).filter(Boolean)),
    ...(roughCutResult.currentPickupsDetected && !(pickupRequirements.pickupsRequested || []).length
      ? [`${roughCutResult.currentPickupsDetected} pickup item(s) detected in current rough-cut watch notes.`]
      : []),
  ];
  const editFixes = (pickupRequirements.editFixesRequested || []).filter(Boolean);
  const blocker = roughCutResult.roughCutReviewStatus === 'NEEDS PICKUPS'
    ? 'Pickup items are still open; second-cut readiness is not available.'
    : roughCutResult.roughCutReviewStatus === 'NEEDS EDIT FIXES'
      ? 'Edit fixes are still open; second-cut readiness is not available.'
      : roughCutResult.secondCutReady
        ? 'Rough-cut artifacts report second-cut readiness, but downstream approval still requires human review.'
        : `Rough-cut review status is ${roughCutResult.roughCutReviewStatus || 'unknown'}, not READY FOR SECOND CUT.`;
  const nextDecision = secondCutInspector.candidateStatus === 'found_needs_review'
    ? 'Mikko watches the registered second-cut candidate and records second-cut watch notes.'
    : roughCutResult.roughCutReviewStatus === 'NEEDS PICKUPS'
      ? 'First inspect the reviewed rough cut or current Resolve timeline, choose the highest-priority pickup/support insert supported by the artifacts, place it in Resolve, then export or register a second-cut candidate only after the pickup/edit work is represented in the timeline.'
      : roughCutResult.roughCutReviewStatus === 'NEEDS EDIT FIXES'
        ? 'Mikko applies the listed edit fixes, then exports or identifies a second-cut candidate for review.'
        : 'Mikko reviews the rough-cut gate and records the next human decision.';
  const blockedApprovals = [
    'second-cut ready',
    'final review',
    'publish ready',
    'upload',
    'archive',
    'Hermes brain write',
    'project-state promotion',
    'package-runs-index update',
    'commit',
    'push',
  ];
  const freshnessWarnings = [
    !indexStatus.updatedForActiveRun ? indexStatus.reason : '',
    roughCutResult.derivedArtifactStale ? roughCutResult.staleReason : '',
  ].filter(Boolean);
  const artifactBackedFacts = [
    { label: 'Rough-cut status', value: roughCutResult.roughCutReviewStatus || 'NOT STARTED', source: 'rough-cut-review.md' },
    { label: 'Second-cut ready marker', value: roughCutResult.secondCutReady ? 'yes' : 'no', source: 'rough-cut-review.md' },
    { label: 'Pickup-list status', value: pickupRequirements.pickupListStatus || 'missing', source: 'pickup-list.md' },
    { label: 'Edit-fix-list status', value: pickupRequirements.editFixListStatus || 'missing', source: 'edit-fix-list.md' },
    { label: 'Second-cut candidate status', value: secondCutInspector.candidateStatus || 'unknown', source: 'candidate discovery / second-cut-candidate.md if present' },
  ];
  return {
    ok: true,
    readOnly: true,
    externalApisCalled: false,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    currentRoughCutStatus: roughCutResult.roughCutReviewStatus || 'NOT STARTED',
    secondCutReady: Boolean(roughCutResult.secondCutReady && secondCutInspector.secondCutReady),
    currentBlocker: blocker,
    exactPickupNeeds: pickupNeeds.length ? pickupNeeds : ['missing'],
    editFixes: editFixes.length ? editFixes : ['missing or none listed'],
    supportingArtifacts: [...runArtifacts, indexArtifact],
    candidateMediaSourcePaths: [...new Set(referencedPaths)].length ? [...new Set(referencedPaths)] : ['missing'],
    groupedMediaSourcePaths: groupedSourcePaths,
    artifactBackedFacts,
    inferredGuidance: {
      label: 'Dashboard-inferred guidance',
      source: 'derived from artifact-backed facts; not quoted from a source artifact',
      nextVisibleAction: nextDecision,
      checks: [
        'Confirm evidence-boundary labels and visual-support inserts do not imply proof or final approval.',
        'Only choose a second-cut marker after watching the exported/registered second-cut candidate.',
      ],
    },
    mikkoMustWatchOrDecide: [
      nextDecision,
      'Confirm evidence-boundary labels and visual-support inserts do not imply proof or final approval.',
      'Only choose a second-cut marker after watching the exported/registered second-cut candidate.',
    ],
    mustNotApproveYet: blockedApprovals,
    sourceFreshnessWarnings: freshnessWarnings.length ? freshnessWarnings : ['No source freshness warning detected.'],
    sourceFiles: filenames,
  };
}

function buildPickupRequirements(resolved, roughCutResult) {
  const pickupText = readRunFile(resolved.runDir, 'pickup-list.md');
  const editText = readRunFile(resolved.runDir, 'edit-fix-list.md');
  return {
    roughCutStatus: roughCutResult.roughCutReviewStatus || 'NOT STARTED',
    secondCutReady: Boolean(roughCutResult.secondCutReady),
    sourceWatchNoteMarker: roughCutResult.currentWatchNotesMarker || roughCutResult.approvalMarker || 'NOT GIVEN',
    pickupListStatus: pickupText ? summarizeListStatus(pickupText) : 'missing',
    editFixListStatus: editText ? summarizeListStatus(editText) : 'missing',
    pickupsRequested: markdownTableItems(pickupText).map((cells) => cells[0]),
    editFixesRequested: markdownTableItems(editText).map((cells) => cells[0]).filter((item) => !/^none\.?$/i.test(item)),
    humanReviewRequired: true,
  };
}

function buildSecondCutPlacementChecklist() {
  return [
    'Confirm over-shoulder/context shot appears early enough to break screen-only flow.',
    'Confirm keyboard/mouse clip is used during workflow/process narration.',
    'Confirm hands-on-notes clip is used during proof/checklist/review narration.',
    'Confirm silent talking-head presence is used only as a short reset, not unsynced speech.',
    'Confirm pickup inserts are mostly 2-4 seconds.',
    'Confirm no important screen text is covered.',
    'Confirm no private/sensitive screen detail is exposed.',
    'Confirm AI-generated or pickup B-roll is not implied as proof evidence.',
    'Confirm rough cut is not approved until Mikko reviews the second-cut candidate.',
  ];
}

function discoverSecondCutMedia(resolved, options = {}) {
  const roots = mediaSearchRoots(resolved, options);
  const files = [...new Set(roots.flatMap((root) => walkMediaFiles(root)))];
  const descriptors = files.map((filePath) => buildMediaDescriptor(filePath, options));
  const registered = parseSecondCutCandidateArtifact(resolved.runDir);
  let registeredCandidate = null;
  if (registered.exists && registered.path) {
    if (fs.existsSync(registered.path) && fs.statSync(registered.path).isFile()) {
      registeredCandidate = {
        ...buildMediaDescriptor(registered.path, options),
        likelyRole: 'second-cut candidate',
        confidence: 'high',
        reasons: ['registered in second-cut-candidate.md for human review'],
        registered: true,
        reviewStatus: registered.reviewStatus || 'READY FOR HUMAN REVIEW',
      };
    } else {
      registeredCandidate = {
        filename: path.basename(registered.path),
        path: registered.path,
        exists: false,
        likelyRole: 'second-cut candidate',
        confidence: 'high',
        reasons: ['registered in second-cut-candidate.md, but file is missing'],
        registered: true,
        reviewStatus: registered.reviewStatus || 'READY FOR HUMAN REVIEW',
        metadataUnavailable: true,
      };
    }
  }
  const discoveredCandidates = descriptors.filter((item) => item.likelyRole === 'second-cut candidate');
  const candidates = registeredCandidate
    ? [registeredCandidate, ...discoveredCandidates.filter((item) => item.path !== registeredCandidate.path)]
    : discoveredCandidates;
  return {
    registeredCandidate,
    candidates,
    pickupMedia: descriptors
      .filter((item) => item.likelyRole === 'pickup media' || /pickup/i.test(item.path))
      .map((item) => ({
        ...item,
        likelyCategory: classifyPickupCategory(item.path),
        usableStatus: item.metadataUnavailable ? 'unknown' : 'maybe usable',
        humanReviewRequired: true,
      })),
  };
}

function buildSecondCutInspector(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const roughCutResult = parseRoughCutReviewFile(resolved.runDir);
  const media = discoverSecondCutMedia(resolved, options);
  const watchNotesPath = path.join(resolved.runDir, SECOND_CUT_WATCH_NOTES_FILE);
  const reviewPath = path.join(resolved.runDir, SECOND_CUT_REVIEW_FILE);
  const secondCutWatchNotesExists = fs.existsSync(watchNotesPath);
  const secondCutReviewExists = fs.existsSync(reviewPath);
  const watchNotesText = secondCutWatchNotesExists ? fs.readFileSync(watchNotesPath, 'utf8') : '';
  const watchNotes = parseSecondCutWatchNotes(watchNotesText);
  const derivedReview = parseSecondCutReviewFile(resolved.runDir);
  const secondCutReviewStatus = secondCutReviewExists ? derivedReview.status : watchNotes.status;
  const derivedReviewStale =
    secondCutWatchNotesExists && !secondCutReviewExists ||
    (secondCutWatchNotesExists && secondCutReviewExists && watchNotes.status !== derivedReview.status) ||
    (secondCutWatchNotesExists && secondCutReviewExists && fs.statSync(watchNotesPath).mtimeMs > fs.statSync(reviewPath).mtimeMs) ||
    (secondCutWatchNotesExists && secondCutReviewExists && watchNotes.candidatePath && derivedReview.candidatePath && watchNotes.candidatePath !== derivedReview.candidatePath);
  const candidateStatus =
    media.registeredCandidate && !media.registeredCandidate.exists
      ? 'missing_registered_file'
      : media.registeredCandidate && media.registeredCandidate.exists
        ? 'found_needs_review'
        : media.candidates.length === 0
      ? 'not_found'
      : media.candidates.length === 1
        ? 'found_needs_review'
        : 'multiple_candidates';
  const pickupRequirements = buildPickupRequirements(resolved, roughCutResult);
  const blockedActions = [
    'approve rough cut',
    'mark second-cut ready',
    'mark final review ready',
    'publish',
    'upload',
    'archive',
    'update package-run state',
    'commit state markers',
    ...(candidateStatus === 'not_found' ? ['start final review', 'export/upload review', 'publish metadata review'] : []),
  ];
  const warnings = [
    candidateStatus === 'not_found' ? 'Second-cut candidate not found.' : '',
    candidateStatus === 'missing_registered_file' ? 'Registered second-cut candidate file is missing.' : '',
    candidateStatus === 'multiple_candidates' ? 'Multiple second-cut candidates found; Mikko must choose one manually.' : '',
    secondCutWatchNotesExists && !secondCutReviewExists ? 'Derived second-cut review missing; regenerate second-cut-review.md.' : '',
    derivedReviewStale && secondCutReviewExists ? 'Derived second-cut review may be stale against current watch notes.' : '',
    roughCutResult.secondCutReady ? 'Second-cut readiness marker exists; human verification is still required.' : '',
  ].filter(Boolean);
  const secondCutReady = Boolean(secondCutReviewExists && derivedReview.secondCutReady && derivedReview.status === 'READY FOR SECOND CUT');
  const nextSafeAction =
    candidateStatus === 'missing_registered_file'
      ? 'Registered second-cut candidate is missing. Next safe action: locate or re-register the exported second-cut candidate before review.'
      : secondCutWatchNotesExists && derivedReviewStale
        ? 'Regenerate derived second-cut review from current human watch notes.'
        : candidateStatus === 'not_found'
          ? 'Second-cut candidate not found. Next safe action: export or identify a second-cut candidate, then inspect it before any approval.'
          : !secondCutWatchNotesExists
            ? 'Mikko should watch the registered second-cut candidate and record second-cut watch notes.'
            : 'Inspect the second-cut review result before any downstream final-review work.';
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    readOnly: true,
    externalApisCalled: false,
    currentGate: candidateStatus === 'not_found' ? 'Second-Cut Candidate Preparation' : 'Second-Cut Candidate Inspection',
    roughCutStatus: roughCutResult.roughCutReviewStatus || 'NOT STARTED',
    secondCutReady,
    secondCutWatchNotesExists,
    secondCutReviewExists,
    secondCutReviewStatus,
    secondCutWatchNotesStatus: watchNotes.status,
    secondCutDerivedReviewStale: derivedReviewStale,
    candidateStatus,
    candidates: media.candidates,
    registeredCandidate: media.registeredCandidate || null,
    pickupMedia: media.pickupMedia,
    pickupRequirements,
    placementChecklist: buildSecondCutPlacementChecklist(),
    humanGateRequired: true,
    aiAllowed: ['inspect file metadata', 'classify pickup files', 'draft review checklist', 'surface missing candidate'],
    aiBlocked: ['approve rough cut', 'mark second-cut ready', 'update package-run-state.md', 'update package-runs-index.json', 'commit or push', 'move/delete/rename media'],
    blockedActions,
    warnings,
    nextSafeAction,
  };
}

function normalizePickupItem(item = {}) {
  const title = markdownCell(item.title || item.itemTitle || '');
  const type = markdownCell(item.type || '');
  const required = markdownCell(item.required || '').toLowerCase();
  const source = markdownCell(item.source || '');
  const purpose = markdownCell(item.purpose || '');
  const status = markdownCell(item.status || '').toLowerCase();
  const notes = markdownText(item.notes || '', '');
  const allowed = [
    [PICKUP_ITEM_TYPES, type, 'type'],
    [PICKUP_REQUIRED_VALUES, required, 'required'],
    [PICKUP_SOURCES, source, 'source'],
    [PICKUP_PURPOSES, purpose, 'purpose'],
    [PICKUP_STATUSES, status, 'status'],
  ];
  const invalid = allowed.find(([values, value]) => !values.includes(value));
  if (!title) {
    const error = new Error('Pickup item title is required.');
    error.statusCode = 400;
    throw error;
  }
  if (invalid) {
    const error = new Error(`Invalid pickup ${invalid[2]}: ${invalid[1]}`);
    error.statusCode = 400;
    throw error;
  }
  return { title, type, required, source, purpose, status, notes };
}

function normalizePickupItems(items = []) {
  if (!Array.isArray(items) || !items.length) {
    const error = new Error('At least one pickup item is required.');
    error.statusCode = 400;
    throw error;
  }
  return items.map(normalizePickupItem);
}

function buildPickupListMarkdown(runId, items = []) {
  return `# Pickup List

- Run: ${runId}
- Tool: package-runs dashboard pickup plan
- Approval boundary: proposed or accepted pickup items do not approve rough cut or mark second cut ready.
- External APIs called: no

| item title | type | required | source | purpose | status | notes |
| --- | --- | --- | --- | --- | --- | --- |
${items.map((item) => `| ${item.title} | ${item.type} | ${item.required} | ${item.source} | ${item.purpose} | ${item.status} | ${markdownCell(item.notes)} |`).join('\n')}
`;
}

function buildEditFixListMarkdown(runId, items = []) {
  const editItems = items.filter((item) => item.type === 'edit-only fix' || item.source === 'editing only');
  return `# Edit Fix List

- Run: ${runId}
- Tool: package-runs dashboard pickup plan
- Approval boundary: edit fixes do not approve rough cut or mark second cut ready.
- External APIs called: no

| item title | problem | fix/source | purpose | status | notes |
| --- | --- | --- | --- | --- | --- |
${(editItems.length ? editItems : items).map((item) => `| ${item.title} | ${item.type} | ${item.source} | ${item.purpose} | ${item.status} | ${markdownCell(item.notes)} |`).join('\n')}
`;
}

function savePickupPlan(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const items = normalizePickupItems(payload.items || []);
  const pickupPath = path.resolve(resolved.runDir, 'pickup-list.md');
  const fixPath = path.resolve(resolved.runDir, 'edit-fix-list.md');
  [pickupPath, fixPath].forEach((targetPath) => {
    if (!targetPath.startsWith(resolved.runDir + path.sep)) {
      const error = new Error('Resolved pickup plan path is outside the approved write scope.');
      error.statusCode = 400;
      throw error;
    }
  });
  fs.writeFileSync(pickupPath, buildPickupListMarkdown(resolved.runId, items), 'utf8');
  fs.writeFileSync(fixPath, buildEditFixListMarkdown(resolved.runId, items), 'utf8');
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written: ['pickup-list.md', 'edit-fix-list.md'],
    approvedForSecondCut: false,
    warning: 'Pickup plan saved. Rough cut is not approved and second-cut readiness is not changed.',
  };
}

function cockpitStatusFromGps(status = '') {
  const text = String(status || '').toLowerCase();
  if (/done|pass/.test(text)) return 'completed';
  if (/current/.test(text)) return 'current';
  if (/blocked|needs human|needs artifact|needs work/.test(text)) return 'blocked';
  if (/not reached|locked/.test(text)) return 'future';
  return text || 'future';
}

function buildProductionTimelineCockpit(payload = {}, options = {}, productionGps = null) {
  const resolved = resolveRunFromPayload(payload, options);
  const gps = productionGps || buildProductionGps(payload, options);
  const safeAction = nextSafeActionScript.buildNextSafeAction(resolved.runId, { repoRoot: resolved.root });
  const facts = safeAction.facts || {};
  const lifecycle = (gps.gateTimeline || []).map((gate) => ({
    label: gate.label,
    status: cockpitStatusFromGps(gate.status),
    detail: gate.reason || gate.detail || '',
    artifactPath: gate.artifactPath || '',
    current: Boolean(gate.current) || /current/i.test(gate.status || ''),
  }));
  const firstFutureIndex = lifecycle.findIndex((gate) => gate.status === 'future');
  if (firstFutureIndex >= 0 && !lifecycle.some((gate) => gate.status === 'next')) {
    lifecycle[firstFutureIndex].status = 'next';
  }
  if (!lifecycle.some((gate) => gate.current || gate.status === 'current')) {
    const currentIndex = lifecycle.findIndex((gate) => gate.status === 'blocked') >= 0
      ? lifecycle.findIndex((gate) => gate.status === 'blocked')
      : lifecycle.findIndex((gate) => gate.status === 'next');
    if (currentIndex >= 0) {
      lifecycle[currentIndex].current = true;
      lifecycle[currentIndex].status = 'current';
    }
  }
  let currentWork = {
    status: gps.summary ? gps.summary.gateStatus || 'read-only' : 'read-only',
    latestCompleted: 'No completed work reported by the current production timeline.',
    activeStage: gps.summary ? gps.summary.currentGate || safeAction.stage || 'Current production gate' : safeAction.stage || 'Current production gate',
    activeTask: gps.summary ? gps.summary.nextSafeAction || safeAction.nextHumanAction || 'Record evidence only.' : safeAction.nextHumanAction || 'Record evidence only.',
    blocker: gps.summary ? gps.summary.requiredHumanDecision || safeAction.blockedUntil || 'No blocker reported.' : safeAction.blockedUntil || 'No blocker reported.',
    immediateNextAction: safeAction.nextHumanAction || (gps.summary ? gps.summary.nextSafeAction : '') || 'Record verified evidence without changing approval state.',
    nextSteps: [
      safeAction.nextHumanAction || (gps.summary ? gps.summary.nextSafeAction : '') || 'Record the next verified evidence item.',
      'Record evidence only; keep approval and readiness as separate gates.',
    ],
  };
  if (facts.selectedStillCount > 0 && !facts.klingVideoCount) {
    currentWork = {
      status: 'blocked',
      latestCompleted: 'Selected prompt-03 stills exist; no assets are approved or production_ready.',
      activeStage: 'Manual Kling b-roll candidate creation',
      activeTask: 'Create Kling MP4 candidates from selected prompt-03 stills.',
      blocker: 'Kling MP4 candidates are missing on VIDNAS and Resolve timeline test evidence is not recorded.',
      immediateNextAction: 'Mikko manually creates Kling MP4 candidates, moves them to VIDNAS, and tests them in Resolve.',
      nextSteps: [
        'Create Kling candidates manually from selected prompt-03 stills.',
        'Move selected MP4 candidates to the approved VIDNAS folder.',
        'Import candidates to Resolve and record timeline test evidence.',
        'Keep approval, selected, production_ready, and publish_ready markers unchanged.',
      ],
    };
  } else if (facts.klingVideoCount > 0 && !facts.resolveTestRecorded) {
    currentWork = {
      status: 'needs resolve test',
      latestCompleted: 'Kling MP4 candidates exist on VIDNAS; they are still evidence only.',
      activeStage: 'Resolve timeline test',
      activeTask: 'Import Kling MP4 candidates into Resolve and test whether motion works in the timeline.',
      blocker: 'Resolve timeline test evidence has not been recorded.',
      immediateNextAction: 'Mikko records Resolve timeline test results before any readiness decision.',
      nextSteps: [
        'Import Kling MP4 candidates into Resolve.',
        'Test each candidate in the timeline.',
        'Record usable, maybe, or rejected evidence in Evidence Intake.',
        'Keep approval, production_ready, and publish_ready markers unchanged.',
      ],
    };
  }
  return {
    ok: true,
    readOnly: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    currentWork,
    lifecycle,
    blockedActions: [...new Set([
      ...(gps.blockedActions || []),
      ...(safeAction.forbiddenActions || []),
      'mark capture accepted',
      'mark selected',
      'mark approved',
      'mark production_ready',
      'mark publish_ready',
      'operate Kling automatically',
      'operate Resolve automatically',
      'move media automatically',
      'write package-run state',
      'write manifests',
    ])],
    source: {
      roughCutStatusApi: ROUGH_CUT_STATUS_API,
      nextSafeAction: safeAction.stage || '',
      productionGps: gps.summary ? gps.summary.currentGate || '' : '',
    },
    externalApisCalled: false,
  };
}

function buildRoughCutStatus(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const runInput = `${PACKAGE_RUNS_DIR}/${resolved.runId}`;
  const doctor = packageRunDoctor.buildDoctorReport(runInput, { repoRoot: resolved.root });
  const roughCutCandidate = detectRoughCutCandidate(resolved.runDir);
  const roughCutResult = parseRoughCutReviewFile(resolved.runDir);
  const indexStatus = dashboardIndexStatus(resolved);
  const productionGps = buildProductionGps(payload, options);
  const secondCutInspector = buildSecondCutInspector(payload, options);
  const secondCutCandidatePreflight = buildSecondCutCandidatePreflight(payload, options);
  const finalReviewConsole = buildFinalReviewConsole(payload, options);
  const exportDeliveryConsole = buildExportDeliveryConsole(payload, options);
  const secondCutNextActionPacket = buildSecondCutNextActionPacket(payload, options);
  const staleDerivedArtifacts = roughCutResult.derivedArtifactStale ? ['rough-cut-review.md'] : [];
  const exactNextSafeAction =
    doctor.nextSafeAction ||
    doctor.nextRecommendedCommand ||
    doctor.firstBlockerReason ||
    (doctor.blockingReasons || []).join(' ') ||
    'Review the current lifecycle gate before downstream work.';
  return {
    ok: true,
    runId: resolved.runId,
    runPath: runInput,
    title: doctor.title || '',
    currentInferredStage: doctor.currentInferredStage || doctor.lifecycleStatus || '',
    lifecycleStatus: doctor.lifecycleStatus || '',
    overallStatus: doctor.overallStatus || '',
    firstBlockerReason: doctor.firstBlockerReason || (doctor.blockingReasons || []).join(' '),
    nextRecommendedCommand: doctor.nextRecommendedCommand || '',
    exactNextSafeAction,
    missingExpectedArtifacts: doctor.missingExpectedArtifacts || [],
    roughCutCandidate,
    roughCutResult,
    staleDerivedArtifacts,
    staleDerivedArtifactWarning: roughCutResult.derivedArtifactStale ? {
      stale: true,
      title: 'Derived rough-cut review artifact may be stale',
      currentWatchNotes: `Current watch notes say ${roughCutResult.currentWatchNotesMarker || roughCutResult.approvalMarker || 'NOT GIVEN'}`,
      action: 'Regenerate rough-cut review artifacts',
      reason: roughCutResult.staleReason,
      writeScope: ROUGH_CUT_DERIVED_FILES,
      boundary: 'Regeneration overwrites derived rough-cut artifacts only. It does not approve rough cut, mark second-cut ready, or edit rough-cut-watch-notes.md.',
    } : { stale: false },
    gateTimeline: buildGateTimeline(doctor, roughCutResult),
    productionTimelineCockpit: buildProductionTimelineCockpit(payload, options, productionGps),
    productionGps,
    secondCutNextActionPacket,
    secondCutInspector,
    secondCutCandidatePreflight,
    finalReviewConsole,
    exportDeliveryConsole,
    mediaRows: collectMediaRows(resolved, roughCutCandidate),
    dashboardIndex: indexStatus,
    activeRunSummary: {
      runId: resolved.runId,
      runPath: runInput,
      title: doctor.title || '',
      currentLifecycleStage: doctor.currentInferredStage || doctor.lifecycleStatus || '',
      overallStatus: doctor.overallStatus || '',
      currentBlocker: doctor.firstBlockerReason || (doctor.blockingReasons || []).join(' '),
      exactNextSafeAction,
      packageRunState: doctor.packageRunState || readPackageRunState(resolved.runDir),
      dashboardIndexUpdated: indexStatus.updatedForActiveRun,
      dashboardIndexReason: indexStatus.reason,
    },
    lifecycleGate: doctor.lifecycleGate || {},
    readOnly: true,
    externalApisCalled: false,
  };
}

function saveRoughCutWatchNotes(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const fields = normalizeRoughCutFields(payload.fields || payload);
  const missing = missingRequiredRoughCutFields(fields);
  if (missing.length) {
    const error = new Error(`Missing required rough-cut fields: ${missing.join(', ')}.`);
    error.statusCode = 400;
    error.missing = missing;
    throw error;
  }
  const targetPath = path.resolve(resolved.runDir, ROUGH_CUT_WATCH_NOTES_FILE);
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved rough-cut notes path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const content = buildRoughCutWatchNotesMarkdown(resolved.runId, fields);
  fs.writeFileSync(targetPath, content, 'utf8');
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written: [ROUGH_CUT_WATCH_NOTES_FILE],
    approvedForSecondCut: fields.roughCutApprovalMarker === 'PASS',
    warning: fields.roughCutApprovalMarker === 'PASS'
      ? 'PASS marker was written from Mikko input. Run rough-cut review before downstream work.'
      : 'Watch notes saved. Rough cut is not approved because PASS was not selected.',
  };
}

function runRoughCutReview(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const repoRoot = resolved.root;
  const runPath = `${PACKAGE_RUNS_DIR}/${resolved.runId}`;
  const result = childProcess.spawnSync(process.execPath, ['scripts/package-run-rough-cut-review.js', runPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  return {
    ok: result.status === 0,
    runId: resolved.runId,
    runPath,
    command: `node scripts/package-run-rough-cut-review.js ${runPath}`,
    exitCode: result.status,
    stdout,
    stderr,
    review: parseRoughCutReviewStdout(stdout),
    warning: 'Review script may write rough-cut-review.md, pickup-list.md, and edit-fix-list.md. It does not update package-runs-index.json.',
  };
}

function readPackageRunsIndex(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const indexPath = path.join(root, 'package-runs-index.json');
  if (!fs.existsSync(indexPath)) {
    const error = new Error('package-runs-index.json does not exist.');
    error.statusCode = 404;
    throw error;
  }
  return readJsonFile(indexPath);
}

/**
 * Discover package candidates from all valid package-run directories.
 *
 * Read-only: scans package-runs/, reads package-candidates.json + package-run-state.md
 * + selected-package.json from each run. Does NOT write anything.
 *
 * Exclusions by default:
 *   - stale-runs/ subdirectory
 *   - Runs whose state is parked, abandoned, or superseded
 *
 * Returns:
 *   { runs: [{ runId, state, hasSelectedPackage, candidateCount, candidates, project, topic, generatedAt }], totalCandidates, activeRunId }
 */
function discoverPackageRunCandidates(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const runsRoot = path.resolve(root, PACKAGE_RUNS_DIR);
  const includeParked = Boolean(options.includeParked);
  const includeAbandoned = Boolean(options.includeAbandoned);
  const includeSuperseded = Boolean(options.includeSuperseded);

  if (!fs.existsSync(runsRoot)) {
    return { runs: [], totalCandidates: 0, activeRunId: '' };
  }

  const dirEntries = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'stale-runs' && name !== '.git')
    .filter((name) => /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(name))
    .sort();

  const runs = [];
  let activeRunId = '';

  for (const runId of dirEntries) {
    const runDir = path.join(runsRoot, runId);

    // Read run state
    const stateInfo = readPackageRunState(runDir);
    const state = stateInfo.state || 'active';

    // Skip parked/abandoned/superseded unless explicitly included
    if (state === 'parked' && !includeParked) continue;
    if (state === 'abandoned' && !includeAbandoned) continue;
    if (state === 'superseded' && !includeSuperseded) continue;

    // Also check for "Run disposition: abandoned" in the state file body
    const stateFilePath = path.join(runDir, 'package-run-state.md');
    let rawStateText = '';
    if (fs.existsSync(stateFilePath)) {
      rawStateText = fs.readFileSync(stateFilePath, 'utf8');
    }
    const dispositionMatch = rawStateText.match(/Run disposition:\s*([A-Za-z]+)/i);
    if (dispositionMatch) {
      const disposition = dispositionMatch[1].trim().toLowerCase();
      if (disposition === 'abandoned' && !includeAbandoned) continue;
      if (disposition === 'superseded' && !includeSuperseded) continue;
    }

    // Read package-candidates.json
    const candidatesPath = path.join(runDir, 'package-candidates.json');
    if (!fs.existsSync(candidatesPath)) continue;

    let candidatesData;
    try {
      candidatesData = readJsonFile(candidatesPath);
    } catch (_) {
      // Malformed JSON — skip this run's candidates but don't crash
      runs.push({
        runId,
        state,
        hasSelectedPackage: fs.existsSync(path.join(runDir, 'selected-package.json')),
        candidateCount: 0,
        candidates: [],
        project: '',
        topic: '',
        generatedAt: '',
        malformed: true,
      });
      continue;
    }

    const candidates = Array.isArray(candidatesData.candidates) ? candidatesData.candidates : [];

    // Tag each candidate with its source run id for client-side filtering
    for (const c of candidates) {
      if (c && typeof c === "object" && !c._runId) c._runId = runId;
    }

    // Check for selected-package.json (read-only — just check existence)
    const hasSelectedPackage = fs.existsSync(path.join(runDir, 'selected-package.json'));

    // Track active run
    if (stateInfo.explicit && state === 'active' && !activeRunId) {
      activeRunId = runId;
    }

    runs.push({
      runId,
      state,
      hasSelectedPackage,
      candidateCount: candidates.length,
      candidates,
      project: candidatesData.project || '',
      topic: candidatesData.topic || '',
      generatedAt: candidatesData.generatedAt || '',
    });
  }

  const totalCandidates = runs.reduce((sum, run) => sum + run.candidateCount, 0);

  return { runs, totalCandidates, activeRunId };
}

function packageCandidatesPathForRun(runId, options = {}) {
  const resolved = resolvePackageRunDir(runId, options);
  return {
    ...resolved,
    candidatesPath: path.join(resolved.runDir, 'package-candidates.json'),
  };
}

function readPackageCandidatesForEdit(runId, options = {}) {
  const resolved = packageCandidatesPathForRun(runId, options);
  if (!fs.existsSync(resolved.candidatesPath)) {
    const error = new Error('package-candidates.json does not exist for this run.');
    error.statusCode = 404;
    throw error;
  }
  const data = readJsonFile(resolved.candidatesPath);
  if (!Array.isArray(data.candidates)) {
    const error = new Error('package-candidates.json must contain a candidates array.');
    error.statusCode = 400;
    throw error;
  }
  return { ...resolved, data };
}

function writePackageCandidatesForEdit(candidatesPath, data) {
  const validation = packageEngineModel.validatePackageCandidateSet(data);
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    throw error;
  }
  const next = {
    ...data,
    candidates: validation.data.candidates,
  };
  if (Array.isArray(data.removedCandidates)) {
    next.removedCandidates = data.removedCandidates;
  }
  const tmpPath = `${candidatesPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, candidatesPath);
  return next;
}

function updatePackageRunCandidate(payload = {}, options = {}) {
  const runId = validatePackageRunId(payload.runId);
  const candidateId = String(payload.candidateId || '').trim();
  if (!candidateId) {
    const error = new Error('candidateId is required.');
    error.statusCode = 400;
    throw error;
  }
  const fields = payload.fields && typeof payload.fields === 'object' ? payload.fields : null;
  if (!fields) {
    const error = new Error('fields object is required.');
    error.statusCode = 400;
    throw error;
  }
  const { candidatesPath, data } = readPackageCandidatesForEdit(runId, options);
  const index = data.candidates.findIndex((candidate) => candidate && String(candidate.id || '') === candidateId);
  if (index < 0) {
    const error = new Error('Candidate not found.');
    error.statusCode = 404;
    throw error;
  }
  const updatedCandidate = packageEngineModel.mergeCandidateEdits(data.candidates[index], fields);
  data.candidates[index] = updatedCandidate;
  writePackageCandidatesForEdit(candidatesPath, data);
  return { runId, candidate: updatedCandidate };
}

function softDeletePackageRunCandidate(payload = {}, options = {}) {
  const runId = validatePackageRunId(payload.runId);
  const candidateId = String(payload.candidateId || '').trim();
  if (!candidateId) {
    const error = new Error('candidateId is required.');
    error.statusCode = 400;
    throw error;
  }
  const { candidatesPath, data } = readPackageCandidatesForEdit(runId, options);
  const index = data.candidates.findIndex((candidate) => candidate && String(candidate.id || '') === candidateId);
  if (index < 0) {
    const error = new Error('Candidate not found.');
    error.statusCode = 404;
    throw error;
  }
  const [removed] = data.candidates.splice(index, 1);
  data.removedCandidates = Array.isArray(data.removedCandidates) ? data.removedCandidates : [];
  data.removedCandidates.push({
    removedAt: new Date().toISOString(),
    candidate: removed,
  });
  writePackageCandidatesForEdit(candidatesPath, data);
  return { runId, candidateId, removedCandidate: removed, removedCount: data.removedCandidates.length };
}

// Save pasted outline text into a run's final-outline.md.
// Read/write is confined to the resolved run directory and gated on a valid
// local write nonce by the route handler. The target filename is fixed —
// callers cannot choose an arbitrary path.
function saveFinalOutline(payload = {}, options = {}) {
  const runId = validatePackageRunId(payload.runId);
  const content = typeof payload.content === 'string' ? payload.content : '';
  if (!content.trim()) {
    const error = new Error('content is required.');
    error.statusCode = 400;
    throw error;
  }
  const resolved = resolvePackageRunDir(runId, options);
  const outlinePath = path.join(resolved.runDir, 'final-outline.md');
  const text = content.endsWith('\n') ? content : `${content}\n`;
  const tmpPath = `${outlinePath}.tmp`;
  fs.writeFileSync(tmpPath, text, 'utf8');
  fs.renameSync(tmpPath, outlinePath);
  return {
    runId,
    path: `package-runs/${runId}/final-outline.md`,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

// Read/write the "Workflow path:" marker (vertical|horizontal) in a run's
// package-run-state.md. Confined to the resolved run dir; gated on a nonce by
// the route. Unset resolves to horizontal so long-form runs are unaffected.
function readWorkflowPathForRun(runId, options = {}) {
  const resolved = resolvePackageRunDir(runId, options);
  const statePath = path.join(resolved.runDir, 'package-run-state.md');
  const text = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
  return { ...resolved, statePath, workflowPath: workflowPathModel.readWorkflowPathFromState(text), raw: text };
}

function setWorkflowPathForRun(payload = {}, options = {}) {
  const runId = validatePackageRunId(payload.runId);
  const desired = workflowPathModel.normalizeWorkflowPath(payload.path);
  const { statePath, raw } = readWorkflowPathForRun(runId, options);
  const marker = workflowPathModel.WORKFLOW_PATH_MARKER;
  const line = `${marker}: ${desired}`;
  let next;
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${marker}\\s*:.*$`, 'im');
  if (!raw) {
    next = `# Package Run State\n\n${line}\n`;
  } else if (pattern.test(raw)) {
    next = raw.replace(pattern, line);
  } else {
    // insert after the first heading/line block
    next = raw.endsWith('\n') ? `${raw}\n${line}\n` : `${raw}\n\n${line}\n`;
  }
  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, next, 'utf8');
  fs.renameSync(tmpPath, statePath);
  const info = workflowPathModel.workflowPathInfo(desired);
  return { runId, workflowPath: desired, orientation: info.orientation, resolution: info.resolution };
}

// The five beginning-triage worksheet fields the Generate button fills.
const BEGINNING_TRIAGE_GENERATE_FIELDS = [
  'topicArea',
  'audienceGuess',
  'topicWhyNow',
  'mikkoSuspects',
  'possibleProof',
];

function buildBeginningTriageSystemPrompt() {
  return [
    'You are an ideation assistant for VIDTOOLZ, a YouTube channel about practical video creation in the AI era.',
    'Audience: serious solo creators adapting to AI.',
    'Tone: practical teacher with critical tester instincts — useful fast, no hype, test assumptions, judge AI/video tools by real production usefulness.',
    'Avoid generic AI hype, "make money with AI" framing, and shallow reaction content.',
    'You help fill an early idea-triage worksheet. Be concrete and grounded. Keep each field to 1-3 sentences.',
    'Return only the requested JSON object.',
  ].join('\n');
}

function buildBeginningTriageUserPrompt(fields = {}) {
  const get = (key) => String(fields[key] || '').trim();
  const lines = [
    `Topic area / problem space (seed from the creator): ${get('topicArea')}`,
    '',
    'Anything the creator has already written (may be blank):',
    `- Audience guess: ${get('audienceGuess') || '(blank)'}`,
    `- Why this topic matters now: ${get('topicWhyNow') || '(blank)'}`,
    `- What Mikko already suspects: ${get('mikkoSuspects') || '(blank)'}`,
    `- What kind of proof might exist: ${get('possibleProof') || '(blank)'}`,
    '',
    'Fill in all five worksheet fields as JSON. Build on what the creator already wrote, and keep the topic area faithful to their seed. Fields:',
    '- topicArea: a sharpened one-line topic area / problem space',
    '- audienceGuess: who specifically might care, before the angle is known',
    '- topicWhyNow: why this matters now in the AI-era creator landscape',
    '- mikkoSuspects: a plausible hunch the creator likely already holds about this topic',
    '- possibleProof: concrete kinds of evidence or on-screen demos that could prove the eventual claim',
  ];
  return lines.join('\n');
}

// Call the local Ollama chat API. Returns the raw assistant message content (a
// JSON string when `schema` is supplied). options.fetchImpl is injectable for tests.
async function callOllamaChat({ system, user, schema, model, baseUrl } = {}, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  // baseUrl selects the host lane (default vidnux Ollama). I2V prompts pass the
  // PRESTO Ollama base; on failure we surface a blocked state and do NOT retry
  // against another host.
  const resolvedBase = String(baseUrl || OLLAMA_BASE_URL).replace(/\/+$/, '');
  const url = `${resolvedBase}/api/chat`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || OLLAMA_MODEL,
        messages: [
          { role: 'system', content: system || '' },
          { role: 'user', content: user || '' },
        ],
        stream: false,
        think: false,
        ...(schema ? { format: schema } : {}),
        options: { temperature: 0.6 },
      }),
      // Per-call timeout: callers (e.g. chunked generation) pass a task-specific
      // timeoutMs so a big job is split into bounded chunks, not one 120s attempt.
      signal: options.signal || AbortSignal.timeout(Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : OLLAMA_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    const detail = String((error && (error.message || (error.cause && error.cause.code))) || '');
    const refused = /ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET/i.test(detail);
    const secs = Math.ceil((Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : OLLAMA_TIMEOUT_MS) / 1000);
    const message = timedOut
      ? `Ollama generation timed out after ${secs}s.`
      : refused
      ? `Could not reach Ollama at ${resolvedBase}. Is it running on that host? Start it with: ollama serve (no fallback to another host).`
      : `Ollama request failed: ${detail || 'unknown network error'}`;
    const wrapped = new Error(message);
    wrapped.statusCode = timedOut ? 504 : 503;
    throw wrapped;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const wrapped = new Error(data && data.error ? `Ollama error: ${data.error}` : `Ollama returned ${response.status}.`);
    wrapped.statusCode = 502;
    throw wrapped;
  }
  return data && data.message && typeof data.message.content === 'string' ? data.message.content : '';
}

// I2V prompts are routed to local Ollama on PRESTO ONLY (media-routing policy).
// This thin wrapper pins the PRESTO base/model and never falls back to vidnux or
// a cloud LLM; a connection failure surfaces as the lane's 503 blocked state.
async function callPrestoOllamaChat({ system, user, schema, model } = {}, options = {}) {
  mediaRouting.assertLocalLane(mediaRouting.LANE.I2V_PROMPT);
  const baseUrl = mediaRouting.resolveEndpoint(mediaRouting.LANE.I2V_PROMPT);
  const useModel = model || OLLAMA_PRESTO_MODEL;
  try {
    return await callOllamaChat({ system, user, schema, model: useModel, baseUrl }, options);
  } catch (error) {
    // Re-frame connection refusals as the canonical PRESTO-lane blocked state.
    if (error && (error.statusCode === 503)) {
      throw mediaRouting.blockedError(mediaRouting.LANE.I2V_PROMPT, `Could not reach Ollama at ${baseUrl}.`);
    }
    throw error;
  }
}

// ── Super Focus load-aware Ollama routing ───────────────────────────────────
// Avoid sending text generation to vidnux Ollama while vidnux ComfyUI is busy
// with images; route to PRESTO Ollama when it is configured, healthy, and PRESTO
// itself is not busy with video. Pure decision lives in super-focus-router.js.

function superFocusProviderConfig(options = {}) {
  const prestoBase = String(
    options.prestoOllamaBaseUrl != null ? options.prestoOllamaBaseUrl
      : (process.env.PRESTO_OLLAMA_BASE_URL || OLLAMA_PRESTO_BASE_URL || '')
  ).replace(/\/+$/, '');
  const prestoModel = String(process.env.PRESTO_OLLAMA_MODEL || OLLAMA_PRESTO_MODEL || OLLAMA_MODEL);
  return {
    mode: superFocusRouter.resolveRoutingMode(options.superFocusRoutingMode || process.env.SUPER_FOCUS_OLLAMA_ROUTING),
    local: { base_url: OLLAMA_BASE_URL, model: OLLAMA_MODEL },
    presto: { configured: Boolean(prestoBase), base_url: prestoBase, model: prestoModel },
  };
}

// Read-only health probe: is the Ollama at baseUrl reachable, and is `model`
// installed? Uses GET /api/tags with a short timeout. Injectable for tests.
async function probeOllamaTags(baseUrl, model, options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!fetchImpl || !base) return { reachable: false, model_ready: false, models: [] };
  try {
    const res = await fetchImpl(`${base}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(4000) });
    if (!res || !res.ok) return { reachable: false, model_ready: false, models: [] };
    const data = await res.json().catch(() => ({}));
    const names = Array.isArray(data && data.models) ? data.models.map((m) => String((m && m.name) || '')).filter(Boolean) : [];
    const want = String(model || '').trim();
    // A model configured WITH a tag must match that exact tag: "qwen3:8b"
    // installed must NOT report "qwen3:14b" as ready (generation would then
    // fail as an opaque 502 instead of the router's clean model_missing).
    // A tagless configured name still accepts any installed tag of that base.
    const ready = want
      ? names.some((n) => n === want || (!want.includes(':') && n.split(':')[0] === want))
      : names.length > 0;
    return { reachable: true, model_ready: ready, models: names };
  } catch (_) {
    return { reachable: false, model_ready: false, models: [] };
  }
}

// Gather live signals + run the pure router. Read-only. Probes PRESTO Ollama
// only when it might actually be used (auto+local-busy, or forced presto).
async function resolveSuperFocusOllamaProvider(task, options = {}) {
  const cfg = superFocusProviderConfig(options);
  const localBusy = options.superFocusLocalBusy != null
    ? Boolean(options.superFocusLocalBusy)
    : Boolean(currentFluxJobStatus().active);
  const presto = Object.assign({ reachable: false, model_ready: false, comfyui_busy: false, comfyui_known: true }, cfg.presto);
  const mightUsePresto = cfg.mode === 'presto' || (cfg.mode === 'auto' && localBusy);
  if (cfg.presto.configured && mightUsePresto) {
    const probe = options.prestoOllamaProbe || probeOllamaTags;
    const health = await probe(cfg.presto.base_url, cfg.presto.model, options);
    presto.reachable = Boolean(health && health.reachable);
    presto.model_ready = Boolean(health && health.model_ready);
    presto.comfyui_busy = options.superFocusPrestoBusy != null
      ? Boolean(options.superFocusPrestoBusy)
      : Boolean(currentPrestoJobStatus().active);
    presto.comfyui_known = true; // our video lock is authoritative for our own jobs
  }
  const decision = superFocusRouter.selectOllamaProvider({ mode: cfg.mode, local: cfg.local, presto, localBusy });
  decision.mode = cfg.mode;
  decision.task = task || null;
  decision.local_busy = localBusy;
  return decision;
}

function publicProvider(decision) {
  return {
    id: decision.provider_id,
    label: decision.label,
    model: decision.model,
    reason: decision.reason,
    warnings: decision.warnings || [],
  };
}

// Route + run one Super Focus text generation. Returns { content, provider }.
// On failure the error message is enriched with provider/model/timeout/task/
// count/routing context and carries error.provider.
// Task-specific Super Focus Ollama timeout (PER CHUNK / per request), not a
// single budget for a whole multi-prompt job. Env overrides, default 120s.
function superFocusOllamaTimeoutMs(task, options = {}) {
  if (Number(options.superFocusOllamaTimeoutMs) > 0) return Number(options.superFocusOllamaTimeoutMs);
  if (/infographic/i.test(String(task || '')) && Number(process.env.SUPER_FOCUS_INFOGRAPHIC_TIMEOUT_MS) > 0) {
    return Number(process.env.SUPER_FOCUS_INFOGRAPHIC_TIMEOUT_MS);
  }
  if (Number(process.env.SUPER_FOCUS_OLLAMA_TIMEOUT_MS) > 0) return Number(process.env.SUPER_FOCUS_OLLAMA_TIMEOUT_MS);
  return OLLAMA_TIMEOUT_MS;
}

// Chunk size for multi-prompt Super Focus generation. Default 3, clamped 1–6.
function superFocusChunkSize(options = {}) {
  const raw = options.superFocusChunkSize != null ? options.superFocusChunkSize : process.env.SUPER_FOCUS_OLLAMA_CHUNK_SIZE;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(6, Math.max(1, n));
}

// Enrich an Ollama error with provider/model/timeout/task/count/routing context
// plus preserve-safe, actionable advice (never a blunt "use a smaller model").
function enrichOllamaError(error, decision, task, requestedCount, timeoutMs) {
  const secs = Math.ceil((Number(timeoutMs) > 0 ? Number(timeoutMs) : OLLAMA_TIMEOUT_MS) / 1000);
  const ctx = [
    `provider ${decision.label}`,
    `model ${decision.model}`,
    `timeout ${secs}s`,
    `task ${task || 'generation'}`,
    requestedCount ? `requested ${requestedCount}` : null,
    decision.reason ? `routing: ${decision.reason}` : null,
  ].filter(Boolean).join(' · ');
  const timedOut = error && error.statusCode === 504;
  const advice = timedOut
    ? ' Existing prompts were preserved. Run Test Ollama model, reduce chunk size, raise the per-chunk timeout, or route to PRESTO Ollama if available.'
    : '';
  error.message = `${error.message} [${ctx}]${advice}`;
  error.provider = publicProvider(decision);
  return error;
}

async function superFocusGenerate({ system, user, schema, task, requestedCount } = {}, options = {}) {
  const decision = await resolveSuperFocusOllamaProvider(task, options);
  if (decision.error) {
    const e = new Error(decision.message || `No usable Ollama provider (${decision.error}).`);
    e.statusCode = decision.error === 'not_configured' ? 400 : 503;
    e.provider = { error: decision.error };
    throw e;
  }
  const timeoutMs = superFocusOllamaTimeoutMs(task, options);
  try {
    const content = await callOllamaChat(
      { system, user, schema, model: decision.model, baseUrl: decision.base_url },
      Object.assign({}, options, { timeoutMs })
    );
    return { content, provider: publicProvider(decision) };
  } catch (error) {
    throw enrichOllamaError(error, decision, task, requestedCount, timeoutMs);
  }
}

// Read-only provider status for the "Check providers" panel. All probes are
// short-timeout GETs; no service is started/stopped. Injectable for tests.
async function superFocusProviderStatus(options = {}) {
  const cfg = superFocusProviderConfig(options);
  const tagsProbe = options.prestoOllamaProbe || probeOllamaTags;
  const localTagsProbe = options.localOllamaProbe || probeOllamaTags;
  const comfyReach = options.comfyuiReachableCheck || prestoComfyuiReachable;

  const localBusy = options.superFocusLocalBusy != null
    ? Boolean(options.superFocusLocalBusy) : Boolean(currentFluxJobStatus().active);
  const prestoBusy = options.superFocusPrestoBusy != null
    ? Boolean(options.superFocusPrestoBusy) : Boolean(currentPrestoJobStatus().active);

  const localOllama = await localTagsProbe(cfg.local.base_url, cfg.local.model, options);
  const localOllamaStatus = !localOllama.reachable ? 'offline'
    : !localOllama.model_ready ? 'model_missing' : 'ok';

  const vidnuxComfyReachable = await comfyReach(LOCAL_IMAGE_PROVIDER.url, options);
  const vidnuxComfyStatus = localBusy ? 'busy' : (vidnuxComfyReachable ? 'ok' : 'offline');

  let prestoOllama = { reachable: false, model_ready: false, models: [] };
  let prestoOllamaStatus = 'not_configured';
  if (cfg.presto.configured) {
    prestoOllama = await tagsProbe(cfg.presto.base_url, cfg.presto.model, options);
    prestoOllamaStatus = !prestoOllama.reachable ? 'offline'
      : !prestoOllama.model_ready ? 'model_missing' : 'ok';
  }

  const imgCfg = superFocusImageProviderConfig(options);
  const prestoComfyReachable = PRESTO_BASE_URL ? await comfyReach(PRESTO_BASE_URL, options) : false;
  let prestoComfyStatus = 'not_configured';
  if (PRESTO_BASE_URL) {
    if (prestoBusy) prestoComfyStatus = 'busy';
    else prestoComfyStatus = prestoComfyReachable ? 'ok' : 'offline';
  }

  // PRESTO ComfyUI IMAGE capability (separate from its video capability). In
  // this build image dispatch is not yet validated, so it reports its blocker
  // honestly rather than claiming capability.
  const prestoImageReady = superFocusPrestoImageReady(options);
  let prestoImageStatus;
  let prestoImageMessage;
  if (!imgCfg.presto.configured) {
    prestoImageStatus = 'not_configured';
    prestoImageMessage = 'No PRESTO image workflow configured (set PRESTO_COMFYUI_IMAGE_WORKFLOW). Repo routing is ready; PRESTO FLUX workflow + models are not installed/validated.';
  } else if (!prestoComfyReachable) {
    prestoImageStatus = 'offline';
    prestoImageMessage = `PRESTO ComfyUI unreachable at ${imgCfg.presto.base_url}.`;
  } else if (!prestoImageReady) {
    prestoImageStatus = 'workflow_configured_dispatch_pending';
    prestoImageMessage = 'Image workflow configured but dispatch is not enabled/validated (SUPER_FOCUS_PRESTO_IMAGE_READY). Requires run-handoff.py --comfyui-url support (Patch 2).';
  } else {
    prestoImageStatus = 'ok';
    prestoImageMessage = 'PRESTO ComfyUI image fallback available.';
  }

  // Text-to-image dispatch needs BOTH vidnux ComfyUI (HTTP) and the `comfy`
  // CLI on the dispatch PATH. A reachable ComfyUI with a missing CLI is a
  // blocked lane — reported explicitly, never attempted.
  const comfyCli = comfyCliResolvable(options);
  const t2iStatus = !vidnuxComfyReachable ? 'offline'
    : !comfyCli ? 'blocked_cli_missing'
      : (localBusy ? 'busy' : 'ok');
  const t2iBlockingReason = !vidnuxComfyReachable
    ? `vidnux ComfyUI unreachable at ${LOCAL_IMAGE_PROVIDER.url}. Start it with: bash ~/bin/start-vidnux-comfyui.sh`
    : !comfyCli
      ? 'The ComfyUI CLI (`comfy`) is not on the cockpit dispatch PATH — fix the service PATH or set SUPER_FOCUS_COMFY_BIN_DIR.'
      : null;

  return {
    ok: true,
    routing_mode: cfg.mode,
    image_provider_mode: imgCfg.mode,
    // Workload-separated readiness. Ollama is a TEXT engine only — it is never
    // an image-generation substitute; each lane names its host and locality.
    lanes: {
      text_generation: {
        lane: 'text_generation', engine: 'ollama', host: 'vidnux', locality: 'local',
        status: localOllamaStatus,
        blocking_reason: localOllamaStatus === 'ok' ? null
          : (localOllamaStatus === 'offline' ? `vidnux Ollama unreachable at ${cfg.local.base_url}.` : `Model "${cfg.local.model}" is not installed on vidnux Ollama.`),
        note: 'Generates topics, scripts, and prompt TEXT. Never generates images.',
      },
      text_to_image_generation: {
        lane: 'text_to_image_generation', engine: 'comfyui_flux', host: 'vidnux', locality: 'local',
        status: t2iStatus,
        comfy_cli: comfyCli,
        blocking_reason: t2iBlockingReason,
        note: 'FLUX still images via comfy-cli → vidnux ComfyUI. No Ollama fallback exists for images.',
      },
      image_to_video_generation: {
        lane: 'image_to_video_generation', engine: 'comfyui_wan22', host: 'presto', locality: 'remote',
        status: prestoComfyStatus,
        blocking_reason: prestoComfyStatus === 'ok' ? null
          : (prestoComfyStatus === 'not_configured' ? 'PRESTO ComfyUI is not configured.'
            : prestoComfyStatus === 'busy' ? 'PRESTO is busy with a video job.'
              : `PRESTO ComfyUI unreachable at ${PRESTO_BASE_URL}.`),
        note: 'Wan2.2 image-to-video on PRESTO. No fallback.',
      },
    },
    vidnux_ollama: { status: localOllamaStatus, base_url: cfg.local.base_url, model: cfg.local.model, busy_warning: localBusy },
    vidnux_comfyui: { status: vidnuxComfyStatus, image_capable: vidnuxComfyReachable, comfy_cli: comfyCli, video_capable: false, workflow: imgCfg.vidnux.workflow },
    presto_ollama: { status: prestoOllamaStatus, configured: cfg.presto.configured, base_url: cfg.presto.base_url, model: cfg.presto.model },
    presto_comfyui: { status: prestoComfyStatus, video_capable: prestoComfyReachable, workflow: 'wan22_i2v_vertical_1080x1920_30fps' },
    presto_comfyui_image: {
      status: prestoImageStatus,
      configured: imgCfg.presto.configured,
      reachable: prestoComfyReachable,
      workflow: imgCfg.presto.image_workflow || null,
      image_ready: prestoImageReady,
      message: prestoImageMessage,
    },
    restart: {
      vidnux_comfyui: { mode: 'manual', command: 'bash ~/bin/start-vidnux-comfyui.sh', note: 'No wired restart button in this build. Run this locally on vidnux to (re)start ComfyUI.' },
      presto_comfyui: { mode: 'manual', note: 'Remote restart is not configured (media-routing non-goal). Restart ComfyUI on PRESTO manually.' },
    },
  };
}

// Explicit, manual model performance check ("Test Ollama model"). Times a small
// 1-prompt and 3-prompt infographic generation on vidnux Ollama (and PRESTO if
// configured+healthy), and recommends a chunk size that fits the per-chunk
// timeout. Read-only re: project state. Not run on page load. Injectable for tests.
async function superFocusOllamaBenchmark(options = {}) {
  const cfg = superFocusProviderConfig(options);
  const timeoutMs = superFocusOllamaTimeoutMs('infographic_prompts_topup', options);
  const script = 'A short explainer about building a local AI video production pipeline for a solo creator.';
  const benchOne = async (label, model, baseUrl) => {
    const result = { label, model, base_url: baseUrl, ok: false, one_prompt_ms: null, three_prompt_ms: null, one_prompt_count: 0, three_prompt_count: 0, error: null };
    try {
      const r1 = superFocusPrompts.buildInfographicPromptsRequest(script, 1);
      const s1 = Date.now();
      const c1 = await callOllamaChat({ system: r1.system, user: r1.user, schema: r1.schema, model, baseUrl }, Object.assign({}, options, { timeoutMs }));
      result.one_prompt_ms = Date.now() - s1;
      result.one_prompt_count = superFocusPrompts.parsePromptArray(c1, 1).length;
      const r3 = superFocusPrompts.buildInfographicPromptsRequest(script, 3);
      const s3 = Date.now();
      const c3 = await callOllamaChat({ system: r3.system, user: r3.user, schema: r3.schema, model, baseUrl }, Object.assign({}, options, { timeoutMs }));
      result.three_prompt_ms = Date.now() - s3;
      result.three_prompt_count = superFocusPrompts.parsePromptArray(c3, 3).length;
      result.ok = true;
    } catch (error) {
      result.error = error.message;
    }
    return result;
  };

  const vidnux = await benchOne('vidnux Ollama', cfg.local.model, cfg.local.base_url);
  let presto = null;
  if (cfg.presto.configured) {
    const probe = options.prestoOllamaProbe || probeOllamaTags;
    const health = await probe(cfg.presto.base_url, cfg.presto.model, options);
    if (health.reachable && health.model_ready) {
      presto = await benchOne('PRESTO Ollama', cfg.presto.model, cfg.presto.base_url);
    } else {
      presto = { label: 'PRESTO Ollama', model: cfg.presto.model, base_url: cfg.presto.base_url, ok: false, error: health.reachable ? 'model not installed on PRESTO Ollama' : 'PRESTO Ollama unreachable' };
    }
  }

  // Recommend a chunk size that fits ~70% of the per-chunk timeout by the
  // measured single-prompt time (only measurement drives this — never a guess).
  let recommendedChunkSize = superFocusChunkSize(options);
  if (vidnux.ok && vidnux.one_prompt_ms > 0) {
    recommendedChunkSize = Math.max(1, Math.min(6, Math.floor((timeoutMs * 0.7) / vidnux.one_prompt_ms)));
  }
  let faster = null;
  if (vidnux.ok && presto && presto.ok && vidnux.three_prompt_ms != null && presto.three_prompt_ms != null) {
    faster = presto.three_prompt_ms < vidnux.three_prompt_ms ? 'presto' : 'vidnux';
  }
  return {
    ok: true,
    timeout_ms: timeoutMs,
    chunk_size: superFocusChunkSize(options),
    recommended_chunk_size: recommendedChunkSize,
    faster,
    vidnux,
    presto,
  };
}

// ── Super Focus image ComfyUI provider routing (failover on UNREACHABLE) ─────
// vidnux ComfyUI is the image provider. If it is unreachable, image jobs may
// route to PRESTO ComfyUI — but ONLY when PRESTO is configured, reachable, and
// its image workflow is validated/enabled. Default: PRESTO image dispatch is
// NOT enabled (no validated PRESTO FLUX workflow / run-handoff.py has no target
// URL arg yet — see docs), so auto fails clearly rather than mis-routing.

function superFocusImageProviderConfig(options = {}) {
  const prestoBase = String(
    options.prestoComfyuiBaseUrl != null ? options.prestoComfyuiBaseUrl
      : (process.env.PRESTO_COMFYUI_BASE_URL || process.env.AIGEN_PRESTO_BASE_URL || PRESTO_BASE_URL || '')
  ).replace(/\/+$/, '');
  const imageWorkflow = String(
    options.prestoImageWorkflow != null ? options.prestoImageWorkflow : (process.env.PRESTO_COMFYUI_IMAGE_WORKFLOW || '')
  ).trim();
  return {
    mode: superFocusRouter.resolveImageProviderMode(options.superFocusImageProvider || process.env.SUPER_FOCUS_IMAGE_PROVIDER),
    vidnux: { base_url: LOCAL_IMAGE_PROVIDER.url, workflow: 'flux-gguf-1080x1920' },
    presto: { base_url: prestoBase, image_workflow: imageWorkflow, configured: Boolean(prestoBase && imageWorkflow) },
  };
}

// Whether PRESTO image DISPATCH is validated/enabled. Default false in this
// build (repo-side routing is ready; actual dispatch needs a validated PRESTO
// FLUX workflow + run-handoff.py --comfyui-url support). Injectable/env for
// tests and a future Patch 2.
function superFocusPrestoImageReady(options = {}) {
  if (options.superFocusPrestoImageReady != null) return Boolean(options.superFocusPrestoImageReady);
  return /^(1|true|yes|on)$/i.test(String(process.env.SUPER_FOCUS_PRESTO_IMAGE_READY || ''));
}

async function resolveSuperFocusImageProvider(options = {}) {
  const cfg = superFocusImageProviderConfig(options);
  const reach = options.fluxReachableCheck || options.reachableCheck || prestoComfyuiReachable;
  const vidnuxReachable = options.superFocusVidnuxComfyReachable != null
    ? Boolean(options.superFocusVidnuxComfyReachable)
    : await reach(cfg.vidnux.base_url, options);
  const presto = Object.assign({ reachable: false, image_ready: false }, cfg.presto);
  const mightUsePresto = cfg.mode === 'presto' || (cfg.mode === 'auto' && !vidnuxReachable);
  if (mightUsePresto && cfg.presto.configured) {
    presto.reachable = options.superFocusPrestoComfyReachable != null
      ? Boolean(options.superFocusPrestoComfyReachable)
      : await reach(cfg.presto.base_url, options);
    presto.image_ready = superFocusPrestoImageReady(options);
  }
  const decision = superFocusRouter.selectComfyImageProvider({
    mode: cfg.mode,
    vidnux: Object.assign({ reachable: vidnuxReachable }, cfg.vidnux),
    presto,
  });
  decision.mode = cfg.mode;
  return decision;
}

function publicImageProvider(decision) {
  return {
    id: decision.provider_id,
    label: decision.label || null,
    base_url: decision.base_url || null,
    workflow: decision.workflow || null,
    reason: decision.reason,
    warnings: decision.warnings || [],
  };
}

function fluxHandoffScriptPath(options = {}) {
  return options.fluxScript || process.env.SUPER_FOCUS_FLUX_SCRIPT || FLUX_STATE.script;
}

// Does the configured run-handoff.py expose a seed-variation CLI option? A
// read-only source check; fail-CLOSED (false) so we never pass an unknown arg to
// a script whose argparse would then error. Injectable for tests.
function fluxHandoffSupportsSeed(options = {}) {
  if (typeof options.fluxHandoffSeedProbe === 'function') return Boolean(options.fluxHandoffSeedProbe());
  try {
    const src = fs.readFileSync(fluxHandoffScriptPath(options), 'utf8');
    return /--seed\b|--random-seed\b/.test(src);
  } catch (_) { return false; }
}

// A fresh seed per explicit regenerate request (so a rerun actually varies).
function superFocusRegenSeed(options = {}) {
  if (typeof options.superFocusSeedProvider === 'function') {
    const s = Math.abs(Math.round(Number(options.superFocusSeedProvider())));
    return Number.isFinite(s) && s > 0 ? s : 1;
  }
  return crypto.randomInt(1, 2147483647);
}

// Draft the five beginning-triage fields with the local Ollama LLM. Read-only:
// returns generated text; it does not write any file or workflow state.
async function generateBeginningTriageDraft(payload = {}, options = {}) {
  const inputFields = payload && typeof payload.fields === 'object' && payload.fields ? payload.fields : {};
  const topicArea = String(inputFields.topicArea || '').trim();
  if (!topicArea) {
    const error = new Error('A topic area is required before generating. Write one, then Generate.');
    error.statusCode = 400;
    throw error;
  }
  const schema = {
    type: 'object',
    properties: Object.fromEntries(BEGINNING_TRIAGE_GENERATE_FIELDS.map((key) => [key, { type: 'string' }])),
    required: BEGINNING_TRIAGE_GENERATE_FIELDS.slice(),
  };
  const content = await callOllamaChat(
    {
      system: buildBeginningTriageSystemPrompt(),
      user: buildBeginningTriageUserPrompt(inputFields),
      schema,
      model: payload.model,
    },
    options
  );
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_error) {
    const error = new Error('Ollama did not return valid JSON. Try again, or set OLLAMA_MODEL to another installed model.');
    error.statusCode = 502;
    throw error;
  }
  const fields = {};
  for (const key of BEGINNING_TRIAGE_GENERATE_FIELDS) {
    fields[key] = typeof parsed[key] === 'string' ? parsed[key].trim() : '';
  }
  // Never lose the creator's seed if the model blanks the topic area.
  if (!fields.topicArea) fields.topicArea = topicArea;
  return { model: payload.model || OLLAMA_MODEL, fields };
}

// ── Vertical / Shorts workflow: 3-script generation + save ────────────────────

function buildShortsScriptSystemPrompt() {
  return [
    'You write short, punchy YouTube Shorts monologue scripts for VIDTOOLZ (practical video creation in the AI era).',
    'Format: ONE person speaking directly to camera. Not a documentary, no narrator, no scene directions, no B-roll notes — just the spoken words.',
    'Tone: blunt, funny, direct — like explaining the point to a smart friend. No hype, no fluff, no "in this video".',
    'Length: under 3 minutes spoken (roughly 250-400 words). One clear point.',
    'Return only the requested JSON.',
  ].join('\n');
}

function buildShortsScriptUserPrompt(topic) {
  return [
    `Topic: ${topic}`,
    '',
    'Write THREE structurally different monologue scripts for this topic, each a complete spoken script:',
    '1. A blunt hot-take / myth-bust angle.',
    '2. A practical "here is how I actually do it" angle.',
    '3. A story / "I learned this the hard way" angle.',
    '',
    'Each script: a strong first line that hooks in 3 seconds, one concrete point, a clean payoff. Spoken words only.',
  ].join('\n');
}

// Generate 3 short monologue scripts with the local Ollama LLM. Read-only:
// returns text; writes nothing. options.fetchImpl is injectable for tests.
async function generateShortsScripts(payload = {}, options = {}) {
  const topic = String(payload.topic || '').trim();
  if (!topic) {
    const error = new Error('A topic is required to generate scripts.');
    error.statusCode = 400;
    throw error;
  }
  const schema = {
    type: 'object',
    properties: {
      scripts: {
        type: 'array',
        items: {
          type: 'object',
          properties: { angle: { type: 'string' }, script: { type: 'string' } },
          required: ['angle', 'script'],
        },
      },
    },
    required: ['scripts'],
  };
  const content = await callOllamaChat(
    { system: buildShortsScriptSystemPrompt(), user: buildShortsScriptUserPrompt(topic), schema, model: payload.model },
    options
  );
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_error) {
    const error = new Error('Ollama did not return valid JSON. Try again, or set OLLAMA_MODEL to another installed model.');
    error.statusCode = 502;
    throw error;
  }
  const scripts = Array.isArray(parsed.scripts) ? parsed.scripts.slice(0, 3).map((s, i) => ({
    angle: s && typeof s.angle === 'string' && s.angle.trim() ? s.angle.trim() : `Option ${i + 1}`,
    script: s && typeof s.script === 'string' ? s.script.trim() : '',
  })).filter((s) => s.script) : [];
  if (!scripts.length) {
    const error = new Error('Ollama returned no usable scripts. Try again.');
    error.statusCode = 502;
    throw error;
  }
  return { model: payload.model || OLLAMA_MODEL, topic, scripts };
}

// Save the chosen monologue script into a run's final-script.md (atomic, run-confined).
function saveShortsScript(payload = {}, options = {}) {
  const runId = validatePackageRunId(payload.runId);
  const content = typeof payload.content === 'string' ? payload.content : '';
  if (!content.trim()) {
    const error = new Error('content is required.');
    error.statusCode = 400;
    throw error;
  }
  const resolved = resolvePackageRunDir(runId, options);
  const scriptPath = path.join(resolved.runDir, 'final-script.md');
  const text = content.endsWith('\n') ? content : `${content}\n`;
  const tmpPath = `${scriptPath}.tmp`;
  fs.writeFileSync(tmpPath, text, 'utf8');
  fs.renameSync(tmpPath, scriptPath);
  return { runId, path: `package-runs/${runId}/final-script.md`, bytes: Buffer.byteLength(text, 'utf8') };
}

// ── Vertical Script Commitment Check ──────────────────────────────────────────
// One advisory pre-media checkpoint: "is this saved script worth generating media
// for?" Mechanical checks run locally; the six judgment checks use the existing
// local-Ollama path and degrade to "pending" if Ollama is unavailable. Never blocks.

const SCRIPT_COMMITMENT_JUDGMENT_KEYS = [
  { key: 'one_clear_claim', label: 'One clear claim' },
  { key: 'strong_first_line', label: 'Strong first line' },
  { key: 'spoken_natural', label: 'Spoken-to-camera naturalness' },
  { key: 'blunt_tone', label: 'Blunt/funny/direct tone' },
  { key: 'visual_usefulness', label: 'Visual usefulness' },
  { key: 'finishability', label: 'Finishability' },
];

function normalizeCheckStatus(value, fallback) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return ['pass', 'fail', 'warning', 'pending'].includes(v) ? v : (fallback || 'pending');
}

async function scriptCommitmentCheck(payload = {}, options = {}) {
  // Resolve the script: explicit text wins; otherwise read the run's final-script.md.
  let script = typeof payload.script === 'string' ? payload.script.trim() : '';
  let runId = '';
  if (payload.runId) {
    try {
      const resolved = resolvePackageRunDir(payload.runId, options);
      runId = resolved.runId;
      if (!script) {
        const p = path.join(resolved.runDir, 'final-script.md');
        if (fs.existsSync(p)) script = fs.readFileSync(p, 'utf8').trim();
      }
    } catch (_) { runId = ''; }
  }

  const mech = scriptCommitmentModel.mechanicalChecks(script);
  const evaluatedAt = new Date().toISOString();
  let model = '';
  let ollamaNote = '';
  let judgmentByKey = {};

  if (!mech.empty) {
    const schema = {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, status: { type: 'string' }, detail: { type: 'string' } },
            required: ['key', 'status', 'detail'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['checks', 'summary'],
    };
    const system = [
      'You judge whether a VIDTOOLZ vertical Short script is worth spending media-generation effort on.',
      'This is a production commitment check for a spoken-to-camera monologue (blunt, funny, direct, friend-to-friend) — NOT a generic writing-quality exam.',
      'Return only the requested JSON. For each key, status is one of: pass, warning, fail.',
    ].join('\n');
    const user = [
      'Evaluate this saved Short script and return one check per key:',
      '- one_clear_claim: makes ONE main point, not three half-points.',
      '- strong_first_line: the first sentence creates friction, recognition, surprise, or a blunt useful claim (not a generic warm-up).',
      '- spoken_natural: sounds like something a person says to camera (short sentences, contractions, spoken rhythm) — not essay language.',
      '- blunt_tone: sharp point of view, friend-to-friend; not polite generic advice.',
      '- visual_usefulness: enough concrete visual moments to justify image prompts / AI visuals / I2V / cutaways (not pure abstract commentary).',
      '- finishability: realistic to record, edit, and publish as a Short without becoming a long-form project.',
      'Also return a one-sentence summary.',
      '',
      'Script:',
      script,
    ].join('\n');
    try {
      const content = await callOllamaChat({ system, user, schema, model: payload.model }, options);
      const parsed = JSON.parse(content);
      model = payload.model || OLLAMA_MODEL;
      if (parsed && typeof parsed.summary === 'string') ollamaNote = parsed.summary.trim();
      (Array.isArray(parsed && parsed.checks) ? parsed.checks : []).forEach((c) => {
        if (c && c.key) judgmentByKey[String(c.key)] = { status: normalizeCheckStatus(c.status), detail: String(c.detail || '') };
      });
    } catch (_error) {
      ollamaNote = 'Local Ollama unavailable; mechanical checks only.';
    }
  }

  // Assemble the visible checks: Runtime fit (mechanical) + six judgment checks.
  const checks = [mech.runtimeCheck];
  for (const { key, label } of SCRIPT_COMMITMENT_JUDGMENT_KEYS) {
    const j = judgmentByKey[key];
    let status = mech.empty ? 'fail' : (j ? j.status : 'pending');
    let detail = mech.empty ? 'No script text.' : (j ? j.detail : (ollamaNote || 'Pending Ollama judgment.'));
    // Deterministic generic-opening signal hardens "Strong first line" to at least a warning.
    if (key === 'strong_first_line' && mech.genericOpening) {
      if (status === 'pass' || status === 'pending') { status = 'warning'; }
      detail = (detail ? detail + ' ' : '') + 'Opens with a generic warm-up phrase.';
    }
    checks.push({ label, status, detail });
  }

  const { verdict, recommendedNextAction } = scriptCommitmentModel.buildVerdict(checks, { empty: mech.empty, wayTooLong: mech.wayTooLong });
  const summary = mech.empty
    ? 'Script is empty — nothing to commit media generation to.'
    : (ollamaNote || (verdict === 'pass' ? 'Mechanical checks pass; script looks worth generating media for.' : 'Mechanical review only.'));

  const result = {
    verdict,
    summary,
    checks,
    estimatedWords: mech.words,
    estimatedRuntimeSeconds: mech.runtimeSeconds,
    recommendedNextAction,
    model,
    evaluatedAt,
  };

  // Compute-only: persistence is an explicit, separate step (saveScriptCommitmentCheck).
  return result;
}

// Persist a computed commitment-check verdict into the run folder. Nonce-gated by the
// route; confined to the resolved run dir; atomic temp-then-rename; overwrites safely.
function saveScriptCommitmentCheck(payload = {}, options = {}) {
  const resolved = resolvePackageRunDir(payload.runId, options); // validates id + existence + traversal
  const verdict = payload.verdict && typeof payload.verdict === 'object' ? payload.verdict : null;
  if (!verdict || !verdict.verdict) {
    const error = new Error('verdict object is required.');
    error.statusCode = 400;
    throw error;
  }
  const outPath = path.join(resolved.runDir, 'script-commitment-check.json');
  const tmp = `${outPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  return { runId: resolved.runId, path: `package-runs/${resolved.runId}/script-commitment-check.json` };
}

// ── Vertical / Shorts workflow: image-to-video (I2V) prompt generation ────────

function buildI2vSystemPrompt() {
  return [
    'You write image-to-video (I2V) motion prompts for a vertical Short (9:16).',
    'Each prompt animates ONE still image for a ~4-second clip: describe camera move and subject/scene motion only — concise, concrete, present tense.',
    'No dialogue, no audio, no scene numbers, no commentary. Motion direction only.',
    'Return only the requested JSON.',
  ].join('\n');
}

async function generateI2vPrompts(payload = {}, options = {}) {
  const script = String(payload.script || '').trim();
  if (!script) {
    const error = new Error('A script is required to generate I2V prompts.');
    error.statusCode = 400;
    throw error;
  }
  let count = Number(payload.count);
  if (!Number.isFinite(count) || count < 1) count = 4;
  count = Math.min(12, Math.round(count));
  const schema = {
    type: 'object',
    properties: { prompts: { type: 'array', items: { type: 'string' } } },
    required: ['prompts'],
  };
  const user = [
    `Monologue script:`,
    script,
    '',
    `Write exactly ${count} image-to-video motion prompts, one per shot, that match the energy and beats of this monologue. Each is a single motion description for one still image.`,
  ].join('\n');
  // Routing policy: I2V prompts are generated by Ollama on PRESTO, not vidnux.
  // No fallback to vidnux Ollama or a cloud LLM — if PRESTO Ollama is down,
  // callOllamaChat throws a 503 blocked state that names the PRESTO endpoint.
  const content = await callOllamaChat(
    { system: buildI2vSystemPrompt(), user, schema, model: payload.model || OLLAMA_PRESTO_MODEL, baseUrl: OLLAMA_PRESTO_BASE_URL }, options);
  let parsed;
  try { parsed = JSON.parse(content); } catch (_e) {
    const error = new Error('PRESTO Ollama did not return valid JSON. Try again, or set OLLAMA_PRESTO_MODEL to another installed model.');
    error.statusCode = 502;
    throw error;
  }
  const prompts = (Array.isArray(parsed.prompts) ? parsed.prompts : [])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .slice(0, count)
    .map((prompt, i) => ({ prompt_index: i + 1, prompt }));
  if (!prompts.length) {
    const error = new Error('PRESTO Ollama returned no usable I2V prompts. Try again.');
    error.statusCode = 502;
    throw error;
  }
  const prov = mediaRouting.provenanceFor(mediaRouting.LANE.I2V_PROMPT);
  return {
    model: payload.model || OLLAMA_PRESTO_MODEL,
    count: prompts.length,
    prompts,
    prompt_type: 'image_to_video',
    prompt_provider: prov.prompt_provider,
    prompt_host: prov.prompt_host,
    prompt_model: payload.model || OLLAMA_PRESTO_MODEL,
    source: prov.source,
    external_copy_allowed: true,
  };
}

// Save I2V prompts into a package's video-prompts.json (consumed by PRESTO).
// When selected-images.json exists, prompts are mapped onto the selected images'
// prompt_index values in order so PRESTO's 1:1 expectation holds.
function saveI2vPrompts(payload = {}, options = {}) {
  const { packageId, packageDir } = resolveAigenPackageDir(payload.package_id || payload.packageId, options);
  const provided = Array.isArray(payload.prompts) ? payload.prompts : [];
  const texts = provided.map((p) => (p && typeof p === 'object' ? String(p.prompt || '') : String(p || ''))).map((s) => s.trim());
  if (!texts.some(Boolean)) {
    const error = new Error('prompts are required.');
    error.statusCode = 400;
    throw error;
  }
  const selected = safeReadJson(path.join(packageDir, 'selected-images.json'), null);
  const selections = selected && Array.isArray(selected.selections) ? selected.selections : [];
  // Map onto the selected images' prompt_index when present, but never let a
  // malformed/non-integer prompt_index produce a NaN index (which would corrupt
  // video-prompts.json); fall back to the positional index for that row.
  const indexes = selections.length
    ? selections.map((s, i) => {
        const n = Number(s && s.prompt_index);
        return Number.isInteger(n) ? n : i + 1;
      })
    : texts.map((_t, i) => i + 1);
  const prompts = [];
  for (let i = 0; i < texts.length && i < indexes.length; i++) {
    if (!texts[i]) continue;
    prompts.push({ prompt_index: indexes[i], prompt: texts[i] });
  }
  const outPath = path.join(packageDir, 'video-prompts.json');
  const tmpPath = `${outPath}.tmp`;
  const prov = mediaRouting.provenanceFor(mediaRouting.LANE.I2V_PROMPT);
  const record = {
    version: 1,
    prompt_type: 'image_to_video',
    prompt_provider: prov.prompt_provider,
    prompt_host: prov.prompt_host,
    source: prov.source,
    external_copy_allowed: true,
    prompts,
  };
  fs.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, outPath);
  return { package_id: packageId, path: 'video-prompts.json', count: prompts.length };
}

// ── Project-scoped I2V prompt workspace (selected-image-keyed) ────────────────
// These power the guided i2v_prompts stage: read context + selected images +
// any existing prompts; generate one motion prompt per selected image via PRESTO
// Ollama; and save operator edits. All confined to one resolved package dir.

function readProjectSelections(packageDir) {
  const selected = safeReadJson(path.join(packageDir, 'selected-images.json'), null);
  return selected && Array.isArray(selected.selections) ? selected.selections : [];
}

function readProjectVideoPromptsRaw(packageDir) {
  const vp = safeReadJson(path.join(packageDir, 'video-prompts.json'), null);
  return vp && Array.isArray(vp.prompts) ? vp.prompts : [];
}

// Atomic write of the canonical video-prompts.json, preserving the enriched
// per-prompt review fields produced by project-i2v-prompts.js.
function writeProjectVideoPrompts(packageDir, fileObj) {
  const outPath = path.join(packageDir, 'video-prompts.json');
  const tmpPath = `${outPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(fileObj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, outPath);
  return outPath;
}

// Read-only context for project-i2v-prompts.html (no network — provider status
// is the configured PRESTO lane descriptor, not a live ping).
function readProjectI2vContext(packageId, options = {}) {
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, options);
  const state = resolveProjectState(packageDir);
  const scriptState = projectScript.readScript(packageDir);
  const selections = readProjectSelections(packageDir);
  const existing = readProjectVideoPromptsRaw(packageDir);
  const byIndex = new Map(existing.map((p) => [Number(p.prompt_index), p]));
  const images = selections.map((s, i) => {
    const promptIndex = Number.isInteger(Number(s.prompt_index)) ? Number(s.prompt_index) : (i + 1);
    const rel = String(s.selected_path || s.path || '');
    const existingPrompt = byIndex.get(promptIndex) || null;
    return {
      index: i + 1,
      prompt_index: promptIndex,
      label: String(s.label || labelFromSelectedPath(rel) || `image-${promptIndex}`),
      selected_path: rel,
      selected_source: String(s.selected_source || s.source || ''),
      asset_url: rel ? `${AIGEN_ASSETS_PREFIX}script-packages/${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}` : '',
      image_exists: rel ? fs.existsSync(path.join(packageDir, rel)) : false,
      image_prompt: String(s.prompt || ''),
      i2v_prompt: existingPrompt ? String(existingPrompt.prompt || existingPrompt.i2v_prompt || '') : '',
      motion_intent: existingPrompt ? String(existingPrompt.motion_intent || '') : '',
      camera_motion: existingPrompt ? String(existingPrompt.camera_motion || '') : '',
      subject_motion: existingPrompt ? String(existingPrompt.subject_motion || '') : '',
    };
  });
  return {
    ok: true,
    project_id: id,
    title: state.title,
    stage: state.stage,
    status: state.status,
    has_script: state.has_script,
    selected_images: selections.length,
    i2v_prompt_count: existing.length,
    images,
    provider: {
      lane: mediaRouting.LANE.I2V_PROMPT,
      provider: 'ollama',
      host: 'presto',
      endpoint: mediaRouting.resolveEndpoint(mediaRouting.LANE.I2V_PROMPT),
      model: OLLAMA_PRESTO_MODEL,
      fallback_allowed: false,
    },
  };
}

// Generate one I2V motion prompt per selected image via PRESTO Ollama and write
// the canonical video-prompts.json. Never generates videos / submits to PRESTO.
async function generateProjectI2vPrompts(payload = {}, options = {}) {
  const opt = { root: options.root || ROOT };
  const resolved = resolveAigenPackageDir(payload.id || payload.package_id || payload.package || '', opt);
  const scriptState = projectScript.readScript(resolved.packageDir);
  if (!scriptState.final.exists) {
    const e = new Error('No approved final script. Approve the script first.'); e.statusCode = 400; throw e;
  }
  const selections = readProjectSelections(resolved.packageDir);
  if (!selections.length) {
    const e = new Error('No selected images. Select images first, then generate I2V prompts.'); e.statusCode = 400; throw e;
  }
  const existing = readProjectVideoPromptsRaw(resolved.packageDir);
  if (existing.length > 0 && !payload.confirm_replace) {
    const e = new Error(`${existing.length} I2V prompt(s) already exist. Re-submit with confirm_replace to regenerate.`);
    e.statusCode = 409; throw e;
  }
  const state = resolveProjectState(resolved.packageDir);
  const prov = state.provenance || {};
  const req = projectI2vPrompts.buildI2vPromptRequest({
    title: state.title,
    premise: prov.premise || '',
    scoreSummary: (prov.score_explanation && prov.score_explanation.summary) || '',
    script: scriptState.final.text || '',
    selections,
  });
  // PRESTO Ollama only — 503 blocked on failure (no fallback). Record the model
  // actually used (payload override or the configured PRESTO default).
  const useModel = payload.model || OLLAMA_PRESTO_MODEL;
  const content = await callPrestoOllamaChat({ system: req.system, user: req.user, schema: req.schema, model: useModel }, options);
  const nowIso = new Date().toISOString();
  const records = projectI2vPrompts.parseI2vPrompts(content, selections, { projectId: resolved.packageId, model: useModel, nowIso });
  const fileObj = projectI2vPrompts.buildVideoPromptsFile(records, { projectId: resolved.packageId, model: useModel, nowIso });
  writeProjectVideoPrompts(resolved.packageDir, fileObj);
  const manifestPath = path.join(resolved.packageDir, 'video-prompts-generation-manifest.json');
  ideaPromotion.writeJsonAtomic(manifestPath, projectI2vPrompts.buildManifest(records, { projectId: resolved.packageId, model: useModel, nowIso, scriptPath: scriptState.final.path }));
  return {
    ok: true,
    project_id: resolved.packageId,
    prompt_count: records.length,
    prompts_path: 'video-prompts.json',
    manifest_path: 'video-prompts-generation-manifest.json',
    provider: 'ollama',
    provider_host: 'presto',
    model: useModel,
    generated_at: nowIso,
    replaced_existing: existing.length > 0,
  };
}

// Save operator-edited I2V prompts (one per selected image) to video-prompts.json.
function saveProjectI2vPrompts(payload = {}, options = {}) {
  const opt = { root: options.root || ROOT };
  const resolved = resolveAigenPackageDir(payload.id || payload.package_id || payload.package || '', opt);
  const selections = readProjectSelections(resolved.packageDir);
  if (!selections.length) {
    const e = new Error('No selected images. Select images first.'); e.statusCode = 400; throw e;
  }
  const nowIso = new Date().toISOString();
  const records = projectI2vPrompts.normalizeSaveRecords(payload.prompts, selections, { projectId: resolved.packageId, nowIso });
  const fileObj = projectI2vPrompts.buildVideoPromptsFile(records, { projectId: resolved.packageId, model: OLLAMA_PRESTO_MODEL, nowIso });
  writeProjectVideoPrompts(resolved.packageDir, fileObj);
  return {
    ok: true,
    project_id: resolved.packageId,
    prompt_count: records.length,
    prompts_path: 'video-prompts.json',
    saved_at: nowIso,
  };
}

// ── Project-scoped video review (cockpit-native; no legacy 8099 dependency) ───
// Pairs the pure helpers (project-video-review.js) with ffprobe + package reads.
// Read-only GET; never mutates video files. Decisions persist to video-review.json.

// ffprobe a clip into {width,height,fps,frames,duration}, cached by path+mtime+size
// so repeated GETs don't re-probe unchanged files. Returns null if probe fails.
const VIDEO_PROBE_CACHE = new Map();
function probeVideo(absPath) {
  let stat;
  try { stat = fs.statSync(absPath); } catch (_) { return null; }
  const key = `${absPath}|${stat.mtimeMs}|${stat.size}`;
  if (VIDEO_PROBE_CACHE.has(key)) return VIDEO_PROBE_CACHE.get(key);
  let probe = null;
  try {
    const out = childProcess.spawnSync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', absPath,
    ], { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    if (out.status === 0 && out.stdout) {
      const parsed = JSON.parse(out.stdout);
      const v = (parsed.streams || []).find((s) => s.codec_type === 'video') || {};
      let fps = null;
      if (typeof v.r_frame_rate === 'string' && v.r_frame_rate.includes('/')) {
        const [n, d] = v.r_frame_rate.split('/').map(Number);
        if (d) fps = n / d;
      }
      let frames = v.nb_frames != null ? Number(v.nb_frames) : null;
      const duration = (v.duration != null ? Number(v.duration) : (parsed.format && parsed.format.duration != null ? Number(parsed.format.duration) : null));
      if ((!frames || Number.isNaN(frames)) && fps && duration) frames = Math.round(fps * duration);
      probe = {
        width: v.width != null ? Number(v.width) : null,
        height: v.height != null ? Number(v.height) : null,
        fps,
        frames: frames != null && !Number.isNaN(frames) ? frames : null,
        duration,
      };
    }
  } catch (_) { probe = null; }
  VIDEO_PROBE_CACHE.set(key, probe);
  return probe;
}

function assetUrl(id, rel) {
  return rel ? `${AIGEN_ASSETS_PREFIX}script-packages/${encodeURIComponent(id)}/${String(rel).split('/').map(encodeURIComponent).join('/')}` : '';
}

function readProjectVideoReviewFile(packageDir) {
  const j = safeReadJson(path.join(packageDir, 'video-review.json'), null);
  return j && Array.isArray(j.reviews) ? j.reviews : [];
}

// Assemble the project's clips: one per selected image (prompt_index), paired with
// its source image, I2V prompt, ffprobe validation, and any saved review decision.
function readProjectVideoReview(packageId, options = {}) {
  const opt = { root: options.root || ROOT };
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, opt);
  const state = resolveProjectState(packageDir);
  const selections = readProjectSelections(packageDir);
  // Review the variant folder that actually holds this project's clips (an
  // HQ-only project reviews videos/mp4-hq-720p/), validated against that
  // variant's spec. An explicit options.videoVariant overrides detection.
  const videoVariant = options.videoVariant
    ? assertValidVideoVariant(options.videoVariant)
    : packageBestStagedWanStatus(packageDir).videoVariant;
  const expected = projectVideoReview.expectedForVariant(videoVariant);
  const vpByIndex = new Map(readProjectVideoPromptsRaw(packageDir).map((p) => [Number(p.prompt_index), p]));
  const reviewByIndex = new Map(readProjectVideoReviewFile(packageDir).map((r) => [Number(r.prompt_index), r]));

  const clips = selections.map((s, i) => {
    const promptIndex = Number.isInteger(Number(s.prompt_index)) ? Number(s.prompt_index) : (i + 1);
    const mp4Rel = projectVideoReview.mp4RelPath(promptIndex, videoVariant);
    const mp4Abs = path.join(packageDir, mp4Rel);
    // A clip that is physically on disk must always be viewable. ffprobe can
    // fail or time out (e.g. a large clip streamed from VIDNAS) even when the
    // file is fine — that only makes the SPEC unknown, it must never hide the
    // clip or mislabel a present file as "missing".
    const mp4Exists = fs.existsSync(mp4Abs);
    const validation = projectVideoReview.buildValidation(mp4Exists ? probeVideo(mp4Abs) : null, expected, mp4Exists);
    const srcRel = String(s.selected_path || s.path || '');
    const vp = vpByIndex.get(promptIndex) || null;
    const rev = reviewByIndex.get(promptIndex) || null;
    return {
      prompt_index: promptIndex,
      label: String(s.label || labelFromSelectedPath(srcRel) || `clip-${promptIndex}`),
      mp4_path: mp4Rel,
      mp4_exists: mp4Exists,
      mp4_url: mp4Exists ? assetUrl(id, mp4Rel) : '',
      source_image_path: srcRel,
      source_image_url: srcRel ? assetUrl(id, srcRel) : '',
      source_image_exists: srcRel ? fs.existsSync(path.join(packageDir, srcRel)) : false,
      i2v_prompt: vp ? String(vp.prompt || vp.i2v_prompt || '') : '',
      validation,
      review: {
        decision: rev ? projectVideoReview.normalizeDecision(rev.decision) : 'unreviewed',
        notes: rev ? String(rev.notes || '') : '',
      },
    };
  });

  const counts = projectVideoReview.summarizeCounts(clips);
  return {
    ok: true,
    project: { id, title: state.title, stage: state.stage, status: state.status },
    video_variant: videoVariant,
    expected,
    clips,
    counts,
    usability: projectVideoReview.usability(counts),
    // The handoff builder does not yet filter on these decisions.
    handoff_consumes_review: false,
    reviews_path: 'video-review.json',
  };
}

// Per-variant staged-clip picture for ONE project: every populated
// videos/<variant>/ lane with its coverage, which lane the coverage/handoff
// logic would pick, and which lane the existing Resolve handoff recorded.
// Read-only; feeds the review page's lane pills and the handoff page.
function readProjectVideoVariants(packageId, options = {}) {
  const opt = { root: options.root || ROOT };
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, opt);
  const selections = readPackageSelections(packageDir);
  const handoffVariant = packageHandoffVideoVariant(packageDir);
  const best = packageBestStagedWanStatus(packageDir);
  const entries = listPackageVideoVariantEntries(packageDir);
  if (!entries.some((entry) => entry.name === DEFAULT_VIDEO_VARIANT)) {
    entries.unshift({ name: DEFAULT_VIDEO_VARIANT, clipSet: readVariantClipSet(packageDir, DEFAULT_VIDEO_VARIANT) });
  }
  const variants = entries.map((entry) => {
    const status = packageStagedWanStatus(packageDir, entry.name, { selections, clipSet: entry.clipSet });
    return {
      name: entry.name,
      video_dir: status.videoDir,
      completed: status.completedCount,
      selections: status.selectionCount,
      clip_files: entry.clipSet.size,
      is_default: entry.name === DEFAULT_VIDEO_VARIANT,
      is_handoff_variant: entry.name === handoffVariant,
      is_best: entry.name === best.videoVariant,
    };
  });
  return {
    ok: true,
    project_id: id,
    variants,
    best_variant: best.videoVariant,
    handoff_video_variant: handoffVariant,
  };
}

// ── Project media kit (pre-edit asset board) ────────────────────────────────
// Windows-side VIDNAS paths for the media kit. The UNC form is always valid on
// any Windows box regardless of drive mappings; the drive-letter form is
// convenience and env-configurable (no mapping for the Public share is
// documented anywhere, so X: is an assumption the operator can override).
const VIDNAS_WINDOWS_ROOT = process.env.VIDTOOLZ_VIDNAS_WINDOWS_ROOT || 'X:\\VIDTOOLZ\\03_SHARED_MEDIA_LIBRARY\\aigen';
const VIDNAS_UNC_ROOT = '\\\\192.168.61.186\\Public\\VIDTOOLZ\\03_SHARED_MEDIA_LIBRARY\\aigen';

function windowsPathsFor(relFromAigen) {
  const backslashed = String(relFromAigen).split('/').filter(Boolean).join('\\');
  return {
    windows_path: `${VIDNAS_WINDOWS_ROOT}\\${backslashed}`,
    windows_unc_path: `${VIDNAS_UNC_ROOT}\\${backslashed}`,
  };
}

function mediaKitFolder(id, packageDir, label, rel) {
  const relFromAigen = rel ? `script-packages/${id}/${rel}` : `script-packages/${id}`;
  return {
    label,
    relative_path: rel || '.',
    linux_path: rel ? path.join(packageDir, rel) : packageDir,
    ...windowsPathsFor(relFromAigen),
    url_prefix: rel ? assetUrl(id, rel) : `${AIGEN_ASSETS_PREFIX}script-packages/${encodeURIComponent(id)}/`,
  };
}

// The prompt index encoded in a flux image filename. Unlike
// promptIndexFromName (last digit group), this reads the flux-NNN prefix so
// regenerated variants like flux-021-v2.png map to 21, not 2.
function fluxPromptIndex(name) {
  const m = String(name || '').match(/^flux-(\d{1,4})/i);
  return m ? Number(m[1]) : null;
}

function readProjectYoutubeDraft(packageId, options = {}) {
  const opt = { root: options.root || ROOT };
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, opt);
  const draft = safeReadJson(path.join(packageDir, 'youtube-draft.json'), null);
  const state = resolveProjectState(packageDir);
  const premise = state.provenance && state.provenance.premise ? String(state.provenance.premise) : '';
  const selections = readPackageSelections(packageDir);
  const firstSelected = selections.length ? String(selections[0].selected_path || selections[0].path || '') : '';

  const tempTitle = draft && draft.temp_title ? String(draft.temp_title) : state.title;
  const tempDescription = draft && draft.temp_description
    ? String(draft.temp_description)
    : (premise ? `A short video about ${premise}` : '');

  // Thumbnail: explicit draft choice wins; else propose the first selected
  // image as a candidate; else none. Never generated here.
  let thumbnail = { exists: false, path: '', url: '', source: 'none' };
  const draftThumb = draft && draft.thumbnail && draft.thumbnail.path ? String(draft.thumbnail.path) : '';
  if (draftThumb && fs.existsSync(path.join(packageDir, draftThumb))) {
    thumbnail = { exists: true, path: draftThumb, url: assetUrl(id, draftThumb), source: 'draft' };
  } else if (firstSelected && fs.existsSync(path.join(packageDir, firstSelected))) {
    thumbnail = { exists: true, path: firstSelected, url: assetUrl(id, firstSelected), source: 'selected_candidate' };
  }

  return {
    ok: true,
    project_id: id,
    draft_exists: Boolean(draft),
    path: 'youtube-draft.json',
    temp_title: tempTitle,
    temp_description: tempDescription,
    thumbnail,
    updated_at: draft && draft.updated_at ? draft.updated_at : null,
  };
}

function saveProjectYoutubeDraft(payload = {}, options = {}) {
  const opt = { root: options.root || ROOT };
  const { packageId: id, packageDir } = resolveAigenPackageDir(payload.id || payload.package_id || payload.package || '', opt);
  const tempTitle = String(payload.temp_title == null ? '' : payload.temp_title).slice(0, 500);
  const tempDescription = String(payload.temp_description == null ? '' : payload.temp_description).slice(0, 10000);
  const thumbRel = String(payload.thumbnail_path == null ? '' : payload.thumbnail_path).trim();

  let thumbnail = { type: 'none', path: '', notes: '' };
  if (thumbRel) {
    if (thumbRel.includes('..') || thumbRel.startsWith('/') || thumbRel.includes('\\')) {
      const e = new Error('thumbnail_path must be a package-relative path.'); e.statusCode = 400; throw e;
    }
    const abs = path.resolve(packageDir, thumbRel);
    if (abs !== packageDir && !abs.startsWith(packageDir + path.sep)) {
      const e = new Error('thumbnail_path escapes the project package.'); e.statusCode = 400; throw e;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      const e = new Error(`thumbnail_path does not exist in the package: ${thumbRel}`); e.statusCode = 400; throw e;
    }
    thumbnail = { type: 'selected_image', path: thumbRel, notes: String(payload.thumbnail_notes || '').slice(0, 1000) };
  }

  const fileObj = {
    version: 1,
    temp_title: tempTitle,
    temp_description: tempDescription,
    thumbnail,
    updated_at: new Date().toISOString(),
  };
  const outPath = path.join(packageDir, 'youtube-draft.json');
  const tmpPath = `${outPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(fileObj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, outPath);
  return { ok: true, project_id: id, path: 'youtube-draft.json', saved: fileObj };
}

// One project-scoped view of everything the operator has before editing:
// YouTube draft, script, prompts, images, I2V prompts, clips per lane, and
// the Resolve handoff — with copyable VIDNAS paths. Read-only assembly.
function readProjectMediaKit(packageId, options = {}) {
  const opt = { root: options.root || ROOT };
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, opt);
  const state = resolveProjectState(packageDir);
  const youtube = readProjectYoutubeDraft(id, opt);
  const variantsInfo = readProjectVideoVariants(id, opt);

  // Script
  const scriptRel = path.posix.join('script', 'script-final.md');
  const scriptAbs = path.join(packageDir, 'script', 'script-final.md');
  let scriptText = '';
  try { scriptText = fs.readFileSync(scriptAbs, 'utf8').slice(0, 200000); } catch (e) { scriptText = ''; }

  // Image prompts
  const promptData = safeReadJson(path.join(packageDir, 'image-prompts.json'), null);
  const promptItems = promptData && Array.isArray(promptData.image_prompts) ? promptData.image_prompts : [];
  const imagePrompts = promptItems.map((p) => ({
    index: Number(p.index == null ? p.prompt_index : p.index),
    prompt: String(p.prompt || ''),
    category: String(p.category || ''),
    intended_use: String(p.intended_use || ''),
  })).filter((p) => Number.isInteger(p.index));
  const promptByIndex = new Map(imagePrompts.map((p) => [p.index, p.prompt]));

  // Images: everything on disk in images/flux-local/, selected set marked.
  const selections = readPackageSelections(packageDir);
  const selectedPaths = new Set(selections.map((s) => String(s.selected_path || s.path || '')));
  const fluxDirRel = path.posix.join('images', 'flux-local');
  const imageItems = safeDirEntries(path.join(packageDir, fluxDirRel))
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => {
      const rel = path.posix.join(fluxDirRel, entry.name);
      const promptIndex = fluxPromptIndex(entry.name);
      return {
        prompt_index: promptIndex,
        selected: selectedPaths.has(rel),
        path: rel,
        url: assetUrl(id, rel),
        source_prompt: promptIndex != null ? String(promptByIndex.get(promptIndex) || '') : '',
        generation_provider: 'flux',
        generation_host: 'vidnux',
      };
    })
    .sort((a, b) => (a.prompt_index || 0) - (b.prompt_index || 0) || a.path.localeCompare(b.path));

  // I2V prompts
  const vp = safeReadJson(path.join(packageDir, 'video-prompts.json'), null);
  const i2vItems = (vp && Array.isArray(vp.prompts) ? vp.prompts : []).map((p) => {
    const idx = Number(p.prompt_index == null ? p.index : p.prompt_index);
    const text = String(p.prompt || p.i2v_prompt || '');
    const srcRel = String(p.source_image || '');
    return {
      prompt_index: idx,
      source_image: srcRel,
      source_image_url: srcRel ? assetUrl(id, srcRel) : '',
      prompt: text,
    };
  }).filter((p) => Number.isInteger(p.prompt_index));

  // Video lanes: clips per populated variant folder; the handoff lane carries
  // ffprobe validation + review decisions via the review reader.
  const handoffVariant = variantsInfo.handoff_video_variant;
  const primaryVariant = handoffVariant || variantsInfo.best_variant || DEFAULT_VIDEO_VARIANT;
  let review = null;
  try { review = readProjectVideoReview(id, { ...opt, videoVariant: primaryVariant }); } catch (e) { review = null; }
  const reviewByIndex = new Map(((review && review.clips) || []).map((c) => [c.prompt_index, c]));
  const i2vByIndex = new Map(i2vItems.map((p) => [p.prompt_index, p]));
  const videoFolders = variantsInfo.variants
    .filter((v) => v.clip_files > 0)
    .map((v) => ({
      variant: v.name,
      label: v.name === 'mp4' ? 'Fast Wan2.2 clips (legacy lane)' : v.name === 'mp4-hq-720p' ? 'HQ Wan2.2 clips' : `${v.name} clips`,
      count: v.clip_files,
      relative_path: `videos/${v.name}/`,
      handoff_variant: v.is_handoff_variant,
    }));
  const videoItems = [];
  for (const folder of videoFolders) {
    const clips = safeDirEntries(path.join(packageDir, 'videos', folder.variant))
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && /^\d{3,}\.mp4$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const clip of clips) {
      const idx = Number(clip.name.replace(/\.mp4$/, ''));
      const rel = path.posix.join('videos', folder.variant, clip.name);
      const rc = folder.variant === primaryVariant ? reviewByIndex.get(idx) : null;
      const i2v = i2vByIndex.get(idx);
      videoItems.push({
        prompt_index: idx,
        variant: folder.variant,
        path: rel,
        url: assetUrl(id, rel),
        i2v_prompt: i2v ? i2v.prompt : '',
        source_image: i2v ? i2v.source_image : '',
        source_image_url: i2v && i2v.source_image ? assetUrl(id, i2v.source_image) : '',
        validation: rc ? rc.validation : null,
        review_decision: rc && rc.review ? rc.review.decision : null,
      });
    }
  }

  // Resolve handoff
  const handoffManifest = safeReadJson(path.join(packageDir, 'resolve-handoff', 'media-manifest.json'), null);
  const handoffArtifacts = RESOLVE_HANDOFF_FILES
    .filter((f) => fs.existsSync(path.join(packageDir, 'resolve-handoff', f)))
    .map((f) => `resolve-handoff/${f}`);

  return {
    ok: true,
    project: {
      id,
      title: state.title,
      status: state.status,
      stage: state.stage,
      premise: state.provenance && state.provenance.premise ? state.provenance.premise : '',
      package_path: packageDir,
      vidnas_linux_path: packageDir,
      ...windowsPathsFor(`script-packages/${id}`),
    },
    youtube: {
      draft_exists: youtube.draft_exists,
      temp_title: youtube.temp_title,
      temp_description: youtube.temp_description,
      thumbnail: youtube.thumbnail,
      updated_at: youtube.updated_at,
    },
    script: {
      final_exists: Boolean(scriptText),
      path: scriptRel,
      text: scriptText,
    },
    image_prompts: {
      count: imagePrompts.length,
      path: 'image-prompts.json',
      items: imagePrompts,
    },
    images: {
      all_count: imageItems.length,
      selected_count: imageItems.filter((im) => im.selected).length,
      items: imageItems,
    },
    i2v_prompts: {
      count: i2vItems.length,
      path: 'video-prompts.json',
      items: i2vItems,
    },
    videos: {
      primary_variant: primaryVariant,
      folders: videoFolders,
      items: videoItems,
    },
    resolve_handoff: {
      exists: state.has_resolve_handoff,
      path: 'resolve-handoff/',
      video_variant: state.handoff_video_variant,
      included_indexes: handoffManifest && Array.isArray(handoffManifest.included_indexes) ? handoffManifest.included_indexes : [],
      excluded_indexes: handoffManifest && Array.isArray(handoffManifest.excluded_indexes) ? handoffManifest.excluded_indexes : [],
      artifacts: handoffArtifacts,
    },
    folders: [
      mediaKitFolder(id, packageDir, 'Package root', ''),
      mediaKitFolder(id, packageDir, 'FLUX images', 'images/flux-local'),
      ...videoFolders.map((f) => mediaKitFolder(id, packageDir, f.label, `videos/${f.variant}`)),
      mediaKitFolder(id, packageDir, 'Resolve handoff', 'resolve-handoff'),
      mediaKitFolder(id, packageDir, 'Script', 'script'),
      ...(fs.existsSync(path.join(packageDir, 'earth-studio'))
        ? [mediaKitFolder(id, packageDir, 'Earth Studio map animation', 'earth-studio')]
        : []),
    ],
  };
}

// Persist operator review decisions to video-review.json (merged over existing).
function saveProjectVideoReview(payload = {}, options = {}) {
  const opt = { root: options.root || ROOT };
  const { packageId: id, packageDir } = resolveAigenPackageDir(payload.id || payload.package_id || payload.package || '', opt);
  const incoming = projectVideoReview.normalizeReviewSave(payload.reviews);
  const merged = projectVideoReview.mergeReviews(readProjectVideoReviewFile(packageDir), incoming);
  const nowIso = new Date().toISOString();
  const fileObj = projectVideoReview.buildReviewFile(merged, { projectId: id, nowIso });
  const outPath = path.join(packageDir, 'video-review.json');
  const tmpPath = `${outPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(fileObj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, outPath);
  const counts = projectVideoReview.summarizeCounts(merged.map((r) => ({ review: { decision: r.decision } })));
  return { ok: true, project_id: id, reviews_path: 'video-review.json', saved_at: nowIso, review_count: merged.length, counts };
}

// Generate ONE fresh topic candidate with the local Ollama LLM and append it to a
// run's package-candidates.json (used by Topic Scout's "Delete & replace"). Existing
// candidates are preserved as-is; only the new one is appended. Nonce-gated by the route.
async function generateOneTopicCandidate(payload = {}, options = {}) {
  const runId = validatePackageRunId(payload.runId);
  const { candidatesPath, data } = readPackageCandidatesForEdit(runId, options);
  const existing = Array.isArray(data.candidates) ? data.candidates : [];
  const existingTitles = existing.map((c) => (c && c.proposedTitle) || '').filter(Boolean);
  const schema = {
    type: 'object',
    properties: {
      proposedTitle: { type: 'string' },
      idea: { type: 'string' },
      viewerPromise: { type: 'string' },
      targetViewer: { type: 'string' },
      thumbnailConcept: { type: 'string' },
      onThumbnailText: { type: 'string' },
      productionDifficulty: { type: 'string' },
      mainRisk: { type: 'string' },
      score: { type: 'integer' },
      recommendation: { type: 'string' },
      videoFormat: { type: 'string' },
      shortsIdeas: { type: 'array', items: { type: 'string' } },
    },
    required: ['proposedTitle', 'idea', 'viewerPromise', 'targetViewer', 'productionDifficulty', 'mainRisk', 'videoFormat'],
  };
  const system = [
    'You generate ONE fresh YouTube Short idea for VIDTOOLZ (practical video creation in the AI era).',
    'Audience: serious solo creators adapting to AI. Tone: practical teacher with critical tester instincts; no hype, no "make money with AI".',
    'Format: a single 9:16 Short, under 3 minutes, one claim / one example / one point.',
    'Be concrete and demonstrable on screen. Return only the requested JSON.',
  ].join('\n');
  const user = [
    'Generate one new, distinct VIDTOOLZ Short topic candidate.',
    existingTitles.length ? `Avoid duplicating or closely echoing these existing titles:\n- ${existingTitles.join('\n- ')}` : '',
    'Fields: proposedTitle, idea, viewerPromise, targetViewer, thumbnailConcept, onThumbnailText (short, may be empty), productionDifficulty (Low/Medium/High), mainRisk, score (0-100 integer), recommendation (Make/Maybe/Reject), videoFormat ("short" if it fits a <3 min vertical Short, "long" if it needs a ~5-25 min horizontal video), shortsIdeas (up to 5 short strings).',
  ].filter(Boolean).join('\n\n');
  const content = await callOllamaChat({ system, user, schema, model: payload.model }, options);
  let parsed;
  try { parsed = JSON.parse(content); } catch (_e) {
    const error = new Error('Ollama did not return valid JSON. Try again, or set OLLAMA_MODEL to another installed model.');
    error.statusCode = 502;
    throw error;
  }
  if (!parsed || !String(parsed.proposedTitle || '').trim()) {
    const error = new Error('Ollama returned no usable candidate. Try again.');
    error.statusCode = 502;
    throw error;
  }
  const nextNumber = existing.reduce((max, c) => Math.max(max, Number(c && c.packageNumber) || 0), 0) + 1;
  const candidate = packageEngineModel.normalizePackageCandidate(
    { ...parsed, id: `generated-${String(nextNumber).padStart(3, '0')}`, packageNumber: nextNumber },
    existing.length
  );
  const next = { ...data, candidates: [...existing, candidate] };
  const tmpPath = `${candidatesPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, candidatesPath);
  return { runId, candidate };
}

// Store an operator-supplied ("manual") image into a package under the TRUTHFUL
// manual-upload namespace (images/manual-upload/manual-NNN.png) — never under
// images/flux-local/, whose name claims FLUX generation. The image still flows
// through the index-keyed selection→PRESTO pipeline (writeSelectedImages /
// listFluxImages resolve a slot from EITHER namespace) but now carries explicit
// manual_upload provenance. Bytes arrive base64 in JSON; confined to the package
// dir; nonce-gated by the route.
const MANUAL_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

function manualUploadImageRel(index) {
  return `images/manual-upload/manual-${String(index).padStart(3, '0')}.png`;
}
function legacyFluxImageRel(index) {
  return `images/flux-local/flux-${String(index).padStart(3, '0')}.png`;
}

// The single canonical image occupying slot `index`: manual-upload namespace
// first (truthful), then the legacy/generated flux-local slot. Returns
// { rel, abs, source_type } or null. source_type is evidence-based.
function resolveSlotImage(packageDir, index, evidence) {
  const ev = evidence || packageMediaIndex.buildImageEvidence(packageDir);
  for (const rel of [manualUploadImageRel(index), legacyFluxImageRel(index)]) {
    const abs = path.join(packageDir, rel);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return { rel, abs, source_type: packageMediaIndex.classifyImageSource(rel, ev) };
      }
    } catch (_) { /* fall through */ }
  }
  return null;
}

// Record an operator upload in the external-media sidecar with AUTHORITATIVE
// manual provenance. The server — not the client — owns source_type; a
// client-supplied provider is recorded for reference but can never claim FLUX
// generation. Replaces any prior sidecar entry for the same slot path.
function recordManualUpload(packageDir, packageId, details = {}) {
  const nowIso = details.now || new Date().toISOString();
  const sidecar = readSidecar(packageDir);
  const images = Array.isArray(sidecar.images)
    ? sidecar.images.filter((entry) => entry.path !== details.relative && entry.prompt_index !== details.promptIndex)
    : [];
  // Provider is reference-only and never FLUX/local for a manual upload.
  let provider = String(details.payload.provider || details.payload.source || 'manual_upload').trim() || 'manual_upload';
  if (/^flux/i.test(provider) || /local/i.test(provider)) provider = 'manual_upload';
  const entry = {
    media_type: 'image',
    source_type: 'manual_upload',      // server-authoritative
    generation_mode: 'manual_external', // retained for index count back-compat
    generation_provider: provider,
    generation_host: 'operator_upload',
    variant: 'manual-upload',
    imported_at: nowIso,
    original_filename: String(details.payload.filename || details.filename || ''),
    path: details.relative,
    sha256: crypto.createHash('sha256').update(details.buf).digest('hex'),
    prompt_index: details.promptIndex,
    prompt_text: String(details.payload.prompt || details.payload.prompt_text || ''),
    legacy_inference: false,
    validation: { ok: true, warnings: [], format: details.isPng ? 'png' : 'jpeg' },
  };
  sidecar.package = sidecar.package || packageId;
  sidecar.version = sidecar.version || 1;
  sidecar.images = [...images, entry];
  writeSidecar(packageDir, sidecar, nowIso);
  return entry;
}

function uploadAigenImage(payload = {}, options = {}) {
  const { packageId, packageDir } = resolveAigenPackageDir(payload.package_id || payload.packageId, options);
  const promptIndex = Number(payload.prompt_index);
  if (!Number.isInteger(promptIndex) || promptIndex < 1 || promptIndex > 999) {
    const error = new Error('prompt_index must be an integer from 1 to 999.');
    error.statusCode = 400; error.code = 'INVALID_SLOT';
    throw error;
  }
  let b64 = String(payload.data_base64 || payload.data || '');
  const comma = b64.indexOf('base64,');
  if (comma !== -1) b64 = b64.slice(comma + 'base64,'.length);
  b64 = b64.trim();
  if (!b64) {
    const error = new Error('data_base64 is required.');
    error.statusCode = 400; error.code = 'MALFORMED_UPLOAD';
    throw error;
  }
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (_e) { buf = null; }
  if (!buf || !buf.length) {
    const error = new Error('Could not decode image data.');
    error.statusCode = 400; error.code = 'MALFORMED_UPLOAD';
    throw error;
  }
  if (buf.length > MANUAL_IMAGE_MAX_BYTES) {
    const error = new Error(`Image too large (max ${Math.floor(MANUAL_IMAGE_MAX_BYTES / 1024 / 1024)} MB).`);
    error.statusCode = 413; error.code = 'MEDIA_TOO_LARGE';
    throw error;
  }
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!isPng && !isJpeg) {
    const error = new Error('Only PNG or JPEG images are supported.');
    error.statusCode = 415; error.code = 'UNSUPPORTED_MEDIA_TYPE';
    throw error;
  }
  const evidence = packageMediaIndex.buildImageEvidence(packageDir);
  // Slot-safety (preserved from the operator-control audit, now cross-namespace):
  // reject an occupied slot — whether the occupant is a generated FLUX image, a
  // legacy manual image under flux-local/, or a prior manual upload — unless the
  // operator explicitly confirms replacement. Replacement archives the prior
  // asset (never deletes) before the new file is written.
  const existing = resolveSlotImage(packageDir, promptIndex, evidence);
  if (existing && !payload.confirm_replace) {
    const error = new Error(`Slot ${promptIndex} already has an image (${existing.rel}). Clear it first, or resubmit with confirm_replace to archive-and-replace it.`);
    error.statusCode = 409; error.code = 'MEDIA_SLOT_OCCUPIED'; error.occupied = true;
    throw error;
  }
  // Destination is always the truthful manual-upload namespace.
  const relative = manualUploadImageRel(promptIndex);
  const dir = path.join(packageDir, 'images', 'manual-upload');
  const outPath = path.join(dir, `manual-${String(promptIndex).padStart(3, '0')}.png`);
  // Path containment defence-in-depth (index is an int, but never trust the join).
  if (path.resolve(outPath) !== path.resolve(path.join(packageDir, relative))
    || !path.resolve(outPath).startsWith(path.resolve(packageDir) + path.sep)) {
    const error = new Error('Resolved upload path is outside the package.');
    error.statusCode = 400; error.code = 'PATH_OUTSIDE_PROJECT';
    throw error;
  }

  let supersededPath = null;
  if (existing) {
    // Archive the prior occupant (from whichever namespace) under superseded/,
    // preserving its provenance in the sidecar history. Never deleted.
    const archiveDir = path.join(packageDir, 'images', 'superseded');
    fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = path.basename(existing.rel, path.extname(existing.rel));
    let dest = path.join(archiveDir, `${baseName}__${stamp}.png`);
    let n = 1;
    while (fs.existsSync(dest)) { dest = path.join(archiveDir, `${baseName}__${stamp}-${n}.png`); n += 1; }
    fs.renameSync(existing.abs, dest); // move aside (never deleted)
    supersededPath = path.relative(packageDir, dest);
    // Preserve the superseded asset's provenance in sidecar history.
    try {
      const sc = readSidecar(packageDir);
      sc.superseded = Array.isArray(sc.superseded) ? sc.superseded : [];
      sc.superseded.push({
        prompt_index: promptIndex,
        prior_path: existing.rel,
        prior_source_type: existing.source_type,
        archived_path: supersededPath,
        archived_at: new Date().toISOString(),
      });
      writeSidecar(packageDir, sc, new Date().toISOString());
    } catch (_) { /* best-effort history; the file is already safely archived */ }
  }

  // Stage the new bytes atomically. A failed file write must leave existing
  // media untouched (the prior asset is already safely archived above).
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${outPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, outPath);
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    const error = new Error(`Failed to write uploaded image: ${e.message}`);
    error.statusCode = 500; error.code = 'UPLOAD_WRITE_FAILED';
    throw error;
  }
  // Persist authoritative provenance. If this fails AFTER the file is staged,
  // clean up ONLY the newly staged file so no phantom current asset remains.
  let provenance;
  try {
    provenance = recordManualUpload(packageDir, packageId, { relative, promptIndex, buf, isPng, payload });
  } catch (e) {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
    const error = new Error(`Failed to record upload provenance: ${e.message}`);
    error.statusCode = 500; error.code = 'PROVENANCE_WRITE_FAILED';
    throw error;
  }
  return {
    package_id: packageId,
    prompt_index: promptIndex,
    filename: path.basename(relative),
    path: relative,
    source_type: 'manual_upload',
    bytes: buf.length,
    format: isPng ? 'png' : 'jpeg',
    replaced: Boolean(existing),
    superseded_path: supersededPath,
    provenance: {
      source_type: 'manual_upload',
      generation_mode: provenance.generation_mode,
      generation_provider: provenance.generation_provider,
      generation_host: provenance.generation_host,
      original_filename: provenance.original_filename,
      legacy_inference: false,
    },
  };
}

// Build orientation/resolution environment variables for FLUX/PRESTO child
// processes from the run's workflow path. Passed as ENV (never CLI args) so the
// current external ComfyUI handoff scripts ignore them harmlessly; once those
// scripts are updated to read them, vertical=1080x1920 / horizontal=1920x1080
// generation follows the chosen workflow. Unset resolves to horizontal.
function workflowGenerationEnv(payload = {}) {
  const pathKey = workflowPathModel.normalizeWorkflowPath(payload.workflowPath || payload.orientation || '');
  const info = workflowPathModel.workflowPathInfo(pathKey);
  return {
    env: {
      VIDTOOLZ_WORKFLOW_PATH: pathKey,
      VIDTOOLZ_ORIENTATION: info.orientation,
      VIDTOOLZ_TARGET_WIDTH: String(info.width),
      VIDTOOLZ_TARGET_HEIGHT: String(info.height),
      VIDTOOLZ_TARGET_RESOLUTION: info.resolution,
    },
    workflowPath: pathKey,
    orientation: info.orientation,
    targetResolution: info.resolution,
  };
}

function parseLabelValueStdout(stdout = '') {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((result, line) => {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        result[match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')] = match[2].trim();
      }
      return result;
    }, {});
}

function aigenPaths(options = {}) {
  const aigenRoot = options.aigenRoot || process.env.AIGEN_VIDNAS_ROOT || VIDNAS_AIGEN_ROOT;
  return {
    aigenRoot,
    scriptPackages: options.scriptPackages || process.env.AIGEN_SCRIPT_PACKAGES || path.join(aigenRoot, 'script-packages'),
    wanLane: options.wanLane || process.env.AIGEN_WAN_LANE || path.join(aigenRoot, 'image-to-video', 'production', 'wan22-81f'),
    prestoBaseUrl: options.prestoBaseUrl || process.env.AIGEN_PRESTO_BASE_URL || PRESTO_BASE_URL,
    prestoTimeoutMs: Number(options.prestoTimeoutMs || process.env.AIGEN_PRESTO_TIMEOUT_MS || 2000),
    pythonBin: options.pythonBin || process.env.AIGEN_PYTHON_BIN || 'python3',
    topicToPackageScript: options.topicToPackageScript || process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT || path.join(aigenRoot, 'scripts', 'topic-to-package.py'),
    productionScript: options.productionScript || process.env.AIGEN_PRODUCTION_SCRIPT || PRESTO_STATE.productionScript,
    fluxScript: options.fluxScript || process.env.AIGEN_FLUX_SCRIPT || FLUX_STATE.script,
    wanRunsDir: options.wanRunsDir || process.env.AIGEN_WAN_RUNS_DIR || PRESTO_STATE.runsDir,
  };
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function safeReadText(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return fallback;
  }
}

function safeDirEntries(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function parseJsonLines(filePath) {
  return safeReadText(filePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return { label: line.split(/\s+/)[0], raw: line };
      }
    });
}

function parseWanQueue(filePath) {
  return safeReadText(filePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      if (line.startsWith('{')) {
        try {
          return JSON.parse(line);
        } catch (_) {
          return { raw: line };
        }
      }
      const parts = line.split('\t');
      return { label: parts[0] || '', source: parts[1] || '', prompt: parts.slice(2).join('\t') };
    });
}

function labelFromSelectedPath(selectedPath = '') {
  return path.basename(String(selectedPath || ''), path.extname(String(selectedPath || '')));
}

function selectionPromptIndex(selection = {}) {
  const direct = Number(selection.prompt_index);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const source = String(selection.label || labelFromSelectedPath(selection.selected_path) || '');
  const match = source.match(/(\d{1,5})/);
  return match ? Number(match[1]) : null;
}

// Video variant = the videos/<variant>/ subfolder a Resolve handoff pulls its
// clips from. Default 'mp4' = the legacy fast Wan2.2 clips (backward compatible);
// 'mp4-hq-720p' = the HQ Wan2.2 clips. The name is validated against path
// traversal like a package id, so an operator/API can only ever select a sibling
// videos/* folder (never escape the package or reach an absolute path).
const DEFAULT_VIDEO_VARIANT = 'mp4';
const VIDEO_VARIANT_PATTERN = /^[A-Za-z0-9._-]+$/;

function assertValidVideoVariant(variant) {
  const name = String(variant == null || variant === '' ? DEFAULT_VIDEO_VARIANT : variant).trim();
  if (
    !name
    || name.includes('/')
    || name.includes('\\')
    || name === '.'
    || name === '..'
    || name.includes('..')
    || !VIDEO_VARIANT_PATTERN.test(name)
  ) {
    const error = new Error(`Invalid video variant: ${variant}`);
    error.statusCode = 400;
    throw error;
  }
  return name;
}

function normalizeExcludeIndexes(value) {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const result = [];
  for (const entry of list) {
    const token = String(entry).trim();
    if (!token) continue;
    // Plain decimal digits only: rejects typos ("2l"), floats ("2.5"), and
    // Number() coercions that silently mean something else than typed
    // ("0x1F"→31, "1e2"→100, negatives). Matches the NAS assembler.
    if (!/^\d+$/.test(token)) {
      const error = new Error(`Invalid exclude index: ${token}`);
      error.statusCode = 400;
      throw error;
    }
    result.push(Number(token));
  }
  return result;
}

// A selected image's package-facing staged video lives at videos/<variant>/<index>.mp4
// (index zero-padded to 3 digits). This is package-scoped, unlike the global
// Wan lane completed.txt labels (e.g. "flux-001") which collide across packages.
function stagedMp4RelPath(promptIndex, variant = DEFAULT_VIDEO_VARIANT) {
  return path.posix.join('videos', variant, `${String(promptIndex).padStart(3, '0')}.mp4`);
}

// A staged clip filename: NNN.mp4 (3+ digits — stagedMp4RelPath pads to 3 but a
// 4-digit prompt index produces 4 digits). Case-sensitive on purpose: the
// existence check hits a case-sensitive Linux fs, so accepting `.MP4` here
// would list a variant folder whose clips then never count.
const STAGED_CLIP_NAME = /^\d{3,}\.mp4$/;

// Read a package's selected-images.json selections (shared by the per-variant
// status calls so a multi-variant scan reads the file once, not once per lane —
// packages live on a CIFS mount where every read is a network round-trip).
function readPackageSelections(packageDir) {
  const selected = safeReadJson(path.join(packageDir, 'selected-images.json'), null);
  return selected && Array.isArray(selected.selections) ? selected.selections : [];
}

// One readdir of videos/<variant>/ → Set of staged clip filenames. Includes
// symlinked clips (Dirent.isFile() is false for symlinks, but a symlinked
// NNN.mp4 is a staged clip — NAS pipelines stage via symlink too).
function readVariantClipSet(packageDir, variant) {
  const entries = safeDirEntries(path.join(packageDir, 'videos', variant));
  return new Set(
    entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && STAGED_CLIP_NAME.test(entry.name))
      .map((entry) => entry.name)
  );
}

function packageStagedWanStatus(packageDir, variant = DEFAULT_VIDEO_VARIANT, options = {}) {
  const videoVariant = assertValidVideoVariant(variant);
  const selections = options.selections || readPackageSelections(packageDir);
  const clipSet = options.clipSet || readVariantClipSet(packageDir, videoVariant);
  const items = selections.map((selection) => {
    const promptIndex = selectionPromptIndex(selection);
    const mp4Rel = promptIndex == null ? null : stagedMp4RelPath(promptIndex, videoVariant);
    const mp4Exists = Boolean(mp4Rel && clipSet.has(`${String(promptIndex).padStart(3, '0')}.mp4`));
    return {
      prompt_index: promptIndex,
      label: labelFromSelectedPath(selection.selected_path)
        || (promptIndex != null ? `flux-${String(promptIndex).padStart(3, '0')}` : ''),
      mp4_rel: mp4Rel,
      mp4_exists: mp4Exists,
    };
  });
  const completed = items.filter((item) => item.mp4_exists);
  const pending = items.filter((item) => !item.mp4_exists);
  return {
    videoVariant,
    videoDir: path.posix.join('videos', videoVariant),
    selections: items,
    selectionCount: items.length,
    completed,
    pending,
    completedLabels: completed.map((item) => item.label).filter(Boolean),
    completedCount: completed.length,
    pendingCount: pending.length,
  };
}

// Enumerate videos/<variant>/ folders that contain at least one staged NNN.mp4
// (regular file or symlink), with the clip Set captured so callers can count
// without re-listing the folder.
function listPackageVideoVariantEntries(packageDir) {
  const videosRoot = path.join(packageDir, 'videos');
  return safeDirEntries(videosRoot)
    .filter((entry) => entry.isDirectory() && VIDEO_VARIANT_PATTERN.test(entry.name))
    .map((entry) => ({ name: entry.name, clipSet: readVariantClipSet(packageDir, entry.name) }))
    .filter((variant) => variant.clipSet.size > 0);
}

function listPackageVideoVariants(packageDir) {
  return listPackageVideoVariantEntries(packageDir).map((variant) => variant.name);
}

// Which clip lane the existing Resolve handoff was built from (recorded in
// media-manifest.json by the variant-aware assembler; null for legacy manifests).
function packageHandoffVideoVariant(packageDir) {
  const manifest = safeReadJson(path.join(packageDir, 'resolve-handoff', 'media-manifest.json'), null);
  const variant = manifest && manifest.video_variant ? String(manifest.video_variant) : null;
  return variant && VIDEO_VARIANT_PATTERN.test(variant) ? variant : null;
}

// Variant-aware staged status: check every populated videos/* folder and report
// the one covering the most selections. Ties prefer the legacy mp4 folder so
// existing fast-lane packages keep their exact previous behavior; an HQ-only
// package (the default profile renders to videos/mp4-hq-720p/) is no longer
// reported as "nothing staged". Delivery-lane override: when a Resolve handoff
// exists and its recorded variant covers at least as many selections, report
// THAT lane — review and dashboards should describe what is actually being
// delivered, not the coverage tie-break (a package with 10 fast + 10 HQ clips
// and an HQ handoff must review the HQ clips).
function packageBestStagedWanStatus(packageDir) {
  // One selections read + one readdir per variant folder for the whole scan
  // (this runs per package on every status poll, over CIFS).
  const selections = readPackageSelections(packageDir);
  const variantEntries = listPackageVideoVariantEntries(packageDir);
  const statusFor = (variant) => {
    const entry = variantEntries.find((v) => v.name === variant);
    return packageStagedWanStatus(packageDir, variant, {
      selections,
      clipSet: entry ? entry.clipSet : new Set(),
    });
  };
  let best = statusFor(DEFAULT_VIDEO_VARIANT);
  for (const entry of variantEntries) {
    if (entry.name === DEFAULT_VIDEO_VARIANT) continue;
    const status = statusFor(entry.name);
    if (status.completedCount > best.completedCount) best = status;
  }
  const handoffVariant = packageHandoffVideoVariant(packageDir);
  if (handoffVariant && handoffVariant !== best.videoVariant) {
    const handoffStatus = statusFor(handoffVariant);
    if (handoffStatus.completedCount >= best.completedCount) best = handoffStatus;
  }
  return best;
}

function loadWanRunSummaries(runsDir) {
  return safeDirEntries(runsDir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runLogPath = path.join(runsDir, entry.name, 'run.log');
      const runLog = safeReadJson(runLogPath, null);
      return {
        id: entry.name,
        label: runLog ? runLog.label || '' : '',
        status: runLog ? runLog.status || '' : '',
        runLogExists: Boolean(runLog),
      };
    });
}

function readWanLock(lockPath) {
  if (!fs.existsSync(lockPath)) {
    return { lock_active: false, lock_pid: null, lock_created_at: null };
  }
  const lock = safeReadJson(lockPath, {});
  return {
    lock_active: true,
    lock_pid: lock.pid || null,
    lock_created_at: lock.created_at || lock.createdAt || null,
  };
}

function buildPackagePipelineStatus(packageDir, wanLabels) {
  const id = path.basename(packageDir);
  const selected = safeReadJson(path.join(packageDir, 'selected-images.json'), null);
  const imagePrompts = safeReadJson(path.join(packageDir, 'image-prompts.json'), null);
  const fluxManifestPath = path.join(packageDir, 'flux-generation-manifest.json');
  const resolveHandoffDir = path.join(packageDir, 'resolve-handoff');
  const resolveHandoffCount = RESOLVE_HANDOFF_FILES.filter((filename) => fs.existsSync(path.join(resolveHandoffDir, filename))).length;
  // Which clip lane the existing handoff was actually built from — lets the
  // dashboard distinguish an HQ handoff from a legacy fast one instead of
  // treating them as identical.
  const handoffVideoVariant = packageHandoffVideoVariant(packageDir);
  const promptItems = imagePrompts && Array.isArray(imagePrompts.image_prompts) ? imagePrompts.image_prompts : [];
  const selections = selected && Array.isArray(selected.selections) ? selected.selections : [];
  const videoPrompts = safeReadJson(path.join(packageDir, 'video-prompts.json'), null);
  const videoPromptsCount = videoPrompts && Array.isArray(videoPrompts.prompts) ? videoPrompts.prompts.length : 0;
  // Wan completion is package-scoped: a selection is complete only when its
  // package-facing staged MP4 (videos/<variant>/<index>.mp4) exists. Global Wan
  // lane labels are not package-unique, so they must not drive per-package
  // counts. Variant-aware: an HQ-only package counts via videos/mp4-hq-720p/.
  const staged = packageBestStagedWanStatus(packageDir);
  const completed = staged.completedCount;
  // A staged (completed) selection can never be "failed". Among the not-yet-staged
  // selections, surface a failure only when the Wan lane records that label as failed.
  const failed = staged.pending.filter((item) => item.label && wanLabels.failed.has(item.label)).length;
  const pending = Math.max(0, staged.selectionCount - completed - failed);
  const fluxImagesDir = path.join(packageDir, 'images', 'flux-local');
  const fluxImagesCount = safeDirEntries(fluxImagesDir).filter((entry) => entry.isFile() && /\.png$/i.test(entry.name)).length;
  let wanNextAction = 'No selections found';
  if (!promptItems.length) {
    wanNextAction = 'Create or import image prompts';
  } else if (fluxImagesCount < promptItems.length) {
    wanNextAction = `Generate ${promptItems.length - fluxImagesCount} remaining FLUX images`;
  } else if (!selections.length) {
    wanNextAction = 'Select images for Wan2.2';
  } else if (videoPromptsCount < selections.length) {
    // I2V prompt gate: PRESTO video generation needs one prompt per selected
    // image. Do not urge a PRESTO submit before the prompts exist.
    wanNextAction = videoPromptsCount === 0
      ? 'Generate I2V prompts first (PRESTO Ollama)'
      : `I2V prompts incomplete (${videoPromptsCount}/${selections.length}) — finish prompts first`;
  } else if (pending > 0) {
    wanNextAction = `Submit ${pending} pending selections to PRESTO`;
  } else if (failed > 0) {
    wanNextAction = `Review ${failed} failed Wan selections`;
  } else if (resolveHandoffCount < RESOLVE_HANDOFF_FILES.length) {
    wanNextAction = 'Create Resolve assembly handoff';
  } else {
    wanNextAction = 'Wan selections complete';
  }
  return {
    id,
    has_selections: Boolean(selected),
    selections_count: selections.length,
    prompts_count: promptItems.length,
    video_prompts_count: videoPromptsCount,
    flux_images_count: fluxImagesCount,
    has_flux_manifest: fs.existsSync(fluxManifestPath),
    wan_completed: completed,
    wan_pending: pending,
    wan_failed: failed,
    video_variant: staged.videoVariant,
    resolve_handoff_ready: resolveHandoffCount === RESOLVE_HANDOFF_FILES.length,
    resolve_handoff_count: resolveHandoffCount,
    handoff_video_variant: handoffVideoVariant,
    // Operator status from project-status.json (active/editing/parked/archived/
    // published); null when the package predates the projects lane.
    project_status: (safeReadJson(path.join(packageDir, 'project-status.json'), null) || {}).status || null,
    wan_next_action: wanNextAction,
  };
}

function aigenProductionPipelineStatus(options = {}) {
  const paths = aigenPaths(options);
  const mounted = fs.existsSync(paths.aigenRoot) && fs.existsSync(paths.scriptPackages);
  const generatedAt = new Date().toISOString();
  if (!mounted) {
    return {
      ok: false,
      generated_at: generatedAt,
      vidnas_mounted: false,
      error: `VIDNAS not mounted at ${paths.aigenRoot}`,
      packages: [],
      wan_lane: {
        lock_active: false,
        lock_pid: null,
        lock_created_at: null,
        completed_count: 0,
        failed_count: 0,
        queue_items_count: 0,
        runs_count: 0,
      },
      presto: { reachable: false, queue_empty: null, error: null },
      next_action: 'Mount VIDNAS before checking production pipeline status',
    };
  }

  const completed = parseJsonLines(path.join(paths.wanLane, 'completed.txt'));
  const failed = parseJsonLines(path.join(paths.wanLane, 'failed.jsonl'));
  const queueItems = parseWanQueue(path.join(paths.wanLane, 'queue.txt'));
  const runs = loadWanRunSummaries(path.join(paths.wanLane, 'runs'));
  const wanLabels = {
    completed: new Set(completed.map((item) => String(item.label || '')).filter(Boolean)),
    failed: new Set(failed.map((item) => String(item.label || '')).filter(Boolean)),
  };
  const packageDirs = safeDirEntries(paths.scriptPackages)
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(paths.scriptPackages, entry.name));
  const packages = packageDirs.map((packageDir) => buildPackagePipelineStatus(packageDir, wanLabels));
  // Global next action: the ACTIVE project's state always wins. The previous
  // first-package-with-pending-work scan surfaced stale/abandoned packages
  // ("Generate 2 remaining FLUX images for <old package>") while the actual
  // active project sat at the Resolve handoff — contradicting the canonical
  // orientation strip on the same page.
  const pickPending = (list) => list.find((item) => item.wan_pending > 0) ||
    list.find((item) => item.selections_count === 0 && item.flux_images_count > 0) ||
    list.find((item) => item.flux_images_count < item.prompts_count);
  const activeProjects = packages.filter((item) => item.project_status === 'active' || item.project_status === 'editing');
  const dormant = packages.filter((item) => !activeProjects.includes(item)
    && item.project_status !== 'archived' && item.project_status !== 'published' && item.project_status !== 'parked');
  let nextAction;
  const activePick = pickPending(activeProjects);
  if (activePick) {
    nextAction = `${activePick.wan_next_action} for ${activePick.id}`;
  } else if (activeProjects.length) {
    nextAction = `${activeProjects[0].wan_next_action} for ${activeProjects[0].id}`;
  } else {
    const dormantPick = pickPending(dormant);
    nextAction = dormantPick
      ? `${dormantPick.wan_next_action} for ${dormantPick.id} (no active project)`
      : 'No pending aigen production actions found';
  }
  return {
    ok: true,
    generated_at: generatedAt,
    vidnas_mounted: true,
    packages,
    wan_lane: {
      ...readWanLock(path.join(paths.wanLane, '.wan22-81f.lock')),
      completed_count: completed.length,
      failed_count: failed.length,
      queue_items_count: queueItems.length,
      runs_count: runs.length,
    },
    presto: { reachable: false, queue_empty: null, error: null },
    next_action: nextAction,
  };
}

function getJson(urlString, timeoutMs, callback) {
  let settled = false;
  let request;
  try {
    request = http.get(urlString, { timeout: timeoutMs }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          callback(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          callback(null, JSON.parse(body || '{}'));
        } catch (error) {
          callback(error);
        }
      });
    });
    request.on('timeout', () => {
      if (settled) return;
      settled = true;
      request.destroy();
      callback(new Error(`timeout after ${timeoutMs}ms`));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      callback(error);
    });
  } catch (error) {
    callback(error);
  }
}

function attachPrestoStatus(status, options = {}, callback) {
  const paths = aigenPaths(options);
  if (!paths.prestoBaseUrl) {
    status.presto = { reachable: false, queue_empty: null, error: 'PRESTO base URL not configured' };
    callback(status);
    return;
  }
  const base = paths.prestoBaseUrl.replace(/\/+$/, '');
  const timeoutMs = paths.prestoTimeoutMs;
  getJson(`${base}/system_stats`, timeoutMs, (statsError) => {
    if (statsError) {
      status.presto = { reachable: false, queue_empty: null, error: statsError.message };
      callback(status);
      return;
    }
    getJson(`${base}/queue`, timeoutMs, (queueError, queue) => {
      if (queueError) {
        status.presto = { reachable: true, queue_empty: null, error: queueError.message };
        callback(status);
        return;
      }
      const running = Array.isArray(queue.queue_running) ? queue.queue_running.length : 0;
      const pending = Array.isArray(queue.queue_pending) ? queue.queue_pending.length : 0;
      status.presto = { reachable: true, queue_empty: running === 0 && pending === 0, error: null };
      callback(status);
    });
  });
}

function handleAigenStatus(req, res) {
  const status = aigenProductionPipelineStatus();
  if (!status.ok) {
    sendJSON(res, 200, status);
    return;
  }
  attachPrestoStatus(status, {}, (withPresto) => {
    withPresto.localWriteNonce = LOCAL_WRITE_NONCE;
    withPresto.nonceHeader = LOCAL_WRITE_NONCE_HEADER;
    sendJSON(res, 200, withPresto);
  });
}

function resolveAigenPackageDir(packageId, options = {}) {
  const paths = aigenPaths(options);
  const id = String(packageId || '').trim();
  if (!id) {
    const error = new Error('package_id is required.');
    error.statusCode = 400;
    throw error;
  }
  if (id.includes('/') || id.includes('\\') || id === '.' || id === '..' || id.includes('..')) {
    const error = new Error('Invalid package_id.');
    error.statusCode = 400;
    throw error;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    const error = new Error('Invalid package_id.');
    error.statusCode = 400;
    throw error;
  }
  const packageDir = path.resolve(paths.scriptPackages, id);
  const scriptRoot = path.resolve(paths.scriptPackages);
  if (!packageDir.startsWith(scriptRoot + path.sep)) {
    const error = new Error('Resolved package path is outside script-packages.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    const error = new Error(`Package does not exist: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  return { packageId: id, packageDir, paths };
}

// Record the chosen video variant + which selections were included/excluded in the
// generated media-manifest.json, so the handoff is self-describing about the exact
// clip source folder it drew from. Returns true if the manifest was updated.
function stampManifestVariant(packageDir, info) {
  const manifestPath = path.join(packageDir, 'resolve-handoff', 'media-manifest.json');
  if (!fs.existsSync(manifestPath)) return false;
  const manifest = safeReadJson(manifestPath, null);
  // A manifest we cannot parse as an object is NOT ours to rewrite — stamping
  // over it would replace the assembler's real manifest with a 5-field stub.
  // Leave it alone and report not-stamped.
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  manifest.video_variant = info.video_variant;
  manifest.video_source_folder = info.video_source_folder;
  manifest.included_indexes = info.included_indexes;
  manifest.excluded_indexes = info.excluded_indexes;
  manifest.missing_indexes = info.missing_indexes;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return true;
}

function runResolveAssemblyCreate(packageId, options = {}) {
  // Validate the requested variant BEFORE touching the filesystem so path
  // traversal (e.g. "../../etc") is rejected up front with a 400.
  const variant = assertValidVideoVariant(options.videoVariant);
  const dryRun = Boolean(options.dryRun);
  const excludeIndexes = normalizeExcludeIndexes(options.excludeIndexes);
  const { packageId: id, packageDir, paths } = resolveAigenPackageDir(packageId, options);

  const videoDir = path.posix.join('videos', variant);
  const staged = packageStagedWanStatus(packageDir, variant);
  // Inclusion/exclusion mirrors the NAS assembler exactly: an explicitly
  // excluded index is excluded whether or not its clip exists in the variant
  // folder (excluded > staged), so the manifest fields Node stamps can never
  // disagree with the ones the assembler writes.
  const excludedClips = staged.selections.filter((item) => excludeIndexes.includes(item.prompt_index));
  const includedClips = staged.completed.filter((item) => !excludeIndexes.includes(item.prompt_index));
  const missingClips = staged.pending.filter((item) => !excludeIndexes.includes(item.prompt_index));
  const includedIndexes = includedClips.map((item) => item.prompt_index);
  const excludedIndexes = excludedClips.map((item) => item.prompt_index);

  // Dry-run: enumerate exactly which clips the handoff would include from the
  // chosen variant folder, and never spawn Python or write any handoff file.
  if (dryRun) {
    return Promise.resolve({
      ok: true,
      dry_run: true,
      wrote: false,
      package_id: id,
      video_variant: variant,
      video_dir: videoDir,
      selection_count: staged.selectionCount,
      included_count: includedClips.length,
      included_clips: includedClips,
      missing_clips: missingClips,
      excluded_clips: excludedClips,
      would_write: RESOLVE_HANDOFF_FILES,
      output_dir: path.join(packageDir, 'resolve-handoff'),
    });
  }

  // Real run — the safety gate is variant-aware and never silently assembles a
  // partial handoff. It refuses if any selected image lacks a clip in the chosen
  // variant folder UNLESS that index was explicitly excluded by the operator, so
  // the fast videos/mp4/ clips can never be silently substituted for a missing
  // HQ clip.
  if (staged.selectionCount === 0) {
    return Promise.resolve({
      ok: false,
      package_id: id,
      video_variant: variant,
      video_dir: videoDir,
      error: 'No selected images found; cannot create Resolve assembly.',
      exit_code: 1,
    });
  }
  if (missingClips.length > 0) {
    const missing = missingClips.map((item) => item.mp4_rel || `selection ${item.prompt_index}`);
    return Promise.resolve({
      ok: false,
      package_id: id,
      video_variant: variant,
      video_dir: videoDir,
      error: `Resolve assembly blocked: ${missingClips.length} selected image(s) have no staged MP4 in ${videoDir}/ (${missing.join(', ')}). Render them, or pass exclude_indexes to omit them explicitly.`,
      pending_count: missingClips.length,
      missing_mp4: missing,
      missing_indexes: missingClips.map((item) => item.prompt_index),
      exit_code: 1,
    });
  }
  if (!fs.existsSync(paths.topicToPackageScript)) {
    return Promise.resolve({
      ok: false,
      package_id: id,
      video_variant: variant,
      error: `Resolve assembly script not found: ${paths.topicToPackageScript}`,
      exit_code: 127,
    });
  }
  const args = [
    paths.topicToPackageScript,
    'resolve-assembly-handoff',
    '--package',
    packageDir,
    '--force',
  ];
  // Only pass --video-variant for a non-default variant, so the legacy fast-clip
  // path stays byte-identical to previous behavior (and older assemblers that do
  // not know the flag keep working for the default).
  if (variant !== DEFAULT_VIDEO_VARIANT) {
    args.push('--video-variant', variant);
  }
  // Forward explicitly-excluded indexes so the assembler omits them from the
  // manifest and records them as excluded (never silently included).
  if (excludedIndexes.length > 0) {
    args.push('--exclude', excludedIndexes.join(','));
  }
  return new Promise((resolve) => {
    const child = childProcess.spawn(paths.pythonBin, args, {
      cwd: paths.aigenRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      resolve({
        ok: false,
        package_id: id,
        video_variant: variant,
        error: error.message,
        exit_code: 1,
        stdout,
        stderr,
      });
    });
    child.on('close', (code) => {
      if (code === 0) {
        const resolveDir = path.join(packageDir, 'resolve-handoff');
        const existingFiles = RESOLVE_HANDOFF_FILES.filter((filename) => fs.existsSync(path.join(resolveDir, filename)));
        // The re-stamp is belt-and-braces: the assembler already writes the
        // variant fields itself. If the re-stamp fails AFTER the handoff files
        // were written, reporting ok:false would be a lie (half-commit: the
        // operator sees an error while readiness sees the files). Report
        // success with an explicit warning instead.
        let manifestVariantRecorded = false;
        let stampWarning = null;
        try {
          manifestVariantRecorded = stampManifestVariant(packageDir, {
            video_variant: variant,
            video_source_folder: videoDir,
            included_indexes: includedIndexes,
            excluded_indexes: excludedIndexes,
            missing_indexes: [], // a real run only reaches here with no un-excluded missing clips
          });
        } catch (error) {
          stampWarning = `Handoff files were written, but re-stamping media-manifest.json failed: ${error.message}. `
            + 'The assembler records the variant fields itself; verify media-manifest.json manually.';
        }
        resolve({
          ok: true,
          package_id: id,
          video_variant: variant,
          video_dir: videoDir,
          files: RESOLVE_HANDOFF_FILES,
          existing_files: existingFiles,
          included_indexes: includedIndexes,
          excluded_indexes: excludedIndexes,
          manifest_variant_recorded: manifestVariantRecorded,
          warning: stampWarning,
          output_dir: resolveDir,
          stdout,
          stderr,
        });
        return;
      }
      resolve({
        ok: false,
        package_id: id,
        video_variant: variant,
        error: (stderr || stdout || `resolve-assembly-handoff exited with code ${code}`).trim(),
        exit_code: code,
        stdout,
        stderr,
      });
    });
  });
}

function handleAigenResolveAssemblyCreate(req, res) {
  readJsonBody(req)
    .then((payload) => {
      const dryRun = Boolean(payload.dry_run || payload.dryRun);
      // A dry-run only inspects/enumerates and writes nothing, so it does not
      // require the local-write nonce. A real create still does.
      if (!dryRun) {
        validateLocalWriteRequest(req, payload, { label: 'Resolve assembly create API' });
      }
      return runResolveAssemblyCreate(payload.package_id, {
        videoVariant: payload.video_variant || payload.videoVariant,
        dryRun,
        excludeIndexes: payload.exclude_indexes || payload.excludeIndexes,
      });
    })
    .then((result) => {
      if (result.ok) {
        sendJSON(res, 200, result);
      } else {
        sendError(res, result.statusCode || 400, result.error || 'Operation failed', null);
      }
    })
    .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
}

function fluxIndexFromFilename(filename = '') {
  const match = String(filename).match(/^flux-(\d+)\.png$/i);
  return match ? Number(match[1]) : null;
}

function loadImagePromptsByIndex(packageDir) {
  const promptData = safeReadJson(path.join(packageDir, 'image-prompts.json'), {});
  const prompts = promptData && Array.isArray(promptData.image_prompts) ? promptData.image_prompts : [];
  return prompts.reduce((result, item) => {
    if (!item || typeof item !== 'object') return result;
    let index = item.index == null ? item.prompt_index : item.index;
    if (typeof index === 'string' && /^\d+$/.test(index)) index = Number(index);
    if (Number.isInteger(index) && item.prompt) result.set(index, String(item.prompt));
    return result;
  }, new Map());
}

function imagePromptsPathForPackage(packageDir) {
  const target = path.resolve(packageDir, 'image-prompts.json');
  const packageRoot = path.resolve(packageDir);
  if (target !== path.join(packageRoot, 'image-prompts.json')) {
    const error = new Error('Resolved image-prompts.json path is invalid.');
    error.statusCode = 400;
    throw error;
  }
  if (!target.startsWith(packageRoot + path.sep)) {
    const error = new Error('Resolved image-prompts.json path is outside package.');
    error.statusCode = 400;
    throw error;
  }
  return target;
}

function normalizeImagePromptsModel(input) {
  const source = input == null ? { image_prompts: [] } : input;
  let wrapper = 'image_prompts';
  let prompts = [];
  let passthrough = {};
  if (Array.isArray(source)) {
    wrapper = 'array';
    prompts = source;
  } else if (source && typeof source === 'object') {
    passthrough = { ...source };
    if (Array.isArray(source.image_prompts)) {
      wrapper = 'image_prompts';
      prompts = source.image_prompts;
    } else if (Array.isArray(source.prompts)) {
      wrapper = 'prompts';
      prompts = source.prompts;
    } else {
      prompts = [];
    }
  } else {
    const error = new Error('image-prompts model must be an array or object wrapper.');
    error.statusCode = 400;
    throw error;
  }
  return {
    wrapper,
    passthrough,
    prompts: prompts.map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? { ...item } : item)),
  };
}

function readImagePrompts(packageId, options = {}) {
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, options);
  const filePath = imagePromptsPathForPackage(packageDir);
  const exists = fs.existsSync(filePath);
  let parsed = { image_prompts: [] };
  let stat = null;
  if (exists) {
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_e) {
      const error = new Error('image-prompts.json is not valid JSON. Fix the file or re-save from the editor.');
      error.statusCode = 400;
      throw error;
    }
    stat = fs.statSync(filePath);
  }
  const model = normalizeImagePromptsModel(parsed);
  return {
    ok: true,
    package_id: id,
    exists,
    path: filePath,
    modified_at: stat ? stat.mtime.toISOString() : null,
    size_bytes: stat ? stat.size : 0,
    wrapper: model.wrapper,
    prompts: model.prompts,
    model: model.wrapper === 'array' ? model.prompts : { ...model.passthrough, [model.wrapper]: model.prompts },
    count: model.prompts.length,
  };
}

function promptIndexValue(item) {
  if (!item || typeof item !== 'object') return null;
  const value = item.index == null ? item.prompt_index : item.index;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return Number.isInteger(value) ? value : null;
}

function validateImagePromptsPayload(payload = {}) {
  let model;
  try {
    if (Array.isArray(payload)) {
      model = normalizeImagePromptsModel(payload);
    } else if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'model')) {
      model = normalizeImagePromptsModel(payload.model);
    } else if (payload && typeof payload === 'object' && Array.isArray(payload.prompts)) {
      model = normalizeImagePromptsModel({ image_prompts: payload.prompts });
    } else {
      model = normalizeImagePromptsModel(payload);
    }
  } catch (error) {
    return {
      ok: true,
      valid: false,
      errors: [{ field: 'model', message: error.message }],
      warnings: [],
      count: 0,
      prompts: [],
      model: { image_prompts: [] },
    };
  }

  const errors = [];
  const warnings = [];
  const indexCounts = new Map();
  const prompts = model.prompts;
  if (!Array.isArray(prompts)) {
    errors.push({ field: 'image_prompts', message: 'Prompt list must be an array.' });
  }
  prompts.forEach((item, row) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ row, field: 'item', message: 'Prompt item must be an object.' });
      return;
    }
    const index = promptIndexValue(item);
    if (!Number.isInteger(index) || index <= 0) {
      errors.push({ row, field: 'index', message: 'index must be a positive integer.' });
    } else {
      indexCounts.set(index, (indexCounts.get(index) || 0) + 1);
    }
    const promptText = String(item.prompt == null ? '' : item.prompt).trim();
    if (!promptText) {
      errors.push({ row, field: 'prompt', message: 'prompt is required.' });
    } else if (promptText.length < 40) {
      warnings.push({ row, field: 'prompt', message: 'Prompt is very short.' });
    } else if (promptText.length > 1200) {
      warnings.push({ row, field: 'prompt', message: 'Prompt is suspiciously long.' });
    }
    if (!String(item.category == null ? '' : item.category).trim()) {
      warnings.push({ row, field: 'category', message: 'Category is empty.' });
    }
  });
  [...indexCounts.entries()].filter(([, count]) => count > 1).forEach(([index]) => {
    errors.push({ field: 'index', index, message: `Duplicate index: ${index}` });
  });
  const sortedIndexes = [...indexCounts.keys()].sort((a, b) => a - b);
  if (sortedIndexes.length) {
    const sequential = sortedIndexes.every((index, position) => index === position + 1);
    if (!sequential) warnings.push({ field: 'index', message: 'Indexes are non-sequential.' });
  }
  const outputModel = model.wrapper === 'array'
    ? prompts
    : { ...model.passthrough, [model.wrapper === 'prompts' ? 'prompts' : 'image_prompts']: prompts };
  return {
    ok: true,
    valid: errors.length === 0,
    errors,
    warnings,
    count: prompts.length,
    prompts,
    wrapper: model.wrapper,
    model: outputModel,
  };
}

function validateImagePromptsForPackage(payload = {}, options = {}) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'package_id')) {
    resolveAigenPackageDir(payload.package_id, options);
  }
  return validateImagePromptsPayload(payload);
}

function saveImagePrompts(payload = {}, options = {}) {
  const { packageId: id, packageDir } = resolveAigenPackageDir(payload.package_id, options);
  const filePath = imagePromptsPathForPackage(packageDir);
  const scriptRoot = path.resolve(aigenPaths(options).scriptPackages);
  if (!filePath.startsWith(scriptRoot + path.sep) || path.basename(filePath) !== 'image-prompts.json') {
    const error = new Error('Refusing to write outside script-packages image-prompts.json.');
    error.statusCode = 400;
    throw error;
  }
  const validation = validateImagePromptsPayload(payload);
  if (!validation.valid) {
    const error = new Error('image-prompts validation failed.');
    error.statusCode = 400;
    error.validation = validation;
    throw error;
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(validation.model, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
  const stat = fs.statSync(filePath);
  console.log(`[image-prompts] ${id}: wrote ${validation.count} prompts to ${filePath}`);
  return {
    ok: true,
    package_id: id,
    written_to: filePath,
    count: validation.count,
    modified_at: stat.mtime.toISOString(),
    warnings: validation.warnings,
  };
}

function selectedIndicesFromData(data) {
  const selections = Array.isArray(data) ? data : data && Array.isArray(data.selections) ? data.selections : [];
  return selections
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      let index = item.index == null ? item.prompt_index : item.index;
      if (!index && (item.path || item.selected_path)) {
        index = fluxIndexFromFilename(path.basename(String(item.path || item.selected_path)));
      }
      if (typeof index === 'string' && /^\d+$/.test(index)) index = Number(index);
      return Number.isInteger(index) ? index : null;
    })
    .filter((index) => index !== null);
}

function aigenAssetPath(packageId, relativePath, options = {}) {
  const { packageDir } = resolveAigenPackageDir(packageId, options);
  const cleanRelative = String(relativePath || '').replace(/\\/g, '/');
  if (!cleanRelative || cleanRelative.split('/').some((part) => part === '..' || part === '' || part.startsWith('.'))) {
    const error = new Error('Invalid asset path.');
    error.statusCode = 400;
    throw error;
  }
  const resolved = path.resolve(packageDir, cleanRelative);
  if (!resolved.startsWith(path.resolve(packageDir) + path.sep)) {
    const error = new Error('Asset path resolves outside package.');
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

function listFluxImages(packageId, options = {}) {
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, options);
  const promptsByIndex = loadImagePromptsByIndex(packageDir);
  const selectedData = safeReadJson(path.join(packageDir, 'selected-images.json'), null);
  const selected = selectedData ? selectedIndicesFromData(selectedData) : [];
  const evidence = packageMediaIndex.buildImageEvidence(packageDir);
  // One entry per slot index, drawn from BOTH namespaces so a manual upload
  // still appears in the selector. manual-upload wins the slot when present
  // (server-side occupancy already prevents both from coexisting for a slot).
  const byIndex = new Map();
  const addFrom = (subdir, re, preferred) => {
    const dir = path.join(packageDir, ...subdir.split('/'));
    safeDirEntries(dir)
      .filter((entry) => entry.isFile() && re.test(entry.name))
      .forEach((entry) => {
        const index = packageMediaIndex.promptIndexFromName(entry.name);
        if (index == null) return;
        if (byIndex.has(index) && !preferred) return; // don't override a preferred-namespace slot
        const relative = `${subdir}/${entry.name}`;
        const absolute = path.join(dir, entry.name);
        let sizeBytes = 0;
        try { sizeBytes = fs.statSync(absolute).size; } catch (_) {}
        byIndex.set(index, {
          index,
          path: relative,
          absolute_path: absolute,
          asset_url: `${AIGEN_ASSETS_PREFIX}script-packages/${encodeURIComponent(id)}/${relative.split('/').map(encodeURIComponent).join('/')}`,
          prompt: promptsByIndex.get(index) || '',
          label: path.basename(entry.name, path.extname(entry.name)),
          source_type: packageMediaIndex.classifyImageSource(relative, evidence),
          exists: fs.existsSync(absolute),
          size_bytes: sizeBytes,
        });
      });
  };
  addFrom('images/manual-upload', /^manual-\d+\.(png|jpe?g)$/i, true);
  addFrom('images/flux-local', /^flux-\d+\.png$/i, false);
  const images = [...byIndex.values()].sort((a, b) => a.index - b.index);
  return {
    ok: true,
    package_id: id,
    images,
    selected,
    total: images.length,
    selected_count: selected.length,
  };
}

function selectedLabel(index, labels) {
  return labels ? `selected-img-${String(index).padStart(3, '0')}` : `flux-${String(index).padStart(3, '0')}`;
}

function writeSelectedImages(payload = {}, options = {}) {
  if (!Array.isArray(payload.selected_indices)) {
    const error = new Error('selected_indices must be an array.');
    error.statusCode = 400;
    throw error;
  }
  const selectedIndices = payload.selected_indices.map((index) => Number(index));
  if (selectedIndices.some((index) => !Number.isInteger(index) || index <= 0)) {
    const error = new Error('selected_indices must contain only positive integer indices.');
    error.statusCode = 400;
    throw error;
  }
  const { packageId: id, packageDir } = resolveAigenPackageDir(payload.package_id, options);
  const promptsByIndex = loadImagePromptsByIndex(packageDir);
  const sidecar = readSidecar(packageDir);
  const manualImages = new Map(
    (Array.isArray(sidecar.images) ? sidecar.images : []).map((entry) => [entry.path, entry])
  );
  const uniqueIndices = [...new Set(selectedIndices)];
  const selectedAt = new Date().toISOString();
  const evidence = packageMediaIndex.buildImageEvidence(packageDir);
  const selections = uniqueIndices.map((index) => {
    // Resolve the slot from EITHER namespace (truthful manual-upload first, then
    // legacy/generated flux-local) so a manual upload is selectable and carries
    // its real path + provenance downstream — never a fabricated flux-local one.
    const resolved = resolveSlotImage(packageDir, index, evidence);
    if (!resolved) {
      const error = new Error(`Selected image does not exist for index ${index}.`);
      error.statusCode = 400; error.code = 'SOURCE_FILE_MISSING';
      throw error;
    }
    const sourceType = resolved.source_type;
    const isManual = sourceType === 'manual_upload';
    const manual = manualImages.get(resolved.rel);
    const selectedSource = isManual ? 'manual-upload' : (sourceType === 'legacy_unknown' ? 'legacy-unknown' : 'flux-local');
    return {
      prompt_index: index,
      index,
      source_type: sourceType,
      selected_source: selectedSource,
      selected_path: resolved.rel,
      path: resolved.rel,
      prompt: promptsByIndex.get(index) || '',
      label: selectedLabel(index, Boolean(payload.labels)),
      generator: isManual
        ? ((manual && manual.generation_provider) || 'operator_upload')
        : (sourceType === 'legacy_unknown' ? 'legacy-unknown' : 'flux-local-vidnux'),
      ...(manual ? {
        provenance: {
          source_type: 'manual_upload',
          generation_mode: manual.generation_mode,
          generation_provider: manual.generation_provider,
          generation_host: manual.generation_host,
          source: 'external-media-manifest',
        },
      } : {}),
      selected_at: selectedAt,
    };
  });
  const selectedPath = path.join(packageDir, 'selected-images.json');
  const overwrotePrevious = fs.existsSync(selectedPath);
  const output = {
    version: 1,
    package: `script-packages/${id}`,
    updated_at: selectedAt,
    label_mode: payload.labels ? 'selected-img' : 'flux',
    selections,
  };
  const tmpPath = `${selectedPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, selectedPath);
  console.log(`[image-selector] ${id}: wrote ${selections.length} selections to ${selectedPath}`);
  return {
    ok: true,
    package_id: id,
    written_to: selectedPath,
    selected_count: selections.length,
    overwrote_previous: overwrotePrevious,
  };
}

function handleAigenFluxImages(req, res, url) {
  const packageId = decodeURIComponent(url.pathname.slice(AIGEN_FLUX_IMAGES_API_PREFIX.length));
  try {
    sendJSON(res, 200, listFluxImages(packageId));
  } catch (error) {
    sendError(res, error.statusCode === 404 ? 400 : error.statusCode || 500, error.message, null);
  }
}

function handleAigenSelectedImages(req, res) {
  readJsonBody(req)
    .then((payload) => {
      validateLocalWriteRequest(req, payload);
      const result = writeSelectedImages(payload);
      sendJSON(res, 200, result);
    })
    .catch((error) => sendError(res, error.statusCode === 404 ? 400 : error.statusCode || 500, error.message, null));
}

function handleImagePromptsRead(req, res, url) {
  try {
    sendJSON(res, 200, readImagePrompts(url.searchParams.get('package_id')));
  } catch (error) {
    sendError(res, error.statusCode === 404 ? 400 : error.statusCode || 500, error.message, null);
  }
}

function handleImagePromptsValidate(req, res) {
  readJsonBody(req)
    .then((payload) => sendJSON(res, 200, validateImagePromptsForPackage(payload)))
    .catch((error) => sendError(res, error.statusCode === 404 ? 400 : error.statusCode || 500, error.message, null));
}

function handleImagePromptsSave(req, res) {
  readJsonBody(req)
    .then((payload) => {
      validateLocalWriteRequest(req, payload);
      const result = saveImagePrompts(payload);
      sendJSON(res, 200, result);
    })
    .catch((error) => {
      if (error.validation) {
        sendError(res, error.statusCode || 400, error.message, null, { validation: error.validation });
        return;
      }
      sendError(res, error.statusCode === 404 ? 400 : error.statusCode || 500, error.message, null);
    });
}

function handleAigenAsset(req, res, url, options = {}) {
  const raw = decodeURIComponent(url.pathname.slice(AIGEN_ASSETS_PREFIX.length));
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part.startsWith('.'))) {
    send(res, 403, 'Forbidden');
    return;
  }
  // Resolve through the same env-overridable roots as every other aigen route
  // (aigenPaths), not the hard-coded VIDNAS constant, so fixture/test roots can
  // serve media. URL shapes: "script-packages/<pkg>/<rel>" maps onto the
  // configured script-packages root (which may be overridden independently of
  // the aigen root); any other path resolves under the aigen root. With no env
  // overrides both resolve exactly as before.
  const paths = aigenPaths(options);
  let root;
  let relative;
  if (parts[0] === 'script-packages') {
    root = path.resolve(paths.scriptPackages);
    relative = parts.slice(1).join('/');
  } else {
    root = path.resolve(paths.aigenRoot);
    relative = parts.join('/');
  }
  const assetPath = path.resolve(root, relative);
  if (!assetPath.startsWith(root + path.sep)) {
    send(res, 403, 'Forbidden');
    return;
  }
  fs.stat(assetPath, (err, stats) => {
    if (err || !stats.isFile()) {
      send(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': inferMime(assetPath), 'Cache-Control': 'public, max-age=300' });
    fs.createReadStream(assetPath).pipe(res);
  });
}

function appendCappedOutput(current, chunk) {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') <= PRESTO_OUTPUT_LIMIT_BYTES) return next;
  return Buffer.from(next, 'utf8').subarray(-PRESTO_OUTPUT_LIMIT_BYTES).toString('utf8');
}

function tailOutput(value, byteLimit = PRESTO_OUTPUT_TAIL_BYTES) {
  return Buffer.from(String(value || ''), 'utf8').subarray(-byteLimit).toString('utf8');
}

function prestoRunningSeconds(job, now = Date.now()) {
  const started = Date.parse(job.startedAt);
  const ended = job.completedAt ? Date.parse(job.completedAt) : now;
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0;
  return Math.max(0, Math.floor((ended - started) / 1000));
}

function serializePrestoJob(job, running, now = Date.now()) {
  if (!job) return null;
  const elapsed = prestoRunningSeconds(job, now);
  // ETA: Wan2.2 81-frame render typically takes ~717s (12 min)
  const WAN_81F_TYPICAL_SECONDS = 717;
  const etaSeconds = running ? Math.max(0, WAN_81F_TYPICAL_SECONDS - elapsed) : 0;
  const etaPct = Math.min(100, Math.round((elapsed / WAN_81F_TYPICAL_SECONDS) * 100));
  return {
    running,
    package_id: job.packageId,
    comfyui_url: job.comfyuiUrl,
    started_at: job.startedAt,
    completed_at: job.completedAt || null,
    running_seconds: elapsed,
    eta_seconds: etaSeconds,
    progress_pct: etaPct,
    eta_label: running ? formatEta(etaSeconds) : 'Done',
    exit_code: job.exitCode == null ? null : job.exitCode,
    signal: job.signal || null,
    stdout_tail: tailOutput(job.stdout),
    stderr_tail: tailOutput(job.stderr),
    compute_receipt: job.compute_receipt || null,
  };
}

function formatEta(seconds) {
  if (seconds <= 0) return 'Done';
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function currentPrestoJobStatus(now = Date.now()) {
  const job = PRESTO_STATE.activeJob;
  if (!job) {
    return { ok: true, active: null, completed: null };
  }
  if (!job.completedAt) {
    return { ok: true, active: serializePrestoJob(job, true, now), completed: null };
  }
  const completedAt = Date.parse(job.completedAt);
  if (Number.isFinite(completedAt) && now - completedAt <= PRESTO_COMPLETED_TTL_MS) {
    return { ok: true, active: null, completed: serializePrestoJob(job, false, now) };
  }
  PRESTO_STATE.activeJob = null;
  return { ok: true, active: null, completed: null };
}

const PRESTO_REACHABILITY_TIMEOUT_MS = 4000;

// Pre-flight reachability probe for the PRESTO ComfyUI endpoint. A quick GET /system_stats
// turns a dead worker into an immediate, clear 503 instead of a spawned job that silently
// times out. Read-only — it does not touch PRESTO or ComfyUI config. Injectable for tests.
async function prestoComfyuiReachable(comfyuiUrl, options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return true; // no fetch available → don't block submission on the probe
  const base = String(comfyuiUrl || '').replace(/\/+$/, '');
  if (!base) return false;
  try {
    const res = await fetchImpl(`${base}/system_stats`, {
      method: 'GET',
      signal: AbortSignal.timeout(PRESTO_REACHABILITY_TIMEOUT_MS),
    });
    return !!(res && res.ok);
  } catch (_error) {
    return false;
  }
}

// Selectable I2V generation profiles (authoritative settings live in the AIGEN
// image-to-video/profiles.json; run-production.py reads them). The cockpit only
// needs the allowed names + the recommended default. HQ is the recommended lane
// (no LightX2V, cfg4, 720x1280, 4s+) proven to remove hallucinated people.
const PRESTO_PROFILES = ['fast_current', 'wan22_hq_720p_5s_no_lightx2v'];
const DEFAULT_PRESTO_PROFILE = 'wan22_hq_720p_5s_no_lightx2v';
// Staging folder per profile (mirror of output_subdir in the AIGEN
// image-to-video/profiles.json — keep in sync when adding a profile).
const PRESTO_PROFILE_OUTPUT_SUBDIRS = {
  fast_current: 'mp4',
  wan22_hq_720p_5s_no_lightx2v: 'mp4-hq-720p',
};

function normalizePrestoProfile(value) {
  const v = String(value || '').trim();
  return PRESTO_PROFILES.includes(v) ? v : DEFAULT_PRESTO_PROFILE;
}

function validatePrestoSubmitPayload(payload = {}, options = {}) {
  const { packageId, paths } = resolveAigenPackageDir(payload.package_id, options);
  const productionScript = options.productionScript || paths.productionScript;
  if (!fs.existsSync(productionScript)) {
    const error = new Error(`Production script not found: ${productionScript}`);
    error.statusCode = 400;
    throw error;
  }
  return {
    packageId,
    productionScript,
    pythonBin: options.pythonBin || paths.pythonBin,
    comfyuiUrl: String(payload.comfyui_url || paths.prestoBaseUrl || PRESTO_STATE.defaultUrl).trim(),
    profile: normalizePrestoProfile(payload.profile),
  };
}

function startPrestoPackageJob(payload = {}, options = {}) {
  const current = currentPrestoJobStatus();
  if (current.active) {
    const error = new Error('Job already active');
    error.statusCode = 409;
    error.active = current.active;
    throw error;
  }
  const config = validatePrestoSubmitPayload(payload, options);
  // Authoritative eligibility re-check INSIDE the locked check-and-spawn boundary
  // (single-threaded: no await between the lock check above and the synchronous
  // spawn below, so this is atomic against a concurrent submit). Protects every
  // caller — not just the HTTP handler — from spawning a render for a package
  // with no renderable work.
  const eligibility = evaluatePrestoSubmitEligibility(config.packageId, { ...options, profile: config.profile });
  if (!eligibility.ok) {
    const error = new Error(eligibility.message);
    error.statusCode = prestoEligibilityStatus(eligibility.code);
    error.code = eligibility.code;
    throw error;
  }
  return launchPrestoProductionJob({
    productionScript: config.productionScript,
    pythonBin: config.pythonBin,
    packageArg: config.packageId,
    packageId: config.packageId,
    profile: config.profile,
    comfyuiUrl: config.comfyuiUrl,
    computeReceipt: options.computeReceipt || null,
  }, payload, options);
}

// Shared PRESTO Wan2.2 spawn + job tracking. Callers MUST check
// currentPrestoJobStatus() first (single-GPU lock). config.packageArg is the
// literal --package value (absolute dir for Super Focus, or a script-packages
// id for the aigen lane). Sets PRESTO_STATE.activeJob.
function launchPrestoProductionJob(config, payload = {}, options = {}) {
  // Default must clear the HQ profile's per-clip runtime with real margin:
  // measured HQ render = 54m51s, so 3600 left only ~5 min of headroom and a
  // slow clip would be killed at minute 60 after wasting the whole render.
  const prestoTimeoutSeconds = Number(config.timeoutSeconds) > 0
    ? Math.floor(Number(config.timeoutSeconds))
    : (Number(process.env.AIGEN_PRESTO_TIMEOUT_SECONDS) > 0
      ? Math.floor(Number(process.env.AIGEN_PRESTO_TIMEOUT_SECONDS))
      : 5400);
  const args = [
    config.productionScript,
    '--package',
    config.packageArg,
    '--profile',
    config.profile,
    '--comfyui-url',
    config.comfyuiUrl,
    '--timeout',
    String(prestoTimeoutSeconds),
  ];
  if (Array.isArray(config.indexes) && config.indexes.length) {
    args.push('--indexes', config.indexes.join(','));
  }
  if (Number(config.limit) > 0) args.push('--limit', String(config.limit));
  const genEnv = workflowGenerationEnv(payload);
  const spawnFn = options.spawn || childProcess.spawn;
  const child = spawnFn(config.pythonBin, args, {
    cwd: path.dirname(config.productionScript),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...genEnv.env },
  });
  const job = {
    process: child,
    job_id: `pjob-${crypto.randomBytes(4).toString('hex')}`,
    packageId: config.packageId,
    lane: config.lane || 'aigen',
    comfyuiUrl: config.comfyuiUrl,
    profile: config.profile,
    workflowPath: genEnv.workflowPath,
    orientation: genEnv.orientation,
    targetResolution: genEnv.targetResolution,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
  };
  // Finalize + record the compute dispatch receipt (if this dispatch was
  // compute-gated). Dynamic provenance is stamped here: the job id, the spawn
  // timestamp, the canonical workflow hash, and a hash binding to the exact
  // dispatch inputs. Durable write is best-effort and never fails the spawn.
  if (config.computeReceipt) {
    const receipt = config.computeReceipt;
    receipt.job_id = job.job_id;
    receipt.dispatch_timestamp = job.startedAt;
    receipt.workflow_hash = sha256FileSafe(genEnv.workflowPath);
    // Durable package-dir write is the AIGEN lane's provenance artifact. The
    // Super Focus lane keys packageArg to a media dir (not an AIGEN package) and
    // carries its own render provenance (video-attempts.json + the compute
    // receipt on the queue item), so it does not write here.
    if (config.lane !== 'super-focus') {
      try {
        const { packageDir } = resolveAigenPackageDir(config.packageId, options);
        receipt.inputs_hash = hashDispatchInputs(packageDir);
        receipt.receipt_path = persistDispatchReceipt(packageDir, receipt);
      } catch (_) {
        // Unresolved package dir → keep the in-memory receipt only.
      }
    }
    job.compute_receipt = receipt;
  }
  PRESTO_STATE.activeJob = job;
  if (child.stdout && child.stdout.on) {
    child.stdout.on('data', (chunk) => { job.stdout = appendCappedOutput(job.stdout, chunk); });
  }
  if (child.stderr && child.stderr.on) {
    child.stderr.on('data', (chunk) => { job.stderr = appendCappedOutput(job.stderr, chunk); });
  }
  child.on('error', (error) => {
    job.stderr = appendCappedOutput(job.stderr, `${error.message}\n`);
    job.exitCode = 1;
    job.completedAt = job.completedAt || new Date().toISOString();
  });
  child.on('close', (code, signal) => {
    job.exitCode = code;
    job.signal = signal || null;
    job.completedAt = job.completedAt || new Date().toISOString();
  });
  return {
    ok: true,
    job_started: true,
    job_id: job.job_id,
    package_id: config.packageId,
    comfyui_url: config.comfyuiUrl,
    profile: config.profile,
    compute_receipt: job.compute_receipt || null,
  };
}

// Start a Super Focus video batch: dispatch run-production.py against the
// project's VIDNAS media dir (which already holds the stills + materialized
// selected-images.json / video-prompts.json). Reuses the single PRESTO lock.
// No PRESTO auto-start; a dead worker surfaces as the caller's 503.
function startSuperFocusVideoJob(mediaDir, options = {}) {
  const current = currentPrestoJobStatus();
  if (current.active) {
    const error = new Error('A PRESTO video job is already running. Wait for it to finish.');
    error.statusCode = 409;
    error.active = current.active;
    throw error;
  }
  const productionScript = options.productionScript || process.env.SUPER_FOCUS_PRODUCTION_SCRIPT || PRESTO_STATE.productionScript;
  if (!fs.existsSync(productionScript)) {
    const error = new Error(`PRESTO run-production.py not found: ${productionScript}`);
    error.statusCode = 500;
    throw error;
  }
  return launchPrestoProductionJob({
    productionScript,
    pythonBin: options.pythonBin || process.env.SUPER_FOCUS_PYTHON_BIN || 'python3',
    packageArg: mediaDir,
    packageId: options.projectId || mediaDir,
    profile: normalizePrestoProfile(options.profile),
    comfyuiUrl: options.comfyuiUrl || PRESTO_STATE.defaultUrl,
    indexes: options.indexes,
    limit: options.limit,
    lane: 'super-focus',
    computeReceipt: options.computeReceipt || null,
  }, options.payload || {}, options);
}

// ── Super Focus PRESTO video QUEUE (single worker, multi-item) ───────────────
// Execution stays single-worker (one PRESTO Wan2.2 render at a time); queueing
// is multi-item. Queue is persisted to <mediaDir>/video-queue.json and drained
// sequentially by pumpSuperFocusVideoQueue (event-driven on job close, plus
// idempotent poll-driven advance for restart safety). Slot-safe: never starts a
// render for a row that already has a video or lost its prerequisites.

function superFocusVideoSubdir() {
  return PRESTO_PROFILE_OUTPUT_SUBDIRS[DEFAULT_PRESTO_PROFILE] || 'mp4';
}

function i2vTextHash(row) {
  // Canonical: same hash the media layer records/compares (never a local variant).
  return superFocusMedia.i2vPromptHash(row && row.i2v_prompt && row.i2v_prompt.text);
}

function videoQueueSummary(queue) {
  const s = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, skipped: 0, interrupted: 0, stopped: 0, paused: Boolean(queue && queue.paused) };
  for (const it of (queue.items || [])) {
    if (it.status === 'queued') s.queued += 1;
    else if (it.status === 'running') s.running += 1;
    else if (it.status === 'done') s.done += 1;
    else if (it.status === 'failed') s.failed += 1;
    else if (it.status === 'cancelled') s.cancelled += 1;
    else if (it.status === 'interrupted') s.interrupted += 1;
    else if (it.status === 'stopped_by_operator') s.stopped += 1;
    else s.skipped += 1;
  }
  return s;
}

// The operator queue-control view (paused flag + provenance), read-only shape
// derived from the persisted queue. UI copy is built from this.
function videoQueueControl(queue) {
  return {
    paused: Boolean(queue && queue.paused),
    paused_at: (queue && queue.paused_at) || null,
    paused_by: (queue && queue.paused_by) || null,
    pause_reason: (queue && queue.pause_reason) || null,
    resumed_at: (queue && queue.resumed_at) || null,
    stop_requested_at: (queue && queue.stop_requested_at) || null,
  };
}

// ── Read-only queue audit ────────────────────────────────────────────────────
// Classifies every LIVE (queued/running) item of a project's persisted video
// queue against CURRENT project truth, without any side effects: no pump, no
// reconcile, no queue write, no attempt creation, no PRESTO contact. This is
// the safe inspection path for a paused queue — the video-queue and
// videos-status GETs both drive the pump (whose reconciliation may rewrite
// the queue file even while paused) and must NOT be used for auditing.
//
// Dispositions (first match wins, most-blocking first):
//   invalid_identity        row for the item's index no longer exists
//   missing_source          still is gone from disk
//   missing_prompt          i2v prompt is gone
//   already_satisfied       a clip exists — resume marks skipped_exists (no-op)
//   duplicate_queue_item    an earlier live item targets the same slot
//   active_attempt_exists   a dispatched generation attempt owns the slot
//   source_unapproved       current image-review gate refuses the row
//   stale_prompt            enqueue-time i2v hash ≠ current canonical hash, or
//                           the prompt is flagged stale by an upstream edit
//                           (resume would render the CURRENT text — surfaced,
//                           not blocking, exactly like the live drift badge)
//   stale_assignment        the row's visual-plan assignment was revised
//   legacy_compatibility    dispatchable ONLY under the documented legacy rule
//                           (no review + no provenance = unknown_legacy):
//                           eligible and labeled, but approval is unproven
//   safe_to_resume          every current gate passes with a real approval
//
// Historical intent limits (never invented): pre-attempt queue items store
// only the enqueue-time canonical i2v hash. Source-image bytes, assignment,
// and motion contract at enqueue time were not recorded, so "unchanged since
// enqueue" can only be proven for the prompt hash. Everything else is judged
// against CURRENT state and labeled accordingly.
const VIDEO_QUEUE_AUDIT_DISPATCHABLE = new Set(['safe_to_resume', 'legacy_compatibility', 'stale_prompt', 'stale_assignment']);
// Measured HQ render wall time (54m51s — see launchPrestoProductionJob).
const VIDEO_QUEUE_AUDIT_SECONDS_PER_CLIP = 3291;
// Advisory operator action per disposition — recommendations ONLY. The audit
// never executes any of these; every one is a manual operator step elsewhere.
const VIDEO_QUEUE_AUDIT_ACTIONS = {
  safe_to_resume: 'keep_queued',
  legacy_compatibility: 'review_image_first',
  stale_prompt: 'cancel_and_requeue_later',
  stale_assignment: 'reapprove_assignment_then_requeue',
  source_unapproved: 'review_image_first',
  already_satisfied: 'remove_later_as_already_satisfied',
  duplicate_queue_item: 'remove_later_as_duplicate',
  active_attempt_exists: 'manual_identity_review',
  missing_source: 'do_not_render',
  missing_prompt: 'regenerate_prompt_then_requeue',
  invalid_identity: 'manual_identity_review',
};

// Project-level advisory: which of the four operator options the evidence
// supports. Pure derivation from disposition counts — never executed here.
function videoQueueAuditRecommendation(summary, liveCount) {
  if (!liveCount) return { choice: 'nothing_to_do', reason: 'No live queue items.' };
  const safe = summary.safe_to_resume || 0;
  const legacy = summary.legacy_compatibility || 0;
  const blocked = liveCount - safe - legacy;
  if (safe === liveCount) {
    return { choice: 'resume_as_is_later', reason: 'Every live item passes every current gate with a real approval.' };
  }
  if (legacy > 0 && blocked === 0) {
    return {
      choice: 'keep_paused',
      reason: `${legacy} item(s) are dispatchable only under legacy compatibility (image approval unproven). `
        + 'Review the images first; items become individually resumable as their reviews are approved.',
    };
  }
  if (blocked > 0 && (safe + legacy) > 0) {
    return {
      choice: 'retain_safe_subset_later',
      reason: `${blocked} item(s) are blocked or obsolete while ${safe + legacy} could dispatch — separate them before any resume.`,
    };
  }
  return { choice: 'rebuild_later', reason: 'No live item is currently dispatchable — requeue from current eligible rows when ready.' };
}

function auditSuperFocusVideoQueue(state, sfMediaRoot) {
  const id = state.project_id;
  const subdir = superFocusVideoSubdir();
  const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
  const attempts = superFocusMedia.readVideoAttempts(id, { mediaRoot: sfMediaRoot });
  const mediaDir = superFocusMedia.mediaDirFor(id, { mediaRoot: sfMediaRoot });
  const rowByIndex = new Map((state.image_prompts || []).filter((r) => r && r.text && String(r.text).trim()).map((r) => [r.index, r]));
  // Structural duplicate detection — ORTHOGONAL to disposition precedence.
  // Canonical render-target identity within a project's queue is the row
  // INDEX: the dispatcher renders --indexes [index] into the index-named
  // output slot (videos/<subdir>/NNN.mp4), and enqueue dedups live items per
  // index. Two live items sharing an index target the same work regardless
  // of what their primary disposition says, so ALL members of a duplicate
  // group carry the flag (the condition belongs to the group, not to
  // insertion order). This is reported truth only — nothing deduplicates.
  const liveIndexCounts = {};
  for (const item of queue.items) {
    if (item.status === 'queued' || item.status === 'running') {
      liveIndexCounts[item.index] = (liveIndexCounts[item.index] || 0) + 1;
    }
  }
  const duplicateGroupSizes = Object.values(liveIndexCounts).filter((n) => n > 1);
  const history = {};
  const summary = {};
  const items = [];
  const liveSeen = new Set();
  let position = 0;
  for (const item of queue.items) {
    position += 1;
    if (item.status !== 'queued' && item.status !== 'running') {
      history[item.status] = (history[item.status] || 0) + 1;
      continue;
    }
    const idx = item.index;
    const row = rowByIndex.get(idx) || null;
    const imgPath = superFocusMedia.safeImageFilePath(id, idx, { mediaRoot: sfMediaRoot });
    const imageExists = Boolean(imgPath && fs.existsSync(imgPath));
    const videoExists = fs.existsSync(superFocusMedia.videoFilePath(mediaDir, subdir, idx));
    const activeAttemptId = attempts.active[String(idx)];
    const activeAttempt = activeAttemptId ? attempts.attempts[activeAttemptId] : null;
    const currentHash = row && superFocus.hasI2vPrompt(row) ? i2vTextHash(row) : null;
    const reasons = [];
    let disposition = null;
    let gateStatus = null;
    if (!row) {
      disposition = 'invalid_identity'; reasons.push(`no current row with index ${idx}`);
    } else if (!imageExists) {
      disposition = 'missing_source'; reasons.push('still image is missing from disk');
    } else if (!superFocus.hasI2vPrompt(row)) {
      disposition = 'missing_prompt'; reasons.push('row no longer has an i2v prompt');
    } else if (videoExists) {
      disposition = 'already_satisfied'; reasons.push('a clip already exists — resume marks this item skipped_exists');
    } else if (liveSeen.has(idx)) {
      disposition = 'duplicate_queue_item'; reasons.push('an earlier live queue item already targets this slot');
    } else if (activeAttempt && activeAttempt.status === 'dispatched') {
      disposition = 'active_attempt_exists'; reasons.push(`attempt ${activeAttemptId} is dispatched for this slot`);
    } else {
      const gate = superFocusImageReview.imageReviewGate(row, buildImageReviewContext(state, row, sfMediaRoot));
      gateStatus = gate.effective_status;
      if (!gate.eligible) {
        disposition = 'source_unapproved'; reasons.push(gate.reason || 'image not cleared by review');
      } else if (item.i2v_hash && currentHash && item.i2v_hash !== currentHash) {
        disposition = 'stale_prompt'; reasons.push('i2v text changed after enqueue — resume renders the CURRENT text');
      } else if (row.i2v_prompt && row.i2v_prompt.stale) {
        disposition = 'stale_prompt'; reasons.push('i2v prompt flagged stale by an upstream image-prompt edit');
      } else if (row.assignment_stale) {
        disposition = 'stale_assignment'; reasons.push('visual-plan assignment changed since this prompt was written');
      } else if (gate.effective_status === 'unknown_legacy') {
        disposition = 'legacy_compatibility';
        reasons.push('dispatchable under legacy compatibility (no review, no provenance) — image approval is unproven, not refused');
      } else {
        disposition = 'safe_to_resume';
      }
    }
    if (row && imageExists) liveSeen.add(idx);
    summary[disposition] = (summary[disposition] || 0) + 1;
    items.push({
      position,
      item_id: item.item_id || null,
      index: idx,
      status: item.status,
      queued_at: item.queued_at || null,
      disposition,
      reasons,
      image_exists: imageExists,
      video_exists: videoExists,
      i2v_hash_queued: item.i2v_hash || null,
      i2v_hash_current: currentHash,
      image_review_status: gateStatus,
      active_attempt: activeAttempt ? { attempt_id: activeAttemptId, status: activeAttempt.status } : null,
      would_dispatch_on_resume: VIDEO_QUEUE_AUDIT_DISPATCHABLE.has(disposition),
      estimated_seconds: VIDEO_QUEUE_AUDIT_DISPATCHABLE.has(disposition) ? VIDEO_QUEUE_AUDIT_SECONDS_PER_CLIP : 0,
      recommended_action: VIDEO_QUEUE_AUDIT_ACTIONS[disposition] || 'manual_identity_review',
      structural_flags: liveIndexCounts[idx] > 1 ? ['duplicate_queue_item'] : [],
    });
  }
  const dispatchable = items.filter((it) => it.would_dispatch_on_resume);
  const queuedTimes = items.map((it) => it.queued_at).filter(Boolean).sort();
  return {
    project_id: id,
    paused: Boolean(queue.paused),
    pause: videoQueueControl(queue),
    subdir,
    queue_count: queue.items.length,
    live_count: items.length,
    history,
    summary,
    oldest_queued_at: queuedTimes[0] || null,
    newest_queued_at: queuedTimes[queuedTimes.length - 1] || null,
    would_dispatch_on_resume: dispatchable.length,
    estimated_runtime_seconds: dispatchable.length * VIDEO_QUEUE_AUDIT_SECONDS_PER_CLIP,
    seconds_per_clip: VIDEO_QUEUE_AUDIT_SECONDS_PER_CLIP,
    policy: 'report_only',
    // Structural aggregate (diagnostic only; NEVER feeds the recommendation,
    // which stays driven by operational dispositions): item count = queue
    // entries participating in any duplicate group; group count = distinct
    // duplicated render targets (indexes).
    structural: {
      duplicate_item_count: duplicateGroupSizes.reduce((s, n) => s + n, 0),
      duplicate_group_count: duplicateGroupSizes.length,
    },
    recommendation: videoQueueAuditRecommendation(summary, items.length),
    items,
  };
}

// ── Image Review Workbench (read-only assembly) ─────────────────────────────
// One focused payload for reviewing images one item at a time: deterministic
// candidate ordering, counts, queue linkage, and an advisory consequence
// preview. Queue truth comes from the SAME read-only audit the operator
// already trusts (auditSuperFocusVideoQueue) — never a second eligibility
// engine. Nothing here writes project, queue, or attempt state; the current
// image hash is computed ONLY for the single selected candidate so the
// operator's decision can bind to the exact displayed bytes.

// "Immediately unlockable": image approval is the ONLY remaining review gate
// for at least one live queued item — after approval the audit would classify
// that item safe_to_resume. It never means generation starts: dispatch stays
// behind the separate, explicit operator resume while the queue is paused.
// (Pinned by test: post-approval re-audit must report safe_to_resume.)
function workbenchItemUnlockable(row, auditItem) {
  if (!auditItem) return false;
  if (auditItem.disposition === 'legacy_compatibility') return true; // prompt/assignment already proven current by audit precedence
  if (auditItem.disposition !== 'source_unapproved') return false;
  if (auditItem.video_exists) return false;
  if (auditItem.i2v_hash_queued && auditItem.i2v_hash_current
      && auditItem.i2v_hash_queued !== auditItem.i2v_hash_current) return false;
  if (row.i2v_prompt && row.i2v_prompt.stale) return false;
  if (row.assignment_stale) return false;
  return true;
}

// Advisory consequence preview for the selected candidate — derived facts
// only (audit dispositions, gate verdict, pause state). Never a promise to
// dispatch, never a quality judgment.
function workbenchConsequence(row, eff, linked, paused, imageExists) {
  const approve = [];
  const reject = [];
  const revoke = [];
  if (!imageExists) {
    approve.push('No image is on disk for this slot — approval is not possible.');
  } else if (eff.status === 'approved') {
    approve.push('This image is already approved and current. Approving again changes nothing.');
  } else {
    linked.forEach((it) => {
      if (it.video_exists) {
        approve.push(`Queue item ${it.item_id} (position ${it.position}): the expected video already exists — on resume it is skipped. Approval will not dispatch or overwrite it.`);
      } else if (workbenchItemUnlockable(row, it)) {
        approve.push(`Approval would clear the image-review gate for queue item ${it.item_id} (position ${it.position}).`);
      } else {
        approve.push(`Approval alone would not make queue item ${it.item_id} (position ${it.position}) ready: ${(it.reasons || []).join('; ') || it.disposition}.`);
      }
    });
    if (!linked.length) {
      approve.push('This image is not linked to a live queued video item. Approval affects only future queueing.');
    }
  }
  if (paused) approve.push('The queue remains paused — nothing dispatches until you separately resume eligible items.');
  reject.push('Rejection records your decision; linked queue items are refused at dispatch time (skipped_review).');
  reject.push('The image stays on disk and nothing is regenerated automatically — regeneration is a separate explicit action.');
  if (eff.status === 'approved') {
    revoke.push('Revoking removes the review-gate satisfaction; linked queue items will not dispatch on resume.');
  }
  return { approve, reject, revoke, queue_paused: Boolean(paused) };
}

function buildImageReviewWorkbench(state, sfMediaRoot, options = {}) {
  const audit = auditSuperFocusVideoQueue(state, sfMediaRoot); // read-only by contract
  const liveByIndex = new Map();
  audit.items.forEach((it) => {
    if (!liveByIndex.has(it.index)) liveByIndex.set(it.index, []);
    liveByIndex.get(it.index).push(it);
  });
  const rows = (state.image_prompts || []).filter((r) => r && r.text && String(r.text).trim());
  const mediaDir = superFocusMedia.mediaDirFor(state.project_id, { mediaRoot: sfMediaRoot });
  const entries = [];
  rows.forEach((row) => {
    const context = buildImageReviewContext(state, row, sfMediaRoot);
    if (!context.image_exists && !row.image_review) return; // nothing to review, nothing reviewed
    const eff = superFocusImageReview.effectiveReview(row, context);
    const linked = liveByIndex.get(row.index) || [];
    const unlockable = superFocusImageReview.workbenchNeedsDecision(eff.status)
      && linked.some((it) => workbenchItemUnlockable(row, it));
    const videoExists = fs.existsSync(superFocusMedia.videoFilePath(mediaDir, audit.subdir, row.index));
    entries.push({ row, context, eff, linked, unlockable, videoExists });
  });
  const candidates = entries.map(({ row, context, eff, linked, unlockable, videoExists }) => ({
    index: row.index,
    bucket: superFocusImageReview.workbenchBucket({
      effective_status: eff.status,
      queue_linked: linked.length > 0,
    }),
    effective_status: eff.status,
    needs_decision: superFocusImageReview.workbenchNeedsDecision(eff.status),
    queue_linked: linked.length > 0,
    image_exists: context.image_exists,
    video_exists: videoExists,
    unlockable,
    structural_flags: linked.length ? linked[0].structural_flags : [],
    disposition: linked.length ? linked[0].disposition : null,
  })).sort((a, b) => a.bucket - b.bucket || a.index - b.index);
  const counts = {
    total_candidates: candidates.length,
    needs_decision: candidates.filter((c) => c.needs_decision).length,
    unreviewed: candidates.filter((c) => ['not_reviewed', 'unknown_legacy', 'in_review'].indexOf(c.effective_status) !== -1).length,
    stale: candidates.filter((c) => c.effective_status === 'review_required').length,
    rejected: candidates.filter((c) => c.effective_status === 'rejected').length,
    approved: candidates.filter((c) => c.effective_status === 'approved').length,
    queue_linked: candidates.filter((c) => c.queue_linked).length,
    immediately_unlockable: candidates.filter((c) => c.unlockable).length,
  };
  // Selected candidate: explicit ?index when it is a candidate, else the
  // first needs-decision candidate in order, else the first candidate.
  let selectedEntry = null;
  if (options.selectedIndex != null) {
    selectedEntry = entries.find((e) => e.row.index === options.selectedIndex) || null;
    if (!selectedEntry) {
      const err = new Error(`Slot ${options.selectedIndex} is not a review candidate (no image and no review).`);
      err.statusCode = 404;
      throw err;
    }
  } else {
    const firstNeeds = candidates.find((c) => c.needs_decision) || candidates[0] || null;
    if (firstNeeds) selectedEntry = entries.find((e) => e.row.index === firstNeeds.index) || null;
  }
  let selected = null;
  if (selectedEntry) {
    const { row, context, eff, linked, unlockable, videoExists } = selectedEntry;
    const currentHash = context.image_exists ? context.hash_image() : null;
    const plan = state.visual_plan || null;
    const assignment = context.assignment;
    const beat = assignment && plan
      ? (plan.beats || []).find((b) => b.beat_id === assignment.beat_id) || null
      : null;
    selected = {
      index: row.index,
      image: {
        exists: context.image_exists,
        file_name: superFocusMedia.imageFileName(row.index),
        mtime_ms: context.image_mtime_ms,
        sha256: currentHash,
      },
      prompt_text: row.text || '',
      prompt_hash: superFocusImageReview.sha256(String(row.text || '')),
      prompt_source: row.prompt_source || null,
      assignment_stale: Boolean(row.assignment_stale),
      i2v_prompt: row.i2v_prompt
        ? { exists: true, text: row.i2v_prompt.text || '', stale: Boolean(row.i2v_prompt.stale) }
        : { exists: false, text: '', stale: false },
      assignment: assignment ? {
        assignment_id: assignment.assignment_id,
        beat_id: assignment.beat_id,
        viewer_task: assignment.viewer_task,
        visual_function: assignment.visual_function,
        assignment: assignment.assignment,
        media_type: assignment.media_type,
        status: assignment.status,
        fresh: context.assignment_fresh,
      } : null,
      beat_text: beat ? beat.script_text : null,
      review: row.image_review || null,
      effective_status: eff.status,
      reasons: eff.reasons,
      image_current: eff.image_current,
      // Before a review starts eff.criteria is empty; show the assignment's
      // CURRENT acceptance criteria (unreviewed snapshot) so the operator
      // sees what an approval would be judged against.
      criteria: eff.criteria.length ? eff.criteria
        : (assignment ? superFocusImageReview.snapshotCriteria(assignment) : []),
      removed_criteria: eff.removed_criteria,
      override: eff.override,
      approval: row.image_review ? superFocusImageReview.approvalBlockers(row, context) : null,
      gate: superFocusImageReview.imageReviewGate(row, context),
      queue_items: linked,
      video_exists: videoExists,
      unlockable,
      consequence: workbenchConsequence(row, eff, linked, audit.paused, context.image_exists),
    };
  }
  return {
    project_id: state.project_id,
    queue: {
      paused: audit.paused,
      pause: audit.pause,
      queue_count: audit.queue_count,
      live_count: audit.live_count,
      recommendation: audit.recommendation,
      structural: audit.structural,
    },
    counts,
    candidates,
    selected,
  };
}

// ── Image Review Workbench decision (hash-bound, atomic, idempotent) ────────
// One explicit operator action = one decision on the EXACT image the operator
// saw. The request must carry the sha256 the workbench displayed; if the
// on-disk bytes differ at decision time the request fails closed with 409
// image_changed and nothing is written — approval can never transfer to a
// replacement image that landed in the same slot. Approve/reject compose the
// domain's startReview snapshot with the decision IN MEMORY and persist once,
// so a blocked decision (e.g. undecided acceptance criteria) leaves no trace.
// Duplicate requests for an already-recorded decision on the same exact image
// return 200 unchanged. The human presses the button; the model, the pump,
// and this handler never decide that an image is acceptable.
function handleImageReviewWorkbenchDecision(res, state, payload, ctx) {
  const failWith = (statusCode, message) => {
    const e = new Error(message);
    e.statusCode = statusCode;
    throw e;
  };
  const id = state.project_id;
  const decision = payload.decision;
  if (['approve', 'reject', 'revoke'].indexOf(decision) === -1) {
    failWith(400, 'decision must be one of: approve, reject, revoke.');
  }
  if (!Number.isInteger(payload.index)) {
    failWith(400, 'index must be an integer slot number.');
  }
  const idx = payload.index;
  if (idx < 1 || idx > superFocusPrompts.IMAGE_PROMPT_MAX) {
    failWith(400, `index must be between 1 and ${superFocusPrompts.IMAGE_PROMPT_MAX}.`);
  }
  const expected = payload.expected_image_hash;
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
    failWith(400, 'expected_image_hash must be the 64-hex sha256 of the displayed image.');
  }
  const row = (state.image_prompts || []).find((r) => r.index === idx);
  if (!row) failWith(404, `No image prompt at index ${idx}.`);
  const context = buildImageReviewContext(state, row, ctx.sfMediaRoot);
  if (!context.image_exists) failWith(409, 'No image is on disk for this slot — nothing can be decided.');
  // Hash once, reuse everywhere (start/currency would otherwise re-hash).
  let cachedHash = null;
  const hashOnce = context.hash_image;
  context.hash_image = () => { if (cachedHash == null) cachedHash = hashOnce(); return cachedHash; };
  const currentHash = context.hash_image();
  if (currentHash !== expected) {
    sendError(res, 409,
      'The image on disk is not the image you were shown — no decision was recorded. Reload the workbench and review the current image.',
      'image_changed',
      { index: idx, expected_image_hash: expected, current_image_hash: currentHash });
    return;
  }
  const ir = superFocusImageReview;
  const respond = (savedState, unchanged) => {
    const savedRow = (savedState.image_prompts || []).find((r) => r.index === idx);
    const freshContext = buildImageReviewContext(savedState, savedRow, ctx.sfMediaRoot);
    const eff = ir.effectiveReview(savedRow, freshContext);
    sendJSON(res, 200, {
      project_id: id,
      index: idx,
      decision,
      unchanged: Boolean(unchanged),
      decided_image_hash: currentHash,
      review: savedRow.image_review || null,
      effective_status: eff.status,
      reasons: eff.reasons,
      criteria: eff.criteria,
      removed_criteria: eff.removed_criteria,
      approval: savedRow.image_review ? ir.approvalBlockers(savedRow, freshContext) : null,
      gate: ir.imageReviewGate(savedRow, freshContext),
    });
  };
  const existing = row.image_review || null;
  const eff0 = ir.effectiveReview(row, context);
  // Idempotency: the same decision on the same exact bytes is a no-op 200.
  if (decision === 'approve' && eff0.status === 'approved' && existing && existing.reviewed_image_hash === currentHash) {
    respond(state, true);
    return;
  }
  if (decision === 'reject' && eff0.status === 'rejected' && existing && existing.reviewed_image_hash === currentHash) {
    respond(state, true);
    return;
  }
  if (decision === 'revoke' && existing && existing.status === 'in_review') {
    respond(state, true); // approval already absent — a repeated revoke changes nothing
    return;
  }
  let review;
  if (decision === 'revoke') {
    review = ir.revoke(row); // 409 unless currently approved (domain rule)
  } else {
    // Compose snapshot + decision in memory; persist only if the decision
    // succeeds. The snapshot binds reviewed_image_hash to the verified bytes.
    const work = Object.assign({}, row);
    if (!work.image_review || work.image_review.status !== 'in_review') {
      work.image_review = ir.startReview(work, context);
    }
    review = decision === 'approve'
      ? ir.approve(work, context)
      : ir.reject(work, payload.reason);
  }
  const saved = superFocus.setImageReview(id, idx, review, { root: ctx.sfRoot });
  respond(saved, false);
}


// Is a row eligible for NORMAL video queueing right now? ctx = { sfRoot, sfMediaRoot, options }.
function superFocusVideoEligibility(id, state, subdir, idx, ctx) {
  const row = (state.image_prompts || []).find((r) => r.index === idx);
  if (!row) return { ok: false, reason: 'no_row' };
  const imgPath = superFocusMedia.safeImageFilePath(id, idx, { mediaRoot: ctx.sfMediaRoot });
  if (!(imgPath && fs.existsSync(imgPath))) return { ok: false, reason: 'skipped_prereq' };
  if (!superFocus.hasI2vPrompt(row)) return { ok: false, reason: 'skipped_prereq' };
  const mediaDir = superFocusMedia.mediaDirFor(id, { mediaRoot: ctx.sfMediaRoot });
  if (fs.existsSync(superFocusMedia.videoFilePath(mediaDir, subdir, idx))) return { ok: false, reason: 'skipped_exists' };
  return { ok: true, row };
}

// Bring the queue in line with disk + the global PRESTO lock. Safe on restart:
// a 'running' item with no active job for us is resolved by output existence
// (done) or marked failed/stale (never blindly re-run).
function reconcileSuperFocusVideoQueue(id, ctx) {
  const state = superFocus.loadProject(id, { root: ctx.sfRoot });
  const subdir = superFocusVideoSubdir();
  const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: ctx.sfMediaRoot });
  const mediaDir = superFocusMedia.mediaDirFor(id, { mediaRoot: ctx.sfMediaRoot });
  const active = currentPrestoJobStatus().active;
  const activeIsThis = Boolean(active && active.package_id === id);
  const relVideo = (idx) => path.join('videos', subdir, superFocusMedia.videoFileName(idx));
  const completed = currentPrestoJobStatus().completed;
  const completedIsThis = Boolean(completed && completed.package_id === id);
  let changed = false;
  for (const item of queue.items) {
    const idx = item.index;
    const hasVideo = fs.existsSync(superFocusMedia.videoFilePath(mediaDir, subdir, idx));
    if (item.status === 'running') {
      if (activeIsThis) continue; // still rendering our job
      // Settle this item's generation attempt alongside the item itself.
      // Ownership lives in the attempt layer: completeVideoAttempt refuses
      // unless this is still the slot's active dispatched attempt, so a late
      // or superseded completion can never overwrite newer provenance. These
      // calls must never break reconciliation (best-effort, attempt-recorded).
      const settleAttempt = (kind, reason) => {
        if (!item.attempt_id) return; // legacy in-flight item — no attempt, none invented
        try {
          if (kind === 'complete') superFocusMedia.completeVideoAttempt(id, item.attempt_id, { mediaRoot: ctx.sfMediaRoot });
          else superFocusMedia.markVideoAttempt(id, item.attempt_id, kind, reason, { mediaRoot: ctx.sfMediaRoot });
        } catch (_) { /* provenance write failure must not wedge the queue */ }
      };
      if (hasVideo) {
        item.status = 'done'; item.output_path = relVideo(idx); item.finished_at = item.finished_at || new Date().toISOString();
        settleAttempt('complete');
      } else if (item.stop_requested_at || (completedIsThis && completed.signal)) {
        // Operator asked to stop this render (SIGTERM/SIGKILL). Honest: the
        // local process was stopped; the item is eligible for explicit requeue.
        item.status = 'stopped_by_operator';
        item.error = item.error || 'Stopped by operator before completion. Requeue to retry.';
        item.finished_at = new Date().toISOString();
        settleAttempt('cancelled', 'stopped_by_operator');
      } else if (completedIsThis) {
        // The render process ran to completion IN THIS PROCESS but produced no
        // output → a genuine failure (non-zero exit, or clean exit with no file).
        item.status = 'failed';
        item.error = (completed.exit_code != null && completed.exit_code !== 0)
          ? 'Render failed (exit ' + completed.exit_code + '). Requeue to retry.'
          : 'Render finished without producing a video. Requeue to retry.';
        item.finished_at = new Date().toISOString();
        settleAttempt('failed', 'render_failed');
      } else {
        // No output and NO record of a completed process for us: the render was
        // interrupted (PRESTO/ComfyUI stopped, or the cockpit restarted mid-job).
        // Never mark done; preserve for explicit requeue.
        item.status = 'interrupted';
        item.error = 'Render interrupted — PRESTO/ComfyUI may have been stopped, or the cockpit restarted. Requeue when ready.';
        item.finished_at = new Date().toISOString();
        settleAttempt('failed', 'interrupted');
      }
      changed = true;
    } else if (item.status === 'queued') {
      if (hasVideo) { item.status = 'skipped_exists'; item.finished_at = new Date().toISOString(); changed = true; continue; }
      const el = superFocusVideoEligibility(id, state, subdir, idx, ctx);
      if (!el.ok && el.reason === 'skipped_prereq') {
        item.status = 'skipped_prereq'; item.error = 'missing still or i2v prompt'; item.finished_at = new Date().toISOString(); changed = true;
      }
    }
  }
  if (changed) superFocusMedia.writeVideoQueue(id, queue, { mediaRoot: ctx.sfMediaRoot });
  return { state, subdir, queue };
}

// Start the next queued item IF the single PRESTO worker is free. Idempotent and
// safe to call repeatedly (poll) or on job completion (event). Never runs two.
async function pumpSuperFocusVideoQueue(id, ctx) {
  const { state, subdir, queue } = reconcileSuperFocusVideoQueue(id, ctx);
  // Operator pause: never START a new PRESTO render while paused. A render that
  // is already running is left alone (Stop current render is a separate action);
  // remaining items stay queued for later.
  if (queue.paused) return { started: null, queue, blocked: 'paused' };
  if (currentPrestoJobStatus().active) return { started: null, queue, blocked: 'busy' };
  if (queue.items.some((it) => it.status === 'running')) return { started: null, queue, blocked: 'running' };
  const next = queue.items.find((it) => it.status === 'queued');
  if (!next) return { started: null, queue };
  const el = superFocusVideoEligibility(id, state, subdir, next.index, ctx);
  if (!el.ok) {
    next.status = el.reason === 'skipped_exists' ? 'skipped_exists' : 'skipped_prereq';
    next.finished_at = new Date().toISOString();
    superFocusMedia.writeVideoQueue(id, queue, { mediaRoot: ctx.sfMediaRoot });
    return pumpSuperFocusVideoQueue(id, ctx); // try the following item
  }
  // Image-review gate at DISPATCH time, not just enqueue time: an approval
  // revoked (or a review opened/rejected) AFTER an item was queued must stop
  // the render — same contract as the enqueue/batch/regenerate gates
  // ("unreviewed / rejected / stale-approved images must not reach PRESTO").
  // Legacy rows (no review, no provenance) stay eligible under the documented
  // compatibility rule, so pre-gate queues keep draining unchanged.
  {
    const gateCtx = buildImageReviewContext(state, el.row, ctx.sfMediaRoot);
    if (gateCtx.image_exists) {
      const gate = superFocusImageReview.imageReviewGate(el.row, gateCtx);
      if (!gate.eligible) {
        next.status = 'skipped_review';
        next.error = `Image not cleared by review: ${gate.reason}. Approve the image, then requeue.`;
        next.finished_at = new Date().toISOString();
        superFocusMedia.writeVideoQueue(id, queue, { mediaRoot: ctx.sfMediaRoot });
        return pumpSuperFocusVideoQueue(id, ctx); // try the following item
      }
    }
  }
  // Supervised compute gate — the SAME lane policy the AIGEN PRESTO submit path
  // enforces, now applied to the Super Focus render lane it previously bypassed.
  // A non-ROUTE verdict HOLDS the item (it stays queued, like an unreachable
  // worker, and is NEVER marked failed) so the render waits until the lane clears
  // (e.g. Mikko closes Resolve, or ComfyUI comes up). Fail-closed; injectable.
  const laneGate = await evaluateSuperFocusComputeLane(ctx.options);
  if (!laneGate.allow) {
    return { started: null, queue, blocked: 'compute_lane_blocked', gate: { code: laneGate.verdict.code, reason: laneGate.verdict.reason, checks: (laneGate.gateResult && laneGate.gateResult.checks) || {} } };
  }
  const reach = ctx.options.prestoReachableCheck || ctx.options.reachableCheck || prestoComfyuiReachable;
  if (!(await reach(PRESTO_BASE_URL, ctx.options))) return { started: null, queue, blocked: 'unreachable' };
  // The reachability probe is an await window during which another handler
  // (a concurrent enqueue/cancel/pause, or another poll's pump) may have
  // rewritten the queue file. readVideoQueue/writeVideoQueue is a non-atomic
  // read-modify-write, so re-read the queue NOW and re-validate before launching
  // — otherwise we would clobber those concurrent writes (lost update) or start
  // a render for an item that was cancelled/paused mid-window.
  const fresh = superFocusMedia.readVideoQueue(id, { mediaRoot: ctx.sfMediaRoot });
  if (fresh.paused) return { started: null, queue: fresh, blocked: 'paused' };
  if (currentPrestoJobStatus().active) return { started: null, queue: fresh, blocked: 'busy' };
  if (fresh.items.some((it) => it.status === 'running')) return { started: null, queue: fresh, blocked: 'running' };
  const freshItem = fresh.items.find((it) => it.item_id === next.item_id);
  if (!freshItem || freshItem.status !== 'queued') return { started: null, queue: fresh, blocked: 'raced' };
  // Render-time provenance: mint the generation attempt FIRST (stages an
  // immutable copy of the still and records every dispatched input), then
  // materialize selected-images.json pointing at the staged copy — so the
  // bytes run-production.py uploads are exactly the bytes the attempt hashed.
  let attempt = null;
  try {
    attempt = superFocusMedia.createVideoAttempt(id, el.row, {
      mediaRoot: ctx.sfMediaRoot, subdir, profile: DEFAULT_PRESTO_PROFILE, itemId: freshItem.item_id,
    });
  } catch (e) {
    // The still vanished between the eligibility check and staging. Never
    // dispatch with unproven inputs: fail the item honestly, try the next.
    freshItem.status = 'failed';
    freshItem.error = `Source image unavailable at dispatch: ${e.message}`;
    freshItem.finished_at = new Date().toISOString();
    superFocusMedia.writeVideoQueue(id, fresh, { mediaRoot: ctx.sfMediaRoot });
    return pumpSuperFocusVideoQueue(id, ctx);
  }
  const materialized = superFocusMedia.materializeVideoInputs(id, state.image_prompts, {
    mediaRoot: ctx.sfMediaRoot,
    rows: [el.row],
    selectedPathByIndex: { [el.row.index]: attempt.source.staged_rel },
  });
  let job;
  try {
    job = startSuperFocusVideoJob(materialized.mediaDir, {
      projectId: id,
      profile: DEFAULT_PRESTO_PROFILE,
      comfyuiUrl: PRESTO_BASE_URL,
      indexes: [freshItem.index],
      spawn: ctx.options.spawn,
      productionScript: ctx.options.productionScript,
      pythonBin: ctx.options.pythonBin,
      payload: {},
    });
  } catch (e) {
    // Launch refused (lock grabbed between checks): the attempt never ran.
    superFocusMedia.markVideoAttempt(id, attempt.attempt_id, 'cancelled', 'launch_blocked', { mediaRoot: ctx.sfMediaRoot });
    return { started: null, queue: fresh, blocked: 'busy' };
  }
  freshItem.attempt_id = attempt.attempt_id;
  freshItem.status = 'running';
  freshItem.started_at = new Date().toISOString();
  freshItem.job_id = job && job.job_id;
  freshItem.provider = { id: 'presto_comfyui', label: 'PRESTO ComfyUI', subdir };
  // Durable dispatch provenance: record the compute gate's authorizing ROUTE
  // (host / endpoint / reason / registry_version + readiness checks) that
  // permitted THIS render, bound to the queue item and persisted in
  // video-queue.json. The exact rendered inputs are already bound separately by
  // attempt_id → video-attempts.json (immutable staged still + dispatched inputs).
  const receipt = buildComputeDispatchReceipt({ lane: 'wan_i2v', gateResult: laneGate.gateResult, verdict: laneGate.verdict, profile: DEFAULT_PRESTO_PROFILE, comfyuiUrl: PRESTO_BASE_URL });
  receipt.job_id = job && job.job_id;
  receipt.dispatch_timestamp = freshItem.started_at;
  receipt.attempt_id = attempt.attempt_id;
  freshItem.compute_receipt = receipt;
  superFocusMedia.writeVideoQueue(id, fresh, { mediaRoot: ctx.sfMediaRoot });
  const next2 = freshItem; // keep the tail below referring to the launched item
  // Event-driven advance: when this render finishes, drain the next item.
  if (PRESTO_STATE.activeJob && PRESTO_STATE.activeJob.process && PRESTO_STATE.activeJob.process.once) {
    PRESTO_STATE.activeJob.process.once('close', () => {
      pumpSuperFocusVideoQueue(id, ctx).catch(() => {});
    });
  }
  return { started: next2, queue: fresh };
}

function enqueueSuperFocusVideos(id, indexes, ctx) {
  const state = superFocus.loadProject(id, { root: ctx.sfRoot });
  const subdir = superFocusVideoSubdir();
  const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: ctx.sfMediaRoot });
  const live = new Set(queue.items.filter((it) => it.status === 'queued' || it.status === 'running').map((it) => it.index));
  const result = { queued: [], skipped: [] };
  for (const raw of (Array.isArray(indexes) ? indexes : [])) {
    const idx = Math.round(Number(raw));
    if (!Number.isInteger(idx) || idx < 1) { result.skipped.push({ index: raw, reason: 'bad_index' }); continue; }
    if (live.has(idx)) { result.skipped.push({ index: idx, reason: 'already_queued' }); continue; }
    const el = superFocusVideoEligibility(id, state, subdir, idx, ctx);
    if (!el.ok) { result.skipped.push({ index: idx, reason: el.reason }); continue; }
    const item = {
      item_id: `q${idx}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      index: idx, status: 'queued', i2v_hash: i2vTextHash(el.row),
      queued_at: new Date().toISOString(), started_at: null, finished_at: null, error: null, output_path: null,
    };
    queue.items.push(item);
    live.add(idx);
    result.queued.push(item);
  }
  superFocusMedia.writeVideoQueue(id, queue, { mediaRoot: ctx.sfMediaRoot });
  return result;
}

function cancelPrestoJob(options = {}) {
  const status = currentPrestoJobStatus();
  if (!status.active) {
    return Promise.resolve({ ok: false, error: 'No active job' });
  }
  const job = PRESTO_STATE.activeJob;
  const child = job.process;
  const killFn = options.kill || ((signal) => child.kill(signal));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timeout = setTimeout(() => {
      if (!job.completedAt) {
        try { killFn('SIGKILL'); } catch (_) {}
        job.signal = job.signal || 'SIGKILL';
        job.completedAt = job.completedAt || new Date().toISOString();
      }
      finish({ ok: true, cancelled: true, exit_code: job.exitCode == null ? null : job.exitCode });
    }, options.killAfterMs || 5000);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      job.exitCode = code;
      job.signal = signal || job.signal || null;
      job.completedAt = job.completedAt || new Date().toISOString();
      finish({ ok: true, cancelled: true, exit_code: code == null ? null : code });
    });
    try {
      killFn('SIGTERM');
    } catch (error) {
      clearTimeout(timeout);
      finish({ ok: false, error: error.message });
    }
  });
}

function readPrestoResults(packageId, options = {}) {
  const { packageId: id, packageDir, paths } = resolveAigenPackageDir(packageId, options);
  // Package-scoped completion: a selection is complete only when its staged
  // package MP4 exists. The global Wan lane history is kept under lane_* fields
  // so callers can still inspect it, but it must not be reported as this
  // package's completions (labels like flux-001 collide across packages).
  // Variant-aware: while a PRESTO job for THIS package is genuinely running,
  // report against that job's staging folder (an in-flight HQ batch must not
  // be judged by the legacy videos/mp4/). A finished/stale job must NOT pin
  // the lane — after completion the best-coverage/handoff logic decides, so
  // this endpoint can never disagree with the status dashboard about a
  // completed package.
  const jobActive = currentPrestoJobStatus().active;
  const activeJob = PRESTO_STATE.activeJob;
  const jobSubdir = jobActive && activeJob && activeJob.packageId === id
    ? PRESTO_PROFILE_OUTPUT_SUBDIRS[activeJob.profile]
    : null;
  const staged = jobSubdir
    ? packageStagedWanStatus(packageDir, jobSubdir)
    : packageBestStagedWanStatus(packageDir);
  const completed = staged.completedLabels;
  const laneCompleted = parseJsonLines(path.join(paths.wanLane, 'completed.txt'))
    .map((item) => String(item.label || item.raw || '').trim())
    .filter(Boolean);
  const laneFailed = parseJsonLines(path.join(paths.wanLane, 'failed.jsonl'))
    .map((item) => ({
      label: String(item.label || '').trim(),
      run_id: item.run_id || item.runId || null,
      error: item.error || item.message || item.raw || '',
      exit_code: item.exit_code == null ? null : item.exit_code,
      timestamp: item.timestamp || item.completed_at || item.created_at || null,
    }));
  // Package-scoped failures: only lane failures for a selection that is not yet
  // staged. A staged (completed) selection is never reported as failed, and
  // failures for unrelated packages never leak in. Global history is in lane_failed.
  const pendingLabels = new Set(staged.pending.map((item) => item.label).filter(Boolean));
  const failed = laneFailed.filter((item) => item.label && pendingLabels.has(item.label));
  const runsDir = options.wanRunsDir || paths.wanRunsDir || path.join(paths.wanLane, 'runs');
  const recentRuns = safeDirEntries(runsDir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runDir = path.join(runsDir, entry.name);
      const runLogPath = path.join(runDir, 'run.log');
      const runLog = safeReadJson(runLogPath, {});
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(runDir).mtimeMs; } catch (_) {}
      return {
        run_id: entry.name,
        label: runLog.label || '',
        status: runLog.status || '',
        verified: Boolean(runLog.verified || runLog.verified_count || runLog.status === 'verified'),
        verified_count: runLog.verified_count || 0,
        prompt_id: runLog.prompt_id || null,
        mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 20)
    .map(({ mtimeMs, ...item }) => item);
  return {
    ok: true,
    package_id: id,
    video_variant: staged.videoVariant,
    completed,
    completed_count: completed.length,
    pending_count: staged.pendingCount,
    lane_completed: laneCompleted,
    lane_completed_count: laneCompleted.length,
    failed,
    failed_count: failed.length,
    lane_failed: laneFailed,
    lane_failed_count: laneFailed.length,
    recent_runs: recentRuns,
  };
}

// Authoritative server-side eligibility for an AIGEN-lane PRESTO video
// submission. The single source of truth for "does this package have renderable
// work?" — no aigen route may spawn run-production.py for a package with none.
// Reuses readPackageVideoPrompts (selections + one-to-one I2V-prompt match +
// per-row source-image existence; throws 409 on a prompts/selections mismatch)
// and the staged-clip set for the target profile's variant (occupied slots).
// Never trusts the stored selected_path: each source image is re-resolved and
// confined under the package dir. Returns a structured, testable verdict; hard
// identity errors (invalid/missing package) propagate as thrown 400/404 to match
// the existing route conventions.
//
// The Super Focus lane has its own authoritative check (superFocusVideoEligibility)
// against its distinct state model (super-focus.json rows + video-queue.json);
// both lanes enforce the SAME contract — present source image + saved I2V prompt
// + unoccupied target slot + single-GPU lock — via lane-appropriate state. This
// function is the aigen lane's authority; it does not duplicate or diverge from
// the Super Focus rules, it mirrors them for the aigen state shape.
function evaluatePrestoSubmitEligibility(packageId, options = {}) {
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, options); // throws 400/404
  // Selections first: a package with no selected images can never be submitted,
  // regardless of prompt state (readPackageVideoPrompts would otherwise report
  // the missing prompts, masking the real blocker).
  if (readPackageSelections(packageDir).length === 0) {
    return { ok: false, code: 'NO_SELECTIONS', message: 'Select images for Wan2.2 before submitting to PRESTO.', project_id: id, eligible: [], eligible_count: 0, occupied: [], skipped: [] };
  }
  let prep;
  try {
    prep = readPackageVideoPrompts(id, options);
  } catch (error) {
    if (error.statusCode === 409 && !error.code) error.code = 'PROMPTS_MISMATCH';
    throw error;
  }
  if (prep.state === 'not_prepared') {
    return { ok: false, code: 'PROMPTS_NOT_PREPARED', message: 'Generate and save I2V prompts (video-prompts.json) before submitting to PRESTO.', project_id: id, selections_count: prep.selections_count, eligible: [], eligible_count: 0, occupied: [], skipped: [] };
  }
  if (!Array.isArray(prep.entries) || prep.entries.length === 0) {
    return { ok: false, code: 'NO_SELECTIONS', message: 'Select images for Wan2.2 before submitting to PRESTO.', project_id: id, eligible: [], eligible_count: 0, occupied: [], skipped: [] };
  }
  const profile = normalizePrestoProfile(options.profile);
  const variant = PRESTO_PROFILE_OUTPUT_SUBDIRS[profile] || DEFAULT_VIDEO_VARIANT;
  const clipSet = readVariantClipSet(packageDir, variant);
  const resolvedRoot = path.resolve(packageDir);
  const eligible = [];
  const occupied = [];
  const skipped = [];
  for (const entry of prep.entries) {
    const idx = entry.prompt_index;
    // Path containment: never trust the persisted selected_path. A record that
    // resolves outside the package dir is rejected, never rendered.
    const rel = String(entry.selected_path || '');
    const abs = path.resolve(packageDir, rel);
    if (!rel || (abs !== resolvedRoot && !abs.startsWith(resolvedRoot + path.sep))) {
      skipped.push({ index: idx, reason: 'SOURCE_IMAGE_PATH_INVALID' });
      continue;
    }
    if (!entry.image_exists) { skipped.push({ index: idx, reason: 'SOURCE_IMAGE_MISSING' }); continue; }
    if (!entry.prompt_text || !entry.prompt_text.trim()) { skipped.push({ index: idx, reason: 'PROMPT_MISSING' }); continue; }
    const staged = idx != null && clipSet.has(`${String(idx).padStart(3, '0')}.mp4`);
    if (staged) { occupied.push({ index: idx, reason: 'VIDEO_SLOT_OCCUPIED' }); continue; }
    eligible.push(idx);
  }
  if (eligible.length === 0) {
    const allOccupied = occupied.length > 0 && skipped.length === 0;
    return {
      ok: false,
      code: allOccupied ? 'ALL_SLOTS_OCCUPIED' : 'NO_ELIGIBLE_ITEMS',
      message: allOccupied
        ? 'Every selected image already has a rendered video for this profile. Nothing to submit (use Regenerate to replace one).'
        : 'No selection is ready to render — each needs a present source image and a saved I2V prompt.',
      project_id: id, profile, video_variant: variant,
      eligible: [], eligible_count: 0, occupied, skipped,
    };
  }
  return { ok: true, code: 'ELIGIBLE', project_id: id, profile, video_variant: variant, eligible, eligible_count: eligible.length, occupied, skipped };
}

// Map an eligibility reason code to the HTTP status used when a submission is
// rejected. Incomplete prerequisites (well-formed request, missing inputs) → 422;
// state conflicts (occupied / nothing renderable / prompt-selection mismatch) → 409.
function prestoEligibilityStatus(code) {
  if (code === 'PROMPTS_NOT_PREPARED' || code === 'NO_SELECTIONS') return 422;
  return 409; // ALL_SLOTS_OCCUPIED, NO_ELIGIBLE_ITEMS, PROMPTS_MISMATCH
}

function handlePrestoSubmit(req, res, options = {}) {
  readJsonBody(req)
    .then((payload) => {
      validateLocalWriteRequest(req, payload);
      // Cheap checks first, preserving their existing status codes: a running job → 409,
      // an invalid payload / missing production script → 400 (thrown by validate*).
      const current = currentPrestoJobStatus();
      if (current.active) {
        sendError(res, 409, 'Job already active', null, { active: current.active });
        return null;
      }
      const config = validatePrestoSubmitPayload(payload, options);
      // Authoritative eligibility BEFORE the network probe: the server — not the
      // page — decides whether there is renderable work. A crafted/stale/direct
      // request for a package with no ready selection, no saved I2V prompt, or an
      // already-fully-rendered slot set is rejected honestly (no doomed spawn, no
      // false 200). Re-checked inside startPrestoPackageJob's locked boundary too.
      const eligibility = evaluatePrestoSubmitEligibility(config.packageId, { ...options, profile: config.profile });
      if (!eligibility.ok) {
        sendError(res, prestoEligibilityStatus(eligibility.code), eligibility.message, eligibility.code, {
          project_id: eligibility.project_id,
          occupied: eligibility.occupied,
          skipped: eligibility.skipped,
        });
        return null;
      }
      // Pre-flight: confirm PRESTO ComfyUI is reachable before spawning, so a dead worker
      // fails fast with a clear message instead of a job that silently times out.
      // Compute registry gate: check lane readiness (SSH, ComfyUI, Resolve-not-running,
      // canonical workflow hash) via the read-only selector. If BLOCKED, reject with
      // the selector's reason — do NOT proceed to spawn run-production.py.
      const computeGate = options.computeGateFn || computeReadinessGate;
      const lane = options.computeLane || 'wan_i2v';
      return Promise.resolve()
        .then(() => computeGate(lane))
        // Any throw/rejection in the gate is itself a fail-closed BLOCK — a gate
        // that cannot run must never let a submit through.
        .catch((gateErr) => ({ ok: false, decision: 'BLOCKED', reason: `gate error: ${(((gateErr && gateErr.message) || 'exception')).slice(0, 200)}`, checks: {} }))
        .then((gateResult) => {
        // Authoritative, identity-bound verdict (fresh, server-side). A submit
        // proceeds ONLY on a consistent ROUTE for this lane to PRESTO; every
        // other result — BLOCKED, unknown decision, wrong host, fallback used,
        // malformed — is refused here, before the reachability probe and spawn.
        const verdict = computeGateVerdict(gateResult, lane);
        if (!verdict.allow) {
          sendError(
            res,
            503,
            `Compute registry: lane '${lane}' is BLOCKED — ${verdict.reason}`,
            'compute_lane_blocked',
            { lane, gate_code: verdict.code, checks: (gateResult && gateResult.checks) || {}, manual_action_required: (gateResult && gateResult.manual_action_required) || null },
          );
          return;
        }
        const reachableCheck = options.prestoReachableCheck || prestoComfyuiReachable;
        return Promise.resolve(reachableCheck(config.comfyuiUrl, options)).then((reachable) => {
          if (!reachable) {
            sendError(
              res,
              503,
              `PRESTO ComfyUI is not reachable at ${config.comfyuiUrl}. Start ComfyUI on PRESTO (192.168.50.187:8188) and retry.`,
              'presto_unreachable',
            );
            return;
          }
          // Durable provenance: record WHY this dispatch was allowed (the compute
          // gate's authorizing ROUTE) so a rendered clip can be traced back to the
          // lane/host/endpoint/selector reason that produced it.
          const receipt = buildComputeDispatchReceipt({ lane, gateResult, verdict, profile: config.profile, comfyuiUrl: config.comfyuiUrl });
          const result = startPrestoPackageJob(payload, { ...options, computeReceipt: receipt });
          sendJSON(res, 200, result);
        });
      });
    })
    .catch((error) => {
      if (error.statusCode === 409) {
        sendError(res, 409, error.message, error.code || null, { active: error.active });
        return;
      }
      sendError(res, error.statusCode || 500, error.message, error.code || null);
    });
}

function handlePrestoJobStatus(req, res) {
  sendJSON(res, 200, currentPrestoJobStatus());
}

function handlePrestoCancel(req, res) {
  try {
    validateLocalWriteRequest(req, {});
  } catch (error) {
    sendError(res, error.statusCode || 403, error.message, null);
    return;
  }
  cancelPrestoJob()
    .then((result) => {
      if (result.ok) {
        sendJSON(res, 200, result);
      } else {
        sendError(res, 400, result.error || 'Operation failed', null);
      }
    })
    .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
}

function handlePrestoResults(req, res, url) {
  try {
    const result = readPrestoResults(url.searchParams.get('package_id'));
    sendJSON(res, 200, result);
  } catch (error) {
    sendError(res, error.statusCode || 500, error.message, null);
  }
}

function readPackageVideoPrompts(packageId, options = {}) {
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, options);
  const selected = safeReadJson(path.join(packageDir, 'selected-images.json'), null);
  const selections = selected && Array.isArray(selected.selections) ? selected.selections : [];

  const videoPromptsFile = path.join(packageDir, 'video-prompts.json');
  const videoPrompts = safeReadJson(videoPromptsFile, null);
  const vpPrompts = videoPrompts && Array.isArray(videoPrompts.prompts) ? videoPrompts.prompts : [];

  // If video-prompts.json is missing or has no prompts, return not_prepared — never fall back to image-prompts.json
  if (vpPrompts.length === 0) {
    return {
      ok: true,
      package_id: id,
      state: 'not_prepared',
      selections_count: selections.length,
      entries: [],
    };
  }

  // Validate one-to-one: every selection prompt_index must have a matching video prompt, and vice versa
  const selIndices = new Set(selections.map((s) => Number(s.prompt_index)));
  const vpIndices = new Set(vpPrompts.map((p) => Number(p.prompt_index)));
  const missingInVp = [...selIndices].filter((idx) => !vpIndices.has(idx));
  const extraInVp = [...vpIndices].filter((idx) => !selIndices.has(idx));

  if (missingInVp.length > 0 || extraInVp.length > 0) {
    const parts = [];
    if (missingInVp.length > 0) parts.push(`selections without video prompts: ${missingInVp.join(', ')}`);
    if (extraInVp.length > 0) parts.push(`video prompts without selections: ${extraInVp.join(', ')}`);
    const error = new Error(`video-prompts.json does not match selected-images.json: ${parts.join('; ')}`);
    error.statusCode = 409;
    throw error;
  }

  const entries = [];
  for (const selection of selections) {
    if (!selection || typeof selection !== 'object') continue;
    const promptIndex = Number(selection.prompt_index);
    const selectedRel = String(selection.selected_path || '');
    const label = labelFromSelectedPath(selectedRel);
    const imagePath = path.join(packageDir, selectedRel);
    const imageExists = fs.existsSync(imagePath);
    const vpItem = vpPrompts.find((p) => Number(p.prompt_index) === promptIndex);
    const promptText = vpItem ? String(vpItem.prompt || '') : '';
    entries.push({
      label,
      prompt_index: promptIndex,
      selected_path: selectedRel,
      image_exists: imageExists,
      prompt_text: promptText,
    });
  }
  return {
    ok: true,
    package_id: id,
    state: 'ready',
    selections_count: entries.length,
    entries,
  };
}

function handlePackageVideoPrompts(req, res, url) {
  try {
    const result = readPackageVideoPrompts(url.searchParams.get('package_id'));
    sendJSON(res, 200, result);
  } catch (error) {
    sendError(res, error.statusCode || 500, error.message, null);
  }
}

function fluxRunningSeconds(job, now = Date.now()) {
  const started = Date.parse(job.startedAt);
  const ended = job.completedAt ? Date.parse(job.completedAt) : now;
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0;
  return Math.max(0, Math.floor((ended - started) / 1000));
}

function serializeFluxJob(job, active, now = Date.now()) {
  if (!job) {
    return {
      active: false,
      job_id: null,
      package_id: null,
      mode: null,
      pid: null,
      started_at: null,
      elapsed_seconds: 0,
      eta_seconds: 0,
      progress_pct: 0,
      eta_label: '',
      stdout_tail: '',
      stderr_tail: '',
      exit_code: null,
      exit_state: null,
    };
  }
  const elapsed = fluxRunningSeconds(job, now);
  // FLUX.1 Dev GGUF Q8_0 on RTX 5070 Ti: ~48s per 1080x1920 image
  // Batch size varies; use 120s as fallback estimate per image
  const FLUX_TYPICAL_SECONDS = 48;
  const etaSeconds = active ? Math.max(0, FLUX_TYPICAL_SECONDS - elapsed) : 0;
  const etaPct = Math.min(100, Math.round((elapsed / FLUX_TYPICAL_SECONDS) * 100));
  return {
    active,
    job_id: job.jobId,
    package_id: job.packageId,
    mode: job.mode,
    pid: job.pid || null,
    started_at: job.startedAt,
    elapsed_seconds: elapsed,
    eta_seconds: etaSeconds,
    progress_pct: etaPct,
    eta_label: active ? formatEta(etaSeconds) : 'Done',
    stdout_tail: tailOutput(job.stdout, 4096),
    stderr_tail: tailOutput(job.stderr, 4096),
    exit_code: job.exitCode == null ? null : job.exitCode,
    exit_state: job.exitState || (active ? 'running' : 'completed'),
  };
}

function currentFluxJobStatus(now = Date.now()) {
  const job = FLUX_STATE.activeJob;
  if (!job) return serializeFluxJob(null, false, now);
  if (!job.completedAt) return serializeFluxJob(job, true, now);
  const completedAt = Date.parse(job.completedAt);
  if (Number.isFinite(completedAt) && now - completedAt <= PRESTO_COMPLETED_TTL_MS) {
    return serializeFluxJob(job, false, now);
  }
  FLUX_STATE.activeJob = null;
  return serializeFluxJob(null, false, now);
}

// ── Super Focus project lifecycle guards ─────────────────────────────────────
// A lifecycle mutation (archive / restore / permanent delete) must not race an
// active generation job that could write into the project, nor another
// lifecycle mutation on the same project. Busy detection is honest: it refuses
// only when a live FLUX or PRESTO job is bound to THIS project id; it never
// claims to cancel remote work.
const SUPER_FOCUS_LIFECYCLE_LOCKS = new Set();

function superFocusProjectBusyReason(id) {
  const flux = currentFluxJobStatus();
  if (flux.active && flux.package_id === id) {
    return 'an image generation job is currently running for this project';
  }
  const presto = currentPrestoJobStatus();
  if (presto.active && presto.active.package_id === id) {
    return 'a video generation job is currently running for this project';
  }
  return null;
}

// Runs one lifecycle mutation under the per-project lock with the busy check.
// `busyCheck` is injectable (tests); defaults to the live job inspection.
function runSuperFocusLifecycleOp(id, label, busyCheck, op) {
  if (SUPER_FOCUS_LIFECYCLE_LOCKS.has(id)) {
    const error = new Error(`Another lifecycle operation is already running for this project.`);
    error.statusCode = 409;
    error.code = 'lifecycle_locked';
    throw error;
  }
  const busy = (busyCheck || superFocusProjectBusyReason)(id);
  if (busy) {
    const error = new Error(`Cannot ${label} this project: ${busy}. Wait for it to finish (or cancel it) and try again.`);
    error.statusCode = 409;
    error.code = 'project_busy';
    throw error;
  }
  SUPER_FOCUS_LIFECYCLE_LOCKS.add(id);
  try {
    return op();
  } finally {
    SUPER_FOCUS_LIFECYCLE_LOCKS.delete(id);
  }
}

function validateFluxSubmitPayload(payload = {}, options = {}) {
  const { packageId, paths } = resolveAigenPackageDir(payload.package_id, options);
  const fluxScript = options.fluxScript || paths.fluxScript;
  if (!fs.existsSync(fluxScript)) {
    const error = new Error(`FLUX run-handoff.py not found: ${fluxScript}`);
    error.statusCode = 500;
    throw error;
  }
  const limit = Number(payload.limit || 0);
  if (!Number.isInteger(limit) || limit < 0) {
    const error = new Error('limit must be a non-negative integer.');
    error.statusCode = 400;
    throw error;
  }
  return {
    packageId,
    fluxScript,
    pythonBin: options.pythonBin || paths.pythonBin,
    limit,
    skipExisting: payload.skip_existing !== false,
    dryRun: Boolean(payload.dry_run),
  };
}

function startFluxPackageJob(payload = {}, options = {}) {
  const current = currentFluxJobStatus();
  if (current.active) {
    const error = new Error('FLUX job already active');
    error.statusCode = 409;
    error.active = current;
    throw error;
  }
  // Pre-flight: run-handoff.py drives generation through the `comfy` CLI; a
  // missing CLI must refuse here (clear 503), not fail every row after spawn.
  // Checked before payload validation — the lane is blocked regardless of input.
  if (!comfyCliResolvable(options)) throw comfyCliBlockedError();
  const config = validateFluxSubmitPayload(payload, options);
  return launchFluxHandoffJob({
    fluxScript: config.fluxScript,
    pythonBin: config.pythonBin,
    packageArg: config.packageId,
    packageId: config.packageId,
    limit: config.limit,
    skipExisting: config.skipExisting,
    dryRun: config.dryRun,
  }, payload, options);
}

// Shared FLUX spawn + job tracking. Callers MUST check currentFluxJobStatus()
// for an active job first (single-GPU lock). config.packageArg is the literal
// --package value; run-handoff.py accepts an absolute dir (Super Focus lane) or
// a script-packages id (aigen lane). Sets FLUX_STATE.activeJob.
function launchFluxHandoffJob(config, payload = {}, options = {}) {
  const args = [
    config.fluxScript,
    '--package',
    config.packageArg,
  ];
  if (config.limit > 0) args.push('--limit', String(config.limit));
  if (config.skipExisting) args.push('--skip-existing');
  if (config.dryRun) args.push('--dry-run');
  // Only present for a routed-to-PRESTO image job; the default vidnux run omits
  // it and generates in-place. run-handoff.py must honor --comfyui-url (Patch 2).
  if (config.comfyuiUrl) args.push('--comfyui-url', String(config.comfyuiUrl));
  // Only set by explicit regeneration when the handoff advertises seed support;
  // forces a fresh sample so a rerun is not byte-identical. Normal batch runs
  // never pass it (deterministic behavior preserved).
  if (config.seed != null && Number.isFinite(Number(config.seed))) args.push('--seed', String(Math.round(Number(config.seed))));
  const genEnv = workflowGenerationEnv(payload);
  const spawnFn = options.spawn || childProcess.spawn;
  const child = spawnFn(config.pythonBin, args, {
    cwd: path.dirname(config.fluxScript),
    stdio: ['ignore', 'pipe', 'pipe'],
    // PATH is repaired so run-handoff.py can resolve the `comfy` CLI even when
    // the cockpit itself was launched with a minimal service PATH (systemd).
    env: { ...process.env, PATH: fluxDispatchPath(), ...genEnv.env },
  });
  const job = {
    process: child,
    jobId: crypto.randomUUID(),
    packageId: config.packageId,
    lane: config.lane || 'aigen',
    workflowPath: genEnv.workflowPath,
    orientation: genEnv.orientation,
    targetResolution: genEnv.targetResolution,
    mode: config.dryRun ? 'dry_run' : 'real',
    pid: child.pid || null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    exitState: 'running',
    signal: null,
    stdout: '',
    stderr: '',
    args,
  };
  FLUX_STATE.activeJob = job;
  const appendFluxOutput = (currentOutput, chunk) => tailOutput(appendCappedOutput(currentOutput, chunk), 8192);
  if (child.stdout && child.stdout.on) {
    child.stdout.on('data', (chunk) => { job.stdout = appendFluxOutput(job.stdout, chunk); });
  }
  if (child.stderr && child.stderr.on) {
    child.stderr.on('data', (chunk) => { job.stderr = appendFluxOutput(job.stderr, chunk); });
  }
  child.on('error', (error) => {
    job.stderr = appendFluxOutput(job.stderr, `${error.message}\n`);
    job.exitCode = 1;
    job.exitState = 'failed';
    job.completedAt = job.completedAt || new Date().toISOString();
  });
  child.on('close', (code, signal) => {
    job.exitCode = code;
    job.signal = signal || null;
    if (job.exitState !== 'cancelled') job.exitState = code === 0 ? 'completed' : 'failed';
    job.completedAt = job.completedAt || new Date().toISOString();
  });
  return {
    ok: true,
    job_id: job.jobId,
    package_id: config.packageId,
    mode: job.mode,
    pid: job.pid,
  };
}

// Start a Super Focus image batch: materialize prompts into the project's VIDNAS
// media dir, then dispatch run-handoff.py against that absolute dir. Reuses the
// single global FLUX lock (GPU-safe). No ComfyUI auto-start; no cloud fallback.
function startSuperFocusImageJob(mediaDir, options = {}) {
  const current = currentFluxJobStatus();
  if (current.active) {
    const error = new Error('A FLUX image job is already running. Wait for it to finish.');
    error.statusCode = 409;
    error.active = current;
    throw error;
  }
  const fluxScript = options.fluxScript || FLUX_STATE.script;
  if (!fs.existsSync(fluxScript)) {
    const error = new Error(`FLUX run-handoff.py not found: ${fluxScript}`);
    error.statusCode = 500;
    throw error;
  }
  // Pre-flight: the dispatch chain needs the `comfy` CLI (see comfyCliResolvable).
  if (!comfyCliResolvable(options)) throw comfyCliBlockedError();
  return launchFluxHandoffJob({
    fluxScript,
    pythonBin: options.pythonBin || 'python3',
    packageArg: mediaDir,
    packageId: options.projectId || mediaDir,
    limit: Number(options.limit) > 0 ? Number(options.limit) : 0,
    skipExisting: options.skipExisting !== false,
    dryRun: Boolean(options.dryRun),
    comfyuiUrl: options.comfyuiUrl || null,
    seed: options.seed != null ? options.seed : null,
    lane: 'super-focus',
  }, options.payload || {}, options);
}

function cancelFluxJob(options = {}) {
  const status = currentFluxJobStatus();
  if (!status.active) {
    return Promise.resolve({ ok: true, package_id: null, signal_sent: 'none (no active job)' });
  }
  const job = FLUX_STATE.activeJob;
  const child = job.process;
  const killFn = options.kill || ((signal) => child.kill(signal));
  return new Promise((resolve) => {
    let settled = false;
    let signalSent = 'SIGTERM';
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ ok: true, package_id: job.packageId, signal_sent: signalSent });
    };
    const timeout = setTimeout(() => {
      if (!job.completedAt) {
        try { killFn('SIGKILL'); signalSent = 'SIGKILL'; } catch (_) {}
        job.signal = job.signal || 'SIGKILL';
        job.exitState = 'cancelled';
        job.completedAt = job.completedAt || new Date().toISOString();
      }
      finish();
    }, options.killAfterMs || 5000);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      job.exitCode = code;
      job.signal = signal || job.signal || null;
      job.exitState = 'cancelled';
      job.completedAt = job.completedAt || new Date().toISOString();
      finish();
    });
    try {
      job.exitState = 'cancelled';
      killFn('SIGTERM');
    } catch (error) {
      clearTimeout(timeout);
      settled = true;
      resolve({ ok: false, error: error.message, package_id: job.packageId, signal_sent: 'none' });
    }
  });
}

function promptCountForPackage(packageDir) {
  const imagePrompts = safeReadJson(path.join(packageDir, 'image-prompts.json'), null);
  return imagePrompts && Array.isArray(imagePrompts.image_prompts) ? imagePrompts.image_prompts.length : 0;
}

function normalizeFluxManifestItem(item = {}) {
  const index = Number(item.index == null ? item.prompt_index : item.index);
  const outputPath = item.output_path || item.path || (Number.isInteger(index) ? `images/flux-local/flux-${String(index).padStart(3, '0')}.png` : '');
  const label = item.label || (outputPath ? path.basename(outputPath, path.extname(outputPath)) : Number.isInteger(index) ? `flux-${String(index).padStart(3, '0')}` : '');
  return {
    index: Number.isInteger(index) ? index : null,
    label,
    status: item.status || 'pending',
    output_path: outputPath,
    error: item.error || item.message || '',
  };
}

function summarizeFluxItems(items, totalPrompts) {
  const summary = { total_prompts: totalPrompts, complete: 0, failed: 0, dry_run: 0, pending: 0 };
  items.forEach((item) => {
    if (item.status === 'complete' || item.status === 'skipped') summary.complete += 1;
    else if (item.status === 'failed') summary.failed += 1;
    else if (item.status === 'dry_run') summary.dry_run += 1;
    else summary.pending += 1;
  });
  summary.pending = Math.max(summary.pending, Math.max(0, totalPrompts - items.length));
  return summary;
}

function readFluxResults(packageId, options = {}) {
  const { packageId: id, packageDir } = resolveAigenPackageDir(packageId, options);
  const totalPrompts = promptCountForPackage(packageDir);
  const manifestPath = path.join(packageDir, 'flux-generation-manifest.json');
  const manifest = safeReadJson(manifestPath, null);
  if (!manifest || !Array.isArray(manifest.items)) {
    return {
      ok: true,
      package_id: id,
      manifest_exists: false,
      items: [],
      summary: summarizeFluxItems([], totalPrompts),
    };
  }
  const items = manifest.items.map(normalizeFluxManifestItem).sort((a, b) => (a.index || 0) - (b.index || 0));
  return {
    ok: true,
    package_id: id,
    manifest_exists: true,
    items,
    summary: summarizeFluxItems(items, Math.max(totalPrompts, items.length)),
  };
}

function handleFluxSubmit(req, res) {
  readJsonBody(req)
    .then((payload) => {
      validateLocalWriteRequest(req, payload);
      const result = startFluxPackageJob(payload);
      sendJSON(res, 200, result);
    })
    .catch((error) => {
      if (error.statusCode === 409) {
        sendError(res, 409, error.message, null, { active: error.active });
        return;
      }
      sendError(res, error.statusCode === 404 ? 400 : error.statusCode || 500, error.message, null);
    });
}

function handleFluxJobStatus(req, res) {
  sendJSON(res, 200, currentFluxJobStatus());
}

function handleFluxCancel(req, res) {
  try {
    validateLocalWriteRequest(req, {});
  } catch (error) {
    sendError(res, error.statusCode || 403, error.message, null);
    return;
  }
  cancelFluxJob()
    .then((result) => {
      if (result.ok) {
        sendJSON(res, 200, result);
      } else {
        sendError(res, 400, result.error || 'Operation failed', null);
      }
    })
    .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
}

function handleFluxResults(req, res, url) {
  try {
    sendJSON(res, 200, readFluxResults(url.searchParams.get('package_id')));
  } catch (error) {
    sendError(res, error.statusCode || 500, error.message, null);
  }
}

function readRunArtifacts(runDir, filenames = []) {
  return filenames.reduce((result, filename) => {
    const artifactPath = path.join(runDir, filename);
    result[filename] = fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, 'utf8') : '';
    return result;
  }, {});
}

function runPackageRunScript(payload = {}, scriptName, parser = parseLabelValueStdout, artifactFiles = [], options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const repoRoot = resolved.root;
  const runPath = `${PACKAGE_RUNS_DIR}/${resolved.runId}`;
  const result = childProcess.spawnSync(process.execPath, [`scripts/${scriptName}`, runPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  return {
    ok: result.status === 0,
    runId: resolved.runId,
    runPath,
    command: `node scripts/${scriptName} ${runPath}`,
    exitCode: result.status,
    stdout,
    stderr,
    summary: parser(stdout),
    artifacts: readRunArtifacts(resolved.runDir, artifactFiles),
    warning: 'Script endpoint is scoped to the selected package run. It does not commit, push, publish, or update package-runs-index.json.',
  };
}

function runFinalReview(payload = {}, options = {}) {
  return runPackageRunScript(payload, 'package-run-final-review.js', parseLabelValueStdout, ['final-review.md', 'publication-blockers.md'], options);
}

function runExportChecklist(payload = {}, options = {}) {
  return runPackageRunScript(payload, 'package-run-export-checklist.js', parseLabelValueStdout, ['export-checklist.md', 'master-file-manifest.md', 'delivery-readiness.md'], options);
}

function runPublicationMetadata(payload = {}, options = {}) {
  return runPackageRunScript(payload, 'package-run-publication-metadata.js', parseLabelValueStdout, ['publish-metadata-review.md', 'title-check.md', 'thumbnail-check.md', 'description-check.md'], options);
}

function buildPostPublishLearningTemplate(runId, fields = {}) {
  const publishedUrl = markdownCell(fields.youtubeUrl || fields.publishedUrl || '');
  const publishedAt = markdownCell(fields.publishedAt || new Date().toISOString());
  return `# Post-Publish Learning

- Run: ${runId}
- Tool: publish-gate.html
- Status: starter template
- External APIs called: no
- Published URL: ${publishedUrl || 'TODO'}
- Published at: ${publishedAt}

## First 24 Hours

- Views:
- Click-through rate:
- Average view duration:
- Audience retention note:

## Packaging Notes

- Title performance:
- Thumbnail performance:
- Description/tags note:

## Editorial Notes

- What worked:
- What confused viewers:
- What to tighten next time:

## Follow-Up Actions

- [ ] Review analytics after 24 hours.
- [ ] Decide whether thumbnail/title iteration is needed.
- [ ] Capture reusable lesson for the next package run.
`;
}

function ensurePostPublishLearning(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const targetPath = path.join(resolved.runDir, 'post-publish-learning.md');
  if (!targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved post-publish learning path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, buildPostPublishLearningTemplate(resolved.runId, payload), 'utf8');
    return { filename: 'post-publish-learning.md', status: 'created', content: fs.readFileSync(targetPath, 'utf8') };
  }
  return { filename: 'post-publish-learning.md', status: 'exists', content: fs.readFileSync(targetPath, 'utf8') };
}

function runArchiveManifest(payload = {}, options = {}) {
  const output = runPackageRunScript(payload, 'package-run-archive-manifest.js', parseLabelValueStdout, ['archive-manifest.md', 'archive-blockers.md'], options);
  const learning = ensurePostPublishLearning(payload, options);
  return {
    ...output,
    postPublishLearning: learning,
    artifacts: {
      ...output.artifacts,
      [learning.filename]: learning.content,
    },
  };
}

function regenerateRoughCutDerivedArtifacts(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const watchNotesPath = path.join(resolved.runDir, ROUGH_CUT_WATCH_NOTES_FILE);
  const beforeWatchNotes = fs.existsSync(watchNotesPath) ? fs.readFileSync(watchNotesPath, 'utf8') : null;
  const outputs = roughCutReviewScript.buildOutputs(resolved.runDir);
  const filteredOutputs = {
    ...outputs,
    files: outputs.files.filter(([filename]) => ROUGH_CUT_DERIVED_FILES.includes(filename)),
  };
  const unexpected = filteredOutputs.files.find(([filename]) => !ROUGH_CUT_DERIVED_FILES.includes(filename));
  if (unexpected) {
    const error = new Error(`Unexpected rough-cut derived regeneration target: ${unexpected[0]}`);
    error.statusCode = 500;
    throw error;
  }
  const targetPaths = filteredOutputs.files.map(([filename]) => path.resolve(resolved.runDir, filename));
  targetPaths.forEach((targetPath) => {
    if (!targetPath.startsWith(resolved.runDir + path.sep)) {
      const error = new Error('Resolved rough-cut derived artifact path is outside the approved write scope.');
      error.statusCode = 400;
      throw error;
    }
  });
  const results = roughCutReviewScript.writeOutputs(resolved.runDir, filteredOutputs, true);
  const afterWatchNotes = fs.existsSync(watchNotesPath) ? fs.readFileSync(watchNotesPath, 'utf8') : null;
  if (beforeWatchNotes !== afterWatchNotes) {
    const error = new Error('Safety stop: rough-cut-watch-notes.md changed during derived regeneration.');
    error.statusCode = 500;
    throw error;
  }
  const review = parseRoughCutReviewFile(resolved.runDir);
  return {
    ok: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    written: results.map(([filename]) => filename),
    results: results.map(([filename, status]) => ({ filename, status })),
    review,
    approvedForSecondCut: false,
    warning: 'Regenerated derived rough-cut review artifacts only. rough-cut-watch-notes.md, package-runs-index.json, and package-run-state.md were not updated. This is not approval.',
  };
}

function openRoughCutVideo(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const requested = markdownCell(payload.filePath || payload.reviewedFilePath || '');
  if (!requested) {
    const error = new Error('Reviewed file path is required.');
    error.statusCode = 400;
    throw error;
  }
  const absolute = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(resolved.runDir, requested);
  const allowedRoots = [resolved.runDir, path.resolve(options.videoRoot || path.join(process.env.HOME || '', 'Videos'))].filter(Boolean);
  if (!allowedRoots.some((root) => absolute === root || absolute.startsWith(root + path.sep))) {
    const error = new Error('Open video path must be inside the package run or ~/Videos.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(absolute)) {
    const error = new Error('Reviewed file does not exist.');
    error.statusCode = 404;
    throw error;
  }
  const opener = options.opener || childProcess.spawn;
  const child = opener('vlc', [absolute], {
    detached: true,
    stdio: 'ignore',
  });
  if (child && typeof child.unref === 'function') child.unref();
  return {
    ok: true,
    runId: resolved.runId,
    opened: absolute,
    command: `vlc ${absolute}`,
  };
}

function resolvePackageRunOpenTarget(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const rawAssetPath = markdownCell(payload.assetPath || payload.path || '');
  if (!rawAssetPath) {
    return { ...resolved, requested: '', targetPath: resolved.runDir, openedPath: resolved.runDir, targetExists: true };
  }
  if (path.isAbsolute(rawAssetPath) || rawAssetPath.includes('\\')) {
    const error = new Error('Asset path must be relative to the package-run folder.');
    error.statusCode = 400;
    throw error;
  }
  const normalized = path.posix.normalize(rawAssetPath);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    const error = new Error('Asset path escaped the package-run folder.');
    error.statusCode = 400;
    throw error;
  }
  const targetPath = path.resolve(resolved.runDir, normalized);
  if (targetPath !== resolved.runDir && !targetPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved asset path escaped the package-run folder.');
    error.statusCode = 400;
    throw error;
  }
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    return {
      ...resolved,
      requested: normalized,
      targetPath,
      openedPath: stat.isDirectory() ? targetPath : path.dirname(targetPath),
      targetExists: true,
    };
  }
  const parentPath = path.dirname(targetPath);
  const openedPath = parentPath.startsWith(resolved.runDir + path.sep) && fs.existsSync(parentPath) ? parentPath : resolved.runDir;
  return { ...resolved, requested: normalized, targetPath, openedPath, targetExists: false };
}

function openPackageRunAssetFolder(payload = {}, options = {}) {
  const resolved = resolvePackageRunOpenTarget(payload, options);
  if (!fs.existsSync(resolved.openedPath) || !fs.statSync(resolved.openedPath).isDirectory()) {
    const error = new Error('Folder to open does not exist.');
    error.statusCode = 404;
    throw error;
  }
  const opener = options.opener || childProcess.spawn;
  const command = options.command || 'xdg-open';
  const child = opener(command, [resolved.openedPath], {
    detached: true,
    stdio: 'ignore',
  });
  if (child && typeof child.unref === 'function') child.unref();
  return {
    ok: true,
    runId: resolved.runId,
    requested: resolved.requested,
    opened: resolved.openedPath,
    target: resolved.targetPath,
    targetExists: resolved.targetExists,
    command: `${command} ${resolved.openedPath}`,
  };
}


// ── Package-run text-artifact access (read-only text + nonce-gated open) ──
const PACKAGE_RUN_ARTIFACT_TEXT_MAX_BYTES = 1024 * 1024;
const ARTIFACT_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv']);
const PACKAGE_RUN_ARTIFACT_TEXT_BLOCKLIST = new Set(['package-run-state.md']);
const PACKAGE_RUN_ARTIFACT_LABELS = {
  'selected-package.md': 'Selected Package',
  'final-outline.md': 'Final Outline',
  'final-script.md': 'Final Script',
  'production-plan.md': 'Production Plan',
  'shot-edit-plan-review.md': 'Shot/Edit Plan Review',
  'capture-checklist.md': 'Capture Checklist',
  'capture-evidence-review.md': 'Capture Evidence Review',
  'rough-cut-watch-notes.md': 'Rough-Cut Watch Notes',
  'rough-cut-review.md': 'Rough-Cut Review',
  'final-watch-notes.md': 'Final Watch Notes',
  'final-review.md': 'Final Review',
  'publish-pack.md': 'Publish Pack',
};

function prettifyArtifactFilename(filename) {
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function artifactLabel(filename) {
  return PACKAGE_RUN_ARTIFACT_LABELS[filename] || prettifyArtifactFilename(filename);
}

function resolvePackageRunTextFile(runId, file, options = {}) {
  const resolved = resolvePackageRunDir(runId, options);
  const filename = String(file == null ? '' : file).trim();
  const reject = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
  };
  if (!filename) reject('File is required.');
  if (filename.includes('\0')) reject('File name contains an invalid character.');
  if (filename.includes('..') || filename.startsWith('/') || path.isAbsolute(filename) || filename.includes('\\')) {
    reject('File path escaped the package-run folder.');
  }
  if (PACKAGE_RUN_ARTIFACT_TEXT_BLOCKLIST.has(filename)) {
    reject(`${filename} is not a text artifact.`);
  }
  if (!ARTIFACT_TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
    reject('Unsupported file type.');
  }
  const filePath = path.resolve(path.join(resolved.runDir, filename));
  if (!filePath.startsWith(resolved.runDir + path.sep)) {
    reject('File path escaped the package-run folder.');
  }
  return { ...resolved, filename, filePath };
}

function readPackageRunArtifactText(runId, file, options = {}) {
  const resolved = resolvePackageRunTextFile(runId, file, options);
  if (!fs.existsSync(resolved.filePath) || !fs.statSync(resolved.filePath).isFile()) {
    const error = new Error('File not found');
    error.statusCode = 404;
    error.exists = false;
    throw error;
  }
  const stats = fs.statSync(resolved.filePath);
  if (stats.size > PACKAGE_RUN_ARTIFACT_TEXT_MAX_BYTES) {
    const error = new Error('File exceeds maximum size.');
    error.statusCode = 413;
    throw error;
  }
  return {
    runId: resolved.runId,
    file: resolved.filename,
    content: fs.readFileSync(resolved.filePath, 'utf8'),
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

function listPackageRunArtifacts(runId, options = {}) {
  const resolved = resolvePackageRunDir(runId, options);
  const artifacts = fs.readdirSync(resolved.runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((filename) => filename && !filename.startsWith('.'))
    .filter((filename) => !PACKAGE_RUN_ARTIFACT_TEXT_BLOCKLIST.has(filename))
    .filter((filename) => ARTIFACT_TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase()))
    .map((filename) => {
      const filePath = path.join(resolved.runDir, filename);
      const stats = fs.statSync(filePath);
      if (stats.size > PACKAGE_RUN_ARTIFACT_TEXT_MAX_BYTES) return null;
      return {
        file: filename,
        label: artifactLabel(filename),
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.file.localeCompare(b.file));
  return {
    runId: resolved.runId,
    artifacts,
  };
}

function openPackageRunFile(payload = {}, options = {}) {
  const resolved = resolvePackageRunTextFile(payload.runId, payload.file, options);
  if (!fs.existsSync(resolved.filePath) || !fs.statSync(resolved.filePath).isFile()) {
    const error = new Error('File not found');
    error.statusCode = 404;
    error.exists = false;
    throw error;
  }
  const opener = options.opener || childProcess.spawn;
  const command = options.command || 'xdg-open';
  const child = opener(command, [resolved.filePath], {
    detached: true,
    stdio: 'ignore',
  });
  if (child && typeof child.unref === 'function') child.unref();
  return {
    ok: true,
    runId: resolved.runId,
    file: resolved.filename,
    opened: resolved.filePath,
    command: `${command} ${resolved.filePath}`,
  };
}

function conservativeHeadingForTarget(filename) {
  const titles = {
    'takes-log.md': 'Takes Log',
    'screen-recording-checklist.md': 'Screen Recording Checklist',
    'audio-capture-checklist.md': 'Audio Capture Checklist',
  };
  return `# ${titles[filename] || filename}\n\nGenerated intake rows are local notes only. They do not approve capture evidence.\n`;
}

function markedCaptureEvidenceSection(row) {
  return [
    CAPTURE_EVIDENCE_SECTION_START,
    '| item | source / purpose | file/reference | notes | status |',
    '| --- | --- | --- | --- | --- |',
    row,
    CAPTURE_EVIDENCE_SECTION_END,
    '',
  ].join('\n');
}

function replaceMarkedSection(existing, section) {
  const start = existing.indexOf(CAPTURE_EVIDENCE_SECTION_START);
  const end = existing.indexOf(CAPTURE_EVIDENCE_SECTION_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start).replace(/\s*$/, '\n\n');
    const after = existing.slice(end + CAPTURE_EVIDENCE_SECTION_END.length).replace(/^\s*/, '\n');
    return `${before}${section}${after}`.replace(/\n{4,}/g, '\n\n\n');
  }
  return `${existing.replace(/\s*$/, '')}\n\n${section}`;
}

function buildCaptureEvidencePreview(payload = {}, options = {}) {
  const { runId, runDir } = resolvePackageRunDir(payload.runId, options);
  const targets = validateCaptureEvidenceTargets(payload.targets);
  const fields = normalizeCaptureEvidenceFields(payload.fields || payload);
  const rows = formatCaptureEvidenceRows(fields);
  if (!rows.valid) {
    const error = new Error(`Missing required capture evidence fields: ${rows.missing.join(', ')}.`);
    error.statusCode = 400;
    error.missing = rows.missing;
    throw error;
  }
  const sections = targets.reduce((result, filename) => {
    result[filename] = markedCaptureEvidenceSection(rows.targets[filename]);
    return result;
  }, {});
  const previewToken = crypto
    .createHash('sha256')
    .update(JSON.stringify({ runId, fields, targets, sections }))
    .digest('hex');
  return {
    ok: true,
    mode: 'preview',
    runId,
    runPath: `${PACKAGE_RUNS_DIR}/${runId}`,
    runDir,
    targets,
    fields,
    sections,
    previewToken,
    warning: 'Preview only. No files were written. Applying rows does not approve capture evidence.',
  };
}

function applyCaptureEvidenceIntake(payload = {}, options = {}) {
  const preview = buildCaptureEvidencePreview(payload, options);
  if (payload.confirmApply !== true || payload.previewToken !== preview.previewToken) {
    const error = new Error('Apply requires confirmApply: true and the matching previewToken.');
    error.statusCode = 400;
    throw error;
  }
  const allowedPaths = new Set([
    ...CAPTURE_EVIDENCE_TARGETS.map((filename) => path.resolve(preview.runDir, filename)),
    path.resolve(preview.runDir, CAPTURE_EVIDENCE_AUDIT_FILE),
  ]);
  const written = [];
  preview.targets.forEach((filename) => {
    const targetPath = path.resolve(preview.runDir, filename);
    if (!allowedPaths.has(targetPath) || !targetPath.startsWith(preview.runDir + path.sep)) {
      const error = new Error('Resolved target is outside the approved write scope.');
      error.statusCode = 400;
      throw error;
    }
    const existing = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, 'utf8')
      : conservativeHeadingForTarget(filename);
    const next = replaceMarkedSection(existing, preview.sections[filename]);
    fs.writeFileSync(targetPath, next, 'utf8');
    written.push(filename);
  });
  const auditPath = path.resolve(preview.runDir, CAPTURE_EVIDENCE_AUDIT_FILE);
  if (!allowedPaths.has(auditPath)) {
    const error = new Error('Resolved audit path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const timestamp = new Date().toISOString();
  const auditEntry = [
    `## ${timestamp}`,
    '',
    `- Run: ${preview.runId}`,
    `- Tool: package-runs dashboard capture evidence intake`,
    '- External APIs called: no',
    `- Target files: ${preview.targets.join(', ')}`,
    '- Approval written: no',
    '',
    '| field | value |',
    '| --- | --- |',
    ...Object.entries(preview.fields).map(([key, value]) => `| ${key} | ${value || 'not provided'} |`),
    '',
  ].join('\n');
  const auditExisting = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, 'utf8').replace(/\s*$/, '\n\n')
    : '# Capture Evidence Intake Log\n\n';
  fs.writeFileSync(auditPath, `${auditExisting}${auditEntry}`, 'utf8');
  written.push(CAPTURE_EVIDENCE_AUDIT_FILE);
  return {
    ok: true,
    mode: 'apply',
    runId: preview.runId,
    runPath: preview.runPath,
    written,
    previewToken: preview.previewToken,
    warning: 'Rows were written locally. Capture evidence is not approved until the review gate passes.',
    nextCommands: [
      `node scripts/package-run-capture-evidence-review.js ${preview.runPath} --overwrite`,
      'node scripts/package-runs-index.js',
    ],
  };
}

function markdownTableCells(row = '') {
  return String(row || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownSeparatorRow(cells = []) {
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownTableRows(markdown = '') {
  const rows = [];
  const lines = String(markdown || '').split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index].trim();
    const separatorLine = lines[index + 1].trim();
    if (!headerLine.startsWith('|') || !headerLine.endsWith('|')) continue;
    if (!separatorLine.startsWith('|') || !separatorLine.endsWith('|')) continue;
    const header = markdownTableCells(headerLine);
    const separator = markdownTableCells(separatorLine);
    if (!isMarkdownSeparatorRow(separator)) continue;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex].trim();
      if (!line.startsWith('|') || !line.endsWith('|')) break;
      const cells = markdownTableCells(line);
      if (isMarkdownSeparatorRow(cells)) continue;
      rows.push({ header, cells, lineNumber: rowIndex + 1, row: line });
    }
  }
  return rows;
}

function tableCellByPattern(headers = [], cells = [], patterns = []) {
  const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  return index >= 0 ? String(cells[index] || '').trim() : '';
}

function stripMarkdownTicks(value = '') {
  return String(value || '').trim().replace(/^`|`$/g, '');
}

function evidenceTypeFromFile(filename, row = '') {
  const text = String(row || '');
  if (filename === 'takes-log.md') return /a-roll|talking-head|camera/i.test(text) ? 'camera_capture' : 'camera_capture';
  if (filename === 'screen-recording-checklist.md') return /\.(?:png|jpe?g|webp)$/i.test(text) ? 'screen_capture' : 'screen_capture';
  if (filename === 'audio-capture-checklist.md') return 'audio_capture';
  if (filename === 'missing-shot-tracker.md') return 'other';
  return 'other';
}

function sourceCategoryFromFile(filename, row = '') {
  const text = String(row || '');
  if (filename === 'takes-log.md') return 'A-roll';
  if (filename === 'screen-recording-checklist.md') return 'screen proof';
  if (filename === 'audio-capture-checklist.md') return 'audio';
  if (/kling|generated|prompt-\d+/i.test(text)) return 'generated asset';
  if (/resolve|timeline/i.test(text)) return 'Resolve test';
  return 'other';
}

function evidenceStatusFromRowStatus(status = '') {
  const text = String(status || '').toLowerCase();
  if (/missing/.test(text)) return 'missing';
  if (/rejected/.test(text)) return 'rejected';
  if (/usable|accepted/.test(text)) return 'usable';
  if (/resolve|timeline/.test(text) && /tested/.test(text)) return 'tested_in_resolve';
  if (/imported/.test(text)) return 'imported_to_resolve';
  if (/captured|exists|recorded|review-needed|candidate/.test(text)) return 'exists_on_vidnas';
  return 'planned';
}

function readEvidenceRowsFromArtifact(runDir, filename) {
  const filePath = path.join(runDir, filename);
  if (!fs.existsSync(filePath)) return [];
  const markdown = fs.readFileSync(filePath, 'utf8');
  return markdownTableRows(markdown)
    .map((rowInfo) => {
      const headers = rowInfo.header.map((header) => header.toLowerCase());
      const cells = rowInfo.cells;
      const mediaPath = stripMarkdownTicks(tableCellByPattern(headers, cells, [/file/, /reference/, /path/]));
      const label = tableCellByPattern(headers, cells, [/take/, /screen recording/, /audio item/, /missing shot\/content/, /^item$/]) || cells[0] || '';
      const proofPurpose =
        tableCellByPattern(headers, cells, [/proof purpose/, /capture requirement/, /why it matters/, /source item/, /source\/purpose/, /source/]) ||
        label;
      const rawStatus = tableCellByPattern(headers, cells, [/status/, /readiness/]) || cells[cells.length - 1] || '';
      return {
        media_path: mediaPath,
        media_type: evidenceTypeFromFile(filename, rowInfo.row),
        source_category: sourceCategoryFromFile(filename, rowInfo.row),
        proof_purpose: proofPurpose,
        related_script_block_or_section: '',
        status: evidenceStatusFromRowStatus(rawStatus),
        resolve_tested: /resolve|timeline/i.test(rowInfo.row) && /tested|usable|rejected/i.test(rowInfo.row) ? 'yes' : 'no',
        notes: `${filename}:${rowInfo.lineNumber} ${rawStatus}`.trim(),
        artifact: filename,
        line: rowInfo.lineNumber,
        existsOnDisk: mediaPath ? fs.existsSync(mediaPath) : false,
        evidenceOnly: true,
        approved: false,
        productionReady: false,
      };
    })
    .filter((row) => row.media_path || row.proof_purpose);
}

function normalizeEvidenceIntakeRow(row = {}) {
  const source = row && typeof row === 'object' ? row : {};
  return {
    media_path: markdownCell(source.media_path || source.mediaPath || ''),
    media_type: markdownCell(source.media_type || source.mediaType || ''),
    source_category: markdownCell(source.source_category || source.sourceCategory || ''),
    proof_purpose: markdownCell(source.proof_purpose || source.proofPurpose || ''),
    related_script_block_or_section: markdownCell(source.related_script_block_or_section || source.relatedScriptBlockOrSection || ''),
    status: markdownCell(source.status || ''),
    resolve_tested: /^yes$/i.test(String(source.resolve_tested || source.resolveTested || '')) ? 'yes' : 'no',
    notes: markdownCell(source.notes || ''),
  };
}

function hasPathTraversal(value = '') {
  return /(^|[\\/])\.\.([\\/]|$)/.test(String(value || ''));
}

function isAcceptableEvidencePath(value = '') {
  const text = String(value || '').trim();
  if (!text || hasPathTraversal(text)) return false;
  return (
    path.isAbsolute(text) ||
    /^VIDNAS[/:]/i.test(text) ||
    /\/mnt\/[^|\s]*vidnas/i.test(text) ||
    /\/home\/vidtoolz\/Videos\/vidtoolz-captures\//i.test(text) ||
    /\b(?:media|captures|recordings|audio|videos|vidtoolz-captures)\//i.test(text)
  );
}

function evidenceRowClaimsApproval(row = {}) {
  return /\b(?:approved|approval|production[-_ ]?ready|publish[-_ ]?ready|ready to publish|ready for publish|PASS)\b/i.test(
    `${row.proof_purpose || ''} ${row.status || ''} ${row.notes || ''}`
  );
}

function validateEvidenceIntakeRows(rows = []) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeEvidenceIntakeRow);
  const errors = [];
  const warnings = [];
  if (!normalizedRows.length) errors.push('At least one evidence row is required.');
  normalizedRows.forEach((row, index) => {
    const label = `row ${index + 1}`;
    if (!row.media_path) errors.push(`${label}: media_path is required.`);
    else if (hasPathTraversal(row.media_path)) errors.push(`${label}: path traversal is not allowed.`);
    else if (!isAcceptableEvidencePath(row.media_path)) errors.push(`${label}: media_path must be absolute or a clear VIDNAS/local production path.`);
    if (!row.media_type) errors.push(`${label}: media_type is required.`);
    else if (!EVIDENCE_INTAKE_MEDIA_TYPES.includes(row.media_type)) errors.push(`${label}: unsupported media_type ${row.media_type}.`);
    if (!row.source_category) warnings.push(`${label}: source_category is empty; classify the evidence before relying on it.`);
    else if (!EVIDENCE_INTAKE_SOURCE_CATEGORIES.includes(row.source_category)) errors.push(`${label}: unsupported source_category ${row.source_category}.`);
    if (!row.proof_purpose) errors.push(`${label}: proof_purpose is required.`);
    if (!row.status) errors.push(`${label}: status is required.`);
    else if (!EVIDENCE_INTAKE_STATUSES.includes(row.status)) errors.push(`${label}: unsupported status ${row.status}.`);
    if (row.media_path && isAcceptableEvidencePath(row.media_path) && path.isAbsolute(row.media_path) && !fs.existsSync(row.media_path)) {
      warnings.push(`${label}: MISSING FILE - path does not exist on this machine.`);
    }
    if ((row.status === 'tested_in_resolve' || row.resolve_tested === 'yes') && !/resolve|timeline|tested|usable|rejected/i.test(`${row.notes} ${row.proof_purpose}`)) {
      warnings.push(`${label}: NEEDS RESOLVE TEST notes - tested_in_resolve requires Resolve/timeline notes.`);
    }
    if (/^generated_|kling_candidate/.test(row.media_type) && !/context|illustrative|candidate|not proof|supports|b-roll|resolve|timeline/i.test(`${row.notes} ${row.proof_purpose}`)) {
      warnings.push(`${label}: generated asset needs context before it can support evidence.`);
    }
    if (evidenceRowClaimsApproval(row)) {
      warnings.push(`${label}: evidence row contains approval/readiness language; this intake remains EVIDENCE ONLY, NOT APPROVED, NOT PRODUCTION READY.`);
    }
  });
  return { rows: normalizedRows, valid: errors.length === 0, errors, warnings };
}

function evidenceDraftMarkdown(runId, rows = [], validation = {}) {
  const lines = [
    EVIDENCE_INTAKE_DRAFT_SECTION_START,
    `- Run: ${runId}`,
    '- Tool: package-runs dashboard Evidence Intake',
    '- Mode: evidence-only draft',
    '- Approval written: no',
    '- Capture accepted written: no',
    '- Production readiness written: no',
    '- Publish readiness written: no',
    '',
    '| media_path | media_type | source_category | proof_purpose | related_script_block_or_section | status | resolve_tested | notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.media_path} | ${row.media_type} | ${row.source_category} | ${row.proof_purpose} | ${row.related_script_block_or_section || ''} | ${row.status} | ${row.resolve_tested} | ${row.notes || ''} |`),
    '',
  ];
  if ((validation.warnings || []).length) {
    lines.push('Warnings:');
    validation.warnings.forEach((warning) => lines.push(`- ${warning}`));
    lines.push('');
  }
  lines.push(EVIDENCE_INTAKE_DRAFT_SECTION_END, '');
  return lines.join('\n');
}

function evidenceIntakeSummaryFromNextSafeAction(nextSafeAction = {}) {
  const facts = nextSafeAction.facts || {};
  if (facts.selectedStillCount > 0 && !facts.klingVideoCount) {
    return {
      evidenceStatus: 'selected stills exist, Kling candidates missing',
      nextEvidenceAction: 'Create Kling MP4s manually, move them to VIDNAS, then record them here.',
    };
  }
  if (facts.klingVideoCount > 0 && !facts.resolveTestRecorded) {
    return {
      evidenceStatus: 'Kling candidates exist, Resolve test evidence missing',
      nextEvidenceAction: 'Import the Kling candidates to Resolve and record the timeline test result.',
    };
  }
  return {
    evidenceStatus: nextSafeAction.stage || 'evidence review required',
    nextEvidenceAction: nextSafeAction.nextHumanAction || 'Record concrete media evidence and keep approval separate.',
  };
}

function buildEvidenceIntakeStatus(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const nextSafeAction = nextSafeActionScript.buildNextSafeAction(resolved.runId, { repoRoot: resolved.root });
  const existingRows = [
    ...readEvidenceRowsFromArtifact(resolved.runDir, 'takes-log.md'),
    ...readEvidenceRowsFromArtifact(resolved.runDir, 'screen-recording-checklist.md'),
    ...readEvidenceRowsFromArtifact(resolved.runDir, 'audio-capture-checklist.md'),
    ...readEvidenceRowsFromArtifact(resolved.runDir, 'missing-shot-tracker.md'),
  ];
  const summary = evidenceIntakeSummaryFromNextSafeAction(nextSafeAction);
  return {
    ok: true,
    readOnly: true,
    saveMode: 'controlled-audit-log-draft',
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    evidenceStatus: summary.evidenceStatus,
    nextEvidenceAction: summary.nextEvidenceAction,
    labels: ['EVIDENCE ONLY', 'NOT APPROVED', 'NOT PRODUCTION READY'],
    existingRows,
    existingRowCount: existingRows.length,
    fields: {
      mediaTypes: EVIDENCE_INTAKE_MEDIA_TYPES,
      sourceCategories: EVIDENCE_INTAKE_SOURCE_CATEGORIES,
      statuses: EVIDENCE_INTAKE_STATUSES,
    },
    allowedWriteFiles: [CAPTURE_EVIDENCE_AUDIT_FILE],
    forbiddenActions: [
      'write approval markers',
      'mark capture evidence accepted',
      'mark approved',
      'mark selected',
      'mark production_ready',
      'mark publish_ready',
      'edit package-run-state.md',
      'write manifests',
      'move or generate media',
      'operate Kling',
      'operate Resolve',
    ],
    externalApisCalled: false,
  };
}

function buildEvidenceIntakePreview(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const validation = validateEvidenceIntakeRows(payload.rows || []);
  if (!validation.valid) {
    const error = new Error(`Evidence intake validation failed: ${validation.errors.join(', ')}`);
    error.statusCode = 400;
    error.errors = validation.errors;
    error.warnings = validation.warnings;
    throw error;
  }
  const draftMarkdown = evidenceDraftMarkdown(resolved.runId, validation.rows, validation);
  const previewToken = crypto
    .createHash('sha256')
    .update(JSON.stringify({ runId: resolved.runId, rows: validation.rows, draftMarkdown }))
    .digest('hex');
  return {
    ok: true,
    mode: 'preview',
    readOnly: true,
    runId: resolved.runId,
    runPath: `${PACKAGE_RUNS_DIR}/${resolved.runId}`,
    targetFile: CAPTURE_EVIDENCE_AUDIT_FILE,
    rows: validation.rows,
    errors: [],
    warnings: validation.warnings,
    draftMarkdown,
    previewToken,
    approved: false,
    selected: false,
    captureEvidenceAccepted: false,
    productionReady: false,
    publishReady: false,
    warning: 'Preview only. No files were written. This remains evidence only, not approval.',
  };
}

function saveEvidenceIntakeDraft(payload = {}, options = {}) {
  const preview = buildEvidenceIntakePreview(payload, options);
  if (payload.confirmSave !== true || payload.previewToken !== preview.previewToken) {
    const error = new Error('Save requires confirmSave: true and the matching previewToken.');
    error.statusCode = 400;
    throw error;
  }
  const resolved = resolveRunFromPayload(payload, options);
  const auditPath = path.resolve(resolved.runDir, CAPTURE_EVIDENCE_AUDIT_FILE);
  if (!auditPath.startsWith(resolved.runDir + path.sep)) {
    const error = new Error('Resolved evidence intake audit path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const timestamp = new Date().toISOString();
  const existing = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, 'utf8').replace(/\s*$/, '\n\n')
    : '# Capture Evidence Intake Log\n\n';
  const entry = [
    `## Evidence Intake Draft ${timestamp}`,
    '',
    preview.draftMarkdown,
  ].join('\n');
  fs.writeFileSync(auditPath, `${existing}${entry}`, 'utf8');
  return {
    ok: true,
    mode: 'save',
    runId: resolved.runId,
    runPath: preview.runPath,
    written: [CAPTURE_EVIDENCE_AUDIT_FILE],
    approved: false,
    selected: false,
    captureEvidenceAccepted: false,
    productionReady: false,
    publishReady: false,
    warning: 'Saved evidence-only draft to the capture evidence intake log. No approval or readiness markers were written.',
  };
}

function localWriteNonce() {
  return LOCAL_WRITE_NONCE;
}

function isAllowedLocalHost(value = '', port = PORT) {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function isAllowedLocalOrigin(value = '', port = PORT) {
  if (!value) return true;
  try {
    const origin = new URL(value);
    return origin.protocol === 'http:' && isAllowedLocalHost(origin.host, port);
  } catch {
    return false;
  }
}

function validateLocalWriteRequest(req, payload = {}, options = {}) {
  const port = options.port || PORT;
  const nonce = options.writeNonce || LOCAL_WRITE_NONCE;
  const label = options.label || 'Capture evidence write API';
  const host = req && req.headers ? req.headers.host : '';
  const origin = req && req.headers ? req.headers.origin : '';
  if (!isAllowedLocalHost(host, port)) {
    const error = new Error(`${label} requires a local Host header.`);
    error.statusCode = 403;
    throw error;
  }
  if (!isAllowedLocalOrigin(origin, port)) {
    const error = new Error(`${label} rejects non-local Origin headers.`);
    error.statusCode = 403;
    throw error;
  }
  const providedNonce =
    (req && req.headers && req.headers[LOCAL_WRITE_NONCE_HEADER]) ||
    payload.localWriteNonce ||
    payload.writeNonce ||
    payload.nonce ||
    '';
  if (providedNonce !== nonce) {
    const error = new Error(`${label} requires a valid local write nonce.`);
    error.statusCode = 403;
    throw error;
  }
  return true;
}

function readJsonBody(req, maxBytes = 1024 * 64) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      if (bytes > maxBytes) {
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        fail(error);
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const body = Buffer.concat(chunks, bytes).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        error.statusCode = 400;
        fail(error);
      }
    });
    req.on('error', fail);
  });
}

function createCandidates(payload) {
  const title = payload.topic || payload.thumbnailConcept || payload.viewerPromise || 'VIDTOOLZ thumbnail';
  return Array.from({ length: Number(payload.count || 3) }, (_, idx) => {
    const label = `${title} variation ${idx + 1}`;
    return {
      id: `${slugify(title)}-${idx + 1}`,
      label,
      prompt: `${payload.thumbnailConcept || title} / ${payload.onThumbnailText || ''}`.trim(),
      creator: 'placeholder-svg',
      thumbnailImage: makeDataUrl(label, idx),
    };
  });
}

function providerConfig(env = process.env) {
  const rawTimeout = Number(env.OPENAI_IMAGE_TIMEOUT_MS || DEFAULT_OPENAI_IMAGE_TIMEOUT_MS);
  return {
    provider: String(env.THUMBNAIL_PROVIDER || DEFAULT_THUMBNAIL_PROVIDER).toLowerCase(),
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL,
    size: env.OPENAI_IMAGE_SIZE || DEFAULT_OPENAI_IMAGE_SIZE,
    quality: env.OPENAI_IMAGE_QUALITY || DEFAULT_OPENAI_IMAGE_QUALITY,
    outputFormat: env.OPENAI_IMAGE_FORMAT || DEFAULT_OPENAI_IMAGE_FORMAT,
    timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_OPENAI_IMAGE_TIMEOUT_MS,
  };
}

const COCKPIT_ORIENTATION_API = '/api/cockpit-orientation';

const COCKPIT_OUT_OF_SCOPE = [
  'New AI generation lanes or model integrations',
  'Advancing gates, approvals, publishing, or upload prep',
  'Editing past the Resolve handoff (scope ends at "ready for Resolve")',
  'Broad documentation rewrites',
];

// Projects-lane view for the orientation. The aigen projects board is a
// separate state model from package-runs; when no package run is active the
// projects lane usually holds the real work-in-progress, so the orientation
// surfaces it instead of implying nothing is happening. Read-only.
function buildProjectsLaneOrientation(options = {}) {
  let listing = null;
  try {
    listing = projectDiscovery.listProjects({
      packagesRoot: options.scriptPackagesRoot || aigenPaths({}).scriptPackages,
    });
  } catch (_error) {
    return { available: false, activeCount: 0, projects: [] };
  }
  if (!listing || listing.error) return { available: false, activeCount: 0, projects: [] };
  const active = (listing.projects || [])
    .filter((p) => p.status === 'active' && !p.diagnostic && !p.archived && !p.error);
  return {
    available: true,
    activeCount: active.length,
    projects: active.slice(0, 5).map((p) => ({
      id: p.project_id,
      title: p.title,
      stage: p.stage,
      stage_index: p.stage_index,
      stage_total: p.stage_total,
      next_task: p.next_task || null,
    })),
  };
}

// Aggregates the canonical operator-clarity signals (active-state audit, doctor,
// next-safe-action, index freshness, registry) into one payload the cockpit
// homepage panel renders. It never advances state; if active state is ambiguous,
// unknown, or absent it returns AMBIGUOUS mode and withholds normal next-action
// guidance instead of guessing. Exception: when the package-runs lane is CLEANLY
// empty (no ambiguity, no invalid markers — simply no active run) and the aigen
// projects lane has exactly one active project, the orientation reports that
// project as the current work instead of a scary AMBIGUOUS verdict.
function buildCockpitOrientation(options = {}) {
  const repoRoot = options.repoRoot || __dirname;
  const audit = activeStateAuditScript.buildActiveStateAudit({ repoRoot });
  const freshness = packageRunsIndexScript.indexFreshness({ repoRoot });
  let registry = null;
  try {
    const loaded = systemRegistryScript.loadRegistry();
    registry = {
      lastVerified: loaded.last_verified || '',
      components: (loaded.components || []).map((component) => ({
        id: component.id,
        name: component.name,
        machine: component.machine || null,
        url: component.url || null,
      })),
    };
  } catch (_error) {
    registry = null;
  }

  const base = {
    ok: true,
    readOnly: true,
    indexFreshness: { state: freshness.state, stale: freshness.stale, message: freshness.message, rebuildCommand: freshness.rebuildCommand },
    activeStateOk: audit.ok,
    ambiguity: audit.ambiguity,
    invalidState: audit.invalidState,
    guidanceWithheld: audit.guidanceWithheld,
    warnings: audit.warnings || [],
    outOfScope: COCKPIT_OUT_OF_SCOPE,
    registry,
  };

  if (audit.guidanceWithheld || !audit.selectedActiveRun) {
    const projectsLane = buildProjectsLaneOrientation(options);
    // Clean absence: the package-runs lane simply has no active run (no
    // conflicting or invalid markers). If exactly one aigen project is active,
    // that project IS the current work — report it instead of AMBIGUOUS.
    const cleanAbsence = !audit.ambiguity && !audit.invalidState && !audit.selectedActiveRun;
    if (cleanAbsence && projectsLane.activeCount === 1) {
      const project = projectsLane.projects[0];
      const task = project.next_task || {};
      return {
        ...base,
        mode: 'Projects Lane / Production',
        projectsLane,
        activeRun: '',
        activeRunPath: '',
        activeProject: project.id,
        activeProjectTitle: project.title,
        currentGate: `${project.stage} (${(project.stage_index || 0) + 1}/${project.stage_total || '?'})`,
        blocker: task.blocked ? String(task.why || 'Next task is blocked.') : '',
        nextValidAction: task.label ? `${task.label} — ${task.why || ''}`.trim() : 'Open the project workspace for the next task.',
        needsMikko: task.label || 'Review the active project in the projects board.',
        aiSafeAction: 'Summarize project state or prepare checklists only. Do not advance stages or approve gates.',
        linkedMediaSystem: 'Projects lane: AIGEN media pipeline (FLUX → image select → PRESTO → Resolve handoff). No package run is marked active.',
      };
    }
    return {
      ...base,
      mode: 'AMBIGUOUS',
      projectsLane,
      activeRun: '',
      activeRunPath: '',
      currentGate: 'Unknown',
      blocker: audit.invalidState
        ? 'One or more runs have no explicit package-run-state.md marker (state UNKNOWN).'
        : audit.ambiguity
          ? 'Multiple package runs are marked active.'
          : 'No package run is marked active.',
      nextValidAction: audit.exactNextSafeAction,
      needsMikko: 'Resolve active-run state: mark exactly one run active with an explicit package-run-state.md marker.',
      aiSafeAction: 'Summarize state only. Do not pick an active run or advance any gate.',
    };
  }

  const runPath = audit.selectedActiveRun;
  const runId = runPath.replace(/^package-runs\//, '');
  let doctor = null;
  let nextSafe = null;
  try {
    doctor = packageRunDoctor.buildDoctorReport(runPath, { repoRoot });
  } catch (_error) {
    doctor = null;
  }
  try {
    nextSafe = nextSafeActionScript.buildNextSafeAction(runId, { repoRoot });
  } catch (_error) {
    nextSafe = null;
  }

  let workflowPath = '';
  try {
    workflowPath = packageRunsIndexScript.readWorkflowPathForRun(path.join(repoRoot, runPath));
  } catch (_error) {
    workflowPath = '';
  }
  const mediaSystem = workflowPath === 'vertical'
    ? 'Vertical / Shorts path: camera/A-roll capture. No separate AIGEN package is expected for this run.'
    : 'Horizontal path: AIGEN image/video pipeline (FLUX → image select → PRESTO/Kling → Resolve).';

  const guidance = doctor && doctor.operatorGuidance ? doctor.operatorGuidance : null;

  return {
    ...base,
    mode: 'Operator Clarity / Production',
    activeRun: doctor ? doctor.runId : runId,
    activeRunPath: `${runPath}/`,
    currentGate: doctor ? doctor.currentInferredStage : '',
    overallStatus: doctor ? doctor.overallStatus : '',
    blocker: doctor ? doctor.firstBlockerReason : '',
    nextValidAction: (nextSafe && nextSafe.nextHumanAction) || (doctor && doctor.nextSafeAction) || '',
    nextCommand: (doctor && doctor.nextRecommendedCommand) || (nextSafe && nextSafe.nextCommand) || '',
    needsMikko: guidance ? guidance.nextHumanAction : (doctor && doctor.nextSafeAction) || '',
    aiSafeAction: guidance ? guidance.aiSafeAction : 'Prepare checklists or summarize blockers only. Do not approve or advance gates.',
    productionMeaning: guidance ? guidance.productionMeaning : '',
    workflowPath,
    linkedMediaSystem: mediaSystem,
  };
}

function createStatusResponse(env = process.env) {
  const config = providerConfig(env);
  return {
    ok: true,
    // OpenAI image generation is disabled by policy; never advertise it as available.
    thumbnailProvider: config.provider === 'openai' ? 'disabled' : config.provider,
    model: 'local-svg-placeholder',
    openaiImageGeneration: 'disabled',
    localImageProvider: LOCAL_IMAGE_PROVIDER,
    timeoutMs: config.timeoutMs,
    imageSize: config.size,
    quality: config.quality,
    format: config.outputFormat,
    api: API_PREFIX,
    mediaRoutingApi: MEDIA_ROUTING_API,
    mediaRoutingSummary: mediaRouting.operatorSummary(),
    packageRunsCandidatesApi: PACKAGE_RUNS_CANDIDATES_API,
    nonceHeader: LOCAL_WRITE_NONCE_HEADER,
    localWriteNonce: LOCAL_WRITE_NONCE,
    captureEvidenceWrite: {
      previewApi: CAPTURE_EVIDENCE_PREVIEW_API,
      applyApi: CAPTURE_EVIDENCE_APPLY_API,
      evidenceIntakeStatusApi: EVIDENCE_INTAKE_STATUS_API,
      evidenceIntakePreviewApi: EVIDENCE_INTAKE_PREVIEW_API,
      evidenceIntakeSaveApi: EVIDENCE_INTAKE_SAVE_API,
      nonceHeader: LOCAL_WRITE_NONCE_HEADER,
      localWriteNonce: LOCAL_WRITE_NONCE,
      allowedHosts: [`127.0.0.1:${PORT}`, `localhost:${PORT}`],
      missingOriginAllowed: true,
      evidenceIntakeAllowedWriteFiles: [CAPTURE_EVIDENCE_AUDIT_FILE],
    },
    packageRunOpen: {
      openApi: PACKAGE_RUNS_OPEN_API,
      nonceHeader: LOCAL_WRITE_NONCE_HEADER,
      localWriteNonce: LOCAL_WRITE_NONCE,
      allowedHosts: [`127.0.0.1:${PORT}`, `localhost:${PORT}`],
      action: 'open_os_folder',
    },
    hyperframes: {
      availability: probeHyperframesAvailability(),
      statusApi: HYPERFRAMES_STATUS_API,
      previewApi: HYPERFRAMES_PREVIEW_API,
      renderApi: HYPERFRAMES_RENDER_API,
      nonceHeader: LOCAL_WRITE_NONCE_HEADER,
      localWriteNonce: LOCAL_WRITE_NONCE,
      manifest: hyperframesRelative(HYPERFRAMES_MANIFEST_FILE),
      command: {
        probe: HYPERFRAMES_PROBE_COMMAND.join(' '),
        render: `${HYPERFRAMES_RENDER_COMMAND.join(' ')} <source.html> <output.mp4>`,
      },
    },
    roughCutInputConsole: {
      statusApi: ROUGH_CUT_STATUS_API,
      nextSafeActionApi: NEXT_SAFE_ACTION_API,
      productionGpsApi: PRODUCTION_GPS_API,
      secondCutInspectorApi: SECOND_CUT_INSPECTOR_API,
      secondCutCandidatePreviewApi: SECOND_CUT_CANDIDATE_PREVIEW_API,
      secondCutCandidateApplyApi: SECOND_CUT_CANDIDATE_APPLY_API,
      secondCutWatchNotesSaveApi: SECOND_CUT_WATCH_NOTES_SAVE_API,
      secondCutReviewRegenerateApi: SECOND_CUT_REVIEW_REGENERATE_API,
      finalCandidatePreviewApi: FINAL_CANDIDATE_PREVIEW_API,
      finalCandidateApplyApi: FINAL_CANDIDATE_APPLY_API,
      finalWatchNotesSaveApi: FINAL_WATCH_NOTES_SAVE_API,
      finalReviewRegenerateApi: FINAL_REVIEW_REGENERATE_API,
      saveApi: ROUGH_CUT_SAVE_API,
      reviewApi: ROUGH_CUT_REVIEW_API,
      regenerateDerivedApi: ROUGH_CUT_REGENERATE_DERIVED_API,
      openApi: ROUGH_CUT_OPEN_API,
      pickupPlanSaveApi: PICKUP_PLAN_SAVE_API,
      nonceHeader: LOCAL_WRITE_NONCE_HEADER,
      localWriteNonce: LOCAL_WRITE_NONCE,
      allowedApprovalMarkers: ROUGH_CUT_APPROVAL_VALUES,
      allowedPickupStatuses: PICKUP_STATUSES,
      allowedWriteFiles: [ROUGH_CUT_WATCH_NOTES_FILE, 'pickup-list.md', 'edit-fix-list.md'],
      secondCutCandidateAllowedWriteFiles: [SECOND_CUT_CANDIDATE_FILE],
      secondCutReviewAllowedWriteFiles: [SECOND_CUT_WATCH_NOTES_FILE, SECOND_CUT_REVIEW_FILE],
      allowedSecondCutReviewMarkers: SECOND_CUT_REVIEW_MARKERS,
      finalReviewAllowedWriteFiles: [FINAL_CANDIDATE_FILE, FINAL_WATCH_NOTES_FILE, FINAL_REVIEW_FILE],
      allowedFinalReviewMarkers: FINAL_REVIEW_MARKERS,
      exportMasterPreviewApi: EXPORT_MASTER_PREVIEW_API,
      exportMasterApplyApi: EXPORT_MASTER_APPLY_API,
      deliveryReadinessSaveApi: DELIVERY_READINESS_SAVE_API,
      exportChecklistRegenerateApi: EXPORT_CHECKLIST_REGENERATE_API,
      exportDeliveryAllowedWriteFiles: [MASTER_FILE_MANIFEST_FILE, CAPTION_CHECK_FILE, LOUDNESS_CHECK_FILE, DELIVERY_READINESS_FILE, EXPORT_CHECKLIST_FILE],
      allowedDeliveryReadinessMarkers: DELIVERY_READINESS_MARKERS,
      derivedOnlyWriteFiles: ROUGH_CUT_DERIVED_FILES,
    },
    publishGate: {
      packageRunsListApi: PACKAGE_RUNS_LIST_API,
      roughCutReviewApi: ROUGH_CUT_REVIEW_API,
      finalReviewApi: FINAL_REVIEW_API,
      exportChecklistApi: EXPORT_CHECKLIST_API,
      publicationMetadataApi: PUBLICATION_METADATA_API,
      archiveManifestApi: ARCHIVE_MANIFEST_API,
      nonceHeader: LOCAL_WRITE_NONCE_HEADER,
      localWriteNonce: LOCAL_WRITE_NONCE,
      allowedWriteFiles: [
        'final-review.md',
        'publication-blockers.md',
        'export-checklist.md',
        'master-file-manifest.md',
        'caption-check.md',
        'loudness-check.md',
        'delivery-readiness.md',
        'publish-metadata-review.md',
        'title-check.md',
        'thumbnail-check.md',
        'description-check.md',
        'chapters-check.md',
        'schedule-check.md',
        'archive-manifest.md',
        'archive-source-files.md',
        'archive-assets-manifest.md',
        'archive-export-manifest.md',
        'reusable-clips-manifest.md',
        'archive-blockers.md',
        'post-publish-learning.md',
      ],
    },
  };
}

function imageMimeType(format = DEFAULT_OPENAI_IMAGE_FORMAT) {
  const normalized = String(format || DEFAULT_OPENAI_IMAGE_FORMAT).toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  return 'image/png';
}

function buildOpenAIThumbnailPrompts(payload) {
  const topic = payload.topic || 'VIDTOOLZ thumbnail';
  const concept = payload.thumbnailConcept || topic;
  const onThumbnailText = payload.onThumbnailText || 'Clear creator decision';
  const viewerPromise = payload.viewerPromise || 'Help serious solo creators make better production decisions';
  const targetViewer = payload.targetViewer || 'serious solo creators using AI workflow tools';
  const baseRules = [
    '16:9 YouTube thumbnail composition, landscape frame.',
    'Bold readable title text, high contrast, one clear visual idea.',
    'Practical VIDTOOLZ style: serious solo creator, AI workflow, production decision-making.',
    'No fake logos, no celebrity or public figure likeness, no misleading screenshot claims.',
    'Make the image feel useful, grounded, and production-focused rather than hype-driven.',
  ].join(' ');
  const angles = [
    'Show a solo creator comparing competing video ideas before committing to production.',
    'Show a clear before/after decision board where weak AI suggestions become a stronger video package.',
    'Show a focused creator rejecting noisy AI outputs and choosing one practical thumbnail/title direction.',
  ];

  return angles.map((angle, idx) => [
    `${baseRules}`,
    `Topic: ${topic}.`,
    `Thumbnail concept: ${concept}.`,
    `On-thumbnail text: "${onThumbnailText}".`,
    `Viewer promise: ${viewerPromise}.`,
    `Target viewer: ${targetViewer}.`,
    `Variation ${idx + 1}: ${angle}`,
  ].join(' '));
}

function thumbnailLogPayload(config, statusCategory, startedAt, candidateCount = 0) {
  return {
    provider: config.provider,
    model: config.provider === 'openai' ? config.model : 'local-svg-placeholder',
    timeoutMs: config.timeoutMs,
    elapsedMs: Date.now() - startedAt,
    statusCategory,
    candidateCount,
  };
}

function logThumbnailRequest(config, statusCategory, startedAt, candidateCount = 0, logger = console) {
  if (!logger || typeof logger.log !== 'function') return;
  logger.log('[package-engine thumbnail]', JSON.stringify(thumbnailLogPayload(config, statusCategory, startedAt, candidateCount)));
}

// Hard-disabled by VIDTOOLZ policy. Kept (and exported) only so any caller that
// still references it fails closed with a clear disabled error instead of
// reaching OpenAI. It never performs a network request.
async function createOpenAIThumbnailCandidates() {
  const error = new Error(OPENAI_IMAGE_DISABLED_REASON);
  error.statusCode = 400;
  error.errorCode = 'openai_image_disabled';
  error.statusCategory = 'disabled';
  throw error;
}

async function createThumbnailResponse(payload, options = {}) {
  const config = options.config || providerConfig(options.env || process.env);
  const startedAt = Date.now();
  const logger = options.logger === undefined ? console : options.logger;
  // VIDTOOLZ policy: never call OpenAI for images, even if OPENAI_API_KEY and
  // THUMBNAIL_PROVIDER=openai are set. Fail closed with a disabled response.
  if (config.provider === 'openai') {
    logThumbnailRequest(config, 'disabled', startedAt, 0, logger);
    const error = new Error(OPENAI_IMAGE_DISABLED_REASON);
    error.statusCode = 400;
    error.errorCode = 'openai_image_disabled';
    error.statusCategory = 'disabled';
    throw error;
  }
  if (config.provider === 'placeholder') {
    const candidates = createCandidates(payload);
    logThumbnailRequest(config, 'success', startedAt, candidates.length, logger);
    return {
      provider: 'placeholder',
      model: 'local-svg-placeholder',
      timeoutMs: config.timeoutMs,
      imageSize: config.size,
      quality: config.quality,
      format: config.outputFormat,
      candidates,
    };
  }
  const error = new Error(`Unsupported THUMBNAIL_PROVIDER: ${config.provider}`);
  error.statusCode = 400;
  error.errorCode = 'unsupported_provider';
  throw error;
}

function handleDailyScoutToday(req, res) {
  const today = new Date().toISOString().slice(0, 10);
  const data = dailyIdeaScout.readArchive(VIDNAS_AIGEN_ROOT + '/daily-idea-scout', today);
  if (!data) {
    sendError(res, 404, `No daily idea scout run found for ${today}`, null);
    return;
  }
  sendJSON(res, 200, { date: today, dailyRun: data, localWriteNonce: LOCAL_WRITE_NONCE, nonceHeader: LOCAL_WRITE_NONCE_HEADER });
}

function handleDailyScoutArchive(req, res, url) {
  const date = url.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    sendError(res, 400, 'Missing or invalid date parameter (expected YYYY-MM-DD)', null);
    return;
  }
  const data = dailyIdeaScout.readArchive(VIDNAS_AIGEN_ROOT + '/daily-idea-scout', date);
  if (!data) {
    sendError(res, 404, `No archive found for ${date}`, null);
    return;
  }
  sendJSON(res, 200, { date, dailyRun: data });
}

function handleDailyScoutDates(req, res) {
  const archiveRoot = VIDNAS_AIGEN_ROOT + '/daily-idea-scout';
  const dates = dailyIdeaScout.listArchiveDates(archiveRoot);
  sendJSON(res, 200, { dates, localWriteNonce: LOCAL_WRITE_NONCE, nonceHeader: LOCAL_WRITE_NONCE_HEADER });
}

// Run today's daily idea scout (default fixture provider — deterministic, local).
function runDailyIdeaScoutNow(payload = {}, options = {}) {
  const runner = options.runner || childProcess.spawnSync;
  const args = ['scripts/daily-idea-scout-launch.js'];
  if (payload && typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    args.push(`--date=${payload.date}`);
  }
  const result = runner(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.error) {
    throw Object.assign(new Error(`Daily scout failed to launch: ${result.error.message}`), { statusCode: 500 });
  }
  return {
    ok: result.status === 0,
    command: `node ${args.join(' ')}`,
    exitCode: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

// Rebuild package-runs-index.json from the package-runs/ folder.
function rebuildPackageRunsIndex(options = {}) {
  const runner = options.runner || childProcess.spawnSync;
  const result = runner(process.execPath, ['scripts/package-runs-index.js'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.error) {
    throw Object.assign(new Error(`Index rebuild failed to launch: ${result.error.message}`), { statusCode: 500 });
  }
  return {
    ok: result.status === 0,
    command: 'node scripts/package-runs-index.js',
    exitCode: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

// ═══════════════════════════════════════════════════════════════
// Media Gallery — scan a package-run + VIDNAS for all media assets
// ═══════════════════════════════════════════════════════════════

// A filename is DaVinci Resolve-safe only if it is ASCII alphanumerics plus . _ -
// (no spaces, parentheses, or non-ASCII). Anything else imports as "Media Offline".
function isResolveSafeFilename(name) {
  return /^[A-Za-z0-9._-]+$/.test(String(name || ''));
}

function handleMediaGallery(req, res, url) {
  const runFolder = url.searchParams.get('run') || '';
  if (!runFolder) {
    sendError(res, 400, 'Missing run parameter', 'missing-run-param');
    return;
  }

  let resolved;
  try {
    resolved = resolvePackageRunDir(runFolder);
  } catch (e) {
    sendError(res, e.statusCode || 400, e.message, 'run-resolution-error');
    return;
  }
  const runDir = resolved.runDir;

  const assets = [];
  const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv)$/i;
  const IMAGE_EXT = /\.(png|jpg|jpeg|webp|gif|bmp)$/i;

  // 1. Scan run directory for any media files
  function scanDir(dir, relBase) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(relBase, fullPath);
      if (entry.isDirectory()) {
        // Skip node_modules, .git, superseded
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'superseded') continue;
        scanDir(fullPath, relBase);
      } else if (VIDEO_EXT.test(entry.name) || IMAGE_EXT.test(entry.name)) {
        try {
          const stat = fs.statSync(fullPath);
          const isVideo = VIDEO_EXT.test(entry.name);
          assets.push({
            name: entry.name,
            path: `/package-runs/${runFolder}/${relPath.split(path.sep).join('/')}`,
            url: `/package-runs/${runFolder}/${relPath.split(path.sep).join('/')}`,
            size: stat.size,
            type: isVideo ? 'video' : 'image',
            mtime: stat.mtime.toISOString(),
          });
        } catch (e) {
          // skip
        }
      }
    }
  }

  scanDir(runDir, runDir);

  // 2. Scan VIDNAS aigen directories for this run's media
  const vidnasKlingDir = path.join(VIDNAS_AIGEN_ROOT, 'editors-replaced-kling');
  if (fs.existsSync(vidnasKlingDir)) {
    try {
      const files = fs.readdirSync(vidnasKlingDir, { withFileTypes: true });
      for (const entry of files) {
        if (entry.isFile() && VIDEO_EXT.test(entry.name)) {
          const stat = fs.statSync(path.join(vidnasKlingDir, entry.name));
          assets.push({
            name: entry.name,
            path: `VIDNAS:aigen/editors-replaced-kling/${entry.name}`,
            url: `/aigen-assets/editors-replaced-kling/${entry.name}`,
            size: stat.size,
            type: 'video',
            source: 'VIDNAS',
            mtime: stat.mtime.toISOString(),
          });
        }
      }
    } catch (e) {
      // skip
    }
  }

  // 3. Scan VIDNAS wan production lane
  if (fs.existsSync(VIDNAS_WAN_LANE)) {
    try {
      const files = fs.readdirSync(VIDNAS_WAN_LANE, { withFileTypes: true });
      for (const entry of files) {
        if (entry.isFile() && VIDEO_EXT.test(entry.name)) {
          const stat = fs.statSync(path.join(VIDNAS_WAN_LANE, entry.name));
          assets.push({
            name: entry.name,
            path: `VIDNAS:aigen/image-to-video/production/wan22-81f/${entry.name}`,
            url: `/aigen-assets/image-to-video/production/wan22-81f/${entry.name}`,
            size: stat.size,
            type: 'video',
            source: 'VIDNAS',
            mtime: stat.mtime.toISOString(),
          });
        }
      }
    } catch (e) {
      // skip
    }
  }

  // 4. Scan VIDNAS script-packages for images
  if (runFolder.includes('ai-replace') || runFolder.includes('editors')) {
    const pkgDir = path.join(VIDNAS_SCRIPT_PACKAGES, 'vidtoolz-youtube-ideas-20260611');
    if (fs.existsSync(pkgDir)) {
      function scanPkg(dir, pkgBase) {
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            scanPkg(fullPath, pkgBase);
          } else if (IMAGE_EXT.test(entry.name)) {
            try {
              const stat = fs.statSync(fullPath);
              const relPath = path.relative(pkgBase, fullPath);
              assets.push({
                name: entry.name,
                path: `VIDNAS:aigen/script-packages/vidtoolz-youtube-ideas-20260611/${relPath.split(path.sep).join('/')}`,
                url: `/aigen-assets/script-packages/vidtoolz-youtube-ideas-20260611/${relPath.split(path.sep).join('/')}`,
                size: stat.size,
                type: 'image',
                source: 'VIDNAS',
                mtime: stat.mtime.toISOString(),
              });
            } catch (e) {
              // skip
            }
          }
        }
      }
      scanPkg(pkgDir, pkgDir);
    }
  }

  // Sort by mtime descending
  assets.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));

  // Resolve-readiness: flag filenames that are NOT ASCII-safe (spaces, parentheses,
  // non-ASCII) — those import as "Media Offline" in DaVinci Resolve. Surfaced so the
  // staging→Resolve handoff is clean (brand rule: ASCII-safe filenames before import).
  const flagged = assets.map((a) => ({ ...a, ascii_safe: isResolveSafeFilename(a.name) }));
  const asciiIssues = flagged.filter((a) => !a.ascii_safe).map((a) => a.name);

  sendJSON(res, 200, {
    runFolder,
    assetCount: flagged.length,
    resolveReadiness: {
      total: flagged.length,
      needsRename: asciiIssues.length,
      asciiIssues,
      ready: asciiIssues.length === 0,
    },
    assets: flagged,
  });
}

// ═══════════════════════════════════════════════════════════════
// Visual Beat Map — read-only beat map from existing run files
// ═══════════════════════════════════════════════════════════════
function handleBeatMap(req, res, url) {
  const runFolder = url.searchParams.get('run') || '';
  if (!runFolder) {
    sendError(res, 400, 'Missing run parameter', 'missing-run-param');
    return;
  }
  let resolved;
  try {
    resolved = resolvePackageRunDir(runFolder);
  } catch (e) {
    sendError(res, e.statusCode || 400, e.message, 'run-resolution-error');
    return;
  }
  const runDir = resolved.runDir;

  try {
    const result = visualBeatMapParser.parseBeatMap(runDir);
    sendJSON(res, 200, {
      runId: runFolder,
      beats: result.beats,
      sources: result.sources,
      totalBeats: result.beats.length,
    });
  } catch (error) {
    sendError(res, 500, `Beat map parse failed: ${error.message}`, 'beat-map-parse-error');
  }
}

// ═══════════════════════════════════════════════════════════════
// Friction Log — structured capture during production runs
// ═══════════════════════════════════════════════════════════════
function handleFrictionLogRead(req, res, url) {
  const runFolder = url.searchParams.get('run') || '';
  if (!runFolder) {
    sendError(res, 400, 'Missing run parameter', 'missing-run-param');
    return;
  }
  let resolved;
  try {
    resolved = resolvePackageRunDir(runFolder);
  } catch (e) {
    sendError(res, e.statusCode || 400, e.message, 'run-resolution-error');
    return;
  }
  const logPath = path.join(resolved.runDir, 'FRICTION-LOG.json');
  if (!fs.existsSync(logPath)) {
    sendJSON(res, 200, { runFolder, entries: [], empty: true });
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    sendJSON(res, 200, { runFolder, entries: data.entries || data || [], empty: !data.entries || data.entries.length === 0 });
  } catch (e) {
    sendJSON(res, 200, { runFolder, entries: [], empty: true, parseError: 'Failed to parse existing log' });
  }
}

function handleFrictionLogSave(res, payload) {
  const runFolder = payload.runFolder || '';
  if (!runFolder) {
    sendError(res, 400, 'Missing runFolder', null);
    return;
  }
  let resolved;
  try {
    resolved = resolvePackageRunDir(runFolder);
  } catch (e) {
    sendError(res, e.statusCode || 400, e.message, null);
    return;
  }
  const runDir = resolved.runDir;
  const logPath = path.join(runDir, 'FRICTION-LOG.json');
  const logData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: payload.entries || [],
  };
  fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf8');
  sendJSON(res, 200, { saved: logData.entries.length, path: logPath });
}

// ═══════════════════════════════════════════════════════════════
// Pipeline Status — derive 13-stage progress from package-run state
// ═══════════════════════════════════════════════════════════════
// ── "Ready for Resolve" checklist (B2-A) ──────────────────────────────────────
// Deterministic, read-only assessment of whether the SYSTEM side of a run is done
// so it can be handed to Resolve. Stops at the handoff boundary — it never tracks
// editing, export, or publishing. Run-local signals (script) + package-side signals
// (image prompts/images/selection/i2v/clips/handoff, via buildPackagePipelineStatus).
function gatherResolveReadiness(payload = {}, options = {}) {
  const runInfo = readWorkflowPathForRun(payload.run, options); // throws 400/404 on a bad run
  const runDir = runInfo.runDir;
  const scriptSaved = ['final-script.md', 'script.md', 'SCRIPT.md']
    .some((name) => fs.existsSync(path.join(runDir, name)));

  const input = { workflowPath: runInfo.workflowPath, scriptSaved, packageLinked: false };
  const packageId = String(payload.packageId || '').trim();
  if (packageId) {
    try {
      const { packageDir, packageId: resolvedId } = resolveAigenPackageDir(packageId, options);
      if (fs.existsSync(packageDir)) {
        const paths = aigenPaths(options);
        const completed = parseJsonLines(path.join(paths.wanLane, 'completed.txt'));
        const failed = parseJsonLines(path.join(paths.wanLane, 'failed.jsonl'));
        const wanLabels = {
          completed: new Set(completed.map((i) => String(i.label || '')).filter(Boolean)),
          failed: new Set(failed.map((i) => String(i.label || '')).filter(Boolean)),
        };
        const pkg = buildPackagePipelineStatus(packageDir, wanLabels);
        const videoPrompts = safeReadJson(path.join(packageDir, 'video-prompts.json'), null);
        input.packageLinked = true;
        input.packageId = resolvedId;
        input.imagePromptsCount = pkg.prompts_count;
        input.imagesCount = pkg.flux_images_count;
        input.selectionsCount = pkg.selections_count;
        input.i2vPromptsCount = videoPrompts && Array.isArray(videoPrompts.prompts) ? videoPrompts.prompts.length : 0;
        input.clipsCompleted = pkg.wan_completed;
        input.clipsPending = pkg.wan_pending;
        input.clipsFailed = pkg.wan_failed;
        input.resolveHandoffReady = pkg.resolve_handoff_ready;
      }
    } catch (_error) {
      // Invalid package id or unmounted VIDNAS → leave the media side "unknown".
    }
  }

  return Object.assign(
    { run: payload.run, packageId: input.packageLinked ? input.packageId : (packageId || null) },
    resolveReadinessModel.buildResolveReadiness(input),
  );
}

function handleResolveReadiness(req, res, url, options = {}) {
  const run = url.searchParams.get('run') || '';
  const packageId = url.searchParams.get('package') || '';
  if (!run) {
    sendError(res, 400, 'Missing run parameter', 'missing-run-param');
    return;
  }
  try {
    sendJSON(res, 200, gatherResolveReadiness({ run, packageId }, options));
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message, 'resolve-readiness-error');
  }
}

function handlePipelineStatus(req, res, url) {
  const runFolder = url.searchParams.get('run') || '';
  if (!runFolder) {
    sendError(res, 400, 'Missing run parameter', 'missing-run-param');
    return;
  }
  let resolved;
  try {
    resolved = resolvePackageRunDir(runFolder);
  } catch (e) {
    sendError(res, e.statusCode || 400, e.message, 'run-resolution-error');
    return;
  }
  const runDir = resolved.runDir;

  // Derive current stage from STATUS.md + file existence
  const stages = [];
  const statusPath = path.join(runDir, 'STATUS.md');
  let statusContent = '';
  try {
    statusContent = fs.readFileSync(statusPath, 'utf8');
  } catch (e) {
    // ok
  }

  const existsAny = (names) => names.some((name) => fs.existsSync(path.join(runDir, name)));
  const fileTextAny = (names) => names.map((name) => safeReadText(path.join(runDir, name), '')).join('\n');
  // safeDirEntries returns Dirent objects (withFileTypes:true); extract .name before testing.
  const hasMediaInDir = (dirPath) => fs.existsSync(dirPath) && safeDirEntries(dirPath).some((f) => MEDIA_FILE_PATTERN.test(f.name != null ? f.name : f));
  let activeRunId = '';
  try {
    activeRunId = findActivePackageRun().runId;
  } catch (_) {
    activeRunId = '';
  }
  const reportText = activeRunId === runFolder ? safeReadText(path.join(ROOT, 'reports', 'prompt-03-selected-image-edit-handoff.md'), '') : '';
  const manifestFromReport = (reportText.match(/`([^`]*generation-manifest\.json)`/i) || [])[1] || '';
  const manifestPath = manifestFromReport && path.isAbsolute(manifestFromReport)
    ? manifestFromReport
    : (manifestFromReport ? path.join(ROOT, manifestFromReport) : path.join(runDir, 'flux-generation-manifest.json'));
  const generationManifest = safeReadJson(manifestPath, null);
  const manifestItems = generationManifest && Array.isArray(generationManifest.items) ? generationManifest.items : [];
  const manifestDir = manifestPath ? path.dirname(manifestPath) : '';
  const selectedImages = safeReadJson(path.join(runDir, 'selected-images.json'), null);
  const selectedImageCount = Array.isArray(selectedImages && selectedImages.selections) ? selectedImages.selections.length : 0;
  const selectedManifestCount = manifestItems.filter((item) => item && item.selected === true).length;
  const klingCandidateDir = manifestDir ? path.join(manifestDir, 'kling-video-candidates') : '';

  // Check for key files to determine stage completion. These are evidence signals only;
  // they do not imply approval, production readiness, or publish readiness.
  const hasIdea = existsAny(['idea.md', 'IDEA.md', 'package-candidates.json', 'selected-package.md', 'selected-package.json']);
  const hasResearch = existsAny(['research-pack.md', 'research-evidence.md', 'research-sufficiency-review.md']);
  const hasScript = existsAny(['script.md', 'SCRIPT.md', 'final-script.md', 'script-draft.md']);
  const hasClaims = existsAny(['source-support-map.md', 'research-evidence.md', 'script-review.md']);
  const hasYoutubePkg = existsAny(['youtube-package.json', 'selected-package.md', 'selected-package.json', 'thumbnail-title-check.md', 'publish-pack.md']);
  const hasImagePrompts = existsAny(['image-prompts.json']) || Boolean(generationManifest || safeReadJson(path.join(manifestDir, 'image-prompts.json'), null));
  const hasImageGen = manifestItems.length > 0 || (manifestDir && safeDirEntries(manifestDir).some((f) => /\.(?:png|jpe?g|webp)$/i.test(f.name != null ? f.name : f)));
  const hasImageSelect = selectedImageCount > 0 || selectedManifestCount > 0;
  const hasVideoGen = hasMediaInDir(klingCandidateDir) || hasMediaInDir(path.join(runDir, 'kling-video-candidates')) || hasMediaInDir(path.join(runDir, 'video-candidates'));
  const captureText = fileTextAny(['capture-checklist.md', 'capture-evidence-review.md', 'takes-log.md', 'screen-recording-checklist.md']);
  const hasARoll = /READY FOR ROUGH CUT|capture evidence accepted|aroll-|A-roll|\.MOV|\.mp4/i.test(captureText);
  const hasAssembly = existsAny(['gate-5-assembly-manifest.md', 'assembly-plan.md', 'rough-cut-watch-notes.md', 'rough-cut-review.md']);
  const hasPublishGate = existsAny(['final-watch-notes.md', 'final-review.md', 'export-checklist.md', 'delivery-readiness.md']);
  const publishedVideos = safeReadJson(path.join(ROOT, 'published-videos.json'), []);
  const hasPublishedInRegistry = Array.isArray(publishedVideos) && publishedVideos.some((item) => {
    const itemRun = String((item && (item.run_folder || item.runFolder || item.runId)) || '').trim();
    const itemUrl = String((item && (item.youtube_url || item.url)) || '').trim();
    return itemRun === runFolder && /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(itemUrl);
  });
  const hasPublished = hasPublishedInRegistry || /^Status:\s*Published\b/im.test(statusContent);

  // Pickup-loop awareness: rough-cut approval status gates downstream stage completion.
  // A run in NEEDS PICKUPS or NEEDS EDIT FIXES has assembly evidence but is not done with
  // the assembly stage — it is inside a pickup loop. Artifact presence alone would let the
  // tracker skip past stage 9 and 10, which is misleading for a pickup loop.
  const roughCutNotesText = safeReadText(path.join(runDir, 'rough-cut-watch-notes.md'), '');
  const roughCutApprovalMatch = roughCutNotesText.match(/rough-cut approval:\s*(.+)/i);
  const roughCutApproval = roughCutApprovalMatch ? roughCutApprovalMatch[1].trim().toUpperCase() : '';
  const roughCutInPickupLoop = /NEEDS PICKUPS|NEEDS EDIT FIXES/.test(roughCutApproval);

  // Second-cut review resolves the pickup loop for the assembly stage.
  const secondCutText = fileTextAny(['second-cut-watch-notes.md', 'second-cut-review.md']);
  const secondCutReady = /READY FOR SECOND CUT/i.test(secondCutText);

  // A pickup row is "presenter-type" when it mentions the camera presence of the presenter.
  // These are A-roll pickups, not B-roll/video-gen work.
  const pickupText = safeReadText(path.join(runDir, 'pickup-list.md'), '');
  const hasOpenPresenterPickup = pickupText.split('\n').some(
    (line) => /presenter|on.camera/i.test(line) && /\|\s*open\s*\|/i.test(line)
  );

  // Stage 9 (A-Roll): not complete if the pickup loop has open presenter-camera items.
  const aRollCompleted = hasARoll && !(roughCutInPickupLoop && hasOpenPresenterPickup);
  // Stage 10 (Assembly): not complete while the pickup loop is unresolved.
  const assemblyCompleted = hasAssembly && (!roughCutInPickupLoop || secondCutReady);

  // Derive gate from STATUS.md
  let currentGate = 0;
  const gateMatch = statusContent.match(/Gate\s*(\d)/i);
  if (gateMatch) {
    currentGate = parseInt(gateMatch[1], 10);
  }

  // Map to 13 stages
  const stageMap = {
    0: { key: 'idea', completed: hasIdea },
    1: { key: 'research', completed: hasResearch },
    2: { key: 'script', completed: hasScript },
    3: { key: 'claims', completed: hasClaims },
    4: { key: 'packaging', completed: hasYoutubePkg },
    5: { key: 'image-prompts', completed: hasImagePrompts },
    6: { key: 'image-gen', completed: hasImageGen },
    7: { key: 'image-select', completed: hasImageSelect },
    8: { key: 'video-gen', completed: hasVideoGen },
    9: { key: 'a-roll', completed: aRollCompleted },
    10: { key: 'assembly', completed: assemblyCompleted },
    11: { key: 'publish-gate', completed: hasPublishGate },
    12: { key: 'published', completed: hasPublished },
  };

  // Find current stage (first not-completed), preserving the canonical order.
  let currentStage = 0;
  for (let i = 0; i <= 12; i++) {
    if (stageMap[i].completed) {
      currentStage = i + 1;
    } else {
      currentStage = i;
      break;
    }
  }
  if (currentStage > 12) currentStage = 12;

  // Detect blocker from STATUS.md
  let blocker = null;
  const blockerMatch = statusContent.match(/blocker[:\s]+(.+)/i);
  if (blockerMatch) {
    blocker = blockerMatch[1].trim();
  }

  // Build stage list
  const stageNames = ['Idea', 'Research', 'Script', 'Claims Check', 'Packaging', 'Image Prompts', 'Image Gen', 'Image Select', 'Video Gen', 'A-Roll Record', 'Assembly Edit', 'Publish Gate', 'Published'];
  for (let i = 0; i <= 12; i++) {
    stages.push({
      id: i,
      key: stageMap[i].key,
      label: stageNames[i],
      completed: stageMap[i].completed,
      active: i === currentStage,
      blocked: blocker && i === currentStage,
    });
  }

  const runWorkflowPath = workflowPathModel.readWorkflowPathFromState(
    safeReadText(path.join(runDir, 'package-run-state.md'), ''));
  sendJSON(res, 200, {
    runFolder,
    workflowPath: runWorkflowPath,
    currentStage,
    stages,
    blocker,
    gate: currentGate,
    evidence: {
      manifestPath: generationManifest ? manifestPath : '',
      klingCandidateDir,
    },
  });
}

// ── Image review helpers (domain: super-focus-image-review.js) ──────────────

// Build the on-disk/plan truth one row's review is judged against. Hashing is
// LAZY: the sha256 runs only when the mtime probe diverges from the reviewed
// snapshot (or at review start), never on routine status reads.
function buildImageReviewContext(state, row, sfMediaRoot) {
  const filePath = superFocusMedia.safeImageFilePath(state.project_id, row.index, { mediaRoot: sfMediaRoot });
  let mtime = null;
  if (filePath) { try { mtime = Math.round(fs.statSync(filePath).mtimeMs); } catch (_) { mtime = null; } }
  const exists = mtime != null;
  const plan = state.visual_plan || null;
  const assignment = row.assignment_id && plan
    ? (plan.assignments || []).find((a) => a.assignment_id === row.assignment_id) || null
    : null;
  const planStale = Boolean(plan && plan.stale);
  return {
    image_exists: exists,
    image_mtime_ms: mtime,
    image_hash: null,
    hash_image: () => (exists ? superFocusMedia.hashFileSha256(filePath) : null),
    assignment,
    assignment_fresh: Boolean(assignment && assignment.status === 'approved' && !assignment.stale && !planStale),
    prompt_text: row.text || '',
  };
}

// Build the on-disk/plan truth one row's VIDEO review is judged against.
// Same lazy-hashing discipline as images, but with mtime+size probes because
// clips are large; the canonical i2vPromptHash and per-slot generation
// provenance come from the committed video lane (super-focus-media.js).
function buildVideoReviewContext(state, row, sfMediaRoot, subdir) {
  const filePath = superFocusMedia.safeVideoFilePath(state.project_id, subdir, row.index, { mediaRoot: sfMediaRoot });
  let mtime = null;
  let size = null;
  if (filePath) {
    try { const st = fs.statSync(filePath); mtime = Math.round(st.mtimeMs); size = st.size; } catch (_) { mtime = null; size = null; }
  }
  const exists = mtime != null;
  const imgCtx = buildImageReviewContext(state, row, sfMediaRoot);
  let generatedHash = null;
  try {
    generatedHash = superFocusMedia.readVideoProvenanceHashes(state.project_id, { mediaRoot: sfMediaRoot })[row.index] || null;
  } catch (_) { generatedHash = null; }
  // Render-time provenance: WHICH staged bytes actually produced the on-disk
  // clip (attempt layer; lazy — probes recorded mtime+size before any sha256).
  // null = legacy/unattributed clip; provenance is surfaced, never invented.
  let renderProvenance = null;
  if (exists) {
    try {
      renderProvenance = superFocusMedia.videoRenderProvenance(state.project_id, row.index, {
        mediaRoot: sfMediaRoot,
        videoMtimeMs: mtime,
        videoSize: size,
        hashVideo: () => superFocusMedia.hashFileSha256(filePath),
        imageExists: imgCtx.image_exists,
        imageMtimeMs: imgCtx.image_mtime_ms,
        hashImage: imgCtx.hash_image,
      });
    } catch (_) { renderProvenance = null; }
  }
  return {
    video_exists: exists,
    video_mtime_ms: mtime,
    video_size: size,
    hash_video: () => (exists ? superFocusMedia.hashFileSha256(filePath) : null),
    generated_i2v_hash: generatedHash,
    render_provenance: renderProvenance,
    current_i2v_text: row.i2v_prompt && typeof row.i2v_prompt.text === 'string' ? row.i2v_prompt.text : '',
    i2v_prompt_hash: superFocusMedia.i2vPromptHash,
    source_image: { exists: imgCtx.image_exists, mtime_ms: imgCtx.image_mtime_ms, hash_image: imgCtx.hash_image },
    image_review_status: superFocusImageReview.effectiveReview(row, imgCtx).status,
    assignment: imgCtx.assignment,
    assignment_fresh: imgCtx.assignment_fresh,
    observed_duration_seconds: null,
  };
}

// The narrow I2V gate the video dispatch routes consume: a PNG on disk is not
// approval. Legacy rows (no review, no assignment provenance) pass in
// compatibility mode; everything else must be approved and hash-current.
function applyImageReviewGate(state, rows, sfMediaRoot) {
  const allowed = [];
  const skipped = [];
  (rows || []).forEach((row) => {
    const gate = superFocusImageReview.imageReviewGate(row, buildImageReviewContext(state, row, sfMediaRoot));
    if (gate.eligible) allowed.push(row);
    else skipped.push({ index: row.index, reason: gate.reason });
  });
  return { allowed, skipped };
}

function createServer(options = {}) {
  const serverOptions = options && typeof options === 'object' ? options : {};
  return http.createServer((req, res) => {
    const host = req.headers.host || 'localhost';
    let url;
    try {
      url = new URL(req.url, `http://${host}`);
    } catch (err) {
      send(res, 400, 'Malformed URL');
      return;
    }
    if (req.method === 'GET' && url.pathname === STATUS_API) {
      sendJSON(res, 200, createStatusResponse());
      return;
    }

    // Read-only media routing policy: which machine/engine owns each generation
    // lane, plus the resolved local endpoints. No external calls.
    if (req.method === 'GET' && url.pathname === MEDIA_ROUTING_API) {
      sendJSON(res, 200, buildMediaRoutingStatus());
      return;
    }

    // Read-only unified package media index (local + manual-external together).
    if (req.method === 'GET' && url.pathname === PACKAGE_MEDIA_INDEX_API) {
      try {
        const resolved = resolveAigenPackageDir(url.searchParams.get('package') || url.searchParams.get('package_id') || '', { root: serverOptions.root || ROOT });
        sendJSON(res, 200, buildPackageMediaIndex(resolved.packageDir));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'package-media-index-error');
      }
      return;
    }

    // Read-only projects board: every package with stage/status/next-task.
    if (req.method === 'GET' && url.pathname === PROJECTS_LIST_API) {
      try {
        sendJSON(res, 200, projectDiscovery.listProjects({ packagesRoot: aigenPaths({ root: serverOptions.root || ROOT }).scriptPackages }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'projects-list-error');
      }
      return;
    }

    // Read-only single-project state: resolver + next task + media index.
    // ---- Super Focus: standalone, local, file-backed minimal production view ----
    // State lives locally (never VIDNAS). No generation happens here in Slice 1;
    // create/list/load/save-title/save-script only. All writes are nonce-gated.
    const sfRoot = serverOptions.superFocusRoot || SUPER_FOCUS_ROOT;
    const sfMediaRoot = serverOptions.superFocusMediaRoot || SUPER_FOCUS_MEDIA_ROOT;
    const mgOpts = { root: serverOptions.motionGraphicsRoot || undefined }; // undefined → module default (env/local dir)
    const mgMediaRoot = serverOptions.motionGraphicsMediaRoot || MOTION_GRAPHICS_MEDIA_ROOT;
    // Injectable HyperFrames runner (tests pass a stub; default reuses the lane's wrapper).
    const mgRunRender = serverOptions.hyperframesRenderer || runHyperframesRenderCommand;

    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_PROJECTS_API) {
      try {
        sendJSON(res, 200, { projects: superFocus.listProjects({ root: sfRoot }) });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-list-error');
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_PROJECTS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus project create API' });
          const state = superFocus.createProject(
            { title: typeof payload.title === 'string' ? payload.title : '' },
            { root: sfRoot }
          );
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-create-error'));
      return;
    }

    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_PROJECT_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot });
        // Lifecycle status rides along so the UI can show an Archived banner —
        // archived projects are openable and editable; opening never restores.
        sendJSON(res, 200, { project: state, lifecycle: superFocus.projectLifecycle(id, { root: sfRoot }) });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-load-error');
      }
      return;
    }

    // ── Super Focus project lifecycle (archive / restore / permanent delete) ──
    // Storage model: archived projects live in <root>/.archived/<id>; staged
    // deletions in <root>/.trash/. Both are invisible to every project list.
    // All paths are server-derived from the validated project id — the browser
    // never supplies a filesystem path. Writes are nonce + Host + Origin gated.
    const sfLifecycleBusyCheck = serverOptions.superFocusBusyCheck || null;

    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_ARCHIVED_PROJECTS_API) {
      try {
        sendJSON(res, 200, { projects: superFocus.listArchivedProjects({ root: sfRoot }) });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-archived-list-error');
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_ARCHIVE_PROJECT_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus project archive API' });
          const id = superFocus.assertValidProjectId(payload && payload.id);
          const result = runSuperFocusLifecycleOp(id, 'archive', sfLifecycleBusyCheck, () =>
            superFocus.archiveProject(id, { root: sfRoot }));
          console.log(`[super-focus-lifecycle] archived project ${id}`);
          sendJSON(res, 200, { project_id: result.project_id, status: 'archived' });
        })
        .catch((error) => {
          console.log(`[super-focus-lifecycle] archive refused (${error.code || error.statusCode || 'error'}): ${error.message}`);
          sendError(res, error.statusCode || 500, error.message, error.code || 'super-focus-archive-error');
        });
      return;
    }

    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_RESTORE_PROJECT_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus project restore API' });
          const id = superFocus.assertValidProjectId(payload && payload.id);
          const result = runSuperFocusLifecycleOp(id, 'restore', sfLifecycleBusyCheck, () =>
            superFocus.restoreProject(id, { root: sfRoot }));
          console.log(`[super-focus-lifecycle] restored project ${id}`);
          sendJSON(res, 200, { project_id: result.project_id, status: 'active' });
        })
        .catch((error) => {
          console.log(`[super-focus-lifecycle] restore refused (${error.code || error.statusCode || 'error'}): ${error.message}`);
          sendError(res, error.statusCode || 500, error.message, error.code || 'super-focus-restore-error');
        });
      return;
    }

    // Permanent delete. Deliberate double gate: the nonce (as every write) AND
    // an explicit confirm token, so no accidental client call can delete.
    // Scope: removes ONLY the canonical project directory (active or archived).
    // Referenced external assets — the VIDNAS media directory, handoffs, other
    // projects, anything reached through a symlink — are never touched.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_DELETE_PROJECT_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus project delete API' });
          const id = superFocus.assertValidProjectId(payload && payload.id);
          if (!payload || payload.confirm !== 'DELETE') {
            const error = new Error('Permanent deletion requires confirm: "DELETE".');
            error.statusCode = 400;
            error.code = 'confirm_required';
            throw error;
          }
          const result = runSuperFocusLifecycleOp(id, 'permanently delete', sfLifecycleBusyCheck, () =>
            superFocus.deleteProject(id, { root: sfRoot }));
          if (!result.cleanup_complete) {
            console.error(`[super-focus-lifecycle] delete staged but cleanup incomplete for ${id} (previous status: ${result.previous_status}); staged remains are not listed or openable.`);
          } else {
            console.log(`[super-focus-lifecycle] permanently deleted project ${id} (previous status: ${result.previous_status})`);
          }
          sendJSON(res, 200, {
            deleted_project_id: result.project_id,
            previous_status: result.previous_status,
            cleanup_complete: result.cleanup_complete,
          });
        })
        .catch((error) => {
          console.log(`[super-focus-lifecycle] delete refused (${error.code || error.statusCode || 'error'}): ${error.message}`);
          sendError(res, error.statusCode || 500, error.message, error.code || 'super-focus-delete-error');
        });
      return;
    }

    // Read-only provider status for the "Check providers" panel. Short-timeout
    // probes only; never starts/stops a service. Explains routing decisions.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_PROVIDERS_API) {
      superFocusProviderStatus(options)
        .then((status) => sendJSON(res, 200, status))
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-providers-error'));
      return;
    }

    // Explicit "Test Ollama model" — measures real 1-prompt/3-prompt timing on
    // vidnux (and PRESTO if healthy). Read-only re: project state; not automatic.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_OLLAMA_BENCHMARK_API) {
      superFocusOllamaBenchmark(options)
        .then((result) => sendJSON(res, 200, result))
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-ollama-benchmark-error'));
      return;
    }

    // ADVISORY script evaluation (local Ollama, semantic pass). Persists an
    // evaluation to state.script_evaluation. NEVER approves the script, advances
    // stage, or generates prompts/media. No fallback: Ollama down -> 503;
    // unusable model output -> 502 with nothing written.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_EVALUATE_SCRIPT_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus script-evaluation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown id
          if (!state.script || !state.script.trim()) {
            const e = new Error('Save a script first, then evaluate it.'); e.statusCode = 400; throw e;
          }
          const sentences = scriptEvaluator.splitScriptIntoSentences(state.script);
          const prompt = scriptEvaluator.buildScriptEvaluationPrompt(state.script, sentences, {});
          // Route through the existing load-aware local-Ollama path (no fallback).
          // Throws 503 (unreachable) / enriched errors before any write.
          const gen = await superFocusGenerate(
            { system: prompt.system, user: prompt.user, schema: prompt.schema, task: 'script_evaluation' },
            options
          );
          // Parser throws 502 on unusable output -> nothing is persisted.
          const parsed = scriptEvaluator.parseScriptEvaluationOutput(gen.content);
          const normalized = scriptEvaluator.normalizeScriptEvaluation(parsed, sentences);
          const scored = scriptEvaluator.scoreScriptEvaluation(normalized);
          const evaluation = Object.assign({}, scored, {
            script_hash: scriptEvaluator.hashScriptText(state.script),
            evaluated_at: new Date().toISOString(),
            stale: false,
            model: {
              provider: 'ollama',
              lane: 'script_evaluation',
              model: gen.provider ? gen.provider.model : null,
              host: gen.provider ? gen.provider.id : null,
            },
          });
          const saved = superFocus.saveScriptEvaluation(id, evaluation, { root: sfRoot });
          sendJSON(res, 200, { project_id: id, script_evaluation: saved.script_evaluation, provider: gen.provider });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-evaluate-script-error'));
      return;
    }

    // Read-only: return the saved evaluation with a freshly-computed stale flag.
    // Does not call Ollama and does not mutate state.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_SCRIPT_EVALUATION_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const evaluation = superFocus.readScriptEvaluation(id, { root: sfRoot });
        sendJSON(res, 200, { project_id: id, script_evaluation: evaluation || null, stale: evaluation ? Boolean(evaluation.stale) : false });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-script-evaluation-error');
      }
      return;
    }

    // ── Visual Plan (beats + visual assignments) ─────────────────────────
    // The authoritative upstream object between the saved script and the
    // image prompts. All mutations are nonce-gated, narrowly validated, and
    // slot-safe; the operator is the only approval authority.

    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_VISUAL_PLAN_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot });
        const plan = superFocus.readVisualPlan(id, { root: sfRoot });
        sendJSON(res, 200, {
          project_id: id,
          visual_plan: plan,
          readiness: superFocusVisualPlan.computeVisualPlanReadiness(plan, state.script),
          integrity: superFocusVisualPlan.computePlanIntegrity(plan, state.image_prompts, superFocusPrompts.IMAGE_PROMPT_MAX),
          duplicate_subject_advisories: superFocusVisualPlan.findDuplicateSubjectAdvisories(plan),
        });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-visual-plan-error');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_VISUAL_PLAN_READINESS_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot });
        const plan = superFocus.readVisualPlan(id, { root: sfRoot });
        sendJSON(res, 200, {
          project_id: id,
          readiness: superFocusVisualPlan.computeVisualPlanReadiness(plan, state.script),
          integrity: superFocusVisualPlan.computePlanIntegrity(plan, state.image_prompts, superFocusPrompts.IMAGE_PROMPT_MAX),
        });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-visual-plan-readiness-error');
      }
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith(SUPER_FOCUS_VISUAL_PLAN_ACTION_PREFIX)) {
      const action = url.pathname.slice(SUPER_FOCUS_VISUAL_PLAN_ACTION_PREFIX.length);
      const KNOWN_ACTIONS = [
        'create-beats', 'generate-assignments', 'save-assignment',
        'approve-assignment', 'reject-assignment', 'revoke-assignment',
        'clear-assignment', 'set-disposition', 'split-beat', 'merge-beats',
        'reanchor',
      ];
      if (KNOWN_ACTIONS.indexOf(action) === -1) {
        sendError(res, 404, `Unknown visual-plan action: ${action}`, 'super-focus-visual-plan-error');
        return;
      }
      readJsonBody(req, 1024 * 256)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: `Super Focus visual-plan ${action} API` });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown id
          const vpApi = superFocusVisualPlan;
          const existing = superFocus.readVisualPlan(id, { root: sfRoot });
          const requirePlan = () => {
            if (!existing) { const e = new Error('No visual plan yet. Create beats from the saved script first.'); e.statusCode = 400; throw e; }
            return existing;
          };
          // Editing/generating/approving against a stale plan writes work that
          // no longer matches the script — re-anchor first (explicit action).
          const requireFresh = (plan) => {
            if (plan.stale) { const e = new Error(plan.stale_reason || 'The visual plan is stale against the saved script. Re-anchor it first.'); e.statusCode = 409; throw e; }
            return plan;
          };
          let plan;
          let extra = {};
          if (action === 'create-beats') {
            plan = vpApi.createBeats(state.script, existing, { replace: payload.replace === true });
          } else if (action === 'reanchor') {
            plan = vpApi.reanchorPlan(requirePlan(), state.script);
          } else if (action === 'set-disposition') {
            plan = vpApi.setBeatDisposition(requirePlan(), state.script, String(payload.beat_id || ''), payload.disposition);
          } else if (action === 'split-beat') {
            plan = vpApi.splitBeat(requirePlan(), state.script, String(payload.beat_id || ''), payload.at);
          } else if (action === 'merge-beats') {
            plan = vpApi.mergeWithNext(requirePlan(), state.script, String(payload.beat_id || ''));
          } else if (action === 'save-assignment') {
            plan = vpApi.saveAssignment(requireFresh(requirePlan()), state.script, String(payload.beat_id || ''), payload);
          } else if (action === 'approve-assignment') {
            plan = vpApi.approveAssignment(requireFresh(requirePlan()), state.script, String(payload.assignment_id || ''));
          } else if (action === 'reject-assignment') {
            plan = vpApi.rejectAssignment(requirePlan(), state.script, String(payload.assignment_id || ''));
          } else if (action === 'revoke-assignment') {
            plan = vpApi.revokeAssignment(requirePlan(), state.script, String(payload.assignment_id || ''));
          } else if (action === 'clear-assignment') {
            plan = vpApi.clearAssignment(requirePlan(), state.script, String(payload.assignment_id || ''), {
              allowRejected: payload.confirm_rejected === true,
            });
          } else if (action === 'generate-assignments') {
            const fresh = requireFresh(requirePlan());
            const selection = vpApi.selectBeatsForGeneration(fresh, {
              beatIds: Array.isArray(payload.beat_ids) ? payload.beat_ids.map(String) : null,
              batch: Number.isInteger(payload.batch) ? payload.batch : undefined,
            });
            plan = fresh;
            const generated = [];
            const failures = [];
            for (const beat of selection.beats) {
              try {
                const reqSpec = vpApi.buildAssignmentRequest(state.script, plan, beat);
                const gen = await superFocusGenerate(
                  { system: reqSpec.system, user: reqSpec.user, schema: reqSpec.schema, task: 'visual_assignment' },
                  options
                );
                const content = vpApi.parseGeneratedAssignment(gen.content); // 502 → nothing persisted for this beat
                plan = vpApi.saveAssignment(plan, state.script, beat.beat_id, content, { createdBy: 'local-model' });
                generated.push({ beat_id: beat.beat_id, order: beat.order });
              } catch (err) {
                failures.push({ beat_id: beat.beat_id, order: beat.order, error: err.message });
              }
            }
            extra = { generated, failures, skipped: selection.skipped, truncated: selection.truncated };
          }
          const saved = superFocus.saveVisualPlan(id, plan, { root: sfRoot });
          sendJSON(res, 200, Object.assign({
            project_id: id,
            visual_plan: saved.visual_plan,
            readiness: superFocusVisualPlan.computeVisualPlanReadiness(saved.visual_plan, saved.script),
          }, extra));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-visual-plan-error'));
      return;
    }

    // ── Unlinked-prompt recovery (Visual Plan governance) ──────────────────
    // Read-only preview: which unlinked (script-wide legacy) prompts are
    // eligible to clear, which are refused and why, which have downstream
    // artifacts (generated image/video on disk — never deleted by this
    // workflow), and the capacity consequence for approved assignments.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_CLEAR_UNLINKED_PREVIEW_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot });
        const rawIndexes = url.searchParams.get('indexes');
        const indexes = rawIndexes == null || rawIndexes === '' ? null
          : String(rawIndexes).split(',').map((s) => Math.round(Number(s.trim())));
        sendJSON(res, 200, buildClearUnlinkedPreview(id, state, indexes, sfRoot, sfMediaRoot));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-clear-unlinked-preview-error');
      }
      return;
    }

    // Commit: clear ONLY confirmed eligible unlinked prompts, snapshot-first.
    // Staged (not pretending to be atomic with generation): this route ONLY
    // clears; assignment-derived generation is the existing from-assignments
    // route, run afterwards. Media files are never touched.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_CLEAR_UNLINKED_API) {
      readJsonBody(req, 1024 * 256)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus clear-unlinked-prompts API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          const indexes = Array.isArray(payload.indexes) ? payload.indexes.map((n) => Math.round(Number(n))) : null;
          // Refuse while THIS project's FLUX batch is live — its materialized
          // prompt set and manifest reconciliation must not race a clear.
          const flux = currentFluxJobStatus();
          if (flux.active && FLUX_STATE.activeJob && FLUX_STATE.activeJob.packageId === id) {
            const e = new Error('A FLUX image job is running for this project. Wait for it to finish before clearing prompts.');
            e.statusCode = 409; throw e;
          }
          const preview = buildClearUnlinkedPreview(id, state, indexes, sfRoot, sfMediaRoot);
          // Stale-selection protection: the operator confirmed a specific count.
          const confirmCount = Math.round(Number(payload.confirm_count));
          if (!Number.isInteger(confirmCount) || confirmCount !== preview.eligible_count) {
            const e = new Error(`Confirmation count (${payload.confirm_count}) does not match the current eligible set (${preview.eligible_count}). The selection changed — review the preview again.`);
            e.statusCode = 409; e.code = 'confirmation_mismatch'; throw e;
          }
          if (preview.missing.length) {
            const e = new Error(`No prompt at index(es): ${preview.missing.join(', ')}. Reload and re-select.`);
            e.statusCode = 400; throw e;
          }
          if (preview.eligible_count === 0) {
            const e = new Error('No eligible unlinked prompts to clear.');
            e.statusCode = 400; throw e;
          }
          // Downstream artifacts require their own explicit acknowledgement.
          if (preview.requires_artifact_acknowledgement && payload.acknowledge_artifacts !== true) {
            const e = new Error(`${preview.artifacts.images} generated image(s) and ${preview.artifacts.videos} video(s) belong to prompts in this selection. They will NOT be deleted, but they become orphaned records. Re-submit with acknowledge_artifacts:true to proceed.`);
            e.statusCode = 409; e.code = 'artifacts_acknowledgement_required'; throw e;
          }
          const result = superFocus.clearUnlinkedImagePrompts(id, indexes, {
            root: sfRoot,
            protected: preview.protected_by,
            artifacts: preview.eligible.filter((r) => r.has_image || r.has_video),
            reason: 'operator_clear_unlinked',
          });
          const plan = superFocus.readVisualPlan(id, { root: sfRoot });
          sendJSON(res, 200, {
            project_id: id,
            cleared_indexes: result.cleared_indexes,
            cleared_count: result.cleared_indexes.length,
            refused: result.refused,
            snapshot_path: result.snapshot_path,
            image_prompts: result.state.image_prompts,
            integrity: superFocusVisualPlan.computePlanIntegrity(plan, result.state.image_prompts, superFocusPrompts.IMAGE_PROMPT_MAX),
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-clear-unlinked-error'));
      return;
    }

    // Create image prompts FROM approved assignments (the approval gate). The
    // model writes each prompt from the assignment context; ineligible rows
    // are skipped with explicit reasons; existing rows are never overwritten.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_PROMPTS_FROM_ASSIGNMENTS_API) {
      readJsonBody(req, 1024 * 256)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus prompts-from-assignments API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          const plan = superFocus.readVisualPlan(id, { root: sfRoot });
          if (!plan) { const e = new Error('No visual plan yet. Create beats and approve assignments first.'); e.statusCode = 400; throw e; }
          if (plan.stale) { const e = new Error(plan.stale_reason || 'The visual plan is stale. Re-anchor it before creating prompts.'); e.statusCode = 409; throw e; }
          const selection = superFocusVisualPlan.selectAssignmentsForPromptCreation(plan, state.image_prompts, {
            assignmentIds: Array.isArray(payload.assignment_ids) ? payload.assignment_ids.map(String) : null,
          });
          const items = [];
          const failures = [];
          for (const { beat, assignment } of selection.eligible) {
            try {
              const reqSpec = superFocusVisualPlan.buildPromptFromAssignmentRequest(beat, assignment, {});
              const gen = await superFocusGenerate(
                { system: reqSpec.system, user: reqSpec.user, task: 'image_prompt_from_assignment' },
                options
              );
              const text = String(gen.content || '')
                .replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '')
                .replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, '$1').replace(/```/g, '')
                .replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 4000).trim();
              if (!text) { const e = new Error('The model returned an empty prompt.'); e.statusCode = 502; throw e; }
              items.push({ text, assignment });
            } catch (err) {
              failures.push({ assignment_id: assignment.assignment_id, beat_id: beat.beat_id, error: err.message });
            }
          }
          const result = superFocus.fillPromptsFromAssignments(id, items, {
            root: sfRoot, capacity: superFocusPrompts.IMAGE_PROMPT_MAX,
          });
          sendJSON(res, 200, {
            project_id: id,
            placed: result.placed,
            overflow: result.overflow,
            skipped: selection.skipped,
            failures,
            image_prompts: result.state.image_prompts,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-prompts-from-assignments-error'));
      return;
    }

    // ── Image review (evidence vs acceptance criteria; operator decides) ──

    // Read-only: every row with an image or a review, with its EFFECTIVE
    // status (hash-recomputed), approval blockers, criteria diff, readiness.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_IMAGE_REVIEW_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot });
        const rows = (state.image_prompts || []).filter((r) => r && r.text && r.text.trim());
        const contexts = rows.map((row) => buildImageReviewContext(state, row, sfMediaRoot));
        const reviews = rows.map((row, i) => {
          const context = contexts[i];
          const eff = superFocusImageReview.effectiveReview(row, context);
          return {
            index: row.index,
            assignment_id: row.assignment_id || null,
            image_exists: context.image_exists,
            effective_status: eff.status,
            reasons: eff.reasons,
            criteria: eff.criteria,
            removed_criteria: eff.removed_criteria,
            override: eff.override,
            review: row.image_review || null,
            approval: row.image_review ? superFocusImageReview.approvalBlockers(row, context) : null,
            gate: superFocusImageReview.imageReviewGate(row, context),
            assignment: context.assignment ? {
              assignment_id: context.assignment.assignment_id,
              beat_id: context.assignment.beat_id,
              viewer_task: context.assignment.viewer_task,
              visual_function: context.assignment.visual_function,
              media_type: context.assignment.media_type,
              assignment: context.assignment.assignment,
              status: context.assignment.status,
            } : null,
          };
        });
        const withImages = rows.filter((_, i) => contexts[i].image_exists);
        sendJSON(res, 200, {
          project_id: id,
          reviews,
          readiness: superFocusImageReview.computeImageReviewReadiness(rows, contexts),
          images_present: withImages.length,
        });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-image-review-error');
      }
      return;
    }

    // Read-only Image Review Workbench: deterministic candidates + counts +
    // one selected candidate with its exact current image hash and an
    // advisory consequence preview. GET never mutates project, queue, or
    // attempt state; decisions go through the nonce-gated POST action.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_IMAGE_REVIEW_WORKBENCH_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot }); // validates id, 404 unknown
        const rawIndex = url.searchParams.get('index');
        let selectedIndex = null;
        if (rawIndex != null && rawIndex !== '') {
          const n = Number(rawIndex);
          if (!Number.isInteger(n) || n < 1 || n > superFocusPrompts.IMAGE_PROMPT_MAX) {
            sendError(res, 400, `index must be an integer between 1 and ${superFocusPrompts.IMAGE_PROMPT_MAX}.`, 'super-focus-image-review-workbench-error');
            return;
          }
          selectedIndex = n;
        }
        sendJSON(res, 200, buildImageReviewWorkbench(state, sfMediaRoot, { selectedIndex }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-image-review-workbench-error');
      }
      return;
    }

    // ── Video review (clip evidence vs the production contract) ──────────

    // Read-only queue audit: classifies live queue items against current
    // project truth WITHOUT the pump (the video-queue/videos-status GETs
    // reconcile-and-may-rewrite; this route never writes, never dispatches,
    // never contacts PRESTO). Safe on a paused production queue.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_VIDEO_QUEUE_AUDIT_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown project
        sendJSON(res, 200, auditSuperFocusVideoQueue(state, sfMediaRoot));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-video-queue-audit-error');
      }
      return;
    }

    // Read-only attempt-storage audit: staged-source retention, evidence
    // locks, orphan/missing staging, and cleanup CANDIDATES (report only —
    // nothing here deletes, and no cleanup route exists by design).
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_ATTEMPT_STORAGE_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown project
        const report = superFocusMedia.auditVideoAttemptStorage(id, state.image_prompts, { mediaRoot: sfMediaRoot });
        sendJSON(res, 200, report);
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-attempt-storage-error');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_VIDEO_REVIEW_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot });
        const subdir = superFocusVideoSubdir();
        const rows = (state.image_prompts || []).filter((r) => r && r.text && r.text.trim());
        const contexts = rows.map((row) => buildVideoReviewContext(state, row, sfMediaRoot, subdir));
        const reviews = rows.map((row, i) => {
          const context = contexts[i];
          const eff = superFocusVideoReview.effectiveVideoReview(row, context);
          return {
            index: row.index,
            assignment_id: row.assignment_id || null,
            video_exists: context.video_exists,
            render_provenance: context.render_provenance || null,
            image_review_status: context.image_review_status,
            effective_status: eff.status,
            reasons: eff.reasons,
            mismatches: eff.mismatches,
            criteria: eff.criteria,
            removed_criteria: eff.removed_criteria,
            usable_range: row.video_review ? row.video_review.usable_range : null,
            usable_range_current: eff.usable_range_current,
            override: eff.override,
            review: row.video_review || null,
            approval: row.video_review ? superFocusVideoReview.videoApprovalBlockers(row, context) : null,
            edit: superFocusVideoReview.videoEditEligibility(row, context),
            assignment: context.assignment ? {
              assignment_id: context.assignment.assignment_id,
              beat_id: context.assignment.beat_id,
              viewer_task: context.assignment.viewer_task,
              visual_function: context.assignment.visual_function,
              media_type: context.assignment.media_type,
              assignment: context.assignment.assignment,
              status: context.assignment.status,
            } : null,
            i2v_prompt_text: context.current_i2v_text,
          };
        });
        sendJSON(res, 200, {
          project_id: id,
          reviews,
          readiness: superFocusVideoReview.computeVideoReviewReadiness(rows, contexts),
        });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-video-review-error');
      }
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith(SUPER_FOCUS_VIDEO_REVIEW_ACTION_PREFIX)) {
      const action = url.pathname.slice(SUPER_FOCUS_VIDEO_REVIEW_ACTION_PREFIX.length);
      const KNOWN = ['start', 'set-criterion', 'save-notes', 'set-usable-range', 'approve', 'approve-override', 'reject', 'revoke', 'reopen', 'clear'];
      if (KNOWN.indexOf(action) === -1) {
        sendError(res, 404, `Unknown video-review action: ${action}`, 'super-focus-video-review-error');
        return;
      }
      readJsonBody(req, 1024 * 128)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: `Super Focus video-review ${action} API` });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          const idx = Math.round(Number(payload.index));
          const row = (state.image_prompts || []).find((r) => r.index === idx);
          if (!row) { const e = new Error(`No image prompt at index ${payload.index}.`); e.statusCode = 404; throw e; }
          const context = buildVideoReviewContext(state, row, sfMediaRoot, superFocusVideoSubdir());
          const vrApi = superFocusVideoReview;
          let review;
          if (action === 'start') review = vrApi.startVideoReview(row, context);
          else if (action === 'reopen') review = vrApi.reopenVideoReview(row, context);
          else if (action === 'set-criterion') review = vrApi.setVideoCriterion(row, String(payload.criterion_hash || ''), String(payload.result || ''), payload.note);
          else if (action === 'save-notes') review = vrApi.saveVideoNotes(row, payload.notes);
          else if (action === 'set-usable-range') review = vrApi.setUsableRange(row, payload.usable_range, payload.observed_duration_seconds);
          else if (action === 'approve') review = vrApi.approveVideo(row, context);
          else if (action === 'approve-override') review = vrApi.approveVideoWithOverride(row, context, payload.reason);
          else if (action === 'reject') review = vrApi.rejectVideo(row, payload.reason);
          else if (action === 'revoke') review = vrApi.revokeVideoApproval(row);
          else review = vrApi.clearVideoReview(row);
          const saved = superFocus.setVideoReview(id, idx, review, { root: sfRoot });
          const savedRow = (saved.image_prompts || []).find((r) => r.index === idx);
          const freshContext = buildVideoReviewContext(saved, savedRow, sfMediaRoot, superFocusVideoSubdir());
          const eff = vrApi.effectiveVideoReview(savedRow, freshContext);
          sendJSON(res, 200, {
            project_id: id,
            index: idx,
            review: savedRow.video_review || null,
            effective_status: eff.status,
            reasons: eff.reasons,
            mismatches: eff.mismatches,
            criteria: eff.criteria,
            removed_criteria: eff.removed_criteria,
            approval: savedRow.video_review ? vrApi.videoApprovalBlockers(savedRow, freshContext) : null,
            edit: vrApi.videoEditEligibility(savedRow, freshContext),
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-video-review-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith(SUPER_FOCUS_IMAGE_REVIEW_ACTION_PREFIX)) {
      const action = url.pathname.slice(SUPER_FOCUS_IMAGE_REVIEW_ACTION_PREFIX.length);
      const KNOWN = ['start', 'set-criterion', 'save-notes', 'approve', 'approve-override', 'reject', 'revoke', 'reopen', 'clear', 'workbench-decision'];
      if (KNOWN.indexOf(action) === -1) {
        sendError(res, 404, `Unknown image-review action: ${action}`, 'super-focus-image-review-error');
        return;
      }
      readJsonBody(req, 1024 * 128)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: `Super Focus image-review ${action} API` });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot }); // 404 unknown id
          // Workbench decisions bind to the exact displayed image and are
          // handled atomically (see the dedicated handler below).
          if (action === 'workbench-decision') {
            handleImageReviewWorkbenchDecision(res, state, payload, { sfRoot, sfMediaRoot });
            return;
          }
          const idx = Math.round(Number(payload.index));
          const row = (state.image_prompts || []).find((r) => r.index === idx);
          if (!row) { const e = new Error(`No image prompt at index ${payload.index}.`); e.statusCode = 404; throw e; }
          const context = buildImageReviewContext(state, row, sfMediaRoot);
          const ir = superFocusImageReview;
          let review;
          if (action === 'start') review = ir.startReview(row, context);
          else if (action === 'reopen') review = ir.reopen(row, context);
          else if (action === 'set-criterion') review = ir.setCriterion(row, String(payload.criterion_hash || ''), String(payload.result || ''), payload.note);
          else if (action === 'save-notes') review = ir.saveNotes(row, payload.notes);
          else if (action === 'approve') review = ir.approve(row, context);
          else if (action === 'approve-override') review = ir.approveWithOverride(row, context, payload.reason);
          else if (action === 'reject') review = ir.reject(row, payload.reason);
          else if (action === 'revoke') review = ir.revoke(row);
          else review = ir.clearReview(row); // 'clear' → null when safe
          const saved = superFocus.setImageReview(id, idx, review, { root: sfRoot });
          const savedRow = (saved.image_prompts || []).find((r) => r.index === idx);
          const freshContext = buildImageReviewContext(saved, savedRow, sfMediaRoot);
          const eff = ir.effectiveReview(savedRow, freshContext);
          sendJSON(res, 200, {
            project_id: id,
            index: idx,
            review: savedRow.image_review || null,
            effective_status: eff.status,
            reasons: eff.reasons,
            criteria: eff.criteria,
            removed_criteria: eff.removed_criteria,
            approval: savedRow.image_review ? ir.approvalBlockers(savedRow, freshContext) : null,
            gate: ir.imageReviewGate(savedRow, freshContext),
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-image-review-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_TITLE_API) {
      readJsonBody(req, 1024 * 256)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus title save API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.saveTitle(id, payload.title, { root: sfRoot });
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-title-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_SCRIPT_API) {
      readJsonBody(req, 1024 * 256)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus script save API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.saveScript(id, payload.script, { root: sfRoot });
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-script-error'));
      return;
    }

    // Generate a VIDTOOLZ topic via local Ollama (vidnux lane). Returns the text
    // only; the operator explicitly Saves to persist it. No fallback to cloud.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_TOPIC_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus topic generation API' });
          const id = payload.id || payload.project_id || '';
          superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown project
          const reqPrompt = superFocusPrompts.buildTopicRequest();
          const gen = await superFocusGenerate(
            { system: reqPrompt.system, user: reqPrompt.user, task: 'topic' },
            options
          );
          const topic = superFocusPrompts.cleanTopic(gen.content);
          if (!topic) { const e = new Error('Ollama returned an empty topic.'); e.statusCode = 502; throw e; }
          sendJSON(res, 200, { topic, provider: gen.provider, provider_host: gen.provider.id === 'presto_ollama' ? 'presto' : 'vidnux', model: gen.provider.model });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-topic-error'));
      return;
    }

    // Generate a script from the SAVED title via local Ollama (vidnux lane).
    // Returns text only; operator Saves to persist. Requires a saved title.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_SCRIPT_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus script generation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          if (!state.title || !state.title.trim()) {
            const e = new Error('Save a title first, then generate the script.'); e.statusCode = 400; throw e;
          }
          const reqPrompt = superFocusPrompts.buildScriptRequest(state.title);
          const gen = await superFocusGenerate(
            { system: reqPrompt.system, user: reqPrompt.user, task: 'script' },
            options
          );
          const script = superFocusPrompts.cleanScript(gen.content);
          if (!script) { const e = new Error('Ollama returned an empty script.'); e.statusCode = 502; throw e; }
          sendJSON(res, 200, { script, provider: gen.provider, provider_host: gen.provider.id === 'presto_ollama' ? 'presto' : 'vidnux', model: gen.provider.model });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-script-error'));
      return;
    }

    // Generate up to 100 image prompts from the SAVED script and persist them.
    // Requires a saved script; 409 unless confirm_replace when prompts exist.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus image-prompts generation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          if (!state.script || !state.script.trim()) {
            const e = new Error('Save a script first, then create image prompts.'); e.statusCode = 400; throw e;
          }
          assertScriptWideLegacyAllowed(state, payload);
          if (Array.isArray(state.image_prompts) && state.image_prompts.length > 0 && !payload.confirm_replace) {
            const e = new Error(`${state.image_prompts.length} image prompt(s) already exist. Re-submit with confirm_replace to regenerate.`);
            e.statusCode = 409; throw e;
          }
          // Operator-chosen count (1..MAX); absent keeps the historical up-to-MAX behavior.
          const count = validateSuperFocusCount(payload.count, superFocusPrompts.IMAGE_PROMPT_MAX, 'count');
          const reqPrompt = superFocusPrompts.buildImagePromptsRequest(state.script, count);
          const gen = await superFocusGenerate(
            { system: reqPrompt.system, user: reqPrompt.user, schema: reqPrompt.schema, task: 'image_prompts', requestedCount: count },
            options
          );
          const prompts = superFocusPrompts.parsePromptArray(gen.content, count);
          const saved = superFocus.saveImagePrompts(id, prompts, { root: sfRoot });
          sendJSON(res, 200, { project: saved, count: saved.image_prompts.length, provider: gen.provider, provider_host: gen.provider.id === 'presto_ollama' ? 'presto' : 'vidnux', model: gen.provider.model });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-image-prompts-error'));
      return;
    }

    // Top-up: generate prompts ONLY for the currently-empty image-prompt slots
    // (up to capacity) and drop them into those index gaps. Existing filled rows
    // — text, i2v prompt, image state, stale flags — are preserved untouched.
    // This is non-destructive: no confirm_replace gate, and it never flags an
    // unchanged filled row stale.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus remaining-image-prompts generation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          if (!state.script || !state.script.trim()) {
            const e = new Error('Save a script first, then create image prompts.'); e.statusCode = 400; throw e;
          }
          assertScriptWideLegacyAllowed(state, payload);
          const capacity = superFocusPrompts.IMAGE_PROMPT_MAX;
          const records = Array.isArray(state.image_prompts) ? state.image_prompts : [];
          const filledIndexes = new Set(records.filter((r) => r && r.text && r.text.trim()).map((r) => r.index));
          const filledTexts = records.filter((r) => r && r.text && r.text.trim()).map((r) => r.text.trim());
          let emptyCount = 0;
          for (let i = 1; i <= capacity; i += 1) if (!filledIndexes.has(i)) emptyCount += 1;
          if (emptyCount === 0) {
            const e = new Error(`All ${capacity} prompt slots are already filled.`); e.statusCode = 400; throw e;
          }
          const before = filledTexts.length;
          const existingLower = new Set(filledTexts.map((t) => t.toLowerCase()));
          const reqPrompt = superFocusPrompts.buildImagePromptsRequest(state.script, emptyCount, filledTexts);
          const runAttempt = async () => {
            const g = await superFocusGenerate(
              { system: reqPrompt.system, user: reqPrompt.user, schema: reqPrompt.schema, task: 'image_prompts_topup', requestedCount: emptyCount },
              options
            );
            const parsed = superFocusPrompts.parsePromptArray(g.content, emptyCount);
            const distinct = parsed.filter((p) => !existingLower.has(p.trim().toLowerCase()));
            return { provider: g.provider, parsed, distinct };
          };
          // First attempt; if it yields zero usable (all duplicates) prompts, retry
          // ONCE — the model (temperature > 0) usually returns fresh candidates.
          let attempt = await runAttempt();
          let retried = false;
          if (attempt.distinct.length === 0) { retried = true; attempt = await runAttempt(); }
          const candidatesReturned = attempt.parsed.length;
          const distinct = attempt.distinct;
          const provider = attempt.provider;
          const generatedPromptHashesByIndex = superFocusMedia.generatedPromptHashesByIndex(id, { mediaRoot: sfMediaRoot });
          const saved = superFocus.fillEmptyImagePrompts(id, distinct, { root: sfRoot, capacity, generatedPromptHashesByIndex });
          const after = (saved.image_prompts || []).filter((r) => r && r.text && r.text.trim()).length;
          const added = after - before;
          const noProgress = added === 0 && emptyCount > 0;
          const reason = !noProgress ? null
            : (candidatesReturned > 0 ? 'all_candidates_duplicate_existing_prompts' : 'model_returned_no_usable_prompts');
          sendJSON(res, 200, {
            project: saved,
            capacity,
            empty_before: emptyCount,
            requested_limit: emptyCount,
            effective_limit: emptyCount,
            eligible: emptyCount,
            candidates_returned: candidatesReturned,
            candidates_parsed: candidatesReturned,
            duplicates_dropped: Math.max(0, candidatesReturned - distinct.length),
            added,
            total_filled: after,
            remaining_eligible: emptyCount - added,
            no_progress: noProgress,
            reason,
            retried,
            provider, provider_host: provider.id === 'presto_ollama' ? 'presto' : 'vidnux', model: provider.model,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-remaining-image-prompts-error'));
      return;
    }

    // Generate up to 30 infographic prompts from the SAVED script and persist.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_INFOGRAPHIC_PROMPTS_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus infographic-prompts generation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          if (!state.script || !state.script.trim()) {
            const e = new Error('Save a script first, then create infographic prompts.'); e.statusCode = 400; throw e;
          }
          if (Array.isArray(state.infographic_prompts) && state.infographic_prompts.length > 0 && !payload.confirm_replace) {
            const e = new Error(`${state.infographic_prompts.length} infographic prompt(s) already exist. Re-submit with confirm_replace to regenerate.`);
            e.statusCode = 409; throw e;
          }
          const count = validateSuperFocusCount(payload.count, superFocusPrompts.INFOGRAPHIC_PROMPT_MAX, 'count');
          const reqPrompt = superFocusPrompts.buildInfographicPromptsRequest(state.script, count);
          const gen = await superFocusGenerate(
            { system: reqPrompt.system, user: reqPrompt.user, schema: reqPrompt.schema, task: 'infographic_prompts', requestedCount: count },
            options
          );
          const prompts = superFocusPrompts.parsePromptArray(gen.content, count);
          const saved = superFocus.saveInfographicPrompts(id, prompts, { root: sfRoot });
          sendJSON(res, 200, { project: saved, count: saved.infographic_prompts.length, provider: gen.provider, provider_host: gen.provider.id === 'presto_ollama' ? 'presto' : 'vidnux', model: gen.provider.model });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-infographic-prompts-error'));
      return;
    }

    // Top-up (slot-safe, default Step-5 action): generate infographic prompts
    // ONLY for currently-empty slots (up to capacity) and drop them into those
    // index gaps. Existing infographic prompts are preserved by index and never
    // overwritten or renumbered. No confirm_replace gate. "count" is an UPPER
    // BOUND (clamped to capacity; a value above capacity is accepted, not rejected).
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus missing-infographic-prompts generation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          if (!state.script || !state.script.trim()) {
            const e = new Error('Save a script first, then create infographic prompts.'); e.statusCode = 400; throw e;
          }
          const capacity = superFocusPrompts.INFOGRAPHIC_PROMPT_MAX;
          const records = Array.isArray(state.infographic_prompts) ? state.infographic_prompts : [];
          const filled = records.filter((r) => r && r.text && r.text.trim());
          const filledIndexes = new Set(filled.map((r) => r.index));
          const filledTexts = filled.map((r) => r.text.trim());
          let eligible = 0;
          for (let i = 1; i <= capacity; i += 1) if (!filledIndexes.has(i)) eligible += 1;
          if (eligible === 0) {
            const e = new Error(`All ${capacity} infographic prompt slots are already filled.`); e.statusCode = 400; throw e;
          }
          // "count" (or "limit") is an upper bound: clamp to capacity, reject only
          // non-integer/zero/negative. Absent = all eligible empty slots.
          const raw = payload.count !== undefined ? payload.count : payload.limit;
          const hasLimit = !(raw === undefined || raw === null || raw === '');
          let requestedLimit = null;
          let effectiveLimit = eligible;
          if (hasLimit) {
            const nNum = Number(raw);
            if (!Number.isInteger(nNum) || nNum < 1) { const e = new Error('count must be a positive integer.'); e.statusCode = 400; throw e; }
            requestedLimit = nNum;
            effectiveLimit = Math.min(nNum, capacity);
          }
          const willGenerate = Math.min(effectiveLimit, eligible);
          const before = filled.length;

          // Resolve the provider ONCE so every chunk uses the same lane and the
          // reported provider is stable. Fail early if no provider is usable.
          const decision = await resolveSuperFocusOllamaProvider('infographic_prompts_topup', options);
          if (decision.error) {
            const e = new Error(decision.message || `No usable Ollama provider (${decision.error}).`);
            e.statusCode = decision.error === 'not_configured' ? 400 : 503;
            throw e;
          }
          const chunkSize = superFocusChunkSize(options);
          const timeoutMs = superFocusOllamaTimeoutMs('infographic_prompts_topup', options);

          // CHUNKED generation: many small Ollama calls instead of one oversized
          // request. Each successful chunk is parsed, deduped, and SAVED before
          // the next chunk runs (partial success survives a later timeout).
          let added = 0;
          let chunksAttempted = 0;
          let chunksSucceeded = 0;
          let errorInfo = null;
          const perChunkMs = [];
          const addedTexts = [];
          let latest = state;
          const t0 = Date.now();
          while (added < willGenerate) {
            const remaining = willGenerate - added;
            const n = Math.min(chunkSize, remaining);
            chunksAttempted += 1;
            const exclusions = filledTexts.concat(addedTexts);
            const reqPrompt = superFocusPrompts.buildInfographicPromptsRequest(state.script, n, exclusions);
            const cStart = Date.now();
            let content;
            try {
              content = await callOllamaChat(
                { system: reqPrompt.system, user: reqPrompt.user, schema: reqPrompt.schema, model: decision.model, baseUrl: decision.base_url },
                Object.assign({}, options, { timeoutMs })
              );
            } catch (error) {
              perChunkMs.push(Date.now() - cStart);
              enrichOllamaError(error, decision, 'infographic_prompts_topup', n, timeoutMs);
              errorInfo = { kind: error.statusCode === 504 ? 'timeout' : (error.statusCode === 503 ? 'unreachable' : 'error'), message: error.message, status: error.statusCode || 500 };
              break;
            }
            perChunkMs.push(Date.now() - cStart);
            const parsed = superFocusPrompts.parsePromptArray(content, n);
            const seen = new Set(exclusions.map((t) => t.toLowerCase()));
            const distinct = parsed.filter((p) => !seen.has(p.trim().toLowerCase())).slice(0, n);
            if (distinct.length === 0) break; // model only echoed dups — stop (no progress)
            latest = superFocus.fillEmptyInfographicPrompts(id, distinct, { root: sfRoot, capacity }); // PARTIAL SAVE
            const nowFilled = (latest.infographic_prompts || []).filter((r) => r && r.text && r.text.trim()).length;
            const newlyAdded = (nowFilled - before) - added;
            if (newlyAdded <= 0) break; // no empty slot took it — avoid an infinite loop
            distinct.slice(0, newlyAdded).forEach((t) => addedTexts.push(t));
            added += newlyAdded;
            chunksSucceeded += 1;
          }

          // No chunk succeeded and we hit an error -> clear failure (with context).
          if (added === 0 && errorInfo) {
            const e = new Error(errorInfo.message); e.statusCode = errorInfo.status || 504; throw e;
          }

          const provider = publicProvider(decision);
          sendJSON(res, 200, {
            project: latest,
            capacity,
            requested_limit: requestedLimit,
            effective_limit: hasLimit ? effectiveLimit : null,
            eligible,
            will_generate: willGenerate,
            added,
            total_filled: before + added,
            skipped_existing: before,
            remaining_eligible: eligible - added,
            chunk_size: chunkSize,
            chunks_attempted: chunksAttempted,
            chunks_succeeded: chunksSucceeded,
            partial_success: Boolean(errorInfo) && added > 0,
            timing: { total_ms: Date.now() - t0, per_chunk_ms: perChunkMs },
            error: errorInfo ? { kind: errorInfo.kind, message: errorInfo.message } : null,
            provider,
            provider_host: provider.id === 'presto_ollama' ? 'presto' : 'vidnux',
            model: provider.model,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-missing-infographic-prompts-error'));
      return;
    }

    // Save a single image prompt slot by 1-based index (per-row "Save changes").
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_IMAGE_PROMPT_API) {
      readJsonBody(req, 1024 * 64)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus image-prompt save API' });
          const id = payload.id || payload.project_id || '';
          const generatedPromptHashesByIndex = superFocusMedia.generatedPromptHashesByIndex(id, { mediaRoot: sfMediaRoot });
          const state = superFocus.saveImagePrompt(id, payload.index, payload.text, { root: sfRoot, generatedPromptHashesByIndex });
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-image-prompt-error'));
      return;
    }

    // Save a single infographic prompt slot by 1-based index.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_INFOGRAPHIC_PROMPT_API) {
      readJsonBody(req, 1024 * 64)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus infographic-prompt save API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.saveInfographicPrompt(id, payload.index, payload.text, { root: sfRoot });
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-infographic-prompt-error'));
      return;
    }

    // Start a supervised image batch: materialize prompts to the VIDNAS media
    // dir and dispatch run-handoff.py (vidnux FLUX). Reuses the global FLUX lock
    // (409 if busy). No ComfyUI auto-start, no cloud fallback.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_IMAGES_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus image generation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          if (!Array.isArray(state.image_prompts) || state.image_prompts.length === 0) {
            const e = new Error('Create image prompts first, then generate images.'); e.statusCode = 400; throw e;
          }
          // Pre-flight: resolve the image ComfyUI provider. vidnux is preferred;
          // PRESTO is used only when vidnux is UNREACHABLE and PRESTO image is
          // configured+reachable+validated. No cloud fallback. Fail clearly.
          const imgDecision = await resolveSuperFocusImageProvider(options);
          if (!imgDecision.provider_id) {
            const e = new Error(imgDecision.reason);
            e.statusCode = 503;
            e.provider = { status: 'unavailable', warnings: imgDecision.warnings };
            throw e;
          }
          const imgProvider = publicImageProvider(imgDecision);
          const comfyuiUrl = imgDecision.provider_id === 'presto_comfyui' ? imgDecision.base_url : null;
          // Determine the eligible target set BEFORE dispatch. A row is eligible
          // only if its prompt text is non-empty AND it has no image yet. Reuse
          // the on-disk reconciliation (files win) for existing-image detection.
          const capacity = superFocusPrompts.IMAGE_PROMPT_MAX;
          const recon = superFocusMedia.reconcileImages(id, state.image_prompts, { mediaRoot: sfMediaRoot });
          const hasImage = new Set(recon.images.filter((r) => r.has_image).map((r) => r.index));
          const promptChanged = new Set(recon.images.filter((r) => r.prompt_changed).map((r) => r.index));
          const slots = state.image_prompts.filter((r) => r && r.index >= 1 && r.index <= capacity);
          const withText = slots.filter((r) => typeof r.text === 'string' && r.text.trim());
          const skippedEmpty = slots.length - withText.length;
          const eligibleRows = withText
            .filter((r) => !hasImage.has(r.index) || promptChanged.has(r.index))
            .sort((a, b) => a.index - b.index);
          const promptChangedEligible = eligibleRows.filter((r) => promptChanged.has(r.index)).length;
          const skippedExisting = withText.length - eligibleRows.length;
          if (eligibleRows.length === 0) {
            const e = new Error('No rows need an image. Every prompt with text already has a generated image.');
            e.statusCode = 400; throw e;
          }
          // "Images to generate" is an UPPER BOUND over eligible rows — not a
          // forced count, and never applied to empty or already-generated rows.
          // A value above the capacity is CLAMPED to capacity (not rejected):
          // there are only `capacity` slots, so a larger bound just means "all".
          // Only non-integer / zero / negative values are invalid. Absent = all
          // eligible.
          const hasLimit = !(payload.limit === undefined || payload.limit === null || payload.limit === '');
          let requestedLimit = null;
          let effectiveLimit = eligibleRows.length;
          if (hasLimit) {
            const n = Number(payload.limit);
            if (!Number.isInteger(n) || n < 1) {
              const e = new Error('limit must be a positive integer.'); e.statusCode = 400; throw e;
            }
            requestedLimit = n;
            effectiveLimit = Math.min(n, capacity);
          }
          const targetRows = eligibleRows.slice(0, effectiveLimit);
          const willGenerate = targetRows.length;
          const remainingEligible = eligibleRows.length - willGenerate;
          // Refuse BEFORE materializing while a batch is running — otherwise the
          // 409 below would land only after image-prompts.json (the running
          // job's input file) had already been rewritten with a different set.
          const curFlux = currentFluxJobStatus();
          if (curFlux.active) {
            const e = new Error('A FLUX image job is already running. Wait for it to finish.');
            e.statusCode = 409; e.active = curFlux; throw e;
          }
          // Materialize ONLY the target rows so run-handoff.py generates exactly
          // those indexes — empty and already-imaged rows are never enqueued.
          const materialized = superFocusMedia.materializeImagePrompts(id, targetRows, { mediaRoot: sfMediaRoot });
          const job = startSuperFocusImageJob(materialized.mediaDir, {
            projectId: id,
            limit: 0, // the materialized file already contains exactly the target set
            skipExisting: payload.skip_existing !== false,
            dryRun: Boolean(payload.dry_run),
            spawn: options.spawn,
            comfyCliCheck: options.comfyCliCheck,
            // Dispatch script/python are env-overridable so the lane can follow
            // the real host (or a stub) without code edits; falls back to the
            // canonical vidnux run-handoff.py.
            fluxScript: options.fluxScript || process.env.SUPER_FOCUS_FLUX_SCRIPT,
            pythonBin: options.pythonBin || process.env.SUPER_FOCUS_PYTHON_BIN,
            // Only set when routed to PRESTO — vidnux runs default in-place. run-
            // handoff.py must honor --comfyui-url for this to reach PRESTO (Patch 2).
            comfyuiUrl,
            payload,
          });
          // Only clear mismatch markers for rows that definitely get a fresh file
          // under existing skip/force semantics. If a prompt_changed row still has
          // an on-disk image and normal skip_existing is active, keep it flagged
          // so the operator sees the mismatch instead of a silent "done".
          const dispatchedIndexes = targetRows.map((r) => r.index);
          const targetIndexes = targetRows
            .filter((r) => !hasImage.has(r.index) || payload.skip_existing === false)
            .map((r) => r.index);
          if (targetIndexes.length) superFocus.clearImageStale(id, targetIndexes, { root: sfRoot });
          // Provenance: record which provider/workflow served this batch (honest
          // even if the run later fails). Never claims a provider it did not use.
          try {
            superFocusMedia.writeImageProviderProvenance(id, {
              provider_id: imgProvider.id, label: imgProvider.label, workflow: imgProvider.workflow,
              base_url: imgProvider.base_url, reason: imgProvider.reason, run_id: job && job.job_id,
              indexes: dispatchedIndexes,
            }, { mediaRoot: sfMediaRoot });
          } catch (_) { /* provenance is best-effort; never blocks generation */ }
          sendJSON(res, 200, {
            job,
            capacity,
            eligible: eligibleRows.length,
            will_generate: willGenerate,
            requested_limit: requestedLimit,
            effective_limit: hasLimit ? effectiveLimit : null,
            skipped_existing: skippedExisting,
            prompt_changed: promptChangedEligible,
            skipped_empty: skippedEmpty,
            remaining_eligible: remainingEligible,
            materialized_count: materialized.count,
            media_dir: materialized.mediaDir,
            provider: imgProvider,
            provider_host: imgProvider.id === 'presto_comfyui' ? 'presto' : 'vidnux',
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-images-error'));
      return;
    }

    // Read-only: reconcile per-index image state from the on-disk manifest + PNG
    // files (files win — survives a server restart), plus the FLUX job status.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_IMAGES_STATUS_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
        const state = superFocus.loadProject(id, { root: sfRoot });
        const recon = superFocusMedia.reconcileImages(id, state.image_prompts, { mediaRoot: sfMediaRoot });
        const flux = currentFluxJobStatus();
        sendJSON(res, 200, {
          project_id: id,
          flux_job: flux,
          job_is_this_project: Boolean(flux.active && flux.package_id === id),
          busy_elsewhere: Boolean(flux.active && flux.package_id !== id),
          manifest_exists: recon.manifest_exists,
          total: recon.total,
          done: recon.done,
          failed: recon.failed,
          images: recon.images,
        });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-images-status-error');
      }
      return;
    }

    // Cancel the active FLUX job (nonce-gated). Project-scoped: do not stop
    // another project's image batch just because the lock is global.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_IMAGES_CANCEL_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus image cancel API' });
          const id = payload && payload.id;
          const active = currentFluxJobStatus();
          if (active.active && active.package_id !== id) {
            sendJSON(res, 409, { error: 'busy_elsewhere', message: 'The active image batch belongs to another project and was not stopped.' });
            return;
          }
          const result = await cancelFluxJob(options);
          sendJSON(res, 200, result);
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-images-cancel-error'));
      return;
    }

    // Serve one generated PNG from the project's media dir (path-guarded).
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_IMAGE_FILE_API) {
      try {
        const id = url.searchParams.get('id') || '';
        superFocus.assertValidProjectId(id);
        const filePath = superFocusMedia.safeImageFilePath(id, url.searchParams.get('index'), { mediaRoot: sfMediaRoot });
        if (!filePath || !fs.existsSync(filePath)) { sendError(res, 404, 'Image not found.', 'super-focus-image-missing'); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        // The PNG can be archived (renamed) between the exists check and the
        // stream open, and the NAS can fail mid-stream — an unguarded stream
        // error would leave the response hanging (or crash an embedding process).
        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => { console.error('Super Focus image stream error:', err.message); res.destroy(); });
        stream.pipe(res);
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-image-error');
      }
      return;
    }

    // Generate one image-to-video motion prompt for a given image-prompt row,
    // via local Ollama on PRESTO (media-routing lane; NO fallback to vidnux/cloud).
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_I2V_PROMPT_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus I2V prompt generation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          const idx = Math.round(Number(payload.index));
          const row = (state.image_prompts || []).find((r) => r.index === idx);
          if (!row || !row.text) {
            const e = new Error(`No image prompt at index ${payload.index}.`); e.statusCode = 400; throw e;
          }
          // Non-destructive invariant: a normal "create" must not overwrite an
          // existing i2v prompt. Replacing one is explicit (regenerate:true) or
          // done by clearing the slot first.
          if (superFocus.hasI2vPrompt(row) && !payload.regenerate && !payload.force) {
            const e = new Error('This row already has an i2v prompt. Clear it or use Regenerate to replace it.'); e.statusCode = 409; throw e;
          }
          // Include the generated still's path as metadata when it exists.
          let imageMetadata = '(still not generated yet; base the motion on the image prompt)';
          const filePath = superFocusMedia.safeImageFilePath(id, idx, { mediaRoot: sfMediaRoot });
          if (filePath && fs.existsSync(filePath)) {
            imageMetadata = `${superFocusMedia.imageFileName(idx)} (vertical 1080x1920 still, generator flux-local-vidnux)`;
          }
          const reqPrompt = superFocusPrompts.buildI2vPromptRequest({
            script: state.script, imagePrompt: row.text, imageMetadata,
            assignment: row.assignment_id && state.visual_plan
              ? (state.visual_plan.assignments || []).find((x) => x.assignment_id === row.assignment_id) || null
              : null,
          });
          // PRESTO Ollama lane only; unreachable -> canonical 503 blocked state.
          const content = await callPrestoOllamaChat(
            { system: reqPrompt.system, user: reqPrompt.user },
            options
          );
          const text = superFocusPrompts.cleanI2vPrompt(content);
          if (!text) { const e = new Error('Ollama returned an empty I2V prompt.'); e.statusCode = 502; throw e; }
          const saved = superFocus.setI2vPrompt(id, idx, text, { root: sfRoot, status: 'generated' });
          sendJSON(res, 200, { project: saved, index: idx, provider: 'ollama', provider_host: 'presto' });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-i2v-prompt-error'));
      return;
    }

    // Save an edited I2V prompt to a specific image-prompt row (nonce-gated).
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_I2V_PROMPT_API) {
      readJsonBody(req, 1024 * 64)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus I2V prompt save API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.setI2vPrompt(id, Math.round(Number(payload.index)), payload.text, { root: sfRoot, status: 'saved' });
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-i2v-prompt-error'));
      return;
    }

    // Manually clear a row's i2v prompt so it becomes eligible for generation
    // again (nonce-gated). Non-destructive to the image/prompt.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_CLEAR_I2V_PROMPT_API) {
      readJsonBody(req, 1024 * 8)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus clear-i2v-prompt API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.clearI2vPrompt(id, Math.round(Number(payload.index)), { root: sfRoot });
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-clear-i2v-prompt-error'));
      return;
    }

    // Top-up: create i2v prompts ONLY for generated-image rows that don't have
    // one yet. Populated i2v slots are never overwritten (that is Regenerate).
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_MISSING_I2V_PROMPTS_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus missing-i2v-prompts API' });
          const id = payload.id || payload.project_id || '';
          let state = superFocus.loadProject(id, { root: sfRoot });
          const withImage = (state.image_prompts || []).filter((r) => {
            if (!r || !r.text || !r.text.trim()) return false;
            const fp = superFocusMedia.safeImageFilePath(id, r.index, { mediaRoot: sfMediaRoot });
            return fp && fs.existsSync(fp);
          });
          const eligible = withImage.filter((r) => !superFocus.hasI2vPrompt(r));
          const skippedPopulated = withImage.length - eligible.length;
          if (eligible.length === 0) {
            const e = new Error('No rows need an i2v prompt. Each generated image with a prompt already has one.'); e.statusCode = 400; throw e;
          }
          let generated = 0;
          const errors = [];
          for (const r of eligible) {
            try {
              const imageMetadata = `${superFocusMedia.imageFileName(r.index)} (vertical 1080x1920 still, generator flux-local-vidnux)`;
              const reqPrompt = superFocusPrompts.buildI2vPromptRequest({
                script: state.script, imagePrompt: r.text, imageMetadata,
                assignment: r.assignment_id && state.visual_plan
                  ? (state.visual_plan.assignments || []).find((x) => x.assignment_id === r.assignment_id) || null
                  : null,
              });
              const content = await callPrestoOllamaChat({ system: reqPrompt.system, user: reqPrompt.user }, options);
              const text = superFocusPrompts.cleanI2vPrompt(content);
              if (!text) { errors.push({ index: r.index, error: 'empty i2v prompt' }); continue; }
              state = superFocus.setI2vPrompt(id, r.index, text, { root: sfRoot, status: 'generated' });
              generated += 1;
            } catch (err) {
              errors.push({ index: r.index, error: err.message });
              // A connection/503 failure means PRESTO is down — the rest will fail
              // too. Surface it honestly rather than a misleading partial 200.
              if (err.statusCode === 503 || /ECONNREFUSED|not reachable|fetch failed/i.test(err.message || '')) {
                if (generated === 0) throw err;
                break;
              }
            }
          }
          sendJSON(res, 200, {
            project: state,
            eligible: eligible.length,
            generated,
            failed: errors.length,
            skipped_populated: skippedPopulated,
            errors,
            provider: 'ollama', provider_host: 'presto',
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-generate-missing-i2v-prompts-error'));
      return;
    }

    // Manually clear (archive/supersede) a row's generated image so the row is
    // eligible for normal image generation again. Safe: the file is moved to
    // superseded/ with provenance, never destructively deleted. Nonce-gated.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_CLEAR_IMAGE_API) {
      readJsonBody(req, 1024 * 8)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus clear-image API' });
          const id = payload.id || payload.project_id || '';
          superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown project
          const idx = Math.round(Number(payload.index));
          if (!Number.isInteger(idx) || idx < 1) { const e = new Error('index must be a positive integer.'); e.statusCode = 400; throw e; }
          const result = superFocusMedia.archiveImage(id, idx, { mediaRoot: sfMediaRoot });
          // The image is gone, so a stale prompt/image mismatch no longer applies.
          if (result.archived) superFocus.clearImageStale(id, [idx], { root: sfRoot });
          sendJSON(res, 200, { ok: true, index: idx, archived: result.archived, archived_path: result.archived_path || null });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-clear-image-error'));
      return;
    }

    // Explicit per-row image regeneration. Distinct from the top-up batch: it
    // archives the existing image (supersede, never overwrite in place), records
    // provenance, and dispatches a fresh forced run for this one row. Byte-
    // identical results are surfaced on status as duplicate_of_previous (the
    // external run-handoff.py does not yet vary the seed — see docs/super-focus).
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_REGENERATE_IMAGE_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus regenerate-image API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          const idx = Math.round(Number(payload.index));
          const row = (state.image_prompts || []).find((r) => r.index === idx);
          if (!row || !row.text || !row.text.trim()) {
            const e = new Error(`No image prompt at index ${payload.index} to regenerate.`); e.statusCode = 400; throw e;
          }
          // A rerun only produces a DIFFERENT image if the handoff can vary the
          // seed. If it can't, an explicit regenerate would just reproduce the
          // same pixels and be rejected as a duplicate — so report that honestly
          // and do nothing (keep the current image), rather than churn.
          const seedSupported = fluxHandoffSupportsSeed(options);
          if (!seedSupported) {
            sendJSON(res, 200, {
              regenerated: false,
              seed_variation_supported: false,
              index: idx,
              reason: 'seed_variation_unsupported',
              message: 'Regenerate image requires seed-varied FLUX handoff support. The current run-handoff.py has no --seed option, so a rerun would reproduce the same image. Add --seed support to enable meaningful regeneration; the previous image is kept.',
            });
            return;
          }
          // Refuse before archiving if the single FLUX lock is held — otherwise we
          // would move the image aside and then fail to start the replacement.
          const cur = currentFluxJobStatus();
          if (cur.active) { const e = new Error('A FLUX image job is already running. Wait for it to finish.'); e.statusCode = 409; e.active = cur; throw e; }
          const reach = options.fluxReachableCheck || options.reachableCheck || prestoComfyuiReachable;
          if (!(await reach(LOCAL_IMAGE_PROVIDER.url, options))) {
            const e = new Error(`vidnux ComfyUI is not reachable at ${LOCAL_IMAGE_PROVIDER.url}. Start ComfyUI on vidnux and retry (no fallback to cloud).`); e.statusCode = 503; throw e;
          }
          const seed = superFocusRegenSeed(options); // fresh seed => a real fresh attempt
          const archived = superFocusMedia.archiveImage(id, idx, { mediaRoot: sfMediaRoot });
          let materialized;
          let job;
          try {
            materialized = superFocusMedia.materializeImagePrompts(id, [row], { mediaRoot: sfMediaRoot });
            job = startSuperFocusImageJob(materialized.mediaDir, {
              projectId: id,
              limit: 0,
              skipExisting: false, // forced: the canonical slot was just archived empty
              dryRun: Boolean(payload.dry_run),
              spawn: options.spawn,
              comfyCliCheck: options.comfyCliCheck,
              fluxScript: options.fluxScript || process.env.SUPER_FOCUS_FLUX_SCRIPT,
              pythonBin: options.pythonBin || process.env.SUPER_FOCUS_PYTHON_BIN,
              seed,
              payload,
            });
          } catch (error) {
            // The replacement never started (lock lost during the reach probe,
            // missing script, materialize failure) — put the archived image back
            // so a failed regenerate can never strand the slot empty.
            if (archived.archived) {
              try { superFocusMedia.restoreArchivedImage(id, idx, archived, { mediaRoot: sfMediaRoot }); } catch (_) { /* best-effort restore */ }
            }
            throw error;
          }
          superFocus.clearImageStale(id, [idx], { root: sfRoot });
          // Provenance for the attempt (seed + run id + provider/workflow).
          try {
            superFocusMedia.writeImageProviderProvenance(id, {
              provider_id: 'vidnux_comfyui', label: 'vidnux ComfyUI', workflow: 'flux-gguf-1080x1920',
              base_url: LOCAL_IMAGE_PROVIDER.url, reason: 'explicit regenerate', run_id: job && job.job_id,
              seed, indexes: [idx],
            }, { mediaRoot: sfMediaRoot });
          } catch (_) { /* best-effort provenance */ }
          // Duplicate handling runs when the run finishes (the only hashing): the
          // new file is compared to the previous (archived) one and, if identical,
          // rejected — the previous image is restored as active. Surfaced on
          // images-status as duplicate_rejected.
          if (archived.archived && FLUX_STATE.activeJob && FLUX_STATE.activeJob.process) {
            FLUX_STATE.activeJob.process.once('close', () => {
              try { superFocusMedia.resolveRegeneratedImage(id, idx, archived, { mediaRoot: sfMediaRoot }); } catch (_) {}
            });
          }
          sendJSON(res, 200, {
            job, index: idx, regenerated: true,
            seed_variation_supported: true,
            seed,
            superseded: archived.archived,
            superseded_path: archived.archived_path || null,
            duplicate_check: archived.archived ? 'on-completion' : 'none',
            media_dir: materialized.mediaDir,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-regenerate-image-error'));
      return;
    }

    // Start a supervised video batch on PRESTO (Wan2.2). Materializes
    // selected-images.json + video-prompts.json for the eligible rows (still on
    // disk + i2v prompt), then dispatches run-production.py. Optional indexes[]
    // restricts it to specific rows (per-image). Reuses the single PRESTO lock.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_GENERATE_VIDEOS_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus video generation API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          // Respect an operator pause: never start a PRESTO render while paused.
          const pausedQueue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          if (pausedQueue.paused) {
            sendJSON(res, 200, {
              started: false,
              paused: true,
              message: 'Video queue is paused — no PRESTO render was started. Resume the queue to render.',
              queue: { summary: videoQueueSummary(pausedQueue), items: pausedQueue.items, control: videoQueueControl(pausedQueue) },
            });
            return;
          }
          const subdir = PRESTO_PROFILE_OUTPUT_SUBDIRS[DEFAULT_PRESTO_PROFILE] || 'mp4';
          // Eligibility: still + i2v prompt, and NO existing video. Rows that
          // already have a video are skipped by default (Regenerate replaces one).
          const readyRows = superFocusMedia.eligibleVideoRows(id, state.image_prompts, { mediaRoot: sfMediaRoot });
          const missingRows = superFocusMedia.eligibleMissingVideoRows(id, state.image_prompts, subdir, { mediaRoot: sfMediaRoot });
          const totalRows = (state.image_prompts || []).filter((r) => r && r.text && r.text.trim()).length;
          const skippedPrereq = totalRows - readyRows.length;
          const skippedExistingVideo = readyRows.length - missingRows.length;
          // Optional per-image subset: keep only requested rows that still need one.
          let targetRows = missingRows;
          if (Array.isArray(payload.indexes) && payload.indexes.length) {
            const wanted = payload.indexes.map((n) => Math.round(Number(n)));
            targetRows = missingRows.filter((r) => wanted.includes(r.index));
            if (targetRows.length === 0) {
              const e = new Error('None of the requested rows need a video (missing a still/i2v prompt, or already rendered).'); e.statusCode = 400; throw e;
            }
          }
          if (targetRows.length === 0) {
            const e = new Error('No rows need a video. Each needs a still, an i2v prompt, and no existing video (use Regenerate to replace one).'); e.statusCode = 400; throw e;
          }
          // Image-review gate: unreviewed / rejected / stale-approved images
          // must not reach PRESTO. Every excluded row gets an explicit reason.
          const reviewGate = applyImageReviewGate(state, targetRows, sfMediaRoot);
          targetRows = reviewGate.allowed;
          if (targetRows.length === 0) {
            const e = new Error(`No rows are cleared for video generation: ${reviewGate.skipped.map((s) => `#${s.index} ${s.reason}`).join('; ')}`);
            e.statusCode = 409; throw e;
          }
          // Supervised compute gate (same lane policy as the queue pump and the
          // AIGEN submit): fail-closed, route-identity-bound readiness. A blocked
          // lane refuses the batch with 503 BEFORE any attempt is staged or spawned.
          const laneGate = await evaluateSuperFocusComputeLane(options);
          if (!laneGate.allow) throw superFocusLaneBlockedError(laneGate.verdict);
          // Pre-flight: PRESTO ComfyUI must be reachable. No cloud fallback, no auto-start.
          const reach = options.prestoReachableCheck || options.reachableCheck || prestoComfyuiReachable;
          const reachable = await reach(PRESTO_BASE_URL, options);
          if (!reachable) {
            const e = new Error(`PRESTO ComfyUI is not reachable at ${PRESTO_BASE_URL}. Start ComfyUI on PRESTO and retry (no fallback).`);
            e.statusCode = 503; throw e;
          }
          // Re-check the pause AFTER the awaited probe: an operator pause landing
          // during the (up to ~4s) reach window must still win — the contract is
          // that no new PRESTO render starts while paused.
          const recheckedQueue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          if (recheckedQueue.paused) {
            sendJSON(res, 200, {
              started: false,
              paused: true,
              message: 'Video queue was paused while checking PRESTO — no render was started. Resume the queue to render.',
              queue: { summary: videoQueueSummary(recheckedQueue), items: recheckedQueue.items, control: videoQueueControl(recheckedQueue) },
            });
            return;
          }
          // Refuse BEFORE materializing while a render is running — otherwise the
          // 409 from the job lock would land only after selected-images.json /
          // video-prompts.json (the running job's input files) were rewritten.
          const curPresto = currentPrestoJobStatus();
          if (curPresto.active) {
            const e = new Error('A PRESTO video job is already running. Wait for it to finish.');
            e.statusCode = 409; throw e;
          }
          // Render-time provenance: one attempt per row, staged source copies,
          // selected-images.json pointed at the staged bytes (see the attempts
          // note in super-focus-media.js). A row whose still vanished between
          // eligibility and staging is dropped honestly, never dispatched.
          const attemptsByIndex = {};
          const selectedPathByIndex = {};
          const stagingFailed = [];
          targetRows = targetRows.filter((row) => {
            try {
              const attempt = superFocusMedia.createVideoAttempt(id, row, {
                mediaRoot: sfMediaRoot, subdir, profile: DEFAULT_PRESTO_PROFILE,
              });
              attemptsByIndex[row.index] = attempt;
              selectedPathByIndex[row.index] = attempt.source.staged_rel;
              return true;
            } catch (error) {
              stagingFailed.push({ index: row.index, reason: `source unavailable at dispatch: ${error.message}` });
              return false;
            }
          });
          if (targetRows.length === 0) {
            const e = new Error(`No rows could be staged for dispatch: ${stagingFailed.map((s) => `#${s.index} ${s.reason}`).join('; ')}`);
            e.statusCode = 409; throw e;
          }
          const materialized = superFocusMedia.materializeVideoInputs(id, state.image_prompts, { mediaRoot: sfMediaRoot, rows: targetRows, selectedPathByIndex });
          let job;
          try {
            job = startSuperFocusVideoJob(materialized.mediaDir, {
              projectId: id,
              profile: DEFAULT_PRESTO_PROFILE,
              comfyuiUrl: PRESTO_BASE_URL,
              indexes: materialized.indexes,
              spawn: options.spawn,
              productionScript: options.productionScript,
              pythonBin: options.pythonBin,
              payload,
              computeReceipt: buildComputeDispatchReceipt({ lane: 'wan_i2v', gateResult: laneGate.gateResult, verdict: laneGate.verdict, profile: DEFAULT_PRESTO_PROFILE, comfyuiUrl: PRESTO_BASE_URL }),
            });
          } catch (error) {
            for (const a of Object.values(attemptsByIndex)) {
              try { superFocusMedia.markVideoAttempt(id, a.attempt_id, 'cancelled', 'launch_blocked', { mediaRoot: sfMediaRoot }); } catch (_) {}
            }
            throw error;
          }
          // Settle every attempt when the batch process closes: an attempt whose
          // output landed completes (ownership-checked); one with no output fails.
          if (PRESTO_STATE.activeJob && PRESTO_STATE.activeJob.process && PRESTO_STATE.activeJob.process.once) {
            PRESTO_STATE.activeJob.process.once('close', () => {
              for (const a of Object.values(attemptsByIndex)) {
                try {
                  const done = superFocusMedia.completeVideoAttempt(id, a.attempt_id, { mediaRoot: sfMediaRoot });
                  if (!done.completed) superFocusMedia.markVideoAttempt(id, a.attempt_id, 'failed', done.reason, { mediaRoot: sfMediaRoot });
                } catch (_) { /* best-effort provenance settle */ }
              }
            });
          }
          sendJSON(res, 200, {
            job,
            staging_failed: stagingFailed,
            materialized_count: materialized.count,
            will_generate: materialized.count,
            requested: materialized.indexes,
            eligible_missing: missingRows.length,
            skipped_existing_video: skippedExistingVideo,
            review_skipped: reviewGate.skipped,
            skipped_missing_prereq: skippedPrereq,
            media_dir: materialized.mediaDir,
            subdir,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, error.code || 'super-focus-generate-videos-error'));
      return;
    }

    // Manually clear (archive/supersede) a row's generated video so the row is
    // eligible for normal video generation again. Safe move, not delete.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_CLEAR_VIDEO_API) {
      readJsonBody(req, 1024 * 8)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus clear-video API' });
          const id = payload.id || payload.project_id || '';
          superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown project
          const idx = Math.round(Number(payload.index));
          if (!Number.isInteger(idx) || idx < 1) { const e = new Error('index must be a positive integer.'); e.statusCode = 400; throw e; }
          const subdir = PRESTO_PROFILE_OUTPUT_SUBDIRS[DEFAULT_PRESTO_PROFILE] || 'mp4';
          const result = superFocusMedia.archiveVideo(id, subdir, idx, { mediaRoot: sfMediaRoot });
          sendJSON(res, 200, { ok: true, index: idx, archived: result.archived, archived_path: result.archived_path || null, subdir });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-clear-video-error'));
      return;
    }

    // Explicit per-row video regeneration. Archives the existing clip (supersede,
    // never overwrite in place), then dispatches a fresh forced run for this one
    // row. Requires a still + i2v prompt. Reuses the single PRESTO lock.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_REGENERATE_VIDEO_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus regenerate-video API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          const idx = Math.round(Number(payload.index));
          const row = (state.image_prompts || []).find((r) => r.index === idx);
          const imgPath = superFocusMedia.safeImageFilePath(id, idx, { mediaRoot: sfMediaRoot });
          const hasImage = imgPath && fs.existsSync(imgPath);
          if (!row || !hasImage || !superFocus.hasI2vPrompt(row)) {
            const e = new Error('Regenerate needs a row with a generated still and a saved i2v prompt.'); e.statusCode = 400; throw e;
          }
          // Respect an operator pause: regenerate also starts a PRESTO render,
          // and the pause contract is that no new render starts while paused.
          const pausedQueue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          if (pausedQueue.paused) {
            const e = new Error('Video queue is paused — no PRESTO render was started. Resume the queue, then regenerate.'); e.statusCode = 409; throw e;
          }
          const cur = currentPrestoJobStatus();
          if (cur.active) { const e = new Error('A PRESTO video job is already running. Wait for it to finish.'); e.statusCode = 409; throw e; }
          // Supervised compute gate: fail-closed lane readiness before a render.
          const laneGate = await evaluateSuperFocusComputeLane(options);
          if (!laneGate.allow) throw superFocusLaneBlockedError(laneGate.verdict);
          const reach = options.prestoReachableCheck || options.reachableCheck || prestoComfyuiReachable;
          if (!(await reach(PRESTO_BASE_URL, options))) {
            const e = new Error(`PRESTO ComfyUI is not reachable at ${PRESTO_BASE_URL}. Start ComfyUI on PRESTO and retry (no fallback).`); e.statusCode = 503; throw e;
          }
          // Re-check pause and the PRESTO lock AFTER the awaited probe (same
          // contract as batch generation): an operator pause or a poll-driven
          // queue dispatch landing inside the reach window must win. Without
          // this recheck, regenerate would rewrite selected-images.json
          // underneath a render that just started — corrupting its launch
          // inputs before the child process reads them — or start a render
          // while the queue is paused.
          const recheckedQueue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          if (recheckedQueue.paused) {
            const e = new Error('Video queue was paused while checking PRESTO — no render was started. Resume the queue, then regenerate.'); e.statusCode = 409; throw e;
          }
          if (currentPrestoJobStatus().active) {
            const e = new Error('A PRESTO video job started while checking PRESTO. Wait for it to finish, then regenerate.'); e.statusCode = 409; throw e;
          }
          const subdir = PRESTO_PROFILE_OUTPUT_SUBDIRS[DEFAULT_PRESTO_PROFILE] || 'mp4';
          {
            const gate = superFocusImageReview.imageReviewGate(row, buildImageReviewContext(state, row, sfMediaRoot));
            if (!gate.eligible) { const e = new Error(`This image is not cleared for video generation: ${gate.reason}.`); e.statusCode = 409; throw e; }
          }
          const archived = superFocusMedia.archiveVideo(id, subdir, idx, { mediaRoot: sfMediaRoot });
          let materialized;
          let job;
          let attempt = null;
          try {
            // Render-time provenance: stage + record the attempt first, then
            // materialize pointing at the staged copy (uploaded bytes = recorded
            // bytes). See the attempts note in super-focus-media.js.
            attempt = superFocusMedia.createVideoAttempt(id, row, {
              mediaRoot: sfMediaRoot, subdir, profile: DEFAULT_PRESTO_PROFILE,
            });
            materialized = superFocusMedia.materializeVideoInputs(id, state.image_prompts, {
              mediaRoot: sfMediaRoot, rows: [row],
              selectedPathByIndex: { [idx]: attempt.source.staged_rel },
            });
            job = startSuperFocusVideoJob(materialized.mediaDir, {
              projectId: id,
              profile: DEFAULT_PRESTO_PROFILE,
              comfyuiUrl: PRESTO_BASE_URL,
              indexes: [idx],
              spawn: options.spawn,
              productionScript: options.productionScript,
              pythonBin: options.pythonBin,
              computeReceipt: buildComputeDispatchReceipt({ lane: 'wan_i2v', gateResult: laneGate.gateResult, verdict: laneGate.verdict, profile: DEFAULT_PRESTO_PROFILE, comfyuiUrl: PRESTO_BASE_URL }),
              payload,
            });
          } catch (error) {
            // The replacement never started (PRESTO lock lost during the reach
            // probe — e.g. a status-poll pump started a queued render — or a
            // dispatch/staging failure). Restore the archived clip so a failed
            // regenerate can never strand the slot empty.
            if (attempt) {
              try { superFocusMedia.markVideoAttempt(id, attempt.attempt_id, 'cancelled', 'launch_blocked', { mediaRoot: sfMediaRoot }); } catch (_) {}
            }
            if (archived.archived) {
              try { superFocusMedia.restoreArchivedVideo(id, subdir, idx, archived, { mediaRoot: sfMediaRoot }); } catch (_) { /* best-effort restore */ }
            }
            throw error;
          }
          // On completion: duplicate handling first (only hashing — compare the
          // new clip to the previous archived one; reject + restore previous if
          // identical), then settle the attempt. generated:false means the render
          // produced NO new file and the previous clip was restored — the attempt
          // must FAIL, never claim the restored old bytes as its output.
          if (PRESTO_STATE.activeJob && PRESTO_STATE.activeJob.process) {
            PRESTO_STATE.activeJob.process.once('close', () => {
              let outcome = null;
              if (archived.archived) {
                try { outcome = superFocusMedia.resolveRegeneratedVideo(id, subdir, idx, archived, { mediaRoot: sfMediaRoot }); } catch (_) {}
              }
              try {
                if (outcome && outcome.generated === false) {
                  superFocusMedia.markVideoAttempt(id, attempt.attempt_id, 'failed', 'render_produced_no_output', { mediaRoot: sfMediaRoot });
                } else {
                  const done = superFocusMedia.completeVideoAttempt(id, attempt.attempt_id, { mediaRoot: sfMediaRoot });
                  if (!done.completed) superFocusMedia.markVideoAttempt(id, attempt.attempt_id, 'failed', done.reason, { mediaRoot: sfMediaRoot });
                }
              } catch (_) { /* best-effort provenance settle */ }
            });
          }
          sendJSON(res, 200, {
            job, index: idx, regenerated: true,
            superseded: archived.archived,
            superseded_path: archived.archived_path || null,
            duplicate_check: archived.archived ? 'on-completion' : 'none',
            subdir, media_dir: materialized.mediaDir,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, error.code || 'super-focus-regenerate-video-error'));
      return;
    }

    // Read-only: reconcile per-index video state from disk + PRESTO job status.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_VIDEOS_STATUS_API) {
      const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
      const ctx = { sfRoot, sfMediaRoot, options };
      // Drive the queue worker on each poll (idempotent; only starts if the
      // single PRESTO worker is free). Then report reconciled disk + queue state.
      Promise.resolve()
        .then(() => pumpSuperFocusVideoQueue(id, ctx).catch(() => null))
        .then((pumpResult) => {
          const state = superFocus.loadProject(id, { root: sfRoot });
          const subdir = superFocusVideoSubdir();
          const recon = superFocusMedia.reconcileVideos(id, state.image_prompts, subdir, { mediaRoot: sfMediaRoot });
          const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          const presto = currentPrestoJobStatus();
          const active = presto.active || null;
          // Queue items annotated (copies) with enqueue-time text drift; the
          // persisted queue itself is untouched by reconciliation.
          const displayItems = (recon.queue && recon.queue.items) || queue.items;
          sendJSON(res, 200, {
            project_id: id,
            presto_job: active || presto.completed || null,
            job_is_this_project: Boolean(active && active.package_id === id),
            busy_elsewhere: Boolean(active && active.package_id !== id),
            subdir,
            total: recon.total,
            done: recon.done,
            failed: recon.failed,
            stale: recon.stale,
            videos: recon.videos,
            paused: Boolean(queue.paused),
            // Why the queue is not advancing right now (read-only; not persisted).
            // 'compute_lane_blocked' carries the gate reason/checks so the operator
            // sees the exact readiness blocker (e.g. Resolve running) — the same
            // truth as the "Wan I2V lane gate" advisory row, tied to the queue.
            dispatch_hold: pumpResult && pumpResult.blocked ? { reason: pumpResult.blocked, gate: pumpResult.gate || null } : null,
            queue: { summary: videoQueueSummary(queue), items: displayItems, control: videoQueueControl(queue) },
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-videos-status-error'));
      return;
    }

    // Cancel the active PRESTO job (nonce-gated). Project-scoped: do not stop
    // another project's render just because the lock is global.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_VIDEOS_CANCEL_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus video cancel API' });
          const id = payload && payload.id;
          const active = currentPrestoJobStatus().active;
          if (active && active.package_id !== id) {
            sendJSON(res, 409, { error: 'busy_elsewhere', message: 'The active video render belongs to another project and was not stopped.' });
            return;
          }
          const result = await cancelPrestoJob(options);
          sendJSON(res, 200, result);
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-videos-cancel-error'));
      return;
    }

    // Enqueue ONE row's video onto the PRESTO queue. Returns queued even while
    // another render is running (no 409). Slot-safe: skips existing/ineligible.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_QUEUE_VIDEO_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus queue-video API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown project
          const ctx = { sfRoot, sfMediaRoot, options };
          {
            // Review-gate only rows that HAVE an image: a missing still stays
            // the queue's own 'skipped_prereq' concern (review judges images).
            const idx = Math.round(Number(payload.index));
            const row = (state.image_prompts || []).find((r) => r.index === idx);
            if (row) {
              const gateContext = buildImageReviewContext(state, row, sfMediaRoot);
              if (gateContext.image_exists) {
                const gate = superFocusImageReview.imageReviewGate(row, gateContext);
                if (!gate.eligible) {
                  sendJSON(res, 200, { enqueued: false, item: null, skipped: [{ index: idx, reason: gate.reason }], queue: null });
                  return;
                }
              }
            }
          }
          const result = enqueueSuperFocusVideos(id, [payload.index], ctx);
          await pumpSuperFocusVideoQueue(id, ctx).catch(() => null);
          const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          sendJSON(res, 200, {
            enqueued: result.queued.length > 0,
            item: result.queued[0] || null,
            skipped: result.skipped,
            queue: { summary: videoQueueSummary(queue), items: queue.items },
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-queue-video-error'));
      return;
    }

    // Enqueue all eligible missing-video rows (optional indexes[] subset).
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_QUEUE_MISSING_VIDEOS_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus queue-missing-videos API' });
          const id = payload.id || payload.project_id || '';
          const state = superFocus.loadProject(id, { root: sfRoot });
          const ctx = { sfRoot, sfMediaRoot, options };
          const subdir = superFocusVideoSubdir();
          const missingRows = superFocusMedia.eligibleMissingVideoRows(id, state.image_prompts, subdir, { mediaRoot: sfMediaRoot });
          const reviewGate = applyImageReviewGate(state, missingRows, sfMediaRoot);
          let indexes = reviewGate.allowed.map((r) => r.index);
          if (Array.isArray(payload.indexes) && payload.indexes.length) {
            const wanted = payload.indexes.map((n) => Math.round(Number(n)));
            indexes = indexes.filter((i) => wanted.includes(i));
          }
          const result = enqueueSuperFocusVideos(id, indexes, ctx);
          result.skipped = (result.skipped || []).concat(reviewGate.skipped);
          await pumpSuperFocusVideoQueue(id, ctx).catch(() => null);
          const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          sendJSON(res, 200, {
            enqueued_count: result.queued.length,
            skipped: result.skipped,
            queue: { summary: videoQueueSummary(queue), items: queue.items },
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-queue-missing-videos-error'));
      return;
    }

    // Read-only: reconcile + drive the queue, return its state.
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_VIDEO_QUEUE_API) {
      const id = url.searchParams.get('id') || url.searchParams.get('project_id') || '';
      const ctx = { sfRoot, sfMediaRoot, options };
      Promise.resolve()
        .then(() => superFocus.loadProject(id, { root: sfRoot })) // 404 for an unknown/typo'd project id (don't fake an empty queue)
        .then(() => pumpSuperFocusVideoQueue(id, ctx).catch(() => null))
        .then(() => {
          const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          const active = currentPrestoJobStatus().active;
          sendJSON(res, 200, {
            project_id: id,
            subdir: superFocusVideoSubdir(),
            paused: Boolean(queue.paused),
            control: videoQueueControl(queue),
            summary: videoQueueSummary(queue),
            items: queue.items,
            presto_active: Boolean(active),
            presto_active_is_this: Boolean(active && active.package_id === id),
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-video-queue-error'));
      return;
    }

    // Pause the queue: no NEW PRESTO render starts; running one is left alone;
    // queued items are preserved. Persists to disk (survives cockpit restart).
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_VIDEO_QUEUE_PAUSE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus video-queue pause API' });
          const id = payload.id || payload.project_id || '';
          superFocus.loadProject(id, { root: sfRoot }); // 404 for unknown project
          const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          queue.paused = true;
          queue.paused_at = new Date().toISOString();
          queue.paused_by = 'operator';
          queue.pause_reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim().slice(0, 200) : 'operator_pause';
          queue.resumed_at = null;
          superFocusMedia.writeVideoQueue(id, queue, { mediaRoot: sfMediaRoot });
          const active = currentPrestoJobStatus().active;
          sendJSON(res, 200, {
            paused: true,
            message: 'Queue paused — no new PRESTO videos will start.',
            active_render: Boolean(active && active.package_id === id),
            control: videoQueueControl(queue),
            summary: videoQueueSummary(queue),
            items: queue.items,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-video-queue-pause-error'));
      return;
    }

    // Resume the queue: clear paused, then let the normal runner start the next
    // eligible item IF the PRESTO lock is free and PRESTO is reachable. Never
    // auto-starts PRESTO/ComfyUI; never bypasses eligibility/slot-safety.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_VIDEO_QUEUE_RESUME_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus video-queue resume API' });
          const id = payload.id || payload.project_id || '';
          superFocus.loadProject(id, { root: sfRoot });
          const ctx = { sfRoot, sfMediaRoot, options };
          const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          queue.paused = false;
          queue.resumed_at = new Date().toISOString();
          queue.stop_requested_at = null;
          superFocusMedia.writeVideoQueue(id, queue, { mediaRoot: sfMediaRoot });
          const pump = await pumpSuperFocusVideoQueue(id, ctx).catch(() => null);
          const after = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          sendJSON(res, 200, {
            paused: false,
            message: 'Queue resumed.',
            started: Boolean(pump && pump.started),
            blocked: pump && pump.blocked ? pump.blocked : null,
            control: videoQueueControl(after),
            summary: videoQueueSummary(after),
            items: after.items,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-video-queue-resume-error'));
      return;
    }

    // Stop the current render: pause the queue first, then best-effort stop the
    // LOCAL render process. HONEST LIMIT: killing the local process cannot
    // guarantee the remote PRESTO ComfyUI GPU job stops — that is reported via
    // remote_may_continue. The active item is marked stopped_by_operator (never
    // done) and stays eligible for explicit requeue.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_VIDEO_QUEUE_STOP_CURRENT_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus video-queue stop-current API' });
          const id = payload.id || payload.project_id || '';
          superFocus.loadProject(id, { root: sfRoot });
          const ctx = { sfRoot, sfMediaRoot, options };
          // 1) Pause first, so nothing new starts regardless of the stop outcome.
          const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          queue.paused = true;
          queue.paused_at = new Date().toISOString();
          queue.paused_by = 'operator';
          queue.pause_reason = 'stop_current_render';
          queue.stop_requested_at = new Date().toISOString();
          // Flag the running item (for this project) so reconcile classifies it
          // as stopped_by_operator, not a generic failure.
          const runningItem = queue.items.find((it) => it.status === 'running');
          if (runningItem) runningItem.stop_requested_at = queue.stop_requested_at;
          superFocusMedia.writeVideoQueue(id, queue, { mediaRoot: sfMediaRoot });

          const active = currentPrestoJobStatus().active;
          const activeIsThis = Boolean(active && active.package_id === id);
          let result;
          if (!active) {
            result = { status: 'no_active_job', stopped: false, message: 'Queue paused. No render is currently active.' };
          } else if (!activeIsThis) {
            result = { status: 'busy_elsewhere', stopped: false, message: 'Queue paused. The active PRESTO render belongs to another project and was not stopped.' };
          } else {
            // Best-effort local stop of run-production.py (SIGTERM then SIGKILL).
            const stop = await cancelPrestoJob(options).catch((e) => ({ ok: false, error: e.message }));
            // Reconcile so the running item flips to stopped_by_operator now.
            await pumpSuperFocusVideoQueue(id, ctx).catch(() => null);
            result = stop && stop.ok
              ? { status: 'stopped', stopped: true, remote_may_continue: true,
                  message: 'Local render process stopped and queue paused. If PRESTO ComfyUI had already started the GPU render, it may keep running on PRESTO until it finishes or you stop it there.' }
              : { status: 'stop_failed', stopped: false, message: 'Could not stop the local render process: ' + ((stop && stop.error) || 'unknown error') + '. Queue is paused so nothing new will start.' };
          }
          const after = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          sendJSON(res, 200, Object.assign({ paused: true, control: videoQueueControl(after), summary: videoQueueSummary(after), items: after.items }, result));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-video-queue-stop-current-error'));
      return;
    }

    // Cancel a QUEUED (not-yet-running) item. A running render is not cancelled.
    if (req.method === 'POST' && url.pathname === SUPER_FOCUS_CANCEL_QUEUED_VIDEO_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Super Focus cancel-queued-video API' });
          const id = payload.id || payload.project_id || '';
          superFocus.loadProject(id, { root: sfRoot });
          const idx = payload.index != null ? Math.round(Number(payload.index)) : null;
          const itemId = payload.item_id || null;
          const queue = superFocusMedia.readVideoQueue(id, { mediaRoot: sfMediaRoot });
          const item = queue.items.find((it) => (itemId ? it.item_id === itemId : it.index === idx) && (it.status === 'queued' || it.status === 'running'));
          if (!item) { sendJSON(res, 200, { cancelled: false, reason: 'not_found_or_not_live' }); return; }
          if (item.status === 'running') {
            sendJSON(res, 200, { cancelled: false, running: true, message: 'Running job cannot be cancelled safely yet.' });
            return;
          }
          item.status = 'cancelled'; item.finished_at = new Date().toISOString();
          superFocusMedia.writeVideoQueue(id, queue, { mediaRoot: sfMediaRoot });
          sendJSON(res, 200, { cancelled: true, index: item.index, item_id: item.item_id, queue: { summary: videoQueueSummary(queue), items: queue.items } });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'super-focus-cancel-queued-video-error'));
      return;
    }

    // Serve one staged MP4 from the project's media dir (path-guarded).
    if (req.method === 'GET' && url.pathname === SUPER_FOCUS_VIDEO_FILE_API) {
      try {
        const id = url.searchParams.get('id') || '';
        superFocus.assertValidProjectId(id);
        const subdir = PRESTO_PROFILE_OUTPUT_SUBDIRS[DEFAULT_PRESTO_PROFILE] || 'mp4';
        // Same guarded resolution as before: validated project id + slot index,
        // path confined to the media root (traversal defense unchanged).
        const filePath = superFocusMedia.safeVideoFilePath(id, subdir, url.searchParams.get('index'), { mediaRoot: sfMediaRoot });
        if (!filePath || !fs.existsSync(filePath)) { sendError(res, 404, 'Video not found.', 'super-focus-video-missing'); return; }
        const total = fs.statSync(filePath).size;
        // Byte-range support so the viewer's <video> can seek to unbuffered
        // positions (a plain 200 without Accept-Ranges is not seekable until
        // fully buffered — proven in a controlled headless-Chrome A/B).
        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
          let start; let end;
          if (m && !(m[1] === '' && m[2] === '')) {
            if (m[1] === '') { // suffix: final N bytes
              const n = parseInt(m[2], 10);
              start = Number.isFinite(n) && n > 0 ? Math.max(0, total - n) : NaN;
              end = total - 1;
            } else {
              start = parseInt(m[1], 10);
              end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
            }
          } else { start = NaN; end = NaN; }
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
            res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
            res.end();
            return;
          }
          if (end >= total) end = total - 1;
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': end - start + 1,
            'Cache-Control': 'no-store',
          });
          // Guarded like the image route: the MP4 can be archived mid-request.
          const rangeStream = fs.createReadStream(filePath, { start, end });
          rangeStream.on('error', (err) => { console.error('Super Focus video stream error:', err.message); res.destroy(); });
          rangeStream.pipe(res);
          return;
        }
        // No Range header: full file, but advertise range support so the browser
        // knows it may seek (issues subsequent Range requests).
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': total, 'Cache-Control': 'no-store' });
        const fullStream = fs.createReadStream(filePath);
        fullStream.on('error', (err) => { console.error('Super Focus video stream error:', err.message); res.destroy(); });
        fullStream.pipe(res);
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'super-focus-video-error');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === PROJECT_STATE_API) {
      try {
        const resolved = resolveAigenPackageDir(url.searchParams.get('package') || url.searchParams.get('package_id') || url.searchParams.get('id') || '', { root: serverOptions.root || ROOT });
        const state = resolveProjectState(resolved.packageDir);
        const nextTask = chooseNextTask(state);
        const media = buildPackageMediaIndex(resolved.packageDir);
        sendJSON(res, 200, { state, next_task: nextTask, media });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'project-state-error');
      }
      return;
    }

    // Import manual external media (GPT images / KlingAI videos) via the GUI.
    // Nonce-gated; wraps the import core; supports dry-run. No external calls.
    if (req.method === 'POST' && url.pathname === PROJECT_IMPORT_MEDIA_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const resolved = resolveAigenPackageDir(payload.package_id || payload.package || '', { root: serverOptions.root || ROOT });
          const kind = String(payload.kind || '').trim();
          if (kind !== 'image' && kind !== 'video') {
            const e = new Error('kind must be "image" or "video".');
            e.statusCode = 400;
            throw e;
          }
          const result = importManualMedia({
            package: resolved.packageDir,
            kind,
            dryRun: Boolean(payload.dry_run || payload.dryRun),
            ffprobe: kind === 'video' ? ffprobeMetadata : undefined,
          });
          sendJSON(res, 200, result);
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-import-media-error'));
      return;
    }

    // Set a project's status (park/unpark/mark editing/published/archived) by
    // writing project-status.json into the resolved package dir. Nonce-gated.
    if (req.method === 'POST' && url.pathname === PROJECT_STATUS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const resolved = resolveAigenPackageDir(payload.package_id || payload.package || '', { root: serverOptions.root || ROOT });
          const status = String(payload.status || '').trim().toLowerCase();
          if (!PROJECT_ALLOWED_STATUSES.includes(status)) {
            const e = new Error(`status must be one of: ${PROJECT_ALLOWED_STATUSES.join(', ')}`);
            e.statusCode = 400;
            throw e;
          }
          const outPath = path.join(resolved.packageDir, 'project-status.json');
          const tmp = `${outPath}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, `${JSON.stringify({ status, updated_at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
          fs.renameSync(tmp, outPath);
          sendJSON(res, 200, { ok: true, package_id: resolved.packageId, status });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-status-error'));
      return;
    }

    // Project-scoped script workspace: load topic context + draft/final + scaffold.
    if (req.method === 'GET' && url.pathname === PROJECT_SCRIPT_API) {
      try {
        const resolved = resolveAigenPackageDir(url.searchParams.get('id') || url.searchParams.get('package') || url.searchParams.get('package_id') || '', { root: serverOptions.root || ROOT });
        const state = resolveProjectState(resolved.packageDir);
        const prov = state.provenance || {};
        const script = projectScript.readScript(resolved.packageDir);
        const angle = (prov.score_explanation && prov.score_explanation.summary) || prov.premise || '';
        const scaffold = projectScript.buildScaffold({ title: state.title, premise: prov.premise || '', angle });
        sendJSON(res, 200, {
          ok: true,
          project_id: state.project_id,
          title: state.title,
          status: state.status,
          stage: state.stage,
          source: { source: prov.source || 'package', seed_topic: prov.seed_topic || '' },
          score: (prov.score !== undefined ? prov.score : null),
          score_explanation: prov.score_explanation || null,
          premise: prov.premise || '',
          draft: script.draft,
          final: script.final,
          notes: script.notes,
          suggested_scaffold: scaffold,
        });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'project-script-error');
      }
      return;
    }

    // Save a script draft (non-final). Nonce-gated.
    if (req.method === 'POST' && url.pathname === PROJECT_SCRIPT_SAVE_DRAFT_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const resolved = resolveAigenPackageDir(payload.id || payload.package_id || payload.package || '', { root: serverOptions.root || ROOT });
          sendJSON(res, 200, Object.assign({ project_id: resolved.packageId }, projectScript.saveDraft(resolved.packageDir, payload.text, payload.notes)));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-script-save-draft-error'));
      return;
    }

    // Approve the final script (writes the canonical path the resolver reads,
    // advancing the project past the script stage). Nonce-gated; 409 unless
    // confirm_replace when a final already exists.
    if (req.method === 'POST' && url.pathname === PROJECT_SCRIPT_APPROVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const resolved = resolveAigenPackageDir(payload.id || payload.package_id || payload.package || '', { root: serverOptions.root || ROOT });
          const approved = projectScript.approveFinal(resolved.packageDir, payload.text, Boolean(payload.confirm_replace));
          const state = resolveProjectState(resolved.packageDir);
          const next = chooseNextTask(state);
          sendJSON(res, 200, Object.assign({ project_id: resolved.packageId }, approved, {
            stage: state.stage, next_task: { id: next.id, label: next.label },
          }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-script-approve-error'));
      return;
    }

    // Generate the project's image prompts from its approved script via local
    // Ollama on vidnux (no cloud fallback). Writes the canonical image-prompts.json
    // (reusing saveImagePrompts validation) + a provenance sidecar. Generates TEXT
    // prompts only — never images.
    if (req.method === 'POST' && url.pathname === PROJECT_IMAGE_PROMPTS_GENERATE_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload);
          const opt = { root: serverOptions.root || ROOT };
          const resolved = resolveAigenPackageDir(payload.id || payload.package_id || payload.package || '', opt);
          // Require an approved final script.
          const scriptState = projectScript.readScript(resolved.packageDir);
          if (!scriptState.final.exists) {
            const e = new Error('No approved final script. Approve the script first.'); e.statusCode = 400; throw e;
          }
          // Don't clobber existing prompts unless confirmed.
          const existing = readImagePrompts(resolved.packageId, opt);
          if (existing.count > 0 && !payload.confirm_replace) {
            const e = new Error(`${existing.count} image prompt(s) already exist. Re-submit with confirm_replace to regenerate.`);
            e.statusCode = 409; throw e;
          }
          let count = Number(payload.count);
          if (!Number.isFinite(count) || count < 1) count = projectImagePrompts.DEFAULT_COUNT;
          count = Math.min(40, Math.round(count));
          // Over-generate candidates so the dedup/screen/face selection has
          // headroom (the model tends to loop / repeat templates). parseImagePrompts
          // still selects exactly `count` distinct presenter-safe prompts.
          const requestCount = Math.min(40, count + 15);

          const state = resolveProjectState(resolved.packageDir);
          const prov = state.provenance || {};
          const finalText = (projectScript.readScript(resolved.packageDir).final.text) || '';
          const reqPrompt = projectImagePrompts.buildImagePromptRequest({
            title: state.title, premise: prov.premise || '',
            scoreSummary: (prov.score_explanation && prov.score_explanation.summary) || '',
            script: finalText, count: requestCount,
          });
          // local-first: vidnux Ollama (default base); unavailable -> 503 from callOllamaChat.
          const content = await callOllamaChat({ system: reqPrompt.system, user: reqPrompt.user, schema: reqPrompt.schema, model: OLLAMA_MODEL, baseUrl: OLLAMA_BASE_URL }, options);
          const nowIso = new Date().toISOString();
          const records = projectImagePrompts.parseImagePrompts(content, count, { projectId: resolved.packageId, model: OLLAMA_MODEL, nowIso, scriptPath: scriptState.final.path });

          const saved = saveImagePrompts({ package_id: resolved.packageId, model: { image_prompts: records } }, opt);
          const manifestPath = path.join(resolved.packageDir, 'image-prompts-generation-manifest.json');
          ideaPromotion.writeJsonAtomic(manifestPath, projectImagePrompts.buildManifest(records, { projectId: resolved.packageId, model: OLLAMA_MODEL, nowIso, scriptPath: scriptState.final.path }));

          sendJSON(res, 200, {
            ok: true,
            project_id: resolved.packageId,
            prompt_count: saved.count,
            prompts_path: 'image-prompts.json',
            manifest_path: 'image-prompts-generation-manifest.json',
            provider: 'ollama',
            provider_host: 'vidnux',
            model: OLLAMA_MODEL,
            generated_at: nowIso,
            replaced_existing: existing.count > 0,
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-image-prompts-generate-error'));
      return;
    }

    // Project-scoped I2V prompt workspace: read context + selected images + any
    // existing prompts (read-only, no network).
    if (req.method === 'GET' && url.pathname === PROJECT_I2V_PROMPTS_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('package_id') || url.searchParams.get('package') || '';
        sendJSON(res, 200, readProjectI2vContext(id, { root: serverOptions.root || ROOT }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'project-i2v-prompts-read-error');
      }
      return;
    }

    // Generate one I2V motion prompt per selected image via local Ollama on PRESTO
    // (no fallback). Writes canonical video-prompts.json. Never generates videos.
    if (req.method === 'POST' && url.pathname === PROJECT_I2V_PROMPTS_GENERATE_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload);
          // Merge createServer options (e.g. fetchImpl for tests) with the root.
          const result = await generateProjectI2vPrompts(payload, Object.assign({}, options, { root: serverOptions.root || ROOT }));
          sendJSON(res, 200, result);
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-i2v-prompts-generate-error'));
      return;
    }

    // Save operator-edited I2V prompts to video-prompts.json.
    if (req.method === 'POST' && url.pathname === PROJECT_I2V_PROMPTS_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveProjectI2vPrompts(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-i2v-prompts-save-error'));
      return;
    }

    // Project-scoped video review: clips + source images + I2V prompts +
    // ffprobe validation + saved decisions (read-only; never mutates videos).
    if (req.method === 'GET' && url.pathname === PROJECT_VIDEO_REVIEW_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('package_id') || url.searchParams.get('package') || '';
        sendJSON(res, 200, readProjectVideoReview(id, {
          root: serverOptions.root || ROOT,
          videoVariant: url.searchParams.get('variant') || undefined,
        }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'project-video-review-read-error');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === PROJECT_VIDEO_VARIANTS_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('package_id') || url.searchParams.get('package') || '';
        sendJSON(res, 200, readProjectVideoVariants(id, { root: serverOptions.root || ROOT }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'project-video-variants-read-error');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === PROJECT_MEDIA_KIT_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('package_id') || url.searchParams.get('package') || '';
        sendJSON(res, 200, readProjectMediaKit(id, { root: serverOptions.root || ROOT }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'project-media-kit-read-error');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === PROJECT_YOUTUBE_DRAFT_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('package_id') || url.searchParams.get('package') || '';
        sendJSON(res, 200, readProjectYoutubeDraft(id, { root: serverOptions.root || ROOT }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'project-youtube-draft-read-error');
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === PROJECT_YOUTUBE_DRAFT_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'YouTube draft save API' });
          return saveProjectYoutubeDraft(payload, { root: serverOptions.root || ROOT });
        })
        .then((result) => sendJSON(res, 200, result))
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-youtube-draft-save-error'));
      return;
    }

    // ── Earth Studio map-animation lane (project-scoped, revived 2026-07-02) ──
    if (req.method === 'GET' && url.pathname === EARTH_STUDIO_STATUS_API) {
      try {
        const id = url.searchParams.get('id') || url.searchParams.get('package_id') || url.searchParams.get('package') || '';
        const { packageId, packageDir } = resolveAigenPackageDir(id, { root: serverOptions.root || ROOT });
        sendJSON(res, 200, earthStudioLane.status(packageDir, packageId));
      } catch (error) { sendError(res, error.statusCode || 500, error.message, 'earth-studio-status-error'); }
      return;
    }

    if (req.method === 'GET' && url.pathname === EARTH_STUDIO_JOB_STATUS_API) {
      try { sendJSON(res, 200, { job: earthStudioLane.currentJobStatus() }); }
      catch (error) { sendError(res, error.statusCode || 500, error.message, 'earth-studio-job-status-error'); }
      return;
    }

    if (req.method === 'POST' && url.pathname === EARTH_STUDIO_PLAN_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Earth Studio plan API' });
          const { packageId, packageDir } = resolveAigenPackageDir(payload.id || payload.package_id || '', { root: serverOptions.root || ROOT });
          sendJSON(res, 200, { project_id: packageId, ...earthStudioLane.writeJob(packageDir, payload) });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'earth-studio-plan-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === EARTH_STUDIO_RENDER_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Earth Studio render API' });
          const { packageId, packageDir } = resolveAigenPackageDir(payload.id || payload.package_id || '', { root: serverOptions.root || ROOT });
          sendJSON(res, 200, earthStudioLane.startRender(packageDir, packageId, serverOptions.earthStudio || {}));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'earth-studio-render-error', { active: error.active || null }));
      return;
    }

    if (req.method === 'POST' && url.pathname === EARTH_STUDIO_CANCEL_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Earth Studio cancel API' });
          sendJSON(res, 200, earthStudioLane.cancelRender());
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'earth-studio-cancel-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === EARTH_STUDIO_STAGE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Earth Studio stage API' });
          const { packageId, packageDir } = resolveAigenPackageDir(payload.id || payload.package_id || '', { root: serverOptions.root || ROOT });
          sendJSON(res, 200, earthStudioLane.stageToVidnas(packageDir, packageId, serverOptions.earthStudio || {}));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'earth-studio-stage-error'));
      return;
    }

    // ── Score Engine (Scorecraft) — original music cues per video (2026-07-02) ──
    // Settings/music-root are injectable via env for tests and via serverOptions.
    const scoreOptions = () => ({
      settingsPath: process.env.SCORE_ENGINE_SETTINGS_PATH || undefined,
      musicRoot: process.env.SCORE_ENGINE_MUSIC_ROOT || undefined,
      ...(serverOptions.scoreEngine || {}),
    });

    if (req.method === 'GET' && url.pathname === SCORE_SETTINGS_API) {
      try {
        const detected = ['/usr/local/bin/reaper', '/opt/REAPER/reaper', '/usr/bin/reaper'].find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
        sendJSON(res, 200, { settings: scoreLane.loadSettings(scoreOptions()), settings_path: process.env.SCORE_ENGINE_SETTINGS_PATH || scoreLane.DEFAULT_SETTINGS_PATH, detected_reaper: detected });
      }
      catch (error) { sendError(res, error.statusCode || 500, error.message, 'score-settings-error'); }
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_SETTINGS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score settings API' });
          sendJSON(res, 200, { settings: scoreLane.saveSettings(payload.settings || payload, scoreOptions()) });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-settings-save-error'));
      return;
    }
    if (req.method === 'GET' && url.pathname === SCORE_PROJECTS_API) {
      try { sendJSON(res, 200, { projects: scoreLane.listProjects(scoreOptions()) }); }
      catch (error) { sendError(res, error.statusCode || 500, error.message, 'score-projects-error'); }
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_PROJECTS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score project create API' });
          sendJSON(res, 200, scoreLane.createScoreProject(payload, scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-project-create-error'));
      return;
    }
    if (req.method === 'GET' && url.pathname === SCORE_PROJECT_API) {
      try { sendJSON(res, 200, scoreLane.getProject(url.searchParams.get('id') || '', scoreOptions())); }
      catch (error) { sendError(res, error.statusCode || 500, error.message, 'score-project-error'); }
      return;
    }
    if (req.method === 'GET' && url.pathname === SCORE_PROFILES_API) {
      try { sendJSON(res, 200, { profiles: scoreLane.loadProfiles(scoreLane.loadSettings(scoreOptions())) }); }
      catch (error) { sendError(res, error.statusCode || 500, error.message, 'score-profiles-error'); }
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_PROFILES_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score profile save API' });
          sendJSON(res, 200, { profile: scoreLane.saveProfile(scoreLane.loadSettings(scoreOptions()), payload.profile || payload) });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-profile-save-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_PROFILE_DELETE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score profile delete API' });
          sendJSON(res, 200, scoreLane.deleteProfile(scoreLane.loadSettings(scoreOptions()), payload.profile_id || ''));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-profile-delete-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_CUES_GENERATE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score cue generate API' });
          sendJSON(res, 200, scoreLane.generateCuesForProject(payload.project_id || '', payload, scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-cues-generate-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_CUES_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score cue save API' });
          sendJSON(res, 200, scoreLane.saveCueSheetEdits(payload.project_id || '', payload.cues || [], scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-cues-save-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_CUES_APPROVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score cue approve API' });
          sendJSON(res, 200, scoreLane.approveCueSheet(payload.project_id || '', scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-cues-approve-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_PALETTE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score palette API' });
          sendJSON(res, 200, scoreLane.setPalette(payload.project_id || '', payload.palette_id || '', scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-palette-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_CANDIDATES_GENERATE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score candidate generate API' });
          sendJSON(res, 200, scoreLane.generateCandidates(payload.project_id || '', payload, scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-candidates-generate-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_CANDIDATE_STATUS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score candidate status API' });
          sendJSON(res, 200, { candidate: scoreLane.setCandidateStatus(payload.project_id || '', payload.candidate_id || '', payload.status || '', payload.notes, scoreOptions()) });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-candidate-status-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_CANDIDATE_APPROVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score candidate approve API' });
          sendJSON(res, 200, scoreLane.approveCandidate(payload.project_id || '', payload.candidate_id || '', scoreOptions(), { durationExact: payload.duration_exact }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-candidate-approve-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_CANDIDATE_REVISE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score candidate revise API' });
          sendJSON(res, 200, scoreLane.reviseCandidate(payload.project_id || '', payload.candidate_id || '', payload.request || '', scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-candidate-revise-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_VERIFY_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score verify API' });
          const project_id = payload.project_id || '';
          const settings = scoreLane.loadSettings(scoreOptions());
          const { dir } = scoreLane.resolveProjectDir(settings, project_id);
          const result = verifyApprovedExports(dir, {});
          sendJSON(res, 200, { project_id, dir, verified: result.verified, no_approved_export: !!result.no_approved_export, failures: result.failures, checks: result.checks, report: formatVerifierReport(result, dir) });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-verify-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_REAPER_BUILD_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score REAPER build API' });
          sendJSON(res, 200, scoreLane.buildReaperHandoff(payload.project_id || '', payload.candidate_id || '', scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-reaper-build-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_REAPER_OPEN_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score REAPER open API' });
          // Awaited: the launch result is now honest (spawn failure → 500).
          sendJSON(res, 200, await scoreLane.openInReaper(payload.project_id || '', payload.candidate_id || '', scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-reaper-open-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_ABLETON_BUILD_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score Ableton build API' });
          sendJSON(res, 200, scoreLane.buildAbletonHandoff(payload.project_id || '', payload.candidate_id || '', scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-ableton-build-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_PROBE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score probe API' });
          sendJSON(res, 200, scoreLane.probeDuration(payload.path || '', scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-probe-error'));
      return;
    }
    if (req.method === 'GET' && url.pathname === SCORE_PROMPT_API) {
      try {
        const task = url.searchParams.get('task') || 'cue_sheet';
        const projectId = url.searchParams.get('id') || '';
        let context = {};
        if (projectId) {
          const state = scoreLane.getProject(projectId, scoreOptions());
          const scriptFile = require('node:path').join(state.dir, 'script-snapshot.txt');
          context = {
            duration_seconds: state.project.duration_seconds,
            target_platform: state.project.target_platform,
            music_role: state.project.music_role,
            dialogue_density: state.project.dialogue_density,
            overall_mood: state.project.overall_mood,
            script_text: fs.existsSync(scriptFile) ? fs.readFileSync(scriptFile, 'utf8').slice(0, 6000) : '(no script)',
            cue_sheet: state.cue_sheet || {},
            palette_ids: Object.keys(require('./score-engine/score-schemas.js').DEFAULT_PALETTES).join(', '),
            preferences: '(none)',
          };
        }
        sendJSON(res, 200, { task, prompt: scorePlanner.renderPrompt(task, context) });
      } catch (error) { sendError(res, error.statusCode || 500, error.message, 'score-prompt-error'); }
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_AI_APPLY_API) {
      readJsonBody(req, 1024 * 512)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score AI apply API' });
          sendJSON(res, 200, scoreLane.generateCuesForProject(payload.project_id || '', { ai_response_text: payload.response_text || '', generator: 'ai_manual_paste' }, scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-ai-apply-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_AI_CALL_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score AI call API' });
          const settings = scoreLane.loadSettings(scoreOptions());
          const provider = payload.provider || settings.default_ai_provider;
          if (provider === 'manual') {
            const error = new Error('AI provider is set to manual. Use "Copy prompt" + "Paste AI response", or pick a provider in Settings.');
            error.statusCode = 400;
            throw error;
          }
          const promptRes = await new Promise((resolve, reject) => {
            try {
              const state = scoreLane.getProject(payload.project_id || '', scoreOptions());
              const scriptFile = require('node:path').join(state.dir, 'script-snapshot.txt');
              resolve(scorePlanner.renderPrompt('cue_sheet', {
                duration_seconds: state.project.duration_seconds,
                target_platform: state.project.target_platform,
                music_role: state.project.music_role,
                dialogue_density: state.project.dialogue_density,
                overall_mood: state.project.overall_mood,
                script_text: fs.existsSync(scriptFile) ? fs.readFileSync(scriptFile, 'utf8').slice(0, 6000) : '(no script)',
              }));
            } catch (e) { reject(e); }
          });
          const aiResult = await scorePlanner.callAiProvider(provider, promptRes, settings);
          const applied = scoreLane.generateCuesForProject(payload.project_id || '', { ai_response_text: aiResult.text, generator: `ai_${aiResult.provider}_${aiResult.model}` }, scoreOptions());
          sendJSON(res, 200, { provider: aiResult.provider, model: aiResult.model, ...applied });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-ai-call-error'));
      return;
    }
    if (req.method === 'POST' && url.pathname === SCORE_OPEN_FOLDER_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Score open folder API' });
          sendJSON(res, 200, await scoreLane.openFolder(payload.project_id || '', payload.path || '', scoreOptions()));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'score-open-folder-error'));
      return;
    }
    if (req.method === 'GET' && url.pathname === SCORE_FILE_API) {
      try {
        const settings = scoreLane.loadSettings(scoreOptions());
        const filePath = scoreLane.resolveProjectFile(settings, url.searchParams.get('id') || '', url.searchParams.get('path') || '');
        const ext = require('node:path').extname(filePath).toLowerCase();
        const types = { '.wav': 'audio/wav', '.mid': 'audio/midi', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.rpp': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': fs.statSync(filePath).size, 'Cache-Control': 'no-store' });
        // Guarded like the other media routes: the file can vanish between the
        // stat and the stream open — an unguarded error leaves the response
        // hanging with headers already sent.
        const scoreStream = fs.createReadStream(filePath);
        scoreStream.on('error', (err) => { console.error('Score file stream error:', err.message); res.destroy(); });
        scoreStream.pipe(res);
      } catch (error) { sendError(res, error.statusCode || 500, error.message, 'score-file-error'); }
      return;
    }

    // Save keep/flag/reject review decisions to video-review.json.
    if (req.method === 'POST' && url.pathname === PROJECT_VIDEO_REVIEW_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveProjectVideoReview(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'project-video-review-save-error'));
      return;
    }

    if (req.method === 'GET' && url.pathname === COCKPIT_ORIENTATION_API) {
      try {
        sendJSON(res, 200, buildCockpitOrientation());
      } catch (error) {
        sendError(res, 500, `Cockpit orientation unavailable: ${error.message}`, null);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === ARTIFACT_TEXT_API) {
      try {
        const runId = url.searchParams.get('runId') || '';
        sendJSON(
          res,
          200,
          readPackageRunArtifactText(runId, url.searchParams.get('file') || '', { root: serverOptions.root || ROOT })
        );
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, null, { exists: error.exists });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === ARTIFACTS_LIST_API) {
      try {
        const runId = url.searchParams.get('runId') || '';
        sendJSON(
          res,
          200,
          listPackageRunArtifacts(runId, { root: serverOptions.root || ROOT })
        );
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, null);
      }
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/favicon.ico') {
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : FAVICON_SVG);
      return;
    }

    if (req.method === 'GET' && url.pathname === DAILY_SCOUT_TODAY_API) {
      handleDailyScoutToday(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === DAILY_SCOUT_ARCHIVE_API) {
      handleDailyScoutArchive(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === DAILY_SCOUT_DATES_API) {
      handleDailyScoutDates(req, res);
      return;
    }

    // ── Idea triage + promote-to-project (daily-idea-scout) ──
    // Read-only triage overlay (non-destructive sidecar) for a date's ideas.
    if (req.method === 'GET' && url.pathname === IDEAS_TRIAGE_API) {
      try {
        const archiveRoot = path.join(aigenPaths({ root: serverOptions.root || ROOT }).aigenRoot, 'daily-idea-scout');
        sendJSON(res, 200, { date: url.searchParams.get('date') || '', triage: ideaPromotion.readTriage(archiveRoot, url.searchParams.get('date') || '') });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'ideas-triage-error');
      }
      return;
    }

    // Set an idea's triage status (approve/reject/park/unpark/shortlist). Works
    // for both daily ideas (date+index) and user-topic runs (source=user_topic,
    // date, run_id, index).
    if (req.method === 'POST' && url.pathname === IDEAS_STATUS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const paths = aigenPaths({ root: serverOptions.root || ROOT });
          const status = String(payload.status || '').trim();
          if (payload.source === 'user_topic') {
            sendJSON(res, 200, topicScout.setTopicIdeaStatus({
              topicRoot: path.join(paths.aigenRoot, 'topic-idea-scout'),
              date: payload.date, runId: payload.run_id, index: payload.index, status,
            }));
          } else {
            sendJSON(res, 200, ideaPromotion.setIdeaStatus({
              archiveRoot: path.join(paths.aigenRoot, 'daily-idea-scout'),
              date: payload.date, index: payload.index, status,
            }));
          }
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'ideas-status-error'));
      return;
    }

    // Promote an idea into a script-package project (idempotent). Daily or
    // user-topic source.
    if (req.method === 'POST' && url.pathname === IDEAS_PROMOTE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const paths = aigenPaths({ root: serverOptions.root || ROOT });
          let result;
          if (payload.source === 'user_topic') {
            result = topicScout.promoteTopicIdea({
              topicRoot: path.join(paths.aigenRoot, 'topic-idea-scout'),
              scriptPackagesRoot: paths.scriptPackages,
              date: payload.date, runId: payload.run_id, index: payload.index,
            });
          } else {
            result = ideaPromotion.promoteIdea({
              archiveRoot: path.join(paths.aigenRoot, 'daily-idea-scout'),
              scriptPackagesRoot: paths.scriptPackages,
              date: payload.date, index: payload.index,
            });
          }
          sendJSON(res, 200, Object.assign({}, result, { href: `project-workspace.html?id=${encodeURIComponent(result.project_id)}` }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'ideas-promote-error'));
      return;
    }

    // Generate 10 candidate ideas from a user-seeded topic via local Ollama on
    // vidnux (no cloud fallback). Stores a separate topic-idea-scout run; the
    // daily archive is never touched.
    if (req.method === 'POST' && url.pathname === IDEAS_GENERATE_FROM_TOPIC_API) {
      readJsonBody(req)
        .then(async (payload) => {
          validateLocalWriteRequest(req, payload);
          const topic = topicScout.validateTopic(payload.topic); // 400 on empty/too long
          const count = topicScout.DEFAULT_COUNT;
          const { system, user, schema } = topicScout.buildTopicPrompt(topic, count);
          // local-first: vidnux Ollama; on unavailable, callOllamaChat throws 503.
          const content = await callOllamaChat({ system, user, schema }, options);
          const ideas = topicScout.parseTopicIdeas(content, count); // 502 if malformed/insufficient
          const nowIso = new Date().toISOString();
          const date = nowIso.slice(0, 10);
          const runId = topicScout.makeRunId(topic, nowIso);
          const paths = aigenPaths({ root: serverOptions.root || ROOT });
          const written = topicScout.writeTopicRun({
            topicRoot: path.join(paths.aigenRoot, 'topic-idea-scout'),
            date, runId, seedTopic: topic, provider: 'ollama', providerHost: 'vidnux', ideas, now: nowIso,
          });
          sendJSON(res, 200, {
            ok: true, kind: topicScout.KIND, run_id: runId, date, seed_topic: topic,
            provider: 'ollama', provider_host: 'vidnux', ideas,
            archive_path: written.archive_path,
            triage_context: { source: 'user_topic', date, run_id: runId },
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'ideas-generate-from-topic-error'));
      return;
    }

    // List recent user-topic runs (read-only).
    if (req.method === 'GET' && url.pathname === IDEAS_TOPIC_RUNS_API) {
      try {
        const topicRoot = path.join(aigenPaths({ root: serverOptions.root || ROOT }).aigenRoot, 'topic-idea-scout');
        sendJSON(res, 200, { runs: topicScout.listTopicRuns(topicRoot) });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'ideas-topic-runs-error');
      }
      return;
    }

    // Reload a single user-topic run + its triage (read-only).
    if (req.method === 'GET' && url.pathname === IDEAS_TOPIC_RUN_API) {
      try {
        const topicRoot = path.join(aigenPaths({ root: serverOptions.root || ROOT }).aigenRoot, 'topic-idea-scout');
        const date = url.searchParams.get('date') || '';
        const runId = url.searchParams.get('run_id') || '';
        const run = topicScout.readTopicRun(topicRoot, date, runId);
        sendJSON(res, 200, { run, triage: topicScout.readTopicTriage(topicRoot, date, runId) });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'ideas-topic-run-error');
      }
      return;
    }

    // ── Topic Scout: custom topic submissions ──

    if (req.method === 'GET' && url.pathname === TOPIC_SCOUT_LIST_API) {
      try {
        const runId = url.searchParams.get('runId') || '2026-06-24-ideation';
        const topics = submittedTopics.listSubmittedTopics(ROOT, runId);
        sendJSON(res, 200, { runId, count: topics.length, topics });
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, null);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === TOPIC_SCOUT_SUBMIT_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const runId = payload.runId || '2026-06-24-ideation';
          validatePackageRunId(runId);
          const topicText = payload.topicText || '';
          const record = submittedTopics.saveSubmittedTopic(ROOT, runId, topicText);
          sendJSON(res, 200, record);
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'GET' && url.pathname === TOPIC_SCOUT_GET_API) {
      try {
        const runId = url.searchParams.get('runId') || '2026-06-24-ideation';
        validatePackageRunId(runId);
        const topicId = url.searchParams.get('topicId') || '';
        const record = submittedTopics.getSubmittedTopic(ROOT, runId, topicId);
        if (!record) {
          sendError(res, 404, 'Topic not found.', null);
          return;
        }
        sendJSON(res, 200, record);
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, null);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === TOPIC_SCOUT_UPDATE_STATUS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const runId = payload.runId || '2026-06-24-ideation';
          validatePackageRunId(runId);
          const topicId = payload.topicId || '';
          const status = payload.status || 'submitted';
          const record = submittedTopics.updateTopicStatus(ROOT, runId, topicId, status);
          if (!record) {
            sendError(res, 404, 'Topic not found.', null);
            return;
          }
          sendJSON(res, 200, record);
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    // ── Save Selected Package (write selected-package.json to run folder) ──

    if (req.method === 'POST' && url.pathname === SAVE_SELECTED_PACKAGE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const runId = String(payload.runId || '').trim();
          if (!runId) throw Object.assign(new Error('runId is required.'), { statusCode: 400 });
          validatePackageRunId(runId);
          const selectedData = payload.selectedPackage;
          if (!selectedData || typeof selectedData !== 'object') {
            throw Object.assign(new Error('selectedPackage is required.'), { statusCode: 400 });
          }
          const runDir = path.join(ROOT, PACKAGE_RUNS_DIR, runId);
          if (!fs.existsSync(runDir)) {
            throw Object.assign(new Error(`Run folder not found: ${runId}`), { statusCode: 404 });
          }
          // Write selected-package.json
          const jsonPath = path.join(runDir, 'selected-package.json');
          fs.writeFileSync(jsonPath, JSON.stringify(selectedData, null, 2), 'utf8');
          // Also write selected-package.md if title is available
          const pkg = selectedData.package || selectedData;
          const title = pkg.proposedTitle || pkg.proposed_title || pkg.title || 'Untitled package';
          const mdPath = path.join(runDir, 'selected-package.md');
          const md = `# Selected Package: ${title}\n\n- Package number: ${pkg.packageNumber || ''}\n- Score: ${pkg.score !== undefined ? pkg.score : ''}/100\n- Recommendation: ${pkg.recommendation || ''}\n- Production difficulty: ${pkg.productionDifficulty || ''}\n\n## Idea\n\n${pkg.idea || 'Not specified.'}\n\n## Viewer Promise\n\n${pkg.viewerPromise || 'Not specified.'}\n\n## Target Viewer\n\n${pkg.targetViewer || 'Not specified.'}\n\n## Thumbnail Concept\n\n${pkg.thumbnailConcept || 'Not specified.'}\n\n## Main Risk\n\n${pkg.mainRisk || 'Not specified.'}\n`;
          fs.writeFileSync(mdPath, md, 'utf8');
          // Stamp the chosen workflow path (vertical/horizontal) onto the run if the
          // client passed one (from the new-video-build choice). Explicit, durable.
          let workflowPath = null;
          if (payload.workflowPath) {
            try { workflowPath = setWorkflowPathForRun({ runId, path: payload.workflowPath }, { root: ROOT }).workflowPath; } catch (_) {}
          }
          sendJSON(res, 200, {
            runId,
            title,
            workflowPath,
            jsonPath: `${PACKAGE_RUNS_DIR}/${runId}/selected-package.json`,
            mdPath: `${PACKAGE_RUNS_DIR}/${runId}/selected-package.md`,
            nextStep: 'Stage 1 complete. selected-package.json and selected-package.md saved to run folder. Next: Stage 2 (Outline) — paste the outline prompt into Hermes/ChatGPT to generate 3 outline options.',
          });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    // ── Generate Outline Prompt (run package-engine-new-outline.js) ──

    if (req.method === 'POST' && url.pathname === GENERATE_OUTLINE_PROMPT_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const runId = String(payload.runId || '').trim();
          if (!runId) throw Object.assign(new Error('runId is required.'), { statusCode: 400 });
          validatePackageRunId(runId);
          const runDir = path.join(ROOT, PACKAGE_RUNS_DIR, runId);
          if (!fs.existsSync(runDir)) {
            throw Object.assign(new Error(`Run folder not found: ${runId}`), { statusCode: 404 });
          }
          const selectedPath = path.join(runDir, 'selected-package.json');
          if (!fs.existsSync(selectedPath)) {
            throw Object.assign(new Error('selected-package.json not found. Save your selection first.'), { statusCode: 400 });
          }
          const scriptPath = path.join(ROOT, 'scripts', 'package-engine-new-outline.js');
          const { spawnSync } = require('child_process');
          try {
            const result = spawnSync('node', [scriptPath, `package-runs/${runId}`], {
              cwd: ROOT,
              encoding: 'utf8',
              timeout: 30000,
            });
            if (result.error) {
              throw result.error;
            }
            const output = result.stdout || '';
            // Read the generated outline-prompt.md
            const outlinePromptPath = path.join(runDir, 'outline-prompt.md');
            let outlinePrompt = '';
            if (fs.existsSync(outlinePromptPath)) {
              outlinePrompt = fs.readFileSync(outlinePromptPath, 'utf8');
            }
            sendJSON(res, 200, {
              runId,
              output: output.trim(),
              outlinePrompt,
              outlinePromptPath: `package-runs/${runId}/outline-prompt.md`,
              nextStep: 'Copy the outline prompt below, paste it into Hermes or ChatGPT, then save the 3 outline options as outlines.md in the run folder.',
            });
          } catch (err) {
            sendError(res, 500, 'Failed to generate outline prompt: ' + (err.message || String(err)), null);
          }
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'GET' && url.pathname === AIGEN_STATUS_API) {
      handleAigenStatus(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === AIGEN_RESOLVE_ASSEMBLY_API) {
      handleAigenResolveAssemblyCreate(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith(AIGEN_FLUX_IMAGES_API_PREFIX)) {
      handleAigenFluxImages(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === AIGEN_SELECTED_IMAGES_API) {
      handleAigenSelectedImages(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === AIGEN_UPLOAD_IMAGE_API) {
      readJsonBody(req, MANUAL_IMAGE_MAX_BYTES + 2 * 1024 * 1024)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, uploadAigenImage(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, error.code || 'aigen-upload-image-error', error.occupied ? { occupied: true } : undefined));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith(AIGEN_ASSETS_PREFIX)) {
      handleAigenAsset(req, res, url, serverOptions);
      return;
    }

    if (req.method === 'GET' && url.pathname === IMAGE_PROMPTS_READ_API) {
      handleImagePromptsRead(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === IMAGE_PROMPTS_VALIDATE_API) {
      handleImagePromptsValidate(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === IMAGE_PROMPTS_SAVE_API) {
      handleImagePromptsSave(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === PRESTO_SUBMIT_API) {
      handlePrestoSubmit(req, res, serverOptions);
      return;
    }

    if (req.method === 'GET' && url.pathname === PRESTO_JOB_STATUS_API) {
      handlePrestoJobStatus(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === PRESTO_CANCEL_API) {
      handlePrestoCancel(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === PRESTO_RESULTS_API) {
      handlePrestoResults(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === COMPUTE_STATUS_API) {
      execFile('python3', [COMPUTE_SELECTOR, 'status', '--json'], {
        cwd: COMPUTE_REGISTRY_DIR,
        timeout: COMPUTE_REGISTRY_TIMEOUT_MS,
      }, (err, stdout, stderr) => {
        if (err) {
          sendError(res, 500, `compute status error: ${(stderr || err.message || '').slice(0, 300)}`, 'compute-status-error');
          return;
        }
        try { sendJSON(res, 200, JSON.parse(stdout)); }
        catch (e) { sendError(res, 500, `compute status JSON parse error: ${e.message}`, 'compute-status-parse-error'); }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === COMPUTE_SELECT_API) {
      const lane = url.searchParams.get('lane') || 'wan_i2v';
      // Reject unregistered/unsafe lane ids with a controlled 400 before the
      // selector is spawned (traversal, shell-like, overlong, or unknown lanes).
      if (!isValidComputeLane(lane)) {
        sendError(res, 400, `Invalid or unregistered compute lane '${String(lane).slice(0, 64)}'. Supported: ${Array.from(COMPUTE_LANES).join(', ')}.`, 'invalid_lane');
        return;
      }
      computeReadinessGate(lane).then((result) => {
        sendJSON(res, 200, result);
      }).catch((error) => {
        sendError(res, 500, error.message || 'compute select error', 'compute-select-error');
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === PACKAGE_VIDEO_PROMPTS_API) {
      handlePackageVideoPrompts(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === FLUX_SUBMIT_API) {
      handleFluxSubmit(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === FLUX_JOB_STATUS_API) {
      handleFluxJobStatus(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === FLUX_CANCEL_API) {
      handleFluxCancel(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === REMOTION_STATUS_API) {
      try { sendJSON(res, 200, remotionLane.status()); }
      catch (error) { sendError(res, error.statusCode || 500, error.message, 'remotion-status-error'); }
      return;
    }

    if (req.method === 'GET' && url.pathname === REMOTION_JOB_STATUS_API) {
      try { sendJSON(res, 200, { job: remotionLane.currentJobStatus() }); }
      catch (error) { sendError(res, error.statusCode || 500, error.message, 'remotion-job-status-error'); }
      return;
    }

    if (req.method === 'POST' && url.pathname === REMOTION_RENDER_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, remotionLane.startRender(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'remotion-render-error', { active: error.active || null }));
      return;
    }

    if (req.method === 'POST' && url.pathname === REMOTION_CANCEL_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, remotionLane.cancelRender());
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'remotion-cancel-error'));
      return;
    }

    if (req.method === 'GET' && url.pathname === FLUX_RESULTS_API) {
      handleFluxResults(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === API_PREFIX) {
      readJsonBody(req).then(async (payload) => {
        // Local-write guard: same Host + Origin + nonce check as the GPU-job/aigen
        // POST endpoints. Runs BEFORE createThumbnailResponse so the OpenAI provider
        // (external paid call) is never reached without a valid local write nonce.
        validateLocalWriteRequest(req, payload);
        try {
          const thumbnailResponse = await createThumbnailResponse(payload);
          sendJSON(res, 200, thumbnailResponse);
        } catch (error) {
          const config = providerConfig();
          sendError(res, error.statusCode || 500, error.message, null, {
            errorCode: error.errorCode || 'thumbnail_generation_error',
            provider: config.provider,
            model: config.provider === 'openai' ? config.model : 'local-svg-placeholder',
            timeoutMs: config.timeoutMs,
          });
        }
      }).catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === CAPTURE_EVIDENCE_PREVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, buildCaptureEvidencePreview(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, { missing: error.missing || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === CAPTURE_EVIDENCE_APPLY_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, applyCaptureEvidenceIntake(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, { missing: error.missing || [] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === EVIDENCE_INTAKE_STATUS_API) {
      try {
        sendJSON(res, 200, buildEvidenceIntakeStatus({ runId: url.searchParams.get('runId') || '' }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'evidence-intake-status-error');
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === EVIDENCE_INTAKE_PREVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, buildEvidenceIntakePreview(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'evidence-intake-preview-error', { errors: error.errors || [], warnings: error.warnings || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === EVIDENCE_INTAKE_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveEvidenceIntakeDraft(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, { errors: error.errors || [], warnings: error.warnings || [] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === ROUGH_CUT_STATUS_API) {
      try {
        sendJSON(res, 200, buildRoughCutStatus({ runId: url.searchParams.get('runId') || '' }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'rough-cut-status-error');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === NEXT_SAFE_ACTION_API) {
      try {
        sendJSON(res, 200, nextSafeActionScript.buildNextSafeAction(url.searchParams.get('runId') || '', { repoRoot: ROOT }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'next-safe-action-error', { readOnly: true });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === PACKAGE_RUNS_LIST_API) {
      try {
        sendJSON(res, 200, readPackageRunsIndex());
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'package-runs-list-error');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === PACKAGE_RUNS_CANDIDATES_API) {
      try {
        const includeParked = url.searchParams.get('includeParked') === 'true';
        const includeAbandoned = url.searchParams.get('includeAbandoned') === 'true';
        const includeSuperseded = url.searchParams.get('includeSuperseded') === 'true';
        sendJSON(res, 200, discoverPackageRunCandidates({
          root: serverOptions.root || ROOT,
          includeParked,
          includeAbandoned,
          includeSuperseded,
        }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, 'package-runs-candidates-error');
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === SAVE_OUTLINE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveFinalOutline(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'save-outline-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === WORKFLOW_PATH_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, setWorkflowPathForRun(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'workflow-path-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === SHORTS_SCRIPT_OPTIONS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          return generateShortsScripts(payload, { root: serverOptions.root || ROOT });
        })
        .then((result) => sendJSON(res, 200, result))
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'shorts-script-options-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === SHORTS_SAVE_SCRIPT_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveShortsScript(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'shorts-save-script-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === SHORTS_SCRIPT_COMMITMENT_CHECK_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          return scriptCommitmentCheck(payload, { root: serverOptions.root || ROOT });
        })
        .then((result) => sendJSON(res, 200, result))
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'shorts-script-commitment-check-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === SHORTS_SAVE_SCRIPT_COMMITMENT_CHECK_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveScriptCommitmentCheck(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'shorts-save-script-commitment-check-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === TOPIC_SCOUT_GENERATE_ONE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          return generateOneTopicCandidate(payload, { root: serverOptions.root || ROOT });
        })
        .then((result) => sendJSON(res, 200, result))
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'topic-scout-generate-one-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === SHORTS_I2V_PROMPTS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          return generateI2vPrompts(payload, { root: serverOptions.root || ROOT });
        })
        .then((result) => sendJSON(res, 200, result))
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'shorts-i2v-prompts-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === SHORTS_SAVE_I2V_PROMPTS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveI2vPrompts(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'shorts-save-i2v-prompts-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === BEGINNING_TRIAGE_GENERATE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          return generateBeginningTriageDraft(payload, { root: serverOptions.root || ROOT });
        })
        .then((result) => sendJSON(res, 200, result))
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'beginning-triage-generate-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === PACKAGE_RUNS_CANDIDATE_UPDATE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, updatePackageRunCandidate(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'package-runs-candidate-update-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === PACKAGE_RUNS_CANDIDATE_DELETE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, softDeletePackageRunCandidate(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'package-runs-candidate-delete-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === PACKAGE_RUNS_ARCHIVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const result = archivePackageRun(payload, { root: serverOptions.root || ROOT });
          // Refresh the index so the resume list drops the archived run on reload.
          let reindex;
          try {
            reindex = rebuildPackageRunsIndex();
          } catch (error) {
            reindex = { ok: false, error: error.message };
          }
          sendJSON(res, 200, { ...result, reindex });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'package-runs-archive-error'));
      return;
    }

    // ── Motion Graphics Studio (standalone deterministic motion cards) ────────
    // Local, file-backed project state; reads path-guarded; writes nonce + Host +
    // Origin gated. Slice 1: project/card CRUD + deterministic HTML preview. No
    // render yet (Slice 2). Never touches Super Focus / package-run / aigen state.

    if (req.method === 'GET' && url.pathname === MOTION_GRAPHICS_TEMPLATES_API) {
      sendJSON(res, 200, {
        templates: motionGraphicsTemplates.TEMPLATES,
        format_default: motionGraphicsTemplates.FORMAT_DEFAULT,
        style_default: motionGraphicsTemplates.STYLE_DEFAULT,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === MOTION_GRAPHICS_PROJECTS_API) {
      try { sendJSON(res, 200, { projects: motionGraphicsState.listProjects(mgOpts) }); }
      catch (error) { sendError(res, error.statusCode || 500, error.message, 'motion-graphics-projects-error'); }
      return;
    }

    if (req.method === 'POST' && url.pathname === MOTION_GRAPHICS_PROJECTS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Motion Graphics projects API' });
          const state = motionGraphicsState.createProject({ title: payload.title }, mgOpts);
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'motion-graphics-create-error'));
      return;
    }

    if (req.method === 'GET' && url.pathname === MOTION_GRAPHICS_PROJECT_API) {
      try {
        const id = url.searchParams.get('id') || '';
        sendJSON(res, 200, { project: motionGraphicsState.loadProject(id, mgOpts) });
      } catch (error) { sendError(res, error.statusCode || 500, error.message, 'motion-graphics-project-error'); }
      return;
    }

    if (req.method === 'POST' && url.pathname === MOTION_GRAPHICS_PROJECT_TITLE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Motion Graphics project-title API' });
          const state = motionGraphicsState.saveProjectTitle(payload.id || '', payload.title, mgOpts);
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'motion-graphics-title-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === MOTION_GRAPHICS_SOURCE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Motion Graphics source API' });
          const state = motionGraphicsState.saveSource(payload.id || '', payload.source || { script: payload.script }, mgOpts);
          sendJSON(res, 200, { project: state });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'motion-graphics-source-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === MOTION_GRAPHICS_CARD_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Motion Graphics card API' });
          const out = motionGraphicsState.addCard(payload.id || '', { type: payload.type, params: payload.params }, mgOpts);
          sendJSON(res, 200, { project: out.state, card: out.card });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'motion-graphics-card-error'));
      return;
    }

    if (req.method === 'POST' && url.pathname === MOTION_GRAPHICS_CARD_PARAMS_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Motion Graphics card-params API' });
          const patch = { type: payload.type, params: payload.params, format: payload.format, style: payload.style, engine: payload.engine, output_mode: payload.output_mode };
          const out = motionGraphicsState.updateCardParams(payload.id || '', payload.card_id || '', patch, mgOpts);
          const validation = motionGraphicsTemplates.validateCardParams(out.card.type, out.card.params);
          sendJSON(res, 200, { project: out.state, card: out.card, validation });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'motion-graphics-card-params-error'));
      return;
    }

    // Deterministic HTML preview for a card (read-only; no render, no file write).
    // The same builder is the HyperFrames composition source in Slice 2.
    if (req.method === 'GET' && url.pathname === MOTION_GRAPHICS_PREVIEW_API) {
      try {
        const id = url.searchParams.get('id') || '';
        const cardId = url.searchParams.get('card_id') || '';
        const state = motionGraphicsState.loadProject(id, mgOpts);
        const card = motionGraphicsState.findCard(state, cardId);
        if (!card) { sendError(res, 404, 'Card not found.', 'motion-graphics-preview-missing'); return; }
        const html = motionGraphicsTemplates.buildCardHtml(card);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(html);
      } catch (error) { sendError(res, error.statusCode || 500, error.message, 'motion-graphics-preview-error'); }
      return;
    }

    // Render a selected card via HyperFrames into the media namespace. Explicit
    // operator action only; synchronous for this slice; never auto-approves.
    if (req.method === 'POST' && url.pathname === MOTION_GRAPHICS_RENDER_CARD_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Motion Graphics render-card API' });
          const id = payload.id || '';
          const cardId = payload.card_id || '';
          const state = motionGraphicsState.loadProject(id, mgOpts);
          const card = motionGraphicsState.findCard(state, cardId);
          if (!card) { const e = new Error('Card not found.'); e.statusCode = 404; throw e; }
          // Record the exact renderer version in the render provenance — the
          // global HyperFrames CLI self-updates, so the version must be pinned
          // per render, not assumed (production proof 2026-07-21).
          const hfProbe = (serverOptions.hyperframesProbe || probeHyperframesAvailability)();
          // Approved-version GATE for transparent renders (alpha spec §14):
          // alpha encode behavior is version-sensitive — hard 409, never a
          // silent render on a drifted CLI. Opaque stays advisory-only.
          const mgApprovedVersion = serverOptions.motionGraphicsApprovedHyperframesVersion || MOTION_GRAPHICS_APPROVED_HYPERFRAMES_VERSION;
          if ((card.output_mode || 'opaque_card') === 'transparent_overlay' && hfProbe.version !== mgApprovedVersion) {
            const e = new Error(`Transparent renders are gated to HyperFrames ${mgApprovedVersion}; installed is ${hfProbe.version || 'unknown'}. Deliberate remedies: review the new CLI and update MOTION_GRAPHICS_APPROVED_HYPERFRAMES_VERSION, or reinstall hyperframes@${mgApprovedVersion}. No auto-upgrade.`);
            e.statusCode = 409;
            throw e;
          }
          const out = motionGraphicsRenderers.renderCard(
            { project: state, card },
            {
              mediaRoot: mgMediaRoot, runRender: mgRunRender, rendererVersion: hfProbe.version || null,
              probeVideo: serverOptions.motionGraphicsProbeVideo, alphaSanity: serverOptions.motionGraphicsAlphaSanity,
            }
          );
          // The render (MP4+manifest on disk) and the card-state record are two
          // writes. If persisting the record fails, don't silently lose a real
          // render — surface the orphan (its render_id/manifest are on disk).
          let saved;
          try {
            saved = motionGraphicsState.recordCardRender(id, cardId, out.record, mgOpts);
          } catch (persistErr) {
            const e = new Error('Render produced output (' + (out.record.path || out.record.manifest_path) + ') but the project state record could not be saved: ' + persistErr.message + '. The render is on disk; retry to re-record.');
            e.statusCode = persistErr.statusCode || 500;
            throw e;
          }
          if (!out.ok) {
            // Failed render is persisted honestly, then surfaced as an error.
            sendError(res, out.statusCode || 500, out.record.error || 'HyperFrames render failed.', 'motion-graphics-render-failed', { render: out.record, card: saved.card });
            return;
          }
          sendJSON(res, 200, { project: saved.state, card: saved.card, render: out.record });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'motion-graphics-render-error'));
      return;
    }

    if (req.method === 'GET' && url.pathname === MOTION_GRAPHICS_RENDER_STATUS_API) {
      try {
        const id = url.searchParams.get('id') || '';
        const cardId = url.searchParams.get('card_id') || '';
        const state = motionGraphicsState.loadProject(id, mgOpts);
        const card = motionGraphicsState.findCard(state, cardId);
        if (!card) { sendError(res, 404, 'Card not found.', 'motion-graphics-render-status-missing'); return; }
        // Version-drift warning (never a failure): the last rendered record's
        // renderer version vs the currently installed global CLI. Old renders
        // without a recorded version cannot drift — they predate provenance.
        const hfNow = (serverOptions.hyperframesProbe || probeHyperframesAvailability)();
        const lastRendered = (card.renders || []).filter((r) => r.status === 'rendered' && r.renderer_version).slice(-1)[0] || null;
        const drift = Boolean(lastRendered && hfNow.version && lastRendered.renderer_version !== hfNow.version);
        sendJSON(res, 200, {
          project_id: state.project_id, card_id: card.card_id, status: card.status,
          current_render_id: card.current_render_id || null, renders: card.renders || [],
          hyperframes_installed_version: hfNow.version || null,
          hyperframes_version_drift: drift,
          hyperframes_version_drift_note: drift ? `Last render used HyperFrames ${lastRendered.renderer_version}; installed is ${hfNow.version}. A re-render may differ — warning only, existing renders stay valid.` : null,
        });
      } catch (error) { sendError(res, error.statusCode || 500, error.message, 'motion-graphics-render-status-error'); }
      return;
    }

    // Serve a rendered MP4, guarded to the project's own media dir + render id.
    if (req.method === 'GET' && url.pathname === MOTION_GRAPHICS_MEDIA_API) {
      try {
        const id = url.searchParams.get('id') || '';
        const renderId = url.searchParams.get('render_id') || '';
        const state = motionGraphicsState.loadProject(id, mgOpts);
        const filePath = motionGraphicsRenderers.resolveRenderMediaFile(state, renderId, { mediaRoot: mgMediaRoot });
        if (!filePath) { sendError(res, 404, 'Render not found.', 'motion-graphics-media-missing'); return; }
        // MIME from the resolved record path (never from request input):
        // transparent overlays are MOV/ProRes, opaque cards MP4.
        const mgMime = filePath.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
        res.writeHead(200, { 'Content-Type': mgMime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        fs.createReadStream(filePath).pipe(res);
      } catch (error) { sendError(res, error.statusCode || 500, error.message, 'motion-graphics-media-error'); }
      return;
    }

    // Remotion SPEC/EXPORT (no render, no dependency, no brandkit mutation).
    // GET returns the brandkit composition + props mapping for a card.
    if (req.method === 'GET' && url.pathname === MOTION_GRAPHICS_REMOTION_SPEC_API) {
      try {
        const id = url.searchParams.get('id') || '';
        const cardId = url.searchParams.get('card_id') || '';
        const state = motionGraphicsState.loadProject(id, mgOpts);
        const card = motionGraphicsState.findCard(state, cardId);
        if (!card) { sendError(res, 404, 'Card not found.', 'motion-graphics-remotion-spec-missing'); return; }
        const spec = motionGraphicsRemotion.buildRemotionSpec(card, { brandkitRoot: remotionLane.BRANDKIT_ROOT });
        sendJSON(res, 200, { spec });
      } catch (error) { sendError(res, error.statusCode || 500, error.message, 'motion-graphics-remotion-spec-error'); }
      return;
    }

    // POST writes ONLY the props JSON to the card's media sources/ (spec/export;
    // never renders). Refuses unmapped card types (400 with the note).
    if (req.method === 'POST' && url.pathname === MOTION_GRAPHICS_REMOTION_SPEC_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Motion Graphics remotion-spec API' });
          const id = payload.id || '';
          const cardId = payload.card_id || '';
          const state = motionGraphicsState.loadProject(id, mgOpts);
          const card = motionGraphicsState.findCard(state, cardId);
          if (!card) { const e = new Error('Card not found.'); e.statusCode = 404; throw e; }
          const spec = motionGraphicsRemotion.buildRemotionSpec(card, { brandkitRoot: remotionLane.BRANDKIT_ROOT });
          if (!spec.mapped) { const e = new Error(spec.notes[spec.notes.length - 1] || 'No brandkit composition maps to this card type.'); e.statusCode = 400; throw e; }
          const mediaDir = motionGraphicsRenderers.projectMediaDir(id, { mediaRoot: mgMediaRoot });
          const propsFile = path.join(mediaDir, 'sources', `${path.basename(motionGraphicsState.assertValidCardId(cardId))}.remotion.json`);
          fs.mkdirSync(path.dirname(propsFile), { recursive: true });
          const tmp = `${propsFile}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, `${JSON.stringify(spec.props, null, 2)}\n`, 'utf8');
          fs.renameSync(tmp, propsFile);
          spec.props_file = propsFile;
          spec.render_hint = spec.render_hint ? spec.render_hint.replace('<PROPS_FILE>', propsFile) : spec.render_hint;
          sendJSON(res, 200, { spec, props_file: propsFile });
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, 'motion-graphics-remotion-spec-error'));
      return;
    }

    if (req.method === 'GET' && url.pathname === HYPERFRAMES_STATUS_API) {
      try {
        sendJSON(res, 200, discoverHyperframesCompositions({ runId: url.searchParams.get('runId') || '' }, { root: serverOptions.root || ROOT }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, null);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === HYPERFRAMES_PREVIEW_API) {
      try {
        const target = resolveHyperframesCompositionFile({
          runId: url.searchParams.get('runId') || '',
          id: url.searchParams.get('id') || '',
        }, { root: serverOptions.root || ROOT });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        fs.createReadStream(target.sourcePath).pipe(res);
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, null);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === HYPERFRAMES_RENDER_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, renderHyperframesComposition(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, {
          manifest: error.manifest || null,
        }));
      return;
    }

    if (req.method === 'GET' && url.pathname === PRODUCTION_GPS_API) {
      try {
        sendJSON(res, 200, buildProductionGps({ runId: url.searchParams.get('runId') || '' }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, null);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === SECOND_CUT_INSPECTOR_API) {
      try {
        sendJSON(res, 200, buildSecondCutInspector({ runId: url.searchParams.get('runId') || '' }));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, null);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === SECOND_CUT_CANDIDATE_PREVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, buildSecondCutCandidateRegistration(payload, { mode: 'preview' }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === SECOND_CUT_CANDIDATE_APPLY_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, applySecondCutCandidateRegistration(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === SECOND_CUT_WATCH_NOTES_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveSecondCutWatchNotes(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === SECOND_CUT_REVIEW_REGENERATE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, regenerateSecondCutReviewDerived(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === FINAL_CANDIDATE_PREVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, buildFinalCandidateRegistration(payload, { mode: 'preview' }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === FINAL_CANDIDATE_APPLY_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, applyFinalCandidateRegistration(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === FINAL_WATCH_NOTES_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveFinalWatchNotes(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === FINAL_REVIEW_REGENERATE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, regenerateFinalReviewDerived(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === FINAL_REVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const output = runFinalReview(payload);
          if (output.ok) {
            sendJSON(res, 200, output);
          } else {
            sendError(res, 500, output.error || 'Operation failed', null);
          }
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === EXPORT_MASTER_PREVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, buildExportMasterRegistration(payload, { mode: 'preview' }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === EXPORT_MASTER_APPLY_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, applyExportMasterRegistration(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === DELIVERY_READINESS_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveDeliveryReadiness(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === EXPORT_CHECKLIST_REGENERATE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, regenerateExportChecklistDerived(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === EXPORT_CHECKLIST_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const output = runExportChecklist(payload);
          if (output.ok) {
            sendJSON(res, 200, output);
          } else {
            sendError(res, 500, output.error || 'Operation failed', null);
          }
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === PUBLICATION_METADATA_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const output = runPublicationMetadata(payload);
          if (output.ok) {
            sendJSON(res, 200, output);
          } else {
            sendError(res, 500, output.error || 'Operation failed', null);
          }
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === ARCHIVE_MANIFEST_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const output = runArchiveManifest(payload);
          if (output.ok) {
            sendJSON(res, 200, output);
          } else {
            sendError(res, 500, output.error || 'Operation failed', null);
          }
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === ROUGH_CUT_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, saveRoughCutWatchNotes(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, { missing: error.missing || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === ROUGH_CUT_REVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const output = runRoughCutReview(payload);
          if (output.ok) {
            sendJSON(res, 200, output);
          } else {
            sendError(res, 500, output.error || 'Operation failed', null);
          }
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, { missing: error.missing || [] }));
      return;
    }

    // ── Publish-gate operator decision (durable, package-run-scoped) ──────────
    // Distinct from the automated gate result: an explicit approve/reject/revoke
    // that survives reload + restart, bound to the evidence revision it was made
    // against, and stale-aware. Never publishes, uploads, renders, or advances
    // irreversible state. GET is read-only; writes are nonce-gated.
    if (req.method === 'GET' && url.pathname === PUBLISH_GATE_DECISION_API) {
      try {
        const { runDir } = resolvePackageRunDir(url.searchParams.get('runId') || url.searchParams.get('run') || '', { root: serverOptions.root || ROOT });
        sendJSON(res, 200, publishGateDecision.buildView(runDir));
      } catch (error) {
        sendError(res, error.statusCode || 500, error.message, error.code || null);
      }
      return;
    }
    const publishGateWrite = (action) => {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Publish-gate decision API' });
          const { runDir } = resolvePackageRunDir(payload.runId || payload.run || '', { root: serverOptions.root || ROOT });
          sendJSON(res, 200, action(runDir, payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, error.code || null));
    };
    if (req.method === 'POST' && url.pathname === PUBLISH_GATE_APPROVE_API) { publishGateWrite(publishGateDecision.approve); return; }
    if (req.method === 'POST' && url.pathname === PUBLISH_GATE_REJECT_API) { publishGateWrite(publishGateDecision.reject); return; }
    if (req.method === 'POST' && url.pathname === PUBLISH_GATE_REVOKE_API) { publishGateWrite(publishGateDecision.revoke); return; }

    if (req.method === 'POST' && url.pathname === ROUGH_CUT_REGENERATE_DERIVED_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, regenerateRoughCutDerivedArtifacts(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, { missing: error.missing || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === PACKAGE_RUNS_OPEN_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, openPackageRunAssetFolder(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === OPEN_FILE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload, { label: 'Open file action' });
          sendJSON(res, 200, openPackageRunFile(payload, { root: serverOptions.root || ROOT }));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, { exists: error.exists }));
      return;
    }

    if (req.method === 'POST' && url.pathname === DAILY_SCOUT_RUN_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, runDailyIdeaScoutNow(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === PACKAGE_RUNS_REINDEX_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, rebuildPackageRunsIndex());
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === ROUGH_CUT_OPEN_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, openRoughCutVideo(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    if (req.method === 'POST' && url.pathname === PICKUP_PLAN_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          sendJSON(res, 200, savePickupPlan(payload));
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null, { missing: error.missing || [] }));
      return;
    }

    // ── Media Gallery API ──
    if (req.method === 'GET' && url.pathname === '/api/package-runs/media-gallery') {
      handleMediaGallery(req, res, url);
      return;
    }

    // ── Friction Log API ──
    if (req.method === 'GET' && url.pathname === '/api/package-runs/friction-log') {
      handleFrictionLogRead(req, res, url);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/package-runs/friction-log/save') {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          handleFrictionLogSave(res, payload);
        })
        .catch((error) => sendError(res, error.statusCode || 500, error.message, null));
      return;
    }

    // ── Pipeline Status API (13-stage tracker) ──
    if (req.method === 'GET' && url.pathname === '/api/package-runs/pipeline-status') {
      handlePipelineStatus(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === RESOLVE_READINESS_API) {
      handleResolveReadiness(req, res, url, serverOptions);
      return;
    }

    // ── Visual Beat Map API (read-only) ──
    if (req.method === 'GET' && url.pathname === '/api/package-runs/beat-map') {
      handleBeatMap(req, res, url);
      return;
    }

    // ── AIGEN Review View proxy (bridge port 8099 into cockpit) ──
    if (url.pathname === '/aigen-review' || url.pathname.startsWith('/aigen-review/')) {
      const reviewPath = url.pathname.replace(/^\/aigen-review/, '') || '/';
      const reviewUrl = `http://127.0.0.1:8099${reviewPath}${url.search || ''}`;
      const proxyReq = http.request(reviewUrl, { method: req.method, headers: { ...req.headers, host: '127.0.0.1:8099' } }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => {
        sendError(res, 502, 'AIGEN Review View (port 8099) is not running. Start it with: cd ~/work/aigen-edit && python3 review-view/server.py', null);
      });
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
      return;
    }

    const filePath = safeJoin(SERVE_ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
    if (!filePath) {
      send(res, 403, 'Forbidden');
      return;
    }
    fs.stat(filePath, (err, stats) => {
      if (err) {
        send(res, 404, 'Not found');
        return;
      }
      if (stats.isDirectory()) {
        const index = path.join(filePath, 'index.html');
        if (fs.existsSync(index)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          const stream = fs.createReadStream(index);
          stream.on('error', (err) => { console.error('Stream error (index):', err.message); if (!res.headersSent) send(res, 500, 'Internal server error'); else res.end(); });
          stream.pipe(res);
          return;
        }
        send(res, 404, 'Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': inferMime(filePath), 'Cache-Control': 'no-store' });
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => { console.error('Stream error:', err.message); if (!res.headersSent) send(res, 500, 'Internal server error'); else res.end(); });
      stream.pipe(res);
    });
  });
}

if (require.main === module) {
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });

  // Safe auto-rebuild: if the package-runs index mirror is stale or missing on
  // startup, refresh it so the cockpit orientation panel never reads stale state.
  try {
    const freshness = packageRunsIndexScript.indexFreshness({ repoRoot: __dirname });
    if (freshness.stale) {
      console.log(`package-runs-index.json is ${freshness.state}; rebuilding before serving.`);
      rebuildPackageRunsIndex();
    }
  } catch (error) {
    console.error(`Index freshness check skipped: ${error.message}`);
  }

  const server = createServer();

  server.listen(PORT, HOST, () => {
    console.log(`VIDTOOLZ Episode Factory server running at http://${HOST}:${PORT}/`);
    console.log(`Package Engine running at http://${HOST}:${PORT}/package-engine.html`);
  });
}

module.exports = {
  API_PREFIX,
  COCKPIT_ORIENTATION_API,
  buildCockpitOrientation,
  buildProjectsLaneOrientation,
  isResolveSafeFilename,
  DAILY_SCOUT_RUN_API,
  PACKAGE_RUNS_REINDEX_API,
  runDailyIdeaScoutNow,
  rebuildPackageRunsIndex,
  AIGEN_ASSETS_PREFIX,
  AIGEN_FLUX_IMAGES_API_PREFIX,
  AIGEN_RESOLVE_ASSEMBLY_API,
  runResolveAssemblyCreate,
  packageStagedWanStatus,
  packageBestStagedWanStatus,
  packageHandoffVideoVariant,
  listPackageVideoVariants,
  assertValidVideoVariant,
  DEFAULT_VIDEO_VARIANT,
  PRESTO_PROFILE_OUTPUT_SUBDIRS,
  AIGEN_SELECTED_IMAGES_API,
  AIGEN_STATUS_API,
  FLUX_CANCEL_API,
  FLUX_JOB_STATUS_API,
  FLUX_RESULTS_API,
  FLUX_STATE,
  FLUX_SUBMIT_API,
  HYPERFRAMES_PREVIEW_API,
  HYPERFRAMES_RENDER_API,
  HYPERFRAMES_STATUS_API,
  MOTION_GRAPHICS_TEMPLATES_API,
  MOTION_GRAPHICS_PROJECTS_API,
  MOTION_GRAPHICS_PROJECT_API,
  MOTION_GRAPHICS_PROJECT_TITLE_API,
  MOTION_GRAPHICS_SOURCE_API,
  MOTION_GRAPHICS_CARD_API,
  MOTION_GRAPHICS_CARD_PARAMS_API,
  MOTION_GRAPHICS_PREVIEW_API,
  MOTION_GRAPHICS_RENDER_CARD_API,
  MOTION_GRAPHICS_RENDER_STATUS_API,
  MOTION_GRAPHICS_MEDIA_API,
  MOTION_GRAPHICS_REMOTION_SPEC_API,
  IMAGE_PROMPTS_READ_API,
  IMAGE_PROMPTS_SAVE_API,
  IMAGE_PROMPTS_VALIDATE_API,
  PRESTO_CANCEL_API,
  PRESTO_JOB_STATUS_API,
  PRESTO_RESULTS_API,
  PRESTO_STATE,
  PRESTO_SUBMIT_API,
  COMPUTE_STATUS_API,
  COMPUTE_SELECT_API,
  computeGateVerdict,
  isValidComputeLane,
  buildComputeDispatchReceipt,
  CAPTURE_EVIDENCE_APPLY_API,
  CAPTURE_EVIDENCE_PREVIEW_API,
  CAPTURE_EVIDENCE_AUDIT_FILE,
  CAPTURE_EVIDENCE_TARGETS,
  CAPTION_CHECK_FILE,
  DELIVERY_READINESS_FILE,
  DELIVERY_READINESS_MARKERS,
  DELIVERY_READINESS_SAVE_API,
  EVIDENCE_INTAKE_PREVIEW_API,
  EVIDENCE_INTAKE_SAVE_API,
  EVIDENCE_INTAKE_STATUS_API,
  EXPORT_CHECKLIST_FILE,
  EXPORT_CHECKLIST_API,
  EXPORT_CHECKLIST_REGENERATE_API,
  EXPORT_MASTER_APPLY_API,
  EXPORT_MASTER_PREVIEW_API,
  FINAL_CANDIDATE_APPLY_API,
  FINAL_CANDIDATE_FILE,
  FINAL_CANDIDATE_PREVIEW_API,
  FINAL_REVIEW_FILE,
  FINAL_REVIEW_API,
  FINAL_REVIEW_MARKERS,
  FINAL_REVIEW_REGENERATE_API,
  FINAL_WATCH_NOTES_FILE,
  FINAL_WATCH_NOTES_SAVE_API,
  LOUDNESS_CHECK_FILE,
  LOCAL_WRITE_NONCE_HEADER,
  ARCHIVE_MANIFEST_API,
  MASTER_FILE_MANIFEST_FILE,
  PACKAGE_RUNS_LIST_API,
  PACKAGE_RUNS_ARCHIVE_API,
  archivePackageRun,
  findRunAssetFolders,
  relocateRunMedia,
  PACKAGE_RUNS_CANDIDATES_API,
  PICKUP_ITEM_TYPES,
  PICKUP_PLAN_SAVE_API,
  PICKUP_PURPOSES,
  PICKUP_REQUIRED_VALUES,
  PICKUP_SOURCES,
  PICKUP_STATUSES,
  PRODUCTION_GPS_API,
  PUBLICATION_METADATA_API,
  NEXT_SAFE_ACTION_API,
  PRODUCTION_GPS_ARTIFACTS,
  SECOND_CUT_INSPECTOR_API,
  SECOND_CUT_CANDIDATE_APPLY_API,
  SECOND_CUT_CANDIDATE_FILE,
  SECOND_CUT_CANDIDATE_PREVIEW_API,
  SECOND_CUT_REVIEW_FILE,
  SECOND_CUT_REVIEW_MARKERS,
  SECOND_CUT_REVIEW_REGENERATE_API,
  SECOND_CUT_WATCH_NOTES_FILE,
  SECOND_CUT_WATCH_NOTES_SAVE_API,
  ROUGH_CUT_APPROVAL_VALUES,
  ROUGH_CUT_DERIVED_FILES,
  ROUGH_CUT_OPEN_API,
  ROUGH_CUT_REGENERATE_DERIVED_API,
  ROUGH_CUT_REVIEW_API,
  PUBLISH_GATE_DECISION_API,
  PUBLISH_GATE_APPROVE_API,
  PUBLISH_GATE_REJECT_API,
  PUBLISH_GATE_REVOKE_API,
  ROUGH_CUT_SAVE_API,
  ROUGH_CUT_STATUS_API,
  ROUGH_CUT_WATCH_NOTES_FILE,
  STATUS_API,
  applyCaptureEvidenceIntake,
  applyExportMasterRegistration,
  applyFinalCandidateRegistration,
  applySecondCutCandidateRegistration,
  aigenProductionPipelineStatus,
  attachPrestoStatus,
  buildCaptureEvidencePreview,
  buildEvidenceIntakePreview,
  buildEvidenceIntakeStatus,
  buildEditFixListMarkdown,
  buildGateTimeline,
  buildPickupListMarkdown,
  buildRoughCutStatus,
  buildSecondCutNextActionPacket,
  buildNextSafeAction: nextSafeActionScript.buildNextSafeAction,
  buildRoughCutWatchNotesMarkdown,
  buildOpenAIThumbnailPrompts,
  buildArtifactTrail,
  buildPostPublishLearningTemplate,
  captureEvidenceInputDefaults,
  createCandidates,
  createOpenAIThumbnailCandidates,
  createServer,
  createStatusResponse,
  createThumbnailResponse,
  currentFluxJobStatus,
  currentPrestoJobStatus,
  probeOllamaTags,
  buildProductionGps,
  buildProductionGpsTimeline,
  buildExportDeliveryConsole,
  buildExportMasterRegistration,
  buildExportChecklistFromDelivery,
  buildFinalCandidateRegistration,
  buildFinalReviewConsole,
  buildFinalReviewFromWatchNotes,
  buildSecondCutCandidatePreflight,
  buildSecondCutInspector,
  buildSecondCutPlacementChecklist,
  buildSecondCutCandidateRegistration,
  buildSecondCutReviewFromWatchNotes,
  cancelFluxJob,
  cancelPrestoJob,
  detectRoughCutCandidate,
  classifyPickupCategory,
  dashboardIndexStatus,
  discoverHyperframesCompositions,
  discoverPackageRunCandidates,
  discoverSecondCutMedia,
  findActivePackageRun,
  hyperframesRenderCommand,
  imageMimeType,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
  localWriteNonce,
  listFluxImages,
  makeDataUrl,
  missingRequiredCaptureFields,
  missingRequiredRoughCutFields,
  normalizeRoughCutFields,
  normalizePickupItem,
  normalizePickupItems,
  openPackageRunAssetFolder,
  openRoughCutVideo,
  ARTIFACT_TEXT_API,
  ARTIFACTS_LIST_API,
  OPEN_FILE_API,
  PACKAGE_RUN_ARTIFACT_TEXT_MAX_BYTES,
  resolvePackageRunTextFile,
  readPackageRunArtifactText,
  listPackageRunArtifacts,
  openPackageRunFile,
  parseHyperframesVersion,
  parseRoughCutReviewFile,
  parseRoughCutReviewStdout,
  parseFinalCandidateArtifact,
  parseFinalReviewFile,
  parseFinalWatchNotes,
  parseExportChecklistFile,
  parseMasterFileManifest,
  parseSecondCutCandidateArtifact,
  parseSecondCutReviewFile,
  parseSecondCutWatchNotes,
  probeHyperframesAvailability,
  providerConfig,
  regenerateRoughCutDerivedArtifacts,
  regenerateExportChecklistDerived,
  regenerateFinalReviewDerived,
  regenerateSecondCutReviewDerived,
  readPackageRunsIndex,
  resolvePackageRunOpenTarget,
  readFluxResults,
  readImagePrompts,
  readPackageVideoPrompts,
  readPrestoResults,
  parseLabelValueStdout,
  renderHyperframesComposition,
  resolveAigenPackageDir,
  resolveHyperframesCompositionFile,
  runResolveAssemblyCreate,
  runHyperframesRenderCommand,
  saveImagePrompts,
  validateImagePromptsPayload,
  validateImagePromptsForPackage,
  writeSelectedImages,
  startFluxPackageJob,
  startPrestoPackageJob,
  evaluatePrestoSubmitEligibility,
  prestoComfyuiReachable,
  normalizePrestoProfile,
  PRESTO_PROFILES,
  DEFAULT_PRESTO_PROFILE,
  gatherResolveReadiness,
  RESOLVE_READINESS_API,
  roughCutInputDefaults,
  runRoughCutReview,
  runFinalReview,
  runExportChecklist,
  runPublicationMetadata,
  runArchiveManifest,
  runPackageRunScript,
  safeJoin,
  saveRoughCutWatchNotes,
  saveDeliveryReadiness,
  saveEvidenceIntakeDraft,
  saveFinalWatchNotes,
  saveSecondCutWatchNotes,
  savePickupPlan,
  slugify,
  softDeletePackageRunCandidate,
  saveFinalOutline,
  setWorkflowPathForRun,
  readWorkflowPathForRun,
  generateShortsScripts,
  saveShortsScript,
  scriptCommitmentCheck,
  saveScriptCommitmentCheck,
  generateI2vPrompts,
  saveI2vPrompts,
  readProjectI2vContext,
  generateProjectI2vPrompts,
  saveProjectI2vPrompts,
  readProjectVideoReview,
  readProjectVideoVariants,
  readProjectMediaKit,
  readProjectYoutubeDraft,
  saveProjectYoutubeDraft,
  saveProjectVideoReview,
  callPrestoOllamaChat,
  buildMediaRoutingStatus,
  buildPackageMediaIndex,
  resolveProjectState,
  chooseNextTask,
  MEDIA_ROUTING_API,
  PACKAGE_MEDIA_INDEX_API,
  PROJECTS_LIST_API,
  PROJECT_STATE_API,
  PROJECT_IMPORT_MEDIA_API,
  PROJECT_STATUS_API,
  PROJECT_SCRIPT_API,
  PROJECT_SCRIPT_SAVE_DRAFT_API,
  PROJECT_SCRIPT_APPROVE_API,
  PROJECT_IMAGE_PROMPTS_GENERATE_API,
  PROJECT_I2V_PROMPTS_API,
  PROJECT_I2V_PROMPTS_GENERATE_API,
  PROJECT_I2V_PROMPTS_SAVE_API,
  PROJECT_VIDEO_REVIEW_API,
  PROJECT_VIDEO_VARIANTS_API,
  PROJECT_MEDIA_KIT_API,
  PROJECT_YOUTUBE_DRAFT_API,
  PROJECT_YOUTUBE_DRAFT_SAVE_API,
  SUPER_FOCUS_PROJECTS_API,
  SUPER_FOCUS_PROJECT_API,
  SUPER_FOCUS_PROVIDERS_API,
  SUPER_FOCUS_OLLAMA_BENCHMARK_API,
  SUPER_FOCUS_EVALUATE_SCRIPT_API,
  SUPER_FOCUS_SCRIPT_EVALUATION_API,
  SUPER_FOCUS_VISUAL_PLAN_API,
  SUPER_FOCUS_VISUAL_PLAN_READINESS_API,
  SUPER_FOCUS_PROMPTS_FROM_ASSIGNMENTS_API,
  SUPER_FOCUS_IMAGE_REVIEW_API,
  SUPER_FOCUS_VIDEO_REVIEW_API,
  SUPER_FOCUS_ATTEMPT_STORAGE_API,
  SUPER_FOCUS_VIDEO_QUEUE_AUDIT_API,
  SUPER_FOCUS_TITLE_API,
  SUPER_FOCUS_SCRIPT_API,
  SUPER_FOCUS_GENERATE_TOPIC_API,
  SUPER_FOCUS_GENERATE_SCRIPT_API,
  SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API,
  SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API,
  SUPER_FOCUS_GENERATE_INFOGRAPHIC_PROMPTS_API,
  SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API,
  SUPER_FOCUS_IMAGE_PROMPT_API,
  SUPER_FOCUS_INFOGRAPHIC_PROMPT_API,
  SUPER_FOCUS_GENERATE_IMAGES_API,
  SUPER_FOCUS_CLEAR_UNLINKED_PREVIEW_API,
  SUPER_FOCUS_CLEAR_UNLINKED_API,
  SUPER_FOCUS_IMAGES_STATUS_API,
  SUPER_FOCUS_IMAGES_CANCEL_API,
  SUPER_FOCUS_IMAGE_FILE_API,
  SUPER_FOCUS_GENERATE_I2V_PROMPT_API,
  SUPER_FOCUS_GENERATE_MISSING_I2V_PROMPTS_API,
  SUPER_FOCUS_I2V_PROMPT_API,
  SUPER_FOCUS_CLEAR_I2V_PROMPT_API,
  SUPER_FOCUS_CLEAR_IMAGE_API,
  SUPER_FOCUS_REGENERATE_IMAGE_API,
  SUPER_FOCUS_GENERATE_VIDEOS_API,
  SUPER_FOCUS_CLEAR_VIDEO_API,
  SUPER_FOCUS_REGENERATE_VIDEO_API,
  SUPER_FOCUS_VIDEOS_STATUS_API,
  SUPER_FOCUS_VIDEOS_CANCEL_API,
  SUPER_FOCUS_QUEUE_VIDEO_API,
  SUPER_FOCUS_QUEUE_MISSING_VIDEOS_API,
  SUPER_FOCUS_VIDEO_QUEUE_API,
  SUPER_FOCUS_VIDEO_QUEUE_PAUSE_API,
  SUPER_FOCUS_VIDEO_QUEUE_RESUME_API,
  SUPER_FOCUS_VIDEO_QUEUE_STOP_CURRENT_API,
  SUPER_FOCUS_CANCEL_QUEUED_VIDEO_API,
  SUPER_FOCUS_VIDEO_FILE_API,
  superFocus,
  superFocusPrompts,
  superFocusMedia,
  validateSuperFocusCount,
  startSuperFocusImageJob,
  startSuperFocusVideoJob,
  launchFluxHandoffJob,
  fluxDispatchPath,
  comfyCliResolvable,
  superFocusProviderStatus,
  assertScriptWideLegacyAllowed,
  buildClearUnlinkedPreview,
  launchPrestoProductionJob,
  EARTH_STUDIO_STATUS_API,
  EARTH_STUDIO_PLAN_API,
  EARTH_STUDIO_RENDER_API,
  EARTH_STUDIO_JOB_STATUS_API,
  EARTH_STUDIO_CANCEL_API,
  EARTH_STUDIO_STAGE_API,
  PROJECT_VIDEO_REVIEW_SAVE_API,
  IDEAS_TRIAGE_API,
  IDEAS_STATUS_API,
  IDEAS_PROMOTE_API,
  IDEAS_GENERATE_FROM_TOPIC_API,
  IDEAS_TOPIC_RUNS_API,
  IDEAS_TOPIC_RUN_API,
  OLLAMA_PRESTO_BASE_URL,
  OLLAMA_PRESTO_MODEL,
  uploadAigenImage,
  generateOneTopicCandidate,
  workflowGenerationEnv,
  generateBeginningTriageDraft,
  callOllamaChat,
  suggestSecondCutCandidateExportTarget,
  updatePackageRunCandidate,
  validatePackageRunId,
  validateCaptureEvidenceRunId,
  validateCaptureEvidenceTargets,
  validateHyperframesCompositionId,
  validateLocalWriteRequest,
  readJsonBody,
  writeHyperframesManifest,
};
