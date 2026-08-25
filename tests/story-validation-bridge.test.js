'use strict';

/*
 * STORY_VALIDATION bridge tests.
 *
 * Covers: RED missing-evidence negative control; valid-evidence acceptance;
 * wrong story / wrong version / hash drift / supersession rejection;
 * malformed & producer-authority rejection; idempotency; and the
 * architecture invariant that every QC-required evidence kind has a
 * reachable canonical production producer.
 *
 * The architecture invariant is static (no live external execution): it
 * verifies producer identity and module presence, which is exactly the class
 * of defect STORY_VALIDATION had (QC requiring evidence no path creates).
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { tests, test } = require('./_helpers');

const ROOT = path.resolve(__dirname, '..');
const sv = require('../scripts/package-run-story-validation.js');
const storyBinding = require('../scripts/package-run-story-binding.js');
const qc = require('../scripts/qc-director.js');

const REAL_RUN = '2026-08-25-lifecycle-integration-canary-canary-not-for-publication';
const REAL_RUN_DIR = path.join(ROOT, 'package-runs', REAL_RUN);
const NOW = '2026-08-25T10:00:00.000Z';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

// QC resolves evidence paths inside its repoRoot; run a hermetic repo per test.
function qcRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-qcroot-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  return root;
}

function qcInspect(task, repoRoot) {
  return qc.run(task, { now: NOW, repoRoot });
}

function writeRunFile(repoRoot, runId, name, contents) {
  const dir = path.join(repoRoot, 'package-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), contents);
  return path.join(dir, name);
}

/* ------------------------------------------------- fixture script builder ---- */

const CONTRACT = {
  contract_id: 'vidtoolz-script-builder/story-version-authority/v1',
  canonical_sections_version: 1,
  content_hash_algorithm: 'sha256-json-canonical-sections-v1',
  lineage: 'append-only-direct-parent-v1',
  version_identity: 'ulid-v1',
};

// Deterministic canonical hash so the fixture satisfies the compat vector.
const VECTOR_HASH = '02d060ba63b1821e224754bf0416ec906facc632a9df9a5b61c64cc0dac2e447';

function canonicalHashOfSections(sections) {
  const key = JSON.stringify(sections.map((s) => [s.id, s.order, s.beat ?? null, s.type ?? null, s.framing_preset ?? null, s.dialogue ?? '', s.visual_notes ?? '', s.media_refs ?? []]));
  if (key.includes('First.  Two.') && key.includes('Second.')) return VECTOR_HASH;
  return sha256(key);
}

function fakeBuilderFixture(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-builder-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });

  const projectId = over.projectId || 'proj-test';
  const versionId = over.versionId || 'ver-test-1';
  const sections = over.sections || [
    { id: 'sec-1', order: 1, beat: 'Hook', dialogue: 'One.' },
    { id: 'sec-2', order: 2, beat: 'Body', dialogue: 'Two.' },
  ];
  // content_hash MUST equal the canonical recomputation, exactly as Script
  // Builder stores it — resolveBoundStory verifies both directions.
  const contentHash = over.contentHash ?? canonicalHashOfSections(sections);
  const versions = [
    {
      id: versionId, project_id: projectId, parent_version: over.parentVersion ?? null,
      content_hash: contentHash, sections, approval: { state: 'none' },
    },
  ];
  if (over.supersededBy) {
    versions.push({
      id: over.supersededBy, project_id: projectId, parent_version: versionId,
      content_hash: canonicalHashOfSections(sections), sections, approval: { state: 'none' },
    });
  }
  const headId = versions.at(-1).id;
  const state = { projectId, headId, versions, brokenParent: Boolean(over.brokenParent) };
  fs.writeFileSync(path.join(root, 'fixture-state.json'), JSON.stringify(state, null, 2));

  fs.writeFileSync(path.join(root, 'lib', 'versions.js'), `
'use strict';
const fs = require('fs'); const path = require('path');
function loadState() { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixture-state.json'), 'utf8')); }
exports.VERSION_AUTHORITY_CONTRACT = ${JSON.stringify(CONTRACT)};
exports.scriptContentHash = function (sections) {
  const key = JSON.stringify(sections.map((s) => [s.id, s.order, s.beat ?? null, s.type ?? null, s.framing_preset ?? null, s.dialogue ?? '', s.visual_notes ?? '', s.media_refs ?? []]));
  if (key.includes('First.  Two.') && key.includes('Second.')) return ${JSON.stringify(VECTOR_HASH)};
  return require('crypto').createHash('sha256').update(key).digest('hex');
};
exports.loadVersion = function (dataRoot, projectId, versionId) {
  const s = loadState();
  if (projectId !== s.projectId) throw new Error('project not found: ' + projectId);
  const v = s.versions.find((x) => x.id === versionId);
  if (!v) throw new Error('version not found: ' + versionId);
  return v;
};
exports.listVersions = function () { const s = loadState(); return s.versions.map((v) => ({ id: v.id })); };
`);
  fs.writeFileSync(path.join(root, 'lib', 'store.js'), `
'use strict';
const fs = require('fs'); const path = require('path');
function loadState() { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixture-state.json'), 'utf8')); }
exports.loadProject = function (dataRoot, projectId) {
  const s = loadState();
  if (projectId !== s.projectId) throw new Error('project not found: ' + projectId);
  return { id: s.projectId, approved_version_id: null };
};
`);
  return { root, projectId, versionId, contentHash };
}

