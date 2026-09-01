#!/usr/bin/env node
'use strict';

/*
 * Draft revision plan authority.
 *
 * Converts one submitted, ACTIVE `vidtoolz.draftReview.v2` into one immutable
 * `vidtoolz.draftRevisionPlan.v1`: explicit, bounded work items routed into
 * canonical domains (SCRIPT / VISUAL / MUSIC / EDIT_PACING / NARRATION), a
 * reuse census, per-item dependency cones and a planned revision diff — all
 * bound to the exact reviewed Draft, review bytes, Story, Visual Plan,
 * narration, music, handoff and execution identities.
 *
 * What this module deliberately is NOT:
 *   - not a second review authority. It consumes draft-review-intake's
 *     revisionPlanInput() verbatim; it never rewrites, reinterprets or
 *     reweights what the human said. Verbatim notes travel into work items
 *     untouched.
 *   - not an approval. NO_FEEDBACK stays NO_FEEDBACK (recorded as
 *     conservative reuse, never promoted to EXPLICIT_KEEP); a submitted
 *     review is not an approved draft.
 *   - not a creative planner. Routing is DETERMINISTIC from the structured
 *     review (disposition x target_domain x dimension). Feedback the human
 *     did not route to a domain is never guessed at: it becomes an
 *     execution-blocking UNROUTED_FEEDBACK item.
 *
 * The plan's central economics: regenerate only what the review actually
 * requires. KEEP and NO_FEEDBACK material is reused by identity+hash;
 * a CHANGE regenerates its minimum dependency cone and nothing else.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const review = require('./draft-review-intake.js');
const reviewSubject = require('./draft-review-subject.js');
const directed = require('./directed-draft-assembly-handoff.js');

const PLAN_SCHEMA = 'vidtoolz.draftRevisionPlan.v1';
const REVISION_DIR = 'draft-revision';

/* Canonical work domains: the mission's five, mapped from the review's
 * existing TARGET_DOMAINS vocabulary (PACING and TIMING are the same edit
 * concern; GRAPHICS is a visual concern). OTHER/absent is never guessed. */
const WORK_DOMAINS = Object.freeze(['SCRIPT', 'VISUAL', 'MUSIC', 'EDIT_PACING', 'NARRATION']);
const DOMAIN_MAP = Object.freeze({
  SCRIPT: 'SCRIPT', VISUAL: 'VISUAL', GRAPHICS: 'VISUAL', MUSIC: 'MUSIC',
  PACING: 'EDIT_PACING', TIMING: 'EDIT_PACING', NARRATION: 'NARRATION',
});

const WORK_KINDS = Object.freeze([
  'VISUAL_CONCEPT_REVISION',      // new concept + prompt + regenerated still
  'VISUAL_EXECUTION_REGENERATION',// same concept/prompt, regenerated still
  'VISUAL_CUT',                   // remove one visual slot; section re-tiles
  'MUSIC_CONCEPT_REVISION',       // new analysis/concepts + new A/B/C
  'MUSIC_EXECUTION_REGENERATION', // same direction, regenerated candidates
  'EDIT_PACING_REBALANCE',        // deterministic timing recomposition only
  'NARRATION_REGENERATION',       // synthetic narration + alignment successor
  'SCRIPT_SECTION_REWRITE',       // Story successor required (human-approved)
  'SCRIPT_SECTION_CUT',           // Story successor removing the section
  'UNROUTED_FEEDBACK',            // human feedback with no canonical route — blocks
  'MUSIC_CUT_UNSUPPORTED',        // no canonical music-free Draft policy exists — blocks
]);

