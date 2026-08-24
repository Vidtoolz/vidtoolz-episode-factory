'use strict';
// Story Editor — SE1–SE40 + canaries A–F. Semantic inference goes through an
// injected bounded model adapter (REAL ORCHESTRATION CANARY path: real
// production run() with bounded fake adapter; the live local-model path is the
// same adapter contract, exercised separately, not in CI).

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const crypto = require('node:crypto');
const se = require('../scripts/story-editor.js');
const srr = require('../scripts/story-revision-review.js');
const rrv = require('../scripts/research-result-validator.js');
const contract = require('../config/agent-contract.json');
const registry = require('../config/agent-registry.json');

const SB_ROOT = '/home/vidtoolz/vidtoolz-script-builder';
const versions = require(path.join(SB_ROOT, 'lib', 'versions.js'));
const store = require(path.join(SB_ROOT, 'lib', 'store.js'));
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const AS_OF = '2026-08-23T09:00:00+03:00';

function mkEnv() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'se-data-'));
  store.ensureLayout(dataRoot);
  return { dataRoot };
}
function mkResult(over = {}) {
  const text = over.claimText || 'Cloud post-production improves remote access.';
  const r = {
    result_id: `research-result-${crypto.randomUUID()}`, result_revision: 1,
    claim_ref: { namespace: 'vidtoolz-episode-factory/package-run-claim',
      canonical_id: over.claimId || 'claim-00000000-0000-4000-8000-000000000001', revision: 1, alias_ids: [] },
    claim: { evaluated_text: text, evaluated_text_sha256: sha(text),
      temporal: { temporal_class: 'EVERGREEN_FACT' } },
    judgment: { support_status: 'SUPPORTED', freshness_status_at_review: 'NOT_APPLICABLE',
      evidence_quality: 'ADEQUATE', confidence: 'HIGH', independence_status: 'ADEQUATE',
      contradiction_status: 'NONE', disagreement_state: 'NONE',
      recommendation: over.recommendation || 'ALLOW_USE', rationale: 't', unresolved_questions: [] },
    qualification: over.qualification || { qualification_required: false, wording_constraints: [] },
    sources: [{ source_ref: 's1', source_class: 'REPORTING',
      original_source: { source_id: 'o', title: 't', url: 'https://x', publisher: 'p' },
      container: { container_type: 'local_file', relationship_to_original: 'IS_ORIGINAL',
        source_id: 'src_local_s1', title: 't', retrieved_at: '2026-01-01T00:00:00Z',
        retrieved_content_sha256: sha('c') },
      independence_group: 'g1', independence_basis: 't' }],
    evidence: [{ evidence_id: 'e1', source_ref: 's1', stance: 'SUPPORTS',
      excerpt: { exact_text: 'supports', exact_text_sha256: sha('supports') } }],
    derived: { independent_support_count: 1 },
    provenance: { provenance_inputs: [{ system: 't', type: 'u', record_id: 'r', sha256: rrv.sha256('y') }] },
    lifecycle: { created_at: '2026-01-01T00:00:00Z', reviewed_at: '2026-01-01T00:00:00Z' },
  };
  Object.assign(r, over.assign || {});
  return r;
}
function mkRoot(results) {
  const root = { schema_version: 1, artifact_type: 'research-results', package_run_id: 'run-x', results };
  for (const r of results) r.result_digest_sha256 = rrv.computeResultDigest(root, r);
  return root;
}
function mkRunDir(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-run-'));
  fs.writeFileSync(path.join(dir, 'research-results.json'), JSON.stringify(root));
  return dir;
}
function mkBinding(result, over = {}) {
  const assertion = over.assertion || 'Cloud post-production improves remote access.';
  return {
    binding_id: over.binding_id || `script-claim-${crypto.randomUUID()}`,
    section_id: over.section_id || 1,
    assertion_text: assertion,
    assertion_text_sha256: sha(assertion),
    claim_ref: result.claim_ref,
    research_result_ref: { package_run_id: 'run-x', result_id: result.result_id,
      result_revision: result.result_revision, result_digest_sha256: result.result_digest_sha256 },
    satisfied_constraint_ids: over.satisfied_constraint_ids ?? ((result.qualification || {}).wording_constraints || []).map((c) => c.constraint_id),
  };
}
const SECTIONS = [
  { id: 'section-hook', order: 1, type: 'dialogue', beat: 'hook', dialogue: 'Cloud post-production improves remote access. But here is the catch.' },
  { id: 'section-problem', order: 2, type: 'dialogue', beat: 'problem', dialogue: 'Cloud post-production improves remote access. High-resolution media adds latency.' },
  { id: 'section-payoff', order: 3, type: 'dialogue', beat: 'payoff', dialogue: 'So local-first workflows keep the advantage where it matters.' },
];
function mkTask(env, over = {}) {
  const project = { id: 'p1', slug: 'story', title: 'Story test' };
  const version = versions.createVersion(env.dataRoot, project, over.sections || SECTIONS,
    { wpm: { value: 130, calibrated: false } },
    { central_claim: over.claim || 'Local beats cloud where it matters.',
      narrative_spine: over.spine || 'failure-investigation-principle-generalization' });
  return {
    task_id: over.taskId || 'se-test', project_id: 'p1', package_run_id: 'run-x',
    requested_by: over.requestedBy || 'hermes',
    assignment: { action: over.action || 'review_script', editorial_goal: over.goal, controversial_change: over.controversial },
    script_version_id: version.id, script_content_hash: version.content_hash,
    script_sections: version.sections,
    central_claim: version.central_claim,
    narrative_spine: version.narrative_spine,
    script_claim_bindings: over.bindings || [],
    research_result_refs: (over.bindings || []).map((binding) => binding.research_result_ref),
    research: over.research,
    data_root: env.dataRoot, script_builder_root: SB_ROOT,
    risk_level: over.risk || 'LOCAL_AUTO', retry_budget: over.budget,
    cost_budget: over.costBudget || { max_model_calls: 3 }, deadline: over.deadline || '2099-01-01T00:00:00Z',
    privacy: over.privacy || { local_only: true },
    _version: version,
  };
}
function semanticOut(over = {}) {
  const bindingIds = over.bindingIds || [];
  return {
    structural_findings: over.findings || [{ finding_id: 'finding-repetition', section_ids: ['section-problem'], category: 'SEMANTIC_REPETITION', severity: 'MEDIUM',
      rationale: 'The problem section repeats the opening claim before advancing it.', recommended_action: 'Compress the repeated setup into one causal step.' }],
    spine_coherence: over.spineCoherence || 'COHERENT',
    spine_coherence_rationale: over.spineRationale || 'The failure-to-principle progression remains coherent.',
    argument_change_risk: over.argRisk || 'NO_ARGUMENT_CHANGE',
    argument_change_rationale: over.argRationale || 'The proposed structure preserves the thesis, causal chain, and conclusion.',
    research_concerns: [],
    authority_escalations: over.authorityEscalations || [],
    recommendation: over.recommendation || 'REVISION_RECOMMENDED',
    revision_proposal: over.proposal === undefined ? {
      sections: [
        { id: 'section-hook', order: 1, beat: 'hook', dialogue: 'Cloud post-production improves remote access. But here is the catch.' },
        { id: 'section-problem', order: 2, beat: 'problem', dialogue: 'High-resolution media adds latency on cloud paths.' },
        { id: 'section-payoff', order: 3, beat: 'payoff', dialogue: 'So local-first workflows keep the advantage where it matters.' },
      ],
      change_rationales: [{ change_id: 'change-repetition', section_id: 'section-problem', rationale: 'Remove the repeated hook while retaining the supported latency claim.', intended_effect: 'Advance the causal argument without repetition.', finding_ref: 'finding-repetition', argument_impact: 'NO_ARGUMENT_CHANGE', research_impact: 'NONE' }],
      factual_claim_changes: { unchanged: bindingIds, rewritten: [], new: [], removed: [] },
    } : over.proposal,
  };
}
function semanticFor(task, over = {}) {
  const value = semanticOut({ ...over, bindingIds: (task.script_claim_bindings || []).map((binding) => binding.binding_id) });
  if (task.assignment.action === 'review_script' && over.proposal === undefined) value.revision_proposal = null;
  return value;
}
function adapter(out) { return async () => JSON.stringify(out); }
function fakeRoute() { return { ok: true, decision: 'ROUTE', lane: 'large_text', selected_host: 'test-host', endpoint: 'http://test', model: 'test-model', model_source: 'injected' }; }

