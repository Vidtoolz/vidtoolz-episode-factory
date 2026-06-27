/**
 * VIDTOOLZ Episode Factory Tests — Package Runs Dashboard
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: package-runs-dashboard.js and related scripts
 */

const {
  assert,
  childProcess,
  fs,
  os,
  path,
  model,
  storage,
  packageEngine,
  packageRun,
  packageRunScript,
  packageOutlineScript,
  packageScriptPrepScript,
  packageProductionPrepScript,
  packageResearchPackScript,
  packageResearchEvidenceScript,
  packageScriptStructureScript,
  packageScriptReviewScript,
  packageProductionPlanScript,
  packageShotEditPlanReviewScript,
  packageCaptureChecklistScript,
  packageCaptureEvidenceReviewScript,
  packageCaptureGapScript,
  packageRunEvidenceLintScript,
  packageArtifactHygieneScript,
  packageRoughCutReviewScript,
  packageFinalReviewScript,
  packageRepurposeScript,
  packageBrollPromptsScript,
  packageExportChecklistScript,
  packagePublicationMetadataScript,
  packageArchiveManifestScript,
  packageRunCreatorQaScript,
  packageRunDoctorScript,
  packageRunNextActionScript,
  packageRunNextSafeActionScript,
  packageRunNextActionAuthorityScript,
  packageRunWorkflowMapScript,
  nextTaskClassifierScript,
  packageRunActiveStateAuditScript,
  packageRunStateProposalScript,
  packageProductionApprovalRepairScript,
  packageProductionApprovalReviewScript,
  packageRunsIndexScript,
  packageRunsDashboardLaunchScript,
  scriptImageAssetsDryRunScript,
  scriptImageAssetsReviewPageScript,
  topicScoutScript,
  oneOfTenInputHelper,
  packageEngineServer,
  packageRunsDashboard,
  episodeFactoryCli,
  proposalLoopGuard,
  proposalLoopRunner,
  trailerCueGenerator,
  trailerCueScript,
  musicCueGenerator,
  musicCueScript,
  supervisedCapture,
  supervisedCaptureScript,
  earthStudioJobPlanner,
  earthStudioJobScript,
  publishedVideosValidator,
  tests,
  test,
  captureConsole,
  createMemoryStorage,
  runGitCommand,
  writeTestFile,
  createNextSafeActionFixture,
  createNextTaskClassifierFixture,
  escapeRegExp,
  readJsonFile,
  createProposalGuardRepo,
  inspectProposalGuardRepo,
  runProposalGuardCommandPreflight,

} = require("./_helpers.js");



test("package runs index tracks cockpit visibility lane artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-runs-visibility-artifacts-"));
  const runId = "2099-03-01-visible-lanes";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.md"), "# Visible Lane Test\n", "utf8");
  fs.writeFileSync(path.join(runDir, "thumbnail-mockup.svg"), "<svg></svg>", "utf8");
  fs.writeFileSync(path.join(runDir, "FRICTION-LOG.json"), JSON.stringify({ entries: [] }), "utf8");
  fs.mkdirSync(path.join(runDir, "hyperframes"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "hyperframes", "hyperframes.json"), JSON.stringify({ compositions: [] }), "utf8");
  fs.writeFileSync(path.join(runDir, "remotion-renders.json"), JSON.stringify({ renders: [] }), "utf8");
  fs.writeFileSync(path.join(runDir, "selected-images.json"), JSON.stringify({ selections: [] }), "utf8");

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);

  assert.equal(run.files.thumbnail_mockup, true);
  assert.equal(run.files.friction_log, true);
  assert.equal(run.files.hyperframes, true);
  assert.equal(run.files.remotion_renders, true);
  assert.equal(run.files.selected_images, true);
});

test("dashboard production card shows operator asset ledger and motion lanes", () => {
  const run = {
    runId: "2099-03-02-card",
    path: "package-runs/2099-03-02-card",
    title: "Visible cockpit card",
    status: "Needs rough-cut review",
    workflowBucket: "Needs rough-cut review",
    overallStatus: "BLOCKED",
    firstBlockerReason: "Rough-cut review status is NEEDS PICKUPS.",
    nextRecommendedCommand: "node scripts/package-run-rough-cut-review.js package-runs/2099-03-02-card",
    files: {
      final_script: true,
      thumbnail_title_check: true,
      thumbnail_mockup: true,
      image_prompts: true,
      selected_images: true,
      video_prompts: true,
      hyperframes: true,
      remotion_renders: false,
      resolve_edit_checklist: true,
      friction_log: true,
    },
  };

  const ledger = packageRunsDashboard.buildProductionAssetLedger(run);
  const html = packageRunsDashboard.renderProductionCard(run);

  assert.equal(ledger.find((item) => item.key === "script").status, "available");
  assert.equal(ledger.find((item) => item.key === "hyperframes").status, "available");
  assert.equal(ledger.find((item) => item.key === "remotion").status, "missing");
  assert.match(html, /Production-card|production-card/i);
  assert.match(html, /Visible cockpit card/);
  assert.match(html, /Image prompts/);
  assert.match(html, /Hyperframes scenes\/renders/);
  assert.match(html, /Remotion compositions\/renders/);
  assert.match(html, /Open video room/);
  assert.match(html, /data-open-package-folder="2099-03-02-card"/);
  assert.match(html, /data-open-asset-path="final-script\.md"/);
});

test("dashboard video room exposes Hyperframes and Remotion as first-class read-only lanes", () => {
  const run = {
    runId: "2099-03-03-room",
    path: "package-runs/2099-03-03-room",
    title: "Video room test",
    status: "Needs capture",
    workflowBucket: "Needs capture",
    overallStatus: "BLOCKED",
    nextExpectedFile: "capture evidence",
    files: {
      final_script: true,
      image_prompts: true,
      video_prompts: true,
      hyperframes: false,
      remotion_renders: false,
    },
  };

  const html = packageRunsDashboard.renderVideoProjectRoom(run);

  assert.match(html, /Individual Video View/);
  assert.match(html, /Production Assets/);
  assert.match(html, /HyperFrames/);
  assert.match(html, /Agent-native motion graphics/);
  assert.match(html, /Remotion/);
  assert.match(html, /Reusable React-template video lane/);
  assert.match(html, /read-only orientation/i);
  assert.doesNotMatch(html, /data-approve|data-publish|publish-ready:\s*yes/i);
});

test("dashboard system and capability panels make availability visible without actions", () => {
  const index = {
    runs: [{
      runId: "2099-03-04-system",
      path: "package-runs/2099-03-04-system",
      status: "Needs rough-cut review",
      packageRunState: { state: "active" },
      files: { resolve_edit_checklist: true },
    }],
  };

  const systemHtml = packageRunsDashboard.renderSystemAvailabilityPanel(index);
  const capabilityHtml = packageRunsDashboard.renderCapabilityInventoryPanel();

  assert.match(systemHtml, /Production System Availability/);
  assert.match(systemHtml, /Cockpit server/);
  assert.match(systemHtml, /PRESTO \/ Wan2\.2/);
  assert.match(systemHtml, /HyperFrames/);
  assert.match(systemHtml, /Remotion/);
  assert.match(capabilityHtml, /Capability Inventory/);
  assert.match(capabilityHtml, /Visible Production Lanes/);
  assert.match(capabilityHtml, /DaVinci Resolve/);
  assert.doesNotMatch(systemHtml + capabilityHtml, /data-approve|data-publish|data-render/);
});

test("dashboard HyperFrames lane renders useful composition and render status", () => {
  const run = {
    runId: "2099-04-08-hyperframes",
    path: "package-runs/2099-04-08-hyperframes",
    title: "HyperFrames cockpit test",
    status: "Needs capture",
    workflowBucket: "Needs capture",
    overallStatus: "BLOCKED",
    files: { hyperframes: true, remotion_renders: false },
    hyperframes: {
      availability: {
        available: true,
        command: "npx --no-install hyperframes --help",
        version: "1.2.3",
        checked_at: "2099-04-08T00:00:00.000Z",
      },
      lane: {
        status: "failed",
        compositionsCount: 2,
        hasHyperframesDir: true,
        hasCompositionsDir: true,
      },
      manifest: {
        compositions: [
          {
            id: "opening-card",
            title: "Opening Card",
            preview_url: "/api/hyperframes/preview?runId=2099-04-08-hyperframes&id=opening-card",
            rendered_mp4: "hyperframes/renders/opening-card.mp4",
            status: "rendered",
            last_rendered_at: "2099-04-08T00:01:00.000Z",
            last_error: null,
            approved: false,
          },
          {
            id: "broken-card",
            title: "Broken Card",
            preview_url: "/api/hyperframes/preview?runId=2099-04-08-hyperframes&id=broken-card",
            rendered_mp4: "hyperframes/renders/broken-card.mp4",
            status: "failed",
            last_rendered_at: null,
            last_error: "simulated failure",
            approved: false,
          },
        ],
      },
    },
  };

  const html = packageRunsDashboard.renderVideoProjectRoom(run);

  assert.match(html, /Availability: <strong>installed<\/strong>/);
  assert.match(html, /Compositions: <strong>2<\/strong>/);
  assert.match(html, /Opening Card/);
  assert.match(html, /hyperframes\/renders\/opening-card\.mp4/);
  assert.match(html, /2099-04-08T00:01:00\.000Z/);
  assert.match(html, /Broken Card/);
  assert.match(html, /simulated failure/);
  assert.match(html, /data-hyperframes-render="broken-card"/);
  assert.match(html, /\/api\/hyperframes\/preview\?runId=2099-04-08-hyperframes&amp;id=opening-card/);
  assert.doesNotMatch(html, /data-approve|publish-ready:\s*yes/i);
});

test("package-run OS folder opener resolves asset files to containing folders", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-open-folder-"));
  const runId = "2099-03-05-open-folder";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Script\n", "utf8");
  const calls = [];

  const payload = packageEngineServer.openPackageRunAssetFolder(
    { runId, assetPath: "final-script.md" },
    {
      root: tempRoot,
      command: "xdg-open",
      opener: (command, args, options) => {
        calls.push({ command, args, options });
        return { unref() {} };
      },
    }
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.opened, runDir);
  assert.equal(payload.targetExists, true);
  assert.equal(calls[0].command, "xdg-open");
  assert.deepEqual(calls[0].args, [runDir]);
});

test("package-run OS folder opener rejects path traversal", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-open-folder-traversal-"));
  const runId = "2099-03-06-open-folder";
  fs.mkdirSync(path.join(tempRoot, "package-runs", runId), { recursive: true });

  assert.throws(
    () => packageEngineServer.openPackageRunAssetFolder(
      { runId, assetPath: "../outside.md" },
      { root: tempRoot, opener: () => ({ unref() {} }) }
    ),
    /escaped the package-run folder/
  );
});

test("package runs dashboard launch helper writes index and prints local launch instructions", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-runs-dashboard-launch-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-launch");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-candidates.json"), "{\"candidates\":[]}\n");

  const parsed = packageRunsDashboardLaunchScript.parseArgs(["--serve", "--port", "8020", "--bind", "127.0.0.1"]);
  const result = packageRunsDashboardLaunchScript.writePackageRunsIndex(tempRoot);
  const message = packageRunsDashboardLaunchScript.buildLaunchMessage(tempRoot);
  const customMessage = packageRunsDashboardLaunchScript.buildLaunchMessage(tempRoot, parsed);
  const written = JSON.parse(fs.readFileSync(path.join(tempRoot, "package-runs-index.json"), "utf8"));

  assert.equal(parsed.serve, true);
  assert.equal(parsed.port, "8020");
  assert.equal(parsed.host, "127.0.0.1");
  assert.equal(result.index.count, 1);
  assert.equal(written.runs[0].runId, "2026-05-02-launch");
  assert.match(message, /package-runs-index\.json updated/);
  assert.match(message, new RegExp(`cd ${tempRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(message, /PORT=8010 HOST=127\.0\.0\.1 node package-engine-server\.js/);
  assert.match(message, /http:\/\/127\.0\.0\.1:8010\/package-runs-dashboard\.html/);
  assert.match(customMessage, /PORT=8020 HOST=127\.0\.0\.1 node package-engine-server\.js/);
});

function captureEvidenceIntakeFields(overrides = {}) {
  return {
    takeName: "Take 01 hook",
    takeSource: "shot-list.md hook row",
    takeReference: "media/take-01-hook.mov",
    takeNotes: "00:00-00:42 clean take",
    screenName: "Workflow proof screen",
    screenPurpose: "shows approved workflow result",
    screenReference: "recordings/workflow-proof.mp4",
    audioItem: "Voiceover main",
    audioRequirement: "final script sections 1-4",
    audioReference: "audio/voiceover-main.wav",
    ...overrides,
  };
}

function evidenceIntakeRows(overrides = {}) {
  return [{
    media_path: "/tmp/vidtoolz-kling-candidate.mp4",
    media_type: "kling_candidate",
    source_category: "generated asset",
    proof_purpose: "Kling b-roll candidate supports the prompt-03 block context.",
    related_script_block_or_section: "block-024",
    status: "exists_on_vidnas",
    resolve_tested: "no",
    notes: "Candidate only; not approval or production readiness.",
    ...overrides,
  }];
}

function createEvidenceNextActionFixture(withKlingVideo = false) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-next-action-"));
  const runId = "2026-05-06-ai-video-proof-plan";
  const runDir = path.join(tempRoot, "package-runs", runId);
  const assetFolder = path.join(tempRoot, "vidnas", "script-image-assets");
  const manifestPath = path.join(assetFolder, "generation-manifest.json");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, "reports"), { recursive: true });
  fs.mkdirSync(assetFolder, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\nPackage run state: active\n", "utf8");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      output_folder: assetFolder,
      items: [{
        prompt_id: "prompt-03",
        output_filename: "block-024-prompt-03.png",
        selected: true,
        reviewed_by_mikko: true,
        approved: false,
        production_ready: false,
      }],
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "reports", "prompt-03-selected-image-edit-handoff.md"),
    `# Handoff\n\nManifest: \`${manifestPath}\`\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "reports", "prompt-03-image-selection-review.md"), "# Review\n", "utf8");
  if (withKlingVideo) {
    fs.mkdirSync(path.join(assetFolder, "kling-video-candidates"), { recursive: true });
    fs.writeFileSync(path.join(assetFolder, "kling-video-candidates", "block-024-prompt-03-kling-01.mp4"), "fake video", "utf8");
  }
  return { tempRoot, runId, runDir, manifestPath, assetFolder };
}

function roughCutInputFields(overrides = {}) {
  return {
    reviewedFilePath: "media/rough-cut-v1.mp4",
    reviewedFileType: "rough-cut candidate",
    watchDate: "2026-05-17",
    reviewer: "Mikko",
    first30SecondsNotes: "The hook is understandable but slow.",
    clarityNotes: "The viewer promise is clear.",
    pacingNotes: "Middle section drags.",
    proofEvidenceNotes: "Evidence appears on screen.",
    missingVisuals: "Need one closeup.",
    audioProblems: "None.",
    graphicsProblems: "One label is small.",
    confusingSections: "No major confusion.",
    sectionsToCutTighten: "Trim intro pause.",
    pickupsNeeded: "Add closeup pickup.",
    editFixesNeeded: "Tighten dead air.",
    secondCutRecommendation: "Needs pickups before second cut.",
    roughCutApprovalMarker: "NEEDS PICKUPS",
    ...overrides,
  };
}

test("rough cut input console saves only watch notes and does not approve without PASS", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rough-cut-console-save-"));
  const runId = "2026-05-17-rough-cut-console";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Manual Notes\n\nKeep.\n", "utf8");

  const saved = packageEngineServer.saveRoughCutWatchNotes({
    runId,
    fields: roughCutInputFields(),
  }, { root: tempRoot });
  const files = fs.readdirSync(runDir).sort();
  const notes = fs.readFileSync(path.join(runDir, "rough-cut-watch-notes.md"), "utf8");

  assert.deepEqual(saved.written, ["rough-cut-watch-notes.md"]);
  assert.equal(saved.approvedForSecondCut, false);
  assert.deepEqual(files, ["notes.md", "rough-cut-watch-notes.md"]);
  assert.equal(fs.readFileSync(path.join(runDir, "notes.md"), "utf8"), "# Manual Notes\n\nKeep.\n");
  assert.match(notes, /Reviewed file path: media\/rough-cut-v1\.mp4/);
  assert.match(notes, /Rough-cut approval: NEEDS PICKUPS/);
  assert.doesNotMatch(notes, /Rough-cut approval: PASS/);
});

test("rough cut input console writes PASS only from explicit PASS marker", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rough-cut-console-pass-"));
  const runId = "2026-05-17-rough-cut-pass";
  fs.mkdirSync(path.join(tempRoot, "package-runs", runId), { recursive: true });

  const saved = packageEngineServer.saveRoughCutWatchNotes({
    runId,
    fields: roughCutInputFields({
      pickupsNeeded: "None.",
      editFixesNeeded: "None.",
      secondCutRecommendation: "Ready for second cut.",
      roughCutApprovalMarker: "PASS",
    }),
  }, { root: tempRoot });
  const notes = fs.readFileSync(path.join(tempRoot, "package-runs", runId, "rough-cut-watch-notes.md"), "utf8");

  assert.equal(saved.approvedForSecondCut, true);
  assert.match(notes, /Rough-cut approval: PASS/);
});

test("rough cut input console rejects missing required fields and invalid approval marker", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rough-cut-console-invalid-"));
  const runId = "2026-05-17-rough-cut-invalid";
  fs.mkdirSync(path.join(tempRoot, "package-runs", runId), { recursive: true });

  assert.throws(
    () => packageEngineServer.saveRoughCutWatchNotes({
      runId,
      fields: roughCutInputFields({ reviewedFilePath: "" }),
    }, { root: tempRoot }),
    /Missing required rough-cut fields: reviewed file path/
  );
  assert.throws(
    () => packageEngineServer.saveRoughCutWatchNotes({
      runId,
      fields: roughCutInputFields({ roughCutApprovalMarker: "APPROVE IT" }),
    }, { root: tempRoot }),
    /Invalid rough-cut approval marker/
  );
});

test("rough cut input console detects reviewed file and guards open video paths", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rough-cut-console-open-"));
  const runId = "2026-05-17-rough-cut-open";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(path.join(runDir, "media"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "media", "rough-cut-v1.mp4"), "fake", "utf8");
  fs.writeFileSync(
    path.join(runDir, "rough-cut-watch-notes.md"),
    "# Rough-Cut Watch Notes\n\n- Reviewed file: media/rough-cut-v1.mp4\n",
    "utf8"
  );
  const calls = [];
  const opened = packageEngineServer.openRoughCutVideo({
    runId,
    filePath: "media/rough-cut-v1.mp4",
  }, {
    root: tempRoot,
    opener: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { unref() {} };
    },
  });

  assert.deepEqual(packageEngineServer.detectRoughCutCandidate(runDir), {
    path: "media/rough-cut-v1.mp4",
    source: "rough-cut-watch-notes.md",
  });
  assert.equal(opened.opened, path.join(runDir, "media", "rough-cut-v1.mp4"));
  assert.equal(calls[0].cmd, "vlc");
  assert.deepEqual(calls[0].args, [path.join(runDir, "media", "rough-cut-v1.mp4")]);
  assert.throws(
    () => packageEngineServer.openRoughCutVideo({ runId, filePath: "/etc/passwd" }, { root: tempRoot }),
    /inside the package run or ~\/Videos/
  );
});

function createStaleRoughCutFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rough-cut-stale-derived-"));
  const runId = "2026-05-17-stale-derived";
  const runDir = path.join(tempRoot, "package-runs", runId);
  const indexPath = path.join(tempRoot, "package-runs-index.json");
  const statePath = path.join(runDir, "package-run-state.md");
  fs.mkdirSync(path.join(runDir, "media"), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify({ generatedAt: "before" }), "utf8");
  fs.writeFileSync(statePath, "# Package Run State\n\nPackage run state: active\n", "utf8");
  fs.writeFileSync(path.join(runDir, "selected-package.md"), "# Selected Package\n\nViewer promise: prove package gates.\n", "utf8");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PASS\n", "utf8");
  fs.writeFileSync(path.join(runDir, "research-sufficiency-review.md"), "# Research Sufficiency Review\n\n- Review status: PASS\n", "utf8");
  fs.writeFileSync(path.join(runDir, "script-structure.md"), "# Script Structure\n\n- Script structure status: READY TO DRAFT\n", "utf8");
  fs.writeFileSync(path.join(runDir, "script-review.md"), "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-blockers.md"), "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Clear. | None. | closed |\n", "utf8");
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-review.md"), "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "capture-checklist.md"), "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "capture-evidence-review.md"), "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Manual approval marker detected: yes\n- Ready for rough-cut work: yes\n- Real capture evidence detected: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "media", "rough-cut-v1.mp4"), "fake", "utf8");
  fs.writeFileSync(
    path.join(runDir, "rough-cut-watch-notes.md"),
    "# Rough-Cut Watch Notes\n\n- Reviewed file: media/rough-cut-v1.mp4\n\n## Rough-Cut Version Reviewed\n\nmedia/rough-cut-v1.mp4\n\n## Watch Date\n\n2026-05-17\n\n## Reviewer\n\nMikko\n\n## First 30 Seconds Notes\n\nHook needs a presenter pickup.\n\n## Clarity Notes\n\nMessage is clear but needs human presence.\n\n## Pacing Notes\n\nIntro pacing is slow.\n\n## Proof / Evidence Notes\n\nEvidence is visible.\n\n## Missing Visuals\n\nPresenter closeup after intro.\n\n## Audio Problems\n\nNone.\n\n## Graphics Problems\n\nNone.\n\n## Confusing Sections\n\nNone.\n\n## Sections to Cut / Tighten\n\nTrim intro pause.\n\n## Pickups Needed\n\nAdd presenter closeup after intro.\n\n## Edit Fixes Needed\n\nTrim intro pause.\n\n## Second-Cut Recommendation\n\nNeeds pickups before second cut.\n\n## Manual Rough-Cut Approval Marker\n\nRough-cut approval: NEEDS PICKUPS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "rough-cut-review.md"),
    "# Rough-Cut Review\n\n- Rough-cut notes source: created starter template\n- Rough-cut review status: BLOCKED\n- Second-cut ready: no\n\n## Second-Cut Readiness Gate\n\n- Status: BLOCKED\n- Reason: rough-cut-watch-notes.md was missing; starter template created.\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "pickup-list.md"), "# Pickup List\n\n| pickup shot/content | reason | priority | source/location | status |\n| --- | --- | --- | --- | --- |\n| Not assessed. | Real rough-cut watch notes are missing or still a starter template. | high | rough-cut-watch-notes.md | blocked |\n", "utf8");
  fs.writeFileSync(path.join(runDir, "edit-fix-list.md"), "# Edit Fix List\n\n| section/timecode | problem | fix | priority | status |\n| --- | --- | --- | --- | --- |\n| Not assessed. | Real rough-cut watch notes are missing or still a starter template. | Add real watch notes before edit fixes can be assessed. | high | blocked |\n", "utf8");
  return {
    tempRoot,
    runId,
    runDir,
    indexPath,
    statePath,
    watchNotesPath: path.join(runDir, "rough-cut-watch-notes.md"),
  };
}

