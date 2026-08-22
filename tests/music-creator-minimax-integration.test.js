const crypto = require("node:crypto");
const { assert, fs, http, os, packageEngineServer, path, test } = require("./_helpers.js");

const lane = require("../score-engine/score-lane.js");
const dispatch = require("../score-engine/music-dispatch.js");
const readiness = require("../score-engine/score-readiness.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-minimax-first-class-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

function pcmWav(seconds = 6, sampleRate = 44100) {
  const channels = 2;
  const bits = 16;
  const frames = Math.round(seconds * sampleRate);
  const dataSize = frames * channels * (bits / 8);
  const out = Buffer.alloc(44 + dataSize);
  out.write("RIFF", 0); out.writeUInt32LE(36 + dataSize, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22); out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  out.writeUInt16LE(channels * (bits / 8), 32); out.writeUInt16LE(bits, 34);
  out.write("data", 36); out.writeUInt32LE(dataSize, 40);
  return out;
}

function approvedProject(options, name = "Untitled 6642") {
  const { project } = lane.createScoreProject({
    name,
    duration_seconds: 6,
    script_text: "A quiet, intimate remembrance of a loved one, full of tenderness and irreversible loss.",
  }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  return project.project_id;
}

function routeGate() {
  return { ok: true, decision: "ROUTE", lane: "music_generation", selected_host: "workerx",
    fallback_used: false, checks: { music_worker_admission: "pass" } };
}

function controlledTransport(bytes, control = {}) {
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  let released = false;
  let release;
  const releasePromise = new Promise((resolve) => { release = () => { released = true; resolve(); }; });
  control.release = release;
  return () => ({
    async submitPrompt() { return "prompt-first-class"; },
    async fetchHistory() {
      if (!released) return null;
      return { status: { completed: true, status_str: "success" },
        outputs: { 9: { audio: [{ filename: "result.flac", subfolder: "scorecraft" }] } } };
    },
    async convertToWav() {},
    async ensureRemoteDir() {},
    async retrieve(remote, local) { fs.writeFileSync(local, bytes); },
    async sha256() { return sha; },
    async sleep() { await releasePromise; },
  });
}

async function withServer(options, fn) {
  const previousSettings = process.env.SCORE_ENGINE_SETTINGS_PATH;
  const previousRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    await fn(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSettings === undefined) delete process.env.SCORE_ENGINE_SETTINGS_PATH;
    else process.env.SCORE_ENGINE_SETTINGS_PATH = previousSettings;
    if (previousRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT;
    else process.env.SCORE_ENGINE_MUSIC_ROOT = previousRoot;
  }
}

function get(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: requestPath, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

function postJson(port, requestPath, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: requestPath, method: "POST", headers: {
      "Content-Type": "application/json", "Content-Length": bytes.length, ...headers,
    } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    request.end(bytes);
  });
}

async function waitFor(fn, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for persisted candidate state.");
}

test("MiniMax first-class lifecycle: running → playable → USE → approval → stale history", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  lane.generateCandidates(projectId, { count: 1 }, options);
  lane.approveCandidate(projectId, "candidate-001", options);

  const bytes = pcmWav(6);
  const control = {};
  const started = await dispatch.startMusicGeneration(projectId, {
    candidate_count: 1,
    script_text: "A rubber chicken pratfall with a silly punchline.",
  }, { ...options, computeGateFn: routeGate, transportFn: controlledTransport(bytes, control) });
  assert.equal(started.dispatch_status, "queued");
  assert.match(started.generation_job_id, /^music-job-/);

  let state = lane.getProject(projectId, options);
  const running = state.candidates.find((candidate) => candidate.backend === "minimax");
  assert.equal(running.generation_status, "running");
  assert.equal(running.artifact_available, false);
  assert.equal(running.human_verdict, "unreviewed");
  assert.equal(running.approval_eligible, false);
  assert.match(running.interpretation.interpretation_id, /^emo-/,
    "persisted script snapshot, not neutral name or transient comedy text, directs MiniMax");

  control.release();
  await dispatch._STATE.jobs.get(started.generation_job_id);
  state = lane.getProject(projectId, options);
  const completed = state.candidates.find((candidate) => candidate.backend === "minimax");
  assert.equal(completed.generation_status, "completed");
  assert.equal(completed.artifact_available, true);
  assert.match(completed.playable_artifact_path, /^music-candidates\//);
  assert.equal(completed.current_plan_revision, true);
  assert.equal(completed.plan_revision_id, state.state_integrity.current_plan_revision);
  assert.equal(completed.approval_eligible, false, "machine completion is not human approval");
  assert.ok(state.candidates.some((candidate) => candidate.backend === "scorecraft"), "Scorecraft candidate coexists");

  lane.setCandidateVerdict(projectId, completed.candidate_id, "reject", "First review decision.", options);
  assert.equal(lane.getProject(projectId, options).candidates.find((candidate) => candidate.candidate_id === completed.candidate_id).human_verdict, "reject");
  lane.setCandidateVerdict(projectId, completed.candidate_id, "use", "Human selected after listening.", options);
  const reloadedVerdict = lane.getProject(projectId, options).candidates.find((candidate) => candidate.candidate_id === completed.candidate_id);
  assert.equal(reloadedVerdict.human_verdict, "use");
  assert.equal(reloadedVerdict.approval_eligible, true);

  const approved = lane.approveCandidate(projectId, completed.candidate_id, options);
  assert.equal(approved.backend, "minimax");
  state = lane.getProject(projectId, options);
  assert.equal(state.approval_current, true);
  assert.equal(state.approved.backend, "minimax");
  assert.equal(state.approved.plan_revision_id, state.state_integrity.current_plan_revision);
  assert.equal(fs.existsSync(path.join(state.dir, "approved", "mix.wav")), true);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(state.dir, "approved", "mix.wav"))).digest("hex"), completed.output_sha256);
  assert.ok(fs.readdirSync(state.dir).some((name) => name.startsWith("approved-archive-")),
    "the prior Scorecraft approval was preserved");
  const verified = readiness.verifyApprovedExports(state.dir, { probeImpl: () => ({
    ok: true, sample_rate: 44100, codec: "pcm_s16le", channels: 2, duration: 6,
  }) });
  assert.equal(verified.verified, true, verified.failures.join("; "));

  await withServer(options, async (port) => {
    const status = await get(port, `/api/score/music/status?id=${encodeURIComponent(projectId)}`);
    assert.equal(status.status, 200);
    const body = JSON.parse(status.body.toString("utf8"));
    assert.equal(body.data.candidates[0].backend, "minimax");
    const audio = await get(port, `/api/score/file?id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(completed.playable_artifact_path)}`, { Range: "bytes=0-43" });
    assert.equal(audio.status, 206);
    assert.equal(audio.headers["content-type"], "audio/wav");
    assert.equal(audio.body.toString("ascii", 0, 4), "RIFF");
    const cockpit = JSON.parse((await get(port, "/api/package-engine/status")).body.toString("utf8")).data;
    const verdictResponse = await postJson(port, "/api/score/candidates/status", {
      project_id: projectId, candidate_id: completed.candidate_id, verdict: "use",
    }, { Host: "127.0.0.1:8010", [cockpit.nonceHeader]: cockpit.localWriteNonce });
    assert.equal(verdictResponse.status, 200, verdictResponse.body.toString("utf8"));
  });

  const oldRevision = state.state_integrity.current_plan_revision;
  lane.saveCueSheetEdits(projectId, state.project.cues, options);
  state = lane.getProject(projectId, options);
  const historical = state.candidates.find((candidate) => candidate.candidate_id === completed.candidate_id);
  assert.notEqual(state.state_integrity.current_plan_revision, oldRevision);
  assert.equal(state.approval_current, false);
  assert.equal(historical.current_plan_revision, false);
  assert.equal(historical.artifact_available, true);
  assert.equal(fs.existsSync(path.join(state.dir, historical.playable_artifact_path)), true);
  lane.approveCueSheet(projectId, options);
  assert.throws(() => lane.approveCandidate(projectId, completed.candidate_id, options), /plan_revision_changed/);
  await withServer(options, async (port) => {
    const response = await get(port, `/api/score/project?id=${encodeURIComponent(projectId)}`);
    assert.equal(response.status, 200);
    const persistedState = JSON.parse(response.body.toString("utf8")).data;
    const persistedCandidate = persistedState.candidates.find((candidate) => candidate.candidate_id === completed.candidate_id);
    assert.equal(persistedState.approval_current, false);
    assert.equal(persistedCandidate.backend, "minimax");
    assert.equal(persistedCandidate.current_plan_revision, false);
    assert.equal(persistedCandidate.artifact_available, true);
    assert.equal(persistedCandidate.human_verdict, "use");
  });
});

