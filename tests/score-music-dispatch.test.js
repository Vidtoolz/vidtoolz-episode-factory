// Scorecraft → music_generation bridge tests. All compute-authority and
// transport interaction is faked — no selector spawn, no SSH, no ComfyUI,
// no audio. Approval authority stays project.cue_sheet_approved (via the
// exporter); the bridge never hard-codes a host and never auto-starts the
// manual-only MiniMax runtime.
const { assert, fs, os, path, test } = require("./_helpers.js");
const crypto = require("node:crypto");
const lane = require("../score-engine/score-lane.js");
const contract = require("../score-engine/music-render-brief.js");
const adapter = require("../score-engine/adapters/minimax-caption-reference.js");
const dispatch = require("../score-engine/music-dispatch.js");
const productionCandidates = require("../score-engine/production-candidates.js");
const resourceRelease = require("../score-engine/minimax-resource-release.js");
const FAKE_WAV = Buffer.from("deterministic-fake-minimax-wav");
const FAKE_WAV_SHA256 = crypto.createHash("sha256").update(FAKE_WAV).digest("hex");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-dispatch-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

let cueN = 0;
function cue(start, end, extra = {}) {
  cueN += 1;
  return {
    cue_id: `cue-${String(cueN).padStart(2, "0")}`, name: `Cue ${cueN}`,
    start_seconds: start, end_seconds: end,
    function: extra.function || "explanation", emotion: extra.emotion || "clinical",
    energy: extra.energy || 2, density: 2, tempo_bpm: 96, key: "D minor",
    time_signature: "4/4", hit_points: [], dialogue_safe: true,
  };
}

function approvedProject(options, extra = {}) {
  cueN = 0;
  const { project } = lane.createScoreProject({ name: extra.name || "Music Bridge", duration_seconds: 60, seed: 100, ...extra }, options);
  lane.saveCueSheetEdits(project.project_id, [cue(0, 30), cue(30, 60, { function: "button" })], options);
  lane.approveCueSheet(project.project_id, options);
  return project.project_id;
}

// Deliberately NOT "vidlap2": the bridge must accept whatever host the
// canonical lane returns — proving zero host hard-coding.
function routeGate(host = "workerx") {
  return {
    ok: true, decision: "ROUTE", lane: "music_generation", selected_host: host,
    fallback_used: false, reason: `Lane 'music_generation' is available on ${host}.`,
    checks: { music_worker_admission: "pass" }, registry_version: 1,
  };
}

function blockedGate(reason) {
  return { ok: false, decision: "BLOCKED", lane: "music_generation", selected_host: null,
    fallback_used: false, reason, checks: { music_worker_admission: "fail", reason } };
}

function fakeTransportFactory(record) {
  return (host) => {
    record.host = host;
    record.calls = [];
    let promptCounter = 0;
    return {
      async submitPrompt(graph, clientId) {
        record.calls.push({ kind: "submit", graph, clientId });
        promptCounter += 1;
        return `prompt-${promptCounter}`;
      },
      async fetchHistory(promptId) {
        record.calls.push({ kind: "history", promptId });
        return { status: { completed: true, status_str: "success" },
          outputs: { 9: { audio: [{ filename: `${promptId}.flac`, subfolder: "scorecraft", type: "output" }] } } };
      },
      async convertToWav(remoteFlac, remoteWav) { record.calls.push({ kind: "convert", remoteFlac, remoteWav }); },
      async ensureRemoteDir(remoteDir) { record.calls.push({ kind: "ensure_dir", remoteDir }); },
      async retrieve(remoteFile, localFile) {
        record.calls.push({ kind: "retrieve", remoteFile, localFile });
        fs.writeFileSync(localFile, FAKE_WAV);
      },
      async sha256() { return FAKE_WAV_SHA256; },
      sleep: async () => {},
    };
  };
}

