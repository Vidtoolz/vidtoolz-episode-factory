// Antimeridian PHYSICAL EQUIVALENCE (2026-09-03, oracle v2 contract).
//
// The .esp longitude track is the continuous scalar the camera state machine
// authored: it runs past ±180° across the antimeridian instead of being wrapped
// and spliced with a one-frame "+180 / -180" seam pair. Earth Studio imports
// longitude beyond ±180° and plays the longitude-translated non-seam trajectory
// (authenticated import readback, oracle v2 real-import evidence). The old pair
// was serializer scaffolding: it pinned two rendered frames onto the meridian
// (266–568 m off the authored ring at 60°N / 80 km), claimed the opening key's
// easing (HARD_START) and left interpolated headings aimed at positions Earth
// Studio no longer rendered.
//
// Contract: at every rendered integer frame a seam trajectory equals the same
// authored trajectory translated away from the seam (≤ 0.2 m, altitude included),
// with identical key topology, easing and target-residual profile; authored
// camera states keep strict camera→subject bearing precision; public
// coordinates stay canonically wrapped. Everything is judged on the FINAL .esp
// through the repository's Earth Studio playback evaluator.
const { assert, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const continuity = require("../earth-studio-motion-continuity.js");
const quality = require("../earth-studio-camera-quality.js");

const POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" };
const R = 6371000; const DEG = Math.PI / 180;
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const precisionDeg = (radiusM) => (Math.atan2(0.2, radiusM) * 180) / Math.PI + 0.000001;
function haversine(a, b) {
  const p1 = a.latitude * DEG; const p2 = b.latitude * DEG; const dl = wrap180(b.longitude - a.longitude) * DEG;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
const cameraDistance = (a, b) => Math.hypot(haversine(a, b), a.altitude - b.altitude);

function serialized(description, extra = {}) {
  const options = { aspect: "16:9", motionPolicy: POLICY, ...extra };
  const artifacts = planner.buildArtifacts("pe", description, "2026-09-03T00:00:00.000Z", options);
  const plan = JSON.parse(artifacts["shot-plan.json"]); const esp = JSON.parse(artifacts["earth-studio.esp"]);
  return { plan, esp, tracks: continuity.extractEspCameraTracks(esp), options, final: planner.finalCameraState(plan, options) };
}
const N = (b) => b.plan.total_frames;
function sample(b, frame) {
  const at = (keys) => continuity.playbackValueAt(keys, frame / N(b));
  return { latitude: at(b.tracks.lat), longitude: at(b.tracks.lng), altitude: at(b.tracks.alt), pan: at(b.tracks.pan), tilt: at(b.tracks.tilt) };
}
const orbitOf = (b) => b.plan.segments.find((s) => s.action === "orbit" && s.location);
const topology = (b) => Object.fromEntries(Object.entries(b.tracks).map(([k, keys]) => [k, keys.map((key) => ({ time: key.time, in: key.transitionIn || null, out: key.transitionOut || null }))]));

// Seam case vs its translated twin: physical equivalence, topology, easing, residual profile.
function assertTwinEquivalent(label, seam, twin, shiftDeg) {
  assert.equal(N(seam), N(twin), `${label}: frame count`);
  assert.deepEqual(topology(seam), topology(twin), `${label}: key timestamps and easing equal the translated twin on every track`);
  const seamOrbit = orbitOf(seam); const twinOrbit = orbitOf(twin);
  let maxPhysical = 0; let maxResidualDelta = 0;
  for (let f = 0; f < N(seam); f += 1) {
    const a = sample(seam, f); const b = sample(twin, f);
    assert.ok([a, b].every((c) => Object.values(c).every(Number.isFinite)), `${label}: finite at frame ${f}`);
    maxPhysical = Math.max(maxPhysical, cameraDistance(a, { ...b, longitude: b.longitude + shiftDeg }));
    if (seamOrbit && f >= seamOrbit.start_frame && f < seamOrbit.end_frame) {
      const ra = wrap180(a.pan - continuity.initialBearing(a, seamOrbit.location));
      const rb = wrap180(b.pan - continuity.initialBearing(b, twinOrbit.location));
      maxResidualDelta = Math.max(maxResidualDelta, Math.abs(wrap180(ra - rb)));
    }
  }
  assert.ok(maxPhysical <= 0.2, `${label}: rendered camera differs from the translated twin by ${maxPhysical} m`);
  if (seamOrbit) {
    const radius = planner.orbitRadiusMeters(seamOrbit.altitude_m, seamOrbit.tilt_deg);
    if (radius > 0.2) assert.ok(maxResidualDelta <= precisionDeg(radius), `${label}: seam-specific target residual ${maxResidualDelta}°`);
  }
  return { maxPhysical, maxResidualDelta };
}
// Strict camera→subject precision at every authored pan key of the orbit sweep.
function assertAuthoredHeading(label, b) {
  const orbit = orbitOf(b); const radius = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  if (!(radius > 0.2)) return;
  const keys = b.tracks.pan.filter((k) => { const f = Math.round(k.time * N(b)); return f >= orbit.start_frame && f <= orbit.end_frame; });
  let onRing = false;
  for (const k of keys) {
    const f = Math.round(k.time * N(b)); const cam = sample(b, f); const r = haversine(cam, orbit.location);
    if (!onRing) onRing = Math.abs(r - radius) <= 0.2;
    if (!onRing) continue;
    const err = Math.abs(wrap180(cam.pan - continuity.initialBearing(cam, orbit.location)));
    assert.ok(err <= precisionDeg(r), `${label}: authored key ${f} heading error ${err}° > ${precisionDeg(r)}°`);
  }
}
// Commanded sweep = pan change between the first authored key ON the ring (after any
// acquisition) and the last key of the orbit — the oracle's definition.
const panSweep = (b) => {
  const o = orbitOf(b); const radius = planner.orbitRadiusMeters(o.altitude_m, o.tilt_deg);
  const p = b.tracks.pan.filter((k) => { const f = Math.round(k.time * N(b)); return f >= o.start_frame && f <= o.end_frame; });
  const first = radius > 0.2 ? p.findIndex((k) => Math.abs(haversine(sample(b, Math.round(k.time * N(b))), o.location) - radius) <= 0.2) : 0;
  return p[p.length - 1].value - p[Math.max(0, first)].value;
};
const maxPanStep = (b) => Math.max(...b.tracks.pan.slice(1).map((k, i) => Math.abs(k.value - b.tracks.pan[i].value)));

const CASES = [
  ["east+west seam ring cw (opening on the seam)", "orbit 60, 179.99 once clockwise at 200000m tilted 30 degrees for 20 seconds", "orbit 60, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds", 159.99, 360],
  ["seam ring ccw", "orbit 60, -179.99 once counterclockwise at 200000m tilted 30 degrees for 20 seconds", "orbit 60, 20 once counterclockwise at 200000m tilted 30 degrees for 20 seconds", -199.99, -360],
  ["exact +180 start", "orbit 60, 180 once clockwise at 200000m tilted 30 degrees for 20 seconds", "orbit 60, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds", 160, 360],
  ["exact -180 start", "orbit 60, -180 once counterclockwise at 200000m tilted 30 degrees for 20 seconds", "orbit 60, 20 once counterclockwise at 200000m tilted 30 degrees for 20 seconds", -200, -360],
  ["half cw", "orbit 60, 179.99 half clockwise at 200000m tilted 30 degrees for 20 seconds", "orbit 60, 20 half clockwise at 200000m tilted 30 degrees for 20 seconds", 159.99, 180],
  ["twice cw", "orbit 60, 179.99 twice clockwise at 200000m tilted 30 degrees for 40 seconds", "orbit 60, 20 twice clockwise at 200000m tilted 30 degrees for 40 seconds", 159.99, 720],
  ["twice ccw", "orbit 60, -179.99 twice counterclockwise at 200000m tilted 30 degrees for 40 seconds", "orbit 60, 20 twice counterclockwise at 200000m tilted 30 degrees for 40 seconds", -199.99, -720],
  ["85N seam", "orbit 85, 179.99 once clockwise at 200000m tilted 30 degrees for 20 seconds", "orbit 85, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds", 159.99, 360],
  ["89N seam", "orbit 89, 179.99 once clockwise at 20000m tilted 60 degrees for 20 seconds", "orbit 89, 20 once clockwise at 20000m tilted 60 degrees for 20 seconds", 159.99, 360],
  ["short radius", "orbit 60, 179.99 once clockwise at 3000m tilted 45 degrees for 20 seconds", "orbit 60, 20 once clockwise at 3000m tilted 45 degrees for 20 seconds", 159.99, 360],
  ["fly→orbit acquisition across the seam", "fly to 60, 179.4 at 200000m tilted 30 degrees for 5 seconds then orbit 60, 179.99 once clockwise at 200000m tilted 30 degrees for 20 seconds", "fly to 60, 19.41 at 200000m tilted 30 degrees for 5 seconds then orbit 60, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds", 159.99, 360],
];

test("physical equivalence: every seam case renders as its longitude-translated twin (≤ 0.2 m, same topology, same easing, same residual profile)", () => {
  for (const [label, seamDesc, twinDesc, shift, sweep] of CASES) {
    const seam = serialized(seamDesc); const twin = serialized(twinDesc);
    assertTwinEquivalent(label, seam, twin, shift);
    assertAuthoredHeading(label, seam);
    assert.ok(Math.abs(panSweep(seam) - sweep) < 1e-6, `${label}: commanded sweep ${panSweep(seam)} vs ${sweep}`);
    assert.ok(maxPanStep(seam) < 180, `${label}: no uncommanded pan representative jump`);
    // The .esp longitude is continuous: it carries values past ±180 and no serializer-pinned ±180 key.
    assert.ok(seam.tracks.lng.some((k) => Math.abs(k.value) > 180), `${label}: continuous longitude runs past ±180`);
    assert.equal(seam.tracks.lng.some((k) => Math.abs(k.value) === 180 && !twin.tracks.lng.some((t) => t.time === k.time)), false, `${label}: no serializer-created ±180 key`);
  }
});

test("physical equivalence: the hostile frames (opening 0/1/2, interior 298/299/300) sit on the authored ring", () => {
  const seam = serialized("orbit 60, 179.99 once clockwise at 200000m tilted 30 degrees for 20 seconds");
  const twin = serialized("orbit 60, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds");
  for (const f of [0, 1, 2, 298, 299, 300]) {
    const a = sample(seam, f); const b = sample(twin, f);
    assert.ok(cameraDistance(a, { ...b, longitude: b.longitude + 159.99 }) <= 0.2, `frame ${f}`);
  }
  // No opening HARD_START: the opening key keeps its authored departure easing.
  const report = quality.evaluate({ plan: seam.plan, esp: seam.esp });
  assert.equal(report.smoothness.defects.some((d) => d.defect_class === "HARD_START"), false, report.errors.join(" | "));
  // Heading-speed findings are identical for seam and twin: nothing to suppress.
  const twinReport = quality.evaluate({ plan: twin.plan, esp: twin.esp });
  const heads = (r) => r.smoothness.defects.filter((d) => ["HEADING_REVERSAL", "HEADING_SPEED_PULSE"].includes(d.defect_class)).map((d) => d.defect_class);
  assert.deepEqual(heads(report), heads(twinReport));
});

test("physical equivalence: pole-enclosing ring — finite, physical revolution, target-facing pan, opening at ring bearing 0", () => {
  const b = serialized("orbit 89.9, 179.99 once clockwise at 20000m tilted 60 degrees for 20 seconds"); const orbit = orbitOf(b);
  const radius = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  assert.ok(Object.values(b.tracks).every((keys) => keys.every((k) => Number.isFinite(k.value))));
  // Ring bearing (subject → camera) accumulates one physical revolution; target-facing pan has ~0 winding.
  const bearings = b.tracks.lat.map((k) => Math.round(k.time * N(b))).map((f) => continuity.initialBearing(orbit.location, sample(b, f)));
  const unwrapped = continuity.unwrapDegrees(bearings);
  assert.ok(Math.abs(Math.abs(unwrapped[unwrapped.length - 1] - unwrapped[0]) - 360) < 0.001, "position completes one revolution");
  assert.ok(Math.abs(panSweep(b)) < 1e-6, `pan winding ${panSweep(b)}`);
  // Opening sits at ring bearing 0 (due north of the subject, across the pole).
  const opening = planner.offsetPoint(orbit.location, 0, radius);
  assert.ok(haversine(sample(b, 0), opening) <= 0.2, `opening ${haversine(sample(b, 0), opening)} m from ring bearing 0`);
  assertAuthoredHeading("pole-enclosing", b);
  assert.ok(maxPanStep(b) < 180);
});

test("physical equivalence: zero-radius spin keeps its authored 360° sweep and stays on the subject", () => {
  const b = serialized("orbit 60, 179.99 once clockwise at 6500m tilted 0 degrees for 20 seconds");
  assert.ok(Math.abs(panSweep(b) - 360) < 1e-6);
  const orbit = orbitOf(b);
  for (let f = 0; f < N(b); f += 25) assert.ok(haversine(sample(b, f), orbit.location) < 0.2);
});

test("physical equivalence: seeded continuation across the seam inherits the physical camera and needs no seam-specific acquisition", () => {
  const seed = { latitude: 45.2, longitude: 179.9, altitude_m: 20000, pan_deg: 100, tilt_deg: 60 };
  const seam = serialized("orbit 45, -179.9 once clockwise at 20000m tilted 60 degrees for 20 seconds", { initialCamera: seed });
  const twin = serialized("orbit 45, 20.1 once clockwise at 20000m tilted 60 degrees for 20 seconds", { initialCamera: { ...seed, longitude: 19.9 } });
  assertTwinEquivalent("seeded continuation", seam, twin, -200);
  assert.ok(maxPanStep(seam) < 180);
  // Journey A → B across the seam: B opens on A's physical final camera; public coordinates stay wrapped.
  const a = serialized("hover over 45, 179 for 1 seconds then fly to 45, 179.95 for 6 seconds");
  assert.ok(a.final.longitude >= -180 && a.final.longitude <= 180 && Math.abs(a.final.longitude - 179.95) < 1e-6);
  const b = serialized("orbit 45, -179.95 once clockwise tilted 60 degrees for 12 seconds", { initialCamera: a.final });
  assert.equal(b.tracks.lng[0].value, a.final.longitude); assert.equal(b.tracks.lat[0].value, a.final.latitude);
  assert.ok(b.plan.initial_camera.longitude >= -180 && b.plan.initial_camera.longitude <= 180);
  assert.ok(b.final.longitude >= -180 && b.final.longitude <= 180);
  assert.ok(maxPanStep(b) < 180);
});

test("physical equivalence: public coordinates stay canonical while the .esp longitude is continuous", () => {
  const b = serialized("hover over Tokyo for 2 seconds then fly to Los Angeles for 20 seconds then orbit Los Angeles once clockwise tilted 60 degrees for 20 seconds");
  assert.ok(b.tracks.lng.some((k) => k.value > 180), "the .esp carries the continuous eastward crossing");
  assert.ok(b.final.longitude >= -180 && b.final.longitude <= 180 && Math.abs(b.final.longitude - (-118.2437)) < 0.3);
  for (const seg of b.plan.segments.filter((s) => s.location)) assert.ok(seg.location.longitude >= -180 && seg.location.longitude <= 180);
  // Normalized .esp longitude decodes back exactly through minValueRange.
  const leaf = (function find(node) { if (!node || typeof node !== "object") return null; if (node.type === "longitude" && Array.isArray(node.keyframes)) return node; for (const v of Object.values(node)) { const r = Array.isArray(v) ? v.map(find).find(Boolean) : find(v); if (r) return r; } return null; }(b.esp));
  const min = leaf.value.minValueRange;
  leaf.keyframes.forEach((k, i) => assert.ok(Math.abs(k.value * (180 - min) + min - b.tracks.lng[i].value) < 1e-6));
});
