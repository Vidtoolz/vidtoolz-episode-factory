"use strict";

const path = require("node:path");
const { assert, test } = require("./_helpers.js");
const oracle = require("./earth-studio-journey-validation-hostile-oracle-lib.js");

const repoRoot = path.resolve(__dirname, "..");
const corpus = oracle.loadCorpus(repoRoot);
const modules = oracle.loadModules(repoRoot);
const frozenManifest = oracle.readJson(path.join(repoRoot, oracle.MANIFEST_RELATIVE_PATH));
let currentManifest = null;
function manifest() {
  if (!currentManifest) currentManifest = oracle.buildLegacyManifest(repoRoot);
  return currentManifest;
}

test("journey validation oracle: movement authority is exactly the 18 production catalogue entries", () => {
  assert.deepEqual(Object.keys(modules.journey.MOVEMENTS).sort(), Object.keys(corpus.movement_mutations).sort());
  assert.equal(modules.journey.AT_MOVEMENT_KEYS.length, 10);
  assert.equal(modules.journey.TRAVEL_MOVEMENT_KEYS.length, 8);
});

test("journey validation oracle: accepted identities intentionally collapse to five planner primitives", () => {
  const byPrimitive = {};
  Object.entries(modules.journey.MOVEMENTS).forEach(([key, def]) => {
    (byPrimitive[def.primitive] ||= []).push(key);
  });
  Object.values(byPrimitive).forEach((keys) => keys.sort());
  assert.deepEqual(byPrimitive, {
    hover: ["hold", "pause"],
    orbit: ["half_orbit", "orbit", "orbit_twice", "slow_orbit", "spiral_in", "spiral_out"],
    zoom_in: ["descend", "zoom_in"],
    zoom_out: ["climb_to_transit", "pull_back", "reveal", "zoom_out"],
    fly_to: ["cruise", "fly", "fly_high", "fly_low"],
  });
});

test("journey validation oracle: dollyzoom defect is reproduced at all three ingestion positions", () => {
  const rows = oracle.reproduceDollyzoomDefect(repoRoot, modules);
  assert.equal(rows.length, 3);
  rows.forEach((row) => {
    assert.equal(row.raw_validate_ok, false, `${row.id}: raw identity must initially be visible`);
    assert.match(row.raw_errors.join("\n"), /dollyzoom/i);
    assert.equal(row.normalized_validate_ok, true, `${row.id}: baseline defect must remain characterized`);
  });
});

test("journey validation oracle: all 148 tracked production journeys retain exact baseline artifacts", () => {
  const records = manifest().positive_records.filter((row) => row.kind === "tracked-production");
  assert.equal(records.length, 148);
  records.forEach((row) => assert.deepEqual(Object.keys(row.artifact_sha256).sort(), oracle.EXACT_PLANNER_ARTIFACTS.slice().sort()));
});

test("journey validation oracle: every supported movement validates in its authoritative slot", () => {
  const requests = oracle.supportedMovementRequests(repoRoot, corpus, modules);
  assert.equal(requests.length, 18);
  requests.forEach((request) => assert.equal(oracle.executeLane(request, repoRoot, modules).accepted, true, request.id));
});

test("journey validation oracle: documented compatibility representations stay valid", () => {
  const requests = oracle.compatibilityRequests(repoRoot, corpus);
  assert.equal(requests.length, 10);
  requests.forEach((request) => assert.equal(oracle.executeLane(request, repoRoot, modules).accepted, true, request.id));
});

test("journey validation oracle: directorial and terrain-derived journeys remain valid", () => {
  const requests = oracle.directorialRequests(repoRoot, corpus, modules);
  assert.equal(requests.length, 3);
  requests.forEach((request) => assert.equal(oracle.executeLane(request, repoRoot, modules).accepted, true, request.id));
  assert.ok(requests.some((request) => /Matterhorn/.test(JSON.stringify(request.journey))));
});

test("journey validation oracle: negative and mutation corpora cover every invalid-intent family", () => {
  const authored = oracle.invalidRequests(repoRoot, corpus);
  const mutations = oracle.mutationRequests(repoRoot, corpus, modules);
  assert.equal(authored.length, 40);
  assert.equal(mutations.length, 18);
  assert.deepEqual(new Set(mutations.map((row) => row.canonical_type)), new Set(Object.keys(modules.journey.MOVEMENTS)));
  ["unsupported-placement", "unknown-movement", "malformed-movement-type", "malformed-movement-record",
    "wrong-slot", "unsupported-enum", "invalid-direction", "invalid-revolutions", "invalid-timing",
    "malformed-coordinate", "unsupported-version", "invalid-numeric"].forEach((category) => {
    assert.ok(authored.some((row) => row.category === category), `missing negative category ${category}`);
  });
});

test("journey validation oracle: rejection requires evidence and prohibits artifact generation", () => {
  const request = oracle.invalidRequests(repoRoot, corpus).find((row) => row.case_id === "dollyzoom-start");
  assert.equal(oracle.compareCandidateResult(request, null, {
    accepted: false, errors: ["unsupported movement dollyzoom"], generated_files: [],
  }).pass, true);
  assert.equal(oracle.compareCandidateResult(request, null, {
    accepted: true, errors: [], generated_files: ["earth-studio/shot-plan.json"],
  }).pass, false);
  assert.equal(oracle.compareCandidateResult(request, null, {
    accepted: false, errors: ["invalid input"], generated_files: [],
  }).pass, false, "the rejected intent must remain identifiable in error evidence");
});

test("journey validation oracle: frozen production manifest reproduces exactly", () => {
  assert.deepEqual(manifest(), frozenManifest);
});