// ── full happy path with authority-chosen host ──
test("music bridge: approved project dispatches 3 candidates on the authority-chosen host", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const record = {};
  const result = await dispatch.requestMusicGeneration(projectId, {}, {
    ...options, computeGateFn: () => routeGate("workerx"), transportFn: fakeTransportFactory(record),
  });
  assert.equal(result.dispatch_status, "dispatched");
  assert.equal(result.lane, "music_generation");
  assert.equal(result.selected_host, "workerx");        // from compute authority
  assert.equal(record.host, "workerx");                 // transport got the lane's host
  assert.equal(result.candidates.length, 3);
  const ids = result.candidates.map((c) => c.candidate_id);
  assert.deepEqual(ids, ["music-candidate-001", "music-candidate-002", "music-candidate-003"]);
  assert.deepEqual(result.candidates.map((c) => c.seed), [100, 101, 102]); // baseSeed + i convention
  for (const done of result.results) {
    assert.equal(done.status, "completed");
    assert.ok(done.native_output_path.endsWith(".flac"), "native output is FLAC");
    assert.ok(done.converted_output_path.endsWith(".wav"), "deliverable is converted WAV");
    assert.ok(done.local_deliverable_path.endsWith("production.wav"), "deliverable retrieved to the project");
    assert.equal(done.output_sha256, FAKE_WAV_SHA256);
  }
  // Execution order (per candidate, interleaved across candidates): the
  // remote dir is prepared BEFORE conversion and the deliverable retrieved
  // immediately AFTER hashing (quality-gate fix 2026-08-21: ffmpeg refuses
  // to create the missing output\scorecraft dir, and without retrieval
  // nothing is playable on the control host).
  const kinds = record.calls.map((c) => c.kind);
  assert.ok(kinds.indexOf("ensure_dir") > -1 && kinds.indexOf("ensure_dir") < kinds.indexOf("convert"), "ensureRemoteDir runs before the first conversion");
  for (let i = 0; i < kinds.length; i += 1) {
    if (kinds[i] === "retrieve") assert.equal(kinds[i - 1], "convert", "each retrieve follows its own conversion");
  }
  // no auto-start: transport saw only submit/history/convert, never a launcher
  for (const call of record.calls) {
    assert.ok(!JSON.stringify(call).includes("main.py"));
    assert.ok(!JSON.stringify(call).includes("Start-Process"));
  }
});

// ── approval authority (reused, not duplicated) ──
test("music bridge: unapproved cue sheet fails closed through the existing exporter gate", async () => {
  const { options } = tmpEnv();
  const { project } = lane.createScoreProject({ name: "Unapproved", duration_seconds: 60 }, options);
  lane.saveCueSheetEdits(project.project_id, [cue(0, 60)], options);
  await assert.rejects(
    () => dispatch.requestMusicGeneration(project.project_id, {}, { ...options, computeGateFn: () => routeGate() }),
    /Approve the cue sheet first/);
  // the bridge does not invent a second approval concept
  const source = fs.readFileSync(path.join(__dirname, "../score-engine/music-dispatch.js"), "utf8");
  assert.ok(!source.includes("cue_sheet_approved"), "approval stays in score-lane/exporter");
});

// ── canonical exporter path + frozen-brief boundary ──
test("music bridge: prepare refreshes the canonical brief and keeps execution metadata out of it", () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const prepared = dispatch.prepareMusicGeneration(projectId, {}, options);
  const onDisk = JSON.parse(fs.readFileSync(prepared.brief_file, "utf8"));
  assert.deepEqual(contract.validateMusicRenderBrief(onDisk), []);
  for (const banned of ["seed", "selected_host", "prompt_id", "workflow_hash", "generator", "status"]) {
    assert.ok(!(banned in onDisk), `execution field '${banned}' leaked into the frozen brief`);
  }
  // caption comes from the isolated experimental adapter, verbatim
  assert.equal(prepared.caption, adapter.renderMiniMaxCaption(onDisk).caption);
  assert.match(prepared.caption, /evolve one continuous composition; do not replace it/i);
  for (const candidate of prepared.candidates) {
    assert.match(candidate.caption, /Continue the established motif, palette, harmony, and groove/,
      "the persisted candidate caption must carry continuity into later sections");
  }
});

