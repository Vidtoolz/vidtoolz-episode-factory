'use strict';

const crypto = require('node:crypto');
const { test, tests, assert, fs, os, path, childProcess } = require('./_helpers.js');
const engine = require('../scripts/production-assembly-composition.js');
const typography = require('../scripts/canonical-typography-layout.js');

const FONT = typography.FONT_FILE;
const FRAME = { width: 1280, height: 720 };
const CHARACTER_CASES = [
  ['ordinary ASCII', 'ordinary ASCII'],
  ['apostrophe', "I'm the moat."],
  ['multiple apostrophes', "I'm creator's own"],
  ['contraction', "I'm"],
  ['possessive', "creator's"],
  ['quoted apostrophe text', "'quoted'"],
  ['double quotes', '"quoted"'],
  ['apostrophe and double quotes', '"I\'m here"'],
  ['backslash', String.raw`C:\draft\file`],
  ['colon', 'label: value'],
  ['comma', 'one, two'],
  ['semicolon', 'one; two'],
  ['percent sign', '100% ready'],
  ['square brackets', '[vout] [x]'],
  ['parentheses', '(alpha)'],
  ['equals sign', 'x=0'],
  ['exclamation and question marks', 'really?!'],
  ['ampersand', 'A & B'],
  ['hyphen and em dash', 'hyphen - em — dash'],
  ['Unicode curly quotes', '“creator’s”'],
  ['accented Latin', 'Café naïve'],
  ['supported non-Latin Unicode', 'Γειά Привет'],
  ['explicit newline', 'line one\nline two'],
  ['punctuation-heavy sentence', `Wait—what?! [yes/no]; {alpha:beta}; 100% 'quoted' \\ escaped...`],
  ['hostile filter-looking text', `';,;[vout]:x=0:enable='gte(n,0)'`],
  ['text ending in apostrophe', "ending'"],
  ['text beginning in apostrophe', "'beginning"],
  ['repeated apostrophes', "'''"],
  ['empty text', ''],
  ['exact S10 production text', "I'm the moat. I'm keeping the moat."],
];

function runGraph(graph) {
  return childProcess.spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error',
    '-f', 'lavfi', '-i', `color=black:s=${FRAME.width}x${FRAME.height}:d=1`,
    '-filter_complex', graph, '-map', '[vout]', '-frames:v', '1',
    '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1',
  ], { maxBuffer: FRAME.width * FRAME.height + 1024 * 1024 });
}

function renderPair(text, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drawtext-escape-oracle-'));
  try {
    const textPath = path.join(root, 'text.txt'); fs.writeFileSync(textPath, text, 'utf8');
    const common = `fontfile=${FONT}:fontcolor=white:fontsize=20:expansion=none:x=10:y=10`;
    const serialized = engine.serializeDrawtextText(text);
    const inlineGraph = `[0:v]drawtext=${common}:text='${serialized}'[vout]`;
    const oracleGraph = `[0:v]drawtext=${common}:textfile=${textPath}[vout]`;
    const inline = runGraph(inlineGraph); const oracle = runGraph(oracleGraph);
    assert.equal(inline.status, 0, `${label} inline: ${String(inline.stderr).slice(0, 400)}`);
    assert.equal(oracle.status, 0, `${label} textfile: ${String(oracle.stderr).slice(0, 400)}`);
    assert.equal(Buffer.compare(inline.stdout, oracle.stdout), 0, `${label}: inline pixels differ from raw UTF-8 textfile oracle`);
    return { serialized, inlineGraph, frameSha256: crypto.createHash('sha256').update(inline.stdout).digest('hex') };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (let index = 0; index < CHARACTER_CASES.length; index += 1) {
  const [label, value] = CHARACTER_CASES[index];
  test(`DRAWTEXT-${String(index + 1).padStart(2, '0')} ${label} is pixel-identical to the UTF-8 textfile oracle`, () => { renderPair(value, label); });
}

const INJECTION_CASES = [
  ['quote terminator', `';`],
  ['filter separator', ',null;hflip'],
  ['pad label', '[vout][injected]'],
  ['coordinate option', ':x=0:y=0'],
  ['enable option', `:enable='gte(n,0)'`],
  ['nested punctuation', String.raw`\\';,[vout]:x=0:enable='1'`],
];
for (let index = 0; index < INJECTION_CASES.length; index += 1) {
  const [label, value] = INJECTION_CASES[index];
  test(`INJECT-${index + 1} ${label} remains drawtext data`, () => {
    const proof = renderPair(value, label);
    assert.ok(proof.inlineGraph.endsWith('[vout]'));
  });
}

test('DRAWTEXT-37 production invocation passes a filter graph argv directly without a shell', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'production-assembly-renderer.js'), 'utf8');
  assert.match(source, /childProcess\.spawnSync\(command, args/);
  assert.ok(!/shell\s*:\s*true/.test(source));
});

test('DRAWTEXT-38 the actual production graph renders exact S10 punctuation and resolves vout', () => {
  const content = "I'm the moat. I'm keeping the moat.";
  const region = { x: 80, y: 100, width: 920, height: 500, anchor: 'CENTER', bleed: [], edge_treatment: { type: 'NONE' } };
  const typographyModel = { content, content_sha256: engine.digest(content), preset: 'HEADLINE', region, alignment: 'CENTER', safe_margin_px: 48, render_mode: 'DRAW_TEXT', layout: { max_font_size: 108, min_font_size: 72, max_lines: 3, line_spacing_px: 18 } };
  const model = { schema: engine.SCHEMA, design_package: { path: '/design.json', sha256: 'a'.repeat(64), schema: 'design.v1' }, approved_visual_plan: { path: '/plan.json', file_sha256: 'b'.repeat(64), plan_id: 'plan', digest_sha256: 'c'.repeat(64) }, asset_manifest: { path: '/assets.json', sha256: 'd'.repeat(64) }, coverage: 'FULL_PROGRAMME', expected_beat_count: 1, forbidden_asset_ids: [], beats: [{ beat_id: 'S10', section_id: 'S10', start_ms: 0, end_ms: 1000, primary_owner: 'TYPOGRAPHY', transition_in: 'CUT', transition_out: 'CUT', layers: [{ layer_id: 'S10-type', type: 'TYPOGRAPHY', primary: true, z: 1, typography: typographyModel }] }] };
  const timeline = [{ section_id: 'S10', in_ms: 0, out_ms: 1000, programme_in_ms: 0, programme_out_ms: 1000, script_beat_ids: ['S10'] }];
  const output = { width: 1080, height: 1920, fps: 30 }; const manifest = { schema: engine.ASSET_MANIFEST_SCHEMA, run_id: 'S10-proof', assets: [] };
  const composition = engine.validateComposition(model, timeline, output, manifest); const command = []; const filters = [];
  engine.buildVideoGraph({ composition, timeline, music: { policy: 'NONE' }, output }, command, filters);
  const run = childProcess.spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-filter_complex', filters.join(';'), '-map', '[vout]', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(run.status, 0, String(run.stderr).slice(0, 500));
  assert.ok(filters.some((item) => item.includes("I'\\\\\\''m the moat.")));
});

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
