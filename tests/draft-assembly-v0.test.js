'use strict';

/*
 * DRAFT ASSEMBLY V0 — script + narration + visuals + music -> one watchable file.
 *
 * The tests that matter most here are the ones about what the artifact must
 * never claim. A rendered draft is easy to mistake for a cut: it is an MP4, it
 * has pictures and music, and it plays. So the suite asserts, repeatedly, that
 * it does not complete gate 9, does not satisfy real capture, and goes stale the
 * moment anything upstream of it moves.
 *
 * Renders are real ffmpeg renders over real bytes. Fixtures use a small frame
 * and short synthetic visuals so a full assembly costs a second or two; the one
 * place real production media is used, it is used deliberately.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const childProcess = require('node:child_process');

const bindingModule = require('../scripts/draft-assembly-binding.js');
const timeline = require('../scripts/draft-assembly-timeline.js');
const renderModule = require('../scripts/draft-assembly-render.js');
const assembly = require('../scripts/package-run-draft-assembly.js');
const reviewIntake = require('../scripts/draft-review-intake.js');
const narrationModule = require('../scripts/package-run-draft-narration.js');
const proxyPresenter = require('../scripts/package-run-draft-proxy-presenter.js');
const narrationProvider = require('../scripts/synthetic-narration-provider.js');
const productionMode = require('../scripts/package-run-production-mode.js');
const gateModePolicy = require('../scripts/gate-mode-policy.js');
const stateProjection = require('../scripts/package-run-state-projection.js');
const qc = require('../scripts/qc-director.js');
const qcPolicy = require('../scripts/qc-evidence-policy.js');

const ROOT = path.resolve(__dirname, '..');
const CANARY_DIR = path.join(ROOT, 'package-runs', '2026-08-25-lifecycle-integration-canary-canary-not-for-publication');

const UPSTREAM = [
  'final-script.md', 'script-review.md', 'script-structure.md', 'research-pack.md',
  'research-evidence.md', 'research-sufficiency-review.md', 'source-support-map.md',
  'proof-capture-plan.md', 'research-objections.md', 'selected-package.json', 'notes.md',
  'production-plan.md', 'audio-notes.md', 'production-blockers.md', 'shot-list.md',
  'screen-capture-list.md', 'demo-list.md', 'b-roll-list.md', 'graphics-list.md',
  'shot-edit-plan-review.md', 'story-binding.json',
];

const MEDIA_READY = renderModule.rendererReadiness().actionable;
const NARRATION_READY = narrationProvider.providerReadiness().actionable;
// The whole path needs both halves; individual layers are still exercised
// without them wherever the assertion does not depend on real bytes.
const FULL_PATH_READY = MEDIA_READY && NARRATION_READY;

// A small frame keeps a real 75-second render to about a second of CPU while
// still exercising every geometry, concat and mux code path at full fidelity.
const TEST_OUTPUT = { width: 320, height: 180, fps: 24 };

/* ============================== fixtures ================================== */

function ffmpeg(args) {
  childProcess.execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args],
    { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
}

let upstreamSnapshot = null;
function upstreamDir() {
  if (upstreamSnapshot) return upstreamSnapshot;
  const snap = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-upstream-'));
  for (const name of UPSTREAM) {
    const src = path.join(CANARY_DIR, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(snap, name));
  }
  upstreamSnapshot = snap;
  return snap;
}

/*
 * Synthetic source media: distinct enough to tell apart, small enough to be
 * free. Built once and reused, because the point is never the pixels.
 */