test("music bridge: a schema-invalid brief can never dispatch", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const original = lane.exportMusicRenderBrief;
  lane.exportMusicRenderBrief = () => ({ brief: { brief_id: "x" }, file: "/tmp/never.json" });
  try {
    assert.throws(() => dispatch.prepareMusicGeneration(projectId, {}, options),
      /MusicRenderBrief invalid — cannot dispatch/);
  } finally {
    lane.exportMusicRenderBrief = original;
  }
});

// ── candidate semantics ──
test("music bridge: candidate identities are stable before dispatch and bounded", () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const prepared = dispatch.prepareMusicGeneration(projectId, { candidate_count: 99, seed: 7 }, options);
  assert.equal(prepared.candidates.length, dispatch.MAX_CANDIDATES);
  const again = dispatch.prepareMusicGeneration(projectId, { candidate_count: -3 }, options);
  assert.equal(again.candidates.length, 1);
  assert.equal(again.candidates[0].candidate_id, "music-candidate-006"); // numbering continues, ids stable
  for (const c of prepared.candidates) {
    const meta = JSON.parse(fs.readFileSync(path.join(prepared.project_dir, "music-candidates", c.candidate_id, "music-candidate.json"), "utf8"));
    assert.equal(meta.status, "prepared");
    assert.equal(meta.brief_hash, prepared.brief_hash);
    assert.equal(meta.generator, "MiniMax Music 3");
    assert.match(meta.adapter, /EXPERIMENTAL/);
    assert.equal(meta.lane, "music_generation");
    assert.equal(meta.selected_host, null, "host unknown until compute authority decides");
    assert.equal(meta.tiled_decode, false);
    assert.deepEqual(meta.sampler, { steps: 30, cfg: 1.7, sampler_name: "euler", scheduler: "simple", denoise: 1 });
    assert.match(meta.models.dit, /fp16/);
    assert.match(meta.audio_contract.native_output, /44\.1 kHz/);
    assert.match(meta.audio_contract.production_deliverable, /WAV via separate lossless ffmpeg/);
  }
  const seeds = new Set(prepared.candidates.map((c) => c.seed));
  assert.equal(seeds.size, prepared.candidates.length, "seeds distinct");
  assert.equal(prepared.candidates[0].seed, 7);
});

// ── compute authority ──
test("music bridge: lane verdict is fail-closed and host comes only from the authority", () => {
  assert.equal(dispatch.EXECUTION_CONTRACT.lane, "music_generation");
  assert.ok(dispatch.musicLaneVerdict(routeGate("someotherhost")).allow);
  assert.equal(dispatch.musicLaneVerdict(routeGate("someotherhost")).host, "someotherhost");
  assert.ok(!dispatch.musicLaneVerdict(null).allow);
  assert.ok(!dispatch.musicLaneVerdict({ ok: true, decision: "OPTIONAL_SKIP" }).allow);
  assert.ok(!dispatch.musicLaneVerdict({ ...routeGate(), lane: "wan_i2v" }).allow, "wrong lane rejected");
  assert.ok(!dispatch.musicLaneVerdict({ ...routeGate(), fallback_used: true }).allow, "fallback rejected");
  assert.ok(!dispatch.musicLaneVerdict({ ...routeGate(), selected_host: null }).allow);
  // no hard-coded routing anywhere in the bridge
  const source = fs.readFileSync(path.join(__dirname, "../score-engine/music-dispatch.js"), "utf8");
  assert.ok(!source.includes("vidlap2"), "bridge must not name the worker host");
  assert.ok(!source.toLowerCase().includes("presto"), "bridge must not know PRESTO exists");
});

test("music bridge: admission denial and runtime NOT_READY propagate truthfully with no dispatch", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const record = {};
  const runtimeDown = "VIDLAP2 rejected: music runtime not reachable on 127.0.0.1:8189 — manual start required (this is an ordinary operational state)";
  await assert.rejects(
    () => dispatch.requestMusicGeneration(projectId, {}, {
      ...options, computeGateFn: () => blockedGate(runtimeDown), transportFn: fakeTransportFactory(record),
    }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /music_generation is not admitted/);
      assert.match(error.message, /manual start required/);
      assert.match(error.message, /never auto-starts/);
      return true;
    });
  assert.equal(record.calls, undefined, "no transport activity after a blocked admission");
  const dir = path.join(options.musicRoot, "projects");
  const projectDir = path.join(dir, fs.readdirSync(dir)[0]);
  const meta = JSON.parse(fs.readFileSync(path.join(projectDir, "music-candidates", "music-candidate-001", "music-candidate.json"), "utf8"));
  assert.equal(meta.status, "blocked");
  assert.match(meta.failure, /manual start required/);
});

