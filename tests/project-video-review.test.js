/**
 * VIDTOOLZ Episode Factory Tests — project-scoped video review.
 *
 * Pure helpers (validation spec / decision normalize / summary / merge), the
 * GET context + POST save endpoints (mapping clips ↔ source images ↔ I2V prompts
 * ↔ ffprobe validation ↔ saved decisions), the workspace page, and the action
 * registry mapping. Mutation tests use a temp AIGEN root only.
 */

const { assert, fs, http, os, path, child_process, packageEngineServer, test } = require("./_helpers.js");
const cp = child_process || require("child_process");

const pvr = require("../project-video-review.js");
const { resolveAction } = require("../project-action-registry.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SELECTED_INDICES = [2, 9, 10, 17, 19, 21, 22, 23, 24, 25];

function makeSelections(indices) {
  return indices.map((idx, i) => ({
    prompt_index: idx, index: idx, selected_source: "flux-local",
    selected_path: `images/flux-local/flux-${pvr.zeroPad3(idx)}.png`,
    path: `images/flux-local/flux-${pvr.zeroPad3(idx)}.png`,
    prompt: `Source scene ${idx}`, label: `flux-${pvr.zeroPad3(idx)}`,
  }));
}

let ffmpegOk = false;
try { ffmpegOk = cp.spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0; } catch (_) { ffmpegOk = false; }

function writeSpecClip(absPath) {
  // Generate a real 1080x1920 / 30fps / 81-frame clip so ffprobe validation passes.
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const r = cp.spawnSync("ffmpeg", ["-y", "-v", "quiet", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=2.7:r=30", "-frames:v", "81", "-pix_fmt", "yuv420p", absPath], { encoding: "utf8" });
  return r.status === 0 && fs.existsSync(absPath);
}

function createPackage(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-"));
  const aigenRoot = path.join(root, "aigen");
  const scriptPackages = path.join(aigenRoot, "script-packages");
  const packageId = opts.packageId || "demo-video-review";
  const pkg = path.join(scriptPackages, packageId);
  fs.mkdirSync(path.join(pkg, "script"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Demo VR" } }));
  fs.writeFileSync(path.join(pkg, "script", "script-final.md"), "# Final\n" + "x".repeat(160));
  const indices = opts.indices || SELECTED_INDICES;
  fs.writeFileSync(path.join(pkg, "selected-images.json"), JSON.stringify({ version: 1, selections: makeSelections(indices) }));
  if (opts.videoPrompts !== false) {
    fs.writeFileSync(path.join(pkg, "video-prompts.json"), JSON.stringify({
      version: 1, prompt_type: "image_to_video",
      prompts: indices.map((idx) => ({ prompt_index: idx, prompt: `motion prompt ${idx}` })),
    }));
  }
  // Write a clip file per index, except any in opts.omit. The first one is a real
  // spec clip (if ffmpeg is available) so ffprobe validation can be asserted.
  // opts.videoVariant stages clips in videos/<variant>/ (default legacy mp4).
  const mp4Dir = path.join(pkg, "videos", opts.videoVariant || "mp4");
  fs.mkdirSync(mp4Dir, { recursive: true });
  indices.forEach((idx, i) => {
    if ((opts.omit || []).includes(idx)) return;
    const f = path.join(mp4Dir, `${pvr.zeroPad3(idx)}.mp4`);
    if (i === 0 && ffmpegOk && opts.realFirst !== false) { writeSpecClip(f); }
    else { fs.writeFileSync(f, "placeholder"); }
  });
  return { root, aigenRoot, scriptPackages, packageId, pkg, indices };
}

function listen(s) { return new Promise((r) => s.listen(0, "127.0.0.1", r)); }
function close(s) { return new Promise((r) => s.close(r)); }
function requestJson(server, pathname, options = {}) {
  const a = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const headers = Object.assign(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}, options.headers || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: a.port, path: pathname, method: options.method || "GET", headers }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => { raw += c; });
      res.on("end", () => { try { resolve({ statusCode: res.statusCode, body: JSON.parse(raw) }); } catch (e) { reject(e); } });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
function localWriteHeaders(extra) { return Object.assign({ Host: "127.0.0.1:8010", [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() }, extra || {}); }
function withEnv(fx, fn) {
  const prev = { r: process.env.AIGEN_VIDNAS_ROOT, s: process.env.AIGEN_SCRIPT_PACKAGES };
  process.env.AIGEN_VIDNAS_ROOT = fx.aigenRoot; process.env.AIGEN_SCRIPT_PACKAGES = fx.scriptPackages;
  return Promise.resolve().then(fn).finally(() => {
    if (prev.r === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = prev.r;
    if (prev.s === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.s;
  });
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

test("pvr: buildValidation flags off-spec clips and missing files", () => {
  const ok = pvr.buildValidation({ width: 1080, height: 1920, fps: 30, frames: 81, duration: 2.7 });
  assert.equal(ok.exists, true);
  assert.equal(ok.warnings.length, 0);
  const bad = pvr.buildValidation({ width: 1920, height: 1080, fps: 24, frames: 60, duration: 5 });
  assert.equal(bad.exists, true);
  assert.ok(bad.warnings.length >= 3, "off-spec warnings");
  const missing = pvr.buildValidation(null);
  assert.equal(missing.exists, false);
  assert.equal(missing.spec_known, false);
  assert.match(missing.warnings[0], /missing/i);
});

test("pvr: a present clip whose spec can't be probed stays viewable (exists, spec_known:false), not 'missing'", () => {
  // probe null but the file is on disk (ffprobe failed/timed out) → the clip must
  // NOT be reported as missing; it stays exists:true so mp4_url is served/playable.
  const v = pvr.buildValidation(null, undefined, true);
  assert.equal(v.exists, true, "file present → viewable");
  assert.equal(v.spec_known, false, "spec could not be read");
  assert.match(v.warnings[0], /could not be read|playable/i);
  assert.doesNotMatch(v.warnings.join(" "), /file is missing/i);
  // A genuinely absent file is still reported missing.
  const gone = pvr.buildValidation(null, undefined, false);
  assert.equal(gone.exists, false);
});

test("pvr: mp4RelPath zero-pads prompt_index", () => {
  assert.equal(pvr.mp4RelPath(2), "videos/mp4/002.mp4");
  assert.equal(pvr.mp4RelPath(25), "videos/mp4/025.mp4");
});

test("pvr: mp4RelPath accepts a video variant folder", () => {
  assert.equal(pvr.mp4RelPath(2, "mp4-hq-720p"), "videos/mp4-hq-720p/002.mp4");
  assert.equal(pvr.mp4RelPath(25, "mp4"), "videos/mp4/025.mp4");
});

test("pvr: expectedForVariant returns the HQ contract for mp4-hq-720p", () => {
  assert.deepEqual(pvr.expectedForVariant("mp4"), pvr.EXPECTED);
  const hq = pvr.expectedForVariant("mp4-hq-720p");
  assert.deepEqual(hq, { width: 720, height: 1280, fps: 25, frames: 101, duration: 4.04 });
  // Unknown variants fall back to the legacy fast contract.
  assert.deepEqual(pvr.expectedForVariant("nonexistent"), pvr.EXPECTED);
});

test("pvr: buildValidation validates against a variant-specific expected spec", () => {
  const hq = pvr.expectedForVariant("mp4-hq-720p");
  const ok = pvr.buildValidation({ width: 720, height: 1280, fps: 25, frames: 101, duration: 4.04 }, hq);
  assert.equal(ok.warnings.length, 0, `HQ-spec clip must not warn: ${ok.warnings.join(" | ")}`);
  // The same probe against the default (fast) spec warns on every axis.
  const wrongSpec = pvr.buildValidation({ width: 720, height: 1280, fps: 25, frames: 101, duration: 4.04 });
  assert.ok(wrongSpec.warnings.length >= 3, "HQ clip vs fast spec should warn");
});

test("pvr: normalizeReviewSave validates decisions and prompt_index", () => {
  const ok = pvr.normalizeReviewSave([{ prompt_index: 2, decision: "keep", notes: "good" }, { prompt_index: 9, decision: "reject" }]);
  assert.equal(ok.length, 2);
  assert.throws(() => pvr.normalizeReviewSave([{ prompt_index: 2, decision: "maybe" }]), (e) => e.statusCode === 400 && /Invalid decision/.test(e.message));
  assert.throws(() => pvr.normalizeReviewSave([{ prompt_index: 0, decision: "keep" }]), (e) => e.statusCode === 400);
  assert.throws(() => pvr.normalizeReviewSave([{ prompt_index: 2, decision: "keep" }, { prompt_index: 2, decision: "flag" }]), (e) => e.statusCode === 400 && /Duplicate/.test(e.message));
  assert.throws(() => pvr.normalizeReviewSave("nope"), (e) => e.statusCode === 400);
});

test("pvr: summarizeCounts + usability thresholds", () => {
  const clips = [{ review: { decision: "keep" } }, { review: { decision: "keep" } }, { review: { decision: "flag" } }, { review: { decision: "unreviewed" } }];
  const c = pvr.summarizeCounts(clips);
  assert.deepEqual(c, { clips: 4, keep: 2, flag: 1, reject: 0, unreviewed: 1 });
  assert.equal(pvr.usability({ keep: 0 }).usable, false);
  assert.equal(pvr.usability({ keep: 2 }).usable, true);
  assert.equal(pvr.usability({ keep: 2 }).recommended, false);
  assert.equal(pvr.usability({ keep: 6 }).recommended, true);
});

test("pvr: mergeReviews lets a new batch override prior decisions", () => {
  const merged = pvr.mergeReviews([{ prompt_index: 2, decision: "flag", notes: "old" }], [{ prompt_index: 2, decision: "keep", notes: "new" }, { prompt_index: 9, decision: "reject", notes: "" }]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((r) => r.prompt_index === 2).decision, "keep");
});

// ── GET endpoint ────────────────────────────────────────────────────────────────

test("video-review GET: returns one clip per selection mapped to mp4 + source + prompt", async () => {
  const fx = createPackage({ indices: [2, 9, 10] });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      assert.equal(res.statusCode, 200);
      const d = res.body.data;
      assert.equal(d.clips.length, 3);
      assert.equal(d.counts.clips, 3);
      const c0 = d.clips[0];
      assert.equal(c0.prompt_index, 2);
      assert.equal(c0.mp4_path, "videos/mp4/002.mp4");
      assert.match(c0.mp4_url, /\/aigen-assets\/script-packages\/demo-video-review\/videos\/mp4\/002\.mp4$/);
      assert.equal(c0.source_image_path, "images/flux-local/flux-002.png");
      assert.match(c0.source_image_url, /\/aigen-assets\/script-packages\/.*flux-002\.png$/);
      assert.equal(c0.i2v_prompt, "motion prompt 2");
      assert.equal(c0.review.decision, "unreviewed");
      assert.equal(d.handoff_consumes_review, false);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: real spec clip validates 1080x1920/30/81 (ffmpeg)", async function () {
  if (!ffmpegOk) { return; } // hermetic skip when ffmpeg is unavailable
  const fx = createPackage({ indices: [2, 9] });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      const c0 = res.body.data.clips[0]; // index 0 was written as a real spec clip
      assert.equal(c0.validation.exists, true);
      assert.equal(c0.validation.width, 1080);
      assert.equal(c0.validation.height, 1920);
      assert.equal(Math.round(c0.validation.fps), 30);
      assert.equal(c0.validation.frames, 81);
      assert.equal(c0.validation.warnings.length, 0);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: HQ-only package auto-detects mp4-hq-720p and uses the HQ spec", async () => {
  const fx = createPackage({ indices: [2, 9, 10], videoVariant: "mp4-hq-720p", realFirst: false });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      assert.equal(res.statusCode, 200);
      const d = res.body.data;
      assert.equal(d.video_variant, "mp4-hq-720p");
      assert.deepEqual(d.expected, { width: 720, height: 1280, fps: 25, frames: 101, duration: 4.04 });
      assert.equal(d.clips.length, 3);
      // Every clip path must resolve inside the HQ variant folder, never videos/mp4/.
      for (const clip of d.clips) {
        assert.match(clip.mp4_path, /^videos\/mp4-hq-720p\//);
      }
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: symlinked clips count as staged (variant detection + counts)", async () => {
  // NAS pipelines may stage clips as symlinks; Dirent.isFile() is false for
  // symlinks, so a naive gate would report an HQ-only symlinked package as
  // "nothing staged" everywhere.
  const fx = createPackage({ indices: [2, 9], realFirst: false });
  fs.rmSync(path.join(fx.pkg, "videos", "mp4"), { recursive: true, force: true }); // HQ-only
  const realDir = path.join(fx.pkg, "clip-masters");
  const hqDir = path.join(fx.pkg, "videos", "mp4-hq-720p");
  fs.mkdirSync(realDir, { recursive: true });
  fs.mkdirSync(hqDir, { recursive: true });
  for (const idx of [2, 9]) {
    const target = path.join(realDir, `${pvr.zeroPad3(idx)}.mp4`);
    fs.writeFileSync(target, "placeholder");
    fs.symlinkSync(target, path.join(hqDir, `${pvr.zeroPad3(idx)}.mp4`));
  }
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      assert.equal(res.body.data.video_variant, "mp4-hq-720p");
      const best = packageEngineServer.packageBestStagedWanStatus(fx.pkg);
      assert.equal(best.videoVariant, "mp4-hq-720p");
      assert.equal(best.completedCount, 2, "symlinked clips must count as staged");
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: coverage tie defers to the handoff's recorded variant (delivery lane)", async () => {
  // Both lanes fully staged (10/10 tie) — without a handoff the tie-break
  // prefers legacy mp4, but an HQ handoff means HQ is the delivery lane and
  // the review must show THOSE clips.
  const fx = createPackage({ indices: [2, 9], realFirst: false }); // stages videos/mp4/
  const hqDir = path.join(fx.pkg, "videos", "mp4-hq-720p");
  fs.mkdirSync(hqDir, { recursive: true });
  for (const idx of [2, 9]) fs.writeFileSync(path.join(hqDir, `${pvr.zeroPad3(idx)}.mp4`), "placeholder");
  fs.mkdirSync(path.join(fx.pkg, "resolve-handoff"), { recursive: true });
  fs.writeFileSync(
    path.join(fx.pkg, "resolve-handoff", "media-manifest.json"),
    JSON.stringify({ video_variant: "mp4-hq-720p", clips: [] })
  );
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      assert.equal(res.body.data.video_variant, "mp4-hq-720p");
      assert.match(res.body.data.clips[0].mp4_path, /^videos\/mp4-hq-720p\//);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: handoff variant never wins with LESS coverage than the best lane", async () => {
  // Handoff records HQ but the HQ folder has fewer clips than mp4 → keep mp4.
  const fx = createPackage({ indices: [2, 9], realFirst: false });
  const hqDir = path.join(fx.pkg, "videos", "mp4-hq-720p");
  fs.mkdirSync(hqDir, { recursive: true });
  fs.writeFileSync(path.join(hqDir, "002.mp4"), "placeholder"); // only 1 of 2
  fs.mkdirSync(path.join(fx.pkg, "resolve-handoff"), { recursive: true });
  fs.writeFileSync(
    path.join(fx.pkg, "resolve-handoff", "media-manifest.json"),
    JSON.stringify({ video_variant: "mp4-hq-720p", clips: [] })
  );
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      assert.equal(res.body.data.video_variant, "mp4");
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: explicit ?variant= overrides detection and rejects traversal", async () => {
  const fx = createPackage({ indices: [2], realFirst: false }); // clips staged in legacy mp4
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const forced = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}&variant=mp4-hq-720p`);
      assert.equal(forced.body.data.video_variant, "mp4-hq-720p");
      assert.equal(forced.body.data.clips[0].validation.exists, false); // nothing staged there
      const bad = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}&variant=${encodeURIComponent("../../etc")}`);
      assert.equal(bad.statusCode, 400);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: missing MP4 yields a validation warning (no crash)", async () => {
  const fx = createPackage({ indices: [2, 9, 10], omit: [10], realFirst: false });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      const missing = res.body.data.clips.find((c) => c.prompt_index === 10);
      assert.equal(missing.validation.exists, false);
      assert.equal(missing.mp4_url, "");
      assert.ok(missing.validation.warnings.length >= 1);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: missing video-prompts.json degrades gracefully (empty i2v_prompt)", async () => {
  const fx = createPackage({ indices: [2], videoPrompts: false, realFirst: false });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.clips[0].i2v_prompt, "");
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: reads existing video-review.json decisions", async () => {
  const fx = createPackage({ indices: [2, 9], realFirst: false });
  fs.writeFileSync(path.join(fx.pkg, "video-review.json"), JSON.stringify({ version: 1, reviews: [{ prompt_index: 2, decision: "keep", notes: "nice" }] }));
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${fx.packageId}`);
      const c = res.body.data.clips.find((x) => x.prompt_index === 2);
      assert.equal(c.review.decision, "keep");
      assert.equal(c.review.notes, "nice");
      assert.equal(res.body.data.counts.keep, 1);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review GET: rejects traversal id (400) and missing project (404)", async () => {
  const fx = createPackage({ indices: [2], realFirst: false });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const bad = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=${encodeURIComponent("../escape")}`);
      assert.equal(bad.statusCode, 400);
      const missing = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_REVIEW_API}?id=does-not-exist`);
      assert.equal(missing.statusCode, 404);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// ── POST save ────────────────────────────────────────────────────────────────

test("video-review save: writes video-review.json, merges, and tallies", async () => {
  const fx = createPackage({ indices: [2, 9], realFirst: false });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_VIDEO_REVIEW_SAVE_API, {
        method: "POST", headers: localWriteHeaders(),
        body: { id: fx.packageId, reviews: [{ prompt_index: 2, decision: "keep", notes: "usable" }, { prompt_index: 9, decision: "reject" }] },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.review_count, 2);
      assert.equal(res.body.data.counts.keep, 1);
      const saved = JSON.parse(fs.readFileSync(path.join(fx.pkg, "video-review.json"), "utf8"));
      assert.equal(saved.reviews.length, 2);
      assert.equal(saved.reviews.find((r) => r.prompt_index === 2).decision, "keep");
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("video-review save: rejects invalid decision (400), traversal (400), and missing nonce (403)", async () => {
  const fx = createPackage({ indices: [2], realFirst: false });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const badDecision = await requestJson(server, packageEngineServer.PROJECT_VIDEO_REVIEW_SAVE_API, {
        method: "POST", headers: localWriteHeaders(), body: { id: fx.packageId, reviews: [{ prompt_index: 2, decision: "delete" }] },
      });
      assert.equal(badDecision.statusCode, 400);
      const traversal = await requestJson(server, packageEngineServer.PROJECT_VIDEO_REVIEW_SAVE_API, {
        method: "POST", headers: localWriteHeaders(), body: { id: "../escape", reviews: [{ prompt_index: 2, decision: "keep" }] },
      });
      assert.equal(traversal.statusCode, 400);
      const noNonce = await requestJson(server, packageEngineServer.PROJECT_VIDEO_REVIEW_SAVE_API, {
        method: "POST", headers: { Host: "127.0.0.1:8010" }, body: { id: fx.packageId, reviews: [] },
      });
      assert.equal(noNonce.statusCode, 403);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// ── Registry + static page ─────────────────────────────────────────────────────

test("video-review registry: review_videos opens project-video-review.html (not legacy)", () => {
  const a = resolveAction("review_videos", "demo-id");
  assert.equal(a.type, "open");
  assert.match(a.href, /^project-video-review\.html\?/);
  assert.match(a.href, /id=demo-id/);
  assert.doesNotMatch(a.href, /aigen-review\.html|production-pipeline\.html/);
});

test("video-review page: project-video-review.html has players, decisions, links, no 8099", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-video-review.html"), "utf8");
  assert.match(html, /\/api\/project\/video-review/);
  assert.match(html, /<video/);
  assert.match(html, /data-decision="keep"/);
  assert.match(html, /data-decision="flag"/);
  assert.match(html, /data-decision="reject"/);
  assert.match(html, /project-workspace\.html\?id=/);
  assert.match(html, /project-focus\.html\?id=/);
  assert.doesNotMatch(html, /8099/); // no legacy review-view dependency
});

// ── Video variants API + edit-start page ─────────────────────────────────────

test("video-variants API: lists populated lanes with coverage, handoff and best flags", async () => {
  const fx = createPackage({ indices: [2, 9], realFirst: false }); // videos/mp4/ staged
  const hqDir = path.join(fx.pkg, "videos", "mp4-hq-720p");
  fs.mkdirSync(hqDir, { recursive: true });
  for (const idx of [2, 9]) fs.writeFileSync(path.join(hqDir, `${pvr.zeroPad3(idx)}.mp4`), "x");
  fs.mkdirSync(path.join(fx.pkg, "resolve-handoff"), { recursive: true });
  fs.writeFileSync(path.join(fx.pkg, "resolve-handoff", "media-manifest.json"), JSON.stringify({ video_variant: "mp4-hq-720p", clips: [] }));
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_VIDEO_VARIANTS_API}?id=${fx.packageId}`);
      assert.equal(res.statusCode, 200);
      const d = res.body.data;
      assert.equal(d.handoff_video_variant, "mp4-hq-720p");
      assert.equal(d.best_variant, "mp4-hq-720p"); // handoff wins the coverage tie
      const names = d.variants.map((v) => v.name).sort();
      assert.deepEqual(names, ["mp4", "mp4-hq-720p"]);
      const hq = d.variants.find((v) => v.name === "mp4-hq-720p");
      assert.equal(hq.completed, 2);
      assert.equal(hq.is_handoff_variant, true);
      assert.equal(hq.is_best, true);
      const fast = d.variants.find((v) => v.name === "mp4");
      assert.equal(fast.is_default, true);
      assert.equal(fast.is_handoff_variant, false);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("edit-start page: project-resolve-handoff.html shows handoff, lanes, Resolve steps, and the action", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-resolve-handoff.html"), "utf8");
  assert.match(html, /\/api\/project\/video-variants/);
  assert.match(html, /aigen-assets\/script-packages/); // reads the real manifest
  assert.match(html, /resolve-handoff\/media-manifest\.json/);
  assert.match(html, /renderAction/); // Mark-editing via the gated action registry
  assert.match(html, /project-client\.js/);
  assert.match(html, /1080x1920/); // timeline guidance
  assert.match(html, /720x1280/);  // clip scaling guidance
  assert.match(html, /page-guide/);
  assert.doesNotMatch(html, /8099/);
});

test("review page links to the project-scoped handoff page, not the global pipeline page", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-video-review.html"), "utf8");
  assert.match(html, /project-resolve-handoff\.html\?id=/);
  assert.match(html, /\/api\/project\/video-variants/); // lane pills
  assert.match(html, /variant-pills/);
});

test("workspace links to the edit-start page when a handoff exists", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-workspace.html"), "utf8");
  assert.match(html, /project-resolve-handoff\.html\?id=/);
});
