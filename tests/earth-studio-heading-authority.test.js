// Orbit heading authority (2026-09-03).
//
// For a targeted orbit the camera looks at its declared subject: pan at every
// authoritative orbit camera state is the SPHERICAL initial bearing from the
// camera to the subject, expressed continuously with the preceding pan. Until
// this repair pan was `ring bearing + 180` — the reverse of the geodesic's
// azimuth AT THE SUBJECT, which on a sphere misses the subject by
// ≈ (r/R)·tan(lat)·|sin θ| (1.25° at 60°N / 80 km, 8.25° at 85°N, 18° at 89°N)
// and points away from it on a ring that encloses a pole. Ring position is
// geometric state, never pan − 180, so positions, timing, easing and key sets
// do not move when pan is corrected; a zero-radius spin keeps its authored
// sweep; acquisition and sweep share one continuous pan representative.
//
// Reference geometry is independent of the planner (motion-continuity's
// spherical bearing) and the allowance is the six-decimal serialization
// precision atan2(0.2 m, r) + 1e-6°, not a framing tolerance.
const { assert, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const continuity = require("../earth-studio-motion-continuity.js");

const POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" };
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const precisionDeg = (radiusM) => (Math.atan2(0.2, radiusM) * 180) / Math.PI + 0.000001;

function build(description, extra = {}) {
  const options = { aspect: "16:9", motionPolicy: POLICY, ...extra };
  const plan = planner.buildShotPlan("hdg", description, "2026-09-03T00:00:00.000Z", options);
  const tracks = planner.buildEspKeyframes(plan, options);
  const final = planner.finalCameraState(plan, options);
  return { plan, tracks, final, options };
}
const unwrapLng = (lng) => { const vals = continuity.unwrapDegrees(lng.map((k) => k.value)); return lng.map((k, i) => ({ time: k.time, value: vals[i] })); };
function valueAt(keys, time) {
  if (time <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i += 1) if (time <= keys[i].time) { const a = keys[i - 1]; const b = keys[i]; return a.value + (b.value - a.value) * ((time - a.time) / (b.time - a.time)); }
  return keys[keys.length - 1].value;
}
// Keyframe heading error over an orbit's sweep (from 40 % of the segment, as the oracle does).
function headingErrors({ plan, tracks }, orbit, fromFraction = 0.4) {
  const lng = unwrapLng(tracks.lng); const lat = tracks.lat; const pan = tracks.pan;
  const from = orbit.start_frame + (orbit.end_frame - orbit.start_frame) * fromFraction;
  // Authoritative camera states are the authored PAN keys (co-sampled with
  // position). A longitude seam pair adds one serialization-only frame where
  // the rendered longitude is pinned on the ±180 meridian and no pan key can
  // exist; that frame is measured separately by pairResidual().
  const times = [...new Set(pan.map((k) => k.time))].filter((t) => t >= from - 1e-9 && t <= orbit.end_frame + 1e-9).sort((a, b) => a - b);
  return times.map((t) => {
    const camera = { latitude: valueAt(lat, t), longitude: valueAt(lng, t) };
    const radius = continuity.haversineMeters(camera, orbit.location);
    return { t, radius, error: Math.abs(wrap180(valueAt(pan, t) - continuity.initialBearing(camera, orbit.location))) };
  }).filter((r) => r.radius > 0.2);
}
const orbitOf = (b) => b.plan.segments.find((s) => s.action === "orbit" && s.location);
function pairResidual({ tracks }, orbit) {
  const lng = unwrapLng(tracks.lng); const lat = tracks.lat; const pan = tracks.pan; const panTimes = new Set(pan.map((k) => k.time));
  const frames = tracks.lng.filter((k) => Math.abs(k.value) === 180 && !panTimes.has(k.time) && k.time >= orbit.start_frame && k.time <= orbit.end_frame).map((k) => k.time);
  return frames.map((t) => { const camera = { latitude: valueAt(lat, t), longitude: valueAt(lng, t) }; return Math.abs(wrap180(valueAt(pan, t) - continuity.initialBearing(camera, orbit.location))); });
}
const panSweep = (b, orbit) => { const p = b.tracks.pan.filter((k) => k.time >= orbit.start_frame && k.time <= orbit.end_frame); return p[p.length - 1].value - p[0].value; };
const maxStep = (keys) => Math.max(...keys.slice(1).map((k, i) => Math.abs(k.value - keys[i].value)));

test("heading authority: aimHeading-driven rings face the subject at every keyframe (60°N/80 km, 85°N/80 km, 89°N/35 km, local rings)", () => {
  for (const [label, desc] of [
    ["60N 80km", "orbit 60, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds"],
    ["85N 80km", "orbit 85, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds"],
    ["89N 35km", "orbit 89, 20 once clockwise at 20000m tilted 60 degrees for 20 seconds"],
    ["equator 1km", "orbit 0, 20 once clockwise at 1000m tilted 45 degrees for 20 seconds"],
    ["Helsinki default", "orbit Helsinki once clockwise at 6500m tilted 60 degrees for 20 seconds"],
    ["slow 65N", "orbit 65, 20 once clockwise at 200000m tilted 30 degrees for 120 seconds"],
  ]) {
    const b = build(desc); const orbit = orbitOf(b);
    const radius = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
    const rows = headingErrors(b, orbit); const worst = Math.max(...rows.map((r) => r.error));
    assert.ok(worst <= precisionDeg(radius), `${label}: worst keyframe heading error ${worst}° > ${precisionDeg(radius)}°`);
    assert.ok(b.tracks.pan.every((k) => Number.isFinite(k.value)));
  }
});

test("heading authority: commanded revolutions and direction survive (+180, ±360, ±720) with no uncommanded pan step", () => {
  for (const [desc, sweep] of [
    ["orbit 60, 20 half clockwise at 200000m tilted 30 degrees for 20 seconds", 180],
    ["orbit 60, 20 once counterclockwise at 200000m tilted 30 degrees for 20 seconds", -360],
    ["orbit 60, 20 twice clockwise at 200000m tilted 30 degrees for 40 seconds", 720],
    ["orbit 60, 20 twice counterclockwise at 200000m tilted 30 degrees for 40 seconds", -720],
  ]) {
    const b = build(desc); const orbit = orbitOf(b);
    assert.ok(Math.abs(panSweep(b, orbit) - sweep) < 0.05, `${desc}: pan sweep ${panSweep(b, orbit)}`);
    assert.ok(maxStep(b.tracks.pan) < 15, `${desc}: pan step ${maxStep(b.tracks.pan)}`);
    const worst = Math.max(...headingErrors(b, orbit).map((r) => r.error));
    assert.ok(worst <= precisionDeg(80000), `${desc}: ${worst}`);
  }
});

test("heading authority: seam-centred ring is representation-independent and continuous", () => {
  const seam = build("orbit 60, 179.99 once clockwise at 200000m tilted 30 degrees for 20 seconds");
  const control = build("orbit 60, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds");
  const orbit = orbitOf(seam);
  const worst = Math.max(...headingErrors(seam, orbit).map((r) => r.error));
  assert.ok(worst <= precisionDeg(80000), `seam ring worst authored-key heading error ${worst}°`);
  // Continuous longitude export (2026-09-03): no serializer seam pair exists, so
  // the seam ring is the off-seam twin translated by 159.99° — same key frames on
  // every track, same pan values, exact commanded sweep.
  assert.equal(pairResidual(seam, orbit).length, 0, "no serializer-created seam frames");
  assert.ok(maxStep(seam.tracks.pan) < 15);
  assert.ok(Math.abs(panSweep(seam, orbit) - 360) < 1e-6, `seam sweep ${panSweep(seam, orbit)}`);
  assert.deepEqual(seam.tracks.pan.map((k) => k.time), control.tracks.pan.map((k) => k.time), "same pan key frames as the off-seam twin");
  assert.deepEqual(seam.tracks.lng.map((k) => k.time), control.tracks.lng.map((k) => k.time), "same longitude key frames as the off-seam twin");
  seam.tracks.pan.forEach((k, i) => assert.ok(Math.abs(k.value - control.tracks.pan[i].value) < 1e-6, `pan value at ${k.time}`));
});

test("heading authority: a zero-radius declared spin keeps its authored pan sweep", () => {
  const b = build("orbit 60, 20 once clockwise at 6500m tilted 0 degrees for 20 seconds"); const orbit = orbitOf(b);
  assert.equal(planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg), 0);
  assert.ok(Math.abs(panSweep(b, orbit) - 360) < 1e-9, `spin sweep ${panSweep(b, orbit)}`);
  const lats = new Set(b.tracks.lat.map((k) => k.value)); const lngs = new Set(b.tracks.lng.map((k) => k.value));
  assert.ok(lats.size === 1 && lngs.size === 1, "the camera never leaves the subject");
  // Legacy freeform sweep too (2-key pan): still a full authored turn.
  const legacy = build("orbit 60, 20 once clockwise at 6500m tilted 0 degrees for 20 seconds", { motionPolicy: null });
  const p = legacy.tracks.pan; assert.ok(Math.abs(p[p.length - 1].value - p[0].value - 360) < 1e-9);
});

