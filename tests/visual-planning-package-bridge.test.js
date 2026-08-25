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
  // A staged run is a PRE-approval baseline. The live canary now carries Mikko's
  // recorded approval, and inheriting it would silently change what these tests
  // are measuring — so it is stripped here and re-added only where intended.
  for (const name of ['production-plan.md', 'audio-notes.md', 'production-blockers.md']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const stripped = fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !/^(?:[-*]\s*)?(?:Manual approval|Production planning approval|Shot\/edit plan approval):\s*PASS\s*$/i.test(line))
      .filter((line) => !/Approved plan digest:/i.test(line))
      .join('\n');
    fs.writeFileSync(file, stripped);
  }
  // The copied review artifacts record the canary's PASS. Left in place they
  // would make the gate engine read this baseline as already past gate 6.
  for (const name of [shotEditReview.REVIEW_FILE, shotEditReview.ENHANCEMENT_FILE]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  return dir;
}

// Write the review artifacts from the run's own current state, so the gate
// engine sees this staged run rather than an inherited verdict.
function refreshReview(dir) {
  shotEditReview.writeOutputs(dir, shotEditReview.buildOutputs(dir), true);
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

test('bridge E2E2: the retained canary records Mikko\'s approval of the exact plan', () => {
  // The live canary has since been approved by Mikko, so this asserts the real
  // post-approval truth rather than a snapshot that moves under the test.
  const outputs = shotEditReview.buildOutputs(CANARY_DIR);
  assert.equal(outputs.verdict.status, 'PASS');
  assert.equal(outputs.verdict.accepted, true);
  assert.equal(outputs.context.approvalMarker, true);

  // And the approval is bound to the plan that was actually materialized.
  const approval = materializer.readApprovalBinding(CANARY_DIR);
  const provenance = JSON.parse(fs.readFileSync(path.join(CANARY_DIR, materializer.PROVENANCE_FILE), 'utf8'));
  assert.equal(approval.approvedDigest, provenance.source_visual_plan.plan_digest_sha256);
});

/* ================================================ HUMAN GATE (§31) ======== */

test('bridge HG1: a complete machine plan does not advance the canonical gate', () => {
  // Measured on a pre-approval staged run: machine planning alone must leave the
  // run at gate 6 with 5 gates complete.
  const dir = stagedRun('holdgate');
  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, {});
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'READY FOR HUMAN APPROVAL');
  refreshReview(dir);

  const map = workflowMap.buildWorkflowMap(dir);
  const current = map.gates.find((gate) => String(gate.status).startsWith('current'));
  assert.equal(current.id, 'shot-edit-plan-review');
  assert.equal(map.gates.filter((gate) => gate.status === 'complete').length, 5);
});

test('bridge HG2: PASS needs a human marker AND a binding to the current plan', () => {
  const dir = stagedRun('humanmarker');
  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, {});
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'READY FOR HUMAN APPROVAL');

  // A bare marker is no longer authority: it names no plan, so it is not trusted.
  fs.appendFileSync(path.join(dir, 'production-plan.md'), '\nManual approval: PASS\n');
  const unbound = shotEditReview.buildOutputs(dir);
  assert.notEqual(unbound.verdict.status, 'PASS');
  assert.equal(unbound.verdict.approvalBindingCode, 'APPROVED_PLAN_DIGEST_UNKNOWN');

  // Bound to the plan actually materialized, the same human decision passes.
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  fs.appendFileSync(path.join(dir, 'production-plan.md'), `\n- Approved plan digest: ${plan.plan_digest_sha256}\n`);
  const bound = shotEditReview.buildOutputs(dir);
  assert.equal(bound.verdict.status, 'PASS');
  assert.equal(bound.verdict.accepted, true);
  assert.equal(bound.verdict.approvalBindingCode, null);
});

