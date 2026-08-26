'use strict';

/*
 * Presenter Director enablement tests — PD1–PD20.
 *
 * Presenter Director exists to make the human performance better prepared, not
 * to replace it. Enablement therefore has to prove two different things: that
 * the specialist is genuinely dispatchable through the canonical mechanism, and
 * that being enabled bought it no human authority at all.
 *
 * The second half is the part worth guarding. An enabled agent that could select
 * a take or mark a performance approved would have quietly become the human, and
 * no amount of correct dispatch would make that acceptable. So the negatives here
 * are asserted against the real runner and the real manifest contract, not
 * against a description of them.
 *
 * The terminal state these tests aim at is READY_FOR_HUMAN_PERFORMANCE with no
 * media and no selection: everything ready, Mikko performs now. That is success,
 * not a blocker.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { tests, test } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const AGENT_ID = 'presenter_director';

const registryPath = path.join(ROOT, 'config', 'agent-registry.json');
const contractPath = path.join(ROOT, 'config', 'agent-contract.json');
const governancePath = path.join(ROOT, 'governance', 'presenter-director-enablement.json');

const pd = require(path.join(ROOT, 'scripts', 'presenter-director.js'));
const boundary = require(path.join(ROOT, 'scripts', 'agent-executable-boundary.js'));
const runner = require(path.join(ROOT, 'scripts', 'agent-run.js'));
const takeManifest = require(path.join(ROOT, 'scripts', 'presenter-take-manifest.js'));
const adapter = require(path.join(ROOT, 'scripts', 'supervised-presenter-take-adapter.js'));
const captureReadiness = require(path.join(ROOT, 'scripts', 'production-capture-readiness.js'));
const productionMode = require(path.join(ROOT, 'scripts', 'package-run-production-mode.js'));
const supervisedCapture = require(path.join(ROOT, 'supervised-capture.js'));
const upstream = require(path.join(ROOT, 'scripts', 'production-mix-upstream-readiness.js'));
const captureEvidence = require(path.join(ROOT, 'scripts', 'package-run-capture-evidence-review.js'));

const registry = () => JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const registration = () => registry().agents.find((a) => a.agent_id === AGENT_ID);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const STORY = Object.freeze({
  project_id: 'pd-enable', version_id: 'v1', content_hash: 'a'.repeat(64),
  approval_state: 'approved', central_claim: 'One claim, delivered once.',
  narrative_spine: ['hook', 'claim', 'proof', 'close'],
  sections: [{ section_id: 's1', order: 1, dialogue: 'This is the line.', framing_preset: 'center-lower' }],
});

const PROFILE = 'vidnux-screen-4k30-mic';
const FIXTURE_NOTE = 'HUMAN_CAPTURE_TEST_FIXTURE';

function makeCapture(dir, captureId, frequency = 200) {
  const mp4 = path.join(dir, `${captureId}.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=10',
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=10`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-metadata', `comment=${FIXTURE_NOTE}`, mp4],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  const meta = supervisedCapture.inferMetadataPath(mp4);
  fs.writeFileSync(meta, `${JSON.stringify({
    capture_id: captureId, machine: 'vidnux', backend: 'ffmpeg', profile: PROFILE,
    started_at: '2026-08-25T18:00:00Z', stopped_at: '2026-08-25T18:00:10Z', pid: 0,
    process_start_time: '0', output_file: mp4, metadata_file: meta,
    ffmpeg_command: '(fixture)', requested_width: 3840, requested_height: 2160,
    detected_display_geometry: null, display_session_info: {}, audio_mode: 'mic',
    audio_source: 'fixture-mic', system_audio_source: null, mic_source: 'fixture-mic',
    audio_mix_strategy: 'none', notes: [FIXTURE_NOTE],
    approval_boundary: supervisedCapture.APPROVAL_BOUNDARY,
  }, null, 2)}\n`);
  return mp4;
}

function productionRun(runId) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-enable-'));
  const run = path.join(base, runId);
  fs.mkdirSync(path.join(run, 'captures'), { recursive: true });
  fs.writeFileSync(productionMode.modePath(run), `${JSON.stringify({
    schema: productionMode.MODE_SCHEMA, run_id: runId, mode: 'PRODUCTION',
    declared_by: { type: 'HUMAN', id: 'FIXTURE_HUMAN' }, declared_at: '2026-08-25T18:00:00Z',
  }, null, 2)}\n`);
  return run;
}

const READY = {
  evaluateReadiness: () => ({
    schema: captureReadiness.READINESS_SCHEMA,
    state: captureReadiness.STATE_READY,
    checks: captureReadiness.PREREQUISITE_IDS.map((id) => ({ prerequisite_id: id, ok: true, detail: 'fixture' })),
  }),
};

function newManifest() { return takeManifest.createManifest(JSON.parse(JSON.stringify(STORY)), {}); }

async function dispatch(task, runId = 'pd-enable-dispatch') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-task-'));
  const taskPath = path.join(dir, 'task.json');
  fs.writeFileSync(taskPath, `${JSON.stringify({ ...task, package_run_id: runId }, null, 2)}\n`);
  return runner.runRegisteredAgent({ repoRoot: ROOT, agentId: AGENT_ID, runId, taskPath });
}

/* ── PD1: the human authority event is recorded canonically ───────────────── */
test('PD1: explicit Mikko enablement authority is recorded in governance', () => {
  assert.ok(fs.existsSync(governancePath), 'governance record must exist');
  const record = JSON.parse(fs.readFileSync(governancePath, 'utf8'));
  assert.equal(record.role, AGENT_ID);
  assert.equal(record.decision, 'ENABLE');
  assert.equal(record.decision_maker.identity, 'Mikko');
  assert.equal(record.decision_maker.identity_type, 'HUMAN_ORCHESTRATION_AUTHORIZATION');
  // Honest about what the record can and cannot prove.
  assert.equal(record.decision_maker.authenticated, false);
  assert.ok(record.authorization.prohibited_authorities.length >= 10);
  assert.ok(record.authorization.authorized_responsibilities.length >= 8);
  assert.equal(record.prior_state.autonomous_dispatch, 'DISABLED');
  assert.equal(record.resulting_state.autonomous_dispatch, 'ENABLED');
});

