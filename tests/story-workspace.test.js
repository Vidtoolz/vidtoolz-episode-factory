'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const compat = require('../scripts/script-builder-compat.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('SW1 Episode Factory and Script Builder share an explicit executable version-authority contract', () => {
  const loaded = compat.load('/home/vidtoolz/vidtoolz-script-builder');
  assert.equal(loaded.contract.contract_id, compat.SUPPORTED_CONTRACT_ID);
  assert.equal(loaded.versions.scriptContentHash(compat.VECTOR_SECTIONS), compat.VECTOR_HASH);
});

test('SW2 missing, renamed, or behaviorally drifted Script Builder authority fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-compat-'));
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'lib/versions.js'), `module.exports={VERSION_AUTHORITY_CONTRACT:{contract_id:'wrong/v2'},scriptContentHash:()=> '${compat.VECTOR_HASH}'};\n`);
  assert.throws(() => compat.load(root), (error) => error.code === 'SCRIPT_BUILDER_CONTRACT_INCOMPATIBLE');
});

test('SW3 Story workspace UI is exact-identity driven and keeps authority identifiers secondary', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'story-editor-workspace.html'), 'utf8');
  for (const text of ['Sentence edit contract', 'HUMAN_EDITABLE', 'RESEARCH_BOUND', 'REQUIRES_RESEARCH_OR_SPECIALIST',
    'Open exact version in Script Builder', 'Manual edit history', 'Preview Return to Automation', 'Technical details']) assert.match(html, new RegExp(text));
  assert.match(html, /Exact run, agent, task and invocation are required/);
  assert.doesNotMatch(html, /contenteditable|generic JSON editor/i);
  assert.match(html, /manual-edit-recovery\/preview/);
  assert.match(html, /manual-edit-recovery\/apply/);
  assert.match(html, /return-to-automation\/preview/);
  assert.match(html, /return-to-automation\/apply/);
  assert.match(html, /restore_revision_id:rv\.restored_artifact\.revision_id/);
  assert.match(html, /preview_created_at:rv\.preview_created_at/);
  assert.match(html, /preview_created_at:ret\.preview_created_at/);
});

(async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}\n${error.stack}`); process.exitCode = 1; } } console.log(`${passed}/${tests.length} Story Workspace tests passed`); })();
module.exports = { tests };
