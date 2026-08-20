#!/usr/bin/env node
'use strict';
// Director acceptance canaries. These replace the earlier A/B/D canaries as the
// DIRECTORIAL test set: each one exists to check that the camera treatment was
// chosen because it communicates something, not because it was available.
//
// Deterministic: fixed job names, fixed generated_at, no randomness. Regenerating
// produces byte-identical .esp files unless the Director or journey model changed.
//
//   node scripts/earth-studio-director-canaries.js
//   node scripts/earth-studio-journey-import-gate.js --all      (real GES import)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'earth-studio-director.js'));
const J = require(path.join(ROOT, 'earth-studio-journey.js'));
const lane = require(path.join(ROOT, 'earth-studio-lane.js'));
const planner = require(path.join(ROOT, 'earth-studio-job-planner.js'));

const GATE = path.join(ROOT, 'package-runs/2026-08-19-earth-studio-director-acceptance');
const OUT = path.join(GATE, 'canaries');
const NOW = '2026-08-19T13:00:00.000Z';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Each canary states the DIRECTORIAL QUESTION it answers, so a human reviewer
// knows what to judge.
const CANARIES = [
  {
    id: 'DIRECTOR-A-landmark-subject', aspect: '16:9',
    title: 'DIRECTOR-A — Senate Square as a primary landmark subject',
    question: 'Does a small, visually important 3D subject get an inspection move, and only that?',
    expect: 'An orbit-class move at Senate Square. No spiral (not a hero), no globe, no travel.',
    intent: { stops: [{ location: 'Senate Square', role: 'PRIMARY_SUBJECT', importance: 'HIGH', purposes: ['ESTABLISH', 'INSPECT'] }] },
  },
  {
    id: 'DIRECTOR-B-city-to-city-hero', aspect: '16:9',
    title: 'DIRECTOR-B — Helsinki to Stockholm, Stockholm as the primary destination',
    question: 'Are departure, travel, arrival and inspection distinguishable, with the emphasis on the destination?',
    expect: 'Helsinki established without flourish; a shaped (cinematic) leg because the arrival matters; an orbit at Stockholm.',
    intent: { stops: [
      { location: 'Helsinki', role: 'STARTING_CONTEXT' },
      { location: 'Stockholm', role: 'PRIMARY_SUBJECT', importance: 'HIGH', purposes: ['ARRIVE', 'INSPECT'] }] },
  },
  {
    id: 'DIRECTOR-B2-same-geography-route-story', aspect: '16:9',
    title: 'DIRECTOR-B2 — the SAME geography directed as a ferry route instead',
    question: 'Does identical geography with a different story intent produce different direction?',
    expect: 'No orbit at Stockholm, no shaped arrival. It still climbs before crossing — 396 km flown at city framing is illegible — but that climb is functional, not ceremony. Substantially shorter than B.',
    intent: { stops: [
      { location: 'Helsinki', role: 'ROUTE_POINT' },
      { location: 'Stockholm', role: 'ROUTE_POINT', purposes: ['SHOW_ROUTE'] }] },
  },
  {
    id: 'DIRECTOR-D-scale-reveal', aspect: '16:9',
    title: 'DIRECTOR-D — Senate Square to Helsinki to Finland to Europe as a scale reveal',
    question: 'Does a nested scale story widen progressively, and stop short of the planet?',
    expect: 'Progressive pull-back/reveal at each rung. Explicitly NO globe shot.',
    intent: { stops: [
      { location: 'Senate Square', role: 'PRIMARY_SUBJECT', importance: 'HIGH', purposes: ['ESTABLISH'] },
      { location: 'Helsinki', role: 'SCALE_REFERENCE', purposes: ['SHOW_SCALE'] },
      { location: 'Finland', role: 'SCALE_REFERENCE', purposes: ['SHOW_SCALE'] },
      { location: 'Europe', role: 'GEOGRAPHIC_CONTEXT', purposes: ['SHOW_SCALE'] }] },
  },
  {
    id: 'DIRECTOR-ROUTE-restraint', aspect: '16:9',
    title: 'DIRECTOR-ROUTE — four route stops, only the last one matters',
    question: 'Does restraint stop a flourish appearing at every stop?',
    expect: 'Plain establishing shots at Helsinki, Stockholm and Copenhagen; the only inspection move at Berlin.',
    intent: { stops: [
      { location: 'Helsinki', role: 'ROUTE_POINT' },
      { location: 'Stockholm', role: 'ROUTE_POINT' },
      { location: 'Copenhagen', role: 'ROUTE_POINT' },
      { location: 'Berlin', role: 'PRIMARY_SUBJECT', importance: 'HIGH' }] },
  },
  {
    id: 'DIRECTOR-HERO-landmark-reveal', aspect: '9:16',
    title: 'DIRECTOR-HERO — locate Paris, then circle the Eiffel Tower',
    question: 'Does a hero landmark arrival get circled, with more emphasis than an ordinary inspection?',
    expect: 'Paris located top-down without performing; the Eiffel Tower CIRCLED (a hero-sized circle). Not spiralled — the tower is the endpoint the camera travelled to.',
    intent: { stops: [
      { location: 'Paris', role: 'GEOGRAPHIC_CONTEXT', purposes: ['LOCATE'] },
      { location: 'Eiffel Tower', role: 'FINAL_REVEAL', importance: 'HERO', purposes: ['REVEAL'] }] },
  },
  {
    id: 'DIRECTOR-GLOBAL-network', aspect: '16:9',
    title: 'DIRECTOR-GLOBAL — a shipping network across three continents',
    question: 'Is the whole planet used only when the story is genuinely global?',
    expect: 'A globe shot, justified by GLOBAL_NETWORK. Route points get no flourish.',
    intent: {
      stops: [
        { location: 'Shanghai', role: 'ROUTE_POINT' },
        { location: 'Amsterdam', role: 'ROUTE_POINT' },
        { location: 'Los Angeles', role: 'DESTINATION' }],
      globe_justification: 'GLOBAL_NETWORK',
    },
  },
  {
    id: 'DIRECTOR-TERRAIN-mountain', aspect: '16:9',
    title: 'DIRECTOR-TERRAIN — Zurich to the Matterhorn, terrain is the subject',
    question: 'Does a terrain story get a lower, raking angle than a city inspection?',
    expect: 'A legible approach (170 km cannot be flown low), then oblique treatment where the terrain is: descend to a tilted view and spiral the mountain.',
    intent: { stops: [
      { location: 'Zurich', role: 'STARTING_CONTEXT' },
      { location: 'Matterhorn', role: 'FINAL_REVEAL', importance: 'HERO', purposes: ['SHOW_TERRAIN', 'REVEAL'] }] },
  },
];

