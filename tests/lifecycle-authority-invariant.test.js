'use strict';

// SINGLE LIFECYCLE AUTHORITY — repository-level invariant.
//
// The system legitimately carries several state vocabularies. It may carry only
// ONE lifecycle authority. Successive audits found the same failure mode each
// time: a read-only subsystem's convenient "stage" label quietly becoming a
// second answer to "where is this production?" because nobody declared its
// scope.
//
// This suite makes scope declaration mandatory rather than conventional.

const { assert, fs, os, path, test } = require('./_helpers.js');
const resolver = require('../project-state-resolver.js');
const workflowMap = require('../scripts/package-run-workflow-map.js');
const stageProjection = require('../scripts/workflow-stage-projection.js');
const runStateProjection = require('../scripts/package-run-state-projection.js');

const ROOT = path.resolve(__dirname, '..');

test('LA1: exactly one module declares canonical lifecycle authority', () => {
  // The 14-gate engine is it. Every other stage vocabulary must either be a
  // declared projection of it, or declare itself out of scope.
  assert.equal(workflowMap.GATE_DEFINITIONS.length, 14);

  // AIGEN media lane: explicitly NOT lifecycle.
  assert.equal(resolver.LIFECYCLE_AUTHORITY, false);
  assert.equal(resolver.AUTHORITY_SCOPE, 'media_lane');
  assert.equal(resolver.CANONICAL_LIFECYCLE_SOURCE, 'scripts/package-run-workflow-map.js');

  // package-run-state: a projection, and it says so.
  assert.match(runStateProjection.AUTHORITY_SOURCE, /14-gate/);

  // The shared projection authority never claims to BE the authority.
  const sharedSource = fs.readFileSync(path.join(ROOT, 'scripts', 'workflow-stage-projection.js'), 'utf8');
  assert.match(sharedSource, /package-run-workflow-map\.js/,
    'the projection authority must name the canonical engine it derives from');
});

test('LA2: every AIGEN state label carries a declared scope', () => {
  // §33: no unclassified state label.
  assert.ok(resolver.STAGES.length > 0);
  for (const stage of resolver.STAGES) {
    assert.equal(typeof stage, 'string');
    assert.ok(stage.length > 0);
  }
  // The lifecycle-sounding tail is declared unreachable rather than left to
  // look like production progress this lane can observe.
  for (const stage of resolver.UNREACHABLE_STAGES) {
    assert.ok(resolver.STAGES.includes(stage), `${stage} must remain in the vocabulary for index stability`);
  }
  assert.deepEqual([...resolver.UNREACHABLE_STAGES], ['editing', 'publish_prep', 'published']);
  for (const terminal of resolver.TERMINAL) assert.equal(typeof terminal, 'string');
});

test('LA3: every resolver result declares its scope', () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'la-scope-'));
  try {
    fs.writeFileSync(path.join(pkg, 'project.json'), JSON.stringify({ title: 'Scope', package_state: 'active' }));
    const state = resolver.resolveProjectState(pkg);
    assert.equal(state.authority_scope, 'media_lane');
    assert.equal(state.lifecycle_authority, false);
    assert.equal(state.canonical_lifecycle_source, 'scripts/package-run-workflow-map.js');
    // It must not present a canonical gate it has no basis for.
    assert.equal('current_gate' in state, false);
    assert.equal('gate' in state, false);
  } finally { fs.rmSync(pkg, { recursive: true, force: true }); }
});

test('LA4: the resolver is pure — it cannot mutate canonical or any state', () => {
  const source = fs.readFileSync(path.join(ROOT, 'project-state-resolver.js'), 'utf8');
  for (const mutator of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'unlinkSync']) {
    assert.ok(!source.includes(mutator), `resolver must not call ${mutator}`);
  }
  for (const name of Object.keys(resolver)) {
    assert.ok(!/^(set|advance|promote|write|commit|approve)/i.test(name), `forbidden mutator export: ${name}`);
  }
});

test('LA5: AIGEN state cannot satisfy, advance or authorize a canonical gate', () => {
  // §11 gating audit, asserted structurally: no canonical gate predicate may
  // consult the AIGEN resolver, and the resolver exposes no gate writer.
  const gateSource = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-workflow-map.js'), 'utf8');
  assert.ok(!/project-state-resolver/.test(gateSource),
    'the canonical gate engine must never consult AIGEN media state');
  const indexSource = fs.readFileSync(path.join(ROOT, 'scripts', 'package-runs-index.js'), 'utf8');
  assert.ok(!/project-state-resolver/.test(indexSource),
    'canonical evidence scanning must never consult AIGEN media state');
  const runStateSource = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-state-projection.js'), 'utf8');
  assert.ok(!/project-state-resolver/.test(runStateSource),
    'the durable lifecycle projection must never consult AIGEN media state');
  assert.equal(typeof resolver.advanceGate, 'undefined');
  assert.equal(typeof resolver.setCanonicalGate, 'undefined');
});

