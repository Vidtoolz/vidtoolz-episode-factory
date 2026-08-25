'use strict';

// KNOWLEDGE STEWARD V1 — non-agent proposal library.
//
// Two invariants dominate this suite:
//   1. Knowledge Steward is NOT a production agent and must never become one.
//   2. It proposes and never applies: no code path mutates canonical knowledge.
//
// No network, no remote hosts, no brain access. The canonical brain is never
// read or written here; canonical state is supplied as an explicit snapshot.

const { assert, fs, os, path, test } = require('./_helpers.js');
const ks = require('../scripts/knowledge-steward.js');
const contractValidator = require('../scripts/agent-contract-validator.js');

const ROOT = path.resolve(__dirname, '..');
const NOW = '2026-08-25T12:00:00.000Z';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-steward-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

function repo() {
  const root = fs.mkdtempSync(path.join(TMP, 'repo-'));
  fs.mkdirSync(path.join(root, 'governance', 'knowledge-proposals'), { recursive: true });
  return root;
}

function writeSource(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return { relative, absolute: target, sha256: ks.sha256(Buffer.from(content)) };
}

function candidate(overrides = {}) {
  return {
    candidate_id: 'cand-001',
    statement: 'Earth Studio camera-quality reports are machine continuity checks, not aesthetic approvals.',
    knowledge_class: 'DETERMINISTIC_SYSTEM_FACT',
    operation: 'add',
    target: { namespace: 'production-doctrine', reference_id: 'camera-quality-scope' },
    source_artifacts: [],
    evidence: {},
    rationale: 'The artifact states its own scope.',
    ...overrides,
  };
}

function build(input, options = {}) {
  return ks.createKnowledgeProposal(input, { now: NOW, repoRoot: options.repoRoot || ROOT, ...options });
}

// ── 1-2. non-agent contract invariants ────────────────────────────────────

test('KS1: knowledge steward is absent from the agent registry', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const ids = registry.agents.map((a) => a.agent_id);
  assert.equal(ids.includes('knowledge_steward'), false, 'knowledge steward must never be a registered agent');
  assert.equal(registry.agents.length, 12, 'canonical production agent count must remain 12');
});

test('KS2: registering knowledge steward as an agent is INVALID', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-contract.json'), 'utf8'));
  const tampered = structuredClone(registry);
  tampered.agents.push({
    agent_id: 'knowledge_steward', name: 'Knowledge Steward',
    lifecycle: { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED', dispatch_blocked_reason: 'planned' },
    role: 'stewardship', mission: 'propose durable knowledge', reports_to: 'hermes',
    collaborates_with: [], allowed_actions: ['propose durable knowledge'],
    prohibited_actions: ['publish', 'write canonical knowledge without human approval'],
    escalation_rules: { DECISION: 'human gate' },
  });
  const result = contractValidator.validateContract(contract, tampered);
  assert.equal(result.ok, false, 'the validator must refuse a registered knowledge steward');
  assert.ok(
    result.errors.some((e) => /knowledge_steward is a non-specialist contract role and must never be registered/.test(e)),
    `expected the non-agent prohibition, got: ${result.errors.join('; ')}`
  );
});

test('KS3: adding knowledge steward to role_roster is INVALID', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-contract.json'), 'utf8'));
  const tampered = structuredClone(contract);
  tampered.role_roster.push({
    role_id: 'knowledge_steward', role_name: 'Knowledge Steward', status: 'PLANNED',
    owns: ['proposing durable learnings'], does_not_own: ['doctrine authority'], boundaries: ['human-gated'],
  });
  const result = contractValidator.validateContract(tampered, registry);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /role_roster holds 13 roles but canonical_role_count is 12/.test(e)),
    `expected the canonical role count guard, got: ${result.errors.join('; ')}`
  );
});

test('KS4: the live contract remains VALID and the steward stays a non-agent role', () => {
  const result = contractValidator.main([]);
  assert.equal(result.ok, true, `contract must remain VALID: ${result.errors.join('; ')}`);
  assert.equal(result.summary.canonical_roles, 12);
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-contract.json'), 'utf8'));
  assert.equal(contract.knowledge_steward.is_specialist, false);
  assert.equal(contract.role_roster.some((r) => r.role_id === 'knowledge_steward'), false);
  assert.match(contract.knowledge_steward.write_gate, /human-gated/i);
});

