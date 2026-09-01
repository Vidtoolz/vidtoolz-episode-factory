'use strict';

/*
 * Draft review → revision plan → V2/V3 successor certification.
 *
 * Fixture-first by design: the real r2 Draft has no human review, and none is
 * fabricated here. Every scenario builds an isolated estate whose Story,
 * Visual Plan and bespoke-still policy are produced by the REAL canonical
 * authorities, renders r1 through the REAL Directed Draft handoff with an
 * injected deterministic renderer, records a real vidtoolz.draftReview.v2,
 * and then drives the revision planner and executor.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');

const storyFixture = require('./story-authority-live-fixture.js');
const storyBinding = require('../scripts/package-run-story-binding.js');
const productionMode = require('../scripts/package-run-production-mode.js');
const planning = require('../scripts/agent-task-visual-planning.js');
const director = require('../scripts/visual-planning-director.js');
const vp = require('../scripts/visual-plan.js');
const bespoke = require('../scripts/draft-bespoke-still-policy.js');
const compositionEngine = require('../scripts/production-assembly-composition.js');
const releaseAuthority = require('../scripts/production-assembly-release-authority.js');
const renderer = require('../scripts/production-assembly-renderer.js');
const execution = require('../scripts/production-assembly-execution-successor.js');
const directed = require('../scripts/directed-draft-assembly-handoff.js');
const review = require('../scripts/draft-review-intake.js');
const subjects = require('../scripts/draft-review-subject.js');
const planner = require('../scripts/draft-revision-plan.js');
const executor = require('../scripts/draft-revision-successor.js');

const SECTIONS = 5;
const SLOTS_PER_SECTION = 4;
const TOTAL_SLOTS = SECTIONS * SLOTS_PER_SECTION;
const SECTION_MS = 42000;
const TOTAL_MS = SECTIONS * SECTION_MS;

function H(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function shaFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); return file; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function errorCode(fn, code) { assert.throws(fn, (error) => error.code === code, `${code} (got ${(() => { try { fn(); return 'no throw'; } catch (error) { return error.code; } })()})`); }
async function rejectCode(fn, code) { await assert.rejects(fn, (error) => error.code === code, code); }

/* ── canonical Story fixture (real Script Builder authority) ─────────────── */

function dialogueFor(index, token = 'reviewed') { return `The ${token} exact script line ${index + 1} that this Draft was built from.`; }

function storyEstate(options = {}) {
  const authority = storyFixture.canonicalStoryFixture();
  const project = authority.store.newProject({ id: options.projectId || 'draft-revision-project', title: 'Draft revision fixture', length_class: 'short' });
  project.output_class = { aspect_ratio: '9:16', orientation: 'vertical', length_class: 'short', max_duration_minutes: 3.5 };
  authority.store.saveProject(authority.dataRoot, project);
  const sections = Array.from({ length: SECTIONS }, (_, index) => ({
    id: `S${String(index + 1).padStart(2, '0')}`, order: index + 1, beat: `Beat ${index + 1}`,
    type: 'composited', dialogue: dialogueFor(index), visual_notes: '', media_refs: [],
  }));
  const v1 = authority.versions.createVersion(authority.dataRoot, project, sections, authority.config.loadConfig(authority.dataRoot), {});
  authority.versions.approveVersion(authority.dataRoot, project, v1.id, { note: 'Human authority: Mikko. Fixture reviewed Draft approval.' });
  authority.store.saveProject(authority.dataRoot, project);
  return { ...authority, project, v1, sections };
}

/* Author + human-approve a Story successor: what a real script REWRITE/CUT
 * requires before any revision may execute. Never called implicitly. */
function approveStorySuccessor(story, mutate) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
  const next = mutate(story.sections.map((section) => ({ ...section })));
  const version = story.versions.createVersion(story.dataRoot, story.project, next, story.config.loadConfig(story.dataRoot), {});
  story.versions.approveVersion(story.dataRoot, story.project, version.id, { note: 'Human authority: Mikko. Fixture Story successor approval.' });
  story.store.saveProject(story.dataRoot, story.project);
  return version;
}
function unapprovedStorySuccessor(story, mutate) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
  const next = mutate(story.sections.map((section) => ({ ...section })));
  return story.versions.createVersion(story.dataRoot, story.project, next, story.config.loadConfig(story.dataRoot), {});
}

/* ── real bespoke Visual Plan over that Story ────────────────────────────── */

function semanticFor(task) {
  return {
    beats: task.required_beats.map((beat, beatIndex) => ({
      canonical_beat_id: beat.canonical_beat_id, coverage_decision: 'PLAN_SHOTS', no_visual_reason: null,
      shots: Array.from({ length: SLOTS_PER_SECTION }, (_, local) => ({
        visual_purpose: `Exact visual purpose ${beatIndex + 1}.${local + 1}`,
        narrative_function: `Clarify script line ${beatIndex + 1} facet ${local + 1}`,
        media_type: 'GENERATED_STILL', generation_mode: 'STILL',
        subject: `Distinct subject ${beatIndex + 1}.${local + 1}`,
        shot_brief: `Distinct vertical concept ${beatIndex + 1}.${local + 1} grounded in the exact reviewed script.`,
        why_it_serves_story: `Makes script concept ${beatIndex + 1}.${local + 1} reviewable.`,
        // Deliberately uneven holds: the real bespoke allocator weights a
        // section's beats by these targets, which is what a pacing note reacts to.
        presenter_relation: 'NONE', duration_target_s: [8, 14, 9, 11][local], research_sensitive: false,
        research_binding_ids: [], required_constraint_ids: [], visual_assertion: null,
        camera_required: false, camera_intent: null, continuity_notes: [], alternatives: [],
        priority: 'NORMAL', demonstration: null, input_artifact_refs: [], quality_constraints: ['static'],
        candidate_count_request: 1, visual_role: ['SCENE', 'CONCEPTUAL', 'METAPHOR', 'SCENE'][local], repetition_rationale: null,
      })),
    })),
    coverage_findings: [], continuity_findings: [], redundancy_findings: [], human_attention: [],
    recommendation: 'PLAN_READY', slot_count_rationale: null,
  };
}

/* ── deterministic injected renderer (no ffmpeg, real contract shape) ────── */

function fakeRenderFromSpec(specPath) {
  const spec = readJson(specPath);
  const runDir = spec.output_root;
  const outputPath = path.join(runDir, spec.output.relative_path);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // Bytes derive from the spec: a different composition renders different bytes.
  fs.writeFileSync(outputPath, `fixture directed draft render ${H(JSON.stringify(spec))}`);
  const outputSha = shaFile(outputPath);
  const semantic = { schema: 'fixture.renderPlan.v1', spec_sha256: shaFile(specPath) };
  const plan = { ...semantic, plan_digest_sha256: execution.digest(semantic), ffmpeg_invocation: { args: ['fixture'] } };
  const durationMs = spec.composition.beats.at(-1).end_ms;
  const manifest = {
    schema: 'vidtoolz.productionAssemblyManifest.v1', state: 'QC_PASSED_PENDING_FINALIZATION',
    run_id: spec.run_id, output_sha256: outputSha, plan_digest_sha256: plan.plan_digest_sha256,
    story: spec.story, narration_source_class: spec.narration.source_class,
    output_size_bytes: fs.statSync(outputPath).size,
    qc: { full_decode: 'PASS', duration_ms: durationMs, video: { width: 1080, height: 1920, avg_frame_rate: '30/1' }, audio: { codec: 'aac' } },
  };
  const manifestPath = writeJson(`${outputPath}.manifest.json`, manifest);
  const completionPath = writeJson(`${outputPath}.completion.json`, { state: 'COMPLETE', output_sha256: outputSha });
  return {
    plan, manifest,
    completion: { output_sha256: outputSha, execution_attempt: null },
    paths: { output: outputPath, manifest: manifestPath, completion: completionPath },
  };
}

/* ── the full reviewable r1 Draft estate ─────────────────────────────────── */

