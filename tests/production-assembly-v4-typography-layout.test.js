'use strict';

const { test, tests, assert } = require('./_helpers.js');
const typography = require('../scripts/canonical-typography-layout.js');
const engine = require('../scripts/production-assembly-composition.js');

function geometry(x = 80, y = 320, width = 920, height = 600) {
  return { x, y, width, height, anchor: 'CENTER', bleed: [], edge_treatment: { type: 'NONE' } };
}
function controls(overrides = {}) {
  return { max_font_size: 70, min_font_size: 24, max_lines: 6, line_spacing_px: 8, ...overrides };
}
function type(content = 'CANONICAL TYPOGRAPHY', overrides = {}) {
  const value = {
    content,
    content_sha256: engine.digest(content),
    preset: 'HEADLINE',
    region: geometry(),
    alignment: 'CENTER',
    safe_margin_px: 48,
    render_mode: 'DRAW_TEXT',
    layout: controls(),
    ...overrides,
  };
  if (overrides.content !== undefined && overrides.content_sha256 === undefined) value.content_sha256 = engine.digest(overrides.content);
  return value;
}
function layer(id = 'type', z = 1, primary = true, content = 'CANONICAL TYPOGRAPHY', typographyOverrides = {}) {
  return { layer_id: id, type: 'TYPOGRAPHY', primary, z, typography: type(content, typographyOverrides) };
}
function fixture(layers = [layer()]) {
  const beat = { beat_id: 'beat-type', section_id: 'S01', start_ms: 0, end_ms: 1000, primary_owner: 'TYPOGRAPHY', transition_in: 'CUT', transition_out: 'CUT', layers };
  return {
    model: { schema: engine.SCHEMA, design_package: { path: '/design.json', sha256: 'a'.repeat(64), schema: 'design.v1' }, approved_visual_plan: { path: '/plan.json', file_sha256: 'b'.repeat(64), plan_id: 'plan', digest_sha256: 'c'.repeat(64) }, asset_manifest: { path: '/assets.json', sha256: 'd'.repeat(64) }, coverage: 'FULL_PROGRAMME', expected_beat_count: 1, forbidden_asset_ids: [], beats: [beat] },
    timeline: [{ section_id: 'S01', in_ms: 0, out_ms: 1000, programme_in_ms: 0, programme_out_ms: 1000, script_beat_ids: ['beat-type'] }],
    output: { width: 1080, height: 1920, fps: 30 },
    manifest: { schema: engine.ASSET_MANIFEST_SCHEMA, run_id: 'v4-type-test', assets: [] },
  };
}
function validate(f = fixture()) { return engine.validateComposition(f.model, f.timeline, f.output, f.manifest); }
function fit(content, layout = controls(), region = geometry(), extra = {}) {
  return typography.layoutTypography({ content, region, alignment: 'CENTER', safe_margin_px: 48, layout, ...extra });
}
function error(fn, code) { assert.throws(fn, (caught) => caught.code === code, `expected ${code}`); }
function inside(inner, outer) {
  assert.ok(inner.x >= outer.x && inner.y >= outer.y);
  assert.ok(inner.x + inner.width <= outer.x + outer.width);
  assert.ok(inner.y + inner.height <= outer.y + outer.height);
}

