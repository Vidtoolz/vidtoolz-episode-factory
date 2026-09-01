#!/usr/bin/env node
'use strict';

/*
 * Final Production Lock — the immutable bridge from an approved Draft into
 * Final Production.
 *
 *   DRAFT_REVIEW_READY → (real human review) → DRAFT_APPROVED
 *     → vidtoolz.finalProductionLock.v1 → FINAL_PRODUCTION_PACKAGE
 *
 * The lock means exactly one thing:
 *
 *   "This SCRIPT and CREATIVE DIRECTION are approved for Final Production."
 *
 * It does NOT mean the Draft media is publication media. Draft stills are
 * concept prototypes, Draft music is provisional, and Draft narration — even
 * when a human recorded it as an exception — is never the final performance.
 * Final Production rebuilds the publication assets from the locked script.
 *
 * Everything the lock binds is resolved from canonical authorities and
 * hash-verified. A caller cannot confer authority by asserting an id: the
 * approved Draft comes from draft-review-subject, the approval from
 * draft-review-intake's own promotion projection, and research approval from
 * the research-evidence authority (directly, or inherited through the
 * hash-bound immutable successor lineage — see resolveResearchApproval).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const review = require('./draft-review-intake.js');
const reviewSubject = require('./draft-review-subject.js');
const researchEvidence = require('./package-run-research-evidence.js');
const storyBinding = require('./package-run-story-binding.js');
const productionMode = require('./package-run-production-mode.js');

const LOCK_SCHEMA = 'vidtoolz.finalProductionLock.v1';
const BREAK_SCHEMA = 'vidtoolz.finalProductionLockBreak.v1';
const LOCK_FILE = 'final-production-lock.json';
const SUCCESSOR_CONTRACT_FILE = 'draft-bespoke-successor.json';

/* The lifecycle this lock sits inside. Reused by the package and its
 * next-action projection so there is ONE state vocabulary. */
const LIFECYCLE = Object.freeze([
  'DRAFT_REVIEW_READY', 'DRAFT_APPROVED', 'FINAL_PRODUCTION_LOCKED',
  'FINAL_PRODUCTION_PACKAGE_READY', 'FINAL_ASSETS_COMPLETE',
  'FINAL_HUMAN_PERFORMANCE_COMPLETE', 'FINAL_EDIT_COMPLETE', 'FINAL_QC_PASS',
  'PUBLICATION_APPROVED',
]);