test("music bridge: execution failure marks the candidate failed and stops fail-closed", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const transportFn = () => ({
    async submitPrompt() { throw Object.assign(new Error("music runtime rejected submission: boom"), { statusCode: 502 }); },
    async fetchHistory() { return null; }, async convertToWav() {}, async ensureRemoteDir() {}, async retrieve() {}, async sha256() { return null; }, sleep: async () => {},
  });
  await assert.rejects(
    () => dispatch.requestMusicGeneration(projectId, { candidate_count: 2 }, { ...options, computeGateFn: () => routeGate(), transportFn }),
    /music runtime rejected submission/);
  const dir = path.join(options.musicRoot, "projects");
  const projectDir = path.join(dir, fs.readdirSync(dir)[0]);
  const first = JSON.parse(fs.readFileSync(path.join(projectDir, "music-candidates", "music-candidate-001", "music-candidate.json"), "utf8"));
  assert.equal(first.status, "failed");
  const second = JSON.parse(fs.readFileSync(path.join(projectDir, "music-candidates", "music-candidate-002", "music-candidate.json"), "utf8"));
  assert.notEqual(second.status, "completed", "no silent continuation past a broken runtime");
});

test("music bridge: missing output hash fails closed instead of completing", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const transportFn = fakeTransportFactory({});
  const original = transportFn;
  await assert.rejects(
    () => dispatch.requestMusicGeneration(projectId, { candidate_count: 1 }, {
      ...options,
      computeGateFn: () => routeGate(),
      transportFn: () => {
        const transport = original("workerx");
        transport.sha256 = async () => null;
        return transport;
      },
    }),
    /no usable SHA-256/);
  const dir = path.join(options.musicRoot, "projects");
  const projectDir = path.join(dir, fs.readdirSync(dir)[0]);
  const meta = JSON.parse(fs.readFileSync(path.join(projectDir, "music-candidates", "music-candidate-001", "music-candidate.json"), "utf8"));
  assert.equal(meta.status, "failed");
  assert.match(meta.failure, /no usable SHA-256/);
});

test("music bridge: worker output path traversal is rejected", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const prepared = dispatch.prepareMusicGeneration(projectId, { candidate_count: 1 }, options);
  assert.rejects(
    () => dispatch.executeMusicCandidate(prepared.project_dir, prepared.candidates[0], prepared.caption, "workerx", {
      async submitPrompt() { return "prompt-1"; },
      async fetchHistory() {
        return { status: { completed: true, status_str: "success" }, outputs: { 9: { audio: [{ filename: "bad.flac", subfolder: "scorecraft/../../escape" }] } } };
      },
      async convertToWav() {},
      async ensureRemoteDir() {},
      async retrieve() {},
      async sha256() { return "ab".repeat(32); },
      sleep: async () => {},
    }),
    /unsafe remote path token/
  );
});

