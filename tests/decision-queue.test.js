'use strict';

// Human Decision Queue V2 — obligation semantics. Fixtures replicate the
// canonical runner evidence layout (agents/<agent>/<task>/{invocation,result}.json
// + attempts/ + index.json) inside isolated temp roots. No real package-run
// evidence is mutated, and no human approval is ever fabricated.

const { assert, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const decisionQueue = require('../scripts/decision-queue.js');

const REGISTRY = {
  schema_version: 1,
  agents: [
    { agent_id: 'production_operations', name: 'Production Operations', lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' }, implementation_state: 'IMPLEMENTATION_PROVEN' },
    { agent_id: 'story_editor', name: 'Story Editor', lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' }, implementation_state: 'IMPLEMENTATION_PROVEN' },
    { agent_id: 'presenter_director', name: 'Presenter', lifecycle: { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED' } },
  ],
};

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'decision-queue-test-')); }

function writeInvocation(root, runId, agentId, taskId, result, overrides = {}, opts = {}) {
  const taskDir = path.join(root, 'package-runs', runId, 'agents', agentId, taskId);
  const dir = opts.attempts ? path.join(taskDir, 'attempts', String(overrides.attempt || 2).padStart(4, '0')) : taskDir;
  fs.mkdirSync(dir, { recursive: true });
  const resultBytes = `${JSON.stringify(result, null, 2)}\n`;
  fs.writeFileSync(path.join(dir, 'result.json'), resultBytes);
  const invocation = {
    schema_version: 1, runner_version: 'agent-runner-v1', infrastructure_state: 'COMPLETE',
    agent_id: agentId, task_id: taskId, attempt_number: overrides.attempt || 1,
    predecessor_task_id: overrides.predecessor || null, predecessor_invocation: null,
    invocation_id: `${agentId}:${taskId}:${overrides.attempt || 1}`,
    semantic_state: overrides.attention === 'DECISION' ? 'AWAITING_HUMAN_DECISION' : overrides.attention === 'REVIEW' ? 'AWAITING_HUMAN_REVIEW' : 'COMPLETE',
    handoff_summary: {
      next_owner: overrides.attention === 'DECISION' ? 'mikko' : overrides.attention === 'REVIEW' ? 'hermes' : null,
      next_action: null, attention: overrides.attention || 'INFORMATION', human_gate: overrides.attention === 'DECISION',
      blocker: overrides.blocker || null, auto_executed: false,
    },
    task_sha256: sha256(`task:${runId}:${agentId}:${taskId}`), result_sha256: sha256(resultBytes),
    started_at: overrides.endedAt || '2026-08-24T10:00:00.000Z', ended_at: overrides.endedAt || '2026-08-24T10:00:01.000Z',
  };
  fs.writeFileSync(path.join(dir, 'invocation.json'), `${JSON.stringify(invocation, null, 2)}\n`);
  return dir;
}

function writeIndex(root, runId, records) {
  const agentsDir = path.join(root, 'package-runs', runId, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, 'index.json'), JSON.stringify({ schema_version: 1, invocations: records }, null, 2) + '\n');
}

function build(root, options = {}) { return decisionQueue.buildDecisionQueue(root, REGISTRY, options); }

test('DQ1: two unresolved decisions from the same agent are both visible', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq1';
    writeInvocation(root, runId, 'production_operations', 'task-decision-a',
      { state: 'AWAITING_HUMAN_DECISION', attention: 'DECISION' },
      { attention: 'DECISION', blocker: 'storage recovery needs human choice', endedAt: '2026-08-24T09:00:01.000Z' });
    writeInvocation(root, runId, 'production_operations', 'task-review-b',
      { state: 'REMEDIATION_RECOMMENDED', attention: 'REVIEW' },
      { attention: 'REVIEW', blocker: 'endpoint verification recommended', endedAt: '2026-08-24T09:05:01.000Z' });
    writeIndex(root, runId, [
      { agent_id: 'production_operations', task_id: 'task-decision-a' },
      { agent_id: 'production_operations', task_id: 'task-review-b' },
    ]);
    const queue = build(root);
    const poItems = queue.human_decision_queue.filter((item) => item.agent_id === 'production_operations');
    assert.equal(poItems.length, 2);
    assert.equal(queue.counts.active, 2);
    assert.ok(poItems.some((item) => item.attention === 'DECISION'));
    assert.ok(poItems.some((item) => item.attention === 'REVIEW'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ2: a later INFORMATION completion clears neither obligation', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq2';
    writeInvocation(root, runId, 'production_operations', 'task-decision-a',
      { state: 'AWAITING_HUMAN_DECISION', attention: 'DECISION' },
      { attention: 'DECISION', blocker: 'storage recovery', endedAt: '2026-08-24T09:00:01.000Z' });
    writeInvocation(root, runId, 'production_operations', 'task-status-c',
      { state: 'COMPLETE', attention: 'INFORMATION' },
      { attention: 'INFORMATION', endedAt: '2026-08-24T11:00:01.000Z' });
    writeIndex(root, runId, [
      { agent_id: 'production_operations', task_id: 'task-decision-a' },
      { agent_id: 'production_operations', task_id: 'task-status-c' },
    ]);
    const queue = build(root);
    assert.ok(queue.human_decision_queue.some((item) => item.task_id === 'task-decision-a'), 'DECISION must survive a newer INFORMATION completion');
    assert.ok(!queue.human_decision_queue.some((item) => item.task_id === 'task-status-c'), 'INFORMATION never becomes an obligation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ3: exact resolved blocker clears only the matching obligation via same-task recompletion', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq3';
    writeInvocation(root, runId, 'production_operations', 'task-a',
      { state: 'AWAITING_HUMAN_DECISION', attention: 'DECISION' },
      { attention: 'DECISION', blocker: 'blocked', endedAt: '2026-08-24T09:00:01.000Z', attempt: 1 });
    writeInvocation(root, runId, 'production_operations', 'task-a',
      { state: 'COMPLETE', attention: 'INFORMATION' },
      { attention: 'INFORMATION', endedAt: '2026-08-24T10:00:01.000Z', attempt: 2 }, { attempts: true });
    writeInvocation(root, runId, 'production_operations', 'task-b',
      { state: 'REMEDIATION_RECOMMENDED', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:30:01.000Z' });
    writeIndex(root, runId, [
      { agent_id: 'production_operations', task_id: 'task-a' },
      { agent_id: 'production_operations', task_id: 'task-b' },
    ]);
    const queue = build(root);
    assert.ok(!queue.human_decision_queue.some((item) => item.task_id === 'task-a' && item.attention === 'DECISION'), 'task-a DECISION must be superseded');
    assert.ok(queue.human_decision_queue.some((item) => item.task_id === 'task-b'), 'unrelated task-b must remain active');
    const superseded = queue.human_decision_history.find((entry) => entry.task_id === 'task-a');
    assert.equal(superseded.state, 'SUPERSEDED');
    assert.equal(superseded.resolution.resolving_task_id, 'task-a');
    assert.ok(superseded.invocation_id && superseded.resolution.resolving_invocation_id && superseded.resolution.resolved_at);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ4: successor task lineage supersedes the predecessor obligation only', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq4';
    writeInvocation(root, runId, 'story_editor', 'story-task-old',
      { state: 'BLOCKED', attention: 'REVIEW' },
      { attention: 'REVIEW', blocker: 'spine missing', endedAt: '2026-08-24T09:00:01.000Z' });
    writeInvocation(root, runId, 'story_editor', 'story-task-new',
      { state: 'COMPLETE', attention: 'INFORMATION' },
      { attention: 'INFORMATION', endedAt: '2026-08-24T10:00:01.000Z', predecessor: 'story-task-old' });
    writeInvocation(root, runId, 'story_editor', 'story-task-unrelated',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:30:01.000Z' });
    writeIndex(root, runId, [
      { agent_id: 'story_editor', task_id: 'story-task-old' },
      { agent_id: 'story_editor', task_id: 'story-task-new' },
      { agent_id: 'story_editor', task_id: 'story-task-unrelated' },
    ]);
    const queue = build(root);
    assert.ok(!queue.human_decision_queue.some((item) => item.task_id === 'story-task-old'));
    assert.ok(queue.human_decision_queue.some((item) => item.task_id === 'story-task-unrelated'));
    const resolved = queue.human_decision_history.find((entry) => entry.task_id === 'story-task-old');
    assert.match(resolved.resolution.reason, /successor task/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ5: approval evidence satisfies only the matching gate and scope', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq5';
    writeInvocation(root, runId, 'story_editor', 'story-task-gate',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:00:01.000Z' });
    writeIndex(root, runId, [{ agent_id: 'story_editor', task_id: 'story-task-gate' }]);
    const matchingProvider = (obligation) => obligation.approval_scope_required === 'PLAN_SCRIPT_APPROVAL'
      ? { verdict: 'VALID', scope: 'PLAN_SCRIPT_APPROVAL', artifact_sha256: 'a'.repeat(64), approved_at: '2026-08-24T12:00:00.000Z' } : null;
    const queue = build(root, { approvalEvidenceProviders: [matchingProvider] });
    const resolved = queue.human_decision_history.find((entry) => entry.task_id === 'story-task-gate');
    assert.equal(resolved.state, 'RESOLVED');
    assert.equal(resolved.resolution.resolved_by, 'APPROVAL_VALID');
    const queue2 = build(root, { approvalEvidenceProviders: [(obligation) => obligation.approval_scope_required === 'FINAL_CUT_APPROVAL' ? { verdict: 'VALID', scope: 'FINAL_CUT_APPROVAL' } : null] });
    assert.ok(queue2.human_decision_queue.some((item) => item.task_id === 'story-task-gate'), 'unrelated approval scope must not clear the obligation');
    const queue3 = build(root, { approvalEvidenceProviders: [() => ({ verdict: 'STALE', scope: 'PLAN_SCRIPT_APPROVAL' })] });
    assert.ok(queue3.human_decision_queue.some((item) => item.task_id === 'story-task-gate'), 'STALE approval must not clear the obligation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ6: DECISION and REVIEW obligations coexist and never collapse', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq6';
    writeInvocation(root, runId, 'production_operations', 'task-decision',
      { state: 'AWAITING_HUMAN_DECISION', attention: 'DECISION' },
      { attention: 'DECISION', endedAt: '2026-08-24T09:00:01.000Z' });
    writeInvocation(root, runId, 'story_editor', 'task-review',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:10:01.000Z' });
    writeIndex(root, runId, [
      { agent_id: 'production_operations', task_id: 'task-decision' },
      { agent_id: 'story_editor', task_id: 'task-review' },
    ]);
    const queue = build(root);
    assert.equal(queue.counts.active, 2);
    assert.deepEqual(queue.human_decision_queue.map((item) => item.attention).sort(), ['DECISION', 'REVIEW']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ7: resolved items leave the active queue but remain in audited history', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq7';
    writeInvocation(root, runId, 'story_editor', 'task-approved',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:00:01.000Z' });
    writeIndex(root, runId, [{ agent_id: 'story_editor', task_id: 'task-approved' }]);
    const queue = build(root, { approvalEvidenceProviders: [(obligation) => obligation.approval_scope_required === 'PLAN_SCRIPT_APPROVAL' ? { verdict: 'VALID', scope: 'PLAN_SCRIPT_APPROVAL', approved_at: '2026-08-24T12:00:00.000Z' } : null] });
    assert.equal(queue.human_decision_queue.length, 0);
    assert.equal(queue.human_decision_history.length, 1);
    const entry = queue.human_decision_history[0];
    assert.equal(entry.queue_item_id.split(':')[0], 'REVIEW');
    assert.ok(entry.resolution.resolved_at);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ8: a disabled role cannot fabricate a live queue obligation or resolution', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq8';
    writeInvocation(root, runId, 'presenter_director', 'take-1',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:00:01.000Z' });
    writeIndex(root, runId, [{ agent_id: 'presenter_director', task_id: 'take-1' }]);
    const queue = build(root);
    assert.equal(queue.counts.active, 0, 'disabled-role evidence must not become a live obligation');
    writeInvocation(root, runId, 'story_editor', 'task-guarded',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:00:01.000Z' });
    writeIndex(root, runId, [
      { agent_id: 'presenter_director', task_id: 'take-1' },
      { agent_id: 'story_editor', task_id: 'task-guarded' },
    ]);
    const guarded = build(root, { resolutionEvidenceProviders: [(obligation) => obligation.agent_id === 'presenter_director' ? { resolved_by: 'FORGED', resolving_invocation_id: 'x' } : null] });
    assert.ok(guarded.human_decision_queue.some((item) => item.task_id === 'task-guarded'));
    const disabledEntry = guarded.human_decision_history.find((entry) => entry.task_id === 'take-1');
    assert.equal(disabledEntry.state, 'INVALID');
    assert.equal(disabledEntry.resolution.resolved_by, 'DISPATCH_NOT_ENABLED');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ9: a Hermes receipt alone cannot satisfy human approval', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq9';
    writeInvocation(root, runId, 'story_editor', 'task-receipt-only',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:00:01.000Z' });
    writeIndex(root, runId, [{ agent_id: 'story_editor', task_id: 'task-receipt-only' }]);
    fs.mkdirSync(path.join(root, 'package-runs', runId, 'orchestration'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package-runs', runId, 'orchestration', 'hermes-receipts.json'), JSON.stringify({
      schema_version: 1, kind: 'hermes_orchestration_receipts', run_id: runId, head_hash: null,
      receipts: [{ receipt_id: 'r1', hermes_action: 'RESUME_ORCHESTRATION', source_agent_id: 'story_editor', source_invocation_id: 'story_editor:task-receipt-only:1', source_task_id: 'task-receipt-only', timestamp: '2026-08-24T09:30:00.000Z' }],
    }, null, 2) + '\n');
    const queue = build(root);
    assert.ok(queue.human_decision_queue.some((item) => item.task_id === 'task-receipt-only'), 'receipt without a resolving completion must not clear the obligation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ10: resume-loop lineage — receipt-bound rerun supersedes the original blocker decision', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq10';
    writeInvocation(root, runId, 'story_editor', 'task-blocked',
      { state: 'ESCALATED', attention: 'DECISION' },
      { attention: 'DECISION', blocker: 'MODEL_FAILED: fetch failed', endedAt: '2026-08-24T09:00:01.000Z', attempt: 1 });
    writeIndex(root, runId, [{ agent_id: 'story_editor', task_id: 'task-blocked' }]);
    fs.mkdirSync(path.join(root, 'package-runs', runId, 'orchestration'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package-runs', runId, 'orchestration', 'hermes-receipts.json'), JSON.stringify({
      schema_version: 1, kind: 'hermes_orchestration_receipts', run_id: runId, head_hash: null,
      receipts: [{ receipt_id: 'resume-1', hermes_action: 'RESUME_ORCHESTRATION', source_agent_id: 'story_editor', source_invocation_id: 'story_editor:task-blocked:1', source_task_id: 'task-blocked', timestamp: '2026-08-24T09:30:00.000Z' }],
    }, null, 2) + '\n');
    writeInvocation(root, runId, 'story_editor', 'task-blocked-rerun-1',
      { state: 'COMPLETE', attention: 'INFORMATION' },
      { attention: 'INFORMATION', endedAt: '2026-08-24T10:00:01.000Z' });
    const queue = build(root);
    assert.ok(!queue.human_decision_queue.some((item) => item.task_id === 'task-blocked'), 'blocker DECISION must be superseded by the receipt-bound rerun');
    const superseded = queue.human_decision_history.find((entry) => entry.task_id === 'task-blocked');
    assert.equal(superseded.resolution.resolved_by, 'HERMES_RESUME_LOOP');
    assert.equal(superseded.resolution.hermes_receipt_id, 'resume-1');
    const root2 = tempRoot();
    try {
      writeInvocation(root2, runId, 'story_editor', 'task-blocked',
        { state: 'ESCALATED', attention: 'DECISION' },
        { attention: 'DECISION', blocker: 'MODEL_FAILED', endedAt: '2026-08-24T09:00:01.000Z' });
      writeIndex(root2, runId, [{ agent_id: 'story_editor', task_id: 'task-blocked' }]);
      fs.mkdirSync(path.join(root2, 'package-runs', runId, 'orchestration'), { recursive: true });
      fs.writeFileSync(path.join(root2, 'package-runs', runId, 'orchestration', 'hermes-receipts.json'), JSON.stringify({
        schema_version: 1, kind: 'hermes_orchestration_receipts', run_id: runId, head_hash: null,
        receipts: [{ receipt_id: 'resume-2', hermes_action: 'RESUME_ORCHESTRATION', source_agent_id: 'story_editor', source_invocation_id: 'story_editor:task-blocked:1', source_task_id: 'task-blocked', timestamp: '2026-08-24T11:00:00.000Z' }],
      }, null, 2) + '\n');
      writeInvocation(root2, runId, 'story_editor', 'task-early-rerun',
        { state: 'COMPLETE', attention: 'INFORMATION' },
        { attention: 'INFORMATION', endedAt: '2026-08-24T09:10:00.000Z' });
      const queue2 = build(root2);
      assert.ok(queue2.human_decision_queue.some((item) => item.task_id === 'task-blocked'), 'pre-receipt completion must not clear the obligation');
    } finally { fs.rmSync(root2, { recursive: true, force: true }); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ11: tampered result evidence marks the obligation INVALID, never silently active', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq11';
    const dir = writeInvocation(root, runId, 'story_editor', 'task-tampered',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:00:01.000Z' });
    writeIndex(root, runId, [{ agent_id: 'story_editor', task_id: 'task-tampered' }]);
    fs.writeFileSync(path.join(dir, 'result.json'), '{"state":"FORGED","attention":"REVIEW"}\n');
    const queue = build(root);
    const entry = queue.human_decision_history.find((item) => item.task_id === 'task-tampered');
    assert.equal(entry.state, 'INVALID');
    assert.equal(queue.counts.active, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ12: inactive runs mark obligations STALE with preserved identity', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq12';
    writeInvocation(root, runId, 'story_editor', 'task-stale',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:00:01.000Z' });
    writeIndex(root, runId, [{ agent_id: 'story_editor', task_id: 'task-stale' }]);
    fs.writeFileSync(path.join(root, 'package-runs', runId, 'package-run-state.md'), 'state: archived\n');
    const queue = build(root);
    const entry = queue.human_decision_history.find((item) => item.task_id === 'task-stale');
    assert.equal(entry.state, 'STALE');
    assert.ok(entry.invocation_id, 'stale obligations preserve identity in history');
    assert.equal(queue.counts.active, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DQ13: obligation identity binds run+agent+invocation+task+gate deterministically', () => {
  const root = tempRoot();
  try {
    const runId = 'run-dq13';
    writeInvocation(root, runId, 'story_editor', 'task-id',
      { state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' },
      { attention: 'REVIEW', endedAt: '2026-08-24T09:00:01.000Z' });
    writeIndex(root, runId, [{ agent_id: 'story_editor', task_id: 'task-id' }]);
    const queue = build(root);
    const item = queue.human_decision_queue[0];
    assert.equal(item.queue_item_id, `REVIEW:${runId}:story_editor:story_editor:task-id:1`);
    assert.equal(item.owning_gate, 'PLAN_SCRIPT_APPROVAL');
    assert.equal(item.approval_scope_required, 'PLAN_SCRIPT_APPROVAL');
    assert.ok(item.task_sha256 && item.result_sha256, 'obligation binds result/task hashes');
    assert.ok(item.workspace.startsWith('/'), 'workspace link carries exact context');
    assert.match(item.workspace, /run=run-dq13/);
    assert.match(item.workspace, /task=task-id/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