test('V4TYPE-01 typography without layout retains legacy non-V2 renderer behavior', () => {
  const f = fixture(); delete f.model.beats[0].layers[0].typography.layout;
  const result = validate(f); assert.equal(result.beats[0].layers[0].typography_layout, undefined);
  const command = []; const filters = []; engine.buildVideoGraph({ composition: result, timeline: f.timeline, music: { policy: 'NONE' }, output: f.output }, command, filters);
  const draw = filters.find((item) => item.includes('drawtext=')); assert.match(draw, /fontsize=128/); assert.ok(!draw.includes('line_spacing='));
});
test('V4TYPE-02 valid V4 layout is executed by the canonical fitter', () => { const result = validate().beats[0].layers[0].typography_layout; assert.equal(result.v4_layout_contract.max_font_size, 70); assert.ok(result.font_size_px <= 70); });
test('V4TYPE-03 selected size never exceeds max_font_size', () => { assert.equal(fit('MAXIMUM', controls({ max_font_size: 60 })).font_size_px, 60); });
test('V4TYPE-04 selected size never falls below min_font_size', () => { const result = fit('A bounded sentence that wraps legally.', controls({ min_font_size: 48 })); assert.ok(result.font_size_px >= 48); });
test('V4TYPE-05 equal min and max select that exact size', () => { assert.equal(fit('EXACT', controls({ min_font_size: 52, max_font_size: 52 })).font_size_px, 52); });
test('V4TYPE-06 min greater than max is rejected', () => { error(() => fit('BAD', controls({ min_font_size: 71, max_font_size: 70 })), 'COMPOSITION_TYPOGRAPHY_LAYOUT_RANGE_INVALID'); });
test('V4TYPE-07 max_lines is enforced after wrapping', () => { const result = fit('one two three four five six seven eight', controls({ max_lines: 3 }), geometry(80, 320, 420, 600)); assert.ok(result.line_count <= 3); });
test('V4TYPE-08 content exceeding max_lines at the floor rejects', () => { error(() => fit('W'.repeat(180), controls({ max_font_size: 24, min_font_size: 24, max_lines: 1 }), geometry(80, 320, 420, 600)), 'COMPOSITION_TYPOGRAPHY_MAX_LINES_EXCEEDED'); });
test('V4TYPE-09 a one-line maximum remains one line', () => { assert.equal(fit('ONE LINE', controls({ max_lines: 1 })).line_count, 1); });
test('V4TYPE-10 explicit newlines count against max_lines', () => { error(() => fit('ONE\nTWO', controls({ max_lines: 1 })), 'COMPOSITION_TYPOGRAPHY_MAX_LINES_EXCEEDED'); });
test('V4TYPE-11 emergency grapheme wrapping also obeys max_lines', () => { const result = fit('ABCDEFGHIJKLMN'.repeat(4), controls({ max_lines: 4 }), geometry(80, 320, 500, 600)); assert.ok(result.line_count <= 4); assert.equal(result.lines.join(''), 'ABCDEFGHIJKLMN'.repeat(4)); });
test('V4TYPE-12 positive line spacing is bound to layout output', () => { assert.equal(fit('ONE\nTWO', controls({ line_spacing_px: 18 })).line_spacing_px, 18); });
test('V4TYPE-13 zero line spacing is preserved exactly', () => { assert.equal(fit('ONE\nTWO', controls({ line_spacing_px: 0 })).line_spacing_px, 0); });
test('V4TYPE-14 negative line spacing rejects', () => { error(() => fit('BAD', controls({ line_spacing_px: -1 })), 'COMPOSITION_TYPOGRAPHY_LINE_SPACING_INVALID'); });
test('V4TYPE-15 large line spacing that exceeds height fails closed', () => { error(() => fit('ONE\nTWO', controls({ max_font_size: 24, min_font_size: 24, line_spacing_px: 200 }), geometry(80, 320, 600, 100)), 'COMPOSITION_TYPOGRAPHY_OVERFLOW'); });
test('V4TYPE-16 the original 120-character hostile string remains fail closed', () => { error(() => typography.layoutTypography({ content: 'W'.repeat(120), region: geometry(128, 620, 824, 150), alignment: 'CENTER', safe_margin_px: 24, backing: { color: 'GREY', opacity: 0.56 } }), 'COMPOSITION_TYPOGRAPHY_OVERFLOW'); });
test('V4TYPE-17 repeated wide W glyphs remain inside the declared region', () => { const result = fit('W'.repeat(80), controls({ max_lines: 6 }), geometry(80, 320, 920, 900)); inside(result.glyph_bounds, result.region); });
test('V4TYPE-18 repeated narrow i glyphs remain inside the declared region', () => { const result = fit('i'.repeat(160)); inside(result.glyph_bounds, result.region); });
test('V4TYPE-19 supported Unicode is measured by the canonical font path', () => { const result = fit('Café — Γειά — Привет'); inside(result.glyph_bounds, result.region); });
test('V4TYPE-20 punctuation-heavy text remains bounded', () => { const result = fit(`Wait—what?! [yes/no]; {alpha:beta}; 100% 'quoted'...`); inside(result.glyph_bounds, result.region); });
test('V4TYPE-21 impossible content at the legal minimum rejects', () => { error(() => fit('W'.repeat(600), controls({ max_font_size: 24, min_font_size: 24 }), geometry(80, 320, 300, 100)), 'COMPOSITION_TYPOGRAPHY_MAX_LINES_EXCEEDED'); });
test('V4TYPE-22 exact fixed-size layout can fit its measured region', () => { const result = fit('EXACT', controls({ max_font_size: 52, min_font_size: 52, max_lines: 1 }), geometry(80, 320, 920, 180)); assert.equal(result.font_size_px, 52); inside(result.painted_bounds, result.region); });
test('V4TYPE-23 one-pixel-too-short fixed layout rejects', () => {
  const value = 'EXACT'; const layout = controls({ max_font_size: 52, min_font_size: 52, max_lines: 1 }); let minimum = null;
  for (let height = 1; height <= 180; height += 1) { try { fit(value, layout, geometry(80, 320, 920, height)); minimum = height; break; } catch (caught) { if (caught.code !== 'COMPOSITION_TYPOGRAPHY_OVERFLOW') throw caught; } }
  assert.ok(minimum > 1); error(() => fit(value, layout, geometry(80, 320, 920, minimum - 1)), 'COMPOSITION_TYPOGRAPHY_OVERFLOW');
});
test('V4TYPE-24 identical input produces an identical fitted size and digest', () => { const a = fit('DETERMINISTIC LAYOUT'); const b = fit('DETERMINISTIC LAYOUT'); assert.equal(a.font_size_px, b.font_size_px); assert.equal(a.layout_digest_sha256, b.layout_digest_sha256); });
test('V4TYPE-25 identical input produces identical wrapping', () => { assert.deepEqual(fit('one two three four five six').lines, fit('one two three four five six').lines); });
test('V4TYPE-26 unknown layout fields remain rejected by the composition contract', () => { const f = fixture(); f.model.beats[0].layers[0].typography.layout.browser_hint = true; error(() => validate(f), 'COMPOSITION_UNKNOWN_FIELD'); });
test('V4TYPE-27 validation does not mutate the approved input composition', () => { const f = fixture(); const before = engine.canonicalize(f.model); validate(f); assert.equal(engine.canonicalize(f.model), before); });
test('V4TYPE-28 static graph without layout remains free of layout-only drawtext options', () => { const f = fixture(); delete f.model.beats[0].layers[0].typography.layout; const plan = validate(f); const command = []; const filters = []; engine.buildVideoGraph({ composition: plan, timeline: f.timeline, music: { policy: 'NONE' }, output: f.output }, command, filters); assert.ok(!filters.find((item) => item.includes('drawtext=')).includes('text_align=')); });
test('V4TYPE-29 reveal and typography layout coexist without changing reveal frame', () => { const f = fixture(); const item = f.model.beats[0].layers[0]; item.reveal = { mode: 'ADDITIVE_PERSIST', order: 1, start_ms: 200, end_ms: 1000, licensing_anchor_id: 'anchor-1', licensing_phrase_onset_ms: 200 }; f.model.beats[0].reveal_contract = { mode: 'ADDITIVE_PERSIST', unrevealed_state: 'ABSENT', required_layer_ids: ['type'] }; const beat = validate(f).beats[0]; assert.equal(beat.reveal_plan.events[0].first_visible_frame, 6); assert.ok(beat.layers[0].typography_layout); });
test('V4TYPE-30 a seven-layer S04-style reveal accepts all approved layout forms', () => {
  const specs = [
    ['premise', 'A MOAT YOU DO NOT HAVE TO BUILD', 160, 280, controls({ max_font_size: 70, min_font_size: 55, max_lines: 2, line_spacing_px: 8 })],
    ['timing', 'YOUR TIMING', 480, 150, controls({ max_font_size: 37, min_font_size: 37, max_lines: 1, line_spacing_px: 0 })],
    ['annoyance', 'IRRATIONAL ANNOYANCE', 660, 150, controls({ max_font_size: 37, min_font_size: 37, max_lines: 1, line_spacing_px: 0 })],
    ['tangent', 'THE DUMB TANGENT', 840, 150, controls({ max_font_size: 37, min_font_size: 37, max_lines: 1, line_spacing_px: 0 })],
    ['opinion', 'THE OVERCONFIDENT OPINION', 1020, 150, controls({ max_font_size: 37, min_font_size: 37, max_lines: 1, line_spacing_px: 0 })],
    ['checkpoint', 'NO CHECKPOINT.', 1360, 180, controls({ max_font_size: 52, min_font_size: 52, max_lines: 1, line_spacing_px: 0 })],
    ['lora', 'NO LoRA FOR BEING YOU.', 1570, 180, controls({ max_font_size: 52, min_font_size: 52, max_lines: 1, line_spacing_px: 0 })],
  ];
  const layers = specs.map(([id, content, y, height, layout], index) => ({ ...layer(id, index + 1, index === 0, content, { region: geometry(80, y, 920, height), layout }), reveal: { mode: 'ADDITIVE_PERSIST', order: index + 1, start_ms: index * 100, end_ms: 1000, licensing_anchor_id: `anchor-${index + 1}`, licensing_phrase_onset_ms: index * 100 } }));
  const f = fixture(layers); f.model.beats[0].reveal_contract = { mode: 'ADDITIVE_PERSIST', unrevealed_state: 'ABSENT', required_layer_ids: specs.map(([id]) => id) };
  const beat = validate(f).beats[0]; assert.equal(beat.reveal_plan.events.length, 7); assert.ok(beat.layers.every((item) => item.typography_layout.line_count <= item.typography.layout.max_lines));
});
test('V4TYPE-31 min below canonical readability floor is rejected', () => { error(() => fit('BAD', controls({ min_font_size: 23 })), 'COMPOSITION_TYPOGRAPHY_LAYOUT_MINIMUM_INVALID'); });
test('V4TYPE-32 layout render plan emits the approved line spacing and fitted size', () => { const f = fixture(); f.model.beats[0].layers[0].typography.layout = controls({ max_font_size: 52, min_font_size: 52, line_spacing_px: 18 }); const plan = validate(f); const command = []; const filters = []; engine.buildVideoGraph({ composition: plan, timeline: f.timeline, music: { policy: 'NONE' }, output: f.output }, command, filters); const draw = filters.find((item) => item.includes('drawtext=')); assert.match(draw, /fontsize=52/); assert.match(draw, /line_spacing=18/); });
test('V4TYPE-33 malformed non-object layout rejects', () => { const f = fixture(); f.model.beats[0].layers[0].typography.layout = null; error(() => validate(f), 'COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID'); });
test('V4TYPE-34 non-numeric font size rejects', () => { error(() => fit('BAD', controls({ max_font_size: '70' })), 'COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID'); });
test('V4TYPE-35 non-integer max_lines rejects', () => { error(() => fit('BAD', controls({ max_lines: 1.5 })), 'COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID'); });
test('V4TYPE-36 a missing required V4 layout field rejects', () => { const value = controls(); delete value.line_spacing_px; error(() => fit('BAD', value), 'COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID'); });
test('V4TYPE-37 unknown units are not accepted as an implicit conversion authority', () => { const f = fixture(); f.model.beats[0].layers[0].typography.layout.units = 'pt'; error(() => validate(f), 'COMPOSITION_UNKNOWN_FIELD'); });
test('V4TYPE-38 PRE_RENDERED cannot contradict layout execution semantics', () => { const f = fixture(); f.model.beats[0].layers[0].typography.render_mode = 'PRE_RENDERED'; error(() => validate(f), 'COMPOSITION_TYPOGRAPHY_LAYOUT_RENDER_MODE_INVALID'); });
test('V4TYPE-39 caller modification of the source layout invalidates the fitted plan binding', () => { const input = type('BOUND CONTRACT'); const result = typography.layoutTypography(input); input.layout.max_font_size = 71; error(() => typography.assertCanonicalLayout(input, result), 'COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID'); });
test('V4TYPE-40 an upper bound beyond the canonical 128px maximum rejects', () => { error(() => fit('BAD', controls({ max_font_size: 129 })), 'COMPOSITION_TYPOGRAPHY_LAYOUT_RANGE_INVALID'); });

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; process.stdout.write(`ok - ${item.name}\n`); }
      catch (caught) { process.stderr.write(`not ok - ${item.name}\n${caught.stack || caught}\n`); process.exitCode = 1; break; }
    }
    if (!process.exitCode) process.stdout.write(`${passed}/${tests.length} tests passed\n`);
  })();
}