// ── SE1–SE3 registration/authority ───────────────────────────────────────────
test('SE1: story_editor registered in contract and registry', () => {
  const role = contract.role_roster.find((r) => r.role_id === 'story_editor');
  assert.equal(role.status, 'BUILT');
  const agent = registry.agents.find((a) => a.agent_id === 'story_editor');
  assert.ok(agent);
});

test('SE2: Story owns narrative structure/coherence/logic', () => {
  const role = contract.role_roster.find((r) => r.role_id === 'story_editor');
  for (const owned of ['script structure', 'argument coherence', 'story logic']) {
    assert.ok(role.owns.includes(owned), owned);
  }
});

test('SE3: Story cannot own final script/argument authority', () => {
  const role = contract.role_roster.find((r) => r.role_id === 'story_editor');
  assert.ok(role.does_not_own.some((d) => /final argument|script authority/.test(d)));
});

// ── SE4–SE6 preflight/review/revision ────────────────────────────────────────
test('SE4: invalid version/hash blocks before model', async () => {
  const env = mkEnv(); const task = mkTask(env);
  task.script_content_hash = sha('wrong');
  const calls = [];
  const out = await se.run(task, { modelAdapter: () => { calls.push(1); return Promise.resolve('{}'); }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED');
  assert.equal(calls.length, 0);
});

test('SE5: review action produces structural findings without candidate', async () => {
  const env = mkEnv(); const task = mkTask(env);
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(out.state, 'COMPLETE');
  assert.ok(out.structural_findings.length >= 1);
  assert.equal(out.candidate_version_id, null);
});

test('SE6: revision creates candidate Script Builder version', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.ok(out.candidate_version_id, JSON.stringify(out.reason));
  const cand = versions.loadVersion(env.dataRoot, 'p1', out.candidate_version_id);
  assert.ok(cand);
});

// ── SE7–SE10 version discipline ──────────────────────────────────────────────
test('SE7: source version unchanged after revision', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const before = JSON.stringify(versions.loadVersion(env.dataRoot, 'p1', task.script_version_id));
  await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(JSON.stringify(versions.loadVersion(env.dataRoot, 'p1', task.script_version_id)), before);
});

