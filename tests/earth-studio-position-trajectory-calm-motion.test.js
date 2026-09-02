'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const continuity = require('../earth-studio-motion-continuity.js');
const calm = require('../scripts/earth-studio-position-trajectory-calm-motion-ab.js');
const heightAware = require('../scripts/earth-studio-height-aware-altitude-calibration.js');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function directionReversals(track, startFrame, endFrame, totalFrames) {
  let previous = null; let sign = 0; let reversals = 0;
  for (let frame = startFrame; frame <= endFrame; frame += 1) {
    const value = continuity.playbackValueAt(track, frame / totalFrames);
    if (previous !== null) {
      const delta = value - previous;
      if (Math.abs(delta) > 1e-9) {
        const next = Math.sign(delta);
        if (sign && next !== sign) reversals += 1;
        sign = next;
      }
    }
    previous = value;
  }
  return reversals;
}

test('calm-motion review slows every phase and removes climb/descent coordinate reversals', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'earth-studio-calm-motion-'));
  try {
    const { manifest } = calm.generate({ outputDir: temporary });
    assert.equal(manifest.cases.length, 4);
    for (const row of manifest.cases) {
      assert.ok(row.total_frames > row.timing.old_total_frames);
      assert.equal(row.timing.climb_descent_scale, 2);
      assert.equal(row.timing.cruise_scale, 1.25);
      const current = read(path.resolve(calm.ROOT, row.versions.CURRENT.esp));
      const smooth = read(path.resolve(calm.ROOT, row.versions.SMOOTH.esp));
      assert.deepEqual(heightAware.altitudeLeaf(current), heightAware.altitudeLeaf(smooth));
      assert.deepEqual(heightAware.tiltLeaf(current), heightAware.tiltLeaf(smooth));
      assert.notDeepEqual(heightAware.positionLeaf(current, 'latitude').keyframes,
        heightAware.positionLeaf(smooth, 'latitude').keyframes,
        `${row.id}: trajectory comparison was erased`);
      for (const esp of [current, smooth]) {
        const tracks = continuity.extractEspCameraTracks(esp);
        assert.equal(directionReversals(tracks.lat, 0, row.timing.new_phases.climbEnd,
          row.total_frames), 0, `${row.id}: climb latitude reversal`);
        assert.equal(directionReversals(tracks.lat, row.timing.new_phases.descentStart,
          row.total_frames, row.total_frames), 0, `${row.id}: descent latitude reversal`);
      }
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
