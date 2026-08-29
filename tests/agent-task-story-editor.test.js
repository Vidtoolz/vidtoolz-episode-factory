'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { tests, test } = require('./_helpers');
const assembler = require('../scripts/agent-task-story-editor');
const researchValidator = require('../scripts/research-result-validator.js');
const storySuccessor = require('../scripts/story-successor.js');
const storyFixture = require('./story-authority-live-fixture.js');

// Project identity is stable; the Story version/head is resolved live through
// the production authority at test time and is NEVER pinned here — a
// legitimate human-approved successor moves these tests without breaking
// them. Exact historical versions belong in hermetic fixtures (ASE18) or the
// negative predecessor proof (ASE17).
const REAL_PROJECT = '01M0QR9DGP5RRFTPVDA7WQP2XM';

function fakeBuilder(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-assembler-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true }); fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const version = { id: 'v1', project_id: 'p1', content_hash: 'hash-1', sections: [{ id: 's1', order: 1, dialogue: over.dialogue || 'Exact words.' }], central_claim: 'Claim', narrative_spine: over.spine === undefined ? 'hook-proof-payoff' : over.spine, approval: { state: over.approval || 'none', ...(over.approvedBy ? { approved_by: over.approvedBy } : {}) } };
  const project = { id: 'p1', approved_version_id: over.approvedVersion || null };
  fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ project, version, latest: over.latest || 'v1' }));
  fs.writeFileSync(path.join(root, 'lib/store.js'), `const f=require('../fixture.json');exports.loadProject=()=>f.project;`);
  fs.writeFileSync(path.join(root, 'lib/versions.js'), `const f=require('../fixture.json');exports.loadVersion=(d,p,v)=>v===f.version.id?f.version:null;exports.listVersions=()=>[{...f.version,id:f.latest}];exports.scriptContentHash=()=>f.version.content_hash;`);
  return root;
}

