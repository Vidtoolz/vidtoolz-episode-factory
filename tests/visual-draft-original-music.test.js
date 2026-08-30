'use strict';

/*
 * ORIGINAL_DRAFT_MUSIC integration: existing Scorecraft -> MusicRenderBrief ->
 * MiniMax route, duration bound to the FINAL PAUSED NARRATION, reuse rejected,
 * placeholder always classified DEGRADED. All compute/transport is faked.
 */
const { assert, test, fs, os, path } = require('./_helpers.js');
const crypto = require('node:crypto');
const draftMusic = require('../scripts/visual-draft-original-music.js');
const renderer = require('../scripts/production-assembly-renderer.js');

const FAKE_WAV = Buffer.from('deterministic-fake-minimax-wav-v2');
const FAKE_WAV_SHA256 = crypto.createHash('sha256').update(FAKE_WAV).digest('hex');
const SCRIPT = 'Authorship is a claim about decisions. Most people think it is a claim about labor. But the two have never been the same thing.';

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-music-'));
  return { root, options: { settingsPath: path.join(root, 'settings.json'), musicRoot: path.join(root, 'music') } };
}
function paused(seconds = 92.5) { return { schema: 'vidtoolz.finalPausedNarration.v1', final_duration_seconds: seconds, audio: { sha256: 'c'.repeat(64) } }; }
function routeGate(host = 'workerx') {
  return { ok: true, decision: 'ROUTE', lane: 'music_generation', selected_host: host, fallback_used: false, reason: 'available', checks: {}, registry_version: 1 };
}
function fakeTransportFactory(record = {}) {
  return () => ({
    async submitPrompt(graph) { record.graph = graph; return 'prompt-1'; },
    async fetchHistory() { return { status: { completed: true, status_str: 'success' }, outputs: { 9: { audio: [{ filename: 'prompt-1.flac', subfolder: 'scorecraft', type: 'output' }] } } }; },
    async convertToWav() {},
    async ensureRemoteDir() {},
    async retrieve(remoteFile, localFile) { fs.writeFileSync(localFile, FAKE_WAV); },
    async sha256() { return FAKE_WAV_SHA256; },
    sleep: async () => {},
  });
}

test('VDM1 plan binds the exact final paused duration and the actual script into the brief', () => {
  const { options } = tmpEnv();
  const planned = draftMusic.planOriginalDraftMusic({ name: 'v2 test', scriptText: SCRIPT, pausedManifest: paused(92.5) }, options);
  assert.equal(planned.brief.target_duration_s, 92.5);
  assert.equal(planned.requested_duration_s, 92.5);
  assert.ok(planned.brief.sections.length >= 1);
  assert.equal(planned.brief.sections.at(-1).end_s, 92.5);
  assert.match(planned.approval.basis, /AUTONOMOUS_DRAFT_CUE_APPROVAL/);
  assert.equal(planned.approval.doctrine.doctrine_id, 'VISUAL_DRAFT_PRODUCTION_DOCTRINE');
});

test('VDM2 hostile: music duration derived from anything but the paused narration fails closed', () => {
  const { options } = tmpEnv();
  assert.throws(() => draftMusic.assertDurationFromTimingAuthority(paused(92.5), 88.2), { code: 'MUSIC_DURATION_NOT_FROM_TIMING_AUTHORITY' });
  assert.throws(() => draftMusic.assertDurationFromTimingAuthority({ schema: 'vidtoolz.syntheticNarration.v1' }, 92.5), { code: 'MUSIC_TIMING_AUTHORITY_REQUIRED' });
  assert.throws(() => draftMusic.planOriginalDraftMusic({ scriptText: SCRIPT, pausedManifest: { schema: 'vidtoolz.finalPausedNarration.v1' } }, options), { code: 'MUSIC_DURATION_INVALID' });
});

test('VDM3 dispatch through the existing bridge yields a new original track that classifies MET', async () => {
  const { options } = tmpEnv();
  const planned = draftMusic.planOriginalDraftMusic({ name: 'v2 dispatch', scriptText: SCRIPT, pausedManifest: paused(60) }, options);
  const record = {};
  const result = await draftMusic.dispatchOriginalDraftMusic(planned, { ...options, computeGateFn: () => routeGate(), transportFn: fakeTransportFactory(record) });
  assert.equal(result.dispatch_status, 'dispatched');
  assert.equal(result.candidates.length, 1);
  const done = result.results[0];
  assert.equal(done.status, 'completed');
  // duration reaches the model from the paused-narration-bound brief
  const graphText = JSON.stringify(record.graph);
  assert.match(graphText, /60/);
  const verdict = draftMusic.classifyDraftMusicResult({ candidate: done, requestedDurationSeconds: 60, priorMusicShas: new Set() }, { probeDuration: () => 60.4 });
  assert.equal(verdict.classification, 'ORIGINAL_DRAFT_MUSIC');
  assert.equal(verdict.original_music_requirement, 'MET');
});

