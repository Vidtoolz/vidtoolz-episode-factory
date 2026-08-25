'use strict';

// ARCHITECTURE INVARIANT — "proven on paper" must never recur.
//
// Three separate missions removed the same defect: the registry claimed a
// production capability the production path did not have. QC Director was BUILT
// in contract with no module. Generation Supervisor was IMPLEMENTATION_PROVEN
// while the canonical runner refused it with RUNNER_AGENT_ID_MISMATCH. Both were
// found by hand, agent by agent.
//
// This suite makes the invariant structural instead. It SCANS THE REGISTRY —
// it never hardcodes an agent list — so a future agent promoted without a
// working runner contract fails here immediately.
//
// It is deliberately cheap: identity and export inspection only, no action is
// ever executed and no task is ever dispatched.

const { assert, fs, path, test } = require('./_helpers.js');
const runner = require('../scripts/agent-run.js');
const dispatchAuthority = require('../scripts/agent-dispatch-authority.js');

const ROOT = path.resolve(__dirname, '..');

function registry() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
}
function provenAgents() {
  return registry().agents.filter((a) => a.implementation_state === 'IMPLEMENTATION_PROVEN');
}

test('AI1: the registry is non-empty and the canonical production agent count is 12', () => {
  const reg = registry();
  assert.equal(reg.agents.length, 12, 'canonical production architecture is exactly 12 registered agents');
  assert.ok(provenAgents().length > 0, 'precondition: at least one agent is marked proven');
  // Knowledge Steward is a non-agent support role and must never appear here.
  assert.equal(reg.agents.some((a) => a.agent_id === 'knowledge_steward'), false);
});

test('AI2: every IMPLEMENTATION_PROVEN agent has a module at the dispatch-derived path', () => {
  for (const agent of provenAgents()) {
    const modulePath = dispatchAuthority.modulePathFor(ROOT, agent.agent_id);
    assert.ok(fs.existsSync(modulePath),
      `${agent.agent_id} is marked proven but has no module at ${path.relative(ROOT, modulePath)}`);
    assert.ok(modulePath.startsWith(path.join(ROOT, 'scripts') + path.sep),
      `${agent.agent_id} module must live under scripts/`);
  }
});

test('AI3: every IMPLEMENTATION_PROVEN agent satisfies the canonical runner identity contract', () => {
  // This is the exact check that caught Generation Supervisor. It runs the real
  // runner resolution, not a reimplementation of it.
  for (const agent of provenAgents()) {
    let resolved;
    try {
      resolved = runner.resolveAgent(ROOT, agent.agent_id);
    } catch (error) {
      assert.fail(`${agent.agent_id} is marked IMPLEMENTATION_PROVEN but the canonical runner refuses it: `
        + `${error.code} — ${error.message}`);
    }
    assert.equal(resolved.registration.agent_id, agent.agent_id);
    const loaded = require(resolved.modulePath);
    assert.equal(loaded.AGENT_ID, agent.agent_id,
      `${agent.agent_id} module must declare its own identity to the runner`);
  }
});

test('AI4: every IMPLEMENTATION_PROVEN agent declares a usable action contract', () => {
  // ACTIONS is optional to the runner (a null list simply disables the gate),
  // which is precisely how sound_music_director went years without one and had
  // no runner-level action refusal at all. For a PROVEN agent it is required:
  // an agent whose action gate is inert cannot refuse an unsupported action
  // before invocation, so the module becomes the only line of defence.
  for (const agent of provenAgents()) {
    const resolved = runner.resolveAgent(ROOT, agent.agent_id);
    assert.ok(Array.isArray(resolved.actions) && resolved.actions.length > 0,
      `${agent.agent_id} is marked proven but exports no ACTIONS, so the runner cannot refuse an unsupported action`);
    for (const action of resolved.actions) {
      assert.equal(typeof action, 'string');
      assert.ok(action.length > 0);
    }
    assert.equal(new Set(resolved.actions).size, resolved.actions.length,
      `${agent.agent_id} declares a duplicate action`);
  }
});

test('AI5: every IMPLEMENTATION_PROVEN agent exposes a callable run surface', () => {
  for (const agent of provenAgents()) {
    const loaded = require(dispatchAuthority.modulePathFor(ROOT, agent.agent_id));
    assert.equal(typeof loaded.run, 'function',
      `${agent.agent_id} must expose run() so the control room can load and inspect it`);
  }
});