test('ASE1: reads the real canonical Story version live', () => {
  // LIVE-CURRENT-HEAD contract: resolve the canonical head through the SAME
  // authoritative mechanism production uses, assemble through the production
  // assembler, and assert invariant properties only. No version id or content
  // hash is pinned, so a legitimate human-approved successor keeps this test
  // green by design.
  const live = storyFixture.resolveLiveCanonicalHead(REAL_PROJECT);
  assert.ok(live.project, 'canonical project must exist in the resolved Script Builder authority');
  assert.ok(live.head, 'canonical project must have at least one Story version');
  const out = assembler.assembleStoryEditorTask({ projectId: REAL_PROJECT, versionId: live.head.id, runId: 'run-real', taskId: 'task-real' });
  assert.equal(out.task.script_version_id, live.head.id);
  assert.equal(out.task.project_id, REAL_PROJECT);
  assert.equal(out.task.script_content_hash, live.versions.scriptContentHash(live.head.sections));
  assert.equal(out.task.script_sections.length, live.head.sections.length);
  assert.equal(out.authority.current, true);
  assert.equal(out.authority.content_hash, live.head.content_hash);
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
  const f = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'))); f.version.approval = { state: 'approved', approved_by: 'Mikko' }; f.project.approved_version_id = 'v1'; fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify(f)); delete require.cache[require.resolve(path.join(root, 'lib/store.js'))]; delete require.cache[require.resolve(path.join(root, 'lib/versions.js'))];
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

test('ASE13: PLAN_SCRIPT_APPROVAL requires an explicit human approver identity', () => {
  for (const approvedBy of [undefined, 'story_editor', 'Hermes']) {
    const root = fakeBuilder({ approval: 'approved', approvedVersion: 'v1', approvedBy });
    assert.throws(() => assembler.loadStoryAuthority({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1' }), (error) => error.code === 'PLAN_SCRIPT_APPROVER_NOT_HUMAN');
  }
  const root = fakeBuilder({ approval: 'approved', approvedVersion: 'v1', approvedBy: 'Mikko' });
  assert.equal(assembler.loadStoryAuthority({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1' }).authority.approved_by, 'Mikko');
});

function canonicalResearch(runId, assertion) {
  const h = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const result = {
    result_id: `research-result-${crypto.randomUUID()}`, result_revision: 1,
    claim_ref: { namespace: 'vidtoolz-episode-factory/package-run-claim', canonical_id: `claim-${crypto.randomUUID()}`, revision: 1, alias_ids: [] },
    claim: { evaluated_text: assertion, evaluated_text_sha256: h(assertion), temporal: { temporal_class: 'EVERGREEN_FACT' } },
    judgment: { support_status: 'SUPPORTED', freshness_status_at_review: 'NOT_APPLICABLE', evidence_quality: 'ADEQUATE', confidence: 'HIGH', independence_status: 'ADEQUATE', contradiction_status: 'NONE', disagreement_state: 'NONE', recommendation: 'ALLOW_USE', rationale: 'bounded fixture', unresolved_questions: [] },
    qualification: { qualification_required: false, wording_constraints: [] },
    sources: [{ source_ref: 'source-1', source_class: 'REPORTING', original_source: { source_id: 'original-1', title: 'Source', url: 'https://example.test/source', publisher: 'Example' }, container: { container_type: 'local_file', relationship_to_original: 'IS_ORIGINAL', source_id: 'source-1', title: 'Source', retrieved_at: '2026-08-24T09:00:00Z', retrieved_content_sha256: h('source') }, independence_group: 'group-1', independence_basis: 'independent fixture' }],
    evidence: [{ evidence_id: 'evidence-1', source_ref: 'source-1', stance: 'SUPPORTS', excerpt: { exact_text: 'supporting excerpt', exact_text_sha256: h('supporting excerpt') } }],
    derived: { independent_support_count: 1 }, provenance: { provenance_inputs: [{ system: 'test', type: 'fixture', record_id: 'record-1', sha256: h('record') }] },
    lifecycle: { created_at: '2026-08-24T09:00:00Z', reviewed_at: '2026-08-24T09:00:00Z' },
  };
  const root = { schema_version: 1, artifact_type: 'research-results', package_run_id: runId, results: [result] };
  result.result_digest_sha256 = researchValidator.computeResultDigest(root, result);
  return { root, result, h };
}

function successorBuilder(assertion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-successor-builder-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true }); fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const base = { project_id: 'p1', central_claim: 'Claim', narrative_spine: 'hook-proof-payoff', approval: { state: 'none' } };
  const v1 = { ...base, id: 'v1', parent_version: null, content_hash: 'a'.repeat(64), sections: [{ id: 's1', order: 1, dialogue: assertion }] };
  const v2 = { ...base, id: 'v2', parent_version: 'v1', content_hash: 'b'.repeat(64), sections: [{ id: 's1', order: 1, dialogue: assertion }, { id: 's2', order: 2, dialogue: 'A non-factual transition.' }] };
  const project = { id: 'p1', approved_version_id: null };
  fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ project, versions: [v1], latest: 'v1' }));
  fs.writeFileSync(path.join(root, 'lib/store.js'), `const fs=require('fs'),p=require('path'),file=p.join(__dirname,'../fixture.json');exports.loadProject=()=>JSON.parse(fs.readFileSync(file)).project;`);
  fs.writeFileSync(path.join(root, 'lib/versions.js'), `const fs=require('fs'),p=require('path'),file=p.join(__dirname,'../fixture.json');const f=()=>JSON.parse(fs.readFileSync(file));exports.loadVersion=(d,p,id)=>f().versions.find(v=>v.id===id)||null;exports.listVersions=()=>f().versions;exports.scriptContentHash=(sections)=>{const x=f().versions.find(v=>JSON.stringify(v.sections)===JSON.stringify(sections));return x?x.content_hash:'invalid';};exports.diffVersions=()=>({identical:false,added:1,removed:0,lines:[]});`);
  return { root, v1, v2, publishV2() { fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ project, versions: [v1, v2], latest: 'v2' })); } };
}

