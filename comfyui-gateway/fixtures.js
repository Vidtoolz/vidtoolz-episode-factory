'use strict';
// VIDTOOLZ ComfyUI Production Gateway — canonical qualification fixtures.
//
// A fixture is the repeatable definition of one qualification render: which
// registered workflow, byte-exact prompt, fixed seed, pinned source-image
// hash, and the technical output contract the artifact must satisfy.
// Fixtures are source-controlled (config/comfyui/qualification-fixtures.json)
// so a qualification run means the same thing every time it is repeated.
//
// A malformed fixture must fail HERE — before any GPU work.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const registry = require('./registry.js');
const contracts = require('./contracts.js');
const { canonicalJson } = require('./fingerprint.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURES_PATH = path.join(REPO_ROOT, 'config', 'comfyui', 'qualification-fixtures.json');

function loadFixtures(options = {}) {
  const filePath = options.fixturesPath || FIXTURES_PATH;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed.fixtures)) throw new Error(`qualification fixtures file has no fixtures array: ${filePath}`);
  return parsed;
}

function getFixture(fixtureId, options = {}) {
  const parsed = options.fixtures || loadFixtures(options);
  const fixture = parsed.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) {
    const e = new Error(`unknown qualification fixture "${fixtureId}" (available: ${parsed.fixtures.map((f) => f.id).join(', ')})`);
    e.code = 'comfyui_fixture_unknown';
    e.statusCode = 404;
    throw e;
  }
  return fixture;
}

// The default fixture for a workflow — one fixture per workflow by convention.
function getFixtureForWorkflow(workflowId, options = {}) {
  const parsed = options.fixtures || loadFixtures(options);
  const fixture = parsed.fixtures.find((f) => f.workflow === workflowId);
  if (!fixture) {
    const e = new Error(`workflow "${workflowId}" has no qualification fixture in config/comfyui/qualification-fixtures.json`);
    e.code = 'comfyui_fixture_unknown';
    e.statusCode = 404;
    throw e;
  }
  return fixture;
}

function sourceImageAbsolute(fixture, options = {}) {
  const rel = fixture.params && fixture.params.source_image;
  if (!rel) return null;
  return path.isAbsolute(rel) ? rel : path.join(options.repoRoot || REPO_ROOT, rel);
}

// Deterministic identity of the fixture's semantic parameters (prompt, seed,
// source hash) — recorded in qualification records so evidence states exactly
// which request produced it.
function parameterSha256(fixture) {
  return crypto.createHash('sha256')
    .update(canonicalJson({ params: fixture.params, seed: fixture.seed, source_sha256: fixture.source_sha256 || null }))
    .digest('hex');
}

// Validate one fixture end-to-end against the registry. Returns
// { ok, problems, entry, params } — params resolved with absolute source path.
function validateFixture(fixture, options = {}) {
  const problems = [];
  let entry = null;
  try {
    entry = registry.getWorkflow(fixture.workflow, { ...options, version: fixture.workflow_version });
  } catch (err) {
    return { ok: false, problems: [`workflow: ${err.message}`], entry: null, params: null };
  }
  if (!Number.isInteger(fixture.seed)) problems.push('seed must be a fixed integer — qualification renders are repeatable');
  if (!fixture.expected || typeof fixture.expected !== 'object') problems.push('expected technical contract missing');
  else if (entry.expected_output) {
    for (const key of ['media_type', 'width', 'height']) {
      if (entry.expected_output[key] != null && fixture.expected[key] !== entry.expected_output[key]) {
        problems.push(`expected.${key} (${fixture.expected[key]}) disagrees with the registry contract (${entry.expected_output[key]})`);
      }
    }
  }

  const params = { ...(fixture.params || {}) };
  const sourceAbs = sourceImageAbsolute(fixture, options);
  if (sourceAbs) {
    params.source_image = sourceAbs;
    if (!fs.existsSync(sourceAbs)) {
      problems.push(`source image missing: ${sourceAbs}`);
    } else if (fixture.source_sha256) {
      const actual = registry.sha256File(sourceAbs);
      if (actual !== fixture.source_sha256) {
        problems.push(`source image hash mismatch: fixture pins ${fixture.source_sha256.slice(0, 16)}…, file is ${actual.slice(0, 16)}…`);
      }
    } else {
      problems.push('source_image present but source_sha256 not pinned — fixture identity must be stable');
    }
  }

  // the fixture's params must satisfy the workflow's render contract
  const validation = contracts.validateRenderRequest(entry, params, { checkPaths: Boolean(sourceAbs) });
  if (!validation.ok) {
    problems.push(...validation.errors.map((e) => `contract ${e.field}: ${e.message}`));
  }
  return { ok: problems.length === 0, problems, entry, params: validation.params };
}

module.exports = {
  FIXTURES_PATH,
  loadFixtures,
  getFixture,
  getFixtureForWorkflow,
  sourceImageAbsolute,
  parameterSha256,
  validateFixture,
};