test("music bridge: proven workflow configuration reaches the graph exactly", () => {
  const graph = dispatch.buildMusicWorkflow("caption text", 424242, 60);
  assert.equal(graph[1].inputs.unet_name, "minimax_music3_dit_fp16.safetensors");
  assert.equal(graph[2].inputs.clip_name, "minimax_music3_text_encoder_pruned_int8_convrot.safetensors");
  assert.equal(graph[2].inputs.type, "minimax");
  assert.equal(graph[3].inputs.vae_name, "minimax_music3_dav.safetensors");
  assert.equal(graph[7].inputs.steps, 30);
  assert.equal(graph[7].inputs.cfg, 1.7);
  assert.equal(graph[7].inputs.sampler_name, "euler");
  assert.equal(graph[7].inputs.scheduler, "simple");
  assert.equal(graph[8].class_type, "VAEDecodeAudio", "tiled decode stays OFF");
  assert.equal(graph[9].inputs.format, "flac", "ComfyUI saves FLAC, never WAV directly");
  assert.equal(graph[4].inputs.caption, "caption text");
  assert.equal(graph[4].inputs.seed, 424242);
  assert.equal(graph[4].inputs.cfg_scale, 1.7);
  assert.equal(graph[4].inputs.top_k, 50);
  const nodeTypes = Object.values(graph).map((node) => node.class_type);
  assert.equal(nodeTypes.filter((type) => type === "MiniMaxMusic3TextEncode").length, 1, "one conditioning pass");
  assert.equal(nodeTypes.filter((type) => type === "EmptyMiniMaxMusic3LatentAudio").length, 1, "one full-duration latent");
  assert.equal(nodeTypes.filter((type) => type === "KSampler").length, 1, "one sampler pass — no independently seeded sections");
  assert.equal(nodeTypes.filter((type) => type === "VAEDecodeAudio").length, 1, "one decode — no stitched segments");
  assert.equal(nodeTypes.filter((type) => type === "SaveAudioAdvanced").length, 1, "one output artifact");
});

test("music bridge: prepare_only performs no admission and no dispatch", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  let gateCalls = 0;
  const result = await dispatch.requestMusicGeneration(projectId, { prepare_only: true }, {
    ...options, computeGateFn: () => { gateCalls += 1; return routeGate(); },
  });
  assert.equal(result.dispatch_status, "prepared_only");
  assert.equal(gateCalls, 0);
});

test("music bridge: only one music generation request runs at a time", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  dispatch._STATE.active = "someone-else";
  try {
    await assert.rejects(
      () => dispatch.requestMusicGeneration(projectId, {}, { ...options, computeGateFn: () => routeGate() }),
      /already running/);
  } finally {
    dispatch._STATE.active = null;
  }
});

function lifecycleTransport(projectDir, record, behavior = {}) {
  const base = fakeTransportFactory(record)("workerx");
  const states = [...(behavior.states || [
    { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 11711 },
    { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 11711 },
    { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 15167 },
  ])];
  let last = states[states.length - 1];
  return {
    ...base,
    resourceLifecycle: "comfyui-real",
    async inspectRuntime() {
      record.inspections = (record.inspections || 0) + 1;
      if (behavior.inspectError) throw new Error(behavior.inspectError);
      if (states.length) last = states.shift();
      return last;
    },
    async freeResources() {
      record.freeCalls = (record.freeCalls || 0) + 1;
      if (behavior.assertTerminal) behavior.assertTerminal(projectDir);
      if (behavior.freeError) throw new Error(behavior.freeError);
      return { status: 200 };
    },
  };
}

const fastRelease = { idleWaitMs: 0, releaseWaitMs: 10, pollMs: 0 };

test("music resource release: successful artifact is durable before one idle /free", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const projectDir = path.join(options.musicRoot, "projects", projectId);
  const record = {};
  const result = await dispatch.requestMusicGeneration(projectId, { candidate_count: 1 }, {
    ...options,
    computeGateFn: () => routeGate(),
    resourceReleaseOptions: fastRelease,
    transportFn: () => lifecycleTransport(projectDir, record, {
      assertTerminal(dir) {
        const meta = productionCandidates.findRecord(dir, "music-candidate-001").meta;
        assert.equal(meta.status, "completed");
        assert.equal(fs.existsSync(path.join(dir, "music-candidates", "music-candidate-001", "production.wav")), true);
      },
    }),
  });
  assert.equal(result.results[0].status, "completed");
  assert.equal(record.freeCalls, 1);
  const meta = productionCandidates.findRecord(projectDir, "music-candidate-001").meta;
  assert.equal(meta.resource_release.status, "released");
  assert.equal(meta.resource_release.vram_after_mib, 15167);
});

