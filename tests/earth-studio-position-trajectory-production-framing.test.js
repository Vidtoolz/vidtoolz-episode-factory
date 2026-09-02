'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const generator = require('../scripts/earth-studio-position-trajectory-production-framing-ab.js');
const heightAware = require('../scripts/earth-studio-height-aware-altitude-calibration.js');

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function sourceHashes() {
  const manifest = read(path.join(generator.SOURCE, 'real-earth-studio-ab.json'));
  return Object.fromEntries(manifest.cases.flatMap((row) => ['CURRENT', 'SMOOTH'].map((variant) => {
    const file = path.resolve(generator.ROOT, row.versions[variant].esp);
    return [`${row.id}/${variant}`, sha(file)];
  })));
}

test('production-framing trajectory review has four controlled pairs at the minimum sufficient solve', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'earth-studio-production-framing-'));
  const before = sourceHashes();
  try {
    const { manifest } = generator.generate({ outputDir: temporary });
    assert.deepEqual(manifest.cases.map((row) => row.id), generator.CASE_IDS);
    assert.equal(manifest.production_framing_model.target_apparent_speed_fw_s, 0.8);
    assert.equal(manifest.production_framing_model.headroom_multiplier, 1);
    for (const row of manifest.cases) {
      assert.equal(row.production_solve.satisfied, true);
      assert.ok(row.production_solve.predicted_apparent_speed_fw_s <= 0.8);
      const current = read(path.resolve(generator.ROOT, row.versions.CURRENT.esp));
      const smooth = read(path.resolve(generator.ROOT, row.versions.SMOOTH.esp));
      assert.deepEqual(heightAware.altitudeLeaf(current), heightAware.altitudeLeaf(smooth), `${row.id}: altitude differs`);
      assert.deepEqual(heightAware.tiltLeaf(current), heightAware.tiltLeaf(smooth), `${row.id}: tilt differs`);
      assert.equal(current.settings.duration, smooth.settings.duration, `${row.id}: duration differs`);
      assert.deepEqual(row.versions.CURRENT.altitude_tilt_envelope,
        row.versions.SMOOTH.altitude_tilt_envelope, `${row.id}: envelope differs`);
    }
    assert.deepEqual(sourceHashes(), before, 'historical source ESP bytes changed');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
