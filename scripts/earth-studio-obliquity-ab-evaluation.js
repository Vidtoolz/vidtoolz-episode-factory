#!/usr/bin/env node
'use strict';

// scripts/earth-studio-obliquity-ab-evaluation.js
//
// Focused A/B evaluation set for SUBJECT-AWARE OPENING OBLIQUITY.
//
// For each case this directs the SAME operator intent twice through the exact
// production path (parseIntent -> autoDirect -> journey model -> lane.writeJob):
//
//   A — the heading-aware BASELINE: automatic obliquity promotion disabled
//       (the injected composition module answers KEEP_FLAT), so the opening
//       is exactly what the pre-obliquity Director produced.
//   B — the SAME intent with the live obliquity policy: eligible flat holds
//       are promoted to a stable oblique half-orbit ring opening; everything
//       the policy blocks stays byte-identical to A on purpose.
//
// Pairs where the policy honestly keeps the flat default (operator authority,
// map-view purposes, restraint, scale, budget, geometry) are labelled
// INTENTIONALLY_IDENTICAL — the review UI says so instead of pretending.
//
// Deterministic: fixed generated_at, fixed job names, no randomness.
// Re-running with unchanged code reproduces every .esp byte-for-byte.
//
//   node scripts/earth-studio-obliquity-ab-evaluation.js
//   node scripts/earth-studio-opening-ab-review.js --gate package-runs/2026-08-21-earth-studio-obliquity-ab
//   node scripts/earth-studio-journey-import-gate.js --gate package-runs/2026-08-21-earth-studio-obliquity-ab --list

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-obliquity-ab');
const NOW = '2026-08-21T12:00:00.000Z';

const D = require(path.join(ROOT, 'earth-studio-director.js'));
const J = require(path.join(ROOT, 'earth-studio-journey.js'));
const P = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const OC = require(path.join(ROOT, 'earth-studio-opening-composition.js'));
const lane = require(path.join(ROOT, 'earth-studio-lane.js'));

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// The A baseline: the real composition module with automatic obliquity
// switched off. planOpening (heading policy) stays LIVE in both variants, so
// the only difference between A and B is the obliquity decision.
const BASELINE_COMPOSITION = {
  ...OC,
  planOpeningObliquity: () => ({
    action: 'KEEP_FLAT', tilt_deg: null, tilt_band: null, movement: null,
    source: 'POLICY',
    reason: 'BASELINE_A: automatic obliquity disabled for this A/B comparison.',
  }),
};

