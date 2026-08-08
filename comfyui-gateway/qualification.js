'use strict';
// VIDTOOLZ ComfyUI Production Gateway — qualification records & drift guard.
//
// Qualification turns the registry's lifecycle label into EVIDENCE: a
// persistent record that this exact workflow (id + version + sha256) executed
// successfully against a known environment fingerprint and produced an
// artifact satisfying its technical contract. It is never an editorial
// statement — a LIVE_PASSED record means "renders correctly", not "looks good".
//
// Two separate axes, deliberately not overloaded onto one registry field:
//   registry lifecycle  — EXPERIMENTAL / TESTED / QUALIFIED / PRODUCTION /
//                         DEPRECATED (curated in git, unchanged by this module)
//   qualification evidence — NONE / STATIC_VERIFIED / LIVE_PASSED / STALE /
//                         FAILED (derived from records on disk + comparison)
//
// Records live under state/comfyui-qualification/<workflow-id>/ — local
// machine evidence, never committed (repo convention for state), written
// atomically. A FAILED attempt NEVER overwrites the last successful record.
//
// Bootstrap: workflows that were already PRODUCTION before this system existed
// have no records. That is LEGACY_PRODUCTION / QUALIFICATION_PENDING — a loud
// warning, never a dispatch block. Blocking starts only once evidence exists
// and authoritatively contradicts the current state (e.g. the workflow sha
// changed after its last qualification).
const fs = require('fs');
const path = require('path');
const provenance = require('./provenance.js');

const QUALIFICATION_SCHEMA_VERSION = 1;
const EVIDENCE_STATES = ['NONE', 'STATIC_VERIFIED', 'LIVE_PASSED', 'STALE', 'FAILED'];
const RESULTS = ['LIVE_PASSED', 'STATIC_VERIFIED', 'FAILED'];

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = path.join(REPO_ROOT, 'state', 'comfyui-qualification');

function rootDir(options = {}) {
  return options.qualificationRoot || DEFAULT_ROOT;
}

