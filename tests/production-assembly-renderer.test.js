'use strict';

const { test, assert, fs, os, path, childProcess } = require('./_helpers.js');
const crypto = require('node:crypto');
const renderer = require('../scripts/production-assembly-renderer.js');
const boundary = require('../scripts/presenter-boundary-review.js');

const STORY = { project_id: 'story-project', version_id: 'story-v2', content_hash: 'a'.repeat(64), approval_state: 'approved' };
const VP2 = { plan_id: 'vp2', version: 2, digest_sha256: 'b'.repeat(64), approval_state: 'approved' };
const MASTER_SEQUENCE = ['A', 'A', 'T', 'A', 'A', 'A', 'A', 'C', 'C', 'T', 'T'];
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function clone(value) { return structuredClone(value); }
function throwsCode(fn, code) { return assert.rejects(fn, (error) => error.code === code); }
function musicDecision(decisionId, predecessorDecisionId, status, policy, authority, musicSha = null) {
  const entry = { decision_id: decisionId, predecessor_decision_id: predecessorDecisionId, status, policy, authority, decided_at: '2026-08-26T12:30:00Z', music_sha256: musicSha };
  entry.binding_digest_sha256 = renderer.musicDecisionDigest(entry);
  return entry;
}
function setHumanMusic(spec, policy, musicSha = null, fields = {}) {
  spec.music = { policy, sha256: musicSha, ...fields };
  spec.music.policy_history = [musicDecision(`human-${policy}`, null, 'ACTIVE', policy, { type: 'HUMAN', id: 'Mikko Pakkala' }, musicSha)];
}

