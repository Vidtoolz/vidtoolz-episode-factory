#!/usr/bin/env node
'use strict';

// Converts authenticated consecutive-frame boundary traces into a compact
// evaluator-vs-real calibration record. It never launches Earth Studio and
// never changes production camera generation.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-boundary-continuity-calibration');
const probe = require('./earth-studio-boundary-continuity-probe.js');
const quality = require('../earth-studio-camera-quality.js');

function classify(record, current) {
  const analysis = record.analysis;
  const directionStep = analysis.ground_velocity_vector.transition_max_one_frame_direction_change_deg;
  const phaseSpan = analysis.cross_track_phase.peak_span_frames;
  const pair = `${record.primitive_before}->${record.primitive_after}`;
  if (current.defects.some((row) => row.defect_class === 'BOUNDARY_DIRECTION_SNAP') && directionStep > 30) {
    return { classification: 'TRUE_SEAM', reason: `real playback changes ground-velocity direction ${directionStep.toFixed(2)}° in one frame; the calibrated offline vector proxy agrees` };
  }
  if (['hold', 'hover'].includes(record.primitive_after)) {
    return { classification: 'INTENTIONAL_TRANSITION', reason: `${pair} reaches rest; velocity-vector direction is undefined after speed becomes zero` };
  }
  if (record.evaluator_advisories.length && directionStep < 1 && phaseSpan <= 2) {
    return { classification: 'MODEL_FALSE_POSITIVE', reason: `one-frame evaluator warning becomes a progressive ${directionStep.toFixed(2)}° turn in real playback with channel peaks aligned within ${phaseSpan} frames` };
  }
  if (record.evaluator_advisories.length && directionStep <= 6) {
    return { classification: 'INSUFFICIENT_AUTHORITY', reason: `real playback redirects ${directionStep.toFixed(2)}° near minimum speed, but channel peak timing spans ${phaseSpan} frames; retain advisory status pending visual authority` };
  }
  return { classification: 'BELOW_VISUAL_SIGNIFICANCE', reason: 'no evidence-backed hard-seam signature was present' };
}

function main() {
  const summary = JSON.parse(fs.readFileSync(path.join(OUT, 'real-earth-studio-summary.json'), 'utf8'));
  const rows = summary.cases.map((record) => {
    const input = probe.CASES.find((item) => item.id === record.id);
    const details = probe.caseDetails(input);
    const current = quality.boundaryContinuityDefects({ plan: details.plan, esp: details.esp,
      tracks: quality.cameraTracks(details.esp) });
    return {
      id: record.id,
      boundary_frame: input.boundaryFrame,
      primitive_before: record.primitive_before,
      primitive_after: record.primitive_after,
      original_advisories: record.evaluator_advisories,
      calibrated_offline_defects: current.defects,
      calibrated_offline_warnings: current.warnings,
      real: record.analysis,
      ...classify(record, current),
    };
  });
  const output = {
    calibrated_at: new Date().toISOString(),
    authority: 'authenticated Google Earth Studio consecutive-frame playback',
    hard_proxy: {
      defect_class: 'BOUNDARY_DIRECTION_SNAP',
      conditions: ['calibrated travel/approach→orbit or orbit→fly boundary', 'both modeled position velocities exceed 1 m/s',
        'ground-velocity direction changes more than 30° in one frame',
        'position boundary contains authored linear evidence', 'transition is not explicitly hard'],
      calibration: { real_clean_max_deg: 5.09600794139692, real_confirmed_seam_deg: 73.11913302848893,
        offline_confirmed_seam_deg: 72.55073599911589 },
    },
    cases: rows,
  };
  fs.writeFileSync(path.join(OUT, 'classification-results.json'), `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'evaluator-vs-real.json'), `${JSON.stringify({ cases: rows.map((row) => ({
    id: row.id, pair: `${row.primitive_before}->${row.primitive_after}`,
    original_warning: row.original_advisories.map((item) => ({ parameter: item.parameter, score: item.measured_value })),
    offline_direction_defect: row.calibrated_offline_defects.find((item) => item.defect_class === 'BOUNDARY_DIRECTION_SNAP') || null,
    real_one_frame_direction_change_deg: row.real.ground_velocity_vector.transition_max_one_frame_direction_change_deg,
    real_speed_discontinuity: row.real.ground_speed_mps.normalized_discontinuity,
    real_channel_peak_span_frames: row.real.cross_track_phase.peak_span_frames,
    classification: row.classification,
  })) }, null, 2)}\n`);
  const counts = rows.reduce((out, row) => ({ ...out, [row.classification]: (out[row.classification] || 0) + 1 }), {});
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Earth Studio boundary-continuity calibration\n\n`
    + `Authenticated Google Earth Studio was sampled on every frame from B−30 through B+30 around nine authored primitive boundaries. The production evaluator remains deterministic and offline.\n\n`
    + `## Result\n\n- Cases: ${rows.length}\n- Classifications: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}\n`
    + `- Confirmed hard signature: moving→moving ground-vector snap above 30° with authored linear boundary evidence and non-zero speed on both sides.\n`
    + `- Scalar custom-handle discontinuities remain advisory when real playback spreads the transition progressively.\n`
    + `- Movement→hold direction is ignored after speed reaches zero.\n\n`
    + `The confirmed production seam is \`DIRN17-ROTTERDAM-ORBIT-TRAVEL\`: 73.12° real one-frame redirection, predicted offline at 72.55°. No production camera generation was changed here.\n`);
  console.log(JSON.stringify({ cases: rows.length, counts }, null, 2));
}

if (require.main === module) main();

module.exports = { classify };
