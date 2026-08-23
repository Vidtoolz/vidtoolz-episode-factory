'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tests, test } = require('./_helpers');
const assembler = require('../scripts/agent-task-story-editor');

const REAL_PROJECT = '01M0QR9DGP5RRFTPVDA7WQP2XM';
const REAL_VERSION = '01M0QR9DGRPW4MK8BMD1RGAYDX';
const REAL_HASH = 'f6d38d2bc156ab537256ac0d0843a6ca9919e5749c55d581dd98cb36ef457671';

function fakeBuilder(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-assembler-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true }); fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const version = { id: 'v1', project_id: 'p1', content_hash: 'hash-1', sections: [{ id: 's1', order: 1, dialogue: 'Exact words.' }], central_claim: 'Claim', narrative_spine: over.spine === undefined ? 'hook-proof-payoff' : over.spine, approval: { state: over.approval || 'none' } };
  const project = { id: 'p1', approved_version_id: over.approvedVersion || null };
  fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ project, version, latest: over.latest || 'v1' }));
  fs.writeFileSync(path.join(root, 'lib/store.js'), `const f=require('../fixture.json');exports.loadProject=()=>f.project;`);
  fs.writeFileSync(path.join(root, 'lib/versions.js'), `const f=require('../fixture.json');exports.loadVersion=(d,p,v)=>v===f.version.id?f.version:null;exports.listVersions=()=>[{...f.version,id:f.latest}];exports.scriptContentHash=()=>f.version.content_hash;`);
  return root;
}

test('ASE1: reads the real canonical Story version live', () => {
  const out = assembler.assembleStoryEditorTask({ projectId: REAL_PROJECT, versionId: REAL_VERSION, runId: 'run-real', taskId: 'task-real' });
  assert.equal(out.task.script_content_hash, REAL_HASH); assert.equal(out.task.script_sections.length, 11); assert.equal(out.authority.current, true);
});
test('ASE2: exact native Story Editor action and identity are assembled', () => {
  const root = fakeBuilder(); const out = assembler.assembleStoryEditorTask({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1' });
  assert.equal(out.task.assignment.action, 'review_script'); assert.equal(out.task.project_id, 'p1'); assert.equal(out.task.script_version_id, 'v1'); assert.deepEqual(out.task.script_sections, [{ id: 's1', order: 1, dialogue: 'Exact words.' }]);
});
test('ASE3: unapproved state is observed without fabrication', () => {
  const root = fakeBuilder(); const out = assembler.assembleStoryEditorTask({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1' });
  assert.equal(out.authority.approval_state, 'none'); assert.equal(out.authority.human_approval_present, false); assert.equal('approval' in out.task, false);
});
test('ASE4: changed canonical approval state is observed on the next read', () => {
  const root = fakeBuilder(); let out = assembler.loadStoryAuthority({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1' }); assert.equal(out.authority.human_approval_present, false);
  const f = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'))); f.version.approval.state = 'approved'; f.project.approved_version_id = 'v1'; fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify(f)); delete require.cache[require.resolve(path.join(root, 'lib/store.js'))]; delete require.cache[require.resolve(path.join(root, 'lib/versions.js'))];
  delete require.cache[require.resolve(path.join(root, 'fixture.json'))];
  out = assembler.loadStoryAuthority({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1' }); assert.equal(out.authority.human_approval_present, true); assert.equal(out.authority.approval_state, 'approved');
});
test('ASE5: missing canonical project is rejected', () => {
  const root = fakeBuilder(); const store = path.join(root, 'lib/store.js'); fs.writeFileSync(store, `exports.loadProject=()=>null;`); delete require.cache[require.resolve(store)];
  assert.throws(() => assembler.loadStoryAuthority({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1' }), /project not found/);
});
test('ASE6: missing canonical version is rejected', () => {
  const root = fakeBuilder(); assert.throws(() => assembler.loadStoryAuthority({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'missing' }), /version not found/);
});
test('ASE7: stale canonical version is rejected', () => {
  const root = fakeBuilder({ latest: 'v2' }); assert.throws(() => assembler.loadStoryAuthority({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1' }), /version is stale/);
});
test('ASE8: content-hash corruption is rejected', () => {
  const root = fakeBuilder(); const versions = path.join(root, 'lib/versions.js'); fs.writeFileSync(versions, `const f=require('../fixture.json');exports.loadVersion=()=>f.version;exports.listVersions=()=>[f.version];exports.scriptContentHash=()=> 'wrong';`); delete require.cache[require.resolve(versions)];
  assert.throws(() => assembler.loadStoryAuthority({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1' }), /content hash is invalid/);
});
test('ASE9: null canonical narrative spine remains null', () => {
  const root = fakeBuilder({ spine: null }); const out = assembler.assembleStoryEditorTask({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1' });
  assert.equal(out.task.narrative_spine, null); assert.equal(out.authority.narrative_spine_present, false);
});
test('ASE10: assembler cannot manufacture a human approval field', () => {
  const root = fakeBuilder(); const out = assembler.assembleStoryEditorTask({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1', approval: 'approved' });
  assert.equal(out.authority.human_approval_present, false); assert.equal(JSON.stringify(out.task).includes('TEST_HUMAN'), false);
});
test('ASE11: only review_script is supported', () => {
  const root = fakeBuilder(); assert.throws(() => assembler.assembleStoryEditorTask({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1', action: 'revise_script' }), /supports review_script only/);
});
test('ASE12: task is local-only with bounded model attempts', () => {
  const root = fakeBuilder(); const { task } = assembler.assembleStoryEditorTask({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1' });
  assert.deepEqual(task.privacy, { local_only: true }); assert.equal(task.retry_budget, 2); assert.equal(task.cost_budget.max_model_calls, 2);
});

if (require.main === module) {
  (async () => { let passed = 0, failed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (e) { failed++; console.error(`not ok - ${item.name}`); console.error(e); } } console.log(`${passed}/${passed + failed} Story Task Assembler tests passed`); if (failed) process.exitCode = 1; })();
}
