'use strict';

// QC Director promotion governance — the promotion must be provably bounded:
// one readiness field, no authority drift, no fabricated human approval, and a
// durable record that is honest about not being cryptographically authenticated.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const RECORD_PATH = path.join(ROOT, 'governance', 'qc-director-implementation-promotion.json');
const EVOLUTION_ADDENDUM_PATH = path.join(ROOT, 'governance', 'qc-director-implementation-evolution-addendum.json');
const PROMOTION_COMMIT = 'de3250c1e67a4a3c19c5ef8efa987421927d46dc';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function git(...args) { return execFileSync('git', args, { cwd: ROOT }); }
function registryAt(revision) { return JSON.parse(git('show', `${revision}:config/agent-registry.json`).toString('utf8')); }
function role(registry, id) { return registry.agents.find((agent) => agent.agent_id === id); }

test('QCG1: the promotion record is durable, bounded and honestly unauthenticated', () => {
  const record = JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'));
  assert.equal(record.record_type, 'agent_implementation_promotion_decision');
  assert.equal(record.decision, 'PROMOTE_IMPLEMENTATION');
  assert.equal(record.role, 'qc_director');
  assert.equal(record.prior_implementation_state, 'CANDIDATE');
  assert.equal(record.resulting_implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.equal(record.decision_maker.identity, 'Mikko');
  assert.equal(record.decision_maker.authenticated, false);
  assert.match(record.decision_maker.authentication_note, /no cryptographic proof/i);
  assert.equal(record.promotion_commit.commit, PROMOTION_COMMIT);
  assert.equal(record.promotion_commit.commit_object_sha256, sha256(git('cat-file', 'commit', PROMOTION_COMMIT)));
  assert.deepEqual(record.promotion_commit.semantic_diff.changed_fields, ['qc_director.implementation_state']);
  assert.equal(record.promotion_commit.semantic_diff.lifecycle_or_authority_fields_changed, false);
  assert.equal(record.promotion_commit.semantic_diff.other_roles_changed, false);

  // The promotion must not manufacture any approval authority.
  assert.equal(record.authority_effect.approval_created, false);
  assert.equal(record.authority_effect.publication_authority_created, false);
  assert.equal(record.authority_effect.takeover_eligibility_created, false);
  assert.equal(record.authority_effect.aesthetic_authority_created, false);
  assert.equal(record.authority_effect.doctrine_changed, false);
  assert.match(record.statement, /PROMOTION WAS HUMAN-AUTHORIZED/);
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes('approved_by'), false, 'a promotion record must never carry approval fields');
  assert.equal(serialized.includes('approval_binding'), false);
});

test('QCG2: the promotion record binds the exact implementation and proof package', () => {
  const record = JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'));
  assert.equal(record.implementation_binding.module_path, 'scripts/qc-director.js');

  // The promoted module must still be the module the decision bound — either
  // byte-identical to the original binding, or the current binding carried by
  // a durable evolution addendum that itself is honest (no readiness/authority
  // change, original promotion record referenced and unmodified by the chain
  // rule). Governance history is never rewritten; it is appended.
  const currentHash = sha256(fs.readFileSync(path.join(ROOT, 'scripts', 'qc-director.js')));
  if (currentHash === record.implementation_binding.module_sha256) {
    // Original binding still holds verbatim; no addendum needed.
  } else {
    assert.ok(fs.existsSync(EVOLUTION_ADDENDUM_PATH),
      'a promoted module that drifted from its binding requires an evolution addendum');
    const addendum = JSON.parse(fs.readFileSync(EVOLUTION_ADDENDUM_PATH, 'utf8'));
    assert.equal(addendum.record_type, 'implementation_promotion_evolution_addendum');
    assert.equal(addendum.role, 'qc_director');
    assert.equal(addendum.references_promotion_record, 'governance/qc-director-implementation-promotion.json');
    assert.equal(addendum.historical_promotion_record_unchanged, true);

    // The hash chain must hold end-to-end: promotion binding -> each recorded
    // evolution's before/after -> the addendum's current binding -> the bytes
    // on disk. Every hop asserts zero authority effect.
    const chain = Array.isArray(addendum.evolution_chain) && addendum.evolution_chain.length > 0
      ? addendum.evolution_chain
      : [{
        scope: addendum.evolution.scope,
        module_sha256_before: addendum.evolution.module_sha256_before,
        module_sha256_after: addendum.evolution.module_sha256_after,
        implementation_state_changed: addendum.evolution.implementation_state_changed,
        registry_changed: addendum.evolution.registry_changed,
        lifecycle_or_gate_authority_added: addendum.evolution.lifecycle_or_gate_authority_added,
        human_approval_authority_added: addendum.evolution.human_approval_authority_added,
      }];
    let expected = record.implementation_binding.module_sha256;
    for (const hop of chain) {
      assert.equal(hop.module_sha256_before, expected,
        'an evolution hop must chain from the exact hash of the previous binding');
      assert.equal(hop.implementation_state_changed, false);
      assert.equal(hop.registry_changed, false);
      assert.equal(hop.lifecycle_or_gate_authority_added, false);
      assert.equal(hop.human_approval_authority_added, false);
      expected = hop.module_sha256_after;
    }
    assert.equal(addendum.current_module_binding.module_sha256, expected,
      'the addendum must bind the exact terminal module hash of the chain');
    assert.equal(addendum.current_module_binding.module_sha256, currentHash,
      'the addendum must bind the exact module that is on disk now');
  }

  assert.equal(
    record.proof_binding.proof_manifest_sha256,
    sha256(fs.readFileSync(path.join(ROOT, record.proof_binding.proof_manifest))),
    'the bound proof manifest must be unmodified'
  );
  assert.equal(
    record.proof_binding.pre_promotion_refusal_sha256,
    sha256(fs.readFileSync(path.join(ROOT, record.proof_binding.pre_promotion_refusal_evidence))),
    'the pre-promotion refusal evidence must be preserved verbatim'
  );
  assert.equal(record.proof_binding.criteria_result, '10/10 PASS');

  // The historical proof package must still say promotion was not performed there.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, record.proof_binding.proof_manifest), 'utf8'));
  assert.match(manifest.promotion, /^NOT_PERFORMED/);
  assert.equal(manifest.registry_snapshot_at_proof.implementation_state, 'CANDIDATE');
});

