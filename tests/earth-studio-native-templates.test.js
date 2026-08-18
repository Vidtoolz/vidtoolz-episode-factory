"use strict";
// Gate 3 native-template tests.
//
// The single most important test in this file is the BYTE-STABILITY gate:
// untemplated plans regenerated with the CURRENT code path must stay
// byte-identical to the frozen v0.9.4 controls
// (controls/v094-byte-control-manifest.json). It must remain green after
// every Gate 3 phase — any diff means template work leaked into the generic
// planner path.
const { assert, fs, path, test } = require("./_helpers.js");
const crypto = require("node:crypto");
const planner = require("../earth-studio-job-planner.js");
const native = require("../earth-studio-native-template-profiles.js");
const inspector = require("../scripts/inspect-earth-studio-project.js");

const ROOT = path.join(__dirname, "..");
const EVIDENCE = path.join(ROOT, "package-runs/2026-08-18-earth-studio-native-templates");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EVIDENCE, "controls/v094-byte-control-manifest.json")));
const shaFile = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const shaStr = (s) => crypto.createHash("sha256").update(Buffer.from(s)).digest("hex");

test("gate3 BYTE-STABILITY: regenerated untemplated plans are byte-identical to the frozen v0.9.4 controls", () => {
  assert.equal(MANIFEST.controls.length, 11, "control manifest entry count");
  // 1) every manifest entry's on-disk file is still byte-frozen
  for (const c of MANIFEST.controls) {
    assert.equal(shaFile(path.join(ROOT, c.path)), c.sha256, `frozen on disk: ${c.path}`);
  }
  // 2) the three v0.9.4 control plans REGENERATE byte-identically from their
  // recorded inputs (job.json description+aspect, shot-plan generated_at)
  // through the current planner code path with NO template request.
  const plans = [...new Set(MANIFEST.controls.filter((c) => !/pinned/.test(c.artifact)).map((c) => c.plan))];
  assert.equal(plans.length, 3, "regenerable control plans");
  for (const plan of plans) {
    const dir = path.join(ROOT, "package-runs", plan, "earth-studio");
    const job = JSON.parse(fs.readFileSync(path.join(dir, "job.json")));
    const generatedAt = JSON.parse(fs.readFileSync(path.join(dir, "shot-plan.json"))).generated_at;
    const artifacts = planner.buildArtifacts(job.jobName, job.description, generatedAt, { aspect: job.aspect });
    for (const artifact of ["earth-studio.esp", "shot-plan.json"]) {
      const expected = MANIFEST.controls.find((c) => c.plan === plan && c.artifact === artifact);
      assert.ok(expected, `${plan}/${artifact} in manifest`);
      assert.equal(shaStr(artifacts[artifact]), expected.sha256, `BYTE IDENTICAL: ${plan}/${artifact}`);
    }
  }
});

test("gate3 provenance: module pins the exact frozen Gate 2 spec", () => {
  assert.equal(native.TEMPLATE_PROFILE_VERSION, "ges-native-derived-v1");
  assert.equal(shaFile(path.join(ROOT, native.GATE2_SPEC_PATH)), native.GATE2_SPEC_SHA256, "Gate 2 spec drifted from the pinned hash");
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, native.GATE2_SPEC_PATH)));
  assert.equal(spec.version, 1);
});

test("gate3 altitude codec: linear and logarithmic round-trips across the working range", () => {
  const points = [-500, 0, 25.5, 500, 1028.3, 20000, 312624, 65117481];
  for (const logarithmic of [false, true]) {
    for (const m of points) {
      const n = native.altitudeMetersToNativeNorm(m, { logarithmic });
      assert.ok(n >= 0 && n <= 1, `norm in [0,1] for ${m}`);
      const back = native.nativeNormToAltitudeMeters(n, { logarithmic });
      assert.ok(Math.abs(back - m) < 1e-6 * Math.max(1, Math.abs(m)), `round-trip ${m} m (log=${logarithmic}) got ${back}`);
    }
  }
  // exact edges
  assert.equal(native.altitudeMetersToNativeNorm(-500), 0);
  assert.equal(native.altitudeMetersToNativeNorm(65117481), 1);
  assert.equal(native.altitudeMetersToNativeNorm(65117481, { logarithmic: true }), 1);
  // out-of-range and junk throw
  assert.throws(() => native.altitudeMetersToNativeNorm(-501), /outside native range/);
  assert.throws(() => native.altitudeMetersToNativeNorm(65117482), /outside native range/);
  assert.throws(() => native.altitudeMetersToNativeNorm(NaN), /not finite/);
  assert.throws(() => native.nativeNormToAltitudeMeters(1.0001), /out of \[0,1\]/);
});