test("heading authority: pole-enclosing ring and exact-pole subject — finite, target-facing, no artificial winding", () => {
  const enclosing = build("orbit 89.9, 179.99 once clockwise at 20000m tilted 60 degrees for 20 seconds"); const o1 = orbitOf(enclosing);
  assert.ok(enclosing.tracks.pan.every((k) => Number.isFinite(k.value)));
  assert.ok(Math.max(...headingErrors(enclosing, o1).map((r) => r.error)) <= precisionDeg(34641), "faces the subject on a ring around the pole");
  assert.ok(maxStep(enclosing.tracks.pan) < 60, `no flip: max pan step ${maxStep(enclosing.tracks.pan)}`);
  assert.ok(Math.abs(panSweep(enclosing, o1)) < 180, `target-facing pan has no full winding on a pole-enclosing ring: ${panSweep(enclosing, o1)}`);
  // Position, not pan, proves the revolution.
  const lng = unwrapLng(enclosing.tracks.lng.filter((k) => k.time >= o1.start_frame));
  assert.ok(Math.abs(lng[lng.length - 1].value - lng[0].value) > 300, "position circles the pole");
  const exact = build("orbit 90, 0 once clockwise at 20000m tilted 60 degrees for 20 seconds"); const o2 = orbitOf(exact);
  assert.ok(exact.tracks.pan.every((k) => Number.isFinite(k.value)));
  // Every bearing to the pole is due north: pan is constant, and the pan key set is unchanged by that.
  assert.ok(exact.tracks.pan.filter((k) => k.time >= o2.start_frame).every((k) => Math.abs(wrap180(k.value)) < 1e-6), "all headings point at the pole (0° mod 360)");
  assert.ok(exact.tracks.pan.length >= 30, "aimed pan keys are kept even when flat");
});