test("music resource release: generation failure stays failed when idle cleanup succeeds", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const projectDir = path.join(options.musicRoot, "projects", projectId);
  const record = {};
  const transport = lifecycleTransport(projectDir, record, {
    assertTerminal(dir) { assert.equal(productionCandidates.findRecord(dir, "music-candidate-001").meta.status, "failed"); },
  });
  transport.submitPrompt = async () => { throw new Error("real generation failed"); };
  await assert.rejects(() => dispatch.requestMusicGeneration(projectId, { candidate_count: 1 }, {
    ...options, computeGateFn: () => routeGate(), transportFn: () => transport,
    resourceReleaseOptions: fastRelease,
  }), /real generation failed/);
  const meta = productionCandidates.findRecord(projectDir, "music-candidate-001").meta;
  assert.equal(meta.status, "failed");
  assert.match(meta.failure, /real generation failed/);
  assert.equal(meta.resource_release.status, "released");
  assert.equal(record.freeCalls, 1);
});

test("music resource release: busy runtime is never freed", async () => {
  const record = {};
  const transport = lifecycleTransport(null, record, {
    states: [{ healthy: true, queue_running: 1, queue_pending: 1, free_vram_mib: 11711 }],
  });
  const result = await resourceRelease.releaseWhenIdle({ transport, idleWaitMs: 0, pollMs: 0 });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "runtime_queue_busy");
  assert.equal(record.freeCalls || 0, 0);
});

test("music resource release: consecutive candidates drain before exactly one /free", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const projectDir = path.join(options.musicRoot, "projects", projectId);
  const record = {};
  const transport = lifecycleTransport(projectDir, record, {
    states: [
      { healthy: true, queue_running: 0, queue_pending: 1, free_vram_mib: 11711 },
      { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 11711 },
      { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 11711 },
      { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 15167 },
    ],
    assertTerminal(dir) {
      assert.deepEqual(["music-candidate-001", "music-candidate-002"].map((id) => productionCandidates.findRecord(dir, id).meta.status), ["completed", "completed"]);
    },
  });
  await dispatch.requestMusicGeneration(projectId, { candidate_count: 2 }, {
    ...options, computeGateFn: () => routeGate(), transportFn: () => transport,
    resourceReleaseOptions: { idleWaitMs: 20, releaseWaitMs: 20, pollMs: 0 },
  });
  assert.equal(record.freeCalls, 1);
});

test("music resource release: /free failure never changes completed candidate truth", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const projectDir = path.join(options.musicRoot, "projects", projectId);
  const record = {};
  const result = await dispatch.requestMusicGeneration(projectId, { candidate_count: 1 }, {
    ...options, computeGateFn: () => routeGate(),
    transportFn: () => lifecycleTransport(projectDir, record, { freeError: "free endpoint HTTP 500" }),
    resourceReleaseOptions: fastRelease,
  });
  assert.equal(result.results[0].status, "completed");
  const meta = productionCandidates.findRecord(projectDir, "music-candidate-001").meta;
  assert.equal(meta.status, "completed");
  assert.equal(meta.resource_release.status, "failed");
  assert.match(meta.resource_release.detail, /HTTP 500/);
});

test("music resource release: unavailable runtime is recorded separately", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const projectDir = path.join(options.musicRoot, "projects", projectId);
  const record = {};
  const result = await dispatch.requestMusicGeneration(projectId, { candidate_count: 1 }, {
    ...options, computeGateFn: () => routeGate(),
    transportFn: () => lifecycleTransport(projectDir, record, { inspectError: "connection refused" }),
    resourceReleaseOptions: fastRelease,
  });
  assert.equal(result.results[0].status, "completed");
  const meta = productionCandidates.findRecord(projectDir, "music-candidate-001").meta;
  assert.equal(meta.resource_release.status, "failed");
  assert.match(meta.resource_release.detail, /connection refused/);
});

test("music resource release: deterministic adapter and already-free runtime do not call /free", async () => {
  const deterministic = await resourceRelease.releaseWhenIdle({ transport: { sleep: async () => {} } });
  assert.equal(deterministic.reason, "non_real_minimax_transport");
  const record = {};
  const transport = lifecycleTransport(null, record, {
    states: [{ healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 15167 }],
  });
  const sufficient = await resourceRelease.releaseWhenIdle({ transport });
  assert.equal(sufficient.reason, "already_sufficiently_free");
  assert.equal(record.freeCalls || 0, 0);
});

