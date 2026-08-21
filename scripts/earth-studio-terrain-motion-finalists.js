#!/usr/bin/env node
'use strict';

// Human-review finalists only. Adds target-facing pan samples without changing
// position density, and carries forward the explicit reveal ramps. Production
// remains untouched.

const fs = require('node:fs');
const path = require('node:path');
const continuity = require('../earth-studio-motion-continuity');
const base = require('./earth-studio-terrain-motion-candidates');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-motion-calibration');
const V1 = JSON.parse(fs.readFileSync(path.join(OUT, 'candidates/manifest.json'), 'utf8'));
const V2 = JSON.parse(fs.readFileSync(path.join(OUT, 'candidates-round2/manifest.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

function decode(value, leaf, maximum) {
  const minimum = Number(leaf.value.minValueRange || 0);
  return minimum + (value * (maximum - minimum));
}
function encode(value, leaf, maximum) {
  const minimum = Number(leaf.value.minValueRange || 0);
  return (value - minimum) / (maximum - minimum);
}
function nearestWrapped(value, reference) {
  let result = value;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

function addTargetLockPan(esp, target) {
  const output = clone(esp);
  const scene = output.scenes[0];
  const latitude = base.findAttribute(scene.attributes, 'latitude');
  const longitude = base.findAttribute(scene.attributes, 'longitude');
  const pan = base.findAttribute(scene.attributes, 'rotationX');
  const original = pan.keyframes;
  const keys = [];
  for (let index = 0; index < original.length - 1; index += 1) {
    keys.push(original[index]);
    if (index === 0 || index === original.length - 2) continue;
    const time = (original[index].time + original[index + 1].time) / 2;
    const latValue = (latitude.keyframes[index].value + latitude.keyframes[index + 1].value) / 2;
    const lonValue = (longitude.keyframes[index].value + longitude.keyframes[index + 1].value) / 2;
    const camera = { latitude: decode(latValue, latitude, 90), longitude: decode(lonValue, longitude, 180) };
    const linearReference = decode((original[index].value + original[index + 1].value) / 2, pan, Number(pan.value.maxValueRange || 360));
    const bearing = nearestWrapped(continuity.initialBearing(camera, target), linearReference);
    keys.push({ time, value: encode(bearing, pan, Number(pan.value.maxValueRange || 360)),
      transitionIn: { x: 0, y: 0, type: 'linear' }, transitionOut: { x: 0, y: 0, type: 'linear' } });
  }
  keys.push(original.at(-1));
  pan.keyframes = keys;
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
  const dir = path.join(OUT, 'candidates-finalists');
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${path.relative(ROOT, dir)}`);
  const candidates = [];
  for (const subject of ['Grand Canyon', 'Geirangerfjord', 'Matterhorn', 'Mount Fuji']) {
    const source = V1.candidates.find((row) => row.family === 'ORBIT' && row.subject === subject && row.variant === 'TANGENT_ENVELOPE');
    const original = JSON.parse(fs.readFileSync(path.join(ROOT, source.esp), 'utf8'));
    for (const [variant, esp] of [['TANGENT_ENVELOPE', original], ['TARGET_LOCK_PAN', addTargetLockPan(original, source.authored.target)]]) {
      const id = `ORBIT-FINAL-${subject.toUpperCase().replaceAll(' ', '-')}-${variant}`;
      candidates.push({ id, family: 'ORBIT', subject, variant, label: variant.replaceAll('_', ' '), authored: source.authored,
        esp: writeEsp(path.join(dir, 'orbit'), id, esp), controlled_change: variant === 'TARGET_LOCK_PAN'
          ? 'mid-segment target-facing pan samples only; position geometry, position density, tilt, altitude, duration and endpoints unchanged'
          : 'first micro-review better control' });
    }
  }
  for (const subject of ['Grand Canyon', 'The Alps', 'Yosemite']) {
    for (const variant of ['CURRENT', 'CALM_RAMP_A', 'CALM_RAMP_B']) {
      const source = V2.candidates.find((row) => row.family === 'REVEAL' && row.subject === subject && row.variant === variant);
      candidates.push({ ...source, id: source.id.replace('REVEAL2-', 'REVEAL-FINAL-'),
        esp: writeEsp(path.join(dir, 'reveal'), source.id.replace('REVEAL2-', 'REVEAL-FINAL-'), JSON.parse(fs.readFileSync(path.join(ROOT, source.esp), 'utf8'))) });
    }
  }
  const manifest = { schema_version: 3, generated_at: new Date().toISOString(), production_motion_changed: false,
    production_terrain_grammar_changed: false, candidates };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const session = { schema_version: 3, operator_authority: 'Mikko', started_at: null, completed_at: null,
    choices: [...['Grand Canyon', 'Geirangerfjord', 'Matterhorn', 'Mount Fuji'].map((subject) => ({ family: 'ORBIT', subject, winner: null, note: '', reviewed_at: null })),
      ...['Grand Canyon', 'The Alps', 'Yosemite'].map((subject) => ({ family: 'REVEAL', subject, winner: null, note: '', reviewed_at: null }))] };
  fs.writeFileSync(path.join(OUT, 'human-review/review-session-finalists-template.json'), `${JSON.stringify(session, null, 2)}\n`);
  console.log(`wrote ${candidates.length} finalist candidates`);
  return manifest;
}

if (require.main === module) { try { build(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; } }
module.exports = { decode, encode, nearestWrapped, addTargetLockPan, build };
