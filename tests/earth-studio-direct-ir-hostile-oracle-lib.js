"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

const CORPUS_RELATIVE_PATH = "tests/fixtures/earth-studio-direct-ir-hostile-corpus.json";
const MANIFEST_RELATIVE_PATH = "tests/fixtures/earth-studio-direct-ir-legacy-oracle-manifest.json";
const SPECIAL_NUMBER_TAG = "$number";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encodeSpecialNumbers(value) {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { [SPECIAL_NUMBER_TAG]: "NaN" };
    if (value === Infinity) return { [SPECIAL_NUMBER_TAG]: "Infinity" };
    if (value === -Infinity) return { [SPECIAL_NUMBER_TAG]: "-Infinity" };
    if (Object.is(value, -0)) return { [SPECIAL_NUMBER_TAG]: "-0" };
    return value;
  }
  if (Array.isArray(value)) return value.map(encodeSpecialNumbers);
  if (!value || typeof value !== "object") return value;
  const out = {};
  Object.keys(value).sort().forEach((key) => { out[key] = encodeSpecialNumbers(value[key]); });
  return out;
}

function materializeSpecialNumbers(value) {
  if (Array.isArray(value)) return value.map(materializeSpecialNumbers);
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 1 && Object.hasOwn(value, SPECIAL_NUMBER_TAG)) {
    const tag = value[SPECIAL_NUMBER_TAG];
    if (tag === "NaN") return NaN;
    if (tag === "Infinity") return Infinity;
    if (tag === "-Infinity") return -Infinity;
    if (tag === "-0") return -0;
    throw new Error(`unsupported special number tag: ${tag}`);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materializeSpecialNumbers(child)]));
}

function stableJson(value) {
  return JSON.stringify(encodeSpecialNumbers(value));
}

function inputHash(value) {
  return sha256(stableJson(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadCorpus(repoRoot) {
  return readJson(path.join(repoRoot, CORPUS_RELATIVE_PATH));
}

function walkFiles(root, predicate) {
  const found = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && predicate(full)) found.push(full);
    }
  };
  visit(root);
  return found.sort();
}

function loadModules(repoRoot) {
  return {
    planner: require(path.join(repoRoot, "earth-studio-job-planner.js")),
    journeyModel: require(path.join(repoRoot, "earth-studio-journey.js")),
  };
}

function trackedJourneyRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  const packageRoot = path.join(repoRoot, "package-runs");
  const files = walkFiles(packageRoot, (file) => file.endsWith(`${path.sep}earth-studio${path.sep}journey.json`));
  return files.map((file) => {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const planPath = path.join(path.dirname(file), "shot-plan.json");
    if (!fs.existsSync(planPath)) throw new Error(`tracked journey has no sibling shot-plan.json: ${rel}`);
    const plan = readJson(planPath);
    return {
      id: `tracked:${rel}`,
      kind: "tracked_journey",
      source: rel,
      journey: readJson(file),
      job_name: plan.job_name,
      generated_at: plan.generated_at,
      options: {
        aspect: plan.aspect || undefined,
        ...(plan.initial_camera ? { initialCamera: plan.initial_camera } : {}),
        motionPolicy: plan.motion_policy || corpus.authority.motion_policy,
      },
    };
  });
}

function customValidRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  const make = (row, kind) => ({
    id: `${kind}:${row.id}`,
    case_id: row.id,
    kind,
    journey: materializeSpecialNumbers(row.journey),
    job_name: `HOSTILE-${row.id}`,
    generated_at: corpus.authority.generated_at,
    options: {
      aspect: row.journey.aspect || "16:9",
      motionPolicy: corpus.authority.motion_policy,
    },
  });
  return [
    ...corpus.ordinary_valid.map((row) => make(row, "ordinary_valid")),
    ...corpus.hostile_valid.map((row) => make(row, "hostile_valid")),
  ];
}

function invalidRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  return corpus.invalid.map((row) => ({
    id: `invalid:${row.id}`,
    case_id: row.id,
    kind: "invalid",
    journey: materializeSpecialNumbers(row.journey),
    expected_error_pattern: row.expected_error_pattern,
  }));
}

function allValidRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  return [...trackedJourneyRequests(repoRoot, corpus), ...customValidRequests(repoRoot, corpus)];
}

function extractEspTrajectory(esp) {
  const tracks = [];
  const visit = (value, trail) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, [...trail, String(index)]));
      return;
    }
    if (!value || typeof value !== "object") return;
    const typeTrail = value.type ? [...trail, String(value.type)] : trail;
    if (Array.isArray(value.keyframes)) {
      tracks.push({
        path: typeTrail.join("/"),
        type: value.type || null,
        value: value.value === undefined ? null : value.value,
        keyframes: value.keyframes,
      });
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "keyframes") continue;
      visit(child, typeTrail.length === trail.length ? [...trail, key] : typeTrail);
    }
  };
  visit(esp, []);
  return {
    settings: esp && esp.settings,
    scene_durations: Array.isArray(esp && esp.scenes) ? esp.scenes.map((scene) => scene.duration) : [],
    tracks,
  };
}