async function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-assembler-'));
  const out = path.join(root, 'out'); fs.mkdirSync(out);
  const masters = {};
  for (const id of ['A', 'T', 'C']) { const filePath = path.join(root, `master-${id}.mp4`); fs.writeFileSync(filePath, `human-${id}`); masters[id] = { path: filePath, sha256: sha(`human-${id}`) }; }
  const review = {
    schema: boundary.SUCCESSOR_SCHEMA, artifact_type: 'human-performance-review', review_version: 2,
    review_id: 'review-v2', run_id: 'run-1', verdict: 'KEEP_ALL', verdict_scope: 'human intervals; not edit approval',
    reviewer: { type: 'HUMAN', id: 'Mikko Pakkala' }, reviewed_at: '2026-08-26T12:00:00Z',
    predecessor_review: { path: 'review-v1.json', sha256: 'c'.repeat(64), verdict: 'KEEP ALL', reviewed_at: '2026-08-26T11:00:00Z' },
    story: STORY, visual_plan: VP2,
    masters: ['A', 'T', 'C'].map((id) => ({ master_id: id, media_sha256: masters[id].sha256, sections_declared: MASTER_SEQUENCE.map((item, index) => item === id ? `S${index + 1}` : null).filter(Boolean) })),
    segments: [], boundary_review_digest_sha256: 'd'.repeat(64), binding_digest_sha256: '',
  };
  const cursors = { A: 0, T: 0, C: 0 };
  for (let index = 0; index < 11; index += 1) {
    const id = MASTER_SEQUENCE[index]; const inMs = cursors[id]; const outMs = inMs + 100; cursors[id] = outMs;
    review.segments.push({ segment_id: `seg-${index + 1}`, section_id: `S${index + 1}`, recording_unit_id: `unit-${index + 1}`, master_id: id, master_sha256: masters[id].sha256, in_ms: inMs, out_ms: outMs, duration_ms: 100, boundary_class: 'HUMAN_CONFIRMED', human_confirmer: review.reviewer, confirmation_digest_sha256: String(index + 1).padStart(64, '0'), planned_framing: 'planned', captured_framing: 'captured', crop_policy: { class: 'DETERMINISTIC_TECHNICAL_IMPLEMENTATION' } });
  }
  review.binding_digest_sha256 = boundary.successorDigest(review);
  const reviewPath = path.join(root, 'review-v2.json'); writeJson(reviewPath, review);
  const packet = {
    schema: renderer.PACKET_SCHEMA, artifact_type: 'production-assembly-release-packet', run_id: 'run-1', story: STORY, visual_plan: VP2,
    presenter_sources: review.segments.map((segment, index) => ({ section_id: segment.section_id, recording_unit_id: segment.recording_unit_id, selected_segment_id: segment.segment_id, master_id: segment.master_id, master_media_path: masters[segment.master_id].path, master_media_sha256: segment.master_sha256, in_ms: segment.in_ms, out_ms: segment.out_ms, duration_ms: segment.duration_ms, story: STORY, visual_plan: VP2, planned_framing: 'planned', captured_framing: 'captured', crop_policy: segment.crop_policy, quality_class: 'PROOF_CAPTURE', capture_provenance: {}, derivative_is_authority: false, story_order: index + 1 })),
    human_review_binding_sha256: review.binding_digest_sha256,
    insert_policy: [
      { shot_id: 'useful-s2', section_order: 2, section_id: 'S2', necessity: 'USEFUL' },
      { shot_id: 'optional-s4', section_order: 4, section_id: 'S4', necessity: 'OPTIONAL' },
      { shot_id: 'essential-s9', section_order: 9, section_id: 'S9', necessity: 'ESSENTIAL' },
    ],
    crop_policy: {}, music_policy: { sha256: null }, section_story_order: Array.from({ length: 11 }, (_, index) => index + 1),
    output_class: 'PRODUCTION_ASSEMBLY_CANDIDATE', evidence_class: 'PROPOSED_PRODUCTION_ASSEMBLY_TECHNICAL_EVIDENCE', gate_authority: false,
    forbidden_sources: ['DRAFT_SYNTHETIC_NARRATION', 'PROXY_PRESENTER', 'DRAFT_V1'], ready: true, blockers: [],
  };
  const insertPath = path.join(root, 'essential.png'); fs.writeFileSync(insertPath, 'image');
  const packetPath = path.join(root, 'packet.json'); writeJson(packetPath, packet);
  const spec = {
    schema: renderer.SPEC_SCHEMA, run_id: 'run-1', performance_role: 'HUMAN_DRAFT_PERFORMANCE',
    output_class: 'PRODUCTION_ASSEMBLY_CANDIDATE', evidence_class: 'PROPOSED_PRODUCTION_ASSEMBLY_TECHNICAL_EVIDENCE', gate_authority: false,
    input_roots: [root], output_root: out,
    release_packet: { path: packetPath, sha256: await renderer.sha256File(packetPath) },
    human_review: { path: reviewPath, file_sha256: await renderer.sha256File(reviewPath) }, story: STORY, visual_plan: VP2,
    forbidden_media_sha256: ['f'.repeat(64)],
    crops: ['A', 'T', 'C'].map((id) => ({ master_id: id, x: 10, y: 0, width: 608, height: 1080 })),
    inserts: [
      { shot_id: 'useful-s2', section_order: 2, section_id: 'S2', necessity: 'USEFUL', decision: 'FALLBACK_A_ROLL' },
      { shot_id: 'optional-s4', section_order: 4, section_id: 'S4', necessity: 'OPTIONAL', decision: 'OMIT' },
      { shot_id: 'essential-s9', section_order: 9, section_id: 'S9', necessity: 'ESSENTIAL', decision: 'RENDER', asset_path: insertPath, asset_sha256: sha('image'), start_offset_ms: 0, end_offset_ms: 100 },
    ],
    music: {}, producer: { type: 'TOOL', id: 'test' },
    output: { relative_path: 'candidate.mp4', width: 1080, height: 1920, fps: 30, video_codec: 'libx264', audio_codec: 'aac', audio_sample_rate: 48000, audio_channels: 2, preset: 'ultrafast', crf: 30 },
  };
  setHumanMusic(spec, 'NONE');
  const specPath = path.join(root, 'spec.json'); writeJson(specPath, spec);
  const fakeProbe = (filePath) => filePath.includes('.partial') || filePath.endsWith('candidate.mp4')
    ? { duration_ms: 1133, video: { codec: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1', nb_frames: 34 }, audio: { codec: 'aac', sample_rate: 48000, channels: 2 } }
    : { duration_ms: 1000, video: { codec: 'h264', width: 1920, height: 1080, avg_frame_rate: options.vfr ? '24000/1001' : '30/1', nb_frames: 24 }, audio: { codec: 'aac', sample_rate: 48000, channels: 2 } };
  const save = () => { writeJson(reviewPath, review); packet.human_review_binding_sha256 = review.binding_digest_sha256; writeJson(packetPath, packet); spec.release_packet.sha256 = sha(fs.readFileSync(packetPath)); spec.human_review.file_sha256 = sha(fs.readFileSync(reviewPath)); writeJson(specPath, spec); };
  return { root, out, masters, review, reviewPath, packet, packetPath, spec, specPath, insertPath, fakeProbe, save };
}

async function addComposition(f) {
  const composition = require('../scripts/production-assembly-composition.js');
  const designPath = path.join(f.root, 'v2-design.json'); const vp3Path = path.join(f.root, 'vp3.json'); const assetPath = path.join(f.root, 'visual.png'); const assetManifestPath = path.join(f.root, 'assets.json');
  writeJson(designPath, { schema: 'vidtoolz.productionAssemblySpec.v2', beats: 11 });
  writeJson(vp3Path, { plan_id: 'vp3', digest_sha256: '7'.repeat(64) }); fs.writeFileSync(assetPath, 'visual');
  const beatIds = Array.from({ length: 11 }, (_, index) => `C${index + 1}`);
  const assetManifest = { schema: composition.ASSET_MANIFEST_SCHEMA, run_id: f.spec.run_id, assets: [{ asset_id: 'visual', role: 'STATIC_GENERATED_IMAGE_WITH_MOTION', path: assetPath, sha256: sha('visual'), media_kind: 'IMAGE', width: 1920, height: 1080, provenance: { producer: 'test' }, status: 'ACCEPTED', policy: 'REQUIRED', intended_beat_ids: beatIds }] };
  writeJson(assetManifestPath, assetManifest);
  f.spec.composition = {
    schema: composition.SCHEMA,
    design_package: { path: designPath, sha256: await renderer.sha256File(designPath), schema: 'vidtoolz.productionAssemblySpec.v2' },
    approved_visual_plan: { path: vp3Path, file_sha256: await renderer.sha256File(vp3Path), plan_id: 'vp3', digest_sha256: '7'.repeat(64) },
    asset_manifest: { path: assetManifestPath, sha256: await renderer.sha256File(assetManifestPath) }, coverage: 'FULL_PROGRAMME', expected_beat_count: 11,
    forbidden_asset_ids: ['v1-overlay'], beats: beatIds.map((beatId, index) => ({ beat_id: beatId, section_id: `S${index + 1}`, start_ms: index * 100, end_ms: (index + 1) * 100, primary_owner: 'GENERATED_VISUAL', transition_in: 'CUT', transition_out: 'CUT', layers: [{ layer_id: 'visual', type: 'FULL_CANVAS_VISUAL', primary: true, z: 1, asset_id: 'visual', fit: 'COVER', duration_policy: 'STILL', asset_in_ms: 0, replaces_insert_ids: index === 8 ? ['essential-s9'] : [] }] })),
  };
  f.spec.inserts.find((item) => item.shot_id === 'essential-s9').decision = 'REPLACED_BY_COMPOSITION';
  delete f.spec.inserts.find((item) => item.shot_id === 'essential-s9').asset_path; delete f.spec.inserts.find((item) => item.shot_id === 'essential-s9').asset_sha256;
  f.save();
}

test('PAR-01 valid eligible HUMAN_DRAFT handoff validates', async () => { const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); assert.equal(checked.sources.length, 11); });
test('PAR-02 provisional boundary is rejected', async () => { const f = await fixture(); f.review.segments[0].boundary_class = 'MACHINE_INFERRED_PROVISIONAL'; f.review.binding_digest_sha256 = boundary.successorDigest(f.review); f.save(); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'PROVISIONAL_BOUNDARY_FORBIDDEN'); });
test('PAR-03 Story drift is rejected', async () => { const f = await fixture(); f.spec.story.version_id = 'drift'; await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'SPEC_STORY_PLAN_DRIFT'); });
test('PAR-04 VP2 drift is rejected', async () => { const f = await fixture(); f.spec.visual_plan.digest_sha256 = 'e'.repeat(64); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'SPEC_STORY_PLAN_DRIFT'); });
test('PAR-05 human review byte drift is rejected', async () => { const f = await fixture(); fs.appendFileSync(f.reviewPath, ' '); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'HUMAN_REVIEW_FILE_DRIFT'); });
test('PAR-06 master byte drift is rejected', async () => { const f = await fixture(); fs.appendFileSync(f.masters.A.path, 'changed'); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'MASTER_SHA_DRIFT'); });
test('PAR-07 known proxy/Piper bytes are rejected regardless of filename', async () => { const f = await fixture(); f.spec.forbidden_media_sha256 = [f.masters.A.sha256]; await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'FORBIDDEN_MEDIA_BYTES'); });
test('PAR-08 multi-section masters are ordered by Story, not master', async () => { const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const plan = renderer.buildPlan(f.spec, checked); assert.deepEqual(plan.timeline.map((x) => x.master_id), MASTER_SEQUENCE); assert.deepEqual(plan.timeline.map((x) => x.story_order), [1,2,3,4,5,6,7,8,9,10,11]); });
test('PAR-09 exact integer-ms trims are retained in the plan and command', async () => { const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const plan = renderer.buildPlan(f.spec, checked); assert.equal(plan.programme_duration_ms, 1100); assert.ok(renderer.buildFfmpegCommand(plan, '/tmp/staged.mp4').includes('0.100000')); });
test('PAR-10 floating boundary is rejected', async () => { const f = await fixture(); f.packet.presenter_sources[0].out_ms = 100.5; f.save(); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'SEGMENT_REVIEW_DRIFT'); });
test('PAR-11 VFR source remains accepted while output plan is explicit CFR30', async () => { const f = await fixture({ vfr: true }); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const plan = renderer.buildPlan(f.spec, checked); assert.equal(plan.output.fps, 30); assert.ok(renderer.buildFfmpegCommand(plan, '/tmp/staged.mp4').join(' ').includes('fps=30')); });
test('PAR-12 out-of-bounds crop is rejected', async () => { const f = await fixture(); f.spec.crops[0].x = 1400; await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'CROP_OUT_OF_BOUNDS'); });
test('PAR-13 crop data is deterministic plan authority, not a global default', async () => { const f = await fixture(); f.spec.crops[0].x = 745; const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); assert.equal(renderer.buildPlan(f.spec, checked).timeline[0].crop.x, 745); });
test('PAR-14 missing essential insert is rejected', async () => { const f = await fixture(); f.spec.inserts = f.spec.inserts.filter((x) => x.necessity !== 'ESSENTIAL'); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'ESSENTIAL_INSERT_REQUIRED'); });
test('PAR-15 useful fallback and optional omission are explicit and valid', async () => { const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); assert.deepEqual(checked.inserts.slice(0, 2).map((x) => x.decision), ['FALLBACK_A_ROLL', 'OMIT']); });
test('PAR-16 missing music policy is rejected', async () => { const f = await fixture(); f.spec.music = {}; await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'MUSIC_POLICY_REQUIRED'); });
test('PAR-17 AGENT_DEFAULT cannot become durable creative music authority', async () => { const f = await fixture(); const musicPath = path.join(f.root, 'music.wav'); fs.writeFileSync(musicPath, 'music'); f.spec.music = { policy: 'FADE_EARLY', path: musicPath, sha256: sha('music'), fade_start_ms: 500, fade_duration_ms: 100, gain_db: -14, policy_history: [musicDecision('agent-default', null, 'ACTIVE', 'FADE_EARLY', { type: 'AGENT_DEFAULT', id: 'hermes' }, sha('music'))] }; f.packet.music_policy = { sha256: f.spec.music.sha256, option: 'B' }; f.save(); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'MUSIC_HUMAN_AUTHORITY_REQUIRED'); });
test('PAR-18 exact human FADE_EARLY policy enters deterministic command', async () => { const f = await fixture(); const musicPath = path.join(f.root, 'music.wav'); fs.writeFileSync(musicPath, 'music'); setHumanMusic(f.spec, 'FADE_EARLY', sha('music'), { path: musicPath, fade_start_ms: 500, fade_duration_ms: 100, gain_db: -14 }); f.packet.music_policy = { sha256: f.spec.music.sha256, option: 'B' }; f.save(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); assert.ok(renderer.buildFfmpegCommand(renderer.buildPlan(f.spec, checked), '/tmp/staged.mp4').join(' ').includes('afade=t=out:st=0.500000:d=0.100000')); });
test('PAR-18b NONE cannot bypass packet-bound music', async () => { const f = await fixture(); f.packet.music_policy.sha256 = 'e'.repeat(64); f.save(); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'MUSIC_PACKET_DRIFT'); });
test('PAR-18c LOOP_WITH_CROSSFADE is explicit and deterministic', async () => { const f = await fixture(); const musicPath = path.join(f.root, 'music.wav'); fs.writeFileSync(musicPath, 'music'); setHumanMusic(f.spec, 'LOOP_WITH_CROSSFADE', sha('music'), { path: musicPath, crossfade_ms: 100, gain_db: -14 }); f.packet.music_policy = { sha256: f.spec.music.sha256, option: 'A' }; f.save(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const command = renderer.buildFfmpegCommand(renderer.buildPlan(f.spec, checked), '/tmp/staged.mp4').join(' '); assert.ok(command.includes('acrossfade=d=0.100000')); });
test('PAR-19 paths cannot escape allowed roots', async () => { const f = await fixture(); f.packet.presenter_sources[0].master_media_path = '/etc/passwd'; f.packet.presenter_sources[0].master_media_sha256 = sha(fs.readFileSync('/etc/passwd')); f.review.segments[0].master_sha256 = f.packet.presenter_sources[0].master_media_sha256; f.review.binding_digest_sha256 = boundary.successorDigest(f.review); f.save(); await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'INPUT_PATH_OUTSIDE_ALLOWED_ROOT'); });
test('PAR-20 interruption before render leaves no candidate', async () => { const f = await fixture(); await throwsCode(() => renderer.renderFromSpec(f.specPath, { probeMedia: f.fakeProbe, failAt: 'before-render' }), 'INJECTED_INTERRUPTION'); assert.equal(fs.existsSync(path.join(f.out, 'candidate.mp4')), false); });
test('PAR-21 render failure leaves state incomplete and no candidate', async () => { const f = await fixture(); await assert.rejects(() => renderer.renderFromSpec(f.specPath, { probeMedia: f.fakeProbe, render: async () => { throw new Error('crash'); } })); assert.equal(fs.existsSync(path.join(f.out, 'candidate.mp4')), false); assert.equal(JSON.parse(fs.readFileSync(path.join(f.out, 'candidate.state.json'))).state, 'INCOMPLETE'); });
test('PAR-22 completed render without evidence remains non-authoritative', async () => { const f = await fixture(); await throwsCode(() => renderer.renderFromSpec(f.specPath, { probeMedia: f.fakeProbe, decode: false, render: async (_, staged) => fs.writeFileSync(staged, 'candidate'), failAt: 'evidence', ffmpegVersion: 'ffmpeg test', ffprobeVersion: 'ffprobe test' }), 'INJECTED_EVIDENCE_FAILURE'); assert.equal(fs.existsSync(path.join(f.out, 'candidate.complete.json')), false); assert.equal(fs.existsSync(path.join(f.out, 'candidate.mp4')), false); });
test('PAR-23 retry after partial state deterministically closes', async () => { const f = await fixture(); await assert.rejects(() => renderer.renderFromSpec(f.specPath, { probeMedia: f.fakeProbe, render: async () => { throw new Error('crash'); } })); const result = await renderer.renderFromSpec(f.specPath, { probeMedia: f.fakeProbe, decode: false, render: async (_, staged) => fs.writeFileSync(staged, 'candidate'), ffmpegVersion: 'ffmpeg test', ffprobeVersion: 'ffprobe test' }); assert.equal(result.status, 'COMPLETE'); });
test('PAR-24 COMPLETE marker is written only after manifest and evidence', async () => { const f = await fixture(); const result = await renderer.renderFromSpec(f.specPath, { probeMedia: f.fakeProbe, decode: false, render: async (_, staged) => fs.writeFileSync(staged, 'candidate'), ffmpegVersion: 'ffmpeg test', ffprobeVersion: 'ffprobe test' }); assert.equal(result.completion.state, 'COMPLETE'); assert.ok(fs.existsSync(result.paths.manifest)); assert.ok(fs.existsSync(result.paths.evidence)); assert.ok(fs.existsSync(result.paths.output)); });
test('PAR-25 exact rerun is idempotently reused', async () => { const f = await fixture(); const options = { probeMedia: f.fakeProbe, decode: false, render: async (_, staged) => fs.writeFileSync(staged, 'candidate'), ffmpegVersion: 'ffmpeg test', ffprobeVersion: 'ffprobe test' }; await renderer.renderFromSpec(f.specPath, options); const second = await renderer.renderFromSpec(f.specPath, options); assert.equal(second.status, 'REUSED'); });
test('PAR-26 evidence is explicitly non-gating and excludes final claims', async () => { const f = await fixture(); const result = await renderer.renderFromSpec(f.specPath, { probeMedia: f.fakeProbe, decode: false, render: async (_, staged) => fs.writeFileSync(staged, 'candidate'), ffmpegVersion: 'ffmpeg test', ffprobeVersion: 'ffprobe test' }); assert.equal(result.evidence.gate_authority, false); assert.ok(result.evidence.negative_claims.includes('not Gate 10 authority')); assert.equal(JSON.stringify(result.evidence).includes('DRAFT_ASSEMBLY'), false); });

