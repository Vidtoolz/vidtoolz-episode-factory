#!/usr/bin/env node
'use strict';

// scripts/earth-studio-opening-ab-evaluation.js
//
// Focused A/B evaluation set for SUBJECT-AWARE OPENING COMPOSITION.
//
// For each case this generates TWO Earth Studio projects through the exact
// production path (parseIntent -> autoDirect -> journey model -> lane.writeJob):
//
//   A — the OLD/default opening: the journey is generated WITHOUT the
//       composition seed, so the planner's proven default opening applies.
//   B — the NEW subject-aware opening: the same journey, with the Director's
//       opening_camera seed passed through the direction payload.
//
// Every other parameter is identical (same journey, same aspect, same fixed
// timestamp), so the only visual difference between A and B is the opening
// composition decision. Cases where the composition model honestly retains
// the default (or defers) produce byte-identical A/B pairs and are flagged
// `changed: false` — the review UI says so instead of pretending.
//
// Deterministic: fixed generated_at, fixed job names, no randomness.
// Re-running with unchanged code reproduces every .esp byte-for-byte.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-20-earth-studio-opening-composition-ab');
const NOW = '2026-08-20T12:00:00.000Z';

const D = require(path.join(ROOT, 'earth-studio-director.js'));
const J = require(path.join(ROOT, 'earth-studio-journey.js'));
const P = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const lane = require(path.join(ROOT, 'earth-studio-lane.js'));

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ── The focused cases ────────────────────────────────────────────────────────
// Each case states what a human should judge. The expected strategy is
// recorded for the automated checks; it is NOT used to fake results.
const CASES = [
  { id: 'OC-01-landmark-identity', kind: 'landmark with obvious visual identity',
    text: 'Hover over the Colosseum.',
    expect: 'No route or geometry evidence: B should honestly keep the proven default (identical to A).',
    judge: 'Does either opening look accidental? If identical, the system correctly declined to invent an angle.' },
  { id: 'OC-02-landmark-then-travel', kind: 'landmark where a generic heading is visibly weak',
    text: 'Start at the Colosseum, then travel to Milan.',
    expect: 'B opens facing the departure direction (southwest) instead of due north.',
    judge: 'Does B flow into the departure without a corrective swing? Does A look arbitrary by comparison?' },
  { id: 'OC-03-elongated-island', kind: 'elongated island',
    text: 'Start over Lofoten, then travel to Oslo.',
    expect: 'No footprint polygon available; B uses the route axis (the one honest axis) — faces the departure.',
    judge: 'Does the opening orientation give the archipelago a readable direction of travel?' },
  { id: 'OC-04-coastal-city', kind: 'city on a coastline',
    text: 'Start in Copenhagen, then travel to Stockholm.',
    expect: 'B faces the strait toward Stockholm — the departure AND the coast.',
    judge: 'Does B read as a coastal departure rather than a map default?' },
  { id: 'OC-05-inland-city', kind: 'inland city',
    text: 'Start in Munich, then travel to Berlin.',
    expect: 'B faces the outbound direction (north-northeast).',
    judge: 'Does the opening composition flow naturally into the first movement?' },
  { id: 'OC-06-mountain', kind: 'mountain',
    text: 'Start at the Matterhorn, then travel to Zurich.',
    expect: 'B faces the departure direction; tilt stays with the planner (no fake terrain knowledge).',
    judge: 'Does the mountain opening still respect terrain framing while orienting toward the journey?' },
  { id: 'OC-07-elongated-natural', kind: 'river / elongated natural feature',
    text: 'Start at the Grand Canyon, then travel to Los Angeles.',
    expect: 'No river geometry available; B uses the route axis honestly.',
    judge: 'Is the opening orientation defensible, or does it fight the feature?' },
  { id: 'OC-08-country-scale', kind: 'country-scale subject, heading restrained',
    text: 'Hover over Finland.',
    expect: 'Country scale: heading matters less than readability — B must retain the default (identical to A).',
    judge: 'If identical, the restraint is correct: no artificial directional drama for a country.' },
  { id: 'OC-09-outbound-direction', kind: 'city-to-city journey where outbound direction matters',
    text: 'Start in Helsinki, then travel to Tokyo.',
    expect: 'B opens facing east-northeast — the intercontinental departure.',
    judge: 'Does the first frame already point where the camera is going?' },
  { id: 'OC-10-landmark-then-immediate-travel', kind: 'landmark followed immediately by travel',
    text: 'Push in on Helsinki Cathedral, then travel to Tallinn.',
    expect: 'B orients the push-in toward the departure direction.',
    judge: 'Does the opening push-in and the following travel read as one intention?' },
  { id: 'OC-11-opening-orbit', kind: 'opening orbit',
    text: 'Orbit the Colosseum.',
    expect: 'Orbit openings are planner-owned: B must defer (identical to A).',
    judge: 'If identical, the deference is correct — the planner stages the ring; composition must not fight it.' },
  { id: 'OC-12-matched-comparison', kind: 'matched city comparison',
    text: 'Compare Helsinki and Stockholm from roughly the same scale.',
    expect: 'Comparison intent outranks glamour angles: B must keep the neutral policy (identical to A).',
    judge: 'Do both cities still read as one repeated, comparable shot?' },
  { id: 'OC-13-continuation', kind: 'continuation — automatic re-heading must NOT occur',
    continuation: true,
    text: 'Continue seamlessly from the previous animation, then fly to Stockholm.',
    expect: 'Exact hand-off wins: B must NOT re-frame (identical to A).',
    judge: 'Does the continuation still begin exactly where the source ended?' },
  { id: 'OC-14-explicit-override', kind: 'explicit user heading override',
    text: 'Approach the Colosseum from the west.',
    expect: 'Operator language wins: B opens facing east (camera on the west side).',
    judge: 'Does B respect the stated direction exactly?' },
  { id: 'OC-15-low-confidence', kind: 'low-confidence subject — safe default wins',
    text: 'Hover over Helsinki Cathedral.',
    expect: 'No evidence strong enough: B retains the default (identical to A).',
    judge: 'If identical, the graceful degradation is correct.' },
];