function executeLegacy(request, repoRoot, injectedModules = null) {
  const { planner, journeyModel } = injectedModules || loadModules(repoRoot);
  const check = journeyModel.validateJourney(request.journey, { planner });
  if (!check.ok) {
    return {
      id: request.id,
      accepted: false,
      errors: [...check.errors],
      warnings: [...check.warnings],
    };
  }
  const compiled = check.compiled || journeyModel.compileJourney(request.journey, { planner });
  const options = { ...(request.options || {}) };
  if (!options.aspect) options.aspect = compiled.journey.aspect || planner.DEFAULT_ASPECT;
  if (!options.initialCamera && compiled.initial_camera) options.initialCamera = compiled.initial_camera;
  const build = () => planner.buildArtifacts(
    request.job_name,
    compiled.description,
    request.generated_at,
    options,
  );
  const artifacts = build();
  const secondArtifacts = build();
  const parsed = planner.parseDescription(compiled.description, { aspect: options.aspect });
  const planBytes = artifacts["shot-plan.json"];
  const espBytes = artifacts["earth-studio.esp"];
  const plan = JSON.parse(planBytes);
  const esp = JSON.parse(espBytes);
  const trajectory = extractEspTrajectory(esp);
  return {
    id: request.id,
    accepted: true,
    normalized_journey: compiled.journey,
    compiled_description: compiled.description,
    compiled_steps: compiled.steps,
    parsed,
    options,
    artifacts: {
      "shot-plan.json": planBytes,
      "earth-studio.esp": espBytes,
    },
    deterministic: planBytes === secondArtifacts["shot-plan.json"]
      && espBytes === secondArtifacts["earth-studio.esp"],
    plan,
    esp,
    trajectory,
    final_camera: planner.finalCameraState(plan),
  };
}

// normalizeJourney allocates movement IDs from a process-global counter. Those
// IDs are editor identity, are not serialized into the planner description,
// and can legitimately differ depending on which tests ran earlier in the same
// process. Keep every behavior-bearing normalized field while excluding only
// that non-semantic allocation detail from the frozen production fingerprint.
function normalizedJourneySemantics(journey) {
  const withoutStepId = (step) => {
    if (!step || typeof step !== "object") return step;
    const { id: _editorIdentity, ...semantic } = step;
    return semantic;
  };
  return {
    ...journey,
    start_movements: (journey.start_movements || []).map(withoutStepId),
    legs: (journey.legs || []).map((leg) => ({
      ...leg,
      travel: (leg.travel || []).map(withoutStepId),
      movements: (leg.movements || []).map(withoutStepId),
    })),
  };
}

function manifestRecord(request, result) {
  const base = {
    id: request.id,
    kind: request.kind,
    source: request.source || null,
    input_sha256: inputHash(request.journey),
    accepted: result.accepted,
  };
  if (!result.accepted) {
    return {
      ...base,
      expected_error_pattern: request.expected_error_pattern,
      legacy_errors: result.errors,
    };
  }
  return {
    ...base,
    normalized_semantics_sha256: inputHash(normalizedJourneySemantics(result.normalized_journey)),
    description: result.compiled_description,
    description_sha256: sha256(result.compiled_description),
    parsed_sha256: sha256(JSON.stringify(result.parsed)),
    shot_plan_sha256: sha256(result.artifacts["shot-plan.json"]),
    esp_sha256: sha256(result.artifacts["earth-studio.esp"]),
    trajectory_sha256: sha256(JSON.stringify(result.trajectory)),
    final_camera: result.final_camera,
    segment_count: result.parsed.segments.length,
    total_frames: result.parsed.total_frames,
  };
}

function buildLegacyManifest(repoRoot) {
  const corpus = loadCorpus(repoRoot);
  const modules = loadModules(repoRoot);
  const valid = allValidRequests(repoRoot, corpus);
  const invalid = invalidRequests(repoRoot, corpus);
  const validRecords = valid.map((request) => {
    const result = executeLegacy(request, repoRoot, modules);
    if (!result.accepted) throw new Error(`${request.id}: production unexpectedly rejected: ${result.errors.join("; ")}`);
    if (!result.deterministic) throw new Error(`${request.id}: production artifacts are nondeterministic`);
    return manifestRecord(request, result);
  });
  const invalidRecords = invalid.map((request) => {
    const result = executeLegacy(request, repoRoot, modules);
    if (result.accepted) throw new Error(`${request.id}: production unexpectedly accepted malformed input`);
    if (!result.errors.some((message) => new RegExp(request.expected_error_pattern, "i").test(message))) {
      throw new Error(`${request.id}: rejection did not match /${request.expected_error_pattern}/: ${result.errors.join("; ")}`);
    }
    return manifestRecord(request, result);
  });
  return {
    schema_version: 1,
    authority_commit: corpus.authority.baseline_commit,
    contract: "legacy compileJourney English -> parseDescription -> buildArtifacts",
    counts: {
      tracked_journeys: valid.filter((row) => row.kind === "tracked_journey").length,
      ordinary_valid: corpus.ordinary_valid.length,
      hostile_valid: corpus.hostile_valid.length,
      invalid: corpus.invalid.length,
      preserved_regressions: corpus.preserved_regressions.length,
      total_valid_executions: valid.length,
    },
    focused_registered_tests: corpus.focused_registered_tests,
    records: [...validRecords, ...invalidRecords],
  };
}

