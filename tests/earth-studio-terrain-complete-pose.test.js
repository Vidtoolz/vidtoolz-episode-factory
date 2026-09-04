// TERRAIN COMPLETE POSE — TOPOLOGY-GENERAL AUTHORITY (2026-09-04 repair).
//
// Invariant under test: every orbit-family movement around a DECLARED terrain
// focal point (a gazetteer place with `target_elevation_m`) resolves ONE
// internally consistent complete camera pose — focal lat/lng/z_t, calibrated
// footprint r = altitude_m·tan 72°, rake θ, camera altitude A = z_t + r/tan θ,
// ring (A − z_t)·tan θ, heading at the focal point — independent of the path
// or staging topology used to reach the orbit: bare orbit, fly/zoom/hover
// staging, hold read-through, director one-stop/two-stop, journey IR, text,
// continuation. The equations live in one place
// (earth-studio-terrain-morphology.js completePose) and every consumer asks it.
//
// Aim is verified with an INDEPENDENT WGS84/ECEF optical measurement written
// here (no production helper), so a regression in the engine's own geometry
// cannot hide behind itself.
const { assert, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const journey = require("../earth-studio-journey.js");
const director = require("../earth-studio-director.js");
const continuity = require("../earth-studio-motion-continuity.js");
const morphology = require("../earth-studio-terrain-morphology.js");

const POL = { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" };
const OPT = { aspect: "16:9", motionPolicy: POL };
const AT = "2026-09-04T00:00:00.000Z";
const TAN72 = Math.tan((72 * Math.PI) / 180);
const tan = (deg) => Math.tan((deg * Math.PI) / 180);

// ── independent optical measurement (WGS84 ECEF, Earth Studio pan/tilt) ──────
const RAD = (d) => (d * Math.PI) / 180;
const WGS_A = 6378137; const WGS_F = 1 / 298.257223563; const E2 = WGS_F * (2 - WGS_F);
function ecef({ latitude, longitude, altitude_m }) {
  const la = RAD(latitude); const lo = RAD(longitude);
  const N = WGS_A / Math.sqrt(1 - E2 * Math.sin(la) ** 2);
  return [(N + altitude_m) * Math.cos(la) * Math.cos(lo), (N + altitude_m) * Math.cos(la) * Math.sin(lo), (N * (1 - E2) + altitude_m) * Math.sin(la)];
}
function enu(lat, lon) {
  const la = RAD(lat); const lo = RAD(lon);
  return { e: [-Math.sin(lo), Math.cos(lo), 0], n: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)], u: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)] };
}
// Angle between the camera's optical ray (tilt from nadir, pan clockwise from
// north) and the ray to the target at elevation z, in degrees.
function aimErrorDeg(camera, target, z) {
  const b = enu(camera.latitude, camera.longitude);
  const p = RAD(camera.pan_deg); const t = RAD(camera.tilt_deg);
  const horizontal = b.n.map((v, i) => v * Math.cos(p) + b.e[i] * Math.sin(p));
  const ray = horizontal.map((v, i) => v * Math.sin(t) - b.u[i] * Math.cos(t));
  const c = ecef(camera); const g = ecef({ ...target, altitude_m: z });
  const d = g.map((v, i) => v - c[i]); const n = Math.hypot(...d);
  const dot = ray.reduce((s, v, i) => s + (v * d[i]) / n, 0);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}
const hav = (a, b) => planner.haversineMeters(a, b);

// ── builders ─────────────────────────────────────────────────────────────────
function build(description, extra = {}) {
  const artifacts = planner.buildArtifacts("terrain-complete-pose", description, AT, { ...OPT, ...extra });
  return { artifacts, plan: JSON.parse(artifacts["shot-plan.json"]), esp: JSON.parse(artifacts["earth-studio.esp"]) };
}
function cameraAt(built, frame) {
  const tracks = continuity.extractEspCameraTracks(built.esp);
  const u = frame / built.plan.total_frames;
  const at = (k) => continuity.playbackValueAt(tracks[k], u);
  return { latitude: at("lat"), longitude: at("lng"), altitude_m: at("alt"), pan_deg: at("pan"), tilt_deg: at("tilt") };
}
function orbitOf(built, name) {
  const wanted = name ? planner.resolveLocation(name).name : null;
  const orbit = built.plan.segments.find((s) => s.action === "orbit" && s.location && (!wanted || s.location.name === wanted));
  assert.ok(orbit, `expected an orbit${name ? ` around ${name}` : ""}`);
  return orbit;
}
// The pose measured from the exported camera at the orbit's first frame.
function measure(built, name) {
  const orbit = orbitOf(built, name);
  const loc = orbit.location;
  const z = planner.focalElevationM(loc);
  const camera = cameraAt(built, orbit.start_frame);
  return {
    orbit, loc, z, camera,
    ring_m: hav(camera, loc),
    aim_deg: aimErrorDeg(camera, loc, z === null ? 0 : z),
    footprint_m: Math.min(loc.altitude_m * TAN72, 80000),
  };
}
const J = (start, legs, extra = {}) => ({ journey_version: 1, pace: "calm", aspect: "16:9", start: { source: "location", location: start, framing: "auto", altitude_m: null, tilt_deg: null }, start_movements: [], legs, ...extra });
const leg = (destination, travel, movements = []) => ({ destination: { location: destination, framing: "auto", altitude_m: null, tilt_deg: null }, travel_style: "direct", travel, movements });
const st = (type, extra = {}) => ({ type, ...extra });
function viaJourney(raw) {
  const check = journey.validateJourney(raw, { planner });
  assert.ok(check.ok, `journey must validate: ${check.errors.join(" | ")}`);
  const direct = journey.compileJourneyToParsed(raw, { planner, aspect: "16:9" });
  const text = build(check.compiled.description);
  const structured = planner.buildArtifactsFromParsed("terrain-complete-pose", direct.parsed, AT, OPT);
  Object.keys(text.artifacts).forEach((k) => assert.equal(structured[k], text.artifacts[k], `TEXT and DIRECT paths must agree on ${k}`));
  return { compiled: check.compiled, built: text, direct };
}
function assertCompletePose(m, label, { aimTol = 0.25, ringTol = 5 } = {}) {
  assert.ok(m.z !== null, `${label}: place must declare a focal elevation`);
  assert.equal(m.orbit.altitude_m, Math.round(m.z + m.footprint_m / tan(m.orbit.tilt_deg)), `${label}: A = z_t + r / tan θ`);
  assert.ok(Math.abs(m.ring_m - m.footprint_m) <= ringTol, `${label}: ring ${m.ring_m.toFixed(1)} must be the calibrated footprint ${m.footprint_m.toFixed(1)}`);
  assert.ok(m.aim_deg <= aimTol, `${label}: optical centre ${m.aim_deg.toFixed(3)}° off the declared focal point`);
  assert.ok(m.orbit.terrain_pose && m.orbit.terrain_pose.target_elevation_m === m.z, `${label}: plan records the terrain pose`);
  assert.ok(Math.abs(m.orbit.terrain_pose.ring_radius_m - m.ring_m) <= ringTol, `${label}: recorded ring matches the exported ring`);
}
// Runtime-only synthetic gazetteer entries (removed again after each test).
function withFixtures(entries, fn) {
  const keys = Object.keys(entries);
  keys.forEach((k) => { planner.LOCATION_FIXTURES[k] = entries[k]; });
  try { return fn(); } finally { keys.forEach((k) => { delete planner.LOCATION_FIXTURES[k]; }); }
}

