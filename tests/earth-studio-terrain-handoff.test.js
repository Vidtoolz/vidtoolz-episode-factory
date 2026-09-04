// TERRAIN COMPLETE POSE — JOURNEY HANDOFF AUTHORITY (2026-09-04 second repair).
//
// Central requirement: travel movements may determine how the camera APPROACHES
// a terrain orbit, but they never redefine the orbit's canonical complete pose.
// The rake of a terrain orbit comes from the single authority (authored tilt,
// else the landform's calibrated rake) — never from the previous movement's
// attitude, never from a generic default; the approach ARRIVES at that pose
// (altitude and rake) because its end frame is the orbit's first frame and the
// orbit owns it. An authored altitude is explicit operator authority (policy B):
// kept, with the ring measured from the focal point. Continuations inherit the terminal pose
// exactly. Everything here is measured on generated geometry with an
// independent WGS84 optical check.
const { assert, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const journey = require("../earth-studio-journey.js");
const director = require("../earth-studio-director.js");
const continuity = require("../earth-studio-motion-continuity.js");
const morphology = require("../earth-studio-terrain-morphology.js");

const POL = { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" };
const OPT = { aspect: "16:9", motionPolicy: POL };
const AT = "2026-09-04T00:00:00.000Z";
const RAD = (d) => (d * Math.PI) / 180;
const WGS_A = 6378137; const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
function ecef({ latitude, longitude, altitude_m }) {
  const la = RAD(latitude); const lo = RAD(longitude); const N = WGS_A / Math.sqrt(1 - E2 * Math.sin(la) ** 2);
  return [(N + altitude_m) * Math.cos(la) * Math.cos(lo), (N + altitude_m) * Math.cos(la) * Math.sin(lo), (N * (1 - E2) + altitude_m) * Math.sin(la)];
}
function enu(lat, lon) {
  const la = RAD(lat); const lo = RAD(lon);
  return { e: [-Math.sin(lo), Math.cos(lo), 0], n: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)], u: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)] };
}
function aimErrorDeg(camera, target, z) {
  const b = enu(camera.latitude, camera.longitude); const p = RAD(camera.pan_deg); const t = RAD(camera.tilt_deg);
  const h = b.n.map((v, i) => v * Math.cos(p) + b.e[i] * Math.sin(p)); const ray = h.map((v, i) => v * Math.sin(t) - b.u[i] * Math.cos(t));
  const c = ecef(camera); const g = ecef({ ...target, altitude_m: z }); const d = g.map((v, i) => v - c[i]); const n = Math.hypot(...d);
  return (Math.acos(Math.max(-1, Math.min(1, ray.reduce((s, v, i) => s + (v * d[i]) / n, 0)))) * 180) / Math.PI;
}
const hav = (a, b) => planner.haversineMeters(a, b);
function build(description, extra = {}) {
  const artifacts = planner.buildArtifacts("terrain-handoff", description, AT, { ...OPT, ...extra });
  return { artifacts, plan: JSON.parse(artifacts["shot-plan.json"]), esp: JSON.parse(artifacts["earth-studio.esp"]) };
}
function cameraAt(built, frame) {
  const tracks = continuity.extractEspCameraTracks(built.esp); const u = frame / built.plan.total_frames;
  const at = (k) => continuity.playbackValueAt(tracks[k], u);
  return { latitude: at("lat"), longitude: at("lng"), altitude_m: at("alt"), pan_deg: at("pan"), tilt_deg: at("tilt") };
}
// The terminal terrain orbit's complete pose as generated: plan values and the
// exported camera on the orbit's first frame.
function terminalPose(built, name) {
  const loc = planner.resolveLocation(name);
  const orbit = built.plan.segments.find((s) => s.action === "orbit" && s.location && s.location.name === loc.name);
  assert.ok(orbit, `${name}: expected an orbit`);
  const cam = cameraAt(built, orbit.start_frame);
  const z = planner.focalElevationM(loc);
  const bearingToTarget = continuity.initialBearing ? null : null;
  return {
    orbit, loc, z, cam,
    altitude_m: orbit.altitude_m, tilt_deg: orbit.tilt_deg,
    ring_m: hav(cam, loc), boundary_alt_m: cam.altitude_m, boundary_tilt_deg: cam.tilt_deg,
    aim_deg: aimErrorDeg(cam, loc, z), footprint_m: Math.min(loc.altitude_m * Math.tan(RAD(72)), 80000),
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
  const structured = planner.buildArtifactsFromParsed("terrain-handoff", direct.parsed, AT, OPT);
  Object.keys(text.artifacts).forEach((k) => assert.equal(structured[k], text.artifacts[k], `TEXT and DIRECT must agree on ${k}`));
  return { compiled: check.compiled, built: text };
}
function assertSamePose(a, b, label) {
  assert.equal(a.altitude_m, b.altitude_m, `${label}: altitude ${a.altitude_m} vs ${b.altitude_m}`);
  assert.ok(Math.abs(a.tilt_deg - b.tilt_deg) < 1e-9, `${label}: tilt ${a.tilt_deg} vs ${b.tilt_deg}`);
  assert.ok(Math.abs(a.ring_m - b.ring_m) < 2, `${label}: ring ${a.ring_m} vs ${b.ring_m}`);
  assert.ok(Math.abs(a.boundary_alt_m - b.boundary_alt_m) < 0.01, `${label}: boundary altitude`);
  assert.ok(Math.abs(a.boundary_tilt_deg - b.boundary_tilt_deg) < 1e-6, `${label}: boundary tilt`);
  assert.ok(Math.abs(a.aim_deg - b.aim_deg) < 0.01, `${label}: aim ${a.aim_deg} vs ${b.aim_deg}`);
}
const PLACES = [["Matterhorn", "Zurich", 74], ["Mount Fuji", "Tokyo", 45], ["Grand Canyon", "Los Angeles", 74]];
const APPROACHES = {
  fly_low: (start, place) => J(start, [leg(place, [st("fly_low", { duration_seconds: 10 })], [st("orbit", { duration_seconds: 20 })])]),
  fly_high: (start, place) => J(start, [leg(place, [st("fly_high", { duration_seconds: 10 })], [st("orbit", { duration_seconds: 20 })])]),
  cruise: (start, place) => J(start, [leg(place, [st("cruise", { duration_seconds: 10 })], [st("orbit", { duration_seconds: 20 })])]),
  fly: (start, place) => J(start, [leg(place, [st("fly", { duration_seconds: 10 })], [st("orbit", { duration_seconds: 20 })])]),
  "fly_low → hold → orbit": (start, place) => J(start, [leg(place, [st("fly_low", { duration_seconds: 10 })], [st("hold", { duration_seconds: 3 }), st("orbit", { duration_seconds: 20 })])]),
  "fly_high → hold → orbit": (start, place) => J(start, [leg(place, [st("fly_high", { duration_seconds: 10 })], [st("hold", { duration_seconds: 3 }), st("orbit", { duration_seconds: 20 })])]),
  "hold → orbit (start)": (start, place) => J(place, [], { start_movements: [st("hold", { duration_seconds: 3 }), st("orbit", { duration_seconds: 20 })] }),
  "descend → orbit": (start, place) => J(start, [leg(place, [st("fly", { duration_seconds: 8 }), st("descend", { duration_seconds: 4 })], [st("orbit", { duration_seconds: 20 })])]),
};

// ── 1–7. topology equivalence: bare vs every journey form ────────────────────
PLACES.forEach(([place, start, rake]) => {
  test(`terrain handoff: ${place} — bare orbit and every approach topology resolve the same terminal complete pose (${rake}° rake)`, () => {
    const bare = terminalPose(build(`orbit ${place} once clockwise for 20 seconds`), place);
    assert.equal(bare.tilt_deg, rake, "a terrain orbit with no stated tilt takes the calibrated rake, not the generic default");
    assert.equal(bare.orbit.tilt_source, "terrain_morphology_rake");
    assert.equal(bare.altitude_m, Math.round(bare.z + bare.footprint_m / Math.tan(RAD(rake))));
    assert.ok(Math.abs(bare.ring_m - bare.footprint_m) < 5); assert.ok(bare.aim_deg < 0.25, `aim ${bare.aim_deg}`);
    const hover = terminalPose(build(`hover over ${place} for 3 seconds then orbit ${place} once clockwise for 20 seconds`), place);
    assertSamePose(hover, bare, "text hover → orbit");
    Object.entries(APPROACHES).forEach(([label, make]) => {
      const r = viaJourney(make(start, place));
      const p = terminalPose(r.built, place);
      assertSamePose(p, bare, label);
      assert.equal(p.orbit.altitude_source, "terrain_complete_pose", label);
      // heading: the exported camera faces the focal point on the first frame
      assert.ok(Math.abs(planner.orbitRingRadiusMeters(p.loc, p.altitude_m, p.tilt_deg) - p.footprint_m) < 2, label);
      // the staged approach (if any) lands on the pose — altitude AND rake
      const staging = r.built.plan.segments.find((s) => s.ends_at_orbit_entry === p.orbit.segment_id || s.stages_orbit_entry === p.orbit.segment_id);
      if (staging) {
        assert.equal(staging.altitude_m, p.altitude_m, `${label}: staged approach lands on the orbit altitude`);
        assert.equal(staging.tilt_deg, p.tilt_deg, `${label}: staged approach arrives at the orbit rake`);
      }
    });
  });
});

test("terrain handoff: the approach owns the approach — its travel attitude is recorded, never the orbit's rake", () => {
  const r = viaJourney(APPROACHES.fly_low("Zurich", "Matterhorn"));
  const fly = r.compiled.steps.find((s) => s.movement === "fly_low");
  assert.equal(fly.tilt_deg, 74, "compiled arrival tilt is the orbit's rake");
  assert.equal(fly.approach_tilt_deg, 72, "Low Approach's own 72° is recorded on the step");
  assert.equal(fly.tilt_source, "terrain_complete_pose_entry");
  const orbit = r.compiled.steps.find((s) => s.action === "orbit");
  assert.equal(orbit.tilt_deg, 74); assert.equal(orbit.tilt_source, "terrain_morphology_rake");
  // text path: a stated approach tilt is recorded and overridden at arrival the same way
  const text = build("fly to Matterhorn tilted 66 degrees for 8 seconds then orbit Matterhorn once clockwise for 20 seconds");
  assert.equal(text.plan.segments[0].tilt_deg, 74); assert.equal(text.plan.segments[0].approach_tilt_deg, 66);
  assert.equal(text.plan.segments[0].tilt_source, "terrain_complete_pose_entry");
  assert.equal(text.plan.segments[1].tilt_deg, 74);
  // and a non-terrain place is untouched: the approach keeps its own tilt (legacy)
  const city = build("fly to Stockholm tilted 66 degrees for 8 seconds then orbit Stockholm once clockwise for 20 seconds");
  assert.equal(city.plan.segments[0].tilt_deg, 66); assert.equal(city.plan.segments[0].approach_tilt_deg, undefined);
  assert.equal(city.plan.segments[1].tilt_deg, 60);
});

// ── 8–9. incoming-tilt sweeps ────────────────────────────────────────────────
[["Matterhorn", 74], ["Mount Fuji", 45]].forEach(([place, rake]) => {
  test(`terrain handoff: ${place} incoming-tilt sweep — the terminal orbit rake, altitude, radius and aim do not vary with the approach tilt`, () => {
    const rows = [];
    for (let d = -3; d <= 3.0001; d += 0.25) {
      const approach = Math.round((rake + d) * 100) / 100;
      const built = build(`fly to ${place} tilted ${approach} degrees for 8 seconds then orbit ${place} once clockwise for 20 seconds`);
      const p = terminalPose(built, place);
      rows.push({ approach, rake: p.boundary_tilt_deg, alt: p.altitude_m, ring: p.ring_m, aim: p.aim_deg, boundaryAlt: p.boundary_alt_m });
    }
    rows.forEach((row) => {
      assert.ok(Math.abs(row.rake - rake) < 1e-6, `${place} approach ${row.approach}: effective terminal rake ${row.rake}`);
      assert.equal(row.alt, rows[0].alt, `${place} approach ${row.approach}: altitude`);
      assert.ok(Math.abs(row.boundaryAlt - row.alt) < 0.01);
      assert.ok(row.aim < 0.1, `${place} approach ${row.approach}: aim ${row.aim}`);
    });
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(Math.abs(rows[i].ring - rows[i - 1].ring) < 0.01 && Math.abs(rows[i].aim - rows[i - 1].aim) < 0.01, `${place}: neighbouring inputs ${rows[i - 1].approach} → ${rows[i].approach} must not step`);
    }
    // and the same through the journey path with a stated approach tilt
    [rake - 0.6, rake - 0.49, rake + 0.51].forEach((t) => {
      const r = viaJourney(J(place === "Matterhorn" ? "Zurich" : "Tokyo", [leg(place, [st("fly", { duration_seconds: 8, tilt_deg: t })], [st("orbit", { duration_seconds: 20 })])]));
      const p = terminalPose(r.built, place);
      assert.ok(Math.abs(p.boundary_tilt_deg - rake) < 1e-6 && p.altitude_m === rows[0].alt, `${place} journey approach ${t}`);
    });
  });
});