let mediaSnapshot = null;
function mediaDir() {
  if (mediaSnapshot) return mediaSnapshot;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-media-'));
  const colors = ['red', 'green', 'blue', 'yellow'];
  colors.forEach((color, index) => {
    // 1.5s clips: shorter than most narration beats, so LOOP is the normal case.
    ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=240x160:d=1.5:r=24`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', path.join(dir, `clip-${index + 1}.mp4`)]);
  });
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=240x160:d=1', '-frames:v', '1', path.join(dir, 'still.png')]);
  // A short music bed, deliberately shorter than any real narration, so the
  // LOOP branch of the music plan is what the fixture exercises.
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=6:sample_rate=48000',
    '-ac', '2', '-c:a', 'pcm_s24le', path.join(dir, 'music.wav')]);
  mediaSnapshot = dir;
  return dir;
}

function explicitVisualSpec(count = 4) {
  const dir = mediaDir();
  const assets = [];
  for (let i = 1; i <= count; i += 1) {
    assets.push({ path: path.join(dir, `clip-${((i - 1) % 4) + 1}.mp4`) });
  }
  return { source_kind: 'EXPLICIT_ASSETS', root: dir, assets };
}

function musicSpec() {
  return { source_kind: 'EXPLICIT_ASSET', path: path.join(mediaDir(), 'music.wav') };
}

/*
 * Every run in this file uses the same run id. Narration and proxy-presenter
 * manifests are bound to it, so a single real capture can be copied into a
 * fresh directory per test instead of re-synthesising 75 seconds of speech
 * forty times. The directories differ; the identity inside them does not.
 */
const FIXTURE_RUN_ID = '2026-08-26-assembly-fixture';

function seedUpstream(dir, options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = upstreamDir();
  for (const name of UPSTREAM) {
    const src = path.join(snapshot, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
  }
  const bindingPath = path.join(dir, 'story-binding.json');
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  binding.run_id = FIXTURE_RUN_ID;
  fs.writeFileSync(bindingPath, JSON.stringify(binding, null, 2));
  if (options.mode !== null) {
    productionMode.setProductionMode(dir, options.mode || productionMode.DRAFT, { setBy: 'generation_supervisor (agent)' });
  }
}

// One real narration and one real proxy presenter, built once.
let captureSnapshot = null;
function captureSnapshotDir() {
  if (captureSnapshot) return captureSnapshot;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-capture-'));
  const dir = path.join(root, 'package-runs', FIXTURE_RUN_ID);
  seedUpstream(dir);
  narrationModule.buildDraftNarration(dir, { taskId: 't-fixture' });
  narrationModule.attestDraftNarration(dir, { taskId: 't-fixture' });
  proxyPresenter.buildDraftProxyPresenter(dir, { taskId: 't-fixture' });
  proxyPresenter.attestProxyPresenter(dir, { taskId: 't-fixture' });
  captureSnapshot = dir;
  return dir;
}

/*
 * A DRAFT run carried as far as gate 8: bound Story, real narration, real proxy
 * presenter. Everything downstream of that is what these tests are about.
 */
function draftRun(label, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `assembly-${label}-`));
  const dir = path.join(root, 'package-runs', FIXTURE_RUN_ID);
  if (options.capture !== false && options.mode !== null && FULL_PATH_READY) {
    fs.cpSync(captureSnapshotDir(), dir, { recursive: true });
  } else {
    seedUpstream(dir, options);
  }
  return { root, dir, runId: FIXTURE_RUN_ID };
}

function bindAssembly(dir, overrides = {}) {
  const binding = bindingModule.buildBinding({
    runId: path.basename(dir),
    boundBy: 'test',
    visuals: overrides.visuals || explicitVisualSpec(),
    music: overrides.music === null ? null : (overrides.music || musicSpec()),
    output: overrides.output === null ? null : (overrides.output || TEST_OUTPUT),
    policy: overrides.policy || { visual_shortfall: 'CYCLE' },
  });
  bindingModule.writeBinding(dir, binding, { replace: true });
  return binding;
}

// One fully built run, shared by every test that only reads the result.
let builtRun = null;
function builtDraft() {
  if (builtRun) return builtRun;
  const run = draftRun('built');
  bindAssembly(run.dir);
  const result = assembly.buildDraftAssembly(run.dir);
  const evidence = assembly.attestDraftAssembly(run.dir);
  builtRun = { ...run, result, evidence };
  return builtRun;
}

/* ===================== BINDING: the V0 input contract ===================== */

test('DAB1: the binding discovers an aigen resolve-handoff clip list in its recorded order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-aigen-'));
  fs.mkdirSync(path.join(dir, 'resolve-handoff'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'videos', 'mp4'), { recursive: true });
  for (const name of ['001.mp4', '002.mp4']) fs.writeFileSync(path.join(dir, 'videos', 'mp4', name), 'bytes');
  fs.writeFileSync(path.join(dir, 'resolve-handoff', 'media-manifest.json'), JSON.stringify({
    clips: [
      { order: 2, staged_video_relative_path: 'videos/mp4/002.mp4', prompt_index: 2, prompt_text: 'second' },
      { order: 1, staged_video_relative_path: 'videos/mp4/001.mp4', prompt_index: 1, prompt_text: 'first' },
    ],
  }));
  const entries = bindingModule.discoverAigenResolveHandoff(dir);
  assert.deepEqual(entries.map((e) => e.relative_path), ['videos/mp4/001.mp4', 'videos/mp4/002.mp4']);
  assert.equal(entries[0].description, 'first');
});

test('DAB2: the binding discovers aigen selected images in prompt order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-stills-'));
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', 'a.png'), 'a');
  fs.writeFileSync(path.join(dir, 'images', 'b.png'), 'b');
  fs.writeFileSync(path.join(dir, 'selected-images.json'), JSON.stringify({
    selections: [
      { prompt_index: 2, selected_path: 'images/b.png', prompt: 'B' },
      { prompt_index: 1, selected_path: 'images/a.png', prompt: 'A' },
    ],
  }));
  const entries = bindingModule.discoverAigenSelectedImages(dir);
  assert.deepEqual(entries.map((e) => e.relative_path), ['images/a.png', 'images/b.png']);
});

test('DAB3: a missing, empty or unsupported asset fails the whole bind rather than half of it', () => {
  const dir = mediaDir();
  assert.throws(() => bindingModule.buildBinding({
    runId: 'r', boundBy: 'test', music: null,
    visuals: { source_kind: 'EXPLICIT_ASSETS', root: dir, assets: [{ path: path.join(dir, 'nope.mp4') }] },
  }), (error) => error.code === 'DRAFT_BINDING_ASSET_MISSING');

  const odd = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-odd-'));
  fs.writeFileSync(path.join(odd, 'notes.txt'), 'not media');
  assert.throws(() => bindingModule.buildBinding({
    runId: 'r', boundBy: 'test', music: null,
    visuals: { source_kind: 'EXPLICIT_ASSETS', root: odd, assets: [{ path: path.join(odd, 'notes.txt') }] },
  }), (error) => error.code === 'DRAFT_BINDING_ASSET_KIND_UNSUPPORTED');
});

test('DAB4: an approved mix with no provenance record is refused', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-score-'));
  fs.mkdirSync(path.join(project, 'approved'), { recursive: true });
  fs.copyFileSync(path.join(mediaDir(), 'music.wav'), path.join(project, 'approved', 'mix-dialogue-safe.wav'));
  assert.throws(() => bindingModule.buildBinding({
    runId: 'r', boundBy: 'test', visuals: explicitVisualSpec(1),
    music: { source_kind: 'SCORECRAFT_APPROVED_MIX', project_dir: project },
  }), (error) => error.code === 'DRAFT_BINDING_MUSIC_PROVENANCE_MISSING');

  // With provenance it binds, and the provenance itself is hash-bound.
  fs.writeFileSync(path.join(project, 'approved', 'provenance.json'), JSON.stringify({ approved: true }));
  const binding = bindingModule.buildBinding({
    runId: 'r', boundBy: 'test', visuals: explicitVisualSpec(1),
    music: { source_kind: 'SCORECRAFT_APPROVED_MIX', project_dir: project },
  });
  assert.match(binding.music.provenance_sha256, /^[0-9a-f]{64}$/);
  assert.equal(binding.music.variant, 'dialogue_safe');
});

test('DAB5: resolving a binding re-reads the bytes, so a changed asset is drift and not a different draft', () => {
  const run = draftRun('drift', { capture: false });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-mutable-'));
  const asset = path.join(scratch, 'clip.mp4');
  fs.copyFileSync(path.join(mediaDir(), 'clip-1.mp4'), asset);
  bindAssembly(run.dir, {
    visuals: { source_kind: 'EXPLICIT_ASSETS', root: scratch, assets: [{ path: asset }] },
    music: null,
  });
  assert.equal(bindingModule.bindingStatus(run.dir).valid, true);

  fs.copyFileSync(path.join(mediaDir(), 'clip-2.mp4'), asset);
  const after = bindingModule.bindingStatus(run.dir);
  assert.equal(after.valid, false);
  assert.equal(after.code, 'DRAFT_BINDING_DRIFT');
  assert.match(after.detail, /bytes changed/);
});

test('DAB6: policy values outside the contract are refused, and the defaults are the boring ones', () => {
  assert.throws(() => bindingModule.normalizePolicy({ visual_shortfall: 'GUESS' }), (e) => e.code === 'DRAFT_BINDING_POLICY_INVALID');
  assert.throws(() => bindingModule.normalizePolicy({ music_gain_db: 6 }), (e) => e.code === 'DRAFT_BINDING_POLICY_INVALID');
  assert.throws(() => bindingModule.normalizePolicy({ crossfade_seconds: 9 }), (e) => e.code === 'DRAFT_BINDING_POLICY_INVALID');
  const policy = bindingModule.normalizePolicy({});
  // FAIL, not CYCLE: a draft that silently repeats shots misinforms the review.
  assert.equal(policy.visual_shortfall, 'FAIL');
  assert.equal(policy.transition, 'CUT');
  assert.equal(policy.fit, 'FIT');
  assert.equal(policy.review_slate, true);
});

test('DAB7: a binding recorded for another run is refused', () => {
  const run = draftRun('idcheck', { capture: false });
  const binding = bindAssembly(run.dir, { music: null });
  binding.run_id = 'some-other-run';
  fs.writeFileSync(path.join(run.dir, bindingModule.BINDING_FILE), JSON.stringify(binding, null, 2));
  assert.throws(() => bindingModule.resolveBinding(run.dir), (e) => e.code === 'DRAFT_BINDING_RUN_MISMATCH');
});

/* ================ TIMELINE: narration is the only spine ================== */

function fakeNarration(durations, options = {}) {
  let cursor = 0;
  const segments = durations.map((duration, index) => {
    const start = cursor;
    cursor += duration;
    return {
      order: index + 1, section_id: `sec-${index + 1}`, beat: `Beat ${index + 1}`,
      spoken: duration > 0, reason: duration > 0 ? null : 'no dialogue',
      duration_seconds: duration, start_seconds: start, end_seconds: cursor,
    };
  });
  return {
    schema: 'vidtoolz.syntheticNarration.v1', fidelity: 'DRAFT_SYNTHETIC_PROXY',
    assembled: { audio_path: 'media/draft-narration/narration.wav', audio_sha256: 'a'.repeat(64), duration_seconds: cursor, sample_rate: 48000, channels: 1 },
    segments, ...options,
  };
}

function fakeVisuals(count, kind = 'VIDEO', sourceDuration = 4) {
  return Array.from({ length: count }, (_, index) => ({
    asset_id: `visual-${String(index + 1).padStart(3, '0')}`,
    kind, relative_path: `v${index + 1}.mp4`, sha256: String(index).repeat(64).slice(0, 64),
    description: null, present: true,
    probe: { duration_seconds: kind === 'VIDEO' ? sourceDuration : null, width: 320, height: 180 },
  }));
}

const FAKE_MUSIC = {
  source_kind: 'EXPLICIT_ASSET', relative_path: 'music.wav', sha256: 'b'.repeat(64), variant: null,
  probe: { duration_seconds: 6 },
};

function planWith(overrides = {}) {
  return timeline.planDraftTimeline({
    runId: 'run-1',
    story: { project_id: 'p', version_id: 'v', content_hash: 'c' },
    storyApprovalState: 'approved',
    narration: overrides.narration || fakeNarration([3, 5, 2]),
    visuals: overrides.visuals || fakeVisuals(3),
    music: overrides.music === null ? null : (overrides.music || FAKE_MUSIC),
    output: overrides.output === null ? null : (overrides.output || TEST_OUTPUT),
    outputClass: overrides.outputClass,
    policy: bindingModule.normalizePolicy(overrides.policy || { visual_shortfall: 'FAIL' }),
  });
}

test('DAT1: every timeline duration comes from measured narration and nothing else', () => {
  const plan = planWith({ narration: fakeNarration([3, 5, 2]) });
  assert.deepEqual(plan.segments.map((s) => s.duration_seconds), [3, 5, 2]);
  assert.deepEqual(plan.segments.map((s) => s.start_seconds), [0, 3, 8]);
  assert.equal(plan.timeline.total_duration_seconds, 10);
  // Section identity survives into the timeline, so a review note can name one.
  assert.deepEqual(plan.segments.map((s) => s.section_id), ['sec-1', 'sec-2', 'sec-3']);
});

test('DAT2: the plan is deterministic and its digest moves only when the render would', () => {
  const a = planWith();
  const b = planWith();
  assert.equal(a.plan_digest_sha256, b.plan_digest_sha256);
  assert.notEqual(planWith({ narration: fakeNarration([3, 5, 3]) }).plan_digest_sha256, a.plan_digest_sha256);
  assert.notEqual(planWith({ policy: { visual_shortfall: 'FAIL', fit: 'COVER' } }).plan_digest_sha256, a.plan_digest_sha256);
  assert.notEqual(planWith({ output: { width: 640, height: 360, fps: 24 } }).plan_digest_sha256, a.plan_digest_sha256);
});

test('DAT3: fewer visuals than narrated sections fails closed with a per-section gap report', () => {
  let thrown = null;
  try { planWith({ visuals: fakeVisuals(2) }); } catch (error) { thrown = error; }
  assert.ok(thrown, 'a shortfall must not be assembled over silently');
  assert.equal(thrown.code, 'DRAFT_PLAN_VISUAL_GAP');
  assert.equal(thrown.gaps.length, 1);
  assert.equal(thrown.gaps[0].section_id, 'sec-3');
  assert.equal(thrown.required, 3);
  assert.equal(thrown.available, 2);
});

test('DAT4: CYCLE is available but never silent — every reused shot is a recorded warning', () => {
  const plan = planWith({ visuals: fakeVisuals(2), policy: { visual_shortfall: 'CYCLE' } });
  assert.equal(plan.segments[2].visual.asset_id, 'visual-001');
  assert.equal(plan.segments[2].visual.reused, true);
  const reuse = plan.warnings.filter((w) => w.code === 'VISUAL_REUSED');
  assert.equal(reuse.length, 1);
  assert.match(reuse[0].detail, /visual_shortfall=CYCLE/);
});

test('DAT5: a section with no dialogue takes no draft time and says so', () => {
  const plan = planWith({ narration: fakeNarration([3, 0, 2]), visuals: fakeVisuals(2) });
  assert.equal(plan.segments.length, 2);
  assert.equal(plan.timeline.total_duration_seconds, 5);
  assert.equal(plan.timeline.silent_section_count, 1);
  assert.ok(plan.warnings.some((w) => w.code === 'SECTION_SILENT' && w.section_id === 'sec-2'));
});

test('DAT6: fill strategy is measured, not assumed', () => {
  const plan = planWith({ narration: fakeNarration([3, 5, 2]), visuals: fakeVisuals(3, 'VIDEO', 4) });
  assert.equal(plan.segments[0].visual.fill, timeline.FILL_TRIM); // 4s source, 3s slot
  assert.equal(plan.segments[1].visual.fill, timeline.FILL_LOOP); // 4s source, 5s slot
  assert.ok(plan.warnings.some((w) => w.code === 'VISUAL_LOOPED' && w.segment_order === 2));
  const stills = planWith({ visuals: fakeVisuals(3, 'IMAGE') });
  assert.ok(stills.segments.every((s) => s.visual.fill === timeline.FILL_HOLD));
});

test('DAT7: geometry comes from the Story output class, and is never guessed from the media', () => {
  const wide = planWith({ output: null, outputClass: { orientation: 'horizontal', aspect_ratio: '16:9' } });
  assert.deepEqual([wide.output.width, wide.output.height], [1920, 1080]);
  assert.equal(wide.output.geometry_source, 'STORY_OUTPUT_CLASS');
  const tall = planWith({ output: null, outputClass: { orientation: 'vertical' } });
  assert.deepEqual([tall.output.width, tall.output.height], [1080, 1920]);
  assert.throws(() => planWith({ output: null, outputClass: {} }), (e) => e.code === 'DRAFT_PLAN_OUTPUT_UNDETERMINED');
});

test('DAT8: an orientation mismatch between asset and frame is declared, not hidden', () => {
  const visuals = fakeVisuals(3);
  visuals.forEach((v) => { v.probe.width = 180; v.probe.height = 320; });
  const plan = planWith({ visuals });
  assert.equal(plan.warnings.filter((w) => w.code === 'VISUAL_ORIENTATION_MISMATCH').length, 3);
});

test('DAT9: a crossfade extends what each segment must cover, and one that does not fit is refused', () => {
  const plan = planWith({ policy: { visual_shortfall: 'FAIL', transition: 'CROSSFADE', crossfade_seconds: 0.5 } });
  assert.equal(plan.segments[0].render_duration_seconds, 3.5);
  assert.equal(plan.segments[0].duration_seconds, 3, 'the timeline slot itself is unchanged');
  assert.equal(plan.timeline.total_duration_seconds, 10, 'the narration spine is preserved');
  assert.throws(() => planWith({ policy: { visual_shortfall: 'FAIL', transition: 'CROSSFADE', crossfade_seconds: 1.5 } }),
    (e) => e.code === 'DRAFT_PLAN_CROSSFADE_TOO_LONG');
});

test('DAT10: music is covered deterministically, and its absence is stated rather than assumed', () => {
  const plan = planWith();
  assert.equal(plan.music.present, true);
  assert.equal(plan.music.fill, timeline.FILL_LOOP, '6s bed under a 10s draft');
  assert.equal(plan.music.start_seconds, 0);
  assert.equal(plan.music.end_seconds, plan.timeline.total_duration_seconds);
  assert.ok(plan.music.fade_in_seconds > 0 && plan.music.fade_out_seconds > 0);
  assert.equal(plan.music.gain_db, -14);
  const silent = planWith({ music: null });
  assert.equal(silent.music.present, false);
  assert.ok(silent.warnings.some((w) => w.code === 'MUSIC_ABSENT'));
});

/* ========================= RENDER: real bytes ============================ */

test('DAR1: FIT never crops and COVER never letterboxes', () => {
  const fit = renderModule.geometryFilter({ width: 320, height: 180 }, 'FIT');
  assert.match(fit, /force_original_aspect_ratio=decrease/);
  assert.match(fit, /pad=320:180/);
  const cover = renderModule.geometryFilter({ width: 320, height: 180 }, 'COVER');
  assert.match(cover, /force_original_aspect_ratio=increase/);
  assert.match(cover, /crop=320:180/);
});

test('DAR2: slate text is reduced to characters that cannot mean anything to a filtergraph', () => {
  const hostile = renderModule.slateSafeText("Hook: 'drop' \\ %{pts} : end");
  assert.ok(!/[:'\\%{}]/.test(hostile), `still filtergraph-hostile: ${hostile}`);
  assert.match(hostile, /Hook/);
});

test('DAR2b: the slate fits the frame it is burned into, in both orientations', () => {
  const font = renderModule.findFont();
  if (!font) { assert.ok(true, 'no usable font on this machine; skipped'); return; }
  const label = '5/11  Source script paragraph 5 of 11';
  const textsFor = (output) => renderModule.slateFilter({ label, timecode_offset_seconds: 80 }, output, font)
    .split(',').map((chunk) => (chunk.match(/text='([^']*)'/) || [])[1]).filter(Boolean);

  for (const output of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    const texts = textsFor(output);
    assert.equal(texts.length, 3, 'notice, timecode, section label');
    assert.match(texts[0], /DRAFT/);
    assert.match(texts[1], /pts/);
    assert.match(texts[2], /^5\/11/);
  }
  // The vertical frame is where a long beat name overflowed and collided with
  // the timecode, so it is the one that must truncate.
  assert.ok(textsFor({ width: 1080, height: 1920 })[2].length < label.length);
  assert.equal(renderModule.truncateLabel('short', 40), 'short');
  assert.equal(renderModule.truncateLabel('abcdefghij', 5), 'abcd.');
});

/*
 * The First Real Production Run rendered at 1080x1920 with 11 beats named
 * "Source script paragraph NN", and the bottom-left section label ran straight
 * under the bottom-right timecode. The structural fix is that the two no longer
 * share a row, which is a property this test can assert exactly rather than by
 * eyeballing pixels.
 */
test('DAR2c: at real production geometry the section label and the timecode cannot collide', () => {
  const font = renderModule.findFont();
  if (!font) { assert.ok(true, 'no usable font on this machine; skipped'); return; }
  const PRODUCTION_FRAME = { width: 1080, height: 1920 };
  const chunks = renderModule
    .slateFilter({ label: '5/11  Source script paragraph 05', timecode_offset_seconds: 80 }, PRODUCTION_FRAME, font)
    .split(',');
  assert.equal(chunks.length, 3, 'notice, timecode, section label');

  const yOf = (chunk) => (chunk.match(/:y=([^:]+)/) || [])[1];
  const textOf = (chunk) => (chunk.match(/text='([^']*)'/) || [])[1];
  const rows = chunks.map((chunk) => ({ text: textOf(chunk), y: yOf(chunk) }));
  const timecode = rows.find((r) => /pts/.test(r.text));
  const label = rows.find((r) => /^5\/11/.test(r.text));
  assert.ok(timecode && label);
  // Top row vs bottom row. Different rows cannot overlap at any frame width,
  // which is the only guarantee that survives an arbitrarily long beat name.
  assert.ok(!/h-th/.test(timecode.y), `timecode must sit on the top row, got y=${timecode.y}`);
  assert.match(label.y, /h-th/, 'the section label sits on the bottom row');
});

test('DAR2d: a Story that names no beat gets a position, never its section id dressed as a name', () => {
  const font = renderModule.findFont();
  if (!font) { assert.ok(true, 'no usable font on this machine; skipped'); return; }
  const narration = fakeNarration([3, 5]);
  narration.segments.forEach((segment) => { segment.beat = null; });
  const plan = planWith({ narration, visuals: fakeVisuals(2) });
  assert.ok(plan.segments.every((segment) => segment.beat === null && segment.beat_source === 'NONE'));
  assert.equal(plan.warnings.filter((w) => w.code === 'SECTION_BEAT_UNNAMED').length, 2);

  // The label is the position and nothing else — no section id in the frame.
  const label = `${plan.segments[0].order}/${plan.timeline.segment_count}`;
  const rendered = renderModule.slateFilter({ label, timecode_offset_seconds: 0 }, { width: 1080, height: 1920 }, font);
  assert.ok(!/sec-1/.test(rendered), 'a section identifier must never be burned in as a beat name');
  assert.match(rendered, /text='1\/2'/);

  // A Story that DOES name its beats keeps them, and records that it did.
  const named = planWith();
  assert.ok(named.segments.every((segment) => segment.beat_source === 'STORY_BEAT'));
  assert.equal(named.warnings.filter((w) => w.code === 'SECTION_BEAT_UNNAMED').length, 0);
});

test('DAR5: a real render at production geometry (1080x1920) validates', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  // Every other render test uses a small landscape frame. The real run was
  // vertical, and vertical is where the slate defect actually appeared, so one
  // test renders the real shape end to end.
  const run = draftRun('vertical');
  bindAssembly(run.dir, { output: { width: 1080, height: 1920, fps: 24 }, policy: { visual_shortfall: 'CYCLE' } });
  const result = assembly.buildDraftAssembly(run.dir);
  assert.equal(result.manifest.output.probe.width, 1080);
  assert.equal(result.manifest.output.probe.height, 1920);
  assert.equal(result.manifest.render_report.validation.decode_pass, true);
  assert.equal(result.manifest.policy.review_slate, true);
  assert.equal(assembly.attestDraftAssembly(run.dir).state, 'VERIFIED');
});

test('DAR3: the segment identity changes exactly when the rendered pixels would', () => {
  const plan = planWith();
  const segment = plan.segments[0];
  const base = renderModule.segmentDigest(segment, plan.output, 'FIT', null);
  assert.equal(base, renderModule.segmentDigest(segment, plan.output, 'FIT', null));
  assert.notEqual(base, renderModule.segmentDigest(segment, plan.output, 'COVER', null));
  assert.notEqual(base, renderModule.segmentDigest(segment, { ...plan.output, width: 640 }, 'FIT', null));
  assert.notEqual(base, renderModule.segmentDigest(segment, plan.output, 'FIT', { label: '1/3 Beat', timecode_offset_seconds: 0 }));
});

test('DAR4: validation rejects the ways a render can look finished without being finished', () => {
  if (!MEDIA_READY) { assert.ok(true, 'ffmpeg not installed on this machine; skipped'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-validate-'));
  const plan = planWith({ narration: fakeNarration([2]), visuals: fakeVisuals(1) });

  const missing = renderModule.validateDraft(path.join(dir, 'nope.mp4'), plan);
  assert.equal(missing.ok, false);
  assert.match(missing.failures[0], /does not exist/);

  const empty = path.join(dir, 'empty.mp4');
  fs.writeFileSync(empty, '');
  assert.match(renderModule.validateDraft(empty, plan).failures[0], /zero bytes/);

  const garbage = path.join(dir, 'garbage.mp4');
  fs.writeFileSync(garbage, 'this is not a video');
  assert.equal(renderModule.validateDraft(garbage, plan).ok, false);

  // Right shape, no audio: a silent draft is not a draft.
  const silent = path.join(dir, 'silent.mp4');
  ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=320x180:d=2:r=24`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent]);
  const silentResult = renderModule.validateDraft(silent, plan);
  assert.equal(silentResult.ok, false);
  assert.ok(silentResult.failures.some((f) => /no audio stream/.test(f)));

  // Right shape, wrong length: the spine is not negotiable.
  const wrongLength = path.join(dir, 'long.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=6:r=24', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', wrongLength]);
  assert.ok(renderModule.validateDraft(wrongLength, plan).failures.some((f) => /duration is/.test(f)));
});