// ── 1. bare orbit / one-stop ─────────────────────────────────────────────────
test("terrain complete pose: a bare Matterhorn orbit resolves the calibrated pose with no approach or staging", () => {
  const m = measure(build("orbit Matterhorn once clockwise tilted 74 degrees for 20 seconds"), "Matterhorn");
  assertCompletePose(m, "bare Matterhorn");
  assert.equal(m.orbit.altitude_m, 10214);
  assert.equal(m.orbit.altitude_source, "terrain_complete_pose");
  assert.ok(Math.abs(m.ring_m - 20005) < 5, `ring ${m.ring_m}`);
  assert.ok(m.aim_deg < 0.1, `aim ${m.aim_deg}`);
  // The old sea-level law is provably NOT what the orbit rides any more.
  assert.ok(planner.orbitRadiusMeters(m.orbit.altitude_m, m.orbit.tilt_deg) > 35000);
});

// ── 2. other morphologies, bare ──────────────────────────────────────────────
test("terrain complete pose: bare orbits at every declared morphology preserve the footprint and aim at the focal point", () => {
  const cases = [["Mount Fuji", 45], ["Geirangerfjord", 65], ["Kilimanjaro", 45], ["Mount Everest", 74], ["Mont Blanc", 74], ["Grand Canyon", 74], ["Yosemite", 65]];
  cases.forEach(([place, rake]) => {
    const m = measure(build(`orbit ${place} once clockwise tilted ${rake} degrees for 20 seconds`), place);
    assertCompletePose(m, `${place} @${rake}`);
  });
});

// ── 3–5. journey approaches: fly_low / fly_high / cruise ─────────────────────
["fly_low", "fly_high", "cruise"].forEach((verb) => {
  test(`terrain complete pose: ${verb} → orbit at Matterhorn compiles, validates, and lands the approach on the orbit's pose`, () => {
    const r = viaJourney(J("Helsinki", [leg("Matterhorn", [st(verb, { duration_seconds: 12 })], [st("orbit", { duration_seconds: 20 })])]));
    const m = measure(r.built, "Matterhorn");
    assertCompletePose(m, verb);
    const approach = r.built.plan.segments[0];
    assert.equal(approach.ends_at_orbit_entry, m.orbit.segment_id);
    assert.equal(approach.altitude_m, m.orbit.altitude_m, "the staged approach lands on the orbit's complete-pose altitude");
    assert.equal(approach.altitude_source, "terrain_complete_pose_entry");
    // compiler cursor == planner
    assert.equal(r.compiled.steps[0].altitude_m, approach.altitude_m);
    assert.equal(r.compiled.steps[1].altitude_m, m.orbit.altitude_m);
    assert.equal(r.compiled.steps[1].altitude_source, "terrain_complete_pose");
    // one camera on the shared frame
    const boundary = cameraAt(r.built, m.orbit.start_frame);
    assert.ok(Math.abs(boundary.altitude_m - m.orbit.altitude_m) < 0.01, `boundary altitude ${boundary.altitude_m}`);
    assert.ok(Math.abs(hav(boundary, m.loc) - m.footprint_m) < 5);
  });
});

// ── 6–7. hold → orbit, hover → orbit ─────────────────────────────────────────
test("terrain complete pose: a transparent hold between the approach and the orbit changes nothing about the pose", () => {
  const withHold = viaJourney(J("Helsinki", [leg("Matterhorn", [st("fly_low", { duration_seconds: 12 })], [st("hold", { duration_seconds: 4 }), st("orbit", { duration_seconds: 14 })])]));
  const direct = viaJourney(J("Helsinki", [leg("Matterhorn", [st("fly_low", { duration_seconds: 12 })], [st("orbit", { duration_seconds: 14 })])]));
  const a = measure(withHold.built, "Matterhorn"); const b = measure(direct.built, "Matterhorn");
  assertCompletePose(a, "fly_low→hold→orbit"); assertCompletePose(b, "fly_low→orbit");
  assert.equal(a.orbit.altitude_m, b.orbit.altitude_m);
  assert.equal(a.orbit.tilt_deg, b.orbit.tilt_deg);
  const hold = withHold.built.plan.segments[1];
  assert.equal(hold.action, "hover");
  assert.equal(hold.altitude_source, "carried_over", "a hold still INHERITS its camera");
  assert.equal(hold.altitude_m, a.orbit.altitude_m);
  assert.equal(withHold.built.plan.segments[0].ends_at_orbit_entry, a.orbit.segment_id, "the approach still stages through the hold");
});

