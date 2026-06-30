/**
 * VIDTOOLZ Episode Factory Tests — Package Run Archive (resume-page "Delete")
 * Tests for: archivePackageRun() server function.
 *
 * "Delete" on the resume page is a NON-DESTRUCTIVE archive: the run folder is
 * moved into package-runs/stale-runs/<runId>/ (excluded from the index, so it
 * drops off the resume list) while every file is preserved and recoverable.
 */

const {
  assert,
  fs,
  os,
  path,
  packageEngineServer,
  writeTestFile,
  test,
} = require("./_helpers.js");

const {
  archivePackageRun,
  findRunAssetFolders,
  relocateRunMedia,
  PACKAGE_RUNS_ARCHIVE_API,
} = packageEngineServer;

// ── Helper: temp root with a run folder + a linked script-image-assets folder ──
// The asset folder is linked to the run via generation-manifest.json's
// source.source_path (which embeds package-runs/<runId>/...), mirroring the
// real VIDNAS layout. opts.otherRunId seeds a second folder for a DIFFERENT run.
function createMediaRoot(runId = "2026-06-30-sample-run", opts = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-run-media-"));
  writeTestFile(tempRoot, `package-runs/${runId}/package-run-state.md`, "State: active\n");

  const assetsRoot = path.join(tempRoot, "assets");
  const project = opts.project || "Sample_Project_Headline";
  const projDir = path.join(assetsRoot, project);
  fs.mkdirSync(path.join(projDir, "kling-video-candidates"), { recursive: true });
  fs.writeFileSync(path.join(projDir, "generation-manifest.json"), JSON.stringify({
    headline: "Sample Project Headline",
    output_folder: projDir,
    source: { source_type: "markdown_file", source_path: `/repo/package-runs/${runId}/final-script.md` },
  }));
  // stills (flat) + a manifest/json that must be LEFT in place
  fs.writeFileSync(path.join(projDir, "block-001-prompt-01.png"), "IMG-A");
  fs.writeFileSync(path.join(projDir, "block-002-prompt-01.png"), "IMG-B");
  fs.writeFileSync(path.join(projDir, "script-blocks.json"), "{}");
  // a video in the kling subfolder (must be found recursively)
  fs.writeFileSync(path.join(projDir, "kling-video-candidates", "block-001-kling-01.mp4"), "VID-A");

  if (opts.otherRunId) {
    const otherDir = path.join(assetsRoot, "Other_Project");
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(path.join(otherDir, "generation-manifest.json"), JSON.stringify({
      source: { source_path: `/repo/package-runs/${opts.otherRunId}/final-script.md` },
    }));
    fs.writeFileSync(path.join(otherDir, "block-001-prompt-01.png"), "OTHER");
  }

  return {
    tempRoot,
    runId,
    projDir,
    assetsRoot,
    archiveStillDir: path.join(tempRoot, "archive", "STILL"),
    archiveVideoDir: path.join(tempRoot, "archive", "VIDEO"),
  };
}

function mediaOpts(ctx) {
  return {
    root: ctx.tempRoot,
    assetsRoot: ctx.assetsRoot,
    archiveStillDir: ctx.archiveStillDir,
    archiveVideoDir: ctx.archiveVideoDir,
  };
}

// ── Helper: temp root with a single package run on disk ─────────────────────
function createRunRoot(runId = "2026-06-30-sample-run") {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-run-archive-"));
  writeTestFile(tempRoot, `package-runs/${runId}/package-run-state.md`, "# Package Run State\n\nState: active\n");
  writeTestFile(tempRoot, `package-runs/${runId}/selected-package.json`, JSON.stringify({ topic: "Sample" }, null, 2));
  return { tempRoot, runId };
}

test("archivePackageRun route constant is exported", () => {
  assert.equal(PACKAGE_RUNS_ARCHIVE_API, "/api/package-runs/archive");
});

