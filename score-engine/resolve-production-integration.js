"use strict";

// Production-profile planning is deliberately separate from P7's strict empty
// fixture validator. It examines only the explicit target tracks and
// Scorecraft-owned markers, so unrelated editorial content is neither authority
// nor collateral damage.
const provenance = require("./score-provenance.js");

const PROFILE = "scorecraft_resolve_production_v1";
const MARKER_PREFIX = "scorecraft:cue:v1:";
const MAX_TRACKS = 64;
const MAX_CLIPS_PER_TRACK = 256;
const MAX_MARKERS = 512;

function fail(message) { throw new Error(`Resolve production integration invalid: ${message}`); }
function text(value, label, max = 200) {
  const result = String(value || "").trim();
  if (!result) fail(`${label} is required`);
  if (result.length > max || /[\u0000-\u001f]/.test(result)) fail(`${label} is invalid`);
  return result;
}
function integer(value, label, min = 0) {
  if (typeof value === "boolean" || value === null || value === "") fail(`${label} must be an integer`);
  const result = Number(value);
  if (!Number.isInteger(result) || result < min) fail(`${label} must be an integer >= ${min}`);
  return result;
}
function sha(value, label) {
  const result = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) fail(`${label} must be a SHA-256 value`);
  return result;
}
function normalizeRate(value) {
  return { numerator: integer(value && value.numerator, "frame-rate numerator", 1), denominator: integer(value && value.denominator, "frame-rate denominator", 1) };
}
function normalizeTarget(input) {
  const target = {
    project_name: text(input && input.project_name, "project name"),
    project_unique_id: text(input && input.project_unique_id, "project unique ID"),
    timeline_name: text(input && input.timeline_name, "timeline name"),
    timeline_unique_id: text(input && input.timeline_unique_id, "timeline unique ID"),
    destination_timeline_name: text(input && input.destination_timeline_name, "destination timeline name"),
    narration_track_index: integer(input && input.narration_track_index, "narration track index", 1),
    narration_track_name: text(input && input.narration_track_name, "narration track name"),
    music_track_index: integer(input && input.music_track_index, "music track index", 1),
    music_track_name: text(input && input.music_track_name, "music track name"),
  };
  if (target.destination_timeline_name === target.timeline_name) fail("destination timeline must be a distinct duplicate");
  if (target.narration_track_index === target.music_track_index) fail("narration and music tracks must be distinct");
  return target;
}
function normalizeClip(clip) {
  return {
    source_sha256: sha(clip && clip.source_sha256, "clip source"),
    start_frame: integer(clip && clip.start_frame, "clip start frame"),
    duration_frames: integer(clip && clip.duration_frames, "clip duration", 1),
    speed_percent: Number(clip && clip.speed_percent),
  };
}
function normalizeTrack(track) {
  const clips = Array.isArray(track && track.clips) ? track.clips : [];
  if (clips.length > MAX_CLIPS_PER_TRACK) fail("target track exceeds the bounded clip limit");
  return {
    media_type: text(track && track.media_type, "track media type"),
    index: integer(track && track.index, "track index", 1),
    name: text(track && track.name, "track name"),
    enabled: track.enabled === true,
    locked: track.locked === true,
    clips: clips.map(normalizeClip).sort((a, b) => a.start_frame - b.start_frame || a.source_sha256.localeCompare(b.source_sha256)),
  };
}
function normalizeMarker(marker) {
  return {
    frame: integer(marker && marker.frame, "marker frame"),
    name: String(marker && marker.name || ""),
    duration_frames: integer(marker && marker.duration_frames, "marker duration", 1),
    custom_data: String(marker && marker.custom_data || ""),
  };
}
function normalizeReadback(observed) {
  if (!observed || observed.schema_version !== 1 || observed.role !== "scorecraft_resolve_production_readback") fail("supported Resolve production readback is required");
  const tracks = Array.isArray(observed.timeline && observed.timeline.tracks) ? observed.timeline.tracks : [];
  const markers = Array.isArray(observed.timeline && observed.timeline.markers) ? observed.timeline.markers : [];
  if (tracks.length > MAX_TRACKS) fail("timeline exceeds the bounded track limit");
  if (markers.length > MAX_MARKERS) fail("timeline exceeds the bounded marker limit");
  return {
    schema_version: 1,
    role: "scorecraft_resolve_production_readback",
    resolve_integration_identity: sha(observed.resolve_integration_identity, "Resolve integration identity"),
    project: { name: text(observed.project && observed.project.name, "readback project name"), unique_id: text(observed.project && observed.project.unique_id, "readback project unique ID") },
    timeline: {
      name: text(observed.timeline && observed.timeline.name, "readback timeline name"),
      unique_id: text(observed.timeline && observed.timeline.unique_id, "readback timeline unique ID"),
      frame_rate: normalizeRate(observed.timeline && observed.timeline.frame_rate),
      timeline_start_timecode: text(observed.timeline && observed.timeline.timeline_start_timecode, "timeline start timecode"),
      duration_frames: integer(observed.timeline && observed.timeline.duration_frames, "timeline duration", 1),
      tracks: tracks.map(normalizeTrack).sort((a, b) => a.media_type.localeCompare(b.media_type) || a.index - b.index),
      markers: markers.map(normalizeMarker).sort((a, b) => a.frame - b.frame || a.custom_data.localeCompare(b.custom_data)),
    },
  };
}
function expectedProductionMarkers(contract) {
  return contract.timeline.cue_markers.map((cue) => ({
    frame: integer(cue.start_frame, "cue start frame"),
    name: String(cue.name || ""),
    duration_frames: Math.max(1, integer(cue.end_frame, "cue end frame") - integer(cue.start_frame, "cue start frame")),
    custom_data: `${MARKER_PREFIX}${text(cue.cue_id, "cue ID")}`,
  })).sort((a, b) => a.frame - b.frame || a.custom_data.localeCompare(b.custom_data));
}
function requireContract(contract) {
  const identity = provenance.resolveIntegrationIdentity(contract);
  if (!contract.production || !contract.narration || !contract.timeline) fail("complete P6 integration authority is required");
  return identity;
}
function relevantState(contract, targetInput, observedInput) {
  const target = normalizeTarget(targetInput); const observed = normalizeReadback(observedInput);
  const integrationIdentity = requireContract(contract);
  const timeline = observed.timeline;
  const narration = timeline.tracks.find((track) => track.media_type === "audio" && track.index === target.narration_track_index);
  const music = timeline.tracks.find((track) => track.media_type === "audio" && track.index === target.music_track_index);
  const ownedMarkers = timeline.markers.filter((marker) => marker.custom_data.startsWith(MARKER_PREFIX));
  const occupiedExpectedFrames = timeline.markers.filter((marker) => expectedProductionMarkers(contract).some((expected) => expected.frame === marker.frame));
  return {
    target, observed, integrationIdentity, narration, music,
    precondition: {
      schema_version: 1,
      role: "scorecraft_resolve_production_precondition",
      resolve_integration_identity: integrationIdentity,
      target,
      timeline: {
        project_name: observed.project.name, project_unique_id: observed.project.unique_id,
        timeline_name: timeline.name, timeline_unique_id: timeline.unique_id,
        frame_rate: timeline.frame_rate, timeline_start_timecode: timeline.timeline_start_timecode,
        duration_frames: timeline.duration_frames,
        narration_track: narration || null, music_track: music || null,
        scorecraft_markers: ownedMarkers,
        expected_marker_frames: expectedProductionMarkers(contract).map((marker) => marker.frame),
        markers_at_expected_frames: occupiedExpectedFrames,
      },
    },
  };
}
function productionPreconditionIdentity(contract, target, observed) {
  return provenance.resolveProductionPreconditionIdentity(relevantState(contract, target, observed).precondition);
}
function same(a, b) { return provenance.hashCanonical(a) === provenance.hashCanonical(b); }
function buildProductionPlan(contract, targetInput, observedInput, knownMixShas = []) {
  const state = relevantState(contract, targetInput, observedInput);
  const { target, observed, integrationIdentity, narration, music, precondition } = state;
  const conflicts = []; const operations = [];
  if (observed.resolve_integration_identity !== integrationIdentity) conflicts.push("resolve_integration_identity_mismatch");
  if (observed.project.name !== target.project_name || observed.project.unique_id !== target.project_unique_id) conflicts.push("target_project_mismatch");
  if (observed.timeline.name !== target.timeline_name || observed.timeline.unique_id !== target.timeline_unique_id) conflicts.push("target_timeline_mismatch");
  if (!same(observed.timeline.frame_rate, contract.timeline.frame_rate)) conflicts.push("frame_rate_mismatch");
  if (observed.timeline.timeline_start_timecode !== contract.timeline.timeline_start_timecode) conflicts.push("timeline_start_timecode_mismatch");
  if (Math.abs(observed.timeline.duration_frames - contract.timeline.expected_program_duration_frames) > contract.timeline.duration_tolerance_frames) conflicts.push("program_duration_mismatch");
  if (!narration || narration.name !== target.narration_track_name || !narration.enabled || narration.locked) conflicts.push("narration_track_mismatch");
  else if (narration.clips.length !== 1 || narration.clips[0].source_sha256 !== contract.narration.source_sha256
    || narration.clips[0].start_frame !== contract.timeline.narration_start_frame || narration.clips[0].speed_percent !== 100) conflicts.push("narration_authority_mismatch");
  if (!music || music.name !== target.music_track_name || !music.enabled || music.locked) conflicts.push("music_track_mismatch");
  else if (music.clips.length > 1) conflicts.push("duplicate_or_complex_music_track");
  else if (music.clips.length === 1) {
    const clip = music.clips[0];
    if (clip.speed_percent !== 100 || clip.start_frame !== contract.timeline.music_start_frame) conflicts.push("music_placement_or_retime_mismatch");
    else if (clip.source_sha256 === contract.production.production_mix_sha256) { /* already correct */ }
    else if (new Set(knownMixShas.map((value) => sha(value, "known production mix"))).has(clip.source_sha256)) {
      operations.push({ op: "replace_recognized_scorecraft_music", track_index: target.music_track_index, expected_old_sha256: clip.source_sha256, selected_music_sha256: contract.production.production_mix_sha256, start_frame: contract.timeline.music_start_frame });
    } else conflicts.push("unknown_audio_on_music_track");
  } else operations.push({ op: "add_selected_music", track_index: target.music_track_index, selected_music_sha256: contract.production.production_mix_sha256, start_frame: contract.timeline.music_start_frame });

  const expectedMarkers = expectedProductionMarkers(contract);
  for (const marker of observed.timeline.markers) {
    if (!marker.custom_data.startsWith(MARKER_PREFIX) && expectedMarkers.some((expected) => expected.frame === marker.frame)) conflicts.push(`unowned_marker_at_scorecraft_frame:${marker.frame}`);
  }
  const owned = observed.timeline.markers.filter((marker) => marker.custom_data.startsWith(MARKER_PREFIX));
  if (!same(owned, expectedMarkers)) operations.push({ op: "upsert_scorecraft_markers", marker_prefix: MARKER_PREFIX, markers: expectedMarkers });
  const preconditionIdentity = provenance.resolveProductionPreconditionIdentity(precondition);
  const status = conflicts.length ? "conflict" : operations.length ? "ready_to_apply" : "verify_only";
  const identityPayload = { schema_version: 1, role: "scorecraft_resolve_production_plan", profile: PROFILE, resolve_integration_identity: integrationIdentity, target, precondition, precondition_identity: preconditionIdentity, status, conflicts: [...new Set(conflicts)].sort(), operations: status === "conflict" ? [] : operations };
  return { ...identityPayload, plan_identity: provenance.resolveProductionPlanIdentity(identityPayload) };
}
function validateProductionTimelineEvidence(contract, targetInput, observedInput) {
  const sourceTarget = normalizeTarget(targetInput); const observed = normalizeReadback(observedInput);
  const target = { ...sourceTarget, timeline_name: observed.timeline.name, timeline_unique_id: observed.timeline.unique_id,
    destination_timeline_name: observed.timeline.name === sourceTarget.timeline_name ? sourceTarget.destination_timeline_name : sourceTarget.timeline_name };
  const plan = buildProductionPlan(contract, target, observed, [contract.production.production_mix_sha256]);
  if (plan.status !== "verify_only") fail(`post-write timeline is not exact (${plan.conflicts.join(",") || plan.operations.map((op) => op.op).join(",")})`);
  const narration = observed.timeline.tracks.find((track) => track.media_type === "audio" && track.index === target.narration_track_index).clips[0];
  const music = observed.timeline.tracks.find((track) => track.media_type === "audio" && track.index === target.music_track_index).clips[0];
  const evidence = {
    schema_version: 1, role: "scorecraft_resolve_timeline_evidence", profile: PROFILE,
    resolve_integration_identity: provenance.resolveIntegrationIdentity(contract),
    target: { project_name: observed.project.name, project_unique_id: observed.project.unique_id, timeline_name: observed.timeline.name, timeline_unique_id: observed.timeline.unique_id, narration_track_index: target.narration_track_index, narration_track_name: target.narration_track_name, music_track_index: target.music_track_index, music_track_name: target.music_track_name },
    frame_rate: observed.timeline.frame_rate, timeline_start_timecode: observed.timeline.timeline_start_timecode,
    timeline_duration_frames: observed.timeline.duration_frames,
    narration, music,
    scorecraft_markers: observed.timeline.markers.filter((marker) => marker.custom_data.startsWith(MARKER_PREFIX)),
  };
  return { evidence, evidence_identity: provenance.resolveTimelineEvidenceIdentity(evidence) };
}