test("rough cut status detects stale derived review artifact from newer NEEDS PICKUPS notes", () => {
  const fixture = createStaleRoughCutFixture();

  const parsed = packageEngineServer.parseRoughCutReviewFile(fixture.runDir);
  const status = packageEngineServer.buildRoughCutStatus({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(parsed.derivedArtifactStale, true);
  assert.equal(parsed.currentWatchNotesMarker, "NEEDS PICKUPS");
  assert.match(parsed.staleReason, /Current watch notes say NEEDS PICKUPS/);
  assert.equal(status.roughCutResult.derivedArtifactStale, true);
  assert.deepEqual(status.staleDerivedArtifacts, ["rough-cut-review.md"]);
  assert.equal(status.roughCutResult.secondCutReady, false);
});

test("dashboard renders stale rough-cut derived artifact warning and regenerate action", () => {
  const html = packageRunsDashboard.renderMikkoInputConsole({
    runId: "2026-05-17-stale-derived",
    currentInferredStage: "Needs rough-cut review",
    overallStatus: "BLOCKED",
    firstBlockerReason: "Rough-cut review status is stale.",
    roughCutCandidate: { path: "media/rough-cut-v1.mp4", source: "rough-cut-watch-notes.md" },
    roughCutResult: {
      roughCutReviewStatus: "BLOCKED",
      secondCutReady: false,
      reason: "rough-cut-watch-notes.md was missing; starter template created.",
      reviewedFilePath: "media/rough-cut-v1.mp4",
      approvalMarker: "NEEDS PICKUPS",
      currentWatchNotesMarker: "NEEDS PICKUPS",
      derivedArtifactStale: true,
      staleReason: "Current watch notes say NEEDS PICKUPS but rough-cut-review.md still reports an old starter-template BLOCKED result.",
    },
  });

  assert.match(html, /Derived rough-cut review artifact may be stale/);
  assert.match(html, /Current watch notes say NEEDS PICKUPS/);
  assert.match(html, /Regenerate rough-cut review artifacts/);
  assert.match(html, /data-regenerate-rough-cut-derived/);
});

test("rough cut derived regeneration writes only derived artifacts and preserves source notes index and state", () => {
  const fixture = createStaleRoughCutFixture();
  const beforeNotes = fs.readFileSync(fixture.watchNotesPath, "utf8");
  const beforeIndex = fs.readFileSync(fixture.indexPath, "utf8");
  const beforeState = fs.readFileSync(fixture.statePath, "utf8");

  const result = packageEngineServer.regenerateRoughCutDerivedArtifacts({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.deepEqual(result.written.sort(), ["edit-fix-list.md", "pickup-list.md", "rough-cut-review.md"]);
  assert.equal(fs.readFileSync(fixture.watchNotesPath, "utf8"), beforeNotes);
  assert.equal(fs.readFileSync(fixture.indexPath, "utf8"), beforeIndex);
  assert.equal(fs.readFileSync(fixture.statePath, "utf8"), beforeState);
  assert.match(fs.readFileSync(path.join(fixture.runDir, "rough-cut-review.md"), "utf8"), /Rough-cut review status: NEEDS PICKUPS/);
  assert.match(fs.readFileSync(path.join(fixture.runDir, "pickup-list.md"), "utf8"), /Add presenter closeup after intro/);
  assert.match(fs.readFileSync(path.join(fixture.runDir, "edit-fix-list.md"), "utf8"), /Trim intro pause/);
});

test("rough cut derived regeneration stays blocked for pickups without inferring PASS or second-cut ready", () => {
  const fixture = createStaleRoughCutFixture();

  const result = packageEngineServer.regenerateRoughCutDerivedArtifacts({ runId: fixture.runId }, { root: fixture.tempRoot });
  const review = fs.readFileSync(path.join(fixture.runDir, "rough-cut-review.md"), "utf8");

  assert.equal(result.review.roughCutReviewStatus, "NEEDS PICKUPS");
  assert.equal(result.review.secondCutReady, false);
  assert.equal(result.approvedForSecondCut, false);
  assert.doesNotMatch(review, /Rough-cut review status: PASS|Second-cut ready: yes|Rough-cut approval: PASS/);
});

function pickupPlanItems(overrides = {}) {
  return [{
    title: "Add presenter closeup after intro",
    type: "presenter closeup",
    required: "yes",
    source: "new recording",
    purpose: "add human presence",
    status: "proposed",
    notes: "Use this only as a proposed pickup until Mikko accepts it.",
    ...overrides,
  }];
}

test("pickup plan save writes only pickup and edit-fix lists without updating index", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pickup-plan-save-"));
  const runId = "2026-05-17-pickup-plan";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const indexPath = path.join(tempRoot, "package-runs-index.json");
  fs.writeFileSync(indexPath, JSON.stringify({ generatedAt: "before" }), "utf8");
  const beforeIndex = fs.readFileSync(indexPath, "utf8");

  const saved = packageEngineServer.savePickupPlan({ runId, items: pickupPlanItems() }, { root: tempRoot });
  const files = fs.readdirSync(runDir).sort();

  assert.deepEqual(saved.written.sort(), ["edit-fix-list.md", "pickup-list.md"]);
  assert.equal(saved.approvedForSecondCut, false);
  assert.deepEqual(files, ["edit-fix-list.md", "pickup-list.md"]);
  assert.equal(fs.readFileSync(indexPath, "utf8"), beforeIndex);
  assert.match(fs.readFileSync(path.join(runDir, "pickup-list.md"), "utf8"), /Add presenter closeup after intro/);
  assert.match(fs.readFileSync(path.join(runDir, "pickup-list.md"), "utf8"), /proposed/);
  assert.doesNotMatch(fs.readFileSync(path.join(runDir, "pickup-list.md"), "utf8"), /Rough-cut approval: PASS/);
});

test("pickup plan save rejects invalid pickup items", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pickup-plan-invalid-"));
  const runId = "2026-05-17-pickup-invalid";
  fs.mkdirSync(path.join(tempRoot, "package-runs", runId), { recursive: true });

  assert.throws(
    () => packageEngineServer.savePickupPlan({ runId, items: pickupPlanItems({ type: "magic" }) }, { root: tempRoot }),
    /Invalid pickup type: magic/
  );
  assert.throws(
    () => packageEngineServer.savePickupPlan({ runId, items: pickupPlanItems({ title: "" }) }, { root: tempRoot }),
    /Pickup item title is required/
  );
});

test("pickup plan accepted item still does not infer rough-cut PASS", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pickup-plan-no-pass-"));
  const runId = "2026-05-17-pickup-no-pass";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const saved = packageEngineServer.savePickupPlan({
    runId,
    items: pickupPlanItems({ status: "accepted" }),
  }, { root: tempRoot });
  const pickup = fs.readFileSync(path.join(runDir, "pickup-list.md"), "utf8");
  const fixes = fs.readFileSync(path.join(runDir, "edit-fix-list.md"), "utf8");

  assert.equal(saved.approvedForSecondCut, false);
  assert.match(pickup, /accepted/);
  assert.doesNotMatch(pickup + fixes, /READY FOR SECOND CUT|Second-cut ready: yes|Rough-cut approval: PASS/);
});

test("publish gate status advertises endpoint surface", () => {
  const status = packageEngineServer.createStatusResponse({});
  assert.equal(status.publishGate.packageRunsListApi, "/api/package-runs/list");
  assert.equal(status.publishGate.finalReviewApi, "/api/package-runs/final-review");
  assert.equal(status.publishGate.exportChecklistApi, "/api/package-runs/export-checklist");
  assert.equal(status.publishGate.publicationMetadataApi, "/api/package-runs/publication-metadata");
  assert.equal(status.publishGate.archiveManifestApi, "/api/package-runs/archive-manifest");
  assert.equal(status.publishGate.nonceHeader, packageEngineServer.LOCAL_WRITE_NONCE_HEADER);
  assert.ok(status.publishGate.allowedWriteFiles.includes("post-publish-learning.md"));
});

test("publish gate stdout parser normalizes script labels", () => {
  const parsed = packageEngineServer.parseLabelValueStdout([
    "final review: PASS",
    "publish ready: yes",
    "ready to upload: no",
    "reason: all good",
  ].join("\n"));
  assert.equal(parsed.final_review, "PASS");
  assert.equal(parsed.publish_ready, "yes");
  assert.equal(parsed.ready_to_upload, "no");
  assert.equal(parsed.reason, "all good");
});

test("publish gate learning template records published url without publishing", () => {
  const markdown = packageEngineServer.buildPostPublishLearningTemplate("2026-05-06-ai-video-proof-plan", {
    youtubeUrl: "https://youtu.be/example",
    publishedAt: "2026-06-09T10:00:00Z",
  });
  assert.match(markdown, /# Post-Publish Learning/);
  assert.match(markdown, /Published URL: https:\/\/youtu\.be\/example/);
  assert.match(markdown, /External APIs called: no/);
  assert.match(markdown, /Review analytics after 24 hours/);
});

test("operator cockpit status builds timeline summary media and index state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "operator-cockpit-status-"));
  const runId = "2026-05-17-cockpit-status";
  const runDir = path.join(tempRoot, "package-runs", runId);
  const indexPath = path.join(tempRoot, "package-runs-index.json");
  fs.mkdirSync(path.join(runDir, "media"), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify({ generatedAt: "old" }), "utf8");
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\nPackage run state: active\n", "utf8");
  fs.writeFileSync(path.join(runDir, "selected-package.md"), "# Selected Package\n", "utf8");
  fs.writeFileSync(path.join(runDir, "research-sufficiency-review.md"), "# Research Sufficiency Review\n\n- Review status: PASS\n", "utf8");
  fs.writeFileSync(path.join(runDir, "script-structure.md"), "# Script Structure\n\n- Script structure status: READY TO DRAFT\n", "utf8");
  fs.writeFileSync(path.join(runDir, "script-review.md"), "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-blockers.md"), "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Clear. | None. | closed |\n", "utf8");
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-review.md"), "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "capture-checklist.md"), "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "capture-evidence-review.md"), "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Real capture evidence detected: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "rough-cut-watch-notes.md"), "# Rough-Cut Watch Notes\n\n- Reviewed file: media/rough-cut-v1.mp4\n\n## First 30 Seconds Notes\n\nReal notes.\n\n## Clarity Notes\n\nClear.\n\n## Pacing Notes\n\nNeeds trim.\n\n## Proof / Evidence Notes\n\nProof lands.\n\n## Pickups Needed\n\nAdd closeup.\n\n## Edit Fixes Needed\n\nTrim pause.\n\n## Second-Cut Recommendation\n\nNeeds pickups.\n\n## Manual Rough-Cut Approval Marker\n\nRough-cut approval: NEEDS PICKUPS\n", "utf8");
  fs.writeFileSync(path.join(runDir, "rough-cut-review.md"), "# Rough-Cut Review\n\n- Rough-cut review status: NEEDS PICKUPS\n- Second-cut ready: no\n\n## Second-Cut Readiness Gate\n\n- Status: NEEDS PICKUPS\n- Reason: Watch notes list pickups needed.\n", "utf8");
  fs.writeFileSync(path.join(runDir, "pickup-list.md"), "# Pickup List\n\n| pickup shot/content | reason | priority | source/location | status |\n| --- | --- | --- | --- | --- |\n| Add closeup. | Human presence. | high | rough-cut-watch-notes.md | open |\n", "utf8");
  fs.writeFileSync(path.join(runDir, "edit-fix-list.md"), "# Edit Fix List\n\n| section/timecode | problem | fix | priority | status |\n| --- | --- | --- | --- | --- |\n| intro | pause | trim | high | open |\n", "utf8");
  fs.writeFileSync(path.join(runDir, "media", "rough-cut-v1.mp4"), "fake", "utf8");
  fs.utimesSync(indexPath, new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));

  const status = packageEngineServer.buildRoughCutStatus({ runId }, { root: tempRoot });

  assert.equal(status.activeRunSummary.runId, runId);
  assert.equal(status.activeRunSummary.packageRunState.state, "active");
  assert.equal(status.activeRunSummary.dashboardIndexUpdated, false);
  assert.equal(status.roughCutResult.roughCutReviewStatus, "NEEDS PICKUPS");
  assert.equal(status.roughCutResult.secondCutReady, false);
  assert.equal(status.roughCutResult.approvalMarker, "NEEDS PICKUPS");
  assert.equal(status.gateTimeline.length, 12);
  assert.equal(status.gateTimeline.find((gate) => gate.label === "Rough Cut").status, "NEEDS PICKUPS");
  assert.equal(status.gateTimeline.find((gate) => gate.label === "Second Cut").status, "LOCKED");
  assert.equal(status.mediaRows.some((row) => row.path === "media/rough-cut-v1.mp4" && row.openAllowed), true);
});

function writeCaptureEvidenceFixture(runDir, extra = {}) {
  const files = {
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n",
    "takes-log.md": "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Take 01 hook | shot-list.md | media/take-01-hook.mov | Human reviewed usable take. | captured |\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Workflow screen recording | Shows proof workflow. | recordings/workflow-001.mp4 | captured |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Final script narration. | audio/voiceover.wav | recorded |\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n\n| missing shot/content | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Capture scope reviewed. | No fix needed. | closed |\n",
    ...extra,
  };
  fs.mkdirSync(runDir, { recursive: true });
  Object.entries(files).forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));
}

function createProductionGpsFixture(overrides = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "production-gps-"));
  const runId = overrides.runId || "2026-05-06-ai-video-proof-plan";
  const runDir = path.join(tempRoot, "package-runs", runId);
  const indexPath = path.join(tempRoot, "package-runs-index.json");
  fs.mkdirSync(path.join(runDir, "media"), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify({ generatedAt: "before" }), "utf8");
  writeCaptureEvidenceFixture(runDir, {
    "package-run-state.md": "# Package Run State\n\nPackage run state: active\n",
    "selected-package.md": "# Selected Package\n\nProof Plan Fixture\n",
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Proof Plan Fixture" } }),
    "research-sufficiency-review.md": "# Research Sufficiency Review\n\n- Review status: PASS\n- Research approval marker: PASS\n",
    "script-structure.md": "# Script Structure\n\n- Script structure status: READY TO DRAFT\n",
    "script-review.md": "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md": "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Clear. | None. | closed |\n",
    "capture-evidence-review.md": "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Manual approval marker detected: yes\n- Ready for rough-cut work: yes\n- Real capture evidence detected: yes\n",
    "rough-cut-watch-notes.md": "# Rough-Cut Watch Notes\n\n- Reviewed file: media/rough-cut-v1.mp4\n\n## First 30 Seconds Notes\n\nOpening is acceptable.\n\n## Clarity Notes\n\nThe message is understandable.\n\n## Pacing Notes\n\nPacing is acceptable.\n\n## Proof / Evidence Notes\n\nProof/evidence is acceptable for this stage.\n\n## Missing Visuals\n\nPresenter is not seen, only heard.\n\n## Pickups Needed\n\nMaybe add closeups and AI-generated B-roll.\n\n## Edit Fixes Needed\n\nNo edit fixes noted beyond adding visual support.\n\n## Second-Cut Recommendation\n\nMove to second-cut work by adding clips.\n\n## Manual Rough-Cut Approval Marker\n\nRough-cut approval: NEEDS PICKUPS\n",
    "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut notes source: rough-cut-watch-notes.md\n- Rough-cut review status: NEEDS PICKUPS\n- Second-cut ready: no\n\n## Second-Cut Readiness Gate\n\n- Status: NEEDS PICKUPS\n- Reason: Watch notes list pickups needed.\n",
    "pickup-list.md": "# Pickup List\n\n| pickup shot/content | reason | priority | source/location | status |\n| --- | --- | --- | --- | --- |\n| Maybe add closeups and AI-generated B-roll. | Needed to repair rough-cut viewer experience. | high | rough-cut-watch-notes.md | open |\n",
    "edit-fix-list.md": "# Edit Fix List\n\n| section/timecode | problem | fix | priority | status |\n| --- | --- | --- | --- | --- |\n| rough cut | No edit fixes noted beyond adding visual support. | Repair this before the second cut. | high | open |\n",
    ...overrides.files,
  });
  fs.writeFileSync(path.join(runDir, "media", "rough-cut-v1.mp4"), "fake", "utf8");
  fs.utimesSync(indexPath, new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));
  return { tempRoot, runId, runDir, indexPath, statePath: path.join(runDir, "package-run-state.md") };
}

test("production GPS model builds current location human gate and blocked actions", () => {
  const fixture = createProductionGpsFixture();

  const gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(gps.readOnly, true);
  assert.equal(gps.externalApisCalled, false);
  assert.equal(gps.summary.runId, fixture.runId);
  assert.equal(gps.summary.currentInferredStage, "Needs rough-cut review");
  assert.equal(gps.summary.currentGate, "Pickup / Edit-Fix Planning");
  assert.equal(gps.summary.gateStatus, "needs human review");
  assert.equal(gps.summary.aiMayAct, true);
  assert.equal(gps.humanGate.required, true);
  assert.match(gps.humanGate.decision, /pickup/i);
  assert.match(gps.summary.nextSafeAction, /pickup|rough-cut|second-cut/i);
  assert.equal(gps.blockedActions.includes("mark second-cut ready"), true);
  assert.equal(gps.blockedActions.includes("publish"), true);
  assert.equal(gps.humanGate.aiAllowed.includes("draft pickup placement plan"), true);
  assert.equal(gps.humanGate.aiBlocked.includes("mark second-cut ready"), true);
});

test("production GPS timeline marks current gate and keeps downstream locked", () => {
  const fixture = createProductionGpsFixture();

  const gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  const roughGate = gps.gateTimeline.find((gate) => gate.label === "Rough Cut Review");
  const pickupGate = gps.gateTimeline.find((gate) => gate.label === "Pickup / Edit-Fix Planning");
  const finalGate = gps.gateTimeline.find((gate) => gate.label === "Final Review");

  assert.equal(Boolean(roughGate), true);
  assert.equal(pickupGate.status, "current");
  assert.equal(pickupGate.current, true);
  assert.notEqual(finalGate.status, "done / pass");
  assert.equal(finalGate.status, "not reached");
});

test("production GPS artifact trail classifies source derived state and missing artifacts", () => {
  const fixture = createProductionGpsFixture();

  const gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  const byPath = Object.fromEntries(gps.artifactTrail.items.map((item) => [item.path, item]));

  assert.equal(byPath["rough-cut-watch-notes.md"].kind, "source / human-authored");
  assert.equal(byPath["rough-cut-watch-notes.md"].containsApprovalMarker, true);
  assert.equal(byPath["rough-cut-review.md"].kind, "derived / generated");
  assert.equal(byPath["pickup-list.md"].kind, "derived / generated");
  assert.equal(byPath["edit-fix-list.md"].kind, "derived / generated");
  assert.equal(byPath["package-run-state.md"].kind, "state / lifecycle");
  assert.equal(byPath["final-watch-notes.md"].exists, false);
  assert.equal(byPath["rough-cut-review.md"].safeToRegenerate, true);
  assert.equal(byPath["package-run-state.md"].requiresHumanReview, true);
});

test("production GPS stale rough-cut derived artifact warning is surfaced", () => {
  const fixture = createProductionGpsFixture({
    files: {
      "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut notes source: created starter template\n- Rough-cut review status: BLOCKED\n- Second-cut ready: no\n\n## Second-Cut Readiness Gate\n\n- Status: BLOCKED\n- Reason: rough-cut-watch-notes.md was missing; starter template created.\n",
    },
  });

  const gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(gps.staleWarnings.length, 1);
  assert.match(gps.staleWarnings[0].title, /stale/i);
  assert.match(gps.staleWarnings[0].detail, /NEEDS PICKUPS/);
});

test("production GPS builders are read-only and do not touch index or state files", () => {
  const fixture = createProductionGpsFixture();
  const beforeIndex = fs.readFileSync(fixture.indexPath, "utf8");
  const beforeState = fs.readFileSync(fixture.statePath, "utf8");
  const beforeIndexMtime = fs.statSync(fixture.indexPath).mtimeMs;
  const beforeStateMtime = fs.statSync(fixture.statePath).mtimeMs;

  const gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  packageRunsDashboard.renderProductionGps(gps);

  assert.equal(fs.readFileSync(fixture.indexPath, "utf8"), beforeIndex);
  assert.equal(fs.readFileSync(fixture.statePath, "utf8"), beforeState);
  assert.equal(fs.statSync(fixture.indexPath).mtimeMs, beforeIndexMtime);
  assert.equal(fs.statSync(fixture.statePath).mtimeMs, beforeStateMtime);
});

test("second-cut next action packet reads active run artifacts and surfaces pickups", () => {
  const fixture = createProductionGpsFixture({
    files: {
      "second-cut-visual-support-map.md": "# Second-Cut Visual Support Map\n\nUse `aroll-01-intro-problem.MOV` and `04-proof-plan-checklist.png` as support only.\n",
      "notes.md": "# Package Run Notes\n\nResolve timeline has `04-proof-plan-checklist` and `06-before-after-package-repair` inserts available.\n",
    },
  });

  const packet = packageEngineServer.buildSecondCutNextActionPacket({ runId: fixture.runId }, { root: fixture.tempRoot });
  const html = packageRunsDashboard.renderSecondCutNextActionPacket(packet);

  assert.equal(packet.readOnly, true);
  assert.equal(packet.externalApisCalled, false);
  assert.equal(packet.currentRoughCutStatus, "NEEDS PICKUPS");
  assert.equal(packet.secondCutReady, false);
  assert.match(packet.currentBlocker, /Pickup items are still open/);
  assert.equal(packet.exactPickupNeeds.includes("Maybe add closeups and AI-generated B-roll."), true);
  assert.equal(packet.candidateMediaSourcePaths.some((item) => /aroll-01-intro-problem\.MOV/.test(item)), true);
  assert.equal(packet.groupedMediaSourcePaths.some((group) => group.key === "supportMapReferences" && group.paths.some((item) => /aroll-01-intro-problem\.MOV/.test(item))), true);
  assert.equal(packet.artifactBackedFacts.some((fact) => fact.label === "Rough-cut status" && fact.source === "rough-cut-review.md"), true);
  assert.match(packet.inferredGuidance.source, /not quoted from a source artifact/);
  assert.match(packet.inferredGuidance.nextVisibleAction, /First inspect the reviewed rough cut or current Resolve timeline/);
  assert.match(packet.inferredGuidance.nextVisibleAction, /place it in Resolve/);
  assert.match(packet.inferredGuidance.nextVisibleAction, /only after the pickup\/edit work is represented in the timeline/);
  assert.equal(packet.supportingArtifacts.some((item) => item.filename === "rough-cut-review.md" && item.status === "present"), true);
  assert.match(packet.mustNotApproveYet.join("\n"), /second-cut ready/);
  assert.match(packet.mustNotApproveYet.join("\n"), /publish ready/);
  assert.match(html, /Next Action Packet/);
  assert.match(html, /Not second-cut ready/);
  assert.match(html, /NEEDS PICKUPS/);
  assert.match(html, /Maybe add closeups and AI-generated B-roll/);
  assert.match(html, /Artifact-backed facts/);
  assert.match(html, /Dashboard-inferred guidance/);
  assert.match(html, /not quoted from a source artifact/);
  assert.match(html, /Grouped media\/source paths/);
  assert.match(html, /support-map references/);
  assert.match(html, /reviewed rough cut/);
  assert.match(html, /rough-cut-review\.md/);
  assert.match(html, /second-cut-visual-support-map\.md/);
  assert.match(html, /Blocked approvals \/ forbidden actions/);
  assert.match(html, /package-runs-index\.json is older/);
  assert.doesNotMatch(html, /Candidate media \/ source paths/);
  assert.doesNotMatch(html, /data-save-second-cut|data-apply|data-approve|data-publish/);
});

test("second-cut next action packet handles missing artifacts safely", () => {
  const fixture = createProductionGpsFixture();
  for (const filename of ["pickup-list.md", "edit-fix-list.md", "second-cut-visual-support-map.md", "notes.md"]) {
    const filePath = path.join(fixture.runDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  const packet = packageEngineServer.buildSecondCutNextActionPacket({ runId: fixture.runId }, { root: fixture.tempRoot });
  const html = packageRunsDashboard.renderSecondCutNextActionPacket(packet);
  const artifactStatus = Object.fromEntries(packet.supportingArtifacts.map((item) => [item.filename, item.status]));

  assert.equal(artifactStatus["pickup-list.md"], "missing");
  assert.equal(artifactStatus["edit-fix-list.md"], "missing");
  assert.equal(artifactStatus["second-cut-visual-support-map.md"], "missing");
  assert.equal(artifactStatus["notes.md"], "missing");
  assert.match(packet.exactPickupNeeds[0], /pickup item\(s\) detected in current rough-cut watch notes/);
  assert.equal(packet.groupedMediaSourcePaths.some((group) => group.paths.includes("missing")), true);
  assert.match(html, /pickup-list\.md/);
  assert.match(html, /missing/);
  assert.match(html, /Artifact-backed facts/);
  assert.match(html, /Dashboard-inferred guidance/);
  assert.match(html, /Blocked approvals \/ forbidden actions/);
});

test("second-cut next action packet is included in rough-cut dashboard status and does not mutate durable files", () => {
  const fixture = createProductionGpsFixture({
    files: {
      "second-cut-visual-support-map.md": "# Second-Cut Visual Support Map\n\nCandidate source: `aroll-01-intro-problem.MOV`.\n",
      "notes.md": "# Notes\n\nMikko should watch the Resolve spine cut.\n",
    },
  });
  const trackedFiles = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "rough-cut-review.md"),
    path.join(fixture.runDir, "pickup-list.md"),
    path.join(fixture.runDir, "edit-fix-list.md"),
    path.join(fixture.runDir, "second-cut-visual-support-map.md"),
    path.join(fixture.runDir, "notes.md"),
  ];
  const before = Object.fromEntries(trackedFiles.map((filePath) => [filePath, {
    text: fs.readFileSync(filePath, "utf8"),
    mtime: fs.statSync(filePath).mtimeMs,
  }]));
  const repoRoot = path.resolve(__dirname, "..");
  const gitHead = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  const brainPath = "/home/vidtoolz/hermes-organiser/brain/index.json";
  const brainBefore = fs.existsSync(brainPath) ? fs.statSync(brainPath).mtimeMs : null;

  const status = packageEngineServer.buildRoughCutStatus({ runId: fixture.runId }, { root: fixture.tempRoot });
  const html = packageRunsDashboard.renderMikkoInputConsole(status);

  assert.equal(Boolean(status.secondCutNextActionPacket), true);
  assert.match(html, /Second-cut next action packet/i);
  assert.match(html, /Dashboard-inferred guidance/);
  assert.match(html, /Next visible action/);
  for (const filePath of trackedFiles) {
    assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath].text);
    assert.equal(fs.statSync(filePath).mtimeMs, before[filePath].mtime);
  }
  assert.equal(childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }), gitHead);
  if (brainBefore !== null) assert.equal(fs.statSync(brainPath).mtimeMs, brainBefore);
});

