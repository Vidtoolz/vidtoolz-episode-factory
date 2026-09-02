"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CORPUS_RELATIVE_PATH = "tests/fixtures/earth-studio-journey-validation-hostile-corpus.json";
const MANIFEST_RELATIVE_PATH = "tests/fixtures/earth-studio-journey-validation-legacy-manifest.json";
const SPECIAL_NUMBER_TAG = "$number";
const EXACT_PLANNER_ARTIFACTS = [
  "README.md",
  "shot-plan.json",
  "shot-plan.md",
  "route.kml",
  "earth-studio-build-checklist.md",
  "earth-studio.esp",
];

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
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, encodeSpecialNumbers(value[key])]));
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

// Movement IDs are editor identity allocated by a process-global counter.
// They never enter planner artifacts and vary with test order, so the frozen
// semantic fingerprint excludes only that non-behavioral field.
function journeySemanticIdentity(journey) {
  const withoutId = (step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return step;
    const { id: _editorIdentity, ...semantic } = step;
    return semantic;
  };
  if (!journey || typeof journey !== "object" || Array.isArray(journey)) return journey;
  return {
    ...journey,
    start_movements: Array.isArray(journey.start_movements)
      ? journey.start_movements.map(withoutId) : journey.start_movements,
    legs: Array.isArray(journey.legs) ? journey.legs.map((leg) => ({
      ...leg,
      travel: Array.isArray(leg.travel) ? leg.travel.map(withoutId) : leg.travel,
      movements: Array.isArray(leg.movements) ? leg.movements.map(withoutId) : leg.movements,
    })) : journey.legs,
  };
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
    director: require(path.join(repoRoot, "earth-studio-director.js")),
    lane: require(path.join(repoRoot, "earth-studio-lane.js")),
  };
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

function baseJourney() {
  return {
    journey_version: 1,
    pace: "calm",
    aspect: "16:9",
    start: { location: "Helsinki" },
    start_movements: [{ type: "hold", duration_seconds: 4 }],
    legs: [{
      destination: { location: "Stockholm" },
      travel_style: "direct",
      travel: [{ type: "fly" }],
      movements: [{ type: "hold", duration_seconds: 4 }],
    }],
  };
}

function clone(value) {
  return materializeSpecialNumbers(JSON.parse(JSON.stringify(encodeSpecialNumbers(value))));
}

function applyJourneyPatch(spec) {
  const journey = baseJourney();
  const patch = materializeSpecialNumbers(spec.journey_patch || {});
  if (patch.surface === "start") journey.start_movements = [clone(patch.movement)];
  else if (patch.surface === "travel") journey.legs[0].travel = [clone(patch.movement)];
  else if (patch.surface === "destination") journey.legs[0].movements = [clone(patch.movement)];
  else if (patch.surface === "travel_style") journey.legs[0].travel_style = patch.value;
  else if (patch.surface === "start_location") journey.start.location = clone(patch.value);
  else if (patch.surface === "journey_version") journey.journey_version = clone(patch.value);
  else if (patch.surface === "start_place_field") journey.start[patch.field] = clone(patch.value);
  else throw new Error(`${spec.id}: unknown journey patch surface ${patch.surface}`);
  return journey;
}

function trackedJourneyRequests(repoRoot) {
  const files = walkFiles(path.join(repoRoot, "package-runs"),
    (file) => file.endsWith(`${path.sep}earth-studio${path.sep}journey.json`));
  return files.map((file) => {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const planPath = path.join(path.dirname(file), "shot-plan.json");
    if (!fs.existsSync(planPath)) throw new Error(`tracked journey has no sibling shot-plan.json: ${rel}`);
    const plan = readJson(planPath);
    return {
      id: `tracked:${rel}`,
      kind: "tracked-production",
      source: rel,
      journey: readJson(file),
      job_name: plan.job_name || `TRACKED-${path.basename(path.dirname(path.dirname(file)))}`,
      generated_at: plan.generated_at,
      aspect: plan.aspect,
    };
  });
}

