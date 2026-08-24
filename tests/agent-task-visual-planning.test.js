'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tests, test } = require('./_helpers.js');
const assembler = require('../scripts/agent-task-visual-planning.js');
const director = require('../scripts/visual-planning-director.js');

const REAL_PROJECT = '01M0QR9DGP5RRFTPVDA7WQP2XM';
const REAL_VERSION = '01M0QR9DGRPW4MK8BMD1RGAYDX';
const REAL_HASH = 'f6d38d2bc156ab537256ac0d0843a6ca9919e5749c55d581dd98cb36ef457671';

function fakeBuilder(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-planning-assembler-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const sections = overrides.sections === undefined ? [
    { id: 's1', order: 1, beat: 'Hook', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'Exact hook.', visual_notes: '', media_refs: [] },
    { id: 's2', order: 2, beat: 'Proof', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'Exact proof.', visual_notes: '', media_refs: [] },
  ] : overrides.sections;
  const approval = overrides.approval === 'approved'
    ? { state: 'approved', approved_by: 'Mikko', at: '2026-08-23T12:00:00.000Z', note: 'accepted' }
    : { state: 'none', at: null, note: null };
  const fixture = {
    project: { id: 'p1', approved_version_id: overrides.approval === 'approved' ? 'v1' : null, output_class: { aspect_ratio: '9:16', orientation: 'vertical', length_class: 'short', max_duration_minutes: 3 } },
    version: { id: 'v1', project_id: 'p1', content_hash: overrides.contentHash || 'a'.repeat(64), computed_hash: overrides.computedHash || overrides.contentHash || 'a'.repeat(64), sections, central_claim: 'Exact claim', narrative_spine: Object.hasOwn(overrides, 'narrativeSpine') ? overrides.narrativeSpine : 'hook-proof', approval },
    latest: overrides.latest || 'v1',
  };
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const loader = `const fs=require('node:fs');const p=${JSON.stringify(fixturePath)};const f=()=>JSON.parse(fs.readFileSync(p,'utf8'));`;
  fs.writeFileSync(path.join(root, 'lib', 'store.js'), `${loader}exports.loadProject=()=>f().project;`);
  fs.writeFileSync(path.join(root, 'lib', 'versions.js'), `${loader}exports.loadVersion=(d,p,v)=>v===f().version.id?f().version:null;exports.listVersions=()=>[{...f().version,id:f().latest}];exports.scriptContentHash=()=>f().version.computed_hash;`);
  return { root, fixturePath };
}

function assemble(root, overrides = {}) {
  return assembler.assembleVisualPlanningTask({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'visual-plan-v1', ...overrides });
}

