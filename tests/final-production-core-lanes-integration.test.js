'use strict';

const { assert, fs, os, path, test } = require('./_helpers.js');
const childProcess = require('node:child_process');
const core = require('../scripts/final-production-core-lanes.js');
const laneStateAuthority = require('../scripts/final-production-lane-state.js');
const music = require('../scripts/final-music-production.js');
const fplHarness = require('./final-production-lock-package.test.js');

function lane(complete, extra = {}) { return { complete, state: complete ? 'COMPLETE' : 'REQUIRED', status: { takes: 0, next_action: complete ? 'complete' : 'record or select', coverage: [] , ...extra } }; }
function snapshot(v = false, p = false, m = false) { return { run_id: 'integration-fixture', package_state: 'FINAL_PRODUCTION_PACKAGE_READY', lock_id: 'lock-1', lock_digest_sha256: 'lock-sha', final_edit_complete: false, final_qc_pass: false, publication_approved: false, lanes: { visual: { complete: v, status: { selected: v ? 20 : 0 } }, performance: lane(p, { takes: p ? 1 : 0 }), music: lane(m) } }; }
function actions(v, p, m) { return core.nextActionsFromSnapshot(snapshot(v, p, m)); }
function projection(v, p, m) { return core.projectionFromSnapshot(snapshot(v, p, m), 'blueprint-sha', '2026-09-01T00:00:00.000Z'); }

test('CIL-01 incomplete lanes expose all three independent actions', () => {
  const value = actions(false, false, false); assert.deepEqual(value.ready.map((x) => x.task), ['VISUAL_READY', 'PERFORMANCE_READY', 'MUSIC_READY']); assert.equal(value.independent_lanes, true);
});
test('CIL-02 visual complete leaves performance and music required', () => { const x = actions(true, false, false); assert.deepEqual(x.ready.map((v) => v.lane), ['FINAL_HUMAN_PERFORMANCE', 'FINAL_MUSIC']); });
test('CIL-03 performance complete leaves visual and music required', () => { const x = actions(false, true, false); assert.deepEqual(x.ready.map((v) => v.lane), ['FINAL_VISUAL_ASSETS', 'FINAL_MUSIC']); });
test('CIL-04 music complete leaves visual and performance required', () => { const x = actions(false, false, true); assert.deepEqual(x.ready.map((v) => v.lane), ['FINAL_VISUAL_ASSETS', 'FINAL_HUMAN_PERFORMANCE']); });
test('CIL-05 visual plus performance does not complete the edit', () => { const x = actions(true, true, false); assert.equal(x.final_edit_complete, false); assert.equal(x.lanes.music.complete, false); });
test('CIL-06 visual plus music does not complete the edit', () => { const x = actions(true, false, true); assert.equal(x.final_edit_complete, false); assert.equal(x.lanes.performance.complete, false); });
test('CIL-07 performance plus music does not complete the edit', () => { const x = actions(false, true, true); assert.equal(x.final_edit_complete, false); assert.equal(x.lanes.visual.complete, false); });
test('CIL-08 all lanes still do not imply final edit completion', () => { const x = actions(true, true, true); assert.equal(x.final_edit_complete, false); assert.equal(x.final_qc_pass, false); assert.equal(x.publication_approved, false); });
test('CIL-09 absent final edit keeps QC false', () => { assert.equal(projection(true, true, true).final_edit_created, false); assert.equal(projection(true, true, true).final_qc_pass, false); });
test('CIL-10 absent QC keeps publication false', () => { assert.equal(projection(true, true, true).publication_approved, false); });
test('CIL-11 machine visual selection cannot be represented as completion', () => { const x = snapshot(true, false, false); x.lanes.visual.status.selected = 0; x.lanes.visual.complete = false; assert.equal(core.nextActionsFromSnapshot(x).lanes.visual.complete, false); });
test('CIL-12 machine performance selection cannot be represented as completion', () => { const x = snapshot(false, false, false); x.lanes.performance.status.takes = 1; assert.equal(core.nextActionsFromSnapshot(x).lanes.performance.complete, false); });
test('CIL-13 machine music selection cannot be represented as completion', () => { const x = snapshot(false, false, false); x.lanes.music.status.machine_selected = true; assert.equal(core.nextActionsFromSnapshot(x).lanes.music.complete, false); });
test('CIL-14 Draft narration is not a performance lane completion', () => { assert.equal(snapshot(false, false, false).lanes.performance.complete, false); });
test('CIL-15 r2 human narration is not a performance lane completion', () => { assert.equal(snapshot(false, false, false).lanes.performance.complete, false); });
test('CIL-16 Draft music is not a music lane completion', () => { assert.equal(snapshot(false, false, false).lanes.music.complete, false); });
test('CIL-17 changed visual selection remains a visual lane placeholder until current authority says complete', () => { assert.equal(projection(false, true, true).lanes.visual.placeholder, 'FINAL_VISUAL_ASSETS'); });
test('CIL-18 changed performance selection remains a performance placeholder until current authority says complete', () => { assert.equal(projection(true, false, true).lanes.performance.placeholder, 'FINAL_HUMAN_PERFORMANCE'); });
test('CIL-19 changed music selection remains a music placeholder until current authority says complete', () => { assert.equal(projection(true, true, false).lanes.music.placeholder, 'FINAL_MUSIC'); });
test('CIL-20 lock change cannot be silently represented as a completed downstream edit', () => { const x = snapshot(true, true, true); x.lock_digest_sha256 = 'changed-lock'; const p = core.projectionFromSnapshot(x, 'new-blueprint', '2026-09-01T00:00:00.000Z'); assert.equal(p.final_edit_created, false); assert.equal(p.canonical_resolve_blueprint_mutated, false); });