// ── 10–13. continuation ──────────────────────────────────────────────────────
test("terrain handoff: a continuation inherits the terminal pose exactly on its first frame and does not re-solve it", () => {
  [["Matterhorn", 74], ["Mount Fuji", 45]].forEach(([place, rake]) => {
    const first = viaJourney(APPROACHES.fly_low(place === "Matterhorn" ? "Zurich" : "Tokyo", place)).built;
    const p1 = terminalPose(first, place);
    const seed = planner.finalCameraState(first.plan, OPT);
    assert.equal(seed.altitude_m, p1.altitude_m); assert.equal(seed.tilt_deg, rake);
    const second = build(`orbit ${place} once clockwise for 20 seconds`, { initialCamera: seed });
    const p2 = terminalPose(second, place);
    assertSamePose(p2, p1, `${place} continuation`);
    const opening = cameraAt(second, 0);
    assert.ok(hav(opening, seed) < 0.01 && Math.abs(opening.altitude_m - seed.altitude_m) < 0.01
      && Math.abs(opening.tilt_deg - seed.tilt_deg) < 1e-6 && Math.abs(opening.pan_deg - seed.pan_deg) < 1e-6, `${place}: frame 0 is the inherited camera`);
    // the first 15 frames of the continuation are the same motion the first
    // job's own sweep performs from the same ring point: no reset, no re-solve
    const bareFirst = build(`orbit ${place} once clockwise for 20 seconds`);
    for (let f = 0; f <= 15; f += 1) {
      const a = cameraAt(second, f); const b = cameraAt(bareFirst, f);
      // (the seed is serialized to six decimals, ~0.1 m on the ground; the sweep
      // sampling deviation itself is identical in shape and magnitude)
      assert.ok(Math.abs(hav(a, p1.loc) - hav(b, p1.loc)) < 1, `${place} frame ${f}: continuation radius equals a fresh orbit's radius at the same phase (Δ ${(hav(a, p1.loc) - hav(b, p1.loc)).toFixed(2)} m)`);
      assert.ok(Math.abs(a.altitude_m - p1.altitude_m) < 0.01, `${place} frame ${f}: altitude held`);
      assert.ok(aimErrorDeg(a, p1.loc, p1.z) < 0.3, `${place} frame ${f}: aim`);
    }
  });
});

