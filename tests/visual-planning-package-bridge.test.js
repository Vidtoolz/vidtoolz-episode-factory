'use strict';

/*
 * GATE 6 BRIDGE — canonical Story -> visual_planning_director -> visual-plan.json
 * -> deterministic adapter -> five package-run planning artifacts -> evaluator.
 *
 * The defect this suite locks out was real: GATE_OWNERS declared
 * visual_planning_director the owner of shot-edit-plan-review, but that agent
 * planned against a Script Builder Story a package run had no way to name, and
 * wrote a visual-plan.json nothing converted into the five markdown artifacts
 * the gate evaluates. Meanwhile the only writer of those artifacts hardcoded a
 * TODO status into every row it emitted, so the gate could never be satisfied by
 * any machine path at all. The ownership was true on paper and impossible in
 * code.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const storyBinding = require('../scripts/package-run-story-binding.js');
const storyRegistration = require('../scripts/package-run-story-registration.js');
const materializer = require('../scripts/visual-plan-package-materializer.js');
const shotEditReview = require('../scripts/package-run-shot-edit-plan-review.js');
const stateProjection = require('../scripts/package-run-state-projection.js');
const workflowMap = require('../scripts/package-run-workflow-map.js');
const visualPlan = require('../scripts/visual-plan.js');
const promptAdapter = require('../scripts/visual-plan-prompt-adapter.js');

const ROOT = path.resolve(__dirname, '..');
const CANARY_ID = '2026-08-25-lifecycle-integration-canary-canary-not-for-publication';
const CANARY_DIR = path.join(ROOT, 'package-runs', CANARY_ID);
const REAL_PLAN = path.join(CANARY_DIR, 'agents', 'visual_planning_director', 'vpd-canary-bridge-1', 'artifacts', 'visual-plan.json');

const PLANNING_FILES = materializer.OUTPUT_FILES;

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `vpd-bridge-${label}-`));
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function loadRealPlan() {
  return JSON.parse(fs.readFileSync(REAL_PLAN, 'utf8'));
}

/*
 * Build a structurally valid plan variant. Prompts bind to shot intent by
 * digest, so any shot mutation requires rebuilding prompt records and the plan
 * digest — otherwise the fixture would fail validation for the wrong reason.
 */
function planVariant(mutate) {
  const plan = clone(loadRealPlan());
  for (const shot of plan.shots) { shot.prompt_refs = []; shot.status = 'PLANNED'; }
  mutate(plan);
  plan.prompts = promptAdapter.buildPromptRecords(plan.shots, {});
  delete plan.plan_digest_sha256;
  plan.plan_digest_sha256 = visualPlan.planDigest(plan);
  return plan;
}

function writePlanTo(dir, plan) {
  const file = path.join(dir, 'visual-plan.json');
  fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
  return file;
}

// A package run the evaluator will actually read: the upstream gate evidence is
// copied from the real canary so only the planning layer is under test.
function stagedRun(label) {
  const dir = path.join(tmpDir(label), CANARY_ID);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(CANARY_DIR)) {
    const src = path.join(CANARY_DIR, name);
    if (fs.statSync(src).isDirectory()) continue;
    fs.copyFileSync(src, path.join(dir, name));
  }
  return dir;
}

function rows(markdown) {
  return String(markdown)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .filter((line) => !/^\|\s*:?-{3,}/.test(line))
    .filter((line) => !/\|\s*(?:shot|capture|demo|b-roll item|graphic|blocker)\s*\|/i.test(line));
}

