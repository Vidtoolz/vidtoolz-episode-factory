'use strict';

/*
 * Resolve the exact bytes a human is being asked to review.
 *
 * This is an adapter, not another review authority.  It normalises the legacy
 * Draft Assembly V0 manifest and the current Directed Draft execution estate
 * for vidtoolz.draftReview.v2.  Directed Draft resolution is intentionally
 * fail-closed: every canonical identity is cross-checked before an output is
 * described as DRAFT_REVIEW_READY.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const legacyAssembly = require('./package-run-draft-assembly.js');
const directed = require('./directed-draft-assembly-handoff.js');
const execution = require('./production-assembly-execution-successor.js');
const researchEvidence = require('./package-run-research-evidence.js');

const SUBJECT_KINDS = Object.freeze({ LEGACY: 'DRAFT_ASSEMBLY_V0', DIRECTED: 'DIRECTED_DRAFT_ASSEMBLY' });
const REVIEW_READY = 'DRAFT_REVIEW_READY';
const NOT_REVIEW_READY = 'NOT_REVIEW_READY';

class DraftReviewSubjectError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftReviewSubjectError'; this.code = code; }
}
function fail(code, message) { throw new DraftReviewSubjectError(code, message); }
function readJson(file, code) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(code, `${file}: ${error.message}`); }
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { if (value[key] !== undefined) out[key] = stable(value[key]); return out; }, {});
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function resolveRef(runDir, ref, code = 'DRAFT_REVIEW_SUBJECT_REFERENCE_INVALID') {
  if (typeof ref !== 'string' || !ref || ref.includes('\0')) fail(code, String(ref));
  const file = path.isAbsolute(ref) ? path.resolve(ref) : path.resolve(runDir, ref);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(code, file);
  return file;
}
function assertEqual(actual, expected, code, label) {
  if (actual !== expected) fail(code, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function directedStatePath(runDir) { return path.join(runDir, directed.ASSEMBLY_DIR, directed.STATE_FILE); }

function subjectBinding(subject) {
  return {
    kind: subject.kind,
    run_id: subject.run_id,
    output_sha256: subject.output.sha256,
    execution_attempt_id: subject.execution?.attempt_id ?? null,
    execution_attempt_digest_sha256: subject.execution?.attempt_digest_sha256 ?? null,
    execution_identity_sha256: subject.execution?.execution_identity_sha256 ?? null,
    execution_head_sha256: subject.execution?.head_sha256 ?? null,
    semantic_plan_digest_sha256: subject.semantic_plan_digest_sha256 ?? null,
    handoff_id: subject.handoff?.id ?? null,
    handoff_digest_sha256: subject.handoff?.digest_sha256 ?? null,
    handoff_file_sha256: subject.handoff?.file_sha256 ?? null,
    script_sha256: subject.script?.sha256 ?? null,
    story_project_id: subject.story?.project_id ?? null,
    story_version_id: subject.story?.version_id ?? null,
    story_content_hash: subject.story?.content_hash ?? null,
    release_sha256: subject.release?.sha256 ?? null,
    evidence_sha256: subject.evidence?.sha256 ?? null,
    assembly_manifest_sha256: subject.assembly_manifest?.sha256 ?? null,
  };
}

function primaryAssetForBeat(handoff, beat) {
  const layer = (beat.layers || []).find((item) => item.primary) || (beat.layers || [])[0] || null;
  if (!layer?.asset_id) return { id: null, sha256: null };
  const asset = (handoff.media?.assets || []).find((item) => item.asset_id === layer.asset_id);
  return { id: layer.asset_id, sha256: asset?.sha256 ?? null };
}

function resolveDirectedSubject(runDirInput) {
  const runDir = path.resolve(runDirInput);
  const runId = path.basename(runDir);
  const stateFile = directedStatePath(runDir);
  if (!fs.existsSync(stateFile)) return null;
  const state = readJson(stateFile, 'DIRECTED_REVIEW_STATE_INVALID');
  assertEqual(state.schema, directed.STATE_SCHEMA, 'DIRECTED_REVIEW_STATE_INVALID', 'state schema');
  assertEqual(state.run_id, runId, 'DIRECTED_REVIEW_RUN_MISMATCH', 'state run_id');

  const handoffFile = resolveRef(runDir, state.handoff_path, 'DIRECTED_REVIEW_HANDOFF_MISSING');
  const handoff = readJson(handoffFile, 'DIRECTED_REVIEW_HANDOFF_INVALID');
  assertEqual(handoff.schema, directed.HANDOFF_SCHEMA, 'DIRECTED_REVIEW_HANDOFF_INVALID', 'handoff schema');
  assertEqual(handoff.run_id, runId, 'DIRECTED_REVIEW_RUN_MISMATCH', 'handoff run_id');
  assertEqual(handoff.handoff_id, state.active_handoff_id, 'DIRECTED_REVIEW_HANDOFF_MISMATCH', 'active handoff id');
  assertEqual(handoff.handoff_digest_sha256, state.active_handoff_digest_sha256, 'DIRECTED_REVIEW_HANDOFF_MISMATCH', 'active handoff digest');
  try { directed.validateSemanticHandoff(handoff); }
  catch (error) { fail('DIRECTED_REVIEW_HANDOFF_MODIFIED', `${error.code || 'HANDOFF_INVALID'}: ${error.message}`); }

  const completionFile = path.join(path.dirname(handoffFile), `${handoff.handoff_id}.complete.json`);
  const completion = readJson(completionFile, 'DIRECTED_REVIEW_COMPLETION_MISSING');
  assertEqual(completion.schema, directed.COMPLETION_SCHEMA, 'DIRECTED_REVIEW_COMPLETION_INVALID', 'completion schema');
  assertEqual(completion.state, 'COMPLETE_REVIEWABLE_DRAFT', 'DIRECTED_REVIEW_EXECUTION_FAILED', 'completion state');
  assertEqual(completion.run_id, runId, 'DIRECTED_REVIEW_RUN_MISMATCH', 'completion run_id');
  assertEqual(completion.handoff_id, handoff.handoff_id, 'DIRECTED_REVIEW_HANDOFF_MISMATCH', 'completion handoff id');
  assertEqual(completion.handoff_digest_sha256, handoff.handoff_digest_sha256, 'DIRECTED_REVIEW_HANDOFF_MISMATCH', 'completion handoff digest');

  const evidenceFile = resolveRef(runDir, completion.review_evidence_path, 'DIRECTED_REVIEW_EVIDENCE_MISSING');
  const evidence = readJson(evidenceFile, 'DIRECTED_REVIEW_EVIDENCE_INVALID');
  assertEqual(evidence.schema, directed.REVIEW_EVIDENCE_SCHEMA, 'DIRECTED_REVIEW_EVIDENCE_INVALID', 'evidence schema');
  assertEqual(evidence.state, 'VERIFIED', 'DIRECTED_REVIEW_EVIDENCE_UNVERIFIED', 'evidence state');
  assertEqual(evidence.run_id, runId, 'DIRECTED_REVIEW_RUN_MISMATCH', 'evidence run_id');
  if (evidence.technical_validation?.ok !== true || evidence.technical_validation?.decode_pass !== true
      || (evidence.technical_validation?.failures || []).length !== 0) {
    fail('DIRECTED_REVIEW_TECHNICAL_EVIDENCE_INVALID', 'technical validation is not a clean decode pass');
  }
  if (evidence.source_binding?.ok !== true || (evidence.source_binding?.drift || []).length !== 0) {
    fail('DIRECTED_REVIEW_SOURCE_BINDING_INVALID', 'evidence source binding contains drift');
  }
  assertEqual(evidence.source_binding.handoff_digest_sha256, handoff.handoff_digest_sha256, 'DIRECTED_REVIEW_HANDOFF_MISMATCH', 'evidence handoff digest');

  const outputFile = resolveRef(runDir, evidence.output?.path, 'DIRECTED_REVIEW_OUTPUT_MISSING');
  const outputSha = sha256File(outputFile);
  assertEqual(outputSha, evidence.output?.sha256, 'DIRECTED_REVIEW_OUTPUT_HASH_MISMATCH', 'output bytes');
  assertEqual(completion.output_path, outputFile, 'DIRECTED_REVIEW_OUTPUT_MISMATCH', 'completion output path');
  assertEqual(completion.output_sha256, outputSha, 'DIRECTED_REVIEW_OUTPUT_HASH_MISMATCH', 'completion output hash');

  const manifestFile = resolveRef(runDir, evidence.assembly_manifest?.file, 'DIRECTED_REVIEW_MANIFEST_MISSING');
  assertEqual(sha256File(manifestFile), evidence.assembly_manifest?.sha256, 'DIRECTED_REVIEW_EVIDENCE_IDENTITY_MISMATCH', 'manifest hash');
  const manifest = readJson(manifestFile, 'DIRECTED_REVIEW_MANIFEST_INVALID');
  assertEqual(manifest.schema, 'vidtoolz.productionAssemblyManifest.v1', 'DIRECTED_REVIEW_MANIFEST_INVALID', 'manifest schema');
  assertEqual(manifest.run_id, runId, 'DIRECTED_REVIEW_RUN_MISMATCH', 'manifest run_id');
  assertEqual(manifest.output_sha256, outputSha, 'DIRECTED_REVIEW_OUTPUT_HASH_MISMATCH', 'manifest output hash');

  const basePaths = execution.basePaths(outputFile, { plan_digest_sha256: completion.renderer_plan_digest_sha256 });
  const loaded = execution.loadHead(basePaths);
  if (loaded) {
    assertEqual(loaded.head.active_attempt_id, completion.renderer_execution_attempt?.attempt_id, 'DIRECTED_REVIEW_EXECUTION_MISMATCH', 'completion attempt id');
    assertEqual(loaded.attempt.attempt_digest_sha256, completion.renderer_execution_attempt?.attempt_digest_sha256, 'DIRECTED_REVIEW_EXECUTION_MISMATCH', 'completion attempt digest');
    assertEqual(loaded.attempt.execution.execution_identity_sha256, completion.renderer_execution_attempt?.execution_identity_sha256, 'DIRECTED_REVIEW_EXECUTION_MISMATCH', 'completion execution identity');
    assertEqual(loaded.head.semantic_plan_digest_sha256, completion.renderer_plan_digest_sha256, 'DIRECTED_REVIEW_SEMANTIC_PLAN_MISMATCH', 'completion semantic plan');
    assertEqual(manifest.plan_digest_sha256, loaded.head.semantic_plan_digest_sha256, 'DIRECTED_REVIEW_SEMANTIC_PLAN_MISMATCH', 'manifest semantic plan');
    for (const [label, value] of [['evidence', evidence.execution_attempt], ['manifest', manifest.execution_attempt]]) {
      assertEqual(value?.attempt_id, loaded.attempt.attempt_id, 'DIRECTED_REVIEW_EXECUTION_MISMATCH', `${label} attempt id`);
      assertEqual(value?.attempt_digest_sha256, loaded.attempt.attempt_digest_sha256, 'DIRECTED_REVIEW_EXECUTION_MISMATCH', `${label} attempt digest`);
      assertEqual(value?.execution_identity_sha256, loaded.attempt.execution.execution_identity_sha256, 'DIRECTED_REVIEW_EXECUTION_MISMATCH', `${label} execution identity`);
    }
  } else {
    // A first (LEGACY) render legitimately has no execution attempt: the
    // renderer mints immutable execution successors only when a frozen plan
    // is re-executed. Exact-byte review identity remains fully bound by the
    // completion/evidence/manifest digests and output hash checked above,
    // and no artifact may CLAIM an attempt that has no execution head.
    if (completion.renderer_execution_attempt) fail('DIRECTED_REVIEW_EXECUTION_HEAD_MISSING', basePaths.head);
    for (const [label, value] of [['evidence', evidence.execution_attempt], ['manifest', manifest.execution_attempt]]) {
      if (value) fail('DIRECTED_REVIEW_EXECUTION_MISMATCH', `${label} claims an execution attempt but no execution head exists`);
    }
    assertEqual(manifest.plan_digest_sha256, completion.renderer_plan_digest_sha256, 'DIRECTED_REVIEW_SEMANTIC_PLAN_MISMATCH', 'manifest semantic plan');
  }

  const scriptFile = resolveRef(runDir, handoff.production?.script?.path, 'DIRECTED_REVIEW_SCRIPT_MISSING');
  const scriptSha = sha256File(scriptFile);
  assertEqual(scriptSha, handoff.production.script.sha256, 'DIRECTED_REVIEW_SCRIPT_MISMATCH', 'handoff script hash');
  assertEqual(evidence.script?.sha256, scriptSha, 'DIRECTED_REVIEW_SCRIPT_MISMATCH', 'evidence script hash');
  assertEqual(manifest.story?.project_id, handoff.production?.story?.project_id, 'DIRECTED_REVIEW_SCRIPT_MISMATCH', 'story project');
  assertEqual(manifest.story?.version_id, handoff.production?.story?.version_id, 'DIRECTED_REVIEW_SCRIPT_MISMATCH', 'story version');
  assertEqual(manifest.story?.content_hash, handoff.production?.story?.content_hash, 'DIRECTED_REVIEW_SCRIPT_MISMATCH', 'story content');

  const releaseFile = resolveRef(runDir, handoff.production?.release_packet?.path, 'DIRECTED_REVIEW_RELEASE_MISSING');
  assertEqual(sha256File(releaseFile), handoff.production.release_packet.sha256, 'DIRECTED_REVIEW_RELEASE_MISMATCH', 'release hash');

  const segments = (handoff.visual?.composition?.beats || []).map((beat, index) => {
    const asset = primaryAssetForBeat(handoff, beat);
    return {
      order: index + 1, section_id: beat.section_id, beat: beat.beat_id,
      start_seconds: beat.start_ms / 1000, end_seconds: beat.end_ms / 1000,
      visual_asset_id: asset.id, visual_sha256: asset.sha256,
    };
  });
  if (!segments.length) fail('DIRECTED_REVIEW_TIMELINE_INVALID', 'handoff has no composition beats');

  const subject = {
    kind: SUBJECT_KINDS.DIRECTED,
    status: REVIEW_READY,
    run_id: runId,
    draft_version: evidence.draft_version,
    output: { path: evidence.output.path, absolute_path: outputFile, sha256: outputSha, duration_seconds: evidence.output.duration_seconds, bytes: evidence.output.bytes, width: evidence.output.width, height: evidence.output.height, fps: evidence.output.fps, has_audio: evidence.output.has_audio },
    assembly_manifest: { path: evidence.assembly_manifest.file, sha256: evidence.assembly_manifest.sha256 },
    semantic_plan_digest_sha256: loaded ? loaded.head.semantic_plan_digest_sha256 : completion.renderer_plan_digest_sha256,
    execution: loaded ? {
      attempt_id: loaded.attempt.attempt_id,
      attempt_digest_sha256: loaded.attempt.attempt_digest_sha256,
      execution_identity_sha256: loaded.attempt.execution.execution_identity_sha256,
      attempt_path: path.relative(runDir, loaded.paths.attempt), attempt_sha256: sha256File(loaded.paths.attempt),
      head_path: path.relative(runDir, basePaths.head), head_sha256: sha256File(basePaths.head),
      head_schema: execution.HEAD_SCHEMA, attempt_schema: execution.ATTEMPT_SCHEMA,
    } : null,
    handoff: { id: handoff.handoff_id, digest_sha256: handoff.handoff_digest_sha256, path: path.relative(runDir, handoffFile), file_sha256: sha256File(handoffFile), schema: handoff.schema },
    evidence: { path: path.relative(runDir, evidenceFile), sha256: sha256File(evidenceFile), schema: evidence.schema, state: evidence.state, technical_validation: evidence.technical_validation },
    story: handoff.production.story,
    script: { ...handoff.production.script, path: handoff.production.script.path },
    release: { ...handoff.production.release_packet, path: handoff.production.release_packet.path },
    narration: { fidelity: evidence.narration?.fidelity ?? manifest.narration_source_class, is_presenter_voice: evidence.narration?.is_presenter_voice === true, audio_sha256: evidence.narration?.audio_sha256 ?? null },
    segments,
    publication_ready: false,
  };
  subject.subject_digest_sha256 = digest(subjectBinding(subject));
  return subject;
}

function resolveLegacySubject(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const status = legacyAssembly.draftAssemblyStatus(runDir, options);
  if (!status.present) return null;
  if (!status.valid) fail('DRAFT_REVIEW_LEGACY_DRAFT_INVALID', `${status.code}: ${status.detail}`);
  const manifest = legacyAssembly.readManifest(runDir);
  const manifestFile = path.join(runDir, legacyAssembly.MANIFEST_FILE);
  const subject = {
    kind: SUBJECT_KINDS.LEGACY, status: REVIEW_READY, run_id: manifest.run_id,
    draft_version: manifest.draft_version,
    output: { path: manifest.output.path, absolute_path: path.resolve(runDir, manifest.output.path), sha256: manifest.output.sha256, duration_seconds: manifest.output.probe?.duration_seconds ?? null },
    assembly_manifest: { path: legacyAssembly.MANIFEST_FILE, sha256: sha256File(manifestFile) },
    semantic_plan_digest_sha256: manifest.plan_digest_sha256 ?? null,
    execution: null, handoff: null, evidence: null, story: null, script: manifest.script, release: null,
    narration: { fidelity: manifest.fidelity, is_presenter_voice: null, audio_sha256: null }, segments: manifest.segments || [], publication_ready: false,
  };
  subject.subject_digest_sha256 = digest(subjectBinding(subject));
  return subject;
}

function resolveReviewSubject(runDir, options = {}) {
  const directedSubject = resolveDirectedSubject(runDir);
  if (directedSubject) return directedSubject;
  const legacySubject = resolveLegacySubject(runDir, options);
  if (legacySubject) return legacySubject;
  fail('DRAFT_REVIEW_NO_DRAFT', 'this run has no assembled draft to review');
}

function inspectReviewSubject(runDir, options = {}) {
  try { return { present: true, valid: true, code: null, detail: null, subject: resolveReviewSubject(runDir, options) }; }
  catch (error) { return { present: fs.existsSync(directedStatePath(path.resolve(runDir))) || fs.existsSync(path.join(path.resolve(runDir), legacyAssembly.MANIFEST_FILE)), valid: false, code: error.code || 'DRAFT_REVIEW_SUBJECT_INVALID', detail: error.message, subject: null }; }
}

function canonicalApprovalStatus(runDir, subject) {
  let research = { approved: false, current: false, state: 'NOT_APPROVED', source: 'package-run-research-evidence' };
  try {
    const evaluated = researchEvidence.evaluateResearchEvidence(runDir);
    research = { approved: evaluated.status === 'PASS' && evaluated.approval === true, current: evaluated.status === 'PASS' && evaluated.approval === true, state: evaluated.status, source: 'package-run-research-evidence', blockers: evaluated.blockers };
  } catch (error) { research = { ...research, state: 'UNAVAILABLE', blockers: [error.message] }; }
  const scriptApproved = String(subject.story?.approval_state || '').toLowerCase() === 'approved';
  return {
    script: { approved: scriptApproved, current: scriptApproved, state: scriptApproved ? 'APPROVED' : 'NOT_APPROVED', source: 'canonical story authority' },
    research,
  };
}

module.exports = {
  SUBJECT_KINDS, REVIEW_READY, NOT_REVIEW_READY, DraftReviewSubjectError,
  sha256File, digest, subjectBinding, directedStatePath,
  resolveDirectedSubject, resolveLegacySubject, resolveReviewSubject, inspectReviewSubject,
  canonicalApprovalStatus,
};
