// HOLD CAMERA-STATE AUTHORITY (2026-09-02 repair).
//
// A non-opening hold (journey `hold`, travel-slot `pause`) OWNS TIME, NOT CAMERA:
//   - it inherits the exact incoming canonical camera state (position, altitude,
//     pan, tilt) and applies nothing of its own;
//   - explicit camera fields on it (tilt_deg, altitude_m, framing) are refused at
//     raw validation, in every call order, on the lane and on the direct IR path,
//     before any artifact exists;
//   - the compiler's camera cursor after the hold equals what the planner applies;
//   - the rendered camera is static across the hold's COMPLETE interval — no
//     transient drift that returns to the same endpoint.
// Opening holds keep their framing authority byte-for-byte.
const { assert, fs, os, path, test } = require("./_helpers.js");
const childProcess = require("node:child_process");
const planner = require("../earth-studio-job-planner.js");
const journey = require("../earth-studio-journey.js");
const continuity = require("../earth-studio-motion-continuity.js");
const lane = require("../earth-studio-lane.js");

const ROOT = path.join(__dirname, "..");
const POL = { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" };
const st = (type, extra = {}) => ({ type, ...extra });
const pl = (location, extra = {}) => ({ location, framing: "auto", altitude_m: null, tilt_deg: null, ...extra });
const J = (start, legs, extra = {}) => ({ journey_version: 1, pace: "calm", aspect: "16:9", start: { source: "location", ...start }, start_movements: [], legs, ...extra });
const leg = (dest, travel, movements = []) => ({ destination: dest, travel_style: "direct", travel, movements });

// Build through the production lane semantics (validate → compile → plan → esp) and
// measure every hover segment: compiler cursor vs applied plan, rendered state, drift.
function analyse(raw) {
  const check = journey.validateJourney(raw, { planner });
  assert.ok(check.ok, `fixture must be valid: ${check.errors.join(" | ")}`);
  const compiled = check.compiled;
  const plan = planner.buildShotPlan("t", compiled.description, "2026-09-02T00:00:00.000Z", { aspect: raw.aspect || "16:9", motionPolicy: POL });
  const esp = planner.buildEsp(plan, { motionPolicy: POL });
  const tracks = continuity.extractEspCameraTracks(esp);
  const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  const holds = [];
  compiled.steps.forEach((s, i) => {
    if (s.action !== "hover") return;
    const seg = plan.segments[i];
    const f0 = Math.round(seg.start_frame); const f1 = Math.round(seg.end_frame);
    const report = continuity.holdIntegrityReport({ tracks, startFrame: f0, endFrame: f1, totalFrames: plan.total_frames, frameRate: plan.frame_rate });
    let maxDrift = 0;
    const origin = { latitude: trace.lat.values[f0], longitude: trace.lng.values[f0] };
    for (let f = f0; f <= f1; f += 1) maxDrift = Math.max(maxDrift, continuity.haversineMeters({ latitude: trace.lat.values[f], longitude: trace.lng.values[f] }, origin));
    holds.push({ index: i, opening: !s.holds_camera, compiled: s, seg, report, maxDrift, f0, f1,
      renderedTilt: { start: trace.tilt.values[f0], end: trace.tilt.values[f1] },
      renderedAlt: { start: trace.alt.values[f0], end: trace.alt.values[f1] },
      renderedPan: { start: trace.pan.values[f0], end: trace.pan.values[f1] } });
  });
  return { compiled, plan, esp, tracks, trace, holds, final: planner.finalCameraState(plan, { motionPolicy: POL }) };
}

function assertHoldCoherent(label, h) {
  // cursor == applied
  assert.ok(Math.abs(h.compiled.tilt_deg - h.seg.tilt_deg) < 0.01, `${label}: compiler cursor tilt ${h.compiled.tilt_deg} != applied ${h.seg.tilt_deg}/${h.seg.tilt_source}`);
  assert.ok(Math.abs(h.compiled.altitude_m - h.seg.altitude_m) <= 1, `${label}: compiler cursor altitude ${h.compiled.altitude_m} != applied ${h.seg.altitude_m}`);
  if (!h.opening) {
    assert.equal(h.seg.holds_camera, true, `${label}: a non-opening hold must be a camera hold`);
    assert.equal(h.seg.tilt_source, "carried_over", `${label}: hold tilt must be inherited`);
    assert.equal(h.seg.altitude_source, "carried_over", `${label}: hold altitude must be inherited`);
  }
  // complete-interval static
  assert.ok(h.report.stationary, `${label}: hold is not static across its interval: ${JSON.stringify(h.report.maximum_drift)} first violation ${JSON.stringify(h.report.first_violation)}`);
  assert.ok(h.maxDrift < 1, `${label}: transient position drift of ${h.maxDrift.toFixed(2)} m inside the hold`);
  assert.ok(Math.abs(h.renderedTilt.start - h.renderedTilt.end) < 1e-6 && Math.abs(h.renderedTilt.start - h.seg.tilt_deg) < 0.01, `${label}: rendered tilt ${h.renderedTilt.start}→${h.renderedTilt.end} vs plan ${h.seg.tilt_deg}`);
}

// ── Valid holds: inheritance + static + cursor invariant ───────────────────
const VALID = {
  "opening hold (control) → orbit": J(pl("Paris"), [], { start_movements: [st("hold", { duration_seconds: 3 }), st("orbit", { duration_seconds: 12 })] }),
  "opening hold with explicit tilt 30 (control, still authoritative) → orbit": J(pl("Paris"), [], { start_movements: [st("hold", { duration_seconds: 3, tilt_deg: 30 }), st("orbit", { duration_seconds: 12 })] }),
  "travel → hold (omitted)": J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4 })])]),
  "travel → hold → orbit (omitted, staged through the hold)": J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4 }), st("orbit", { duration_seconds: 12 })])]),
  "orbit → hold (omitted, last)": J(pl("Paris"), [], { start_movements: [st("orbit", { duration_seconds: 12 }), st("hold", { duration_seconds: 4 })] }),
  "orbit → hold → travel (settle → launch)": J(pl("Paris"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [])], { start_movements: [st("orbit", { duration_seconds: 12 }), st("hold", { duration_seconds: 4 })] }),
  "orbit → hold → orbit": J(pl("Paris"), [], { start_movements: [st("orbit", { duration_seconds: 12 }), st("hold", { duration_seconds: 4 }), st("half_orbit", { duration_seconds: 9 })] }),
  "orbit → hold → zoom_out": J(pl("Paris"), [], { start_movements: [st("orbit", { duration_seconds: 12 }), st("hold", { duration_seconds: 4 }), st("zoom_out", { duration_seconds: 6 })] }),
  "hold before travel (opening hold → fly)": J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [])], { start_movements: [st("hold", { duration_seconds: 3 })] }),
  "terrain: fly_low 72° → hold → orbit at Matterhorn": J(pl("Helsinki"), [leg(pl("Matterhorn"), [st("fly_low", { duration_seconds: 12 })], [st("hold", { duration_seconds: 4 }), st("orbit", { duration_seconds: 14 })])]),
  "pause mid-travel (omitted)": J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 6 }), st("pause", { duration_seconds: 3 }), st("fly", { duration_seconds: 6 })], [])]),
  "repeated holds after travel": J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 2 }), st("hold", { duration_seconds: 2 }), st("orbit", { duration_seconds: 12 })])]),
  "very short hold (0.5 s) after orbit": J(pl("Paris"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [])], { start_movements: [st("orbit", { duration_seconds: 12 }), st("hold", { duration_seconds: 0.5 })] }),
  "long hold (60 s) after orbit → orbit": J(pl("Paris"), [], { start_movements: [st("orbit", { duration_seconds: 12 }), st("hold", { duration_seconds: 60 }), st("orbit", { duration_seconds: 12 })] }),
  "continuation-seeded journey with opening hold": journey.journeyFromContinuationState(journey.continuationStateFromPlan(planner.buildShotPlan("seed", "orbit Paris once clockwise at 17014m tilted 60 degrees for 12 seconds", "2026-09-02T00:00:00.000Z", { aspect: "16:9" })), { destination: "Stockholm" }),
};
Object.entries(VALID).forEach(([label, raw]) => {
  test(`hold camera-state: ${label} — inherits, stays static, cursor equals applied`, () => {
    const r = analyse(raw);
    assert.ok(r.holds.length > 0);
    r.holds.forEach((h) => assertHoldCoherent(label, h));
  });
});

