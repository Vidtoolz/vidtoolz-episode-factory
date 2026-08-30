'use strict';

/*
 * Final paused narration: click-free silence insertion over hermetic unit
 * audio (no Piper dependency — the synthesis seam is injected). Words are
 * proven immutable; the paused timeline is the timing authority.
 */
const { assert, test, fs, os, path } = require('./_helpers.js');
const { execFileSync } = require('node:child_process');
const pausedNarration = require('../scripts/paused-narration.js');
const planner = require('../scripts/natural-pause-planner.js');

const SECTIONS = [
  { section_id: 'S1', order: 1, text: 'Authorship is a claim about decisions. Most people think it is a claim about labor. But the two have never been the same thing.' },
  { section_id: 'S2', order: 2, text: 'The answer is habit. Which means it can change.' },
];

function fakeRenderer(text, outputPath) {
  // Deterministic hermetic speech stand-in: duration scales with word count.
  const durationSeconds = Math.max(0.4, planner.words(text).length * 0.12);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
    '-t', durationSeconds.toFixed(3), '-ac', '1', '-c:a', 'pcm_s24le', outputPath], { timeout: 60000 });
  return { fake: true };
}

function build(overrides = {}) {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paused-narration-'));
  const plan = overrides.plan || planner.planPauses(SECTIONS);
  return { manifest: pausedNarration.buildPausedNarration({ sections: overrides.sections || SECTIONS, plan, mediaDir }, { renderUnit: fakeRenderer }), plan, mediaDir };
}

let shared = null;
function sharedBuild() { if (!shared) shared = build(); return shared; }

test('PN1 speech units are whole sentences split only at planned pauses', () => {
  const plan = planner.planPauses(SECTIONS);
  const units = pausedNarration.buildSpeechUnits(SECTIONS, plan);
  assert.ok(units.length >= SECTIONS.length);
  for (const unit of units) assert.ok(unit.text.length > 0);
  const proof = pausedNarration.verifyWordSequence(SECTIONS, units);
  assert.equal(proof.ok, true);
  for (const section of proof.sections) assert.equal(section.original_words_sha256, section.reassembled_words_sha256);
});

test('PN2 assembled narration measures base speech + inserted pauses exactly', () => {
  const { manifest } = sharedBuild();
  assert.equal(manifest.schema, 'vidtoolz.finalPausedNarration.v1');
  assert.equal(manifest.timing_authority, 'FINAL_PAUSED_NARRATION');
  assert.ok(manifest.pause_count >= 1);
  const expected = manifest.base_duration_seconds + manifest.total_added_pause_seconds;
  assert.ok(Math.abs(manifest.final_duration_seconds - expected) <= 0.05, `${manifest.final_duration_seconds} vs ${expected}`);
  assert.ok(manifest.final_duration_seconds > manifest.base_duration_seconds, 'pauses add real duration');
});

test('PN3 every pause is ~0.5 s with typed metadata and measured timeline position', () => {
  const { manifest } = sharedBuild();
  for (const pause of manifest.pauses) {
    assert.ok(Math.abs(pause.duration_seconds - 0.5) < 0.02, String(pause.duration_seconds));
    assert.ok(pause.category && pause.reason);
    assert.ok(pause.end_seconds > pause.start_seconds);
  }
  assert.equal(manifest.max_pause_seconds >= manifest.median_pause_seconds, true);
});

test('PN4 paused sections are contiguous from zero and cover the full audio', () => {
  const { manifest } = sharedBuild();
  let cursor = 0;
  for (const section of manifest.sections) {
    assert.equal(section.in_ms, cursor);
    assert.ok(section.out_ms > section.in_ms);
    cursor = section.out_ms;
  }
  assert.ok(Math.abs(cursor - manifest.final_duration_seconds * 1000) <= 60, `${cursor} vs ${manifest.final_duration_seconds * 1000}`);
});

test('PN5 audio is hash-bound at the project standard', () => {
  const { manifest } = sharedBuild();
  assert.match(manifest.audio.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.audio.sample_rate, 48000);
  assert.equal(manifest.audio.channels, 1);
  assert.ok(fs.existsSync(manifest.audio.path));
});

test('PN6 word mutation in a unit fails the build closed', () => {
  const plan = planner.planPauses(SECTIONS);
  const units = pausedNarration.buildSpeechUnits(SECTIONS, plan);
  units[0] = { ...units[0], text: units[0].text.replace('Authorship', 'Ownership') };
  const proof = pausedNarration.verifyWordSequence(SECTIONS, units);
  assert.equal(proof.ok, false);
  assert.deepEqual(proof.mismatches, ['S1']);
});

test('PN7 deriveAlignmentSections exposes the PAUSED timeline for the render spec', () => {
  const { manifest } = sharedBuild();
  const aligned = pausedNarration.deriveAlignmentSections(manifest, { S1: ['B01'], S2: ['B02'] });
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].in_ms, 0);
  assert.equal(aligned[0].out_ms, manifest.sections[0].out_ms);
  assert.equal(aligned[1].story_order, 2);
  assert.deepEqual(aligned[1].script_beat_ids, ['B02']);
  assert.throws(() => pausedNarration.deriveAlignmentSections(manifest, { S1: ['B01'] }), { code: 'PAUSED_NARRATION_BEAT_BINDING_REQUIRED' });
});

test('PN8 a pause plan from foreign text is rejected before any audio work', () => {
  const foreign = planner.planPauses([{ section_id: 'S1', order: 1, text: 'Completely different words. In a different order entirely. But the count is off.' }]);
  assert.throws(() => pausedNarration.buildSpeechUnits(SECTIONS, foreign), (error) => String(error.code).startsWith('PAUSE_PLAN'));
});

test('PN9 total added duration equals pause_count * target within a frame', () => {
  const { manifest } = sharedBuild();
  assert.ok(Math.abs(manifest.total_added_pause_seconds - manifest.pause_count * 0.5) < 0.034);
});

module.exports = { tests: require('./_helpers.js').tests };
