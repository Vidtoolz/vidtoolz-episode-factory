const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const model = require("../episode-model.js");
const storage = require("../storage-adapter.js");
const packageEngine = require("../package-engine-model.js");
const packageRun = require("../package-engine-run.js");
const packageRunScript = require("../scripts/package-engine-new-run.js");
const packageOutlineScript = require("../scripts/package-engine-new-outline.js");
const packageScriptPrepScript = require("../scripts/package-engine-new-script.js");
const packageProductionPrepScript = require("../scripts/package-engine-new-production.js");
const packageResearchPackScript = require("../scripts/package-run-research-pack.js");
const packageResearchEvidenceScript = require("../scripts/package-run-research-evidence.js");
const packageScriptStructureScript = require("../scripts/package-run-script-structure.js");
const packageScriptReviewScript = require("../scripts/package-run-script-review.js");
const packageProductionPlanScript = require("../scripts/package-run-production-plan.js");
const packageShotEditPlanReviewScript = require("../scripts/package-run-shot-edit-plan-review.js");
const packageCaptureChecklistScript = require("../scripts/package-run-capture-checklist.js");
const packageCaptureEvidenceReviewScript = require("../scripts/package-run-capture-evidence-review.js");
const packageCaptureGapScript = require("../scripts/package-run-capture-gap.js");
const packageRunEvidenceLintScript = require("../scripts/package-run-evidence-lint.js");
const packageArtifactHygieneScript = require("../scripts/package-run-artifact-hygiene.js");
const packageRoughCutReviewScript = require("../scripts/package-run-rough-cut-review.js");
const packageFinalReviewScript = require("../scripts/package-run-final-review.js");
const packageRepurposeScript = require("../scripts/package-run-repurpose.js");
const packageBrollPromptsScript = require("../scripts/package-run-broll-prompts.js");
const packageExportChecklistScript = require("../scripts/package-run-export-checklist.js");
const packagePublicationMetadataScript = require("../scripts/package-run-publication-metadata.js");
const packageArchiveManifestScript = require("../scripts/package-run-archive-manifest.js");
const packageRunCreatorQaScript = require("../scripts/package-run-creator-qa.js");
const packageRunDoctorScript = require("../scripts/package-run-doctor.js");
const packageRunNextActionScript = require("../scripts/package-run-next-action.js");
const packageRunNextSafeActionScript = require("../scripts/package-run-next-safe-action.js");
const packageRunNextActionAuthorityScript = require("../scripts/package-run-next-action-authority.js");
const packageRunWorkflowMapScript = require("../scripts/package-run-workflow-map.js");
const nextTaskClassifierScript = require("../scripts/next-task-classifier.js");
const packageRunActiveStateAuditScript = require("../scripts/package-run-active-state-audit.js");
const packageRunStateProposalScript = require("../scripts/package-run-state-proposal.js");
const packageProductionApprovalRepairScript = require("../scripts/package-run-production-approval-repair.js");
const packageProductionApprovalReviewScript = require("../scripts/package-run-production-approval-review.js");
const packageRunsIndexScript = require("../scripts/package-runs-index.js");
const packageRunsDashboardLaunchScript = require("../scripts/package-runs-dashboard-launch.js");
const scriptImageAssetsDryRunScript = require("../scripts/script-image-assets-dry-run.js");
const scriptImageAssetsReviewPageScript = require("../scripts/script-image-assets-review-page.js");
const topicScoutScript = require("../scripts/topic-scout.js");
const oneOfTenInputHelper = require("../scripts/oneof10-input-helper.js");
const packageEngineServer = require("../package-engine-server.js");
const packageRunsDashboard = require("../package-runs-dashboard.js");
const episodeFactoryCli = require("../scripts/episode-factory.js");
const proposalLoopGuard = require("../scripts/proposal-loop-guard.js");
const proposalLoopRunner = require("../scripts/proposal-loop-runner.js");
const trailerCueGenerator = require("../trailer-cue-generator.js");
const trailerCueScript = require("../scripts/trailer-cue-new.js");
const musicCueGenerator = require("../music-cue-generator.js");
const musicCueScript = require("../scripts/music-cue-new.js");
const supervisedCapture = require("../supervised-capture.js");
const supervisedCaptureScript = require("../scripts/supervised-capture.js");
const earthStudioJobPlanner = require("../earth-studio-job-planner.js");
const earthStudioJobScript = require("../scripts/earth-studio-job-plan.js");
const publishedVideosValidator = require("../scripts/validate-published-videos.js");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const output = { stdout: [], stderr: [], result: undefined };
  console.log = (...args) => output.stdout.push(args.join(" "));
  console.error = (...args) => output.stderr.push(args.join(" "));
  try {
    output.result = fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return output;
}

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function runGitCommand(repoDir, args) {
  return childProcess.execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeTestFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createNextSafeActionFixture(options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-safe-action-"));
  const runId = options.runId || "2026-05-06-ai-video-proof-plan";
  const runDir = path.join(tempRoot, "package-runs", runId);
  const assetDir = path.join(tempRoot, "vidnas", "script-image-assets", "Proof_Plan");
  const klingDir = path.join(assetDir, "kling-video-candidates");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  const manifestPath = path.join(assetDir, "generation-manifest.json");
  const selected = options.selected === false ? [] : ["block-024", "block-027", "block-030"];
  const items = ["block-024", "block-027", "block-030"].map((blockId) => ({
    block_id: blockId,
    prompt_id: `${blockId}-prompt-03`,
    output_filename: `${blockId}-prompt-03.png`,
    generation_status: "generated",
    reviewed_by_mikko: true,
    selected: selected.includes(blockId),
    approved: false,
    production_ready: false,
  }));
  fs.writeFileSync(manifestPath, JSON.stringify({ output_folder: assetDir, items }, null, 2), "utf8");
  writeTestFile(tempRoot, "reports/prompt-03-selected-image-edit-handoff.md", `# Handoff\n\nSource manifest:\n\`${manifestPath}\`\n`);
  writeTestFile(tempRoot, "reports/prompt-03-image-selection-review.md", "# Selection Review\n");
  writeTestFile(tempRoot, "reports/prompt-03-kling-video-candidate-handoff.md", "# Kling Handoff\n");
  if (options.klingVideos) {
    fs.mkdirSync(klingDir, { recursive: true });
    fs.writeFileSync(path.join(klingDir, "block-024-prompt-03-kling-01.mp4"), "fake video\n", "utf8");
  }
  if (options.resolveTest) {
    fs.writeFileSync(path.join(runDir, "rough-cut-watch-notes.md"), "Kling clip imported into Resolve timeline and tested by Mikko.\n", "utf8");
  }
  return { tempRoot, runId, runDir, assetDir, klingDir, manifestPath };
}

function createNextTaskClassifierFixture(options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-task-classifier-"));
  const agentBusRoot = path.join(tempRoot, "agent-bus");
  const runId = options.runId || "2026-05-06-ai-video-proof-plan";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeTestFile(agentBusRoot, "bin/codex-prompt-basis", "#!/usr/bin/env bash\n");
  writeTestFile(tempRoot, "scripts/open-package-runs-dashboard.sh", "#!/usr/bin/env sh\n");
  writeTestFile(tempRoot, "package-runs-dashboard.js", "const label = 'Second-cut readiness';\n");
  writeTestFile(
    tempRoot,
    `package-runs/${runId}/package-run-state.md`,
    "# Package Run State\n\n- State: active\n"
  );
  writeTestFile(
    tempRoot,
    `package-runs/${runId}/capture-evidence-review.md`,
    "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Manual approval marker detected: yes\n- Ready for rough-cut work: yes\n- Real capture evidence detected: yes\n"
  );
  writeTestFile(
    tempRoot,
    `package-runs/${runId}/rough-cut-watch-notes.md`,
    "# Rough-Cut Watch Notes\n\nRough cut file media/rough-cut-v1.mp4 was reviewed by Mikko.\n\n## Pickups Needed\n\nAdd closeups.\n\n## Manual Rough-Cut Approval Marker\n\nRough-cut approval: NEEDS PICKUPS\n"
  );
  writeTestFile(
    tempRoot,
    `package-runs/${runId}/rough-cut-review.md`,
    "# Rough-Cut Review\n\n- Rough-cut review status: NEEDS PICKUPS\n- Second-cut ready: no\n\n## Second-Cut Readiness Gate\n\n- Status: NEEDS PICKUPS\n- Reason: Watch notes list pickups needed.\n"
  );
  writeTestFile(
    tempRoot,
    `package-runs/${runId}/media-creation-plan.md`,
    "# Media Creation Plan\n\nDraft pickup planning only.\n"
  );
  runGitCommand(tempRoot, ["init", "-b", "main"]);
  runGitCommand(tempRoot, ["config", "user.email", "test@example.invalid"]);
  runGitCommand(tempRoot, ["config", "user.name", "Test User"]);
  runGitCommand(tempRoot, ["add", "."]);
  runGitCommand(tempRoot, ["commit", "-m", "baseline"]);
  if (options.untracked !== false) {
    writeTestFile(tempRoot, "reports/local-untracked-report.md", "# Local Report\n");
  }
  return { tempRoot, agentBusRoot, runId, runDir };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createProposalGuardRepo(prefix = "proposal-loop-guard-") {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const originDir = path.join(tempRoot, "origin.git");
  const worktree = path.join(tempRoot, "worktree");
  const realRepo = path.join(tempRoot, "real-repo");

  fs.mkdirSync(worktree);
  fs.mkdirSync(realRepo);
  runGitCommand(worktree, ["init", "-b", "main"]);
  runGitCommand(worktree, ["config", "user.email", "test@example.invalid"]);
  runGitCommand(worktree, ["config", "user.name", "Test User"]);
  writeTestFile(worktree, "scripts/package-run-capture-gap.js", "baseline\n");
  writeTestFile(worktree, "tests/run-tests.js", "baseline\n");
  writeTestFile(worktree, "package-runs/2026-05-02-topic/notes.md", "baseline\n");
  runGitCommand(worktree, ["add", "."]);
  runGitCommand(worktree, ["commit", "-m", "baseline"]);
  runGitCommand(tempRoot, ["init", "--bare", originDir]);
  runGitCommand(worktree, ["remote", "add", "origin", originDir]);
  runGitCommand(worktree, ["push", "-u", "origin", "main"]);

  return { tempRoot, originDir, realRepo, worktree };
}

function inspectProposalGuardRepo(fixture, options = {}) {
  return proposalLoopGuard.inspectWorktree({
    repo: options.repo || fixture.realRepo,
    worktree: Object.hasOwn(options, "worktree") ? options.worktree : fixture.worktree,
    allowed: options.allowed || ["scripts/package-run-capture-gap.js", "tests/run-tests.js"],
    patch: options.patch || "",
  });
}

function runProposalGuardCommandPreflight(fixture, command, options = {}) {
  return captureConsole(() =>
    proposalLoopGuard.main([
      "--repo",
      options.repo || fixture.realRepo,
      "--expected-worktree",
      options.expectedWorktree || fixture.worktree,
      "--codex-command",
      command,
    ])
  );
}

module.exports = {
  assert,
  childProcess,
  fs,
  http,
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
};
