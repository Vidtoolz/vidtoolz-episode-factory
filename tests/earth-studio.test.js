// Tests for the Earth Studio map-animation tool (planner v0.3 + project lane).
// Revived 2026-07-02 from branch earth-studio-map-lane and retargeted to the
// projects lane. Injected ffmpeg spawn + temp package dirs — no real renders,
// no VIDNAS writes, no network.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const lane = require("../earth-studio-lane.js");

function fakeChild() {
  const h = {};
  return { pid: 71, stdout: { on: () => {} }, stderr: { on: () => {} }, on: (e, cb) => { h[e] = cb; }, kill: () => {}, _fire: (e, ...a) => h[e] && h[e](...a) };
}
function tmpPackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-lane-"));
  const scriptPackages = path.join(root, "aigen", "script-packages");
  const packageId = "es-test-project";
  const pkg = path.join(scriptPackages, packageId);
  fs.mkdirSync(pkg, { recursive: true });
  return { root, aigenRoot: path.join(root, "aigen"), scriptPackages, packageId, pkg };
}

// ---- planner (v0.3) ----
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
  assert.ok(planner.resolveLocation("Helsinki"));
});

test("earth-studio planner: buildEsp emits the real Earth Studio project format (modelVersion 17)", () => {
  const plan = planner.buildShotPlan("Job", "hover over Tokyo for 2 seconds, then fly to London in 4 seconds");
  const esp = planner.buildEsp(plan);
  // Real reverse-engineered envelope — the v0.4 from-scratch guess was
  // refused by real Earth Studio (acceptance round 1, 2026-08-07).
  assert.equal(esp.modelVersion, 17);
  assert.equal(esp.settings.frameRate, 30);
  assert.equal(esp.settings.duration, plan.total_frames);
  assert.equal(esp.settings.timeFormat, "frames");
  assert.equal(esp.playbackManager.range.end, plan.total_frames);
  const cam = esp.scenes[0].attributes.find((a) => a.type === "cameraGroup");
  const pos = cam.attributes.find((a) => a.type === "cameraPositionGroup");
  const lng = pos.attributes.find((a) => a.type === "longitude");
  assert.ok(lng.keyframes.length >= 3); // frame 0 + per-segment end frames
  // keyframes sit BESIDE value, times are duration fractions, values normalized
  assert.ok(lng.keyframes.every((k) => k.time >= 0 && k.time <= 1));
  assert.ok(lng.keyframes.every((k) => k.value >= 0 && k.value <= 1));
  assert.equal(lng.intimeline, true);
  // longitude round trip: min + v·(180−min) reconstructs Tokyo at frame 0
  const lonMin = lng.value.minValueRange;
  const tokyo = lonMin + lng.keyframes[0].value * (180 - lonMin);
  assert.ok(Math.abs(tokyo - 139.6503) < 1e-6, `round trip gave ${tokyo}`);
  // altitude uses the empirical Earth Studio scale
  const alt = pos.attributes.find((a) => a.type === "altitude");
  const altMeters = alt.keyframes[0].value / 1.5356706349899208e-08;
  assert.ok(Math.abs(altMeters - plan.segments[0].altitude_m) < 0.5, `altitude round trip gave ${altMeters}`);
  assert.ok(JSON.parse(JSON.stringify(esp))); // serializable
});

test("earth-studio planner: validation is generic (no Boston fossil), catches bad coords", () => {
  const plan = planner.buildShotPlan("Job", "fly to Paris in 3 seconds");
  assert.deepEqual(planner.validateShotPlanPayload(plan), []);
  const bad = JSON.parse(JSON.stringify(plan));
  bad.locations[0].latitude = 999;
  assert.match(planner.validateShotPlanPayload(bad).join("\n"), /latitude out of range/);
});

