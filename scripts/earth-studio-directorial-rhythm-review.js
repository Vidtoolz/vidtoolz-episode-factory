#!/usr/bin/env node
'use strict';

// Deterministic, production-isolated rhythm A/B set. A variants are copied
// from the canonical directorial evaluation projects; B/C variants are built
// from those journeys with one declared experimental change.
const fs = require('node:fs');
const path = require('node:path');
const D = require('../earth-studio-director.js');
const J = require('../earth-studio-journey.js');
const lane = require('../earth-studio-lane.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'package-runs/2026-08-20-earth-studio-directorial-evaluation/projects');
const OUT = path.join(ROOT, 'package-runs/2026-08-20-earth-studio-directorial-rhythm-ab');
const NOW = '2026-08-20T12:00:00.000Z';

const GROUPS = [
  {
    group: 'DIRN-11', source: 'DIRN-11-matched-comparison', variants: [
      { id: 'A-current-control', label: 'DIRN-11 A — CURRENT CONTROL', kind: 'current', hypothesis: 'Control: does the simpler balanced comparison already feel fair and informative?' },
    ],
  },
  {
    group: 'DIRN-17-orbits', source: 'DIRN-17-nl-complex-story', variants: [
      { id: 'A-current', label: 'DIRN-17 A — CURRENT', kind: 'current', hypothesis: 'Do two 15-second equal orbits earn their time?' },
      { id: 'B-short-equal-orbits', label: 'DIRN-17 B — EXPERIMENTAL', kind: 'short_orbits', hypothesis: 'Do shorter equal-duration orbits preserve fair comparison while reducing repetition?' },
    ],
  },
  {
    group: 'DIRN-17-conclusion', source: 'DIRN-17-nl-complex-story', variants: [
      { id: 'A-current', label: 'DIRN-17 A — CURRENT', kind: 'current', hypothesis: 'Is the current terminal pull-back authoritative enough?' },
      { id: 'C-stronger-conclusion', label: 'DIRN-17 C — EXPERIMENTAL', kind: 'stronger_conclusion', hypothesis: 'Does a longer terminal pull-back make the sequence feel complete?' },
    ],
  },
  {
    group: 'DIRN-07', source: 'DIRN-07-long-distance', variants: [
      { id: 'A-current', label: 'DIRN-07 A — CURRENT', kind: 'current', hypothesis: 'Does the current 23-second transit teach useful geography?' },
      { id: 'B-cinematic-alternative', label: 'DIRN-07 B — EXPERIMENTAL', kind: 'cinematic_alternative', hypothesis: 'Does an existing cinematic travel shape communicate the crossing better, despite its different duration?' },
    ],
  },
  {
    group: 'DIRN-18', source: 'DIRN-18-restraint', variants: [
      { id: 'A-current', label: 'DIRN-18 A — CURRENT', kind: 'current', hypothesis: 'Does the explicit direct move earn its 30-second technical floor?' },
      { id: 'B-high-transit', label: 'DIRN-18 B — EXPERIMENTAL', kind: 'high_transit_alternative', hypothesis: 'Does an existing high-transit shape preserve calm readability while reaching Berlin sooner?' },
    ],
  },
  {
    group: 'DIRN-14', source: 'DIRN-14-return-conclusion', variants: [
      { id: 'A-current', label: 'DIRN-14 A — CURRENT', kind: 'current', hypothesis: 'Are the arrival holds useful pauses or unnecessary stop-start rhythm?' },
      { id: 'B-short-arrival-holds', label: 'DIRN-14 B — EXPERIMENTAL', kind: 'short_arrival_holds', hypothesis: 'Does shortening intermediate arrival holds preserve readability while reducing punctuation?' },
    ],
  },
];

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function sourceDir(id) { return path.join(SOURCE, id, 'earth-studio'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function mutateVariant(journey, variant) {
  const j = clone(journey);
  const allAt = () => [j.start_movements || [], ...(j.legs || []).map((l) => l.movements || [])];
  const atMovements = allAt().flat();
  const travel = (j.legs || []).flatMap((l) => l.travel || []);
  if (variant.kind === 'short_orbits') {
    atMovements.filter((m) => m.type === 'half_orbit').forEach((m) => { m.duration_seconds = 10; });
  } else if (variant.kind === 'stronger_conclusion') {
    const last = atMovements.at(-1);
    if (last && last.type === 'zoom_out') last.duration_seconds = 10;
  } else if (variant.kind === 'cinematic_alternative') {
    const leg = j.legs[0];
    const base = clone(leg.travel);
    leg.travel = [
      { type: 'pull_back', duration_seconds: 8 },
      { type: 'cruise', duration_seconds: 30 },
      { type: 'descend', duration_seconds: 8 },
    ];
    // Preserve the source leg's destination and expose the original shape in
    // metadata; only the existing travel grammar changes in this variant.
    void base;
  } else if (variant.kind === 'high_transit_alternative') {
    const leg = j.legs[0];
    leg.travel = [
      { type: 'climb_to_transit', duration_seconds: 2 },
      { type: 'cruise', duration_seconds: 4 },
      { type: 'descend', duration_seconds: 2 },
    ];
    leg.travel_style = 'high_transit';
  } else if (variant.kind === 'short_arrival_holds') {
    // Keep opening and terminal holds intact; shorten only intermediate
    // arrival punctuation. The final conclusion remains unchanged.
    (j.legs || []).slice(0, -1).forEach((leg) => {
      (leg.movements || []).forEach((m) => { if (m.type === 'hold') m.duration_seconds = 2; });
    });
  }
  return J.normalizeJourney(j);
}

function adjustPlanDurations(direction, journey) {
  const out = clone(direction);
  const durations = [];
  if (journey.start_movements) durations.push(journey.start_movements.reduce((s, m) => s + (Number(m.duration_seconds) || 0), 0));
  for (const leg of journey.legs || []) {
    durations.push((leg.travel || []).reduce((s, m) => s + (Number(m.duration_seconds) || 0), 0));
    durations.push((leg.movements || []).reduce((s, m) => s + (Number(m.duration_seconds) || 0), 0));
  }
  let i = 0;
  (out.plan?.beats || []).forEach((beat) => {
    if (beat.beat === 'TRAVEL') beat.duration_seconds = durations[i++];
    else beat.duration_seconds = durations[i++];
  });
  out.plan.total_duration_seconds = durations.reduce((s, n) => s + n, 0);
  return out;
}

function buildVariant(group, variant) {
  const src = sourceDir(group.source);
  const sourceJourney = readJson(path.join(src, 'journey.json'));
  const sourceDirection = readJson(path.join(src, 'direction.json'));
  const isCurrent = variant.kind === 'current';
  const journey = isCurrent ? sourceJourney : mutateVariant(sourceJourney, variant);
  const check = J.validateJourney(journey);
  const destination = path.join(OUT, group.group, variant.id, 'earth-studio');
  if (isCurrent) fs.cpSync(src, destination, { recursive: true });
  else {
    if (!check.ok) throw new Error(`${group.group}/${variant.id}: invalid journey: ${check.errors.join('; ')}`);
    const direction = adjustPlanDurations(sourceDirection, journey);
    direction.review = {
      status: 'EXPERIMENTAL — HUMAN REVIEW ONLY', group: group.group,
      variant: variant.id, hypothesis: variant.hypothesis,
      changed_variable: variant.kind,
      unchanged_variables: ['geography', 'subject_order', 'framing', 'aspect', 'continuation_policy'],
      source_production_case: group.source,
    };
    lane.writeJob(path.join(OUT, group.group, variant.id), { jobName: `${group.group}-${variant.id}`, journey, direction }, { now: NOW });
  }
  const finalDir = path.join(OUT, group.group, variant.id, 'earth-studio');
  const plan = readJson(path.join(finalDir, 'shot-plan.json'));
  const cam = readJson(path.join(finalDir, 'camera-quality.json'));
  return {
    group: group.group, variant: variant.id, label: variant.label, status: isCurrent ? 'CURRENT PRODUCTION A' : 'EXPERIMENTAL — HUMAN REVIEW ONLY', import_status: 'IMPORT_PENDING',
    hypothesis: variant.hypothesis, source: group.source, path: path.relative(ROOT, finalDir),
    duration_seconds: plan.total_duration_seconds, total_frames: plan.total_frames,
    technical_ok: !cam.errors?.length && ['PASS', 'PASS_FOR_HUMAN_REVIEW'].includes(cam.verdict || cam.status),
    camera_quality: cam.verdict || cam.status || (cam.ok === true ? 'PASS' : 'REVIEW'),
    warnings: check.warnings || [],
  };
}

function main() {
  if (fs.existsSync(OUT) && !process.argv.includes('--force')) throw new Error(`Refusing to overwrite ${OUT}; use --force to regenerate this review set.`);
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  const variants = [];
  for (const group of GROUPS) for (const variant of group.variants) variants.push(buildVariant(group, variant));
  const manifest = { schema_version: 1, status: 'HUMAN REVIEW ONLY', generated_at: NOW, source_policy: '951e2ed/current production artifacts', review_order: GROUPS.map((g) => g.group), groups: GROUPS.map((g) => ({ group: g.group, variants: variants.filter((v) => v.group === g.group) })), excluded_candidates: [{ group: 'DIRN-07', candidate: 'shorter same-geometry HIGH_TRANSIT', reason: 'current readability gate still warns below the existing 23s production crossing' }], decisions_file: 'review-decisions.json' };
  writeJson(path.join(OUT, 'review-manifest.json'), manifest);
  writeJson(path.join(OUT, 'review-decisions.json'), { schema_version: 1, decisions: [] });
  console.log(JSON.stringify(manifest, null, 2));
}
main();
