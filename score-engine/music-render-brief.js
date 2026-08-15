// MusicRenderBrief v1 — frozen generator-neutral contract (validator).
//
// The canonical schema is score-engine/MusicRenderBrief-v1.schema.json,
// copied byte-for-byte from the VIDLAP2 music worker's docs (the contract
// owner). This module hand-enforces that schema without adding a dependency
// (Episode Factory is dependency-free). tests/score-brief-exporter.test.js
// cross-checks every constant below against the schema file so the validator
// cannot silently drift from the frozen contract.
//
// v1 is FROZEN: no new fields, no widened enums, additionalProperties:false.
"use strict";

const ENERGY_CURVES = ["flat-low", "slow-build", "build-release", "two-peak", "flat-high"];
const ENDINGS = ["clear-button", "fade", "sting", "loop-ready-tail"];
const MIX_ROLES = ["underlay", "feature", "transition"];
const DENSITIES = ["high", "medium", "low"];
const BRIEF_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const TEMPO_PATTERN = /^(free|[0-9]{2,3}(-[0-9]{2,3})?)$/;
const REQUIRED_FIELDS = ["brief_id", "brief_version", "purpose", "target_duration_s",
  "energy_curve", "sections", "ending", "mix_role"];
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, "tempo", "key_mode", "emotion_curve",
  "instrumentation", "avoid", "narration_density", "loopability"]);
const LIMITS = {
  purpose_min: 8, purpose_max: 400,
  duration_max: 600,
  key_mode_max: 40,
  emotion_curve_max_items: 12, emotion_item_max: 60,
  instrument_item_max: 60,
  avoid_item_max: 60,
  sections_min: 1, sections_max: 16, section_name_max: 40, section_notes_max: 300,
  narration_max_items: 16,
};

function isFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v); }
function isNonEmptyString(v) { return typeof v === "string" && v.length > 0; }

function validateStringArray(errors, value, field, maxItems, itemMax) {
  if (value === undefined) return;
  if (!Array.isArray(value)) { errors.push(`${field}: must be an array`); return; }
  if (maxItems && value.length > maxItems) errors.push(`${field}: at most ${maxItems} items allowed (got ${value.length})`);
  value.forEach((item, i) => {
    if (typeof item !== "string") errors.push(`${field}[${i}]: must be a string`);
    else if (item.length > itemMax) errors.push(`${field}[${i}]: exceeds ${itemMax} characters`);
  });
}