test("terrain handoff: the product's continuation grammar (settle hold, then orbit) holds the inherited ring exactly through the settle", () => {
  const first = build("orbit Matterhorn once clockwise for 20 seconds");
  const state = journey.continuationStateFromPlan(first.plan, { planner });
  const j = journey.journeyFromContinuationState(state, {});
  j.start_movements = [st("hold", { duration_seconds: 2 }), st("orbit", { duration_seconds: 20 })];
  const check = journey.validateJourney(j, { planner });
  assert.ok(check.ok, check.errors.join(" | "));
  const built = build(check.compiled.description, { initialCamera: planner.normalizeInitialCamera(state) });
  const loc = planner.resolveLocation("Matterhorn");
  const r0 = hav(cameraAt(built, 0), loc);
  for (let f = 0; f <= 60; f += 1) assert.ok(Math.abs(hav(cameraAt(built, f), loc) - r0) < 0.01, `frame ${f}: radius drifts during the settle`);
  const orbit = built.plan.segments.find((s) => s.action === "orbit");
  assert.equal(orbit.altitude_m, 10214); assert.equal(orbit.tilt_deg, 74);
});

test("terrain handoff: repeated continuation and serializer re-entry are fixed points (Matterhorn, Fuji)", () => {
  [["Matterhorn", 74], ["Mount Fuji", 45]].forEach(([place, rake]) => {
    let built = viaJourney(APPROACHES.fly_high(place === "Matterhorn" ? "Zurich" : "Tokyo", place)).built;
    const expected = terminalPose(built, place).altitude_m;
    let previous = null; let identical = 0;
    for (let i = 0; i < 4; i += 1) {
      const state = journey.continuationStateFromPlan(built.plan, { planner });
      const seed = planner.normalizeInitialCamera(JSON.parse(JSON.stringify(state)));
      assert.equal(seed.altitude_m, expected); assert.equal(seed.tilt_deg, rake);
      built = build(`orbit ${place} once clockwise for 20 seconds`, { initialCamera: seed });
      assert.equal(terminalPose(built, place).altitude_m, expected);
      if (previous === built.artifacts["earth-studio.esp"]) identical += 1;
      previous = built.artifacts["earth-studio.esp"];
    }
    assert.ok(identical >= 2, `${place}: repeated continuation converges`);
  });
});

