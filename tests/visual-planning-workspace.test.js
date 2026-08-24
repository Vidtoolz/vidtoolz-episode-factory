'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { assert, fs, os, path, test, packageEngineServer } = require('./_helpers.js');
const workspace = require('../scripts/visual-planning-workspace.js');
const controls = require('../scripts/agent-controls.js');

const SOURCE_RUN = 'visual-planning-stage1-20260823';
const TASK_ID = 'visual-plan-01M0QR9DGRPW4MK8BMD1RGAYDX-resume-rerun-1';
const INVOCATION_ID = `visual_planning_director:${TASK_ID}:1`;
const AGENT_ID = 'visual_planning_director';
const REPO_ROOT = path.resolve(__dirname, '..');

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-planning-workspace-'));
  copyFile(path.join(REPO_ROOT, 'config', 'agent-registry.json'), path.join(root, 'config', 'agent-registry.json'));
  copyFile(path.join(REPO_ROOT, 'scripts', 'visual-planning-director.js'), path.join(root, 'scripts', 'visual-planning-director.js'));
  const sourceRun = path.join(REPO_ROOT, 'package-runs', SOURCE_RUN);
  const targetRun = path.join(root, 'package-runs', SOURCE_RUN);
  // Copy only immutable runner evidence. The live historical run may be under
  // active HUMAN ownership; importing its run-local state without the
  // repository authority anchor would correctly fail closed and would make
  // this identity/path fixture depend on concurrent operator activity.
  copyFile(path.join(sourceRun, 'agents', 'index.json'), path.join(targetRun, 'agents', 'index.json'));
  fs.cpSync(path.join(sourceRun, 'agents', AGENT_ID, TASK_ID), path.join(targetRun, 'agents', AGENT_ID, TASK_ID), { recursive: true });
  if (fs.existsSync(path.join(sourceRun, 'orchestration'))) fs.cpSync(path.join(sourceRun, 'orchestration'), path.join(targetRun, 'orchestration'), { recursive: true });
  return { root, request: { run_id: SOURCE_RUN, agent_id: AGENT_ID, task_id: TASK_ID, invocation_id: INVOCATION_ID } };
}

function expectCode(fn, code) {
  return Promise.resolve().then(fn).then(
    () => assert.fail(`expected ${code}`),
    (error) => assert.equal(error.code, code),
  );
}

function artifactPath(f) {
  return path.join(f.root, 'package-runs', SOURCE_RUN, 'agents', AGENT_ID, TASK_ID, 'artifacts', 'visual-plan.json');
}

function treeDigest(root) {
  const rows = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) rows.push(`${path.relative(root, file)}:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`);
      else rows.push(`${path.relative(root, file)}:${entry.isSymbolicLink() ? `link:${fs.readlinkSync(file)}` : 'special'}`);
    }
  }
  walk(root);
  return crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
}

function requestJson(server, pathname) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: pathname, method: 'GET', headers: { Host: '127.0.0.1:8010' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('Visual Planning workspace resolves exact historical canonical runner evidence', async () => {
  const f = fixture();
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  assert.equal(out.read_only, true);
  assert.equal(out.context.run_id, SOURCE_RUN);
  assert.equal(out.context.task_id, TASK_ID);
  assert.equal(out.context.invocation_id, INVOCATION_ID);
  assert.equal(out.context.runtime_state, 'COMPLETED');
  assert.equal(out.visual_plan.artifact_id, 'visual_plan');
  assert.equal(out.visual_plan.plan_revision, 1);
  assert.equal(out.visual_plan.coverage.required_beats.length, 11);
  assert.equal(out.visual_plan.coverage.uncovered_beats.length, 0);
  assert.equal(out.visual_plan.shots.length, 11);
  assert.equal(out.ownership.current_owner, 'AUTOMATION');
  assert.equal(out.resource_tool.health, 'UNKNOWN');
  assert.equal(out.resource_tool.telemetry_source, 'INVOCATION_EVIDENCE_ONLY');
});

test('workspace consumes the committed canonical Decision Queue V2 projection', async () => {
  const f = fixture();
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root });
  assert.deepEqual(out.human_attention, []);
  assert.ok(Array.isArray(out.decision_queue_diagnostics));
});