/* ============ ASSEMBLY: eligibility, artifact, evidence, rerun =========== */

test('DA1: assembly is DRAFT-only and refuses an undeclared mode', () => {
  const run = draftRun('modegate', { mode: null, capture: false });
  const report = assembly.assemblyEligibility(run.dir);
  assert.equal(report.eligible, false);
  assert.ok(report.blockers.some((b) => /DRAFT-only/.test(b)));
});

test('DA2: without narration there is no spine, and assembly says exactly that', () => {
  const run = draftRun('nonarration', { capture: false });
  bindAssembly(run.dir);
  const report = assembly.assemblyEligibility(run.dir);
  assert.equal(report.eligible, false);
  assert.ok(report.blockers.some((b) => /no timing spine/.test(b)));
});

test('DA3: assembly may not run ahead of the capture gate it consumes', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('nocapture', { capture: false });
  narrationModule.buildDraftNarration(run.dir, { taskId: 't-nocapture' });
  narrationModule.attestDraftNarration(run.dir, { taskId: 't-nocapture' });
  bindAssembly(run.dir);
  // Narration exists but the proxy presenter does not, so gate 8 is not ready.
  const report = assembly.assemblyEligibility(run.dir);
  assert.equal(report.eligible, false);
  assert.ok(report.blockers.some((b) => /proxy capture is not ready/.test(b)));
});