test("heading authority: acquisition and sweep share one continuous pan representative (no ±360 jump)", () => {
  // The frozen oracle's hostile seed: pan 720 (≡ 0) 1.5 radii from the subject.
  const centre = { latitude: 60, longitude: 20 }; const radius = planner.orbitRadiusMeters(6500, 60);
  const seedPosition = planner.offsetPoint(centre, -170, radius * 1.5);
  const seed = { latitude: seedPosition.latitude, longitude: seedPosition.longitude, altitude_m: 6500, pan_deg: 720, tilt_deg: 60 };
  const timing = [];
  const b = build("orbit 60, 20 once clockwise at 6500m tilted 60 degrees for 20 seconds", { initialCamera: seed, orbitTiming: timing });
  assert.ok(timing[0].acquisition_frames > 0, "the seed needs an acquisition");
  assert.ok(maxStep(b.tracks.pan) < 180, `largest pan step ${maxStep(b.tracks.pan)}°`);
  assert.ok(b.tracks.pan[0].value === 720, "the seed's own representative is kept");
  const orbit = orbitOf(b);
  assert.ok(Math.max(...headingErrors(b, orbit).map((r) => r.error)) <= precisionDeg(radius));
  // The hold→orbit-around-a-different-centre canary: acquisition ends and the sweep continues from it.
  const g = build("hover over Helsinki at 34028m tilted 0 degrees for 4 seconds then hover over Helsinki for 4 seconds then orbit Espoo once clockwise at 17014m tilted 60 degrees for 23 seconds");
  assert.ok(maxStep(g.tracks.pan) < 180, `G canary pan step ${maxStep(g.tracks.pan)}`);
});

