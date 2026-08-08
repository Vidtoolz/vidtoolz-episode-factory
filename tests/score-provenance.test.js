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

test("score provenance P3: DAW handoff identity is semantic, stable, and approval-bound", () => {
  const hashes = ["1", "2", "3", "4", "5", "6", "7", "8"].map((digit) => digit.repeat(64));
  const approved = {
    approved_candidate: "candidate-001",
    approved_at: "2026-01-01T00:00:00.000Z",
    identity: {
      candidate_input_hash: hashes[0], candidate_content_hash: hashes[1],
      cue_sheet_hash: hashes[2], music_plan_hash: hashes[3],
      composer_contract_hash: hashes[4], render_contract_hash: hashes[5],
      candidate_artifact_manifest_hash: hashes[6], approval_artifact_manifest_hash: hashes[7],
    },
    render_contract: {
      sample_rate: 48000, bit_depth: 24, channels: 2,
      target_duration_seconds: 10, duration_exact: true, duration_tolerance_seconds: 0.05,
    },
  };
  const args = {
    project: { project_id: "score-1" }, candidate: { candidate_id: "candidate-001" }, approved,
    handoffType: "reaper", artifactManifestHash: "a".repeat(64),
  };
  const first = provenance.dawHandoffIdentity(provenance.dawHandoffContract(args));
  const timestampOnly = provenance.dawHandoffIdentity(provenance.dawHandoffContract({
    ...args, approved: { ...approved, approved_at: "2030-02-02T00:00:00.000Z" },
  }));
  assert.equal(timestampOnly, first, "descriptive timestamps are not handoff authority");
  const changedApproval = structuredClone(approved);
  changedApproval.identity.cue_sheet_hash = "9".repeat(64);
  assert.notEqual(
    provenance.dawHandoffIdentity(provenance.dawHandoffContract({ ...args, approved: changedApproval })),
    first,
    "contract-relevant approved identity changes must invalidate the handoff",
  );
});

test("score provenance: canonical identity rejects omissions and preserves distinct finite numbers", () => {
  assert.throws(() => provenance.canonicalStringify({ material: undefined }), /undefined/);
  assert.throws(() => provenance.canonicalStringify(new Array(1)), /sparse/);
  assert.notEqual(
    provenance.canonicalStringify({ value: 1.000000000000001 }),
    provenance.canonicalStringify({ value: 1.000000000000002 }),
    "distinct IEEE-754 inputs must not collapse through decimal rounding",
  );
  assert.throws(() => provenance.canonicalStringify({ value: Number.NaN }), /non-finite/);
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

test("score provenance: artifact manifest identity is independent of declaration order", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-manifest-order-"));
  fs.writeFileSync(path.join(root, "a.txt"), "a");
  fs.writeFileSync(path.join(root, "b.txt"), "b");
  const declarations = [
    { logical_role: "alpha", relative_path: "a.txt" },
    { logical_role: "beta", relative_path: "b.txt" },
  ];
  const first = provenance.buildArtifactManifest(root, declarations);
  const second = provenance.buildArtifactManifest(root, [...declarations].reverse());
  assert.equal(provenance.artifactManifestHash(first), provenance.artifactManifestHash(second));
  assert.deepEqual(first, second);
});

test("score provenance: manifest files cannot be symlinks outside the authority root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-manifest-link-"));
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.mid`);
  fs.writeFileSync(outside, "external midi");
  fs.symlinkSync(outside, path.join(root, "linked.mid"));
  assert.throws(
    () => provenance.buildArtifactManifest(root, [{ logical_role: "midi", relative_path: "linked.mid" }]),
    /symbolic link|symlink/i,
  );
});

// Regression (Scorecraft audit P2 finding 2): sha256File must hash in bounded
// chunks, not load the whole file into memory with a single readFileSync.
// Verifying an approved 100 MB WAV must not spike memory.
test("score provenance: sha256File hashes large files without whole-file reads", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "score-engine", "score-provenance.js"), "utf8");
  const body = src.slice(src.indexOf("function sha256File"));
  assert.ok(
    !/readFileSync/.test(body.slice(0, body.indexOf("\n}"))),
    "sha256File must stream/chunk reads, not readFileSync the whole file",
  );
  // And it still produces the correct digest.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-sha-"));
  const file = path.join(root, "blob.bin");
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 7, 0xab); // spans multiple 1 MB chunks
  fs.writeFileSync(file, bytes);
  assert.equal(provenance.sha256File(file), provenance.sha256(bytes));
});

// Regression (Scorecraft audit P2 finding 5): cueSheetIdentity must tolerate a
// cue whose optional fields are absent (undefined) by omitting those keys —
// matching JSON round-trip semantics — instead of crashing hashCanonical with
// "Canonical identity cannot contain undefined." The strict top-level
// canonicalStringify contract (throw on explicit undefined) is preserved.
test("score provenance: cue identity skips absent optional fields instead of throwing", () => {
  const sparse = { cue_id: "C1" }; // every optional field undefined
  const hash = provenance.hashCanonical(provenance.cueSheetIdentity([sparse]));
  assert.ok(/^[a-f0-9]{64}$/.test(hash), "sparse cue hashes instead of throwing");
  // A round-tripped (JSON-parsed) cue with the same material content hashes identically.
  const roundTripped = JSON.parse(JSON.stringify(provenance.cueSheetIdentity([sparse]))).cues[0];
  assert.equal(
    provenance.hashCanonical(provenance.cueSheetIdentity([sparse])),
    provenance.hashCanonical(provenance.cueSheetIdentity([roundTripped])),
    "undefined-vs-absent is identity-neutral",
  );
  // The strict serializer still rejects an explicit undefined at the top level.
  assert.throws(() => provenance.canonicalStringify({ material: undefined }), /undefined/);
});