function readAll(dir) {
  return Object.fromEntries(PLANNING_FILES.map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')]));
}

/* =============================================== STORY BINDING (§28) ======== */

test('bridge SB1: a valid binding resolves the exact canonical Story version', () => {
  const resolved = storyBinding.resolveBoundStory(CANARY_DIR);
  const binding = storyBinding.readBinding(CANARY_DIR);
  assert.equal(resolved.projectId, binding.story.project_id);
  assert.equal(resolved.versionId, binding.story.version_id);
  assert.equal(resolved.contentHash, binding.story.content_hash);
  assert.match(resolved.contentHash, /^[0-9a-f]{64}$/);
});

test('bridge SB2: an unbound run fails closed instead of guessing a Story', () => {
  const dir = tmpDir('unbound');
  assert.throws(() => storyBinding.resolveBoundStory(dir), (error) => error.code === 'STORY_BINDING_MISSING');
});

test('bridge SB3: a binding naming the wrong project does not resolve', () => {
  const dir = stagedRun('wrongproject');
  const binding = storyBinding.readBinding(dir);
  binding.story.project_id = '01KX5S2T7JS12SGR3WXACJ578Q';
  fs.writeFileSync(path.join(dir, storyBinding.BINDING_FILE), JSON.stringify(binding, null, 2));
  assert.throws(() => storyBinding.resolveBoundStory(dir), (error) => /STORY_(PROJECT|VERSION)_NOT_FOUND/.test(error.code));
});

test('bridge SB4: a binding naming an unknown version does not resolve', () => {
  const dir = stagedRun('wrongversion');
  const binding = storyBinding.readBinding(dir);
  binding.story.version_id = '01KX5S2T7KC5M7B3VKZ31VTXY9';
  fs.writeFileSync(path.join(dir, storyBinding.BINDING_FILE), JSON.stringify(binding, null, 2));
  assert.throws(() => storyBinding.resolveBoundStory(dir), (error) => error.code === 'STORY_VERSION_NOT_FOUND');
});

test('bridge SB5: content-hash drift is detected, not tolerated', () => {
  const dir = stagedRun('drift');
  const binding = storyBinding.readBinding(dir);
  binding.story.content_hash = 'f'.repeat(64);
  fs.writeFileSync(path.join(dir, storyBinding.BINDING_FILE), JSON.stringify(binding, null, 2));
  assert.throws(() => storyBinding.resolveBoundStory(dir), (error) => error.code === 'STORY_CONTENT_HASH_DRIFT');
});

test('bridge SB6: there is no title or slug fallback — identity is by id only', () => {
  const dir = stagedRun('titleonly');
  const binding = storyBinding.readBinding(dir);
  const title = 'CANARY — Lifecycle Integration Test Package (NOT FOR PUBLICATION)';
  delete binding.story.project_id;
  binding.story.title = title;
  fs.writeFileSync(path.join(dir, storyBinding.BINDING_FILE), JSON.stringify(binding, null, 2));
  assert.throws(() => storyBinding.resolveBoundStory(dir), (error) => error.code === 'STORY_BINDING_ID_INVALID');
  // And the resolver never READS a human-readable name: no title/slug property
  // access anywhere in the module (its prose may name them as excluded).
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-story-binding.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\.(?:title|slug)\b/.test(code), 'binding resolver must not read a title or slug');
  assert.ok(!/\[['"](?:title|slug)['"]\]/.test(code), 'binding resolver must not index a title or slug');
});

test('bridge SB7: resolving a binding does not mutate Story authority', () => {
  const resolved = storyBinding.resolveBoundStory(CANARY_DIR);
  const versionFile = path.join(resolved.scriptBuilderRoot, 'data', 'projects', resolved.projectId, 'versions', `${resolved.versionId}.md`);
  const before = fs.readFileSync(versionFile);
  storyBinding.resolveBoundStory(CANARY_DIR);
  storyBinding.resolveBoundStory(CANARY_DIR);
  assert.deepEqual(fs.readFileSync(versionFile), before, 'resolution must be read-only against Script Builder');
});

test('bridge SB8: the retained canary is legitimately bound, with recorded provenance', () => {
  const binding = storyBinding.readBinding(CANARY_DIR);
  assert.equal(binding.story.source_system, 'vidtoolz-script-builder');
  assert.equal(binding.run_id, CANARY_ID);
  assert.equal(binding.provenance.source_artifact, 'final-script.md');
  assert.match(binding.provenance.source_artifact_sha256, /^[0-9a-f]{64}$/);
  // The binding provenance must name the exact script bytes it was derived from.
  const script = fs.readFileSync(path.join(CANARY_DIR, 'final-script.md'));
  assert.equal(storyBinding.sha256(script), binding.provenance.source_artifact_sha256);
});

test('bridge SB9: registration decomposes a script on its own headings only', () => {
  const sections = storyRegistration.parseScriptSections([
    '# Final Script',
    '- run metadata that is not a beat',
    '## Hook',
    'First beat prose.',
    '## Close',
    'Last beat prose.',
  ].join('\n'));
  assert.deepEqual(sections.map((s) => s.beat), ['Hook', 'Close']);
  assert.deepEqual(sections.map((s) => s.dialogue), ['First beat prose.', 'Last beat prose.']);
});

test('bridge SB10: a script with no beat headings is refused, never invented', () => {
  assert.throws(
    () => storyRegistration.planRegistration(tmpDir('noheadings')),
    (error) => /STORY_REGISTRATION_(RUN_NOT_FOUND|NOT_A_PACKAGE_RUN|SCRIPT_MISSING)/.test(error.code)
  );
});

/* ============================================ VISUAL PLAN ADAPTER (§29) ==== */

test('bridge AD1: typed shots become concrete shot-list rows', () => {
  const plan = loadRealPlan();
  const { files } = materializer.buildArtifacts(plan, CANARY_ID);
  const shotRows = rows(files['shot-list.md']);
  assert.equal(shotRows.length, plan.shots.length);
  for (const shot of plan.shots) {
    assert.ok(
      shotRows.some((row) => row.includes(shot.subject.slice(0, 40))),
      `shot-list must carry the planned subject for ${shot.shot_id}`
    );
  }
});

test('bridge AD2: SCREEN_CAPTURE shots route to the screen-capture list', () => {
  const plan = planVariant((p) => {
    p.shots[0].media_type = 'SCREEN_CAPTURE';
    p.shots[0].generation_mode = 'NOT_APPLICABLE';
  });
  const { files } = materializer.buildArtifacts(plan, CANARY_ID);
  assert.equal(rows(files['screen-capture-list.md']).length, 1);
  assert.ok(rows(files['screen-capture-list.md'])[0].includes(plan.shots[0].subject.slice(0, 30)));
});

test('bridge AD3: a declared demonstration routes to the demo list with its three facts', () => {
  const demo = { start_state: 'Empty package run open in the cockpit', action: 'Dispatch the specialist and watch the gate re-evaluate', expected_result: 'Gate 6 moves from NEEDS WORK to READY FOR HUMAN APPROVAL' };
  const plan = planVariant((p) => { p.shots[1].demonstration = clone(demo); });
  const { files } = materializer.buildArtifacts(plan, CANARY_ID);
  const demoRows = rows(files['demo-list.md']);
  assert.equal(demoRows.length, 1);
  assert.ok(demoRows[0].includes(demo.action.slice(0, 30)), 'demo row must carry the action');
  assert.ok(demoRows[0].includes(demo.expected_result.slice(0, 30)), 'demo row must carry the expected result');
  assert.ok(demoRows[0].includes(demo.start_state.slice(0, 30)), 'demo row must carry the start state');
});

test('bridge AD4: generated, map and archival shots route to b-roll', () => {
  for (const mediaType of materializer.BROLL_MEDIA) {
    const mode = mediaType === 'GENERATED_STILL' ? 'STILL' : mediaType === 'GENERATED_VIDEO' ? 'DIRECT_VIDEO' : 'NOT_APPLICABLE';
    const plan = planVariant((p) => {
      p.shots[0].media_type = mediaType;
      p.shots[0].generation_mode = mode;
      if (mediaType === 'MAP_ANIMATION') p.shots[0].camera_intent = { subject: 'route', purpose: 'establish the geography' };
    });
    const { files } = materializer.buildArtifacts(plan, CANARY_ID);
    assert.ok(rows(files['b-roll-list.md']).length >= 1, `${mediaType} must appear in b-roll`);
  }
});

test('bridge AD5: infographic and text-graphic shots route to graphics', () => {
  const plan = loadRealPlan();
  const { files } = materializer.buildArtifacts(plan, CANARY_ID);
  const graphicShots = plan.shots.filter((shot) => materializer.GRAPHICS_MEDIA.includes(shot.media_type));
  assert.ok(graphicShots.length > 0, 'fixture plan should contain graphic shots');
  assert.equal(rows(files['graphics-list.md']).length, graphicShots.length);
});

test('bridge AD6: an empty category states a deliberate decision and stays concrete', () => {
  const plan = loadRealPlan();
  const { files } = materializer.buildArtifacts(plan, CANARY_ID);
  for (const name of ['screen-capture-list.md', 'demo-list.md', 'b-roll-list.md']) {
    const text = files[name];
    assert.equal(rows(text).length, 0, `${name} should have no rows for this plan`);
    assert.match(text, /No [a-z -]+ Required/i, `${name} must state the decision`);
    assert.match(text, /- Decision: NO_[A-Z_]+_REQUIRED/, `${name} must carry a canonical decision token`);
    assert.match(text, /- Basis: /, `${name} must record why nothing is required`);
    // The evaluator treats a bare "none" as an unfinished artifact, and should.
    assert.ok(text.replace(/[^a-z]/gi, '').length > 200, `${name} must be substantive, not a bare none`);
  }
});

test('bridge AD7: no materialized artifact contains a scaffold marker', () => {
  const plan = loadRealPlan();
  const { files } = materializer.buildArtifacts(plan, CANARY_ID);
  for (const [name, text] of Object.entries(files)) {
    assert.ok(!/\b(?:TODO|TBD|not written|not selected|not finalized|fill in)\b/i.test(text), `${name} must not contain a scaffold marker`);
    assert.ok(!/\bplaceholder\b/i.test(text), `${name} must not contain the word placeholder`);
    for (const row of rows(text)) {
      assert.ok(!/\|\s*(?:open|blocked|todo|tbd)\s*\|?\s*$/i.test(row), `${name} row must not end open/blocked: ${row}`);
    }
  }
});

test('bridge AD8: every row is derived from typed fields, not scraped prose', () => {
  const plan = loadRealPlan();
  const { files } = materializer.buildArtifacts(plan, CANARY_ID);
  const subjects = new Set(plan.shots.map((shot) => shot.subject));
  for (const row of rows(files['shot-list.md'])) {
    const cells = row.split('|').map((cell) => cell.trim()).filter(Boolean);
    assert.equal(cells.length, 4, 'shot rows keep the canonical four columns');
    // The first cell must be "<narrative function>: <subject>" for a real shot,
    // never a half-sentence lifted out of the script.
    assert.ok([...subjects].some((subject) => cells[0].includes(subject.slice(0, 40))), `row is not bound to a planned shot: ${row}`);
    assert.equal(cells[3], 'PLANNED');
  }
});

test('bridge AD9: materialization is deterministic for the same plan', () => {
  const plan = loadRealPlan();
  const a = materializer.buildArtifacts(plan, CANARY_ID).files;
  const b = materializer.buildArtifacts(clone(plan), CANARY_ID).files;
  assert.deepEqual(a, b);
});

test('bridge AD10: provenance records the exact source plan and Story', () => {
  const dir = stagedRun('provenance');
  const planPath = writePlanTo(dir, loadRealPlan());
  const result = materializer.materialize(dir, planPath, { taskId: 'vpd-test-1' });
  const provenance = JSON.parse(fs.readFileSync(path.join(dir, materializer.PROVENANCE_FILE), 'utf8'));
  assert.equal(provenance.machine_owner, 'visual_planning_director');
  assert.equal(provenance.adapter_version, materializer.ADAPTER_VERSION);
  assert.equal(provenance.source_visual_plan.plan_digest_sha256, result.plan.plan_digest_sha256);
  assert.equal(provenance.source_visual_plan.task_id, 'vpd-test-1');
  assert.equal(provenance.story.project_id, result.plan.story.project_id);
  assert.equal(provenance.story.version_id, result.plan.story.version_id);
  assert.equal(provenance.artifacts.length, PLANNING_FILES.length);
  for (const artifact of provenance.artifacts) assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
});

test('bridge AD11: repeated materialization is idempotent on disk', () => {
  const dir = stagedRun('idempotent');
  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, {});
  const first = readAll(dir);
  const second = materializer.materialize(dir, planPath, {});
  assert.deepEqual(readAll(dir), first);
  assert.ok(second.written.every((file) => file.unchanged), 'second pass must report every artifact unchanged');
});

test('bridge AD12: a new plan revision changes the materialized artifacts', () => {
  const dir = stagedRun('revision');
  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, {});
  const before = readAll(dir);

  const revised = planVariant((p) => {
    p.plan_revision = 2;
    p.shots[0].subject = 'Three status surfaces disagreeing on one run, drawn as a single split panel';
    p.shots[0].shot_brief = 'One wide panel, three columns, each column labelled with its authority and showing a different stage for the same run.';
  });
  writePlanTo(dir, revised);
  materializer.materialize(dir, planPath, {});
  const after = readAll(dir);
  assert.notDeepEqual(after['shot-list.md'], before['shot-list.md']);
  assert.match(after['shot-list.md'], /r2/);
  assert.ok(after['shot-list.md'].includes('Three status surfaces disagreeing'));
});

test('bridge AD13: an invalid or digest-mismatched plan is refused', () => {
  const dir = stagedRun('invalidplan');
  const broken = loadRealPlan();
  broken.plan_digest_sha256 = '0'.repeat(64);
  const planPath = writePlanTo(dir, broken);
  assert.throws(() => materializer.materialize(dir, planPath, {}), (error) => error.code === 'VISUAL_PLAN_DIGEST_MISMATCH');

  const notAPlan = path.join(dir, 'not-a-plan.json');
  fs.writeFileSync(notAPlan, JSON.stringify({ artifact_type: 'something-else' }));
  assert.throws(() => materializer.materialize(dir, notAPlan, {}), (error) => error.code === 'VISUAL_PLAN_ARTIFACT_TYPE_INVALID');
});

test('bridge AD14: the adapter only ever writes inside the run directory', () => {
  const dir = stagedRun('pathsafe');
  const planPath = writePlanTo(dir, loadRealPlan());
  const result = materializer.materialize(dir, planPath, {});
  for (const file of result.written) {
    assert.equal(path.dirname(file.path), path.resolve(dir));
    assert.ok(PLANNING_FILES.includes(path.basename(file.path)));
  }
  // No temporary files are left behind by the atomic write.
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes('.tmp-')), []);
});

