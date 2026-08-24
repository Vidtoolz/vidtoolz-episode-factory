'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { assert, fs, os, path, test, packageEngineServer } = require('./_helpers.js');
const workspace = require('../scripts/visual-planning-workspace.js');
const workspaceContract = require('../scripts/visual-planning-workspace-contract.js');
const controls = require('../scripts/agent-controls.js');
const ownership = require('../scripts/execution-ownership.js');
const ledger = require('../scripts/operator-action-ledger.js');
const workspaceFixture = require('./fixtures/visual-planning-workspace-v1.js');

const SOURCE_RUN = workspaceFixture.RUN_ID;
const TASK_ID = workspaceFixture.TASK_ID;
const INVOCATION_ID = workspaceFixture.INVOCATION_ID;
const AGENT_ID = workspaceFixture.AGENT_ID;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-planning-workspace-'));
  return workspaceFixture.materialize(root);
}

function expectCode(fn, code) {
  return Promise.resolve().then(fn).then(
    () => assert.fail(`expected ${code}`),
    (error) => assert.equal(error.code, code),
  );
}

function artifactPath(f) {
  return path.join(f.root, 'package-runs', f.request.run_id, 'agents', AGENT_ID, f.request.task_id, 'artifacts', 'visual-plan.json');
}

function exactWorkspaceLink(request) {
  return `/visual-planning-workspace.html?run=${encodeURIComponent(request.run_id)}&agent=${encodeURIComponent(request.agent_id)}&task=${encodeURIComponent(request.task_id)}&invocation=${encodeURIComponent(request.invocation_id)}`;
}

function exactQueueItem(f, out, overrides = {}) {
  return {
    queue_item_id: 'obligation:exact', state: 'ACTIVE', run_id: f.request.run_id, agent_id: f.request.agent_id,
    task_id: f.request.task_id, invocation_id: f.request.invocation_id, attention: 'REVIEW', reason: 'Review exact plan', blocker: null,
    owning_gate: 'VISUAL_PLAN_APPROVAL', approval_scope_required: 'VISUAL_PLAN_APPROVAL',
    artifacts: [{ artifact_id: 'visual_plan', sha256: out.visual_plan.sha256 }],
    operational_rationale: { source: 'AGENT', decision: 'REVIEW', reason: 'Review exact plan', evidence_refs: [], confidence: null, escalation_reason: null },
    handoff: { next_owner: 'mikko', next_action: 'Review plan' }, workspace: exactWorkspaceLink(f.request),
    ...overrides,
  };
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

function postJson(server, pathname, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const bytes = Buffer.from(JSON.stringify({ ...body, localWriteNonce: packageEngineServer.localWriteNonce() }));
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: pathname, method: 'POST', headers: {
      Host: '127.0.0.1:8010', 'Content-Type': 'application/json', 'Content-Length': bytes.length,
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
    } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end(bytes);
  });
}

test('Visual Planning workspace resolves the deterministic canonical V1 fixture', async () => {
  const f = fixture();
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  assert.equal(out.read_only, true);
  assert.equal(out.context.run_id, SOURCE_RUN);
  assert.equal(out.context.task_id, TASK_ID);
  assert.equal(out.context.invocation_id, INVOCATION_ID);
  assert.equal(out.context.runtime_state, 'COMPLETED');
  assert.equal(out.visual_plan.artifact_id, 'visual_plan');
  assert.equal(out.visual_plan.plan_revision, 1);
  assert.equal(out.workspace_schema_version, 1);
  assert.equal(out.visual_plan.coverage.required_beats.length, 2);
  assert.equal(out.visual_plan.coverage.uncovered_beats.length, 0);
  assert.equal(out.visual_plan.shots.length, 2);
  assert.equal(out.visual_plan.story_dependency.freshness_state, 'CURRENT');
  assert.equal(out.ownership.current_owner, 'AUTOMATION');
  assert.equal(out.ownership.successor_capability.adapter_id, 'VISUAL_PLAN_SUCCESSOR_V1');
  assert.equal(out.resource_tool.health, 'UNKNOWN');
  assert.equal(out.resource_tool.telemetry_source, 'INVOCATION_EVIDENCE_ONLY');
});

test('workspace consumes the committed canonical Decision Queue V2 projection', async () => {
  const f = fixture();
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root });
  assert.equal(out.human_attention.length, 1);
  assert.equal(out.human_attention[0].attention, 'REVIEW');
  assert.equal(out.human_attention[0].owning_gate, 'VISUAL_PLAN_APPROVAL');
  assert.match(out.human_attention[0].workspace, /invocation=visual_planning_director%3Avisual-planning-workspace-v1-task%3A1/);
  assert.equal(out.queue_binding.status, 'VERIFIED');
  assert.equal(out.queue_binding.obligation_id, out.human_attention[0].queue_item_id);
  assert.ok(Array.isArray(out.decision_queue_diagnostics));
});