test("terrain complete pose: an opening hover staged on a Matterhorn orbit sits on the complete-pose ring from frame 0", () => {
  const staged = build("hover over Matterhorn tilted 74 degrees for 3 seconds then orbit Matterhorn once clockwise tilted 74 degrees for 20 seconds");
  const m = measure(staged, "Matterhorn");
  assertCompletePose(m, "hover→orbit");
  const hover = staged.plan.segments[0];
  assert.equal(hover.stages_orbit_entry, m.orbit.segment_id);
  assert.equal(hover.altitude_m, m.orbit.altitude_m);
  const opening = cameraAt(staged, 0);
  assert.ok(Math.abs(hav(opening, m.loc) - m.footprint_m) < 5, "opens on the ring");
  assert.ok(aimErrorDeg(opening, m.loc, m.z) < 0.1);
  const bare = measure(build("orbit Matterhorn once clockwise tilted 74 degrees for 20 seconds"), "Matterhorn");
  assert.equal(m.orbit.altitude_m, bare.orbit.altitude_m);
});

// ── 8. continuation ──────────────────────────────────────────────────────────
test("terrain complete pose: a continuation after a corrected terrain orbit keeps the pose — no plunge, no re-derivation from a stale altitude", () => {
  const first = build("fly to Matterhorn tilted 74 degrees for 8 seconds then orbit Matterhorn once clockwise tilted 74 degrees for 20 seconds");
  const seed = planner.finalCameraState(first.plan, OPT);
  assert.equal(seed.altitude_m, 10214);
  const second = build("orbit Matterhorn once clockwise tilted 74 degrees for 10 seconds", { initialCamera: seed });
  const m = measure(second, "Matterhorn");
  assertCompletePose(m, "continuation");
  const alt = continuity.extractEspCameraTracks(second.esp).alt;
  assert.ok(alt.every((k) => Math.abs(k.value - 10214) < 0.5), `altitude must be constant, got ${alt.map((k) => Math.round(k.value)).join(",")}`);
  for (let f = 0; f <= second.plan.total_frames; f += 30) {
    assert.ok(Math.abs(hav(cameraAt(second, f), m.loc) - m.footprint_m) < 80, `frame ${f} stays on the ring`);
  }
  // a hold continuation (journey continuation grammar) then orbit: same pose
  const third = build("hover over Matterhorn tilted 74 degrees for 2 seconds then orbit Matterhorn half clockwise tilted 74 degrees for 8 seconds", { initialCamera: planner.finalCameraState(second.plan, OPT) });
  assert.equal(orbitOf(third, "Matterhorn").altitude_m, 10214);
});

// ── 9–10. director one-stop / two-stop ───────────────────────────────────────
test("terrain complete pose: the director's one-stop terrain grammar rides the calibrated footprint and aims at the summit", () => {
  const r = director.autoDirect(director.parseIntent("Show the terrain of Matterhorn."));
  const compiled = journey.compileJourney(journey.normalizeJourney(r.journey), { planner });
  // The director states the rake and leaves the altitude to the authority; a
  // derived altitude is not serialized as if the operator had authored it.
  assert.match(compiled.description, /orbit Matterhorn half clockwise tilted 74 degrees/);
  assert.equal(r.journey.start_movements[0].altitude_m, null);
  const m = measure(build(compiled.description), "Matterhorn");
  assertCompletePose(m, "director one-stop", { aimTol: 0.1 });
  assert.equal(r.decisions[0].decision.altitude_m, 10214);
  assert.equal(r.decisions[0].decision.terrain_policy.target_elevation_declared, true);
  // every declared peak, same grammar
  [["Mont Blanc", 74], ["Kilimanjaro", 45], ["Mount Everest", 74], ["Mount Fuji", 45], ["Geirangerfjord", 65]].forEach(([place, rake]) => {
    const rr = director.autoDirect(director.parseIntent(`Show the terrain of ${place}.`));
    const c = journey.compileJourney(journey.normalizeJourney(rr.journey), { planner });
    const mm = measure(build(c.description), place);
    assertCompletePose(mm, `director one-stop ${place}`);
    assert.equal(mm.orbit.tilt_deg, rake);
  });
});

