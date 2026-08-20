// Tests for the Earth Studio CAMERA JOURNEY builder (journey_version 1).
//
// The journey model is a GUI-facing abstraction over the proven generator: it
// compiles to the planner's own description grammar and the existing keyframe
// engine / easing profile / .esp serializer then run unchanged. These tests
// therefore assert two different things:
//   1. the journey model itself (shape, framing, pacing, validation, continuation)
//   2. that compiling a journey lands on the planner primitives it claims to,
//      and that the byte-frozen path for non-journey jobs is untouched.
// No network, no real renders, no VIDNAS writes.
const { assert, fs, os, path, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const journey = require("../earth-studio-journey.js");
const lane = require("../earth-studio-lane.js");

function tmpPkg() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-journey-"));
  const pkg = path.join(root, "aigen", "script-packages", "es-journey-project");
  fs.mkdirSync(pkg, { recursive: true });
  return pkg;
}
const laneFile = (pkg, f) => path.join(pkg, "earth-studio", f);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// A movement step with an explicit duration, so a test's expected total is exact.
const step = (type, seconds, extra) => ({ type, duration_seconds: seconds, ...(extra || {}) });

// ── Journey model ───────────────────────────────────────────────────────────

test("journey model: a start with only an opening movement is a complete journey", () => {
  const j = journey.normalizeJourney({
    start: { location: "Helsinki" },
    start_movements: [step("slow_orbit", 12)],
  });
  assert.equal(j.journey_version, 1);
  assert.equal(j.legs.length, 0);
  const check = journey.validateJourney(j);
  assert.ok(check.ok, `expected valid, got: ${check.errors.join("; ")}`);
  assert.equal(check.compiled.steps.length, 1);
  assert.equal(check.compiled.steps[0].action, "orbit");
  assert.equal(check.compiled.total_duration_seconds, 12);
});

test("journey model: start + one destination compiles start movement, travel, destination movement in order", () => {
  const j = journey.normalizeJourney({
    start: { location: "Helsinki" },
    start_movements: [step("slow_orbit", 10)],
    legs: [{
      destination: { location: "Stockholm" },
      travel_style: "direct",
      travel: [step("fly", 14)],
      movements: [step("orbit", 8)],
    }],
  });
  const c = journey.compileJourney(j);
  assert.deepEqual(c.steps.map((s) => s.action), ["orbit", "fly_to", "orbit"]);
  assert.deepEqual(c.steps.map((s) => s.location_name), ["Helsinki", "Stockholm", "Stockholm"]);
  assert.equal(c.total_duration_seconds, 32);
  // the flight knows its real ground distance (Helsinki -> Stockholm ~ 396 km)
  assert.ok(c.steps[1].distance_m > 350000 && c.steps[1].distance_m < 450000, `distance ${c.steps[1].distance_m}`);
});

test("journey model: three destinations produce one travel + one stop per leg, in route order", () => {
  const j = journey.normalizeJourney({
    start: { location: "Helsinki" },
    start_movements: [step("hold", 4)],
    legs: ["Stockholm", "Copenhagen", "Berlin"].map((d) => ({
      destination: { location: d },
      travel_style: "direct",
      travel: [step("fly", 10)],
      movements: [step("slow_orbit", 12)],
    })),
  });
  const c = journey.compileJourney(j);
  assert.equal(j.legs.length, 3);
  assert.deepEqual(c.steps.map((s) => s.action), ["hover", "fly_to", "orbit", "fly_to", "orbit", "fly_to", "orbit"]);
  assert.deepEqual(c.steps.filter((s) => s.action === "fly_to").map((s) => s.location_name), ["Stockholm", "Copenhagen", "Berlin"]);
  assert.equal(c.total_duration_seconds, 4 + (10 + 12) * 3);
  const check = journey.validateJourney(j);
  assert.ok(check.ok, check.errors.join("; "));
});

test("journey model: a travel block holds several sequential movements", () => {
  const j = journey.normalizeJourney({
    start: { location: "Helsinki" },
    start_movements: [],
    legs: [{
      destination: { location: "Stockholm" },
      travel_style: "custom",
      travel: [step("pull_back", 3), step("cruise", 10), step("descend", 4)],
      movements: [step("hold", 2)],
    }],
  });
  const c = journey.compileJourney(j);
  assert.deepEqual(c.steps.map((s) => s.movement), ["pull_back", "cruise", "descend", "hold"]);
  assert.deepEqual(c.steps.map((s) => s.action), ["zoom_out", "fly_to", "zoom_in", "hover"]);
  // pull back happens at the ORIGIN, cruise/descend at the destination
  assert.equal(c.steps[0].location_name, "Helsinki");
  assert.equal(c.steps[1].location_name, "Stockholm");
  // the cruise holds the altitude the pull-back reached
  assert.equal(c.steps[1].altitude_m, c.steps[0].altitude_m);
  assert.equal(c.total_duration_seconds, 19);
});

test("journey model: destinations reorder without rebuilding the journey", () => {
  const mk = (d) => ({ destination: { location: d }, travel_style: "direct", travel: [step("fly", 8)], movements: [step("hold", 3)] });
  let j = journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [step("hold", 2)],
    legs: [mk("Stockholm"), mk("Copenhagen"), mk("Berlin")],
  });
  const names = (x) => x.legs.map((l) => l.destination.location);
  assert.deepEqual(names(j), ["Stockholm", "Copenhagen", "Berlin"]);
  j = journey.moveLeg(j, 2, -1);
  assert.deepEqual(names(j), ["Stockholm", "Berlin", "Copenhagen"]);
  j = journey.moveLeg(j, 0, 1);
  assert.deepEqual(names(j), ["Berlin", "Stockholm", "Copenhagen"]);
  // out-of-range moves are no-ops, not corruption
  assert.deepEqual(names(journey.moveLeg(j, 0, -1)), ["Berlin", "Stockholm", "Copenhagen"]);
  assert.deepEqual(names(journey.moveLeg(j, 2, 1)), ["Berlin", "Stockholm", "Copenhagen"]);
  // the reordered route compiles, and the flights follow the NEW order
  const c = journey.compileJourney(j);
  assert.deepEqual(c.steps.filter((s) => s.action === "fly_to").map((s) => s.location_name), ["Berlin", "Stockholm", "Copenhagen"]);
});

test("journey model: presets populate the same journey model, not a parallel one", () => {
  Object.keys(journey.JOURNEY_PRESETS).forEach((key) => {
    const j = journey.applyPreset(key, ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]);
    assert.equal(j.journey_version, 1, `${key} version`);
    assert.equal(j.preset, key);
    const check = journey.validateJourney(j);
    assert.ok(check.ok, `${key} must be valid: ${check.errors.join("; ")}`);
    assert.ok(check.compiled.steps.length >= 1, `${key} produced no movements`);
    // every compiled step is one of the five proven planner primitives
    check.compiled.steps.forEach((s) => {
      assert.ok(["fly_to", "hover", "orbit", "zoom_in", "zoom_out"].includes(s.action), `${key}: ${s.action}`);
    });
  });
  assert.equal(journey.applyPreset("multi_city", ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]).legs.length, 3);
});

// ── Compile fidelity: the journey must land on what it claims ───────────────

test("journey compile: every compiled movement is verified back through the real planner", () => {
  const cases = [
    journey.applyPreset("establish", ["Eiffel Tower"]),
    journey.applyPreset("city_to_city", ["Helsinki", "Stockholm"]),
    journey.applyPreset("multi_city", ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]),
    journey.applyPreset("location_reveal", ["Suomenlinna"]),
    journey.applyPreset("orbit_and_depart", ["Paris", "Berlin"]),
    journey.normalizeJourney({
      start: { location: "60.1699,24.9384" }, start_movements: [step("half_orbit", 7, { direction: -1 })],
      legs: [{ destination: { location: "Tallinn" }, travel_style: "low_approach", travel: [step("fly_low", 9)], movements: [step("spiral_in", 15)] }],
    }),
  ];
  cases.forEach((j) => {
    const c = journey.compileJourney(j);
    const v = journey.verifyCompilation(c);
    assert.ok(v.ok, `round-trip failed: ${v.problems.join(" | ")}`);
    // the planner parsed exactly as many segments as the journey has movements
    assert.equal(v.parsed.segments.length, c.steps.length);
    // and none of them needed manual review
    v.parsed.segments.forEach((seg) => assert.equal(seg.resolution_status, "resolved", `${seg.source_text}: ${seg.warnings.join(", ")}`));
  });
});

test("journey compile: orbit direction and revolutions survive the description grammar", () => {
  const j = journey.normalizeJourney({
    start: { location: "Paris" },
    start_movements: [step("orbit_twice", 30, { direction: -1 }), step("half_orbit", 8, { direction: 1 })],
  });
  const c = journey.compileJourney(j);
  assert.equal(c.steps[0].orbit_degrees, 720);
  assert.equal(c.steps[0].orbit_direction, -1);
  assert.equal(c.steps[1].orbit_degrees, 180);
  assert.equal(c.steps[1].orbit_direction, 1);
  const parsed = planner.parseDescription(c.description);
  assert.equal(parsed.segments[0].orbit_degrees, 720);
  assert.equal(parsed.segments[0].orbit_direction, -1);
  assert.equal(parsed.segments[1].orbit_degrees, 180);
  assert.equal(parsed.segments[1].orbit_direction, 1);
});

test("journey compile: a Hold emits no altitude or tilt so the planner's camera hold survives", () => {
  const j = journey.normalizeJourney({
    start: { location: "Paris" },
    start_movements: [step("orbit", 12), step("hold", 5)],
  });
  const c = journey.compileJourney(j);
  const hold = c.steps[1];
  assert.equal(hold.action, "hover");
  assert.equal(hold.emit_altitude, false);
  assert.equal(hold.emit_tilt, false);
  assert.doesNotMatch(hold.phrase, /\bat \d+m\b/);
  assert.doesNotMatch(hold.phrase, /tilted/);
  // the planner recognises it as a true camera hold (holds_camera), i.e. the
  // camera stays on the orbit ring instead of sliding back to the centre
  const parsed = planner.parseDescription(c.description);
  assert.equal(parsed.segments[1].holds_camera, true);
});

// ── Auto-framing ────────────────────────────────────────────────────────────

