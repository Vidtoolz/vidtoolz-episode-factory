(function earthStudioDirector(globalScope) {
  "use strict";

  // ───────────────────────────────────────────────────────────────────────────
  // Earth Studio MAP CINEMATOGRAPHY / DIRECTORIAL layer (director_version 1)
  //
  // The journey builder knows HOW camera movements work. This layer knows WHY a
  // filmmaker would choose one. It sits ABOVE the journey model and produces
  // journey-model decisions — it never touches the planner, the keyframe engine
  // or the .esp serializer:
  //
  //   story / geographic intent
  //     -> shot purpose            (what this shot is FOR)
  //     -> directorial decision    (scored, explainable)
  //     -> camera movement / template / framing / angle / duration
  //     -> journey model           [existing]
  //     -> planner + serializer    [existing, proven, byte-frozen]
  //
  // Every recommendation carries its reasoning, so "why is the camera doing
  // this?" always has an answer. Fully deterministic: same structured intent ->
  // same recommendation. No randomness, no clock, no LLM in the decision path.
  // ───────────────────────────────────────────────────────────────────────────

  const DIRECTOR_VERSION = 1;

  function loadJourney(injected) {
    if (injected) return injected;
    if (globalScope && globalScope.EarthStudioJourney) return globalScope.EarthStudioJourney;
    if (typeof require === "function") return require("./earth-studio-journey.js");
    throw new Error("earth-studio-director: journey module unavailable");
  }
  function loadPlanner(injected) {
    if (injected) return injected;
    if (globalScope && globalScope.EarthStudioJobPlanner) return globalScope.EarthStudioJobPlanner;
    if (typeof require === "function") return require("./earth-studio-job-planner.js");
    throw new Error("earth-studio-director: planner module unavailable");
  }
  function loadComposition(injected) {
    if (injected) return injected;
    if (globalScope && globalScope.EarthStudioOpeningComposition) return globalScope.EarthStudioOpeningComposition;
    if (typeof require === "function") return require("./earth-studio-opening-composition.js");
    throw new Error("earth-studio-director: opening-composition module unavailable");
  }
  function loadTerrainMorphology(injected) {
    if (injected) return injected;
    if (globalScope && globalScope.EarthStudioTerrainMorphology) return globalScope.EarthStudioTerrainMorphology;
    if (typeof require === "function") return require("./earth-studio-terrain-morphology.js");
    throw new Error("earth-studio-director: terrain-morphology module unavailable");
  }

  // ── Shot purpose — why does this shot exist? ───────────────────────────────
  // `angle` is the viewing angle the purpose WANTS. Whether it can be delivered
  // depends on the movement (see frames_target / angle notes in CAMERA_GRAMMAR):
  // in the proven generic engine only an orbit-class move can hold an oblique
  // view of its own target.
  const SHOT_PURPOSES = {
    ORIENT: {
      key: "ORIENT", label: "Orient",
      viewer_should_understand: "roughly where in the world we are",
      angle: "top_down", motion: "low", dwell: 1.0, scales: ["region", "country", "subcontinent", "continent", "globe"],
    },
    LOCATE: {
      key: "LOCATE", label: "Locate",
      viewer_should_understand: "where this place sits inside a larger area",
      angle: "top_down", motion: "moderate", dwell: 1.0, scales: ["district", "city", "metro", "region", "country", "continent"],
    },
    ESTABLISH: {
      key: "ESTABLISH", label: "Establish",
      viewer_should_understand: "that we are now at this place, and what kind of place it is",
      angle: "either", motion: "low", dwell: 1.15, scales: ["landmark", "neighborhood", "district", "city", "metro"],
    },
    TRAVEL: {
      key: "TRAVEL", label: "Travel",
      viewer_should_understand: "that we are moving from one place to another",
      angle: "top_down", motion: "high", dwell: 0.9, scales: [],
    },
    ARRIVE: {
      key: "ARRIVE", label: "Arrive",
      viewer_should_understand: "that we have reached the place that matters",
      angle: "either", motion: "moderate", dwell: 1.1, scales: ["landmark", "neighborhood", "district", "city"],
    },
    INSPECT: {
      key: "INSPECT", label: "Inspect",
      viewer_should_understand: "what this place physically looks like",
      angle: "oblique", motion: "moderate", dwell: 1.3, scales: ["landmark", "neighborhood", "district", "city"],
    },
    REVEAL: {
      key: "REVEAL", label: "Reveal",
      viewer_should_understand: "something they had not yet seen, with emphasis",
      angle: "oblique", motion: "high", dwell: 1.35, scales: ["landmark", "neighborhood", "district"],
    },
    COMPARE: {
      key: "COMPARE", label: "Compare",
      viewer_should_understand: "how two places differ or resemble each other",
      angle: "top_down", motion: "low", dwell: 1.2, scales: ["district", "city", "metro", "region"],
    },
    RELATE: {
      key: "RELATE", label: "Relate",
      viewer_should_understand: "how this place stands in relation to another one",
      angle: "top_down", motion: "moderate", dwell: 1.1, scales: ["metro", "region", "country", "subcontinent"],
    },
    SHOW_ROUTE: {
      key: "SHOW_ROUTE", label: "Show the route",
      viewer_should_understand: "the path taken and its geography",
      angle: "top_down", motion: "high", dwell: 1.0, scales: ["metro", "region", "country", "subcontinent"],
    },
    SHOW_SCALE: {
      key: "SHOW_SCALE", label: "Show the scale",
      viewer_should_understand: "how big this is, or how it nests inside something bigger",
      angle: "top_down", motion: "moderate", dwell: 1.3, scales: ["city", "metro", "region", "country", "subcontinent", "continent", "globe"],
    },
    SHOW_TERRAIN: {
      key: "SHOW_TERRAIN", label: "Show the terrain",
      viewer_should_understand: "the physical shape of the land",
      angle: "oblique", motion: "moderate", dwell: 1.2, scales: ["neighborhood", "district", "city", "metro", "region"],
    },
    EMPHASIZE: {
      key: "EMPHASIZE", label: "Emphasize",
      viewer_should_understand: "that this place is the important one",
      angle: "oblique", motion: "moderate", dwell: 1.3, scales: ["landmark", "neighborhood", "district", "city"],
    },
    TRANSITION: {
      key: "TRANSITION", label: "Transition",
      viewer_should_understand: "that the sequence is moving on",
      angle: "either", motion: "moderate", dwell: 0.8, scales: [],
    },
    CONCLUDE: {
      key: "CONCLUDE", label: "Conclude",
      viewer_should_understand: "that the sequence has landed and is finished",
      angle: "either", motion: "low", dwell: 1.25, scales: [],
    },
    CONTINUE: {
      key: "CONTINUE", label: "Continue",
      viewer_should_understand: "that the camera is picking up exactly where a previous animation left it",
      angle: "either", motion: "low", dwell: 0.9, scales: [],
    },
  };

  // ── Provenance — where each plan value came from ──────────────────────────
  // The plan must never present planner-inferred or defaulted values as
  // user-specified facts.
  const PROVENANCE = {
    USER_SPECIFIED: "user-specified",
    GEOGRAPHICALLY_DERIVED: "geographically-derived",
    PLANNER_INFERRED: "planner-inferred",
    DEFAULTED: "defaulted",
    CARRIED_OVER: "carried-over",
    COMPUTED: "computed",
  };

  const PLAN_VERSION = 1;

  // ── Location narrative role — what is this place doing in the story? ───────
  // `flourish` is how much visual specialness this role has earned:
  //   0 = none, 1 = a selective move is defensible, 2 = a special move may be.
  const LOCATION_ROLES = {
    STARTING_CONTEXT: {
      key: "STARTING_CONTEXT", label: "Starting context",
      blurb: "Where the story opens. Give the viewer their bearings, do not perform.",
      importance: "NORMAL", purposes: ["ESTABLISH", "ORIENT"], flourish: 1, dwell: 1.0,
    },
    PRIMARY_SUBJECT: {
      key: "PRIMARY_SUBJECT", label: "Important subject",
      blurb: "The thing the story is actually about. Earns deliberate framing and dwell.",
      importance: "HIGH", purposes: ["ESTABLISH", "INSPECT", "EMPHASIZE"], flourish: 2, dwell: 1.35,
    },
    DESTINATION: {
      key: "DESTINATION", label: "Destination",
      blurb: "Where we were heading. The arrival is part of the story.",
      importance: "HIGH", purposes: ["ARRIVE", "ESTABLISH", "INSPECT"], flourish: 2, dwell: 1.2,
    },
    WAYPOINT: {
      key: "WAYPOINT", label: "Waypoint",
      blurb: "A stop on the way. Brief and efficient; save the flourish for what matters.",
      importance: "LOW", purposes: ["ESTABLISH", "TRANSITION"], flourish: 0, dwell: 0.8,
    },
    COMPARISON_LOCATION: {
      key: "COMPARISON_LOCATION", label: "Comparison",
      blurb: "Shown so the viewer can weigh it against another place. Match its treatment.",
      importance: "NORMAL", purposes: ["COMPARE", "ESTABLISH"], flourish: 1, dwell: 1.1,
    },
    ROUTE_POINT: {
      key: "ROUTE_POINT", label: "Route point",
      blurb: "Part of a path. Geographic clarity beats individual attention.",
      importance: "LOW", purposes: ["SHOW_ROUTE", "TRANSITION"], flourish: 0, dwell: 0.7,
    },
    GEOGRAPHIC_CONTEXT: {
      key: "GEOGRAPHIC_CONTEXT", label: "Geographic context",
      blurb: "Shown to explain where things are. Higher, flatter, calmer.",
      importance: "NORMAL", purposes: ["ORIENT", "LOCATE", "SHOW_SCALE"], flourish: 0, dwell: 1.1,
    },
    SCALE_REFERENCE: {
      key: "SCALE_REFERENCE", label: "Scale reference",
      blurb: "A rung in a scale ladder. Its job is the size relationship, nothing else.",
      importance: "NORMAL", purposes: ["SHOW_SCALE", "LOCATE"], flourish: 0, dwell: 1.15,
    },
    FINAL_REVEAL: {
      key: "FINAL_REVEAL", label: "Final reveal",
      blurb: "The payoff shot. The one place a special move is genuinely earned.",
      importance: "HERO", purposes: ["REVEAL", "EMPHASIZE", "CONCLUDE"], flourish: 2, dwell: 1.5,
    },
  };

  const IMPORTANCE = {
    LOW: { key: "LOW", weight: 0.6, flourish: 0, dwell: 0.8 },
    NORMAL: { key: "NORMAL", weight: 1.0, flourish: 1, dwell: 1.0 },
    HIGH: { key: "HIGH", weight: 1.4, flourish: 2, dwell: 1.2 },
    HERO: { key: "HERO", weight: 1.8, flourish: 3, dwell: 1.45 },
  };
  const IMPORTANCE_ORDER = ["LOW", "NORMAL", "HIGH", "HERO"];

  // Editorial rarity — priors, not hard limits. A special move used constantly
  // stops being special.
  const RARITY = {
    COMMON: { key: "COMMON", spectacle: 0, budget: 0 },
    SELECTIVE: { key: "SELECTIVE", spectacle: 1.2, budget: 1 },
    SPECIAL: { key: "SPECIAL", spectacle: 3.0, budget: 2 },
  };

  // ── Globe: narrative device, never "just very wide" ────────────────────────
  // Distance alone NEVER justifies the planet. One of these must be declared.
  const GLOBE_JUSTIFICATIONS = {
    GLOBAL_CONTEXT: { key: "GLOBAL_CONTEXT", blurb: "the story is explicitly about worldwide position" },
    INTERCONTINENTAL_SCALE: { key: "INTERCONTINENTAL_SCALE", blurb: "the distance between continents is itself the point" },
    WORLDWIDE_PHENOMENON: { key: "WORLDWIDE_PHENOMENON", blurb: "the subject happens across the whole planet" },
    PLANETARY_COMPARISON: { key: "PLANETARY_COMPARISON", blurb: "places on opposite sides of the planet are being compared" },
    GLOBAL_NETWORK: { key: "GLOBAL_NETWORK", blurb: "a network spanning the planet is the subject" },
    GLOBAL_ORIGIN: { key: "GLOBAL_ORIGIN", blurb: "the sequence opens from planetary scale on purpose" },
    GLOBAL_CONCLUSION: { key: "GLOBAL_CONCLUSION", blurb: "the sequence closes by widening to the whole planet" },
  };
  // A journey must also actually be big enough for the planet to read.
  const INTERCONTINENTAL_DISTANCE_M = 4000000;

  // Compatibility/export value for callers that need one terrain default. The
  // production decision is no longer global: semantic gazetteer morphology
  // selects the human-calibrated angle. 65° is the explicit generic fallback.
  const TERRAIN_OBLIQUE_TILT_DEG = 65;

  const SMALL_SCALES = ["landmark", "neighborhood", "district"];
  const MID_SCALES = ["city", "metro"];
  const LARGE_SCALES = ["region", "country", "subcontinent", "continent"];

  // ── Camera grammar — directorial semantics for every SUPPORTED move ────────
  // Only moves the generator genuinely produces appear here: the five proven
  // primitives as exposed by the journey model's movement catalogue, plus the
  // five import-verified native Quick Start template profiles.
  //
  // frames_target: can this move hold its own target in frame? An orbit rides a
  // ring pointing at the target, so yes at any angle. A fly/hover/zoom sits ABOVE
  // its target, so it can only frame it looking straight down — established by
  // real Earth Studio imports on 2026-08-19.
  const CAMERA_GRAMMAR = {
    hold: {
      key: "hold", label: "Hold", kind: "at", movement: "hold",
      primary_purpose: "ESTABLISH", secondary_purposes: ["ORIENT", "LOCATE", "COMPARE", "SHOW_SCALE", "CONCLUDE", "TRANSITION"],
      communicates: ["this is the place", "time to read the geography"],
      good_for: ["a location just established", "narration that needs comprehension", "a beat after an important transition", "graphic overlays"],
      usually_avoid_when: ["nothing has been established yet to read", "used reflexively after every single movement"],
      scales: ["landmark", "neighborhood", "district", "city", "metro", "region", "country", "subcontinent", "continent", "globe"],
      angle: "top_down", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      teaching: "A hold is not nothing. It is the shot that lets the audience understand what they are looking at.",
    },
    slow_orbit: {
      key: "slow_orbit", label: "Slow Orbit", kind: "at", movement: "slow_orbit",
      primary_purpose: "INSPECT", secondary_purposes: ["ESTABLISH", "EMPHASIZE", "ARRIVE", "SHOW_TERRAIN", "REVEAL"],
      communicates: ["three-dimensional form", "importance", "unhurried inspection"],
      good_for: ["landmarks", "buildings", "mountains", "a city centre where 3D form matters", "an arrival that matters"],
      usually_avoid_when: ["a generic route waypoint", "a country or continent", "the viewer mainly needs a top-down relationship"],
      scales: ["landmark", "neighborhood", "district", "city"],
      angle: "oblique", rarity: "SELECTIVE", duration_bias: 1.25, frames_target: true,
      teaching: "Circling a subject shows its shape and says it is worth looking at. Use it on things, not on regions.",
    },
    orbit: {
      key: "orbit", label: "Orbit", kind: "at", movement: "orbit",
      primary_purpose: "INSPECT", secondary_purposes: ["ESTABLISH", "EMPHASIZE", "ARRIVE", "REVEAL"],
      communicates: ["three-dimensional form", "this is the subject"],
      good_for: ["landmarks", "buildings", "stadiums", "distinctive terrain", "an important destination"],
      usually_avoid_when: ["a generic waypoint", "a country or continent", "a place whose meaning is 2D geography"],
      scales: ["landmark", "neighborhood", "district", "city"],
      angle: "oblique", rarity: "SELECTIVE", duration_bias: 1.0, frames_target: true,
      teaching: "After an arrival an orbit says: here is where it is, now look at it.",
    },
    orbit_twice: {
      key: "orbit_twice", label: "Double Orbit", kind: "at", movement: "orbit_twice",
      primary_purpose: "EMPHASIZE", secondary_purposes: ["INSPECT", "REVEAL"],
      communicates: ["this is a hero subject", "sit here and take it in"],
      good_for: ["a hero destination", "the single most important subject in the sequence"],
      usually_avoid_when: ["anything that is not the story's centre", "a short sequence with no room"],
      scales: ["landmark", "neighborhood", "district"],
      angle: "oblique", rarity: "SPECIAL", duration_bias: 2.0, frames_target: true,
      teaching: "Two revolutions is a lot of screen time. Only the hero earns it — and one circle usually says the same thing.",
    },
    half_orbit: {
      key: "half_orbit", label: "Half Orbit", kind: "at", movement: "half_orbit",
      primary_purpose: "INSPECT", secondary_purposes: ["ESTABLISH", "TRANSITION"],
      communicates: ["a change of viewpoint", "enough shape to read"],
      good_for: ["a compact subject with limited time", "repositioning before departing"],
      usually_avoid_when: ["the viewer needs the full form", "a route point"],
      scales: ["landmark", "neighborhood", "district", "city"],
      angle: "oblique", rarity: "SELECTIVE", duration_bias: 0.85, frames_target: true,
      teaching: "Half the cost of an orbit, and it leaves the camera somewhere new.",
    },
    zoom_in: {
      key: "zoom_in", label: "Push In", kind: "at", movement: "zoom_in",
      primary_purpose: "EMPHASIZE", secondary_purposes: ["LOCATE", "ARRIVE", "REVEAL"],
      communicates: ["narrowing attention", "context becoming subject"],
      good_for: ["moving from a wider frame onto the thing that matters", "tightening at the end of an arrival"],
      usually_avoid_when: ["already close", "chained repeatedly for its own sake"],
      scales: ["landmark", "neighborhood", "district", "city", "metro"],
      angle: "top_down", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      teaching: "Context to subject. The classic way to say: this, specifically.",
    },
    zoom_out: {
      key: "zoom_out", label: "Pull Back", kind: "at", movement: "zoom_out",
      primary_purpose: "SHOW_SCALE", secondary_purposes: ["LOCATE", "RELATE", "TRANSITION", "CONCLUDE"],
      communicates: ["this is part of something larger", "the wider region"],
      good_for: ["subject to context", "preparing a long departure", "showing what a place belongs to"],
      usually_avoid_when: ["used as decoration", "the viewer already has the context"],
      scales: ["neighborhood", "district", "city", "metro", "region", "country", "subcontinent", "continent"],
      angle: "top_down", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      teaching: "Subject to context. Say it when the story genuinely widens.",
    },
    reveal: {
      key: "reveal", label: "Reveal", kind: "at", movement: "reveal",
      primary_purpose: "SHOW_SCALE", secondary_purposes: ["RELATE", "CONCLUDE", "ORIENT"],
      communicates: ["a big jump outward in context"],
      good_for: ["placing a subject in a much larger frame", "a closing widen"],
      usually_avoid_when: ["mid-sequence with no narrative widening", "repeated"],
      scales: ["district", "city", "metro", "region", "country"],
      angle: "top_down", rarity: "SELECTIVE", duration_bias: 1.15, frames_target: true,
      teaching: "Two scale steps out at once. A statement, not a transition.",
    },
    spiral_in: {
      key: "spiral_in", spiral: true, label: "Spiral In", kind: "at", movement: "spiral_in",
      primary_purpose: "REVEAL", secondary_purposes: ["EMPHASIZE", "INSPECT"],
      communicates: ["intensifying focus", "three-dimensional form", "drama"],
      good_for: ["a dramatic reveal of a compact, visually distinctive subject", "a hero opening or closing"],
      usually_avoid_when: ["ordinary locations", "route points", "a country or continent", "already used in this sequence", "there is no time for it to breathe"],
      scales: ["landmark", "neighborhood", "district"],
      angle: "oblique", rarity: "SPECIAL", duration_bias: 1.3, frames_target: true,
      teaching: "Orbit and descent at once — an open-ended move that keeps closing in. It suits a subject the camera is NOT arriving at; circle an arrival instead.",
    },
    spiral_out: {
      key: "spiral_out", spiral: true, label: "Spiral Out", kind: "at", movement: "spiral_out",
      primary_purpose: "REVEAL", secondary_purposes: ["SHOW_SCALE", "CONCLUDE"],
      communicates: ["releasing focus outward with drama"],
      good_for: ["a dramatic closing widen from a distinctive subject"],
      usually_avoid_when: ["mid-sequence", "ordinary locations", "already used in this sequence"],
      scales: ["landmark", "neighborhood", "district"],
      angle: "oblique", rarity: "SPECIAL", duration_bias: 1.3, frames_target: true,
      teaching: "The exit version of a spiral. Reserve it for an ending.",
    },
    // ── travel ──
    fly: {
      key: "fly", label: "Fly To", kind: "travel", movement: "fly",
      primary_purpose: "TRAVEL", secondary_purposes: ["SHOW_ROUTE", "TRANSITION", "RELATE"],
      communicates: ["we are going there", "the geography in between"],
      good_for: ["getting from A to B without ceremony", "route legs", "waypoint chains"],
      usually_avoid_when: ["the arrival itself is the point and deserves shaping"],
      scales: [], angle: "top_down", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      teaching: "The workhorse. Long flights arc up and back down on their own.",
    },
    cruise: {
      key: "cruise", label: "Cruise", kind: "travel", movement: "cruise",
      primary_purpose: "TRAVEL", secondary_purposes: ["SHOW_ROUTE", "RELATE"],
      communicates: ["sustained travel at a settled height"],
      good_for: ["the middle of a shaped departure/arrival", "keeping altitude steady across a leg"],
      usually_avoid_when: ["used alone where a plain Fly To would read the same"],
      scales: [], angle: "top_down", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      teaching: "Holds the height you already climbed to, so the leg feels continuous.",
    },
    fly_high: {
      key: "fly_high", label: "Fly High", kind: "travel", movement: "fly_high",
      primary_purpose: "SHOW_ROUTE", secondary_purposes: ["TRAVEL", "SHOW_SCALE", "RELATE"],
      communicates: ["the whole route at once", "distance"],
      good_for: ["a leg where seeing both ends matters", "long-distance relationships"],
      usually_avoid_when: ["a short hop", "the endpoints matter more than the path"],
      scales: [], angle: "top_down", rarity: "SELECTIVE", duration_bias: 1.1, frames_target: true,
      teaching: "Climbs high enough that the whole route reads. Costly on a short leg.",
    },
    fly_low: {
      key: "fly_low", label: "Low Approach", kind: "travel", movement: "fly_low",
      primary_purpose: "SHOW_TERRAIN", secondary_purposes: ["ARRIVE", "REVEAL", "TRAVEL"],
      communicates: ["the shape of the land", "an aircraft-like approach"],
      good_for: ["terrain stories", "mountain and valley form", "a dramatic arrival"],
      usually_avoid_when: ["the viewer needs to know where they are", "flat or featureless ground", "a route explanation"],
      scales: ["neighborhood", "district", "city", "metro", "region"],
      angle: "oblique", rarity: "SELECTIVE", duration_bias: 1.15,
      // Deliberately horizon-tilted: it shows the land ahead, not the target below.
      frames_target: false,
      teaching: "Low and tilted toward the horizon. Shows terrain, at the cost of orientation.",
    },
    pull_back: {
      key: "pull_back", label: "Pull Back", kind: "travel", movement: "pull_back",
      primary_purpose: "TRANSITION", secondary_purposes: ["SHOW_SCALE", "TRAVEL"],
      communicates: ["leaving", "widening before a move"],
      good_for: ["shaping a departure", "getting height before a long leg"],
      usually_avoid_when: ["a short hop that needs no ceremony", "every single leg of a route"],
      scales: [], angle: "top_down", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      teaching: "The departure half of a shaped travel. Motivated when the leg is long.",
    },
    climb_to_transit: {
      key: "climb_to_transit", label: "Climb Out", kind: "travel", movement: "climb_to_transit",
      primary_purpose: "SHOW_ROUTE", secondary_purposes: ["TRANSITION", "SHOW_SCALE"],
      communicates: ["getting high enough to see the whole journey"],
      good_for: ["opening a long leg where the route is the story"],
      usually_avoid_when: ["short legs", "when the route is not the point"],
      scales: [], angle: "top_down", rarity: "SELECTIVE", duration_bias: 1.1, frames_target: true,
      teaching: "Explicitly climbs to route-framing altitude before crossing.",
    },
    descend: {
      key: "descend", label: "Descend", kind: "travel", movement: "descend",
      primary_purpose: "ARRIVE", secondary_purposes: ["TRAVEL", "EMPHASIZE"],
      communicates: ["settling into the destination"],
      good_for: ["the arrival half of a shaped travel", "landing into a destination orbit"],
      usually_avoid_when: ["the camera is already at destination height"],
      scales: [], angle: "either", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      teaching: "The arrival half. Leans into an orbit if one follows on the same target.",
    },
    pause: {
      key: "pause", label: "Pause", kind: "travel", movement: "pause",
      primary_purpose: "TRANSITION", secondary_purposes: ["ESTABLISH"],
      communicates: ["a beat mid-journey"],
      good_for: ["a breath between two moves"],
      usually_avoid_when: ["it would only pad the runtime", "directly before an orbit on another place"],
      scales: [], angle: "either", rarity: "COMMON", duration_bias: 0.8, frames_target: true,
      teaching: "A held beat in the middle of travel. Use sparingly.",
    },
    // ── native Quick Start templates (import-verified, ges-native-derived-v1) ──
    "template:zoom-to": {
      key: "template:zoom-to", label: "Zoom-To (native template)", kind: "template", template: "zoom-to",
      primary_purpose: "LOCATE", secondary_purposes: ["ORIENT", "REVEAL", "EMPHASIZE"],
      communicates: ["context becoming subject", "where this thing is"],
      good_for: ["opening a story with geographic orientation", "revealing where a subject sits inside a larger area"],
      usually_avoid_when: ["the audience already knows where it is", "chained zoom after zoom"],
      scales: ["landmark", "neighborhood", "district", "city", "metro"],
      angle: "oblique_capable", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      target_lock: true,
      teaching: "Google's own context-to-subject move. Locks the camera onto the subject, so it can hold an oblique view of it.",
    },
    "template:orbit": {
      key: "template:orbit", label: "Orbit (native template)", kind: "template", template: "orbit",
      primary_purpose: "INSPECT", secondary_purposes: ["EMPHASIZE", "ESTABLISH"],
      communicates: ["three-dimensional form", "this is the subject"],
      good_for: ["landmarks and buildings whose form matters"],
      usually_avoid_when: ["waypoints", "regions and continents"],
      scales: ["landmark", "neighborhood", "district"],
      angle: "oblique_capable", rarity: "SELECTIVE", duration_bias: 1.0, frames_target: true,
      target_lock: true,
      teaching: "The native orbit, with a live-verified locked camera target.",
    },
    "template:point-to-point": {
      key: "template:point-to-point", label: "Point-to-Point (native template)", kind: "template", template: "point-to-point",
      primary_purpose: "SHOW_ROUTE", secondary_purposes: ["RELATE", "TRAVEL", "COMPARE"],
      communicates: ["relationship", "journey", "sequence", "geographic connection"],
      good_for: ["city A to city B", "chronological journeys", "migration", "trade routes", "chains of events"],
      usually_avoid_when: ["either endpoint is the real subject and needs inspecting", "beyond the two-point evidence scope"],
      scales: ["city", "metro", "region", "country"],
      angle: "top_down", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      teaching: "Geographic clarity over spectacle. The relationship is the shot.",
    },
    "template:spiral": {
      key: "template:spiral", label: "Spiral (native template)", kind: "template", template: "spiral", spiral: true,
      primary_purpose: "REVEAL", secondary_purposes: ["EMPHASIZE", "INSPECT"],
      communicates: ["intensifying attention", "three-dimensional form", "drama"],
      good_for: ["a hero reveal of a compact, distinctive subject"],
      usually_avoid_when: ["ordinary locations", "routes", "regions", "more than once in a sequence"],
      scales: ["landmark", "neighborhood", "district"],
      angle: "oblique_capable", rarity: "SPECIAL", duration_bias: 1.3, frames_target: true,
      teaching: "The native spiral. Special-purpose: it must stay rare to keep meaning.",
    },
    "template:fly-to-and-orbit": {
      key: "template:fly-to-and-orbit", label: "Fly-To-and-Orbit (native template)", kind: "template", template: "fly-to-and-orbit",
      primary_purpose: "ARRIVE", secondary_purposes: ["INSPECT", "EMPHASIZE", "TRAVEL"],
      communicates: ["travel to somewhere important, then examine it"],
      good_for: ["a destination that matters where the arrival is part of the story"],
      usually_avoid_when: ["every waypoint", "the destination is incidental"],
      scales: ["landmark", "neighborhood", "district", "city"],
      angle: "oblique_capable", rarity: "SELECTIVE", duration_bias: 1.2, frames_target: true,
      target_lock: true,
      teaching: "Location and character in one move. Correlate it with destination importance.",
    },
    // ── the globe, as an explicit narrative device ──
    globe_view: {
      key: "globe_view", label: "Whole-globe view", kind: "at", movement: "hold", framing: "globe",
      primary_purpose: "ORIENT", secondary_purposes: ["SHOW_SCALE", "CONCLUDE", "COMPARE"],
      communicates: ["planetary scale", "this is a global story"],
      good_for: ["worldwide phenomena", "intercontinental statements", "global networks", "a deliberate global opening or close"],
      usually_avoid_when: ["the trip is merely long", "a regional journey", "distance is the only reason offered"],
      scales: ["globe"], angle: "top_down", rarity: "SPECIAL", duration_bias: 1.4, frames_target: true,
      requires_globe_justification: true,
      teaching: "Best for stories whose geographic scale is genuinely global. Avoid when the trip is merely long-distance — distance alone is not a reason to show the planet.",
    },
  };

  const AT_CANDIDATES = Object.keys(CAMERA_GRAMMAR).filter((k) => CAMERA_GRAMMAR[k].kind === "at");
  const TRAVEL_CANDIDATES = Object.keys(CAMERA_GRAMMAR).filter((k) => CAMERA_GRAMMAR[k].kind === "travel");
  const TEMPLATE_CANDIDATES = Object.keys(CAMERA_GRAMMAR).filter((k) => CAMERA_GRAMMAR[k].kind === "template");

  // ── Angle semantics ───────────────────────────────────────────────────────
  // Which viewing angle a purpose wants, and what the generator can actually
  // deliver for a given move. Reported honestly rather than faked with tilt.
  const ANGLE_SEMANTICS = {
    top_down: {
      key: "top_down", label: "Top-down / near-top-down",
      communicates: "where things are",
      best_for: ["routes", "borders", "relative location", "country relationships", "city layout", "scale", "spatial explanation"],
    },
    oblique: {
      key: "oblique", label: "Oblique",
      communicates: "what this place physically looks like",
      best_for: ["architecture", "terrain", "mountain form", "skyline", "arrival", "landmark inspection", "visual drama"],
    },
  };

  // ── Scoring ────────────────────────────────────────────────────────────────
  // Every candidate is scored from several weighted factors, never a single
  // `if`, and every factor records WHY it contributed so the result is
  // inspectable. Deterministic: no randomness anywhere.
  const W = {
    purpose: 4.0, scale: 3.0, subject: 2.0, importance: 1.5, angle: 2.5, continuity: 1.5,
    repetition: 3.0, spectacle: 2.0, confusion: 5.0, restraint: 1.5,
  };

  function scaleBand(scale) {
    if (SMALL_SCALES.includes(scale)) return "small";
    if (MID_SCALES.includes(scale)) return "mid";
    if (scale === "globe") return "globe";
    return "large";
  }

  // Is this place a "subject" — a compact, visually distinctive thing whose 3D
  // form can carry a shot — or is it geography, whose meaning is 2D?
  function isSubjectLike(ctx) {
    const band = scaleBand(ctx.scale);
    if (band === "large" || band === "globe") return false;
    if (band === "small") return true;
    return ctx.importance === "HIGH" || ctx.importance === "HERO";
  }

  function scoreCandidate(key, ctx) {
    const g = CAMERA_GRAMMAR[key];
    const parts = [];
    const add = (name, value, why) => { if (value !== 0) parts.push({ name, value: Math.round(value * 1000) / 1000, why }); };
    const purposes = ctx.purposes && ctx.purposes.length ? ctx.purposes : [];
    let hard = null;   // a hard disqualification, reported rather than silently scored away

    // purpose fit
    let pf = 0;
    if (purposes.length) {
      const primaryHit = purposes.includes(g.primary_purpose);
      const secondaryHits = purposes.filter((p) => (g.secondary_purposes || []).includes(p)).length;
      if (primaryHit) pf += 1;
      pf += Math.min(0.5, secondaryHits * 0.25);
      if (!primaryHit && !secondaryHits) pf -= 0.75;
      add("purpose_fit", W.purpose * pf, primaryHit
        ? `its primary purpose is ${g.primary_purpose}, which is what this shot is for`
        : secondaryHits
          ? `it also serves ${purposes.filter((p) => (g.secondary_purposes || []).includes(p)).join(", ")}`
          : `it does not serve ${purposes.join(" or ")}`);
    }

    // scale fit
    if (g.scales && g.scales.length) {
      const ok = g.scales.includes(ctx.scale);
      add("scale_fit", W.scale * (ok ? 1 : -1), ok
        ? `${ctx.scale} framing is within its useful range`
        : `${ctx.scale} framing is outside its useful range (${g.scales.join("/")})`);
      if (!ok && (scaleBand(ctx.scale) === "large" || scaleBand(ctx.scale) === "globe")
          && ["INSPECT", "REVEAL"].includes(g.primary_purpose)) {
        hard = `${g.label} examines a subject; ${ctx.place || "this target"} is ${ctx.scale}-scale geography, which has no form to examine.`;
      }
    }

    // subject fit
    const wantsSubject = ["INSPECT", "REVEAL", "EMPHASIZE"].includes(g.primary_purpose);
    if (wantsSubject) {
      const subj = isSubjectLike(ctx);
      add("subject_fit", W.subject * (subj ? 1 : -1.5), subj
        ? "the target is a compact subject whose form can carry a shot"
        : "the target is geography rather than a subject with form");
    }

    // importance / earned flourish
    const rar = RARITY[g.rarity] || RARITY.COMMON;
    const budget = ctx.flourish_budget == null ? 1 : ctx.flourish_budget;
    if (rar.budget > 0) {
      const earned = budget >= rar.budget;
      add("importance_fit", W.importance * (earned ? 1 : -1.5), earned
        ? `a ${g.rarity.toLowerCase()} move is earned here (${ctx.role || "this role"}, importance ${ctx.importance})`
        : `a ${g.rarity.toLowerCase()} move is not earned by ${ctx.role || "this role"} at importance ${ctx.importance}`);
    }

    // angle fit — including whether the generator can actually deliver it
    const wantAngle = ctx.wanted_angle || "either";
    const canOblique = g.angle === "oblique" || g.angle === "oblique_capable";
    if (wantAngle !== "either") {
      const gives = wantAngle === "oblique" ? canOblique : (g.angle === "top_down" || g.angle === "either");
      add("angle_fit", W.angle * (gives ? 1 : -1), gives
        ? `it gives the ${wantAngle.replace("_", "-")} view this purpose wants`
        : `this purpose wants a ${wantAngle.replace("_", "-")} view and it gives ${g.angle.replace("_", "-")}`);
    }
    if (wantAngle === "oblique" && canOblique && g.frames_target === false) {
      add("confusion_penalty", -W.confusion * 0.5,
        `${g.label} is oblique but points past its target rather than at it, so the place itself is not in shot`);
    }

    // continuity
    const prev = ctx.previous;
    if (prev) {
      if (prev.key === key && !g.functional) {
        add("repetition_penalty", -W.repetition, `the previous shot was already ${g.label}`);
      } else if (prev.grammar && prev.grammar.primary_purpose === g.primary_purpose && rar.budget > 0 && !g.functional) {
        add("repetition_penalty", -W.repetition * 0.4, `the previous shot already served ${g.primary_purpose}`);
      }
      if (prev.grammar && prev.grammar.angle === "oblique" && g.angle === "top_down" && purposes.includes("SHOW_ROUTE")) {
        add("continuity_fit", W.continuity * 0.5, "flattening out of an oblique shot suits a route explanation");
      }
    }
    const priorUses = (ctx.used_counts && ctx.used_counts[key]) || 0;
    if (priorUses > 0 && rar.budget > 0 && !g.functional) {
      add("repetition_penalty", -W.repetition * 0.6 * priorUses,
        `${g.label} has already been used ${priorUses} time${priorUses === 1 ? "" : "s"} in this sequence`);
    }

    // spectacle — a special move used constantly stops being special
    if (rar.spectacle > 0) {
      const spent = ctx.spectacle_spent || 0;
      add("spectacle_penalty", -W.spectacle * rar.spectacle * 0.25 * (1 + spent),
        spent > 0
          ? `${g.rarity.toLowerCase()} moves have already been spent in this sequence`
          : `${g.label} is a ${g.rarity.toLowerCase()} move and should stay uncommon`);
    }

    // dwell economy — a longer variant of the same move must be earned
    if ((g.duration_bias || 1) !== 1) {
      const imp = IMPORTANCE[ctx.importance] || IMPORTANCE.NORMAL;
      const extra = g.duration_bias - 1;
      // The reward saturates: importance justifies a longer dwell, not an
      // unbounded one. Anything beyond ~30% longer is pure runtime and is charged.
      const rewarded = Math.min(Math.max(extra, -1), 0.3);
      const excess = Math.max(0, extra - 0.3);
      const v = W.restraint * rewarded * ((imp.weight - 1.0) * 3 - 0.25) - W.restraint * excess;
      add("dwell_fit", v, v >= 0
        ? `its longer dwell is justified at importance ${ctx.importance}`
        : (excess > 0
          ? `it runs ${Math.round(extra * 100)}% longer than the base move, which is more screen time than the shot needs`
          : `it costs more screen time than importance ${ctx.importance} justifies`));
    }

    // restraint — do not move while the viewer needs to read geography
    const wantMotion = ctx.wanted_motion || "moderate";
    const moveIsBusy = rar.budget > 0 || g.duration_bias > 1.15;
    if (wantMotion === "low" && moveIsBusy) {
      add("restraint_penalty", -W.restraint, "this shot needs stillness so the geography can be read");
    }

    // legibility of the crossing: a long leg flown low sweeps the ground past
    // faster than the viewer can read, which the operator ruled out by default
    if (g.cruise && ctx.distance_m != null && ctx.distance_m > 1000) {
      const J = loadJourney();
      const planner = loadPlanner();
      const alt = styleCruiseAltitudeM(g, ctx, { planner, journey: J });
      // Use the duration the journey will ACTUALLY produce: the paced one. The
      // unpaced baseline is ~26% shorter at calm pace, which was enough to push a
      // legible shape just over the limit at the boundary.
      const paces = J.PACE_PRESETS || {};
      const paceFactor = (paces[ctx.pace] || paces[J.DEFAULT_PACE] || { factor: 1 }).factor;
      const seconds = planner.defaultDuration("fly_to", { distanceM: ctx.distance_m }) * paceFactor;
      const tilt = g.cruise === "destination_closer" ? 72 : 0;
      const fw = J.screenSpeedFrameWidths(ctx.distance_m, seconds, alt, tilt, { planner });
      const limit = J.READABLE_SCREEN_SPEED_FW_PER_S;
      if (fw > limit) {
        add("confusion_penalty", -W.confusion * Math.min(3, fw / limit),
          `${g.label} would cross ${Math.round(ctx.distance_m / 1000)} km at about ${Math.round(alt / 1000)} km up, sweeping the ground past ${Math.round(fw * 10) / 10} frame-widths per second — too fast to read the locations`);
      } else {
        add("readability_fit", W.confusion * 0.25,
          `at about ${Math.round(alt / 1000)} km up the ground reads at ${Math.round(fw * 100) / 100} frame-widths per second`);
      }
    }

    // ceremony must be proportional to the distance actually travelled
    const ceremonial = g.style === "cinematic" || g.style === "high_transit" || g.useTransitAltitude;
    if (ceremonial && ctx.distance_m != null && ctx.distance_m < SHORT_LEG_M) {
      add("confusion_penalty", -W.confusion,
        `${g.label} climbs away from the subject and back for a ${Math.max(1, Math.round(ctx.distance_m / 1000))} km move — altitude the geography does not justify`);
    }

    // geographic confusion
    if (purposes.includes("SHOW_ROUTE") && canOblique && g.frames_target === false) {
      add("confusion_penalty", -W.confusion * 0.6, "an oblique horizon view makes a route harder to follow");
    }
    // A spiral is an open-ended move: it keeps closing in rather than settling.
    // Arriving somewhere specific is the opposite — the subject IS the endpoint,
    // so the camera should circle it.
    if (g.spiral && ctx.is_arrival) {
      hard = `${g.label} is an open-ended move — it keeps closing in rather than settling on anything. ${ctx.place || "This place"} is the endpoint the camera travelled to, so it should be circled instead.`;
    }
    if (g.requires_globe_justification && !ctx.globe_justification) {
      hard = "Showing the whole planet needs a genuinely global reason. Distance alone is not one.";
    }
    if (g.template && ctx.templates_allowed === false) {
      hard = `${g.label} needs explicit native-template parameters, which are not available here.`;
    }
    // Explicit operator grammar wins over inference: when the operator names a
    // movement ("orbit the Colosseum", "move directly to Berlin"), every other
    // candidate is disqualified. Provenance: user-specified beats inferred.
    if (ctx.explicit_grammar && key !== ctx.explicit_grammar) {
      hard = `the operator explicitly asked for ${(CAMERA_GRAMMAR[ctx.explicit_grammar] || {}).label || ctx.explicit_grammar}`;
    }
    if (ctx.explicit_style && key !== ctx.explicit_style) {
      hard = `the operator explicitly asked for ${(CAMERA_GRAMMAR[ctx.explicit_style] || {}).label || ctx.explicit_style.replace("style:", "")} travel`;
    }
    // Explicit style is authoritative UNLESS the shape it asks for cannot stay
    // readable in editorial time — the legibility doctrine outranks it, and the
    // override is always explained in the direction record, never silent.
    if (!hard && ctx.explicit_style && key === ctx.explicit_style
        && Number.isFinite(ctx.distance_m) && ctx.distance_m > 1000 && g.cruise) {
      const Jl = loadJourney();
      const Pl = loadPlanner();
      if (Jl.readableTransitAltitudeM) {
        const tilt = g.cruise === "destination_closer" ? 72 : 0;
        const maxT = 30;
        const floor = Jl.readableTransitAltitudeM(ctx.distance_m, maxT, tilt, { planner: Pl });
        const cruiseAlt = styleCruiseAltitudeM(g, ctx, { planner: Pl, journey: Jl });
        if (!Number.isFinite(floor) || floor > Math.max(cruiseAlt * 1.001, Pl.SPACE_ALTITUDE_M * 0.95)) {
          hard = `the legibility doctrine outranks the explicit request: ${Math.round(ctx.distance_m / 1000)} km cannot be read from the altitude ${g.label} crosses at within ${maxT} seconds`;
        }
      }
    }
    // Negative directions are hard constraints — the Director does not argue.
    const negs = ctx.negatives || [];
    if (!hard && negs.includes("orbit") && /orbit/i.test(g.movement || key)) {
      hard = "the operator ruled out orbits";
    }
    if (!hard && negs.includes("spiral") && g.spiral) {
      hard = "the operator ruled out spirals";
    }
    if (!hard && negs.includes("globe") && g.requires_globe_justification) {
      hard = "the operator ruled out globe views";
    }
    if (!hard && negs.includes("high_transit") && key === "style:high_transit") {
      hard = "the operator ruled out high transit";
    }
    // Orbit restraint: a circle must be EARNED — by stated inspection intent, by
    // an explicitly assigned role, or by hero importance. An ordinary
    // destination that merely ends a travel sentence gets a settle, not a
    // circle: orbiting every arrival is how generated animation reveals itself.
    if (!hard && !ctx.explicit_grammar && /orbit/i.test(key) && ctx.slot === "at") {
      const earned = ctx.purposes_explicit || ctx.role_explicit || ctx.importance === "HERO";
      if (!earned) {
        hard = "an orbit must be earned — by stated inspection intent, an assigned role, or hero importance. A plain arrival settles instead of circling.";
      }
    }

    const total = parts.reduce((a, p) => a + p.value, 0);
    return {
      key, label: g.label, grammar: g, score: Math.round(total * 1000) / 1000,
      components: parts, disqualified: hard, rarity: g.rarity,
    };
  }

  // ── Globe rule — the distinction the whole layer exists to make ────────────
  // "long distance" and "global scale is narratively important" are NOT the same
  // thing. A globe shot needs a declared narrative reason; the distance test only
  // stops a declared reason from being applied to a journey too small to read.
  function globeDecision(ctx = {}) {
    const justification = ctx.globe_justification || null;
    const spanM = Number.isFinite(ctx.journey_span_m) ? ctx.journey_span_m : null;
    if (!justification) {
      return {
        allowed: false, justification: null,
        reason: spanM && spanM >= INTERCONTINENTAL_DISTANCE_M
          ? `This journey is long (${Math.round(spanM / 1000).toLocaleString("en-US")} km), but distance alone is not a reason to show the planet. Declare a global reason (${Object.keys(GLOBE_JUSTIFICATIONS).join(", ")}) if the story is genuinely global.`
          : "Showing the whole planet would exaggerate the geographic scale without adding useful information. No global narrative reason was given.",
      };
    }
    if (!GLOBE_JUSTIFICATIONS[justification]) {
      return { allowed: false, justification: null, reason: `"${justification}" is not a recognised global reason.` };
    }
    const needsSpan = ["INTERCONTINENTAL_SCALE", "PLANETARY_COMPARISON"].includes(justification);
    if (needsSpan && spanM !== null && spanM < INTERCONTINENTAL_DISTANCE_M) {
      return {
        allowed: false, justification,
        reason: `${justification} was declared, but this journey spans only ${Math.round(spanM / 1000).toLocaleString("en-US")} km — not an intercontinental distance, so the planet would overstate it.`,
      };
    }
    return {
      allowed: true, justification,
      reason: `Global scale is narratively justified: ${GLOBE_JUSTIFICATIONS[justification].blurb}.`,
    };
  }

  // ── Recommendation ────────────────────────────────────────────────────────
  function normalizeContext(raw = {}) {
    const role = LOCATION_ROLES[raw.role] ? raw.role : null;
    const roleDef = role ? LOCATION_ROLES[role] : null;
    const importance = IMPORTANCE[raw.importance] ? raw.importance
      : (roleDef ? roleDef.importance : "NORMAL");
    const purposes = (Array.isArray(raw.purposes) && raw.purposes.length
      ? raw.purposes
      : (roleDef ? roleDef.purposes : ["ESTABLISH"])).filter((p) => SHOT_PURPOSES[p]);
    const primary = SHOT_PURPOSES[purposes[0]] || SHOT_PURPOSES.ESTABLISH;
    const flourish = Math.min(
      (roleDef ? roleDef.flourish : 1),
      IMPORTANCE[importance].flourish
    );
    return {
      slot: raw.slot === "travel" ? "travel" : "at",
      role, importance, purposes,
      scale: raw.scale || "city",
      place: raw.place || null,
      wanted_angle: raw.wanted_angle || primary.angle,
      wanted_motion: raw.wanted_motion || primary.motion,
      flourish_budget: raw.flourish_budget == null ? flourish : raw.flourish_budget,
      spectacle_spent: raw.spectacle_spent || 0,
      used_counts: raw.used_counts || {},
      previous: raw.previous || null,
      distance_m: Number.isFinite(raw.distance_m) ? raw.distance_m : null,
      origin_scale: raw.origin_scale || null,
      pace: raw.pace || null,   // null = the journey's own pace (resolved via the journey module)
      journey_span_m: Number.isFinite(raw.journey_span_m) ? raw.journey_span_m : null,
      globe_justification: raw.globe_justification || null,
      templates_allowed: raw.templates_allowed !== false,
      is_final: !!raw.is_final,
      // true when the camera TRAVELLED to this place: it is an endpoint, not an
      // open-ended subject to keep closing in on.
      is_arrival: !!raw.is_arrival,
      // Explicit operator language, threaded from autoDirect: authoritative
      // grammar/style choices and hard negative constraints.
      explicit_grammar: raw.explicit_grammar || null,
      explicit_style: raw.explicit_style || null,
      negatives: Array.isArray(raw.negatives) ? raw.negatives : [],
      terrain_morphology: raw.terrain_morphology || null,
      morphology_source: raw.morphology_source || null,
      terrain_altitude_m: Number.isFinite(raw.terrain_altitude_m) ? raw.terrain_altitude_m : null,
      terrain_min_altitude_m: Number.isFinite(raw.terrain_min_altitude_m) ? raw.terrain_min_altitude_m : null,
      // The declared focal point's own terrain elevation (null = undeclared;
      // 0 is a real waterline). The complete-pose authority derives the camera
      // altitude from it, so it travels with the rest of the terrain context.
      target_elevation_m: Number.isFinite(raw.target_elevation_m) ? raw.target_elevation_m : null,
      // Whether the operator actually stated purposes/role (as opposed to the
      // Director inferring them from position) — earned-intent evidence for the
      // orbit-restraint rule. Direct recommend()/scoreCandidate() callers state
      // their context explicitly, so an unspecified flag defaults to "stated"
      // whenever the field itself is present; autoDirect overrides it with the
      // parsed-intent provenance.
      purposes_explicit: raw.purposes_explicit == null
        ? !!(Array.isArray(raw.purposes) && raw.purposes.length) : !!raw.purposes_explicit,
      role_explicit: raw.role_explicit == null ? !!raw.role : !!raw.role_explicit,
    };
  }

  function recommend(rawCtx = {}) {
    const ctx = normalizeContext(rawCtx);
    const pool = ctx.slot === "travel"
      ? TRAVEL_CANDIDATES.concat(TEMPLATE_CANDIDATES.filter((k) => ["template:point-to-point", "template:fly-to-and-orbit"].includes(k)))
      : AT_CANDIDATES.concat(TEMPLATE_CANDIDATES.filter((k) => k !== "template:point-to-point"));
    const scored = pool.map((k) => scoreCandidate(k, ctx));
    const viable = scored.filter((s) => !s.disqualified).sort((a, b) => b.score - a.score);
    const rejected = scored.filter((s) => s.disqualified)
      .map((s) => ({ key: s.key, label: s.label, reason: s.disqualified }));
    const top = viable[0] || null;
    return {
      context: ctx,
      recommended: top ? decisionOf(top, ctx) : null,
      alternatives: viable.slice(1, 4).map((s) => decisionOf(s, ctx)),
      rejected,
      globe: globeDecision(ctx),
    };
  }

  // A decision carries its own explanation, in operator language.
  function decisionOf(s, ctx) {
    const g = s.grammar;
    const positives = s.components.filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
    const negatives = s.components.filter((c) => c.value < 0).sort((a, b) => a.value - b.value);
    const purpose = ctx.purposes[0] || g.primary_purpose;
    const why = [];
    if (positives.length) why.push(positives[0].why);
    if (positives.length > 1) why.push(positives[1].why);
    if (!why.length) why.push(`it is the least unsuitable option for ${purpose}`);
    const terrainPolicy = ctx.purposes.includes("SHOW_TERRAIN")
      && ["orbit", "slow_orbit", "orbit_twice", "half_orbit"].includes(g.movement)
      ? loadTerrainMorphology().terrainTiltDecision({
        terrain_morphology: ctx.terrain_morphology,
        morphology_source: ctx.morphology_source,
        altitude_m: ctx.terrain_altitude_m,
        min_altitude_m: ctx.terrain_min_altitude_m,
        target_elevation_m: ctx.target_elevation_m,
      }) : null;
    return {
      key: s.key, label: g.label, kind: g.kind,
      movement: g.movement || null, template: g.template || null, framing: g.framing || null,
      ...(terrainPolicy ? {
        tilt_deg: terrainPolicy.final_tilt_deg,
        altitude_m: terrainPolicy.altitude_m,
        tilt_reason: terrainPolicy.explanation,
        terrain_policy: terrainPolicy,
      } : {}),
      purpose, purpose_label: (SHOT_PURPOSES[purpose] || {}).label || purpose,
      viewer_should_understand: (SHOT_PURPOSES[purpose] || {}).viewer_should_understand || null,
      angle: g.angle, rarity: g.rarity, communicates: g.communicates,
      score: s.score, components: s.components,
      emphasis: Math.round(dwellFor(ctx, g) * 100) / 100,
      why: why.join(" "),
      caveats: negatives.map((c) => c.why),
      teaching: g.teaching,
    };
  }

  // ── Duration: physical baseline stays, direction biases it ────────────────
  // The journey model's magnitude-scaled suggestion (validated against real
  // playback) remains the physical baseline. This is only a multiplier over it,
  // driven by narrative importance, purpose and role.
  function dwellFor(ctx, g) {
    const role = ctx.role ? LOCATION_ROLES[ctx.role] : null;
    const purpose = SHOT_PURPOSES[ctx.purposes[0]] || SHOT_PURPOSES.ESTABLISH;
    // Averaged, not multiplied: three factors pointing the same way must not
    // triple a duration. The movement's own duration_bias is deliberately NOT
    // included — the journey model's paceStretch already encodes "slow" variants,
    // and counting it twice is what produced a 68-second city orbit.
    const deltas = [
      (role ? role.dwell : 1) - 1,
      IMPORTANCE[ctx.importance].dwell - 1,
      purpose.dwell - 1,
    ];
    const e = 1 + 0.5 * deltas.reduce((a, b) => a + b, 0);
    return Math.max(0.75, Math.min(1.4, e));
  }

  // ── Editorial travel duration: screen time, not kilometres ───────────────
  // Map animation COMPRESSES geography: a 7,800 km flight is not ten times
  // more interesting than a 780 km one, and a viewer cannot usefully watch
  // thirty seconds of crossing. The physical baseline (planner.defaultDuration,
  // distance-proportional) stays authoritative wherever the operator or a test
  // sets durations explicitly; this is the Director's own pacing for the legs it
  // invents. Log-compressed above a local floor, capped at 15 s, and scaled by
  // pace RELATIVE to calm so "calm" never silently means "slow":
  //   ~80 km   ->  5 s      ~400 km  ->  9 s
  //   ~600 km  -> 10 s      ~7,800 km -> 15 s (cap, was 34 s)
  // Readability is preserved by composition, not runtime: the journey model's
  // legibility floor raises the transit altitude when a compressed crossing
  // would smear the ground.
  function editorialTravelSeconds(distanceM, paceKey) {
    const km = Number.isFinite(distanceM) ? Math.max(0, distanceM) / 1000 : null;
    const J = loadJourney();
    const paces = J.PACE_PRESETS || {};
    const calmFactor = (paces[J.DEFAULT_PACE] || { factor: 1 }).factor || 1;
    const pf = ((paces[paceKey] || paces[J.DEFAULT_PACE] || { factor: 1 }).factor || 1) / calmFactor;
    let base;
    if (km == null) base = 6;
    else if (km < 150) base = 5;
    else base = Math.min(15, Math.round(4 + 2.2 * Math.log(km / 50)));
    return Math.max(3, Math.round(base * pf * 10) / 10);
  }
  // How an editorial leg total is distributed over a travel style's steps.
  // The crossing carries most of the time; the climb and descent share the rest.
  const TRAVEL_STEP_WEIGHTS = {
    direct: { fly: 1 },
    cinematic: { pull_back: 0.2, cruise: 0.6, descend: 0.2 },
    high_transit: { climb_to_transit: 0.2, cruise: 0.6, descend: 0.2 },
    low_approach: { fly_low: 1 },
    custom: { fly: 1 },
  };
  function editorialTravelSteps(styleKey, distanceM, paceKey, scaleCtx = {}) {
    const g = TRAVEL_STYLE_GRAMMAR[styleKey];
    if (!g) return [];
    const total = editorialTravelSeconds(distanceM, paceKey);
    const weights = TRAVEL_STEP_WEIGHTS[g.style] || {};
    const steps = g.steps.map((s) => ({
      type: s,
      duration_seconds: Math.max(1, Math.round(total * (weights[s] != null ? weights[s] : 1 / g.steps.length) * 10) / 10),
    }));
    // Legibility: the crossing duration must fit the shape the style actually
    // produces. The journey model's legibility floor raises transit altitude to
    // the exact readable boundary — fw exactly AT the limit, which the
    // validator rounds into a warning. So solve numerically for the shortest
    // crossing time at which the floor altitude drops to (or below) the
    // altitude this style cruises at; then the leg crosses at its own altitude
    // with the ground sweeping past under the readable limit. Readability beats
    // runtime: the crossing may exceed the editorial cap when the geography
    // demands it, but nothing else does.
    const J = loadJourney();
    const planner = loadPlanner();
    const crossing = steps.find((s) => (J.MOVEMENTS[s.type] || {}).travelsToDestination);
    if (crossing && Number.isFinite(distanceM) && distanceM > 1000
        && J.readableTransitAltitudeM && g.cruise) {
      const tilt = g.cruise === "destination_closer" ? 72 : 0;
      const cruiseAlt = styleCruiseAltitudeM(g, { distance_m: distanceM, scale: scaleCtx.scale, origin_scale: scaleCtx.origin_scale }, { planner, journey: J });
      let t = crossing.duration_seconds;
      while (t < 30) {
        const floor = J.readableTransitAltitudeM(distanceM, t, tilt, { planner });
        if (Number.isFinite(floor) && floor <= cruiseAlt * 1.001) break;
        t += 0.5;
      }
      crossing.duration_seconds = Math.round(Math.min(t, 30) * 10) / 10;
    }
    return steps;
  }

  // ── Travel STYLES as directorial units ────────────────────────────────────
  // A travel leg is a shape, not a single movement. These are the shapes the
  // journey model already builds; giving them grammar lets one scoring path
  // choose between "just get there" and "shape the arrival".
  const TRAVEL_STYLE_GRAMMAR = {
    "style:direct": {
      key: "style:direct", label: "Direct Fly-To", kind: "travel_style", style: "direct", steps: ["fly"],
      primary_purpose: "TRAVEL", secondary_purposes: ["SHOW_ROUTE", "TRANSITION", "RELATE"],
      communicates: ["we are going there", "the geography between"],
      good_for: ["route legs", "waypoint chains", "when the destination speaks for itself"],
      usually_avoid_when: ["the arrival is a story beat that deserves shaping"],
      scales: [], angle: "top_down", rarity: "COMMON", duration_bias: 1.0, frames_target: true,
      cruise: "destination_framing",
      teaching: "One clean flight. The default on a short leg — but it crosses at the destination's own framing altitude, which is too low to read on a long one.",
    },
    "style:cinematic": {
      key: "style:cinematic", label: "Cinematic (pull back, travel, descend)", kind: "travel_style", style: "cinematic",
      steps: ["pull_back", "cruise", "descend"],
      primary_purpose: "ARRIVE", secondary_purposes: ["EMPHASIZE", "TRAVEL", "SHOW_SCALE"],
      communicates: ["a departure and an arrival that matter"],
      good_for: ["reaching a destination that is part of the story", "a primary subject or hero city"],
      usually_avoid_when: ["every leg of a route", "a short hop", "a low-importance waypoint"],
      scales: [], angle: "top_down", rarity: "SELECTIVE", duration_bias: 1.15, frames_target: true,
      cruise: "origin_widened",
      teaching: "Three beats instead of one. Spend it where the arrival is the point.",
    },
    "style:high_transit": {
      key: "style:high_transit", label: "High Transit", kind: "travel_style", style: "high_transit",
      // climb, then CROSS at that altitude, then descend. Crossing with `fly`
      // instead of `cruise` descends while travelling, so the ground still sweeps
      // past too fast to read — the whole point of climbing is lost.
      steps: ["climb_to_transit", "cruise", "descend"],
      primary_purpose: "SHOW_ROUTE", secondary_purposes: ["SHOW_SCALE", "RELATE", "TRAVEL"],
      communicates: ["the whole route at once", "distance as information"],
      good_for: ["legs where seeing both ends is the point", "long-distance relationships"],
      usually_avoid_when: ["short legs", "when the endpoints matter more than the path"],
      scales: [], angle: "top_down", rarity: "SELECTIVE", duration_bias: 1.1, frames_target: true,
      cruise: "route_framing", functional: true,
      teaching: "Climbs so the route reads end to end. The right answer whenever the leg is long — the climb is there so the locations stay legible, not for effect.",
    },
    "style:low_approach": {
      key: "style:low_approach", label: "Low Approach", kind: "travel_style", style: "low_approach",
      steps: ["fly_low"],
      primary_purpose: "SHOW_TERRAIN", secondary_purposes: ["REVEAL", "ARRIVE"],
      communicates: ["the shape of the land on the way in"],
      good_for: ["a short final run-in", "terrain right in front of the camera", "a dramatic last few kilometres"],
      usually_avoid_when: ["any long crossing — it stays low, so the ground sweeps past too fast to read", "route explanations", "flat ground", "when orientation matters"],
      scales: ["neighborhood", "district", "city", "metro", "region"],
      angle: "oblique", rarity: "SELECTIVE", duration_bias: 1.15, frames_target: false,
      cruise: "destination_closer",
      teaching: "Tilted toward the horizon the whole way. Terrain over orientation — and only over a short run-in, since it stays low.",
    },
  };
  Object.assign(CAMERA_GRAMMAR, TRAVEL_STYLE_GRAMMAR);
  const TRAVEL_STYLE_CANDIDATES = Object.keys(TRAVEL_STYLE_GRAMMAR);

  // A leg short enough that climbing away from it and back is unmotivated: the
  // camera would leave the subject's own city to travel four kilometres.
  const SHORT_LEG_M = 50000;

  // Where a travel style actually cruises. Readability depends on this: a style
  // that crosses at the destination's own framing altitude is low, and a long leg
  // flown low is exactly the "image changes too fast to understand" case.
  function styleCruiseAltitudeM(g, ctx, options = {}) {
    const J = loadJourney(options.journey);
    const planner = loadPlanner(options.planner);
    const destScale = ctx.scale || "city";
    const originScale = ctx.origin_scale || destScale;
    const tilt = 0;   // target-framing crossings are top-down
    switch (g.cruise) {
      case "route_framing":
        return J.transitAltitudeM(ctx.distance_m, tilt, J.framingAltitudeM(destScale, tilt, { planner }), { planner });
      case "origin_widened":
        return J.framingAltitudeM(J.stepScale(originScale, +1), tilt, { planner });
      case "destination_closer":
        return J.framingAltitudeM(J.stepScale(destScale, -1), 72, { planner });
      case "destination_framing":
      default:
        return J.framingAltitudeM(destScale, tilt, { planner });
    }
  }

  // ── Restraint: a journey-level budget for visual specialness ───────────────
  // Quality is not proportional to the number of camera moves. A sequence earns
  // a small amount of flourish from how many places genuinely matter, and spends
  // it; once spent, selective and special moves are actively discouraged.
  function flourishBudgetFor(stops) {
    const highs = stops.filter((s) => s.importance === "HIGH").length;
    const heroes = stops.filter((s) => s.importance === "HERO").length;
    return Math.min(6, 1 + highs + heroes * 2);
  }

  // Editorial orbit span: a director-added orbit is a RESTRAINED arc by
  // default. A full revolution needs an earned reason — the operator asking
  // for one, hero importance, or stated inspection/emphasis intent. Anything
  // else is an arrival that circles once "because orbits are available".
  function orbitRevolutionsFor(dec, stop) {
    if (!dec || !/orbit/i.test(dec.movement || "")) return null;
    const full = stop.explicit_grammar || stop.importance === "HERO"
      || (stop.purposes_explicit && (stop.purposes || []).some((p) => ["INSPECT", "EMPHASIZE", "REVEAL"].includes(p)));
    return full ? null : 0.5;
  }

  // ── Auto-direct: structured intent -> an intentional journey ───────────────
  // What a decision writes into the journey as camera altitude. A declared
  // terrain focal point's altitude is DERIVED by the complete-pose authority
  // wherever the journey is compiled or planned, so the director does not
  // serialize that derived number as if it were authored: under explicit
  // operator authority (policy B) an authored altitude is honoured verbatim, so
  // a frozen journey must not carry yesterday's derivation as today's authored
  // value — AUTO stays AUTO and re-derives.
  // The decision itself keeps `altitude_m` and `terrain_policy` as provenance.
  function journeyAltitudeFor(dec) {
    if (!dec) return null;
    if (dec.terrain_policy && dec.terrain_policy.target_elevation_declared) return null;
    return dec.altitude_m || null;
  }

  function autoDirect(intent = {}, options = {}) {
    const J = loadJourney(options.journey);
    const planner = loadPlanner(options.planner);
    const stops = (Array.isArray(intent.stops) ? intent.stops : []).map((raw, i) => {
      const src = typeof raw === "string" ? { location: raw } : (raw || {});
      const role = LOCATION_ROLES[src.role] ? src.role
        : (i === 0 ? "STARTING_CONTEXT" : (i === (intent.stops || []).length - 1 ? "DESTINATION" : "WAYPOINT"));
      // A role the operator (or parser) actually assigned, not one inferred from
      // stop position. Inferred roles are defaults; stated roles are intent.
      const role_explicit = !!src.role;
      const roleDef = LOCATION_ROLES[role];
      const resolved = src.location ? planner.resolveLocation(src.location) : null;
      const classified = resolved || src.location
        ? J.classifyScale(resolved, src.location) : { scale: "city", source: "assumed_city" };
      return {
        location: src.location || "",
        role,
        role_explicit,
        importance: IMPORTANCE[src.importance] ? src.importance : roleDef.importance,
        purposes: (Array.isArray(src.purposes) && src.purposes.length ? src.purposes : roleDef.purposes)
          .filter((p) => SHOT_PURPOSES[p]),
        // Purposes the OPERATOR stated are full intent; purposes inherited from
        // a role definition are defaults. The distinction decides what an
        // arrival orbit needs as justification (see the arrival-restraint rule).
        purposes_explicit: Array.isArray(src.purposes) && src.purposes.length > 0,
        // Explicit camera language from parseIntent (or structured input) is
        // authoritative — it wins over inferred direction below.
        explicit_grammar: src.explicit_grammar || src.grammar || null,
        explicit_travel_style: src.explicit_travel_style || src.travel_style || null,
        framing: src.framing || "auto",
        scale: src.framing && src.framing !== "auto" ? src.framing : classified.scale,
        resolved,
      };
    });
    if (!stops.length) throw new Error("autoDirect needs at least one stop");

    // total span drives the globe test: a declared global reason still has to be
    // applied to a journey big enough for the planet to mean anything.
    let spanM = 0;
    for (let i = 1; i < stops.length; i += 1) {
      if (stops[i].resolved && stops[i - 1].resolved) {
        spanM += planner.haversineMeters(stops[i - 1].resolved, stops[i].resolved);
      }
    }
    const globe = globeDecision({ globe_justification: intent.globe_justification, journey_span_m: spanM });

    let budget = flourishBudgetFor(stops);
    let spectacleSpent = 0;
    const used = {};
    const decisions = [];
    let previous = null;
    // Comparison-group state. Declared before the opening shot so an opening
    // COMPARISON_LOCATION can anchor the group's grammar mirror.
    let compareAnchorDecision = null;
    let compareEmphasis = null;

    const spend = (dec) => {
      const g = CAMERA_GRAMMAR[dec.key] || {};
      const rar = RARITY[dec.rarity] || RARITY.COMMON;
      // A functional move (a climb whose only job is legibility) is not ceremony
      // and does not draw down the flourish budget.
      if (!g.functional) {
        budget = Math.max(0, budget - rar.budget);
        if (rar.spectacle > 0) spectacleSpent += 1;
      }
      used[dec.key] = (used[dec.key] || 0) + 1;
      previous = { key: dec.key, grammar: CAMERA_GRAMMAR[dec.key] };
    };

    // ── continuation: pick up exactly where a previous animation ended ──────
    // The continuation state is the EXACT terminal camera of the source
    // animation (earth-studio-journey.js continuationStateFromPlan) — never an
    // approximation. The Director treats the hand-over as its own beat: settle
    // briefly on the carried state, because an orbit right at the cut would
    // slide sideways onto its ring (the journey validator warns the same).
    const continuationState = intent.continuation_from || null;
    if (continuationState) {
      const J2 = loadJourney(options.journey);
      const continuationCheck = J2.validateContinuationState(continuationState);
      if (!continuationCheck.ok) throw new Error(`continuation state rejected: ${continuationCheck.errors[0]}`);
      // "Continue from my previous animation and fly to X" names ONE place —
      // the destination, not an anchor. Give the carried camera an anchor stop
      // so the named place becomes a real travel leg instead of a lone hold.
      if (stops.length === 1) {
        const label = (continuationState.target && continuationState.target.name) || stops[0].location;
        const resolved = planner.resolveLocation(label);
        const classified = resolved ? J.classifyScale(resolved, label) : { scale: "city", source: "assumed_city" };
        stops.unshift({
          location: label, role: "GEOGRAPHIC_CONTEXT", importance: "NORMAL",
          purposes: ["CONTINUE"], framing: "auto", scale: classified.scale, resolved,
        });
      }
    }

    // ── opening shot at the first stop ──
    const first = stops[0];
    let openDec = null;
    let opening = null;
    if (continuationState) {
      const contLabel = (continuationState.target && continuationState.target.name) || first.location;
      openDec = decisionOf(scoreCandidate("hold", normalizeContext({
        slot: "at", role: "GEOGRAPHIC_CONTEXT", importance: "NORMAL", purposes: ["CONTINUE"],
        scale: first.scale, place: contLabel,
        flourish_budget: 0, spectacle_spent: spectacleSpent, used_counts: used, previous,
      })), normalizeContext({ slot: "at", purposes: ["CONTINUE"], scale: first.scale }));
      openDec.purpose = "CONTINUE";
      openDec.purpose_label = SHOT_PURPOSES.CONTINUE.label;
      openDec.viewer_should_understand = SHOT_PURPOSES.CONTINUE.viewer_should_understand;
      openDec.why = "the camera picks up the exact terminal state of the previous animation; a brief settle makes the join seamless instead of sliding onto a ring at the cut";
      decisions.push({ stop: 0, kind: "at", place: contLabel, role: "GEOGRAPHIC_CONTEXT", importance: "NORMAL", decision: openDec, alternatives: [], rejected: [], continuation: true });
      spend(openDec);
    } else {
      const openCtx = {
        slot: "at", role: first.role, importance: first.importance, purposes: first.purposes,
        scale: first.scale, place: first.location, flourish_budget: Math.min(budget, IMPORTANCE[first.importance].flourish),
        spectacle_spent: spectacleSpent, used_counts: used, previous,
        journey_span_m: spanM, globe_justification: globe.allowed ? globe.justification : null,
        templates_allowed: options.templates_allowed !== false,
        explicit_grammar: first.explicit_grammar, negatives: intent.negatives || [],
        purposes_explicit: first.purposes_explicit, role_explicit: first.role_explicit,
        terrain_morphology: first.resolved && first.resolved.terrain_morphology,
        morphology_source: first.resolved && first.resolved.morphology_source,
        terrain_altitude_m: first.resolved && first.resolved.altitude_m,
        terrain_min_altitude_m: first.resolved && first.resolved.min_altitude_m,
        target_elevation_m: first.resolved && first.resolved.target_elevation_m,
      };
      opening = recommend(openCtx);
      openDec = opening.recommended;

      // ── Subject-aware opening OBLIQUITY and visual presence ──────────────
      // A centered hold frames its subject only near-nadir (the generator's
      // optical limit), which is exactly the "Google Maps rotated" look. When
      // the opening place is a compact subject whose purpose wants form, the
      // opening is promoted to a half-orbit RING opening — the only engine
      // geometry that keeps the subject framed at an oblique tilt, stable from
      // frame 0. Policy order: editorial purpose -> subject class/scale ->
      // geometry/evidence -> movement context -> camera configuration; an
      // explicit operator tilt outranks the automatic bands. Runs BEFORE
      // decisions.push/spend so the SELECTIVE cost is accounted exactly and
      // every later beat scores against the true remaining budget.
      let openingObliquity = null;
      if (openDec && !continuationState) {
        const OCO = loadComposition(options.composition);
        const explicitOpening = intent.opening || null;
        const terrainOpeningPolicy = first.purposes.includes("SHOW_TERRAIN")
          ? loadTerrainMorphology().terrainTiltDecision({
            terrain_morphology: first.resolved && first.resolved.terrain_morphology,
            morphology_source: first.resolved && first.resolved.morphology_source,
            altitude_m: first.resolved && first.resolved.altitude_m,
            min_altitude_m: first.resolved && first.resolved.min_altitude_m,
            target_elevation_m: first.resolved && first.resolved.target_elevation_m,
          }) : null;
        openingObliquity = OCO.planOpeningObliquity({
          opening_beat: openDec.movement,
          next_beat: null, // a director opening is followed only by travel
                           // away (multi-stop) or nothing (single stop) — a
                           // staged orbit never follows it
          purposes: first.purposes,
          role: first.role,
          importance: first.importance,
          scale: first.scale,
          span_m: (J.FRAMING_SCALES[first.scale] || {}).span_m || null,
          single_stop: stops.length === 1,
          departs: stops.length > 1,
          scale_story_ahead: stops.slice(1).some((s) => (s.purposes || []).includes("SHOW_SCALE")),
          flourish_budget: budget,
          negatives: intent.negatives || [],
          // OPERATOR MOVEMENT AUTHORITY: a movement primitive the operator
          // named ("hover over X", "orbit X") must never be replaced by an
          // automatic promotion — hover stays hover.
          explicit_movement: first.explicit_grammar || null,
          explicit_opening: explicitOpening,
          continuation: !!continuationState,
          config: {
            orbit_default_tilt_deg: planner.DEFAULT_TILT_DEG.orbit,
            terrain_oblique_tilt_deg: terrainOpeningPolicy
              ? terrainOpeningPolicy.final_tilt_deg : TERRAIN_OBLIQUE_TILT_DEG,
          },
        });
        if (openingObliquity.action === "PROMOTE_TO_RING") {
          const g2 = CAMERA_GRAMMAR[openingObliquity.movement];
          const promotedFrom = openDec.key;
          openDec = {
            ...openDec,
            key: g2.key, label: g2.label, movement: g2.movement,
            angle: g2.angle, rarity: g2.rarity, communicates: g2.communicates,
            teaching: g2.teaching,
            tilt_deg: openingObliquity.tilt_deg,
            altitude_m: terrainOpeningPolicy ? terrainOpeningPolicy.altitude_m : null,
            tilt_reason: openingObliquity.reason,
            terrain_policy: terrainOpeningPolicy,
            obliquity: {
              action: "PROMOTE_TO_RING",
              promoted_from: promotedFrom,
              tilt_band: openingObliquity.tilt_band,
              source: openingObliquity.source || "AUTOMATIC",
              reason: openingObliquity.reason,
            },
          };
        } else if (openingObliquity.action === "APPLY_TILT") {
          openDec = {
            ...openDec,
            tilt_deg: openingObliquity.tilt_deg,
            // An explicit angle is operator authority. Do not retain the
            // morphology policy's coupled altitude, which was computed for a
            // different angle; the journey's existing framing law owns it.
            altitude_m: null,
            tilt_reason: openingObliquity.reason,
            terrain_policy: openDec.terrain_policy ? {
              ...openDec.terrain_policy,
              overridden_by: "EXPLICIT_OPERATOR_TILT",
              applied_tilt_deg: openingObliquity.tilt_deg,
              altitude_m: null,
            } : null,
            obliquity: { action: "APPLY_TILT", promoted_from: null, tilt_band: openingObliquity.tilt_band, source: openingObliquity.source || "USER_SPECIFIED", reason: openingObliquity.reason },
          };
        } else {
          // The block is itself provenance: WHY automatic obliquity left this
          // opening alone (operator authority, editorial policy, restraint
          // budget, or geometry) rides on the decision and the plan beat, so
          // no directorial choice is ever hidden.
          openDec = {
            ...openDec,
            obliquity: {
              action: "KEEP_FLAT",
              promoted_from: null,
              tilt_band: null,
              source: openingObliquity.source || "POLICY",
              reason: openingObliquity.reason,
            },
          };
        }
      }

      if (openDec && first.role === "COMPARISON_LOCATION") compareAnchorDecision = openDec;
      if (openDec) { decisions.push({ stop: 0, kind: "at", place: first.location, role: first.role, importance: first.importance, decision: openDec, alternatives: opening.alternatives, rejected: opening.rejected }); spend(openDec); }
    }

    // ── comparison group: matched framing is a hard directorial rule ────────
    // Places the story explicitly compares must be filmed the same way — same
    // framing scale, same emphasis — or the viewer measures the camera, not the
    // geography. Only EXPLICIT comparison roles trigger matching: a scale story
    // ("Singapore is small compared with Southeast Asia") infers COMPARE as a
    // purpose but its whole point is UNEQUAL framing, so purpose alone must not
    // trigger it. The first compared place's scale anchors the group; explicit
    // operator framing is never overridden.
    const compareIdx = stops
      .map((s, i) => (s.role === "COMPARISON_LOCATION" ? i : -1))
      .filter((i) => i >= 0);
    let compareMatch = null;
    if (compareIdx.length >= 2) {
      const anchor = stops[compareIdx[0]];
      compareIdx.forEach((i) => {
        const s = stops[i];
        if (s.framing === "auto") { s.framing = anchor.scale; s.scale = anchor.scale; }
      });
      compareMatch = { anchor: anchor.location, scale: anchor.scale, stops: compareIdx.map((i) => stops[i].location) };
    }

    const legs = [];
    for (let i = 1; i < stops.length; i += 1) {
      const from = stops[i - 1];
      const to = stops[i];
      const distanceM = from.resolved && to.resolved ? planner.haversineMeters(from.resolved, to.resolved) : null;

      // ── travel leg ──
      // A leg inherits the purposes of the place it is heading to whenever those
      // purposes are things TRAVEL can deliver — otherwise a terrain story asks
      // for the shape of the land and gets a generic arrival.
      const TRAVEL_RELEVANT = ["SHOW_TERRAIN", "SHOW_ROUTE", "SHOW_SCALE", "RELATE", "REVEAL", "COMPARE"];
      const base = to.role === "ROUTE_POINT" || from.role === "ROUTE_POINT"
        ? ["SHOW_ROUTE", "TRAVEL"]
        : (IMPORTANCE_ORDER.indexOf(to.importance) >= IMPORTANCE_ORDER.indexOf("HIGH") ? ["ARRIVE", "TRAVEL"] : ["TRAVEL"]);
      const inherited = to.purposes.filter((pp) => TRAVEL_RELEVANT.includes(pp));
      const travelPurposes = inherited.length ? inherited.concat(base) : base;
      const travelCtx = normalizeContext({
        slot: "travel", role: to.role, importance: to.importance, purposes: intent.travel_purposes || travelPurposes,
        scale: to.scale, origin_scale: from.scale, place: to.location, distance_m: distanceM, journey_span_m: spanM,
        pace: intent.pace || (options.journeyPace || null),
        flourish_budget: budget, spectacle_spent: spectacleSpent, used_counts: used, previous,
        globe_justification: globe.allowed ? globe.justification : null,
        explicit_style: to.explicit_travel_style, negatives: intent.negatives || [],
      });
      let styleScored = TRAVEL_STYLE_CANDIDATES.map((k) => scoreCandidate(k, travelCtx))
        .filter((s) => !s.disqualified).sort((a, b) => b.score - a.score);
      let styleOverrideNote = null;
      if (!styleScored.length && to.explicit_travel_style) {
        // The explicit style was ruled out by the legibility doctrine and every
        // alternative by the explicit preference. Re-score WITHOUT the
        // preference, record WHY the operator's shape was declined — explicit
        // intent is authoritative, but a crossing that smears is not an
        // alternative the Director may silently substitute.
        const relaxed = normalizeContext({ ...travelCtx, explicit_style: null });
        styleScored = TRAVEL_STYLE_CANDIDATES.map((k) => scoreCandidate(k, relaxed))
          .filter((s) => !s.disqualified).sort((a, b) => b.score - a.score);
        const declined = scoreCandidate(to.explicit_travel_style, travelCtx);
        styleOverrideNote = declined.disqualified
          || `the explicit travel shape could not stay readable within editorial time`;
      }
      const styleTop = styleScored[0];
      const styleDec = decisionOf(styleTop, travelCtx);
      if (styleOverrideNote) styleDec.explicit_override = styleOverrideNote;
      decisions.push({
        stop: i, kind: "travel", from: from.location, to: to.location,
        distance_m: distanceM == null ? null : Math.round(distanceM),
        decision: styleDec, alternatives: styleScored.slice(1, 3).map((s) => decisionOf(s, travelCtx)),
      });
      spend(styleDec);
      const style = TRAVEL_STYLE_GRAMMAR[styleTop.key];

      // ── shot(s) at the destination ──
      const atCtx = {
        slot: "at", role: to.role, importance: to.importance, purposes: to.purposes,
        scale: to.scale, place: to.location,
        flourish_budget: Math.min(budget, IMPORTANCE[to.importance].flourish),
        spectacle_spent: spectacleSpent, used_counts: used, previous,
        journey_span_m: spanM, globe_justification: globe.allowed ? globe.justification : null,
        templates_allowed: options.templates_allowed !== false,
        is_final: i === stops.length - 1,
        is_arrival: true,
        explicit_grammar: to.explicit_grammar, negatives: intent.negatives || [],
        purposes_explicit: to.purposes_explicit, role_explicit: to.role_explicit,
        terrain_morphology: to.resolved && to.resolved.terrain_morphology,
        morphology_source: to.resolved && to.resolved.morphology_source,
        terrain_altitude_m: to.resolved && to.resolved.altitude_m,
        terrain_min_altitude_m: to.resolved && to.resolved.min_altitude_m,
        target_elevation_m: to.resolved && to.resolved.target_elevation_m,
      };
      const arrival = recommend(atCtx);
      let atDec = arrival.recommended;
      // Comparison beats must read as ONE repeated shot, visually — not just in
      // metadata. After the first compared place, mirror the anchor's grammar
      // (movement + emphasis + orbit span) so the two shots film the same way.
      if (atDec && compareMatch && to.role === "COMPARISON_LOCATION") {
        if (compareEmphasis == null) compareEmphasis = atDec.emphasis;
        else {
          const anchor = compareAnchorDecision;
          if (anchor && anchor.key !== atDec.key && !(to.explicit_grammar)) {
            atDec = { ...atDec, key: anchor.key, movement: anchor.movement,
              label: anchor.label, rarity: anchor.rarity,
              tilt_deg: anchor.tilt_deg || null, altitude_m: journeyAltitudeFor(anchor),
              terrain_policy: anchor.terrain_policy || null, compare_mirrored: true };
          }
          atDec.emphasis = compareEmphasis;
        }
      }
      if (!compareAnchorDecision && compareMatch && to.role === "COMPARISON_LOCATION" && atDec) {
        compareAnchorDecision = atDec;
      }
      if (atDec && (SHOT_PURPOSES[to.purposes[0]] || {}).angle === "oblique"
          && !["oblique", "oblique_capable"].includes(atDec.grammarAngle || (CAMERA_GRAMMAR[atDec.key] || {}).angle)) {
        atDec.angle_limitation = `${to.purposes[0]} wants an oblique view, but at ${to.scale} scale no at-location move can hold one: an orbit can only face its target within the generator's ring cap. The oblique view is delivered by the approach instead.`;
      }
      if (atDec) { decisions.push({ stop: i, kind: "at", place: to.location, role: to.role, importance: to.importance, decision: atDec, alternatives: arrival.alternatives, rejected: arrival.rejected }); spend(atDec); }

      legs.push({
        destination: { location: to.location, framing: to.framing },
        travel_style: style.style,
        // EDITORIAL PACING: the Director sets travel durations itself — screen
        // time compressed for distance, capped at 15 s, pace-relative — instead
        // of letting the physical baseline grow with kilometres. Explicit step
        // durations are "manual" in the journey model, so pace presets do not
        // stretch them a second time.
        travel: editorialTravelSteps(styleTop.key, distanceM, intent.pace || J.DEFAULT_PACE,
          { scale: to.scale, origin_scale: from.scale })
          .map((s) => J.normalizeStep(s, "travel")),
        movements: atDec
          ? [J.normalizeStep({ type: atDec.movement, emphasis: atDec.emphasis,
              tilt_deg: atDec.tilt_deg || null,
              altitude_m: journeyAltitudeFor(atDec),
              revolutions: orbitRevolutionsFor(atDec, to) }, "at")]
          : [],
      });
    }

    // ── optional closing globe shot, only when genuinely justified ──
    if (globe.allowed && intent.close_on_globe !== false
        && ["GLOBAL_CONCLUSION", "GLOBAL_NETWORK", "WORLDWIDE_PHENOMENON", "INTERCONTINENTAL_SCALE", "PLANETARY_COMPARISON", "GLOBAL_CONTEXT"].includes(globe.justification)) {
      const lastStop = stops[stops.length - 1];
      const gDec = decisionOf(scoreCandidate("globe_view", normalizeContext({
        slot: "at", role: "GEOGRAPHIC_CONTEXT", importance: "HIGH", purposes: ["SHOW_SCALE", "ORIENT"],
        scale: "globe", place: lastStop.location, journey_span_m: spanM, globe_justification: globe.justification,
        flourish_budget: 3, spectacle_spent: spectacleSpent, used_counts: used, previous,
      })), normalizeContext({ slot: "at", purposes: ["SHOW_SCALE"], scale: "globe", importance: "HIGH" }));
      decisions.push({ stop: stops.length - 1, kind: "at", place: lastStop.location, role: "GEOGRAPHIC_CONTEXT", importance: "HIGH", decision: gDec, alternatives: [], rejected: [], globe: true });
      legs.push({
        destination: { location: lastStop.location, framing: "globe" },
        travel_style: "direct",
        // The widening step carries the globe framing explicitly: a plain pull-back
        // only shifts one scale, which is how the first version of this leg ended
        // up at 156 km instead of planetary altitude.
        travel: [J.normalizeStep({ type: "pull_back", framing: "globe", emphasis: gDec.emphasis }, "travel")],
        movements: [J.normalizeStep({ type: "hold", emphasis: gDec.emphasis }, "at")],
      });
    }

    // A continuation journey seeds its opening from the EXACT terminal camera
    // state; the place name is only a label (see journey.continuationStateFromPlan).
    const startSpec = continuationState
      ? {
        source: "continuation",
        location: (continuationState.target && continuationState.target.name) || first.location,
        framing: "auto",
        continuation: continuationState,
      }
      : { location: first.location, framing: first.framing };

    // ── Subject-aware opening composition ──────────────────────────────────
    // The first frame should feel chosen, not defaulted. The composition
    // module decides whether the opening may deviate from the planner's
    // proven default (pan 0 / facing north) and records WHY. It only ever
    // emits a PARTIAL seed (pan/tilt) for the planner's existing initialCamera
    // mechanism — position, altitude and every orbit-ring rule stay with the
    // planner, and continuation/explicit/orbit-staging/comparison cases are
    // hard exceptions. See earth-studio-opening-composition.js.
    const OC = loadComposition(options.composition);
    const P = loadPlanner(options.planner);
    const firstLeg = legs[0] || null;
    // The first genuine travel leg's destination: resolved from the STOPS
    // (autoDirect's own resolution), not the raw leg object.
    const nextStop = stops[1] || null;
    const firstTravelDest = firstLeg && (firstLeg.travel || []).length && nextStop
      ? nextStop.resolved || null : null;
    const openingComposition = OC.planOpening({
      subject: {
        name: first.location,
        latitude: first.resolved ? first.resolved.latitude : null,
        longitude: first.resolved ? first.resolved.longitude : null,
        span_m: (J.FRAMING_SCALES[first.scale] || {}).span_m || null,
        scale: first.scale || null,
      },
      opening_beat: openDec ? openDec.movement : null,
      next_beat: firstLeg && !(firstLeg.travel || []).length && (firstLeg.movements || [])[0]
        ? firstLeg.movements[0].type : null,
      first_travel: firstTravelDest && first.resolved ? {
        to: { name: firstLeg.destination.location, latitude: firstTravelDest.latitude, longitude: firstTravelDest.longitude },
        distance_m: P.haversineMeters(first.resolved, firstTravelDest),
      } : null,
      continuation: !!continuationState,
      explicit: intent.opening || null,
      compare: compareMatch && (compareMatch.stops || []).includes(first.location)
        ? { matched: true } : null,
    });

    const journey = J.normalizeJourney({
      pace: intent.pace || J.DEFAULT_PACE,
      aspect: intent.aspect || null,
      start: startSpec,
      start_movements: openDec
        ? [J.normalizeStep({ type: openDec.movement, emphasis: openDec.emphasis,
            tilt_deg: openDec.tilt_deg || null,
            altitude_m: journeyAltitudeFor(openDec),
            revolutions: orbitRevolutionsFor(openDec, first) }, "at")]
        : [],
      legs,
    });
    // Provenance rides inside the journey artifact so every generated package
    // can answer "why did the system start from THIS angle?".
    journey.opening_composition = openingComposition.composition;

    const notes = [];
    notes.push(`Flourish budget for this sequence: ${flourishBudgetFor(stops)} (from ${stops.length} stop${stops.length === 1 ? "" : "s"}; ${stops.filter((s) => s.importance === "HERO").length} hero, ${stops.filter((s) => s.importance === "HIGH").length} high).`);
    notes.push(globe.allowed ? `Globe shot: ${globe.reason}` : `No globe shot: ${globe.reason}`);
    const specials = decisions.filter((d) => d.decision && RARITY[d.decision.rarity] && RARITY[d.decision.rarity].budget > 0);
    notes.push(specials.length
      ? `Special/selective moves used: ${specials.map((d) => d.decision.label).join(", ")}.`
      : "No selective or special moves were used — nothing in this sequence earned one.");
    if (compareMatch) notes.push(`Matched framing: ${compareMatch.stops.join(" / ")} are all filmed at ${compareMatch.scale} scale so they compare honestly.`);
    if (continuationState) notes.push("This animation begins from the exact terminal camera state of a previous animation — no hidden reset.");
    const comp = openingComposition.composition;
    notes.push(`Opening composition [${comp.strategy}]: ${comp.reason}`);
    if (openingComposition.opening_camera) {
      journey.opening_camera = openingComposition.opening_camera;
    }
    // Opening-to-first-motion continuity: does the opening heading flow into
    // the first travel vector, or does playback begin with a visible swing?
    const openingHeading = (journey.opening_camera && Number.isFinite(journey.opening_camera.pan_deg))
      ? journey.opening_camera.pan_deg : 0;
    const firstTravelBearing = firstTravelDest && first.resolved
      ? OC.bearingDeg(first.resolved, firstTravelDest) : null;
    const continuityAudit = OC.auditOpeningContinuity({
      opening_heading_deg: openingHeading,
      first_travel_bearing_deg: firstTravelBearing,
    });
    continuityAudit.warnings.forEach((w) => notes.push(w));

    const result = { journey, decisions, globe, notes, span_m: Math.round(spanM), stops };
    result.summary = J.summarizeJourney(journey);
    result.plan = buildPlan(result, intent, { compare_match: compareMatch, continuation: continuationState });
    result.audit = auditDirection(result);
    return result;
  }

  // ── The Directorial Plan — an explicit artifact of the editorial beats ─────
  // This is the thing an operator reads BEFORE any keyframe: what the story is,
  // beat by beat, what each beat is for, which grammar was chosen and why. It is
  // derived from the decisions the Director already made (no second source of
  // truth) and persisted as machine-readable provenance.
  function buildPlan(result, intent = {}, options = {}) {
    const beats = [];
    const push = (beat) => beats.push(beat);

    // Beat durations come from the journey's own compiled timeline — the same
    // numbers the generator will produce. stop -> movements, travel -> steps;
    // a closing globe beat owns both the widening travel and its hold.
    const timeline = (result.summary && result.summary.timeline) || [];
    let ti = 0;
    const sumSeconds = (items) => items.reduce((a, b) => a + (Number(b.seconds) || 0), 0);
    const consumeStop = () => { const e = timeline[ti]; if (e && e.kind === "stop") { ti += 1; return sumSeconds(e.movements || []); } return null; };
    const consumeTravel = () => { const e = timeline[ti]; if (e && e.kind === "travel") { ti += 1; return sumSeconds(e.steps || []); } return null; };

    result.decisions.forEach((d) => {
      const dec = d.decision || {};
      if (d.kind === "travel") {
        push({
          beat: "TRAVEL",
          subject: `${d.from} → ${d.to}`,
          purpose: dec.purpose || "TRAVEL",
          purpose_label: dec.purpose_label || "Travel",
          viewer_should_understand: dec.viewer_should_understand || null,
          grammar: dec.key, grammar_label: dec.label,
          rarity: dec.rarity || null,
          angle: dec.angle || null,
          why: dec.why || null,
          distance_m: d.distance_m == null ? null : d.distance_m,
          duration_seconds: consumeTravel(),
          provenance: {
            subject: PROVENANCE.USER_SPECIFIED,
            purpose: PROVENANCE.PLANNER_INFERRED,
            grammar: PROVENANCE.PLANNER_INFERRED,
            duration: PROVENANCE.COMPUTED,
          },
        });
      } else {
        let seconds = null;
        if (d.globe) { seconds = (consumeTravel() || 0) + (consumeStop() || 0); }
        else { seconds = consumeStop(); }
        push({
          beat: d.continuation ? "CONTINUE" : (d.role || "AT"),
          subject: d.place || null,
          role: d.role || null,
          importance: d.importance || null,
          purpose: dec.purpose || "ESTABLISH",
          purpose_label: dec.purpose_label || "Establish",
          viewer_should_understand: dec.viewer_should_understand || null,
          grammar: dec.key, grammar_label: dec.label,
          rarity: dec.rarity || null,
          angle: dec.angle || null,
          emphasis: dec.emphasis == null ? null : dec.emphasis,
          tilt_deg: dec.tilt_deg == null ? null : dec.tilt_deg,
          altitude_m: dec.altitude_m == null ? null : dec.altitude_m,
          terrain_policy: dec.terrain_policy || null,
          // Opening-obliquity provenance: promotion, applied operator tilt,
          // or the honest reason the opening was left flat.
          obliquity: dec.obliquity || null,
          why: dec.why || null,
          angle_limitation: dec.angle_limitation || null,
          duration_seconds: seconds,
          provenance: {
            subject: PROVENANCE.USER_SPECIFIED,
            role: (intent.stops || []).some((s) => (typeof s === "object" ? s.role : null) === d.role)
              ? PROVENANCE.USER_SPECIFIED : PROVENANCE.PLANNER_INFERRED,
            importance: (intent.stops || []).some((s) => (typeof s === "object" ? s.importance : null) === d.importance)
              ? PROVENANCE.USER_SPECIFIED : PROVENANCE.PLANNER_INFERRED,
            purpose: PROVENANCE.PLANNER_INFERRED,
            grammar: PROVENANCE.PLANNER_INFERRED,
            emphasis: PROVENANCE.COMPUTED,
          },
        });
      }
    });

    // globe decision (if the Director appended a closing globe beat it is
    // already a decision; the gate itself is recorded here regardless)
    return {
      plan_version: PLAN_VERSION,
      director_version: DIRECTOR_VERSION,
      source_text: intent.source_text || null,
      beats,
      globe: result.globe,
      opening_composition: (result.journey && result.journey.opening_composition) || null,
      opening_camera: (result.journey && result.journey.opening_camera) || null,
      compare_match: options.compare_match || null,
      continuation: options.continuation ? {
        source_animation: options.continuation.source_animation || null,
        ends_at_frame: options.continuation.ends_at_frame == null ? null : options.continuation.ends_at_frame,
        camera: options.continuation.camera || null,
        provenance: PROVENANCE.CARRIED_OVER,
      } : null,
      notes: result.notes,
      span_m: result.span_m,
      total_duration_seconds: result.summary ? result.summary.total_duration_seconds : null,
    };
  }

  // ── Story-level audit — the sequence must hold together, not just each shot ─
  // Deterministic checks that read the finished direction as a whole. These are
  // WARNINGS/DEFECTS about editorial coherence, never a veto.
  function auditDirection(result) {
    const findings = [];
    const warn = (code, message) => findings.push({ severity: "warning", code, message });

    const decisions = result.decisions || [];
    const atDecisions = decisions.filter((d) => d.kind === "at" && d.decision);

    // 1) unnecessary orientation reset: a wide ORIENT/SHOW_SCALE that re-opens a
    //    region the viewer has already been given. An explicit scale-ladder
    //    story (SCALE_REFERENCE rungs) is a declared widening, not a reset.
    const wideSeen = [];
    atDecisions.forEach((d, i) => {
      const stop = result.stops[d.stop] || {};
      const p = d.decision.purpose;
      const isWide = ["ORIENT", "SHOW_SCALE"].includes(p)
        && ["region", "country", "subcontinent", "continent"].includes(stop.scale)
        && stop.role !== "SCALE_REFERENCE";
      if (!isWide) return;
      if (i > 0 && wideSeen.length) {
        warn("orientation_reset", `${d.place}: the viewer already has wide context (${wideSeen.join(", ")}) — a second wide ${p} beat re-orients without a narrative reason.`);
      }
      wideSeen.push(d.place);
    });

    // 2) orbit monotony: three or more at-location beats all orbiting.
    const orbitBeats = atDecisions.filter((d) => /orbit/i.test(d.decision.key));
    if (orbitBeats.length >= 3) {
      warn("orbit_monotony", `${orbitBeats.length} stops are orbited (${orbitBeats.map((d) => d.place).join(", ")}). Repeated circles read as a style, not as intention.`);
    }

    // 3) globe used without a justification (defense in depth — the gate already blocks this).
    const globeBeats = atDecisions.filter((d) => d.decision.key === "globe_view");
    if (globeBeats.length && !(result.globe && result.globe.allowed)) {
      warn("unjustified_globe", "A globe shot is present but no global justification was declared.");
    }

    // 4) specialty-motion overuse: more than one spiral in one sequence.
    const spirals = atDecisions.filter((d) => /spiral/i.test(d.decision.key));
    if (spirals.length > 1) {
      warn("spiral_overuse", `${spirals.length} spirals in one sequence — a reveal move loses its meaning the second time it appears.`);
    }

    // 5) every destination has meaningful treatment (no empty at-beat).
    atDecisions.forEach((d) => {
      if (!d.decision || !d.decision.key) warn("orphan_at_beat", `${d.place}: an at-location beat has no camera grammar.`);
    });

    // Sequence-level pacing diagnostics are deliberately warnings, not policy
    // vetoes. Travel can be the subject of a journey story; the warning only
    // asks for an editorial explanation when connective-looking travel owns
    // most of the runtime.
    const beats = (result.plan && result.plan.beats) || [];
    const totalSeconds = beats.reduce((sum, b) => sum + (Number(b.duration_seconds) || 0), 0);
    const travelBeats = beats.filter((b) => b.beat === "TRAVEL");
    const travelSeconds = travelBeats.reduce((sum, b) => sum + (Number(b.duration_seconds) || 0), 0);
    const travelPurposes = new Set(travelBeats.flatMap((b) => [b.purpose, ...(b.viewer_should_understand ? [] : [])]));
    const explanatoryTravel = ["SHOW_ROUTE", "SHOW_SCALE", "RELATE", "REVEAL", "COMPARE"]
      .some((purpose) => travelPurposes.has(purpose));
    if (totalSeconds > 0 && travelSeconds / totalSeconds >= 0.65 && !explanatoryTravel) {
      warn("travel_dominance",
        `${Math.round(travelSeconds / totalSeconds * 100)}% of runtime is travel (${Math.round(travelSeconds * 10) / 10}s of ${Math.round(totalSeconds * 10) / 10}s) without an explicit route/scale/relationship purpose; review whether the connective movement earns that time.`);
    }

    // Matched comparisons often mirror grammar intentionally. Two long,
    // equivalent moving beats are still worth showing to a human because
    // parity does not require maximal duration or identical motion.
    const comparisonBeats = beats.filter((b) => b.beat === "COMPARISON_LOCATION");
    if (comparisonBeats.length >= 2) {
      const equivalent = comparisonBeats.length >= 2
        && comparisonBeats.every((b) => b.grammar === comparisonBeats[0].grammar
          && Number(b.duration_seconds) === Number(comparisonBeats[0].duration_seconds));
      if (equivalent && Number(comparisonBeats[0].duration_seconds) >= 10) {
        warn("repeated_equivalent_grammar",
          `matched comparison beats repeat ${comparisonBeats[0].grammar} for ${comparisonBeats[0].duration_seconds}s each; parity is preserved, but review whether the repeated movement earns its full duration.`);
      }
    }

    // A conclusion should be terminal and meaningful. This compares it with
    // the sequence's own subject-view beats rather than imposing a universal
    // number of seconds.
    const finalBeat = beats[beats.length - 1];
    const subjectView = beats.filter((b) => b.beat !== "TRAVEL" && b.purpose !== "CONCLUDE");
    const longestSubject = Math.max(0, ...subjectView.map((b) => Number(b.duration_seconds) || 0));
    if (finalBeat && finalBeat.purpose === "CONCLUDE"
        && Number(finalBeat.duration_seconds) > 0
        && longestSubject > 0
        && Number(finalBeat.duration_seconds) < longestSubject * 0.5) {
      warn("weak_conclusion_emphasis",
        `the terminal conclusion is ${finalBeat.duration_seconds}s versus a ${longestSubject}s subject beat; review whether the final synthesis has enough authority.`);
    }

    return {
      findings,
      ok: findings.every((f) => f.severity !== "error"),
      beat_count: decisions.length,
    };
  }

  // ── Deterministic structured-intent extraction ─────────────────────────────
  // Free text is only used to DERIVE structured intent. Once structured, the same
  // intent always produces the same direction. No LLM in the decision path.
  const ROLE_PHRASES = [
    [/\b(main|primary|hero)\s+(destination|subject|city|location|place)\b/i, { role: "PRIMARY_SUBJECT", importance: "HIGH" }],
    [/\bfeel\s+like\s+(the\s+)?(important|main|hero)\s+(destination|subject|place)\b/i, { role: "PRIMARY_SUBJECT", importance: "HIGH" }],
    [/\bhero\b/i, { role: "FINAL_REVEAL", importance: "HERO" }],
    [/\b(final|last)\s+(reveal|shot|subject)\b/i, { role: "FINAL_REVEAL", importance: "HERO" }],
    [/\b(destination)\b/i, { role: "DESTINATION", importance: "HIGH" }],
    [/\b(secondary\s+)?waypoint\b/i, { role: "WAYPOINT", importance: "LOW" }],
    [/\b(route\s+(stop|point)|stop\s+on\s+the\s+way|en\s+route)\b/i, { role: "ROUTE_POINT", importance: "LOW" }],
    [/\bcompar(e|ison)\b/i, { role: "COMPARISON_LOCATION", importance: "NORMAL" }],
    [/\b(context|orientation|where\s+it\s+is)\b/i, { role: "GEOGRAPHIC_CONTEXT", importance: "NORMAL" }],
    [/\bscale\b/i, { role: "SCALE_REFERENCE", importance: "NORMAL" }],
    [/\b(start|begin|open)\b/i, { role: "STARTING_CONTEXT", importance: "NORMAL" }],
  ];
  const PURPOSE_PHRASES = [
    [/\bwhere\s+.*\bis\b|\bwhere\s+it\s+is\b|\brelative\s+to\b|\blocat(e|ion)\b/i, "LOCATE"],
    [/\b(move|come)\s+closer\b|\bend\s+over\b|\bpull\s+in\b|\bclose\s+in\b/i, "LOCATE"],
    [/\bwhat\s+.*\blooks?\s+like\b|\binspect\b|\barchitecture\b|\bclose\s+look\b/i, "INSPECT"],
    [/\breveal\b|\bdramatic\b/i, "REVEAL"],
    [/\brout(e|es)\b|\bpath\b|\bjourney\s+through\b/i, "SHOW_ROUTE"],
    [/\bscale\b|\bhow\s+(big|small|large|remote)\b|\bnests?\b|\bcompared\s+(with|to)\b|\bcontext\b/i, "SHOW_SCALE"],
    [/\bterrain\b|\bmountain|\bvalley|\blandscape\b/i, "SHOW_TERRAIN"],
    [/\bcompar/i, "COMPARE"],
    [/\brelationship\b|\bconnects?\b/i, "RELATE"],
    [/\btravel\b|\bfly\b|\bgo\s+to\b/i, "TRAVEL"],
    [/\bestablish\b/i, "ESTABLISH"],
    [/\borient/i, "ORIENT"],
    [/\bemphasi/i, "EMPHASIZE"],
    [/\bconclu|\bend(ing)?\b|\bfinish/i, "CONCLUDE"],
  ];
  // Explicit continuation requests. "Continue to X" alone is NOT one — that is
  // ordinary travel language; a continuation hand-off must be stated as picking
  // up from a PREVIOUS animation / where we left off.
  const CONTINUE_PHRASES = [
    /\bcontinue\s+(seamlessly\s+)?from\s+(my\s+|the\s+)?previous\b/i,
    /\bseamless(ly)?\b/i,
    /\bpick\s+up\s+where\b/i,
    /\bfrom\s+where\s+(we|it|the\s+last)\b/i,
  ];
  // Pacing language. Deliberately coarse: only clearly-stated tempo changes are
  // honoured; everything else keeps the journey's own pace.
  const PACE_PHRASES = [
    [/\b(quickly|fast|brief|tight)\b/i, "quick"],
    [/\b(slow(ly)?|calm(ly)?|gentl(e|y)|unhurried|take\s+(your|our|its)\s+time)\b/i, "calm"],
  ];
  const GLOBE_PHRASES = [
    [/\bglobal\s+network\b|\bworldwide\s+network\b|\bspans?\s+the\s+(planet|globe|world)\b|\bsubmarine\s+cables?\b|\bshipping\s+network\b/i, "GLOBAL_NETWORK"],
    [/\bworldwide\b|\bacross\s+the\s+world\b|\bglobally\b|\bspread\s+globally\b/i, "WORLDWIDE_PHENOMENON"],
    [/\b(three|four|two)\s+continents?\b|\bintercontinental\b|\bacross\s+continents\b/i, "INTERCONTINENTAL_SCALE"],
    [/\bopposite\s+sides?\s+of\s+the\s+(planet|world)\b/i, "PLANETARY_COMPARISON"],
    [/\bglobal\s+context\b|\bglobal\s+scale\b/i, "GLOBAL_CONTEXT"],
    [/\bwhole\s+(earth|planet|globe)\b|\bentire\s+planet\b/i, "GLOBAL_CONTEXT"],
  ];
  // Explicit camera-grammar language. When the operator NAMES a movement, that
  // is authoritative — it must win over inferred direction (see the override in
  // autoDirect). Deliberately coarse: only unambiguous movement words map;
  // everything else stays inferred. "Push in / come closer" asks for an
  // approach; "pull back / out" asks to widen; "hold / stay" asks for stillness.
  const GRAMMAR_PHRASES = [
    [/\bfull\s+(360|circle|orbit)\b|\borbit\s+(twice|twice\s+around)\b|\bcircle\s+twice\b/i, "orbit"],
    [/\b(circle|orbit|encircle)\b/i, "slow_orbit"],
    [/\bpush\s+in\b|\bmove\s+closer\b|\bcome\s+closer\b|\bapproach\b|\bclose\s+in\s+on\b/i, "zoom_in"],
    [/\bpull\s+(back|out|away)\b|\bzoom\s+out\b|\bwiden\s+(out)?\b/i, "zoom_out"],
    // Stationary semantics are OPERATOR AUTHORITY over the opening movement:
    // "hover over X" is a named movement primitive (a stationary hold), not an
    // invitation to direct. The obliquity policy must see it as explicit.
    [/\bhover(ing)?\b|\b(hold|stay)\s+(still|here|put)?\b|\bremains?\s+(still|stationary)\b|\b(static|stationary)\b|\bsteady\s+on\b/i, "hold"],
  ];
  // Explicit travel-shape language applies to the leg travelling TO the place
  // named in the same clause ("then move directly to Berlin").
  const TRAVEL_STYLE_PHRASES = [
    [/\bdirectly\b|\bstraight\s+(to|there|across)\b|\bwithout\s+detours?\b/i, "style:direct"],
  ];
  // Explicit NEGATIVE directions: what the operator ruled out. These are hard
  // constraints — the Director must not talk the operator out of them.
  const NEGATIVE_PHRASES = [
    [/\bdon'?t\s+orbit\b|\bno\s+orbit(ing)?\b|\bwithout\s+(an?\s+)?orbit/i, "orbit"],
    [/\bdon'?t\s+spiral\b|\bno\s+spiral(ing)?\b/i, "spiral"],
    [/\bno\s+globe\b|\bdon'?t\s+(go\s+to\s+|show\s+|use\s+)?(a\s+)?globe\b|\bstay\s+below\s+globe/i, "globe"],
    [/\bno\s+(high\s+)?transit\b|\bdon'?t\s+climb\b/i, "high_transit"],
  ];
  const LEVEL_HORIZON_PHRASE = /\bkeep\s+the\s+horizon\s+level\b|\blevel\s+horizon\b/i;
  // Explicit OPENING-ORIENTATION language. The operator names the direction
  // the opening camera should take; it is authoritative and outranks every
  // automatic composition policy (see the USER_SPECIFIED branch in the
  // opening-composition module).
  //
  // Convention: a compass bearing is the camera's HEADING (the direction it
  // looks). "view/approach from the south" places the camera ON the south
  // side, i.e. looking north — the heading is the OPPOSITE of the side.
  const COMPASS_WORDS = {
    north: 0, northeast: 45, east: 90, southeast: 135,
    south: 180, southwest: 225, west: 270, northwest: 315,
  };
  const COMPASS_ALTERNATION = "north(?:east|west)?|south(?:east|west)?|east|west";
  const OPENING_HEADING_PHRASES = [
    // camera side: "view from the south", "approach the Colosseum from the northwest"
    [new RegExp(`\\b(?:approach|come|view(?:ed)?|seen|shot|open(?:ing)?|start(?:ing)?)(?:\\s+[a-z][a-z'\\- ]*?)?\\s+from\\s+the\\s+(${COMPASS_ALTERNATION})\\b`, "i"), "side"],
    // camera facing: "face north", "start looking east"
    [new RegExp(`\\b(?:face|facing|look(?:ing)?|start\\s+looking)\\s+(?:to\\s+the\\s+)?(${COMPASS_ALTERNATION})\\b`, "i"), "facing"],
    // numeric: "heading 220", "open at bearing 45 degrees"
    [/\b(?:heading|bearing)\s+(?:of\s+)?(\d{1,3})\s*(?:°|deg(?:rees)?)?\b/i, "numeric"],
  ];
  // Explicit TILT language. Top-down phrasing pins the plan view; explicit
  // degrees are literal; "high/low oblique" name a band (aerial-photography
  // convention: low oblique = no horizon, moderate tilt; high oblique =
  // strong, near-horizon tilt); a bare "oblique"/"angled view" records the
  // wish without inventing a number. Deliberately coarse — robust common
  // forms only, no NLP.
  const OPENING_TOPDOWN_PHRASE = /\btop-?\s?down\b|\bstraight\s+down\b|\bfrom\s+directly\s+above\b|\bdirectly\s+overhead\b/i;
  const OPENING_TILT_DEGREES_PHRASE = /\b(?:opening\s+tilt|tilt(?:ed)?(?:\s+(?:of|at|to))?|start(?:ing)?\s+at|at)\s+(\d{1,2}(?:\.\d+)?)\s*(?:°|deg(?:rees)?)/i;
  const OPENING_OBLIQUE_BAND_PHRASE = /\b(high|low)\s+oblique\b/i;
  const OPENING_OBLIQUE_PHRASE = /\boblique\b|\bangled\s+view\b|\bat\s+an\s+angle\b/i;

  // Parse explicit opening direction out of raw intent text. Returns
  // { heading_deg?, tilt_deg?, oblique?, oblique_band?, source_text } or
  // null. Deterministic, and deliberately literal: what the operator says is
  // what gets recorded. Heading and tilt language compose ("approach from the
  // south, tilt 45 degrees" carries both).
  function parseExplicitOpening(text) {
    const s = String(text);
    const out = {};
    const sources = [];
    for (const [re, kind] of OPENING_HEADING_PHRASES) {
      const m = s.match(re);
      if (!m) continue;
      if (kind === "numeric") {
        const h = Number(m[1]);
        if (Number.isFinite(h) && h >= 0 && h <= 360) {
          out.heading_deg = ((h % 360) + 360) % 360;
          sources.push(m[0].trim());
          break;
        }
        continue;
      }
      const base = COMPASS_WORDS[m[1].toLowerCase()];
      if (typeof base === "number") {
        // camera ON the south side looks north: the heading is opposite.
        out.heading_deg = kind === "side" ? (base + 180) % 360 : base;
        sources.push(m[0].trim());
        break;
      }
    }
    if (OPENING_TOPDOWN_PHRASE.test(s)) {
      out.tilt_deg = 0;
      sources.push("top-down opening");
    } else {
      const mt = s.match(OPENING_TILT_DEGREES_PHRASE);
      const t = mt ? Number(mt[1]) : NaN;
      if (mt && Number.isFinite(t) && t >= 0 && t <= 90) {
        out.tilt_deg = t;
        sources.push(mt[0].trim());
      } else {
        const mb = s.match(OPENING_OBLIQUE_BAND_PHRASE);
        if (mb) {
          out.oblique = true;
          out.oblique_band = mb[1].toLowerCase();
          sources.push(mb[0].trim());
        } else {
          const mo = s.match(OPENING_OBLIQUE_PHRASE);
          if (mo) {
            out.oblique = true;
            sources.push(mo[0].trim());
          }
        }
      }
    }
    if (!sources.length) return null;
    out.source_text = sources.join("; ");
    return out;
  }

  // Split intent text into sentences, then into CLAUSES, and attribute each
  // clause's purposes/roles to the places actually named in THAT clause.
  // Referential clauses ("compare the two cities", "inspect both", "make them
  // comparable") carry intent but no place name; they apply to their referent:
  // both/two/them/each -> the last two places mentioned, anything else -> the
  // most recently mentioned place. TRAVEL is never a location purpose — it is
  // the language of the leg, and the Director builds travel legs itself.
  // Place names come from the planner's own gazetteer, so nothing is invented.
  function parseIntent(text, options = {}) {
    const planner = loadPlanner(options.planner);
    const raw = String(text == null ? "" : text);
    const sentences = raw.split(/[\n.;]+/).map((x) => x.trim()).filter(Boolean);
    const known = Object.values(planner.LOCATION_FIXTURES).map((l) => l.name);
    // longest names first so "New York" wins over "York"
    const byLength = known.slice().sort((a, b) => b.length - a.length);

    const seen = new Map();     // canonical name -> stop
    const order = [];
    const ensureStop = (name) => {
      if (!seen.has(name)) { const stop = { location: name, purposes: [] }; seen.set(name, stop); order.push(stop); }
      return seen.get(name);
    };
    const findHits = (clause) => {
      const hits = [];
      byLength.forEach((name) => {
        const idx = clause.toLowerCase().indexOf(name.toLowerCase());
        if (idx < 0) return;
        if (hits.some((h) => idx >= h.idx && idx + name.length <= h.idx + h.name.length)) return;
        hits.push({ name, idx });
      });
      return hits.sort((a, b) => a.idx - b.idx);
    };

    sentences.forEach((sentence) => {
      const clauses = sentence.split(/,(?=\s)/).map((x) => x.trim()).filter(Boolean);
      clauses.forEach((clause) => {
        const hits = findHits(clause);
        const roleHit = ROLE_PHRASES.find(([re]) => re.test(clause));
        const purposeHits = PURPOSE_PHRASES
          .filter(([re]) => re.test(clause)).map(([, p]) => p)
          .filter((p) => p !== "TRAVEL");
        // "compare ... from roughly the SAME SCALE" is matched-framing language,
        // not a scale story: the size relationship is not the subject. A scale
        // STORY ("show how tiny Singapore is compared with Southeast Asia")
        // keeps SHOW_SCALE — there the inequality itself is the point.
        if (purposeHits.includes("SHOW_SCALE") && /\b(same|similar|equal|matching|comparable)\s+scale\b/i.test(clause)) {
          purposeHits.splice(purposeHits.indexOf("SHOW_SCALE"), 1);
        }
        const plural = /\b(both|two|three|four|them|each)\b/i.test(clause);

        // A CLOSING re-mention ("...then end in Scandinavia") names a place the
        // story already used, but it is a NEW final beat — a resolved wide
        // ending, not extra purposes on the opening stop. Re-emit it as the
        // last stop so the sequence actually returns to the wider geography.
        const closing = /\b(end|finish|conclude|close)\b/i.test(clause)
          && hits.length === 1 && seen.has(hits[0].name);
        if (closing) {
          const stop = {
            location: hits[0].name,
            role: "GEOGRAPHIC_CONTEXT",
            importance: "NORMAL",
            purposes: purposeHits.slice(),
          };
          // A wide ending must WIDEN back to that geography, then settle.
          if (!stop.purposes.includes("SHOW_SCALE")) stop.purposes.push("SHOW_SCALE");
          if (!stop.purposes.includes("CONCLUDE")) stop.purposes.push("CONCLUDE");
          order.push(stop);
          return;
        }

        hits.forEach((h) => ensureStop(h.name));
        const targets = hits.length
          ? hits.map((h) => seen.get(h.name))
          : (plural ? order.slice(-2) : order.slice(-1));
        // Explicit camera-grammar words in this clause are AUTHORITATIVE for the
        // places named in it ("orbit the Colosseum", "push in toward it"). A
        // clause with no place name applies to the most recent place, same as
        // purposes. Travel-shape words ("move directly to Berlin") govern the
        // leg arriving at the clause's destination.
        // A movement word inside a NEGATIVE clause ("don't orbit", "no
        // spiral") is a constraint, not a request — extracting it as explicit
        // grammar would demand the very move the operator ruled out and
        // disqualify every candidate.
        const negatedClause = NEGATIVE_PHRASES.some(([re]) => re.test(clause));
        const grammarHit = negatedClause ? null : GRAMMAR_PHRASES.find(([re]) => re.test(clause));
        const styleHit = TRAVEL_STYLE_PHRASES.find(([re]) => re.test(clause));
        targets.forEach((stop) => {
          if (roleHit && !stop.role) { stop.role = roleHit[1].role; stop.importance = roleHit[1].importance; }
          purposeHits.forEach((p) => { if (!stop.purposes.includes(p)) stop.purposes.push(p); });
          if (grammarHit && !stop.explicit_grammar) stop.explicit_grammar = grammarHit[1];
          if (styleHit && !stop.explicit_travel_style) stop.explicit_travel_style = styleHit[1];
        });
      });
    });
    const globeHit = GLOBE_PHRASES.find(([re]) => re.test(raw));
    // Continuation is a HAND-OFF, not a destination purpose: parseIntent flags it
    // and the operator supplies the source animation's exported state; the
    // Director refuses to approximate a previous camera from memory.
    const continuationRequested = CONTINUE_PHRASES.some((re) => re.test(raw));
    const paceHit = options.pace ? null : PACE_PHRASES.find(([re]) => re.test(raw));
    // Explicit negative directions are hard constraints, applied sequence-wide:
    // "don't orbit", "no spiral", "stay below globe view".
    const negatives = NEGATIVE_PHRASES.filter(([re]) => re.test(raw)).map(([, family]) => family);
    return {
      stops: order.map((s) => ({ ...s, purposes: s.purposes.length ? s.purposes : undefined })),
      globe_justification: globeHit ? globeHit[1] : null,
      continuation_requested: continuationRequested,
      pace: options.pace || (paceHit ? paceHit[1] : null),
      aspect: options.aspect || null,
      negatives: negatives.length ? negatives : undefined,
      level_horizon: LEVEL_HORIZON_PHRASE.test(raw) || undefined,
      // Explicit opening orientation ("approach from the south", "face north",
      // "heading 220", "start top-down"). Authoritative for the opening frame.
      opening: parseExplicitOpening(raw) || undefined,
      source_text: raw,
    };
  }

  // A plain-language account of the whole direction, for the GUI and reports.
  function explainDirection(result) {
    const lines = [];
    result.decisions.forEach((d) => {
      if (d.kind === "travel") {
        lines.push(`${d.from} → ${d.to}: ${d.decision.label} — ${d.decision.why}`);
      } else {
        lines.push(`${d.place || "start"} (${LOCATION_ROLES[d.role] ? LOCATION_ROLES[d.role].label : d.role}, ${d.importance}): ${d.decision.label} for ${d.decision.purpose_label} — ${d.decision.why}`);
      }
    });
    result.notes.forEach((n) => lines.push(n));
    if (result.audit && result.audit.findings && result.audit.findings.length) {
      result.audit.findings.forEach((f) => lines.push(`[${f.code}] ${f.message}`));
    }
    return lines;
  }

  const api = {
    DIRECTOR_VERSION,
    SHOT_PURPOSES,
    LOCATION_ROLES,
    IMPORTANCE,
    IMPORTANCE_ORDER,
    RARITY,
    GLOBE_JUSTIFICATIONS,
    INTERCONTINENTAL_DISTANCE_M,
    TERRAIN_OBLIQUE_TILT_DEG,
    CAMERA_GRAMMAR,
    AT_CANDIDATES,
    TRAVEL_CANDIDATES,
    TEMPLATE_CANDIDATES,
    ANGLE_SEMANTICS,
    SMALL_SCALES,
    MID_SCALES,
    LARGE_SCALES,
    TRAVEL_STYLE_GRAMMAR,
    TRAVEL_STYLE_CANDIDATES,
    PROVENANCE,
    PLAN_VERSION,
    buildPlan,
    auditDirection,
    styleCruiseAltitudeM,
    flourishBudgetFor,
    autoDirect,
    parseIntent,
    parseExplicitOpening,
    explainDirection,
    decisionOf,
    scoreCandidate,
    globeDecision,
    normalizeContext,
    recommend,
    dwellFor,
    isSubjectLike,
    scaleBand,
    _loadTerrainMorphology: loadTerrainMorphology,
    _loadJourney: loadJourney,
    _loadPlanner: loadPlanner,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalScope.EarthStudioDirector = api;
})(typeof window !== "undefined" ? window : globalThis);
