'use strict';
// Generate the journey-builder real-import canary set (the fixtures the real
// Earth Studio import gate opens). Deterministic: fixed job names and a fixed
// generated_at, so regenerating produces byte-identical .esp files unless the
// journey model itself changed.
//
//   node scripts/earth-studio-journey-canaries.js
//
// Then observe them with scripts/earth-studio-journey-import-gate.js. Uses the production lane
// writer (earth-studio-lane.writeJob) so every artifact is exactly what the GUI
// would produce — no test-only shortcuts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const J = require(path.join(ROOT, 'earth-studio-journey.js'));
const lane = require(path.join(ROOT, 'earth-studio-lane.js'));
const planner = require(path.join(ROOT, 'earth-studio-job-planner.js'));

const OUT = path.join(ROOT, 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance/canaries');
const NOW = '2026-08-19T11:00:00.000Z';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const step = (type, extra) => ({ type, ...(extra || {}) });

function place(location, framing) { return framing ? { location, framing } : { location }; }
function leg(destination, style, movements, framing) {
  return {
    destination: place(destination, framing),
    travel_style: style,
    travel: J.TRAVEL_STYLES[style].steps.map((k) => J.newStep(k, 'travel')),
    movements: movements.map((m) => (typeof m === 'string' ? J.newStep(m, 'at') : J.normalizeStep(m, 'at'))),
  };
}

const CANARIES = [
  { id: 'A-landmark-16x9', title: 'Canary A — small landmark, AUTO framing, calm slow orbit',
    aspect: '16:9',
    journey: { pace: 'calm', start: place('Senate Square'), start_movements: [step('slow_orbit')], legs: [] },
    watch: 'Is Senate Square visible, centred and comfortably framed? Is the orbit calm? Does it settle cleanly?' },

  { id: 'B-city-to-city-16x9', title: 'Canary B — Helsinki to Stockholm, cinematic travel',
    aspect: '16:9',
    journey: { pace: 'calm', start: place('Helsinki'), start_movements: [step('slow_orbit')],
      legs: [leg('Stockholm', 'cinematic', ['slow_orbit'])] },
    watch: 'Helsinki established? Departure smooth? Cruise intelligible? Stockholm approach + framing sensible? Any jump into the destination orbit?' },

  { id: 'B-city-to-city-9x16', title: 'Canary B/9:16 — same journey, vertical',
    aspect: '9:16',
    journey: { pace: 'calm', start: place('Helsinki'), start_movements: [step('slow_orbit')],
      legs: [leg('Stockholm', 'cinematic', ['slow_orbit'])] },
    watch: 'Same journey in 9:16 — compare framing, headroom, orbit and travel visibility against the 16:9 version.' },

  { id: 'C-multi-stop-16x9', title: 'Canary C — Helsinki, Stockholm, Copenhagen, Berlin',
    aspect: '16:9',
    journey: { pace: 'calm', start: place('Helsinki'), start_movements: [step('slow_orbit')],
      legs: [leg('Stockholm', 'cinematic', ['slow_orbit']), leg('Copenhagen', 'cinematic', ['slow_orbit']), leg('Berlin', 'cinematic', ['slow_orbit'])] },
    watch: 'Validate each leg separately. Watch for accumulated drift or camera-state problems in the later legs.' },

  { id: 'D-scale-contrast-16x9', title: 'Canary D — landmark to country to continent (AUTO framing only)',
    aspect: '16:9',
    journey: { pace: 'calm', start: place('Senate Square'), start_movements: [step('hold')],
      legs: [leg('Finland', 'direct', ['hold']), leg('Europe', 'direct', ['hold'])] },
    watch: 'Is the target RECOGNISABLE at each scale? Landmark close, country wide, continent very wide — or is the composition visually useless?' },

  { id: 'H-orbit-large-scale-16x9', title: 'Canary H — Slow Orbit around a COUNTRY (orbit ring vs the planner 80 km cap)',
    aspect: '16:9',
    journey: { pace: 'calm', start: place('Finland'), start_movements: [step('slow_orbit')], legs: [] },
    watch: 'Is Finland visible at all? The orbit ring needed for a country-scale orbit is far beyond the generator 80 km ring cap.' },

  { id: 'I-wide-target-9x16', title: 'Canary I — a target WIDER than tall (Europe) in 9:16 vs 16:9',
    aspect: '9:16',
    journey: { pace: 'calm', start: place('Europe'), start_movements: [step('hold')], legs: [] },
    watch: 'Europe is ~4,500 km wide x ~3,000 km tall. Does the vertical frame crop it left/right?' },

  { id: 'I-wide-target-16x9', title: 'Canary I/16:9 — the same wide target for comparison',
    aspect: '16:9',
    journey: { pace: 'calm', start: place('Europe'), start_movements: [step('hold')], legs: [] },
    watch: 'Reference composition for the 9:16 comparison.' },

  { id: 'G-hold-then-orbit-16x9', title: 'Canary G — hold then orbit around a DIFFERENT centre (known slide)',
    aspect: '16:9',
    journey: { pace: 'calm', start: place('Helsinki'), start_movements: [step('hold')],
      legs: [{ destination: place('Espoo'), travel_style: 'custom', travel: [J.newStep('pause', 'travel')], movements: [J.newStep('orbit', 'at')] }] },
    watch: 'Does the camera visibly slide sideways onto the orbit ring? Is that a UX failure or an acceptable characteristic?' },
];

// Canary E is a PAIR: A ends, B continues from its exported state.
const results = [];
function emit(entry, journeyRaw, extra) {
  const pkg = path.join(OUT, entry.id);
  fs.mkdirSync(pkg, { recursive: true });
  const journey = J.normalizeJourney({ ...journeyRaw, aspect: entry.aspect });
  const check = J.validateJourney(journey);
  if (!check.ok) throw new Error(`${entry.id} invalid: ${check.errors.join('; ')}`);
  const out = lane.writeJob(pkg, { jobName: entry.id, journey }, { now: NOW });
  const laneDir = path.join(pkg, 'earth-studio');
  const summary = J.summarizeJourney(journey);
  const rec = {
    id: entry.id, title: entry.title, aspect: entry.aspect,
    duration_seconds: out.total_duration_seconds, total_frames: out.total_frames,
    render_dimensions: out.render_dimensions,
    esp: path.relative(ROOT, path.join(laneDir, 'earth-studio.esp')),
    esp_sha256: sha(path.join(laneDir, 'earth-studio.esp')),
    journey_json: path.relative(ROOT, path.join(laneDir, 'journey.json')),
    continuation_state: path.relative(ROOT, path.join(laneDir, 'continuation-state.json')),
    compiled_description: out.description,
    movements: summary.breakdown,
    prose: summary.prose,
    watch: entry.watch,
    ...(extra || {}),
  };
  results.push(rec);
  return { rec, laneDir, out };
}

CANARIES.forEach((c) => emit(c, c.journey));

// ── Canary E: continuation pair ──
const eA = emit({ id: 'E1-continuation-source-16x9', title: 'Canary E1 — continuation SOURCE: Helsinki to Stockholm', aspect: '16:9',
  watch: 'Note the FINAL rendered frame precisely; it must equal E2 frame 0.' },
  { pace: 'calm', start: place('Helsinki'), start_movements: [step('slow_orbit')],
    legs: [leg('Stockholm', 'cinematic', ['slow_orbit'])] });
const stateA = JSON.parse(fs.readFileSync(path.join(eA.laneDir, 'continuation-state.json'), 'utf8'));
const jB = J.journeyFromContinuationState(stateA, { destination: 'Copenhagen', aspect: '16:9' });
const eB = emit({ id: 'E2-continuation-target-16x9', title: 'Canary E2 — continuation TARGET: starts on E1 ending camera, then to Copenhagen', aspect: '16:9',
  watch: 'Frame 0 must be visually identical to E1 final frame. Then Stockholm to Copenhagen.' },
  jB, { continues_from: 'E1-continuation-source-16x9', expected_frame0_camera: stateA.camera });

fs.writeFileSync(path.join(OUT, '..', 'canary-manifest.json'), `${JSON.stringify({
  gate: 'earth-studio journey builder — real Google Earth Studio import observation',
  generated_at: NOW,
  planner_version: planner.VERSION,
  journey_version: J.JOURNEY_VERSION,
  motion_profile_version: planner.MOTION_PROFILE_VERSION,
  canaries: results,
}, null, 2)}\n`);

results.forEach((r) => console.log(`${r.id.padEnd(30)} ${r.aspect.padEnd(6)} ${String(r.duration_seconds).padStart(6)}s ${String(r.total_frames).padStart(6)}f  ${r.render_dimensions.width}x${r.render_dimensions.height}  ${r.esp_sha256.slice(0, 12)}`));
console.log(`\n${results.length} canaries written to ${path.relative(ROOT, OUT)}`);