test('bridge AD15: human notes survive regeneration; other manual edits do not', () => {
  const dir = stagedRun('humannotes');
  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, {});

  const target = path.join(dir, 'shot-list.md');
  const edited = fs.readFileSync(target, 'utf8')
    .replace(materializer.HUMAN_REGION_START, `${materializer.HUMAN_REGION_START}\nMikko: keep beat 3 abstract.`)
    .replace('| shot | reason | priority | status |', '| shot | reason | priority | status |\n| smuggled row | none | high | PLANNED |');
  fs.writeFileSync(target, edited);

  materializer.materialize(dir, planPath, {});
  const regenerated = fs.readFileSync(target, 'utf8');
  assert.ok(regenerated.includes('Mikko: keep beat 3 abstract.'), 'human notes must be preserved');
  assert.ok(!regenerated.includes('smuggled row'), 'edits outside the human region must not survive');
});

/* ============================================= GATE 6 END TO END (§30) ===== */

test('bridge E2E1: the machine path alone reaches READY FOR HUMAN APPROVAL', () => {
  const dir = stagedRun('e2e');
  // Start from the scaffold state the generator produces, to prove the adapter
  // is what clears the gate.
  for (const name of PLANNING_FILES) {
    fs.writeFileSync(path.join(dir, name), `# ${name}\n\n| shot | reason | priority | status |\n| --- | --- | --- | --- |\n| a scraped fragment | Supports a visible script beat. | high | TODO |\n`);
  }
  const before = shotEditReview.buildOutputs(dir);
  assert.equal(before.verdict.status, 'NEEDS WORK');

  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, { taskId: 'vpd-canary-bridge-1' });

  const after = shotEditReview.buildOutputs(dir);
  assert.equal(after.verdict.status, 'READY FOR HUMAN APPROVAL');
  assert.equal(after.verdict.accepted, false, 'machine work must not accept the stage');
  assert.equal(after.context.approvalMarker, false, 'no approval marker may be produced by the machine path');
  for (const finding of after.context.planningFindings) {
    assert.equal(finding.concrete, true, `${finding.filename} must be concrete: ${finding.issue}`);
  }
});