test('SE8: candidate parent linkage exact', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  const cand = versions.loadVersion(env.dataRoot, 'p1', out.candidate_version_id);
  assert.equal(cand.parent_version, task.script_version_id);
});

test('SE9: per-change rationales required — missing rationale fails validation', () => {
  const bad = semanticOut(); bad.revision_proposal.change_rationales = [{ change_id: 'c1' }];
  assert.ok(se.validateSemanticOutput(bad, {}).errs.length > 0);
});

test('SE10: SRR bundle generated on candidate', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.ok(out.review_bundle && out.review_bundle.diff_summary);
});

// ── SE11–SE16 research binding behavior ──────────────────────────────────────
test('SE11: clean revision preserves bindings → AWAITING_HUMAN_REVIEW', async () => {
  const env = mkEnv();
  const result = mkRoot([mkResult()]).results[0];
  const b = mkBinding(result);
  const task = mkTask(env, { action: 'revise_script', bindings: [b],
    research: { run_dir: mkRunDir(mkRoot([result])), asOf: AS_OF } });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(out.state, 'AWAITING_HUMAN_REVIEW', JSON.stringify(out.reason));
  assert.equal(out.research_impact.invalidated.length, 0);
});

test('SE12: qualifier constraint preserved in candidate', async () => {
  const env = mkEnv();
  const result = mkRoot([mkResult({ qualification: { qualification_required: true,
    wording_constraints: [{ constraint_id: 'q-abs', type: 'FORBID_ABSOLUTE', instruction: 'no absolutes' }] },
    recommendation: 'ALLOW_USE_WITH_QUALIFICATION' })]).results[0];
  const b = mkBinding(result);
  const task = mkTask(env, { action: 'revise_script', bindings: [b],
    research: { run_dir: mkRunDir(mkRoot([result])), asOf: AS_OF } });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(out.state, 'AWAITING_HUMAN_REVIEW', JSON.stringify(out.reason));
});