test('KS5: the module exposes no agent-runner identity surface', () => {
  assert.equal('AGENT_ID' in ks, false, 'a non-agent library must not declare an agent identity');
  assert.equal(ks.ACTOR.identity_type, 'SUPPORT_ROLE');
  assert.match(ks.ACTOR.context, /non-agent per agent contract/);
  assert.equal(ks.status().is_agent, false);
  assert.equal(ks.status().dispatchable_via_agent_runner, false);
  assert.equal(ks.status().canonical_production_agents, 12);
});

// ── 16. structural absence of any write/apply path ────────────────────────

test('KS6: no apply / write-brain / commit export exists anywhere', () => {
  for (const name of Object.keys(ks)) {
    assert.ok(
      !/^(apply|applyKnowledge|writeBrain|commitProposal|mutate|merge|autoMerge)/i.test(name),
      `forbidden mutation export: ${name}`
    );
  }
  assert.equal(typeof ks.applyKnowledge, 'undefined');
  assert.equal(typeof ks.writeBrain, 'undefined');
  assert.equal(typeof ks.commitProposal, 'undefined');
  // No action vocabulary admits application.
  for (const action of ks.ACTIONS) assert.ok(!/apply|write|merge|rewrite|scan_everything/i.test(action), action);
  assert.ok(ks.PROHIBITED_ACTIONS.includes('APPLY'));
  assert.ok(ks.PROHIBITED_ACTIONS.includes('WRITE_BRAIN'));
});

test('KS7: the module never references the brain as a writable path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'knowledge-steward.js'), 'utf8');
  // No filesystem call may target hermes-organiser.
  assert.ok(!/writeFileSync\([^)]*hermes-organiser/i.test(source));
  assert.ok(!/readFileSync\([^)]*hermes-organiser/i.test(source));
  assert.ok(!/require\([^)]*hermes-organiser/i.test(source));
  // No CLI entry and therefore no hidden flag or env bypass.
  assert.ok(!/require\.main\s*===\s*module/.test(source), 'a non-agent library exposes no runner CLI entry');
  assert.ok(!/process\.env\./.test(source), 'no environment-variable bypass may exist');
});

// ── 3. valid candidate produces a proposal ────────────────────────────────

test('KS8: a valid durable candidate produces a complete proposal artifact', () => {
  const proposal = build({ candidate: candidate() });
  assert.equal(proposal.artifact_type, 'knowledge-steward-proposal');
  assert.equal(proposal.canonical_status, 'NOT_CANONICAL_KNOWLEDGE');
  assert.equal(proposal.applied, false);
  assert.equal(proposal.target.writable_by_this_library, false);
  assert.match(proposal.proposal_digest_sha256, /^[0-9a-f]{64}$/);
  assert.equal(proposal.disposition, 'HUMAN_REVIEW_REQUIRED');
  // Without a snapshot the steward refuses to guess canonical state.
  assert.equal(proposal.canonical_comparison.state, 'CANONICAL_STATE_UNAVAILABLE_FOR_COMPARISON');
  assert.equal(ks.validateProposal(proposal).ok, true);
});

test('KS9: unknown candidate fields are rejected (strict schema)', () => {
  assert.throws(() => build({ candidate: candidate({ sneaky_field: true }) }), (e) => e.code === 'KS_CANDIDATE_INVALID');
  assert.throws(() => build({ candidate: candidate({ knowledge_class: 'MADE_UP' }) }), (e) => e.code === 'KS_CLASS_INVALID');
  assert.throws(() => build({ candidate: candidate({ operation: 'obliterate' }) }), (e) => e.code === 'KS_OPERATION_INVALID');
});

// ── 5. temporary runtime state is not knowledge ───────────────────────────