function draftEstate(label, options = {}) {
  const story = options.story || storyEstate();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `draft-revision-${label}-`));
  const runs = path.join(repo, 'package-runs');
  const runId = `revision-fixture-${label}`;
  const runDir = path.join(runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  storyBinding.writeBinding(runDir, storyBinding.buildBinding({
    runId, projectId: story.project.id, versionId: story.v1.id, contentHash: story.v1.content_hash,
    scriptBuilderRoot: story.root, boundAt: '2026-09-01T00:00:00Z', boundBy: 'fixture-human',
  }));
  productionMode.setProductionMode(runDir, productionMode.DRAFT, { setBy: 'fixture (agent)', setAt: '2026-09-01T00:00:00Z', rationale: 'Draft revision fixture estate.' });

  const task = planning.assembleVisualPlanningTask({ runDir, runId, taskId: `revision-plan-${label}`, requestedBy: 'fixture', scriptBuilderRoot: story.root }).task;
  assert.equal(task.production_grammar, director.DRAFT_BESPOKE_STILL_GRAMMAR);
  const semantic = semanticFor(task);
  assert.equal(director.validateSemanticOutput(semantic, task).ok, true);
  const plan = director.writePlan(task, semantic, { visualPlanWallClockMs: 10, now: '2026-09-01T00:00:01Z' });
  assert.equal(plan.draft_bespoke_still_policy.planned_visual_slots, TOTAL_SLOTS);
  const planPath = writeJson(path.join(runDir, 'draft-visual-plan.json'), plan);

  const storyProjection = { project_id: story.project.id, version_id: story.v1.id, content_hash: story.v1.content_hash, approval_state: 'approved' };
  const slots = plan.draft_bespoke_still_policy.slots;

  const stillRoot = path.join(runDir, 'media', 'draft-bespoke-stills');
  const assets = slots.map((slot) => {
    const file = path.join(stillRoot, `${slot.slot_id}.png`);
    fs.mkdirSync(stillRoot, { recursive: true });
    fs.writeFileSync(file, `unique reviewed still bytes for ${slot.slot_id}`);
    return bespoke.productionAssetRecord({
      asset_id: slot.slot_id, slot_id: slot.slot_id, project_id: story.project.id, path: file, sha256: shaFile(file),
      width: 1080, height: 1920, media_kind: 'IMAGE', asset_class: bespoke.ASSET_CLASS, script_specific: true,
      temporal_media: false, motion_policy: 'NONE', source_attempt_id: `${slot.slot_id}-attempt-1`,
      visual_plan: { plan_id: plan.plan_id, plan_digest_sha256: plan.plan_digest_sha256, story: plan.story },
      script_binding: slot.script_binding, prompt_id: slot.prompt_id, prompt_sha256: slot.prompt_sha256,
      publication_authority: false, final_asset_authority: false,
    }, [slot.slot_id]);
  });

  const inputRoot = path.join(runDir, 'media', 'draft-inputs');
  fs.mkdirSync(inputRoot, { recursive: true });
  const narrationPath = path.join(inputRoot, 'narration.wav');
  fs.writeFileSync(narrationPath, 'synthetic draft narration fixture bytes');
  const musicPath = path.join(inputRoot, 'music.wav');
  fs.writeFileSync(musicPath, 'draft music fixture bytes');

  const alignmentCore = {
    schema: renderer.NARRATION_ALIGNMENT_SCHEMA, run_id: runId, story: storyProjection,
    source_class: 'SYNTHETIC_DRAFT_NARRATION', narration_sha256: shaFile(narrationPath),
    narration_duration_measured_ms: TOTAL_MS, timing_authority: 'NARRATION_ALIGNMENT',
    sections: story.sections.map((section, index) => ({
      section_id: section.id, story_order: index + 1, in_ms: index * SECTION_MS, out_ms: (index + 1) * SECTION_MS,
      duration_ms: SECTION_MS, script_beat_ids: slots.filter((slot) => slot.script_binding.section_id === section.id).map((slot) => slot.slot_id),
      script_span: section.dialogue,
    })),
  };
  const alignment = { ...alignmentCore, alignment_digest_sha256: renderer.narrationAlignmentDigest(alignmentCore) };
  const alignmentPath = writeJson(path.join(runDir, 'draft-narration-alignment.json'), alignment);

  const design = { schema: 'vidtoolz.productionAssemblySpec.v2', run_id: runId, mode: 'DRAFT_BESPOKE_STILL', geometry: 'STATIC_1080X1920', publication_authority: false, final_asset_authority: false };
  const designPath = writeJson(path.join(runDir, 'draft-design-package.json'), design);
  const manifest = {
    schema: compositionEngine.ASSET_MANIFEST_SCHEMA, run_id: runId, story: storyProjection,
    asset_class: bespoke.ASSET_CLASS, publication_authority: false, final_asset_authority: false, assets,
  };
  const manifestPath = writeJson(path.join(runDir, 'draft-asset-manifest.json'), manifest);

  // Weighted allocation, exactly as the canonical bespoke successor authority
  // tiles a section (allocateSectionIntervals weights by expected duration).
  const beats = [];
  for (const section of alignment.sections) {
    const sectionSlots = slots.filter((slot) => slot.script_binding.section_id === section.section_id);
    const weights = sectionSlots.map((slot) => slot.expected_timeline.duration_ms);
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    let cursor = section.in_ms; let remaining = SECTION_MS;
    sectionSlots.forEach((slot, index) => {
      const left = sectionSlots.length - index;
      const duration = index === sectionSlots.length - 1 ? remaining : Math.max(1, Math.min(remaining - (left - 1), Math.floor((SECTION_MS * weights[index]) / weightTotal)));
      beats.push(bespoke.editorBeatFor(slot, slot.slot_id, { beat_id: slot.slot_id, section_id: section.section_id, start_ms: cursor, end_ms: cursor + duration, width: 1080, height: 1920, fit: 'COVER' }));
      cursor += duration; remaining -= duration;
    });
  }
  const composition = {
    schema: compositionEngine.SCHEMA,
    design_package: { path: designPath, sha256: shaFile(designPath), schema: design.schema },
    approved_visual_plan: { path: planPath, file_sha256: shaFile(planPath), plan_id: plan.plan_id, digest_sha256: plan.plan_digest_sha256 },
    asset_manifest: { path: manifestPath, sha256: shaFile(manifestPath) },
    coverage: 'FULL_PROGRAMME', expected_beat_count: beats.length, beats, forbidden_asset_ids: [],
  };
  const rendererTimeline = alignment.sections.map((section) => ({ ...section, programme_in_ms: section.in_ms, programme_out_ms: section.out_ms, presenter_authority: 'NOT_APPLICABLE' }));
  compositionEngine.validateComposition(composition, rendererTimeline, { width: 1080, height: 1920, fps: 30 }, manifest);
  const compositionPath = writeJson(path.join(runDir, 'draft-composition.json'), composition);

  const musicEntry = {
    decision_id: `draft-music-${runId}`, predecessor_decision_id: null, policy: 'FULL_PROGRAMME', status: 'ACTIVE',
    authority: { type: 'HUMAN', id: 'Mikko Pakkala' }, decided_at: '2026-09-01T00:00:02Z',
    basis: 'Fixture Draft music under the Stable-Audio-first human-calibrated policy.',
    music_sha256: shaFile(musicPath), music_path: musicPath, music_duration_measured_ms: TOTAL_MS,
  };
  musicEntry.binding_digest_sha256 = renderer.musicDecisionDigest(musicEntry);
  const musicDecision = {
    schema: 'vidtoolz.visualDraftMusicDecision.v1', artifact_type: 'music-policy-decision-chain', run_id: runId,
    created_at: musicEntry.decided_at, policy_history: [musicEntry], active_decision: musicEntry.decision_id, active_policy: musicEntry.policy,
    music_asset: { path: musicPath, sha256: shaFile(musicPath), expected_sha256: shaFile(musicPath), sha_verified: true, duration_measured_ms: TOTAL_MS },
    draft_selected_music: true, final_music_authority: false, publication_authority: false,
  };
  const musicPathJson = writeJson(path.join(runDir, 'draft-music-decision.json'), musicDecision);

  const storyVersionFile = path.join(story.dataRoot, 'projects', story.project.id, 'versions', `${story.v1.id}.md`);
  const release = {
    schema: releaseAuthority.PACKET_SCHEMA, artifact_type: 'production-assembly-release-packet', draft_class: 'VISUAL_DRAFT',
    run_id: runId, story: storyProjection,
    visual_plan: { plan_id: plan.plan_id, version: plan.plan_revision, digest_sha256: plan.plan_digest_sha256, approval_state: 'DRAFT_CANARY_AUTHORIZED', file_sha256: shaFile(planPath), path: planPath },
    narration: { source_class: 'SYNTHETIC_DRAFT_NARRATION', path: narrationPath, sha256: shaFile(narrationPath), alignment: { path: alignmentPath, sha256: shaFile(alignmentPath), digest: alignment.alignment_digest_sha256 } },
    presenter_sources: [], human_review_binding_sha256: null, insert_policy: [],
    music_policy: { decision: musicDecision.active_policy, sha256: shaFile(musicPath), path: musicPath, duration_ms: TOTAL_MS },
    output_class: 'PRODUCTION_ASSEMBLY_CANDIDATE', evidence_class: 'PROPOSED_PRODUCTION_ASSEMBLY_TECHNICAL_EVIDENCE', gate_authority: false,
    forbidden_sources: ['PROXY_PRESENTER', 'FINAL_HUMAN_PERFORMANCE', 'I2V', 'KLING', 'UNBOUND_MEDIA'], ready: true, blockers: [],
    composition_validation: { schema: composition.schema, composition_digest_sha256: compositionEngine.digest(composition) },
    publication_authority: false, final_asset_authority: false, production_authority: false,
  };
  releaseAuthority.validateReleasePacketAuthority(release);
  const releasePath = writeJson(path.join(runDir, 'draft-release-R1.json'), release);

  const artifact = (slot, name, file, schema, extra = {}) => ({ slot, name, artifacts: [{ path: file, sha256: shaFile(file), schema, status: 'ACTIVE', ...extra }] });
  const intake = {
    schema: directed.LEGACY_INTAKE_SCHEMA, run_id: runId, created_at: '2026-09-01T00:00:03Z', predecessor: null,
    slots: [
      artifact(1, 'story', storyVersionFile, 'vidtoolz-script-builder.story-version.v1', { story: storyProjection }),
      artifact(2, 'visual', planPath, 'vidtoolz.successorVisualPlan.v3'),
      artifact(3, 'narration_alignment', alignmentPath, renderer.NARRATION_ALIGNMENT_SCHEMA),
      artifact(4, 'composition', compositionPath, compositionEngine.SCHEMA),
      artifact(5, 'asset_manifest', manifestPath, compositionEngine.ASSET_MANIFEST_SCHEMA),
      artifact(6, 'visual_draft_successor_packet', releasePath, releaseAuthority.PACKET_SCHEMA),
      artifact(7, 'music_decision', musicPathJson, 'vidtoolz.visualDraftMusicDecision.v1'),
      artifact(8, 'narration_asset', narrationPath, 'vidtoolz.audioAsset.v1', { class: 'SYNTHETIC_DRAFT_NARRATION', duration_ms: TOTAL_MS }),
      artifact(9, 'music_asset', musicPath, 'vidtoolz.audioAsset.v1', { class: 'DRAFT_MUSIC', duration_ms: TOTAL_MS }),
    ],
  };
  writeJson(path.join(runDir, 'draft-intake-R1.json'), intake);

  const handoffOptions = { allowedRoots: [runDir, story.root], validateRenderer: async (spec) => spec };
  return { story, repo, runs, runId, runDir, plan, planPath, slots, assets, alignment, composition, manifest, release, musicDecision, narrationPath, musicPath, handoffOptions, storyProjection };
}

