'use strict';

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const childProcess = require('node:child_process');
const ep = require('../scripts/edit-plan.js');
const vp = require('../scripts/visual-plan.js');
const ptm = require('../scripts/presenter-take-manifest.js');

const NOW = '2026-08-23T15:00:00.000Z';
const H = (value) => ep.sha256(Buffer.isBuffer(value) ? value : String(value));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-plan-v1-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

function ffmpeg(args) { childProcess.execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); }
const PRESENTER_VIDEO = path.join(TMP, 'presenter.mp4');
const BROLL_VIDEO = path.join(TMP, 'broll.mp4');
const SCREEN_VIDEO = path.join(TMP, 'screen.mp4');
const MUSIC_AUDIO = path.join(TMP, 'music.wav');
const STILL_IMAGE = path.join(TMP, 'hourglass.png');
ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x222222:s=360x640:r=25:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', PRESENTER_VIDEO]);
ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x444444:s=360x640:r=25:d=3', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', BROLL_VIDEO]);
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=25:d=3', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', SCREEN_VIDEO]);
ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=9', '-c:a', 'pcm_s16le', MUSIC_AUDIO]);
ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x755b31:s=360x640', '-frames:v', '1', STILL_IMAGE]);

const STORY_HASH = H('Stop Chasing AI Speed canonical Story');
const SECTIONS = [
  { section_id: 'sec-speed', order: 1, dialogue: 'Speed multiplies output. It does nothing for value.', framing_preset: 'right-third', type: 'presenter', presenter_relation: 'PRESENT' },
  { section_id: 'sec-value', order: 2, dialogue: 'Viewers never see your speed. They see the result.', framing_preset: 'right-third', type: 'presenter', presenter_relation: 'PRESENT' },
  { section_id: 'sec-proof', order: 3, dialogue: 'One good stop beat fifty fast renders.', framing_preset: 'center-lower', type: 'composited', presenter_relation: 'PRESENT' },
];
const STORY = {
  project_id: 'project-stop-chasing', version_id: 'story-v1', content_hash: STORY_HASH,
  approval: { state: 'approved', approved_by: 'TEST_HUMAN', approved_at: NOW, version_id: 'story-v1', content_hash: STORY_HASH },
  section_ids: SECTIONS.map((section) => section.section_id),
};
const PT_STORY = { project_id: STORY.project_id, version_id: STORY.version_id, content_hash: STORY.content_hash, approval_state: 'approved', sections: SECTIONS };
const BEATS = ['visual-beat-01HF7YAT010000000000000001', 'visual-beat-01HF7YAT020000000000000002', 'visual-beat-01HF7YAT030000000000000003'];
const SHOTS = ['shot-01HF7YAT040000000000000004', 'shot-01HF7YAT050000000000000005', 'shot-01HF7YAT060000000000000006'];
const PROMPTS = ['prompt-01HF7YAT070000000000000007', 'prompt-01HF7YAT080000000000000008'];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function beat(index) { return { canonical_beat_id: BEATS[index], section_id: SECTIONS[index].section_id, aliases: [], source_provenance: null }; }
function shot(index, overrides = {}) {
  const defaults = [
    { media_type: 'GENERATED_VIDEO', generation_mode: 'DIRECT_VIDEO', presenter_relation: 'BROLL_OVERLAY', subject: 'conveyor of repetitive thumbnails', artifact_class: 'generated_video' },
    { media_type: 'GENERATED_STILL', generation_mode: 'STILL', presenter_relation: 'BROLL_OVERLAY', subject: 'hourglass beside dark screen', artifact_class: 'generated_still' },
    { media_type: 'SCREEN_CAPTURE', generation_mode: 'NOT_APPLICABLE', presenter_relation: 'PICTURE_IN_PICTURE', subject: 'authentic Script Builder approval screen', artifact_class: 'screen_capture' },
  ][index];
  return {
    shot_id: SHOTS[index], section_ref: { section_id: SECTIONS[index].section_id }, beat_ref: beat(index),
    narrative_function: index === 2 ? 'prove the decision criterion' : 'support the argument', subject: defaults.subject,
    media_type: defaults.media_type, generation_mode: defaults.generation_mode,
    shot_brief: `Bounded shot ${index + 1} for Stop Chasing AI Speed.`, visual_assertion: null,
    presenter_relation: defaults.presenter_relation, research_sensitive: false, research_refs: [], camera_intent: null,
    generation_requirements: { artifact_class: defaults.artifact_class, aspect_target: '9:16', duration_target_s: 3, input_artifact_refs: [], quality_constraints: ['preserve truthful provenance'], candidate_count_request: 1, generation_mode: defaults.generation_mode },
    continuity_notes: [], edit_placement: `section ${index + 1}`, priority: 'HIGH', status: index < 2 ? 'PROMPT_READY' : 'PLANNED', prompt_refs: index < 2 ? [PROMPTS[index]] : [],
    ...overrides,
  };
}
function makeVisualPlan() {
  const shots = [shot(0), shot(1), shot(2)];
  const plan = {
    schema_version: 1, artifact_type: 'visual-plan', plan_id: 'visual-plan-01HF7YAT000000000000000000', plan_revision: 1, supersedes: null,
    created_at: NOW, created_by: 'TEST_WRITER', lifecycle_state: 'AWAITING_HUMAN_REVIEW', story: clone(STORY),
    required_beats: [beat(0), beat(1), beat(2)],
    coverage: shots.map((item, index) => ({ beat_ref: beat(index), decision: 'PLAN_SHOTS', shot_ids: [item.shot_id], reason: null })),
    shots, prompts: [], plan_digest_sha256: '',
  };
  plan.prompts = shots.slice(0, 2).map((item, index) => ({ prompt_id: PROMPTS[index], prompt_revision: 1, shot_id: item.shot_id, shot_intent_digest_sha256: vp.shotIntentDigest(item), prompt_text: `Exact bounded prompt ${index + 1}.`, prompt_type: index === 0 ? 'VIDEO' : 'PRESENTER_AWARE', created_by: 'visual-plan-prompt-adapter', origin: 'test-authority', legacy_aliases: [] }));
  plan.plan_digest_sha256 = vp.planDigest(plan); return plan;
}

