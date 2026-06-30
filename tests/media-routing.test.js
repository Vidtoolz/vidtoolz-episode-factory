/**
 * VIDTOOLZ Episode Factory Tests — Media routing policy + manual external import
 *
 * Covers: routing policy (local-only, no fallback, correct hosts/engines),
 * I2V prompts routed to PRESTO Ollama (no fallback to vidnux/cloud), manual
 * external image/video import provenance + dedup + no-overwrite + warnings,
 * unified media index (local + external), and backward compatibility.
 */

const {
  assert,
  fs,
  os,
  path,
  packageEngineServer,
  test,
} = require("./_helpers.js");

const routing = require("../media-routing.js");
const provenance = require("../media-provenance.js");
const { importManualMedia } = require("../manual-media-import.js");
const { buildPackageMediaIndex } = require("../package-media-index.js");

// Minimal valid PNG header carrying width/height (enough for dimension reading).
function pngBytes(w, h) {
  const b = Buffer.alloc(33);
  b[0] = 0x89; b.write("PNG", 1, "ascii"); b[4] = 0x0d; b[5] = 0x0a; b[6] = 0x1a; b[7] = 0x0a;
  b.write("IHDR", 12, "ascii"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

function tmpPackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-routing-"));
  const pkg = path.join(root, "pkg");
  fs.mkdirSync(pkg, { recursive: true });
  return { root, pkg };
}

// ── Routing policy ──────────────────────────────────────────────────────────

test("routing: image prompts route to vidnux Ollama, local, no fallback", () => {
  const lane = routing.getLane(routing.LANE.IMAGE_PROMPT);
  assert.equal(lane.host, "vidnux");
  assert.equal(lane.engine, "ollama");
  assert.equal(lane.locality, "local");
  assert.equal(lane.fallback_allowed, false);
  assert.equal(routing.isExternalAllowed(routing.LANE.IMAGE_PROMPT), false);
  assert.equal(routing.assertLocalLane(routing.LANE.IMAGE_PROMPT), true);
});

test("routing: T2I routes to vidnux ComfyUI, local, no fallback", () => {
  const lane = routing.getLane(routing.LANE.TEXT_TO_IMAGE);
  assert.equal(lane.host, "vidnux");
  assert.equal(lane.engine, "comfyui");
  assert.equal(lane.fallback_allowed, false);
});

test("routing: I2V prompts route to PRESTO Ollama, distinct from vidnux, no fallback", () => {
  const lane = routing.getLane(routing.LANE.I2V_PROMPT);
  assert.equal(lane.host, "presto");
  assert.equal(lane.engine, "ollama");
  assert.equal(lane.fallback_allowed, false);
  const prestoEndpoint = routing.resolveEndpoint(routing.LANE.I2V_PROMPT, {});
  const vidnuxEndpoint = routing.resolveEndpoint(routing.LANE.IMAGE_PROMPT, {});
  assert.notEqual(prestoEndpoint, vidnuxEndpoint);
  assert.match(prestoEndpoint, /192\.168\.50\.187/);
});

test("routing: video gen routes to PRESTO ComfyUI, no fallback", () => {
  const lane = routing.getLane(routing.LANE.IMAGE_TO_VIDEO);
  assert.equal(lane.host, "presto");
  assert.equal(lane.engine, "comfyui");
  assert.equal(lane.fallback_allowed, false);
});

test("routing: manual external lanes allow import but not automation", () => {
  for (const name of [routing.LANE.MANUAL_IMAGE, routing.LANE.MANUAL_VIDEO]) {
    const lane = routing.getLane(name);
    assert.equal(lane.actor, "human_operator");
    assert.equal(lane.automation_allowed, false);
    assert.equal(lane.import_allowed, true);
  }
});

test("routing: env overrides endpoint but never enables fallback", () => {
  const custom = routing.resolveEndpoint(routing.LANE.I2V_PROMPT, { OLLAMA_PRESTO_URL: "http://10.0.0.9:11434/" });
  assert.equal(custom, "http://10.0.0.9:11434");
  assert.equal(routing.isFallbackAllowed(routing.LANE.I2V_PROMPT), false);
});

test("routing: blockedError is a 503 blocked state with routing detail", () => {
  const err = routing.blockedError(routing.LANE.IMAGE_TO_VIDEO, "PRESTO ComfyUI is down.");
  assert.equal(err.statusCode, 503);
  assert.equal(err.statusCategory, "blocked");
  assert.equal(err.routing.host, "presto");
});

test("routing: provenanceFor yields correct provenance per lane", () => {
  const img = routing.provenanceFor(routing.LANE.TEXT_TO_IMAGE);
  assert.equal(img.generation_mode, "local");
  assert.equal(img.generation_host, "vidnux");
  assert.equal(img.variant, "flux-local");
  const vid = routing.provenanceFor(routing.LANE.IMAGE_TO_VIDEO);
  assert.equal(vid.prompt_host, "presto");
  assert.equal(vid.variant, "wan22-local");
  const man = routing.provenanceFor(routing.LANE.MANUAL_IMAGE);
  assert.equal(man.generation_mode, "manual_external");
  assert.equal(man.generation_provider, "gpt_manual");
});

// ── Server routing status ─────────────────────────────────────────────────

test("server: buildMediaRoutingStatus exposes 6 lanes with hosts, openai disabled", () => {
  const status = packageEngineServer.buildMediaRoutingStatus();
  assert.equal(Object.keys(status.lanes).length, 6);
  assert.equal(status.lanes.i2v_prompt_generation.host, "presto");
  assert.equal(status.lanes.text_to_image_generation.host, "vidnux");
  assert.equal(status.openai_image_generation, "disabled");
  assert.ok(status.lanes.image_to_video_generation.label.includes("PRESTO"));
});

// ── I2V prompts route to PRESTO Ollama; no fallback ─────────────────────────

test("generateI2vPrompts calls the PRESTO Ollama endpoint and tags provenance", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ prompts: ["slow zoom", "pan left", "push in"] }) } }),
    };
  };
  const result = await packageEngineServer.generateI2vPrompts(
    { script: "A short monologue about proof.", count: 3 },
    { fetchImpl },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /192\.168\.50\.187:11434\/api\/chat/);
  assert.equal(result.prompt_host, "presto");
  assert.equal(result.prompt_type, "image_to_video");
  assert.equal(result.prompts.length, 3);
});