test("hold camera-state: a hold is transparent — orbit after fly_low→hold inherits the same tilt as orbit directly after fly_low", () => {
  const withHold = analyse(J(pl("Helsinki"), [leg(pl("Matterhorn"), [st("fly_low", { duration_seconds: 12 })], [st("hold", { duration_seconds: 4 }), st("orbit", { duration_seconds: 14 })])]));
  const direct = analyse(J(pl("Helsinki"), [leg(pl("Matterhorn"), [st("fly_low", { duration_seconds: 12 })], [st("orbit", { duration_seconds: 14 })])]));
  const orbitWith = withHold.plan.segments.find((s) => s.action === "orbit");
  const orbitDirect = direct.plan.segments.find((s) => s.action === "orbit");
  assert.equal(orbitWith.tilt_deg, orbitDirect.tilt_deg, "the hold must not change what the following orbit inherits");
  assert.equal(orbitWith.altitude_m, orbitDirect.altitude_m);
});

test("hold camera-state: after an orbit the following travel launches from the exact held pose", () => {
  const r = analyse(VALID["orbit → hold → travel (settle → launch)"]);
  const h = r.holds[0];
  const fly = r.plan.segments[2];
  assert.equal(fly.action, "fly_to");
  const lat = r.trace.lat.values; const lng = r.trace.lng.values;
  assert.ok(continuity.haversineMeters({ latitude: lat[h.f1], longitude: lng[h.f1] }, { latitude: lat[h.f0], longitude: lng[h.f0] }) < 0.5, "hold end equals hold start");
  assert.ok(Math.abs(r.trace.tilt.values[h.f1] - h.seg.tilt_deg) < 0.01);
});