test('DA4: without a binding nothing declares what the draft is made of', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('nobinding');
  const report = assembly.assemblyEligibility(run.dir);
  assert.equal(report.eligible, false);
  assert.ok(report.blockers.some((b) => /draft-assembly-binding\.json/.test(b)));
});

test('DA5: an eligible run assembles a real, decodable, correctly shaped MP4', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir, result } = builtDraft();
  const manifest = result.manifest;
  const file = path.join(dir, manifest.output.path);

  assert.ok(fs.existsSync(file), 'a real file on disk');
  assert.ok(fs.statSync(file).size > 10000, 'non-trivial byte count');
  assert.equal(manifest.output.probe.width, TEST_OUTPUT.width);
  assert.equal(manifest.output.probe.height, TEST_OUTPUT.height);
  assert.equal(manifest.output.probe.fps, TEST_OUTPUT.fps);
  assert.ok(manifest.output.probe.has_video && manifest.output.probe.has_audio);
  assert.ok(manifest.output.probe.frames > 0, 'not a zero-frame render');
  assert.equal(manifest.render_report.validation.ok, true);
  assert.equal(manifest.render_report.validation.decode_pass, true, 'every packet decodes');

  // The draft lands on the narration, to the frame-ish.
  const narration = narrationModule.readManifest(dir);
  assert.ok(Math.abs(manifest.output.probe.duration_seconds - narration.assembled.duration_seconds)
    < renderModule.DURATION_TOLERANCE_SECONDS + 0.1);
});

test('DA6: the manifest reconstructs the assembly without anyone reading a terminal', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { result } = builtDraft();
  const manifest = result.manifest;
  assert.match(manifest.script.content_hash, /^[0-9a-f]{64}$/);
  assert.match(manifest.narration.audio_sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.output.sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.plan_digest_sha256, /^[0-9a-f]{64}$/);
  assert.ok(manifest.visuals.assets.length > 0);
  assert.ok(manifest.visuals.assets.every((a) => /^[0-9a-f]{64}$/.test(a.sha256)));
  assert.equal(manifest.music.present, true);
  assert.ok(manifest.segments.length > 0);
  assert.ok(manifest.segments.every((s) => s.section_id && s.visual_sha256 && s.duration_seconds > 0));
  assert.equal(manifest.segments[0].start_seconds, 0);
  assert.ok(manifest.render_settings.width && manifest.render_settings.fps);
  assert.equal(manifest.approval.human_approval_present, false);
  assert.ok(Array.isArray(manifest.warnings));
});

test('DA7: the evidence asserts a rendered file and refuses to assert anything else', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { evidence } = builtDraft();
  assert.equal(evidence.state, 'VERIFIED');
  assert.equal(evidence.kind, 'DRAFT_ASSEMBLY');
  assert.equal(evidence.fidelity, 'DRAFT_AUTOMATED_ASSEMBLY');
  // The three claims a draft must never make.
  assert.equal(evidence.satisfies_real_capture, false);
  assert.equal(evidence.completes_rough_cut_gate, false);
  assert.equal(evidence.human_authority_required, true);
  for (const phrase of ['edit quality', 'production readiness', 'approved rough cut', 'publish readiness']) {
    assert.ok(evidence.does_not_assert.includes(phrase), `must not assert: ${phrase}`);
  }
  assert.equal(evidence.narration.is_presenter_voice, false);
  // Semantic vs technical producer stay distinguishable, as they do for narration.
  assert.equal(evidence.semantic_producer, 'editor');
  assert.equal(evidence.technical_producer.renderer, 'ffmpeg-draft-assembler');
});

test('DA8: rerunning an unchanged assembly reuses the draft instead of re-rendering it', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir, result } = builtDraft();
  const before = fs.statSync(path.join(dir, result.manifest.output.path)).mtimeMs;
  const again = assembly.buildDraftAssembly(dir);
  assert.equal(again.reused, true);
  assert.equal(again.rendered, false);
  assert.equal(again.manifest.draft_version, result.manifest.draft_version);
  assert.equal(fs.statSync(path.join(dir, again.manifest.output.path)).mtimeMs, before, 'the bytes were not touched');
});

test('DA9: an interrupted render is recoverable, and finished segments are reused rather than redone', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = builtDraft();
  const workDir = path.join(dir, assembly.WORK_DIR);
  const segments = fs.readdirSync(workDir).filter((n) => n.startsWith('seg-'));
  assert.ok(segments.length > 0, 'per-segment work products exist for resume');

  // Simulate a kill after the draft was deleted but the work survived.
  const manifest = assembly.readManifest(dir);
  fs.rmSync(path.join(dir, manifest.output.path));
  const rebuilt = assembly.buildDraftAssembly(dir);
  assert.equal(rebuilt.rendered, true);
  assert.equal(rebuilt.manifest.render_report.segments_reused, rebuilt.manifest.segments.length,
    'every segment came back from the work directory');
  assert.equal(assembly.attestDraftAssembly(dir).state, 'VERIFIED');
});

test('DA10: a half-written draft never occupies the name of a finished one', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('truncated');
  bindAssembly(run.dir);
  assembly.buildDraftAssembly(run.dir);
  const manifest = assembly.readManifest(run.dir);
  const file = path.join(run.dir, manifest.output.path);

  // Truncate the finished draft the way an interrupted write would.
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file, bytes.subarray(0, Math.floor(bytes.length / 3)));
  const status = assembly.draftAssemblyStatus(run.dir);
  assert.equal(status.valid, false, 'a truncated draft is never reported valid');
  assert.equal(status.code, 'DRAFT_ASSEMBLY_ARTIFACT_INVALID');
  assert.equal(assembly.attestDraftAssembly(run.dir).state, 'INVALID');
});

test('DA11: a re-narrated script makes the existing draft stale rather than quietly wrong', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('drifted');
  bindAssembly(run.dir);
  assembly.buildDraftAssembly(run.dir);
  assert.equal(assembly.draftAssemblyStatus(run.dir).valid, true);

  // Re-render narration: same script, new bytes.
  narrationModule.buildDraftNarration(run.dir, { taskId: 't-redo' });
  narrationModule.attestDraftNarration(run.dir, { taskId: 't-redo' });
  const status = assembly.draftAssemblyStatus(run.dir);
  assert.equal(status.valid, false);
  assert.equal(status.code, 'DRAFT_ASSEMBLY_SOURCE_DRIFT');
  assert.match(status.detail, /re-rendered/);
});

