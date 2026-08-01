// Scorecraft canonical narration authority. All durable state lives in temp
// package fixtures; no real narration, project, or production pointer is used.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");
const synth = require("../score-engine/preview-synth.js");
const provenance = require("../score-engine/score-provenance.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-narration-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

function makeWav(duration = 2, sampleRate = 48000, bitDepth = 24, amplitude = 0.1) {
  const frames = Math.round(duration * sampleRate);
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  if (amplitude) {
    for (let index = 0; index < frames; index += 800) {
      left[index] = amplitude;
      right[index] = -amplitude;
    }
  }
  return synth.writeWavBuffer(left, right, sampleRate, bitDepth);
}

function wavProbe(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return { ok: false, reason: "invalid WAV" };
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bitDepth = bytes.readUInt16LE(34);
  const dataBytes = bytes.readUInt32LE(40);
  return { ok: true, container: "wav", sample_rate: sampleRate, channels, codec: bitDepth === 24 ? "pcm_s24le" : "pcm_s16le", bit_depth: bitDepth, duration: dataBytes / (sampleRate * channels * (bitDepth / 8)) };
}

function signalProbe(file) {
  const bytes = fs.readFileSync(file);
  return { ok: true, non_silent: bytes.subarray(44).some((byte) => byte !== 0), rms_dbfs: bytes.subarray(44).some((byte) => byte !== 0) ? -30 : -Infinity };
}

function packageProject(options, duration = 5) {
  const packageDir = path.join(path.dirname(options.musicRoot), "package");
  fs.mkdirSync(path.join(packageDir, "script"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify({ schema_version: 1, package_id: "pkg-test", source: "test" }) + "\n");
  fs.writeFileSync(path.join(packageDir, "script", "script-final.md"), "Approved narration script.\n");
  const { project } = lane.createScoreProject({
    name: "Narration Authority",
    duration_seconds: duration,
    video_package_path: packageDir,
    script_path: path.join(packageDir, "script", "script-final.md"),
  }, options);
  return { project, packageDir };
}

function registrationInput(overrides = {}) {
  return {
    original_filename: "canonical-narration.wav",
    bytes: makeWav(),
    timeline_start_seconds: 1,
    authority_basis: "Explicit operator selection of the approved final narration recording.",
    ...overrides,
  };
}

function narrationOptions(options, extra = {}) {
  return { ...options, narrationProbeImpl: wavProbe, narrationSignalProbeImpl: signalProbe, ...extra };
}

function approveProject(projectId, options) {
  lane.generateCuesForProject(projectId, {}, options);
  lane.approveCueSheet(projectId, options);
  lane.setPalette(projectId, "tech_noir_pulse", options);
  lane.generateCandidates(projectId, { count: 1 }, options);
  lane.approveCandidate(projectId, "candidate-001", options);
}

test("score narration: valid operator-bound narration registers then verifies separately", () => {
  const { options } = tmpEnv();
  const { project } = packageProject(options);
  const registered = lane.registerCanonicalNarration(project.project_id, registrationInput(), narrationOptions(options));
  assert.match(registered.narration_id, /^narration-[a-f0-9]{20}$/);
  let state = lane.getProject(project.project_id, options);
  assert.equal(state.narration.state, "registered");
  assert.equal(state.narration.review_ready, false);
  const verified = lane.verifyCanonicalNarration(project.project_id, narrationOptions(options));
  assert.equal(verified.verified, true);
  state = lane.getProject(project.project_id, options);
  assert.equal(state.narration.state, "verified");
  assert.equal(state.narration.review_ready, true);
  assert.equal(state.readiness.narration_review_ready, true);
});

test("score narration: missing, mutated, deleted, and symlink-substituted media fail closed", () => {
  for (const mutation of ["delete", "same-size", "symlink"]) {
    const { root, options } = tmpEnv();
    const { project } = packageProject(options);
    const registered = lane.registerCanonicalNarration(project.project_id, registrationInput(), narrationOptions(options));
    lane.verifyCanonicalNarration(project.project_id, narrationOptions(options));
    const state = lane.getProject(project.project_id, options);
    const source = path.join(state.dir, registered.relative_path);
    if (mutation === "delete") fs.unlinkSync(source);
    if (mutation === "same-size") { const bytes = fs.readFileSync(source); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(source, bytes); }
    if (mutation === "symlink") { const external = path.join(root, "external.wav"); fs.writeFileSync(external, makeWav()); fs.unlinkSync(source); fs.symlinkSync(external, source); }
    const changed = lane.getProject(project.project_id, options).narration;
    assert.equal(changed.review_ready, false, mutation);
    assert.ok(changed.reasons.some((reason) => /missing|hash_mismatch|unsafe/.test(reason)), `${mutation}: ${changed.reasons}`);
    assert.throws(() => lane.verifyCanonicalNarration(project.project_id, narrationOptions(options)), /missing|changed|unsafe|current narration/i);
  }
});

test("score narration: request shape rejects missing offset and unsafe or unsupported metadata", () => {
  const { options } = tmpEnv();
  const { project } = packageProject(options);
  for (const input of [
    registrationInput({ timeline_start_seconds: undefined }),
    registrationInput({ original_filename: "../voice.wav" }),
    registrationInput({ original_filename: "C:\\voice.wav" }),
    registrationInput({ original_filename: "bad\u0000.wav" }),
    registrationInput({ original_filename: "voice.exe" }),
    registrationInput({ authority_basis: "" }),
  ]) assert.throws(() => lane.registerCanonicalNarration(project.project_id, input, narrationOptions(options)), /offset|filename|format|authority/i);
  assert.throws(() => lane.registerCanonicalNarration(project.project_id, registrationInput({ timeline_start_seconds: 4 }), narrationOptions(options)), /ends after/i);
});

test("score narration: silent, undecodable, and music-artifact bytes are rejected", () => {
  const first = tmpEnv();
  const { project } = packageProject(first.options);
  assert.throws(() => lane.registerCanonicalNarration(project.project_id, registrationInput({ bytes: makeWav(2, 48000, 24, 0) }), narrationOptions(first.options)), /silent|signal/i);
  assert.throws(() => lane.registerCanonicalNarration(project.project_id, registrationInput({ bytes: Buffer.from("not audio") }), narrationOptions(first.options, { narrationProbeImpl: () => ({ ok: false, reason: "bad" }) })), /decodable|audio/i);

  const second = tmpEnv();
  const approved = packageProject(second.options);
  approveProject(approved.project.project_id, second.options);
  const state = lane.getProject(approved.project.project_id, second.options);
  const sketchBytes = fs.readFileSync(path.join(state.dir, "approved", "mix.wav"));
  assert.throws(() => lane.registerCanonicalNarration(approved.project.project_id, registrationInput({ bytes: sketchBytes }), narrationOptions(second.options, { narrationProbeImpl: () => ({ ok: true, container: "wav", sample_rate: 48000, channels: 2, codec: "pcm_s24le", bit_depth: 24, duration: 2 }) })), /music artifact/i);
});

test("score narration: shorter narration with explicit offset is valid and identity is deterministic", () => {
  const { options } = tmpEnv();
  const { project } = packageProject(options, 10);
  const first = lane.registerCanonicalNarration(project.project_id, registrationInput({ timeline_start_seconds: 2 }), narrationOptions(options));
  const second = lane.registerCanonicalNarration(project.project_id, registrationInput({ original_filename: "same-bytes-different-name.wav", timeline_start_seconds: 2 }), narrationOptions(options));
  assert.equal(first.narration_id, second.narration_id);
  assert.equal(second.idempotent, true);
  assert.equal(first.timeline_end_seconds, 4);
});

test("score narration: package identity ignores volatile metadata but binds stable package authority", () => {
  const { options } = tmpEnv();
  const { project, packageDir } = packageProject(options);
  lane.registerCanonicalNarration(project.project_id, registrationInput(), narrationOptions(options));
  lane.verifyCanonicalNarration(project.project_id, narrationOptions(options));
  const manifestPath = path.join(packageDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, updated_at: "2099-01-01T00:00:00Z", local_path: "/another/machine/package" }) + "\n");
  assert.equal(lane.getProject(project.project_id, options).narration.review_ready, true);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, package_id: "different-package" }) + "\n");
  const changed = lane.getProject(project.project_id, options).narration;
  assert.equal(changed.review_ready, false);
  assert.ok(changed.reasons.includes("narration_package_changed"));
});

