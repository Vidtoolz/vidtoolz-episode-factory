// Journey VALIDATION AUTHORITY (2026-09-02 repair).
//
// Contract: raw journey → validateJourneyInput (structure + intent, on the RAW
// input) → normalizeJourney (tolerant canonicalization, never throws, preserves
// invalidity EVIDENCE) → canonical checks → compile. Validity is invariant under
// normalization: validate(raw), validate(normalize(raw)), validate(normalize(
// normalize(raw))) and validate(JSON round-trip) reach the same verdict, so a
// caller that normalizes first can no longer launder an unsupported movement,
// a garbage number, an unknown enum, a wrong version or a non-list into a
// generated animation. Compatibility (numeric strings, omitted/null/"" optionals,
// bare-string steps and places, empty travel lists, explicit zeros) is kept.
const { assert, fs, os, path, test } = require("./_helpers.js");
const childProcess = require("node:child_process");
const planner = require("../earth-studio-job-planner.js");
const journey = require("../earth-studio-journey.js");
const lane = require("../earth-studio-lane.js");

const ROOT = path.join(__dirname, "..");
const base = () => ({ journey_version: 1, pace: "calm", aspect: "9:16", start: { source: "location", location: "Helsinki", framing: "auto" }, start_movements: [], legs: [] });
const withStart = (steps, extra = {}) => ({ ...base(), start_movements: steps, ...extra });
const withLeg = (travel, movements, extra = {}) => ({ ...base(), legs: [{ destination: { location: "Stockholm", framing: "auto" }, travel_style: "direct", travel, movements, ...extra }] });

// Every order a caller might use. All must agree.
function verdicts(raw) {
  const n = journey.normalizeJourney(raw);
  return {
    raw: journey.validateJourney(raw, { planner }),
    normalized: journey.validateJourney(n, { planner }),
    twice: journey.validateJourney(journey.normalizeJourney(n), { planner }),
    roundtrip: journey.validateJourney(JSON.parse(JSON.stringify(n)), { planner }),
  };
}
// Step ids come from a process-wide counter, so two normalizations of the same
// raw journey differ only in ids; strip them before comparing canonical forms.
const withoutIds = (j) => JSON.stringify(j, (k, v) => (k === "id" ? undefined : v));
function assertRejectedEveryOrder(label, raw, pattern) {
  const v = verdicts(raw);
  Object.entries(v).forEach(([order, r]) => {
    assert.equal(r.ok, false, `${label}: must be refused when validated as ${order}`);
    // A non-object cannot carry evidence through normalization (it becomes an
    // empty journey, refused for being empty); the specific message is asserted
    // on the raw order only in that case.
    if (order === "raw" || (raw && typeof raw === "object")) {
      assert.ok(r.errors.some((e) => pattern.test(e)), `${label} (${order}): expected /${pattern.source}/ in: ${r.errors.join(" | ")}`);
    }
    assert.ok(!r.errors.some((e) => /schema|stack|TypeError|undefined/i.test(e)), `${label} (${order}): no internals leaked`);
    assert.equal(r.compiled, null, `${label} (${order}): nothing compiled`);
  });
}
function assertAcceptedEveryOrder(label, raw) {
  const v = verdicts(raw);
  Object.entries(v).forEach(([order, r]) => assert.equal(r.ok, true, `${label} (${order}): ${r.errors.join(" | ")}`));
  return v.raw;
}