/* ── PD2: prerequisites were satisfied, and the defect was repaired not waived ─ */
test('PD2: all enablement prerequisites are satisfied and the blocking defect was repaired', () => {
  const record = JSON.parse(fs.readFileSync(governancePath, 'utf8'));
  const satisfied = record.prerequisite_state.satisfied;
  assert.ok(satisfied.take_contract && satisfied.editor_selection_boundary && satisfied.human_decision);
  const defect = record.prerequisite_state.defect_found_and_repaired_before_enablement;
  assert.ok(defect, 'the envelope defect must be recorded, not omitted');
  assert.match(defect.note, /does not override a broken technical prerequisite/i);
  // The repair is real: refusals now carry a rationale the runner accepts.
  assert.equal(pd.AGENT_ID, AGENT_ID);
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'presenter-director.js'), 'utf8');
  assert.ok(/operational_rationale/.test(source), 'refusals must carry an operational rationale');
});

/* ── PD3/PD4: enabled through the canonical registry, roster unchanged ────── */
test('PD3/PD4: presenter director is canonically enabled and the roster stays at twelve', () => {
  const entry = registration();
  assert.equal(entry.lifecycle.proven, 'PROVEN');
  assert.equal(entry.lifecycle.autonomous_dispatch, 'ENABLED');
  assert.equal(entry.implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.ok(!entry.lifecycle.dispatch_blocked_reason, 'the blocked reason must be gone, not contradicted');
  // The contract and the registry must tell the same truth.
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const role = contract.role_roster.find((r) => r.role_id === AGENT_ID);
  assert.equal(role.status, 'BUILT');
  // Exactly twelve, and no capture/presenter duplicate crept in.
  assert.equal(registry().agents.length, 12);
  const ids = registry().agents.map((a) => a.agent_id);
  assert.equal(new Set(ids).size, 12);
  assert.equal(ids.filter((id) => /presenter|capture/i.test(id)).length, 1);
  // The executable boundary now authorizes dispatch.
  const verdict = boundary.executableLifecycle(AGENT_ID, {});
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.code, null);
});

