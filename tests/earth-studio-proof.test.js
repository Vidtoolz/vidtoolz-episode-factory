// Tests for the B2 Earth Studio proof evidence checker (read-only).
// Synthetic lane dirs in tmp; the checker must never mutate anything it
// audits — the untouched .esp is the experiment (B2, 2026-07-21).
const { assert, fs, os, path, test } = require("./_helpers.js");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const proof = require("../scripts/verify-earth-studio-proof.js");

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function tmpProofPackage(frameNames = [], jobOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-proof-"));
  const scriptPackages = path.join(root, "aigen", "script-packages");
  const packageId = "es-proof-project";
  const pkg = path.join(scriptPackages, packageId);
  const laneDir = path.join(pkg, "earth-studio");
  fs.mkdirSync(path.join(laneDir, "frames"), { recursive: true });
  fs.mkdirSync(path.join(laneDir, "renders"), { recursive: true });
  fs.writeFileSync(path.join(laneDir, "earth-studio.esp"), JSON.stringify({ name: "Proof", frameRate: 30, duration: 150 }));
  fs.writeFileSync(path.join(laneDir, "shot-plan.json"), "{}\n");
  fs.writeFileSync(path.join(laneDir, "job.json"), JSON.stringify({
    jobName: "Proof", slug: "proof", description: "fly to London in 5 seconds",
    frame_rate: 30, total_frames: 150, total_duration_seconds: 5, unresolved_count: 0,
    created_at: "2026-07-21T00:00:00.000Z",
    ...jobOverrides,
  }));
  for (const name of frameNames) fs.writeFileSync(path.join(laneDir, "frames", name), ONE_PX_PNG);
  return { root, scriptPackages, packageId, pkg, laneDir };
}