function pSha(file) { return H(fs.readFileSync(file)); }
function ptProbe(media) {
  if (!fs.existsSync(media.path_or_artifact_ref)) return { ok: false, available: false, reason: 'MEDIA_MISSING' };
  const bytes = fs.readFileSync(media.path_or_artifact_ref);
  return { ok: true, available: true, actual_sha256: H(bytes), byte_size: bytes.length, duration_s: 3, has_video: true, has_audio: true };
}
let idCounter = 100;
function uid() { idCounter += 1; return idCounter.toString().padStart(26, '0'); }
function buildPresenterManifest(openPickup = false) {
  let manifest = ptm.createManifest(PT_STORY, { manifestId: uid(), newUnitId: () => `recording-unit-${uid()}`, now: NOW });
  const takeIds = [];
  let recommendedTakeId = null;
  for (const [index, unit] of manifest.recording_units.entries()) {
    if (index === 0) {
      recommendedTakeId = `take-${uid()}`;
      manifest = ptm.registerTake(manifest, { recording_unit_id: unit.recording_unit_id, take_id: recommendedTakeId, media: { path_or_artifact_ref: PRESENTER_VIDEO, sha256: pSha(PRESENTER_VIDEO), byte_size: fs.statSync(PRESENTER_VIDEO).size, duration_s: 3, media_type: 'video/mp4', requires_audio: true }, captured_at: NOW, pickup_of_take_id: null }, { mediaProbe: ptProbe, manifestId: uid(), now: NOW });
      manifest = ptm.bindTranscript(manifest, recommendedTakeId, { text: unit.approved_dialogue, source: 'HUMAN_SUPPLIED', created_at: NOW }, { manifestId: uid(), now: NOW });
      manifest = ptm.createFidelityRecord(manifest, recommendedTakeId, {}, { manifestId: uid(), now: NOW });
    }
    const takeId = `take-${uid()}`; takeIds.push(takeId);
    manifest = ptm.registerTake(manifest, { recording_unit_id: unit.recording_unit_id, take_id: takeId, media: { path_or_artifact_ref: PRESENTER_VIDEO, sha256: pSha(PRESENTER_VIDEO), byte_size: fs.statSync(PRESENTER_VIDEO).size, duration_s: 3, media_type: 'video/mp4', requires_audio: true }, captured_at: NOW, pickup_of_take_id: null }, { mediaProbe: ptProbe, manifestId: uid(), now: NOW });
    manifest = ptm.bindTranscript(manifest, takeId, { text: unit.approved_dialogue, source: 'HUMAN_SUPPLIED', created_at: NOW }, { manifestId: uid(), now: NOW });
    manifest = ptm.createFidelityRecord(manifest, takeId, {}, { manifestId: uid(), now: NOW });
  }
  manifest.recommendations = [{ recording_unit_id: manifest.recording_units[0].recording_unit_id, take_id: recommendedTakeId, rank: 1, reason: 'advisory only', created_by: 'presenter_director', created_at: NOW }];
  manifest.manifest_digest_sha256 = ptm.manifestDigest(manifest);
  let firstBase = manifest;
  if (openPickup) firstBase = ptm.createPickupRequest(firstBase, { recording_unit_id: manifest.recording_units[0].recording_unit_id, source_take_ids: [takeIds[0]], reason_code: 'PERFORMANCE_REVIEW_REQUEST', blocking: true, created_by: 'presenter_director', created_at: NOW }, { pickup_request_id: `pickup-${uid()}`, manifestId: uid(), now: NOW });
  const manifests = takeIds.map((takeId, index) => ptm.createHumanSelection(index === 0 ? firstBase : manifest, { take_id: takeId, selector: { type: 'HUMAN', id: 'TEST_HUMAN' }, selected_at: NOW, scope: 'editor-take-selection' }, { manifestId: uid(), now: NOW, allowedHumanIds: ['TEST_HUMAN'] }));
  return { manifest, manifests, takeIds, recommendedTakeId };
}

function mediaInput(file, kind) { return { path_or_artifact_ref: file, expected_sha256: pSha(file), kind }; }
function visualInputs() {
  return [
    { visual_source_id: 'asset-conveyor', shot_id: SHOTS[0], media_mode: 'GENERATED_VIDEO', presenter_relation: 'BROLL_OVERLAY', provenance_class: 'GENERATED_VIDEO', media: mediaInput(BROLL_VIDEO, 'VIDEO'), selection_authority: authority('AIGEN_SELECTED_ASSET', 'selection-conveyor'), generation_provenance: generation('asset-conveyor', SHOTS[0], 'DIRECT_VIDEO'), technical_eligibility: eligibility('qc-conveyor') },
    { visual_source_id: 'asset-hourglass', shot_id: SHOTS[1], media_mode: 'GENERATED_STILL', presenter_relation: 'BROLL_OVERLAY', provenance_class: 'GENERATED_IMAGE', media: mediaInput(STILL_IMAGE, 'IMAGE'), selection_authority: authority('AIGEN_SELECTED_ASSET', 'selection-hourglass'), generation_provenance: generation('asset-hourglass', SHOTS[1], 'STILL'), technical_eligibility: eligibility('qc-hourglass') },
    { visual_source_id: 'asset-screen-proof', shot_id: SHOTS[2], media_mode: 'SCREEN_CAPTURE', presenter_relation: 'PICTURE_IN_PICTURE', provenance_class: 'AUTHENTIC_UI_PROOF', media: mediaInput(SCREEN_VIDEO, 'VIDEO'), selection_authority: authority('HUMAN_CAPTURE_SELECTION', 'selection-screen'), generation_provenance: generation('asset-screen-proof', SHOTS[2], 'NOT_APPLICABLE'), technical_eligibility: eligibility('qc-screen') },
  ];
}
function authority(type, id) { return { authority_type: type, authority_id: id, authority_digest_sha256: H(id), scope: 'edit-plan-source' }; }
function generation(id, shotId, mode) { return { generator: mode === 'NOT_APPLICABLE' ? 'supervised-capture' : 'generation-supervisor', job_id: `job-${id}`, artifact_id: id, source_shot_id: shotId, generation_mode: mode }; }
function eligibility(id) { return { evidence_id: id, evidence_digest_sha256: H(id), state: 'ELIGIBLE' }; }
function soundInputs() { return [{ sound_source_id: 'sound-main', cue_id: 'cue-main', production_mix_id: 'production-mix-test', production_selection_identity: H('sound-selection'), listening_review_identity: H('listening-review'), resolve_source_identity: H('resolve-source'), functional_intent: 'support explanation beneath dialogue', media: mediaInput(MUSIC_AUDIO, 'AUDIO'), selection_authority: authority('SCORECRAFT_FINAL_SELECTION', 'score-selection-main') }]; }

let planIdCounter = 1000;
function idFactory(prefix) { planIdCounter += 1; return `${prefix}-${planIdCounter.toString().padStart(26, '0')}`; }
const verifyHuman = (person) => person?.type === 'HUMAN' && person.id === 'TEST_HUMAN';
function context(overrides = {}) {
  const presenter = overrides.presenter || buildPresenterManifest();
  const currentVisualPlan = overrides.currentVisualPlan || makeVisualPlan();
  return {
    currentStory: overrides.currentStory || STORY, currentVisualPlan,
    presenterManifest: presenter.manifest, presenterManifests: presenter.manifests,
    presenterManifestOptions: { currentStory: PT_STORY, mediaProbe: ptProbe, allowedHumanIds: ['TEST_HUMAN'] },
    visualSources: overrides.visualSources || visualInputs(), soundSources: overrides.soundSources || soundInputs(),
    verifyVisualAuthority: overrides.verifyVisualAuthority || ((source) => visualInputs().some((item) => item.visual_source_id === source.visual_source_id && item.shot_id === source.shot_id && item.selection_authority.authority_digest_sha256 === source.selection_authority.authority_digest_sha256)),
    verifySoundAuthority: overrides.verifySoundAuthority || ((source) => soundInputs().some((item) => item.sound_source_id === source.sound_source_id && item.production_mix_id === source.production_mix_id && item.production_selection_identity === source.production_selection_identity && item.selection_authority.authority_digest_sha256 === source.selection_authority.authority_digest_sha256)),
    verifyHuman, idFactory, now: NOW, ...overrides,
  };
}

