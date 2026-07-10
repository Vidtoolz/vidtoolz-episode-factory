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

test("project-earth-studio.html wires a Cancel render control to the cancel route, shown only while rendering", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  // Button is rendered only when a render is active.
  assert.match(html, /renderJob\.active\?'<button[^>]*id="es-cancel"/);
  // Handler is wired and posts to the cancel route.
  assert.match(html, /es-cancel'\);\s*if\s*\(cbtnEl\)\s*cbtnEl\.onclick\s*=\s*cancelRender/);
  assert.match(html, /async function cancelRender[\s\S]*?\/api\/earth-studio\/cancel/);
});