function workflowDir(workflowId, options = {}) {
  return path.join(rootDir(options), workflowId);
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

// ---- records --------------------------------------------------------------

function validateRecord(record) {
  const problems = [];
  if (!RESULTS.includes(record.result)) problems.push(`result must be one of ${RESULTS.join('/')}`);
  if (!record.workflow || !record.workflow.id || !Number.isInteger(record.workflow.version) || !/^[0-9a-f]{64}$/.test(record.workflow.sha256 || '')) {
    problems.push('workflow identity (id, version, sha256) required');
  }
  if (!record.environment_fingerprint || typeof record.environment_fingerprint !== 'object') {
    problems.push('environment_fingerprint required');
  }
  if (record.result === 'LIVE_PASSED') {
    if (!record.fixture || !record.fixture.id) problems.push('LIVE_PASSED requires fixture identity');
    if (!record.execution || !record.execution.job_id) problems.push('LIVE_PASSED requires execution.job_id');
    if (!record.output || !/^[0-9a-f]{64}$/.test(record.output.sha256 || '')) problems.push('LIVE_PASSED requires output sha256');
    if (!record.output || record.output.technical_validation !== 'passed') problems.push('LIVE_PASSED requires technical_validation: passed');
  }
  if (record.result === 'FAILED' && !record.failure) problems.push('FAILED requires failure diagnostics');
  return problems;
}

// Persist a qualification attempt. Every attempt lands in attempts/;
// LIVE_PASSED additionally updates latest-passed.json and STATIC_VERIFIED
// updates latest-static.json. FAILED never touches either latest pointer —
// known-good evidence is never destroyed by a failed attempt.
function writeQualificationRecord(record, options = {}) {
  const problems = validateRecord(record);
  if (problems.length) {
    const e = new Error(`invalid qualification record: ${problems.join('; ')}`);
    e.code = 'comfyui_qualification_record_invalid';
    throw e;
  }
  const dir = workflowDir(record.workflow.id, options);
  const attemptsDir = path.join(dir, 'attempts');
  fs.mkdirSync(attemptsDir, { recursive: true });
  const stampSource = record.execution && (record.execution.completed_at || record.execution.started_at);
  const stamp = (stampSource || new Date().toISOString()).replace(/[:.]/g, '-');
  const attemptPath = path.join(attemptsDir, `${stamp}-${record.result}.json`);
  provenance.writeJsonAtomic(attemptPath, record);
  const written = { attempt: attemptPath };
  if (record.result === 'LIVE_PASSED') {
    const latest = path.join(dir, 'latest-passed.json');
    provenance.writeJsonAtomic(latest, record);
    written.latest_passed = latest;
  } else if (record.result === 'STATIC_VERIFIED') {
    const latest = path.join(dir, 'latest-static.json');
    provenance.writeJsonAtomic(latest, record);
    written.latest_static = latest;
  }
  return written;
}

function readLatestPassed(workflowId, options = {}) {
  return readJsonSafe(path.join(workflowDir(workflowId, options), 'latest-passed.json'));
}

function readLatestStatic(workflowId, options = {}) {
  return readJsonSafe(path.join(workflowDir(workflowId, options), 'latest-static.json'));
}

function readLatestAttempt(workflowId, options = {}) {
  const attemptsDir = path.join(workflowDir(workflowId, options), 'attempts');
  let names = [];
  try { names = fs.readdirSync(attemptsDir).filter((n) => n.endsWith('.json')).sort(); } catch (_) { return null; }
  if (!names.length) return null;
  return readJsonSafe(path.join(attemptsDir, names[names.length - 1]));
}

// ---- fingerprint comparison ------------------------------------------------

// Per-component change classification. Identity strength is respected: a
// component whose only identity is class/filename presence can never claim
// verified_same at version level — it is present_but_identity_weak.
const SAME = 'verified_same';
const CHANGED = 'verified_changed';
const WEAK = 'present_but_identity_weak';
const MISSING = 'missing';
const UNAVAILABLE = 'unavailable';

function compareScalar(qualified, current) {
  if (qualified == null || current == null) return UNAVAILABLE;
  return qualified === current ? SAME : CHANGED;
}

function compareModel(q, c) {
  if (!c || c.present === false) return { classification: MISSING };
  const ql = q.identity || {}; const cl = c.identity || {};
  if (ql.sha256 && cl.sha256) {
    return { classification: ql.sha256 === cl.sha256 ? SAME : CHANGED, level: 'sha256' };
  }
  if (ql.level === 'filename_size_mtime' && cl.level === 'filename_size_mtime') {
    const same = ql.bytes === cl.bytes && ql.mtime === cl.mtime;
    return { classification: same ? SAME : CHANGED, level: 'filename_size_mtime' };
  }
  // strongest COMMON identity is the bare filename — its presence proves
  // nothing about content, so this can never report verified_same
  return { classification: WEAK, level: 'filename_only' };
}

function compareCustomNode(q, c) {
  if (!c || c.present === false) return { classification: MISSING };
  const ql = q.identity || {}; const cl = c.identity || {};
  if (ql.git_commit && cl.git_commit) {
    return { classification: ql.git_commit === cl.git_commit ? SAME : CHANGED, level: 'git_commit' };
  }
  if (ql.package_version && cl.package_version) {
    return { classification: ql.package_version === cl.package_version ? SAME : CHANGED, level: 'package_version' };
  }
  return { classification: WEAK, level: 'class_presence_only' };
}

// Compare the environment a workflow was qualified against with the currently
// observed environment. Returns { status, components, reasons, notes }:
//   status 'current' — nothing authoritative changed (weak identities noted)
//   status 'stale'   — an authoritative identity changed → requalify
//   status 'blocked' — a required dependency disappeared → production broken
function compareFingerprints(qualified, current) {
  const components = [];
  const reasons = [];
  const notes = [];

  function push(component, name, result, qualifiedValue, currentValue) {
    components.push({ component, name, ...result, qualified: qualifiedValue, current: currentValue });
    if (result.classification === CHANGED) reasons.push(`${component} ${name}: ${qualifiedValue} → ${currentValue}`);
    if (result.classification === MISSING) reasons.push(`${component} ${name}: missing from current environment`);
    if (result.classification === WEAK) notes.push(`${component} ${name}: identity ${result.level || 'weak'} — version-level change would be invisible (VERSION_NOT_AUTHORITATIVE)`);
  }

  push('workflow', qualified.workflow.id,
    { classification: compareScalar(qualified.workflow.sha256, (current.workflow || {}).sha256), level: 'sha256' },
    qualified.workflow.sha256 && qualified.workflow.sha256.slice(0, 16), current.workflow && current.workflow.sha256 && current.workflow.sha256.slice(0, 16));
  push('host', 'name',
    { classification: compareScalar((qualified.host || {}).name, (current.host || {}).name) },
    (qualified.host || {}).name, (current.host || {}).name);
  push('comfyui', 'version',
    { classification: compareScalar((qualified.comfyui || {}).version, (current.comfyui || {}).version), level: 'package_version' },
    (qualified.comfyui || {}).version, (current.comfyui || {}).version);
  if ((qualified.comfyui || {}).git_commit && (current.comfyui || {}).git_commit) {
    push('comfyui', 'git_commit',
      { classification: compareScalar(qualified.comfyui.git_commit, current.comfyui.git_commit), level: 'git_commit' },
      qualified.comfyui.git_commit.slice(0, 8), current.comfyui.git_commit.slice(0, 8));
  }
  push('gpu', 'name',
    { classification: compareScalar((qualified.gpu || {}).name, (current.gpu || {}).name) },
    (qualified.gpu || {}).name, (current.gpu || {}).name);

  const currentModels = new Map((current.models || []).map((m) => [`${m.class_type}:${m.name}`, m]));
  for (const q of qualified.models || []) {
    const c = currentModels.get(`${q.class_type}:${q.name}`);
    push('model', q.name, compareModel(q, c),
      (q.identity || {}).level, c ? (c.identity || {}).level : 'absent');
  }
  const currentNodes = new Map((current.custom_nodes || []).map((n) => [n.class, n]));
  for (const q of qualified.custom_nodes || []) {
    const c = currentNodes.get(q.class);
    push('custom_node', q.class, compareCustomNode(q, c),
      (q.identity || {}).git_commit || (q.identity || {}).package_version || (q.identity || {}).level,
      c ? ((c.identity || {}).git_commit || (c.identity || {}).package_version || (c.identity || {}).level) : 'absent');
  }

  const anyMissing = components.some((c) => c.classification === MISSING);
  const anyChanged = components.some((c) => c.classification === CHANGED);
  const status = anyMissing ? 'blocked' : anyChanged ? 'stale' : 'current';
  return { status, components, reasons, notes };
}

// ---- evaluation ------------------------------------------------------------

// Derive the evidence state for a registry entry from its records (and,
// when supplied, the currently observed fingerprint). Pure local reads.
function evaluateQualification(entry, options = {}) {
  const passed = readLatestPassed(entry.id, options);
  const staticRec = readLatestStatic(entry.id, options);
  const attempt = readLatestAttempt(entry.id, options);
  const out = {
    workflow: `${entry.id}@${entry.version}`,
    lifecycle: entry.qualification,
    evidence_state: 'NONE',
    last_qualified_at: null,
    latest_attempt: attempt ? { result: attempt.result, at: (attempt.execution || {}).completed_at || null, failure_class: attempt.failure ? attempt.failure.class : null } : null,
    reasons: [],
    notes: [],
  };
  if (!passed) {
    if (attempt && attempt.result === 'FAILED') {
      out.evidence_state = 'FAILED';
      out.reasons.push(`latest qualification attempt FAILED (${attempt.failure ? attempt.failure.class : 'unknown class'}) and no successful qualification exists`);
    } else if (staticRec) {
      out.evidence_state = 'STATIC_VERIFIED';
      out.last_qualified_at = (staticRec.execution || {}).completed_at || null;
      out.notes.push('static verification only — no live render evidence yet');
    } else {
      out.reasons.push('no qualification evidence yet — LEGACY_PRODUCTION / QUALIFICATION_PENDING (bootstrap)');
    }
    return out;
  }
  out.last_qualified_at = (passed.execution || {}).completed_at || null;
  out.qualified_environment = {
    host: ((passed.environment_fingerprint || {}).host || {}).name || null,
    comfyui_version: ((passed.environment_fingerprint || {}).comfyui || {}).version || null,
  };
  if (passed.workflow.sha256 !== entry.canonical_sha256) {
    out.evidence_state = 'STALE';
    out.reasons.push(`workflow graph changed after qualification (qualified sha ${passed.workflow.sha256.slice(0, 16)}…, registry sha ${String(entry.canonical_sha256).slice(0, 16)}…) — requalify`);
    return out;
  }
  if (options.currentFingerprint) {
    const cmp = compareFingerprints(passed.environment_fingerprint, options.currentFingerprint);
    out.environment_status = cmp.status;
    out.reasons.push(...cmp.reasons);
    out.notes.push(...cmp.notes);
    out.comparison = cmp;
    out.evidence_state = cmp.status === 'current' ? 'LIVE_PASSED' : 'STALE';
    return out;
  }
  out.evidence_state = 'LIVE_PASSED';
  if (attempt && attempt.result === 'FAILED') {
    const passedAt = (passed.execution || {}).completed_at || '';
    const attemptAt = (attempt.execution || {}).completed_at || '';
    if (attemptAt > passedAt) out.notes.push(`a LATER qualification attempt FAILED (${attempt.failure ? attempt.failure.class : '?'}) — last success preserved`);
  }
  return out;
}

// ---- production dispatch gate (synchronous, local-only) --------------------
//
// Runs inline in dispatch next to the drift gate, so it must stay cheap: it
// reads local records only, never the network. Live environment comparison
// belongs to the async preflight / upgrade guard surfaces.
//   no record            → bootstrap warning (never blocks legacy production)
//   record sha ≠ registry → QUALIFICATION_STALE block (drift override applies)
function qualifySyncGate(entry, options = {}) {
  const warnings = [];
  const override = options.driftOverride != null
    ? Boolean(options.driftOverride)
    : String(process.env.SUPER_FOCUS_COMFYUI_DRIFT_OVERRIDE || '') === '1';
  const passed = readLatestPassed(entry.id, options);
  if (!passed) {
    warnings.push(`QUALIFICATION_PENDING: ${entry.id}@${entry.version} has no live qualification evidence yet (legacy production — run: node scripts/comfyui-workflow-check.js ${entry.id} --qualify-render)`);
    return { warnings };
  }
  if (passed.workflow.sha256 !== entry.canonical_sha256) {
    const msg = `QUALIFICATION_STALE: ${entry.id}@${entry.version} was last qualified against workflow sha ${passed.workflow.sha256.slice(0, 16)}… but the registry now pins ${String(entry.canonical_sha256).slice(0, 16)}… — requalify (node scripts/comfyui-workflow-check.js ${entry.id} --qualify-render). No production render was submitted.`;
    if (!override) {
      const e = new Error(msg);
      e.statusCode = 409;
      e.code = 'comfyui_qualification_stale';
      throw e;
    }
    warnings.push(`DRIFT OVERRIDE ACTIVE: ${msg}`);
  }
  return { warnings };
}

// ---- upgrade guard ----------------------------------------------------------

// "If I update ComfyUI/custom nodes/models, which qualified workflows could be
// invalidated?" — compares each workflow's last qualified fingerprint against
// the currently observed one. Callers supply current fingerprints (the CLI
// collects them live; tests use synthetic ones).
function buildUpgradeReport(entries, currentFingerprintsById, options = {}) {
  const workflows = [];
  for (const entry of entries) {
    const passed = readLatestPassed(entry.id, options);
    const current = currentFingerprintsById[entry.id] || null;
    const row = { workflow: `${entry.id}@${entry.version}`, lifecycle: entry.qualification };
    if (!passed) {
      row.status = 'NO_QUALIFICATION_EVIDENCE';
      row.detail = 'nothing to compare — qualify first';
      workflows.push(row);
      continue;
    }
    if (!current) {
      row.status = 'CURRENT_ENVIRONMENT_UNAVAILABLE';
      row.detail = 'could not observe the live environment';
      workflows.push(row);
      continue;
    }
    const cmp = compareFingerprints(passed.environment_fingerprint, current);
    row.status = cmp.status === 'current' ? 'NO_RELEVANT_DRIFT'
      : cmp.status === 'stale' ? 'REQUALIFICATION_REQUIRED'
        : 'PRODUCTION_BLOCKED_DEPENDENCY_MISSING';
    row.qualified_at = (passed.execution || {}).completed_at || null;
    row.components = cmp.components;
    row.reasons = cmp.reasons;
    row.notes = cmp.notes;
    workflows.push(row);
  }
  return { workflows };
}

module.exports = {
  QUALIFICATION_SCHEMA_VERSION,
  EVIDENCE_STATES,
  RESULTS,
  DEFAULT_ROOT,
  rootDir,
  workflowDir,
  validateRecord,
  writeQualificationRecord,
  readLatestPassed,
  readLatestStatic,
  readLatestAttempt,
  compareFingerprints,
  evaluateQualification,
  qualifySyncGate,
  buildUpgradeReport,
};
