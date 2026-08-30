'use strict';

const { assert, test } = require('./_helpers.js');
const typography = require('../scripts/canonical-typography-layout.js');

function model(content, region = { x: 128, y: 500, width: 824, height: 360 }, overrides = {}) {
  return {
    content,
    region,
    alignment: 'CENTER',
    safe_margin_px: 24,
    backing: { color: 'GREY', opacity: 0.56 },
    ...overrides,
  };
}
function assertInside(inner, outer) {
  assert.ok(inner.x >= outer.x, `${inner.x} < ${outer.x}`);
  assert.ok(inner.y >= outer.y, `${inner.y} < ${outer.y}`);
  assert.ok(inner.x + inner.width <= outer.x + outer.width, `${inner.x + inner.width} > ${outer.x + outer.width}`);
  assert.ok(inner.y + inner.height <= outer.y + outer.height, `${inner.y + inner.height} > ${outer.y + outer.height}`);
}
function legal(content, region, overrides) {
  const result = typography.layoutTypography(model(content, region, overrides));
  assertInside(result.glyph_bounds, result.region);
  assertInside(result.painted_bounds, result.region);
  assert.ok(result.font_size_px >= typography.MIN_FONT_SIZE_PX);
  typography.assertCanonicalLayout(model(content, region, overrides), result);
  return result;
}
function minimumLegalHeight(content, width) {
  for (let height = 1; height <= 240; height += 1) {
    try { typography.layoutTypography(model(content, { x: 128, y: 500, width, height })); return height; }
    catch (error) { if (error.code !== 'COMPOSITION_TYPOGRAPHY_OVERFLOW') throw error; }
  }
  throw new Error('no legal height found');
}

test('TYPEFIT01 exact prior 120-character unbroken headline fails closed in the original region', () => {
  assert.throws(() => legal('W'.repeat(120), { x: 128, y: 620, width: 824, height: 150 }), { code: 'COMPOSITION_TYPOGRAPHY_OVERFLOW' });
});

