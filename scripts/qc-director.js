#!/usr/bin/env node
'use strict';

// QC DIRECTOR V1 — independent production-quality authority.
//
// QC Director inspects a candidate production artifact together with the
// durable evidence produced ABOUT it, and issues an independent disposition.
// It is deliberately NOT a creator and NOT a repairer:
//
//   * It never modifies the artifact it evaluates (mutation-safe by design).
//   * It never recomputes a producing department's work. It consumes the
//     department's durable result and judges the evidence.
//   * It never fabricates PASS. Missing, malformed, stale, unbound or
//     unsupported evidence fails closed as BLOCKED.
//   * It never claims aesthetic approval. Taste remains Mikko's authority;
//     QC can only observe a durable human-authority artifact.
//
// Independence doctrine: creator != validator. A department emitting its own
// internal checks does not become its own final quality authority. QC consumes
// those checks as evidence and owns the independent synthesis.
//
// Usage:
//   node scripts/qc-director.js --task <qc-task.json> [--out <qc-result.json>]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { guardExecutableLifecycle } = require('./agent-executable-boundary.js');
const contractValidator = require('./agent-contract-validator.js');
const approvalScopes = require('./approval-scopes.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const AGENT_ID = 'qc_director';
const QC_SCHEMA_VERSION = 1;
const QC_DIRECTOR_VERSION = 'qc-director-v1';
const ACTIONS = Object.freeze(['inspect_artifact', 'status']);

// The authoritative 14-gate lifecycle (scripts/package-run-workflow-map.js
// GATE_DEFINITIONS). QC needs the gate IDENTITIES only, so it does not pull in
// the whole workflow engine — that module reaches into package-run indexing and
// would drag production state into a read-only validator. Drift between this
// list and the authoritative definitions is a test failure, not a silent
// divergence: see tests/qc-director.test.js "uses only the authoritative
// 14-gate model". QC never consults the legacy 21-stage pipeline tracker.
const CANONICAL_GATES = Object.freeze([
  'package-selection', 'research', 'script-structure', 'script-review',
  'production-plan', 'shot-edit-plan-review', 'capture-checklist',
  'capture-evidence', 'rough-cut-review', 'final-review', 'export-check',
  'publication-metadata', 'archive', 'repurposing',
]);

// ── canonical vocabularies ────────────────────────────────────────────────
const DISPOSITIONS = Object.freeze([
  'PASS', 'PASS_WITH_WARNINGS', 'HUMAN_REVIEW_REQUIRED', 'FAIL', 'BLOCKED',
]);
const SEVERITIES = Object.freeze(['BLOCKER', 'ERROR', 'WARNING', 'INFO']);
const EVIDENCE_CLASSES = Object.freeze(['DETERMINISTIC', 'SPECIALIST', 'HUMAN', 'UNVERIFIED']);

// Only these dispositions permit the next production gate to proceed.
const NEXT_GATE_ALLOWED = Object.freeze(['PASS', 'PASS_WITH_WARNINGS']);

// Quality dimensions QC structurally refuses to adjudicate. Presence of a
// dimension here is a hard fence: no evidence class except a durable human
// authority artifact can settle it.
const AESTHETIC_DIMENSIONS = Object.freeze([
  'beauty', 'cinematic_quality', 'humour', 'emotional_effect',
  'taste', 'pacing_feel', 'title_appeal', 'music_fit',
]);

const TASK_FIELDS = Object.freeze([
  'task_id', 'action', 'assignment', 'package_run_id', 'project_id', 'requested_by',
  'gate', 'subject', 'evidence', 'required_evidence', 'human_authority',
  'privacy', 'deadline', 'declared_exceptions', 'previous_qc_result',
]);
const SUBJECT_FIELDS = Object.freeze([
  'artifact_id', 'artifact_type', 'producing_agent', 'artifact_path',
  'artifact_sha256', 'version_id', 'predecessor_version_id',
]);
const EVIDENCE_FIELDS = Object.freeze([
  'evidence_id', 'kind', 'evidence_class', 'produced_by', 'path', 'sha256',
  'binds_to', 'payload',
]);
const BINDS_TO_FIELDS = Object.freeze(['artifact_id', 'artifact_sha256', 'version_id']);

// Gates whose completion depends on human creative authority. QC may report
// technical readiness for these but must never self-certify them.
const HUMAN_AUTHORITY_GATES = Object.freeze({
  'rough-cut-review': 'FINAL_CUT_APPROVAL',
  'final-review': 'FINAL_CUT_APPROVAL',
  'publication-metadata': 'TITLE_THUMBNAIL_APPROVAL',
});

// Remediation owner per producing department. QC routes failures back to the
// producer; it never repairs and never routes work to itself.
const REMEDIATION_OWNER = Object.freeze({
  camera_director: 'camera_director',
  generation_supervisor: 'generation_supervisor',
  editor: 'editor',
  sound_music_director: 'sound_music_director',
  story_editor: 'story_editor',
  research_director: 'research_director',
  visual_planning_director: 'visual_planning_director',
  audience_packaging_director: 'audience_packaging_director',
  production_operations: 'production_operations',
});

class QCInputError extends Error {
  constructor(code, message) { super(message); this.name = 'QCInputError'; this.code = code; }
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  return value;
}

function strictObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QCInputError('QC_TASK_INVALID', `${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new QCInputError('QC_TASK_INVALID', `${label} unknown field ${unknown[0]}`);
}

function containedWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

// Path safety: every declared path must resolve inside the repository and must
// be a regular file. Traversal, absolute escapes and symlinks are refused as
// input errors, never silently downgraded to "evidence missing".
function safeRepoPath(candidate, label, repoRoot = REPO_ROOT) {
  if (typeof candidate !== 'string' || !candidate) {
    throw new QCInputError('QC_PATH_INVALID', `${label} must be a non-empty string`);
  }
  if (candidate.includes('\0')) throw new QCInputError('QC_PATH_INVALID', `${label} contains a null byte`);
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, candidate);
  if (!containedWithin(root, resolved)) {
    throw new QCInputError('QC_PATH_ESCAPE', `${label} resolves outside the repository root`);
  }
  return resolved;
}

function readFileIfPresent(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(filePath);
  } catch (_error) { return null; }
}

function defect({ code, severity, source, artifact_id = null, explanation, evidence_ref = null,
  affected_gate = null, auto_repairable = false, human_judgment_required = false }) {
  if (!SEVERITIES.includes(severity)) throw new QCInputError('QC_SEVERITY_INVALID', `unknown severity ${severity}`);
  return {
    code, severity, source, artifact_id, explanation, evidence_ref,
    affected_gate, auto_repairable, human_judgment_required,
  };
}

// ── evidence adapters ─────────────────────────────────────────────────────
// Each adapter normalizes one department's DURABLE result schema. Adapters
// read persisted results only; they never import or re-run a producer module.
// An adapter that does not recognize the schema version fails closed.

function cameraQualityAdapter(payload, context) {
  // Consumes the durable earth-studio camera-quality.json result. Earth Studio
  // implementation is owned elsewhere; QC treats this artifact as a read-only
  // interface and never recomputes a trajectory.
  if (payload?.schema_version !== 1) return unsupportedSchema('CAMERA_QUALITY', payload, context);
  const verdict = String(payload.verdict || '');
  if (!['PASS_FOR_HUMAN_REVIEW', 'FAIL'].includes(verdict)) {
    return unsupportedSchema('CAMERA_QUALITY', payload, context, `unknown verdict ${verdict || '(absent)'}`);
  }
  const defects = [];
  const warnings = [];
  for (const error of payload.errors || []) {
    defects.push(defect({
      code: 'CAMERA_QUALITY_DEFECT', severity: 'ERROR', source: 'camera_director',
      artifact_id: context.artifactId, explanation: String(error),
      evidence_ref: context.evidenceId, affected_gate: context.gate, auto_repairable: false,
    }));
  }
  for (const warning of payload.warnings || []) {
    warnings.push(defect({
      code: 'CAMERA_QUALITY_WARNING', severity: 'WARNING', source: 'camera_director',
      artifact_id: context.artifactId, explanation: String(warning),
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  if (verdict === 'FAIL' && !defects.length) {
    defects.push(defect({
      code: 'CAMERA_QUALITY_DEFECT', severity: 'ERROR', source: 'camera_director',
      artifact_id: context.artifactId, explanation: 'camera-quality verdict is FAIL',
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  return {
    schema_supported: true, defects, warnings,
    // The artifact states its own scope: machine continuity, not aesthetics.
    // A machine PASS therefore leaves the visual judgement open.
    human_review_required: verdict === 'PASS_FOR_HUMAN_REVIEW',
    human_review_reason: verdict === 'PASS_FOR_HUMAN_REVIEW'
      ? 'camera-quality is a machine continuity check and explicitly not an aesthetic approval'
      : null,
    summary: { verdict, errors: (payload.errors || []).length, warnings: (payload.warnings || []).length },
  };
}

function generationAdapter(payload, context) {
  // Consumes the Generation Supervisor status envelope.
  if (payload?.schema_version !== 1) return unsupportedSchema('GENERATION_RESULT', payload, context);
  const state = String(payload.state || '');
  const defects = [];
  const warnings = [];
  if (!state) return unsupportedSchema('GENERATION_RESULT', payload, context, 'generation state absent');
  if (state !== 'COMPLETE') {
    defects.push(defect({
      code: 'GENERATION_NOT_COMPLETE', severity: 'ERROR', source: 'generation_supervisor',
      artifact_id: context.artifactId,
      explanation: `generation state is ${state}: ${payload.reason || 'no reason recorded'}`,
      evidence_ref: context.evidenceId, affected_gate: context.gate,
      auto_repairable: payload.retry?.retry_allowed === true,
    }));
  }
  const outputs = Array.isArray(payload.outputs) ? payload.outputs : [];
  if (state === 'COMPLETE' && !outputs.length) {
    defects.push(defect({
      code: 'GENERATION_OUTPUT_ABSENT', severity: 'BLOCKER', source: 'generation_supervisor',
      artifact_id: context.artifactId,
      explanation: 'generation reports COMPLETE but records no output artifact',
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  if (!payload.provenance) {
    defects.push(defect({
      code: 'GENERATION_PROVENANCE_ABSENT', severity: 'BLOCKER', source: 'generation_supervisor',
      artifact_id: context.artifactId,
      explanation: 'generation result carries no provenance block; route and model identity are unproven',
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  return {
    schema_supported: true, defects, warnings,
    human_review_required: false, human_review_reason: null,
    summary: { state, outputs: outputs.length, has_provenance: Boolean(payload.provenance) },
  };
}

function editAdapter(payload, context) {
  // Consumes the Editor's canonical qc_handoff artifact (edit-plan.js).
  if (payload?.artifact_type !== 'edit-plan-qc-handoff') {
    return unsupportedSchema('EDIT_QC_HANDOFF', payload, context, 'artifact_type is not edit-plan-qc-handoff');
  }
  const defects = [];
  const warnings = [];
  if (!payload.edit_plan_digest_sha256) {
    defects.push(defect({
      code: 'EDIT_DIGEST_ABSENT', severity: 'BLOCKER', source: 'editor',
      artifact_id: context.artifactId, explanation: 'edit plan digest absent; edit identity is unverifiable',
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  for (const finding of payload.findings || []) {
    const text = typeof finding === 'string' ? finding : (finding.explanation || finding.code || JSON.stringify(finding));
    const severity = String(finding?.severity || 'ERROR').toUpperCase();
    const record = defect({
      code: 'EDIT_TIMELINE_FINDING', severity: SEVERITIES.includes(severity) ? severity : 'ERROR',
      source: 'editor', artifact_id: context.artifactId, explanation: String(text),
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    });
    (record.severity === 'WARNING' || record.severity === 'INFO' ? warnings : defects).push(record);
  }
  const rendered = payload.rendered_media_ref;
  if (rendered) {
    // Byte identity of the export is a deterministic, checkable fact.
    let bytes = null;
    try { bytes = readFileIfPresent(safeRepoPath(rendered.path_or_artifact_ref, 'rendered media ref', context.repoRoot)); }
    catch (_error) { bytes = null; }
    if (!bytes) {
      defects.push(defect({
        code: 'EDIT_EXPORT_MISSING', severity: 'BLOCKER', source: 'editor',
        artifact_id: context.artifactId,
        explanation: `declared export is not readable at ${rendered.path_or_artifact_ref}`,
        evidence_ref: context.evidenceId, affected_gate: context.gate,
      }));
    } else if (rendered.sha256 && sha256(bytes) !== rendered.sha256) {
      defects.push(defect({
        code: 'EDIT_EXPORT_HASH_MISMATCH', severity: 'BLOCKER', source: 'editor',
        artifact_id: context.artifactId,
        explanation: 'declared export bytes do not match the recorded sha256',
        evidence_ref: context.evidenceId, affected_gate: context.gate,
      }));
    }
  }
  return {
    schema_supported: true, defects, warnings,
    human_review_required: false, human_review_reason: null,
    summary: {
      edit_plan_id: payload.edit_plan_id || null,
      revision: payload.edit_plan_revision ?? null,
      findings: (payload.findings || []).length,
      has_export: Boolean(rendered),
    },
  };
}

function audioAdapter(payload, context) {
  // Consumes a Sound & Music Director durable render record. QC checks
  // technical validity and binding only; musical fit is never scored here.
  if (payload?.schema_version !== 1) return unsupportedSchema('AUDIO_RENDER', payload, context);
  const defects = [];
  const warnings = [];
  const state = String(payload.state || '');
  if (state && state !== 'PRODUCTION_READY') {
    defects.push(defect({
      code: 'AUDIO_NOT_PRODUCTION_READY', severity: 'ERROR', source: 'sound_music_director',
      artifact_id: context.artifactId, explanation: `audio state is ${state}`,
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  if (!payload.production_mix_sha256) {
    defects.push(defect({
      code: 'AUDIO_MIX_IDENTITY_ABSENT', severity: 'BLOCKER', source: 'sound_music_director',
      artifact_id: context.artifactId, explanation: 'audio evidence carries no production mix hash',
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  const duration = Number(payload.duration_seconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    defects.push(defect({
      code: 'AUDIO_DURATION_INVALID', severity: 'ERROR', source: 'sound_music_director',
      artifact_id: context.artifactId, explanation: 'audio duration is missing or not a positive number',
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  return {
    schema_supported: true, defects, warnings,
    human_review_required: false, human_review_reason: null,
    summary: { state: state || null, duration_seconds: Number.isFinite(duration) ? duration : null },
  };
}

function storyAdapter(payload, context) {
  // Consumes Story Editor / Research Director validation output. QC does NOT
  // re-derive semantic judgement; it verifies that the specialist verdict
  // exists, is well formed, and belongs to the inspected version.
  if (payload?.schema_version !== 1) return unsupportedSchema('STORY_VALIDATION', payload, context);
  const defects = [];
  const warnings = [];
  const verdict = String(payload.verdict || payload.state || '');
  if (!verdict) return unsupportedSchema('STORY_VALIDATION', payload, context, 'no verdict recorded');
  if (!['PASS', 'VALID', 'APPROVED'].includes(verdict)) {
    defects.push(defect({
      code: 'STORY_VALIDATION_NOT_PASSED', severity: 'ERROR', source: context.producedBy || 'story_editor',
      artifact_id: context.artifactId, explanation: `upstream specialist verdict is ${verdict}`,
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  for (const issue of payload.warnings || []) {
    warnings.push(defect({
      code: 'STORY_VALIDATION_WARNING', severity: 'WARNING', source: context.producedBy || 'story_editor',
      artifact_id: context.artifactId, explanation: String(issue),
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    }));
  }
  return {
    schema_supported: true, defects, warnings,
    human_review_required: false, human_review_reason: null,
    summary: { verdict, warnings: (payload.warnings || []).length },
  };
}

function unsupportedSchema(kind, payload, context, detail = null) {
  return {
    schema_supported: false,
    defects: [defect({
      code: 'QC_EVIDENCE_SCHEMA_UNSUPPORTED', severity: 'BLOCKER', source: AGENT_ID,
      artifact_id: context.artifactId,
      explanation: detail
        || `${kind} evidence declares unsupported schema_version ${JSON.stringify(payload?.schema_version ?? null)}`,
      evidence_ref: context.evidenceId, affected_gate: context.gate,
    })],
    warnings: [],
    human_review_required: false, human_review_reason: null,
    summary: { kind, schema_version: payload?.schema_version ?? null },
  };
}

const ADAPTERS = Object.freeze({
  CAMERA_QUALITY: cameraQualityAdapter,
  GENERATION_RESULT: generationAdapter,
  EDIT_QC_HANDOFF: editAdapter,
  AUDIO_RENDER: audioAdapter,
  STORY_VALIDATION: storyAdapter,
});
const SUPPORTED_EVIDENCE_KINDS = Object.freeze(Object.keys(ADAPTERS));

// ── task validation ───────────────────────────────────────────────────────
function taskAction(task) {
  return (task && (task.assignment?.action || task.action)) || null;
}

function validateTask(task) {
  strictObject(task, TASK_FIELDS, 'QC task');
  if (typeof task.task_id !== 'string' || !task.task_id) {
    throw new QCInputError('QC_TASK_INVALID', 'QC task requires task_id');
  }
  const action = taskAction(task);
  if (!ACTIONS.includes(action)) {
    throw new QCInputError('QC_ACTION_UNSUPPORTED', `QC action unsupported: ${action ?? '(absent)'}`);
  }
  if (task.privacy && task.privacy.local_only === false) {
    throw new QCInputError('QC_TASK_INVALID', 'QC requires privacy.local_only');
  }
  if (task.gate != null && !CANONICAL_GATES.includes(task.gate)) {
    throw new QCInputError('QC_GATE_UNKNOWN', `gate is not one of the canonical 14 gates: ${task.gate}`);
  }
  if (action === 'status') return { action };
  if (!task.subject) throw new QCInputError('QC_TASK_INVALID', 'inspect_artifact requires subject');
  strictObject(task.subject, SUBJECT_FIELDS, 'QC subject');
  for (const field of ['artifact_id', 'artifact_type', 'producing_agent']) {
    if (typeof task.subject[field] !== 'string' || !task.subject[field]) {
      throw new QCInputError('QC_TASK_INVALID', `QC subject requires ${field}`);
    }
  }
  // Independence doctrine enforced at the input boundary: QC may not be asked
  // to judge its own output, and it may not be the producer of the subject.
  if (task.subject.producing_agent === AGENT_ID) {
    throw new QCInputError('QC_INDEPENDENCE_VIOLATION', 'QC Director may not inspect an artifact it produced itself');
  }
  if (!Array.isArray(task.evidence || [])) throw new QCInputError('QC_TASK_INVALID', 'evidence must be an array');
  for (const item of task.evidence || []) {
    strictObject(item, EVIDENCE_FIELDS, 'QC evidence entry');
    if (typeof item.evidence_id !== 'string' || !item.evidence_id) {
      throw new QCInputError('QC_TASK_INVALID', 'evidence entry requires evidence_id');
    }
    if (item.binds_to != null) strictObject(item.binds_to, BINDS_TO_FIELDS, 'evidence binds_to');
    if (item.evidence_class != null && !EVIDENCE_CLASSES.includes(item.evidence_class)) {
      throw new QCInputError('QC_TASK_INVALID', `unknown evidence_class ${item.evidence_class}`);
    }
    if (item.path == null && item.payload == null) {
      throw new QCInputError('QC_TASK_INVALID', `evidence ${item.evidence_id} has neither path nor payload`);
    }
  }
  if (!Array.isArray(task.required_evidence || [])) {
    throw new QCInputError('QC_TASK_INVALID', 'required_evidence must be an array');
  }
  return { action };
}

// ── artifact integrity (mutation-free) ────────────────────────────────────
function inspectSubjectIntegrity(subject, blockers, repoRoot) {
  const observed = { artifact_readable: null, artifact_sha256: null, byte_size: null };
  if (!subject.artifact_path) return observed;
  let resolved;
  try { resolved = safeRepoPath(subject.artifact_path, 'subject artifact_path', repoRoot); }
  catch (error) {
    blockers.push(defect({
      code: error.code === 'QC_PATH_ESCAPE' ? 'QC_ARTIFACT_PATH_UNSAFE' : 'QC_ARTIFACT_PATH_INVALID',
      severity: 'BLOCKER', source: AGENT_ID, artifact_id: subject.artifact_id,
      explanation: error.message,
    }));
    return observed;
  }
  const bytes = readFileIfPresent(resolved);
  if (!bytes) {
    observed.artifact_readable = false;
    blockers.push(defect({
      code: 'QC_ARTIFACT_UNREADABLE', severity: 'BLOCKER', source: AGENT_ID,
      artifact_id: subject.artifact_id,
      explanation: `subject artifact is not a readable regular file: ${subject.artifact_path}`,
    }));
    return observed;
  }
  observed.artifact_readable = true;
  observed.artifact_sha256 = sha256(bytes);
  observed.byte_size = bytes.length;
  if (subject.artifact_sha256 && subject.artifact_sha256 !== observed.artifact_sha256) {
    blockers.push(defect({
      code: 'QC_ARTIFACT_HASH_MISMATCH', severity: 'BLOCKER', source: AGENT_ID,
      artifact_id: subject.artifact_id,
      explanation: 'subject artifact bytes do not match the declared artifact_sha256',
    }));
  }
  return observed;
}

// ── evidence resolution, binding and staleness ────────────────────────────
// Hash/version binding is authoritative. A recent mtime is never accepted as
// proof that evidence matches the artifact it claims to describe.
function resolveEvidence(task, subject, observed, blockers, repoRoot) {
  const resolved = [];
  for (const item of task.evidence || []) {
    const record = {
      evidence_id: item.evidence_id,
      kind: item.kind || null,
      evidence_class: item.evidence_class || 'UNVERIFIED',
      produced_by: item.produced_by || null,
      path: item.path || null,
      declared_sha256: item.sha256 || null,
      observed_sha256: null,
      binding: 'UNBOUND',
      used: false,
      summary: null,
    };
    let payload = item.payload ?? null;
    if (item.path) {
      let target;
      try { target = safeRepoPath(item.path, `evidence ${item.evidence_id} path`, repoRoot); }
      catch (error) {
        blockers.push(defect({
          code: 'QC_EVIDENCE_PATH_UNSAFE', severity: 'BLOCKER', source: AGENT_ID,
          artifact_id: subject.artifact_id, explanation: error.message, evidence_ref: item.evidence_id,
          affected_gate: task.gate || null,
        }));
        resolved.push(record);
        continue;
      }
      const bytes = readFileIfPresent(target);
      if (!bytes) {
        blockers.push(defect({
          code: 'QC_EVIDENCE_UNREADABLE', severity: 'BLOCKER', source: AGENT_ID,
          artifact_id: subject.artifact_id,
          explanation: `evidence ${item.evidence_id} is not readable at ${item.path}`,
          evidence_ref: item.evidence_id, affected_gate: task.gate || null,
        }));
        resolved.push(record);
        continue;
      }
      record.observed_sha256 = sha256(bytes);
      if (record.declared_sha256 && record.declared_sha256 !== record.observed_sha256) {
        blockers.push(defect({
          code: 'QC_EVIDENCE_HASH_MISMATCH', severity: 'BLOCKER', source: AGENT_ID,
          artifact_id: subject.artifact_id,
          explanation: `evidence ${item.evidence_id} bytes do not match its declared sha256`,
          evidence_ref: item.evidence_id, affected_gate: task.gate || null,
        }));
        resolved.push(record);
        continue;
      }
      try { payload = JSON.parse(bytes.toString('utf8')); }
      catch (_error) {
        blockers.push(defect({
          code: 'QC_EVIDENCE_MALFORMED', severity: 'BLOCKER', source: AGENT_ID,
          artifact_id: subject.artifact_id,
          explanation: `evidence ${item.evidence_id} is not valid JSON`,
          evidence_ref: item.evidence_id, affected_gate: task.gate || null,
        }));
        resolved.push(record);
        continue;
      }
    }

    // Binding: the evidence must name the artifact it describes, and that
    // name must match the artifact actually inspected.
    const binds = item.binds_to || null;
    if (!binds) {
      record.binding = 'UNBOUND';
      blockers.push(defect({
        code: 'QC_EVIDENCE_UNBOUND', severity: 'BLOCKER', source: AGENT_ID,
        artifact_id: subject.artifact_id,
        explanation: `evidence ${item.evidence_id} declares no binds_to; its provenance to this artifact is unproven`,
        evidence_ref: item.evidence_id, affected_gate: task.gate || null,
      }));
      resolved.push(record);
      continue;
    }
    if (binds.artifact_id && binds.artifact_id !== subject.artifact_id) {
      record.binding = 'WRONG_ARTIFACT';
      blockers.push(defect({
        code: 'QC_EVIDENCE_ARTIFACT_MISMATCH', severity: 'BLOCKER', source: AGENT_ID,
        artifact_id: subject.artifact_id,
        explanation: `evidence ${item.evidence_id} binds to artifact ${binds.artifact_id}, not ${subject.artifact_id}`,
        evidence_ref: item.evidence_id, affected_gate: task.gate || null,
      }));
      resolved.push(record);
      continue;
    }
    const artifactHash = observed.artifact_sha256 || subject.artifact_sha256 || null;
    if (binds.artifact_sha256 && artifactHash && binds.artifact_sha256 !== artifactHash) {
      record.binding = 'STALE';
      blockers.push(defect({
        code: 'QC_EVIDENCE_STALE', severity: 'BLOCKER', source: AGENT_ID,
        artifact_id: subject.artifact_id,
        explanation: `evidence ${item.evidence_id} was produced against a different artifact revision `
          + '(bound hash does not match the inspected artifact)',
        evidence_ref: item.evidence_id, affected_gate: task.gate || null,
      }));
      resolved.push(record);
      continue;
    }
    if (binds.version_id && subject.version_id && binds.version_id !== subject.version_id) {
      record.binding = 'VERSION_MISMATCH';
      blockers.push(defect({
        code: 'QC_EVIDENCE_VERSION_MISMATCH', severity: 'BLOCKER', source: AGENT_ID,
        artifact_id: subject.artifact_id,
        explanation: `evidence ${item.evidence_id} binds to version ${binds.version_id}, `
          + `but the inspected artifact is ${subject.version_id}`,
        evidence_ref: item.evidence_id, affected_gate: task.gate || null,
      }));
      resolved.push(record);
      continue;
    }
    record.binding = 'BOUND';
    record.payload = payload;
    resolved.push(record);
  }
  return resolved;
}

function applyAdapters(task, subject, evidenceRecords, blockers, defects, warnings, repoRoot) {
  const humanReviewReasons = [];
  const checks = [];
  for (const record of evidenceRecords) {
    if (record.binding !== 'BOUND') continue;
    const adapter = ADAPTERS[record.kind];
    if (!adapter) {
      blockers.push(defect({
        code: 'QC_EVIDENCE_KIND_UNSUPPORTED', severity: 'BLOCKER', source: AGENT_ID,
        artifact_id: subject.artifact_id,
        explanation: `evidence ${record.evidence_id} declares unsupported kind ${record.kind ?? '(absent)'}; `
          + `QC fails closed rather than guessing (supported: ${SUPPORTED_EVIDENCE_KINDS.join(', ')})`,
        evidence_ref: record.evidence_id, affected_gate: task.gate || null,
      }));
      checks.push({ evidence_id: record.evidence_id, kind: record.kind, applied: false, reason: 'UNSUPPORTED_KIND' });
      continue;
    }
    const context = {
      artifactId: subject.artifact_id, evidenceId: record.evidence_id,
      gate: task.gate || null, producedBy: record.produced_by, repoRoot,
    };
    const outcome = adapter(record.payload, context);
    record.used = true;
    record.summary = outcome.summary;
    delete record.payload;
    for (const item of outcome.defects) (item.severity === 'BLOCKER' ? blockers : defects).push(item);
    warnings.push(...outcome.warnings);
    if (outcome.human_review_required) {
      humanReviewReasons.push({ evidence_id: record.evidence_id, reason: outcome.human_review_reason });
    }
    checks.push({
      evidence_id: record.evidence_id, kind: record.kind, applied: true,
      schema_supported: outcome.schema_supported,
      defects: outcome.defects.length, warnings: outcome.warnings.length,
    });
  }
  for (const record of evidenceRecords) delete record.payload;
  return { checks, humanReviewReasons };
}

// ── required evidence: absence of a defect is not proof of quality ────────
function checkRequiredEvidence(task, subject, evidenceRecords, blockers) {
  const satisfied = new Set(evidenceRecords.filter((r) => r.binding === 'BOUND' && r.used).map((r) => r.kind));
  const missing = [];
  for (const kind of task.required_evidence || []) {
    if (satisfied.has(kind)) continue;
    missing.push(kind);
    blockers.push(defect({
      code: 'QC_REQUIRED_EVIDENCE_MISSING', severity: 'BLOCKER', source: AGENT_ID,
      artifact_id: subject.artifact_id,
      explanation: `required evidence ${kind} was never produced or does not validly bind to this artifact; `
        + 'absence of a known defect is not proof of quality',
      evidence_ref: null, affected_gate: task.gate || null,
    }));
  }
  return { required: [...(task.required_evidence || [])], satisfied: [...satisfied], missing };
}

// ── human authority (consumed, never authored) ────────────────────────────
function evaluateHumanAuthority(task, subject, observed, blockers, repoRoot) {
  const gateScope = task.gate ? HUMAN_AUTHORITY_GATES[task.gate] || null : null;
  // A gate may only demand a scope the canonical approval vocabulary defines.
  if (gateScope && !approvalScopes.isApprovalScope(gateScope)) {
    throw new QCInputError('QC_APPROVAL_SCOPE_INVALID', `gate ${task.gate} maps to a non-canonical approval scope`);
  }
  const record = {
    required_scope: gateScope,
    present: Boolean(task.human_authority),
    verdict: null,
    decision: null,
    approver: null,
    reason: null,
  };
  if (!task.human_authority) {
    record.verdict = gateScope ? 'ABSENT' : 'NOT_REQUIRED';
    return record;
  }
  const binding = task.human_authority;
  record.approver = binding.approved_by || null;
  record.decision = String(binding.decision || 'APPROVE').toUpperCase();

  // The approval must bind to the exact bytes QC inspected.
  let bytes = null;
  if (binding.artifact_path) {
    try { bytes = readFileIfPresent(safeRepoPath(binding.artifact_path, 'human authority artifact_path', repoRoot)); }
    catch (error) {
      blockers.push(defect({
        code: 'QC_HUMAN_AUTHORITY_PATH_UNSAFE', severity: 'BLOCKER', source: AGENT_ID,
        artifact_id: subject.artifact_id, explanation: error.message, affected_gate: task.gate || null,
      }));
      record.verdict = 'INVALID';
      record.reason = error.message;
      return record;
    }
  }
  const verification = contractValidator.verifyApprovalBinding(binding, bytes, gateScope || null);
  record.verdict = verification.verdict;
  record.reason = verification.reason || null;
  if (verification.verdict !== 'VALID') {
    blockers.push(defect({
      code: verification.verdict === 'STALE' ? 'QC_HUMAN_AUTHORITY_STALE' : 'QC_HUMAN_AUTHORITY_INVALID',
      severity: 'BLOCKER', source: AGENT_ID, artifact_id: subject.artifact_id,
      explanation: `human authority artifact is ${verification.verdict}: ${verification.reason}`,
      affected_gate: task.gate || null, human_judgment_required: true,
    }));
  }
  return record;
}

// ── deterministic disposition ─────────────────────────────────────────────
function deriveDisposition({ blockers, defects, warnings, humanAuthority, humanReviewReasons }) {
  // 1. Integrity first. If QC cannot trust what it is looking at, it issues no
  //    substantive verdict at all.
  if (blockers.length) {
    return { disposition: 'BLOCKED', reason: blockers[0].explanation };
  }
  // 2. A valid human rejection is decisive.
  if (humanAuthority.verdict === 'VALID' && humanAuthority.decision === 'REJECT') {
    return { disposition: 'FAIL', reason: `human authority rejected this artifact (${humanAuthority.approver})` };
  }
  // 3. Deterministic and specialist hard defects.
  const hard = defects.filter((item) => item.severity === 'BLOCKER' || item.severity === 'ERROR');
  if (hard.length) {
    return { disposition: 'FAIL', reason: hard[0].explanation };
  }
  // 4. Technical gates are clean, but an aesthetic authority is still owed.
  //    QC never substitutes itself for Mikko.
  if (humanAuthority.verdict === 'ABSENT') {
    return {
      disposition: 'HUMAN_REVIEW_REQUIRED',
      reason: `technical checks pass, but ${humanAuthority.required_scope} is a human decision that has not been recorded`,
    };
  }
  if (humanReviewReasons.length) {
    return {
      disposition: 'HUMAN_REVIEW_REQUIRED',
      reason: humanReviewReasons[0].reason || 'evidence explicitly defers the visual judgement to a human',
    };
  }
  if (warnings.length) {
    return { disposition: 'PASS_WITH_WARNINGS', reason: `${warnings.length} warning(s) recorded; no blocking defect` };
  }
  return { disposition: 'PASS', reason: 'all applicable technical evidence is present, bound and clean' };
}

function deriveAttention(disposition) {
  // QC doctrine: escalation_rules.DECISION is "never; QC fails closed instead".
  return NEXT_GATE_ALLOWED.includes(disposition) ? 'INFORMATION' : 'REVIEW';
}

function deriveHandoff(disposition, subject, gate) {
  if (disposition === 'HUMAN_REVIEW_REQUIRED') {
    return { next_owner: 'mikko', next_action: 'REVIEW_QC_HUMAN_AUTHORITY_GAP' };
  }
  if (disposition === 'FAIL') {
    return {
      next_owner: REMEDIATION_OWNER[subject?.producing_agent] || 'production_operations',
      next_action: 'REMEDIATE_QC_DEFECTS',
    };
  }
  if (disposition === 'BLOCKED') {
    return { next_owner: 'production_operations', next_action: 'RESTORE_QC_EVIDENCE_INTEGRITY' };
  }
  return { next_owner: 'production_operations', next_action: gate ? `ADVANCE_GATE_${gate}` : 'ADVANCE_PRODUCTION_GATE' };
}

function controlRoomView(result) {
  const attention = result.attention;
  const blockerText = result.blockers.map((b) => b.explanation);
  return {
    role: AGENT_ID,
    action: result.action,
    state: result.state,
    attention,
    attention_level: attention,
    disposition: result.disposition,
    current_artifact: result.subject
      ? { artifact_id: result.subject.artifact_id, artifact_type: result.subject.artifact_type, producing_agent: result.subject.producing_agent }
      : null,
    package_run_id: result.package_run_id,
    gate: result.gate,
    next_gate_allowed: result.next_gate_allowed,
    blockers: blockerText,
    blocker: blockerText[0] || result.reason || null,
    defects: result.defects.length,
    warnings: result.warnings.length,
    human_review_required: result.disposition === 'HUMAN_REVIEW_REQUIRED',
    human_authority: result.human_authority
      ? { required_scope: result.human_authority.required_scope, verdict: result.human_authority.verdict }
      : null,
    evidence_used: result.evidence.filter((item) => item.used).length,
    evidence_total: result.evidence.length,
    missing_evidence: result.evidence_coverage?.missing || [],
    implementation_proof_state: QC_DIRECTOR_VERSION,
    aesthetic_authority_claimed: false,
    operational_rationale: {
      decision: result.disposition,
      reason: result.reason || `QC disposition is ${result.disposition}`,
      evidence_refs: result.evidence.slice(0, 20).map((item) => ({
        ref: item.evidence_id,
        summary: `${item.kind || 'unknown'}/${item.binding}`,
      })),
      confidence: null,
      escalation_reason: ['REVIEW', 'DECISION'].includes(attention)
        ? (blockerText[0] || result.reason || null)
        : null,
    },
    owner: AGENT_ID,
    next_owner: result.handoff?.next_owner || null,
    latest_event: result.events?.at(-1) || null,
  };
}

// The QC result body whose hash must be stable across identical inspections.
// Timestamps and event streams are deliberately excluded.
function canonicalBody(result) {
  return canonicalize({
    schema_version: result.schema_version,
    qc_director_version: result.qc_director_version,
    agent_id: result.agent_id,
    package_run_id: result.package_run_id,
    project_id: result.project_id,
    gate: result.gate,
    subject: result.subject,
    observed: result.observed,
    evidence: result.evidence,
    evidence_coverage: result.evidence_coverage,
    checks: result.checks,
    blockers: result.blockers,
    defects: result.defects,
    warnings: result.warnings,
    human_authority: result.human_authority,
    disposition: result.disposition,
    reason: result.reason,
    next_gate_allowed: result.next_gate_allowed,
  });
}

function run(task, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const now = options.now || new Date().toISOString();
  const events = [];
  const event = (state, detail = null) => events.push({ at: now, actor: AGENT_ID, state, detail });

  let action = null;
  try {
    ({ action } = validateTask(task));
    if (action === 'status') {
      const output = {
        schema_version: QC_SCHEMA_VERSION, qc_director_version: QC_DIRECTOR_VERSION,
        agent_id: AGENT_ID, task_id: task.task_id, action,
        package_run_id: task.package_run_id || null, project_id: task.project_id || null,
        gate: task.gate || null, state: 'COMPLETE', disposition: 'PASS',
        reason: 'QC Director is available; no artifact was submitted for inspection',
        subject: null, observed: null, evidence: [], evidence_coverage: { required: [], satisfied: [], missing: [] },
        checks: [], blockers: [], defects: [], warnings: [],
        human_authority: { required_scope: null, present: false, verdict: 'NOT_REQUIRED', decision: null, approver: null, reason: null },
        next_gate_allowed: false,
        supported_evidence_kinds: SUPPORTED_EVIDENCE_KINDS,
        canonical_gates: CANONICAL_GATES,
        aesthetic_authority: { claimed: false, owner: 'mikko', fenced_dimensions: AESTHETIC_DIMENSIONS },
        inspected_at: now, events,
      };
      event('QC_STATUS_REPORTED', QC_DIRECTOR_VERSION);
      output.attention = 'INFORMATION';
      output.attention_level = 'INFORMATION';
      output.handoff = { next_owner: 'hermes', next_action: 'DISPATCH_QC_INSPECTION' };
      output.qc_result_digest_sha256 = sha256(JSON.stringify(canonicalBody(output)));
      output.control_room = controlRoomView(output);
      output.operational_rationale = output.control_room.operational_rationale;
      return output;
    }

    const subject = { ...task.subject };
    const blockers = [];
    const defects = [];
    const warnings = [];

    event('QC_INSPECTION_STARTED', subject.artifact_id);
    const observed = inspectSubjectIntegrity(subject, blockers, repoRoot);
    const evidenceRecords = resolveEvidence(task, subject, observed, blockers, repoRoot);
    const { checks, humanReviewReasons } = applyAdapters(task, subject, evidenceRecords, blockers, defects, warnings, repoRoot);
    const coverage = checkRequiredEvidence(task, subject, evidenceRecords, blockers);
    const humanAuthority = evaluateHumanAuthority(task, subject, observed, blockers, repoRoot);
    const { disposition, reason } = deriveDisposition({ blockers, defects, warnings, humanAuthority, humanReviewReasons });
    event(`QC_${disposition}`, reason);

    const output = {
      schema_version: QC_SCHEMA_VERSION, qc_director_version: QC_DIRECTOR_VERSION,
      agent_id: AGENT_ID, task_id: task.task_id, action,
      package_run_id: task.package_run_id || null, project_id: task.project_id || null,
      gate: task.gate || null,
      state: disposition === 'PASS' || disposition === 'PASS_WITH_WARNINGS' ? 'COMPLETE' : disposition,
      disposition, reason,
      subject, observed,
      evidence: evidenceRecords, evidence_coverage: coverage,
      checks, blockers, defects, warnings,
      human_authority: humanAuthority,
      human_review_reasons: humanReviewReasons,
      next_gate_allowed: NEXT_GATE_ALLOWED.includes(disposition),
      supported_evidence_kinds: SUPPORTED_EVIDENCE_KINDS,
      canonical_gates: CANONICAL_GATES,
      aesthetic_authority: { claimed: false, owner: 'mikko', fenced_dimensions: AESTHETIC_DIMENSIONS },
      inspected_at: now, events,
    };
    output.attention = deriveAttention(disposition);
    output.attention_level = output.attention;
    output.handoff = deriveHandoff(disposition, subject, task.gate || null);
    output.qc_result_digest_sha256 = sha256(JSON.stringify(canonicalBody(output)));
    output.qc_handoff = null;
    output.control_room = controlRoomView(output);
    output.operational_rationale = output.control_room.operational_rationale;
    return output;
  } catch (error) {
    // Input-level failure is still a fail-closed QC outcome, never a PASS.
    event('QC_BLOCKED', error.message);
    const blocker = defect({
      code: error.code || 'QC_TASK_INVALID', severity: 'BLOCKER', source: AGENT_ID,
      artifact_id: task?.subject?.artifact_id || null, explanation: error.message,
      affected_gate: task?.gate || null,
    });
    const output = {
      schema_version: QC_SCHEMA_VERSION, qc_director_version: QC_DIRECTOR_VERSION,
      agent_id: AGENT_ID, task_id: typeof task?.task_id === 'string' ? task.task_id : null,
      action: action || taskAction(task), package_run_id: task?.package_run_id || null,
      project_id: task?.project_id || null, gate: task?.gate || null,
      state: 'BLOCKED', disposition: 'BLOCKED', reason: error.message,
      subject: task?.subject && typeof task.subject === 'object' && !Array.isArray(task.subject) ? { ...task.subject } : null,
      observed: null, evidence: [], evidence_coverage: { required: [], satisfied: [], missing: [] },
      checks: [], blockers: [blocker], defects: [], warnings: [],
      human_authority: { required_scope: null, present: false, verdict: 'NOT_EVALUATED', decision: null, approver: null, reason: null },
      human_review_reasons: [],
      next_gate_allowed: false,
      supported_evidence_kinds: SUPPORTED_EVIDENCE_KINDS,
      canonical_gates: CANONICAL_GATES,
      aesthetic_authority: { claimed: false, owner: 'mikko', fenced_dimensions: AESTHETIC_DIMENSIONS },
      inspected_at: now, events,
    };
    output.attention = 'REVIEW';
    output.attention_level = 'REVIEW';
    output.handoff = { next_owner: 'production_operations', next_action: 'RESTORE_QC_EVIDENCE_INTEGRITY' };
    output.qc_result_digest_sha256 = sha256(JSON.stringify(canonicalBody(output)));
    output.control_room = controlRoomView(output);
    output.operational_rationale = output.control_room.operational_rationale;
    return output;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--task') out.task = argv[++index];
    else if (argv[index] === '--out') out.out = argv[++index];
    else if (argv[index] === '--repo') out.repo = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') out.help = true;
    else throw new QCInputError('QC_ARGUMENT_INVALID', `unknown argument ${argv[index]}`);
  }
  return out;
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({ agent_id: AGENT_ID, state: 'BLOCKED', reason: error.message }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.help || !args.task) {
    process.stdout.write('usage: qc-director.js --task <qc-task.json> [--out result.json] [--repo <path>]\n');
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  let task;
  try { task = JSON.parse(fs.readFileSync(args.task, 'utf8')); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema_version: QC_SCHEMA_VERSION, agent_id: AGENT_ID, task_id: null, state: 'BLOCKED',
      disposition: 'BLOCKED', reason: `QC task is not readable JSON: ${error.message}`,
      events: [], control_room: { role: AGENT_ID, state: 'BLOCKED', attention: 'REVIEW' },
    }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const result = run(task, { repoRoot: args.repo });
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) fs.writeFileSync(args.out, payload);
  process.stdout.write(payload);
  if (!NEXT_GATE_ALLOWED.includes(result.disposition)) process.exitCode = 1;
}

module.exports = {
  AGENT_ID, ACTIONS, QC_SCHEMA_VERSION, QC_DIRECTOR_VERSION,
  DISPOSITIONS, SEVERITIES, EVIDENCE_CLASSES, NEXT_GATE_ALLOWED,
  AESTHETIC_DIMENSIONS, CANONICAL_GATES, HUMAN_AUTHORITY_GATES, REMEDIATION_OWNER,
  TASK_FIELDS, SUBJECT_FIELDS, EVIDENCE_FIELDS, SUPPORTED_EVIDENCE_KINDS, ADAPTERS,
  QCInputError, sha256, canonicalize, safeRepoPath, defect,
  validateTask, taskAction, inspectSubjectIntegrity, resolveEvidence,
  checkRequiredEvidence, evaluateHumanAuthority, deriveDisposition, deriveAttention,
  deriveHandoff, controlRoomView, canonicalBody, run, parseArgs, main,
};

if (require.main === module && guardExecutableLifecycle(AGENT_ID)) main();