function buildJourneyForCase(c) {
  if (c.continuation) {
    const src = D.autoDirect(D.parseIntent('Hover over Helsinki Cathedral, then push in.'));
    const srcPlan = P.buildShotPlan(`${c.id}-source`, src.summary.description, NOW);
    const contState = J.continuationStateFromPlan(srcPlan);
    if (!contState) throw new Error(`${c.id}: could not derive continuation state`);
    return D.autoDirect({ stops: [{ location: 'Helsinki' }, { location: 'Stockholm' }], continuation_from: contState });
  }
  return D.autoDirect(D.parseIntent(c.text));
}

function run() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const records = [];
  const canaries = [];
  const checks = [];

  for (const c of CASES) {
    const result = buildJourneyForCase(c);
    const journey = result.journey;
    const comp = journey.opening_composition || null;
    const seed = journey.opening_camera || null;
    const changed = !!seed;

    const baseDirection = {
      director_version: D.DIRECTOR_VERSION,
      plan_version: result.plan.plan_version,
      plan: result.plan,
      audit: result.audit || null,
      globe: result.globe || null,
      explanation: D.explainDirection(result),
      source: 'earth-studio-director autoDirect (deterministic; no LLM)',
    };

    // A — OLD/default: no seed anywhere (the plan's seed is stripped too, so
    // the lane's direction fallback cannot re-apply it).
    const planA = { ...result.plan, opening_camera: null };
    const dirA = { ...baseDirection, plan: planA, opening_camera: null };
    const outA = lane.writeJob(path.join(OUT, 'projects', `${c.id}-A-default`), { jobName: c.id, journey, direction: dirA }, { now: NOW });
    // B — NEW: with the composition seed (identical journey otherwise).
    const dirB = { ...baseDirection, opening_camera: seed };
    const outB = lane.writeJob(path.join(OUT, 'projects', `${c.id}-B-composed`), { jobName: c.id, journey, direction: dirB }, { now: NOW });

    const espA = path.join(OUT, 'projects', `${c.id}-A-default`, 'earth-studio', 'earth-studio.esp');
    const espB = path.join(OUT, 'projects', `${c.id}-B-composed`, 'earth-studio', 'earth-studio.esp');
    const identical = sha(espA) === sha(espB);
    if (changed && identical) throw new Error(`${c.id}: seed present but A/B identical — seed did not reach the .esp`);
    if (!changed && !identical) throw new Error(`${c.id}: no seed but A/B differ — non-determinism or leak`);

    const rec = (variant, out, esp) => ({
      id: `${c.id}-${variant}`,
      pair: c.id,
      variant,
      title: `${c.id} ${variant} — ${c.kind}`,
      category: c.kind,
      question: c.judge,
      expect: variant === 'A' ? 'OLD/default opening (planner default, no composition seed).' : `NEW subject-aware opening: ${comp ? comp.strategy : 'n/a'}.`,
      changed,
      strategy: comp ? comp.strategy : null,
      confidence: comp ? comp.confidence : null,
      reason: comp ? comp.reason : null,
      opening_camera: variant === 'B' ? seed : null,
      aspect: '16:9',
      duration_seconds: out.total_duration_seconds,
      total_frames: out.total_frames,
      render_dimensions: out.render_dimensions,
      esp: path.relative(ROOT, esp),
      esp_sha256: sha(esp),
    });
    const rA = rec('A', outA, espA);
    const rB = rec('B', outB, espB);
    records.push(rA, rB);
    canaries.push(rA, rB);

    checks.push({
      case: c.id, kind: c.kind, strategy: comp ? comp.strategy : null,
      confidence: comp ? comp.confidence : null, changed, identical,
      expected: c.expect,
    });
    console.log(`${c.id.padEnd(38)} ${String(comp && comp.strategy).padEnd(22)} changed=${changed ? 'yes' : 'no '} ${c.kind}`);
  }

  fs.writeFileSync(path.join(OUT, 'generation-manifest.json'), `${JSON.stringify({
    gate: 'earth-studio opening-composition A/B evaluation — is the first frame chosen, not defaulted?',
    generated_at: NOW,
    director_version: D.DIRECTOR_VERSION,
    journey_version: J.JOURNEY_VERSION,
    planner_version: P.VERSION,
    records,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'canary-manifest.json'), `${JSON.stringify({
    gate: 'earth-studio opening-composition A/B import gate',
    generated_at: NOW,
    director_version: D.DIRECTOR_VERSION,
    journey_version: J.JOURNEY_VERSION,
    planner_version: P.VERSION,
    canaries,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'automated-checks.json'), `${JSON.stringify(checks, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Opening-Composition A/B Evaluation (2026-08-20)

For each case: A = old/default opening, B = subject-aware opening. Identical
journeys otherwise. \`changed=false\` pairs are byte-identical on purpose —
the composition model honestly retained the default or deferred.

Review: node scripts/earth-studio-opening-ab-review.js
Import check: node scripts/earth-studio-journey-import-gate.js --gate ${path.relative(ROOT, OUT)} --list
`);
  console.log(`\n${records.length} A/B projects written to ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) run();
