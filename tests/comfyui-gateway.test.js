// ComfyUI Production Gateway — registry, contracts, preflight, failure
// classification, and provenance. Filesystem fixtures in temp dirs; ComfyUI
// API faked via injected fetch; no network, no GPU, no live PRESTO.
const { assert, fs, os, path, test } = require("./_helpers.js");
const gateway = require("../comfyui-gateway");

const REPO = path.join(__dirname, "..");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A miniature registry rooted in the REAL repo (canonical roots enforced) but
// pointing at temp runtime copies so drift can be simulated freely.
function fixtureRegistry(overrides = {}) {
  const work = tmpDir("comfyui-gw-");
  const canonicalRel = path.join("config", "comfyui", "workflows", "flux-gguf-1080x1920.v1.json");
  const canonicalAbs = path.join(REPO, canonicalRel);
  const runtimeCopy = path.join(work, "runtime-workflow.json");
  fs.copyFileSync(canonicalAbs, runtimeCopy);
  const entry = {
    id: "test-flux",
    version: 1,
    description: "fixture",
    media_type: "image",
    lane: "text_to_image_generation",
    format: "ui",
    canonical_path: canonicalRel,
    canonical_sha256: gateway.registry.sha256File(canonicalAbs),
    runtime_copies: [runtimeCopy],
    comfyui: { endpoint_default: "http://127.0.0.1:65500", endpoint_env: [] },
    qualification: "PRODUCTION",
    required_models: [{ class_type: "UnetLoaderGGUF", input_key: "unet_name", name: "flux1-dev-Q8_0.gguf" }],
    required_custom_node_classes: ["UnetLoaderGGUF"],
    graph_bindings: {
      prompt: { node_id: 7, node_type: "CLIPTextEncode", target: "widgets_values[0]" },
      filename_prefix: { node_id: 17, node_type: "SaveImage", target: "widgets_values[0]" },
    },
    parameter_schema: {
      required: { prompt: { type: "string", min_length: 1, max_length: 100 } },
      optional: { seed: { type: "integer", min: 1, max: 100, default: 42 } },
    },
    expected_output: { media_type: "image", extension: "png", width: 1080, height: 1920 },
    ...overrides,
  };
  const registry = { registry_version: 1, workflows: [entry] };
  const registryPath = path.join(work, "registry.json");
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  return { work, entry, registry, registryPath, runtimeCopy, canonicalAbs };
}

// ---- registry -----------------------------------------------------------------

test("comfyui-gateway registry: real production registry loads, hashes verified, no drift at ship time", () => {
  const reg = gateway.registry.loadRegistry();
  assert.ok(reg.workflows.length >= 3);
  for (const entry of reg.workflows) {
    const canonical = gateway.registry.verifyCanonicalHash(entry);
    assert.equal(canonical.status, "ok", `${entry.id}: canonical ${canonical.status}`);
  }
  const hq = gateway.registry.getWorkflow("wan22-i2v-hq");
  assert.equal(hq.presto_profile, "wan22_hq_720p_5s_no_lightx2v");
  assert.equal(gateway.registry.getWorkflowForPrestoProfile("wan22_hq_720p_5s_no_lightx2v").id, "wan22-i2v-hq");
  assert.equal(gateway.registry.getWorkflowForPrestoProfile("fast_current").id, "wan22-i2v-fast");
});

test("comfyui-gateway registry: unknown workflow and unknown version are rejected with coded errors", () => {
  assert.throws(() => gateway.registry.getWorkflow("no-such-workflow"), (e) => e.code === "comfyui_workflow_unknown" && e.statusCode === 404);
  assert.throws(() => gateway.registry.getWorkflow("wan22-i2v-hq", { version: 99 }), (e) => e.code === "comfyui_workflow_version_unknown");
  assert.throws(() => gateway.registry.getWorkflowForPrestoProfile("no-such-profile"), (e) => e.code === "comfyui_workflow_unknown");
});

test("comfyui-gateway registry: malformed entries and path escapes are rejected at load", () => {
  const { work } = fixtureRegistry();
  const bad = { registry_version: 1, workflows: [{ id: "Bad_Name!", version: 0 }] };
  const badPath = path.join(work, "bad.json");
  fs.writeFileSync(badPath, JSON.stringify(bad));
  assert.throws(() => gateway.registry.loadRegistry({ registryPath: badPath }), /invalid/);
  const escape = { registry_version: 1, workflows: [{ id: "esc", version: 1, media_type: "image", qualification: "PRODUCTION", canonical_path: "../../../etc/passwd", canonical_sha256: "a".repeat(64), parameter_schema: {} }] };
  fs.writeFileSync(badPath, JSON.stringify(escape));
  assert.throws(() => gateway.registry.loadRegistry({ registryPath: badPath }), /escapes the approved workflow roots/);
  fs.rmSync(work, { recursive: true, force: true });
});