function baseSpec(ctx) {
  const units = ctx.presenterManifest.recording_units; const presenterIds = ctx.presenterManifests.map((manifest) => `presenter:${manifest.human_selections[0].take_id}`);
  const T = (role) => role;
  const clips = [
    pclip(presenterIds[0], units[0], T('VIDEO_PRIMARY'), 0, 75), pclip(presenterIds[0], units[0], T('AUDIO_DIALOGUE'), 0, 75),
    vclip('asset-conveyor', 0, T('VIDEO_OVERLAY'), 10, 65, 'BROLL_OVERLAY', 'FRAME_SAMPLE'),
    pclip(presenterIds[1], units[1], T('VIDEO_PRIMARY'), 75, 150), pclip(presenterIds[1], units[1], T('AUDIO_DIALOGUE'), 75, 150),
    vclip('asset-hourglass', 1, T('VIDEO_OVERLAY'), 85, 140, 'BROLL_OVERLAY'),
    vclip('asset-screen-proof', 2, T('VIDEO_PRIMARY'), 150, 225, 'PICTURE_IN_PICTURE', 'FRAME_SAMPLE'),
    pclip(presenterIds[2], units[2], T('PRESENTER_PIP'), 150, 225, null, 'NORMAL', pipTransform()), pclip(presenterIds[2], units[2], T('AUDIO_DIALOGUE'), 150, 225),
    { source_type: 'SOUND', source_id: 'sound-main', track_role: 'AUDIO_MUSIC', refs: refs(null, null, null, null), presenter_relation: null, playback_mode: 'NORMAL', source_range: range(0, 225), timeline_range: range(0, 225), transform: null, transition_refs: [] },
  ];
  return {
    created_by: 'edit-plan-writer',
    timeline: { frame_rate: { numerator: 25, denominator: 1 }, orientation: 'VERTICAL', width: 1080, height: 1920, output_class: 'VIDTOOLZ_SHORT', expected_duration_frames: 225, tracks: ['VIDEO_PRIMARY', 'VIDEO_OVERLAY', 'PRESENTER_PIP', 'GRAPHICS', 'CAPTIONS', 'AUDIO_DIALOGUE', 'AUDIO_MUSIC'] },
    clips, transitions: [], graphics: [],
    story_coverage: SECTIONS.map((section) => cov(section.section_id, 'COVERED')),
    visual_coverage: SHOTS.map((id) => cov(id, 'PLACED')),
    presenter_coverage: units.map((unit) => cov(unit.recording_unit_id, 'COVERED')),
    sound_coverage: [cov('sound-main', 'COVERED')], human_exceptions: [],
  };
}
function refs(section, beatId, shotId, unit) { return { section_id: section, beat_id: beatId, shot_id: shotId, recording_unit_id: unit }; }
function range(i, o) { return { in_frame: i, out_frame: o }; }
function cov(ref_id, state, reason = null, exception_id = null) { return { ref_id, state, reason, exception_id }; }
function pclip(source, unit, track, start, end, relation = null, playback = 'NORMAL', transform = null) { return { source_type: 'PRESENTER', source_id: source, track_role: track, refs: refs(unit.section_id, null, null, unit.recording_unit_id), presenter_relation: relation, playback_mode: playback, source_range: range(0, end - start), timeline_range: range(start, end), transform, transition_refs: [] }; }
function vclip(source, index, track, start, end, relation, playback = 'NORMAL', transform = null) { return { source_type: 'VISUAL', source_id: source, track_role: track, refs: refs(SECTIONS[index].section_id, BEATS[index], SHOTS[index], null), presenter_relation: relation, playback_mode: playback, source_range: source === 'asset-hourglass' ? null : range(0, end - start), timeline_range: range(start, end), transform, transition_refs: [] }; }
function pipTransform() { return { preset: 'RIGHT_THIRD_PIP', position_x: 0.78, position_y: 0.72, scale: 0.3, crop: { left: 0, top: 0, right: 0, bottom: 0 }, safe_area_ref: 'VERTICAL_SAFE', composite_role: 'PIP' }; }
function build(overrides = {}) { const ctx = context(overrides.context || {}); const spec = overrides.spec || baseSpec(ctx); return { ctx, plan: ep.createEditPlan(spec, ctx), spec }; }
function refresh(plan) { plan.edit_plan_digest_sha256 = ep.editPlanDigest(plan); return plan; }
function validate(plan, ctx) { return ep.validateEditPlan(plan, { ...ctx, requireMediaVerification: true }); }
function code(out, value) { assert.ok(out.reason_codes.includes(value), `${value} absent: ${out.reason_codes.join(', ')}`); }

// Root contract, writers, strict schemas, and authority injections (EP26, EP29-37, EP44-52).
test('EPV1 positive presenter-led short validates', () => { const { plan, ctx } = build(); assert.equal(validate(plan, ctx).ok, true); });
test('EPV2 initial revision and canonical ID', () => { const { plan } = build(); assert.equal(plan.edit_plan_revision, 1); assert.match(plan.edit_plan_id, /^edit-plan-/); });
for (const field of ['edit_plan_id', 'edit_plan_revision', 'edit_plan_digest_sha256', 'clip_instance_id', 'transition_instance_id', 'graphic_instance_id']) test(`EPV writer rejects model-authored ${field}`, () => { const ctx = context(); const spec = baseSpec(ctx); spec[field] = 'model'; assert.throws(() => ep.createEditPlan(spec, ctx), /unknown field/); });
const strictMutations = [
  ['root', (p) => { p.qc_pass = true; }], ['Story', (p) => { p.story_ref.story_rewrite = true; }], ['Visual Plan', (p) => { p.visual_plan_ref.camera_path = []; }],
  ['Presenter source', (p) => { p.presenter_sources[0].selected_take = true; }], ['visual source', (p) => { p.visual_sources[0].approved_asset = true; }], ['Sound source', (p) => { p.sound_sources[0].sound_treatment = 'EQ'; }],
  ['media', (p) => { p.visual_sources[0].media.generation_backend = 'gpu'; }], ['selection authority', (p) => { p.visual_sources[0].selection_authority.human_approved = true; }],
  ['generation provenance', (p) => { p.visual_sources[0].generation_provenance.backend = 'x'; }], ['eligibility', (p) => { p.visual_sources[0].technical_eligibility.qc_approved = true; }],
  ['timeline', (p) => { p.timeline.publish_ready = true; }], ['rate', (p) => { p.timeline.frame_rate.float_fps = 29.97; }], ['track', (p) => { p.timeline.tracks[0].lane = 'model'; }],
  ['clip', (p) => { p.clip_instances[0].selected_asset = true; }], ['refs', (p) => { p.clip_instances[0].refs.research_override = true; }], ['source range', (p) => { p.clip_instances[0].source_range.duration = 75; }],
  ['timeline range', (p) => { p.clip_instances[0].timeline_range.timeline = 0; }], ['transform', (p) => { p.clip_instances[7].transform.camera_path = []; }], ['crop', (p) => { p.clip_instances[7].transform.crop.key = 1; }],
  ['coverage', (p) => { p.story_coverage[0].approved = true; }],
];
for (const [label, mutate] of strictMutations) test(`EP strict ${label}`, () => { const { plan, ctx } = build(); mutate(plan); refresh(plan); code(validate(plan, ctx), 'UNKNOWN_FIELD'); });
for (const field of ['selected_take', 'selected_asset', 'approved_asset', 'qc_pass', 'qc_approved', 'publish_ready', 'published', 'story_rewrite', 'research_override', 'camera_path', 'generation_backend', 'music_recompose', 'sound_treatment', 'final_edit_approved', 'human_approved']) test(`EP authority injection ${field} fails`, () => { const { plan, ctx } = build(); plan[field] = true; refresh(plan); assert.equal(validate(plan, ctx).ok, false); });

