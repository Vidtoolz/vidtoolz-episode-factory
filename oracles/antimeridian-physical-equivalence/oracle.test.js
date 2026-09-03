#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const corpus = require('./corpus.json');
const { COMPLIANT_CONTROL, MODEL_A_CONTROL, evaluate } = require('./run.js');

const repo = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));

const fixtureRoot = path.join(__dirname, 'fixtures');
const fixtureIndex = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'fixture-index.json'), 'utf8'));
assert.equal(fixtureIndex.files.length, 60, 'frozen fixture corpus must contain 60 files');
for (const entry of fixtureIndex.files) {
  const bytes = fs.readFileSync(path.join(fixtureRoot, entry.path));
  assert.equal(bytes.length, entry.bytes, `${entry.path}: frozen byte count moved`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256,
    `${entry.path}: frozen fixture hash moved`);
}
const importEvidence = JSON.parse(fs.readFileSync(path.join(__dirname, 'real-import-evidence.json'), 'utf8'));
assert.equal(importEvidence.seam_centered_60n.result.includes('within the 0.2 m'), true);
assert.ok(importEvidence.seam_centered_60n.observations.every((row) => row.position_delta_from_translated_twin_m <= 0.2));

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
for (const entry of manifest.files) {
  const bytes = fs.readFileSync(path.join(__dirname, entry.path));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256,
    `${entry.path}: oracle manifest hash moved`);
}

const production = evaluate(repo, corpus.production_sha);
assert.equal(production.verdict, 'FAIL', 'production must be red');
assert.equal(production.acceptance.every_rendered_frame_within_0_2m, false);
assert.equal(production.acceptance.authoritative_heading_tau_pass, false);
assert.equal(production.acceptance.no_serializer_created_longitude_scaffolding, false);
assert.equal(production.acceptance.opening_hard_start_eliminated, false);

const firstAttempt = evaluate(repo, corpus.first_serializer_attempt_sha);
assert.equal(firstAttempt.verdict, 'FAIL', 'bbf88d2 must be red');
assert.equal(firstAttempt.acceptance.every_rendered_frame_within_0_2m, false);
assert.equal(firstAttempt.acceptance.no_serializer_created_pan_scaffolding, false);
assert.equal(firstAttempt.acceptance.camera_quality_diagnostic_unsuppressed, false);
assert.equal(firstAttempt.acceptance.camera_quality_source_unchanged, false);
assert.ok(firstAttempt.cases.some((row) => row.candidate_heading_defects.length < row.unsuppressed_heading_defects.length),
  'bbf88d2 must suppress at least one heading diagnostic finding');

const heading = evaluate(repo, corpus.heading_authority_sha);
assert.equal(heading.verdict, 'FAIL', 'heading-only authority must remain red on physical seam equivalence');
assert.equal(heading.acceptance.authoritative_heading_tau_pass, true);
assert.equal(heading.acceptance.every_rendered_frame_within_0_2m, false);

const modelA = evaluate(repo, MODEL_A_CONTROL);
assert.equal(modelA.verdict, 'FAIL', 'historical Model A fixture must remain red');
assert.equal(modelA.acceptance.every_rendered_frame_within_0_2m, false);
assert.equal(modelA.acceptance.opening_hard_start_eliminated, false);

const compliant = evaluate(repo, COMPLIANT_CONTROL);
assert.equal(compliant.verdict, 'PASS', `compliant control failed: ${compliant.failed_acceptance.join(', ')}`);
assert.deepEqual(compliant.failed_acceptance, []);
assert.equal(compliant.corpus.case_count, corpus.cases.length);
assert.ok(compliant.corpus.rendered_frame_count > 9000);
assert.ok(Math.abs(compliant.acquisition_representative.largest_step.delta_deg - 10.467) < 0.01);
assert.equal(compliant.inverse_authority.pass, true);
assert.equal(compliant.public_coordinates.pass, true);
assert.equal(compliant.acceptance.camera_quality_source_unchanged, true);
assert.ok(compliant.cases.every((row) => row.max_physical_delta_m <= corpus.precision.physical_equivalence_m));
assert.ok(compliant.cases.filter((row) => !row.categories.includes('zero_radius')).every((row) => row.has_unwrapped_longitude));
assert.equal(compliant.representation_observation.acceptance_authority,
  'physical equivalence, not longitude scalar representation');
assert.deepEqual(compliant.cases.map((row) => row.expected_pan_sweep_deg),
  [360, -360, 360, -360, 180, 720, -720, 360, 360, 0, 360, 360, 360, 360, 360]);

console.log('ANTIMERIDIAN PHYSICAL-EQUIVALENCE ORACLE V2 CONTROLS: PASS');
console.log(`production ${corpus.production_sha}: RED`);
console.log(`first serializer attempt ${corpus.first_serializer_attempt_sha}: RED`);
console.log(`heading authority ${corpus.heading_authority_sha}: RED`);
console.log(`${MODEL_A_CONTROL}: RED`);
console.log(`${COMPLIANT_CONTROL}: GREEN`);
