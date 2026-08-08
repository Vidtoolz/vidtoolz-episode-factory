"use strict";

const { assert, fs, path, test } = require("./_helpers.js");
const provenance = require("../score-engine/score-provenance.js");
const production = require("../score-engine/resolve-production-integration.js");

const sha = (char) => char.repeat(64);
const contract = {
  schema_version: 1,
  role: "scorecraft_resolve_integration",
  production: { production_mix_sha256: sha("a") },
  narration: { source_sha256: sha("b") },
  timeline: {
    frame_rate: { numerator: 24, denominator: 1 },
    timeline_start_timecode: "01:00:00:00",
    expected_program_duration_frames: 96,
    duration_tolerance_frames: 1,
    music_start_frame: 0,
    narration_start_frame: 24,
    cue_markers: [
      { cue_id: "C001", name: "Opening", start_frame: 0, end_frame: 24 },
      { cue_id: "C002", name: "Close", start_frame: 72, end_frame: 96 },
    ],
  },
};
const integrationIdentity = provenance.resolveIntegrationIdentity(contract);
const target = {
  project_name: "Episode 014",
  project_unique_id: "project-123",
  timeline_name: "Main Edit",
  timeline_unique_id: "timeline-123",
  destination_timeline_name: "Main Edit — Scorecraft 001",
  narration_track_index: 1,
  narration_track_name: "Narration",
  music_track_index: 4,
  music_track_name: "Scorecraft Music",
};
function readback({ music = [], narrationSha = sha("b"), markers = [], volatile = "one", duration = 96 } = {}) {
  return {
    schema_version: 1,
    role: "scorecraft_resolve_production_readback",
    resolve_integration_identity: integrationIdentity,
    project: { name: target.project_name, unique_id: target.project_unique_id },
    timeline: {
      name: target.timeline_name,
      unique_id: target.timeline_unique_id,
      frame_rate: { numerator: 24, denominator: 1 },
      timeline_start_timecode: "01:00:00:00",
      duration_frames: duration,
      tracks: [
        { media_type: "audio", index: 1, name: "Narration", enabled: true, locked: false, clips: [
          { source_sha256: narrationSha, start_frame: 24, duration_frames: 48, speed_percent: 100 },
        ] },
        { media_type: "audio", index: 3, name: "Room Tone", enabled: true, locked: false, clips: [
          { source_sha256: sha("d"), start_frame: 0, duration_frames: 96, speed_percent: 100 },
        ] },
        { media_type: "audio", index: 4, name: "Scorecraft Music", enabled: true, locked: false, clips: music },
        { media_type: "video", index: 1, name: "Picture", enabled: true, locked: false, clips: [
          { source_sha256: sha("e"), start_frame: 0, duration_frames: 32, speed_percent: 100 },
          { source_sha256: sha("f"), start_frame: 32, duration_frames: 32, speed_percent: 100 },
          { source_sha256: sha("1"), start_frame: 64, duration_frames: 32, speed_percent: 100 },
        ] },
      ],
      markers,
      volatile_metadata: volatile,
    },
  };
}

test("resolve production: explicit target is mandatory and implicit current/latest fields are rejected", () => {
  assert.throws(() => production.buildProductionPlan(contract, { ...target, timeline_unique_id: "" }, readback(), [sha("a")]), /timeline unique ID/i);
  assert.throws(() => production.buildProductionPlan(contract, { ...target, project_name: "" }, readback(), [sha("a")]), /project name/i);
});

test("resolve production: empty named target track yields deterministic add + owned-marker plan", () => {
  const first = production.buildProductionPlan(contract, target, readback({ markers: [
    { frame: 12, name: "Editorial note", duration_frames: 1, custom_data: "editor:note" },
  ] }), [sha("a")]);
  const second = production.buildProductionPlan(contract, target, readback({ markers: [
    { frame: 12, name: "Editorial note", duration_frames: 1, custom_data: "editor:note" },
  ], volatile: "two" }), [sha("a")]);
  assert.equal(first.status, "ready_to_apply");
  assert.deepEqual(first.operations.map((entry) => entry.op), ["add_selected_music", "upsert_scorecraft_markers"]);
  assert.equal(first.plan_identity, second.plan_identity);
  assert.equal(first.precondition_identity, second.precondition_identity);
});

