const {
  assert,
  fs,
  http,
  os,
  path,
  packageEngineServer,
  test,
} = require("./_helpers.js");
const aigenAuthority = require("../aigen-authority-chain.js");
const crypto = require("crypto");

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function createAigenFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aigen-resolve-"));
  const aigenRoot = path.join(root, "aigen");
  const packageId = options.packageId || "vidtoolz-youtube-ideas-20260611";
  const packageDir = path.join(aigenRoot, "script-packages", packageId);
  const fluxDir = path.join(packageDir, "images", "flux-local");
  const wanLane = path.join(aigenRoot, "image-to-video", "production", "wan22-81f");
  const scriptsDir = path.join(aigenRoot, "scripts");
  const topicToPackageScript = path.join(scriptsDir, "topic-to-package.py");
  fs.mkdirSync(fluxDir, { recursive: true });
  fs.mkdirSync(wanLane, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const index of [6, 8]) {
    fs.writeFileSync(path.join(fluxDir, `flux-${index.toString().padStart(3, "0")}.png`), "png", "utf8");
  }
  // Stage package-facing MP4s for both selections unless the test wants to
  // exercise the "Resolve blocked while MP4s pending" guard.
  if (!options.missingStagedMp4) {
    const mp4Dir = path.join(packageDir, "videos", "mp4");
    fs.mkdirSync(mp4Dir, { recursive: true });
    for (const index of [6, 8]) {
      fs.writeFileSync(path.join(mp4Dir, `${index.toString().padStart(3, "0")}.mp4`), "mp4", "utf8");
    }
  }
  writeJson(path.join(packageDir, "selected-images.json"), {
    version: 1,
    selections: [
      { prompt_index: 6, selected_path: "images/flux-local/flux-006.png" },
      { prompt_index: 8, selected_path: "images/flux-local/flux-008.png" },
    ],
  });
  writeJson(path.join(packageDir, "image-prompts.json"), {
    image_prompts: [
      { index: 6, prompt: "prompt 6" },
      { index: 8, prompt: "prompt 8" },
    ],
  });
  fs.mkdirSync(path.join(packageDir, "script"), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "script", "script-final.md"),
    `# Final Script\n\n${"Approved authority fixture. ".repeat(10)}\n`,
    "utf8"
  );
  writeJson(path.join(packageDir, "video-prompts.json"), {
    prompts: [
      { prompt_index: 6, prompt: "Slow push in with subtle environmental motion." },
      { prompt_index: 8, prompt: "Gentle parallax with stable subject framing." },
    ],
  });
  aigenAuthority.recordStage(packageDir, "image_prompts");
  aigenAuthority.recordStage(packageDir, "selected_images");
  aigenAuthority.recordStage(packageDir, "i2v_prompts");
  if (!options.missingStagedMp4) {
    aigenAuthority.recordVideoSlots(packageDir, { variant: "mp4", indexes: [6, 8] });
  }
  fs.writeFileSync(
    path.join(wanLane, "completed.txt"),
    [
      JSON.stringify({ label: "flux-006", timestamp: "2026-06-11T04:05:00+00:00" }),
      JSON.stringify({ label: "flux-008", timestamp: "2026-06-11T04:10:00+00:00" }),
      "",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(path.join(wanLane, "failed.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(wanLane, "queue.txt"), "", "utf8");
  fs.writeFileSync(
    topicToPackageScript,
    [
      "import json, pathlib, sys",
      "pkg = pathlib.Path(sys.argv[sys.argv.index('--package') + 1])",
      "out = pkg / 'resolve-handoff'",
      "out.mkdir(parents=True, exist_ok=True)",
      "(out / 'assembly-plan.md').write_text('# Assembly\\n', encoding='utf-8')",
      "(out / 'assembly-plan.csv').write_text('order,prompt_index\\n', encoding='utf-8')",
      "excluded = set(int(x) for x in (sys.argv[sys.argv.index('--exclude') + 1].split(',') if '--exclude' in sys.argv else []) if x)",
      "clips = [{'prompt_index': i} for i in (6, 8) if i not in excluded]",
      "(out / 'media-manifest.json').write_text(json.dumps({'clips': clips}) + '\\n', encoding='utf-8')",
      ...(options.mutateDuringAssembly ? ["(pkg / 'videos' / 'mp4' / '006.mp4').write_text('replacement bytes', encoding='utf-8')"] : []),
      ...(options.mutateReviewDuringAssembly ? ["(pkg / 'video-review.json').write_text('{\\\"reviews\\\": []}', encoding='utf-8')"] : []),
    ].join("\n"),
    "utf8"
  );
  return { root, aigenRoot, packageId, packageDir, topicToPackageScript };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function requestJson(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const baseHeaders = body ? {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  } : {};
  const headers = { ...baseHeaders, ...(options.headers || {}) };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname,
        method: options.method || "GET",
        headers,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          try {
            resolve({ statusCode: response.statusCode, body: JSON.parse(raw) });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function withAigenEnv(fixture, fn) {
  const previous = {
    root: process.env.AIGEN_VIDNAS_ROOT,
    script: process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT,
    presto: process.env.AIGEN_PRESTO_BASE_URL,
    timeout: process.env.AIGEN_PRESTO_TIMEOUT_MS,
  };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT = fixture.topicToPackageScript;
  process.env.AIGEN_PRESTO_BASE_URL = "http://127.0.0.1:9";
  process.env.AIGEN_PRESTO_TIMEOUT_MS = "50";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
      if (previous.script === undefined) delete process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT; else process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT = previous.script;
      if (previous.presto === undefined) delete process.env.AIGEN_PRESTO_BASE_URL; else process.env.AIGEN_PRESTO_BASE_URL = previous.presto;
      if (previous.timeout === undefined) delete process.env.AIGEN_PRESTO_TIMEOUT_MS; else process.env.AIGEN_PRESTO_TIMEOUT_MS = previous.timeout;
    });
}

test("POST /api/aigen/resolve-assembly/create with valid package_id succeeds", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.files.length, 3);
      assert.equal(response.body.data.files.includes("assembly-plan.md"), true);
      assert.equal(response.body.data.files.includes("assembly-plan.csv"), true);
      assert.equal(response.body.data.files.includes("media-manifest.json"), true);
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), true);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST /api/aigen/resolve-assembly/create is blocked while selected MP4s are missing", async () => {
  const fixture = createAigenFixture({ missingStagedMp4: true });
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /Resolve assembly blocked|no staged MP4/i);
      // No handoff files should have been written.
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST /api/aigen/resolve-assembly/create with invalid package_id fails", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: "nonexistent-package" },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /does not exist|not found/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("GET /api/aigen/production-pipeline/status includes resolve_handoff_ready field", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_STATUS_API);
      assert.equal(response.statusCode, 200);
      const pkg = response.body.data.packages.find((item) => item.id === fixture.packageId);
      assert.ok(pkg, "Package not found in status");
      assert.equal("resolve_handoff_ready" in pkg, true);
      assert.equal(typeof pkg.resolve_handoff_ready, "boolean");
      assert.equal(pkg.resolve_handoff_ready, false);
      assert.equal(pkg.resolve_handoff_count, 0);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST /api/aigen/resolve-assembly/create without nonce header is rejected with 403", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /nonce/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// --- Video variant selection (HQ vs fast) ---------------------------------

// Stage package-facing MP4s in an arbitrary videos/<variant>/ folder. Used to
// simulate the HQ clip folder (videos/mp4-hq-720p/) alongside the default mp4.
function stageVariant(fixture, variant, indexes) {
  const dir = path.join(fixture.packageDir, "videos", variant);
  fs.mkdirSync(dir, { recursive: true });
  for (const index of indexes) {
    fs.writeFileSync(path.join(dir, `${index.toString().padStart(3, "0")}.mp4`), "mp4", "utf8");
  }
  aigenAuthority.recordVideoSlots(fixture.packageDir, { variant, indexes });
}

function readManifest(fixture) {
  return JSON.parse(
    fs.readFileSync(path.join(fixture.packageDir, "resolve-handoff", "media-manifest.json"), "utf8")
  );
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeCurrentVideoReview(fixture, rows, variant = "mp4") {
  writeJson(path.join(fixture.packageDir, "video-review.json"), {
    version: 2,
    kind: "project-video-review",
    project_id: fixture.packageId,
    updated_at: "2026-08-12T12:00:00.000Z",
    reviews: rows.map((row) => {
      const mp4Path = `videos/${variant}/${String(row.prompt_index).padStart(3, "0")}.mp4`;
      return {
        prompt_index: row.prompt_index,
        decision: row.decision,
        notes: row.notes || "",
        reviewed_video_sha256: sha256File(path.join(fixture.packageDir, mp4Path)),
        reviewed_video_path: mp4Path,
        video_variant: variant,
        reviewed_at: "2026-08-12T12:00:00.000Z",
      };
    }),
  });
}

test("resolve-assembly excludes an exact current video reviewed Reject", async () => {
  const fixture = createAigenFixture();
  writeCurrentVideoReview(fixture, [{ prompt_index: 6, decision: "reject" }]);
  try {
    await withAigenEnv(fixture, async () => {
      const result = await packageEngineServer.runResolveAssemblyCreate(fixture.packageId, { dryRun: true });
      assert.deepEqual(result.included_indexes, [8]);
      assert.deepEqual(result.review_excluded_indexes, [6]);
      assert.equal(result.review_eligibility.find((row) => row.prompt_index === 6).reason, "REJECT_CURRENT");
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly applies exact review policy and treats stale decisions as unreviewed", async () => {
  const fixture = createAigenFixture();
  writeCurrentVideoReview(fixture, [
    { prompt_index: 6, decision: "keep" },
    { prompt_index: 8, decision: "flag" },
  ]);
  try {
    await withAigenEnv(fixture, async () => {
      let result = await packageEngineServer.runResolveAssemblyCreate(fixture.packageId, { dryRun: true });
      assert.deepEqual(result.included_indexes, [6]);
      assert.deepEqual(result.review_excluded_indexes, [8]);
      assert.equal(result.review_eligibility.find((row) => row.prompt_index === 6).reason, "KEEP_CURRENT");
      assert.equal(result.review_eligibility.find((row) => row.prompt_index === 8).reason, "FLAG_CURRENT");

      fs.writeFileSync(path.join(fixture.packageDir, "videos", "mp4", "008.mp4"), "new variant bytes", "utf8");
      result = await packageEngineServer.runResolveAssemblyCreate(fixture.packageId, { dryRun: true });
      const stale = result.review_eligibility.find((row) => row.prompt_index === 8);
      assert.equal(stale.reason, "REVIEW_STALE");
      assert.equal(stale.review_current, false);
      assert.equal(stale.eligible, true);
      assert.deepEqual(result.included_indexes, [6, 8]);
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly keeps legacy unreviewed projects eligible with explicit provenance", async () => {
  const fixture = createAigenFixture();
  try {
    await withAigenEnv(fixture, async () => {
      const result = await packageEngineServer.runResolveAssemblyCreate(fixture.packageId, {});
      assert.equal(result.ok, true);
      assert.equal(result.video_review_policy, "legacy-compatible-v1");
      assert.deepEqual(result.included_indexes, [6, 8]);
      assert.equal(result.review_eligibility.every((row) => row.reason === "UNREVIEWED"), true);
      const manifest = readManifest(fixture);
      assert.equal(manifest.video_review_policy, "legacy-compatible-v1");
      assert.deepEqual(manifest.review_excluded, []);
      assert.equal(manifest.video_review_eligibility.length, 2);
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly records exact Keep provenance and Reject exclusion in manifest", async () => {
  const fixture = createAigenFixture();
  writeCurrentVideoReview(fixture, [
    { prompt_index: 6, decision: "keep" },
    { prompt_index: 8, decision: "reject" },
  ]);
  try {
    await withAigenEnv(fixture, async () => {
      const result = await packageEngineServer.runResolveAssemblyCreate(fixture.packageId, {});
      assert.equal(result.ok, true);
      assert.deepEqual(result.included_indexes, [6]);
      assert.deepEqual(result.review_excluded_indexes, [8]);
      const manifest = readManifest(fixture);
      assert.equal(manifest.video_review_eligibility[0].reason, "KEEP_CURRENT");
      assert.equal(manifest.video_review_eligibility[0].video_sha256, sha256File(path.join(fixture.packageDir, "videos/mp4/006.mp4")));
      assert.equal(manifest.review_excluded[0].reason, "REJECT_CURRENT");
      assert.equal(manifest.clips.length, 1);
      assert.equal(manifest.clips[0].video_sha256, manifest.video_review_eligibility[0].video_sha256);
      assert.equal(manifest.clips[0].video_review.reason, "KEEP_CURRENT");
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly restores the prior handoff when video bytes race the build", async () => {
  const fixture = createAigenFixture({ mutateDuringAssembly: true });
  const resolveDir = path.join(fixture.packageDir, "resolve-handoff");
  fs.mkdirSync(resolveDir, { recursive: true });
  for (const filename of ["assembly-plan.md", "assembly-plan.csv", "media-manifest.json"]) {
    fs.writeFileSync(path.join(resolveDir, filename), `prior ${filename}\n`, "utf8");
  }
  try {
    await withAigenEnv(fixture, async () => {
      const result = await packageEngineServer.runResolveAssemblyCreate(fixture.packageId, {});
      assert.equal(result.ok, false);
      assert.equal(result.code, "RESOLVE_VIDEO_BYTES_CHANGED");
      for (const filename of ["assembly-plan.md", "assembly-plan.csv", "media-manifest.json"]) {
        assert.equal(fs.readFileSync(path.join(resolveDir, filename), "utf8"), `prior ${filename}\n`);
      }
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly restores the prior handoff when review authority races the build", async () => {
  const fixture = createAigenFixture({ mutateReviewDuringAssembly: true });
  writeCurrentVideoReview(fixture, [{ prompt_index: 6, decision: "keep" }]);
  const resolveDir = path.join(fixture.packageDir, "resolve-handoff");
  fs.mkdirSync(resolveDir, { recursive: true });
  for (const filename of ["assembly-plan.md", "assembly-plan.csv", "media-manifest.json"]) {
    fs.writeFileSync(path.join(resolveDir, filename), `prior ${filename}\n`, "utf8");
  }
  try {
    await withAigenEnv(fixture, async () => {
      const result = await packageEngineServer.runResolveAssemblyCreate(fixture.packageId, {});
      assert.equal(result.ok, false);
      assert.equal(result.code, "RESOLVE_VIDEO_REVIEW_CHANGED");
      for (const filename of ["assembly-plan.md", "assembly-plan.csv", "media-manifest.json"]) {
        assert.equal(fs.readFileSync(path.join(resolveDir, filename), "utf8"), `prior ${filename}\n`);
      }
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly dry-run defaults to the mp4 variant and writes nothing", async () => {
  const fixture = createAigenFixture(); // stages videos/mp4/ for [6, 8]
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, dry_run: true },
        headers: { host: "127.0.0.1:8010" }, // no nonce required for a dry-run
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.dry_run, true);
      assert.equal(response.body.data.wrote, false);
      assert.equal(response.body.data.video_variant, "mp4");
      assert.equal(response.body.data.video_dir, "videos/mp4");
      assert.equal(response.body.data.included_clips.length, 2);
      assert.equal(response.body.data.missing_clips.length, 0);
      // Dry-run must not create any handoff files.
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), false);
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "media-manifest.json")), false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly dry-run reports the explicit HQ variant and its clips", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6, 8]); // HQ clips present for both selections
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p", dry_run: true },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.data.video_variant, "mp4-hq-720p");
      assert.equal(response.body.data.video_dir, "videos/mp4-hq-720p");
      assert.equal(response.body.data.included_clips.length, 2);
      for (const clip of response.body.data.included_clips) {
        assert.match(clip.mp4_rel, /^videos\/mp4-hq-720p\//);
      }
      // Never silently reaches into videos/mp4/.
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly real create with HQ variant uses videos/mp4-hq-720p and records it in the manifest", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6, 8]);
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p" },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.video_variant, "mp4-hq-720p");
      assert.equal(response.body.data.manifest_variant_recorded, true);
      const manifest = readManifest(fixture);
      assert.equal(manifest.video_variant, "mp4-hq-720p");
      assert.equal(manifest.video_source_folder, "videos/mp4-hq-720p");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly real create with default variant records mp4 in the manifest (backward compatible)", async () => {
  const fixture = createAigenFixture(); // videos/mp4/ staged for both selections
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.data.video_variant, "mp4");
      const manifest = readManifest(fixture);
      assert.equal(manifest.video_variant, "mp4");
      assert.equal(manifest.video_source_folder, "videos/mp4");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly clearly reports a held/missing clip and blocks a real run", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6]); // index 8 is missing/held (stands in for 021)
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      // Dry-run reports exactly the missing selection.
      const dry = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p", dry_run: true },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(dry.body.data.included_clips.length, 1);
      assert.equal(dry.body.data.missing_clips.length, 1);
      assert.equal(dry.body.data.missing_clips[0].prompt_index, 8);

      // A real run is blocked (not silently partial) and names the missing clip.
      const real = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p" },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(real.body.ok, false);
      assert.match(real.body.error, /Resolve assembly blocked.*mp4-hq-720p/i);
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly allows explicitly excluding a held clip to proceed", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6]); // index 8 held
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p", exclude_indexes: [8] },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.deepEqual(response.body.data.excluded_indexes, [8]);
      const manifest = readManifest(fixture);
      assert.deepEqual(manifest.excluded_indexes, [8]);
      assert.deepEqual(manifest.included_indexes, [6]);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly excluding a STAGED clip omits it from included and records it as excluded", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6, 8]); // both clips exist in the HQ folder
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      // Dry-run: the excluded-but-staged clip must not be counted as included.
      const dry = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p", exclude_indexes: [8], dry_run: true },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(dry.body.data.included_clips.length, 1);
      assert.equal(dry.body.data.included_clips[0].prompt_index, 6);
      assert.equal(dry.body.data.excluded_clips.length, 1);
      assert.equal(dry.body.data.excluded_clips[0].prompt_index, 8);
      assert.equal(dry.body.data.missing_clips.length, 0);

      // Real run: the manifest must agree — excluded index never in included_indexes.
      const real = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p", exclude_indexes: [8] },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(real.statusCode, 200);
      assert.deepEqual(real.body.data.included_indexes, [6]);
      assert.deepEqual(real.body.data.excluded_indexes, [8]);
      const manifest = readManifest(fixture);
      assert.deepEqual(manifest.included_indexes, [6]);
      assert.deepEqual(manifest.excluded_indexes, [8]);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly rejects a non-integer exclude index with 400", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, exclude_indexes: "6,2l", dry_run: true },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /invalid exclude index/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly rejects a path-traversal video variant with 400", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "../../../etc", dry_run: true },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /invalid video variant/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