test('bridge HG3: at the human gate the projection asks Mikko, not the agent', () => {
  const dir = stagedRun('projection');
  const planPath = writePlanTo(dir, loadRealPlan());
  materializer.materialize(dir, planPath, {});
  refreshReview(dir);

  const projection = stateProjection.buildProjection({ runId: CANARY_ID, runDir: dir });
  assert.equal(projection.current_gate, 'shot-edit-plan-review');
  assert.equal(projection.state, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(projection.next_safe_human_action.actor, 'mikko');
  assert.equal(projection.next_safe_human_action.humanApprovalRequired, true);
  // The contradiction this bridge removed: expected_owner naming an agent while
  // the next safe action pointed somewhere else entirely.
  assert.equal(projection.expected_owner, 'visual_planning_director');
  assert.equal(projection.owner_readiness.implementation_state, 'IMPLEMENTATION_PROVEN');
});

test('bridge HG4: after approval the run advances and stops asking for the agent', () => {
  const map = workflowMap.buildWorkflowMap(path.relative(ROOT, CANARY_DIR));
  const current = map.gates.find((gate) => String(gate.status).startsWith('current'));
  assert.equal(current.id, 'capture-checklist');
  assert.equal(map.gates.filter((gate) => gate.status === 'complete').length, 6);

  const projection = stateProjection.buildProjection({ runId: CANARY_ID });
  assert.equal(projection.current_gate, 'capture-checklist');
  assert.notEqual(projection.expected_owner, 'visual_planning_director');
  assert.deepEqual(stateProjection.consistencyReport({ runId: CANARY_ID }).defects, []);
  assert.equal(stateProjection.trackerDivergence({ runId: CANARY_ID }).code, 'TRACKER_CONSISTENT');
});

/* ==================================== APPROVAL CANNOT BE INHERITED ========= */

/*
 * Making the five artifacts machine-regenerable turned a latent gap into a
 * practical authority bypass: approve plan r1, materialize r2, and the gate
 * re-reads the same marker and still passes — over content the approver never
 * saw. Reproduced on an isolated run before the guard existed; locked here.
 */
function approvedRun(label, plan) {
  const dir = stagedRun(label);
  const planPath = writePlanTo(dir, plan);
  materializer.materialize(dir, planPath, {});
  fs.appendFileSync(path.join(dir, 'production-plan.md'), [
    '',
    '## Human Shot/Edit Plan Approval',
    '',
    'Shot/edit plan approval: PASS',
    '',
    `- Approved plan digest: ${plan.plan_digest_sha256}`,
    '',
  ].join('\n'));
  return { dir, planPath };
}

test('bridge AP1: a different plan revision cannot inherit a human approval', () => {
  const approved = loadRealPlan();
  const { dir } = approvedRun('inherit', approved);
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'PASS');

  const other = planVariant((p) => {
    p.plan_revision = 2;
    p.shots[0].subject = 'A completely different opening: a slow push into a single blinking cursor';
    p.shots[0].shot_brief = 'Nothing like the approved hook. A dark frame, one cursor, no diagram at all.';
  });
  const otherPath = writePlanTo(dir, other);
  fs.renameSync(otherPath, path.join(dir, 'other-plan.json'));

  assert.throws(
    () => materializer.materialize(dir, path.join(dir, 'other-plan.json'), {}),
    (error) => error.code === 'APPROVED_PLAN_SUPERSEDED'
  );
  const shotList = fs.readFileSync(path.join(dir, 'shot-list.md'), 'utf8');
  assert.ok(!shotList.includes('blinking cursor'), 'approved artifacts must not be replaced');
});

test('bridge AP2: re-materializing the approved plan is still allowed', () => {
  const approved = loadRealPlan();
  const { dir, planPath } = approvedRun('reapprove', approved);
  const result = materializer.materialize(dir, planPath, {});
  assert.equal(result.provenance.human_approval.matches_source_plan, true);
  assert.equal(result.provenance.human_approval.approved_plan_digest, approved.plan_digest_sha256);
  assert.equal(shotEditReview.buildOutputs(dir).verdict.status, 'PASS');
});

test('bridge AP3: superseding an approval must be explicit, and an unbound approval is refused', () => {
  const approved = loadRealPlan();
  const { dir } = approvedRun('supersede', approved);
  const other = planVariant((p) => { p.plan_revision = 2; });
  const otherPath = path.join(dir, 'other-plan.json');
  fs.writeFileSync(otherPath, `${JSON.stringify(other, null, 2)}\n`);

  const replaced = materializer.materialize(dir, otherPath, { replaceApproved: true });
  assert.equal(replaced.provenance.human_approval.matches_source_plan, false);

  // An approval with no digest cannot be checked, so it is not trusted either.
  const loose = stagedRun('loosely-approved');
  const loosePath = writePlanTo(loose, approved);
  materializer.materialize(loose, loosePath, {});
  fs.appendFileSync(path.join(loose, 'production-plan.md'), '\nManual approval: PASS\n');
  assert.throws(
    () => materializer.materialize(loose, loosePath, {}),
    (error) => error.code === 'APPROVED_PLAN_DIGEST_UNKNOWN'
  );
});

/* ============================ APPROVAL IS BOUND TO ONE PLAN (canonical) ==== */

/*
 * A gate approval must mean "Mikko approved THIS exact materialized plan", not
 * "some PASS text exists somewhere". The adapter guard alone was not enough: any
 * other write path could mutate a projection and leave the marker effective, and
 * the canonical evaluator would still return PASS. Reproduced before the fix:
 *
 *   approve r1 -> PASS
 *   hand-edit shot-list.md (concrete, plausible, unreviewed) -> still PASS
 *
 * These lock the evaluator itself, not just the adapter.
 */

