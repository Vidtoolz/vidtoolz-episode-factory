// Earth Studio SUPER FOCUS one-shot (2026-09-04).
// Mandatory regression: Mikko's exact instruction must become a three-stop
// journey with the stated durations, a valid Earth Studio project, a durable
// backend job with honest progress/ETA, a disabled Play button until the MP4
// exists, and a reload-safe lifecycle. Fake ffmpeg, temp package dirs, fake
// clock — no real renders, no VIDNAS, no network.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const director = require("../earth-studio-director.js");
const journeyModel = require("../earth-studio-journey.js");
const lane = require("../earth-studio-lane.js");
const sf = require("../earth-studio-super-focus.js");

// The instruction from the mission brief — verbatim, never simplified.
const INSTRUCTION = "start in korkeasaari, Helsinki. circle there for 3 minutes. then move to linnanmäki, helsinki, circle there for 3 minutes. then move to jätkänsaari, Helsinki. circle there for 4 seconds.";

function tmpPackage(id = "es-sf-project") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-sf-"));
  const scriptPackages = path.join(root, "aigen", "script-packages");
  const pkg = path.join(scriptPackages, id);
  fs.mkdirSync(pkg, { recursive: true });
  return { root, aigenRoot: path.join(root, "aigen"), scriptPackages, packageId: id, pkg };
}
function fakeChild() {
  const h = {}; const se = {};
  return {
    pid: 71, stdout: { on: () => {} }, stderr: { on: (e, cb) => { se[e] = cb; } }, on: (e, cb) => { h[e] = cb; }, kill: () => {},
    _stderr: (text) => se.data && se.data(text), _close: (code) => h.close && h.close(code),
  };
}
function clock(startIso = "2026-09-04T10:00:00.000Z") {
  let t = Date.parse(startIso);
  return { now: () => new Date(t).toISOString(), advance: (sec) => { t += sec * 1000; } };
}
function writeFrames(pkg, count, ext = "png") {
  const dir = path.join(pkg, "earth-studio", "frames"); fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i += 1) fs.writeFileSync(path.join(dir, `frame_${String(i).padStart(4, "0")}.${ext}`), "x");
}
function opts(clk, extra = {}) { return Object.assign({ synchronous: true, noTimers: true, now: clk.now, stableMs: 30000 }, extra); }

// ── 1. Instruction → journey (Director + gazetteer) ──────────────────────────
test("super focus: the exact instruction yields Korkeasaari → Linnanmäki → Jätkäsaari with 180/180/4 s orbits and auto travel", () => {
  const intent = director.parseIntent(INSTRUCTION);
  assert.deepEqual(intent.stops.map((s) => s.location), ["Korkeasaari", "Linnanmäki", "Jätkäsaari"], "three stops in the stated order; ', Helsinki' is a qualifier, not a stop");
  assert.deepEqual(intent.stops.map((s) => s.duration_seconds), [180, 180, 4]);
  assert.ok(intent.stops.every((s) => s.explicit_grammar === "slow_orbit"), "'circle there' = orbit");
  const directed = director.autoDirect({ ...intent, aspect: "16:9" });
  const check = journeyModel.validateJourney(directed.journey, { planner });
  assert.equal(check.ok, true, (check.errors || []).join("\n"));
  const timeline = directed.summary.timeline;
  const stops = timeline.filter((e) => e.kind === "stop");
  const travels = timeline.filter((e) => e.kind !== "stop");
  assert.equal(stops.length, 3);
  assert.equal(travels.length, 2, "two automatically inserted travel transitions");
  const orbitSeconds = stops.map((s) => s.movements.reduce((a, m) => a + m.seconds, 0));
  assert.ok(Math.abs(orbitSeconds[0] - 180) < 0.01 && Math.abs(orbitSeconds[1] - 180) < 0.01 && Math.abs(orbitSeconds[2] - 4) < 0.01, `orbit seconds ${orbitSeconds}`);
  assert.ok(travels.every((t) => t.steps.every((m) => m.seconds > 0)), "travel legs have auto-derived positive durations");
  assert.ok(check.compiled.total_duration_seconds >= 364 && check.compiled.total_duration_seconds <= 420, `total ${check.compiled.total_duration_seconds}`);
  assert.match(check.compiled.description, /orbit Korkeasaari .*180 seconds.*fly to Linnanmäki.*orbit Linnanmäki .*180 seconds.*fly to Jätkäsaari.*orbit Jätkäsaari .*4 seconds/);
  // the durations are the user's, not the Director's pacing table
  const beatSeconds = directed.plan.beats.map((b) => b.duration_seconds);
  assert.equal(beatSeconds.length, 5, "orbit, travel, orbit, travel, orbit");
  assert.equal(beatSeconds[0], 180); assert.equal(beatSeconds[2], 180); assert.equal(beatSeconds[4], 4);
  assert.ok(beatSeconds[1] > 0 && beatSeconds[3] > 0);
});

