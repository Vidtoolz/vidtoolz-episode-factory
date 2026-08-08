// Scorecraft P6 Resolve integration and exact-program acceptance. Fixtures are
// disposable; external Resolve execution is covered by the operator harness.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");
const provenance = require("../score-engine/score-provenance.js");
const synth = require("../score-engine/preview-synth.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-resolve-roundtrip-"));
  return {
    root,
    options: {
      settingsPath: path.join(root, "settings.json"),
      musicRoot: path.join(root, "music"),
      productionSignalProbeImpl: () => ({ ok: true, analyzer: "ffmpeg_astats_v1", peak_dbfs: -12, rms_dbfs: -24, dc_offset: 0, sample_count: 144000 }),
      narrationSignalProbeImpl: () => ({ ok: true, non_silent: true, peak_dbfs: -12, rms_dbfs: -24 }),
      programProbeImpl: () => ({
        ok: true, container: "mov", duration: 4, video: { codec: "h264", width: 1080, height: 1920, frame_rate: "24/1" },
        audio: { codec: "aac", sample_rate: 48000, channels: 2 },
      }),
      programSignalProbeImpl: () => ({ ok: true, analyzer: "ffmpeg_astats_v1", peak_dbfs: -6, rms_dbfs: -20, dc_offset: 0, sample_count: 192000 }),
    },
  };
}

function wav(duration = 4, amplitude = 0.1) {
  const frames = duration * 48000;
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let index = 0; index < frames; index += 1200) { left[index] = amplitude; right[index] = -amplitude; }
  return synth.writeWavBuffer(left, right, 48000, 24);
}

function wavProbe(file) {
  const bytes = fs.readFileSync(file);
  return { ok: true, container: "wav", sample_rate: 48000, channels: 2, codec: "pcm_s24le", bit_depth: 24, duration: (bytes.length - 44) / (48000 * 2 * 3) };
}

