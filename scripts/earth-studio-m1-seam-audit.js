#!/usr/bin/env node
'use strict';
// Read-only architectural audit, pinned to the authoritative rejected candidate.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const BEFORE = '4593b38e496664617ad458a6dabf3347f7272e70';
const CONTRACT = '19f98b6a39b0cb079c46e79fa4293a88c04b64a59d124f033d42be9fb3887171';
function body(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  if (start < 0) return '';
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function code(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); }
function count(s, re) { return (code(s).match(re) || []).length; }
function read(file, before) {
  if (before) {
    try { return cp.execFileSync('git', ['show', `${BEFORE}:${file}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }); }
    catch { return ''; }
  }
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}
function inspect(before) {
  const p = read('earth-studio-job-planner.js', before);
  const t = read('earth-studio-camera-trajectory.js', before);
  const s = before ? body(p, 'buildEsp') : read('earth-studio-serializer.js', false);
  const compile = before ? body(p, 'compileTrajectory') : body(t.replace('    function compileTrajectory', '  function compileTrajectory'), 'compileTrajectory');
  const all = p + t + (before ? '' : s);
  return {
    serializer_input: before ? 'plan' : 'CameraTrajectory + serializerConfig',
    serializer_segment_reads: count(s, /\bplan\.segments\b/g),
    serializer_plan_reads: count(s, /\bplan\./g),
    serializer_policy_evaluations: count(s, /\bmotionPolicy\s*\(/g),
    serializer_keyframe_walks: count(s, /\bbuildEspKeyframes\s*\(/g),
    compiler_keyframe_walks: count(compile, /\bbuildEspKeyframes\s*\(/g),
    compiler_policy_evaluations: count(compile, /\b(?:api\.)?motionPolicy\s*\(/g),
    artifact_compile_calls: count(body(p, 'buildArtifactContextFromPlan'), /\bcompileTrajectory\s*\(/g),
    algorithm_bodies: Object.fromEntries(['motionPolicy','exportLongitudeTrack','dropRedundantKeyframes'].map(n => [n, count(all, new RegExp(`function ${n}\\(`, 'g'))])),
    empty_marker_fallbacks: count(p, /markers:\s*\[\]/g),
    serializer_consumes_markers: /cameraTrajectory\.markers/.test(s),
    serializer_consumes_resolved_policy: /cameraTrajectory\.motion_policy/.test(s),
  };
}
function audit() { return { contract_sha256: CONTRACT, before_sha: BEFORE, before: inspect(true), after: inspect(false) }; }
if (require.main === module) process.stdout.write(JSON.stringify(audit(), null, 2) + '\n');
module.exports = { audit, body };