test("super focus gazetteer: the three Helsinki places resolve with and without the ', Helsinki' qualifier and via Mikko's spelling", () => {
  assert.equal(planner.resolveLocation("korkeasaari, Helsinki").name, "Korkeasaari");
  assert.equal(planner.resolveLocation("linnanmäki").name, "Linnanmäki");
  assert.equal(planner.resolveLocation("jätkänsaari, Helsinki").name, "Jätkäsaari");
  assert.equal(planner.resolveLocation("Jätkäsaari").name, "Jätkäsaari");
  assert.equal(planner.resolveLocation("Helsinki Zoo").name, "Korkeasaari");
  assert.equal(planner.resolveLocation("Paris, Helsinki"), null, "a qualifier 1 900 km away is not accepted");
  const k = planner.resolveLocation("Korkeasaari");
  assert.ok(Math.abs(k.latitude - 60.1755) < 0.01 && Math.abs(k.longitude - 24.9856) < 0.01);
});

test("super focus director: existing phrasings are unchanged — no durations unless stated, qualifiers only collapse when they are a city of the place", () => {
  const a = director.parseIntent("Start in Helsinki. Show where Stockholm is relative to Helsinki. Stockholm is the main destination.");
  assert.deepEqual(a.stops.map((s) => s.location), ["Helsinki", "Stockholm"]);
  assert.ok(a.stops.every((s) => s.duration_seconds == null));
  const b = director.parseIntent("Show the terrain of Matterhorn.");
  assert.deepEqual(b.stops.map((s) => s.location), ["Matterhorn"]);
  const c = director.parseIntent("hover over Helsinki Zoo for 10 seconds, then fly to Paris.");
  assert.deepEqual(c.stops.map((s) => [s.location, s.duration_seconds || null]), [["Korkeasaari", 10], ["Paris", null]]);
  // a separate sentence naming a city is a real stop, not a qualifier
  const d = director.parseIntent("Orbit Korkeasaari for 30 seconds. Then show Helsinki.");
  assert.deepEqual(d.stops.map((s) => s.location), ["Korkeasaari", "Helsinki"]);
  // minutes and decimals
  const e = director.parseIntent("circle Paris for 1.5 minutes");
  assert.equal(e.stops[0].duration_seconds, 90);
});