test('bridge E2E2: the retained canary is at READY FOR HUMAN APPROVAL with no marker', () => {
  const outputs = shotEditReview.buildOutputs(CANARY_DIR);
  assert.equal(outputs.verdict.status, 'READY FOR HUMAN APPROVAL');
  assert.equal(outputs.verdict.accepted, false);
  assert.equal(outputs.context.approvalMarker, false);
});

/* ================================================ HUMAN GATE (§31) ======== */

test('bridge HG1: a complete machine plan does not advance the canonical gate', () => {
  const map = workflowMap.buildWorkflowMap(path.relative(ROOT, CANARY_DIR));
  const current = map.gates.find((gate) => String(gate.status).startsWith('current'));
  assert.equal(current.id, 'shot-edit-plan-review');
  assert.equal(map.gates.filter((gate) => gate.status === 'complete').length, 5);
});

test('bridge HG2: PASS remains reachable only through an exact human marker', () => {
  const dir = stagedRun('humanmarker');
  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, {});
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'READY FOR HUMAN APPROVAL');

  // Only a human adds this line; the adapter never can (AD7 locks that).
  const target = path.join(dir, 'shot-list.md');
  fs.appendFileSync(target, '\nManual approval: PASS\n');
  const approved = shotEditReview.buildOutputs(dir);
  assert.equal(approved.verdict.status, 'PASS');
  assert.equal(approved.verdict.accepted, true);
});

