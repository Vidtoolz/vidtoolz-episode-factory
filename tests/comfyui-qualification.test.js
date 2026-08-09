// ComfyUI Production Qualification v1 — environment fingerprints, qualification
// records, drift comparison, upgrade guard, canonical fixtures, and the
// qualification runner. Everything hermetic: ComfyUI API faked via injected
// fetch, GPU execution faked via injected executors, records in temp dirs.
// No network, no render, no live PRESTO.
const { assert, fs, os, path, test } = require("./_helpers.js");
const gateway = require("../comfyui-gateway");

const REPO = path.join(__dirname, "..");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---- fakes ---------------------------------------------------------------------

const FLUX_OBJECT_INFO = {
  UnetLoaderGGUF: { input: { required: { unet_name: [["flux1-dev-Q8_0.gguf", "unrelated-other-model.gguf"]] } }, python_module: "custom_nodes.ComfyUI-GGUF" },
  DualCLIPLoaderGGUF: { input: { required: { clip_name1: [["t5-v1_1-xxl-encoder-Q5_K_M.gguf"]], clip_name2: [["clip_l.safetensors"]] } }, python_module: "custom_nodes.ComfyUI-GGUF" },
  VAELoader: { input: { required: { vae_name: [["ae.safetensors"]] } }, python_module: "nodes" },
};

const WAN_OBJECT_INFO = {
  UNETLoader: { input: { required: { unet_name: [["wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"]] } }, python_module: "nodes" },
  CLIPLoader: { input: { required: { clip_name: [["umt5_xxl_fp8_e4m3fn_scaled.safetensors"]] } }, python_module: "nodes" },
  VAELoader: { input: { required: { vae_name: [["wan_2.1_vae.safetensors"]] } }, python_module: "nodes" },
  LoraLoaderModelOnly: { input: { required: { lora_name: [["wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors"]] } }, python_module: "nodes" },
};

// A fake fetch implementing the read-only ComfyUI API surface. Records every
// request; THROWS on anything that is not a GET-shaped gateway call — proof
// the qualification chain never submits a prompt from tests.
// `modelFolders` fakes /api/experiment/models/<folder>; unconfigured folders
// return 404 like a host without the endpoint.
function fakeComfyFetch({ objectInfo = FLUX_OBJECT_INFO, version = "0.27.0", gpu = "NVIDIA TEST GPU", modelFolders = {} } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET" });
    if (init && init.method && init.method !== "GET") {
      throw new Error(`TEST GUARD: non-GET ComfyUI call attempted: ${init.method} ${url}`);
    }
    const u = String(url);
    const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
    if (u.endsWith("/system_stats")) {
      return json({ system: { comfyui_version: version, os: "test", python_version: "3.12 x", pytorch_version: "2.0" }, devices: [{ name: gpu, vram_total: 1, vram_free: 1 }] });
    }
    if (u.endsWith("/queue")) return json({ queue_running: [], queue_pending: [] });
    const folderMatch = u.match(/\/api\/experiment\/models\/([^/]+)$/);
    if (folderMatch) {
      const folder = decodeURIComponent(folderMatch[1]);
      if (modelFolders[folder]) return json(modelFolders[folder]);
      return json({ error: "not found" }, false, 404);
    }
    const m = u.match(/\/object_info\/([^/]+)$/);
    if (m) {
      const cls = decodeURIComponent(m[1]);
      if (objectInfo[cls]) return json({ [cls]: objectInfo[cls] });
      return json({ error: "not found" }, false, 404);
    }
    throw new Error(`TEST GUARD: unexpected ComfyUI call: ${u}`);
  };
  impl.calls = calls;
  return impl;
}

// A fake accepted Wan production run directory, shaped exactly like the ones
// run-production.py writes (source.png + output.mp4 + ffprobe.json + run.log).
function writeWanRunDir(runsRoot, runId, overrides = {}) {
  const dir = path.join(runsRoot, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.png"), "fake-source-image");
  if (overrides.noOutput !== true) fs.writeFileSync(path.join(dir, "output.mp4"), `fake-mp4-${runId}`);
  const ffprobe = overrides.ffprobe || {
    streams: [{ codec_type: "video", width: 720, height: 1280, r_frame_rate: "24/1", nb_frames: "97", codec_name: "h264" }],
    format: { duration: "4.04" },
  };
  fs.writeFileSync(path.join(dir, "ffprobe.json"), JSON.stringify(ffprobe));
  const runLog = {
    run_id: runId,
    prompt: "real production prompt",
    seed: "1771480165",
    status: "verified",
    created_at: "2026-08-08T12:00:00+00:00",
    prompt_id: "2a6a112c-0c5d-456a-a388-52e79f424845",
    elapsed: "3038.56",
    ...overrides.runLog,
  };
  fs.writeFileSync(path.join(dir, "run.log"), JSON.stringify(runLog));
  return dir;
}

function wanFingerprint(entry, overrides = {}) {
  const fp = {
    schema_version: 1,
    host: { name: "PRESTO", endpoint: "http://192.168.50.187:8188" },
    comfyui: { version: "0.22.0", identity_level: "package_version", source: "comfyui_system_stats" },
    gpu: { name: "NVIDIA GeForce RTX 4090" },
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    models: [
      { class_type: "UNETLoader", input_key: "unet_name", name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", present: true, identity: { level: "filename_size_mtime", source: "comfyui_models_api", filename: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", bytes: 15000, mtime: "2026-06-05T10:00:00.000Z" } },
    ],
    custom_nodes: [],
    collected_at: "2026-08-08T12:55:00.000Z",
    ...overrides,
  };
  fp.fingerprint_sha256 = gateway.fingerprint.fingerprintSha256(fp);
  return fp;
}

// Real registry entry re-rooted onto a temp runtime copy (so tests never
// depend on the live ComfyUI user dir or VIDNAS mounts).
function syntheticRegistry(workflowId, overrides = {}) {
  const real = gateway.registry.getWorkflow(workflowId);
  const work = tmpDir("comfyui-qual-");
  const runtimeCopy = path.join(work, "runtime.json");
  fs.copyFileSync(gateway.registry.canonicalAbsolutePath(real), runtimeCopy);
  const entry = { ...JSON.parse(JSON.stringify(real)), runtime_copies: [runtimeCopy], ...overrides };
  const registryPath = path.join(work, "registry.json");
  fs.writeFileSync(registryPath, JSON.stringify({ registry_version: 1, workflows: [entry] }));
  return { work, entry, registryPath, runtimeCopy };
}

function syntheticFingerprint(overrides = {}) {
  const fp = {
    schema_version: 1,
    host: { name: "vidnux", endpoint: "http://127.0.0.1:8188" },
    comfyui: { version: "0.27.0", git_commit: "aaaa1111aaaa1111", identity_level: "git_commit" },
    gpu: { name: "NVIDIA GeForce RTX 5070 Ti" },
    workflow: { id: "flux-gguf-1080x1920", version: 1, sha256: "f".repeat(64) },
    models: [
      { class_type: "UnetLoaderGGUF", input_key: "unet_name", name: "flux1-dev-Q8_0.gguf", present: true, identity: { level: "filename_size_mtime", filename: "flux1-dev-Q8_0.gguf", bytes: 100, mtime: "2026-06-10T14:55:00.000Z" } },
    ],
    custom_nodes: [
      { class: "UnetLoaderGGUF", package: "ComfyUI-GGUF", present: true, identity: { level: "git_commit", git_commit: "6ea2651", package_version: "2.0.0" } },
    ],
    collected_at: "2026-08-08T10:00:00.000Z",
    ...overrides,
  };
  fp.fingerprint_sha256 = gateway.fingerprint.fingerprintSha256(fp);
  return fp;
}

function passedRecord(entry, fp, overrides = {}) {
  return {
    schema_version: 1,
    qualification_id: "qual-test-1",
    result: "LIVE_PASSED",
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    environment_fingerprint: fp,
    fixture: { id: "fixture-1", parameter_sha256: "b".repeat(64), seed: 424242 },
    execution: { job_id: "job-1", comfyui_prompt_id: "p-1", started_at: "2026-08-08T10:00:00.000Z", completed_at: "2026-08-08T10:01:00.000Z" },
    output: { path: "/tmp/out.png", sha256: "c".repeat(64), bytes: 10, width: 1080, height: 1920, media_type: "image", technical_validation: "passed" },
    generated_by: "test",
    ...overrides,
  };
}

// A "PNG" that satisfies signature + IHDR dimension validation (the gateway
// reads exactly the first 24 bytes).
function writeFakePng(filePath, width, height) {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  fs.writeFileSync(filePath, buf);
}

// ---- environment fingerprints ---------------------------------------------------

test("comfyui-qualification fingerprint: deterministic hash, key order irrelevant, collected_at excluded", () => {
  const a = syntheticFingerprint();
  // rebuild with different object key insertion order + different timestamp
  const shuffled = JSON.parse(gateway.fingerprint.canonicalJson(a));
  shuffled.collected_at = "2027-01-01T00:00:00.000Z";
  assert.equal(gateway.fingerprint.fingerprintSha256(a), gateway.fingerprint.fingerprintSha256(shuffled));
  const changed = syntheticFingerprint({ comfyui: { version: "0.28.0", identity_level: "package_version" } });
  assert.notEqual(gateway.fingerprint.fingerprintSha256(a), gateway.fingerprint.fingerprintSha256(changed));
});

test("comfyui-qualification fingerprint: local collection — stat identity, package identity, relevant models only", async () => {
  const { entry, registryPath } = synthesizeFluxWithLocalRoot();
  const fetchImpl = fakeComfyFetch();
  const fp = await gateway.fingerprint.collectFingerprint(entry, {
    registryPath, fetchImpl, local: true, localComfyRoot: entry.__localRoot,
  });
  assert.equal(fp.workflow.sha256, entry.canonical_sha256);
  assert.equal(fp.comfyui.version, "0.27.0");
  assert.equal(fp.gpu.name, "NVIDIA TEST GPU");
  // only the four required models appear — the loader also enumerates
  // "unrelated-other-model.gguf" but irrelevant inventory stays out
  assert.equal(fp.models.length, 4);
  assert.ok(!fp.models.some((m) => m.name.includes("unrelated")));
  const unet = fp.models.find((m) => m.name === "flux1-dev-Q8_0.gguf");
  assert.equal(unet.identity.level, "filename_size_mtime");
  assert.equal(unet.identity.bytes, 4);
  assert.ok(unet.identity.mtime);
  const node = fp.custom_nodes.find((n) => n.class === "UnetLoaderGGUF");
  assert.equal(node.package, "ComfyUI-GGUF");
  assert.equal(node.identity.level, "package_version");
  assert.equal(node.identity.package_version, "9.9.9");
  assert.equal(fp.fingerprint_sha256, gateway.fingerprint.fingerprintSha256(fp));
});

function synthesizeFluxWithLocalRoot() {
  const { entry, registryPath } = syntheticRegistry("flux-gguf-1080x1920");
  const localRoot = tmpDir("comfyui-local-");
  fs.mkdirSync(path.join(localRoot, "models", "unet"), { recursive: true });
  fs.writeFileSync(path.join(localRoot, "models", "unet", "flux1-dev-Q8_0.gguf"), "fake");
  const pkgDir = path.join(localRoot, "custom_nodes", "ComfyUI-GGUF");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "pyproject.toml"), 'version = "9.9.9"\n');
  entry.__localRoot = localRoot;
  return { entry, registryPath };
}

test("comfyui-qualification fingerprint: remote collection stays honest — filename_only / class_presence_only / unknown", async () => {
  const { entry, registryPath } = syntheticRegistry("flux-gguf-1080x1920");
  const objectInfo = JSON.parse(JSON.stringify(FLUX_OBJECT_INFO));
  objectInfo.VAELoader.input.required.vae_name = [[]]; // ae.safetensors gone
  const fp = await gateway.fingerprint.collectFingerprint(entry, {
    registryPath, fetchImpl: fakeComfyFetch({ objectInfo }), local: false,
  });
  const unet = fp.models.find((m) => m.name === "flux1-dev-Q8_0.gguf");
  assert.equal(unet.identity.level, "filename_only"); // enumeration proves presence, nothing more
  assert.equal(unet.present, true);
  const vae = fp.models.find((m) => m.name === "ae.safetensors");
  assert.equal(vae.present, false);
  assert.equal(vae.identity.level, "unknown");
  // remote custom node: seeing the class proves presence only
  const node = fp.custom_nodes.find((n) => n.class === "UnetLoaderGGUF");
  assert.equal(node.identity.level, "class_presence_only");
});

// ---- qualification records -------------------------------------------------------

test("comfyui-qualification records: LIVE_PASSED write is atomic, round-trips, and validates required fields", () => {
  const root = tmpDir("comfyui-qrec-");
  const { entry } = syntheticRegistry("flux-gguf-1080x1920");
  const record = passedRecord(entry, syntheticFingerprint());
  const written = gateway.qualification.writeQualificationRecord(record, { qualificationRoot: root });
  assert.ok(fs.existsSync(written.latest_passed));
  assert.ok(fs.existsSync(written.attempt));
  assert.ok(!fs.readdirSync(path.dirname(written.latest_passed)).some((n) => n.includes(".tmp-")), "no temp files left behind");
  assert.deepEqual(gateway.qualification.readLatestPassed(entry.id, { qualificationRoot: root }), record);
  // invalid: LIVE_PASSED without output hash must refuse
  const bad = passedRecord(entry, syntheticFingerprint(), { output: { path: "/x", technical_validation: "passed" } });
  assert.throws(() => gateway.qualification.writeQualificationRecord(bad, { qualificationRoot: root }), /output sha256/);
});

test("comfyui-qualification records: FAILED attempt preserves last success; STATIC_VERIFIED never becomes latest-passed", () => {
  const root = tmpDir("comfyui-qrec-");
  const { entry } = syntheticRegistry("flux-gguf-1080x1920");
  const good = passedRecord(entry, syntheticFingerprint());
  gateway.qualification.writeQualificationRecord(good, { qualificationRoot: root });
  const failed = passedRecord(entry, syntheticFingerprint(), {
    result: "FAILED",
    output: undefined,
    failure: { class: "MODEL_MISSING", raw: "value not in list: unet_name" },
    execution: { job_id: "job-2", started_at: "2026-08-08T11:00:00.000Z", completed_at: "2026-08-08T11:00:30.000Z" },
  });
  gateway.qualification.writeQualificationRecord(failed, { qualificationRoot: root });
  assert.deepEqual(gateway.qualification.readLatestPassed(entry.id, { qualificationRoot: root }), good, "FAILED must not overwrite last success");
  const latestAttempt = gateway.qualification.readLatestAttempt(entry.id, { qualificationRoot: root });
  assert.equal(latestAttempt.result, "FAILED");
  assert.equal(latestAttempt.failure.class, "MODEL_MISSING");
  const staticRec = passedRecord(entry, syntheticFingerprint(), {
    result: "STATIC_VERIFIED", output: undefined, fixture: undefined,
    execution: { job_id: null, started_at: "2026-08-08T12:00:00.000Z", completed_at: "2026-08-08T12:00:00.000Z" },
  });
  const w = gateway.qualification.writeQualificationRecord(staticRec, { qualificationRoot: root });
  assert.ok(w.latest_static);
  assert.equal(w.latest_passed, undefined);
  assert.deepEqual(gateway.qualification.readLatestPassed(entry.id, { qualificationRoot: root }), good);
});

test("comfyui-qualification records: no environment secrets serialized", () => {
  const root = tmpDir("comfyui-qrec-");
  const { entry } = syntheticRegistry("flux-gguf-1080x1920");
  process.env.COMFYUI_QUAL_TEST_CANARY = "super-secret-canary-value-1234";
  try {
    const written = gateway.qualification.writeQualificationRecord(passedRecord(entry, syntheticFingerprint()), { qualificationRoot: root });
    const raw = fs.readFileSync(written.latest_passed, "utf8");
    assert.ok(!raw.includes("super-secret-canary-value-1234"));
    assert.ok(!raw.includes("OPENAI_API_KEY"));
  } finally {
    delete process.env.COMFYUI_QUAL_TEST_CANARY;
  }
});

// ---- fingerprint comparison --------------------------------------------------------

test("comfyui-qualification comparison: identical environment → current; authoritative changes → stale with named reasons", () => {
  const q = syntheticFingerprint();
  assert.equal(gateway.qualification.compareFingerprints(q, syntheticFingerprint()).status, "current");

  const shaChanged = syntheticFingerprint({ workflow: { ...q.workflow, sha256: "e".repeat(64) } });
  const cmp1 = gateway.qualification.compareFingerprints(q, shaChanged);
  assert.equal(cmp1.status, "stale");

  const coreChanged = syntheticFingerprint({ comfyui: { version: "0.28.0", git_commit: "bbbb2222bbbb2222", identity_level: "git_commit" } });
  const cmp2 = gateway.qualification.compareFingerprints(q, coreChanged);
  assert.equal(cmp2.status, "stale");
  assert.ok(cmp2.reasons.some((r) => r.includes("0.27.0") && r.includes("0.28.0")), "reason names both versions");

  const nodeChanged = syntheticFingerprint({
    custom_nodes: [{ class: "UnetLoaderGGUF", package: "ComfyUI-GGUF", present: true, identity: { level: "git_commit", git_commit: "1234567", package_version: "2.1.0" } }],
  });
  assert.equal(gateway.qualification.compareFingerprints(q, nodeChanged).status, "stale");
});