test("resolve production: exact selected music is verify-only while known old music is explicit replace", () => {
  const selected = { source_sha256: sha("a"), start_frame: 0, duration_frames: 96, speed_percent: 100 };
  const current = production.buildProductionPlan(contract, target, readback({ music: [selected], markers: production.expectedProductionMarkers(contract) }), [sha("a"), sha("c")]);
  assert.equal(current.status, "verify_only");
  assert.deepEqual(current.operations, []);
  const old = { ...selected, source_sha256: sha("c") };
  const replacement = production.buildProductionPlan(contract, target, readback({ music: [old] }), [sha("a"), sha("c")]);
  assert.equal(replacement.status, "ready_to_apply");
  assert.equal(replacement.operations[0].op, "replace_recognized_scorecraft_music");
  assert.equal(replacement.operations[0].expected_old_sha256, sha("c"));
});

test("resolve production: unknown or duplicate target audio, retiming, narration and rate mismatches fail closed", () => {
  const clip = { source_sha256: sha("9"), start_frame: 0, duration_frames: 96, speed_percent: 100 };
  for (const observed of [
    readback({ music: [clip] }),
    readback({ music: [clip, { ...clip, source_sha256: sha("8") }] }),
    readback({ music: [{ ...clip, source_sha256: sha("a"), speed_percent: 99 }] }),
    readback({ narrationSha: sha("7") }),
    { ...readback(), timeline: { ...readback().timeline, frame_rate: { numerator: 25, denominator: 1 } } },
  ]) {
    const plan = production.buildProductionPlan(contract, target, observed, [sha("a"), sha("c")]);
    assert.equal(plan.status, "conflict");
    assert.ok(plan.conflicts.length > 0);
    assert.deepEqual(plan.operations, []);
  }
});

test("resolve production: stale precondition is scoped to relevant state", () => {
  const before = production.buildProductionPlan(contract, target, readback(), [sha("a")]);
  const unrelatedVisual = readback();
  unrelatedVisual.timeline.tracks.find((track) => track.media_type === "video").clips[0].duration_frames = 31;
  assert.equal(production.productionPreconditionIdentity(contract, target, unrelatedVisual), before.precondition_identity);
  const changedMusic = readback({ music: [{ source_sha256: sha("9"), start_frame: 0, duration_frames: 96, speed_percent: 100 }] });
  assert.notEqual(production.productionPreconditionIdentity(contract, target, changedMusic), before.precondition_identity);
});

test("resolve production: an unrelated marker on a required cue frame conflicts instead of being overwritten", () => {
  const plan = production.buildProductionPlan(contract, target, readback({ markers: [
    { frame: 0, name: "Editor-owned opening note", duration_frames: 1, custom_data: "editor:opening" },
  ] }), [sha("a")]);
  assert.equal(plan.status, "conflict");
  assert.ok(plan.conflicts.includes("unowned_marker_at_scorecraft_frame:0"));
  assert.deepEqual(plan.operations, []);
});

test("resolve production: post-apply evidence validates production profile without requiring an empty timeline", () => {
  const observed = readback({
    music: [{ source_sha256: sha("a"), start_frame: 0, duration_frames: 96, speed_percent: 100 }],
    markers: [
      { frame: 12, name: "Editorial note", duration_frames: 1, custom_data: "editor:note" },
      ...production.expectedProductionMarkers(contract),
    ],
  });
  const checked = production.validateProductionTimelineEvidence(contract, target, observed);
  assert.equal(checked.evidence.profile, "scorecraft_resolve_production_v1");
  assert.equal(checked.evidence.music.source_sha256, sha("a"));
  assert.equal(checked.evidence.narration.source_sha256, sha("b"));
  assert.equal(checked.evidence.scorecraft_markers.length, 2);
});

test("resolve production: production routes and operator UI expose bounded preflight/apply/verify, not generic RPC", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "package-engine-server.js"), "utf8");
  const ui = fs.readFileSync(path.join(root, "score-project.html"), "utf8");
  for (const route of ["/api/score/resolve/production/preflight", "/api/score/resolve/production/apply", "/api/score/resolve/production/verify"]) assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(ui, /Read-only preflight/);
  assert.match(ui, /Apply to new timeline/);
  assert.match(ui, /never lists, loads, or guesses a project/);
  assert.doesNotMatch(ui, /id="resolve-music-track-index"[^>]*value=/);
  assert.doesNotMatch(server, /resolve\/production\/rpc|DeleteProject\(payload|LoadProject\(payload/);
});