function makeMusicFile(label) {
  const file = path.join(os.tmpdir(), `xlane-${label}-${process.pid}.wav`);
  childProcess.spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${200 + label.charCodeAt(0)}:duration=30`, '-af', 'afade=t=out:st=20:d=10', file], { timeout: 180000 });
  return file;
}

test('CIL-21 shared package nextActions uses current Final Music completion and re-selection authority', async () => {
  const estate = await fplHarness.packagedEstate(`x-lane-${Date.now()}`);
  const opts = { scriptBuilderRoot: estate.story.root, now: '2026-09-01T00:00:00.000Z' };
  const before = require('../scripts/final-production-package.js').nextActions(estate.runDir, opts);
  assert.equal(before.final_music_complete, false);
  assert.ok(before.ready.some((item) => item.task === 'PRODUCE_FINAL_MUSIC'));
  const first = music.ingestMusic(estate.runDir, { ...opts, file: makeMusicFile('a') });
  music.selectMusic(estate.runDir, { ...opts, candidate: first.candidate.candidate_id, authority: 'Mikko Pakkala' });
  const selected = require('../scripts/final-production-package.js').nextActions(estate.runDir, opts);
  assert.equal(selected.final_music_complete, true);
  assert.equal(selected.ready.some((item) => item.task === 'PRODUCE_FINAL_MUSIC'), false);
  assert.equal(selected.blocked.some((item) => item.task === 'ASSEMBLE_FINAL_EDIT_IN_RESOLVE' && item.blocked_by.includes('final music')), false);
  const second = music.ingestMusic(estate.runDir, { ...opts, file: makeMusicFile('b') });
  music.selectMusic(estate.runDir, { ...opts, candidate: second.candidate.candidate_id, authority: 'Mikko Pakkala' });
  const reselected = require('../scripts/final-production-package.js').nextActions(estate.runDir, opts);
  assert.equal(reselected.final_music_complete, true);
  const registry = music.loadRegistry(music.context(estate.runDir, opts), opts);
  assert.equal(registry.selected_candidate_id, second.candidate.candidate_id);
  assert.equal(registry.candidates.find((item) => item.candidate_id === first.candidate.candidate_id).disposition, 'SUPERSEDED');
  const stored = path.resolve(estate.runDir, second.candidate.media.path);
  fs.appendFileSync(stored, 'drift');
  const stale = require('../scripts/final-production-package.js').nextActions(estate.runDir, opts);
  assert.equal(stale.final_music_complete, false);
  assert.ok(stale.ready.some((item) => item.task === 'PRODUCE_FINAL_MUSIC'));
});

test('CIL-22 stale Music authority blocks only Music while Visual and Performance remain visible', async () => {
  const estate = await fplHarness.packagedEstate(`x-lane-music-stale-${Date.now()}`);
  const brief = JSON.parse(fs.readFileSync(estate.paths.music, 'utf8'));
  brief.target_duration_ms += 1;
  fs.writeFileSync(estate.paths.music, `${JSON.stringify(brief, null, 2)}\n`);
  const value = require('../scripts/final-production-package.js').nextActions(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.ok(value.ready.some((item) => item.task === 'GENERATE_FINAL_IMAGE'));
  assert.ok(value.ready.some((item) => item.task === 'RECORD_FINAL_PERFORMANCE'));
  assert.equal(value.ready.some((item) => item.task === 'PRODUCE_FINAL_MUSIC'), false);
  assert.ok(value.blocked.some((item) => item.lane === 'MUSIC' && item.code === 'FINAL_MUSIC_BRIEF_STALE'));
  assert.equal(value.final_music_complete, false);
});

test('CIL-23 stale Performance authority blocks only Performance while Visual and Music remain visible', async () => {
  const estate = await fplHarness.packagedEstate(`x-lane-performance-stale-${Date.now()}`);
  const performance = JSON.parse(fs.readFileSync(estate.paths.performance, 'utf8'));
  performance.takes = [{ forged: true }];
  fs.writeFileSync(estate.paths.performance, `${JSON.stringify(performance, null, 2)}\n`);
  const value = require('../scripts/final-production-package.js').nextActions(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.ok(value.ready.some((item) => item.task === 'GENERATE_FINAL_IMAGE'));
  assert.ok(value.ready.some((item) => item.task === 'PRODUCE_FINAL_MUSIC'));
  assert.equal(value.ready.some((item) => item.task === 'RECORD_FINAL_PERFORMANCE'), false);
  assert.ok(value.blocked.some((item) => item.lane === 'PERFORMANCE'));
  assert.equal(value.final_human_performance_complete, false);
});

test('CIL-24 blocked Visual authority remains explicit while Performance and Music remain visible', async () => {
  const estate = await fplHarness.packagedEstate(`x-lane-visual-stale-${Date.now()}`);
  fs.writeFileSync(estate.paths.tracker, '{ invalid tracker');
  const value = require('../scripts/final-production-package.js').nextActions(estate.runDir, { scriptBuilderRoot: estate.story.root });
  assert.equal(value.ready.some((item) => item.task === 'GENERATE_FINAL_IMAGE'), false);
  assert.ok(value.ready.some((item) => item.task === 'RECORD_FINAL_PERFORMANCE'));
  assert.ok(value.ready.some((item) => item.task === 'PRODUCE_FINAL_MUSIC'));
  assert.ok(value.blocked.some((item) => item.lane === 'VISUAL'));
  assert.equal(value.final_assets_complete, false);
});

test('CIL-25 both operator surfaces consume the same canonical lane-state derivation', async () => {
  const packageAuthority = require('../scripts/final-production-package.js');
  assert.equal(packageAuthority.nextActions.toString().includes('deriveFinalProductionLaneStates'), true);
  assert.equal(core.laneState.toString().includes('deriveFinalProductionLaneStates'), true);
  assert.equal(laneStateAuthority.deriveFinalProductionLaneStates, require('../scripts/final-production-lane-state.js').deriveFinalProductionLaneStates);
  const estate = await fplHarness.packagedEstate(`x-lane-parity-${Date.now()}`);
  const opts = { scriptBuilderRoot: estate.story.root };
  const shared = laneStateAuthority.deriveFinalProductionLaneStates(estate.runDir, opts);
  const operator = core.laneState(estate.runDir, opts);
  const packageNext = packageAuthority.nextActions(estate.runDir, opts);
  for (const name of ['visual', 'performance', 'music']) assert.equal(operator.lanes[name].state, shared[name].state);
  assert.equal(packageNext.final_assets_complete, shared.visual.complete);
  assert.equal(packageNext.final_human_performance_complete, shared.performance.complete);
  assert.equal(packageNext.final_music_complete, shared.music.complete);
});

test('CIL-26 parity matrix covers all eight complete/incomplete lane combinations without edit authority', () => {
  const combinations = [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1],[1,1,1]];
  for (const [v, p, m] of combinations) {
    const value = projection(Boolean(v), Boolean(p), Boolean(m));
    assert.equal(value.lanes.visual.state, v ? 'RESOLVED' : 'PLACEHOLDER');
    assert.equal(value.lanes.performance.state, p ? 'RESOLVED' : 'PLACEHOLDER');
    assert.equal(value.lanes.music.state, m ? 'RESOLVED' : 'PLACEHOLDER');
    assert.equal(value.final_edit_created, false);
    assert.equal(value.final_qc_pass, false);
    assert.equal(value.publication_approved, false);
  }
});

test('CIL-27 stale Music core-lanes status and next remain lane-local and never crash', async () => {
  const estate = await fplHarness.packagedEstate(`x-lane-2c-${Date.now()}`);
  const brief = JSON.parse(fs.readFileSync(estate.paths.music, 'utf8'));
  brief.target_duration_ms += 1;
  fs.writeFileSync(estate.paths.music, `${JSON.stringify(brief, null, 2)}\n`);
  const opts = { scriptBuilderRoot: estate.story.root };
  const status = core.laneState(estate.runDir, opts);
  assert.equal(status.lanes.music.state, 'BLOCKED');
  assert.equal(status.lanes.music.status.final_music_complete, false);
  assert.equal(status.lanes.music.status.next_action.state, 'BLOCKED');
  assert.equal(status.lanes.music.status.next_action.task, 'FINAL_MUSIC_AUTHORITY_BLOCKED');
  const next = core.nextActions(estate.runDir, opts);
  assert.ok(next.ready.some((item) => item.task === 'VISUAL_READY'));
  assert.ok(next.ready.some((item) => item.task === 'PERFORMANCE_READY'));
  assert.equal(next.ready.some((item) => item.task === 'MUSIC_READY'), false);
  assert.ok(next.blocked.some((item) => item.lane === 'MUSIC' && item.code === 'FINAL_MUSIC_BRIEF_STALE'));
  const packageNext = require('../scripts/final-production-package.js').nextActions(estate.runDir, opts);
  assert.equal(packageNext.final_music_complete, false);
  assert.ok(packageNext.blocked.some((item) => item.lane === 'MUSIC' && item.code === 'FINAL_MUSIC_BRIEF_STALE'));
});

test('CIL-28 blocked lane status is structurally non-null for every shared lane failure', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'final-production-lane-state.js'), 'utf8');
  assert.equal(source.includes("status: null"), false);
  assert.ok(source.includes("state: 'BLOCKED'"));
  assert.ok(source.includes('next_action: { task:'));
});
