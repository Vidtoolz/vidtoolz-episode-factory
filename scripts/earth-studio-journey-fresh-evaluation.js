'use strict';

// Build the fresh visual-review baseline through the same Journey Creator model
// and production lane writer used by /api/earth-studio/plan. This script refuses
// to overwrite an existing baseline, preserving provenance by construction.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const J = require(path.join(ROOT, 'earth-studio-journey.js'));
const lane = require(path.join(ROOT, 'earth-studio-lane.js'));

const OUT = path.join(ROOT, 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2');
const NOW = '2026-08-19T14:00:00.000Z';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const step = (type, duration_seconds, extra) => ({ type, duration_seconds, ...(extra || {}) });
const place = (location, framing) => framing ? { location, framing } : { location };
const travel = (style) => J.TRAVEL_STYLES[style].steps.map((type) => J.newStep(type, 'travel'));
const leg = (destination, style, movements, framing) => ({
  destination: place(destination, framing),
  travel_style: style,
  travel: travel(style),
  movements: movements.map((m) => typeof m === 'string' ? J.newStep(m, 'at') : m),
});

if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !process.argv.includes('--force')) {
  throw new Error(`Refusing to overwrite existing fresh baseline: ${OUT}`);
}
fs.mkdirSync(OUT, { recursive: true });
const records = [];

function emit(spec, journeyRaw) {
  const pkg = path.join(OUT, 'projects', spec.id);
  const journey = J.normalizeJourney({ ...journeyRaw, aspect: spec.aspect });
  const check = J.validateJourney(journey);
  if (!check.ok) throw new Error(`${spec.id} invalid: ${check.errors.join('; ')}`);
  const result = lane.writeJob(pkg, { jobName: spec.title, journey }, { now: NOW });
  const esp = path.join(pkg, 'earth-studio', 'earth-studio.esp');
  const quality = JSON.parse(fs.readFileSync(path.join(pkg, 'earth-studio', 'camera-quality.json'), 'utf8'));
  const record = {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    route: spec.route,
    aspect: spec.aspect,
    duration_seconds: result.total_duration_seconds,
    total_frames: result.total_frames,
    render_dimensions: result.render_dimensions,
    project_dir: path.relative(ROOT, pkg),
    esp: path.relative(ROOT, esp),
    esp_sha256: sha(esp),
    job_id: null,
    generation_job_id: null,
    journey_json: path.relative(ROOT, path.join(pkg, 'earth-studio', 'journey.json')),
    continuation_state: path.relative(ROOT, path.join(pkg, 'earth-studio', 'continuation-state.json')),
    camera_quality: quality,
    continuation_source: spec.continuation_source || null,
    intended_behavior: spec.intended_behavior,
    what_changed: spec.what_changed || 'No camera-math change specific to this shot this pass; it is here as a control.',
    visual_questions: spec.visual_questions,
    generated_via: 'Journey Creator model -> earth-studio-lane.writeJob (production /api/earth-studio/plan path)',
  };
  records.push(record);
  return { record, result, packageDir: pkg };
}

emit({
  id: 'A-local-landmark-to-landmark-16x9',
  title: 'Fresh A — Senate Square to Market Square', category: 'A small-area -> small-area',
  route: 'Senate Square -> Market Square, Helsinki', aspect: '16:9',
  intended_behavior: 'Close, restrained local transition; no unnecessary regional pullback; settle on the destination.',
  visual_questions: ['Does the opening framing fit the square?', 'Is the local move gentle and readable?', 'Does arrival avoid a corrective pan or zoom?'],
}, {
  pace: 'calm', start: place('Senate Square'), start_movements: [step('hold', 4)],
  legs: [{ ...leg('Helsinki Cathedral', 'direct', ['hold']), travel: [step('fly', 8)] }],
});