// ---- lane (project-scoped) ----
test("earth-studio lane: writeJob writes plan + .esp + job.json into the package", () => {
  const { root, pkg } = tmpPackage();
  const out = lane.writeJob(pkg, { jobName: "City Flyover", description: "fly to London in 5 seconds" });
  assert.equal(out.ok, true);
  const dir = lane.laneDir(pkg);
  ["shot-plan.json", "earth-studio.esp", "route.kml", "job.json"].forEach((f) => assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`));
  const st = lane.status(pkg, "es-test-project");
  assert.equal(st.has_plan, true);
  assert.equal(st.has_esp, true);
  assert.equal(st.frame_count, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("earth-studio lane: startRender refuses when no frames are exported yet", () => {
  const { root, pkg } = tmpPackage();
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" });
  lane.STATE.activeJob = null;
  assert.throws(() => lane.startRender(pkg, "es-test-project", { spawn: () => fakeChild() }), /No exported frames/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("earth-studio lane: startRender builds an ffmpeg glob job once frames exist", () => {
  const { root, pkg } = tmpPackage();
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" });
  fs.writeFileSync(path.join(lane.laneDir(pkg), "frames", "Frame_0000.jpeg"), "x");
  lane.STATE.activeJob = null;
  const calls = [];
  const out = lane.startRender(pkg, "es-test-project", { spawn: (bin, args) => { calls.push({ bin, args }); return fakeChild(); } });
  assert.equal(out.ok, true);
  assert.equal(calls[0].bin, "ffmpeg");
  assert.ok(calls[0].args.includes("-pattern_type") && calls[0].args.includes("glob"));
  assert.ok(calls[0].args.some((a) => a.endsWith("frames/*.jpeg")));
  // concurrent render refused
  assert.throws(() => lane.startRender(pkg, "es-test-project", { spawn: () => fakeChild() }), /already running/);
  lane.STATE.activeJob = null;
  fs.rmSync(root, { recursive: true, force: true });
});

test("earth-studio lane: stageToVidnas copies the MP4 and refuses approved paths", () => {
  const { root, pkg } = tmpPackage();
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" });
  const out = lane.renderPath(pkg);
  fs.writeFileSync(out, "fake-mp4");
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "es-stage-"));
  const res = lane.stageToVidnas(pkg, "es-test-project", { stageDir });
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(res.staged_to));
  assert.throws(() => lane.stageToVidnas(pkg, "es-test-project", { stageDir: "/x/v1-approved" }), /approved media/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- HTTP endpoints (project-scoped, nonce-gated writes) ----
function listen(s) { return new Promise((r) => s.listen(0, "127.0.0.1", r)); }
function close(s) { return new Promise((r) => s.close(r)); }
function requestJson(server, pathname, options = {}) {
  const a = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const headers = Object.assign(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}, options.headers || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: a.port, path: pathname, method: options.method || "GET", headers }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => { raw += c; });
      res.on("end", () => { try { resolve({ statusCode: res.statusCode, body: JSON.parse(raw) }); } catch (e) { reject(e); } });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

test("earth-studio API: plan requires nonce; status reports the written job; traversal rejected", async () => {
  const fx = tmpPackage();
  const prev = { r: process.env.AIGEN_VIDNAS_ROOT, s: process.env.AIGEN_SCRIPT_PACKAGES };
  process.env.AIGEN_VIDNAS_ROOT = fx.aigenRoot; process.env.AIGEN_SCRIPT_PACKAGES = fx.scriptPackages;
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    // no nonce -> 403
    const noNonce = await requestJson(server, packageEngineServer.EARTH_STUDIO_PLAN_API, {
      method: "POST", body: { id: fx.packageId, description: "fly to Paris in 3 seconds" }, headers: { host: "127.0.0.1:8010" },
    });
    assert.equal(noNonce.statusCode, 403);
    // traversal id -> 400
    const trav = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_STATUS_API}?id=${encodeURIComponent("../../etc")}`);
    assert.equal(trav.statusCode, 400);
    // nonce-gated plan write
    const plan = await requestJson(server, packageEngineServer.EARTH_STUDIO_PLAN_API, {
      method: "POST",
      body: { id: fx.packageId, jobName: "Flyover", description: "fly to Paris in 3 seconds" },
      headers: { host: "127.0.0.1:8010", [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() },
    });
    assert.equal(plan.statusCode, 200);
    assert.equal(plan.body.data.ok, true);
    assert.ok(fs.existsSync(path.join(fx.pkg, "earth-studio", "earth-studio.esp")));
    const st = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_STATUS_API}?id=${fx.packageId}`);
    assert.equal(st.body.data.has_plan, true);
    assert.equal(st.body.data.has_esp, true);
  } finally {
    await close(server);
    if (prev.r === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = prev.r;
    if (prev.s === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.s;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("earth-studio GUI: pipeline page is a launcher; the guided page owns the workflow", () => {
  const pipeline = fs.readFileSync(path.join(__dirname, "..", "production-pipeline.html"), "utf8");
  assert.match(pipeline, /earth-studio-lane/);
  assert.match(pipeline, /project-earth-studio\.html\?id=/);
  assert.doesNotMatch(pipeline, /\/api\/earth-studio\/plan/); // writes live on the guided page only
  assert.doesNotMatch(pipeline, /es-run\b/);

  const page = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  assert.match(page, /earth-studio-job-planner\.js/); // live client-side parse preview
  assert.match(page, /parseDescription/);
  assert.match(page, /LOCATION_FIXTURES/); // gazetteer chips
  assert.match(page, /\/api\/earth-studio\/plan/);
  assert.match(page, /\/api\/earth-studio\/render/);
  assert.match(page, /\/api\/earth-studio\/stage/);
  assert.match(page, /earth\.google\.com\/studio/);
  assert.match(page, /frames folder/i);
  assert.match(page, /page-guide/);
  for (const step of ["1 · Describe", "2 · Build the move", "3 · Export frames", "4 · Render frames", "5 · Use it"]) {
    assert.ok(page.includes(step), `missing step: ${step}`);
  }
  assert.doesNotMatch(page, /8099/);
});

test("earth-studio GUI: workspace and media kit link to the guided page", () => {
  for (const f of ["project-workspace.html", "project-media-kit.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.match(html, /project-earth-studio\.html\?id=/, `${f} must link to the Earth Studio workspace`);
  }
});

// ---- Cancel render control (new, backed by the existing cancel route) ----

test("earth-studio lane: cancelRender signals an active render and is a no-op when idle", () => {
  const { root, pkg } = tmpPackage();
  lane.STATE.activeJob = null;
  const idle = lane.cancelRender();
  assert.equal(idle.ok, true);
  assert.match(String(idle.signal_sent), /no active render/i);

  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" });
  fs.writeFileSync(path.join(lane.laneDir(pkg), "frames", "Frame_0000.jpeg"), "x");
  lane.startRender(pkg, "es-test-project", { spawn: () => fakeChild() });
  let sentSignal = null;
  const res = lane.cancelRender({ kill: (sig) => { sentSignal = sig; } });
  assert.equal(res.ok, true);
  assert.equal(sentSignal, "SIGTERM");
  assert.equal(res.signal_sent, "SIGTERM");
  lane.STATE.activeJob = null;
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- parser hardening (2026-08-03): coordinate separator + period splitting ----

test("earth-studio planner: space-separated numbers are NOT coordinates; , and / are", () => {
  assert.equal(planner.resolveLocation("Area 51 7"), null); // was lat 51, lng 7
  assert.ok(planner.resolveLocation("35.65,139.84"));
  assert.ok(planner.resolveLocation("35.65 , 139.84"));
  assert.ok(planner.resolveLocation("35.65/139.84"));
  const labeled = planner.resolveLocation("lat 42.3 lng -71"); // labeled form still covers spaces
  assert.ok(labeled && labeled.latitude === 42.3 && labeled.longitude === -71);
});

test("earth-studio planner: periods do not shatter location names or add segments", () => {
  const plan = planner.buildShotPlan("T", "fly to St. Petersburg in 4 seconds");
  assert.equal(plan.segments.length, 1); // was 2: "St" + unresolved fragment
  assert.match(plan.segments[0].location_name, /St\. Petersburg/);
  // trailing sentence period is trimmed and the segment still resolves
  const plan2 = planner.buildShotPlan("T", "orbit London for 5 seconds.");
  assert.equal(plan2.segments.length, 1);
  assert.equal(plan2.segments[0].resolution_status, "resolved");
  // chaining via then / commas is unchanged
  const plan3 = planner.buildShotPlan("T", "fly to 35.65,139.84 in 6 seconds, then orbit Tokyo for 5 seconds");
  assert.equal(plan3.segments.length, 2);
  assert.ok(plan3.segments.every((s) => s.resolution_status === "resolved"));
});

// ---- VIDNAS mount guard (2026-08-03): bounded probe + down-latch ----

test("earth-studio lane: probeMount skips non-/mnt roots without touching fs", async () => {
  lane.resetMountLatch();
  let stats = 0;
  const res = await lane.probeMount("/tmp/anywhere", { stat: () => { stats += 1; return Promise.resolve({ isDirectory: () => true }); } });
  assert.equal(res.skipped, true);
  assert.equal(stats, 0);
});

test("earth-studio lane: probeMount latches a downed mount and fails fast inside the TTL", async () => {
  lane.resetMountLatch();
  let stats = 0;
  const downStat = () => { stats += 1; return Promise.reject(Object.assign(new Error("no device"), { code: "ENODEV" })); };
  let t = 1000000;
  const now = () => t;
  await assert.rejects(() => lane.probeMount("/mnt/es-test", { stat: downStat, now }), /VIDNAS is unreachable/);
  assert.equal(stats, 1);
  // inside the TTL: rejected from the latch, stat NOT called again
  t += 5000;
  await assert.rejects(() => lane.probeMount("/mnt/es-test", { stat: downStat, now }), /VIDNAS is unreachable/);
  assert.equal(stats, 1);
  // after the TTL expires the mount is probed live again and can recover
  t += lane.MOUNT_DOWN_TTL_MS + 1;
  const ok = await lane.probeMount("/mnt/es-test", { stat: () => Promise.resolve({ isDirectory: () => true }), now });
  assert.equal(ok.ok, true);
  // healthy mount is never latched: an immediate re-probe hits stat again
  const ok2 = await lane.probeMount("/mnt/es-test", { stat: () => { stats += 1; return Promise.resolve({ isDirectory: () => true }); }, now });
  assert.equal(ok2.ok, true);
  assert.equal(stats, 2);
  lane.resetMountLatch();
});

test("earth-studio lane: probeMount bounds a hung mount with a timeout and latches", async () => {
  lane.resetMountLatch();
  const hungStat = () => new Promise(() => {}); // never settles, like a wedged autofs
  await assert.rejects(() => lane.probeMount("/mnt/es-test", { stat: hungStat, timeoutMs: 25 }), /VIDNAS is unreachable.*timed out/);
  await assert.rejects(() => lane.probeMount("/mnt/es-test", { stat: hungStat, timeoutMs: 25 }), /VIDNAS is unreachable/);
  lane.resetMountLatch();
});

test("earth-studio API: a downed NAS root returns 503 fast instead of blocking", async () => {
  const prev = { r: process.env.AIGEN_VIDNAS_ROOT, s: process.env.AIGEN_SCRIPT_PACKAGES };
  // /mnt path that does not exist: the probe stats it once, fails, and latches.
  process.env.AIGEN_VIDNAS_ROOT = "/mnt/es-test-nonexistent-aigen";
  process.env.AIGEN_SCRIPT_PACKAGES = "/mnt/es-test-nonexistent-aigen/script-packages";
  lane.resetMountLatch();
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const st = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_STATUS_API}?id=some-project`);
    assert.equal(st.statusCode, 503);
    assert.match(String(st.body.error || ""), /VIDNAS is unreachable/);
  } finally {
    await close(server);
    lane.resetMountLatch();
    if (prev.r === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = prev.r;
    if (prev.s === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.s;
  }
});