test('DA12: changing what the draft is made of produces a new version, never a silent overwrite', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('versioned');
  bindAssembly(run.dir);
  const first = assembly.buildDraftAssembly(run.dir);
  assert.equal(first.manifest.draft_version, 1);

  bindAssembly(run.dir, { policy: { visual_shortfall: 'CYCLE', fit: 'COVER' } });
  const second = assembly.buildDraftAssembly(run.dir);
  assert.equal(second.manifest.draft_version, 2);
  assert.ok(fs.existsSync(path.join(run.dir, 'media', 'draft-assembly', 'draft-v1.mp4')), 'v1 survives for anyone reviewing it');
  assert.notEqual(second.manifest.output.sha256, first.manifest.output.sha256);
  assert.equal(second.manifest.lineage.supersedes, 'draft-v1.mp4');

  const state = assembly.readState(run.dir);
  assert.equal(state.state, 'COMPLETE');
  assert.deepEqual(state.history.map((h) => h.draft_version), [1, 2]);
});

test('DA13: an undecodable bound source fails at planning, before anything claims a draft exists', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('undecodable');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-vanish-'));
  const asset = path.join(scratch, 'clip.mp4');
  // A file with a video extension and no video in it. The binding accepts it
  // (it hashes bytes, it does not decode), so the refusal has to come from the
  // planner probing the media before it plans anything around it.
  fs.writeFileSync(asset, 'not a video at all');
  bindAssembly(run.dir, {
    visuals: { source_kind: 'EXPLICIT_ASSETS', root: scratch, assets: [{ path: asset }] },
    policy: { visual_shortfall: 'CYCLE' },
  });
  assert.throws(() => assembly.buildDraftAssembly(run.dir), (e) => e.code === 'DRAFT_RENDER_UNDECODABLE');
  assert.equal(assembly.draftAssemblyStatus(run.dir).present, false, 'no manifest, so nothing claims a draft exists');
  assert.equal(assembly.readState(run.dir), null, 'a run that never started rendering records no attempt');
  assert.ok(!fs.existsSync(path.join(run.dir, 'media', 'draft-assembly')), 'no output directory is left behind');
});

test('DA13b: a render that fails partway records FAILED and leaves no artifact pretending otherwise', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('renderfail');
  bindAssembly(run.dir);
  // Make the output directory unusable so the render fails after the plan has
  // been accepted — the case where an attempt really was started.
  fs.writeFileSync(path.join(run.dir, 'media', 'draft-assembly'), 'in the way');
  assert.throws(() => assembly.buildDraftAssembly(run.dir));

  const state = assembly.readState(run.dir);
  assert.equal(state.state, 'FAILED');
  assert.equal(state.attempt, 1);
  assert.ok(state.last_error && state.last_error.message);
  assert.deepEqual(state.history, [], 'a failed attempt never enters the completed history');
  assert.equal(assembly.draftAssemblyStatus(run.dir).present, false);

  // The plan survives, so the failure is inspectable rather than mysterious.
  assert.ok(assembly.readPlan(run.dir), 'the plan that was attempted is still on disk');
});

test('DA14: a crossfaded draft still lands exactly on the narration spine', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('crossfade');
  bindAssembly(run.dir, { policy: { visual_shortfall: 'CYCLE', transition: 'CROSSFADE', crossfade_seconds: 0.4 } });
  const result = assembly.buildDraftAssembly(run.dir);
  const narration = narrationModule.readManifest(run.dir);
  assert.ok(Math.abs(result.manifest.output.probe.duration_seconds - narration.assembled.duration_seconds)
    < renderModule.DURATION_TOLERANCE_SECONDS + 0.1, 'crossfades must not shorten the draft');
  assert.equal(assembly.attestDraftAssembly(run.dir).state, 'VERIFIED');
});

test('DA15: still images assemble as readily as motion, and the manifest says which was which', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('stills');
  bindAssembly(run.dir, {
    visuals: { source_kind: 'EXPLICIT_ASSETS', root: mediaDir(), assets: [{ path: path.join(mediaDir(), 'still.png') }] },
    policy: { visual_shortfall: 'CYCLE' },
  });
  const result = assembly.buildDraftAssembly(run.dir);
  assert.ok(result.manifest.segments.every((s) => s.visual_kind === 'IMAGE' && s.fill === timeline.FILL_HOLD));
  assert.equal(assembly.attestDraftAssembly(run.dir).state, 'VERIFIED');
});

test('DA16: the assembler never claims Piper speech, generated visuals or the audio sum are production grade', () => {
  const source = ['package-run-draft-assembly.js', 'draft-assembly-render.js', 'draft-assembly-timeline.js', 'draft-assembly-binding.js']
    .map((name) => fs.readFileSync(path.join(ROOT, 'scripts', name), 'utf8')).join('\n');
  assert.ok(!/production[_ -]?ready\s*[:=]\s*true/i.test(source));
  assert.ok(!/publish[_ -]?ready\s*[:=]\s*true/i.test(source));
  assert.ok(!/satisfies_real_capture:\s*true/.test(source));
  assert.ok(!/completes_rough_cut_gate:\s*true/.test(source));
  // The manifest's own is_not list is the durable statement of this.
  for (const claim of ['an approved rough cut', 'a production edit', 'a final mix', 'publishable media']) {
    assert.ok(source.includes(`'${claim}'`), `is_not must include: ${claim}`);
  }
});

/* ===================== REVIEW INTAKE: what Mikko says ==================== */

/*
 * The contract these tests protect is not theoretical. The First Real
 * Production Run had to hand-author a `vidtoolz.frr.humanReview.v1` wrapper
 * because v1 of this module could hold only notes and ratings — and it recorded
 * `ratings_1_to_10` while the module validated 1-5. Each test below pins one
 * field that wrapper needed.
 */

function reviewedRun(label) {
  const run = draftRun(label);
  bindAssembly(run.dir);
  const built = assembly.buildDraftAssembly(run.dir);
  return { ...run, built };
}

test('DRI1: there is nothing to review until there is something to watch', () => {
  const run = draftRun('noreview', { capture: false });
  assert.throws(() => reviewIntake.openReview(run.dir), (e) => e.code === 'DRAFT_REVIEW_NO_DRAFT');
});

test('DRI2: a review is anchored to the exact file that was watched, and says who judged', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir, built } = reviewedRun('reviewed');
  const { review } = reviewIntake.openReview(dir, {
    reviewer: 'mikko', reviewerAuthority: 'Mikko Pakkala', recordedBy: 'hermes-executive-producer',
  });
  assert.equal(review.draft.output_sha256, built.manifest.output.sha256);
  assert.equal(review.draft.assembly_manifest_sha256.length, 64);
  assert.equal(review.draft.plan_digest_sha256, built.manifest.plan_digest_sha256);
  assert.equal(review.draft.draft_version, built.manifest.draft_version);
  // Who judged and who wrote it down are different questions.
  assert.equal(review.reviewer_authority, 'Mikko Pakkala');
  assert.equal(review.recorded_by, 'hermes-executive-producer');
  assert.equal(review.completion_status, 'OPEN');
  assert.equal(review.authority.completes_rough_cut_gate, false);
  assert.ok(reviewIntake.RATING_AXES.every((axis) => review.ratings[axis] === null));
});

/* ---------------------------- the 1-10 scale ---------------------------- */

test('DRI-SCALE1: the canonical rating scale is integers 1-10', () => {
  assert.equal(reviewIntake.RATING_MIN, 1);
  assert.equal(reviewIntake.RATING_MAX, 10);
  assert.deepEqual(reviewIntake.RATING_AXES, [
    'story', 'pacing', 'visuals', 'humor', 'clarity', 'music', 'overall_potential',
  ]);
  // The CLI must advertise the same range it enforces — the earlier 1-5 surface
  // is exactly what made the real run believe the wrong thing.
  assert.match(reviewIntake.usage(), /1-10/);
  assert.ok(!/<1-5>/.test(reviewIntake.usage()));
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'draft-review-intake.js'), 'utf8');
  assert.ok(!/RATING_MAX = 5\b/.test(source), 'no 1-5 cap may survive anywhere in the module');
});

test('DRI-SCALE2: every value across the full 1-10 range is stored raw', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('scale');
  const { review } = reviewIntake.openReview(dir);
  const id = review.review_id;
  for (let score = reviewIntake.RATING_MIN; score <= reviewIntake.RATING_MAX; score += 1) {
    const updated = reviewIntake.setRating(dir, id, 'story', score);
    // Raw. No normalisation, no rescaling into another range, no percentage.
    assert.equal(updated.ratings.story, score, `score ${score} must round-trip unchanged`);
  }
  // 8 and 9 are the specific values a 1-5 cap used to reject.
  assert.equal(reviewIntake.setRating(dir, id, 'pacing', 9).ratings.pacing, 9);
  assert.equal(reviewIntake.setRating(dir, id, 'music', 10).ratings.music, 10);
  // And the stored file agrees with the returned object.
  assert.equal(reviewIntake.readReview(dir, id).ratings.music, 10);
});

