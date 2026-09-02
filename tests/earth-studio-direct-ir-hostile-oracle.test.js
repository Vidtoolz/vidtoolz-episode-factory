"use strict";

const { assert, childProcess, fs, path, test } = require("./_helpers.js");
const oracle = require("./earth-studio-direct-ir-hostile-oracle-lib.js");

const REPO = path.resolve(__dirname, "..");
const CORPUS = oracle.loadCorpus(REPO);
const MODULES = oracle.loadModules(REPO);
let rebuiltManifest = null;
let customRuns = null;

function manifest() {
  if (!rebuiltManifest) rebuiltManifest = oracle.buildLegacyManifest(REPO);
  return rebuiltManifest;
}

function runs() {
  if (!customRuns) {
    customRuns = new Map(oracle.customValidRequests(REPO, CORPUS).map((request) => [
      request.case_id,
      oracle.executeLegacy(request, REPO, MODULES),
    ]));
  }
  return customRuns;
}

function run(id) {
  const result = runs().get(id);
  assert.ok(result, `missing hostile case ${id}`);
  assert.equal(result.accepted, true, `${id} must be accepted by production`);
  return result;
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function mutateJson(bytes, mutator) {
  const value = JSON.parse(bytes);
  mutator(value);
  return jsonBytes(value);
}

function firstKeyframeNode(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value.keyframes) && value.keyframes.length) return value;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const row of child) {
        const found = firstKeyframeNode(row);
        if (found) return found;
      }
    } else {
      const found = firstKeyframeNode(child);
      if (found) return found;
    }
  }
  return null;
}

test("direct IR hostile oracle: corpus inventory is fixed and uniquely named", () => {
  assert.equal(CORPUS.authority.baseline_commit, "f8eb499d4891ac087bf8986a92f1a7319cae6b2a");
  assert.equal(CORPUS.ordinary_valid.length, 6);
  assert.equal(CORPUS.hostile_valid.length, 37);
  assert.equal(CORPUS.invalid.length, 14);
  assert.equal(CORPUS.preserved_regressions.length, 6);
  const ids = [
    ...CORPUS.ordinary_valid,
    ...CORPUS.hostile_valid,
    ...CORPUS.invalid,
    ...CORPUS.preserved_regressions,
  ].map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "case IDs must not collide");
});

test("direct IR hostile oracle: frozen manifest matches all 148 tracked and 43 custom valid journeys", () => {
  const frozen = oracle.readJson(path.join(REPO, oracle.MANIFEST_RELATIVE_PATH));
  assert.deepEqual(manifest(), frozen);
  assert.deepEqual(frozen.counts, {
    tracked_journeys: 148,
    ordinary_valid: 6,
    hostile_valid: 37,
    invalid: 14,
    preserved_regressions: 6,
    total_valid_executions: 191,
  });
  assert.equal(frozen.records.filter((row) => row.accepted).length, 191);

  const first = { start_movements: [{ id: "s1", type: "hold" }], legs: [] };
  const laterProcess = { start_movements: [{ id: "s999", type: "hold" }], legs: [] };
  assert.deepEqual(oracle.normalizedJourneySemantics(first), oracle.normalizedJourneySemantics(laterProcess),
    "process-global editor IDs are not planner semantics");
});

test("direct IR hostile oracle: malformed structured inputs retain production rejection behavior", () => {
  const requests = oracle.invalidRequests(REPO, CORPUS);
  assert.equal(requests.length, 14);
  for (const request of requests) {
    const result = oracle.executeLegacy(request, REPO, MODULES);
    assert.equal(result.accepted, false, request.id);
    assert.ok(result.errors.some((message) => new RegExp(request.expected_error_pattern, "i").test(message)),
      `${request.id}: ${result.errors.join("; ")}`);
  }
});