test('KS10: transient runtime state is classified NO_DURABLE_VALUE', () => {
  const proposal = build({
    candidate: candidate({
      candidate_id: 'cand-runtime',
      statement: 'PRESTO currently has 3 jobs queued and GPU utilisation is 71%.',
      knowledge_class: 'TEMPORARY_RUNTIME_STATE',
    }),
  });
  assert.equal(proposal.disposition, 'NO_DURABLE_VALUE');
  assert.equal(proposal.classification.durable_value, false);
  assert.match(proposal.reason, /operational state, not durable knowledge/);
  assert.equal(proposal.applied, false);
});

// ── 6. duplicates ─────────────────────────────────────────────────────────

const SNAPSHOT = [
  { reference_id: 'camera-quality-scope', namespace: 'production-doctrine', authority: 'HUMAN_VERDICT',
    statement: 'Earth Studio camera-quality reports are machine continuity checks, not aesthetic approvals.', status: 'active' },
  { reference_id: 'wobble-doctrine', namespace: 'production-doctrine', authority: 'HUMAN_VERDICT',
    statement: 'Camera wobble is a defect.', status: 'active' },
];

test('KS11: an exact duplicate is detected deterministically and needs no change', () => {
  const proposal = build({ candidate: candidate(), canonical_snapshot: SNAPSHOT });
  assert.equal(proposal.duplicates.state, 'EXACT_DUPLICATE');
  assert.equal(proposal.disposition, 'DUPLICATE_NO_CHANGE');
  assert.equal(proposal.duplicates.matches[0].reference_id, 'camera-quality-scope');
});

test('KS12: duplicate detection normalizes whitespace and case, not meaning', () => {
  const noisy = build({
    candidate: candidate({ statement: '  EARTH STUDIO camera-quality reports are machine   continuity checks, not aesthetic approvals  ' }),
    canonical_snapshot: SNAPSHOT,
  });
  assert.equal(noisy.duplicates.state, 'EXACT_DUPLICATE', 'deterministic normalization must catch this');

  // A semantically similar but textually different statement is NEVER merged
  // and is NEVER declared a contradiction. The steward reports only the fact it
  // can prove: `add` targets an already-occupied reference.
  const similar = build({
    candidate: candidate({ candidate_id: 'cand-similar', target: { namespace: 'production-doctrine', reference_id: 'camera-quality-scope' },
      statement: 'Camera quality checks only verify continuity and do not judge how it looks.' }),
    canonical_snapshot: SNAPSHOT,
  });
  assert.equal(similar.duplicates.state, 'NO_DUPLICATE', 'textual comparison must not claim a semantic duplicate');
  assert.equal(similar.conflicts.state, 'CONFLICT');
  assert.equal(similar.conflicts.conflicts[0].conflict_kind, 'OCCUPIED_REFERENCE');
  assert.match(similar.conflicts.conflicts[0].note, /cannot determine whether these agree, contradict, or supersede/);
  assert.equal(similar.disposition, 'CONFLICT_REQUIRES_HUMAN_REVIEW');
});

test('KS12b: the same statement stored under another reference is a possible duplicate', () => {
  const proposal = build({
    candidate: candidate({ candidate_id: 'cand-elsewhere',
      target: { namespace: 'production-doctrine', reference_id: 'a-different-reference' } }),
    canonical_snapshot: SNAPSHOT,
  });
  assert.equal(proposal.duplicates.state, 'POSSIBLE_DUPLICATE');
  assert.equal(proposal.disposition, 'POSSIBLE_DUPLICATE_REQUIRES_REVIEW');
  assert.match(proposal.duplicates.note, /already stored under a different canonical reference/);
  assert.equal(proposal.duplicates.matches[0].reference_id, 'camera-quality-scope');
});

// ── 7. conflict ───────────────────────────────────────────────────────────

