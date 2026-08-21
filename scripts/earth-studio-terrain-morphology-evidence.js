#!/usr/bin/env node
'use strict';

// Deterministic production-policy evidence for the 2026-08-21 terrain
// morphology calibration. This generates fresh artifacts in a new package;
// it never rewrites the historical visual-review package or accepted canaries.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-morphology');
const NOW = '2026-08-21T15:00:00.000Z';
const D = require(path.join(ROOT, 'earth-studio-director.js'));
const J = require(path.join(ROOT, 'earth-studio-journey.js'));
const P = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const lane = require(path.join(ROOT, 'earth-studio-lane.js'));

const CASES = Object.freeze([
  { id: 'MORPH-CAL-MATTERHORN', subject: 'Matterhorn', morphology: 'SHARP_PEAK', expected_tilt_deg: 74, calibration: true },
  { id: 'MORPH-CAL-MOUNT-FUJI', subject: 'Mount Fuji', morphology: 'VOLCANIC_CONE', expected_tilt_deg: 45, calibration: true },
  { id: 'MORPH-CAL-GRAND-CANYON', subject: 'Grand Canyon', morphology: 'CANYON', expected_tilt_deg: 74, calibration: true, framing: 'district' },
  { id: 'MORPH-CAL-GEIRANGERFJORD', subject: 'Geirangerfjord', morphology: 'FJORD_CHANNEL', expected_tilt_deg: 65, calibration: true },
  { id: 'MORPH-UNSEEN-MONT-BLANC', subject: 'Mont Blanc', morphology: 'SHARP_PEAK', expected_tilt_deg: 74, calibration: false },
  { id: 'MORPH-UNSEEN-KILIMANJARO', subject: 'Kilimanjaro', morphology: 'VOLCANIC_CONE', expected_tilt_deg: 45, calibration: false },
  { id: 'MORPH-UNSEEN-EVEREST', subject: 'Mount Everest', morphology: 'SHARP_PEAK', expected_tilt_deg: null, calibration: false, safety_clamp: true },
  { id: 'MORPH-UNSEEN-ALPS', subject: 'The Alps', morphology: 'GENERIC_TERRAIN', expected_tilt_deg: 65, calibration: false, framing: 'district' },
]);

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel = (file) => path.relative(ROOT, file);
const COMPACT_EVIDENCE_FILES = Object.freeze([
  'camera-quality.json', 'direction.json', 'earth-studio.esp', 'journey.json', 'shot-plan.json',
]);

function orbitIntent(subject, framing = 'auto') {
  return {
    source_text: `Show the terrain of ${subject}.`,
    stops: [{ location: subject, role: 'PRIMARY_SUBJECT', importance: 'HIGH',
      purposes: ['SHOW_TERRAIN'], explicit_grammar: 'slow_orbit', framing }],
  };
}

function naturalResult(subject) {
  const result = D.autoDirect(D.parseIntent(`Show the terrain of ${subject}.`));
  const decision = result.decisions.find((row) => row.kind === 'at').decision;
  return { movement: decision.movement, tilt_deg: decision.tilt_deg == null ? null : decision.tilt_deg,
    terrain_policy: decision.terrain_policy || null };
}