const CANARY_PLAN_REL = 'agents/visual_planning_director/vpd-canary-bridge-1/artifacts/visual-plan.json';

// Staged runs must keep the canary's own directory name: materialized artifacts
// embed the run id, so a renamed copy would not re-derive identically.
function boundRun(label) {
  const root = tmpDir(label);
  const dir = path.join(root, 'package-runs', CANARY_ID);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(CANARY_DIR)) {
    const src = path.join(CANARY_DIR, name);
    if (fs.statSync(src).isDirectory()) continue;
    fs.copyFileSync(src, path.join(dir, name));
  }
  const planTarget = path.join(dir, CANARY_PLAN_REL);
  fs.mkdirSync(path.dirname(planTarget), { recursive: true });
  fs.copyFileSync(path.join(CANARY_DIR, CANARY_PLAN_REL), planTarget);
  return { root, dir, planPath: planTarget };
}

function supersedingPlan() {
  return planVariant((p) => {
    p.plan_revision = 2;
    p.shots[0].subject = 'A slow push into a single blinking cursor on a black frame';
    p.shots[0].shot_brief = 'A dark frame with one cursor. Nothing the approver ever saw.';
  });
}

function verdictOf(dir) {
  const outputs = shotEditReview.buildOutputs(dir);
  return { status: outputs.verdict.status, code: outputs.verdict.approvalBindingCode || null };
}

test('bridge AB1: the retained canary approval is bound and passes', () => {
  const verdict = verdictOf(CANARY_DIR);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.code, null);
  const binding = materializer.verifyApprovalBinding(CANARY_DIR);
  assert.equal(binding.ok, true);
  assert.equal(binding.approved_digest, binding.current_plan_digest);
});

test('bridge AB2: a superseded plan makes the approval stale, not the gate passed', () => {
  const { dir, planPath } = boundRun('stale');
  assert.equal(verdictOf(dir).status, 'PASS');

  fs.writeFileSync(planPath, `${JSON.stringify(supersedingPlan(), null, 2)}\n`);
  materializer.materialize(dir, planPath, { replaceApproved: true });

  const verdict = verdictOf(dir);
  assert.equal(verdict.status, 'READY FOR HUMAN APPROVAL');
  assert.equal(verdict.code, 'APPROVED_PLAN_SUPERSEDED');
});

test('bridge AB3: editing a projection outside the adapter invalidates the approval', () => {
  for (const [name, mutate] of [
    ['shot-list.md', (text) => text.replace(/\| Hook: [^|]+\|/, '| Hook: plausible but unreviewed content |')],
    ['demo-list.md', (text) => text.replace('NO_DEMO_REQUIRED', 'NO_DEMO_REQUIRED_TAMPERED')],
  ]) {
    const { dir } = boundRun(`mutate-${name.replace(/\W/g, '')}`);
    const file = path.join(dir, name);
    fs.writeFileSync(file, mutate(fs.readFileSync(file, 'utf8')));
    const verdict = verdictOf(dir);
    assert.equal(verdict.status, 'NEEDS WORK', `${name} edit must not stay PASS`);
    assert.equal(verdict.code, 'APPROVED_PLAN_ARTIFACT_DRIFT');
  }
});

