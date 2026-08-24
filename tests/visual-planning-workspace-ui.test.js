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
const controls = require('../scripts/agent-controls.js');
const ownership = require('../scripts/execution-ownership.js');
const ledger = require('../scripts/operator-action-ledger.js');
const manualEdit = require('../scripts/visual-planning-manual-edit.js');
const workspaceFixture = require('./fixtures/visual-planning-workspace-v1.js');
const { bootWorkspacePage } = require('./fixtures/visual-planning-workspace-browser.js');

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

async function canonicalWorkspaceFixture() {
  const root = tempRoot();
  const fixture = workspaceFixture.materialize(root);
  const payload = await workspace.buildVisualPlanningWorkspace(fixture.request, { root });
  return { root, fixture, payload };
}

test('WS6: actual DOM maps the frozen V1 contract without object coercion or legacy fields', async () => {
  const { payload } = await canonicalWorkspaceFixture();
  payload.human_attention[0].hermes_orchestration = {
    state: 'AWAITING_HERMES', blocker: 'Await Visual Plan review', resume_condition: 'Scoped approval is recorded',
    route_target: 'visual_planning_director', recommended_action: 'resume_after_approval', waiting_for: 'Mikko',
    route_authorization: 'AUTHORIZED_AFTER_GATE', auto_executed: false,
  };
  payload.visual_plan.shots[0].research_linkage = {
    sensitive: true,
    refs: [{ reference_id: 'research-result-fixture-1', state: 'BOUND' }],
  };
  const page = await bootWorkspacePage(payload);
  assert.equal(page.node('errorBanner').innerHTML, '');
  assert.equal(page.node('workspace').hidden, false);
  assert.match(page.node('planPanel').innerHTML, /2\/2 beats covered/);
  assert.match(page.node('planPanel').innerHTML, /2 shots/);
  assert.match(page.node('planPanel').innerHTML, /COMPLETE/);
  assert.match(page.node('planPanel').innerHTML, /visual-beat-01HF7YAT010000000000000001.*shot-01HF7YAT030000000000000003/);
  assert.match(page.node('attentionPanel').innerHTML, /REVIEW — Visual Plan Approval/);
  assert.match(page.node('attentionPanel').innerHTML, /Review complete beat coverage and the exact planned shots/);
  assert.match(page.node('attentionPanel').innerHTML, /Rationale source<\/dt><dd>AGENT/);
  assert.match(page.node('attentionPanel').innerHTML, /AWAITING_HERMES/);
  assert.match(page.node('attentionPanel').innerHTML, /resume_after_approval/);
  assert.match(page.node('attentionPanel').innerHTML, /VISUAL_PLAN_APPROVAL/);
  assert.match(page.node('shotsPanel').innerHTML, /Project: workspace-fixture-project/);
  assert.match(page.node('shotsPanel').innerHTML, /Story: script-version-01JWORKSPACE000000000000/);
  assert.match(page.node('shotsPanel').innerHTML, /Research linkage<\/dt><dd>.*SENSITIVE.*research-result-fixture-1: BOUND/);
  assert.doesNotMatch(page.node('attentionPanel').innerHTML + page.node('shotsPanel').innerHTML, /\[object Object\]/);
  assert.match(page.node('resourcePanel').innerHTML, /UNKNOWN/);
  assert.match(page.node('ownershipPanel').innerHTML, /AUTOMATION/);
  const workspaceRequest = page.requests.find((request) => request.url.startsWith('/api/visual-planning-workspace'));
  assert.match(workspaceRequest.url, /workspace_schema_id=visual-planning-workspace%2Fv1/);
  assert.match(workspaceRequest.url, /workspace_schema_version=1/);
});