// ---- stale-frames + frame-count guard (2026-08-03) ----

test("earth-studio lane: frames exported after the plan are not stale; regenerating the plan marks them stale", () => {
  const { root, pkg } = tmpPackage();
  // plan generated a minute ago, frames exported now -> fresh
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" }, { now: new Date(Date.now() - 60000).toISOString() });
  const framesDir = path.join(lane.laneDir(pkg), "frames");
  fs.writeFileSync(path.join(framesDir, "Frame_0000.jpeg"), "x");
  assert.equal(lane.status(pkg, "p").frames_stale, false);
  // plan regenerated now, frames dir AND file mtimes forced into the past ->
  // stale (an old export means old file mtimes too; a fresh in-place
  // re-export is covered by the v0.7 staleness test below)
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 4 seconds" });
  const past = new Date(Date.now() - 3600000);
  fs.utimesSync(framesDir, past, past);
  fs.utimesSync(path.join(framesDir, "Frame_0000.jpeg"), past, past);
  const st = lane.status(pkg, "p");
  assert.equal(st.frames_stale, true);
  assert.equal(st.frame_count, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("earth-studio lane: startRender warns on frame-count mismatch and stale frames but does not block", () => {
  const { root, pkg } = tmpPackage();
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" }); // plan expects 90 frames
  const framesDir = path.join(lane.laneDir(pkg), "frames");
  fs.writeFileSync(path.join(framesDir, "Frame_0000.jpeg"), "x");
  const past = new Date(Date.now() - 3600000);
  fs.utimesSync(framesDir, past, past); // also stale (dir + file both old)
  fs.utimesSync(path.join(framesDir, "Frame_0000.jpeg"), past, past);
  lane.STATE.activeJob = null;
  const out = lane.startRender(pkg, "p", { spawn: () => fakeChild() });
  assert.equal(out.ok, true);
  assert.equal(out.frame_count, 1);
  assert.equal(out.frames_expected, 90);
  assert.match(out.warnings.join("\n"), /differs from the plan/);
  assert.match(out.warnings.join("\n"), /exported before the current plan/);
  lane.STATE.activeJob = null;
  fs.rmSync(root, { recursive: true, force: true });
});

test("earth-studio lane: cancelRender leaves job state untouched when the kill signal throws", () => {
  const { root, pkg } = tmpPackage();
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" });
  fs.writeFileSync(path.join(lane.laneDir(pkg), "frames", "Frame_0000.jpeg"), "x");
  lane.STATE.activeJob = null;
  lane.startRender(pkg, "p", { spawn: () => fakeChild() });
  assert.throws(() => lane.cancelRender({ kill: () => { throw Object.assign(new Error("no such process"), { code: "ESRCH" }); } }), /no such process/);
  assert.equal(lane.STATE.activeJob.exitState, "running"); // not stuck on 'cancelled'
  lane.STATE.activeJob = null;
  fs.rmSync(root, { recursive: true, force: true });
});

test("project-earth-studio.html surfaces planned frame count and staleness", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  assert.match(html, /of \$\{job\.total_frames\} planned/);
  assert.match(html, /frames_stale/);
  assert.match(html, /older than the current plan/);
});

test("project-earth-studio.html wires a Cancel render control to the cancel route, shown only while rendering", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  // Button is rendered only when a render is active.
  assert.match(html, /renderJob\.active\?'<button[^>]*id="es-cancel"/);
  // Handler is wired and posts to the cancel route.
  assert.match(html, /es-cancel'\);\s*if\s*\(cbtnEl\)\s*cbtnEl\.onclick\s*=\s*cancelRender/);
  assert.match(html, /async function cancelRender[\s\S]*?\/api\/earth-studio\/cancel/);
});

// ---- v0.4: vibe grammar (carry-over, defaults, altitude/tilt/orbit modifiers) ----

test("earth-studio planner v0.4: bare vibe description resolves via carry-over + default durations", () => {
  const plan = planner.buildShotPlan("T", "fly to Paris, then orbit, then zoom in");
  assert.equal(plan.segments.length, 3);
  assert.ok(plan.segments.every((s) => s.resolution_status === "resolved"), JSON.stringify(plan.warnings));
  assert.equal(plan.segments[1].location_name, "Paris"); // carried over
  assert.equal(plan.segments[1].location.source, "carried_over");
  assert.equal(plan.segments[0].duration_seconds, 5); // first fly_to = establishing dive default
  assert.equal(plan.segments[1].duration_seconds, 17); // one revolution at default tilt 60 (10s base × tan 60°)
  assert.match(plan.notes.join("\n"), /defaulted to/);
  assert.match(plan.notes.join("\n"), /carried over/);
});

test("earth-studio planner v0.6: default durations scale with the move's magnitude (real ES playback proved flat defaults unusable)", () => {
  // intercontinental flight gets flight time, cross-town hop stays snappy
  const far = planner.buildShotPlan("T", "hover over Helsinki for 2 seconds, then fly to Tokyo");
  assert.ok(far.segments[1].duration_seconds >= 20, `Helsinki→Tokyo defaulted to ${far.segments[1].duration_seconds}s`);
  const near = planner.buildShotPlan("T", "hover over Big Ben for 2 seconds, then fly to Tower Bridge");
  assert.ok(near.segments[1].duration_seconds <= 5, `cross-town hop defaulted to ${near.segments[1].duration_seconds}s`);
  // orbits scale per revolution AND camera proximity (tan(tilt), round-3 feedback)
  const twice = planner.buildShotPlan("T", "orbit Paris twice"); // default tilt 60
  assert.equal(twice.segments[0].duration_seconds, 35);
  assert.equal(planner.orbitSecondsPerRevolution(0), 10); // top-down: far view, base rate
  assert.equal(Math.round(planner.orbitSecondsPerRevolution(60)), 17);
  const topDown = planner.buildShotPlan("T", "orbit Paris top-down");
  assert.equal(topDown.segments[0].duration_seconds, 10);
  // huge zooms get more time than small ones
  const spaceZoom = planner.buildShotPlan("T", "hover over Paris for 2 seconds, then zoom out to space");
  assert.equal(spaceZoom.segments[1].duration_seconds, 12);
  assert.equal(planner.defaultDuration("zoom_in", { fromAltitudeM: 2500, toAltitudeM: 800 }), 4);
});

test("earth-studio planner v0.6: absurd explicit speeds draw advisory pacing notes but never block", () => {
  const plan = planner.buildShotPlan("T", "fly to Helsinki in 3 seconds, then fly to Paris in 5 seconds, then orbit twice for 8 seconds, then zoom out to space in 3 seconds");
  const pacing = plan.notes.filter((n) => n.includes("pacing:"));
  assert.equal(pacing.length, 3, plan.notes.join(" | ")); // flight + orbit + zoom flagged
  assert.match(pacing.join("\n"), /km\/s flight/);
  assert.match(pacing.join("\n"), /°\/s/);
  assert.ok(plan.segments.every((s) => s.resolution_status === "resolved"), "advisories must not block");
  // sane explicit durations draw no pacing notes (the round-3 fixture)
  const sane = planner.buildShotPlan("T", "fly to Helsinki in 5 seconds, then fly to Paris at 2 km tilted 35 degrees in 18 seconds, then orbit twice counterclockwise for 36 seconds, then zoom out to space in 12 seconds");
  assert.equal(sane.notes.filter((n) => n.includes("pacing:")).length, 0, sane.notes.join(" | "));
});

test("earth-studio planner v0.4: altitude modifiers (numeric, km, space, low/high, fixture, terrain floor)", () => {
  const p1 = planner.buildShotPlan("T", "orbit Paris at 800m for 5 seconds");
  assert.equal(p1.segments[0].altitude_m, 800);
  assert.equal(p1.segments[0].location_name, "Paris"); // modifier stripped before location parse
  const p2 = planner.buildShotPlan("T", "hover over Tokyo at 2 km for 3 seconds");
  assert.equal(p2.segments[0].altitude_m, 2000);
  const p3 = planner.buildShotPlan("T", "zoom out from Helsinki to space in 6 seconds");
  assert.equal(p3.segments[0].altitude_m, planner.SPACE_ALTITUDE_M);
  assert.equal(p3.segments[0].location_name, "Helsinki");
  const p4 = planner.buildShotPlan("T", "hover low over Paris for 3 seconds");
  assert.ok(p4.segments[0].altitude_m < planner.DEFAULT_ALTITUDE_M);
  // landmark fixture altitude beats the generic default
  const p5 = planner.buildShotPlan("T", "zoom in on Eiffel Tower for 3 seconds");
  assert.equal(p5.segments[0].altitude_m, 1000);
  // terrain floor: a zoom over high ground never targets below min_altitude_m
  const p6 = planner.buildShotPlan("T", "zoom in on Denver for 3 seconds");
  assert.ok(p6.segments[0].altitude_m >= 2600, `Denver zoom target ${p6.segments[0].altitude_m} below terrain floor`);
});

test("earth-studio planner v0.4: orbit amount + direction modifiers", () => {
  const p1 = planner.buildShotPlan("T", "orbit Paris twice for 8 seconds");
  assert.equal(p1.segments[0].orbit_degrees, 720);
  assert.equal(p1.segments[0].location_name, "Paris");
  const p2 = planner.buildShotPlan("T", "orbit London counterclockwise for 5 seconds");
  assert.equal(p2.segments[0].orbit_direction, -1);
  assert.equal(p2.segments[0].location_name, "London");
  const p3 = planner.buildShotPlan("T", "orbit Tokyo 180 degrees for 4 seconds");
  assert.equal(p3.segments[0].orbit_degrees, 180);
  const p4 = planner.buildShotPlan("T", "orbit Rome for 5 seconds"); // defaults
  assert.equal(p4.segments[0].orbit_degrees, 360);
  assert.equal(p4.segments[0].orbit_direction, 1);
});

test("earth-studio planner v0.4: tilt modifiers and per-action defaults", () => {
  const p1 = planner.buildShotPlan("T", "orbit Tokyo top-down for 5 seconds");
  assert.equal(p1.segments[0].tilt_deg, 0);
  assert.equal(p1.segments[0].location_name, "Tokyo");
  const p2 = planner.buildShotPlan("T", "orbit Tokyo tilted 30 degrees for 5 seconds");
  assert.equal(p2.segments[0].tilt_deg, 30);
  const p3 = planner.buildShotPlan("T", "orbit Tokyo for 5 seconds");
  assert.equal(p3.segments[0].tilt_deg, planner.DEFAULT_TILT_DEG.orbit);
});

test("earth-studio planner v0.4: gazetteer is worldwide with aliases and normalized lookups", () => {
  assert.ok(Object.keys(planner.LOCATION_FIXTURES).length >= 140);
  Object.entries(planner.LOCATION_FIXTURES).forEach(([key, l]) => {
    assert.ok(Number.isFinite(l.latitude) && l.latitude >= -90 && l.latitude <= 90, `${key} latitude`);
    assert.ok(Number.isFinite(l.longitude) && l.longitude >= -180 && l.longitude <= 180, `${key} longitude`);
    assert.ok(l.name, `${key} name`);
  });
  Object.entries(planner.LOCATION_ALIASES).forEach(([alias, target]) => {
    assert.ok(planner.LOCATION_FIXTURES[target], `alias "${alias}" points to missing fixture "${target}"`);
  });
  assert.equal(planner.resolveLocation("NYC").name, "New York");
  assert.equal(planner.resolveLocation("the Eiffel Tower").name, "Eiffel Tower");
  assert.equal(planner.resolveLocation("Bogotá").name, "Bogota"); // diacritics normalized
  assert.equal(planner.resolveLocation("St. Petersburg").name, "St. Petersburg"); // punctuation normalized
  assert.equal(planner.resolveLocation("Everest").name, "Mount Everest");
});

// ---- v0.4: keyframe engine (fixes the two held bugs + cinematic profiles) ----

test("earth-studio esp: a first-segment zoom_in starts wide instead of copying the end state", () => {
  const plan = planner.buildShotPlan("T", "zoom in on Helsinki for 3 seconds");
  const kf = planner.buildEspKeyframes(plan);
  assert.ok(kf.alt.length >= 2);
  assert.ok(kf.alt[0].value > kf.alt[kf.alt.length - 1].value, `zoom_in should descend: ${kf.alt[0].value} -> ${kf.alt[kf.alt.length - 1].value}`);
  assert.equal(kf.alt[kf.alt.length - 1].value, plan.segments[0].altitude_m);
});

test("earth-studio esp: consecutive orbits accumulate pan instead of going static", () => {
  const plan = planner.buildShotPlan("T", "orbit London for 5 seconds, then orbit London for 5 seconds");
  const kf = planner.buildEspKeyframes(plan);
  const pans = kf.pan.map((k) => k.value);
  assert.equal(pans[pans.length - 1] - pans[pans.length - 2], 360); // second orbit adds its full sweep
});

test("earth-studio esp: orbit emits circular position samples around the target", () => {
  const plan = planner.buildShotPlan("T", "orbit Paris for 6 seconds");
  const seg = plan.segments[0];
  const kf = planner.buildEspKeyframes(plan);
  assert.ok(kf.lat.length >= 12, `expected circle samples, got ${kf.lat.length}`);
  const lats = kf.lat.map((k) => k.value);
  const lngs = kf.lng.map((k) => k.value);
  assert.ok(Math.max(...lats) > seg.location.latitude && Math.min(...lats) < seg.location.latitude, "orbit should pass both sides of the target latitude");
  assert.ok(Math.max(...lngs) > seg.location.longitude && Math.min(...lngs) < seg.location.longitude, "orbit should pass both sides of the target longitude");
});

test("earth-studio esp: long flights get a cinematic altitude arc; short hops do not", () => {
  const far = planner.buildShotPlan("T", "hover over Tokyo for 2 seconds, then fly to London in 4 seconds");
  const kfFar = planner.buildEspKeyframes(far);
  assert.ok(Math.max(...kfFar.alt.map((k) => k.value)) > 1000000, "intercontinental hop should arc high");
  const near = planner.buildShotPlan("T", "hover over Big Ben for 2 seconds, then fly to Tower Bridge in 3 seconds");
  const kfNear = planner.buildEspKeyframes(near);
  assert.ok(Math.max(...kfNear.alt.map((k) => k.value)) < 10000, "cross-town hop should stay low");
});

test("earth-studio esp: pan rides rotationX, tilt rides rotationY, and pan stays continuous across a hold", () => {
  const plan = planner.buildShotPlan("T", "fly to Paris in 3 seconds, then hover over Paris for 3 seconds, then orbit Paris for 6 seconds");
  const esp = planner.buildEsp(plan);
  const cam = esp.scenes[0].attributes.find((a) => a.type === "cameraGroup");
  const rot = cam.attributes.find((a) => a.type === "cameraRotationGroup");
  // Real Earth Studio semantics (reverse-engineered): rotationX = pan/heading,
  // rotationY = tilt (deg/180) — the opposite of the v0.4 guess.
  const tilt = rot.attributes.find((a) => a.type === "rotationY");
  assert.ok(tilt.keyframes.length >= 2, "tilt should animate between actions");
  assert.ok(tilt.keyframes.every((k) => k.value >= 0 && k.value <= 85 / 180), "tilt values must be deg/180");
  const pan = rot.attributes.find((a) => a.type === "rotationX");
  // anchor before the orbit: the pan change must not bleed back through
  // fly+hover (times are duration fractions in the real format)
  const orbitStartFraction = plan.segments[2].start_frame / plan.total_frames;
  assert.ok(pan.keyframes.some((k) => Math.abs(k.time - orbitStartFraction) < 1e-9), "missing pan anchor at orbit start");
  assert.equal(rot.attributes.find((a) => a.type === "rotationZ").keyframes, undefined); // static default
});

// ---- v0.4: aspect ratios (Shorts-first rendering) ----

test("earth-studio planner v0.4: aspect flows plan -> esp dimensions; validation accepts old plans", () => {
  const vertical = planner.buildShotPlan("T", "fly to Paris in 3 seconds", undefined, { aspect: "9:16" });
  assert.equal(vertical.aspect, "9:16");
  assert.deepEqual(vertical.render_dimensions, { width: 1080, height: 1920 });
  const esp = planner.buildEsp(vertical);
  assert.deepEqual(esp.settings.dimensions, { width: 1080, height: 1920 });
  assert.deepEqual(planner.validateShotPlanPayload(vertical), []);
  // default stays 16:9 (matches all pre-aspect artifacts)
  const defaultPlan = planner.buildShotPlan("T", "fly to Paris in 3 seconds");
  assert.equal(defaultPlan.aspect, "16:9");
  assert.equal(planner.buildEsp(defaultPlan).settings.dimensions.width, 1920);
  // plans predating v0.4 (no aspect field) still validate
  const old = JSON.parse(JSON.stringify(defaultPlan));
  delete old.aspect; delete old.render_dimensions;
  assert.deepEqual(planner.validateShotPlanPayload(old), []);
  const bad = JSON.parse(JSON.stringify(defaultPlan));
  bad.aspect = "4:3";
  assert.match(planner.validateShotPlanPayload(bad).join("\n"), /unknown aspect/);
});

test("earth-studio lane v0.4: writeJob stores the aspect and rejects unknown aspects", () => {
  const { root, pkg } = tmpPackage();
  const out = lane.writeJob(pkg, { jobName: "V", description: "fly to Paris in 3 seconds", aspect: "9:16" });
  assert.equal(out.aspect, "9:16");
  const job = lane.readJob(pkg);
  assert.equal(job.aspect, "9:16");
  assert.deepEqual(job.render_dimensions, { width: 1080, height: 1920 });
  const esp = JSON.parse(fs.readFileSync(path.join(lane.laneDir(pkg), "earth-studio.esp"), "utf8"));
  assert.deepEqual(esp.settings.dimensions, { width: 1080, height: 1920 });
  assert.throws(() => lane.writeJob(pkg, { jobName: "V", description: "fly to Paris in 3 seconds", aspect: "4:3" }), /unknown aspect/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("project-earth-studio.html v0.4: presets, place search, aspect selector, and ground-track map", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  assert.match(html, /data-preset/); // one-click preset moves
  assert.match(html, /es-loc-search/); // searchable gazetteer
  assert.match(html, /data-aspect/); // aspect selector chips
  assert.match(html, /9:16/); // Shorts-first default present
  assert.match(html, /pathSvg/); // camera ground-track preview
  assert.match(html, /LOCATION_ALIASES/); // aliases searchable too
  assert.match(html, /aspect:\s*ASPECT/); // aspect is sent to the plan route
});

// ---- v0.7 correctness pass (hover hold, orbit-scoped parsing, seam-safe lng) ----

test("earth-studio planner v0.7: hover holds the previous camera (altitude + tilt carry-over)", () => {
  const plan = planner.buildShotPlan("T", "fly to Paris at 600 meters, tilt 45 degrees, then hover for 4 seconds");
  assert.equal(plan.segments.length, 2); // ", tilt 45 degrees" merges into the fly segment
  const fly = plan.segments[0];
  const hover = plan.segments[1];
  assert.equal(fly.altitude_m, 600);
  assert.equal(fly.tilt_deg, 45);
  assert.equal(fly.tilt_source, "explicit");
  assert.equal(hover.action, "hover");
  assert.equal(hover.altitude_m, 600);
  assert.equal(hover.altitude_source, "carried_over");
  assert.equal(hover.tilt_deg, 45);
  assert.equal(hover.tilt_source, "carried_over");
  assert.match(plan.notes.join("\n"), /hover holds the previous camera/);
  // Engine: a true hold — no altitude or tilt keyframes during the hover.
  const tracks = planner.buildEspKeyframes(plan);
  assert.ok(tracks.alt.every((k) => k.time <= fly.end_frame), "no altitude movement during hover");
  assert.ok(tracks.tilt.every((k) => k.time <= fly.end_frame), "no tilt movement during hover");
  assert.equal(tracks.alt[tracks.alt.length - 1].value, 600);
});

test("earth-studio planner v0.7: explicit hover values beat carry-over; first-segment hover keeps defaults", () => {
  const hover = planner.buildShotPlan("T", "fly to Paris at 600m, then hover at 900m tilted 20 degrees for 3 seconds").segments[1];
  assert.equal(hover.altitude_m, 900);
  assert.equal(hover.altitude_source, "explicit");
  assert.equal(hover.tilt_deg, 20);
  assert.equal(hover.tilt_source, "explicit");
  const first = planner.buildShotPlan("T", "hover over Helsinki for 3 seconds").segments[0];
  assert.equal(first.altitude_m, planner.DEFAULT_ALTITUDE_M);
  assert.equal(first.altitude_source, "action_default");
  assert.equal(first.tilt_deg, planner.DEFAULT_TILT_DEG.hover);
  assert.equal(first.tilt_source, "action_default");
});

test("earth-studio planner v0.7: orbit vocabulary no longer corrupts non-orbit place names", () => {
  const hover = planner.parseDescription("hover over the French Quarter for 5 seconds").segments[0];
  assert.equal(hover.location_name, "the French Quarter"); // full name retained (honest unknown-fixture warning)
  const fly = planner.parseDescription("fly to the French Quarter").segments[0];
  assert.equal(fly.location_name, "the French Quarter");
  const bay = planner.parseDescription("hover over Half Moon Bay for 3 seconds").segments[0];
  assert.equal(bay.location_name, "Half Moon Bay");
  // Real orbit syntax keeps all its modifiers.
  const orbit = planner.parseDescription("orbit Paris twice counterclockwise for 20 seconds").segments[0];
  assert.equal(orbit.orbit_degrees, 720);
  assert.equal(orbit.orbit_direction, -1);
  const quarter = planner.parseDescription("circle Big Ben a quarter clockwise").segments[0];
  assert.equal(quarter.orbit_degrees, 90);
  assert.equal(quarter.orbit_direction, 1);
});

test("earth-studio planner v0.7: modifier-only comma fragments merge; location fragments stay segments", () => {
  const merged = planner.parseDescription("fly to Paris at 600 meters, tilt 45 degrees, then hover for 4 seconds");
  assert.equal(merged.segments.length, 2);
  assert.equal(merged.unresolved_items.length, 0);
  // A fragment with its own action is never merged.
  const kept = planner.parseDescription("fly to Paris, orbit Paris");
  assert.equal(kept.segments.length, 2);
  assert.equal(kept.segments[1].action, "orbit");
});

test("earth-studio planner v0.7: doubled duration phrases do not leak into the location", () => {
  const seg = planner.parseDescription("fly to Paris for 5 seconds for 3 seconds").segments[0];
  assert.equal(seg.location_name, "Paris");
  assert.equal(seg.duration_seconds, 5); // the first duration is the effective one
  assert.equal(seg.resolution_status, "resolved");
});

test("earth-studio esp v0.7: antimeridian flights take the short arc with an in-contract seam pair", () => {
  const plan = planner.buildShotPlan("T", "fly to Tokyo, then fly to Los Angeles in 12 seconds");
  const lng = planner.buildEspKeyframes(plan).lng;
  assert.ok(lng.every((k) => k.value >= -180 && k.value <= 180), "every exported longitude stays inside ±180");
  // The eastward crossing emits +180 / -180 on ADJACENT integer frames: the
  // same physical meridian, and no frame is ever rendered between them.
  const i = lng.findIndex((k) => k.value === 180);
  assert.ok(i >= 0, "crossing emits a +180 keyframe");
  assert.equal(lng[i + 1].value, -180);
  assert.equal(lng[i + 1].time, lng[i].time + 1);
  // Net sweep (seam jump contributes 0) = the short eastward Pacific route.
  let sweep = 0;
  for (let j = 1; j < lng.length; j += 1) {
    let d = lng[j].value - lng[j - 1].value;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    sweep += d;
  }
  assert.ok(sweep > 90 && sweep < 115, `expected ~+102° short-arc sweep, got ${sweep}`);
  // Exported .esp normalization contract intact (values in [0,1] against minValueRange).
  const esp = planner.buildEsp(plan);
  const lon = esp.scenes[0].attributes[0].attributes[0].attributes[0];
  assert.equal(lon.type, "longitude");
  assert.ok(lon.keyframes.every((k) => k.value >= 0 && k.value <= 1));
  // Non-crossing plans are unaffected: plain short-range longitudes, no seam keyframes.
  const london = planner.buildEspKeyframes(planner.buildShotPlan("T", "fly to London in 7 seconds, then orbit London for 10 seconds"));
  assert.ok(london.lng.every((k) => Math.abs(k.value) < 1));
});

test("earth-studio lane v0.7: mixed frame extensions render the majority set with an honest warning", () => {
  const { root, pkg } = tmpPackage();
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" });
  const framesDir = path.join(lane.laneDir(pkg), "frames");
  fs.writeFileSync(path.join(framesDir, "f1.jpeg"), "x");
  fs.writeFileSync(path.join(framesDir, "f2.jpeg"), "x");
  fs.writeFileSync(path.join(framesDir, "stray.png"), "x");
  lane.STATE.activeJob = null;
  const out = lane.startRender(pkg, "p", { spawn: () => fakeChild() });
  assert.match(out.frame_glob, /\*\.jpeg$/);
  assert.equal(out.rendered_frame_count, 2);
  assert.equal(out.frame_count, 3);
  assert.match(out.warnings.join("\n"), /mixes image types \(2 \.jpeg, 1 \.png\)/);
  lane.STATE.activeJob = null;
  fs.rmSync(root, { recursive: true, force: true });
});

test("earth-studio lane v0.7: in-place re-export (fresh file mtimes) is not stale; genuinely old exports are", () => {
  const { root, pkg } = tmpPackage();
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 3 seconds" }, { now: new Date(Date.now() - 60000).toISOString() });
  const framesDir = path.join(lane.laneDir(pkg), "frames");
  const frame = path.join(framesDir, "Frame_0000.jpeg");
  fs.writeFileSync(frame, "x");
  // Regenerate the plan NOW, then simulate an in-place re-export: overwriting
  // the same filenames leaves the DIR mtime old while the FILE mtime is new.
  lane.writeJob(pkg, { jobName: "J", description: "fly to Paris in 4 seconds" });
  const past = new Date(Date.now() - 3600000);
  const fresh = new Date(Date.now() + 5000);
  fs.utimesSync(framesDir, past, past);
  fs.utimesSync(frame, fresh, fresh);
  assert.equal(lane.status(pkg, "p").frames_stale, false, "in-place re-export must not read as stale");
  // Both the dir AND the files predate the plan -> genuinely stale.
  fs.utimesSync(frame, past, past);
  assert.equal(lane.status(pkg, "p").frames_stale, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("project-earth-studio.html v0.7: unsaved edits survive polling regardless of focus", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  assert.ok(!html.includes("document.activeElement===descEl"), "focus-only guard removed");
  assert.match(html, /descEl\.value !== \(ST\.job\?ST\.job\.description:''\)/);
  assert.match(html, /jobEl\.value !== \(ST\.job\?ST\.job\.jobName:''\)/);
  assert.match(html, /never the edited fields/);
});

// ---- v0.8 fly→orbit geometry (ring-entry lookahead, zero-slide boundary) ----

// Camera state at a frame from the emitted tracks (step-holds before the
// first keyframe, linear between keyframes) — test-side continuity probe.
function trackAt(track, frame) {
  let prev = null;
  for (const k of track) {
    if (k.time <= frame) prev = k;
    else return prev ? prev.value + (k.value - prev.value) * ((frame - prev.time) / (k.time - prev.time)) : k.value;
  }
  return prev ? prev.value : null;
}
function boundaryDelta(desc) {
  const plan = planner.buildShotPlan("T", desc);
  const segs = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
  const iOrbit = segs.findIndex((s) => s.action === "orbit");
  const orbit = segs[iOrbit];
  const mover = segs[iOrbit - 1];
  const tracks = planner.buildEspKeyframes(plan);
  const bf = orbit.start_frame;
  const pose = { latitude: trackAt(tracks.lat, bf), longitude: trackAt(tracks.lng, bf) };
  const center = { latitude: orbit.location.latitude, longitude: orbit.location.longitude };
  const radius = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  return {
    plan, mover, orbit, tracks,
    ringError: Math.abs(planner.haversineMeters(pose, center) - radius),
    radius,
    altAtBoundary: trackAt(tracks.alt, bf),
    tiltAtBoundary: trackAt(tracks.tilt, bf),
    panAtBoundary: trackAt(tracks.pan, bf),
  };
}

test("earth-studio v0.8: same-target fly→orbit lands ON the ring — cw, ccw, quarter, multi-rev", () => {
  for (const desc of [
    "fly to Paris, then orbit Paris clockwise",
    "fly to Paris, then orbit Paris counterclockwise",
    "fly to Paris, then orbit Paris a quarter",
    "fly to Paris, then orbit Paris 3 times",
  ]) {
    const d = boundaryDelta(desc);
    assert.ok(d.ringError < d.radius * 0.01, `${desc}: boundary sits ${Math.round(d.ringError)}m off the ${Math.round(d.radius)}m ring`);
    assert.equal(d.mover.ends_at_orbit_entry, d.orbit.segment_id, `${desc}: plan annotation present`);
  }
  const notes = planner.buildShotPlan("T", "fly to Paris, then orbit Paris").notes.join("\n");
  assert.match(notes, /orbit ring entry/);
});

test("earth-studio v0.8: aliases coordinate; different targets and hover predecessors do not", () => {
  const alias = planner.buildShotPlan("T", "fly to the Eiffel Tower, then orbit Eiffel Tower");
  assert.equal(alias.segments[0].ends_at_orbit_entry, alias.segments[1].segment_id);
  // Different targets: the fly keeps its own destination (target center).
  const diff = boundaryDelta("fly to Paris, then orbit London");
  assert.equal(diff.mover.ends_at_orbit_entry, undefined);
  const parisEnd = { latitude: trackAt(diff.tracks.lat, diff.mover.end_frame), longitude: trackAt(diff.tracks.lng, diff.mover.end_frame) };
  assert.ok(planner.haversineMeters(parisEnd, { latitude: 48.8566, longitude: 2.3522 }) < 1, "fly A still ends at A's center");
  // Hover predecessor: a hold is never rewritten onto the ring.
  const hov = planner.buildShotPlan("T", "hover over Paris for 2 seconds, then orbit Paris");
  assert.equal(hov.segments[0].ends_at_orbit_entry, undefined);
  assert.ok(hov.segments.every((s) => s.resolution_status === "resolved"));
});

test("earth-studio v0.8: explicit orbit altitude/tilt define the ring the fly lands on", () => {
  const d = boundaryDelta("fly to Paris, then orbit Paris at 1000m tilted 30 degrees");
  assert.ok(Math.abs(d.radius - planner.orbitRadiusMeters(1000, 30)) < 1);
  assert.ok(d.ringError < d.radius * 0.01, `boundary ${Math.round(d.ringError)}m off a ${Math.round(d.radius)}m ring`);
  // The fly's own explicit altitude stays respected on its plan segment.
  const plan = planner.buildShotPlan("T", "fly to Paris at 1500m, then orbit Paris");
  assert.equal(plan.segments[0].altitude_m, 1500);
  assert.equal(plan.segments[0].altitude_source, "explicit");
  assert.equal(plan.segments[0].ends_at_orbit_entry, plan.segments[1].segment_id);
});

test("earth-studio v0.8: zoom→orbit coordinates like fly→orbit", () => {
  const d = boundaryDelta("zoom in on Eiffel Tower, then orbit Eiffel Tower");
  assert.equal(d.mover.ends_at_orbit_entry, d.orbit.segment_id);
  assert.ok(d.ringError < d.radius * 0.01);
});

test("earth-studio v0.8: fly→orbit→hover holds the ring pose; fly→orbit→fly resumes normal targeting", () => {
  // hover after orbit: NO position/altitude/tilt keyframes during the hover —
  // the camera stays exactly where the orbit ended (on the ring).
  const a = planner.buildShotPlan("T", "fly to Paris, then orbit Paris, then hover for 3 seconds");
  const ta = planner.buildEspKeyframes(a);
  const orbitEnd = a.segments[1].end_frame;
  ["lat", "lng", "alt", "tilt", "pan"].forEach((k) => {
    assert.equal(ta[k].filter((x) => x.time > orbitEnd).length, 0, `${k} moves during post-orbit hover`);
  });
  assert.equal(a.segments[2].holds_camera, true);
  // explicit hover altitude still transitions while the position holds
  const b = planner.buildShotPlan("T", "fly to Paris, then orbit Paris, then hover at 5000m for 3 seconds");
  const tb = planner.buildEspKeyframes(b);
  assert.equal(tb.lat.filter((x) => x.time > orbitEnd).length, 0);
  assert.ok(tb.alt.filter((x) => x.time > orbitEnd).length > 0);
  assert.equal(tb.alt[tb.alt.length - 1].value, 5000);
  // fly after orbit: targets its own location normally (no stale ring semantics)
  const c = planner.buildShotPlan("T", "fly to Paris, then orbit Paris, then fly to London");
  const tc = planner.buildEspKeyframes(c);
  const final = { latitude: tc.lat[tc.lat.length - 1].value, longitude: tc.lng[tc.lng.length - 1].value };
  assert.ok(planner.haversineMeters(final, { latitude: 51.5074, longitude: -0.1278 }) < 1);
});

test("earth-studio v0.8: orbit-only and orbit→orbit behavior unchanged; boundary alt/tilt/pan continuous", () => {
  // first-segment orbit still starts on the ring facing the target
  const solo = planner.buildEspKeyframes(planner.buildShotPlan("T", "orbit Tokyo"));
  assert.ok(solo.lat.length >= 12);
  assert.equal(solo.pan[0].value, 180);
  // consecutive orbits still accumulate pan
  const twin = planner.buildEspKeyframes(planner.buildShotPlan("T", "fly to Paris, then orbit Paris, then orbit Paris"));
  const panEnd = twin.pan[twin.pan.length - 1].value;
  assert.equal(panEnd, 720);
  // boundary continuity of the other camera properties: fly terminal == orbit initial
  const d = boundaryDelta("fly to Paris, then orbit Paris");
  const justBefore = { alt: trackAt(d.tracks.alt, d.orbit.start_frame - 1), tilt: trackAt(d.tracks.tilt, d.orbit.start_frame - 1), pan: trackAt(d.tracks.pan, d.orbit.start_frame - 1) };
  assert.ok(Math.abs(d.altAtBoundary - justBefore.alt) < d.altAtBoundary * 0.02, "no altitude snap at the boundary");
  assert.ok(Math.abs(d.tiltAtBoundary - justBefore.tilt) < 1.5, "no tilt snap at the boundary");
  assert.ok(Math.abs(d.panAtBoundary - justBefore.pan) < 1.5, "no pan snap at the boundary");
});

test("earth-studio v0.8: emitted .esp preserves the continuous fly→orbit boundary", () => {
  const plan = planner.buildShotPlan("T", "fly to Eiffel Tower, then orbit Eiffel Tower clockwise", "2026-08-08T00:00:00.000Z");
  const esp = planner.buildEsp(plan);
  const pos = esp.scenes[0].attributes[0].attributes.find((a) => a.type === "cameraPositionGroup").attributes;
  const lat = pos.find((a) => a.type === "latitude");
  const lng = pos.find((a) => a.type === "longitude");
  const denorm = (k, min, span) => min + k.value * span;
  const latMin = lat.value.minValueRange; const lngMin = lng.value.minValueRange;
  const total = plan.total_frames;
  const bf = plan.segments[1].start_frame / total;
  // reconstruct real coordinates around the boundary from the .esp itself
  const points = lat.keyframes.map((k, i) => ({
    t: k.time,
    latitude: denorm(k, latMin, 90 - latMin),
    longitude: denorm(lng.keyframes[i], lngMin, 180 - lngMin),
  }));
  const before = points.filter((p) => p.t <= bf + 1e-9).pop();
  const after = points.find((p) => p.t > bf + 1e-9);
  const center = { latitude: 48.8584, longitude: 2.2945 };
  const radius = planner.orbitRadiusMeters(plan.segments[1].altitude_m, plan.segments[1].tilt_deg);
  // the .esp keyframe AT the boundary sits on the ring; the next .esp keyframe
  // is an orbit sample one ~30° step along the SAME ring — no radius-sized jump
  assert.ok(Math.abs(planner.haversineMeters(before, center) - radius) < radius * 0.01,
    ".esp boundary keyframe sits on the ring");
  const step = planner.haversineMeters(before, after);
  assert.ok(step < radius * 0.6, `.esp first orbit step is a smooth arc chord (${Math.round(step)}m on a ${Math.round(radius)}m ring)`);
});