test("music resource release: a local active candidate blocks cache unload", async () => {
  const record = {};
  const transport = lifecycleTransport(null, record);
  const result = await resourceRelease.releaseWhenIdle({ transport, isLocallyIdle: () => false });
  assert.equal(result.reason, "local_music_work_active");
  assert.equal(record.inspections || 0, 0);
  assert.equal(record.freeCalls || 0, 0);
});

test("music resource release: a queue race on the confirmation read prevents /free", async () => {
  const record = {};
  const transport = lifecycleTransport(null, record, {
    states: [
      { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 11711 },
      { healthy: true, queue_running: 1, queue_pending: 0, free_vram_mib: 11711 },
    ],
  });
  const result = await resourceRelease.releaseWhenIdle({ transport });
  assert.equal(result.reason, "runtime_became_busy");
  assert.equal(record.freeCalls || 0, 0);
});

test("music resource release: local Scorecraft generation never touches MiniMax cleanup", () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const releaseJobsBefore = dispatch._STATE.release_jobs.size;
  lane.generateCandidates(projectId, { count: 1 }, options);
  const candidates = lane.getProject(projectId, options).candidates;
  assert.equal(candidates.some((candidate) => candidate.backend === "scorecraft"), true);
  assert.equal(candidates.some((candidate) => candidate.backend === "minimax"), false);
  assert.equal(dispatch._STATE.release_jobs.size, releaseJobsBefore);
});

test("music resource release: interrupted reconciliation persists failure before one cleanup", async () => {
  const { options } = tmpEnv();
  const projectId = approvedProject(options);
  const prepared = dispatch.prepareMusicGeneration(projectId, { candidate_count: 1 }, options);
  const candidate = prepared.candidates[0];
  dispatch.updateCandidateMeta(prepared.project_dir, candidate.candidate_id, {
    status: "generating", selected_host: "workerx", prompt_id: "orphaned-prompt",
  });
  const record = {};
  let cleanupPromise = null;
  let reconciliations = 0;
  const onInterrupted = (meta) => {
    reconciliations += 1;
    assert.equal(meta.status, "failed", "reconciliation is durable before cleanup scheduling");
    cleanupPromise = dispatch.scheduleReconciledResourceRelease(prepared.project_dir, meta, {
      transportFn: () => lifecycleTransport(prepared.project_dir, record),
      resourceReleaseOptions: fastRelease,
    });
  };
  productionCandidates.list(prepared.project_dir, { isActive: () => false, onInterrupted });
  await new Promise((resolve) => setImmediate(resolve));
  await cleanupPromise;
  productionCandidates.list(prepared.project_dir, { isActive: () => false, onInterrupted });
  await new Promise((resolve) => setImmediate(resolve));
  const meta = productionCandidates.findRecord(prepared.project_dir, candidate.candidate_id).meta;
  assert.equal(reconciliations, 1, "repeated status processing is idempotent");
  assert.equal(record.freeCalls, 1);
  assert.equal(meta.status, "failed");
  assert.match(meta.failure, /interrupted/);
  assert.equal(meta.resource_release.status, "released");
});


// ─────────────────────────────────────────────────────────────────────────
// HARDENING PASS 2026-08-22 (surgical): prompt_id injection + operator-tunnel
// control-plane doctrine. Control ops (submit/history/inspect/free) go over an
// HTTP tunnel — proven here against a real local mock ComfyUI server bound to
// 127.0.0.1. A malicious runtime-supplied prompt_id must be rejected before it
// can shape any request; a tunnel that is down must fail closed.
// ─────────────────────────────────────────────────────────────────────────
const nodeHttp = require("node:http");