// ── Negative: unsupported intent cannot disappear ─────────────────────────
const NEGATIVE = [
  ["unsupported start movement", withStart([{ type: "dollyzoom", duration_seconds: 5 }]), /Start movement 1 is "dollyzoom"/],
  ["unknown movement name", withStart([{ type: "whipPan" }]), /"whipPan", which this generator cannot produce/],
  ["unknown casing", withStart([{ type: "Orbit" }]), /"Orbit", which this generator cannot produce/],
  ["close typo of a supported movement", withStart([{ type: "orbitt" }]), /"orbitt"/],
  ["travel movement in the start slot", withStart([{ type: "fly" }]), /Start movement 1 is "fly"/],
  ["at-movement in the travel slot", withLeg([{ type: "orbit" }], []), /Destination 1 travel movement 1 is "orbit"/],
  ["unsupported travel movement", withLeg([{ type: "teleport", duration_seconds: 10 }], []), /Destination 1 travel movement 1 is "teleport"/],
  ["unsupported destination movement", withLeg([{ type: "fly" }], [{ type: "dollyzoom" }]), /Destination 1 movement 1 is "dollyzoom"/],
  ["movement with no type", withStart([{ duration_seconds: 5 }]), /Start movement 1 has no movement type/],
  ["movement with null type", withStart([{ type: null }]), /has no movement type/],
  ["movement with numeric type", withStart([{ type: 7 }]), /"7"|not a name/],
  ["movement that is not an object", withStart([7]), /"7"|not a movement/],
  ["unsupported movement carrying otherwise valid fields", withStart([{ type: "dollyzoom", duration_seconds: 5, emphasis: 1.2, tilt_deg: 45, altitude_m: 800, revolutions: 1, direction: -1 }]), /"dollyzoom"/],
  ["unsupported movement with compatibility numeric strings", withStart([{ type: "dollyzoom", duration_seconds: "5", tilt_deg: "45", revolutions: "1", direction: "-1" }]), /"dollyzoom"/],
  ["unsupported movement with explicit zeros", withStart([{ type: "dollyzoom", revolutions: 0, tilt_deg: 0, emphasis: 0 }]), /"dollyzoom"/],
  ["non-numeric duration", withStart([{ type: "hold", duration_seconds: "abc" }]), /duration seconds that is not a number/],
  ["NaN duration", withStart([{ type: "hold", duration_seconds: NaN }]), /duration seconds that is not a number/],
  ["Infinity altitude", withStart([{ type: "orbit", altitude_m: Infinity }]), /altitude m that is not a number/],
  ["non-numeric emphasis", withStart([{ type: "hold", emphasis: "loud" }]), /emphasis that is not a number/],
  ["direction 0", withStart([{ type: "orbit", direction: 0 }]), /direction 0; use 1 \(clockwise\) or -1/],
  ["direction as a word", withStart([{ type: "orbit", direction: "left" }]), /direction "left"/],
  ["negative revolutions", withStart([{ type: "orbit", revolutions: -1 }]), /negative revolutions/],
  ["unknown journey pace", withStart([{ type: "hold" }], { pace: "frantic" }), /pace "frantic" is not one of/],
  ["unknown step pace", withStart([{ type: "hold", pace: "frantic" }]), /pace "frantic"/],
  ["unknown step framing", withStart([{ type: "hold", framing: "huge" }]), /framing "huge"/],
  ["unknown place framing", { ...base(), start: { ...base().start, framing: "huge" }, start_movements: [{ type: "hold" }] }, /framing "huge"/],
  ["non-numeric place altitude", { ...base(), start: { ...base().start, altitude_m: "abc" }, start_movements: [{ type: "hold" }] }, /altitude m that is not a number/],
  ["unknown travel style", withLeg([{ type: "fly" }], [], { travel_style: "warp" }), /travel style "warp"/],
  ["unsupported journey version", withStart([{ type: "hold" }], { journey_version: 2 }), /version 2/],
  ["unknown start source", { ...base(), start: { ...base().start, source: "teleport" }, start_movements: [{ type: "hold" }] }, /start source "teleport"/],
  ["legs not a list", withStart([{ type: "hold" }], { legs: "nope" }), /Destinations must be a list/],
  ["travel not a list", withLeg("fly", []), /travel must be a list/],
  ["movements not a list", withLeg([{ type: "fly" }], "hold"), /movements must be a list/],
  ["unknown aspect", withStart([{ type: "hold" }], { aspect: "4:3" }), /aspect "4:3"/],
  ["journey is not an object", "fly to Helsinki", /not a camera journey/],
];
NEGATIVE.forEach(([label, raw, pattern]) => {
  test(`validation authority refuses in every order: ${label}`, () => assertRejectedEveryOrder(label, raw, pattern));
});