test('SE13: constraint violation cannot complete', async () => {
  const env = mkEnv();
  const result = mkRoot([mkResult({ qualification: { qualification_required: true,
    wording_constraints: [{ constraint_id: 'q-abs', type: 'FORBID_ABSOLUTE', instruction: 'no absolutes' }] },
    recommendation: 'ALLOW_USE_WITH_QUALIFICATION' })]).results[0];
  const b = mkBinding(result, { satisfied_constraint_ids: [] });
  const task = mkTask(env, { action: 'revise_script', bindings: [b],
    research: { run_dir: mkRunDir(mkRoot([result])), asOf: AS_OF } });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.notEqual(out.state, 'AWAITING_HUMAN_REVIEW');
});

test('SE14: new factual claim → RETURN_TO_RESEARCH, no candidate', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const bad = semanticFor(task); bad.revision_proposal.factual_claim_changes.new = [{ claim_id: 'new-stat', section_id: 'section-problem', assertion_text: 'In 2024, 80% of editors moved to cloud.', rationale: 'Adds a quantitative adoption example.' }];
  const out = await se.run(task, { modelAdapter: adapter(bad), routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
  assert.equal(out.candidate_version_id, null);
});

test('SE15: factual scope change → RETURN_TO_RESEARCH', async () => {
  const env = mkEnv();
  const result = mkRoot([mkResult()]).results[0];
  const b = mkBinding(result);
  const task = mkTask(env, { action: 'revise_script', bindings: [b],
    research: { run_dir: mkRunDir(mkRoot([result])), asOf: AS_OF } });
  const broad = semanticFor(task);
  broad.revision_proposal.sections[0].dialogue = 'Cloud post-production transforms ALL remote work forever.';
  broad.revision_proposal.change_rationales.push({ change_id: 'change-scope', section_id: 'section-hook', rationale: 'Broaden the opening claim.', intended_effect: 'Make the hook more forceful.', finding_ref: 'finding-repetition', argument_impact: 'POTENTIAL_ARGUMENT_CHANGE', research_impact: 'REWRITTEN' });
  broad.revision_proposal.factual_claim_changes.unchanged = [];
  broad.revision_proposal.factual_claim_changes.rewritten = [b.binding_id];
  const out = await se.run(task, { modelAdapter: adapter(broad), routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_RESEARCH', JSON.stringify(out.reason));
});

test('SE16: factual deletion removes binding cleanly', async () => {
  const env = mkEnv();
  const result = mkRoot([mkResult()]).results[0];
  const b = mkBinding(result);
  const task = mkTask(env, { action: 'revise_script', bindings: [b],
    research: { run_dir: mkRunDir(mkRoot([result])), asOf: AS_OF } });
  const del = semanticFor(task);
  del.revision_proposal.factual_claim_changes.removed = [b.binding_id];
  del.revision_proposal.factual_claim_changes.unchanged = [];
  del.revision_proposal.sections[0].dialogue = 'Here is the catch with cloud workflows.';
  del.revision_proposal.sections[1].dialogue = 'High-resolution media adds latency.';
  del.revision_proposal.change_rationales.push({ change_id: 'change-remove-fact', section_id: 'section-hook', rationale: 'Delete the unnecessary duplicated factual assertion.', intended_effect: 'Open directly on the tension.', finding_ref: 'finding-repetition', argument_impact: 'NO_ARGUMENT_CHANGE', research_impact: 'REMOVED' });
  const out = await se.run(task, { modelAdapter: adapter(del), routeSelector: fakeRoute });
  assert.equal(out.state, 'AWAITING_HUMAN_REVIEW', JSON.stringify(out.reason));
  assert.equal(out.research_impact.removed.length, 1);
});

// ── SE17–SE19 argument classification ────────────────────────────────────────
test('SE17: central claim change → NEEDS_HUMAN_DECISION', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const chg = semanticFor(task); chg.revision_proposal.central_claim = 'Cloud is the future.';
  const out = await se.run(task, { modelAdapter: adapter(chg), routeSelector: fakeRoute });
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
  assert.equal(out.handoff.next_owner, 'mikko');
});

test('SE18: spine change surfaced as argument-level signal', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const sp = semanticFor(task); sp.revision_proposal.narrative_spine = 'belief-objection-qualification-stronger-claim';
  const out = await se.run(task, { modelAdapter: adapter(sp), routeSelector: fakeRoute });
  assert.ok(['NEEDS_HUMAN_DECISION', 'AWAITING_HUMAN_REVIEW'].includes(out.state));
  assert.ok(out.argument_change.classification !== 'NO_ARGUMENT_CHANGE');
});

test('SE19: semantic argument-change classifier combined with SRR metadata', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const m = semanticFor(task); m.argument_change_risk = 'POTENTIAL_ARGUMENT_CHANGE';
  const out = await se.run(task, { modelAdapter: adapter(m), routeSelector: fakeRoute });
  assert.equal(out.argument_change.classification, 'POTENTIAL_ARGUMENT_CHANGE');
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

// ── SE20–SE26 boundaries ─────────────────────────────────────────────────────
test('SE20: Story cannot rewrite Research verdict fields', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.ok(!('judgment' in (out.review_bundle || {})) && !('support_status' in out));
});

test('SE21: Story cannot invent evidence — no sources field in output', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.ok(!('sources' in out) && !('evidence' in out));
});