// Story identity, approval, coverage, and order (EP1-4, EP19-22, EP32, EP54).
for (const [label, mutate] of [['project', (s) => { s.project_id = 'other'; }], ['version', (s) => { s.version_id = 'v2'; }], ['hash', (s) => { s.content_hash = H('other'); }], ['approval', (s) => { s.approval = { state: 'none', approved_by: null, approved_at: null, version_id: s.version_id, content_hash: s.content_hash }; }]]) test(`EP Story ${label} drift stales`, () => { const { plan, ctx } = build(); const changed = clone(ctx.currentStory); mutate(changed); const out = validate(plan, { ...ctx, currentStory: changed }); code(out, 'STORY_STALE'); assert.equal(out.current, false); });
test('EP draft Story is PREVIEW_ONLY', () => { const ctx = context(); const spec = baseSpec(ctx); ctx.currentStory = clone(STORY); ctx.currentStory.approval = { state: 'none', approved_by: null, approved_at: null, version_id: STORY.version_id, content_hash: STORY.content_hash }; ctx.currentVisualPlan = clone(ctx.currentVisualPlan); ctx.currentVisualPlan.story = clone(ctx.currentStory); ctx.currentVisualPlan.plan_digest_sha256 = vp.planDigest(ctx.currentVisualPlan); ctx.presenterManifest = null; ctx.presenterManifests = []; spec.clips = []; spec.story_coverage = STORY.section_ids.map((id) => cov(id, 'MISSING')); spec.visual_coverage = SHOTS.map((id) => cov(id, 'MISSING')); spec.presenter_coverage = []; spec.sound_coverage = [cov('sound-main', 'MISSING')]; const plan = ep.createEditPlan(spec, ctx); const a = ep.evaluateEditPlanAuthority(plan, ctx); assert.equal(a.state, 'PREVIEW_ONLY'); assert.equal(a.qc_handoff_ready, false); });
test('EP missing Story section blocks coverage', () => { const { plan, ctx } = build(); plan.story_coverage[2].state = 'MISSING'; plan.clip_instances = plan.clip_instances.filter((clip) => clip.refs.section_id !== SECTIONS[2].section_id); refresh(plan); const a = ep.evaluateEditPlanAuthority(plan, ctx); assert.equal(a.story_coverage_valid, false); assert.equal(a.qc_handoff_ready, false); });
test('EP omitted qualifier-bearing section needs exception', () => { const { plan, ctx } = build(); plan.story_coverage[1] = cov(SECTIONS[1].section_id, 'INTENTIONALLY_OMITTED', 'omit', 'missing-exception'); plan.clip_instances = plan.clip_instances.filter((clip) => clip.refs.section_id !== SECTIONS[1].section_id); refresh(plan); code(validate(plan, ctx), 'OMISSION_EXCEPTION_INVALID'); });
test('EP payoff section omission blocks without semantics', () => { const { plan, ctx } = build(); plan.story_coverage[2].state = 'MISSING'; plan.clip_instances = plan.clip_instances.filter((clip) => clip.refs.section_id !== SECTIONS[2].section_id); refresh(plan); assert.equal(ep.evaluateEditPlanAuthority(plan, ctx).qc_handoff_ready, false); });
test('EP structural Story reorder rejected', () => { const { plan, ctx } = build(); for (const clip of plan.clip_instances) { if (clip.refs.section_id === SECTIONS[0].section_id) { clip.timeline_range.in_frame += 150; clip.timeline_range.out_frame += 150; } if (clip.refs.section_id === SECTIONS[2].section_id) { clip.timeline_range.in_frame -= 150; clip.timeline_range.out_frame -= 150; } } refresh(plan); code(validate(plan, ctx), 'STORY_ORDER_CHANGED'); });
test('EP structural Story reorder with exact TEST_HUMAN exception can validate order authority', () => { const { plan, ctx } = build(); const ex = ep.createHumanException({ type: 'STORY_REORDER', scope_refs: STORY.section_ids, reason: 'explicit test editorial exception', approver: { type: 'HUMAN', id: 'TEST_HUMAN' }, approved_at: NOW }, ctx); plan.human_exceptions.push(ex); for (const clip of plan.clip_instances) { if (clip.refs.section_id === SECTIONS[0].section_id) { clip.timeline_range.in_frame += 150; clip.timeline_range.out_frame += 150; } if (clip.refs.section_id === SECTIONS[2].section_id) { clip.timeline_range.in_frame -= 150; clip.timeline_range.out_frame -= 150; } } refresh(plan); assert.equal(validate(plan, ctx).reason_codes.includes('STORY_ORDER_CHANGED'), false); });
test('EP agent cannot create human exception', () => assert.throws(() => ep.createHumanException({ type: 'STORY_REORDER', scope_refs: STORY.section_ids, reason: 'x', approver: { type: 'AGENT', id: 'editor' }, approved_at: NOW }, context())));

