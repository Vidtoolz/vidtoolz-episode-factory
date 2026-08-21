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

// ── OPERATOR MOVEMENT AUTHORITY (the settled doctrine) ─────────────────────
// Automatic directing may fill unspecified camera behavior, but it must not
// replace an explicitly specified movement primitive with a different one.

test("director: explicit hover stays a hover — never silently orbited (Case A)", () => {
  const r = D.autoDirect(D.parseIntent("Hover over Helsinki Cathedral."));
  const dec = r.decisions[0].decision;
  // the movement primitive the operator named survives
  assert.strictEqual(dec.movement, "hold", "hover must compile to a hold, not a ring");
  assert.notStrictEqual(dec.movement, "half_orbit");
  assert.ok(dec.tilt_deg == null, "no automatic oblique tilt on an explicit hover");
  // the default opening is retained honestly
  assert.ok(r.journey.opening_camera == null, "no seed for a default opening");
  assert.strictEqual(r.journey.opening_composition.strategy, "DEFAULT_RETAINED");
  assert.strictEqual(r.journey.opening_composition.confidence, "low");
  // provenance rides on the plan too
  assert.strictEqual(r.plan.opening_composition.strategy, "DEFAULT_RETAINED");
  assert.strictEqual(r.plan.opening_camera, null);
  // and the block itself is recorded: WHY automatic obliquity was suppressed
  assert.strictEqual(dec.obliquity.action, "KEEP_FLAT");
  assert.strictEqual(dec.obliquity.source, "USER_SPECIFIED");
  assert.ok(/explicitly specified the opening movement/.test(dec.obliquity.reason), dec.obliquity.reason);
  assert.strictEqual(r.plan.beats[0].obliquity.action, "KEEP_FLAT");
});

test("director: unspecified movement lets the Director promote to a ring (Case B)", () => {
  for (const text of ["Show Helsinki Cathedral.", "Establish Helsinki Cathedral."]) {
    const r = D.autoDirect(D.parseIntent(text));
    const dec = r.decisions[0].decision;
    assert.strictEqual(dec.movement, "half_orbit", `${text}: promoted opening rides a ring`);
    assert.strictEqual(dec.tilt_deg, 50, `${text}: establish-presence band`);
    assert.strictEqual(dec.obliquity.action, "PROMOTE_TO_RING");
    assert.strictEqual(dec.obliquity.promoted_from, "hold", "original grammar recorded");
    assert.strictEqual(dec.obliquity.tilt_band, "establish_presence");
    assert.strictEqual(dec.obliquity.source, "AUTOMATIC");
    assert.ok(dec.obliquity.reason.length > 20, "promotion reason present");
    // the promoted grammar and band ride on the plan beat
    assert.strictEqual(r.plan.beats[0].grammar, "half_orbit");
    assert.strictEqual(r.plan.beats[0].obliquity.action, "PROMOTE_TO_RING");
  }
});

test("director: explicit orbit remains orbit — no rewrite by the obliquity policy", () => {
  const r = D.autoDirect(D.parseIntent("Orbit Helsinki Cathedral."));
  const dec = r.decisions[0].decision;
  assert.strictEqual(dec.movement, "slow_orbit");
  assert.strictEqual(dec.obliquity.action, "KEEP_FLAT");
  assert.strictEqual(dec.obliquity.source, "USER_SPECIFIED");
});

test("director: hover + oblique is a recorded conflict — hover wins, no orbit substitution", () => {
  const r = D.autoDirect(D.parseIntent("Hover over Helsinki Cathedral from an oblique angle."));
  const dec = r.decisions[0].decision;
  assert.strictEqual(dec.movement, "hold", "hover preserved");
  assert.ok(dec.tilt_deg == null, "the un-holdable oblique is declined, not faked");
  assert.strictEqual(dec.obliquity.action, "KEEP_FLAT");
  assert.strictEqual(dec.obliquity.source, "USER_SPECIFIED");
  assert.ok(/oblique/.test(dec.obliquity.reason), "the declined oblique request is recorded");
  assert.ok(/declined/.test(dec.obliquity.reason), dec.obliquity.reason);
});