test("framing: the derived altitude ladder is strictly monotonic from landmark to continent", () => {
  const ladder = journey.SCALE_LADDER.filter((k) => k !== "globe");
  const alts = ladder.map((k) => journey.framingAltitudeM(k, 45));
  for (let i = 1; i < alts.length; i += 1) {
    assert.ok(alts[i] > alts[i - 1], `${ladder[i]} (${alts[i]}m) must be farther than ${ladder[i - 1]} (${alts[i - 1]}m)`);
  }
  // a small landmark gets a much closer camera than a country
  assert.ok(journey.framingAltitudeM("landmark", 45) * 100 < journey.framingAltitudeM("country", 45),
    "a landmark must be framed at least two orders of magnitude closer than a country");
});

test("framing: the optical law agrees with the hand-validated gazetteer calibration", () => {
  // The Eiffel Tower's gazetteer altitude (1000 m) was validated by hand. The
  // derived law for a landmark-scale span at the default tilt must land on it,
  // which is what makes the derivation trustworthy for uncalibrated places.
  const derived = journey.framingAltitudeM("landmark", 45);
  const calibrated = planner.LOCATION_FIXTURES["eiffel tower"].altitude_m;
  assert.ok(Math.abs(derived - calibrated) / calibrated < 0.05,
    `derived ${derived}m vs calibrated ${calibrated}m must agree within 5%`);
  // and the law is the documented identity, not a table lookup
  const fov = planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
  const rad = (d) => (d * Math.PI) / 180;
  const expected = (journey.FRAMING_SCALES.city.span_m * Math.cos(rad(45))) / (2 * Math.tan(rad(fov / 2)));
  assert.equal(journey.framingAltitudeM("city", 45), Math.round(expected));
});

test("framing: city vs region vs country give three clearly different camera distances", () => {
  const j = (place) => journey.compileJourney(journey.normalizeJourney({
    start: { location: place }, start_movements: [step("hold", 3), step("zoom_in", 5)],
  })).steps[1].altitude_m;   // the zoom_in target altitude reflects the framing
  const city = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [step("orbit", 10)] })).steps[0];
  const region = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Lapland" }, start_movements: [step("orbit", 10)] })).steps[0];
  const country = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Finland" }, start_movements: [step("orbit", 10)] })).steps[0];
  assert.equal(city.framing_scale, "city");
  assert.equal(region.framing_scale, "region");
  assert.equal(country.framing_scale, "country");
  assert.ok(city.altitude_m < region.altitude_m, `city ${city.altitude_m} < region ${region.altitude_m}`);
  assert.ok(region.altitude_m < country.altitude_m, `region ${region.altitude_m} < country ${country.altitude_m}`);
  assert.ok(j("Eiffel Tower") < city.altitude_m, "a landmark is closer than a city");
});

test("framing: known multi-country regions use physical extent, not the local region rung", () => {
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Scandinavia" }, start_movements: [{ type: "hold", duration_seconds: 4 }],
  }));
  assert.equal(c.steps[0].framing_scale, "region");
  assert.equal(c.steps[0].altitude_source, "derived_optical_extent");
  assert.ok(c.steps[0].altitude_m > 4000000, `Scandinavia should fit as a multi-country region, got ${c.steps[0].altitude_m}`);
});

test("framing: a destination is auto-framed by its own size, not the start's", () => {
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Eiffel Tower" },
    start_movements: [step("hold", 3)],
    legs: [{ destination: { location: "Finland" }, travel_style: "direct", travel: [step("fly", 20)], movements: [step("orbit", 25)] }],
  }));
  const arrival = c.steps.find((s) => s.action === "fly_to");
  const atDest = c.steps[c.steps.length - 1];
  assert.equal(atDest.framing_scale, "country");
  assert.ok(atDest.altitude_m > 1000000, `country framing should be far out, got ${atDest.altitude_m}`);
  assert.ok(arrival.altitude_m > 1000000, "the flight must arrive at the destination's own framing");
  // ...and the reverse direction frames the landmark closely
  const back = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Finland" },
    start_movements: [step("hold", 3)],
    legs: [{ destination: { location: "Eiffel Tower" }, travel_style: "direct", travel: [step("fly", 20)], movements: [step("orbit", 12)] }],
  }));
  assert.ok(back.steps[back.steps.length - 1].altitude_m < 3000,
    `landmark destination should be close, got ${back.steps[back.steps.length - 1].altitude_m}`);
});

test("framing: a manual scale and a manual altitude both override AUTO", () => {
  const auto = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki", framing: "auto" }, start_movements: [step("orbit", 10)] })).steps[0];
  const manualScale = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki", framing: "landmark" }, start_movements: [step("orbit", 10)] })).steps[0];
  const manualAlt = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki", altitude_m: 4321 }, start_movements: [step("orbit", 10)] })).steps[0];
  assert.equal(auto.framing_scale, "city");
  assert.equal(manualScale.framing_scale, "landmark");
  assert.ok(manualScale.altitude_m < auto.altitude_m);
  assert.equal(manualAlt.altitude_m, 4321);
  assert.equal(manualAlt.altitude_source, "manual_altitude");
  // a per-step altitude override wins over the place's framing
  const stepAlt = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [step("orbit", 10, { altitude_m: 999 })] })).steps[0];
  assert.equal(stepAlt.altitude_m, 999);
  // ...and the planner reads back exactly that altitude
  assert.equal(planner.parseDescription(journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [step("orbit", 10, { altitude_m: 999 })] })).description).segments[0].altitude_m, 999);
});

test("framing: scale classification uses the gazetteer, overrides, calibration and keywords", () => {
  const at = (name) => journey.classifyScale(planner.resolveLocation(name), name);
  assert.equal(at("Finland").scale, "country");
  assert.equal(at("Finland").source, "gazetteer_scale");
  assert.equal(at("Europe").scale, "continent");
  assert.equal(at("Baltic Sea").scale, "region");
  assert.equal(at("Midtown Manhattan").scale, "district");
  assert.equal(at("Midtown Manhattan").source, "classified_override");
  assert.equal(at("Eiffel Tower").scale, "landmark");
  assert.equal(at("Eiffel Tower").source, "calibrated_altitude");
  assert.equal(at("Helsinki").scale, "city");
  // an explicit coordinate pair carries NO size information and says so
  assert.equal(at("60.17,24.94").source, "assumed_coordinates");
  // an unknown free-text name falls back to keyword cues
  assert.equal(journey.classifyScale(null, "Some Grand Cathedral").scale, "landmark");
  assert.equal(journey.classifyScale(null, "Northern Highlands").scale, "region");
});

// ── Calm pacing ─────────────────────────────────────────────────────────────

test("pacing: calm is the default and every preset scales the validated baseline", () => {
  assert.equal(journey.DEFAULT_PACE, "calm");
  assert.equal(journey.normalizeJourney({}).pace, "calm");
  assert.equal(journey.PACE_PRESETS.standard.factor, 1);
  const order = ["quick", "standard", "relaxed", "calm"];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(journey.PACE_PRESETS[order[i]].factor > journey.PACE_PRESETS[order[i - 1]].factor,
      `${order[i]} must be slower than ${order[i - 1]}`);
  }
  // the same journey gets longer as the pace calms, and every step is affected
  const durations = order.map((p) => journey.compileJourney(journey.normalizeJourney({
    pace: p, start: { location: "Helsinki" }, start_movements: [{ type: "slow_orbit" }],
    legs: [{ destination: { location: "Stockholm" }, travel_style: "direct", travel: [{ type: "fly" }], movements: [{ type: "orbit" }] }],
  })).total_duration_seconds);
  for (let i = 1; i < durations.length; i += 1) {
    assert.ok(durations[i] > durations[i - 1], `${order[i]} (${durations[i]}s) must be longer than ${order[i - 1]} (${durations[i - 1]}s)`);
  }
});

test("pacing: suggested flight duration grows with geographic distance", () => {
  // The journey must already be somewhere for a flight to be a CROSSING: a
  // flight that opens the journey is an establishing dive onto the target, and
  // the generator (and therefore the suggestion) ignores distance for it.
  const flight = (dest) => journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [step("hold", 3)],
    legs: [{ destination: { location: dest }, travel_style: "direct", travel: [{ type: "fly" }], movements: [] }],
  })).steps[1];
  const short = flight("Espoo");        // ~ 21 km
  const medium = flight("Stockholm");   // ~ 396 km
  const long = flight("Tokyo");         // ~ 7800 km
  assert.ok(short.distance_m < medium.distance_m && medium.distance_m < long.distance_m, "test fixture distances");
  assert.ok(short.duration_seconds < medium.duration_seconds,
    `a 21 km hop (${short.duration_seconds}s) must be quicker than a 396 km flight (${medium.duration_seconds}s)`);
  assert.ok(medium.duration_seconds < long.duration_seconds,
    `a 396 km flight (${medium.duration_seconds}s) must be quicker than a 7800 km flight (${long.duration_seconds}s)`);
  // and a suggested range is offered, not a single magic number
  assert.ok(long.suggestion.low_seconds < long.suggestion.seconds || long.suggestion.low_seconds === long.suggestion.seconds);
  assert.ok(long.suggestion.high_seconds >= long.suggestion.seconds);
  // A flight used as the journey's FIRST movement is the establishing dive, so
  // its suggestion is distance-independent (matching the generator's own rule).
  const opener = (dest) => journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [],
    legs: [{ destination: { location: dest }, travel_style: "direct", travel: [{ type: "fly" }], movements: [] }],
  })).steps[0];
  assert.equal(opener("Espoo").distance_m !== null, true, "the distance is still reported");
  assert.equal(opener("Espoo").duration_seconds, opener("Tokyo").duration_seconds,
    "an opening flight is an establishing dive, not a crossing");
});

test("pacing: different movement classes get different suggested durations", () => {
  const at = (type) => journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [{ type }] })).steps[0];
  const hold = at("hold"), orbit = at("orbit"), slow = at("slow_orbit"), twice = at("orbit_twice");
  assert.ok(hold.duration_seconds < orbit.duration_seconds, "a hold is shorter than an orbit");
  assert.ok(slow.duration_seconds > orbit.duration_seconds, "a slow orbit is slower than a normal orbit");
  assert.ok(twice.duration_seconds > orbit.duration_seconds * 1.5, "two revolutions take about twice as long");
  // a tighter orbit takes longer per revolution (validated proximity rule)
  const shallow = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "orbit", tilt_deg: 10 }] })).steps[0];
  const steep = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "orbit", tilt_deg: 70 }] })).steps[0];
  assert.ok(steep.duration_seconds > shallow.duration_seconds,
    `a tilted (closer) orbit must be given more time: ${steep.duration_seconds}s vs ${shallow.duration_seconds}s`);
});