test('bridge AB4: forging the sidecar hash alongside the edit does not help', () => {
  // The expected bytes are re-derived from the plan, so the sidecar is never the
  // source of truth for artifact content. Before that change this case passed.
  const { dir } = boundRun('coforge');
  const file = path.join(dir, 'shot-list.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\| Hook: [^|]+\|/, '| Hook: forged content |'));

  const sidecarPath = path.join(dir, materializer.PROVENANCE_FILE);
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  const forged = storyBinding.sha256(materializer.machineCanonicalText(fs.readFileSync(file, 'utf8')));
  sidecar.artifacts = sidecar.artifacts.map((entry) => (
    entry.filename === 'shot-list.md' ? { ...entry, machine_sha256: forged, sha256: forged } : entry
  ));
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

  const verdict = verdictOf(dir);
  assert.notEqual(verdict.status, 'PASS');
  assert.equal(verdict.code, 'APPROVED_PLAN_ARTIFACT_DRIFT');
});

test('bridge AB5: a sidecar that disagrees with the plan fails closed', () => {
  const { dir } = boundRun('sidecardigest');
  const sidecarPath = path.join(dir, materializer.PROVENANCE_FILE);
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  sidecar.source_visual_plan.plan_digest_sha256 = '0'.repeat(64);
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
  const verdict = verdictOf(dir);
  assert.notEqual(verdict.status, 'PASS');
  assert.equal(verdict.code, 'APPROVED_PLAN_MATERIALIZATION_DRIFT');
});

test('bridge AB6: deleting the provenance cannot downgrade to marker-only trust', () => {
  const { dir } = boundRun('nosidecar');
  fs.rmSync(path.join(dir, materializer.PROVENANCE_FILE));
  const verdict = verdictOf(dir);
  assert.notEqual(verdict.status, 'PASS');
  assert.equal(verdict.code, 'APPROVED_PLAN_DIGEST_UNKNOWN');
});

test('bridge AB7: no single human-editable field can manufacture validity', () => {
  const { dir } = boundRun('forgetext');
  const file = path.join(dir, 'production-plan.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace(/Approved plan digest: [0-9a-f]{64}/, `Approved plan digest: ${'a'.repeat(64)}`));
  const verdict = verdictOf(dir);
  assert.notEqual(verdict.status, 'PASS');
  assert.equal(verdict.code, 'APPROVED_PLAN_SUPERSEDED');
});

test('bridge AB8: re-materializing the approved plan keeps the approval and the bytes', () => {
  const { dir, planPath } = boundRun('remat');
  const before = readAll(dir);
  materializer.materialize(dir, planPath, { taskId: 'vpd-canary-bridge-1' });
  assert.deepEqual(readAll(dir), before, 'regeneration of the approved plan must be byte-identical');
  assert.equal(verdictOf(dir).status, 'PASS');
});

test('bridge AB9: a sanctioned human note does not invalidate the approval', () => {
  const { dir } = boundRun('humannote');
  const file = path.join(dir, 'shot-list.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace(materializer.HUMAN_REGION_START, `${materializer.HUMAN_REGION_START}\nMikko: keep beat 3 abstract.`));
  const verdict = verdictOf(dir);
  assert.equal(verdict.status, 'PASS', 'editing the human-notes region is explicitly allowed');
  assert.equal(verdict.code, null);
});

test('bridge AB10: a stale approval regresses the canonical gate, and every projection follows', () => {
  const { root, dir, planPath } = boundRun('regression');
  const opts = { repoRoot: root, runId: CANARY_ID, runDir: dir };

  const refresh = () => shotEditReview.writeOutputs(dir, shotEditReview.buildOutputs(dir), true);
  const position = () => {
    const map = workflowMap.buildWorkflowMap(dir, { repoRoot: root });
    const current = map.gates.find((gate) => String(gate.status).startsWith('current'));
    return { gate: current.id, complete: map.gates.filter((gate) => gate.status === 'complete').length };
  };

  refresh();
  assert.deepEqual(position(), { gate: 'capture-checklist', complete: 6 });
  assert.equal(stateProjection.buildProjection(opts).current_gate, 'capture-checklist');

  fs.writeFileSync(planPath, `${JSON.stringify(supersedingPlan(), null, 2)}\n`);
  materializer.materialize(dir, planPath, { replaceApproved: true });
  refresh();

  // The 14-gate engine recomputes completion from evidence, so a stale approval
  // genuinely un-completes gate 6 rather than leaving production truth claiming
  // capture-checklist over an unapproved plan.
  assert.deepEqual(position(), { gate: 'shot-edit-plan-review', complete: 5 });
  const projection = stateProjection.buildProjection(opts);
  assert.equal(projection.current_gate, 'shot-edit-plan-review');
  assert.equal(projection.state, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(projection.expected_owner, 'visual_planning_director');
  assert.equal(stateProjection.trackerDivergence(opts).code, 'TRACKER_CONSISTENT');
  assert.deepEqual(stateProjection.consistencyReport(opts).defects, []);
});

test('bridge AB11: gate-6 approval stays narrow and does not leak across gates', () => {
  // Research approval did not satisfy gate 6, and gate 6 does not satisfy gate 7.
  const map = workflowMap.buildWorkflowMap(path.relative(ROOT, CANARY_DIR));
  const gate7 = map.gates.find((gate) => gate.id === 'capture-checklist');
  assert.ok(String(gate7.status).startsWith('current'), 'gate 7 must still be pending');
  assert.ok(gate7.missingArtifacts.length > 0, 'gate 7 still needs its own evidence');

  // The gate-6 marker vocabulary must not appear in gate 7's required artifacts.
  for (const filename of gate7.missingArtifacts) {
    assert.ok(!fs.existsSync(path.join(CANARY_DIR, filename)), `${filename} must not be fabricated by gate 6 approval`);
  }
  const gatesAfter = map.gates.slice(map.gates.findIndex((gate) => gate.id === 'capture-checklist'));
  assert.ok(gatesAfter.every((gate) => gate.status !== 'complete'), 'no later gate may be completed by a gate-6 approval');
});

/* ==================== HUMAN_AUTHORED PLANNING PROVENANCE (gate 6) ========== */

/*
 * Hardening gate 6 against stale approval removed a legitimate capability: a
 * planning package Mikko wrote himself had no plan digest to bind to, so it
 * could not be approved at all. The old bare-marker fallback is NOT restored.
 * Instead the same rule is applied to a different artifact: approval binds to a
 * deterministic snapshot of the five reviewed planning files.
 */

const humanApproval = require('../scripts/package-run-human-planning-approval.js');

const HUMAN_UPSTREAM = [
  'final-script.md', 'script-review.md', 'script-structure.md',
  'research-pack.md', 'research-evidence.md', 'research-sufficiency-review.md',
  'source-support-map.md', 'proof-capture-plan.md', 'research-objections.md',
  'selected-package.json', 'notes.md',
  'production-plan.md', 'audio-notes.md', 'production-blockers.md',
];

const NOTES_REGION = `${materializer.HUMAN_REGION_START}\n${materializer.HUMAN_REGION_END}\n`;

function handAuthoredArtifacts() {
  return {
    'shot-list.md': '# Shot List\n\n| shot | reason | priority | status |\n| --- | --- | --- | --- |\n| Hook A-roll: Mikko to camera stating the one-authority claim | Opens the approved script and frames the viewer problem. | high | PLANNED |\n| Close A-roll: Mikko delivering the closing line | Lands the thesis on camera. | high | PLANNED |\n',
    'screen-capture-list.md': '# Screen Capture List\n\n| capture | proof purpose | source/app | status |\n| --- | --- | --- | --- |\n| The gate engine reporting one canonical position for a real run | Shows the single authority answering the question. | local cockpit at 127.0.0.1:8010 | PLANNED |\n',
    'demo-list.md': '# Demo List\n\n## No demonstration Required\n\n- Decision: NO_DEMO_REQUIRED\n- Decided by: Mikko, authoring this planning set by hand\n- Basis: the episode argues about authority rather than walking the viewer through a workflow, so no start-state/action/result demonstration is needed.\n\nA later revision that introduces a demonstration replaces this artifact and its snapshot.\n',
    'b-roll-list.md': '# B-Roll List\n\n| b-roll item | reason | source | status |\n| --- | --- | --- | --- |\n| Slow pan across three disagreeing status surfaces on one screen | Gives the edit concrete visual proof of the contradiction. | Capture locally from the cockpit. | PLANNED |\n',
    'graphics-list.md': '# Graphics List\n\n| graphic | clarity purpose | source/input | status |\n| --- | --- | --- | --- |\n| One bright Authority node with dim derived View nodes | Makes the thesis scannable in a single image. | Built from the approved script. | PLANNED |\n',
  };
}

/*
 * A run whose upstream gates are real (borrowed from the canary) but whose five
 * planning artifacts were written by hand: no visual plan, no materialization.
 */
function humanAuthoredRun(label, options = {}) {
  const root = tmpDir(`human-${label}`);
  const dir = path.join(root, 'package-runs', '2026-08-25-human-authored-fixture');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of HUMAN_UPSTREAM) {
    const src = path.join(CANARY_DIR, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
  }
  // Strip the canary's own agent-path approval: this fixture must start unapproved.
  const planFile = path.join(dir, 'production-plan.md');
  fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/Shot\/edit plan approval|Approved plan digest|Approved planning snapshot/i.test(line))
    .join('\n'));

  const artifacts = handAuthoredArtifacts();
  for (const [name, body] of Object.entries(artifacts)) {
    fs.writeFileSync(path.join(dir, name), options.withoutNotes ? body : body + NOTES_REGION);
  }
  return { root, dir };
}

function approveHuman(dir, digest) {
  fs.appendFileSync(path.join(dir, 'production-plan.md'),
    `\nShot/edit plan approval: PASS\n- Approved planning snapshot: ${digest}\n`);
}

function verdictOfRun(dir) {
  const outputs = shotEditReview.buildOutputs(dir);
  return {
    status: outputs.verdict.status,
    code: outputs.verdict.approvalBindingCode || null,
    source: outputs.verdict.approvalPlanningSource || null,
  };
}

test('bridge HA1: planning provenance is declared, never inferred from a missing plan', () => {
  const { dir } = humanAuthoredRun('undeclared');
  // No visual plan and no human record: nothing declares authority, so a marker
  // cannot be bound to anything.
  fs.appendFileSync(path.join(dir, 'production-plan.md'), '\nShot/edit plan approval: PASS\n');
  const verdict = verdictOfRun(dir);
  assert.notEqual(verdict.status, 'PASS');
  assert.equal(verdict.code, 'APPROVED_PLAN_DIGEST_UNKNOWN');
  assert.equal(verdict.source, null, 'no source may be inferred');
});

test('bridge HA2: a concrete hand-authored set reaches READY FOR HUMAN APPROVAL', () => {
  const { dir } = humanAuthoredRun('ready');
  humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  const verdict = verdictOfRun(dir);
  assert.equal(verdict.status, 'READY FOR HUMAN APPROVAL');
});

test('bridge HA3: the snapshot digest is deterministic and content-addressed', () => {
  const { dir } = humanAuthoredRun('deterministic');
  const a = humanApproval.buildHumanPlanningApprovalSnapshot(dir);
  const b = humanApproval.buildHumanPlanningApprovalSnapshot(dir);
  assert.equal(a.digest, b.digest);
  assert.match(a.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(a.artifacts.map((entry) => entry.filename), humanApproval.GOVERNED_ARTIFACTS);
  assert.equal(a.schema, humanApproval.SNAPSHOT_SCHEMA);

  // Same content in a second run directory keeps per-file hashes but changes the
  // digest, because the run id is bound in.
  const other = humanAuthoredRun('deterministic-2');
  const c = humanApproval.buildHumanPlanningApprovalSnapshot(other.dir);
  assert.deepEqual(c.artifacts, a.artifacts);
  assert.equal(c.digest, a.digest, 'same run id and content produce the same digest');
});

test('bridge HA4: a bound human approval passes', () => {
  const { dir } = humanAuthoredRun('bound');
  const prep = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  approveHuman(dir, prep.snapshotDigest);
  const verdict = verdictOfRun(dir);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.source, 'HUMAN_AUTHORED');
  assert.equal(verdict.code, null);
});

test('bridge HA5: a bare marker fails closed even with a declared human source', () => {
  const { dir } = humanAuthoredRun('bare');
  humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  fs.appendFileSync(path.join(dir, 'production-plan.md'), '\nShot/edit plan approval: PASS\n');
  const verdict = verdictOfRun(dir);
  assert.notEqual(verdict.status, 'PASS');
  assert.equal(verdict.code, 'HUMAN_PLAN_APPROVAL_DIGEST_UNKNOWN');
});

test('bridge HA6: editing any governed artifact makes the approval stale', () => {
  for (const filename of humanApproval.GOVERNED_ARTIFACTS) {
    const { dir } = humanAuthoredRun(`drift-${filename.replace(/\W/g, '')}`);
    const prep = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
    approveHuman(dir, prep.snapshotDigest);
    assert.equal(verdictOfRun(dir).status, 'PASS', `${filename} baseline`);

    const file = path.join(dir, filename);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('PLANNED |', 'PLANNED |').replace(/^# (.+)$/m, '# $1\n\n- Added after approval, never reviewed.'));
    const verdict = verdictOfRun(dir);
    assert.notEqual(verdict.status, 'PASS', `${filename} edit must invalidate approval`);
    assert.equal(verdict.code, 'HUMAN_PLAN_ARTIFACT_DRIFT', filename);
  }
});

test('bridge HA7: editing a deliberate-none rationale makes the approval stale', () => {
  const { dir } = humanAuthoredRun('nonedrift');
  const prep = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  approveHuman(dir, prep.snapshotDigest);
  assert.equal(verdictOfRun(dir).status, 'PASS');

  const file = path.join(dir, 'demo-list.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('NO_DEMO_REQUIRED', 'NO_DEMO_REQUIRED_TAMPERED'));
  const verdict = verdictOfRun(dir);
  assert.notEqual(verdict.status, 'PASS');
  assert.equal(verdict.code, 'HUMAN_PLAN_ARTIFACT_DRIFT');
});

test('bridge HA8: a notes-only edit leaves the approval valid', () => {
  const { dir } = humanAuthoredRun('notes');
  const prep = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  approveHuman(dir, prep.snapshotDigest);
  assert.equal(verdictOfRun(dir).status, 'PASS');

  const file = path.join(dir, 'shot-list.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace(materializer.HUMAN_REGION_START, `${materializer.HUMAN_REGION_START}\nMikko: keep the hook tight.`));
  const verdict = verdictOfRun(dir);
  assert.equal(verdict.status, 'PASS', 'the human-notes region is sanctioned to vary after approval');
  assert.equal(verdict.code, null);

  // And notes must not become a smuggling channel: the digest ignores them, so
  // content placed there cannot alter governed planning.
  const before = humanApproval.buildHumanPlanningApprovalSnapshot(dir).digest;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace(materializer.HUMAN_REGION_START, `${materializer.HUMAN_REGION_START}\n| smuggled row | none | high | PLANNED |`));
  assert.equal(humanApproval.buildHumanPlanningApprovalSnapshot(dir).digest, before);
});

test('bridge HA9: a governed artifact disappearing fails closed', () => {
  const { dir } = humanAuthoredRun('missing');
  const prep = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  approveHuman(dir, prep.snapshotDigest);
  assert.equal(verdictOfRun(dir).status, 'PASS');

  fs.rmSync(path.join(dir, 'b-roll-list.md'));
  assert.notEqual(verdictOfRun(dir).status, 'PASS');
  // The binding itself refuses too, not only the upstream quality check.
  const binding = humanApproval.verifyHumanApprovalBinding(dir);
  assert.equal(binding.ok, false);
  assert.equal(binding.code, 'HUMAN_PLAN_ARTIFACT_DRIFT');
});

test('bridge HA10: an unrelated file does not affect the governed digest', () => {
  const { dir } = humanAuthoredRun('extrafile');
  const prep = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  approveHuman(dir, prep.snapshotDigest);
  const before = humanApproval.buildHumanPlanningApprovalSnapshot(dir).digest;

  fs.writeFileSync(path.join(dir, 'unrelated-notes.md'), 'not part of the governed set');
  fs.writeFileSync(path.join(dir, 'takes-log.md'), '# Takes Log\n\nnot a gate-6 artifact\n');
  assert.equal(humanApproval.buildHumanPlanningApprovalSnapshot(dir).digest, before);
  assert.equal(verdictOfRun(dir).status, 'PASS');
});

test('bridge HA11: an agent approval does not transfer when a human takes over', () => {
  const { dir } = boundRun('a2h');
  assert.equal(verdictOfRun(dir).status, 'PASS');
  assert.equal(verdictOfRun(dir).source, 'AGENT_GENERATED');

  const prep = humanApproval.prepareHumanPlanningReview(dir, { supersedeAgent: true, preparedBy: 'TEST_ONLY' });
  const afterSwitch = verdictOfRun(dir);
  assert.notEqual(afterSwitch.status, 'PASS', 'the agent approval must not cover a human-owned set');
  assert.equal(afterSwitch.source, 'HUMAN_AUTHORED');
  assert.equal(afterSwitch.code, 'HUMAN_PLAN_APPROVAL_DIGEST_UNKNOWN');

  approveHuman(dir, prep.snapshotDigest);
  assert.equal(verdictOfRun(dir).status, 'PASS');
});

test('bridge HA12: a human approval does not transfer when the agent path resumes', () => {
  const { dir, planPath } = boundRun('h2a');
  // Remove the canary's agent digest so the agent path has no standing approval.
  const planFile = path.join(dir, 'production-plan.md');
  fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8')
    .split(/\r?\n/).filter((line) => !/Approved plan digest/i.test(line)).join('\n'));

  const prep = humanApproval.prepareHumanPlanningReview(dir, { supersedeAgent: true, preparedBy: 'TEST_ONLY' });
  approveHuman(dir, prep.snapshotDigest);
  assert.equal(verdictOfRun(dir).status, 'PASS');
  assert.equal(verdictOfRun(dir).source, 'HUMAN_AUTHORED');

  // The agent path cannot seize authority, even with replaceApproved.
  assert.throws(
    () => materializer.materialize(dir, planPath, { replaceApproved: true }),
    (error) => error.code === 'PLANNING_AUTHORITY_AMBIGUOUS'
  );

  humanApproval.retireHumanPlanningDeclaration(dir, { retiredBy: 'TEST_ONLY' });
  const afterRetire = verdictOfRun(dir);
  assert.notEqual(afterRetire.status, 'PASS', 'the human approval must not cover an agent plan');
  assert.equal(afterRetire.source, 'AGENT_GENERATED');
  assert.equal(afterRetire.code, 'APPROVED_PLAN_DIGEST_UNKNOWN');
});

test('bridge HA13: two declared authorities without explicit supersession fail closed', () => {
  const { dir } = boundRun('ambiguous');
  assert.equal(verdictOfRun(dir).status, 'PASS');

  // Write a human record that does NOT record taking over.
  const snapshot = humanApproval.buildHumanPlanningApprovalSnapshot(dir);
  fs.writeFileSync(path.join(dir, humanApproval.RECORD_FILE), JSON.stringify({
    schema: humanApproval.RECORD_SCHEMA,
    gate: humanApproval.GATE_ID,
    run_id: path.basename(dir),
    planning_source: 'HUMAN_AUTHORED',
    governed_artifacts: humanApproval.GOVERNED_ARTIFACTS,
    snapshot,
    supersedes: null,
    prepared_by: 'TEST_ONLY',
    approval: null,
  }, null, 2));

  const verdict = verdictOfRun(dir);
  assert.notEqual(verdict.status, 'PASS');
  assert.equal(verdict.code, 'PLANNING_AUTHORITY_AMBIGUOUS');

  // The helper refuses to create that state in the first place.
  assert.throws(
    () => humanApproval.prepareHumanPlanningReview(dir, {}),
    (error) => error.code === 'PLANNING_AUTHORITY_AMBIGUOUS'
  );
});

test('bridge HA14: changed approved manual content regresses the canonical gate', () => {
  const { root, dir } = humanAuthoredRun('regression');
  const runId = path.basename(dir);
  const opts = { repoRoot: root, runId, runDir: dir };
  const refresh = () => shotEditReview.writeOutputs(dir, shotEditReview.buildOutputs(dir), true);
  const position = () => {
    const map = workflowMap.buildWorkflowMap(dir, { repoRoot: root });
    const current = map.gates.find((gate) => String(gate.status).startsWith('current'));
    return { gate: current.id, complete: map.gates.filter((gate) => gate.status === 'complete').length };
  };

  const prep = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  approveHuman(dir, prep.snapshotDigest);
  refresh();
  assert.deepEqual(position(), { gate: 'capture-checklist', complete: 6 });

  const file = path.join(dir, 'shot-list.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace('| Hook A-roll: Mikko to camera stating the one-authority claim', '| Hook A-roll: something never reviewed'));
  refresh();

  assert.deepEqual(position(), { gate: 'shot-edit-plan-review', complete: 5 }, 'gate 6 must reopen');
  const projection = stateProjection.buildProjection(opts);
  assert.equal(projection.current_gate, 'shot-edit-plan-review');
  assert.equal(stateProjection.trackerDivergence(opts).code, 'TRACKER_CONSISTENT');
  assert.deepEqual(stateProjection.consistencyReport(opts).defects, []);
});

test('bridge HA15: the retained agent-generated canary is untouched and still at gate 7', () => {
  assert.equal(humanApproval.hasRecord(CANARY_DIR), false, 'the real canary must stay agent-generated');
  const verdict = verdictOfRun(CANARY_DIR);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.source, 'AGENT_GENERATED');
  const map = workflowMap.buildWorkflowMap(path.relative(ROOT, CANARY_DIR));
  const current = map.gates.find((gate) => String(gate.status).startsWith('current'));
  assert.equal(current.id, 'capture-checklist');
  assert.equal(map.gates.filter((gate) => gate.status === 'complete').length, 6);
});

test('bridge HA16: a digest from one mode cannot satisfy the other', () => {
  // Plan digest written under the human field name.
  {
    const { dir, planPath } = boundRun('cross-a');
    const planFile = path.join(dir, 'production-plan.md');
    fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8')
      .split(/\r?\n/).filter((line) => !/Approved plan digest/i.test(line)).join('\n'));
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    humanApproval.prepareHumanPlanningReview(dir, { supersedeAgent: true, preparedBy: 'TEST_ONLY' });
    approveHuman(dir, plan.plan_digest_sha256);
    const verdict = verdictOfRun(dir);
    assert.notEqual(verdict.status, 'PASS');
    assert.equal(verdict.code, 'HUMAN_PLAN_APPROVAL_SUPERSEDED');
  }
  // Snapshot digest written under the agent field name.
  {
    const { dir } = boundRun('cross-b');
    const planFile = path.join(dir, 'production-plan.md');
    fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8')
      .split(/\r?\n/).filter((line) => !/Approved plan digest/i.test(line)).join('\n'));
    const snapshot = humanApproval.buildHumanPlanningApprovalSnapshot(dir);
    fs.appendFileSync(planFile, `\n- Approved plan digest: ${snapshot.digest}\n`);
    const verdict = verdictOfRun(dir);
    assert.notEqual(verdict.status, 'PASS');
    assert.equal(verdict.code, 'APPROVED_PLAN_SUPERSEDED');
  }
});

test('bridge HA17: every gate-6 PASS carries a real binding, in either mode', () => {
  // The structural invariant: there is no marker-only PASS branch anywhere.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-shot-edit-plan-review.js'), 'utf8');
  assert.ok(/resolvePlanningApproval/.test(source), 'the evaluator must dispatch on declared provenance');
  assert.ok(/binding && !binding\.ok/.test(source), 'a failed binding must block PASS');

  // Both accepted modes, and nothing else.
  assert.equal(humanApproval.PLANNING_SOURCE, 'HUMAN_AUTHORED');
  assert.equal(materializer.MACHINE_OWNER, 'visual_planning_director');
  // The two modules must agree on the governed set and the record filename.
  assert.deepEqual(humanApproval.GOVERNED_ARTIFACTS, materializer.OUTPUT_FILES);
  assert.equal(materializer.HUMAN_PLANNING_RECORD, humanApproval.RECORD_FILE);
});

test('bridge HA18: preparing a snapshot is not an approval', () => {
  const { dir } = humanAuthoredRun('notapproval');
  const prep = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  assert.equal(prep.record.approval, null, 'the record carries no verdict');
  assert.equal(verdictOfRun(dir).status, 'READY FOR HUMAN APPROVAL');
  // Re-preparing is idempotent and still not an approval.
  const again = humanApproval.prepareHumanPlanningReview(dir, { preparedBy: 'TEST_ONLY' });
  assert.equal(again.unchanged, true);
  assert.equal(verdictOfRun(dir).status, 'READY FOR HUMAN APPROVAL');
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