// ── The focused cases ────────────────────────────────────────────────────────
// `judge` is what Mikko should actually look for; `expect` is the engineering
// expectation recorded for the automated checks — never used to fake results.
const CASES = [
  { id: 'OBQ-01-landmark-establish', kind: 'landmark establish',
    text: 'Show Helsinki Cathedral.',
    expect: 'B promotes the flat hold to a 50° half-orbit ring (establish_presence).',
    judge: 'Does B read as a composed introduction of the cathedral instead of a rotated map? Does B\'s motion stay restrained (a half revolution, no more)?' },
  { id: 'OBQ-02-landmark-inspect', kind: 'landmark inspect',
    text: 'Inspect the Colosseum.',
    expect: 'INSPECT already earns an orbit-class move from the ordinary grammar; obliquity defers. Identical.',
    judge: 'If identical, the deference is correct — inspection already owned the ring.' },
  { id: 'OBQ-03-landmark-emphasize', kind: 'landmark emphasize',
    text: 'Emphasize Helsinki Cathedral.',
    expect: 'EMPHASIZE earns its own orbit from the ordinary grammar; obliquity defers. Identical.',
    judge: 'If identical, the deference is correct.' },
  { id: 'OBQ-04-terrain-matterhorn', kind: 'mountain / terrain (72° raking case)',
    text: 'Show the terrain of the Matterhorn.',
    expect: 'SHOW_TERRAIN earns a 72° raking orbit from the ordinary grammar; obliquity defers. Identical.',
    judge: 'Judge the 72° raking angle itself: does the strong obliquity reveal relief, or does it feel excessive?' },
  { id: 'OBQ-05-city-establish', kind: 'city establish',
    text: 'Show Helsinki.',
    expect: 'City-scale meaning is 2D layout — no promotion. Identical.',
    judge: 'If identical, the restraint is correct: a city reads as a map, not a monument.' },
  { id: 'OBQ-06-city-orient', kind: 'city orient',
    text: 'Orient the viewer over Helsinki.',
    expect: 'ORIENT wants the map view — no promotion. Identical.',
    judge: 'If identical, the restraint is correct.' },
  { id: 'OBQ-07-city-arrival-inspect', kind: 'city arrival + inspect',
    text: 'Travel from Helsinki to Stockholm, then inspect Stockholm.',
    expect: 'The opening departs; obliquity only governs openings. Identical.',
    judge: 'Does the sequence still flow: flat departure, travel, arrival treatment at Stockholm?' },
  { id: 'OBQ-08-compact-island', kind: 'compact island (district scale)',
    text: 'Show Santorini.',
    expect: 'District scale with form: B promotes to a 50° ring.',
    judge: 'Does the oblique ring give the caldera visible form, or would the flat map read better?' },
  { id: 'OBQ-09-country-orient', kind: 'country orient',
    text: 'Show Finland.',
    expect: 'Country scale keeps the map view. Identical.',
    judge: 'If identical, the restraint is correct.' },
  { id: 'OBQ-10-large-country', kind: 'large country',
    text: 'Show Australia.',
    expect: 'Large-country scale keeps the map view. Identical.',
    judge: 'If identical, the restraint is correct.' },
  { id: 'OBQ-11-continent', kind: 'continent',
    text: 'Show Europe.',
    expect: 'Continent scale keeps the map view. Identical.',
    judge: 'If identical, the restraint is correct.' },
  { id: 'OBQ-12-landmark-then-travel', kind: 'landmark → immediate travel',
    text: 'Start at Helsinki Cathedral, then fly to Stockholm.',
    expect: 'Departure-first: the flat route-facing opening wins. Identical.',
    judge: 'Does the opening still face the departure and flow into the travel?' },
  { id: 'OBQ-13-explicit-hover', kind: 'EXPLICIT HOVER (operator authority)',
    text: 'Hover over Helsinki Cathedral.',
    expect: 'Operator movement authority: hover stays a hover. Identical.',
    judge: 'Confirm B does NOT introduce unwanted orbit motion — an explicit hover must stay perfectly still.' },
  { id: 'OBQ-14-explicit-orbit', kind: 'explicit orbit',
    text: 'Orbit Helsinki Cathedral.',
    expect: 'Orbit remains orbit in both variants. Identical.',
    judge: 'If identical, the operator\'s orbit was respected untouched.' },
  { id: 'OBQ-15-matched-comparison', kind: 'matched comparison',
    text: 'Compare Helsinki and Stockholm from roughly the same scale.',
    expect: 'Matched framing outranks glamour. Identical.',
    judge: 'Do both cities still read as one repeated, comparable shot?' },
  { id: 'OBQ-16-continuation', kind: 'continuation',
    continuation: true,
    text: 'Continue seamlessly from the previous animation, then fly to Stockholm.',
    expect: 'The exact hand-off is never re-framed. Identical.',
    judge: 'Does the continuation still begin exactly where the source ended?' },
  { id: 'OBQ-17-explicit-topdown', kind: 'explicit top-down',
    text: 'Show Helsinki Cathedral, and keep it top-down.',
    expect: 'Explicit top-down pins the plan view. Identical.',
    judge: 'If identical, the stated top-down was respected exactly.' },
  { id: 'OBQ-18-explicit-oblique', kind: 'explicit oblique request',
    text: 'Show Helsinki Cathedral from a low oblique angle.',
    expect: 'B honours the requested low-oblique band with a 50° ring; A stays flat.',
    judge: 'Does B deliver the oblique view the wording asked for, stable from frame 0?' },
  { id: 'OBQ-19-explicit-degrees', kind: 'explicit numeric tilt',
    text: 'Show Helsinki Cathedral tilted 45 degrees.',
    expect: 'An explicit numeric tilt outranks the automatic bands in BOTH variants (seeded literally). Identical.',
    judge: 'Note how the engine treats a literal 45° on a centered hold — this is the operator\'s stated number, applied without reinterpretation.' },
  { id: 'OBQ-20-route-restraint', kind: 'restraint: route story stays flat',
    text: 'Show the route from Helsinki to Stockholm.',
    expect: 'SHOW_ROUTE wants the map view. Identical.',
    judge: 'If identical, the restraint is correct: a route is a 2D story.' },
  { id: 'OBQ-21-hover-oblique-conflict', kind: 'CONFLICT: explicit hover + oblique',
    text: 'Hover over Helsinki Cathedral from an oblique angle.',
    expect: 'Hover wins; the un-holdable oblique is declined and recorded. Identical.',
    judge: 'Confirm B does NOT substitute an orbit. The engine cannot hold a stationary oblique framing; the honest answer is a flat hover.' },
];

