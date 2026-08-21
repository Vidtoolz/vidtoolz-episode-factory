#!/usr/bin/env node
'use strict';

// Authenticated Earth Studio consecutive-frame probe for the isolated DIRN17
// orbit->travel candidates. Production evaluation remains offline.

const fs = require('node:fs');
const path = require('node:path');
const gate = require('./earth-studio-journey-import-gate');
const continuity = require('../earth-studio-motion-continuity');
const candidateTool = require('./earth-studio-orbit-travel-handoff');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const OUT = candidateTool.OUT;
const BOUNDARY = candidateTool.BOUNDARY;
const BEFORE = 60;
const AFTER = 120;

function angleDelta(after, before) { return ((after - before + 540) % 360) - 180; }
function bearing(dx, dy) { return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; }
function median(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function derive(frames, frameRate, targets) {
  const rows = frames.map((row) => ({ ...row }));
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const row = rows[index];
    const dt = (row.frame - before.frame) / frameRate;
    const meanLat = (row.latitude + before.latitude) * Math.PI / 360;
    const east = (row.longitude - before.longitude) * 111320 * Math.cos(meanLat) / dt;
    const north = (row.latitude - before.latitude) * 111320 / dt;
    row.ground_velocity_east_mps = east;
    row.ground_velocity_north_mps = north;
    row.ground_speed_mps = Math.hypot(east, north);
    row.trajectory_bearing_deg = row.ground_speed_mps > 1 ? bearing(east, north) : null;
    row.altitude_speed_mps = (row.altitude - before.altitude) / dt;
    row.pan_speed_dps = angleDelta(row.pan_deg, before.pan_deg) / dt;
    row.tilt_speed_dps = (row.tilt_deg - before.tilt_deg) / dt;
    for (const [name, target] of Object.entries(targets)) {
      const expected = continuity.initialBearing(row, target);
      row[`${name}_bearing_deg`] = expected;
      row[`${name}_facing_error_deg`] = Math.abs(angleDelta(row.pan_deg, expected));
      row[`${name}_radius_m`] = continuity.haversineMeters(row, target);
    }
  }
  for (let index = 2; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const row = rows[index];
    const dt = (row.frame - before.frame) / frameRate;
    row.ground_acceleration_mps2 = (row.ground_speed_mps - before.ground_speed_mps) / dt;
    row.pan_acceleration_dps2 = (row.pan_speed_dps - before.pan_speed_dps) / dt;
  }
  return rows;
}

function analyze(rows) {
  const active = rows.filter((row) => row.frame >= BOUNDARY - 15 && row.frame <= BOUNDARY + AFTER);
  const incoming = active.filter((row) => row.frame >= BOUNDARY - 15 && row.frame <= BOUNDARY - 5);
  const outgoing = active.filter((row) => row.frame >= BOUNDARY + 5 && row.frame <= BOUNDARY + 15);
  let maximumTurn = { degrees: 0, frame: null };
  for (let index = 1; index < active.length; index += 1) {
    const before = active[index - 1];
    const row = active[index];
    if (before.ground_speed_mps <= 100 || row.ground_speed_mps <= 100) continue;
    const turn = Math.abs(angleDelta(row.trajectory_bearing_deg, before.trajectory_bearing_deg));
    if (Number.isFinite(turn) && turn > maximumTurn.degrees) maximumTurn = { degrees: turn, frame: row.frame };
  }
  const max = (key) => Math.max(0, ...active.map((row) => Math.abs(row[key] || 0)));
  const targetError = (name) => Math.max(0, ...active.map((row) => row[`${name}_facing_error_deg`] || 0));
  return {
    ground_direction: {
      incoming_median_deg: median(incoming.map((row) => row.trajectory_bearing_deg)),
      outgoing_median_deg: median(outgoing.map((row) => row.trajectory_bearing_deg)),
      maximum_one_frame_turn_deg: maximumTurn.degrees,
      maximum_one_frame_turn_frame: maximumTurn.frame,
    },
    speed: {
      incoming_median_mps: median(incoming.map((row) => row.ground_speed_mps)),
      outgoing_median_mps: median(outgoing.map((row) => row.ground_speed_mps)),
      minimum_mps: Math.min(...active.map((row) => row.ground_speed_mps).filter(Number.isFinite)),
      maximum_mps: max('ground_speed_mps'),
      maximum_acceleration_mps2: max('ground_acceleration_mps2'),
    },
    pan: { incoming_median_dps: median(incoming.map((row) => row.pan_speed_dps)), outgoing_median_dps: median(outgoing.map((row) => row.pan_speed_dps)),
      maximum_acceleration_dps2: max('pan_acceleration_dps2') },
    altitude: { maximum_speed_mps: max('altitude_speed_mps') },
    tilt: { maximum_speed_dps: max('tilt_speed_dps') },
    target_facing: { stockholm_max_error_deg: targetError('stockholm'), scandinavia_max_error_deg: targetError('scandinavia') },
  };
}