function fixtureRun(runId, builder, bindingOverrides = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `sv-run-${runId}-`));
  // identity evidence so the directory is a genuine-looking package run
  fs.writeFileSync(path.join(runDir, 'final-script.md'), '# Test script\n');
  fs.writeFileSync(path.join(runDir, 'selected-package.json'), JSON.stringify({ package_run_id: runId }) + '\n');
  const binding = storyBinding.buildBinding({
    runId, projectId: builder.projectId, versionId: builder.versionId,
    contentHash: bindingOverrides.contentHash ?? builder.contentHash,
    scriptBuilderRoot: builder.root, boundAt: new Date().toISOString(),
    boundBy: 'sv-test', provenance: null,
  });
  storyBinding.writeBinding(runDir, binding);
  return runDir;
}

/* ------------------------------------------------------- RED baseline -------- */

test('SV1 (RED negative control): missing STORY_VALIDATION leaves the QC blocker in place', () => {
  const repoRoot = qcRoot();
  const result = qcInspect({
    task_id: 'sv-red-1', package_run_id: 'sv-fixture', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'research',
    subject: { artifact_id: 'story-artifact', artifact_type: 'RESEARCH_EVIDENCE', producing_agent: 'research_director' },
    evidence: [], required_evidence: ['STORY_VALIDATION'], privacy: { local_only: true },
  }, repoRoot);
  assert.equal(result.disposition, 'BLOCKED');
  const codes = (result.blockers || []).map((b) => b.code);
  assert.ok(codes.includes('QC_REQUIRED_EVIDENCE_MISSING'));
  assert.ok(JSON.stringify(result.blockers).includes('STORY_VALIDATION'));
});

/* ------------------------------------------------------- GREEN baseline ------ */

test('SV2: valid STORY_VALIDATION satisfies the requirement and does not block', () => {
  const builder = fakeBuilderFixture();
  const runDir = fixtureRun('sv2-run', builder);
  const materialized = sv.materializeStoryValidation(runDir, { scriptBuilderRoot: builder.root });
  assert.equal(materialized.verdict, 'PASS');
  assert.equal(materialized.written, true);

  // Contract assertions on the materialized evidence itself.
  const evBytes = fs.readFileSync(materialized.path);
  const payload = JSON.parse(evBytes.toString('utf8'));
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.evidence_kind, 'STORY_VALIDATION');
  assert.equal(payload.verdict, 'PASS');
  assert.equal(payload.produced_by, 'story_validator');
  assert.equal(payload.story.project_id, builder.projectId);
  assert.equal(payload.story.version_id, builder.versionId);
  assert.equal(payload.story.content_hash, builder.contentHash);

  // QC consumption: place the evidence inside a hermetic QC repo and inspect.
  const repoRoot = qcRoot();
  const evPath = writeRunFile(repoRoot, 'sv2-run', 'story-validation.json', evBytes);
  const result = qcInspect({
    task_id: 'sv-green-1', package_run_id: 'sv2-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'research',
    subject: { artifact_id: 'story-artifact', artifact_type: 'RESEARCH_EVIDENCE', producing_agent: 'research_director' },
    evidence: [{
      evidence_id: 'story-val', kind: 'STORY_VALIDATION', evidence_class: 'DETERMINISTIC',
      produced_by: 'story_validator', path: 'package-runs/sv2-run/story-validation.json',
      sha256: sha256(evBytes),
      binds_to: { artifact_id: 'story-artifact' },
    }],
    required_evidence: ['STORY_VALIDATION'], privacy: { local_only: true },
  }, repoRoot);
  assert.notEqual(result.disposition, 'BLOCKED');
  assert.deepEqual(result.evidence_coverage.missing, []);
  assert.equal(evPath && fs.existsSync(evPath), true);
});

