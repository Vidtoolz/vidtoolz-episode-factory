'use strict';

const { test, tests, assert, fs, os, path, childProcess } = require('./_helpers.js');
const engine = require('../scripts/production-assembly-composition.js');

function clone(value) { return structuredClone(value); }
function textLayer(id, z, primary, content, y) {
  return {
    layer_id: id, type: 'TYPOGRAPHY', primary, z,
    typography: {
      content, content_sha256: engine.digest(content), preset: 'HEADLINE',
      region: { x: 20, y, width: 280, height: 70, anchor: 'TOP_LEFT', bleed: [], edge_treatment: { type: 'NONE' } },
      alignment: 'CENTER', safe_margin_px: 10, render_mode: 'DRAW_TEXT',
    },
  };
}
function reveal(order, startMs, endMs = 1000) {
  return { mode: 'ADDITIVE_PERSIST', order, start_ms: startMs, end_ms: endMs, licensing_anchor_id: `anchor-${order}`, licensing_phrase_onset_ms: startMs };
}
function fixture() {
  const first = { ...textLayer('stage-a', 1, true, 'AAAA', 10), reveal: reveal(1, 200) };
  const second = { ...textLayer('stage-b', 2, false, 'BBBB', 100), reveal: reveal(2, 550) };
  const beat = {
    beat_id: 'beat-reveal', section_id: 'S01', start_ms: 0, end_ms: 1000,
    primary_owner: 'TYPOGRAPHY', transition_in: 'CUT', transition_out: 'CUT',
    reveal_contract: { mode: 'ADDITIVE_PERSIST', unrevealed_state: 'ABSENT', required_layer_ids: ['stage-a', 'stage-b'] },
    layers: [first, second],
  };
  return {
    model: {
      schema: engine.SCHEMA,
      design_package: { path: '/design.json', sha256: 'a'.repeat(64), schema: 'design.v1' },
      approved_visual_plan: { path: '/plan.json', file_sha256: 'b'.repeat(64), plan_id: 'plan', digest_sha256: 'c'.repeat(64) },
      asset_manifest: { path: '/assets.json', sha256: 'd'.repeat(64) },
      coverage: 'FULL_PROGRAMME', expected_beat_count: 1, forbidden_asset_ids: [], beats: [beat],
    },
    timeline: [{ section_id: 'S01', in_ms: 0, out_ms: 1000, programme_in_ms: 0, programme_out_ms: 1000, script_beat_ids: ['beat-reveal'] }],
    output: { width: 320, height: 180, fps: 30 },
    manifest: { schema: engine.ASSET_MANIFEST_SCHEMA, run_id: 'reveal-test', assets: [] },
  };
}
function validate(f = fixture()) { return engine.validateComposition(f.model, f.timeline, f.output, f.manifest); }
function code(fn, expected) { assert.throws(fn, (error) => error.code === expected, `expected ${expected}`); }
function oneReveal(f = fixture()) {
  f.model.beats[0].layers.pop();
  f.model.beats[0].reveal_contract.required_layer_ids = ['stage-a'];
  return f;
}