test("score narration: script changes and pointer/provenance/verification tampering make authority stale", () => {
  for (const mutation of ["script", "pointer", "provenance", "verification", "verification-recomputed"]) {
    const { options } = tmpEnv();
    const { project, packageDir } = packageProject(options);
    const registered = lane.registerCanonicalNarration(project.project_id, registrationInput(), narrationOptions(options));
    lane.verifyCanonicalNarration(project.project_id, narrationOptions(options));
    const state = lane.getProject(project.project_id, options);
    if (mutation === "script") fs.appendFileSync(path.join(packageDir, "script", "script-final.md"), "changed\n");
    if (mutation === "pointer") { const p = path.join(state.dir, "narration", "current.json"); const value = JSON.parse(fs.readFileSync(p)); value.registration_identity = "0".repeat(64); fs.writeFileSync(p, JSON.stringify(value) + "\n"); }
    if (mutation === "provenance") { const p = path.join(state.dir, "narration", "imports", registered.narration_id, "provenance.json"); const value = JSON.parse(fs.readFileSync(p)); value.timeline_start_seconds = 0; fs.writeFileSync(p, JSON.stringify(value) + "\n"); }
    if (mutation === "verification") { const p = path.join(state.dir, "narration", "imports", registered.narration_id, "verification.json"); const value = JSON.parse(fs.readFileSync(p)); value.detected_media = null; fs.writeFileSync(p, JSON.stringify(value) + "\n"); }
    if (mutation === "verification-recomputed") {
      const importDir = path.join(state.dir, "narration", "imports", registered.narration_id);
      const record = JSON.parse(fs.readFileSync(path.join(importDir, "provenance.json")));
      const p = path.join(importDir, "verification.json");
      const value = JSON.parse(fs.readFileSync(p));
      value.detected_media = { ...value.detected_media, sample_rate: 44100 };
      value.verification_identity = provenance.hashCanonical({
        schema_version: 1,
        role: "canonical_narration_verification",
        registration_identity: record.registration_identity,
        source_sha256: record.source_sha256,
        detected_media: value.detected_media,
      });
      fs.writeFileSync(p, JSON.stringify(value) + "\n");
    }
    const changed = lane.getProject(project.project_id, options).narration;
    assert.equal(changed.review_ready, false, mutation);
    assert.ok(changed.reasons.length, mutation);
    if (mutation === "verification-recomputed") {
      assert.throws(() => lane.verifyCanonicalNarration(project.project_id, narrationOptions(options)), /verification.*authority|media properties/i);
    }
  }
});

