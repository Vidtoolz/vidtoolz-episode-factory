// EARTH STUDIO TEXT-DIRECTION V2 — Stage B: structured directorial brief, timing, tone.
// The brief must make assumptions inspectable (provenance per field), timing must
// survive text -> brief -> Director -> plan within the documented tolerance, and
// tone may only touch controls the camera model really has. Nothing is invented.
const { assert, fs, path, test } = require("./_helpers.js");
const os = require("node:os");
const director = require("../earth-studio-director.js");
const lane = require("../earth-studio-lane.js");
const P = director.FIELD_PROVENANCE;
const TOL = director.TIMING_TOLERANCE_S;
const brief = (t, o) => director.buildDirectorialBrief(t, o);
const direct = (t, o) => director.directFromBrief(brief(t, o), o);
const constraint = (r, kind) => r.timing.constraints.find((c) => c.kind === kind);
const allSteps = (j) => j.start_movements.concat(...j.legs.map((l) => l.travel.concat(l.movements)));

test("brief v1: versioned contract with per-field provenance; nothing invented when the text is silent", () => {
  const b = brief("Start in Helsinki, then travel to Stockholm.");
  assert.equal(b.brief_version, "EarthStudioDirectorialBriefV1");
  assert.deepEqual(Object.keys(P).sort(), ["DEFAULTED", "EXPLICIT", "INFERRED", "RESOLVED", "UNRESOLVED"]);
  assert.equal(b.ambiguity_state, "INTENT_RESOLVED");
  assert.deepEqual(b.ordered_subjects.map((s) => s.location), ["Helsinki", "Stockholm"]);
  assert.equal(b.start_geography.name, "Helsinki"); assert.equal(b.end_geography.name, "Stockholm");
  assert.equal(b.runtime_target.seconds, null); assert.equal(b.runtime_target.provenance, P.DEFAULTED);
  assert.equal(b.tone.primary.tone, null); assert.equal(b.tone.primary.provenance, P.DEFAULTED);
  assert.deepEqual(b.narration_cues, []);
  assert.deepEqual(b.prohibited_movement, []);
  assert.equal(b.start_state.provenance, P.DEFAULTED);
  assert.equal(b.parsed_intent.source_text, b.original_text);
});

test("brief v1: provenance distinguishes explicit coordinates from resolved names and aliases", () => {
  const b = brief("Start at NYC, then fly to 60.1699, 24.9384.");
  const nyc = b.locations.find((l) => l.name === "New York");
  const coord = b.locations.find((l) => l.source === "explicit_coordinates");
  assert.equal(nyc.provenance, P.RESOLVED); assert.equal(nyc.source, "gazetteer_alias");
  assert.equal(coord.provenance, P.EXPLICIT);
  assert.deepEqual(b.explicit_coordinates.map((c) => [c.latitude, c.longitude]), [[60.1699, 24.9384]]);
});

test("brief v1: explicit constraints are recorded as EXPLICIT (runtime, prohibited movement, opening)", () => {
  const b = brief("Show Helsinki Cathedral, don't orbit. Approach from the south. 20 seconds total.");
  assert.equal(b.runtime_target.seconds, 20); assert.equal(b.runtime_target.provenance, P.EXPLICIT);
  assert.ok(b.prohibited_movement.length >= 1); assert.equal(b.prohibited_movement[0].provenance, P.EXPLICIT);
  assert.equal(b.start_state.provenance, P.EXPLICIT);
});

test("timing: 'Arrive at 12 seconds to match narration' becomes a structured cue and the plan honors it within tolerance", () => {
  const r = direct("Start in Helsinki, then travel to Stockholm. Arrive at 12 seconds to match narration.");
  const cue = r.brief.narration_cues[0];
  assert.equal(cue.kind, "arrive_at"); assert.equal(cue.seconds, 12); assert.equal(cue.provenance, P.EXPLICIT);
  assert.equal(cue.subject_provenance, P.INFERRED, "no subject named → applies to the destination, and says so");
  assert.equal(r.brief.narration_referenced, true);
  const c = constraint(r, "arrive_at");
  assert.equal(c.subject, "Stockholm"); assert.equal(c.status, "MET");
  assert.ok(Math.abs(c.achieved_seconds - 12) <= TOL, `achieved ${c.achieved_seconds}`);
  // the plan beats carry the retimed durations: opening + travel == arrival
  const beats = r.plan.beats;
  const arrival = beats.slice(0, beats.findIndex((b) => b.subject === "Stockholm")).reduce((a, b) => a + b.duration_seconds, 0);
  assert.ok(Math.abs(arrival - 12) <= TOL, `plan arrival ${arrival}`);
  assert.equal(r.plan.brief_version, "EarthStudioDirectorialBriefV1");
  assert.equal(r.summary.ok, true);
});

