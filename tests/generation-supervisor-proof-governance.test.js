'use strict';

// Generation Supervisor proof correction — the record must stay honest about a
// promotion that was never earned, and must never quietly become a new
// promotion decision.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const RECORD_PATH = path.join(ROOT, 'governance', 'generation-supervisor-implementation-proof-correction.json');

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function git(...args) { return execFileSync('git', args, { cwd: ROOT }); }
function record() { return JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8')); }

test('GSG1: the correction records an unearned promotion without rewriting history', () => {
  const r = record();
  assert.equal(r.record_type, 'agent_implementation_proof_correction');
  assert.equal(r.role, 'generation_supervisor');
  assert.equal(r.registry_value_changed, false, 'this correction changes no registry value');
  assert.equal(r.registry_state_before_correction, r.registry_state_after_correction);
  assert.match(r.statement, /THE ORIGINAL PROMOTION WAS NOT VALID/);
  assert.equal(r.historical_cause.module_never_exported_identity, true);
  assert.match(r.historical_cause.conclusion, /never earned/i);

  // It must not masquerade as a promotion decision or manufacture authority.
  assert.notEqual(r.record_type, 'agent_implementation_promotion_decision');
  assert.equal(r.human_authorization_required, false);
  assert.equal(r.authority_effect.approval_created, false);
  assert.equal(r.authority_effect.qc_authority_created, false);
  assert.equal(r.authority_effect.publication_authority_created, false);
  assert.equal(r.authority_effect.lifecycle_proven_changed, false);
  const serialized = JSON.stringify(r);
  assert.equal(serialized.includes('approved_by'), false);
  assert.equal(serialized.includes('PROMOTE_IMPLEMENTATION'), false);
});

test('GSG2: the recorded history is verifiable against git, not asserted', () => {
  const r = record();
  for (const entry of r.historical_cause.module_history) {
    const source = git('show', `${entry.commit}:scripts/generation-supervisor.js`).toString('utf8');
    const occurrences = (source.match(/module\.exports/g) || []).length;
    assert.equal(occurrences, entry.module_exports_occurrences,
      `${entry.commit}: recorded export count must match the real commit`);
    assert.equal(occurrences, 0, 'the module never declared identity in any historical commit');
  }
  // The named backfill commit really did introduce the field and really did
  // hold exactly three roles back at CANDIDATE.
  const promotion = r.historical_cause.promotion_commit;
  const registry = JSON.parse(git('show', `${promotion.commit}:config/agent-registry.json`).toString('utf8'));
  const observed = Object.fromEntries(registry.agents.map((a) => [a.agent_id, a.implementation_state ?? null]));
  assert.deepEqual(observed, promotion.backfill_decision);
  assert.equal(observed.generation_supervisor, 'IMPLEMENTATION_PROVEN');
  const parentRegistry = JSON.parse(git('show', `${promotion.commit}^:config/agent-registry.json`).toString('utf8'));
  const parentEntry = parentRegistry.agents.find((a) => a.agent_id === 'generation_supervisor');
  assert.equal(parentEntry.implementation_state, undefined,
    'the field did not exist before the backfill commit, so this was never an earned promotion');
});

test('GSG3: the correction binds the exact repaired module and proof package', () => {
  const r = record();
  // History is preserved: the original repair binding still names the module as
  // it was proven. Legitimate later growth is recorded in subsequent_extensions,
  // each binding the hash at that point, so drift is still detectable without
  // erasing what was originally proven.
  const extensions = r.subsequent_extensions || [];
  const currentBinding = extensions.length ? extensions[extensions.length - 1] : r.repair;
  assert.equal(
    currentBinding.module_sha256,
    sha256(fs.readFileSync(path.join(ROOT, currentBinding.module_path))),
    'the bound module must still be the module that was proven'
  );
  assert.match(r.repair.module_sha256, /^[0-9a-f]{64}$/, 'the original repair binding is retained as history');
  for (const extension of extensions) {
    assert.equal(extension.supersedes_binding !== undefined, true, 'each extension names the binding it supersedes');
    assert.equal(extension.generation_behaviour_changed, false, 'extensions must not silently change generation behaviour');
  }
  assert.equal(
    r.proof_binding.proof_summary_sha256,
    sha256(fs.readFileSync(path.join(ROOT, r.proof_binding.proof_summary))),
    'the bound proof summary must be unmodified'
  );
  const summary = JSON.parse(fs.readFileSync(path.join(ROOT, r.proof_binding.proof_summary), 'utf8'));
  assert.equal(summary.verdict, 'PRODUCTION_PATH_PROOF_PASS');
  assert.equal(summary.defect_under_investigation.before.code, 'RUNNER_AGENT_ID_MISMATCH',
    'the BEFORE defect must be preserved in the proof, not erased by the repair');
  assert.equal(summary.live_state_untouched.registry_unchanged, true);
  assert.equal(summary.bounded_workload.generation_dispatched, false);
});

test('GSG4: the repair claims no behavioural change it did not make', () => {
  const r = record();
  assert.equal(r.repair.generation_behaviour_changed, false);
  assert.equal(r.repair.input_contract_changed, false);
  // The claim above is only credible because the pre-existing suite still
  // passes unmodified; assert those tests were not edited by this repair.
  const changed = git('diff', '--name-only', 'HEAD', '--', 'tests/generation-supervisor.test.js',
    'tests/generation-package-bridge.test.js').toString().trim();
  assert.equal(changed, '', 'the pre-existing generation suites must remain unmodified by this repair');
});

test('GSG5: the registry claim is now true on the live production path', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const registration = registry.agents.find((a) => a.agent_id === 'generation_supervisor');
  assert.equal(registration.implementation_state, 'IMPLEMENTATION_PROVEN');

  const readiness = require('../scripts/agent-dispatch-authority.js').implementationReadiness(ROOT, registration);
  assert.equal(readiness.authorized, true);

  // The decisive check: the runner reads the module's DECLARED identity.
  const resolved = require('../scripts/agent-run.js').resolveAgent(ROOT, 'generation_supervisor');
  assert.equal(resolved.registration.agent_id, 'generation_supervisor');
  assert.equal(require('../scripts/generation-supervisor.js').AGENT_ID, 'generation_supervisor');

  const validator = require('../scripts/agent-contract-validator.js').main([]);
  assert.equal(validator.ok, true, `agent contract must remain VALID: ${validator.errors.join('; ')}`);
  assert.ok(validator.summary.implementation_dispatchable.includes('generation_supervisor'));
});