test('AVP1 reads the real current canonical Story live', () => { const out = assembler.assembleVisualPlanningTask({ projectId: REAL_PROJECT, versionId: REAL_VERSION, runId: 'real-vpd-stage1', taskId: 'visual-plan-real-v1' }); assert.equal(out.task.story.content_hash, REAL_HASH); assert.equal(out.task.story.sections.length, 11); assert.deepEqual(out.task.story.sections.map((section) => section.order), [1,2,3,4,5,6,7,8,9,10,11]); });
test('AVP2 maps exact native VPD task identity', () => { const { root } = fakeBuilder(); const { task } = assemble(root); assert.equal(task.action, 'plan_visuals'); assert.equal(task.project_id, 'p1'); assert.equal(task.package_run_id, 'run-1'); assert.equal(task.story.version_id, 'v1'); });
test('AVP3 creates one required beat per ordered canonical section', () => { const { root } = fakeBuilder(); const { task } = assemble(root); assert.deepEqual(task.required_beats.map((beat) => beat.section_id), ['s1', 's2']); assert.equal(task.required_beats.length, task.story.sections.length); });
test('AVP4 derived beats pass the unchanged VPD preflight', () => { const { root } = fakeBuilder(); assert.equal(director.preflight(assemble(root).task).ok, true); });
test('AVP5 refuses a non-head Story version', () => { const { root } = fakeBuilder({ latest: 'v2' }); assert.throws(() => assemble(root), /version is stale/); });
test('AVP6 refuses recomputed Story hash drift', () => { const { root } = fakeBuilder({ computedHash: 'b'.repeat(64) }); assert.throws(() => assemble(root), /content hash is invalid/); });
test('AVP7 approval none maps truthfully with explicit nulls', () => { const { root } = fakeBuilder(); const out = assemble(root); assert.deepEqual(out.task.story.approval, { state: 'none', approved_by: null, approved_at: null, version_id: 'v1', content_hash: 'a'.repeat(64) }); assert.equal(out.authority.human_approval_present, false); });
test('AVP8 exact approved Story evidence maps to production-intent approval', () => { const { root } = fakeBuilder({ approval: 'approved' }); const out = assemble(root); assert.equal(out.task.story.approval.state, 'approved'); assert.equal(out.task.story.approval.approved_by, 'Mikko'); assert.equal(out.authority.human_approval_present, true); });
test('AVP9 approved label without exact human evidence fails closed', () => { const { root, fixturePath } = fakeBuilder({ approval: 'approved' }); const fixture = JSON.parse(fs.readFileSync(fixturePath)); delete fixture.version.approval.approved_by; fs.writeFileSync(fixturePath, JSON.stringify(fixture)); assert.throws(() => assemble(root), (error) => error.code === 'PLAN_SCRIPT_APPROVER_NOT_HUMAN'); });
test('AVP10 null narrative spine passes through unchanged', () => { const { root } = fakeBuilder({ narrativeSpine: null }); assert.equal(assemble(root).task.story.narrative_spine, null); });
test('AVP11 central claim and exact section dialogue pass through', () => { const { root } = fakeBuilder(); const { story } = assemble(root).task; assert.equal(story.central_claim, 'Exact claim'); assert.deepEqual(story.sections.map((section) => section.dialogue), ['Exact hook.', 'Exact proof.']); });
test('AVP12 current approval is re-read on every assembly', () => { const { root, fixturePath } = fakeBuilder(); assert.equal(assemble(root).task.story.approval.state, 'none'); const fixture = JSON.parse(fs.readFileSync(fixturePath)); fixture.project.approved_version_id = 'v1'; fixture.version.approval = { state: 'approved', approved_by: 'Mikko', at: '2026-08-23T12:00:00.000Z' }; fs.writeFileSync(fixturePath, JSON.stringify(fixture)); assert.equal(assemble(root).task.story.approval.state, 'approved'); });
test('AVP13 operator instructions pass verbatim without Creative synthesis', () => { const { root } = fakeBuilder(); const text = 'Keep the exact supplied monochrome reference; ask if unavailable.'; const task = assemble(root, { operatorInstructions: text }).task; assert.equal(task.operator_instructions, text); assert.equal('creative_doctrine_ref' in task, false); });
test('AVP14 no Research bindings produces an exact empty authority block', () => { const { root } = fakeBuilder(); assert.deepEqual(assemble(root).task.research, { bindings_doc: { bindings: [] }, current_result_refs: [], required_constraint_ids: [], authority_by_binding: {} }); });
test('AVP15 output target comes from the canonical project', () => { const { root } = fakeBuilder(); assert.deepEqual(assemble(root).task.output_target, { aspect_ratio: '9:16', orientation: 'vertical', length_class: 'short', max_duration_minutes: 3 }); });
test('AVP16 assembler writes only the native task envelope', () => { const { root } = fakeBuilder(); const assembled = assemble(root); const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'visual-task-out-')), 'task.json'); assembler.writeTask(output, assembled.task); const persisted = JSON.parse(fs.readFileSync(output)); assert.deepEqual(persisted, assembled.task); assert.equal('authority' in persisted, false); assert.equal('visual_plan' in persisted, false); });
test('AVP17 assembler does not invoke a model or create a Visual Plan', () => { const { root } = fakeBuilder(); const { task } = assemble(root); assert.equal('visual_plan' in task, false); assert.equal('model' in task, false); assert.equal('approval_binding' in task, false); });
test('AVP18 exact Script Builder aliases and provenance survive assembly', () => { const { root } = fakeBuilder(); const beat = assemble(root).task.required_beats[0]; assert.deepEqual(beat.aliases, [{ namespace: 'vidtoolz-script-builder/section', id: 's1' }]); assert.deepEqual(beat.source_provenance, { source_system: 'vidtoolz-script-builder', source_id: 'p1/v1/s1' }); });
test('AVP19 agent-looking PLAN_SCRIPT_APPROVAL approver is rejected', () => { const { root, fixturePath } = fakeBuilder({ approval: 'approved' }); const fixture = JSON.parse(fs.readFileSync(fixturePath)); fixture.version.approval.approved_by = 'story_editor'; fs.writeFileSync(fixturePath, JSON.stringify(fixture)); assert.throws(() => assemble(root), (error) => error.code === 'PLAN_SCRIPT_APPROVER_NOT_HUMAN'); });

if (require.main === module) {
  (async () => { let passed = 0, failed = 0; for (const item of tests) { try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); } catch (error) { failed += 1; console.error(`not ok - ${item.name}`); console.error(error.stack || error.message); } } console.log(`${passed}/${passed + failed} Visual Planning Task Assembler tests passed`); if (failed) process.exitCode = 1; })();
}

module.exports = { tests };