test("pacing: an explicit duration always wins over the suggestion", () => {
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [step("slow_orbit", 3)] }));
  assert.equal(c.steps[0].duration_seconds, 3);
  assert.equal(c.steps[0].duration_source, "manual");
  assert.ok(c.steps[0].suggestion.seconds !== 3, "the suggestion is still reported alongside");
  assert.equal(planner.parseDescription(c.description).segments[0].duration_seconds, 3);
});

test("duration: the total is the sum of the movements and matches the plan the generator builds", () => {
  const j = journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [step("slow_orbit", 6)],
    legs: [
      { destination: { location: "Stockholm" }, travel_style: "custom", travel: [step("pull_back", 3), step("cruise", 14), step("descend", 4)], movements: [step("orbit", 6)] },
      { destination: { location: "Copenhagen" }, travel_style: "direct", travel: [step("fly", 10)], movements: [step("slow_orbit", 5)] },
    ],
  });
  const sum = journey.summarizeJourney(j);
  assert.equal(sum.total_duration_seconds, 6 + 3 + 14 + 4 + 6 + 10 + 5);
  assert.equal(sum.total_duration_seconds, 48);
  assert.equal(sum.total_clock, "00:48");
  assert.equal(sum.total_frames, 48 * planner.FRAME_RATE);
  assert.equal(sum.breakdown.reduce((a, b) => a + b.seconds, 0), 48);
  // ...and the real planner agrees, which is the number that reaches the .esp
  const plan = planner.buildShotPlan("T", sum.description, "2026-08-19T00:00:00.000Z", { aspect: "9:16" });
  assert.equal(plan.total_duration_seconds, 48);
  assert.equal(plan.total_frames, 48 * planner.FRAME_RATE);
});

// ── Summary / timeline ──────────────────────────────────────────────────────

test("summary: plain-language prose and a route timeline describe the whole journey", () => {
  const sum = journey.summarizeJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [step("slow_orbit", 6)],
    legs: [
      { destination: { location: "Stockholm" }, travel_style: "custom", travel: [step("pull_back", 3), step("cruise", 14)], movements: [step("orbit", 6)] },
      { destination: { location: "Copenhagen" }, travel_style: "direct", travel: [step("fly", 10)], movements: [step("slow_orbit", 5)] },
    ],
  }));
  assert.ok(sum.ok, sum.errors.join("; "));
  const text = sum.text;
  assert.match(text, /Start over Helsinki/);
  assert.match(text, /city framing/);
  assert.match(text, /Slowly orbit Helsinki for 6 seconds/);
  assert.match(text, /Stockholm/);
  assert.match(text, /Copenhagen/);
  assert.match(text, /Estimated duration: 44 seconds/);
  // route timeline: 3 stops, 2 travel groups, in order
  const stops = sum.timeline.filter((t) => t.kind === "stop").map((t) => t.label);
  const travels = sum.timeline.filter((t) => t.kind === "travel");
  assert.deepEqual(stops, ["Helsinki", "Stockholm", "Copenhagen"]);
  assert.equal(travels.length, 2);
  assert.equal(travels[0].steps.length, 2);
  assert.equal(sum.timeline[0].movements[0].label, "Slow Orbit");
});

// ── Validation, in operator language ────────────────────────────────────────

test("validation: a missing start location is refused in plain words", () => {
  const check = journey.validateJourney({ start: { location: "" }, start_movements: [{ type: "hold" }] });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /start location has no place/i.test(e)), check.errors.join("; "));
  assert.ok(!check.errors.some((e) => /schema|validation failed/i.test(e)), "errors must not be schema jargon");
});

test("validation: travel with no destination names the destination that is missing", () => {
  const check = journey.validateJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "hold" }],
    legs: [
      { destination: { location: "Stockholm" }, travel_style: "direct", travel: [{ type: "fly" }], movements: [{ type: "hold" }] },
      { destination: { location: "" }, travel_style: "direct", travel: [{ type: "fly" }], movements: [] },
    ],
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes("Destination 2 has a travel movement but no destination location")),
    check.errors.join("; "));
});

test("validation: zero and negative durations are refused, sub-second ones warned", () => {
  const zero = journey.validateJourney({ start: { location: "Helsinki" }, start_movements: [step("orbit", 0)] });
  assert.equal(zero.ok, false);
  assert.ok(zero.errors.some((e) => /0 seconds, so it would never play/.test(e)), zero.errors.join("; "));
  const neg = journey.validateJourney({ start: { location: "Helsinki" }, start_movements: [step("orbit", -4)] });
  assert.equal(neg.ok, false);
  assert.ok(neg.errors.some((e) => /negative duration/.test(e)), neg.errors.join("; "));
  const tiny = journey.validateJourney({ start: { location: "Helsinki" }, start_movements: [step("orbit", 0.5)] });
  assert.equal(tiny.ok, true, "a short-but-positive duration is legal");
  assert.ok(tiny.warnings.some((w) => /jump cut/.test(w)), tiny.warnings.join("; "));
});

test("validation: an unsupported movement is named and the supported ones are listed", () => {
  const check = journey.validateJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "barrel_roll", duration_seconds: 5 }] });
  // an unknown type normalizes to a safe default AND is reported as unsupported
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /barrel_roll/.test(e) && /Slow Orbit/.test(e)), check.errors.join("; "));
});

test("validation: a place name with a comma is refused, because the parser reads it as two movements", () => {
  const check = journey.validateJourney({
    start: { location: "Helsinki, Finland" }, start_movements: [{ type: "hold", duration_seconds: 4 }] });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /comma/.test(e) && /"Helsinki", not "Helsinki, Finland"/.test(e)), check.errors.join("; "));
  // the plain name is accepted
  assert.equal(journey.validateJourney({ start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 4 }] }).ok, true);
});

test("validation: an unknown place is refused with a usable suggestion", () => {
  const check = journey.validateJourney({
    start: { location: "Narnia" }, start_movements: [{ type: "hold", duration_seconds: 4 }] });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /not a place the generator knows/.test(e) && /60\.17,24\.94/.test(e)), check.errors.join("; "));
});

test("validation: an empty journey is refused", () => {
  const check = journey.validateJourney({ start: { location: "Helsinki" }, start_movements: [], legs: [] });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /nothing in it yet/.test(e)), check.errors.join("; "));
});

// ── Continuation ────────────────────────────────────────────────────────────

test("continuation: the exported state is the camera state, kept distinct from the location", () => {
  const plan = planner.buildShotPlan("A", "fly to Helsinki for 5 seconds then orbit Helsinki twice for 20 seconds",
    "2026-08-19T00:00:00.000Z", { aspect: "9:16" });
  const state = journey.continuationStateFromPlan(plan);
  assert.equal(state.continuation_state_version, 1);
  assert.equal(state.source_animation, "A");
  assert.equal(state.aspect, "9:16");
  assert.equal(state.planner_version, planner.VERSION);
  // exactly the five values Earth Studio keyframes, and nothing invented
  assert.deepEqual(Object.keys(state.camera).sort(),
    ["altitude_m", "heading_deg", "latitude", "longitude", "pan_deg", "tilt_deg"]);
  assert.deepEqual(state.esp_mapping.not_keyframed, ["rotationZ", "fov", "exposure", "aperture", "minFocusLength"]);
  Object.values(state.camera).forEach((v) => assert.ok(Number.isFinite(v)));
  // target is SEMANTIC (the place), camera is where the lens actually is —
  // after an orbit those are deliberately different points
  assert.equal(state.target.name, "Helsinki");
  assert.equal(state.target.latitude, planner.LOCATION_FIXTURES.helsinki.latitude);
  assert.notEqual(state.camera.latitude, state.target.latitude);
  // the camera state is the engine's own terminal state, not a re-derivation
  assert.deepEqual(
    { latitude: state.camera.latitude, longitude: state.camera.longitude, altitude_m: state.camera.altitude_m, pan_deg: state.camera.pan_deg, tilt_deg: state.camera.tilt_deg },
    (({ latitude, longitude, altitude_m, pan_deg, tilt_deg }) => ({ latitude, longitude, altitude_m, pan_deg, tilt_deg }))(planner.finalCameraState(plan)));
});

test("continuation: importing a state seeds a journey whose first frame IS the previous last frame", () => {
  const planA = planner.buildShotPlan("A", "fly to Helsinki for 5 seconds then orbit Helsinki twice for 20 seconds",
    "2026-08-19T00:00:00.000Z", { aspect: "9:16" });
  const state = journey.continuationStateFromPlan(planA);

  const jb = journey.journeyFromContinuationState(state, { destination: "Stockholm" });
  assert.equal(jb.start.source, "continuation");
  assert.equal(jb.start.location, "Helsinki");        // label only
  assert.equal(jb.legs.length, 1);
  const compiled = journey.compileJourney(jb);
  assert.deepEqual(compiled.initial_camera, {
    latitude: state.camera.latitude, longitude: state.camera.longitude,
    altitude_m: state.camera.altitude_m, pan_deg: state.camera.pan_deg, tilt_deg: state.camera.tilt_deg,
  });

  const planB = planner.buildShotPlan("B", compiled.description, "2026-08-19T01:00:00.000Z",
    { aspect: "9:16", initialCamera: compiled.initial_camera });
  // Decode animation B's frame-0 camera straight out of the .esp it will write.
  const esp = planner.buildEsp(planB);
  const cam = esp.scenes[0].attributes[0].attributes;
  const pos = cam[0].attributes, rot = cam[2].attributes;
  const k0 = (leaf) => leaf.keyframes[0];
  const lonMin = pos[0].value.minValueRange, latMin = pos[1].value.minValueRange;
  const panMin = rot[0].value.minValueRange, panMax = rot[0].value.maxValueRange;
  const b = {
    longitude: k0(pos[0]).value * (180 - lonMin) + lonMin,
    latitude: k0(pos[1]).value * (90 - latMin) + latMin,
    altitude_m: k0(pos[2]).value / 1.5356706349899208e-08,
    pan_deg: k0(rot[0]).value * (panMax - panMin) + panMin,
    tilt_deg: k0(rot[1]).value * 180,
  };
  assert.ok(Math.abs(b.longitude - state.camera.longitude) < 1e-9, `longitude ${b.longitude} vs ${state.camera.longitude}`);
  assert.ok(Math.abs(b.latitude - state.camera.latitude) < 1e-9, `latitude ${b.latitude} vs ${state.camera.latitude}`);
  assert.ok(Math.abs(b.altitude_m - state.camera.altitude_m) < 1e-3, `altitude ${b.altitude_m} vs ${state.camera.altitude_m}`);
  assert.ok(Math.abs(b.pan_deg - state.camera.pan_deg) < 1e-9, `pan ${b.pan_deg} vs ${state.camera.pan_deg}`);
  assert.ok(Math.abs(b.tilt_deg - state.camera.tilt_deg) < 1e-9, `tilt ${b.tilt_deg} vs ${state.camera.tilt_deg}`);
});

