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
const permits = require('./permits.js');

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
    // two evidence sources: a canonical fixture render, or a real production
    // render backed by its immutable render-provenance manifest
    const isProduction = record.evidence_source === 'production_render';
    if (isProduction) {
      if (!record.render_provenance || !record.render_provenance.path) problems.push('production_render evidence requires a render_provenance reference');
    } else if (!record.fixture || !record.fixture.id) {
      problems.push('LIVE_PASSED requires fixture identity (or evidence_source: production_render with provenance)');
    }
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
  // production-derived records use their deterministic qualification_id as
  // the attempt filename — re-finalizing the same run is naturally idempotent
  const stampSource = record.execution && (record.execution.completed_at || record.execution.started_at);
  const stamp = (stampSource || new Date().toISOString()).replace(/[:.]/g, '-');
  const attemptBase = record.evidence_source === 'production_render' && record.qualification_id
    ? record.qualification_id
    : stamp;
  const attemptPath = path.join(attemptsDir, `${attemptBase}-${record.result}.json`);
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
  try { names = fs.readdirSync(attemptsDir).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
  if (!names.length) return null;
  // recency by file mtime — attempt basenames mix timestamps and
  // deterministic production qualification ids, so names don't sort by time
  const newest = names
    .map((n) => path.join(attemptsDir, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return readJsonSafe(newest);
}

// ---- fingerprint comparison ------------------------------------------------

// Per-component change classification. Identity strength is respected: a
// component whose only identity is class/filename presence can never claim
// verified_same at version level — it is present_but_identity_weak. And when
// the OBSERVER got stronger (historical evidence was filename_only, the
// current probe returns filename_size_mtime), the identities are not
// comparable: that is identity_strength_changed — a stronger observer is not
// itself proof of drift, so it never marks the environment stale; it is a
// requalification recommendation.
const SAME = 'verified_same';
const CHANGED = 'verified_changed';
const WEAK = 'present_but_identity_weak';
const STRENGTH_CHANGED = 'identity_strength_changed';
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
  if (ql.level !== cl.level) {
    return { classification: STRENGTH_CHANGED, level: `${ql.level || 'unknown'} → ${cl.level || 'unknown'}` };
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
  if ((ql.level || 'class_presence_only') !== (cl.level || 'class_presence_only')) {
    return { classification: STRENGTH_CHANGED, level: `${ql.level || 'unknown'} → ${cl.level || 'unknown'}` };
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
    if (result.classification === STRENGTH_CHANGED) notes.push(`${component} ${name}: identity strength changed (${result.level}) — not comparable, NOT proof of drift; requalification recommended to establish a strong baseline (EVIDENCE_WEAK)`);
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
  out.evidence_source = passed.evidence_source || 'canonical_fixture';
  out.execution_mode = (passed.execution || {}).execution_mode || null;
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
    // scoped requalification permit: bypasses ONLY this staleness block (the
    // drift/dependency gates already ran above and stay enforced), for the
    // exact workflow id+version+sha, with limited dispatches. This is how
    // the qualifying render itself gets through after a supervised upgrade.
    const permit = permits.findActivePermit(entry, options);
    if (permit) {
      const spent = permits.recordPermitDispatch(entry, options);
      warnings.push(`REQUALIFICATION PERMIT ACTIVE (${permit.permit_id}, session ${permit.upgrade_session_id || 'none'}): qualification staleness bypassed for this dispatch only — drift and dependency gates remain enforced (uses remaining: ${spent ? spent.uses_remaining : 0})`);
      return { warnings, permit: permit.permit_id };
    }
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

// ---- production-derived qualification ---------------------------------------
//
// A real production render can double as qualification evidence if and only
// if it satisfies the qualification contract — no dedicated smoke render
// needed. Eligibility is decided HERE, centrally, from the immutable render
// provenance manifest; nothing else in the codebase makes this call.

// Does a provenance output block satisfy the registry's technical contract?
function outputMeetsContract(output, expected) {
  const problems = [];
  if (!output || !/^[0-9a-f]{64}$/.test(output.sha256 || '')) problems.push('output sha256 missing');
  if (!expected) return { ok: problems.length === 0, problems };
  if (expected.width != null && output.width !== expected.width) problems.push(`width ${output.width} ≠ ${expected.width}`);
  if (expected.height != null && output.height !== expected.height) problems.push(`height ${output.height} ≠ ${expected.height}`);
  if (expected.fps != null && output.fps != null && Math.abs(output.fps - expected.fps) > 0.5) problems.push(`fps ${output.fps} ≠ ${expected.fps}`);
  if (expected.frames != null && output.frames != null && output.frames !== expected.frames) problems.push(`frames ${output.frames} ≠ ${expected.frames}`);
  if (expected.duration_seconds != null && output.duration_seconds != null) {
    const tol = expected.duration_tolerance_seconds || 0.25;
    if (Math.abs(output.duration_seconds - expected.duration_seconds) > tol) problems.push(`duration ${output.duration_seconds}s outside ${expected.duration_seconds}±${tol}s`);
  }
  return { ok: problems.length === 0, problems };
}

// Central eligibility evaluator: can this render provenance serve as
// LIVE_PASSED qualification evidence for this registry entry?
// Conservative by design — every requirement that fails adds a named reason,
// and a render that "merely produced an MP4" does not qualify.
function evaluateRenderForQualification({ entry, provenanceManifest, fingerprint }) {
  const reasons = [];
  if (!entry) reasons.push('registry_entry_missing');
  if (!provenanceManifest) {
    return { eligible: false, state: 'LIVE_RENDER_PENDING', reasons: ['render_provenance_missing'], execution_mode: 'unknown' };
  }
  const wf = provenanceManifest.workflow || {};
  if (entry && wf.sha256 !== entry.canonical_sha256) reasons.push('workflow_sha_mismatch');
  if (entry && wf.id !== entry.id) reasons.push('workflow_id_mismatch');
  if (entry && wf.version !== entry.version) reasons.push('workflow_version_mismatch');
  if (entry && !['QUALIFIED', 'PRODUCTION'].includes(entry.qualification)) reasons.push('workflow_lifecycle_not_production_allowed');

  const execution = provenanceManifest.execution || {};
  const executionMode = execution.execution_mode || 'unknown';
  if (!provenanceManifest.comfyui_prompt_id) reasons.push('comfyui_prompt_id_missing');
  if (executionMode !== 'executed') reasons.push(`execution_not_proven_live (mode: ${executionMode})`);
  if (execution.run_status !== 'verified') reasons.push(`run_not_verified (status: ${execution.run_status || 'unknown'})`);

  const contract = outputMeetsContract(provenanceManifest.output || {}, entry && entry.expected_output);
  if (!contract.ok) reasons.push(...contract.problems.map((p) => `output_contract: ${p}`));

  if (!fingerprint || !fingerprint.workflow) {
    reasons.push('environment_fingerprint_missing');
  } else {
    if (entry && fingerprint.workflow.sha256 !== entry.canonical_sha256) reasons.push('fingerprint_workflow_sha_mismatch');
    const missingDeps = [
      ...(fingerprint.models || []).filter((m) => m.present === false).map((m) => `model ${m.name}`),
      ...(fingerprint.custom_nodes || []).filter((n) => n.present === false).map((n) => `custom node ${n.class}`),
    ];
    if (missingDeps.length) reasons.push(`environment_dependency_missing: ${missingDeps.join(', ')}`);
  }

  return {
    eligible: reasons.length === 0,
    state: reasons.length === 0 ? 'LIVE_PASSED' : 'LIVE_RENDER_PENDING',
    reasons,
    execution_mode: executionMode,
  };
}

// Deterministic qualification identity for a production-derived record — the
// same run can never spawn duplicate evidence.
function productionQualificationId(entry, provenanceManifest) {
  return `qual-prod-${entry.id}-${provenanceManifest.job_id}`;
}

// Capture qualification evidence from one accepted production run dir.
// Idempotent; never throws for ineligibility (returns reasons); qualification
// persistence failure must never fail the render — callers log loudly.
function captureProductionQualification({ entry, runDir, provenancePath, fingerprint }, options = {}) {
  const manifestPath = provenancePath || path.join(runDir, provenance.WAN_PROVENANCE_FILENAME);
  const provenanceManifest = readJsonSafe(manifestPath);
  const verdict = evaluateRenderForQualification({ entry, provenanceManifest, fingerprint });
  if (!verdict.eligible) {
    return { captured: false, state: verdict.state, reasons: verdict.reasons, execution_mode: verdict.execution_mode };
  }
  const qualificationId = productionQualificationId(entry, provenanceManifest);
  const attemptPath = path.join(workflowDir(entry.id, options), 'attempts', `${qualificationId}-LIVE_PASSED.json`);
  if (fs.existsSync(attemptPath)) {
    return { captured: false, already_captured: true, qualification_id: qualificationId, record: readJsonSafe(attemptPath) };
  }
  const record = {
    schema_version: QUALIFICATION_SCHEMA_VERSION,
    qualification_id: qualificationId,
    result: 'LIVE_PASSED',
    evidence_source: 'production_render',
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    environment_fingerprint: fingerprint,
    fixture: null,
    production: {
      run_id: provenanceManifest.job_id,
      package_id: provenanceManifest.package_id || null,
      lane: (provenanceManifest.execution || {}).lane || null,
    },
    execution: {
      job_id: provenanceManifest.job_id,
      comfyui_prompt_id: provenanceManifest.comfyui_prompt_id || null,
      started_at: (provenanceManifest.execution || {}).created_at || null,
      completed_at: (provenanceManifest.execution || {}).completed_at || new Date().toISOString(),
      elapsed_seconds: (provenanceManifest.execution || {}).elapsed_seconds || null,
      execution_mode: verdict.execution_mode,
    },
    output: {
      path: (provenanceManifest.output || {}).path || null,
      sha256: (provenanceManifest.output || {}).sha256,
      bytes: (provenanceManifest.output || {}).bytes || null,
      width: (provenanceManifest.output || {}).width || null,
      height: (provenanceManifest.output || {}).height || null,
      media_type: entry.media_type,
      technical_validation: 'passed',
    },
    render_provenance: { path: manifestPath, sha256: provenance.sha256File(manifestPath) },
    generated_by: 'comfyui-gateway/qualification.js (production capture)',
  };
  const written = writeQualificationRecord(record, options);
  // a successful qualification retires any scoped requalification permit
  const consumedPermit = permits.consumePermit(entry, { qualificationId }, options);
  return { captured: true, qualification_id: qualificationId, record, written, permit_consumed: consumedPermit ? consumedPermit.permit_id : null };
}

// Capture across the provenance results a completed PRESTO job produced
// (the close hook's buildWanProvenanceForRunsSince outcome). Best-effort per
// run; failures are collected, never thrown.
function captureProductionQualificationForResults(results, { entry, fingerprint }, options = {}) {
  const captures = [];
  for (const r of results || []) {
    if (!r.path) continue;
    try {
      captures.push({ run: r.run || null, ...captureProductionQualification({ entry, provenancePath: r.path, fingerprint }, options) });
    } catch (err) {
      captures.push({ run: r.run || null, captured: false, error: String(err.message || err) });
    }
  }
  return captures;
}

// ---- upgrade guard ----------------------------------------------------------

// "If I update ComfyUI/custom nodes/models, which qualified workflows could be
// invalidated?" — compares each workflow's last qualified fingerprint against
// the currently observed one. Callers supply current fingerprints (the CLI
// collects them live; tests use synthetic ones).
function buildUpgradeReport(entries, currentFingerprintsById, options = {}) {
  const workflows = [];
  for (const entry of entries) {
    // comparison baseline: live-passed evidence preferred; a STATIC_VERIFIED
    // record still gives the guard an environment to compare against (its
    // weaker provenance is labeled, never hidden)
    const passed = readLatestPassed(entry.id, options);
    const staticRec = passed ? null : readLatestStatic(entry.id, options);
    const baseline = passed || staticRec;
    const current = currentFingerprintsById[entry.id] || null;
    const row = { workflow: `${entry.id}@${entry.version}`, lifecycle: entry.qualification };
    if (baseline) row.baseline = passed ? 'live_passed' : 'static_verified';
    if (!baseline) {
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
    const cmp = compareFingerprints(baseline.environment_fingerprint, current);
    row.status = cmp.status === 'current' ? 'NO_RELEVANT_DRIFT'
      : cmp.status === 'stale' ? 'REQUALIFICATION_REQUIRED'
        : 'PRODUCTION_BLOCKED_DEPENDENCY_MISSING';
    row.qualified_at = (baseline.execution || {}).completed_at || null;
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
  outputMeetsContract,
  evaluateRenderForQualification,
  productionQualificationId,
  captureProductionQualification,
  captureProductionQualificationForResults,
};
