'use strict';

/*
 * Production supervised-capture readiness tests — PC1–PC16.
 *
 * Doctrine under test: the lane from an approved REVIEW draft up to the human
 * performance boundary is machine-preparable and machine-verifiable; the
 * performance itself belongs to Mikko alone. This suite proves:
 *
 *   - promotion to PRODUCTION requires human authority (no agent self-promotion)
 *   - promotion invalidates proxy capture; Draft evidence never carries over
 *   - machine prerequisites are enumerated and all must be green before the
 *     human performance is requested (READY_FOR_HUMAN_PERFORMANCE semantics)
 *   - proxy presenter / synthetic narration can never satisfy Production
 *   - the real-capture ingestion path (presenter take manifest) validates real
 *     bytes, rejects mutation, rejects run/proxy mismatch, and hands off to the
 *     Editor deterministically — closing the loop with the upstream-material
 *     auditor that feeds PRODUCTION_MIX
 *   - no 13th agent exists; Presenter Director is enabled only through Mikko's
 *     recorded decision and the canonical registry/contract coupling
 *
 * No real presenter performance is fabricated. The real-media fixture is a
 * deterministic ffmpeg-generated stand-in used ONLY to exercise the ingestion
 * machinery; it is never presented as Mikko's performance.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { tests, test } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const productionMode = require(path.join(ROOT, 'scripts', 'package-run-production-mode.js'));
const readiness = require(path.join(ROOT, 'scripts', 'production-capture-readiness.js'));
const ptm = require(path.join(ROOT, 'scripts', 'presenter-take-manifest.js'));
const upstream = require(path.join(ROOT, 'scripts', 'production-mix-upstream-readiness.js'));

const NOW = '2026-08-25T12:00:00.000Z';
const H = (value) => crypto.createHash('sha256').update(value).digest('hex');

function newRunDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pc-${label}-`));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/* Canonical minimal hermetic run: approved REVIEW artifacts, then promoted. */
function seedApprovedRun(label) {
  const dir = newRunDir(label);
  const contentHash = H(`${label}-story-content`);
  const scriptText = `# ${label}\n\nPresenter dialogue for the approved story.\n`;
  fs.writeFileSync(path.join(dir, 'final-script.md'), scriptText);
  writeJson(path.join(dir, 'story-binding.json'), {
    schema: 'vidtoolz.packageRunStoryBinding.v1',
    artifact_type: 'package-run-story-binding',
    run_id: path.basename(dir),
    story: { source_system: 'vidtoolz-script-builder', project_id: 'PROJ1', version_id: 'VER1', content_hash: contentHash },
    bound_at: NOW,
    bound_by: 'test',
    provenance: { source_artifact: 'final-script.md', source_artifact_sha256: H(scriptText) },
  });
  writeJson(path.join(dir, 'story-validation.json'), {
    schema_version: 1, evidence_kind: 'STORY_VALIDATION', verdict: 'PASS',
    story: { project_id: 'PROJ1', version_id: 'VER1', content_hash: contentHash },
  });
  return dir;
}

function seedManifest(dir) {
  const story = { project_id: 'PROJ1', version_id: 'VER1', content_hash: H('story'), approval_state: 'approved',
    sections: [{ section_id: 's1', order: 1, dialogue: 'Presenter dialogue for the approved story.', framing_preset: 'center-lower' }] };
  const manifest = ptm.createManifest(story, { now: NOW });
  writeJson(path.join(dir, 'presenter-take-manifest.json'), manifest);
  return { story, manifest };
}

function seedCaptureArtifacts(dir) {
  for (const name of ['capture-checklist.md', 'takes-log.md', 'missing-shot-tracker.md', 'screen-recording-checklist.md', 'audio-capture-checklist.md']) {
    fs.writeFileSync(path.join(dir, name), `# ${name}\n\nGenerated capture artifact.\n`);
  }
}

function makeRealVideoFixture(dir) {
  const file = path.join(dir, 'take-fixture.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x568:r=24:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-y', file]);
  const bytes = fs.readFileSync(file);
  return { file, bytes, sha256: H(bytes), byte_size: bytes.length };
}