test('REVEAL-01 composition without reveal retains whole-beat static behavior', () => {
  const f = oneReveal(); delete f.model.beats[0].reveal_contract; delete f.model.beats[0].layers[0].reveal;
  const result = validate(f); assert.equal(result.beats[0].reveal_plan, undefined); assert.equal(engine.layerVisibleAt(result.beats[0].layers[0], 0), true);
});
test('REVEAL-02 one valid additive reveal compiles', () => { const beat = validate(oneReveal()).beats[0]; assert.equal(beat.reveal_plan.events.length, 1); });
test('REVEAL-03 multiple additive reveals accumulate', () => { const plan = validate().beats[0].reveal_plan; assert.deepEqual(plan.events[1].visible_layer_ids_after, ['stage-a', 'stage-b']); });
test('REVEAL-04 seven-layer S04-style reveal compiles seven ordered states', () => {
  const f = fixture(); f.output.height = 300; const layers = [];
  for (let index = 0; index < 7; index += 1) layers.push({ ...textLayer(`stage-${index + 1}`, index + 1, index === 0, `STAGE ${index + 1}`, index * 20), reveal: reveal(index + 1, 100 + index * 100) });
  f.model.beats[0].layers = layers; f.model.beats[0].reveal_contract.required_layer_ids = layers.map((layer) => layer.layer_id);
  const plan = validate(f).beats[0].reveal_plan; assert.equal(plan.events.length, 7); assert.deepEqual(plan.final_visible_layer_ids, layers.map((layer) => layer.layer_id));
});
test('REVEAL-05 reveal at beat start maps to frame zero', () => { const f = oneReveal(); f.model.beats[0].layers[0].reveal.start_ms = 0; f.model.beats[0].layers[0].reveal.licensing_phrase_onset_ms = 0; assert.equal(validate(f).beats[0].reveal_plan.events[0].first_visible_frame, 0); });
test('REVEAL-06 reveal at exclusive beat end is illegal', () => { const f = oneReveal(); f.model.beats[0].layers[0].reveal.start_ms = 1000; f.model.beats[0].layers[0].reveal.licensing_phrase_onset_ms = 1000; code(() => validate(f), 'COMPOSITION_REVEAL_INTERVAL_INVALID'); });
test('REVEAL-07 reveal before beat start rejects', () => { const f = oneReveal(); f.model.beats[0].layers[0].reveal.start_ms = -1; f.model.beats[0].layers[0].reveal.licensing_phrase_onset_ms = -1; code(() => validate(f), 'COMPOSITION_REVEAL_INTERVAL_INVALID'); });
test('REVEAL-08 reveal after beat end rejects', () => { const f = oneReveal(); f.model.beats[0].layers[0].reveal.end_ms = 1001; code(() => validate(f), 'COMPOSITION_REVEAL_INTERVAL_INVALID'); });
test('REVEAL-09 non-monotonic reveal timing rejects', () => { const f = fixture(); f.model.beats[0].layers[1].reveal.start_ms = 100; f.model.beats[0].layers[1].reveal.licensing_phrase_onset_ms = 100; code(() => validate(f), 'COMPOSITION_REVEAL_SEQUENCE_INVALID'); });
test('REVEAL-10 duplicate reveal order rejects', () => { const f = fixture(); f.model.beats[0].layers[1].reveal.order = 1; code(() => validate(f), 'COMPOSITION_REVEAL_SEQUENCE_INVALID'); });
test('REVEAL-11 unknown required layer rejects', () => { const f = fixture(); f.model.beats[0].reveal_contract.required_layer_ids[1] = 'fabricated'; code(() => validate(f), 'COMPOSITION_REVEAL_LAYER_UNKNOWN'); });
test('REVEAL-12 duplicate layer identity rejects', () => { const f = fixture(); f.model.beats[0].layers[1].layer_id = 'stage-a'; code(() => validate(f), 'COMPOSITION_LAYER_INVALID'); });
test('REVEAL-13 missing required layer reveal rejects', () => { const f = fixture(); delete f.model.beats[0].layers[1].reveal; code(() => validate(f), 'COMPOSITION_REVEAL_REPRESENTATION_INCOMPLETE'); });
test('REVEAL-14 required final membership is satisfied exactly', () => { const plan = validate().beats[0].reveal_plan; assert.deepEqual(plan.final_visible_layer_ids, ['stage-a', 'stage-b']); });
test('REVEAL-15 required final membership cannot end before beat end', () => { const f = fixture(); f.model.beats[0].layers[1].reveal.end_ms = 999; code(() => validate(f), 'COMPOSITION_REVEAL_PERSISTENCE_INVALID'); });
test('REVEAL-16 malformed reveal contract rejects', () => { const f = fixture(); f.model.beats[0].reveal_contract.unrevealed_state = 'VISIBLE'; code(() => validate(f), 'COMPOSITION_REVEAL_CONTRACT_INVALID'); });
test('REVEAL-17 unknown persistence mode rejects', () => { const f = fixture(); f.model.beats[0].reveal_contract.mode = 'MOMENTARY'; code(() => validate(f), 'COMPOSITION_REVEAL_CONTRACT_INVALID'); });
test('REVEAL-18 beat and layer reveal modes must match', () => { const f = fixture(); f.model.beats[0].layers[0].reveal.mode = 'MOMENTARY'; code(() => validate(f), 'COMPOSITION_REVEAL_MODE_INVALID'); });
test('REVEAL-19 identical input compiles an identical semantic plan and digest', () => { const a = validate().beats[0].reveal_plan; const b = validate(clone(fixture())).beats[0].reveal_plan; assert.deepEqual(a, b); assert.match(a.reveal_plan_digest_sha256, /^[a-f0-9]{64}$/); });
test('REVEAL-20 integer-ms to frame mapping is deterministic', () => { const plan = validate().beats[0].reveal_plan; assert.deepEqual(plan.events.map((event) => event.first_visible_frame), [6, 17]); assert.equal(engine.frameIndexAtOrAfterMs(550, 30), 17); });
test('REVEAL-21 static graph receives no reveal enable expression', () => { const f = oneReveal(); delete f.model.beats[0].reveal_contract; delete f.model.beats[0].layers[0].reveal; const command = []; const filters = []; engine.buildVideoGraph({ composition: validate(f), timeline: f.timeline, music: { policy: 'NONE' }, output: f.output }, command, filters); assert.equal(filters.some((entry) => entry.includes(':enable=')), false); });
test('REVEAL-22 unknown reveal field remains rejected', () => { const f = fixture(); f.model.beats[0].layers[0].reveal.ffmpeg = '1'; code(() => validate(f), 'COMPOSITION_UNKNOWN_FIELD'); });
test('REVEAL-23 caller cannot fabricate required membership', () => { const f = fixture(); f.model.beats[0].reveal_contract.required_layer_ids.push('outsider'); code(() => validate(f), 'COMPOSITION_REVEAL_LAYER_UNKNOWN'); });
test('REVEAL-24 validation does not mutate the immutable input composition', () => { const f = fixture(); const before = engine.canonicalize(f.model); validate(f); assert.equal(engine.canonicalize(f.model), before); });
test('REVEAL-25 same-frame distinct events reject because their states are not renderable separately', () => { const f = fixture(); f.model.beats[0].layers[0].reveal.start_ms = 201; f.model.beats[0].layers[0].reveal.licensing_phrase_onset_ms = 201; f.model.beats[0].layers[1].reveal.start_ms = 202; f.model.beats[0].layers[1].reveal.licensing_phrase_onset_ms = 202; code(() => validate(f), 'COMPOSITION_REVEAL_FRAME_COLLISION'); });
test('REVEAL-26 reveal cannot precede its licensing phrase onset', () => { const f = oneReveal(); f.model.beats[0].layers[0].reveal.licensing_phrase_onset_ms = 201; code(() => validate(f), 'COMPOSITION_REVEAL_BEFORE_LICENSE'); });
test('REVEAL-27 layer reveal without beat contract rejects', () => { const f = oneReveal(); delete f.model.beats[0].reveal_contract; code(() => validate(f), 'COMPOSITION_REVEAL_CONTRACT_REQUIRED'); });
test('REVEAL-28 duplicate licensing anchor rejects', () => { const f = fixture(); f.model.beats[0].layers[1].reveal.licensing_anchor_id = 'anchor-1'; code(() => validate(f), 'COMPOSITION_REVEAL_IDENTITY_INVALID'); });
test('REVEAL-29 frame-level render proves absence, exact onset, and additive persistence', () => {
  if (childProcess.spawnSync('ffmpeg', ['-version']).status !== 0) return;
  const f = fixture(); const validated = validate(f); const command = []; const filters = [];
  engine.buildVideoGraph({ composition: validated, timeline: f.timeline, music: { policy: 'NONE' }, output: f.output }, command, filters);
  assert.ok(filters.some((entry) => entry.includes("enable='gte(n,6)*lt(n,30)'")));
  assert.ok(filters.some((entry) => entry.includes("enable='gte(n,17)*lt(n,30)'")));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v4-reveal-frame-proof-')); const output = path.join(root, 'proof.mp4');
  childProcess.execFileSync('ffmpeg', ['-v', 'error', '-y', '-filter_complex', filters.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '1', '-pix_fmt', 'yuv420p', '-r', '30', output]);
  const raw = childProcess.execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 8 * 1024 * 1024 });
  const frameSize = f.output.width * f.output.height; const frames = raw.length / frameSize; assert.equal(frames, 30);
  function lit(frame, y0, y1) { let count = 0; const base = frame * frameSize; for (let y = y0; y < y1; y += 1) for (let x = 0; x < f.output.width; x += 1) if (raw[base + y * f.output.width + x] > 100) count += 1; return count; }
  assert.equal(lit(5, 10, 80), 0); assert.ok(lit(6, 10, 80) > 0); assert.ok(lit(29, 10, 80) > 0);
  assert.equal(lit(16, 100, 170), 0); assert.ok(lit(17, 100, 170) > 0); assert.ok(lit(29, 100, 170) > 0);
});

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; process.stdout.write(`ok - ${item.name}\n`); }
      catch (error) { process.stderr.write(`not ok - ${item.name}\n${error.stack || error}\n`); process.exitCode = 1; break; }
    }
    if (!process.exitCode) process.stdout.write(`${passed}/${tests.length} tests passed\n`);
  })();
}