test('TYPEFIT02 a very long uppercase word uses measured grapheme emergency breaks', () => {
  const result = legal('SUPERCALIFRAGILISTICEXPIALIDOCIOUS'.repeat(4));
  assert.ok(result.line_count > 1);
  assert.equal(result.lines.join(''), 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS'.repeat(4));
});

test('TYPEFIT03 a long URL cannot escape the declared region', () => {
  const value = `https://example.invalid/${'path-segment/'.repeat(10)}?token=${'a1'.repeat(32)}`;
  const result = legal(value);
  assert.ok(result.line_count > 1);
  assert.equal(result.lines.join(''), value);
});

test('TYPEFIT04 a SHA-like identifier uses deterministic emergency breaks', () => {
  const value = `sha256:${'abcdef0123456789'.repeat(8)}`;
  const result = legal(value);
  assert.ok(result.line_count > 1);
  assert.equal(result.lines.join(''), value);
});

test('TYPEFIT05 many ordinary short words wrap at whitespace', () => {
  const value = 'authorship means choosing the claims the sequence the evidence and the final editorial shape';
  const result = legal(value, { x: 128, y: 500, width: 520, height: 360 });
  assert.ok(result.line_count > 1);
  assert.ok(result.lines.every((line) => !line.endsWith(' ')));
});

test('TYPEFIT06 a one-line phrase remains one measured line', () => {
  const result = legal('EXACT ONE LINE', { x: 128, y: 620, width: 824, height: 150 });
  assert.equal(result.line_count, 1);
});

test('TYPEFIT07 an exact two-line minimum-size height is legal', () => {
  const value = `${'W'.repeat(16)}\n${'W'.repeat(16)}`;
  const spacing = typography.lineSpacing(typography.MIN_FONT_SIZE_PX);
  const lineMetric = typography.measureTextBatch(['W'.repeat(16)], typography.MIN_FONT_SIZE_PX, spacing)[0];
  const width = lineMetric.width + 48;
  const region = { x: 128, y: 500, width, height: minimumLegalHeight(value, width) };
  const result = legal(value, region);
  assert.equal(result.font_size_px, typography.MIN_FONT_SIZE_PX);
  assert.equal(result.line_count, 2);
  assert.throws(() => legal(value, { ...region, height: region.height - 1 }), { code: 'COMPOSITION_TYPOGRAPHY_OVERFLOW' });
});

test('TYPEFIT08 one pixel beyond legal vertical capacity is rejected deterministically', () => {
  const value = `${'W'.repeat(16)}\n${'W'.repeat(16)}`;
  const spacing = typography.lineSpacing(typography.MIN_FONT_SIZE_PX);
  const lineMetric = typography.measureTextBatch(['W'.repeat(16)], typography.MIN_FONT_SIZE_PX, spacing)[0];
  const width = lineMetric.width + 48;
  const region = { x: 128, y: 500, width, height: minimumLegalHeight(value, width) - 1 };
  assert.throws(() => legal(value, region), { code: 'COMPOSITION_TYPOGRAPHY_OVERFLOW' });
});

test('TYPEFIT09 unusually wide repeated W glyphs remain bounded', () => {
  const result = legal('W'.repeat(120));
  assert.ok(result.line_count >= 5);
});

test('TYPEFIT10 unusually narrow repeated i glyphs use available width without overflow', () => {
  const result = legal('i'.repeat(120));
  assert.ok(result.line_count >= 1);
  assertInside(result.glyph_bounds, result.region);
});

test('TYPEFIT11 punctuation-heavy content is measured and bounded', () => {
  legal(`Wait—what?! [yes/no]; {alpha:beta}; 100% 'quoted' \\ escaped...`);
});

test('TYPEFIT12 mixed Unicode supported by the canonical font remains bounded', () => {
  legal('Café naïve — Γειά σου κόσμε — Привет, мир — déjà vu');
});

test('TYPEFIT13 explicit newlines remain explicit lines', () => {
  const result = legal('FIRST LINE\nSECOND LINE\nTHIRD LINE');
  assert.equal(result.line_count, 3);
  assert.deepEqual(result.lines, ['FIRST LINE', 'SECOND LINE', 'THIRD LINE']);
});

test('TYPEFIT14 multiple consecutive spaces have deterministic measured handling', () => {
  const result = legal('ONE    TWO      THREE', { x: 128, y: 620, width: 824, height: 150 });
  assert.equal(result.rendered_text, 'ONE    TWO      THREE');
});

test('TYPEFIT15 maximum legal font size is bounded at 128px', () => {
  const result = legal('MAX', { x: 128, y: 200, width: 824, height: 800 });
  assert.equal(result.font_size_px, typography.MAX_FONT_SIZE_PX);
});

test('TYPEFIT16 fitting can land exactly on the 24px readable minimum', () => {
  const line = 'W'.repeat(24);
  const value = `${line}\n${line}`;
  const spacing = typography.lineSpacing(typography.MIN_FONT_SIZE_PX);
  const lineMetric = typography.measureTextBatch([line], typography.MIN_FONT_SIZE_PX, spacing)[0];
  const result = legal(value, { x: 128, y: 620, width: lineMetric.width + 48, height: 120 });
  assert.equal(result.font_size_px, typography.MIN_FONT_SIZE_PX);
});

test('TYPEFIT17 content impossible even at 24px is rejected with the typed overflow code', () => {
  assert.throws(() => legal('W'.repeat(500), { x: 128, y: 620, width: 824, height: 150 }), { code: 'COMPOSITION_TYPOGRAPHY_OVERFLOW' });
});

test('TYPEFIT18 text regions touching every frame-safe boundary retain glyph and backing bounds', () => {
  const regions = [
    { x: 72, y: 500, width: 420, height: 180 },
    { x: 588, y: 500, width: 420, height: 180 },
    { x: 330, y: 96, width: 420, height: 180 },
    { x: 330, y: 1644, width: 420, height: 180 },
  ];
  for (const region of regions) legal('BOUNDARY SAFE', region);
});

test('TYPEFIT19 canonical layout rejects content or font authority tampering', () => {
  const input = model('BOUND LAYOUT');
  const result = typography.layoutTypography(input);
  assert.throws(() => typography.assertCanonicalLayout(input, { ...result, font_size_px: result.font_size_px - 1 }), { code: 'COMPOSITION_TYPOGRAPHY_LAYOUT_INVALID' });
});

test('TYPEFIT20 pre-rendered typography authority is explicit pixel-domain confinement', () => {
  const input = model('PRE-RENDERED');
  const result = typography.confinedPreRenderedTypography(input);
  assert.equal(result.mode, 'PRE_RENDERED_CONFINED');
  typography.assertCanonicalLayout(input, result);
});

module.exports = { tests: require('./_helpers.js').tests };
