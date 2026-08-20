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

const checklist = `# Fresh Earth Studio Journey visual acceptance\n\nGenerated ${NOW}. This is a human visual review package, not an automated aesthetic verdict.\n\n## Manual steps\n\n1. Open Google Earth Studio.\n2. Import each listed \`.esp\` using drag-and-drop or **Import .esp file**.\n3. Play the animation and inspect the questions below.\n4. Fill in PASS/FAIL and notes.\n5. If rendering is required, export the frames ZIP, extract image files directly into that project's \`frames/\` directory with no nested folder, then use the normal VIDTOOLZ workflow.\n\nAuthority for the import/render workflow: \`docs/earth-studio-user-guide.md\`.\n\n${records.map((r, i) => `## ${i + 1}. ${r.title}\n\n- Project: \`${r.project_dir}\`\n- Route: ${r.route}\n- Category: ${r.category}\n- Duration: ${r.duration_seconds}s (${r.total_frames} frames)\n- Import this file: \`${r.esp}\`\n- Intended behavior: ${r.intended_behavior}\n- Visual questions:\n${r.visual_questions.map((q) => `  - ${q}`).join('\\n')}\n- PASS / FAIL: \n- Notes: \n`).join('\\n')}`;
fs.writeFileSync(path.join(OUT, 'operator-checklist.md'), checklist);
fs.writeFileSync(path.join(OUT, 'README.md'), `# Fresh current-creator evaluation set v2\n\nCreated from blank journey definitions on ${NOW} using the current Journey Creator model and production lane. Seven projects cover local, city, regional, long-distance/orbit, multi-destination, and exact continuation behavior. Automated reports are technical gates only; Mikko's visual judgment remains blank in the checklist.\n\n- Projects: ${records.length}\n- Source: current \`earth-studio-journey.js\` + \`earth-studio-lane.js\`\n- Checklist: \`operator-checklist.md\`\n- Legacy inventory: \`legacy-samples-retirement.md\`\n`);
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