test('LA6: no false mapping exists between AIGEN stages and canonical gates', () => {
  // Outcome B: these measure different subjects, so there is deliberately NO
  // 14→AIGEN mapping. Asserting its absence stops one being added by habit.
  assert.equal(typeof stageProjection.projectAigenStage, 'undefined');
  assert.equal(typeof stageProjection.GATE_TO_AIGEN_STAGE, 'undefined');
  const sharedSource = fs.readFileSync(path.join(ROOT, 'scripts', 'workflow-stage-projection.js'), 'utf8');
  assert.ok(!/project-state-resolver/.test(sharedSource),
    'the lifecycle projection authority must not import the media-lane resolver');
});

test('LA7: media progress never implies lifecycle progress for the same evidence', () => {
  // §25: assets exist, review evidence does not. The two dimensions disagree,
  // and that is correct — they measure different things.
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'la-media-'));
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'la-run-'));
  try {
    // AIGEN media package: late work-product progress.
    fs.writeFileSync(path.join(pkg, 'project.json'), JSON.stringify({ title: 'Ambiguity', package_state: 'active' }));
    fs.mkdirSync(path.join(pkg, 'script'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'script', 'script-final.md'), '# Final\n');
    fs.writeFileSync(path.join(pkg, 'image-prompts.json'), JSON.stringify({ prompts: [{ id: 1 }] }));
    const media = resolver.resolveProjectState(pkg);
    assert.notEqual(media.stage, 'idea', 'media lane shows real work-product progress');

    // Canonical run: artifacts drafted, reviews absent.
    const runId = '2099-01-01-la-ambiguity';
    const runDir = path.join(runRoot, 'package-runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'selected-package.md'), '# Selected\n');
    fs.writeFileSync(path.join(runDir, 'research-pack.md'), '# Research\n');
    const map = workflowMap.buildWorkflowMap(path.join('package-runs', runId), { repoRoot: runRoot });
    const gate = stageProjection.currentCanonicalGate(map.gates || []);
    assert.equal(gate.id, 'research', 'canonical stays early without review evidence');

    // The media state carries no lifecycle claim, so there is nothing to reconcile.
    assert.equal(media.lifecycle_authority, false);
    assert.equal('current_gate' in media, false);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
});

test('LA8: media state never bypasses human review or QC', () => {
  // Artifacts present, no approval anywhere: the media lane may truthfully say
  // the assets exist; it may not say the run is approved or complete.
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'la-human-'));
  try {
    fs.writeFileSync(path.join(pkg, 'project.json'), JSON.stringify({ title: 'Human', package_state: 'active' }));
    fs.mkdirSync(path.join(pkg, 'script'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'script', 'script-final.md'), '# Final\n');
    const state = resolver.resolveProjectState(pkg);
    const serialized = JSON.stringify(state);
    assert.equal(/approved_by|human_approval|qc_disposition|publish_ready/.test(serialized), false,
      'media state must make no approval or QC claim');
    assert.notEqual(state.status, 'published', 'asset presence alone is never published');
  } finally { fs.rmSync(pkg, { recursive: true, force: true }); }
});

test('LA9: the cockpit reports media-lane position with explicit scope', () => {
  // The canonical orientation API fills currentGate from AIGEN stage when no
  // package run is active. That is allowed, but must be self-describing.
  const serverSource = fs.readFileSync(path.join(ROOT, 'package-engine-server.js'), 'utf8');
  assert.match(serverSource, /currentGateScope: 'MEDIA_LANE'/);
  assert.match(serverSource, /currentGateIsCanonical: false/);
  assert.match(serverSource, /currentGate: `Media lane: \$\{project\.stage\}/,
    'the human-readable label must name its lane too');
});

test('LA10: the state vocabulary registry documents every vocabulary', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'workflow-state-authority.md'), 'utf8');
  for (const vocabulary of [
    '14-gate workflow', 'pipeline tracker', 'package-run-state',
    'AIGEN project state', 'Super Focus',
  ]) {
    assert.ok(doc.includes(vocabulary), `the registry must classify "${vocabulary}"`);
  }
  assert.match(doc, /media_lane/);
  assert.match(doc, /lifecycle_authority/);
});
