'use strict';

// 5ca7334 backfill class — audit + governance correction.
// Every historical claim in the record is re-derived from git, never trusted.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'package-runs', '2026-08-25-agent-backfill-dispatch-audit-v2');
const RECORD = path.join(ROOT, 'governance', 'agent-backfill-proof-correction.json');
const audit = require('../scripts/agent-backfill-dispatch-audit.js');

function sha256(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function git(...a) { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }); }
function record() { return JSON.parse(fs.readFileSync(RECORD, 'utf8')); }
function summary() { return JSON.parse(fs.readFileSync(path.join(PKG, 'backfill-audit-summary.json'), 'utf8')); }

test('BA1: the backfill population is derived from the commit, not hardcoded', () => {
  const derived = audit.backfillPopulation();
  assert.equal(derived.commit, '5ca7334d49fc5209612f3b889a4170df86c3025a');
  const ids = derived.population.map((p) => p.agent_id).sort();
  assert.deepEqual(ids, [
    'audience_packaging_director', 'editor', 'generation_supervisor', 'research_director',
    'sound_music_director', 'story_editor', 'visual_planning_director',
  ], 'the audit population is seven agents');
  // Every one went from field-absent to proven in a single commit.
  for (const entry of derived.population) {
    assert.equal(entry.before, 'FIELD_ABSENT');
    assert.equal(entry.after, 'IMPLEMENTATION_PROVEN');
  }
  // The field already existed: f87c26c had introduced it one commit earlier and
  // deliberately gated three agents at CANDIDATE. 5ca7334 then extended it to
  // these seven and defaulted every one to PROVEN instead.
  assert.equal(derived.field_existed_before, true);
  assert.deepEqual(derived.pre_existing_states, {
    production_operations: 'CANDIDATE', camera_director: 'CANDIDATE', qc_director: 'CANDIDATE',
  }, 'the preceding commit gated its agents at CANDIDATE, so PROVEN was not the established default');
});

test('BA2: the recorded history is verifiable against git', () => {
  const r = record();
  const commit = r.defect_class.backfill_commit.commit;
  const before = JSON.parse(git('show', `${commit}^:config/agent-registry.json`));
  const after = JSON.parse(git('show', `${commit}:config/agent-registry.json`));
  // The seven audited agents genuinely lacked the field beforehand...
  for (const entry of r.defect_class.backfill_commit.population) {
    assert.equal(before.agents.find((a) => a.agent_id === entry.agent_id).implementation_state, undefined, entry.agent_id);
  }
  // ...while the three the previous commit had gated were already CANDIDATE.
  for (const id of ['production_operations', 'camera_director', 'qc_director']) {
    assert.equal(before.agents.find((a) => a.agent_id === id).implementation_state, 'CANDIDATE', id);
  }
  // And every named agent genuinely became proven in that commit.
  for (const entry of r.defect_class.backfill_commit.population) {
    const row = after.agents.find((a) => a.agent_id === entry.agent_id);
    assert.equal(row.implementation_state, 'IMPLEMENTATION_PROVEN', entry.agent_id);
  }
  for (const id of r.defect_class.backfill_commit.held_back_at_candidate) {
    assert.equal(after.agents.find((a) => a.agent_id === id).implementation_state, 'CANDIDATE', id);
  }
});

test('BA3: the correction is honest about history and changes no registry value', () => {
  const r = record();
  assert.equal(r.record_type, 'agent_backfill_proof_correction');
  assert.equal(r.registry_values_changed, false);
  assert.equal(r.human_authorization_required, false);
  assert.equal(r.historical_promotion_quality.verdict, 'ORIGINAL_PROMOTION_EVIDENCE_ABSENT');
  assert.match(r.statement, /THE ORIGINAL BACKFILL WAS NOT PROOF/);
  assert.match(r.re_earned_agents.statement, /NOT validated retroactively/);
  // It must not manufacture authority or masquerade as a promotion decision.
  assert.equal(r.authority_effect.approval_created, false);
  assert.equal(r.authority_effect.lifecycle_proven_changed, false);
  assert.equal(r.authority_effect.specialist_behaviour_changed, false);
  assert.equal(r.authority_effect.canonical_production_agents, 12);
  const serialized = JSON.stringify(r);
  assert.equal(serialized.includes('approved_by'), false);
  assert.equal(serialized.includes('PROMOTE_IMPLEMENTATION'), false);
});

test('BA4: the correction binds the exact audit evidence', () => {
  const r = record();
  assert.equal(r.current_verification.audit_summary_sha256,
    sha256(fs.readFileSync(path.join(ROOT, r.current_verification.audit_package, 'backfill-audit-summary.json'))));
  assert.equal(r.current_verification.pre_repair_snapshot_sha256,
    sha256(fs.readFileSync(path.join(ROOT, r.current_verification.pre_repair_snapshot))));
  assert.equal(r.current_verification.audit_script_sha256,
    sha256(fs.readFileSync(path.join(ROOT, r.current_verification.audit_script))));
  assert.equal(r.current_verification.verdict, 'BACKFILL_CLASS_DISPATCH_VERIFIED');
});

