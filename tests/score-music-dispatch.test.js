// Scorecraft → music_generation bridge tests. All compute-authority and
// transport interaction is faked — no selector spawn, no SSH, no ComfyUI,
// no audio. Approval authority stays project.cue_sheet_approved (via the
// exporter); the bridge never hard-codes a host and never auto-starts the
// manual-only MiniMax runtime.
const { assert, fs, os, path, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");
const contract = require("../score-engine/music-render-brief.js");
const adapter = require("../score-engine/adapters/minimax-caption-reference.js");
const dispatch = require("../score-engine/music-dispatch.js");

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
      async sha256() { return "ab".repeat(32); },
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
    assert.equal(done.output_sha256, "ab".repeat(32));
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
    async fetchHistory() { return null; }, async convertToWav() {}, async sha256() { return null; }, sleep: async () => {},
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
