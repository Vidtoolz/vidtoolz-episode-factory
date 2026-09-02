#!/usr/bin/env node
'use strict';

// Rebuild the four human-review trajectory pairs at Mikko's minimum usable
// travel-altitude envelope. This is review evidence only: source artifacts and
// production trajectory selection remain untouched.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const altitude = require('./earth-studio-travel-altitude-calibration.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-position-trajectory');
const ALTITUDE = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-travel-altitude-calibration');
const OUT = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-position-trajectory-calibrated-altitude');
const CASES = altitude.CASES;
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function relative(file) { return path.relative(ROOT, file); }

function generate(options = {}) {
  const outputDir = options.outputDir || OUT;
  const sourceManifest = read(path.join(SOURCE, 'real-earth-studio-ab.json'));
  const altitudeManifest = read(path.join(ALTITUDE, 'calibration-manifest.json'));
  const sourceById = new Map(sourceManifest.cases.map((row) => [row.id, row]));
  const altitudeById = new Map(altitudeManifest.cases.map((row) => [row.id, row]));
  const cases = [];
  for (const spec of CASES) {
    const source = sourceById.get(spec.id); const calibrated = altitudeById.get(spec.id);
    if (!source || !calibrated || !calibrated.candidates.HIGHER_A) throw new Error(`${spec.id}: calibrated source pair missing`);
    const altitudeEspPath = path.resolve(ROOT, calibrated.candidates.HIGHER_A.artifact);
    const altitudeEsp = read(altitudeEspPath); const acceptedLeaf = clone(altitude.altitudeLeaf(altitudeEsp));
    const record = { id: spec.id, description: source.description,
      calibrated_altitude: { authority: 'Mikko minimum usable candidate HIGHER_A',
        cruise_altitude_m: calibrated.candidates.HIGHER_A.cruise_altitude_m,
        source: relative(altitudeEspPath), source_sha256: sha(fs.readFileSync(altitudeEspPath)) }, versions: {} };
    for (const label of ['CURRENT', 'SMOOTH']) {
      const sourcePath = path.resolve(ROOT, source.versions[label].esp);
      const sourceBytes = fs.readFileSync(sourcePath); const esp = JSON.parse(sourceBytes);
      esp.settings.name = `${spec.id}-${label}-CALIBRATED-ALTITUDE`;
      const targetLeaf = altitude.altitudeLeaf(esp);
      targetLeaf.value = clone(acceptedLeaf.value);
      targetLeaf.keyframes = clone(acceptedLeaf.keyframes);
      const dir = path.join(outputDir, 'projects', spec.id, label);
      fs.mkdirSync(dir, { recursive: true });
      const artifact = path.join(dir, 'earth-studio.esp');
      fs.writeFileSync(artifact, `${JSON.stringify(esp, null, 2)}\n`);
      record.versions[label] = { esp: relative(artifact), sha256: sha(fs.readFileSync(artifact)),
        source_esp: relative(sourcePath), source_sha256: sha(sourceBytes),
        total_frames: esp.settings.duration, calibrated_altitude_sha256: sha(Buffer.from(JSON.stringify(acceptedLeaf))) };
    }
    cases.push(record);
  }
  const manifest = { schema_version: 2, generated_at: '2026-08-25T00:00:00.000Z',
    status: 'READY_FOR_TRAJECTORY_HUMAN_REVIEW_NOT_PRODUCTION',
    altitude_authority: { candidate: 'HIGHER_A', rationale: 'lowest human-usable altitude; CURRENT too low, HIGHER_C too high' },
    controlled_difference: 'CURRENT versus SMOOTH position trajectory; altitude envelope, duration, tilt, FOV, and endpoints are identical per pair',
    cases };
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, 'real-earth-studio-ab.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'README.md'), '# Position trajectory re-review at calibrated altitude\n\nCURRENT and SMOOTH use the identical Mikko-calibrated HIGHER_A climb → cruise → descent envelope. This package is human-review evidence only and does not productionize SMOOTH.\n');
  return { manifest, manifestPath };
}

if (require.main === module) {
  try { const out = generate(); console.log(`Calibrated trajectory A/B generated: ${relative(out.manifestPath)}`); }
  catch (error) { console.error(`CALIBRATED_TRAJECTORY_AB_FAILED — ${error.message}`); process.exitCode = 1; }
}

module.exports = { ROOT, SOURCE, ALTITUDE, OUT, CASES, generate };