async function renderDraft(estate) {
  const executed = await directed.execute(estate.runDir, { ...estate.handoffOptions, renderFromSpec: async (specPath) => fakeRenderFromSpec(specPath) });
  const subject = subjects.resolveReviewSubject(estate.runDir);
  assert.equal(subject.status, 'DRAFT_REVIEW_READY');
  return { executed, subject };
}

async function reviewedEstate(label, notes, options = {}) {
  const estate = options.estate || draftEstate(label, options);
  const rendered = await renderDraft(estate);
  const reviewId = options.reviewId || 'mikko-r1';
  review.openReview(estate.runDir, { reviewId, reviewer: 'mikko', reviewerAuthority: 'HUMAN:Mikko Pakkala', recordedBy: 'fixture-suite' });
  for (const note of notes) review.addNote(estate.runDir, reviewId, note);
  if (options.verdict) review.setDraftVerdict(estate.runDir, reviewId, options.verdict, { note: options.verdictNote });
  if (options.ratings !== false) review.setRating(estate.runDir, reviewId, 'story', 7);
  if (options.submit !== false) review.submitReview(estate.runDir, reviewId, { overallComment: options.overallComment || 'Fixture overall comment, verbatim.' });
  return { ...estate, rendered, reviewId, subject: rendered.subject };
}

/* Timecode helper: the middle of the beat serving one slot. */
function atSlot(estate, slotId) {
  const beat = estate.composition.beats.find((item) => item.beat_id === slotId);
  if (!beat) throw new Error(`no beat for ${slotId}`);
  return (beat.start_ms + Math.floor((beat.end_ms - beat.start_ms) / 2)) / 1000;
}
function atSection(estate, sectionId) {
  const section = estate.alignment.sections.find((item) => item.section_id === sectionId);
  return (section.in_ms + 500) / 1000;
}

/* ── injected domain adapters (no hidden generation) ─────────────────────── */

function adapters(estate, spy = {}) {
  spy.visualConcepts = spy.visualConcepts || [];
  spy.stills = spy.stills || [];
  spy.music = spy.music || 0;
  spy.narration = spy.narration || 0;
  return {
    visual: {
      async reviseSlot({ slot, shot }) {
        spy.visualConcepts.push(slot.slot_id);
        return {
          prompt_text: `Revised vertical concept for ${slot.slot_id} answering the human note, ${crypto.randomUUID()}.`,
          shot_brief: `Revised distinct concept for ${slot.slot_id} addressing the review.`,
          narrative_function: shot.narrative_function,
          subject: `Revised subject for ${slot.slot_id}`,
        };
      },
      async generateStill({ slot, outputDir }) {
        spy.stills.push(slot.slot_id);
        const file = path.join(outputDir, `${slot.slot_id}.png`);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(file, `regenerated still bytes for ${slot.slot_id} ${crypto.randomUUID()}`);
        return { path: file, sha256: shaFile(file), width: 1080, height: 1920, generator_id: 'fixture-flux-draft-still' };
      },
    },
    music: {
      async generateDraftMusic({ outputDir }) {
        spy.music += 1;
        const file = path.join(outputDir, 'revised-music.wav');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(file, `revised draft music bytes ${crypto.randomUUID()}`);
        return { path: file, sha256: shaFile(file), duration_ms: TOTAL_MS, basis: 'Stable-Audio-first A/B/C, human-calibrated selection' };
      },
    },
    narration: {
      async generateNarration({ sections, outputDir }) {
        spy.narration += 1;
        const file = path.join(outputDir, 'revised-narration.wav');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(file, `revised synthetic narration bytes ${crypto.randomUUID()}`);
        const list = sections || estate.story.sections;
        const per = Math.floor(TOTAL_MS / list.length);
        return {
          path: file, sha256: shaFile(file), duration_ms: per * list.length, source_class: 'SYNTHETIC_DRAFT_NARRATION',
          sections: list.map((section, index) => ({
            section_id: section.id, story_order: index + 1, in_ms: index * per, out_ms: (index + 1) * per,
            duration_ms: per, script_beat_ids: [], script_span: section.dialogue,
          })),
        };
      },
    },
  };
}

async function runRevision(estate, spy = {}, extra = {}) {
  const plan = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  const result = await executor.executeRevisionPlan(estate.runDir, {
    scriptBuilderRoot: estate.story.root, adapters: adapters(estate, spy),
    handoffOptions: estate.handoffOptions, renderFromSpec: async (specPath) => fakeRenderFromSpec(specPath),
    ...extra,
  });
  return { plan: plan.plan, plan_path: plan.plan_path, result, spy };
}

/* ── §31 KEEP-only ───────────────────────────────────────────────────────── */

test('DRS01 KEEP-only review plans NO_REVISION_REQUIRED and regenerates nothing', async () => {
  const base = draftEstate('keep-only');
  const estate = await reviewedEstate('keep-only', [
    { timecode_seconds: atSlot(base, base.slots[0].slot_id), disposition: 'KEEP', target_domain: 'VISUAL', visual_dimension: 'VISUAL_CONCEPT', comment: 'This visual idea is right — keep it.' },
    { timecode_seconds: atSection(base, 'S03'), disposition: 'KEEP', target_domain: 'MUSIC', music_dimension: 'MUSIC_CONCEPT', comment: 'Music works — keep it.' },
  ], { estate: base, verdict: 'KEEP' });
  const planned = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.equal(planned.plan.decision, 'NO_REVISION_REQUIRED');
  assert.equal(planned.plan.revision_required, false);
  assert.equal(planned.plan.work_items.length, 0);
  assert.equal(planned.plan.reuse_census.music, 'REUSE');
  assert.equal(planned.plan.reuse_census.narration, 'REUSE');
  assert.equal(planned.plan.reuse_census.script, 'REUSE');
  assert.equal(planned.plan.reuse_census.visual.regenerated.length, 0);
  assert.equal(planned.plan.reuse_census.visual.preserved.length, TOTAL_SLOTS);
  const spy = {};
  const executed = await executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate, spy), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) });
  assert.equal(executed.state, 'NO_REVISION_REQUIRED');
  assert.deepEqual([spy.stills.length, spy.music, spy.narration], [0, 0, 0]);
  // no successor draft was produced
  assert.equal(fs.existsSync(path.join(estate.runDir, directed.ASSEMBLY_DIR, 'directed-draft-r2.mp4')), false);
});

/* ── §32 one visual CHANGE: the core economics ───────────────────────────── */

test('DRS02 one visual CONCEPT change regenerates exactly one still and reuses the other 19', async () => {
  const base = draftEstate('one-visual');
  const targetSlot = base.slots[7].slot_id;
  const estate = await reviewedEstate('one-visual', [
    { timecode_seconds: atSlot(base, targetSlot), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'VISUAL_CONCEPT', comment: 'This visual misses the point of the line — different idea please.' },
  ], { estate: base, verdict: 'CHANGE' });
  const { plan, result, spy } = await runRevision(estate);
  assert.equal(plan.decision, 'REVISION_REQUIRED');
  assert.equal(plan.work_items.length, 1);
  assert.equal(plan.work_items[0].kind, 'VISUAL_CONCEPT_REVISION');
  assert.equal(plan.work_items[0].target.visual_asset_id, targetSlot);
  assert.equal(result.state, 'REVISION_COMPLETE');
  assert.deepEqual(result.successor.census, {
    visual_preserved: TOTAL_SLOTS - 1, visual_regenerated: 1, visual_removed: 0,
    music: 'REUSED', narration: 'REUSED', script: 'REUSED',
  });
  assert.deepEqual(spy.stills, [targetSlot]);
  assert.equal(spy.music, 0);
  assert.equal(spy.narration, 0);
  // the successor Draft exists, is review-ready, and carries no final authority
  assert.equal(result.successor.successor_draft.draft_version, 2);
  assert.equal(result.successor.state, 'DRAFT_REVIEW_READY');
  assert.equal(result.successor.human_review, 'NONE');
  assert.equal(result.successor.publication_ready, false);
  assert.equal(result.successor.final_production_locked, false);
  // 19 reused assets keep their exact predecessor bytes in the successor manifest
  const successorManifest = readJson(executor.revisionPaths(estate.runDir, 2).manifest);
  const changed = successorManifest.assets.filter((asset) => !base.assets.some((old) => old.asset_id === asset.asset_id && old.sha256 === asset.sha256));
  assert.deepEqual(changed.map((asset) => asset.asset_id), [targetSlot]);
});

test('DRS03 the revision diff names preserved, regenerated and their originating review note', async () => {
  const base = draftEstate('diff');
  const targetSlot = base.slots[3].slot_id;
  const estate = await reviewedEstate('diff', [
    { timecode_seconds: atSlot(base, targetSlot), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Right idea, weak render.' },
  ], { estate: base });
  const { result } = await runRevision(estate);
  const diff = result.diff;
  assert.equal(diff.schema, 'vidtoolz.draftRevisionDiff.v1');
  assert.equal(diff.predecessor_draft_version, 1);
  assert.equal(diff.successor_draft_version, 2);
  assert.equal(diff.preserved.filter((item) => item.kind === 'VISUAL_ASSET').length, TOTAL_SLOTS - 1);
  assert.deepEqual(diff.regenerated.map((item) => item.id), [targetSlot]);
  assert.equal(diff.regenerated[0].review_ref, 'note-0001');
  assert.equal(diff.regenerated[0].reason, 'Right idea, weak render.');
  assert.ok(diff.preserved.some((item) => item.kind === 'MUSIC'));
  assert.ok(diff.preserved.some((item) => item.kind === 'NARRATION'));
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.added, []);
});