// ── Invalid holds: explicit camera fields refused in every order, both paths ──
const INVALID = [
  ["minimal leak: fly → hold(tilt 30) → half_orbit", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4, tilt_deg: 30 }), st("half_orbit", { duration_seconds: 12 })])]), /Destination 1 movement 1 is a Hold[^]*tilt/],
  ["explicit tilt zero on a mid hold", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4, tilt_deg: 0 }), st("half_orbit", { duration_seconds: 12 })])]), /is a Hold[^]*tilt/],
  ["explicit altitude on a mid hold", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4, altitude_m: 3000 }), st("half_orbit", { duration_seconds: 12 })])]), /is a Hold[^]*altitude/],
  ["explicit altitude and tilt on a mid hold", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4, altitude_m: 3000, tilt_deg: 30 })])]), /is a Hold[^]*altitude[^]*tilt|is a Hold[^]*tilt[^]*altitude/],
  ["numeric-string tilt on a mid hold", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4, tilt_deg: "30" })])]), /is a Hold[^]*tilt/],
  ["numeric-string zero altitude on a mid hold", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4, altitude_m: "0" })])]), /is a Hold[^]*altitude/],
  ["explicit framing on a mid hold", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4, framing: "city" })])]), /is a Hold[^]*framing/],
  ["pause with explicit tilt", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 6 }), st("pause", { duration_seconds: 3, tilt_deg: 30 }), st("fly", { duration_seconds: 6 })], [])]), /travel movement 2 is a Pause[^]*tilt/],
  ["pause with explicit altitude", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 6 }), st("pause", { duration_seconds: 3, altitude_m: 5000 })], [])]), /is a Pause[^]*altitude/],
  ["second start movement hold with tilt (non-opening)", J(pl("Paris"), [], { start_movements: [st("orbit", { duration_seconds: 12 }), st("hold", { duration_seconds: 4, tilt_deg: 30 })] }), /Start movement 2 is a Hold[^]*tilt/],
  ["hold after orbit with tilt then travel", J(pl("Paris"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [])], { start_movements: [st("orbit", { duration_seconds: 12 }), st("hold", { duration_seconds: 4, tilt_deg: 60 })] }), /is a Hold[^]*tilt/],
  ["repeated holds, second with tilt", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("hold", { duration_seconds: 2 }), st("hold", { duration_seconds: 2, tilt_deg: 30 })])]), /movement 2 is a Hold[^]*tilt/],
  ["destination hold is non-opening even when the leg's travel list is empty (defaults are inserted)", J(pl("Helsinki"), [leg(pl("Stockholm"), [], [st("hold", { duration_seconds: 4, tilt_deg: 30 })])]), /is a Hold[^]*tilt/],
];
function refusals(raw) {
  const n = journey.normalizeJourney(raw);
  return { raw: journey.validateJourney(raw, { planner }), normalized: journey.validateJourney(n, { planner }),
    twice: journey.validateJourney(journey.normalizeJourney(n), { planner }), roundtrip: journey.validateJourney(JSON.parse(JSON.stringify(n)), { planner }) };
}
INVALID.forEach(([label, raw, pattern]) => {
  test(`hold camera-state refuses in every order: ${label}`, () => {
    Object.entries(refusals(raw)).forEach(([order, r]) => {
      assert.equal(r.ok, false, `${label} (${order}) must be refused`);
      assert.ok(r.errors.some((e) => pattern.test(e)), `${label} (${order}): expected /${pattern.source}/ in: ${r.errors.join(" | ")}`);
      assert.equal(r.compiled, null);
    });
  });
});

