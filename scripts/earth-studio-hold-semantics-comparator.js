#!/usr/bin/env node
"use strict";

const path = require("node:path");
const oracle = require("../tests/earth-studio-hold-semantics-hostile-oracle-lib.js");

const HASH = /^[a-f0-9]{64}$/;

function fail(message) {
  return { pass: false, failures: [message] };
}

function validatePathShape(caseId, pathName, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${caseId}/${pathName}: path result must be an object`);
  if (typeof value.accepted !== "boolean") throw new Error(`${caseId}/${pathName}: accepted must be boolean`);
  if (!Array.isArray(value.generated_files) || value.generated_files.some((file) => typeof file !== "string")) {
    throw new Error(`${caseId}/${pathName}: generated_files must be a string list`);
  }
  if (!value.artifact_sha256 || typeof value.artifact_sha256 !== "object" || Array.isArray(value.artifact_sha256)) {
    throw new Error(`${caseId}/${pathName}: artifact_sha256 must be an object`);
  }
  if (!Array.isArray(value.holds)) throw new Error(`${caseId}/${pathName}: holds must be an array`);
  if (value.accepted) {
    for (const artifact of oracle.EXACT_ARTIFACTS) {
      if (!HASH.test(value.artifact_sha256[artifact] || "")) throw new Error(`${caseId}/${pathName}: missing or malformed ${artifact} hash`);
    }
  } else {
    if (!Array.isArray(value.errors) || !value.errors.length || value.errors.some((error) => typeof error !== "string" || !error)) {
      throw new Error(`${caseId}/${pathName}: rejection errors must be a non-empty string list`);
    }
  }
}

function validateResponse(request, response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error(`${request.id}: candidate response must be an object`);
  if (response.protocol !== oracle.PROTOCOL) throw new Error(`${request.id}: malformed response protocol`);
  if (response.case_id !== request.id) throw new Error(`${request.id}: response case_id mismatch`);
  if (!response.paths || typeof response.paths !== "object" || Array.isArray(response.paths)) throw new Error(`${request.id}: response paths missing`);
  const keys = Object.keys(response.paths).sort();
  if (JSON.stringify(keys) !== JSON.stringify(oracle.PATH_NAMES.slice().sort())) throw new Error(`${request.id}: response must contain exactly lane and direct_ir paths`);
  oracle.PATH_NAMES.forEach((name) => validatePathShape(request.id, name, response.paths[name]));
  return response;
}

function fieldPattern(field) {
  return new RegExp(field.replace("_", "[ _]"), "i");
}

function createdEarthStudioArtifacts(pathResult) {
  const named = (pathResult.generated_files || []).filter((file) => /(?:^|\/)(?:shot-plan\.json|earth-studio\.esp)$/.test(file));
  const returned = oracle.EXACT_ARTIFACTS.filter((name) => Object.hasOwn(pathResult.artifact_sha256, name));
  return [...new Set([...named, ...returned])];
}

function compareTracked(request, manifestRecord, response) {
  const failures = [];
  for (const name of oracle.PATH_NAMES) {
    const actual = response.paths[name];
    if (!actual.accepted) { failures.push(`${name}: tracked Journey rejected`); continue; }
    for (const artifact of oracle.EXACT_ARTIFACTS) {
      const expectedHash = manifestRecord.baseline.paths[name].artifact_sha256[artifact];
      if (actual.artifact_sha256[artifact] !== expectedHash) failures.push(`${name}: ${artifact} differs from frozen production bytes`);
    }
  }
  return { pass: failures.length === 0, failures };
}

function comparePositive(request, manifestRecord, response) {
  const failures = [];
  for (const name of oracle.PATH_NAMES) {
    const actual = response.paths[name];
    if (!actual.accepted) { failures.push(`${name}: legitimate hold journey rejected`); continue; }
    failures.push(...oracle.semanticFailures(request, actual).map((message) => `${name}: ${message}`));
    if (manifestRecord.artifact_policy === "frozen") {
      for (const artifact of oracle.EXACT_ARTIFACTS) {
        const expectedHash = manifestRecord.baseline.paths[name].artifact_sha256[artifact];
        if (actual.artifact_sha256[artifact] !== expectedHash) failures.push(`${name}: unexpected positive ${artifact} difference`);
      }
    }
  }
  if (manifestRecord.artifact_policy === "semantic-repair-delta-allowed") {
    for (const artifact of oracle.EXACT_ARTIFACTS) {
      if (response.paths.lane.artifact_sha256[artifact] !== response.paths.direct_ir.artifact_sha256[artifact]) {
        failures.push(`lane/direct_ir: ${artifact} differs for the explicitly allowed semantic repair delta`);
      }
    }
  }
  return { pass: failures.length === 0, failures };
}

function compareHostile(request, _manifestRecord, response) {
  const failures = [];
  for (const name of oracle.PATH_NAMES) {
    const actual = response.paths[name];
    if (actual.accepted) failures.push(`${name}: hostile non-opening hold was accepted`);
    if (actual.status_code !== 400) failures.push(`${name}: rejection did not report raw Journey status 400`);
    const created = createdEarthStudioArtifacts(actual);
    if (created.length) failures.push(`${name}: invalid input created Earth Studio artifacts: ${created.join(", ")}`);
    const evidence = (actual.errors || []).join("\n");
    for (const field of request.expected_fields) {
      if (!fieldPattern(field).test(evidence)) failures.push(`${name}: rejection evidence does not identify ${field}`);
    }
    if (!new RegExp(request.expected_location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(evidence)) {
      failures.push(`${name}: rejection evidence does not identify ${request.expected_location}`);
    }
  }
  return { pass: failures.length === 0, failures };
}

function compareOne(request, manifestRecord, rawResponse) {
  let response;
  try { response = validateResponse(request, rawResponse); }
  catch (error) { return fail(error.message); }
  let verdict;
  if (request.kind === "tracked-production") verdict = compareTracked(request, manifestRecord, response);
  else if (request.kind === "positive") verdict = comparePositive(request, manifestRecord, response);
  else if (request.kind === "hostile") verdict = compareHostile(request, manifestRecord, response);
  else return fail(`unsupported request kind ${request.kind}`);
  return {
    id: request.id,
    kind: request.kind,
    pass: verdict.pass,
    expected_candidate_outcome: request.kind === "hostile" ? "reject-at-raw-Journey-validation-with-zero-artifacts" : "accept",
    baseline_outcome: Object.fromEntries(oracle.PATH_NAMES.map((name) => [name, manifestRecord.baseline.paths[name].accepted ? "accepted" : "rejected"])),
    failures: verdict.failures,
  };
}

function compareAll(repoRoot, responses, manifest = oracle.readJson(path.join(repoRoot, oracle.MANIFEST_RELATIVE_PATH))) {
  if (!Array.isArray(responses)) throw new Error("candidate responses must be an array");
  const requests = oracle.allRequests(repoRoot);
  if (responses.length !== requests.length) throw new Error(`candidate returned ${responses.length} responses for ${requests.length} requests`);
  const ids = responses.map((response) => response && response.case_id);
  if (new Set(ids).size !== ids.length) throw new Error("candidate returned duplicate case_id values");
  const expectedIds = new Set(requests.map((request) => request.id));
  const extras = ids.filter((id) => !expectedIds.has(id));
  if (extras.length) throw new Error(`candidate returned unknown case ids: ${extras.join(", ")}`);
  const byId = new Map(responses.map((response) => [response.case_id, response]));
  const manifestById = new Map(manifest.records.map((record) => [record.id, record]));
  const comparisons = requests.map((request) => {
    const record = manifestById.get(request.id);
    if (!record) throw new Error(`${request.id}: missing frozen manifest record`);
    return compareOne(request, record, byId.get(request.id));
  });
  const failures = comparisons.filter((row) => !row.pass);
  return {
    protocol: oracle.PROTOCOL,
    oracle_authority_commit: manifest.authority_commit,
    counts: {
      tracked_production: comparisons.filter((row) => row.kind === "tracked-production").length,
      positive: comparisons.filter((row) => row.kind === "positive").length,
      hostile: comparisons.filter((row) => row.kind === "hostile").length,
      total: comparisons.length,
      passed: comparisons.length - failures.length,
      failed: failures.length,
    },
    pass: failures.length === 0,
    failures,
  };
}

module.exports = {
  validatePathShape,
  validateResponse,
  createdEarthStudioArtifacts,
  compareTracked,
  comparePositive,
  compareHostile,
  compareOne,
  compareAll,
};

if (require.main === module) {
  process.stderr.write("Use scripts/run-earth-studio-hold-semantics-hostile-oracle.js to run the frozen comparator.\n");
  process.exitCode = 2;
}