function createSecondCutInspectorFixture(overrides = {}) {
  const fixture = createProductionGpsFixture(overrides);
  const videoRoot = path.join(fixture.tempRoot, "Videos");
  const pickupDir = path.join(videoRoot, "vidtoolz-captures", fixture.runId, "20260517-pickups-visual-variety");
  fs.mkdirSync(pickupDir, { recursive: true });
  return { ...fixture, videoRoot, pickupDir };
}

test("second cut inspector reports no candidate conservatively", () => {
  const fixture = createSecondCutInspectorFixture();

  const inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(inspector.ok, true);
  assert.equal(inspector.readOnly, true);
  assert.equal(inspector.externalApisCalled, false);
  assert.equal(inspector.candidateStatus, "not_found");
  assert.equal(inspector.humanGateRequired, true);
  assert.equal(inspector.secondCutReady, false);
  assert.equal(inspector.blockedActions.includes("mark second-cut ready"), true);
  assert.match(inspector.nextSafeAction, /export or identify a second-cut candidate/i);
});

test("second cut registration preflight reports missing candidate registration", () => {
  const fixture = createSecondCutInspectorFixture();

  const preflight = packageEngineServer.buildSecondCutCandidatePreflight({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(preflight.ok, true);
  assert.equal(preflight.readOnly, true);
  assert.equal(preflight.roughCutStatus, "NEEDS PICKUPS");
  assert.equal(preflight.registeredCandidateStatus, "missing");
  assert.equal(preflight.candidateFileStatus, "missing");
  assert.equal(preflight.secondCutReady, false);
  assert.match(preflight.humanReviewStatus, /not_started|watch_notes_missing/);
  assert.match(preflight.nextSafeAction, /export.*register/i);
  assert.deepEqual(preflight.downstreamStatus, {
    finalReview: "blocked",
    exportDelivery: "blocked",
    publishMetadata: "blocked",
    archive: "blocked",
  });
});

test("second cut registration preflight reports registered candidate with existing file", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });

  const preflight = packageEngineServer.buildSecondCutCandidatePreflight({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(preflight.registeredCandidateStatus, "registered");
  assert.equal(preflight.candidateFileStatus, "exists");
  assert.equal(preflight.inspectionStatus, "found_needs_review");
  assert.equal(preflight.humanReviewStatus, "watch_notes_missing");
  assert.equal(preflight.secondCutReady, false);
  assert.equal(preflight.downstreamStatus.finalReview, "blocked");
  assert.equal(preflight.downstreamStatus.archive, "blocked");
});

test("second cut registration preflight warns for registered missing file", () => {
  const fixture = createSecondCutInspectorFixture();
  const missingPath = path.join(fixture.tempRoot, "exports", "missing-second-cut.mp4");
  fs.writeFileSync(path.join(fixture.runDir, "second-cut-candidate.md"), `# Second-Cut Candidate\n\n- Path: ${missingPath}\n- Review status: READY FOR HUMAN REVIEW\n- Second-cut ready: no\n`, "utf8");

  const preflight = packageEngineServer.buildSecondCutCandidatePreflight({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(preflight.registeredCandidateStatus, "registered_missing_file");
  assert.equal(preflight.candidateFileStatus, "missing");
  assert.equal(preflight.secondCutReady, false);
  assert.equal(preflight.warnings.some((warning) => /missing/i.test(warning)), true);
  assert.match(preflight.nextSafeAction, /fix|re-register|locate/i);
});

test("second cut registration preflight reports missing watch notes after registration", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });

  const status = packageEngineServer.buildRoughCutStatus({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });
  const html = packageRunsDashboard.renderSecondCutRegistrationPreflight(status.secondCutCandidatePreflight);

  assert.equal(status.secondCutCandidatePreflight.humanReviewStatus, "watch_notes_missing");
  assert.match(html, /Human review is still required/);
});

test("second cut registration preflight surfaces missing or stale derived review", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath, decisionMarker: "NEEDS EDIT FIXES" }) }, { root: fixture.tempRoot });

  let preflight = packageEngineServer.buildSecondCutCandidatePreflight({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });
  assert.equal(preflight.humanReviewStatus, "derived_review_missing");
  assert.equal(preflight.secondCutReady, false);
  assert.equal(preflight.warnings.some((warning) => /derived second-cut review missing/i.test(warning)), true);

  fs.writeFileSync(path.join(fixture.runDir, "second-cut-review.md"), "# Second-Cut Review\n\n- Review status: READY FOR SECOND CUT\n- Second-cut ready: yes\n", "utf8");
  preflight = packageEngineServer.buildSecondCutCandidatePreflight({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });
  assert.equal(preflight.humanReviewStatus, "derived_review_missing");
  assert.equal(preflight.secondCutReady, false);
  assert.equal(preflight.warnings.some((warning) => /stale|conflict/i.test(warning)), true);
});

test("second cut registration preflight requires exact derived READY FOR SECOND CUT", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  fs.writeFileSync(path.join(fixture.runDir, "second-cut-watch-notes.md"), "# Second-Cut Watch Notes\n\nLooks good. Candidate exists and metadata is available.\n", "utf8");

  const preflight = packageEngineServer.buildSecondCutCandidatePreflight({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(preflight.candidateFileStatus, "exists");
  assert.equal(preflight.registeredCandidateStatus, "registered");
  assert.notEqual(preflight.humanReviewStatus, "ready_for_second_cut");
  assert.equal(preflight.secondCutReady, false);
});

test("second cut registration preflight shows ready marker path without unblocking downstream gates", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath, decisionMarker: "READY FOR SECOND CUT" }) }, { root: fixture.tempRoot });
  packageEngineServer.regenerateSecondCutReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });

  const preflight = packageEngineServer.buildSecondCutCandidatePreflight({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(preflight.humanReviewStatus, "ready_for_second_cut");
  assert.equal(preflight.secondCutReady, true);
  assert.equal(preflight.downstreamStatus.finalReview, "blocked");
  assert.equal(preflight.downstreamStatus.exportDelivery, "blocked");
  assert.equal(preflight.downstreamStatus.publishMetadata, "blocked");
  assert.equal(preflight.downstreamStatus.archive, "blocked");
});

test("second cut suggested filename helper is display only", () => {
  const fixture = createSecondCutInspectorFixture();
  const suggestion = packageEngineServer.suggestSecondCutCandidateExportTarget("2026-05-06-ai-video-proof-plan", {
    videoRoot: "/home/vidtoolz/Videos",
  });

  assert.equal(suggestion.expectedCandidateFolder, "/home/vidtoolz/Videos/vidtoolz-captures/2026-05-06-ai-video-proof-plan/second-cut-candidates");
  assert.equal(suggestion.expectedCandidateFilename, "2026-05-06-ai-video-proof-plan-second-cut-candidate-01.mp4");
  assert.equal(fs.existsSync(path.join(fixture.videoRoot, "vidtoolz-captures", fixture.runId, "second-cut-candidates")), false);
});

test("dashboard renders Second-Cut Registration Preflight boundaries", () => {
  const html = packageRunsDashboard.renderSecondCutRegistrationPreflight({
    runId: "2026-05-06-ai-video-proof-plan",
    expectedCandidateFolder: "/home/vidtoolz/Videos/vidtoolz-captures/2026-05-06-ai-video-proof-plan/second-cut-candidates",
    expectedCandidateFilename: "2026-05-06-ai-video-proof-plan-second-cut-candidate-01.mp4",
    enteredCandidatePathStatus: "missing",
    registeredCandidateStatus: "missing",
    candidateFileStatus: "missing",
    inspectionStatus: "not_found",
    humanReviewStatus: "not_started",
    secondCutReady: false,
    nextSafeAction: "Export second-cut candidate from Resolve, then register it for human review.",
    downstreamStatus: { finalReview: "blocked", exportDelivery: "blocked", publishMetadata: "blocked", archive: "blocked" },
    aiAllowed: ["inspect metadata"],
    aiBlocked: ["mark second-cut ready"],
    warnings: ["Second-cut candidate is not registered."],
  });

  assert.match(html, /Second-Cut Registration Preflight/);
  assert.match(html, /2026-05-06-ai-video-proof-plan-second-cut-candidate-01\.mp4/);
  assert.match(html, /Candidate exported/);
  assert.match(html, /Candidate registered/);
  assert.match(html, /Human review/);
  assert.match(html, /Second-cut approval/);
  assert.match(html, /Registration is not approval/);
  assert.match(html, /Human review is still required/);
  assert.match(html, /Second-cut ready is not granted by file existence/);
  assert.match(html, /Final\/export\/publish\/archive remain blocked/);
});

test("second cut registration preflight is read-only for package-run artifacts media index and state", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  const files = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "rough-cut-watch-notes.md"),
    path.join(fixture.runDir, "rough-cut-review.md"),
    path.join(fixture.runDir, "pickup-list.md"),
    path.join(fixture.runDir, "edit-fix-list.md"),
    candidatePath,
  ];
  const before = Object.fromEntries(files.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));
  const beforeMtimes = Object.fromEntries(files.map((filePath) => [filePath, fs.statSync(filePath).mtimeMs]));

  const preflight = packageEngineServer.buildSecondCutCandidatePreflight({ runId: fixture.runId, candidatePath }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });
  packageRunsDashboard.renderSecondCutRegistrationPreflight(preflight);

  files.forEach((filePath) => {
    assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath]);
    assert.equal(fs.statSync(filePath).mtimeMs, beforeMtimes[filePath]);
  });
  assert.equal(fs.existsSync(path.join(fixture.runDir, "second-cut-candidate.md")), false);
});

test("second cut inspector reports fake candidate without crashing on metadata failure", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.runDir, "media", "second-cut-candidate-v2.mp4");
  fs.writeFileSync(candidatePath, "not a real mp4", "utf8");

  const inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(inspector.candidateStatus, "found_needs_review");
  assert.equal(inspector.candidates.length, 1);
  assert.equal(inspector.candidates[0].exists, true);
  assert.equal(inspector.candidates[0].likelyRole, "second-cut candidate");
  assert.equal(inspector.candidates[0].confidence, "high");
  assert.equal(inspector.candidates[0].metadataUnavailable, true);
  assert.equal(inspector.humanGateRequired, true);
  assert.equal(inspector.secondCutReady, false);
});

test("second cut inspector discovers and classifies pickup media by filename", () => {
  const fixture = createSecondCutInspectorFixture();
  [
    "keyboard-mouse-process.MOV",
    "hands-on-notes-checklist.MOV",
    "over-shoulder-context.MOV",
    "silent-talking-head-reset.MOV",
  ].forEach((filename) => fs.writeFileSync(path.join(fixture.pickupDir, filename), "fake mov", "utf8"));

  const inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });
  const byName = Object.fromEntries(inspector.pickupMedia.map((item) => [path.basename(item.path), item]));

  assert.equal(byName["keyboard-mouse-process.MOV"].likelyCategory, "hands");
  assert.equal(byName["hands-on-notes-checklist.MOV"].likelyCategory, "notes/checklist");
  assert.equal(byName["over-shoulder-context.MOV"].likelyCategory, "over-shoulder");
  assert.equal(byName["silent-talking-head-reset.MOV"].likelyCategory, "talking-head presence");
  assert.equal(inspector.pickupMedia.every((item) => item.humanReviewRequired === true), true);
});

test("second cut inspector links pickup requirements from rough-cut artifacts", () => {
  const fixture = createSecondCutInspectorFixture({
    files: {
      "edit-fix-list.md": "# Edit Fix List\n\n| section/timecode | problem | fix | priority | status |\n| --- | --- | --- | --- | --- |\n| None. | No edit fixes detected from watch notes. | No fix needed. | low | closed |\n",
    },
  });

  const inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(inspector.pickupRequirements.roughCutStatus, "NEEDS PICKUPS");
  assert.equal(inspector.pickupRequirements.secondCutReady, false);
  assert.equal(inspector.pickupRequirements.sourceWatchNoteMarker, "NEEDS PICKUPS");
  assert.equal(inspector.pickupRequirements.pickupListStatus, "open");
  assert.equal(inspector.pickupRequirements.editFixListStatus, "closed");
  assert.equal(inspector.humanGateRequired, true);
});

test("second cut inspector placement checklist stays manual and non-approving", () => {
  const checklist = packageEngineServer.buildSecondCutPlacementChecklist();
  const text = checklist.join("\n");

  assert.match(text, /over-shoulder\/context shot appears early enough/);
  assert.match(text, /keyboard\/mouse clip is used/);
  assert.match(text, /hands-on-notes clip is used/);
  assert.match(text, /not approved until Mikko reviews/);
  assert.doesNotMatch(text, /automatic pass|auto-pass|approved by AI/i);
});

test("second cut inspector is read-only for index state and package-run artifacts", () => {
  const fixture = createSecondCutInspectorFixture();
  const files = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "rough-cut-watch-notes.md"),
    path.join(fixture.runDir, "rough-cut-review.md"),
    path.join(fixture.runDir, "pickup-list.md"),
    path.join(fixture.runDir, "edit-fix-list.md"),
  ];
  const before = Object.fromEntries(files.map((filePath) => [filePath, {
    text: fs.readFileSync(filePath, "utf8"),
    mtime: fs.statSync(filePath).mtimeMs,
  }]));

  const inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });
  packageRunsDashboard.renderSecondCutInspector(inspector);

  files.forEach((filePath) => {
    assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath].text);
    assert.equal(fs.statSync(filePath).mtimeMs, before[filePath].mtime);
  });
});

test("second cut candidate preview validates candidate and writes nothing", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  const beforeRunFiles = fs.readdirSync(fixture.runDir).sort();

  const preview = packageEngineServer.buildSecondCutCandidateRegistration({
    runId: fixture.runId,
    candidatePath,
    notes: "Exported from Resolve for review.",
  }, { root: fixture.tempRoot, mode: "preview" });

  assert.equal(preview.ok, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.externalApisCalled, false);
  assert.equal(preview.candidatePath, candidatePath);
  assert.equal(preview.candidateExists, true);
  assert.equal(preview.secondCutReady, false);
  assert.equal(preview.roughCutApproved, false);
  assert.equal(preview.humanGateRequired, true);
  assert.equal(preview.artifactFilename, "second-cut-candidate.md");
  assert.match(preview.artifactPreview, new RegExp(candidatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(fs.readdirSync(fixture.runDir).sort(), beforeRunFiles);
});

test("second cut candidate preview rejects invalid input", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "candidate.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake", "utf8");
  const candidateDir = path.join(fixture.tempRoot, "exports", "folder.mov");
  fs.mkdirSync(candidateDir, { recursive: true });
  const badExtension = path.join(fixture.tempRoot, "exports", "candidate.txt");
  fs.writeFileSync(badExtension, "fake", "utf8");

  assert.throws(() => packageEngineServer.buildSecondCutCandidateRegistration({ candidatePath }, { root: fixture.tempRoot }), /runId is required/);
  assert.throws(() => packageEngineServer.buildSecondCutCandidateRegistration({ runId: "../escape", candidatePath }, { root: fixture.tempRoot }), /Invalid package-run id/);
  assert.throws(() => packageEngineServer.buildSecondCutCandidateRegistration({ runId: fixture.runId }, { root: fixture.tempRoot }), /candidate path is required/i);
  assert.throws(() => packageEngineServer.buildSecondCutCandidateRegistration({ runId: fixture.runId, candidatePath: "relative.mp4" }, { root: fixture.tempRoot }), /absolute path/i);
  assert.throws(() => packageEngineServer.buildSecondCutCandidateRegistration({ runId: fixture.runId, candidatePath: path.join(fixture.tempRoot, "missing.mp4") }, { root: fixture.tempRoot }), /does not exist/i);
  assert.throws(() => packageEngineServer.buildSecondCutCandidateRegistration({ runId: fixture.runId, candidatePath: candidateDir }, { root: fixture.tempRoot }), /must be a file/i);
  assert.throws(() => packageEngineServer.buildSecondCutCandidateRegistration({ runId: fixture.runId, candidatePath: badExtension }, { root: fixture.tempRoot }), /Unsupported second-cut candidate extension/i);
});

test("second cut candidate apply writes only the allowed artifact", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  const protectedFiles = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "rough-cut-watch-notes.md"),
    path.join(fixture.runDir, "rough-cut-review.md"),
    path.join(fixture.runDir, "pickup-list.md"),
    path.join(fixture.runDir, "edit-fix-list.md"),
    candidatePath,
  ];
  const before = Object.fromEntries(protectedFiles.map((filePath) => [filePath, {
    text: fs.readFileSync(filePath, "utf8"),
    mtime: fs.statSync(filePath).mtimeMs,
  }]));

  const result = packageEngineServer.applySecondCutCandidateRegistration({
    runId: fixture.runId,
    candidatePath,
  }, { root: fixture.tempRoot });

  assert.equal(result.ok, true);
  assert.equal(result.readOnly, false);
  assert.deepEqual(result.written, ["second-cut-candidate.md"]);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "second-cut-candidate.md")), true);
  protectedFiles.forEach((filePath) => {
    assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath].text);
    assert.equal(fs.statSync(filePath).mtimeMs, before[filePath].mtime);
  });
});

test("second cut candidate apply artifact remains non-approving", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");

  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  const artifact = fs.readFileSync(path.join(fixture.runDir, "second-cut-candidate.md"), "utf8");

  assert.match(artifact, /Review status: READY FOR HUMAN REVIEW/);
  assert.match(artifact, /Second-cut ready: no/);
  assert.doesNotMatch(artifact, /Rough-cut approval:\s*PASS/i);
  assert.doesNotMatch(artifact, /Second-cut ready:\s*yes/i);
  assert.doesNotMatch(artifact, /Final review:\s*PASS/i);
  assert.doesNotMatch(artifact, /(?:publish|export|upload|archive)[ -]ready:\s*(?:yes|PASS|READY)/i);
});

test("second cut candidate apply preserves manual content outside managed section", () => {
  const fixture = createSecondCutInspectorFixture();
  const artifactPath = path.join(fixture.runDir, "second-cut-candidate.md");
  const firstCandidate = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  const secondCandidate = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v3.mp4");
  fs.mkdirSync(path.dirname(firstCandidate), { recursive: true });
  fs.writeFileSync(firstCandidate, "fake second cut", "utf8");
  fs.writeFileSync(secondCandidate, "fake second cut update", "utf8");
  fs.writeFileSync(artifactPath, "# Second-Cut Candidate\n\n## Manual Notes\n\nKeep this manual note.\n", "utf8");

  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath: firstCandidate }, { root: fixture.tempRoot });
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath: secondCandidate }, { root: fixture.tempRoot });
  const artifact = fs.readFileSync(artifactPath, "utf8");

  assert.match(artifact, /Keep this manual note/);
  assert.match(artifact, new RegExp(secondCandidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(artifact, new RegExp(firstCandidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("second cut inspector reads registered candidate", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });

  const inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(inspector.candidateStatus, "found_needs_review");
  assert.equal(inspector.registeredCandidate.path, candidatePath);
  assert.equal(inspector.candidates[0].path, candidatePath);
  assert.equal(inspector.secondCutReady, false);
  assert.equal(inspector.humanGateRequired, true);
  assert.equal(inspector.blockedActions.includes("mark second-cut ready"), true);
});

test("second cut inspector warns when registered candidate file is missing", () => {
  const fixture = createSecondCutInspectorFixture();
  const missingPath = path.join(fixture.tempRoot, "exports", "missing-second-cut.mp4");
  fs.writeFileSync(path.join(fixture.runDir, "second-cut-candidate.md"), `# Second-Cut Candidate\n\n<!-- second-cut-candidate:start -->\n- Path: ${missingPath}\n- Exists: yes\n<!-- second-cut-candidate:end -->\n`, "utf8");

  const inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(inspector.candidateStatus, "missing_registered_file");
  assert.equal(inspector.secondCutReady, false);
  assert.equal(inspector.warnings.some((warning) => /registered second-cut candidate file is missing/i.test(warning)), true);
});

test("production GPS shifts to second-cut candidate review for registered candidate without approving", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });

  const gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, {
    root: fixture.tempRoot,
    videoRoot: fixture.videoRoot,
  });

  assert.equal(gps.summary.currentGate, "Second-Cut Candidate Review");
  assert.equal(gps.summary.mikkoApprovalRequired, true);
  assert.equal(gps.blockedActions.includes("mark second-cut ready"), true);
  assert.equal(gps.blockedActions.includes("publish"), true);
  assert.match(gps.summary.nextSafeAction, /watch the registered second-cut candidate/i);
});

function secondCutWatchFields(overrides = {}) {
  const pick = (key, fallback) => Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;
  return {
    candidatePath: pick("candidatePath", "/tmp/second-cut-candidate-v2.mp4"),
    watchDate: pick("watchDate", "2026-05-17"),
    reviewer: pick("reviewer", "Mikko"),
    openingNotes: pick("openingNotes", "Opening is clearer."),
    pickupPlacementNotes: pick("pickupPlacementNotes", "Pickup inserts are visible but need review."),
    screenOnlyStretchNotes: pick("screenOnlyStretchNotes", "Screen-only sections are reduced."),
    pacingClarityNotes: pick("pacingClarityNotes", "Pacing improved."),
    visualTrustDisclosureNotes: pick("visualTrustDisclosureNotes", "Illustrative B-roll is not presented as proof."),
    privacySensitiveNotes: pick("privacySensitiveNotes", "No sensitive details noticed."),
    remainingPickupsNotes: pick("remainingPickupsNotes", "No remaining pickups listed."),
    remainingEditFixesNotes: pick("remainingEditFixesNotes", "No edit fixes listed."),
    decisionMarker: pick("decisionMarker", "NEEDS MORE PICKUPS"),
  };
}

test("second cut watch notes parser respects exact markers only", () => {
  const needsPickups = packageEngineServer.parseSecondCutWatchNotes("Second-cut review marker: NEEDS MORE PICKUPS");
  const needsFixes = packageEngineServer.parseSecondCutWatchNotes("Second-cut review marker: NEEDS EDIT FIXES");
  const ready = packageEngineServer.parseSecondCutWatchNotes("Second-cut review marker: READY FOR SECOND CUT");
  const missing = packageEngineServer.parseSecondCutWatchNotes("Notes are positive and all checklist items look done.");

  assert.equal(needsPickups.status, "NEEDS MORE PICKUPS");
  assert.equal(needsPickups.secondCutReady, false);
  assert.equal(needsFixes.status, "NEEDS EDIT FIXES");
  assert.equal(needsFixes.secondCutReady, false);
  assert.equal(ready.status, "READY FOR SECOND CUT");
  assert.equal(ready.secondCutReady, true);
  assert.equal(missing.status, "NEEDS HUMAN REVIEW");
  assert.equal(missing.secondCutReady, false);
});

test("second cut watch notes save writes only source artifact", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  const protectedFiles = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "rough-cut-watch-notes.md"),
    path.join(fixture.runDir, "rough-cut-review.md"),
    path.join(fixture.runDir, "pickup-list.md"),
    path.join(fixture.runDir, "edit-fix-list.md"),
    path.join(fixture.runDir, "second-cut-candidate.md"),
  ];
  const before = Object.fromEntries(protectedFiles.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));

  const result = packageEngineServer.saveSecondCutWatchNotes({
    runId: fixture.runId,
    fields: secondCutWatchFields({ candidatePath, decisionMarker: "NEEDS MORE PICKUPS" }),
  }, { root: fixture.tempRoot });

  assert.equal(result.ok, true);
  assert.deepEqual(result.written, ["second-cut-watch-notes.md"]);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "second-cut-watch-notes.md")), true);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "second-cut-review.md")), false);
  protectedFiles.forEach((filePath) => assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath]));
});

test("second cut watch notes save rejects invalid inputs", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");

  assert.throws(() => packageEngineServer.saveSecondCutWatchNotes({ runId: "../escape", fields: secondCutWatchFields({ candidatePath }) }, { root: fixture.tempRoot }), /Invalid package-run id/);
  assert.throws(() => packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath, decisionMarker: "PASS" }) }, { root: fixture.tempRoot }), /Invalid second-cut review marker/);
  assert.throws(() => packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath: "" }) }, { root: fixture.tempRoot }), /candidate file/i);
  assert.throws(() => packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath, reviewer: "" }) }, { root: fixture.tempRoot }), /reviewer/i);
  assert.throws(() => packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath, watchDate: "" }) }, { root: fixture.tempRoot }), /watch date/i);
});

