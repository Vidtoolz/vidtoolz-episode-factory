'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, tests } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const RECORD_PATH = path.join(ROOT, 'governance', 'production-operations-implementation-promotion.json');
const ADDENDUM_PATH = path.join(ROOT, 'package-runs', '2026-08-24-production-operations-proof-v2.1', 'post-promotion-governance-addendum.json');
const PROMOTION_COMMIT = 'b23c9bb90ff16c0b86c1f4a236c3f9d7097a8ae6';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function bytes(relative) { return fs.readFileSync(path.join(ROOT, relative)); }
function git(...args) { return execFileSync('git', args, { cwd: ROOT }); }
function registryAt(revision) { return JSON.parse(git('show', `${revision}:config/agent-registry.json`).toString('utf8')); }
function role(registry, id) { return registry.agents.find((agent) => agent.agent_id === id); }

test('POG1: Mikko implementation-promotion authorization is durable, bounded, and honestly unauthenticated', () => {
  const record = JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'));
  assert.equal(record.record_type, 'agent_implementation_promotion_decision');
  assert.equal(record.decision, 'PROMOTE_IMPLEMENTATION');
  assert.equal(record.role, 'production_operations');
  assert.equal(record.prior_implementation_state, 'CANDIDATE');
  assert.equal(record.resulting_implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.equal(record.decision_maker.identity, 'Mikko');
  assert.equal(record.decision_maker.authenticated, false);
  assert.match(record.decision_maker.authentication_note, /no cryptographic proof/i);
  assert.equal(record.promotion_commit.commit, PROMOTION_COMMIT);
  assert.equal(record.promotion_commit.commit_object_sha256, sha256(git('cat-file', 'commit', PROMOTION_COMMIT)));
  assert.deepEqual(record.promotion_commit.semantic_diff.changed_fields, ['production_operations.implementation_state']);
  assert.equal(record.promotion_commit.semantic_diff.lifecycle_or_authority_fields_changed, false);
  assert.equal(record.promotion_commit.semantic_diff.other_roles_changed, false);
  assert.equal(record.authority_effect.approval_created, false);
  assert.equal(record.authority_effect.publication_authority_created, false);
  assert.equal(record.authority_effect.takeover_eligibility_created, false);
  assert.match(record.statement, /PROMOTION WAS HUMAN-AUTHORIZED/);
  assert.equal(JSON.stringify(record).includes('approved_by'), false);
  assert.equal(JSON.stringify(record).includes('approval_binding'), false);
});

test('POG2: proof history remains immutable and the post-promotion addendum binds every predecessor', () => {
  const addendum = JSON.parse(fs.readFileSync(ADDENDUM_PATH, 'utf8'));
  const expected = new Map([
    ['package-runs/2026-08-24-production-operations-proof/proof-manifest.json', 'bd26e582fea53e57887c308b1dd6e50b73de222d9497614486d9f908015aa0b8'],
    ['package-runs/2026-08-24-production-operations-proof-v2/proof-manifest-v2.json', '553e85ee573ab8a39d6fc3155fbb64f93981d791fe3f2f42e818b60df4b4a4d0'],
    ['package-runs/2026-08-24-production-operations-proof-v2.1/proof-manifest-v2.1.json', '818384a6981dd3306b2584537e24f3aab1e34d7ff19c713330e050edb864e56a'],
    ['governance/production-operations-implementation-promotion.json', 'db04eb93250d72bd33e3cffe57d24337f3bc1eb41d266638b3bfdd86ef4a2347'],
  ]);
  for (const item of addendum.proof_history) {
    const relative = item.manifest || item.governance_record;
    assert.equal(item.sha256, expected.get(relative), relative);
    assert.equal(sha256(bytes(relative)), item.sha256, relative);
    expected.delete(relative);
  }
  assert.equal(expected.size, 0);
  const historical = JSON.parse(bytes('package-runs/2026-08-24-production-operations-proof-v2.1/proof-manifest-v2.1.json'));
  assert.match(historical.promotion, /^NOT_PERFORMED/);
  assert.equal(addendum.historical_manifests_unchanged, true);
  assert.equal(addendum.promotion.decision, 'PERFORMED');
  assert.equal(addendum.promotion.human_authorized, true);
  assert.equal(addendum.scope_limits.human_approval_created, false);
});

test('POG3: promotion commit changes one readiness field and preserves every authority boundary', () => {
  const beforeBytes = git('show', `${PROMOTION_COMMIT}^:config/agent-registry.json`);
  const afterBytes = git('show', `${PROMOTION_COMMIT}:config/agent-registry.json`);
  const before = registryAt(`${PROMOTION_COMMIT}^`), after = registryAt(PROMOTION_COMMIT);
  assert.equal(sha256(beforeBytes), '33cee763519511b68f58f2d14fb66b23f05426774970e8c5d35e90442795ed2d');
  assert.equal(sha256(afterBytes), '98f16f6959794f55ee2771b0bce416d1e6105a921387df3beb268ff1b8a978d6');
  const beforeRole = role(before, 'production_operations'), afterRole = role(after, 'production_operations');
  assert.equal(beforeRole.implementation_state, 'CANDIDATE');
  assert.equal(afterRole.implementation_state, 'IMPLEMENTATION_PROVEN');
  const normalizedAfter = structuredClone(after);
  role(normalizedAfter, 'production_operations').implementation_state = 'CANDIDATE';
  assert.deepEqual(normalizedAfter, before);
  assert.deepEqual(afterRole.lifecycle, beforeRole.lifecycle);
  assert.deepEqual(afterRole.allowed_actions, beforeRole.allowed_actions);
  assert.deepEqual(afterRole.prohibited_actions, beforeRole.prohibited_actions);
  assert.deepEqual(afterRole.escalation_triggers, beforeRole.escalation_triggers);
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', PROMOTION_COMMIT).toString().trim(), 'config/agent-registry.json');
});

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok - ${item.name}`); }
      catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; }
    }
    console.log(`${passed}/${tests.length} Production Operations promotion governance tests passed`);
  })();
}

module.exports = { tests };
