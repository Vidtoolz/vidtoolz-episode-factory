'use strict';

const { assert, fs, os, path, test } = require('./_helpers.js');
const childProcess = require('node:child_process');
const vp = require('../scripts/visual-plan.js');
const director = require('../scripts/visual-planning-director.js');
const policy = require('../scripts/draft-bespoke-still-policy.js');
const supervisor = require('../scripts/generation-supervisor.js');
const composition = require('../scripts/production-assembly-composition.js');
const canaryRunner = require('../scripts/package-run-draft-bespoke-stills.js');
const taskAssembler = require('../scripts/agent-task-visual-planning.js');
const productionMode = require('../scripts/package-run-production-mode.js');

function clone(value) { return structuredClone(value); }
function errorCode(fn, code) { assert.throws(fn, (error) => error.code === code); }

function planningFixture(count = 20, overrides = {}) {
  const sections = Array.from({ length: count }, (_, index) => ({
    section_id: `S${String(index + 1).padStart(2, '0')}`,
    order: index + 1,
    dialogue: `Exact script line ${index + 1}: a creator tests visual concept ${index + 1} against the approved story.`,
  }));
  const contentHash = vp.sha256(JSON.stringify(sections));
  const requiredBeats = sections.map((section, index) => ({
    canonical_beat_id: vp.newBeatId(), section_id: section.section_id, aliases: [], source_provenance: null,
    edit_placement: `section ${index + 1}`, priority: 'NORMAL',
  }));
  const task = {
    task_id: 'draft-bespoke-plan-fixture', action: 'plan_visuals', requested_by: 'hermes',
    project_id: 'draft-bespoke-fixture', package_run_id: 'draft-bespoke-fixture-run', run_dir: '/fixture/draft-bespoke-fixture-run',
    production_grammar: director.DRAFT_BESPOKE_STILL_GRAMMAR,
    story: {
      project_id: 'draft-bespoke-fixture', version_id: 'story-v1', content_hash: contentHash,
      approval: { state: 'approved', approved_by: 'TEST_HUMAN', approved_at: '2026-08-31T00:00:00Z', version_id: 'story-v1', content_hash: contentHash },
      central_claim: 'Draft visual ideas should be cheap and reviewable.', narrative_spine: 'problem-policy-proof', sections,
    },
    required_beats: requiredBeats, research: { bindings_doc: { bindings: [] }, current_result_refs: [], required_constraint_ids: [], authority_by_binding: {} },
    output_target: { aspect_ratio: '9:16', orientation: 'vertical', duration_seconds: 210 },
    privacy: { local_only: true }, retry_budget: 2, cost_budget: { max_model_calls: 2 },
    ...overrides.task,
  };
  const roles = policy.VISUAL_ROLES;
  const semantic = {
    beats: requiredBeats.map((beat, index) => ({
      canonical_beat_id: beat.canonical_beat_id, coverage_decision: 'PLAN_SHOTS', no_visual_reason: null,
      shots: [{
        visual_purpose: `test script-specific visual idea ${index + 1}`,
        narrative_function: `clarify exact script claim ${index + 1}`,
        media_type: 'GENERATED_STILL', generation_mode: 'STILL',
        subject: `distinct physical subject ${index + 1} representing the exact spoken claim`,
        shot_brief: `A distinct vertical editorial still number ${index + 1}, showing exact subject ${index + 1} with clear foreground and background separation.`,
        why_it_serves_story: `Makes exact script concept ${index + 1} visually testable.`,
        presenter_relation: 'NONE', duration_target_s: 10.5, research_sensitive: false,
        research_binding_ids: [], required_constraint_ids: [], visual_assertion: null,
        camera_required: false, camera_intent: null, continuity_notes: [], alternatives: [], priority: 'NORMAL',
        demonstration: null, input_artifact_refs: [], quality_constraints: ['no readable generated text'],
        candidate_count_request: 1, visual_role: roles[index % roles.length], repetition_rationale: null,
      }],
    })),
    coverage_findings: [], continuity_findings: [], redundancy_findings: [], human_attention: [],
    recommendation: 'PLAN_READY', slot_count_rationale: overrides.rationale ?? null,
  };
  if (overrides.semantic) Object.assign(semantic, overrides.semantic);
  return { task, semantic };
}

