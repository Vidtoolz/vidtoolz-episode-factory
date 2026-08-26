'use strict';

/*
 * Human boundary review contract.
 *
 * Analysis may propose integer-millisecond intervals, but only an explicit
 * click from a locally verified human can change a proposal to
 * HUMAN_CONFIRMED. The session is hash-bound after every transition. This
 * module neither slices media nor treats a derivative as performance authority.
 */
const crypto = require('node:crypto');
const humanIdentity = require('./human-approval-identity.js');

const SESSION_SCHEMA = 'vidtoolz.presenterBoundaryReview.v1';
const SUCCESSOR_SCHEMA = 'vidtoolz.humanPerformanceReview.v2';
const PROVISIONAL_CLASSES = new Set(['MACHINE_INFERRED_PROVISIONAL', 'TRANSCRIPT_ALIGNED_PROVISIONAL']);
const HUMAN_CLASS = 'HUMAN_CONFIRMED';
const SHA_RE = /^[a-f0-9]{64}$/;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digestWithout(value, field) { const copy = structuredClone(value); delete copy[field]; return sha256(canonicalize(copy)); }
function sessionDigest(value) { return digestWithout(value, 'binding_digest_sha256'); }
function successorDigest(value) { return digestWithout(value, 'binding_digest_sha256'); }
function sealSession(value) { const next = structuredClone(value); next.binding_digest_sha256 = sessionDigest(next); return next; }
function validDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function sameStory(a, b) { return Boolean(a && b && a.project_id === b.project_id && a.version_id === b.version_id && a.content_hash === b.content_hash && a.approval_state === b.approval_state); }
function samePlan(a, b) { return Boolean(a && b && a.plan_id === b.plan_id && a.version === b.version && a.digest_sha256 === b.digest_sha256 && a.approval_state === b.approval_state); }
function verifiedHuman(actor, verifier = humanIdentity.verifyLocalHumanApprover) {
  return Boolean(actor?.type === 'HUMAN' && actor.id && verifier(actor.id) === true);
}

function validateInterval(interval, durationMs) {
  if (!Number.isInteger(interval?.in_ms) || !Number.isInteger(interval?.out_ms)) fail('BOUNDARY_INTEGER_MS_REQUIRED', 'boundaries must be integer milliseconds');
  if (interval.in_ms < 0 || interval.out_ms <= interval.in_ms) fail('BOUNDARY_INTERVAL_INVALID', 'out must be greater than in and in must be non-negative');
  if (!Number.isInteger(durationMs) || durationMs <= 0 || interval.out_ms > durationMs) fail('BOUNDARY_OUT_OF_RANGE', 'boundary exceeds the measured master duration');
}