test('DRI-SCALE3: out-of-range and non-integer scores are refused, and the error names the range', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('scalebad');
  const { review } = reviewIntake.openReview(dir);
  const id = review.review_id;
  for (const bad of [0, -1, 11, 100, 3.5, 'seven', NaN]) {
    assert.throws(() => reviewIntake.setRating(dir, id, 'story', bad),
      (e) => e.code === 'DRAFT_REVIEW_RATING_INVALID' && /1 to 10/.test(e.message),
      `must refuse ${JSON.stringify(bad)} and name the valid range`);
  }
  assert.throws(() => reviewIntake.setRating(dir, id, 'vibes', 5), (e) => e.code === 'DRAFT_REVIEW_AXIS_INVALID');
  assert.equal(reviewIntake.readReview(dir, id).ratings.story, null, 'a refused score leaves the axis absent');
});

test('DRI-SCALE4: a missing rating stays missing and never becomes zero', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('scaleabsent');
  const { review } = reviewIntake.openReview(dir);
  const id = review.review_id;
  reviewIntake.setRating(dir, id, 'story', 7);
  // Clearing restores absence rather than writing a floor value.
  for (const clearing of [null, undefined, '']) {
    reviewIntake.setRating(dir, id, 'story', 7);
    assert.equal(reviewIntake.setRating(dir, id, 'story', clearing).ratings.story, null);
  }
  const stored = reviewIntake.readReview(dir, id);
  assert.ok(Object.values(stored.ratings).every((v) => v === null || Number.isInteger(v)));
  assert.ok(!Object.values(stored.ratings).includes(0), 'zero is never a rating value');
  // The artifact declares its own scale so a consumer never has to infer it.
  assert.deepEqual(
    { min: stored.rating_scale.min, max: stored.rating_scale.max, integer: stored.rating_scale.integer },
    { min: 1, max: 10, integer: true },
  );
});

/* -------------------------- the full vocabulary ------------------------- */

test('DRI3: notes carry a disposition, a timecode inside the draft, and verbatim words', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('notes');
  const { review } = reviewIntake.openReview(dir);
  const id = review.review_id;

  const spoken = "Cut this. It's slow, and the shot doesn't earn 20 seconds.";
  const { note } = reviewIntake.addNote(dir, id, {
    timecode_seconds: 12.5, disposition: 'cut', comment: spoken, target_domain: 'pacing',
  });
  assert.equal(note.disposition, 'CUT');
  assert.equal(note.target_domain, 'PACING');
  assert.equal(note.comment, spoken, 'the words are stored exactly as given');
  assert.equal(note.note_id, 'note-0001');
  // Resolved against the assembly so a later plan knows what material this is.
  assert.ok(note.section_id, 'the note lands in a real section');
  assert.ok(Number.isInteger(note.segment_order) && note.segment_order > 0);
  assert.ok(note.segment_start_seconds <= 12.5 && note.segment_end_seconds >= 12.5);
  assert.match(note.predecessor_visual_sha256, /^[0-9a-f]{64}$/);
  assert.equal(note.predecessor_draft_version, review.draft.draft_version);

  assert.throws(() => reviewIntake.addNote(dir, id, { timecode_seconds: 1, disposition: 'MAYBE', comment: 'x' }),
    (e) => e.code === 'DRAFT_REVIEW_DISPOSITION_INVALID');
  assert.throws(() => reviewIntake.addNote(dir, id, { timecode_seconds: 99999, disposition: 'KEEP', comment: 'x' }),
    (e) => e.code === 'DRAFT_REVIEW_TIMECODE_OUT_OF_RANGE');
  assert.throws(() => reviewIntake.addNote(dir, id, { timecode_seconds: 1, disposition: 'KEEP', comment: '  ' }),
    (e) => e.code === 'DRAFT_REVIEW_COMMENT_EMPTY');
  assert.throws(() => reviewIntake.addNote(dir, id, { timecode_seconds: 1, disposition: 'KEEP', comment: 'x', target_domain: 'VIBES' }),
    (e) => e.code === 'DRAFT_REVIEW_TARGET_DOMAIN_INVALID');
});

test('DRI-VERBATIM: long comments are refused, never silently trimmed', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('verbatim');
  const { review } = reviewIntake.openReview(dir);
  const id = review.review_id;

  // Just under the cap survives byte-for-byte, including newlines and quotes.
  const long = `${'a'.repeat(reviewIntake.MAX_COMMENT_BYTES - 40)}\n"quoted" — em dash, ünïcode.`;
  const { note } = reviewIntake.addNote(dir, id, { timecode_seconds: 1, disposition: 'CHANGE', comment: long });
  assert.equal(note.comment, long);
  assert.equal(reviewIntake.readReview(dir, id).notes[0].comment, long, 'survives a write/read round trip');

  // Over the cap is an error. A truncated note is a rewritten note.
  const tooLong = 'b'.repeat(reviewIntake.MAX_COMMENT_BYTES + 1);
  assert.throws(() => reviewIntake.addNote(dir, id, { timecode_seconds: 1, disposition: 'CHANGE', comment: tooLong }),
    (e) => e.code === 'DRAFT_REVIEW_COMMENT_TOO_LONG' && /truncated/.test(e.message));
  assert.equal(reviewIntake.readReview(dir, id).notes.length, 1, 'the refused note was not recorded');
});

test('DRI-VOCAB: the whole Hermes review vocabulary is representable without a wrapper', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('vocab');
  const { review } = reviewIntake.openReview(dir, { reviewer: 'mikko', reviewerAuthority: 'Mikko Pakkala' });
  const id = review.review_id;

  // The real V1 review was exactly this: an overall KEEP, no section verdicts,
  // no ratings, and both approvals explicitly left PENDING.
  const verbatimWords = 'draft-v1.mp4 is a usable draft. I accept it to be kept.';
  reviewIntake.setDraftVerdict(dir, id, 'KEEP', { note: verbatimWords });
  reviewIntake.setApproval(dir, id, 'research', 'PENDING', { note: 'draft KEEP does not authorize the research marker' });
  reviewIntake.setApproval(dir, id, 'script', 'PENDING');
  assert.throws(() => reviewIntake.setApproval(dir, id, 'vibes', 'APPROVED'), (e) => e.code === 'DRAFT_REVIEW_APPROVAL_SUBJECT_INVALID');
  assert.throws(() => reviewIntake.setApproval(dir, id, 'script', 'MAYBE'), (e) => e.code === 'DRAFT_REVIEW_APPROVAL_STATE_INVALID');
  const submitted = reviewIntake.submitReview(dir, id, { overallComment: verbatimWords });

  assert.equal(submitted.draft_verdict, 'KEEP');
  assert.equal(submitted.draft_verdict_note, verbatimWords);
  assert.equal(submitted.overall_comment, verbatimWords);
  assert.equal(submitted.completion_status, 'SUBMITTED');
  // Accepting a draft says nothing about research or script. Not collapsed.
  assert.equal(submitted.approvals.research.state, 'PENDING');
  assert.equal(submitted.approvals.script.state, 'PENDING');
  assert.equal(submitted.authority.approvals_are_advisory, true);
  assert.equal(submitted.authority.completes_rough_cut_gate, false);
  // A verdict alone is a complete review; ratings stay absent.
  assert.ok(reviewIntake.RATING_AXES.every((axis) => submitted.ratings[axis] === null));
});

test('DRI4: a submitted review is closed, an empty one is refused, and mm:ss parses', () => {
  assert.equal(reviewIntake.parseTimecode('1:12'), 72);
  assert.equal(reviewIntake.parseTimecode('01:02:03'), 3723);
  assert.equal(reviewIntake.parseTimecode('45.5'), 45.5);
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('emptyreview');
  const { review } = reviewIntake.openReview(dir);
  assert.throws(() => reviewIntake.submitReview(dir, review.review_id), (e) => e.code === 'DRAFT_REVIEW_EMPTY');

  reviewIntake.setRating(dir, review.review_id, 'clarity', 8);
  reviewIntake.submitReview(dir, review.review_id);
  for (const mutate of [
    () => reviewIntake.addNote(dir, review.review_id, { timecode_seconds: 2, disposition: 'KEEP', comment: 'late' }),
    () => reviewIntake.setRating(dir, review.review_id, 'clarity', 3),
    () => reviewIntake.setDraftVerdict(dir, review.review_id, 'CUT'),
    () => reviewIntake.setApproval(dir, review.review_id, 'script', 'APPROVED'),
  ]) {
    assert.throws(mutate, (e) => e.code === 'DRAFT_REVIEW_SUBMITTED');
  }
  assert.equal(reviewIntake.readReview(dir, review.review_id).ratings.clarity, 8, 'the submitted record is unchanged');
});

/* ------------------------- hash-bound immutability ---------------------- */

test('DRI-BIND1: a review binds to the exact draft, and tampering with that binding is detectable', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('bound');
  const { review } = reviewIntake.openReview(dir, { reviewerAuthority: 'Mikko Pakkala' });
  reviewIntake.setDraftVerdict(dir, review.review_id, 'KEEP');
  assert.match(review.binding_digest_sha256, /^[0-9a-f]{64}$/);
  assert.equal(reviewIntake.reviewStatus(dir, review.review_id).binding_intact, true);

  // Re-point the review at a different draft by hand.
  const file = reviewIntake.reviewFile(dir, review.review_id);
  const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
  tampered.draft.output_sha256 = 'f'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
  const status = reviewIntake.reviewStatus(dir, review.review_id);
  assert.equal(status.binding_intact, false, 'the identity digest no longer matches the identity');
});