test("heading authority: ring position is geometric state — successor ring entry does not move when pan is corrected", () => {
  // Helsinki orbit → fly → Stockholm orbit: the Stockholm entry is placed from the
  // carried ring bearing, so it equals offsetPoint(Stockholm, θexit, r) exactly.
  const b = build("orbit Helsinki once clockwise at 6500m tilted 60 degrees for 20 seconds then fly to Stockholm at 12000m for 8 seconds then orbit Stockholm once clockwise at 6500m tilted 60 degrees for 20 seconds");
  const [helsinki, fly, stockholm] = b.plan.segments.filter((s) => s.location);
  assert.equal(fly.ends_at_orbit_entry, stockholm.segment_id);
  const entry = { latitude: b.tracks.lat.find((k) => k.time === fly.end_frame).value, longitude: unwrapLng(b.tracks.lng).find((k) => k.time === fly.end_frame).value };
  const stockholmRadius = planner.orbitRadiusMeters(stockholm.altitude_m, stockholm.tilt_deg);
  assert.ok(Math.abs(continuity.haversineMeters(entry, stockholm.location) - stockholmRadius) < 0.5, "entry lands on the Stockholm ring");
  const exitCam = { latitude: valueAt(b.tracks.lat, helsinki.end_frame), longitude: valueAt(unwrapLng(b.tracks.lng), helsinki.end_frame) };
  const exitRingBearing = continuity.initialBearing(helsinki.location, exitCam);
  const entryRingBearing = continuity.initialBearing(stockholm.location, entry);
  // Entry ring bearing = carried exit ring bearing (geometric state), NOT the corrected pan − 180.
  assert.ok(Math.abs(wrap180(entryRingBearing - exitRingBearing)) < 0.01, `entry ring bearing ${entryRingBearing} vs exit ${exitRingBearing}`);
  // (The exit pan itself is asserted below to be the TRUE camera→Helsinki bearing.)
  // …while the camera's heading at Helsinki's exit is the TRUE bearing, not θexit + 180.
  const exitPan = b.tracks.pan.filter((k) => k.time <= helsinki.end_frame).pop().value;
  const exitCamera = { latitude: valueAt(b.tracks.lat, helsinki.end_frame), longitude: valueAt(unwrapLng(b.tracks.lng), helsinki.end_frame) };
  assert.ok(Math.abs(wrap180(exitPan - continuity.initialBearing(exitCamera, helsinki.location))) <= precisionDeg(planner.orbitRadiusMeters(6500, 60)));
  // Ring-entry heading is acquired: the Stockholm orbit faces Stockholm through its sweep.
  assert.ok(Math.max(...headingErrors(b, stockholm).map((r) => r.error)) <= precisionDeg(planner.orbitRadiusMeters(6500, 60)));
});

test("heading authority: continuation carries the corrected pan without moving the camera", () => {
  const a = build("orbit 85, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds");
  const exitCamera = { latitude: a.final.latitude, longitude: a.final.longitude };
  assert.ok(Math.abs(wrap180(a.final.pan_deg - continuity.initialBearing(exitCamera, { latitude: 85, longitude: 20 }))) <= precisionDeg(80000));
  const bSeeded = build("orbit 85, 20 half clockwise at 200000m tilted 30 degrees for 10 seconds", { initialCamera: a.final, orbitTiming: [] });
  assert.equal(bSeeded.tracks.lat[0].value, a.final.latitude);
  assert.equal(bSeeded.tracks.lng[0].value, a.final.longitude);
  assert.equal(bSeeded.tracks.pan[0].value, a.final.pan_deg, "B opens with A's corrected heading");
  assert.equal(bSeeded.options.orbitTiming.length ? bSeeded.options.orbitTiming[0].acquisition_frames : 0, 0, "a seed sitting on the ring facing the subject needs no acquisition");
  assert.ok(maxStep(bSeeded.tracks.pan) < 15, "no startup jump");
  assert.ok(Math.max(...headingErrors(bSeeded, orbitOf(bSeeded)).map((r) => r.error)) <= precisionDeg(80000));
});

test("heading authority: terrain orbit horizontal aim (Matterhorn) is corrected; altitude and tilt untouched", () => {
  // CONTRACT CHANGE (2026-09-04, terrain complete pose policy A). The old form
  // authored 5,736 m — the pre-repair sea-level derivation — which now conflicts
  // with Matterhorn's calibrated pose (10,214 m at 74°) and is refused (manual
  // review, calibrated pose applied). The heading property under test is
  // unchanged: the orbit faces its subject at every ring key, and the altitude
  // and tilt tracks stay constant through the whole orbit.
  const b = build("orbit Matterhorn once clockwise tilted 74 degrees for 77 seconds"); const orbit = orbitOf(b);
  assert.equal(orbit.altitude_m, 10214);
  assert.ok(Math.max(...headingErrors(b, orbit).map((r) => r.error)) <= precisionDeg(planner.orbitRingRadiusMeters(orbit.location, orbit.altitude_m, orbit.tilt_deg)));
  assert.ok(b.tracks.alt.every((k) => k.value === 10214));
  assert.ok(b.tracks.tilt.every((k) => k.value === 74));
  assert.throws(() => build("orbit Matterhorn once clockwise at 5736m tilted 74 degrees for 77 seconds"),
    /calibrated terrain focal point/, "an authored sea-level altitude on a calibrated terrain orbit is refused");
});

test("heading authority: continuous pan representative — 359→361, 1→−1, tie eastward", () => {
  assert.equal(planner.continuousLng(359, 1), 361);
  assert.equal(planner.continuousLng(1, 359), -1);
  assert.equal(planner.continuousLng(720, 0), 720);
  assert.equal(planner.continuousLng(0, 180), 180);
  assert.equal(planner.continuousLng(0, -180), 180);
});