test("second cut derived review generation writes only derived review", () => {
  ["NEEDS MORE PICKUPS", "NEEDS EDIT FIXES", "READY FOR SECOND CUT"].forEach((marker) => {
    const fixture = createSecondCutInspectorFixture();
    const candidatePath = path.join(fixture.tempRoot, "exports", `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`);
    fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
    fs.writeFileSync(candidatePath, "fake second cut", "utf8");
    packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
    packageEngineServer.saveSecondCutWatchNotes({
      runId: fixture.runId,
      fields: secondCutWatchFields({ candidatePath, decisionMarker: marker }),
    }, { root: fixture.tempRoot });
    const beforeNotes = fs.readFileSync(path.join(fixture.runDir, "second-cut-watch-notes.md"), "utf8");
    const beforeCandidate = fs.readFileSync(path.join(fixture.runDir, "second-cut-candidate.md"), "utf8");

    const result = packageEngineServer.regenerateSecondCutReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });
    const review = fs.readFileSync(path.join(fixture.runDir, "second-cut-review.md"), "utf8");

    assert.deepEqual(result.written, ["second-cut-review.md"]);
    assert.equal(result.review.status, marker);
    assert.equal(result.review.secondCutReady, marker === "READY FOR SECOND CUT");
    assert.match(review, new RegExp(`Review status: ${marker}`));
    assert.doesNotMatch(review, /Final review:\s*PASS|publish-ready:\s*yes|upload-ready:\s*yes/i);
    assert.equal(fs.readFileSync(path.join(fixture.runDir, "second-cut-watch-notes.md"), "utf8"), beforeNotes);
    assert.equal(fs.readFileSync(path.join(fixture.runDir, "second-cut-candidate.md"), "utf8"), beforeCandidate);
  });
});

test("second cut readiness requires exact READY FOR SECOND CUT marker", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  fs.writeFileSync(path.join(fixture.runDir, "second-cut-watch-notes.md"), "# Second-Cut Watch Notes\n\nAll good. Checklist done. Candidate exists. Pickup media exists.\n", "utf8");

  const result = packageEngineServer.regenerateSecondCutReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(result.review.status, "NEEDS HUMAN REVIEW");
  assert.equal(result.review.secondCutReady, false);
});

test("second cut watch and review managed sections preserve manual notes", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  fs.writeFileSync(path.join(fixture.runDir, "second-cut-watch-notes.md"), "# Second-Cut Watch Notes\n\n## Manual Notes\n\nKeep source manual note.\n", "utf8");
  fs.writeFileSync(path.join(fixture.runDir, "second-cut-review.md"), "# Second-Cut Review\n\n## Manual Notes\n\nKeep derived manual note.\n", "utf8");

  packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath }) }, { root: fixture.tempRoot });
  packageEngineServer.regenerateSecondCutReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.match(fs.readFileSync(path.join(fixture.runDir, "second-cut-watch-notes.md"), "utf8"), /Keep source manual note/);
  assert.match(fs.readFileSync(path.join(fixture.runDir, "second-cut-review.md"), "utf8"), /Keep derived manual note/);
});

test("second cut inspector surfaces watch notes review and stale derived state", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  let inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, { root: fixture.tempRoot, videoRoot: fixture.videoRoot });
  assert.equal(inspector.secondCutWatchNotesExists, false);
  assert.equal(inspector.secondCutReady, false);
  assert.match(inspector.nextSafeAction, /record second-cut watch notes/i);

  packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath, decisionMarker: "NEEDS MORE PICKUPS" }) }, { root: fixture.tempRoot });
  inspector = packageEngineServer.buildSecondCutInspector({ runId: fixture.runId }, { root: fixture.tempRoot, videoRoot: fixture.videoRoot });
  assert.equal(inspector.secondCutWatchNotesExists, true);
  assert.equal(inspector.secondCutReviewStatus, "NEEDS MORE PICKUPS");
  assert.equal(inspector.secondCutReady, false);
  assert.equal(inspector.warnings.some((warning) => /derived second-cut review missing/i.test(warning)), true);
});

test("production GPS integrates second cut human decisions conservatively", () => {
  const cases = [
    ["NEEDS MORE PICKUPS", "Pickup / Edit-Fix Planning", /remaining pickups/i, false],
    ["NEEDS EDIT FIXES", "Edit Fix Planning", /edit fixes/i, false],
    ["READY FOR SECOND CUT", "Final Candidate Preparation", /register final candidate/i, true],
  ];
  cases.forEach(([marker, gate, actionPattern, ready]) => {
    const fixture = createSecondCutInspectorFixture();
    const candidatePath = path.join(fixture.tempRoot, "exports", `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`);
    fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
    fs.writeFileSync(candidatePath, "fake second cut", "utf8");
    packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
    packageEngineServer.saveSecondCutWatchNotes({ runId: fixture.runId, fields: secondCutWatchFields({ candidatePath, decisionMarker: marker }) }, { root: fixture.tempRoot });
    packageEngineServer.regenerateSecondCutReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });

    const gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot, videoRoot: fixture.videoRoot });

    assert.equal(gps.summary.currentGate, gate);
    assert.match(gps.summary.nextSafeAction, actionPattern);
    assert.equal(gps.secondCutInspector.secondCutReady, ready);
    assert.equal(gps.blockedActions.includes("publish"), true);
    assert.equal(gps.blockedActions.includes("archive"), true);
  });
});

function createFinalReviewFixture(overrides = {}) {
  const fixture = createSecondCutInspectorFixture(overrides);
  const secondCutPath = path.join(fixture.tempRoot, "exports", "second-cut-candidate-v2.mp4");
  fs.mkdirSync(path.dirname(secondCutPath), { recursive: true });
  fs.writeFileSync(secondCutPath, "fake second cut", "utf8");
  packageEngineServer.applySecondCutCandidateRegistration({ runId: fixture.runId, candidatePath: secondCutPath }, { root: fixture.tempRoot });
  packageEngineServer.saveSecondCutWatchNotes({
    runId: fixture.runId,
    fields: secondCutWatchFields({ candidatePath: secondCutPath, decisionMarker: "READY FOR SECOND CUT" }),
  }, { root: fixture.tempRoot });
  packageEngineServer.regenerateSecondCutReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });
  return { ...fixture, secondCutPath };
}

function finalWatchFields(overrides = {}) {
  const pick = (key, fallback) => Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;
  return {
    candidatePath: pick("candidatePath", "/tmp/final-candidate.mp4"),
    watchDate: pick("watchDate", "2026-05-17"),
    reviewer: pick("reviewer", "Mikko"),
    viewerPromiseDelivery: pick("viewerPromiseDelivery", "Viewer promise is delivered clearly."),
    openingStrength: pick("openingStrength", "Opening is strong enough."),
    clarity: pick("clarity", "The message is clear."),
    pacing: pick("pacing", "Pacing works."),
    proofEvidence: pick("proofEvidence", "Proof/evidence is represented accurately."),
    audioQuality: pick("audioQuality", "Audio is acceptable."),
    visualSupport: pick("visualSupport", "Visual support is sufficient."),
    graphicsCaptions: pick("graphicsCaptions", "Graphics and captions are acceptable."),
    titleThumbnailFit: pick("titleThumbnailFit", "Title and thumbnail fit the final cut."),
    ethicalAccuracyRisks: pick("ethicalAccuracyRisks", "No unresolved ethical or accuracy risk noted."),
    uploadMetadataReadiness: pick("uploadMetadataReadiness", "Upload metadata can proceed to separate review."),
    archiveReadiness: pick("archiveReadiness", "Archive readiness can proceed to separate review."),
    remainingFinalFixes: pick("remainingFinalFixes", "No unresolved final fixes listed."),
    decisionMarker: pick("decisionMarker", "NEEDS FINAL FIXES"),
  };
}

test("final candidate preview validates candidate and writes nothing", () => {
  const fixture = createFinalReviewFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  fs.writeFileSync(candidatePath, "fake final", "utf8");
  const beforeRunFiles = fs.readdirSync(fixture.runDir).sort();

  const preview = packageEngineServer.buildFinalCandidateRegistration({
    runId: fixture.runId,
    candidatePath,
    notes: "Final export candidate from Resolve.",
  }, { root: fixture.tempRoot, mode: "preview" });

  assert.equal(preview.ok, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.externalApisCalled, false);
  assert.equal(preview.candidatePath, candidatePath);
  assert.equal(preview.candidateExists, true);
  assert.equal(preview.upstream.secondCutReady, true);
  assert.equal(preview.finalApproved, false);
  assert.equal(preview.publishReady, false);
  assert.equal(preview.humanGateRequired, true);
  assert.equal(preview.artifactFilename, "final-candidate.md");
  assert.match(preview.artifactPreview, new RegExp(candidatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(fs.readdirSync(fixture.runDir).sort(), beforeRunFiles);
});

test("final candidate preview rejects invalid input", () => {
  const fixture = createFinalReviewFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  fs.writeFileSync(candidatePath, "fake", "utf8");
  const candidateDir = path.join(fixture.tempRoot, "exports", "final-folder.mov");
  fs.mkdirSync(candidateDir, { recursive: true });
  const badExtension = path.join(fixture.tempRoot, "exports", "final.txt");
  fs.writeFileSync(badExtension, "fake", "utf8");

  assert.throws(() => packageEngineServer.buildFinalCandidateRegistration({ candidatePath }, { root: fixture.tempRoot }), /runId is required/);
  assert.throws(() => packageEngineServer.buildFinalCandidateRegistration({ runId: "../escape", candidatePath }, { root: fixture.tempRoot }), /Invalid package-run id/);
  assert.throws(() => packageEngineServer.buildFinalCandidateRegistration({ runId: fixture.runId }, { root: fixture.tempRoot }), /candidate path is required/i);
  assert.throws(() => packageEngineServer.buildFinalCandidateRegistration({ runId: fixture.runId, candidatePath: "relative.mp4" }, { root: fixture.tempRoot }), /absolute path/i);
  assert.throws(() => packageEngineServer.buildFinalCandidateRegistration({ runId: fixture.runId, candidatePath: path.join(fixture.tempRoot, "missing.mp4") }, { root: fixture.tempRoot }), /does not exist/i);
  assert.throws(() => packageEngineServer.buildFinalCandidateRegistration({ runId: fixture.runId, candidatePath: candidateDir }, { root: fixture.tempRoot }), /must be a file/i);
  assert.throws(() => packageEngineServer.buildFinalCandidateRegistration({ runId: fixture.runId, candidatePath: badExtension }, { root: fixture.tempRoot }), /Unsupported final candidate extension/i);
});

test("final candidate apply writes only allowed artifact and preserves manual content", () => {
  const fixture = createFinalReviewFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  const secondCandidatePath = path.join(fixture.tempRoot, "exports", "final-candidate-v2.mp4");
  fs.writeFileSync(candidatePath, "fake final", "utf8");
  fs.writeFileSync(secondCandidatePath, "fake final two", "utf8");
  const finalCandidatePath = path.join(fixture.runDir, "final-candidate.md");
  fs.writeFileSync(finalCandidatePath, "# Final Candidate\n\n## Manual Notes\n\nKeep final candidate manual note.\n", "utf8");
  const protectedFiles = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "rough-cut-watch-notes.md"),
    path.join(fixture.runDir, "second-cut-watch-notes.md"),
    path.join(fixture.runDir, "second-cut-review.md"),
    candidatePath,
  ];
  const before = Object.fromEntries(protectedFiles.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));

  const result = packageEngineServer.applyFinalCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  packageEngineServer.applyFinalCandidateRegistration({ runId: fixture.runId, candidatePath: secondCandidatePath }, { root: fixture.tempRoot });
  const artifact = fs.readFileSync(finalCandidatePath, "utf8");

  assert.deepEqual(result.written, ["final-candidate.md"]);
  assert.match(artifact, /Keep final candidate manual note/);
  assert.match(artifact, new RegExp(secondCandidatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(artifact, /Final approved:\s*yes|Publish ready:\s*yes|Final approval:\s*PASS/i);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "final-watch-notes.md")), false);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "final-review.md")), false);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "publication-blockers.md")), false);
  protectedFiles.forEach((filePath) => assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath]));
});

test("final candidate apply blocks when second-cut is not ready", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake final", "utf8");

  const preview = packageEngineServer.buildFinalCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });

  assert.equal(preview.upstream.secondCutReady, false);
  assert.equal(preview.publishReady, false);
  assert.equal(preview.warnings.some((warning) => /second-cut review is not READY FOR SECOND CUT/i.test(warning)), true);
  assert.throws(() => packageEngineServer.applyFinalCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot }), /not READY FOR SECOND CUT/);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "final-candidate.md")), false);
});

test("final-watch notes save writes only source artifact and requires explicit marker", () => {
  const fixture = createFinalReviewFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  fs.writeFileSync(candidatePath, "fake final", "utf8");
  packageEngineServer.applyFinalCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  const protectedFiles = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "final-candidate.md"),
    path.join(fixture.runDir, "second-cut-watch-notes.md"),
    path.join(fixture.runDir, "second-cut-review.md"),
  ];
  const before = Object.fromEntries(protectedFiles.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));

  const saved = packageEngineServer.saveFinalWatchNotes({
    runId: fixture.runId,
    fields: finalWatchFields({ candidatePath, decisionMarker: "PASS" }),
  }, { root: fixture.tempRoot });
  const notes = fs.readFileSync(path.join(fixture.runDir, "final-watch-notes.md"), "utf8");

  assert.deepEqual(saved.written, ["final-watch-notes.md"]);
  assert.match(notes, /Final approval: PASS/);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "final-review.md")), false);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "publication-blockers.md")), false);
  protectedFiles.forEach((filePath) => assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath]));
  assert.throws(() => packageEngineServer.saveFinalWatchNotes({ runId: fixture.runId, fields: finalWatchFields({ candidatePath, decisionMarker: "APPROVED" }) }, { root: fixture.tempRoot }), /Invalid final review marker/);
});

test("final-review derived generation requires exact PASS and required sections", () => {
  const cases = [
    ["NEEDS FINAL FIXES", finalWatchFields({ decisionMarker: "NEEDS FINAL FIXES", remainingFinalFixes: "Fix one title card." }), "NEEDS FINAL FIXES", false],
    ["positive no marker", null, "BLOCKED", false],
    ["PASS missing sections", finalWatchFields({ decisionMarker: "PASS", clarity: "" }), "BLOCKED", false],
    ["PASS complete", finalWatchFields({ decisionMarker: "PASS" }), "PASS", true],
  ];
  cases.forEach(([label, fields, expectedStatus, publishReady]) => {
    const fixture = createFinalReviewFixture();
    const candidatePath = path.join(fixture.tempRoot, "exports", `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`);
    fs.writeFileSync(candidatePath, "fake final", "utf8");
    packageEngineServer.applyFinalCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
    if (fields) {
      packageEngineServer.saveFinalWatchNotes({ runId: fixture.runId, fields: { ...fields, candidatePath } }, { root: fixture.tempRoot });
    } else {
      fs.writeFileSync(path.join(fixture.runDir, "final-watch-notes.md"), "# Final-Watch Notes\n\nEverything is positive. Checklist complete. Candidate exists.\n", "utf8");
    }

    const result = packageEngineServer.regenerateFinalReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });
    const review = fs.readFileSync(path.join(fixture.runDir, "final-review.md"), "utf8");

    assert.deepEqual(result.written, ["final-review.md"]);
    assert.equal(result.review.status, expectedStatus);
    assert.equal(result.review.publishReady, publishReady);
    assert.match(review, new RegExp(`Publish ready: ${publishReady ? "yes" : "no"}`));
    assert.equal(fs.existsSync(path.join(fixture.runDir, "publication-blockers.md")), false);
  });
});

test("final-review derived generation blocks PASS when upstream second-cut is false", () => {
  const fixture = createSecondCutInspectorFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, "fake final", "utf8");
  fs.writeFileSync(path.join(fixture.runDir, "final-candidate.md"), `# Final Candidate\n\n- Path: ${candidatePath}\n`, "utf8");
  packageEngineServer.saveFinalWatchNotes({ runId: fixture.runId, fields: finalWatchFields({ candidatePath, decisionMarker: "PASS" }) }, { root: fixture.tempRoot });

  const result = packageEngineServer.regenerateFinalReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(result.review.status, "BLOCKED");
  assert.equal(result.review.publishReady, false);
  assert.match(result.review.reason, /second-cut review is not READY FOR SECOND CUT/i);
});

test("final review console surfaces stale final-review warnings", () => {
  const fixture = createFinalReviewFixture();
  const candidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  const otherCandidatePath = path.join(fixture.tempRoot, "exports", "final-candidate-other.mp4");
  fs.writeFileSync(candidatePath, "fake final", "utf8");
  fs.writeFileSync(otherCandidatePath, "fake final other", "utf8");
  packageEngineServer.applyFinalCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  packageEngineServer.saveFinalWatchNotes({ runId: fixture.runId, fields: finalWatchFields({ candidatePath, decisionMarker: "PASS" }) }, { root: fixture.tempRoot });
  fs.writeFileSync(path.join(fixture.runDir, "final-review.md"), `# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n- Final version reviewed: ${otherCandidatePath}\n`, "utf8");

  const panel = packageEngineServer.buildFinalReviewConsole({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(panel.staleDerivedReview, true);
  assert.equal(panel.publishReady, true);
  assert.equal(panel.warnings.some((warning) => /stale/i.test(warning) || /missing/i.test(warning)), true);
});

test("production GPS integrates final candidate and final watch gate states", () => {
  const fixture = createFinalReviewFixture();
  let gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  assert.equal(gps.summary.currentGate, "Final Candidate Preparation");
  assert.match(gps.summary.nextSafeAction, /register final candidate/i);

  const candidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  fs.writeFileSync(candidatePath, "fake final", "utf8");
  packageEngineServer.applyFinalCandidateRegistration({ runId: fixture.runId, candidatePath }, { root: fixture.tempRoot });
  gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  assert.equal(gps.summary.currentGate, "Final Watch Review");

  packageEngineServer.saveFinalWatchNotes({ runId: fixture.runId, fields: finalWatchFields({ candidatePath, decisionMarker: "PASS" }) }, { root: fixture.tempRoot });
  gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  assert.equal(gps.summary.currentGate, "Final Review Derivation");

  packageEngineServer.regenerateFinalReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });
  gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  assert.equal(gps.summary.currentGate, "Export Master Preparation");
  assert.match(gps.summary.nextSafeAction, /export\/register master file/i);
  assert.equal(gps.finalReviewConsole.publishReady, true);
  assert.equal(gps.blockedActions.includes("archive"), true);
  assert.equal(gps.blockedActions.includes("publish"), true);
});

test("dashboard renders Final Candidate / Final Watch Review safely", () => {
  const html = packageRunsDashboard.renderFinalCandidateReview({
    runId: "2026-05-17-final-console",
    finalReviewConsole: {
      secondCutReviewStatus: "READY FOR SECOND CUT",
      secondCutReady: true,
      finalCandidatePath: "/tmp/final-candidate.mp4",
      finalCandidateExists: true,
      finalWatchNotesExists: false,
      finalReviewExists: false,
      finalReviewStatus: "NEEDS HUMAN REVIEW",
      publishReady: false,
      humanGateRequired: true,
      aiAllowed: ["inspect file metadata"],
      aiBlocked: ["choose PASS"],
      blockedActions: ["upload", "archive"],
      warnings: ["Final-watch notes missing."],
    },
  });

  assert.match(html, /Final Candidate \/ Final Watch Review/);
  assert.match(html, /data-preview-final-candidate/);
  assert.match(html, /data-save-final-watch-notes/);
  assert.match(html, /data-regenerate-final-review/);
  assert.match(html, /This is the human final approval marker/);
  assert.match(html, /AI allowed/);
  assert.match(html, /AI blocked/);
  assert.match(html, /Blocked Actions/);
});

function createExportDeliveryFixture(overrides = {}) {
  const fixture = createFinalReviewFixture(overrides);
  const finalCandidatePath = path.join(fixture.tempRoot, "exports", "final-candidate.mp4");
  fs.writeFileSync(finalCandidatePath, "fake final", "utf8");
  packageEngineServer.applyFinalCandidateRegistration({ runId: fixture.runId, candidatePath: finalCandidatePath }, { root: fixture.tempRoot });
  packageEngineServer.saveFinalWatchNotes({ runId: fixture.runId, fields: finalWatchFields({ candidatePath: finalCandidatePath, decisionMarker: "PASS" }) }, { root: fixture.tempRoot });
  packageEngineServer.regenerateFinalReviewDerived({ runId: fixture.runId }, { root: fixture.tempRoot });
  fs.writeFileSync(path.join(fixture.runDir, "publication-blockers.md"), "# Publication Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Clear. | None. | closed |\n", "utf8");
  return { ...fixture, finalCandidatePath };
}

function deliveryFields(overrides = {}) {
  const pick = (key, fallback) => Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;
  return {
    masterFilePath: pick("masterFilePath", "/tmp/final-master.mp4"),
    intendedPlatform: pick("intendedPlatform", "YouTube"),
    exportPreset: pick("exportPreset", "YouTube 2160p H.264"),
    containerCodecConfirmation: pick("containerCodecConfirmation", "MP4/H.264 confirmed."),
    resolutionConfirmation: pick("resolutionConfirmation", "3840x2160 confirmed."),
    frameRateConfirmation: pick("frameRateConfirmation", "30 fps confirmed."),
    audioSettingsConfirmation: pick("audioSettingsConfirmation", "AAC 48 kHz stereo confirmed."),
    loudnessStatus: pick("loudnessStatus", "-14 LUFS integrated, true peak below -1 dBTP."),
    captionsStatus: pick("captionsStatus", "Captions reviewed and ready."),
    qcNotes: pick("qcNotes", "Master export checked locally."),
    decisionMarker: pick("decisionMarker", "NEEDS EXPORT CHECK"),
  };
}

test("export master preview validates candidate and writes nothing", () => {
  const fixture = createExportDeliveryFixture();
  const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
  fs.writeFileSync(masterFilePath, "fake master", "utf8");
  const beforeRunFiles = fs.readdirSync(fixture.runDir).sort();

  const preview = packageEngineServer.buildExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot, mode: "preview" });

  assert.equal(preview.ok, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.externalApisCalled, false);
  assert.equal(preview.masterFilePath, masterFilePath);
  assert.equal(preview.masterFileExists, true);
  assert.equal(preview.upstream.finalReviewStatus, "PASS");
  assert.equal(preview.upstream.publishReady, true);
  assert.equal(preview.readyToUpload, false);
  assert.equal(preview.humanGateRequired, true);
  assert.equal(preview.artifactFilename, "master-file-manifest.md");
  assert.match(preview.artifactPreview, new RegExp(masterFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(fs.readdirSync(fixture.runDir).sort(), beforeRunFiles);
});

test("export master preview rejects invalid input", () => {
  const fixture = createExportDeliveryFixture();
  const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
  fs.writeFileSync(masterFilePath, "fake", "utf8");
  const masterDir = path.join(fixture.tempRoot, "exports", "master-folder.mov");
  fs.mkdirSync(masterDir, { recursive: true });
  const badExtension = path.join(fixture.tempRoot, "exports", "master.txt");
  fs.writeFileSync(badExtension, "fake", "utf8");

  assert.throws(() => packageEngineServer.buildExportMasterRegistration({ masterFilePath }, { root: fixture.tempRoot }), /runId is required/);
  assert.throws(() => packageEngineServer.buildExportMasterRegistration({ runId: "../escape", masterFilePath }, { root: fixture.tempRoot }), /Invalid package-run id/);
  assert.throws(() => packageEngineServer.buildExportMasterRegistration({ runId: fixture.runId }, { root: fixture.tempRoot }), /export master path is required/i);
  assert.throws(() => packageEngineServer.buildExportMasterRegistration({ runId: fixture.runId, masterFilePath: "relative.mp4" }, { root: fixture.tempRoot }), /absolute path/i);
  assert.throws(() => packageEngineServer.buildExportMasterRegistration({ runId: fixture.runId, masterFilePath: path.join(fixture.tempRoot, "missing.mp4") }, { root: fixture.tempRoot }), /does not exist/i);
  assert.throws(() => packageEngineServer.buildExportMasterRegistration({ runId: fixture.runId, masterFilePath: masterDir }, { root: fixture.tempRoot }), /must be a file/i);
  assert.throws(() => packageEngineServer.buildExportMasterRegistration({ runId: fixture.runId, masterFilePath: badExtension }, { root: fixture.tempRoot }), /Unsupported export master extension/i);
});

test("export master apply writes only master manifest and preserves manual content", () => {
  const fixture = createExportDeliveryFixture();
  const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
  const secondMaster = path.join(fixture.tempRoot, "exports", "final-master-v2.mp4");
  fs.writeFileSync(masterFilePath, "fake master", "utf8");
  fs.writeFileSync(secondMaster, "fake master two", "utf8");
  fs.writeFileSync(path.join(fixture.runDir, "master-file-manifest.md"), "# Master File Manifest\n\n## Manual Notes\n\nKeep manifest note.\n", "utf8");
  const protectedFiles = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "final-watch-notes.md"),
    path.join(fixture.runDir, "final-review.md"),
    masterFilePath,
  ];
  const before = Object.fromEntries(protectedFiles.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));

  const result = packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot });
  packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath: secondMaster }, { root: fixture.tempRoot });
  const manifest = fs.readFileSync(path.join(fixture.runDir, "master-file-manifest.md"), "utf8");

  assert.deepEqual(result.written, ["master-file-manifest.md"]);
  assert.match(manifest, /Keep manifest note/);
  assert.match(manifest, new RegExp(secondMaster.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(manifest, /Ready to upload:\s*yes|Delivery approval:\s*PASS/i);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "delivery-readiness.md")), false);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "export-checklist.md")), false);
  protectedFiles.forEach((filePath) => assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath]));
});