test('bridge HG3: once machine planning is complete the projection asks Mikko, not the agent', () => {
  const projection = stateProjection.buildProjection({ runId: CANARY_ID });
  assert.equal(projection.current_gate, 'shot-edit-plan-review');
  assert.equal(projection.state, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(projection.next_safe_human_action.actor, 'mikko');
  assert.equal(projection.next_safe_human_action.humanApprovalRequired, true);
  // The contradiction this bridge removed: expected_owner naming an agent while
  // the next safe action pointed somewhere else entirely.
  assert.equal(projection.expected_owner, 'visual_planning_director');
  assert.equal(projection.owner_readiness.implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.deepEqual(stateProjection.consistencyReport({ runId: CANARY_ID }).defects, []);
  assert.equal(stateProjection.trackerDivergence({ runId: CANARY_ID }).code, 'TRACKER_CONSISTENT');
});

/* ============================================= REVISION SEMANTICS (§32) ==== */

test('bridge RV1: a degraded artifact is repaired from the plan, not by hand', () => {
  const dir = stagedRun('repair');
  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, {});
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'READY FOR HUMAN APPROVAL');

  // Regress one artifact the way the old scaffold generator would have.
  fs.writeFileSync(path.join(dir, 'shot-list.md'),
    '# Shot List\n\n| shot | reason | priority | status |\n| --- | --- | --- | --- |\n| a scraped fragment | Supports a visible script beat. | high | TODO |\n');
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'NEEDS WORK');

  // The repair is re-materialization from the canonical plan. No hand editing.
  materializer.materialize(dir, planPath, {});
  const repaired = shotEditReview.buildOutputs(dir);
  assert.equal(repaired.verdict.status, 'READY FOR HUMAN APPROVAL');
  assert.equal(repaired.context.approvalMarker, false);
});