function supportedMovementRequests(repoRoot, corpus = loadCorpus(repoRoot), modules = loadModules(repoRoot)) {
  return Object.entries(modules.journey.MOVEMENTS).map(([type, def]) => {
    const journey = baseJourney();
    if (def.slot === "at") {
      journey.start_movements = [{ type, duration_seconds: type === "hold" ? 4 : 12 }];
      journey.legs = [];
    } else {
      journey.legs[0].travel = [{ type, duration_seconds: ["fly", "cruise", "fly_high", "fly_low"].includes(type) ? null : 5 }];
    }
    return {
      id: `supported-movement:${type}`,
      kind: "supported-movement",
      source: "earth-studio-journey.js:MOVEMENTS",
      journey,
      job_name: `VALID-MOVEMENT-${type}`,
      generated_at: corpus.authority.generated_at,
      aspect: "16:9",
    };
  });
}

function compatibilityRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  return corpus.compatibility_valid.map((row) => ({
    id: `compatibility:${row.id}`,
    kind: "compatibility-valid",
    source: row.reason,
    journey: materializeSpecialNumbers(row.journey),
    job_name: `VALID-COMPAT-${row.id}`,
    generated_at: corpus.authority.generated_at,
    aspect: row.journey.aspect || "16:9",
  }));
}

function directorialRequests(repoRoot, corpus = loadCorpus(repoRoot), modules = loadModules(repoRoot)) {
  return corpus.directorial_intents.map((row) => {
    const directed = modules.director.autoDirect(clone(row.intent));
    return {
      id: `directorial:${row.id}`,
      kind: "directorial-valid",
      source: "earth-studio-director.js:autoDirect",
      journey: directed.journey,
      job_name: `VALID-DIRECTOR-${row.id}`,
      generated_at: corpus.authority.generated_at,
      aspect: directed.journey.aspect || "16:9",
    };
  });
}

function allPositiveRequests(repoRoot, corpus = loadCorpus(repoRoot), modules = loadModules(repoRoot)) {
  return [
    ...trackedJourneyRequests(repoRoot),
    ...supportedMovementRequests(repoRoot, corpus, modules),
    ...compatibilityRequests(repoRoot, corpus),
    ...directorialRequests(repoRoot, corpus, modules),
  ];
}

function invalidRequests(repoRoot, corpus = loadCorpus(repoRoot)) {
  return corpus.invalid.map((row) => ({
    id: `invalid:${row.id}`,
    case_id: row.id,
    kind: "invalid",
    category: row.category,
    journey: applyJourneyPatch(row),
    expected_evidence_pattern: row.evidence_pattern,
    job_name: `INVALID-${row.id}`,
    generated_at: corpus.authority.generated_at,
    aspect: "16:9",
  }));
}

function mutationRequests(repoRoot, corpus = loadCorpus(repoRoot), modules = loadModules(repoRoot)) {
  const known = Object.keys(modules.journey.MOVEMENTS).sort();
  const configured = Object.keys(corpus.movement_mutations).sort();
  assert.deepEqual(configured, known, "mutation table must cover every authoritative movement type exactly once");
  return known.map((canonical) => {
    const def = modules.journey.MOVEMENTS[canonical];
    const mutant = corpus.movement_mutations[canonical];
    const surface = def.slot === "travel" ? "travel" : "start";
    return {
      id: `mutation:${canonical}-to-${mutant}`,
      case_id: canonical,
      kind: "mutation",
      category: `mutation-${def.slot}`,
      journey: applyJourneyPatch({ journey_patch: { surface, movement: { type: mutant, duration_seconds: 4 } } }),
      expected_evidence_pattern: mutant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      job_name: `INVALID-MUTATION-${canonical}`,
      generated_at: corpus.authority.generated_at,
      aspect: "16:9",
      canonical_type: canonical,
      mutant_type: mutant,
    };
  });
}

function allNegativeRequests(repoRoot, corpus = loadCorpus(repoRoot), modules = loadModules(repoRoot)) {
  return [...invalidRequests(repoRoot, corpus), ...mutationRequests(repoRoot, corpus, modules)];
}

function listGeneratedFiles(root) {
  if (!fs.existsSync(root)) return [];
  return walkFiles(root, () => true).map((file) => path.relative(root, file).split(path.sep).join("/"));
}

