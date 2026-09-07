// EARTH STUDIO TEXT-DIRECTION V2 — semantic safety + hard failure gates.
//
// Permanent regression tests for the incidents reproduced against main@5dfd1f1:
//   * unrestricted substring geography ("climate" -> Lima, "chrome" -> Rome)
//   * aliases the planner already knew but the Director never consulted (NYC)
//   * explicit coordinates silently dropped by the Director
//   * conceptual references collapsed to the wrong subject (Finnish capital -> Sweden)
//   * camera-quality FAIL returned to callers as ok:true
// Every test here failed against the baseline before repair (see the evidence
// directory) and must stay green. These are semantic-safety tests, not
// aesthetics: PASS_FOR_HUMAN_REVIEW is preserved as the only machine "pass".
const { assert, fs, path, test } = require("./_helpers.js");
const os = require("node:os");
const planner = require("../earth-studio-job-planner.js");
const director = require("../earth-studio-director.js");
const lane = require("../earth-studio-lane.js");

const ROOT = path.join(__dirname, "..");
const OBQ20 = path.join(ROOT, "package-runs", "2026-08-21-earth-studio-obliquity-ab", "projects",
  "OBQ-20-route-restraint-A-baseline", "earth-studio");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "es-text-v2-"));
const names = (intent) => intent.stops.map((s) => s.location);

// ── one location authority ─────────────────────────────────────────────────

test("v2 resolver: the planner exposes a boundary-aware mention finder (single authority)", () => {
  assert.equal(typeof planner.findLocationMentions, "function", "planner.findLocationMentions must exist");
  const r = planner.findLocationMentions("Start in Paris, then Rome, then Lima.");
  assert.deepEqual(r.mentions.map((m) => m.name), ["Paris", "Rome", "Lima"]);
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(r.ambiguous, []);
});

test("v2 resolver: 'climate' never resolves Lima, 'chrome' never resolves Rome (no substring geography)", () => {
  for (const text of ["Make the climate dramatic", "Give it a polished chrome look"]) {
    const found = planner.findLocationMentions(text);
    assert.deepEqual(found.mentions, [], `${text} -> ${JSON.stringify(found.mentions)}`);
    const intent = director.parseIntent(text);
    assert.deepEqual(names(intent), [], `${text} must not name a place`);
    assert.equal(intent.intent.state, "INTENT_INCOMPLETE", `${text} has no geography and must say so`);
  }
});

test("v2 resolver: NYC resolves through the planner's own alias table, in order", () => {
  const intent = director.parseIntent("Start at NYC and end in Boston");
  assert.deepEqual(names(intent), ["New York", "Boston"]);
  const nyc = intent.intent.mentions.find((m) => m.text.toLowerCase() === "nyc");
  assert.ok(nyc, "the NYC mention must be recorded");
  assert.equal(nyc.source, "gazetteer_alias");
  assert.equal(nyc.name, "New York");
  assert.equal(intent.intent.state, "INTENT_RESOLVED");
});

test("v2 resolver: explicit coordinates survive as geographic intent and direct a real stop", () => {
  const intent = director.parseIntent("Fly to 60.1699, 24.9384 then orbit the harbour");
  assert.equal(intent.stops.length, 1, JSON.stringify(intent.stops));
  assert.equal(intent.stops[0].location, "60.1699, 24.9384");
  const m = intent.intent.mentions[0];
  assert.equal(m.source, "explicit_coordinates");
  assert.ok(Math.abs(m.latitude - 60.1699) < 1e-6 && Math.abs(m.longitude - 24.9384) < 1e-6);
  assert.equal(intent.intent.state, "INTENT_RESOLVED");
  const directed = director.autoDirect(intent);
  assert.ok(directed.stops[0].resolved, "coordinates must resolve downstream");
  assert.equal(directed.stops[0].resolved.source, "explicit_coordinates");
  assert.ok(Math.abs(directed.stops[0].resolved.latitude - 60.1699) < 1e-6);
});