test("export master apply blocks when final review is not approved", () => {
  const fixture = createFinalReviewFixture();
  const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
  fs.writeFileSync(masterFilePath, "fake master", "utf8");

  const preview = packageEngineServer.buildExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot });

  assert.equal(preview.upstream.publishReady, false);
  assert.throws(() => packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot }), /Final review is not PASS/);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "master-file-manifest.md")), false);
});

test("delivery readiness save writes only delivery artifacts and requires explicit marker", () => {
  const fixture = createExportDeliveryFixture();
  const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
  fs.writeFileSync(masterFilePath, "fake master", "utf8");
  packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot });
  const protectedFiles = [
    fixture.indexPath,
    fixture.statePath,
    path.join(fixture.runDir, "final-watch-notes.md"),
    path.join(fixture.runDir, "final-review.md"),
    path.join(fixture.runDir, "master-file-manifest.md"),
    masterFilePath,
  ];
  const before = Object.fromEntries(protectedFiles.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));

  const saved = packageEngineServer.saveDeliveryReadiness({
    runId: fixture.runId,
    fields: deliveryFields({ masterFilePath, decisionMarker: "PASS" }),
  }, { root: fixture.tempRoot });

  assert.deepEqual(saved.written.sort(), ["caption-check.md", "delivery-readiness.md", "loudness-check.md"]);
  assert.match(fs.readFileSync(path.join(fixture.runDir, "delivery-readiness.md"), "utf8"), /Delivery approval: PASS/);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "export-checklist.md")), false);
  protectedFiles.forEach((filePath) => assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath]));
  assert.throws(() => packageEngineServer.saveDeliveryReadiness({ runId: fixture.runId, fields: deliveryFields({ masterFilePath, decisionMarker: "APPROVED" }) }, { root: fixture.tempRoot }), /Invalid delivery readiness marker/);
});

test("export checklist derived generation requires final pass metadata and delivery approval", () => {
  const cases = [
    ["missing final review", () => createSecondCutInspectorFixture(), "BLOCKED", false],
    ["final not pass", () => createFinalReviewFixture(), "BLOCKED", false],
    ["master missing", () => createExportDeliveryFixture(), "NEEDS EXPORT CHECK", false],
    ["checks missing", () => {
      const fixture = createExportDeliveryFixture();
      const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
      fs.writeFileSync(masterFilePath, "fake master", "utf8");
      packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot });
      return fixture;
    }, "NEEDS EXPORT CHECK", false],
    ["delivery no pass", () => {
      const fixture = createExportDeliveryFixture();
      const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
      fs.writeFileSync(masterFilePath, "fake master", "utf8");
      packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot });
      packageEngineServer.saveDeliveryReadiness({ runId: fixture.runId, fields: deliveryFields({ masterFilePath, decisionMarker: "NEEDS EXPORT CHECK" }) }, { root: fixture.tempRoot });
      return fixture;
    }, "NEEDS EXPORT CHECK", false],
    ["delivery pass", () => {
      const fixture = createExportDeliveryFixture();
      const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
      fs.writeFileSync(masterFilePath, "fake master", "utf8");
      packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot });
      packageEngineServer.saveDeliveryReadiness({ runId: fixture.runId, fields: deliveryFields({ masterFilePath, decisionMarker: "PASS" }) }, { root: fixture.tempRoot });
      return fixture;
    }, "READY TO UPLOAD", true],
  ];
  cases.forEach(([label, makeFixture, expectedStatus, ready]) => {
    const fixture = makeFixture();
    const result = packageEngineServer.regenerateExportChecklistDerived({ runId: fixture.runId }, { root: fixture.tempRoot });
    const checklist = fs.readFileSync(path.join(fixture.runDir, "export-checklist.md"), "utf8");

    assert.deepEqual(result.written, ["export-checklist.md"], label);
    assert.equal(result.review.status, expectedStatus, label);
    assert.equal(result.review.readyToUpload, ready, label);
    assert.match(checklist, new RegExp(`Ready to upload: ${ready ? "yes" : "no"}`));
  });
});

test("export delivery console surfaces stale export checklist warnings", () => {
  const fixture = createExportDeliveryFixture();
  const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
  fs.writeFileSync(masterFilePath, "fake master", "utf8");
  packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot });
  packageEngineServer.saveDeliveryReadiness({ runId: fixture.runId, fields: deliveryFields({ masterFilePath, decisionMarker: "PASS" }) }, { root: fixture.tempRoot });
  fs.writeFileSync(path.join(fixture.runDir, "export-checklist.md"), "# Export Checklist\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n", "utf8");
  fs.unlinkSync(masterFilePath);

  const panel = packageEngineServer.buildExportDeliveryConsole({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(panel.staleDerivedChecklist, true);
  assert.equal(panel.readyToUpload, true);
  assert.equal(panel.warnings.some((warning) => /missing|stale/i.test(warning)), true);
});

test("production GPS integrates export delivery gates conservatively", () => {
  const fixture = createExportDeliveryFixture();
  let gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  assert.equal(gps.summary.currentGate, "Export Master Preparation");

  const masterFilePath = path.join(fixture.tempRoot, "exports", "final-master.mp4");
  fs.writeFileSync(masterFilePath, "fake master", "utf8");
  packageEngineServer.applyExportMasterRegistration({ runId: fixture.runId, masterFilePath }, { root: fixture.tempRoot });
  gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  assert.equal(gps.summary.currentGate, "Export / Delivery Check");

  packageEngineServer.saveDeliveryReadiness({ runId: fixture.runId, fields: deliveryFields({ masterFilePath, decisionMarker: "NEEDS EXPORT CHECK" }) }, { root: fixture.tempRoot });
  packageEngineServer.regenerateExportChecklistDerived({ runId: fixture.runId }, { root: fixture.tempRoot });
  gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  assert.equal(gps.summary.currentGate, "Export Fixes / Delivery Check");

  packageEngineServer.saveDeliveryReadiness({ runId: fixture.runId, fields: deliveryFields({ masterFilePath, decisionMarker: "PASS" }) }, { root: fixture.tempRoot });
  packageEngineServer.regenerateExportChecklistDerived({ runId: fixture.runId }, { root: fixture.tempRoot });
  gps = packageEngineServer.buildProductionGps({ runId: fixture.runId }, { root: fixture.tempRoot });
  assert.equal(gps.summary.currentGate, "Publish Metadata Review");
  assert.equal(gps.exportDeliveryConsole.readyToUpload, true);
  assert.equal(gps.blockedActions.includes("publish"), true);
  assert.equal(gps.blockedActions.includes("archive"), true);
});

test("dashboard renders Export / Delivery Readiness safely", () => {
  const html = packageRunsDashboard.renderExportDeliveryReadiness({
    runId: "2026-05-17-export-console",
    exportDeliveryConsole: {
      finalReviewStatus: "PASS",
      publishReady: true,
      masterFilePath: "/tmp/final-master.mp4",
      masterFileManifestExists: true,
      exportChecklistExists: false,
      loudnessCheckExists: false,
      captionCheckExists: false,
      deliveryReadinessExists: false,
      exportReadinessStatus: "NEEDS EXPORT CHECK",
      readyToUpload: false,
      aiAllowed: ["inspect file metadata"],
      aiBlocked: ["choose delivery PASS"],
      blockedActions: ["upload", "archive"],
      warnings: ["Delivery readiness missing."],
    },
  });

  assert.match(html, /Export \/ Delivery Readiness/);
  assert.match(html, /data-preview-export-master/);
  assert.match(html, /data-save-delivery-readiness/);
  assert.match(html, /data-regenerate-export-checklist/);
  assert.match(html, /This is the human delivery approval marker/);
  assert.match(html, /AI allowed/);
  assert.match(html, /AI blocked/);
  assert.match(html, /Blocked Actions/);
});

test("capture evidence intake preview does not write files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-intake-preview-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-12-preview");
  fs.mkdirSync(runDir, { recursive: true });

  const preview = packageEngineServer.buildCaptureEvidencePreview({
    runId: "2026-05-12-preview",
    fields: captureEvidenceIntakeFields(),
  }, { root: tempRoot });

  assert.equal(preview.ok, true);
  assert.equal(preview.targets.length, 3);
  assert.match(preview.sections["takes-log.md"], /capture-evidence-intake:start/);
  assert.deepEqual(fs.readdirSync(runDir), []);
});

test("capture evidence intake apply rejects path traversal run ids", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-intake-traversal-"));

  assert.throws(
    () => packageEngineServer.applyCaptureEvidenceIntake({
      runId: "../escape",
      fields: captureEvidenceIntakeFields(),
      confirmApply: true,
      previewToken: "bad-token",
    }, { root: tempRoot }),
    /Invalid package-run id/
  );
});

test("capture evidence intake apply rejects missing run folders", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-intake-missing-run-"));

  assert.throws(
    () => packageEngineServer.buildCaptureEvidencePreview({
      runId: "2026-05-12-missing-run",
      fields: captureEvidenceIntakeFields(),
    }, { root: tempRoot }),
    /Package-run folder does not exist/
  );
  assert.equal(fs.existsSync(path.join(tempRoot, "package-runs", "2026-05-12-missing-run")), false);
});

test("capture evidence intake apply rejects unapproved target filenames", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-intake-target-"));
  fs.mkdirSync(path.join(tempRoot, "package-runs", "2026-05-12-target"), { recursive: true });

  assert.throws(
    () => packageEngineServer.buildCaptureEvidencePreview({
      runId: "2026-05-12-target",
      fields: captureEvidenceIntakeFields(),
      targets: ["takes-log.md", "notes.md"],
    }, { root: tempRoot }),
    /Unapproved capture evidence target: notes\.md/
  );
});

test("capture evidence intake apply writes only approved targets and audit log", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-intake-apply-"));
  const runId = "2026-05-12-apply";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Manual Notes\n\nKeep this.\n", "utf8");
  const payload = { runId, fields: captureEvidenceIntakeFields() };
  const preview = packageEngineServer.buildCaptureEvidencePreview(payload, { root: tempRoot });
  const applied = packageEngineServer.applyCaptureEvidenceIntake({
    ...payload,
    previewToken: preview.previewToken,
    confirmApply: true,
  }, { root: tempRoot });

  assert.deepEqual(applied.written.sort(), [
    "audio-capture-checklist.md",
    "capture-evidence-intake-log.md",
    "screen-recording-checklist.md",
    "takes-log.md",
  ]);
  assert.deepEqual(fs.readdirSync(runDir).sort(), [
    "audio-capture-checklist.md",
    "capture-evidence-intake-log.md",
    "notes.md",
    "screen-recording-checklist.md",
    "takes-log.md",
  ]);
  assert.equal(fs.readFileSync(path.join(runDir, "notes.md"), "utf8"), "# Manual Notes\n\nKeep this.\n");
  assert.match(fs.readFileSync(path.join(runDir, "capture-evidence-intake-log.md"), "utf8"), /External APIs called: no/);
});

test("capture evidence intake apply does not make capture review pass without manual approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-intake-review-no-approval-"));
  const runId = "2026-05-12-review-no-approval";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "capture-checklist.md"),
    "# Capture Checklist\n\n- Capture checklist status: NEEDS CAPTURE\n- Ready for rough cut: no\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "missing-shot-tracker.md"),
    "# Missing Shot Tracker\n\n| missing shot/content | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Capture scope reviewed. | No fix needed. | closed |\n",
    "utf8"
  );
  const payload = { runId, fields: captureEvidenceIntakeFields() };
  const preview = packageEngineServer.buildCaptureEvidencePreview(payload, { root: tempRoot });

  const applied = packageEngineServer.applyCaptureEvidenceIntake({
    ...payload,
    previewToken: preview.previewToken,
    confirmApply: true,
  }, { root: tempRoot });

  applied.written.forEach((filename) => {
    assert.doesNotMatch(fs.readFileSync(path.join(runDir, filename), "utf8"), /Capture evidence approval: PASS/);
  });
  assert.equal(packageCaptureEvidenceReviewScript.main([runDir, "--overwrite"]), 0);
  const review = fs.readFileSync(path.join(runDir, "capture-evidence-review.md"), "utf8");

  assert.doesNotMatch(review, /Review status: PASS/);
  assert.match(review, /Capture evidence accepted: no/);
  assert.match(review, /Review status: (?:NEEDS CAPTURE|READY FOR HUMAN APPROVAL)/);
});

test("capture evidence intake apply preserves manual content and updates marked section idempotently", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-intake-idempotent-"));
  const runId = "2026-05-12-idempotent";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const takesPath = path.join(runDir, "takes-log.md");
  fs.writeFileSync(takesPath, "# Takes Log\n\nManual note before section.\n", "utf8");

  const firstPayload = { runId, fields: captureEvidenceIntakeFields({ takeReference: "media/take-01.mov" }) };
  const firstPreview = packageEngineServer.buildCaptureEvidencePreview(firstPayload, { root: tempRoot });
  packageEngineServer.applyCaptureEvidenceIntake({
    ...firstPayload,
    previewToken: firstPreview.previewToken,
    confirmApply: true,
  }, { root: tempRoot });

  const secondPayload = { runId, fields: captureEvidenceIntakeFields({ takeReference: "media/take-02.mov" }) };
  const secondPreview = packageEngineServer.buildCaptureEvidencePreview(secondPayload, { root: tempRoot });
  packageEngineServer.applyCaptureEvidenceIntake({
    ...secondPayload,
    previewToken: secondPreview.previewToken,
    confirmApply: true,
  }, { root: tempRoot });

  const takes = fs.readFileSync(takesPath, "utf8");
  assert.match(takes, /Manual note before section/);
  assert.match(takes, /media\/take-02\.mov/);
  assert.doesNotMatch(takes, /media\/take-01\.mov/);
  assert.equal((takes.match(/capture-evidence-intake:start/g) || []).length, 1);
  assert.equal((takes.match(/capture-evidence-intake:end/g) || []).length, 1);
});

test("evidence intake dashboard UI renders evidence-only controls", () => {
  const html = packageRunsDashboard.renderEvidenceIntakePanel({
    ok: true,
    readOnly: true,
    runId: "2026-05-06-ai-video-proof-plan",
    evidenceStatus: "selected stills exist, Kling candidates missing",
    nextEvidenceAction: "Create Kling MP4s manually, move them to VIDNAS, then record them here.",
    labels: ["EVIDENCE ONLY", "NOT APPROVED", "NOT PRODUCTION READY"],
    existingRows: [],
    fields: {
      mediaTypes: ["kling_candidate", "resolve_timeline_test"],
      sourceCategories: ["generated asset", "Resolve test"],
      statuses: ["exists_on_vidnas", "tested_in_resolve", "missing"],
    },
    allowedWriteFiles: ["capture-evidence-intake-log.md"],
    forbiddenActions: ["mark approved", "mark production_ready", "publish"],
  });

  assert.match(html, /Evidence Intake/);
  assert.match(html, /EVIDENCE ONLY/);
  assert.match(html, /NOT APPROVED/);
  assert.match(html, /NOT PRODUCTION READY/);
  assert.match(html, /data-evidence-field="media_path"/);
  assert.match(html, /data-evidence-preview/);
  assert.match(html, /data-evidence-save disabled/);
  assert.match(html, /Preview validates without writing/);
  assert.match(html, /DO NOT DO/);
});

test("package runs dashboard contains beginning triage cockpit mount", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.html"), "utf8");

  assert.match(html, /id="currentFocusPanel"/);
  assert.match(html, /Creator Cockpit/);
  assert.match(html, /data-dashboard-mode="focus"/);
  assert.match(html, /Focus Mode/);
  assert.match(html, /Full Dashboard/);
  assert.match(html, /id="beginningTriageCockpit"/);
  assert.match(html, /Beginning Triage/);
  assert.match(html, /Status: Not started/);
  assert.match(html, />Start</);
  assert.match(html, /research-first idea triage/);
  assert.match(html, /does not create a package run/);
});

test("package runs dashboard groups advanced panels collapsed by default", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.html"), "utf8");

  assert.match(html, /data-dashboard-group="beginning-triage"/);
  assert.match(html, /data-dashboard-group="active-package-run"/);
  assert.match(html, /data-dashboard-group="capture-rough-cut"/);
  assert.match(html, /data-dashboard-group="final-export"/);
  assert.match(html, /data-dashboard-group="diagnostics"/);
  assert.match(html, /data-dashboard-group="historical-package-runs"/);
  assert.doesNotMatch(html, /data-dashboard-group="beginning-triage" open/);
  assert.doesNotMatch(html, /data-dashboard-group="active-package-run" open/);
  assert.doesNotMatch(html, /data-dashboard-group="capture-rough-cut" open/);
  assert.doesNotMatch(html, /data-dashboard-group="final-export" open/);
  assert.doesNotMatch(html, /data-dashboard-group="historical-package-runs" open/);
  assert.match(html, /id="nextSafeActionPanel"/);
  assert.match(html, /id="evidenceIntakePanel"/);
  assert.match(html, /id="mikkoInputConsole"/);
  assert.match(html, /id="packageRunsGrid"/);
});

test("package runs dashboard Creator Cockpit renders active package-run gates", () => {
  const html = packageRunsDashboard.renderCurrentFocus({
    activeRun: "2026-05-06-ai-video-proof-plan",
    stage: "Capture / b-roll candidate creation",
    nextHumanAction: "Create Kling MP4 candidates and test them in Resolve.",
    blockedUntil: "Resolve test evidence exists.",
    readOnly: true,
  });

  assert.match(html, /data-creator-cockpit/);
  assert.match(html, /Now/);
  assert.match(html, /Capture \/ b-roll candidate creation/);
  assert.match(html, /Next 30-minute action/);
  assert.match(html, /Create Kling MP4 candidates/);
  assert.match(html, /Proof/);
  assert.match(html, /Missing proof/);
  assert.match(html, /AI may/);
  assert.match(html, /Mikko must/);
  assert.match(html, /Blocked actions/);
  assert.match(html, /Open diagnostics/);
});

