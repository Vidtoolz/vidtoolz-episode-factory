// Earth Studio SUPER FOCUS one-shot (2026-09-04, terminal repair).
// Mandatory regression: Mikko's exact instruction must become a three-stop
// journey with the stated durations, a valid Earth Studio project, a durable
// crash-safe backend job, honest progress/ETA, a job-scoped frame manifest that
// rejects every stale/gapped/mixed/stalled/corrupt case, ffprobe-validated
// READY, idempotent restart ownership and one active job per project.
// The Earth Studio export is faked (tests/_earth-studio-fake-export.js) with
// the REAL native naming convention; ffmpeg and ffprobe are real.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const childProcess = require("node:child_process");
const planner = require("../earth-studio-job-planner.js");
const director = require("../earth-studio-director.js");
const journeyModel = require("../earth-studio-journey.js");
const lane = require("../earth-studio-lane.js");
const manifestModel = require("../earth-studio-frame-manifest.js");
const sf = require("../earth-studio-super-focus.js");
const { fakeExportRunner, writeJpegFrames } = require("./_earth-studio-fake-export.js");

// The instruction from the mission brief — verbatim, never simplified.
const INSTRUCTION = "start in korkeasaari, Helsinki. circle there for 3 minutes. then move to linnanmäki, helsinki, circle there for 3 minutes. then move to jätkänsaari, Helsinki. circle there for 4 seconds.";
const SHORT = "orbit Helsinki for 2 seconds"; // 60 frames → Earth Studio renders 0..60 = 61 files

