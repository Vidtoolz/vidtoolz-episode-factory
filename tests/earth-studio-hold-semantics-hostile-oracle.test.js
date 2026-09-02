"use strict";

const { assert, fs, path, test } = require("./_helpers.js");
const oracle = require("./earth-studio-hold-semantics-hostile-oracle-lib.js");
const comparator = require("../scripts/earth-studio-hold-semantics-comparator.js");

const ROOT = path.resolve(__dirname, "..");
const corpus = oracle.loadCorpus(ROOT);
const modules = oracle.loadModules(ROOT);
const frozen = oracle.readJson(path.join(ROOT, oracle.MANIFEST_RELATIVE_PATH));
let rebuilt = null;

test("hold oracle: corpus freezes opening, omitted-hold, terminal-hold, lane, Direct IR, terrain and pause semantics", () => {
  assert.match(corpus.semantic_rule, /owns time, not camera motion/i);
  assert.equal(corpus.positive.length, 16);
  assert.equal(corpus.negative.length, 16);
  assert.ok(corpus.positive.some((row) => row.scenario === "opening" && Object.keys(row.fields).length === 2));
  assert.ok(corpus.positive.some((row) => row.scenario === "mid_after_orbit"), "terminal hold coverage missing");
  assert.ok(corpus.positive.some((row) => row.scenario === "pause_travel"));
  assert.ok(corpus.positive.some((row) => row.scenario === "terrain"));
  assert.ok(corpus.negative.some((row) => row.expected_fields.length === 2));
});

test("hold oracle: current production independently reproduces the hostile tilt cursor defect", () => {
  const defect = oracle.defectReproduction(ROOT, modules);
  assert.equal(defect.validation_accepted, true);
  assert.equal(defect.compiler_hold_tilt_deg, 30);
  assert.equal(defect.planner_hold_tilt_deg, 0);
  assert.equal(defect.applied_hold_tilt_deg, 0);
  assert.equal(defect.hold_physically_stationary, true);
  assert.equal(defect.following_orbit_tilt_deg, 30);
  assert.equal(defect.cursor_diverged, true);
});

test("hold oracle: all hostile fields are accepted by current production on both paths, proving the collision", () => {
  const records = frozen.records.filter((record) => record.kind === "hostile");
  assert.equal(records.length, 16);
  for (const record of records) {
    for (const name of oracle.PATH_NAMES) {
      assert.equal(record.baseline.paths[name].accepted, true, `${record.id}/${name}`);
      assert.deepEqual(Object.keys(record.baseline.paths[name].artifact_sha256).sort(), oracle.EXACT_ARTIFACTS.slice().sort());
    }
  }
  assert.equal(frozen.counts.hostile_baseline_acceptances, 32);
});

test("hold oracle: exactly 148 tracked Journey inputs are frozen and contain no forbidden hold fields", () => {
  const requests = oracle.trackedRequests(ROOT);
  assert.equal(requests.length, 148);
  assert.equal(oracle.countTrackedForbiddenHolds(requests), 0);
  assert.equal(frozen.counts.tracked_production, 148);
  assert.equal(frozen.counts.tracked_forbidden_non_opening_hold_fields, 0);
});

test("hold oracle: every tracked Journey freezes byte-exact shot-plan and ESP identities on lane and Direct IR", () => {
  const records = frozen.records.filter((record) => record.kind === "tracked-production");
  assert.equal(records.length, 148);
  for (const record of records) {
    const lane = record.baseline.paths.lane.artifact_sha256;
    const direct = record.baseline.paths.direct_ir.artifact_sha256;
    assert.deepEqual(direct, lane, `${record.id}: lane/Direct IR baseline differs`);
    for (const name of oracle.EXACT_ARTIFACTS) assert.match(lane[name], /^[a-f0-9]{64}$/);
  }
});