test("MiniMax approval remains current after reload for a migrated cue-hash revision", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options, "Migrated project 6642");
  const projectDir = path.join(options.musicRoot, "projects", projectId);
  const projectPath = path.join(projectDir, "score-project.json");
  const storedProject = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  delete storedProject.current_plan_revision_id;
  fs.writeFileSync(projectPath, `${JSON.stringify(storedProject, null, 2)}\n`);

  const bytes = pcmWav(6);
  const control = {};
  const started = await dispatch.startMusicGeneration(projectId, { candidate_count: 1 }, {
    ...options,
    computeGateFn: routeGate,
    transportFn: controlledTransport(bytes, control),
  });
  control.release();
  await dispatch._STATE.jobs.get(started.generation_job_id);

  let state = lane.getProject(projectId, options);
  const candidate = state.candidates.find((item) => item.backend === "minimax");
  assert.equal(candidate.plan_revision_id, state.state_integrity.current_plan_revision);
  lane.setCandidateVerdict(projectId, candidate.candidate_id, "use", "Accepted after listening.", options);
  lane.approveCandidate(projectId, candidate.candidate_id, options);

  state = lane.getProject(projectId, options);
  assert.equal(state.project.current_plan_revision_id, undefined, "fixture remains a migrated project");
  assert.equal(state.approval_current, true);
  assert.deepEqual(state.readiness.approval_authority.reasons, []);
  assert.equal(state.approved.plan_revision_id, state.state_integrity.current_plan_revision);
});

