'use strict';

// Visual Planning Workspace V1 — UI/orchestration contracts.
// 1. Every Visual Planning obligation carries a deep link with the exact
//    invocation context (no "latest Visual Planning" fallback).
// 2. The workspace backend fails closed on incomplete context.
// 3. Takeover/return control surfaces never claim approval authority.

const { assert, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const decisionQueue = require('../scripts/decision-queue.js');
const workspace = require('../scripts/visual-planning-workspace.js');

// Registry fixture: Visual Planning dispatch-enabled so its obligation is
// live; Presenter disabled to prove the scanner never fabricates queue items
// for dispatch-fenced roles.
const REGISTRY = {
  schema_version: 1,
  agents: [
    { agent_id: 'visual_planning_director', name: 'Visual Planning Director', human_gate_type: 'VISUAL_PLAN_APPROVAL', lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' }, implementation_state: 'IMPLEMENTATION_PROVEN' },
    { agent_id: 'presenter_director', name: 'Presenter', lifecycle: { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED' } },
  ],
};

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vpw-ui-test-')); }

function writeInvocation(root, runId, agentId, taskId, attention) {
  const taskDir = path.join(root, 'package-runs', runId, 'agents', agentId, taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  const result = {
    state: attention, attention, reason: 'visual plan needs Mikko review',
    rationale: 'rationale', evidence_refs: [{ artifact_id: 'visual_plan', sha256: sha256('x') }],
    source: 'AGENT', next_owner: attention === 'DECISION' ? 'mikko' : 'hermes', resume_condition: null,
  };
  const resultBytes = `${JSON.stringify(result, null, 2)}\n`;
  fs.writeFileSync(path.join(taskDir, 'result.json'), resultBytes);
  const invocation = {
    schema_version: 1, runner_version: 'agent-runner-v1', infrastructure_state: 'COMPLETE',
    agent_id: agentId, task_id: taskId, attempt_number: 1,
    predecessor_task_id: null, predecessor_invocation: null,
    invocation_id: `${agentId}:${taskId}:1`,
    semantic_state: attention === 'DECISION' ? 'AWAITING_HUMAN_DECISION' : 'AWAITING_HUMAN_REVIEW',
    handoff_summary: { next_owner: attention === 'DECISION' ? 'mikko' : 'hermes', next_action: null, attention, human_gate: attention === 'DECISION', blocker: null, auto_executed: false },
    task_sha256: sha256(`task:${runId}:${agentId}:${taskId}`), result_sha256: sha256(resultBytes),
    started_at: '2026-08-24T10:00:00.000Z', ended_at: '2026-08-24T10:00:01.000Z',
  };
  fs.writeFileSync(path.join(taskDir, 'invocation.json'), `${JSON.stringify(invocation, null, 2)}\n`);
  const agentsDir = path.join(root, 'package-runs', runId, 'agents');
  const indexPath = path.join(agentsDir, 'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { schema_version: 1, invocations: [] };
  index.invocations.push({ agent_id: agentId, task_id: taskId, invocation_id: invocation.invocation_id });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
}

test('WS1: Visual Planning obligation deep link carries exact run/agent/task/invocation', () => {
  const root = tempRoot();
  writeInvocation(root, '2026-08-24-vpw-ui', 'visual_planning_director', 'vp-task-1', 'REVIEW');
  const queue = decisionQueue.buildDecisionQueue(root, REGISTRY);
  assert.equal(queue.human_decision_queue.length, 1, 'one live VPD obligation');
  const link = queue.human_decision_queue[0].workspace;
  assert.match(link, /^\/visual-planning-workspace\.html\?/);
  assert.ok(link.includes('run=2026-08-24-vpw-ui'), 'deep link must carry the exact run');
  assert.ok(link.includes('agent=visual_planning_director'), 'deep link must carry the exact agent');
  assert.ok(link.includes('task=vp-task-1'), 'deep link must carry the exact task');
  assert.ok(link.includes('invocation=' + encodeURIComponent('visual_planning_director:vp-task-1:1')), 'deep link must carry the exact invocation');
});

test('WS2: workspace backend fails closed on missing or partial context', async () => {
  const cases = [
    {},
    { run_id: 'visual-planning-stage1-20260823' },
    { run_id: 'visual-planning-stage1-20260823', agent_id: 'visual_planning_director' },
    { run_id: 'visual-planning-stage1-20260823', agent_id: 'visual_planning_director', task_id: 'visual-plan-01M0QR9DGRPW4MK8BMD1RGAYDX-resume-rerun-1' },
  ];
  for (const request of cases) {
    let caught = null;
    try { await workspace.buildVisualPlanningWorkspace(request); } catch (error) { caught = error; }
    assert.ok(caught, 'incomplete context must be refused');
    // Agent check fires first for requests missing the agent field; every
    // failure path must remain a bounded WORKSPACE_* refusal either way.
    assert.match(String(caught.code), /^WORKSPACE_/);
  }
});

test('WS3: workspace backend rejects non-Visual-Planning agent context', async () => {
  let caught = null;
  try { await workspace.buildVisualPlanningWorkspace({ run_id: 'x', agent_id: 'story_editor', task_id: 't', invocation_id: 'i' }); } catch (error) { caught = error; }
  assert.ok(caught, 'non-VPD context must be refused');
  assert.match(String(caught.code), /^WORKSPACE/);
});

test('WS4: workspace page exposes no generic approve/fix/run authority controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'visual-planning-workspace.html'), 'utf8');
  assert.ok(html.includes('/api/visual-planning-workspace'));
  for (const control of ['takeover_preview', 'takeover_apply', 'return_preview', 'return_apply']) {
    assert.ok(html.includes(control), `workspace must wire ${control}`);
  }
  // No approval-authority surface: approval stays on canonical gates.
  assert.ok(!/button[^>]*>\s*(Approve|Fix everything|Run everything|Greenlight)/i.test(html));
  assert.ok(html.includes('this workspace never approves'));
});

test('WS5: workspace page routes all rendered strings through esc()', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'visual-planning-workspace.html'), 'utf8');
  assert.ok(/function esc\(/.test(html), 'esc() must exist');
  // No raw template interpolation of workspace fields into HTML.
  assert.ok(!/\$\{[a-z_.]+\}/i.test(html), 'no unescaped template interpolation in workspace page');
});
