'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const contract = require('../scripts/story-edit-contract.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-edit-contract-'));
  const sb = path.join(root, 'sb');
  fs.mkdirSync(path.join(sb, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(sb, 'lib', 'versions.js'), `module.exports={listVersions:()=>[{id:'v1',content_hash:'${'a'.repeat(64)}'}]};\n`);
  const binding = { binding_id: 'b1', section_id: 'hook', assertion_text: 'The render is 40% faster.', claim_ref: { canonical_id: 'claim-speed' }, research_result_ref: { result_id: 'research-speed' } };
  const story = { schema_version: 1, artifact_type: 'story-script-version', project_id: 'project-1', version_id: 'v1', parent_version: null, content_hash: 'a'.repeat(64), central_claim: 'A bounded workflow.', sections: [{ id: 'hook', order: 1, beat: 'Hook', dialogue: 'The render is 40% faster. Now look at the workflow differently.' }], approval: { state: 'approved' }, research: { bindings: [binding], result_refs: [] } };
  return { task: { script_builder_root: sb, data_root: root }, story };
}

test('SEC1 bound and rhetorical sentences are visibly distinct before editing', () => {
  const f = fixture(); const out = contract.project({ ...f, ownership: { current_owner: 'HUMAN', revision: 2 }, title: 'Project One' });
  assert.deepEqual(out.sections[0].sentences.map((x) => x.classification), ['RESEARCH_BOUND', 'HUMAN_EDITABLE']);
  assert.equal(out.sections[0].sentences[0].research_bindings[0].claim_ref, 'claim-speed');
  assert.match(out.handoff.url, /project_id=project-1&version_id=v1/);
  assert.equal(out.approval.edit_effect, 'STALE');
});

test('SEC2 whitespace normalization preserves exact bounded assertion continuity', () => {
  const f = fixture(); const section = { ...f.story.sections[0], dialogue: 'The render is   40% faster.\n\nNow look at the workflow differently.' };
  assert.equal(contract.classifySentence(f.story, section, 'The render is 40% faster.').classification, 'RESEARCH_BOUND');
});

test('SEC3 changed numbers and new factual assertions require Research or specialist review', () => {
  const f = fixture(); const section = f.story.sections[0];
  assert.equal(contract.classifySentence(f.story, section, 'The render is 80% faster.').classification, 'REQUIRES_RESEARCH_OR_SPECIALIST');
  assert.equal(contract.classifySentence(f.story, section, 'The benchmark shows lower costs.').classification, 'REQUIRES_RESEARCH_OR_SPECIALIST');
});

test('SEC4 exact HUMAN-owned Story head is fenced against concurrent Script Builder versions', () => {
  const f = fixture(); contract.assertExactHead(f.task, f.story);
  fs.writeFileSync(path.join(f.task.script_builder_root, 'lib', 'versions.js'), `module.exports={listVersions:()=>[{id:'v2',content_hash:'${'b'.repeat(64)}'}]};\n`);
  delete require.cache[require.resolve(path.join(f.task.script_builder_root, 'lib', 'versions.js'))];
  assert.throws(() => contract.assertExactHead(f.task, f.story), (e) => e.code === 'UPSTREAM_STORY_HEAD_CHANGED');
});

(async () => { let failed = 0; for (const t of tests) { try { await t.fn(); console.log(`ok - ${t.name}`); } catch (e) { failed++; console.error(`not ok - ${t.name}\n${e.stack}`); } } console.log(`${tests.length - failed}/${tests.length} Story Edit Contract tests passed`); if (failed) process.exitCode = 1; })();