test("generateI2vPrompts blocks (no fallback) when PRESTO Ollama is unreachable", async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    const e = new Error("fetch failed");
    e.cause = { code: "ECONNREFUSED" };
    throw e;
  };
  await assert.rejects(
    packageEngineServer.generateI2vPrompts({ script: "x", count: 2 }, { fetchImpl }),
    (err) => err.statusCode === 503 && /192\.168\.50\.187/.test(err.message),
  );
  assert.equal(count, 1); // exactly one attempt — never retried against another host
});

// ── Manual external image import ────────────────────────────────────────────

test("import manual images: provenance, dedup, no-overwrite, warnings", () => {
  const { pkg } = tmpPackage();
  const drop = path.join(pkg, "imports", "manual-images");
  fs.mkdirSync(drop, { recursive: true });
  fs.writeFileSync(path.join(drop, "gpt-006.png"), pngBytes(1080, 1920));
  fs.writeFileSync(path.join(drop, "gpt-bad.png"), pngBytes(800, 600));
  // Pre-existing LOCAL file with a name that would collide if we flattened naively.
  fs.mkdirSync(path.join(pkg, "images", "gpt-manual"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "images", "gpt-manual", "gpt-006.png"), pngBytes(1, 1));

  const dry = importManualMedia({ package: pkg, kind: "image", dryRun: true, now: "2026-06-30T00:00:00Z" });
  assert.equal(dry.wouldImport.length, 2);
  assert.equal(fs.existsSync(path.join(pkg, "external-media-manifest.json")), false);

  const real = importManualMedia({ package: pkg, kind: "image", now: "2026-06-30T00:00:00Z" });
  assert.equal(real.imported.length, 2);
  assert.equal(real.imported[0].generation_mode, "manual_external");
  assert.equal(real.imported[0].generation_provider, "gpt_manual");
  // The pre-existing local file must not be overwritten — collision got a suffix.
  assert.equal(fs.readFileSync(path.join(pkg, "images", "gpt-manual", "gpt-006.png")).length, pngBytes(1, 1).length);
  const bad = real.imported.find((e) => e.original_filename === "gpt-bad.png");
  assert.ok(bad.validation.warnings.length >= 1);

  // Re-run is idempotent (content-hash dedup).
  const again = importManualMedia({ package: pkg, kind: "image", now: "2026-06-30T00:00:01Z" });
  assert.equal(again.imported.length, 0);
  assert.equal(again.duplicates.length, 2);
});