test('KS13: contradicting human-approved knowledge yields a conflict, never an overwrite', () => {
  const proposal = build({
    candidate: candidate({
      candidate_id: 'cand-wobble',
      statement: 'Camera wobble is desirable by default.',
      knowledge_class: 'HUMAN_DOCTRINE',
      operation: 'add',
      target: { namespace: 'production-doctrine', reference_id: 'wobble-doctrine' },
    }),
    canonical_snapshot: SNAPSHOT,
  });
  assert.equal(proposal.conflicts.state, 'CONFLICT');
  assert.equal(proposal.disposition, 'CONFLICT_REQUIRES_HUMAN_REVIEW');
  const conflict = proposal.conflicts.conflicts[0];
  assert.equal(conflict.current_statement, 'Camera wobble is a defect.');
  assert.equal(conflict.proposed_statement, 'Camera wobble is desirable by default.');
  assert.equal(conflict.current_authority, 'HUMAN_VERDICT');
  assert.equal(conflict.conflict_kind, 'OCCUPIED_REFERENCE');
  assert.match(conflict.note, /No winner is chosen/);
  assert.match(conflict.note, /the steward cannot determine whether these agree, contradict, or supersede/);
  assert.equal(proposal.applied, false);
});

// ── 8. supersession preserves history ─────────────────────────────────────

test('KS14: a supersession references its predecessor and never rewrites history', () => {
  const proposal = build({
    candidate: candidate({
      candidate_id: 'cand-supersede',
      statement: 'Camera wobble is a defect except where an approved handheld look is specified.',
      knowledge_class: 'HUMAN_DOCTRINE',
      operation: 'supersede',
      target: { namespace: 'production-doctrine', reference_id: 'wobble-doctrine' },
      predecessor: { reference_id: 'wobble-doctrine' },
    }),
    canonical_snapshot: SNAPSHOT,
  });
  assert.equal(proposal.supersession.state, 'SUPERSESSION_PROPOSED');
  assert.equal(proposal.supersession.predecessor.reference_id, 'wobble-doctrine');
  assert.equal(proposal.supersession.predecessor_preserved, true);
  assert.equal(proposal.supersession.rewrites_history, false);
  assert.equal(proposal.supersession.predecessor_found_in_snapshot, true);
  assert.equal(proposal.supersession.predecessor_statement, 'Camera wobble is a defect.');
  // A declared supersession is not treated as a contradiction.
  assert.equal(proposal.conflicts.state, 'NO_CONFLICT');
  // ...but human doctrine still needs Mikko.
  assert.equal(proposal.disposition, 'HUMAN_REVIEW_REQUIRED');
});

test('KS15: supersede without a predecessor is rejected', () => {
  assert.throws(
    () => build({ candidate: candidate({ operation: 'supersede', predecessor: undefined }) }),
    (e) => e.code === 'KS_CANDIDATE_INVALID'
  );
});

// ── 9-10. authority ───────────────────────────────────────────────────────

test('KS16: human doctrine always requires explicit approval', () => {
  const proposal = build({
    candidate: candidate({ candidate_id: 'cand-doctrine', knowledge_class: 'HUMAN_DOCTRINE',
      target: { namespace: 'production-doctrine', reference_id: 'brand-rule' },
      statement: 'One claim, one example, one point per video.' }),
    canonical_snapshot: [],
  });
  assert.equal(proposal.classification.human_approval_required, true);
  assert.equal(proposal.human_approval.required, true);
  assert.equal(proposal.disposition, 'HUMAN_REVIEW_REQUIRED');
});

test('KS17: a specialist conclusion never becomes human doctrine authority', () => {
  const proposal = build({
    candidate: candidate({ candidate_id: 'cand-spec', proposing_agent: 'qc_director', knowledge_class: 'PROJECT_KNOWLEDGE',
      target: { namespace: 'project-knowledge', reference_id: 'qc-note' } }),
    canonical_snapshot: [],
  });
  assert.equal(proposal.authority.authority, 'SPECIALIST_CONCLUSION');
  assert.match(proposal.authority.reason, /proposal authority only, never human doctrine/);
  assert.notEqual(proposal.authority.authority, 'HUMAN_VERDICT');
});

