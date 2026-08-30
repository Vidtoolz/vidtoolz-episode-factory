'use strict';

/*
 * Script-visual binding: 100% interval coverage, spoken text bound to the
 * exact paused-narration interval, no generic filler, no asset reuse.
 */
const { assert, test } = require('./_helpers.js');
const binding = require('../scripts/visual-draft-binding.js');
const scheduler = require('../scripts/visual-draft-interval-scheduler.js');

const CADENCE = { target_seconds: 4, target_frames: 120, tolerance_frames: [119, 121], final_interval_frames: [1, 121] };
const SCRIPT_BINDING_RULES = {
  coverage_percent: 100,
  orphan_intervals: 0,
  generic_filler: 0,
  visualization_types: ['LITERAL', 'METAPHORICAL', 'CONTRAST', 'EXPLANATORY', 'DIAGRAMMATIC', 'EMOTIONAL_ATMOSPHERIC', 'CONCEPTUAL'],
};

const SECTIONS = [{ section_id: 'S1', in_ms: 0, out_ms: 8000 }];
const PAUSED = {
  audio: { sha256: 'c'.repeat(64) },
  units: [
    { unit_id: 'U01', section_id: 'S1', text: 'Authorship is a claim about decisions not labor', start_seconds: 0, end_seconds: 4.0 },
    { unit_id: 'U02', section_id: 'S1', text: 'A director does not hold the camera', start_seconds: 4.0, end_seconds: 8.0 },
  ],
};
const ASSETS = {
  assets: [
    { asset_id: 'bg-desk-decisions', sha256: 'a'.repeat(64) },
    { asset_id: 'bg-director-set', sha256: 'b'.repeat(64) },
  ],
};

function schedule() { return scheduler.scheduleIntervals(SECTIONS, { cadence: CADENCE }); }

function validBinding() {
  const scheduled = schedule();
  const skeleton = binding.buildBindingSkeleton(scheduled, PAUSED);
  skeleton.intervals[0] = {
    ...skeleton.intervals[0],
    semantic_summary: 'Authorship is decided by decisions, not manual labor.',
    visual_objective: 'Make the decision/labor split visible in one image.',
    visualization_type: 'CONTRAST',
    image_concept: 'A lit desk where a hand signs a decision while robotic arms do the labor behind glass.',
    prompt_or_deterministic_spec: 'Full-frame 9:16 photoreal: decision desk in front, automated labor behind glass, no text.',
    asset_id: 'bg-desk-decisions',
    asset_hash: 'a'.repeat(64),
  };
  skeleton.intervals[1] = {
    ...skeleton.intervals[1],
    semantic_summary: 'A director authors the film without operating the camera.',
    visual_objective: 'Show direction as authorship without hands on the tool.',
    visualization_type: 'LITERAL',
    image_concept: 'A film set where the director points while a camera operator executes the move.',
    prompt_or_deterministic_spec: 'Full-frame 9:16 photoreal film set: director directing, operator at the camera, no text.',
    asset_id: 'bg-director-set',
    asset_hash: 'b'.repeat(64),
  };
  return { scheduled, filled: skeleton };
}

test('VDB1 skeleton binds each interval to the words actually spoken in it', () => {
  const skeleton = binding.buildBindingSkeleton(schedule(), PAUSED);
  assert.equal(skeleton.intervals.length, 2);
  assert.match(skeleton.intervals[0].spoken_text, /Authorship is a claim/);
  assert.match(skeleton.intervals[1].spoken_text, /director does not hold/);
  assert.equal(skeleton.narration_sha256, PAUSED.audio.sha256);
});

test('VDB2 a fully bound manifest validates at 100% coverage, zero orphans, zero filler', () => {
  const { scheduled, filled } = validBinding();
  const verdict = binding.validateIntervalBinding(filled, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES });
  assert.deepEqual(verdict, { coverage_percent: 100, orphan_intervals: 0, generic_filler: 0, bound_intervals: 2, unique_assets: 2 });
});

test('VDB3 missing an interval is incomplete coverage', () => {
  const { scheduled, filled } = validBinding();
  filled.intervals = [filled.intervals[0]];
  assert.throws(() => binding.validateIntervalBinding(filled, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_COVERAGE_INCOMPLETE' });
});

test('VDB4 the wrong script interval bound to an image is rejected', () => {
  const { scheduled, filled } = validBinding();
  const swapped = { ...filled, intervals: [{ ...filled.intervals[0], spoken_text: filled.intervals[1].spoken_text }, filled.intervals[1]] };
  assert.throws(() => binding.validateIntervalBinding(swapped, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_SPOKEN_TEXT_MISMATCH' });
});

test('VDB5 generic filler language is rejected', () => {
  const { scheduled, filled } = validBinding();
  filled.intervals[0].image_concept = 'generic abstract background texture for this part';
  assert.throws(() => binding.validateIntervalBinding(filled, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_GENERIC_FILLER' });
});

test('VDB6 one asset bound to two intervals is reuse', () => {
  const { scheduled, filled } = validBinding();
  filled.intervals[1].asset_id = 'bg-desk-decisions';
  filled.intervals[1].asset_hash = 'a'.repeat(64);
  assert.throws(() => binding.validateIntervalBinding(filled, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_ASSET_REUSED' });
});

test('VDB7 an identical image concept across intervals is rejected', () => {
  const { scheduled, filled } = validBinding();
  filled.intervals[1].image_concept = filled.intervals[0].image_concept;
  assert.throws(() => binding.validateIntervalBinding(filled, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_DUPLICATE_CONCEPT' });
});

test('VDB8 asset hash drift and undeclared assets fail closed', () => {
  const { scheduled, filled } = validBinding();
  const drifted = structuredClone(filled);
  drifted.intervals[0].asset_hash = 'f'.repeat(64);
  assert.throws(() => binding.validateIntervalBinding(drifted, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_ASSET_HASH_MISMATCH' });
  const undeclared = structuredClone(filled);
  undeclared.intervals[0].asset_id = 'bg-nowhere';
  assert.throws(() => binding.validateIntervalBinding(undeclared, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_ASSET_UNDECLARED' });
});

test('VDB9 a binding built against different narration bytes is rejected', () => {
  const { scheduled, filled } = validBinding();
  const foreign = { ...PAUSED, audio: { sha256: 'd'.repeat(64) } };
  assert.throws(() => binding.validateIntervalBinding(filled, { schedule: scheduled, pausedManifest: foreign, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_NARRATION_DRIFT' });
});

test('VDB10 invalid visualization type is rejected', () => {
  const { scheduled, filled } = validBinding();
  filled.intervals[0].visualization_type = 'VIBES';
  assert.throws(() => binding.validateIntervalBinding(filled, { schedule: scheduled, pausedManifest: PAUSED, assetManifest: ASSETS }, { doctrine: SCRIPT_BINDING_RULES }), { code: 'BINDING_VISUALIZATION_TYPE_INVALID' });
});

module.exports = { tests: require('./_helpers.js').tests };