function projectFixture(options) {
  const packageDir = path.join(path.dirname(options.musicRoot), "package");
  fs.mkdirSync(path.join(packageDir, "script"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify({ package_id: "p6-fixture" }) + "\n");
  fs.writeFileSync(path.join(packageDir, "script", "script-final.md"), "P6 narration script.\n");
  const { project } = lane.createScoreProject({
    name: "P6 Resolve fixture", duration_seconds: 4,
    video_package_path: packageDir, script_path: path.join(packageDir, "script", "script-final.md"),
  }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options);
  const handoff = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const imported = lane.importProductionMix(project.project_id, {
    original_filename: "operator-production.wav", bytes: wav(), handoff_type: "reaper",
    handoff_contract_hash: handoff.handoff_contract_hash, render_purpose: "production",
    realization_profile_id: "operator_patched_production_v1",
  }, { ...options, probeImpl: wavProbe });
  const verification = lane.verifyProductionMix(project.project_id, { ...options, productionMixId: imported.production_mix_id, probeImpl: wavProbe });
  const review = lane.reviewProductionMix(project.project_id, {
    production_mix_id: imported.production_mix_id, decision: "approved",
    expected_production_mix_sha256: verification.production_mix_sha256,
    authority_basis: "Disposable P6 workflow-state fixture; not artistic approval.",
  }, options);
  lane.selectProductionMix(project.project_id, {
    production_mix_id: imported.production_mix_id,
    expected_production_mix_sha256: verification.production_mix_sha256,
    expected_verification_identity: verification.verification_identity,
    expected_listening_review_identity: review.review_identity,
  }, options);
  lane.prepareProductionResolvePackage(project.project_id, options);
  return { project, packageDir, imported };
}

function registerNarration(projectId, options) {
  lane.registerCanonicalNarration(projectId, {
    original_filename: "narration.wav", bytes: wav(2, 0.05), timeline_start_seconds: 1,
    authority_basis: "Explicit disposable canonical narration fixture.",
  }, { ...options, narrationProbeImpl: wavProbe });
  return lane.verifyCanonicalNarration(projectId, { ...options, narrationProbeImpl: wavProbe });
}

function prepare(projectId, options) {
  return lane.prepareResolveIntegration(projectId, {
    frame_rate: "24/1", timeline_start_timecode: "01:00:00:00",
  }, options);
}

test("score Resolve P6: integration requires current narration and binds deterministic timing authority", () => {
  const { options } = tmpEnv();
  const { project, imported } = projectFixture(options);
  assert.throws(() => prepare(project.project_id, options), (error) => error.statusCode === 409 && /narration/i.test(error.message));
  const narration = registerNarration(project.project_id, options);
  const first = prepare(project.project_id, options);
  const second = prepare(project.project_id, options);
  assert.equal(first.resolve_integration_identity, second.resolve_integration_identity);
  const state = lane.getProject(project.project_id, options);
  const record = JSON.parse(fs.readFileSync(path.join(state.dir, first.relative_dir, "resolve-integration.json"), "utf8"));
  assert.equal(record.production_mix_id, imported.production_mix_id);
  assert.equal(record.narration_verification_identity, narration.verification_identity);
  assert.equal(record.timeline_contract.music_start_seconds, 0);
  assert.deepEqual(record.timeline_contract.frame_rate, { numerator: 24, denominator: 1 });
  assert.ok(record.timeline_contract.cue_markers.every((cue) => Number.isInteger(cue.start_frame) && Number.isInteger(cue.end_frame)));
  assert.equal(state.resolve_integration.current, true);
});

test("score Resolve P6: exact returned program passes QC then begins separate picture/sound review pending", () => {
  const { options } = tmpEnv();
  const { project } = projectFixture(options);
  registerNarration(project.project_id, options);
  const integration = prepare(project.project_id, options);
  const state = lane.getProject(project.project_id, options);
  const inbox = path.join(state.dir, "production", "resolve-return-inbox");
  fs.writeFileSync(path.join(inbox, "program.mov"), Buffer.from("disposable-program-bytes"));
  const registered = lane.registerResolveProgram(project.project_id, {
    inbox_filename: "program.mov", resolve_integration_identity: integration.resolve_integration_identity,
    authority_basis: "Operator registered this exact disposable export against the issued integration handoff.",
  }, options);
  const verified = lane.verifyResolveProgram(project.project_id, { resolve_program_id: registered.resolve_program_id }, options);
  assert.equal(verified.verified, true);
  assert.equal(verified.program_sha256, provenance.sha256(Buffer.from("disposable-program-bytes")));
  const after = lane.getProject(project.project_id, options).resolve_roundtrip;
  assert.equal(after.technical_status, "passed");
  assert.equal(after.picture_sound_review_status, "pending");
  assert.equal(after.current, true);
});

test("score Resolve P6: return paths and integration identity fail closed", () => {
  const { root, options } = tmpEnv();
  const { project } = projectFixture(options);
  registerNarration(project.project_id, options);
  const integration = prepare(project.project_id, options);
  const state = lane.getProject(project.project_id, options);
  const inbox = path.join(state.dir, "production", "resolve-return-inbox");
  fs.writeFileSync(path.join(root, "external.mov"), Buffer.from("external"));
  fs.symlinkSync(path.join(root, "external.mov"), path.join(inbox, "escape.mov"));
  for (const input of [
    { inbox_filename: "../program.mov", resolve_integration_identity: integration.resolve_integration_identity },
    { inbox_filename: "escape.mov", resolve_integration_identity: integration.resolve_integration_identity },
    { inbox_filename: "missing.mov", resolve_integration_identity: "0".repeat(64) },
  ]) assert.throws(() => lane.registerResolveProgram(project.project_id, { ...input, authority_basis: "Explicit operator registration." }, options), /filename|symbolic|integration|current|found/i);
});

test("score Resolve P6: program QC rejects missing audio, silence, clipping, duration, and frame-rate drift", () => {
  const failures = [
    [{ ok: true, container: "mov", duration: 4, video: { codec: "h264", width: 1080, height: 1920, frame_rate: "24/1" }, audio: null }, null, /audio stream/i],
    [null, { ok: true, peak_dbfs: -Infinity, rms_dbfs: -Infinity, dc_offset: 0, sample_count: 1 }, /silent/i],
    [null, { ok: true, peak_dbfs: 0, rms_dbfs: -4, dc_offset: 0, sample_count: 1 }, /clipping/i],
    [{ ok: true, container: "mov", duration: 3, video: { codec: "h264", width: 1080, height: 1920, frame_rate: "24/1" }, audio: { codec: "aac", sample_rate: 48000, channels: 2 } }, null, /duration/i],
    [{ ok: true, container: "mov", duration: 4, video: { codec: "h264", width: 1080, height: 1920, frame_rate: "30/1" }, audio: { codec: "aac", sample_rate: 48000, channels: 2 } }, null, /frame rate/i],
  ];
  for (const [probe, signal, expected] of failures) {
    const env = tmpEnv();
    const { project } = projectFixture(env.options);
    registerNarration(project.project_id, env.options);
    const integration = prepare(project.project_id, env.options);
    const state = lane.getProject(project.project_id, env.options);
    fs.writeFileSync(path.join(state.dir, "production", "resolve-return-inbox", "program.mov"), Buffer.from("program"));
    const registered = lane.registerResolveProgram(project.project_id, {
      inbox_filename: "program.mov", resolve_integration_identity: integration.resolve_integration_identity,
      authority_basis: "Disposable failure fixture.",
    }, env.options);
    assert.throws(() => lane.verifyResolveProgram(project.project_id, { resolve_program_id: registered.resolve_program_id }, {
      ...env.options, ...(probe ? { programProbeImpl: () => probe } : {}), ...(signal ? { programSignalProbeImpl: () => signal } : {}),
    }), expected);
  }
});

test("score Resolve P6: integrated review is exact-byte bound and upstream changes make old returns historical", () => {
  const { options } = tmpEnv();
  const { project, packageDir } = projectFixture(options);
  registerNarration(project.project_id, options);
  const integration = prepare(project.project_id, options);
  const state = lane.getProject(project.project_id, options);
  fs.writeFileSync(path.join(state.dir, "production", "resolve-return-inbox", "program.mov"), Buffer.from("program-a"));
  const registered = lane.registerResolveProgram(project.project_id, {
    inbox_filename: "program.mov", resolve_integration_identity: integration.resolve_integration_identity,
    authority_basis: "Disposable integration registration.",
  }, options);
  const verified = lane.verifyResolveProgram(project.project_id, { resolve_program_id: registered.resolve_program_id }, options);
  const review = lane.reviewResolveProgram(project.project_id, {
    resolve_program_id: registered.resolve_program_id, decision: "approved",
    expected_program_sha256: verified.program_sha256,
    expected_verification_identity: verified.verification_identity,
    authority_basis: "Disposable exact-program workflow review; not artistic approval.",
  }, options);
  assert.equal(review.decision, "approved");
  assert.equal(lane.getProject(project.project_id, options).resolve_roundtrip.picture_sound_review_status, "approved");
  const program = path.join(state.dir, registered.relative_path);
  fs.appendFileSync(program, "changed");
  assert.equal(lane.getProject(project.project_id, options).resolve_roundtrip.current, false);
  assert.throws(() => lane.reviewResolveProgram(project.project_id, {
    resolve_program_id: registered.resolve_program_id, decision: "approved",
    expected_program_sha256: verified.program_sha256, expected_verification_identity: verified.verification_identity,
    authority_basis: "Stale review attempt.",
  }, options), (error) => error.statusCode === 409);

  fs.writeFileSync(path.join(packageDir, "script", "script-final.md"), "Timing-relevant narration authority changed.\n");
  const stale = lane.getProject(project.project_id, options).resolve_integration;
  assert.equal(stale.current, false);
});

test("score Resolve P6: cue drift and explicit final-selection changes stale only the old integration", () => {
  for (const mutation of ["cue", "selection"]) {
    const { options } = tmpEnv();
    const { project } = projectFixture(options);
    registerNarration(project.project_id, options);
    prepare(project.project_id, options);
    const state = lane.getProject(project.project_id, options);
    if (mutation === "cue") {
      fs.appendFileSync(path.join(state.dir, "approved", "resolve-import", "cue-markers.csv"), "drift\n");
    } else {
      const issued = state.approved.daw_handoffs.reaper;
      const importedB = lane.importProductionMix(project.project_id, {
        original_filename: "operator-production-b.wav", bytes: wav(4, 0.2), handoff_type: "reaper",
        handoff_contract_hash: issued.handoff_contract_hash, render_purpose: "production",
        realization_profile_id: "operator_patched_production_v1",
      }, { ...options, probeImpl: wavProbe });
      const verificationB = lane.verifyProductionMix(project.project_id, { ...options, productionMixId: importedB.production_mix_id, probeImpl: wavProbe });
      const reviewB = lane.reviewProductionMix(project.project_id, {
        production_mix_id: importedB.production_mix_id, decision: "approved",
        expected_production_mix_sha256: verificationB.production_mix_sha256,
        authority_basis: "Disposable replacement selection fixture.",
      }, options);
      lane.selectProductionMix(project.project_id, {
        production_mix_id: importedB.production_mix_id,
        expected_production_mix_sha256: verificationB.production_mix_sha256,
        expected_verification_identity: verificationB.verification_identity,
        expected_listening_review_identity: reviewB.review_identity,
      }, options);
    }
    const changed = lane.getProject(project.project_id, options).resolve_integration;
    assert.equal(changed.current, false, mutation);
    assert.ok(changed.reasons.some((reason) => /cue|score_authority|selected_mix/.test(reason)), `${mutation}: ${changed.reasons}`);
  }
});

test("score Resolve P6: duplicated timeline metadata cannot weaken the hashed integration contract", () => {
  const { options } = tmpEnv();
  const { project } = projectFixture(options);
  registerNarration(project.project_id, options);
  const integration = prepare(project.project_id, options);
  const state = lane.getProject(project.project_id, options);
  const provenancePath = path.join(state.dir, integration.relative_dir, "resolve-integration.json");
  const record = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  record.timeline_contract.frame_rate = { numerator: 30, denominator: 1 };
  fs.writeFileSync(provenancePath, JSON.stringify(record, null, 2) + "\n");
  const changed = lane.getProject(project.project_id, options).resolve_integration;
  assert.equal(changed.current, false);
  assert.ok(changed.reasons.includes("resolve_integration_provenance_invalid"));
});

test("score Resolve P6: verification and review records cannot claim another program id", () => {
  const { options } = tmpEnv();
  const { project } = projectFixture(options);
  registerNarration(project.project_id, options);
  const integration = prepare(project.project_id, options);
  const state = lane.getProject(project.project_id, options);
  fs.writeFileSync(path.join(state.dir, "production", "resolve-return-inbox", "program.mov"), Buffer.from("semantic-program"));
  const registered = lane.registerResolveProgram(project.project_id, {
    inbox_filename: "program.mov", resolve_integration_identity: integration.resolve_integration_identity,
    authority_basis: "Disposable semantic receipt fixture.",
  }, options);
  const verified = lane.verifyResolveProgram(project.project_id, { resolve_program_id: registered.resolve_program_id }, options);
  lane.reviewResolveProgram(project.project_id, {
    resolve_program_id: registered.resolve_program_id, decision: "approved",
    expected_program_sha256: verified.program_sha256,
    expected_verification_identity: verified.verification_identity,
    authority_basis: "Disposable semantic receipt review.",
  }, options);
  const verificationPath = path.join(state.dir, "production", "resolve-returns", registered.resolve_program_id, "verification.json");
  const verification = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
  verification.resolve_program_id = "program-00000000000000000000";
  fs.writeFileSync(verificationPath, JSON.stringify(verification, null, 2) + "\n");
  const changed = lane.getProject(project.project_id, options).resolve_roundtrip;
  assert.equal(changed.technical_status, "pending");
  assert.equal(changed.picture_sound_review_status, "pending");
  const history = lane.listResolvePrograms(project.project_id, options);
  assert.equal(history[0].technical_status, "pending");
  assert.equal(history[0].picture_sound_review_status, "pending");
});

test("score Resolve P6: returned-program history preserves independent QC and review decisions", () => {
  const { options } = tmpEnv();
  const { project } = projectFixture(options);
  registerNarration(project.project_id, options);
  const integration = prepare(project.project_id, options);
  const state = lane.getProject(project.project_id, options);
  const inbox = path.join(state.dir, "production", "resolve-return-inbox");
  const decisions = ["rejected", "approved"];
  for (let index = 0; index < decisions.length; index += 1) {
    const filename = `program-${index + 1}.mov`;
    fs.writeFileSync(path.join(inbox, filename), Buffer.from(`program-${index + 1}`));
    const registered = lane.registerResolveProgram(project.project_id, {
      inbox_filename: filename, resolve_integration_identity: integration.resolve_integration_identity,
      authority_basis: `Disposable Resolve return ${index + 1}.`,
    }, options);
    const verified = lane.verifyResolveProgram(project.project_id, { resolve_program_id: registered.resolve_program_id }, options);
    lane.reviewResolveProgram(project.project_id, {
      resolve_program_id: registered.resolve_program_id, decision: decisions[index],
      expected_program_sha256: verified.program_sha256,
      expected_verification_identity: verified.verification_identity,
      authority_basis: `Disposable ${decisions[index]} picture/sound decision.`,
    }, options);
  }
  const history = lane.listResolvePrograms(project.project_id, options);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((item) => item.picture_sound_review_status).sort(), ["approved", "rejected"]);
  assert.equal(lane.getProject(project.project_id, options).resolve_roundtrip.picture_sound_review_status, "approved");
});