test("timing: an arrival cue can name its subject", () => {
  const r = direct("Start in Helsinki, then travel to Stockholm, then on to Copenhagen. Arrive at Stockholm at 9 seconds.");
  const cue = r.brief.narration_cues[0];
  assert.equal(cue.subject, "Stockholm"); assert.equal(cue.subject_provenance, P.RESOLVED);
  const c = constraint(r, "arrive_at");
  assert.equal(c.subject, "Stockholm"); assert.ok(Math.abs(c.achieved_seconds - 9) <= TOL, JSON.stringify(c));
});

test("timing: total runtime is honored by scaling the Director's own durations, steps never below the 1 s model minimum", () => {
  const natural = direct("Fly from Helsinki to Stockholm, then on to Copenhagen.").summary.total_duration_seconds;
  const target = Math.round(natural * 1.5);
  const r = direct(`Fly from Helsinki to Stockholm, then on to Copenhagen. Keep the whole animation to ${target} seconds total.`);
  const c = constraint(r, "total_runtime");
  assert.equal(c.requested_seconds, target); assert.equal(c.status, "MET", JSON.stringify(c));
  assert.ok(Math.abs(r.summary.total_duration_seconds - target) <= TOL);
  assert.ok(allSteps(r.journey).every((s) => s.duration_seconds >= 1));
  assert.equal(r.summary.ok, true);
});

test("timing: hold-until extends the at-location movement to the requested clock", () => {
  const r = direct("Start in Helsinki, then travel to Stockholm and hold there until 25 seconds.");
  const c = constraint(r, "hold_until");
  assert.equal(c.subject, "Stockholm"); assert.equal(c.status, "MET", JSON.stringify(c));
  assert.ok(Math.abs(c.achieved_seconds - 25) <= TOL);
  assert.ok(Math.abs(r.summary.total_duration_seconds - 25) <= TOL);
});

test("timing: an impossible cue is reported UNMET with the reason — never silently claimed", () => {
  const r = direct("Fly from Helsinki to Tokyo. Arrive at 1 second.");
  const c = constraint(r, "arrive_at");
  assert.equal(c.status, "UNMET");
  assert.match(c.limitation, /1s step minimum/);
  assert.ok(r.timing.limitations.length >= 1);
  assert.ok(allSteps(r.journey).every((s) => s.duration_seconds == null || s.duration_seconds >= 1));
  assert.equal(r.summary.ok, true, "the journey stays valid");
  assert.ok(r.plan.brief.limitations.some((l) => /step minimum/.test(l)), "limitation recorded on the plan for provenance");
});

test("tone: bounded vocabulary maps onto pace and dwell only; travel style is never overridden", () => {
  const urgent = direct("Urgently fly from Helsinki to Stockholm.");
  assert.equal(urgent.brief.tone.primary.tone, "urgent"); assert.equal(urgent.journey.pace, "quick");
  assert.ok(urgent.tone.applied.some((a) => a.control === "pace" && a.value === "quick"));
  assert.ok(urgent.tone.applied.some((a) => a.control === "travel_style" && a.value === "unchanged"));
  const calm = direct("Fly from Helsinki to Stockholm in a contemplative way.");
  assert.equal(calm.journey.pace, "calm");
  assert.ok(calm.journey.legs[0].movements.every((m) => m.emphasis > 1), JSON.stringify(calm.journey.legs[0].movements.map((m) => m.emphasis)));
  assert.deepEqual(Object.keys(director.TONE_VOCABULARY).sort(), ["calm", "contemplative", "dramatic", "energetic", "relaxed", "restrained", "tense", "urgent"]);
});

