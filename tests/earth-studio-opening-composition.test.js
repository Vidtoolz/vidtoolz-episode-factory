// tests/earth-studio-opening-composition.test.js
// Subject-aware opening composition: deterministic unit + integration tests.
// These prove the ABSENCE of structural defects (continuity, provenance,
// fallback, override, continuation safety) — never beauty.
const { assert, test } = require("./_helpers.js");
const OC = require("../earth-studio-opening-composition.js");
const D = require("../earth-studio-director.js");
const J = require("../earth-studio-journey.js");
const P = require("../earth-studio-job-planner.js");

const HEL = { name: "Helsinki", latitude: 60.1699, longitude: 24.9384 };
const STO = { name: "Stockholm", latitude: 59.3293, longitude: 18.0686 };

test("composition: bearing is antimeridian- and high-latitude-safe", () => {
  // Helsinki -> Stockholm is west-southwest (~256 deg).
  const b = OC.bearingDeg(HEL, STO);
  assert.ok(Math.abs(b - 256.2) < 1.5, `Helsinki->Stockholm bearing ${b}`);
  // Across the antimeridian: 179E -> 179W is due EAST (shortest), not west.
  const east = OC.bearingDeg({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 });
  assert.ok(Math.abs(east - 90) < 0.5, `antimeridian east ${east}`);
  // Unwrapped longitudes (continuation frames may sit outside +/-180).
  const unwrapped = OC.bearingDeg({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: 181 });
  assert.ok(Math.abs(unwrapped - 90) < 0.5, `unwrapped east ${unwrapped}`);
  // Degenerate: same point -> null, never NaN.
  assert.strictEqual(OC.bearingDeg(HEL, HEL), null);
});

test("composition: route foreshadow faces the departure direction", () => {
  const out = OC.planOpening({
    subject: { ...HEL, span_m: 12000, scale: "city" },
    opening_beat: "hold",
    first_travel: { to: STO, distance_m: 396000 },
  });
  assert.strictEqual(out.composition.strategy, "ROUTE_FORESHADOW");
  assert.strictEqual(out.composition.heading_source, "GEOMETRY_DERIVED");
  assert.strictEqual(out.composition.confidence, "high");
  assert.ok(Math.abs(out.opening_camera.pan_deg - 256.2) < 1.5);
  assert.ok(out.composition.reason.includes("Stockholm"));
});

test("composition: short local travel keeps the proven default", () => {
  // 300 m between landmark-scale stops: below the 3x-span / 1.5 km floor.
  const out = OC.planOpening({
    subject: { name: "Helsinki Cathedral", latitude: 60.1699, longitude: 24.9522, span_m: 500, scale: "landmark" },
    opening_beat: "hold",
    first_travel: { to: { name: "Senate Square", latitude: 60.1698, longitude: 24.9521 }, distance_m: 300 },
  });
  assert.strictEqual(out.composition.strategy, "DEFAULT_RETAINED");
  assert.strictEqual(out.opening_camera, null);
  assert.strictEqual(out.composition.confidence, "low");
});

test("composition: explicit operator heading outranks route foreshadow", () => {
  const out = OC.planOpening({
    subject: { ...HEL, span_m: 12000, scale: "city" },
    opening_beat: "hold",
    first_travel: { to: STO, distance_m: 396000 },
    explicit: { heading_deg: 90, source_text: "open looking east" },
  });
  assert.strictEqual(out.composition.strategy, "USER_SPECIFIED");
  assert.strictEqual(out.opening_camera.pan_deg, 90);
});

test("composition: continuation is a hard exception — never re-framed", () => {
  const out = OC.planOpening({
    subject: { ...HEL, span_m: 12000, scale: "city" },
    continuation: true,
    first_travel: { to: STO, distance_m: 396000 },
    explicit: { heading_deg: 90, source_text: "open looking east" },
  });
  assert.strictEqual(out.composition.strategy, "CARRIED_OVER");
  assert.strictEqual(out.opening_camera, null);
  assert.strictEqual(out.composition.heading_source, "CARRIED_OVER");
});

test("composition: orbit-family openings defer to planner ring staging", () => {
  const openingOrbit = OC.planOpening({ subject: { ...HEL, span_m: 500 }, opening_beat: "slow_orbit" });
  assert.strictEqual(openingOrbit.composition.strategy, "ORBIT_STAGING_PLANNER");
  assert.strictEqual(openingOrbit.opening_camera, null);
  const stagedHold = OC.planOpening({ subject: { ...HEL, span_m: 500 }, opening_beat: "hold", next_beat: "slow_orbit" });
  assert.strictEqual(stagedHold.composition.strategy, "ORBIT_STAGING_PLANNER");
});

test("composition: matched comparison keeps one neutral policy", () => {
  const out = OC.planOpening({
    subject: { ...HEL, span_m: 12000, scale: "city" },
    opening_beat: "hold",
    first_travel: { to: STO, distance_m: 396000 },
    compare: { matched: true },
  });
  assert.strictEqual(out.composition.strategy, "COMPARISON_MATCHED");
  assert.strictEqual(out.opening_camera, null);
});

test("composition: opening-to-first-motion continuity audit flags >90 deg swings", () => {
  const bad = OC.auditOpeningContinuity({ opening_heading_deg: 0, first_travel_bearing_deg: 256 });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.warnings[0].includes("OPENING_CONTINUITY"));
  const good = OC.auditOpeningContinuity({ opening_heading_deg: 256, first_travel_bearing_deg: 256 });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.warnings.length, 0);
});