function mockRuntime(handler) {
  const received = [];
  const server = nodeHttp.createServer((req, res) => {
    received.push({ method: req.method, url: req.url });
    handler(req, res, received);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server, received,
      base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

const MALICIOUS_PROMPT_IDS = [
  "x & del /s /q C:\\VidtoolzMusic", "abc | shutdown", "abc; rm -rf /",
  "`whoami`", "$(reboot)", "id with spaces", "line1\r\nline2",
  "\"quoted\"", "'quoted'", "short", "g".repeat(65),
  "zzzzzzzz-not-hex-here", "",
];
const VALID_PROMPT_IDS = [
  "12345678", "0123456789abcdef", "0123456789ABCDEF",
  "b1e6c0a2-4f3d-4c1a-9e2b-7a8c9d0e1f23",
];

test("security: safePromptId accepts UUID shapes, rejects shell metacharacters and bad lengths", () => {
  for (const good of VALID_PROMPT_IDS) assert.equal(dispatch.safePromptId(good), good);
  for (const bad of MALICIOUS_PROMPT_IDS) assert.throws(() => dispatch.safePromptId(bad), /invalid prompt_id/);
  assert.throws(() => dispatch.safePromptId(null), /invalid prompt_id/);
  assert.throws(() => dispatch.safePromptId(undefined), /invalid prompt_id/);
});

test("security: a malicious prompt_id from submitPrompt is rejected and never used in a follow-up request", async () => {
  const rt = await mockRuntime((req, res) => {
    if (req.method === "POST" && req.url === "/prompt") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ prompt_id: "x & del C:\\VidtoolzMusic" }));
    } else { res.writeHead(200); res.end("{}"); }
  });
  try {
    const transport = dispatch.defaultTransport("vidlap2", { tunnelBase: rt.base });
    await assert.rejects(() => transport.submitPrompt({ nodes: 1 }, "client"), /invalid prompt_id/);
    // The runtime received exactly the submission and no /history request built from the payload.
    assert.equal(rt.received.filter((r) => r.url.startsWith("/history")).length, 0, "no history request was constructed from the malicious id");
  } finally { await rt.close(); }
});

test("security: fetchHistory rejects a malicious prompt_id before any tunnel request is made", async () => {
  const rt = await mockRuntime((req, res) => { res.writeHead(200); res.end("{}"); });
  try {
    const transport = dispatch.defaultTransport("vidlap2", { tunnelBase: rt.base });
    for (const bad of MALICIOUS_PROMPT_IDS) {
      await assert.rejects(() => transport.fetchHistory(bad), /invalid prompt_id/);
    }
    assert.equal(rt.received.length, 0, "not a single request reached the runtime for a malicious id");
  } finally { await rt.close(); }
});

test("tunnel doctrine: valid control ops travel over the operator tunnel (HTTP), not SSH", async () => {
  const rt = await mockRuntime((req, res) => {
    if (req.url === "/prompt") { res.writeHead(200); res.end(JSON.stringify({ prompt_id: "b1e6c0a2-4f3d-4c1a-9e2b-7a8c9d0e1f23" })); }
    else if (req.url.startsWith("/history/")) { res.writeHead(200); res.end(JSON.stringify({ "b1e6c0a2-4f3d-4c1a-9e2b-7a8c9d0e1f23": { status: { completed: true } } })); }
    else { res.writeHead(200); res.end("{}"); }
  });
  try {
    const transport = dispatch.defaultTransport("vidlap2", { tunnelBase: rt.base });
    const id = await transport.submitPrompt({ nodes: 1 }, "client");
    assert.equal(id, "b1e6c0a2-4f3d-4c1a-9e2b-7a8c9d0e1f23");
    const hist = await transport.fetchHistory(id);
    assert.ok(hist && hist.status.completed, "history retrieved over the tunnel");
    assert.ok(rt.received.some((r) => r.method === "POST" && r.url === "/prompt"), "submit used HTTP POST /prompt");
    assert.ok(rt.received.some((r) => r.url === `/history/${id}`), "history used HTTP GET over the tunnel");
  } finally { await rt.close(); }
});

test("tunnel doctrine: a down operator tunnel fails closed with an honest 'start it' error", async () => {
  // Point at a port nothing is listening on → connection refused.
  const transport = dispatch.defaultTransport("vidlap2", { tunnelBase: "http://127.0.0.1:1" });
  await assert.rejects(() => transport.submitPrompt({ nodes: 1 }, "client"), /not reachable over the operator tunnel|vidtoolz-music3/);
});