test('KS18: an unsupported claim stays UNVERIFIED and needs review', () => {
  const proposal = build({
    candidate: candidate({ candidate_id: 'cand-prose', knowledge_class: 'PROJECT_KNOWLEDGE',
      statement: 'Shorter intros probably perform better.', source_artifacts: [], evidence: {},
      target: { namespace: 'project-knowledge', reference_id: 'intro-note' } }),
    canonical_snapshot: [],
  });
  assert.equal(proposal.authority.authority, 'UNVERIFIED');
  assert.equal(proposal.disposition, 'HUMAN_REVIEW_REQUIRED');
});

test('KS19: agent governance is reference-only and can never mutate the registry', () => {
  const proposal = build({
    candidate: candidate({ candidate_id: 'cand-gov', knowledge_class: 'AGENT_GOVERNANCE',
      statement: 'QC Director became IMPLEMENTATION_PROVEN on 2026-08-25.',
      target: { namespace: 'agent-governance', reference_id: 'qc-promotion' } }),
    canonical_snapshot: [],
  });
  assert.equal(proposal.classification.governance_reference_only, true);
  assert.equal(proposal.classification.human_approval_required, true);
  assert.ok(ks.PROHIBITED_ACTIONS.includes('MUTATE_AGENT_REGISTRY'));
});

// ── 11. source verification ───────────────────────────────────────────────

test('KS20: a source hash mismatch blocks the proposal', () => {
  const root = repo();
  const source = writeSource(root, 'package-runs/demo/evidence.json', '{"verdict":"PASS"}\n');
  const proposal = build({
    candidate: candidate({
      source_artifacts: [{ artifact_id: 'ev-1', path: source.relative, sha256: ks.sha256('DIFFERENT BYTES'), kind: 'PROOF_PACKAGE' }],
    }),
    canonical_snapshot: [],
  }, { repoRoot: root });
  assert.equal(proposal.disposition, 'BLOCKED');
  assert.equal(proposal.blockers[0].code, 'KS_SOURCE_HASH_MISMATCH');
  assert.equal(proposal.sources[0].state, 'HASH_MISMATCH');
});

test('KS21: a verified deterministic source yields DETERMINISTIC_PROOF authority', () => {
  const root = repo();
  const source = writeSource(root, 'package-runs/demo/proof.json', '{"verdict":"PRODUCTION_PATH_PROOF_PASS"}\n');
  const proposal = build({
    candidate: candidate({
      source_artifacts: [{ artifact_id: 'proof-1', path: source.relative, sha256: source.sha256, kind: 'PROOF_PACKAGE' }],
    }),
    canonical_snapshot: [],
  }, { repoRoot: root });
  assert.equal(proposal.sources[0].state, 'VERIFIED');
  assert.equal(proposal.authority.authority, 'DETERMINISTIC_PROOF');
  assert.equal(proposal.disposition, 'PROPOSAL_READY');
});

test('KS22: an unreadable source blocks rather than being ignored', () => {
  const root = repo();
  const proposal = build({
    candidate: candidate({ source_artifacts: [{ artifact_id: 'gone', path: 'package-runs/demo/absent.json', kind: 'PROOF_PACKAGE' }] }),
    canonical_snapshot: [],
  }, { repoRoot: root });
  assert.equal(proposal.disposition, 'BLOCKED');
  assert.equal(proposal.blockers[0].code, 'KS_SOURCE_UNREADABLE');
});

// ── 17. path safety ───────────────────────────────────────────────────────

test('KS23: path traversal and absolute escapes are refused', () => {
  const root = repo();
  const escaped = build({
    candidate: candidate({ source_artifacts: [{ artifact_id: 'esc', path: '../../etc/passwd', kind: 'PROOF_PACKAGE' }] }),
    canonical_snapshot: [],
  }, { repoRoot: root });
  assert.equal(escaped.disposition, 'BLOCKED');
  assert.equal(escaped.blockers[0].code, 'KS_PATH_ESCAPE');

  // A source may never reach the sibling brain repository.
  const brain = build({
    candidate: candidate({ source_artifacts: [{ artifact_id: 'brain', path: '../hermes-organiser/brain/index.json', kind: 'PROOF_PACKAGE' }] }),
    canonical_snapshot: [],
  }, { repoRoot: root });
  assert.equal(brain.blockers[0].code, 'KS_PATH_ESCAPE');
});