emit({
  id: 'B-city-to-city-helsinki-stockholm-16x9',
  what_changed: "Unchanged: this move sits inside the corpus evidence range, where the derived easing is authoritative and was deliberately left alone. It is the control proving the easing bound did not disturb short and mid-length moves.",
  title: 'Fresh B — Helsinki to Stockholm', category: 'B city -> city',
  route: 'Helsinki -> Stockholm', aspect: '16:9',
  intended_behavior: 'Calm departure, coherent regional travel, natural destination reveal and short settle.',
  visual_questions: ['Is the route continuous without backtracking?', 'Does altitude rise and descend for the distance?', 'Is Stockholm naturally framed on arrival?'],
}, {
  pace: 'calm', start: place('Helsinki'), start_movements: [step('hold', 4)],
  legs: [{ ...leg('Stockholm', 'cinematic', ['hold']), travel: travel('cinematic').map((s, i) => ({ ...s, duration_seconds: [8, 55, 10][i] })) }],
});

emit({
  id: 'C-region-to-city-finland-helsinki-16x9',
  title: 'Fresh C — Finland to Helsinki', category: 'C country/region -> city',
  route: 'Finland -> Helsinki', aspect: '16:9',
  intended_behavior: 'Start at country context, descend monotonically into a city-scale destination composition.',
  visual_questions: ['Is Finland comfortably framed at the start?', 'Does the scale transition explain the geography?', 'Does Helsinki arrive at an appropriate city distance?'],
}, {
  pace: 'calm', start: place('Finland'), start_movements: [step('hold', 4)],
  legs: [{ ...leg('Helsinki', 'cinematic', ['hold']), travel: travel('cinematic').map((s, i) => ({ ...s, duration_seconds: [8, 34, 12][i] })) }],
});

emit({
  id: 'D-long-distance-helsinki-new-york-orbit-16x9',
  what_changed: "Its destination orbit now gets an explicit ring-acquisition phase, and the keyframe where the orbit hands over to the next move no longer drags the ring out of shape. The long-crossing EASING is unchanged: bounding it was tried and reverted after the repo's calibrated playback model showed the bound made a 105 s crossing worse, not better.",
  title: 'Fresh D — Helsinki to New York with destination orbit', category: 'D long-distance + orbit',
  route: 'Helsinki -> New York -> destination orbit', aspect: '16:9',
  intended_behavior: 'Local context, broad geographic travel, high transit arc, deliberate descent, then one clean partial orbit.',
  visual_questions: ['Does the camera leave local altitude before the long transit?', 'Is the global path stable and free of reversals?', 'Is the New York orbit geometrically clean and intentional?'],
}, {
  pace: 'calm', start: place('Helsinki'), start_movements: [step('hold', 4)],
  legs: [{ ...leg('New York', 'cinematic', ['orbit']), travel: travel('cinematic').map((s, i) => ({ ...s, duration_seconds: [12, 105, 16][i] })), movements: [step('orbit', 8, { revolutions: 0.25 })] }],
});

emit({
  id: 'E-multi-destination-helsinki-stockholm-copenhagen-16x9',
  what_changed: "Unchanged motion. The quality gate used to warn 'altitude direction changes 3 times' on this correct shot; the check is now per-segment, so it is silent.",
  title: 'Fresh E — Helsinki, Stockholm, Copenhagen', category: 'E multi-destination continuity',
  route: 'Helsinki -> Stockholm -> Copenhagen', aspect: '16:9',
  intended_behavior: 'A single designed sequence: each arrival becomes the next departure state without reset-like jumps.',
  visual_questions: ['Does each leg begin from the actual prior state?', 'Do heading, altitude and target remain coherent at Stockholm?', 'Does the final Copenhagen arrival feel earned rather than corrected?'],
}, {
  pace: 'calm', start: place('Helsinki'), start_movements: [step('hold', 4)],
  legs: [
    { ...leg('Stockholm', 'cinematic', ['hold']), travel: travel('cinematic').map((s, i) => ({ ...s, duration_seconds: [7, 42, 9][i] })) },
    { ...leg('Copenhagen', 'cinematic', ['hold']), travel: travel('cinematic').map((s, i) => ({ ...s, duration_seconds: [7, 55, 10][i] })) },
  ],
});