test('WS7: coverage DOM distinguishes complete, incomplete, zero-shot, and malformed payloads', async () => {
  const { payload } = await canonicalWorkspaceFixture();
  const incomplete = structuredClone(payload);
  incomplete.visual_plan.coverage.covered_beats = incomplete.visual_plan.coverage.covered_beats.slice(0, 1);
  incomplete.visual_plan.coverage.uncovered_beats = [{ beat_id: incomplete.visual_plan.coverage.required_beats[1].beat_id, section_id: 'sec-proof' }];
  incomplete.visual_plan.coverage.complete = false;
  incomplete.visual_plan.shots = incomplete.visual_plan.shots.slice(0, 1);
  const incompletePage = await bootWorkspacePage(incomplete);
  assert.match(incompletePage.node('planPanel').innerHTML, /1\/2 beats covered/);
  assert.match(incompletePage.node('planPanel').innerHTML, /INCOMPLETE/);
  assert.match(incompletePage.node('planPanel').innerHTML, /visual-beat-01HF7YAT020000000000000002/);

  const zero = structuredClone(payload);
  zero.visual_plan.coverage.covered_beats = [];
  zero.visual_plan.coverage.uncovered_beats = zero.visual_plan.coverage.required_beats.map((beat) => ({ beat_id: beat.beat_id, section_id: beat.section_id }));
  zero.visual_plan.coverage.complete = false;
  zero.visual_plan.shots = [];
  const zeroPage = await bootWorkspacePage(zero);
  assert.match(zeroPage.node('planPanel').innerHTML, /0\/2 beats covered · 0 shots/);
  assert.match(zeroPage.node('shotsPanel').innerHTML, /No shots/);

  const malformed = structuredClone(payload);
  delete malformed.visual_plan.coverage.covered_beats;
  const malformedPage = await bootWorkspacePage(malformed);
  assert.equal(malformedPage.node('workspace').hidden, true);
  assert.match(malformedPage.node('errorBanner').innerHTML, /Visual Plan coverage is unavailable/);
  assert.doesNotMatch(malformedPage.node('errorBanner').innerHTML, /0\/2|COMPLETE/);
});

test('WS8: browser rejects schema drift visibly and leaves mutation controls unavailable', async () => {
  const { payload } = await canonicalWorkspaceFixture();
  for (const mutation of [
    (value) => { value.workspace_schema_id = 'visual-planning-workspace/v2'; },
    (value) => { value.workspace_schema_version = 2; },
  ]) {
    const invalid = structuredClone(payload);
    mutation(invalid);
    const page = await bootWorkspacePage(invalid);
    assert.equal(page.node('workspace').hidden, true);
    assert.match(page.node('errorBanner').innerHTML, /WORKSPACE_CONTRACT_MISMATCH/);
    assert.match(page.node('errorBanner').innerHTML, /Return to the queue/);
    assert.equal(page.node('btnTakeApply'), null);
    assert.equal(page.node('btnReturnApply'), null);
  }
});

test('WS9: actual return UI serializer round-trips preview_created_at to canonical apply', async () => {
  const { root, fixture } = await canonicalWorkspaceFixture();
  const actor = ledger.localActorContext({ username: 'mikko' });
  const target = { ...fixture.request, reason: 'Take exact workspace task for serializer proof.' };
  const takePreview = controls.previewTakeManualControl(target, { root });
  controls.applyTakeManualControl({ ...target, preview_token: takePreview.preview_token }, { root, actor, recordId: 'workspace-ui-take' });
  const workspaceOptions = { root };
  const currentPayload = () => workspace.buildVisualPlanningWorkspace(fixture.request, workspaceOptions);
  let returnPreview;
  const page = await bootWorkspacePage(currentPayload, { controls: {
    '/api/agent-control-room/return-to-automation/preview': async (body) => {
      returnPreview = await controls.previewReturnToAutomation(body, { root, now: '2026-08-24T14:00:00.000Z' });
      return returnPreview;
    },
    '/api/agent-control-room/return-to-automation/apply': (body) => controls.applyReturnToAutomation(body, { root, actor, recordId: 'workspace-ui-return', now: '2026-08-24T14:01:00.000Z' }),
  } });
  assert.match(page.node('ownershipPanel').innerHTML, /Manual artifact/);
  assert.match(page.node('ownershipPanel').innerHTML, /ACTIVE FOR THIS EXACT TASK/);
  assert.match(page.node('ownershipPanel').innerHTML, /maintained by the system/);
  page.node('opReason').value = 'Return exact workspace task through browser serializer.';
  await page.click('btnReturnPreview');
  assert.equal(page.node('btnReturnApply').disabled, false);
  const exactClientBody = page.api.serializeApplyBody('return', fixture.request, page.node('opReason').value, returnPreview);
  const missingTimestampBody = { ...exactClientBody };
  delete missingTimestampBody.preview_created_at;
  await assert.rejects(
    () => controls.applyReturnToAutomation(missingTimestampBody, { root, actor }),
    (error) => error.code === 'AGENT_CONTROL_PREVIEW_STALE',
  );
  await page.click('btnReturnApply');
  const applyRequest = page.requests.find((request) => request.url === '/api/agent-control-room/return-to-automation/apply');
  assert.equal(applyRequest.body.preview_token, returnPreview.preview_token);
  assert.equal(applyRequest.body.preview_created_at, returnPreview.preview_created_at);
  assert.equal(applyRequest.body.run_id, fixture.request.run_id);
  assert.equal(applyRequest.body.agent_id, fixture.request.agent_id);
  assert.equal(applyRequest.body.task_id, fixture.request.task_id);
  assert.equal(applyRequest.body.invocation_id, fixture.request.invocation_id);
  assert.equal(ownership.readOwnership(root, fixture.request).current_owner, 'AUTOMATION');
});

