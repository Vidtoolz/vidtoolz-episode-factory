'use strict';

/*
 * Script-visual binding: every background interval binds to the spoken script
 * occurring during that exact final-paused-narration interval.
 *
 * Doctrine (script_binding): coverage 100%, orphan intervals 0, generic
 * filler 0. The binding is a typed manifest the run materializer writes and
 * this module validates fail-closed against the interval schedule, the final
 * paused narration, and the composition asset manifest.
 */

const doctrineModule = require('./visual-draft-doctrine.js');
const pausePlanner = require('./natural-pause-planner.js');

const BINDING_SCHEMA = 'vidtoolz.visualDraftIntervalBinding.v1';
const SHA_RE = /^[a-f0-9]{64}$/;
const MIN_SEMANTIC_LENGTH = 12;
const GENERIC_FILLER_RE = /^(?:generic|placeholder|filler|abstract background|background \d+|texture|b-?roll|stock|neutral backdrop|misc|tbd|n\/a)\b/i;

class IntervalBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntervalBindingError';
    this.code = code;
  }
}

function fail(code, message) { throw new IntervalBindingError(code, message); }

/*
 * The words actually spoken inside [start_ms, end_ms) of the paused narration:
 * every speech unit overlapping the interval contributes the words whose
 * proportional position falls inside it. Word timing inside a unit is linear —
 * good enough to bind meaning to an interval without forced alignment.
 */
function spokenTextForInterval(pausedManifest, startMs, endMs) {
  const tokens = [];
  for (const unit of pausedManifest.units) {
    const unitStart = unit.start_seconds * 1000;
    const unitEnd = unit.end_seconds * 1000;
    if (unitEnd <= startMs || unitStart >= endMs) continue;
    const unitWords = pausePlanner.words(unit.text);
    const unitDuration = unitEnd - unitStart;
    for (let index = 0; index < unitWords.length; index += 1) {
      const wordMid = unitStart + ((index + 0.5) / unitWords.length) * unitDuration;
      if (wordMid >= startMs && wordMid < endMs) tokens.push(unitWords[index]);
    }
  }
  return tokens.join(' ');
}

/* Build the binding skeleton the materializer fills with semantic fields. */
function buildBindingSkeleton(schedule, pausedManifest) {
  return {
    schema: BINDING_SCHEMA,
    interval_schedule_digest_sha256: doctrineModule.digest(schedule),
    narration_sha256: pausedManifest.audio.sha256,
    intervals: schedule.intervals.map((interval) => ({
      interval_id: interval.interval_id,
      section_id: interval.section_id,
      start_ms: interval.start_ms,
      end_ms: interval.end_ms,
      spoken_text: spokenTextForInterval(pausedManifest, interval.start_ms, interval.end_ms),
      semantic_summary: null,
      visual_objective: null,
      visualization_type: null,
      image_concept: null,
      prompt_or_deterministic_spec: null,
      asset_id: null,
      asset_hash: null,
    })),
  };
}

function requireSemanticText(value, field, intervalId) {
  if (typeof value !== 'string' || value.trim().length < MIN_SEMANTIC_LENGTH) fail('BINDING_FIELD_UNDERSPECIFIED', `${intervalId}.${field}`);
  if (GENERIC_FILLER_RE.test(value.trim())) fail('BINDING_GENERIC_FILLER', `${intervalId}.${field}: "${value.trim().slice(0, 40)}"`);
  return value.trim();
}

/*
 * Fail-closed validation of a filled binding against the schedule, the paused
 * narration, and the composition asset manifest.
 */
function validateIntervalBinding(binding, { schedule, pausedManifest, assetManifest }, options = {}) {
  if (binding?.schema !== BINDING_SCHEMA) fail('BINDING_SCHEMA_INVALID', String(binding?.schema));
  const doctrine = options.doctrine || doctrineModule.activeDoctrine(options).rules.script_binding;
  const types = new Set(doctrine.visualization_types);
  if (binding.narration_sha256 !== pausedManifest.audio.sha256) fail('BINDING_NARRATION_DRIFT', 'binding does not reference the final paused narration bytes');
  if (binding.interval_schedule_digest_sha256 !== doctrineModule.digest(schedule)) fail('BINDING_SCHEDULE_DRIFT', 'binding does not reference the exact interval schedule');
  const scheduled = new Map(schedule.intervals.map((interval) => [interval.interval_id, interval]));
  if (!Array.isArray(binding.intervals) || binding.intervals.length !== schedule.intervals.length) fail('BINDING_COVERAGE_INCOMPLETE', `${binding.intervals?.length ?? 0} bound of ${schedule.intervals.length} scheduled`);
  const assets = new Map((assetManifest?.assets || []).map((asset) => [asset.asset_id, asset]));
  const usedAssets = new Set();
  const concepts = new Set();
  for (const entry of binding.intervals) {
    const interval = scheduled.get(entry.interval_id);
    if (!interval) fail('BINDING_ORPHAN_INTERVAL', String(entry.interval_id));
    if (entry.start_ms !== interval.start_ms || entry.end_ms !== interval.end_ms || entry.section_id !== interval.section_id) fail('BINDING_INTERVAL_DRIFT', entry.interval_id);
    const expectedSpoken = spokenTextForInterval(pausedManifest, interval.start_ms, interval.end_ms);
    if ((entry.spoken_text || '').trim() !== expectedSpoken.trim()) fail('BINDING_SPOKEN_TEXT_MISMATCH', `${entry.interval_id}: bound text is not the speech in this interval`);
    requireSemanticText(entry.semantic_summary, 'semantic_summary', entry.interval_id);
    requireSemanticText(entry.visual_objective, 'visual_objective', entry.interval_id);
    requireSemanticText(entry.image_concept, 'image_concept', entry.interval_id);
    requireSemanticText(entry.prompt_or_deterministic_spec, 'prompt_or_deterministic_spec', entry.interval_id);
    if (!types.has(entry.visualization_type)) fail('BINDING_VISUALIZATION_TYPE_INVALID', `${entry.interval_id}: ${entry.visualization_type}`);
    const conceptKey = entry.image_concept.trim().toLowerCase();
    if (concepts.has(conceptKey)) fail('BINDING_DUPLICATE_CONCEPT', `${entry.interval_id}: identical image concept reused`);
    concepts.add(conceptKey);
    if (!entry.asset_id) fail('BINDING_ASSET_REQUIRED', entry.interval_id);
    if (usedAssets.has(entry.asset_id)) fail('BINDING_ASSET_REUSED', `${entry.interval_id}: ${entry.asset_id}`);
    usedAssets.add(entry.asset_id);
    const asset = assets.get(entry.asset_id);
    if (!asset) fail('BINDING_ASSET_UNDECLARED', `${entry.interval_id}: ${entry.asset_id}`);
    if (!SHA_RE.test(entry.asset_hash || '') || entry.asset_hash !== asset.sha256) fail('BINDING_ASSET_HASH_MISMATCH', entry.interval_id);
  }
  return {
    coverage_percent: 100,
    orphan_intervals: 0,
    generic_filler: 0,
    bound_intervals: binding.intervals.length,
    unique_assets: usedAssets.size,
  };
}

module.exports = {
  BINDING_SCHEMA,
  MIN_SEMANTIC_LENGTH,
  IntervalBindingError,
  spokenTextForInterval,
  buildBindingSkeleton,
  validateIntervalBinding,
};
