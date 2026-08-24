'use strict';

const { assert, fs, test } = require('./_helpers.js');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// EARTH STUDIO HERMES AGENT PILOT.
//
// Verifies: registry identity, authority boundaries, the shared status
// contract, and the three DIRN17 organizational canaries. Read-only against
// canonical evidence; scratch copies for mutation scenarios.

const REPO = path.join(__dirname, '..');
const REGISTRY = path.join(REPO, 'config', 'agent-registry.json');
const STATUS = path.join(REPO, 'scripts', 'earth-studio-agent-status.js');
const PROMOTE = path.join(REPO, 'scripts', 'earth-studio-promote.js');
const SRC_PKG = path.join(REPO, 'package-runs', '2026-08-22-earth-studio-orbit-travel-promotion');
const APPROVAL_SRC = path.join(REPO, 'package-runs',
  '2026-08-21-earth-studio-orbit-travel-handoff', 'human-review.json');
const DURABLE_COMMIT = '2586bc491377d1a3c8d584a10ac9be427cd24e2f';
const PRE_COMMIT = 'ff43a625102b1a6ffec659cce44afcf057fab0f0';
const os = require('node:os');
const EARTH_STUDIO_PILOTS = Object.freeze({
  camera_director: 'Camera Director',
  generation_supervisor: 'Generation Supervisor',
  production_operations: 'Production Operations Director',
  qc_director: 'QC Director',
});

function assertEarthStudioPilotRegistry(registry) {
  const agents = Array.isArray(registry?.agents) ? registry.agents : [];
  const ids = agents.map((agent) => agent.agent_id);
  assert.equal(new Set(ids).size, ids.length, 'global registry agent IDs must remain unique');
  const byId = Object.fromEntries(agents.map((agent) => [agent.agent_id, agent]));
  for (const [agentId, expectedName] of Object.entries(EARTH_STUDIO_PILOTS)) {
    const agent = byId[agentId];
    assert.ok(agent, `Earth Studio pilot agent missing from global registry: ${agentId}`);
    assert.equal(agent.agent_id, agentId);
    assert.equal(agent.name, expectedName);
    assert.equal(agent.reports_to, 'hermes');
    assert.ok(agent.mission);
    assert.ok(Array.isArray(agent.allowed_actions) && agent.allowed_actions.length > 0);
    assert.ok(Array.isArray(agent.prohibited_actions) && agent.prohibited_actions.length > 0);
  }
}

function runNode(script, args) {
  try {
    return { code: 0, out: JSON.parse(execFileSync('node', [script, ...args],
      { cwd: REPO, encoding: 'utf8', timeout: 300000 })) };
  } catch (e) {
    let out = null; try { out = e.stdout ? JSON.parse(e.stdout) : null; } catch {}
    return { code: e.status === undefined ? -1 : e.status, out };
  }
}

function scratch(withApproval, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-agent-test-'));
  execFileSync('cp', ['-r', `${SRC_PKG}/.`, `${dir}/`]);
  if (withApproval) fs.copyFileSync(APPROVAL_SRC, path.join(dir, 'human-review.json'));
  if (mutate) mutate(dir);
  return dir;
}

function agentView(pkgDir, sourceCommit) {
  return runNode(STATUS, ['--package', pkgDir,
    ...(sourceCommit ? ['--source-commit', sourceCommit] : [])]);
}

test('A1: Earth Studio pilot identities remain present and defined as the global registry grows', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  assertEarthStudioPilotRegistry(reg);
});

test('A1b: removing an Earth Studio pilot still fails the registry invariant', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  reg.agents = reg.agents.filter((agent) => agent.agent_id !== 'camera_director');
  assert.throws(() => assertEarthStudioPilotRegistry(reg), /camera_director/);
});

test('A2: authority boundaries are explicit and machine-readable', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const byId = Object.fromEntries(reg.agents.map((a) => [a.agent_id, a]));
  // Camera Director must not declare approval or write promotion state
  assert.ok(byId.camera_director.prohibited_actions.some((p) => /approval|promotion state/.test(p)));
  // QC must not fabricate human approval or convert DURABLE_NOT_APPROVED
  assert.ok(byId.qc_director.prohibited_actions.some((p) => /human approval/i.test(p)));
  assert.ok(byId.qc_director.prohibited_actions.some((p) => /DURABLE_NOT_APPROVED/.test(p)));
  // Production Operations must not mark PROMOTED independently
  assert.ok(byId.production_operations.prohibited_actions.some((p) => /PROMOTED/.test(p)));
  // No agent may publish
  for (const a of reg.agents) {
    if (!a.prohibited_actions.some((p) => /publish/i.test(p))) {
      throw new Error(`${a.agent_id} lacks an explicit publish prohibition`);
    }
  }
});

