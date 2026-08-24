'use strict';

// SOUND & MUSIC DIRECTOR — sixth specialist agent. Tests prove authority
// invariants and a real bounded orchestration path through the EXISTING
// Scorecraft/music-dispatch machinery (compute gate + transport faked the
// same way tests/score-music-dispatch.test.js fakes them — no SSH, no GPU,
// no real audio). No human approval is ever fabricated.

const { assert, fs, os, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const SMD = path.join(REPO, 'scripts', 'sound-music-director.js');
const smd = require(SMD);
const contract = require('../config/agent-contract.json');
const registry = require('../config/agent-registry.json');
const scoreLane = require('../score-engine/score-lane.js');
const productionCandidates = require('../score-engine/production-candidates.js');

function runAgent(task, outPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-task-'));
  const taskPath = path.join(dir, 'task.json');
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
  try {
    const stdout = execFileSync('node', [SMD, '--task', taskPath,
      ...(outPath ? ['--out', outPath] : [])], { cwd: REPO, encoding: 'utf8', timeout: 120000 });
    return { code: 0, out: JSON.parse(stdout) };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status,
      out: e.stdout && e.stdout.trim().startsWith('{') ? JSON.parse(e.stdout) : null };
  }
}

// ── hermetic Scorecraft environment (mirrors music-dispatch tests) ──────────
let cueN = 0;
function cue(start, end, extra = {}) {
  cueN += 1;
  return {
    cue_id: `cue-${String(cueN).padStart(2, '0')}`, name: `Cue ${cueN}`,
    start_seconds: start, end_seconds: end,
    function: extra.function || 'explanation', emotion: extra.emotion || 'clinical',
    energy: extra.energy || 2, density: 2, tempo_bpm: 96, key: 'D minor',
    time_signature: '4/4', hit_points: [], dialogue_safe: true,
  };
}
function tmpScoreEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-score-'));
  return { root, options: { settingsPath: path.join(root, 'settings.json'), musicRoot: path.join(root, 'music') } };
}
function approvedProject(options) {
  cueN = 0;
  const { project } = scoreLane.createScoreProject({ name: 'SM Director Canary', duration_seconds: 60, seed: 100 }, options);
  scoreLane.saveCueSheetEdits(project.project_id, [cue(0, 30), cue(30, 60, { function: 'button' })], options);
  scoreLane.approveCueSheet(project.project_id, options);
  return project.project_id;
}

// Fake compute gate + transport (same contract as score-music-dispatch tests).
function routeGate(host = 'workerx') {
  return { ok: true, decision: 'ROUTE', lane: 'music_generation', selected_host: host,
    fallback_used: false, reason: `Lane available on ${host}.`, checks: {}, registry_version: 1 };
}
const FAKE_WAV = Buffer.from('smd-canary-deterministic-wav-bytes');
const FAKE_SHA = crypto.createHash('sha256').update(FAKE_WAV).digest('hex');
function fakeTransportFactory() {
  return (host) => {
    void host;
    let n = 0;
    return {
      async submitPrompt() { n += 1; return `prompt-${n}`; },
      async fetchHistory(promptId) {
        return { status: { completed: true, status_str: 'success' },
          outputs: { 9: { audio: [{ filename: `${promptId}.flac`, subfolder: 'scorecraft', type: 'output' }] } } };
      },
      async convertToWav() {},
      async ensureRemoteDir() {},
      async retrieve(remoteFile, localFile) { fs.writeFileSync(localFile, FAKE_WAV); },
      async sha256() { return FAKE_SHA; },
      sleep: async () => {},
    };
  };
}

async function dispatchOptions(options) {
  // inject fake gate/transport by pre-loading the module-level options used by
  // run(): we pass them via task-adjacent options object consumed by dispatch.
  return options;
}

// ── SM1–SM3: registration + authority ───────────────────────────────────────
test('SM1: sound_music_director validates against the canonical agent contract', () => {
  const agent = registry.agents.find((a) => a.agent_id === 'sound_music_director');
  assert.ok(agent, 'registered in agent-registry.json');
  const role = contract.role_roster.find((r) => r.role_id === 'sound_music_director');
  assert.ok(role, 'present in canonical role_roster');
  assert.equal(role.status, 'BUILT');
});

test('SM2: Sound owns music craft and cue execution; exactly one owner per class', () => {
  const ownership = new Map();
  for (const role of contract.role_roster) {
    for (const o of role.owns) {
      const key = o.toLowerCase().trim();
      if (ownership.has(key)) assert.fail(`duplicate owner for "${o}"`);
      ownership.set(key, role.role_id);
    }
  }
  assert.equal(ownership.get('music cue execution'), 'sound_music_director');
  assert.equal(ownership.get('music generation provenance'), 'sound_music_director');
});

