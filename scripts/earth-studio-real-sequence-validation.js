#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'package-runs/2026-08-20-earth-studio-directorial-evaluation');
const ids = process.argv.slice(3);

function read(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function validate(id) {
  const dir = path.join(root, 'projects', id, 'earth-studio');
  const obs = read(path.join(root, 'observations', `${id}.json`));
  const exec = read(path.join(dir, 'sequence-execution.json'));
  const plan = read(path.join(dir, 'shot-plan.json'));
  const expectedFrames = exec.trace.flatMap((beat) => [beat.segment_start_frame, beat.segment_end_frame]).filter((n) => Number.isFinite(n));
  const observedFrames = (obs.frames || []).map((f) => f.frame);
  const observedLabels = (obs.frames || []).map((f) => f.label);
  const segmentStartsObserved = plan.segments.filter((s) => s.location && s.duration_seconds > 0)
    .filter((s) => observedLabels.includes(`seg${s.segment_id}-start`)).map((s) => s.segment_id);
  const finalObserved = observedFrames.length ? Math.max(...observedFrames) : null;
  const expectedFinal = Number.isFinite(plan.total_frames) ? plan.total_frames - 1 : null;
  const actualDurationSeconds = obs.import && Number.isFinite(obs.import.duration) && Number.isFinite(obs.import.frameRate)
    ? obs.import.duration / obs.import.frameRate : null;
  return {
    id,
    import: obs.import,
    expected: { total_frames: plan.total_frames, duration_seconds: plan.total_duration_seconds, frame_rate: plan.frame_rate },
    duration_match: Boolean(obs.import && obs.import.duration === plan.total_frames && obs.import.frameRate === plan.frame_rate),
    duration_seconds_actual: actualDurationSeconds,
    semantic_trace: exec.trace.map((b) => ({ subject: b.subject, purpose: b.purpose, grammar: b.grammar_actual, start_frame: b.segment_start_frame, end_frame: b.segment_end_frame })),
    observed_segment_starts: segmentStartsObserved,
    observed_segment_count: observedLabels.filter((l) => /-start$/.test(l)).length,
    expected_segment_count: plan.segments.filter((s) => s.location && s.duration_seconds > 0).length,
    expected_boundary_frames: expectedFrames,
    observed_frame_samples: (obs.frames || []).map((f) => ({ frame: f.frame, label: f.label, movement: f.movement, place: f.place, camera: f.earth_studio_camera })),
    final_frame_check: { expected: expectedFinal, observed_max_sample: finalObserved, terminal_sample_present: observedLabels.some((l) => /-end$/.test(l)) },
    errors: obs.errors || [],
    import_ok: Boolean(obs.import && obs.import.duration === plan.total_frames && obs.import.frameRate === plan.frame_rate && !(obs.errors || []).length),
  };
}

const selected = ids.length ? ids : ['DIRN-17-nl-complex-story', 'DIRN-14-return-conclusion', 'DIRN-11-matched-comparison'];
const reports = selected.map(validate);
const out = path.join(root, 'real-sequence-validation.json');
fs.writeFileSync(out, `${JSON.stringify({ schema_version: 1, reports }, null, 2)}\n`);
console.log(JSON.stringify({ out, reports: reports.map((r) => ({ id: r.id, import_ok: r.import_ok, duration_match: r.duration_match, observed_segment_starts: r.observed_segment_starts, final_frame_check: r.final_frame_check })) }, null, 2));
