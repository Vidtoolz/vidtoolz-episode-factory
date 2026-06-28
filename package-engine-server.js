#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const packageRunDoctor = require('./scripts/package-run-doctor.js');
const roughCutReviewScript = require('./scripts/package-run-rough-cut-review.js');
const finalReviewScript = require('./scripts/package-run-final-review.js');
const exportChecklistScript = require('./scripts/package-run-export-checklist.js');
const publicationMetadataScript = require('./scripts/package-run-publication-metadata.js');
const archiveManifestScript = require('./scripts/package-run-archive-manifest.js');
const nextSafeActionScript = require('./scripts/package-run-next-safe-action.js');
const dailyIdeaScout = require('./scripts/daily-idea-scout.js');
const visualBeatMapParser = require('./scripts/visual-beat-map-parser.js');
const submittedTopics = require('./scripts/submitted-topics.js');
const remotionLane = require('./remotion-lane.js');
const packageEngineModel = require('./package-engine-model.js');
const workflowPathModel = require('./workflow-path.js');

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
const FINAL_REVIEW_API = '/api/package-runs/final-review';
const EXPORT_CHECKLIST_API = '/api/package-runs/export-checklist';
const PUBLICATION_METADATA_API = '/api/package-runs/publication-metadata';
const ARCHIVE_MANIFEST_API = '/api/package-runs/archive-manifest';
const ROUGH_CUT_SAVE_API = '/api/package-runs/rough-cut/watch-notes';
const ROUGH_CUT_REVIEW_API = '/api/package-runs/rough-cut/review';
const ROUGH_CUT_REGENERATE_DERIVED_API = '/api/package-runs/rough-cut/regenerate-derived';
const ROUGH_CUT_OPEN_API = '/api/package-runs/rough-cut/open';
const PACKAGE_RUNS_OPEN_API = '/api/package-runs/open';
const PICKUP_PLAN_SAVE_API = '/api/package-runs/pickup-plan/save';
const AIGEN_STATUS_API = '/api/aigen/production-pipeline/status';
const AIGEN_RESOLVE_ASSEMBLY_API = '/api/aigen/resolve-assembly/create';
const AIGEN_FLUX_IMAGES_API_PREFIX = '/api/aigen/flux-images/';
const AIGEN_SELECTED_IMAGES_API = '/api/aigen/selected-images';
const AIGEN_ASSETS_PREFIX = '/aigen-assets/';
const PRESTO_SUBMIT_API = '/api/presto/submit';
const PRESTO_JOB_STATUS_API = '/api/presto/job-status';
const PRESTO_CANCEL_API = '/api/presto/cancel';
const PRESTO_RESULTS_API = '/api/presto/results';
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
const SHORTS_SCRIPT_OPTIONS_API = '/api/shorts/script-options';
const SHORTS_SAVE_SCRIPT_API = '/api/shorts/save-script';
const SERVE_ROOT = ROOT;
const PACKAGE_RUNS_DIR = 'package-runs';
const VIDNAS_AIGEN_ROOT = '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen';
const VIDNAS_SCRIPT_PACKAGES = path.join(VIDNAS_AIGEN_ROOT, 'script-packages');
const VIDNAS_WAN_LANE = path.join(VIDNAS_AIGEN_ROOT, 'image-to-video', 'production', 'wan22-81f');
const PRESTO_BASE_URL = 'http://192.168.50.187:8188';
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
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
// Local Ollama LLM (no credentials, localhost only). Used for browser-local
// idea-triage drafting. Configurable via env so a different host/model can be used.
const OLLAMA_BASE_URL = String(process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || 'qwen3:14b');
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) > 0 ? Number(process.env.OLLAMA_TIMEOUT_MS) : 120000;
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

