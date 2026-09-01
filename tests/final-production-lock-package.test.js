'use strict';

/*
 * DRAFT_APPROVED → FINAL_PRODUCTION_LOCK → FINAL_PRODUCTION_PACKAGE certification.
 *
 * Fixture estates reuse the certified Draft revision harness (which builds a
 * real Story, a real bespoke Visual Plan and renders r1 through the real
 * Directed Draft handoff), then record a real KEEP approval and drive the lock
 * and package. No approval, asset, performance, music or publication authority
 * is ever fabricated.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');

const revisionHarness = require('./draft-revision-successor.test.js');
const review = require('../scripts/draft-review-intake.js');
const subjects = require('../scripts/draft-review-subject.js');
const storyBinding = require('../scripts/package-run-story-binding.js');
const productionMode = require('../scripts/package-run-production-mode.js');
const planningTask = require('../scripts/agent-task-visual-planning.js');
const narration = require('../scripts/package-run-draft-narration.js');
const lockAuthority = require('../scripts/final-production-lock.js');
const packageAuthority = require('../scripts/final-production-package.js');

function shaFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); return file; }
function errorCode(fn, code) {
  let got = 'no throw';
  try { fn(); } catch (error) { got = error.code; }
  assert.equal(got, code, `expected ${code}, got ${got}`);
}

/* ── research evidence: the real gate the lock consults ──────────────────── */

/*
 * A research pack the REAL canonical research-evidence authority accepts.
 * Nothing here is stubbed or injected: the tables carry the same five-column
 * shape and concrete/ready semantics the authority parses in production, so
 * the lock is exercised against the actual gate.
 */
