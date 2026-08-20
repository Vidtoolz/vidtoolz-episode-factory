const { assert, fs, os, path, test } = require('./_helpers.js');
const quality = require('../earth-studio-camera-quality.js');
const lane = require('../earth-studio-lane.js');

function tmpPkg() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'es-camera-quality-'));
  const pkg = path.join(root, 'aigen', 'script-packages', 'quality');
  fs.mkdirSync(pkg, { recursive: true });
  return pkg;
}

test('camera quality gate writes a machine report for journey jobs', () => {
  const pkg = tmpPkg();
  const out = lane.writeJob(pkg, {
    jobName: 'Quality gate journey',
    journey: {
      aspect: '16:9',
      start: { location: 'Helsinki' },
      start_movements: [{ type: 'hold', duration_seconds: 3 }],
      legs: [{
        destination: { location: 'Stockholm' },
        travel_style: 'direct',
        travel: [{ type: 'fly', duration_seconds: 10 }],
        movements: [{ type: 'hold', duration_seconds: 3 }],
      }],
    },
  }, { now: '2026-08-19T12:00:00.000Z' });
  const reportPath = path.join(pkg, 'earth-studio', 'camera-quality.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.verdict, 'PASS_FOR_HUMAN_REVIEW');
  assert.ok(out.files.includes('camera-quality.json'));
  assert.equal(report.motion_policy.source, 'journey');
  assert.ok(report.tracks.altitude.keyframes > 0);
  assert.equal(lane.status(pkg, 'unused').camera_quality.verdict, 'PASS_FOR_HUMAN_REVIEW');
});

test('camera quality gate rejects missing camera tracks', () => {
  const report = quality.evaluate({
    plan: { total_duration_seconds: 1, segments: [{ duration_seconds: 1, start_frame: 0, end_frame: 1, altitude_m: 10, tilt_deg: 20 }] },
    esp: { camera: { tracks: [] } },
  });
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.errors.some((error) => error.includes('camera tracks missing')));
});