test("director: explicit orbit + explicit tilt language applies the tilt to the operator's own ring", () => {
  const r = D.autoDirect(D.parseIntent("Orbit Helsinki Cathedral from a low oblique angle."));
  const dec = r.decisions[0].decision;
  assert.strictEqual(dec.movement, "slow_orbit", "orbit remains orbit");
  assert.strictEqual(dec.tilt_deg, 50, "low-oblique band applied to the ring");
  assert.strictEqual(dec.obliquity.action, "APPLY_TILT");
  assert.strictEqual(dec.obliquity.source, "USER_SPECIFIED");
});

test("director: hover parses as an explicit movement primitive", () => {
  assert.strictEqual(D.parseIntent("Hover over Helsinki Cathedral.").stops[0].explicit_grammar, "hold");
  assert.strictEqual(D.parseIntent("Keep the camera stationary over Helsinki Cathedral.").stops[0].explicit_grammar, "hold");
  assert.strictEqual(D.parseIntent("Show Helsinki Cathedral.").stops[0].explicit_grammar, undefined);
  // a movement word inside a NEGATIVE clause is a constraint, not a request
  const negated = D.parseIntent("Show Helsinki Cathedral, don't orbit.");
  assert.strictEqual(negated.stops[0].explicit_grammar, undefined);
  assert.deepStrictEqual(negated.negatives, ["orbit"]);
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

// ── OBLIQUITY GUARD MATRIX — one deterministic test per guard ───────────────
// A base context that WOULD promote; each guard test flips exactly one thing.
const PROMOTABLE = Object.freeze({
  opening_beat: "hold",
  next_beat: null,
  purposes: ["ESTABLISH"],
  role: "PRIMARY_SUBJECT",
  importance: "HIGH",
  scale: "landmark",
  span_m: 500,
  single_stop: true,
  departs: false,
  first_travel: null,
  scale_story_ahead: false,
  flourish_budget: 2,
  negatives: [],
  explicit_movement: null,
  explicit_opening: null,
  continuation: false,
});

test("obliquity: the base context genuinely promotes (guard tests flip one thing each)", () => {
  const out = OC.planOpeningObliquity({ ...PROMOTABLE });
  assert.strictEqual(out.action, "PROMOTE_TO_RING");
  assert.strictEqual(out.movement, "half_orbit");
  assert.strictEqual(out.tilt_deg, 50);
  assert.strictEqual(out.tilt_band, "establish_presence");
  assert.strictEqual(out.source, "AUTOMATIC");
});

test("obliquity guard 1: continuation is never re-framed", () => {
  const out = OC.planOpeningObliquity({ ...PROMOTABLE, continuation: true });
  assert.strictEqual(out.action, "KEEP_FLAT");
  assert.strictEqual(out.source, "CARRIED_OVER");
  assert.ok(/[Cc]ontinuation/.test(out.reason));
});

test("obliquity guard 2: an explicit movement primitive is operator authority", () => {
  const hover = OC.planOpeningObliquity({ ...PROMOTABLE, explicit_movement: "hold" });
  assert.strictEqual(hover.action, "KEEP_FLAT");
  assert.strictEqual(hover.source, "USER_SPECIFIED");
  assert.ok(/never replaces an explicitly specified movement/.test(hover.reason));
  // an explicit orbit is likewise not rewritten (it is not a hold anyway)
  const orbit = OC.planOpeningObliquity({ ...PROMOTABLE, explicit_movement: "slow_orbit", opening_beat: "slow_orbit" });
  assert.strictEqual(orbit.action, "KEEP_FLAT");
  assert.strictEqual(orbit.source, "USER_SPECIFIED");
});

test("obliquity guard 2b: explicit hover + oblique request declines honestly", () => {
  const out = OC.planOpeningObliquity({ ...PROMOTABLE, explicit_movement: "hold", explicit_opening: { oblique: true } });
  assert.strictEqual(out.action, "KEEP_FLAT");
  assert.strictEqual(out.source, "USER_SPECIFIED");
  assert.ok(/oblique/.test(out.reason) && /declined/.test(out.reason), out.reason);
});

test("obliquity guard 3: explicit opening direction outranks automatic bands", () => {
  for (const explicit of [{ tilt_deg: 0 }, { tilt_deg: 45 }, { heading_deg: 90 }]) {
    const out = OC.planOpeningObliquity({ ...PROMOTABLE, explicit_opening: explicit });
    assert.strictEqual(out.action, "KEEP_FLAT", JSON.stringify(explicit));
    assert.strictEqual(out.source, "USER_SPECIFIED");
  }
  // a NON-FINITE explicit tilt must not poison the policy either way
  const nan = OC.planOpeningObliquity({ ...PROMOTABLE, explicit_opening: { tilt_deg: NaN } });
  assert.strictEqual(nan.action, "PROMOTE_TO_RING", "NaN tilt is ignored, not obeyed");
});

test("obliquity guard 4: only a centered hold is promotable", () => {
  for (const beat of ["zoom_in", "zoom_out", "reveal", "slow_orbit", null]) {
    const out = OC.planOpeningObliquity({ ...PROMOTABLE, opening_beat: beat });
    assert.strictEqual(out.action, "KEEP_FLAT", String(beat));
  }
});

test("obliquity guard 5: a staged orbit next beat owns its ring", () => {
  const out = OC.planOpeningObliquity({ ...PROMOTABLE, next_beat: "slow_orbit" });
  assert.strictEqual(out.action, "KEEP_FLAT");
  assert.ok(/planner stages the opening on its ring/.test(out.reason));
});

test("obliquity guard 6: map-view purposes keep the plan view", () => {
  for (const purpose of ["ORIENT", "LOCATE", "SHOW_ROUTE", "COMPARE", "SHOW_SCALE"]) {
    const out = OC.planOpeningObliquity({ ...PROMOTABLE, purposes: [purpose] });
    assert.strictEqual(out.action, "KEEP_FLAT", purpose);
    assert.ok(out.reason.includes(purpose), purpose);
  }
});

test("obliquity guard 7: a scale story ahead pins the anchor rung flat", () => {
  const out = OC.planOpeningObliquity({ ...PROMOTABLE, scale_story_ahead: true });
  assert.strictEqual(out.action, "KEEP_FLAT");
  assert.ok(/scale story/.test(out.reason));
});

test("obliquity guard 8: departure-first openings stay flat", () => {
  const byFlag = OC.planOpeningObliquity({ ...PROMOTABLE, departs: true });
  assert.strictEqual(byFlag.action, "KEEP_FLAT");
  const byTravel = OC.planOpeningObliquity({ ...PROMOTABLE, first_travel: { distance_m: 396000 } });
  assert.strictEqual(byTravel.action, "KEEP_FLAT");
  assert.ok(/departs/.test(byFlag.reason));
});

test("obliquity guard 9: operator negatives block ring promotion", () => {
  for (const negative of ["orbit", "spiral"]) {
    const out = OC.planOpeningObliquity({ ...PROMOTABLE, negatives: [negative] });
    assert.strictEqual(out.action, "KEEP_FLAT", negative);
    assert.strictEqual(out.source, "USER_SPECIFIED");
  }
});

test("obliquity guard 10: large-scale geography keeps the map view", () => {
  for (const scale of ["city", "region", "country", "continent", "globe", undefined]) {
    const out = OC.planOpeningObliquity({ ...PROMOTABLE, scale });
    assert.strictEqual(out.action, "KEEP_FLAT", String(scale));
  }
});

test("obliquity guard 11: a contextual opening place gets bearings, not a performed angle", () => {
  const out = OC.planOpeningObliquity({
    ...PROMOTABLE, role: "STARTING_CONTEXT", importance: "NORMAL", single_stop: false,
  });
  assert.strictEqual(out.action, "KEEP_FLAT");
  assert.ok(/context, not the subject/.test(out.reason));
});

test("obliquity guard 12: an unearned flourish budget blocks the ring", () => {
  for (const budget of [0, -1, undefined]) {
    const out = OC.planOpeningObliquity({ ...PROMOTABLE, flourish_budget: budget });
    assert.strictEqual(out.action, "KEEP_FLAT", String(budget));
    assert.ok(/flourish/.test(out.reason));
  }
});

test("obliquity guard 13: an infeasible ring (> cap) falls back honestly", () => {
  // district-scale span at 50°: altitude ≈ span·cos(tilt)/(2·tan(FOV/2)),
  // ring = altitude·tan(tilt) — 60 km span implies a ring far above 80 km.
  const out = OC.planOpeningObliquity({ ...PROMOTABLE, scale: "district", span_m: 60000 });
  assert.strictEqual(out.action, "KEEP_FLAT");
  assert.ok(/exceeds the generator/.test(out.reason), out.reason);
  assert.strictEqual(out.tilt_deg, null, "no malformed half-decision");
});

// ── POSITIVE PROMOTION CASES AND TILT BANDS ────────────────────────────────

test("obliquity bands: purpose selects the band, config injects the numbers", () => {
  const inspect = OC.planOpeningObliquity({ ...PROMOTABLE, purposes: ["INSPECT"] });
  assert.strictEqual(inspect.action, "PROMOTE_TO_RING");
  assert.strictEqual(inspect.tilt_deg, 60);
  assert.strictEqual(inspect.tilt_band, "inspection");
  const emphasize = OC.planOpeningObliquity({ ...PROMOTABLE, purposes: ["EMPHASIZE"] });
  assert.strictEqual(emphasize.tilt_band, "inspection");
  const terrain = OC.planOpeningObliquity({ ...PROMOTABLE, purposes: ["SHOW_TERRAIN"] });
  assert.strictEqual(terrain.tilt_deg, 72);
  assert.strictEqual(terrain.tilt_band, "terrain_raking");
  // injected camera configuration wins over the standalone fallbacks
  const injected = OC.planOpeningObliquity({ ...PROMOTABLE, purposes: ["INSPECT"], config: { orbit_default_tilt_deg: 55 } });
  assert.strictEqual(injected.tilt_deg, 55);
});

test("obliquity clamping: bands are clamped into the legal tilt window", () => {
  const high = OC.planOpeningObliquity({ ...PROMOTABLE, purposes: ["SHOW_TERRAIN"], config: { terrain_oblique_tilt_deg: 85 } });
  assert.strictEqual(high.tilt_deg, OC.MAX_OBLIQUE_TILT_DEG, "above-horizon tilt clamps to 78");
  const low = OC.planOpeningObliquity({ ...PROMOTABLE, config: { establish_presence_tilt_deg: 5 } });
  assert.strictEqual(low.tilt_deg, OC.MIN_OBLIQUE_TILT_DEG, "sub-oblique tilt clamps to 20");
});

test("obliquity APPLY_TILT: explicit tilt rides an orbit-family opening, clamped below the horizon", () => {
  const plain = OC.planOpeningObliquity({ ...PROMOTABLE, opening_beat: "slow_orbit", explicit_opening: { tilt_deg: 35 } });
  assert.strictEqual(plain.action, "APPLY_TILT");
  assert.strictEqual(plain.tilt_deg, 35);
  assert.strictEqual(plain.source, "USER_SPECIFIED");
  const clamped = OC.planOpeningObliquity({ ...PROMOTABLE, opening_beat: "half_orbit", explicit_opening: { tilt_deg: 85 } });
  assert.strictEqual(clamped.action, "APPLY_TILT");
  assert.strictEqual(clamped.tilt_deg, OC.MAX_OBLIQUE_TILT_DEG);
  assert.ok(/clamped/.test(clamped.reason));
  const banded = OC.planOpeningObliquity({ ...PROMOTABLE, opening_beat: "slow_orbit", explicit_opening: { oblique: true, oblique_band: "high" } });
  assert.strictEqual(banded.action, "APPLY_TILT");
  assert.strictEqual(banded.tilt_deg, 72);
});

test("obliquity: an explicit high/low-oblique wish steers a promotion the policy already allows", () => {
  const high = OC.planOpeningObliquity({ ...PROMOTABLE, explicit_opening: { oblique: true, oblique_band: "high" } });
  assert.strictEqual(high.action, "PROMOTE_TO_RING");
  assert.strictEqual(high.tilt_deg, 72);
  assert.strictEqual(high.source, "USER_SPECIFIED");
  const low = OC.planOpeningObliquity({ ...PROMOTABLE, explicit_opening: { oblique: true, oblique_band: "low" } });
  assert.strictEqual(low.tilt_deg, 50);
  // but it cannot force a promotion restraint has blocked
  const blocked = OC.planOpeningObliquity({ ...PROMOTABLE, flourish_budget: 0, explicit_opening: { oblique: true, oblique_band: "high" } });
  assert.strictEqual(blocked.action, "KEEP_FLAT");
});

// ── NATURAL-LANGUAGE TILT OVERRIDES ─────────────────────────────────────────

test("director: top-down, explicit-degree and oblique language parse deterministically", () => {
  assert.strictEqual(D.parseExplicitOpening("Look straight down at Helsinki.").tilt_deg, 0);
  assert.strictEqual(D.parseExplicitOpening("Show Berlin from directly above.").tilt_deg, 0);
  assert.strictEqual(D.parseExplicitOpening("Keep it top-down.").tilt_deg, 0);
  assert.strictEqual(D.parseExplicitOpening("Open tilted 50 degrees.").tilt_deg, 50);
  assert.strictEqual(D.parseExplicitOpening("Start with an opening tilt 40°.").tilt_deg, 40);
  assert.strictEqual(D.parseExplicitOpening("Tilt 45 degrees over the Colosseum.").tilt_deg, 45);
  // out-of-range degrees are rejected, never silently clamped at parse time
  assert.strictEqual(D.parseExplicitOpening("Tilt 95 degrees over the Colosseum."), null);
  const high = D.parseExplicitOpening("View the Matterhorn from a high oblique angle.");
  assert.strictEqual(high.oblique, true);
  assert.strictEqual(high.oblique_band, "high");
  const generic = D.parseExplicitOpening("Show the Colosseum at an angle.");
  assert.strictEqual(generic.oblique, true);
  assert.strictEqual(generic.oblique_band, undefined);
  // heading and tilt language compose
  const both = D.parseExplicitOpening("Approach from the south, tilt 45 degrees.");
  assert.strictEqual(both.heading_deg, 0);
  assert.strictEqual(both.tilt_deg, 45);
});

test("director: explicit numeric tilt wins over the automatic bands (no promotion)", () => {
  const r = D.autoDirect(D.parseIntent("Show Helsinki Cathedral tilted 45 degrees."));
  const dec = r.decisions[0].decision;
  assert.strictEqual(dec.movement, "hold", "no ring substitution under an explicit tilt");
  assert.strictEqual(r.journey.opening_composition.strategy, "USER_SPECIFIED");
  assert.strictEqual(r.journey.opening_camera.tilt_deg, 45);
  assert.strictEqual(dec.obliquity.action, "KEEP_FLAT");
  assert.strictEqual(dec.obliquity.source, "USER_SPECIFIED");
});

test("director: 'keep it top-down' pins the plan view over any automatic promotion", () => {
  const r = D.autoDirect(D.parseIntent("Show Helsinki Cathedral, and keep it top-down."));
  const dec = r.decisions[0].decision;
  assert.strictEqual(dec.movement, "hold");
  assert.strictEqual(r.journey.opening_composition.strategy, "USER_SPECIFIED");
  assert.strictEqual(r.journey.opening_camera.tilt_deg, 0);
});

// ── DIRECTOR INTEGRATION: RESTRAINT, BUDGET, SCALE STORY, DEPARTURE ────────

test("director: country- and continent-scale subjects keep the map view", () => {
  for (const text of ["Show Finland.", "Show Europe."]) {
    const r = D.autoDirect(D.parseIntent(text));
    const dec = r.decisions[0].decision;
    assert.strictEqual(dec.movement, "hold", text);
    assert.strictEqual(dec.obliquity.action, "KEEP_FLAT", text);
    assert.strictEqual(dec.obliquity.source, "POLICY", text);
  }
});

test("director: negatives block ring promotion end to end", () => {
  const r = D.autoDirect(D.parseIntent("Show Helsinki Cathedral, don't orbit."));
  const dec = r.decisions[0].decision;
  assert.strictEqual(dec.movement, "hold");
  assert.strictEqual(dec.obliquity.action, "KEEP_FLAT");
  assert.strictEqual(dec.obliquity.source, "USER_SPECIFIED");
});

test("director: the scale-reveal opening stays a plan view (canary DIRECTOR-D protection)", () => {
  const r = D.autoDirect({ stops: [
    { location: "Senate Square", role: "PRIMARY_SUBJECT", importance: "HIGH", purposes: ["ESTABLISH"] },
    { location: "Helsinki", role: "SCALE_REFERENCE", purposes: ["SHOW_SCALE"] },
    { location: "Finland", role: "SCALE_REFERENCE", purposes: ["SHOW_SCALE"] },
  ] });
  const dec = r.decisions[0].decision;
  assert.notStrictEqual(dec.movement, "half_orbit");
  assert.strictEqual(dec.obliquity.action, "KEEP_FLAT");
  assert.ok(/scale story|departs/.test(dec.obliquity.reason), dec.obliquity.reason);
});

test("director: a landmark that immediately departs keeps the flat route-facing opening", () => {
  const r = D.autoDirect(D.parseIntent("Start at Helsinki Cathedral, then fly to Stockholm."));
  const dec = r.decisions[0].decision;
  assert.notStrictEqual(dec.movement, "half_orbit");
  assert.strictEqual(dec.obliquity.action, "KEEP_FLAT");
  assert.ok(/departs/.test(dec.obliquity.reason), dec.obliquity.reason);
  // route foreshadowing still owns the heading
  assert.strictEqual(r.journey.opening_composition.strategy, "ROUTE_FORESHADOW");
});

test("director: promotion consumes the selective flourish budget; a block consumes nothing", () => {
  const promoted = D.autoDirect(D.parseIntent("Show Helsinki Cathedral."));
  assert.strictEqual(promoted.decisions[0].decision.rarity, "SELECTIVE");
  assert.ok(promoted.notes.some((n) => /Special\/selective moves used: Half Orbit/.test(n)),
    "the promoted ring is accounted as the selective move it is");
  const blocked = D.autoDirect(D.parseIntent("Hover over Helsinki Cathedral."));
  assert.strictEqual(blocked.decisions[0].decision.rarity, "COMMON");
  assert.ok(blocked.notes.some((n) => /No selective or special moves were used/.test(n)),
    "a blocked promotion draws no flourish budget");
});

test("director: continuation carries authority — no obliquity decision is even attempted", () => {
  const src = D.autoDirect(D.parseIntent("Hover over Helsinki Cathedral, then push in."));
  const plan = P.buildShotPlan("src", src.summary.description);
  const contState = J.continuationStateFromPlan(plan);
  const r = D.autoDirect({ stops: [{ location: "Helsinki" }, { location: "Stockholm" }], continuation_from: contState });
  assert.strictEqual(r.journey.opening_composition.strategy, "CARRIED_OVER");
  assert.ok(r.decisions[0].decision.obliquity === undefined, "automatic composition never touched the hand-off");
  assert.ok(r.plan.continuation, "carried authority recorded on the plan");
});

// ── ZERO-BUMP: a promoted opening begins IN its intended state ──────────────

test("promoted opening: frame 0 is already the intended oblique ring state (no correction bump)", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const lane = require("../earth-studio-lane.js");
  const MC = require("../earth-studio-motion-continuity.js");
  const r = D.autoDirect(D.parseIntent("Show Helsinki Cathedral."));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "obq-bump-"));
  try {
    lane.writeJob(tmp, { jobName: "obq-bump", journey: r.journey }, { now: "2026-01-01T00:00:00Z" });
    const esp = JSON.parse(fs.readFileSync(path.join(tmp, "earth-studio", "earth-studio.esp"), "utf8"));
    const tracks = MC.extractEspCameraTracks(esp);
    // tilt: exactly the promoted band from frame 0, and never corrected
    assert.ok(tracks.tilt.length >= 1);
    assert.strictEqual(tracks.tilt[0].time, 0, "tilt is set at frame 0");
    assert.ok(Math.abs(tracks.tilt[0].value - 50) < 0.5, `frame-0 tilt ${tracks.tilt[0].value}`);
    for (const kf of tracks.tilt) assert.ok(Math.abs(kf.value - 50) < 0.5, "no tilt correction anywhere");
    // altitude: one intentional value, no altitude correction
    assert.strictEqual(tracks.alt.length, 1, "no altitude correction keyframes");
    // heading: a restrained half-revolution sweep — monotonic, exactly 180°
    const pans = tracks.pan.map((kf) => kf.value);
    assert.ok(Math.abs((pans[pans.length - 1] - pans[0]) - 180) < 0.01, `angular travel ${pans[pans.length - 1] - pans[0]}`);
    for (let i = 1; i < pans.length; i += 1) {
      assert.ok(pans[i] >= pans[i - 1] - 1e-9, "no heading reversal (no corrective swing)");
    }
    // ring: the camera is ON the ring from frame 0. The engine's ring is
    // drawn in degree space, so its metric radius varies smoothly with
    // bearing (established orbit geometry, identical for an explicit orbit at
    // HEAD) — what zero-bump forbids is a fast frame-0 CORRECTION: a radial
    // jump between adjacent keyframes, or a settle-then-stable shape.
    const subject = { latitude: 60.1699, longitude: 24.9522 };
    const radii = tracks.lat.map((kf, i) => MC.haversineMeters(
      { latitude: kf.value, longitude: tracks.lng[i].value }, subject));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    for (let i = 1; i < radii.length; i += 1) {
      assert.ok(Math.abs(radii[i] - radii[i - 1]) < mean * 0.02,
        `no radial jump between keyframes (${Math.round(radii[i - 1])} -> ${Math.round(radii[i])} m)`);
    }
    assert.ok(Math.abs(radii[1] - radii[0]) <= Math.abs(radii[Math.floor(radii.length / 2)] - radii[0]),
      "the first step is not a settle: radius change is smooth, not front-loaded");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("explicit hover: the compiled opening acquires no sweep and no tilt", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const lane = require("../earth-studio-lane.js");
  const MC = require("../earth-studio-motion-continuity.js");
  const r = D.autoDirect(D.parseIntent("Hover over Helsinki Cathedral."));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "obq-hover-"));
  try {
    lane.writeJob(tmp, { jobName: "obq-hover", journey: r.journey }, { now: "2026-01-01T00:00:00Z" });
    const esp = JSON.parse(fs.readFileSync(path.join(tmp, "earth-studio", "earth-studio.esp"), "utf8"));
    const tracks = MC.extractEspCameraTracks(esp);
    const pans = tracks.pan.map((kf) => kf.value);
    for (const pan of pans) assert.strictEqual(pan, pans[0], "a hover never sweeps");
    for (const kf of tracks.tilt) assert.ok(Math.abs(kf.value) < 0.5, "a hover stays top-down");
    for (const kf of tracks.lat) assert.strictEqual(kf.value, tracks.lat[0].value, "no position slide");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
