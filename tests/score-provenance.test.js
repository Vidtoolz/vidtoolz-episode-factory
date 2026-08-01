// Scorecraft canonical identity and immutable artifact-manifest tests.
const { assert, fs, os, path, test } = require("./_helpers.js");
const provenance = require("../score-engine/score-provenance.js");
const composer = require("../score-engine/composer.js");

function cue(overrides = {}) {
  return {
    cue_id: "C001", name: "Opening", start_seconds: 0, end_seconds: 10,
    function: "hook", emotion: "curious", energy: 3, density: 2,
    tempo_bpm: 120, key: "D minor", time_signature: "4/4",
    instrument_roles: { pulse: "soft" }, arrangement_notes: "restrained",
    hit_points: [2.5], dialogue_safe: true, ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    palette_id: "tech_noir_pulse", palette_display_name: "Tech Noir Pulse",
    description: "dark pulse", roles: {
      pulse: { character: "analog", register: "mid", profile_id: "arturia_analog_pulse", profile_display_name: "Analog pulse", vendor: "Arturia", preset_hint: "soft", track_template_path: "/machine-specific/template" },
    }, mix_guidance: ["leave room for speech"], ...overrides,
  };
}

function identity(overrides = {}) {
  const project = { duration_seconds: 10, dialogue_density: "high", palette_id: "tech_noir_pulse", video_package_path: overrides.projectPath || null };
  const candidate = { seed: 7, palette_id: "tech_noir_pulse", lane_gains: {}, pulse_register: "mid_high", harmonic_drift: true, lanes: ["pulse"] };
  const settings = { default_export_sample_rate: 48000, default_export_bit_depth: 24, duration_exact_export: true };
  const contract = provenance.renderContract({ project, candidate, settings });
  return provenance.candidateIdentity({ project, cues: overrides.cues || [cue()], musicPlan: overrides.musicPlan || plan(), candidate, composerContract: overrides.composerContract || composer.COMPOSER_CONTRACT, contract });
}

test("score provenance: canonical serialization and aggregate hashes are deterministic", () => {
  assert.equal(provenance.canonicalStringify({ z: 1, a: { y: 2, x: -0 } }), '{"a":{"x":0,"y":2},"z":1}');
  assert.deepEqual(identity(), identity());
});

test("score provenance: absolute project and template locations do not affect identity", () => {
  const a = identity({ projectPath: "/mnt/one/project" });
  const b = identity({ projectPath: "/srv/another/project" });
  assert.deepEqual(a, b);
  const otherPlan = plan();
  otherPlan.roles.pulse.track_template_path = "/different/machine/template";
  assert.equal(identity().music_plan_hash, identity({ musicPlan: otherPlan }).music_plan_hash);
});

test("score provenance: every material cue edit changes cue identity", () => {
  const base = identity().cue_sheet_hash;
  for (const changed of [
    cue({ name: "Renamed" }), cue({ start_seconds: 0.5 }), cue({ end_seconds: 9.5 }),
    cue({ tempo_bpm: 90 }), cue({ key: "E minor" }), cue({ time_signature: "3/4" }),
    cue({ energy: 4 }), cue({ dialogue_safe: false }), cue({ hit_points: [3] }),
  ]) assert.notEqual(identity({ cues: [changed] }).cue_sheet_hash, base);
});

test("score provenance: palette, instrument assignment, composer, and render contracts are distinct authorities", () => {
  const base = identity();
  assert.notEqual(identity({ musicPlan: plan({ palette_id: "broadcast_explainer" }) }).music_plan_hash, base.music_plan_hash);
  const assigned = plan();
  assigned.roles.pulse.profile_id = "another_profile";
  assert.notEqual(identity({ musicPlan: assigned }).music_plan_hash, base.music_plan_hash);
  assert.notEqual(identity({ composerContract: { ...composer.COMPOSER_CONTRACT, algorithm_version: "future" } }).composer_contract_hash, base.composer_contract_hash);
});

test("score provenance: artifact manifests bind roles, paths, bytes, and reject traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-manifest-"));
  fs.writeFileSync(path.join(root, "one.mid"), "midi");
  const manifest = provenance.buildArtifactManifest(root, [{ logical_role: "midi", relative_path: "one.mid" }]);
  assert.equal(provenance.verifyArtifactManifest(root, manifest).valid, true);
  fs.appendFileSync(path.join(root, "one.mid"), "tamper");
  assert.ok(provenance.verifyArtifactManifest(root, manifest).failures.some((failure) => failure.reason === "candidate_artifact_hash_mismatch"));
  assert.throws(() => provenance.buildArtifactManifest(root, [{ logical_role: "escape", relative_path: "../escape" }]), /Unsafe artifact path/);
});