test("v2 resolver: 'Finnish capital' and 'Sweden's capital' resolve to two ordered subjects", () => {
  const intent = director.parseIntent("Start at the Finnish capital and finish at Sweden's capital");
  assert.deepEqual(names(intent), ["Helsinki", "Stockholm"]);
  assert.ok(intent.intent.mentions.every((m) => m.source === "capital_reference"), JSON.stringify(intent.intent.mentions));
  assert.equal(intent.intent.state, "INTENT_RESOLVED");
});

test("v2 resolver: a capital reference the gazetteer cannot ground is explicit unresolved intent, not a silent default", () => {
  // Turkey is a known country; its capital is not in the gazetteer.
  const intent = director.parseIntent("Start at the Turkish capital and travel to Istanbul");
  assert.deepEqual(names(intent), ["Istanbul"]);
  assert.equal(intent.intent.state, "INTENT_INCOMPLETE");
  assert.equal(intent.intent.unresolved.length, 1);
  assert.match(intent.intent.unresolved[0].text, /turkish capital/i);
  assert.throws(() => director.autoDirect(intent), (e) => e.code === "INTENT_INCOMPLETE" && Array.isArray(e.intent.unresolved));
});

test("v2 resolver: a bare 'the capital' with two candidate countries is INTENT_AMBIGUOUS", () => {
  const intent = director.parseIntent("Show Finland and Sweden, then orbit the capital.");
  assert.equal(intent.intent.state, "INTENT_AMBIGUOUS", JSON.stringify(intent.intent));
  assert.equal(intent.intent.ambiguous.length, 1);
  assert.deepEqual(intent.intent.ambiguous[0].candidates.slice().sort(), ["Helsinki", "Stockholm"]);
  assert.throws(() => director.autoDirect(intent), (e) => e.code === "INTENT_AMBIGUOUS");
});

test("v2 resolver: a bare 'the capital' with one country in context resolves deterministically", () => {
  const intent = director.parseIntent("Show Finland, then orbit the capital.");
  assert.deepEqual(names(intent), ["Finland", "Helsinki"]);
  assert.equal(intent.intent.state, "INTENT_RESOLVED");
});

test("v2 resolver: longest match still wins and possessives/punctuation do not break names", () => {
  assert.deepEqual(names(director.parseIntent("Hover over Helsinki Cathedral, then fly to Helsinki's harbour")), ["Helsinki Cathedral", "Helsinki"]);
  assert.deepEqual(names(director.parseIntent("Start over St. Petersburg and move to Tallinn")), ["St. Petersburg", "Tallinn"]);
  assert.deepEqual(names(director.parseIntent("Orbit the Colosseum.")), ["Colosseum"]);
});

// ── unresolved intent is a hard gate ───────────────────────────────────────

test("v2 gate: autoDirect refuses a brief with no resolvable geography with a structured reason", () => {
  const intent = director.parseIntent("Make the climate dramatic");
  assert.throws(() => director.autoDirect(intent), (e) => e.code === "INTENT_INCOMPLETE" && e.intent && e.intent.state === "INTENT_INCOMPLETE");
  assert.deepEqual(Object.keys(director.INTENT_STATES).sort(),
    ["INTENT_AMBIGUOUS", "INTENT_INCOMPLETE", "INTENT_INVALID", "INTENT_RESOLVED"]);
});

test("v2 gate: the lane refuses a direction whose intent was never resolved", () => {
  const pkg = tmpdir();
  const r = director.autoDirect(director.parseIntent("Start in Helsinki, then travel to Stockholm."));
  const direction = { intent: { state: "INTENT_AMBIGUOUS", ambiguous: [{ text: "the capital", candidates: ["Helsinki", "Stockholm"] }] } };
  assert.throws(() => lane.writeJob(pkg, { jobName: "gate", journey: r.journey, direction }, { now: "2026-09-07T00:00:00.000Z" }),
    (e) => e.statusCode === 400 && e.code === "INTENT_NOT_RESOLVED");
});

// ── camera-quality FAIL must not be success ────────────────────────────────

