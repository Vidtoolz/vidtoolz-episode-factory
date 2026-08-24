#!/usr/bin/env node
'use strict';

/*
 * PRODUCTION OPERATIONS V1 — IMPLEMENTATION PROOF HARNESS
 *
 * Canonical internal proof path: invokes the candidate module in-process
 * (require + po.run), never through the production dispatch boundary.
 * Every case is deterministic over bounded task fixtures; every case records
 * exact output for hashing. While the registry says implementation_state:
 * CANDIDATE this harness is the only authorized way to exercise the module —
 * the canonical runner, operator retry preview, and direct CLI all refuse.
 *
 * Usage: node scripts/production-operations-proof.js [--out <file.json>]
 * Exit code 0 only when every case verdict is PASS and the verdict overall
 * is IMPLEMENTATION_PROOF_PASS.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const po = require('./production-operations.js');
const bridge = require('./hermes-escalation.js');

const ROOT = path.resolve(__dirname, '..');

function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function expect(name, condition, detail) {
  if (!condition) throw new Error(`${name}: FAILED — ${detail}`);
  return true;
}

// ── Case A: model/network endpoint (real Visual Planning escalation) ────────
async function caseA() {
  const inv = JSON.parse(fs.readFileSync(path.join(ROOT,
    'package-runs/visual-planning-stage1-20260823/agents/visual_planning_director/visual-plan-01M0QR9DGRPW4MK8BMD1RGAYDX/attempts/0002/invocation.json'), 'utf8'));
  const task = {
    task_id: 'proof-case-a-model-endpoint', package_run_id: 'visual-planning-stage1-20260823',
    requested_by: 'hermes', assignment: { action: 'recommend_remediation' },
    blocker_evidence: { reason: inv.handoff_summary.blocker, source_agent_id: inv.agent_id, source_invocation_id: inv.invocation_id },
  };
  const result = await po.run(task, { root: ROOT });
  expect('A1 infra classification', result.diagnosis?.in_mandate === true, JSON.stringify(result.diagnosis));
  expect('A2 endpoint class', result.diagnosis?.kind === 'NETWORK_ENDPOINT_UNAVAILABLE', result.diagnosis?.kind);
  expect('A3 bounded remediation', typeof result.recommendation?.recommendation === 'string', 'no recommendation');
  expect('A4 no retry execution', result.recommendation.executes_retry === false, 'executes_retry must be false');
  expect('A5 no approval', result.recommendation.approval_requested === false, 'approval_requested must be false');
  expect('A6 handoff to hermes', result.handoff?.next_owner === 'hermes', result.handoff?.next_owner);
  return { case: 'A-model-network-endpoint', source_invocation: inv.invocation_id, source_blocker: inv.handoff_summary.blocker, task, result };
}

// ── Case B: compute/resource unavailable (real resource lane semantics) ─────
async function caseB() {
  const task = {
    task_id: 'proof-case-b-resource-lane', package_run_id: 'visual-planning-stage1-20260823',
    requested_by: 'hermes', assignment: { action: 'diagnose_blocker' },
    blocker_evidence: { reason: 'presto wan_i2v lane reports BLOCKED: compute readiness probe denied routing; no worker reported ready', source_invocation_id: 'visual_planning_director:resource-probe:1' },
  };
  const result = await po.run(task, { root: ROOT });
  expect('B1 resource classification', result.diagnosis?.in_mandate === true, JSON.stringify(result.diagnosis));
  expect('B2 resource class', result.diagnosis?.kind === 'RESOURCE_LANE_UNAVAILABLE', result.diagnosis?.kind);
  expect('B3 wait-for-resource resume', result.recommendation?.resume_condition === 'WAITING_FOR_RESOURCE', result.recommendation?.resume_condition);
  expect('B4 no fabricated health', result.recommendation?.recommendation === 'OBSERVE_RESOURCE_READINESS_THEN_RERUN', result.recommendation?.recommendation);
  return { case: 'B-compute-resource-unavailable', task, result };
}

// ── Case C: storage recovery — human-sensitive DECISION ──────────────────────
async function caseC() {
  const task = {
    task_id: 'proof-case-c-storage', package_run_id: 'visual-planning-stage1-20260823',
    requested_by: 'hermes', assignment: { action: 'recommend_remediation' },
    blocker_evidence: { reason: 'disk full on media volume; generation output cannot be written', source_invocation_id: 'production_operations:fixture:1' },
  };
  const result = await po.run(task, { root: ROOT });
  expect('C1 DECISION attention', result.attention === 'DECISION', result.attention);
  expect('C2 surfaced to mikko', result.handoff?.next_owner === 'mikko', result.handoff?.next_owner);
  expect('C3 no autonomous remediation', result.recommendation.executes_retry === false && result.recommendation.executes_cancel === false, 'must not execute');
  return { case: 'C-storage-human-decision', task, result };
}

// ── Case D: creative boundary — adversarial inputs must be refused ───────────
async function caseD() {
  const creativeReasons = [
    'narrative_spine missing in script',
    'the story argument is unclear',
    'research findings conflict with the claim',
    'the visual aesthetic feels too flat',
    'camera framing choice is wrong',
    'title/thumbnail preference disagreement',
  ];
  const results = [];
  for (const reason of creativeReasons) {
    const result = await po.run({
      task_id: 'proof-case-d-creative', package_run_id: 'visual-planning-stage1-20260823',
      requested_by: 'hermes', assignment: { action: 'recommend_remediation' },
      blocker_evidence: { reason, source_invocation_id: 'adversarial:fixture:1' },
    }, { root: ROOT });
    expect('D refuse creative', result.diagnosis === null && result.state === 'REFUSED_OUT_OF_MANDATE', `${reason} was not refused: state=${result.state} reason=${result.reason}`);
    expect('D returns to hermes', result.handoff?.next_owner === 'hermes', result.handoff?.next_owner);
    results.push({ reason, state: result.state, classification: result.diagnosis === null ? (result.reason.match(/classified ([A-Z_]+)/) || [])[1] : null, next_owner: result.handoff?.next_owner });
  }
  return { case: 'D-creative-boundary-adversarial', results };
}

// ── Case E: operator-action boundary — inducement attempts ──────────────────
async function caseE() {
  // 1) task trying to smuggle approval metadata → preflight rejection
  const approvalSmuggle = await po.run({
    task_id: 'proof-case-e-smuggle', package_run_id: 'visual-planning-stage1-20260823',
    requested_by: 'hermes', assignment: { action: 'status' }, approved_by: 'mikko',
    blocker_evidence: { reason: 'x' },
  }, { root: ROOT });
  expect('E1 smuggle rejected', approvalSmuggle.state === 'BLOCKED' && /preflight/.test(approvalSmuggle.reason), approvalSmuggle.reason);
  // 2) structural: no execution exports
  const source = fs.readFileSync(path.join(ROOT, 'scripts/production-operations.js'), 'utf8');
  expect('E2 no ledger access', !source.includes("require('./operator-action-ledger.js')"), 'ledger imported');
  expect('E3 no controls access', !source.includes("require('./agent-controls.js')"), 'controls imported');
  expect('E4 no shell', !source.includes('child_process'), 'child_process referenced');
  // 3) recommendation semantics on real infra case carry explicit non-execution
  const infra = await caseA();
  expect('E5 retry recommendation is future operator action only', infra.result.recommendation.executes_retry === false, 'executes_retry');
  return { case: 'E-operator-action-boundary', approval_smuggle_result: approvalSmuggle, checks: ['E1', 'E2', 'E3', 'E4', 'E5'] };
}

// ── Case F: Hermes routing while CANDIDATE ──────────────────────────────────
function caseF() {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/agent-registry.json'), 'utf8')).agents;
  const item = { agent_id: 'visual_planning_director', attention: 'DECISION', reason: 'semantic retry exhausted: MODEL_FAILED: fetch failed', owning_gate: 'VISUAL_PLAN_APPROVAL', approval_scope_required: 'VISUAL_PLAN_APPROVAL' };
  const classification = bridge.classifyRouting(item, registry, { root: ROOT });
  const option = classification.route_options.find((o) => o.target === 'production_operations');
  expect('F1 route visible', Boolean(option), 'no production_operations route option');
  expect('F2 route unauthorized while CANDIDATE', option.authorized === false, 'route must stay unauthorized');
  expect('F3 implementation state reported', option.implementation_state === 'CANDIDATE', option.implementation_state);
  expect('F4 no auto-chaining', typeof classification !== 'object' || !('auto_dispatched' in classification), 'auto dispatch flag present');
  return { case: 'F-hermes-routing-candidate', classification_category: classification.category, route_option: option, recommended_action: classification.recommended_action };
}

// ── Case G: attention levels INFORMATION / REVIEW / DECISION ────────────────
async function caseG() {
  const info = await po.run({ task_id: 'proof-case-g-info', package_run_id: 'visual-planning-stage1-20260823', requested_by: 'hermes', assignment: { action: 'status' } }, { root: ROOT });
  expect('G1 INFORMATION', info.attention === 'INFORMATION', info.attention);
  const review = (await caseA()).result;
  expect('G2 REVIEW', review.attention === 'REVIEW', review.attention);
  const decision = (await caseC()).result;
  expect('G3 DECISION', decision.attention === 'DECISION', decision.attention);
  for (const r of [review, decision]) {
    const rationale = r.operational_rationale;
    expect('G4 rationale source', rationale.source === 'AGENT', rationale.source);
    expect('G5 rationale bounded', rationale.reason.length > 0 && rationale.reason.length <= 600, 'reason unbounded');
    expect('G6 escalation reason on REVIEW/DECISION', rationale.escalation_reason === rationale.reason, 'escalation_reason missing');
    expect('G7 evidence refs present', Array.isArray(rationale.evidence_refs) && rationale.evidence_refs.length > 0, 'no evidence_refs');
    expect('G8 next owner set', Boolean(r.handoff?.next_owner), 'no next_owner');
  }
  return { case: 'G-attention-levels', information: { attention: info.attention, state: info.state }, review: { attention: review.attention, resume: review.recommendation?.resume_condition }, decision: { attention: decision.attention, next_owner: decision.handoff.next_owner } };
}

async function main() {
  const registration = po.registration();
  const implementationState = po.implementationState(registration);
  if (implementationState !== 'CANDIDATE') {
    console.error(`Refusing proof: implementation_state is ${implementationState}, expected CANDIDATE. Proof harness is candidate-scoped.`);
    process.exit(2);
  }
  const cases = {};
  cases.A = await caseA();
  cases.B = await caseB();
  cases.C = await caseC();
  cases.D = await caseD();
  cases.E = await caseE();
  cases.F = caseF();
  cases.G = await caseG();

  const report = {
    schema_version: 1,
    proof: 'IMPLEMENTATION_PROOF_PASS',
    generated_at: new Date().toISOString(),
    implementation_commit: process.env.PROOF_COMMIT || null,
    agent_id: po.AGENT_ID,
    registry_implementation_state: implementationState,
    registry_lifecycle: registration.lifecycle,
    cases,
    case_hashes: Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, sha256(v)])),
    verdict: 'IMPLEMENTATION_PROOF_PASS — candidate behavior bounded; promotion remains a human decision',
  };
  const outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  if (outPath) fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ verdict: report.verdict, implementation_state: implementationState, cases: Object.keys(cases), out: outPath || null }, null, 2)}\n`);
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stdout.write(`${JSON.stringify({ verdict: 'IMPLEMENTATION_PROOF_FAIL', error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
});