test("continuation: a seed does not disturb an unseeded plan", () => {
  const desc = "fly to Helsinki for 5 seconds then orbit Helsinki for 12 seconds";
  const plain = planner.buildArtifacts("A", desc, "2026-08-19T00:00:00.000Z", { aspect: "9:16" });
  assert.equal(JSON.parse(plain["shot-plan.json"]).initial_camera, undefined,
    "a plan with no continuation must not gain an initial_camera field");
  const seeded = planner.buildArtifacts("A", desc, "2026-08-19T00:00:00.000Z",
    { aspect: "9:16", initialCamera: { latitude: 10, longitude: 20, altitude_m: 3000, pan_deg: 15, tilt_deg: 50 } });
  assert.deepEqual(JSON.parse(seeded["shot-plan.json"]).initial_camera,
    { latitude: 10, longitude: 20, altitude_m: 3000, pan_deg: 15, tilt_deg: 50 });
  assert.notEqual(seeded["earth-studio.esp"], plain["earth-studio.esp"], "the seed must actually change the opening frame");
});

test("continuation: malformed and wrong-version states are refused with readable reasons", () => {
  const cases = [
    [undefined, /No continuation state was supplied/],
    [null, /No continuation state was supplied/],
    ["not an object", /No continuation state was supplied/],
    [{}, /not an Earth Studio continuation state/],
    [{ continuation_state_version: "one", camera: {} }, /is not a whole number/],
    [{ continuation_state_version: 2, camera: { latitude: 1, longitude: 1, altitude_m: 1, pan_deg: 0, tilt_deg: 0 } }, /version 2, but this generator only understands version 1/],
    [{ continuation_state_version: 0, camera: { latitude: 1, longitude: 1, altitude_m: 1, pan_deg: 0, tilt_deg: 0 } }, /no longer reads/],
    [{ continuation_state_version: 1 }, /no camera block/],
    [{ continuation_state_version: 1, camera: { longitude: 1, altitude_m: 1, pan_deg: 0, tilt_deg: 0 } }, /missing a usable latitude/],
    [{ continuation_state_version: 1, camera: { latitude: 999, longitude: 1, altitude_m: 1, pan_deg: 0, tilt_deg: 0 } }, /outside the range Earth Studio accepts/],
  ];
  cases.forEach(([state, pattern]) => {
    const check = journey.validateContinuationState(state);
    assert.equal(check.ok, false, `expected refusal for ${JSON.stringify(state)}`);
    assert.ok(check.errors.some((e) => pattern.test(e)), `${JSON.stringify(state)} -> ${check.errors.join("; ")}`);
  });
  // ...and journeyFromContinuationState refuses rather than building junk
  assert.throws(() => journey.journeyFromContinuationState({}), /not an Earth Studio continuation state/);
  // a well-formed state is accepted
  const good = journey.continuationStateFromPlan(planner.buildShotPlan("A", "fly to Paris for 5 seconds", "2026-08-19T00:00:00.000Z"));
  assert.equal(journey.validateContinuationState(good).ok, true);
});

test("continuation: a journey starting from a state and opening with an orbit is warned about the ring slide", () => {
  const state = journey.continuationStateFromPlan(planner.buildShotPlan("A", "fly to Paris for 5 seconds", "2026-08-19T00:00:00.000Z"));
  const j = journey.journeyFromContinuationState(state);
  // the default opening is a Hold, which joins seamlessly
  assert.equal(j.start_movements[0].type, "hold");
  assert.equal(journey.compileJourney(j).warnings.length, 0);
  j.start_movements = [{ type: "orbit", duration_seconds: 12 }];
  const warned = journey.compileJourney(journey.normalizeJourney(j));
  assert.ok(warned.warnings.some((w) => /slide sideways onto the orbit circle/.test(w)), warned.warnings.join("; "));
});

// ── Lane integration ────────────────────────────────────────────────────────

test("lane: a journey payload writes the journey, its summary, and the continuation state", () => {
  const pkg = tmpPkg();
  const j = journey.applyPreset("multi_city", ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]);
  j.aspect = "9:16";
  const out = lane.writeJob(pkg, { jobName: "Nordic Journey", journey: j }, { now: "2026-08-19T09:00:00.000Z" });
  assert.equal(out.ok, true);
  ["shot-plan.json", "earth-studio.esp", "job.json", "journey.json", "journey-summary.md", "continuation-state.json"]
    .forEach((f) => assert.ok(fs.existsSync(laneFile(pkg, f)), `${f} written`));
  assert.ok(out.files.includes("journey.json") && out.files.includes("continuation-state.json"));
  // job.json carries journey provenance
  const job = readJson(laneFile(pkg, "job.json"));
  assert.equal(job.journey.journey_version, 1);
  assert.equal(job.journey.stop_count, 4);
  assert.equal(job.journey.pace, "calm");
  assert.equal(job.journey.preset, "multi_city");
  assert.equal(job.continuation_state, "continuation-state.json");
  // the plan really was built from the compiled description
  assert.equal(readJson(laneFile(pkg, "shot-plan.json")).source_description, job.journey.compiled_description);
  assert.equal(job.total_frames, Math.round(out.journey_summary.total_duration_seconds * planner.FRAME_RATE));
  // the continuation state on disk matches what the API returned
  assert.deepEqual(readJson(laneFile(pkg, "continuation-state.json")), out.continuation);
  // status re-exposes both so the GUI can restore the journey
  const st = lane.status(pkg, "es-journey-project");
  assert.equal(st.journey.journey_version, 1);
  assert.equal(st.journey.legs.length, 3);
  assert.equal(st.continuation.continuation_state_version, 1);
});

test("lane: an invalid journey is refused with 400 and operator-language reasons", () => {
  const pkg = tmpPkg();
  assert.throws(() => lane.writeJob(pkg, { jobName: "Bad", journey: { start: { location: "" }, start_movements: [{ type: "hold" }] } }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /this camera journey cannot be generated yet/);
      assert.ok(Array.isArray(err.journey_errors) && err.journey_errors.length);
      return true;
    });
  assert.equal(fs.existsSync(laneFile(pkg, "shot-plan.json")), false, "nothing is written for a refused journey");
});

test("lane: animation B generated from animation A's file opens on A's closing frame", () => {
  const pkgA = tmpPkg();
  const outA = lane.writeJob(pkgA, {
    jobName: "Leg One",
    journey: journey.applyPreset("city_to_city", ["Helsinki", "Stockholm"]),
  }, { now: "2026-08-19T09:00:00.000Z" });
  const stateA = readJson(laneFile(pkgA, "continuation-state.json"));

  const pkgB = tmpPkg();
  const jb = journey.journeyFromContinuationState(stateA, { destination: "Copenhagen" });
  const outB = lane.writeJob(pkgB, { jobName: "Leg Two", journey: jb }, { now: "2026-08-19T09:30:00.000Z" });
  const planB = readJson(laneFile(pkgB, "shot-plan.json"));
  assert.deepEqual(planB.initial_camera, {
    latitude: stateA.camera.latitude, longitude: stateA.camera.longitude,
    altitude_m: stateA.camera.altitude_m, pan_deg: stateA.camera.pan_deg, tilt_deg: stateA.camera.tilt_deg,
  });
  // decode B's first keyframes from the .esp actually written to disk
  const esp = readJson(laneFile(pkgB, "earth-studio.esp"));
  const cam = esp.scenes[0].attributes[0].attributes;
  const pos = cam[0].attributes, rot = cam[2].attributes;
  const lonMin = pos[0].value.minValueRange, latMin = pos[1].value.minValueRange;
  const panMin = rot[0].value.minValueRange, panMax = rot[0].value.maxValueRange;
  assert.ok(Math.abs((pos[0].keyframes[0].value * (180 - lonMin) + lonMin) - stateA.camera.longitude) < 1e-9);
  assert.ok(Math.abs((pos[1].keyframes[0].value * (90 - latMin) + latMin) - stateA.camera.latitude) < 1e-9);
  assert.ok(Math.abs((pos[2].keyframes[0].value / 1.5356706349899208e-08) - stateA.camera.altitude_m) < 1e-3);
  assert.ok(Math.abs((rot[0].keyframes[0].value * (panMax - panMin) + panMin) - stateA.camera.pan_deg) < 1e-9);
  assert.ok(Math.abs((rot[1].keyframes[0].value * 180) - stateA.camera.tilt_deg) < 1e-9);
  // both animations remain independently renderable jobs
  assert.ok(outA.total_frames > 0 && outB.total_frames > 0);
  assert.equal(readJson(laneFile(pkgB, "job.json")).journey.start_source, "continuation");
});

// ── Backward compatibility ──────────────────────────────────────────────────

test("backward compatibility: a pre-journey description job still generates exactly as before", () => {
  const pkg = tmpPkg();
  const desc = "fly to Helsinki in 4 seconds, then orbit Helsinki for 5 seconds";
  const out = lane.writeJob(pkg, { jobName: "Legacy Job", description: desc, aspect: "16:9" }, { now: "2026-08-19T09:00:00.000Z" });
  assert.equal(out.description, desc);
  const job = readJson(laneFile(pkg, "job.json"));
  // job.json gains NO journey key for a freeform job — the frozen field set,
  // plus the continuation pointer that every job now gets.
  assert.equal(job.journey, undefined);
  assert.equal(job.template, undefined);
  assert.deepEqual(Object.keys(job).filter((k) => k !== "continuation_state").sort(),
    ["aspect", "created_at", "description", "frame_rate", "jobName", "motion_profile", "planner_version",
      "render_dimensions", "slug", "total_duration_seconds", "total_frames", "unresolved_count"].sort());
  // and the artifacts are byte-identical to calling the planner directly
  const direct = planner.buildArtifacts("Legacy Job", desc, "2026-08-19T09:00:00.000Z", { aspect: "16:9" });
  Object.keys(direct).forEach((f) => {
    assert.equal(fs.readFileSync(laneFile(pkg, f), "utf8"), direct[f], `${f} must be unchanged by the journey feature`);
  });
});