// ── 2. Job authority lifecycle ───────────────────────────────────────────────
test("super focus job: create → PLANNING → VALIDATING → GENERATING_PROJECT → WAITING with a real .esp, honest progress and no fake ETA", () => {
  const fx = tmpPackage(); const clk = clock();
  try {
    const job = sf.createJob(fx.pkg, fx.packageId, { instruction: INSTRUCTION }, opts(clk));
    const saved = sf.readJob(fx.pkg);
    assert.equal(saved.job_id, job.job_id);
    assert.equal(saved.status, "WAITING_FOR_EARTH_STUDIO_EXPORT");
    assert.equal(saved.instruction, INSTRUCTION, "the instruction is stored verbatim");
    ["PLANNING", "VALIDATING", "GENERATING_PROJECT"].forEach((n) => { const s = saved.stages.find((x) => x.name === n); assert.ok(s.started_at && s.completed_at, `${n} recorded`); });
    assert.ok(fs.existsSync(path.join(fx.pkg, "earth-studio", "earth-studio.esp")), "Earth Studio project written by the canonical lane");
    assert.ok(fs.existsSync(path.join(fx.pkg, "earth-studio", "journey.json")));
    assert.ok(fs.existsSync(sf.jobPath(fx.pkg)), "durable job file");
    assert.deepEqual(saved.parsed.stops.map((s) => s.location), ["Korkeasaari", "Linnanmäki", "Jätkäsaari"]);
    assert.deepEqual(saved.parsed.stops.map((s) => s.explicit_duration_seconds), [180, 180, 4]);
    assert.equal(saved.parsed.sequence.filter((e) => e.kind === "travel").length, 2);
    const laneJob = lane.readJob(fx.pkg);
    assert.equal(saved.progress.frames_total, laneJob.total_frames);
    assert.ok(saved.progress.frames_total > 10000, `375 s × 30 fps → ${saved.progress.frames_total} frames`);
    assert.equal(saved.progress.frames_exported, 0);
    assert.equal(saved.eta.seconds_remaining, null, "no ETA is invented before frames start arriving");
    assert.equal(saved.eta.basis, "waiting_for_manual_export");
    assert.equal(saved.result, null, "no playable result yet → Play stays disabled");
    assert.equal(saved.project.earth_studio_url, "https://earth.google.com/studio/");
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("super focus job: frames arriving drive real progress + a measured ETA; a complete export starts the render automatically; ffmpeg progress + completion → READY with the MP4 URL", () => {
  const fx = tmpPackage(); const clk = clock();
  const children = [];
  const o = opts(clk, { spawn: (bin, args) => { const c = fakeChild(); c.args = args; children.push(c); return c; } });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: "orbit Helsinki for 2 seconds then fly to Espoo for 2 seconds" }, o);
    let job = sf.readJob(fx.pkg);
    const total = job.progress.frames_total; assert.ok(total >= 60 && total <= 600, `small canary: ${total} frames`);
    // half the frames arrive over 20 s
    sf.tick(fx.pkg, fx.packageId, o);                 // sample 0 frames
    clk.advance(10); writeFrames(fx.pkg, Math.floor(total / 4)); sf.tick(fx.pkg, fx.packageId, o);
    clk.advance(10); writeFrames(fx.pkg, Math.floor(total / 2)); job = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(job.status, "WAITING_FOR_EARTH_STUDIO_EXPORT");
    assert.equal(job.progress.frames_exported, Math.floor(total / 2));
    assert.ok(job.progress.percent >= 45 && job.progress.percent <= 55, `percent ${job.progress.percent}`);
    assert.equal(job.eta.basis, "observed_earth_studio_export_rate");
    assert.equal(job.eta.confidence, "measured");
    const rate = Math.floor(total / 2) / 20; // frames per second observed
    const expectedExport = (total - Math.floor(total / 2)) / rate;
    assert.ok(Math.abs(job.eta.seconds_remaining - (expectedExport + total * sf.DEFAULT_RENDER_SECONDS_PER_FRAME)) < 2, `eta ${job.eta.seconds_remaining} vs ${expectedExport}`);
    assert.ok(Array.isArray(job.eta.range_seconds) && job.eta.range_seconds[0] <= job.eta.seconds_remaining && job.eta.range_seconds[1] >= job.eta.seconds_remaining);
    assert.equal(children.length, 0, "render must not start before the export is complete");
    // export completes → render starts without a button
    clk.advance(10); writeFrames(fx.pkg, total); job = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(job.status, "RENDERING");
    assert.equal(children.length, 1, "ffmpeg spawned exactly once");
    assert.ok(children[0].args.includes("libx264") && children[0].args.some((a) => /frames/.test(a)));
    assert.equal(job.eta.basis, "default_render_rate", "first render in this package → conservative default rate, labelled as such");
    // ffmpeg reports progress on stderr
    children[0]._stderr(`frame=   ${Math.floor(total / 2)} fps=30 q=28.0 size=  256kB time=00:00:01.00 bitrate=2097.2kbits/s speed=1x\r`);
    clk.advance(2); job = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(job.status, "RENDERING");
    assert.equal(job.progress.frames_rendered, Math.floor(total / 2));
    assert.ok(job.progress.percent >= 45 && job.progress.percent <= 55);
    // ffmpeg finishes and the file exists → FINALIZING → READY
    const out = lane.renderPath(fx.pkg); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.alloc(4096, 1));
    children[0]._close(0);
    clk.advance(3); job = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(job.status, "READY");
    assert.equal(job.stage, "READY");
    assert.equal(job.progress.percent, 100);
    assert.equal(job.result.mp4, path.relative(fx.pkg, out));
    assert.equal(job.result.url, `/aigen-assets/script-packages/${fx.packageId}/${path.relative(fx.pkg, out)}`, "Play uses the same static asset route the expert page uses");
    assert.equal(job.result.bytes, 4096);
    assert.equal(job.eta.seconds_remaining, 0);
    // measured render rate is recorded for the next ETA
    const timing = sf.readTiming(fx.pkg);
    assert.ok(timing.render_seconds_per_frame > 0 && timing.render_frames === total);
    // every stage has a recorded duration
    const named = Object.fromEntries(job.stages.map((s) => [s.name, s]));
    ["PLANNING", "VALIDATING", "GENERATING_PROJECT", "WAITING_FOR_EARTH_STUDIO_EXPORT", "RENDERING", "FINALIZING"].forEach((n) => assert.ok(named[n].completed_at && named[n].seconds != null, `${n} timed`));
    assert.ok(named.WAITING_FOR_EARTH_STUDIO_EXPORT.seconds >= 30);
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("super focus job: an export that stops changing for 30 s renders with the frames that exist and says so", () => {
  const fx = tmpPackage(); const clk = clock();
  const child = fakeChild(); const o = opts(clk, { spawn: () => child });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: "orbit Helsinki for 2 seconds" }, o);
    const total = sf.readJob(fx.pkg).progress.frames_total;
    writeFrames(fx.pkg, total - 3);
    sf.tick(fx.pkg, fx.packageId, o); clk.advance(15); sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(sf.readJob(fx.pkg).status, "WAITING_FOR_EARTH_STUDIO_EXPORT");
    clk.advance(16); const job = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(job.status, "RENDERING");
    assert.match(job.stages.find((s) => s.name === "WAITING_FOR_EARTH_STUDIO_EXPORT").note, /render started with \d+ of \d+ planned frames/);
    assert.ok(job.render.warnings.some((w) => /differs from the plan/.test(w)), "lane's frame-count warning is carried into the job");
    child._close(0); // release the lane's single in-memory render slot
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("super focus job: failures are classified with a cause and Retry resumes from the right stage", () => {
  const fx = tmpPackage(); const clk = clock();
  try {
    // unknown place → FAILED at PLANNING with a human cause
    sf.createJob(fx.pkg, fx.packageId, { instruction: "circle around nowhereville for 2 minutes" }, opts(clk));
    let job = sf.readJob(fx.pkg);
    assert.equal(job.status, "FAILED");
    assert.equal(job.error.cause, "Could not resolve location");
    assert.equal(job.error.failed_stage, "PLANNING");
    assert.equal(job.eta.basis, "failed");
    // retry of a job with no project re-runs the pipeline (same instruction → same honest failure)
    job = sf.retry(fx.pkg, fx.packageId, opts(clk));
    assert.equal(sf.readJob(fx.pkg).status, "FAILED");
    // a new instruction replaces a terminal job
    sf.createJob(fx.pkg, fx.packageId, { instruction: "orbit Helsinki for 2 seconds" }, opts(clk));
    job = sf.readJob(fx.pkg); assert.equal(job.status, "WAITING_FOR_EARTH_STUDIO_EXPORT");
    // render failure → FAILED with ffmpeg's stderr; retry resumes at the export boundary, keeping the project
    const child = fakeChild(); const o = opts(clk, { spawn: () => child });
    writeFrames(fx.pkg, job.progress.frames_total);
    job = sf.tick(fx.pkg, fx.packageId, o); assert.equal(job.status, "RENDERING");
    child._stderr("frames/frame_0000.png: Invalid data found when processing input\n"); child._close(1);
    job = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(job.status, "FAILED");
    assert.equal(job.error.cause, "Render failed");
    assert.match(job.error.detail, /Invalid data/);
    assert.equal(job.error.failed_stage, "RENDERING");
    const espBefore = fs.readFileSync(path.join(fx.pkg, "earth-studio", "earth-studio.esp"), "utf8");
    job = sf.retry(fx.pkg, fx.packageId, opts(clk));
    assert.equal(job.status, "WAITING_FOR_EARTH_STUDIO_EXPORT", "project exists → resume from the export/render boundary");
    assert.equal(job.error, null);
    assert.equal(fs.readFileSync(path.join(fx.pkg, "earth-studio", "earth-studio.esp"), "utf8"), espBefore, "retry does not re-plan a valid project");
    // a running job refuses a second create (409) and a retry (409)
    assert.throws(() => sf.createJob(fx.pkg, fx.packageId, { instruction: "orbit Paris for 2 seconds" }, opts(clk)), (e) => e.statusCode === 409);
    assert.throws(() => sf.retry(fx.pkg, fx.packageId, opts(clk)), (e) => e.statusCode === 409);
    assert.throws(() => sf.createJob(fx.pkg, fx.packageId, { instruction: "   " }, opts(clk)), (e) => e.statusCode === 400);
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("super focus job: status() on a fresh process re-attaches the watcher (reload/restart resume); a job interrupted mid-planning fails honestly", () => {
  const fx = tmpPackage(); const clk = clock();
  const timers = [];
  const o = { synchronous: true, now: clk.now, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; }, clearTimeout: () => {}, spawn: () => fakeChild() };
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: "orbit Helsinki for 2 seconds" }, o);
    assert.equal(timers.length, 1, "watcher scheduled after the project was written");
    assert.equal(timers[0].ms, sf.DEFAULT_POLL_MS);
    // simulate a server restart: forget the in-memory runner
    sf.stopWatcher(fx.pkg); timers.length = 0;
    const st = sf.status(fx.pkg, fx.packageId, o);
    assert.equal(st.has_job, true);
    assert.equal(st.job.status, "WAITING_FOR_EARTH_STUDIO_EXPORT");
    assert.equal(timers.length, 1, "status re-armed the watcher");
    assert.ok(Array.isArray(st.stages) && st.stages.length === 8);
    assert.equal(st.frames.total, st.job.progress.frames_total);
    // the watcher loop itself observes and reschedules
    writeFrames(fx.pkg, 5); timers[0].fn();
    assert.equal(sf.readJob(fx.pkg).progress.frames_exported, 5);
    assert.equal(timers.length, 2, "rescheduled");
    sf.stopWatcher(fx.pkg);
    // interrupted before the project existed → FAILED with Retry available
    const job = sf.readJob(fx.pkg); job.status = "PLANNING"; job.stage = "PLANNING"; job.parsed = null; fs.writeFileSync(sf.jobPath(fx.pkg), JSON.stringify(job));
    const st2 = sf.status(fx.pkg, fx.packageId, o);
    assert.equal(st2.job.status, "FAILED");
    assert.equal(st2.job.error.cause, "Generation interrupted");
    assert.equal(sf.status(fx.pkg, fx.packageId, o).has_job, true);
    const empty = tmpPackage("es-sf-empty");
    try { assert.equal(sf.status(empty.pkg, empty.packageId, o).has_job, false); } finally { fs.rmSync(empty.root, { recursive: true, force: true }); }
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// ── 3. HTTP routes ───────────────────────────────────────────────────────────
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("super focus API: create is nonce-gated, returns 202 immediately, the pipeline runs off-request, status is durable, duplicate create → 409, retry on a running job → 409", async () => {
  const fx = tmpPackage();
  const prev = { r: process.env.AIGEN_VIDNAS_ROOT, s: process.env.AIGEN_SCRIPT_PACKAGES };
  process.env.AIGEN_VIDNAS_ROOT = fx.aigenRoot; process.env.AIGEN_SCRIPT_PACKAGES = fx.scriptPackages;
  const server = packageEngineServer.createServer({ earthStudio: { spawn: () => fakeChild(), noTimers: true } });
  const nonceHeaders = { host: "127.0.0.1:8010", [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() };
  try {
    await listen(server);
    const empty = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_STATUS_API}?id=${fx.packageId}`);
    assert.equal(empty.statusCode, 200); assert.equal(empty.body.data.has_job, false);
    const noNonce = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_CREATE_API, { method: "POST", body: { id: fx.packageId, instruction: INSTRUCTION }, headers: { host: "127.0.0.1:8010" } });
    assert.equal(noNonce.statusCode, 403);
    const t0 = Date.now();
    const created = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_CREATE_API, { method: "POST", body: { id: fx.packageId, instruction: INSTRUCTION }, headers: nonceHeaders });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.data.job.status, "QUEUED", "the HTTP reply does not wait for planning");
    assert.ok(Date.now() - t0 < 2000);
    // the pipeline finishes off-request within a moment
    let st = null;
    for (let i = 0; i < 100; i += 1) { st = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_STATUS_API}?id=${fx.packageId}`); if (!["QUEUED", "PLANNING", "VALIDATING", "GENERATING_PROJECT"].includes(st.body.data.job.status)) break; await sleep(20); }
    assert.equal(st.body.data.job.status, "WAITING_FOR_EARTH_STUDIO_EXPORT");
    assert.deepEqual(st.body.data.job.parsed.stops.map((s) => s.explicit_duration_seconds), [180, 180, 4]);
    assert.equal(st.body.data.job.result, null);
    assert.equal(st.body.data.esp_path, path.join(fx.pkg, "earth-studio", "earth-studio.esp"));
    const dup = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_CREATE_API, { method: "POST", body: { id: fx.packageId, instruction: "orbit Paris for 2 seconds" }, headers: nonceHeaders });
    assert.equal(dup.statusCode, 409); assert.equal(dup.body.job.status, "WAITING_FOR_EARTH_STUDIO_EXPORT");
    const retry = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_RETRY_API, { method: "POST", body: { id: fx.packageId }, headers: nonceHeaders });
    assert.equal(retry.statusCode, 409);
    const trav = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_STATUS_API}?id=${encodeURIComponent("../../etc")}`);
    assert.equal(trav.statusCode, 400);
    const missing = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_CREATE_API, { method: "POST", body: { id: fx.packageId, instruction: "" }, headers: nonceHeaders });
    assert.equal(missing.statusCode, 400);
  } finally {
    sf.stopWatcher(fx.pkg);
    await close(server);
    if (prev.r === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = prev.r;
    if (prev.s === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.s;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

// ── 4. UI surface (static contract; the headless-Chrome smoke proves the DOM) ─
test("super focus UI: the page exposes instruction + Create + Play only — no Director role/purpose/treatment/movement controls; the expert page links to it", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "earth-studio-super-focus.html"), "utf8");
  ["data-sf=\"instruction\"", "data-sf=\"create\"", "data-sf=\"play\"", "data-sf=\"eta\"", "data-sf=\"status\"", "data-sf=\"retry\""].forEach((m) => assert.ok(page.includes(m), m));
  assert.match(page, /Create map animation/);
  ["dirPurposeCards", "dirRoleCards", "Recommended camera treatment", "jb-mode", "data-role=", "data-purpose=", "es-movement", "camera treatment</label", "id=\"dir-"].forEach((forbidden) => assert.ok(!page.includes(forbidden), `super focus page must not carry ${forbidden}`));
  assert.ok(!/<select[^>]*(role|purpose|treatment|movement|grammar)/i.test(page), "no role/purpose/treatment/movement selects");
  assert.ok(page.includes("/api/earth-studio/super-focus/status") && page.includes("/api/earth-studio/super-focus/create") && page.includes("/api/earth-studio/super-focus/retry"));
  const expert = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  assert.ok(expert.includes("earth-studio-super-focus.html"), "expert workspace links to Super Focus");
  assert.ok(expert.includes("dirPurposeCards"), "expert/normal mode keeps its Director controls");
});