test('BA5: the pre-repair truth snapshot preserves the historical contradiction', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(PKG, 'pre-repair-truth-snapshot.json'), 'utf8'));
  assert.equal(snapshot.record, 'PRE_REPAIR_TRUTH_SNAPSHOT');
  // Before the repair, sound_music_director alone did NOT refuse at the gate.
  assert.equal(snapshot.agents.sound_music_director.negative.refused_at_runner, false);
  for (const id of ['editor', 'research_director', 'story_editor', 'visual_planning_director', 'audience_packaging_director']) {
    assert.equal(snapshot.agents[id].negative.refused_at_runner, true, id);
    assert.equal(snapshot.agents[id].negative.error_code, 'RUNNER_ACTION_UNSUPPORTED', id);
  }
  assert.match(snapshot.why, /must not erase evidence/);
});

test('BA6: the audit summary shows every audited agent dispatch-verified today', () => {
  const s = summary();
  assert.equal(s.verdict, 'BACKFILL_CLASS_DISPATCH_VERIFIED');
  assert.deepEqual(s.unresolved_defects, []);
  assert.equal(s.registry_unchanged_by_audit, true, 'an audit must never mutate the registry');
  assert.equal(s.agents.length, 7);
  for (const a of s.agents) {
    assert.equal(a.historical_promotion_evidence, 'ORIGINAL_PROMOTION_EVIDENCE_ABSENT', a.agent_id);
    assert.equal(a.dispatch.positive.infrastructure_state, 'COMPLETE', a.agent_id);
    assert.equal(a.dispatch.positive.envelope_valid, true, a.agent_id);
    assert.equal(a.dispatch.positive.result_persisted, true, `${a.agent_id} must persist a durable result`);
    assert.equal(a.dispatch.negative.failed_closed, true, a.agent_id);
    assert.ok(['BACKFILL_SUPERSEDED_BY_REAL_PROOF', 'PROOF_MISSING_BUT_RUNTIME_VALID'].includes(a.classification), a.agent_id);
  }
  assert.equal(s.bounded_workload.external_jobs_triggered, false);
  assert.equal(s.bounded_workload.earth_studio_touched, false);
});

test('BA7: the sound_music_director repair is declarative and behaviour-preserving', () => {
  const r = record().repairs.sound_music_director;
  assert.equal(r.behaviour_changed, false);
  assert.equal(r.never_had_it.includes('original gap, not a regression'), true);
  // The exported vocabulary must be exactly what the module already validated.
  const smd = require('../scripts/sound-music-director.js');
  assert.deepEqual([...smd.ACTIONS], ['generate', 'evaluate', 'status']);
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'sound-music-director.js'), 'utf8');
  assert.ok(source.includes('ACTIONS.includes(action)'),
    'validateInputs must read the exported list, so there is a single source of truth');
  // The claim of behaviour preservation is only credible if the pre-existing
  // suite was not edited to accommodate the repair.
  const changed = git('diff', '--name-only', 'HEAD', '--', 'tests/sound-music-director.test.js').trim();
  assert.equal(changed, '', 'the pre-existing sound-music-director suite must remain unmodified');
});

test('BA8: no specialist reasoning was modified by this audit', () => {
  // The audit may repair module/runner contract truth only. Rather than a fuzzy
  // keyword scan, assert exactly which lines were allowed to change: the ACTIONS
  // declaration, the export list, and the single validateInputs check that now
  // reads it. Anything else in this file would be specialist behaviour.
  const diff = git('diff', 'HEAD', '--', 'scripts/sound-music-director.js');
  const changed = diff.split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1).trim())
    .filter((l) => l !== '' && !l.startsWith('//') && !l.startsWith('*'));

  const ALLOWED = [
    /^const ACTIONS = Object\.freeze\(\['generate', 'evaluate', 'status'\]\);$/,
    /^AGENT_ID,( ACTIONS,)? AUTHORIZED_LANE, STATE_OWNERS,$/,
    /^if \(!(\['generate', 'evaluate', 'status'\]|ACTIONS)\.includes\(action\)\) \{$/,
    /^result\.reason = `assignment\.action "\$\{action\}" is not one of /,
  ];
  for (const line of changed) {
    assert.ok(ALLOWED.some((re) => re.test(line)),
      `audit may only change the action contract, not behaviour: ${line.slice(0, 100)}`);
  }
  assert.ok(changed.length <= 8, `the module-contract repair must stay narrow (changed ${changed.length} lines)`);

  // And the exported vocabulary must be exactly what the module already used.
  const smd = require('../scripts/sound-music-director.js');
  assert.deepEqual([...smd.ACTIONS], ['generate', 'evaluate', 'status']);
});