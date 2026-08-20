#!/usr/bin/env node
'use strict';
// Directorial evaluation set — 18 cases designed to expose directorial weakness.
//
// The 8 pinned director canaries (2026-08-19) are regression evidence for the
// decision layer's stability; this set is the fresh HUMAN VISUAL EVALUATION
// material: varied geography and narrative purpose, generated through the SAME
// path the GUI uses (parseIntent -> autoDirect -> journey model -> production
// lane), with every directorial decision persisted beside the artifacts it
// produced, so a shot that looks wrong can be traced to the decision that made it.
//
// Deterministic: fixed job names, fixed generated_at, no randomness. Regenerating
// produces byte-identical .esp files unless the Director, journey model or
// planner changed.
//
//   node scripts/earth-studio-directorial-evaluation.js
//   node scripts/earth-studio-journey-import-gate.js --gate package-runs/2026-08-20-earth-studio-directorial-evaluation --list
//
// This is technical evidence only. Aesthetic verdicts belong to Mikko's visual
// review — nothing here may be read as "visually approved".
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'earth-studio-director.js'));
const J = require(path.join(ROOT, 'earth-studio-journey.js'));
const lane = require(path.join(ROOT, 'earth-studio-lane.js'));
const planner = require(path.join(ROOT, 'earth-studio-job-planner.js'));

