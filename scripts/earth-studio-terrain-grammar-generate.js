#!/usr/bin/env node
'use strict';

// Controlled terrain-GRAMMAR calibration. Production Director selection stays
// untouched: A is the exact natural-language auto-direct result; B is an
// experiment-only, bounded terrain-form treatment using the already accepted
// morphology tilt. This script never changes a production policy or canary.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-grammar-review');
const NOW = '2026-08-21T18:00:00.000Z';
const LOCAL_INSPECTION_SCALE = 'district';
const D = require(path.join(ROOT, 'earth-studio-director.js'));
const J = require(path.join(ROOT, 'earth-studio-journey.js'));
const P = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const lane = require(path.join(ROOT, 'earth-studio-lane.js'));

const SUBJECTS = Object.freeze([
  { slug: 'grand-canyon', name: 'Grand Canyon', morphology: 'CANYON', terrain_class: 'CANYON' },
  { slug: 'geirangerfjord', name: 'Geirangerfjord', morphology: 'FJORD_CHANNEL', terrain_class: 'FJORD' },
  { slug: 'matterhorn', name: 'Matterhorn', morphology: 'SHARP_PEAK', terrain_class: 'SHARP_ISOLATED_PEAK' },
  { slug: 'mount-fuji', name: 'Mount Fuji', morphology: 'VOLCANIC_CONE', terrain_class: 'VOLCANIC_CONE' },
  { slug: 'the-alps', name: 'The Alps', morphology: 'GENERIC_TERRAIN', terrain_class: 'BROAD_MOUNTAIN_RANGE' },
  { slug: 'the-himalayas', name: 'The Himalayas', morphology: 'GENERIC_TERRAIN', terrain_class: 'VERY_LARGE_MOUNTAIN_RANGE' },
  { slug: 'yosemite', name: 'Yosemite', morphology: 'GENERIC_TERRAIN', terrain_class: 'VALLEY' },
  { slug: 'yellowstone', name: 'Yellowstone', morphology: 'GENERIC_TERRAIN', terrain_class: 'GENERIC_TERRAIN_REGION' },
]);

const TREATMENTS = Object.freeze({
  CURRENT_AUTO: 'CURRENT_AUTO',
  TERRAIN_FORM: 'TERRAIN_FORM',
});
const COMPACT_FILES = Object.freeze([
  'camera-quality.json', 'direction.json', 'earth-studio.esp', 'journey.json', 'shot-plan.json',
]);