test('bridge RV2: a superseding plan revision widens coverage through the adapter', () => {
  const dir = stagedRun('revisionloop');

  // Revision 1: deliberately narrow — one covered beat, the rest explicitly
  // carrying a no-visual decision. Structurally valid, just thin coverage.
  const narrow = planVariant((p) => {
    const kept = p.shots[0];
    p.shots = [kept];
    p.coverage = p.coverage.map((entry) => (
      entry.shot_ids.length && !entry.shot_ids.includes(kept.shot_id)
        ? { ...entry, decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: 'Held back for a later revision in this bounded coverage fixture.' }
        : entry
    ));
  });
  const planPath = writePlanTo(dir, narrow);
  materializer.materialize(dir, planPath, {});
  const narrowShotList = fs.readFileSync(path.join(dir, 'shot-list.md'), 'utf8');
  assert.equal(rows(narrowShotList).length, 1);
  assert.match(narrowShotList, /Deliberate No-Visual Decision/);
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'READY FOR HUMAN APPROVAL');

  // Revision 2: the specialist supersedes it with full coverage.
  const widened = planVariant((p) => {
    p.plan_revision = 2;
    p.supersedes = { plan_id: narrow.plan_id, plan_revision: 1 };
  });
  writePlanTo(dir, widened);
  materializer.materialize(dir, planPath, {});
  const widenedShotList = fs.readFileSync(path.join(dir, 'shot-list.md'), 'utf8');

  assert.ok(rows(widenedShotList).length > rows(narrowShotList).length, 'the revision widens coverage');
  assert.match(widenedShotList, /r2/);
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'READY FOR HUMAN APPROVAL');

  // The provenance sidecar tracks which revision the artifacts came from.
  const provenance = JSON.parse(fs.readFileSync(path.join(dir, materializer.PROVENANCE_FILE), 'utf8'));
  assert.equal(provenance.source_visual_plan.plan_revision, 2);
});