test("package runs dashboard Creator Cockpit renders exactly eight primary sections", () => {
  const html = packageRunsDashboard.renderCurrentFocus({
    activeRun: "2026-05-06-ai-video-proof-plan",
    stage: "Capture / b-roll candidate creation",
    nextHumanAction: "Create Kling MP4 candidates and test them in Resolve.",
    blockedUntil: "Resolve test evidence exists.",
    readOnly: true,
  });

  assert.equal((html.match(/class="creator-cockpit-section/g) || []).length, 8);
  ["Now", "Next 30-minute action", "Second-cut readiness", "Proof", "Missing proof", "AI may", "Mikko must", "Blocked actions"].forEach((label) => {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  });
});

test("package runs dashboard Creator Cockpit shows second-cut readiness blocker from rough-cut artifacts", () => {
  const html = packageRunsDashboard.renderCurrentFocus({
    activeRun: "2026-05-06-ai-video-proof-plan",
    stage: "Needs rough-cut review",
    nextHumanAction: "Resolve pickup items.",
    blockedUntil: "Rough-cut review is READY FOR SECOND CUT.",
    readOnly: true,
  }, {
    index: {
      runs: [
        {
          runId: "2026-05-06-ai-video-proof-plan",
          status: "Needs rough-cut review",
          workflowBucket: "Needs rough-cut review",
          overallStatus: "BLOCKED",
          firstBlockerReason: "Rough-cut review status is NEEDS PICKUPS, not READY FOR SECOND CUT.",
          path: "package-runs/2026-05-06-ai-video-proof-plan",
          packageRunState: { state: "active", explicit: true, isInactive: false },
          lifecycleGate: {
            roughCutStatus: "NEEDS PICKUPS",
            secondCutReady: false,
            hasRealRoughCutEvidence: true,
          },
          files: {
            rough_cut_review: true,
            rough_cut_watch_notes: true,
            pickup_list: true,
            edit_fix_list: true,
          },
        },
      ],
    },
  });

  const section = html.match(/<section class="creator-cockpit-section creator-cockpit-second-cut[\s\S]*?<\/section>/)[0];
  assert.match(section, /Second-cut readiness/);
  assert.match(section, /blocked/);
  assert.match(section, /NEEDS PICKUPS/);
  assert.match(section, /Required human action/);
  assert.match(section, /rough-cut-review\.md/);
  assert.match(section, /AI cannot approve second-cut readiness/);
});

test("package runs dashboard Creator Cockpit has no mutation controls", () => {
  const html = packageRunsDashboard.renderCurrentFocus({
    activeRun: "2026-05-06-ai-video-proof-plan",
    stage: "Capture / b-roll candidate creation",
    nextHumanAction: "Create Kling MP4 candidates and test them in Resolve.",
    blockedUntil: "Resolve test evidence exists.",
    readOnly: true,
    forbiddenActions: ["mark approved", "mark production_ready", "mark publish_ready"],
  });
  const controlHtml = (html.match(/<button[^>]*>.*?<\/button>|<input[^>]*>|<select[\s\S]*?<\/select>|<textarea[\s\S]*?<\/textarea>/g) || []).join("\n");

  assert.match(controlHtml, /Open diagnostics/);
  assert.doesNotMatch(controlHtml, /save|apply|approval|PASS|production_ready|publish_ready/i);
  assert.doesNotMatch(controlHtml, /data-evidence-save|data-capture-apply|data-save-rough-cut-notes|data-save-pickup-plan|data-apply-final-candidate|data-apply-export-master/);
});

test("package runs dashboard Creator Cockpit summarizes proof without long source paths", () => {
  const html = packageRunsDashboard.renderCurrentFocus({
    activeRun: "2026-05-06-ai-video-proof-plan",
    stage: "Capture / b-roll candidate creation",
    nextHumanAction: "Create Kling MP4 candidates and test them in Resolve.",
    blockedUntil: "Resolve test evidence exists.",
    readOnly: true,
    evidence: [
      { label: "active package run folder", path: "/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-06-ai-video-proof-plan", exists: true },
      { label: "VIDNAS Kling video candidate folder", path: "/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/kling-video-candidates", exists: false },
    ],
    facts: {
      selectedStillCount: 3,
      reviewedPrompt03Count: 32,
      klingVideoCount: 0,
      resolveTestRecorded: false,
    },
  });
  const proofSection = html.match(/<section class="creator-cockpit-section" aria-label="Proof">[\s\S]*?<\/section>/)[0];

  assert.match(proofSection, /source areas visible or detected/);
  assert.match(proofSection, /3 selected stills and 32 reviewed prompt-03 items detected/);
  assert.doesNotMatch(proofSection, /\/home\/vidtoolz|\/mnt\/vidnas_public|package-runs\/2026-05-06-ai-video-proof-plan/);
});

test("package runs dashboard Creator Cockpit chooses next-safe-action over lifecycle diagnostics", () => {
  const html = packageRunsDashboard.renderCurrentFocus({
    activeRun: "2026-05-06-ai-video-proof-plan",
    stage: "Capture / b-roll candidate creation",
    nextHumanAction: "Create Kling MP4 candidates and test them in Resolve.",
    blockedUntil: "Resolve test evidence exists.",
    readOnly: true,
  }, {
    index: {
      runs: [
        {
          runId: "2026-05-06-ai-video-proof-plan",
          status: "Needs rough-cut review",
          workflowBucket: "Needs rough-cut review",
          path: "package-runs/2026-05-06-ai-video-proof-plan",
          packageRunState: { state: "active", explicit: true, isInactive: false },
          lifecycleGate: { captureEvidenceReviewStatus: "PASS", captureEvidenceAccepted: true },
          evidenceGate: { status: "transcript captured; visual proof missing" },
        },
      ],
    },
  });

  assert.match(html, /<strong>Capture \/ b-roll candidate creation<\/strong>/);
  assert.match(html, /Lifecycle index says Needs rough-cut review/);
  assert.match(html, /diagnostic/);
  assert.match(html, /package-runs-index\.json may lag/);
});

test("package runs dashboard Creator Cockpit degrades missing source data conservatively", () => {
  const html = packageRunsDashboard.renderCurrentFocus({}, { beginningState: { stage: "not_started" }, index: { runs: [] } });

  assert.match(html, /Beginning triage available|Needs review/);
  assert.match(html, /Next 30-minute action/);
  assert.match(html, /No proof source is currently visible|No visible proof source reported/);
  assert.match(html, /does not invent readiness|review diagnostics before claiming readiness|Source.*unavailable/i);
});

test("package runs dashboard mode open state toggles both directions", () => {
  const focusState = packageRunsDashboard.dashboardGroupOpenState("focus", false);
  assert.equal(packageRunsDashboard.normalizeDashboardMode(), "focus");
  assert.equal(packageRunsDashboard.normalizeDashboardMode("full"), "full");
  assert.equal(packageRunsDashboard.normalizeDashboardMode("unexpected"), "focus");
  assert.equal(focusState["beginning-triage"], false);
  assert.equal(focusState["active-package-run"], false);
  assert.equal(focusState["capture-rough-cut"], false);
  assert.equal(focusState["historical-package-runs"], false);

  const fullState = packageRunsDashboard.dashboardGroupOpenState("full", false);
  Object.values(fullState).forEach((open) => assert.equal(open, true));

  const restoredFocusState = packageRunsDashboard.dashboardGroupOpenState("focus", false);
  assert.deepEqual(restoredFocusState, focusState);
});

test("package runs dashboard mode open state is stable across repeated toggles", () => {
  const sequence = [
    packageRunsDashboard.dashboardGroupOpenState("focus", false),
    packageRunsDashboard.dashboardGroupOpenState("full", false),
    packageRunsDashboard.dashboardGroupOpenState("focus", false),
    packageRunsDashboard.dashboardGroupOpenState("full", false),
    packageRunsDashboard.dashboardGroupOpenState("focus", false),
  ];

  assert.equal(sequence[0]["beginning-triage"], false);
  assert.equal(sequence[0]["diagnostics"], false);
  assert.equal(sequence[1]["diagnostics"], true);
  assert.equal(sequence[2]["beginning-triage"], false);
  assert.equal(sequence[2]["diagnostics"], false);
  assert.deepEqual(sequence[0], sequence[2]);
  assert.deepEqual(sequence[2], sequence[4]);
});

test("package runs dashboard focus mode restores active package-run focus", () => {
  const activeFocusState = packageRunsDashboard.dashboardGroupOpenState("focus", true);

  assert.equal(activeFocusState["active-package-run"], false);
  assert.equal(activeFocusState["beginning-triage"], false);
  assert.equal(activeFocusState["diagnostics"], false);
  assert.equal(activeFocusState["capture-rough-cut"], false);
  assert.equal(activeFocusState["final-export"], false);
  assert.equal(activeFocusState["historical-package-runs"], false);

  const fullState = packageRunsDashboard.dashboardGroupOpenState("full", true);
  Object.values(fullState).forEach((open) => assert.equal(open, true));
  assert.deepEqual(packageRunsDashboard.dashboardGroupOpenState("focus", true), activeFocusState);
});

test("beginning triage research handoff prompt uses typed topic", () => {
  const topic = "AI video workflows that create output before proof";
  const prompt = packageRunsDashboard.buildBeginningResearchHandoffPrompt(topic);
  const html = packageRunsDashboard.renderBeginningTriageCockpit({
    stage: "topic",
    fields: { topicArea: topic },
  });

  assert.match(prompt, /Research this VIDTOOLZ topic for serious creators: AI video workflows that create output before proof\./);
  assert.match(html, /Research this VIDTOOLZ topic for serious creators: AI video workflows that create output before proof\./);
  assert.doesNotMatch(html, /Research this VIDTOOLZ topic for serious creators: \[topic area\]\./);
});

test("beginning triage research handoff prompt keeps placeholder without topic", () => {
  const prompt = packageRunsDashboard.buildBeginningResearchHandoffPrompt("");
  const html = packageRunsDashboard.renderBeginningTriageCockpit({ stage: "topic" });

  assert.match(prompt, /Research this VIDTOOLZ topic for serious creators: \[topic area\]\./);
  assert.match(html, /Research this VIDTOOLZ topic for serious creators: \[topic area\]\./);
});

test("package runs dashboard shows compact beginning draft reminder in Focus Mode", () => {
  const html = packageRunsDashboard.renderCurrentFocus({}, {
    beginningState: {
      stage: "packaging",
      selectedCandidate: "1",
      selectedPackage: "2",
      fields: {
        topicArea: "AI video workflows that create output before proof",
        candidate1Title: "Proof-first AI workflow",
        package2Title: "Stop Making AI Video Before Proof",
        nextThirtyMinuteAction: "Inspect one existing artifact.",
      },
    },
  });

  assert.match(html, /Creator Cockpit|data-creator-cockpit/);
  assert.match(html, /Shaping promise/);
  assert.match(html, /Inspect one existing artifact/);
  assert.match(html, /data-dashboard-action="open-beginning-triage"/);
  assert.match(html, /Open Beginning Triage/);
});

test("package runs dashboard beginning draft reminder does not override active run focus", () => {
  const html = packageRunsDashboard.renderCurrentFocus({
    activeRun: "2026-05-06-ai-video-proof-plan",
    stage: "Capture / b-roll candidate creation",
    nextHumanAction: "Create Kling MP4 candidates and test them in Resolve.",
    blockedUntil: "Resolve test evidence exists.",
  }, {
    beginningState: {
      stage: "topic",
      fields: { topicArea: "AI video workflow proof gap" },
    },
  });

  assert.match(html, /Active run: 2026-05-06-ai-video-proof-plan/);
  assert.match(html, /Capture \/ b-roll candidate creation/);
  assert.match(html, /active package-run focus remains primary/);
  assert.match(html, /Open Beginning Triage/);
});

test("package runs dashboard draft open control expands Beginning Triage only", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");

  assert.match(html, /data-dashboard-group="beginning-triage"/);
  assert.match(source, /data-dashboard-action="open-beginning-triage"/);
  assert.match(source, /els\.beginningGroup\.open = true/);
  assert.match(source, /data-dashboard-action="open-diagnostics"/);
  assert.match(source, /els\.diagnosticsGroup\.open = true/);
  assert.doesNotMatch(source, /localStorage\.setItem\(EPISODE_FACTORY_STORAGE_KEY/);
});

test("beginning triage cockpit exports storage and render helpers", () => {
  assert.equal(packageRunsDashboard.BEGINNING_TRIAGE_STORAGE_KEY, "vidtoolz-beginning-triage-v1");
  assert.equal(packageRunsDashboard.EPISODE_FACTORY_STORAGE_KEY, "vidtoolz-episode-factory-v1");
  assert.notEqual(packageRunsDashboard.BEGINNING_TRIAGE_STORAGE_KEY, packageRunsDashboard.EPISODE_FACTORY_STORAGE_KEY);
  assert.equal(typeof packageRunsDashboard.beginningTriageInitialState, "function");
  assert.equal(typeof packageRunsDashboard.normalizeBeginningTriageState, "function");
  assert.equal(typeof packageRunsDashboard.renderBeginningTriageCockpit, "function");
});

test("beginning triage cockpit initial render shows Not started and Start", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit();

  assert.match(html, /Beginning Triage/);
  assert.match(html, /Not started/);
  assert.match(html, /data-beginning-action="start"/);
  assert.match(html, />Start</);
  assert.match(html, /Browser-local triage only\. Does not create or promote a package run/);
  assert.match(html, /Discover direction/);
  assert.match(html, /Shape the promise/);
  assert.match(html, /Validate with proof/);
  assert.match(html, /Current step: Not started/);
  assert.match(html, /Current beginning triage card/);
  assert.doesNotMatch(html, /data-package-run-create/);
});

test("beginning triage cockpit renders three high-level phases and one active card", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({ stage: "packaging" });

  assert.match(html, /Discover direction/);
  assert.match(html, /Shape the promise/);
  assert.match(html, /Validate with proof/);
  assert.match(html, /Current step: Packaging Drafts/);
  assert.equal((html.match(/beginning-active-card/g) || []).length, 1);
  assert.match(html, /Upcoming/);
  assert.match(html, /Claim Triage/);
});

test("beginning triage cockpit renders completed selections as compact summaries", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({
    stage: "claim",
    selectedCandidate: "1",
    selectedPackage: "2",
    fields: {
      candidate1Title: "Research-first creator angle",
      candidate1Claim: "Creators should test proof first.",
      rawIdea: "Creators should test a claim before filming. The video shows how to find the proof gap first.",
      package2Title: "Stop Filming Unprovable Ideas",
      package2Promise: "Avoid wasted production.",
    },
  });

  assert.match(html, /beginning-summary-strip/);
  assert.match(html, /Selected candidate/);
  assert.match(html, /Research-first creator angle/);
  assert.match(html, /Rough idea/);
  assert.match(html, /Selected package/);
  assert.match(html, /Stop Filming Unprovable Ideas/);
});

test("beginning triage cockpit starts with topic research before rough idea capture", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({ stage: "topic" });

  assert.match(html, /Current step/);
  assert.match(html, /Topic Research/);
  assert.match(html, /Goal/);
  assert.match(html, /Find a promising direction before asking Mikko to write a rough idea/);
  assert.match(html, /What Mikko needs to do right now/);
  assert.match(html, /Enter a topic, trigger the research handoff, compare three candidates/);
  assert.match(html, /Current allowed actions/);
  assert.match(html, /Topic area \/ problem space/);
  assert.match(html, /Research the topic/);
  assert.match(html, /research handoff/i);
  assert.doesNotMatch(html, /Rough idea, approximately two sentences/);
  assert.doesNotMatch(html, /Minimum viable proof/);
});

test("beginning triage cockpit supports three candidate angles and research again loop", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({ stage: "candidates" });

  assert.match(html, /3 Video Candidate Angles/);
  assert.match(html, /Candidate 1/);
  assert.match(html, /Candidate 2/);
  assert.match(html, /Candidate 3/);
  assert.equal((html.match(/Select this candidate/g) || []).length, 3);
  assert.match(html, /Viewer problem/);
  assert.match(html, /Potential claim/);
  assert.match(html, /Packaging potential/);
  assert.match(html, /Research again/);
  assert.match(html, /user-pasted\/research-handoff results/);
});

test("beginning triage cockpit rough idea follows selected candidate", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({
    stage: "rough_idea",
    selectedCandidate: "2",
    fields: { candidate2Title: "Creator proof angle" },
  });

  assert.match(html, /Two-sentence Rough Idea/);
  assert.match(html, /Selected research candidate/);
  assert.match(html, /Creator proof angle/);
  assert.match(html, /Rough idea, approximately two sentences/);
  assert.match(html, /Continue to YouTube Packaging Drafts/);
  assert.match(html, /Back to candidates/);
  assert.match(html, /Research again/);
  assert.doesNotMatch(html, /Best current claim/);
});

test("beginning triage cockpit packaging stage precedes claim triage", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({ stage: "packaging" });

  assert.match(html, /YouTube Packaging Drafts/);
  assert.match(html, /Generate title \+ thumbnail package/);
  assert.match(html, /Generate more \/ redo packaging/);
  assert.match(html, /Title/);
  assert.match(html, /Thumbnail concept/);
  assert.match(html, /Thumbnail text, 0-4 words/);
  assert.equal((html.match(/Select this package/g) || []).length, 3);
  assert.match(html, /Final title, final thumbnail, and publishing approval remain blocked/);
  assert.doesNotMatch(html, /Best current claim/);
});

test("beginning triage cockpit claim stage follows selected planning package", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({
    stage: "claim",
    selectedPackage: "1",
    fields: { package1Title: "Stop Overclaiming AI Video" },
  });

  assert.match(html, /Claim Triage/);
  assert.match(html, /Turn the packaged rough idea into a testable useful claim/);
  assert.match(html, /Selected planning package/);
  assert.match(html, /Stop Overclaiming AI Video/);
  assert.match(html, /Claim\/proof triage is locked until a planning package is selected/);
  assert.match(html, /Back to packaging/);
});

test("beginning triage cockpit proof stage includes required claim map columns", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({ stage: "proof" });

  ["Claim", "Proof needed", "Existing proof", "Proof gap", "Visual evidence", "Forbidden unless proven"].forEach((column) => {
    assert.match(html, new RegExp(column));
  });
  assert.match(html, /Generated B-roll or conceptual graphics may explain the idea, but cannot carry proof unless the video is specifically about generated media/);
  assert.match(html, /Back to packaging/);
});

test("beginning triage cockpit safety boundaries block readiness and promotion", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({ stage: "claim" });

  assert.match(html, /No full script/);
  assert.match(html, /No B-roll generation/);
  assert.match(html, /No Resolve work/);
  assert.match(html, /No production-ready status/);
  assert.match(html, /No publish-ready status/);
  assert.match(html, /No final title approval/);
  assert.match(html, /No final thumbnail approval/);
  assert.match(html, /No package-run promotion unless Mikko explicitly approves later/);
  assert.match(html, /not an approval system/);
});

test("beginning triage cockpit final display separates proof candidate from package run", () => {
  const html = packageRunsDashboard.renderBeginningTriageCockpit({
    stage: "next_action",
    decision: "Continue",
    selectedCandidate: "1",
    selectedPackage: "2",
    fields: {
      candidate1Title: "Research-first creator angle",
      rawIdea: "Creators should test a claim before filming. The video shows how to find the proof gap first.",
      package2Title: "Stop Filming Unprovable Ideas",
      nextThirtyMinuteAction: "Inspect one existing artifact.",
    },
  });

  assert.match(html, /Current state: Proof Candidate/);
  assert.match(html, /Selected research candidate: Research-first creator angle/);
  assert.match(html, /Two-sentence rough idea: Creators should test a claim before filming/);
  assert.match(html, /Selected planning title-thumbnail package: Stop Filming Unprovable Ideas/);
  assert.match(html, /Decision: Continue/);
  assert.match(html, /Next 30-minute action: Inspect one existing artifact/);
  assert.match(html, /This has not created or promoted a package run/);
  assert.doesNotMatch(html, /production_ready:\s*true|publish_ready:\s*true|approved:\s*true/i);
});

test("beginning triage cockpit localStorage wiring uses only the new key", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");

  assert.match(source, /const BEGINNING_TRIAGE_STORAGE_KEY = "vidtoolz-beginning-triage-v1"/);
  assert.match(source, /const EPISODE_FACTORY_STORAGE_KEY = "vidtoolz-episode-factory-v1"/);
  assert.match(source, /localStorage\.getItem\(BEGINNING_TRIAGE_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(BEGINNING_TRIAGE_STORAGE_KEY/);
  assert.match(source, /localStorage\.removeItem\(BEGINNING_TRIAGE_STORAGE_KEY\)/);
  assert.doesNotMatch(source, /localStorage\.setItem\(EPISODE_FACTORY_STORAGE_KEY/);
  assert.doesNotMatch(source, /localStorage\.removeItem\(EPISODE_FACTORY_STORAGE_KEY/);
});

test("evidence intake dashboard displays existing evidence rows", () => {
  const html = packageRunsDashboard.renderEvidenceIntakePanel({
    runId: "2026-05-06-ai-video-proof-plan",
    existingRows: [{
      media_path: "/mnt/vidnas_public/episode/kling-01.mp4",
      media_type: "kling_candidate",
      source_category: "generated asset",
      proof_purpose: "Supports prompt-03 B-roll in the edit.",
      status: "exists_on_vidnas",
      resolve_tested: "no",
      artifact: "takes-log.md",
      line: 12,
    }],
  });

  assert.match(html, /\/mnt\/vidnas_public\/episode\/kling-01\.mp4/);
  assert.match(html, /Supports prompt-03 B-roll in the edit/);
  assert.match(html, /EVIDENCE ONLY/);
  assert.match(html, /not tested/);
  assert.match(html, /takes-log\.md:12/);
});

test("evidence intake status reads existing artifact rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-intake-status-"));
  const runId = "2026-05-12-evidence-status";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "takes-log.md"),
    "# Takes Log\n\n| take | source item | file/reference | status |\n| --- | --- | --- | --- |\n| Hook take | hook block | `/tmp/hook-take.mov` | captured |\n",
    "utf8"
  );

  const status = packageEngineServer.buildEvidenceIntakeStatus({ runId }, { root: tempRoot });

  assert.equal(status.ok, true);
  assert.equal(status.readOnly, true);
  assert.equal(status.existingRowCount, 1);
  assert.equal(status.existingRows[0].media_path, "/tmp/hook-take.mov");
  assert.equal(status.existingRows[0].media_type, "camera_capture");
  assert.equal(status.existingRows[0].approved, false);
  assert.equal(status.existingRows[0].productionReady, false);
});

test("evidence intake preview validates required fields without writing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-intake-preview-"));
  const runId = "2026-05-12-evidence-preview";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  assert.throws(
    () => packageEngineServer.buildEvidenceIntakePreview({ runId, rows: evidenceIntakeRows({ proof_purpose: "" }) }, { root: tempRoot }),
    /proof_purpose is required/
  );
  assert.deepEqual(fs.readdirSync(runDir), []);
});

test("evidence intake rejects path traversal", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-intake-traversal-"));
  const runId = "2026-05-12-evidence-traversal";
  fs.mkdirSync(path.join(tempRoot, "package-runs", runId), { recursive: true });

  assert.throws(
    () => packageEngineServer.buildEvidenceIntakePreview({ runId, rows: evidenceIntakeRows({ media_path: "../escape.mp4" }) }, { root: tempRoot }),
    /path traversal is not allowed/
  );
});

test("evidence intake warns on missing files and generated proof without context", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-intake-warnings-"));
  const runId = "2026-05-12-evidence-warnings";
  fs.mkdirSync(path.join(tempRoot, "package-runs", runId), { recursive: true });

  const preview = packageEngineServer.buildEvidenceIntakePreview({
    runId,
    rows: evidenceIntakeRows({
      media_path: path.join(tempRoot, "missing-generated-still.png"),
      media_type: "generated_still",
      source_category: "generated asset",
      proof_purpose: "Image is production proof",
      notes: "",
    }),
  }, { root: tempRoot });

  assert.equal(preview.ok, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.warnings.some((warning) => /MISSING FILE/.test(warning)), true);
  assert.equal(preview.warnings.some((warning) => /generated asset needs context/i.test(warning)), true);
  assert.doesNotMatch(preview.draftMarkdown, /Production readiness written: yes|Publish readiness written: yes/);
  assert.equal(fs.existsSync(path.join(tempRoot, "package-runs", runId, "capture-evidence-intake-log.md")), false);
});

test("evidence intake save writes only the audit-log draft and never readiness markers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-intake-save-"));
  const runId = "2026-05-12-evidence-save";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\nPackage run state: active\n", "utf8");
  fs.writeFileSync(path.join(runDir, "generation-manifest.json"), "{\"items\":[]}\n", "utf8");
  fs.writeFileSync(path.join(runDir, "candidate.mp4"), "fake media", "utf8");
  const protectedFiles = [
    path.join(runDir, "package-run-state.md"),
    path.join(runDir, "generation-manifest.json"),
    path.join(runDir, "candidate.mp4"),
  ];
  const before = Object.fromEntries(protectedFiles.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));
  const payload = {
    runId,
    rows: evidenceIntakeRows({
      media_path: path.join(runDir, "candidate.mp4"),
      notes: "Candidate only; tested in Resolve timeline not yet recorded.",
    }),
  };
  const preview = packageEngineServer.buildEvidenceIntakePreview(payload, { root: tempRoot });
  const saved = packageEngineServer.saveEvidenceIntakeDraft({
    ...payload,
    previewToken: preview.previewToken,
    confirmSave: true,
  }, { root: tempRoot });
  const files = fs.readdirSync(runDir).sort();
  const audit = fs.readFileSync(path.join(runDir, "capture-evidence-intake-log.md"), "utf8");

  assert.deepEqual(saved.written, ["capture-evidence-intake-log.md"]);
  assert.equal(saved.captureEvidenceAccepted, false);
  assert.equal(saved.approved, false);
  assert.equal(saved.selected, false);
  assert.equal(saved.productionReady, false);
  assert.equal(saved.publishReady, false);
  assert.deepEqual(files, ["candidate.mp4", "capture-evidence-intake-log.md", "generation-manifest.json", "package-run-state.md"]);
  assert.match(audit, /Approval written: no/);
  assert.match(audit, /Capture accepted written: no/);
  assert.match(audit, /Production readiness written: no/);
  assert.match(audit, /Publish readiness written: no/);
  assert.doesNotMatch(audit, /Capture evidence approval: PASS|production_ready:\s*true|publish_ready:\s*true/i);
  protectedFiles.forEach((filePath) => assert.equal(fs.readFileSync(filePath, "utf8"), before[filePath]));
});