test('ASE14: canonical assembler binds exact Research run, results, hashes, and Story bindings', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story-research-repo-'));
  const runDir = path.join(repoRoot, 'package-runs', 'run-1'); fs.mkdirSync(runDir, { recursive: true });
  const assertion = 'The render is faster.'; const research = canonicalResearch('run-1', assertion);
  fs.writeFileSync(path.join(runDir, 'research-results.json'), JSON.stringify(research.root));
  const binding = { binding_id: 'binding-1', section_id: 's1', assertion_text: assertion, assertion_text_sha256: research.h(assertion), claim_ref: research.result.claim_ref, research_result_ref: { package_run_id: 'run-1', result_id: research.result.result_id, result_revision: 1, result_digest_sha256: research.result.result_digest_sha256 }, satisfied_constraint_ids: [] };
  fs.writeFileSync(path.join(runDir, 'script-claim-bindings.json'), JSON.stringify({ schema_version: 1, project_id: 'p1', script_version_id: 'v1', script_content_hash: 'hash-1', bindings: [binding] }));
  const root = fakeBuilder({ dialogue: assertion });
  const { task } = assembler.assembleStoryEditorTask({ repoRoot, scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1' });
  assert.equal(task.research.status, 'VERIFIED'); assert.equal(task.research.run_dir, runDir);
  assert.match(task.research.research_results_sha256, /^[a-f0-9]{64}$/); assert.match(task.research.bindings_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(task.script_claim_bindings, [binding]); assert.deepEqual(task.research_result_refs, [binding.research_result_ref]);
});

test('ASE15: missing or detached Research authority fails closed instead of silently skipping', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story-research-missing-')); const runDir = path.join(repoRoot, 'package-runs', 'run-1'); fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'script-claim-bindings.json'), '{}');
  const root = fakeBuilder();
  assert.throws(() => assembler.assembleStoryEditorTask({ repoRoot, scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1' }), (error) => error.code === 'RESEARCH_CONTEXT_MISSING');
});

test('ASE16: assembler-produced Research context reaches canonical successor binding verification', () => {
  const assertion = 'The render is faster.'; const builder = successorBuilder(assertion);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story-research-integration-')); const runDir = path.join(repoRoot, 'package-runs', 'run-1'); fs.mkdirSync(runDir, { recursive: true });
  const research = canonicalResearch('run-1', assertion); const resultsPath = path.join(runDir, 'research-results.json'); fs.writeFileSync(resultsPath, JSON.stringify(research.root));
  const binding = { binding_id: 'binding-1', section_id: 's1', assertion_text: assertion, assertion_text_sha256: research.h(assertion), claim_ref: research.result.claim_ref, research_result_ref: { package_run_id: 'run-1', result_id: research.result.result_id, result_revision: 1, result_digest_sha256: research.result.result_digest_sha256 }, satisfied_constraint_ids: [] };
  fs.writeFileSync(path.join(runDir, 'script-claim-bindings.json'), JSON.stringify({ schema_version: 1, project_id: 'p1', script_version_id: 'v1', script_content_hash: builder.v1.content_hash, bindings: [binding] }));
  const task = assembler.assembleStoryEditorTask({ repoRoot, scriptBuilderRoot: builder.root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'task-1' }).task;
  builder.publishV2();
  const previous = storySuccessor.versionArtifact(builder.v1, task, [binding]);
  const next = storySuccessor.versionArtifact(builder.v2, task, [binding]);
  const context = { agentId: 'story_editor', task };
  const valid = storySuccessor.validate(context, previous, next, { createdAt: '2026-08-24T10:00:00Z' });
  assert.equal(valid.valid, true, JSON.stringify(valid)); assert.equal(valid.story_revision_review.research_impact.unchanged.length, 1);
  const corrupted = JSON.parse(fs.readFileSync(resultsPath)); corrupted.results[0].result_digest_sha256 = '0'.repeat(64); fs.writeFileSync(resultsPath, JSON.stringify(corrupted));
  const refused = storySuccessor.validate(context, previous, next);
  assert.equal(refused.valid, false); assert.ok(refused.reason_codes.includes('STORY_RESEARCH_CONTEXT_HASH_CHANGED'));
});

test('ASE17: stale predecessor Story stays rejected wherever the current head is required (live negative proof)', () => {
  // Mandatory negative stale-Story proof (§7), resolved dynamically against
  // the live authority: any known-valid non-head version must be refused by
  // the production assembler's certified stale refusal. No literal version id
  // is pinned, so the proof tracks whatever the live canonical chain holds.
  const live = storyFixture.resolveLiveCanonicalHead(REAL_PROJECT);
  if (live.list.length < 2) return; // single-version store: covered hermetically by ASE18
  const predecessor = live.list[0];
  assert.notEqual(predecessor.id, live.head.id, 'predecessor must be a distinct, older canonical version');
  assert.throws(
    () => assembler.assembleStoryEditorTask({ projectId: REAL_PROJECT, versionId: predecessor.id, runId: 'run-ase17', taskId: 'task-ase17' }),
    /version is stale/
  );
});

test('ASE18: hermetic successor anti-rot — the current-head invariant survives a canonical successor and the stale predecessor stays rejected', () => {
  // Successor anti-rot proof (§10): HEAD V1 → assembly binds V1; a canonical
  // successor V2 becomes current → the SAME live-current-head code path binds
  // V2 without any source change; using V1 where the current head is required
  // stays rejected with the certified stale refusal. Built with the real
  // pinned Script Builder implementation over an isolated data directory —
  // one authority, zero test-local head logic.
  const fixture = storyFixture.canonicalStoryFixture();
  const project = fixture.store.saveProject(fixture.dataRoot, fixture.store.newProject({ id: 'pfx-ase18', title: 'ASE18 anti-rot fixture', length_class: 'short' }));
  const sectionsV1 = [{ id: 's1', order: 1, dialogue: 'First canonical words.' }];
  const v1 = fixture.versions.createVersion(fixture.dataRoot, project, sectionsV1, fixture.config.loadConfig(fixture.dataRoot), {});
  const asHead = (versionId) => assembler.assembleStoryEditorTask({ scriptBuilderRoot: fixture.root, projectId: project.id, versionId, runId: 'run-ase18', taskId: 'task-ase18' });
  assert.equal(asHead(v1.id).task.script_version_id, v1.id);
  // Pace past the ULID millisecond boundary so the successor's creation
  // timestamp orders strictly after V1 (Script Builder head ordering is ULID
  // lexicographic; same-millisecond creations have random suffix order).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
  const sectionsV2 = [{ id: 's1', order: 1, dialogue: 'Amended canonical words.' }];
  const v2 = fixture.versions.createVersion(fixture.dataRoot, project, sectionsV2, fixture.config.loadConfig(fixture.dataRoot), {});
  const afterSuccessor = asHead(fixture.versions.listVersions(fixture.dataRoot, project.id).at(-1).id);
  assert.equal(afterSuccessor.task.script_version_id, v2.id);
  assert.equal(afterSuccessor.task.script_content_hash, fixture.versions.scriptContentHash(sectionsV2));
  assert.equal(afterSuccessor.authority.current, true);
  assert.throws(() => asHead(v1.id), /version is stale/);
});

if (require.main === module) {
  (async () => { let passed = 0, failed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (e) { failed++; console.error(`not ok - ${item.name}`); console.error(e); } } console.log(`${passed}/${passed + failed} Story Task Assembler tests passed`); if (failed) process.exitCode = 1; })();
}