/* ======================================== GATE OWNER REACHABILITY (§20) ==== */

/*
 * The invariant the previous mission's defect would have failed: a gate whose
 * declared owner is an agent must have a production path from that agent to the
 * artifacts the gate actually evaluates. Locked for gate 6 specifically, because
 * that is the gate whose contracts make the check meaningful.
 */
test('bridge INV1: gate 6 declared owner has a reachable path to the gate artifacts', () => {
  const owner = stateProjection.GATE_OWNERS['shot-edit-plan-review'];
  assert.equal(owner, 'visual_planning_director');

  // 1. the owner is a real, authorized agent
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const registration = registry.agents.find((agent) => agent.agent_id === owner);
  assert.ok(registration, 'gate owner must be registered');
  const authority = require('../scripts/agent-dispatch-authority.js');
  const readiness = authority.implementationReadiness(ROOT, registration);
  assert.equal(readiness.authorized, true, `gate owner must be dispatch-authorized: ${readiness.code}`);

  // 2. a materializer claims that owner and covers every artifact the gate grades
  assert.equal(materializer.MACHINE_OWNER, owner);
  for (const filename of shotEditReview.PLANNING_FILES) {
    const covered = materializer.OUTPUT_FILES.includes(filename)
      || ['production-plan.md', 'audio-notes.md', 'production-blockers.md'].includes(filename);
    assert.ok(covered, `no machine path produces ${filename} for gate 6`);
  }

  // 3. a package run can name the Story the owner needs
  assert.equal(typeof storyBinding.resolveBoundStory, 'function');
  const taskAssembler = require('../scripts/agent-task-visual-planning.js');
  assert.equal(typeof taskAssembler.resolveStoryOptionsForRun, 'function');
});

test('bridge INV2: the scaffold generator is no longer the terminal machine path', () => {
  // The generator still exists as a template initializer, and still emits TODO
  // rows — that is why it must never be the last writer before the gate.
  const generator = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-production-plan.js'), 'utf8');
  assert.ok(/TODO/.test(generator), 'the scaffold generator is expected to still emit TODO rows');

  // The adapter is the machine path that supersedes it, and it cannot emit one.
  const adapter = fs.readFileSync(path.join(ROOT, 'scripts', 'visual-plan-package-materializer.js'), 'utf8');
  const emitted = materializer.buildArtifacts(loadRealPlan(), CANARY_ID).files;
  for (const text of Object.values(emitted)) assert.ok(!/\bTODO\b/.test(text));
  assert.ok(/PLANNED/.test(adapter), 'materialized rows carry a planned status');
});