test("comfyui-gateway registry: runtime-copy drift and canonical drift block production dispatch", () => {
  const { work, entry, registryPath, runtimeCopy } = fixtureRegistry();
  const opts = { registryPath };
  // clean state passes
  assert.equal(gateway.registry.assertProductionAllowed(entry, opts).ok, true);
  // runtime copy edited (a UI session changed the live graph) -> drift blocks
  fs.appendFileSync(runtimeCopy, "\n");
  const blocked = gateway.registry.assertProductionAllowed(entry, { ...opts, driftOverride: false });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "comfyui_workflow_drift");
  assert.match(blocked.blocked_reason, /runtime copy drift/);
  // explicit override converts the block into a warning
  const overridden = gateway.registry.assertProductionAllowed(entry, { ...opts, driftOverride: true });
  assert.equal(overridden.ok, true);
  assert.match(overridden.warnings.join("\n"), /DRIFT OVERRIDE ACTIVE/);
  // missing runtime copy is its own coded refusal
  fs.rmSync(runtimeCopy);
  const missing = gateway.registry.assertProductionAllowed(entry, { ...opts, driftOverride: false });
  assert.equal(missing.code, "comfyui_workflow_runtime_missing");
  fs.rmSync(work, { recursive: true, force: true });
});

test("comfyui-gateway registry: unqualified workflows are refused for production", () => {
  const { work, entry } = fixtureRegistry({ qualification: "EXPERIMENTAL" });
  const verdict = gateway.registry.assertProductionAllowed(entry, { driftOverride: false });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "comfyui_workflow_unqualified");
  assert.throws(() => gateway.preflight.preflightSync(null, { entry, driftOverride: false }), (e) => e.code === "comfyui_workflow_unqualified" && e.statusCode === 403);
  fs.rmSync(work, { recursive: true, force: true });
});

// ---- render contracts ----------------------------------------------------------

test("comfyui-gateway contracts: required/type/range/default/unknown-parameter rules", () => {
  const { work, entry } = fixtureRegistry();
  const v1 = gateway.contracts.validateRenderRequest(entry, {});
  assert.equal(v1.ok, false);
  assert.ok(v1.errors.some((e) => e.field === "prompt" && /required/.test(e.message)));
  const v2 = gateway.contracts.validateRenderRequest(entry, { prompt: 42 });
  assert.ok(v2.errors.some((e) => e.field === "prompt" && /string/.test(e.message)));
  const v3 = gateway.contracts.validateRenderRequest(entry, { prompt: "ok", seed: 1000 });
  assert.ok(v3.errors.some((e) => e.field === "seed" && /<= 100/.test(e.message)));
  const v4 = gateway.contracts.validateRenderRequest(entry, { prompt: "ok" });
  assert.equal(v4.ok, true);
  assert.equal(v4.params.seed, 42, "default applied");
  assert.equal(v4.params.prompt, "ok", "prompt passes through byte-for-byte");
  const v5 = gateway.contracts.validateRenderRequest(entry, { prompt: "ok", promt: "typo" });
  assert.equal(v5.ok, false);
  assert.ok(v5.errors.some((e) => e.field === "promt" && /unknown parameter/.test(e.message)));
  fs.rmSync(work, { recursive: true, force: true });
});

test("comfyui-gateway contracts: wan contract validates against the real registry (missing input, seed range)", () => {
  const hq = gateway.registry.getWorkflow("wan22-i2v-hq");
  const missing = gateway.contracts.validateRenderRequest(hq, { prompt: "motion", source_image: "/nonexistent/never.png" });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.field === "source_image" && /does not exist/.test(e.message)));
  const schemaOnly = gateway.contracts.validateRenderRequest(hq, { prompt: "motion", source_image: "/nonexistent/never.png" }, { checkPaths: false });
  assert.equal(schemaOnly.ok, true, "schema-only mode skips filesystem checks");
  const badSeed = gateway.contracts.validateRenderRequest(hq, { prompt: "m", source_image: "/x.png", seed: -5 }, { checkPaths: false });
  assert.ok(badSeed.errors.some((e) => e.field === "seed"));
});

