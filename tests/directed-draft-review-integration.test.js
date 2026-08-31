'use strict';

const { assert, fs, os, path, test } = require('./_helpers.js');
const directed = require('../scripts/directed-draft-assembly-handoff.js');
const execution = require('../scripts/production-assembly-execution-successor.js');
const subjects = require('../scripts/draft-review-subject.js');
const review = require('../scripts/draft-review-intake.js');

function writeJson(file, value, whitespace = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, whitespace)}\n`);
}
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function errorCode(fn) { try { fn(); return null; } catch (error) { return error.code || error.name; } }

function handoffValue(runId, paths, story, variant = {}) {
  const sections = Array.from({ length: 5 }, (_, index) => ({ section_id: `S0${index + 1}`, in_ms: index * 1000, out_ms: (index + 1) * 1000, duration_ms: 1000 }));
  const beats = sections.map((section, index) => ({ beat_id: `beat-S0${index + 1}`, section_id: section.section_id, start_ms: section.in_ms, end_ms: section.out_ms, layers: [{ asset_id: `asset-${index + 1}`, primary: true }] }));
  const assets = beats.map((beat, index) => ({ asset_id: `asset-${index + 1}`, status: 'ACCEPTED', media_kind: 'IMAGE', sha256: subjects.digest(`asset-${index + 1}`) }));
  const manifestPin = { path: paths.assetManifest, sha256: subjects.sha256File(paths.assetManifest), schema: 'vidtoolz.productionAssemblyAssetManifest.v1' };
  const visualPlan = { plan_id: 'visual-plan-fixture', file_sha256: subjects.digest('visual-plan') };
  const narrationSha = subjects.digest('synthetic narration');
  const alignment = { path: paths.alignment, sha256: subjects.sha256File(paths.alignment), digest: subjects.digest('alignment') };
  const core = {
    schema: directed.HANDOFF_SCHEMA, revision: 1, predecessor: null, run_id: runId,
    source_inventory: { schema: 'fixture', path: 'fixture.json', sha256: subjects.digest('fixture'), active_successor: true, approved_story: story },
    production: {
      story, script: { path: paths.script, sha256: subjects.sha256File(paths.script), schema: 'vidtoolz-script-builder.story-version.v1' },
      visual_plan: visualPlan,
      release_packet: { path: paths.release, sha256: subjects.sha256File(paths.release), schema: 'vidtoolz.productionAssemblyReleasePacket.v1' },
      approvals: {},
    },
    timeline: { duration_ms: 5000, sections },
    narration: { required: true, path: paths.narration, sha256: narrationSha, duration_ms: 5000, source_class: 'SYNTHETIC_DRAFT_NARRATION', alignment, packet_binding: { source_class: 'SYNTHETIC_DRAFT_NARRATION', sha256: narrationSha, alignment: { sha256: alignment.sha256, digest: alignment.digest } } },
    presenter: { required: false, assets: [] },
    visual: { grammar: 'FIXTURE', approved_visual_plan: visualPlan, asset_manifest: manifestPin, composition: { grammar: 'FIXTURE', asset_manifest: { sha256: manifestPin.sha256 }, beats } },
    camera: { required: false },
    media: { registry_authority: manifestPin, assets },
    music: { required: false, asset: null },
    editor: { adapter: 'fixture' },
    provenance: { fixture: true, mutation: variant.handoffToken || 'base' },
  };
  const handoffDigest = directed.digest(core);
  return { ...core, handoff_id: `directed-draft-handoff-${handoffDigest.slice(0, 24)}`, handoff_digest_sha256: handoffDigest };
}

function seedEstate(label = 'base', variant = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `directed-review-${label}-`));
  const runId = variant.runId || `fixture-directed-review-${label}`;
  const runDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  return refreshEstate({ root, runDir, runId }, variant);
}

function refreshEstate(estate, variant = {}) {
  const { runDir, runId } = estate;
  const assemblyDir = path.join(runDir, directed.ASSEMBLY_DIR);
  fs.mkdirSync(assemblyDir, { recursive: true });
  const paths = {
    script: path.join(runDir, 'fixture-story.md'), release: path.join(runDir, 'fixture-release.json'),
    narration: path.join(runDir, 'fixture-narration.wav'), alignment: path.join(runDir, 'fixture-alignment.json'),
    assetManifest: path.join(runDir, 'fixture-assets.json'), output: path.join(assemblyDir, 'directed-draft-r1.mp4'),
  };
  write(paths.script, variant.scriptBytes || '# Synthetic fixture story\n');
  writeJson(paths.release, { schema: 'vidtoolz.productionAssemblyReleasePacket.v1', fixture: true, mutation: variant.releaseToken || 'base' });
  write(paths.narration, 'synthetic narration fixture');
  writeJson(paths.alignment, { fixture: true });
  writeJson(paths.assetManifest, { schema: 'vidtoolz.productionAssemblyAssetManifest.v1', fixture: true });
  if (fs.existsSync(paths.output)) fs.unlinkSync(paths.output);
  write(paths.output, variant.outputBytes || 'synthetic directed draft bytes');

  const story = { project_id: variant.projectId || 'fixture-project', version_id: variant.storyVersion || 'fixture-story-v1', content_hash: variant.storyHash || subjects.digest('fixture-story'), approval_state: 'approved' };
  const handoff = handoffValue(runId, paths, story, variant);
  const handoffFile = path.join(assemblyDir, `${handoff.handoff_id}.json`);
  writeJson(handoffFile, handoff);

  const semantic = { schema: 'fixture.renderPlan.v1', token: variant.planToken || 'base' };
  const plan = { ...semantic, plan_digest_sha256: execution.digest(semantic), ffmpeg_invocation: { args: ['fixture'] } };
  const base = execution.basePaths(paths.output, plan);
  const predecessor = { kind: 'LEGACY', attempt_id: 'legacy-fixture', plan: { path: 'legacy-plan', sha256: subjects.digest('legacy-plan') }, state: { path: 'legacy-state', sha256: subjects.digest('legacy-state'), state: 'INCOMPLETE', phase: 'FAILED' }, completion: null };
  const implCore = { fixture: true, token: variant.attemptToken || 'base' };
  const implementation = { ...implCore, implementation_digest_sha256: execution.digest(implCore) };
  const attempt = execution.buildAttempt(plan, predecessor, implementation, { changed_fields: [] }, '2026-08-31T00:00:00.000Z');
  attempt.execution.plan_sha256 = execution.jsonSha(plan);
  const unsignedAttempt = { ...attempt }; delete unsignedAttempt.attempt_digest_sha256;
  attempt.attempt_digest_sha256 = execution.digest(unsignedAttempt);
  const attemptPaths = execution.attemptPaths(base.base, attempt.attempt_id);
  writeJson(attemptPaths.plan, plan);
  writeJson(attemptPaths.attempt, attempt);
  writeJson(attemptPaths.completion, { state: 'COMPLETE', fixture: true });
  const head = { schema: execution.HEAD_SCHEMA, semantic_plan_digest_sha256: plan.plan_digest_sha256, active_attempt_id: attempt.attempt_id, active_attempt_path: attemptPaths.attempt, active_attempt_sha256: subjects.sha256File(attemptPaths.attempt) };
  if (variant.firstRender) { if (fs.existsSync(base.head)) fs.unlinkSync(base.head); } else writeJson(base.head, head, variant.headWhitespace || 2);
  const outputSha = subjects.sha256File(paths.output);
  const fullAttemptBinding = { schema: execution.ATTEMPT_SCHEMA, attempt_id: attempt.attempt_id, attempt_digest_sha256: attempt.attempt_digest_sha256, predecessor_attempt_id: attempt.predecessor.attempt_id, retry_reason: attempt.retry_reason, execution_identity_sha256: attempt.execution.execution_identity_sha256 };
  const attemptBinding = variant.firstRender ? null : fullAttemptBinding;
  const manifest = { schema: 'vidtoolz.productionAssemblyManifest.v1', state: 'QC_PASSED_PENDING_FINALIZATION', run_id: runId, output_sha256: outputSha, plan_digest_sha256: plan.plan_digest_sha256, ...(variant.manifestAttempt !== undefined ? { execution_attempt: variant.manifestAttempt } : attemptBinding ? { execution_attempt: attemptBinding } : {}), story, narration_source_class: 'SYNTHETIC_DRAFT_NARRATION' };
  writeJson(attemptPaths.manifest, manifest);
  const evidenceFile = path.join(assemblyDir, `${handoff.handoff_id}.review-evidence.json`);
  const evidence = {
    schema: directed.REVIEW_EVIDENCE_SCHEMA, state: variant.evidenceState || 'VERIFIED', run_id: runId, draft_version: 1,
    assembly_manifest: { file: path.relative(runDir, attemptPaths.manifest), sha256: subjects.sha256File(attemptPaths.manifest) },
    output: { path: path.relative(runDir, paths.output), sha256: variant.claimedOutputSha || outputSha, bytes: fs.statSync(paths.output).size, duration_seconds: 5, width: 1080, height: 1920, fps: '30/1', has_audio: true },
    script: { path: paths.script, sha256: variant.evidenceScriptSha || subjects.sha256File(paths.script), schema: 'vidtoolz-script-builder.story-version.v1' },
    narration: { audio_sha256: subjects.digest('synthetic narration'), fidelity: 'SYNTHETIC_DRAFT_NARRATION', is_presenter_voice: false },
    ...(variant.evidenceAttempt !== undefined ? { execution_attempt: variant.evidenceAttempt } : attemptBinding ? { execution_attempt: attemptBinding } : {}),
    source_binding: { ok: true, drift: [], handoff_digest_sha256: variant.evidenceHandoffDigest || handoff.handoff_digest_sha256 },
    technical_validation: variant.technicalValidation || { ok: true, failures: [], decode_pass: true },
    fixture_marker: variant.evidenceToken || 'base',
  };
  if (!variant.missingEvidence) writeJson(evidenceFile, evidence);
  else if (fs.existsSync(evidenceFile)) fs.unlinkSync(evidenceFile);
  const completion = {
    schema: directed.COMPLETION_SCHEMA, state: variant.completionState || 'COMPLETE_REVIEWABLE_DRAFT', run_id: runId,
    handoff_id: handoff.handoff_id, handoff_digest_sha256: handoff.handoff_digest_sha256,
    output_path: paths.output, output_sha256: outputSha,
    renderer_completion_path: attemptPaths.completion, renderer_execution_attempt: variant.completionAttempt !== undefined ? variant.completionAttempt : attemptBinding,
    renderer_plan_digest_sha256: variant.completionPlanDigest || plan.plan_digest_sha256,
    review_evidence_path: evidenceFile,
  };
  writeJson(path.join(assemblyDir, `${handoff.handoff_id}.complete.json`), completion);
  const state = { schema: directed.STATE_SCHEMA, run_id: variant.stateRunId || runId, revision: 1, active_handoff_id: handoff.handoff_id, active_handoff_digest_sha256: handoff.handoff_digest_sha256, handoff_path: handoffFile, receipt_path: path.join(assemblyDir, `${handoff.handoff_id}.receipt.json`) };
  writeJson(path.join(assemblyDir, directed.STATE_FILE), state);
  return Object.assign(estate, { paths, handoff, handoffFile, evidence, evidenceFile, completion, plan, base, attempt, attemptPaths, head, story });
}

function completeReview(estate, id = 'fixture-review') {
  const opened = review.openReview(estate.runDir, { reviewId: id, reviewer: 'fixture-human', reviewerAuthority: 'TEST_HUMAN:fixture', recordedBy: 'test-suite' });
  const decisions = ['KEEP', 'CHANGE', 'CUT', 'REWRITE'];
  decisions.forEach((disposition, index) => review.addNote(estate.runDir, id, { timecode_seconds: index + 0.1, disposition, target_domain: index === 0 ? 'VISUAL' : 'SCRIPT', comment: index === 1 ? 'Keep this wording exactly — apostrophe\nand all.' : `${disposition} fixture note` }));
  review.RATING_AXES.forEach((axis, index) => review.setRating(estate.runDir, id, axis, index + 4));
  review.setDraftVerdict(estate.runDir, id, 'CHANGE', { note: 'Fixture changes requested.' });
  review.submitReview(estate.runDir, id, { overallComment: 'Verbatim fixture overall note.' });
  return opened;
}

function staleAfter(variant) {
  const estate = seedEstate(`stale-${Object.keys(variant)[0]}`);
  completeReview(estate);
  refreshEstate(estate, variant);
  return review.reviewStatus(estate.runDir, 'fixture-review');
}

test('DDHR01 valid verified Directed Draft resolves review-ready', () => { const s = subjects.resolveDirectedSubject(seedEstate('ready').runDir); assert.equal(s.status, 'DRAFT_REVIEW_READY'); });
test('DDHR02 failed execution is not review-ready', () => { const e = seedEstate('failed', { completionState: 'FAILED' }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_EXECUTION_FAILED'); });
test('DDHR03 missing draftAssemblyEvidence is rejected', () => { const e = seedEstate('missing-evidence', { missingEvidence: true }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_EVIDENCE_MISSING'); });
test('DDHR04 unverified evidence is rejected', () => { const e = seedEstate('unverified', { evidenceState: 'PENDING' }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_EVIDENCE_UNVERIFIED'); });
test('DDHR05 output hash mismatch is rejected', () => { const e = seedEstate('bad-output', { claimedOutputSha: subjects.digest('wrong') }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_OUTPUT_HASH_MISMATCH'); });
test('DDHR06 execution identity mismatch is rejected', () => { const wrong = { attempt_id: 'execution-wrong' }; const e = seedEstate('bad-execution', { completionAttempt: wrong }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_EXECUTION_MISMATCH'); });
test('DDHR07 semantic plan mismatch is rejected', () => { const e = seedEstate('bad-plan', { completionPlanDigest: subjects.digest('wrong') }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_SEMANTIC_PLAN_MISMATCH'); });
test('DDHR08 handoff mismatch is rejected', () => { const e = seedEstate('bad-handoff', { evidenceHandoffDigest: subjects.digest('wrong') }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_HANDOFF_MISMATCH'); });
test('DDHR09 script mismatch is rejected', () => { const e = seedEstate('bad-script', { evidenceScriptSha: subjects.digest('wrong') }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_SCRIPT_MISMATCH'); });
test('DDHR10 wrong project/run is rejected', () => { const e = seedEstate('bad-run', { stateRunId: 'another-run' }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_RUN_MISMATCH'); });
test('DDHR11 stale older review does not become current', () => { assert.equal(staleAfter({ outputBytes: 'successor bytes' }).current, false); });
test('DDHR12 current exact review is current', () => { const e = seedEstate('current'); completeReview(e); assert.equal(review.reviewStatus(e.runDir, 'fixture-review').current, true); });
test('DDHR13 changed output bytes makes review stale', () => { assert.equal(staleAfter({ outputBytes: 'different visible bytes' }).lifecycle, 'STALE_FOR_CURRENT_DRAFT'); });
test('DDHR14 changed execution attempt makes review stale', () => { assert.equal(staleAfter({ attemptToken: 'successor' }).current, false); });
test('DDHR15 changed execution head bytes makes review stale', () => { assert.equal(staleAfter({ headWhitespace: 4 }).current, false); });
test('DDHR16 changed semantic plan makes review stale', () => { assert.equal(staleAfter({ planToken: 'changed' }).current, false); });
test('DDHR17 changed handoff makes review stale', () => { assert.equal(staleAfter({ handoffToken: 'changed' }).current, false); });
test('DDHR18 changed script makes review stale', () => { assert.equal(staleAfter({ scriptBytes: '# Different fixture story\n' }).current, false); });
test('DDHR19 changed evidence makes review stale', () => { assert.equal(staleAfter({ evidenceToken: 'changed' }).current, false); });
test('DDHR20 first LEGACY render without an execution head resolves review-ready', () => { const s = subjects.resolveDirectedSubject(seedEstate('first-render', { firstRender: true }).runDir); assert.equal(s.status, 'DRAFT_REVIEW_READY'); assert.equal(s.execution, null); assert.equal(s.publication_ready, false); });
test('DDHR21 completion claiming an attempt without an execution head is rejected', () => { const e = seedEstate('claimed-attempt', { firstRender: true, completionAttempt: { attempt_id: 'execution-abcdefabcdefabcdefabcdef' } }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_EXECUTION_HEAD_MISSING'); });
test('DDHR22 evidence claiming an attempt without an execution head is rejected', () => { const e = seedEstate('claimed-evidence', { firstRender: true, evidenceAttempt: { attempt_id: 'execution-abcdefabcdefabcdefabcdef' } }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_EXECUTION_MISMATCH'); });
test('DDHR23 first-render semantic plan mismatch stays rejected', () => { const e = seedEstate('first-plan-mismatch', { firstRender: true, completionPlanDigest: subjects.digest('wrong') }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_SEMANTIC_PLAN_MISMATCH'); });
test('DDHR20 changed release makes review stale', () => { assert.equal(staleAfter({ releaseToken: 'changed' }).current, false); });
test('DDHR21 changed story identity makes review stale', () => { assert.equal(staleAfter({ storyVersion: 'fixture-story-v2' }).current, false); });
test('DDHR22 KEEP round-trips unchanged', () => { const e = seedEstate('keep'); completeReview(e); assert.equal(review.readReview(e.runDir, 'fixture-review').notes[0].disposition, 'KEEP'); });
test('DDHR23 CHANGE round-trips unchanged', () => { const e = seedEstate('change'); completeReview(e); assert.equal(review.readReview(e.runDir, 'fixture-review').notes[1].disposition, 'CHANGE'); });
test('DDHR24 CUT round-trips unchanged', () => { const e = seedEstate('cut'); completeReview(e); assert.equal(review.readReview(e.runDir, 'fixture-review').notes[2].disposition, 'CUT'); });
test('DDHR25 REWRITE round-trips unchanged', () => { const e = seedEstate('rewrite'); completeReview(e); assert.equal(review.readReview(e.runDir, 'fixture-review').notes[3].disposition, 'REWRITE'); });
test('DDHR26 EXPLICIT_KEEP differs from NO_FEEDBACK', () => { const e = seedEstate('keep-no-feedback'); completeReview(e); const p = review.revisionPlanInput(e.runDir, 'fixture-review'); assert.equal(p.sections[0].feedback_state, 'EXPLICIT_KEEP'); assert.equal(p.sections[4].feedback_state, 'NO_FEEDBACK'); });
test('DDHR27 seven ratings round-trip unchanged', () => { const e = seedEstate('ratings'); completeReview(e); assert.deepEqual(Object.values(review.readReview(e.runDir, 'fixture-review').ratings), [4, 5, 6, 7, 8, 9, 10]); });
test('DDHR28 verbatim notes round-trip unchanged', () => { const e = seedEstate('verbatim'); completeReview(e); assert.equal(review.readReview(e.runDir, 'fixture-review').notes[1].comment, 'Keep this wording exactly — apostrophe\nand all.'); });
test('DDHR29 valid review projects revision-plan input with exact subject', () => { const e = seedEstate('plan'); completeReview(e); const p = review.revisionPlanInput(e.runDir, 'fixture-review'); assert.equal(p.predecessor_draft.review_subject.output_sha256, subjects.sha256File(e.paths.output)); assert.equal(p.totals.sections, 5); });
test('DDHR30 advisory approval cannot claim exact draft approval', () => { const e = seedEstate('no-fabrication'); review.openReview(e.runDir, { reviewId: 'open', reviewerAuthority: 'TEST_HUMAN:fixture' }); review.setApproval(e.runDir, 'open', 'script', 'APPROVED'); const v = review.promotionDecisionView(e.runDir); assert.equal(v.decision.review_submitted, false); assert.equal(v.decision.draft_approved, false); });
test('DDHR31 review submission creates no production lock', () => { const e = seedEstate('no-lock'); completeReview(e); const v = review.promotionDecisionView(e.runDir); assert.equal(v.decision.production_lock_implemented, false); assert.equal(fs.existsSync(path.join(e.runDir, 'final-production-lock.json')), false); });
test('DDHR32 synthetic narration remains reviewable', () => { const s = subjects.resolveReviewSubject(seedEstate('synthetic').runDir); assert.equal(s.narration.fidelity, 'SYNTHETIC_DRAFT_NARRATION'); assert.equal(s.narration.is_presenter_voice, false); });
test('DDHR33 publication readiness remains false', () => { const v = review.promotionDecisionView(seedEstate('publication').runDir); assert.equal(v.decision.publication_ready, false); });
test('DDHR34 multiple historical reviews coexist and newest compatible resolves deterministically', () => { const e = seedEstate('history'); completeReview(e, 'a-review'); completeReview(e, 'z-review'); const first = review.readReview(e.runDir, 'a-review'); first.draft.output_sha256 = subjects.digest('old'); review.writeReview(e.runDir, first); const v = review.promotionDecisionView(e.runDir); assert.equal(v.current_review.review_id, 'z-review'); assert.equal(v.historical_reviews.some((item) => item.review_id === 'a-review'), true); });
test('DDHR35 fabricated evidence identity is rejected', () => { const e = seedEstate('fabricated'); const evidence = JSON.parse(fs.readFileSync(e.evidenceFile)); evidence.execution_attempt.attempt_id = 'execution-fabricated'; writeJson(e.evidenceFile, evidence); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_EXECUTION_MISMATCH'); });
test('DDHR36 modified submitted review bytes are non-current', () => { const e = seedEstate('tamper'); completeReview(e); const r = review.readReview(e.runDir, 'fixture-review'); r.notes[0].comment = 'tampered'; review.writeReview(e.runDir, r); const s = review.reviewStatus(e.runDir, 'fixture-review'); assert.equal(s.submission_intact, false); assert.equal(s.current, false); });
test('DDHR37 incomplete technical validation is rejected', () => { const e = seedEstate('technical', { technicalValidation: { ok: false, failures: ['missing media'], decode_pass: false } }); assert.equal(subjects.inspectReviewSubject(e.runDir).code, 'DIRECTED_REVIEW_TECHNICAL_EVIDENCE_INVALID'); });
test('DDHR38 submitted CHANGE review is changes-requested, not approved', () => { const e = seedEstate('states'); completeReview(e); const v = review.promotionDecisionView(e.runDir); assert.equal(v.review_state, 'DRAFT_CHANGES_REQUESTED'); assert.equal(v.decision.draft_approved, false); });
test('DDHR39 submitted exact KEEP is draft-approved but not publication-ready', () => { const e = seedEstate('approved'); review.openReview(e.runDir, { reviewId: 'keep', reviewerAuthority: 'TEST_HUMAN:fixture' }); review.setDraftVerdict(e.runDir, 'keep', 'KEEP'); review.submitReview(e.runDir, 'keep'); const v = review.promotionDecisionView(e.runDir); assert.equal(v.review_state, 'DRAFT_APPROVED'); assert.equal(v.decision.publication_ready, false); });
test('DDHR40 beat and section identities are preserved in notes', () => { const e = seedEstate('beat'); review.openReview(e.runDir, { reviewId: 'note', reviewerAuthority: 'TEST_HUMAN:fixture' }); const result = review.addNote(e.runDir, 'note', { timecode_seconds: 2.2, disposition: 'CHANGE', comment: 'fixture' }); assert.equal(result.note.section_id, 'S03'); assert.equal(result.note.beat, 'beat-S03'); });
test('DDHR41 visual concept and image execution remain optional dimensions inside draftReview.v2', () => { const e = seedEstate('visual-dimensions'); review.openReview(e.runDir, { reviewId: 'visual', reviewerAuthority: 'TEST_HUMAN:fixture' }); review.addNote(e.runDir, 'visual', { timecode_seconds: 0.2, disposition: 'KEEP', target_domain: 'VISUAL', visual_dimension: 'VISUAL_CONCEPT', comment: 'Keep the visual idea, not these disposable bytes.' }); review.addNote(e.runDir, 'visual', { timecode_seconds: 0.3, disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'The generated execution is weak.' }); const input = review.revisionPlanInput(e.runDir, 'visual'); assert.deepEqual(input.sections[0].visual_review_dimensions, ['VISUAL_CONCEPT', 'IMAGE_EXECUTION']); assert.equal(input.sections[0].notes[0].visual_dimension, 'VISUAL_CONCEPT'); assert.equal(input.authority.draft_visual_keep_preserves_concept_not_bytes, true); assert.equal(input.authority.draft_visual_bytes_can_become_final_asset_authority, false); });
test('DDHR42 visual dimension fails closed outside VISUAL domain or canonical vocabulary', () => { const e = seedEstate('visual-dimension-reject'); review.openReview(e.runDir, { reviewId: 'visual', reviewerAuthority: 'TEST_HUMAN:fixture' }); assert.equal(errorCode(() => review.addNote(e.runDir, 'visual', { timecode_seconds: 0.2, disposition: 'KEEP', target_domain: 'SCRIPT', visual_dimension: 'VISUAL_CONCEPT', comment: 'fixture' })), 'DRAFT_REVIEW_VISUAL_DIMENSION_REQUIRES_VISUAL_DOMAIN'); assert.equal(errorCode(() => review.addNote(e.runDir, 'visual', { timecode_seconds: 0.2, disposition: 'KEEP', target_domain: 'VISUAL', visual_dimension: 'PUBLICATION_QUALITY', comment: 'fixture' })), 'DRAFT_REVIEW_VISUAL_DIMENSION_INVALID'); });
test('DDHR41 changed run identity makes a bound review stale', () => { const e = seedEstate('run-stale'); completeReview(e); const stateFile = path.join(e.runDir, directed.ASSEMBLY_DIR, directed.STATE_FILE); const state = JSON.parse(fs.readFileSync(stateFile)); state.run_id = 'different-run'; writeJson(stateFile, state); assert.equal(review.reviewStatus(e.runDir, 'fixture-review').current, false); });
test('DDHR42 historical Mikko wrapper is preserved but cannot satisfy current gate', () => { const e = seedEstate('legacy-history'); writeJson(path.join(e.runDir, 'HUMAN-REVIEW-V1.json'), { schema: 'vidtoolz.frr.humanReview.v1', draft_id: 'old-draft', draft_sha256: subjects.digest('old output'), draft_verdict: 'KEEP', review_completion_status: 'SUBMITTED', reviewer_authority: 'Mikko Pakkala', binding: { review_bound_to_draft_sha256: subjects.digest('old output') } }); const v = review.promotionDecisionView(e.runDir); assert.equal(v.current_review, null); assert.equal(v.historical_reviews[0].lifecycle, 'STALE_FOR_CURRENT_DRAFT'); });