test("gate3 altitude codec: decodes frozen native evidence anchors exactly", () => {
  // zoom-to ref-a (logarithmic model): camera end framing = 1028.3 m (live
  // editor observation), POI ground = ~25.5 m, start = slider max
  assert.ok(Math.abs(native.nativeNormToAltitudeMeters(0.49132400748554, { logarithmic: true }) - 1028.3) < 0.05);
  assert.ok(Math.abs(native.nativeNormToAltitudeMeters(1, { logarithmic: true }) - 65117481) < 1e-6);
  // orbit ref-a (linear model): camera altitude norm from the frozen .esp
  const linearAnchor = native.nativeNormToAltitudeMeters(0.000012991803293164142);
  assert.ok(Math.abs(linearAnchor - (0.000012991803293164142 * 65117981 - 500)) < 1e-9);
  // encoding direction reproduces the frozen norm
  assert.ok(Math.abs(native.altitudeMetersToNativeNorm(1028.3, { logarithmic: true }) - 0.49132400748554) < 1e-6);
});

test("gate3 lon/lat codec: round-trips and matches frozen orbit ref-a normalization", () => {
  for (const lon of [-180, -0.119344, 0, 24.9384, 180]) {
    assert.ok(Math.abs(native.nativeNormToLon(native.lonToNativeNorm(lon)) - lon) < 1e-12, `lon ${lon}`);
  }
  for (const lat of [-90, 0, 51.503077, 90]) {
    assert.ok(Math.abs(native.nativeNormToLat(native.latToNativeNorm(lat)) - lat) < 1e-12, `lat ${lat}`);
  }
  // frozen orbit ref-a longitude norm 0.49966848881254916 = London Eye lon
  assert.ok(Math.abs(native.nativeNormToLon(0.49966848881254916) - -0.11934) < 1e-4);
  assert.throws(() => native.lonToNativeNorm(181), /longitude out of range/);
  assert.throws(() => native.latToNativeNorm(-91), /latitude out of range/);
});

test("gate3 inspector fix: logarithmic-model altitude now decodes to real meters (both models regression)", () => {
  // logarithmic project (zoom-to ref-a): previously decoded to ~32,000 km
  const zoom = inspector.parseEsp(path.join(EVIDENCE, "zoom-to/ref-a/export/VIDTOOLZ-TPL-ZOOM-A.esp"));
  assert.equal(zoom.animation_model.logarithmic, true);
  const alt = zoom.tracks.altitude;
  assert.ok(Math.abs(alt[0].value - 65117481) < 1, `log start ${alt[0].value}`);
  assert.ok(Math.abs(alt[alt.length - 1].value - 1028.3) < 0.5, `log end ${alt[alt.length - 1].value}`);
  assert.ok(Math.abs(zoom.poi.altitude[0].value - 25.5) < 0.5, `log POI alt ${zoom.poi.altitude[0].value}`);
  // linear project (orbit ref-a): decode unchanged by the fix
  const orbit = inspector.parseEsp(path.join(EVIDENCE, "orbit/ref-a/export/VIDTOOLZ-TPL-ORBIT-A.esp"));
  assert.equal(orbit.animation_model.logarithmic, false);
  const expectLinear = 0.000012991803293164142 * 65117981 - 500;
  assert.ok(Math.abs(orbit.tracks.altitude[0].value - expectLinear) < 1e-6, `linear alt ${orbit.tracks.altitude[0].value}`);
  // import shape (VIDTOOLZ planner output): no logarithmic flag -> unchanged
  const plan = planner.buildShotPlan("T", "fly to Helsinki in 5 seconds", "2026-08-08T00:00:00.000Z");
  const os = require("node:os");
  const tmp = path.join(os.tmpdir(), `es-native-inspect-${process.pid}.esp`);
  fs.writeFileSync(tmp, JSON.stringify(planner.buildEsp(plan)));
  const imported = inspector.parseEsp(tmp);
  fs.unlinkSync(tmp);
  assert.equal(imported.shape, "import");
  assert.ok(imported.tracks.altitude.every((k) => Number.isFinite(k.value)));
});
