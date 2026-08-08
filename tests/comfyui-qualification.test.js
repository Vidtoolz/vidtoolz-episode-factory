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
function fakeComfyFetch({ objectInfo = FLUX_OBJECT_INFO, version = "0.27.0", gpu = "NVIDIA TEST GPU" } = {}) {
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