// Visual Plan and visual-source authority/provenance (EP5, EP11, EP24-25, EP28-31, EP55).
test('EP Visual Plan revision drift stales', () => { const { plan, ctx } = build(); const changed = clone(ctx.currentVisualPlan); changed.plan_revision += 1; changed.plan_digest_sha256 = vp.planDigest(changed); code(validate(plan, { ...ctx, currentVisualPlan: changed }), 'VISUAL_PLAN_STALE'); });
test('EP Visual Plan digest drift stales', () => { const { plan, ctx } = build(); const changed = clone(ctx.currentVisualPlan); changed.plan_digest_sha256 = H('changed plan'); code(validate(plan, { ...ctx, currentVisualPlan: changed }), 'VISUAL_PLAN_STALE'); });
test('EP wrong asset assigned to shot rejected by writer', () => { const ctx = context(); const sources = visualInputs(); sources[0].shot_id = SHOTS[1]; ctx.visualSources = sources; ctx.verifyVisualAuthority = () => true; assert.throws(() => ep.createEditPlan(baseSpec(ctx), ctx), /detached from shot/); });
test('EP unresolved visual selection rejected', () => { const ctx = context({ verifyVisualAuthority: () => false }); assert.throws(() => ep.createEditPlan(baseSpec(ctx), ctx), /authority unresolved/); });
test('EP naked selected true rejected', () => { const ctx = context(); ctx.visualSources[0].selected = true; assert.throws(() => ep.createEditPlan(baseSpec(ctx), ctx), /unknown field/); });
test('EP naked QC_PASS rejected', () => { const ctx = context(); ctx.visualSources[0].qc_state = 'QC_PASS'; assert.throws(() => ep.createEditPlan(baseSpec(ctx), ctx), /unknown field/); });
test('EP generated fake UI cannot satisfy authentic proof', () => { const ctx = context(); ctx.visualSources[2].provenance_class = 'GENERATED_VIDEO'; ctx.verifyVisualAuthority = () => true; assert.throws(() => ep.createEditPlan(baseSpec(ctx), ctx), /provenance does not satisfy/); });
test('EP generated graphic cannot satisfy SCREEN_CAPTURE shot', () => { const ctx = context(); ctx.visualSources[2].media_mode = 'GENERATED_VIDEO'; assert.throws(() => ep.createEditPlan(baseSpec(ctx), ctx), /detached from shot/); });
test('EP Visual Plan presenter relation mutation stales', () => { const { plan, ctx } = build(); const changed = clone(ctx.currentVisualPlan); changed.shots[0].presenter_relation = 'REPLACE'; changed.plan_digest_sha256 = vp.planDigest(changed); const out = validate(plan, { ...ctx, currentVisualPlan: changed }); assert.equal(out.ok, false); });
test('EP clip cannot mutate Visual Plan relation', () => { const { plan, ctx } = build(); plan.clip_instances.find((clip) => clip.source_id === 'asset-conveyor').presenter_relation = 'REPLACE'; refresh(plan); code(validate(plan, ctx), 'VISUAL_RELATION_MISMATCH'); });
test('EP Camera mechanics unknown field rejected', () => { const { plan, ctx } = build(); plan.visual_sources[0].camera_path = []; refresh(plan); code(validate(plan, ctx), 'UNKNOWN_FIELD'); });
test('EP arbitrary Generation request rejected', () => { const { plan, ctx } = build(); plan.visual_sources[0].generation_provenance.request_generation = true; refresh(plan); code(validate(plan, ctx), 'UNKNOWN_FIELD'); });

// Presenter Manifest integration (EP6-8, EP26-27, EP48).
test('EP Presenter source exactly uses TEST_HUMAN-selected take', () => { const { plan, ctx } = build(); for (const source of plan.presenter_sources) { const manifest = ctx.presenterManifests.find((item) => item.manifest_id === source.manifest_id); const selection = manifest.human_selections.find((item) => item.recording_unit_id === source.recording_unit_id); assert.equal(source.take_id, selection.take_id); } });
test('EP recommendation cannot replace human selection', () => { const { plan, ctx } = build(); assert.notEqual(ctx.presenterManifest.recommendations[0].take_id, plan.presenter_sources[0].take_id); });
test('EP attempted Presenter source override stales', () => { const { plan, ctx } = build(); plan.presenter_sources[0].take_id = ctx.presenterManifest.recommendations[0].take_id; refresh(plan); code(validate(plan, ctx), 'PRESENTER_SOURCE_STALE'); });
test('EP open blocking pickup excludes source and blocks coverage', () => { const presenter = buildPresenterManifest(true); const ctx = context({ presenter }); const spec = baseSpec(ctx); assert.throws(() => ep.createEditPlan(spec, ctx), /clip source unresolved/); });
test('EP stale Manifest digest stales Presenter source', () => { const { plan, ctx } = build(); const changed = clone(ctx.presenterManifests); changed[0].manifest_digest_sha256 = H('stale'); const out = validate(plan, { ...ctx, presenterManifests: changed }); code(out, 'PRESENTER_SOURCE_STALE'); });
test('EP Editor selected_take root injection rejected', () => { const { plan, ctx } = build(); plan.selected_take = plan.presenter_sources[0].take_id; refresh(plan); assert.equal(validate(plan, ctx).ok, false); });
test('EP Hermes cannot override source', () => { const { plan, ctx } = build(); plan.created_by = 'hermes'; plan.presenter_sources[0].take_id = 'take-model'; refresh(plan); code(validate(plan, ctx), 'PRESENTER_SOURCE_STALE'); });
test('EP presenter media hash mutation stales source', () => { const { plan, ctx } = build(); plan.presenter_sources[0].media.sha256 = H('wrong'); refresh(plan); code(validate(plan, ctx), 'PRESENTER_SOURCE_STALE'); });
test('EP presenter selection completeness derived', () => { const { plan, ctx } = build(); plan.presenter_coverage[0].state = 'MISSING'; plan.clip_instances = plan.clip_instances.filter((clip) => clip.refs.recording_unit_id !== plan.presenter_coverage[0].ref_id); refresh(plan); assert.equal(ep.evaluateEditPlanAuthority(plan, ctx).presenter_selection_complete, false); });
test('EP Presenter source cannot contain approved_take', () => { const { plan, ctx } = build(); plan.presenter_sources[0].approved_take = true; refresh(plan); code(validate(plan, ctx), 'UNKNOWN_FIELD'); });