test("evidence intake status routes selected stills without Kling videos to manual Kling action", () => {
  const fixture = createEvidenceNextActionFixture(false);

  const status = packageEngineServer.buildEvidenceIntakeStatus({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(status.evidenceStatus, "selected stills exist, Kling candidates missing");
  assert.match(status.nextEvidenceAction, /Create Kling MP4s manually/);
  assert.doesNotMatch(status.nextEvidenceAction, /production[-_ ]?ready|publish/i);
  assert.equal(status.externalApisCalled, false);
});

test("evidence intake status routes Kling videos without Resolve evidence to timeline testing", () => {
  const fixture = createEvidenceNextActionFixture(true);

  const status = packageEngineServer.buildEvidenceIntakeStatus({ runId: fixture.runId }, { root: fixture.tempRoot });

  assert.equal(status.evidenceStatus, "Kling candidates exist, Resolve test evidence missing");
  assert.match(status.nextEvidenceAction, /Import the Kling candidates to Resolve/);
  assert.doesNotMatch(status.nextEvidenceAction, /approved|production[-_ ]?ready|publish/i);
});

test("evidence intake forbidden actions include approval publish and readiness automation", () => {
  const fixture = createEvidenceNextActionFixture(false);

  const status = packageEngineServer.buildEvidenceIntakeStatus({ runId: fixture.runId }, { root: fixture.tempRoot });
  const forbidden = status.forbiddenActions.join("\n");

  assert.match(forbidden, /mark approved/);
  assert.match(forbidden, /mark production_ready/);
  assert.match(forbidden, /mark publish_ready/);
  assert.match(forbidden, /operate Kling/);
  assert.match(forbidden, /operate Resolve/);
  assert.match(forbidden, /write manifests/);
});

test("package runs dashboard normalizes filters and renders run cards", () => {
  const payload = {
    generatedAt: "2026-05-05T00:00:00.000Z",
    runs: [
      { runId: "2026-05-01-a", path: "package-runs/2026-05-01-a", status: "Idea run", files: {} },
      {
        runId: "2026-05-02-b",
        path: "package-runs/2026-05-02-b",
        title: "Ready Package",
        status: "Ready to shoot",
        workflowBucket: "Ready to shoot",
        creatorQaStatus: "PASS",
        nextRecommendedCommand: "",
        files: { final_script: true, production_brief: true, creator_qa_report: true, creator_qa_report_json: true },
      },
      {
        runId: "2026-05-03-c",
        path: "package-runs/2026-05-03-c",
        title: "Script Package",
        status: "Final outline ready",
        workflowBucket: "Needs script",
        creatorQaStatus: "not run",
        nextRecommendedCommand: "node scripts/package-engine-new-script.js package-runs/2026-05-03-c",
        files: { final_outline: true },
      },
      {
        runId: "2026-05-04-d",
        path: "package-runs/2026-05-04-d",
        title: "Failed QA Package",
        status: "Production prep ready",
        workflowBucket: "Needs QA repair",
        creatorQaStatus: "FAIL",
        nextRecommendedCommand: "Review creator-qa-report.md and repair package/script before shooting.",
        files: { final_script: true, production_brief: true, creator_qa_report: true, creator_qa_report_json: true },
      },
      {
        runId: "2026-05-05-e",
        path: "package-runs/2026-05-05-e",
        title: "QA Missing Package",
        status: "Ready to shoot",
        creatorQaStatus: "not run",
        nextRecommendedCommand: "node scripts/package-run-creator-qa.js package-runs/2026-05-05-e",
        files: { final_script: true, production_brief: true },
      },
      {
        runId: "2026-05-06-f",
        path: "package-runs/2026-05-06-f",
        title: "Proof Missing Package",
        status: "Ready to shoot",
        workflowBucket: "Ready to shoot",
        creatorQaStatus: "PASS",
        evidenceGate: {
          status: "capture missing",
          warning: "Not production-ready: proof capture missing",
          blocksProductionReady: true,
          hasCapturePlan: true,
          hasCaptureResult: true,
          saysNoCapturedOutput: true,
          evidenceReferences: [],
        },
        files: { final_script: true, production_brief: true, capture_verification_note: true, capture_result_note: true },
      },
      {
        runId: "2026-05-07-g",
        path: "package-runs/2026-05-07-g",
        title: "Needs Work Package",
        status: "Ready to shoot",
        workflowBucket: "Ready to shoot",
        creatorQaStatus: "NEEDS WORK",
        nextRecommendedCommand: "",
        files: { final_script: true, production_brief: true, creator_qa_report: true, creator_qa_report_json: true },
      },
      {
        runId: "2026-05-08-h",
        path: "package-runs/2026-05-08-h",
        title: "Unknown QA Package",
        status: "Ready to shoot",
        workflowBucket: "Ready to shoot",
        creatorQaStatus: "REVIEW REQUIRED",
        nextRecommendedCommand: "",
        files: { final_script: true, production_brief: true, creator_qa_report: true, creator_qa_report_json: true },
      },
      {
        runId: "2026-05-09-i",
        path: "package-runs/2026-05-09-i",
        title: "Narrow Approved Package",
        status: "Ready to shoot",
        workflowBucket: "Needs proof capture",
        creatorQaStatus: "not run",
        nextRecommendedCommand: "",
        evidenceGate: {
          status: "transcript captured; visual proof missing; narrow shooting approved",
          warning:
            "Not production-ready: narrow shooting only; editing, publishing, upload prep, final title, and final thumbnail remain blocked",
          blocksProductionReady: true,
          hasCapturePlan: true,
          hasCaptureResult: true,
          hasCaptureTranscript: true,
          hasVisualCapture: false,
          hasNarrowShootingApproval: true,
          approvedActions: ["narrow shooting"],
          blockedActions: [
            "editing",
            "publishing",
            "upload prep",
            "final title",
            "final thumbnail",
            "production readiness",
            "project-state promotion",
            "Hermes brain write",
            "commit",
            "push",
          ],
          approvalReference: "narrow-shooting-approval.md",
          evidenceReferences: ["capture-transcript.md"],
        },
        files: { final_script: true, production_brief: true, narrow_shooting_approval: true },
      },
      {
        runId: "2026-05-10-j",
        path: "package-runs/2026-05-10-j",
        title: "Parked Legacy Package",
        status: "Inactive: parked",
        activeStatus: "Needs production planning",
        workflowBucket: "Inactive: parked",
        activeWorkflowBucket: "Needs QA repair",
        creatorQaStatus: "NEEDS WORK",
        packageRunState: {
          markerFile: "package-run-state.md",
          raw: "parked",
          state: "parked",
          explicit: true,
          isInactive: true,
          warning: "",
        },
        inactive: true,
        nextRecommendedCommand: "",
        files: { package_run_state: true, final_script: true, creator_qa_report: true, creator_qa_report_json: true },
      },
    ],
  };
  const index = packageRunsDashboard.normalizeIndex(payload);
  const filtered = packageRunsDashboard.filterAndSortRuns(index.runs, "Ready to shoot", "run-desc");
  const needsScript = packageRunsDashboard.filterAndSortRuns(index.runs, "Needs script", "run-desc");
  const needsQaRepair = packageRunsDashboard.filterAndSortRuns(index.runs, "Needs QA repair", "run-desc");
  const qaNotRun = packageRunsDashboard.filterAndSortRuns(index.runs, "QA not run", "run-desc");
  const needsProofCapture = packageRunsDashboard.filterAndSortRuns(index.runs, "Needs proof capture", "run-desc");
  const narrowShootingApproved = packageRunsDashboard.filterAndSortRuns(index.runs, "Narrow shooting approved", "run-desc");
  const inactiveParked = packageRunsDashboard.filterAndSortRuns(index.runs, "Inactive: parked", "run-desc");
  const card = packageRunsDashboard.renderRunCard(filtered[0]);
  const scriptCard = packageRunsDashboard.renderRunCard(needsScript[0]);
  const failedQaCard = packageRunsDashboard.renderRunCard(needsQaRepair.find((run) => run.runId === "2026-05-04-d"));
  const needsWorkCard = packageRunsDashboard.renderRunCard(needsQaRepair.find((run) => run.runId === "2026-05-07-g"));
  const unknownQaCard = packageRunsDashboard.renderRunCard(needsQaRepair.find((run) => run.runId === "2026-05-08-h"));
  const qaMissingCard = packageRunsDashboard.renderRunCard(qaNotRun[0]);
  const proofMissingCard = packageRunsDashboard.renderRunCard(needsProofCapture[0]);
  const narrowApprovedCard = packageRunsDashboard.renderRunCard(narrowShootingApproved[0]);
  const inactiveCard = packageRunsDashboard.renderRunCard(inactiveParked[0]);
  const stats = packageRunsDashboard.renderWorkflowStats(index.runs);

  assert.equal(index.count, 10);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].runId, "2026-05-02-b");
  assert.equal(needsScript.length, 1);
  assert.equal(needsQaRepair.length, 3);
  assert.equal(qaNotRun.length, 1);
  assert.equal(needsProofCapture.length, 1);
  assert.equal(narrowShootingApproved.length, 1);
  assert.equal(narrowShootingApproved[0].runId, "2026-05-09-i");
  assert.equal(inactiveParked.length, 1);
  assert.equal(inactiveParked[0].runId, "2026-05-10-j");
  assert.match(card, /Ready Package/);
  assert.match(card, /Ready to shoot/);
  assert.match(card, /package-runs\/2026-05-02-b\//);
  assert.match(card, /href="package-runs\/2026-05-02-b\/final-script\.md"/);
  assert.match(card, /data-preview-artifact="package-runs\/2026-05-02-b\/final-script\.md"/);
  assert.match(card, /Creator QA/);
  assert.match(card, /PASS/);
  assert.match(card, /href="package-runs\/2026-05-02-b\/creator-qa-report\.md"/);
  assert.match(scriptCard, /node scripts\/package-engine-new-script\.js package-runs\/2026-05-03-c/);
  assert.match(scriptCard, /not run/);
  assert.match(scriptCard, /Needs script/);
  assert.match(failedQaCard, /qa-blocked/);
  assert.match(failedQaCard, /Creator QA blocker/);
  assert.match(failedQaCard, /FAIL/);
  assert.match(failedQaCard, /Review creator-qa-report\.md and repair package\/script before shooting\./);
  assert.match(needsWorkCard, /Needs Work Package/);
  assert.match(needsWorkCard, /Creator QA blocker/);
  assert.match(needsWorkCard, /NEEDS WORK/);
  assert.match(needsWorkCard, /Review Creator QA status NEEDS WORK and repair package\/script before shooting\./);
  assert.match(unknownQaCard, /Unknown QA Package/);
  assert.match(unknownQaCard, /Creator QA blocker/);
  assert.match(unknownQaCard, /REVIEW REQUIRED/);
  assert.match(unknownQaCard, /Review Creator QA status REVIEW REQUIRED and repair package\/script before shooting\./);
  assert.match(qaMissingCard, /QA not run/);
  assert.match(qaMissingCard, /node scripts\/package-run-creator-qa\.js package-runs\/2026-05-05-e/);
  assert.match(proofMissingCard, /Needs proof capture/);
  assert.match(proofMissingCard, /Evidence Gate blocker/);
  assert.match(proofMissingCard, /Not production-ready: proof capture missing/);
  assert.match(proofMissingCard, /Capture or import durable proof evidence before production approval\./);
  assert.match(narrowApprovedCard, /Narrow shooting approved/);
  assert.match(
    narrowApprovedCard,
    /Shoot only the narrow approved scope; editing, publishing, upload prep, final title, and final thumbnail remain blocked\./
  );
  assert.match(inactiveCard, /Inactive: parked/);
  assert.match(inactiveCard, /State: parked/);
  assert.match(stats, /Ready to shoot/);
  assert.match(stats, /Needs production prep/);
  assert.match(stats, /Needs QA repair/);
  assert.match(stats, /Needs proof capture/);
  assert.match(stats, /Narrow shooting approved/);
  assert.match(stats, /QA not run/);
  assert.match(stats, /Inactive: parked/);
});

test("package runs dashboard renders lifecycle gate review data", () => {
  const payload = {
    generatedAt: "2026-05-12T00:00:00.000Z",
    runs: [
      {
        runId: "2026-05-12-stage4-needs-work",
        path: "package-runs/2026-05-12-stage4-needs-work",
        title: "Stage 4 Needs Work",
        status: "Needs shot/edit plan approval",
        workflowBucket: "Needs shot/edit plan approval",
        overallStatus: "BLOCKED",
        firstBlockerReason: "Shot/edit plan review status is NEEDS WORK; Stage accepted is no. First blocker: shot-list.md has TODO rows.",
        nextRecommendedCommand: "node scripts/package-run-shot-edit-plan-review.js package-runs/2026-05-12-stage4-needs-work",
        missingExpectedArtifacts: ["shot-edit-plan-review.md with Review status: PASS and Stage accepted: yes"],
        conservativeBlockedActions: ["shooting", "editing", "publishing", "upload prep", "Hermes brain write", "project-state promotion"],
        detectedButNotTrustedArtifacts: [
          {
            artifact: "rough-cut-review.md",
            reason: "Not trusted as proof: capture evidence is not proven.",
          },
          {
            artifact: "export artifacts",
            reason: "Missing evidence: concrete master, loudness, captions, delivery metadata, and exact approvals are not proven.",
          },
        ],
        lifecycleGate: {
          hasShotEditPlanReview: true,
          shotEditPlanReviewStatus: "NEEDS WORK",
          shotEditPlanAccepted: false,
          shotEditPlanNextSafeAction: "Edit Stage 4 planning artifacts manually, then rerun this review.",
          hasCaptureEvidenceReview: true,
          captureEvidenceReviewStatus: "READY FOR HUMAN APPROVAL",
          captureEvidenceAccepted: false,
          captureEvidenceRealEvidence: true,
          captureEvidenceNextSafeAction: "Add capture approval after human review.",
          captureEvidenceBlockers: "Exact capture approval marker is missing.",
          hasConcreteCaptureEvidence: false,
          effectiveReadiness: {
            captureApproved: false,
            readyForRoughCut: false,
            publishReady: false,
            readyToUpload: false,
            readyToSchedule: false,
            downstreamReadinessOverridden: true,
            overrideReason: "Capture evidence review status is READY FOR HUMAN APPROVAL; Capture evidence accepted is no.",
            nextSafeAction: "Add capture approval after human review.",
            rawMarkers: ["raw publish readiness marker"],
          },
          hasRealRoughCutEvidence: false,
          hasRealFinalWatchEvidence: false,
          hasConcreteExportEvidence: false,
        },
        files: {
          production_plan: true,
          shot_edit_plan_review: true,
          shot_edit_plan_enhancement_plan: true,
          rough_cut_review: true,
          export_checklist: true,
        },
      },
    ],
  };

  const index = packageRunsDashboard.normalizeIndex(payload);
  const run = index.runs[0];
  const card = packageRunsDashboard.renderRunCard(run);

  assert.equal(run.lifecycleGate.shotEditPlanReviewStatus, "NEEDS WORK");
  assert.equal(run.lifecycleGate.shotEditPlanAccepted, false);
  assert.deepEqual(run.conservativeBlockedActions.slice(0, 2), ["shooting", "editing"]);
  assert.equal(run.detectedButNotTrustedArtifacts.length, 2);
  assert.match(card, /Lifecycle Review/);
  assert.match(card, /Current inferred stage/);
  assert.match(card, /Needs shot\/edit plan approval/);
  assert.match(card, /BLOCKED/);
  assert.match(card, /Effective readiness/);
  assert.match(card, /Capture approved/);
  assert.match(card, /Ready for rough cut/);
  assert.match(card, /Publish ready/);
  assert.match(card, /Upload ready/);
  assert.match(card, /Raw downstream markers overridden/);
  assert.match(card, /Stage 4 review status/);
  assert.match(card, /NEEDS WORK/);
  assert.match(card, /Stage 4 accepted/);
  assert.match(card, /Human approval required/);
  assert.match(card, /Edit Stage 4 planning artifacts manually/);
  assert.match(card, /Conservative blocked actions/);
  assert.match(card, /Hermes brain write/);
  assert.match(card, /Missing expected artifacts/);
  assert.match(card, /shot-edit-plan-review\.md with Review status: PASS and Stage accepted: yes/);
  assert.match(card, /Detected but not trusted yet/);
  assert.match(card, /rough-cut-review\.md/);
  assert.match(card, /Not trusted as proof/);
  assert.match(card, /export artifacts/);
  assert.match(card, /Missing evidence/);
  assert.match(card, /Capture Evidence/);
  assert.match(card, /Effective capture approved/);
  assert.match(card, /Effective ready for rough cut/);
  assert.match(card, /Real capture evidence detected/);
  assert.match(card, /Ready for rough cut only after approval/);
  assert.match(card, /Copyable Markdown helper/);
  assert.match(card, /Capture Evidence Intake/);
  assert.match(card, /data-capture-field="takeName"/);
  assert.match(card, /data-copy-capture-row="takesLog"/);
  assert.match(card, /data-copy-capture-row="screenRecordingChecklist"/);
  assert.match(card, /data-copy-capture-row="audioCaptureChecklist"/);
  assert.match(card, /Local write preview/);
  assert.match(card, /data-capture-preview/);
  assert.match(card, /data-capture-apply disabled/);
  assert.match(card, /Preview required before Apply is enabled/);
  assert.match(card, /Copy buttons remain available/);
  assert.match(card, /Capture evidence approval: PASS/);
});

test("package runs dashboard renders Mikko rough-cut input console", () => {
  const html = packageRunsDashboard.renderMikkoInputConsole({
    runId: "2026-05-17-rough-cut-console",
    currentInferredStage: "Needs rough-cut review",
    overallStatus: "BLOCKED",
    firstBlockerReason: "Rough-cut review status is BLOCKED, not READY FOR SECOND CUT.",
    nextRecommendedCommand: "node scripts/package-run-rough-cut-review.js package-runs/2026-05-17-rough-cut-console",
    roughCutCandidate: {
      path: "media/rough-cut-v1.mp4",
      source: "rough-cut-watch-notes.md",
    },
    activeRunSummary: {
      runId: "2026-05-17-rough-cut-console",
      currentLifecycleStage: "Needs rough-cut review",
      overallStatus: "BLOCKED",
      currentBlocker: "Rough-cut review status is BLOCKED, not READY FOR SECOND CUT.",
      exactNextSafeAction: "Accept or complete pickups before second-cut readiness.",
      packageRunState: { state: "active", explicit: true },
      dashboardIndexUpdated: false,
      dashboardIndexReason: "package-runs-index.json is older than active run files.",
    },
    gateTimeline: [
      { label: "Research", status: "PASS", reason: "Research passed.", artifactPath: "research-sufficiency-review.md", allowedNextAction: "Continue." },
      { label: "Rough Cut", status: "NEEDS PICKUPS", reason: "Watch notes list pickups needed.", artifactPath: "rough-cut-review.md", allowedNextAction: "Resolve pickups." },
      { label: "Second Cut", status: "LOCKED", reason: "Second-cut ready: no.", artifactPath: "rough-cut-review.md", allowedNextAction: "Locked until rough cut passes." },
    ],
    roughCutResult: {
      roughCutReviewStatus: "NEEDS PICKUPS",
      secondCutReady: false,
      reason: "Watch notes list pickups needed.",
      reviewedFilePath: "media/rough-cut-v1.mp4",
      approvalMarker: "NEEDS PICKUPS",
      pickupListStatus: "open",
      editFixListStatus: "open",
    },
    mediaRows: [
      { path: "media/rough-cut-v1.mp4", type: "reviewed file", status: "reviewed/current", openAllowed: true },
      { path: "/etc/passwd", type: "unsafe", status: "blocked", openAllowed: false },
    ],
  }, {
    review: {
      roughCutReviewStatus: "NEEDS PICKUPS",
      secondCutReady: false,
      reason: "Watch notes list pickups needed.",
      pickupListStatus: "created",
      editFixListStatus: "unchanged",
    },
    stdout: "rough-cut review: NEEDS PICKUPS\n",
  });

  assert.match(html, /data-rough-cut-console/);
  assert.match(html, /Active Run/);
  assert.match(html, /Active package run/);
  assert.match(html, /2026-05-17-rough-cut-console/);
  assert.match(html, /Dashboard index updated/);
  assert.match(html, /package-runs-index\.json is older/);
  assert.match(html, /Exact next safe action/);
  assert.match(html, /Accept or complete pickups/);
  assert.match(html, /Visual Gate Timeline/);
  assert.match(html, /Research/);
  assert.match(html, /Second Cut/);
  assert.match(html, /LOCKED/);
  assert.match(html, /Latest Review Result/);
  assert.match(html, /Approval marker/);
  assert.match(html, /NEEDS PICKUPS/);
  assert.match(html, /Structured Pickup Items/);
  assert.match(html, /data-save-pickup-plan/);
  assert.match(html, /pickup-list\.md/);
  assert.match(html, /edit-fix-list\.md/);
  assert.match(html, /Active-Run Media/);
  assert.match(html, /data-open-media="media\/rough-cut-v1\.mp4"/);
  assert.match(html, /data-open-media="\/etc\/passwd" disabled/);
  assert.match(html, /Current lifecycle stage/);
  assert.match(html, /Needs rough-cut review/);
  assert.match(html, /Current blocker/);
  assert.match(html, /Rough-cut review status is BLOCKED/);
  assert.match(html, /data-open-rough-cut/);
  assert.match(html, /data-rough-cut-field="reviewedFilePath"/);
  assert.match(html, /value="media\/rough-cut-v1\.mp4"/);
  assert.match(html, /data-rough-cut-field="first30SecondsNotes"/);
  assert.match(html, /data-rough-cut-field="proofEvidenceNotes"/);
  assert.match(html, /data-rough-cut-field="roughCutApprovalMarker"/);
  assert.match(html, /<option value="PASS">PASS<\/option>/);
  assert.match(html, /data-save-rough-cut-notes/);
  assert.match(html, /data-run-rough-cut-review disabled/);
  assert.match(html, /Review Result/);
  assert.match(html, /NEEDS PICKUPS/);
  assert.match(html, /Second-cut ready/);
});

test("package runs dashboard renders Next Safe Action panel data safely", () => {
  const html = packageRunsDashboard.renderNextSafeActionPanel({
    ok: true,
    readOnly: true,
    activeRun: "2026-05-06-ai-video-proof-plan",
    activeRunPath: "package-runs/2026-05-06-ai-video-proof-plan",
    stage: "Capture / b-roll candidate creation",
    nextHumanAction: "Create Kling b-roll candidates from selected prompt-03 stills, move MP4s to the approved VIDNAS folder, then test them in DaVinci Resolve.",
    nextAiAction: "Prepare handoffs, inspect files, summarize status, or create read-only reports. Do not approve assets.",
    blockedUntil: "Kling video candidates exist on VIDNAS and Mikko tests them in Resolve.",
    allowedActions: ["read artifacts", "inspect manifest counts"],
    forbiddenActions: ["mark approved", "mark production_ready", "publish", "operate Kling automatically"],
    evidence: [
      { label: "active package run folder", path: "/tmp/run", href: "package-runs/2026-05-06-ai-video-proof-plan", exists: true },
      { label: "generation-manifest.json path", path: "/tmp/generation-manifest.json", href: "/tmp/generation-manifest.json", exists: true },
    ],
    facts: {
      selectedStillCount: 3,
      reviewedPrompt03Count: 32,
      approvedCount: 0,
      productionReadyCount: 0,
      klingVideoCount: 0,
      resolveTestRecorded: false,
    },
  });

  assert.match(html, /NEXT SAFE ACTION/);
  assert.match(html, /HUMAN NEXT/);
  assert.match(html, /AI MAY DO/);
  assert.match(html, /BLOCKED UNTIL/);
  assert.match(html, /DO NOT DO/);
  assert.match(html, /selected/);
  assert.match(html, /reviewed/);
  assert.match(html, /approved/);
  assert.match(html, /production_ready/);
  assert.match(html, /Create Kling b-roll candidates/);
  assert.match(html, /mark production_ready/);
  assert.match(html, /generation-manifest\.json path/);
});

test("package runs dashboard renders Production GPS panels safely", () => {
  const gps = {
    summary: {
      runId: "2026-05-06-ai-video-proof-plan",
      title: "Proof Plan Fixture",
      stateLabel: "active",
      currentLocation: "Package Run -> Rough Cut Review -> Pickup Execution -> Waiting for Mikko / Edit Work",
      currentInferredStage: "Needs rough-cut review",
      currentGate: "Pickup / Edit-Fix Planning",
      gateStatus: "needs human review",
      nextSafeAction: "Place/review pickup inserts before second-cut readiness.",
      requiredHumanDecision: "Mikko must decide whether pickup/edit-fix work satisfies the rough-cut notes.",
      latestRelevantArtifact: "rough-cut-watch-notes.md",
      missingExpectedArtifact: "second-cut candidate",
      aiMayAct: true,
      mikkoApprovalRequired: true,
    },
    gateTimeline: [
      { label: "Rough Cut Review", status: "needs human review", reason: "NEEDS PICKUPS", artifactPath: "rough-cut-review.md", current: false },
      { label: "Pickup / Edit-Fix Planning", status: "current", reason: "Pickup work is active.", artifactPath: "pickup-list.md", current: true },
      { label: "Final Review", status: "not reached", reason: "Locked until second cut.", artifactPath: "final-review.md", current: false },
    ],
    artifactTrail: {
      items: [
        { path: "rough-cut-watch-notes.md", exists: true, kind: "source / human-authored", canChangeReadiness: true, containsApprovalMarker: true, safeToRegenerate: false, requiresHumanReview: true },
        { path: "rough-cut-review.md", exists: true, kind: "derived / generated", canChangeReadiness: true, containsApprovalMarker: false, safeToRegenerate: true, requiresHumanReview: true },
        { path: "final-watch-notes.md", exists: false, kind: "source / human-authored", canChangeReadiness: true, containsApprovalMarker: false, safeToRegenerate: false, requiresHumanReview: true },
      ],
    },
    humanGate: {
      required: true,
      title: "Human Gate Required",
      decision: "Mikko must review pickup/edit-fix work before any second-cut readiness decision.",
      reviewArtifact: "rough-cut-watch-notes.md",
      doNotApproveYet: "Do not approve rough cut or mark second-cut ready.",
      aiAllowed: ["inspect files", "draft pickup placement plan"],
      aiBlocked: ["approve rough cut", "mark second-cut ready"],
    },
    blockedActions: ["mark second-cut ready", "publish", "archive", "promote project state"],
    staleWarnings: [{ title: "Derived rough-cut review artifact may be stale", detail: "Current watch notes say NEEDS PICKUPS." }],
  };
  const html = packageRunsDashboard.renderProductionGps(gps);

  assert.match(html, /Production GPS/);
  assert.match(html, /Current location/);
  assert.match(html, /Pickup \/ Edit-Fix Planning/);
  assert.match(html, /Human Gate Required/);
  assert.match(html, /Artifact Trail/);
  assert.match(html, /Blocked Actions/);
  assert.match(html, /AI allowed/);
  assert.match(html, /AI blocked/);
  assert.match(html, /rough-cut-watch-notes\.md/);
  assert.match(html, /source \/ human-authored/);
  assert.match(html, /Derived rough-cut review artifact may be stale/);
});

test("package runs dashboard renders Production Timeline Cockpit without mutation controls", () => {
  const html = packageRunsDashboard.renderProductionTimelineCockpit({
    currentWork: {
      latestCompleted: "Selected prompt-03 stills recorded; no assets approved.",
      activeStage: "Manual Kling b-roll candidate creation",
      activeTask: "Create three image-to-video candidates from selected prompt-03 stills.",
      blocker: "No Kling MP4s exist on VIDNAS and no Resolve timeline test is recorded.",
      immediateNextAction: "Mikko manually creates Kling MP4 candidates, moves them to VIDNAS, and tests in Resolve.",
      nextSteps: [
        "Create Kling candidates manually from selected stills.",
        "Move MP4s to VIDNAS.",
        "Record Resolve test results in evidence intake only.",
      ],
    },
    lifecycle: [
      { label: "Package", status: "completed", detail: "Package selected.", artifactPath: "package-run-state.md" },
      { label: "Capture / B-roll", status: "current", detail: "Prompt-03 stills selected; Kling video pending.", artifactPath: "generation-manifest.json" },
      { label: "Resolve Test", status: "blocked", detail: "Needs real MP4 candidates before timeline test.", artifactPath: "capture-evidence-intake-log.md" },
      { label: "Second Cut", status: "next", detail: "Wait for real tested video evidence.", artifactPath: "second-cut-candidate.md" },
      { label: "Publish", status: "future", detail: "Locked until final/export gates pass.", artifactPath: "publication-metadata.md" },
    ],
    blockedActions: [
      "mark approved",
      "mark production_ready",
      "mark publish_ready",
      "operate Kling automatically",
      "move media automatically",
    ],
  });

  assert.match(html, /Production Timeline Cockpit/);
  assert.match(html, /Detailed Current-Work Timeline/);
  assert.match(html, /Full Process Mini Timeline/);
  assert.match(html, /Latest completed/);
  assert.match(html, /Active now/);
  assert.match(html, /Blocked by/);
  assert.match(html, /Immediate next action/);
  assert.match(html, /Next few steps/);
  assert.match(html, /Manual Kling b-roll candidate creation/);
  assert.match(html, /Selected prompt-03 stills recorded/);
  assert.match(html, /No Kling MP4s exist on VIDNAS/);
  assert.match(html, /gate-completed/);
  assert.match(html, /gate-current/);
  assert.match(html, /gate-blocked/);
  assert.match(html, /gate-next/);
  assert.match(html, /gate-future/);
  assert.match(html, /Resolve Test/);
  assert.match(html, /Evidence logging only/);
  assert.match(html, /mark production_ready/);
  assert.doesNotMatch(html, /data-save-production-ready/);
  assert.doesNotMatch(html, /data-approve/);
  assert.doesNotMatch(html, /data-publish/);
  assert.doesNotMatch(html, /data-operate-kling/);
  assert.doesNotMatch(html, /data-move-media/);
});

test("rough cut status exposes Production Timeline Cockpit for the live dashboard", () => {
  const fixture = createEvidenceNextActionFixture(false);

  const status = packageEngineServer.buildRoughCutStatus({ runId: fixture.runId }, { root: fixture.tempRoot });
  const cockpit = status.productionTimelineCockpit;

  assert.equal(Boolean(cockpit), true);
  assert.equal(cockpit.readOnly, true);
  assert.equal(cockpit.externalApisCalled, false);
  assert.equal(cockpit.currentWork.activeStage, "Manual Kling b-roll candidate creation");
  assert.match(cockpit.currentWork.latestCompleted, /Selected prompt-03 stills exist/);
  assert.match(cockpit.currentWork.immediateNextAction, /Kling MP4 candidates/);
  assert.equal(Array.isArray(cockpit.currentWork.nextSteps), true);
  assert.equal(cockpit.currentWork.nextSteps.length >= 3, true);
  assert.equal(Array.isArray(cockpit.lifecycle), true);
  assert.equal(cockpit.lifecycle.length > 5, true);
  assert.equal(cockpit.lifecycle.some((item) => item.status === "current" || item.current), true);
  assert.equal(cockpit.lifecycle.some((item) => item.status === "next" || item.status === "future"), true);
  assert.match(cockpit.blockedActions.join("\n"), /mark approved/);
  assert.match(cockpit.blockedActions.join("\n"), /mark selected/);
  assert.match(cockpit.blockedActions.join("\n"), /mark production_ready/);
  assert.match(cockpit.blockedActions.join("\n"), /operate Kling/);
  assert.doesNotMatch(JSON.stringify(cockpit), /capture accepted:\s*yes|production_ready:\s*true|publish_ready:\s*true/i);
});

test("package runs dashboard renders Second-Cut Candidate Inspector safely", () => {
  const html = packageRunsDashboard.renderSecondCutInspector({
    runId: "2026-05-06-ai-video-proof-plan",
    candidateStatus: "not_found",
    currentGate: "Second-Cut Candidate Preparation",
    roughCutStatus: "NEEDS PICKUPS",
    secondCutReady: false,
    humanGateRequired: true,
    nextSafeAction: "Second-cut candidate not found. Next safe action: export or identify a second-cut candidate, then inspect it before any approval.",
    candidates: [],
    pickupMedia: [
      { filename: "keyboard-mouse-process.MOV", path: "/tmp/keyboard-mouse-process.MOV", likelyCategory: "hands", usableStatus: "unknown", humanReviewRequired: true, metadataUnavailable: true },
    ],
    pickupRequirements: {
      roughCutStatus: "NEEDS PICKUPS",
      secondCutReady: false,
      sourceWatchNoteMarker: "NEEDS PICKUPS",
      pickupListStatus: "open",
      editFixListStatus: "closed",
      pickupsRequested: ["Maybe add closeups"],
      editFixesRequested: [],
    },
    placementChecklist: ["Confirm keyboard/mouse clip is used during workflow/process narration.", "Confirm rough cut is not approved until Mikko reviews the second-cut candidate."],
    aiAllowed: ["inspect file metadata", "classify pickup files"],
    aiBlocked: ["approve rough cut", "mark second-cut ready"],
    blockedActions: ["mark second-cut ready", "publish"],
    warnings: ["Second-cut candidate not found."],
  });

  assert.match(html, /Second-Cut Candidate Inspector/);
  assert.match(html, /not_found/);
  assert.match(html, /Human review required/);
  assert.match(html, /Pickup Media/);
  assert.match(html, /keyboard-mouse-process\.MOV/);
  assert.match(html, /Placement Review Checklist/);
  assert.match(html, /AI allowed/);
  assert.match(html, /AI blocked/);
  assert.match(html, /Blocked Actions/);
});

test("package runs dashboard renders Second-Cut Candidate Registration safely", () => {
  const html = packageRunsDashboard.renderSecondCutCandidateRegistration({
    runId: "2026-05-06-ai-video-proof-plan",
    candidateRegistration: {
      previewApi: "/api/package-runs/second-cut-candidate/preview",
      applyApi: "/api/package-runs/second-cut-candidate/apply",
    },
  });

  assert.match(html, /Register Second-Cut Candidate/);
  assert.match(html, /This records a candidate for human review/);
  assert.match(html, /does not approve rough cut or mark second-cut ready/);
  assert.match(html, /data-second-cut-candidate-path/);
  assert.match(html, /data-preview-second-cut-candidate/);
  assert.match(html, /data-apply-second-cut-candidate disabled/);
  assert.doesNotMatch(html, /PASS/);
  assert.doesNotMatch(html, /approval marker/i);
});

test("package runs dashboard renders Second-Cut Human Review safely", () => {
  const html = packageRunsDashboard.renderSecondCutHumanReview({
    runId: "2026-05-06-ai-video-proof-plan",
    secondCutInspector: {
      registeredCandidate: { path: "/tmp/second-cut-candidate.mp4" },
      candidateStatus: "found_needs_review",
      secondCutWatchNotesExists: false,
      secondCutReviewExists: false,
      secondCutReviewStatus: "NEEDS HUMAN REVIEW",
      secondCutReady: false,
      humanGateRequired: true,
      blockedActions: ["mark second-cut ready", "publish"],
      aiAllowed: ["inspect candidate metadata"],
      aiBlocked: ["choose READY FOR SECOND CUT"],
    },
  });

  assert.match(html, /Second-Cut Human Review/);
  assert.match(html, /NEEDS MORE PICKUPS/);
  assert.match(html, /NEEDS EDIT FIXES/);
  assert.match(html, /READY FOR SECOND CUT/);
  assert.match(html, /human approval marker/i);
  assert.match(html, /data-save-second-cut-watch-notes/);
  assert.match(html, /data-regenerate-second-cut-review/);
  assert.match(html, /AI allowed/);
  assert.match(html, /AI blocked/);
  assert.doesNotMatch(html, /Final review:\s*PASS/i);
});

test("package runs dashboard formats capture evidence intake rows", () => {
  const rows = packageRunsDashboard.formatCaptureEvidenceRows({
    takeName: "Take 01 | Hook",
    takeSource: "shot-list.md hook",
    takeReference: "media/take-01-hook.mov",
    takeNotes: "00:00-00:42 clean take",
    screenName: "Workflow proof screen",
    screenPurpose: "shows final UI result",
    screenReference: "recordings/workflow-proof.mp4",
    audioItem: "Voiceover main",
    audioRequirement: "final script sections 1-4",
    audioReference: "audio/voiceover-main.wav",
  });

  assert.equal(rows.valid, true);
  assert.deepEqual(rows.missing, []);
  assert.equal(rows.takesLog, "| Take 01 / Hook | shot-list.md hook | media/take-01-hook.mov | 00:00-00:42 clean take | captured |");
  assert.equal(rows.screenRecordingChecklist, "| Workflow proof screen | shows final UI result | recordings/workflow-proof.mp4 | captured |");
  assert.equal(rows.audioCaptureChecklist, "| Voiceover main | final script sections 1-4 | audio/voiceover-main.wav | recorded |");
  assert.equal(rows.approvalMarker, "Capture evidence approval: PASS");
});

test("package runs dashboard flags missing capture evidence intake fields", () => {
  const rows = packageRunsDashboard.formatCaptureEvidenceRows({
    takeName: "Take 01",
    screenName: "Workflow proof",
    audioItem: "Voiceover",
  });

  assert.equal(rows.valid, false);
  assert.deepEqual(rows.missing, ["take media reference", "screen recording file/reference", "audio file/reference"]);
  assert.match(rows.takesLog, /Missing required fields for real evidence/);
  assert.match(rows.screenRecordingChecklist, /Missing required fields for real evidence/);
  assert.match(rows.audioCaptureChecklist, /Missing required fields for real evidence/);
});

test("package runs dashboard browser write path requests local write config", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");

  assert.match(source, /\/api\/package-engine\/status/);
  assert.match(source, /localWriteNonce/);
  assert.match(source, /nonceHeader/);
  assert.match(source, /Local write config unavailable\. Copy buttons still work\./);
});