test("MiniMax first-class failure and runtime-unavailable states persist without phantom audio", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options, "Untitled 7719");
  const failure = await dispatch.startMusicGeneration(projectId, { candidate_count: 1 }, {
    ...options,
    computeGateFn: routeGate,
    transportFn: () => ({
      async submitPrompt() { throw new Error("MiniMax rejected the prompt: model unavailable"); },
      async fetchHistory() { return null; }, async convertToWav() {}, async ensureRemoteDir() {},
      async retrieve() {}, async sha256() { return null; }, async sleep() {},
    }),
  });
  let failed = await waitFor(
    () => lane.getProject(projectId, options).candidates.find((candidate) => candidate.backend === "minimax"),
    (candidate) => candidate && candidate.generation_status === "failed",
  );
  assert.equal(failed.generation_status, "failed");
  assert.match(failed.failure_reason, /model unavailable/);
  assert.equal(failed.artifact_available, false);
  assert.equal(failed.approval_eligible, false);
  assert.throws(() => lane.setCandidateVerdict(projectId, failed.candidate_id, "use", "", options), /completed/);
  assert.throws(() => lane.approveCandidate(projectId, failed.candidate_id, options), /generation_incomplete/);
  failed = lane.getProject(projectId, options).candidates.find((candidate) => candidate.candidate_id === failed.candidate_id);
  assert.equal(failed.generation_status, "failed", "reload preserves failure truth");

  const runtimeReason = "MiniMax runtime not reachable on 127.0.0.1:8189 — manual start required";
  await assert.rejects(() => dispatch.startMusicGeneration(projectId, { candidate_count: 1 }, {
    ...options,
    computeGateFn: () => ({ ok: false, decision: "BLOCKED", lane: "music_generation", checks: { reason: runtimeReason } }),
  }), (error) => error.statusCode === 503 && /manual start required/.test(error.message));
  const candidates = lane.getProject(projectId, options).candidates.filter((candidate) => candidate.backend === "minimax");
  const blocked = candidates[candidates.length - 1];
  assert.equal(blocked.generation_status, "failed");
  assert.match(blocked.failure_reason, /manual start required/);
  assert.equal(blocked.artifact_available, false);

  const interrupted = dispatch.prepareMusicGeneration(projectId, { candidate_count: 1 }, options);
  dispatch.updateCandidateMeta(interrupted.project_dir, interrupted.candidates[0].candidate_id, { status: "queued" });
  const afterRestartRead = lane.getProject(projectId, options).candidates
    .find((candidate) => candidate.candidate_id === interrupted.candidates[0].candidate_id);
  assert.equal(afterRestartRead.generation_status, "failed");
  assert.match(afterRestartRead.failure_reason, /interrupted/);
  const persisted = JSON.parse(fs.readFileSync(path.join(
    interrupted.project_dir, "music-candidates", interrupted.candidates[0].candidate_id, "music-candidate.json",
  ), "utf8"));
  assert.equal(persisted.status, "failed", "orphaned in-flight state is repaired durably after restart");
});