test("terrain complete pose: the director's two-stop form stages the zoom onto the orbit's pose and the boundary is one camera", () => {
  const r = director.autoDirect({ aspect: "16:9", stops: [{ location: "Zurich", role: "STARTING_CONTEXT" }, { location: "Matterhorn", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] });
  const check = journey.validateJourney(r.journey, { planner });
  assert.ok(check.ok, check.errors.join(" | "));
  const built = build(check.compiled.description);
  const m = measure(built, "Matterhorn");
  assertCompletePose(m, "director two-stop", { aimTol: 0.1 });
  const staging = built.plan.segments.find((s) => s.ends_at_orbit_entry === m.orbit.segment_id);
  assert.ok(staging, "the arrival is staged onto the orbit");
  assert.equal(staging.altitude_m, m.orbit.altitude_m);
  assert.equal(staging.tilt_deg, m.orbit.tilt_deg);
  const boundary = cameraAt(built, m.orbit.start_frame);
  assert.ok(Math.abs(boundary.altitude_m - m.orbit.altitude_m) < 0.01);
  assert.ok(Math.abs(boundary.tilt_deg - m.orbit.tilt_deg) < 1e-6);
  assert.ok(Math.abs(hav(boundary, m.loc) - m.footprint_m) < 5);
  const one = measure(build(journey.compileJourney(journey.normalizeJourney(director.autoDirect(director.parseIntent("Show the terrain of Matterhorn.")).journey), { planner }).description), "Matterhorn");
  assert.equal(one.orbit.altitude_m, m.orbit.altitude_m, "one-stop and two-stop resolve the same pose");
});

// ── 11. explicit orbit altitude contract ─────────────────────────────────────
test("terrain complete pose: an authored orbit altitude is explicit operator authority — kept in every topology, ring measured from the focal point (policy B)", () => {
  // POLICY B (Hermes contract adjudication 2026-09-04). Authority order: safety
  // floor → authored altitude/tilt → declared focal geometry → elevation-aware
  // aim → calibrated morphology → generic defaults. An authored altitude A and
  // rake θ are kept; the calibrated footprint yields; the ring is
  // r = (A − z_t)·tan θ so the optical centre stays on the summit. The only
  // refusal is a camera at or below the focal point.
  const expectedRing = (8000 - 4478) * tan(74); // ≈ 12 282.7 m
  const forms = [
    "orbit Matterhorn once clockwise at 8000m tilted 74 degrees for 20 seconds",
    "fly to Matterhorn tilted 74 degrees for 8 seconds then orbit Matterhorn once clockwise at 8000m tilted 74 degrees for 20 seconds",
    "hover over Matterhorn tilted 74 degrees for 3 seconds then orbit Matterhorn once clockwise at 8000m tilted 74 degrees for 20 seconds",
    "fly to Matterhorn tilted 74 degrees for 8 seconds then hover over Matterhorn for 2 seconds then orbit Matterhorn once clockwise at 8000m tilted 74 degrees for 20 seconds",
    "fly to Matterhorn tilted 60 degrees for 8 seconds then orbit Matterhorn once clockwise at 8000m tilted 74 degrees for 20 seconds",
  ];
  forms.forEach((d) => {
    const built = build(d);
    const m = measure(built, "Matterhorn");
    assert.equal(m.orbit.resolution_status, "resolved", d);
    assert.equal(m.orbit.altitude_m, 8000, `${d}: authored altitude kept`);
    assert.equal(m.orbit.altitude_source, "explicit", d);
    assert.equal(m.orbit.tilt_deg, 74, `${d}: authored rake kept`);
    assert.ok(Math.abs(m.ring_m - expectedRing) < 5, `${d}: ring ${m.ring_m.toFixed(1)} vs ${expectedRing.toFixed(1)}`);
    assert.ok(Math.abs(m.orbit.terrain_pose.ring_radius_m - expectedRing) < 5, d);
    assert.equal(m.orbit.terrain_pose.authored_altitude_m, 8000);
    assert.equal(m.orbit.terrain_pose.canonical_camera_altitude_m, 10214, "the AUTO pose is recorded as provenance only");
    assert.ok(m.aim_deg < 0.1, `${d}: aim ${m.aim_deg}`);
    assert.ok(Math.abs(m.camera.altitude_m - 8000) < 0.01, `${d}: boundary altitude`);
    // every staged link lands on the authored pose
    built.plan.segments.filter((s) => s.ends_at_orbit_entry === m.orbit.segment_id || s.stages_orbit_entry === m.orbit.segment_id)
      .forEach((s) => assert.equal(s.altitude_m, 8000, `${d}: staged approach lands on the authored altitude`));
  });
  // authored altitude only: rake from morphology, ring from the focal point
  const altOnly = measure(build("orbit Matterhorn once clockwise at 8000m for 20 seconds"), "Matterhorn");
  assert.equal(altOnly.orbit.altitude_m, 8000); assert.equal(altOnly.orbit.tilt_deg, 74); assert.equal(altOnly.orbit.tilt_source, "terrain_morphology_rake");
  assert.ok(Math.abs(altOnly.ring_m - expectedRing) < 5 && altOnly.aim_deg < 0.1);
  // authored rake only: footprint preserved, altitude derived
  const rakeOnly = measure(build("orbit Matterhorn once clockwise tilted 60 degrees for 20 seconds"), "Matterhorn");
  assert.equal(rakeOnly.orbit.tilt_deg, 60); assertCompletePose(rakeOnly, "authored rake 60", { aimTol: 0.1 });
  // restating the calibrated altitude is simply an authored 10 214 m
  const restated = measure(build("orbit Matterhorn once clockwise at 10214m tilted 74 degrees for 20 seconds"), "Matterhorn");
  assert.equal(restated.orbit.altitude_source, "explicit"); assertCompletePose(restated, "restated", { aimTol: 0.1 });
  // journey path: identical contract on every staging form, validated and compiled
  const journeys = {
    "structured orbit": J("Zurich", [leg("Matterhorn", [st("fly", { duration_seconds: 8 })], [st("orbit", { altitude_m: 8000, tilt_deg: 74, duration_seconds: 20 })])]),
    "fly_low journey": J("Zurich", [leg("Matterhorn", [st("fly_low", { duration_seconds: 8 })], [st("orbit", { altitude_m: 8000, tilt_deg: 74, duration_seconds: 20 })])]),
    "fly_high journey": J("Zurich", [leg("Matterhorn", [st("fly_high", { duration_seconds: 8 })], [st("orbit", { altitude_m: 8000, tilt_deg: 74, duration_seconds: 20 })])]),
    "cruise journey": J("Zurich", [leg("Matterhorn", [st("cruise", { duration_seconds: 8 })], [st("orbit", { altitude_m: 8000, tilt_deg: 74, duration_seconds: 20 })])]),
    "hold → orbit": J("Zurich", [leg("Matterhorn", [st("fly", { duration_seconds: 8 })], [st("hold", { duration_seconds: 3 }), st("orbit", { altitude_m: 8000, tilt_deg: 74, duration_seconds: 20 })])]),
    "start orbit": J("Matterhorn", [], { start_movements: [st("orbit", { altitude_m: 8000, tilt_deg: 74, duration_seconds: 20 })] }),
    "altitude only (rake from morphology)": J("Zurich", [leg("Matterhorn", [st("fly", { duration_seconds: 8 })], [st("orbit", { altitude_m: 8000, duration_seconds: 20 })])]),
  };
  Object.entries(journeys).forEach(([label, raw]) => {
    const r = viaJourney(raw);
    const m = measure(r.built, "Matterhorn");
    assert.equal(m.orbit.altitude_m, 8000, label); assert.equal(m.orbit.tilt_deg, 74, label);
    assert.ok(Math.abs(m.ring_m - expectedRing) < 5, `${label}: ring ${m.ring_m}`); assert.ok(m.aim_deg < 0.1, `${label}: aim ${m.aim_deg}`);
    const orbitStep = r.compiled.steps.find((s) => s.action === "orbit");
    assert.equal(orbitStep.altitude_m, 8000); assert.equal(orbitStep.altitude_source, "manual_altitude"); assert.equal(orbitStep.emit_altitude, true);
    r.built.plan.segments.filter((s) => s.ends_at_orbit_entry === m.orbit.segment_id).forEach((s) => assert.equal(s.altitude_m, 8000, `${label}: approach lands on the authored altitude`));
  });
  // continuation preserves the explicit pose
  const first = build(forms[1]);
  const seed = planner.finalCameraState(first.plan, OPT);
  assert.equal(seed.altitude_m, 8000);
  const cont = measure(build("orbit Matterhorn once clockwise at 8000m tilted 74 degrees for 10 seconds", { initialCamera: seed }), "Matterhorn");
  assert.equal(cont.orbit.altitude_m, 8000); assert.ok(Math.abs(cont.ring_m - expectedRing) < 5 && cont.aim_deg < 0.1);
  // the only refusal: a camera at or below the focal point
  const bad = journey.validateJourney(J("Zurich", [leg("Matterhorn", [st("fly", { duration_seconds: 8 })], [st("orbit", { altitude_m: 4000, duration_seconds: 20 })])]), { planner });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /not above Matterhorn's declared focal point/.test(e)), bad.errors.join(" | "));
  assert.equal(journey.validateJourney(J("Matterhorn", [], { start_movements: [st("orbit", { altitude_m: 4478, duration_seconds: 10 })] }), { planner }).ok, false);
  withFixtures({ "low floor peak": { name: "Low Floor Peak", latitude: 46, longitude: 8, altitude_m: 6500, min_altitude_m: 0, terrain_morphology: "sharp_peak", morphology_source: "curated_gazetteer", target_elevation_m: 4478, target_anchor_kind: "SUMMIT", target_anchor_source: "DECLARED_TERRAIN_FOCAL_POINT", target_anchor_confidence: "HIGH" } }, () => {
    assert.throws(() => build("orbit Low Floor Peak once clockwise at 4000m tilted 74 degrees for 20 seconds"), /not above Low Floor Peak's declared focal point/);
    // just above the summit is legal, tight, and still aimed at it
    const tight = measure(build("orbit Low Floor Peak once clockwise at 4600m tilted 74 degrees for 20 seconds"), "Low Floor Peak");
    assert.equal(tight.orbit.altitude_m, 4600); assert.ok(Math.abs(tight.ring_m - (4600 - 4478) * tan(74)) < 2); assert.ok(tight.aim_deg < 0.25, `aim ${tight.aim_deg}`);
  });
  // at or below the summit is refused on the text path too, judged on the value written (the floor does not quietly repair it)
  assert.throws(() => build("orbit Matterhorn once clockwise at 4000m tilted 74 degrees for 20 seconds"), /not above Matterhorn's declared focal point/);
  assert.throws(() => build("orbit Matterhorn once clockwise at 4478m tilted 74 degrees for 20 seconds"), /not above Matterhorn's declared focal point/);
  // above the summit but below the safety floor: the floor (rank 1) lifts it, then the pose follows the lifted altitude
  const floored = measure(build("orbit Matterhorn once clockwise at 5000m tilted 74 degrees for 20 seconds"), "Matterhorn");
  assert.equal(floored.orbit.altitude_m, 5500); assert.ok(Math.abs(floored.ring_m - (5500 - 4478) * tan(74)) < 2); assert.ok(floored.aim_deg < 0.25);
  // repeated explicit continuation converges to a byte-stable animation
  let chain = build("orbit Matterhorn once clockwise at 8000m tilted 74 degrees for 10 seconds", { initialCamera: seed }); let previousEsp = null; let identical = 0;
  for (let i = 0; i < 4; i += 1) {
    chain = build("orbit Matterhorn once clockwise at 8000m tilted 74 degrees for 10 seconds", { initialCamera: planner.finalCameraState(chain.plan, OPT) });
    assert.equal(orbitOf(chain, "Matterhorn").altitude_m, 8000);
    if (previousEsp === chain.artifacts["earth-studio.esp"]) identical += 1;
    previousEsp = chain.artifacts["earth-studio.esp"];
  }
  assert.ok(identical >= 2, "repeated explicit continuation converges");
  // the director never serializes a derived altitude as authored (AUTO stays AUTO)
  const directed = director.autoDirect({ aspect: "16:9", stops: [{ location: "Zurich", role: "STARTING_CONTEXT" }, { location: "Matterhorn", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] });
  directed.journey.legs.forEach((l) => l.movements.forEach((mv) => assert.equal(mv.altitude_m, null)));
  assert.equal(journey.validateJourney(directed.journey, { planner }).ok, true);
});

// ── 12–14. below sea level, zero, unknown ───────────────────────────────────
test("terrain complete pose: a below-sea-level focal point derives a legal pose and aims at the negative elevation", () => {
  withFixtures({ "dead sea shore": { name: "Dead Sea Shore", latitude: 31.5, longitude: 35.47, altitude_m: 3000, min_altitude_m: 0, terrain_morphology: "generic_terrain", morphology_source: "curated_gazetteer", target_elevation_m: -430, target_anchor_kind: "WATERLINE", target_anchor_source: "DECLARED_TERRAIN_FOCAL_POINT", target_anchor_confidence: "HIGH" } }, () => {
    const m = measure(build("fly to Dead Sea Shore tilted 65 degrees for 6 seconds then orbit Dead Sea Shore once clockwise tilted 65 degrees for 20 seconds"), "Dead Sea Shore");
    assert.equal(m.z, -430);
    assertCompletePose(m, "Dead Sea", { aimTol: 0.15 });
    assert.equal(m.orbit.altitude_m, Math.round(-430 + 3000 * TAN72 / tan(65)));
    assert.ok(m.orbit.altitude_m > 0);
  });
});

test("terrain complete pose: a zero-elevation focal point (Geirangerfjord waterline) is DECLARED, not undeclared", () => {
  assert.equal(planner.focalElevationM(planner.resolveLocation("Geirangerfjord")), 0);
  const m = measure(build("orbit Geirangerfjord once clockwise tilted 65 degrees for 20 seconds"), "Geirangerfjord");
  assertCompletePose(m, "Geirangerfjord", { aimTol: 0.1 });
  assert.equal(m.orbit.altitude_m, Math.round(2500 * TAN72 / tan(65)));
  assert.equal(m.orbit.altitude_source, "terrain_complete_pose");
  assert.equal(m.orbit.terrain_pose.target_elevation_m, 0);
  // and the authority never confuses 0 with "missing"
  assert.equal(morphology.declaredFocalElevationM({ target_elevation_m: 0 }), 0);
  assert.equal(morphology.declaredFocalElevationM({ target_elevation_m: null }), null);
  assert.equal(morphology.declaredFocalElevationM({ target_elevation_m: "4478" }), null, "a string is not a declaration");
  assert.equal(morphology.declaredFocalElevationM({}), null);
});

test("terrain complete pose: a place without a declared elevation keeps the legacy sea-level law byte-for-byte", () => {
  ["Santorini", "Stockholm", "Lofoten", "Table Mountain"].forEach((place) => {
    const loc = planner.resolveLocation(place);
    assert.equal(planner.focalElevationM(loc), null, place);
    assert.equal(planner.resolveTerrainPose(loc, { tilt_deg: 60 }), null, place);
    const built = build(`fly to ${place} tilted 60 degrees for 8 seconds then orbit ${place} once clockwise tilted 60 degrees for 20 seconds`);
    const orbit = orbitOf(built, place);
    assert.equal(orbit.terrain_pose, undefined, `${place}: no terrain pose block`);
    assert.ok(["gazetteer", "action_default"].includes(orbit.altitude_source), `${place}: ${orbit.altitude_source}`);
    const camera = cameraAt(built, orbit.start_frame);
    assert.ok(Math.abs(hav(camera, loc) - planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg)) < 5, `${place}: legacy ring law`);
    assert.equal(planner.orbitRingRadiusMeters(loc, orbit.altitude_m, orbit.tilt_deg), planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg));
  });
  // the morphology decision states the undeclared case instead of assuming it
  const undeclared = morphology.terrainTiltDecision({ terrain_morphology: "sharp_peak", altitude_m: 6500, min_altitude_m: 5500 });
  assert.equal(undeclared.target_elevation_declared, false);
  assert.equal(undeclared.altitude_m, 5736, "sea-level solution, whole metres");
  const declared = morphology.terrainTiltDecision({ terrain_morphology: "sharp_peak", altitude_m: 6500, min_altitude_m: 5500, target_elevation_m: 4478 });
  assert.equal(declared.target_elevation_declared, true);
  assert.equal(declared.altitude_m, 10214);
  assert.equal(declared.final_tilt_deg, 74);
  assert.equal(morphology.completePose({ target_elevation_m: null, tilt_deg: 74 }), null);
  assert.equal(morphology.completePose({ target_elevation_m: 4478, tilt_deg: 74 }), null, "no footprint, no authored or fallback altitude: nothing to resolve");
});

// ── 15. rake / tilt sweeps across the former discontinuity ───────────────────
test("terrain complete pose: the orbit pose does not depend on the approach tilt — sweep across the former 73.49/73.50 boundary", () => {
  const poses = new Set(); const rings = [];
  for (let t = 70; t <= 78.0001; t += 0.25) {
    const approachTilt = Math.round(t * 100) / 100;
    const built = build(`fly to Matterhorn tilted ${approachTilt} degrees for 8 seconds then orbit Matterhorn once clockwise tilted 74 degrees for 20 seconds`);
    const m = measure(built, "Matterhorn");
    poses.add(`${m.orbit.altitude_m}/${m.orbit.tilt_deg}/${m.orbit.altitude_source}`);
    rings.push(m.ring_m);
    assert.equal(built.plan.segments[0].altitude_m, m.orbit.altitude_m, `approach ${approachTilt}: lands on the orbit's altitude`);
    assert.ok(Math.abs(cameraAt(built, m.orbit.start_frame).altitude_m - 10214) < 0.01, `approach ${approachTilt}: boundary altitude`);
  }
  assert.deepEqual([...poses], ["10214/74/terrain_complete_pose"], `poses must be one: ${[...poses].join(" ")}`);
  assert.ok(Math.max(...rings) - Math.min(...rings) < 1, "ring constant across the sweep");
  // and 73.49 / 73.50 / 73.51 specifically
  [73.49, 73.5, 73.51].forEach((t) => assert.equal(orbitOf(build(`fly to Matterhorn tilted ${t} degrees for 8 seconds then orbit Matterhorn once clockwise tilted 74 degrees for 20 seconds`), "Matterhorn").altitude_m, 10214));
});

test("terrain complete pose: sweeping the ORBIT rake keeps the footprint and the aim while the altitude follows A = z_t + r / tan θ monotonically", () => {
  let previous = Infinity;
  for (let rake = 30; rake <= 80; rake += 2) {
    const m = measure(build(`fly to Matterhorn tilted ${rake} degrees for 8 seconds then orbit Matterhorn once clockwise tilted ${rake} degrees for 20 seconds`), "Matterhorn");
    assertCompletePose(m, `rake ${rake}`, { aimTol: 0.1 });
    assert.ok(m.orbit.altitude_m < previous, `altitude decreases with rake (${rake}: ${m.orbit.altitude_m} < ${previous})`);
    previous = m.orbit.altitude_m;
  }
});

// ── 16. heading seam ─────────────────────────────────────────────────────────
test("terrain complete pose: heading stays continuous through the 0/360 seam and on the focal point for both directions", () => {
  ["clockwise", "counterclockwise"].forEach((dir) => {
    const built = build(`orbit Matterhorn once ${dir} tilted 74 degrees for 20 seconds`);
    const m = measure(built, "Matterhorn");
    assertCompletePose(m, dir, { aimTol: 0.1 });
    const pans = continuity.extractEspCameraTracks(built.esp).pan.map((k) => k.value);
    assert.ok(pans.every((v, i) => i === 0 || Math.abs(v - pans[i - 1]) < 90), `${dir}: no pan wrap jump`);
    const sweep = pans[pans.length - 1] - pans[0];
    assert.ok(Math.abs(Math.abs(sweep) - 360) < 1e-6, `${dir}: pan sweep ${sweep}`);
    assert.ok(dir === "clockwise" ? sweep > 0 : sweep < 0);
    let worst = 0;
    for (let f = 0; f <= built.plan.total_frames; f += 10) worst = Math.max(worst, aimErrorDeg(cameraAt(built, f), m.loc, m.z));
    assert.ok(worst < 0.3, `${dir}: aim over the whole sweep ${worst.toFixed(3)}°`);
  });
  // a seed whose pan carries a full accumulated turn (the engine's unwrapped
  // heading) and the same heading normalized into [0, 360) are the same camera
  const first = build("orbit Matterhorn once clockwise tilted 74 degrees for 20 seconds");
  const seed = planner.finalCameraState(first.plan, OPT);
  assert.ok(seed.pan_deg >= 360, `a full clockwise orbit accumulates past 360 (${seed.pan_deg})`);
  assert.equal(seed.heading_deg, ((seed.pan_deg % 360) + 360) % 360);
  const a = build("orbit Matterhorn half clockwise tilted 74 degrees for 8 seconds", { initialCamera: seed });
  const b = build("orbit Matterhorn half clockwise tilted 74 degrees for 8 seconds", { initialCamera: { ...seed, pan_deg: seed.heading_deg } });
  const ca = cameraAt(a, 60); const cb = cameraAt(b, 60);
  assert.ok(hav(ca, cb) < 0.01 && Math.abs(ca.altitude_m - cb.altitude_m) < 0.01 && Math.abs(((ca.pan_deg - cb.pan_deg) % 360 + 540) % 360 - 180) < 1e-6, "0 and 360 headings are the same pose");
});

// ── 17. antimeridian ─────────────────────────────────────────────────────────
test("terrain complete pose: an elevated focal point on the antimeridian is physically identical to its longitude-shifted twin", () => {
  const base = { latitude: -12.25, altitude_m: 3000, min_altitude_m: 0, terrain_morphology: "sharp_peak", morphology_source: "curated_gazetteer", target_elevation_m: 850, target_anchor_kind: "SUMMIT", target_anchor_source: "DECLARED_TERRAIN_FOCAL_POINT", target_anchor_confidence: "HIGH" };
  withFixtures({ "seam peak": { ...base, name: "Seam Peak", longitude: 179.95 }, "twin peak": { ...base, name: "Twin Peak", longitude: 20 } }, () => {
    const seam = build("fly to Seam Peak tilted 74 degrees for 8 seconds then orbit Seam Peak once clockwise tilted 74 degrees for 20 seconds");
    const twin = build("fly to Twin Peak tilted 74 degrees for 8 seconds then orbit Twin Peak once clockwise tilted 74 degrees for 20 seconds");
    const m = measure(seam, "Seam Peak");
    assertCompletePose(m, "seam peak", { aimTol: 0.2 });
    const ta = continuity.extractEspCameraTracks(seam.esp); const tb = continuity.extractEspCameraTracks(twin.esp);
    ["lat", "lng", "alt", "pan", "tilt"].forEach((k) => assert.deepEqual(ta[k].map((x) => x.time), tb[k].map((x) => x.time), `${k} key topology`));
    let worst = 0;
    for (let f = 0; f <= seam.plan.total_frames; f += 1) {
      const u = f / seam.plan.total_frames;
      const a = { latitude: continuity.playbackValueAt(ta.lat, u), longitude: continuity.playbackValueAt(ta.lng, u), altitude_m: continuity.playbackValueAt(ta.alt, u) };
      const b = { latitude: continuity.playbackValueAt(tb.lat, u), longitude: continuity.playbackValueAt(tb.lng, u) + 159.95, altitude_m: continuity.playbackValueAt(tb.alt, u) };
      worst = Math.max(worst, Math.hypot(hav(a, b), a.altitude_m - b.altitude_m));
    }
    assert.ok(worst < 0.01, `seam vs twin physical difference ${worst} m`);
    assert.ok(ta.lng.some((k) => Math.abs(k.value) > 180), "longitude stays continuous past ±180 (no seam pair)");
  });
});

// ── 18–19. serialization round trip, determinism ─────────────────────────────
test("terrain complete pose: serialize → parse → continue cycles reach a fixed point and TEXT/DIRECT stay byte-identical", () => {
  const raw = J("Helsinki", [leg("Matterhorn", [st("fly_low", { duration_seconds: 12 })], [st("hold", { duration_seconds: 4 }), st("orbit", { duration_seconds: 14 })])]);
  const r = viaJourney(raw);
  const reparsed = planner.parseDescription(r.compiled.description, { aspect: "16:9" });
  assert.equal(journey.verifyParsedEquivalence(reparsed, r.direct.parsed).ok, true);
  assert.deepEqual(reparsed.segments.map((s) => s.altitude_m), r.direct.parsed.segments.map((s) => s.altitude_m));
  let built = r.built; let lastEsp = null; let identicalCycles = 0;
  for (let i = 0; i < 4; i += 1) {
    const seed = planner.finalCameraState(built.plan, OPT);
    assert.equal(seed.altitude_m, 10214, `cycle ${i}: seed altitude (canonical rake, whatever the approach was)`);
    assert.equal(seed.tilt_deg, 74);
    built = build("orbit Matterhorn once clockwise tilted 74 degrees for 14 seconds", { initialCamera: seed });
    assert.equal(orbitOf(built, "Matterhorn").altitude_m, 10214);
    if (lastEsp === built.artifacts["earth-studio.esp"]) identicalCycles += 1;
    lastEsp = built.artifacts["earth-studio.esp"];
  }
  assert.ok(identicalCycles >= 2, "repeated continuation converges to a byte-stable animation");
});

test("terrain complete pose: repeated generation is deterministic for director, journey and freeform requests", () => {
  const d = director.autoDirect({ aspect: "16:9", stops: [{ location: "Tokyo", role: "STARTING_CONTEXT" }, { location: "Mount Fuji", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] });
  const desc = journey.compileJourney(journey.normalizeJourney(d.journey), { planner }).description;
  [desc, "orbit Kilimanjaro once clockwise tilted 45 degrees for 20 seconds", "fly to Mont Blanc tilted 74 degrees for 8 seconds then hover over Mont Blanc for 2 seconds then orbit Mont Blanc once clockwise tilted 74 degrees for 20 seconds"].forEach((description) => {
    const a = build(description).artifacts; const b = build(description).artifacts; const c = build(description).artifacts;
    Object.keys(a).forEach((k) => { assert.equal(a[k], b[k], `${k} run 2`); assert.equal(a[k], c[k], `${k} run 3`); });
  });
});

// ── 20. calibration footprint preservation + single authority ────────────────
test("terrain complete pose: the human-calibrated 72° footprint is preserved for every declared place at its morphology rake, and one authority serves director, compiler, planner and engine", () => {
  [["Matterhorn", 74], ["Mont Blanc", 74], ["Kilimanjaro", 45], ["Mount Everest", 74], ["Mount Fuji", 45], ["Geirangerfjord", 65]].forEach(([place, rake]) => {
    const loc = planner.resolveLocation(place);
    const footprint = morphology.referenceRadius(loc.altitude_m);
    // director decision
    const decision = director.autoDirect(director.parseIntent(`Show the terrain of ${place}.`)).decisions[0].decision;
    assert.equal(decision.tilt_deg, rake, place);
    // planner resolution (bare)
    const pose = planner.resolveTerrainPose(loc, { tilt_deg: rake });
    assert.equal(decision.altitude_m, pose.camera_altitude_m, `${place}: director and planner resolve the same altitude`);
    assert.equal(decision.terrain_policy.complete_pose.camera_altitude_m, pose.camera_altitude_m);
    // compiler
    const compiled = journey.compileJourney(J(place, [], { start_movements: [st("orbit", { tilt_deg: rake, duration_seconds: 20 })] }), { planner });
    assert.equal(compiled.steps[0].altitude_m, pose.camera_altitude_m, `${place}: compiler resolves the same altitude`);
    assert.equal(compiled.steps[0].altitude_source, "terrain_complete_pose");
    // engine
    const m = measure(build(`orbit ${place} once clockwise tilted ${rake} degrees for 20 seconds`), place);
    assert.ok(Math.abs(m.ring_m - footprint) < 5, `${place}: footprint ${footprint.toFixed(0)} preserved (ring ${m.ring_m.toFixed(0)})`);
    assert.ok(Math.abs(planner.orbitRingRadiusMeters(loc, pose.camera_altitude_m, rake) - footprint) < 2);
  });
  // safety-floor semantics through the same authority: derived rake reduced above the target, footprint held
  const conflict = morphology.completePose({ target_elevation_m: 4000, footprint_altitude_m: 5000 / TAN72, min_altitude_m: 7000, tilt_deg: 74 });
  assert.equal(conflict.safety_clamp.code, "TERRAIN_SAFETY_FLOOR");
  assert.equal(conflict.applied_tilt_deg, 59.03);
  assert.ok(conflict.camera_altitude_m >= 7000 && Math.abs(conflict.ring_radius_m - 5000) < 1);
  // an AUTHORED rake is never re-decided: the floor is applied to the altitude and recorded
  const locked = morphology.completePose({ target_elevation_m: 4000, footprint_altitude_m: 5000 / TAN72, min_altitude_m: 7000, tilt_deg: 74, tilt_locked: true });
  assert.equal(locked.applied_tilt_deg, 74); assert.equal(locked.camera_altitude_m, 7000); assert.equal(locked.safety_clamp.tilt_locked, true);
  withFixtures({ "safety canary": { name: "Safety Canary", latitude: 27.9881, longitude: 86.925, altitude_m: 5000 / TAN72, min_altitude_m: 7000, terrain_morphology: "sharp_peak", morphology_source: "curated_gazetteer", target_elevation_m: 4000, target_anchor_kind: "SURFACE_POI", target_anchor_source: "DECLARED_TERRAIN_FOCAL_POINT", target_anchor_confidence: "HIGH" } }, () => {
    const decided = director.autoDirect(director.parseIntent("Show the terrain of Safety Canary.")).decisions[0].decision;
    assert.equal(decided.tilt_deg, 59.03); assert.equal(decided.terrain_policy.safety_clamp.code, "TERRAIN_SAFETY_FLOOR");
    const stated = orbitOf(build("orbit Safety Canary once clockwise tilted 74 degrees for 20 seconds"), "Safety Canary");
    assert.equal(stated.tilt_deg, 74); assert.equal(stated.altitude_m, 7000); assert.equal(stated.terrain_pose.safety_clamp.tilt_locked, true);
    const inferred = orbitOf(build("orbit Safety Canary once clockwise for 20 seconds"), "Safety Canary");
    assert.equal(inferred.tilt_source, "terrain_safety_floor"); assert.equal(inferred.tilt_deg, 59.03); assert.ok(inferred.altitude_m >= 7000);
  });
});