test("hold oracle: legitimate baseline semantics pass where already implemented and known positive defects stay characterized", () => {
  const records = frozen.records.filter((record) => record.kind === "positive");
  const failing = records.filter((record) => oracle.PATH_NAMES.some((name) => record.baseline.paths[name].semantic_failures.length));
    assert.deepEqual(failing.map((record) => record.id), [
      "positive:mid-hold-after-orbit-omitted",
      "positive:hold-before-travel-omitted",
      "positive:settle-launch-orbit-hold-travel",
      "positive:continuation-opening-hold-omitted",
    ]);
  const passing = records.filter((record) => !failing.includes(record));
  assert.equal(passing.length, 12);
  assert.ok(passing.some((record) => record.id === "positive:opening-hold-explicit-both"));
  assert.ok(passing.some((record) => record.id === "positive:orbit-staging-fly-hold-orbit"));
  assert.ok(passing.some((record) => record.id === "positive:terrain-matterhorn-hold-omitted"));
});

test("hold oracle: comparator distinguishes baseline acceptance from required candidate rejection", () => {
  const request = oracle.hostileRequests(ROOT)[0];
  const record = frozen.records.find((row) => row.id === request.id);
  const baseline = oracle.executeRequest(request, ROOT, modules);
  const collision = comparator.compareOne(request, record, baseline);
  assert.equal(collision.pass, false);
  assert.deepEqual(collision.baseline_outcome, { lane: "accepted", direct_ir: "accepted" });
  assert.ok(collision.failures.some((message) => /hostile non-opening hold was accepted/.test(message)));
  const rejected = {
    protocol: oracle.PROTOCOL,
    case_id: request.id,
    paths: Object.fromEntries(oracle.PATH_NAMES.map((name) => [name, {
      accepted: false,
      status_code: 400,
      errors: [`${request.expected_location} forbids ${request.expected_fields.join(" and ")}`],
      generated_files: [],
      artifact_sha256: {},
      holds: [],
    }])),
  };
  assert.equal(comparator.compareOne(request, record, rejected).pass, true);
});

test("hold oracle: comparator fails closed on malformed protocol, missing output, artifacts on rejection and hash mismatch", () => {
  const request = oracle.hostileRequests(ROOT)[0];
  const record = frozen.records.find((row) => row.id === request.id);
  assert.equal(comparator.compareOne(request, record, null).pass, false);
  assert.equal(comparator.compareOne(request, record, { protocol: "wrong", case_id: request.id, paths: {} }).pass, false);
  const artifactLeak = {
    protocol: oracle.PROTOCOL,
    case_id: request.id,
    paths: Object.fromEntries(oracle.PATH_NAMES.map((name) => [name, {
      accepted: false, status_code: 400,
      errors: [`${request.expected_location}: ${request.expected_fields.join(" ")}`],
      generated_files: ["earth-studio/shot-plan.json"], artifact_sha256: {}, holds: [],
    }])),
  };
  assert.equal(comparator.compareOne(request, record, artifactLeak).pass, false);
  const positive = oracle.positiveRequests(ROOT)[0];
  const positiveRecord = frozen.records.find((row) => row.id === positive.id);
  const response = oracle.executeRequest(positive, ROOT, modules);
  response.paths.lane.artifact_sha256["shot-plan.json"] = "0".repeat(64);
  assert.equal(comparator.compareOne(positive, positiveRecord, response).pass, false);
});

test("hold oracle: every existing invalid hold fixture is classified exactly and existing tests remain unedited", () => {
  const rows = corpus.existing_invalid_hold_fixtures;
  assert.equal(rows.length, 12);
  assert.ok(rows.every((row) => row.semantically_invalid === true && row.classification && row.restatement));
  const names = new Set(rows.map((row) => row.test));
  assert.equal(names.size, 12);
  for (const row of rows) {
    const source = fs.readFileSync(path.join(ROOT, row.file), "utf8");
    const literalName = row.test.replace(/^path-equivalence adversarial: /, "");
    assert.ok(source.includes(literalName), `${row.file}: missing classified test ${row.test}`);
  }
  assert.equal(corpus.nearby_valid_hold_fixtures.length, 4);
});

test("hold oracle: exclusions and production manifest reproduce exactly", () => {
  assert.deepEqual(frozen.preserved_authorities, [
    "trajectory authority", "planar/spherical geometry", "TERRAIN 6.39°", "camera policy",
    "footprint law", "canaries", "PRESTO routing", "preservation authorities",
  ]);
  rebuilt ||= oracle.buildManifest(ROOT);
  assert.deepEqual(rebuilt, frozen);
});