const rel = (file) => path.relative(ROOT, file);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function trajectorySha(file) {
  const esp = JSON.parse(fs.readFileSync(file, 'utf8'));
  const normalized = JSON.parse(JSON.stringify(esp));
  if (normalized.settings) delete normalized.settings.name;
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function promptFor(subject) {
  return `Show the terrain of ${subject.name}.`;
}

function terrainPurpose(text) {
  const value = String(text || '');
  const context = /\b(where|within|relative|orient|location|context|scale|map|from above|top-?down)\b/i.test(value);
  const form = /\b(terrain|relief|shape|walls?|depth|physical(?:ly)?|landform|raking)\b/i.test(value);
  if (context && !form) return 'TERRAIN_CONTEXT';
  if (form && !context) return 'TERRAIN_FORM';
  if (context && form) return 'MIXED_REQUIRES_OPERATOR_GRAMMAR';
  return 'UNSPECIFIED';
}

function currentIntent(subject, prompt = promptFor(subject)) {
  return D.parseIntent(prompt);
}

function terrainFormIntent(subject, prompt = promptFor(subject)) {
  const intent = currentIntent(subject, prompt);
  const stop = intent.stops[0];
  const explicit = stop && stop.explicit_grammar;
  if (explicit && !/orbit/i.test(explicit)) throw new Error(`${subject.name}: explicit ${explicit} cannot be bypassed`);
  if ((intent.negatives || []).includes('orbit')) throw new Error(`${subject.name}: explicit no-orbit cannot be bypassed`);
  if (intent.opening && intent.opening.tilt_deg === 0) throw new Error(`${subject.name}: explicit top-down cannot be bypassed`);
  const resolved = P.resolveLocation(subject.name);
  const classified = J.classifyScale(resolved, subject.name);
  // The current engine can keep an oblique subject framed only on a ring, and
  // rings cap at 80 km. For region fixtures the B candidate is therefore an
  // explicitly labelled local inspection at the fixture centre—not an orbit
  // around the whole geographic region.
  if (classified.scale === 'region') stop.framing = LOCAL_INSPECTION_SCALE;
  return intent;
}

function directionFor(subject, treatment) {
  const intent = treatment === TREATMENTS.CURRENT_AUTO ? currentIntent(subject) : terrainFormIntent(subject);
  const directed = D.autoDirect(intent);
  const at = directed.decisions.find((row) => row.kind === 'at');
  if (!at) throw new Error(`${subject.name} ${treatment}: no at-location decision`);
  if (treatment === TREATMENTS.TERRAIN_FORM) {
    if (!/orbit/i.test(at.decision.movement || '')) throw new Error(`${subject.name}: terrain-form candidate did not produce an orbit`);
    if (!at.decision.terrain_policy) throw new Error(`${subject.name}: terrain-form candidate missed morphology policy`);
    if (at.decision.terrain_policy.morphology !== subject.morphology) {
      throw new Error(`${subject.name}: expected ${subject.morphology}, got ${at.decision.terrain_policy.morphology}`);
    }
  }
  return { intent, directed, at };
}

function compactPackage(esDir) {
  for (const name of fs.readdirSync(esDir)) {
    const file = path.join(esDir, name);
    if (fs.statSync(file).isFile() && !COMPACT_FILES.includes(name)) fs.unlinkSync(file);
  }
  for (const name of ['frames', 'renders']) {
    const dir = path.join(esDir, name);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

function buildCandidate(out, subject, treatment) {
  const { intent, directed, at } = directionFor(subject, treatment);
  const id = `TERRAIN-GRAMMAR-${subject.slug.toUpperCase()}-${treatment.replace('_', '-')}`;
  const packageDir = path.join(out, 'projects', id);
  lane.writeJob(packageDir, {
    jobName: id,
    journey: directed.journey,
    direction: { plan: directed.plan, opening_camera: directed.journey.opening_camera || null },
  }, { now: NOW });
  const esDir = path.join(packageDir, 'earth-studio');
  compactPackage(esDir);
  const plan = JSON.parse(fs.readFileSync(path.join(esDir, 'shot-plan.json'), 'utf8'));
  const quality = JSON.parse(fs.readFileSync(path.join(esDir, 'camera-quality.json'), 'utf8'));
  const movement = plan.segments.find((segment) => segment.location && segment.duration_seconds > 0);
  const resolved = P.resolveLocation(subject.name);
  const naturalScale = J.classifyScale(resolved, subject.name).scale;
  const localStress = treatment === TREATMENTS.TERRAIN_FORM && naturalScale === 'region';
  const record = {
    id,
    subject: subject.name,
    subject_slug: subject.slug,
    terrain_class: subject.terrain_class,
    morphology: subject.morphology,
    prompt: promptFor(subject),
    terrain_purpose: terrainPurpose(promptFor(subject)),
    treatment,
    candidate_label: treatment === TREATMENTS.CURRENT_AUTO ? 'CURRENT' : 'TERRAIN FORM',
    production_output: treatment === TREATMENTS.CURRENT_AUTO,
    production_policy_changed: false,
    natural_scale: naturalScale,
    candidate_scale: directed.stops[0].scale,
    feasibility: localStress ? 'LOCAL_INSPECTION_STRESS_TEST' : 'NATURAL_SCALE',
    feasibility_note: localStress
      ? `The fixture is ${naturalScale}-scale. The ring is bounded to ${LOCAL_INSPECTION_SCALE} framing around the fixture centre and does not claim to represent the full region.`
      : 'The subject fits the existing target-locked orbit grammar at its natural framing scale.',
    decision: {
      key: at.decision.key,
      movement: at.decision.movement,
      tilt_deg: at.decision.tilt_deg == null ? null : at.decision.tilt_deg,
      altitude_m: at.decision.altitude_m == null ? null : at.decision.altitude_m,
      morphology: at.decision.terrain_policy ? at.decision.terrain_policy.morphology : null,
      terrain_policy: at.decision.terrain_policy || null,
      why: at.decision.why,
      angle_limitation: at.decision.angle_limitation || null,
    },
    authored: {
      movement: movement.action,
      tilt_deg: movement.tilt_deg,
      altitude_m: movement.altitude_m,
      orbit_degrees: movement.orbit_degrees == null ? null : movement.orbit_degrees,
      orbit_direction: movement.orbit_direction == null ? null : movement.orbit_direction,
      duration_seconds: movement.duration_seconds,
      frame_rate: plan.frame_rate,
      total_frames: plan.total_frames,
      target: movement.location,
    },
    technical: {
      camera_quality: quality.verdict,
      errors: quality.errors || [],
      warnings: quality.warnings || [],
      finite_camera_state: !(quality.errors || []).some((error) => /finite|NaN|invalid camera/i.test(String(error))),
      target_stable: true,
      roll_authored: false,
      terminal_settle: 'covered by camera-quality and terminal-settle authoritative regressions',
    },
    intent,
    esp: rel(path.join(esDir, 'earth-studio.esp')),
    esp_sha256: sha(path.join(esDir, 'earth-studio.esp')),
    trajectory_sha256: trajectorySha(path.join(esDir, 'earth-studio.esp')),
    shot_plan: rel(path.join(esDir, 'shot-plan.json')),
    camera_quality: rel(path.join(esDir, 'camera-quality.json')),
    direction: rel(path.join(esDir, 'direction.json')),
    generated_files: COMPACT_FILES,
  };
  fs.writeFileSync(path.join(esDir, 'candidate-metadata.json'), `${JSON.stringify(record, null, 2)}\n`);
  record.metadata = rel(path.join(esDir, 'candidate-metadata.json'));
  return record;
}

function buildExperiment(out = OUT, { overwrite = false } = {}) {
  if (fs.existsSync(out) && !overwrite) throw new Error(`refusing to overwrite ${rel(out)} (use --refresh)`);
  if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const records = [];
  for (const subject of SUBJECTS) {
    records.push(buildCandidate(out, subject, TREATMENTS.CURRENT_AUTO));
    records.push(buildCandidate(out, subject, TREATMENTS.TERRAIN_FORM));
  }
  for (const subject of SUBJECTS) {
    const rows = records.filter((record) => record.subject === subject.name);
    const current = rows.find((record) => record.treatment === TREATMENTS.CURRENT_AUTO);
    const form = rows.find((record) => record.treatment === TREATMENTS.TERRAIN_FORM);
    form.byte_equivalent_to_current = form.esp_sha256 === current.esp_sha256;
    form.camera_trajectory_equivalent_to_current = form.trajectory_sha256 === current.trajectory_sha256;
  }
  const manifest = {
    schema_version: 1,
    generated_at: NOW,
    purpose: 'Controlled human calibration of terrain camera grammar: contextual reveal versus target-locked terrain-form inspection.',
    production_policy_changed: false,
    production_director_files_changed: false,
    terrain_tilt_policy_changed: false,
    terrain_purpose_model: {
      TERRAIN_CONTEXT: 'geographic extent, location, relationship or scale is the information',
      TERRAIN_FORM: 'three-dimensional relief, shape, walls or depth is the information',
      status: 'experiment-only; not wired into production grammar selection',
    },
    candidate_treatments: [TREATMENTS.CURRENT_AUTO, TREATMENTS.TERRAIN_FORM],
    oblique_reveal: {
      supported: false,
      reason: 'No existing at-location primitive is both oblique and target-locked except the orbit family. reveal/zoom_out are top-down; fly_low is oblique but deliberately points past its target.',
    },
    ring_limit_m: 80000,
    local_inspection_scale: LOCAL_INSPECTION_SCALE,
    review_display_order: [TREATMENTS.CURRENT_AUTO, TREATMENTS.TERRAIN_FORM],
    canaries: records,
  };
  fs.writeFileSync(path.join(out, 'canary-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'review-session-template.json'), `${JSON.stringify({
    schema_version: 1,
    operator_authority: 'Mikko',
    started_at: null,
    completed_at: null,
    choices: SUBJECTS.map((subject) => ({
      subject: subject.name,
      morphology: subject.morphology,
      terrain_class: subject.terrain_class,
      natural_scale: records.find((row) => row.subject === subject.name).natural_scale,
      current_grammar: records.find((row) => row.subject === subject.name && row.treatment === TREATMENTS.CURRENT_AUTO).decision.movement,
      winner: null,
      second_best: null,
      unacceptable_treatments: [],
      note: '',
      reviewed_at: null,
    })),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), `# Earth Studio terrain-grammar visual calibration\n\n`+
    `Production grammar and the accepted morphology tilt table are unchanged. This package compares the exact current auto-directed shot with an experiment-only target-locked terrain-form orbit.\n\n`+
    `- Eight locally supported subjects; two treatments each; 16 importable ESPs.\n`+
    `- CURRENT is generated from the exact natural prompt through the live Director.\n`+
    `- TERRAIN FORM uses the same prompt and accepted morphology tilt. Region fixtures are deliberately bounded to a district-scale local inspection and labelled as stress tests.\n`+
    `- There is no OBLIQUE REVEAL candidate: the engine has no existing target-locked oblique reveal primitive. Calling fly_low a reveal would be dishonest because it points past the target.\n`+
    `- Identical CURRENT/TERRAIN FORM bytes on compact subjects are retained as controls showing that production already selects terrain form there.\n\n`+
    `Run:\n\n\`\`\`bash\nnode scripts/earth-studio-terrain-grammar-review.js\n\`\`\`\n\n`+
    `Workflow: subject → candidate shots → winner → optional note → next. Choices are persisted to \`review-session.json\`.\n`);
  return manifest;
}

if (require.main === module) {
  try {
    const manifest = buildExperiment(OUT, { overwrite: process.argv.includes('--refresh') });
    console.log(`wrote ${manifest.canaries.length} terrain-grammar candidates to ${rel(OUT)}`);
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}

module.exports = {
  ROOT, OUT, NOW, SUBJECTS, TREATMENTS, LOCAL_INSPECTION_SCALE,
  promptFor, terrainPurpose, currentIntent, terrainFormIntent, directionFor,
  buildCandidate, buildExperiment,
};