/* ── §33 IMAGE_EXECUTION only ────────────────────────────────────────────── */

test('DRS04 IMAGE_EXECUTION change keeps the concept and prompt, regenerating only the still', async () => {
  const base = draftEstate('exec-only');
  const targetSlot = base.slots[11].slot_id;
  const estate = await reviewedEstate('exec-only', [
    { timecode_seconds: atSlot(base, targetSlot), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Concept is right; this generation is muddy.' },
  ], { estate: base });
  const { plan, result, spy } = await runRevision(estate);
  assert.equal(plan.work_items[0].kind, 'VISUAL_EXECUTION_REGENERATION');
  assert.equal(plan.work_items[0].regeneration_scope, 'ONE_STILL_SAME_CONCEPT_SAME_PROMPT');
  assert.equal(result.state, 'REVISION_COMPLETE');
  // no concept adapter call, exactly one generation, and the visual plan is untouched
  assert.deepEqual(spy.visualConcepts, []);
  assert.deepEqual(spy.stills, [targetSlot]);
  assert.equal(fs.existsSync(executor.revisionPaths(estate.runDir, 2).plan), false);
  const successorIntake = readJson(executor.revisionPaths(estate.runDir, 2).intake);
  const visualSlot = successorIntake.slots.find((slot) => slot.name === 'visual');
  assert.equal(visualSlot.artifacts[0].path, base.planPath, 'execution-only revision reuses the exact predecessor visual plan');
  assert.equal(result.successor.census.visual_regenerated, 1);
});

test('DRS05 a concept change mints a new shot and prompt identity; execution-only does not', async () => {
  const conceptBase = draftEstate('concept-identity');
  const slotId = conceptBase.slots[2].slot_id;
  const conceptEstate = await reviewedEstate('concept-identity', [
    { timecode_seconds: atSlot(conceptBase, slotId), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'VISUAL_CONCEPT', comment: 'Different concept needed here.' },
  ], { estate: conceptBase });
  await runRevision(conceptEstate);
  const derived = readJson(executor.revisionPaths(conceptEstate.runDir, 2).plan);
  const before = conceptBase.plan.draft_bespoke_still_policy.slots.find((slot) => slot.slot_id === slotId);
  const after = derived.draft_bespoke_still_policy.slots.find((slot) => slot.slot_id === slotId);
  assert.notEqual(after.prompt_id, before.prompt_id);
  assert.notEqual(after.shot_id, before.shot_id);
  assert.notEqual(after.visual_concept, before.visual_concept);
  assert.equal(derived.plan_revision, conceptBase.plan.plan_revision + 1);
  assert.equal(derived.supersedes.plan_digest_sha256, conceptBase.plan.plan_digest_sha256);
  // the derived plan passes the canonical plan + successor + bespoke policy authorities
  assert.equal(vp.validatePlan(derived).ok, true);
  assert.equal(vp.validateSuccessorPlan(conceptBase.plan, derived).valid, true);
  assert.equal(bespoke.validatePlanPolicy(derived).ok, true);
  assert.equal(derived.draft_bespoke_still_policy.planned_visual_slots, TOTAL_SLOTS);
});

/* ── §34 music change ────────────────────────────────────────────────────── */

test('DRS06 MUSIC_CONCEPT change regenerates music only; every visual and narration is reused', async () => {
  const base = draftEstate('music');
  const estate = await reviewedEstate('music', [
    { timecode_seconds: atSection(base, 'S02'), disposition: 'CHANGE', target_domain: 'MUSIC', music_dimension: 'MUSIC_CONCEPT', comment: 'The bed is the wrong emotional register for this argument.' },
  ], { estate: base });
  const { plan, result, spy } = await runRevision(estate);
  assert.equal(plan.work_items[0].kind, 'MUSIC_CONCEPT_REVISION');
  assert.equal(result.state, 'REVISION_COMPLETE');
  assert.deepEqual(result.successor.census, {
    visual_preserved: TOTAL_SLOTS, visual_regenerated: 0, visual_removed: 0,
    music: 'REGENERATED', narration: 'REUSED', script: 'REUSED',
  });
  assert.equal(spy.music, 1);
  assert.deepEqual(spy.stills, []);
  assert.equal(spy.narration, 0);
  // the new music decision is a renderer-valid root chain carrying Draft-only authority
  const decision = readJson(executor.revisionPaths(estate.runDir, 2).music);
  assert.equal(decision.policy_history[0].predecessor_decision_id, null);
  assert.equal(renderer.activeMusicDecision({ policy: decision.active_policy, sha256: decision.music_asset.sha256, policy_history: decision.policy_history }).decision_id, decision.active_decision);
  assert.equal(decision.final_music_authority, false);
  assert.equal(decision.publication_authority, false);
  assert.match(decision.policy_history[0].basis, /wrong emotional register/);
});

test('DRS07 music KEEP reuses the exact predecessor music decision and asset', async () => {
  const base = draftEstate('music-keep');
  const estate = await reviewedEstate('music-keep', [
    { timecode_seconds: atSection(base, 'S01'), disposition: 'KEEP', target_domain: 'MUSIC', music_dimension: 'MUSIC_CONCEPT', comment: 'Music is right — keep it.' },
    { timecode_seconds: atSlot(base, base.slots[1].slot_id), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate this still.' },
  ], { estate: base });
  const { result, spy } = await runRevision(estate);
  assert.equal(spy.music, 0, 'a music KEEP must not trigger three new tracks');
  assert.equal(result.successor.census.music, 'REUSED');
  const intake = readJson(executor.revisionPaths(estate.runDir, 2).intake);
  const musicSlot = intake.slots.find((slot) => slot.name === 'music_asset');
  assert.equal(musicSlot.artifacts[0].sha256, shaFile(base.musicPath));
});

/* ── §35 pacing only ─────────────────────────────────────────────────────── */

test('DRS08 PACING change revises the timeline with zero media regeneration', async () => {
  const base = draftEstate('pacing');
  const estate = await reviewedEstate('pacing', [
    { timecode_seconds: atSection(base, 'S03'), disposition: 'CHANGE', target_domain: 'PACING', comment: 'This section drags — the third visual holds far too long.' },
  ], { estate: base });
  const { plan, result, spy } = await runRevision(estate);
  assert.equal(plan.work_items[0].domain, 'EDIT_PACING');
  assert.equal(plan.work_items[0].kind, 'EDIT_PACING_REBALANCE');
  assert.match(plan.work_items[0].regeneration_scope, /^NO_MEDIA/);
  assert.equal(result.state, 'REVISION_COMPLETE');
  assert.deepEqual([spy.stills.length, spy.music, spy.narration], [0, 0, 0]);
  assert.deepEqual(result.successor.census, {
    visual_preserved: TOTAL_SLOTS, visual_regenerated: 0, visual_removed: 0,
    music: 'REUSED', narration: 'REUSED', script: 'REUSED',
  });
  // the affected section is re-tiled evenly; the untouched sections keep their exact beats
  const composition = readJson(executor.revisionPaths(estate.runDir, 2).composition);
  const before = base.composition.beats.filter((beat) => beat.section_id === 'S03');
  const after = composition.beats.filter((beat) => beat.section_id === 'S03');
  assert.notDeepEqual(after.map((beat) => beat.end_ms), before.map((beat) => beat.end_ms));
  assert.deepEqual(
    composition.beats.filter((beat) => beat.section_id === 'S01').map((beat) => [beat.start_ms, beat.end_ms]),
    base.composition.beats.filter((beat) => beat.section_id === 'S01').map((beat) => [beat.start_ms, beat.end_ms]),
  );
  // full coverage, no gaps
  assert.equal(composition.beats[0].start_ms, 0);
  assert.equal(composition.beats.at(-1).end_ms, TOTAL_MS);
  // and the media bytes are literally the predecessor's
  const manifest = readJson(executor.revisionPaths(estate.runDir, 2).manifest);
  assert.deepEqual(manifest.assets.map((asset) => asset.sha256).sort(), base.assets.map((asset) => asset.sha256).sort());
});

/* ── §36 script rewrite ──────────────────────────────────────────────────── */

test('DRS09 script REWRITE rebuilds only its dependency cone and reuses unaffected sections', async () => {
  const base = draftEstate('rewrite');
  const estate = await reviewedEstate('rewrite', [
    { timecode_seconds: atSection(base, 'S02'), disposition: 'REWRITE', target_domain: 'SCRIPT', comment: 'This line buries the claim — rewrite it.' },
  ], { estate: base });
  // a human authors and approves the Story successor first (never fabricated here)
  approveStorySuccessor(estate.story, (sections) => sections.map((section) => (section.id === 'S02' ? { ...section, dialogue: dialogueFor(1, 'rewritten') } : section)));
  const { plan, result, spy } = await runRevision(estate);
  assert.equal(plan.work_items[0].kind, 'SCRIPT_SECTION_REWRITE');
  assert.equal(result.state, 'REVISION_COMPLETE');
  const s02Slots = base.slots.filter((slot) => slot.script_binding.section_id === 'S02').map((slot) => slot.slot_id);
  assert.deepEqual(spy.stills.slice().sort(), s02Slots.slice().sort(), 'only the rewritten section\'s visuals regenerate');
  assert.equal(spy.narration, 1, 'narration follows the script');
  assert.equal(spy.music, 0, 'music is not invalidated by a section rewrite');
  assert.deepEqual(result.successor.census, {
    visual_preserved: TOTAL_SLOTS - SLOTS_PER_SECTION, visual_regenerated: SLOTS_PER_SECTION, visual_removed: 0,
    music: 'REUSED', narration: 'REGENERATED', script: 'STORY_SUCCESSOR_ADOPTED',
  });
  assert.equal(result.successor.story_changed, true);
  assert.notEqual(result.successor.story.version_id, base.story.v1.id);
  // the successor plan pins the new Story and the new exact script text
  const derived = readJson(executor.revisionPaths(estate.runDir, 2).plan);
  assert.equal(derived.story.version_id, result.successor.story.version_id);
  const rewritten = derived.draft_bespoke_still_policy.slots.find((slot) => slot.script_binding.section_id === 'S02');
  assert.equal(rewritten.script_binding.source_text, dialogueFor(1, 'rewritten'));
  assert.equal(bespoke.validatePlanPolicy(derived).ok, true);
});

test('DRS10 script work without a human-approved Story successor is blocked, never fabricated', async () => {
  const base = draftEstate('rewrite-unapproved');
  const estate = await reviewedEstate('rewrite-unapproved', [
    { timecode_seconds: atSection(base, 'S04'), disposition: 'REWRITE', target_domain: 'SCRIPT', comment: 'Rewrite this section.' },
  ], { estate: base });
  // (a) no successor at all
  const first = await runRevision(estate);
  assert.equal(first.result.state, 'REVISION_BLOCKED');
  assert.match(first.result.blocking[0].reason, /SCRIPT_SUCCESSOR_REQUIRED/);
  // (b) an unapproved successor is still not authority
  unapprovedStorySuccessor(estate.story, (sections) => sections.map((section) => (section.id === 'S04' ? { ...section, dialogue: dialogueFor(3, 'unapproved') } : section)));
  const second = await runRevision(estate);
  assert.equal(second.result.state, 'REVISION_BLOCKED');
  assert.match(second.result.blocking[0].reason, /SCRIPT_SUCCESSOR_UNAPPROVED/);
  assert.equal(fs.existsSync(path.join(estate.runDir, directed.ASSEMBLY_DIR, 'directed-draft-r2.mp4')), false);
});

test('DRS11 a Story successor that ignores the requested section is refused', async () => {
  const base = draftEstate('rewrite-mismatch');
  const estate = await reviewedEstate('rewrite-mismatch', [
    { timecode_seconds: atSection(base, 'S05'), disposition: 'REWRITE', target_domain: 'SCRIPT', comment: 'Rewrite S05.' },
  ], { estate: base });
  approveStorySuccessor(estate.story, (sections) => sections.map((section) => (section.id === 'S01' ? { ...section, dialogue: dialogueFor(0, 'unrelated-change') } : section)));
  const { result } = await runRevision(estate);
  assert.equal(result.state, 'REVISION_BLOCKED');
  assert.match(result.blocking[0].reason, /SCRIPT_SUCCESSOR_MISMATCH/);
});

/* ── §37 cut ─────────────────────────────────────────────────────────────── */

test('DRS12 a visual CUT removes the slot, re-tiles its section and regenerates nothing', async () => {
  const base = draftEstate('cut');
  const targetSlot = base.slots[1].slot_id; // S01 has 4 slots
  const estate = await reviewedEstate('cut', [
    { timecode_seconds: atSlot(base, targetSlot), disposition: 'CUT', target_domain: 'VISUAL', comment: 'This shot adds nothing — cut it.' },
  ], { estate: base });
  const { plan, result, spy } = await runRevision(estate);
  assert.equal(plan.work_items[0].kind, 'VISUAL_CUT');
  assert.equal(plan.work_items[0].execution_blocking, false);
  assert.equal(result.state, 'REVISION_COMPLETE');
  assert.deepEqual([spy.stills.length, spy.music, spy.narration], [0, 0, 0]);
  assert.deepEqual(result.successor.census, {
    visual_preserved: TOTAL_SLOTS - 1, visual_regenerated: 0, visual_removed: 1,
    music: 'REUSED', narration: 'REUSED', script: 'REUSED',
  });
  // gone from plan, manifest and composition; forbidden for the successor
  const paths = executor.revisionPaths(estate.runDir, 2);
  const derived = readJson(paths.plan);
  assert.equal(derived.draft_bespoke_still_policy.slots.some((slot) => slot.slot_id === targetSlot), false);
  assert.equal(derived.draft_bespoke_still_policy.planned_visual_slots, TOTAL_SLOTS - 1);
  assert.equal(bespoke.validatePlanPolicy(derived).ok, true);
  const manifest = readJson(paths.manifest);
  assert.equal(manifest.assets.some((asset) => asset.asset_id === targetSlot), false);
  const composition = readJson(paths.composition);
  assert.equal(composition.beats.some((beat) => beat.beat_id === targetSlot), false);
  assert.ok(composition.forbidden_asset_ids.includes(targetSlot));
  // no timeline gap: S01 stays fully covered by its remaining 3 beats
  const s01 = composition.beats.filter((beat) => beat.section_id === 'S01');
  assert.equal(s01.length, SLOTS_PER_SECTION - 1);
  assert.equal(s01[0].start_ms, 0);
  assert.equal(s01.at(-1).end_ms, SECTION_MS);
  assert.equal(composition.beats.at(-1).end_ms, TOTAL_MS);
  // the historical asset bytes are preserved on disk
  assert.ok(fs.existsSync(base.assets.find((asset) => asset.asset_id === targetSlot).path));
});

test('DRS13 cutting a section\'s only visual is blocked instead of leaving it uncovered', async () => {
  const base = draftEstate('cut-sole');
  const s01 = base.slots.filter((slot) => slot.script_binding.section_id === 'S01');
  const estate = await reviewedEstate('cut-sole', s01.map((slot) => ({
    timecode_seconds: atSlot(base, slot.slot_id), disposition: 'CUT', target_domain: 'VISUAL', comment: `Cut ${slot.slot_id}.`,
  })), { estate: base });
  const planned = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  // every S01 slot is a CUT: the section would end up uncovered
  assert.equal(planned.plan.decision, 'REVISION_BLOCKED');
  assert.ok(planned.plan.blocking.length >= 1);
  const executed = await executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) });
  assert.equal(executed.state, 'REVISION_BLOCKED');
});

