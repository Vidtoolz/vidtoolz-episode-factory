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