test('workspace V1 stable schema fields are frozen and complete', async () => {
  const f = fixture();
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root });
  assert.equal(out.workspace_schema_id, 'visual-planning-workspace/v1');
  assert.deepEqual(Object.keys(out).sort(), [...workspace.WORKSPACE_STABLE_FIELDS.top_level].sort());
  assert.deepEqual(Object.keys(out.context).sort(), [...workspace.WORKSPACE_STABLE_FIELDS.context].sort());
  assert.deepEqual(Object.keys(out.visual_plan).sort(), [...workspace.WORKSPACE_STABLE_FIELDS.visual_plan].sort());
  assert.deepEqual(Object.keys(out.visual_plan.story_dependency).sort(), [...workspace.WORKSPACE_STABLE_FIELDS.story_dependency].sort());
  assert.deepEqual(Object.keys(out.queue_binding).sort(), [...workspace.WORKSPACE_STABLE_FIELDS.queue_binding].sort());
  assert.deepEqual(Object.keys(out.ownership).sort(), [...workspace.WORKSPACE_STABLE_FIELDS.ownership].sort());
  assert.deepEqual(Object.keys(out.ownership.successor_capability).sort(), [...workspace.WORKSPACE_STABLE_FIELDS.successor_capability].sort());
  assert.deepEqual(Object.keys(out.resource_tool).sort(), [...workspace.WORKSPACE_STABLE_FIELDS.resource_tool].sort());
  assert.deepEqual(workspaceContract.validateWorkspaceV1(out), { valid: true, errors: [] });
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
  const exact = exactQueueItem(f, first, { queue_item_id: 'REVIEW:exact' });
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
  assert.equal(out.queue_binding.status, 'VERIFIED');
});

test('queue deep link, workspace request, and projection bind the exact same context', async () => {
  const f = fixture();
  const baseline = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  const item = exactQueueItem(f, baseline);
  const linked = new URL(item.workspace, 'http://workspace.invalid');
  const request = { run_id: linked.searchParams.get('run'), agent_id: linked.searchParams.get('agent'), task_id: linked.searchParams.get('task'), invocation_id: linked.searchParams.get('invocation') };
  const out = await workspace.buildVisualPlanningWorkspace(request, { root: f.root, decisionQueueProjection: { available: true, human_decision_queue: [item], human_decision_history: [], diagnostics: [] } });
  assert.deepEqual([out.context.run_id, out.context.agent_id, out.context.task_id, out.context.invocation_id], [item.run_id, item.agent_id, item.task_id, item.invocation_id]);
  await expectCode(() => workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { available: true, human_decision_queue: [{ ...item, workspace: exactWorkspaceLink({ ...f.request, task_id: 'other-task' }) }], diagnostics: [] } }), 'WORKSPACE_QUEUE_LINK_INVALID');
});

test('resolved or superseded exact obligations remain historical and never retarget', async () => {
  const f = fixture();
  const baseline = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  for (const state of ['RESOLVED', 'SUPERSEDED']) {
    const historical = exactQueueItem(f, baseline, { state, queue_item_id: `obligation:${state.toLowerCase()}` });
    const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { available: true, human_decision_queue: [], human_decision_history: [historical], diagnostics: [] } });
    assert.equal(out.human_attention.length, 0);
    assert.equal(out.queue_binding.status, 'HISTORICAL');
    assert.equal(out.queue_binding.obligation_state, state);
  }
});

test('unavailable queue is explicit and cannot claim an active binding', async () => {
  const f = fixture();
  const baseline = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root, decisionQueueProjection: {
    available: false, status: 'INVALID', human_decision_queue: [exactQueueItem(f, baseline)],
    diagnostics: [{ code: 'HUMAN_DECISION_QUEUE_INVALID', run_id: f.request.run_id }],
  } });
  assert.equal(out.human_attention.length, 0);
  assert.deepEqual(out.queue_binding, { status: 'UNAVAILABLE', queue_available: false, obligation_id: null, obligation_state: null, diagnostic_codes: ['HUMAN_DECISION_QUEUE_INVALID'] });
});

test('workspace version compatibility is explicit and never silently downgrades', async () => {
  const f = fixture();
  const options = { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } };
  assert.equal((await workspace.buildVisualPlanningWorkspace({ ...f.request, workspace_schema_version: 1, workspace_schema_id: 'visual-planning-workspace/v1' }, options)).workspace_schema_version, 1);
  assert.equal((await workspace.buildVisualPlanningWorkspace(f.request, options)).workspace_schema_version, 1);
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, workspace_schema_version: 2 }, options), 'WORKSPACE_SCHEMA_VERSION_UNSUPPORTED');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, workspace_schema_version: '1' }, options), 'WORKSPACE_SCHEMA_VERSION_INVALID');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, workspace_schema_id: 'visual-planning-workspace/v2' }, options), 'WORKSPACE_SCHEMA_ID_UNSUPPORTED');
});

test('workspace rejects hostile identifiers without becoming a filesystem API', async () => {
  const f = fixture();
  const options = { root: f.root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } };
  for (const run_id of ['/tmp/elsewhere', '..', '../escape', 'bad\0id']) {
    await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, run_id }, options), 'AGENT_CONTROL_TARGET_INVALID');
  }
  for (const run_id of [{}, []]) await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, run_id }, options), 'WORKSPACE_CONTEXT_INVALID');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, run_id: null }, options), 'WORKSPACE_CONTEXT_INCOMPLETE');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, task_id: {} }, options), 'WORKSPACE_CONTEXT_INVALID');
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...f.request, invocation_id: [] }, options), 'WORKSPACE_CONTEXT_INVALID');
});

