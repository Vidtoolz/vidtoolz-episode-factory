"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROTOCOL = "earth-studio-hold-semantics-oracle-v1";
const BASE_COMMIT = "818db55f1e88c1b014cfb5b1f1a0509e31e31a0e";
const CORPUS_RELATIVE_PATH = "tests/fixtures/earth-studio-hold-semantics-hostile-corpus.json";
const MANIFEST_RELATIVE_PATH = "tests/fixtures/earth-studio-hold-semantics-production-manifest.json";
const IDENTITIES_RELATIVE_PATH = "tests/fixtures/earth-studio-hold-semantics-oracle-identities.json";
const EXACT_ARTIFACTS = ["shot-plan.json", "earth-studio.esp"];
const PATH_NAMES = ["lane", "direct_ir"];
const JOURNEY_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" };

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadCorpus(repoRoot) {
  return readJson(path.join(repoRoot, CORPUS_RELATIVE_PATH));
}

function loadModules(repoRoot) {
  return {
    journey: require(path.join(repoRoot, "earth-studio-journey.js")),
    planner: require(path.join(repoRoot, "earth-studio-job-planner.js")),
    lane: require(path.join(repoRoot, "earth-studio-lane.js")),
    continuity: require(path.join(repoRoot, "earth-studio-motion-continuity.js")),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripEditorIds(value) {
  if (Array.isArray(value)) return value.map(stripEditorIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "id")
    .map(([key, child]) => [key, stripEditorIds(child)]));
}

function at(type, duration_seconds, extra = {}) {
  return { type, duration_seconds, ...extra };
}

function travel(type, duration_seconds, extra = {}) {
  return { type, duration_seconds, ...extra };
}

function base(start = "Paris") {
  return {
    journey_version: 1,
    pace: "calm",
    aspect: "16:9",
    start: { location: start },
    start_movements: [at("hold", 3)],
    legs: [],
  };
}

function scenarioJourney(row) {
  const fields = clone(row.fields || {});
  const duration = row.duration_seconds === undefined ? 3 : row.duration_seconds;
  const held = at("hold", duration, fields);
  const j = base();
  switch (row.scenario) {
    case "opening":
      j.start = { location: "Helsinki" };
      j.start_movements = [held, at("zoom_out", 5)];
      break;
    case "mid_after_travel":
      j.legs = [{
        destination: { location: "Colosseum", framing: "landmark" },
        travel_style: "direct",
        travel: [travel("fly", 7)],
        movements: [held, at("half_orbit", 12)],
      }];
      break;
    case "mid_after_orbit":
      j.start_movements = [at("half_orbit", 12), held];
      break;
    case "hold_before_travel":
      j.start_movements = [at("half_orbit", 12), held];
      j.legs = [{ destination: { location: "Stockholm" }, travel_style: "direct", travel: [travel("fly", 8)], movements: [] }];
      break;
    case "movement_hold_movement":
      j.start_movements = [at("zoom_in", 5), held, at("zoom_out", 5)];
      break;
    case "pause_travel":
      j.legs = [{
        destination: { location: "Stockholm" },
        travel_style: "direct",
        travel: [travel("pull_back", 5), travel("pause", duration, fields), travel("fly", 8)],
        movements: [at("hold", 3)],
      }];
      break;
    case "repeated_holds":
      j.legs = [{
        destination: { location: "Colosseum", framing: "landmark" },
        travel_style: "direct",
        travel: [travel("fly", 7)],
        movements: [at("hold", duration), held, at("zoom_out", 5)],
      }];
      break;
    case "settle_launch":
      j.start_movements = [at("half_orbit", 12), held];
      j.legs = [{ destination: { location: "Stockholm" }, travel_style: "direct", travel: [travel("fly", 8)], movements: [at("hold", 3)] }];
      break;
    case "continuation":
      j.start = {
        source: "continuation",
        location: "Paris",
        continuation: {
          continuation_state_version: 1,
          camera: { latitude: 48.82, longitude: 2.29, altitude_m: 4321, pan_deg: 37, tilt_deg: 23 },
        },
      };
      j.start_movements = [held, at("zoom_out", 5)];
      break;
    case "continuation_second_hold":
      j.start = {
        source: "continuation",
        location: "Paris",
        continuation: {
          continuation_state_version: 1,
          camera: { latitude: 48.82, longitude: 2.29, altitude_m: 4321, pan_deg: 37, tilt_deg: 23 },
        },
      };
      j.start_movements = [at("hold", 3), held, at("zoom_out", 5)];
      break;
    case "terrain":
      j.start = { location: "Helsinki" };
      j.legs = [{
        destination: { location: "Matterhorn" },
        travel_style: "direct",
        travel: [travel("fly_low", 10)],
        movements: [held, at("orbit", 14)],
      }];
      break;
    case "settle_launch_orbit":
      j.legs = [{
        destination: { location: "Colosseum", framing: "landmark" },
        travel_style: "direct",
        travel: [travel("fly", 7)],
        movements: [held, at("half_orbit", 12)],
      }];
      break;
    default:
      throw new Error(`${row.id}: unsupported corpus scenario ${row.scenario}`);
  }
  return j;
}

function evidenceLocation(scenario) {
  if (["mid_after_travel", "terrain"].includes(scenario)) return "Destination 1 movement 1";
  if (scenario === "mid_after_orbit") return "Start movement 2";
  if (scenario === "repeated_holds") return "Destination 1 movement 2";
  if (scenario === "pause_travel") return "Destination 1 travel movement 2";
  if (scenario === "continuation_second_hold") return "Start movement 2";
  throw new Error(`no forbidden-hold evidence location for ${scenario}`);
}

function positiveRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  const repairDeltaCases = new Set([
    "mid-hold-after-orbit-omitted",
    "hold-before-travel-omitted",
    "settle-launch-orbit-hold-travel",
  ]);
  return corpus.positive.map((row) => ({
    id: `positive:${row.id}`,
    kind: "positive",
    scenario: row.scenario,
    fields: clone(row.fields || {}),
    journey: scenarioJourney(row),
    job_name: `HOLD-POSITIVE-${row.id}`,
    generated_at: corpus.generated_at,
    artifact_policy: repairDeltaCases.has(row.id) ? "semantic-repair-delta-allowed" : "frozen",
  }));
}

function hostileRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  const modules = loadModules(repoRoot);
  return corpus.negative.flatMap((row) => {
    const raw = scenarioJourney(row);
    const normalized = stripEditorIds(modules.journey.normalizeJourney(clone(raw)));
    const normalizedTwice = stripEditorIds(modules.journey.normalizeJourney(clone(normalized)));
    const variants = {
      raw,
      normalized,
      normalized_twice: normalizedTwice,
      json_roundtrip: clone(raw),
    };
    return Object.entries(variants).map(([normalizationVariant, journey]) => ({
      id: `hostile:${row.id}:${normalizationVariant}`,
      kind: "hostile",
      scenario: row.scenario,
      normalization_variant: normalizationVariant,
      journey,
      job_name: `HOLD-HOSTILE-${row.id}-${normalizationVariant}`,
      generated_at: corpus.generated_at,
      expected_fields: [...row.expected_fields],
      expected_location: evidenceLocation(row.scenario),
    }));
  });
}

function trackedJourneyFiles(repoRoot) {
  const output = childProcess.execFileSync("git", ["ls-files", "package-runs/**/earth-studio/journey.json"], {
    cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  return output.trim().split(/\r?\n/).filter(Boolean).sort();
}

function laneOptions(compiled, aspect) {
  const options = { aspect: aspect || "16:9", motionPolicy: { ...JOURNEY_POLICY } };
  if (compiled && compiled.initial_camera) options.initialCamera = compiled.initial_camera;
  return options;
}

function trackedRequests(repoRoot) {
  return trackedJourneyFiles(repoRoot).map((source) => {
    const journey = readJson(path.join(repoRoot, source));
    const planPath = path.join(repoRoot, path.dirname(source), "shot-plan.json");
    if (!fs.existsSync(planPath)) throw new Error(`${source}: tracked journey has no shot-plan.json`);
    const plan = readJson(planPath);
    return {
      id: `tracked:${source}`,
      kind: "tracked-production",
      source,
      source_bytes_sha256: sha256(fs.readFileSync(path.join(repoRoot, source))),
      journey,
      job_name: plan.job_name,
      generated_at: plan.generated_at,
      aspect: plan.aspect || journey.aspect || "16:9",
    };
  });
}

function allRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  return [...trackedRequests(repoRoot), ...positiveRequests(repoRoot, corpus), ...hostileRequests(repoRoot, corpus)];
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
  });
  walk(root);
  return out.sort();
}