test('AI6: every IMPLEMENTATION_PROVEN agent is authorized by dispatch authority', () => {
  for (const agent of provenAgents()) {
    const readiness = dispatchAuthority.implementationReadiness(ROOT, agent);
    assert.equal(readiness.authorized, true,
      `${agent.agent_id} is marked proven but dispatch authority refuses: ${readiness.code} — ${readiness.reason}`);
    assert.equal(readiness.module_exists, true);
    assert.equal(readiness.code, null);
  }
});

test('AI7: a CANDIDATE agent is still refused even when its module exists', () => {
  // The fail-closed direction must keep working: proving the invariant above
  // must never have been achieved by loosening the gate.
  const candidates = registry().agents.filter((a) => a.implementation_state === 'CANDIDATE');
  for (const agent of candidates) {
    const readiness = dispatchAuthority.implementationReadiness(ROOT, agent);
    assert.equal(readiness.authorized, false, `${agent.agent_id} is a candidate and must not be authorized`);
    assert.equal(readiness.code, 'BLOCKED_IMPLEMENTATION_NOT_PROVEN');
    assert.throws(() => runner.resolveAgent(ROOT, agent.agent_id),
      (error) => error.code === 'BLOCKED_IMPLEMENTATION_NOT_PROVEN', agent.agent_id);
  }
});

test('AI8: a lifecycle-disabled role is refused before implementation is considered', () => {
  const disabled = registry().agents.filter((a) => a.lifecycle?.autonomous_dispatch === 'DISABLED');
  for (const agent of disabled) {
    const readiness = dispatchAuthority.implementationReadiness(ROOT, agent);
    assert.equal(readiness.authorized, false);
    assert.equal(readiness.code, 'BLOCKED_AGENT_NOT_ENABLED', agent.agent_id);
  }
});

// ── durable proof evidence (§35): audit warning, not a hard break ──────────

test('AI9: proven agents carry durable proof evidence, or are listed as a known migration debt', () => {
  // Historical architecture does not yet carry proof metadata universally, so
  // this asserts the DEBT LIST is accurate rather than breaking every legacy
  // agent at once. The list may only shrink: adding an agent to it requires
  // editing this test, which is the point.
  const KNOWN_PROOF_DEBT = new Set([
    'editor', 'sound_music_director', 'research_director',
    'story_editor', 'visual_planning_director', 'audience_packaging_director',
  ]);
  const governanceDir = path.join(ROOT, 'governance');
  const governance = fs.existsSync(governanceDir) ? fs.readdirSync(governanceDir) : [];
  const evidenceFor = (id) => {
    const slug = id.replaceAll('_', '-');
    const hasGovernance = governance.some((f) => f.startsWith(slug));
    const runs = fs.readdirSync(path.join(ROOT, 'package-runs'));
    const hasProof = runs.some((r) => r.includes(slug) && /proof/i.test(r));
    return { hasGovernance, hasProof };
  };

  const missing = [];
  for (const agent of provenAgents()) {
    const { hasGovernance, hasProof } = evidenceFor(agent.agent_id);
    if (!hasGovernance && !hasProof) missing.push(agent.agent_id);
  }
  const unexpected = missing.filter((id) => !KNOWN_PROOF_DEBT.has(id));
  assert.deepEqual(unexpected, [],
    `these proven agents have neither a proof package nor a governance record and are not recorded as known debt: ${unexpected.join(', ')}`);

  // The debt list must not rot: everything on it must still actually be in debt
  // and still actually be a proven agent.
  const provenIds = new Set(provenAgents().map((a) => a.agent_id));
  for (const id of KNOWN_PROOF_DEBT) {
    assert.ok(provenIds.has(id), `${id} is recorded as proof debt but is no longer a proven agent — update the list`);
    assert.ok(missing.includes(id), `${id} now HAS durable proof evidence — remove it from KNOWN_PROOF_DEBT`);
  }
});

test('AI10: agents already re-earned through a production-path proof are out of debt', () => {
  // Positive control for AI9: these three carry real durable evidence, so the
  // debt mechanism above is proven to actually discriminate.
  for (const id of ['production_operations', 'qc_director', 'generation_supervisor']) {
    const slug = id.replaceAll('_', '-');
    const governance = fs.readdirSync(path.join(ROOT, 'governance'));
    const runs = fs.readdirSync(path.join(ROOT, 'package-runs'));
    assert.ok(
      governance.some((f) => f.startsWith(slug)) || runs.some((r) => r.includes(slug) && /proof/i.test(r)),
      `${id} must carry durable proof or governance evidence`
    );
  }
});
