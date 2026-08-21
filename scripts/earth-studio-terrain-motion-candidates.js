#!/usr/bin/env node
'use strict';

// Experiment-only motion candidates derived from the rejected terrain grammar
// review. Production planner, morphology, grammar and accepted byte contracts
// remain untouched.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-grammar-review');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-motion-calibration');
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));

const ORBIT_SUBJECTS = Object.freeze(['Grand Canyon', 'Geirangerfjord', 'Matterhorn', 'Mount Fuji']);
const REVEAL_SUBJECTS = Object.freeze(['Grand Canyon', 'The Alps', 'Yosemite']);
const REVEAL_VARIANTS = Object.freeze({ CURRENT: 0.25, CALM_START_A: 0.35, CALM_START_B: 0.45, CALM_START_C: 0.60 });

function findAttribute(attributes, type) {
  for (const attribute of attributes || []) {
    if (attribute.type === type) return attribute;
    const nested = findAttribute(attribute.attributes, type);
    if (nested) return nested;
  }
  return null;
}

function linearTransition() { return { x: 0, y: 0, type: 'linear' }; }

function encodedValue(leaf, degrees, maximum) {
  const minimum = Number.isFinite(Number(leaf.value && leaf.value.minValueRange))
    ? Number(leaf.value.minValueRange) : 0;
  return (degrees - minimum) / (maximum - minimum);
}

function destinationPoint(target, bearingDeg, distanceM) {
  const radius = 6371000;
  const delta = distanceM / radius;
  const theta = bearingDeg * Math.PI / 180;
  const phi1 = Number(target.latitude) * Math.PI / 180;
  const lambda1 = Number(target.longitude) * Math.PI / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta)
    + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { latitude: phi2 * 180 / Math.PI, longitude: ((((lambda2 * 180 / Math.PI) + 540) % 360) - 180) };
}

function easedStart(u) { return -(u ** 3) + (2 * u ** 2); }
function easedEnd(u) { return u + (u ** 2) - (u ** 3); }

function stabilizeOrbitEnvelope(esp, target, subdivisions = 5) {
  const output = clone(esp);
  const scene = output.scenes[0];
  const longitude = findAttribute(scene.attributes, 'longitude');
  const latitude = findAttribute(scene.attributes, 'latitude');
  const pan = findAttribute(scene.attributes, 'rotationX');
  if (!longitude || !latitude || !pan || latitude.keyframes.length < 3) throw new Error('orbit camera tracks unavailable');
  const leaves = { latitude, longitude, pan };
  for (const leaf of Object.values(leaves)) {
    const keys = leaf.keyframes;
    const firstGap = keys[1].time - keys[0].time;
    const firstSlope = (keys[2].value - keys[0].value) / (keys[2].time - keys[0].time);
    const firstX = -firstGap / 3;
    keys[1].transitionIn = {
      x: Number(firstX.toFixed(6)),
      y: Number((firstSlope * firstX).toFixed(12)),
      influence: 0.43,
      type: 'auto',
    };
    const lastIndex = keys.length - 1;
    const lastGap = keys[lastIndex].time - keys[lastIndex - 1].time;
    const lastSlope = (keys[lastIndex].value - keys[lastIndex - 2].value)
      / (keys[lastIndex].time - keys[lastIndex - 2].time);
    const lastX = lastGap / 3;
    keys[lastIndex - 1].transitionOut = {
      x: Number(lastX.toFixed(6)),
      y: Number((lastSlope * lastX).toFixed(12)),
      influence: 0.43,
      type: 'auto',
    };
  }
  return output;
}

function softenRevealLaunch(esp, fraction) {
  const output = clone(esp);
  const altitude = findAttribute(output.scenes[0].attributes, 'altitude');
  if (!altitude || altitude.keyframes.length !== 2) throw new Error('expected two-keyframe reveal altitude');
  const gap = altitude.keyframes[1].time - altitude.keyframes[0].time;
  altitude.keyframes[0].transitionOut = {
    x: Number((fraction * gap).toFixed(6)), y: 0, influence: fraction, type: 'custom',
  };
  return output;
}

function writeEsp(dir, id, esp) {
  fs.mkdirSync(dir, { recursive: true });
  if (esp.settings) esp.settings.name = id;
  const file = path.join(dir, `${id}.esp`);
  const bytes = `${JSON.stringify(esp, null, 2)}\n`;
  fs.writeFileSync(file, bytes);
  return { file, sha256: sha(bytes) };
}