function buildPlan(count = 20, overrides = {}) {
  const fixture = planningFixture(count, overrides);
  const checked = director.validateSemanticOutput(fixture.semantic, fixture.task);
  assert.equal(checked.ok, true, checked.errors.join('; '));
  const plan = director.writePlan(fixture.task, fixture.semantic, { visualPlanWallClockMs: 37, now: '2026-08-31T00:00:00Z' });
  const validation = vp.validatePlan(plan);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  return { ...fixture, plan };
}

function mutatePlan(plan, mutation) {
  const changed = clone(plan); mutation(changed); changed.plan_digest_sha256 = vp.planDigest(changed); return changed;
}

function runEstate(plan, slotIndex = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-bespoke-estate-'));
  const runId = `fixture-draft-bespoke-${slotIndex}-${Date.now()}`;
  const runDir = path.join(root, runId); fs.mkdirSync(runDir, { recursive: true });
  const base = { task_id: 'fixture-plan', project_id: 'draft-bespoke-fixture', package_run_id: runId, run_dir: runDir };
  return { root, runId, runDir, task: policy.generationTaskForSlot(base, plan, plan.draft_bespoke_still_policy.slots[slotIndex]) };
}

function successfulGenerator(label = 'one', assessment = null) {
  return async (context) => {
    fs.mkdirSync(context.attempt_dir, { recursive: true });
    const output = path.join(context.attempt_dir, 'output.png');
    fs.writeFileSync(output, `synthetic image bytes ${label} ${context.slot.slot_id} ${context.attempt_number}`);
    return { generator_id: 'fixture-flux', outputs: [output], ...(assessment ? { creative_assessment: assessment } : {}) };
  };
}
const inspectOkay = () => ({ ok: true, width: 720, height: 1280, codec: 'png' });

function compositionFixture(assetPath = '/fixture/static.png') {
  const asset = {
    asset_id: 'draft-still-001', slot_id: 'draft-still-001', path: assetPath, sha256: 'a'.repeat(64),
    width: 720, height: 1280, media_kind: 'IMAGE', asset_class: policy.ASSET_CLASS,
    source_attempt_id: 'draft-still-001-attempt-1', script_binding: { section_id: 'S01' },
    prompt_id: 'prompt-fixture', prompt_sha256: 'b'.repeat(64), publication_authority: false, final_asset_authority: false,
  };
  const beat = policy.editorBeatFor({ slot_id: 'draft-still-001', motion_policy: 'NONE', camera_motion: 'NOT_APPLICABLE' }, asset.asset_id,
    { beat_id: 'B1', section_id: 'S01', start_ms: 0, end_ms: 300, width: 1080, height: 1920 });
  const manifest = { schema: composition.ASSET_MANIFEST_SCHEMA, run_id: 'fixture-run', assets: [policy.productionAssetRecord(asset, ['B1'])] };
  const model = {
    schema: composition.SCHEMA,
    design_package: { path: '/design.json', sha256: 'c'.repeat(64), schema: 'vidtoolz.productionAssemblySpec.v2' },
    approved_visual_plan: { path: '/plan.json', file_sha256: 'd'.repeat(64), plan_id: 'plan-fixture', digest_sha256: 'e'.repeat(64) },
    asset_manifest: { path: '/assets.json', sha256: 'f'.repeat(64) }, coverage: 'FULL_PROGRAMME', expected_beat_count: 1,
    forbidden_asset_ids: [], beats: [beat],
  };
  const timeline = [{ section_id: 'S01', in_ms: 0, out_ms: 300, programme_in_ms: 0, programme_out_ms: 300, script_beat_ids: ['B1'], presenter_authority: 'NOT_APPLICABLE' }];
  const output = { width: 1080, height: 1920, fps: 30 };
  return { asset, beat, manifest, model, timeline, output };
}

