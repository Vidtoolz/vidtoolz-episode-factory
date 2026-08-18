"use strict";
// Gate 2 derivation-tooling tests. Fixtures are the FROZEN Gate 1 evidence
// corpus; these tests must never modify raw evidence to pass.
const { assert, fs, path, test } = require("./_helpers.js");
const crypto = require("node:crypto");
const tool = require("../scripts/derive-earth-studio-template-motion.js");

const E = tool.EVIDENCE;
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

test("geo math: haversine, bearing, unwrap", () => {
  const eye = { lat: 51.503077, lon: -0.119344 };
  const north400 = { lat: eye.lat + 400 / 111194.9, lon: eye.lon };
  const d = tool.haversineMeters(eye, north400);
  assert.ok(Math.abs(d - 400) < 1.5, `haversine ${d}`);
  assert.ok(Math.abs(tool.initialBearingDeg(eye, north400) - 0) < 0.01);
  const east = { lat: eye.lat, lon: eye.lon + 0.01 };
  assert.ok(Math.abs(tool.initialBearingDeg(eye, east) - 90) < 0.05);
  assert.deepEqual(tool.unwrapDeg([0, -90, -180, -270, 0]), [0, -90, -180, -270, -360]);
  assert.deepEqual(tool.unwrapDeg([90, 180, 270, 0, 90]), [90, 180, 270, 360, 450]);
});

test("frozen raw evidence hashes still match the Gate 1 SHA256SUMS", () => {
  const sums = fs.readFileSync(path.join(E, "SHA256SUMS"), "utf8").trim().split("\n");
  let checked = 0;
  for (const line of sums) {
    const [expected, rel] = line.split(/\s+/);
    if (!rel.endsWith(".esp")) continue;
    assert.equal(sha(path.join(E, rel)), expected, rel);
    checked++;
  }
  assert.ok(checked >= 16, `checked ${checked} raw .esp files`);
});

test("determinism comparison classifies the identical-input repeat as motion-exact", () => {
  const d = tool.determinism(E);
  assert.equal(d.byteIdentical, false);
  assert.equal(d.mismatchedTracks, 0);
  assert.equal(d.maxAbsDelta, 0);
  assert.match(d.classification, /PARAMETER_STABLE|SEMANTICALLY_DETERMINISTIC/);
});

test("topology: normalized times and target-relative geometry (orbit ref-a)", () => {
  const ref = tool.loadReference(path.join(E, "orbit/ref-a"), "orbit/ref-a");
  const t = tool.topology(ref);
  assert.equal(t.frames, 1500);
  assert.deepEqual(t.samples.map((s) => Number(s.t_norm.toFixed(2))), [0, 0.25, 0.5, 0.75, 1]);
  // constant radius, 90-degree azimuth steps (CCW), constant altitude
  const radii = t.samples.map((s) => s.radius_m);
  for (const r of radii) assert.ok(Math.abs(r - radii[0]) < 0.05, "radius constant");
  const az = t.samples.map((s) => s.azimuth_unwrapped_deg);
  for (let i = 1; i < az.length; i++) assert.ok(Math.abs((az[i] - az[i - 1]) + 90) < 0.05, "quarter steps CCW");
  const alts = t.samples.map((s) => s.alt);
  for (const a of alts) assert.equal(a, alts[0]);
});

test("fly-orbit exact native constants: +20000 m altitude and radius+20000 m start distance (R=6378137)", () => {
  const scale = 6378137 / 6371000;
  for (const refName of ["ref-a", "ref-b"]) {
    const ref = tool.loadReference(path.join(E, "fly-to-and-orbit/" + refName), refName);
    const t = tool.topology(ref);
    const start = t.samples[0], entry = t.samples[1];
    assert.ok(Math.abs((start.alt - entry.alt) - 20000) < 0.5, "vertical +20000");
    const startDistES = start.radius_m * scale, entryDistES = entry.radius_m * scale;
    assert.ok(Math.abs((startDistES - entryDistES) - 20000) < 25, `horizontal +20000 got ${startDistES - entryDistES}`);
    assert.equal(Number(entry.t_norm.toFixed(2)), 0.2, "approach ends at t=0.2");
  }
});

test("logarithmic altitude encoding decodes with exponent 15", () => {
  const decode = (n) => -500 + 65117981 * Math.pow(n, 15);
  // anchor: P2P-A hold framing altitude observed as 1028 m in the live editor
  assert.ok(Math.abs(decode(0.49132400748554) - 1028) < 1, String(decode(0.49132400748554)));
  assert.ok(Math.abs(decode(1) - 65117481) < 1e-6);
  assert.ok(Math.abs(decode(0) - -500) < 1e-9);
});

test("spiral value laws: cubic radius and quadratic altitude in angle-fraction", () => {
  const ref = tool.loadReference(path.join(E, "spiral/ref-c"), "spiral/ref-c");
  const t = tool.topology(ref);
  const R0 = t.samples[1].radius_m, // f=0.125 sample exists in 720° ref
    predCubic = (f, start, end) => end + (start - end) * Math.pow(1 - f, 3);
  // ref-c's f=0 keyframe is contaminated (end-state values; see manifest note),
  // so validate the laws against the A-derived start/end constants at the clean
  // independent f=0.125 sample:
  const START = 1997.76, END = 499.44;
  assert.ok(Math.abs(predCubic(0.125, START, END) - R0) < 4, `cubic radius f=0.125 pred ${predCubic(0.125, START, END)} got ${R0}`);
  const altAbove = t.samples[1].alt_above_target_m;
  const A0 = 978.56, A1 = 78.90;
  const predQuad = A1 + (A0 - A1) * Math.pow(1 - 0.125, 2);
  assert.ok(Math.abs(predQuad - altAbove) < 1.5, `quadratic altitude pred ${predQuad} got ${altAbove}`);
});

test("derivation output is deterministic and derivation spec exists", () => {
  const specPath = path.join(E, "derivation/native-template-motion-v1.json");
  const spec = JSON.parse(fs.readFileSync(specPath));
  assert.equal(spec.version, 1);
  for (const id of ["ges_zoom_to_derived_v1", "ges_orbit_derived_v1", "ges_point_to_point_derived_v1", "ges_spiral_derived_v1", "ges_fly_to_and_orbit_derived_v1"]) {
    assert.ok(spec.templates[id], id);
  }
  assert.match(spec.status, /NOT runtime profiles/);
  assert.match(spec.camera_target_serialization.current_vidtoolz_serializer.constraint, /EXPERIMENTAL/);
  // running topology twice yields identical JSON (determinism of tooling)
  const ref = tool.loadReference(path.join(E, "zoom-to/ref-a"), "zoom-to/ref-a");
  assert.equal(JSON.stringify(tool.topology(ref)), JSON.stringify(tool.topology(ref)));
});
