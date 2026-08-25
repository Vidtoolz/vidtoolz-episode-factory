'use strict';

/*
 * KNOWLEDGE STEWARD — NON-AGENT LIBRARY PROOF
 *
 * This is deliberately NOT an agent V2 dispatch proof. Knowledge Steward is not
 * dispatchable and must never be: the canonical contract marks it
 * `is_specialist: false`, keeps it out of role_roster, and
 * agent-contract-validator.js refuses to let it be registered as an agent.
 * Applying agent promotion criteria here would assert a capability the
 * architecture deliberately withholds.
 *
 * What this proof establishes instead:
 *
 *   1. the non-agent contract still holds (registering it is INVALID)
 *   2. the canonical production architecture is still exactly 12 agents
 *   3. the library has no apply / write-brain / commit path at all
 *   4. a proposal is produced without mutating anything canonical
 *   5. duplicate / conflict / supersession / runtime-state behaviour
 *   6. human doctrine always requires Mikko
 *   7. approval binds an exact digest, and a stale approval is refused
 *   8. source evidence is byte-identical before and after
 *   9. proposal output is confined to one allowlisted root
 *
 * It runs entirely on synthetic fixtures inside an isolated temp root. It never
 * reads or writes hermes-organiser/brain/, and never touches the live repo.
 *
 * Usage:
 *   node scripts/knowledge-steward-proof.js --emit <dir>
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ks = require('./knowledge-steward.js');
const contractValidator = require('./agent-contract-validator.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const NOW = '2026-08-25T12:00:00.000Z';

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

// Deliberately synthetic. Codex owns live Earth Studio evidence, so the proof
// uses stable fixtures rather than mutable camera work.
const SNAPSHOT = Object.freeze([
  { reference_id: 'camera-quality-scope', namespace: 'production-doctrine', authority: 'HUMAN_VERDICT',
    statement: 'Earth Studio camera-quality reports are machine continuity checks, not aesthetic approvals.', status: 'active' },
  { reference_id: 'wobble-doctrine', namespace: 'production-doctrine', authority: 'HUMAN_VERDICT',
    statement: 'Camera wobble is a defect.', status: 'active' },
]);

function isolatedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-library-proof-'));
  fs.mkdirSync(path.join(root, 'governance', 'knowledge-proposals'), { recursive: true });
  fs.mkdirSync(path.join(root, 'package-runs', 'fixture'), { recursive: true });
  const evidencePath = path.join('package-runs', 'fixture', 'proof-evidence.json');
  const bytes = `${JSON.stringify({ verdict: 'PRODUCTION_PATH_PROOF_PASS', agent: 'qc_director' }, null, 2)}\n`;
  fs.writeFileSync(path.join(root, evidencePath), bytes);
  return { root, evidencePath, evidenceSha256: sha256(bytes) };
}

function candidate(overrides = {}) {
  return {
    candidate_id: 'proof-candidate',
    statement: 'A QC disposition of PASS_WITH_WARNINGS still permits the next production gate.',
    knowledge_class: 'DETERMINISTIC_SYSTEM_FACT',
    operation: 'add',
    target: { namespace: 'production-doctrine', reference_id: 'qc-gate-rule' },
    source_artifacts: [],
    evidence: {},
    rationale: 'Established by the QC Director production-path proof.',
    ...overrides,
  };
}

function contractCases() {
  const registry = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'agent-contract.json'), 'utf8'));

  const live = contractValidator.validateContract(contract, registry);

  const registered = structuredClone(registry);
  registered.agents.push({
    agent_id: 'knowledge_steward', name: 'Knowledge Steward',
    lifecycle: { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED', dispatch_blocked_reason: 'non-agent role' },
    role: 'stewardship', mission: 'propose durable knowledge', reports_to: 'hermes',
    collaborates_with: [], allowed_actions: ['propose durable knowledge'],
    prohibited_actions: ['publish'], escalation_rules: { DECISION: 'human gate' },
  });
  const asAgent = contractValidator.validateContract(contract, registered);

  const rostered = structuredClone(contract);
  rostered.role_roster.push({
    role_id: 'knowledge_steward', role_name: 'Knowledge Steward', status: 'PLANNED',
    owns: ['proposing durable learnings'], does_not_own: ['doctrine authority'], boundaries: ['human-gated'],
  });
  const inRoster = contractValidator.validateContract(rostered, registry);

  return {
    live_contract_valid: live.ok,
    canonical_production_agents: registry.agents.length,
    canonical_role_count: contract.lifecycle_classification?.canonical_role_count ?? null,
    knowledge_steward_registered: registry.agents.some((a) => a.agent_id === 'knowledge_steward'),
    knowledge_steward_in_role_roster: contract.role_roster.some((r) => r.role_id === 'knowledge_steward'),
    knowledge_steward_is_specialist: contract.knowledge_steward.is_specialist,
    knowledge_steward_write_gate: contract.knowledge_steward.write_gate,
    registering_as_agent_rejected: !asAgent.ok && asAgent.errors.some((e) => /never be registered as an agent/.test(e)),
    registering_as_agent_errors: asAgent.errors.filter((e) => /knowledge_steward|canonical_role_count/.test(e)),
    adding_to_role_roster_rejected: !inRoster.ok && inRoster.errors.some((e) => /canonical_role_count is 12/.test(e)),
    adding_to_role_roster_errors: inRoster.errors.filter((e) => /knowledge_steward|canonical_role_count/.test(e)),
  };
}

function noWriteProof() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'knowledge-steward.js'), 'utf8');
  const exported = Object.keys(ks);
  return {
    exports: exported,
    declares_agent_id: 'AGENT_ID' in ks,
    mutation_exports: exported.filter((n) => /^(apply|writeBrain|commitProposal|mutate|autoMerge)/i.test(n)),
    actions: [...ks.ACTIONS],
    action_admits_application: ks.ACTIONS.some((a) => /apply|write|merge|rewrite/i.test(a)),
    prohibited_actions: [...ks.PROHIBITED_ACTIONS],
    has_runner_cli_entry: /require\.main\s*===\s*module/.test(source),
    reads_brain_filesystem: /(readFileSync|writeFileSync|require)\([^)]*hermes-organiser/i.test(source),
    uses_environment_bypass: /process\.env\./.test(source),
    canonical_store_writable: ks.status().canonical_store_writable,
  };
}

function behaviourCases(fixture) {
  const opts = { now: NOW, repoRoot: fixture.root };
  const build = (input, extra = {}) => ks.createKnowledgeProposal(input, { ...opts, ...extra });

  const proposalOnly = build({
    candidate: candidate({ source_artifacts: [{ artifact_id: 'ev-1', path: fixture.evidencePath, sha256: fixture.evidenceSha256, kind: 'PROOF_PACKAGE' }] }),
    canonical_snapshot: SNAPSHOT,
  });
  const duplicate = build({
    candidate: candidate({ candidate_id: 'proof-duplicate',
      statement: 'Earth Studio camera-quality reports are machine continuity checks, not aesthetic approvals.',
      target: { namespace: 'production-doctrine', reference_id: 'camera-quality-scope' } }),
    canonical_snapshot: SNAPSHOT,
  });
  const conflict = build({
    candidate: candidate({ candidate_id: 'proof-conflict', knowledge_class: 'HUMAN_DOCTRINE',
      statement: 'Camera wobble is desirable by default.',
      target: { namespace: 'production-doctrine', reference_id: 'wobble-doctrine' } }),
    canonical_snapshot: SNAPSHOT,
  });
  const supersession = build({
    candidate: candidate({ candidate_id: 'proof-supersede', knowledge_class: 'HUMAN_DOCTRINE', operation: 'supersede',
      statement: 'Camera wobble is a defect except where an approved handheld look is specified.',
      target: { namespace: 'production-doctrine', reference_id: 'wobble-doctrine' },
      predecessor: { reference_id: 'wobble-doctrine' } }),
    canonical_snapshot: SNAPSHOT,
  });
  const runtime = build({
    candidate: candidate({ candidate_id: 'proof-runtime', knowledge_class: 'TEMPORARY_RUNTIME_STATE',
      statement: 'PRESTO currently has 3 jobs queued.',
      target: { namespace: 'runtime', reference_id: 'presto-queue' } }),
    canonical_snapshot: SNAPSHOT,
  });
  const humanDoctrine = build({
    candidate: candidate({ candidate_id: 'proof-doctrine', knowledge_class: 'HUMAN_DOCTRINE',
      statement: 'One claim, one example, one point per video.',
      target: { namespace: 'production-doctrine', reference_id: 'brand-pattern' } }),
    canonical_snapshot: SNAPSHOT,
  });
  const hashMismatch = build({
    candidate: candidate({ candidate_id: 'proof-hash-mismatch',
      source_artifacts: [{ artifact_id: 'ev-bad', path: fixture.evidencePath, sha256: sha256('WRONG'), kind: 'PROOF_PACKAGE' }] }),
    canonical_snapshot: SNAPSHOT,
  });
  const traversal = build({
    candidate: candidate({ candidate_id: 'proof-traversal',
      source_artifacts: [{ artifact_id: 'ev-esc', path: '../hermes-organiser/brain/index.json', kind: 'PROOF_PACKAGE' }] }),
    canonical_snapshot: SNAPSHOT,
  });

  // Approval binding: exact approval binds; a changed proposal makes it stale.
  const approval = {
    approved_by: 'Mikko', approved_at: NOW,
    proposal_digest_sha256: humanDoctrine.proposal_digest_sha256,
    target_namespace: humanDoctrine.target.namespace, operation: humanDoctrine.operation,
  };
  const approved = ks.bindApproval(humanDoctrine, approval);
  const revised = build({
    candidate: candidate({ candidate_id: 'proof-doctrine', knowledge_class: 'HUMAN_DOCTRINE',
      statement: 'A materially different doctrine statement than the approved one.',
      target: { namespace: 'production-doctrine', reference_id: 'brand-pattern' } }),
    canonical_snapshot: SNAPSHOT,
  }, { revision: 2 });
  const staleApproved = ks.bindApproval(revised, approval);

  // Determinism: identical inputs, different clocks, same substantive digest.
  const digestA = ks.createKnowledgeProposal({ candidate: candidate(), canonical_snapshot: SNAPSHOT }, { ...opts, now: '2026-01-01T00:00:00.000Z' });
  const digestB = ks.createKnowledgeProposal({ candidate: candidate(), canonical_snapshot: SNAPSHOT }, { ...opts, now: '2026-12-31T23:59:59.000Z' });

  return { proposalOnly, duplicate, conflict, supersession, runtime, humanDoctrine, hashMismatch, traversal, approved, staleApproved, digestA, digestB };
}

function summarize(p) {
  return {
    proposal_id: p.proposal_id,
    disposition: p.disposition,
    reason: p.reason,
    canonical_status: p.canonical_status,
    applied: p.applied,
    knowledge_class: p.classification.knowledge_class,
    durable_value: p.classification.durable_value,
    authority: p.authority.authority,
    human_approval_required: p.human_approval.required,
    human_approval_state: p.human_approval.state,
    duplicates: p.duplicates.state,
    conflicts: p.conflicts.state,
    supersession: p.supersession.state,
    blockers: p.blockers.map((b) => b.code),
    target_writable_by_library: p.target.writable_by_this_library,
    proposal_digest_sha256: p.proposal_digest_sha256,
  };
}

function run() {
  const fixture = isolatedRoot();
  const contract = contractCases();
  const noWrite = noWriteProof();
  const cases = behaviourCases(fixture);

  // Source immutability + confined proposal output, measured for real.
  const sourceAbs = path.join(fixture.root, fixture.evidencePath);
  const sourceBefore = sha256(fs.readFileSync(sourceAbs));
  const written = ks.writeProposal(cases.proposalOnly, { repoRoot: fixture.root });
  const idempotent = ks.writeProposal(cases.proposalOnly, { repoRoot: fixture.root });
  const sourceAfter = sha256(fs.readFileSync(sourceAbs));

  // Everything created anywhere in the isolated root after proposal writing.
  const created = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else created.push(path.relative(fixture.root, full));
    }
  })(fixture.root);
  const outsideProposalRoot = created.filter((f) => !f.startsWith(ks.PROPOSAL_ROOT) && f !== fixture.evidencePath);

  const proof = {
    schema_version: 1,
    proof: 'KNOWLEDGE_STEWARD_NON_AGENT_LIBRARY_PROOF',
    generated_at: new Date().toISOString(),
    proof_kind: 'NON_AGENT_LIBRARY',
    not_an_agent_proof_note:
      'Agent promotion criteria (docs/implementation-promotion-criteria.md) are deliberately NOT applied here. '
      + 'Knowledge Steward is not dispatchable and must never be registered as an agent; asserting IMPLEMENTATION_PROVEN '
      + 'would claim a capability the architecture withholds by design.',
    steward_version: ks.STEWARD_VERSION,
    module_sha256: sha256(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'knowledge-steward.js'))),
    non_agent_contract: contract,
    no_write_guarantee: noWrite,
    canonical_store: {
      store: 'hermes-organiser/brain (outside this repository)',
      writer: 'Hermes-side / project-memory-system canonical writer',
      written_by_this_library: false,
      read_by_this_library: false,
      comparison_mechanism: 'caller-supplied canonical snapshot only; otherwise CANONICAL_STATE_UNAVAILABLE_FOR_COMPARISON',
    },
    cases: {
      'A-proposal-only': summarize(cases.proposalOnly),
      'B-exact-duplicate': summarize(cases.duplicate),
      'C-conflict': { ...summarize(cases.conflict), conflict_detail: cases.conflict.conflicts.conflicts[0] },
      'D-supersession': { ...summarize(cases.supersession), supersession_detail: cases.supersession.supersession },
      'E-runtime-state': summarize(cases.runtime),
      'F-human-doctrine': summarize(cases.humanDoctrine),
      'G-source-hash-mismatch': summarize(cases.hashMismatch),
      'H-path-traversal': summarize(cases.traversal),
      'I-approved-awaiting-writer': summarize(cases.approved),
      'J-stale-approval': { ...summarize(cases.staleApproved), approval_reason: cases.staleApproved.human_approval.reason },
    },
    determinism: {
      digest_a: cases.digestA.proposal_digest_sha256,
      digest_b: cases.digestB.proposal_digest_sha256,
      stable_across_clocks: cases.digestA.proposal_digest_sha256 === cases.digestB.proposal_digest_sha256,
      created_at_differs: cases.digestA.created_at !== cases.digestB.created_at,
    },
    source_immutability: {
      artifact: fixture.evidencePath,
      sha256_before: sourceBefore,
      sha256_after: sourceAfter,
      unchanged: sourceBefore === sourceAfter,
    },
    write_confinement: {
      proposal_root: ks.PROPOSAL_ROOT,
      files_written_outside_proposal_root: outsideProposalRoot,
      confined: outsideProposalRoot.length === 0,
      proposal_written: written.written,
      rewrite_is_idempotent: idempotent.written === false,
    },
    verdict: null,
  };

  const failures = [];
  const c = proof.non_agent_contract;
  if (!c.live_contract_valid) failures.push('live contract is not VALID');
  if (c.canonical_production_agents !== 12) failures.push(`canonical production agents is ${c.canonical_production_agents}, expected 12`);
  if (c.knowledge_steward_registered) failures.push('knowledge steward is registered as an agent');
  if (c.knowledge_steward_in_role_roster) failures.push('knowledge steward is in role_roster');
  if (!c.registering_as_agent_rejected) failures.push('registering knowledge steward was not rejected');
  if (!c.adding_to_role_roster_rejected) failures.push('adding knowledge steward to role_roster was not rejected');

  const n = proof.no_write_guarantee;
  if (n.declares_agent_id) failures.push('library declares an AGENT_ID');
  if (n.mutation_exports.length) failures.push(`mutation export present: ${n.mutation_exports.join(', ')}`);
  if (n.action_admits_application) failures.push('an action admits application');
  if (n.has_runner_cli_entry) failures.push('library exposes a runner CLI entry');
  if (n.reads_brain_filesystem) failures.push('library reaches the brain filesystem');
  if (n.uses_environment_bypass) failures.push('library reads environment variables');
  if (n.canonical_store_writable) failures.push('library claims the canonical store is writable');

  const expected = {
    'A-proposal-only': 'PROPOSAL_READY',
    'B-exact-duplicate': 'DUPLICATE_NO_CHANGE',
    'C-conflict': 'CONFLICT_REQUIRES_HUMAN_REVIEW',
    'D-supersession': 'HUMAN_REVIEW_REQUIRED',
    'E-runtime-state': 'NO_DURABLE_VALUE',
    'F-human-doctrine': 'HUMAN_REVIEW_REQUIRED',
    'G-source-hash-mismatch': 'BLOCKED',
    'H-path-traversal': 'BLOCKED',
    'I-approved-awaiting-writer': 'APPROVED_AWAITING_CANONICAL_WRITER',
    'J-stale-approval': 'BLOCKED',
  };
  for (const [id, want] of Object.entries(expected)) {
    const got = proof.cases[id].disposition;
    if (got !== want) failures.push(`${id}: disposition ${got}, expected ${want}`);
    if (proof.cases[id].applied !== false) failures.push(`${id}: reported itself applied`);
    if (proof.cases[id].canonical_status !== 'NOT_CANONICAL_KNOWLEDGE') failures.push(`${id}: not marked NOT_CANONICAL_KNOWLEDGE`);
  }
  if (!proof.cases['D-supersession'].supersession_detail.predecessor_preserved) failures.push('supersession did not preserve its predecessor');
  if (proof.cases['D-supersession'].supersession_detail.rewrites_history) failures.push('supersession rewrites history');
  if (!proof.determinism.stable_across_clocks) failures.push('proposal digest is not clock-stable');
  if (!proof.source_immutability.unchanged) failures.push('source evidence was mutated');
  if (!proof.write_confinement.confined) failures.push('a file was written outside the proposal root');

  proof.verdict = failures.length === 0
    ? 'NON_AGENT_STEWARD_LIBRARY_PROVEN'
    : `NON_AGENT_STEWARD_LIBRARY_FAIL — ${failures.join('; ')}`;
  proof.failures = failures;

  fs.rmSync(fixture.root, { recursive: true, force: true });
  return proof;
}

if (require.main === module) {
  const emitIndex = process.argv.indexOf('--emit');
  if (emitIndex < 0) { console.error('usage: knowledge-steward-proof.js --emit <dir>'); process.exit(2); }
  const emitDir = path.resolve(process.argv[emitIndex + 1]);
  fs.mkdirSync(emitDir, { recursive: true });
  const proof = run();

  // A readable example proposal + review artifact, so the human-facing form is
  // part of the evidence rather than only described.
  const fixture = isolatedRoot();
  const example = ks.createKnowledgeProposal({
    candidate: candidate({ candidate_id: 'example', knowledge_class: 'HUMAN_DOCTRINE',
      statement: 'Camera wobble is desirable by default.',
      target: { namespace: 'production-doctrine', reference_id: 'wobble-doctrine' } }),
    canonical_snapshot: SNAPSHOT,
  }, { now: NOW, repoRoot: fixture.root });
  fs.writeFileSync(path.join(emitDir, 'example-proposal.json'), `${JSON.stringify(example, null, 2)}\n`);
  fs.writeFileSync(path.join(emitDir, 'example-REVIEW.md'), ks.renderReviewMarkdown(example));
  fs.rmSync(fixture.root, { recursive: true, force: true });

  proof.artifacts = {
    'example-proposal.json': sha256(fs.readFileSync(path.join(emitDir, 'example-proposal.json'))),
    'example-REVIEW.md': sha256(fs.readFileSync(path.join(emitDir, 'example-REVIEW.md'))),
  };
  fs.writeFileSync(path.join(emitDir, 'library-proof-summary.json'), `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    verdict: proof.verdict,
    cases: Object.keys(proof.cases).length,
    canonical_production_agents: proof.non_agent_contract.canonical_production_agents,
    registered_as_agent: proof.non_agent_contract.knowledge_steward_registered,
  }, null, 2)}\n`);
  process.exitCode = proof.verdict === 'NON_AGENT_STEWARD_LIBRARY_PROVEN' ? 0 : 1;
}

module.exports = { SNAPSHOT, isolatedRoot, candidate, contractCases, noWriteProof, behaviourCases, run };