test('DBS01 normal 3–4 minute Visual Plan produces approximately 20 slots', () => {
  const { plan } = buildPlan(); assert.equal(plan.draft_bespoke_still_policy.planned_visual_slots, 20); assert.deepEqual(plan.draft_bespoke_still_policy.target_tolerance, { min: 16, max: 24 });
});
test('DBS02 every slot binds exact Story text, section, beat, and canonical prompt', () => {
  const { plan } = buildPlan(); for (const slot of plan.draft_bespoke_still_policy.slots) { assert.ok(slot.script_binding.source_text); assert.match(slot.script_binding.source_text_sha256, /^[a-f0-9]{64}$/); assert.ok(slot.script_binding.canonical_beat_ids.length); assert.ok(slot.prompt_id); assert.match(slot.prompt_sha256, /^[a-f0-9]{64}$/); }
});
test('DBS03 one slot may cover its canonical interval while remaining one distinct role', () => { const { plan } = buildPlan(); assert.equal(plan.draft_bespoke_still_policy.slots[0].expected_timeline.duration_ms, 10500); assert.ok(policy.VISUAL_ROLES.includes(plan.draft_bespoke_still_policy.slots[0].visual_role)); });
test('DBS04 short/out-of-band plans require machine-readable bounded rationale', () => { const f = planningFixture(12); assert.equal(director.validateSemanticOutput(f.semantic, f.task).ok, false); const good = planningFixture(12, { rationale: 'The short fixture has twelve discrete script concepts and no filler intervals.' }); assert.equal(director.validateSemanticOutput(good.semantic, good.task).ok, true); });
test('DBS05 forty or more slots are rejected regardless of rationale', () => { const f = planningFixture(40, { rationale: 'Dense explanation has many roles but must still remain bounded.' }); assert.equal(director.validateSemanticOutput(f.semantic, f.task).ok, false); });
test('DBS06 generic or unbound slots fail typed validation', () => { const { plan } = buildPlan(); const changed = mutatePlan(plan, (p) => { p.draft_bespoke_still_policy.slots[0].script_specific = false; }); assert.ok(vp.validatePlan(changed).reason_codes.includes('DRAFT_STILL_GENERIC_VISUAL_FORBIDDEN')); });
test('DBS07 missing script source binding fails typed validation', () => { const { plan } = buildPlan(); const changed = mutatePlan(plan, (p) => { p.draft_bespoke_still_policy.slots[0].script_binding.source_text = ''; }); assert.ok(vp.validatePlan(changed).reason_codes.includes('DRAFT_STILL_SCRIPT_BINDING_INVALID')); });
test('DBS08 multiple normal candidates fail typed validation', () => { const { plan } = buildPlan(); const changed = mutatePlan(plan, (p) => { p.shots[0].generation_requirements.candidate_count_request = 4; p.prompts[0].shot_intent_digest_sha256 = vp.shotIntentDigest(p.shots[0]); }); assert.ok(vp.validatePlan(changed).reason_codes.includes('DRAFT_STILL_GENERATION_REQUIREMENTS_INVALID')); });
test('DBS09 Generated Video, I2V, and temporal Camera requests fail before generation', () => { const f = planningFixture(); Object.assign(f.semantic.beats[0].shots[0], { media_type: 'GENERATED_VIDEO', generation_mode: 'IMAGE_TO_VIDEO', input_artifact_refs: ['image'], camera_required: true, camera_intent: { subject: 'x', purpose: 'y' } }); const result = director.validateSemanticOutput(f.semantic, f.task); assert.equal(result.ok, false); assert.match(result.errors.join(' '), /media only|camera motion forbidden|input media forbidden/); });
test('DBS10 static infographic is legal under the same one-shot class', () => { const f = planningFixture(); Object.assign(f.semantic.beats[0].shots[0], { media_type: 'INFOGRAPHIC', generation_mode: 'NOT_APPLICABLE', visual_role: 'INFOGRAPHIC' }); assert.equal(director.validateSemanticOutput(f.semantic, f.task).ok, true); const plan = director.writePlan(f.task, f.semantic, { visualPlanWallClockMs: 1 }); assert.equal(plan.draft_bespoke_still_policy.slots[0].motion_policy, 'NONE'); });