test('SE22: Story never calls approveVersion — candidate stays unapproved', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  const cand = versions.loadVersion(env.dataRoot, 'p1', out.candidate_version_id);
  assert.equal(cand.approval.state, 'none');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'story-editor.js'), 'utf8');
  assert.doesNotMatch(src, /approveVersion\s*\(/);
});

test('SE23: Story cannot override QC — no global QC PASS in output', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.ok(!('qc' in out) || out.qc.state !== 'QC_PASS');
});

test('SE24: Hermes routes but cannot alter candidate/recommendation', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script', requestedBy: 'hermes' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(out.requested_by, 'hermes');
  assert.equal(out.recommendation.action, 'REVISION_RECOMMENDED');
});

test('SE25: Creative boundary — no episode-identity field in output', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.ok(!('creative_identity' in out) && !('episode_concept' in out));
});

test('SE26: Editor boundary — no timeline/cut fields in output', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.ok(!('timeline' in out) && !('cut' in out));
});

// ── SE27–SE30 retry/frontier/privacy ─────────────────────────────────────────
test('SE27: malformed output retries within budget', async () => {
  const env = mkEnv(); const task = mkTask(env);
  let n = 0;
  const out = await se.run(task, { modelAdapter: async () => { n += 1; return n < 2 ? 'broken' : JSON.stringify(semanticFor(task)); }, routeSelector: fakeRoute });
  assert.equal(out.state, 'COMPLETE');
  assert.equal(n, 2);
});