test("comfyui-qualification comparison: weak identity never claims verified_same and never goes stale on its own", () => {
  const weakNode = { class: "UnetLoaderGGUF", package: null, present: true, identity: { level: "class_presence_only" } };
  const weakModel = { class_type: "UnetLoaderGGUF", input_key: "unet_name", name: "flux1-dev-Q8_0.gguf", present: true, identity: { level: "filename_only", filename: "flux1-dev-Q8_0.gguf" } };
  const q = syntheticFingerprint({ custom_nodes: [weakNode], models: [weakModel] });
  const c = syntheticFingerprint({ custom_nodes: [{ ...weakNode }], models: [{ ...weakModel }] });
  const cmp = gateway.qualification.compareFingerprints(q, c);
  assert.equal(cmp.status, "current");
  const model = cmp.components.find((x) => x.component === "model");
  const node = cmp.components.find((x) => x.component === "custom_node");
  assert.equal(model.classification, "present_but_identity_weak");
  assert.equal(node.classification, "present_but_identity_weak");
  assert.ok(cmp.notes.some((n) => n.includes("VERSION_NOT_AUTHORITATIVE")));
});

test("comfyui-qualification comparison: missing required model or custom node → blocked", () => {
  const q = syntheticFingerprint();
  const modelGone = syntheticFingerprint({ models: [{ ...q.models[0], present: false, identity: { level: "unknown", filename: q.models[0].name } }] });
  assert.equal(gateway.qualification.compareFingerprints(q, modelGone).status, "blocked");
  const nodeGone = syntheticFingerprint({ custom_nodes: [] });
  assert.equal(gateway.qualification.compareFingerprints(q, nodeGone).status, "blocked");
});

// ---- evaluation & bootstrap ----------------------------------------------------------

test("comfyui-qualification evaluation: bootstrap NONE, workflow-sha staleness, current-environment LIVE_PASSED", () => {
  const root = tmpDir("comfyui-qeval-");
  const { entry } = syntheticRegistry("flux-gguf-1080x1920");
  // no records → bootstrap, never a block
  const none = gateway.qualification.evaluateQualification(entry, { qualificationRoot: root });
  assert.equal(none.evidence_state, "NONE");
  assert.ok(none.reasons.some((r) => r.includes("QUALIFICATION_PENDING")));
  // record for a DIFFERENT workflow sha → STALE
  const fp = syntheticFingerprint({ workflow: { id: entry.id, version: 1, sha256: "d".repeat(64) } });
  gateway.qualification.writeQualificationRecord(passedRecord(entry, fp, { workflow: { id: entry.id, version: 1, sha256: "d".repeat(64) } }), { qualificationRoot: root });
  const stale = gateway.qualification.evaluateQualification(entry, { qualificationRoot: root });
  assert.equal(stale.evidence_state, "STALE");
  assert.ok(stale.reasons[0].includes("workflow graph changed"));
  // record matching the entry + matching current environment → LIVE_PASSED
  const root2 = tmpDir("comfyui-qeval-");
  const goodFp = syntheticFingerprint({ workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 } });
  gateway.qualification.writeQualificationRecord(passedRecord(entry, goodFp), { qualificationRoot: root2 });
  const live = gateway.qualification.evaluateQualification(entry, { qualificationRoot: root2, currentFingerprint: goodFp });
  assert.equal(live.evidence_state, "LIVE_PASSED");
  assert.equal(live.environment_status, "current");
});

test("comfyui-qualification sync gate: bootstrap warns, sha-mismatch blocks with remediation, override downgrades", () => {
  const root = tmpDir("comfyui-qgate-");
  const { entry, registryPath } = syntheticRegistry("flux-gguf-1080x1920");
  // bootstrap: warning, not a block — production keeps running on deploy day
  const boot = gateway.qualification.qualifySyncGate(entry, { qualificationRoot: root, driftOverride: false });
  assert.equal(boot.warnings.length, 1);
  assert.ok(boot.warnings[0].includes("QUALIFICATION_PENDING"));
  // qualified against an older graph → QUALIFICATION_STALE (409, remediation command included)
  gateway.qualification.writeQualificationRecord(
    passedRecord(entry, syntheticFingerprint(), { workflow: { id: entry.id, version: 1, sha256: "d".repeat(64) } }),
    { qualificationRoot: root }
  );
  let thrown = null;
  try { gateway.qualification.qualifySyncGate(entry, { qualificationRoot: root, driftOverride: false }); } catch (e) { thrown = e; }
  assert.equal(thrown.code, "comfyui_qualification_stale");
  assert.equal(thrown.statusCode, 409);
  assert.ok(thrown.message.includes("--qualify-render"), "error tells the operator the exact requalification command");
  assert.ok(thrown.message.includes("No production render was submitted"));
  const over = gateway.qualification.qualifySyncGate(entry, { qualificationRoot: root, driftOverride: true });
  assert.ok(over.warnings[0].includes("DRIFT OVERRIDE ACTIVE"));
  // preflightSync integration: same behavior through the dispatch-path gate
  const viaPreflight = () => gateway.preflight.preflightSync(entry.id, { registryPath, qualificationRoot: root, driftOverride: false });
  assert.throws(viaPreflight, /QUALIFICATION_STALE/);
  const okBoot = gateway.preflight.preflightSync(entry.id, { registryPath, qualificationRoot: tmpDir("comfyui-qgate-"), driftOverride: false });
  assert.ok(okBoot.warnings.some((w) => w.includes("QUALIFICATION_PENDING")));
});

test("comfyui-qualification lifecycle: EXPERIMENTAL/DEPRECATED stay blocked; evidence never mutates registry lifecycle", () => {
  const dep = syntheticRegistry("flux-gguf-1080x1920", { qualification: "DEPRECATED" });
  const exp = syntheticRegistry("flux-gguf-1080x1920", { qualification: "EXPERIMENTAL" });
  for (const { entry } of [dep, exp]) {
    const verdict = gateway.registry.assertProductionAllowed(entry);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, "comfyui_workflow_unqualified");
  }
  // writing evidence must not touch the registry file
  const { entry, registryPath } = syntheticRegistry("flux-gguf-1080x1920");
  const before = fs.readFileSync(registryPath, "utf8");
  gateway.qualification.writeQualificationRecord(passedRecord(entry, syntheticFingerprint()), { qualificationRoot: tmpDir("comfyui-ql-") });
  assert.equal(fs.readFileSync(registryPath, "utf8"), before);
});

// ---- upgrade guard --------------------------------------------------------------------

test("comfyui-qualification upgrade guard: synthetic fingerprints classify drift per component with production impact", () => {
  const root = tmpDir("comfyui-qup-");
  const { entry } = syntheticRegistry("flux-gguf-1080x1920");
  const qualifiedFp = syntheticFingerprint({ workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 } });
  gateway.qualification.writeQualificationRecord(passedRecord(entry, qualifiedFp), { qualificationRoot: root });

  const currentChanged = syntheticFingerprint({
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    comfyui: { version: "0.28.0", git_commit: "cccc3333cccc3333", identity_level: "git_commit" },
    custom_nodes: [{ class: "UnetLoaderGGUF", package: "ComfyUI-GGUF", present: true, identity: { level: "git_commit", git_commit: "fedcba9", package_version: "2.1.0" } }],
  });
  const report = gateway.qualification.buildUpgradeReport([entry], { [entry.id]: currentChanged }, { qualificationRoot: root });
  const row = report.workflows[0];
  assert.equal(row.status, "REQUALIFICATION_REQUIRED");
  const core = row.components.find((c) => c.component === "comfyui" && c.name === "version");
  assert.equal(core.classification, "verified_changed");
  assert.equal(core.qualified, "0.27.0");
  assert.equal(core.current, "0.28.0");
  const node = row.components.find((c) => c.component === "custom_node");
  assert.equal(node.classification, "verified_changed");

  // unchanged environment → NO_RELEVANT_DRIFT; no evidence → nothing to compare
  const same = gateway.qualification.buildUpgradeReport([entry], { [entry.id]: qualifiedFp }, { qualificationRoot: root });
  assert.equal(same.workflows[0].status, "NO_RELEVANT_DRIFT");
  const noEvidence = gateway.qualification.buildUpgradeReport([entry], { [entry.id]: qualifiedFp }, { qualificationRoot: tmpDir("comfyui-qup-") });
  assert.equal(noEvidence.workflows[0].status, "NO_QUALIFICATION_EVIDENCE");
});

// ---- canonical fixtures ------------------------------------------------------------------

test("comfyui-qualification fixtures: all repo fixtures validate against the real registry (source hash pinned)", () => {
  const parsed = gateway.fixtures.loadFixtures();
  assert.equal(parsed.fixtures.length, 3);
  for (const fixture of parsed.fixtures) {
    const v = gateway.fixtures.validateFixture(fixture);
    assert.ok(v.ok, `${fixture.id}: ${v.problems.join("; ")}`);
    assert.ok(Number.isInteger(fixture.seed));
  }
  // parameter identity is deterministic
  const f = gateway.fixtures.getFixture("flux-production-smoke-v1");
  assert.equal(gateway.fixtures.parameterSha256(f), gateway.fixtures.parameterSha256(JSON.parse(JSON.stringify(f))));
});

test("comfyui-qualification fixtures: malformed fixtures fail before any GPU work", () => {
  const good = gateway.fixtures.getFixture("wan22-hq-smoke-v1");
  assert.throws(() => gateway.fixtures.getFixture("nope"), /unknown qualification fixture/);
  const unknownWf = gateway.fixtures.validateFixture({ ...good, workflow: "not-registered" });
  assert.equal(unknownWf.ok, false);
  const badSeed = gateway.fixtures.validateFixture({ ...good, seed: "random" });
  assert.ok(badSeed.problems.some((p) => p.includes("seed")));
  const badHash = gateway.fixtures.validateFixture({ ...good, source_sha256: "0".repeat(64) });
  assert.ok(badHash.problems.some((p) => p.includes("hash mismatch")));
  const badExpected = gateway.fixtures.validateFixture({ ...good, expected: { ...good.expected, width: 999 } });
  assert.ok(badExpected.problems.some((p) => p.includes("disagrees with the registry contract")));
});

// ---- qualification runner ------------------------------------------------------------------

test("comfyui-qualification runner: FLUX full chain with fake executor — patched graph, validation, provenance, record", async () => {
  const root = tmpDir("comfyui-qrun-");
  const { entry, registryPath } = syntheticRegistry("flux-gguf-1080x1920");
  const fetchImpl = fakeComfyFetch();
  let seenWorkflowPath = null;
  const result = await gateway.qualify.runFluxQualification({
    registryPath, qualificationRoot: root, fetchImpl, local: false,
    executor: async ({ workflowPath }) => {
      seenWorkflowPath = workflowPath;
      const out = path.join(path.dirname(workflowPath), "comfy-output.png");
      writeFakePng(out, 1080, 1920);
      return { outputPath: out, promptId: "prompt-xyz" };
    },
  });
  assert.equal(result.ok, true, result.error && result.error.message);
  const rec = result.record;
  assert.equal(rec.result, "LIVE_PASSED");
  assert.equal(rec.workflow.sha256, entry.canonical_sha256);
  assert.equal(rec.fixture.id, "flux-production-smoke-v1");
  assert.equal(rec.execution.comfyui_prompt_id, "prompt-xyz");
  assert.equal(rec.output.technical_validation, "passed");
  assert.equal(rec.output.width, 1080);
  assert.ok(/^[0-9a-f]{64}$/.test(rec.output.sha256));
  assert.ok(fs.existsSync(rec.output.path), "artifact retained in evidence dir");
  assert.ok(fs.existsSync(rec.render_provenance.path), "render provenance manifest written");
  assert.ok(fs.existsSync(path.join(root, entry.id, "latest-passed.json")));
  // the graph the executor received was patched through the registry bindings
  const patched = JSON.parse(fs.readFileSync(seenWorkflowPath, "utf8"));
  const promptNode = patched.nodes.find((n) => n.id === 7);
  const noiseNode = patched.nodes.find((n) => n.id === 13);
  const saveNode = patched.nodes.find((n) => n.id === 17);
  assert.ok(promptNode.widgets_values[0].includes("brushed aluminium slider"));
  assert.equal(noiseNode.widgets_values[0], 424242);
  assert.equal(noiseNode.widgets_values[1], "fixed");
  assert.ok(saveNode.widgets_values[0].startsWith("vidtoolz-qualification/"));
  // the whole chain performed only GET-shaped read-only API calls
  assert.ok(fetchImpl.calls.every((c) => c.method === "GET"));
});

test("comfyui-qualification runner: failure records diagnostics and preserves the previous success", async () => {
  const root = tmpDir("comfyui-qrun-");
  const { entry, registryPath } = syntheticRegistry("flux-gguf-1080x1920");
  const fetchImpl = fakeComfyFetch();
  const ok = await gateway.qualify.runFluxQualification({
    registryPath, qualificationRoot: root, fetchImpl, local: false,
    executor: async ({ workflowPath }) => {
      const out = path.join(path.dirname(workflowPath), "out.png");
      writeFakePng(out, 1080, 1920);
      return { outputPath: out };
    },
  });
  assert.equal(ok.ok, true);
  const failed = await gateway.qualify.runFluxQualification({
    registryPath, qualificationRoot: root, fetchImpl, local: false,
    executor: async () => { throw Object.assign(new Error("CUDA out of memory. Tried to allocate 20 GiB"), { raw: "CUDA out of memory. Tried to allocate 20 GiB" }); },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.record.result, "FAILED");
  assert.equal(failed.record.failure.class, "CUDA_OOM");
  assert.ok(failed.record.failure.raw.includes("CUDA out of memory"));
  // last success intact
  assert.deepEqual(gateway.qualification.readLatestPassed(entry.id, { qualificationRoot: root }), ok.record);
  // wrong-dimension output is a technical validation failure, not a pass
  const wrongDims = await gateway.qualify.runFluxQualification({
    registryPath, qualificationRoot: root, fetchImpl, local: false,
    executor: async ({ workflowPath }) => {
      const out = path.join(path.dirname(workflowPath), "small.png");
      writeFakePng(out, 512, 512);
      return { outputPath: out };
    },
  });
  assert.equal(wrongDims.ok, false);
  assert.ok(wrongDims.error.message.includes("width 512"));
});

test("comfyui-qualification runner: Wan harness runs the full chain with an injected executor; refuses without one", async () => {
  const root = tmpDir("comfyui-qwan-");
  const { entry, registryPath } = syntheticRegistry("wan22-i2v-hq");
  // no executor → explicit refusal (there is NO default live Wan render path)
  await assert.rejects(
    gateway.qualify.runWanQualification({ registryPath, qualificationRoot: root, fixtureId: "wan22-hq-smoke-v1" }),
    (e) => e.code === "comfyui_qualification_render_not_authorized"
  );
  // with an injected executor the real chain runs: fixture → contract →
  // gate → fingerprint → preflight → validation → record
  const work = tmpDir("comfyui-qwan-out-");
  const outPath = path.join(work, "output.mp4");
  fs.writeFileSync(outPath, "fake-mp4-bytes");
  const ffprobe = {
    streams: [{ codec_type: "video", width: 720, height: 1280, r_frame_rate: "24/1", nb_frames: "97", codec_name: "h264" }],
    format: { duration: "4.04" },
  };
  let receivedRequest = null;
  const result = await gateway.qualify.runWanQualification({
    registryPath, qualificationRoot: root, fixtureId: "wan22-hq-smoke-v1",
    fingerprint: syntheticFingerprint({ workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 } }),
    preflight: { ok: true, checks: [] },
    executor: async (request) => {
      receivedRequest = request;
      return { outputPath: outPath, jobId: "wan-job-1", promptId: "wp-1", ffprobe };
    },
  });
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.record.result, "LIVE_PASSED");
  assert.equal(result.record.output.width, 720);
  assert.equal(result.record.output.frames, undefined); // frames live in validation, record keeps contract fields
  assert.equal(result.record.execution.job_id, "wan-job-1");
  assert.equal(receivedRequest.params.seed, 424242);
  assert.ok(receivedRequest.params.source_image.endsWith("qualification-source-720x1280.png"));
  assert.ok(receivedRequest.params.prompt.includes("no people"));
  // and a bad ffprobe result fails technical validation honestly
  const badResult = await gateway.qualify.runWanQualification({
    registryPath, qualificationRoot: tmpDir("comfyui-qwan-"), fixtureId: "wan22-hq-smoke-v1",
    fingerprint: syntheticFingerprint({ workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 } }),
    preflight: { ok: true, checks: [] },
    executor: async () => ({ outputPath: outPath, jobId: "wan-job-2", ffprobe: { streams: [{ codec_type: "video", width: 720, height: 1280, r_frame_rate: "24/1", nb_frames: "42" }], format: { duration: "1.75" } } }),
  });
  assert.equal(badResult.ok, false);
  assert.equal(badResult.record.result, "FAILED");
});