/* ── §38 hostile matrix ──────────────────────────────────────────────────── */

test('DRS14 hostile: stale review, altered draft bytes and altered review bytes all fail closed', async () => {
  // (1)+(2) altered draft bytes -> the review is no longer about what is on disk
  const bytesEstate = await reviewedEstate('hostile-bytes', [
    { timecode_seconds: 1, disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate.' },
  ]);
  const output = path.join(bytesEstate.runDir, directed.ASSEMBLY_DIR, 'directed-draft-r1.mp4');
  fs.appendFileSync(output, ' tampered');
  errorCode(() => planner.buildRevisionPlan(bytesEstate.runDir, { scriptBuilderRoot: bytesEstate.story.root }), 'DRAFT_REVISION_SUBJECT_INVALID');
  // (3) altered review bytes
  const reviewEstate = await reviewedEstate('hostile-review', [
    { timecode_seconds: 1, disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate.' },
  ]);
  const record = review.readReview(reviewEstate.runDir, reviewEstate.reviewId);
  record.notes[0].comment = 'Fabricated stronger instruction.';
  review.writeReview(reviewEstate.runDir, record);
  errorCode(() => planner.buildRevisionPlan(reviewEstate.runDir, { scriptBuilderRoot: reviewEstate.story.root }), 'CURRENT_HUMAN_REVIEW_MISSING');
});

test('DRS15 hostile: no review, unsubmitted review and fabricated dispositions cannot start a revision', async () => {
  // (25) a review with no actionable change is canonical, not an error
  const noneEstate = draftEstate('hostile-none');
  await renderDraft(noneEstate);
  errorCode(() => planner.buildRevisionPlan(noneEstate.runDir, { scriptBuilderRoot: noneEstate.story.root }), 'CURRENT_HUMAN_REVIEW_MISSING');
  // an OPEN (unsubmitted) review is not authority either
  review.openReview(noneEstate.runDir, { reviewId: 'open', reviewerAuthority: 'HUMAN:Mikko Pakkala' });
  review.addNote(noneEstate.runDir, 'open', { timecode_seconds: 1, disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate.' });
  errorCode(() => planner.buildRevisionPlan(noneEstate.runDir, { scriptBuilderRoot: noneEstate.story.root }), 'CURRENT_HUMAN_REVIEW_MISSING');
  // (7)/(8) fabricated KEEP or CHANGE: the review vocabulary is closed
  errorCode(() => review.addNote(noneEstate.runDir, 'open', { timecode_seconds: 1, disposition: 'APPROVE', comment: 'x' }), 'DRAFT_REVIEW_DISPOSITION_INVALID');
  errorCode(() => review.addNote(noneEstate.runDir, 'open', { timecode_seconds: 1, disposition: 'CHANGE', target_domain: 'PUBLISH', comment: 'x' }), 'DRAFT_REVIEW_TARGET_DOMAIN_INVALID');
});

test('DRS16 hostile: unrouted feedback blocks instead of the planner guessing intent', async () => {
  const base = draftEstate('hostile-unrouted');
  const estate = await reviewedEstate('hostile-unrouted', [
    { timecode_seconds: atSection(base, 'S02'), disposition: 'CHANGE', comment: 'Something about this feels off.' },
  ], { estate: base });
  const planned = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.equal(planned.plan.decision, 'REVISION_BLOCKED');
  assert.equal(planned.plan.work_items[0].kind, 'UNROUTED_FEEDBACK');
  assert.equal(planned.plan.work_items[0].execution_blocking, true);
  assert.match(planned.plan.blocking[0].reason, /never guesses/);
  const executed = await executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) });
  assert.equal(executed.state, 'REVISION_BLOCKED');
});

test('DRS17 hostile: a plan may not add unrequested work, drop work, invent beats or escalate authority', async () => {
  const base = draftEstate('hostile-plan');
  const slotId = base.slots[5].slot_id;
  const estate = await reviewedEstate('hostile-plan', [
    { timecode_seconds: atSlot(base, slotId), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate this one.' },
  ], { estate: base });
  const planned = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  const input = review.revisionPlanInput(estate.runDir, estate.reviewId);
  const reseal = (plan) => { const core = { ...plan }; delete core.plan_digest_sha256; delete core.created_at; return { ...plan, plan_digest_sha256: planner.digest(core) }; };
  // (10) unrequested extra work
  const extra = structuredClone(planned.plan);
  extra.work_items.push({ ...extra.work_items[0], work_item_id: 'wi-9999', target: { ...extra.work_items[0].target, visual_asset_id: base.slots[6].slot_id } });
  errorCode(() => planner.validateRevisionPlan(reseal(extra), input), 'DRAFT_REVISION_PLAN_WORK_MISMATCH');
  // dropped work
  const dropped = structuredClone(planned.plan); dropped.work_items = [];
  errorCode(() => planner.validateRevisionPlan(reseal(dropped), input), 'DRAFT_REVISION_PLAN_WORK_MISMATCH');
  // (9) nonexistent beat/section
  const badSection = structuredClone(planned.plan); badSection.work_items[0].target.section_id = 'S99';
  errorCode(() => planner.validateRevisionPlan(reseal(badSection), input), 'DRAFT_REVISION_TARGET_SECTION_UNKNOWN');
  // review reference that does not exist
  const badNote = structuredClone(planned.plan); badNote.work_items[0].review_ref.note_id = 'note-4242';
  errorCode(() => planner.validateRevisionPlan(reseal(badNote), input), 'DRAFT_REVISION_WORK_ITEM_UNBACKED');
  // (14) unknown work domain / kind
  const badKind = structuredClone(planned.plan); badKind.work_items[0].kind = 'PUBLISH_NOW';
  errorCode(() => planner.validateRevisionPlan(reseal(badKind), input), 'DRAFT_REVISION_WORK_KIND_UNKNOWN');
  // (11)/(12) final production or publication escalation
  for (const field of ['final_production_lock', 'publication_authority', 'final_asset_authority', 'completes_rough_cut_gate']) {
    const escalated = structuredClone(planned.plan); escalated.authority[field] = true;
    errorCode(() => planner.validateRevisionPlan(reseal(escalated), input), 'DRAFT_REVISION_PLAN_AUTHORITY_ESCALATION');
  }
  // (15) duplicate conflicting work items
  const duplicate = structuredClone(planned.plan); duplicate.work_items.push({ ...duplicate.work_items[0], work_item_id: 'wi-0002' });
  errorCode(() => planner.validateRevisionPlan(reseal(duplicate), input), 'DRAFT_REVISION_WORK_ITEM_DUPLICATE');
  // vague work with no human rationale
  const vague = structuredClone(planned.plan); vague.work_items[0].verbatim_comment = '   ';
  errorCode(() => planner.validateRevisionPlan(reseal(vague), input), 'DRAFT_REVISION_WORK_ITEM_VAGUE');
  // (13) malformed / tampered plan bytes
  const tampered = structuredClone(planned.plan); tampered.work_items[0].kind = 'VISUAL_CONCEPT_REVISION';
  errorCode(() => planner.validateRevisionPlan(tampered, input), 'DRAFT_REVISION_PLAN_TAMPERED');
});

test('DRS18 hostile: a stored plan is immutable and a stale plan is never reinterpreted', async () => {
  const base = draftEstate('hostile-stale-plan');
  const estate = await reviewedEstate('hostile-stale-plan', [
    { timecode_seconds: atSlot(base, base.slots[9].slot_id), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate.' },
  ], { estate: base });
  const first = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  // (21) re-planning is idempotent, not a duplicate successor
  const again = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.equal(again.state, 'ALREADY_PLANNED');
  assert.equal(again.plan.plan_digest_sha256, first.plan.plan_digest_sha256);
  // (17) the plan goes stale the moment its bound review or draft moves
  const record = review.readReview(estate.runDir, estate.reviewId);
  record.notes[0].comment = 'changed after planning';
  review.writeReview(estate.runDir, record);
  errorCode(() => planner.verifyRevisionPlanCurrent(estate.runDir, first.plan, { scriptBuilderRoot: estate.story.root }), 'DRAFT_REVISION_PLAN_STALE');
  await rejectCode(() => executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) }), 'DRAFT_REVISION_PLAN_STALE');
  // a stored plan cannot be silently replaced
  errorCode(() => { const file = first.plan_path; const value = readJson(file); value.decision = 'REVISION_REQUIRED'; value.work_items = []; fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); planner.loadRevisionPlan(estate.runDir, 2); }, 'DRAFT_REVISION_PLAN_TAMPERED');
});