test('SE28: retry exhaustion escalates to hermes', async () => {
  const env = mkEnv(); const task = mkTask(env, { budget: 2 });
  const out = await se.run(task, { modelAdapter: async () => 'always-broken', routeSelector: fakeRoute });
  assert.equal(out.state, 'ESCALATED');
  assert.equal(out.handoff.next_owner, 'hermes');
});

test('SE29: FRONTIER_RECOMMENDED never auto-dispatches', async () => {
  const env = mkEnv(); const task = mkTask(env, { risk: 'FRONTIER_RECOMMENDED', privacy: { local_only: false } });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /FRONTIER_RECOMMENDED/);
});

test('SE30: privacy.local_only blocks frontier route', async () => {
  const env = mkEnv(); const task = mkTask(env, { risk: 'FRONTIER_RECOMMENDED', privacy: { local_only: true } });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /local-only/);
});

// ── SE31 control room ────────────────────────────────────────────────────────
test('SE31: control-room projection carries required fields, no chain-of-thought', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  const cr = se.controlRoomView(out);
  for (const f of ['role', 'state', 'current_task', 'source_version', 'candidate_version', 'owner', 'next_owner', 'attention_level', 'blocker', 'unresolved_disagreement', 'latest_event', 'story_summary']) {
    assert.ok(f in cr, f);
  }
  assert.ok(cr.operational_rationale.reason);
  assert.ok(!('prompt' in cr) && !('logs' in cr));
});

// ── SE32–SE37 canaries ───────────────────────────────────────────────────────
test('SE32: CANARY A — clean structural improvement → AWAITING_HUMAN_REVIEW', async () => {
  const env = mkEnv();
  const result = mkRoot([mkResult()]).results[0];
  const b = mkBinding(result);
  const task = mkTask(env, { action: 'revise_script', bindings: [b],
    research: { run_dir: mkRunDir(mkRoot([result])), asOf: AS_OF } });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(out.state, 'AWAITING_HUMAN_REVIEW');
  assert.equal(out.argument_change.classification, 'NO_ARGUMENT_CHANGE');
  assert.ok(out.review_bundle);
});

test('SE33: CANARY B — qualifier protection under forceful-wording request', async () => {
  const env = mkEnv();
  const result = mkRoot([mkResult({ qualification: { qualification_required: true,
    wording_constraints: [{ constraint_id: 'q-abs', type: 'FORBID_ABSOLUTE', instruction: 'no absolutes' }] },
    recommendation: 'ALLOW_USE_WITH_QUALIFICATION' })]).results[0];
  const b = mkBinding(result);
  const task = mkTask(env, { action: 'revise_script', goal: 'make the wording more forceful', bindings: [b],
    research: { run_dir: mkRunDir(mkRoot([result])), asOf: AS_OF } });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.equal(out.state, 'AWAITING_HUMAN_REVIEW', JSON.stringify(out.reason));
  assert.equal((out.review_bundle.constraint_report || []).filter((c) => !c.ok).length, 0);
});