// ── Added cases: the movement grammars the original six did not isolate ──────
// Orbit quality was the largest measured camera defect (radius breathing 3.5%,
// look direction 28 deg off subject, cruise angular velocity swinging 142%), so
// the baseline needs a shot where an orbit is the ONLY thing happening and one
// where it has to be entered from travel. Scale framing needs both ends of the
// ladder in isolation too.

emit({
  id: 'G-standalone-orbit-colosseum-16x9',
  what_changed: "Sweep geometry unchanged from the last pass (radius breathing 0.39%, aim 0.01 deg, steady rate). Kept as the isolated control for the sweep itself.",
  title: 'Fresh G — Colosseum standalone orbit', category: 'G orbit geometry in isolation',
  route: 'Colosseum, Rome — partial orbit only', aspect: '16:9',
  intended_behavior: 'One clean partial orbit. Constant-feeling angular speed, a ring that does not breathe in and out, the subject pinned in frame, tilt and altitude still.',
  visual_questions: [
    'Does the subject stay put in frame, or does it slide sideways mid-orbit?',
    'Does the camera hold its distance, or does it pulse closer and further?',
    'Is the rotation speed even, or does it stutter as it goes round?',
    'Does the orbit ease in and settle, rather than starting and stopping dead?',
  ],
}, {
  // The orbit is the OPENING movement on purpose. A hold in front of it would
  // establish the camera directly above the subject — the centre of the orbit's
  // ring — so the orbit would have to travel outward while already circling.
  // Opening on the orbit lets the generator place the camera on the ring at
  // frame 0, which is what isolates ring geometry for review.
  pace: 'calm', start: place('Colosseum', 'landmark'),
  start_movements: [step('half_orbit', 14)],
  legs: [],
});

emit({
  id: 'H-fly-into-orbit-eiffel-16x9',
  what_changed: "The orbit's pitch change used to have no keyframe at the boundary, so it interpolated from frame 0 and crept upward through the whole approach. It is now confined to the acquisition window, and the sweep holds pitch exactly.",
  title: 'Fresh H — approach the Eiffel Tower and settle into orbit', category: 'H travel -> orbit transition',
  route: 'Paris -> Eiffel Tower -> orbit', aspect: '16:9',
  intended_behavior: 'The approach should land ON the orbit ring and keep going, reading as one continuous camera performance — not travel, stop, reset, orbit.',
  visual_questions: [
    'At the moment the orbit takes over, is there a sideways slide or a visible reset?',
    'Does the tilt tip into the orbit smoothly rather than snapping?',
    'Does it read as one move, or as two moves glued together?',
  ],
}, {
  pace: 'calm', start: place('Paris', 'city'), start_movements: [step('hold', 3)],
  legs: [{ ...leg('Eiffel Tower', 'low_approach', ['hold'], 'landmark'),
    travel: travel('low_approach').map((st) => ({ ...st, duration_seconds: 7 })),
    movements: [step('half_orbit', 10)] }],
});

emit({
  id: 'I-landmark-push-helsinki-cathedral-16x9',
  what_changed: "Unchanged this pass. The push itself was fixed in the previous pass (it used to produce a static shot).",
  title: 'Fresh I — push in on Helsinki Cathedral', category: 'I small-subject framing + push',
  route: 'Helsinki Cathedral — wider architectural view to closer framing', aspect: '16:9',
  intended_behavior: 'Establish the building, then one gentle push that decelerates into an attractive closer framing. No lateral wander, no zoom pumping.',
  visual_questions: [
    'Is the building whole and readable in the opening frame?',
    'Does the push travel straight in, without drifting left or right?',
    'Does it decelerate into the end framing, or arrive and stop abruptly?',
    'Is the closing composition worth holding on?',
  ],
}, {
  pace: 'calm', start: place('Helsinki Cathedral', 'landmark'),
  start_movements: [step('hold', 3), step('zoom_in', 6)],
  legs: [],
});