test("Music Creator UI presents MiniMax lifecycle and verdict controls without raw job JSON", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "music-creator.html"), "utf8");
  assert.match(page, /Generate MiniMax production option/);
  assert.match(page, /c\.backend==='minimax'/);
  assert.match(page, /c\.generation_status/);
  assert.match(page, />USE<\/button>/);
  assert.match(page, /Approve soundtrack/);
  assert.match(page, /failure_reason/);
  assert.match(page, /scheduleMiniMaxPoll/);
  assert.doesNotMatch(page, /JSON\.stringify\(r\)\.slice/, "raw truncated dispatch JSON is gone");
});

// ─────────────────────────────────────────────────────────────────────────
// HARDENING PASS 2026-08-22 (surgical): approval must MEASURE the real audio.
// Approval is an immutable authority boundary — it may not assert requested
// properties. These drive the full completed→USE→approve path with an injected
// probe so every failure mode is proven hermetically (no ffprobe dependency).
// ─────────────────────────────────────────────────────────────────────────
async function completedUseCandidate(options, bytes, durationSeconds = 6) {
  const projectId = approvedProject(options);
  const control = {};
  const started = await dispatch.startMusicGeneration(projectId, { candidate_count: 1 },
    { ...options, computeGateFn: routeGate, transportFn: controlledTransport(bytes, control) });
  control.release();
  await dispatch._STATE.jobs.get(started.generation_job_id);
  const state = lane.getProject(projectId, options);
  const completed = state.candidates.find((c) => c.backend === "minimax");
  lane.setCandidateVerdict(projectId, completed.candidate_id, "use", "listened", options);
  return { projectId, candidateId: completed.candidate_id };
}
const okProbe = (over = {}) => () => ({ ok: true, sample_rate: 44100, channels: 2, codec: "pcm_s16le", duration: 6, ...over });

test("approval-truth: a correct WAV is measured and approved, describe() reports measured values", async () => {
  const { options } = tmpEnv();
  const { projectId, candidateId } = await completedUseCandidate(options, pcmWav(6));
  // 6.5s is within the 1s tail but NOT within ±0.05 → duration_exact must be false.
  const approved = lane.approveCandidate(projectId, candidateId, { ...options, probeImpl: okProbe({ duration: 6.5 }) });
  assert.equal(approved.backend, "minimax");
  const prov = JSON.parse(fs.readFileSync(path.join(lane.getProject(projectId, options).dir, "approved", "provenance.json"), "utf8"));
  assert.equal(prov.render.measured_duration_seconds, 6.5, "provenance records the MEASURED duration, not the requested 6");
  assert.equal(prov.render_contract.duration_exact, false, "6.5 vs 6 is within tail but not exact → recorded honestly");
  assert.equal(prov.production.format_verified, true);
  const card = lane.getProject(projectId, options).candidates.find((c) => c.candidate_id === candidateId);
  assert.equal(card.measured_duration_seconds, 6.5, "describe() surfaces the measured duration after approval");

  // And a within-tolerance render records duration_exact === true.
  const env2 = tmpEnv();
  const exactC = await completedUseCandidate(env2.options, pcmWav(6));
  lane.approveCandidate(exactC.projectId, exactC.candidateId, { ...env2.options, probeImpl: okProbe({ duration: 6.01 }) });
  const prov2 = JSON.parse(fs.readFileSync(path.join(lane.getProject(exactC.projectId, env2.options).dir, "approved", "provenance.json"), "utf8"));
  assert.equal(prov2.render_contract.duration_exact, true, "6.01 vs 6 is within ±0.05 → exact recorded true");
});