function validateSession(session, options = {}) {
  const errors = [];
  const add = (code, detail) => errors.push({ code, detail });
  if (session?.schema !== SESSION_SCHEMA || session?.artifact_type !== 'presenter-boundary-review') add('BOUNDARY_SESSION_SCHEMA_INVALID', 'schema/artifact type');
  if (!session?.run_id || session?.production_mode !== 'PRODUCTION') add('BOUNDARY_SESSION_MODE_INVALID', 'PRODUCTION run required');
  if (!SHA_RE.test(session?.binding_digest_sha256 || '') || sessionDigest(session) !== session.binding_digest_sha256) add('BOUNDARY_SESSION_DIGEST_INVALID', 'session changed without resealing');
  if (!session?.story?.project_id || !session?.story?.version_id || !SHA_RE.test(session?.story?.content_hash || '') || session.story.approval_state !== 'approved') add('BOUNDARY_STORY_INVALID', 'approved exact Story required');
  if (!session?.visual_plan?.plan_id || !session?.visual_plan?.version || !SHA_RE.test(session?.visual_plan?.digest_sha256 || '') || session.visual_plan.approval_state !== 'approved') add('BOUNDARY_PLAN_INVALID', 'approved exact VP2 required');
  if (options.currentStory && !sameStory(session.story, options.currentStory)) add('BOUNDARY_STORY_DRIFT', 'Story differs from current authority');
  if (options.currentVisualPlan && !samePlan(session.visual_plan, options.currentVisualPlan)) add('BOUNDARY_PLAN_DRIFT', 'VP2 differs from current authority');
  if (!session?.predecessor_review?.path || !SHA_RE.test(session?.predecessor_review?.sha256 || '')) add('BOUNDARY_PREDECESSOR_INVALID', 'exact predecessor review required');
  const masters = new Map();
  for (const master of session?.masters || []) {
    if (!master.master_id || masters.has(master.master_id) || !SHA_RE.test(master.sha256 || '') || !Number.isInteger(master.duration_ms) || master.duration_ms <= 0) add('BOUNDARY_MASTER_INVALID', String(master.master_id));
    masters.set(master.master_id, master);
  }
  const sections = new Set();
  const activeByMaster = new Map();
  for (const item of session?.sections || []) {
    if (!item.section_id || sections.has(item.section_id)) add('BOUNDARY_SECTION_DUPLICATE', String(item.section_id));
    sections.add(item.section_id);
    const master = masters.get(item.master_id);
    if (!master || master.sha256 !== item.master_sha256 || !master.section_ids?.includes(item.section_id)) add('BOUNDARY_MASTER_MEMBERSHIP_INVALID', String(item.section_id));
    try { validateInterval(item.current, master?.duration_ms); } catch (error) { add(error.code, item.section_id); }
    if (!PROVISIONAL_CLASSES.has(item.proposal?.boundary_class)) add('BOUNDARY_PROPOSAL_CLASS_INVALID', String(item.section_id));
    if (item.state === 'CONFIRMED') {
      if (item.boundary_class !== HUMAN_CLASS || !verifiedHuman(item.confirmed_by, options.humanIdentityVerifier) || !validDate(item.confirmed_at)) add('BOUNDARY_HUMAN_CONFIRMATION_INVALID', item.section_id);
      if (!SHA_RE.test(item.confirmation_digest_sha256 || '') || item.confirmation_digest_sha256 !== sha256(canonicalize({ run_id: session.run_id, story: session.story, visual_plan: session.visual_plan, master_id: item.master_id, master_sha256: item.master_sha256, section_id: item.section_id, recording_unit_id: item.recording_unit_id, in_ms: item.current.in_ms, out_ms: item.current.out_ms, actor: item.confirmed_by, confirmed_at: item.confirmed_at }))) add('BOUNDARY_CONFIRMATION_DIGEST_INVALID', item.section_id);
    } else if (item.state !== 'PROVISIONAL' || item.boundary_class !== item.proposal.boundary_class) add('BOUNDARY_STATE_INVALID', String(item.section_id));
    if (item.state === 'CONFIRMED') {
      const prior = activeByMaster.get(item.master_id) || [];
      if (prior.some((p) => item.current.in_ms < p.current.out_ms && item.current.out_ms > p.current.in_ms)) add('BOUNDARY_CONFIRMED_OVERLAP', item.section_id);
      prior.push(item); activeByMaster.set(item.master_id, prior);
    }
  }
  return { ok: errors.length === 0, errors, confirmed: (session?.sections || []).filter((s) => s.state === 'CONFIRMED').length, total: (session?.sections || []).length };
}