emit({
  id: 'J-country-scale-finland-16x9',
  title: 'Fresh J — Finland at country scale', category: 'J large-subject framing',
  route: 'Finland — establish and gentle reveal', aspect: '16:9',
  intended_behavior: 'A country must be framed as a country: whole, with useful context, at a distance nothing like a landmark distance.',
  visual_questions: [
    'Is the whole country in frame, without huge dead space around it?',
    'Is the reveal calm and legible at this scale?',
    'Does the pull-out stay controlled instead of tipping toward the horizon?',
  ],
}, {
  pace: 'calm', start: place('Finland', 'country'),
  start_movements: [step('hold', 4), step('zoom_out', 7)],
  legs: [],
});

emit({
  id: 'K-hover-into-orbit-colosseum-16x9',
  what_changed: "NEW SHOT, and the headline fix. A hold frames its subject from directly above, i.e. the CENTRE of the orbit ring. Previously the orbit started sweeping immediately and travelled 1,228 m outward while already circling (103% radius breathing, 60 deg of pitch swing, subject lost). The orbit now has an explicit bounded ring-acquisition phase before the sweep.",
  title: 'Fresh K — hold the Colosseum, then orbit it', category: 'K orbit ring acquisition',
  route: 'Colosseum — establish top-down, then orbit', aspect: '16:9',
  intended_behavior: 'A hold frames the subject from directly above, which is the CENTRE of the orbit ring, not a point on it. The camera should visibly and deliberately move out onto the ring and tip into the orbit pitch FIRST, then circle at a steady rate — one continuous performance, not a slide.',
  visual_questions: [
    'Does the camera deliberately move out onto the orbit circle before it starts circling?',
    'Does the subject stay in frame the whole way out, or does it swing away?',
    'Is the tip from looking-down to the orbit angle smooth, or is there a snap?',
    'Once circling, does it hold its distance and its angle?',
    'Does the whole thing read as one intentional move, or as a correction?',
  ],
}, {
  pace: 'calm', start: place('Colosseum', 'landmark'),
  start_movements: [step('hold', 3), step('half_orbit', 14)],
  legs: [],
});

emit({
  id: 'L-globe-pullback-finland-16x9',
  what_changed: "NEW SHOT. A very large monotonic altitude change, here to check the climb accelerates once and settles once rather than stuttering.",
  title: 'Fresh L — pull back from Finland to the globe', category: 'L large-scale pull back',
  route: 'Finland — country framing out to whole-globe framing', aspect: '16:9',
  intended_behavior: 'A very large monotonic altitude change. It should accelerate once, hold a steady climb, and settle — never lurch, stall, or pulse on the way out.',
  visual_questions: [
    'Does the pull-back climb at an even rate, or does it stutter on the way out?',
    'Is the globe sensibly framed at the end, without huge dead space?',
    'Does it settle rather than stopping dead?',
    'Does anything about the scale change feel abrupt?',
  ],
}, {
  pace: 'calm', start: place('Finland', 'country'),
  start_movements: [step('hold', 3), { ...step('zoom_out', 11), framing: 'globe' }],
  legs: [],
});