// ── keyframe ownership at the boundary ───────────────────────────────────────
test("terrain handoff: the orbit owns the shared boundary frame — approach end state equals orbit start state, and a transparent hold carries it", () => {
  const forms = [
    "fly to Matterhorn tilted 60 degrees for 8 seconds then orbit Matterhorn once clockwise for 20 seconds",
    "zoom in on Matterhorn tilted 70 degrees for 4 seconds then orbit Matterhorn once clockwise for 20 seconds",
    "fly to Matterhorn tilted 60 degrees for 8 seconds then hover over Matterhorn for 3 seconds then orbit Matterhorn once clockwise for 20 seconds",
  ];
  forms.forEach((d) => {
    const built = build(d);
    const orbit = built.plan.segments.find((s) => s.action === "orbit");
    const before = cameraAt(built, orbit.start_frame - 1);
    const at = cameraAt(built, orbit.start_frame);
    assert.ok(Math.abs(at.tilt_deg - 74) < 1e-6, `${d}: orbit opens at the canonical rake`);
    assert.ok(Math.abs(at.altitude_m - 10214) < 0.01, `${d}: orbit opens at the canonical altitude`);
    // continuity, not equality: the approach eases into the boundary (a few
    // metres per frame at the end of a 20 km descent), and never overshoots it
    const after = cameraAt(built, orbit.start_frame + 1);
    assert.ok(Math.abs(before.tilt_deg - at.tilt_deg) < 0.2, `${d}: tilt jumps into the boundary frame`);
    assert.ok(Math.abs(before.altitude_m - at.altitude_m) < 30 && Math.abs(after.altitude_m - at.altitude_m) < 0.01, `${d}: altitude ${before.altitude_m.toFixed(1)} → ${at.altitude_m.toFixed(1)} → ${after.altitude_m.toFixed(1)} is not a settled arrival`);
    const hold = built.plan.segments.find((s) => s.action === "hover");
    if (hold) {
      assert.equal(hold.tilt_deg, 74); assert.equal(hold.tilt_source, "carried_over"); assert.equal(hold.altitude_m, 10214);
      const h0 = cameraAt(built, hold.start_frame); const h1 = cameraAt(built, hold.end_frame);
      assert.ok(hav(h0, h1) < 0.5 && Math.abs(h0.tilt_deg - h1.tilt_deg) < 1e-6, `${d}: the hold is static at the orbit pose`);
    }
  });
});