test('workspace refuses wrong agent, task, invocation, traversal, and artifact substitution', async () => {
  const f = fixture();
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, agent_id: 'story_editor' }, { root: f.root }), 'WORKSPACE_AGENT_UNSUPPORTED');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, agent_id: 'presenter_director' }, { root: f.root }), 'WORKSPACE_AGENT_UNSUPPORTED');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, task_id: 'wrong-task' }, { root: f.root }), 'WORKSPACE_TASK_IDENTITY_MISMATCH');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, invocation_id: `${AGENT_ID}:wrong-task:1` }, { root: f.root }), 'AGENT_CONTROL_INVOCATION_NOT_FOUND');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, run_id: '../package-runs' }, { root: f.root }), 'AGENT_CONTROL_TARGET_INVALID');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, artifact_id: 'edit_plan' }, { root: f.root }), 'WORKSPACE_ARTIFACT_ID_MISMATCH');
});

test('workspace detects artifact hash drift and client hash mismatch', async () => {
  const f = fixture();
  const original = fs.readFileSync(artifactPath(f));
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, artifact_sha256: '0'.repeat(64) }, { root: f.root }), 'WORKSPACE_ARTIFACT_HASH_MISMATCH');
  fs.writeFileSync(artifactPath(f), Buffer.concat([original, Buffer.from('\n')]));
  await expectCode(() => workspace.buildVisualPlanningWorkspace(f.request, { root: f.root }), 'WORKSPACE_ARTIFACT_HASH_DRIFT');
});

test('workspace rejects a symlink even when it points to identical Visual Plan bytes', async () => {
  const f = fixture();
  const artifact = artifactPath(f);
  const outside = path.join(f.root, 'outside-visual-plan.json');
  fs.copyFileSync(artifact, outside);
  fs.unlinkSync(artifact);
  fs.symlinkSync(outside, artifact);
  await expectCode(() => workspace.buildVisualPlanningWorkspace(f.request, { root: f.root }), 'WORKSPACE_ARTIFACT_SYMLINK_REJECTED');
});

test('Decision Queue V2 projection is filtered to exact invocation, artifact, and Visual Plan gate', async () => {
  const f = fixture();
  const first = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  const exact = {
    queue_item_id: 'REVIEW:exact', state: 'ACTIVE', run_id: SOURCE_RUN, agent_id: AGENT_ID,
    task_id: TASK_ID, invocation_id: INVOCATION_ID, attention: 'REVIEW', reason: 'Review exact plan', blocker: null,
    owning_gate: 'VISUAL_PLAN_APPROVAL', approval_scope_required: 'VISUAL_PLAN_APPROVAL',
    artifacts: [{ artifact_id: 'visual_plan', sha256: first.visual_plan.sha256 }],
    operational_rationale: { source: 'AGENT', decision: 'REVIEW', reason: 'Review exact plan', evidence_refs: [], confidence: null, escalation_reason: null },
    handoff: { next_owner: 'mikko', next_action: 'Review plan' }, workspace: '/visual-planning-workspace.html?exact=1',
  };
  const queue = { human_decision_queue: [
    exact,
    { ...exact, queue_item_id: 'wrong-task', task_id: 'other-task' },
    { ...exact, queue_item_id: 'wrong-invocation', invocation_id: `${AGENT_ID}:other:1` },
    { ...exact, queue_item_id: 'wrong-artifact', artifacts: [{ artifact_id: 'visual_plan', sha256: 'a'.repeat(64) }] },
    { ...exact, queue_item_id: 'wrong-gate', owning_gate: 'FINAL_CUT_APPROVAL', approval_scope_required: 'FINAL_CUT_APPROVAL' },
    { ...exact, queue_item_id: 'information', attention: 'INFORMATION' },
  ], diagnostics: [] };
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: queue });
  assert.deepEqual(out.human_attention.map((item) => item.queue_item_id), ['REVIEW:exact']);
  assert.equal(out.human_attention[0].approval_scope_required, 'VISUAL_PLAN_APPROVAL');
});