test("archivePackageRun moves the run folder into stale-runs/ and preserves files", () => {
  const { tempRoot, runId } = createRunRoot();
  const result = archivePackageRun({ runId }, { root: tempRoot });

  assert.equal(result.ok, true);
  assert.equal(result.runId, runId);
  assert.equal(result.run_id, runId);
  assert.equal(result.deleted, true);
  assert.equal(result.archivedTo, `package-runs/stale-runs/${runId}`);
  assert.equal(result.archived_to, `package-runs/stale-runs/${runId}`);
  assert.equal(result.recoverable, true);

  // Original location is gone; stale-runs copy exists with files intact.
  assert.equal(fs.existsSync(path.join(tempRoot, "package-runs", runId)), false);
  const dest = path.join(tempRoot, "package-runs", "stale-runs", runId);
  assert.equal(fs.existsSync(dest), true);
  assert.equal(fs.existsSync(path.join(dest, "selected-package.json")), true);
  assert.equal(fs.existsSync(path.join(dest, "package-run-state.md")), true);
});

test("archivePackageRun rejects a missing run with 404", () => {
  const { tempRoot } = createRunRoot();
  assert.throws(
    () => archivePackageRun({ runId: "2026-01-01-does-not-exist" }, { root: tempRoot }),
    (error) => error.statusCode === 404,
  );
});

test("archivePackageRun archives under a timestamped name when a stale-runs entry already exists (no clobber, no 409)", () => {
  const { tempRoot, runId } = createRunRoot();
  // Pre-seed a stale-runs entry with the same id (a prior archive of this run).
  writeTestFile(tempRoot, `package-runs/stale-runs/${runId}/package-run-state.md`, "# already archived\n");

  const result = archivePackageRun({ runId }, { root: tempRoot, now: "2026-06-30T12:34:56.000Z" });

  // Deletion succeeds (no 409) under a timestamped destination.
  assert.equal(result.deleted, true);
  assert.equal(result.archived_to, `package-runs/stale-runs/${runId}-20260630123456`);
  // The pre-existing archive entry is untouched.
  assert.equal(
    fs.readFileSync(path.join(tempRoot, "package-runs", "stale-runs", runId, "package-run-state.md"), "utf8"),
    "# already archived\n",
  );
  // The live run was moved out of package-runs/ into the timestamped archive.
  assert.equal(fs.existsSync(path.join(tempRoot, "package-runs", runId)), false);
  assert.equal(fs.existsSync(path.join(tempRoot, "package-runs", "stale-runs", `${runId}-20260630123456`, "selected-package.json")), true);
});

test("archivePackageRun rejects a path-traversal runId", () => {
  const { tempRoot } = createRunRoot();
  assert.throws(
    () => archivePackageRun({ runId: "../../etc" }, { root: tempRoot }),
    (error) => error.statusCode === 400,
  );
});

// ── Media relocation ────────────────────────────────────────────────────────

test("findRunAssetFolders matches a run via the manifest source_path back-link", () => {
  const ctx = createMediaRoot("2026-06-30-sample-run", { otherRunId: "2026-06-29-other-run" });
  const found = findRunAssetFolders(ctx.runId, { assetsRoot: ctx.assetsRoot });
  assert.deepEqual(found, [ctx.projDir]); // only this run's folder, not the other run's
});

test("findRunAssetFolders ignores folders with no manifest and returns [] when root is absent", () => {
  const ctx = createMediaRoot();
  fs.mkdirSync(path.join(ctx.assetsRoot, "No_Manifest_Folder"), { recursive: true });
  assert.deepEqual(findRunAssetFolders(ctx.runId, { assetsRoot: ctx.assetsRoot }), [ctx.projDir]);
  assert.deepEqual(findRunAssetFolders(ctx.runId, { assetsRoot: "/no/such/root" }), []);
});

