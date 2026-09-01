'use strict';

/*
 * Final Music Production certification.
 *
 * Fixtures reuse the promoted Final Production harness (real Story, real
 * Directed Draft, real KEEP approval, real lock, real package with its
 * lock-bound Final Music Brief) and then drive the Final music loop with real
 * ffmpeg-synthesized audio — exactly as Mikko would hand over a track he
 * rendered himself. Nothing in this suite dials a music model: PATH A is
 * certified with an injected transport, which is also why no real Final song
 * is produced here.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const fplHarness = require('./final-production-lock-package.test.js');
const pkgAuthority = require('../scripts/final-production-package.js');
const music = require('../scripts/final-music-production.js');
const cli = require('../scripts/final-music.js');

function shaFile(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); return f; }
function errorCode(fn, code) {
  let got = 'no throw';
  try { fn(); } catch (error) { got = error.code; }
  assert.equal(got, code, `expected ${code}, got ${got}`);
}
async function asyncErrorCode(fn, code) {
  let got = 'no throw';
  try { await fn(); } catch (error) { got = error.code; }
  assert.equal(got, code, `expected ${code}, got ${got}`);
}
const HUMAN = 'Mikko Pakkala';

/* ── real audio fixtures ─────────────────────────────────────────────────── */

function ffmpeg(args) {
  const result = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 180000 });
  assert.equal(result.status, 0, `ffmpeg fixture failed: ${(result.stderr || '').toString().slice(0, 200)}`);
}
let mediaRoot = null;
function media() {
  if (!mediaRoot) mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'final-music-media-'));
  return mediaRoot;
}
/* Distinct bytes per fixture: identical bytes are deliberately treated as the
 * same candidate, so a shared recipe would test deduplication, not the loop. */