// Enforces the frozen v1 schema (types, enums, ranges, patterns, array
// limits, nested shapes, additionalProperties:false) plus section/narration
// timing sanity. Returns an array of field-specific error strings, empty
// when the brief is valid.
function validateMusicRenderBrief(brief) {
  const errors = [];
  const tag = "musicRenderBrief";
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return [`${tag}: must be an object`];

  for (const field of REQUIRED_FIELDS) {
    if (brief[field] === undefined) errors.push(`${tag}.${field}: required field missing`);
  }
  for (const field of Object.keys(brief)) {
    if (!ALLOWED_FIELDS.has(field)) errors.push(`${tag}.${field}: additional property not allowed (v1 is frozen)`);
  }

  if (brief.brief_id !== undefined && (!isNonEmptyString(brief.brief_id) || !BRIEF_ID_PATTERN.test(brief.brief_id))) {
    errors.push(`${tag}.brief_id: must match ${BRIEF_ID_PATTERN} (lowercase slug, 3-80 chars)`);
  }
  if (brief.brief_version !== undefined && !(Number.isInteger(brief.brief_version) && brief.brief_version >= 1)) {
    errors.push(`${tag}.brief_version: must be an integer >= 1 (the number 1, not "v1")`);
  }
  if (brief.purpose !== undefined && (typeof brief.purpose !== "string"
      || brief.purpose.length < LIMITS.purpose_min || brief.purpose.length > LIMITS.purpose_max)) {
    errors.push(`${tag}.purpose: must be a string of ${LIMITS.purpose_min}-${LIMITS.purpose_max} characters`);
  }
  if (brief.target_duration_s !== undefined && (!isFiniteNumber(brief.target_duration_s)
      || brief.target_duration_s <= 0 || brief.target_duration_s > LIMITS.duration_max)) {
    errors.push(`${tag}.target_duration_s: must be a number in (0, ${LIMITS.duration_max}]`);
  }
  if (brief.tempo !== undefined && (typeof brief.tempo !== "string" || !TEMPO_PATTERN.test(brief.tempo))) {
    errors.push(`${tag}.tempo: must match ${TEMPO_PATTERN} (e.g. "free", "92", "90-100")`);
  }
  if (brief.key_mode !== undefined && (typeof brief.key_mode !== "string" || brief.key_mode.length > LIMITS.key_mode_max)) {
    errors.push(`${tag}.key_mode: must be a string of at most ${LIMITS.key_mode_max} characters`);
  }
  if (brief.energy_curve !== undefined && !ENERGY_CURVES.includes(brief.energy_curve)) {
    errors.push(`${tag}.energy_curve: invalid enum value (allowed: ${ENERGY_CURVES.join("|")})`);
  }
  validateStringArray(errors, brief.emotion_curve, `${tag}.emotion_curve`, LIMITS.emotion_curve_max_items, LIMITS.emotion_item_max);

  if (brief.instrumentation !== undefined) {
    const inst = brief.instrumentation;
    if (!inst || typeof inst !== "object" || Array.isArray(inst)) errors.push(`${tag}.instrumentation: must be an object`);
    else {
      for (const key of Object.keys(inst)) {
        if (key !== "required" && key !== "allowed") errors.push(`${tag}.instrumentation.${key}: additional property not allowed`);
      }
      validateStringArray(errors, inst.required, `${tag}.instrumentation.required`, null, LIMITS.instrument_item_max);
      validateStringArray(errors, inst.allowed, `${tag}.instrumentation.allowed`, null, LIMITS.instrument_item_max);
    }
  }
  validateStringArray(errors, brief.avoid, `${tag}.avoid`, null, LIMITS.avoid_item_max);

  if (brief.sections !== undefined) {
    if (!Array.isArray(brief.sections) || brief.sections.length < LIMITS.sections_min) {
      errors.push(`${tag}.sections: must be a non-empty array`);
    } else {
      if (brief.sections.length > LIMITS.sections_max) errors.push(`${tag}.sections: at most ${LIMITS.sections_max} sections allowed (got ${brief.sections.length})`);
      brief.sections.forEach((section, i) => {
        const stag = `${tag}.sections[${i}]`;
        if (!section || typeof section !== "object" || Array.isArray(section)) { errors.push(`${stag}: must be an object`); return; }
        for (const key of Object.keys(section)) {
          if (!["name", "start_s", "end_s", "notes"].includes(key)) errors.push(`${stag}.${key}: additional property not allowed`);
        }
        if (!isNonEmptyString(section.name) || section.name.length > LIMITS.section_name_max) errors.push(`${stag}.name: required string of at most ${LIMITS.section_name_max} characters`);
        if (!isFiniteNumber(section.start_s) || section.start_s < 0) errors.push(`${stag}.start_s: must be a number >= 0`);
        if (!isFiniteNumber(section.end_s) || section.end_s <= 0) errors.push(`${stag}.end_s: must be a number > 0`);
        if (isFiniteNumber(section.start_s) && isFiniteNumber(section.end_s) && section.end_s <= section.start_s) {
          errors.push(`${stag}.end_s: must be greater than start_s`);
        }
        if (section.notes !== undefined && (typeof section.notes !== "string" || section.notes.length > LIMITS.section_notes_max)) {
          errors.push(`${stag}.notes: must be a string of at most ${LIMITS.section_notes_max} characters`);
        }
        if (i > 0 && brief.sections[i - 1] && isFiniteNumber(section.start_s) && isFiniteNumber(brief.sections[i - 1].end_s)
            && section.start_s < brief.sections[i - 1].end_s - 0.001) {
          errors.push(`${stag}.start_s: overlaps previous section (starts before ${brief.sections[i - 1].end_s})`);
        }
      });
    }
  }

  if (brief.narration_density !== undefined) {
    if (!Array.isArray(brief.narration_density)) errors.push(`${tag}.narration_density: must be an array`);
    else {
      if (brief.narration_density.length > LIMITS.narration_max_items) errors.push(`${tag}.narration_density: at most ${LIMITS.narration_max_items} spans allowed`);
      brief.narration_density.forEach((span, i) => {
        const ntag = `${tag}.narration_density[${i}]`;
        if (!span || typeof span !== "object" || Array.isArray(span)) { errors.push(`${ntag}: must be an object`); return; }
        for (const key of Object.keys(span)) {
          if (!["start_s", "end_s", "density"].includes(key)) errors.push(`${ntag}.${key}: additional property not allowed`);
        }
        if (!isFiniteNumber(span.start_s) || span.start_s < 0) errors.push(`${ntag}.start_s: must be a number >= 0`);
        if (!isFiniteNumber(span.end_s) || span.end_s <= 0) errors.push(`${ntag}.end_s: must be a number > 0`);
        if (isFiniteNumber(span.start_s) && isFiniteNumber(span.end_s) && span.end_s <= span.start_s) {
          errors.push(`${ntag}.end_s: must be greater than start_s`);
        }
        if (!DENSITIES.includes(span.density)) errors.push(`${ntag}.density: invalid enum value (allowed: ${DENSITIES.join("|")})`);
      });
    }
  }

  if (brief.ending !== undefined && !ENDINGS.includes(brief.ending)) {
    errors.push(`${tag}.ending: invalid enum value (allowed: ${ENDINGS.join("|")})`);
  }
  if (brief.loopability !== undefined && typeof brief.loopability !== "boolean") {
    errors.push(`${tag}.loopability: must be a boolean`);
  }
  if (brief.mix_role !== undefined && !MIX_ROLES.includes(brief.mix_role)) {
    errors.push(`${tag}.mix_role: invalid enum value (allowed: ${MIX_ROLES.join("|")})`);
  }
  return errors;
}

module.exports = {
  ENERGY_CURVES,
  ENDINGS,
  MIX_ROLES,
  DENSITIES,
  BRIEF_ID_PATTERN,
  TEMPO_PATTERN,
  REQUIRED_FIELDS,
  ALLOWED_FIELDS,
  LIMITS,
  validateMusicRenderBrief,
};
