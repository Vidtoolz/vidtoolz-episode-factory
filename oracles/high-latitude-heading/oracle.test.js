#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const cp = require('child_process');
const path = require('path');
const C = require('./comparator.js');
const corpus = require('./corpus.json');

const repo = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const ref = process.argv[3] || corpus.production_sha;
const mode = process.argv[4] || 'production';
const raw = cp.execFileSync(process.execPath, [path.join(__dirname, 'run.js'), repo, ref], { encoding: 'utf8', maxBuffer: 1024 ** 3 });
const result = JSON.parse(raw);
const byId = (id) => result.planner_cases.find((row) => row.id === id);

assert.equal(result.independent_reference.envelope_cases, 504);
assert.ok(result.independent_reference.max_bearing_vs_enu_difference_deg <= corpus.reference_contract.enu_bearing_agreement_deg);
assert.equal(result.acceptance.doctrine_explicit, true);
assert.equal(result.acceptance.zero_spin_preserved, true);
assert.equal(result.acceptance.pole_finite, true);
assert.equal(result.tracked_corpus.plans, 199);
assert.equal(result.tracked_corpus.orbit_plans, 106);
assert.equal(result.tracked_corpus.nonzero_orbit_segments, 115);
assert.equal(result.tracked_corpus.zero_radius_segments, 1);
assert.equal(result.tracked_corpus.indeterminate_legacy_orbit_cases.length, 1);
assert.ok(result.dry_run_contract.inverse_control.unintended_successor_entry_shift_m > 100);
assert.equal(result.dry_run_contract.oracle_target_model_non_pan_changes, 0);

for (const [id, expectedSweep] of [['half_clockwise', 180], ['full_counterclockwise', -360], ['twice_clockwise', 720], ['twice_counterclockwise', -720]]) {
  assert.ok(Math.abs(byId(id).pan_sweep_deg - expectedSweep) < 1e-6, `${id}: ${byId(id).pan_sweep_deg}`);
}
for (const id of ['seam_centered', 'pole_899', 'pole_exact']) assert.equal(byId(id).all_finite, true, id);
assert.ok(byId('seam_centered').max_raw_pan_step_deg < 180);
assert.ok(byId('seam_centered').pan_sweep_deg > 350 && byId('seam_centered').pan_sweep_deg < 370);
assert.ok(byId('slow_orbit').pan_sweep_deg > 350 && byId('slow_orbit').pan_sweep_deg < 370);

if (mode === 'production') {
  assert.ok(byId('high_60n_80km').max_keyframe_heading_error_deg > 1);
  assert.ok(byId('high_85n_80km').max_keyframe_heading_error_deg > 7);
  assert.ok(byId('high_89n_35km').max_keyframe_heading_error_deg > 15);
  assert.equal(result.acceptance.production_high_latitude_reds, 3);
  assert.equal(result.acceptance.acquisition_continuity_red, true);
} else if (mode === 'repaired') {
  for (const row of result.planner_cases.filter((r) => r.radius_m > 0 && !r.error)) {
    const tolerance = C.precisionDeg(row.radius_m, corpus.reference_contract.serialized_position_uncertainty_m);
    assert.ok(row.max_keyframe_heading_error_deg <= tolerance, `${row.id}: ${row.max_keyframe_heading_error_deg} > ${tolerance}`);
  }
  assert.equal(result.acceptance.acquisition_continuity_red, false);
  assert.equal(result.acceptance.position_fields_changed_vs_production, 0);
  assert.equal(result.planner_cases.some((r) => r.timing_easing_changed_vs_production), false);
  assert.ok(result.acceptance.pan_fields_changed_vs_production > 0);
}

console.log(`HIGH-LATITUDE HEADING ORACLE ${mode.toUpperCase()}: PASS`);