test('same task and invocation strings remain isolated by exact run identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-planning-workspace-cross-run-'));
  const first = workspaceFixture.materialize(root, { run_id: '2026-08-24-workspace-v1-a' });
  const second = workspaceFixture.materialize(root, { run_id: '2026-08-24-workspace-v1-b' });
  const a = await workspace.buildVisualPlanningWorkspace(first.request, { root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  const b = await workspace.buildVisualPlanningWorkspace(second.request, { root, decisionQueueProjection: { human_decision_queue: [], diagnostics: [] } });
  assert.equal(a.context.run_id, first.request.run_id);
  assert.equal(b.context.run_id, second.request.run_id);
  assert.equal(a.context.invocation_id, b.context.invocation_id);
  await expectCode(() => workspace.buildVisualPlanningWorkspace({ ...first.request, artifact_sha256: b.visual_plan.sha256.replace(/^./, b.visual_plan.sha256[0] === 'a' ? 'b' : 'a') }, { root }), 'WORKSPACE_ARTIFACT_HASH_MISMATCH');
});

test('semantic V1 snapshot guards authority and identity fields without HTML coupling', async () => {
  const f = fixture();
  const out = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root });
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'visual-planning-workspace-v1.snapshot.json'), 'utf8'));
  assert.deepEqual(workspaceContract.semanticSnapshot(out), expected);
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

test('HTTP workspace route returns one complete bounded payload for the stable fixture identity', async () => {
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
    assert.equal(response.body.data.workspace_schema_version, 1);
    assert.equal(response.body.data.visual_plan.shots.length, 2);
    const v1 = await requestJson(server, `${packageEngineServer.VISUAL_PLANNING_WORKSPACE_API}?${query}&workspace_schema_version=1&workspace_schema_id=${encodeURIComponent('visual-planning-workspace/v1')}`);
    assert.equal(v1.status, 200);
    const v2 = await requestJson(server, `${packageEngineServer.VISUAL_PLANNING_WORKSPACE_API}?${query}&workspace_schema_version=2`);
    assert.equal(v2.status, 406);
    assert.equal(v2.body.code, 'WORKSPACE_SCHEMA_VERSION_UNSUPPORTED');
    const malformed = await requestJson(server, `${packageEngineServer.VISUAL_PLANNING_WORKSPACE_API}?${query}&workspace_schema_version=one`);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'WORKSPACE_SCHEMA_VERSION_INVALID');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('HTTP bounded edit preview/apply accepts only exact HUMAN-owned creative patch', async () => {
  const f = fixture();
  const actor = ledger.localActorContext({ username: 'mikko' });
  const takeover = controls.previewTakeManualControl({ ...f.request, reason: 'HTTP bounded edit test.' }, { root: f.root });
  controls.applyTakeManualControl({ ...f.request, reason: 'HTTP bounded edit test.', preview_token: takeover.preview_token }, { root: f.root, actor });
  const owner = ownership.readOwnership(f.root, f.request);
  const humanWorkspace = await workspace.buildVisualPlanningWorkspace(f.request, { root: f.root });
  const base = { ...f.request, expected_ownership_revision: owner.revision, expected_artifact_sha256: humanWorkspace.visual_plan.sha256,
    reason: 'Clarify the opening shot through the bounded HTTP contract.', creative_patch: { shot_edits: [{ shot_ref: f.plan.shots[0].shot_id,
      set: { shot_brief: 'An operator-guided editorial view of a completed workstation render.' } }] } };
  const server = packageEngineServer.createServer({ root: f.root, agentSuccessorValidation: { currentStory: f.plan.story } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const preview = await postJson(server, packageEngineServer.VISUAL_PLANNING_EDIT_PREVIEW_API, base);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.eligible, true);
    const apply = await postJson(server, packageEngineServer.VISUAL_PLANNING_EDIT_APPLY_API, { ...base,
      preview_token: preview.body.data.preview_token, preview_created_at: preview.body.data.preview_created_at });
    assert.equal(apply.status, 200);
    assert.equal(apply.body.data.execution_owner, 'HUMAN');
    assert.equal(apply.body.data.plan_revision, 2);
    const forbidden = await postJson(server, packageEngineServer.VISUAL_PLANNING_EDIT_PREVIEW_API, { ...base,
      expected_ownership_revision: apply.body.data.ownership_revision, expected_artifact_sha256: apply.body.data.artifact_sha256,
      creative_patch: { shot_edits: [{ shot_ref: apply.body.data.creative_changes[0].shot_ref, set: { plan_digest_sha256: '0'.repeat(64) } }] } });
    assert.equal(forbidden.status, 400);
    assert.equal(forbidden.body.code, 'VISUAL_PLAN_EDIT_FIELD_FORBIDDEN');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