test("score narration: registration and staleness never alter music production pointers", () => {
  const { options } = tmpEnv();
  const { project, packageDir } = packageProject(options, 3);
  approveProject(project.project_id, options);
  const productionBytes = makeWav(3);
  lane.importProductionMix(project.project_id, { original_filename: "production.wav", bytes: productionBytes }, { ...options, probeImpl: wavProbe });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  lane.prepareProductionResolvePackage(project.project_id, options);
  const before = lane.getProject(project.project_id, options);
  const productionPointer = fs.readFileSync(path.join(before.dir, "production", "current.json"));
  const resolvePointer = fs.readFileSync(path.join(before.dir, "production", "resolve", "current.json"));
  lane.registerCanonicalNarration(project.project_id, registrationInput({ timeline_start_seconds: 0 }), narrationOptions(options));
  lane.verifyCanonicalNarration(project.project_id, narrationOptions(options));
  fs.appendFileSync(path.join(packageDir, "script", "script-final.md"), "stale narration\n");
  const after = lane.getProject(project.project_id, options);
  assert.equal(after.readiness.production.verified, true);
  assert.equal(after.readiness.resolve_ready, true);
  assert.equal(after.narration.review_ready, false);
  assert.deepEqual(fs.readFileSync(path.join(after.dir, "production", "current.json")), productionPointer);
  assert.deepEqual(fs.readFileSync(path.join(after.dir, "production", "resolve", "current.json")), resolvePointer);
});