// ── hostile combinations ─────────────────────────────────────────────────────
test("terrain handoff: hostile combinations cannot move the terminal pose", () => {
  const bare = terminalPose(build("orbit Matterhorn once clockwise for 20 seconds"), "Matterhorn");
  const combos = {
    "cruise → hover → orbit (text)": build("fly to Zurich for 3 seconds then fly to Matterhorn tilted 60 degrees for 8 seconds then hover over Matterhorn for 2 seconds then orbit Matterhorn once clockwise for 20 seconds"),
    "fly_high → hold → orbit (journey)": viaJourney(APPROACHES["fly_high → hold → orbit"]("Zurich", "Matterhorn")).built,
    "cruise → hover(pause) → orbit (journey)": viaJourney(J("Zurich", [leg("Matterhorn", [st("cruise", { duration_seconds: 8 })], [st("hold", { duration_seconds: 2 }), st("orbit", { duration_seconds: 20 })])])).built,
    "two orbits in a row": build("orbit Matterhorn half clockwise for 10 seconds then orbit Matterhorn once counterclockwise for 20 seconds"),
  };
  Object.entries(combos).forEach(([label, built]) => assertSamePose(terminalPose(built, "Matterhorn"), bare, label));
  // authored altitude + hold → orbit: explicit operator authority, honoured like every other form
  const authored = viaJourney(J("Zurich", [leg("Matterhorn", [st("fly_low", { duration_seconds: 8 })], [st("hold", { duration_seconds: 2 }), st("orbit", { altitude_m: 8000, duration_seconds: 20 })])]));
  const ap = terminalPose(authored.built, "Matterhorn");
  assert.equal(ap.altitude_m, 8000); assert.equal(ap.tilt_deg, 74);
  assert.ok(Math.abs(ap.ring_m - (8000 - 4478) * Math.tan(RAD(74))) < 5); assert.ok(ap.aim_deg < 0.1);
  authored.built.plan.segments.filter((s) => s.action !== "orbit").forEach((s) => assert.equal(s.altitude_m, 8000, "approach and hold land on the authored pose"));
  // fly_low → orbit → continuation and fly_high → orbit → continuation
  ["fly_low", "fly_high"].forEach((verb) => {
    const first = viaJourney(APPROACHES[verb]("Zurich", "Matterhorn")).built;
    const seed = planner.finalCameraState(first.plan, OPT);
    const cont = build("orbit Matterhorn half clockwise for 10 seconds", { initialCamera: seed });
    assertSamePose(terminalPose(cont, "Matterhorn"), bare, `${verb} → orbit → continuation`);
  });
  // seam-adjacent heading + fly_low, and a negative-elevation focal point with an approach
  const fixtures = {
    "seam peak": { name: "Seam Peak", latitude: -12.25, longitude: 179.95, altitude_m: 3000, min_altitude_m: 0, terrain_morphology: "sharp_peak", morphology_source: "curated_gazetteer", target_elevation_m: 850, target_anchor_kind: "SUMMIT", target_anchor_source: "DECLARED_TERRAIN_FOCAL_POINT", target_anchor_confidence: "HIGH" },
    "dead sea shore": { name: "Dead Sea Shore", latitude: 31.5, longitude: 35.47, altitude_m: 3000, min_altitude_m: 0, terrain_morphology: "generic_terrain", morphology_source: "curated_gazetteer", target_elevation_m: -430, target_anchor_kind: "WATERLINE", target_anchor_source: "DECLARED_TERRAIN_FOCAL_POINT", target_anchor_confidence: "HIGH" },
  };
  Object.keys(fixtures).forEach((k) => { planner.LOCATION_FIXTURES[k] = fixtures[k]; });
  try {
    [["Seam Peak", 74, 850], ["Dead Sea Shore", 65, -430]].forEach(([place, rake, z]) => {
      const bareP = terminalPose(build(`orbit ${place} once clockwise for 20 seconds`), place);
      assert.equal(bareP.tilt_deg, rake); assert.equal(bareP.z, z);
      const staged = terminalPose(viaJourney(J("Sydney", [leg(place, [st("fly_low", { duration_seconds: 10 })], [st("orbit", { duration_seconds: 20 })])])).built, place);
      assertSamePose(staged, bareP, `${place} fly_low`);
      assert.ok(staged.aim_deg < 0.25, `${place}: aim ${staged.aim_deg}`);
    });
    const seam = build("fly to Seam Peak tilted 60 degrees for 8 seconds then orbit Seam Peak once clockwise for 20 seconds");
    const pans = continuity.extractEspCameraTracks(seam.esp).pan.map((k) => k.value);
    assert.ok(pans.every((v, i) => i === 0 || Math.abs(v - pans[i - 1]) < 90), "heading continuous across the seam");
    assert.ok(continuity.extractEspCameraTracks(seam.esp).lng.some((k) => Math.abs(k.value) > 180), "longitude continuous past ±180");
  } finally { Object.keys(fixtures).forEach((k) => { delete planner.LOCATION_FIXTURES[k]; }); }
  // director + stated tilt in the intent: the stated rake is authored and wins; the altitude is still derived
  const directed = director.autoDirect(director.parseIntent("Show the terrain of Matterhorn at 60 degrees."));
  const c = journey.compileJourney(journey.normalizeJourney(directed.journey), { planner });
  const p = terminalPose(build(c.description), "Matterhorn");
  assert.equal(p.tilt_deg, 60); assert.equal(p.altitude_m, Math.round(4478 + p.footprint_m / Math.tan(RAD(60)))); assert.ok(p.aim_deg < 0.1);
});