// Actual bytes, media probes, source and timeline bounds (EP9-10, EP12-15, EP39-42).
test('EP missing media blocks authority', () => { const { plan, ctx } = build(); const original = plan.visual_sources[0].media.path_or_artifact_ref; plan.visual_sources[0].media.path_or_artifact_ref = path.join(TMP, 'missing.mp4'); refresh(plan); const a = ep.evaluateEditPlanAuthority(plan, ctx); assert.equal(a.media_verified, false); plan.visual_sources[0].media.path_or_artifact_ref = original; });
test('EP same path changed bytes blocks authority', () => { const { plan, ctx } = build(); const target = path.join(TMP, 'mutation-copy.mp4'); fs.copyFileSync(BROLL_VIDEO, target); plan.visual_sources[0].media.path_or_artifact_ref = target; plan.visual_sources[0].media.sha256 = pSha(target); plan.visual_sources[0].media.byte_size = fs.statSync(target).size; refresh(plan); fs.appendFileSync(target, 'mutation'); assert.equal(ep.evaluateEditPlanAuthority(plan, ctx).media_verified, false); });
test('EP corrupt media cannot be written', () => { const bad = path.join(TMP, 'corrupt.mp4'); fs.writeFileSync(bad, 'not video'); const ctx = context(); ctx.visualSources[0].media = mediaInput(bad, 'VIDEO'); assert.throws(() => ep.createEditPlan(baseSpec(ctx), ctx)); });
test('EP wrong stored byte size fails', () => { const { plan, ctx } = build(); plan.visual_sources[0].media.byte_size += 1; refresh(plan); assert.equal(ep.evaluateEditPlanAuthority(plan, ctx).media_verified, false); });
test('EP negative source in fails', () => { const { plan, ctx } = build(); plan.clip_instances[0].source_range.in_frame = -1; refresh(plan); code(validate(plan, ctx), 'FRAME_RANGE_INVALID'); });
test('EP source out beyond verified duration fails', () => { const { plan, ctx } = build(); plan.clip_instances[0].source_range.out_frame = 250; refresh(plan); code(validate(plan, ctx), 'SOURCE_BOUNDS_EXCEEDED'); });
test('EP zero-length source fails', () => { const { plan, ctx } = build(); plan.clip_instances[0].source_range.out_frame = 0; refresh(plan); code(validate(plan, ctx), 'FRAME_RANGE_INVALID'); });
test('EP negative timeline start fails', () => { const { plan, ctx } = build(); plan.clip_instances[0].timeline_range.in_frame = -1; refresh(plan); code(validate(plan, ctx), 'FRAME_RANGE_INVALID'); });
test('EP zero-length timeline fails', () => { const { plan, ctx } = build(); plan.clip_instances[0].timeline_range.out_frame = 0; refresh(plan); code(validate(plan, ctx), 'FRAME_RANGE_INVALID'); });
test('EP inconsistent model arithmetic fails', () => { const { plan, ctx } = build(); plan.clip_instances[0].timeline_range.out_frame = 70; refresh(plan); code(validate(plan, ctx), 'FRAME_MATH_INCONSISTENT'); });
test('EP one-second source cannot become ten seconds', () => { const one = path.join(TMP, 'one-second.mp4'); ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=360x640:r=25:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', one]); const ctx = context(); ctx.visualSources[0].media = mediaInput(one, 'VIDEO'); const spec = baseSpec(ctx); spec.clips.find((clip) => clip.source_id === 'asset-conveyor').source_range = range(0, 250); assert.throws(() => ep.createEditPlan(spec, ctx), /created Edit Plan invalid/); });
test('EP still image permits arbitrary positive timeline duration', () => { const { plan, ctx } = build(); const clip = plan.clip_instances.find((item) => item.source_id === 'asset-hourglass'); clip.timeline_range = range(80, 145); refresh(plan); assert.equal(validate(plan, ctx).reason_codes.includes('STILL_SOURCE_RANGE_INVALID'), false); });
for (const rate of [[25, 1], [30, 1], [30000, 1001], [24000, 1001]]) test(`EP rational timebase ${rate[0]}/${rate[1]} accepted structurally`, () => { const { plan } = build(); plan.timeline.frame_rate = { numerator: rate[0], denominator: rate[1] }; refresh(plan); const out = ep.validateEditPlan(plan); assert.equal(out.reason_codes.includes('TIMEBASE_INVALID'), false); });
test('EP invalid 2997/100 rejects timebase', () => { const { plan } = build(); plan.timeline.frame_rate = { numerator: 2997, denominator: 100 }; refresh(plan); code(ep.validateEditPlan(plan), 'TIMEBASE_INVALID'); });
test('EP long 30000/1001 arithmetic is exact integer math', () => { const frames = ep.framesForDurationUs(3600000000, { numerator: 30000, denominator: 1001 }); assert.equal(typeof frames, 'bigint'); assert.equal(frames, 107892n); });
test('EP source FPS mismatch needs FRAME_SAMPLE', () => { const { plan, ctx } = build(); plan.timeline.frame_rate = { numerator: 30, denominator: 1 }; refresh(plan); code(validate(plan, ctx), 'SOURCE_FPS_MISMATCH'); });
test('EP Shorts duration is not universally rejected', () => { const { plan } = build(); plan.timeline.output_class = 'LONG_FORM'; plan.timeline.expected_duration_frames = 100000; refresh(plan); assert.equal(ep.validateEditPlan(plan).reason_codes.includes('SHORT_DURATION_INVALID'), false); });

// Tracks, layering, relations, gaps, overlaps, transitions, graphics (EP16-18, EP23, EP38, EP43, EP55).
test('EP BROLL_OVERLAY retains dialogue continuity', () => { const { plan, ctx } = build(); assert.equal(validate(plan, ctx).reason_codes.includes('BROLL_OVERLAY_INVALID'), false); assert.ok(plan.clip_instances.some((clip) => clip.source_id === 'asset-conveyor' && clip.track_id === plan.timeline.tracks.find((t) => t.role === 'VIDEO_OVERLAY').track_id)); });
test('EP BROLL_OVERLAY without dialogue fails relation', () => { const { plan, ctx } = build(); plan.clip_instances = plan.clip_instances.filter((clip) => !(clip.refs.section_id === SECTIONS[0].section_id && clip.source_type === 'PRESENTER' && clip.track_id === plan.timeline.tracks.find((t) => t.role === 'AUDIO_DIALOGUE').track_id)); refresh(plan); code(validate(plan, ctx), 'BROLL_OVERLAY_INVALID'); });
test('EP PiP uses primary and Presenter PiP tracks', () => { const { plan, ctx } = build(); assert.equal(validate(plan, ctx).reason_codes.includes('PIP_INVALID'), false); });
test('EP PiP without presenter layer fails', () => { const { plan, ctx } = build(); const pipTrack = plan.timeline.tracks.find((track) => track.role === 'PRESENTER_PIP').track_id; plan.clip_instances = plan.clip_instances.filter((clip) => clip.track_id !== pipTrack); refresh(plan); code(validate(plan, ctx), 'PIP_INVALID'); });
test('EP primary full-frame overlap conflicts', () => { const { plan, ctx } = build(); const extra = clone(plan.clip_instances[0]); extra.clip_instance_id = `edit-clip-${uid()}`; extra.timeline_range = range(20, 60); extra.source_range = range(0, 40); plan.clip_instances.push(extra); refresh(plan); code(validate(plan, ctx), 'PRIMARY_VIDEO_CONFLICT'); });
test('EP overlay overlap is valid', () => { const { plan, ctx } = build(); assert.equal(validate(plan, ctx).reason_codes.includes('PRIMARY_VIDEO_CONFLICT'), false); });
test('EP primary video gap is surfaced', () => { const { plan } = build(); const clip = plan.clip_instances.find((item) => item.source_id === 'asset-screen-proof'); clip.timeline_range.in_frame = 160; const finding = ep.timelineFindings(plan).find((item) => item.type === 'PRIMARY_VIDEO_GAP'); assert.deepEqual([finding.start_frame, finding.end_frame], [150, 160]); });
test('EP dialogue gap is surfaced', () => { const { plan } = build(); const clip = plan.clip_instances.find((item) => item.source_type === 'PRESENTER' && item.refs.section_id === SECTIONS[1].section_id && item.track_id === plan.timeline.tracks.find((t) => t.role === 'AUDIO_DIALOGUE').track_id); clip.timeline_range.in_frame = 80; const finding = ep.timelineFindings(plan).find((item) => item.type === 'DIALOGUE_AUDIO_GAP'); assert.deepEqual([finding.start_frame, finding.end_frame], [75, 80]); });
test('EP duplicate clip IDs fail', () => { const { plan, ctx } = build(); plan.clip_instances[1].clip_instance_id = plan.clip_instances[0].clip_instance_id; refresh(plan); code(validate(plan, ctx), 'CLIP_ID_INVALID'); });
test('EP arbitrary transition rejected', () => { const { plan, ctx } = build(); plan.transition_instances.push({ transition_instance_id: `edit-transition-${uid()}`, type: 'teleport_with_magic', from_clip_instance_id: plan.clip_instances[0].clip_instance_id, to_clip_instance_id: plan.clip_instances[1].clip_instance_id, duration_frames: 0 }); refresh(plan); code(validate(plan, ctx), 'TRANSITION_INVALID'); });
for (const type of ep.TRANSITION_TYPES) test(`EP transition enum ${type}`, () => { const { ctx } = build(); const spec = baseSpec(ctx); spec.transitions = [{ type, from_clip_index: 0, to_clip_index: 1, duration_frames: type === 'CUT' ? 0 : 3 }]; const plan = ep.createEditPlan(spec, ctx); assert.equal(validate(plan, ctx).reason_codes.includes('TRANSITION_INVALID'), false); });
test('EP factual lower-third without authority fails', () => { const { plan, ctx } = build(); const track = plan.timeline.tracks.find((t) => t.role === 'GRAPHICS'); plan.graphic_instances.push({ graphic_instance_id: `edit-graphic-${uid()}`, track_id: track.track_id, text: 'Revenue grew 400%', text_kind: 'LOWER_THIRD', text_authority_ref: null, timeline_range: range(0, 25), style_template_ref: null, section_id: SECTIONS[0].section_id, research_refs: [] }); refresh(plan); code(validate(plan, ctx), 'TEXT_AUTHORITY_REQUIRED'); });
test('EP caption requires Story section', () => { const { plan, ctx } = build(); const track = plan.timeline.tracks.find((t) => t.role === 'CAPTIONS'); plan.graphic_instances.push({ graphic_instance_id: `edit-graphic-${uid()}`, track_id: track.track_id, text: 'Caption', text_kind: 'CAPTION', text_authority_ref: { authority_type: 'STORY_TEXT', authority_id: 'line-1', authority_digest_sha256: H('caption') }, timeline_range: range(0, 25), style_template_ref: null, section_id: 'unknown', research_refs: [] }); refresh(plan); code(validate(plan, ctx), 'CAPTION_STORY_REF_INVALID'); });
test('EP bound lower-third validates structurally', () => { const { plan, ctx } = build(); const track = plan.timeline.tracks.find((t) => t.role === 'GRAPHICS'); plan.graphic_instances.push({ graphic_instance_id: `edit-graphic-${uid()}`, track_id: track.track_id, text: 'Proof-first workflow', text_kind: 'LOWER_THIRD', text_authority_ref: { authority_type: 'STORY_TEXT', authority_id: 'line-proof', authority_digest_sha256: H('Proof-first workflow') }, timeline_range: range(150, 175), style_template_ref: 'lower-third-v1', section_id: SECTIONS[2].section_id, research_refs: [] }); refresh(plan); assert.equal(validate(plan, ctx).reason_codes.includes('TEXT_AUTHORITY_REQUIRED'), false); });

// Sound, digest, revision, QC/human boundaries, projections (EP34-37, EP45-47, EP51, EP53).
test('EP unresolved Sound selection rejected', () => { const ctx = context({ verifySoundAuthority: () => false }); assert.throws(() => ep.createEditPlan(baseSpec(ctx), ctx), /Sound authority unresolved/); });
test('EP Sound substitution stales', () => { const { plan, ctx } = build(); plan.sound_sources[0].production_mix_id = 'other-mix'; refresh(plan); code(validate(plan, ctx), 'SOUND_SOURCE_STALE'); });
test('EP Sound recomposition field rejected', () => { const { plan, ctx } = build(); plan.sound_sources[0].music_recompose = true; refresh(plan); code(validate(plan, ctx), 'UNKNOWN_FIELD'); });
test('EP Sound treatment field rejected', () => { const { plan, ctx } = build(); plan.sound_sources[0].eq = 'boost'; refresh(plan); code(validate(plan, ctx), 'UNKNOWN_FIELD'); });
test('EP Sound missing coverage blocks readiness', () => { const { plan, ctx } = build(); plan.sound_coverage[0].state = 'MISSING'; plan.clip_instances = plan.clip_instances.filter((clip) => clip.source_type !== 'SOUND'); refresh(plan); assert.equal(ep.evaluateEditPlanAuthority(plan, ctx).qc_handoff_ready, false); });
test('EP digest is mandatory', () => { const { plan, ctx } = build(); plan.edit_plan_digest_sha256 = ''; code(validate(plan, ctx), 'DIGEST_REQUIRED'); });
test('EP stale digest rejects semantic mutation', () => { const { plan, ctx } = build(); plan.timeline.width = 720; code(validate(plan, ctx), 'DIGEST_MISMATCH'); });
test('EP JSON key order does not change digest', () => { const { plan } = build(); const reversed = {}; for (const key of Object.keys(plan).reverse()) reversed[key] = plan[key]; assert.equal(ep.editPlanDigest(reversed), plan.edit_plan_digest_sha256); });
test('EP all authoritative fields change digest', () => { const { plan } = build(); const fields = [['story_ref', 'project_id'], ['visual_plan_ref', 'plan_revision'], ['timeline', 'width']]; for (const [root, key] of fields) { const p = clone(plan); p[root][key] = typeof p[root][key] === 'number' ? p[root][key] + 1 : `${p[root][key]}x`; assert.notEqual(ep.editPlanDigest(p), plan.edit_plan_digest_sha256); } });
test('EP successor increments exactly one and binds predecessor', () => { const { plan, ctx } = build(); const next = ep.createSuccessorEditPlan(plan, (p) => { p.timeline.output_class = 'VIDTOOLZ_SHORT_REVISED'; }, ctx); assert.equal(ep.validateSuccessorEditPlan(plan, next, ctx).ok, true); });
test('EP same revision mutation fails successor', () => { const { plan, ctx } = build(); const next = clone(plan); next.timeline.width = 720; refresh(next); assert.equal(ep.validateSuccessorEditPlan(plan, next, ctx).ok, false); });
test('EP skipped revision fails successor', () => { const { plan, ctx } = build(); const next = ep.createSuccessorEditPlan(plan, () => {}, ctx); next.edit_plan_revision += 1; refresh(next); assert.equal(ep.validateSuccessorEditPlan(plan, next, ctx).ok, false); });
test('EP detached predecessor fails successor', () => { const { plan, ctx } = build(); const next = ep.createSuccessorEditPlan(plan, () => {}, ctx); next.supersedes_digest = H('wrong'); refresh(next); assert.equal(ep.validateSuccessorEditPlan(plan, next, ctx).ok, false); });
test('EP good state is only ROUGH_CUT_READY_FOR_QC', () => { const { plan, ctx } = build(); const a = ep.evaluateEditPlanAuthority(plan, ctx); assert.equal(a.state, 'ROUGH_CUT_READY_FOR_QC'); assert.equal(a.qc_handoff_ready, true); assert.equal(JSON.stringify(a).includes('QC_PASS'), false); });
for (const field of ['QC_PASS', 'COMPLETE', 'FINAL_EDIT_APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED']) test(`EP maximum authority excludes ${field}`, () => { const { plan, ctx } = build(); assert.equal(JSON.stringify(ep.evaluateEditPlanAuthority(plan, ctx)).includes(field), false); });
test('EP QC handoff binds exact plan and has no verdict', () => { const { plan, ctx } = build(); const handoff = ep.buildQCHandoff(plan, ctx); assert.equal(handoff.edit_plan_digest_sha256, plan.edit_plan_digest_sha256); assert.equal(handoff.qc_pass, undefined); });
test('EP blocked plan cannot build QC handoff', () => { const { plan, ctx } = build(); plan.story_coverage[0].state = 'MISSING'; refresh(plan); assert.throws(() => ep.buildQCHandoff(plan, ctx)); });
test('EP Resolve handoff is deterministic projection only', () => { const { plan, ctx } = build(); const handoff = ep.buildResolveHandoff(plan, ctx); assert.equal(handoff.edit_plan_id, plan.edit_plan_id); assert.equal(handoff.render, undefined); assert.equal(handoff.resolve_project, undefined); });
test('EP human edit approval exact binding verifies', () => { const { plan, ctx } = build(); const approval = ep.createEditApprovalBinding(plan, { approver: { type: 'HUMAN', id: 'TEST_HUMAN' }, approved_at: NOW, scope: 'FINAL_CUT_APPROVAL' }, ctx); assert.equal(ep.verifyEditApprovalBinding(plan, approval, ctx).ok, true); });
test('EP plan mutation stales human approval', () => { const { plan, ctx } = build(); const approval = ep.createEditApprovalBinding(plan, { approver: { type: 'HUMAN', id: 'TEST_HUMAN' }, approved_at: NOW, scope: 'FINAL_CUT_APPROVAL' }, ctx); const next = ep.createSuccessorEditPlan(plan, (p) => { p.timeline.output_class = 'revision'; }, ctx); assert.equal(ep.verifyEditApprovalBinding(next, approval, ctx).ok, false); });
test('EP model-created approval rejected', () => assert.throws(() => ep.createEditApprovalBinding(build().plan, { approver: { type: 'AGENT', id: 'editor' }, approved_at: NOW, scope: 'x' }, context())));
test('EP review bundle exposes validation and blockers', () => { const { plan, ctx } = build(); const bundle = ep.buildReviewBundle(plan, ctx); assert.equal(bundle.validation.ok, true); assert.equal(bundle.authority.qc_handoff_ready, true); assert.ok(bundle.coverage.story.length); });

// Production writer and boundary checks.
test('EP no NLE/control APIs exported', () => { for (const key of ['render', 'publish', 'openResolve', 'writeTimeline', 'selectTake', 'approveAsset', 'qcPass']) assert.equal(ep[key], undefined); });
test('EP no Editor prototype dependency', () => { const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'edit-plan.js'), 'utf8'); assert.equal(source.includes("require('./editor"), false); });
test('EP canonical writer owns every clip ID', () => { const { plan } = build(); assert.equal(plan.clip_instances.every((clip) => /^edit-clip-/.test(clip.clip_instance_id)), true); });
test('EP one source can have multiple clip instances', () => { const { plan } = build(); const ids = plan.clip_instances.filter((clip) => clip.source_id === plan.presenter_sources[0].presenter_source_id).map((clip) => clip.clip_instance_id); assert.equal(ids.length, 2); assert.equal(new Set(ids).size, 2); });
test('EP source IDs remain upstream identities', () => { const { plan } = build(); assert.equal(plan.visual_sources[0].visual_source_id, 'asset-conveyor'); assert.equal(plan.sound_sources[0].production_mix_id, 'production-mix-test'); });
test('EP strict unknown action object cannot enter artifact', () => { const { plan, ctx } = build(); plan.action = 'publish'; refresh(plan); code(validate(plan, ctx), 'UNKNOWN_FIELD'); });
test('EP authority calls full validation and digest', () => { const { plan, ctx } = build(); plan.edit_plan_digest_sha256 = H('stale'); const a = ep.evaluateEditPlanAuthority(plan, ctx); assert.equal(a.digest_valid, false); assert.equal(a.qc_handoff_ready, false); });
test('EP authority fails closed without upstream authority context', () => { const { plan } = build(); const a = ep.evaluateEditPlanAuthority(plan); assert.equal(a.qc_handoff_ready, false); assert.ok(a.reasons.includes('AUTHORITY_CONTEXT_REQUIRED')); });
test('EP factual subtitle divergence needs text authority', () => { const { plan, ctx } = build(); const track = plan.timeline.tracks.find((t) => t.role === 'CAPTIONS'); plan.graphic_instances.push({ graphic_instance_id: `edit-graphic-${uid()}`, track_id: track.track_id, text: 'Different factual claim', text_kind: 'CAPTION', text_authority_ref: null, timeline_range: range(0, 20), style_template_ref: null, section_id: SECTIONS[0].section_id, research_refs: [] }); refresh(plan); code(validate(plan, ctx), 'TEXT_AUTHORITY_REQUIRED'); });
test('EP actual proof provenance survives Resolve projection', () => { const { plan, ctx } = build(); const handoff = ep.buildResolveHandoff(plan, ctx); const source = plan.visual_sources.find((item) => item.visual_source_id === 'asset-screen-proof'); assert.equal(source.provenance_class, 'AUTHENTIC_UI_PROOF'); assert.ok(handoff.sources.find((item) => item.source_id === source.visual_source_id)); });
test('EP Sound placement survives Resolve projection without treatment', () => { const { plan, ctx } = build(); const h = ep.buildResolveHandoff(plan, ctx); assert.equal(h.sound_cues[0].production_selection_identity, H('sound-selection')); assert.equal(h.sound_cues[0].eq, undefined); });

test('EP standalone harness marker', () => assert.ok(fs.readFileSync(__filename, 'utf8').includes('Edit Plan V1 tests passed')));
test('EP canonical runner registration exactly once', () => { const runner = fs.readFileSync(path.join(__dirname, 'run-tests.js'), 'utf8'); assert.equal(runner.split('edit-plan.test.js').length - 1, 1); });

if (require.main === module) {
  (async () => {
    let passed = 0; let failed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); }
      catch (error) { failed += 1; console.error(`not ok - ${item.name}`); console.error(error.stack || error.message); }
    }
    console.log(`${passed}/${passed + failed} Edit Plan V1 tests passed`);
    if (failed) process.exitCode = 1;
  })();
}

module.exports = { tests };