test("package runs dashboard renders safely with missing lifecycle fields", () => {
  const index = packageRunsDashboard.normalizeIndex({
    runs: [
      {
        runId: "2026-05-12-legacy",
        path: "package-runs/2026-05-12-legacy",
        status: "Package selected",
        files: { selected_package_json: true },
      },
    ],
  });

  const run = index.runs[0];
  const card = packageRunsDashboard.renderRunCard(run);

  assert.equal(run.lifecycleGate.shotEditPlanReviewStatus, "");
  assert.equal(run.conservativeBlockedActions.length, 0);
  assert.equal(run.detectedButNotTrustedArtifacts.length, 0);
  assert.match(card, /Lifecycle Review/);
  assert.match(card, /missing review/);
  assert.match(card, /No conservative blocked actions reported/);
  assert.match(card, /No detected downstream artifacts are currently being rejected as proof/);
  assert.match(card, /Capture Evidence Intake/);
  assert.match(card, /data-copy-capture-row="approvalMarker"/);
});

test("package runs dashboard renders a safe markdown preview subset", () => {
  const html = packageRunsDashboard.renderMarkdown(`# Title <script>

Paragraph with **bold** and \`code\`.

- Bullet <b>one</b>
- [x] Done item
- [ ] Open item

\`\`\`
const unsafe = "<tag>";
\`\`\`
`);

  assert.match(html, /<h1>Title &lt;script&gt;<\/h1>/);
  assert.match(html, /<p>Paragraph with <strong>bold<\/strong> and <code>code<\/code>\.<\/p>/);
  assert.match(html, /<li>Bullet &lt;b&gt;one&lt;\/b&gt;<\/li>/);
  assert.match(html, /type="checkbox" disabled checked/);
  assert.match(html, /type="checkbox" disabled/);
  assert.match(html, /&lt;tag&gt;/);
  assert.doesNotMatch(html, /<script>|<b>one<\/b>/);
});

test("package runs dashboard has a shell launcher documented", () => {
  const scriptPath = path.join(__dirname, "..", "scripts", "open-package-runs-dashboard.sh");
  const script = fs.readFileSync(scriptPath, "utf8");
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  const workflowDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "package-runs-dashboard-workflow.md"), "utf8");
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");

  assert.match(script, /scripts\/serve-local\.sh/);
  assert.match(script, /package-runs-dashboard\.html/);
  assert.match(script, /api\/package-engine\/status/);
  assert.doesNotMatch(script, /package-run-state|approval marker|Hermes brain|project memory/i);
  assert.match(readme, /scripts\/open-package-runs-dashboard\.sh/);
  assert.match(workflowDoc, /scripts\/open-package-runs-dashboard\.sh/);
  assert.match(verify, /sh -n scripts\/open-package-runs-dashboard\.sh/);
});

test("productionBucketForRun classifies runs into correct production buckets", () => {
  const { productionBucketForRun } = packageRunsDashboard;

  assert.equal(productionBucketForRun({ workflowBucket: "Needs script" }), "In Production");
  assert.equal(productionBucketForRun({ workflowBucket: "Ready to shoot" }), "In Production");
  assert.equal(productionBucketForRun({ workflowBucket: "Needs rough-cut review" }), "At Review");
  assert.equal(productionBucketForRun({ workflowBucket: "Needs final review" }), "At Review");
  assert.equal(productionBucketForRun({ workflowBucket: "Needs QA repair" }), "Blocked / Needs Action");
  assert.equal(productionBucketForRun({ workflowBucket: "Needs proof capture" }), "Blocked / Needs Action");
  assert.equal(productionBucketForRun({ inactive: true, workflowBucket: "Ready to shoot" }), "Inactive / Archived");
  assert.equal(productionBucketForRun({ workflowBucket: "Inactive: parked" }), "Inactive / Archived");
  assert.equal(productionBucketForRun({ workflowBucket: "Inactive: superseded" }), "Inactive / Archived");
  assert.equal(productionBucketForRun(null), "In Production");
  assert.equal(productionBucketForRun({}), "In Production");
  assert.equal(productionBucketForRun({ workflowBucket: undefined }), "In Production");
});

test("groupRunsByProductionBucket groups all runs and preserves bucket order", () => {
  const { groupRunsByProductionBucket, PRODUCTION_BUCKETS } = packageRunsDashboard;

  const runs = [
    { runId: "r1", workflowBucket: "Needs script" },
    { runId: "r2", workflowBucket: "Needs rough-cut review" },
    { runId: "r3", workflowBucket: "Needs QA repair" },
    { runId: "r4", inactive: true, workflowBucket: "Ready to shoot" },
    { runId: "r5", workflowBucket: "Ready to shoot" },
    { runId: "r6", workflowBucket: "Needs final review" },
    { runId: "r7", workflowBucket: "Needs proof capture" },
    { runId: "r8", workflowBucket: "Inactive: parked" },
  ];

  const buckets = groupRunsByProductionBucket(runs);

  assert.deepEqual(Object.keys(buckets), PRODUCTION_BUCKETS);
  assert.equal(buckets["In Production"].length, 2);
  assert.equal(buckets["At Review"].length, 2);
  assert.equal(buckets["Blocked / Needs Action"].length, 2);
  assert.equal(buckets["Inactive / Archived"].length, 2);
  assert.equal(buckets["In Production"][0].runId, "r1");
  assert.equal(buckets["At Review"][0].runId, "r2");
  assert.equal(buckets["Blocked / Needs Action"][0].runId, "r3");
  assert.equal(buckets["Inactive / Archived"][0].runId, "r4");
});

test("groupRunsByProductionBucket handles empty and null input", () => {
  const { groupRunsByProductionBucket, PRODUCTION_BUCKETS } = packageRunsDashboard;

  const emptyBuckets = groupRunsByProductionBucket([]);
  assert.deepEqual(Object.keys(emptyBuckets), PRODUCTION_BUCKETS);
  PRODUCTION_BUCKETS.forEach((label) => assert.equal(emptyBuckets[label].length, 0));

  const nullBuckets = groupRunsByProductionBucket(null);
  assert.deepEqual(Object.keys(nullBuckets), PRODUCTION_BUCKETS);
  PRODUCTION_BUCKETS.forEach((label) => assert.equal(nullBuckets[label].length, 0));
});

test("renderProductionsOverview renders bucket sections with counts and focus buttons", () => {
  const { renderProductionsOverview } = packageRunsDashboard;

  const runs = [
    { runId: "2026-05-01-a", title: "Active Run", status: "Ready to shoot", workflowBucket: "Ready to shoot", path: "package-runs/2026-05-01-a" },
    { runId: "2026-05-02-b", title: "Review Run", status: "Needs rough-cut review", workflowBucket: "Needs rough-cut review", path: "package-runs/2026-05-02-b" },
  ];

  const html = renderProductionsOverview(runs);
  assert.match(html, /In Production/);
  assert.match(html, /At Review/);
  assert.match(html, /production-bucket-count/);
  assert.match(html, /data-focus-run="2026-05-01-a"/);
  assert.match(html, /data-focus-run="2026-05-02-b"/);
  assert.match(html, /Focus this run/);
  assert.match(html, /compact-pipeline-strip/);
});

test("focusRunFolderForRun returns bare run id for module API calls", () => {
  const { focusRunFolderForRun } = packageRunsDashboard;

  assert.equal(
    focusRunFolderForRun({
      runId: "2026-05-06-ai-video-proof-plan",
      path: "package-runs/2026-05-06-ai-video-proof-plan",
    }),
    "2026-05-06-ai-video-proof-plan"
  );
  assert.equal(focusRunFolderForRun(null, "2026-05-07-next-run"), "2026-05-07-next-run");
});

test("renderProductionsOverview renders empty message when no runs exist", () => {
  const { renderProductionsOverview } = packageRunsDashboard;

  const html = renderProductionsOverview([]);
  assert.match(html, /No package runs found/);
  assert.doesNotMatch(html, /production-bucket/);
});

test("renderCompactPipelineStrip renders progress bar and bucket label", () => {
  const { renderCompactPipelineStrip } = packageRunsDashboard;

  const html = renderCompactPipelineStrip({ status: "Ready to shoot", workflowBucket: "Ready to shoot" });
  assert.match(html, /compact-pipeline-bar/);
  assert.match(html, /compact-pipeline-fill/);
  assert.match(html, /Ready to shoot/);
  assert.match(html, /style="width:\d+%"/);
});

test("renderCompactPipelineStrip includes blocker reason when present", () => {
  const { renderCompactPipelineStrip } = packageRunsDashboard;

  const html = renderCompactPipelineStrip({
    status: "Production prep ready",
    workflowBucket: "Needs QA repair",
    firstBlockerReason: "Creator QA failed: script mismatch",
  });
  assert.match(html, /compact-strip-blocker/);
  assert.match(html, /Creator QA failed/);
});

// ── Wrapped-response normalization regression tests ─────────────────────────
// Proves package-runs-dashboard.js browser code unwraps { ok, data } responses
// from sendJSON() before reading success fields in capture/evidence workflows.

test("package-runs-dashboard: normalizePayload unwraps { ok, data } envelope", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "normalizePayload function should exist");
  const normalizePayload = new Function("json", match[1]);

  const unwrapped = normalizePayload({ ok: true, data: { previewToken: "abc123", written: ["file.md"] } });
  assert.equal(unwrapped.previewToken, "abc123");
  assert.deepEqual(unwrapped.written, ["file.md"]);
});

test("package-runs-dashboard: normalizePayload passes through non-wrapped objects", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  const normalizePayload = new Function("json", match[1]);

  const plain = { previewToken: "tok", warning: "ok" };
  assert.strictEqual(normalizePayload(plain), plain);
  assert.strictEqual(normalizePayload(null), null);
  assert.strictEqual(normalizePayload(undefined), undefined);
});

test("package-runs-dashboard: evidence intake preview uses normalizePayload", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");

  // Evidence intake preview must unwrap with normalizePayload before reading previewToken.
  const previewSection = source.split("evidenceIntakePreviewApi")[1]?.split("function saveEvidenceIntake")[0] || "";
  assert.match(previewSection, /return normalizePayload\(json\)/);
  assert.match(previewSection, /payload\.previewToken/);
  assert.doesNotMatch(previewSection, /json\.data !== undefined \? json\.data : json/);
});

test("package-runs-dashboard: evidence intake save uses normalizePayload for written/warning", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");

  // Save must unwrap with normalizePayload, then read written/warning from unwrapped payload.
  const saveSection = source.split("function saveEvidenceIntake")[1]?.split("function previewCaptureWrite")[0] || "";
  assert.match(saveSection, /return normalizePayload\(json\)/);
  assert.match(saveSection, /payload\.warning/);
  assert.match(saveSection, /payload\.written/);
  // Must not read written/warning from raw json (pre-unwrap).
  assert.doesNotMatch(saveSection, /json\.written/);
  assert.doesNotMatch(saveSection, /json\.warning/);
});

test("package-runs-dashboard: capture evidence preview uses normalizePayload for previewToken", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");

  const previewSection = source.split("function previewCaptureWrite")[1]?.split("function applyCaptureWrite")[0] || "";
  assert.match(previewSection, /return normalizePayload\(json\)/);
  assert.match(previewSection, /payload\.previewToken/);
  // Must not read previewToken from raw json (pre-unwrap).
  assert.doesNotMatch(previewSection, /json\.previewToken/);
});

test("package-runs-dashboard: capture evidence apply uses normalizePayload for written/nextCommands", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");

  const applySection = source.split("function applyCaptureWrite")[1]?.split("function copyText")[0] || "";
  assert.match(applySection, /return normalizePayload\(json\)/);
  assert.match(applySection, /payload\?\.written/);
  assert.match(applySection, /payload\?\.nextCommands/);
  // Must not read written/nextCommands from raw json (pre-unwrap).
  assert.doesNotMatch(applySection, /json\.written/);
  assert.doesNotMatch(applySection, /json\.nextCommands/);
});

test("package-runs-dashboard: capture evidence error paths still read top-level json.error", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");

  // Error paths must read json.error from raw wrapper (sendError exposes at top level).
  const previewSection = source.split("function previewCaptureWrite")[1]?.split("function applyCaptureWrite")[0] || "";
  assert.match(previewSection, /json\.error/);

  const applySection = source.split("function applyCaptureWrite")[1]?.split("function copyText")[0] || "";
  assert.match(applySection, /json\.error/);

  const saveSection = source.split("function saveEvidenceIntake")[1]?.split("function previewCaptureWrite")[0] || "";
  assert.match(saveSection, /json\.error/);
});

test("package-runs-dashboard: wrapped preview response exposes previewToken correctly", () => {
  // Functional test: simulate the browser-side normalizePayload + field extraction
  // for a capture evidence preview response.
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  const normalizePayload = new Function("json", match[1]);

  const wrappedResponse = {
    ok: true,
    data: {
      previewToken: "preview-abc-789",
      preview: "# Capture Evidence Intake Log\n\n## Section 1",
      targetFile: "capture-evidence-intake-log.md",
      warnings: [],
    },
  };

  const unwrapped = normalizePayload(wrappedResponse);
  assert.equal(unwrapped.previewToken, "preview-abc-789");
  assert.match(unwrapped.preview, /Capture Evidence Intake Log/);
  assert.equal(unwrapped.targetFile, "capture-evidence-intake-log.md");
  assert.deepEqual(unwrapped.warnings, []);
});

test("package-runs-dashboard: wrapped save response exposes written/warning correctly", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  const normalizePayload = new Function("json", match[1]);

  const wrappedResponse = {
    ok: true,
    data: {
      written: ["capture-evidence-intake-log.md"],
      warning: "Saved 1 file.",
      previewToken: "",
    },
  };

  const unwrapped = normalizePayload(wrappedResponse);
  assert.deepEqual(unwrapped.written, ["capture-evidence-intake-log.md"]);
  assert.equal(unwrapped.warning, "Saved 1 file.");
  // Simulate the status message logic from saveEvidenceIntake.
  const statusMessage = unwrapped.warning || `Saved: ${(unwrapped.written || []).join(", ")}`;
  assert.equal(statusMessage, "Saved 1 file.");
});

test("package-runs-dashboard: wrapped apply response succeeds without relying on raw wrapper fields", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  const normalizePayload = new Function("json", match[1]);

  const wrappedResponse = {
    ok: true,
    data: {
      written: ["capture-evidence-review.md", "pickup-list.md"],
      nextCommands: ["Review rough-cut notes", "Open Resolve"],
    },
  };

  const unwrapped = normalizePayload(wrappedResponse);
  assert.deepEqual(unwrapped.written, ["capture-evidence-review.md", "pickup-list.md"]);
  assert.deepEqual(unwrapped.nextCommands, ["Review rough-cut notes", "Open Resolve"]);

  // Simulate the status message logic from applyCaptureWrite.
  const statusMessage = `Applied locally to ${(unwrapped?.written || []).join(", ")}${unwrapped?.written?.length ? ". " : " (no files). "}Capture is not approved. Next: ${(unwrapped?.nextCommands || []).join(" then ")}`;
  assert.match(statusMessage, /Applied locally to capture-evidence-review\.md, pickup-list\.md/);
  assert.match(statusMessage, /Next: Review rough-cut notes then Open Resolve/);
});

test("package-runs-dashboard: error response with top-level error field is not unwrapped", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  const normalizePayload = new Function("json", match[1]);

  // sendError() responses have { ok: false, error: "..." } — no data key.
  const errorResponse = {
    ok: false,
    error: "Invalid nonce",
    errorCode: "AUTH_FAILED",
  };

  const unwrapped = normalizePayload(errorResponse);
  // Should pass through as-is since ok is false (no data unwrap).
  assert.strictEqual(unwrapped, errorResponse);
  assert.equal(unwrapped.error, "Invalid nonce");
  assert.equal(unwrapped.errorCode, "AUTH_FAILED");
});

// ── F3: plain-language next-action mapping ──────────────────────────────────
test("package-runs-dashboard: plainNextAction maps technical blockers to creator steps", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  const match = source.match(/function plainNextAction\(stage, blockedUntil, fallback\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "plainNextAction should exist");
  const plainNextAction = new Function("stage", "blockedUntil", "fallback", match[1]);

  assert.match(
    plainNextAction("Blocked / evidence missing", "generation-manifest.json is readable and contains prompt-03 items.", "raw"),
    /B-roll images \(Steps 6/,
  );
  assert.match(
    plainNextAction("Blocked / evidence missing", "Mikko selects prompt-03 still images in the manifest.", "raw"),
    /Step 8/,
  );
  assert.match(
    plainNextAction("Capture / b-roll candidate creation", "Kling video candidates exist on VIDNAS.", "raw"),
    /Step 9/,
  );
  assert.match(plainNextAction("Resolve timeline test", "x", "raw"), /Step 11/);
  assert.match(plainNextAction("Resolve test review", "x", "raw"), /Step 12/);
});

test("package-runs-dashboard: plainNextAction falls back to the raw text when unmapped", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  const match = source.match(/function plainNextAction\(stage, blockedUntil, fallback\) \{([\s\S]*?)\n  \}/);
  const plainNextAction = new Function("stage", "blockedUntil", "fallback", match[1]);
  assert.equal(plainNextAction("Totally unknown stage", "totally unknown blocker", "the original text"), "the original text");
});

// ── F2: front-door title fallback (resume.html) ─────────────────────────────
test("resume.html: displayTitle keeps real titles, prettifies slugs, drops junk default", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "resume.html"), "utf8");
  const match = source.match(/function displayTitle\(run\) \{([\s\S]*?)\n      \}/);
  assert.ok(match, "displayTitle should exist");
  const displayTitle = new Function("run", match[1]);
  assert.equal(displayTitle({ title: "Real Topic Here", runId: "2026-06-24-x" }), "Real Topic Here");
  assert.equal(displayTitle({ title: "", runId: "2026-06-06-ai-replace-editors" }), "ai replace editors");
  assert.equal(displayTitle({ title: "Selected Package", runId: "2026-05-06-ai-video-proof-plan" }), "ai video proof plan");
});