test("comfyui-gateway contracts: graph bindings verified against the real canonical graphs; mutation detected", () => {
  const flux = gateway.registry.getWorkflow("flux-gguf-1080x1920");
  const fluxGraph = JSON.parse(fs.readFileSync(gateway.registry.canonicalAbsolutePath(flux), "utf8"));
  assert.equal(gateway.contracts.verifyGraphBindings(flux, fluxGraph).ok, true);
  // simulate schema drift: the prompt node disappears
  const mutated = JSON.parse(JSON.stringify(fluxGraph));
  mutated.nodes = mutated.nodes.filter((n) => n.id !== 7);
  const drifted = gateway.contracts.verifyGraphBindings(flux, mutated);
  assert.equal(drifted.ok, false);
  assert.match(drifted.problems.join("; "), /prompt: node 7 not found/);
  // wrong node type at the expected id
  const retyped = JSON.parse(JSON.stringify(fluxGraph));
  retyped.nodes.find((n) => n.id === 7).type = "SomethingElse";
  assert.match(gateway.contracts.verifyGraphBindings(flux, retyped).problems.join(";"), /adapter expects CLIPTextEncode/);
  // API-format semantic bindings (wan)
  const hq = gateway.registry.getWorkflow("wan22-i2v-hq");
  const hqGraph = JSON.parse(fs.readFileSync(gateway.registry.canonicalAbsolutePath(hq), "utf8"));
  assert.equal(gateway.contracts.verifyGraphBindings(hq, hqGraph).ok, true);
});

// ---- preflight -----------------------------------------------------------------

function fakeFetch(routes) {
  return async (url) => {
    for (const [pattern, responder] of routes) {
      if (url.includes(pattern)) return responder(url);
    }
    throw Object.assign(new Error("fetch failed: ECONNREFUSED"), { code: "ECONNREFUSED" });
  };
}
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test("comfyui-gateway preflight: full run with reachable ComfyUI, models present, contract + input checks", async () => {
  const { work, registryPath } = fixtureRegistry({
    parameter_schema: {
      required: { prompt: { type: "string", min_length: 1, max_length: 100 }, source_image: { type: "path" } },
      optional: { seed: { type: "integer", min: 1, max: 100, default: 42 } },
    },
  });
  const input = path.join(work, "in.png");
  fs.writeFileSync(input, "png");
  const fetchImpl = fakeFetch([
    ["/system_stats", () => okJson({ system: { comfyui_version: "0.3.30", os: "posix" }, devices: [{ name: "RTX TEST", vram_total: 1, vram_free: 1 }] })],
    ["/object_info/UnetLoaderGGUF", () => okJson({ UnetLoaderGGUF: { input: { required: { unet_name: [["flux1-dev-Q8_0.gguf"]] } } } })],
  ]);
  const result = await gateway.preflight.runPreflight("test-flux", {
    registryPath, fetchImpl, params: { prompt: "hello", source_image: input }, outputRoot: work,
  });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  const names = result.checks.map((c) => `${c.name}:${c.status}`);
  ["registry_entry:ok", "qualification:ok", "canonical_workflow_hash:ok", "runtime_copy:ok", "graph_bindings:ok", "render_contract:ok", "input_exists:ok", "output_root_writable:ok", "comfyui_reachable:ok", "required_models:ok", "required_custom_nodes:ok"].forEach((expected) => {
    assert.ok(names.includes(expected), `${expected} missing from ${names.join(", ")}`);
  });
  assert.equal(result.environment.comfyui_version, "0.3.30");
  fs.rmSync(work, { recursive: true, force: true });
});

test("comfyui-gateway preflight: unreachable ComfyUI is a distinct failed check, inventory honestly unavailable", async () => {
  const { work, registryPath } = fixtureRegistry();
  const result = await gateway.preflight.runPreflight("test-flux", { registryPath, fetchImpl: fakeFetch([]) });
  assert.equal(result.ok, false);
  const reach = result.checks.find((c) => c.name === "comfyui_reachable");
  assert.equal(reach.status, "failed");
  const models = result.checks.find((c) => c.name === "required_models");
  assert.equal(models.status, "not_authoritative");
  fs.rmSync(work, { recursive: true, force: true });
});