function createSession(input = {}) {
  const masters = structuredClone(input.masters || []);
  const byMaster = new Map(masters.map((m) => [m.master_id, m]));
  const sections = (input.sections || []).map((section) => {
    const master = byMaster.get(section.master_id);
    if (!master) fail('BOUNDARY_MASTER_UNKNOWN', String(section.master_id));
    const current = { in_ms: section.proposal.in_ms, out_ms: section.proposal.out_ms };
    validateInterval(current, master.duration_ms);
    if (!PROVISIONAL_CLASSES.has(section.proposal.boundary_class)) fail('BOUNDARY_PROPOSAL_CLASS_INVALID', section.section_id);
    return {
      section_id: section.section_id, recording_unit_id: section.recording_unit_id,
      story_order: section.story_order, approved_script_excerpt: section.approved_script_excerpt,
      master_id: master.master_id, master_sha256: master.sha256,
      planned_framing: section.planned_framing, captured_framing: section.captured_framing,
      crop_policy: section.crop_policy || { class: 'MACHINE_MEASURED_PROVISIONAL', proposal: null },
      proposal: structuredClone(section.proposal), current,
      state: 'PROVISIONAL', boundary_class: section.proposal.boundary_class,
      confirmed_by: null, confirmed_at: null, confirmation_digest_sha256: null,
    };
  });
  const session = sealSession({
    schema: SESSION_SCHEMA, artifact_type: 'presenter-boundary-review',
    run_id: input.run_id, production_mode: input.production_mode,
    story: structuredClone(input.story), visual_plan: structuredClone(input.visual_plan),
    visual_plan_approval_evidence: structuredClone(input.visual_plan_approval_evidence),
    predecessor_review: structuredClone(input.predecessor_review),
    masters, sections,
    insert_policy: structuredClone(input.insert_policy || []),
    music_policy: structuredClone(input.music_policy || { state: 'MUSIC_DURATION_POLICY_HUMAN_DECISION_REQUIRED' }),
    prepared_at: input.prepared_at, prepared_by: input.prepared_by,
    binding_digest_sha256: '',
  });
  const checked = validateSession(session);
  if (!checked.ok) fail('BOUNDARY_SESSION_INVALID', JSON.stringify(checked.errors));
  return session;
}

function adjustBoundary(session, input = {}) {
  if (sessionDigest(session) !== session.binding_digest_sha256) fail('BOUNDARY_SESSION_DIGEST_INVALID', 'session changed without resealing');
  if (!['in_ms', 'out_ms'].includes(input.edge) || !Number.isInteger(input.delta_ms)) fail('BOUNDARY_ADJUSTMENT_INVALID', 'edge and integer delta_ms required');
  const next = structuredClone(session); const item = next.sections.find((s) => s.section_id === input.section_id);
  if (!item) fail('BOUNDARY_SECTION_UNKNOWN', String(input.section_id));
  const master = next.masters.find((m) => m.master_id === item.master_id);
  item.current[input.edge] += input.delta_ms; validateInterval(item.current, master.duration_ms);
  item.state = 'PROVISIONAL'; item.boundary_class = item.proposal.boundary_class; item.confirmed_by = null; item.confirmed_at = null; item.confirmation_digest_sha256 = null;
  return sealSession(next);
}

function resetProposal(session, sectionId) {
  if (sessionDigest(session) !== session.binding_digest_sha256) fail('BOUNDARY_SESSION_DIGEST_INVALID', 'session changed without resealing');
  const next = structuredClone(session); const item = next.sections.find((s) => s.section_id === sectionId);
  if (!item) fail('BOUNDARY_SECTION_UNKNOWN', String(sectionId));
  item.current = { in_ms: item.proposal.in_ms, out_ms: item.proposal.out_ms };
  item.state = 'PROVISIONAL'; item.boundary_class = item.proposal.boundary_class; item.confirmed_by = null; item.confirmed_at = null; item.confirmation_digest_sha256 = null;
  return sealSession(next);
}

function confirmSection(session, input = {}, options = {}) {
  if (sessionDigest(session) !== session.binding_digest_sha256) fail('BOUNDARY_SESSION_DIGEST_INVALID', 'session changed without resealing');
  if (!verifiedHuman(input.actor, options.humanIdentityVerifier)) fail('BOUNDARY_HUMAN_IDENTITY_REQUIRED', 'a locally verified HUMAN confirmer is required');
  const next = structuredClone(session); const item = next.sections.find((s) => s.section_id === input.section_id);
  if (!item) fail('BOUNDARY_SECTION_UNKNOWN', String(input.section_id));
  const master = next.masters.find((m) => m.master_id === item.master_id); validateInterval(item.current, master.duration_ms);
  const confirmedAt = input.confirmed_at || new Date().toISOString();
  const binding = { run_id: next.run_id, story: next.story, visual_plan: next.visual_plan, master_id: item.master_id, master_sha256: item.master_sha256, section_id: item.section_id, recording_unit_id: item.recording_unit_id, in_ms: item.current.in_ms, out_ms: item.current.out_ms, actor: input.actor, confirmed_at: confirmedAt };
  item.state = 'CONFIRMED'; item.boundary_class = HUMAN_CLASS; item.confirmed_by = structuredClone(input.actor); item.confirmed_at = confirmedAt; item.confirmation_digest_sha256 = sha256(canonicalize(binding));
  const sealed = sealSession(next); const checked = validateSession(sealed, options);
  if (!checked.ok) fail('BOUNDARY_CONFIRMATION_INVALID', JSON.stringify(checked.errors));
  return sealed;
}