function artifactHashes(artifacts) {
  return Object.fromEntries(EXACT_ARTIFACTS.map((name) => {
    if (!artifacts || typeof artifacts[name] !== "string") throw new Error(`missing ${name}`);
    return [name, sha256(Buffer.from(artifacts[name], "utf8"))];
  }));
}

function cameraStateHashes(plan, modules) {
  const finalCamera = modules.planner.finalCameraState(plan);
  const continuationState = modules.journey.continuationStateFromPlan(plan);
  if (!finalCamera || !continuationState) throw new Error("camera-state authority missing");
  return {
    final_camera_sha256: sha256(Buffer.from(JSON.stringify(finalCamera))),
    continuation_state_sha256: sha256(Buffer.from(JSON.stringify(continuationState))),
  };
}

function rollKeyframeCount(espBytes) {
  const esp = JSON.parse(espBytes);
  let count = 0;
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "rotationZ" && Array.isArray(value.keyframes)) count += value.keyframes.length;
    Object.values(value).forEach(walk);
  };
  walk(esp);
  return count;
}

function positionDeltaMeters(a, b) {
  const lat = ((a.latitude + b.latitude) / 2) * Math.PI / 180;
  const dy = (b.latitude - a.latitude) * 111320;
  const dx = (b.longitude - a.longitude) * 111320 * Math.cos(lat);
  return Math.hypot(dx, dy);
}

function angularDelta(a, b) {
  return Math.abs((((Number(a) - Number(b)) + 540) % 360) - 180);
}

function buildHoldObservations(request, compiled, plan, modules, artifacts) {
  if (!compiled || !Array.isArray(compiled.steps)) throw new Error("compiled Journey steps missing");
  if (!plan || !Array.isArray(plan.segments)) throw new Error("planner segments missing");
  assert.equal(plan.segments.length, compiled.steps.length, `${request.id}: compiler/planner segment count mismatch`);
  if (!artifacts || typeof artifacts["earth-studio.esp"] !== "string") throw new Error("earth-studio.esp bytes missing from semantic observation");
  const tracks = modules.continuity.extractEspCameraTracks(JSON.parse(artifacts["earth-studio.esp"]));
  const trace = modules.continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  const value = (series, frame) => {
    const v = series && series.values ? series.values[Math.round(frame)] : undefined;
    if (!Number.isFinite(v)) throw new Error(`${request.id}: non-finite playback value at frame ${frame}`);
    return v;
  };
  const stateAt = (frame) => ({
    latitude: value(trace.lat, frame),
    longitude: value(trace.lng, frame),
    altitude_m: value(trace.alt, frame),
    pan_deg: value(trace.pan, frame),
    tilt_deg: value(trace.tilt, frame),
  });
  const rows = [];
  compiled.steps.forEach((step, index) => {
    const def = modules.journey.MOVEMENTS[step.movement];
    if (!def || !def.holdsCamera) return;
    const segment = plan.segments[index];
    const opening = index === 0;
    const start = stateAt(segment.start_frame);
    const end = stateAt(segment.end_frame);
    const maximum = { position_m: 0, altitude_m: 0, pan_deg: 0, tilt_deg: 0 };
    for (let frame = Math.round(segment.start_frame); frame <= Math.round(segment.end_frame); frame += 1) {
      const sample = stateAt(frame);
      maximum.position_m = Math.max(maximum.position_m, positionDeltaMeters(start, sample));
      maximum.altitude_m = Math.max(maximum.altitude_m, Math.abs(sample.altitude_m - start.altitude_m));
      maximum.pan_deg = Math.max(maximum.pan_deg, angularDelta(sample.pan_deg, start.pan_deg));
      maximum.tilt_deg = Math.max(maximum.tilt_deg, Math.abs(sample.tilt_deg - start.tilt_deg));
    }
    rows.push({
      index,
      movement: step.movement,
      opening,
      fields_omitted: !Object.hasOwn(request.fields || {}, "altitude_m") && !Object.hasOwn(request.fields || {}, "tilt_deg"),
      frame: { start: segment.start_frame, end: segment.end_frame },
      incoming_applied: start,
      outgoing_applied: end,
      maximum_drift: maximum,
      compiler_cursor: { altitude_m: step.altitude_m, tilt_deg: step.tilt_deg },
      planner_segment: { altitude_m: segment.altitude_m, tilt_deg: segment.tilt_deg, holds_camera: !!segment.holds_camera },
      subsequent_movement: compiled.steps[index + 1] ? {
        movement: compiled.steps[index + 1].movement,
        altitude_from_m: compiled.steps[index + 1].altitude_from_m,
      } : null,
    });
  });
  return rows;
}

