// Tests for the Earth Studio map-animation tool (planner v0.2 + lane), 2026-06-27.
// Injected ffmpeg spawn + temp run dirs — no real renders, no VIDNAS writes.
const { assert, fs, os, path, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const lane = require("../earth-studio-lane.js");

function fakeChild() {
  const h = {};
  return { pid: 71, stdout: { on: () => {} }, stderr: { on: () => {} }, on: (e, cb) => { h[e] = cb; }, kill: () => {}, _fire: (e, ...a) => h[e] && h[e](...a) };
}
function tmpRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-lane-"));
  fs.mkdirSync(path.join(root, "package-runs", "2026-01-01-test"), { recursive: true });
  return { root, runId: "2026-01-01-test" };
}

// ---- planner ----
test("earth-studio planner: parses orbit, zoom_in, and explicit coordinates", () => {
  const plan = planner.buildShotPlan("T", "hover over Tokyo for 4 seconds, then fly to 35.65,139.84 in 6 seconds, then orbit Tokyo for 5 seconds, then zoom in on Tokyo for 3 seconds");
  assert.equal(plan.segments.length, 4); // coordinates not shattered by the splitter
  const actions = plan.segments.map((s) => s.action);
  assert.deepEqual(actions, ["hover", "fly_to", "orbit", "zoom_in"]);
  assert.ok(plan.segments.every((s) => s.resolution_status === "resolved"));
});

test("earth-studio planner: explicit lat,lng resolves without a gazetteer entry", () => {
  const loc = planner.resolveLocation("35.65,139.84");
  assert.ok(loc && loc.latitude === 35.65 && loc.longitude === 139.84);
  assert.equal(loc.source, "explicit_coordinates");
});

test("earth-studio planner: gazetteer expanded beyond the original two", () => {
  assert.ok(Object.keys(planner.LOCATION_FIXTURES).length >= 10);
  assert.ok(planner.resolveLocation("Tokyo"));
  // Downtown Boston coordinates preserved (legacy invariant).
  assert.equal(planner.LOCATION_FIXTURES["downtown boston"].latitude, 42.3555);
});

test("earth-studio planner: buildEsp emits camera position keyframes", () => {
  const plan = planner.buildShotPlan("Job", "hover over Tokyo for 2 seconds, then fly to London in 4 seconds");
  const esp = planner.buildEsp(plan);
  assert.equal(esp.frameRate, 30);
  assert.equal(esp.duration, plan.total_frames);
  const camGroup = esp.scenes[0].attributes[0].attributes;
  const lng = camGroup[0].attributes[0].value.keyframes;
  assert.ok(lng.length >= 3); // frame 0 + per-segment end frames
  assert.ok(JSON.parse(JSON.stringify(esp))); // serializable
});

// ---- lane ----
test("earth-studio lane: writeJob writes plan + .esp + job.json into the run", () => {
  const { root, runId } = tmpRun();
  const out = lane.writeJob({ runId, jobName: "City Flyover", description: "fly to London in 5 seconds" }, { root });
  assert.equal(out.ok, true);
  const dir = lane.laneDir(runId, { root });
  ["shot-plan.json", "earth-studio.esp", "route.kml", "job.json"].forEach((f) => assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`));
  const st = lane.status({ runId }, { root });
  assert.equal(st.has_plan, true);
  assert.equal(st.has_esp, true);
  assert.equal(st.frame_count, 0);
});

test("earth-studio lane: startRender refuses when no frames are exported yet", () => {
  const { root, runId } = tmpRun();
  lane.writeJob({ runId, jobName: "J", description: "fly to Paris in 3 seconds" }, { root });
  lane.STATE.activeJob = null;
  assert.throws(() => lane.startRender({ runId }, { root, spawn: () => fakeChild() }), /No exported frames/);
});

test("earth-studio lane: startRender builds an ffmpeg glob job once frames exist", () => {
  const { root, runId } = tmpRun();
  lane.writeJob({ runId, jobName: "J", description: "fly to Paris in 3 seconds" }, { root });
  fs.writeFileSync(path.join(lane.laneDir(runId, { root }), "frames", "Frame_0000.jpeg"), "x");
  lane.STATE.activeJob = null;
  const calls = [];
  const out = lane.startRender({ runId }, { root, spawn: (bin, args) => { calls.push({ bin, args }); return fakeChild(); } });
  assert.equal(out.ok, true);
  assert.equal(calls[0].bin, "ffmpeg");
  assert.ok(calls[0].args.includes("-pattern_type") && calls[0].args.includes("glob"));
  assert.ok(calls[0].args.some((a) => a.endsWith("frames/*.jpeg")));
  // concurrent render refused
  assert.throws(() => lane.startRender({ runId }, { root, spawn: () => fakeChild() }), /already running/);
  lane.STATE.activeJob = null;
});

test("earth-studio lane: stageToVidnas copies the MP4 and refuses approved paths", () => {
  const { root, runId } = tmpRun();
  lane.writeJob({ runId, jobName: "J", description: "fly to Paris in 3 seconds" }, { root });
  const out = lane.renderPath(runId, { root });
  fs.writeFileSync(out, "fake-mp4");
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "es-stage-"));
  const res = lane.stageToVidnas({ runId }, { root, stageDir });
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(res.staged_to));
  assert.throws(() => lane.stageToVidnas({ runId }, { root, stageDir: "/x/v1-approved" }), /approved media/);
});