function buildSuccessorReview(session, options = {}) {
  const checked = validateSession(session, options);
  if (!checked.ok) fail('BOUNDARY_SESSION_INVALID', JSON.stringify(checked.errors));
  if (checked.confirmed !== checked.total || checked.total === 0) fail('BOUNDARY_CONFIRMATION_INCOMPLETE', `${checked.confirmed}/${checked.total} sections confirmed`);
  const confirmerIds = new Set(session.sections.map((s) => s.confirmed_by.id));
  if (confirmerIds.size !== 1) fail('BOUNDARY_CONFIRMERS_AMBIGUOUS', 'one exact human identity must bind the successor review');
  const reviewedAt = options.reviewed_at || session.sections.map((s) => s.confirmed_at).sort().at(-1);
  const review = {
    schema: SUCCESSOR_SCHEMA, artifact_type: 'human-performance-review', review_version: 2,
    review_id: options.review_id || `human-performance-review-v2-${session.run_id}`,
    run_id: session.run_id, verdict: 'KEEP_ALL', verdict_scope: 'accepted master set plus exact section intervals; not final edit approval',
    reviewer: session.sections[0].confirmed_by, reviewed_at: reviewedAt,
    predecessor_review: session.predecessor_review,
    story: session.story, visual_plan: session.visual_plan,
    masters: session.masters.map((m) => ({ master_id: m.master_id, media_sha256: m.sha256, sections_declared: m.section_ids })),
    segments: session.sections.slice().sort((a, b) => a.story_order - b.story_order).map((s) => ({ segment_id: `segment-${s.section_id}-${s.confirmation_digest_sha256.slice(0, 12)}`, section_id: s.section_id, recording_unit_id: s.recording_unit_id, master_id: s.master_id, master_sha256: s.master_sha256, in_ms: s.current.in_ms, out_ms: s.current.out_ms, duration_ms: s.current.out_ms - s.current.in_ms, boundary_class: HUMAN_CLASS, human_confirmer: s.confirmed_by, confirmation_digest_sha256: s.confirmation_digest_sha256, planned_framing: s.planned_framing, captured_framing: s.captured_framing, crop_policy: s.crop_policy })),
    boundary_review_digest_sha256: session.binding_digest_sha256,
    binding_digest_sha256: '',
  };
  review.binding_digest_sha256 = successorDigest(review);
  return review;
}