test("direct IR hostile oracle: parser round-trip losses and compatibility behavior stay explicit", () => {
  const duration = run("precision-duration-rounding");
  assert.match(duration.compiled_description, /for 12\.35 seconds$/);
  assert.equal(duration.parsed.segments[0].duration_seconds, 12.35);
  assert.deepEqual([duration.parsed.segments[0].start_frame, duration.parsed.segments[0].end_frame], [0, 371]);

  const tilt = run("precision-tilt-altitude-order");
  assert.match(tilt.compiled_description, /at 991m tilted 45\.68 degrees/);
  assert.equal(tilt.parsed.segments[0].altitude_m, 991);
  assert.equal(tilt.parsed.segments[0].tilt_deg, 45.68);

  const tiny = run("precision-tiny-nonzero-tilt");
  assert.match(tiny.compiled_description, /at 1418m tilted 0 degrees/);
  assert.equal(tiny.parsed.segments[0].tilt_deg, 0);

  const zero = run("zero-tilt-and-zero-revolutions");
  assert.match(zero.compiled_description, /0 degrees clockwise/);
  assert.equal(zero.parsed.segments[0].orbit_degrees, 0);
  assert.equal(zero.parsed.segments[0].tilt_deg, 0);

  const negativeZero = run("negative-zero-tilt");
  assert.equal(Object.is(negativeZero.normalized_journey.start_movements[0].tilt_deg, -0), true,
    "the structured value retains -0 before text serialization");
  assert.match(negativeZero.compiled_description, /tilted 0 degrees/);

  const defaulted = run("timing-default-injection");
  assert.equal(defaulted.normalized_journey.start_movements[0].duration_seconds, null);
  assert.equal(defaulted.parsed.segments[0].duration_seconds, 2);
  assert.equal(defaulted.parsed.segments[0].duration_source, "explicit");

  const nulls = run("compatibility-null-optionals");
  const missing = run("compatibility-missing-optionals");
  assert.equal(nulls.compiled_description, missing.compiled_description);
  assert.deepEqual(nulls.parsed, missing.parsed);

  const ignored = run("compatibility-unknown-false-ignored");
  assert.equal(ignored.compiled_description, missing.compiled_description);
  assert.ok(!Object.hasOwn(ignored.normalized_journey, "experimental"));
  assert.ok(!Object.hasOwn(ignored.normalized_journey.start_movements[0], "enabled"));

  const emptyTravel = run("compatibility-empty-travel-default");
  assert.deepEqual(emptyTravel.parsed.segments.map((segment) => segment.action), ["hover", "fly_to"]);
  assert.equal(emptyTravel.normalized_journey.legs[0].travel[0].type, "fly");

  const numericStrings = run("compatibility-numeric-string-coercion");
  assert.match(numericStrings.compiled_description, /at 1200m tilted 45 degrees for 5 seconds/);
  assert.equal(numericStrings.normalized_journey.start.altitude_m, 1200);
});

test("direct IR hostile oracle: transition, movement-intent, provenance, and terrain awkwardness is preserved", () => {
  const leak = run("transition-mid-hold-tilt-leak");
  assert.equal(leak.parsed.segments[2].holds_camera, true);
  assert.equal(leak.parsed.segments[2].tilt_deg, 0);
  assert.equal(leak.parsed.segments[2].tilt_source, "carried_over");
  assert.equal(leak.parsed.segments[3].tilt_deg, 30);
  assert.match(leak.compiled_description, /hover over Stockholm for 2 seconds then orbit Stockholm once clockwise at 29469m tilted 30 degrees/);

  const ignoredAltitude = run("transition-mid-hold-altitude-ignored");
  assert.equal(ignoredAltitude.parsed.segments[2].altitude_m, 34028);
  assert.equal(ignoredAltitude.parsed.segments[2].altitude_source, "carried_over");
  assert.doesNotMatch(ignoredAltitude.compiled_description, /9999/);

  const staged = run("altitude-near-equal-staging");
  assert.equal(staged.parsed.segments[0].ends_at_orbit_entry, 2);
  assert.equal(staged.parsed.segments[0].altitude_m, 1000);
  assert.equal(staged.parsed.segments[1].altitude_m, 1000);

  const climb = run("movement-intent-climb-out");
  assert.equal(climb.parsed.segments[1].action, "hover");
  assert.equal(climb.parsed.segments[1].holds_camera, true);
  assert.equal(run("movement-intent-zoom-out").parsed.segments[0].action, "zoom_out");

  const terrain = run("terrain-metadata-present");
  assert.equal(terrain.parsed.segments[0].location.terrain_morphology, "sharp_peak");
  assert.equal(terrain.parsed.segments[0].altitude_source, "gazetteer");
  const coordinates = run("terrain-metadata-omitted-explicit-coordinates");
  assert.equal(coordinates.parsed.segments[0].location.source, "explicit_coordinates");
  assert.ok(!Object.hasOwn(coordinates.parsed.segments[0].location, "terrain_morphology"));

  const camera = run("camera-extra-roll-fov-ignored");
  assert.deepEqual(camera.plan.initial_camera, {
    latitude: 60.1699,
    longitude: 24.9384,
    altitude_m: 1200,
    pan_deg: 45,
    tilt_deg: 30,
  });
  assert.ok(!Object.hasOwn(camera.plan.initial_camera, "roll_deg"));
  assert.ok(!Object.hasOwn(camera.plan.initial_camera, "fov_deg"));
});