function semanticPlanProjection(plan) {
  const keys = [
    "source_description",
    "parser_strategy",
    "frame_rate",
    "frame_convention",
    "aspect",
    "render_dimensions",
    "total_duration_seconds",
    "total_frames",
    "initial_camera",
    "motion_policy",
    "locations",
    "segments",
    "unresolved_items",
    "notes",
    "warnings",
  ];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(plan || {}, key)).map((key) => [key, plan[key]]));
}

function numericDifferences(expected, actual, trail = [], out = []) {
  if (typeof expected === "number" && typeof actual === "number" && !Object.is(expected, actual)) {
    out.push({ path: trail.join("."), expected, actual });
    return out;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let i = 0; i < length; i += 1) numericDifferences(expected[i], actual[i], [...trail, String(i)], out);
    return out;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) numericDifferences(expected[key], actual[key], [...trail, key], out);
  }
  return out;
}

function compareArtifactBytes(expectedBytes, actualBytes, artifactName) {
  if (expectedBytes === actualBytes) {
    return {
      artifact: artifactName,
      exact: true,
      categories: [],
      tolerance: "none; serialized numbers and keyframe values are exact",
      numeric_differences: [],
    };
  }
  const result = {
    artifact: artifactName,
    exact: false,
    categories: ["BYTE_DIFFERENCE"],
    tolerance: "none; serialized numbers and keyframe values are exact",
    numeric_differences: [],
  };
  let expected;
  let actual;
  try {
    expected = JSON.parse(expectedBytes);
    actual = JSON.parse(actualBytes);
  } catch (error) {
    result.categories.push("SEMANTIC_DIFFERENCE");
    result.parse_error = error.message;
    return result;
  }
  result.numeric_differences = numericDifferences(expected, actual);
  if (util.isDeepStrictEqual(expected, actual)) {
    result.categories.push("REPRESENTATION_DIFFERENCE");
    return result;
  }
  if (artifactName === "shot-plan.json"
      && util.isDeepStrictEqual(semanticPlanProjection(expected), semanticPlanProjection(actual))) {
    result.categories.push("REPRESENTATION_DIFFERENCE");
  } else {
    result.categories.push("SEMANTIC_DIFFERENCE");
  }
  return result;
}

function compareCandidateResult(expected, candidate) {
  if (!expected.accepted) {
    return {
      id: expected.id,
      pass: !!candidate && candidate.accepted === false,
      expected_rejection: true,
      candidate_accepted: candidate && candidate.accepted,
    };
  }
  if (!candidate || candidate.accepted !== true || !candidate.artifacts) {
    return {
      id: expected.id,
      pass: false,
      expected_rejection: false,
      reason: "candidate did not return an accepted result with artifacts",
    };
  }
  const comparisons = ["shot-plan.json", "earth-studio.esp"].map((name) =>
    compareArtifactBytes(expected.artifacts[name], candidate.artifacts[name], name));
  const canonical = candidate.parsed === undefined ? null : {
    exact: util.isDeepStrictEqual(expected.parsed, candidate.parsed),
    expected_sha256: sha256(JSON.stringify(expected.parsed)),
    actual_sha256: sha256(JSON.stringify(candidate.parsed)),
  };
  return {
    id: expected.id,
    pass: comparisons.every((row) => row.exact) && (!canonical || canonical.exact),
    comparisons,
    canonical,
  };
}

function candidateEnvelope(request) {
  return {
    protocol: "earth-studio-direct-ir-oracle-v1",
    case_id: request.id,
    kind: request.kind,
    number_encoding: "special-number-tags-v1",
    journey: encodeSpecialNumbers(request.journey),
    job_name: request.job_name || null,
    generated_at: request.generated_at || null,
    options: encodeSpecialNumbers(request.options || {}),
  };
}

module.exports = {
  CORPUS_RELATIVE_PATH,
  MANIFEST_RELATIVE_PATH,
  sha256,
  encodeSpecialNumbers,
  materializeSpecialNumbers,
  stableJson,
  inputHash,
  readJson,
  loadCorpus,
  loadModules,
  trackedJourneyRequests,
  customValidRequests,
  invalidRequests,
  allValidRequests,
  extractEspTrajectory,
  executeLegacy,
  normalizedJourneySemantics,
  manifestRecord,
  buildLegacyManifest,
  semanticPlanProjection,
  numericDifferences,
  compareArtifactBytes,
  compareCandidateResult,
  candidateEnvelope,
};