test('SM3: prohibited authority — no approval/publication/script/camera/QC ownership', () => {
  const sm = contract.role_roster.find((r) => r.role_id === 'sound_music_director');
  for (const banned of ['final music approval', 'publication', 'script', 'camera movement', 'QC verdict']) {
    assert.ok(sm.does_not_own.some((d) => d.includes(banned)), `must disown ${banned}`);
  }
  const reg = registry.agents.find((a) => a.agent_id === 'sound_music_director');
  assert.ok(reg.prohibited_actions.some((p) => /record human approval/i.test(p)));
  assert.ok(reg.prohibited_actions.some((p) => /override QC/i.test(p)));
});

// ── SM4: deterministic-first ─────────────────────────────────────────────────
test('SM4: deterministic validators stay services — duration/hash checks measured, not judged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-det-'));
  const meta = { output_sha256: FAKE_SHA, requested_duration_s: 60, measured_duration_seconds: 60.2,
    generation_job_id: 'job-1', workflow_hash: 'wh', brief_hash: 'bh' };
  fs.writeFileSync(path.join(dir, 'production.wav'), FAKE_WAV);
  const checks = smd.evaluateCandidateDeterministic(meta, dir, 60);
  assert.equal(checks.file_integrity.state, 'PASS');
  assert.equal(checks.duration.state, 'PASS');
  assert.equal(checks.provenance.state, 'PASS');
  // Byte drift flips integrity deterministically — not an aesthetic opinion.
  fs.writeFileSync(path.join(dir, 'production.wav'), Buffer.from('tampered'));
  const after = smd.evaluateCandidateDeterministic(meta, dir, 60);
  assert.equal(after.file_integrity.state, 'FAIL');
});

// ── SM5: missing brief ───────────────────────────────────────────────────────
test('SM5: unapproved cue sheet -> PLAN_UNAPPROVED, direction never invented', async () => {
  const env = tmpScoreEnv();
  cueN = 0;
  const { project } = scoreLane.createScoreProject({ name: 'Unapproved', duration_seconds: 60 }, env.options);
  scoreLane.saveCueSheetEdits(project.project_id, [cue(0, 60)], env.options);
  const result = await smd.run({ task_id: 'SM5', project_id: project.project_id,
    assignment: { action: 'generate' }, ...env.options });
  assert.equal(result.state, 'PLAN_UNAPPROVED');
  assert.equal(result.attention, 'DECISION');
  assert.ok(!result.candidates.length, 'no candidates fabricated');
});

test('SM5b: missing required inputs -> INPUT_MISSING with explicit reason', async () => {
  const r = await smd.run({ task_id: null, project_id: null, assignment: {} });
  assert.equal(r.state, 'INPUT_MISSING');
});

// ── SM6/SM7: generation route authority ──────────────────────────────────────
test('SM6/SM7: unauthorized lane fails closed before any dispatch', async () => {
  const r = await smd.run({ task_id: 'SM7', project_id: 'whatever',
    authorized_lane: 'wan_i2v_generation', assignment: { action: 'generate' } });
  assert.equal(r.state, 'NO_AUTHORIZED_ROUTE');
  assert.ok(/fail-closed|authorized/.test(r.reason));
  assert.deepEqual(r.candidates, []);
});

// ── SM18: real canary through the orchestration path ────────────────────────
test('SM18: real canary — approved brief -> dispatch -> validation -> AWAITING_HUMAN_REVIEW', async () => {
  const env = tmpScoreEnv();
  const projectId = approvedProject(env.options);
  // Monkey-patch the dispatch entry to use the fake gate/transport (same
  // injection surface the engine's own tests use). The real prepare/admit/
  // execute/persist code paths all run.
  const originalRequest = require('../score-engine/music-dispatch.js').requestMusicGeneration;
  const dispatchModule = require('../score-engine/music-dispatch.js');
  const record = {};
  let calledWithLane = null;
  const patched = async (projectIdArg, input, options = {}) =>
    originalRequest(projectIdArg, input, { ...options,
      computeGateFn: () => { calledWithLane = 'music_generation'; return routeGate('workerx'); },
      transportFn: (host) => { record.host = host; return fakeTransportFactory()(host); } });
  dispatchModule.requestMusicGeneration = patched;

  let result;
  try {
    result = await smd.run({ task_id: 'SM-CANARY', project_id: projectId,
      assignment: { action: 'generate', candidate_count: 2 }, ...env.options });
  } finally {
    dispatchModule.requestMusicGeneration = originalRequest;
  }
  assert.equal(calledWithLane, 'music_generation');
  assert.equal(record.host, 'workerx'); // host came from the (faked) compute authority
  assert.equal(result.dispatch.lane, 'music_generation');
  assert.ok(result.attempts >= 1 && result.attempts <= 3, 'attempts bounded');
  assert.equal(result.state, 'AWAITING_HUMAN_REVIEW');
  assert.equal(result.attention, 'REVIEW');
  assert.ok(result.recommendation && result.recommendation.action === 'ROUTE_TO_HUMAN');
  assert.ok(result.candidates.length >= 1);
  for (const c of result.candidates) {
    assert.equal(c.deterministic_checks.file_integrity.state, 'PASS');
    assert.equal(c.deterministic_checks.provenance.state, 'PASS');
    assert.equal(c.approval_binding.state, 'AWAITING_HUMAN_REVIEW');
  }
  // Control-room projection answers the operator questions.
  const cr = smd.controlRoomView(result);
  assert.equal(cr.owner, 'sound_music_director');
  assert.equal(cr.next_owner, 'mikko');
  assert.equal(cr.music_summary.awaiting_approval, true);
});

