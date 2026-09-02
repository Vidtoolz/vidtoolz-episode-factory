// Path equivalence: TEXT path vs DIRECT JOURNEY IR path (parser bypass).
//
//   TEXT   : journey -> compileJourney -> English -> parseDescription -> plan -> artifacts
//   DIRECT : journey -> compileJourney -> segment specs -> buildParsedFromSegmentSpecs -> plan -> artifacts
//
// Doctrine (2026-09-02): this is PATH EQUIVALENCE on one commit — both paths run
// on the same code and must produce identical BYTES for every artifact. It is
// deliberately NOT tracked-fixture equality (several tracked canaries are
// legitimately stale against current main) and NOT a semantic tolerance check.
// The direct path is shadow-only: the lane still uses the text path.
// Nothing here regenerates or re-pins any canary.
const { assert, fs, path, test } = require("./_helpers.js");
const childProcess = require("node:child_process");
const planner = require("../earth-studio-job-planner.js");
const journeyModel = require("../earth-studio-journey.js");

const ROOT = path.join(__dirname, "..");
const ARTIFACT_KEYS = planner.expectedFiles();
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function trackedJourneyCanaries() {
  let out;
  try {
    out = childProcess.execFileSync("git", ["ls-files", "package-runs/**/journey.json"], { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    return null; // not a git checkout (e.g. an export) — the corpus test reports and skips
  }
  return out.trim().split("\n").filter(Boolean)
    .map((rel) => path.join(ROOT, path.dirname(rel)))
    .filter((dir) => fs.existsSync(path.join(dir, "shot-plan.json")));
}

// The lane's plan options, recovered from the tracked plan (the only place all
// of them are recorded): aspect, continuation seed, motion policy.
function laneOptionsFromPlan(plan, compiled) {
  const o = { aspect: plan.aspect };
  if (plan.initial_camera) o.initialCamera = plan.initial_camera;
  else if (compiled && compiled.initial_camera) o.initialCamera = compiled.initial_camera;
  if (plan.motion_policy) o.motionPolicy = plan.motion_policy;
  return o;
}

function runBothPaths(journey, jobName, generatedAt, laneOptions) {
  const compiled = journeyModel.compileJourney(journeyModel.normalizeJourney(journey), { planner });
  const o = { ...laneOptions };
  if (!o.initialCamera && compiled.initial_camera) o.initialCamera = compiled.initial_camera;
  const text = planner.buildArtifacts(jobName, compiled.description, generatedAt, o);
  const direct = journeyModel.compileJourneyToParsed(journey, { planner, aspect: o.aspect });
  const structured = planner.buildArtifactsFromParsed(jobName, direct.parsed, generatedAt, o);
  const structuredAgain = planner.buildArtifactsFromParsed(jobName,
    journeyModel.compileJourneyToParsed(journey, { planner, aspect: o.aspect }).parsed, generatedAt, o);
  const parsedFromText = planner.parseDescription(compiled.description, { aspect: o.aspect });
  return { compiled, direct, text, structured, structuredAgain, parsedFromText };
}

function assertIdentical(label, r) {
  const diffs = ARTIFACT_KEYS.filter((k) => r.text[k] !== r.structured[k]);
  assert.deepEqual(diffs, [], `${label}: TEXT vs DIRECT artifacts differ: ${diffs.join(", ")}`);
  const nondet = ARTIFACT_KEYS.filter((k) => r.structured[k] !== r.structuredAgain[k]);
  assert.deepEqual(nondet, [], `${label}: DIRECT path is not deterministic: ${nondet.join(", ")}`);
  const eq = journeyModel.verifyParsedEquivalence(r.parsedFromText, r.direct.parsed);
  assert.ok(eq.ok, `${label}: parsed objects differ: ${eq.problems.join(" | ")}`);
  assert.equal(r.direct.provenance.text_parsed_for_authority, false);
}

// ── 1. Tracked journey canary corpus: byte identity on this commit ──────────
test("path-equivalence: every tracked journey canary is byte-identical through TEXT and DIRECT paths", () => {
  const dirs = trackedJourneyCanaries();
  if (dirs === null) { assert.ok(true, "skipped: not a git checkout"); return; }
  assert.ok(dirs.length >= 148, `expected the tracked corpus (>=148 journeys), found ${dirs.length}`);
  const failures = [];
  let count = 0;
  for (const dir of dirs) {
    const plan = readJson(path.join(dir, "shot-plan.json"));
    const journey = readJson(path.join(dir, "journey.json"));
    count += 1;
    try {
      const compiled = journeyModel.compileJourney(journeyModel.normalizeJourney(journey), { planner });
      const r = runBothPaths(journey, plan.job_name, plan.generated_at, laneOptionsFromPlan(plan, compiled));
      assertIdentical(path.relative(ROOT, dir), r);
    } catch (e) {
      failures.push(`${path.relative(ROOT, dir)}: ${e.message.split("\n")[0]}`);
    }
  }
  assert.deepEqual(failures, [], `${failures.length}/${count} journeys diverge:\n${failures.join("\n")}`);
  assert.equal(count, dirs.length);
});

// ── 2. Freeform plans: the tail extraction changed nothing (execution vs execution)
test("path-equivalence: tail extraction is byte-neutral for every tracked freeform plan", () => {
  let out;
  try { out = childProcess.execFileSync("git", ["ls-files", "package-runs/**/shot-plan.json"], { cwd: ROOT, encoding: "utf8" }); }
  catch (e) { assert.ok(true, "skipped: not a git checkout"); return; }
  const freeform = out.trim().split("\n").filter(Boolean).map((rel) => path.join(ROOT, rel))
    .filter((p) => !fs.existsSync(path.join(path.dirname(p), "journey.json")))
    .filter((p) => !readJson(p).motion_policy);
  assert.ok(freeform.length >= 5, `expected >=5 freeform plans, found ${freeform.length}`);
  for (const p of freeform) {
    const plan = readJson(p);
    const o = { aspect: plan.aspect };
    if (plan.initial_camera) o.initialCamera = plan.initial_camera;
    const wrapper = planner.buildArtifacts(plan.job_name, plan.source_description, plan.generated_at, o);
    const parsed = planner.parseDescription(plan.source_description, { aspect: o.aspect });
    const split = planner.buildArtifactsFromParsed(plan.job_name, parsed, plan.generated_at, o);
    ARTIFACT_KEYS.forEach((k) => assert.equal(wrapper[k], split[k], `${path.relative(ROOT, p)}: ${k} differs between wrapper and split tail`));
    const planWrapper = planner.buildShotPlan(plan.job_name, plan.source_description, plan.generated_at, o);
    const planSplit = planner.buildShotPlanFromParsed(plan.job_name, parsed, plan.generated_at, o);
    assert.equal(JSON.stringify(planWrapper), JSON.stringify(planSplit));
    // A freeform plan never gains journey-only fields through the new entry points.
    assert.equal("motion_policy" in planSplit, false);
  }
});

// ── 3. Adversarial synthetic journeys (TEXT vs DIRECT must still agree) ──────
const step = (type, extra = {}) => ({ type, ...extra });
const place = (location, extra = {}) => ({ location, framing: "auto", altitude_m: null, tilt_deg: null, ...extra });
const J = (start, legs, extra = {}) => ({ journey_version: 1, pace: "calm", aspect: "9:16", start: { source: "location", ...start }, start_movements: [], legs, ...extra });
const leg = (destination, travel, movements = []) => ({ destination, travel_style: "direct", travel, movements });

function requireFixture(name) {
  assert.ok(planner.resolveLocation(name), `test fixture place "${name}" must exist in the gazetteer`);
  return name;
}

const ADVERSARIAL = {
  "antimeridian Tokyo -> Los Angeles (179.x -> -179.x sweep)": () => J(place(requireFixture("Tokyo")), [leg(place(requireFixture("Los Angeles")), [step("fly", { duration_seconds: 14 })], [step("orbit")])]),
  "pole-adjacent coordinates (89.5,0) by explicit lat,lng": () => J(place(requireFixture("Helsinki")), [leg(place("89.5,0"), [step("fly_high", { duration_seconds: 20 })], [step("hold", { duration_seconds: 3 })])]),
  "heading wrap: counterclockwise double orbit then clockwise half orbit": () => J(place(requireFixture("Paris")), [], { start_movements: [step("orbit_twice", { direction: -1, duration_seconds: 30 }), step("half_orbit", { direction: 1, duration_seconds: 9 })] }),
  "zero-value preservation: revolutions 0 and explicit tilt 0 on an orbit": () => J(place(requireFixture("Stockholm")), [], { start_movements: [step("orbit", { revolutions: 0, tilt_deg: 0, duration_seconds: 6 })] }),
  "explicit altitude equal to the calibrated default vs omitted (Eiffel Tower)": () => J(place(requireFixture("Eiffel Tower"), { altitude_m: 1000 }), [], { start_movements: [step("hold", { duration_seconds: 4 }), step("orbit", { duration_seconds: 20 })] }),
  "extreme legal altitude: manual 60,000,000 m start": () => J(place(requireFixture("Helsinki"), { altitude_m: 60000000 }), [leg(place(requireFixture("Stockholm")), [step("descend", { duration_seconds: 12 })], [step("orbit")])]),
  "very short travel: 1 s fly": () => J(place(requireFixture("Helsinki")), [leg(place(requireFixture("Stockholm")), [step("fly", { duration_seconds: 1 })], [])]),
  "very long travel: Helsinki -> Sydney cruise": () => J(place(requireFixture("Helsinki")), [leg(place(requireFixture("Sydney")), [step("cruise", { duration_seconds: 25 })], [step("slow_orbit", { duration_seconds: 24 })])]),
  "orbit -> travel handoff (settle-then-launch class)": () => J(place(requireFixture("Paris")), [leg(place(requireFixture("Stockholm")), [step("fly", { duration_seconds: 16 })], [])], { start_movements: [step("orbit", { duration_seconds: 18 })] }),
  "terrain: Matterhorn low approach + oblique orbit": () => J(place(requireFixture("Helsinki")), [leg(place(requireFixture("Matterhorn")), [step("fly_low", { duration_seconds: 12 })], [step("orbit", { tilt_deg: 72, duration_seconds: 20 })])]),
  "movement intents: pull_back, climb_to_transit, reveal, spiral_in/out, pause": () => J(place(requireFixture("Helsinki")), [
    leg(place(requireFixture("Stockholm")), [step("pull_back", { duration_seconds: 5 }), step("climb_to_transit", { duration_seconds: 6 }), step("fly", { duration_seconds: 10 }), step("descend", { duration_seconds: 5 })], [step("reveal", { duration_seconds: 6 }), step("spiral_in", { duration_seconds: 15 }), step("spiral_out", { duration_seconds: 15 })]),
    leg(place(requireFixture("Paris")), [step("fly_high", { duration_seconds: 12 }), step("pause", { duration_seconds: 2 })], [step("zoom_in", { duration_seconds: 5 }), step("zoom_out", { duration_seconds: 6 })]),
  ]),
  "fractional values: duration 12.345, tilt 45.678, revolutions 0.3333": () => J(place(requireFixture("Paris")), [], { start_movements: [step("orbit", { duration_seconds: 12.345, tilt_deg: 45.678, revolutions: 0.3333 })] }),
  "emphasis and pace without explicit durations (suggested law)": () => J(place(requireFixture("Helsinki")), [leg(place(requireFixture("Stockholm")), [step("fly", { emphasis: 1.35 })], [step("orbit", { emphasis: 0.8 })])], { pace: "quick", start_movements: [step("hold", { emphasis: 1.08 })] }),
  "16:9 aspect with same journey": () => ({ ...J(place(requireFixture("Paris")), [], { start_movements: [step("hold", { duration_seconds: 3 }), step("orbit", { duration_seconds: 18 })] }), aspect: "16:9" }),
  "mid-journey hold with explicit tilt (known leak preserved, not repaired)": () => J(place(requireFixture("Helsinki")), [leg(place(requireFixture("Stockholm")), [step("fly", { duration_seconds: 10 })], [step("hold", { duration_seconds: 4, tilt_deg: 30 }), step("orbit", { duration_seconds: 18 })])]),
};

Object.entries(ADVERSARIAL).forEach(([label, make]) => {
  test(`path-equivalence adversarial: ${label}`, () => {
    const journey = make();
    const r = runBothPaths(journey, "Equivalence Probe", "2026-09-02T00:00:00.000Z", { aspect: journey.aspect, motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" } });
    assertIdentical(label, r);
    assert.ok(r.structured["earth-studio.esp"].length > 0);
  });
});

test("path-equivalence adversarial: zero orbit degrees and explicit tilt 0 survive the direct path as 0, not as missing", () => {
  const journey = ADVERSARIAL["zero-value preservation: revolutions 0 and explicit tilt 0 on an orbit"]();
  const direct = journeyModel.compileJourneyToParsed(journey, { planner, aspect: journey.aspect });
  const seg = direct.parsed.segments[0];
  assert.equal(seg.action, "orbit");
  assert.equal(seg.orbit_degrees, 0);
  assert.equal(seg.tilt_deg, 0);
  assert.equal(seg.tilt_source, "explicit");
  assert.equal(direct.specs[0].orbit_degrees, 0);
  assert.equal(direct.specs[0].tilt_deg, 0);
});

// ── 4. Direct IR is a PARSER bypass, not a VALIDATION bypass ────────────────
test("direct IR: malformed segment specs are refused, never normalized", () => {
  const good = { source_text: "fly to Helsinki for 5 seconds", action: "fly_to", location_phrase: "Helsinki", duration_seconds: 5, altitude_m: null, altitude_spec_source: null, tilt_deg: null, orbit_degrees: null, orbit_direction: 1 };
  const ok = planner.buildParsedFromSegmentSpecs("fly to Helsinki for 5 seconds", [good]);
  assert.equal(ok.segments.length, 1);
  assert.equal(ok.segments[0].location_name, "Helsinki");
  const bad = [
    ["not an array", "x", [ /must be an array/ ]],
    ["missing source_text", { ...good, source_text: "" }, [/source_text/]],
    ["unsupported action", { ...good, action: "roll" }, [/action must be one of/]],
    ["unresolved action smuggled", { ...good, action: "unresolved" }, [/action must be one of/]],
    ["NaN duration", { ...good, duration_seconds: NaN }, [/duration_seconds/]],
    ["Infinity altitude", { ...good, altitude_m: Infinity, altitude_spec_source: "explicit" }, [/altitude_m/]],
    ["negative altitude", { ...good, altitude_m: -5, altitude_spec_source: "explicit" }, [/altitude_m/]],
    ["altitude without spec source", { ...good, altitude_m: 800, altitude_spec_source: null }, [/altitude_spec_source/]],
    ["tilt above the extractor clamp", { ...good, tilt_deg: 90 }, [/tilt_deg/]],
    ["negative tilt", { ...good, tilt_deg: -1 }, [/tilt_deg/]],
    ["string number", { ...good, duration_seconds: "5" }, [/duration_seconds/]],
    ["orbit direction 0", { ...good, action: "orbit", orbit_degrees: 360, orbit_direction: 0 }, [/orbit_direction/]],
    ["orbit modifiers on a fly", { ...good, orbit_degrees: 360 }, [/orbit modifiers are only valid/]],
    ["negative orbit degrees", { ...good, action: "orbit", orbit_degrees: -90 }, [/orbit_degrees/]],
    ["non-string location", { ...good, location_phrase: 42 }, [/location_phrase/]],
    ["resolution status forged", { ...good, resolution_status: "resolved" }, [/resolution_status/]],
  ];
  for (const [label, spec, patterns] of bad) {
    const specs = spec === "x" ? "x" : [spec];
    assert.throws(() => planner.buildParsedFromSegmentSpecs("probe", specs), (e) => patterns.every((re) => re.test(e.message)), `${label} should be refused`);
  }
  assert.throws(() => planner.buildParsedFromSegmentSpecs(42, [good]), /sourceDescription must be a string/);
  assert.throws(() => planner.buildShotPlanFromParsed("j", { segments: "nope" }, "2026-09-02T00:00:00.000Z"), /parsed description with segments/);
});

test("direct IR: an invalid journey is refused by compileJourneyToParsed with the lane's operator-language errors", () => {
  const cases = [
    ["unknown place", J(place("Nowhereville"), [])],
    ["comma in place name", J(place("Helsinki, Finland"), [])],
    ["zero duration", J(place("Helsinki"), [], { start_movements: [step("hold", { duration_seconds: 0 })] })],
    ["unsupported movement type", J(place("Helsinki"), [], { start_movements: [step("dolly_zoom")] })],
    ["empty journey", J(place("Helsinki"), [])],
  ];
  for (const [label, journey] of cases) {
    assert.throws(() => journeyModel.compileJourneyToParsed(journey, { planner }), (e) => e.statusCode === 400 && Array.isArray(e.journey_errors) && e.journey_errors.length > 0, `${label} should be refused with statusCode 400`);
  }
});

// ── 5. Provenance and authority boundary ───────────────────────────────────
test("direct IR: plan bytes keep the historical parser_strategy string; truthful origin is out-of-band", () => {
  const journey = J(place(requireFixture("Paris")), [], { start_movements: [step("hold", { duration_seconds: 3 })] });
  const direct = journeyModel.compileJourneyToParsed(journey, { planner, aspect: journey.aspect });
  assert.equal(direct.parsed.parser_strategy, "offline_regex_with_manual_review_fallback");
  assert.deepEqual(direct.provenance, {
    input: "structured_journey", journey_version: 1, text_parsed_for_authority: false,
    text_parsed_for_verification: true, planner_version: planner.VERSION,
  });
  const unverified = journeyModel.compileJourneyToParsed(journey, { planner, aspect: journey.aspect, validate: false });
  assert.equal(unverified.provenance.text_parsed_for_verification, false);
  assert.equal(JSON.stringify(unverified.parsed), JSON.stringify(direct.parsed));
  // The description is still produced (provenance), and equals the text path's input.
  assert.equal(direct.parsed.source_description, direct.compiled.description);
});

test("direct IR: no gazetteer name is itself parser trigger vocabulary (structured and text locations agree)", () => {
  const names = Object.values(planner.LOCATION_FIXTURES).map((f) => f.name);
  const hazards = [];
  for (const n of names) {
    if (planner.detectAction(`hover over ${n}`).action !== "hover") hazards.push(`${n}: action`);
    const o = planner.extractOrbitSpec(n); if (o.orbit_degrees !== null || o.orbit_direction !== 1) hazards.push(`${n}: orbit`);
    if (planner.extractTiltSpec(n).tilt_deg !== null) hazards.push(`${n}: tilt`);
    if (planner.extractAltitudeSpec(n).altitude_m !== null) hazards.push(`${n}: altitude`);
    if (planner.extractDurationSeconds(n) !== null) hazards.push(`${n}: duration`);
    if (planner.extractLocationPhrase(`fly to ${n}`, "fly_to") !== n) hazards.push(`${n}: location phrase`);
  }
  // Known, pre-existing: one fixture name contains a comma and cannot be
  // referenced by name through EITHER path (journey validation refuses commas).
  const known = names.filter((n) => n.includes(","));
  assert.deepEqual(hazards, [], hazards.join("; "));
  assert.ok(known.length <= 1, `comma-bearing fixture names: ${known.join("; ")}`);
});
