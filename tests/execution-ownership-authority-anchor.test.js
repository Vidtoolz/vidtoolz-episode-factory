'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const anchor = require('../scripts/execution-ownership-authority-anchor.js');
const ownership = require('../scripts/execution-ownership.js');
const ledger = require('../scripts/operator-action-ledger.js');

let passed = 0;
function test(name, fn) { try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { console.error(`not ok - ${name}`); throw error; } }
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-anchor-')); fs.mkdirSync(path.join(root, 'package-runs', 'run-1'), { recursive: true }); return root; }
function take(root, taskId = 'task-1') {
  const target = { run_id: 'run-1', agent_id: 'visual_planning_director', task_id: taskId };
  const current = ownership.readOwnership(root, target);
  return ownership.transition(root, { ...target, action: 'TAKE_MANUAL_CONTROL', next_owner: 'HUMAN',
    originating_invocation_id: `visual_planning_director:${taskId}:1`, reason: 'Anchor exact ownership history.',
    task_sha256: crypto.createHash('sha256').update(taskId).digest('hex'), expected_revision: current.revision,
    expected_state_hash: current.current_state_hash }, { actor: ledger.localActorContext({ username: 'mikko' }), recordId: `operator-action-${taskId}` });
}

test('ownership transition appends an exact repository-level hash-chained anchor', () => {
  const root = fixture(), out = take(root), document = anchor.readAnchor(root), record = document.records[0];
  assert.equal(record.event, 'OWNERSHIP_TRANSITION');
  assert.equal(record.run_id, 'run-1'); assert.equal(record.agent_id, 'visual_planning_director'); assert.equal(record.task_id, 'task-1');
  assert.equal(record.current_owner, 'HUMAN'); assert.equal(record.ownership_state_hash, out.state.current_state_hash);
  assert.match(record.run_incarnation_id, /^run-incarnation-/);
  assert.equal(record.operator_ledger_head, ledger.readLedger(root, 'run-1').head_hash);
  assert.equal(record.anchor_hash, document.head_hash);
});

test('anchor body tamper and record deletion are detected', () => {
  const root = fixture(); take(root); const paths = anchor.pathsFor(root), document = JSON.parse(fs.readFileSync(paths.anchorPath));
  document.records[0].current_owner = 'AUTOMATION'; fs.writeFileSync(paths.anchorPath, JSON.stringify(document));
  assert.throws(() => anchor.readAnchor(root), (error) => error.code === 'OWNERSHIP_ANCHOR_CORRUPT');
  const root2 = fixture(); take(root2); const paths2 = anchor.pathsFor(root2), document2 = JSON.parse(fs.readFileSync(paths2.anchorPath));
  document2.records = []; fs.writeFileSync(paths2.anchorPath, JSON.stringify(document2));
  assert.throws(() => anchor.readAnchor(root2), (error) => error.code === 'OWNERSHIP_ANCHOR_CORRUPT');
});

test('run-local state and ledger relocation cannot restore virgin AUTOMATION', () => {
  const root = fixture(); take(root);
  const live = path.join(root, 'package-runs', 'run-1'), stale = path.join(root, 'package-runs', 'stale-runs', 'run-1');
  fs.mkdirSync(path.dirname(stale), { recursive: true }); fs.renameSync(live, stale); fs.mkdirSync(live, { recursive: true });
  assert.throws(() => ownership.assertAutomationAllowed(root, { run_id: 'run-1', agent_id: 'visual_planning_director', task_id: 'task-1' }),
    (error) => error.code === 'OWNERSHIP_RUN_INCARNATION_MISMATCH');
  assert.throws(() => ownership.readOwnership(root, { run_id: 'run-1', agent_id: 'visual_planning_director', task_id: 'unrelated-task' }),
    (error) => error.code === 'OWNERSHIP_RUN_INCARNATION_MISMATCH');
});

test('archived textual run ID is reserved across restart-style reload', () => {
  const root = fixture();
  anchor.reserveArchive(root, 'run-1', 'package-runs/stale-runs/run-1', { now: '2026-08-24T12:00:00.000Z' });
  assert.throws(() => ownership.readOwnership(root, { run_id: 'run-1', agent_id: 'visual_planning_director', task_id: 'new-task' }),
    (error) => error.code === 'OWNERSHIP_ARCHIVED_REQUIRES_RECONCILIATION');
});

if (require.main === module) console.log(`${passed}/${passed} Execution Ownership Authority Anchor tests passed`);
