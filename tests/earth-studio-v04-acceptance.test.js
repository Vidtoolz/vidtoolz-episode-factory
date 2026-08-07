// Tests for the Earth Studio v0.4 real-world acceptance workflow
// (scripts/earth-studio-v04-acceptance.js). Injected ffmpeg spawn + header-only
// synthetic PNGs + temp package dirs — no real renders, no network, and the
// pinned London proof is never touched (there is a hard refusal test for it).
const crypto = require("node:crypto");
const { assert, fs, os, path, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const lane = require("../earth-studio-lane.js");
const acceptance = require("../scripts/earth-studio-v04-acceptance.js");

function withTmpRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-v04-acc-"));
  const scriptPackages = path.join(root, "aigen", "script-packages");
  fs.mkdirSync(scriptPackages, { recursive: true });
  const prev = process.env.AIGEN_SCRIPT_PACKAGES;
  process.env.AIGEN_SCRIPT_PACKAGES = scriptPackages;
  try {
    return fn(path.join(scriptPackages, "v04-acceptance-test"));
  } finally {
    if (prev === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Minimal PNG: signature + IHDR (real width/height) + IEND. Enough for the
// header-level probe the validator documents; ffmpeg does the real decode.
function pngBytes(width, height, salt = 0) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; ihdr[17] = 2; // bit depth 8, truecolor
  ihdr.writeUInt32BE(salt, 21); // stand-in CRC — probe ignores it; salt varies bytes
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([sig, ihdr, iend]);
}

function writeFrames(pkg, { count = 50, start = 420, width = 1080, height = 1920, name = (n) => `es_${String(n).padStart(4, "0")}.png` } = {}) {
  const framesDir = path.join(pkg, "earth-studio", "frames");
  fs.mkdirSync(framesDir, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    fs.writeFileSync(path.join(framesDir, name(start + i)), pngBytes(width, height, start + i));
  }
  return framesDir;
}

function acceptedObservation() {
  return {
    observedAt: "2026-08-07T12:00:00Z",
    observer: "Mikko",
    importSucceeded: true,
    earthStudioWarnings: [],
    flight: { correct: true, notes: "" },
    orbit: { correct: true, directionCorrect: true, targetFacing: true, revolutionsObserved: 2, notes: "" },
    zoom: { correct: true, notes: "" },
    tilt: { correct: true, notes: "" },
    aspectRatio: { correct: true, notes: "" },
    rawNotes: "",
  };
}

function fakeChild() {
  const handlers = {};
  return { pid: 71, stdout: { on: () => {} }, stderr: { on: () => {} }, on: (e, cb) => { handlers[e] = cb; }, kill: () => {}, _fire: (e, ...a) => handlers[e] && handlers[e](...a) };
}

// ---- generate + pre-import semantic assertions ----

test("es-v04-acceptance: generate builds the full diagnostic package and all 29 semantic assertions pass", () => {
  withTmpRoot((pkg) => {
    const out = acceptance.generate(pkg);
    assert.equal(out.ok, true);
    for (const rel of ["earth-studio/shot-plan.json", "earth-studio/earth-studio.esp", "earth-studio/job.json",
      acceptance.FILES.manifest, acceptance.FILES.expected, acceptance.FILES.checklist, acceptance.FILES.observationTemplate, "README.md"]) {
      assert.ok(fs.existsSync(path.join(pkg, rel)), `missing ${rel}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg, acceptance.FILES.manifest), "utf8"));
    assert.equal(manifest.planner_version, planner.VERSION);
    assert.equal(manifest.aspect, "9:16");
    assert.equal(manifest.instruction, acceptance.INSTRUCTION);
    assert.match(manifest.esp_sha256, /^[0-9a-f]{64}$/);
    const expected = JSON.parse(fs.readFileSync(path.join(pkg, acceptance.FILES.expected), "utf8"));
    assert.equal(expected.segments.length, 4);
    assert.deepEqual(expected.segments.map((s) => s.action), ["fly_to", "fly_to", "orbit", "zoom_out"]);
    assert.equal(expected.segments[1].altitude_source, "explicit");
    assert.equal(expected.segments[2].location.source, "carried_over");
    assert.ok(expected.segments[1].peak_altitude_m > 100000, "flight arc peak missing from diagnostics");
    const checks = acceptance.runSemanticChecks(pkg);
    assert.equal(checks.ok, true, checks.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; "));
    assert.ok(checks.checks.length >= 25);
    assert.equal(acceptance.computeStatus(pkg).state, "INTERNAL_VERIFIED");
  });
});

test("es-v04-acceptance: generate refuses to overwrite real observation evidence without --force", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    fs.writeFileSync(path.join(pkg, acceptance.FILES.observation), JSON.stringify(acceptedObservation()));
    assert.throws(() => acceptance.generate(pkg), /refusing to regenerate over real evidence/i);
    assert.equal(acceptance.generate(pkg, { force: true }).ok, true); // explicit new round allowed
  });
});

test("es-v04-acceptance: the pinned London proof is hard-refused", () => {
  assert.throws(() => acceptance.resolvePackageDir("package-runs/2026-06-27-london-proof"), /London proof/);
});

// ---- observation gate (the only external authority) ----

test("es-v04-acceptance: observation gate — incomplete stays internal, accepted advances, discrepancy is preserved", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    // incomplete template → still INTERNAL_VERIFIED
    const template = acceptance.observationTemplate();
    fs.writeFileSync(path.join(pkg, acceptance.FILES.observation), JSON.stringify(template));
    assert.equal(acceptance.computeStatus(pkg).state, "INTERNAL_VERIFIED");
    // all-correct observation → EARTH_STUDIO_IMPORT_VERIFIED (frames/render pending)
    fs.writeFileSync(path.join(pkg, acceptance.FILES.observation), JSON.stringify(acceptedObservation()));
    const verified = acceptance.computeStatus(pkg);
    assert.equal(verified.state, "EARTH_STUDIO_IMPORT_VERIFIED");
    assert.match(verified.detail, /frame export not validated/);
    // a reported discrepancy → IMPORT_DISCREPANCY_REPORTED with the field named
    const bad = acceptedObservation();
    bad.orbit.directionCorrect = false;
    bad.orbit.notes = "orbit ran clockwise on screen";
    fs.writeFileSync(path.join(pkg, acceptance.FILES.observation), JSON.stringify(bad));
    const discrepant = acceptance.computeStatus(pkg);
    assert.equal(discrepant.state, "IMPORT_DISCREPANCY_REPORTED");
    assert.match(discrepant.detail, /orbit\.directionCorrect/);
    assert.equal(discrepant.observation.observation.orbit.notes, "orbit ran clockwise on screen"); // raw note preserved
    // wrong revolution count is a discrepancy too
    const oneRev = acceptedObservation();
    oneRev.orbit.revolutionsObserved = 1;
    assert.match(acceptance.evaluateObservation(oneRev).discrepancies.join(";"), /revolutionsObserved=1/);
    // a FAILED import is a complete observation even with playback fields
    // unobservable (this is exactly round 1 of the real acceptance run)
    const rejected = acceptance.observationTemplate();
    rejected.importSucceeded = false;
    rejected.rawNotes = "Earth Studio would not import the file";
    const evaluated = acceptance.evaluateObservation(rejected);
    assert.equal(evaluated.complete, true);
    assert.equal(evaluated.accepted, false);
    assert.match(evaluated.discrepancies.join(";"), /importSucceeded=false/);
    fs.writeFileSync(path.join(pkg, acceptance.FILES.observation), JSON.stringify(rejected));
    assert.equal(acceptance.computeStatus(pkg).state, "IMPORT_DISCREPANCY_REPORTED");
  });
});

test("es-v04-acceptance: --force regenerate archives the prior round's evidence instead of clobbering it", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    const rejected = acceptance.observationTemplate();
    rejected.importSucceeded = false;
    rejected.rawNotes = "round 1: import failed";
    fs.writeFileSync(path.join(pkg, acceptance.FILES.observation), JSON.stringify(rejected));
    const oldEspSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(pkg, "earth-studio", "earth-studio.esp"))).digest("hex");
    const out = acceptance.generate(pkg, { force: true });
    assert.ok(out.archived_round, "expected the prior round to be archived");
    // active slot cleared → new round starts pending, not discrepant
    assert.ok(!fs.existsSync(path.join(pkg, acceptance.FILES.observation)));
    assert.equal(acceptance.computeStatus(pkg).state, "INTERNAL_VERIFIED");
    // archived evidence preserved verbatim, incl. the exact .esp that failed
    const archivedObs = JSON.parse(fs.readFileSync(path.join(out.archived_round, "import-observation.json"), "utf8"));
    assert.equal(archivedObs.rawNotes, "round 1: import failed");
    const archivedEspSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(out.archived_round, "earth-studio.esp"))).digest("hex");
    assert.equal(archivedEspSha, oldEspSha);
  });
});

// ---- real-frame window validation ----

test("es-v04-acceptance: frame validation accepts a clean contiguous 9:16 window", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    writeFrames(pkg, { count: 50, start: 420 });
    const out = acceptance.validateFrames(pkg);
    assert.equal(out.ok, true, out.failures.join("; "));
    assert.equal(out.count, 50);
    assert.deepEqual(out.window, { first_number: 420, last_number: 469 });
    assert.deepEqual(out.dimensions, ["1080x1920"]);
    assert.ok(fs.existsSync(path.join(pkg, acceptance.FILES.framesValidation)));
  });
});

test("es-v04-acceptance: frame validation rejects gaps, duplicates-by-count, mixed dims, and wrong aspect", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    const framesDir = writeFrames(pkg, { count: 50, start: 420 });
    fs.rmSync(path.join(framesDir, "es_0440.png")); // gap
    assert.match(acceptance.validateFrames(pkg).failures.join("\n"), /missing 440/);
    fs.writeFileSync(path.join(framesDir, "es_0440.png"), pngBytes(1080, 1920, 440)); // heal
    fs.writeFileSync(path.join(framesDir, "es_0435.png"), pngBytes(540, 960, 435)); // mixed dims
    assert.match(acceptance.validateFrames(pkg).failures.join("\n"), /inconsistent frame dimensions/);
    fs.rmSync(path.join(pkg, "earth-studio", "frames"), { recursive: true, force: true });
    writeFrames(pkg, { count: 50, start: 420, width: 1920, height: 1080 }); // wrong aspect
    assert.match(acceptance.validateFrames(pkg).failures.join("\n"), /does not match the 9:16 project/);
    assert.equal(acceptance.validateFrames(pkg).ok, false);
  });
});

test("es-v04-acceptance: frame validation warns without failing on reduced-scale export, identical pairs, extra files, and enforces min-frames", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    // reduced-scale same-ratio export → warning, still ok
    writeFrames(pkg, { count: 50, start: 0, width: 540, height: 960 });
    let out = acceptance.validateFrames(pkg);
    assert.equal(out.ok, true, out.failures.join("; "));
    assert.match(out.warnings.join("\n"), /reduced-scale/);
    // byte-identical consecutive pair → warning only; stray text file is noted
    const framesDir = path.join(pkg, "earth-studio", "frames");
    fs.writeFileSync(path.join(framesDir, "es_0001.png"), fs.readFileSync(path.join(framesDir, "es_0000.png")));
    fs.writeFileSync(path.join(framesDir, "notes.txt"), "not a frame");
    out = acceptance.validateFrames(pkg);
    assert.equal(out.ok, true);
    assert.ok(out.identical_consecutive_pairs >= 1);
    assert.deepEqual(out.ignored_entries, ["notes.txt"]);
    // min-frames floor
    fs.rmSync(framesDir, { recursive: true, force: true });
    writeFrames(pkg, { count: 12, start: 0 });
    assert.match(acceptance.validateFrames(pkg).failures.join("\n"), /at least 50/);
    assert.equal(acceptance.validateFrames(pkg, { minFrames: 10 }).ok, true);
  });
});

// ---- production render path + probe checks ----

test("es-v04-acceptance: render uses the production lane path and probe mismatches fail the result", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    writeFrames(pkg, { count: 50, start: 420 });
    assert.equal(acceptance.validateFrames(pkg).ok, true);
    lane.STATE.activeJob = null;
    let spawned = null;
    const startInfo = acceptance.startAcceptanceRender(pkg, { spawn: (bin, args) => { spawned = { bin, args }; return fakeChild(); } });
    assert.equal(spawned.bin, "ffmpeg");
    assert.ok(spawned.args.join(" ").includes("frames/*.png"), "must glob the real png frames");
    assert.equal(startInfo.start.fps, 30);
    // simulate the completed production job + a healthy probe
    fs.mkdirSync(path.dirname(lane.renderPath(pkg)), { recursive: true });
    fs.writeFileSync(lane.renderPath(pkg), "fake-mp4-bytes");
    const done = { exit_state: "completed", exit_code: 0, stderr_tail: "" };
    const goodProbe = () => ({ available: true, codec: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920, fps: 30, nb_frames: 50, duration_s: 50 / 30, audio_streams: 0 });
    const ok = acceptance.finalizeRenderResult(pkg, startInfo, done, { probe: goodProbe });
    assert.equal(ok.ok, true, ok.failures.join("; "));
    assert.match(ok.mp4_sha256, /^[0-9a-f]{64}$/);
    assert.match(ok.production_path, /earth-studio-lane\.startRender/);
    // frame-count mismatch must fail
    const shortProbe = () => ({ ...goodProbe(), nb_frames: 49 });
    assert.match(acceptance.finalizeRenderResult(pkg, startInfo, done, { probe: shortProbe }).failures.join("\n"), /frame count 49/);
    // a dirty exit must fail even with a good probe
    const crashed = { exit_state: "failed", exit_code: 1, stderr_tail: "boom" };
    assert.match(acceptance.finalizeRenderResult(pkg, startInfo, crashed, { probe: goodProbe }).failures.join("\n"), /did not complete cleanly/);
    lane.STATE.activeJob = null;
  });
});

test("es-v04-acceptance: render refuses to run without a passing frame validation", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    lane.STATE.activeJob = null;
    assert.throws(() => acceptance.startAcceptanceRender(pkg, { spawn: () => fakeChild() }), /validate-frames first/);
    writeFrames(pkg, { count: 5, start: 0 }); // fails min-frames
    acceptance.validateFrames(pkg);
    assert.throws(() => acceptance.startAcceptanceRender(pkg, { spawn: () => fakeChild() }), /reports failures/);
    lane.STATE.activeJob = null;
  });
});

// ---- hashes + full state machine ----

test("es-v04-acceptance: hashes pin every artifact and the state machine reaches END_TO_END_VERIFIED only with complete evidence", () => {
  withTmpRoot((pkg) => {
    acceptance.generate(pkg);
    fs.writeFileSync(path.join(pkg, acceptance.FILES.observation), JSON.stringify(acceptedObservation()));
    writeFrames(pkg, { count: 50, start: 420 });
    assert.equal(acceptance.validateFrames(pkg).ok, true);
    // craft a passing render result through the real finalize path
    lane.STATE.activeJob = null;
    const startInfo = acceptance.startAcceptanceRender(pkg, { spawn: () => fakeChild() });
    fs.mkdirSync(path.dirname(lane.renderPath(pkg)), { recursive: true });
    fs.writeFileSync(lane.renderPath(pkg), "fake-mp4-bytes");
    const goodProbe = () => ({ available: true, codec: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920, fps: 30, nb_frames: 50, duration_s: 50 / 30, audio_streams: 0 });
    acceptance.finalizeRenderResult(pkg, startInfo, { exit_state: "completed", exit_code: 0, stderr_tail: "" }, { probe: goodProbe });
    lane.STATE.activeJob = null;
    // hashes still missing → import-verified, not end-to-end
    assert.equal(acceptance.computeStatus(pkg).state, "EARTH_STUDIO_IMPORT_VERIFIED");
    const hashed = acceptance.writeHashes(pkg);
    assert.ok(hashed.hashed >= 50 + 6, `expected frames + core artifacts hashed, got ${hashed.hashed}`);
    assert.equal(acceptance.verifyHashes(pkg).ok, true);
    assert.equal(acceptance.computeStatus(pkg).state, "END_TO_END_VERIFIED");
    // tampering any pinned artifact demotes the proof and names the file
    fs.appendFileSync(path.join(pkg, acceptance.FILES.manifest), "\n");
    const tampered = acceptance.verifyHashes(pkg);
    assert.equal(tampered.ok, false);
    assert.match(tampered.mismatches.join(","), /manifest\.json/);
    assert.equal(acceptance.computeStatus(pkg).state, "EARTH_STUDIO_IMPORT_VERIFIED");
    // status writes the report
    acceptance.writeReport(pkg, acceptance.computeStatus(pkg));
    const report = fs.readFileSync(path.join(pkg, acceptance.FILES.report), "utf8");
    assert.match(report, /Internal green is NOT external proof/);
  });
});

// ---- the committed canonical fixture stays healthy and current ----

test("es-v04-acceptance: the committed canonical fixture exists, matches the current generator, and passes all assertions", () => {
  const pkg = acceptance.DEFAULT_PACKAGE_DIR;
  assert.ok(fs.existsSync(path.join(pkg, "earth-studio", "earth-studio.esp")), "canonical acceptance package missing — run generate");
  const manifest = JSON.parse(fs.readFileSync(path.join(pkg, acceptance.FILES.manifest), "utf8"));
  assert.equal(manifest.planner_version, planner.VERSION,
    "acceptance fixture was generated by a different planner version — regenerate it (new acceptance round) so the human imports what the current engine produces");
  const checks = acceptance.runSemanticChecks(pkg);
  assert.equal(checks.ok, true, checks.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; "));
  const status = acceptance.computeStatus(pkg);
  assert.ok(!["INTERNAL_CHECKS_FAILED", "IMPORT_DISCREPANCY_REPORTED", "NOT_GENERATED"].includes(status.state),
    `canonical fixture in failing state: ${status.state} — ${status.detail}`);
});