test("v2 quality: the stored OBQ-20 zoom_out contradiction reproduces as FAIL and is NOT returned as ok:true", () => {
  const pkg = tmpdir();
  const journey = readJson(path.join(OBQ20, "journey.json"));
  const direction = readJson(path.join(OBQ20, "direction.json"));
  const out = lane.writeJob(pkg, { jobName: "OBQ-20-route-restraint", journey, direction, aspect: "16:9" },
    { now: "2026-08-21T12:00:00.000Z" });
  const report = readJson(path.join(pkg, "earth-studio", "camera-quality.json"));
  assert.equal(report.verdict, "FAIL", "fixture must still reproduce the stored FAIL");
  assert.ok(report.errors.some((e) => /zoom_out/.test(e) && /992474/.test(e)), report.errors.join("; "));
  // evidence is preserved on disk for diagnosis …
  assert.ok(fs.existsSync(path.join(pkg, "earth-studio", "earth-studio.esp")));
  // … but the RESULT must reflect failure.
  assert.equal(out.ok, false, "a FAIL verdict must not be presented as success");
  assert.equal(out.status, "CAMERA_QUALITY_FAIL");
  assert.equal(out.camera_quality.verdict, "FAIL");
  assert.ok(out.camera_quality.errors.length >= 1);
  assert.match(String(out.error), /camera quality/i);
});

test("v2 quality: a clean journey is ok:true with PASS_FOR_HUMAN_REVIEW surfaced — never a machine PASS", () => {
  const pkg = tmpdir();
  const out = lane.writeJob(pkg, {
    jobName: "clean",
    journey: {
      journey_version: 1, pace: "calm",
      start: { location: "Helsinki" },
      start_movements: [{ type: "hold", duration_seconds: 3 }],
      legs: [{ destination: { location: "Stockholm" }, travel_style: "direct",
        travel: [{ type: "fly", duration_seconds: 10 }], movements: [{ type: "hold", duration_seconds: 3 }] }],
    },
  }, { now: "2026-09-07T00:00:00.000Z" });
  assert.equal(out.ok, true);
  assert.equal(out.status, "PASS_FOR_HUMAN_REVIEW");
  assert.equal(out.camera_quality.verdict, "PASS_FOR_HUMAN_REVIEW");
  assert.notEqual(out.camera_quality.verdict, "PASS", "machine evaluation must never emit a plain PASS");
  assert.equal(out.camera_quality.scope, "machine continuity and serialization checks; not an aesthetic approval");
});

test("v2 quality: a freeform description job also carries the verdict (all jobs, not only journeys)", () => {
  const pkg = tmpdir();
  const out = lane.writeJob(pkg, { jobName: "ff", description: "fly to Paris in 3 seconds" }, { now: "2026-09-07T00:00:00.000Z" });
  assert.equal(out.ok, true);
  assert.equal(out.camera_quality.verdict, "PASS_FOR_HUMAN_REVIEW");
  // job.json keeps its byte-frozen v0.9.4 field set: the verdict rides on the RESPONSE, beside camera-quality.json.
  const job = readJson(path.join(pkg, "earth-studio", "job.json"));
  assert.equal(job.camera_quality_verdict, undefined);
});

test("v2 gate: a self-contradicting brief (rules a movement out and asks for it) is INTENT_INVALID, not quietly resolved", () => {
  const intent = director.parseIntent("Fly from Helsinki to Tokyo. Don't orbit, but orbit Tokyo twice.");
  assert.equal(intent.intent.state, "INTENT_INVALID", JSON.stringify(intent.intent.reasons));
  assert.equal(intent.intent.invalid.length, 1);
  assert.match(intent.intent.reasons[0], /rules out orbiting/);
  assert.throws(() => director.autoDirect(intent), (e) => e.code === "INTENT_INVALID");
  // a plain negative constraint alone stays resolved — it is a hard constraint, not a contradiction
  assert.equal(director.parseIntent("Show Helsinki Cathedral, don't orbit.").intent.state, "INTENT_RESOLVED");
});