async function probe(candidate, port) {
  const plan = JSON.parse(fs.readFileSync(path.join(candidateTool.ROOT, candidate.shot_plan), 'utf8'));
  const before = plan.segments.find((row) => row.end_frame === BOUNDARY);
  const after = plan.segments.find((row) => row.start_frame === BOUNDARY);
  const record = { id: candidate.id, variant: candidate.variant, boundary_frame: BOUNDARY,
    primitive_before: before.action, primitive_after: after.action,
    targets: { stockholm: before.location, scandinavia: after.location },
    method: { authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues()', frame_window: [-BEFORE, AFTER], settle_ms: 180 },
    import: null, frames: [], analysis: null, errors: [] };
  const browser = await gate.launch({ port, headless: true, width: 1920, height: 1080 });
  try {
    const cdp = await gate.newTab(port, 'https://earth.google.com/studio/');
    await delay(13000);
    await gate.importEsp(cdp, path.join(candidateTool.ROOT, candidate.esp));
    record.import = await gate.projectInfo(cdp);
    for (let frame = BOUNDARY - BEFORE; frame <= BOUNDARY + AFTER; frame += 1) {
      record.frames.push(await gate.gotoFrame(cdp, frame, 180));
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    record.frames = derive(record.frames, plan.frame_rate || 30, record.targets);
    record.analysis = analyze(record.frames);
    cdp.close();
  } catch (error) {
    record.errors.push(error.message);
    record.chrome_stderr_tail = browser.stderr().slice(-1500);
  } finally {
    try { browser.chrome.kill('SIGKILL'); } catch (_) {}
  }
  const dir = path.join(OUT, 'real-traces');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${candidate.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'candidate-manifest.json'), 'utf8'));
  const requested = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : null;
  const candidates = requested ? manifest.candidates.filter((row) => row.id === requested) : manifest.candidates;
  if (!candidates.length) throw new Error(`unknown candidate: ${requested}`);
  const records = [];
  let port = 9840;
  for (const candidate of candidates) {
    console.log(`\n=== ${candidate.id} ===`);
    records.push(await probe(candidate, ++port));
  }
  const compact = records.map((row) => ({ id: row.id, variant: row.variant, imported: Boolean(row.import) && !row.errors.length,
    frame_count: row.frames.length, analysis: row.analysis, errors: row.errors }));
  const summaryPath = path.join(OUT, 'real-earth-studio-comparison.json');
  const prior = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')).cases || [] : [];
  const replaced = new Set(compact.map((row) => row.id));
  const cases = [...prior.filter((row) => !replaced.has(row.id)), ...compact];
  fs.writeFileSync(summaryPath, `${JSON.stringify({ generated_at: new Date().toISOString(), cases }, null, 2)}\n`);
  console.log(JSON.stringify(compact, null, 2));
  if (records.some((row) => row.errors.length)) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { derive, analyze, probe };
