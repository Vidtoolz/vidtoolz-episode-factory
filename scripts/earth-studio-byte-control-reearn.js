#!/usr/bin/env node
'use strict';
// BYTE-CONTROL RE-EARN EVIDENCE — space-zoom v0.9.4 control.
//
// The frozen control `2026-08-12-earth-studio-space-zoom-v094-candidate` no longer
// regenerates byte-identically. Established by measurement, not assumption:
//
//   * `shot-plan.json` still matches byte-for-byte — the PLAN is unchanged.
//   * Only latitude/longitude keyframes differ. Altitude, rotationX (pan) and
//     rotationY (tilt) are bit-identical, max difference 0.000000.
//   * Max positional difference is 5.8 m at frame 1047, on a 4,330 m ring: 0.13%.
//   * The regenerated ring is CLOSER to its intended radius (mean error -0.946%
//     against the frozen -1.057%) and marginally more circular (2.094% spread
//     against 2.120%).
//   * Cause is the spherical `offsetPoint`, i.e. a genuine geometry improvement,
//     not template leakage — which is what the control's stated rule exists to
//     detect.
//
// The control's authority came from a real Google Earth Studio observation on
// 2026-08-12 (acceptance/import-observation.json): import succeeded, no warnings,
// flight correct, orbit correct with two counterclockwise revolutions, target
// facing, no snap at ring entry. Every one of those lives on altitude, tilt or
// pan — the channels that did not change.
//
// This script writes the REGENERATED artifact into its own package so the existing
// authenticated import tooling can observe it, WITHOUT touching the frozen file.
// Re-freezing the fixture is deliberately NOT done here: it retires a
// real-import-verified artifact, and the change that causes the diff is another
// agent's uncommitted work.
//
//   node scripts/earth-studio-byte-control-reearn.js
//   node scripts/earth-studio-orbit-entry-observation.js \
//        --gate package-runs/2026-08-20-earth-studio-byte-control-reearn --entry --canary R-space-zoom-regenerated
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const planner = require(path.join(ROOT, 'earth-studio-job-planner.js'));

const CONTROL = '2026-08-12-earth-studio-space-zoom-v094-candidate';
const SRC = path.join(ROOT, 'package-runs', CONTROL, 'earth-studio');
const OUT = path.join(ROOT, 'package-runs/2026-08-20-earth-studio-byte-control-reearn');

const job = JSON.parse(fs.readFileSync(path.join(SRC, 'job.json'), 'utf8'));
const frozenPlan = JSON.parse(fs.readFileSync(path.join(SRC, 'shot-plan.json'), 'utf8'));
// Same inputs the byte gate uses: description + aspect + the frozen generated_at,
// and NO template request and NO motion policy — the generic planner path.
const artifacts = planner.buildArtifacts(job.jobName, job.description, frozenPlan.generated_at, { aspect: job.aspect });

const dir = path.join(OUT, 'projects', 'R-space-zoom-regenerated', 'earth-studio');
fs.mkdirSync(dir, { recursive: true });
Object.entries(artifacts).forEach(([file, content]) => fs.writeFileSync(path.join(dir, file), content));
fs.writeFileSync(path.join(dir, 'job.json'), `${JSON.stringify(job, null, 2)}\n`);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const plan = JSON.parse(artifacts['shot-plan.json']);
const frozenEsp = fs.readFileSync(path.join(SRC, 'earth-studio.esp'));

fs.writeFileSync(path.join(OUT, 'canary-manifest.json'), `${JSON.stringify({
  gate: 'byte-control re-earn evidence — regenerated space-zoom control, real-import observation',
  generated_at: '2026-08-20T15:30:00.000Z',
  planner_version: planner.VERSION,
  control_plan: CONTROL,
  frozen_esp_sha256: sha(frozenEsp),
  regenerated_esp_sha256: sha(Buffer.from(artifacts['earth-studio.esp'])),
  shot_plan_unchanged: sha(Buffer.from(artifacts['shot-plan.json']))
    === sha(fs.readFileSync(path.join(SRC, 'shot-plan.json'))),
  note: 'The frozen artifact is NOT modified by this script. Re-freezing is a separate, approval-gated step.',
  canaries: [{
    id: 'R-space-zoom-regenerated',
    title: 'R — space-zoom v0.9.4 control, regenerated with current geometry',
    aspect: job.aspect,
    esp: path.relative(ROOT, path.join(dir, 'earth-studio.esp')),
    esp_sha256: sha(Buffer.from(artifacts['earth-studio.esp'])),
    total_frames: plan.total_frames,
    duration_seconds: plan.total_duration_seconds,
    render_dimensions: plan.render_dimensions,
    project_dir: path.relative(ROOT, path.join(OUT, 'projects', 'R-space-zoom-regenerated')),
    category: 'byte-control re-earn',
    intended_behavior: 'Identical to the 2026-08-12 accepted control except for ring positions, which are up to 5.8 m different and measurably closer to the intended radius. The recorded observation must still hold: import clean, flight correct, two counterclockwise revolutions, target facing, no snap at ring entry.',
    visual_questions: [
      'Does the import still succeed with no Earth Studio warnings?',
      'Are both counterclockwise revolutions still present?',
      'Does the camera still face the target throughout the orbit?',
      'Is there any snap at fly-to-orbit ring entry?',
    ],
    description: job.description,
  }],
}, null, 2)}\n`);

console.log(JSON.stringify({
  ok: true, output: path.relative(ROOT, OUT),
  frozen_sha: sha(frozenEsp).slice(0, 12),
  regenerated_sha: sha(Buffer.from(artifacts['earth-studio.esp'])).slice(0, 12),
  shot_plan_byte_identical: sha(Buffer.from(artifacts['shot-plan.json'])) === sha(fs.readFileSync(path.join(SRC, 'shot-plan.json'))),
  frames: plan.total_frames,
}, null, 2));