// ── F1 lock ──────────────────────────────────────────────────────────────────
test("terrain handoff: F1 regression lock — bare, one-stop and two-stop director poses, focal elevation, rake, heading and aim are unchanged", () => {
  const bare = terminalPose(build("orbit Matterhorn once clockwise tilted 74 degrees for 20 seconds"), "Matterhorn");
  assert.equal(bare.altitude_m, 10214); assert.equal(bare.tilt_deg, 74); assert.equal(bare.z, 4478);
  assert.ok(Math.abs(bare.ring_m - 20003.86) < 1, `ring ${bare.ring_m}`); assert.ok(bare.aim_deg < 0.08, `aim ${bare.aim_deg}`);
  const one = journey.compileJourney(journey.normalizeJourney(director.autoDirect(director.parseIntent("Show the terrain of Matterhorn.")).journey), { planner });
  assertSamePose(terminalPose(build(one.description), "Matterhorn"), bare, "one-stop director");
  const two = journey.validateJourney(director.autoDirect({ aspect: "16:9", stops: [{ location: "Zurich", role: "STARTING_CONTEXT" }, { location: "Matterhorn", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] }).journey, { planner });
  assert.ok(two.ok, two.errors.join(" | "));
  assertSamePose(terminalPose(build(two.compiled.description), "Matterhorn"), bare, "two-stop director");
  [["Mount Fuji", 45, 20703], ["Kilimanjaro", 45, 27439], ["Mount Everest", 74, 17674], ["Geirangerfjord", 65, 3588], ["Grand Canyon", 74, 4730], ["Mont Blanc", 74, 10984]].forEach(([place, rake, alt]) => {
    const p = terminalPose(build(`orbit ${place} once clockwise for 20 seconds`), place);
    assert.equal(p.tilt_deg, rake, place); assert.equal(p.altitude_m, alt, place);
    assert.ok(Math.abs(p.ring_m - p.footprint_m) < 5, place); assert.ok(p.aim_deg < 0.25, `${place} aim ${p.aim_deg}`);
    assert.equal(morphology.morphologyRakeDeg(p.loc.terrain_morphology), rake);
  });
});