function slugify(value) {
  return String(value || 'thumbnail')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'thumbnail';
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

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownCell(value = '') {
  return String(value || '').trim().replace(/\r?\n/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ');
}

function markdownText(value = '', fallback = 'None reported.') {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return fallback;
  return text
    .split('\n')
    .map((line) => line.replace(/\|/g, '/').trimEnd())
    .join('\n');
}

function lineValue(markdown = '', label = '') {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(markdown || '').match(new RegExp(`^(?:[-*]\\s*)?${escaped}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
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
  const root = path.resolve(options.root || ROOT);
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
    error: result && result.status === 0 ? '' : (combined || (result && result.error && result.error.message) || 'HyperFrames CLI unavailable.'),
    checked_at: checkedAt,
  };
  hyperframesAvailabilityCache = { checkedAtMs: now, value };
  return value;
}

function hyperframesRenderCommand(sourcePath, outputPath) {
  // hyperframes 0.7.x renders a PROJECT DIR: `render <dir> -c <composition> -o <output>`.
  // The run's hyperframes/ dir is the project (it carries an index.html marker); the
  // composition is referenced relative to it. (Earlier `render <file> <output>` form was
  // incompatible with the installed CLI.)
  const projectDir = path.dirname(path.dirname(sourcePath));
  const compositionRel = path.relative(projectDir, sourcePath);
  return [...HYPERFRAMES_RENDER_COMMAND, projectDir, '-c', compositionRel, '-o', outputPath];
}

function runHyperframesRenderCommand(sourcePath, outputPath, logPath, options = {}) {
  const command = options.renderCommand || hyperframesRenderCommand(sourcePath, outputPath);
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
async function callOllamaChat({ system, user, schema, model } = {}, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const url = `${OLLAMA_BASE_URL}/api/chat`;
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
      signal: options.signal || AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    const detail = String((error && (error.message || (error.cause && error.cause.code))) || '');
    const refused = /ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET/i.test(detail);
    const message = timedOut
      ? `Ollama generation timed out after ${Math.ceil(OLLAMA_TIMEOUT_MS / 1000)}s. Try a smaller model via OLLAMA_MODEL.`
      : refused
      ? `Could not reach Ollama at ${OLLAMA_BASE_URL}. Is it running? Start it with: ollama serve`
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

// A selected image's package-facing staged video lives at videos/mp4/<index>.mp4
// (index zero-padded to 3 digits). This is package-scoped, unlike the global
// Wan lane completed.txt labels (e.g. "flux-001") which collide across packages.
function stagedMp4RelPath(promptIndex) {
  return path.posix.join('videos', 'mp4', `${String(promptIndex).padStart(3, '0')}.mp4`);
}

function packageStagedWanStatus(packageDir) {
  const selected = safeReadJson(path.join(packageDir, 'selected-images.json'), null);
  const selections = selected && Array.isArray(selected.selections) ? selected.selections : [];
  const items = selections.map((selection) => {
    const promptIndex = selectionPromptIndex(selection);
    const mp4Rel = promptIndex == null ? null : stagedMp4RelPath(promptIndex);
    const mp4Exists = Boolean(mp4Rel && fs.existsSync(path.join(packageDir, mp4Rel)));
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
    selections: items,
    selectionCount: items.length,
    completed,
    pending,
    completedLabels: completed.map((item) => item.label).filter(Boolean),
    completedCount: completed.length,
    pendingCount: pending.length,
  };
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
  const promptItems = imagePrompts && Array.isArray(imagePrompts.image_prompts) ? imagePrompts.image_prompts : [];
  const selections = selected && Array.isArray(selected.selections) ? selected.selections : [];
  // Wan completion is package-scoped: a selection is complete only when its
  // package-facing staged MP4 (videos/mp4/<index>.mp4) exists. Global Wan lane
  // labels are not package-unique, so they must not drive per-package counts.
  const staged = packageStagedWanStatus(packageDir);
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
    flux_images_count: fluxImagesCount,
    has_flux_manifest: fs.existsSync(fluxManifestPath),
    wan_completed: completed,
    wan_pending: pending,
    wan_failed: failed,
    resolve_handoff_ready: resolveHandoffCount === RESOLVE_HANDOFF_FILES.length,
    resolve_handoff_count: resolveHandoffCount,
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
  const active = packages.find((item) => item.wan_pending > 0) ||
    packages.find((item) => item.selections_count === 0 && item.flux_images_count > 0) ||
    packages.find((item) => item.flux_images_count < item.prompts_count);
  const nextAction = active
    ? `${active.wan_next_action} for ${active.id}`
    : 'No pending aigen production actions found';
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

function runResolveAssemblyCreate(packageId, options = {}) {
  const { packageId: id, packageDir, paths } = resolveAigenPackageDir(packageId, options);
  // Do not create Resolve assembly until every selected package MP4 exists.
  const staged = packageStagedWanStatus(packageDir);
  if (staged.selectionCount === 0 || staged.pendingCount > 0) {
    const missing = staged.pending.map((item) => item.mp4_rel || `selection ${item.prompt_index}`);
    return Promise.resolve({
      ok: false,
      package_id: id,
      error: staged.selectionCount === 0
        ? 'No selected images found; cannot create Resolve assembly.'
        : `Resolve assembly blocked: ${staged.pendingCount} selected image(s) have no staged MP4 yet (${missing.join(', ')}). Submit them to PRESTO first.`,
      pending_count: staged.pendingCount,
      missing_mp4: missing,
      exit_code: 1,
    });
  }
  if (!fs.existsSync(paths.topicToPackageScript)) {
    return Promise.resolve({
      ok: false,
      package_id: id,
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
        resolve({
          ok: true,
          package_id: id,
          files: RESOLVE_HANDOFF_FILES,
          existing_files: existingFiles,
          output_dir: resolveDir,
          stdout,
          stderr,
        });
        return;
      }
      resolve({
        ok: false,
        package_id: id,
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
      validateLocalWriteRequest(req, payload);
      return runResolveAssemblyCreate(payload.package_id);
    })
    .then((result) => {
      if (result.ok) {
        sendJSON(res, 200, result);
      } else {
        sendError(res, 400, result.error || 'Operation failed', null);
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
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function aigenAssetPath(packageId, relativePath) {
  const { packageDir } = resolveAigenPackageDir(packageId);
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
  const fluxDir = path.join(packageDir, 'images', 'flux-local');
  const promptsByIndex = loadImagePromptsByIndex(packageDir);
  const selectedData = safeReadJson(path.join(packageDir, 'selected-images.json'), null);
  const selected = selectedData ? selectedIndicesFromData(selectedData) : [];
  const images = safeDirEntries(fluxDir)
    .filter((entry) => entry.isFile() && /^flux-\d+\.png$/i.test(entry.name))
    .map((entry) => {
      const index = fluxIndexFromFilename(entry.name);
      const relative = `images/flux-local/${entry.name}`;
      const absolute = path.join(fluxDir, entry.name);
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(absolute).size; } catch (_) {}
      return {
        index,
        path: relative,
        absolute_path: absolute,
        asset_url: `${AIGEN_ASSETS_PREFIX}script-packages/${encodeURIComponent(id)}/images/flux-local/${encodeURIComponent(entry.name)}`,
        prompt: promptsByIndex.get(index) || '',
        label: path.basename(entry.name, path.extname(entry.name)),
        exists: fs.existsSync(absolute),
        size_bytes: sizeBytes,
      };
    })
    .sort((a, b) => a.index - b.index);
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
  const uniqueIndices = [...new Set(selectedIndices)];
  const selectedAt = new Date().toISOString();
  const selections = uniqueIndices.map((index) => {
    const filename = `flux-${String(index).padStart(3, '0')}.png`;
    const relative = `images/flux-local/${filename}`;
    const absolute = aigenAssetPath(id, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      const error = new Error(`Selected FLUX image does not exist for index ${index}: ${relative}`);
      error.statusCode = 400;
      throw error;
    }
    return {
      prompt_index: index,
      index,
      selected_source: 'flux-local',
      selected_path: relative,
      path: relative,
      prompt: promptsByIndex.get(index) || '',
      label: selectedLabel(index, Boolean(payload.labels)),
      generator: 'flux-local-vidnux',
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

function handleAigenAsset(req, res, url) {
  const raw = decodeURIComponent(url.pathname.slice(AIGEN_ASSETS_PREFIX.length));
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part.startsWith('.'))) {
    send(res, 403, 'Forbidden');
    return;
  }
  const assetPath = path.resolve(VIDNAS_AIGEN_ROOT, raw);
  const root = path.resolve(VIDNAS_AIGEN_ROOT);
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
  const args = [
    config.productionScript,
    '--package',
    config.packageId,
    '--comfyui-url',
    config.comfyuiUrl,
  ];
  const spawnFn = options.spawn || childProcess.spawn;
  const child = spawnFn(config.pythonBin, args, {
    cwd: path.dirname(config.productionScript),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const job = {
    process: child,
    packageId: config.packageId,
    comfyuiUrl: config.comfyuiUrl,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
  };
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
    package_id: config.packageId,
    comfyui_url: config.comfyuiUrl,
  };
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
  const staged = packageStagedWanStatus(packageDir);
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

function handlePrestoSubmit(req, res) {
  readJsonBody(req)
    .then((payload) => {
      validateLocalWriteRequest(req, payload);
      const result = startPrestoPackageJob(payload);
      sendJSON(res, 200, result);
    })
    .catch((error) => {
      if (error.statusCode === 409) {
        sendError(res, 409, error.message, null, { active: error.active });
        return;
      }
      sendError(res, error.statusCode || 500, error.message, null);
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
  const config = validateFluxSubmitPayload(payload, options);
  const args = [
    config.fluxScript,
    '--package',
    config.packageId,
  ];
  if (config.limit > 0) args.push('--limit', String(config.limit));
  if (config.skipExisting) args.push('--skip-existing');
  if (config.dryRun) args.push('--dry-run');
  const spawnFn = options.spawn || childProcess.spawn;
  const child = spawnFn(config.pythonBin, args, {
    cwd: path.dirname(config.fluxScript),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const job = {
    process: child,
    jobId: crypto.randomUUID(),
    packageId: config.packageId,
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
  const host = req && req.headers ? req.headers.host : '';
  const origin = req && req.headers ? req.headers.origin : '';
  if (!isAllowedLocalHost(host, port)) {
    const error = new Error('Capture evidence write API requires a local Host header.');
    error.statusCode = 403;
    throw error;
  }
  if (!isAllowedLocalOrigin(origin, port)) {
    const error = new Error('Capture evidence write API rejects non-local Origin headers.');
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
    const error = new Error('Capture evidence write API requires a valid local write nonce.');
    error.statusCode = 403;
    throw error;
  }
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
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

function createStatusResponse(env = process.env) {
  const config = providerConfig(env);
  return {
    ok: true,
    thumbnailProvider: config.provider,
    model: config.provider === 'openai' ? config.model : 'local-svg-placeholder',
    timeoutMs: config.timeoutMs,
    imageSize: config.size,
    quality: config.quality,
    format: config.outputFormat,
    api: API_PREFIX,
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

function buildOpenAIImageRequest(prompt, config) {
  const body = {
    model: config.model,
    prompt,
    n: 1,
    size: config.size,
  };

  if (config.model.startsWith('gpt-image')) {
    body.quality = config.quality;
    body.output_format = config.outputFormat;
  } else {
    body.response_format = 'b64_json';
  }

  return body;
}

function normalizeOpenAIImageResponse(data, prompt, idx, config, payload) {
  const image = data && Array.isArray(data.data) ? data.data[0] : null;
  if (!image) {
    throw new Error('OpenAI image generation returned no image data.');
  }
  const b64 = image.b64_json || image.b64;
  const url = image.url || '';
  const thumbnailImage = b64 ? `data:${imageMimeType(config.outputFormat)};base64,${b64}` : url;
  if (!thumbnailImage) {
    throw new Error('OpenAI image generation returned an unsupported response shape.');
  }
  const title = payload.topic || payload.thumbnailConcept || 'VIDTOOLZ thumbnail';
  return {
    id: `${slugify(title)}-openai-${idx + 1}`,
    label: `${title} OpenAI draft ${idx + 1}`,
    prompt,
    creator: `OpenAI / ${config.model}`,
    thumbnailImage,
  };
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

async function createOpenAIThumbnailCandidates(payload, options = {}) {
  const config = options.config || providerConfig(options.env || process.env);
  if (!config.apiKey) {
    const error = new Error('OPENAI_API_KEY is required when THUMBNAIL_PROVIDER=openai.');
    error.statusCode = 400;
    error.errorCode = 'missing_api_key';
    throw error;
  }
  const fetchImpl = options.fetchImpl || fetch;
  const prompts = buildOpenAIThumbnailPrompts(payload).slice(0, Number(payload.count || 3));
  const candidates = [];
  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_OPENAI_IMAGE_TIMEOUT_MS;

  // TODO: Persist generated image files under package-runs/<run-id>/thumbnail-candidates/.
  for (const [idx, prompt] of prompts.entries()) {
    let response;
    try {
      response = await fetchImpl(OPENAI_IMAGES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(buildOpenAIImageRequest(prompt, config)),
        signal: options.signal || AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      const message = timedOut
        ? `OpenAI image generation timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`
        : `OpenAI image generation request failed: ${error && error.message ? error.message : 'unknown network error'}`;
      const wrapped = new Error(message);
      wrapped.statusCode = timedOut ? 504 : 502;
      wrapped.errorCode = timedOut ? 'openai_timeout' : 'openai_request_failed';
      throw wrapped;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error && data.error.message ? data.error.message : `OpenAI image generation failed (${response.status}).`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.errorCode = 'openai_provider_error';
      throw error;
    }
    candidates.push(normalizeOpenAIImageResponse(data, prompt, idx, config, payload));
  }

  return candidates;
}

async function createThumbnailResponse(payload, options = {}) {
  const config = options.config || providerConfig(options.env || process.env);
  const startedAt = Date.now();
  const logger = options.logger === undefined ? console : options.logger;
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
  if (config.provider === 'openai') {
    try {
      const candidates = await createOpenAIThumbnailCandidates(payload, { ...options, config });
      if (!candidates.length) {
        const error = new Error('Thumbnail generation returned no usable candidates.');
        error.statusCode = 502;
        error.errorCode = 'no_usable_candidates';
        throw error;
      }
      logThumbnailRequest(config, 'success', startedAt, candidates.length, logger);
      return {
        provider: 'openai',
        model: config.model,
        timeoutMs: config.timeoutMs,
        imageSize: config.size,
        quality: config.quality,
        format: config.outputFormat,
        candidates,
      };
    } catch (error) {
      logThumbnailRequest(config, error.errorCode || 'error', startedAt, 0, logger);
      throw error;
    }
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

  sendJSON(res, 200, {
    runFolder,
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
          sendJSON(res, 200, {
            runId,
            title,
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

    if (req.method === 'GET' && url.pathname.startsWith(AIGEN_ASSETS_PREFIX)) {
      handleAigenAsset(req, res, url);
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
      handlePrestoSubmit(req, res);
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

  const server = createServer();

  server.listen(PORT, HOST, () => {
    console.log(`VIDTOOLZ Episode Factory server running at http://${HOST}:${PORT}/`);
    console.log(`Package Engine running at http://${HOST}:${PORT}/package-engine.html`);
  });
}

module.exports = {
  API_PREFIX,
  isResolveSafeFilename,
  DAILY_SCOUT_RUN_API,
  PACKAGE_RUNS_REINDEX_API,
  runDailyIdeaScoutNow,
  rebuildPackageRunsIndex,
  AIGEN_ASSETS_PREFIX,
  AIGEN_FLUX_IMAGES_API_PREFIX,
  AIGEN_RESOLVE_ASSEMBLY_API,
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
  IMAGE_PROMPTS_READ_API,
  IMAGE_PROMPTS_SAVE_API,
  IMAGE_PROMPTS_VALIDATE_API,
  PRESTO_CANCEL_API,
  PRESTO_JOB_STATUS_API,
  PRESTO_RESULTS_API,
  PRESTO_STATE,
  PRESTO_SUBMIT_API,
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
  buildOpenAIImageRequest,
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
  generateBeginningTriageDraft,
  callOllamaChat,
  suggestSecondCutCandidateExportTarget,
  updatePackageRunCandidate,
  validatePackageRunId,
  validateCaptureEvidenceRunId,
  validateCaptureEvidenceTargets,
  validateHyperframesCompositionId,
  validateLocalWriteRequest,
  writeHyperframesManifest,
};
