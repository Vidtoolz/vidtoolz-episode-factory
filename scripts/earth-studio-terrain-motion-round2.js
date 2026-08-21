#!/usr/bin/env node
'use strict';

// Second experiment-only motion round. This responds to Mikko's first
// micro-review; it does not alter production motion or accepted contracts.

const fs = require('node:fs');
const path = require('node:path');
const base = require('./earth-studio-terrain-motion-candidates');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-motion-calibration');
const V1 = JSON.parse(fs.readFileSync(path.join(OUT, 'candidates/manifest.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

function tangentHandle(x, slope) {
  return { x: Number(x.toFixed(6)), y: Number((slope * x).toFixed(12)), influence: 0.43, type: 'auto' };
}

function coherentTangents(esp) {
  const output = clone(esp);
  for (const type of ['latitude', 'longitude', 'rotationX']) {
    const leaf = base.findAttribute(output.scenes[0].attributes, type);
    const keys = leaf.keyframes;
    for (let index = 1; index < keys.length - 1; index += 1) {
      const previous = keys[index - 1];
      const key = keys[index];
      const next = keys[index + 1];
      const slope = (next.value - previous.value) / (next.time - previous.time);
      key.transitionIn = tangentHandle(-(key.time - previous.time) / 3, slope);
      key.transitionOut = tangentHandle((next.time - key.time) / 3, slope);
    }
  }
  return output;
}

function monotoneSlopes(points) {
  const secants = points.slice(1).map((point, index) => (point.value - points[index].value) / (point.time - points[index].time));
  const slopes = [0];
  for (let index = 1; index < points.length - 1; index += 1) {
    const left = secants[index - 1];
    const right = secants[index];
    slopes.push(left * right <= 0 ? 0 : (2 * left * right) / (left + right));
  }
  slopes.push(0);
  return slopes;
}

function explicitCalmRamp(esp, spec) {
  const output = clone(esp);
  const altitude = base.findAttribute(output.scenes[0].attributes, 'altitude');
  const start = altitude.keyframes[0];
  const end = altitude.keyframes.at(-1);
  const durationSeconds = output.settings.duration / output.settings.frameRate;
  const points = [
    { time: start.time, value: start.value },
    ...spec.map(({ seconds, progress }) => ({
      time: seconds / durationSeconds,
      value: start.value + ((end.value - start.value) * progress),
    })),
    { time: end.time, value: end.value },
  ];
  const slopes = monotoneSlopes(points);
  altitude.keyframes = points.map((point, index) => {
    const key = { time: point.time, value: point.value };
    if (index > 0) key.transitionIn = tangentHandle(-(point.time - points[index - 1].time) / 3, slopes[index]);
    if (index < points.length - 1) key.transitionOut = tangentHandle((points[index + 1].time - point.time) / 3, slopes[index]);
    return key;
  });
  return output;
}

function writeEsp(dir, id, esp) {
  fs.mkdirSync(dir, { recursive: true });
  esp.settings.name = id;
  const file = path.join(dir, `${id}.esp`);
  fs.writeFileSync(file, `${JSON.stringify(esp, null, 2)}\n`);
  return path.relative(ROOT, file);
}

function build() {
  const dir = path.join(OUT, 'candidates-round2');
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${path.relative(ROOT, dir)}`);
  const candidates = [];
  const orbitSubjects = ['Grand Canyon', 'Geirangerfjord', 'Matterhorn', 'Mount Fuji'];
  for (const subject of orbitSubjects) {
    const current = V1.candidates.find((row) => row.family === 'ORBIT' && row.subject === subject && row.variant === 'CURRENT');
    const tangent = V1.candidates.find((row) => row.family === 'ORBIT' && row.subject === subject && row.variant === 'TANGENT_ENVELOPE');
    for (const [variant, source, transform] of [
      ['TANGENT_ENVELOPE', tangent, (value) => value],
      ['COHERENT_TANGENTS', current, coherentTangents],
    ]) {
      const esp = transform(JSON.parse(fs.readFileSync(path.join(ROOT, source.esp), 'utf8')));
      const id = `ORBIT2-${subject.toUpperCase().replaceAll(' ', '-')}-${variant}`;
      candidates.push({ id, family: 'ORBIT', subject, variant, label: variant.replaceAll('_', ' '),
        esp: writeEsp(path.join(dir, 'orbit'), id, esp), authored: current.authored,
        controlled_change: variant === 'TANGENT_ENVELOPE' ? 'first-round better control' : 'continuous central tangents at every interior geometry sample' });
    }
  }
  const revealSubjects = ['Grand Canyon', 'The Alps', 'Yosemite'];
  const ramps = {
    CURRENT: null,
    CALM_RAMP_A: [{ seconds: 1, progress: 0.001 }, { seconds: 2, progress: 0.01 }],
    CALM_RAMP_B: [{ seconds: 1.5, progress: 0.0005 }, { seconds: 3, progress: 0.005 }],
  };
  for (const subject of revealSubjects) {
    const current = V1.candidates.find((row) => row.family === 'REVEAL' && row.subject === subject && row.variant === 'CURRENT');
    const source = JSON.parse(fs.readFileSync(path.join(ROOT, current.esp), 'utf8'));
    for (const [variant, spec] of Object.entries(ramps)) {
      const esp = spec ? explicitCalmRamp(source, spec) : clone(source);
      const id = `REVEAL2-${subject.toUpperCase().replaceAll(' ', '-')}-${variant}`;
      candidates.push({ id, family: 'REVEAL', subject, variant, label: variant.replaceAll('_', ' '),
        esp: writeEsp(path.join(dir, 'reveal'), id, esp), authored: current.authored,
        controlled_change: spec ? `explicit monotone launch ramp ${JSON.stringify(spec)}` : 'reviewed production control' });
    }
  }
  const manifest = { schema_version: 2, generated_at: new Date().toISOString(), production_motion_changed: false,
    production_terrain_grammar_changed: false, previous_review: 'all candidates NONE_GOOD', candidates };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const session = { schema_version: 2, operator_authority: 'Mikko', started_at: null, completed_at: null,
    choices: [...orbitSubjects.map((subject) => ({ family: 'ORBIT', subject, winner: null, note: '', reviewed_at: null })),
      ...revealSubjects.map((subject) => ({ family: 'REVEAL', subject, winner: null, note: '', reviewed_at: null }))] };
  fs.writeFileSync(path.join(OUT, 'human-review/review-session-round2-template.json'), `${JSON.stringify(session, null, 2)}\n`);
  console.log(`wrote ${candidates.length} round-two experiment-only candidates`);
  return manifest;
}

if (require.main === module) { try { build(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { coherentTangents, monotoneSlopes, explicitCalmRamp, build };