test('PAR-27 append-only human music successor supersedes AGENT_DEFAULT', async () => {
  const f = await fixture(); const musicPath = path.join(f.root, 'music.wav'); fs.writeFileSync(musicPath, 'music');
  const first = musicDecision('agent-default', null, 'SUPERSEDED', 'FADE_EARLY', { type: 'AGENT_DEFAULT', id: 'hermes' }, sha('music'));
  const second = musicDecision('human-b', first.decision_id, 'ACTIVE', 'FADE_EARLY', { type: 'HUMAN', id: 'Mikko Pakkala' }, sha('music'));
  f.spec.music = { policy: 'FADE_EARLY', path: musicPath, sha256: sha('music'), fade_start_ms: 500, fade_duration_ms: 100, gain_db: -14, policy_history: [first, second] };
  f.packet.music_policy = { sha256: sha('music'), option: 'B' }; f.save();
  const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); assert.equal(checked.musicDecision.decision_id, 'human-b');
});
test('PAR-28 tampered or non-linear music succession is rejected', async () => {
  const f = await fixture(); f.spec.music.policy_history[0].predecessor_decision_id = 'invented';
  await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'MUSIC_POLICY_HISTORY_INVALID');
});
test('PAR-29 FINAL_HUMAN_PERFORMANCE requires PRODUCTION_CAPTURE sources', async () => {
  const f = await fixture(); f.spec.performance_role = 'FINAL_HUMAN_PERFORMANCE';
  await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }), 'HUMAN_SOURCE_SEMANTICS_INVALID');
  f.packet.presenter_sources.forEach((source) => { source.quality_class = 'PRODUCTION_CAPTURE'; }); f.save();
  const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); assert.equal(checked.sources[0].quality_class, 'PRODUCTION_CAPTURE');
});
test('PAR-30 active render lock blocks concurrent invocation and records start identity', async () => {
  const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const plan = renderer.buildPlan(f.spec, checked);
  const base = path.join(f.out, 'candidate'); const paths = { output: `${base}.mp4`, staged: `${base}.partial.mp4`, state: `${base}.state.json`, manifest: `${base}.manifest.json`, evidence: `${base}.evidence.json`, completion: `${base}.complete.json`, lock: `${base}.lock.json` };
  const options = { hostname: 'test-host', currentProcessIdentity: 'boot:100', processIdentity: () => 'boot:100', processAlive: () => true };
  const owned = renderer.acquireRenderLock(paths, plan, options); assert.equal(readLock(paths.lock).process_start_identity, 'boot:100');
  assert.throws(() => renderer.acquireRenderLock(paths, plan, options), (error) => error.code === 'RENDER_LOCK_ACTIVE'); renderer.releaseRenderLock(paths.lock, owned);
});
test('PAR-31 PID reuse is not mistaken for the original live holder', async () => {
  const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const plan = renderer.buildPlan(f.spec, checked);
  const base = path.join(f.out, 'candidate'); const paths = { output: `${base}.mp4`, staged: `${base}.partial.mp4`, state: `${base}.state.json`, manifest: `${base}.manifest.json`, evidence: `${base}.evidence.json`, completion: `${base}.complete.json`, lock: `${base}.lock.json` };
  writeJson(paths.lock, { schema: renderer.LOCK_SCHEMA, owner_token: 'old', pid: 42, process_start_identity: 'boot:old', hostname: 'test-host', plan_digest_sha256: plan.plan_digest_sha256 });
  const owned = renderer.acquireRenderLock(paths, plan, { hostname: 'test-host', currentProcessIdentity: 'boot:new-owner', processAlive: () => true, processIdentity: () => 'boot:reused', sleep: () => {} });
  assert.equal(readLock(paths.lock).owner_token, owned.owner_token); assert.ok(fs.readdirSync(f.out).some((name) => name.includes('.stale-'))); renderer.releaseRenderLock(paths.lock, owned);
});
test('PAR-32 malformed or remote lock fails closed', async () => {
  const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const plan = renderer.buildPlan(f.spec, checked);
  const base = path.join(f.out, 'candidate'); const paths = { output: `${base}.mp4`, staged: `${base}.partial.mp4`, state: `${base}.state.json`, manifest: `${base}.manifest.json`, evidence: `${base}.evidence.json`, completion: `${base}.complete.json`, lock: `${base}.lock.json` };
  fs.writeFileSync(paths.lock, '{'); assert.throws(() => renderer.acquireRenderLock(paths, plan, { currentProcessIdentity: 'boot:new' }), (error) => error.code === 'RENDER_LOCK_MALFORMED'); fs.unlinkSync(paths.lock);
  writeJson(paths.lock, { schema: renderer.LOCK_SCHEMA, owner_token: 'old', pid: 42, process_start_identity: 'boot:old', hostname: 'other-host', plan_digest_sha256: plan.plan_digest_sha256 });
  assert.throws(() => renderer.acquireRenderLock(paths, plan, { hostname: 'test-host', currentProcessIdentity: 'boot:new' }), (error) => error.code === 'RENDER_LOCK_REMOTE_UNPROVABLE');
});
test('PAR-33 changing output prevents stale-holder recovery', async () => {
  const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const plan = renderer.buildPlan(f.spec, checked);
  const base = path.join(f.out, 'candidate'); const paths = { output: `${base}.mp4`, staged: `${base}.partial.mp4`, state: `${base}.state.json`, manifest: `${base}.manifest.json`, evidence: `${base}.evidence.json`, completion: `${base}.complete.json`, lock: `${base}.lock.json` };
  writeJson(paths.lock, { schema: renderer.LOCK_SCHEMA, owner_token: 'old', pid: 42, process_start_identity: 'boot:old', hostname: 'test-host', plan_digest_sha256: plan.plan_digest_sha256 }); fs.writeFileSync(paths.staged, 'a');
  assert.throws(() => renderer.acquireRenderLock(paths, plan, { hostname: 'test-host', currentProcessIdentity: 'boot:new', processAlive: () => false, sleep: () => fs.appendFileSync(paths.staged, 'b') }), (error) => error.code === 'RENDER_LOCK_OUTPUT_ACTIVE');
});
test('PAR-34 evidence failure resumes exact staged bytes without rerender', async () => {
  const f = await fixture(); let renders = 0; const options = { probeMedia: f.fakeProbe, decode: false, render: async (_, staged) => { renders += 1; fs.mkdirSync(path.dirname(staged), { recursive: true }); fs.writeFileSync(staged, 'candidate'); }, ffmpegVersion: 'ffmpeg test', ffprobeVersion: 'ffprobe test' };
  await throwsCode(() => renderer.renderFromSpec(f.specPath, { ...options, failAt: 'evidence' }), 'INJECTED_EVIDENCE_FAILURE');
  const result = await renderer.renderFromSpec(f.specPath, options); assert.equal(result.status, 'RECOVERED_COMPLETE'); assert.equal(renders, 1);
});
test('PAR-35 crash after candidate rename recovers COMPLETE without rerender', async () => {
  const f = await fixture(); let renders = 0; const options = { probeMedia: f.fakeProbe, decode: false, render: async (_, staged) => { renders += 1; fs.mkdirSync(path.dirname(staged), { recursive: true }); fs.writeFileSync(staged, 'candidate'); }, ffmpegVersion: 'ffmpeg test', ffprobeVersion: 'ffprobe test' };
  await throwsCode(() => renderer.renderFromSpec(f.specPath, { ...options, failAt: 'after-finalize' }), 'INJECTED_INTERRUPTION');
  const result = await renderer.renderFromSpec(f.specPath, options); assert.equal(result.status, 'RECOVERED_COMPLETE'); assert.equal(renders, 1);
});
test('PAR-36 completed candidate refuses a different render plan', async () => {
  const f = await fixture(); const options = { probeMedia: f.fakeProbe, decode: false, render: async (_, staged) => { fs.mkdirSync(path.dirname(staged), { recursive: true }); fs.writeFileSync(staged, 'candidate'); }, ffmpegVersion: 'ffmpeg test', ffprobeVersion: 'ffprobe test' };
  await renderer.renderFromSpec(f.specPath, options); f.spec.crops[0].x = 11; writeJson(f.specPath, f.spec);
  await throwsCode(() => renderer.renderFromSpec(f.specPath, options), 'EXISTING_OUTPUT_CONFLICT');
});
test('PAR-37 QC fails closed when ffprobe cannot measure a positive frame count', async () => {
  const f = await fixture(); const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const plan = renderer.buildPlan(f.spec, checked);
  const noFrames = () => ({ duration_ms: 1100, video: { codec: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1', nb_frames: null }, audio: { codec: 'aac', sample_rate: 48000, channels: 2 } });
  assert.throws(() => renderer.qcCandidate('/tmp/not-read-with-injected-probe.mp4', plan, { probeMedia: noFrames, decode: false }), (error) => error.code === 'OUTPUT_QC_FRAME_COUNT_FAILED');
});
function readLock(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }

test('PAR-38 real ffmpeg canary covers VFR-like interleave, crop, essential overlay, music fade, QC, evidence and idempotency', async () => {
  if (childProcess.spawnSync('ffmpeg', ['-version']).status !== 0) return;
  const f = await fixture();
  for (const [index, id] of ['A', 'T', 'C'].entries()) {
    childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${['blue','green','purple'][index]}:s=640x360:r=24000/1001`, '-f', 'lavfi', '-i', `sine=frequency=${400 + index * 100}:sample_rate=48000`, '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-ac', '2', f.masters[id].path]);
    f.masters[id].sha256 = await renderer.sha256File(f.masters[id].path);
  }
  for (const segment of f.review.segments) segment.master_sha256 = f.masters[segment.master_id].sha256;
  f.review.masters.forEach((master) => { master.media_sha256 = f.masters[master.master_id].sha256; });
  f.review.binding_digest_sha256 = boundary.successorDigest(f.review);
  f.packet.presenter_sources.forEach((source) => { source.master_media_sha256 = f.masters[source.master_id].sha256; });
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=1080x1920', '-frames:v', '1', f.insertPath]);
  f.spec.inserts.find((item) => item.necessity === 'ESSENTIAL').asset_sha256 = await renderer.sha256File(f.insertPath);
  f.spec.crops = ['A', 'T', 'C'].map((id) => ({ master_id: id, x: 210, y: 0, width: 203, height: 360 }));
  const musicPath = path.join(f.root, 'music.wav'); childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '1', '-ac', '2', musicPath]);
  const musicSha = await renderer.sha256File(musicPath); setHumanMusic(f.spec, 'FADE_EARLY', musicSha, { path: musicPath, fade_start_ms: 700, fade_duration_ms: 200, gain_db: -18 }); f.packet.music_policy = { sha256: musicSha, option: 'B' };
  f.save();
  const result = await renderer.renderFromSpec(f.specPath, { quiet: true });
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.manifest.timeline.map((item) => item.master_id).join(''), MASTER_SEQUENCE.join(''));
  const probe = renderer.probeMedia(result.paths.output); assert.equal(probe.video.width, 1080); assert.equal(probe.video.height, 1920); assert.equal(probe.video.avg_frame_rate, '30/1'); assert.ok(probe.audio);
  const second = await renderer.renderFromSpec(f.specPath, { quiet: true }); assert.equal(second.status, 'REUSED');
});

test('PAR-39 preview uses the exact frozen composition graph and writes no Production COMPLETE marker', async () => {
  const f = await fixture(); await addComposition(f); let previewCommand;
  const result = await renderer.renderPreviewFromSpec(f.specPath, { beat: 'C2', output: 'previews/c2.mp4' }, { probeMedia: f.fakeProbe, render: async (command, output) => { previewCommand = command; fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, 'preview'); } });
  const checked = await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }); const full = renderer.buildFfmpegCommand(renderer.buildPlan(f.spec, checked), '<STAGING>');
  assert.equal(previewCommand[previewCommand.indexOf('-filter_complex') + 1], full[full.indexOf('-filter_complex') + 1]);
  assert.equal(result.metadata.authority, 'NON_AUTHORITATIVE_ENGINEERING_PREVIEW'); assert.equal(fs.existsSync(path.join(f.out, 'candidate.complete.json')), false);
});

test('PAR-40 composition is frozen into plan identity and a geometry change changes the digest', async () => {
  const f = await fixture(); await addComposition(f); const first = renderer.buildPlan(f.spec, await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe }));
  f.spec.composition.beats[0].layers.push({ layer_id: 'presenter', type: 'PRESENTER', primary: false, z: 2, visible: true, geometry: { x: 700, y: 1250, width: 360, height: 640, anchor: 'TOP_LEFT', bleed: [], edge_treatment: { type: 'NONE' } } }); f.save();
  const second = renderer.buildPlan(f.spec, await renderer.validateInputs(f.spec, { probeMedia: f.fakeProbe })); assert.notEqual(first.plan_digest_sha256, second.plan_digest_sha256);
});

test('PAR-41 human-authorized FULL_PROGRAMME music must span the semantic ending', async () => {
  const f = await fixture(); const musicPath = path.join(f.root, 'full-bed.wav'); fs.writeFileSync(musicPath, 'full-bed'); const musicSha = sha('full-bed');
  setHumanMusic(f.spec, 'FULL_PROGRAMME', musicSha, { path: musicPath, gain_db: -18 }); f.packet.music_policy = { sha256: musicSha, decision: 'FULL_PROGRAMME' }; f.save();
  const probe = (filePath) => filePath === musicPath ? { duration_ms: 1200, video: null, audio: { codec: 'pcm_s16le', sample_rate: 48000, channels: 2 } } : f.fakeProbe(filePath);
  const checked = await renderer.validateInputs(f.spec, { probeMedia: probe }); const plan = renderer.buildPlan(f.spec, checked); const command = renderer.buildFfmpegCommand(plan, '/tmp/staged.mp4').join(' ');
  assert.ok(command.includes('whole_dur=1.100000')); assert.equal(plan.music.policy, 'FULL_PROGRAMME');
  f.spec.music.path = path.join(f.root, 'short.wav'); fs.writeFileSync(f.spec.music.path, 'short'); f.spec.music.sha256 = sha('short'); f.spec.music.policy_history[0].music_sha256 = f.spec.music.sha256; f.spec.music.policy_history[0].binding_digest_sha256 = renderer.musicDecisionDigest(f.spec.music.policy_history[0]); f.packet.music_policy.sha256 = f.spec.music.sha256; f.save();
  await throwsCode(() => renderer.validateInputs(f.spec, { probeMedia: (filePath) => filePath === f.spec.music.path ? { duration_ms: 500, video: null, audio: { codec: 'pcm_s16le', sample_rate: 48000, channels: 2 } } : f.fakeProbe(filePath) }), 'MUSIC_FULL_PROGRAMME_TOO_SHORT');
});

function alphaAsset(overrides = {}) {
  return { asset_id: 'presenter-A', path: '/tmp/presenter.webm', duration_ms: 1000, alpha: { required: true, format: 'VP9_ALPHA', codec: 'vp9', decoder: 'libvpx-vp9' }, ...overrides };
}
test('PAR-42 alpha-required VP9 validates only with available explicit decoder and nontrivial alpha', () => {
  const media = { video: { codec: 'vp9' } }; const options = { ffmpegDecoders: () => ' V....D libvpx-vp9 libvpx VP9', inspectAlpha: () => ({ sample_count: 3, alpha_min: 0, alpha_max: 255 }) };
  const result = renderer.validatePresenterAlphaAsset(alphaAsset(), media, options); assert.equal(result.selected_decoder, 'libvpx-vp9'); assert.equal(result.alpha_nontrivial, true);
});
test('PAR-43 missing alpha decoder fails before render', () => { assert.throws(() => renderer.validatePresenterAlphaAsset(alphaAsset(), { video: { codec: 'vp9' } }, { ffmpegDecoders: () => ' V....D vp9 native' }), (error) => error.code === 'PA_ALPHA_DECODER_UNAVAILABLE'); });
test('PAR-44 opaque and fully transparent alpha-required inputs fail closed', () => {
  const base = { ffmpegDecoders: () => ' V....D libvpx-vp9' };
  assert.throws(() => renderer.validatePresenterAlphaAsset(alphaAsset(), { video: { codec: 'vp9' } }, { ...base, inspectAlpha: () => ({ sample_count: 3, alpha_min: 255, alpha_max: 255 }) }), (error) => error.code === 'PA_REQUIRED_ALPHA_MISSING');
  assert.throws(() => renderer.validatePresenterAlphaAsset(alphaAsset(), { video: { codec: 'vp9' } }, { ...base, inspectAlpha: () => ({ sample_count: 3, alpha_min: 0, alpha_max: 0 }) }), (error) => error.code === 'PA_REQUIRED_ALPHA_MISSING');
});
test('PAR-45 corrupt alpha video and wrong codec fail closed', () => {
  const base = { ffmpegDecoders: () => ' V....D libvpx-vp9' };
  assert.throws(() => renderer.validatePresenterAlphaAsset(alphaAsset(), { video: { codec: 'vp9' } }, { ...base, inspectAlpha: () => { const error = new Error('corrupt'); error.code = 'PA_REQUIRED_ALPHA_MISSING'; throw error; } }), (error) => error.code === 'PA_REQUIRED_ALPHA_MISSING');
  assert.throws(() => renderer.validatePresenterAlphaAsset(alphaAsset(), { video: { codec: 'h264' } }, base), (error) => error.code === 'PA_ALPHA_CODEC_MISMATCH');
  assert.throws(() => renderer.validatePresenterAlphaAsset(alphaAsset({ alpha: { required: true, format: 'UNKNOWN', codec: 'vp9', decoder: 'libvpx-vp9' } }), { video: { codec: 'vp9' } }, base), (error) => error.code === 'PA_ALPHA_FORMAT_UNKNOWN');
});
test('PAR-46 real VP9-alpha reproduces opaque default decode and preserves alpha with canonical libvpx-vp9', () => {
  if (childProcess.spawnSync('ffmpeg', ['-version']).status !== 0) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-alpha-fixture-')); const rgba = path.join(root, 'frames.rgba'); const webm = path.join(root, 'matte.webm');
  const frame = Buffer.alloc(64 * 64 * 4); for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) { const offset = (y * 64 + x) * 4; frame[offset] = 255; frame[offset + 3] = x >= 16 && x < 48 && y >= 16 && y < 48 ? 255 : 0; }
  fs.writeFileSync(rgba, Buffer.concat(Array(30).fill(frame)));
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '64x64', '-framerate', '30', '-i', rgba, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', webm]);
  function range(decoder) { const args = ['-v', 'error']; if (decoder) args.push('-c:v', decoder); args.push('-i', webm, '-frames:v', '1', '-vf', 'format=rgba,alphaextract', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'); const values = childProcess.execFileSync('ffmpeg', args); return { min: Math.min(...values), max: Math.max(...values) }; }
  assert.deepEqual(range(null), { min: 255, max: 255 }); assert.deepEqual(range('libvpx-vp9'), { min: 0, max: 255 });
  const result = renderer.validatePresenterAlphaAsset(alphaAsset({ path: webm }), renderer.probeMedia(webm)); assert.equal(result.alpha_nontrivial, true);
});