function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const records = [];
  const expected = {};
  for (const c of CANARIES) {
    const result = D.autoDirect({ ...c.intent, aspect: c.aspect });
    const journey = result.journey;
    // carry the story intent onto the journey so journey.json records the direction
    const stops = result.stops;
    journey.start.story = { role: stops[0].role, importance: stops[0].importance, purposes: stops[0].purposes };
    journey.legs.forEach((leg, i) => {
      const st = stops[i + 1];
      if (st) leg.destination.story = { role: st.role, importance: st.importance, purposes: st.purposes };
    });
    if (c.intent.globe_justification) journey.globe_justification = c.intent.globe_justification;
    const normalized = J.normalizeJourney(journey);
    normalized.globe_justification = c.intent.globe_justification || null;

    const check = J.validateJourney(normalized);
    if (!check.ok) throw new Error(`${c.id} invalid: ${check.errors.join('; ')}`);

    const pkg = path.join(OUT, c.id);
    fs.mkdirSync(pkg, { recursive: true });
    const out = lane.writeJob(pkg, { jobName: c.id, journey: normalized }, { now: NOW });
    const laneDir = path.join(pkg, 'earth-studio');
    // the directorial reasoning, beside the artifacts it produced
    fs.writeFileSync(path.join(laneDir, 'direction.json'), `${JSON.stringify({
      canary: c.id, title: c.title, question: c.question, expect: c.expect,
      intent: c.intent, globe: result.globe, notes: result.notes,
      decisions: result.decisions.map((d) => ({
        kind: d.kind, place: d.place || null, from: d.from || null, to: d.to || null,
        role: d.role || null, importance: d.importance || null,
        movement: d.decision.key, label: d.decision.label,
        purpose: d.decision.purpose, viewer_should_understand: d.decision.viewer_should_understand,
        why: d.decision.why, rarity: d.decision.rarity, emphasis: d.decision.emphasis,
        angle: d.decision.angle, communicates: d.decision.communicates,
        alternatives: (d.alternatives || []).map((a) => a.label),
        angle_limitation: d.decision.angle_limitation || null,
      })),
      explanation: D.explainDirection(result),
    }, null, 2)}\n`);

    const summary = J.summarizeJourney(normalized);
    records.push({
      id: c.id, title: c.title, question: c.question, expect: c.expect, aspect: c.aspect,
      duration_seconds: out.total_duration_seconds, total_frames: out.total_frames,
      render_dimensions: out.render_dimensions,
      esp: path.relative(ROOT, path.join(laneDir, 'earth-studio.esp')),
      esp_sha256: sha(path.join(laneDir, 'earth-studio.esp')),
      journey_json: path.relative(ROOT, path.join(laneDir, 'journey.json')),
      direction_json: path.relative(ROOT, path.join(laneDir, 'direction.json')),
      compiled_description: out.description,
      movements: summary.breakdown,
      prose: summary.prose,
      globe_used: result.globe.allowed,
      globe_reason: result.globe.reason,
      watch: c.question,
    });
    // the pinned directorial expectation a regression test asserts against
    expected[c.id] = {
      title: c.title,
      globe_allowed: result.globe.allowed,
      globe_justification: result.globe.justification || null,
      decisions: result.decisions.map((d) => ({
        kind: d.kind, at: d.place || `${d.from}->${d.to}`, movement: d.decision.key,
        purpose: d.decision.purpose, rarity: d.decision.rarity,
      })),
    };
  }
  fs.writeFileSync(path.join(GATE, 'canary-manifest.json'), `${JSON.stringify({
    gate: 'earth-studio DIRECTOR acceptance — does it look intentionally directed?',
    generated_at: NOW,
    director_version: D.DIRECTOR_VERSION,
    journey_version: J.JOURNEY_VERSION,
    planner_version: planner.VERSION,
    canaries: records,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(GATE, 'expected-decisions.json'), `${JSON.stringify(expected, null, 2)}\n`);
  records.forEach((r) => console.log(`${r.id.padEnd(38)} ${r.aspect.padEnd(6)} ${String(r.duration_seconds).padStart(5)}s ${String(r.total_frames).padStart(6)}f  globe=${r.globe_used ? 'YES' : 'no '}  ${r.esp_sha256.slice(0, 12)}`));
  console.log(`\n${records.length} director canaries written to ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) run();
module.exports = { CANARIES, run };