/* ── PC1: promotion authority ─────────────────────────────────────────── */
test('PC1: REVIEW→PRODUCTION requires Mikko (human) authority', () => {
  const dir = seedApprovedRun('pc1');
  productionMode.setProductionMode(dir, productionMode.DRAFT, { setBy: 'generation_supervisor', setAt: NOW });
  productionMode.setProductionMode(dir, productionMode.REVIEW, { setBy: 'hermes', setAt: NOW });
  // An agent id may not promote: the identity contract refuses it.
  assert.throws(() => productionMode.setProductionMode(dir, productionMode.PRODUCTION, { setBy: 'generation_supervisor' }),
    /PRODUCTION_MODE_HUMAN_AUTHORITY_REQUIRED|authority/i);
  assert.throws(() => productionMode.setProductionMode(dir, productionMode.PRODUCTION, { setBy: 'hermes' }),
    /PRODUCTION_MODE_HUMAN_AUTHORITY_REQUIRED|authority/i);
  // A local human authority succeeds.
  const result = productionMode.setProductionMode(dir, productionMode.PRODUCTION, { setBy: 'mikko', setAt: NOW });
  assert.equal(result.record.mode, 'PRODUCTION');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC2: promotion invalidates proxy capture ─────────────────────────── */
test('PC2: promotion makes DRAFT proxy capture insufficient (policy regression)', () => {
  const policy = require(path.join(ROOT, 'scripts', 'gate-mode-policy.js'));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'gate-mode-policy.json'), 'utf8'));
  const draft = policy.resolveGateOwner('capture-evidence', 'DRAFT');
  const production = policy.resolveGateOwner('capture-evidence', 'PRODUCTION');
  assert.equal(draft.disposition, 'PROXY_CAPTURE_READY');
  assert.equal(production.disposition, 'REAL_CAPTURE_CONFIRMED');
  assert.equal(production.human_required, true);
  assert.equal(config.gates['capture-evidence'].modes.PRODUCTION.proxy_evidence_sufficient, false);
  assert.equal(config.production_promotion.proxy_does_not_carry.length > 0, true);
  // Gate 7 PRODUCTION reopens capture for a promoted run.
  const gate7 = policy.resolveGateOwner('capture-checklist', 'PRODUCTION');
  assert.equal(gate7.disposition, 'REAL_CAPTURE_REQUIRED');
  assert.equal(config.gates['capture-checklist'].modes.PRODUCTION.human_performance_required, true);
});