function validateStoredProductionEvidence(contract, evidenceInput) {
  const evidence = evidenceInput && typeof evidenceInput === "object" ? evidenceInput : {};
  if (evidence.schema_version !== 1 || evidence.role !== "scorecraft_resolve_timeline_evidence" || evidence.profile !== PROFILE) fail("supported production timeline evidence is required");
  const integrationIdentity = requireContract(contract);
  if (sha(evidence.resolve_integration_identity, "Resolve integration identity") !== integrationIdentity) fail("integration identity does not match the current P6 contract");
  if (!same(normalizeRate(evidence.frame_rate), contract.timeline.frame_rate)) fail("frame rate does not match the P6 contract");
  if (String(evidence.timeline_start_timecode || "") !== contract.timeline.timeline_start_timecode) fail("timeline start timecode does not match the P6 contract");
  if (Math.abs(integer(evidence.timeline_duration_frames, "timeline duration", 1) - contract.timeline.expected_program_duration_frames) > contract.timeline.duration_tolerance_frames) fail("timeline duration exceeds the P6 tolerance");
  const music = normalizeClip(evidence.music); const narration = normalizeClip(evidence.narration);
  if (music.source_sha256 !== contract.production.production_mix_sha256 || music.start_frame !== contract.timeline.music_start_frame || music.speed_percent !== 100) fail("music authority, placement, or speed differs");
  if (narration.source_sha256 !== contract.narration.source_sha256 || narration.start_frame !== contract.timeline.narration_start_frame || narration.speed_percent !== 100) fail("narration authority, placement, or speed differs");
  const markers = (Array.isArray(evidence.scorecraft_markers) ? evidence.scorecraft_markers : []).map(normalizeMarker).sort((a, b) => a.frame - b.frame || a.custom_data.localeCompare(b.custom_data));
  if (!same(markers, expectedProductionMarkers(contract))) fail("Scorecraft cue markers differ from the P6 contract");
  const normalized = { ...evidence, frame_rate: normalizeRate(evidence.frame_rate), timeline_duration_frames: integer(evidence.timeline_duration_frames, "timeline duration", 1), narration, music, scorecraft_markers: markers };
  return { evidence: normalized, evidence_identity: provenance.resolveTimelineEvidenceIdentity(normalized) };
}

module.exports = { PROFILE, MARKER_PREFIX, MAX_TRACKS, MAX_CLIPS_PER_TRACK, MAX_MARKERS, normalizeTarget, normalizeReadback, expectedProductionMarkers, productionPreconditionIdentity, buildProductionPlan, validateProductionTimelineEvidence, validateStoredProductionEvidence };