const GATE = path.join(ROOT, 'package-runs/2026-08-20-earth-studio-directorial-evaluation');
const OUT = path.join(GATE, 'projects');
const NOW = '2026-08-20T09:00:00.000Z';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Each case names the DIRECTORIAL QUESTION it exists to answer, the input an
// operator would actually type, what a competent map-animation director should
// do, and what Mikko should watch for. `nl` cases go through parseIntent;
// `intent` cases carry structured stops where the point is policy, not parsing.
const CASES = [
  {
    id: 'DIRN-01-landmark-establish', aspect: '16:9',
    title: 'DIRN-01 — establish Helsinki Cathedral calmly',
    question: 'Does a calm establish request produce a readable opening composition with no unnecessary movement?',
    expected: 'A still or near-still opening on the cathedral at landmark distance. No orbit, no spiral, no travel.',
    watch: ['Is the cathedral framed with visual presence?', 'Is the opening calm and readable?', 'Is any movement actually necessary?'],
    nl: 'Establish Helsinki Cathedral calmly.',
  },
  {
    id: 'DIRN-02-landmark-push-in', aspect: '16:9',
    title: 'DIRN-02 — start wide on Helsinki Cathedral, gently push in',
    question: 'Does an explicit push-in request produce one clean A→B approach, and does the camera actually close distance?',
    expected: 'Wider opening framing, one coherent push toward the landmark: stable heading, no ground-path wobble, sensible deceleration.',
    watch: ['Does the camera genuinely approach (altitude decreases)?', 'Is the move one intention, start to finish?', 'Is the final framing close without crowding?'],
    nl: 'Start wide over Helsinki Cathedral and gently push in toward it.',
  },
  {
    id: 'DIRN-03-landmark-orbit', aspect: '16:9',
    title: 'DIRN-03 — restrained orbit of the Colosseum',
    question: 'Does an explicit orbit request produce a restrained, geometrically clean circle?',
    expected: 'An orbit at the Colosseum: stable target, sensible radius, calm angular rate, no radius breathing.',
    watch: ['Does the Colosseum stay centred through the arc?', 'Is the arc restrained rather than a frantic spin?', 'Does the orbit start and stop without a jerk?'],
    nl: 'Orbit the Colosseum in a restrained cinematic circle.',
  },
  {
    id: 'DIRN-04-orbit-inappropriate-route', aspect: '16:9',
    title: 'DIRN-04 — the Helsinki–Tallinn ferry route (orbit would be wrong)',
    question: 'Does the director refuse orbit when the story is geographic explanation, not celebration?',
    expected: 'Plain holds and one coherent crossing. No orbit at either port — a route story needs legibility, not ceremony.',
    watch: ['Are both ports shown plainly?', 'Is the crossing one clean trajectory?', 'Is there any decorative movement?'],
    intent: { stops: [
      { location: 'Helsinki', role: 'ROUTE_POINT', purposes: ['SHOW_ROUTE'] },
      { location: 'Tallinn', role: 'ROUTE_POINT', purposes: ['SHOW_ROUTE'] }] },
  },
  {
    id: 'DIRN-05-local-point-to-point', aspect: '16:9',
    title: 'DIRN-05 — Helsinki Cathedral to Senate Square (local move)',
    question: 'Does a short local move stay low, direct and coherent — no regional pullback for a two-block journey?',
    expected: 'Low direct travel between the two landmarks. No high transit, no scale detour, stable arrival.',
    watch: ['Does the camera stay at a local altitude?', 'Is departure → travel → arrival readable as one action?', 'Any direction reversals?'],
    nl: 'Go from Helsinki Cathedral to Senate Square.',
  },
  {
    id: 'DIRN-06-city-to-city', aspect: '16:9',
    title: 'DIRN-06 — Helsinki to Tallinn (medium transit)',
    question: 'Does a ~80 km crossing get a proportional transit altitude and duration, with a natural destination approach?',
    expected: 'A shaped or direct crossing appropriate to ~80 km. Arrival framing fits Tallinn; no pointless flourish.',
    watch: ['Is the Gulf of Finland legible during the crossing?', 'Does altitude suit the distance?', 'Does the arrival feel intentional?'],
    nl: 'Travel from Helsinki to Tallinn.',
  },
  {
    id: 'DIRN-07-long-distance', aspect: '16:9',
    title: 'DIRN-07 — Helsinki to Tokyo (intercontinental)',
    question: 'Does a 7,000+ km journey get high-altitude strategy without a gratuitous globe shot or 40-second crossing?',
    expected: 'High transit arc, efficient crossing, deliberate descent into Tokyo. No globe unless justified; duration compressed like a map animation, not proportional to kilometres.',
    watch: ['Is the crossing readable without smearing?', 'Is the duration sane for video use?', 'Does Tokyo arrive as a destination, not just a stop?'],
    nl: 'Fly from Helsinki to Tokyo.',
  },
  {
    id: 'DIRN-08-globe-inappropriate', aspect: '16:9',
    title: 'DIRN-08 — Gothenburg to Oslo (globe view would be ridiculous)',
    question: 'Does the globe-justification gate suppress planetary scale for a ~250 km regional move?',
    expected: 'Regional/city-scale treatment only. No globe shot, no space altitude.',
    watch: ['Is the framing regional at most?', 'Does the move stay comprehensible?', 'Any zoom out to absurd altitude?'],
    nl: 'Move from Gothenburg to Oslo.',
  },
  {
    id: 'DIRN-09-country-scale', aspect: '16:9',
    title: 'DIRN-09 — Finland as a country-scale subject',
    question: 'Does a whole-country subject get country framing — not landmark framing, not continental?',
    expected: 'A calm wide composition containing Finland. Altitude suits a country; no landmark-style close-up.',
    watch: ['Can the viewer take in the whole country?', 'Is the framing calm and readable?', 'Is altitude appropriate to country scale?'],
    nl: 'Show Finland so the viewer can take in the whole country.',
  },
  {
    id: 'DIRN-10-very-small-subject', aspect: '16:9',
    title: 'DIRN-10 — study the Eiffel Tower up close',
    question: 'Does the framing ladder go all the way down for a small landmark without hitting the floor or dwarfing it?',
    expected: 'Close inspection framing at the tower. The subject has visual presence; no absurd distance.',
    watch: ['Does the tower fill enough of the frame to study?', 'Is the camera close but not inside the structure?', 'Is the treatment appropriate to a monument?'],
    nl: 'Inspect the Eiffel Tower up close.',
  },
  {
    id: 'DIRN-11-matched-comparison', aspect: '16:9',
    title: 'DIRN-11 — compare Helsinki and Stockholm (matched framing)',
    question: 'Do explicitly compared cities get visually comparable shots — same scale, same emphasis, comparable duration?',
    expected: 'Matched framing at both cities (compare_match recorded). The two shots feel like one repeated shot grammar.',
    watch: ['Do Helsinki and Stockholm look filmed the same way?', 'Is apparent subject size comparable?', 'Does the sequence read as a comparison, not a travelogue?'],
    nl: 'Compare Helsinki and Stockholm from roughly the same scale.',
  },
  {
    id: 'DIRN-12-unequal-scale-comparison', aspect: '16:9',
    title: 'DIRN-12 — tiny Singapore versus Southeast Asia (scale is the story)',
    question: 'Does the director keep UNEQUAL framing when the size difference itself is the point?',
    expected: 'Singapore close, Southeast Asia wide. compare_match must NOT force matching here.',
    watch: ['Does the pull-back make Singapore feel small?', 'Is the scale difference visible and deliberate?', 'No forced matched framing?'],
    nl: 'Show how tiny Singapore is compared with Southeast Asia.',
  },
  {
    id: 'DIRN-13-multi-destination', aspect: '16:9',
    title: 'DIRN-13 — Helsinki → Stockholm → Copenhagen (three destinations)',
    question: 'Does a multi-stop journey keep continuity without camera resets, and reserve emphasis for what matters?',
    expected: 'Each arrival becomes the next departure state. Middle stop restrained; variation without gratuitous variety.',
    watch: ['Do the legs connect without reset-like jumps?', 'Is Stockholm treated as a waypoint rather than a hero?', 'Does the ending land?'],
    nl: 'Travel from Helsinki to Stockholm, then on to Copenhagen.',
  },
  {
    id: 'DIRN-14-return-conclusion', aspect: '16:9',
    title: 'DIRN-14 — Scandinavia → Helsinki → Stockholm → Scandinavia (return and conclude)',
    question: 'Does the returning wide context feel like a conclusion rather than just another stop?',
    expected: 'Opening orientation, two city beats, then a genuine pull-back to Scandinavia that resolves the story.',
    watch: ['Does the final wide shot feel final?', 'Is the return legible as context restored?', 'Any unnecessary orientation reset before the end?'],
    nl: 'Start wide over Scandinavia, travel to Helsinki, continue to Stockholm, then pull back to end on Scandinavia.',
  },
  {
    id: 'DIRN-15-final-emphasis', aspect: '16:9',
    title: 'DIRN-15 — Copenhagen is the important destination',
    question: 'Does an explicitly named primary destination get more emphasis than the earlier stops?',
    expected: 'Helsinki/Stockholm restrained; Copenhagen gets the arrival emphasis (dwell, flourish, or inspection move).',
    watch: ['Does Copenhagen clearly matter more than the waypoints?', 'Is extra screen time or movement concentrated there?', 'Do the earlier stops stay plain?'],
    nl: 'Travel from Helsinki to Stockholm, then to Copenhagen. Copenhagen is the important destination.',
  },
  {
    id: 'DIRN-16a-continuation-source', aspect: '16:9',
    title: 'DIRN-16a — continuation source: Helsinki to Tallinn',
    question: 'Produces the exact terminal camera state that DIRN-16b must pick up.',
    expected: 'A normal Helsinki→Tallinn journey whose continuation-state.json becomes the next project\'s opening.',
    watch: ['Record the final frame state; it must be DIRN-16b\'s exact starting state.'],
    nl: 'Travel from Helsinki to Tallinn.',
  },
  {
    id: 'DIRN-16b-continuation-target', aspect: '16:9',
    title: 'DIRN-16b — continuation target: pick up and fly gently to Stockholm',
    question: 'Does the continuation begin at the EXACT terminal state — no reset, no approximation, no orbit at the cut?',
    expected: 'Frame 0 identical to DIRN-16a\'s final state. A settle beat at the join, then a gentle leg to Stockholm. Continuation visible in direction.json.',
    watch: ['Is there any snap in position, heading, pitch or altitude at the join?', 'Does the camera settle before moving on?', 'Does direction.json record the exact carried state?'],
    nl: 'Continue seamlessly from the previous animation and fly gently to Stockholm.',
    continuation_from: 'DIRN-16a-continuation-source',
  },
  {
    id: 'DIRN-17-nl-complex-story', aspect: '16:9',
    title: 'DIRN-17 — complex natural-language story (the flagship)',
    question: 'Does one editorial sentence produce a coherent multi-beat plan: orientation, calm travel, inspection, matched comparison, resolved ending?',
    expected: 'Clause attribution, pace "calm" honoured, compare semantics, closing re-mention produces a true conclusion beat.',
    watch: ['Does each clause of the sentence visibly shape a beat?', 'Is the sequence one story, not four unrelated shots?', 'Does it end resolved?'],
    nl: 'Start wide on Scandinavia, travel calmly to Helsinki and inspect it, compare Helsinki with Stockholm, then end by pulling back to show Scandinavia again.',
  },
  {
    id: 'DIRN-18-restraint', aspect: '16:9',
    title: 'DIRN-18 — the restraint test (hold, direct move, hold)',
    question: 'Can the director choose NOT to direct? Explicit holds and a direct move must stay exactly that simple.',
    expected: 'Hold → Direct travel → Hold. No orbit, no spiral, no shaped transit, no orientation change invented.',
    watch: ['Is the opening genuinely still?', 'Is the travel the simplest coherent crossing?', 'Is the ending a clean hold — nothing added?'],
    nl: 'Start over Copenhagen and hold. Then move directly to Berlin and hold again.',
  },
];