function applySuccessorReview(authorityModule, authority, successorReview) {
  if (!authorityModule?.registerSegment || !authorityModule?.bindHumanReview || !authorityModule?.selectSegment) fail('AUTHORITY_ADAPTER_REQUIRED', 'presenter source authority module required');
  if (successorReview?.schema !== SUCCESSOR_SCHEMA || successorDigest(successorReview) !== successorReview.binding_digest_sha256) fail('SUCCESSOR_REVIEW_INVALID', 'successor review digest invalid');
  let next = structuredClone(authority);
  for (const segment of successorReview.segments) {
    next = authorityModule.registerSegment(next, {
      segment_id: segment.segment_id, master_id: segment.master_id, source_master_sha256: segment.master_sha256,
      recording_unit_id: segment.recording_unit_id, section_id: segment.section_id,
      in_ms: segment.in_ms, out_ms: segment.out_ms, duration_ms: segment.duration_ms,
      story: successorReview.story, visual_plan: successorReview.visual_plan,
      planned_framing: segment.planned_framing, captured_framing: segment.captured_framing, crop_policy: segment.crop_policy,
      status: 'ACTIVE', boundary: { class: HUMAN_CLASS, asserted_by: segment.human_confirmer.id, asserted_at: successorReview.reviewed_at, evidence_ref: successorReview.review_id, evidence_sha256: successorReview.binding_digest_sha256 },
    });
  }
  const reviewRecord = {
    review_id: successorReview.review_id, run_id: successorReview.run_id, verdict: successorReview.verdict,
    reviewer: successorReview.reviewer, reviewed_at: successorReview.reviewed_at,
    story: successorReview.story, visual_plan: successorReview.visual_plan,
    masters: successorReview.masters, predecessor_review: successorReview.predecessor_review,
    segments: successorReview.segments.map((s) => ({ segment_id: s.segment_id, section_id: s.section_id, master_id: s.master_id, master_sha256: s.master_sha256, in_ms: s.in_ms, out_ms: s.out_ms, boundary_class: s.boundary_class })),
  };
  next = authorityModule.bindHumanReview(next, reviewRecord);
  for (const segment of successorReview.segments) next = authorityModule.selectSegment(next, {
    selection_id: `selection-${segment.segment_id}`, review_id: successorReview.review_id,
    segment_id: segment.segment_id, master_id: segment.master_id, media_sha256: segment.master_sha256,
    section_id: segment.section_id, selector: successorReview.reviewer, selected_at: successorReview.reviewed_at, status: 'ACTIVE',
  });
  return next;
}

function buildClaudeReleasePacket(editorHandoff, successorReview, policy = {}) {
  const blockers = [];
  if (editorHandoff?.state !== 'ASSEMBLY_ELIGIBLE' || editorHandoff?.ready !== true) blockers.push({ code: 'PRESENTER_SOURCE_NOT_ASSEMBLY_ELIGIBLE' });
  if (successorReview?.schema !== SUCCESSOR_SCHEMA || successorDigest(successorReview) !== successorReview.binding_digest_sha256) blockers.push({ code: 'SUCCESSOR_REVIEW_INVALID' });
  if ((successorReview?.segments || []).some((s) => s.boundary_class !== HUMAN_CLASS)) blockers.push({ code: 'PROVISIONAL_BOUNDARY_FORBIDDEN' });
  if (policy.music_policy?.state === 'MUSIC_DURATION_POLICY_HUMAN_DECISION_REQUIRED') blockers.push({ code: 'MUSIC_DURATION_POLICY_HUMAN_DECISION_REQUIRED' });
  return {
    schema: 'vidtoolz.productionAssemblyReleasePacket.v1', artifact_type: 'production-assembly-release-packet',
    run_id: successorReview?.run_id, story: successorReview?.story, visual_plan: successorReview?.visual_plan,
    presenter_sources: editorHandoff?.sources || [], human_review_binding_sha256: successorReview?.binding_digest_sha256,
    insert_policy: structuredClone(policy.insert_policy || []), crop_policy: structuredClone(policy.crop_policy || []), music_policy: structuredClone(policy.music_policy || null),
    output_class: 'PRODUCTION_ASSEMBLY_CANDIDATE', evidence_class: 'PROPOSED_PRODUCTION_ASSEMBLY_TECHNICAL_EVIDENCE',
    gate_authority: false, forbidden_sources: ['DRAFT_SYNTHETIC_NARRATION', 'PROXY_PRESENTER', 'DRAFT_V1', 'STALE_VISUAL_PLAN', 'UNBOUND_MEDIA'],
    ready: blockers.length === 0, blockers,
  };
}

module.exports = {
  SESSION_SCHEMA, SUCCESSOR_SCHEMA, PROVISIONAL_CLASSES, HUMAN_CLASS,
  sha256, canonicalize, sessionDigest, successorDigest,
  validateInterval, validateSession, createSession, adjustBoundary, resetProposal,
  confirmSection, buildSuccessorReview, applySuccessorReview, buildClaudeReleasePacket,
};