test("score Resolve P6 API: nonce-protected prepare, register, verify, and exact review exercise production routes", async () => {
  const { options } = tmpEnv();
  const { project } = projectFixture(options);
  registerNarration(project.project_id, options);
  const oldSettings = process.env.SCORE_ENGINE_SETTINGS_PATH;
  const oldRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer({ scoreEngine: options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = (route, body, nonce = "") => new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: route, method: "POST", headers: { Host: "127.0.0.1:8010", "Content-Type": "application/json", "Content-Length": bytes.length, ...(nonce ? { "x-vidtoolz-local-write-nonce": nonce } : {}) } }, (res) => {
      let raw = ""; res.on("data", (chunk) => { raw += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on("error", reject); req.end(bytes);
  });
  const get = (route) => new Promise((resolve, reject) => http.get({ hostname: "127.0.0.1", port: server.address().port, path: route, headers: { Host: "127.0.0.1:8010" } }, (res) => { let raw = ""; res.on("data", (chunk) => { raw += chunk; }); res.on("end", () => resolve(JSON.parse(raw))); }).on("error", reject));
  try {
    const status = await get("/api/package-engine/status");
    const nonce = (status.data || status).localWriteNonce;
    assert.equal((await request("/api/score/resolve/integration", { project_id: project.project_id, frame_rate: "24/1", timeline_start_timecode: "01:00:00:00" })).status, 403);
    const preparedResponse = await request("/api/score/resolve/integration", { project_id: project.project_id, frame_rate: "24/1", timeline_start_timecode: "01:00:00:00" }, nonce);
    assert.equal(preparedResponse.status, 200, JSON.stringify(preparedResponse.body));
    const prepared = preparedResponse.body.data || preparedResponse.body;
    const state = lane.getProject(project.project_id, options);
    fs.writeFileSync(path.join(state.dir, "production", "resolve-return-inbox", "public.mov"), Buffer.from("public-program"));
    const registeredResponse = await request("/api/score/resolve/return/register", { project_id: project.project_id, inbox_filename: "public.mov", resolve_integration_identity: prepared.resolve_integration_identity, authority_basis: "Public route disposable return registration." }, nonce);
    assert.equal(registeredResponse.status, 200, JSON.stringify(registeredResponse.body));
    const registered = registeredResponse.body.data || registeredResponse.body;
    const verifiedResponse = await request("/api/score/resolve/return/verify", { project_id: project.project_id, resolve_program_id: registered.resolve_program_id }, nonce);
    assert.equal(verifiedResponse.status, 200, JSON.stringify(verifiedResponse.body));
    const verified = verifiedResponse.body.data || verifiedResponse.body;
    const reviewed = await request("/api/score/resolve/return/review", { project_id: project.project_id, resolve_program_id: registered.resolve_program_id, decision: "approved", expected_program_sha256: verified.program_sha256, expected_verification_identity: verified.verification_identity, authority_basis: "Public route disposable exact-byte picture/sound review." }, nonce);
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (oldSettings === undefined) delete process.env.SCORE_ENGINE_SETTINGS_PATH; else process.env.SCORE_ENGINE_SETTINGS_PATH = oldSettings;
    if (oldRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT; else process.env.SCORE_ENGINE_MUSIC_ROOT = oldRoot;
  }
});

test("score Resolve P6 UI exposes explicit timing, return QC, and exact picture/sound review without conflating music approval", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  assert.match(html, /Prepare score-in-picture handoff/);
  assert.match(html, /resolve-frame-rate/);
  assert.match(html, /resolve-start-timecode/);
  assert.match(html, /Register returned program/);
  assert.match(html, /Run program QC/);
  assert.match(html, /Approve exact picture \+ sound/);
  assert.match(html, /expected_program_sha256:R\.program_sha256/);
  assert.match(html, /standalone music approval is not reused/i);
});