function run() {
  if (fs.existsSync(GATE) && fs.readdirSync(GATE).length && !process.argv.includes('--force')) {
    throw new Error(`Refusing to overwrite existing evaluation gate: ${GATE}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const records = [];
  const byId = {};

  for (const c of CASES) {
    // ── parse or take the structured intent ────────────────────────────────
    const parsed = c.nl ? D.parseIntent(c.nl) : null;
    const intent = c.nl
      ? parsed
      : { ...c.intent, aspect: c.aspect };
    // Continuation hand-off: load the source case's exported terminal state.
    if (c.continuation_from) {
      const src = byId[c.continuation_from];
      if (!src) throw new Error(`${c.id}: continuation source ${c.continuation_from} not generated yet`);
      const state = JSON.parse(fs.readFileSync(path.join(ROOT, src.continuation_state), 'utf8'));
      intent.continuation_from = { ...state, source_animation: c.continuation_from };
      if (parsed && parsed.continuation_requested) intent.continuation_requested = true;
    }
    // ── direct ─────────────────────────────────────────────────────────────
    const result = D.autoDirect(intent, { aspect: c.aspect });
    const journey = result.journey;
    // Carry the story intent onto the journey so journey.json records it.
    const stops = result.stops;
    if (journey.start) journey.start.story = { role: stops[0].role, importance: stops[0].importance, purposes: stops[0].purposes };
    journey.legs.forEach((leg, i) => {
      const st = stops[i + 1];
      if (st) leg.destination.story = { role: st.role, importance: st.importance, purposes: st.purposes };
    });
    const normalized = J.normalizeJourney(journey);
    const check = J.validateJourney(normalized);
    if (!check.ok) throw new Error(`${c.id} invalid: ${check.errors.join('; ')}`);

    // ── write through the production lane (same path as the GUI) ──────────
    const pkg = path.join(OUT, c.id);
    fs.mkdirSync(pkg, { recursive: true });
    const direction = {
      case: c.id, title: c.title, question: c.question, expected: c.expected,
      generated_via: 'parseIntent -> autoDirect -> journey model -> lane.writeJob (GUI path)',
      source_text: c.nl || null,
      parsed_intent: parsed ? {
        stops: parsed.stops, globe_justification: parsed.globe_justification,
        continuation_requested: !!parsed.continuation_requested, pace: parsed.pace,
      } : null,
      plan: result.plan,
      audit: D.auditDirection(result),
      decisions: result.decisions.map((d) => ({
        kind: d.kind, place: d.place || null, from: d.from || null, to: d.to || null,
        role: d.role || null, importance: d.importance || null,
        movement: d.decision.key, label: d.decision.label,
        purpose: d.decision.purpose, viewer_should_understand: d.decision.viewer_should_understand,
        why: d.decision.why, rarity: d.decision.rarity, emphasis: d.decision.emphasis,
        angle: d.decision.angle, communicates: d.decision.communicates,
        alternatives: (d.alternatives || []).map((a) => a.label),
        angle_limitation: d.decision.angle_limitation || null,
        continuation: !!d.continuation,
      })),
      globe: result.globe,
      notes: result.notes,
      explanation: D.explainDirection(result),
    };
    const out = lane.writeJob(pkg, { jobName: c.id, journey: normalized, direction }, { now: NOW });

    // ── technical quality evidence ─────────────────────────────────────────
    // The lane already runs the full camera-quality gate on the artifacts it
    // wrote (finite tracks, coherence doctrine, roll, timeline); read that
    // verdict rather than recomputing, so the record matches production.
    const laneDir = path.join(pkg, 'earth-studio');
    const camQuality = JSON.parse(fs.readFileSync(path.join(laneDir, 'camera-quality.json'), 'utf8'));

    const summary = J.summarizeJourney(normalized);
    const record = {
      id: c.id, title: c.title, question: c.question, expected: c.expected,
      aspect: c.aspect, source_text: c.nl || null, structured_intent: !c.nl,
      duration_seconds: out.total_duration_seconds, total_frames: out.total_frames,
      render_dimensions: out.render_dimensions,
      project_dir: path.relative(ROOT, pkg),
      esp: path.relative(ROOT, path.join(laneDir, 'earth-studio.esp')),
      esp_sha256: sha(path.join(laneDir, 'earth-studio.esp')),
      journey_json: path.relative(ROOT, path.join(laneDir, 'journey.json')),
      direction_json: path.relative(ROOT, path.join(laneDir, 'direction.json')),
      continuation_state: fs.existsSync(path.join(laneDir, 'continuation-state.json'))
        ? path.relative(ROOT, path.join(laneDir, 'continuation-state.json')) : null,
      continuation_from: c.continuation_from || null,
      movements: summary.breakdown,
      prose: summary.prose,
      beats: (result.plan.beats || []).map((b) => ({
        purpose: b.purpose, subject: b.subject || b.label || null,
        grammar: b.grammar || b.movement || null, duration_seconds: b.duration_seconds,
      })),
      globe_used: result.globe.allowed,
      globe_reason: result.globe.reason,
      compare_match: result.plan.compare_match || null,
      audit: direction.audit,
      quality_verdict: camQuality.verdict,
      quality_errors: camQuality.errors || [],
      quality_warnings: camQuality.warnings || [],
      watch: c.watch,
    };
    records.push(record);
    byId[c.id] = record;
  }

  // ── canary manifest: feeds the real Earth Studio import gate ─────────────
  // Same shape as the journey-visual-acceptance manifest so the established
  // CDP import harness (--gate <dir> --canary <id>) runs against these cases.
  const manifest = {
    gate: 'earth-studio-directorial-evaluation',
    generated_at: NOW,
    planner_version: 'director-evaluation',
    journey_version: 'director-evaluation',
    motion_profile_version: 'director-evaluation',
    canaries: records.map((r) => ({
      id: r.id,
      title: r.title,
      aspect: r.aspect,
      duration_seconds: r.duration_seconds,
      total_frames: r.total_frames,
      render_dimensions: r.render_dimensions,
      esp: r.esp,
      esp_sha256: r.esp_sha256,
      journey_json: r.journey_json,
      continuation_state: r.continuation_state,
    })),
  };
  fs.writeFileSync(path.join(GATE, 'canary-manifest.json'), JSON.stringify(manifest, null, 2));

  // ── continuation exactness check: 16b frame 0 == 16a final frame ────────
  const src = byId['DIRN-16a-continuation-source'];
  const tgt = byId['DIRN-16b-continuation-target'];
  if (src && tgt) {
    const srcState = JSON.parse(fs.readFileSync(path.join(ROOT, src.continuation_state), 'utf8'));
    const tgtJourney = JSON.parse(fs.readFileSync(path.join(ROOT, tgt.journey_json), 'utf8'));
    const carried = tgtJourney.start && tgtJourney.start.continuation;
    tgt.continuation_exact = !!(carried
      && carried.camera && srcState.camera
      && JSON.stringify(carried.camera) === JSON.stringify(srcState.camera));
  }

  fs.writeFileSync(path.join(GATE, 'generation-manifest.json'), `${JSON.stringify({
    schema_version: 1,
    gate: 'earth-studio DIRECTORIAL evaluation — fresh 18-case set for human visual review',
    generated_at: NOW,
    director_version: D.DIRECTOR_VERSION,
    plan_version: D.PLAN_VERSION,
    journey_version: J.JOURNEY_VERSION,
    planner_version: planner.VERSION,
    method: 'parseIntent -> autoDirect -> journey model -> lane.writeJob (production GUI path)',
    aesthetic_status: 'TECHNICALLY VALID ONLY — HUMAN VISUAL GATE OPEN, awaiting Mikko',
    records,
  }, null, 2)}\n`);

  // ── operator checklist: open → play → judge ──────────────────────────────
  const checklist = `# Directorial evaluation — 18 fresh cases

Generated ${NOW} from the current Earth Studio Director through the production
lane. This is a HUMAN VISUAL REVIEW package: every verdict below is blank until
Mikko watches the animation. Automated gates prove technical validity only.

## How to review

1. \`node scripts/earth-studio-visual-review.js\` (opens the review launcher), or
   import any \`.esp\` below into Google Earth Studio directly.
2. Press Play.
3. Judge against the "watch for" notes.

${records.map((r, i) => `## ${i + 1}. ${r.title}

- Directorial question: ${r.question}
- What a competent director would do: ${r.expected}
- Import this file: \`${r.esp}\`
- Duration: ${r.duration_seconds}s (${r.total_frames} frames, ${r.aspect})
- Direction evidence: \`${r.direction_json}\`
- Watch for:
${r.watch.map((q) => `  - ${q}`).join('\n')}
- PASS / FAIL:
- Notes:
`).join('\n')}`;
  fs.writeFileSync(path.join(GATE, 'operator-checklist.md'), checklist);

  fs.writeFileSync(path.join(GATE, 'README.md'), `# Directorial evaluation gate — 2026-08-20

18 fresh cases generated by the current Earth Studio Director
(parseIntent -> autoDirect -> journey model -> production lane). Deterministic:
regenerating with unchanged code reproduces every \`.esp\` byte-for-byte.

- Projects: ${records.length}
- Manifest: \`generation-manifest.json\` (decisions, beats, quality evidence)
- Operator checklist: \`operator-checklist.md\`
- Import gate: \`node scripts/earth-studio-journey-import-gate.js --gate ${path.relative(ROOT, GATE)} --list\`

Status: **TECHNICALLY VALID — READY FOR HUMAN VISUAL REVIEW.** No aesthetic
verdict exists until Mikko reviews the animations.
`);

  records.forEach((r) => console.log(
    `${r.id.padEnd(38)} ${r.aspect.padEnd(6)} ${String(r.duration_seconds).padStart(6)}s ${String(r.total_frames).padStart(6)}f  ${r.quality_verdict.padEnd(5)} globe=${r.globe_used ? 'YES' : 'no '}  ${r.esp_sha256.slice(0, 12)}`,
  ));
  console.log(`\n${records.length} directorial evaluation cases written to ${path.relative(ROOT, OUT)}`);
  const continuationNote = tgt && tgt.continuation_exact
    ? 'continuation: EXACT state transfer verified (16a terminal == 16b start)'
    : 'continuation: CHECK MANUALLY';
  console.log(continuationNote);
  return records;
}

if (require.main === module) run();
module.exports = { CASES, run };