test("backward compatibility: a v1 journey saved on disk reloads to the same compiled description", () => {
  const pkg = tmpPkg();
  const j = journey.applyPreset("city_to_city", ["Helsinki", "Stockholm"]);
  const first = lane.writeJob(pkg, { jobName: "Round Trip", journey: j }, { now: "2026-08-19T09:00:00.000Z" });
  const saved = readJson(laneFile(pkg, "journey.json"));
  assert.equal(saved.journey_version, 1);
  const reloaded = lane.writeJob(pkg, { jobName: "Round Trip", journey: saved }, { now: "2026-08-19T09:00:00.000Z" });
  assert.equal(reloaded.description, first.description);
  assert.equal(reloaded.total_frames, first.total_frames);
  assert.deepEqual(readJson(laneFile(pkg, "journey.json")), saved);
});

test("backward compatibility: normalizing junk yields a safe journey instead of throwing", () => {
  [undefined, null, 0, "journey", [], { legs: "nope" }, { start: 5, start_movements: {} }].forEach((raw) => {
    const j = journey.normalizeJourney(raw);
    assert.equal(j.journey_version, 1);
    assert.ok(Array.isArray(j.legs) && Array.isArray(j.start_movements));
    assert.equal(j.pace, "calm");
    // it is refused by validation rather than silently generated
    assert.equal(journey.validateJourney(j).ok, false);
  });
  // a leg given as a bare string destination still normalizes
  const j = journey.normalizeJourney({ start: "Helsinki", start_movements: ["hold"], legs: [{ destination: "Stockholm" }] });
  assert.equal(j.start.location, "Helsinki");
  assert.equal(j.legs[0].destination.location, "Stockholm");
  assert.equal(j.legs[0].travel.length, 1, "a leg with no travel list gets its style's default steps");
});

test("backward compatibility: the native Quick Start templates are untouched by the journey feature", () => {
  const pkg = tmpPkg();
  const out = lane.writeJob(pkg, {
    jobName: "Orbit Template", description: "orbit Paris twice for 20 seconds", aspect: "16:9", template: "orbit",
  }, { now: "2026-08-19T09:00:00.000Z" });
  assert.equal(out.template.template_key, "orbit");
  assert.equal(readJson(laneFile(pkg, "job.json")).journey, undefined);
  // a journey job may not silently activate a template
  const pkg2 = tmpPkg();
  const out2 = lane.writeJob(pkg2, { jobName: "J", journey: journey.applyPreset("establish", ["Paris"]) }, { now: "2026-08-19T09:00:00.000Z" });
  assert.equal(out2.template, undefined);
});

// ── GUI wiring guards ───────────────────────────────────────────────────────
// The page itself is exercised end-to-end in real Chrome by
// scripts/earth-studio-journey-browser-smoke.js (31 checks). These are the
// cheap always-on guards for the wiring that a silent regression would break.

test("GUI: the journey builder is wired to the shared journey model, not a copy", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  assert.match(page, /<script src="earth-studio-journey\.js"><\/script>/);
  assert.match(page, /const JB = window\.EarthStudioJourney/);
  // Everything the page shows about a journey comes from the shared model:
  // compiling, summarizing, normalizing, and the continuation import/validate.
  ["compileJourney", "summarizeJourney", "normalizeJourney", "validateContinuationState",
    "journeyFromContinuationState", "moveLeg", "newStep", "formatAltitude"]
    .forEach((fn) => assert.match(page, new RegExp(`JB\\.${fn}\\(`), `page must call the shared ${fn}`));
  // Framing altitudes and durations are READ off the compiled steps rather than
  // recomputed in the page, so there is exactly one implementation of each law.
  assert.match(page, /compiledStep\.altitude_m/);
  assert.match(page, /compiledStep\.suggestion/);
  assert.doesNotMatch(page, /function\s+compileJourney/, "the page must not define its own compiler");
  assert.doesNotMatch(page, /function\s+framingAltitudeM/, "the page must not define its own framing law");
  assert.doesNotMatch(page, /function\s+suggestedRange/, "the page must not define its own pacing law");
  assert.doesNotMatch(page, /2 \* Math\.tan/, "the page must not inline the optical framing identity");
});

test("GUI: every catalogued movement and travel style is reachable from the page", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  // The cards are generated from the catalogue, so the guard is that the page
  // renders from the catalogue rather than a hand-written subset.
  assert.match(page, /JB\.AT_MOVEMENT_KEYS/);
  assert.match(page, /JB\.TRAVEL_MOVEMENT_KEYS/);
  assert.match(page, /Object\.keys\(JB\.TRAVEL_STYLES\)/);
  assert.match(page, /Object\.keys\(JB\.PACE_PRESETS\)/);
  assert.match(page, /\['auto'\]\.concat\(JB\.SCALE_LADDER\)/);
  // every movement has the metadata the cards render
  Object.entries(journey.MOVEMENTS).forEach(([key, m]) => {
    assert.ok(m.label && m.blurb && m.icon, `movement ${key} needs label + blurb + icon for its card`);
    assert.ok(["at", "travel"].includes(m.slot), `movement ${key} slot`);
    assert.ok(["fly_to", "hover", "orbit", "zoom_in", "zoom_out"].includes(m.primitive),
      `movement ${key} must map to a proven planner primitive, got ${m.primitive}`);
  });
});

test("GUI regression: the polling dirty-guard is mode-aware", () => {
  // Adding a second input mode broke this once: the guard compared the freeform
  // textarea against the server's stored description, which in journey mode is
  // the COMPILED description. The textarea is empty there, so the page stayed
  // permanently "dirty" and stopped re-rendering after any journey generate —
  // which hid the continuation block. Guard the fix.
  const page = fs.readFileSync(path.join(__dirname, "..", "project-earth-studio.html"), "utf8");
  const start = page.indexOf("async function refresh()");
  assert.ok(start > 0, "refresh() found");
  const body = page.slice(start, page.indexOf("async function load()", start));
  assert.match(body, /MODE === 'journey'/, "the dirty check must branch on the mode");
  assert.match(body, /JB\.compileJourney\(JOURNEY\)\.description/,
    "in journey mode the unsaved-edit comparison must use the compiled journey");
  assert.ok(!/descEl\.value !== \(ST\.job\?ST\.job\.description/.test(body),
    "the old mode-blind textarea comparison must be gone");
});

// ── Real-import framing regression (gate 2026-08-19) ────────────────────────
// Real Google Earth Studio imports proved that a target-centred movement (fly /
// hover / zoom) does NOT frame its target: the generator places the camera over
// the target's own coordinates and tilts it, so the target sits at nadir while
// the view axis points `tilt` degrees away. Angular offset of the target from
// frame centre is `tilt`, and the frame's half-angle is FOV/2 — so the target is
// only in frame when tilt <= FOV/2. Measured offsets matched
// sin(tilt)/tan(FOV/2) half-frames exactly (4.9 at tilt 60, 4.3 at tilt 50), and
// at country/continent framing the frame was open sea or fully black.
// An ORBIT is unaffected: the engine offsets the camera onto a ring facing the
// target, so the target is dead-centre (verified in the same import round).

// How many half-frames from frame centre a nadir target sits, for a camera
// positioned above it at `tilt`. This is the geometry the imports confirmed.
function targetOffsetHalfFrames(tiltDeg, fovDeg) {
  const rad = (d) => (d * Math.PI) / 180;
  return Math.sin(rad(tiltDeg)) / Math.tan(rad(fovDeg / 2));
}

test("framing/import-regression: every target-centred movement keeps its target inside the frame", () => {
  const fov = planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
  // The exact journeys that were imported and observed.
  const cases = [
    { name: "scale contrast (landmark/country/continent holds)", journey: {
      pace: "calm", start: { location: "Senate Square" }, start_movements: [{ type: "hold" }],
      legs: [
        { destination: { location: "Finland" }, travel_style: "direct", travel: [{ type: "fly" }], movements: [{ type: "hold" }] },
        { destination: { location: "Europe" }, travel_style: "direct", travel: [{ type: "fly" }], movements: [{ type: "hold" }] },
      ] } },
    { name: "city to city (cinematic)", journey: {
      pace: "calm", start: { location: "Helsinki" }, start_movements: [{ type: "slow_orbit" }],
      legs: [{ destination: { location: "Stockholm" }, travel_style: "cinematic",
        travel: [{ type: "pull_back" }, { type: "cruise" }, { type: "descend" }], movements: [{ type: "slow_orbit" }] }] } },
    { name: "multi stop", journey: journey.applyPreset("multi_city", ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]) },
  ];
  cases.forEach((c) => {
    const compiled = journey.compileJourney(journey.normalizeJourney(c.journey));
    compiled.steps.forEach((s) => {
      if (s.action === "orbit") return;               // ring-mounted: always centred
      if (s.ends_at_orbit_entry) return;              // lands on the successor orbit's ring
      if (s.tilt_intentional) return;                 // an explicitly stylistic tilt (e.g. Low Approach)
      const off = targetOffsetHalfFrames(s.tilt_deg, fov);
      assert.ok(off <= 1, `${c.name}: ${s.movement_label} at ${s.location_name} tilts ${s.tilt_deg}deg, putting the target ${off.toFixed(1)} half-frames outside the frame`);
    });
  });
});

test("framing/import-regression: the tilt limit is the honest optical bound, and derived tilt centres the target", () => {
  const fov = planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
  const cap = journey.maxTargetFramingTiltDeg();
  // The LIMIT (used to warn about an operator's own tilt) keeps the target inside
  // the frame and must sit within the frame half-angle.
  assert.ok(targetOffsetHalfFrames(cap, fov) <= 1, `limit ${cap} still puts the target outside the frame`);
  assert.ok(cap > 0 && cap < fov / 2, `the limit (${cap}) must be inside the frame half-angle (${fov / 2})`);
  assert.equal(cap, Math.round(cap * 100) / 100);
  // The DERIVED tilt goes further: only top-down actually centres the target,
  // which is what round 2 of the real-import gate demonstrated.
  assert.equal(journey.TARGET_FRAMING_TILT_DEG, 0);
  assert.equal(targetOffsetHalfFrames(journey.TARGET_FRAMING_TILT_DEG, fov), 0);
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Finland" }, start_movements: [{ type: "hold", duration_seconds: 5 }] }));
  assert.equal(c.steps[0].tilt_deg, 0, "a hold that must frame its target is top-down");
  assert.equal(c.steps[0].target_offset_half_frames, 0);
});

