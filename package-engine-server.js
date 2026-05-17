#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const packageRunDoctor = require('./scripts/package-run-doctor.js');
const roughCutReviewScript = require('./scripts/package-run-rough-cut-review.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8010);
const HOST = process.env.HOST || '127.0.0.1';
const API_PREFIX = '/api/package-engine/thumbnails';
const STATUS_API = '/api/package-engine/status';
const CAPTURE_EVIDENCE_PREVIEW_API = '/api/package-runs/capture-evidence/preview';
const CAPTURE_EVIDENCE_APPLY_API = '/api/package-runs/capture-evidence/apply';
const ROUGH_CUT_STATUS_API = '/api/package-runs/rough-cut/status';
const PRODUCTION_GPS_API = '/api/package-runs/production-gps';
const SECOND_CUT_INSPECTOR_API = '/api/package-runs/second-cut-inspector';
const SECOND_CUT_CANDIDATE_PREVIEW_API = '/api/package-runs/second-cut-candidate/preview';
const SECOND_CUT_CANDIDATE_APPLY_API = '/api/package-runs/second-cut-candidate/apply';
const SECOND_CUT_WATCH_NOTES_SAVE_API = '/api/package-runs/second-cut-watch-notes/save';
const SECOND_CUT_REVIEW_REGENERATE_API = '/api/package-runs/second-cut-review/regenerate-derived';
const ROUGH_CUT_SAVE_API = '/api/package-runs/rough-cut/watch-notes';
const ROUGH_CUT_REVIEW_API = '/api/package-runs/rough-cut/review';
const ROUGH_CUT_REGENERATE_DERIVED_API = '/api/package-runs/rough-cut/regenerate-derived';
const ROUGH_CUT_OPEN_API = '/api/package-runs/rough-cut/open';
const PICKUP_PLAN_SAVE_API = '/api/package-runs/pickup-plan/save';
const SERVE_ROOT = ROOT;
const PACKAGE_RUNS_DIR = 'package-runs';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_THUMBNAIL_PROVIDER = 'placeholder';
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';
const DEFAULT_OPENAI_IMAGE_SIZE = '1536x1024';
const DEFAULT_OPENAI_IMAGE_QUALITY = 'auto';
const DEFAULT_OPENAI_IMAGE_FORMAT = 'png';
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
const ROUGH_CUT_DERIVED_FILES = ['rough-cut-review.md', 'pickup-list.md', 'edit-fix-list.md'];
const SECOND_CUT_CANDIDATE_SECTION_START = '<!-- second-cut-candidate:start -->';
const SECOND_CUT_CANDIDATE_SECTION_END = '<!-- second-cut-candidate:end -->';
const SECOND_CUT_WATCH_NOTES_SECTION_START = '<!-- second-cut-watch-notes:start -->';
const SECOND_CUT_WATCH_NOTES_SECTION_END = '<!-- second-cut-watch-notes:end -->';
const SECOND_CUT_REVIEW_SECTION_START = '<!-- second-cut-review:start -->';
const SECOND_CUT_REVIEW_SECTION_END = '<!-- second-cut-review:end -->';
const PRODUCTION_GPS_ARTIFACTS = [
  'rough-cut-watch-notes.md',
  'second-cut-candidate.md',
  'second-cut-watch-notes.md',
  'final-watch-notes.md',
  'manual-approval-notes.md',
  'rough-cut-review.md',
  'second-cut-review.md',
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
const PICKUP_ITEM_TYPES = ['presenter closeup', 'AI B-roll', 'screen zoom', 'graphic', 'edit-only fix', 'other'];
const PICKUP_REQUIRED_VALUES = ['yes', 'no'];
const PICKUP_SOURCES = ['existing material', 'new recording', 'AI generation', 'editing only'];
const PICKUP_PURPOSES = ['clarify message', 'add human presence', 'visual variety', 'proof support', 'pacing', 'other'];
const PICKUP_STATUSES = ['proposed', 'accepted', 'rejected', 'done'];
const CAPTURE_EVIDENCE_SECTION_START = '<!-- capture-evidence-intake:start -->';
const CAPTURE_EVIDENCE_SECTION_END = '<!-- capture-evidence-intake:end -->';
const LOCAL_WRITE_NONCE = crypto.randomBytes(24).toString('hex');
const LOCAL_WRITE_NONCE_HEADER = 'x-vidtoolz-local-write-nonce';

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

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
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

function validateSecondCutCandidatePath(candidatePath) {
  const requested = markdownCell(candidatePath || '');
  if (!requested) {
    const error = new Error('Second-cut candidate path is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!path.isAbsolute(requested)) {
    const error = new Error('Second-cut candidate path must be an absolute path.');
    error.statusCode = 400;
    throw error;
  }
  const absolute = path.resolve(requested);
  if (!MEDIA_FILE_PATTERN.test(absolute)) {
    const error = new Error('Unsupported second-cut candidate extension.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(absolute)) {
    const error = new Error('Second-cut candidate file does not exist.');
    error.statusCode = 404;
    throw error;
  }
  if (!fs.statSync(absolute).isFile()) {
    const error = new Error('Second-cut candidate path must be a file.');
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
  if (/^(rough-cut-watch-notes|final-watch-notes|manual-approval-notes|second-cut-candidate|second-cut-watch-notes)\.md$/i.test(filename)) return 'source / human-authored';
  if (/^(package-run-state\.md|package-runs-index\.json)$/i.test(filename)) return 'state / lifecycle';
  if (/^(rough-cut-review|second-cut-review|pickup-list|edit-fix-list|capture-evidence-review|export-checklist|publish-metadata-review)\.md$/i.test(filename)) return 'derived / generated';
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
  const gate = doctor.lifecycleGate || {};
  const artifactTrail = buildArtifactTrail(resolved);
  const gateTimeline = buildProductionGpsTimeline(doctor, roughCutResult);
  const currentTimelineGate = gateTimeline.find((item) => item.current) || gateTimeline.find((item) => item.status === 'blocked' || item.status === 'needs human review' || item.status === 'needs artifact') || gateTimeline[0];
  const roughNeedsPickups = roughCutResult.roughCutReviewStatus === 'NEEDS PICKUPS';
  const roughNeedsEditFixes = roughCutResult.roughCutReviewStatus === 'NEEDS EDIT FIXES';
  const registeredCandidateReadyForReview = secondCutInspector.candidateStatus === 'found_needs_review' && secondCutInspector.registeredCandidate && secondCutInspector.registeredCandidate.exists;
  const secondCutStatus = secondCutInspector.secondCutReviewStatus || '';
  const currentGate = registeredCandidateReadyForReview
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
    registeredCandidateReadyForReview && secondCutStatus === 'READY FOR SECOND CUT' && secondCutInspector.secondCutReady
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

function buildRoughCutStatus(payload = {}, options = {}) {
  const resolved = resolveRunFromPayload(payload, options);
  const runInput = `${PACKAGE_RUNS_DIR}/${resolved.runId}`;
  const doctor = packageRunDoctor.buildDoctorReport(runInput, { repoRoot: resolved.root });
  const roughCutCandidate = detectRoughCutCandidate(resolved.runDir);
  const roughCutResult = parseRoughCutReviewFile(resolved.runDir);
  const indexStatus = dashboardIndexStatus(resolved);
  const productionGps = buildProductionGps(payload, options);
  const secondCutInspector = buildSecondCutInspector(payload, options);
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
    productionGps,
    secondCutInspector,
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
  return {
    provider: String(env.THUMBNAIL_PROVIDER || DEFAULT_THUMBNAIL_PROVIDER).toLowerCase(),
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL,
    size: env.OPENAI_IMAGE_SIZE || DEFAULT_OPENAI_IMAGE_SIZE,
    quality: env.OPENAI_IMAGE_QUALITY || DEFAULT_OPENAI_IMAGE_QUALITY,
    outputFormat: env.OPENAI_IMAGE_FORMAT || DEFAULT_OPENAI_IMAGE_FORMAT,
  };
}

function createStatusResponse(env = process.env) {
  const config = providerConfig(env);
  return {
    ok: true,
    thumbnailProvider: config.provider,
    model: config.provider === 'openai' ? config.model : 'local-svg-placeholder',
    api: API_PREFIX,
    captureEvidenceWrite: {
      previewApi: CAPTURE_EVIDENCE_PREVIEW_API,
      applyApi: CAPTURE_EVIDENCE_APPLY_API,
      nonceHeader: LOCAL_WRITE_NONCE_HEADER,
      localWriteNonce: LOCAL_WRITE_NONCE,
      allowedHosts: [`127.0.0.1:${PORT}`, `localhost:${PORT}`],
      missingOriginAllowed: true,
    },
    roughCutInputConsole: {
      statusApi: ROUGH_CUT_STATUS_API,
      productionGpsApi: PRODUCTION_GPS_API,
      secondCutInspectorApi: SECOND_CUT_INSPECTOR_API,
      secondCutCandidatePreviewApi: SECOND_CUT_CANDIDATE_PREVIEW_API,
      secondCutCandidateApplyApi: SECOND_CUT_CANDIDATE_APPLY_API,
      secondCutWatchNotesSaveApi: SECOND_CUT_WATCH_NOTES_SAVE_API,
      secondCutReviewRegenerateApi: SECOND_CUT_REVIEW_REGENERATE_API,
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
      derivedOnlyWriteFiles: ROUGH_CUT_DERIVED_FILES,
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

async function createOpenAIThumbnailCandidates(payload, options = {}) {
  const config = options.config || providerConfig(options.env || process.env);
  if (!config.apiKey) {
    const error = new Error('OPENAI_API_KEY is required when THUMBNAIL_PROVIDER=openai.');
    error.statusCode = 400;
    throw error;
  }
  const fetchImpl = options.fetchImpl || fetch;
  const prompts = buildOpenAIThumbnailPrompts(payload).slice(0, Number(payload.count || 3));
  const candidates = [];

  // TODO: Persist generated image files under package-runs/<run-id>/thumbnail-candidates/.
  for (const [idx, prompt] of prompts.entries()) {
    const response = await fetchImpl(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildOpenAIImageRequest(prompt, config)),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error && data.error.message ? data.error.message : `OpenAI image generation failed (${response.status}).`;
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }
    candidates.push(normalizeOpenAIImageResponse(data, prompt, idx, config, payload));
  }

  return candidates;
}

async function createThumbnailResponse(payload, options = {}) {
  const config = options.config || providerConfig(options.env || process.env);
  if (config.provider === 'placeholder') {
    return {
      provider: 'placeholder',
      model: 'local-svg-placeholder',
      candidates: createCandidates(payload),
    };
  }
  if (config.provider === 'openai') {
    return {
      provider: 'openai',
      model: config.model,
      candidates: await createOpenAIThumbnailCandidates(payload, { ...options, config }),
    };
  }
  const error = new Error(`Unsupported THUMBNAIL_PROVIDER: ${config.provider}`);
  error.statusCode = 400;
  throw error;
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === STATUS_API) {
      send(res, 200, createStatusResponse());
      return;
    }

    if (req.method === 'POST' && url.pathname === API_PREFIX) {
      readJsonBody(req).then(async (payload) => {
        try {
          const thumbnailResponse = await createThumbnailResponse(payload);
          send(res, 200, thumbnailResponse);
        } catch (error) {
          send(res, error.statusCode || 500, { error: error.message });
        }
      }).catch((error) => send(res, error.statusCode || 500, { error: error.message }));
      return;
    }

    if (req.method === 'POST' && url.pathname === CAPTURE_EVIDENCE_PREVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, buildCaptureEvidencePreview(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message, missing: error.missing || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === CAPTURE_EVIDENCE_APPLY_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, applyCaptureEvidenceIntake(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message, missing: error.missing || [] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === ROUGH_CUT_STATUS_API) {
      try {
        send(res, 200, buildRoughCutStatus({ runId: url.searchParams.get('runId') || '' }));
      } catch (error) {
        send(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === PRODUCTION_GPS_API) {
      try {
        send(res, 200, buildProductionGps({ runId: url.searchParams.get('runId') || '' }));
      } catch (error) {
        send(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === SECOND_CUT_INSPECTOR_API) {
      try {
        send(res, 200, buildSecondCutInspector({ runId: url.searchParams.get('runId') || '' }));
      } catch (error) {
        send(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === SECOND_CUT_CANDIDATE_PREVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, buildSecondCutCandidateRegistration(payload, { mode: 'preview' }));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message }));
      return;
    }

    if (req.method === 'POST' && url.pathname === SECOND_CUT_CANDIDATE_APPLY_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, applySecondCutCandidateRegistration(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message }));
      return;
    }

    if (req.method === 'POST' && url.pathname === SECOND_CUT_WATCH_NOTES_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, saveSecondCutWatchNotes(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message }));
      return;
    }

    if (req.method === 'POST' && url.pathname === SECOND_CUT_REVIEW_REGENERATE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, regenerateSecondCutReviewDerived(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message }));
      return;
    }

    if (req.method === 'POST' && url.pathname === ROUGH_CUT_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, saveRoughCutWatchNotes(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message, missing: error.missing || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === ROUGH_CUT_REVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          const output = runRoughCutReview(payload);
          send(res, output.ok ? 200 : 500, output);
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message, missing: error.missing || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === ROUGH_CUT_REGENERATE_DERIVED_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, regenerateRoughCutDerivedArtifacts(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message, missing: error.missing || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === ROUGH_CUT_OPEN_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, openRoughCutVideo(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message }));
      return;
    }

    if (req.method === 'POST' && url.pathname === PICKUP_PLAN_SAVE_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, savePickupPlan(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message, missing: error.missing || [] }));
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
          fs.createReadStream(index).pipe(res);
          return;
        }
        send(res, 404, 'Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': inferMime(filePath), 'Cache-Control': 'no-store' });
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

if (require.main === module) {
  const server = createServer();

  server.listen(PORT, HOST, () => {
    console.log(`VIDTOOLZ Episode Factory server running at http://${HOST}:${PORT}/`);
    console.log(`Package Engine running at http://${HOST}:${PORT}/package-engine.html`);
  });
}

module.exports = {
  API_PREFIX,
  CAPTURE_EVIDENCE_APPLY_API,
  CAPTURE_EVIDENCE_PREVIEW_API,
  CAPTURE_EVIDENCE_AUDIT_FILE,
  CAPTURE_EVIDENCE_TARGETS,
  LOCAL_WRITE_NONCE_HEADER,
  PICKUP_ITEM_TYPES,
  PICKUP_PLAN_SAVE_API,
  PICKUP_PURPOSES,
  PICKUP_REQUIRED_VALUES,
  PICKUP_SOURCES,
  PICKUP_STATUSES,
  PRODUCTION_GPS_API,
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
  applySecondCutCandidateRegistration,
  buildCaptureEvidencePreview,
  buildEditFixListMarkdown,
  buildGateTimeline,
  buildPickupListMarkdown,
  buildRoughCutStatus,
  buildRoughCutWatchNotesMarkdown,
  buildOpenAIImageRequest,
  buildOpenAIThumbnailPrompts,
  buildArtifactTrail,
  captureEvidenceInputDefaults,
  createCandidates,
  createOpenAIThumbnailCandidates,
  createServer,
  createStatusResponse,
  createThumbnailResponse,
  buildProductionGps,
  buildProductionGpsTimeline,
  buildSecondCutInspector,
  buildSecondCutPlacementChecklist,
  buildSecondCutCandidateRegistration,
  buildSecondCutReviewFromWatchNotes,
  detectRoughCutCandidate,
  classifyPickupCategory,
  dashboardIndexStatus,
  discoverSecondCutMedia,
  findActivePackageRun,
  imageMimeType,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
  localWriteNonce,
  makeDataUrl,
  missingRequiredCaptureFields,
  missingRequiredRoughCutFields,
  normalizeRoughCutFields,
  normalizePickupItem,
  normalizePickupItems,
  openRoughCutVideo,
  parseRoughCutReviewFile,
  parseRoughCutReviewStdout,
  parseSecondCutCandidateArtifact,
  parseSecondCutReviewFile,
  parseSecondCutWatchNotes,
  providerConfig,
  regenerateRoughCutDerivedArtifacts,
  regenerateSecondCutReviewDerived,
  roughCutInputDefaults,
  runRoughCutReview,
  safeJoin,
  saveRoughCutWatchNotes,
  saveSecondCutWatchNotes,
  savePickupPlan,
  slugify,
  validatePackageRunId,
  validateCaptureEvidenceRunId,
  validateCaptureEvidenceTargets,
  validateLocalWriteRequest,
};