test('workspace consumes only REVIEW and DECISION queue obligations', async () => {
  const f = fixture();
  const base = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  const item = { queue_item_id: 'info', state: 'ACTIVE', run_id: SOURCE_RUN, agent_id: AGENT_ID, task_id: TASK_ID, invocation_id: INVOCATION_ID,
    attention: 'INFORMATION', owning_gate: 'VISUAL_PLAN_APPROVAL', approval_scope_required: 'VISUAL_PLAN_APPROVAL', artifacts: [{ artifact_id: 'visual_plan', sha256: base.visual_plan.sha256 }] };
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [item], diagnostics: [] } });
  assert.equal(out.human_attention.length, 0);
});

test('workspace surfaces HUMAN manual artifact only for the exact owned target', async () => {
  const f = fixture();
  const preview = controls.previewTakeManualControl({ ...f.request, reason: 'Bounded workspace ownership test' }, { root: f.root });
  const applied = controls.applyTakeManualControl({ ...f.request, reason: 'Bounded workspace ownership test', preview_token: preview.preview_token }, { root: f.root });
  assert.equal(applied.execution_owner, 'HUMAN');
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  assert.equal(out.ownership.current_owner, 'HUMAN');
  assert.equal(out.ownership.capabilities.take_manual_control.allowed, false);
  assert.equal(out.ownership.capabilities.return_to_automation.allowed, true);
  assert.equal(out.ownership.manual_artifact.artifact_id, 'visual_plan');
  assert.match(out.ownership.manual_artifact.reference, /agents\/manual-work\/visual_planning_director\/.+\/artifact\.json$/);
  assert.equal(out.ownership.manual_artifact.trusted_handoff.endpoint, '/api/package-runs/open-file');
  assert.equal(out.ownership.manual_artifact.trusted_handoff.write_api, null);
});

test('workspace resource projection never invents unavailable health', async () => {
  const f = fixture();
  const out = await workspace.buildVisualPlanningWorkspace(f.request, {
    root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] },
    liveResourceProvider: async () => ({ source: 'TEST_PROBE', probed_at: '2026-08-24T12:00:00.000Z', compute: {}, jobs: {} }),
  });
  assert.equal(out.resource_tool.health, 'UNKNOWN');
  assert.equal(out.resource_tool.worker, 'UNKNOWN');
  assert.equal(out.resource_tool.job_id, 'UNKNOWN');
  assert.equal(out.resource_tool.telemetry_source, 'TEST_PROBE');
});

test('workspace resolver is byte-read-only', async () => {
  const f = fixture();
  const before = treeDigest(f.root);
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  assert.equal(out.read_only, true);
  assert.equal(treeDigest(f.root), before);
});

test('HTTP workspace route returns one complete bounded payload for the historical run identity', async () => {
  const f = fixture();
  const server = packageEngineServer.createServer({
    root: f.root,
    agentLiveResourceProvider: async () => ({ source: 'TEST_PROBE', probed_at: null, compute: null, jobs: null }),
    agentDecisionQueueProjection: { human_decision_queue: [], diagnostics: [] },
    agentCancelProvider: Object.assign(async () => ({ status: 'NOT_SUPPORTED' }), { supports: () => false }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const query = new URLSearchParams(f.request).toString();
    const response = await requestJson(server, `${packageEngineServer.VISUAL_PLANNING_WORKSPACE_API}?${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data.workspace_type, 'VISUAL_PLANNING_WORKSPACE_V1');
    assert.equal(response.body.data.context.run_id, SOURCE_RUN);
    assert.equal(response.body.data.visual_plan.shots.length, 11);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