test("framing/import-regression: an orbit keeps its cinematic oblique tilt", () => {
  // Canary A (Senate Square, slow orbit, tilt 60) was VISUALLY ACCEPTED in real
  // Earth Studio — the orbit path must not be flattened by the target-framing cap.
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Senate Square" }, start_movements: [{ type: "slow_orbit", duration_seconds: 31 }] }));
  assert.equal(c.steps[0].action, "orbit");
  assert.equal(c.steps[0].tilt_deg, planner.DEFAULT_TILT_DEG.orbit);
  assert.ok(c.steps[0].tilt_deg > journey.maxTargetFramingTiltDeg() * 2);
});

test("framing/import-regression: a move into an orbit on the same target keeps the orbit's tilt (zero-slide boundary)", () => {
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 3 }],
    legs: [{ destination: { location: "Stockholm" }, travel_style: "cinematic",
      travel: [{ type: "pull_back" }, { type: "cruise" }, { type: "descend" }], movements: [{ type: "slow_orbit" }] }] }));
  const descend = c.steps.find((s) => s.movement === "descend");
  const orbit = c.steps[c.steps.length - 1];
  assert.equal(orbit.action, "orbit");
  assert.equal(descend.ends_at_orbit_entry, true, "the descent must be annotated as ending on the orbit ring");
  assert.equal(descend.tilt_deg, orbit.tilt_deg, "tilt must be continuous across the ring-entry boundary");
  // and the planner agrees the descent terminates at the ring entry
  const parsed = planner.parseDescription(c.description);
  const seg = parsed.segments[c.steps.indexOf(descend)];
  assert.ok(seg.ends_at_orbit_entry, "planner must annotate the same ring entry");
});

test("framing/import-regression: globe framing fits the whole Earth inside the frame", () => {
  const alt = journey.framingAltitudeM("globe", journey.maxTargetFramingTiltDeg());
  const R = planner.EARTH_RADIUS_M;
  const angularRadiusDeg = (Math.asin(R / (R + alt)) * 180) / Math.PI;
  assert.ok(angularRadiusDeg < planner.EARTH_STUDIO_DEFAULT_FOV_DEG / 2,
    `at ${Math.round(alt / 1000)} km the Earth spans ${angularRadiusDeg.toFixed(1)}deg, which does not fit the ${planner.EARTH_STUDIO_DEFAULT_FOV_DEG / 2}deg frame half-angle`);
  assert.ok(alt <= planner.MAX_ALTITUDE_M);
});

test("framing/import-regression: an explicit operator tilt stays authoritative but is warned about", () => {
  const j = journey.normalizeJourney({
    start: { location: "Finland" }, start_movements: [{ type: "hold", duration_seconds: 5, tilt_deg: 55 }] });
  const c = journey.compileJourney(j);
  assert.equal(c.steps[0].tilt_deg, 55, "an explicit tilt must never be silently overridden");
  assert.ok(c.warnings.some((w) => /outside the frame|will not be visible|not be centred/i.test(w)),
    `expected an off-frame warning, got: ${c.warnings.join(" | ")}`);
});

test("framing/import-regression: an orbit never inherits a flattened target-framing tilt", () => {
  // Real import of canary G showed this: a Hold (flattened to top-down so its
  // target is in frame) preceded an orbit around a DIFFERENT place, the orbit
  // inherited tilt 0, and "Orbit" silently became a top-down spin-in-place with a
  // zero-radius ring. An orbit rides a ring facing its target, so the cap never
  // applied to it and must not reach it through carry-over either.
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 4 }],
    legs: [{ destination: { location: "Espoo" }, travel_style: "custom",
      travel: [{ type: "pause", duration_seconds: 4 }], movements: [{ type: "orbit", duration_seconds: 14 }] }] }));
  const hold = c.steps[0];
  const orbit = c.steps[c.steps.length - 1];
  assert.equal(hold.tilt_deg, 0, "the hold is flattened so Helsinki is in frame");
  assert.equal(hold.tilt_capped, true);
  assert.equal(orbit.action, "orbit");
  assert.equal(orbit.tilt_deg, planner.DEFAULT_TILT_DEG.orbit, "the orbit keeps its oblique default");
  assert.ok(planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg) > 1000,
    "a real orbit must have a non-degenerate ring radius");
  // An explicit operator tilt is still honoured, even a flat one.
  const flat = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "orbit", duration_seconds: 14, tilt_deg: 0 }] }));
  assert.equal(flat.steps[0].tilt_deg, 0);
});

test("framing/import-regression: a genuinely oblique carried tilt is still inherited by an orbit", () => {
  // Carry-over must keep working where it is meaningful: two orbits in a row hold
  // the same oblique tilt rather than resetting.
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki" },
    start_movements: [{ type: "orbit", duration_seconds: 14, tilt_deg: 42 }, { type: "orbit", duration_seconds: 14 }] }));
  assert.equal(c.steps[0].tilt_deg, 42);
  assert.equal(c.steps[1].tilt_deg, 42, "the second orbit inherits the operator's oblique tilt");
  assert.equal(c.steps[0].tilt_capped, false);
});

test("framing/import-regression: a hold directly before an orbit on another place warns about the slide", () => {
  // Canary G, confirmed in a real import: the orbit's first revolution glides from
  // the held position onto its ring (16 km at the orbit's first frame, 0 km by the
  // end). Legal and cinematic, but the operator must be told, because a normal
  // fly/zoom arrival has NO slide (it terminates on the ring entry).
  const sliding = journey.validateJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 4 }],
    legs: [{ destination: { location: "Espoo" }, travel_style: "custom",
      travel: [{ type: "pause", duration_seconds: 4 }], movements: [{ type: "orbit", duration_seconds: 20 }] }] });
  assert.equal(sliding.ok, true, "the journey is legal, not an error");
  assert.ok(sliding.warnings.some((w) => /glides onto its circle/.test(w)), sliding.warnings.join(" | "));

  // A normal travelled arrival must NOT warn — it lands on the ring entry.
  const clean = journey.validateJourney(journey.applyPreset("city_to_city", ["Helsinki", "Stockholm"]));
  assert.equal(clean.ok, true);
  assert.ok(!clean.warnings.some((w) => /glides onto its circle/.test(w)),
    `a travelled arrival must not warn: ${clean.warnings.join(" | ")}`);
  // ...nor may a hold before an orbit around the SAME place (the camera is already there).
  const same = journey.validateJourney({
    start: { location: "Helsinki" },
    start_movements: [{ type: "hold", duration_seconds: 4 }, { type: "orbit", duration_seconds: 20 }] });
  assert.ok(!same.warnings.some((w) => /glides onto its circle/.test(w)), same.warnings.join(" | "));
});

test("framing/import-regression: an orbit that cannot reach its ring goes top-down instead of pointing at sky", () => {
  // Real import (canary H): "Slow Orbit" around Finland put the camera 1,843 km up
  // at tilt 60, needing a 3,192 km ring to face the target. The generator caps an
  // orbit ring at 80 km, so the camera stayed 80 km out, pointed 60deg away from
  // nadir, and rendered as near-black sky with only the Earth's limb showing.
  const cap = journey.orbitRingCapM(planner);
  assert.ok(cap > 0 && cap < 1e6, `implausible ring cap ${cap}`);
  const at = (framing) => journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki", framing }, start_movements: [{ type: "slow_orbit", duration_seconds: 20 }] })).steps[0];
  // Small scales keep the accepted oblique orbit (canary A was visually accepted).
  ["landmark", "neighborhood", "district", "city"].forEach((f) => {
    const s = at(f);
    assert.equal(s.tilt_deg, planner.DEFAULT_TILT_DEG.orbit, `${f} orbit must stay oblique`);
    assert.equal(s.orbit_flattened, false);
    assert.ok(journey.orbitCanFaceTarget(s.altitude_m, s.tilt_deg), `${f} orbit must be able to face its target`);
  });
  // Large scales cannot be orbited obliquely at all, so they go top-down.
  ["metro", "region", "country", "continent"].forEach((f) => {
    const s = at(f);
    assert.equal(s.orbit_flattened, true, `${f} orbit must be flattened`);
    assert.equal(s.tilt_deg, 0);
    assert.ok(journey.orbitCanFaceTarget(s.altitude_m, s.tilt_deg), `${f} orbit must face its target after flattening`);
  });
  // Every orbit the model can produce must be able to face its target.
  journey.SCALE_LADDER.forEach((f) => {
    const s = at(f);
    assert.ok(journey.orbitCanFaceTarget(s.altitude_m, s.tilt_deg),
      `${f}: orbit at ${s.altitude_m}m tilt ${s.tilt_deg} cannot face its target`);
  });
});

test("framing/import-regression: an explicit tilt on an un-orbitable framing is honoured but warned", () => {
  const c = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Finland" }, start_movements: [{ type: "slow_orbit", duration_seconds: 20, tilt_deg: 60 }] }));
  assert.equal(c.steps[0].tilt_deg, 60, "explicit tilt stays authoritative");
  assert.equal(c.steps[0].orbit_flattened, false);
  assert.ok(c.warnings.some((w) => /point at empty sky/.test(w)), c.warnings.join(" | "));
});

// ── Coherent trajectory / keyframe hygiene (operator directive 2026-08-19) ──
// "The camera movement must always follow a single coherent trajectory. Wobbling
// at any point is prohibited by default." and "if some keyframes have no change
// between them, remove the keyframe when finishing the animation."
//
// WOBBLE is defined as a direction reversal INSIDE one movement. A change of
// direction AT a movement boundary is the deliberate shape the journey chose
// (pull back, then cruise, then descend), not wobble.

const ALT_NORM = 1.5356706349899208e-08;