/* ── PD5/PD6: real runner dispatch with exact identity ────────────────────── */
test('PD5/PD6: the canonical runner dispatches presenter_director by exact identity', async () => {
  const out = await dispatch({ task_id: 'pd-t-status', project_id: 'pd-enable', action: 'status', privacy: { local_only: true }, story: STORY });
  assert.equal(out.infrastructure_state, 'COMPLETE');
  // No identity substitution and no generic fallback specialist.
  assert.equal(out.result.agent_id, AGENT_ID);
  assert.equal(out.invocation.agent_id, AGENT_ID);
  assert.equal(out.invocation.module_path, 'scripts/presenter-director.js');
  assert.equal(out.result.control_room.role, 'Presenter Director');
  assert.notEqual(out.infrastructure_state, 'RUNNER_AGENT_ID_MISMATCH');
});

/* ── PD6b: only the declared action surface dispatches ────────────────────── */
test('PD6b: every declared action exists and nothing outside the surface dispatches', async () => {
  assert.deepEqual([...pd.ACTIONS], ['prepare_delivery', 'log_takes', 'evaluate_takes', 'status']);
  const entry = registration();
  if (Array.isArray(entry.actions)) {
    for (const action of entry.actions) assert.ok(pd.ACTIONS.includes(action), `registry action ${action} has no implementation`);
  }
  // Selection is not in the surface at all, so it cannot be requested.
  await assert.rejects(
    () => dispatch({ task_id: 'pd-t-select', project_id: 'pd-enable', action: 'select_best_take', privacy: { local_only: true }, story: STORY }),
    (e) => e.code === 'RUNNER_ACTION_UNSUPPORTED',
  );
});

/* ── PD7: a refusal on an unapproved script is dispatchable and explains itself ─ */
test('PD7: delivery preparation refuses an unapproved script with a valid envelope', async () => {
  const out = await dispatch({
    task_id: 'pd-t-draft', project_id: 'pd-enable', action: 'prepare_delivery',
    privacy: { local_only: true }, story: { ...STORY, approval_state: 'draft' },
  });
  // Before the repair this was RUNNER_ENVELOPE_INVALID: correct refusal, undeliverable.
  assert.equal(out.infrastructure_state, 'COMPLETE');
  assert.equal(out.result.state, 'BLOCKED');
  assert.equal(out.result.attention, 'DECISION');
  assert.ok(out.result.operational_rationale?.reason, 'a refusal must say why');
  assert.equal(out.result.next_owner, 'hermes');
});

/* ── PD8: readiness comes from the canonical authority, not a new model ───── */
test('PD8: recording readiness consumes the canonical readiness authority', () => {
  // One owner of the state string, reused by the adapter rather than restated.
  assert.equal(adapter.READY_FOR_HUMAN_PERFORMANCE, captureReadiness.STATE_READY);
  assert.equal(captureReadiness.STATE_READY, 'READY_FOR_HUMAN_PERFORMANCE');
  // Presenter Director does not mint a competing readiness state.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'presenter-director.js'), 'utf8');
  assert.ok(!/READY_FOR_HUMAN_PERFORMANCE\s*=/.test(source), 'PD must not define its own readiness state');
});

/* ── PD9/PD10/PD11: the terminal pre-performance state ────────────────────── */
test('PD9/PD10/PD11: the machine reaches READY_FOR_HUMAN_PERFORMANCE with nothing performed', () => {
  const run = productionRun('pd-ready-canary');
  const manifest = newManifest();
  const session = adapter.prepareCaptureSession(run, { runId: 'pd-ready-canary', profile: PROFILE, manifest }, { ...READY });
  assert.equal(session.state, 'READY_FOR_HUMAN_PERFORMANCE');
  assert.equal(session.machine_ready, true);
  assert.equal(session.human_required, true);
  assert.equal(session.next_authority, 'Mikko');
  // Nothing performed, nothing recorded, nothing fabricated.
  assert.equal(session.media_recorded, false);
  assert.equal(session.takes_registered, 0);
  assert.equal(manifest.takes.length, 0);
  assert.equal(manifest.human_selections.length, 0);
  assert.equal(fs.readdirSync(path.join(run, 'captures')).length, 0, 'no media may exist before Mikko performs');
});