test("comfyui-gateway preflight: missing model and missing custom node produce explicit missing lists", async () => {
  const { work, registryPath } = fixtureRegistry();
  const fetchImpl = fakeFetch([
    ["/system_stats", () => okJson({ system: {}, devices: [] })],
    ["/object_info/UnetLoaderGGUF", () => ({ ok: false, status: 404, json: async () => ({}) })],
  ]);
  const result = await gateway.preflight.runPreflight("test-flux", { registryPath, fetchImpl });
  const models = result.checks.find((c) => c.name === "required_models");
  assert.equal(models.status, "failed");
  assert.match(models.missing.join(","), /node class not installed/);
  const nodes = result.checks.find((c) => c.name === "required_custom_nodes");
  assert.deepEqual(nodes.missing, ["UnetLoaderGGUF"]);
  assert.equal(result.ok, false);
  fs.rmSync(work, { recursive: true, force: true });
});

test("comfyui-gateway preflight: workflow drift fails preflight and preflightSync throws the coded production error", () => {
  const { work, entry, registryPath, runtimeCopy } = fixtureRegistry();
  fs.appendFileSync(runtimeCopy, " ");
  assert.throws(
    () => gateway.preflight.preflightSync("test-flux", { registryPath, driftOverride: false }),
    (e) => e.code === "comfyui_workflow_drift" && e.statusCode === 409 && /runtime copy drift/.test(e.message)
  );
  fs.rmSync(work, { recursive: true, force: true });
});

// ---- failure classification -----------------------------------------------------

test("comfyui-gateway failures: demonstrated shapes classify; unknown preserves raw evidence", () => {
  const c = gateway.failures.classifyFailure;
  assert.equal(c(new Error("connect ECONNREFUSED 127.0.0.1:8188")).failure_class, "COMFYUI_UNREACHABLE");
  assert.equal(c(new Error("connect ECONNREFUSED 192.168.50.187:8188")).failure_class, "PRESTO_UNREACHABLE");
  assert.equal(c("torch.cuda.OutOfMemoryError: CUDA out of memory. Tried to allocate 20.00 GiB").failure_class, "CUDA_OOM");
  assert.equal(c("[Errno 2] No such file or directory: 'comfy'").failure_class, "COMFY_CLI_MISSING");
  assert.equal(c("Node 7 (CLIPTextEncode) not found in workflow").failure_class, "WORKFLOW_SCHEMA_DRIFT");
  assert.equal(c("value not in list: unet_name: 'flux1-dev-Q9.gguf' not in ['flux1-dev-Q8_0.gguf']").failure_class, "MODEL_MISSING");
  assert.equal(c("ffprobe failed: moov atom not found").failure_class, "OUTPUT_INVALID");
  assert.equal(c(Object.assign(new Error("blocked"), { code: "comfyui_workflow_drift" })).failure_class, "WORKFLOW_DRIFT");
  assert.equal(c(Object.assign(new Error("blocked"), { code: "comfyui_workflow_unqualified" })).failure_class, "WORKFLOW_UNQUALIFIED");
  const unknown = c("some entirely novel failure text 0xDEADBEEF");
  assert.equal(unknown.failure_class, "UNKNOWN");
  assert.match(unknown.raw, /0xDEADBEEF/, "raw evidence preserved");
});

// ---- provenance -----------------------------------------------------------------