function decodeTracks(esp) {
  const dur = esp.settings.duration;
  const cam = esp.scenes[0].attributes[0].attributes;
  const pos = cam[0].attributes;
  const rot = cam[2].attributes;
  const dec = (leaf, fn) => leaf.keyframes.map((k) => ({ f: k.time * dur, v: fn(k.value, leaf) }));
  return {
    alt: dec(pos[2], (v) => v / ALT_NORM),
    tilt: dec(rot[1], (v) => v * 180),
    pan: dec(rot[0], (v, l) => (l.value.maxValueRange !== undefined
      ? v * (l.value.maxValueRange - l.value.minValueRange) + l.value.minValueRange : v * 360)),
    raw: [pos[0], pos[1], pos[2], rot[0], rot[1]],
  };
}

function inMovementReversals(plan, tracks) {
  const segs = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
  const found = [];
  ["alt", "tilt", "pan"].forEach((key) => {
    const peak = Math.max(...tracks[key].map((x) => Math.abs(x.v)), 1);
    const tol = key === "alt" ? Math.max(30, 0.01 * peak) : 0.4;
    segs.forEach((seg) => {
      const inSeg = tracks[key].filter((k) => k.f >= seg.start_frame - 0.5 && k.f <= seg.end_frame + 0.5);
      let sign = 0;
      for (let i = 1; i < inSeg.length; i += 1) {
        const d = inSeg[i].v - inSeg[i - 1].v;
        if (Math.abs(d) < tol) continue;
        const s2 = Math.sign(d);
        if (sign !== 0 && s2 !== sign) {
          found.push(`${key} reverses inside segment ${seg.segment_id} (${seg.action} ${seg.location_name}) at frame ${Math.round(inSeg[i].f)}`);
        }
        sign = s2;
      }
    });
  });
  return found;
}

function redundantKeyframes(tracks, plan) {
  let n = 0;
  const boundaries = new Set((plan && plan.segments || [])
    .filter((segment) => segment.location && segment.duration_seconds > 0)
    .flatMap((segment) => [segment.start_frame, segment.end_frame]));
  tracks.raw.forEach((leaf) => {
    const a = leaf.keyframes.map((k) => k.value);
    for (let i = 1; i < a.length - 1; i += 1) {
      const frame = leaf.keyframes[i].time * (plan && plan.total_frames || 1);
      if ([...boundaries].some((boundary) => Math.abs(boundary - frame) < 1e-6)) continue; // semantic hold fence
      if (a[i] === a[i - 1] && a[i + 1] === a[i]) n += 1;
    }
  });
  return n;
}

const JOURNEY_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" };

function directedPlanFor(journeyRaw) {
  const compiled = journey.compileJourney(journey.normalizeJourney(journeyRaw));
  const plan = planner.buildShotPlan("t", compiled.description, "2026-08-19T14:00:00.000Z",
    { aspect: "16:9", motionPolicy: JOURNEY_POLICY });
  return { plan, esp: planner.buildEsp(plan) };
}

test("trajectory: a journey-built animation never reverses direction inside a movement", () => {
  const cases = {
    "route (the reported case: 15s Helsinki->Stockholm humped 51->190->51 km)": {
      start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 4 }],
      legs: [{ destination: { location: "Stockholm" }, travel_style: "direct", travel: [{ type: "fly" }], movements: [{ type: "hold", duration_seconds: 4 }] }],
    },
    "shaped city-to-city": journey.applyPreset("city_to_city", ["Helsinki", "Stockholm"]),
    "multi-stop": journey.applyPreset("multi_city", ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]),
    "scale reveal": {
      start: { location: "Senate Square" }, start_movements: [{ type: "hold", duration_seconds: 4 }],
      legs: ["Helsinki", "Finland", "Europe"].map((l) => ({
        destination: { location: l }, travel_style: "direct", travel: [{ type: "fly" }], movements: [{ type: "zoom_out" }] })),
    },
    "landmark orbit": { start: { location: "Senate Square" }, start_movements: [{ type: "slow_orbit" }] },
  };
  Object.entries(cases).forEach(([label, j]) => {
    const { plan, esp } = directedPlanFor(j);
    const problems = inMovementReversals(plan, decodeTracks(esp));
    assert.deepEqual(problems, [], `${label}: ${problems.join(" | ")}`);
  });
});

test("trajectory: the implicit arc hump is what caused the wobble, and only the policy removes it", () => {
  // Same description, with and without the policy. Without it the long flight
  // rises above BOTH endpoints and comes back down inside one movement.
  const desc = "hover over Helsinki for 4 seconds then fly to Stockholm at 34000m tilted 0 degrees for 7 seconds";
  const legacy = planner.buildEsp(planner.buildShotPlan("t", desc, "2026-08-19T14:00:00.000Z", { aspect: "16:9" }));
  const directed = planner.buildEsp(planner.buildShotPlan("t", desc, "2026-08-19T14:00:00.000Z",
    { aspect: "16:9", motionPolicy: JOURNEY_POLICY }));
  const peak = (esp) => Math.max(...decodeTracks(esp).alt.map((x) => x.v));
  const ends = (esp) => { const a = decodeTracks(esp).alt; return Math.max(a[0].v, a[a.length - 1].v); };
  assert.ok(peak(legacy) > ends(legacy) * 1.5, `legacy arc should hump well above its endpoints (peak ${Math.round(peak(legacy))})`);
  assert.ok(peak(directed) <= ends(directed) + 1, `directed altitude must not rise above its endpoints (peak ${Math.round(peak(directed))} vs ends ${Math.round(ends(directed))})`);
});

test("keyframes: a journey-built animation contains no keyframe that changes nothing", () => {
  const jrs = [
    journey.applyPreset("city_to_city", ["Helsinki", "Stockholm"]),
    journey.applyPreset("multi_city", ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]),
    journey.applyPreset("establish", ["Senate Square"]),
    { start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 4 }],
      legs: [{ destination: { location: "Stockholm" }, travel_style: "direct", travel: [{ type: "fly" }], movements: [{ type: "hold", duration_seconds: 4 }] }] },
  ];
  jrs.forEach((j, i) => {
    const { plan, esp } = directedPlanFor(j);
    assert.equal(redundantKeyframes(decodeTracks(esp), plan), 0, `journey ${i}: redundant keyframes remain`);
  });
  // a track that never changes collapses to a single keyframe
  const flat = directedPlanFor({
    start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 4 }],
    legs: [{ destination: { location: "Stockholm" }, travel_style: "direct", travel: [{ type: "fly" }], movements: [{ type: "hold", duration_seconds: 4 }] }] });
  const tilt = decodeTracks(flat.esp).tilt;
  assert.equal(tilt.length, 1, `an unchanging tilt track should be one keyframe, got ${tilt.length}`);
});

test("keyframes: dropRedundantKeyframes removes flat interiors and keeps real motion", () => {
  const kf = (t, v) => ({ time: t, value: v });
  // a flat run collapses to its two endpoints
  assert.deepEqual(planner.dropRedundantKeyframes([kf(0, 5), kf(10, 5), kf(20, 5), kf(30, 5)]).map((k) => k.time), [0, 30]);
  // an anchor before a rise is NOT redundant (it makes the rise start later)
  assert.deepEqual(planner.dropRedundantKeyframes([kf(0, 5), kf(10, 5), kf(20, 9)]).map((k) => k.time), [0, 10, 20]);
  // moving keyframes are never dropped, even if collinear — they carry easing
  assert.deepEqual(planner.dropRedundantKeyframes([kf(0, 0), kf(10, 5), kf(20, 10)]).map((k) => k.time), [0, 10, 20]);
  // a flat stretch inside motion loses only its interior
  assert.deepEqual(planner.dropRedundantKeyframes([kf(0, 0), kf(10, 5), kf(20, 5), kf(30, 5), kf(40, 9)]).map((k) => k.time), [0, 10, 30, 40]);
  // degenerate inputs are safe
  assert.deepEqual(planner.dropRedundantKeyframes([]), []);
  assert.deepEqual(planner.dropRedundantKeyframes([kf(0, 1)]).length, 1);
});