test('DRS19 hostile: modified predecessor asset bytes and reuse hash mismatch fail closed', async () => {
  const base = draftEstate('hostile-reuse');
  const estate = await reviewedEstate('hostile-reuse', [
    { timecode_seconds: atSlot(base, base.slots[0].slot_id), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate the first still.' },
  ], { estate: base });
  planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  // (18)/(19) a REUSED asset whose bytes moved is never silently carried forward
  const reused = base.assets[5];
  fs.appendFileSync(reused.path, ' tampered predecessor bytes');
  await rejectCode(() => executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) }), 'DRAFT_REVISION_REUSE_HASH_MISMATCH');
});

test('DRS20 hostile: adapters are required, outputs must land inside the run, and lineage cannot loop', async () => {
  const base = draftEstate('hostile-adapters');
  const estate = await reviewedEstate('hostile-adapters', [
    { timecode_seconds: atSlot(base, base.slots[4].slot_id), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate.' },
  ], { estate: base });
  planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  // (23) no caller-supplied asset paths and no hidden generation: without an
  // adapter the executor fails closed rather than inventing media
  await rejectCode(() => executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) }), 'DRAFT_REVISION_ADAPTER_REQUIRED');
  // an adapter that writes outside the run directory is refused
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-run-'));
  const rogue = adapters(estate);
  rogue.visual.generateStill = async ({ slot }) => {
    const file = path.join(outside, `${slot.slot_id}.png`);
    fs.writeFileSync(file, 'rogue bytes');
    return { path: file, sha256: shaFile(file), width: 1080, height: 1920 };
  };
  await rejectCode(() => executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: rogue, handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) }), 'DRAFT_REVISION_OUTPUT_OUTSIDE_RUN');
  // an adapter lying about its own output hash is refused
  const liar = adapters(estate);
  liar.visual.generateStill = async ({ slot, outputDir }) => {
    fs.mkdirSync(outputDir, { recursive: true });
    const file = path.join(outputDir, `${slot.slot_id}.png`);
    fs.writeFileSync(file, 'real bytes');
    return { path: file, sha256: 'f'.repeat(64), width: 1080, height: 1920 };
  };
  await rejectCode(() => executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: liar, handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) }), 'DRAFT_REVISION_STILL_OUTPUT_INVALID');
});

/* ── §27 interruption / resume ───────────────────────────────────────────── */

test('DRS21 an interrupted revision resumes without repeating completed generation', async () => {
  const base = draftEstate('resume');
  const targets = [base.slots[2].slot_id, base.slots[8].slot_id, base.slots[14].slot_id];
  const estate = await reviewedEstate('resume', targets.map((slotId) => ({
    timecode_seconds: atSlot(base, slotId), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: `Regenerate ${slotId}.`,
  })), { estate: base });
  planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  const spy = {};
  const failing = adapters(estate, spy);
  const realGenerate = failing.visual.generateStill;
  let calls = 0;
  failing.visual.generateStill = async (input) => {
    calls += 1;
    if (calls === 3) { const error = new Error('injected interruption'); error.code = 'FIXTURE_INTERRUPTED'; throw error; }
    return realGenerate(input);
  };
  await assert.rejects(() => executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: failing, handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) }), (error) => error.code === 'FIXTURE_INTERRUPTED');
  assert.equal(spy.stills.length, 2, 'two generations completed before the interruption');
  // resume: only the unfinished work runs again
  const resumeSpy = {};
  const result = await executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate, resumeSpy), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) });
  assert.equal(result.state, 'REVISION_COMPLETE');
  assert.equal(resumeSpy.stills.length, 1, 'the two completed generations are reused, not repeated');
  assert.equal(result.successor.census.visual_regenerated, 3);
  assert.equal(result.successor.census.visual_preserved, TOTAL_SLOTS - 3);
  // (21) a completed revision is returned, never re-executed
  const third = await executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) });
  assert.equal(third.state, 'ALREADY_COMPLETE');
});

test('DRS22 a journal from a different plan is refused rather than mixed', async () => {
  const base = draftEstate('journal-mismatch');
  const estate = await reviewedEstate('journal-mismatch', [
    { timecode_seconds: atSlot(base, base.slots[3].slot_id), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate.' },
  ], { estate: base });
  planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  const paths = executor.revisionPaths(estate.runDir, 2);
  writeJson(paths.journal, { schema: executor.JOURNAL_SCHEMA, plan_id: 'other-plan', plan_digest_sha256: 'f'.repeat(64), state: 'IN_PROGRESS', steps: {}, work: {} });
  await rejectCode(() => executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) }), 'DRAFT_REVISION_JOURNAL_PLAN_MISMATCH');
});