function tmpPackage(id = "es-sf-project") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-sf-"));
  const scriptPackages = path.join(root, "aigen", "script-packages");
  const pkg = path.join(scriptPackages, id);
  fs.mkdirSync(pkg, { recursive: true });
  return { root, aigenRoot: path.join(root, "aigen"), scriptPackages, packageId: id, pkg };
}
function clock(startIso = "2026-09-04T10:00:00.000Z") { let t = Date.parse(startIso); return { now: () => new Date(t).toISOString(), advance: (sec) => { t += sec * 1000; } }; }
function opts(clk, extra = {}) { return Object.assign({ synchronous: true, noTimers: true, now: clk.now }, extra); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settleExport(pkg) { const rec = sf._internals.ACTIVE_EXPORTS.get(pkg); if (rec) await rec.promise.catch(() => {}); await sleep(20); }
async function runToTerminal(pkg, id, o, maxMs = 30000) {
  const t0 = Date.now(); let job = sf.readJob(pkg);
  while (!sf.TERMINAL.has(job.status) && !sf.BLOCKED.has(job.status) && Date.now() - t0 < maxMs) { await settleExport(pkg); job = sf.tick(pkg, id, o) || sf.readJob(pkg); if (job.status === "RENDERING") await sleep(60); }
  return job;
}
// a runner that lets a test write whatever it wants into the job's frame dir
function manualRunner(write) {
  return async (params) => {
    const emit = (evt) => params.onEvent && params.onEvent({ at: new Date().toISOString(), ...evt });
    emit({ type: "importing" }); emit({ type: "imported", project: { duration: params.expected.last } });
    emit({ type: "export_started", render_name: "earth-studio", first: params.expected.first, last: params.expected.last, expected_count: params.expected.count });
    const files = write(params.framesDir, params.expected) || 0;
    emit({ type: "export_finished", files });
    return { ok: true, files, bytes: 0, elapsed_s: 0.1, gl: "manual" };
  };
}
function fakeChild() {
  const h = {}; const se = {};
  return { pid: 71, stdout: { on: () => {} }, stderr: { on: (e, cb) => { se[e] = cb; } }, on: (e, cb) => { h[e] = cb; }, kill: () => {}, _stderr: (t) => se.data && se.data(t), _close: (c) => h.close && h.close(c) };
}

// ── 1. Instruction → journey (Director + gazetteer) ──────────────────────────
test("super focus: the exact instruction yields Korkeasaari → Linnanmäki → Jätkäsaari with 180/180/4 s orbits and auto travel (375 s, 11 250 frames)", () => {
  const intent = director.parseIntent(INSTRUCTION);
  assert.deepEqual(intent.stops.map((s) => s.location), ["Korkeasaari", "Linnanmäki", "Jätkäsaari"]);
  assert.deepEqual(intent.stops.map((s) => s.duration_seconds), [180, 180, 4]);
  assert.ok(intent.stops.every((s) => s.explicit_grammar === "slow_orbit"));
  const directed = director.autoDirect({ ...intent, aspect: "16:9" });
  const check = journeyModel.validateJourney(directed.journey, { planner });
  assert.equal(check.ok, true, (check.errors || []).join("\n"));
  const timeline = directed.summary.timeline;
  const stops = timeline.filter((e) => e.kind === "stop"); const travels = timeline.filter((e) => e.kind !== "stop");
  assert.equal(stops.length, 3); assert.equal(travels.length, 2);
  const orbitSeconds = stops.map((s) => s.movements.reduce((a, m) => a + m.seconds, 0));
  assert.ok(Math.abs(orbitSeconds[0] - 180) < 0.01 && Math.abs(orbitSeconds[1] - 180) < 0.01 && Math.abs(orbitSeconds[2] - 4) < 0.01, `orbit seconds ${orbitSeconds}`);
  assert.equal(check.compiled.total_duration_seconds, 375);
  const beats = directed.plan.beats.map((b) => b.duration_seconds);
  assert.equal(beats.length, 5); assert.equal(beats[0], 180); assert.equal(beats[1], 6); assert.equal(beats[2], 180); assert.equal(beats[3], 5); assert.equal(beats[4], 4);
  assert.match(check.compiled.description, /orbit Korkeasaari .*180 seconds.*fly to Linnanmäki.*orbit Linnanmäki .*180 seconds.*fly to Jätkäsaari.*orbit Jätkäsaari .*4 seconds/);
});

test("super focus parser hostile (Codex 8/8): every place+city variant is ONE stop, never a separate Helsinki stop", () => {
  const cases = [
    ["Korkeasaari, Helsinki", [["Korkeasaari", null]]],
    ["Korkeasaari Helsinki", [["Korkeasaari", null]]],
    ["korkeasaari helsinki", [["Korkeasaari", null]]],
    ["Linnanmäki, Helsinki", [["Linnanmäki", null]]],
    ["Linnanmäki Helsinki", [["Linnanmäki", null]]],
    ["Jätkäsaari, Helsinki", [["Jätkäsaari", null]]],
    ["Jätkäsaari Helsinki", [["Jätkäsaari", null]]],
    ["Jatkasaari Helsinki", [["Jätkäsaari", null]]],
  ];
  for (const [text, expected] of cases) {
    const got = director.parseIntent(text).stops.map((s) => [s.location, s.duration_seconds == null ? null : s.duration_seconds]);
    assert.deepEqual(got, expected, `"${text}" → ${JSON.stringify(got)}`);
  }
  // the Codex mixed-punctuation journey: the 4 s must belong to Jätkäsaari
  const mixed = director.parseIntent("Korkeasaari, Helsinki. circle there for 3 minutes. then move to Linnanmäki, Helsinki, circle there for 3 minutes; then move to Jatkasaari Helsinki. circle there for 4 seconds.");
  assert.deepEqual(mixed.stops.map((s) => [s.location, s.duration_seconds]), [["Korkeasaari", 180], ["Linnanmäki", 180], ["Jätkäsaari", 4]]);
  const upper = director.parseIntent("KORKEASAARI, HELSINKI; CIRCLE THERE FOR 3 MINUTES. THEN MOVE TO LINNANMÄKI, HELSINKI. CIRCLE THERE FOR 3 MINUTES. THEN MOVE TO JÄTKÄSAARI, HELSINKI; CIRCLE THERE FOR 4 SECONDS.");
  assert.deepEqual(upper.stops.map((s) => [s.location, s.duration_seconds]), [["Korkeasaari", 180], ["Linnanmäki", 180], ["Jätkäsaari", 4]]);
  // a city that is NOT a qualifier of the preceding place stays a stop
  assert.deepEqual(director.parseIntent("fly from Helsinki to Korkeasaari").stops.map((s) => s.location), ["Helsinki", "Korkeasaari"]);
  assert.deepEqual(director.parseIntent("Orbit Korkeasaari for 30 seconds. Then show Helsinki.").stops.map((s) => s.location), ["Korkeasaari", "Helsinki"]);
  assert.deepEqual(director.parseIntent("Show Paris, Helsinki").stops.map((s) => s.location), ["Paris", "Helsinki"], "1 900 km apart → two stops (resolution refuses the pair as one place)");
});

test("super focus gazetteer + director controls: aliases, comma qualifiers, no durations unless stated, decimals", () => {
  assert.equal(planner.resolveLocation("korkeasaari, Helsinki").name, "Korkeasaari");
  assert.equal(planner.resolveLocation("jätkänsaari, Helsinki").name, "Jätkäsaari");
  assert.equal(planner.resolveLocation("Helsinki Zoo").name, "Korkeasaari");
  assert.equal(planner.resolveLocation("Paris, Helsinki"), null);
  const a = director.parseIntent("Start in Helsinki. Show where Stockholm is relative to Helsinki. Stockholm is the main destination.");
  assert.deepEqual(a.stops.map((s) => s.location), ["Helsinki", "Stockholm"]); assert.ok(a.stops.every((s) => s.duration_seconds == null));
  assert.deepEqual(director.parseIntent("Show the terrain of Matterhorn.").stops.map((s) => s.location), ["Matterhorn"]);
  assert.deepEqual(director.parseIntent("hover over Helsinki Zoo for 10 seconds, then fly to Paris.").stops.map((s) => [s.location, s.duration_seconds || null]), [["Korkeasaari", 10], ["Paris", null]]);
  assert.equal(director.parseIntent("circle Paris for 1.5 minutes").stops[0].duration_seconds, 90);
});

// ── 2. Frame manifest authority ──────────────────────────────────────────────
test("frame manifest: Earth Studio inclusive convention, exact contiguous set, stability, and every hostile rejection reason", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-manifest-"));
  try {
    const dir = path.join(root, "job-1");
    const m = manifestModel.buildFrameManifest({ dir, prefix: "earth-studio_", ext: "jpeg", first: 0, last: 60 });
    assert.equal(m.expected_count, 61, "0..60 inclusive = 61 files for a 60-frame project");
    assert.equal(m.digits, 2); assert.equal(m.encode_limit, 60, "the MP4 encodes the planned 60 frames");
    assert.equal(manifestModel.ffmpegFrameSource(m).pattern, path.join(dir, "earth-studio_%02d.jpeg"));
    manifestModel.prepareFrameDir(dir);
    let r = manifestModel.inspectFrames(m); assert.equal(r.complete, false); assert.equal(r.missing.length, 61);
    // gapped + unrelated
    for (let f = 2; f <= 60; f += 1) fs.writeFileSync(path.join(dir, `earth-studio_${String(f).padStart(2, "0")}.jpeg`), "x");
    fs.writeFileSync(path.join(dir, "unrelated-copy.png"), "x");
    r = manifestModel.inspectFrames(m); assert.equal(r.complete, false); assert.deepEqual(r.missing, [0, 1]); assert.deepEqual(r.unrelated, ["unrelated-copy.png"]);
    fs.unlinkSync(path.join(dir, "unrelated-copy.png"));
    fs.writeFileSync(path.join(dir, "earth-studio_00.jpeg"), "x"); fs.writeFileSync(path.join(dir, "earth-studio_01.jpeg"), "x");
    // wrong width, out of range, temp file, empty file
    fs.writeFileSync(path.join(dir, "earth-studio_7.jpeg"), "x"); r = manifestModel.inspectFrames(m); assert.deepEqual(r.width_mismatch, ["earth-studio_7.jpeg"]); fs.unlinkSync(path.join(dir, "earth-studio_7.jpeg"));
    fs.writeFileSync(path.join(dir, "earth-studio_61.jpeg"), "x"); r = manifestModel.inspectFrames(m); assert.deepEqual(r.extra, [61]); fs.unlinkSync(path.join(dir, "earth-studio_61.jpeg"));
    fs.writeFileSync(path.join(dir, "earth-studio_33.jpeg.part"), "x"); r = manifestModel.inspectFrames(m); assert.deepEqual(r.unstable, ["earth-studio_33.jpeg.part"]); fs.unlinkSync(path.join(dir, "earth-studio_33.jpeg.part"));
    fs.writeFileSync(path.join(dir, "earth-studio_33.jpeg"), ""); r = manifestModel.inspectFrames(m); assert.deepEqual(r.zero_size, ["earth-studio_33.jpeg"]); fs.writeFileSync(path.join(dir, "earth-studio_33.jpeg"), "x");
    // mixed extension does not count
    fs.writeFileSync(path.join(dir, "earth-studio_34.jpg"), "x"); r = manifestModel.inspectFrames(m); assert.deepEqual(r.unrelated, ["earth-studio_34.jpg"]); fs.unlinkSync(path.join(dir, "earth-studio_34.jpg"));
    // all present: first inspection is NOT complete (needs stability), second is
    r = manifestModel.inspectFrames(m); assert.equal(r.missing.length, 0); assert.equal(r.complete, false); assert.deepEqual(r.reasons, ["awaiting one stability confirmation"]);
    const r2 = manifestModel.inspectFrames(m, { previous: r.snapshot }); assert.equal(r2.complete, true); assert.equal(r2.count, 61);
    // a file that changed between inspections is unstable
    fs.writeFileSync(path.join(dir, "earth-studio_10.jpeg"), "xx"); const r3 = manifestModel.inspectFrames(m, { previous: r2.snapshot }); assert.equal(r3.complete, false); assert.deepEqual(r3.unstable, ["earth-studio_10.jpeg"]);
    // the directory must be the job's own
    assert.throws(() => manifestModel.prepareFrameDir(dir), (e) => e.code === "FRAME_DIR_NOT_EMPTY");
    const big = manifestModel.buildFrameManifest({ dir, prefix: "earth-studio_", ext: "jpeg", first: 0, last: 11250 });
    assert.equal(big.expected_count, 11251); assert.equal(big.digits, 5); assert.equal(big.encode_limit, 11250);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── 3. Lifecycle happy path (fake export, real ffmpeg + ffprobe) ─────────────
test("super focus job: create → plan → project → Earth Studio automation → verified frames → encode → ffprobe → READY; every stage timed; honest ETA", async () => {
  const fx = tmpPackage(); const clk = clock();
  const runner = fakeExportRunner({ mode: "complete" });
  const o = opts(clk, { exportRunner: runner });
  try {
    const job = sf.createJob(fx.pkg, fx.packageId, { instruction: INSTRUCTION.replace("3 minutes", "2 seconds").replace("3 minutes", "2 seconds").replace("4 seconds", "1 second") }, o);
    await sleep(5); // the export runner starts in a microtask after the 202-style return
    let saved = sf.readJob(fx.pkg);
    assert.equal(saved.job_id, job.job_id);
    assert.ok(["LAUNCHING_EARTH_STUDIO", "IMPORTING_PROJECT", "EXPORTING_EARTH_STUDIO_FRAMES"].includes(saved.status), saved.status);
    assert.ok(fs.existsSync(path.join(fx.pkg, "earth-studio", "earth-studio.esp")));
    assert.deepEqual(saved.parsed.stops.map((s) => s.location), ["Korkeasaari", "Linnanmäki", "Jätkäsaari"]);
    assert.equal(saved.progress.frames_expected, saved.progress.frames_total + 1, "Earth Studio renders 0..N inclusive");
    assert.equal(saved.eta.seconds_remaining, null, "no invented ETA");
    assert.equal(runner.calls.length, 1); assert.equal(runner.calls[0].expected.first, 0); assert.equal(runner.calls[0].expected.last, saved.progress.frames_total);
    assert.ok(runner.calls[0].framesDir.endsWith(path.join("earth-studio", "frames", saved.job_id)), "job-scoped frames directory");
    await settleExport(fx.pkg);
    saved = sf.readJob(fx.pkg);
    assert.equal(saved.status, "EXPORTING_EARTH_STUDIO_FRAMES"); assert.equal(saved.export.state, "complete");
    assert.equal(saved.export.manifest.prefix, "earth-studio_"); assert.equal(saved.export.manifest.expected_count, saved.progress.frames_total + 1);
    assert.equal(saved.export.imagery_sources, "Fake imagery sources (test)");
    // completion needs the manifest: first tick sees the set, second confirms stability → encode starts
    let j = sf.tick(fx.pkg, fx.packageId, o); assert.equal(j.status, "EXPORTING_EARTH_STUDIO_FRAMES"); assert.equal(j.export.files_on_disk, saved.progress.frames_total + 1);
    j = sf.tick(fx.pkg, fx.packageId, o); assert.equal(j.status, "RENDERING"); assert.equal(j.render.state, "in_progress"); assert.ok(j.render.pid > 0);
    assert.ok(j.render.args.includes("-frames:v") && j.render.args[j.render.args.indexOf("-frames:v") + 1] === String(saved.progress.frames_total), "encode exactly the planned frames");
    assert.ok(j.render.args.some((a) => a.includes(`${path.sep}frames${path.sep}${saved.job_id}${path.sep}earth-studio_%`)), "ffmpeg reads the job's own directory by pattern");
    j = await runToTerminal(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "READY", JSON.stringify(j.error));
    assert.equal(j.render.state, "validated"); assert.equal(j.render.validation.ok, true);
    assert.ok(j.render.validation.checks.find((c) => c.name === "frame_count_exact").ok);
    assert.equal(j.result.total_frames, saved.progress.frames_total); assert.equal(j.result.codec, "h264");
    assert.equal(j.result.url, `/aigen-assets/script-packages/${fx.packageId}/earth-studio/renders/${path.basename(lane.renderPath(fx.pkg))}`);
    assert.ok(Math.abs(j.result.duration_seconds - j.parsed.total_duration_seconds) < 0.1);
    ["PLANNING", "VALIDATING", "GENERATING_PROJECT", "LAUNCHING_EARTH_STUDIO", "IMPORTING_PROJECT", "EXPORTING_EARTH_STUDIO_FRAMES", "RENDERING", "FINALIZING"].forEach((n) => { const s = j.stages.find((x) => x.name === n); assert.ok(s.started_at && s.completed_at, `${n} timed`); });
    const timing = sf.readTiming(fx.pkg); assert.ok(timing.render_seconds_per_frame > 0 && timing.export_frames_per_second > 0);
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("super focus ETA: not measurable before the first frame; measured from real arrival rate (and Earth Studio's own remaining, conservatively) once frames arrive", async () => {
  const fx = tmpPackage(); const clk = clock();
  let release;
  const runner = async (params) => {
    const emit = (evt) => params.onEvent({ at: clk.now(), ...evt });
    emit({ type: "importing" }); emit({ type: "export_started", render_name: "earth-studio", first: 0, last: params.expected.last, expected_count: params.expected.count });
    await new Promise((r) => { release = r; });
    return { ok: true, files: 0 };
  };
  const o = opts(clk, { exportRunner: runner });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o); await sleep(10);
    let j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "EXPORTING_EARTH_STUDIO_FRAMES"); assert.equal(j.eta.seconds_remaining, null); assert.equal(j.eta.basis, "export_starting");
    const dir = j.export.frames_dir; const last = j.export.manifest.last;
    writeJpegFrames(dir, { first: 0, last, onlyUpTo: 9 }); clk.advance(10); j = sf.tick(fx.pkg, fx.packageId, o);
    // samples: 0 frames at t0, 10 frames at t0+10 s → 1 f/s → 51 remaining ≈ 51 s + default encode 60×0.05 = 3 s
    assert.equal(j.export.files_on_disk, 10); assert.equal(j.eta.basis, "observed_earth_studio_export_rate"); assert.ok(Math.abs(j.eta.seconds_remaining - 54) < 2, `eta ${j.eta.seconds_remaining}`);
    writeJpegFrames(path.join(dir, "..", "tmp-b"), { first: 0, last, onlyUpTo: 29 }); for (let f = 10; f <= 29; f += 1) fs.renameSync(path.join(dir, "..", "tmp-b", `earth-studio_${String(f).padStart(2, "0")}.jpeg`), path.join(dir, `earth-studio_${String(f).padStart(2, "0")}.jpeg`));
    clk.advance(10); j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.export.files_on_disk, 30); assert.equal(j.eta.basis, "observed_earth_studio_export_rate"); assert.equal(j.eta.confidence, "measured");
    // 30 frames in 20 s → 1.5 f/s → 31 remaining ≈ 20.7 s + default render 60×0.05 = 3 s
    assert.ok(Math.abs(j.eta.seconds_remaining - 23.7) < 2, `eta ${j.eta.seconds_remaining}`);
    assert.equal(j.eta.export_frames_per_second, 1.5);
    assert.ok(j.progress.percent >= 48 && j.progress.percent <= 50);
    // Earth Studio reports a longer remaining time → the conservative value wins, labelled
    const cur = sf.readJob(fx.pkg); cur.export.remaining_text = "01:00"; sf.writeFileAtomic(sf.jobPath(fx.pkg), JSON.stringify(cur));
    j = sf.tick(fx.pkg, fx.packageId, o); assert.ok(j.eta.seconds_remaining >= 60, `eta ${j.eta.seconds_remaining}`); assert.equal(j.eta.earth_studio_reported_remaining_seconds, 60);
    // 31 s without a new frame → STALLED note, still EXPORTING, never RENDERING
    clk.advance(65); j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "EXPORTING_EARTH_STUDIO_FRAMES"); assert.match(j.stages.find((s) => s.name === "EXPORTING_EARTH_STUDIO_FRAMES").note, /^STALLED/); assert.ok(j.export.stalled_since);
  } finally { if (release) release(); sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// ── 4. Watcher hostile cases (Codex 6/6) ────────────────────────────────────
test("watcher hostile 1/6: stale frames from a previous job never count and never render", async () => {
  const fx = tmpPackage(); const clk = clock();
  const runner = fakeExportRunner({ mode: "hang", stallAfter: 0 }); const spawns = [];
  const o = opts(clk, { exportRunner: runner, spawn: () => { spawns.push(1); return fakeChild(); } });
  try {
    // 100 stale files in the shared frames/ folder AND a stale prior job directory
    const shared = path.join(fx.pkg, "earth-studio", "frames"); fs.mkdirSync(shared, { recursive: true });
    for (let i = 0; i < 100; i += 1) fs.writeFileSync(path.join(shared, `frame_${String(i).padStart(4, "0")}.png`), "stale");
    fs.mkdirSync(path.join(shared, "old-job")); for (let i = 0; i <= 60; i += 1) fs.writeFileSync(path.join(shared, "old-job", `earth-studio_${String(i).padStart(2, "0")}.jpeg`), "stale");
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o);
    await sleep(30);
    let j = sf.tick(fx.pkg, fx.packageId, o); j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "EXPORTING_EARTH_STUDIO_FRAMES"); assert.equal(j.export.files_on_disk, 0, "stale files are not this job's frames");
    assert.equal(spawns.length, 0, "no render started");
    assert.equal(fs.readdirSync(j.export.frames_dir).length, 0);
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("watcher hostile 1b/6: a pre-populated job directory is refused, not adopted", () => {
  const fx = tmpPackage(); const clk = clock();
  const runner = fakeExportRunner({ mode: "complete" });
  const o = opts(clk, { exportRunner: runner, setImmediate: (fn) => fn() });
  try {
    // plan synchronously but pre-create the job dir the moment the job id is known: use a runner-less first pass
    const job = sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, { ...o, exportRunner: async () => { await new Promise(() => {}); } });
    sf.stopWatcher(fx.pkg);
    // simulate restart: owner dead, dir of attempt 2 pre-populated with stale files
    const cur = sf.readJob(fx.pkg); cur.export.owner.pid = 999999; sf.writeFileAtomic(sf.jobPath(fx.pkg), JSON.stringify(cur));
    sf._internals.ACTIVE_EXPORTS.delete(fx.pkg);
    const dir2 = sf._internals.exportDirs(fx.pkg, job.job_id, 2).frames; fs.mkdirSync(dir2, { recursive: true }); fs.writeFileSync(path.join(dir2, "earth-studio_00.jpeg"), "stale");
    const after = sf.status(fx.pkg, fx.packageId, o).job;
    assert.equal(after.status, "FAILED"); assert.equal(after.error.cause, "Frame directory not empty"); assert.equal(runner.calls.length, 0);
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("watcher hostile 2/6: gapped names plus an unrelated image never satisfy the manifest", async () => {
  const fx = tmpPackage(); const clk = clock(); const spawns = [];
  const runner = manualRunner((dir, expected) => { for (let f = 2; f <= expected.last; f += 1) fs.writeFileSync(path.join(dir, `earth-studio_${String(f).padStart(2, "0")}.jpeg`), "x"); fs.writeFileSync(path.join(dir, "unrelated-copy.jpeg"), "x"); return expected.count; });
  const o = opts(clk, { exportRunner: runner, spawn: () => { spawns.push(1); return fakeChild(); } });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o); await settleExport(fx.pkg);
    let j = sf.tick(fx.pkg, fx.packageId, o); j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "FAILED"); assert.equal(j.error.cause, "Earth Studio export incomplete"); assert.match(j.error.detail, /2 of 61 frames missing/); assert.match(j.error.detail, /unrelated/);
    assert.equal(spawns.length, 0);
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("watcher hostile 3/6: mixed extensions (30 png + 31 jpg) never make a complete jpeg set", async () => {
  const fx = tmpPackage(); const clk = clock(); const spawns = [];
  const runner = manualRunner((dir) => { for (let i = 0; i < 30; i += 1) fs.writeFileSync(path.join(dir, `a_${i}.png`), "x"); for (let i = 0; i < 31; i += 1) fs.writeFileSync(path.join(dir, `b_${i}.jpg`), "x"); return 61; });
  const o = opts(clk, { exportRunner: runner, spawn: () => { spawns.push(1); return fakeChild(); } });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o); await settleExport(fx.pkg);
    let j = sf.tick(fx.pkg, fx.packageId, o); j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "FAILED"); assert.match(j.error.detail, /61 of 61 frames missing/); assert.match(j.error.detail, /61 unrelated file/); assert.equal(spawns.length, 0);
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("watcher hostile 4/6: a stalled partial export is STALLED / FAILED, never complete — no 30-second rule", async () => {
  const fx = tmpPackage(); const clk = clock(); const spawns = [];
  const runner = fakeExportRunner({ mode: "stall", stallAfter: 1, stallRejectMs: 150 });
  const o = opts(clk, { exportRunner: runner, spawn: () => { spawns.push(1); return fakeChild(); } });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: "orbit Helsinki for 5 seconds" }, o);
    await sleep(40); let j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "EXPORTING_EARTH_STUDIO_FRAMES"); assert.equal(j.export.files_on_disk, 1);
    clk.advance(31); j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "EXPORTING_EARTH_STUDIO_FRAMES", "31 s of silence is not completion"); assert.equal(spawns.length, 0);
    await settleExport(fx.pkg); j = sf.readJob(fx.pkg);
    assert.equal(j.status, "FAILED"); assert.equal(j.error.cause, "Earth Studio export stalled"); assert.equal(j.error.code, "EXPORT_STALLED"); assert.equal(j.error.retryable, true);
    assert.equal(spawns.length, 0, "ffmpeg never started on a partial export");
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("watcher hostile 5/6: ffmpeg exit 0 with a corrupt 4096-byte MP4 → FAILED validation, Play stays disabled", async () => {
  const fx = tmpPackage(); const clk = clock();
  const child = fakeChild();
  const o = opts(clk, { exportRunner: fakeExportRunner({ mode: "complete" }), spawn: () => child });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o); await settleExport(fx.pkg);
    sf.tick(fx.pkg, fx.packageId, o); let j = sf.tick(fx.pkg, fx.packageId, o); assert.equal(j.status, "RENDERING");
    const mp4 = lane.renderPath(fx.pkg); fs.mkdirSync(path.dirname(mp4), { recursive: true }); fs.writeFileSync(mp4, Buffer.alloc(4096, 1));
    child._close(0); clk.advance(1); j = sf.tick(fx.pkg, fx.packageId, o);
    assert.equal(j.status, "FAILED"); assert.equal(j.error.cause, "Rendered video failed validation"); assert.match(j.error.detail, /container_parses/);
    assert.equal(j.result, null, "no Play URL"); assert.equal(j.render.state, "failed");
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("watcher hostile 6/6: fresh-process restart with a 128-byte partial output is never READY", async () => {
  const fx = tmpPackage(); const clk = clock();
  const child = fakeChild();
  const o = opts(clk, { exportRunner: fakeExportRunner({ mode: "complete" }), spawn: () => child });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o); await settleExport(fx.pkg);
    sf.tick(fx.pkg, fx.packageId, o); const j = sf.tick(fx.pkg, fx.packageId, o); assert.equal(j.status, "RENDERING");
    const mp4 = lane.renderPath(fx.pkg); fs.mkdirSync(path.dirname(mp4), { recursive: true }); fs.writeFileSync(mp4, Buffer.alloc(128, 2));
    // the encoder pid recorded in the job is dead in the fresh process
    const cur = sf.readJob(fx.pkg); cur.render.pid = 999999; sf.writeFileAtomic(sf.jobPath(fx.pkg), JSON.stringify(cur));
    sf.stopWatcher(fx.pkg);
    const code = `const sf=require(${JSON.stringify(path.join(__dirname, "..", "earth-studio-super-focus.js"))}); const j=sf.status(${JSON.stringify(fx.pkg)},${JSON.stringify(fx.packageId)},{noTimers:true}).job; process.stdout.write(JSON.stringify({status:j.status,result:j.result,cause:j.error&&j.error.cause}));`;
    const fresh = childProcess.spawnSync(process.execPath, ["-e", code], { encoding: "utf8" });
    const recovered = JSON.parse(fresh.stdout);
    assert.notEqual(recovered.status, "READY"); assert.equal(recovered.result, null); assert.equal(recovered.cause, "Rendered video failed validation");
    child._close(0);
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// ── 5. READY hostile: validateVideo ──────────────────────────────────────────
test("READY hostile: corrupt 4096-byte, corrupt 128-byte, zero-byte and text-as-.mp4 all fail ffprobe validation; a real encode passes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-ready-"));
  try {
    const cases = { "corrupt-4096.mp4": Buffer.alloc(4096, 1), "corrupt-128.mp4": Buffer.alloc(128, 2), "zero.mp4": Buffer.alloc(0), "text.mp4": Buffer.from("this is not a video file\n".repeat(50)) };
    for (const [name, bytes] of Object.entries(cases)) {
      const f = path.join(root, name); fs.writeFileSync(f, bytes);
      const v = sf.validateVideo(f, { expectedFrames: 60, frameRate: 30 });
      assert.equal(v.ok, false, name); assert.ok(v.checks.some((c) => !c.ok), name);
    }
    // real: 60 frames at 30 fps
    const good = path.join(root, "good.mp4");
    const r = childProcess.spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-frames:v", "60", "-c:v", "libx264", "-pix_fmt", "yuv420p", good], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const v = sf.validateVideo(good, { expectedFrames: 60, frameRate: 30 }); assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.ok)));
    assert.equal(v.probe.frames, 60); assert.equal(v.probe.codec, "h264");
    // wrong frame count is rejected even though the file is valid
    assert.equal(sf.validateVideo(good, { expectedFrames: 61, frameRate: 30 }).ok, false);
    // no video stream (audio-only mp4)
    const audio = path.join(root, "audio.mp4");
    childProcess.spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", audio], { encoding: "utf8" });
    assert.equal(sf.validateVideo(audio, { expectedFrames: 30, frameRate: 30 }).ok, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── 6. Atomic state ──────────────────────────────────────────────────────────
test("atomic job state: writes go through temp+rename in the same directory; a reader never parses a torn file; a torn file on disk is reported as corrupt, not as 'no job'", () => {
  const fx = tmpPackage(); const clk = clock();
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, opts(clk, { exportRunner: async () => { await new Promise(() => {}); } }));
    sf.stopWatcher(fx.pkg);
    const file = sf.jobPath(fx.pkg);
    // concurrent writer in another process, reader here: every read must parse
    const writer = childProcess.spawn(process.execPath, ["-e", `const sf=require(${JSON.stringify(path.join(__dirname, "..", "earth-studio-super-focus.js"))});const fs=require('fs');const p=${JSON.stringify(file)};for(let i=0;i<400;i++){const j=JSON.parse(fs.readFileSync(p,'utf8'));j.export.samples=Array.from({length:200},(_,k)=>({at:'t'+i+'-'+k,frames:k}));sf.writeFileAtomic(p, JSON.stringify(j,null,2));}`], { stdio: "ignore" });
    let reads = 0; const t0 = Date.now();
    while (Date.now() - t0 < 1500) { const j = sf.readJob(fx.pkg); assert.ok(j && j.job_id, "parsed"); reads += 1; }
    writer.kill(); assert.ok(reads > 50, `reads ${reads}`);
    assert.ok(!fs.readdirSync(path.dirname(file)).some((n) => n.endsWith(".tmp") && Date.now() - fs.statSync(path.join(path.dirname(file), n)).mtimeMs > 5000), "no stale temp files");
    // simulated crash of a NON-atomic writer: truncated JSON
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").slice(0, 200));
    assert.throws(() => sf.readJob(fx.pkg), (e) => e.code === "JOB_FILE_CORRUPT");
    const st = sf.status(fx.pkg, fx.packageId, { noTimers: true });
    assert.equal(st.has_job, true); assert.equal(st.job_file_corrupt, true); assert.equal(st.job, null);
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// ── 7. Restart ownership / idempotence ──────────────────────────────────────
test("restart ownership: a dead export owner → exactly one fresh attempt in a new directory (idempotent across repeated status calls); a complete set on disk → encode without a new Earth Studio session", async () => {
  const fx = tmpPackage(); const clk = clock();
  const hang = fakeExportRunner({ mode: "hang", stallAfter: 2 });
  const o = opts(clk, { exportRunner: hang });
  try {
    const job = sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o); await sleep(40);
    let cur = sf.readJob(fx.pkg); assert.equal(cur.export.attempt, 1); assert.equal(cur.export.files_on_disk, 0);
    // "restart": owner pid is gone, no in-process export
    sf.stopWatcher(fx.pkg); sf._internals.ACTIVE_EXPORTS.delete(fx.pkg);
    cur.export.owner.pid = 999999; cur.export.owner.chrome_pid = null; sf.writeFileAtomic(sf.jobPath(fx.pkg), JSON.stringify(cur));
    const second = fakeExportRunner({ mode: "hang", stallAfter: 0 });
    const o2 = opts(clk, { exportRunner: second });
    let st = sf.status(fx.pkg, fx.packageId, o2); await sleep(20);
    assert.equal(second.calls.length, 1, "one fresh attempt"); assert.equal(st.job.export.attempt, 2);
    assert.ok(st.job.export.frames_dir.endsWith(`${job.job_id}-a2`), st.job.export.frames_dir);
    assert.match(st.job.stages.find((s) => s.name === "EXPORTING_EARTH_STUDIO_FRAMES").note || "", /interrupted by a restart/);
    assert.equal(st.job.export.recoveries.length, 1); assert.equal(st.job.export.recoveries[0].dead_owner_pid, 999999); assert.equal(st.job.export.attempts.length, 1, "the interrupted attempt is kept in the record");
    st = sf.status(fx.pkg, fx.packageId, o2); st = sf.status(fx.pkg, fx.packageId, o2);
    assert.equal(second.calls.length, 1, "repeated status calls do not start more Earth Studio sessions");
    // complete set on disk with dead owner → encode, no new export
    sf.stopWatcher(fx.pkg); sf._internals.ACTIVE_EXPORTS.delete(fx.pkg);
    cur = sf.readJob(fx.pkg); cur.export.owner.pid = 999999; sf.writeFileAtomic(sf.jobPath(fx.pkg), JSON.stringify(cur));
    fs.rmSync(cur.export.frames_dir, { recursive: true, force: true }); writeJpegFrames(cur.export.frames_dir, { first: 0, last: cur.export.manifest.last });
    const third = fakeExportRunner({ mode: "complete" }); const o3 = opts(clk, { exportRunner: third });
    st = sf.status(fx.pkg, fx.packageId, o3); // stability snapshot 1
    let j = sf.tick(fx.pkg, fx.packageId, o3); if (j.status !== "RENDERING") j = sf.tick(fx.pkg, fx.packageId, o3);
    assert.equal(third.calls.length, 0, "no Earth Studio session when frames are already complete");
    assert.equal(j.status, "RENDERING");
    j = await runToTerminal(fx.pkg, fx.packageId, o3); assert.equal(j.status, "READY", JSON.stringify(j.error));
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("render ownership: a live encoder pid from a previous process is never duplicated; a dead pid with a valid output finalizes; render start is refused while the lane is busy", async () => {
  const fx = tmpPackage(); const clk = clock(); const spawns = []; const children = [];
  const o = opts(clk, { exportRunner: fakeExportRunner({ mode: "complete" }), spawn: () => { spawns.push(1); const c = fakeChild(); children.push(c); return c; } });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o); await settleExport(fx.pkg);
    sf.tick(fx.pkg, fx.packageId, o); let j = sf.tick(fx.pkg, fx.packageId, o); assert.equal(j.status, "RENDERING"); assert.equal(spawns.length, 1);
    // pretend a previous server started it: our own pid is "alive", the lane has no record
    const cur = sf.readJob(fx.pkg); cur.render.pid = process.pid; cur.render.lane_job_id = "gone"; sf.writeFileAtomic(sf.jobPath(fx.pkg), JSON.stringify(cur));
    j = sf.tick(fx.pkg, fx.packageId, o); assert.equal(j.status, "RENDERING"); assert.equal(spawns.length, 1, "no second ffmpeg"); assert.match(j.stages.find((s) => s.name === "RENDERING").note, /still running/);
    // dead pid + valid real output → validated READY
    const cur2 = sf.readJob(fx.pkg); cur2.render.pid = 999999; sf.writeFileAtomic(sf.jobPath(fx.pkg), JSON.stringify(cur2));
    const mp4 = lane.renderPath(fx.pkg); fs.mkdirSync(path.dirname(mp4), { recursive: true });
    childProcess.spawnSync("ffmpeg", ["-y", "-v", "error", "-framerate", "30", "-start_number", "0", "-i", path.join(cur2.export.frames_dir, "earth-studio_%02d.jpeg"), "-frames:v", "60", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4], { encoding: "utf8" });
    j = sf.tick(fx.pkg, fx.packageId, o); assert.equal(j.status, "READY", JSON.stringify(j.error)); assert.equal(spawns.length, 1);
  } finally { children.forEach((c) => c._close(0)); /* release the lane's single in-memory render slot */ sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// ── 8. One active job; auth block; retry semantics ──────────────────────────
test("one active job per project: a second Create is 409 (replace is not honoured), retry on a running job is 409; blank instruction 400", async () => {
  const fx = tmpPackage(); const clk = clock();
  const o = opts(clk, { exportRunner: fakeExportRunner({ mode: "hang", stallAfter: 0 }) });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, o); await sleep(20);
    assert.throws(() => sf.createJob(fx.pkg, fx.packageId, { instruction: "orbit Paris for 2 seconds", replace: true }, o), (e) => e.statusCode === 409 && e.job && e.job.instruction === SHORT);
    assert.throws(() => sf.retry(fx.pkg, fx.packageId, o), (e) => e.statusCode === 409);
    assert.throws(() => sf.createJob(fx.pkg, fx.packageId, { instruction: "   " }, o), (e) => e.statusCode === 400);
    assert.equal(sf.readJob(fx.pkg).instruction, SHORT, "the running job was not replaced");
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("auth state: an expired Earth Studio sign-in surfaces WAITING_FOR_EARTH_STUDIO_AUTH (no generic wait, no ETA); Retry re-launches; unknown place fails at PLANNING; Retry after a failed encode re-encodes without a new export", async () => {
  const fx = tmpPackage(); const clk = clock();
  const auth = fakeExportRunner({ mode: "auth" });
  try {
    sf.createJob(fx.pkg, fx.packageId, { instruction: SHORT }, opts(clk, { exportRunner: auth })); await settleExport(fx.pkg);
    let j = sf.readJob(fx.pkg);
    assert.equal(j.status, "WAITING_FOR_EARTH_STUDIO_AUTH"); assert.equal(j.blocked.kind, "earth_studio_sign_in"); assert.equal(j.eta.basis, "blocked_on_sign_in"); assert.equal(j.export.state, "auth_required");
    assert.throws(() => sf.createJob(fx.pkg, fx.packageId, { instruction: "orbit Paris for 2 seconds" }, opts(clk)), (e) => e.statusCode === 409);
    const ok = fakeExportRunner({ mode: "complete" });
    j = sf.retry(fx.pkg, fx.packageId, opts(clk, { exportRunner: ok })); await settleExport(fx.pkg);
    assert.equal(ok.calls.length, 1); assert.equal(sf.readJob(fx.pkg).export.attempt, 2); assert.equal(sf.readJob(fx.pkg).blocked, null);
    // failed encode → retry re-encodes only
    const child = fakeChild(); const o3 = opts(clk, { exportRunner: ok, spawn: () => child });
    sf.tick(fx.pkg, fx.packageId, o3); j = sf.tick(fx.pkg, fx.packageId, o3); assert.equal(j.status, "RENDERING");
    child._stderr("Invalid data found when processing input\n"); child._close(1); j = sf.tick(fx.pkg, fx.packageId, o3);
    assert.equal(j.status, "FAILED"); assert.equal(j.error.cause, "Video encoding failed"); assert.match(j.error.detail, /Invalid data/);
    const before = ok.calls.length;
    j = sf.retry(fx.pkg, fx.packageId, opts(clk, { exportRunner: ok }));
    assert.equal(ok.calls.length, before, "frames are complete → no new Earth Studio session");
    assert.equal(j.status, "EXPORTING_EARTH_STUDIO_FRAMES"); assert.equal(j.render.state, "not_started");
    j = await runToTerminal(fx.pkg, fx.packageId, opts(clk, { exportRunner: ok })); assert.equal(j.status, "READY", JSON.stringify(j.error)); assert.equal(j.render.attempt, 2);
  } finally { sf.stopWatcher(fx.pkg); fs.rmSync(fx.root, { recursive: true, force: true }); }
  const fx2 = tmpPackage("es-sf-unknown");
  try {
    sf.createJob(fx2.pkg, fx2.packageId, { instruction: "circle around nowhereville for 2 minutes" }, opts(clock()));
    const j = sf.readJob(fx2.pkg); assert.equal(j.status, "FAILED"); assert.equal(j.error.cause, "Could not resolve location"); assert.equal(j.error.failed_stage, "PLANNING");
  } finally { fs.rmSync(fx2.root, { recursive: true, force: true }); }
});

// ── 9. HTTP routes ───────────────────────────────────────────────────────────
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

test("super focus API: create is nonce-gated, returns 202 immediately, the pipeline runs off-request, status is durable, duplicate create → 409 (replace ignored), retry on running → 409, traversal → 400", async () => {
  const fx = tmpPackage();
  const prev = { r: process.env.AIGEN_VIDNAS_ROOT, s: process.env.AIGEN_SCRIPT_PACKAGES };
  process.env.AIGEN_VIDNAS_ROOT = fx.aigenRoot; process.env.AIGEN_SCRIPT_PACKAGES = fx.scriptPackages;
  const server = packageEngineServer.createServer({ earthStudio: { exportRunner: fakeExportRunner({ mode: "hang", stallAfter: 0 }), noTimers: true } });
  const nonceHeaders = { host: "127.0.0.1:8010", [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() };
  try {
    await listen(server);
    const empty = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_STATUS_API}?id=${fx.packageId}`);
    assert.equal(empty.statusCode, 200); assert.equal(empty.body.data.has_job, false);
    const noNonce = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_CREATE_API, { method: "POST", body: { id: fx.packageId, instruction: INSTRUCTION }, headers: { host: "127.0.0.1:8010" } });
    assert.equal(noNonce.statusCode, 403);
    const t0 = Date.now();
    const created = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_CREATE_API, { method: "POST", body: { id: fx.packageId, instruction: INSTRUCTION }, headers: nonceHeaders });
    assert.equal(created.statusCode, 202); assert.equal(created.body.data.job.status, "QUEUED"); assert.ok(Date.now() - t0 < 2000);
    let st = null;
    for (let i = 0; i < 100; i += 1) { st = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_STATUS_API}?id=${fx.packageId}`); if (st.body.data.job.status === "EXPORTING_EARTH_STUDIO_FRAMES") break; await sleep(20); }
    assert.equal(st.body.data.job.status, "EXPORTING_EARTH_STUDIO_FRAMES");
    assert.deepEqual(st.body.data.job.parsed.stops.map((s) => s.explicit_duration_seconds), [180, 180, 4]);
    assert.equal(st.body.data.job.progress.frames_expected, 11251); assert.equal(st.body.data.job.result, null);
    assert.equal(st.body.data.esp_path, path.join(fx.pkg, "earth-studio", "earth-studio.esp"));
    const dup = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_CREATE_API, { method: "POST", body: { id: fx.packageId, instruction: "orbit Paris for 2 seconds", replace: true }, headers: nonceHeaders });
    assert.equal(dup.statusCode, 409); assert.equal(dup.body.job.instruction, INSTRUCTION);
    const retry = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_RETRY_API, { method: "POST", body: { id: fx.packageId }, headers: nonceHeaders });
    assert.equal(retry.statusCode, 409);
    const trav = await requestJson(server, `${packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_STATUS_API}?id=${encodeURIComponent("../../etc")}`);
    assert.equal(trav.statusCode, 400);
    const missing = await requestJson(server, packageEngineServer.EARTH_STUDIO_SUPER_FOCUS_CREATE_API, { method: "POST", body: { id: fx.packageId, instruction: "" }, headers: nonceHeaders });
    assert.equal(missing.statusCode, 400);
  } finally {
    sf.stopWatcher(fx.pkg); sf._internals.ACTIVE_EXPORTS.delete(fx.pkg);
    await close(server);
    if (prev.r === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = prev.r;
    if (prev.s === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.s;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

// ── 10. UI surface (static contract; the headless-Chrome smoke proves the DOM) ─
test("super focus UI: instruction + Create + Play only — no Director role/purpose/treatment/movement controls, no manual Earth Studio instructions; the expert page links to it", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "earth-studio-super-focus.html"), "utf8");
  ["data-sf=\"instruction\"", "data-sf=\"create\"", "data-sf=\"play\"", "data-sf=\"eta\"", "data-sf=\"status\"", "data-sf=\"retry\""].forEach((m) => assert.ok(page.includes(m), m));
  assert.match(page, /Create map animation/);
  ["dirPurposeCards", "dirRoleCards", "Recommended camera treatment", "jb-mode", "data-role=", "data-purpose=", "es-movement", "id=\"dir-", "import the", "Render all", "replace: "].forEach((forbidden) => assert.ok(!page.includes(forbidden), `super focus page must not carry ${forbidden}`));
  assert.ok(!/<select[^>]*(role|purpose|treatment|movement|grammar)/i.test(page));
  assert.ok(page.includes("/api/earth-studio/super-focus/status") && page.includes("/api/earth-studio/super-focus/create") && page.includes("/api/earth-studio/super-focus/retry"));
  assert.ok(page.includes("WAITING_FOR_EARTH_STUDIO_AUTH"), "the sign-in block is surfaced");
  const expert = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  assert.ok(expert.includes("earth-studio-super-focus.html")); assert.ok(expert.includes("dirPurposeCards"));
});