function executeLane(request, repoRoot, injectedModules = null) {
  const modules = injectedModules || loadModules(repoRoot);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "journey-validation-oracle-"));
  try {
    const payload = {
      jobName: request.job_name,
      journey: clone(request.journey),
      aspect: request.aspect || "16:9",
    };
    const result = modules.lane.writeJob(tempRoot, payload, { now: request.generated_at });
    const laneRoot = path.join(tempRoot, "earth-studio");
    const artifacts = Object.fromEntries(EXACT_PLANNER_ARTIFACTS
      .map((name) => [name, fs.readFileSync(path.join(laneRoot, name), "utf8")]));
    return {
      id: request.id,
      accepted: true,
      artifacts,
      normalized_journey: readJson(path.join(laneRoot, "journey.json")),
      generated_files: listGeneratedFiles(tempRoot),
      lane_result: result,
    };
  } catch (error) {
    return {
      id: request.id,
      accepted: false,
      errors: Array.isArray(error.journey_errors) ? [...error.journey_errors] : [String(error.message || error)],
      status_code: error.statusCode || null,
      generated_files: listGeneratedFiles(tempRoot),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function validManifestRecord(request, result) {
  return {
    id: request.id,
    kind: request.kind,
    source: request.source || null,
    input_sha256: inputHash(journeySemanticIdentity(request.journey)),
    normalized_journey_sha256: inputHash(journeySemanticIdentity(result.normalized_journey)),
    artifact_sha256: Object.fromEntries(EXACT_PLANNER_ARTIFACTS
      .map((name) => [name, sha256(result.artifacts[name])])),
    generated_files: result.generated_files,
  };
}

function invalidManifestRecord(request, result) {
  const record = {
    id: request.id,
    kind: request.kind,
    category: request.category,
    input_sha256: inputHash(request.journey),
    required_outcome: "reject-before-artifact-generation",
    expected_evidence_pattern: request.expected_evidence_pattern,
    baseline_accepted: result.accepted,
    baseline_errors: result.errors || [],
    baseline_generated_files: result.generated_files || [],
  };
  if (result.accepted) {
    record.baseline_defect_artifacts = Object.fromEntries(EXACT_PLANNER_ARTIFACTS
      .map((name) => [name, sha256(result.artifacts[name])]));
  }
  return record;
}

function reproduceDollyzoomDefect(repoRoot, modules = loadModules(repoRoot)) {
  const corpus = loadCorpus(repoRoot);
  return invalidRequests(repoRoot, corpus)
    .filter((request) => request.case_id.startsWith("dollyzoom-"))
    .map((request) => {
      const normalized = modules.journey.normalizeJourney(request.journey);
      const raw = modules.journey.validateJourney(request.journey);
      const second = modules.journey.validateJourney(normalized);
      return {
        id: request.id,
        raw_validate_ok: raw.ok,
        raw_errors: raw.errors,
        normalized_validate_ok: second.ok,
        normalized_errors: second.errors,
        normalized_actions: second.compiled ? second.compiled.steps.map((step) => step.action) : [],
      };
    });
}

function buildLegacyManifest(repoRoot) {
  const corpus = loadCorpus(repoRoot);
  const modules = loadModules(repoRoot);
  const positive = allPositiveRequests(repoRoot, corpus, modules);
  const negative = allNegativeRequests(repoRoot, corpus, modules);
  const positiveRecords = positive.map((request) => {
    const first = executeLane(request, repoRoot, modules);
    if (!first.accepted) throw new Error(`${request.id}: authoritative valid input rejected: ${first.errors.join("; ")}`);
    const second = executeLane(request, repoRoot, modules);
    assert.equal(second.accepted, true, `${request.id}: nondeterministic acceptance`);
    EXACT_PLANNER_ARTIFACTS.forEach((name) => {
      assert.equal(first.artifacts[name], second.artifacts[name], `${request.id}: ${name} nondeterministic`);
    });
    return validManifestRecord(request, first);
  });
  const negativeRecords = negative.map((request) => invalidManifestRecord(request, executeLane(request, repoRoot, modules)));
  const defects = reproduceDollyzoomDefect(repoRoot, modules);
  return {
    schema_version: 1,
    authority_commit: corpus.authority.baseline_commit,
    contract: corpus.authority.contract,
    counts: {
      tracked_production: positive.filter((row) => row.kind === "tracked-production").length,
      supported_movements: positive.filter((row) => row.kind === "supported-movement").length,
      compatibility_valid: positive.filter((row) => row.kind === "compatibility-valid").length,
      directorial_valid: positive.filter((row) => row.kind === "directorial-valid").length,
      positive_total: positive.length,
      negative_authored: negative.filter((row) => row.kind === "invalid").length,
      mutations: negative.filter((row) => row.kind === "mutation").length,
      negative_total: negative.length,
      baseline_invalid_cases_incorrectly_accepted: negativeRecords.filter((row) => row.baseline_accepted).length,
      baseline_invalid_cases_rejected: negativeRecords.filter((row) => !row.baseline_accepted).length,
      baseline_rejections_with_identifiable_evidence: negativeRecords.filter((row) =>
        !row.baseline_accepted
        && new RegExp(row.expected_evidence_pattern, "i").test((row.baseline_errors || []).join("\n"))).length,
    },
    movement_authority: Object.fromEntries(Object.entries(modules.journey.MOVEMENTS)
      .map(([key, def]) => [key, { slot: def.slot, primitive: def.primitive }])),
    documented_ambiguities: corpus.documented_ambiguities,
    dollyzoom_reproduction: defects,
    positive_records: positiveRecords,
    negative_records: negativeRecords,
  };
}

function compareCandidateResult(request, expected, candidate) {
  if (request.kind === "invalid" || request.kind === "mutation") {
    const evidence = candidate && Array.isArray(candidate.errors) ? candidate.errors.join("\n") : "";
    const generatedFiles = candidate && Array.isArray(candidate.generated_files) ? candidate.generated_files : [];
    const artifactFiles = generatedFiles.filter((file) => /(?:^|\/)(?:shot-plan\.json|earth-studio\.esp)$/.test(file));
    const evidenceMatches = new RegExp(request.expected_evidence_pattern, "i").test(evidence);
    return {
      id: request.id,
      pass: !!candidate && candidate.accepted === false && artifactFiles.length === 0 && evidenceMatches,
      expected: "reject-before-artifact-generation",
      candidate_accepted: candidate && candidate.accepted,
      artifact_files: artifactFiles,
      evidence_matches: evidenceMatches,
      errors: candidate && candidate.errors,
    };
  }
  if (!candidate || candidate.accepted !== true || !candidate.artifacts) {
    return { id: request.id, pass: false, expected: "accept-byte-identically", reason: "candidate did not accept with artifacts" };
  }
  const artifactComparisons = Object.fromEntries(EXACT_PLANNER_ARTIFACTS.map((name) => {
    const expectedBytes = expected.artifacts[name];
    const actualBytes = candidate.artifacts[name];
    return [name, {
      exact: expectedBytes === actualBytes,
      expected_sha256: sha256(expectedBytes),
      actual_sha256: typeof actualBytes === "string" ? sha256(actualBytes) : null,
    }];
  }));
  return {
    id: request.id,
    pass: Object.values(artifactComparisons).every((row) => row.exact),
    expected: "accept-byte-identically",
    artifacts: artifactComparisons,
  };
}

function candidateEnvelope(request) {
  return {
    protocol: "earth-studio-journey-validation-oracle-v1",
    case_id: request.id,
    kind: request.kind,
    category: request.category || null,
    journey: encodeSpecialNumbers(request.journey),
    job_name: request.job_name,
    generated_at: request.generated_at,
    aspect: request.aspect || "16:9",
  };
}

module.exports = {
  CORPUS_RELATIVE_PATH,
  MANIFEST_RELATIVE_PATH,
  EXACT_PLANNER_ARTIFACTS,
  sha256,
  encodeSpecialNumbers,
  materializeSpecialNumbers,
  stableJson,
  inputHash,
  journeySemanticIdentity,
  readJson,
  loadCorpus,
  loadModules,
  baseJourney,
  applyJourneyPatch,
  trackedJourneyRequests,
  supportedMovementRequests,
  compatibilityRequests,
  directorialRequests,
  allPositiveRequests,
  invalidRequests,
  mutationRequests,
  allNegativeRequests,
  listGeneratedFiles,
  executeLane,
  reproduceDollyzoomDefect,
  buildLegacyManifest,
  compareCandidateResult,
  candidateEnvelope,
};