function seedResearchEvidence(runDir) {
  const table = (header, rows) => [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
  writeJson(path.join(runDir, 'selected-package.json'), { topic: 'Fixture topic for Final Production Lock certification', run: path.basename(runDir) });
  fs.writeFileSync(path.join(runDir, 'source-support-map.md'), `# Source support map\n\n${table(
    ['source/reference', 'claim supported', 'evidence type', 'reliability note', 'status'],
    [
      [path.join(runDir, 'story-binding.json'), 'The fixture run binds exactly one approved Story version', 'primary production record', 'Local hash-verified binding file on disk', 'verified'],
      [path.join(runDir, 'production-mode.json'), 'The fixture run is declared DRAFT mode by the canonical authority', 'primary production record', 'Local canonical mode marker on disk', 'verified'],
    ],
  )}`);
  fs.writeFileSync(path.join(runDir, 'proof-capture-plan.md'), `# Proof capture plan\n\n${table(
    ['proof item', 'what it proves', 'local capture method', 'file/app/source', 'status'],
    [['Rendered fixture Draft', 'The Draft assembled end to end and its output hash is reproducible', 'read the review evidence and re-hash the output', path.join(runDir, 'media/directed-draft-assembly'), 'captured']],
  )}`);
  fs.writeFileSync(path.join(runDir, 'research-objections.md'), `# Research objections\n\n${table(
    ['objection/counterexample', 'why it matters', 'evidence needed', 'response plan', 'status'],
    [['A fixture estate is not a real production run', 'Certification must not claim live production proof', 'The mission separates fixture certification from the real canary', 'Fixture scope is stated explicitly in the evidence', 'resolved']],
  )}`);
  fs.writeFileSync(path.join(runDir, 'research-evidence.md'), '# Research evidence\n\nResearch approval: PASS\n');
}

function researchOk(runDir) {
  const evidence = require('../scripts/package-run-research-evidence.js');
  const result = evidence.evaluateResearchEvidence(runDir);
  return result.status === 'PASS' && result.approval === true;
}

/* ── an approved-Draft estate ────────────────────────────────────────────── */

async function approvedEstate(label, options = {}) {
  const estate = await revisionHarness.reviewedEstate(`fpl-${label}`, [], {
    verdict: 'KEEP', ratings: false, reviewId: options.reviewId || 'mikko-approved',
    overallComment: undefined,
  });
  if (options.research !== false) seedResearchEvidence(estate.runDir);
  return estate;
}

/* The revision harness submits with an overall comment; that is fine, but the
 * approval semantics must come from the verdict alone. */
function assertApproved(estate) {
  const view = review.promotionDecisionView(estate.runDir);
  assert.equal(view.review_state, 'DRAFT_APPROVED');
  assert.equal(view.decision.draft_approved, true);
  assert.equal(view.decision.changes_requested, false);
  return view;
}

async function lockedEstate(label, options = {}) {
  const estate = await approvedEstate(label, options);
  assertApproved(estate);
  const created = lockAuthority.createFinalProductionLock(estate.runDir, {
    expectedDraftSha256: subjects.resolveReviewSubject(estate.runDir).output.sha256,
    scriptBuilderRoot: estate.story.root,
  });
  return { ...estate, lock: created.lock, lock_path: created.lock_path };
}

async function packagedEstate(label, options = {}) {
  const estate = await lockedEstate(label, options);
  const built = packageAuthority.createFinalProductionPackage(estate.runDir, { scriptBuilderRoot: estate.story.root });
  return { ...estate, built, paths: packageAuthority.packagePaths(estate.runDir) };
}

/* ── §2/§3 approval ──────────────────────────────────────────────────────── */

test('FPL01 a KEEP verdict with no change requests is DRAFT_APPROVED with no fabricated fields', async () => {
  const estate = await approvedEstate('approval');
  const record = review.readReview(estate.runDir, 'mikko-approved');
  assert.equal(record.draft_verdict, 'KEEP');
  assert.equal(record.notes.length, 0, 'no notes are fabricated');
  assert.ok(Object.values(record.ratings).every((value) => value === null), 'no ratings are invented');
  assert.deepEqual(Object.values(record.approvals).map((item) => item.state), ['NOT_ASSESSED', 'NOT_ASSESSED'], 'research/script declarations are not fabricated');
  assert.equal(record.completion_status, 'SUBMITTED');
  const view = assertApproved(estate);
  assert.equal(view.decision.publication_ready, false);
  assert.equal(view.decision.final_production_locked, false);
  assert.equal(view.authority.review_authority, 'vidtoolz.draftReview.v2', 'no second review schema');
});

test('FPL02 the lock binds the exact approved bytes and refuses a mismatched expectation', async () => {
  const estate = await approvedEstate('bytes');
  const subject = subjects.resolveReviewSubject(estate.runDir);
  errorCode(() => lockAuthority.createFinalProductionLock(estate.runDir, { expectedDraftSha256: 'f'.repeat(64), scriptBuilderRoot: estate.story.root }), 'FINAL_LOCK_DRAFT_SHA_MISMATCH');
  const created = lockAuthority.createFinalProductionLock(estate.runDir, { expectedDraftSha256: subject.output.sha256, scriptBuilderRoot: estate.story.root });
  assert.equal(created.state, 'LOCKED');
  assert.equal(created.lock.approved_draft.output_sha256, subject.output.sha256);
  assert.equal(created.lock.approved_draft.review_subject_digest_sha256, subject.subject_digest_sha256);
  assert.equal(created.lock.human_approval.review_id, 'mikko-approved');
  assert.equal(created.lock.human_approval.derived_state, 'DRAFT_APPROVED');
  assert.equal(created.lock.locked_script.story_version_id, subject.story.version_id);
  assert.equal(created.lock.directed_draft_authority.handoff_digest_sha256, subject.handoff.digest_sha256);
  assert.equal(created.lock.directed_draft_authority.evidence_sha256, subject.evidence.sha256);
  lockAuthority.validateFinalProductionLock(created.lock);
});

test('FPL03 approval tamper: modified Draft bytes, copied approval and fabricated records all fail closed', async () => {
  // modified Draft after approval
  const moved = await approvedEstate('tamper-bytes');
  fs.appendFileSync(path.join(moved.runDir, 'media/directed-draft-assembly/directed-draft-r1.mp4'), ' tampered');
  errorCode(() => lockAuthority.createFinalProductionLock(moved.runDir, { scriptBuilderRoot: moved.story.root }), 'FINAL_LOCK_DRAFT_INVALID');
  // approval bytes edited after submission
  const edited = await approvedEstate('tamper-review');
  const record = review.readReview(edited.runDir, 'mikko-approved');
  record.draft_verdict_note = 'fabricated stronger approval';
  review.writeReview(edited.runDir, record);
  errorCode(() => lockAuthority.createFinalProductionLock(edited.runDir, { scriptBuilderRoot: edited.story.root }), 'FINAL_LOCK_APPROVAL_MISSING');
  // an unsubmitted review is not approval
  const open = await revisionHarness.reviewedEstate('fpl-open', [], { submit: false, ratings: false, reviewId: 'open' });
  seedResearchEvidence(open.runDir);
  errorCode(() => lockAuthority.createFinalProductionLock(open.runDir, { scriptBuilderRoot: open.story.root }), 'FINAL_LOCK_APPROVAL_MISSING');
  // a changes-requested review can never lock
  const changed = await revisionHarness.reviewedEstate('fpl-changes', [
    { timecode_seconds: 1, disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate this still.' },
  ], { verdict: 'CHANGE', ratings: false, reviewId: 'changes' });
  seedResearchEvidence(changed.runDir);
  errorCode(() => lockAuthority.createFinalProductionLock(changed.runDir, { scriptBuilderRoot: changed.story.root }), 'FINAL_LOCK_CHANGES_REQUESTED');
});

test('FPL04 research approval is required, and inherits ONLY through hash-bound successor lineage', async () => {
  // no research evidence at all -> the lock refuses
  const bare = await approvedEstate('research-missing', { research: false });
  errorCode(() => lockAuthority.createFinalProductionLock(bare.runDir, { scriptBuilderRoot: bare.story.root }), 'FINAL_LOCK_RESEARCH_APPROVAL_REQUIRED');
  // own-run research evidence satisfies it
  seedResearchEvidence(bare.runDir);
  assert.equal(researchOk(bare.runDir), true);
  const own = lockAuthority.resolveResearchApproval(bare.runDir);
  assert.equal(own.approved, true);
  assert.equal(own.source, 'OWN_RUN');
  // inheritance: a successor run with no research pack, whose PRODUCTION
  // predecessor passes, resolves through the verified binding chain
  const succ = await approvedEstate('research-inherit', { research: false });
  const predecessorId = 'fpl-predecessor-production-run';
  const predecessorDir = path.join(path.dirname(succ.runDir), predecessorId);
  fs.mkdirSync(predecessorDir, { recursive: true });
  const predBinding = storyBinding.buildBinding({
    runId: predecessorId, projectId: succ.story.project.id, versionId: succ.story.v1.id,
    contentHash: succ.story.v1.content_hash, scriptBuilderRoot: succ.story.root,
    boundAt: '2026-08-26T00:00:00Z', boundBy: 'fixture-human',
  });
  storyBinding.writeBinding(predecessorDir, predBinding);
  productionMode.setProductionMode(predecessorDir, productionMode.PRODUCTION, { setBy: 'Mikko', setAt: '2026-08-26T00:00:00Z' });
  seedResearchEvidence(predecessorDir);
  const predBindingSha = shaFile(path.join(predecessorDir, storyBinding.BINDING_FILE));
  const binding = storyBinding.readBinding(succ.runDir);
  binding.provenance = { predecessor_run_id: predecessorId, predecessor_binding_sha256: predBindingSha, immutable_successor: true };
  writeJson(path.join(succ.runDir, storyBinding.BINDING_FILE), binding);
  writeJson(path.join(succ.runDir, 'draft-bespoke-successor.json'), { predecessor: { run_id: predecessorId } });
  const inherited = lockAuthority.resolveResearchApproval(succ.runDir);
  assert.equal(inherited.approved, true);
  assert.equal(inherited.source, 'INHERITED_FROM_PREDECESSOR_PRODUCTION_RUN');
  assert.equal(inherited.lineage.predecessor_run_id, predecessorId);
  assert.equal(inherited.lineage.predecessor_binding_sha256, predBindingSha);
  // a tampered predecessor binding breaks inheritance
  const tamperedBinding = storyBinding.readBinding(predecessorDir);
  tamperedBinding.bound_by = 'someone else';
  writeJson(path.join(predecessorDir, storyBinding.BINDING_FILE), tamperedBinding);
  errorCode(() => lockAuthority.resolveResearchApproval(succ.runDir), 'FINAL_LOCK_RESEARCH_LINEAGE_TAMPERED');
});

test('FPL05 inconsistent or non-PRODUCTION lineage cannot supply research approval', async () => {
  const succ = await approvedEstate('research-bad-lineage', { research: false });
  const predecessorId = 'fpl-draft-predecessor';
  const predecessorDir = path.join(path.dirname(succ.runDir), predecessorId);
  fs.mkdirSync(predecessorDir, { recursive: true });
  storyBinding.writeBinding(predecessorDir, storyBinding.buildBinding({
    runId: predecessorId, projectId: succ.story.project.id, versionId: succ.story.v1.id,
    contentHash: succ.story.v1.content_hash, scriptBuilderRoot: succ.story.root, boundAt: '2026-08-26T00:00:00Z', boundBy: 'fixture',
  }));
  productionMode.setProductionMode(predecessorDir, productionMode.DRAFT, { setBy: 'fixture', setAt: '2026-08-26T00:00:00Z' });
  seedResearchEvidence(predecessorDir);
  const sha = shaFile(path.join(predecessorDir, storyBinding.BINDING_FILE));
  const binding = storyBinding.readBinding(succ.runDir);
  binding.provenance = { predecessor_run_id: predecessorId, predecessor_binding_sha256: sha, immutable_successor: true };
  writeJson(path.join(succ.runDir, storyBinding.BINDING_FILE), binding);
  // (a) the two declarations must agree
  writeJson(path.join(succ.runDir, 'draft-bespoke-successor.json'), { predecessor: { run_id: 'some-other-run' } });
  errorCode(() => lockAuthority.resolveResearchApproval(succ.runDir), 'FINAL_LOCK_RESEARCH_LINEAGE_INCONSISTENT');
  // (b) a DRAFT predecessor is not a research authority
  writeJson(path.join(succ.runDir, 'draft-bespoke-successor.json'), { predecessor: { run_id: predecessorId } });
  errorCode(() => lockAuthority.resolveResearchApproval(succ.runDir), 'FINAL_LOCK_RESEARCH_LINEAGE_INVALID');
});

/* ── §32 lock hostile matrix ─────────────────────────────────────────────── */

test('FPL06 lock hostile matrix: drift, mutation, duplicates and escalation all fail closed', async () => {
  const estate = await lockedEstate('hostile-lock');
  const lock = estate.lock;
  // (10) lock mutation is detected by the digest
  const mutated = structuredClone(lock);
  mutated.locked_script.story_content_hash = 'f'.repeat(64);
  errorCode(() => lockAuthority.validateFinalProductionLock(mutated), 'FINAL_LOCK_TAMPERED');
  // authority escalation in any direction
  for (const field of ['publication_authority', 'publication_ready', 'final_master_exists', 'final_qc_pass', 'grants_final_asset_authority', 'grants_final_music_authority', 'grants_final_performance_authority']) {
    const escalated = structuredClone(lock);
    escalated.authority[field] = true;
    const core = { ...escalated }; delete core.lock_digest_sha256;
    escalated.lock_digest_sha256 = lockAuthority.digest(core);
    errorCode(() => lockAuthority.validateFinalProductionLock(escalated), 'FINAL_LOCK_AUTHORITY_ESCALATION');
  }
  // Draft narration may never claim final performance authority
  const narrationEscalated = structuredClone(lock);
  narrationEscalated.draft_narration.final_human_performance_authority = true;
  const core2 = { ...narrationEscalated }; delete core2.lock_digest_sha256;
  narrationEscalated.lock_digest_sha256 = lockAuthority.digest(core2);
  errorCode(() => lockAuthority.validateFinalProductionLock(narrationEscalated), 'FINAL_LOCK_AUTHORITY_ESCALATION');
  // (11) a duplicate incompatible lock is refused
  const onDisk = readJson(estate.lock_path);
  onDisk.created_by = 'someone-else';
  writeJson(estate.lock_path, onDisk);
  errorCode(() => lockAuthority.loadFinalProductionLock(estate.runDir), 'FINAL_LOCK_TAMPERED');
});

test('FPL07 a locked script may not be mutated in place; a stale lock is never reinterpreted', async () => {
  const estate = await lockedEstate('stale-lock');
  lockAuthority.verifyLockCurrent(estate.runDir, estate.lock, { scriptBuilderRoot: estate.story.root });
  // (15) approving a Story successor does not silently move the locked script
  revisionHarness.reviewedEstate; // (harness reference kept for clarity)
  const story = estate.story;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
  const next = story.sections.map((section) => (section.id === 'S02' ? { ...section, dialogue: 'A rewritten line that the lock never approved.' } : { ...section }));
  const version = story.versions.createVersion(story.dataRoot, story.project, next, story.config.loadConfig(story.dataRoot), {});
  story.versions.approveVersion(story.dataRoot, story.project, version.id, { note: 'Human authority: Mikko. Post-lock change.' });
  story.store.saveProject(story.dataRoot, story.project);
  // the lock still binds the ORIGINAL version; the package refuses to drift
  errorCode(() => packageAuthority.createFinalProductionPackage(estate.runDir, { scriptBuilderRoot: story.root }), 'FINAL_PACKAGE_SCRIPT_DRIFT');
  // (13) a stale lock: the approved Draft bytes move
  fs.appendFileSync(path.join(estate.runDir, 'media/directed-draft-assembly/directed-draft-r1.mp4'), ' moved');
  errorCode(() => lockAuthority.verifyLockCurrent(estate.runDir, estate.lock, { scriptBuilderRoot: story.root }), 'FINAL_LOCK_STALE');
  const status = lockAuthority.lockStatus(estate.runDir);
  assert.equal(status.state, 'FINAL_PRODUCTION_LOCK_STALE');
  assert.equal(status.final_production_locked, false);
});

test('FPL08 breaking a lock demands a named human authority and an explicit reason', async () => {
  const estate = await lockedEstate('break');
  errorCode(() => lockAuthority.breakFinalProductionLock(estate.runDir, { reason: 'because' }), 'FINAL_LOCK_BREAK_AUTHORITY_REQUIRED');
  errorCode(() => lockAuthority.breakFinalProductionLock(estate.runDir, { authority: 'Mikko Pakkala', reason: 'no' }), 'FINAL_LOCK_BREAK_REASON_REQUIRED');
  const broken = lockAuthority.breakFinalProductionLock(estate.runDir, { authority: 'Mikko Pakkala', reason: 'The claim in section two needs rewording before I record it.' });
  assert.equal(broken.state, 'LOCK_BROKEN');
  assert.equal(broken.record.broken_lock_id, estate.lock.lock_id);
  assert.equal(broken.record.authority.type, 'HUMAN');
  assert.match(broken.record.effect, /successor lock requires a new human approval/);
});

/* ── §10-§17 package ─────────────────────────────────────────────────────── */

test('FPL09 the package derives every component from the lock and grants no publication authority', async () => {
  const estate = await packagedEstate('package');
  const pkg = estate.built.package;
  assert.equal(pkg.schema, 'vidtoolz.finalProductionPackage.v1');
  assert.equal(pkg.lock_digest_sha256, estate.lock.lock_digest_sha256);
  assert.deepEqual(Object.keys(pkg.components).sort(), ['final_asset_tracker', 'final_music_brief', 'final_performance_package', 'final_resolve_blueprint', 'final_script', 'final_visual_package']);
  assert.deepEqual(pkg.production_state, {
    DRAFT_APPROVED: true, FINAL_PRODUCTION_LOCKED: true, FINAL_PRODUCTION_PACKAGE_READY: true,
    FINAL_ASSETS_COMPLETE: false, FINAL_HUMAN_PERFORMANCE_COMPLETE: false,
    FINAL_EDIT_COMPLETE: false, FINAL_QC_PASS: false, PUBLICATION_APPROVED: false,
  });
  for (const field of ['publication_ready', 'publication_authority', 'publish_approved', 'youtube_approved', 'final_master_exists', 'final_qc_pass', 'grants_final_asset_authority', 'grants_final_music_authority', 'grants_final_performance_authority']) {
    assert.equal(pkg.authority[field], false, field);
  }
  assert.equal(pkg.manual_human_authority.length, 9);
  // package requires a lock
  const unlocked = await approvedEstate('package-no-lock');
  errorCode(() => packageAuthority.createFinalProductionPackage(unlocked.runDir, { scriptBuilderRoot: unlocked.story.root }), 'FINAL_LOCK_MISSING');
});

test('FPL10 the visual package rebuilds prompts from the locked script, never from Draft asset paths', async () => {
  const estate = await packagedEstate('visual');
  const visual = readJson(estate.paths.visual);
  assert.equal(visual.beats.length, 20);
  assert.equal(visual.geometry.aspect_ratio, '9:16');
  assert.match(visual.rebuild_doctrine, /concept prototypes/);
  assert.match(visual.generation_method, /MANUAL/);
  for (const beat of visual.beats) {
    assert.ok(beat.final_image_prompt.length > 400, 'final prompts are materially richer than Draft prompts');
    assert.match(beat.final_image_prompt, /Vertical 9:16/);
    assert.match(beat.final_image_prompt, /safe|quiet/i);
    assert.match(beat.final_image_prompt, /Avoid:/);
    assert.ok(beat.locked_script_line.length > 0, 'each beat carries its exact locked line');
    assert.equal(beat.manual_selection_required, true);
    assert.equal(beat.final_asset_authority, false);
    assert.equal(beat.draft_reference.purpose.startsWith('CONCEPTUAL_CONTINUITY_ONLY'), true);
    // no ephemeral Draft image path may appear in a final prompt
    assert.equal(/media\/draft-bespoke-stills|\.png|\.jpg/.test(beat.final_image_prompt), false);
  }
  // this fixture's plan carries no text-bearing role, so every prompt must
  // explicitly forbid text (the estate's standing rule for generated imagery)
  for (const beat of visual.beats) {
    assert.equal(beat.infographic_contract, null);
    assert.match(beat.final_image_prompt, /NO text, letters, numerals/);
    assert.deepEqual(beat.allowed_text, []);
  }
});

test('FPL10b an infographic beat carries an exact allowed-text contract derived from the locked line', () => {
  // Exercised directly: the real r2 plan contains INFOGRAPHIC/DIAGRAM roles,
  // while this fixture's synthesized plan does not.
  const beat = {
    purpose: 'The Moat Reveal', visual_role: 'INFOGRAPHIC', subject: 'The moat, drawn as three concentric layers',
    approved_concept: 'A designed card that names the moat in three stacked layers.',
    duration_ms: 11000,
    allowed_text: ['Your taste is the moat.', 'Not the tooling.'],
    text_hierarchy: 'the first line is the dominant statement; any following line is supporting at clearly lower weight',
  };
  const prompt = packageAuthority.buildFinalImagePrompt(beat);
  assert.match(prompt, /render EXACTLY and ONLY this text/);
  assert.match(prompt, /Your taste is the moat\./);
  assert.match(prompt, /no other words, no captions, no watermarks/);
  assert.equal(/NO text, letters, numerals/.test(prompt), false, 'a text-bearing beat must not also forbid text');
  const contract = packageAuthority.infographicContract(beat);
  assert.deepEqual(contract.exact_allowed_text, beat.allowed_text);
  assert.match(contract.text_source, /verbatim from the locked script/);
  assert.match(contract.visual_grammar, /V2 full-frame designed card grammar/);
  assert.ok(contract.safe_regions.text_safe_band);
  assert.equal(contract.typography_constraints.includes('one geometric sans family'), true);
  // and a designed card is never a motion source
  assert.equal(packageAuthority.classifyAssetKind(beat).kind, 'FINAL_STILL_CANDIDATE');
  // a photographic beat of the same length IS a motion candidate
  assert.equal(packageAuthority.classifyAssetKind({ ...beat, visual_role: 'SCENE' }).kind, 'FINAL_VIDEO_SOURCE_CANDIDATE');
  // abstract or short beats stay stills
  assert.equal(packageAuthority.classifyAssetKind({ ...beat, visual_role: 'CONCEPTUAL' }).kind, 'FINAL_STILL_CANDIDATE');
  assert.equal(packageAuthority.classifyAssetKind({ ...beat, visual_role: 'SCENE', duration_ms: 4000 }).kind, 'FINAL_STILL_CANDIDATE');
});

test('FPL11 still vs video-source is a stated recommendation the human may override', async () => {
  const estate = await packagedEstate('classify');
  const visual = readJson(estate.paths.visual);
  for (const beat of visual.beats) {
    assert.ok(packageAuthority.ASSET_KINDS.includes(beat.recommended_asset_kind));
    assert.ok(beat.recommendation_basis.length > 10);
    assert.equal(beat.recommendation_is_human_overridable, true);
    if (beat.infographic_contract) assert.equal(beat.recommended_asset_kind, 'FINAL_STILL_CANDIDATE', 'designed cards are never motion sources');
  }
  assert.equal(visual.still_candidates + visual.video_source_candidates, visual.beats.length);
});

test('FPL12 no authoritative I2V prompt can exist before an actually selected image', async () => {
  const estate = await packagedEstate('i2v');
  const visual = readJson(estate.paths.visual);
  const videoBeat = visual.beats.find((beat) => beat.recommended_asset_kind === 'FINAL_VIDEO_SOURCE_CANDIDATE');
  assert.ok(videoBeat, 'the fixture yields at least one video-source candidate');
  // the package ships motion INTENT only; the authoritative prompt is null
  assert.equal(videoBeat.motion_intent.authoritative_prompt, null);
  assert.match(videoBeat.motion_intent.authoritative_prompt_requires, /sha256 of the actually selected final image/);
  // binding before selection is refused
  errorCode(() => packageAuthority.bindMotionPrompt(estate.runDir, videoBeat.final_beat_id, { scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_I2V_REQUIRES_SELECTED_IMAGE');
  // a still beat can never bind a motion prompt
  const stillBeat = visual.beats.find((beat) => beat.recommended_asset_kind === 'FINAL_STILL_CANDIDATE');
  errorCode(() => packageAuthority.bindMotionPrompt(estate.runDir, stillBeat.final_beat_id, { scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_NOT_A_VIDEO_SOURCE');
  // generate -> select -> bind, and the prompt binds the exact selected hash
  const dir = path.join(estate.runDir, 'media', 'final-assets');
  fs.mkdirSync(dir, { recursive: true });
  const imageA = path.join(dir, `${videoBeat.final_beat_id}-a.png`); fs.writeFileSync(imageA, 'final candidate A bytes');
  const imageB = path.join(dir, `${videoBeat.final_beat_id}-b.png`); fs.writeFileSync(imageB, 'final candidate B bytes');
  packageAuthority.recordGeneratedImages(estate.runDir, videoBeat.final_beat_id, [
    { path: imageA, sha256: shaFile(imageA) }, { path: imageB, sha256: shaFile(imageB) },
  ], { scriptBuilderRoot: estate.story.root });
  // GENERATED is not SELECTED
  let tracker = packageAuthority.loadTracker(estate.runDir).tracker;
  let beatState = tracker.beats.find((item) => item.final_beat_id === videoBeat.final_beat_id);
  assert.equal(beatState.state, 'GENERATED');
  assert.equal(beatState.selected_image, null);
  errorCode(() => packageAuthority.bindMotionPrompt(estate.runDir, videoBeat.final_beat_id, { scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_I2V_REQUIRES_SELECTED_IMAGE');
  packageAuthority.selectFinalImage(estate.runDir, videoBeat.final_beat_id, { path: imageB, sha256: shaFile(imageB) }, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root });
  const bound = packageAuthority.bindMotionPrompt(estate.runDir, videoBeat.final_beat_id, { scriptBuilderRoot: estate.story.root });
  assert.equal(bound.state, 'I2V_READY');
  assert.equal(bound.record.selected_image.sha256, shaFile(imageB));
  assert.equal(bound.record.binds_selected_image, true);
  assert.ok(bound.record.authoritative_prompt.length > 60);
  assert.match(bound.record.generation_method, /MANUAL/);
  assert.equal(bound.record.final_asset_authority, false);
});

test('FPL13 asset tracker: GENERATED never implies SELECTED and selection is hash-verified human authority', async () => {
  const estate = await packagedEstate('tracker');
  const visual = readJson(estate.paths.visual);
  const beat = visual.beats.find((item) => item.recommended_asset_kind === 'FINAL_STILL_CANDIDATE');
  const dir = path.join(estate.runDir, 'media', 'final-assets');
  fs.mkdirSync(dir, { recursive: true });
  const image = path.join(dir, `${beat.final_beat_id}.png`); fs.writeFileSync(image, 'still bytes');
  // (12) selecting an unregistered asset is refused
  errorCode(() => packageAuthority.selectFinalImage(estate.runDir, beat.final_beat_id, { path: image, sha256: shaFile(image) }, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_SELECTION_UNREGISTERED');
  packageAuthority.recordGeneratedImages(estate.runDir, beat.final_beat_id, [{ path: image, sha256: shaFile(image) }], { scriptBuilderRoot: estate.story.root });
  // (13) a lying hash is refused
  errorCode(() => packageAuthority.selectFinalImage(estate.runDir, beat.final_beat_id, { path: image, sha256: 'f'.repeat(64) }, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_ASSET_SHA_MISMATCH');
  // (11) a caller-supplied path outside the run is refused
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-final-')), 'rogue.png');
  fs.writeFileSync(outside, 'rogue');
  errorCode(() => packageAuthority.recordGeneratedImages(estate.runDir, beat.final_beat_id, [{ path: outside, sha256: shaFile(outside) }], { scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_ASSET_OUTSIDE_RUN');
  // selection requires a named human authority
  errorCode(() => packageAuthority.selectFinalImage(estate.runDir, beat.final_beat_id, { path: image, sha256: shaFile(image) }, { scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_SELECTION_AUTHORITY_REQUIRED');
  const selected = packageAuthority.selectFinalImage(estate.runDir, beat.final_beat_id, { path: image, sha256: shaFile(image) }, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root });
  assert.equal(selected.state, 'FINAL_ASSET_SELECTED');
  assert.equal(selected.beat.final_asset.kind, 'FINAL_STILL');
  assert.equal(selected.beat.selection_authority.id, 'Mikko Pakkala');
  // unknown beat ids are refused
  errorCode(() => packageAuthority.selectFinalImage(estate.runDir, 'final-visual-999', { path: image, sha256: shaFile(image) }, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_BEAT_UNKNOWN');
  const tracker = packageAuthority.loadTracker(estate.runDir).tracker;
  assert.equal(tracker.final_assets_complete, false);
  assert.equal(tracker.publication_authority, false);
  assert.match(tracker.state_rules.GENERATED_does_not_imply_SELECTED, /never automatically/);
});

test('FPL14 a Kling clip cannot be recorded or selected without a bound motion prompt', async () => {
  const estate = await packagedEstate('video-order');
  const visual = readJson(estate.paths.visual);
  const beat = visual.beats.find((item) => item.recommended_asset_kind === 'FINAL_VIDEO_SOURCE_CANDIDATE');
  const dir = path.join(estate.runDir, 'media', 'final-assets'); fs.mkdirSync(dir, { recursive: true });
  const clip = path.join(dir, 'clip.mp4'); fs.writeFileSync(clip, 'clip bytes');
  errorCode(() => packageAuthority.recordGeneratedVideos(estate.runDir, beat.final_beat_id, [{ path: clip, sha256: shaFile(clip) }], { scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_VIDEO_REQUIRES_MOTION_PROMPT');
  errorCode(() => packageAuthority.selectFinalVideo(estate.runDir, beat.final_beat_id, { path: clip, sha256: shaFile(clip) }, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_SELECTION_UNREGISTERED');
});

/* ── §4/§34/§35 narration doctrine ───────────────────────────────────────── */

test('FPL15 the performance package requires a FRESH Mikko performance; Draft narration cannot satisfy it', async () => {
  const estate = await packagedEstate('performance');
  const performance = readJson(estate.paths.performance);
  assert.equal(performance.schema, 'vidtoolz.finalPerformancePackage.v1');
  assert.equal(performance.performer, 'Mikko Pakkala');
  assert.match(performance.requirement, /FRESH human performance/);
  assert.equal(performance.draft_narration_cannot_satisfy_this.final_human_performance_authority, false);
  assert.match(performance.draft_narration_cannot_satisfy_this.reason, /EXCEPTION/);
  assert.match(performance.draft_narration_cannot_satisfy_this.reason, /normal Draft narration is synthetic/);
  assert.equal(performance.state, 'REQUIRED');
  assert.equal(performance.final_human_performance_complete, false);
  assert.deepEqual(performance.takes, []);
  assert.equal(performance.selected_take, null);
  assert.equal(performance.selected_take_authority.state, 'PENDING');
  assert.ok(performance.recording_checklist.length >= 5);
  assert.equal(performance.sections.length, 5);
  for (const section of performance.sections) {
    assert.ok(section.locked_lines.length >= 1);
    assert.ok(section.word_count > 0);
    assert.ok(section.target_duration_ms > 0);
  }
  // the lock itself records the same doctrine
  assert.equal(estate.lock.draft_narration.final_human_performance_authority, false);
  assert.match(estate.lock.draft_narration.doctrine, /Normal Draft narration is synthetic/);
  assert.equal(estate.lock.final_production_requirements.final_human_performance, 'REQUIRED — a fresh Mikko performance of the locked script');
});

test('FPL16 normal Draft narration policy remains SYNTHETIC and DRAFT-only (r2 is an exception, not a precedent)', () => {
  // The canonical Draft narration authority is a SYNTHETIC proxy — unchanged by
  // the fact that this production's r2 happens to carry a human recording.
  assert.equal(narration.EVIDENCE_KIND, 'DRAFT_SYNTHETIC_NARRATION');
  assert.equal(narration.FIDELITY, 'DRAFT_SYNTHETIC_PROXY');
  assert.equal(/human|presenter|performance/i.test(narration.FIDELITY), false, 'Draft narration fidelity never claims a human performance');
  // and it is DRAFT-only: a non-DRAFT run cannot synthesize narration at all
  const nonDraft = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-mode-'));
  productionMode.setProductionMode(nonDraft, productionMode.PRODUCTION, { setBy: 'fixture', setAt: '2026-09-01T00:00:00Z' });
  errorCode(() => narration.resolveNarrationContext(nonDraft), 'NARRATION_MODE_NOT_DRAFT');
  // a future Draft does NOT wait for Mikko: synthetic narration is its own
  // canonical producer, so Draft generation stays unblocked by performance
  assert.equal(narration.SEMANTIC_PRODUCER, 'generation_supervisor');
});

/* ── §21/§22 music ───────────────────────────────────────────────────────── */

test('FPL17 Draft music is not promoted; final music stays REQUIRED with no final authority', async () => {
  const estate = await packagedEstate('music');
  const music = readJson(estate.paths.music);
  assert.equal(music.schema, 'vidtoolz.finalMusicBrief.v1');
  assert.equal(music.state, 'REQUIRED');
  assert.equal(music.final_music_authority, false);
  assert.match(music.draft_music_is_not_promoted.rule, /NEVER automatically promoted/);
  assert.equal(music.draft_music_is_not_promoted.draft_reference_use, 'INSPIRATION_ONLY');
  assert.equal(music.music_function_map.length, 5);
  assert.equal(music.music_function_map[0].music_function, 'OPENING_TENSION');
  assert.equal(music.music_function_map.at(-1).music_function, 'RESOLUTION');
  assert.ok(music.style_guidance.narration_compatibility.length >= 3);
  assert.match(music.style_guidance.coherence_requirement, /SOLID_SONG/);
  assert.match(music.style_guidance.ending_requirement, /deliberate/);
  assert.equal(music.selection_authority.state, 'PENDING');
  assert.equal(music.publication_authority, false);
});

/* ── §23/§24 Resolve blueprint ───────────────────────────────────────────── */

test('FPL18 the Resolve blueprint plans a performance-spine edit with placeholders, not automation', async () => {
  const estate = await packagedEstate('blueprint');
  const blueprint = readJson(estate.paths.blueprint);
  assert.equal(blueprint.schema, 'vidtoolz.finalResolveBlueprint.v1');
  assert.match(blueprint.edit_mode, /MANUAL/);
  assert.match(blueprint.format.structure, /recorded performance is the spine/);
  assert.ok(blueprint.format.not_assumed.includes('full-screen B-roll only'));
  assert.ok(blueprint.format.not_assumed.some((item) => /r2 voiceover/.test(item)));
  assert.equal(blueprint.timeline.length, 20);
  for (const item of blueprint.timeline) {
    assert.equal(item.visual_placeholder.state, 'AWAITING_FINAL_ASSET_SELECTION');
    assert.equal(item.visual_placeholder.sha256, null);
    assert.ok(item.safe_areas.bottom_reserved);
  }
  assert.equal(blueprint.audio.performance_track.state, 'AWAITING_SELECTED_TAKE');
  assert.equal(blueprint.audio.music_track.state, 'AWAITING_FINAL_MUSIC');
  assert.equal(blueprint.final_edit_complete, false);
  assert.equal(blueprint.publication_authority, false);
  assert.match(blueprint.reference_only.note, /none of its media is a final asset/);
});

/* ── §28/§29 next-action projection ──────────────────────────────────────── */

test('FPL19 the next-action projection is concrete and dependency-ordered', async () => {
  const estate = await packagedEstate('next');
  const first = packageAuthority.nextActions(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.equal(first.package_state, 'FINAL_PRODUCTION_PACKAGE_READY');
  assert.match(first.next_action, /^Generate final image for beat final-visual-001/);
  assert.equal(first.counts.ready, 20 + 1 + 1, '20 image tasks plus performance plus music');
  assert.equal(first.final_assets_complete, false);
  assert.ok(first.blocked.some((item) => item.task === 'ASSEMBLE_FINAL_EDIT_IN_RESOLVE'));
  // completing one beat's image moves it to a selection task waiting on Mikko
  const visual = readJson(estate.paths.visual);
  const beat = visual.beats[0];
  const dir = path.join(estate.runDir, 'media', 'final-assets'); fs.mkdirSync(dir, { recursive: true });
  const image = path.join(dir, 'first.png'); fs.writeFileSync(image, 'first image');
  packageAuthority.recordGeneratedImages(estate.runDir, beat.final_beat_id, [{ path: image, sha256: shaFile(image) }], { scriptBuilderRoot: estate.story.root });
  const second = packageAuthority.nextActions(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.ok(second.waiting_on_mikko.some((item) => item.task === 'SELECT_FINAL_IMAGE' && item.beat === beat.final_beat_id));
  assert.equal(second.publication_approved, false);
  // before any lock the projection says so instead of inventing tasks
  const approved = await approvedEstate('next-nolock');
  const early = packageAuthority.nextActions(approved.runDir);
  assert.equal(early.package_state, 'DRAFT_APPROVED');
  assert.match(early.next_action, /Create the Final Production Lock/);
});

/* ── §33 package hostile matrix ──────────────────────────────────────────── */

test('FPL20 package hostile matrix: unapproved Draft, fabricated lock and drift all fail closed', async () => {
  // (1)/(2) package from an unapproved Draft / without a lock
  const unapproved = await revisionHarness.reviewedEstate('fpl-unapproved', [
    { timecode_seconds: 1, disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Change this.' },
  ], { verdict: 'CHANGE', ratings: false, reviewId: 'changes' });
  seedResearchEvidence(unapproved.runDir);
  errorCode(() => packageAuthority.createFinalProductionPackage(unapproved.runDir, { scriptBuilderRoot: unapproved.story.root }), 'FINAL_LOCK_MISSING');
  // (4) a fabricated lock file cannot pass the digest
  const fabricated = await approvedEstate('fpl-fabricated');
  writeJson(lockAuthority.lockPath(fabricated.runDir), {
    schema: 'vidtoolz.finalProductionLock.v1', lock_id: 'fabricated', lock_digest_sha256: 'f'.repeat(64),
    authority: { final_production_locked: true, publication_authority: false },
  });
  errorCode(() => packageAuthority.createFinalProductionPackage(fabricated.runDir, { scriptBuilderRoot: fabricated.story.root }), 'FINAL_LOCK_TAMPERED');
  // (6) altered visual plan after locking
  const drift = await lockedEstate('fpl-plan-drift');
  fs.appendFileSync(drift.planPath, '\n');
  errorCode(() => packageAuthority.createFinalProductionPackage(drift.runDir, { scriptBuilderRoot: drift.story.root }), 'FINAL_PACKAGE_VISUAL_PLAN_DRIFT');
});

test('FPL21 the package neither mutates the lock nor the approved Draft, and cannot be re-derived onto another lock', async () => {
  const estate = await packagedEstate('immutable');
  const lockShaBefore = shaFile(estate.lock_path);
  const draftPath = path.join(estate.runDir, 'media/directed-draft-assembly/directed-draft-r1.mp4');
  const draftShaBefore = shaFile(draftPath);
  const reviewShaBefore = shaFile(review.reviewFile(estate.runDir, 'mikko-approved'));
  // re-deriving is idempotent, not a mutation
  const again = packageAuthority.createFinalProductionPackage(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.equal(again.state, 'ALREADY_PACKAGED');
  assert.equal(shaFile(estate.lock_path), lockShaBefore, 'the lock is never rewritten');
  assert.equal(shaFile(draftPath), draftShaBefore, 'the approved Draft bytes are never touched');
  assert.equal(shaFile(review.reviewFile(estate.runDir, 'mikko-approved')), reviewShaBefore, 'the approval is never rewritten');
  // (16) a package belonging to another lock is refused
  const stored = readJson(estate.built.package_path);
  const foreign = { ...stored, lock_digest_sha256: 'a'.repeat(64) };
  writeJson(estate.built.package_path, foreign);
  errorCode(() => packageAuthority.createFinalProductionPackage(estate.runDir, { scriptBuilderRoot: estate.story.root }), 'FINAL_PACKAGE_LOCK_MISMATCH');
});

test('FPL22 the package assumes no Kling asset, no final music and no final master exists', async () => {
  const estate = await packagedEstate('assumptions');
  const tracker = packageAuthority.loadTracker(estate.runDir).tracker;
  // (19) no video asset is assumed
  assert.ok(tracker.beats.every((beat) => beat.generated_videos.length === 0 && beat.selected_video === null && beat.final_asset === null));
  assert.ok(tracker.beats.every((beat) => beat.motion_prompt === null));
  // (20) no final music is assumed
  assert.equal(readJson(estate.paths.music).state, 'REQUIRED');
  // (14)/(15) no publication or QC authority anywhere
  const pkg = readJson(estate.built.package_path);
  assert.equal(pkg.authority.final_qc_pass, false);
  assert.equal(pkg.authority.final_master_exists, false);
  assert.equal(fs.existsSync(path.join(estate.runDir, 'final-master.mp4')), false);
  const status = lockAuthority.lockStatus(estate.runDir);
  assert.equal(status.publication_ready, false);
  assert.equal(status.publication_approved, false);
  assert.equal(status.final_qc_pass, false);
});

/* ── §36 revision-successor non-regression ───────────────────────────────── */

test('FPL23 the promoted selective revision pipeline is unchanged and an approval bypasses it', async () => {
  const planner = require('../scripts/draft-revision-plan.js');
  const executor = require('../scripts/draft-revision-successor.js');
  // an APPROVED draft yields no revision work at all
  const approved = await approvedEstate('revision-bypass');
  const plan = planner.buildRevisionPlan(approved.runDir, { scriptBuilderRoot: approved.story.root });
  assert.equal(plan.plan.decision, 'NO_REVISION_REQUIRED');
  assert.equal(plan.plan.work_items.length, 0);
  const executed = await executor.executeRevisionPlan(approved.runDir, { scriptBuilderRoot: approved.story.root, adapters: revisionHarness.adapters(approved), handoffOptions: approved.handoffOptions, renderFromSpec: async (p) => revisionHarness.fakeRenderFromSpec(p) });
  assert.equal(executed.state, 'NO_REVISION_REQUIRED');
  assert.equal(fs.existsSync(path.join(approved.runDir, 'media/directed-draft-assembly/directed-draft-r2.mp4')), false, 'no r3-style successor is produced for an approved Draft');
  // selective regeneration still works for a CHANGE review on a different run
  const changed = await revisionHarness.reviewedEstate('fpl-selective', [], { submit: false, ratings: false, reviewId: 'unused' });
  const targetSlot = changed.slots[6].slot_id;
  const beat = changed.composition.beats.find((item) => item.beat_id === targetSlot);
  review.openReview(changed.runDir, { reviewId: 'change-round', reviewerAuthority: 'HUMAN:Mikko Pakkala' });
  review.addNote(changed.runDir, 'change-round', { timecode_seconds: (beat.start_ms + 100) / 1000, disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate this still.' });
  review.submitReview(changed.runDir, 'change-round', {});
  planner.buildRevisionPlan(changed.runDir, { scriptBuilderRoot: changed.story.root });
  const spy = {};
  const revised = await executor.executeRevisionPlan(changed.runDir, { scriptBuilderRoot: changed.story.root, adapters: revisionHarness.adapters(changed, spy), handoffOptions: changed.handoffOptions, renderFromSpec: async (p) => revisionHarness.fakeRenderFromSpec(p) });
  assert.equal(revised.state, 'REVISION_COMPLETE');
  assert.deepEqual(revised.successor.census, { visual_preserved: 19, visual_regenerated: 1, visual_removed: 0, music: 'REUSED', narration: 'REUSED', script: 'REUSED' });
  assert.deepEqual(spy.stills, [targetSlot]);
});

test('FPL24 the lifecycle vocabulary is single-sourced and the lock projection reuses it', async () => {
  assert.deepEqual(lockAuthority.LIFECYCLE, [
    'DRAFT_REVIEW_READY', 'DRAFT_APPROVED', 'FINAL_PRODUCTION_LOCKED', 'FINAL_PRODUCTION_PACKAGE_READY',
    'FINAL_ASSETS_COMPLETE', 'FINAL_HUMAN_PERFORMANCE_COMPLETE', 'FINAL_EDIT_COMPLETE', 'FINAL_QC_PASS', 'PUBLICATION_APPROVED',
  ]);
  const estate = await packagedEstate('lifecycle');
  const status = lockAuthority.lockStatus(estate.runDir);
  assert.equal(status.state, 'FINAL_PRODUCTION_LOCKED');
  assert.equal(status.final_production_locked, true);
  assert.deepEqual(status.lifecycle, lockAuthority.LIFECYCLE);
  assert.equal(status.research_approval.approved, true);
  // the package restates the same vocabulary, it does not invent a second one
  const pkg = readJson(estate.built.package_path);
  assert.deepEqual(Object.keys(pkg.production_state), lockAuthority.LIFECYCLE.filter((state) => state !== 'DRAFT_REVIEW_READY'));
});

module.exports = { tests: require('./_helpers.js').tests, approvedEstate, lockedEstate, packagedEstate, seedResearchEvidence };