function acceptedPayload(request, artifacts, compiled, plan, modules, generatedFiles) {
  const cameraStates = cameraStateHashes(plan, modules);
  return {
    accepted: true,
    artifact_sha256: artifactHashes(artifacts),
    ...cameraStates,
    roll_keyframe_count: rollKeyframeCount(artifacts["earth-studio.esp"]),
    generated_files: generatedFiles,
    holds: request.kind === "hostile" ? [] : buildHoldObservations(request, compiled, plan, modules, artifacts),
  };
}

function rejectionPayload(error, generatedFiles = []) {
  return {
    accepted: false,
    status_code: Number.isInteger(error.statusCode) ? error.statusCode : null,
    errors: Array.isArray(error.journey_errors) ? error.journey_errors.map(String) : [String(error.message || error)],
    generated_files: generatedFiles,
    artifact_sha256: {},
    final_camera_sha256: null,
    continuation_state_sha256: null,
    roll_keyframe_count: 0,
    holds: [],
  };
}

function executeLane(request, repoRoot, modules = loadModules(repoRoot)) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hold-oracle-lane-"));
  try {
    modules.lane.writeJob(tempRoot, {
      jobName: request.job_name,
      journey: clone(request.journey),
      aspect: request.aspect || request.journey.aspect || "16:9",
    }, { now: request.generated_at });
    const laneRoot = path.join(tempRoot, "earth-studio");
    const artifacts = Object.fromEntries(EXACT_ARTIFACTS.map((name) => [name, fs.readFileSync(path.join(laneRoot, name), "utf8")]));
    const check = modules.journey.validateJourney(clone(request.journey), { planner: modules.planner });
    if (!check.ok || !check.compiled) throw new Error("lane accepted but independent raw Journey validation did not return compiled state");
    const options = laneOptions(check.compiled, request.aspect || request.journey.aspect);
    const plan = readJson(path.join(laneRoot, "shot-plan.json"));
    return acceptedPayload(request, artifacts, check.compiled, plan, modules, listFiles(tempRoot));
  } catch (error) {
    return rejectionPayload(error, listFiles(tempRoot));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function executeDirect(request, repoRoot, modules = loadModules(repoRoot)) {
  try {
    const direct = modules.journey.compileJourneyToParsed(clone(request.journey), {
      planner: modules.planner,
      aspect: request.aspect || request.journey.aspect || "16:9",
    });
    const options = laneOptions(direct.compiled, request.aspect || request.journey.aspect);
    const artifacts = modules.planner.buildArtifactsFromParsed(request.job_name, direct.parsed, request.generated_at, options);
    const plan = modules.planner.buildShotPlanFromParsed(request.job_name, direct.parsed, request.generated_at, options);
    return acceptedPayload(request, artifacts, direct.compiled, plan, modules, []);
  } catch (error) {
    return rejectionPayload(error, []);
  }
}

function executeRequest(request, repoRoot, modules = loadModules(repoRoot)) {
  return {
    protocol: PROTOCOL,
    case_id: request.id,
    paths: {
      lane: executeLane(request, repoRoot, modules),
      direct_ir: executeDirect(request, repoRoot, modules),
    },
  };
}

function defectReproduction(repoRoot, modules = loadModules(repoRoot)) {
  const hostile = hostileRequests(repoRoot).find((request) => request.id === "hostile:destination-hold-tilt-30:raw");
  if (!hostile) throw new Error("cursor-leak hostile fixture missing");
  const observational = { ...hostile, kind: "positive", fields: { tilt_deg: 30 } };
  const direct = executeDirect(observational, repoRoot, modules);
  if (!direct.accepted) throw new Error(`production no longer accepts cursor-leak fixture: ${(direct.errors || []).join("; ")}`);
  const hold = direct.holds.find((row) => !row.opening && row.movement === "hold");
  const check = modules.journey.validateJourney(clone(hostile.journey), { planner: modules.planner });
  return {
    validation_accepted: check.ok,
    compiler_hold_altitude_m: hold.compiler_cursor.altitude_m,
    compiler_hold_tilt_deg: hold.compiler_cursor.tilt_deg,
    planner_hold_altitude_m: hold.planner_segment.altitude_m,
    planner_hold_tilt_deg: hold.planner_segment.tilt_deg,
    applied_hold_altitude_m: hold.outgoing_applied.altitude_m,
    applied_hold_tilt_deg: hold.outgoing_applied.tilt_deg,
    hold_physically_stationary: hold.maximum_drift.position_m <= 0.02
      && hold.maximum_drift.altitude_m <= 0.02
      && hold.maximum_drift.pan_deg <= 0.0001
      && hold.maximum_drift.tilt_deg <= 0.0001,
    following_orbit_tilt_deg: check.compiled.steps[hold.index + 1].tilt_deg,
    cursor_diverged: Math.abs(hold.compiler_cursor.tilt_deg - hold.outgoing_applied.tilt_deg) > 0.0001,
  };
}

function semanticFailures(request, pathResult) {
  const failures = [];
  if (!pathResult || !Array.isArray(pathResult.holds)) return ["hold observations missing"];
  if (!pathResult.holds.length) return request.kind === "tracked-production" ? [] : ["hold observations missing"];
  const tolerance = { position_m: 0.02, altitude_m: 0.02, pan_deg: 0.0001, tilt_deg: 0.0001 };
  for (const hold of pathResult.holds) {
    const label = `hold[${hold.index}]`;
    const incoming = hold.incoming_applied;
    const outgoing = hold.outgoing_applied;
    if (!incoming || !outgoing || !hold.compiler_cursor || !hold.planner_segment) {
      failures.push(`${label}: malformed observation`); continue;
    }
    if (!hold.opening) {
      if (positionDeltaMeters(incoming, outgoing) > tolerance.position_m) failures.push(`${label}: position moved during hold`);
      if (Math.abs(incoming.altitude_m - outgoing.altitude_m) > tolerance.altitude_m) failures.push(`${label}: altitude moved during hold`);
      if (angularDelta(incoming.pan_deg, outgoing.pan_deg) > tolerance.pan_deg) failures.push(`${label}: pan moved during hold`);
      if (Math.abs(incoming.tilt_deg - outgoing.tilt_deg) > tolerance.tilt_deg) failures.push(`${label}: tilt moved during hold`);
      if (!hold.maximum_drift) failures.push(`${label}: whole-interval drift observation missing`);
      else {
        if (hold.maximum_drift.position_m > tolerance.position_m) failures.push(`${label}: position moved within hold interval`);
        if (hold.maximum_drift.altitude_m > tolerance.altitude_m) failures.push(`${label}: altitude moved within hold interval`);
        if (hold.maximum_drift.pan_deg > tolerance.pan_deg) failures.push(`${label}: pan moved within hold interval`);
        if (hold.maximum_drift.tilt_deg > tolerance.tilt_deg) failures.push(`${label}: tilt moved within hold interval`);
      }
    }
    if (Math.abs(Number(hold.compiler_cursor.altitude_m) - outgoing.altitude_m) > tolerance.altitude_m) failures.push(`${label}: compiler altitude cursor differs from planner-applied state`);
    if (Math.abs(Number(hold.compiler_cursor.tilt_deg) - outgoing.tilt_deg) > tolerance.tilt_deg) failures.push(`${label}: compiler tilt cursor differs from planner-applied state`);
    if (Math.abs(Number(hold.planner_segment.altitude_m) - outgoing.altitude_m) > tolerance.altitude_m) failures.push(`${label}: planner segment altitude differs from applied state`);
    if (Math.abs(Number(hold.planner_segment.tilt_deg) - outgoing.tilt_deg) > tolerance.tilt_deg) failures.push(`${label}: planner segment tilt differs from applied state`);
    if (hold.subsequent_movement && Math.abs(Number(hold.subsequent_movement.altitude_from_m) - outgoing.altitude_m) > tolerance.altitude_m) {
      failures.push(`${label}: subsequent movement starts from a different compiler altitude`);
    }
  }
  if (request.scenario === "opening") {
    const opening = pathResult.holds.find((hold) => hold.opening);
    for (const field of ["altitude_m", "tilt_deg"]) {
      if (Object.hasOwn(request.fields, field) && request.fields[field] !== null
        && Math.abs(Number(opening.outgoing_applied[field]) - Number(request.fields[field])) > tolerance[field]) {
        failures.push(`opening hold did not establish explicit ${field}`);
      }
    }
  }
  return failures;
}

function manifestRecord(request, result) {
  const paths = Object.fromEntries(PATH_NAMES.map((name) => [name, {
    accepted: result.paths[name].accepted,
    artifact_sha256: result.paths[name].artifact_sha256,
    final_camera_sha256: result.paths[name].final_camera_sha256,
    continuation_state_sha256: result.paths[name].continuation_state_sha256,
    roll_keyframe_count: result.paths[name].roll_keyframe_count,
    hold_count: result.paths[name].holds.length,
    holds: result.paths[name].holds,
    generated_artifact_files: (result.paths[name].generated_files || []).filter((file) => /(?:^|\/)(?:shot-plan\.json|earth-studio\.esp)$/.test(file)),
    errors: result.paths[name].errors || [],
    semantic_failures: request.kind !== "hostile" && result.paths[name].accepted ? semanticFailures(request, result.paths[name]) : [],
  }]));
  return {
    id: request.id,
    kind: request.kind,
    ...(request.source ? { source: request.source, source_bytes_sha256: request.source_bytes_sha256 } : {}),
    ...(request.artifact_policy ? { artifact_policy: request.artifact_policy } : {}),
    ...(request.normalization_variant ? { normalization_variant: request.normalization_variant } : {}),
    ...(request.expected_fields ? { expected_fields: request.expected_fields, expected_location: request.expected_location } : {}),
    input_sha256: sha256(Buffer.from(JSON.stringify(request.journey))),
    baseline: { paths },
  };
}

function buildManifest(repoRoot) {
  const corpus = loadCorpus(repoRoot);
  const modules = loadModules(repoRoot);
  const tracked = trackedRequests(repoRoot);
  const positive = positiveRequests(repoRoot, corpus);
  const hostile = hostileRequests(repoRoot, corpus);
  assert.equal(tracked.length, 148, `tracked Journey corpus changed: expected 148, found ${tracked.length}`);
  const records = [...tracked, ...positive, ...hostile].map((request) => manifestRecord(request, executeRequest(request, repoRoot, modules)));
  return {
    schema_version: 1,
    authority_commit: BASE_COMMIT,
    generated_at: corpus.generated_at,
    contract: corpus.semantic_rule,
    counts: {
      tracked_production: tracked.length,
      tracked_forbidden_non_opening_hold_fields: countTrackedForbiddenHolds(tracked),
      positive: positive.length,
      hostile_semantic_cases: corpus.negative.length,
      hostile: hostile.length,
      normalization_variants_per_hostile: 4,
      path_executions: records.length * PATH_NAMES.length,
      tracked_hold_observations: records.filter((record) => record.kind === "tracked-production")
        .reduce((sum, record) => sum + record.baseline.paths.lane.hold_count, 0),
      tracked_non_opening_hold_observations: records.filter((record) => record.kind === "tracked-production")
        .reduce((sum, record) => sum + record.baseline.paths.lane.holds.filter((hold) => !hold.opening).length, 0),
      tracked_hold_semantic_failures: records.filter((record) => record.kind === "tracked-production")
        .reduce((sum, record) => sum + record.baseline.paths.lane.semantic_failures.length, 0),
      hostile_baseline_acceptances: hostile.reduce((sum, request) => {
        const record = records.find((row) => row.id === request.id);
        return sum + PATH_NAMES.filter((name) => record.baseline.paths[name].accepted).length;
      }, 0),
    },
    preserved_authorities: [
      "trajectory authority", "planar/spherical geometry", "TERRAIN 6.39°", "camera policy",
      "footprint law", "canaries", "PRESTO routing", "preservation authorities",
    ],
    records,
  };
}

function countTrackedForbiddenHolds(requests) {
  let count = 0;
  for (const request of requests) {
    const sequence = [];
    const journey = request.journey || {};
    (journey.start_movements || []).forEach((step) => sequence.push(step));
    (journey.legs || []).forEach((leg) => {
      (leg.travel || []).forEach((step) => sequence.push(step));
      (leg.movements || []).forEach((step) => sequence.push(step));
    });
    sequence.forEach((raw, index) => {
      const step = typeof raw === "string" ? { type: raw } : raw;
      if (!step || !["hold", "pause"].includes(step.type) || index === 0) return;
      if (["altitude_m", "tilt_deg"].some((field) => step[field] !== undefined && step[field] !== null && step[field] !== "")) count += 1;
    });
  }
  return count;
}

function envelope(request) {
  return {
    protocol: PROTOCOL,
    case_id: request.id,
    kind: request.kind,
    scenario: request.scenario || null,
    fields: request.fields || {},
    journey: request.journey,
    job_name: request.job_name,
    generated_at: request.generated_at,
    aspect: request.aspect || request.journey.aspect || "16:9",
  };
}

function requestFromEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("protocol envelope must be an object");
  if (value.protocol !== PROTOCOL) throw new Error(`unsupported protocol ${JSON.stringify(value.protocol)}`);
  for (const field of ["case_id", "kind", "job_name", "generated_at", "aspect"]) {
    if (typeof value[field] !== "string" || !value[field]) throw new Error(`protocol envelope missing ${field}`);
  }
  if (!value.journey || typeof value.journey !== "object" || Array.isArray(value.journey)) throw new Error("protocol envelope missing journey object");
  if (!value.fields || typeof value.fields !== "object" || Array.isArray(value.fields)) throw new Error("protocol envelope fields must be an object");
  return {
    id: value.case_id,
    kind: value.kind,
    scenario: value.scenario,
    fields: value.fields,
    journey: value.journey,
    job_name: value.job_name,
    generated_at: value.generated_at,
    aspect: value.aspect,
  };
}

module.exports = {
  PROTOCOL,
  BASE_COMMIT,
  CORPUS_RELATIVE_PATH,
  MANIFEST_RELATIVE_PATH,
  IDENTITIES_RELATIVE_PATH,
  EXACT_ARTIFACTS,
  PATH_NAMES,
  JOURNEY_POLICY,
  sha256,
  readJson,
  loadCorpus,
  loadModules,
  scenarioJourney,
  evidenceLocation,
  positiveRequests,
  hostileRequests,
  trackedJourneyFiles,
  trackedRequests,
  allRequests,
  listFiles,
  artifactHashes,
  positionDeltaMeters,
  angularDelta,
  buildHoldObservations,
  executeLane,
  executeDirect,
  executeRequest,
  defectReproduction,
  semanticFailures,
  manifestRecord,
  buildManifest,
  countTrackedForbiddenHolds,
  envelope,
  requestFromEnvelope,
};