test('KS24: proposal output is confined to the allowlisted proposal root', () => {
  const root = repo();
  assert.throws(() => ks.proposalPaths(root, '../../escape'), (e) => e.code === 'KS_ID_INVALID');
  assert.throws(() => ks.proposalPaths(root, 'nested/child'), (e) => e.code === 'KS_ID_INVALID');
  const paths = ks.proposalPaths(root, 'ksp-cand-001-r1');
  assert.ok(paths.dir.startsWith(path.join(root, 'governance', 'knowledge-proposals')));
  assert.equal(ks.PROPOSAL_ROOT, path.join('governance', 'knowledge-proposals'));
});

// ── 18. source immutability ───────────────────────────────────────────────

test('KS25: the steward never mutates the source evidence it reads', () => {
  const root = repo();
  const source = writeSource(root, 'package-runs/demo/human-review.json', '{"decision":"APPROVE","by":"Mikko"}\n');
  const before = ks.sha256(fs.readFileSync(source.absolute));
  const input = {
    candidate: candidate({ source_artifacts: [{ artifact_id: 'hr-1', path: source.relative, sha256: source.sha256, kind: 'HUMAN_REVIEW' }] }),
    canonical_snapshot: [],
  };
  const frozen = JSON.stringify(input);
  const proposal = build(input, { repoRoot: root });
  ks.writeProposal(proposal, { repoRoot: root });
  assert.equal(ks.sha256(fs.readFileSync(source.absolute)), before, 'source evidence must be byte-identical');
  assert.equal(JSON.stringify(input), frozen, 'the input must not be mutated');
  assert.equal(proposal.authority.authority, 'HUMAN_VERDICT');
});

// ── 12-13. digest stability and revision ──────────────────────────────────

test('KS26: identical inputs produce an identical proposal digest', () => {
  const a = ks.createKnowledgeProposal({ candidate: candidate(), canonical_snapshot: [] }, { now: '2026-01-01T00:00:00.000Z', repoRoot: ROOT });
  const b = ks.createKnowledgeProposal({ candidate: candidate(), canonical_snapshot: [] }, { now: '2026-12-31T23:59:59.000Z', repoRoot: ROOT });
  assert.equal(a.proposal_digest_sha256, b.proposal_digest_sha256, 'digest must exclude volatile timestamps');
  assert.notEqual(a.created_at, b.created_at);
});

test('KS27: a revised proposal gets a new identity and a new digest', () => {
  const first = build({ candidate: candidate(), canonical_snapshot: [] });
  const revised = build({ candidate: candidate({ statement: 'A materially different durable statement.' }), canonical_snapshot: [] }, { revision: 2 });
  assert.notEqual(first.proposal_digest_sha256, revised.proposal_digest_sha256);
  assert.equal(first.proposal_id, 'ksp-cand-001-r1');
  assert.equal(revised.proposal_id, 'ksp-cand-001-r2');
  assert.equal(revised.revision, 2);
});

// ── 14-15. approval binding ───────────────────────────────────────────────

function approvalFor(proposal, overrides = {}) {
  return {
    approved_by: 'Mikko', approved_at: NOW,
    proposal_digest_sha256: proposal.proposal_digest_sha256,
    target_namespace: proposal.target.namespace,
    operation: proposal.operation,
    ...overrides,
  };
}

test('KS28: an exact approval binds and moves the proposal to await the canonical writer', () => {
  const proposal = build({ candidate: candidate({ knowledge_class: 'HUMAN_DOCTRINE' }), canonical_snapshot: [] });
  const bound = ks.bindApproval(proposal, approvalFor(proposal));
  assert.equal(bound.human_approval.state, 'VALID');
  assert.equal(bound.disposition, 'APPROVED_AWAITING_CANONICAL_WRITER');
  assert.equal(bound.applied, false, 'even an approved proposal is never applied by this library');
  assert.match(bound.reason, /owned by the Hermes-side canonical writer/);
  // The original proposal object is untouched.
  assert.equal(proposal.disposition, 'HUMAN_REVIEW_REQUIRED');
});