test('QCG3: the promotion commit changes one readiness field and preserves every boundary', () => {
  const before = registryAt(`${PROMOTION_COMMIT}^`);
  const after = registryAt(PROMOTION_COMMIT);
  const beforeRole = role(before, 'qc_director');
  const afterRole = role(after, 'qc_director');
  assert.equal(beforeRole.implementation_state, 'CANDIDATE');
  assert.equal(afterRole.implementation_state, 'IMPLEMENTATION_PROVEN');

  const normalized = structuredClone(after);
  role(normalized, 'qc_director').implementation_state = 'CANDIDATE';
  assert.deepEqual(normalized, before, 'nothing but the readiness field may differ');

  assert.deepEqual(afterRole.lifecycle, beforeRole.lifecycle);
  assert.deepEqual(afterRole.allowed_actions, beforeRole.allowed_actions);
  assert.deepEqual(afterRole.prohibited_actions, beforeRole.prohibited_actions);
  assert.deepEqual(afterRole.escalation_rules, beforeRole.escalation_rules);
  assert.equal(
    git('diff-tree', '--no-commit-id', '--name-only', '-r', PROMOTION_COMMIT).toString().trim(),
    'config/agent-registry.json',
    'a promotion commit must touch the registry and nothing else'
  );
  // Camera Director is a separate, still-unproven role and must be untouched.
  assert.equal(role(after, 'camera_director').implementation_state, 'CANDIDATE');
});

test('QCG4: the pre-promotion refusal baseline is preserved as authority evidence', () => {
  const record = JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'));
  const refusal = JSON.parse(fs.readFileSync(path.join(ROOT, record.proof_binding.pre_promotion_refusal_evidence), 'utf8'));
  assert.equal(refusal.registry_implementation_state, 'CANDIDATE');
  assert.equal(refusal.module_exists, true, 'the historical point is that the module existed and was still refused');
  assert.equal(refusal.all_paths_refused, true);
  for (const key of ['canonical_runner', 'direct_cli', 'operator_retry_preview']) {
    const observed = refusal.paths[key];
    assert.equal(
      observed.infrastructure_state || observed.code, 'BLOCKED_IMPLEMENTATION_NOT_PROVEN',
      `${key} must have refused before promotion`
    );
  }
});

test('QCG5: after promotion the contract and the live implementation tell the same truth', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-contract.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const roleEntry = contract.role_roster.find((entry) => entry.role_id === 'qc_director');
  const registration = role(registry, 'qc_director');
  assert.equal(roleEntry.status, 'BUILT');
  assert.equal(registration.implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts', 'qc-director.js')), true,
    'a BUILT + IMPLEMENTATION_PROVEN role must have its canonical module on disk');

  const readiness = require('../scripts/agent-dispatch-authority.js').implementationReadiness(ROOT, registration);
  assert.equal(readiness.authorized, true, 'dispatch must now be authorized');
  assert.equal(readiness.code, null);

  const validator = require('../scripts/agent-contract-validator.js').main([]);
  assert.equal(validator.ok, true, `agent contract must remain VALID: ${validator.errors.join('; ')}`);
  assert.ok(validator.summary.implementation_dispatchable.includes('qc_director'));
  assert.ok(!validator.summary.implementation_candidates.includes('qc_director'));
});