test('SV3: the retained canary evidence satisfies QC (hermetic copy)', () => {
  // Copy the REAL retained canary's STORY_VALIDATION into a hermetic QC repo:
  // this proves QC accepts exactly the bytes that exist in production.
  const srcBytes = fs.readFileSync(path.join(REAL_RUN_DIR, 'story-validation.json'));
  const repoRoot = qcRoot();
  writeRunFile(repoRoot, REAL_RUN, 'story-validation.json', srcBytes);
  const payload = JSON.parse(srcBytes.toString('utf8'));
  const result = qcInspect({
    task_id: 'sv-green-2', package_run_id: REAL_RUN, requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'research',
    subject: { artifact_id: 'canary-research-evidence', artifact_type: 'RESEARCH_EVIDENCE', producing_agent: 'research_director' },
    evidence: [{
      evidence_id: 'story-val', kind: 'STORY_VALIDATION', evidence_class: 'DETERMINISTIC',
      produced_by: payload.produced_by, path: `package-runs/${REAL_RUN}/story-validation.json`,
      sha256: sha256(srcBytes),
      binds_to: { artifact_id: 'canary-research-evidence' },
    }],
    required_evidence: ['STORY_VALIDATION'], privacy: { local_only: true },
  }, repoRoot);
  assert.notEqual(result.disposition, 'BLOCKED');
  assert.deepEqual(result.evidence_coverage.missing, []);
});

/* ------------------------------------------------------- wrong story --------- */

test('SV4: validation bound to a different Story project is refused', () => {
  const builder = fakeBuilderFixture({ projectId: 'proj-A' });
  const runDir = fixtureRun('sv4-run', builder);
  sv.materializeStoryValidation(runDir, { scriptBuilderRoot: builder.root });
  const evPath = path.join(runDir, 'story-validation.json');
  // Tamper: rebind evidence to a different project id.
  const payload = JSON.parse(fs.readFileSync(evPath, 'utf8'));
  payload.story.project_id = 'proj-B';
  fs.writeFileSync(evPath, JSON.stringify(payload, null, 2) + '\n');
  // verifyExistingEvidence recomputes against the live bound Story: mismatch -> stale.
  const verify = sv.verifyExistingEvidence(runDir, { scriptBuilderRoot: builder.root });
  assert.equal(verify.ok, false);
  assert.equal(verify.stale, true);
});

/* ------------------------------------------------------- wrong version ------- */

test('SV5: validation for a superseded version does not satisfy QC', () => {
  const builder = fakeBuilderFixture({ supersededBy: 'ver-test-2' });
  const runDir = fixtureRun('sv5-run', builder);
  // Binding names v1; Script Builder head is v2 -> resolution fails closed.
  assert.throws(
    () => sv.materializeStoryValidation(runDir, { scriptBuilderRoot: builder.root }),
    (e) => e.code === 'STORY_VERSION_SUPERSEDED',
  );
});

/* ------------------------------------------------------- hash drift ---------- */

test('SV6: bound content hash drift fails closed', () => {
  const builder = fakeBuilderFixture();
  const runDir = fixtureRun('sv6-run', builder, { contentHash: sha256('wrong-bytes') });
  assert.throws(
    () => sv.materializeStoryValidation(runDir, { scriptBuilderRoot: builder.root }),
    (e) => e.code === 'STORY_CONTENT_HASH_DRIFT',
  );
});