test('KS29: a stale approval is refused — approve P1, change to P2, apply P1', () => {
  const p1 = build({ candidate: candidate({ knowledge_class: 'HUMAN_DOCTRINE' }), canonical_snapshot: [] });
  const approval = approvalFor(p1);
  const p2 = build({
    candidate: candidate({ knowledge_class: 'HUMAN_DOCTRINE', statement: 'A different statement than the one Mikko approved.' }),
    canonical_snapshot: [],
  });
  const bound = ks.bindApproval(p2, approval);
  assert.equal(bound.human_approval.state, 'STALE');
  assert.equal(bound.disposition, 'BLOCKED');
  assert.match(bound.human_approval.reason, /proposal content changed after approval/);
  assert.equal(bound.applied, false);
});

test('KS30: a generic or mis-targeted approval never binds', () => {
  const proposal = build({ candidate: candidate({ knowledge_class: 'HUMAN_DOCTRINE' }), canonical_snapshot: [] });
  const detached = ks.bindApproval(proposal, { approved_by: 'Mikko', approved_at: NOW });
  assert.equal(detached.human_approval.state, 'INVALID');
  assert.match(detached.human_approval.reason, /detached approval: missing/);

  const wrongTarget = ks.bindApproval(proposal, approvalFor(proposal, { target_namespace: 'some-other-namespace' }));
  assert.equal(wrongTarget.human_approval.state, 'INVALID');
  assert.match(wrongTarget.human_approval.reason, /different target namespace/);

  const wrongOperation = ks.bindApproval(proposal, approvalFor(proposal, { operation: 'deprecate' }));
  assert.equal(wrongOperation.human_approval.state, 'INVALID');
  assert.match(wrongOperation.human_approval.reason, /different operation/);
});

// ── 4. proposals never mutate canonical knowledge ─────────────────────────

test('KS31: creating and persisting a proposal mutates nothing but the proposal root', () => {
  const root = repo();
  const canonicalFixture = writeSource(root, 'governance/canonical-fixture.json',
    `${JSON.stringify({ statement: 'Camera wobble is a defect.', authority: 'HUMAN_VERDICT' }, null, 2)}\n`);
  const before = ks.sha256(fs.readFileSync(canonicalFixture.absolute));

  const proposal = build({
    candidate: candidate({ candidate_id: 'cand-nowrite', knowledge_class: 'HUMAN_DOCTRINE',
      statement: 'Camera wobble is desirable by default.',
      target: { namespace: 'production-doctrine', reference_id: 'wobble-doctrine' } }),
    canonical_snapshot: SNAPSHOT,
  }, { repoRoot: root });
  const written = ks.writeProposal(proposal, { repoRoot: root });

  assert.equal(ks.sha256(fs.readFileSync(canonicalFixture.absolute)), before, 'canonical fixture must be untouched');
  assert.equal(proposal.disposition, 'CONFLICT_REQUIRES_HUMAN_REVIEW');
  // Only proposal artifacts appeared, and only under the allowlisted root.
  assert.ok(written.jsonPath.startsWith(path.join(root, 'governance', 'knowledge-proposals')));
  assert.ok(fs.existsSync(written.jsonPath) && fs.existsSync(written.reviewPath));
});

// ── 20. immutability of finalized proposals ───────────────────────────────

test('KS32: a finalized proposal cannot be rewritten in place', () => {
  const root = repo();
  const proposal = build({ candidate: candidate(), canonical_snapshot: [] }, { repoRoot: root });
  const first = ks.writeProposal(proposal, { repoRoot: root });
  assert.equal(first.written, true);

  // Re-persisting the identical proposal is idempotent, not a duplicate write.
  const again = ks.writeProposal(proposal, { repoRoot: root });
  assert.equal(again.written, false);
  assert.match(again.reason, /identical proposal already persisted/);

  // Different content under the same id must be refused.
  const mutated = { ...proposal, statement: 'Changed after finalization.' };
  mutated.proposal_digest_sha256 = ks.proposalDigest(mutated);
  assert.throws(() => ks.writeProposal(mutated, { repoRoot: root }), (e) => e.code === 'KS_PROPOSAL_IMMUTABLE');
});