/* ── PD12/PD13: proxy and synthetic can never be human capture ────────────── */
test('PD12/PD13: proxy presenter and synthetic narration are refused as human capture', () => {
  const run = productionRun('pd-proxy-negative');
  const manifest = newManifest();
  adapter.prepareCaptureSession(run, { runId: 'pd-proxy-negative', profile: PROFILE, manifest }, { ...READY });
  for (const folder of ['draft-proxy-presenter', 'draft-narration']) {
    const dir = path.join(run, 'captures', folder);
    fs.mkdirSync(dir, { recursive: true });
    const mp4 = makeCapture(dir, `cap-${folder}`);
    assert.throws(
      () => adapter.registerSupervisedPresenterTake(run, {
        runId: 'pd-proxy-negative', captureFile: mp4,
        recordingUnitId: manifest.recording_units[0].recording_unit_id, manifest,
      }, { write: false }),
      (e) => e.code === adapter.CODES.PROXY_FORBIDDEN,
    );
  }
  // And the gate-8 predicate keeps refusing proxy evidence rows.
  assert.equal(captureEvidence.hasRealCaptureEvidence('| PROXY_GENERATED render 1 | draft-proxy-presenter/a.mp4 | proxy | closed |', 'any'), false);
  assert.equal(captureEvidence.hasRealCaptureEvidence('| DRAFT_SYNTHETIC seg 1 | draft-narration/n.wav | not recorded presenter audio | closed |', 'any'), false);
});

/* ── PD14/PD15: multiple fixture takes, advisory only ─────────────────────── */
test('PD14/PD15: several takes are registered and ranking stays advisory', () => {
  const run = productionRun('pd-multi');
  let manifest = newManifest();
  const unit = manifest.recording_units[0].recording_unit_id;
  adapter.prepareCaptureSession(run, { runId: 'pd-multi', profile: PROFILE, manifest }, { ...READY });
  for (const [index, frequency] of [[1, 200], [2, 300], [3, 400]]) {
    const mp4 = makeCapture(path.join(run, 'captures'), `pd-take-${index}`, frequency);
    manifest = adapter.registerSupervisedPresenterTake(run,
      { runId: 'pd-multi', captureFile: mp4, recordingUnitId: unit, manifest }, {}).manifest;
  }
  assert.equal(manifest.takes.length, 3);
  assert.equal(new Set(manifest.takes.map((t) => t.media.sha256)).size, 3);
  // Ranking is a recommendation with a rank, never a selection.
  assert.equal(manifest.human_selections.length, 0);
  const handoff = takeManifest.buildEditorHandoff(manifest, {});
  assert.equal(handoff.units[0].ready, false);
  assert.equal(handoff.units[0].state, 'AWAITING_HUMAN_SELECTION');
  // Whatever PD emits, it is a recommendation field and not a selection field.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'presenter-director.js'), 'utf8');
  assert.ok(/take_rankings|recommendation_rank/.test(source), 'advisory ranking must exist');
  assert.ok(!/human_selections\s*\.push|createHumanSelection/.test(source), 'PD must never write a human selection');
});

/* ── PD16: an agent cannot create a human take selection ──────────────────── */
test('PD16: presenter_director cannot create a human take selection', () => {
  const run = productionRun('pd-selection-negative');
  let manifest = newManifest();
  const unit = manifest.recording_units[0].recording_unit_id;
  adapter.prepareCaptureSession(run, { runId: 'pd-selection-negative', profile: PROFILE, manifest }, { ...READY });
  const mp4 = makeCapture(path.join(run, 'captures'), 'pd-sel-take');
  manifest = adapter.registerSupervisedPresenterTake(run,
    { runId: 'pd-selection-negative', captureFile: mp4, recordingUnitId: unit, manifest }, {}).manifest;

  const takeId = manifest.takes[0].take_id;
  // As an AGENT: refused.
  assert.throws(() => takeManifest.createHumanSelection(manifest,
    { take_id: takeId, selector: { type: 'AGENT', id: AGENT_ID } }, {}), /verified human selector required/);
  // Posing as a HUMAN with an agent id: refused, even if allow-listed.
  assert.throws(() => takeManifest.createHumanSelection(manifest,
    { take_id: takeId, selector: { type: 'HUMAN', id: AGENT_ID } }, { allowedHumanIds: [AGENT_ID] }), /verified human selector required/);
});