test("relocateRunMedia moves images to STILL and videos to VIDEO, leaving JSON in place", () => {
  const ctx = createMediaRoot();
  const stats = relocateRunMedia(ctx.runId, mediaOpts(ctx));

  assert.equal(stats.stills, 2);
  assert.equal(stats.videos, 1);
  assert.equal(stats.errors.length, 0);

  // Images landed in STILL, video in VIDEO.
  assert.equal(fs.existsSync(path.join(ctx.archiveStillDir, "block-001-prompt-01.png")), true);
  assert.equal(fs.existsSync(path.join(ctx.archiveStillDir, "block-002-prompt-01.png")), true);
  assert.equal(fs.existsSync(path.join(ctx.archiveVideoDir, "block-001-kling-01.mp4")), true);

  // Sources are gone; the JSON manifest is left behind on the assets share.
  assert.equal(fs.existsSync(path.join(ctx.projDir, "block-001-prompt-01.png")), false);
  assert.equal(fs.existsSync(path.join(ctx.projDir, "kling-video-candidates", "block-001-kling-01.mp4")), false);
  assert.equal(fs.existsSync(path.join(ctx.projDir, "script-blocks.json")), true);
  assert.equal(fs.existsSync(path.join(ctx.projDir, "generation-manifest.json")), true);
});

test("relocateRunMedia never overwrites a different file with the same name (keeps both)", () => {
  const ctx = createMediaRoot();
  // Pre-seed a DIFFERENT file already archived under the same name.
  fs.mkdirSync(ctx.archiveStillDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.archiveStillDir, "block-001-prompt-01.png"), "PRE-EXISTING-DIFFERENT-CONTENT");

  const stats = relocateRunMedia(ctx.runId, mediaOpts(ctx));
  // Original archived file is intact...
  assert.equal(fs.readFileSync(path.join(ctx.archiveStillDir, "block-001-prompt-01.png"), "utf8"), "PRE-EXISTING-DIFFERENT-CONTENT");
  // ...and the new one was kept under a disambiguated name.
  const files = fs.readdirSync(ctx.archiveStillDir).filter((f) => f.startsWith("block-001-prompt-01"));
  assert.equal(files.length, 2);
  assert.equal(stats.stills, 2);
});

test("relocateRunMedia dedupes a byte-identical already-archived file", () => {
  const ctx = createMediaRoot();
  fs.mkdirSync(ctx.archiveStillDir, { recursive: true });
  // Same name AND same bytes as the source still.
  fs.writeFileSync(path.join(ctx.archiveStillDir, "block-001-prompt-01.png"), "IMG-A");

  const stats = relocateRunMedia(ctx.runId, mediaOpts(ctx));
  assert.equal(stats.deduped, 1);
  // Source removed, no duplicate created.
  assert.equal(fs.existsSync(path.join(ctx.projDir, "block-001-prompt-01.png")), false);
  const files = fs.readdirSync(ctx.archiveStillDir).filter((f) => f.startsWith("block-001-prompt-01"));
  assert.equal(files.length, 1);
});

test("archivePackageRun relocates media and reports stats alongside the stale-runs move", () => {
  const ctx = createMediaRoot();
  const result = archivePackageRun({ runId: ctx.runId }, mediaOpts(ctx));

  assert.equal(result.ok, true);
  assert.equal(result.media.stills, 2);
  assert.equal(result.media.videos, 1);
  // Run folder moved to stale-runs.
  assert.equal(fs.existsSync(path.join(ctx.tempRoot, "package-runs", "stale-runs", ctx.runId)), true);
  // Media moved off the assets share.
  assert.equal(fs.existsSync(path.join(ctx.archiveVideoDir, "block-001-kling-01.mp4")), true);
});

test("archivePackageRun reports zero media when no asset folder is linked to the run", () => {
  const ctx = createMediaRoot("2026-06-30-sample-run");
  // Archive a DIFFERENT run that has a folder but resolve against an empty assets root.
  const result = archivePackageRun({ runId: ctx.runId }, {
    root: ctx.tempRoot,
    assetsRoot: path.join(ctx.tempRoot, "empty-assets"),
    archiveStillDir: ctx.archiveStillDir,
    archiveVideoDir: ctx.archiveVideoDir,
  });
  assert.equal(result.media.folders.length, 0);
  assert.equal(result.media.stills, 0);
  assert.equal(result.media.videos, 0);
});