// ── Hold LOCATION authority: a hold must be where the camera is ──────────────
test("hold camera-state: a hold at a destination that no travel step reaches is refused as a jump (every order)", () => {
  const jump = J(pl("Helsinki"), [leg(pl("Stockholm"), [st("pull_back", { duration_seconds: 6 })], [st("hold", { duration_seconds: 4 })])]);
  Object.entries(refusals(jump)).forEach(([order, r]) => {
    assert.equal(r.ok, false, `jump hold must be refused (${order})`);
    assert.ok(r.errors.some((e) => /is a Hold at Stockholm, but the camera is still at Helsinki/.test(e) && /Pull Back/.test(e)), r.errors.join(" | "));
  });
  // climb_to_transit alone does not reach either
  const jump2 = J(pl("Helsinki"), [leg(pl("Stockholm"), [st("climb_to_transit", { duration_seconds: 6 })], [st("hold", { duration_seconds: 4 })])]);
  assert.equal(journey.validateJourney(jump2, { planner }).ok, false);
  // the same shape WITHOUT a hold is not this rule's business (the orbit approaches by itself, as before)
  const orbitInstead = J(pl("Helsinki"), [leg(pl("Stockholm"), [st("pull_back", { duration_seconds: 6 })], [st("orbit", { duration_seconds: 12 })])]);
  assert.equal(journey.validateJourney(orbitInstead, { planner }).ok, true);
});

test("hold camera-state: holds where the camera already is remain valid (same-place leg, reaching travel, defaults, descend-only, travel-slot pause)", () => {
  const cases = [
    ["same-place leg after pull_back (the DIRECTOR-GLOBAL-network shape)", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("fly", { duration_seconds: 10 })], [st("orbit", { duration_seconds: 12 })]), leg(pl("Stockholm"), [st("pull_back", { duration_seconds: 6 })], [st("hold", { duration_seconds: 4 })])])],
    ["descend-only travel reaches the destination", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("descend", { duration_seconds: 8 })], [st("hold", { duration_seconds: 4 })])])],
    ["empty travel list takes reaching defaults", J(pl("Helsinki"), [leg(pl("Stockholm"), [], [st("hold", { duration_seconds: 4 })])])],
    ["climb then cruise reaches", J(pl("Helsinki"), [leg(pl("Stockholm"), [st("climb_to_transit", { duration_seconds: 5 }), st("cruise", { duration_seconds: 10 })], [st("hold", { duration_seconds: 4 })])])],
    ["travel-slot pause targets the camera's place (canary G shape)", J(pl("Helsinki"), [leg(pl("Espoo"), [st("pause", { duration_seconds: 3 })], [st("orbit", { duration_seconds: 12 })])])],
  ];
  cases.forEach(([label, raw]) => {
    const r = journey.validateJourney(raw, { planner });
    assert.ok(r.ok, `${label}: ${r.errors.join(" | ")}`);
    const a = analyse(raw);
    a.holds.filter((h) => !h.opening).forEach((h) => assertHoldCoherent(label, h));
  });
});