test('SE34: CANARY C — thesis-changing rewrite → NEEDS_HUMAN_DECISION', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script', goal: 'rewrite to argue cloud is superior' });
  const chg = semanticFor(task); chg.revision_proposal.central_claim = 'Cloud workflows beat local.';
  chg.argument_change_risk = 'ARGUMENT_CHANGE';
  const out = await se.run(task, { modelAdapter: adapter(chg), routeSelector: fakeRoute });
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

test('SE35: CANARY D — factual scope broadening → RETURN_TO_RESEARCH', async () => {
  const env = mkEnv();
  const result = mkRoot([mkResult()]).results[0];
  const b = mkBinding(result);
  const task = mkTask(env, { action: 'revise_script', bindings: [b],
    research: { run_dir: mkRunDir(mkRoot([result])), asOf: AS_OF } });
  const broad = semanticFor(task);
  broad.revision_proposal.sections[0].dialogue = 'Cloud post-production universally eliminates latency.';
  broad.revision_proposal.change_rationales.push({ change_id: 'change-canary-scope', section_id: 'section-hook', rationale: 'Broaden the opening claim beyond the evidence.', intended_effect: 'Create a stronger hook.', finding_ref: 'finding-repetition', argument_impact: 'POTENTIAL_ARGUMENT_CHANGE', research_impact: 'REWRITTEN' });
  broad.revision_proposal.factual_claim_changes.unchanged = [];
  broad.revision_proposal.factual_claim_changes.rewritten = [b.binding_id];
  const out = await se.run(task, { modelAdapter: adapter(broad), routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
});

test('SE36: CANARY E — new factual example → RETURN_TO_RESEARCH, no fabrication', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const ex = semanticFor(task); ex.revision_proposal.factual_claim_changes.new = [{ claim_id: 'new-adobe-example', section_id: 'section-problem', assertion_text: 'Adobe moved all rendering to cloud in 2025.', rationale: 'Adds a real-world example.' }];
  const out = await se.run(task, { modelAdapter: adapter(ex), routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
  assert.equal(out.candidate_version_id, null);
});

test('SE37: CANARY F — clean deletion keeps remaining claims valid', async () => {
  const env = mkEnv();
  const root = mkRoot([mkResult(), mkResult({ claimText: 'Local tools need hardware.', claimId: 'claim-00000000-0000-4000-8000-000000000002' })]);
  const r1 = root.results[0]; const r2 = root.results[1];
  const b1 = mkBinding(r1); const b2 = mkBinding(r2, { assertion: 'Local tools need hardware.', section_id: 'section-problem' });
  const sourceSections = structuredClone(SECTIONS);
  sourceSections[1].dialogue += ' Local tools need hardware.';
  const task = mkTask(env, { action: 'revise_script', sections: sourceSections, bindings: [b1, b2],
    research: { run_dir: mkRunDir(root), asOf: AS_OF } });
  const del = semanticFor(task);
  del.revision_proposal.factual_claim_changes.removed = [b1.binding_id];
  del.revision_proposal.factual_claim_changes.unchanged = [b2.binding_id];
  del.revision_proposal.sections[0].dialogue = 'Here is the catch with cloud workflows.';
  del.revision_proposal.sections[1].dialogue = 'Local tools need hardware.';
  del.revision_proposal.change_rationales.push({ change_id: 'change-canary-delete', section_id: 'section-hook', rationale: 'Delete the unnecessary factual assertion.', intended_effect: 'Open on the actual conflict.', finding_ref: 'finding-repetition', argument_impact: 'NO_ARGUMENT_CHANGE', research_impact: 'REMOVED' });
  const out = await se.run(task, { modelAdapter: adapter(del), routeSelector: fakeRoute });
  assert.equal(out.state, 'AWAITING_HUMAN_REVIEW', JSON.stringify(out.reason));
  assert.equal(out.research_impact.removed.length, 1);
});

// ── SE38–SE40 human review guarantees ────────────────────────────────────────
test('SE38: candidate diff human-review bundle present and readable', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute });
  assert.ok(out.review_bundle.diff && out.review_bundle.change_rationales.length >= 1);
  assert.ok(out.review_bundle.human_attention.state);
});

test('SE39: argument-changing candidate is never approved', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const chg = semanticFor(task); chg.revision_proposal.central_claim = 'Opposite thesis.';
  const out = await se.run(task, { modelAdapter: adapter(chg), routeSelector: fakeRoute });
  const cand = versions.loadVersion(env.dataRoot, 'p1', out.candidate_version_id);
  assert.equal(cand.approval.state, 'none');
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

test('SE40: canonical Script Builder approval remains human-only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'story-editor.js'), 'utf8');
  assert.doesNotMatch(src, /approveVersion\s*\(/);
  assert.doesNotMatch(src, /approval\s*[:=]\s*['"]approved/);
});

test('SE41: source-head drift aborts stale semantic output before candidate creation', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  const project = { id: 'p1', slug: 'story', title: 'Story test' };
  const out = await se.run(task, {
    modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute,
    beforeCandidateCreate: () => versions.createVersion(env.dataRoot, project,
      task.script_sections.map((section, index) => ({ ...section, dialogue: index === 0 ? `${section.dialogue} Concurrent human edit.` : section.dialogue })),
      { wpm: { value: 130, calibrated: false } },
      { central_claim: task.central_claim, narrative_spine: task.narrative_spine, label: 'concurrent-human-version' }),
  });
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /SOURCE_VERSION_CHANGED/);
  assert.equal(out.candidate_version_id, null);
});

test('SE42: every created candidate invokes canonical SRR exactly once and records source provenance', async () => {
  const env = mkEnv(); const task = mkTask(env, { action: 'revise_script' });
  let calls = 0;
  const out = await se.run(task, { modelAdapter: adapter(semanticFor(task)), routeSelector: fakeRoute,
    reviewBuilder: (input) => { calls += 1; return srr.buildReview(input); } });
  assert.equal(calls, 1);
  const candidate = versions.loadVersion(env.dataRoot, task.project_id, out.candidate_version_id);
  assert.deepEqual(candidate.source_provenance, { system: 'story_editor', task_id: task.task_id,
    source_version_id: task.script_version_id, source_content_hash: task.script_content_hash });
});

test('SE43: canonical capped diff raises human attention instead of ordinary readiness', async () => {
  const env = mkEnv();
  const sections = Array.from({ length: 1100 }, (_, index) => ({ id: `large-${String(index + 1).padStart(4, '0')}`, order: index + 1,
    type: 'dialogue', beat: index === 0 ? 'hook' : 'progression', dialogue: `Meaningful story line ${index + 1}.` }));
  const task = mkTask(env, { action: 'revise_script', sections });
  const proposalSections = task.script_sections.map((section) => ({ id: section.id, order: section.order, beat: section.beat, dialogue: section.dialogue }));
  proposalSections[0].dialogue += ' A sharper opening tension.';
  const semantic = semanticOut({ findings: [{ finding_id: 'finding-large-hook', section_ids: ['large-0001'], category: 'OPENING_TENSION', severity: 'MEDIUM', rationale: 'The opening states context without a sufficiently sharp tension.', recommended_action: 'Add one bounded tension sentence.' }],
    proposal: { sections: proposalSections,
      change_rationales: [{ change_id: 'change-large-hook', section_id: 'large-0001', rationale: 'Add a bounded tension sentence to the opening.', intended_effect: 'Clarify the viewer promise.', finding_ref: 'finding-large-hook', argument_impact: 'NO_ARGUMENT_CHANGE', research_impact: 'NONE' }],
      factual_claim_changes: { unchanged: [], rewritten: [], new: [], removed: [] } } });
  const out = await se.run(task, { modelAdapter: adapter(semantic), routeSelector: fakeRoute });
  assert.equal(out.review_bundle.diff_summary.truncated, true);
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

test('SE44: detached script-evaluator findings block before model invocation', async () => {
  const env = mkEnv(); const task = mkTask(env);
  task.script_evaluator_findings = { script_hash: 'detached', verdict: 'PRODUCE' };
  let calls = 0;
  const out = await se.run(task, { modelAdapter: async () => { calls += 1; return JSON.stringify(semanticFor(task)); }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED');
  assert.equal(calls, 0);
});

test('SE45: standalone harness is present and fail-count controls process exit', () => {
  const src = fs.readFileSync(__filename, 'utf8');
  assert.match(src, /require\.main === module/);
  assert.match(src, /if \(failed\) process\.exitCode = 1/);
});

// ── standalone harness ───────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    let passed = 0, failed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); }
      catch (e) { failed += 1; console.error(`not ok - ${item.name}`); console.error(e.message); }
    }
    console.log(`${passed}/${passed + failed} Story Editor tests passed`);
    if (failed) process.exitCode = 1;
  })();
}
module.exports = { tests };