test("direct IR hostile oracle: comparator rejects tiny camera, timing, provenance, and interpolation changes", () => {
  const baseline = run("ordinary-city-travel");
  const planBytes = baseline.artifacts["shot-plan.json"];
  const espBytes = baseline.artifacts["earth-studio.esp"];

  const compact = JSON.stringify(JSON.parse(planBytes));
  const representation = oracle.compareArtifactBytes(planBytes, compact, "shot-plan.json");
  assert.equal(representation.exact, false);
  assert.deepEqual(representation.categories, ["BYTE_DIFFERENCE", "REPRESENTATION_DIFFERENCE"]);

  const planMutations = [
    (plan) => { plan.segments[0].location.longitude += 1e-9; },
    (plan) => { plan.segments[0].altitude_m += 1; },
    (plan) => { plan.segments[0].tilt_deg += 1e-9; },
    (plan) => { plan.segments[0].end_frame += 1; },
    (plan) => { plan.segments[0].action = "fly_to"; },
    (plan) => { plan.segments[0].altitude_source = "gazetteer"; },
    (plan) => { plan.motion_policy.dedupe_keyframes = false; },
  ];
  for (const mutate of planMutations) {
    const diff = oracle.compareArtifactBytes(planBytes, mutateJson(planBytes, mutate), "shot-plan.json");
    assert.ok(diff.categories.includes("SEMANTIC_DIFFERENCE"), JSON.stringify(diff));
  }

  const espValue = oracle.compareArtifactBytes(espBytes, mutateJson(espBytes, (esp) => {
    const node = firstKeyframeNode(esp);
    node.keyframes[0].value += 1e-12;
  }), "earth-studio.esp");
  assert.ok(espValue.categories.includes("SEMANTIC_DIFFERENCE"));
  assert.ok(espValue.numeric_differences.length > 0);

  const espTiming = oracle.compareArtifactBytes(espBytes, mutateJson(espBytes, (esp) => {
    const node = firstKeyframeNode(esp);
    node.keyframes[0].time += 1e-12;
  }), "earth-studio.esp");
  assert.ok(espTiming.categories.includes("SEMANTIC_DIFFERENCE"));

  const espInterpolation = oracle.compareArtifactBytes(espBytes, mutateJson(espBytes, (esp) => {
    const node = firstKeyframeNode(esp);
    node.keyframes[0].transitionOut.type = "linear";
  }), "earth-studio.esp");
  assert.ok(espInterpolation.categories.includes("SEMANTIC_DIFFERENCE"));
});

test("direct IR hostile oracle: antimeridian, heading wrap, timing, and final camera remain byte-frozen", () => {
  for (const id of [
    "coordinates-antimeridian-eastbound",
    "coordinates-antimeridian-westbound",
    "coordinates-near-positive-180",
    "coordinates-high-latitude",
    "coordinates-tiny-displacement",
  ]) {
    const result = run(id);
    assert.equal(result.deterministic, true, id);
    assert.ok(result.trajectory.tracks.length >= 5, id);
  }
  assert.equal(run("heading-explicit-zero").plan.initial_camera.pan_deg, 0);
  assert.equal(run("heading-near-360").plan.initial_camera.pan_deg, 359.999999);
  assert.equal(run("heading-one-degree").parsed.segments[0].orbit_direction, -1);
  assert.equal(run("heading-negative-one").parsed.segments[0].orbit_direction, 1);
  assert.equal(run("timing-short-legal").parsed.total_frames, 15);
  assert.equal(run("timing-long").parsed.total_frames, 3600);
});

test("direct IR hostile oracle: preserved regressions and focused red-test classifications stay in the protocol", () => {
  const frozen = manifest();
  for (const row of CORPUS.preserved_regressions) {
    if (row.source) {
      assert.ok(fs.existsSync(path.join(REPO, row.source)), row.source);
      assert.ok(frozen.records.some((record) => record.id === `tracked:${row.source}`), row.id);
    }
    for (const id of row.hostile_case_ids || []) assert.ok(runs().has(id), `${row.id}: ${id}`);
  }
  const focused = childProcess.spawnSync(process.execPath, [
    path.join(REPO, "scripts/run-earth-studio-direct-ir-focused-regressions.js"),
  ], { cwd: REPO, encoding: "utf8" });
  assert.equal(focused.status, 0, focused.stderr || focused.stdout);
  assert.match(focused.stdout, /2\/2 focused registered tests passed/);
});

test("direct IR hostile oracle: candidate protocol preserves non-JSON numbers without architecture coupling", () => {
  const nan = oracle.invalidRequests(REPO, CORPUS).find((row) => row.case_id === "invalid-continuation-nan");
  const envelope = oracle.candidateEnvelope(nan);
  const serialized = JSON.stringify(envelope);
  assert.match(serialized, /"\$number":"NaN"/);
  assert.equal(envelope.protocol, "earth-studio-direct-ir-oracle-v1");
  assert.equal(envelope.number_encoding, "special-number-tags-v1");
  assert.ok(!serialized.includes("Claude"));
});

test("direct IR hostile oracle: legacy positive control crosses the frozen adapter protocol unchanged", () => {
  const command = `${process.execPath} scripts/earth-studio-direct-ir-legacy-oracle-adapter.js`;
  const result = childProcess.spawnSync(process.execPath, [
    path.join(REPO, "scripts/run-earth-studio-direct-ir-hostile-oracle.js"),
    "--candidate-command",
    command,
  ], { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.total, 205);
  assert.equal(report.passed, 205);
  assert.equal(report.failed, 0);
});
