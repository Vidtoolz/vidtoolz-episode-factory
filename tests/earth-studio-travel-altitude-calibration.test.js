'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { assert, test } = require('./_helpers.js');
const planner = require('../earth-studio-job-planner.js');
const journey = require('../earth-studio-journey.js');
const continuity = require('../earth-studio-motion-continuity.js');
const calibration = require('../scripts/earth-studio-travel-altitude-calibration.js');
const review = require('../scripts/earth-studio-travel-altitude-review.js');
const trajectoryRereview = require('../scripts/earth-studio-position-trajectory-calibrated-ab.js');
const positionReview = require('../scripts/earth-studio-position-trajectory-review.js');

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function tempSession() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altitude-review-')); return path.join(dir, 'review-session.json'); }
function withoutAltitudeAndName(esp) {
  const copy = JSON.parse(JSON.stringify(esp));
  copy.settings.name = '__PROJECT__';
  const leaf = calibration.altitudeLeaf(copy);
  leaf.keyframes = '__ALTITUDE__'; leaf.value = '__ALTITUDE_VALUE__';
  return copy;
}

test('travel altitude calibration: exactly four cases have CURRENT plus three higher envelopes', () => {
  const manifest = calibration.generate().manifest;
  assert.deepEqual(manifest.cases.map((row) => row.id), calibration.CASES.map((row) => row.id));
  for (const item of manifest.cases) assert.deepEqual(Object.keys(item.candidates), ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']);
});

test('travel altitude calibration: candidates change only altitude and the project label', () => {
  const manifest = calibration.generate().manifest;
  for (const item of manifest.cases) {
    const source = read(path.join(calibration.ROOT, item.candidates.CURRENT.artifact));
    for (const id of ['HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
      const candidate = read(path.join(calibration.ROOT, item.candidates[id].artifact));
      assert.deepEqual(withoutAltitudeAndName(candidate), withoutAltitudeAndName(source), `${item.id} ${id}`);
    }
  }
});

test('travel altitude calibration: all choices share one isolated geographic playback contract', () => {
  const manifest = calibration.generate().manifest;
  for (const item of manifest.cases) {
    for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
      const candidate = read(path.join(calibration.ROOT, item.candidates[id].artifact));
      assert.equal(candidate.scenes[0].animationModel.groupedPosition, false, `${item.id} ${id}`);
    }
  }
});

test('travel altitude calibration: every envelope starts and ends local with one climb and one descent', () => {
  const manifest = calibration.generate().manifest;
  for (const item of manifest.cases) for (const id of ['HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
    const esp = read(path.join(calibration.ROOT, item.candidates[id].artifact));
    const alt = continuity.extractEspCameraTracks(esp).alt.map((row) => Math.round(row.value));
    assert.equal(alt[0], calibration.LOCAL_ALTITUDE_M);
    assert.equal(alt.at(-1), calibration.LOCAL_ALTITUDE_M);
    assert.equal(Math.max(...alt), item.candidates[id].cruise_altitude_m);
    const signs = alt.slice(1).map((value, i) => Math.sign(value - alt[i])).filter(Boolean);
    assert.deepEqual([...new Set(signs)], [1, -1], `${item.id} ${id}: altitude pump`);
  }
});

test('travel altitude calibration: candidate altitude is monotonic with apparent-speed calmness', () => {
  const manifest = calibration.generate().manifest;
  for (const item of manifest.cases) {
    const c = item.candidates;
    assert.ok(c.CURRENT.cruise_altitude_m < c.HIGHER_A.cruise_altitude_m);
    assert.ok(c.HIGHER_A.cruise_altitude_m < c.HIGHER_B.cruise_altitude_m);
    assert.ok(c.HIGHER_B.cruise_altitude_m < c.HIGHER_C.cruise_altitude_m);
    assert.ok(c.HIGHER_A.measured_proxy_fw_s > c.HIGHER_B.measured_proxy_fw_s);
    assert.ok(c.HIGHER_B.measured_proxy_fw_s > c.HIGHER_C.measured_proxy_fw_s);
  }
});

test('travel altitude calibration: fixed-tilt verdict does not silently promote production threshold', () => {
  assert.equal(journey.READABLE_SCREEN_SPEED_FW_PER_S, 1.0);
  const manifest = calibration.generate().manifest;
  for (const item of manifest.cases) {
    const expected = Math.max(...item.legs.map((leg) => journey.readableTransitAltitudeM(
      leg.distance_m, leg.duration_s, leg.tilt_deg, { planner, limit: 0.8 })));
    assert.ok(Math.abs(expected - item.candidates.HIGHER_A.cruise_altitude_m) <= 1, item.id);
  }
});

test('travel altitude production: small place to distant small place climbs, cruises high, then descends', () => {
  const compiled = journey.compileJourney({
    start: { location: 'Helsinki' }, start_movements: [{ type: 'hold', duration_seconds: 3 }],
    legs: [{ destination: { location: 'New York' }, travel_style: 'high_transit',
      travel: [{ type: 'climb_to_transit' }, { type: 'cruise' }, { type: 'descend' }],
      movements: [{ type: 'hold', duration_seconds: 3 }] }],
  });
  const phases = compiled.steps.filter((row) => ['climb_to_transit', 'cruise', 'descend'].includes(row.movement));
  assert.deepEqual(phases.map((row) => row.movement), ['climb_to_transit', 'cruise', 'descend']);
  assert.ok(phases[0].altitude_m > phases[0].altitude_from_m * 10);
  assert.equal(phases[1].altitude_from_m, phases[1].altitude_m);
  assert.equal(phases[1].altitude_m, phases[0].altitude_m);
  assert.ok(phases[2].altitude_m < phases[2].altitude_from_m / 10);
  assert.ok(journey.screenSpeedFrameWidths(phases[1].distance_m, phases[1].duration_seconds,
    phases[1].altitude_m, phases[1].tilt_deg, { planner }) <= journey.READABLE_SCREEN_SPEED_FW_PER_S + 0.001);
});

test('travel altitude calibration: same distance in less time requires a higher cruise', () => {
  const distance = 500000;
  const fast = journey.readableTransitAltitudeM(distance, 8, 45, { planner });
  const slow = journey.readableTransitAltitudeM(distance, 20, 45, { planner });
  assert.ok(fast > slow);
});

test('travel altitude calibration: short travel stays moderate while long travel rises substantially', () => {
  const short = journey.readableTransitAltitudeM(5000, 20, 45, { planner });
  const long = journey.readableTransitAltitudeM(6000000, 20, 45, { planner });
  assert.ok(short < 10000, `short altitude ${short}`);
  assert.ok(long > short * 500, `long ${long} vs short ${short}`);
});

test('travel altitude calibration: high latitude and antimeridian use physical geodesic distance', () => {
  const high = planner.haversineMeters({ latitude: 80, longitude: 10 }, { latitude: 80.5, longitude: 70 });
  const equator = planner.haversineMeters({ latitude: 0, longitude: 10 }, { latitude: 0.5, longitude: 70 });
  const seam = planner.haversineMeters({ latitude: 45, longitude: 179.5 }, { latitude: 45, longitude: -179.5 });
  assert.ok(high < equator / 4, `${high} vs ${equator}`);
  assert.ok(seam < 100000, `antimeridian detour ${seam}`);
});

test('travel altitude calibration: multi-point uses one stable cruise instead of a waypoint sawtooth', () => {
  const item = calibration.generate().manifest.cases.find((row) => row.id === 'MULTI-POINT-SEGMENT');
  assert.equal(item.legs.length, 2);
  for (const id of ['HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
    const authored = item.candidates[id].authored_altitude.map((row) => row.altitude_m);
    assert.equal(authored.filter((value) => value === item.candidates[id].cruise_altitude_m).length, 2);
    assert.equal(authored.length, 4);
  }
});

test('travel altitude calibration: generation is byte-deterministic', () => {
  const one = fs.mkdtempSync(path.join(os.tmpdir(), 'altitude-one-'));
  const two = fs.mkdtempSync(path.join(os.tmpdir(), 'altitude-two-'));
  const a = calibration.generate({ outputDir: one }).manifest;
  const b = calibration.generate({ outputDir: two }).manifest;
  for (let i = 0; i < a.cases.length; i += 1) for (const id of ['HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
    assert.equal(a.cases[i].candidates[id].sha256, b.cases[i].candidates[id].sha256);
  }
});

test('travel altitude review: four cases load with complete candidate integrity', () => {
  const pkg = review.loadReviewPackage();
  assert.equal(pkg.cases.length, 4);
  for (const item of pkg.cases) for (const id of review.CANDIDATES) assert.ok(fs.existsSync(item.candidates[id].absolute));
});

test('travel altitude review: a missing candidate fails loudly', () => {
  const manifest = read(path.join(review.DEFAULT_PACKAGE, 'calibration-manifest.json'));
  delete manifest.cases[0].candidates.HIGHER_C;
  assert.throws(() => review.loadReviewPackage(review.DEFAULT_PACKAGE, manifest), /missing HIGHER_C/);
});

test('travel altitude review: all verdicts persist with notes and resume state', () => {
  const pkg = review.loadReviewPackage();
  for (const verdict of review.VERDICTS) {
    const file = tempSession(); const session = review.freshSession(pkg);
    session.current_case_id = 'HIGH-LATITUDE';
    review.recordVerdict(session, 'MEDIUM-DIAGONAL', verdict, `note ${verdict}`, () => '2026-08-25T00:00:00.000Z');
    review.persistSession(file, session);
    const loaded = review.loadSession(pkg, file);
    assert.equal(loaded.current_case_id, 'HIGH-LATITUDE');
    assert.equal(loaded.records['MEDIUM-DIAGONAL'].verdict, verdict);
    assert.equal(loaded.records['MEDIUM-DIAGONAL'].note, `note ${verdict}`);
  }
});

test('travel altitude review: candidate-level Mikko authority survives session reload', () => {
  const pkg = review.loadReviewPackage(); const file = tempSession(); const session = review.freshSession(pkg);
  session.candidate_usability_authority = {
    assessment: { CURRENT: 'NOT_USABLE_CAMERA_TOO_LOW', HIGHER_A: 'USABLE',
      HIGHER_B: 'USABLE', HIGHER_C: 'NOT_USABLE_CAMERA_TOO_HIGH' },
  };
  review.persistSession(file, session);
  assert.deepEqual(review.loadSession(pkg, file).candidate_usability_authority,
    session.candidate_usability_authority);
});

test('travel altitude review: controller browser script parses and exposes the exact choices', () => {
  const html = review.pageHtml(); const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script); assert.doesNotThrow(() => new vm.Script(script[1]));
  assert.deepEqual(review.VERDICTS, ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C', 'NONE_GOOD']);
  assert.ok(html.includes('x.verdicts'));
  assert.ok(html.includes('x.candidates'));
});

test('calibrated trajectory re-review: four pairs share the exact accepted altitude envelope', () => {
  const generated = trajectoryRereview.generate().manifest;
  assert.deepEqual(generated.cases.map((row) => row.id), calibration.CASES.map((row) => row.id));
  for (const item of generated.cases) {
    const current = read(path.join(calibration.ROOT, item.versions.CURRENT.esp));
    const smooth = read(path.join(calibration.ROOT, item.versions.SMOOTH.esp));
    assert.deepEqual(calibration.altitudeLeaf(current), calibration.altitudeLeaf(smooth), item.id);
    assert.equal(item.calibrated_altitude.authority, 'Mikko minimum usable candidate HIGHER_A');
  }
  assert.equal(positionReview.loadReviewPackage(trajectoryRereview.OUT).cases.length, 4);
});

test('calibrated trajectory re-review: source CURRENT and SMOOTH artifacts remain unchanged', () => {
  const generated = trajectoryRereview.generate().manifest;
  for (const item of generated.cases) for (const label of ['CURRENT', 'SMOOTH']) {
    const version = item.versions[label];
    const bytes = fs.readFileSync(path.join(calibration.ROOT, version.source_esp));
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, version.source_sha256, `${item.id} ${label}`);
  }
});