/* ── successor identity, immutability and lineage ────────────────────────── */

test('DRS23 the successor records exactly what changed and preserves every predecessor authority', async () => {
  const base = draftEstate('lineage');
  const targetSlot = base.slots[13].slot_id;
  const estate = await reviewedEstate('lineage', [
    { timecode_seconds: atSlot(base, targetSlot), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'VISUAL_CONCEPT', comment: 'New concept for this beat.' },
  ], { estate: base });
  const before = {
    draft: shaFile(path.join(base.runDir, directed.ASSEMBLY_DIR, 'directed-draft-r1.mp4')),
    plan: shaFile(base.planPath),
    assets: base.assets.map((asset) => shaFile(asset.path)),
    narration: shaFile(base.narrationPath),
    music: shaFile(base.musicPath),
  };
  const reviewSha = shaFile(review.reviewFile(estate.runDir, estate.reviewId));
  const { result } = await runRevision(estate);
  // predecessor draft bytes, review, plan, narration, music and every unaffected
  // asset are byte-identical after the revision
  assert.equal(shaFile(path.join(base.runDir, directed.ASSEMBLY_DIR, 'directed-draft-r1.mp4')), before.draft);
  assert.equal(shaFile(review.reviewFile(estate.runDir, estate.reviewId)), reviewSha);
  assert.equal(shaFile(base.planPath), before.plan);
  assert.equal(shaFile(base.narrationPath), before.narration);
  assert.equal(shaFile(base.musicPath), before.music);
  base.assets.forEach((asset, index) => {
    if (asset.asset_id === targetSlot) return;
    assert.equal(shaFile(asset.path), before.assets[index], `${asset.asset_id} must be untouched`);
  });
  // the successor answers "exactly what changed between R2 and R3?"
  const successor = result.successor;
  assert.equal(successor.predecessor.draft_version, 1);
  assert.equal(successor.predecessor.review_id, estate.reviewId);
  assert.equal(successor.predecessor.output_sha256, before.draft);
  assert.equal(successor.revision_plan.plan_digest_sha256, result.successor.revision_plan.plan_digest_sha256);
  assert.notEqual(successor.successor_draft.output_sha256, before.draft);
  assert.equal(successor.successor_draft.evidence_state, 'VERIFIED');
  assert.deepEqual(successor.authority, { publication_authority: false, final_asset_authority: false, production_authority: false, completes_rough_cut_gate: false });
  // the run is review-ready again with NO review for the successor
  const view = review.promotionDecisionView(estate.runDir);
  assert.equal(view.current_draft.draft_version, 2);
  assert.equal(view.current_review, null, 'the r1 review does not carry over to r2');
  assert.equal(view.review_state, 'DRAFT_REVIEW_READY');
  assert.equal(view.decision.publication_ready, false);
  assert.equal(view.decision.final_production_locked, false);
  assert.ok(view.historical_reviews.some((item) => item.review_id === estate.reviewId), 'the r1 review stays inspectable history');
});

test('DRS24 R3 is reviewable and revisable again: the lineage chains without loops', async () => {
  const base = draftEstate('chain');
  const firstSlot = base.slots[6].slot_id;
  const estate = await reviewedEstate('chain', [
    { timecode_seconds: atSlot(base, firstSlot), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate this still.' },
  ], { estate: base });
  const first = await runRevision(estate);
  assert.equal(first.result.successor.successor_draft.draft_version, 2);
  // review r2 and revise again -> r3
  const subject2 = subjects.resolveReviewSubject(estate.runDir);
  assert.equal(subject2.draft_version, 2);
  const secondSlot = base.slots[16].slot_id;
  review.openReview(estate.runDir, { reviewId: 'mikko-r2', reviewer: 'mikko', reviewerAuthority: 'HUMAN:Mikko Pakkala' });
  const beat = readJson(executor.revisionPaths(estate.runDir, 2).composition).beats.find((item) => item.beat_id === secondSlot);
  review.addNote(estate.runDir, 'mikko-r2', { timecode_seconds: (beat.start_ms + 100) / 1000, disposition: 'CHANGE', target_domain: 'MUSIC', music_dimension: 'MUSIC_EXECUTION', comment: 'Second-round music note.' });
  review.submitReview(estate.runDir, 'mikko-r2', { overallComment: 'r2 round.' });
  const spy = {};
  const secondPlan = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.equal(secondPlan.plan.target_draft_version, 3);
  assert.equal(secondPlan.plan.predecessor_draft.draft_version, 2);
  const secondResult = await executor.executeRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root, adapters: adapters(estate, spy), handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) });
  assert.equal(secondResult.state, 'REVISION_COMPLETE');
  assert.equal(secondResult.successor.successor_draft.draft_version, 3);
  assert.equal(secondResult.successor.census.music, 'REGENERATED');
  assert.equal(secondResult.successor.census.visual_regenerated, 0);
  assert.equal(spy.music, 1);
  // both historical drafts remain inspectable
  assert.ok(fs.existsSync(path.join(estate.runDir, directed.ASSEMBLY_DIR, 'directed-draft-r1.mp4')));
  assert.ok(fs.existsSync(path.join(estate.runDir, directed.ASSEMBLY_DIR, 'directed-draft-r2.mp4')));
  assert.ok(fs.existsSync(path.join(estate.runDir, directed.ASSEMBLY_DIR, 'directed-draft-r3.mp4')));
});

/* ── determinism, projection and cost ───────────────────────────────────── */

test('DRS25 revision planning is deterministic for identical inputs', async () => {
  const notes = (estate) => [
    { timecode_seconds: atSlot(estate, estate.slots[1].slot_id), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'VISUAL_CONCEPT', comment: 'Deterministic note A.' },
    { timecode_seconds: atSection(estate, 'S04'), disposition: 'CHANGE', target_domain: 'PACING', comment: 'Deterministic note B.' },
  ];
  // two independently built estates with identical review shapes must plan identically
  const first = draftEstate('determinism-1');
  const firstEstate = await reviewedEstate('determinism-1', notes(first), { estate: first });
  const second = draftEstate('determinism-2');
  const secondEstate = await reviewedEstate('determinism-2', notes(second), { estate: second });
  const planA = planner.buildRevisionPlan(firstEstate.runDir, { scriptBuilderRoot: firstEstate.story.root, now: '2026-09-01T10:00:00.000Z' }).plan;
  const planB = planner.buildRevisionPlan(secondEstate.runDir, { scriptBuilderRoot: secondEstate.story.root, now: '2026-09-01T10:00:00.000Z' }).plan;
  const shape = (plan) => plan.work_items.map((item) => ({ kind: item.kind, domain: item.domain, scope: item.regeneration_scope, section: item.target.section_id, blocking: item.execution_blocking }));
  assert.deepEqual(shape(planA), shape(planB));
  assert.deepEqual(planA.reuse_census.sections, planB.reuse_census.sections);
  assert.equal(planA.determinism.routing.startsWith('DETERMINISTIC'), true);
});