// ── Manual external video import ────────────────────────────────────────────

test("import manual videos: klingai provenance + ffprobe warnings", () => {
  const { pkg } = tmpPackage();
  const drop = path.join(pkg, "imports", "manual-videos");
  fs.mkdirSync(drop, { recursive: true });
  fs.writeFileSync(path.join(drop, "kling-001.mp4"), "FAKEVIDEO");
  // ffprobe mock reporting a wrong-resolution, wrong-fps clip.
  const ffprobe = () => ({ duration: 4.0, codec: "h264", resolution: "1280x720", frameRate: 24, audioPresent: false, metadataUnavailable: false });
  const res = importManualMedia({ package: pkg, kind: "video", ffprobe, now: "2026-06-30T00:00:00Z" });
  assert.equal(res.imported.length, 1);
  const e = res.imported[0];
  assert.equal(e.generation_mode, "manual_external");
  assert.equal(e.generation_provider, "klingai_manual");
  assert.equal(e.variant, "klingai-manual");
  assert.ok(e.validation.warnings.some((w) => /Resolution/.test(w)));
  assert.ok(e.validation.warnings.some((w) => /Frame rate/.test(w)));
});

// ── Unified media index (local + external) ──────────────────────────────────

test("buildPackageMediaIndex merges local FLUX + external GPT media with provenance", () => {
  const { pkg } = tmpPackage();
  // Local FLUX image via flux-generation-manifest.json + on-disk file.
  fs.mkdirSync(path.join(pkg, "images", "flux-local"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "images", "flux-local", "flux-006.png"), pngBytes(1080, 1920));
  fs.writeFileSync(path.join(pkg, "flux-generation-manifest.json"), JSON.stringify({
    workflow: "flux-gguf-1080x1920.json",
    items: [{ prompt_index: 6, status: "complete", output_path: "images/flux-local/flux-006.png" }],
  }));
  // Local Wan2.2 video.
  fs.mkdirSync(path.join(pkg, "videos", "mp4"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "videos", "mp4", "006.mp4"), "VID");
  // Imported external image.
  const drop = path.join(pkg, "imports", "manual-images");
  fs.mkdirSync(drop, { recursive: true });
  fs.writeFileSync(path.join(drop, "gpt-007.png"), pngBytes(1080, 1920));
  importManualMedia({ package: pkg, kind: "image", now: "2026-06-30T00:00:00Z" });

  const index = buildPackageMediaIndex(pkg);
  assert.equal(index.counts.images_local, 1);
  assert.equal(index.counts.images_external, 1);
  assert.equal(index.counts.videos_local, 1);
  const flux = index.images.find((m) => m.variant === "flux-local");
  assert.equal(flux.generation_host, "vidnux");
  const ext = index.images.find((m) => m.variant === "gpt-manual");
  assert.equal(ext.generation_mode, "manual_external");
  const vid = index.videos.find((m) => m.variant === "wan22-local");
  assert.equal(vid.generation_host, "presto");
});

// ── Backward compatibility ──────────────────────────────────────────────────

test("buildPackageMediaIndex loads a legacy package with only flux manifest (no external sidecar)", () => {
  const { pkg } = tmpPackage();
  fs.writeFileSync(path.join(pkg, "flux-generation-manifest.json"), JSON.stringify({
    items: [{ prompt_index: 1, status: "complete", output_path: "images/flux-local/flux-001.png" }],
  }));
  const index = buildPackageMediaIndex(pkg);
  assert.equal(index.counts.images_local, 1);
  assert.equal(index.counts.images_external, 0);
  assert.equal(index.images[0].generation_mode, "local");
});

test("provenance: inferProvenance classifies legacy paths without explicit records", () => {
  assert.equal(provenance.inferProvenance("images/flux-local/flux-001.png").variant, "flux-local");
  assert.equal(provenance.inferProvenance("videos/mp4/001.mp4").generation_host, "presto");
  assert.equal(provenance.inferProvenance("images/gpt-manual/x.png").generation_mode, "manual_external");
  assert.equal(provenance.inferProvenance("whatever.png").generation_mode, "unknown");
});