/* ── PC3: machine prerequisites before human request ──────────────────── */
test('PC3: human performance requested only after all machine prerequisites green', () => {
  const dir = seedApprovedRun('pc3');
  productionMode.setProductionMode(dir, productionMode.PRODUCTION, { setBy: 'mikko', setAt: NOW });
  // Incomplete: manifest + capture artifacts missing → NOT_READY, machine owns next.
  const incomplete = readiness.evaluateReadiness(dir);
  assert.equal(incomplete.state, readiness.STATE_NOT_READY);
  assert.equal(incomplete.next_authority, 'production_operations');
  assert.ok(incomplete.unmet_prerequisites.includes('PRESENTER_TAKE_MANIFEST_INITIALIZED'));
  assert.ok(incomplete.unmet_prerequisites.includes('CAPTURE_ARTIFACTS_GENERATED'));
  // Complete machine preparation → READY, Mikko owns next, still no capture.
  seedManifest(dir);
  seedCaptureArtifacts(dir);
  const ready = readiness.evaluateReadiness(dir);
  assert.equal(ready.state, readiness.STATE_READY);
  assert.equal(ready.next_authority, 'mikko');
  assert.equal(ready.capture_complete, false);
  assert.equal(ready.human_performance_recorded, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC4: proxy media cannot satisfy Production ───────────────────────── */
test('PC4: proxy presenter media cannot satisfy Production presenter source', () => {
  const dir = newRunDir('pc4');
  writeJson(path.join(dir, 'manifest.json'), {
    takes: [{ take_id: 't1', origin: 'PROXY_PRESENTER', media: { sha256: H('proxy') } }],
  });
  assert.throws(() => upstream.auditUpstreamMaterial({ presenterTakes: { manifest_path: path.join(dir, 'manifest.json') } }),
    (error) => error.code === 'PROGRAM_MIX_PRESENTER_SOURCE_PROXY_FORBIDDEN');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC5: synthetic narration cannot satisfy presenter audio ──────────── */
test('PC5: DRAFT_SYNTHETIC_NARRATION cannot satisfy Production presenter source', () => {
  const dir = newRunDir('pc5');
  writeJson(path.join(dir, 'manifest.json'), {
    takes: [{ take_id: 't1', origin: 'DRAFT_SYNTHETIC_NARRATION', media: { sha256: H('narration') } }],
  });
  assert.throws(() => upstream.auditUpstreamMaterial({ presenterTakes: { manifest_path: path.join(dir, 'manifest.json') } }),
    (error) => error.code === 'PROGRAM_MIX_PRESENTER_SOURCE_PROXY_FORBIDDEN');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC6: readiness does not imply capture complete ───────────────────── */
test('PC6: READY_FOR_HUMAN_PERFORMANCE never implies capture is complete', () => {
  const dir = seedApprovedRun('pc6');
  productionMode.setProductionMode(dir, productionMode.PRODUCTION, { setBy: 'mikko', setAt: NOW });
  seedManifest(dir);
  seedCaptureArtifacts(dir);
  const ready = readiness.evaluateReadiness(dir);
  assert.equal(ready.state, readiness.STATE_READY);
  assert.equal(ready.capture_complete, false);
  assert.equal(ready.human_performance_recorded, false);
  // Once a take exists, readiness is gone — the boundary has been crossed.
  const manifestPath = path.join(dir, 'presenter-take-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.takes.push({ take_id: 'take-recorded' });
  writeJson(manifestPath, manifest);
  const after = readiness.evaluateReadiness(dir);
  assert.notEqual(after.state, readiness.STATE_READY);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC7: missing real performance blocks downstream ──────────────────── */
test('PC7: absent real presenter media blocks the upstream audit', () => {
  const dir = newRunDir('pc7');
  writeJson(path.join(dir, 'manifest.json'), { takes: [] });
  const audit = upstream.auditUpstreamMaterial({ presenterTakes: { manifest_path: path.join(dir, 'manifest.json') } });
  assert.equal(audit.ready, false);
  assert.equal(audit.next_blocker, 'REAL_PRESENTER_AUDIO_MISSING');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC8–PC13 share one real-bytes ingestion fixture ──────────────────── */
function ingestRealTake() {
  const dir = newRunDir('pc8');
  const media = makeRealVideoFixture(dir);
  const story = { project_id: 'PROJ1', version_id: 'VER1', content_hash: H('story'), approval_state: 'approved',
    sections: [{ section_id: 's1', order: 1, dialogue: 'Presenter dialogue for the approved story.', framing_preset: 'center-lower' }] };
  let manifest = ptm.createManifest(story, { now: NOW });
  const unitId = manifest.recording_units[0].recording_unit_id;
  const takeId = `take-${ptm.ulid()}`;
  manifest = ptm.registerTake(manifest, {
    recording_unit_id: unitId, take_id: takeId,
    media: { path_or_artifact_ref: media.file, sha256: media.sha256, byte_size: media.byte_size, duration_s: 1, media_type: 'video/mp4', requires_audio: true },
    captured_at: NOW,
  }, { now: NOW });
  manifest = ptm.bindTranscript(manifest, takeId, { text: story.sections[0].dialogue, source: 'HUMAN_SUPPLIED' }, { now: NOW });
  manifest = ptm.createFidelityRecord(manifest, takeId, {}, { now: NOW });
  manifest = ptm.createHumanSelection(manifest, { take_id: takeId, selector: { type: 'HUMAN', id: 'TEST_HUMAN' }, selected_at: NOW }, { now: NOW });
  writeJson(path.join(dir, 'presenter-take-manifest.json'), manifest);
  return { dir, story, manifest, media, unitId, takeId };
}

test('PC8: valid real media passes technical validation and binds exact sha256', () => {
  const { dir, story, manifest, takeId } = ingestRealTake();
  const authority = ptm.evaluateTakeAuthority(manifest, takeId, { currentStory: story, allowedHumanIds: ['TEST_HUMAN'] });
  assert.equal(authority.media_verified, true);
  assert.equal(authority.state, 'EDITOR_READY');
  assert.equal(manifest.takes[0].media.verification.media_sha256, manifest.takes[0].media.sha256);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PC9: presenter audio binding is exact (sha256), never latest-file discovery', () => {
  const { dir, story, manifest } = ingestRealTake();
  // A wrong sha256 fails registration outright — the binding is byte-exact.
  const file2 = path.join(dir, 'other.mp4');
  fs.copyFileSync(manifest.takes[0].media.path_or_artifact_ref, file2);
  assert.throws(() => ptm.registerTake(manifest, {
    recording_unit_id: manifest.recording_units[0].recording_unit_id, take_id: `take-${ptm.ulid()}`,
    media: { path_or_artifact_ref: file2, sha256: H('wrong'), byte_size: 1, duration_s: 1, media_type: 'video/mp4', requires_audio: true },
    captured_at: NOW,
  }, { now: NOW }), /media verification failed/i);
  // The upstream auditor reads the manifest, not a directory scan.
  const audit = upstream.auditUpstreamMaterial({ presenterTakes: { manifest_path: path.join(dir, 'presenter-take-manifest.json') } });
  assert.ok(audit.satisfied.includes('presenter'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PC10: media mutation after capture invalidates authority', () => {
  const { dir, story, manifest, takeId } = ingestRealTake();
  fs.appendFileSync(manifest.takes[0].media.path_or_artifact_ref, Buffer.from('mutated'));
  const authority = ptm.evaluateTakeAuthority(manifest, takeId, { currentStory: story, allowedHumanIds: ['TEST_HUMAN'] });
  assert.equal(authority.media_verified, false);
  assert.equal(authority.editor_handoff_ready, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PC11: wrong-run / wrong-story manifest is rejected (run mismatch)', () => {
  const { dir, manifest, takeId } = ingestRealTake();
  const wrongStory = { project_id: 'OTHER', version_id: 'OTHER', content_hash: H('other'), approval_state: 'approved' };
  const authority = ptm.evaluateTakeAuthority(manifest, takeId, { currentStory: wrongStory, allowedHumanIds: ['TEST_HUMAN'] });
  assert.equal(authority.story_current, false);
  assert.equal(authority.editor_handoff_ready, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PC12: take semantics are human-only — proxy origin rejected at ingestion boundary', () => {
  const { dir } = ingestRealTake();
  writeJson(path.join(dir, 'proxy-manifest.json'), {
    takes: [{ take_id: 'proxy-1', origin: 'PROXY_PRESENTER', proxy: true, media: { sha256: H('px') } }],
  });
  assert.throws(() => upstream.auditUpstreamMaterial({ presenterTakes: { manifest_path: path.join(dir, 'proxy-manifest.json') } }),
    (error) => error.code === 'PROGRAM_MIX_PRESENTER_SOURCE_PROXY_FORBIDDEN');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PC13: Editor handoff is deterministic and carries exact media identity', () => {
  const { dir, story, manifest } = ingestRealTake();
  const handoff = ptm.buildEditorHandoff(manifest, { currentStory: story, allowedHumanIds: ['TEST_HUMAN'] });
  const unit = handoff.units[0];
  assert.equal(unit.ready, true);
  assert.equal(unit.selected_take.media.sha256, manifest.takes[0].media.sha256);
  assert.equal(unit.selected_take.media.path_or_artifact_ref, manifest.takes[0].media.path_or_artifact_ref);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC14: PRODUCTION_MIX becomes actionable after valid presenter audio ─ */
test('PC14: upstream audit passes once real presenter take is bound (presenter block clears)', () => {
  const { dir } = ingestRealTake();
  const audit = upstream.auditUpstreamMaterial({ presenterTakes: { manifest_path: path.join(dir, 'presenter-take-manifest.json') } });
  assert.ok(audit.satisfied.includes('presenter'));
  assert.ok(!audit.blockers.some((blocker) => blocker.block === 'REAL_PRESENTER_AUDIO_MISSING'));
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC15: no human evidence is fabricated ────────────────────────────── */
test('PC15: readiness reports never claim a performance happened', () => {
  const dir = seedApprovedRun('pc15');
  productionMode.setProductionMode(dir, productionMode.PRODUCTION, { setBy: 'mikko', setAt: NOW });
  seedManifest(dir);
  seedCaptureArtifacts(dir);
  const ready = readiness.evaluateReadiness(dir);
  assert.equal(ready.human_performance_recorded, false);
  assert.equal(ready.capture_complete, false);
  assert.ok(!/complete|approved|selected/i.test(ready.state));
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── PC16: canonical specialist count stays 12; PD enablement is bound ─── */
test('PC16: exactly 12 agents; presenter_director enablement is canonical', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  assert.equal(registry.agents.length, 12);
  const pd = registry.agents.find((agent) => agent.agent_id === 'presenter_director');
  assert.equal(pd.lifecycle.autonomous_dispatch, 'ENABLED');
  assert.equal(pd.lifecycle.proven, 'PROVEN');
  assert.equal(pd.implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.equal(pd.lifecycle.enablement_decision.decision, 'ENABLE');
  // Live boundary agrees: execution is permitted.
  const boundary = require(path.join(ROOT, 'scripts', 'agent-executable-boundary.js'));
  assert.equal(boundary.guardExecutableLifecycle('presenter_director'), true);
  // The referenced human decision exists as durable governance.
  const governanceDir = path.join(ROOT, 'governance');
  const enablementRecord = fs.readdirSync(governanceDir).find((name) => /presenter-director.*enable/i.test(name));
  assert.equal(enablementRecord, 'presenter-director-enablement.json');
});

module.exports = { tests };