class DraftRevisionPlanError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftRevisionPlanError'; this.code = code; }
}
function fail(code, message) { throw new DraftRevisionPlanError(code, message); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function writeImmutable(file, value) {
  const payload = jsonBytes(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('DRAFT_REVISION_PLAN_IMMUTABLE_CONFLICT', file);
    return false;
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  return true;
}
function planCore(plan) { const copy = { ...plan }; delete copy.plan_digest_sha256; delete copy.created_at; return copy; }

/* ── current review resolution (fail-closed) ─────────────────────────────── */

/*
 * The one review a revision may act on: SUBMITTED, ACTIVE against the exact
 * current draft, binding and submission digests intact, newest if several.
 * Everything else is a typed refusal — feedback is never applied to a
 * different Draft than the one it was recorded against.
 */
function resolveCurrentReviewForRevision(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const inspection = reviewSubject.inspectReviewSubject(runDir, options);
  if (!inspection.present) fail('DRAFT_REVISION_NO_DRAFT', 'this run has no assembled draft; nothing to revise');
  if (!inspection.valid) fail('DRAFT_REVISION_SUBJECT_INVALID', `${inspection.code}: ${inspection.detail}`);
  const view = review.promotionDecisionView(runDir, options);
  if (!view.current_review) {
    fail('CURRENT_HUMAN_REVIEW_MISSING', 'no submitted human review is bound to the exact current draft — a revision plan cannot be fabricated');
  }
  const status = review.reviewStatus(runDir, view.current_review.review_id, options);
  if (!status.current || status.lifecycle !== review.LIFECYCLE.ACTIVE) {
    fail('DRAFT_REVISION_REVIEW_STALE', status.detail || 'review is not bound to the current exact draft');
  }
  if (status.binding_intact === false || status.submission_intact === false) {
    fail('DRAFT_REVISION_REVIEW_TAMPERED', 'review immutable binding or submitted bytes were modified');
  }
  if (status.review.completion_status !== 'SUBMITTED') {
    fail('DRAFT_REVISION_REVIEW_NOT_SUBMITTED', 'only a submitted review can drive a revision plan');
  }
  return { runDir, subject: inspection.subject, review: status.review, status, view };
}

/* ── deterministic domain routing ────────────────────────────────────────── */

function blockingItem(base, reason) {
  return { ...base, execution_blocking: true, blocking_reason: reason };
}

/*
 * One note → zero or one work item. KEEP produces no work (it produces
 * preserved authority in the census). Everything CHANGE/CUT/REWRITE becomes
 * explicit bounded work or an explicit execution-blocking item — never a
 * silent guess and never a vague instruction.
 */
function routeNote(note, section, sectionSlots) {
  const domain = note.target_domain ? DOMAIN_MAP[note.target_domain] ?? null : null;
  const base = {
    review_ref: { note_id: note.note_id, timecode_seconds: note.timecode_seconds },
    disposition: note.disposition,
    review_target_domain: note.target_domain ?? null,
    visual_dimension: note.visual_dimension ?? null,
    music_dimension: note.music_dimension ?? null,
    target: {
      section_id: section.section_id,
      beat: section.beat ?? null,
      segment_order: section.segment_order ?? null,
      visual_asset_id: note.predecessor_visual_asset_id ?? section.predecessor_visual_asset_id ?? null,
      visual_sha256: note.predecessor_visual_sha256 ?? section.predecessor_visual_sha256 ?? null,
    },
    verbatim_comment: note.comment,
    execution_blocking: false,
    blocking_reason: null,
  };
  if (note.disposition === 'KEEP') return null;
  if (note.disposition === 'CHANGE') {
    if (domain === 'VISUAL') {
      const kind = note.visual_dimension === 'IMAGE_EXECUTION' ? 'VISUAL_EXECUTION_REGENERATION' : 'VISUAL_CONCEPT_REVISION';
      return {
        ...base, domain: 'VISUAL', kind,
        regeneration_scope: kind === 'VISUAL_EXECUTION_REGENERATION'
          ? 'ONE_STILL_SAME_CONCEPT_SAME_PROMPT'
          : 'ONE_SLOT_NEW_CONCEPT_NEW_PROMPT_NEW_STILL',
        preserved_dependencies: ['all other visual slots', 'narration', 'narration alignment', 'music decision + asset', 'unaffected timeline'],
        stale_conditions: ['asset manifest (affected entry)', 'composition (manifest pin)', ...(kind === 'VISUAL_CONCEPT_REVISION' ? ['visual plan (affected slot/shot/prompt)', 'release packet (visual plan pin)'] : [])],
        completion_requirements: ['one normal DRAFT_BESPOKE_STILL generation (one technical retry only)', 'registry-grade hash + dimension evidence', 'derived plan passes canonical visual-plan + bespoke policy validation'],
      };
    }
    if (domain === 'MUSIC') {
      const kind = note.music_dimension === 'MUSIC_EXECUTION' ? 'MUSIC_EXECUTION_REGENERATION' : 'MUSIC_CONCEPT_REVISION';
      return {
        ...base, domain: 'MUSIC', kind,
        regeneration_scope: 'FULL_PROGRAMME_DRAFT_MUSIC (Stable-Audio-first A/B/C, human-calibrated selection)',
        preserved_dependencies: ['all visual assets', 'visual plan', 'narration', 'narration alignment', 'timeline'],
        stale_conditions: ['music decision chain', 'release packet (music pin)', 'assembly handoff'],
        completion_requirements: ['canonical Draft music department run (bounded generation)', 'renderer-validated music decision chain', 'Draft-only authority (no final music authority)'],
      };
    }
    if (domain === 'EDIT_PACING') {
      return {
        ...base, domain: 'EDIT_PACING', kind: 'EDIT_PACING_REBALANCE',
        regeneration_scope: 'NO_MEDIA — deterministic re-tiling of the affected section\'s beats only',
        preserved_dependencies: ['all media bytes', 'visual plan', 'narration', 'narration alignment', 'music'],
        stale_conditions: ['composition (affected section beats)'],
        completion_requirements: ['section beats re-tile the exact narration interval with no gaps or overlaps'],
      };
    }
    if (domain === 'NARRATION') {
      return {
        ...base, domain: 'NARRATION', kind: 'NARRATION_REGENERATION',
        regeneration_scope: 'FULL_PROGRAMME synthetic Draft narration + alignment (existing narration authority; no final human performance)',
        preserved_dependencies: ['visual assets', 'visual plan', 'music decision + asset'],
        stale_conditions: ['narration asset', 'narration alignment', 'composition timing (retiled to new alignment)', 'release packet (narration pin)'],
        completion_requirements: ['alignment digest recomputed and story-bound', 'beats retiled proportionally into new section intervals'],
      };
    }
    if (domain === 'SCRIPT') {
      return {
        ...base, domain: 'SCRIPT', kind: 'SCRIPT_SECTION_REWRITE',
        regeneration_scope: 'STORY_SUCCESSOR (immutable new approved Story version) + minimum dependency cone',
        preserved_dependencies: ['sections whose exact dialogue is unchanged', 'their visual slots and stills', 'music decision + asset (existing cross-version doctrine)'],
        stale_conditions: ['script authority', 'narration + alignment', 'affected sections\' visual slots/prompts/stills', 'composition', 'release packet'],
        completion_requirements: ['a HUMAN-approved Story successor version exists whose lineage contains the reviewed version', 'the requested section is actually changed in that successor', 'no fabricated approval'],
      };
    }
    return blockingItem({ ...base, domain: 'UNROUTED', kind: 'UNROUTED_FEEDBACK', regeneration_scope: 'NONE', preserved_dependencies: [], stale_conditions: [], completion_requirements: ['a human (or the reviewer) re-records this note with a canonical target domain'] },
      'CHANGE feedback carries no canonical target domain — the planner never guesses intent');
  }
  if (note.disposition === 'CUT') {
    if (domain === 'VISUAL') {
      const soleSlot = sectionSlots.length <= 1;
      const item = {
        ...base, domain: 'VISUAL', kind: 'VISUAL_CUT',
        regeneration_scope: 'NO_MEDIA — remove one visual slot; the section\'s remaining beats re-tile its exact interval',
        preserved_dependencies: ['all other visual slots', 'narration', 'music', 'other sections\' timeline'],
        stale_conditions: ['visual plan (removed slot)', 'asset manifest (removed entry)', 'composition (section re-tiled)', 'release packet (visual plan pin)'],
        completion_requirements: ['section retains full timeline coverage after the cut', 'removed media stays preserved in predecessor evidence, excluded from successor use'],
      };
      return soleSlot
        ? blockingItem(item, 'cutting the section\'s only visual would leave the section uncovered — requires a replacement concept or a script-level cut')
        : item;
    }
    if (domain === 'MUSIC') {
      return blockingItem({ ...base, domain: 'MUSIC', kind: 'MUSIC_CUT_UNSUPPORTED', regeneration_scope: 'NONE', preserved_dependencies: [], stale_conditions: [], completion_requirements: ['a canonical music-free Draft policy decision from Mikko'] },
        'no canonical music-free Draft policy exists — removing the bed is a policy decision, not a mechanical revision');
    }
    if (domain === 'SCRIPT' || domain === null) {
      return {
        ...base, domain: 'SCRIPT', kind: 'SCRIPT_SECTION_CUT',
        regeneration_scope: 'STORY_SUCCESSOR removing the section + timeline recomputation',
        preserved_dependencies: ['unchanged sections and their media', 'music decision + asset'],
        stale_conditions: ['script authority', 'narration + alignment', 'removed section\'s visual slots (excluded from successor)', 'composition (no gaps)', 'release packet'],
        completion_requirements: ['a HUMAN-approved Story successor without the section', 'timeline recomputed with no gaps', 'historical assets preserved in predecessor evidence'],
      };
    }
    return blockingItem({ ...base, domain: 'UNROUTED', kind: 'UNROUTED_FEEDBACK', regeneration_scope: 'NONE', preserved_dependencies: [], stale_conditions: [], completion_requirements: ['a human re-records this CUT with a canonical target (VISUAL or SCRIPT)'] },
      `CUT is not mechanically routable for domain ${note.target_domain}`);
  }
  // REWRITE always implies upstream script/story change (mission §13),
  // regardless of the domain label the note carried.
  return {
    ...base, domain: 'SCRIPT', kind: 'SCRIPT_SECTION_REWRITE',
    regeneration_scope: 'STORY_SUCCESSOR (immutable new approved Story version) + minimum dependency cone',
    preserved_dependencies: ['sections whose exact dialogue is unchanged', 'their visual slots and stills', 'music decision + asset (existing cross-version doctrine)'],
    stale_conditions: ['script authority', 'narration + alignment', 'affected sections\' visual slots/prompts/stills', 'composition', 'release packet'],
    completion_requirements: ['a HUMAN-approved Story successor version exists whose lineage contains the reviewed version', 'the requested section is actually changed in that successor', 'no fabricated approval'],
  };
}

/* Whole-draft verdict routing: only actionable as work when it carries
 * addressable intent; otherwise it blocks rather than guesses. */
function routeVerdict(planInput, hasChangeItems) {
  const verdict = planInput.draft_verdict;
  if (!verdict || verdict === 'KEEP') return [];
  if (verdict === 'REWRITE' && !hasChangeItems) {
    return [{
      review_ref: { note_id: null, timecode_seconds: null }, disposition: 'REWRITE',
      review_target_domain: null, visual_dimension: null, music_dimension: null,
      target: { section_id: null, beat: null, segment_order: null, visual_asset_id: null, visual_sha256: null },
      verbatim_comment: planInput.overall_comment || '(draft verdict REWRITE without notes)',
      domain: 'SCRIPT', kind: 'SCRIPT_SECTION_REWRITE',
      regeneration_scope: 'WHOLE_STORY_SUCCESSOR + dependency cone of every actually-changed section',
      preserved_dependencies: ['sections the approved successor leaves byte-identical', 'music decision + asset'],
      stale_conditions: ['script authority', 'narration + alignment', 'changed sections\' visuals', 'composition', 'release packet'],
      completion_requirements: ['a HUMAN-approved Story successor version'],
      execution_blocking: false, blocking_reason: null,
    }];
  }
  if (verdict === 'CUT') {
    return [blockingItem({
      review_ref: { note_id: null, timecode_seconds: null }, disposition: 'CUT',
      review_target_domain: null, visual_dimension: null, music_dimension: null,
      target: { section_id: null, beat: null, segment_order: null, visual_asset_id: null, visual_sha256: null },
      verbatim_comment: planInput.overall_comment || '(draft verdict CUT)',
      domain: 'UNROUTED', kind: 'UNROUTED_FEEDBACK', regeneration_scope: 'NONE',
      preserved_dependencies: [], stale_conditions: [], completion_requirements: ['a human decision — cutting the whole draft is abandonment, not a revision'],
    }, 'draft verdict CUT is not a revision instruction')];
  }
  if (verdict === 'CHANGE' && !hasChangeItems) {
    return [blockingItem({
      review_ref: { note_id: null, timecode_seconds: null }, disposition: 'CHANGE',
      review_target_domain: null, visual_dimension: null, music_dimension: null,
      target: { section_id: null, beat: null, segment_order: null, visual_asset_id: null, visual_sha256: null },
      verbatim_comment: planInput.overall_comment || '(draft verdict CHANGE without addressable notes)',
      domain: 'UNROUTED', kind: 'UNROUTED_FEEDBACK', regeneration_scope: 'NONE',
      preserved_dependencies: [], stale_conditions: [], completion_requirements: ['section-level notes with canonical domains'],
    }, 'changes were requested but no note says what to change')];
  }
  return [];
}

/*
 * ONE note → at most ONE work item.
 *
 * revisionPlanInput reports one row per assembled SEGMENT (beat) but groups
 * notes by SECTION, so a note lands on every beat of its section. The beat a
 * note actually points at is the one its own timecode falls inside — that is
 * the addressable target (and the asset the reviewer was looking at). Routing
 * a note once per beat would regenerate a whole section for one note, which is
 * exactly the economics this pipeline exists to prevent.
 */
function segmentForNote(note, segments) {
  const owning = segments.filter((segment) => segment.notes.some((item) => item.note_id === note.note_id));
  const containing = owning.find((segment) => note.timecode_seconds >= segment.start_seconds && note.timecode_seconds < segment.end_seconds);
  // Mirrors draft-review-intake.segmentAt: a timecode past the end belongs to
  // the last segment rather than to nothing.
  return containing || owning.at(-1) || segments.at(-1) || null;
}

function routePlanInput(planInput) {
  const segments = planInput.sections;
  const notes = new Map();
  for (const segment of segments) {
    for (const note of segment.notes) if (!notes.has(note.note_id)) notes.set(note.note_id, note);
  }
  const items = [];
  for (const note of [...notes.values()].sort((left, right) => String(left.note_id).localeCompare(String(right.note_id)))) {
    const segment = segmentForNote(note, segments);
    if (!segment) continue;
    const sectionSegments = segments.filter((other) => other.section_id === segment.section_id);
    const routed = routeNote(note, segment, sectionSegments);
    if (routed) items.push(routed);
  }
  /* Section-level coverage guard: individually legal CUTs can still empty a
   * section between them. A revision may never leave an uncovered section. */
  const segmentCountBySection = new Map();
  for (const segment of segments) segmentCountBySection.set(segment.section_id, (segmentCountBySection.get(segment.section_id) || 0) + 1);
  const cutsBySection = new Map();
  for (const item of items) {
    if (item.kind !== 'VISUAL_CUT') continue;
    const list = cutsBySection.get(item.target.section_id) || [];
    list.push(item);
    cutsBySection.set(item.target.section_id, list);
  }
  for (const [sectionId, cuts] of cutsBySection) {
    if (cuts.length < (segmentCountBySection.get(sectionId) || 0)) continue;
    for (const item of cuts) {
      item.execution_blocking = true;
      item.blocking_reason = `cutting ${cuts.length} of ${segmentCountBySection.get(sectionId)} visuals would leave section ${sectionId} uncovered — requires a replacement concept or a script-level cut`;
    }
  }
  const hasChange = items.some((item) => !item.execution_blocking);
  items.push(...routeVerdict(planInput, hasChange));
  return items.map((item, index) => ({ work_item_id: `wi-${String(index + 1).padStart(4, '0')}`, ...item }));
}

/* ── census + planned diff ───────────────────────────────────────────────── */

function buildCensus(planInput, workItems) {
  const affectedAssets = new Set();
  const removedAssets = new Set();
  for (const item of workItems) {
    if (item.domain !== 'VISUAL' || !item.target.visual_asset_id) continue;
    if (item.kind === 'VISUAL_CUT') removedAssets.add(item.target.visual_asset_id);
    else affectedAssets.add(item.target.visual_asset_id);
  }
  const scriptItems = workItems.filter((item) => item.domain === 'SCRIPT');
  const scriptSections = new Set(scriptItems.map((item) => item.target.section_id).filter(Boolean));
  const preserved = []; const scriptCone = [];
  for (const section of planInput.sections) {
    const assetId = section.predecessor_visual_asset_id;
    if (!assetId) continue;
    if (affectedAssets.has(assetId) || removedAssets.has(assetId)) continue;
    if (scriptSections.has(section.section_id) || (scriptItems.some((item) => item.target.section_id === null) && scriptItems.length)) {
      scriptCone.push(assetId);
    } else preserved.push({ asset_id: assetId, sha256: section.predecessor_visual_sha256, section_id: section.section_id, feedback_state: section.feedback_state });
  }
  const musicItems = workItems.filter((item) => item.domain === 'MUSIC' && !item.execution_blocking);
  const narrationRegen = workItems.some((item) => item.domain === 'NARRATION') || scriptItems.length > 0;
  return {
    visual: {
      preserved: preserved.map((entry) => entry.asset_id),
      preserved_detail: preserved,
      regenerated: [...affectedAssets],
      removed: [...removedAssets],
      pending_script_cone: scriptCone,
    },
    music: musicItems.length ? 'REGENERATE' : 'REUSE',
    narration: narrationRegen ? 'REGENERATE' : 'REUSE',
    script: scriptItems.length ? 'STORY_SUCCESSOR_REQUIRED' : 'REUSE',
    sections: {
      explicit_keep: planInput.sections.filter((section) => section.feedback_state === 'EXPLICIT_KEEP').map((section) => section.section_id),
      no_feedback: planInput.sections.filter((section) => section.feedback_state === 'NO_FEEDBACK').map((section) => section.section_id),
      change_requested: planInput.sections.filter((section) => section.feedback_state === 'CHANGE_REQUESTED').map((section) => section.section_id),
    },
    no_feedback_policy: 'NO_FEEDBACK is recorded as NO_FEEDBACK (conservative reuse) — it is never promoted to EXPLICIT_KEEP',
  };
}

function plannedDiff(census, workItems) {
  const byId = (item) => ({ work_item_id: item.work_item_id, note_id: item.review_ref.note_id, reason: item.verbatim_comment });
  return {
    preserved: [
      ...census.visual.preserved.map((assetId) => ({ kind: 'VISUAL_ASSET', id: assetId, reason: 'no change requested (KEEP or NO_FEEDBACK)' })),
      ...(census.music === 'REUSE' ? [{ kind: 'MUSIC', id: 'draft-music-decision', reason: 'no music change requested' }] : []),
      ...(census.narration === 'REUSE' ? [{ kind: 'NARRATION', id: 'draft-narration', reason: 'script unchanged and no narration change requested' }] : []),
    ],
    regenerated: [
      ...workItems.filter((item) => ['VISUAL_CONCEPT_REVISION', 'VISUAL_EXECUTION_REGENERATION'].includes(item.kind)).map((item) => ({ kind: 'VISUAL_ASSET', id: item.target.visual_asset_id, ...byId(item) })),
      ...workItems.filter((item) => item.domain === 'MUSIC' && !item.execution_blocking).map((item) => ({ kind: 'MUSIC', id: 'draft-music', ...byId(item) })),
      ...workItems.filter((item) => item.domain === 'NARRATION').map((item) => ({ kind: 'NARRATION', id: 'draft-narration', ...byId(item) })),
    ],
    modified: workItems.filter((item) => item.kind === 'EDIT_PACING_REBALANCE').map((item) => ({ kind: 'TIMELINE', id: item.target.section_id, ...byId(item) })),
    removed: workItems.filter((item) => ['VISUAL_CUT', 'SCRIPT_SECTION_CUT'].includes(item.kind)).map((item) => ({ kind: item.kind === 'VISUAL_CUT' ? 'VISUAL_ASSET' : 'SCRIPT_SECTION', id: item.target.visual_asset_id || item.target.section_id, ...byId(item) })),
    added: [],
    script_cone_note: census.script === 'STORY_SUCCESSOR_REQUIRED'
      ? 'script work regenerates only the dependency cone of sections the approved Story successor actually changes; the executor computes the exact cone against that successor'
      : null,
  };
}

/* ── plan construction ───────────────────────────────────────────────────── */

function planPathFor(runDir, targetVersion) {
  return path.join(path.resolve(runDir), REVISION_DIR, `revision-plan-r${targetVersion}.json`);
}

function buildRevisionPlan(runDirInput, options = {}) {
  const resolved = resolveCurrentReviewForRevision(runDirInput, options);
  const { runDir, subject } = resolved;
  const reviewId = resolved.review.review_id;
  const planInput = review.revisionPlanInput(runDir, reviewId, options);
  if (planInput.review_lifecycle !== review.LIFECYCLE.ACTIVE) fail('DRAFT_REVISION_REVIEW_STALE', planInput.review_lifecycle);
  if (planInput.predecessor_draft.review_subject_digest_sha256 !== subject.subject_digest_sha256) {
    fail('DRAFT_REVISION_REVIEW_STALE', 'review subject digest does not match the current draft subject');
  }
  const registered = options.registeredHandoff || null;
  const intakeRecord = directed.discoverActiveIntake(runDir);
  const handoffBinding = subject.handoff
    ? { handoff_id: subject.handoff.id, handoff_digest_sha256: subject.handoff.digest_sha256, handoff_file_sha256: subject.handoff.file_sha256 }
    : fail('DRAFT_REVISION_SUBJECT_INVALID', 'revision planning requires a Directed Draft subject with a registered handoff');

  const workItems = routePlanInput(planInput);
  const census = buildCensus(planInput, workItems);
  const blocking = workItems.filter((item) => item.execution_blocking)
    .map((item) => ({ work_item_id: item.work_item_id, kind: item.kind, reason: item.blocking_reason }));
  const revisionRequired = workItems.length > 0;
  const decision = !revisionRequired ? 'NO_REVISION_REQUIRED' : blocking.length ? 'REVISION_BLOCKED' : 'REVISION_REQUIRED';

  const reviewFilePath = review.reviewFile(runDir, reviewId);
  const core = {
    schema: PLAN_SCHEMA,
    artifact_type: 'draft-revision-plan',
    plan_id: `revision-plan-${subject.run_id}-r${subject.draft_version + 1}`,
    run_id: subject.run_id,
    predecessor_draft: {
      draft_version: subject.draft_version,
      output_path: subject.output.path,
      output_sha256: subject.output.sha256,
      assembly_manifest_sha256: subject.assembly_manifest.sha256,
      semantic_plan_digest_sha256: subject.semantic_plan_digest_sha256,
      review_subject_digest_sha256: subject.subject_digest_sha256,
    },
    target_draft_version: subject.draft_version + 1,
    review: {
      schema: review.REVIEW_SCHEMA,
      review_id: reviewId,
      reviewer_authority: resolved.review.reviewer_authority,
      submitted_at: resolved.review.submitted_at,
      binding_digest_sha256: resolved.review.binding_digest_sha256,
      submission_digest_sha256: resolved.review.submission_digest_sha256,
      review_file_sha256: sha256File(reviewFilePath),
      draft_verdict: resolved.review.draft_verdict,
      ratings: resolved.review.ratings,
      totals: planInput.totals,
    },
    bindings: {
      story: subject.story,
      script_sha256: subject.script?.sha256 ?? null,
      handoff: handoffBinding,
      execution: subject.execution ? {
        attempt_id: subject.execution.attempt_id,
        attempt_digest_sha256: subject.execution.attempt_digest_sha256,
        execution_identity_sha256: subject.execution.execution_identity_sha256,
        head_sha256: subject.execution.head_sha256,
      } : null,
      evidence_sha256: subject.evidence?.sha256 ?? null,
      release_sha256: subject.release?.sha256 ?? null,
      narration: { sha256: subject.narration?.audio_sha256 ?? null, fidelity: subject.narration?.fidelity ?? null },
      intake: { path: path.relative(runDir, intakeRecord.path), sha256: directed.sha256FileSync(intakeRecord.path) },
      registered_handoff_checked: Boolean(registered),
    },
    revision_required: revisionRequired,
    decision,
    blocking,
    work_items: workItems,
    reuse_census: census,
    planned_diff: plannedDiff(census, workItems),
    dependency_policy: {
      script_rewrite_cone: 'script authority -> narration + alignment -> changed sections\' visual slots -> composition -> release; unchanged sections and music are preserved',
      music_change_cone: 'music decision -> release music pin -> handoff; nothing else',
      visual_change_cone: 'affected slot (+ plan/prompt when concept changes) -> manifest entry -> composition manifest pin; nothing else',
      pacing_cone: 'composition beats of the affected section only',
      narration_cone: 'narration -> alignment -> composition timing; media bytes preserved',
    },
    authority: {
      publication_authority: false,
      final_asset_authority: false,
      final_production_lock: false,
      completes_rough_cut_gate: false,
      human_review_required_for_result: true,
      note: 'a revision plan converts one submitted human review into bounded work; the resulting successor Draft returns to DRAFT_REVIEW_READY and Mikko reviews it separately',
    },
    determinism: {
      routing: 'DETERMINISTIC (disposition x target_domain x dimension table); no LLM participates in domain selection or identity binding',
      digest_excludes: ['created_at'],
    },
    created_at: options.now || new Date().toISOString(),
  };
  const plan = { ...core, plan_digest_sha256: digest(planCore(core)) };
  validateRevisionPlan(plan, planInput);
  const target = planPathFor(runDir, plan.target_draft_version);
  if (fs.existsSync(target)) {
    const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (existing.plan_digest_sha256 === plan.plan_digest_sha256
        && existing.review?.submission_digest_sha256 === plan.review.submission_digest_sha256) {
      return { state: 'ALREADY_PLANNED', plan: existing, plan_path: target };
    }
    fail('DRAFT_REVISION_PLAN_IMMUTABLE_CONFLICT', `${target} already holds a different plan for r${plan.target_draft_version}`);
  }
  writeImmutable(target, plan);
  return { state: 'PLANNED', plan, plan_path: target };
}

/* ── plan validation (guards any planner, human or model) ────────────────── */

/*
 * Planner output is untrusted (mission §25). This re-derives the canonical
 * routing from the review input and refuses a plan that adds work no human
 * asked for, drops work a human asked for, references review items or
 * sections that do not exist, or escalates authority.
 */
function validateRevisionPlan(plan, planInput) {
  if (plan?.schema !== PLAN_SCHEMA) fail('DRAFT_REVISION_PLAN_INVALID', `schema ${plan?.schema}`);
  const expectedCore = digest(planCore(plan));
  if (plan.plan_digest_sha256 !== expectedCore) fail('DRAFT_REVISION_PLAN_TAMPERED', 'plan digest mismatch');
  if (plan.authority?.publication_authority !== false || plan.authority?.final_asset_authority !== false
      || plan.authority?.final_production_lock !== false || plan.authority?.completes_rough_cut_gate !== false) {
    fail('DRAFT_REVISION_PLAN_AUTHORITY_ESCALATION', 'a revision plan never carries publication/final/gate authority');
  }
  const noteIds = new Set(planInput.sections.flatMap((section) => section.notes.map((note) => note.note_id)));
  const sectionIds = new Set(planInput.sections.map((section) => section.section_id));
  for (const item of plan.work_items || []) {
    if (!WORK_KINDS.includes(item.kind)) fail('DRAFT_REVISION_WORK_KIND_UNKNOWN', String(item.kind));
    if (item.domain !== 'UNROUTED' && !WORK_DOMAINS.includes(item.domain)) fail('DRAFT_REVISION_WORK_DOMAIN_UNKNOWN', String(item.domain));
    if (item.review_ref.note_id !== null && !noteIds.has(item.review_ref.note_id)) {
      fail('DRAFT_REVISION_WORK_ITEM_UNBACKED', `${item.work_item_id} references nonexistent review note ${item.review_ref.note_id}`);
    }
    if (item.target.section_id !== null && !sectionIds.has(item.target.section_id)) {
      fail('DRAFT_REVISION_TARGET_SECTION_UNKNOWN', `${item.work_item_id}: ${item.target.section_id}`);
    }
    if (typeof item.verbatim_comment !== 'string' || !item.verbatim_comment.trim()) {
      fail('DRAFT_REVISION_WORK_ITEM_VAGUE', `${item.work_item_id} carries no verbatim review rationale`);
    }
  }
  const seen = new Set();
  for (const item of plan.work_items || []) {
    const key = `${item.kind}:${item.review_ref.note_id}:${item.target.section_id}:${item.target.visual_asset_id}`;
    if (seen.has(key)) fail('DRAFT_REVISION_WORK_ITEM_DUPLICATE', key);
    seen.add(key);
  }
  // The canonical routing is recomputed; a plan may not contain MORE or FEWER
  // actionable items than the human review implies.
  const expectedItems = routePlanInput(planInput);
  const strip = (item) => ({ kind: item.kind, domain: item.domain, note: item.review_ref.note_id, section: item.target.section_id, blocking: item.execution_blocking });
  const got = (plan.work_items || []).map(strip);
  const expected = expectedItems.map(strip);
  if (canonicalize(got) !== canonicalize(expected)) {
    fail('DRAFT_REVISION_PLAN_WORK_MISMATCH', 'plan work items do not match the canonical routing of the human review (unrequested or missing work)');
  }
  return true;
}

/* ── staleness verification for a stored plan ────────────────────────────── */

function loadRevisionPlan(runDirInput, targetVersion) {
  const file = planPathFor(runDirInput, targetVersion);
  if (!fs.existsSync(file)) fail('DRAFT_REVISION_PLAN_MISSING', file);
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (plan.schema !== PLAN_SCHEMA) fail('DRAFT_REVISION_PLAN_INVALID', String(plan.schema));
  if (plan.plan_digest_sha256 !== digest(planCore(plan))) fail('DRAFT_REVISION_PLAN_TAMPERED', file);
  return { plan, plan_path: file };
}

/*
 * A plan is executable only while EVERYTHING it bound still holds: the exact
 * reviewed draft, the exact review bytes, the story, the handoff, the intake.
 * Anything moved -> typed stale failure; a stale plan is never reinterpreted.
 */
function verifyRevisionPlanCurrent(runDirInput, plan, options = {}) {
  const runDir = path.resolve(runDirInput);
  const inspection = reviewSubject.inspectReviewSubject(runDir, options);
  if (!inspection.valid) fail('DRAFT_REVISION_PLAN_STALE', `current draft subject invalid: ${inspection.code}`);
  const subject = inspection.subject;
  if (subject.subject_digest_sha256 !== plan.predecessor_draft.review_subject_digest_sha256) {
    fail('DRAFT_REVISION_PLAN_STALE', 'the draft this plan was written against is no longer the run\'s current draft');
  }
  const status = review.reviewStatus(runDir, plan.review.review_id, options);
  if (!status.present || !status.current || status.lifecycle !== review.LIFECYCLE.ACTIVE) {
    fail('DRAFT_REVISION_PLAN_STALE', `bound review is no longer current: ${status.detail || status.lifecycle}`);
  }
  const reviewFileSha = sha256File(review.reviewFile(runDir, plan.review.review_id));
  if (reviewFileSha !== plan.review.review_file_sha256) fail('DRAFT_REVISION_PLAN_STALE', 'review bytes changed after planning');
  const intakeRecord = directed.discoverActiveIntake(runDir);
  if (path.relative(runDir, intakeRecord.path) !== plan.bindings.intake.path
      || directed.sha256FileSync(intakeRecord.path) !== plan.bindings.intake.sha256) {
    fail('DRAFT_REVISION_PLAN_STALE', 'the run\'s active assembly intake changed after planning');
  }
  if (subject.handoff?.digest_sha256 !== plan.bindings.handoff.handoff_digest_sha256) {
    fail('DRAFT_REVISION_PLAN_STALE', 'registered handoff changed after planning');
  }
  if (subject.story && plan.bindings.story
      && (subject.story.version_id !== plan.bindings.story.version_id || subject.story.content_hash !== plan.bindings.story.content_hash)) {
    fail('DRAFT_REVISION_PLAN_STALE', 'story identity changed after planning');
  }
  return { subject, status };
}

/* ── run projection (no new global state authority) ──────────────────────── */

function revisionStatus(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const view = review.promotionDecisionView(runDir, options);
  const version = view.current_draft ? view.current_draft.draft_version + 1 : null;
  const planFile = version ? planPathFor(runDir, version) : null;
  let plan = null;
  if (planFile && fs.existsSync(planFile)) {
    try { plan = loadRevisionPlan(runDir, version).plan; } catch (_) { plan = null; }
  }
  const journalFile = version ? path.join(runDir, REVISION_DIR, `revision-r${version}-journal.json`) : null;
  let journal = null;
  if (journalFile && fs.existsSync(journalFile)) {
    try { journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')); } catch (_) { journal = null; }
  }
  const state = !view.current_draft ? 'NO_CURRENT_DRAFT'
    : !view.current_review ? 'DRAFT_REVIEW_READY_AWAITING_HUMAN_REVIEW'
      : !plan ? 'REVIEW_SUBMITTED_NO_REVISION_PLAN'
        : plan.decision === 'NO_REVISION_REQUIRED' ? 'NO_REVISION_REQUIRED'
          : plan.decision === 'REVISION_BLOCKED' ? 'REVISION_BLOCKED'
            : journal?.state === 'COMPLETE' ? 'REVISION_COMPLETE'
              : journal ? 'REVISION_IN_PROGRESS'
                : 'REVISION_PLAN_READY';
  return {
    run_id: path.basename(runDir),
    state,
    review_state: view.review_state,
    current_review: view.current_review,
    current_draft_version: view.current_draft?.draft_version ?? null,
    plan: plan ? { plan_id: plan.plan_id, decision: plan.decision, work_items: plan.work_items.length, blocking: plan.blocking } : null,
    journal_state: journal?.state ?? null,
    publication_ready: false,
    final_production_locked: false,
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { command: argv[0], repo: path.resolve(__dirname, '..') };
  if (!['plan', 'status', 'show'].includes(out.command)) fail('DRAFT_REVISION_COMMAND_INVALID', String(out.command));
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--repo') out.repo = path.resolve(argv[++index]);
    else fail('DRAFT_REVISION_ARGUMENT_INVALID', argv[index]);
  }
  if (!out.runId) fail('DRAFT_REVISION_ARGUMENT_INVALID', `${out.command} requires --run-id`);
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const runDir = directed.resolveRunDir(args.repo, args.runId);
    if (args.command === 'plan') {
      const result = buildRevisionPlan(runDir);
      process.stdout.write(`${JSON.stringify({ state: result.state, plan_id: result.plan.plan_id, decision: result.plan.decision, work_items: result.plan.work_items.length, blocking: result.plan.blocking, plan_path: result.plan_path }, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'show') {
      const status = revisionStatus(runDir);
      const version = status.current_draft_version ? status.current_draft_version + 1 : null;
      const loaded = version ? loadRevisionPlan(runDir, version) : null;
      process.stdout.write(`${JSON.stringify(loaded?.plan ?? status, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${JSON.stringify(revisionStatus(runDir), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.code || 'DRAFT_REVISION_PLAN_FAILED'}: ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  PLAN_SCHEMA, REVISION_DIR, WORK_DOMAINS, WORK_KINDS, DOMAIN_MAP,
  DraftRevisionPlanError, canonicalize, digest, sha256File, planCore, planPathFor,
  resolveCurrentReviewForRevision, segmentForNote, routeNote, routeVerdict, routePlanInput,
  buildCensus, plannedDiff, buildRevisionPlan, validateRevisionPlan,
  loadRevisionPlan, verifyRevisionPlanCurrent, revisionStatus, parseArgs, main,
};

if (require.main === module) { process.exitCode = main(); }