class FinalProductionLockError extends Error {
  constructor(code, message) { super(message); this.name = 'FinalProductionLockError'; this.code = code; }
}
function fail(code, message) { throw new FinalProductionLockError(code, message); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file, code = 'FINAL_LOCK_JSON_INVALID') {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(code, `${file}: ${error.message}`); }
}
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function writeImmutable(file, value) {
  const payload = jsonBytes(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('FINAL_LOCK_IMMUTABLE_CONFLICT', file);
    return false;
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  return true;
}
function lockCore(lock) { const copy = { ...lock }; delete copy.lock_digest_sha256; return copy; }
function lockPath(runDir) { return path.join(path.resolve(runDir), LOCK_FILE); }

/* ── research approval: own run, or the hash-bound successor lineage ─────── */

/*
 * A Draft successor run legitimately carries NO research pack of its own: it
 * inherits its Story from an immutable Production predecessor, and the
 * research evidence lives with that predecessor. Evaluating only the current
 * directory therefore reports a structural false negative.
 *
 * Inheritance is allowed ONLY through the chain the successor authority
 * already writes and hash-binds:
 *   - draft-bespoke-successor.json .predecessor.run_id
 *   - story-binding.json .provenance.predecessor_run_id (must agree)
 *   - story-binding.json .provenance.predecessor_binding_sha256 must equal the
 *     predecessor's actual story-binding bytes
 *   - the predecessor must be PRODUCTION mode and the same Story project
 * Anything short of that is NOT approval. This is inheritance through verified
 * lineage, never a waiver and never a fabrication.
 */
function resolveResearchApproval(runDirInput) {
  const runDir = path.resolve(runDirInput);
  let own;
  try { own = researchEvidence.evaluateResearchEvidence(runDir); }
  catch (error) { own = { status: 'UNAVAILABLE', approval: false, blockers: [error.message] }; }
  if (own.status === 'PASS' && own.approval === true) {
    return { approved: true, source: 'OWN_RUN', state: own.status, blockers: [], lineage: null };
  }
  const binding = storyBinding.readBinding(runDir);
  const provenance = binding?.provenance || null;
  const contractFile = path.join(runDir, SUCCESSOR_CONTRACT_FILE);
  if (!provenance?.predecessor_run_id || !fs.existsSync(contractFile)) {
    return { approved: false, source: 'OWN_RUN', state: own.status, blockers: own.blockers || [], lineage: null };
  }
  const contract = readJson(contractFile, 'FINAL_LOCK_SUCCESSOR_CONTRACT_INVALID');
  if (contract.predecessor?.run_id !== provenance.predecessor_run_id) {
    fail('FINAL_LOCK_RESEARCH_LINEAGE_INCONSISTENT', `successor contract names ${contract.predecessor?.run_id}; story binding names ${provenance.predecessor_run_id}`);
  }
  const predecessorRunDir = path.join(path.dirname(runDir), provenance.predecessor_run_id);
  const predecessorBindingFile = path.join(predecessorRunDir, storyBinding.BINDING_FILE);
  if (!fs.existsSync(predecessorBindingFile)) fail('FINAL_LOCK_RESEARCH_LINEAGE_UNVERIFIABLE', predecessorBindingFile);
  const actualBindingSha = sha256File(predecessorBindingFile);
  if (actualBindingSha !== provenance.predecessor_binding_sha256) {
    fail('FINAL_LOCK_RESEARCH_LINEAGE_TAMPERED', `predecessor story binding is ${actualBindingSha}; the successor pinned ${provenance.predecessor_binding_sha256}`);
  }
  const predecessorMode = productionMode.readProductionMode(predecessorRunDir);
  if (predecessorMode.mode !== productionMode.PRODUCTION) {
    fail('FINAL_LOCK_RESEARCH_LINEAGE_INVALID', `predecessor ${provenance.predecessor_run_id} is ${predecessorMode.mode}, not PRODUCTION`);
  }
  const predecessorBinding = readJson(predecessorBindingFile, 'FINAL_LOCK_RESEARCH_LINEAGE_UNVERIFIABLE');
  if (predecessorBinding.story?.project_id !== binding.story?.project_id) {
    fail('FINAL_LOCK_RESEARCH_LINEAGE_INVALID', 'predecessor belongs to a different Story project');
  }
  let inherited;
  try { inherited = researchEvidence.evaluateResearchEvidence(predecessorRunDir); }
  catch (error) { inherited = { status: 'UNAVAILABLE', approval: false, blockers: [error.message] }; }
  if (inherited.status !== 'PASS' || inherited.approval !== true) {
    return {
      approved: false, source: 'PREDECESSOR_PRODUCTION_RUN', state: inherited.status,
      blockers: inherited.blockers || [], own_run_blockers: own.blockers || [],
      lineage: { predecessor_run_id: provenance.predecessor_run_id, predecessor_binding_sha256: actualBindingSha },
    };
  }
  return {
    approved: true, source: 'INHERITED_FROM_PREDECESSOR_PRODUCTION_RUN', state: inherited.status, blockers: [],
    own_run_state: own.status, own_run_blockers: own.blockers || [],
    lineage: {
      predecessor_run_id: provenance.predecessor_run_id,
      predecessor_binding_sha256: actualBindingSha,
      predecessor_mode: predecessorMode.mode,
      story_project_id: binding.story.project_id,
      immutable_successor: provenance.immutable_successor === true,
      basis: 'the successor carries no research pack by design; its Story descends from this Production predecessor through a hash-bound immutable binding, and that predecessor\'s research evidence is PASS',
    },
  };
}

/* ── the approved Draft, resolved fail-closed ────────────────────────────── */

function resolveApprovedDraft(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const inspection = reviewSubject.inspectReviewSubject(runDir, options);
  if (!inspection.present) fail('FINAL_LOCK_NO_DRAFT', 'this run has no assembled draft');
  if (!inspection.valid) fail('FINAL_LOCK_DRAFT_INVALID', `${inspection.code}: ${inspection.detail}`);
  const subject = inspection.subject;
  const view = review.promotionDecisionView(runDir, options);
  if (!view.current_review) fail('FINAL_LOCK_APPROVAL_MISSING', 'no submitted human review is bound to the exact current draft');
  if (view.decision.changes_requested) fail('FINAL_LOCK_CHANGES_REQUESTED', 'the current review requests changes — revise the Draft instead of locking it');
  if (!view.decision.draft_approved || view.review_state !== 'DRAFT_APPROVED') {
    fail('FINAL_LOCK_DRAFT_NOT_APPROVED', `review state is ${view.review_state}; a Final Production Lock requires DRAFT_APPROVED`);
  }
  const status = review.reviewStatus(runDir, view.current_review.review_id, options);
  if (!status.current || status.binding_intact === false || status.submission_intact === false) {
    fail('FINAL_LOCK_APPROVAL_STALE', status.detail || 'the approval is not bound to the exact current draft bytes');
  }
  /* The caller must NAME the bytes it believes it is locking. This is what
   * makes "approval copied onto a different render" impossible. */
  if (options.expectedDraftSha256 !== undefined) {
    if (options.expectedDraftSha256 !== subject.output.sha256) {
      fail('FINAL_LOCK_DRAFT_SHA_MISMATCH', `caller expects ${options.expectedDraftSha256}; the approved current draft is ${subject.output.sha256}`);
    }
  }
  const outputFile = subject.output.absolute_path;
  if (!fs.existsSync(outputFile)) fail('FINAL_LOCK_DRAFT_MISSING', outputFile);
  if (sha256File(outputFile) !== subject.output.sha256) fail('FINAL_LOCK_DRAFT_SHA_MISMATCH', 'draft bytes changed after approval');
  if (subject.evidence?.state !== 'VERIFIED') fail('FINAL_LOCK_EVIDENCE_NOT_VERIFIED', String(subject.evidence?.state));
  if (String(subject.story?.approval_state).toLowerCase() !== 'approved') fail('FINAL_LOCK_SCRIPT_NOT_APPROVED', String(subject.story?.approval_state));
  return { runDir, subject, view, reviewRecord: status.review, reviewStatus: status };
}

/* ── lock creation ───────────────────────────────────────────────────────── */

function createFinalProductionLock(runDirInput, options = {}) {
  const resolved = resolveApprovedDraft(runDirInput, options);
  const { runDir, subject, reviewRecord } = resolved;
  const research = resolveResearchApproval(runDir);
  if (!research.approved) {
    fail('FINAL_LOCK_RESEARCH_APPROVAL_REQUIRED',
      `research evidence is not approved for this production (source ${research.source}, state ${research.state}): ${(research.blockers || []).join('; ')}`);
  }
  const reviewFile = review.reviewFile(runDir, reviewRecord.review_id);
  const scriptFile = path.isAbsolute(subject.script.path) ? subject.script.path : path.resolve(runDir, subject.script.path);
  if (!fs.existsSync(scriptFile)) fail('FINAL_LOCK_SCRIPT_MISSING', subject.script.path);
  if (sha256File(scriptFile) !== subject.script.sha256) fail('FINAL_LOCK_SCRIPT_DRIFT', subject.script.path);

  const existing = fs.existsSync(lockPath(runDir)) ? readJson(lockPath(runDir)) : null;
  const predecessorLock = existing && options.successorOfLockId
    ? (existing.lock_id === options.successorOfLockId ? existing : fail('FINAL_LOCK_PREDECESSOR_MISMATCH', options.successorOfLockId))
    : null;

  const core = {
    schema: LOCK_SCHEMA,
    artifact_type: 'final-production-lock',
    run_id: subject.run_id,
    project_id: subject.story.project_id,
    meaning: 'This SCRIPT and CREATIVE DIRECTION are approved for Final Production.',
    does_not_mean: [
      'the Draft media is publication media',
      'Draft stills are final assets',
      'Draft music is final music',
      'Draft narration is the final human performance',
      'publication is approved',
    ],
    approved_draft: {
      draft_version: subject.draft_version,
      output_path: subject.output.path,
      output_sha256: subject.output.sha256,
      duration_seconds: subject.output.duration_seconds,
      review_subject_digest_sha256: subject.subject_digest_sha256,
      assembly_manifest_sha256: subject.assembly_manifest.sha256,
      semantic_plan_digest_sha256: subject.semantic_plan_digest_sha256,
    },
    human_approval: {
      authority: reviewRecord.reviewer_authority,
      reviewer: reviewRecord.reviewer,
      recorded_by: reviewRecord.recorded_by,
      review_schema: review.REVIEW_SCHEMA,
      review_id: reviewRecord.review_id,
      review_file_sha256: sha256File(reviewFile),
      binding_digest_sha256: reviewRecord.binding_digest_sha256,
      submission_digest_sha256: reviewRecord.submission_digest_sha256,
      draft_verdict: reviewRecord.draft_verdict,
      draft_verdict_note: reviewRecord.draft_verdict_note,
      submitted_at: reviewRecord.submitted_at,
      changes_requested: false,
      derived_state: 'DRAFT_APPROVED',
    },
    locked_script: {
      story_project_id: subject.story.project_id,
      story_version_id: subject.story.version_id,
      story_content_hash: subject.story.content_hash,
      story_approval_state: subject.story.approval_state,
      script_path: subject.script.path,
      script_sha256: subject.script.sha256,
      script_schema: subject.script.schema,
      immutable_after_lock: true,
      change_requires: ['explicit lock break with named human authority', 'a successor lock', 'new human approval of the changed Draft'],
    },
    creative_direction: {
      visual_plan_digest_sha256: subject.semantic_plan_digest_sha256,
      draft_music_decision: 'provisional — see final music brief; Draft music never becomes FINAL_MUSIC_AUTHORITY automatically',
      beat_count: subject.segments.length,
      beat_identity: subject.segments.map((segment) => ({ order: segment.order, beat_id: segment.beat, section_id: segment.section_id, start_seconds: segment.start_seconds, end_seconds: segment.end_seconds })),
    },
    directed_draft_authority: {
      handoff_id: subject.handoff.id,
      handoff_digest_sha256: subject.handoff.digest_sha256,
      handoff_file_sha256: subject.handoff.file_sha256,
      release_sha256: subject.release.sha256,
      evidence_path: subject.evidence.path,
      evidence_sha256: subject.evidence.sha256,
      evidence_state: subject.evidence.state,
      execution: subject.execution ? {
        attempt_id: subject.execution.attempt_id,
        attempt_digest_sha256: subject.execution.attempt_digest_sha256,
        execution_identity_sha256: subject.execution.execution_identity_sha256,
        head_sha256: subject.execution.head_sha256,
      } : { kind: 'LEGACY_FIRST_RENDER', note: 'the approved render minted no execution successor; identity is bound by completion/evidence/manifest digests and the output hash' },
    },
    research_approval: research,
    draft_narration: {
      fidelity: subject.narration.fidelity,
      audio_sha256: subject.narration.audio_sha256,
      is_presenter_voice: subject.narration.is_presenter_voice,
      final_human_performance_authority: false,
      doctrine: 'This Draft carries a human-recorded narration as an EXCEPTION. Normal Draft narration is synthetic. Draft narration NEVER satisfies the Final Production performance requirement: a fresh, separately selected lock-bound Mikko performance of the locked script is required.',
    },
    final_production_requirements: {
      final_visual_assets: 'REQUIRED — rebuilt from the locked script; Draft stills are concept prototypes only',
      final_human_performance: 'REQUIRED — a fresh Mikko performance of the locked script',
      final_music: 'REQUIRED — re-made or re-selected; Draft music is provisional',
      final_edit: 'REQUIRED — manual Resolve edit',
      final_qc: 'REQUIRED',
      publication_approval: 'REQUIRED — Mikko only',
    },
    authority: {
      final_production_locked: true,
      publication_authority: false,
      publication_ready: false,
      final_master_exists: false,
      final_qc_pass: false,
      grants_final_asset_authority: false,
      grants_final_music_authority: false,
      grants_final_performance_authority: false,
    },
    predecessor_lock: predecessorLock ? { lock_id: predecessorLock.lock_id, lock_digest_sha256: predecessorLock.lock_digest_sha256 } : null,
    created_at: options.now || new Date().toISOString(),
    created_by: options.createdBy || 'final-production-lock',
  };
  const lockId = `final-production-lock-${subject.run_id}-r${subject.draft_version}-${digest(core).slice(0, 16)}`;
  const withId = { ...core, lock_id: lockId };
  const lock = { ...withId, lock_digest_sha256: digest(lockCore(withId)) };
  validateFinalProductionLock(lock);
  const target = lockPath(runDir);
  if (fs.existsSync(target)) {
    const current = readJson(target);
    if (current.lock_digest_sha256 === lock.lock_digest_sha256) return { state: 'ALREADY_LOCKED', lock: current, lock_path: target };
    if (!options.successorOfLockId) {
      fail('FINAL_LOCK_DUPLICATE_INCOMPATIBLE', `${target} already holds a different lock (${current.lock_id}); a successor lock requires an explicit lock break`);
    }
  }
  writeImmutable(target, lock);
  return { state: 'LOCKED', lock, lock_path: target };
}

/* ── validation, load, staleness ─────────────────────────────────────────── */

function validateFinalProductionLock(lock) {
  if (lock?.schema !== LOCK_SCHEMA) fail('FINAL_LOCK_INVALID', `schema ${lock?.schema}`);
  if (lock.lock_digest_sha256 !== digest(lockCore(lock))) fail('FINAL_LOCK_TAMPERED', 'lock digest mismatch');
  const authority = lock.authority || {};
  if (authority.final_production_locked !== true) fail('FINAL_LOCK_INVALID', 'final_production_locked must be true');
  for (const field of ['publication_authority', 'publication_ready', 'final_master_exists', 'final_qc_pass',
    'grants_final_asset_authority', 'grants_final_music_authority', 'grants_final_performance_authority']) {
    if (authority[field] !== false) fail('FINAL_LOCK_AUTHORITY_ESCALATION', `${field} must be false — a lock never grants final asset, music, performance or publication authority`);
  }
  if (lock.human_approval?.derived_state !== 'DRAFT_APPROVED') fail('FINAL_LOCK_INVALID', 'lock requires a DRAFT_APPROVED human approval');
  if (lock.human_approval?.changes_requested !== false) fail('FINAL_LOCK_INVALID', 'a lock cannot carry a changes-requested approval');
  if (lock.draft_narration?.final_human_performance_authority !== false) fail('FINAL_LOCK_AUTHORITY_ESCALATION', 'Draft narration can never hold final performance authority');
  if (lock.locked_script?.immutable_after_lock !== true) fail('FINAL_LOCK_INVALID', 'the locked script must be immutable after lock');
  if (lock.research_approval?.approved !== true) fail('FINAL_LOCK_INVALID', 'a lock requires approved research evidence');
  if (!/^[a-f0-9]{64}$/.test(lock.approved_draft?.output_sha256 || '')) fail('FINAL_LOCK_INVALID', 'approved draft sha malformed');
  return true;
}

function loadFinalProductionLock(runDirInput) {
  const file = lockPath(runDirInput);
  if (!fs.existsSync(file)) fail('FINAL_LOCK_MISSING', file);
  const lock = readJson(file);
  validateFinalProductionLock(lock);
  return { lock, lock_path: file };
}

/*
 * Is a stored lock still the truth about this run? A lock goes stale if the
 * approved bytes, the approval record, the Story/script or the Directed Draft
 * identity it bound has moved. A stale lock is never reinterpreted.
 */
function verifyLockCurrent(runDirInput, lock, options = {}) {
  const runDir = path.resolve(runDirInput);
  validateFinalProductionLock(lock);
  const inspection = reviewSubject.inspectReviewSubject(runDir, options);
  if (!inspection.valid) fail('FINAL_LOCK_STALE', `current draft subject invalid: ${inspection.code}`);
  const subject = inspection.subject;
  if (subject.subject_digest_sha256 !== lock.approved_draft.review_subject_digest_sha256) {
    fail('FINAL_LOCK_STALE', 'the locked Draft is no longer this run\'s current draft');
  }
  if (subject.output.sha256 !== lock.approved_draft.output_sha256) fail('FINAL_LOCK_STALE', 'approved draft bytes changed');
  const status = review.reviewStatus(runDir, lock.human_approval.review_id, options);
  if (!status.present || !status.current || status.binding_intact === false || status.submission_intact === false) {
    fail('FINAL_LOCK_STALE', `the bound approval is no longer current: ${status.detail || 'unknown'}`);
  }
  if (sha256File(review.reviewFile(runDir, lock.human_approval.review_id)) !== lock.human_approval.review_file_sha256) {
    fail('FINAL_LOCK_STALE', 'approval review bytes changed after locking');
  }
  if (subject.story.version_id !== lock.locked_script.story_version_id
      || subject.story.content_hash !== lock.locked_script.story_content_hash) {
    fail('FINAL_LOCK_SCRIPT_DRIFT', 'the locked Story version or content hash changed — a locked script may not be mutated in place');
  }
  const scriptFile = path.isAbsolute(lock.locked_script.script_path) ? lock.locked_script.script_path : path.resolve(runDir, lock.locked_script.script_path);
  if (!fs.existsSync(scriptFile) || sha256File(scriptFile) !== lock.locked_script.script_sha256) {
    fail('FINAL_LOCK_SCRIPT_DRIFT', 'locked script bytes changed');
  }
  if (subject.handoff?.digest_sha256 !== lock.directed_draft_authority.handoff_digest_sha256) fail('FINAL_LOCK_STALE', 'Directed Draft handoff changed');
  if (subject.evidence?.sha256 !== lock.directed_draft_authority.evidence_sha256) fail('FINAL_LOCK_STALE', 'technical evidence changed');
  if (subject.release?.sha256 !== lock.directed_draft_authority.release_sha256) fail('FINAL_LOCK_STALE', 'release identity changed');
  return { subject, status };
}

/* An explicit, human-authored lock break. Never implicit, never silent. */
function breakFinalProductionLock(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const { lock } = loadFinalProductionLock(runDir);
  if (!options.authority || typeof options.authority !== 'string') fail('FINAL_LOCK_BREAK_AUTHORITY_REQUIRED', 'a named human authority is required to break a Final Production Lock');
  if (!options.reason || String(options.reason).trim().length < 10) fail('FINAL_LOCK_BREAK_REASON_REQUIRED', 'an explicit reason is required');
  const core = {
    schema: BREAK_SCHEMA, run_id: lock.run_id, broken_lock_id: lock.lock_id,
    broken_lock_digest_sha256: lock.lock_digest_sha256,
    authority: { type: 'HUMAN', id: options.authority }, reason: String(options.reason),
    broken_at: options.now || new Date().toISOString(),
    effect: 'the locked script and creative direction are reopened; a successor lock requires a new human approval of the changed Draft',
  };
  const record = { ...core, break_digest_sha256: digest(core) };
  const target = path.join(runDir, `final-production-lock-break-${record.break_digest_sha256.slice(0, 16)}.json`);
  writeImmutable(target, record);
  return { state: 'LOCK_BROKEN', record, path: target };
}

/* Run-level projection over the existing state vocabulary. Creates no second
 * global production-state authority. */
function lockStatus(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const view = review.promotionDecisionView(runDir, options);
  let lock = null; let stale = null;
  if (fs.existsSync(lockPath(runDir))) {
    try {
      lock = loadFinalProductionLock(runDir).lock;
      try { verifyLockCurrent(runDir, lock, options); } catch (error) { stale = { code: error.code, message: error.message }; }
    } catch (error) { stale = { code: error.code, message: error.message }; }
  }
  const research = (() => { try { return resolveResearchApproval(runDir); } catch (error) { return { approved: false, source: 'ERROR', state: error.code, blockers: [error.message] }; } })();
  /* A stale lock outranks every other signal: "you locked a Draft and what it
   * locked has moved" is the actionable truth, and reporting a generic missing
   * draft instead would hide it. */
  const state = lock && stale ? 'FINAL_PRODUCTION_LOCK_STALE'
    : lock ? 'FINAL_PRODUCTION_LOCKED'
      : !view.current_draft ? 'NO_CURRENT_DRAFT'
        : view.review_state === 'DRAFT_CHANGES_REQUESTED' ? 'DRAFT_CHANGES_REQUESTED'
          : view.review_state === 'DRAFT_APPROVED' ? 'DRAFT_APPROVED' : 'DRAFT_REVIEW_READY';
  return {
    run_id: path.basename(runDir), state,
    review_state: view.review_state,
    draft_approved: view.decision.draft_approved,
    current_draft: view.current_draft ? { draft_version: view.current_draft.draft_version, output_sha256: view.current_draft.output_sha256 } : null,
    research_approval: { approved: research.approved, source: research.source, state: research.state },
    lock: lock ? { lock_id: lock.lock_id, lock_digest_sha256: lock.lock_digest_sha256, created_at: lock.created_at } : null,
    lock_stale: stale,
    lifecycle: LIFECYCLE,
    final_production_locked: Boolean(lock && !stale),
    publication_ready: false,
    final_qc_pass: false,
    publication_approved: false,
  };
}

module.exports = {
  LOCK_SCHEMA, BREAK_SCHEMA, LOCK_FILE, LIFECYCLE,
  FinalProductionLockError, canonicalize, digest, sha256File, lockCore, lockPath,
  resolveResearchApproval, resolveApprovedDraft, createFinalProductionLock,
  validateFinalProductionLock, loadFinalProductionLock, verifyLockCurrent,
  breakFinalProductionLock, lockStatus,
};