function fixtureWanRun(work) {
  const runDir = path.join(work, "runs", "2026-08-08-test-run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "source.png"), "SOURCEBYTES");
  fs.writeFileSync(path.join(runDir, "output.mp4"), "VIDEOBYTES");
  fs.writeFileSync(path.join(runDir, "ffprobe.json"), JSON.stringify({
    streams: [{ codec_type: "video", width: 720, height: 1280, r_frame_rate: "24/1", nb_frames: "97", codec_name: "h264" }],
    format: { duration: "4.041667" },
  }));
  fs.writeFileSync(path.join(runDir, "run.log"), JSON.stringify({
    run_id: "2026-08-08-test-run", prompt: "subtle ambient motion", seed: 12345,
    workflow: "/nas/workflows/wan22_hq.json", created_at: "2026-08-08T10:00:00Z", lane: "wan22-81f",
  }));
  return runDir;
}

test("comfyui-gateway provenance: wan run dir consolidates into a complete, atomic, re-readable manifest", () => {
  const work = tmpDir("comfyui-prov-");
  const runDir = fixtureWanRun(work);
  const entry = gateway.registry.getWorkflow("wan22-i2v-hq");
  const first = gateway.provenance.buildWanRunProvenance(runDir, { entry, packageId: "pkg-x", completedAt: "2026-08-08T11:00:00Z" });
  assert.equal(first.written, true);
  const manifest = JSON.parse(fs.readFileSync(first.path, "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.job_id, "2026-08-08-test-run");
  assert.deepEqual(manifest.workflow, { id: "wan22-i2v-hq", version: 1, sha256: entry.canonical_sha256 });
  assert.equal(manifest.parameters.prompt, "subtle ambient motion");
  assert.equal(manifest.parameters.seed, 12345);
  assert.equal(manifest.inputs.source_image.sha256, gateway.provenance.sha256File(path.join(runDir, "source.png")));
  assert.equal(manifest.output.sha256, gateway.provenance.sha256File(path.join(runDir, "output.mp4")));
  assert.deepEqual([manifest.output.width, manifest.output.height, manifest.output.fps, manifest.output.frames], [720, 1280, 24, 97]);
  assert.ok(Math.abs(manifest.output.duration_seconds - 4.04) < 0.01);
  // no secrets: the manifest never embeds process env
  assert.ok(!JSON.stringify(manifest).includes("OPENAI"), "no env leakage");
  // idempotent: second call does not overwrite
  const second = gateway.provenance.buildWanRunProvenance(runDir, { entry });
  assert.equal(second.written, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(first.path, "utf8")), manifest, "round-trip stable");
  // no temp files left behind (atomic write)
  assert.ok(!fs.readdirSync(runDir).some((f) => f.includes(".tmp")), "no temp residue");
  fs.rmSync(work, { recursive: true, force: true });
});

test("comfyui-gateway provenance: run without accepted output is skipped; since-filter selects only new runs", () => {
  const work = tmpDir("comfyui-prov2-");
  const runDir = fixtureWanRun(work);
  fs.rmSync(path.join(runDir, "output.mp4"));
  const skipped = gateway.provenance.buildWanRunProvenance(runDir, {});
  assert.equal(skipped.written, false);
  assert.match(skipped.reason, /render not accepted/);
  // an OLD run (mtime before `since`) is never touched
  const oldRun = fixtureWanRun(path.join(work, "old"));
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(oldRun, past, past);
  const outcome = gateway.provenance.buildWanProvenanceForRunsSince(path.dirname(oldRun), Date.now() - 60000, {});
  assert.equal((outcome.results || []).length, 0);
  fs.rmSync(work, { recursive: true, force: true });
});

test("comfyui-gateway provenance: flux manifest enrichment hashes outputs and records workflow identity", () => {
  const work = tmpDir("comfyui-flux-prov-");
  const img = path.join(work, "images", "flux-001.png");
  fs.mkdirSync(path.dirname(img), { recursive: true });
  fs.writeFileSync(img, "PNGBYTES");
  fs.writeFileSync(path.join(work, "flux-generation-manifest.json"), JSON.stringify({
    images: [
      { prompt_index: 1, status: "completed", output: "images/flux-001.png" },
      { prompt_index: 2, status: "failed", error_kind: "comfy_timeout" },
    ],
  }));
  const entry = gateway.registry.getWorkflow("flux-gguf-1080x1920");
  const result = gateway.provenance.buildFluxProvenance(work, { entry, packageId: "pkg-y" });
  assert.equal(result.written, true);
  const prov = JSON.parse(fs.readFileSync(result.path, "utf8"));
  assert.deepEqual(prov.workflow, { id: "flux-gguf-1080x1920", version: 1, sha256: entry.canonical_sha256 });
  assert.equal(prov.items[0].output.sha256, gateway.provenance.sha256File(img));
  assert.equal(prov.items[1].output, null);
  assert.equal(prov.items[1].error_kind, "comfy_timeout");
  // packages without a manifest are skipped honestly
  const empty = tmpDir("comfyui-flux-empty-");
  assert.equal(gateway.provenance.buildFluxProvenance(empty).written, false);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
});

// ---- server integration ----------------------------------------------------------

test("comfyui-gateway server wiring: PRESTO and FLUX dispatch are gated, routes registered", () => {
  const src = fs.readFileSync(path.join(REPO, "package-engine-server.js"), "utf8");
  assert.match(src, /getWorkflowForPrestoProfile\(config\.profile/);
  assert.match(src, /preflightSync\('flux-gguf-1080x1920'/);
  assert.match(src, /COMFYUI_WORKFLOWS_API = '\/api\/comfyui\/workflows'/);
  assert.match(src, /COMFYUI_PREFLIGHT_API = '\/api\/comfyui\/preflight'/);
  assert.match(src, /buildWanProvenanceForRunsSince/);
  assert.match(src, /buildFluxProvenance/);
});