const RECIPES = Object.freeze({
  /* ending classes, verified empirically against the reused Draft classifier */
  clean: { hz: 200, seconds: 30, fade: 'afade=t=out:st=20:d=10' }, // CLEAN_END
  longfade: { hz: 190, seconds: 30, fade: 'afade=t=out:st=12:d=18' }, // FADE_ACCEPTABLE
  abrupt: { hz: 210, seconds: 30, fade: null }, // ABRUPT_END
  truncated: { hz: 240, seconds: 12, fade: null }, // TRUNCATED (too few windows)
});
function makeTrack(label, recipeName = 'clean') {
  const recipe = RECIPES[recipeName];
  const file = path.join(media(), `${label}.wav`);
  if (fs.existsSync(file)) return file;
  /* the label perturbs the tone so every fixture has unique bytes */
  const offset = parseInt(crypto.createHash('sha256').update(label).digest('hex').slice(0, 2), 16) % 40;
  const chain = [`volume=-8dB`, `tremolo=f=0.3:d=0.45`];
  if (recipe.fade) chain.push(recipe.fade);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${recipe.hz + offset}:duration=${recipe.seconds}`, '-af', chain.join(','), file]);
  return file;
}
function makeSilentTrack(label) {
  const file = path.join(media(), `${label}.wav`);
  if (!fs.existsSync(file)) ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo:d=30', file]);
  return file;
}
function makeFlac(label) {
  const wav = makeTrack(`${label}-src`, 'clean');
  const file = path.join(media(), `${label}.flac`);
  if (!fs.existsSync(file)) ffmpeg(['-i', wav, file]);
  return file;
}
function makeCorrupt(label) {
  const file = path.join(media(), `${label}.wav`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(4000));
  return file;
}
function makeEmpty(label) {
  const file = path.join(media(), `${label}.wav`);
  fs.writeFileSync(file, Buffer.alloc(0));
  return file;
}
function makeImage(label) {
  const file = path.join(media(), `${label}.png`);
  if (!fs.existsSync(file)) ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x336699:s=64x64', '-frames:v', '1', file]);
  return file;
}

/* ── estates ─────────────────────────────────────────────────────────────── */

async function estateFor(label) {
  const estate = await fplHarness.packagedEstate(`fm-${label}`);
  return { ...estate, opts: { scriptBuilderRoot: estate.story.root } };
}
/* An injected Final-stage generator: it stands in for the Stable Audio
 * transport and does nothing but place bytes where it was told to. */
function generatorFor(map) {
  return async ({ concept, outputFile, promptBundle, renderBrief }) => {
    assert.ok(promptBundle.prompt_sha256, 'the generator must receive a real prompt');
    assert.ok(renderBrief.brief_id.startsWith('final-music-'), 'the generator must receive the Final render brief');
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.copyFileSync(map[concept.candidate_slot], outputFile);
    return { outputFile };
  };
}

/* ── §6 the Final Music Brief is consumed, not reinvented ────────────────── */

test('FM01 the Final music authority consumes the existing lock-bound Final Music Brief', async () => {
  const e = await estateFor('brief');
  const ctx = music.context(e.runDir, e.opts);
  assert.equal(ctx.brief.schema, pkgAuthority.MUSIC_SCHEMA);
  assert.equal(ctx.brief.state, 'REQUIRED');
  assert.equal(ctx.brief.final_music_authority, false);
  assert.equal(ctx.brief.draft_music_is_not_promoted.draft_reference_use, 'INSPIRATION_ONLY');
  assert.equal(ctx.brief.lock_digest_sha256, ctx.lock.lock_digest_sha256);
  assert.equal(ctx.briefSha256, e.built.package.components.final_music_brief.sha256);
  /* the brief is consumed as-is: no second brief artifact is minted */
  const before = shaFile(e.paths.music);
  music.musicStatus(e.runDir, e.opts);
  assert.equal(shaFile(e.paths.music), before, 'the Final Music Brief must not be rewritten');
});

test('FM02 the render brief is derived from the Final Music Brief and satisfies the shared MusicRenderBrief contract', async () => {
  const e = await estateFor('renderbrief');
  const ctx = music.context(e.runDir, e.opts);
  const rb = music.renderBriefFor(ctx);
  const contract = require('../score-engine/music-render-brief.js');
  assert.deepEqual(contract.validateMusicRenderBrief(rb), [], 'the derived brief must satisfy the canonical contract');
  assert.equal(rb.mix_role, 'underlay');
  assert.equal(rb.ending, 'clear-button');
  assert.equal(rb.target_duration_s, Math.round(ctx.brief.target_duration_ms / 1000));
  assert.equal(rb.sections.length, (ctx.brief.music_function_map || []).length);
  assert.ok(rb.avoid.length, 'narration compatibility carries into the render brief');
});

test('FM03 the three Final concepts differ on at least the canonical number of major axes', async () => {
  const analysis = require('../scripts/draft-music-analysis.js');
  const concepts = music.finalConcepts(3);
  assert.equal(concepts.length, 3);
  for (let i = 0; i < concepts.length; i += 1) {
    for (let j = i + 1; j < concepts.length; j += 1) {
      const diff = analysis.majorAxisDifference(concepts[i].diversity_vector, concepts[j].diversity_vector);
      assert.ok(diff >= analysis.DIVERSITY_MIN_MAJOR_DIFF, `${i}/${j} differ on only ${diff} major axes`);
    }
  }
  errorCode(() => music.finalConcepts(9), 'FINAL_MUSIC_CANDIDATE_COUNT_INVALID');
});

/* ── §35 PATH A — generated Final candidates ─────────────────────────────── */

test('FM04 generation mints three fresh Final-stage candidates, none of them selected', async () => {
  const e = await estateFor('generate');
  const result = await music.generateFinalCandidates(e.runDir, {
    ...e.opts,
    generator: generatorFor({
      A: makeTrack('gen-a', 'clean'), B: makeTrack('gen-b', 'longfade'), C: makeTrack('gen-c', 'clean'),
    }),
  });
  assert.equal(result.state, 'CANDIDATES_GENERATED');
  assert.equal(result.model, 'stable_audio_3_medium', 'STABLE_AUDIO_FIRST is the normal Final generator');
  assert.equal(result.routing_policy, 'STABLE_AUDIO_FIRST');
  assert.equal(result.candidates.length, 3);
  for (const candidate of result.candidates) {
    assert.equal(candidate.schema, music.CANDIDATE_SCHEMA);
    assert.equal(candidate.source_type, 'GENERATED');
    assert.equal(candidate.selected, false, 'HOSTILE 20: a generated candidate is never auto-selected');
    assert.equal(candidate.disposition, 'CANDIDATE');
    assert.equal(candidate.final_music_authority, false);
    assert.equal(candidate.provenance.model, 'stable_audio_3_medium');
    assert.ok(candidate.provenance.prompt_sha256, 'the render prompt identity is bound');
    assert.ok(candidate.provenance.concept_label, 'the concept is bound');
    assert.equal(candidate.provenance.inherited_authority, false);
  }
  const status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, false, 'HOSTILE 24: generation alone never completes Final music');
  assert.equal(status.counts.generated, 3);
  assert.equal(status.counts.selections_made, 0);
  assert.equal(status.next_action.task, 'SELECT_FINAL_MUSIC');
  assert.equal(status.next_action.state, 'MIKKO_DECISION');
});

test('FM05 a human selection over the generated set is what creates Final music authority', async () => {
  const e = await estateFor('generate-select');
  const generated = await music.generateFinalCandidates(e.runDir, {
    ...e.opts,
    generator: generatorFor({
      A: makeTrack('gs-a', 'clean'), B: makeTrack('gs-b', 'longfade'), C: makeTrack('gs-c', 'clean'),
    }),
  });
  const b = generated.candidates.find((item) => item.candidate_slot === 'B');
  const selected = music.selectMusic(e.runDir, { ...e.opts, candidate: 'B', authority: HUMAN });
  assert.equal(selected.state, 'FINAL_MUSIC_SELECTED');
  assert.equal(selected.candidate.candidate_id, b.candidate_id);
  assert.equal(selected.selection.schema, music.SELECTION_SCHEMA);
  assert.equal(selected.selection.authority.type, 'HUMAN');
  assert.equal(selected.selection.authority.id, HUMAN);
  assert.equal(selected.selection.final_music_authority, true);
  assert.equal(selected.selection.machine_selection, false);
  assert.equal(selected.selection.draft_music_promoted, false);
  assert.ok(selected.selection.selection_digest_sha256);
  const status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, true);
  assert.equal(status.final_music_state, 'FINAL_MUSIC_SELECTED');
  assert.deepEqual(status.blocking_reasons, []);
  assert.equal(status.selected.candidate_id, b.candidate_id);
});

/* ── §36 PATH B — manual / external ingest ───────────────────────────────── */

test('FM06 a manually produced track is registered as a candidate and is not selected', async () => {
  const e = await estateFor('manual');
  const file = makeTrack('manual-track', 'longfade');
  const result = music.ingestMusic(e.runDir, { ...e.opts, file });
  assert.equal(result.state, 'REGISTERED');
  const c = result.candidate;
  assert.equal(c.source_type, 'MANUAL_EXTERNAL');
  assert.equal(c.provenance.generated_by, 'HUMAN_SUPPLIED_FILE');
  assert.equal(c.sha256, shaFile(file), 'the hash is computed, never supplied');
  assert.equal(c.media.codec, 'pcm_s16le');
  assert.equal(c.media.sample_rate, 44100);
  assert.ok(c.media.duration_s > 0);
  assert.ok(Number.isFinite(c.media.integrated_lufs), 'loudness is measured through the existing probe layer');
  assert.equal(c.selected, false, 'ingest alone is never a selection');
  assert.equal(c.disposition, 'CANDIDATE');
  assert.equal(c.final_music_authority, false);
  const status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, false, 'HOSTILE 24: ingest alone never completes Final music');
  assert.equal(status.counts.manual_external, 1);
});

test('FM07 the manual track reaches Final authority through exactly the same selection path', async () => {
  const e = await estateFor('manual-select');
  const file = makeTrack('manual-sel', 'longfade');
  const ingested = music.ingestMusic(e.runDir, { ...e.opts, file });
  const selected = music.selectMusic(e.runDir, { ...e.opts, candidate: ingested.candidate.sha256.slice(0, 12), authority: HUMAN });
  assert.equal(selected.selection.schema, music.SELECTION_SCHEMA, 'one selection schema for both paths');
  assert.equal(selected.selection.source_type, 'MANUAL_EXTERNAL');
  assert.equal(selected.selection.final_music_authority, true);
  const completion = music.finalMusicComplete(music.context(e.runDir, e.opts), music.loadRegistry(music.context(e.runDir, e.opts)));
  assert.equal(completion.complete, true);
  /* no parallel manual subsystem exists */
  const paths = music.musicPaths(e.runDir);
  assert.ok(fs.existsSync(paths.registry), 'one registry');
  assert.ok(fs.existsSync(paths.selection), 'one selection manifest');
  assert.equal(fs.existsSync(path.join(paths.base, 'manual-selection.json')), false);
});

test('FM08 supported music containers reuse the existing probe layer', async () => {
  const e = await estateFor('formats');
  const flac = music.ingestMusic(e.runDir, { ...e.opts, file: makeFlac('fmt') });
  assert.equal(flac.candidate.media.codec, 'flac');
  assert.ok(flac.candidate.media.path.endsWith('.flac'));
  assert.ok(music.AUDIO_CODECS.includes('mp3') && music.AUDIO_CODECS.includes('aac'));
});

/* ── §37 mixed candidate set ─────────────────────────────────────────────── */

test('FM09 generated and manual candidates converge into one registry with one selection mechanism', async () => {
  const e = await estateFor('mixed');
  await music.generateFinalCandidates(e.runDir, {
    ...e.opts, count: 1, generator: generatorFor({ A: makeTrack('mix-a', 'longfade') }),
  });
  const manual = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('mix-b-reaper', 'clean'), slot: 'B' });
  const other = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('mix-c-other', 'longfade'), slot: 'C' });
  const registry = music.loadRegistry(music.context(e.runDir, e.opts));
  assert.equal(registry.candidates.length, 3, 'one registry holds every origin');
  assert.deepEqual(registry.candidates.map((item) => item.source_type), ['GENERATED', 'MANUAL_EXTERNAL', 'MANUAL_EXTERNAL']);
  const list = music.listCandidates(e.runDir, e.opts);
  assert.equal(list.candidates.length, 3);
  /* one selection mechanism: the manual REAPER render selects exactly like the generated one */
  const selected = music.selectMusic(e.runDir, { ...e.opts, candidate: manual.candidate.candidate_id, authority: HUMAN });
  assert.equal(selected.selection.candidate_id, manual.candidate.candidate_id);
  assert.equal(music.musicStatus(e.runDir, e.opts).final_music_complete, true);
  assert.ok(other.candidate.candidate_id, 'the third candidate is untouched');
});

/* ── §27 audition convenience ────────────────────────────────────────────── */

test('FM10 list exposes audition paths and diagnostics without any filesystem archaeology', async () => {
  const e = await estateFor('audition');
  music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('aud-a', 'longfade'), slot: 'A' });
  music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('aud-b', 'abrupt'), slot: 'B' });
  const list = music.listCandidates(e.runDir, e.opts);
  for (const item of list.candidates) {
    assert.ok(path.isAbsolute(item.audition_path), 'a directly playable absolute path');
    assert.ok(fs.existsSync(item.audition_path));
    assert.ok(item.sha_short.length === 12, 'a short id for the operator, full sha kept separately');
    assert.ok(item.acceptance && item.coherence_class && item.ending_class);
  }
  assert.equal(list.selection_is_human_only, true);
  assert.equal(list.candidates[0].slot, 'A');
  assert.equal(list.candidates[1].slot, 'B');
});

/* ── §9/§10 acceptance model and advisory diagnostics ───────────────────── */

test('FM11 the Final acceptance model separates auditionable, technically valid and both rejections', async () => {
  const e = await estateFor('acceptance');
  const good = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('acc-good', 'longfade'), slot: 'A' });
  const abrupt = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('acc-abrupt', 'abrupt'), slot: 'B' });
  const silent = music.ingestMusic(e.runDir, { ...e.opts, file: makeSilentTrack('acc-silent'), slot: 'C' });
  assert.equal(good.candidate.acceptance, 'AUDITIONABLE_FINAL_CANDIDATE');
  assert.equal(abrupt.candidate.acceptance, 'TECHNICALLY_VALID');
  assert.equal(silent.candidate.acceptance, 'REJECT_COHERENCE');
  /* DRAFT_MUSIC_USABLE is explicitly NOT the Final bar */
  assert.equal(music.ACCEPTANCE.includes('DRAFT_MUSIC_USABLE'), false);
  for (const item of [good, abrupt, silent]) {
    assert.equal(item.candidate.machine_recommendation_only, true);
    assert.equal(item.candidate.coherence_diagnostics.note.includes('never selects'), true);
  }
  /* truncated media is a hard technical failure at the Final stage */
  const truncated = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('acc-trunc', 'truncated'), slot: 'D' });
  assert.equal(truncated.candidate.acceptance, 'REJECT_TECHNICAL');
  assert.equal(truncated.candidate.technical_qc.technically_valid, false);
  assert.equal(truncated.candidate.technical_qc.ending_class, 'TRUNCATED');
});

test('FM12 all four ending classes are diagnosed, and only truncation is fatal', async () => {
  const e = await estateFor('endings');
  const seen = {};
  const specs = [['clean', 'A'], ['longfade', 'B'], ['abrupt', 'C'], ['truncated', 'D']];
  for (const [recipe, slot] of specs) {
    const result = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack(`end-${recipe}`, recipe), slot });
    seen[result.candidate.technical_qc.ending_class] = result.candidate.acceptance;
  }
  assert.equal(seen.CLEAN_END, 'AUDITIONABLE_FINAL_CANDIDATE');
  assert.equal(seen.FADE_ACCEPTABLE, 'AUDITIONABLE_FINAL_CANDIDATE');
  assert.equal(seen.ABRUPT_END, 'TECHNICALLY_VALID', 'abrupt is penalised, not vetoed');
  assert.equal(seen.TRUNCATED, 'REJECT_TECHNICAL', 'truncated media is technically invalid');
  /* the ending verdict is about the music, not about matching the programme length */
  const ctx = music.context(e.runDir, e.opts);
  const inspection = music.inspectAudio(makeTrack('end-clean', 'clean'), Math.round(ctx.brief.target_duration_ms / 1000));
  assert.equal(inspection.ending_class, 'CLEAN_END');
  assert.ok(inspection.failures.includes('DRAFT_MUSIC_TOO_SHORT'), 'length drift is reported');
  assert.equal(inspection.failures.includes('DRAFT_MUSIC_TRUNCATED_ENDING'), false, 'length drift is not truncation');
  /* and no DRAFT_* code leaks into the Final candidate record the operator sees */
  const assessed = music.assessCandidate(inspection, music.coherenceFor(makeTrack('end-clean', 'clean'), inspection, {}));
  assert.ok(assessed.warnings.includes('FINAL_MUSIC_SHORTER_THAN_PROGRAMME'));
  assert.equal(assessed.warnings.some((w) => w.startsWith('DRAFT_')), false, 'Final authority data must not carry DRAFT_ codes');
  assert.equal(music.finalWarningName('DRAFT_MUSIC_TOO_LONG'), 'FINAL_MUSIC_LONGER_THAN_PROGRAMME');
});

test('FM13 Mikko can knowingly select an abrupt-but-valid track, and the warning survives the decision', async () => {
  const e = await estateFor('abrupt-select');
  const abrupt = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('abr-sel', 'abrupt') });
  assert.ok(abrupt.candidate.technical_qc.warnings.includes('FINAL_MUSIC_ENDING_ABRUPT_END'));
  const selected = music.selectMusic(e.runDir, { ...e.opts, candidate: abrupt.candidate.candidate_id, authority: HUMAN });
  assert.equal(selected.selection.final_music_authority, true, 'the machine does not override an explicit human choice');
  assert.ok(selected.selection.warnings_at_selection.includes('FINAL_MUSIC_ENDING_ABRUPT_END'), 'the warning is preserved, not erased');
  assert.equal(music.musicStatus(e.runDir, e.opts).final_music_complete, true);
});

test('FM14 a coherence rejection is a strong opinion, not a veto — but it can never be silent', async () => {
  const e = await estateFor('coherence-override');
  const silent = music.ingestMusic(e.runDir, { ...e.opts, file: makeSilentTrack('coh-silent') });
  assert.equal(silent.candidate.acceptance, 'REJECT_COHERENCE');
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: silent.candidate.candidate_id, authority: HUMAN }),
    'FINAL_MUSIC_COHERENCE_REJECTION_UNACKNOWLEDGED');
  const forced = music.selectMusic(e.runDir, {
    ...e.opts, candidate: silent.candidate.candidate_id, authority: HUMAN, acknowledgeCoherenceRejection: true,
  });
  assert.equal(forced.selection.final_music_authority, true);
  assert.equal(forced.selection.selection_history.at(-1).coherence_rejection_acknowledged, true, 'the override is recorded');
});

test('FM15 machine diagnostics rank and recommend but the recommendation is never a selection', async () => {
  const e = await estateFor('recommend');
  music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('rec-a', 'abrupt'), slot: 'A' });
  music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('rec-b', 'longfade'), slot: 'B' });
  const status = music.musicStatus(e.runDir, e.opts);
  assert.ok(status.recommendation, 'a recommendation exists');
  assert.equal(status.recommendation.candidate_slot, 'B', 'the auditionable candidate ranks above the abrupt one');
  assert.equal(status.recommendation.is_selection, false);
  assert.ok(status.recommendation.note.includes('not a selection'));
  assert.equal(status.final_music_complete, false, 'HOSTILE 22: the highest-ranked candidate is not selected');
  assert.equal(status.selected, null);
  /* HOSTILE 21: neither is the newest one */
  assert.equal(music.loadRegistry(music.context(e.runDir, e.opts)).selected_candidate_id, null);
});

/* ── §38 re-selection ────────────────────────────────────────────────────── */

test('FM16 re-selection makes the old choice historical, the new one current, and rewrites nothing', async () => {
  const e = await estateFor('reselect');
  const a = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('res-a', 'longfade'), slot: 'A' });
  const c = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('res-c', 'clean'), slot: 'C' });
  const first = music.selectMusic(e.runDir, { ...e.opts, candidate: 'A', authority: HUMAN });
  const firstProjection = music.projectResolveMusic(e.runDir, e.opts);
  assert.equal(firstProjection.projection.music_track.candidate_id, a.candidate.candidate_id);

  const second = music.selectMusic(e.runDir, { ...e.opts, candidate: 'C', authority: HUMAN });
  assert.equal(second.selection.selection_index, 2);
  assert.equal(second.selection.previous_selection.candidate_id, a.candidate.candidate_id);
  assert.equal(second.selection.previous_selection.state, 'SUPERSEDED');
  const registry = music.loadRegistry(music.context(e.runDir, e.opts));
  const oldEntry = registry.candidates.find((item) => item.candidate_id === a.candidate.candidate_id);
  const newEntry = registry.candidates.find((item) => item.candidate_id === c.candidate.candidate_id);
  assert.equal(oldEntry.disposition, 'SUPERSEDED', 'HOSTILE 33: the old selection is not still current');
  assert.equal(oldEntry.selected, false);
  assert.equal(newEntry.disposition, 'SELECTED');
  assert.equal(registry.selected_candidate_id, c.candidate.candidate_id);
  assert.equal(registry.selection_history.length, 2, 'both selections are preserved');
  assert.equal(registry.selection_history[0].candidate_id, a.candidate.candidate_id);
  /* the superseded media is still on disk and still readable */
  assert.ok(fs.existsSync(path.resolve(e.runDir, oldEntry.media.path)));
  /* the earlier immutable selection record is not rewritten */
  assert.equal(first.selection.candidate_id, a.candidate.candidate_id);
  /* projection follows the new selection; the old one is marked historical */
  const reprojected = music.projectResolveMusic(e.runDir, e.opts);
  assert.equal(reprojected.projection.music_track.candidate_id, c.candidate.candidate_id);
  const history = reprojected.projection.selection_history;
  assert.equal(history.find((item) => item.candidate_id === a.candidate.candidate_id).state, 'HISTORICAL');
  assert.equal(history.find((item) => item.candidate_id === c.candidate.candidate_id).state, 'CURRENT');
  /* HOSTILE 18: selecting the superseded candidate again is refused as such */
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: a.candidate.candidate_id, authority: HUMAN }),
    'FINAL_MUSIC_CANDIDATE_SUPERSEDED');
});

/* ── §39 rejection ───────────────────────────────────────────────────────── */

test('FM17 a rejected candidate is preserved forever and can never satisfy Final music', async () => {
  const e = await estateFor('reject');
  const b = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('rej-b', 'longfade') });
  const mediaFile = path.resolve(e.runDir, b.candidate.media.path);
  const rejected = music.rejectCandidate(e.runDir, { ...e.opts, candidate: b.candidate.candidate_id, authority: HUMAN, note: 'wrong mood' });
  assert.equal(rejected.candidate.disposition, 'REJECTED');
  assert.equal(rejected.candidate.disposition_note, 'wrong mood');
  assert.equal(rejected.candidate.disposition_authority.id, HUMAN);
  assert.ok(fs.existsSync(mediaFile), 'rejected media is never deleted');
  assert.ok(fs.existsSync(path.join(music.musicPaths(e.runDir).candidates, `${b.candidate.candidate_id}.json`)), 'the record survives');
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: b.candidate.candidate_id, authority: HUMAN }),
    'FINAL_MUSIC_CANDIDATE_REJECTED');
  const status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, false, 'HOSTILE 23: a rejected candidate cannot complete Final music');
  assert.equal(status.counts.human_rejected, 1);
  assert.equal(status.next_action.task, 'CREATE_FINAL_MUSIC_CANDIDATE');
  /* an alternate is kept available without being selected */
  const alt = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('rej-alt', 'clean'), slot: 'B' });
  const kept = music.keepAsAlternate(e.runDir, { ...e.opts, candidate: alt.candidate.candidate_id, authority: HUMAN });
  assert.equal(kept.candidate.disposition, 'KEEP_AS_ALTERNATE');
  assert.equal(kept.candidate.selected, false);
});

/* ── §5/§32 Draft music never escalates ─────────────────────────────────── */

test('FM18 the Draft winner cannot become Final music authority, and re-ingesting it inherits nothing', async () => {
  const e = await estateFor('draft-escalation');
  /* HOSTILE 13: the named "promote the Draft selection" operation always refuses */
  errorCode(() => music.promoteDraftSelection(e.runDir, e.opts), 'FINAL_MUSIC_DRAFT_ESCALATION_REFUSED');

  /* a Draft-selected track, complete with its Draft decision artifact */
  const draftFile = makeTrack('draft-winner', 'longfade');
  const draftDecision = {
    schema: 'vidtoolz.visualDraftMusicDecision.v1',
    draft_selected_music: true,
    final_music_authority: false,
    music_asset: { path: draftFile, sha256: shaFile(draftFile) },
  };
  assert.equal(draftDecision.final_music_authority, false, 'even the Draft artifact denies Final authority');

  /* HOSTILE 34: the same bytes may be re-ingested, but as a NEW candidate with
   * no inherited authority — and still unselected */
  const ingested = music.ingestMusic(e.runDir, {
    ...e.opts, file: draftFile, draftReference: { decision: draftDecision.schema, sha256: draftDecision.music_asset.sha256 },
  });
  assert.equal(ingested.candidate.source_type, 'MANUAL_EXTERNAL');
  assert.equal(ingested.candidate.provenance.inherited_authority, false);
  assert.ok(ingested.candidate.provenance.draft_reference, 'the Draft origin is recorded as provenance');
  assert.equal(ingested.candidate.selected, false);
  assert.equal(ingested.candidate.final_music_authority, false);
  assert.equal(ingested.candidate.disposition, 'CANDIDATE');
  assert.equal(music.musicStatus(e.runDir, e.opts).final_music_complete, false);
  assert.equal(music.musicStatus(e.runDir, e.opts).draft_music, 'INSPIRATION_ONLY');
  /* it becomes Final music only through an explicit human selection */
  const selected = music.selectMusic(e.runDir, { ...e.opts, candidate: ingested.candidate.candidate_id, authority: HUMAN });
  assert.equal(selected.selection.draft_music_promoted, false, 'this is a fresh Final selection, not a Draft promotion');
  assert.equal(selected.selection.authority.id, HUMAN);
});

/* ── §16/§33 human-only selection ───────────────────────────────────────── */

test('FM19 machine-shaped selection authorities are refused outright', async () => {
  const e = await estateFor('machine-selector');
  const c = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('mach-a', 'longfade') });
  const refused = ['MACHINE_SELECTOR', 'machine-ranker', 'auto-select', 'agent:claude', 'tool/final-music',
    'model_recommendation', 'bot', 'system', '', '   '];
  for (const authority of refused) {
    errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority }),
      'FINAL_MUSIC_HUMAN_AUTHORITY_REQUIRED');
  }
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id }),
    'FINAL_MUSIC_HUMAN_AUTHORITY_REQUIRED');
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority: 42 }),
    'FINAL_MUSIC_HUMAN_AUTHORITY_REQUIRED');
  /* rejection and role-style dispositions are human decisions too */
  errorCode(() => music.rejectCandidate(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority: 'auto' }),
    'FINAL_MUSIC_HUMAN_AUTHORITY_REQUIRED');
  assert.equal(music.musicStatus(e.runDir, e.opts).final_music_complete, false);
});

/* ── §29/§11 identity is computed, never asserted ───────────────────────── */

test('FM20 candidate identity binds the whole authority chain and refuses caller-asserted authority', async () => {
  const e = await estateFor('identity');
  const file = makeTrack('id-a', 'longfade');
  const result = music.ingestMusic(e.runDir, { ...e.opts, file });
  const c = result.candidate;
  const ctx = music.context(e.runDir, e.opts);
  assert.equal(c.lock_id, ctx.lock.lock_id);
  assert.equal(c.lock_digest_sha256, ctx.lock.lock_digest_sha256);
  assert.equal(c.final_music_brief_sha256, ctx.briefSha256, 'HOSTILE 32: manual ingest cannot bypass brief binding');
  assert.equal(c.locked_script_sha256, ctx.scriptSha256);
  assert.equal(c.final_production_package_digest_sha256, ctx.pkg.package_digest_sha256);
  assert.equal(c.sha256, shaFile(file));
  assert.ok(c.candidate_digest_sha256);
  assert.ok(c.provenance.original_filename);

  /* HOSTILE 7 + 31: the caller may not assert identity or authority */
  for (const forbidden of ['sha256', 'lock_digest_sha256', 'brief_sha256', 'selected', 'final_music_authority', 'acceptance', 'disposition']) {
    errorCode(() => music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('id-b', 'clean'), [forbidden]: 'forged' }),
      'FINAL_MUSIC_CALLER_AUTHORITY_REFUSED');
  }
  /* filename and location are not authority: the same bytes under a new name
   * are the same candidate */
  const renamed = path.join(media(), 'totally-different-name.wav');
  fs.copyFileSync(file, renamed);
  const again = music.ingestMusic(e.runDir, { ...e.opts, file: renamed });
  assert.equal(again.state, 'ALREADY_REGISTERED', 'HOSTILE 11: no duplicate candidate authority is minted');
  assert.equal(again.candidate.candidate_id, c.candidate_id);
  assert.equal(music.loadRegistry(ctx).candidates.length, 1);
});

test('FM21 unregistered, missing and mutated candidates are refused at selection', async () => {
  const e = await estateFor('candidate-integrity');
  const c = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('int-a', 'longfade') });
  /* HOSTILE 16 */
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: 'final-music-z-deadbeef', authority: HUMAN }),
    'FINAL_MUSIC_CANDIDATE_UNREGISTERED');
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: 'a'.repeat(64), authority: HUMAN }),
    'FINAL_MUSIC_CANDIDATE_UNREGISTERED');
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, authority: HUMAN }), 'FINAL_MUSIC_CANDIDATE_REQUIRED');
  /* HOSTILE 17: the registered bytes changed underneath */
  const stored = path.resolve(e.runDir, c.candidate.media.path);
  const original = fs.readFileSync(stored);
  fs.writeFileSync(stored, crypto.randomBytes(2048));
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority: HUMAN }),
    'FINAL_MUSIC_CANDIDATE_BYTES_CHANGED');
  fs.writeFileSync(stored, original);
  /* and a technically invalid candidate can never be selected */
  const truncated = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('int-trunc', 'truncated'), slot: 'B' });
  errorCode(() => music.selectMusic(e.runDir, { ...e.opts, candidate: truncated.candidate.candidate_id, authority: HUMAN }),
    'FINAL_MUSIC_CANDIDATE_TECHNICALLY_INVALID');
});

test('FM22 unusable media is refused with typed errors before anything is registered', async () => {
  const e = await estateFor('media-refusals');
  /* HOSTILE 8, 9, 10 */
  errorCode(() => music.ingestMusic(e.runDir, { ...e.opts, file: makeCorrupt('bad') }), 'FINAL_MUSIC_UNREADABLE');
  errorCode(() => music.ingestMusic(e.runDir, { ...e.opts, file: makeEmpty('empty') }), 'FINAL_MUSIC_FILE_EMPTY');
  errorCode(() => music.ingestMusic(e.runDir, { ...e.opts, file: makeImage('picture') }), 'FINAL_MUSIC_NO_AUDIO_STREAM');
  errorCode(() => music.ingestMusic(e.runDir, { ...e.opts, file: path.join(media(), 'does-not-exist.wav') }), 'FINAL_MUSIC_FILE_MISSING');
  errorCode(() => music.ingestMusic(e.runDir, { ...e.opts }), 'FINAL_MUSIC_FILE_REQUIRED');
  errorCode(() => music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('src-type', 'clean'), sourceType: 'MAGIC' }),
    'FINAL_MUSIC_SOURCE_TYPE_INVALID');
  assert.equal(music.loadRegistry(music.context(e.runDir, e.opts)).candidates.length, 0, 'nothing was registered');
});

/* ── §30/§31 stale authority fails closed ───────────────────────────────── */

test('FM23 a missing lock, a missing package and a wrong run all fail closed', async () => {
  /* HOSTILE 1, 4 */
  const noLock = await fplHarness.approvedEstate('fm-nolock');
  errorCode(() => music.musicStatus(noLock.runDir, { scriptBuilderRoot: noLock.story.root }), 'FINAL_MUSIC_LOCK_MISSING');
  errorCode(() => music.musicStatus('/tmp/definitely-not-a-run-dir-final-music'), 'FINAL_MUSIC_RUN_MISSING');
  const noPkg = await fplHarness.lockedEstate('fm-nopkg');
  errorCode(() => music.musicStatus(noPkg.runDir, { scriptBuilderRoot: noPkg.story.root }), 'FINAL_MUSIC_PACKAGE_MISSING');
});

test('FM24 a stale lock, a stale brief and a stale script all fail closed rather than being reinterpreted', async () => {
  const e = await estateFor('stale');
  const paths = pkgAuthority.packagePaths(e.runDir);

  /* HOSTILE 3 + 6: the brief bytes change after packaging */
  const briefBackup = fs.readFileSync(paths.music);
  const brief = readJson(paths.music);
  writeJson(paths.music, { ...brief, style_guidance: { ...brief.style_guidance, role: 'FORGED DIRECTION' } });
  errorCode(() => music.musicStatus(e.runDir, e.opts), 'FINAL_MUSIC_BRIEF_STALE');
  /* a fabricated brief bound to another lock is refused the same way */
  writeJson(paths.music, { ...brief, lock_digest_sha256: 'f'.repeat(64) });
  errorCode(() => music.musicStatus(e.runDir, e.opts), 'FINAL_MUSIC_BRIEF_STALE');
  fs.writeFileSync(paths.music, briefBackup);
  assert.equal(music.musicStatus(e.runDir, e.opts).final_music_state, 'REQUIRED', 'restoring the exact bytes restores authority');

  /* HOSTILE 2 + 5: the lock itself is tampered with */
  const lockFile = path.join(e.runDir, 'final-production-lock.json');
  const lockBackup = fs.readFileSync(lockFile);
  const lock = readJson(lockFile);
  writeJson(lockFile, { ...lock, lock_digest_sha256: 'a'.repeat(64) });
  const code = (() => { try { music.musicStatus(e.runDir, e.opts); return 'no throw'; } catch (error) { return error.code; } })();
  assert.ok(['FINAL_MUSIC_LOCK_STALE', 'FINAL_MUSIC_LOCK_MISSING'].includes(code), `forged lock must fail closed, got ${code}`);
  fs.writeFileSync(lockFile, lockBackup);

  /* HOSTILE 26/27: the package component bytes change */
  const scriptFile = paths.script;
  if (fs.existsSync(scriptFile)) {
    const scriptBackup = fs.readFileSync(scriptFile);
    writeJson(scriptFile, { ...readJson(scriptFile), forged: true });
    errorCode(() => music.musicStatus(e.runDir, e.opts), 'FINAL_MUSIC_SCRIPT_DRIFT');
    fs.writeFileSync(scriptFile, scriptBackup);
  }
});

test('FM25 a registry or selection from another lock or brief can never report completion', async () => {
  const e = await estateFor('stale-registry');
  const c = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('sr-a', 'longfade') });
  music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority: HUMAN });
  const paths = music.musicPaths(e.runDir);

  /* HOSTILE 12: the registry claims another lock */
  const registryBackup = fs.readFileSync(paths.registry);
  writeJson(paths.registry, { ...readJson(paths.registry), lock_digest_sha256: 'b'.repeat(64) });
  errorCode(() => music.musicStatus(e.runDir, e.opts), 'FINAL_MUSIC_REGISTRY_STALE');
  writeJson(paths.registry, { ...readJson(paths.registry), lock_digest_sha256: readJson(path.join(e.runDir, 'final-production-lock.json')).lock_digest_sha256, final_music_brief_sha256: 'c'.repeat(64) });
  errorCode(() => music.musicStatus(e.runDir, e.opts), 'FINAL_MUSIC_REGISTRY_STALE');
  fs.writeFileSync(paths.registry, registryBackup);

  /* HOSTILE 19: the selection manifest belongs to another lock */
  const selectionBackup = fs.readFileSync(paths.selection);
  writeJson(paths.selection, { ...readJson(paths.selection), lock_digest_sha256: 'd'.repeat(64) });
  let status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, false);
  assert.ok(status.blocking_reasons.includes('SELECTION_BELONGS_TO_ANOTHER_LOCK'));
  /* HOSTILE 18: a stale selection manifest against a newer registry */
  writeJson(paths.selection, { ...JSON.parse(selectionBackup.toString('utf8')), candidate_id: 'final-music-x-00000000' });
  status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, false);
  assert.ok(status.blocking_reasons.includes('SELECTION_MANIFEST_STALE'));
  /* a non-human authority in the manifest is not completion either */
  writeJson(paths.selection, { ...JSON.parse(selectionBackup.toString('utf8')), authority: { type: 'MACHINE', id: 'ranker' } });
  status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, false);
  assert.ok(status.blocking_reasons.includes('SELECTION_AUTHORITY_NOT_HUMAN'));
  fs.writeFileSync(paths.selection, selectionBackup);
  assert.equal(music.musicStatus(e.runDir, e.opts).final_music_complete, true);

  /* HOSTILE 25: once the lock is stale, completion cannot be read at all */
  const lockFile = path.join(e.runDir, 'final-production-lock.json');
  const lockBackup = fs.readFileSync(lockFile);
  writeJson(lockFile, { ...readJson(lockFile), lock_digest_sha256: 'e'.repeat(64) });
  let threw = false;
  try { music.musicStatus(e.runDir, e.opts); } catch { threw = true; }
  assert.equal(threw, true, 'a stale lock must not yield a completion verdict');
  fs.writeFileSync(lockFile, lockBackup);
});

test('FM26 selected media that disappears or changes drops completion back to false', async () => {
  const e = await estateFor('completion-integrity');
  const c = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('ci-a', 'longfade') });
  music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority: HUMAN });
  assert.equal(music.musicStatus(e.runDir, e.opts).final_music_complete, true);
  const stored = path.resolve(e.runDir, c.candidate.media.path);
  const backup = fs.readFileSync(stored);
  fs.writeFileSync(stored, crypto.randomBytes(1024));
  let status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, false);
  assert.ok(status.blocking_reasons.includes('SELECTED_MEDIA_BYTES_CHANGED'));
  fs.rmSync(stored);
  status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, false);
  assert.ok(status.blocking_reasons.includes('SELECTED_MEDIA_MISSING'));
  fs.writeFileSync(stored, backup);
  assert.equal(music.musicStatus(e.runDir, e.opts).final_music_complete, true);
});

/* ── §24/§25 derived Resolve projection ─────────────────────────────────── */

test('FM27 the Resolve music projection resolves the placeholder without mutating the blueprint', async () => {
  const e = await estateFor('projection');
  const paths = pkgAuthority.packagePaths(e.runDir);
  const blueprintBefore = shaFile(paths.blueprint);
  const blueprintBytes = fs.readFileSync(paths.blueprint);

  /* unselected: the placeholder stays unresolved */
  const empty = music.projectResolveMusic(e.runDir, e.opts);
  assert.equal(empty.projection.schema, music.PROJECTION_SCHEMA);
  assert.equal(empty.projection.music_track.state, 'AWAITING_FINAL_MUSIC_SELECTION');
  assert.equal(empty.projection.music_track.placeholder, true);
  assert.equal(empty.projection.music_track.sha256, null);
  assert.equal(empty.projection.final_music_complete, false);

  const c = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('proj-a', 'longfade') });
  music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority: HUMAN });
  const projected = music.projectResolveMusic(e.runDir, e.opts);
  const track = projected.projection.music_track;
  assert.equal(track.state, 'FINAL_MUSIC_SELECTED');
  assert.equal(track.placeholder, false);
  assert.equal(track.sha256, c.candidate.sha256);
  assert.equal(track.candidate_id, c.candidate.candidate_id);
  assert.ok(track.duration_s > 0);
  assert.ok(Number.isFinite(track.integrated_lufs));
  assert.ok(track.cue && track.cue.behaviour, 'cue behaviour is projected');
  assert.equal(track.role, 'DIALOGUE_SUBORDINATE_BED');
  assert.equal(projected.projection.blueprint_mutated, false);
  assert.equal(projected.projection.blueprint_sha256, blueprintBefore);

  /* HOSTILE 28: the canonical blueprint is byte-identical and lives elsewhere */
  assert.equal(shaFile(paths.blueprint), blueprintBefore);
  assert.deepEqual(fs.readFileSync(paths.blueprint), blueprintBytes);
  assert.notEqual(path.resolve(projected.path), path.resolve(paths.blueprint));

  /* §25 mix guidance is blueprint instruction, not a rendered mix */
  const guidance = projected.projection.mix_guidance;
  assert.ok(Number.isFinite(guidance.suggested_music_level_db));
  assert.ok(guidance.narration_ducking.includes('duck'));
  assert.ok(Number.isFinite(guidance.pause_lift_db));
  assert.ok(Array.isArray(guidance.section_transitions) && guidance.section_transitions.length);
  assert.equal(guidance.destructive_premix_performed, false);

  /* HOSTILE 29/30: no publication or QC authority emerges */
  assert.equal(projected.projection.final_edit_complete, false);
  assert.equal(projected.projection.final_qc_pass, false);
  assert.equal(projected.projection.publication_authority, false);
});

test('FM28 the lock, package, tracker and approved Draft are never mutated by the music lane', async () => {
  const e = await estateFor('nonmutation');
  const paths = pkgAuthority.packagePaths(e.runDir);
  const watched = {
    lock: path.join(e.runDir, 'final-production-lock.json'),
    package: paths.package,
    script: paths.script,
    performance: paths.performance,
    visual: paths.visual,
    tracker: paths.tracker,
    music: paths.music,
    blueprint: paths.blueprint,
  };
  const before = {};
  for (const [key, file] of Object.entries(watched)) if (fs.existsSync(file)) before[key] = shaFile(file);

  const c = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('nm-a', 'longfade') });
  music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('nm-b', 'clean'), slot: 'B' });
  music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority: HUMAN });
  music.rejectCandidate(e.runDir, { ...e.opts, candidate: 'B', authority: HUMAN });
  music.projectResolveMusic(e.runDir, e.opts);
  music.listCandidates(e.runDir, e.opts);
  music.musicStatus(e.runDir, e.opts);

  for (const [key, sha] of Object.entries(before)) {
    assert.equal(shaFile(watched[key]), sha, `${key} must not be mutated by Final music production`);
  }
  /* the visual tracker is untouched: the two lanes do not interfere */
  const tracker = readJson(paths.tracker);
  assert.equal(tracker.beats.filter((b) => b.state !== 'PROMPT_READY').length, 0);
});

/* ── §23 independent lanes ──────────────────────────────────────────────── */

test('FM29 Final music proceeds with zero visual assets and no selected performance', async () => {
  const e = await estateFor('lanes');
  const tracker = readJson(pkgAuthority.packagePaths(e.runDir).tracker);
  assert.equal(tracker.beats.every((b) => b.state === 'PROMPT_READY'), true, 'no visual work has been done');
  const performance = readJson(pkgAuthority.packagePaths(e.runDir).performance);
  assert.equal(performance.final_human_performance_complete, false, 'no performance is selected');

  const c = music.ingestMusic(e.runDir, { ...e.opts, file: makeTrack('lane-a', 'longfade') });
  const selected = music.selectMusic(e.runDir, { ...e.opts, candidate: c.candidate.candidate_id, authority: HUMAN });
  assert.equal(selected.selection.final_music_authority, true, 'music completes independently of the other lanes');
  const status = music.musicStatus(e.runDir, e.opts);
  assert.equal(status.final_music_complete, true);
  assert.ok(status.independent_lanes.final_visual_assets.includes('independent'));
  assert.ok(status.independent_lanes.final_human_performance.includes('independent'));
  /* and it does not grant the other lanes anything */
  assert.equal(readJson(pkgAuthority.packagePaths(e.runDir).performance).selected_take, null);
  assert.equal(readJson(pkgAuthority.packagePaths(e.runDir).performance).final_human_performance_complete, false);
  const pkgAuthorityBlock = readJson(pkgAuthority.packagePaths(e.runDir).package).authority;
  assert.equal(pkgAuthorityBlock.grants_final_performance_authority, false);
  assert.equal(pkgAuthorityBlock.grants_final_music_authority, false, 'the package itself never grants Final music authority — only a human selection does');
  assert.equal(pkgAuthorityBlock.publication_authority, false);
  assert.equal(pkgAuthorityBlock.final_qc_pass, false);
  assert.equal(status.publication_authority, false);
  assert.equal(status.final_edit_complete, false);
});

/* ── §8 generation policy ───────────────────────────────────────────────── */

test('FM30 Final generation is Stable-Audio-first, MiniMax is opt-in, and no Draft file is promoted into the set', async () => {
  const e = await estateFor('routing');
  await asyncErrorCode(() => music.generateFinalCandidates(e.runDir, { ...e.opts, model: 'minimax_music_3', generator: generatorFor({}) }),
    'FINAL_MUSIC_MINIMAX_REQUIRES_OPT_IN');
  await asyncErrorCode(() => music.generateFinalCandidates(e.runDir, { ...e.opts, model: 'suno_v9', generator: generatorFor({}) }),
    'FINAL_MUSIC_MODEL_UNSUPPORTED');
  await asyncErrorCode(() => music.generateFinalCandidates(e.runDir, e.opts), 'FINAL_MUSIC_GENERATOR_REQUIRED');
  const minimax = await music.generateFinalCandidates(e.runDir, {
    ...e.opts, count: 1, model: 'minimax_music_3', experimentalMinimax: true,
    generator: generatorFor({ A: makeTrack('routing-mm', 'longfade') }),
  });
  assert.equal(minimax.model, 'minimax_music_3');
  assert.equal(minimax.candidates[0].provenance.model, 'minimax_music_3');
  /* every generated candidate is a fresh Final identity, never a Draft attempt */
  for (const candidate of minimax.candidates) {
    assert.ok(candidate.candidate_id.startsWith('final-music-'));
    assert.equal(candidate.candidate_id.includes('draft'), false);
    assert.equal(candidate.provenance.generated_by, 'FINAL_STAGE_GENERATION');
  }
});

/* ── §26 CLI surface ────────────────────────────────────────────────────── */

test('FM31 the operator CLI covers the whole loop and refuses machine selection', async () => {
  const e = await estateFor('cli');
  assert.deepEqual(cli.COMMANDS, ['status', 'generate', 'ingest', 'list', 'select', 'reject', 'alternate', 'project', 'help']);
  errorCode(() => cli.parseArgs(['status']), 'FINAL_MUSIC_ARGUMENT_INVALID');
  errorCode(() => cli.parseArgs(['ingest', '--run-id', 'r']), 'FINAL_MUSIC_ARGUMENT_INVALID');
  errorCode(() => cli.parseArgs(['select', '--run-id', 'r', '--candidate', 'A']), 'FINAL_MUSIC_ARGUMENT_INVALID');
  errorCode(() => cli.parseArgs(['nonsense']), 'FINAL_MUSIC_COMMAND_INVALID');
  const args = cli.parseArgs(['select', '--run-id', 'r', '--candidate', 'A', '--authority', HUMAN, '--json']);
  assert.equal(args.authority, HUMAN);
  assert.equal(args.json, true);
  assert.ok(cli.usage().includes('INSPIRATION_ONLY'));

  const repo = path.resolve(e.runDir, '..', '..');
  const runId = path.basename(e.runDir);
  const status = await cli.run(['status', '--run-id', runId, '--repo', repo]);
  assert.ok(status.text.includes('FINAL MUSIC: REQUIRED'));
  assert.ok(status.text.includes('INSPIRATION_ONLY'));
  const ingested = await cli.run(['ingest', '--run-id', runId, '--repo', repo, '--file', makeTrack('cli-a', 'longfade')]);
  assert.ok(ingested.text.includes('registered is NOT selected'));
  const listed = await cli.run(['list', '--run-id', runId, '--repo', repo]);
  assert.ok(listed.text.includes('listen'));
  assert.ok(listed.text.includes('Selection is human-only'));
  const selected = await cli.run(['select', '--run-id', runId, '--repo', repo, '--candidate', 'A', '--authority', HUMAN]);
  assert.ok(selected.text.includes('FINAL MUSIC SELECTED'));
  assert.ok(selected.text.includes(`HUMAN:${HUMAN}`));
  const projected = await cli.run(['project', '--run-id', runId, '--repo', repo]);
  assert.ok(projected.text.includes('NOT mutated'));
});

module.exports = { tests: require('./_helpers.js').tests };