test("keyframes/trajectory: a freeform plan keeps the byte-frozen behaviour exactly", () => {
  const desc = "fly to Helsinki in 4 seconds, then orbit Helsinki for 5 seconds";
  const plain = planner.buildShotPlan("t", desc, "2026-08-19T14:00:00.000Z", { aspect: "16:9" });
  assert.equal(plain.motion_policy, undefined, "a freeform plan must not gain a motion_policy field");
  const a = planner.buildArtifacts("t", desc, "2026-08-19T14:00:00.000Z", { aspect: "16:9" });
  const b = planner.buildArtifacts("t", desc, "2026-08-19T14:00:00.000Z", { aspect: "16:9" });
  assert.equal(a["earth-studio.esp"], b["earth-studio.esp"], "freeform output must stay deterministic");
  // The policy is opt-in. On a description with nothing to fix it is a no-op —
  // which is correct — so the visible difference is asserted on a description
  // that DOES arc: a long flight with a previous camera position.
  const arcing = "hover over Helsinki for 4 seconds then fly to Stockholm for 8 seconds";
  const arcPlain = planner.buildArtifacts("t", arcing, "2026-08-19T14:00:00.000Z", { aspect: "16:9" });
  const arcDirected = planner.buildArtifacts("t", arcing, "2026-08-19T14:00:00.000Z",
    { aspect: "16:9", motionPolicy: JOURNEY_POLICY });
  assert.notEqual(arcDirected["earth-studio.esp"], arcPlain["earth-studio.esp"],
    "the policy must change a flight that would otherwise arc");
  assert.deepEqual(JSON.parse(arcDirected["shot-plan.json"]).motion_policy,
    { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" });
  assert.equal(JSON.parse(arcPlain["shot-plan.json"]).motion_policy, undefined);
});

test("framing: a scale shift at the end of the ladder keeps a place's calibrated altitude", () => {
  // Reported as "the camera can be too close to a building": a Spiral In on the
  // Eiffel Tower re-derived its altitude at oblique tilt (709 m) instead of using
  // the hand-validated gazetteer value (1,000 m).
  const calibrated = planner.LOCATION_FIXTURES["eiffel tower"].altitude_m;
  const spiral = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Eiffel Tower" }, start_movements: [{ type: "spiral_in", duration_seconds: 20 }] })).steps[0];
  assert.equal(spiral.altitude_m, calibrated);
  assert.equal(spiral.altitude_source, "gazetteer_calibrated");
  // a shift that CAN move still moves
  const pushIn = journey.compileJourney(journey.normalizeJourney({
    start: { location: "Helsinki", framing: "city" }, start_movements: [{ type: "zoom_in", duration_seconds: 6 }] })).steps[0];
  assert.equal(pushIn.framing_scale, "district");
  assert.equal(pushIn.altitude_source, "derived_optical_shifted");
});

test("framing: a city is framed closer than the metropolitan area around it", () => {
  // Reported as "the camera can be too far away from a city": city span is the
  // recognisable core, not the whole built-up region (which is what metro is for).
  assert.equal(journey.FRAMING_SCALES.city.span_m, 12000);
  const city = journey.framingAltitudeM("city", 0);
  const metro = journey.framingAltitudeM("metro", 0);
  assert.ok(city < metro, `city ${city} must be closer than metro ${metro}`);
  assert.ok(city < 40000, `a top-down city shot should sit under 40 km, got ${city}`);
  // the ladder stays strictly monotonic after the recalibration
  const ladder = journey.SCALE_LADDER.filter((k) => k !== "globe").map((k) => journey.framingAltitudeM(k, 0));
  for (let i = 1; i < ladder.length; i += 1) assert.ok(ladder[i] > ladder[i - 1], "framing ladder must stay monotonic");
});

// ── Motion smoothness (operator directive 2026-08-19) ───────────────────────
// "All movements should have easing, especially between different moves."
// "The camera moves need to be smoother when switching from dolly out to moving
//  sideways." / "The camera starts to move completely abruptly, this is wrong."
//
// Abruptness has two causes, both fixed here: a boundary keyframe that motion
// continues through carried a LINEAR out-side (so the next move began at full
// speed), and a keyframe where a track STARTED moving after being still only got
// the gentle interior easing instead of a real departure ease.

function rawTracks(esp) {
  const cam = esp.scenes[0].attributes[0].attributes;
  const pos = cam[0].attributes;
  const rot = cam[2].attributes;
  return { longitude: pos[0], latitude: pos[1], altitude: pos[2], pan: rot[0], tilt: rot[1] };
}

// A UNIFORM SWEEP sample: a keyframe strictly inside an orbit segment. These
// are not movement boundaries — they are the samples that DEFINE the circle, so
// the sweep is already in motion through them and there is no onset or arrival
// to ease. Handles here would pin the value's slope to zero at every sample and
// make the orbit stutter (see the emit-site note in the planner), so they are
// authored hard-linear on purpose. The smoothness invariant below is about
// movements starting and stopping abruptly; it is scoped to movement boundaries
// rather than weakened, and a sweep interior is still required to BE linear —
// an unexplained linear keyframe anywhere else is still a failure.
function sweepInteriors(plan) {
  const spans = (plan.segments || [])
    .filter((sg) => sg.action === "orbit" && sg.location && sg.duration_seconds > 0)
    .map((sg) => [sg.start_frame / plan.total_frames, sg.end_frame / plan.total_frames]);
  return (time) => spans.some(([t0, t1]) => time > t0 + 1e-9 && time < t1 - 1e-9);
}
const isLinear = (h) => (h || {}).type === "linear" && Math.abs(Number((h || {}).x) || 0) === 0;

// Every keyframe from which the track MOVES must ease out of rest / into the next
// move — never linear, never absent.
function abruptOnsets(esp, plan) {
  const bad = [];
  const inSweep = plan ? sweepInteriors(plan) : () => false;
  Object.entries(rawTracks(esp)).forEach(([name, leaf]) => {
    const k = leaf.keyframes;
    for (let i = 0; i < k.length - 1; i += 1) {
      if (k[i + 1].value === k[i].value) continue;          // nothing moves out of here
      const out = k[i].transitionOut || {};
      if (inSweep(k[i].time) && isLinear(out)) continue;    // uniform-sweep sample
      const eased = (out.type === "easeOut" || out.type === "auto" || out.type === "custom")
        && Math.abs(Number(out.x) || 0) > 0;
      if (!eased) bad.push(`${name} keyframe ${i} (t=${k[i].time}) starts motion with out=${out.type || "none"} x=${out.x}`);
    }
  });
  return bad;
}

// Every keyframe at which the track COMES TO REST must decelerate into it.
function abruptStops(esp, plan) {
  const bad = [];
  const inSweep = plan ? sweepInteriors(plan) : () => false;
  const throughOrbitBoundaries = new Set((plan && plan.segments || [])
    .map((segment, index, segments) => {
      const next = segments[index + 1];
      return segment.action === "orbit" && next && next.action !== "hover"
        ? segment.end_frame : null;
    }).filter((frame) => frame !== null));
  Object.entries(rawTracks(esp)).forEach(([name, leaf]) => {
    const k = leaf.keyframes;
    for (let i = 1; i < k.length; i += 1) {
      if (k[i].value === k[i - 1].value) continue;          // nothing was moving into here
      if (throughOrbitBoundaries.has(k[i].time * (esp.settings.duration || 1))) continue;
      const inn = k[i].transitionIn || {};
      if (inSweep(k[i].time) && isLinear(inn)) continue;    // uniform-sweep sample
      const eased = (inn.type === "auto" || inn.type === "custom") && Math.abs(Number(inn.x) || 0) > 0;
      if (!eased) bad.push(`${name} keyframe ${i} (t=${k[i].time}) ends motion with in=${inn.type || "none"} x=${inn.x}`);
    }
  });
  return bad;
}

const SMOOTH_CASES = () => ({
  "route with a climb then a sideways crossing": {
    start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 3 }],
    legs: [{ destination: { location: "Stockholm" }, travel_style: "high_transit",
      travel: [{ type: "climb_to_transit" }, { type: "cruise" }, { type: "descend" }],
      movements: [{ type: "hold", duration_seconds: 3 }] }],
  },
  "shaped city-to-city": journey.applyPreset("city_to_city", ["Helsinki", "Stockholm"]),
  "multi stop": journey.applyPreset("multi_city", ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]),
  "landmark orbit": journey.applyPreset("establish", ["Senate Square"]),
});

test("smoothness: no movement in a journey-built animation starts abruptly", () => {
  Object.entries(SMOOTH_CASES()).forEach(([label, j]) => {
    const { esp, plan } = directedPlanFor(j);
    assert.deepEqual(abruptOnsets(esp, plan), [], `${label}: ${abruptOnsets(esp, plan).join(" | ")}`);
  });
});

test("smoothness: no movement in a journey-built animation stops abruptly", () => {
  Object.entries(SMOOTH_CASES()).forEach(([label, j]) => {
    const { esp, plan } = directedPlanFor(j);
    assert.deepEqual(abruptStops(esp, plan), [], `${label}: ${abruptStops(esp, plan).join(" | ")}`);
  });
});

test("smoothness: switching from a climb to a sideways crossing is eased on both sides", () => {
  // The reported case: dolly out, then move sideways. The longitude keyframe where
  // the sideways move begins used to carry a linear out-side.
  const { esp } = directedPlanFor(SMOOTH_CASES()["route with a climb then a sideways crossing"]);
  const lng = rawTracks(esp).longitude.keyframes;
  const onset = lng.findIndex((k, i) => i < lng.length - 1 && lng[i + 1].value !== k.value);
  assert.ok(onset >= 0, "the crossing must exist");
  const out = lng[onset].transitionOut || {};
  assert.notEqual(out.type, "linear", "the sideways move must not begin linearly");
  assert.ok(Math.abs(Number(out.x)) > 0, "it must carry a real easing handle");
});

test("smoothness: a keyframe that only ENDS motion may stay linear, as the template authors it", () => {
  // The evidence-derived template rule (linear out-side on a move-ending keyframe)
  // is preserved where motion genuinely stops — it is only overridden where motion
  // continues through the boundary.
  const { esp } = directedPlanFor(SMOOTH_CASES()["shaped city-to-city"]);
  const alt = rawTracks(esp).altitude.keyframes;
  const flatOuts = alt.filter((k, i) => i < alt.length - 1 && alt[i + 1].value === k.value
    && (k.transitionOut || {}).type === "linear");
  assert.ok(flatOuts.length >= 1, "a stationary stretch should still be able to use the template's linear out-side");
});

test("smoothness: the tip into an orbit holds, then rotates at a calm rate", () => {
  // Reported as "the camera tilts when descending to Stockholm for no apparent
  // reason". The tilt change is the lean into the circle that follows, so it now
  // happens as its own beat at the end of the descent rather than smeared across it.
  const { plan, esp } = directedPlanFor(journey.applyPreset("city_to_city", ["Helsinki", "Stockholm"]));
  const entry = plan.segments.find((sg) => sg.ends_at_orbit_entry);
  assert.ok(entry, "the descent must be annotated as ending on the orbit ring");
  const dur = esp.settings.duration;
  const tilt = rawTracks(esp).tilt.keyframes.map((k) => ({ f: k.time * dur, v: k.value * 180 }));
  // the tilt holds through the earlier part of the descent...
  const held = tilt.filter((k) => k.f >= entry.start_frame - 1 && k.v === tilt[0].v);
  assert.ok(held.length >= 1, "the tilt must hold into the descent before tipping");
  // ...and then rotates no faster than the calm rate
  for (let i = 1; i < tilt.length; i += 1) {
    const dv = Math.abs(tilt[i].v - tilt[i - 1].v);
    if (dv < 0.5) continue;
    const seconds = (tilt[i].f - tilt[i - 1].f) / plan.frame_rate;
    assert.ok(dv / seconds <= 12.5, `tilt rotates at ${(dv / seconds).toFixed(1)} deg/s`);
  }
});

test("smoothness: a freeform plan keeps the template's original easing roles", () => {
  // None of the smoothing applies without the policy, so the byte-frozen path and
  // its derived-from-evidence easing stay exactly as they were.
  // A description with a fly -> fly boundary: motion continues through it, so the
  // template's linear out-side shows up on the freeform path and is smoothed only
  // on the directed one.
  const desc = "hover over Helsinki for 4 seconds then fly to Stockholm for 8 seconds"
    + " then fly to Copenhagen for 8 seconds then hover over Copenhagen for 4 seconds";
  const plain = planner.buildEsp(planner.buildShotPlan("t", desc, "2026-08-19T15:00:00.000Z", { aspect: "16:9" }));
  const directed = planner.buildEsp(planner.buildShotPlan("t", desc, "2026-08-19T15:00:00.000Z",
    { aspect: "16:9", motionPolicy: JOURNEY_POLICY }));
  assert.ok(abruptOnsets(plain).length > 0, "the freeform path still has the template's linear onsets");
  assert.deepEqual(abruptOnsets(directed), [], "the directed path does not");
});