test('DRS26 NO_FEEDBACK is never promoted to EXPLICIT_KEEP', async () => {
  const base = draftEstate('no-feedback');
  const estate = await reviewedEstate('no-feedback', [
    { timecode_seconds: atSection(base, 'S01'), disposition: 'KEEP', target_domain: 'VISUAL', visual_dimension: 'VISUAL_CONCEPT', comment: 'S01 is right.' },
    { timecode_seconds: atSlot(base, base.slots[8].slot_id), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate this.' },
  ], { estate: base });
  const planned = planner.buildRevisionPlan(estate.runDir, { scriptBuilderRoot: estate.story.root });
  const census = planned.plan.reuse_census.sections;
  assert.ok(census.explicit_keep.includes('S01'));
  assert.ok(census.no_feedback.length >= 1);
  assert.equal(census.explicit_keep.some((id) => census.no_feedback.includes(id)), false);
  assert.match(planned.plan.reuse_census.no_feedback_policy, /never promoted to EXPLICIT_KEEP/);
  // both are reused, but they are reported by their true name
  const input = review.revisionPlanInput(estate.runDir, estate.reviewId);
  assert.equal(input.sections.find((section) => section.section_id === 'S01').feedback_state, 'EXPLICIT_KEEP');
  assert.ok(input.sections.some((section) => section.feedback_state === 'NO_FEEDBACK'));
});

test('DRS27 revision state is a projection over existing run state, and cost metrics prove the economics', async () => {
  const base = draftEstate('projection');
  // before any review: review-ready, no revision
  assert.equal(planner.revisionStatus(base.runDir).state, 'NO_CURRENT_DRAFT');
  await renderDraft(base);
  assert.equal(planner.revisionStatus(base.runDir).state, 'DRAFT_REVIEW_READY_AWAITING_HUMAN_REVIEW');
  const targetSlot = base.slots[15].slot_id;
  review.openReview(base.runDir, { reviewId: 'mikko-r1', reviewer: 'mikko', reviewerAuthority: 'HUMAN:Mikko Pakkala' });
  review.addNote(base.runDir, 'mikko-r1', { timecode_seconds: atSlot(base, targetSlot), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate.' });
  review.submitReview(base.runDir, 'mikko-r1', { overallComment: 'Projection round.' });
  assert.equal(planner.revisionStatus(base.runDir).state, 'REVIEW_SUBMITTED_NO_REVISION_PLAN');
  planner.buildRevisionPlan(base.runDir, { scriptBuilderRoot: base.story.root });
  assert.equal(planner.revisionStatus(base.runDir).state, 'REVISION_PLAN_READY');
  const spy = {};
  const result = await executor.executeRevisionPlan(base.runDir, { scriptBuilderRoot: base.story.root, adapters: adapters(base, spy), handoffOptions: base.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) });
  assert.equal(result.state, 'REVISION_COMPLETE');
  const after = planner.revisionStatus(base.runDir);
  assert.equal(after.state, 'DRAFT_REVIEW_READY_AWAITING_HUMAN_REVIEW', 'the successor returns the run to awaiting human review');
  assert.equal(after.publication_ready, false);
  // no duplicate global production-state authority was created
  assert.equal(fs.existsSync(path.join(base.runDir, 'final-production-lock.json')), false);
  // cost metrics: 1 of 20 regenerated
  const metrics = result.metrics;
  assert.equal(metrics.census.visual_regenerated, 1);
  assert.equal(metrics.census.visual_preserved, TOTAL_SLOTS - 1);
  assert.match(metrics.economics_note, /preserved 19 visual assets, regenerated 1/);
  assert.ok(Number.isFinite(metrics.total_wall_clock_ms));
});

test('DRS28 the review authority is reused verbatim: no second review schema or vocabulary', () => {
  // the planner consumes draftReview.v2 and its canonical revisionPlanInput
  assert.equal(review.REVIEW_SCHEMA, 'vidtoolz.draftReview.v2');
  assert.deepEqual(review.DISPOSITIONS, ['KEEP', 'CHANGE', 'CUT', 'REWRITE']);
  assert.deepEqual(review.VISUAL_REVIEW_DIMENSIONS, ['VISUAL_CONCEPT', 'IMAGE_EXECUTION']);
  assert.deepEqual(review.MUSIC_REVIEW_DIMENSIONS, ['MUSIC_CONCEPT', 'MUSIC_EXECUTION']);
  // the revision plan is a NEW downstream authority, not a new review authority
  assert.equal(planner.PLAN_SCHEMA, 'vidtoolz.draftRevisionPlan.v1');
  assert.deepEqual(planner.WORK_DOMAINS, ['SCRIPT', 'VISUAL', 'MUSIC', 'EDIT_PACING', 'NARRATION']);
  // every review target domain routes to exactly one canonical work domain
  for (const domain of review.TARGET_DOMAINS) {
    if (['OTHER'].includes(domain)) { assert.equal(planner.DOMAIN_MAP[domain], undefined); continue; }
    assert.ok(planner.WORK_DOMAINS.includes(planner.DOMAIN_MAP[domain]), `${domain} must route`);
  }
});

/* ── §46 Hermes operability + adapter wiring contract ────────────────────── */

const reviseDraft = require('../scripts/revise-draft.js');
const liveAdapters = require('../scripts/draft-revision-adapters.js');

test('DRS29 revise-draft resolves everything itself: no review JSON, asset paths or schemas from the caller', async () => {
  const base = draftEstate('cli');
  const targetSlot = base.slots[10].slot_id;
  const estate = await reviewedEstate('cli', [
    { timecode_seconds: atSlot(base, targetSlot), disposition: 'CHANGE', target_domain: 'VISUAL', visual_dimension: 'IMAGE_EXECUTION', comment: 'Regenerate this still.' },
  ], { estate: base });
  // status before planning
  const status = await reviseDraft.reviseDraft(['--run-id', estate.runId, '--repo', estate.repo, '--status']);
  assert.equal(status.state, 'REVIEW_SUBMITTED_NO_REVISION_PLAN');
  // plan-only
  const planOnly = await reviseDraft.reviseDraft(['--run-id', estate.runId, '--repo', estate.repo, '--plan-only']);
  assert.equal(planOnly.decision, 'REVISION_REQUIRED');
  assert.equal(planOnly.target_draft_version, 2);
  assert.deepEqual(planOnly.work_items.map((item) => item.kind), ['VISUAL_EXECUTION_REGENERATION']);
  assert.equal(planOnly.executed, null);
  // full revision through the entry point, with adapters injected the way the
  // live wiring injects them (the CLI never takes a media path)
  const spy = {};
  const result = await reviseDraft.reviseDraft(['--run-id', estate.runId, '--repo', estate.repo], {
    adapters: adapters(estate, spy),
    executorOptions: { scriptBuilderRoot: estate.story.root, handoffOptions: estate.handoffOptions, renderFromSpec: async (p) => fakeRenderFromSpec(p) },
  });
  assert.equal(result.executed.state, 'REVISION_COMPLETE');
  assert.equal(result.executed.census.visual_regenerated, 1);
  assert.equal(result.executed.census.visual_preserved, TOTAL_SLOTS - 1);
  assert.equal(result.executed.successor_draft.draft_version, 2);
  assert.deepEqual(spy.stills, [targetSlot]);
  // the CLI reports its own adapter wiring honestly
  assert.equal(result.executed.adapter_wiring.live_proven, false);
  errorCode(() => reviseDraft.parseArgs([]), 'REVISE_DRAFT_ARGUMENT_INVALID');
  errorCode(() => reviseDraft.parseArgs(['--media-path', '/tmp/x']), 'REVISE_DRAFT_ARGUMENT_INVALID');
});

test('DRS30 the live still adapter calls the canonical Generation Supervisor with a policy-valid task', async () => {
  const base = draftEstate('adapter-wiring');
  const slot = base.plan.draft_bespoke_still_policy.slots[0];
  const calls = [];
  const still = liveAdapters.visualStillAdapter({
    supervisor: { async run(task) {
      calls.push(task);
      const file = path.join(base.runDir, 'media', 'adapter-still.png');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'supervisor output bytes');
      return { state: 'COMPLETE', outputs: [{ path: file, sha256: shaFile(file) }], generator_id: 'canonical-flux' };
    } },
    inspectImage: () => ({ width: 1080, height: 1920 }),
  });
  const produced = await still({ runDir: base.runDir, plan: base.plan, slot, outputDir: path.join(base.runDir, 'media') });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].slot.slot_id, slot.slot_id);
  assert.equal(calls[0].package_run_id, base.runId);
  assert.equal(produced.generator_id, 'canonical-flux');
  assert.equal(produced.width, 1080);
  // a supervisor that does not complete is a typed failure, never a silent skip
  const failing = liveAdapters.visualStillAdapter({ supervisor: { async run() { return { state: 'FAILED', reason: 'model unavailable' }; } } });
  await rejectCode(() => failing({ runDir: base.runDir, plan: base.plan, slot, outputDir: base.runDir }), 'DRAFT_REVISION_STILL_GENERATION_FAILED');
});

test('DRS31 the live music adapter drives the Stable-Audio-first department with explicit script text', async () => {
  const base = draftEstate('adapter-music');
  const seen = [];
  const music = liveAdapters.musicAdapter({
    orchestrator: { async generateDraftMusic(input) {
      seen.push(input);
      const file = path.join(base.runDir, 'media', 'adapter-music.wav');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'department music bytes');
      return { state: 'COMPLETE', package: { routing_policy: 'STABLE_AUDIO_FIRST', selection_mode: 'NORMAL_USABLE', draft_selected_music: { candidate_id: 'draft-music-a', output_path: file, output_sha256: shaFile(file) }, candidates: [{ candidate_id: 'draft-music-a', qc: { duration_s: 180 } }] } };
    } },
  });
  const produced = await music({ runDir: base.runDir, scriptText: 'Exact successor script text.', outputDir: path.join(base.runDir, 'media') });
  assert.equal(seen[0].scriptText, 'Exact successor script text.');
  assert.equal(seen[0].runId, base.runId);
  assert.equal(produced.duration_ms, 180000);
  assert.match(produced.basis, /STABLE_AUDIO_FIRST/);
  // the department is the coherence/usability authority: no usable selection is a typed refusal
  const empty = liveAdapters.musicAdapter({ orchestrator: { async generateDraftMusic() { return { state: 'NO_USABLE_DRAFT_MUSIC', package: { no_usable_draft_music: true } }; } } });
  await rejectCode(() => empty({ runDir: base.runDir, scriptText: 'x'.repeat(50), outputDir: base.runDir }), 'DRAFT_REVISION_MUSIC_NO_USABLE_SELECTION');
  await rejectCode(() => music({ runDir: base.runDir, scriptText: '', outputDir: base.runDir }), 'DRAFT_REVISION_MUSIC_SCRIPT_REQUIRED');
});

test('DRS32 unwired domains refuse with their exact open doctrine question, never a guess', async () => {
  const wiring = liveAdapters.wiringReport();
  assert.deepEqual(wiring.wired, ['visual.generateStill', 'music.generateDraftMusic']);
  assert.equal(wiring.live_proven, false);
  assert.match(wiring.unwired['narration.generateNarration'], /BLOCKED_ON_DOCTRINE/);
  assert.match(wiring.unwired['narration.generateNarration'], /run-rebinding vs an explicit story-override/);
  assert.match(wiring.unwired['visual.reviseSlot'], /BLOCKED_ON_AUTHORING_PATH/);
  const set = liveAdapters.liveAdapters();
  await rejectCode(() => set.narration.generateNarration({}), 'DRAFT_REVISION_ADAPTER_NOT_WIRED');
  await rejectCode(() => set.visual.reviseSlot({}), 'DRAFT_REVISION_ADAPTER_NOT_WIRED');
  assert.equal(typeof set.visual.generateStill, 'function');
  assert.equal(typeof set.music.generateDraftMusic, 'function');
});

module.exports = { tests: require('./_helpers.js').tests, draftEstate, reviewedEstate, fakeRenderFromSpec, adapters };