test("approval-truth: a short render (≈41s presented for a 6s cue) is rejected before approval", async () => {
  const { options } = tmpEnv();
  const { projectId, candidateId } = await completedUseCandidate(options, pcmWav(6));
  assert.throws(() => lane.approveCandidate(projectId, candidateId, { ...options, probeImpl: okProbe({ duration: 0.4 }) }), /duration/i);
  assert.equal(fs.existsSync(path.join(lane.getProject(projectId, options).dir, "approved")), false, "no approval state was written");
});

test("approval-truth: wrong sample rate, wrong channels, wrong bit depth each fail approval", async () => {
  for (const [label, over, re] of [
    ["sample rate", { sample_rate: 48000 }, /sample rate/i],
    ["channels", { channels: 1 }, /channel/i],
    ["bit depth", { codec: "pcm_s24le" }, /bit depth/i],
  ]) {
    const { options } = tmpEnv();
    const { projectId, candidateId } = await completedUseCandidate(options, pcmWav(6));
    assert.throws(() => lane.approveCandidate(projectId, candidateId, { ...options, probeImpl: okProbe(over) }), re, `${label} must fail`);
    assert.equal(fs.existsSync(path.join(lane.getProject(projectId, options).dir, "approved")), false);
  }
});

test("approval-truth: unreadable/non-audio, ffprobe timeout, and ffprobe-unavailable all fail honestly", async () => {
  for (const probe of [
    () => ({ ok: false, reason: "no audio stream" }),
    () => ({ ok: false, reason: "ffprobe failed: timeout" }),
    () => ({ ok: false, reason: "ffprobe failed: spawn ffprobe ENOENT" }),
  ]) {
    const { options } = tmpEnv();
    const { projectId, candidateId } = await completedUseCandidate(options, pcmWav(6));
    assert.throws(() => lane.approveCandidate(projectId, candidateId, { ...options, probeImpl: probe }), /not decodable|WAV/i);
    assert.equal(fs.existsSync(path.join(lane.getProject(projectId, options).dir, "approved")), false);
  }
});

test("approval-truth: bytes changed after retrieval hash are refused (approval cannot certify different bytes)", async () => {
  const { options } = tmpEnv();
  const { projectId, candidateId } = await completedUseCandidate(options, pcmWav(6));
  const dir = lane.getProject(projectId, options).dir;
  const wav = path.join(dir, "music-candidates", candidateId, "production.wav");
  fs.writeFileSync(wav, Buffer.concat([fs.readFileSync(wav), Buffer.from("tampered")]));
  assert.throws(() => lane.approveCandidate(projectId, candidateId, { ...options, probeImpl: okProbe() }), /not approval-eligible|hash_mismatch/i);
});

// ─────────────────────────────────────────────────────────────────────────
// HARDENING PASS 2026-08-22 (surgical): Scorecraft stops at READY_FOR_RESOLVE.
// Resolve timeline assembly is EXPERIMENTAL_MANUAL_RESOLVE_ASSEMBLY — never
// reached by approval, and refused without an explicit opt-in.
// ─────────────────────────────────────────────────────────────────────────
test("resolve boundary: normal approval never invokes the Resolve driver", async () => {
  const { options } = tmpEnv();
  const { projectId, candidateId } = await completedUseCandidate(options, pcmWav(6));
  let driverCalls = 0;
  const spyDriver = () => { driverCalls += 1; throw new Error("driver must not run during approval"); };
  const approved = lane.approveCandidate(projectId, candidateId, { ...options, probeImpl: okProbe(), resolveProductionDriverImpl: spyDriver });
  assert.equal(approved.backend, "minimax");
  assert.equal(driverCalls, 0, "approval performed no Resolve timeline assembly");
});

test("resolve boundary: manual assembly is refused without the experimental opt-in", async () => {
  const { options } = tmpEnv();
  const { projectId } = await completedUseCandidate(options, pcmWav(6));
  const driver = () => { throw new Error("driver reached despite missing opt-in"); };
  // No opt-in flag → fail closed with the EXPERIMENTAL label, driver never runs.
  assert.throws(() => lane.applyResolveProductionPlan(projectId, { resolve_production_plan_id: "resolve-plan-" + "0".repeat(20) }, { ...options, resolveProductionDriverImpl: driver }),
    /EXPERIMENTAL_MANUAL_RESOLVE_ASSEMBLY/);
});