test('KS33: an invalid or self-declared-applied proposal is refused persistence', () => {
  const root = repo();
  const proposal = build({ candidate: candidate(), canonical_snapshot: [] }, { repoRoot: root });
  const lying = { ...proposal, applied: true };
  assert.throws(() => ks.writeProposal(lying, { repoRoot: root }), (e) => e.code === 'KS_PROPOSAL_INVALID');
  const validation = ks.validateProposal(lying);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((e) => /never report itself as applied/.test(e)));
});

// ── human review artifact ─────────────────────────────────────────────────

test('KS34: the review artifact is unmistakably a proposal, not an applied change', () => {
  const proposal = build({
    candidate: candidate({ candidate_id: 'cand-review', knowledge_class: 'HUMAN_DOCTRINE',
      statement: 'Camera wobble is desirable by default.',
      target: { namespace: 'production-doctrine', reference_id: 'wobble-doctrine' } }),
    canonical_snapshot: SNAPSHOT,
  });
  const md = ks.renderReviewMarkdown(proposal);
  assert.match(md, /# Proposed knowledge change/);
  assert.match(md, /PROPOSAL_ONLY — NOT APPLIED/);
  assert.match(md, /NOT_CANONICAL_KNOWLEDGE/);
  assert.match(md, /MIKKO_APPROVAL_REQUIRED/);
  for (const section of ['## Current', '## Proposed', '## Why', '## Sources', '## Conflicts / duplicates', '## Impact', '## Required authority', '## Status']) {
    assert.ok(md.includes(section), `review artifact must contain ${section}`);
  }
  // The existing doctrine must appear under Current, not only under Conflicts:
  // a reviewer told "nothing exists here" could approve an overwrite blind.
  const currentSection = md.split('## Current')[1].split('## Proposed')[0];
  assert.match(currentSection, /Camera wobble is a defect\./, 'Current must show the existing canonical statement');
  assert.match(currentSection, /seen as conflict/);
  assert.ok(!/no existing statement found/.test(currentSection), 'must not claim the reference is empty when it is not');
  assert.match(md, /Applied: \*\*false\*\*/);
});

test('KS35: an unavailable canonical state is stated, never guessed', () => {
  const proposal = build({ candidate: candidate() });
  const md = ks.renderReviewMarkdown(proposal);
  assert.match(md, /\*\*UNKNOWN\*\*/);
  assert.match(md, /no canonical snapshot was supplied/);
  assert.equal(proposal.canonical_comparison.state, 'CANONICAL_STATE_UNAVAILABLE_FOR_COMPARISON');
});

// ── support projection ────────────────────────────────────────────────────

test('KS36: the support projection is not an agent control-room row', () => {
  const proposals = [
    build({ candidate: candidate({ candidate_id: 'p1', knowledge_class: 'HUMAN_DOCTRINE' }), canonical_snapshot: [] }),
    build({ candidate: candidate({ candidate_id: 'p2', knowledge_class: 'TEMPORARY_RUNTIME_STATE' }), canonical_snapshot: [] }),
  ];
  const view = ks.supportProjection(proposals);
  assert.equal(view.kind, 'SUPPORT_ROLE');
  assert.equal(view.is_agent, false);
  assert.equal(view.canonical_mutations_performed, 0);
  assert.equal(view.canonical_store_writable, false);
  assert.equal(view.pending_human_review, 1);
  assert.equal(view.proposals_total, 2);
  // It must not masquerade as an agent projection.
  for (const key of ['implementation_state', 'lifecycle', 'control_capabilities', 'agent_id']) {
    assert.ok(!(key in view), `support projection must not expose agent field ${key}`);
  }
});

test('KS37: knowledge steward does not appear in the agent control room', async () => {
  const controlRoom = require('../scripts/agent-control-room.js');
  const room = await controlRoom.buildAgentControlRoom({ root: ROOT });
  assert.equal(room.agents.length, 12, 'the control room must show exactly the 12 production agents');
  assert.equal(room.agents.some((a) => a.agent_id === 'knowledge_steward'), false);
});