test("tone: a relaxed conclusion slows the final stop relative to the opening", () => {
  const r = direct("Start in Helsinki, then travel to Stockholm, with a relaxed conclusion.");
  assert.deepEqual(r.brief.tone.progression.map((p) => [p.position, p.tone]), [["conclusion", "relaxed"]]);
  const last = r.journey.legs[r.journey.legs.length - 1].movements[0].emphasis;
  const first = r.journey.start_movements.length ? (r.journey.start_movements[0].emphasis || 1) : 1;
  assert.ok(last >= 1.35 && last > first, `last ${last} vs first ${first}`);
});

test("tone: explicit pacing words win over the pace a tone implies, and the conflict is recorded", () => {
  const r = direct("Travel quickly from Helsinki to Stockholm in a contemplative mood.");
  assert.equal(r.journey.pace, "quick");
  assert.equal(r.brief.pace.provenance, P.EXPLICIT);
  assert.ok(r.tone.limitations.some((l) => /explicit pacing "quick" wins/.test(l)), JSON.stringify(r.tone.limitations));
});

test("tone: a tone outside the camera vocabulary is recorded as UNRESOLVED with a limitation, not pretended", () => {
  const r = direct("Show Helsinki, make it melancholic.");
  assert.equal(r.brief.tone.primary.tone, null); assert.equal(r.brief.tone.primary.provenance, P.UNRESOLVED);
  assert.deepEqual(r.brief.tone.unsupported_terms, ["melancholic"]);
  assert.ok(r.plan.brief.limitations.some((l) => /melancholic/.test(l)));
  assert.ok(r.tone.applied.length === 0);
});

test("brief path keeps the hard gate: ambiguous geography never reaches the Director", () => {
  const b = brief("Show Finland and Sweden, then orbit the capital.");
  assert.equal(b.ambiguity_state, "INTENT_AMBIGUOUS");
  assert.throws(() => director.directFromBrief(b), (e) => e.code === "INTENT_AMBIGUOUS" && e.intent.ambiguous.length === 1);
});

test("brief provenance rides into the lane's direction.json and generation stays PASS_FOR_HUMAN_REVIEW", () => {
  const r = direct("Start in Helsinki, then travel to Stockholm. Arrive at 12 seconds to match narration, with a relaxed conclusion.");
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "es-brief-"));
  const out = lane.writeJob(pkg, { jobName: "brief", journey: r.journey, direction: { plan: r.plan, intent: r.brief.intent } }, { now: "2026-09-07T00:00:00.000Z" });
  assert.equal(out.ok, true); assert.equal(out.camera_quality.verdict, "PASS_FOR_HUMAN_REVIEW");
  const d = JSON.parse(fs.readFileSync(path.join(pkg, "earth-studio", "direction.json"), "utf8"));
  assert.equal(d.plan.brief_version, "EarthStudioDirectorialBriefV1");
  assert.equal(d.plan.timing.constraints[0].status, "MET");
  assert.ok(Math.abs(out.total_duration_seconds - r.summary.total_duration_seconds) < 0.05, "the generated length is the retimed length");
});

test("timing: an arrival cue and a total runtime coexist — the tail absorbs the total and the arrival stays met", () => {
  const r = direct("Start in Helsinki, then travel to Stockholm. Arrive at 12 seconds to match narration. Keep the whole animation to 30 seconds total.");
  const a = constraint(r, "arrive_at"), t = constraint(r, "total_runtime");
  assert.equal(a.status, "MET", JSON.stringify(a)); assert.ok(Math.abs(a.achieved_seconds - 12) <= TOL);
  assert.equal(t.status, "MET", JSON.stringify(t)); assert.ok(Math.abs(r.summary.total_duration_seconds - 30) <= TOL);
  assert.equal(t.locked_by_earlier_constraints_seconds, 12);
  assert.deepEqual(r.timing.conflicts, []);
});

test("timing: when constraints truly conflict, the report says so — the arrival is kept and the total is honestly not met", () => {
  const r = direct("Start in Helsinki, then travel to Stockholm. Arrive at 12 seconds. Keep the whole animation to 12 seconds total.");
  const a = constraint(r, "arrive_at"), t = constraint(r, "total_runtime");
  assert.equal(a.status, "MET", JSON.stringify(a));
  assert.notEqual(t.status, "MET", JSON.stringify(t));
  assert.ok(r.timing.conflicts.length >= 1, JSON.stringify(r.timing));
  assert.match(r.timing.conflicts[0], /conflict/);
  assert.ok(r.plan.brief.limitations.some((l) => /conflict/.test(l)));
});