test("score narration: legacy projects remain readable and read-only status rewrites nothing", () => {
  const { options } = tmpEnv();
  const { project } = packageProject(options);
  let state = lane.getProject(project.project_id, options);
  assert.equal(state.narration.state, "not_registered");
  assert.equal(state.narration.review_ready, false);
  const before = fs.statSync(path.join(state.dir, "score-project.json")).mtimeMs;
  state = lane.getProject(project.project_id, options);
  assert.equal(fs.existsSync(path.join(state.dir, "narration")), false);
  assert.equal(fs.statSync(path.join(state.dir, "score-project.json")).mtimeMs, before);
});

test("score narration: explicit clear archives only the pointer and preserves immutable imports", () => {
  const { options } = tmpEnv();
  const { project } = packageProject(options);
  const registered = lane.registerCanonicalNarration(project.project_id, registrationInput(), narrationOptions(options));
  const state = lane.getProject(project.project_id, options);
  const source = path.join(state.dir, registered.relative_path);
  const cleared = lane.clearCanonicalNarration(project.project_id, options);
  assert.equal(cleared.cleared, true);
  assert.ok(fs.existsSync(source));
  assert.equal(lane.getProject(project.project_id, options).narration.state, "not_registered");
  assert.ok(fs.readdirSync(path.join(state.dir, "narration", "history")).length === 1);
});

test("score narration API: nonce, local Host, JSON, canonical base64, and no server path are enforced", async () => {
  const { options } = tmpEnv();
  const { project } = packageProject(options);
  const oldSettings = process.env.SCORE_ENGINE_SETTINGS_PATH;
  const oldRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer({ scoreEngine: { narrationProbeImpl: wavProbe, narrationSignalProbeImpl: signalProbe } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = (body, headers = {}, route = "/api/score/narration/register") => new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: route, method: "POST", headers: { Host: "127.0.0.1:8010", "Content-Type": "application/json", "Content-Length": bytes.length, ...headers } }, (res) => { let raw = ""; res.on("data", (chunk) => { raw += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: raw.startsWith("{") ? JSON.parse(raw) : raw })); });
    req.on("error", reject); req.end(bytes);
  });
  const payload = { project_id: project.project_id, original_filename: "voice.wav", timeline_start_seconds: 1, authority_basis: "Explicit operator selection.", data_base64: makeWav().toString("base64") };
  try {
    assert.equal((await request(payload)).status, 403);
    const auth = { "x-vidtoolz-local-write-nonce": packageEngineServer.localWriteNonce() };
    assert.equal((await request({ ...payload, path: "/tmp/voice.wav" }, auth)).status, 400);
    assert.equal((await request({ ...payload, data_base64: payload.data_base64.replace(/A/, "B") + "=" }, auth)).status, 400);
    assert.equal((await request(payload, { ...auth, "Content-Type": "text/plain" })).status, 415);
    assert.equal((await request(payload, { ...auth, Host: "evil.example" })).status, 403);
    assert.equal((await request(payload, { ...auth, Origin: "https://evil.example" })).status, 403);
    assert.equal((await request(payload, auth)).status, 200);
    assert.equal((await request({ ...payload, project_id: "wrong" }, auth)).status, 404);
    assert.equal((await request({ project_id: project.project_id }, auth, "/api/score/narration/verify")).status, 200);
    assert.equal((await request({ project_id: project.project_id }, auth, "/api/score/narration/clear")).status, 400);
    assert.equal((await request({ project_id: project.project_id, confirm_clear: true }, auth, "/api/score/narration/clear")).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (oldSettings === undefined) delete process.env.SCORE_ENGINE_SETTINGS_PATH; else process.env.SCORE_ENGINE_SETTINGS_PATH = oldSettings;
    if (oldRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT; else process.env.SCORE_ENGINE_MUSIC_ROOT = oldRoot;
  }
});

test("score narration UI exposes escaped authority status without conflating artistic approval", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  assert.match(html, /Register canonical narration/);
  assert.match(html, /Verify narration/);
  assert.match(html, /Replace canonical narration/);
  assert.match(html, /human artistic approval/i);
  assert.match(html, /esc\(N\.original_filename/);
  assert.doesNotMatch(html, /narration[^\n]{0,80}innerHTML\s*=\s*N\.original_filename/);
});