test('DBS11 Generation Supervisor dispatches one registered script-bound still', async () => { const { plan } = buildPlan(); const e = runEstate(plan); const status = await supervisor.run(e.task, { generateDraftBespokeStill: successfulGenerator(), inspectDraftBespokeStill: inspectOkay }); assert.equal(status.state, 'COMPLETE'); assert.equal(status.attempts, 1); assert.equal(status.outputs.length, 1); assert.equal(status.outputs[0].publication_authority, false); assert.equal(status.outputs[0].final_asset_authority, false); });
test('DBS12 successful first attempt stops with immutable provenance', async () => { const { plan } = buildPlan(); const e = runEstate(plan); const out = await policy.executeSlot(e.task, { generate: successfulGenerator(), inspectImage: inspectOkay }); assert.equal(out.registry.attempts.length, 1); assert.equal(out.attempt.attempt_kind, 'NORMAL'); assert.equal(out.attempt.status, 'SUCCEEDED'); assert.ok(fs.existsSync(path.join(policy.evidencePaths(e.runDir).attempts, out.attempt.attempt_id, 'attempt.json'))); });
test('DBS13 genuine technical failure permits exactly one linked replacement', async () => { const { plan } = buildPlan(); const e = runEstate(plan); const generate = async (context) => context.attempt_number === 1 ? { generator_id: 'fixture-flux', outputs: [path.join(context.attempt_dir, 'missing.png')] } : successfulGenerator('replacement')(context); const out = await policy.executeSlot(e.task, { generate, inspectImage: inspectOkay }); assert.equal(out.state, 'COMPLETE'); assert.equal(out.registry.attempts.length, 2); assert.equal(out.registry.attempts[0].status, 'TECHNICAL_FAILURE'); assert.match(out.registry.attempts[0].output.path, /missing\.png$/); assert.equal(out.registry.attempts[1].replaces_attempt_id, out.registry.attempts[0].attempt_id); });
test('DBS14 creative weakness is recorded and never retried automatically', async () => { const { plan } = buildPlan(); const e = runEstate(plan); const out = await policy.executeSlot(e.task, { generate: successfulGenerator('weak', 'CREATIVE_WEAKNESS'), inspectImage: inspectOkay }); assert.equal(out.registry.attempts.length, 1); assert.equal(out.metrics.creative_weakness_count, 1); });
test('DBS15 artistic retry and caller-fabricated technical failure fields are rejected', () => { const { plan } = buildPlan(); const e = runEstate(plan); for (const field of ['retry_reason', 'technical_failure', 'candidate_count']) { const task = clone(e.task); task[field] = field === 'candidate_count' ? 2 : 'CREATIVE_WEAKNESS'; errorCode(() => policy.validateGenerationTask(task), 'DRAFT_STILL_TASK_FIELD_FORBIDDEN'); } });
test('DBS16 multiple generated candidates are a policy violation', async () => { const { plan } = buildPlan(); const e = runEstate(plan); const result = await supervisor.run(e.task, { generateDraftBespokeStill: async (context) => { fs.mkdirSync(context.attempt_dir, { recursive: true }); const a = path.join(context.attempt_dir, 'a.png'); const b = path.join(context.attempt_dir, 'b.png'); fs.writeFileSync(a, 'a'); fs.writeFileSync(b, 'b'); return { generator_id: 'fixture-flux', outputs: [a, b] }; }, inspectDraftBespokeStill: inspectOkay }); assert.equal(result.state, 'OUTPUT_INVALID'); assert.match(result.reason, /MULTIPLE_CANDIDATES_FORBIDDEN/); });
test('DBS17 I2V or Kling generator identity cannot enter Draft still dispatch', async () => { const { plan } = buildPlan(); for (const generatorId of ['kling-v2', 'image-to-video']) { const e = runEstate(plan); const result = await supervisor.run(e.task, { generateDraftBespokeStill: async (context) => { fs.mkdirSync(context.attempt_dir, { recursive: true }); const output = path.join(context.attempt_dir, 'output.png'); fs.writeFileSync(output, 'x'); return { generator_id: generatorId, outputs: [output] }; }, inspectDraftBespokeStill: inspectOkay }); assert.equal(result.state, 'OUTPUT_INVALID'); assert.match(result.reason, /VIDEO_DISPATCH_FORBIDDEN/); } });
test('DBS18 caller cannot set publication, final-asset, video, or engine authority', () => { const { plan } = buildPlan(); const e = runEstate(plan); for (const field of ['publication_authority', 'final_asset_authority', 'i2v_prompt', 'generator_id']) { const task = clone(e.task); task[field] = true; errorCode(() => policy.validateGenerationTask(task), 'DRAFT_STILL_TASK_FIELD_FORBIDDEN'); } });
test('DBS19 throughput evidence records and finalizes all required pipeline timings', async () => { const { plan } = buildPlan(); const e = runEstate(plan); const out = await policy.executeSlot(e.task, { generate: successfulGenerator(), inspectImage: inspectOkay }); for (const field of ['planned_still_count', 'generated_still_count', 'first_attempt_success_count', 'technical_failure_count', 'retry_count', 'creative_weakness_count', 'per_image_generation_wall_clock_ms', 'total_image_generation_wall_clock_ms', 'approved_script_at', 'visual_plan_wall_clock_ms', 'draft_visual_production_wall_clock_ms', 'editor_render_wall_clock_ms', 'draft_review_ready_at', 'approved_script_to_draft_review_ready_wall_clock_ms']) assert.ok(field in out.metrics, field); assert.equal(out.metrics.editor_render_wall_clock_ms, null); const finalized = policy.recordReviewReadyTiming(e.runDir, { editor_render_wall_clock_ms: 900, draft_review_ready_at: '2026-08-31T00:00:02Z' }); assert.equal(finalized.applicable, true); assert.equal(finalized.metrics.editor_render_wall_clock_ms, 900); assert.equal(finalized.metrics.approved_script_to_draft_review_ready_wall_clock_ms, 2000); });

