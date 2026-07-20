const { test, assert, fs, path } = require('./_helpers.js');

// Canonical PRESTO image-to-video profile contract (config/presto/). These are
// the git-tracked source of the profiles.json + ComfyUI workflow that
// run-production.py reads on VIDNAS and submits to PRESTO ComfyUI dynamically.
// New Super Focus video attempts select the HQ profile by NAME; its geometry is
// owned entirely by the workflow JSON here (the cockpit never passes
// width/height/fps/frames on the command line). This suite pins the target
// contract: 720 x 1280, 24 fps, 97 frames (Wan length = 4n+1), ~4.04 s.

const PRESTO_DIR = path.join(__dirname, '..', 'config', 'presto');
const HQ_PROFILE = 'wan22_hq_720p_5s_no_lightx2v';
const HQ_WORKFLOW_REL = 'workflows/wan22_i2v_vertical_720x1280_24fps_97f_hq_no_lightx2v_api.json';

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(PRESTO_DIR, rel), 'utf8'));
}

// Semantic node lookup by class_type, not brittle node IDs.
function nodeByClass(workflow, classType) {
  const hits = Object.values(workflow).filter((n) => n && n.class_type === classType);
  assert.equal(hits.length, 1, `exactly one ${classType} node expected, found ${hits.length}`);
  return hits[0];
}

test('presto profiles.json: HQ profile is the canonical 720x1280 / 24fps / 97f vertical spec', () => {
  const profiles = readJson('profiles.json');
  const hq = profiles[HQ_PROFILE];
  assert.ok(hq, `${HQ_PROFILE} profile must exist`);
  assert.equal(hq.width, 720, 'HQ width');
  assert.equal(hq.height, 1280, 'HQ height');
  assert.equal(hq.fps, 24, 'HQ fps');
  assert.equal(hq.frames, 97, 'HQ frame count');
  assert.equal(hq.recommended, true, 'HQ profile is the recommended/default');
  assert.equal(hq.output_subdir, 'mp4-hq-720p', 'HQ output subdir unchanged');
  assert.equal(hq.workflow, HQ_WORKFLOW_REL, 'HQ profile points at the 24fps/97f workflow');
  // 97 = 4*24 + 1 satisfies the Wan length = 4n+1 constraint.
  assert.equal((hq.frames - 1) % 4, 0, 'frame count must be 4n+1 for Wan2.2');
  // Duration is preserved at ~4.04s (97/24 = 4.0417) and stays >= the 4.0s floor.
  const computed = hq.frames / hq.fps;
  assert.ok(Math.abs(computed - 4.04) < 0.02, `computed duration ${computed.toFixed(4)}s ~= 4.04s`);
  assert.ok(computed >= (hq.min_duration_seconds || 0), 'duration meets the profile minimum');
  assert.equal(hq.expected_duration_seconds, 4.04, 'declared expected duration');
});

test('presto profiles.json: legacy fast_current profile is intentionally unchanged (1080x1920 / 30fps / 81f)', () => {
  const fast = readJson('profiles.json').fast_current;
  assert.ok(fast, 'fast_current profile must still exist');
  assert.equal(fast.width, 1080);
  assert.equal(fast.height, 1920);
  assert.equal(fast.fps, 30);
  assert.equal(fast.frames, 81);
  assert.equal(fast.output_subdir, 'mp4');
});

test('presto HQ workflow graph: WanImageToVideo emits 720x1280x97 and CreateVideo emits 24 fps', () => {
  const wf = readJson(HQ_WORKFLOW_REL);
  const gen = nodeByClass(wf, 'WanImageToVideo');
  assert.equal(gen.inputs.width, 720, 'generation width');
  assert.equal(gen.inputs.height, 1280, 'generation height');
  assert.equal(gen.inputs.length, 97, 'generation frame length (generate AT the target, no upscale/resize)');
  const enc = nodeByClass(wf, 'CreateVideo');
  assert.equal(enc.inputs.fps, 24, 'encoder output fps');
  assert.ok(gen.inputs.height > gen.inputs.width, 'portrait orientation');
});

test('presto HQ workflow graph: portrait 9:16 aspect ratio', () => {
  const wf = readJson(HQ_WORKFLOW_REL);
  const gen = nodeByClass(wf, 'WanImageToVideo');
  // 720:1280 reduces to 9:16.
  assert.equal(gen.inputs.width * 16, gen.inputs.height * 9, '720x1280 is exactly 9:16');
});

test('presto config: no stale 25fps / 101 frames / 1080x1920 in the HQ profile or workflow', () => {
  const profilesText = fs.readFileSync(path.join(PRESTO_DIR, 'profiles.json'), 'utf8');
  const wfText = fs.readFileSync(path.join(PRESTO_DIR, HQ_WORKFLOW_REL), 'utf8');
  const hq = JSON.parse(profilesText)[HQ_PROFILE];
  // The HQ profile's own numeric spec must not carry the old values.
  assert.notEqual(hq.fps, 25);
  assert.notEqual(hq.frames, 101);
  // The HQ workflow graph must not contain the old fps/length node values.
  assert.ok(!/"fps":\s*25/.test(wfText), 'HQ workflow must not encode 25 fps');
  assert.ok(!/"length":\s*101/.test(wfText), 'HQ workflow must not encode 101 frames');
});
