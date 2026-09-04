// Tests for the Earth Studio MAP CINEMATOGRAPHY / DIRECTORIAL layer.
//
// These test camera SEMANTICS, not values: whether the Director picks a movement
// because it communicates something. The journey model and planner already have
// their own suites for geometry, framing and serialization.
//
// Everything here must be deterministic — same structured intent, same direction.
const { assert, fs, path, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");
const journey = require("../earth-studio-journey.js");
const director = require("../earth-studio-director.js");
const terrainMorphology = require("../earth-studio-terrain-morphology.js");

const at = (over) => director.recommend({ slot: "at", ...over });
const keysOf = (r) => [r.recommended && r.recommended.key].concat(r.alternatives.map((a) => a.key)).filter(Boolean);
const rejectedKeys = (r) => r.rejected.map((x) => x.key);
const decisionsOf = (r, kind) => r.decisions.filter((d) => d.kind === kind);
const labelAt = (r, place) => {
  const d = r.decisions.find((x) => x.kind === "at" && x.place === place);
  return d ? d.decision.key : null;
};

// ── Vocabulary integrity ───────────────────────────────────────────────────

test("director: every camera-grammar entry maps to something the generator really produces", () => {
  const movements = new Set(Object.keys(journey.MOVEMENTS));
  const templates = new Set(Object.keys(require("../earth-studio-native-template-profiles.js").TEMPLATE_KEYS));
  const styles = new Set(Object.keys(journey.TRAVEL_STYLES));
  Object.values(director.CAMERA_GRAMMAR).forEach((g) => {
    assert.ok(g.label && g.teaching, `${g.key} needs a label and teaching text`);
    assert.ok(director.SHOT_PURPOSES[g.primary_purpose], `${g.key} primary_purpose`);
    (g.secondary_purposes || []).forEach((p) => assert.ok(director.SHOT_PURPOSES[p], `${g.key} secondary ${p}`));
    assert.ok(director.RARITY[g.rarity], `${g.key} rarity`);
    assert.ok(Array.isArray(g.communicates) && g.communicates.length, `${g.key} must say what it communicates`);
    assert.ok(Array.isArray(g.good_for) && g.good_for.length, `${g.key} good_for`);
    assert.ok(Array.isArray(g.usually_avoid_when) && g.usually_avoid_when.length, `${g.key} usually_avoid_when`);
    if (g.kind === "at" || g.kind === "travel") assert.ok(movements.has(g.movement), `${g.key} -> unknown movement ${g.movement}`);
    if (g.kind === "template") assert.ok(templates.has(g.template), `${g.key} -> unknown template ${g.template}`);
    if (g.kind === "travel_style") {
      assert.ok(styles.has(g.style), `${g.key} -> unknown travel style ${g.style}`);
      g.steps.forEach((k) => assert.ok(movements.has(k), `${g.key} step ${k} is not a movement`));
    }
  });
  // no invented capability: every role's default purposes exist
  Object.values(director.LOCATION_ROLES).forEach((r) => {
    assert.ok(director.IMPORTANCE[r.importance], `${r.key} importance`);
    r.purposes.forEach((p) => assert.ok(director.SHOT_PURPOSES[p], `${r.key} purpose ${p}`));
  });
});

test("director: every shot purpose declares what the viewer should understand", () => {
  Object.values(director.SHOT_PURPOSES).forEach((p) => {
    assert.ok(p.viewer_should_understand && p.viewer_should_understand.length > 10, `${p.key} needs viewer_should_understand`);
    assert.ok(["top_down", "oblique", "either"].includes(p.angle), `${p.key} angle`);
    assert.ok(["low", "moderate", "high"].includes(p.motion), `${p.key} motion`);
  });
});

// ── Camera semantics (the §25 list) ────────────────────────────────────────

test("semantics: a regional city-to-city trip does NOT use the globe", () => {
  const r = director.autoDirect({ stops: [
    { location: "Helsinki", role: "STARTING_CONTEXT" },
    { location: "Stockholm", role: "DESTINATION", importance: "HIGH" }] });
  assert.equal(r.globe.allowed, false);
  assert.match(r.globe.reason, /without adding useful information|distance alone/i);
  assert.ok(!r.decisions.some((d) => d.decision.key === "globe_view"), "no globe shot may appear");
  assert.ok(!r.journey.legs.some((l) => l.destination.framing === "globe"), "no leg may be framed at globe scale");
});

test("semantics: long distance alone is NOT a reason for the globe", () => {
  // Helsinki -> Tokyo is 7,800 km. Still no globe without a declared reason.
  const far = director.globeDecision({ journey_span_m: 7818000 });
  assert.equal(far.allowed, false);
  assert.match(far.reason, /distance alone is not a reason/i);
  // ...and the same distance WITH a global reason is allowed.
  const justified = director.globeDecision({ journey_span_m: 7818000, globe_justification: "INTERCONTINENTAL_SCALE" });
  assert.equal(justified.allowed, true);
  // ...but that reason cannot be applied to a journey too small to read.
  const tooSmall = director.globeDecision({ journey_span_m: 396000, globe_justification: "INTERCONTINENTAL_SCALE" });
  assert.equal(tooSmall.allowed, false);
  assert.match(tooSmall.reason, /not an intercontinental distance/i);
});

test("semantics: a global-network story CAN use the globe", () => {
  const r = director.autoDirect({ stops: [
    { location: "Shanghai", role: "ROUTE_POINT" },
    { location: "Amsterdam", role: "ROUTE_POINT" },
    { location: "Los Angeles", role: "DESTINATION" }], globe_justification: "GLOBAL_NETWORK" });
  assert.equal(r.globe.allowed, true);
  assert.equal(r.globe.justification, "GLOBAL_NETWORK");
  assert.ok(r.decisions.some((d) => d.decision.key === "globe_view"), "a globe shot should appear");
  assert.ok(journey.validateJourney(r.journey).ok, "the directed journey must compile");
});

test("semantics: a continent-scale target does NOT mean the whole globe", () => {
  const r = at({ role: "GEOGRAPHIC_CONTEXT", purposes: ["SHOW_SCALE"], scale: "continent", place: "Europe" });
  assert.notEqual(r.recommended.key, "globe_view");
  assert.ok(rejectedKeys(r).includes("globe_view"), "the globe must be explicitly rejected, with a reason");
  const why = r.rejected.find((x) => x.key === "globe_view").reason;
  assert.match(why, /genuinely global reason/i);
  // continent framing itself stays available through the journey model
  assert.ok(journey.SCALE_LADDER.includes("continent"));
});

test("semantics: a low-importance route waypoint does NOT default to an orbit", () => {
  const r = at({ role: "ROUTE_POINT", scale: "city", place: "Stockholm" });
  assert.ok(!/orbit|spiral/i.test(r.recommended.key), `waypoint got ${r.recommended.key}`);
  // and across a whole route, no stop gets a flourish
  const route = director.autoDirect({ stops: ["Helsinki", "Stockholm", "Copenhagen", "Berlin"]
    .map((l) => ({ location: l, role: "ROUTE_POINT" })) });
  decisionsOf(route, "at").forEach((d) => {
    assert.ok(!/orbit|spiral/i.test(d.decision.key), `${d.place} got ${d.decision.key} on a plain route`);
  });
});

test("semantics: a landmark that is the primary subject CAN be orbited", () => {
  const r = at({ role: "PRIMARY_SUBJECT", purposes: ["INSPECT"], scale: "landmark", place: "Senate Square" });
  assert.ok(/orbit/i.test(r.recommended.key), `expected an orbit, got ${r.recommended.key}`);
  assert.equal(r.recommended.purpose, "INSPECT");
  assert.match(r.recommended.why, /INSPECT|landmark/);
});

test("semantics: a hero landmark reveal MAY be given a spiral; an ordinary one may not", () => {
  const hero = at({ role: "FINAL_REVEAL", importance: "HERO", purposes: ["REVEAL"], scale: "landmark", place: "Eiffel Tower" });
  assert.ok(/spiral/i.test(hero.recommended.key), `hero reveal got ${hero.recommended.key}`);
  const ordinary = at({ role: "WAYPOINT", purposes: ["ESTABLISH"], scale: "landmark", place: "Big Ben" });
  assert.ok(!/spiral/i.test(ordinary.recommended.key), `waypoint got ${ordinary.recommended.key}`);
  // a spiral is never offered for geography
  const country = at({ role: "FINAL_REVEAL", importance: "HERO", purposes: ["REVEAL"], scale: "country", place: "Finland" });
  assert.ok(!/spiral/i.test(country.recommended.key), `country got ${country.recommended.key}`);
  assert.ok(rejectedKeys(country).some((k) => /spiral/.test(k)), "spiral should be disqualified for a country");
});

test("semantics: SHOW_ROUTE prefers top-down clarity, SHOW_TERRAIN prefers oblique", () => {
  const route = director.recommend({ slot: "travel", purposes: ["SHOW_ROUTE"], scale: "region", role: "ROUTE_POINT" });
  const routeAngle = director.CAMERA_GRAMMAR[route.recommended.key].angle;
  assert.equal(routeAngle, "top_down", `route travel chose ${route.recommended.key} (${routeAngle})`);

  const terrain = director.autoDirect({ stops: [
    { location: "Zurich", role: "STARTING_CONTEXT" },
    { location: "The Alps", role: "PRIMARY_SUBJECT", importance: "HIGH", purposes: ["SHOW_TERRAIN"] }] });
  const leg = decisionsOf(terrain, "travel")[0];
  assert.equal(leg.decision.key, "style:low_approach", `terrain leg chose ${leg.decision.key}`);
  assert.equal(director.CAMERA_GRAMMAR[leg.decision.key].angle, "oblique");
});

test("semantics: a primary destination receives more emphasis than a waypoint", () => {
  const strong = at({ role: "PRIMARY_SUBJECT", importance: "HIGH", purposes: ["INSPECT"], scale: "city", place: "Stockholm" });
  const weak = at({ role: "WAYPOINT", importance: "LOW", purposes: ["ESTABLISH"], scale: "city", place: "Stockholm" });
  assert.ok(strong.recommended.emphasis > weak.recommended.emphasis,
    `emphasis ${strong.recommended.emphasis} vs ${weak.recommended.emphasis}`);
  // and it shows up as real screen time through the journey model
  const dur = (dec) => journey.compileJourney(journey.normalizeJourney({
    start: { location: "Stockholm" },
    start_movements: [{ type: dec.movement, emphasis: dec.emphasis }] })).steps[0].duration_seconds;
  assert.ok(dur(strong.recommended) > dur(weak.recommended),
    `${dur(strong.recommended)}s vs ${dur(weak.recommended)}s`);
});

test("semantics: restraint prevents a flourish at every stop of a multi-stop route", () => {
  const r = director.autoDirect({ stops: [
    { location: "Helsinki", role: "ROUTE_POINT" },
    { location: "Stockholm", role: "ROUTE_POINT" },
    { location: "Copenhagen", role: "ROUTE_POINT" },
    { location: "Berlin", role: "PRIMARY_SUBJECT", importance: "HIGH" }] });
  // "A flourish at every stop" is about ceremony, not about functional moves: a
  // climb that exists so the ground stays legible is required on every long leg
  // and is marked functional, so it is excluded here.
  const ceremony = r.decisions.filter((d) => {
    const g = director.CAMERA_GRAMMAR[d.decision.key] || {};
    return director.RARITY[d.decision.rarity].budget > 0 && !g.functional;
  });
  assert.ok(ceremony.length <= 2, `too much ceremony: ${ceremony.map((f) => f.decision.label).join(", ")}`);
  // and specifically: a shaped (ceremonial) arrival must not appear on every leg
  const shapedLegs = r.decisions.filter((d) => d.kind === "travel" && d.decision.key === "style:cinematic");
  assert.ok(shapedLegs.length <= 1, `shaped arrivals on ${shapedLegs.length} legs`);
  // the one place that matters is the one that gets it
  assert.ok(/orbit/i.test(labelAt(r, "Berlin")), `Berlin got ${labelAt(r, "Berlin")}`);
  ["Helsinki", "Stockholm", "Copenhagen"].forEach((p) => {
    assert.ok(!/orbit|spiral/i.test(labelAt(r, p)), `${p} got ${labelAt(r, p)}`);
  });
});

test("semantics: repetition is penalised — the same move twice in a row is discouraged", () => {
  const base = { slot: "at", role: "PRIMARY_SUBJECT", importance: "HIGH", purposes: ["INSPECT"], scale: "landmark", place: "Big Ben" };
  const fresh = director.recommend(base);
  const repeated = director.recommend({
    ...base,
    previous: { key: fresh.recommended.key, grammar: director.CAMERA_GRAMMAR[fresh.recommended.key] },
    used_counts: { [fresh.recommended.key]: 1 },
  });
  assert.notEqual(repeated.recommended.key, fresh.recommended.key,
    `${fresh.recommended.key} was recommended again immediately after itself`);
  // two spirals already spent -> a third is strongly discouraged
  const thirdSpiral = director.recommend({
    slot: "at", role: "FINAL_REVEAL", importance: "HERO", purposes: ["REVEAL"], scale: "landmark",
    used_counts: { spiral_in: 2 }, spectacle_spent: 2,
  });
  assert.ok(!/spiral_in/.test(thirdSpiral.recommended.key), `third spiral was recommended: ${thirdSpiral.recommended.key}`);
});

test("semantics: a hold is chosen for comprehension, not as filler", () => {
  const g = director.CAMERA_GRAMMAR.hold;
  assert.equal(g.primary_purpose, "ESTABLISH");
  assert.match(g.teaching, /understand/i);
  assert.ok(g.usually_avoid_when.some((x) => /reflexively|every single/i.test(x)),
    "the grammar must warn against a hold after every movement");
  // a just-established context location gets a hold rather than a move
  const r = at({ role: "GEOGRAPHIC_CONTEXT", purposes: ["ORIENT"], scale: "country", place: "Finland" });
  assert.ok(["hold", "zoom_out", "reveal"].includes(r.recommended.key), `got ${r.recommended.key}`);
  assert.equal(director.CAMERA_GRAMMAR[r.recommended.key].angle, "top_down");
});

test("semantics: zoom-to means context->subject and pull-back means subject->context", () => {
  assert.equal(director.CAMERA_GRAMMAR["template:zoom-to"].primary_purpose, "LOCATE");
  assert.ok(director.CAMERA_GRAMMAR["template:zoom-to"].communicates.some((c) => /context becoming subject/i.test(c)));
  assert.equal(director.CAMERA_GRAMMAR.zoom_out.primary_purpose, "SHOW_SCALE");
  assert.ok(director.CAMERA_GRAMMAR.zoom_out.communicates.some((c) => /part of something larger/i.test(c)));
  // a scale ladder widens step by step and never reaches the planet unasked
  const r = director.autoDirect({ stops: [
    { location: "Senate Square", role: "PRIMARY_SUBJECT", importance: "HIGH" },
    { location: "Helsinki", role: "SCALE_REFERENCE", purposes: ["SHOW_SCALE"] },
    { location: "Finland", role: "SCALE_REFERENCE", purposes: ["SHOW_SCALE"] },
    { location: "Europe", role: "GEOGRAPHIC_CONTEXT", purposes: ["SHOW_SCALE"] }] });
  assert.equal(r.globe.allowed, false);
  ["Helsinki", "Finland", "Europe"].forEach((p) => {
    assert.ok(["zoom_out", "reveal", "hold"].includes(labelAt(r, p)), `${p} got ${labelAt(r, p)}`);
  });
});

test("semantics: point-to-point is for relationship, not for inspecting either end", () => {
  const g = director.CAMERA_GRAMMAR["template:point-to-point"];
  assert.equal(g.primary_purpose, "SHOW_ROUTE");
  assert.ok(g.good_for.some((x) => /route|journey|migration/i.test(x)));
  assert.ok(g.usually_avoid_when.some((x) => /subject and needs inspecting/i.test(x)));
});

test("semantics: fly-to-and-orbit correlates with destination importance", () => {
  const g = director.CAMERA_GRAMMAR["template:fly-to-and-orbit"];
  assert.equal(g.primary_purpose, "ARRIVE");
  assert.equal(g.rarity, "SELECTIVE");
  assert.ok(g.usually_avoid_when.some((x) => /every waypoint|incidental/i.test(x)));
  // an important destination shapes its arrival; a waypoint does not
  const important = director.autoDirect({ stops: [
    { location: "Helsinki" }, { location: "Stockholm", role: "PRIMARY_SUBJECT", importance: "HIGH" }] });
  const casual = director.autoDirect({ stops: [
    { location: "Helsinki" }, { location: "Stockholm", role: "WAYPOINT", importance: "LOW" }] });
  // An important destination gets a SHAPED (ceremonial) arrival; a casual one gets
  // only the functional climb legibility requires. (A 396 km leg can no longer be
  // flown at destination framing at all — it would be illegible — so the
  // distinction is "shaped vs not shaped", not "shaped vs direct".)
  assert.equal(decisionsOf(important, "travel")[0].decision.key, "style:cinematic");
  const casualKey = decisionsOf(casual, "travel")[0].decision.key;
  assert.notEqual(casualKey, "style:cinematic", `a low-importance waypoint got a shaped arrival (${casualKey})`);
  assert.ok((director.CAMERA_GRAMMAR[casualKey] || {}).functional || casualKey === "style:direct",
    `a casual leg should be functional travel, got ${casualKey}`);
});

// ── Explainability, determinism, contextual (not formulaic) direction ───────

test("director: every recommendation explains itself", () => {
  const cases = [
    { role: "PRIMARY_SUBJECT", purposes: ["INSPECT"], scale: "landmark" },
    { role: "ROUTE_POINT", scale: "city" },
    { role: "GEOGRAPHIC_CONTEXT", purposes: ["SHOW_SCALE"], scale: "country" },
    { role: "FINAL_REVEAL", importance: "HERO", purposes: ["REVEAL"], scale: "landmark" },
  ];
  cases.forEach((c) => {
    const r = at(c);
    assert.ok(r.recommended, `no recommendation for ${JSON.stringify(c)}`);
    assert.ok(r.recommended.why && r.recommended.why.length > 15, "the reason must be a real sentence");
    assert.ok(r.recommended.components.length, "the score must be inspectable");
    assert.ok(r.recommended.viewer_should_understand, "it must say what the viewer should understand");
    assert.ok(r.recommended.teaching, "it must carry teaching text for the GUI");
    r.rejected.forEach((x) => assert.ok(x.reason && x.reason.length > 15, `${x.key} rejection needs a reason`));
  });
});

test("director: identical structured intent produces identical direction (deterministic)", () => {
  const intent = { stops: [
    { location: "Helsinki", role: "STARTING_CONTEXT" },
    { location: "Stockholm", role: "PRIMARY_SUBJECT", importance: "HIGH" },
    { location: "Copenhagen", role: "WAYPOINT" }] };
  const a = director.autoDirect(intent);
  const b = director.autoDirect(JSON.parse(JSON.stringify(intent)));
  const sig = (r) => r.decisions.map((d) => `${d.kind}:${d.place || d.to}:${d.decision.key}:${d.decision.emphasis}`).join("|");
  assert.equal(sig(a), sig(b));
  // ...and so does the journey it produces
  assert.equal(journey.compileJourney(a.journey).description, journey.compileJourney(b.journey).description);
});

test("director: the same geography directed with different intent gives different direction", () => {
  // Story A: the ferry route. Geography is the point.
  const routeStory = director.autoDirect({ stops: [
    { location: "Helsinki", role: "ROUTE_POINT" },
    { location: "Stockholm", role: "ROUTE_POINT", purposes: ["SHOW_ROUTE"] }] });
  // Story B: Stockholm is the hero city.
  const heroStory = director.autoDirect({ stops: [
    { location: "Helsinki", role: "STARTING_CONTEXT" },
    { location: "Stockholm", role: "PRIMARY_SUBJECT", importance: "HIGH", purposes: ["ARRIVE", "INSPECT"] }] });
  assert.notEqual(labelAt(routeStory, "Stockholm"), labelAt(heroStory, "Stockholm"));
  assert.ok(!/orbit/i.test(labelAt(routeStory, "Stockholm")), "the route story must not inspect Stockholm");
  assert.ok(/orbit/i.test(labelAt(heroStory, "Stockholm")), "the hero story must inspect Stockholm");
  const routeDur = journey.summarizeJourney(routeStory.journey).total_duration_seconds;
  const heroDur = journey.summarizeJourney(heroStory.journey).total_duration_seconds;
  assert.ok(heroDur > routeDur, `hero ${heroDur}s should dwell longer than route ${routeDur}s`);
});

test("director: there is no single hard-coded 'good video' formula", () => {
  // Four different intents over overlapping geography must not collapse to one shape.
  const shapes = [
    director.autoDirect({ stops: [{ location: "Helsinki", role: "ROUTE_POINT" }, { location: "Stockholm", role: "ROUTE_POINT" }] }),
    director.autoDirect({ stops: [{ location: "Helsinki" }, { location: "Stockholm", role: "PRIMARY_SUBJECT", importance: "HIGH" }] }),
    director.autoDirect({ stops: [{ location: "Senate Square", role: "PRIMARY_SUBJECT", importance: "HIGH" }, { location: "Helsinki", role: "SCALE_REFERENCE", purposes: ["SHOW_SCALE"] }] }),
    director.autoDirect({ stops: [{ location: "Zurich" }, { location: "Matterhorn", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] }),
  ].map((r) => r.decisions.map((d) => {
    // the signature is the DIRECTION, not just the move names: the same move at a
    // different angle or dwell is a different directorial decision
    const t = d.decision.tilt_deg != null ? `@${d.decision.tilt_deg}` : "";
    return `${d.decision.key}${t}x${d.decision.emphasis}`;
  }).join(">"));
  assert.equal(new Set(shapes).size, shapes.length, `direction collapsed to a formula: ${JSON.stringify(shapes)}`);
});

// ── Intent parsing (structured extraction only, no LLM) ────────────────────

test("director: free text is reduced to structured intent deterministically", () => {
  const text = [
    "Start in Helsinki.",
    "Show where Stockholm is relative to Helsinki.",
    "Stockholm is the main destination.",
    "Then continue to Copenhagen as a secondary waypoint.",
  ].join("\n");
  const a = director.parseIntent(text);
  const b = director.parseIntent(text);
  assert.deepEqual(a, b, "parsing must be deterministic");
  assert.deepEqual(a.stops.map((s) => s.location), ["Helsinki", "Stockholm", "Copenhagen"]);
  const stockholm = a.stops.find((s) => s.location === "Stockholm");
  assert.equal(stockholm.role, "PRIMARY_SUBJECT");
  assert.equal(stockholm.importance, "HIGH");
  const copenhagen = a.stops.find((s) => s.location === "Copenhagen");
  assert.equal(copenhagen.role, "WAYPOINT");
  assert.equal(a.globe_justification, null, "no global reason was stated");
  // it only ever names places the planner actually knows
  a.stops.forEach((s) => assert.ok(planner.resolveLocation(s.location), `${s.location} must resolve`));
  // and the parsed intent directs into a compiling journey
  const r = director.autoDirect(a);
  assert.ok(journey.validateJourney(r.journey).ok, journey.validateJourney(r.journey).errors.join("; "));
});

test("director: a global story in free text is detected; a regional one is not", () => {
  assert.equal(director.parseIntent("Show how a global shipping network connects Shanghai, Amsterdam and Los Angeles.").globe_justification, "GLOBAL_NETWORK");
  assert.equal(director.parseIntent("The disease spread globally from Shanghai.").globe_justification, "WORLDWIDE_PHENOMENON");
  assert.equal(director.parseIntent("Three continents are involved: Shanghai, Amsterdam, Los Angeles.").globe_justification, "INTERCONTINENTAL_SCALE");
  assert.equal(director.parseIntent("Travel from Helsinki to Stockholm by ferry.").globe_justification, null);
  assert.equal(director.parseIntent("It is a very long way from Helsinki to Tokyo.").globe_justification, null,
    "distance language must NOT be read as a global reason");
});

// ── The directed journey must remain a valid journey ───────────────────────

test("director: directed journeys compile through the proven generator unchanged", () => {
  const intents = [
    { stops: [{ location: "Senate Square", role: "PRIMARY_SUBJECT", importance: "HIGH", purposes: ["INSPECT"] }] },
    { stops: [{ location: "Helsinki" }, { location: "Stockholm", role: "PRIMARY_SUBJECT", importance: "HIGH" }] },
    { stops: ["Helsinki", "Stockholm", "Copenhagen", "Berlin"].map((l) => ({ location: l, role: "ROUTE_POINT" })) },
    { stops: [{ location: "Paris", role: "GEOGRAPHIC_CONTEXT", purposes: ["LOCATE"] }, { location: "Eiffel Tower", role: "FINAL_REVEAL", importance: "HERO", purposes: ["REVEAL"] }] },
    { stops: [{ location: "Shanghai", role: "ROUTE_POINT" }, { location: "Amsterdam", role: "ROUTE_POINT" }, { location: "Los Angeles", role: "DESTINATION" }], globe_justification: "GLOBAL_NETWORK" },
  ];
  intents.forEach((intent) => {
    const r = director.autoDirect(intent);
    const check = journey.validateJourney(r.journey);
    assert.ok(check.ok, `${JSON.stringify(intent.stops)}: ${check.errors.join("; ")}`);
    const compiled = check.compiled;
    // the compile is still round-trip verified against the real planner grammar
    const v = journey.verifyCompilation(compiled);
    assert.ok(v.ok, v.problems.join(" | "));
    // every movement is one of the five proven primitives
    compiled.steps.forEach((s) => assert.ok(["fly_to", "hover", "orbit", "zoom_in", "zoom_out"].includes(s.action)));
    // and it produces a real plan
    const plan = planner.buildShotPlan("director", compiled.description, "2026-08-19T12:00:00.000Z", { aspect: "16:9" });
    assert.equal(plan.unresolved_items.length, 0);
    assert.ok(plan.total_frames > 0);
  });
});

test("director: an explanation is available for the whole sequence", () => {
  const r = director.autoDirect({ stops: [
    { location: "Helsinki", role: "STARTING_CONTEXT" },
    { location: "Stockholm", role: "PRIMARY_SUBJECT", importance: "HIGH" }] });
  const lines = director.explainDirection(r);
  assert.ok(lines.length >= 4);
  assert.ok(lines.some((l) => /Helsinki/.test(l)));
  assert.ok(lines.some((l) => /Stockholm/.test(l)));
  assert.ok(lines.some((l) => /globe/i.test(l)), "the globe decision must always be stated");
  assert.ok(lines.some((l) => /Flourish budget/.test(l)), "the restraint budget must be stated");
});

// ── Pinned directorial expectations (canary fixtures) ──────────────────────
// The director acceptance canaries record the decision the Director made for
// each story. If the Director starts making obviously inappropriate choices —
// orbiting a route point, spiralling a country, reaching for the planet on a
// regional trip — these fail loudly instead of quietly producing worse videos.

const CANARY_GATE = path.join(__dirname, "..", "package-runs", "2026-08-19-earth-studio-director-acceptance");

function expectedDecisions() {
  const p = path.join(CANARY_GATE, "expected-decisions.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

test("director canaries: the pinned directorial decisions still reproduce exactly", () => {
  const expected = expectedDecisions();
  if (!expected) { assert.ok(true, "canary fixtures not generated in this checkout — skipped"); return; }
  const { CANARIES } = require("../scripts/earth-studio-director-canaries.js");
  assert.equal(CANARIES.length, Object.keys(expected).length, "every canary must be pinned");
  CANARIES.forEach((c) => {
    const want = expected[c.id];
    assert.ok(want, `${c.id} has no pinned expectation`);
    const r = director.autoDirect({ ...c.intent, aspect: c.aspect });
    assert.equal(r.globe.allowed, want.globe_allowed, `${c.id}: globe decision drifted`);
    assert.equal(r.globe.justification || null, want.globe_justification, `${c.id}: globe justification drifted`);
    const got = r.decisions.map((d) => ({
      kind: d.kind, at: d.place || `${d.from}->${d.to}`, movement: d.decision.key,
      purpose: d.decision.purpose, rarity: d.decision.rarity,
    }));
    assert.deepEqual(got, want.decisions, `${c.id}: directorial decisions drifted`);
  });
});

test("director canaries: each canary's stated directorial expectation actually holds", () => {
  const { CANARIES } = require("../scripts/earth-studio-director-canaries.js");
  const byId = {};
  CANARIES.forEach((c) => { byId[c.id] = director.autoDirect({ ...c.intent, aspect: c.aspect }); });
  const move = (id, place) => {
    const d = byId[id].decisions.find((x) => x.kind === "at" && x.place === place);
    return d ? d.decision.key : null;
  };
  const leg = (id, i) => byId[id].decisions.filter((x) => x.kind === "travel")[i].decision.key;

  // A: a landmark primary subject is inspected, and nothing more
  assert.ok(/orbit/i.test(move("DIRECTOR-A-landmark-subject", "Senate Square")));
  assert.ok(!/spiral/i.test(move("DIRECTOR-A-landmark-subject", "Senate Square")), "not a hero, so no spiral");
  assert.equal(byId["DIRECTOR-A-landmark-subject"].globe.allowed, false);

  // B: the arrival is shaped and the destination is inspected
  assert.equal(leg("DIRECTOR-B-city-to-city-hero", 0), "style:cinematic");
  assert.ok(/orbit/i.test(move("DIRECTOR-B-city-to-city-hero", "Stockholm")));
  assert.ok(!/orbit|spiral/i.test(move("DIRECTOR-B-city-to-city-hero", "Helsinki")), "the opening must not perform");

  // B2: same geography, route intent -> different direction, and cheaper.
  // The leg must not be CEREMONIAL. It still climbs, because a 396 km crossing
  // flown at city framing is illegible — that climb is functional, not flourish.
  assert.ok(!/orbit|spiral/i.test(move("DIRECTOR-B2-same-geography-route-story", "Stockholm")));
  const b2Leg = leg("DIRECTOR-B2-same-geography-route-story", 0);
  assert.notEqual(b2Leg, "style:cinematic", `the route story got a shaped arrival (${b2Leg})`);
  assert.ok((director.CAMERA_GRAMMAR[b2Leg] || {}).functional || b2Leg === "style:direct",
    `the route story should travel functionally, got ${b2Leg}`);
  const bDur = journey.summarizeJourney(byId["DIRECTOR-B-city-to-city-hero"].journey).total_duration_seconds;
  const b2Dur = journey.summarizeJourney(byId["DIRECTOR-B2-same-geography-route-story"].journey).total_duration_seconds;
  assert.ok(bDur > b2Dur * 1.5, `hero ${bDur}s should dwell substantially longer than route ${b2Dur}s`);

  // D: a scale ladder widens and stops short of the planet
  assert.equal(byId["DIRECTOR-D-scale-reveal"].globe.allowed, false);
  ["Helsinki", "Finland", "Europe"].forEach((p) => {
    assert.ok(["zoom_out", "reveal", "hold"].includes(move("DIRECTOR-D-scale-reveal", p)), `${p} got ${move("DIRECTOR-D-scale-reveal", p)}`);
  });

  // ROUTE: restraint — only the one place that matters gets a flourish
  ["Helsinki", "Stockholm", "Copenhagen"].forEach((p) => {
    assert.ok(!/orbit|spiral/i.test(move("DIRECTOR-ROUTE-restraint", p)), `${p} got ${move("DIRECTOR-ROUTE-restraint", p)}`);
  });
  assert.ok(/orbit/i.test(move("DIRECTOR-ROUTE-restraint", "Berlin")));

  // HERO: the tower is the endpoint the camera travelled to, so it is CIRCLED.
  // A hero reveal earns a bigger circle than an ordinary inspection, not a spiral.
  const towerMove = move("DIRECTOR-HERO-landmark-reveal", "Eiffel Tower");
  assert.ok(/orbit/i.test(towerMove), `the tower got ${towerMove}`);
  assert.ok(!/spiral/i.test(towerMove), "an arrival must never be spiralled");
  assert.ok(!/spiral|orbit/i.test(move("DIRECTOR-HERO-landmark-reveal", "Paris")),
    "the locating shot must not perform");

  // GLOBAL: the planet, justified
  assert.equal(byId["DIRECTOR-GLOBAL-network"].globe.allowed, true);
  assert.equal(byId["DIRECTOR-GLOBAL-network"].globe.justification, "GLOBAL_NETWORK");
  assert.ok(byId["DIRECTOR-GLOBAL-network"].decisions.some((d) => d.decision.key === "globe_view"));

  // TERRAIN: the oblique terrain work happens where the terrain is. A 170 km
  // crossing cannot be flown low (it would be illegible), so the approach travels
  // legibly and the mountain itself is treated obliquely.
  const terrainLeg = leg("DIRECTOR-TERRAIN-mountain", 0);
  assert.notEqual(terrainLeg, "style:low_approach", "a 170 km leg must not be flown low");
  const terrainSteps = journey.compileJourney(byId["DIRECTOR-TERRAIN-mountain"].journey).steps;
  terrainSteps.filter((x) => x.action === "fly_to" && x.distance_m > 1000).forEach((x) => {
    assert.ok(x.screen_speed_frame_widths_per_second <= journey.READABLE_SCREEN_SPEED_FW_PER_S,
      `terrain approach illegible at ${x.screen_speed_frame_widths_per_second} fw/s`);
  });
  const atMountain = terrainSteps[terrainSteps.length - 1];
  assert.ok(atMountain.tilt_deg >= 45, `the mountain must be viewed obliquely, got tilt ${atMountain.tilt_deg}`);
  assert.equal(atMountain.action, "orbit");
  // Low Approach is still the right move on a genuinely short run-in
  const shortRunIn = director.autoDirect({ stops: [
    { location: "Senate Square" },
    { location: "Helsinki Cathedral", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] });
  assert.equal(shortRunIn.decisions.find((d) => d.kind === "travel").decision.key, "style:low_approach");

  // exactly one canary may use a spiral, and exactly one may use the globe
  // No canary spirals at all any more: every landmark in these stories is an
  // endpoint the camera travelled to, and endpoints are circled.
  const spiralUsers = Object.keys(byId).filter((id) => byId[id].decisions.some((d) => /spiral/i.test(d.decision.key)));
  const globeUsers = Object.keys(byId).filter((id) => byId[id].globe.allowed);
  assert.deepEqual(spiralUsers, [], `spiral appeared in: ${spiralUsers.join(", ")}`);
  assert.deepEqual(globeUsers, ["DIRECTOR-GLOBAL-network"], `globe appeared in: ${globeUsers.join(", ")}`);
});

test("director canaries: every canary generates a real, importable Earth Studio job", () => {
  const manifestPath = path.join(CANARY_GATE, "canary-manifest.json");
  if (!fs.existsSync(manifestPath)) { assert.ok(true, "canaries not generated in this checkout — skipped"); return; }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.director_version, director.DIRECTOR_VERSION);
  assert.ok(manifest.canaries.length >= 5 && manifest.canaries.length <= 8, "keep the human review set small");
  const crypto = require("node:crypto");
  manifest.canaries.forEach((c) => {
    const esp = path.join(__dirname, "..", c.esp);
    assert.ok(fs.existsSync(esp), `${c.id}: ${c.esp} missing`);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(esp)).digest("hex"), c.esp_sha256, `${c.id}: .esp drifted`);
    const project = JSON.parse(fs.readFileSync(esp, "utf8"));
    assert.equal(project.settings.duration, c.total_frames);
    assert.equal(project.settings.frameRate, planner.FRAME_RATE);
    // the directorial reasoning must be recorded beside the artifact
    const dir = JSON.parse(fs.readFileSync(path.join(__dirname, "..", c.direction_json), "utf8"));
    assert.ok(dir.decisions.length, `${c.id}: no recorded decisions`);
    dir.decisions.forEach((d) => {
      assert.ok(d.why && d.why.length > 15, `${c.id}/${d.movement}: every shot must record why it exists`);
      assert.ok(d.purpose, `${c.id}/${d.movement}: every shot must record its purpose`);
    });
    assert.ok(dir.explanation.length, `${c.id}: no plain-language explanation`);
  });
});

// ── Legibility of a crossing (operator directive 2026-08-19) ────────────────
// "Moving long distances close to the ground is not recommended by default — the
// image changes so quickly one cannot understand the locations."
//
// Measured as frame-widths of ground per second. Bracketed by the operator's own
// verdicts on real playback: accepted <= 0.80 fw/s, reported unreadable >= 3.29.

const FW_LIMIT = journey.READABLE_SCREEN_SPEED_FW_PER_S;

function crossings(j) {
  return journey.compileJourney(journey.normalizeJourney(j)).steps
    .filter((s) => s.action === "fly_to" && Number.isFinite(s.distance_m) && s.distance_m > 1000);
}

test("legibility: the limit is bracketed by the operator's accepted and rejected playback", () => {
  assert.equal(FW_LIMIT, 1.0);
  // the accepted case (396 km at 156 km altitude over 9 s) is under the limit
  assert.ok(journey.screenSpeedFrameWidths(396000, 9, 156000, 0) < FW_LIMIT);
  // the rejected case (the same leg at 34 km) is well over it
  assert.ok(journey.screenSpeedFrameWidths(396000, 9, 34000, 0) > 3 * FW_LIMIT);
  // and the worst reported case is far over
  assert.ok(journey.screenSpeedFrameWidths(8873000, 34, 34000, 0) > 20 * FW_LIMIT);
});

test("legibility: no auto-directed journey crosses ground too fast to read", () => {
  const stories = {
    "regional route": { stops: [{ location: "Helsinki", role: "ROUTE_POINT" }, { location: "Stockholm", role: "ROUTE_POINT" }] },
    "four-stop route": { stops: ["Helsinki", "Stockholm", "Copenhagen", "Berlin"].map((l) => ({ location: l, role: "ROUTE_POINT" })) },
    "hero destination": { stops: [{ location: "Helsinki" }, { location: "Stockholm", role: "PRIMARY_SUBJECT", importance: "HIGH" }] },
    "intercontinental": {
      stops: [{ location: "Shanghai", role: "ROUTE_POINT" }, { location: "Amsterdam", role: "ROUTE_POINT" }, { location: "Los Angeles", role: "DESTINATION" }],
      globe_justification: "GLOBAL_NETWORK",
    },
    "scale reveal": {
      stops: [{ location: "Senate Square", role: "PRIMARY_SUBJECT", importance: "HIGH" },
        { location: "Helsinki", role: "SCALE_REFERENCE", purposes: ["SHOW_SCALE"] },
        { location: "Finland", role: "SCALE_REFERENCE", purposes: ["SHOW_SCALE"] }],
    },
    "terrain": { stops: [{ location: "Zurich" }, { location: "Matterhorn", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] },
    "short hop": { stops: [{ location: "Helsinki", role: "ROUTE_POINT" }, { location: "Espoo", role: "ROUTE_POINT" }] },
  };
  Object.entries(stories).forEach(([label, intent]) => {
    const r = director.autoDirect(intent);
    const compiled = journey.compileJourney(r.journey);
    compiled.steps.filter((s) => s.action === "fly_to" && Number.isFinite(s.distance_m) && s.distance_m > 1000).forEach((s) => {
      assert.ok(s.screen_speed_frame_widths_per_second <= FW_LIMIT,
        `${label}: ${s.movement_label} covers ${s.distance_m}m in ${s.duration_seconds}s at ${s.screen_speed_judged_at_altitude_m}m = ${s.screen_speed_frame_widths_per_second} fw/s`);
    });
    // and the journey must not be carrying a legibility warning
    assert.ok(!journey.validateJourney(r.journey).warnings.some((w) => /frame-widths per second/.test(w)),
      `${label} still warns about legibility`);
  });
});

test("legibility: a long leg gets a climbing shape, a short hop does not", () => {
  const styleFor = (dest) => {
    const r = director.autoDirect({ stops: [{ location: "Helsinki", role: "ROUTE_POINT" }, { location: dest, role: "ROUTE_POINT" }] });
    return r.decisions.find((d) => d.kind === "travel").decision.key;
  };
  assert.equal(styleFor("Espoo"), "style:direct", "a 16 km hop needs no ceremony");
  ["Stockholm", "Copenhagen", "Amsterdam", "Tokyo", "Los Angeles"].forEach((d) => {
    const k = styleFor(d);
    assert.notEqual(k, "style:direct", `${d}: a long leg must not cross at destination framing (${k})`);
    assert.notEqual(k, "style:low_approach", `${d}: a long leg must not stay low (${k})`);
  });
});

test("legibility: a climbing style crosses AT altitude, not while descending", () => {
  // High Transit used to climb then `fly` down while travelling, which put the
  // crossing back near the ground and defeated the climb.
  const steps = director.CAMERA_GRAMMAR["style:high_transit"].steps;
  assert.deepEqual(steps, ["climb_to_transit", "cruise", "descend"]);
  const cruise = journey.MOVEMENTS.cruise;
  assert.equal(cruise.holdAltitude, true, "the crossing step must hold its altitude");
  // in practice the longest crossing of a long leg happens on the cruise
  const r = director.autoDirect({ stops: [{ location: "Helsinki", role: "ROUTE_POINT" }, { location: "Tokyo", role: "ROUTE_POINT" }] });
  const c = journey.compileJourney(r.journey);
  const longest = c.steps.filter((s) => s.action === "fly_to").sort((a, b) => (b.distance_m || 0) - (a.distance_m || 0))[0];
  assert.equal(longest.movement, "cruise");
  assert.equal(longest.altitude_from_m, longest.altitude_m, "the crossing must hold a constant altitude");
});

test("legibility: the climb is only as high as reading requires, never the whole route", () => {
  // Framing the entire route is the ceiling, not the target: for a 396 km leg that
  // would be 1,122 km up, which loses the cities the leg is about.
  const rad = (d) => (d * Math.PI) / 180;
  const routeFraming = (d) => (d * Math.cos(0)) / (2 * Math.tan(rad(planner.EARTH_STUDIO_DEFAULT_FOV_DEG / 2)));
  [396000, 883000, 1501000, 7818000].forEach((d) => {
    const alt = journey.transitAltitudeM(d, 0, 0);
    assert.ok(alt <= routeFraming(d) + 1, `${d}m: transit ${alt} exceeds route framing ${Math.round(routeFraming(d))}`);
    const seconds = planner.defaultDuration("fly_to", { distanceM: d });
    assert.ok(journey.screenSpeedFrameWidths(d, seconds, alt, 0) <= FW_LIMIT,
      `${d}m: transit altitude ${alt} is not legible`);
  });
  // a 396 km leg must stay far below route framing
  assert.ok(journey.transitAltitudeM(396000, 0, 0) < routeFraming(396000) / 3);
  assert.ok(journey.transitAltitudeM(396000, 0, 0) > 100000, "but still high enough to read");
});

test("legibility: an operator who forces a low long crossing keeps it, and is told why", () => {
  const forced = journey.validateJourney({
    start: { location: "Helsinki" }, start_movements: [{ type: "hold", duration_seconds: 4 }],
    legs: [{ destination: { location: "Stockholm" }, travel_style: "direct",
      travel: [{ type: "fly" }], movements: [{ type: "hold", duration_seconds: 4 }] }],
  });
  assert.equal(forced.ok, true, "it stays legal — the operator may want it");
  const w = forced.warnings.find((x) => /frame-widths per second/.test(x));
  assert.ok(w, forced.warnings.join(" | "));
  assert.match(w, /too fast to read the locations/);
  assert.match(w, /High Transit or Cinematic/);
  assert.match(w, /cross at about/);
});

test("semantics: an arrival is circled, not spiralled", () => {
  // Operator rule: "spiralling fits when there is no specific endpoint; it does
  // not fit when the Eiffel Tower is the destination — the camera should circle it."
  const arrival = director.autoDirect({ stops: [
    { location: "Paris", role: "GEOGRAPHIC_CONTEXT", purposes: ["LOCATE"] },
    { location: "Eiffel Tower", role: "FINAL_REVEAL", importance: "HERO", purposes: ["REVEAL"] }] });
  const atTower = arrival.decisions.find((d) => d.kind === "at" && d.place === "Eiffel Tower");
  assert.ok(/orbit/i.test(atTower.decision.key), `the tower got ${atTower.decision.key}`);
  assert.ok(!/spiral/i.test(atTower.decision.key));
  // and the spiral is explicitly ruled out, with the reason
  const why = atTower.rejected.find((x) => /spiral/i.test(x.key));
  assert.ok(why, "a spiral must be explicitly rejected at an arrival");
  assert.match(why.reason, /open-ended|endpoint the camera travelled to|circled instead/i);
  // no canary may spiral an arrival
  const { CANARIES } = require("../scripts/earth-studio-director-canaries.js");
  CANARIES.forEach((c) => {
    const r = director.autoDirect({ ...c.intent, aspect: c.aspect });
    r.decisions.filter((d) => d.kind === "at" && d.stop > 0).forEach((d) => {
      assert.ok(!/spiral/i.test(d.decision.key), `${c.id}: ${d.place} was spiralled on arrival`);
    });
  });
});

test("semantics: a spiral is still available where the camera is NOT arriving", () => {
  // It remains in the grammar as an open-ended move, so the rule is a scoping
  // rule rather than a deletion.
  const opening = director.recommend({ slot: "at", role: "FINAL_REVEAL", importance: "HERO",
    purposes: ["REVEAL"], scale: "landmark", place: "Eiffel Tower" });
  assert.ok(!opening.rejected.some((x) => /spiral/i.test(x.key)),
    "a non-arrival subject must not disqualify the spiral");
  assert.ok(director.CAMERA_GRAMMAR.spiral_in.spiral, "the spiral must stay marked in the grammar");
  assert.match(director.CAMERA_GRAMMAR.spiral_in.teaching, /circle an arrival instead/i);
});

test("terrain morphology: terrain rake is semantic, human-calibrated, and preserves the legacy orbit footprint", () => {
  const angleAt = (intent, place) => {
    const r = director.autoDirect(intent);
    const c = journey.compileJourney(r.journey);
    const last = c.steps.filter((x) => x.location_name === place).pop();
    return last ? last.tilt_deg : null;
  };
  const city = angleAt({ stops: [{ location: "Helsinki" },
    { location: "Stockholm", role: "PRIMARY_SUBJECT", importance: "HIGH", purposes: ["ARRIVE", "INSPECT"] }] }, "Stockholm");
  const terrain = angleAt({ stops: [{ location: "Zurich" },
    { location: "Matterhorn", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] }, "Matterhorn");
  assert.ok(terrain > city, `terrain ${terrain}deg should rake lower than city inspection ${city}deg`);
  assert.equal(terrain, 74);
  // and the angle must still let the orbit face its target
  const c = journey.compileJourney(director.autoDirect({ stops: [{ location: "Zurich" },
    { location: "Matterhorn", role: "FINAL_REVEAL", importance: "HERO", purposes: ["SHOW_TERRAIN", "REVEAL"] }] }).journey);
  const orbit = c.steps[c.steps.length - 1];
  assert.equal(orbit.action, "orbit");
  assert.ok(journey.orbitCanFaceTarget(orbit.altitude_m, orbit.tilt_deg), "the raking orbit must still face the mountain");
  // CONTRACT CHANGE (2026-09-04, terrain complete pose). The footprint law is
  // unchanged — the accepted 72-degree ground ring is preserved to the metre —
  // but the ring is now measured from the DECLARED FOCAL ELEVATION, not from sea
  // level: ring = (A − z_t)·tan θ. The old assertion read the ring as A·tan θ,
  // which is only the ring when the thing being looked at is at sea level; on
  // the Matterhorn that law aimed the optical centre 4,478 m under the summit
  // (~10° of a 20° vertical field). The camera altitude therefore rises to
  // z_t + r/tan θ (10 214 m at 74°) while the ring stays 20 005 m.
  const resolved = planner.resolveLocation("Matterhorn");
  const legacyRadius = terrainMorphology.referenceRadius(resolved.altitude_m);
  assert.ok(Math.abs(planner.orbitRingRadiusMeters(resolved, orbit.altitude_m, orbit.tilt_deg) - legacyRadius) < 2,
    "the morphology angle must preserve the accepted 72-degree orbit footprint (measured from the focal elevation)");
  // A = z_t + r / tan θ = 4478 + 20004.94 / tan 74° = 10214.3 → whole metres.
  assert.equal(orbit.altitude_m, Math.round(resolved.target_elevation_m + legacyRadius / Math.tan((74 * Math.PI) / 180)));
  assert.equal(orbit.altitude_m, 10214);
  assert.ok(planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg) > legacyRadius * 1.5,
    "the sea-level ring law is no longer what a terrain orbit rides — if this ever equals the footprint again, the focal elevation was lost");
});

test("terrain morphology: policy maps semantic form rather than place names", () => {
  const decide = (terrain_morphology) => terrainMorphology.terrainTiltDecision({ terrain_morphology });
  assert.equal(decide("sharp_peak").final_tilt_deg, 74);
  assert.equal(decide("volcanic_cone").final_tilt_deg, 45);
  assert.equal(decide("canyon").final_tilt_deg, 74);
  assert.equal(decide("fjord_channel").final_tilt_deg, 65);
  assert.equal(decide(null).final_tilt_deg, 65);
  assert.equal(decide("unknown_landform").morphology, "GENERIC_TERRAIN");
  assert.equal(decide("unknown_landform").fallback, true);
  assert.equal(terrainMorphology.referenceRadius(null), null, "missing altitude must not become a zero-radius camera");
  assert.equal(decide("sharp_peak").final_tilt_deg, decide("sharp_peak").final_tilt_deg,
    "the policy has no subject-name input and is deterministic");
});

test("terrain morphology: Matterhorn and Fuji diverge because their gazetteer morphology diverges", () => {
  const run = (place) => director.autoDirect(director.parseIntent(`Show the terrain of ${place}.`));
  const matterhorn = run("Matterhorn");
  const fuji = run("Mount Fuji");
  const md = matterhorn.decisions[0].decision;
  const fd = fuji.decisions[0].decision;
  assert.equal(md.terrain_policy.morphology, "SHARP_PEAK");
  assert.equal(fd.terrain_policy.morphology, "VOLCANIC_CONE");
  assert.equal(md.tilt_deg, 74);
  assert.equal(fd.tilt_deg, 45);
  assert.notEqual(md.tilt_deg, fd.tilt_deg);
  assert.equal(planner.resolveLocation("Matterhorn").terrain_morphology, "sharp_peak");
  assert.equal(planner.resolveLocation("Mount Fuji").terrain_morphology, "volcanic_cone");
});

test("terrain morphology: all four human calibration anchors map to the recorded winner for an orbit-family shot", () => {
  const cases = [
    ["Matterhorn", "sharp_peak", 74],
    ["Mount Fuji", "volcanic_cone", 45],
    ["Grand Canyon", "canyon", 74],
    ["Geirangerfjord", "fjord_channel", 65],
  ];
  cases.forEach(([place, morphology, tilt]) => {
    const resolved = planner.resolveLocation(place);
    assert.equal(resolved.terrain_morphology, morphology, place);
    const d = director.recommend({ slot: "at", role: "PRIMARY_SUBJECT", importance: "HIGH",
      purposes: ["SHOW_TERRAIN"], scale: "district", place,
      terrain_morphology: resolved.terrain_morphology, morphology_source: resolved.morphology_source,
      terrain_altitude_m: resolved.altitude_m, terrain_min_altitude_m: resolved.min_altitude_m }).recommended;
    assert.match(d.movement, /orbit/);
    assert.equal(d.tilt_deg, tilt, place);
  });
});

test("terrain morphology: unseen fixtures generalize and unknown terrain uses the conservative fallback", () => {
  const natural = (place) => director.autoDirect(director.parseIntent(`Show the terrain of ${place}.`)).decisions[0].decision;
  assert.deepEqual([natural("Mont Blanc").terrain_policy.morphology, natural("Mont Blanc").tilt_deg], ["SHARP_PEAK", 74]);
  assert.deepEqual([natural("Kilimanjaro").terrain_policy.morphology, natural("Kilimanjaro").tilt_deg], ["VOLCANIC_CONE", 45]);
  const fallback = terrainMorphology.terrainTiltDecision({ terrain_morphology: "mountain_range", altitude_m: 5000 });
  assert.equal(fallback.morphology, "GENERIC_TERRAIN");
  assert.equal(fallback.final_tilt_deg, 65);
  assert.equal(fallback.fallback, true);
});

test("terrain morphology: safety floor reduces an infeasible rake and records why", () => {
  // CONTRACT CHANGE (2026-09-04, terrain complete pose). The OLD expectation
  // (Everest clamped to 73.35°) encoded the sea-level pose: r/tan 74° = 8,825 m
  // sat below the 9,200 m floor. With the declared summit at 8,849 m the
  // complete pose is 8,849 + 8,825 = 17,674 m, well above the floor, so Everest
  // is legitimately NOT clamped any more. The safety semantics themselves are
  // unchanged and are exercised on a real conflict below: target and footprint
  // are held, the camera is clamped to the floor, and the rake is reduced to
  // the highest angle still legal ABOVE THE TARGET — atan2(r, floor − z_t).
  const r = director.autoDirect(director.parseIntent("Show the terrain of Mount Everest."));
  const d = r.decisions[0].decision;
  assert.equal(d.terrain_policy.requested_tilt_deg, 74);
  assert.equal(d.tilt_deg, 74, "the complete pose sits above the floor, so the preferred rake is preserved");
  assert.equal(d.altitude_m, 17674);
  assert.equal(d.terrain_policy.safety_clamp, null);
  assert.equal(d.terrain_policy.target_elevation_declared, true);

  const conflict = terrainMorphology.terrainTiltDecision({
    terrain_morphology: "sharp_peak", altitude_m: 5000 / Math.tan((72 * Math.PI) / 180),
    min_altitude_m: 7000, target_elevation_m: 4000,
  });
  assert.equal(conflict.requested_tilt_deg, 74);
  assert.equal(conflict.safety_clamp.code, "TERRAIN_SAFETY_FLOOR");
  assert.equal(conflict.safety_clamp.min_altitude_m, 7000);
  assert.equal(conflict.safety_clamp.target_elevation_m, 4000);
  assert.equal(conflict.safety_clamp.highest_legal_tilt_deg, Number(((Math.atan2(5000, 3000) * 180) / Math.PI).toFixed(6)));
  assert.equal(conflict.final_tilt_deg, 59.03, "quantized DOWN to the two decimals a journey phrase carries");
  assert.ok(conflict.altitude_m >= 7000 && conflict.altitude_m <= 7001, "camera held at the floor (whole metres)");
  assert.ok(Math.abs(conflict.complete_pose.ring_radius_m - 5000) < 1, "footprint held");
  // The pre-repair law (floor measured from sea level) would have reduced the
  // rake to atan2(5000, 7000) = 35.5°, pointing the camera 4 km under the target.
  assert.ok(conflict.final_tilt_deg > 50);
});

test("terrain morphology: explicit tilt wins and non-terrain intent does not activate morphology", () => {
  const explicit = director.autoDirect(director.parseIntent("Show the terrain of Matterhorn at 55 degrees."));
  assert.equal(explicit.decisions[0].decision.tilt_deg, 55);
  assert.equal(explicit.decisions[0].decision.terrain_policy.overridden_by, "EXPLICIT_OPERATOR_TILT");
  assert.equal(explicit.journey.start_movements[0].altitude_m, null,
    "the morphology-coupled altitude must not survive an explicit angle override");

  const orient = director.autoDirect(director.parseIntent("Show where Mount Fuji is in Japan."));
  assert.equal(orient.decisions[0].decision.terrain_policy, undefined);
  assert.notEqual(orient.decisions[0].decision.tilt_deg, 45);
});

test("terrain morphology: region reveal remains honest and does not invent an orbit", () => {
  const canyon = director.autoDirect(director.parseIntent("Show the terrain of Grand Canyon."));
  assert.equal(canyon.decisions[0].decision.movement, "reveal");
  assert.equal(canyon.decisions[0].decision.terrain_policy, undefined);
  assert.equal(canyon.journey.start_movements[0].tilt_deg, null);
});