test("director: explicit opening language parses deterministically", () => {
  const side = D.parseExplicitOpening("Approach the Colosseum from the south.");
  assert.strictEqual(side.heading_deg, 0, "camera on the south side looks north");
  const facing = D.parseExplicitOpening("Open looking east over Copenhagen.");
  assert.strictEqual(facing.heading_deg, 90);
  const numeric = D.parseExplicitOpening("Hover over Helsinki Cathedral, heading 220.");
  assert.strictEqual(numeric.heading_deg, 220);
  const topdown = D.parseExplicitOpening("Start top-down over Amsterdam.");
  assert.strictEqual(topdown.tilt_deg, 0);
  const southwest = D.parseExplicitOpening("View from the southwest.");
  assert.strictEqual(southwest.heading_deg, 45, "southwest side -> looking northeast");
  assert.strictEqual(D.parseExplicitOpening("Hover over Helsinki Cathedral."), null);
});

test("director: route-aware opening flows into the first movement", () => {
  const r = D.autoDirect(D.parseIntent("Start in Helsinki, then travel to Stockholm."));
  const cam = r.journey.opening_camera;
  assert.ok(cam && Number.isFinite(cam.pan_deg), "route opening seeded");
  const bearing = OC.bearingDeg(HEL, STO);
  assert.ok(Math.abs(cam.pan_deg - bearing) < 1.5, `opening ${cam.pan_deg} vs bearing ${bearing}`);
  const comp = r.journey.opening_composition;
  assert.strictEqual(comp.strategy, "ROUTE_FORESHADOW");
  assert.strictEqual(comp.heading_source, "GEOMETRY_DERIVED");
  // and the continuity audit found no corrective swing for the seeded heading
  assert.ok(!r.notes.some((n) => String(n).includes("OPENING_CONTINUITY")));
});

test("director: no-travel openings retain the default honestly", () => {
  const r = D.autoDirect(D.parseIntent("Hover over Helsinki Cathedral."));
  assert.ok(r.journey.opening_camera == null, "no seed for a default opening");
  assert.strictEqual(r.journey.opening_composition.strategy, "DEFAULT_RETAINED");
  assert.strictEqual(r.journey.opening_composition.confidence, "low");
  // provenance rides on the plan too
  assert.strictEqual(r.plan.opening_composition.strategy, "DEFAULT_RETAINED");
  assert.strictEqual(r.plan.opening_camera, null);
});

test("director: continuation journeys never auto-compose", () => {
  const src = D.autoDirect(D.parseIntent("Hover over Helsinki Cathedral, then push in."));
  const plan = P.buildShotPlan("src", src.summary.description);
  const contState = J.continuationStateFromPlan(plan);
  assert.ok(contState, "source terminal state available");
  const r = D.autoDirect({ stops: [{ location: "Helsinki" }, { location: "Stockholm" }], continuation_from: contState });
  assert.strictEqual(r.journey.start.source, "continuation");
  assert.strictEqual(r.journey.opening_composition.strategy, "CARRIED_OVER");
  assert.ok(r.journey.opening_camera == null, "no automatic re-heading on continuation");
});

test("director: comparison openings stay comparable", () => {
  const r = D.autoDirect(D.parseIntent("Compare Helsinki and Stockholm from roughly the same scale."));
  assert.strictEqual(r.journey.opening_composition.strategy, "COMPARISON_MATCHED");
  assert.ok(r.journey.opening_camera == null, "no per-city glamour angle");
});

test("planner: a pan-only seed re-orients the opening without touching position", () => {
  const desc = "hover over Helsinki Cathedral tilted 50 degrees for 6 seconds";
  const a = JSON.parse(P.buildArtifacts("a", desc, "2026-01-01T00:00:00Z")["earth-studio.esp"]);
  const b = JSON.parse(P.buildArtifacts("b", desc, "2026-01-01T00:00:00Z", { initialCamera: { pan_deg: 90 } })["earth-studio.esp"]);
  const camGroup = (esp) => esp.scenes[0].attributes[0];
  const panTrack = (esp) => camGroup(esp).attributes.find((g) => g.type === "cameraRotationGroup").attributes.find((x) => x.type === "rotationX");
  const lngTrack = (esp) => camGroup(esp).attributes.find((g) => g.type === "cameraPositionGroup").attributes.find((x) => x.type === "longitude");
  assert.strictEqual(panTrack(a).value.minValueRange, 0, "default opening faces north (pan 0)");
  assert.strictEqual(panTrack(b).value.minValueRange, 90, "seeded opening faces east");
  // position untouched by the pan-only seed
  assert.strictEqual(lngTrack(a).value.minValueRange, lngTrack(b).value.minValueRange);
});

test("lane: opening_camera seed reaches the .esp via the direction payload", () => {
  const lane = require("../earth-studio-lane.js");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-lane-"));
  const r = D.autoDirect(D.parseIntent("Start in Helsinki, then travel to Stockholm."));
  const direction = { plan: r.plan, opening_camera: r.plan.opening_camera };
  lane.writeJob(tmp, { jobName: "oc-lane", journey: r.journey, direction }, { now: "2026-01-01T00:00:00Z" });
  const esp = JSON.parse(fs.readFileSync(path.join(tmp, "earth-studio", "earth-studio.esp"), "utf8"));
  const rot = esp.scenes[0].attributes[0].attributes.find((g) => g.type === "cameraRotationGroup");
  const pan = rot.attributes.find((x) => x.type === "rotationX");
  assert.ok(Math.abs(pan.value.minValueRange - 256.18) < 1.5, `esp opening pan ${pan.value.minValueRange}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});