emit({
  id: 'M-long-crossing-control-16x9',
  title: 'Fresh M — Helsinki to New York, isolated long crossing', category: 'M long-travel easing control',
  route: 'Helsinki -> New York (no destination orbit)', aspect: '16:9',
  what_changed: "NEW SHOT, and it is a CONTROL, not a fix. It isolates long-travel easing with nothing else moving so the velocity profile can be read from a real Earth Studio import. The easing itself is UNCHANGED this pass: bounding it was tried and reverted because the repo's calibrated playback model showed the bound made a 105 s crossing worse. This shot exists to settle that question with real evidence rather than a model.",
  intended_behavior: 'One long, calm crossing: depart, establish a travel speed, hold it for a meaningful stretch, then arrive gently. It should not feel as if it accelerates almost to the midpoint and then immediately begins slowing down.',
  visual_questions: [
    'Does it settle into a travel speed you can read, or does it feel like it is still accelerating most of the way?',
    'Is the departure calm rather than a launch?',
    'Is the arrival gentle rather than a stop?',
    'Does the ground stay legible at cruise, or does it smear past?',
    'Would you cut this into a video as-is?',
  ],
}, {
  pace: 'calm', start: place('Helsinki', 'city'), start_movements: [step('hold', 3)],
  legs: [{ ...leg('New York', 'cinematic', ['hold'], 'city'),
    travel: travel('cinematic').map((s, i) => ({ ...s, duration_seconds: [10, 105, 14][i] })),
    movements: [step('hold', 4)] }],
});

const f1 = emit({
  id: 'F1-continuation-source-helsinki-stockholm-16x9',
  title: 'Fresh F1 — continuation source Helsinki to Stockholm', category: 'F continuation source',
  route: 'Helsinki -> Stockholm (source)', aspect: '16:9',
  intended_behavior: 'Produce the authoritative final camera state used by Fresh F2.',
  visual_questions: ['Record the final frame state; it must be the exact starting state of F2.'],
}, {
  pace: 'calm', start: place('Helsinki'), start_movements: [step('hold', 4)],
  legs: [{ ...leg('Stockholm', 'cinematic', ['hold']), travel: travel('cinematic').map((s, i) => ({ ...s, duration_seconds: [8, 52, 12][i] })) }],
});
const sourceState = JSON.parse(fs.readFileSync(path.join(f1.packageDir, 'earth-studio', 'continuation-state.json'), 'utf8'));
const f2Journey = J.journeyFromContinuationState(sourceState, { destination: 'Copenhagen', aspect: '16:9', pace: 'calm' });
emit({
  id: 'F2-continuation-target-stockholm-copenhagen-16x9',
  title: 'Fresh F2 — continuation target Stockholm to Copenhagen', category: 'F continuation target',
  route: 'F1 final state -> Copenhagen', aspect: '16:9', continuation_source: 'F1-continuation-source-helsinki-stockholm-16x9',
  intended_behavior: 'Begin exactly at F1 final camera state, hold briefly, then continue to Copenhagen.',
  visual_questions: ['Is frame 0 identical to F1 final frame?', 'Is there any heading, altitude, pitch or target snap?', 'Does the continuation remain calm through arrival?'],
}, f2Journey);

const legacy = `# Legacy Earth Studio evaluation samples — preserved, superseded\n\nThese packages remain on disk for provenance and rollback, but are not the active visual-quality baseline. The active baseline is this package's fresh current-creator set. No old project was deleted or repaired for the new verdict.\n\n- \`package-runs/2026-06-27-london-proof/\` — pre-v0.4 sample.\n- \`package-runs/2026-08-07-earth-studio-v04-acceptance/\` — earlier acceptance package.\n- \`package-runs/2026-08-12-earth-studio-antimeridian-real-import-v094/\` — focused historical import evidence.\n- \`package-runs/2026-08-12-earth-studio-hover-real-import-v094/\` — focused historical import evidence.\n- \`package-runs/2026-08-12-earth-studio-space-zoom-v094-candidate/\` — historical candidate.\n- \`package-runs/2026-08-19-earth-studio-journey-visual-acceptance/\` — prior journey canaries; superseded by v2.\n- \`package-runs/2026-08-19-earth-studio-director-acceptance/\` — prior director canaries; not evidence for this Journey Creator baseline.\n`;
fs.writeFileSync(path.join(OUT, 'legacy-samples-retirement.md'), legacy);

