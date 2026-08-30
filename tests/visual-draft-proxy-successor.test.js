'use strict';

/*
 * The committed generic proxy asset (real bytes) and the same-Story successor
 * mechanism. The proxy's cutout alpha is validated against the actual PNG.
 */
const { assert, test, fs, os, path } = require('./_helpers.js');
const proxyAsset = require('../scripts/draft-presenter-proxy-asset.js');
const successor = require('../scripts/visual-draft-successor.js');
const renderer = require('../scripts/production-assembly-renderer.js');

test('PXA1 the committed proxy asset loads, hashes clean, and is classified generic', () => {
  const asset = proxyAsset.loadProxyAsset();
  assert.equal(asset.asset_id, 'REUSABLE_DRAFT_PRESENTER_PROXY_V1');
  assert.equal(asset.role, 'GENERIC_PRESENTER_PROXY');
  assert.equal(asset.media_kind, 'IMAGE');
  assert.ok(asset.height >= 1920);
  assert.deepEqual(asset.alpha, { required: true, format: 'PNG_ALPHA' });
  assert.equal(asset.provenance.classification, 'GENERIC_HUMAN_PRESENTER_PROXY');
});

test('PXA2 the committed proxy PNG really carries clean cutout alpha', () => {
  const asset = proxyAsset.loadProxyAsset();
  const evidence = renderer.validateProxyAlphaAsset(asset);
  assert.equal(evidence.alpha_nontrivial, true);
  assert.ok(evidence.alpha_min <= 5, 'genuinely transparent surroundings');
  assert.ok(evidence.alpha_max >= 250, 'solid subject');
});

test('PXA3 tampered proxy bytes fail closed against the provenance record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-tamper-'));
  fs.copyFileSync(path.join(proxyAsset.PROXY_DIR, 'REUSABLE_DRAFT_PRESENTER_PROXY_V1.provenance.json'), path.join(dir, 'REUSABLE_DRAFT_PRESENTER_PROXY_V1.provenance.json'));
  fs.writeFileSync(path.join(dir, 'REUSABLE_DRAFT_PRESENTER_PROXY_V1.png'), Buffer.from('not the proxy'));
  assert.throws(() => proxyAsset.loadProxyAsset({ proxyDir: dir }), { code: 'PROXY_ASSET_DRIFT' });
});

function tmpPredecessor() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pred-run-'));
  fs.mkdirSync(path.join(runDir, 'media', 'visual-draft'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'media', 'visual-draft', 'visual-draft-v1.mp4'), Buffer.from('frozen v1 bytes'));
  return runDir;
}
const STORY = { project_id: 'p1', version_id: 'v1', content_hash: 'a'.repeat(64) };

test('SUC1 a successor link binds the predecessor bytes and a distinct output name', () => {
  const runDir = tmpPredecessor();
  const link = successor.buildSuccessorLink({ predecessorRunDir: runDir, predecessorOutputRelative: 'media/visual-draft/visual-draft-v1.mp4', successorRunId: 'run-v2', successorOutputName: 'visual-draft-v2.mp4', story: STORY });
  assert.equal(link.predecessor_frozen, true);
  assert.match(link.predecessor_output.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(link.same_story, STORY);
  assert.equal(successor.verifyPredecessorFrozen(link, runDir).frozen, true);
});

test('SUC2 overwriting the predecessor output is detected as a freeze violation', () => {
  const runDir = tmpPredecessor();
  const link = successor.buildSuccessorLink({ predecessorRunDir: runDir, predecessorOutputRelative: 'media/visual-draft/visual-draft-v1.mp4', successorRunId: 'run-v2', successorOutputName: 'visual-draft-v2.mp4', story: STORY });
  fs.writeFileSync(path.join(runDir, 'media', 'visual-draft', 'visual-draft-v1.mp4'), Buffer.from('REPLACED'));
  assert.throws(() => successor.verifyPredecessorFrozen(link, runDir), { code: 'SUCCESSOR_FREEZE_VIOLATED' });
});

test('SUC3 a successor may not shadow the predecessor output or reuse its run id', () => {
  const runDir = tmpPredecessor();
  assert.throws(() => successor.buildSuccessorLink({ predecessorRunDir: runDir, predecessorOutputRelative: 'media/visual-draft/visual-draft-v1.mp4', successorRunId: 'run-v2', successorOutputName: 'visual-draft-v1.mp4', story: STORY }), { code: 'SUCCESSOR_OUTPUT_NAME_INVALID' });
  assert.throws(() => successor.buildSuccessorLink({ predecessorRunDir: runDir, predecessorOutputRelative: 'media/visual-draft/visual-draft-v1.mp4', successorRunId: path.basename(runDir), successorOutputName: 'visual-draft-v2.mp4', story: STORY }), { code: 'SUCCESSOR_RUN_ID_INVALID' });
});

module.exports = { tests: require('./_helpers.js').tests };
