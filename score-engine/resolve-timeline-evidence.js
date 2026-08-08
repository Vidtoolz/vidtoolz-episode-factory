"use strict";

// Normalize semantic Resolve API readback and compare it with the immutable P6
// integration contract. Resolve object IDs, absolute paths, timestamps, and
// other volatile application metadata never participate in this identity.
const provenance = require("./score-provenance.js");

function fail(message) { throw new Error(`Resolve timeline evidence invalid: ${message}`); }
function integer(value, label) {
  if (value === null || value === "" || typeof value === "boolean") fail(`${label} must be an integer frame value`);
  const number = Number(value);
  if (!Number.isInteger(number)) fail(`${label} must be an integer frame value`);
  return number;
}
function sha(value, label) {
  const text = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) fail(`${label} must be a SHA-256 value`);
  return text;
}
function rate(value) {
  const numerator = integer(value && value.numerator, "frame-rate numerator");
  const denominator = integer(value && value.denominator, "frame-rate denominator");
  if (numerator < 1 || denominator < 1) fail("frame rate must be positive");
  return { numerator, denominator };
}

function normalizeClip(clip) {
  const kind = String(clip && clip.source_kind || "");
  if (!["video", "narration", "music"].includes(kind)) fail(`unsupported source kind ${kind || "(empty)"}`);
  return {
    source_kind: kind,
    source_sha256: sha(clip.source_sha256, `${kind} source`),
    media_type: String(clip.media_type || ""),
    track_index: integer(clip.track_index, `${kind} track index`),
    start_frame: integer(clip.start_frame, `${kind} start`),
    duration_frames: integer(clip.duration_frames, `${kind} duration`),
    speed_percent: Number(clip.speed_percent),
  };
}

function normalizeMarker(marker) {
  return {
    cue_id: String(marker && marker.cue_id || ""),
    name: String(marker && marker.name || ""),
    frame: integer(marker && marker.frame, "marker frame"),
    duration_frames: integer(marker && marker.duration_frames, "marker duration"),
  };
}

function normalizeResolveTimelineEvidence(observed) {
  if (!observed || observed.schema_version !== 1 || !["scorecraft_resolve_timeline_readback", "scorecraft_resolve_timeline_evidence"].includes(observed.role)) {
    fail("a supported semantic Resolve readback is required");
  }
  const clips = (Array.isArray(observed.clips) ? observed.clips : []).map(normalizeClip)
    .sort((a, b) => a.media_type.localeCompare(b.media_type) || a.track_index - b.track_index
      || a.start_frame - b.start_frame || a.source_kind.localeCompare(b.source_kind));
  const markers = (Array.isArray(observed.markers) ? observed.markers : []).map(normalizeMarker)
    .sort((a, b) => a.frame - b.frame || a.cue_id.localeCompare(b.cue_id));
  return {
    schema_version: 1,
    role: "scorecraft_resolve_timeline_evidence",
    resolve_integration_identity: sha(observed.resolve_integration_identity, "Resolve integration identity"),
    frame_rate: rate(observed.frame_rate),
    timeline_start_timecode: String(observed.timeline_start_timecode || ""),
    timeline_duration_frames: integer(observed.timeline_duration_frames, "timeline duration"),
    clips,
    markers,
  };
}

function validateResolveTimelineEvidence(integrationContract, observed) {
  if (!integrationContract || integrationContract.role !== "scorecraft_resolve_integration") fail("P6 integration contract is required");
  const normalized = normalizeResolveTimelineEvidence(observed);
  const expectedIdentity = provenance.resolveIntegrationIdentity(integrationContract);
  if (normalized.resolve_integration_identity !== expectedIdentity) fail("integration identity does not match the current P6 contract");
  const timeline = integrationContract.timeline;
  if (provenance.hashCanonical(normalized.frame_rate) !== provenance.hashCanonical(timeline.frame_rate)) fail("frame rate does not match the P6 contract");
  if (normalized.timeline_start_timecode !== timeline.timeline_start_timecode) fail("timeline start timecode does not match the P6 contract");
  if (Math.abs(normalized.timeline_duration_frames - timeline.expected_program_duration_frames) > timeline.duration_tolerance_frames) fail("timeline duration exceeds the P6 frame tolerance");

  const music = normalized.clips.filter((clip) => clip.source_kind === "music");
  const narration = normalized.clips.filter((clip) => clip.source_kind === "narration");
  if (music.length !== 1) fail("exactly one selected music timeline clip is required");
  if (narration.length !== 1) fail("exactly one narration timeline clip is required");
  if (music[0].source_sha256 !== integrationContract.production.production_mix_sha256) fail("music source does not match the selected production mix");
  if (narration[0].source_sha256 !== integrationContract.narration.source_sha256) fail("narration source does not match narration authority");
  if (music[0].start_frame !== timeline.music_start_frame) fail("music start frame does not match the P6 contract");
  if (narration[0].start_frame !== timeline.narration_start_frame) fail("narration start frame does not match the P6 contract");
  if (music[0].media_type !== "audio" || narration[0].media_type !== "audio") fail("music and narration must be timeline audio clips");
  if (music[0].speed_percent !== 100 || narration[0].speed_percent !== 100) fail("retimed music or narration is not accepted");

  const expectedMarkers = timeline.cue_markers.map((cue) => ({
    cue_id: String(cue.cue_id), name: String(cue.name), frame: Number(cue.start_frame),
    duration_frames: Math.max(1, Number(cue.end_frame) - Number(cue.start_frame)),
  })).sort((a, b) => a.frame - b.frame || a.cue_id.localeCompare(b.cue_id));
  if (provenance.hashCanonical(normalized.markers) !== provenance.hashCanonical(expectedMarkers)) fail("cue markers do not exactly match the P6 timing contract");
  return { evidence: normalized, evidence_identity: provenance.resolveTimelineEvidenceIdentity(normalized) };
}

module.exports = { normalizeResolveTimelineEvidence, validateResolveTimelineEvidence };