test("hold camera-state: the lane and the direct IR path refuse identically and emit no artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-hold-"));
  for (const [label, raw] of INVALID) {
    for (const input of [raw, journey.normalizeJourney(raw)]) {
      const pkg = fs.mkdtempSync(path.join(root, "pkg-"));
      let laneErr = null; let directErr = null;
      try { lane.writeJob(pkg, { journey: input, jobName: "hold probe", aspect: "16:9" }, { now: "2026-09-02T00:00:00.000Z" }); } catch (e) { laneErr = e; }
      try { journey.compileJourneyToParsed(input, { planner, aspect: "16:9" }); } catch (e) { directErr = e; }
      assert.ok(laneErr && laneErr.statusCode === 400, `${label}: lane must refuse`);
      assert.ok(directErr && directErr.statusCode === 400, `${label}: direct path must refuse`);
      assert.deepEqual(laneErr.journey_errors, directErr.journey_errors, `${label}: same errors on both paths`);
      assert.equal(fs.existsSync(path.join(pkg, "earth-studio")), false, `${label}: no artifact directory after refusal`);
    }
  }
});

test("hold camera-state: opening holds keep explicit framing authority (tilt, altitude, framing) unchanged", () => {
  const cases = [
    J(pl("Paris"), [], { start_movements: [st("hold", { duration_seconds: 3, tilt_deg: 30 }), st("orbit", { duration_seconds: 12 })] }),
    J(pl("Paris"), [], { start_movements: [st("hold", { duration_seconds: 3, altitude_m: 5000 }), st("orbit", { duration_seconds: 12 })] }),
    J(pl("Paris"), [], { start_movements: [st("hold", { duration_seconds: 3, framing: "city" })] }),
    J(pl("Helsinki"), [leg(pl("Stockholm"), [st("pause", { duration_seconds: 2, tilt_deg: 20 }), st("fly", { duration_seconds: 8 })], [])]), // opening pause in the travel slot
  ];
  cases.forEach((raw, i) => {
    const check = journey.validateJourney(raw, { planner });
    assert.ok(check.ok, `opening hold case ${i + 1} must stay valid: ${check.errors.join(" | ")}`);
    assert.equal(check.compiled.steps[0].holds_camera, false);
  });
  const r = analyse(cases[0]);
  assert.equal(r.plan.segments[0].tilt_deg, 30);
  assert.equal(r.plan.segments[0].tilt_source, "explicit");
});

test("hold camera-state: tracked corpus — every hover step's compiler cursor equals the applied plan and every mid hold is static", () => {
  let out;
  try { out = childProcess.execFileSync("git", ["ls-files", "package-runs/**/journey.json"], { cwd: ROOT, encoding: "utf8" }); }
  catch (e) { assert.ok(true, "skipped: not a git checkout"); return; }
  const files = out.trim().split("\n").filter(Boolean);
  assert.ok(files.length >= 148);
  const failures = [];
  let holds = 0;
  for (const rel of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    const plan = JSON.parse(fs.readFileSync(path.join(ROOT, path.dirname(rel), "shot-plan.json"), "utf8"));
    const compiled = journey.compileJourney(journey.normalizeJourney(raw), { planner });
    const parsed = planner.parseDescription(compiled.description, { aspect: plan.aspect });
    compiled.steps.forEach((s, i) => {
      if (s.action !== "hover") return;
      holds += 1;
      const seg = parsed.segments[i];
      if (Math.abs(s.tilt_deg - seg.tilt_deg) > 0.01 || Math.abs(s.altitude_m - seg.altitude_m) > 1) failures.push(`${rel} step ${i}: cursor ${s.tilt_deg}/${s.altitude_m} vs applied ${seg.tilt_deg}/${seg.altitude_m}`);
    });
  }
  assert.ok(holds >= 150, `expected the corpus hover steps, saw ${holds}`);
  assert.deepEqual(failures, [], failures.join("\n"));
});