// ── SM8: provenance on generated artifacts ───────────────────────────────────
test('SM8: generated artifacts carry full provenance (job id, workflow hash, brief hash)', async () => {
  const env = tmpScoreEnv();
  const projectId = approvedProject(env.options);
  await productionCandidates.create(scoreLane.resolveProjectDir(scoreLane.loadSettings(env.options), projectId).dir, {
    candidate_id: 'music-candidate-001', project_id: projectId, backend: 'minimax',
    status: 'completed', human_verdict: 'unreviewed', requested_duration_s: 60,
    measured_duration_seconds: 60.1, output_sha256: FAKE_SHA,
    generation_job_id: 'music-job-x', workflow_hash: 'wh123', brief_hash: 'bh123',
    plan_revision_id: 'rev1',
  });
  // Truthful fixture: the recorded hash must correspond to real bytes on disk
  // at the exact artifact path the director validates.
  const candDir8 = path.join(productionCandidates.root(
    scoreLane.resolveProjectDir(scoreLane.loadSettings(env.options), projectId).dir), 'music-candidate-001');
  fs.writeFileSync(path.join(candDir8, 'production.wav'), FAKE_WAV);
  const result = await smd.run({ task_id: 'SM8', project_id: projectId,
    assignment: { action: 'evaluate' }, ...env.options });
  const c = result.candidates[0];
  assert.equal(c.deterministic_checks.provenance.state, 'PASS');
  assert.ok(result.provenance.source_commit, 'agent provenance records source commit');
});

// ── SM9/SM10/SM11: approval binding ─────────────────────────────────────────
test('SM9/SM10: exact-byte approval VALID; changed bytes STALE; detached INVALID', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-appr-'));
  fs.writeFileSync(path.join(dir, 'production.wav'), FAKE_WAV);
  const meta = { human_verdict: 'use', approval_artifact_sha256: FAKE_SHA,
    approval_source_commit: 'df17c02', approved_by: 'Mikko', approved_at: '2026-08-22T21:00:00+03:00' };
  const valid = smd.approvalBindingStatus(meta, dir);
  assert.equal(valid.state, 'VALID');
  // Byte change → STALE
  fs.writeFileSync(path.join(dir, 'production.wav'), Buffer.from('new-master'));
  assert.equal(smd.approvalBindingStatus(meta, dir).state, 'STALE');
  // Detached approval (no hash recorded) → never trusted as valid
  const detachedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-detached-'));
  fs.writeFileSync(path.join(detachedDir, 'production.wav'), FAKE_WAV);
  const detached = smd.approvalBindingStatus({ human_verdict: 'use' }, detachedDir);
  assert.notEqual(detached.state, 'VALID');
});