/* ── PD17/PD18: no approval, and gate 8 stays shut ───────────────────────── */
test('PD17/PD18: presenter_director cannot approve a performance or satisfy gate 8', async () => {
  const out = await dispatch({ task_id: 'pd-t-approve', project_id: 'pd-enable', action: 'status', privacy: { local_only: true }, story: STORY });
  const text = JSON.stringify(out);
  for (const forbidden of ['performance_approved', 'human_selection', 'gate_8_approved', 'approved_by']) {
    assert.ok(!new RegExp(forbidden, 'i').test(text), `envelope must not carry ${forbidden}`);
  }
  // Gate 8 needs real human capture evidence; a registered fixture row qualifies
  // structurally, and nothing an agent emits does.
  assert.equal(captureEvidence.hasRealCaptureEvidence('| take 1 | captures/pd-take-1.mp4 | 0:10 presenter dialogue | closed |', 'any'), true);
  assert.equal(captureEvidence.hasRealCaptureEvidence('| presenter_director asserts performance approved | n/a | agent claim | closed |', 'any'), false);
});

/* ── PD19: the downstream presenter source path advances one step ─────────── */
test('PD19: a structurally valid presenter source clears the root blocker', () => {
  const run = productionRun('pd-downstream');
  const manifest = newManifest();
  const unit = manifest.recording_units[0].recording_unit_id;
  adapter.prepareCaptureSession(run, { runId: 'pd-downstream', profile: PROFILE, manifest }, { ...READY });
  assert.equal(upstream.auditUpstreamMaterial({}).blockers[0].block, 'REAL_PRESENTER_AUDIO_MISSING');

  const mp4 = makeCapture(path.join(run, 'captures'), 'pd-down-take');
  const result = adapter.registerSupervisedPresenterTake(run,
    { runId: 'pd-downstream', captureFile: mp4, recordingUnitId: unit, manifest }, {});
  const manifestPath = path.join(run, 'presenter-take-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`);
  const after = upstream.auditUpstreamMaterial({ presenterTakes: { manifest_path: manifestPath } });
  assert.ok(after.satisfied.includes('presenter'));
  assert.equal(after.blockers[0].block, 'EDIT_PLAN_MISSING');
  assert.equal(after.ready, false);
});

/* ── PD20: the human-authority invariant, across every enabled agent ─────── */
test('PD20: no enabled agent may create a human selection or performance approval', () => {
  const enabled = registry().agents.filter((a) => a.lifecycle?.autonomous_dispatch === 'ENABLED');
  assert.ok(enabled.length >= 11);
  for (const agent of enabled) {
    const modulePath = path.join(ROOT, 'scripts', `${agent.agent_id.replace(/_/g, '-')}.js`);
    if (!fs.existsSync(modulePath)) continue;
    const source = fs.readFileSync(modulePath, 'utf8');
    assert.ok(!/createHumanSelection\s*\(/.test(source),
      `${agent.agent_id} must not call createHumanSelection`);
    assert.ok(!/type:\s*'HUMAN'/.test(source),
      `${agent.agent_id} must not construct a HUMAN verifier identity`);
  }
  // The contract itself refuses any agent id as a human selector.
  const manifest = newManifest();
  for (const agent of enabled) {
    assert.throws(() => takeManifest.createHumanSelection(manifest,
      { take_id: 'anything', selector: { type: 'HUMAN', id: agent.agent_id } },
      { allowedHumanIds: [agent.agent_id] }), /verified human selector required/,
    `${agent.agent_id} must not be accepted as a human selector`);
  }
});

module.exports = { tests };
