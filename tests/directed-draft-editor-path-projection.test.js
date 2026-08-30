'use strict';

const crypto = require('node:crypto');
const { assert, fs, os, path, test } = require('./_helpers.js');
const handoff = require('../scripts/directed-draft-assembly-handoff.js');
const renderer = require('../scripts/production-assembly-renderer.js');

function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-path-projection-'));
  const run = path.join(root, 'run-one'); fs.mkdirSync(path.join(run, 'media', 'narration'), { recursive: true });
  const audio = path.join(run, 'media', 'narration', 'voice.wav'); fs.writeFileSync(audio, 'canonical-narration');
  const alignment = path.join(run, 'alignment.json'); fs.writeFileSync(alignment, '{"schema":"alignment"}\n');
  const value = {
    run_id: 'run-one',
    timeline: { timing_authority: 'FINAL_PAUSED_NARRATION', duration_ms: 2000 },
    narration: {
      required: true, source_class: 'HUMAN_DRAFT_NARRATION', path: fs.realpathSync(audio), sha256: handoff.sha256FileSync(audio), duration_ms: 2000,
      alignment: { path: fs.realpathSync(alignment), sha256: handoff.sha256FileSync(alignment), digest: 'a'.repeat(64) },
      packet_binding: { source_class: 'HUMAN_DRAFT_NARRATION', path: 'media/narration/voice.wav', sha256: handoff.sha256FileSync(audio), alignment: { path: 'alignment.json', sha256: handoff.sha256FileSync(alignment), digest: 'a'.repeat(64) } },
    },
  };
  return { root, run, audio, alignment, value };
}
function code(fn, expected) { assert.throws(fn, (error) => error.code === expected, expected); }

test('DDPP01 run-relative narration declaration projects to canonical renderer locator', () => { const fx = fixture(); const out = handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]); assert.equal(out.path, 'media/narration/voice.wav'); assert.equal(out.resolved_path, fx.audio); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP02 absolute verified narration authority remains valid', () => { const fx = fixture(); fx.value.narration.packet_binding.path = fx.audio; const out = handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]); assert.equal(out.resolved_path, fx.audio); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP03 missing canonical narration fails with typed authority error', () => { const fx = fixture(); fs.unlinkSync(fx.audio); code(() => handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), 'AUTHORITY_ARTIFACT_MISSING'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP04 narration byte mismatch fails closed', () => { const fx = fixture(); fs.appendFileSync(fx.audio, 'drift'); code(() => handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), 'NARRATION_SHA_DRIFT'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP05 caller-supplied override has no projection authority', () => { const fx = fixture(); const out = handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run], { narrationPath: '/etc/hosts' }); assert.equal(out.resolved_path, fx.audio); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP06 projection retains relative declaration only as provenance', () => { const fx = fixture(); const out = handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]); assert.notEqual(out.resolved_path, out.path); assert.equal(renderer.narrationPacketDeclaration(out).path, fx.value.narration.packet_binding.path); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP07 run-relative alignment declaration projects to canonical renderer locator', () => { const fx = fixture(); const out = handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]); assert.equal(out.alignment.path, 'alignment.json'); assert.equal(out.alignment.resolved_path, fx.alignment); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP08 missing canonical alignment fails with typed authority error', () => { const fx = fixture(); fs.unlinkSync(fx.alignment); code(() => handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), 'AUTHORITY_ARTIFACT_MISSING'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP09 alignment byte mismatch fails closed', () => { const fx = fixture(); fs.appendFileSync(fx.alignment, 'drift'); code(() => handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), 'NARRATION_ALIGNMENT_DRIFT'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP10 narration packet identity is preserved exactly after removing operational locators', () => { const fx = fixture(); const out = handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]); assert.deepEqual(renderer.narrationPacketDeclaration(out), fx.value.narration.packet_binding); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP11 narration source class is preserved', () => { const fx = fixture(); assert.equal(handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]).source_class, 'HUMAN_DRAFT_NARRATION'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP12 final-paused timeline duration remains bound during projection', () => { const fx = fixture(); fx.value.timeline.duration_ms = 1999; code(() => handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), 'NARRATION_TIMELINE_DRIFT'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP13 identical canonical input produces deterministic projection', () => { const fx = fixture(); assert.deepEqual(handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run])); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP14 canonical narration outside allowed roots is rejected', () => { const fx = fixture(); fx.value.narration.path = '/etc/hosts'; fx.value.narration.sha256 = sha(fs.readFileSync('/etc/hosts')); fx.value.narration.packet_binding.sha256 = fx.value.narration.sha256; code(() => handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), 'FABRICATED_ASSET_PATH'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP15 relative traversal cannot become canonical narration authority', () => { const fx = fixture(); fx.value.narration.path = '../voice.wav'; code(() => handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), 'NARRATION_CANONICAL_PATH_REQUIRED'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDPP16 symlink indirection cannot replace the canonical resolved locator', () => { const fx = fixture(); const link = path.join(fx.run, 'voice-link.wav'); fs.symlinkSync(fx.audio, link); fx.value.narration.path = link; code(() => handoff.projectNarrationForRenderer(fx.value, fx.run, [fx.run]), 'NARRATION_CANONICAL_PATH_REQUIRED'); fs.rmSync(fx.root, { recursive: true, force: true }); });