test('VDM4 hostile: a track already used by another run is reuse, never original', () => {
  const candidate = { status: 'completed', output_sha256: FAKE_WAV_SHA256, local_deliverable_path: '/nonexistent.wav', measured_duration_seconds: 60.2 };
  const verdict = draftMusic.classifyDraftMusicResult({ candidate, requestedDurationSeconds: 60, priorMusicShas: new Set([FAKE_WAV_SHA256]) });
  assert.equal(verdict.classification, 'DRAFT_MUSIC_PLACEHOLDER');
  assert.equal(verdict.original_music_requirement, 'DEGRADED_NOT_MET');
  assert.match(verdict.reasons.join('; '), /reuse is not original/);
});

test('VDM5 hostile: a placeholder can never be labeled original', () => {
  assert.throws(() => draftMusic.buildMusicPolicyEntry({ decisionId: 'd1', musicSha256: FAKE_WAV_SHA256, classification: 'DRAFT_MUSIC_PLACEHOLDER', requirement: 'MET' }), { code: 'MUSIC_CLASSIFICATION_INVALID' });
  assert.throws(() => draftMusic.buildMusicPolicyEntry({ decisionId: 'd1', musicSha256: FAKE_WAV_SHA256, classification: 'ORIGINAL_DRAFT_MUSIC', requirement: 'DEGRADED_NOT_MET' }), { code: 'MUSIC_CLASSIFICATION_INVALID' });
  const failedVerdict = draftMusic.classifyDraftMusicResult({ candidate: { status: 'failed' }, requestedDurationSeconds: 60 });
  assert.equal(failedVerdict.classification, 'DRAFT_MUSIC_PLACEHOLDER');
  assert.equal(failedVerdict.original_music_requirement, 'DEGRADED_NOT_MET');
});

test('VDM6 the policy entry satisfies the renderer authority chain and names its classification', () => {
  const entry = draftMusic.buildMusicPolicyEntry({ decisionId: 'v2-music-001', musicSha256: FAKE_WAV_SHA256, classification: 'ORIGINAL_DRAFT_MUSIC', requirement: 'MET' });
  const active = renderer.activeMusicDecision({ policy: 'FULL_PROGRAMME', sha256: FAKE_WAV_SHA256, policy_history: [entry] });
  assert.equal(active.decision_id, 'v2-music-001');
  assert.match(active.basis, /ORIGINAL_DRAFT_MUSIC \/ ORIGINAL_MUSIC_REQUIREMENT=MET/);
  assert.match(active.basis, /VISUAL_DRAFT_PRODUCTION_DOCTRINE v1/);
});

test('VDM7 prior music identities are collected from run specs and packets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-runs-'));
  fs.mkdirSync(path.join(root, 'run-a'));
  fs.writeFileSync(path.join(root, 'run-a', 'visual-draft-render-spec.json'), JSON.stringify({ music: { sha256: 'a'.repeat(64), policy_history: [{ music_sha256: 'b'.repeat(64) }] } }));
  const shas = draftMusic.collectPriorMusicShas(root);
  assert.ok(shas.has('a'.repeat(64)) && shas.has('b'.repeat(64)));
});

test('VDM8 a render that does not serve the paused programme duration is degraded', () => {
  const candidate = { status: 'completed', output_sha256: 'd'.repeat(64), measured_duration_seconds: 30.0 };
  const verdict = draftMusic.classifyDraftMusicResult({ candidate, requestedDurationSeconds: 60 });
  assert.equal(verdict.original_music_requirement, 'DEGRADED_NOT_MET');
  assert.match(verdict.reasons.join('; '), /does not serve/);
});

test('VDM9 the 600 s brief ceiling stays enforced through the existing exporter', () => {
  const { options } = tmpEnv();
  assert.throws(() => draftMusic.planOriginalDraftMusic({ scriptText: SCRIPT, pausedManifest: paused(700) }, options), /600/);
});

module.exports = { tests: require('./_helpers.js').tests };
