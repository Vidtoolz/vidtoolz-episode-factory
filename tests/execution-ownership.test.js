'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, tests } = require('./_helpers.js');
const ownership = require('../scripts/execution-ownership.js');
const ledger = require('../scripts/operator-action-ledger.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-'));
  fs.mkdirSync(path.join(root, 'package-runs/run-1/agents'), { recursive: true });
  const target = { run_id: 'run-1', agent_id: 'story_editor', task_id: 'task-1' };
  return { root, target, actor: ledger.localActorContext({ username: 'mikko' }), taskHash: crypto.createHash('sha256').update('task').digest('hex') };
}
function take(f, extra = {}) {
  const current = ownership.readOwnership(f.root, f.target);
  return ownership.transition(f.root, { ...f.target, action: 'TAKE_MANUAL_CONTROL', next_owner: 'HUMAN', originating_invocation_id: 'story_editor:task-1:1', reason: 'Bounded manual correction.', task_sha256: f.taskHash, artifact_sha256: null, expected_revision: current.revision, expected_state_hash: current.current_state_hash, ...extra }, { actor: f.actor, recordId: 'operator-action-take-1', now: '2026-08-24T09:00:00.000Z' });
}

test('ownership defaults to AUTOMATION and a durable transition is ledger-backed', () => { const f = fixture(); assert.equal(ownership.assertAutomationAllowed(f.root, f.target).current_owner, 'AUTOMATION'); const out = take(f); assert.equal(out.state.current_owner, 'HUMAN'); assert.equal(out.state.revision, 1); assert.equal(ledger.readLedger(f.root, 'run-1').records[0].action, 'TAKE_MANUAL_CONTROL'); assert.throws(() => ownership.assertAutomationAllowed(f.root, f.target), (e) => e.code === 'AUTOMATION_FENCED'); });
test('ownership history is immutable and return chains state and ledger', () => { const f = fixture(); take(f); const before = ownership.readOwnership(f.root, f.target); const out = ownership.transition(f.root, { ...f.target, action: 'RETURN_TO_AUTOMATION', next_owner: 'AUTOMATION', originating_invocation_id: 'story_editor:task-1:1', reason: 'Current bytes revalidated.', task_sha256: f.taskHash, artifact_sha256: null, expected_revision: before.revision, expected_state_hash: before.current_state_hash }, { actor: f.actor, recordId: 'operator-action-return-1', now: '2026-08-24T09:01:00.000Z' }); assert.equal(out.state.current_owner, 'AUTOMATION'); assert.equal(out.state.history.length, 2); assert.equal(out.state.history[1].previous_state_hash, out.state.history[0].state_hash); assert.equal(ledger.readLedger(f.root, 'run-1').records.length, 2); });
test('corruption and broken ledger references fail closed', () => { const f = fixture(); const out = take(f); const p = path.join(f.root, out.state_path); const doc = JSON.parse(fs.readFileSync(p)); doc.history[0].reason = 'tampered'; fs.writeFileSync(p, JSON.stringify(doc)); assert.throws(() => ownership.readOwnership(f.root, f.target), (e) => e.code === 'OWNERSHIP_CORRUPT'); });
test('target isolation and stale revisions are enforced', () => { const f = fixture(); const initial = ownership.readOwnership(f.root, f.target); take(f); assert.equal(ownership.assertAutomationAllowed(f.root, { ...f.target, task_id: 'task-2' }).current_owner, 'AUTOMATION'); assert.throws(() => ownership.transition(f.root, { ...f.target, action: 'RETURN_TO_AUTOMATION', next_owner: 'AUTOMATION', originating_invocation_id: 'story_editor:task-1:1', reason: 'Stale attempt.', task_sha256: f.taskHash, expected_revision: initial.revision, expected_state_hash: initial.current_state_hash }, { actor: f.actor }), (e) => e.code === 'OWNERSHIP_STALE'); });
test('ownership cannot contain approval authority or escape its path', () => { const f = fixture(); take(f); const bytes = fs.readFileSync(ownership.pathsFor(f.root, f.target).statePath, 'utf8'); assert.equal(/approval|approved|approver/i.test(bytes), false); assert.throws(() => ownership.readOwnership(f.root, { ...f.target, task_id: '../escape' }), (e) => e.code === 'OWNERSHIP_TARGET_INVALID'); });

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Execution Ownership tests passed`); })(); }