const checklist = `# Fresh Earth Studio Journey visual acceptance\n\nGenerated ${NOW}. This is a human visual review package, not an automated aesthetic verdict.\n\n## Manual steps\n\n1. Open Google Earth Studio.\n2. Import each listed \`.esp\` using drag-and-drop or **Import .esp file**.\n3. Play the animation and inspect the questions below.\n4. Fill in PASS/FAIL and notes.\n5. If rendering is required, export the frames ZIP, extract image files directly into that project's \`frames/\` directory with no nested folder, then use the normal VIDTOOLZ workflow.\n\nAuthority for the import/render workflow: \`docs/earth-studio-user-guide.md\`.\n\n## Start here — highest-information order\n\n1. **LONG-TRAVEL A/B/C** — \`../2026-08-20-earth-studio-cruise-calibration/RESULTS.md\`. Three versions of one 105 s crossing, all three real-import verified. This is the main Stage 1 decision open right now, and the easing stays as it is until you pick.\n2. **A/B: hold then orbit** — \`ab-hold-then-orbit/README.md\`. Play A then B. Both are real-import verified; the question is which reads as professional camera work.\n3. **K** — the staged hold→orbit on its own.\n4. **G** — standalone orbit, the control for the sweep itself.\n5. **M** — isolated 105 s crossing. Its measured real-Earth-Studio velocity profile is in \`observations/M-long-crossing-velocity-profile.md\`; the easing is UNCHANGED this pass and that document explains why.\n6. **H** — fly into orbit, where the hold cannot be pre-staged.\n7. **F1 then F2** — continuation, regression control only.\n\nEverything else is a control. Automated reports in each project are technical gates; they do not claim the shot looks good.\n\n${records.map((r, i) => `## ${i + 1}. ${r.title}\n\n- Project: \`${r.project_dir}\`\n- Route: ${r.route}\n- Category: ${r.category}\n- Duration: ${r.duration_seconds}s (${r.total_frames} frames)\n- Import this file: \`${r.esp}\`\n- WHAT CHANGED this pass: ${r.what_changed}\n- Intended behavior: ${r.intended_behavior}\n- Visual questions:\n${r.visual_questions.map((q) => `  - ${q}`).join('\n')}\n- PASS / FAIL: \n- Notes: \n`).join('\n')}`;
fs.writeFileSync(path.join(OUT, 'operator-checklist.md'), checklist);
fs.writeFileSync(path.join(OUT, 'README.md'), `# Fresh current-creator evaluation set v2\n\nCreated from blank journey definitions on ${NOW} using the current Journey Creator model and production lane. The set covers local, city, regional, long-distance, multi-destination and exact continuation behavior, plus isolated orbit geometry, a travel-into-orbit transition, a landmark push, and country-scale framing. Automated reports are technical gates only; Mikko's visual judgment remains blank in the checklist.\n\n- Projects: ${records.length}\n- Source: current \`earth-studio-journey.js\` + \`earth-studio-lane.js\`\n- Checklist: \`operator-checklist.md\`\n- Legacy inventory: \`legacy-samples-retirement.md\`\n`);
fs.writeFileSync(path.join(OUT, 'generation-manifest.json'), `${JSON.stringify({ schema_version: 1, generated_at: NOW, method: 'Journey Creator model -> production lane writeJob', records }, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, 'canary-manifest.json'), `${JSON.stringify({
  gate: 'fresh Earth Studio Journey Creator visual review — real import observation',
  generated_at: NOW,
  planner_version: '0.9.4',
  journey_version: 1,
  motion_profile_version: 4,
  canaries: records,
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, output: path.relative(ROOT, OUT), projects: records.map((r) => ({ id: r.id, duration_seconds: r.duration_seconds, esp: r.esp, quality: r.camera_quality.verdict })) }, null, 2));