test('A3/A4: DIRN17 positive — all three views correct, INFORMATION, no human needed', () => {
  const dir = scratch(true);
  const r = agentView(dir, DURABLE_COMMIT);
  assert.equal(r.code, 0);
  const v = r.out;
  assert.equal(v.promotion_status, 'PROMOTED');
  assert.equal(v.agents.qc_director.state, 'PASS');
  assert.equal(v.agents.qc_director.durability, 'DURABLE');
  assert.equal(v.agents.production_operations.state, 'COMPLETE');
  assert.equal(v.hermes.attention, 'INFORMATION');
  assert.equal(v.needs_human, false);
  assert.equal(v.canonical_truth.includes('promotion'), true);
});

test('A5: DIRN17 historical negative — QC FAIL, remediation routed, no false promotion', () => {
  const dir = scratch(true);
  const r = agentView(dir, PRE_COMMIT);
  assert.equal(r.out.promotion_status, 'APPROVED_NOT_DURABLE');
  assert.equal(r.out.agents.qc_director.verdict, 'FAIL');
  assert.equal(r.out.agents.qc_director.state, 'TECHNICAL_QC_FAILED');
  assert.equal(r.out.agents.production_operations.state, 'BLOCKED_BY_DURABILITY');
  assert.equal(r.out.agents.production_operations.next_owner, 'production_operations');
  assert.equal(r.out.hermes.needs_human, false); // mechanical remediation
  assert.notEqual(r.out.promotion_status, 'PROMOTED');
});

test('A6: durable-but-unapproved — DECISION attention, Mikko is next owner, no self-approval', () => {
  const dir = scratch(false);
  const r = agentView(dir, DURABLE_COMMIT);
  assert.equal(r.out.promotion_status, 'DURABLE_NOT_APPROVED');
  assert.equal(r.out.agents.qc_director.state, 'PASS');
  assert.equal(r.out.agents.qc_director.note.includes('approval outstanding'), true);
  assert.equal(r.out.agents.production_operations.state, 'WAITING_FOR_HUMAN');
  assert.equal(r.out.agents.production_operations.next_owner, 'mikko');
  assert.equal(r.out.hermes.attention, 'DECISION');
  assert.equal(r.out.needs_human, true);
  assert.match(r.out.human_question, /Approve/);
});

test('A7: human rejection stands — no retry, route to new candidate', () => {
  const dir = scratch(true, (d) => {
    const hr = JSON.parse(fs.readFileSync(path.join(d, 'human-review.json'), 'utf8'));
    hr.verdict = 'NONE_GOOD'; hr.operator = 'Mikko';
    fs.writeFileSync(path.join(d, 'human-review.json'), JSON.stringify(hr, null, 2));
  });
  const r = agentView(dir, DURABLE_COMMIT);
  assert.equal(r.out.promotion_status, 'HUMAN_REJECTED');
  assert.equal(r.out.agents.camera_director.state, 'CANDIDATE_REJECTED');
  assert.equal(r.out.agents.camera_director.recommendation, 'NEW_CANDIDATE_REQUIRED');
  assert.equal(r.out.agents.production_operations.remediation_route, 'NEW_CANDIDATE_REQUIRED');
});

test('A8: missing artifact fails closed with owner assigned', () => {
  const dir = scratch(true, (d) => fs.rmSync(path.join(d, 'earth-studio', 'earth-studio.esp')));
  const r = agentView(dir);
  assert.equal(r.out.promotion_status, 'ARTIFACT_MISSING');
  assert.equal(r.out.agents.qc_director.state, 'TECHNICAL_QC_FAILED');
  assert.equal(r.out.agents.production_operations.next_owner, 'production_operations');
});

test('A9: heavy sibling dirt does not contaminate the structured view', () => {
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  assert.ok(porcelain.split('\n').filter(Boolean).length > 50, 'precondition: dirty estate present');
  const dir = scratch(true);
  const r = agentView(dir, DURABLE_COMMIT);
  assert.equal(r.out.promotion_status, 'PROMOTED');
});

test('A11/A12: owner invariant + canonical truth reference in every envelope', () => {
  for (const [commit, withApproval] of [[DURABLE_COMMIT, true], [PRE_COMMIT, true], [DURABLE_COMMIT, false]]) {
    const dir = scratch(withApproval);
    const r = agentView(dir, commit);
    assert.ok(r.out.hermes.current_owner !== undefined);
    assert.ok(['mikko', 'production_operations', 'camera_director', null].includes(r.out.hermes.current_owner));
    assert.match(r.out.canonical_truth, /promotion/);
  }
});