test('DBS20 Editor projects fixed full-frame geometry and hard cuts', () => { const f = compositionFixture(); const result = composition.validateComposition(f.model, f.timeline, f.output, f.manifest); assert.equal(result.beats[0].transition_in, 'HARD_CUT'); assert.equal(result.beats[0].transition_out, 'HARD_CUT'); assert.equal(result.beats[0].layers[0].duration_policy, 'STILL'); assert.deepEqual(result.beats[0].layers[0].geometry, { x: 0, y: 0, width: 1080, height: 1920, anchor: 'TOP_LEFT' }); });
test('DBS21 pan, zoom, slow scale, and even redundant motion descriptors reject', () => { for (const type of ['PAN', 'ZOOM', 'SLOW_SCALE', 'STATIC']) { const f = compositionFixture(); f.model.beats[0].layers[0].motion = { type }; errorCode(() => composition.validateComposition(f.model, f.timeline, f.output, f.manifest), 'COMPOSITION_DRAFT_BESPOKE_STILL_MOTION_FORBIDDEN'); } });
test('DBS22 beat/layer reveal rejects while V4 reveal remains available to other roles', () => { const f = compositionFixture(); f.model.beats[0].reveal_contract = { mode: 'ADDITIVE_PERSIST', unrevealed_state: 'ABSENT', required_layer_ids: ['B1-still'] }; f.model.beats[0].layers[0].reveal = { mode: 'ADDITIVE_PERSIST', order: 1, start_ms: 0, end_ms: 300, licensing_anchor_id: 'anchor', licensing_phrase_onset_ms: 0 }; errorCode(() => composition.validateComposition(f.model, f.timeline, f.output, f.manifest), 'COMPOSITION_DRAFT_BESPOKE_STILL_REVEAL_FORBIDDEN'); assert.equal(composition.REVEAL_PLAN_SCHEMA, 'vidtoolz.compositionRevealPlan.v1'); });
test('DBS23 animated crop, position, scale, and opacity fields reject deterministically', () => { for (const field of ['crop_animation', 'position_animation', 'scale_animation', 'opacity_animation']) { const f = compositionFixture(); f.model.beats[0].layers[0][field] = { from: 0, to: 1 }; errorCode(() => composition.validateComposition(f.model, f.timeline, f.output, f.manifest), 'COMPOSITION_UNKNOWN_FIELD'); } });
test('DBS24 geometry ramps and cinematic transitions reject before rendering', () => { const ramp = compositionFixture(); ramp.model.beats[0].layers[0].geometry.ramp = { curve: 'LINEAR', end: { x: 0, y: 0, width: 1080, height: 1920 } }; errorCode(() => composition.validateComposition(ramp.model, ramp.timeline, ramp.output, ramp.manifest), 'COMPOSITION_DRAFT_BESPOKE_STILL_GEOMETRY_ANIMATION_FORBIDDEN'); const dissolve = compositionFixture(); dissolve.model.beats[0].transition_in = 'DISSOLVE_200MS'; errorCode(() => composition.validateComposition(dissolve.model, dissolve.timeline, dissolve.output, dissolve.manifest), 'COMPOSITION_DRAFT_BESPOKE_STILL_TRANSITION_FORBIDDEN'); });
test('DBS25 generated-video binding and caller-provided final authority reject', () => { const video = compositionFixture(); video.manifest.assets[0].media_kind = 'VIDEO'; video.manifest.assets[0].duration_ms = 300; errorCode(() => composition.validateComposition(video.model, video.timeline, video.output, video.manifest), 'COMPOSITION_DRAFT_BESPOKE_STILL_AUTHORITY_INVALID'); const finalAsset = compositionFixture(); finalAsset.manifest.assets[0].provenance.final_asset_authority = true; errorCode(() => composition.validateComposition(finalAsset.model, finalAsset.timeline, finalAsset.output, finalAsset.manifest), 'COMPOSITION_DRAFT_BESPOKE_STILL_AUTHORITY_INVALID'); });
test('DBS26 post-Visual-Plan motion injection is rejected by assembly authority', () => { const f = compositionFixture(); f.model.beats[0].layers[0].motion = { type: 'SLOW_SCALE', start_scale_milli: 1000, end_scale_milli: 1050 }; errorCode(() => composition.validateComposition(f.model, f.timeline, f.output, f.manifest), 'COMPOSITION_DRAFT_BESPOKE_STILL_MOTION_FORBIDDEN'); });
test('DBS27 transform-plan samples prove geometry(t0) equals geometry(t1)', () => { const evidence = policy.staticGeometryEvidence(compositionFixture().beat); assert.equal(evidence.stable, true); assert.equal(new Set(Object.values(evidence.geometry_digests)).size, 1); });
test('DBS28 renderer graph contains no zoompan, reveal enable, or xfade for bespoke stills', () => { const f = compositionFixture(); const validated = composition.validateComposition(f.model, f.timeline, f.output, f.manifest); const plan = { timeline: f.timeline, composition: validated, music: { policy: 'NONE' }, output: f.output }; const command = []; const filters = []; composition.buildVideoGraph(plan, command, filters); const graph = filters.join(';'); assert.doesNotMatch(graph, /zoompan|xfade|enable=/); assert.match(graph, /concat|trim/); });
test('DBS29 rendered first/middle/last frames remain pixel-identical after decode', () => {
  if (childProcess.spawnSync('ffmpeg', ['-version']).status !== 0) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-static-frame-')); const still = path.join(root, 'still.png'); const output = path.join(root, 'out.mp4');
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x345678:s=720x1280', '-frames:v', '1', still]);
  const f = compositionFixture(still); f.manifest.assets[0].sha256 = policy.sha256File(still);
  const validated = composition.validateComposition(f.model, f.timeline, f.output, f.manifest);
  const plan = { timeline: f.timeline, composition: validated, music: { policy: 'NONE' }, output: f.output };
  const command = ['-f', 'lavfi', '-i', 'color=black:s=1080x1920:r=30:d=0.3']; const filters = []; composition.buildVideoGraph(plan, command, filters);
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', ...command, '-filter_complex', filters.join(';'), '-map', '[vout]', '-t', '0.3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', output]);
  const frameMd5 = childProcess.execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'framemd5', '-'], { encoding: 'utf8' });
  const hashes = frameMd5.split('\n').filter((line) => /^0,/.test(line)).map((line) => line.split(',').at(-1).trim());
  assert.ok(hashes.length >= 9); assert.equal(hashes[0], hashes[Math.floor(hashes.length / 2)]); assert.equal(hashes[0], hashes.at(-1));
});
test('DBS30 legacy/non-bespoke motion and reveal vocabulary remains registered', () => { assert.ok(composition.DRAFT_BESPOKE_STILL_ROLE); const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'production-assembly-composition.js'), 'utf8'); assert.match(source, /SLOW_SCALE/); assert.match(source, /ADDITIVE_PERSIST/); });
test('DBS31 Draft policy does not change synthetic narration or Draft music authority', () => { const gsSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'generation-supervisor.js'), 'utf8'); assert.match(gsSource, /generate_draft_narration/); const policySource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'draft-bespoke-still-policy.js'), 'utf8'); assert.doesNotMatch(policySource, /FINAL_HUMAN_PERFORMANCE/); });
test('DBS32 real-canary runner is dry by default, sequential, and dispatches nothing', async () => { const { plan } = buildPlan(); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-bespoke-canary-dry-')); const runDir = path.join(root, 'fixture-run'); fs.mkdirSync(runDir); const planPath = path.join(root, 'visual-plan.json'); fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`); const out = await canaryRunner.run([runDir, '--visual-plan', planPath]); assert.equal(out.state, 'DRY_RUN'); assert.equal(out.planned_still_count, 20); assert.equal(out.sequential, true); assert.equal(out.estimated_image_generation_wall_clock_seconds, 1020); assert.equal(fs.existsSync(policy.evidencePaths(runDir).root), false); });
test('DBS33 Draft and Review modes select the bespoke-still grammar explicitly', () => { for (const mode of [productionMode.DRAFT, productionMode.REVIEW]) { const runDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-mode-')), `run-${mode.toLowerCase()}`); fs.mkdirSync(runDir); productionMode.setProductionMode(runDir, mode, { setBy: 'generation_supervisor (agent)' }); assert.equal(taskAssembler.productionGrammarForRun(runDir), director.DRAFT_BESPOKE_STILL_GRAMMAR); } });
test('DBS34 Final Production mode does not select or inherit Draft bespoke-still grammar', () => { const runDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'production-mode-')), 'run-production'); fs.mkdirSync(runDir); productionMode.setProductionMode(runDir, productionMode.PRODUCTION, { setBy: 'Mikko' }); assert.equal(taskAssembler.productionGrammarForRun(runDir), null); });