function direct(c, options) {
  if (c.continuation) {
    const src = D.autoDirect(D.parseIntent('Hover over Helsinki Cathedral, then push in.'), options);
    const srcPlan = P.buildShotPlan(`${c.id}-source`, src.summary.description, NOW);
    const contState = J.continuationStateFromPlan(srcPlan);
    if (!contState) throw new Error(`${c.id}: could not derive continuation state`);
    return D.autoDirect({ stops: [{ location: 'Helsinki' }, { location: 'Stockholm' }], continuation_from: contState }, options);
  }
  return D.autoDirect(D.parseIntent(c.text), options);
}

function run() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const records = [];
  const canaries = [];
  const checks = [];

  for (const c of CASES) {
    const rA = direct(c, { composition: BASELINE_COMPOSITION });
    const rB = direct(c, {});
    const decA = rA.decisions[0] ? rA.decisions[0].decision : null;
    const decB = rB.decisions[0] ? rB.decisions[0].decision : null;
    const obliquity = decB && decB.obliquity ? decB.obliquity : null;

    const write = (variant, result) => {
      const dir = {
        director_version: D.DIRECTOR_VERSION,
        plan_version: result.plan.plan_version,
        plan: result.plan,
        audit: result.audit || null,
        globe: result.globe || null,
        explanation: D.explainDirection(result),
        opening_camera: result.plan.opening_camera || null,
        source: variant === 'A'
          ? 'earth-studio-director autoDirect — BASELINE (automatic obliquity disabled)'
          : 'earth-studio-director autoDirect — live obliquity policy',
      };
      const pkg = path.join(OUT, 'projects', `${c.id}-${variant}-${variant === 'A' ? 'baseline' : 'obliquity'}`);
      // Same jobName for both variants: the name is embedded in the .esp, and
      // an INTENTIONALLY_IDENTICAL pair must be byte-identical.
      const out = lane.writeJob(pkg, { jobName: c.id, journey: result.journey, direction: dir }, { now: NOW });
      return { out, esp: path.join(pkg, 'earth-studio', 'earth-studio.esp') };
    };
    const A = write('A', rA);
    const B = write('B', rB);
    const identical = sha(A.esp) === sha(B.esp);
    const label = identical ? 'INTENTIONALLY_IDENTICAL' : 'CHANGED';
    const promoted = !!(obliquity && obliquity.action === 'PROMOTE_TO_RING');
    if (promoted && identical) throw new Error(`${c.id}: promotion recorded but A/B identical — promotion did not reach the .esp`);
    if (!promoted && obliquity && obliquity.action === 'KEEP_FLAT' && !identical) {
      throw new Error(`${c.id}: policy kept flat but A/B differ — a hidden change leaked`);
    }

    const rec = (variant, side, result, dec) => ({
      id: `${c.id}-${variant}`,
      pair: c.id,
      variant,
      title: `${c.id} ${variant} — ${c.kind}`,
      kind: c.kind,
      category: c.kind,
      question: c.judge,
      expect: c.expect,
      changed: !identical,
      change_label: label,
      strategy: `A=${decA ? decA.movement : 'n/a'} → B=${decB ? decB.movement : 'n/a'}${decB && decB.tilt_deg != null ? ` @ ${decB.tilt_deg}°` : ''}`,
      confidence: result.journey.opening_composition ? result.journey.opening_composition.confidence : null,
      reason: obliquity ? obliquity.reason : (result.journey.opening_composition ? result.journey.opening_composition.reason : null),
      movement: dec ? dec.movement : null,
      tilt_deg: dec && dec.tilt_deg != null ? dec.tilt_deg : null,
      obliquity: variant === 'B' ? obliquity : (dec && dec.obliquity ? dec.obliquity : null),
      aspect: '16:9',
      duration_seconds: side.out.total_duration_seconds,
      total_frames: side.out.total_frames,
      render_dimensions: side.out.render_dimensions,
      esp: path.relative(ROOT, side.esp),
      esp_sha256: sha(side.esp),
    });
    const a = rec('A', A, rA, decA);
    const b = rec('B', B, rB, decB);
    records.push(a, b);
    canaries.push(a, b);
    checks.push({
      case: c.id, kind: c.kind, label,
      movement_a: decA ? decA.movement : null,
      movement_b: decB ? decB.movement : null,
      tilt_b: decB && decB.tilt_deg != null ? decB.tilt_deg : null,
      obliquity_action: obliquity ? obliquity.action : null,
      obliquity_source: obliquity ? obliquity.source : null,
      expected: c.expect,
    });
    console.log(`${c.id.padEnd(34)} ${label.padEnd(24)} A=${(decA ? decA.movement : '-').padEnd(10)} B=${(decB ? decB.movement : '-').padEnd(10)}${decB && decB.tilt_deg != null ? ` ${decB.tilt_deg}°` : ''}`);
  }

  const meta = {
    gate: 'earth-studio opening-OBLIQUITY A/B evaluation — oblique when useful, flat when appropriate, hover when hover was requested',
    generated_at: NOW,
    director_version: D.DIRECTOR_VERSION,
    journey_version: J.JOURNEY_VERSION,
    planner_version: P.VERSION,
    composition_version: OC.OPENING_COMPOSITION_VERSION,
  };
  fs.writeFileSync(path.join(OUT, 'generation-manifest.json'), `${JSON.stringify({ ...meta, records }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'canary-manifest.json'), `${JSON.stringify({ ...meta, canaries }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'automated-checks.json'), `${JSON.stringify(checks, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Opening-Obliquity A/B Evaluation (2026-08-21)

A = heading-aware baseline WITHOUT automatic obliquity promotion.
B = the same operator intent WITH the live obliquity policy.
Same fixed timestamp, same production path — the ONLY difference is the
obliquity decision. INTENTIONALLY_IDENTICAL pairs are byte-identical on
purpose: the policy honestly kept the flat default (operator authority,
map-view purpose, restraint, scale, budget, or geometry).

Technical evidence only. Nothing here claims the promoted openings are
beautiful — that verdict belongs to Mikko in the A/B review.

Review:       node scripts/earth-studio-opening-ab-review.js --gate ${path.relative(ROOT, OUT)}
Import check: node scripts/earth-studio-journey-import-gate.js --gate ${path.relative(ROOT, OUT)} --list
`);
  console.log(`\n${records.length} A/B projects written to ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) run();
module.exports = { CASES, run };