test("validation authority: normalization preserves invalidity evidence instead of erasing it", () => {
  const n = journey.normalizeJourney(withStart([{ type: "dollyzoom", duration_seconds: "abc", direction: 0, pace: "frantic" }], { pace: "frantic", journey_version: 2, legs: "nope" }));
  const s = n.start_movements[0];
  assert.equal(s.type, "hold", "normalization still yields a safe default (never throws)");
  assert.equal(s.unsupported_type, "dollyzoom");
  assert.deepEqual(s.invalid_fields, { duration_seconds: "abc", pace: "frantic", direction: 0 });
  assert.deepEqual(n.invalid_fields, { journey_version: 2, pace: "frantic", legs: "nope" });
  assert.equal(n.pace, "calm");
  // evidence survives a second normalization and a JSON round trip
  const again = journey.normalizeJourney(JSON.parse(JSON.stringify(n)));
  assert.equal(again.start_movements[0].unsupported_type, "dollyzoom");
  assert.deepEqual(again.start_movements[0].invalid_fields, s.invalid_fields);
  assert.deepEqual(again.invalid_fields, n.invalid_fields);
  // a missing type is evidence too
  assert.equal(journey.normalizeJourney(withStart([{}])).start_movements[0].unsupported_type, "");
});

test("validation authority: junk still normalizes without throwing and is still refused", () => {
  [undefined, null, 0, "journey", [], { legs: "nope" }, { start: 5, start_movements: {} }].forEach((raw) => {
    const n = journey.normalizeJourney(raw);
    assert.equal(n.journey_version, 1);
    assert.equal(journey.validateJourney(n, { planner }).ok, false);
  });
});

test("validation authority: the lane refuses unsupported intent BEFORE creating any artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-authority-"));
  const pkg = path.join(root, "aigen", "script-packages", "es-authority-project");
  fs.mkdirSync(pkg, { recursive: true });
  const attempts = [
    withStart([{ type: "dollyzoom", duration_seconds: 5 }]),
    journey.normalizeJourney(withStart([{ type: "dollyzoom", duration_seconds: 5 }])), // pre-normalized by a client
    withLeg([{ type: "teleport" }], []),
    withStart([{ type: "hold", duration_seconds: "abc" }]),
  ];
  for (const j of attempts) {
    assert.throws(() => lane.writeJob(pkg, { journey: j, jobName: "Authority Probe", aspect: "9:16" }, { now: "2026-09-02T00:00:00.000Z" }),
      (e) => e.statusCode === 400 && Array.isArray(e.journey_errors) && e.journey_errors.length > 0 && !/TypeError|undefined/.test(e.message));
    assert.equal(fs.existsSync(path.join(pkg, "earth-studio")), false, "no earth-studio directory or artifact may exist after a refusal");
  }
});