test('DRI-BIND2: lifecycle distinguishes ACTIVE, SUPERSEDED and STALE_FOR_CURRENT_DRAFT', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('lifecycle');
  const { review } = reviewIntake.openReview(dir);
  const id = review.review_id;
  reviewIntake.addNote(dir, id, { timecode_seconds: 3, disposition: 'CHANGE', comment: 'swap this shot' });
  assert.equal(reviewIntake.reviewStatus(dir, id).lifecycle, reviewIntake.LIFECYCLE.ACTIVE);

  // Same version, different bytes: re-rendered, not superseded.
  fs.rmSync(path.join(dir, assembly.readManifest(dir).output.path));
  assembly.buildDraftAssembly(dir);
  const afterRerender = reviewIntake.reviewStatus(dir, id);
  if (!afterRerender.current) {
    assert.equal(afterRerender.lifecycle, reviewIntake.LIFECYCLE.STALE_FOR_CURRENT_DRAFT);
    assert.match(afterRerender.detail, /re-rendered/);
  }

  // A genuinely different draft version supersedes it.
  bindAssembly(dir, { policy: { visual_shortfall: 'CYCLE', fit: 'COVER' } });
  assembly.buildDraftAssembly(dir);
  const superseded = reviewIntake.reviewStatus(dir, id);
  assert.equal(superseded.lifecycle, reviewIntake.LIFECYCLE.SUPERSEDED);
  assert.match(superseded.detail, /v1.*v2/);

  // Through all of it the recorded words are untouched: a review stays
  // historically valid for the draft it was made against.
  assert.equal(superseded.review.notes[0].comment, 'swap this shot');
  assert.equal(superseded.review.draft.draft_version, 1);
  assert.equal(superseded.binding_intact, true);

  const summary = reviewIntake.runReviewSummary(dir);
  assert.equal(summary.superseded_count, 1);
  assert.equal(summary.active_count, 0);
  assert.deepEqual(summary.rating_scale, { min: 1, max: 10 });
});

/* --------------------- input for a V1 -> V2 revision -------------------- */

test('DRI-PLAN: an explicit KEEP is machine-distinguishable from nobody mentioning a section', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const { dir } = reviewedRun('plan');
  const manifest = assembly.readManifest(dir);
  assert.ok(manifest.segments.length >= 3, 'need a few sections to tell the states apart');
  const { review } = reviewIntake.openReview(dir, { reviewerAuthority: 'Mikko Pakkala' });
  const id = review.review_id;

  const kept = manifest.segments[0];
  const changed = manifest.segments[1];
  reviewIntake.addNote(dir, id, {
    timecode_seconds: kept.start_seconds + 0.1, disposition: 'KEEP', comment: 'this lands, leave it',
  });
  reviewIntake.addNote(dir, id, {
    timecode_seconds: changed.start_seconds + 0.1, disposition: 'CHANGE',
    comment: 'shot does not support the line', target_domain: 'VISUAL',
  });
  reviewIntake.setDraftVerdict(dir, id, 'CHANGE');
  reviewIntake.submitReview(dir, id, { overallComment: 'mostly there' });

  const plan = reviewIntake.revisionPlanInput(dir, id);
  const byId = new Map(plan.sections.map((s) => [s.section_id, s]));
  assert.equal(byId.get(kept.section_id).feedback_state, 'EXPLICIT_KEEP');
  assert.equal(byId.get(changed.section_id).feedback_state, 'CHANGE_REQUESTED');
  assert.deepEqual(byId.get(changed.section_id).target_domains, ['VISUAL']);
  const untouched = plan.sections.filter((s) => s.feedback_state === 'NO_FEEDBACK');
  assert.ok(untouched.length >= 1, 'sections nobody mentioned are their own state');

  // Predecessor identity is what makes preservation possible instead of
  // regeneration.
  for (const section of plan.sections) {
    assert.equal(section.predecessor_draft_version, 1);
    assert.equal(section.predecessor_draft_sha256, manifest.output.sha256);
    assert.match(section.predecessor_visual_sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isFinite(section.start_seconds) && Number.isFinite(section.end_seconds));
  }
  assert.equal(plan.totals.sections, manifest.segments.length);
  assert.equal(plan.totals.explicit_keep + plan.totals.change_requested + plan.totals.no_feedback, plan.totals.sections);
  assert.equal(plan.review_lifecycle, reviewIntake.LIFECYCLE.ACTIVE);
  assert.equal(plan.reviewer_authority, 'Mikko Pakkala');
  assert.equal(plan.draft_verdict, 'CHANGE');
  // It is input for a planner, and says so rather than reading as permission.
  assert.equal(plan.authority.is_a_revision_plan, false);
  assert.equal(plan.authority.completes_rough_cut_gate, false);
});

/* ================ GATE INTEGRATION: actionable, not complete ============= */

test('DAG1: gate 9 is now mode-aware, and DRAFT names a machine producer under a human gate', () => {
  const owner = gateModePolicy.resolveGateOwner('rough-cut-review', productionMode.DRAFT);
  assert.equal(owner.mode_sensitive, true);
  assert.equal(owner.ok, true);
  assert.equal(owner.expected_owner, 'editor');
  assert.equal(owner.disposition, 'DRAFT_ASSEMBLY_READY');
  assert.equal(owner.implementation_status, 'IMPLEMENTED');
  // The gate stays human even though the artifact is machine-made.
  assert.equal(gateModePolicy.humanRequiredFor('rough-cut-review', productionMode.DRAFT), true);
});

test('DAG2: the policy states in data that a rendered draft does not pass the gate', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'gate-mode-policy.json'), 'utf8'));
  const draft = policy.gates['rough-cut-review'].modes.DRAFT;
  assert.equal(draft.satisfies_gate, false);
  assert.match(draft.satisfies_gate_note, /never a review outcome/i);
  assert.ok(draft.required_evidence.some((e) => /watch notes/i.test(e)), 'the human evidence is still required');
  assert.match(policy.dispositions.DRAFT_ASSEMBLY_READY, /NOT gate completion/);
  // A production rough cut is still nobody's machine job.
  assert.equal(policy.gates['rough-cut-review'].modes.PRODUCTION.implementation_status, 'PLANNED');
});

test('DAG3: the run-state projection reports where Draft V1 is, and changes no gate status', () => {
  if (!FULL_PATH_READY) { assert.ok(true, 'renderer or narration provider unavailable; skipped'); return; }
  const run = draftRun('projected');
  const repoRoot = path.dirname(path.dirname(run.dir));
  const before = stateProjection.buildProjection({ runId: run.runId, repoRoot });
  assert.equal(before.draft_assembly, null, 'a run with no binding is untouched by this feature');

  bindAssembly(run.dir);
  const eligible = stateProjection.buildProjection({ runId: run.runId, repoRoot });
  assert.equal(eligible.draft_assembly.eligible, true);
  assert.equal(eligible.draft_assembly.draft_present, false);
  assert.equal(eligible.draft_assembly.review_can_begin, false);

  assembly.buildDraftAssembly(run.dir);
  const after = stateProjection.buildProjection({ runId: run.runId, repoRoot });
  assert.equal(after.draft_assembly.draft_valid, true);
  assert.equal(after.draft_assembly.draft_version, 1);
  assert.match(after.draft_assembly.draft_path, /draft-v1\.mp4$/);
  assert.equal(after.draft_assembly.review_can_begin, true);
  assert.equal(after.draft_assembly.completes_rough_cut_gate, false);
  assert.equal(after.draft_assembly.proxy_capture_disposition, 'PROXY_CAPTURE_READY');

  // The canonical gates are exactly where they were. Rendering a file is not
  // progress through the lifecycle.
  assert.deepEqual(after.gates.map((g) => g.status), before.gates.map((g) => g.status));
  assert.equal(after.current_gate, before.current_gate);
  assert.equal(after.gates_complete, before.gates_complete);
  // And it says so in the operator-facing body.
  const markdown = stateProjection.renderProjectionMarkdown(after, '');
  assert.match(markdown, /Draft assembly: Draft v1 .*NOT gate completion/);
});

test('DAG4: a run with no draft assembly renders exactly the projection it always did', () => {
  const run = draftRun('untouched', { capture: false });
  const repoRoot = path.dirname(path.dirname(run.dir));
  const projection = stateProjection.buildProjection({ runId: run.runId, repoRoot });
  assert.equal(projection.draft_assembly, null);
  assert.ok(!/Draft assembly/.test(stateProjection.renderProjectionMarkdown(projection, '')));
});

/* ============ QC: DRAFT_ASSEMBLY is a first-class evidence kind =========== */

/*
 * The real production run had to wrap assembly evidence because QC understood
 * GENERATION_RESULT and not DRAFT_ASSEMBLY. The kind is registered now, the
 * same way DRAFT_SYNTHETIC_NARRATION was — a policy row plus an adapter, no
 * schema redesign.
 */

function qcRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-qcroot-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  return root;
}
function sha256Of(value) { return require('node:crypto').createHash('sha256').update(value).digest('hex'); }
function writeRunFile(repoRoot, runId, name, contents) {
  const dir = path.join(repoRoot, 'package-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), contents);
  return contents;
}

function assemblyEvidenceFixture(overrides = {}) {
  return {
    schema: 'vidtoolz.draftAssemblyEvidence.v1',
    kind: 'DRAFT_ASSEMBLY',
    fidelity: 'DRAFT_AUTOMATED_ASSEMBLY',
    production_mode: 'DRAFT',
    asserts: 'a real, decodable, duration-verified video file was assembled deterministically from the exact recorded assets',
    does_not_assert: ['edit quality', 'production readiness', 'approved rough cut', 'publish readiness'],
    satisfies_real_capture: false,
    completes_rough_cut_gate: false,
    human_authority_required: true,
    run_id: 'qc-assembly-run',
    draft_version: 1,
    semantic_producer: 'editor',
    technical_producer: { renderer: 'ffmpeg-draft-assembler', version: 'v0' },
    output: { path: 'media/draft-assembly/draft-v1.mp4', sha256: 'a'.repeat(64), bytes: 1234, duration_seconds: 129.114 },
    technical_validation: { ok: true, failures: [], decode_pass: true },
    source_binding: { ok: true, drift: [] },
    warnings: [],
    state: 'VERIFIED',
    ...overrides,
  };
}

function qcInspectAssembly(evidencePayload, options = {}) {
  const root = qcRoot();
  const runId = 'qc-assembly-run';
  const draftBytes = Buffer.from('draft-mp4-bytes');
  writeRunFile(root, runId, 'draft-v1.mp4', draftBytes);
  const evBytes = Buffer.from(`${JSON.stringify(evidencePayload, null, 2)}\n`);
  writeRunFile(root, runId, 'draft-assembly-evidence.json', evBytes);
  return qc.run({
    task_id: 'qc-assembly', package_run_id: runId, requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'rough-cut-review', run_mode: 'DRAFT',
    subject: {
      artifact_id: 'draft-1', artifact_type: 'DRAFT_ASSEMBLY', producing_agent: 'editor',
      artifact_path: `package-runs/${runId}/draft-v1.mp4`, artifact_sha256: sha256Of(draftBytes),
    },
    evidence: [{
      evidence_id: 'asm', kind: options.kind || 'DRAFT_ASSEMBLY', evidence_class: 'DETERMINISTIC',
      produced_by: 'editor', path: `package-runs/${runId}/draft-assembly-evidence.json`,
      sha256: sha256Of(evBytes),
      binds_to: { artifact_id: 'draft-1', artifact_sha256: sha256Of(draftBytes) },
    }],
    required_evidence: options.required || ['DRAFT_ASSEMBLY'], privacy: { local_only: true },
  }, { repoRoot: root });
}

test('QCA1: DRAFT_ASSEMBLY is registered as its own evidence kind, owned by editor', () => {
  const row = qcPolicy.policyForKind('DRAFT_ASSEMBLY');
  assert.ok(row, 'DRAFT_ASSEMBLY must have a policy row');
  assert.equal(row.producer, 'editor');
  assert.equal(row.producer_module, 'scripts/package-run-draft-assembly.js');
  assert.equal(row.earliest_gate, 'rough-cut-review');
  assert.deepEqual([...row.modes], ['DRAFT', 'REVIEW']);
  // Its own fidelity axis; it does not borrow the AUDIO_RENDER vocabulary.
  assert.equal(row.required_render_class, undefined);
  assert.match(row.fidelity_note, /DRAFT_AUTOMATED_ASSEMBLY/);
  assert.ok(qc.SUPPORTED_EVIDENCE_KINDS.includes('DRAFT_ASSEMBLY'));
});

test('QCA2: valid DRAFT_ASSEMBLY evidence is consumed directly, with no wrapper', () => {
  const result = qcInspectAssembly(assemblyEvidenceFixture());
  assert.deepEqual(result.evidence_coverage.missing, [], 'the required evidence is satisfied by the kind itself');
  assert.ok(!(result.blockers || []).some((b) => /DRAFT_ASSEMBLY/.test(b.explanation || '')),
    'a verified assembly raises no assembly blocker');
  assert.ok(!(result.defects || []).some((d) => /^DRAFT_ASSEMBLY_/.test(d.code || '')),
    'a verified assembly raises no assembly defect');
  // A verified draft is exactly when a human must watch it: QC defers rather
  // than passing the gate on the machine's own evidence.
  assert.equal(result.disposition, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(result.next_gate_allowed, false, 'QC never opens gate 9 on assembly evidence alone');
});

test('QCA3: malformed, unverified, unidentified and drifted evidence all fail loudly', () => {
  const codes = (result) => [...(result.blockers || []), ...(result.defects || [])].map((d) => d.code);

  // Wrong schema entirely.
  assert.ok(codes(qcInspectAssembly(assemblyEvidenceFixture({ schema: 'vidtoolz.somethingElse.v9' })))
    .includes('QC_EVIDENCE_SCHEMA_UNSUPPORTED'));
  // Right schema, wrong kind inside the envelope.
  assert.ok(codes(qcInspectAssembly(assemblyEvidenceFixture({ kind: 'GENERATION_RESULT' })))
    .includes('DRAFT_ASSEMBLY_KIND_MISMATCH'));
  // Not verified.
  assert.ok(codes(qcInspectAssembly(assemblyEvidenceFixture({ state: 'INVALID' })))
    .includes('DRAFT_ASSEMBLY_NOT_VERIFIED'));
  // No hash for the rendered draft: nothing downstream could say what was inspected.
  assert.ok(codes(qcInspectAssembly(assemblyEvidenceFixture({ output: { path: 'x.mp4', sha256: null } })))
    .includes('DRAFT_ASSEMBLY_OUTPUT_UNIDENTIFIED'));
  // Technical validation that recorded failures is not passed over.
  assert.ok(codes(qcInspectAssembly(assemblyEvidenceFixture({
    technical_validation: { ok: false, failures: ['duration is 10s, expected 129.114s'], decode_pass: true },
  }))).includes('DRAFT_ASSEMBLY_TECHNICAL_FAILURE'));
  // A clean probe with a failed decode pass is the truncated-file case.
  assert.ok(codes(qcInspectAssembly(assemblyEvidenceFixture({
    technical_validation: { ok: true, failures: [], decode_pass: false },
  }))).includes('DRAFT_ASSEMBLY_DECODE_FAILED'));
  // Source drift: the assets moved after the draft was rendered.
  assert.ok(codes(qcInspectAssembly(assemblyEvidenceFixture({
    source_binding: { ok: false, drift: ['visual visual-002 bytes changed since binding'] },
  }))).includes('DRAFT_ASSEMBLY_SOURCE_DRIFT'));
});

test('QCA4: assembler warnings reach QC as warnings, not as silence', () => {
  const result = qcInspectAssembly(assemblyEvidenceFixture({
    warnings: [{ code: 'VISUAL_REUSED', detail: 'visual-001 is reused because fewer visuals are bound than sections' }],
  }));
  const warned = [...(result.warnings || []), ...(result.defects || [])];
  assert.ok(warned.some((w) => w.code === 'DRAFT_ASSEMBLY_WARNING' && /VISUAL_REUSED/.test(w.explanation || '')));
});

test('QCA5: an unrelated evidence kind cannot satisfy a required DRAFT_ASSEMBLY', () => {
  const result = qcInspectAssembly(assemblyEvidenceFixture(), { kind: 'GENERATION_RESULT' });
  assert.ok(result.evidence_coverage.missing.includes('DRAFT_ASSEMBLY'),
    'DRAFT_ASSEMBLY must still be reported missing');
});

test('QCA6: the GENERATION_RESULT path is untouched by this addition', () => {
  const row = qcPolicy.policyForKind('GENERATION_RESULT');
  assert.equal(row.producer, 'generation_supervisor');
  assert.equal(row.earliest_gate, 'production-plan');
  assert.equal(row.class, 'GATE_REQUIRED');
  assert.ok(qc.SUPPORTED_EVIDENCE_KINDS.includes('GENERATION_RESULT'));
  // Every kind that existed before is still supported.
  for (const kind of ['CAMERA_QUALITY', 'GENERATION_RESULT', 'EDIT_QC_HANDOFF', 'AUDIO_RENDER', 'STORY_VALIDATION', 'DRAFT_SYNTHETIC_NARRATION']) {
    assert.ok(qc.SUPPORTED_EVIDENCE_KINDS.includes(kind), `${kind} must remain supported`);
  }
});

/* ============ PROXY READINESS: the documented predecessor seam ============ */

test('DAS1: the gate policy records the predecessor seam as data, not as prose', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'gate-mode-policy.json'), 'utf8'));
  const draft = policy.gates['rough-cut-review'].modes.DRAFT;
  assert.equal(draft.required_predecessor_disposition, 'PROXY_CAPTURE_READY');
  assert.equal(draft.required_predecessor_authority, 'scripts/draft-proxy-capture-readiness.js');
  // One readiness constant, owned by the readiness module. No second definition.
  const proxyReadiness = require('../scripts/draft-proxy-capture-readiness.js');
  assert.equal(proxyReadiness.CAPTURE_READY, 'PROXY_CAPTURE_READY');
  const assemblySource = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-draft-assembly.js'), 'utf8');
  assert.ok(!/=\s*'PROXY_CAPTURE_READY'/.test(assemblySource),
    'assembly must compare against the readiness module constant, never redefine it');
  assert.ok(/proxyCapture\.CAPTURE_READY/.test(assemblySource));
});

test('DAS2: the seam is documented where someone looking for it would look', () => {
  const docs = fs.readFileSync(path.join(ROOT, 'docs', 'draft-assembly.md'), 'utf8');
  for (const needle of [
    'PROXY_CAPTURE_READY',
    'scripts/draft-proxy-capture-readiness.js',
    'Expected failure when readiness is absent',
    'Why rendering a draft does not advance the human gate',
  ]) {
    assert.ok(docs.includes(needle), `draft-assembly.md must document: ${needle}`);
  }
});