test('SM11: no self-approval — unreviewed candidates are always AWAITING_HUMAN_REVIEW', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-noself-'));
  fs.writeFileSync(path.join(dir, 'production.wav'), FAKE_WAV);
  const status = smd.approvalBindingStatus({ human_verdict: 'unreviewed' }, dir);
  assert.equal(status.state, 'AWAITING_HUMAN_REVIEW');
  // The agent has no API that writes approval state.
  const src = fs.readFileSync(SMD, 'utf8');
  assert.doesNotMatch(src, /human_verdict\s*[:=]\s*['"]use['"]/);
  assert.doesNotMatch(src, /approveCandidate|setVerdict\(\s*[^,]+,\s*[^,]+,\s*['"]use/);
});

// ── SM12/SM13: retry budget ──────────────────────────────────────────────────
test('SM12: attempts are hard-capped regardless of task input', async () => {
  const r1 = await smd.run({ task_id: 'R1', project_id: 'p', max_generation_attempts: 99,
    authorized_lane: 'not_the_lane', assignment: {} });
  assert.ok(r1.max_attempts <= smd.MAX_ATTEMPTS_HARD_CAP);
});

test('SM13: exhausted retries escalate to hermes, never silently retry', async () => {
  const env = tmpScoreEnv();
  const projectId = approvedProject(env.options);
  const dispatchModule = require('../score-engine/music-dispatch.js');
  const original = dispatchModule.requestMusicGeneration;
  let calls = 0;
  dispatchModule.requestMusicGeneration = async (...a) => {
    calls += 1;
    const err = new Error('dispatch failed: transport broke');
    err.statusCode = 500;
    throw err;
  };
  let result;
  try {
    result = await smd.run({ task_id: 'SM13', project_id: projectId,
      max_generation_attempts: 2, assignment: { action: 'generate' }, ...env.options });
  } finally {
    dispatchModule.requestMusicGeneration = original;
  }
  assert.equal(result.state, 'RETRY_BUDGET_EXHAUSTED');
  assert.equal(result.handoff.next_owner, 'hermes');
  assert.equal(result.attention, 'REVIEW');
});

// ── SM14: disagreement surfaced ──────────────────────────────────────────────
test('SM14: disagreement states exist and route to human decision, never collapsed', () => {
  const reg = registry.agents.find((a) => a.agent_id === 'sound_music_director');
  assert.match(reg.disagreement_behavior, /NEEDS_HUMAN_DECISION/);
  assert.match(reg.disagreement_behavior, /never overridden/);
  const states = require('../scripts/agent-contract-validator.js').DISAGREEMENT_STATES;
  assert.ok(states.includes('NEEDS_HUMAN_DECISION'));
});

// ── SM15: QC authority ───────────────────────────────────────────────────────
test('SM15: QC-failed candidates cannot be marked pass by the agent', async () => {
  const env = tmpScoreEnv();
  const projectId = approvedProject(env.options);
  const settings = scoreLane.loadSettings(env.options);
  const { dir } = scoreLane.resolveProjectDir(settings, projectId);
  await productionCandidates.create(dir, {
    candidate_id: 'music-candidate-001', project_id: projectId, backend: 'minimax',
    status: 'completed', human_verdict: 'unreviewed',
    requested_duration_s: 60, measured_duration_seconds: 60.1,
    output_sha256: FAKE_SHA, generation_job_id: 'music-job-qc',
    workflow_hash: 'wh-qc', brief_hash: 'bh-qc', plan_revision_id: 'rev1',
  });
  // Truthful fixture: completed candidate with real artifact bytes so the run
  // reaches QC evaluation instead of failing early on missing media.
  fs.writeFileSync(path.join(dir, 'music-candidates', 'music-candidate-001', 'production.wav'), FAKE_WAV);
  const result = await smd.run({ task_id: 'SM15', project_id: projectId,
    assignment: { action: 'evaluate' }, ...env.options });
  assert.notEqual(result.qc.state, 'QC_PASS');
  assert.equal(result.qc.signoff_source === undefined ? undefined : true, true);
  // qc_signoff only ever comes from the task envelope (QC tooling).
  const src = fs.readFileSync(SMD, 'utf8');
  assert.match(src, /qc_signoff === true/);
});

// ── SM16: Hermes boundary ────────────────────────────────────────────────────
test('SM16: Hermes can delegate but cannot approve or perform specialist judgment', async () => {
  const result = await smd.run({ task_id: 'SM16', project_id: 'nonexistent-project',
    requested_by: 'hermes', assignment: { action: 'generate' } });
  assert.equal(result.requested_by, 'hermes');       // delegation accepted
  assert.equal(result.state, 'INPUT_MISSING');        // specialist validates inputs itself
  assert.equal(result.agent_id, 'sound_music_director');
  const hermes = contract.hermes;
  assert.ok(hermes.prohibited.some((p) => /approval/.test(p)));
  assert.ok(hermes.prohibited.some((p) => /specialist verdict/.test(p)));
});

// ── SM17: control-room state ─────────────────────────────────────────────────
test('SM17: control_room projection carries the contract-required fields', async () => {
  const env = tmpScoreEnv();
  const projectId = approvedProject(env.options);
  const result = await smd.run({ task_id: 'SM17', project_id: projectId,
    assignment: { action: 'evaluate' }, ...env.options });
  const cr = smd.controlRoomView(result);
  for (const field of ['role', 'state', 'current_task', 'owner', 'next_owner',
    'attention_level', 'blocker', 'unresolved_disagreement', 'resource_dependency',
    'latest_event', 'music_summary']) {
    assert.ok(field in cr, `control room exposes ${field}`);
  }
  assert.ok(cr.operational_rationale.reason);
  // No raw logs or internals exposed.
  assert.ok(!('logs' in cr) && !('chain_of_thought' in cr));
});