// ---- GPU-execution isolation ------------------------------------------------------------------

test("comfyui-qualification safety: no gateway module can submit GPU work implicitly", () => {
  // the read-only client has no POST path and no /prompt submission
  const clientSrc = fs.readFileSync(path.join(REPO, "comfyui-gateway", "client.js"), "utf8");
  assert.ok(!clientSrc.includes("'/prompt'") && !clientSrc.includes('"/prompt"'), "client must stay read-only");
  assert.ok(!/method:\s*['"]POST/.test(clientSrc));
  // the only live executor is gated behind an explicit flag
  const qualifySrc = fs.readFileSync(path.join(REPO, "comfyui-gateway", "qualify.js"), "utf8");
  assert.ok(qualifySrc.includes("allowLiveRender === true"), "live executor requires explicit intent");
  assert.throws(() => gateway.qualify.resolveExecutor({}), /refused/);
  const fake = () => {};
  assert.equal(gateway.qualify.resolveExecutor({ executor: fake }), fake);
  // PNG validation helper is honest about non-PNG bytes
  const junk = path.join(tmpDir("comfyui-png-"), "junk.png");
  fs.writeFileSync(junk, "not a png at all............");
  assert.throws(() => gateway.qualify.readPngDimensions(junk), /not a PNG/);
});

// ---- P2: production-derived qualification ------------------------------------------------

test("comfyui-qualification production capture: an accepted real Wan render becomes LIVE_PASSED evidence", () => {
  const root = tmpDir("comfyui-prod-");
  const { entry } = syntheticRegistry("wan22-i2v-hq");
  const runsRoot = tmpDir("comfyui-runs-");
  const runDir = writeWanRunDir(runsRoot, "2026-08-08-120000-flux-031-abcd1234");
  const prov = gateway.provenance.buildWanRunProvenance(runDir, { entry, packageId: "pkg-1", completedAtOverride: undefined });
  assert.equal(prov.written, true);
  // the provenance manifest now carries genuine-execution evidence
  assert.equal(prov.manifest.execution.execution_mode, "executed");
  assert.equal(prov.manifest.execution.run_status, "verified");
  assert.equal(prov.manifest.execution.elapsed_seconds, 3038.56);

  const fp = wanFingerprint(entry);
  const result = gateway.qualification.captureProductionQualification(
    { entry, runDir, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(result.captured, true, JSON.stringify(result.reasons));
  const rec = result.record;
  assert.equal(rec.result, "LIVE_PASSED");
  assert.equal(rec.evidence_source, "production_render");
  assert.equal(rec.workflow.sha256, entry.canonical_sha256);
  assert.equal(rec.production.run_id, "2026-08-08-120000-flux-031-abcd1234");
  assert.equal(rec.execution.job_id, "2026-08-08-120000-flux-031-abcd1234");
  assert.equal(rec.execution.comfyui_prompt_id, "2a6a112c-0c5d-456a-a388-52e79f424845");
  assert.equal(rec.execution.execution_mode, "executed");
  assert.ok(/^[0-9a-f]{64}$/.test(rec.output.sha256));
  assert.equal(rec.output.sha256, prov.manifest.output.sha256, "output identity comes from the immutable provenance");
  assert.equal(rec.render_provenance.path, prov.path);
  assert.ok(/^[0-9a-f]{64}$/.test(rec.render_provenance.sha256));
  assert.equal(rec.fixture, null);
  // evidence surfaces through evaluation with the new additive fields
  const ev = gateway.qualification.evaluateQualification(entry, { qualificationRoot: root });
  assert.equal(ev.evidence_state, "LIVE_PASSED");
  assert.equal(ev.evidence_source, "production_render");
  assert.equal(ev.execution_mode, "executed");
  assert.equal(ev.last_qualified_at !== null, true);
});

test("comfyui-qualification production capture: idempotent — re-finalizing the same run never duplicates evidence", () => {
  const root = tmpDir("comfyui-prod-");
  const { entry } = syntheticRegistry("wan22-i2v-hq");
  const runsRoot = tmpDir("comfyui-runs-");
  const runDir = writeWanRunDir(runsRoot, "run-idem-1");
  gateway.provenance.buildWanRunProvenance(runDir, { entry });
  const fp = wanFingerprint(entry);
  const first = gateway.qualification.captureProductionQualification({ entry, runDir, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(first.captured, true);
  const second = gateway.qualification.captureProductionQualification({ entry, runDir, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(second.captured, false);
  assert.equal(second.already_captured, true);
  assert.equal(second.qualification_id, first.qualification_id);
  const attempts = fs.readdirSync(path.join(root, entry.id, "attempts")).filter((n) => n.includes("qual-prod-"));
  assert.equal(attempts.length, 1, "one deterministic attempt file per run");
  // a DIFFERENT run is materially distinct evidence and is not discarded
  const runDir2 = writeWanRunDir(runsRoot, "run-idem-2");
  gateway.provenance.buildWanRunProvenance(runDir2, { entry });
  const third = gateway.qualification.captureProductionQualification({ entry, runDir: runDir2, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(third.captured, true);
  assert.notEqual(third.qualification_id, first.qualification_id);
});

test("comfyui-qualification production capture: ineligible renders are refused with named reasons", () => {
  const root = tmpDir("comfyui-prod-");
  const { entry } = syntheticRegistry("wan22-i2v-hq");
  const runsRoot = tmpDir("comfyui-runs-");
  const fp = wanFingerprint(entry);

  // missing prompt id → execution evidence missing → cannot qualify
  const noPrompt = writeWanRunDir(runsRoot, "run-noprompt", { runLog: { prompt_id: null } });
  gateway.provenance.buildWanRunProvenance(noPrompt, { entry });
  const r1 = gateway.qualification.captureProductionQualification({ entry, runDir: noPrompt, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(r1.captured, false);
  assert.ok(r1.reasons.includes("comfyui_prompt_id_missing"));

  // suspiciously fast completion → plausibly cache-served → conservative refusal
  const fast = writeWanRunDir(runsRoot, "run-cached", { runLog: { elapsed: "2.1" } });
  gateway.provenance.buildWanRunProvenance(fast, { entry });
  const r2 = gateway.qualification.captureProductionQualification({ entry, runDir: fast, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(r2.captured, false);
  assert.ok(r2.reasons.some((x) => x.includes("execution_not_proven_live")));

  // run not verified by the lane → refuse
  const unverified = writeWanRunDir(runsRoot, "run-unverified", { runLog: { status: "failed_verification" } });
  gateway.provenance.buildWanRunProvenance(unverified, { entry });
  const r3 = gateway.qualification.captureProductionQualification({ entry, runDir: unverified, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(r3.captured, false);
  assert.ok(r3.reasons.some((x) => x.includes("run_not_verified")));

  // wrong output geometry → technical contract failure → refuse
  const wrongDims = writeWanRunDir(runsRoot, "run-wrongdims", {
    ffprobe: { streams: [{ codec_type: "video", width: 480, height: 854, r_frame_rate: "24/1", nb_frames: "97" }], format: { duration: "4.04" } },
  });
  gateway.provenance.buildWanRunProvenance(wrongDims, { entry });
  const r4 = gateway.qualification.captureProductionQualification({ entry, runDir: wrongDims, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(r4.captured, false);
  assert.ok(r4.reasons.some((x) => x.includes("output_contract")));

  // workflow sha mismatch (provenance from a different graph) → refuse
  const drifted = writeWanRunDir(runsRoot, "run-drifted");
  gateway.provenance.buildWanRunProvenance(drifted, { entry: { ...entry, canonical_sha256: "e".repeat(64) } });
  const r5 = gateway.qualification.captureProductionQualification({ entry, runDir: drifted, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(r5.captured, false);
  assert.ok(r5.reasons.includes("workflow_sha_mismatch"));

  // no render provenance at all → refuse
  const bare = writeWanRunDir(runsRoot, "run-noprov");
  const r6 = gateway.qualification.captureProductionQualification({ entry, runDir: bare, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(r6.captured, false);
  assert.ok(r6.reasons.includes("render_provenance_missing"));

  // environment missing a required dependency → refuse
  const goodRun = writeWanRunDir(runsRoot, "run-depmissing");
  gateway.provenance.buildWanRunProvenance(goodRun, { entry });
  const brokenFp = wanFingerprint(entry, { models: [{ class_type: "UNETLoader", input_key: "unet_name", name: "wan-model", present: false, identity: { level: "unknown" } }] });
  const r7 = gateway.qualification.captureProductionQualification({ entry, runDir: goodRun, fingerprint: brokenFp }, { qualificationRoot: root });
  assert.equal(r7.captured, false);
  assert.ok(r7.reasons.some((x) => x.includes("environment_dependency_missing")));

  // and none of the refusals wrote any evidence
  assert.ok(!fs.existsSync(path.join(root, entry.id, "latest-passed.json")));
});

test("comfyui-qualification production capture: a failed render preserves the last success; unrelated failure does not stale it", () => {
  const root = tmpDir("comfyui-prod-");
  const { entry } = syntheticRegistry("wan22-i2v-hq");
  const runsRoot = tmpDir("comfyui-runs-");
  const good = writeWanRunDir(runsRoot, "run-good");
  gateway.provenance.buildWanRunProvenance(good, { entry });
  const fp = wanFingerprint(entry);
  const captured = gateway.qualification.captureProductionQualification({ entry, runDir: good, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(captured.captured, true);

  // a later failed run produces no output.mp4 → provenance skips it → nothing captured
  const failed = writeWanRunDir(runsRoot, "run-failed", { noOutput: true });
  const provFailed = gateway.provenance.buildWanRunProvenance(failed, { entry });
  assert.equal(provFailed.written, false);
  const captures = gateway.qualification.captureProductionQualificationForResults(
    [{ run: "run-failed", path: provFailed.path }], { entry, fingerprint: fp }, { qualificationRoot: root });
  assert.equal(captures[0].captured, false);
  assert.deepEqual(gateway.qualification.readLatestPassed(entry.id, { qualificationRoot: root }), captured.record, "last success preserved");

  // an unrelated INPUT_MISSING failure attempt does not stale prior qualification
  gateway.qualification.writeQualificationRecord({
    schema_version: 1, qualification_id: "qual-fail-1", result: "FAILED",
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    environment_fingerprint: fp,
    execution: { job_id: "j-f", started_at: "2026-08-09T10:00:00.000Z", completed_at: "2026-08-09T10:00:01.000Z" },
    failure: { class: "INPUT_MISSING", raw: "source image missing" },
    generated_by: "test",
  }, { qualificationRoot: root });
  const ev = gateway.qualification.evaluateQualification(entry, { qualificationRoot: root });
  assert.equal(ev.evidence_state, "LIVE_PASSED", "unrelated failure must not invalidate environment qualification");
  assert.ok(ev.notes.some((n) => n.includes("FAILED")), "but the failed attempt stays visible");
});

// ---- P2: stronger PRESTO identity ---------------------------------------------------------

test("comfyui-qualification remote identity: /api/experiment/models upgrades models to filename_size_mtime with source", async () => {
  const { entry, registryPath } = syntheticRegistry("wan22-i2v-fast");
  const names = entry.required_models.map((m) => m.name);
  const folderOf = { UNETLoader: "diffusion_models", CLIPLoader: "text_encoders", VAELoader: "vae", LoraLoaderModelOnly: "loras" };
  const modelFolders = {};
  for (const m of entry.required_models) {
    const folder = folderOf[m.class_type];
    (modelFolders[folder] = modelFolders[folder] || []).push({ name: m.name, size: 1000 + names.indexOf(m.name), modified: 1780670022.69 });
  }
  const fp = await gateway.fingerprint.collectFingerprint(entry, {
    registryPath, local: false, fetchImpl: fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090", modelFolders }),
  });
  assert.equal(fp.models.length, 6);
  for (const m of fp.models) {
    assert.equal(m.present, true, m.name);
    assert.equal(m.identity.level, "filename_size_mtime", m.name);
    assert.equal(m.identity.source, "comfyui_models_api");
    assert.ok(Number.isFinite(m.identity.bytes));
    assert.ok(m.identity.mtime.startsWith("2026-"));
  }
  // host without the endpoint falls back honestly to filename_only
  const weak = await gateway.fingerprint.collectFingerprint(entry, {
    registryPath, local: false, fetchImpl: fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0" }),
  });
  assert.ok(weak.models.every((m) => m.identity.level === "filename_only" && m.identity.source === "comfyui_object_info"));
});

test("comfyui-qualification remote identity: same-filename model replacement detected via size or mtime", () => {
  const { entry } = syntheticRegistry("wan22-i2v-hq");
  const base = wanFingerprint(entry);
  const model = base.models[0];
  const clone = (identity) => wanFingerprint(entry, { models: [{ ...model, identity: { ...model.identity, ...identity } }] });

  assert.equal(gateway.qualification.compareFingerprints(base, clone({})).status, "current");
  const sizeChanged = gateway.qualification.compareFingerprints(base, clone({ bytes: 99999 }));
  assert.equal(sizeChanged.status, "stale");
  assert.ok(sizeChanged.reasons.length > 0);
  const mtimeChanged = gateway.qualification.compareFingerprints(base, clone({ mtime: "2026-08-09T00:00:00.000Z" }));
  assert.equal(mtimeChanged.status, "stale");
  // no cryptographic claim is ever made at this level
  const same = gateway.qualification.compareFingerprints(base, clone({}));
  const comp = same.components.find((c) => c.component === "model");
  assert.equal(comp.level, "filename_size_mtime");
  assert.notEqual(comp.level, "sha256");
  // missing file → blocked
  const gone = wanFingerprint(entry, { models: [{ ...model, present: false, identity: { level: "unknown" } }] });
  assert.equal(gateway.qualification.compareFingerprints(base, gone).status, "blocked");
});

test("comfyui-qualification identity strength: a stronger observer is not proof of drift", () => {
  const { entry } = syntheticRegistry("wan22-i2v-hq");
  const model = { class_type: "UNETLoader", input_key: "unet_name", name: "wan-model.safetensors" };
  // historical evidence was filename_only (pre-P2); current probe returns size+mtime
  const weakHistoric = wanFingerprint(entry, { models: [{ ...model, present: true, identity: { level: "filename_only", source: "comfyui_object_info", filename: model.name } }] });
  const strongCurrent = wanFingerprint(entry, { models: [{ ...model, present: true, identity: { level: "filename_size_mtime", source: "comfyui_models_api", filename: model.name, bytes: 5000, mtime: "2026-08-08T00:00:00.000Z" } }] });
  const cmp = gateway.qualification.compareFingerprints(weakHistoric, strongCurrent);
  assert.equal(cmp.status, "current", "MODEL_CHANGED must not be claimed from an identity-level upgrade");
  const comp = cmp.components.find((c) => c.component === "model");
  assert.equal(comp.classification, "identity_strength_changed");
  assert.ok(cmp.notes.some((n) => n.includes("requalification recommended")));
  // same for custom nodes: presence-only history vs git-commit present
  const weakNode = wanFingerprint(entry, { custom_nodes: [{ class: "X", package: null, present: true, identity: { level: "class_presence_only" } }] });
  const strongNode = wanFingerprint(entry, { custom_nodes: [{ class: "X", package: "pkg", present: true, identity: { level: "git_commit", git_commit: "abc1234" } }] });
  const nodeCmp = gateway.qualification.compareFingerprints(weakNode, strongNode);
  assert.equal(nodeCmp.status, "current");
  assert.equal(nodeCmp.components.find((c) => c.component === "custom_node").classification, "identity_strength_changed");
  // and qualification evidence stays LIVE_PASSED, not STALE
  const root = tmpDir("comfyui-strength-");
  gateway.qualification.writeQualificationRecord(passedRecord(entry, weakHistoric, { workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 } }), { qualificationRoot: root });
  const ev = gateway.qualification.evaluateQualification(entry, { qualificationRoot: root, currentFingerprint: strongCurrent });
  assert.equal(ev.evidence_state, "LIVE_PASSED");
});

test("comfyui-qualification upgrade guard: STATIC_VERIFIED records provide a labeled comparison baseline", () => {
  const root = tmpDir("comfyui-static-base-");
  const { entry } = syntheticRegistry("wan22-i2v-hq");
  const fp = wanFingerprint(entry);
  gateway.qualification.writeQualificationRecord({
    schema_version: 1, qualification_id: "static-1", result: "STATIC_VERIFIED",
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    environment_fingerprint: fp,
    execution: { job_id: null, started_at: "2026-08-08T10:00:00.000Z", completed_at: "2026-08-08T10:00:00.000Z" },
    generated_by: "test",
  }, { qualificationRoot: root });
  const report = gateway.qualification.buildUpgradeReport([entry], { [entry.id]: wanFingerprint(entry) }, { qualificationRoot: root });
  assert.equal(report.workflows[0].baseline, "static_verified");
  assert.equal(report.workflows[0].status, "NO_RELEVANT_DRIFT");
  const changed = gateway.qualification.buildUpgradeReport([entry], {
    [entry.id]: wanFingerprint(entry, { comfyui: { version: "0.23.0", identity_level: "package_version", source: "comfyui_system_stats" } }),
  }, { qualificationRoot: root });
  assert.equal(changed.workflows[0].status, "REQUALIFICATION_REQUIRED");
});

test("comfyui-qualification server wiring: the PRESTO close hook captures production qualification after provenance", () => {
  const src = fs.readFileSync(path.join(REPO, "package-engine-server.js"), "utf8");
  const closeHook = src.slice(src.indexOf("buildWanProvenanceForRunsSince"), src.indexOf("buildWanProvenanceForRunsSince") + 3000);
  assert.ok(closeHook.includes("captureProductionQualificationForResults"), "close hook wires production capture");
  assert.ok(closeHook.includes("collectFingerprint"), "capture uses a live environment fingerprint");
  assert.ok(closeHook.includes("qualification_capture_error"), "capture failure is surfaced, not swallowed");
  assert.ok(src.indexOf("captureProductionQualificationForResults") > src.indexOf("buildWanProvenanceForRunsSince"), "qualification is evaluated only after provenance/validation");
});

// ---- P4: supervised upgrade sessions -------------------------------------------------------

// Two-host synthetic registry: wan hq+fast on "presto-test", flux on
// "flux-test" — host names derived from endpoint authority, so scoping is
// deterministic regardless of the machine running the tests.
function upgradeFixture({ modelFolders } = {}) {
  const work = tmpDir("comfyui-upg-");
  const entries = [];
  for (const [wf, endpoint] of [["wan22-i2v-hq", "http://presto-test:8188"], ["wan22-i2v-fast", "http://presto-test:8188"], ["flux-gguf-1080x1920", "http://flux-test:8188"]]) {
    const real = gateway.registry.getWorkflow(wf);
    const runtimeCopy = path.join(work, `${wf}-runtime.json`);
    fs.copyFileSync(gateway.registry.canonicalAbsolutePath(real), runtimeCopy);
    entries.push({ ...JSON.parse(JSON.stringify(real)), runtime_copies: [runtimeCopy], comfyui: { endpoint_default: endpoint, endpoint_env: [] } });
  }
  const registryPath = path.join(work, "registry.json");
  fs.writeFileSync(registryPath, JSON.stringify({ registry_version: 1, workflows: entries }));
  const folders = modelFolders !== undefined ? modelFolders : wanModelFolders();
  const options = {
    registryPath,
    upgradeRoot: path.join(work, "upgrades"),
    permitRoot: path.join(work, "permits"),
    qualificationRoot: path.join(work, "qual"),
    local: false,
    fetchImpl: fakeComfyFetch({ objectInfo: { ...WAN_OBJECT_INFO, ...FLUX_OBJECT_INFO }, version: "0.22.0", gpu: "RTX 4090", modelFolders: folders }),
  };
  return { work, entries, registryPath, options };
}

function wanModelFolders(mutate) {
  const folders = {
    diffusion_models: [
      { name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", size: 14294742832, modified: 1780670022.69 },
      { name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", size: 14294742832, modified: 1780670026.0 },
    ],
    text_encoders: [{ name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", size: 6735906897, modified: 1780259374.0 }],
    vae: [{ name: "wan_2.1_vae.safetensors", size: 253815318, modified: 1780669752.0 }],
    loras: [
      { name: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", size: 1226977424, modified: 1780670100.0 },
      { name: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", size: 1226977424, modified: 1780670101.0 },
    ],
    unet: [{ name: "flux1-dev-Q8_0.gguf", size: 12708281504, modified: 1780671022.0 }],
    clip: [
      { name: "t5-v1_1-xxl-encoder-Q5_K_M.gguf", size: 3386856640, modified: 1780671023.0 },
      { name: "clip_l.safetensors", size: 246144152, modified: 1780671024.0 },
    ],
  };
  if (mutate) mutate(folders);
  return folders;
}

test("comfyui-upgrade baseline: host-scoped capture with qualification state; dirty environment refused", async () => {
  const { options } = upgradeFixture();
  const { session, warnings } = await gateway.upgrade.beginUpgradeSession("presto-test", options);
  assert.equal(session.status, "BASELINE_CAPTURED");
  assert.equal(session.baseline.workflows.length, 2, "PRESTO session must not implicate flux");
  assert.ok(!session.baseline.workflows.some((w) => w.id === "flux-gguf-1080x1920"));
  for (const w of session.baseline.workflows) {
    assert.ok(/^[0-9a-f]{64}$/.test(w.sha256));
    assert.ok(["PRODUCTION", "QUALIFIED"].includes(w.lifecycle));
    assert.equal(w.evidence_state, "NONE");
    assert.equal(w.fingerprint.comfyui.version, "0.22.0");
    assert.ok(w.fingerprint.models.every((m) => m.identity.level === "filename_size_mtime"));
  }
  assert.equal(warnings.length, 0, "strong identity baseline carries no weak warnings");
  // persisted atomically
  const onDisk = gateway.upgrade.readSession(session.upgrade_session_id, options);
  assert.deepEqual(onDisk, session);
  assert.ok(!fs.readdirSync(gateway.upgrade.upgradeRoot(options)).some((n) => n.includes(".tmp-")));
  // unknown host refused with the known list
  await assert.rejects(gateway.upgrade.beginUpgradeSession("nonsense-host", options), /known hosts.*presto-test/s);
  // weak identity (no models API) is allowed but reported honestly
  const weak = upgradeFixture({ modelFolders: {} });
  const weakResult = await gateway.upgrade.beginUpgradeSession("presto-test", weak.options);
  assert.ok(weakResult.warnings.some((w) => w.includes("filename_only")));
  // demonstrably broken environment cannot be blessed as known-good
  const dirty = upgradeFixture();
  fs.writeFileSync(dirty.entries[0].runtime_copies[0], "{}");
  await assert.rejects(gateway.upgrade.beginUpgradeSession("presto-test", dirty.options), (e) => e.code === "comfyui_upgrade_baseline_dirty");
});

test("comfyui-upgrade observe: unchanged env verifies clean; changes classify per workflow with shared-dependency impact", async () => {
  // unchanged → VERIFIED_NO_CHANGE and no maintenance lock left behind
  const same = upgradeFixture();
  const { session } = await gateway.upgrade.beginUpgradeSession("presto-test", same.options);
  const clean = await gateway.upgrade.observeUpgradeSession(session.upgrade_session_id, same.options);
  assert.equal(clean.verdict, "NO_RELEVANT_CHANGES");
  assert.equal(clean.session.status, "VERIFIED_NO_CHANGE");
  assert.deepEqual(clean.affected, []);

  // ComfyUI core changed → every workflow on the host requires requalification
  const core = upgradeFixture();
  const s2 = (await gateway.upgrade.beginUpgradeSession("presto-test", core.options)).session;
  core.options.fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.23.0", gpu: "RTX 4090", modelFolders: wanModelFolders() });
  const coreObs = await gateway.upgrade.observeUpgradeSession(s2.upgrade_session_id, core.options);
  assert.equal(coreObs.verdict, "CHANGES_DETECTED");
  assert.equal(coreObs.session.status, "REQUALIFICATION_REQUIRED");
  assert.deepEqual(coreObs.affected.sort(), ["wan22-i2v-fast", "wan22-i2v-hq"]);
  assert.ok(coreObs.results.every((r) => r.severity === "REQUALIFICATION_REQUIRED"));

  // a LoRA only wan-fast requires changed → fast affected, hq NOT
  const lora = upgradeFixture();
  const s3 = (await gateway.upgrade.beginUpgradeSession("presto-test", lora.options)).session;
  lora.options.fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090",
    modelFolders: wanModelFolders((f) => { f.loras[0].size = 99; }) });
  const loraObs = await gateway.upgrade.observeUpgradeSession(s3.upgrade_session_id, lora.options);
  assert.deepEqual(loraObs.affected, ["wan22-i2v-fast"], "hq does not depend on the lightx2v lora");
  assert.equal(loraObs.results.find((r) => r.id === "wan22-i2v-hq").severity, "NO_IMPACT");

  // a model shared by BOTH (high-noise unet) missing → both PRODUCTION_BLOCKED
  const missing = upgradeFixture();
  const s4 = (await gateway.upgrade.beginUpgradeSession("presto-test", missing.options)).session;
  const brokenInfo = JSON.parse(JSON.stringify(WAN_OBJECT_INFO));
  brokenInfo.UNETLoader.input.required.unet_name = [["wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"]];
  missing.options.fetchImpl = fakeComfyFetch({ objectInfo: brokenInfo, version: "0.22.0", gpu: "RTX 4090",
    modelFolders: wanModelFolders((f) => { f.diffusion_models = f.diffusion_models.slice(1); }) });
  const missObs = await gateway.upgrade.observeUpgradeSession(s4.upgrade_session_id, missing.options);
  assert.ok(missObs.results.every((r) => r.severity === "PRODUCTION_BLOCKED"), "shared missing model blocks both wan lanes");

  // identity got WEAKER (models API gone) → EVIDENCE_WEAK, never a false CHANGED
  const weaker = upgradeFixture();
  const s5 = (await gateway.upgrade.beginUpgradeSession("presto-test", weaker.options)).session;
  weaker.options.fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090", modelFolders: {} });
  const weakObs = await gateway.upgrade.observeUpgradeSession(s5.upgrade_session_id, weaker.options);
  assert.deepEqual(weakObs.affected, [], "strength degradation alone is not drift");
  assert.ok(weakObs.results.every((r) => r.evidence_weak === true));
  assert.equal(weakObs.session.status, "VERIFIED_NO_CHANGE");
});

test("comfyui-upgrade rollback: observation proves a manual rollback restored the baseline", async () => {
  const fx = upgradeFixture();
  const { session } = await gateway.upgrade.beginUpgradeSession("presto-test", fx.options);
  // simulated update happened
  fx.options.fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.23.0", gpu: "RTX 4090", modelFolders: wanModelFolders() });
  const changed = await gateway.upgrade.observeUpgradeSession(session.upgrade_session_id, fx.options);
  assert.equal(changed.session.status, "REQUALIFICATION_REQUIRED");
  // rollback incomplete → mismatch, session NOT rolled back
  const still = await gateway.upgrade.observeUpgradeSession(session.upgrade_session_id, { ...fx.options, rollbackCheck: true });
  assert.equal(still.verdict, "BASELINE_MISMATCH");
  assert.notEqual(still.session.status, "ROLLED_BACK");
  // human rolls back (env returns to baseline) → BASELINE_MATCH → ROLLED_BACK
  fx.options.fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090", modelFolders: wanModelFolders() });
  const back = await gateway.upgrade.observeUpgradeSession(session.upgrade_session_id, { ...fx.options, rollbackCheck: true });
  assert.equal(back.verdict, "BASELINE_MATCH");
  assert.equal(back.session.status, "ROLLED_BACK");
  // rollback manifest carries the known-good identities, and execution stays manual
  const manifest = gateway.upgrade.rollbackManifest(session.upgrade_session_id, fx.options);
  assert.equal(manifest.known_good.length, 2);
  assert.ok(manifest.known_good[0].models.every((m) => m.identity.bytes));
  assert.ok(manifest.procedure[0].includes("MANUAL"));
  // audit trail recorded every transition
  const events = gateway.upgrade.readSession(session.upgrade_session_id, fx.options).events;
  assert.ok(events.length >= 3);
  assert.ok(events.every((e) => e.at && e.to && e.reason));
});

test("comfyui-upgrade permits: exact-scope staleness bypass that never weakens drift or dependency gates", () => {
  const fx = upgradeFixture();
  const hq = fx.entries.find((e) => e.id === "wan22-i2v-hq");
  const fast = fx.entries.find((e) => e.id === "wan22-i2v-fast");
  // stale qualification: last passed pins an older graph sha
  gateway.qualification.writeQualificationRecord(
    passedRecord(hq, wanFingerprint(hq), { workflow: { id: hq.id, version: hq.version, sha256: "d".repeat(64) } }),
    { qualificationRoot: fx.options.qualificationRoot });
  const gate = () => gateway.preflight.preflightSync(hq.id, { ...fx.options, driftOverride: false });
  assert.throws(gate, /QUALIFICATION_STALE/, "stale qualification blocks dispatch (the deadlock)");
  // permit for the WRONG workflow does not help
  gateway.permits.issuePermit({ entry: fast, upgradeSessionId: "upgrade-test-1" }, fx.options);
  assert.throws(gate, /QUALIFICATION_STALE/, "a wan-fast permit cannot authorize wan-hq");
  // exact permit lets the qualifying dispatch through, loudly, with counted uses
  gateway.permits.issuePermit({ entry: hq, upgradeSessionId: "upgrade-test-1" }, fx.options);
  const first = gate();
  assert.ok(first.warnings.some((w) => w.includes("REQUALIFICATION PERMIT ACTIVE")));
  assert.equal(gateway.permits.readPermit(hq.id, fx.options).uses_remaining, 1);
  const second = gate();
  assert.ok(second.warnings.some((w) => w.includes("uses remaining: 0")));
  assert.equal(gateway.permits.readPermit(hq.id, fx.options).status, "EXHAUSTED");
  assert.throws(gate, /QUALIFICATION_STALE/, "exhausted permit no longer bypasses");
  // a permit never bypasses workflow drift: corrupt the runtime copy
  gateway.permits.issuePermit({ entry: hq, upgradeSessionId: "upgrade-test-1" }, fx.options);
  fs.writeFileSync(hq.runtime_copies[0], "{}");
  assert.throws(gate, (e) => e.code === "comfyui_workflow_drift", "drift gate stays enforced with an active permit");
  // permit pinned to a sha stops matching if the registry graph changes again
  const rescoped = { ...hq, canonical_sha256: hq.canonical_sha256 };
  const otherSha = { ...hq, canonical_sha256: "e".repeat(64) };
  assert.equal(gateway.permits.findActivePermit(otherSha, fx.options), null);
  assert.ok(gateway.permits.findActivePermit(rescoped, fx.options));
});

test("comfyui-upgrade requalification: stale + permit + real-shaped production render = fresh LIVE_PASSED, permit consumed, session PASSED", async () => {
  const fx = upgradeFixture();
  const hq = fx.entries.find((e) => e.id === "wan22-i2v-hq");
  const qroot = fx.options.qualificationRoot;
  // stale evidence from before the (simulated) workflow revision
  gateway.qualification.writeQualificationRecord(
    passedRecord(hq, wanFingerprint(hq), { workflow: { id: hq.id, version: hq.version, sha256: "d".repeat(64) } }),
    { qualificationRoot: qroot });
  // an upgrade session that observed the change
  const { session } = await gateway.upgrade.beginUpgradeSession("presto-test", fx.options);
  session.affected_workflows = ["wan22-i2v-hq"];
  session.status = "REQUALIFICATION_REQUIRED";
  gateway.upgrade.readSession(session.upgrade_session_id, fx.options); // ensure persisted form exists
  require("../comfyui-gateway/provenance.js").writeJsonAtomic(
    gateway.upgrade.sessionPath(session.upgrade_session_id, fx.options), session);
  // permit issued for the exact current workflow revision
  gateway.permits.issuePermit({ entry: hq, upgradeSessionId: session.upgrade_session_id }, fx.options);
  const gateResult = gateway.preflight.preflightSync(hq.id, { ...fx.options, driftOverride: false });
  assert.ok(gateResult.warnings.some((w) => w.includes("PERMIT")));
  // the authorized real-shaped production render completes and captures
  const runsRoot = tmpDir("comfyui-upg-runs-");
  const runDir = writeWanRunDir(runsRoot, "run-post-upgrade-1");
  gateway.provenance.buildWanRunProvenance(runDir, { entry: hq });
  const currentFp = await gateway.fingerprint.collectFingerprint(hq, fx.options);
  const captured = gateway.qualification.captureProductionQualification(
    { entry: hq, runDir, fingerprint: currentFp }, fx.options);
  assert.equal(captured.captured, true, JSON.stringify(captured.reasons));
  assert.ok(captured.permit_consumed, "successful qualification consumes the permit");
  assert.equal(gateway.permits.readPermit(hq.id, fx.options).status, "CONSUMED");
  // evidence is fresh, gate passes naturally, upgrade guard is CURRENT
  const ev = gateway.qualification.evaluateQualification(hq, { ...fx.options, currentFingerprint: currentFp });
  assert.equal(ev.evidence_state, "LIVE_PASSED");
  assert.equal(ev.evidence_source, "production_render");
  const clean = gateway.preflight.preflightSync(hq.id, { ...fx.options, driftOverride: false });
  assert.deepEqual(clean.warnings, []);
  const report = gateway.qualification.buildUpgradeReport([hq], { [hq.id]: currentFp }, fx.options);
  assert.equal(report.workflows[0].status, "NO_RELEVANT_DRIFT");
  // and the session can now complete as PASSED
  const done = await gateway.upgrade.completeUpgradeSession(session.upgrade_session_id, fx.options);
  assert.equal(done.status, "PASSED");
});

test("comfyui-upgrade safety: no session = P3 behavior; sessions cannot lock production; module contains no updater", () => {
  const fx = upgradeFixture();
  const hq = fx.entries.find((e) => e.id === "wan22-i2v-hq");
  // no session, no permit, no records → exactly the P3 bootstrap warning, nothing else
  const gate = gateway.preflight.preflightSync(hq.id, { ...fx.options, driftOverride: false });
  assert.equal(gate.warnings.length, 1);
  assert.ok(gate.warnings[0].includes("QUALIFICATION_PENDING"));
  // an abandoned open session imposes nothing on dispatch (gating never reads sessions)
  const qualificationSrc = fs.readFileSync(path.join(REPO, "comfyui-gateway", "qualification.js"), "utf8");
  assert.ok(!qualificationSrc.includes("upgrade.js"), "dispatch gating must not depend on upgrade sessions");
  // the maintenance system performs zero environment mutation
  const upgradeSrc = fs.readFileSync(path.join(REPO, "comfyui-gateway", "upgrade.js"), "utf8");
  const permitsSrc = fs.readFileSync(path.join(REPO, "comfyui-gateway", "permits.js"), "utf8");
  for (const banned of ["child_process", "spawn", "execFile", "git pull", "pip install", "download"]) {
    assert.ok(!upgradeSrc.includes(banned), `upgrade.js must not contain "${banned}"`);
    assert.ok(!permitsSrc.includes(banned), `permits.js must not contain "${banned}"`);
  }
  // cancel semantics: cancelled sessions are terminal and cannot be observed
  return (async () => {
    const { session } = await gateway.upgrade.beginUpgradeSession("presto-test", fx.options);
    gateway.upgrade.cancelUpgradeSession(session.upgrade_session_id, "test", fx.options);
    await assert.rejects(gateway.upgrade.observeUpgradeSession(session.upgrade_session_id, fx.options), /CANCELLED/);
    assert.throws(() => gateway.upgrade.cancelUpgradeSession(session.upgrade_session_id, "again", fx.options), /already/);
  })();
});

// ---- P5: cryptographic environment manifests -----------------------------------------------

// Local-transport inventory fixture: temp environments config + temp model
// roots holding small real files for the wan-hq registry dependencies.
function environmentFixture({ withFiles = true } = {}) {
  const work = tmpDir("comfyui-env-");
  const modelRoot = path.join(work, "models");
  const comfyRoot = path.join(work, "comfy");
  fs.mkdirSync(comfyRoot, { recursive: true });
  const { registryPath, entries } = (() => {
    // wan hq + fast re-rooted onto host "env-test" (local transport)
    const list = [];
    for (const wf of ["wan22-i2v-hq", "wan22-i2v-fast"]) {
      const real = gateway.registry.getWorkflow(wf);
      const runtimeCopy = path.join(work, `${wf}-rt.json`);
      fs.copyFileSync(gateway.registry.canonicalAbsolutePath(real), runtimeCopy);
      list.push({ ...JSON.parse(JSON.stringify(real)), runtime_copies: [runtimeCopy], comfyui: { endpoint_default: "http://env-test:8188", endpoint_env: [] } });
    }
    const rp = path.join(work, "registry.json");
    fs.writeFileSync(rp, JSON.stringify({ registry_version: 1, workflows: list }));
    return { registryPath: rp, entries: list };
  })();
  const allModels = [...new Set(entries.flatMap((e) => e.required_models.map((m) => m.name)))];
  if (withFiles) {
    for (const name of allModels) {
      const folder = name.includes("lora") ? "loras" : name.includes("umt5") ? "text_encoders" : name.includes("vae") ? "vae" : "diffusion_models";
      fs.mkdirSync(path.join(modelRoot, folder), { recursive: true });
      fs.writeFileSync(path.join(modelRoot, folder, name), `contents-of-${name}`);
    }
  }
  const environmentsPath = path.join(work, "environments.json");
  fs.writeFileSync(environmentsPath, JSON.stringify({
    schema_version: 1,
    hosts: { "env-test": { transport: "local", comfyui_root: comfyRoot, model_roots: [modelRoot] } },
  }));
  const options = {
    registryPath, environmentsPath,
    environmentRoot: path.join(work, "env-state"),
    qualificationRoot: path.join(work, "qual"),
    local: false,
  };
  return { work, modelRoot, comfyRoot, entries, options, allModels };
}

test("comfyui-environment manifest: deterministic self-hash, atomic publish, validation rejects malformed evidence", async () => {
  const fx = environmentFixture();
  const { manifest, path: outPath } = await gateway.environment.runStrongInventory("env-test", fx.options);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.host, "env-test");
  assert.equal(manifest.models.length, 6);
  assert.ok(manifest.models.every((m) => /^[0-9a-f]{64}$/.test(m.sha256)));
  assert.ok(fs.existsSync(outPath));
  assert.ok(!fs.readdirSync(path.dirname(outPath)).some((n) => n.includes(".tmp-")), "atomic write");
  // deterministic self-hash: key order + generated_at excluded
  const reordered = JSON.parse(gateway.environment.canonicalJson(manifest));
  reordered.generated_at = "2030-01-01T00:00:00.000Z";
  assert.equal(gateway.environment.manifestSha256(manifest), gateway.environment.manifestSha256(reordered));
  // malformed sha rejected by validation
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.models[0].sha256 = "nope";
  bad.manifest_sha256 = gateway.environment.manifestSha256(bad);
  assert.equal(gateway.environment.validateManifest(bad, { host: "env-test" }).ok, false);
  // tampering breaks the self-hash → manifest not trusted
  const tampered = JSON.parse(fs.readFileSync(outPath, "utf8"));
  tampered.models[0].sha256 = "a".repeat(64);
  fs.writeFileSync(outPath, JSON.stringify(tampered));
  const rm = gateway.environment.readManifest("env-test", fx.options);
  assert.equal(rm.status, "invalid");
  assert.ok(rm.problems.some((p) => p.includes("self-hash")));
});

test("comfyui-environment strong identity: SHA authority is conditional on matching cheap metadata", async () => {
  const fx = environmentFixture();
  await gateway.environment.runStrongInventory("env-test", fx.options);
  const name = "wan_2.1_vae.safetensors";
  const file = path.join(fx.modelRoot, "vae", name);
  const st = fs.statSync(file);
  // matching metadata → sha256 identity from the manifest
  const strong = gateway.environment.strongModelIdentity("env-test", name, { bytes: st.size, mtime: st.mtime.toISOString() }, fx.options);
  assert.equal(strong.level, "sha256");
  assert.equal(strong.source, "environment_manifest");
  assert.equal(strong.manifest_status, "current");
  // size mismatch → STALE, the recorded sha is NOT presented as current
  const staleSize = gateway.environment.strongModelIdentity("env-test", name, { bytes: st.size + 1, mtime: st.mtime.toISOString() }, fx.options);
  assert.deepEqual(staleSize, { stale: true });
  // mtime mismatch (outside tolerance) → STALE
  const staleTime = gateway.environment.strongModelIdentity("env-test", name, { bytes: st.size, mtime: "2030-01-01T00:00:00.000Z" }, fx.options);
  assert.deepEqual(staleTime, { stale: true });
  // no current metadata → UNVERIFIABLE, never inflated
  assert.deepEqual(gateway.environment.strongModelIdentity("env-test", name, null, fx.options), { unverifiable: true });
  // absent manifest → null; corrupt manifest → visible, no strong authority
  const empty = environmentFixture();
  assert.equal(gateway.environment.strongModelIdentity("env-test", name, { bytes: 1, mtime: st.mtime.toISOString() }, empty.options), null);
  fs.mkdirSync(gateway.environment.manifestDir("env-test", empty.options), { recursive: true });
  fs.writeFileSync(gateway.environment.manifestPath("env-test", empty.options), "{truncated");
  const corrupt = gateway.environment.strongModelIdentity("env-test", name, { bytes: 1, mtime: st.mtime.toISOString() }, empty.options);
  assert.equal(corrupt.manifest_invalid, true);
  assert.equal(corrupt.status, "corrupt");
});

test("comfyui-environment replacement: same-name/same-size/same-mtime content swap is caught by explicit re-inventory", async () => {
  const fx = environmentFixture();
  const first = await gateway.environment.runStrongInventory("env-test", fx.options);
  const name = "wan_2.1_vae.safetensors";
  const file = path.join(fx.modelRoot, "vae", name);
  const st = fs.statSync(file);
  const before = first.manifest.models.find((m) => m.filename === name).sha256;
  // malicious replacement: same length, same name, same mtime — different bytes
  const original = fs.readFileSync(file);
  const swapped = Buffer.from(original); swapped[0] = swapped[0] ^ 0xff;
  fs.writeFileSync(file, swapped);
  fs.utimesSync(file, st.atime, st.mtime);
  const st2 = fs.statSync(file);
  assert.equal(st2.size, st.size);
  assert.equal(st2.mtime.toISOString(), st.mtime.toISOString());
  // routine metadata-only check CANNOT see it (the documented limitation)…
  const routine = gateway.environment.strongModelIdentity("env-test", name, { bytes: st2.size, mtime: st2.mtime.toISOString() }, fx.options);
  assert.equal(routine.level, "sha256", "metadata-only check is blind to the swap by design");
  // …but the explicit re-inventory catches it
  const second = await gateway.environment.runStrongInventory("env-test", fx.options);
  const after = second.manifest.models.find((m) => m.filename === name).sha256;
  assert.notEqual(after, before, "content change must change the SHA");
  // and Upgrade Guard comparing sha-vs-sha reports the model as CHANGED
  const mkFp = (sha) => wanFingerprint(fx.entries[0], {
    models: [{ class_type: "VAELoader", input_key: "vae_name", name, present: true, identity: { level: "sha256", source: "environment_manifest", filename: name, bytes: st.size, mtime: st.mtime.toISOString(), sha256: sha } }],
  });
  const cmp = gateway.qualification.compareFingerprints(mkFp(before), mkFp(after));
  assert.equal(cmp.status, "stale");
  assert.equal(cmp.components.find((c) => c.component === "model").level, "sha256");
  // previous manifest retained as backup
  assert.ok(fs.existsSync(gateway.environment.previousManifestPath("env-test", fx.options)));
  assert.equal(JSON.parse(fs.readFileSync(gateway.environment.previousManifestPath("env-test", fx.options), "utf8")).models.find((m) => m.filename === name).sha256, before);
});

test("comfyui-environment inventory: shared models hashed once, interruption never publishes, path safety enforced", async () => {
  const fx = environmentFixture();
  // dedupe: hq and fast share 4 model files — count actual hash invocations
  let hashCalls = 0;
  await gateway.environment.runStrongInventory("env-test", {
    ...fx.options,
    hashImpl: async (p) => { hashCalls += 1; return crypto().createHash("sha256").update(fs.readFileSync(p)).digest("hex"); },
  });
  function crypto() { return require("node:crypto"); }
  assert.equal(hashCalls, 6, "6 unique files hashed exactly once despite shared references");
  const good = gateway.environment.readManifest("env-test", fx.options);
  assert.equal(good.status, "ok");
  // interruption mid-hash: no new manifest published, previous preserved
  const goodSha = good.manifest.manifest_sha256;
  let n = 0;
  await assert.rejects(gateway.environment.runStrongInventory("env-test", {
    ...fx.options,
    hashImpl: async () => { n += 1; if (n >= 3) throw new Error("disk error simulated"); return "b".repeat(64); },
  }), /disk error/);
  const after = gateway.environment.readManifest("env-test", fx.options);
  assert.equal(after.status, "ok");
  assert.equal(after.manifest.manifest_sha256, goodSha, "failed run must not replace the valid manifest");
  // a required-but-missing model refuses to publish a partial manifest
  const partial = environmentFixture();
  fs.rmSync(path.join(partial.modelRoot, "vae", "wan_2.1_vae.safetensors"));
  await assert.rejects(gateway.environment.runStrongInventory("env-test", partial.options), (e) => e.code === "comfyui_environment_inventory_incomplete");
  assert.equal(gateway.environment.readManifest("env-test", partial.options).status, "absent");
  // path safety: traversal/separator filenames can never reach an executor
  assert.equal(gateway.environment.SAFE_FILENAME_RE.test("../../../etc/passwd"), false);
  assert.equal(gateway.environment.SAFE_FILENAME_RE.test("a\\b.safetensors"), false);
  assert.equal(gateway.environment.SAFE_FILENAME_RE.test("a/b.safetensors"), false);
  assert.equal(gateway.environment.SAFE_FILENAME_RE.test(".hidden"), false);
  assert.throws(() => gateway.environment.buildPowershellInventoryScript({
    config: { model_roots: ["C:/x"], comfyui_root: "C:/y" },
    models: [{ filename: "../escape", folders: ["vae"] }],
  }), /unsafe filename/);
  // remote transport refuses without explicit authorization (tests can never ssh)
  const remoteFx = environmentFixture();
  fs.writeFileSync(remoteFx.options.environmentsPath, JSON.stringify({
    schema_version: 1, hosts: { "env-test": { transport: "ssh-powershell", ssh_host: "nowhere", comfyui_root: "C:/x", model_roots: ["C:/x/models"] } },
  }));
  await assert.rejects(gateway.environment.runStrongInventory("env-test", remoteFx.options), (e) => e.code === "comfyui_environment_inventory_not_authorized");
});

test("comfyui-environment core identity: git commit + dirty state captured; non-git honest fallback", async () => {
  const fx = environmentFixture();
  // non-git comfyui root → identity unknown, no invented commit
  const plain = await gateway.environment.runStrongInventory("env-test", fx.options);
  assert.equal(plain.manifest.comfyui.identity_level, "unknown");
  assert.equal(plain.manifest.comfyui.git_commit, null);
  // git-managed root → commit recorded; dirty tree highly visible
  const { execFileSync } = require("node:child_process");
  const git = (args) => execFileSync("git", args, { cwd: fx.comfyRoot, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git(["init", "-q"]);
  fs.writeFileSync(path.join(fx.comfyRoot, "main.py"), "print()");
  git(["add", "."]); git(["commit", "-qm", "init"]);
  const clean = await gateway.environment.runStrongInventory("env-test", fx.options);
  assert.equal(clean.manifest.comfyui.identity_level, "git_commit");
  assert.ok(/^[0-9a-f]{40}$/.test(clean.manifest.comfyui.git_commit));
  assert.equal(clean.manifest.comfyui.git_dirty, false);
  fs.writeFileSync(path.join(fx.comfyRoot, "main.py"), "print('local hack')");
  const dirty = await gateway.environment.runStrongInventory("env-test", fx.options);
  assert.equal(dirty.manifest.comfyui.git_dirty, true);
  assert.ok(dirty.manifest.comfyui.git_dirty_count >= 1);
});

test("comfyui-environment fingerprint/qualification integration: strong identity flows in; normal paths never hash", async () => {
  const fx = environmentFixture();
  await gateway.environment.runStrongInventory("env-test", fx.options);
  const hq = fx.entries.find((e) => e.id === "wan22-i2v-hq");
  // fake models API serving the REAL current metadata of the fixture files
  const modelFolders = {};
  for (const name of fx.allModels) {
    const folder = name.includes("lora") ? "loras" : name.includes("umt5") ? "text_encoders" : name.includes("vae") ? "vae" : "diffusion_models";
    const st = fs.statSync(path.join(fx.modelRoot, folder, name));
    (modelFolders[folder] = modelFolders[folder] || []).push({ name, size: st.size, modified: st.mtimeMs / 1000 });
  }
  const fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090", modelFolders });
  // fingerprint host is "env-test" (from the entry endpoint) → manifest applies
  const fp = await gateway.fingerprint.collectFingerprint(hq, { ...fx.options, fetchImpl });
  for (const m of fp.models) {
    assert.equal(m.identity.level, "sha256", `${m.name} should carry manifest sha`);
    assert.equal(m.identity.source, "environment_manifest");
    assert.equal(m.identity.manifest_status, "current");
  }
  // qualification capture inherits the strong identity
  const runsRoot = tmpDir("comfyui-env-runs-");
  const runDir = writeWanRunDir(runsRoot, "run-env-1");
  gateway.provenance.buildWanRunProvenance(runDir, { entry: hq });
  const captured = gateway.qualification.captureProductionQualification({ entry: hq, runDir, fingerprint: fp }, fx.options);
  assert.equal(captured.captured, true, JSON.stringify(captured.reasons));
  assert.ok(captured.record.environment_fingerprint.models.every((m) => m.identity.level === "sha256"));
  // stale manifest metadata → fingerprint falls back to fsm and flags it
  const vae = path.join(fx.modelRoot, "vae", "wan_2.1_vae.safetensors");
  fs.appendFileSync(vae, "-grown");
  const st2 = fs.statSync(vae);
  modelFolders.vae[0].size = st2.size; modelFolders.vae[0].modified = st2.mtimeMs / 1000;
  const fp2 = await gateway.fingerprint.collectFingerprint(hq, { ...fx.options, fetchImpl: fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090", modelFolders }) });
  const vaeId = fp2.models.find((m) => m.name === "wan_2.1_vae.safetensors").identity;
  assert.equal(vaeId.level, "filename_size_mtime", "stale SHA must never masquerade as current identity");
  assert.equal(vaeId.manifest_sha_status, "stale");
  // weak(P4)→strong(P5) comparison stays IDENTITY_STRENGTH_CHANGED, not MODEL_CHANGED
  const weakBase = wanFingerprint(hq);
  const strongNow = wanFingerprint(hq, { models: [{ ...weakBase.models[0], identity: { level: "sha256", source: "environment_manifest", filename: weakBase.models[0].name, bytes: 15000, mtime: "2026-06-05T10:00:00.000Z", sha256: "c".repeat(64), manifest_status: "current" } }] });
  const cmp = gateway.qualification.compareFingerprints(weakBase, strongNow);
  assert.equal(cmp.status, "current");
  assert.equal(cmp.components.find((c) => c.component === "model").classification, "identity_strength_changed");
  // normal fingerprint/preflight path performs ZERO hashing (spy would throw)
  const spyOptions = { ...fx.options, fetchImpl, hashImpl: () => { throw new Error("HASH CALLED ON NORMAL PATH"); } };
  await gateway.fingerprint.collectFingerprint(hq, spyOptions);
  gateway.preflight.preflightSync(hq.id, { ...spyOptions, driftOverride: false });
});

// ---- P6: ComfyUI core source integrity ------------------------------------------------------

const { execFileSync: p6git } = require("node:child_process");
function gitIn(dir, args) {
  return p6git("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}
function sourceFixture() {
  const fx = environmentFixture();
  gitIn(fx.comfyRoot, ["init", "-q"]);
  fs.writeFileSync(path.join(fx.comfyRoot, "main.py"), "print('comfy')\n");
  fs.mkdirSync(path.join(fx.comfyRoot, "comfy"), { recursive: true });
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'auto'\n");
  fs.writeFileSync(path.join(fx.comfyRoot, "blob.bin"), Buffer.from([0, 1, 2, 3, 250]));
  gitIn(fx.comfyRoot, ["add", "."]);
  gitIn(fx.comfyRoot, ["commit", "-qm", "base"]);
  return fx;
}
async function sourceOf(fx) {
  const { manifest } = await gateway.environment.runStrongInventory("env-test", fx.options);
  return manifest.comfyui;
}

test("comfyui-source clean identity: deterministic effective source for a clean checkout", async () => {
  const fx = sourceFixture();
  const a = await sourceOf(fx);
  const b = await sourceOf(fx);
  assert.equal(a.source_state, "CLEAN");
  assert.equal(a.identity_level, "git_commit");
  assert.equal(a.working_tree.tracked_patch_sha256, null);
  assert.ok(/^[0-9a-f]{64}$/.test(a.effective_source_sha256));
  assert.equal(a.effective_source_sha256, b.effective_source_sha256, "repeated refresh yields the same identity");
  assert.equal(a.git_branch, gitIn(fx.comfyRoot, ["branch", "--show-current"]).trim());
});

test("comfyui-source tracked patch: deterministic patch identity; one byte changes it; same commit + different patch differ", async () => {
  const fx = sourceFixture();
  const clean = await sourceOf(fx);
  // patch A (unstaged tracked modification)
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'patched-A'\n");
  const a1 = await sourceOf(fx);
  const a2 = await sourceOf(fx);
  assert.equal(a1.source_state, "KNOWN_PATCHED");
  assert.equal(a1.identity_level, "git_commit_plus_patch");
  assert.ok(a1.working_tree.tracked_patch_sha256);
  assert.equal(a1.working_tree.tracked_patch_sha256, a2.working_tree.tracked_patch_sha256, "same patch → same patch sha");
  assert.equal(a1.effective_source_sha256, a2.effective_source_sha256);
  assert.notEqual(a1.effective_source_sha256, clean.effective_source_sha256, "clean → dirty is a source change");
  const entry = a1.working_tree.entries.find((e) => e.path === "comfy/model_management.py");
  assert.equal(entry.tracked, true);
  assert.equal(entry.execution_relevant, true);
  assert.ok(entry.sha256);
  // patch B: one byte different → different identity (dirty_count identical!)
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'patched-B'\n");
  const b = await sourceOf(fx);
  assert.notEqual(b.working_tree.tracked_patch_sha256, a1.working_tree.tracked_patch_sha256);
  assert.notEqual(b.effective_source_sha256, a1.effective_source_sha256, "same commit + patch A ≠ same commit + patch B");
  // staged-only change is still captured (diff HEAD covers the index)
  gitIn(fx.comfyRoot, ["add", "comfy/model_management.py"]);
  const staged = await sourceOf(fx);
  assert.ok(staged.working_tree.tracked_patch_sha256, "staged tracked change remains part of the patch identity");
  assert.equal(staged.effective_source_sha256, b.effective_source_sha256, "staging without content change keeps the same executed source");
  // binary tracked change is represented (git diff --binary)
  fs.writeFileSync(path.join(fx.comfyRoot, "blob.bin"), Buffer.from([9, 9, 9, 9, 9]));
  const bin = await sourceOf(fx);
  assert.notEqual(bin.working_tree.tracked_patch_sha256, staged.working_tree.tracked_patch_sha256, "binary modification changes the patch identity");
});

test("comfyui-source untracked: execution-relevant files enter identity; logs/cache/noise never do", async () => {
  const fx = sourceFixture();
  const clean = await sourceOf(fx);
  // noise: logs, bytecode, outputs, diagnostics → identity unchanged
  fs.mkdirSync(path.join(fx.comfyRoot, "logs"), { recursive: true });
  fs.writeFileSync(path.join(fx.comfyRoot, "logs", "server.out.log.prev"), "log line");
  fs.mkdirSync(path.join(fx.comfyRoot, "__pycache__"), { recursive: true });
  fs.writeFileSync(path.join(fx.comfyRoot, "__pycache__", "main.cpython-310.pyc"), "bytecode");
  fs.mkdirSync(path.join(fx.comfyRoot, "_diagnostics"), { recursive: true });
  fs.writeFileSync(path.join(fx.comfyRoot, "_diagnostics", "note.md"), "diag");
  fs.writeFileSync(path.join(fx.comfyRoot, "config.yaml.backup-old"), "backup");
  const noisy = await sourceOf(fx);
  assert.equal(noisy.effective_source_sha256, clean.effective_source_sha256, "noise must not churn source identity");
  assert.equal(noisy.source_state, "DIRTY_NON_EXECUTION");
  const cats = Object.fromEntries(noisy.working_tree.entries.map((e) => [e.path, e.category]));
  assert.equal(cats["logs/server.out.log.prev"], "generated_runtime");
  assert.equal(cats["_diagnostics/note.md"], "generated_diagnostic");
  assert.equal(cats["config.yaml.backup-old"], "local_config_backup");
  // execution-relevant untracked source enters the identity
  fs.writeFileSync(path.join(fx.comfyRoot, "new_node.py"), "def custom(): pass\n");
  const withNode = await sourceOf(fx);
  assert.equal(withNode.source_state, "KNOWN_PATCHED");
  assert.notEqual(withNode.effective_source_sha256, clean.effective_source_sha256);
  const nodeEntry = withNode.working_tree.entries.find((e) => e.path === "new_node.py");
  assert.equal(nodeEntry.execution_relevant, true);
  assert.ok(nodeEntry.sha256);
  // same filename + same size, different content → different identity via SHA
  fs.writeFileSync(path.join(fx.comfyRoot, "new_node.py"), "def custom(): loss\n");
  const swapped = await sourceOf(fx);
  assert.notEqual(swapped.effective_source_sha256, withNode.effective_source_sha256);
  // known execution-relevant IGNORED config (extra_model_paths.yaml) is captured
  fs.writeFileSync(path.join(fx.comfyRoot, ".gitignore"), "extra_model_paths.yaml\n");
  gitIn(fx.comfyRoot, ["add", ".gitignore"]); gitIn(fx.comfyRoot, ["commit", "-qm", "ignore"]);
  fs.writeFileSync(path.join(fx.comfyRoot, "extra_model_paths.yaml"), "legacy:\n  base_path: /x\n");
  const withYaml = await sourceOf(fx);
  const yamlEntry = withYaml.working_tree.entries.find((e) => e.path === "extra_model_paths.yaml");
  assert.equal(yamlEntry.status, "ignored-active");
  assert.equal(yamlEntry.execution_relevant, true);
  assert.ok(yamlEntry.sha256, "git-ignored but execution-relevant config is fingerprinted");
});

test("comfyui-source comparison: patch change = real drift; weak historical identity = strength change; models independent", async () => {
  const { entry } = syntheticRegistry("wan22-i2v-hq");
  const src = (sha) => wanFingerprint(entry, { comfyui: { version: "0.22.0", git_commit: "cd45f42a", identity_level: "git_commit", effective_source_sha256: sha, source_state: "KNOWN_PATCHED" } });
  // same commit + same effective source → SAME at effective_source level
  const same = gateway.qualification.compareFingerprints(src("a".repeat(64)), src("a".repeat(64)));
  assert.equal(same.status, "current");
  assert.equal(same.components.find((c) => c.name === "effective_source").classification, "verified_same");
  // same commit + different patch → REAL source drift → requalification
  const drift = gateway.qualification.compareFingerprints(src("a".repeat(64)), src("b".repeat(64)));
  assert.equal(drift.status, "stale");
  assert.ok(drift.reasons.some((r) => r.includes("effective_source")));
  // models stay independent: only source changed, model components remain SAME
  assert.equal(drift.components.find((c) => c.component === "model").classification, "verified_same");
  // historical weak identity (commit + dirty boolean only) vs new strong → strength change, not drift
  const weakOld = wanFingerprint(entry, { comfyui: { version: "0.22.0", git_commit: "cd45f42a", identity_level: "git_commit" } });
  const strengthened = gateway.qualification.compareFingerprints(weakOld, src("a".repeat(64)));
  assert.equal(strengthened.status, "current", "a stronger observer is not proof of drift");
  assert.equal(strengthened.components.find((c) => c.name === "effective_source").classification, "identity_strength_changed");
  // base commit change remains its own authoritative drift
  const commitChanged = gateway.qualification.compareFingerprints(src("a".repeat(64)),
    wanFingerprint(entry, { comfyui: { version: "0.22.0", git_commit: "deadbeef", identity_level: "git_commit", effective_source_sha256: "c".repeat(64), source_state: "CLEAN" } }));
  assert.equal(commitChanged.status, "stale");
});

test("comfyui-source qualification + upgrade-session integration: patched source identity flows into evidence and baselines", async () => {
  const fx = sourceFixture();
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'production-patch'\n");
  await gateway.environment.runStrongInventory("env-test", fx.options);
  const hq = fx.entries.find((e) => e.id === "wan22-i2v-hq");
  const modelFolders = {};
  for (const name of fx.allModels) {
    const folder = name.includes("lora") ? "loras" : name.includes("umt5") ? "text_encoders" : name.includes("vae") ? "vae" : "diffusion_models";
    const st = fs.statSync(path.join(fx.modelRoot, folder, name));
    (modelFolders[folder] = modelFolders[folder] || []).push({ name, size: st.size, modified: st.mtimeMs / 1000 });
  }
  const fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090", modelFolders });
  const fp = await gateway.fingerprint.collectFingerprint(hq, { ...fx.options, fetchImpl });
  assert.ok(/^[0-9a-f]{64}$/.test(fp.comfyui.effective_source_sha256), "fingerprint carries effective source identity");
  assert.equal(fp.comfyui.source_state, "KNOWN_PATCHED");
  assert.ok(fp.comfyui.source_observed_at, "as-of-inventory freshness is explicit");
  // qualification evidence preserves the exact patched source state
  const runsRoot = tmpDir("comfyui-src-runs-");
  const runDir = writeWanRunDir(runsRoot, "run-src-1");
  gateway.provenance.buildWanRunProvenance(runDir, { entry: hq });
  const captured = gateway.qualification.captureProductionQualification({ entry: hq, runDir, fingerprint: fp }, fx.options);
  assert.equal(captured.captured, true, JSON.stringify(captured.reasons));
  assert.equal(captured.record.environment_fingerprint.comfyui.effective_source_sha256, fp.comfyui.effective_source_sha256);
  // upgrade session baseline captures it; a patch change marks host workflows affected
  const upgOptions = { ...fx.options, upgradeRoot: path.join(fx.work, "upg"), fetchImpl };
  const { session } = await gateway.upgrade.beginUpgradeSession("env-test", upgOptions);
  assert.ok(session.baseline.workflows.every((w) => w.fingerprint.comfyui.effective_source_sha256 === fp.comfyui.effective_source_sha256));
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'different-patch'\n");
  await gateway.environment.runStrongInventory("env-test", fx.options);
  const obs = await gateway.upgrade.observeUpgradeSession(session.upgrade_session_id, upgOptions);
  assert.equal(obs.verdict, "CHANGES_DETECTED");
  assert.deepEqual(obs.affected.sort(), ["wan22-i2v-fast", "wan22-i2v-hq"], "core source change affects every workflow on the host");
  assert.ok(obs.results.every((r) => r.reasons.some((x) => x.includes("effective_source"))));
  // rollback evidence includes the patched source identity
  const manifest = gateway.upgrade.rollbackManifest(session.upgrade_session_id, upgOptions);
  assert.equal(manifest.known_good[0].comfyui.effective_source_sha256, fp.comfyui.effective_source_sha256);
  // restoring patch A proves BASELINE_MATCH
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'production-patch'\n");
  await gateway.environment.runStrongInventory("env-test", fx.options);
  const back = await gateway.upgrade.observeUpgradeSession(session.upgrade_session_id, { ...upgOptions, rollbackCheck: true });
  assert.equal(back.verdict, "BASELINE_MATCH");
});

test("comfyui-source safety: no mutation verbs against hosts; source scan confined to configured root; routine paths unaffected", async () => {
  const src = fs.readFileSync(path.join(REPO, "comfyui-gateway", "environment.js"), "utf8");
  // observation only: no git mutation subcommand may appear as an executed command
  for (const verb of ["'reset'", "'checkout'", "'restore'", "'clean'", "'stash'", "'apply'", "'pull'", "'fetch'"]) {
    assert.ok(!src.includes(verb), `environment.js must never execute git ${verb}`);
  }
  // fingerprint source augmentation is manifest-read only — no git/ssh on routine path
  const fx = sourceFixture();
  const hq = fx.entries.find((e) => e.id === "wan22-i2v-hq");
  const fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090" });
  const fp = await gateway.fingerprint.collectFingerprint(hq, { ...fx.options, fetchImpl, hashImpl: () => { throw new Error("HASH ON ROUTINE PATH"); } });
  assert.equal(fp.comfyui.effective_source_sha256, undefined, "no manifest → no source claim, no probing");
  // source roots come only from committed environments config
  assert.throws(() => gateway.environment.hostConfig("unconfigured-host", fx.options), /not configured/);
});

// ---- P7: PRESTO deployment contract ---------------------------------------------------------

// Local-transport deployment fixture: temp repo-root with a committed-style
// config tree, temp destination root, host "env-test".
function deploymentFixture() {
  const work = tmpDir("comfyui-deploy-");
  const repoRoot = path.join(work, "repo");
  const destRoot = path.join(work, "deployed");
  fs.mkdirSync(path.join(repoRoot, "config", "hosttest", "comfyui"), { recursive: true });
  fs.mkdirSync(destRoot, { recursive: true });
  const files = [
    { id: "launcher", name: "launch.ps1", content: "Write-Output 'launch v1'\n" },
    { id: "paths", name: "extra_model_paths.yaml", content: "legacy:\n  base_path: /x\n" },
  ];
  const manifestFiles = [];
  for (const f of files) {
    const src = path.join(repoRoot, "config", "hosttest", "comfyui", f.name);
    fs.writeFileSync(src, f.content);
    manifestFiles.push({
      id: f.id,
      source: `config/hosttest/comfyui/${f.name}`,
      destination: `${destRoot}/${f.name}`,
      sha256: require("node:crypto").createHash("sha256").update(f.content).digest("hex"),
      classification: "managed_operational_config",
      required: true,
      restart_impact: "comfyui_restart_required_on_change",
    });
  }
  fs.writeFileSync(path.join(repoRoot, "config", "hosttest", "comfyui", "deployment.json"),
    JSON.stringify({ schema_version: 1, host: "env-test", files: manifestFiles }));
  const environmentsPath = path.join(work, "environments.json");
  fs.writeFileSync(environmentsPath, JSON.stringify({
    schema_version: 1,
    hosts: { "env-test": {
      transport: "local", comfyui_root: destRoot, model_roots: [path.join(work, "models")],
      deployment_manifest: "config/hosttest/comfyui/deployment.json",
      approved_deployment_roots: [destRoot],
    } },
  }));
  const options = { repoRoot, environmentsPath, deployStateRoot: path.join(work, "deploy-state") };
  const deploy = () => { for (const f of files) fs.writeFileSync(path.join(destRoot, f.name), f.content); };
  return { work, repoRoot, destRoot, files, manifestFiles, options, deploy };
}

test("comfyui-deployment manifest: canonical hashes enforced, destinations confined, duplicates rejected", () => {
  const fx = deploymentFixture();
  const { manifest } = gateway.deployment.loadDeploymentManifest("env-test", fx.options);
  assert.equal(manifest.files.length, 2);
  // canonical file edited without manifest update → fails closed
  fs.appendFileSync(path.join(fx.repoRoot, "config", "hosttest", "comfyui", "launch.ps1"), "# sneaky edit\n");
  assert.throws(() => gateway.deployment.loadDeploymentManifest("env-test", fx.options), /do not match manifest sha/);
  // destination escape rejected
  const fx2 = deploymentFixture();
  const mPath = path.join(fx2.repoRoot, "config", "hosttest", "comfyui", "deployment.json");
  const m = JSON.parse(fs.readFileSync(mPath, "utf8"));
  m.files[0].destination = "/etc/passwd";
  fs.writeFileSync(mPath, JSON.stringify(m));
  assert.throws(() => gateway.deployment.loadDeploymentManifest("env-test", fx2.options), /outside approved deployment roots/);
  // duplicate destination rejected
  const fx3 = deploymentFixture();
  const m3Path = path.join(fx3.repoRoot, "config", "hosttest", "comfyui", "deployment.json");
  const m3 = JSON.parse(fs.readFileSync(m3Path, "utf8"));
  m3.files[1].destination = m3.files[0].destination;
  fs.writeFileSync(m3Path, JSON.stringify(m3));
  assert.throws(() => gateway.deployment.loadDeploymentManifest("env-test", fx3.options), /duplicate destination/);
  // traversal helper
  assert.equal(gateway.deployment.destinationApproved("D:/AI/ComfyUI/../secrets.txt", ["D:/AI/ComfyUI"]), false);
});

test("comfyui-deployment status: MATCH / DRIFT / MISSING / UNREADABLE without any write", async () => {
  const fx = deploymentFixture();
  // missing
  let result = await gateway.deployment.verifyDeployment("env-test", fx.options);
  assert.ok(result.files.every((f) => f.status === "MISSING"));
  assert.equal(result.all_match, false);
  // match
  fx.deploy();
  result = await gateway.deployment.verifyDeployment("env-test", fx.options);
  assert.ok(result.files.every((f) => f.status === "MATCH"));
  assert.equal(result.all_match, true);
  // drift
  fs.appendFileSync(path.join(fx.destRoot, "launch.ps1"), "# local hack\n");
  result = await gateway.deployment.verifyDeployment("env-test", fx.options);
  assert.equal(result.files.find((f) => f.id === "launcher").status, "DRIFT");
  assert.equal(result.files.find((f) => f.id === "paths").status, "MATCH");
  // unreadable via injected reader
  const unreadable = await gateway.deployment.verifyDeployment("env-test", {
    ...fx.options, reader: async () => ({ exists: true, error: "EACCES simulated" }),
  });
  assert.ok(unreadable.files.every((f) => f.status === "UNREADABLE"));
});

test("comfyui-deployment apply: explicit-only, backup + atomic + post-verify; matching files never rewritten", async () => {
  const fx = deploymentFixture();
  fx.deploy();
  // explicit authorization required
  await assert.rejects(gateway.deployment.applyDeployment("env-test", fx.options), (e) => e.code === "comfyui_deployment_not_authorized");
  // all matching → zero writes (write spy)
  let writes = 0;
  const spyWriter = (config) => async (dest, content) => { writes += 1; fs.writeFileSync(dest, content); return { sha256: require("node:crypto").createHash("sha256").update(content).digest("hex") }; };
  const noop = await gateway.deployment.applyDeployment("env-test", { ...fx.options, allowApply: true, writer: spyWriter() });
  assert.equal(noop.result, "NO_CHANGE_REQUIRED");
  assert.equal(noop.writes, 0);
  assert.equal(writes, 0, "matching files must never be rewritten");
  // drift → backup + replace + verify + event
  fs.writeFileSync(path.join(fx.destRoot, "launch.ps1"), "Write-Output 'LOCAL DRIFT'\n");
  const driftSha = require("node:crypto").createHash("sha256").update("Write-Output 'LOCAL DRIFT'\n").digest("hex");
  const applied = await gateway.deployment.applyDeployment("env-test", { ...fx.options, allowApply: true });
  assert.equal(applied.result, "APPLIED");
  assert.equal(applied.writes, 1);
  const launched = applied.files.find((f) => f.id === "launcher");
  assert.equal(launched.status, "REPLACED");
  assert.equal(launched.before_sha256, driftSha);
  assert.ok(launched.backup, "pre-write backup captured");
  assert.equal(fs.readFileSync(launched.backup, "utf8"), "Write-Output 'LOCAL DRIFT'\n", "backup holds the exact pre-install bytes");
  assert.equal(fs.readFileSync(path.join(fx.destRoot, "launch.ps1"), "utf8"), "Write-Output 'launch v1'\n");
  assert.equal(applied.comfyui_restart_required, true, "restart requirement reported, never executed");
  // event persisted
  const event = gateway.deployment.readEvent("env-test", applied.deployment_id, fx.options);
  assert.equal(event.result, "APPLIED");
  // interrupted write: failure before rename preserves the original
  fs.writeFileSync(path.join(fx.destRoot, "launch.ps1"), "Write-Output 'DRIFT 2'\n");
  await assert.rejects(gateway.deployment.applyDeployment("env-test", {
    ...fx.options, allowApply: true,
    writer: async () => { throw new Error("ssh dropped mid-write"); },
  }), /ssh dropped/);
  assert.equal(fs.readFileSync(path.join(fx.destRoot, "launch.ps1"), "utf8"), "Write-Output 'DRIFT 2'\n", "original preserved on interruption");
  // post-write corruption → FAILED, no success claim (backups stay honest —
  // only the destination write corrupts)
  await assert.rejects(gateway.deployment.applyDeployment("env-test", {
    ...fx.options, allowApply: true,
    writer: async (dest, content) => {
      if (dest.includes(".backup-")) { fs.writeFileSync(dest, content); return { sha256: require("node:crypto").createHash("sha256").update(content).digest("hex") }; }
      fs.writeFileSync(dest, "corrupted"); return { sha256: "f".repeat(64) };
    },
  }), (e) => e.code === "comfyui_deployment_verify_failed");
});

test("comfyui-deployment rollback: exact bytes restored, hash-verified, foreign events rejected", async () => {
  const fx = deploymentFixture();
  fx.deploy();
  fs.writeFileSync(path.join(fx.destRoot, "launch.ps1"), "Write-Output 'operator local version'\n");
  const applied = await gateway.deployment.applyDeployment("env-test", { ...fx.options, allowApply: true });
  assert.equal(applied.result, "APPLIED");
  // rollback requires explicit intent
  await assert.rejects(gateway.deployment.rollbackDeployment("env-test", applied.deployment_id, fx.options), (e) => e.code === "comfyui_deployment_not_authorized");
  const record = await gateway.deployment.rollbackDeployment("env-test", applied.deployment_id, { ...fx.options, allowApply: true });
  assert.equal(record.result, "ROLLED_BACK");
  assert.equal(fs.readFileSync(path.join(fx.destRoot, "launch.ps1"), "utf8"), "Write-Output 'operator local version'\n", "exact original bytes restored");
  // unknown event refused
  await assert.rejects(gateway.deployment.rollbackDeployment("env-test", "deploy-nonsense", { ...fx.options, allowApply: true }), (e) => e.code === "comfyui_deployment_event_unknown");
  // an event whose destination is no longer in the manifest cannot write
  const evPath = path.join(fx.options.deployStateRoot, "env-test", `${applied.deployment_id}.json`);
  const tampered = JSON.parse(fs.readFileSync(evPath, "utf8"));
  tampered.files[0].destination = path.join(fx.work, "unrelated.txt");
  fs.writeFileSync(evPath, JSON.stringify(tampered));
  await assert.rejects(gateway.deployment.rollbackDeployment("env-test", applied.deployment_id, { ...fx.options, allowApply: true }), /not in the current deployment manifest/);
});

test("comfyui-deployment managed classification: MATCH → REPRODUCIBLE_MANAGED, drift visible, live sha stays authoritative; no restart verbs", async () => {
  // hermetic: managed map drives classification; live sha drives identity
  const raw = (sha) => ({
    git_commit: "c".repeat(40), git_branch: "master", tracked_patch_sha256: null,
    source_entries: [
      { path: "start.ps1", status: "??", tracked: false, bytes: 10, sha256: sha },
      { path: "logs/x.log.prev", status: "??", tracked: false, bytes: 5, sha256: null },
    ],
  });
  const managed = { "start.ps1": "a".repeat(64) };
  const match = gateway.environment.buildSourceIdentity(raw("a".repeat(64)), { managed });
  assert.equal(match.source_state, "REPRODUCIBLE_MANAGED");
  const entry = match.working_tree.entries.find((e) => e.path === "start.ps1");
  assert.equal(entry.category, "managed_operational_config");
  assert.equal(entry.deployment_status, "MATCH");
  assert.equal(entry.expected_sha256, "a".repeat(64));
  // drift: live sha differs → DRIFT, state falls back, and the LIVE sha (not
  // the expected one) drives effective identity
  const drift = gateway.environment.buildSourceIdentity(raw("b".repeat(64)), { managed });
  assert.equal(drift.working_tree.entries.find((e) => e.path === "start.ps1").deployment_status, "DRIFT");
  assert.equal(drift.source_state, "KNOWN_PATCHED");
  assert.notEqual(drift.effective_source_sha256, match.effective_source_sha256, "live bytes drive identity — expected sha never masks drift");
  // deployment implementation never restarts anything
  const src = fs.readFileSync(path.join(REPO, "comfyui-gateway", "deployment.js"), "utf8");
  for (const banned of ["Restart-Service", "Stop-Process", "systemctl", "reboot", "shutdown", "Restart-Computer"]) {
    assert.ok(!src.includes(banned), `deployment.js must not contain "${banned}"`);
  }
  // real committed contract: canonical bytes match the committed manifest
  const real = gateway.deployment.loadDeploymentManifest("PRESTO");
  assert.equal(real.manifest.files.length, 3);
  assert.ok(real.manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
});

// ---- P8: core-source drift verification ------------------------------------------------------

// PRESTO-shaped raw source state: clean tracked tree at one commit, managed
// operational configs, diagnostic/log/backup litter — the live 2026-08 shape.
function p8Raw(overrides = {}) {
  return {
    git_commit: "c".repeat(40),
    git_branch: "master",
    tracked_patch_sha256: null,
    source_entries: [
      { path: "_diagnostics/hunyuan_a.md", status: "??", tracked: false, bytes: 3749, sha256: null },
      { path: "extra_model_paths.yaml", status: "ignored-active", tracked: false, bytes: 926, sha256: "1".repeat(64) },
      { path: "extra_model_paths.yaml.backup-old", status: "??", tracked: false, bytes: 428, sha256: null },
      { path: "logs/comfyui-server.err.log.prev", status: "??", tracked: false, bytes: 6935, sha256: null },
      { path: "start-presto-comfyui-server.ps1", status: "??", tracked: false, bytes: 452, sha256: "2".repeat(64) },
    ],
    ...overrides,
  };
}
const P8_MANAGED = { "extra_model_paths.yaml": "1".repeat(64), "start-presto-comfyui-server.ps1": "2".repeat(64) };
function p8Identity(raw) {
  return { git_commit: raw.git_commit, ...gateway.environment.buildSourceIdentity(raw, { managed: P8_MANAGED }) };
}

test("comfyui-source taxonomy: a clean tracked tree is explicit (git_commit_exact), never an overloaded null patch", () => {
  // clean tracked tree + fingerprinted managed configs + litter → exact
  const exact = p8Identity(p8Raw());
  assert.equal(exact.source_state, "REPRODUCIBLE_MANAGED");
  assert.equal(exact.identity_level, "git_commit_exact");
  assert.equal(exact.working_tree.tracked_clean, true);
  assert.equal(exact.working_tree.tracked_patch_sha256, null);
  // tracked patch material → git_commit_plus_patch, tracked_clean false
  const patched = p8Identity(p8Raw({
    tracked_patch_sha256: "d".repeat(64),
    source_entries: [...p8Raw().source_entries, { path: "comfy/model_management.py", status: "M", tracked: true, bytes: 20, sha256: "e".repeat(64) }],
  }));
  assert.equal(patched.identity_level, "git_commit_plus_patch");
  assert.equal(patched.working_tree.tracked_clean, false);
  // a tracked entry alone (even without a patch sha) forfeits exactness
  const trackedNoPatch = p8Identity(p8Raw({
    source_entries: [{ path: "comfy/model_management.py", status: "M", tracked: true, bytes: 20, sha256: "e".repeat(64) }],
  }));
  assert.equal(trackedNoPatch.working_tree.tracked_clean, false);
  assert.notEqual(trackedNoPatch.identity_level, "git_commit_exact");
  // litter-only tree stays exact about the tracked source
  const litter = p8Identity({ git_commit: "c".repeat(40), tracked_patch_sha256: null, source_entries: [{ path: "logs/a.log.prev", status: "??", tracked: false, bytes: 3, sha256: null }] });
  assert.equal(litter.source_state, "DIRTY_NON_EXECUTION");
  assert.equal(litter.identity_level, "git_commit_exact");
  // a fully clean checkout keeps the strongest historical label
  const clean = p8Identity({ git_commit: "c".repeat(40), tracked_patch_sha256: null, source_entries: [] });
  assert.equal(clean.source_state, "CLEAN");
  assert.equal(clean.identity_level, "git_commit");
  assert.equal(clean.working_tree.tracked_clean, true);
  // unfingerprintable execution-relevant change stays loudly unclassified
  const unclassified = p8Identity(p8Raw({ source_entries: [{ path: "mystery_node.py", status: "??", tracked: false, bytes: 99, sha256: null }] }));
  assert.equal(unclassified.identity_level, "git_commit_dirty_unfingerprinted");
  // cryptographic binding: the no-patch state hashes an explicit marker — a
  // real 64-hex patch hash can never collide with "no patch material"
  const none = gateway.environment.effectiveSourceSha256({ commit: "c".repeat(40), trackedPatchSha: null, entries: [] });
  const noneUndefined = gateway.environment.effectiveSourceSha256({ commit: "c".repeat(40), entries: [] });
  const withPatch = gateway.environment.effectiveSourceSha256({ commit: "c".repeat(40), trackedPatchSha: "d".repeat(64), entries: [] });
  assert.equal(none, noneUndefined, "null and absent patch are the same explicit no-patch state");
  assert.notEqual(none, withPatch, "no-patch marker never collides with a real patch identity");
});

test("comfyui-source drift comparator: tracked modification / exec-relevant change = CRITICAL, litter = INFORMATIONAL", () => {
  const recorded = p8Identity(p8Raw());
  // identical live state → MATCH with zero findings
  const same = gateway.environment.compareSourceIdentity(recorded, p8Identity(p8Raw()));
  assert.equal(same.verdict, "MATCH");
  assert.equal(same.findings.length, 0);
  // new diagnostic litter + a rotated log → MATCH, reported INFORMATIONAL only (R3)
  const litterRaw = p8Raw();
  litterRaw.source_entries = [
    ...litterRaw.source_entries.map((e) => (e.path.startsWith("logs/") ? { ...e, bytes: 9999 } : e)),
    { path: "_diagnostics/hunyuan_new_probe.md", status: "??", tracked: false, bytes: 55, sha256: null },
  ];
  const litter = gateway.environment.compareSourceIdentity(recorded, p8Identity(litterRaw));
  assert.equal(litter.verdict, "MATCH", "diagnostic litter must never fail the drift gate");
  assert.equal(litter.counts.CRITICAL, 0);
  assert.ok(litter.findings.length >= 2);
  assert.ok(litter.findings.every((f) => f.severity === "INFORMATIONAL"));
  assert.ok(litter.findings.some((f) => f.path === "_diagnostics/hunyuan_new_probe.md"));
  // R4: a TRACKED core file modified in future → CRITICAL with the file path
  const hackedRaw = p8Raw({
    tracked_patch_sha256: "d".repeat(64),
    source_entries: [...p8Raw().source_entries, { path: "comfy/model_management.py", status: "M", tracked: true, bytes: 31, sha256: "e".repeat(64) }],
  });
  const hacked = gateway.environment.compareSourceIdentity(recorded, p8Identity(hackedRaw));
  assert.equal(hacked.verdict, "DRIFT");
  assert.ok(hacked.findings.some((f) => f.severity === "CRITICAL" && f.path === "comfy/model_management.py"));
  assert.ok(hacked.findings.some((f) => f.kind === "tracked_patch_changed" && f.severity === "CRITICAL"));
  // new execution-relevant untracked file → CRITICAL with the file path
  const nodeRaw = p8Raw();
  nodeRaw.source_entries = [...nodeRaw.source_entries, { path: "evil_node.py", status: "??", tracked: false, bytes: 12, sha256: "f".repeat(64) }];
  const node = gateway.environment.compareSourceIdentity(recorded, p8Identity(nodeRaw));
  assert.equal(node.verdict, "DRIFT");
  assert.ok(node.findings.some((f) => f.severity === "CRITICAL" && f.path === "evil_node.py"));
  // managed operational config content change → CRITICAL (execution identity moved)
  const cfgRaw = p8Raw();
  cfgRaw.source_entries = cfgRaw.source_entries.map((e) => (e.path === "extra_model_paths.yaml" ? { ...e, sha256: "9".repeat(64) } : e));
  const cfg = gateway.environment.compareSourceIdentity(recorded, p8Identity(cfgRaw));
  assert.equal(cfg.verdict, "DRIFT");
  assert.ok(cfg.findings.some((f) => f.severity === "CRITICAL" && f.path === "extra_model_paths.yaml"));
  // execution-relevant file REMOVED → CRITICAL (identity changed, even if "cleaner")
  const goneRaw = p8Raw();
  goneRaw.source_entries = goneRaw.source_entries.filter((e) => e.path !== "extra_model_paths.yaml");
  const gone = gateway.environment.compareSourceIdentity(recorded, p8Identity(goneRaw));
  assert.equal(gone.verdict, "DRIFT");
  assert.ok(gone.findings.some((f) => f.severity === "CRITICAL" && f.path === "extra_model_paths.yaml"));
  // base commit moved → CRITICAL
  const moved = gateway.environment.compareSourceIdentity(recorded, p8Identity(p8Raw({ git_commit: "a".repeat(40) })));
  assert.equal(moved.verdict, "DRIFT");
  assert.ok(moved.findings.some((f) => f.kind === "base_commit_changed" && f.severity === "CRITICAL"));
  // unclassifiable new file → WARNING, visible but not (yet) identity drift
  const weirdRaw = p8Raw();
  weirdRaw.source_entries = [...weirdRaw.source_entries, { path: "weird/artifact.xyz", status: "??", tracked: false, bytes: 7, sha256: null }];
  const weird = gateway.environment.compareSourceIdentity(recorded, p8Identity(weirdRaw));
  assert.equal(weird.verdict, "MATCH");
  assert.equal(weird.counts.WARNING, 1);
  assert.ok(weird.findings.some((f) => f.severity === "WARNING" && f.path === "weird/artifact.xyz"));
  // taxonomy honesty: an old manifest label (git_commit_plus_patch over a null
  // patch) against the same structure is a label update, never drift
  const oldLabel = { ...recorded, identity_level: "git_commit_plus_patch" };
  const relabel = gateway.environment.compareSourceIdentity(oldLabel, p8Identity(p8Raw()));
  assert.equal(relabel.verdict, "MATCH");
  assert.ok(relabel.findings.some((f) => f.kind === "identity_level_label_changed" && f.severity === "INFORMATIONAL"));
});

test("comfyui-source drift verify: read-only re-observation vs recorded manifest — clean MATCH, tracked hack CRITICAL", async () => {
  const fx = sourceFixture();
  await gateway.environment.runStrongInventory("env-test", fx.options);
  // no drift right after inventory
  const v1 = await gateway.environment.verifySourceIdentity("env-test", fx.options);
  assert.equal(v1.status, "ok");
  assert.equal(v1.comparison.verdict, "MATCH");
  assert.equal(v1.comparison.counts.CRITICAL, 0);
  // verification evidence persists locally (never on the host)
  const persisted = gateway.environment.readSourceVerification("env-test", fx.options);
  assert.equal(persisted.verdict, "MATCH");
  assert.equal(persisted.recorded_effective_source_sha256, v1.manifest.comfyui.effective_source_sha256);
  // diagnostic/log litter appears → still MATCH, reported INFORMATIONAL
  fs.mkdirSync(path.join(fx.comfyRoot, "_diagnostics"), { recursive: true });
  fs.writeFileSync(path.join(fx.comfyRoot, "_diagnostics", "hunyuan_probe.md"), "diag");
  fs.mkdirSync(path.join(fx.comfyRoot, "logs"), { recursive: true });
  fs.writeFileSync(path.join(fx.comfyRoot, "logs", "server.out.log.prev"), "rotated");
  const v2 = await gateway.environment.verifySourceIdentity("env-test", fx.options);
  assert.equal(v2.comparison.verdict, "MATCH");
  assert.ok(v2.comparison.findings.some((f) => f.severity === "INFORMATIONAL" && f.path === "_diagnostics/hunyuan_probe.md"));
  // R4: tracked core file modified → CRITICAL drift naming the exact file
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'hacked'\n");
  const v3 = await gateway.environment.verifySourceIdentity("env-test", fx.options);
  assert.equal(v3.comparison.verdict, "DRIFT");
  assert.ok(v3.comparison.findings.some((f) => f.severity === "CRITICAL" && f.path === "comfy/model_management.py"));
  assert.equal(gateway.environment.readSourceVerification("env-test", fx.options).verdict, "DRIFT");
  // reverting the hack restores MATCH (litter still present, still informational)
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'auto'\n");
  const v4 = await gateway.environment.verifySourceIdentity("env-test", fx.options);
  assert.equal(v4.comparison.verdict, "MATCH");
  // new execution-relevant untracked file → CRITICAL
  fs.writeFileSync(path.join(fx.comfyRoot, "sneaky_node.py"), "def n(): pass\n");
  const v5 = await gateway.environment.verifySourceIdentity("env-test", fx.options);
  assert.equal(v5.comparison.verdict, "DRIFT");
  assert.ok(v5.comparison.findings.some((f) => f.severity === "CRITICAL" && f.path === "sneaky_node.py"));
  fs.rmSync(path.join(fx.comfyRoot, "sneaky_node.py"));
  // base commit moves → CRITICAL
  fs.writeFileSync(path.join(fx.comfyRoot, "main.py"), "print('upstream update')\n");
  gitIn(fx.comfyRoot, ["add", "main.py"]);
  gitIn(fx.comfyRoot, ["commit", "-qm", "upstream"]);
  const v6 = await gateway.environment.verifySourceIdentity("env-test", fx.options);
  assert.equal(v6.comparison.verdict, "DRIFT");
  assert.ok(v6.comparison.findings.some((f) => f.kind === "base_commit_changed" && f.severity === "CRITICAL"));
  // no manifest → no baseline to verify against, reported honestly
  const empty = environmentFixture();
  const missing = await gateway.environment.verifySourceIdentity("env-test", empty.options);
  assert.equal(missing.status, "absent");
});

test("comfyui-source drift → provenance: fingerprints carry the verdict; drifted evidence is flagged, never discarded", async () => {
  const fx = sourceFixture();
  await gateway.environment.runStrongInventory("env-test", fx.options);
  await gateway.environment.verifySourceIdentity("env-test", fx.options);
  const hq = fx.entries.find((e) => e.id === "wan22-i2v-hq");
  const modelFolders = {};
  for (const name of fx.allModels) {
    const folder = name.includes("lora") ? "loras" : name.includes("umt5") ? "text_encoders" : name.includes("vae") ? "vae" : "diffusion_models";
    const st = fs.statSync(path.join(fx.modelRoot, folder, name));
    (modelFolders[folder] = modelFolders[folder] || []).push({ name, size: st.size, modified: st.mtimeMs / 1000 });
  }
  const fetchImpl = fakeComfyFetch({ objectInfo: WAN_OBJECT_INFO, version: "0.22.0", gpu: "RTX 4090", modelFolders });
  const fp = await gateway.fingerprint.collectFingerprint(hq, { ...fx.options, fetchImpl });
  assert.equal(fp.comfyui.source_drift_check.verdict, "MATCH");
  // repeated MATCH verification never churns the fingerprint identity hash
  await gateway.environment.verifySourceIdentity("env-test", fx.options);
  const fpAgain = await gateway.fingerprint.collectFingerprint(hq, { ...fx.options, fetchImpl });
  assert.equal(fpAgain.fingerprint_sha256, fp.fingerprint_sha256, "re-verification of an unchanged env is not an identity change");
  // hack a tracked file, re-verify → DRIFT flows into the fingerprint
  fs.writeFileSync(path.join(fx.comfyRoot, "comfy", "model_management.py"), "VRAM = 'hacked'\n");
  await gateway.environment.verifySourceIdentity("env-test", fx.options);
  const fp2 = await gateway.fingerprint.collectFingerprint(hq, { ...fx.options, fetchImpl });
  assert.equal(fp2.comfyui.source_drift_check.verdict, "DRIFT");
  assert.ok(fp2.comfyui.source_drift_check.critical_findings.some((f) => f.includes("comfy/model_management.py")));
  // production capture under drift: evidence kept (real render) but flagged loudly
  const runsRoot = tmpDir("comfyui-drift-runs-");
  const runDir = writeWanRunDir(runsRoot, "run-drift-1");
  gateway.provenance.buildWanRunProvenance(runDir, { entry: hq });
  const captured = gateway.qualification.captureProductionQualification({ entry: hq, runDir, fingerprint: fp2 }, fx.options);
  assert.equal(captured.captured, true, JSON.stringify(captured.reasons));
  assert.equal(captured.record.source_integrity_warning.code, "CORE_SOURCE_DRIFTED_FROM_MANIFEST");
  assert.ok(captured.source_integrity_warning, "capture result surfaces the warning to callers");
  const ev = gateway.qualification.evaluateQualification(hq, fx.options);
  assert.equal(ev.evidence_state, "LIVE_PASSED", "flag + warn — never silently discard real production evidence");
  assert.ok(ev.notes.some((n) => /CORE-SOURCE DRIFT/.test(n)));
  // a verification of an OLDER inventory is never presented as current: after
  // re-inventory the recorded identity changed → stale verdict not attached
  await gateway.environment.runStrongInventory("env-test", fx.options);
  const fp3 = await gateway.fingerprint.collectFingerprint(hq, { ...fx.options, fetchImpl });
  assert.equal(fp3.comfyui.source_drift_check, undefined, "verification of a superseded manifest must not be attached");
  // clean captures stay unflagged
  const runDir2 = writeWanRunDir(runsRoot, "run-drift-2");
  gateway.provenance.buildWanRunProvenance(runDir2, { entry: hq });
  const captured2 = gateway.qualification.captureProductionQualification({ entry: hq, runDir: runDir2, fingerprint: fp3 }, fx.options);
  assert.equal(captured2.captured, true, JSON.stringify(captured2.reasons));
  assert.equal(captured2.record.source_integrity_warning, undefined);
});

test("comfyui-source drift safety: observation is read-only — no write/mutation verbs, no model hashing, CLI wired", async () => {
  // the remote source-observation script contains no write or git-mutation verbs
  const script = gateway.environment.buildPowershellSourceScript({ comfyui_root: "D:/AI/ComfyUI" });
  for (const banned of ["Set-Content", "Out-File", "Remove-Item", "Move-Item", "WriteAllBytes", "New-Item", "git reset", "git checkout", "git clean", "git stash", "git pull"]) {
    assert.ok(!script.includes(banned), `source script must not contain "${banned}"`);
  }
  assert.ok(script.includes("SOURCE_JSON_BEGIN"));
  // verify never hashes model files (spy would throw) and never writes to the tree
  const fx = sourceFixture();
  await gateway.environment.runStrongInventory("env-test", fx.options);
  const before = fs.readdirSync(fx.comfyRoot).sort();
  await gateway.environment.verifySourceIdentity("env-test", { ...fx.options, hashImpl: () => { throw new Error("MODEL HASH ON DRIFT PATH"); } });
  assert.deepEqual(fs.readdirSync(fx.comfyRoot).sort(), before, "drift verify leaves the tree untouched");
  // injectable collector: tests/fixtures can never reach ssh
  const injected = await gateway.environment.verifySourceIdentity("env-test", {
    ...fx.options,
    sourceCollector: async () => ({ comfyui: { git_commit: "0".repeat(40) }, git_branch: "x", tracked_patch_sha256: null, source_entries: [] }),
  });
  assert.equal(injected.comparison.verdict, "DRIFT", "injected collector drives the comparison");
  // operator entry point exists and stays read-only-labeled
  const cli = fs.readFileSync(path.join(REPO, "scripts", "comfyui-workflow-check.js"), "utf8");
  assert.ok(cli.includes("--source-verify"), "CLI must expose the core-source drift gate");
});

// ---- P8 hardening: every path that could report a FALSE "MATCH" ------------
// Each case below was demonstrated against the pre-hardening implementation.
const environment = gateway.environment;
const { execFileSync } = require("node:child_process");
const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test("comfyui-source hardening: a name git has to quote still counts as executable code", () => {
  const root = mkdtemp("comfyui-quotepath-");
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(root, "main.py"), "print(1)\n");
  git("add", "-A"); git("commit", "-qm", "base");
  // non-ASCII name: git C-quotes this in --porcelain unless quotePath=false
  fs.writeFileSync(path.join(root, "näyttö_node.py"), "import os\n");
  const observed = environment.collectLocalSourceState(root);
  const entry = observed.source_entries.find((e) => /node\.py$/.test(e.path));
  assert.ok(entry, "the quoted path must survive observation");
  assert.equal(entry.path, "näyttö_node.py", "path must be unquoted, not C-escaped");
  const cls = environment.classifySourceEntry(entry.path);
  assert.equal(cls.execution_relevant, true, "an executable .py must never be demoted by its name");
  assert.ok(entry.sha256, "and it must actually be content-hashed");
});

test("comfyui-source hardening: noise-looking names never demote real code", () => {
  for (const p of ["evil.log.py", "node__pycache__helper.py", "ComfyUI.bak-node.py", "hook.pyw", "tools/launch.ps1"]) {
    assert.equal(environment.classifySourceEntry(p).execution_relevant, true, `${p} must stay execution-relevant`);
  }
  // genuine noise stays noise
  for (const p of ["logs/server.log", "run.log.prev", "__pycache__/x.pyc", "extra_model_paths.yaml.backup-20260531", "venv/Scripts/activate.bat", "models/a.safetensors"]) {
    assert.equal(environment.classifySourceEntry(p).execution_relevant, false, `${p} must stay noise`);
  }
});

test("comfyui-source hardening: an unobservable tree yields no identity and never a MATCH", async () => {
  const notGit = mkdtemp("comfyui-notgit-");
  fs.writeFileSync(path.join(notGit, "main.py"), "print(1)\n");
  const observed = environment.collectLocalSourceState(notGit);
  assert.equal(observed.source_observed, false, "a non-git root is an incomplete observation");
  const identity = environment.buildSourceIdentity({ git_commit: observed.comfyui.git_commit, source_entries: observed.source_entries });
  assert.equal(identity.effective_source_sha256, null, "no anchor => no identity (never a constant hash)");
  assert.equal(identity.identity_level, "unknown");
  // two different unanchored trees must NOT compare equal
  const a = { git_commit: null, identity_level: "unknown", effective_source_sha256: null, working_tree: { entries: [] } };
  const cmp = environment.compareSourceIdentity(a, a);
  assert.equal(cmp.verdict, "DRIFT", "unverifiable source must fail closed");
  assert.ok(cmp.findings.some((f) => f.kind === "unverifiable_source_observation"), "and say why");
  // verifySourceIdentity refuses rather than reporting MATCH
  const host = "PRESTO";
  const envRoot = mkdtemp("comfyui-verifyroot-");
  fs.mkdirSync(path.join(envRoot, host), { recursive: true });
  const manifest = { schema_version: 1, host, generated_at: new Date().toISOString(), comfyui: { git_commit: "c".repeat(40), effective_source_sha256: "e".repeat(64), working_tree: { entries: [] }, identity_level: "git_commit_exact", source_state: "CLEAN" }, models: [] };
  manifest.manifest_sha256 = environment.manifestSha256 ? environment.manifestSha256(manifest) : undefined;
  fs.writeFileSync(path.join(envRoot, host, "manifest.json"), JSON.stringify(manifest));
  const res = await environment.verifySourceIdentity(host, {
    environmentRoot: envRoot,
    managed: {},
    sourceCollector: () => environment.collectLocalSourceState(notGit),
  });
  assert.notEqual(res.status, "ok", "an unobservable live source must not produce a comparison");
  assert.ok(["source_unobservable", "invalid", "missing"].includes(res.status), `unexpected status ${res.status}`);
});

test("comfyui-source hardening: a duplicate-path entry cannot move the identity", () => {
  const base = { commit: "a".repeat(40), trackedPatchSha: null };
  const one = environment.effectiveSourceSha256({ ...base, entries: [{ path: "extra_model_paths.yaml", execution_relevant: true, sha256: "1".repeat(64) }] });
  const dupA = environment.effectiveSourceSha256({ ...base, entries: [
    { path: "extra_model_paths.yaml", execution_relevant: true, sha256: "1".repeat(64) },
    { path: "extra_model_paths.yaml", execution_relevant: true, sha256: "2".repeat(64) }] });
  const dupB = environment.effectiveSourceSha256({ ...base, entries: [
    { path: "extra_model_paths.yaml", execution_relevant: true, sha256: "2".repeat(64) },
    { path: "extra_model_paths.yaml", execution_relevant: true, sha256: "1".repeat(64) }] });
  assert.equal(dupA, dupB, "duplicate paths must sort totally — observation order cannot change identity");
  assert.notEqual(one, dupA, "and a duplicate is still a different fact set");
});