function buildCandidates({ overwrite = false } = {}) {
  const dir = path.join(OUT, 'candidates');
  if (fs.existsSync(dir) && !overwrite) throw new Error(`refusing to overwrite ${path.relative(ROOT, dir)} without --refresh`);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const source = JSON.parse(fs.readFileSync(path.join(SOURCE, 'canary-manifest.json'), 'utf8'));
  const candidates = [];
  for (const subject of ORBIT_SUBJECTS) {
    const record = source.canaries.find((row) => row.subject === subject && row.treatment === 'TERRAIN_FORM');
    const original = JSON.parse(fs.readFileSync(path.join(ROOT, record.esp), 'utf8'));
    for (const variant of ['CURRENT', 'TANGENT_ENVELOPE']) {
      const id = `ORBIT-${record.subject_slug.toUpperCase()}-${variant}`;
      const esp = variant === 'CURRENT' ? clone(original) : stabilizeOrbitEnvelope(original, record.authored.target);
      const written = writeEsp(path.join(dir, 'orbit'), id, esp);
      candidates.push({
        id, family: 'ORBIT', subject, variant, label: variant === 'CURRENT' ? 'CURRENT' : 'TANGENT ENVELOPE',
        esp: path.relative(ROOT, written.file), esp_sha256: written.sha256,
        authored: record.authored,
        controlled_change: variant === 'CURRENT'
          ? 'none; exact reviewed terrain-form ESP trajectory' : 'opening and closing ring samples meet the adjacent cruise tangent; keyframe count, geometry and global ease endpoints unchanged',
      });
    }
  }
  for (const subject of REVEAL_SUBJECTS) {
    const record = source.canaries.find((row) => row.subject === subject && row.treatment === 'CURRENT_AUTO');
    const original = JSON.parse(fs.readFileSync(path.join(ROOT, record.esp), 'utf8'));
    for (const [variant, fraction] of Object.entries(REVEAL_VARIANTS)) {
      const id = `REVEAL-${record.subject_slug.toUpperCase()}-${variant}`;
      const esp = variant === 'CURRENT' ? clone(original) : softenRevealLaunch(original, fraction);
      const written = writeEsp(path.join(dir, 'reveal'), id, esp);
      candidates.push({
        id, family: 'REVEAL', subject, variant, label: variant.replaceAll('_', ' '),
        esp: path.relative(ROOT, written.file), esp_sha256: written.sha256,
        authored: record.authored,
        departure_handle_fraction: fraction,
        controlled_change: variant === 'CURRENT' ? 'none; exact reviewed production reveal trajectory'
          : `altitude departure handle increased from 0.25 to ${fraction}; final state, move-end frame and total duration unchanged`,
      });
    }
  }
  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    production_motion_changed: false,
    production_terrain_grammar_changed: false,
    production_morphology_changed: false,
    orbit_root_cause: 'opening and closing eased coordinate spans leave the constant-radius ring; interior hard-linear samples remain stable',
    reveal_hypothesis: 'the 0.25-gap departure handle reaches visually large absolute speed too early on multi-million-metre altitude reveals',
    candidates,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const reviewDir = path.join(OUT, 'human-review');
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, 'review-session-template.json'), `${JSON.stringify({
    schema_version: 1,
    operator_authority: 'Mikko',
    started_at: null,
    completed_at: null,
    choices: [
      ...ORBIT_SUBJECTS.map((subject) => ({ family: 'ORBIT', subject, winner: null, note: '', reviewed_at: null })),
      ...REVEAL_SUBJECTS.map((subject) => ({ family: 'REVEAL', subject, winner: null, note: '', reviewed_at: null })),
    ],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'byte-impact-map.json'), `${JSON.stringify({
    production_motion_changed: false,
    gate3_v094_controls: { affected: false, expected: 'byte-identical' },
    director_canaries: { affected: false, expected: '8/8 byte-identical' },
    journey_v2_canaries: { affected: false },
    morphology_and_obliquity_evidence: { affected: false },
    terminal_settle_evidence: { affected: false },
    terrain_grammar_evidence: { affected: false, note: 'source package is immutable; new candidates live only in this motion-calibration run' },
    candidate_esps: { affected: true, accepted_contract: false, human_review_required: true },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Earth Studio terrain motion calibration\n\n`
    + `The eight-subject grammar review rejected both primitives. Production grammar, morphology and motion remain unchanged.\n\n`
    + `- \`orbit-full-frame-traces/\`: five reviewed terrain orbits plus a Colosseum control, sampled at every real Earth Studio frame.\n`
    + `- \`reveal-full-frame-traces/\`: five reviewed production reveals, sampled at every frame.\n`
    + `- \`candidates/\`: experiment-only orbit tangent-envelope and reveal custom-departure candidates.\n`
    + `- \`candidate-orbit-traces/\` and \`candidate-reveal-traces/\`: real playback measurements.\n`
    + `- \`human-review/\`: Mikko's isolated orbit and reveal micro-review session.\n\n`
    + `Rejected experiments were not advanced to review: endpoint resampling increased\n`
    + `radius variation, changing only \`easeOut.x\` had no real-playback effect, and a\n`
    + `fixed-influence custom handle with varied x also played identically. Their\n`
    + `reproducible raw dumps were kept out of this compact durable package.\n\n`
    + `Run: \`node scripts/earth-studio-terrain-motion-review.js\`\n`);
  return manifest;
}

if (require.main === module) {
  try {
    const manifest = buildCandidates({ overwrite: process.argv.includes('--refresh') });
    console.log(`wrote ${manifest.candidates.length} experiment-only terrain motion candidates`);
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = {
  ORBIT_SUBJECTS, REVEAL_SUBJECTS, REVEAL_VARIANTS, findAttribute, destinationPoint,
  easedStart, easedEnd, stabilizeOrbitEnvelope, softenRevealLaunch, buildCandidates,
};