function build(out = OUT) {
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${rel(out)}`);
  fs.mkdirSync(out, { recursive: true });
  const records = [];
  for (const spec of CASES) {
    const result = D.autoDirect(orbitIntent(spec.subject, spec.framing));
    const decision = result.decisions.find((row) => row.kind === 'at').decision;
    if (!decision.terrain_policy) throw new Error(`${spec.id}: missing terrain policy`);
    if (decision.terrain_policy.morphology !== spec.morphology) throw new Error(`${spec.id}: morphology mismatch`);
    if (spec.expected_tilt_deg != null && decision.tilt_deg !== spec.expected_tilt_deg) throw new Error(`${spec.id}: tilt mismatch`);
    if (spec.safety_clamp && !decision.terrain_policy.safety_clamp) throw new Error(`${spec.id}: expected safety clamp`);
    const pkg = path.join(out, 'projects', spec.id);
    lane.writeJob(pkg, { jobName: spec.id, journey: result.journey,
      direction: { plan: result.plan, opening_camera: result.journey.opening_camera || null } }, { now: NOW });
    const es = path.join(pkg, 'earth-studio');
    const plan = JSON.parse(fs.readFileSync(path.join(es, 'shot-plan.json'), 'utf8'));
    const quality = JSON.parse(fs.readFileSync(path.join(es, 'camera-quality.json'), 'utf8'));
    const orbit = plan.segments.find((segment) => segment.action === 'orbit');
    // lane.writeJob creates its full operator package. This dedicated evidence
    // run retains only the inputs, output and diagnostics needed to audit the
    // morphology result; generic checklists/KML/readmes would be redundant.
    for (const name of fs.readdirSync(es)) {
      const file = path.join(es, name);
      if (fs.statSync(file).isFile() && !COMPACT_EVIDENCE_FILES.includes(name)) fs.unlinkSync(file);
    }
    records.push({
      ...spec,
      natural_prompt_result: naturalResult(spec.subject),
      production_orbit_result: {
        movement: decision.movement,
        tilt_deg: decision.tilt_deg,
        altitude_m: orbit.altitude_m,
        policy_altitude_m: decision.altitude_m,
        terrain_policy: decision.terrain_policy,
        duration_seconds: orbit.duration_seconds,
        orbit_degrees: orbit.orbit_degrees,
        orbit_direction: orbit.orbit_direction,
        target: orbit.location,
      },
      technical: { quality_status: quality.verdict, quality_errors: quality.errors || [], quality_warnings: quality.warnings || [],
        total_frames: plan.total_frames, frame_rate: plan.frame_rate, unresolved_items: plan.unresolved_items },
      esp: rel(path.join(es, 'earth-studio.esp')),
      esp_sha256: sha(path.join(es, 'earth-studio.esp')),
      shot_plan: rel(path.join(es, 'shot-plan.json')),
      direction: rel(path.join(es, 'direction.json')),
      camera_quality: rel(path.join(es, 'camera-quality.json')),
      generated_files: COMPACT_EVIDENCE_FILES,
    });
  }
  const oldGate = path.join(ROOT, 'package-runs/2026-08-19-earth-studio-director-acceptance/canary-manifest.json');
  const oldCanaries = JSON.parse(fs.readFileSync(oldGate, 'utf8'));
  const terrainCanary = oldCanaries.canaries.find((row) => row.id === 'DIRECTOR-TERRAIN-mountain');
  const manifest = {
    schema_version: 1,
    generated_at: NOW,
    human_authority_commit: '472a4287cd76e33a53cff8f218147bd77d0fa170',
    policy: 'deterministic human-calibrated terrain morphology; no name-to-angle rules',
    production_policy_changed: true,
    camera_mechanics_changed: false,
    historical_evidence_overwritten: false,
    calibration_before_after: records.filter((row) => row.calibration).map((row) => ({
      subject: row.subject, old_tilt_deg: 72,
      old_review_esp: `package-runs/2026-08-21-earth-studio-terrain-tilt-review/projects/TERRAIN-${row.subject.toUpperCase().replace(/\s+/g, '-')}-72/earth-studio/earth-studio.esp`,
      new_tilt_deg: row.production_orbit_result.tilt_deg, new_esp: row.esp,
    })),
    byte_impact: {
      gate3_v094_controls: 'UNAFFECTED',
      director_canaries_on_disk: 'UNCHANGED_8_OF_8',
      director_terrain_canary_if_regenerated: {
        status: 'EXPECTED_BYTE_CHANGE_NOT_REPINNED',
        accepted_esp: terrainCanary.esp,
        accepted_sha256: terrainCanary.esp_sha256,
        regenerated_sha256: null,
        reason: 'Matterhorn terrain tilt/altitude now follow authorized SHARP_PEAK policy',
      },
      journey_v2_canaries: 'UNAFFECTED_NO_SHOW_TERRAIN_INPUT',
      historical_obliquity_and_terrain_review: 'UNCHANGED',
    },
    records,
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), `# Terrain morphology production evidence\n\n`+
    `Human authority: \`472a4287cd76e33a53cff8f218147bd77d0fa170\`.\n\n`+
    `This package proves the deterministic morphology policy and preserves all historical evidence. `+
    `The four calibration shots reproduce Mikko's selected angles; four unseen cases exercise semantic generalization and the terrain-floor clamp. `+
    `Grand Canyon's natural region-scale grammar remains a reveal; its 74° policy is demonstrated with an explicit orbit-family terrain shot rather than silently changing movement grammar.\n`);
  return manifest;
}

if (require.main === module) {
  const manifest = build();
  console.log(`${manifest.records.length} morphology evidence projects written to ${rel(OUT)}`);
}

module.exports = { CASES, orbitIntent, naturalResult, build };