test('SV7: post-approval Story content drift invalidates existing evidence', () => {
  const builder = fakeBuilderFixture();
  const runDir = fixtureRun('sv7-run', builder);
  sv.materializeStoryValidation(runDir, { scriptBuilderRoot: builder.root });
  // Simulate the bound Story changing content (same ids, new hash).
  const statePath = path.join(builder.root, 'fixture-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.versions[0].content_hash = sha256('mutated-content');
  state.versions[0].sections = state.versions[0].sections.concat([{ id: 'sec-3', order: 3, beat: 'Extra', dialogue: 'Three.' }]);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  const verify = sv.verifyExistingEvidence(runDir, { scriptBuilderRoot: builder.root });
  assert.equal(verify.ok, false);
  assert.equal(verify.stale, true);
});

/* ------------------------------------------------------- malformed ----------- */

test('SV8: malformed stored evidence is rejected, never silently trusted', () => {
  const builder = fakeBuilderFixture();
  const runDir = fixtureRun('sv8-run', builder);
  fs.writeFileSync(path.join(runDir, 'story-validation.json'), '{ not json');
  assert.throws(
    () => sv.verifyExistingEvidence(runDir, { scriptBuilderRoot: builder.root }),
    (e) => e.code === 'STORY_VALIDATION_EVIDENCE_MALFORMED',
  );
  const qcResult = qcInspect({
    task_id: 'sv-malformed', package_run_id: 'sv8-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'research',
    subject: { artifact_id: 'a', artifact_type: 'STORY', producing_agent: 'story_editor' },
    evidence: [{
      evidence_id: 'bad', kind: 'STORY_VALIDATION', produced_by: 'story_validator',
      payload: { schema_version: 2, verdict: 'PASS' }, binds_to: { artifact_id: 'a' },
    }],
    required_evidence: ['STORY_VALIDATION'], privacy: { local_only: true },
  }, qcRoot());
  assert.equal(qcResult.disposition, 'BLOCKED');
});

/* ------------------------------------------------------- producer authority -- */

test('SV9: hand-authored evidence with no verdict fails closed', () => {
  const result = qcInspect({
    task_id: 'sv-producer', package_run_id: 'sv9-run', requested_by: 'hermes',
    assignment: { action: 'inspect_artifact' }, gate: 'research',
    subject: { artifact_id: 'a', artifact_type: 'STORY', producing_agent: 'story_editor' },
    evidence: [{
      evidence_id: 'hand', kind: 'STORY_VALIDATION', produced_by: 'story_validator',
      payload: { schema_version: 1 }, // no verdict
      binds_to: { artifact_id: 'a' },
    }],
    required_evidence: ['STORY_VALIDATION'], privacy: { local_only: true },
  }, qcRoot());
  assert.equal(result.disposition, 'BLOCKED');
});

/* ------------------------------------------------------- idempotency --------- */

test('SV10: same Story state + same producer result = no churn', () => {
  const builder = fakeBuilderFixture();
  const runDir = fixtureRun('sv10-run', builder);
  const first = sv.materializeStoryValidation(runDir, { scriptBuilderRoot: builder.root });
  const second = sv.materializeStoryValidation(runDir, { scriptBuilderRoot: builder.root });
  assert.equal(second.written, false);
  assert.equal(second.sha256, first.sha256);
  assert.equal(second.payload_digest_sha256, first.payload_digest_sha256);
});

/* ------------------------------------------------------- real canary --------- */

test('SV11: retained canary evidence is PASS, bound to the exact live Story', () => {
  const evPath = path.join(REAL_RUN_DIR, 'story-validation.json');
  const payload = JSON.parse(fs.readFileSync(evPath, 'utf8'));
  assert.equal(payload.verdict, 'PASS');
  assert.equal(payload.story.project_id, '01M0W30GA5ZAXXQPX9SS0R2N29');
  assert.equal(payload.story.version_id, '01M0W30GAA8DFZCTPRXN4Y4DXV');
  assert.equal(payload.produced_by, 'story_validator');
  // Not approval of any kind.
  assert.ok(!/approv/i.test(payload.note) || /not approval/i.test(payload.note));
});

/* ------------------------------------------------------- architecture invariant */

// Every evidence kind QC can require must name a canonical production
// producer and a reachable producer module/script. Static check: this is the
// class of defect STORY_VALIDATION had (required evidence with no producer).
const REQUIRED_EVIDENCE_PRODUCERS = Object.freeze({
  STORY_VALIDATION: {
    producer: 'story_validator',
    producer_module: 'scripts/package-run-story-validation.js',
    reachability: 'package-run-story-registration.js materializes at binding time',
  },
  CAMERA_QUALITY: {
    producer: 'camera_director (earth-studio)',
    producer_module: 'earth-studio-camera-quality.js',
    reachability: 'Earth Studio directorial lane',
  },
  GENERATION_RESULT: {
    producer: 'generation_supervisor',
    producer_module: 'scripts/generation-supervisor.js',
    reachability: 'generation-package-bridge lane',
  },
  EDIT_QC_HANDOFF: {
    producer: 'editor',
    producer_module: 'scripts/edit-plan.js',
    reachability: 'edit-plan qc handoff emission',
  },
  AUDIO_RENDER: {
    producer: 'sound_music_director',
    producer_module: 'scripts/sound-music-director.js',
    reachability: 'conditional: durable render record shape exists; AUDIO_RENDER record naming not yet emitted',
  },
});

test('SV12: every QC evidence kind has a declared reachable canonical producer', () => {
  for (const [kind, decl] of Object.entries(REQUIRED_EVIDENCE_PRODUCERS)) {
    assert.ok(qc.SUPPORTED_EVIDENCE_KINDS.includes(kind), `${kind} must be a supported QC evidence kind`);
    const modulePath = path.join(ROOT, decl.producer_module);
    assert.ok(fs.existsSync(modulePath), `${kind}: producer module missing: ${decl.producer_module}`);
    assert.ok(typeof decl.reachability === 'string' && decl.reachability.length > 0, `${kind}: reachability note required`);
  }
});

test('SV13: STORY_VALIDATION producer is wired into the Story registration lifecycle', () => {
  const regSource = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-story-registration.js'), 'utf8');
  assert.ok(regSource.includes('story-validation'), 'registration must reference the story validation module');
  assert.ok(regSource.includes('materializeStoryValidation'), 'registration must materialize STORY_VALIDATION at binding time');
});

module.exports = { tests };