// ── Positive: the compatibility contract is unchanged ─────────────────────
const POSITIVE = [
  ["numeric strings", withStart([{ type: "orbit", duration_seconds: "12", tilt_deg: "60", revolutions: "1", direction: "-1", emphasis: "1.2" }])],
  ["omitted optionals", withStart([{ type: "hold" }])],
  ["null optionals", withStart([{ type: "hold", duration_seconds: null, pace: null, framing: null, emphasis: null, altitude_m: null, tilt_deg: null, revolutions: null }])],
  ["empty strings mean absent", withStart([{ type: "hold", duration_seconds: "", pace: "", framing: "" }])],
  ["explicit zeros where zero is legal", withStart([{ type: "orbit", revolutions: 0, tilt_deg: 0, emphasis: 0 }])],
  ["empty travel list takes the style defaults", withLeg([], [], { travel_style: "cinematic" })],
  ["bare-string steps and places", { ...base(), start: "Helsinki", start_movements: ["hold"], legs: [{ destination: "Stockholm" }] }],
  ["step framing auto", withStart([{ type: "hold", framing: "auto" }])],
  ["no journey_version field", (() => { const j = withStart([{ type: "hold" }]); delete j.journey_version; return j; })()],
  ["direction as numeric strings", withStart([{ type: "orbit", direction: "1" }, { type: "orbit", direction: "-1" }])],
  ["all supported movement forms in their slots", { ...base(), start_movements: journey.AT_MOVEMENT_KEYS.map((t) => ({ type: t, duration_seconds: 6 })), legs: [{ destination: { location: "Stockholm" }, travel: journey.TRAVEL_MOVEMENT_KEYS.map((t) => ({ type: t, duration_seconds: 6 })), movements: [{ type: "hold", duration_seconds: 3 }] }] }],
  ["continuation start", journey.journeyFromContinuationState(journey.continuationStateFromPlan(planner.buildShotPlan("seed", "fly to Helsinki for 5 seconds", "2026-09-02T00:00:00.000Z", { aspect: "16:9" })), { destination: "Stockholm" })],
];
POSITIVE.forEach(([label, raw]) => {
  test(`validation authority accepts in every order: ${label}`, () => {
    const r = assertAcceptedEveryOrder(label, raw);
    assert.ok(r.compiled && r.compiled.steps.length > 0);
    assert.equal(withoutIds(r.journey), withoutIds(journey.normalizeJourney(raw)), "validator returns the canonical journey");
    assert.equal(r.journey.invalid_fields, undefined, "valid input never carries evidence");
    r.journey.start_movements.forEach((s) => assert.equal(s.invalid_fields, undefined));
  });
});

test("validation authority: every tracked journey canary validates in every order with unchanged canonical form", () => {
  let out;
  try { out = childProcess.execFileSync("git", ["ls-files", "package-runs/**/journey.json"], { cwd: ROOT, encoding: "utf8" }); }
  catch (e) { assert.ok(true, "skipped: not a git checkout"); return; }
  const files = out.trim().split("\n").filter(Boolean);
  assert.ok(files.length >= 148, `expected >=148 tracked journeys, found ${files.length}`);
  const failures = [];
  for (const rel of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    const v = verdicts(raw);
    Object.entries(v).forEach(([order, r]) => { if (!r.ok) failures.push(`${rel} (${order}): ${r.errors[0]}`); });
    if (JSON.stringify(v.raw.journey) !== JSON.stringify(journey.normalizeJourney(raw))) failures.push(`${rel}: canonical journey differs`);
    if (v.raw.compiled.description !== journey.compileJourney(journey.normalizeJourney(raw), { planner }).description) failures.push(`${rel}: compiled description differs`);
    if (JSON.stringify(v.raw.journey).includes("invalid_fields") || JSON.stringify(v.raw.journey).includes("unsupported_type")) failures.push(`${rel}: valid canary carries evidence fields`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("validation authority: validateJourneyInput is the single raw stage and agrees with validateJourney", () => {
  const bad = withStart([{ type: "dollyzoom" }]);
  const raw = journey.validateJourneyInput(bad, { planner });
  assert.equal(raw.ok, false);
  assert.deepEqual(journey.validateJourney(bad, { planner }).errors, raw.errors, "stage-1 errors are reported verbatim, nothing else runs");
  assert.equal(journey.validateJourneyInput(withStart([{ type: "hold" }]), { planner }).ok, true);
  // a canonical-stage problem (unknown place) is NOT a stage-1 problem
  const unknownPlace = { ...withStart([{ type: "hold" }]), start: { location: "Narnia" } };
  assert.equal(journey.validateJourneyInput(unknownPlace, { planner }).ok, true);
  assert.equal(journey.validateJourney(unknownPlace, { planner }).ok, false);
});