function runAudit(pkg, scriptPackages, extra = {}) {
  const prev = process.env.AIGEN_SCRIPT_PACKAGES;
  process.env.AIGEN_SCRIPT_PACKAGES = scriptPackages;
  try {
    return proof.audit({
      packageDir: pkg, packageId: null,
      expectedFrames: null, expectedFps: null, expectedDuration: null,
      staged: null, stageRoot: path.join(scriptPackages, "..", "stage-sandbox"),
      json: false, requireComplete: false,
      ...extra,
    });
  } finally {
    if (prev === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES;
    else process.env.AIGEN_SCRIPT_PACKAGES = prev;
  }
}

test("es-proof: baseline passes with PENDING phases before the manual export (not-run-yet is not failure)", () => {
  const { root, scriptPackages, pkg, laneDir } = tmpProofPackage();
  const out = runAudit(pkg, scriptPackages);
  assert.deepEqual(out.failures, []);
  assert.equal(out.phases.baseline, "ok");
  assert.equal(out.phases.frames, "pending");
  assert.equal(out.phases.mp4, "pending");
  assert.equal(out.phases.staged, "pending");
  assert.equal(out.result.esp.sha256, sha256(fs.readFileSync(path.join(laneDir, "earth-studio.esp"))));
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: --require-complete turns pending mandatory evidence into failures", () => {
  const { root, scriptPackages, pkg } = tmpProofPackage();
  const out = runAudit(pkg, scriptPackages, { requireComplete: true });
  assert.equal(out.failures.length, 3);
  assert.ok(out.failures.every((f) => /mandatory evidence missing/.test(f)));
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: the audit never modifies the .esp or the frames (read-only proof)", () => {
  const names = ["frame_000.png", "frame_001.png", "frame_002.png"];
  const { root, scriptPackages, pkg, laneDir } = tmpProofPackage(names);
  const espPath = path.join(laneDir, "earth-studio.esp");
  const before = { sha: sha256(fs.readFileSync(espPath)), mtime: fs.statSync(espPath).mtimeMs };
  const frameBefore = sha256(fs.readFileSync(path.join(laneDir, "frames", names[0])));
  runAudit(pkg, scriptPackages, { expectedFrames: 3 });
  assert.equal(sha256(fs.readFileSync(espPath)), before.sha);
  assert.equal(fs.statSync(espPath).mtimeMs, before.mtime);
  assert.equal(sha256(fs.readFileSync(path.join(laneDir, "frames", names[0]))), frameBefore);
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: continuous export passes; count/first/last/dimensions reported", () => {
  const names = ["f_000.png", "f_001.png", "f_002.png", "f_003.png"];
  const { root, scriptPackages, pkg } = tmpProofPackage(names, { frame_rate: 2, total_frames: 4, total_duration_seconds: 2 });
  const out = runAudit(pkg, scriptPackages, { expectedFrames: 4 });
  assert.deepEqual(out.failures, []);
  assert.equal(out.phases.frames, "ok");
  assert.equal(out.result.frames.count, 4);
  assert.equal(out.result.frames.first, "f_000.png");
  assert.equal(out.result.frames.last, "f_003.png");
  assert.deepEqual(out.result.frames.dimensions, ["1x1"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: gaps and duplicate frame numbers are contradictions", () => {
  const { root, scriptPackages, pkg } = tmpProofPackage(["f_000.png", "f_001.png", "f_003.png", "img_003.png"]);
  const out = runAudit(pkg, scriptPackages);
  assert.ok(out.failures.some((f) => /gaps in frame sequence/.test(f) && /2/.test(f)), `missing #2 not flagged: ${out.failures}`);
  assert.ok(out.failures.some((f) => /duplicate frame numbers/.test(f)), `duplicate #3 not flagged: ${out.failures}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: frame count mismatch against expectation fails", () => {
  const { root, scriptPackages, pkg } = tmpProofPackage(["f_000.png", "f_001.png"]);
  const out = runAudit(pkg, scriptPackages, { expectedFrames: 150 });
  assert.ok(out.failures.some((f) => /found 2, expected 150/.test(f)));
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: mixed frame extensions fail because the render lane globs a single extension", () => {
  const { root, scriptPackages, pkg, laneDir } = tmpProofPackage(["f_000.png", "f_001.png"]);
  fs.writeFileSync(path.join(laneDir, "frames", "f_002.jpg"), ONE_PX_PNG);
  const out = runAudit(pkg, scriptPackages);
  assert.ok(out.failures.some((f) => /mixed extensions/.test(f) && /glob/.test(f)), String(out.failures));
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: symlinked frames are refused, not followed", () => {
  const { root, scriptPackages, pkg, laneDir } = tmpProofPackage(["f_000.png"]);
  const outside = path.join(root, "outside.png");
  fs.writeFileSync(outside, ONE_PX_PNG);
  fs.symlinkSync(outside, path.join(laneDir, "frames", "f_001.png"));
  const out = runAudit(pkg, scriptPackages);
  assert.ok(out.failures.some((f) => /symlink/.test(f)), String(out.failures));
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: package dirs outside the allowed roots are refused with a usage error", () => {
  const { root, scriptPackages } = tmpProofPackage();
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), "es-foreign-"));
  fs.mkdirSync(path.join(foreign, "earth-studio"), { recursive: true });
  const prev = process.env.AIGEN_SCRIPT_PACKAGES;
  process.env.AIGEN_SCRIPT_PACKAGES = scriptPackages;
  try {
    assert.throws(() => proof.audit({
      packageDir: foreign, packageId: null,
      expectedFrames: null, expectedFps: null, expectedDuration: null,
      staged: null, stageRoot: path.join(root, "stage"), json: false, requireComplete: false,
    }), /outside allowed roots/);
  } finally {
    if (prev === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES;
    else process.env.AIGEN_SCRIPT_PACKAGES = prev;
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(foreign, { recursive: true, force: true });
});

test("es-proof: staged copy must be byte-identical to the local MP4 and inside the stage root", () => {
  const { root, scriptPackages, pkg, laneDir } = tmpProofPackage(["f_000.png"], { frame_rate: 1, total_frames: 1, total_duration_seconds: 1 });
  const mp4 = path.join(laneDir, "renders", "proof.mp4");
  fs.writeFileSync(mp4, "fake-mp4-bytes");
  const stageRoot = path.join(root, "stage-sandbox");
  fs.mkdirSync(stageRoot, { recursive: true });
  const stagedGood = path.join(stageRoot, "es-proof-project-proof.mp4");
  fs.writeFileSync(stagedGood, "fake-mp4-bytes");
  let out = runAudit(pkg, scriptPackages, { stageRoot });
  assert.equal(out.phases.staged, "ok");
  assert.deepEqual(out.failures, []);
  assert.ok(out.warnings.some((w) => /ffprobe/.test(w)), "fake mp4 must degrade to a warning, not a pass claim");

  fs.writeFileSync(stagedGood, "DIFFERENT-bytes");
  out = runAudit(pkg, scriptPackages, { stageRoot });
  assert.ok(out.failures.some((f) => /byte-identical/.test(f)), String(out.failures));

  // A staged file outside the stage root is a containment failure.
  const rogue = path.join(root, "rogue.mp4");
  fs.writeFileSync(rogue, "fake-mp4-bytes");
  out = runAudit(pkg, scriptPackages, { stageRoot, staged: rogue });
  assert.ok(out.failures.some((f) => /inside the sandbox stage root/.test(f)), String(out.failures));
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: an approved-media staged path is refused (same guard as the lane)", () => {
  const { root, scriptPackages, pkg, laneDir } = tmpProofPackage();
  fs.writeFileSync(path.join(laneDir, "renders", "proof.mp4"), "x");
  const approvedRoot = path.join(root, "v1-approved");
  fs.mkdirSync(approvedRoot, { recursive: true });
  const staged = path.join(approvedRoot, "es-proof-project-proof.mp4");
  fs.writeFileSync(staged, "x");
  const out = runAudit(pkg, scriptPackages, { stageRoot: approvedRoot, staged });
  assert.ok(out.failures.some((f) => /not approved media/.test(f)), String(out.failures));
  assert.match("v1-approved/x.mp4", proof.APPROVED_MEDIA_PATTERN);
  fs.rmSync(root, { recursive: true, force: true });
});

test("es-proof: image header probes read PNG and JPEG dimensions without external tools", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "es-dims-"));
  const png = path.join(dir, "a.png");
  fs.writeFileSync(png, ONE_PX_PNG);
  assert.deepEqual(proof.imageDimensions(png), { width: 1, height: 1 });
  // Minimal JPEG: SOI + SOF0 declaring 1920x1080.
  const jpg = path.join(dir, "b.jpg");
  fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x00]));
  assert.deepEqual(proof.imageDimensions(jpg), { height: 1080, width: 1920 });
  assert.equal(proof.trailingNumber("earth_studio_0042.jpeg"), 42);
  assert.equal(proof.trailingNumber("no-number.png"), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("es-proof: CLI exits 0 on the real London candidate baseline and 2 on usage errors", () => {
  const script = path.join(__dirname, "..", "scripts", "verify-earth-studio-proof.js");
  const london = path.join(__dirname, "..", "package-runs", "2026-06-27-london-proof");
  if (fs.existsSync(london)) {
    const ok = childProcess.spawnSync("node", [script, "--package-dir", london, "--expected-frames", "210", "--expected-fps", "30", "--expected-duration", "7", "--json"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const parsed = JSON.parse(ok.stdout);
    assert.equal(parsed.esp.bytes, 7480);
    assert.equal(parsed.phases.baseline, "ok");
    // The pinned experiment artifact: the supervised run must import THIS file.
    assert.equal(parsed.esp.sha256, "33eab695b82e60fefd6d52aa8c06ddcd630aa92c3d10a9aba9a0433eed9d58d6");
  }
  const bad = childProcess.spawnSync("node", [script, "--nope"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});

test("es-proof: checker script declares READ-ONLY and contains no filesystem write calls", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify-earth-studio-proof.js"), "utf8");
  assert.ok(text.includes("VIDTOOLZ script safety"));
  assert.match(text, /Read\/write behavior:\s*READ-ONLY/);
  const forbiddenWriteCall = /\b(?:fs\.)?(?:writeFileSync|appendFileSync|rmSync|renameSync|unlinkSync|mkdirSync|copyFileSync|createWriteStream)\s*\(/g;
  assert.deepEqual(text.match(forbiddenWriteCall) || [], []);
});