test('WS10: actual DOM performs bounded creative preview/apply without client authority metadata', async () => {
  const { root, fixture } = await canonicalWorkspaceFixture();
  const actor = ledger.localActorContext({ username: 'mikko' });
  const take = controls.previewTakeManualControl({ ...fixture.request, reason: 'Open bounded editor.' }, { root });
  controls.applyTakeManualControl({ ...fixture.request, reason: 'Open bounded editor.', preview_token: take.preview_token }, {
    root, actor, recordId: 'workspace-ui-edit-take', now: '2026-08-24T15:30:00.000Z',
  });
  let editPreview;
  let editApplied;
  const currentPayload = () => workspace.buildVisualPlanningWorkspace(fixture.request, { root });
  const page = await bootWorkspacePage(currentPayload, { controls: {
    '/api/visual-planning-workspace/manual-edit/preview': async (body) => {
      editPreview = await manualEdit.previewVisualPlanManualEdit(body, {
        root, successorValidation: { currentStory: fixture.plan.story }, now: '2026-08-24T15:31:00.000Z',
        newShotId: () => 'shot-01HF7YAT060000000000000006',
      });
      return editPreview;
    },
    '/api/visual-planning-workspace/manual-edit/apply': async (body) => {
      editApplied = await manualEdit.applyVisualPlanManualEdit(body, {
        root, actor, recordId: 'workspace-ui-bounded-edit', successorValidation: { currentStory: fixture.plan.story },
        now: '2026-08-24T15:31:00.000Z', applyNow: '2026-08-24T15:32:00.000Z',
        newShotId: () => 'shot-01HF7YAT060000000000000006',
      });
      return editApplied;
    },
  } });
  assert.match(page.node('editPanel').innerHTML, /Shot brief/);
  assert.match(page.node('editPanel').innerHTML, /System managed: shot identity/);
  page.node('opReason').value = 'Clarify the opening workstation shot.';
  page.node('editShotBrief0').value = 'A calm editorial view of the editor reviewing a completed render.';
  await page.click('btnEditPreview');
  assert.equal(editPreview.eligible, true);
  assert.equal(page.node('btnEditApply').disabled, false);
  const previewRequest = page.requests.find((request) => request.url === '/api/visual-planning-workspace/manual-edit/preview');
  assert.deepEqual(Object.keys(previewRequest.body.creative_patch.shot_edits[0].set), ['shot_brief']);
  for (const forbidden of ['plan_id', 'plan_revision', 'supersedes', 'plan_digest_sha256', 'shot_id', 'artifact_sha256', 'approved_by']) {
    assert.equal(JSON.stringify(previewRequest.body.creative_patch).includes(`\"${forbidden}\"`), false, forbidden);
  }
  await page.click('btnEditApply');
  const applyRequest = page.requests.find((request) => request.url === '/api/visual-planning-workspace/manual-edit/apply');
  assert.equal(applyRequest.body.preview_token, editPreview.preview_token);
  assert.equal(applyRequest.body.preview_created_at, editPreview.preview_created_at);
  assert.equal(editApplied.execution_owner, 'HUMAN');
  assert.equal(editApplied.plan_revision, 2);
  assert.match(page.node('planPanel').innerHTML, /Revision<\/dt><dd>2/);
  assert.match(page.node('planPanel').innerHTML, /MANUAL_ARTIFACT_CHANGED/);
  assert.match(page.node('shotsPanel').innerHTML, /calm editorial view/);
  assert.equal(ownership.readOwnership(root, fixture.request).current_owner, 'HUMAN');
});

test('WS11: historical obligation state is explicit and mutation controls are disabled', async () => {
  const { payload } = await canonicalWorkspaceFixture();
  payload.queue_binding = { status: 'HISTORICAL', queue_available: true, obligation_id: 'historical-obligation-1', obligation_state: 'RESOLVED', diagnostic_codes: [] };
  payload.human_attention = [];
  const page = await bootWorkspacePage(payload);
  assert.match(page.node('attentionPanel').innerHTML, /RESOLVED/);
  assert.match(page.node('attentionPanel').innerHTML, /historical-obligation-1/);
  assert.equal(page.node('btnTakePreview').disabled, true);
  assert.match(page.node('editPanel').innerHTML, /historical obligations are read-only/);
});
