const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
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
const packageProductionApprovalRepairScript = require("../scripts/package-run-production-approval-repair.js");
const packageProductionApprovalReviewScript = require("../scripts/package-run-production-approval-review.js");
const packageRunsIndexScript = require("../scripts/package-runs-index.js");
const packageRunsDashboardLaunchScript = require("../scripts/package-runs-dashboard-launch.js");
const packageEngineServer = require("../package-engine-server.js");
const packageRunsDashboard = require("../package-runs-dashboard.js");
const episodeFactoryCli = require("../scripts/episode-factory.js");
const proposalLoopGuard = require("../scripts/proposal-loop-guard.js");
const proposalLoopRunner = require("../scripts/proposal-loop-runner.js");
const trailerCueGenerator = require("../trailer-cue-generator.js");
const trailerCueScript = require("../scripts/trailer-cue-new.js");

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

test("proposal loop guard review rejects missing worktree before git inspection", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-missing-worktree-");
  const report = inspectProposalGuardRepo(fixture, { worktree: "" });
  const packet = proposalLoopGuard.formatReviewPacket(report);

  assert.equal(report.accepted, false);
  assert.deepEqual(report.trackedChangedFiles, []);
  assert.deepEqual(report.untrackedFiles, []);
  assert.deepEqual(report.stagedFiles, []);
  assert.deepEqual(report.commitsAhead, []);
  assert.match(packet, /Decision: rejected/);
  assert.match(packet, /## Tracked Changed Files\n- none/);
  assert.match(packet, /## Untracked Files\n- none/);
  assert.match(packet, /## Staged Files\n- none/);
  assert.match(packet, /## Commits Ahead Of origin\/main\n- none/);
  assert.match(packet, /--worktree is required\./);
  assert.doesNotMatch(packet, /git diff --check failed/);
});

test("proposal loop guard review rejects nonexistent tmp worktree before git inspection", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-nonexistent-worktree-");
  const missingWorktree = path.join(os.tmpdir(), "proposal-loop-guard-missing-worktree", String(Date.now()));
  const report = inspectProposalGuardRepo(fixture, { worktree: missingWorktree });
  const packet = proposalLoopGuard.formatReviewPacket(report);

  assert.equal(report.accepted, false);
  assert.deepEqual(report.trackedChangedFiles, []);
  assert.deepEqual(report.untrackedFiles, []);
  assert.deepEqual(report.stagedFiles, []);
  assert.deepEqual(report.commitsAhead, []);
  assert.match(packet, /Decision: rejected/);
  assert.match(packet, /## Tracked Changed Files\n- none/);
  assert.match(packet, /## Untracked Files\n- none/);
  assert.match(packet, /## Staged Files\n- none/);
  assert.match(packet, /## Commits Ahead Of origin\/main\n- none/);
  assert.match(packet, /--worktree does not exist\./);
  assert.doesNotMatch(packet, /git diff --check failed/);
});

test("proposal loop guard review rejects file worktree before git inspection", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-file-worktree-");
  const fileWorktree = path.join(fixture.tempRoot, "not-a-worktree.txt");
  fs.writeFileSync(fileWorktree, "not a directory\n", "utf8");

  const report = inspectProposalGuardRepo(fixture, { worktree: fileWorktree });
  const packet = proposalLoopGuard.formatReviewPacket(report);

  assert.equal(report.accepted, false);
  assert.deepEqual(report.trackedChangedFiles, []);
  assert.deepEqual(report.untrackedFiles, []);
  assert.deepEqual(report.stagedFiles, []);
  assert.deepEqual(report.commitsAhead, []);
  assert.match(packet, /Decision: rejected/);
  assert.match(packet, /## Tracked Changed Files\n- none/);
  assert.match(packet, /## Untracked Files\n- none/);
  assert.match(packet, /## Staged Files\n- none/);
  assert.match(packet, /## Commits Ahead Of origin\/main\n- none/);
  assert.match(packet, /--worktree is not a directory\./);
  assert.doesNotMatch(packet, /git diff --check failed/);
});

test("proposal loop guard review rejects symlink escaping tmp before git inspection", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-symlink-worktree-");
  const symlinkWorktree = path.join(fixture.tempRoot, "worktree-link");
  const outsideTmpTarget = path.parse(os.tmpdir()).root;
  fs.symlinkSync(outsideTmpTarget, symlinkWorktree, "dir");

  const report = inspectProposalGuardRepo(fixture, { worktree: symlinkWorktree });
  const packet = proposalLoopGuard.formatReviewPacket(report);

  assert.equal(report.accepted, false);
  assert.deepEqual(report.trackedChangedFiles, []);
  assert.deepEqual(report.untrackedFiles, []);
  assert.deepEqual(report.stagedFiles, []);
  assert.deepEqual(report.commitsAhead, []);
  assert.match(packet, /Decision: rejected/);
  assert.match(packet, /## Tracked Changed Files\n- none/);
  assert.match(packet, /## Untracked Files\n- none/);
  assert.match(packet, /## Staged Files\n- none/);
  assert.match(packet, /## Commits Ahead Of origin\/main\n- none/);
  assert.match(packet, /--worktree must not be a symlink\./);
  assert.doesNotMatch(packet, /git diff --check failed/);
});

test("proposal loop guard review rejects non-Git tmp directory before diff inspection", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-non-git-worktree-");
  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-loop-guard-non-git-"));
  const report = inspectProposalGuardRepo(fixture, { worktree: nonGitDir });
  const packet = proposalLoopGuard.formatReviewPacket(report);

  assert.equal(report.accepted, false);
  assert.deepEqual(report.trackedChangedFiles, []);
  assert.deepEqual(report.untrackedFiles, []);
  assert.deepEqual(report.stagedFiles, []);
  assert.deepEqual(report.commitsAhead, []);
  assert.match(packet, /Decision: rejected/);
  assert.match(packet, /## Tracked Changed Files\n- none/);
  assert.match(packet, /## Untracked Files\n- none/);
  assert.match(packet, /## Staged Files\n- none/);
  assert.match(packet, /## Commits Ahead Of origin\/main\n- none/);
  assert.match(packet, /--worktree must be a Git worktree\./);
  assert.doesNotMatch(packet, /git diff --check failed/);
});

test("proposal loop guard review accepts valid Git tmp worktree with allowed diff", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-accept-");
  writeTestFile(fixture.worktree, "scripts/package-run-capture-gap.js", "allowed change\n");

  const report = inspectProposalGuardRepo(fixture);

  assert.equal(report.accepted, true);
  assert.deepEqual(report.trackedChangedFiles, ["scripts/package-run-capture-gap.js"]);
  assert.deepEqual(report.untrackedFiles, []);
  assert.deepEqual(report.stagedFiles, []);
  assert.deepEqual(report.commitsAhead, []);
  assert.equal(report.changedFilesWithinAllowedScope, true);
});

test("proposal loop guard review rejects valid Git tmp worktree with forbidden file scope", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-forbidden-");
  writeTestFile(fixture.worktree, "package-runs/2026-05-02-topic/notes.md", "forbidden change\n");

  const report = inspectProposalGuardRepo(fixture);

  assert.equal(report.accepted, false);
  assert.deepEqual(report.trackedChangedFiles, ["package-runs/2026-05-02-topic/notes.md"]);
  assert.match(report.failures.join("\n"), /outside allowed scope/);
});

test("proposal loop guard rejects staged files", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-staged-");
  writeTestFile(fixture.worktree, "scripts/package-run-capture-gap.js", "staged change\n");
  runGitCommand(fixture.worktree, ["add", "scripts/package-run-capture-gap.js"]);

  const report = inspectProposalGuardRepo(fixture);

  assert.equal(report.accepted, false);
  assert.deepEqual(report.stagedFiles, ["scripts/package-run-capture-gap.js"]);
  assert.match(report.failures.join("\n"), /Staged files exist/);
});

test("proposal loop guard rejects untracked files", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-untracked-");
  writeTestFile(fixture.worktree, "scratch.md", "untracked\n");

  const report = inspectProposalGuardRepo(fixture);

  assert.equal(report.accepted, false);
  assert.deepEqual(report.untrackedFiles, ["scratch.md"]);
  assert.match(report.failures.join("\n"), /Untracked files exist/);
});

test("proposal loop guard rejects commits ahead", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-ahead-");
  writeTestFile(fixture.worktree, "scripts/package-run-capture-gap.js", "committed change\n");
  runGitCommand(fixture.worktree, ["add", "scripts/package-run-capture-gap.js"]);
  runGitCommand(fixture.worktree, ["commit", "-m", "ahead"]);

  const report = inspectProposalGuardRepo(fixture);

  assert.equal(report.accepted, false);
  assert.equal(report.commitsAhead.length, 1);
  assert.match(report.commitsAhead[0], /ahead/);
  assert.match(report.failures.join("\n"), /Commits ahead of origin\/main exist/);
});

test("proposal loop guard rejects worktree outside /tmp", () => {
  const report = proposalLoopGuard.inspectWorktree({
    repo: "/tmp/proposal-loop-guard-real",
    worktree: "/home/vidtoolz/vidtoolz-episode-factory",
    allowed: ["scripts/package-run-capture-gap.js"],
  });

  assert.equal(report.accepted, false);
  assert.match(report.failures.join("\n"), /must be under \/tmp/);
});

test("proposal loop guard rejects worktree equal to or inside real repo", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-real-scope-");
  const equalReport = inspectProposalGuardRepo(fixture, {
    repo: fixture.worktree,
    worktree: fixture.worktree,
  });
  const insideReport = inspectProposalGuardRepo(fixture, {
    repo: fixture.worktree,
    worktree: path.join(fixture.worktree, "nested-clone"),
  });

  assert.equal(equalReport.accepted, false);
  assert.equal(insideReport.accepted, false);
  assert.match(equalReport.failures.join("\n"), /must not equal the real repo/);
  assert.match(insideReport.failures.join("\n"), /must not equal the real repo/);
});

test("proposal loop guard exports rejected patch with rejected patch naming", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-rejected-patch-");
  const requestedPatch = path.join(fixture.tempRoot, "proposal.patch");
  writeTestFile(fixture.worktree, "package-runs/2026-05-02-topic/notes.md", "forbidden patch\n");

  const report = inspectProposalGuardRepo(fixture, { patch: requestedPatch });

  assert.equal(report.accepted, false);
  assert.equal(report.patchPath, path.join(fixture.tempRoot, "proposal.rejected.patch"));
  assert.equal(fs.existsSync(requestedPatch), false);
  assert.equal(fs.existsSync(report.patchPath), true);
  assert.match(fs.readFileSync(report.patchPath, "utf8"), /package-runs\/2026-05-02-topic\/notes\.md/);
});

test("proposal loop guard accepts codex command with expected disposable clone -C path", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-codex-command-accept-");

  const report = proposalLoopGuard.validateCodexCommandBoundary({
    command: ["codex", "exec", "--full-auto", "-C", fixture.worktree, "make the change"],
    repo: fixture.realRepo,
    expectedWorktree: fixture.worktree,
  });

  assert.equal(report.accepted, true);
  assert.deepEqual(report.failures, []);
  assert.equal(report.codexWorktree, path.resolve(fixture.worktree));
});

test("proposal loop guard cli accepts safe codex command with matching expected worktree", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-cli-codex-command-accept-");
  const output = runProposalGuardCommandPreflight(
    fixture,
    `codex exec --full-auto -C "${fixture.worktree}" make the change`
  );
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 0);
  assert.match(stdout, /Command-boundary decision: accepted/);
  assert.match(stdout, new RegExp(`Parsed Codex worktree: ${escapeRegExp(path.resolve(fixture.worktree))}`));
  assert.match(stdout, new RegExp(`Expected disposable clone: ${escapeRegExp(path.resolve(fixture.worktree))}`));
  assert.match(stdout, /Rejection Reasons\n- none/);
});

test("proposal loop guard rejects codex command without -C", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-codex-command-missing-c-");

  const report = proposalLoopGuard.validateCodexCommandBoundary({
    command: `codex exec --full-auto "make the change"`,
    repo: fixture.realRepo,
    expectedWorktree: fixture.worktree,
  });

  assert.equal(report.accepted, false);
  assert.match(report.failures.join("\n"), /must include -C/);
});

test("proposal loop guard cli rejects missing -C", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-cli-codex-command-missing-c-");
  const output = runProposalGuardCommandPreflight(fixture, `codex exec --full-auto "make the change"`);
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 1);
  assert.match(stdout, /Command-boundary decision: rejected/);
  assert.match(stdout, /Parsed Codex worktree: \(missing\)/);
  assert.match(stdout, /Codex command must include -C/);
});

test("proposal loop guard rejects codex command with -C but no path", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-codex-command-empty-c-");

  const report = proposalLoopGuard.validateCodexCommandBoundary({
    command: ["codex", "exec", "-C", "--full-auto", "make the change"],
    repo: fixture.realRepo,
    expectedWorktree: fixture.worktree,
  });

  assert.equal(report.accepted, false);
  assert.match(report.failures.join("\n"), /-C must include a path/);
});

test("proposal loop guard rejects codex command -C outside tmp", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-codex-command-outside-tmp-");

  const report = proposalLoopGuard.validateCodexCommandBoundary({
    command: ["codex", "exec", "-C", "/home/vidtoolz/other-clone", "make the change"],
    repo: fixture.realRepo,
    expectedWorktree: fixture.worktree,
  });

  assert.equal(report.accepted, false);
  assert.match(report.failures.join("\n"), /must be under \/tmp/);
});

test("proposal loop guard cli rejects -C outside tmp", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-cli-codex-command-outside-tmp-");
  const output = runProposalGuardCommandPreflight(
    fixture,
    `codex exec --full-auto -C /home/vidtoolz/other-clone make the change`
  );
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 1);
  assert.match(stdout, /Command-boundary decision: rejected/);
  assert.match(stdout, /Parsed Codex worktree: \/home\/vidtoolz\/other-clone/);
  assert.match(stdout, /Codex command -C path must be under \/tmp/);
});

test("proposal loop guard rejects codex command -C equal to or inside real repo", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-codex-command-real-repo-");
  const equalReport = proposalLoopGuard.validateCodexCommandBoundary({
    command: ["codex", "exec", "-C", fixture.realRepo, "make the change"],
    repo: fixture.realRepo,
    expectedWorktree: fixture.worktree,
  });
  const insideReport = proposalLoopGuard.validateCodexCommandBoundary({
    command: ["codex", "exec", "-C", path.join(fixture.realRepo, "nested-clone"), "make the change"],
    repo: fixture.realRepo,
    expectedWorktree: fixture.worktree,
  });

  assert.equal(equalReport.accepted, false);
  assert.equal(insideReport.accepted, false);
  assert.match(equalReport.failures.join("\n"), /must not equal the real repo/);
  assert.match(insideReport.failures.join("\n"), /must not equal the real repo/);
});

test("proposal loop guard cli rejects -C equal to the real repo", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-cli-codex-command-real-repo-equal-");
  const output = runProposalGuardCommandPreflight(
    fixture,
    `codex exec --full-auto -C "${fixture.realRepo}" make the change`
  );
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 1);
  assert.match(stdout, /Command-boundary decision: rejected/);
  assert.match(stdout, new RegExp(`Parsed Codex worktree: ${escapeRegExp(path.resolve(fixture.realRepo))}`));
  assert.match(stdout, /Codex command -C path must not equal the real repo or be inside it/);
});

test("proposal loop guard cli rejects -C inside the real repo", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-cli-codex-command-real-repo-inside-");
  const nestedClone = path.join(fixture.realRepo, "nested-clone");
  const output = runProposalGuardCommandPreflight(
    fixture,
    `codex exec --full-auto -C "${nestedClone}" make the change`
  );
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 1);
  assert.match(stdout, /Command-boundary decision: rejected/);
  assert.match(stdout, new RegExp(`Parsed Codex worktree: ${escapeRegExp(path.resolve(nestedClone))}`));
  assert.match(stdout, /Codex command -C path must not equal the real repo or be inside it/);
});

test("proposal loop guard rejects codex command -C that is not the expected disposable clone", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-codex-command-wrong-clone-");
  const wrongWorktree = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-loop-guard-wrong-clone-"));

  const report = proposalLoopGuard.validateCodexCommandBoundary({
    command: `codex exec --full-auto -C "${wrongWorktree}" make the change`,
    repo: fixture.realRepo,
    expectedWorktree: fixture.worktree,
  });

  assert.equal(report.accepted, false);
  assert.match(report.failures.join("\n"), /must match the expected disposable clone path/);
});

test("proposal loop guard cli rejects -C that does not match expected worktree", () => {
  const fixture = createProposalGuardRepo("proposal-loop-guard-cli-codex-command-wrong-clone-");
  const wrongWorktree = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-loop-guard-cli-wrong-clone-"));
  const output = runProposalGuardCommandPreflight(
    fixture,
    `codex exec --full-auto -C "${wrongWorktree}" make the change`
  );
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 1);
  assert.match(stdout, /Command-boundary decision: rejected/);
  assert.match(stdout, new RegExp(`Parsed Codex worktree: ${escapeRegExp(path.resolve(wrongWorktree))}`));
  assert.match(stdout, new RegExp(`Expected disposable clone: ${escapeRegExp(path.resolve(fixture.worktree))}`));
  assert.match(stdout, /Codex command -C path must match the expected disposable clone path/);
});

test("creates a normalized episode with required defaults", () => {
  const episode = model.createEpisode({ workingTitle: "Test episode" });

  assert.equal(episode.workingTitle, "Test episode");
  assert.equal(episode.status, "Idea");
  assert.equal(episode.format, "long");
  assert.equal(episode.sourceNotes, "");
  assert.equal(episode.scriptPath, "");
  assert.equal(model.getGateSummary(episode).total, model.PACKAGING_GATE.length);
  assert.equal(model.getChecklistSummary(episode, "productionChecklist").total, 7);
  assert.match(episode.productionChecklist, /Record A-roll/);
});

test("normalization preserves unknown harmless episode fields", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "Unknown Fields",
    externalToolId: "abc-123",
    editorialFlags: { needsReview: true },
  });

  assert.equal(episode.externalToolId, "abc-123");
  assert.deepEqual(episode.editorialFlags, { needsReview: true });
});

test("invalid episode format normalizes to long", () => {
  const episode = model.normalizeEpisode({ format: "feature-film" });

  assert.equal(episode.format, "long");
});

test("normalizes invalid status back to Idea", () => {
  const episode = model.normalizeEpisode({ status: "Unknown" });

  assert.equal(episode.status, "Idea");
});

test("duplicates reset status and preserve package fields", () => {
  const original = model.createEpisode({
    workingTitle: "Original",
    status: "Editing",
    corePromise: "Promise",
  });
  const copy = model.duplicateEpisode(original);

  assert.notEqual(copy.id, original.id);
  assert.equal(copy.status, "Idea");
  assert.equal(copy.corePromise, "Promise");
  assert.match(copy.workingTitle, /copy$/);
});

test("packaging gate reports pass fail state", () => {
  const episode = model.createEpisode({
    checklists: {
      packagingGate: {
        "Viewer problem is clear": true,
        "Target viewer is specific": { passed: true },
      },
    },
  });
  const summary = model.getGateSummary(episode);

  assert.equal(summary.passed, 2);
  assert.equal(summary.isComplete, false);
});

test("checklist normalization creates every v0.2 group with default items", () => {
  const episode = model.normalizeEpisode({ workingTitle: "Checklist test" });

  assert.equal(model.CHECKLIST_GROUPS.length, 5);
  assert.equal(Object.keys(episode.checklists).length, 5);
  assert.equal(model.getChecklistSummary(episode, "packagingGate").total, 8);
  assert.equal(model.getChecklistSummary(episode, "shortsChecklist").total, 5);
});

test("old episode data keeps legacy text and receives structured checklist defaults", () => {
  const episode = model.normalizeEpisode({
    id: "old-one",
    workingTitle: "Old One",
    productionChecklist: "- Custom old production note",
    editingChecklist: "- Custom old edit note",
    publishChecklist: "- Custom old publish note",
  });

  assert.equal(episode.productionChecklist, "- Custom old production note");
  assert.equal(episode.editingChecklist, "- Custom old edit note");
  assert.equal(episode.publishChecklist, "- Custom old publish note");
  assert.equal(model.getChecklistSummary(episode, "productionChecklist").passed, 0);
  assert.equal(model.getReadinessScores(episode).production, 0);
});

test("old packaging gate labels migrate to v0.2 checklist labels", () => {
  const episode = model.normalizeEpisode({
    packagingGate: {
      "Viewer and problem are specific": true,
      "Promise is useful and believable": { passed: true },
    },
  });
  const summary = model.getChecklistSummary(episode, "packagingGate");

  assert.equal(summary.passed, 3);
  assert.equal(episode.checklists.packagingGate["Viewer problem is clear"].passed, true);
  assert.equal(episode.checklists.packagingGate["Target viewer is specific"].passed, true);
  assert.equal(episode.checklists.packagingGate["Core promise is concrete"].passed, true);
});

test("readiness scoring combines checklist and script readiness", () => {
  const fullChecklist = model.CHECKLIST_GROUPS.reduce((result, group) => {
    result[group.key] = model.checklistToObject(group.items.map((label) => ({ label, passed: true })));
    return result;
  }, {});
  const episode = model.normalizeEpisode({
    topic: "Focused topic",
    workingTitle: "Specific title",
    targetViewer: "Solo creator",
    viewerProblem: "Workflow is unclear",
    corePromise: "A practical production system",
    titleOptions: "- One\n- Two\n- Three",
    thumbnailConcept: "Clear before/after visual",
    hook: "Stop losing good ideas.",
    scriptOutline: "- Setup\n- Process\n- Payoff",
    checklists: fullChecklist,
  });
  const scores = model.getReadinessScores(episode);

  assert.deepEqual(scores, {
    packaging: 100,
    script: 100,
    production: 100,
    publish: 100,
    overall: 100,
  });
});

test("partial readiness scoring is percentage based", () => {
  const episode = model.normalizeEpisode({
    checklists: {
      packagingGate: model.checklistToObject([
        { label: "Viewer problem is clear", passed: true },
        { label: "Target viewer is specific", passed: true },
      ]),
    },
  });

  assert.equal(model.getReadinessScores(episode).packaging, 25);
  assert.ok(model.getReadinessScores(episode).overall < 100);
});

test("checklist toggle state persists and readiness recalculates after storage reload", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };
  const episode = model.normalizeEpisode({ id: "readiness-persist", workingTitle: "Readiness Persist" });
  const beforeScores = model.getReadinessScores(episode);
  const productionGroup = model.normalizeChecklistGroup(
    "productionChecklist",
    episode.checklists.productionChecklist
  );
  const toggledGroup = productionGroup.map((item, index) =>
    index === 0 ? { ...item, passed: true } : item
  );
  const toggledEpisode = model.normalizeEpisode({
    ...episode,
    checklists: {
      ...episode.checklists,
      productionChecklist: model.checklistToObject(toggledGroup),
    },
  });

  storage.saveState({ selectedId: toggledEpisode.id, episodes: [toggledEpisode] }, options);
  const reloadedToggled = storage.loadState(options).episodes[0];
  const afterScores = model.getReadinessScores(reloadedToggled);

  assert.equal(beforeScores.production, 0);
  assert.equal(reloadedToggled.checklists.productionChecklist["Screen recording plan is clear"].passed, true);
  assert.equal(afterScores.production, 5);
  assert.notEqual(afterScores.overall, beforeScores.overall);

  const restoredGroup = model.normalizeChecklistGroup(
    "productionChecklist",
    reloadedToggled.checklists.productionChecklist
  ).map((item) =>
    item.label === "Screen recording plan is clear" ? { ...item, passed: false } : item
  );
  const restoredEpisode = model.normalizeEpisode({
    ...reloadedToggled,
    checklists: {
      ...reloadedToggled.checklists,
      productionChecklist: model.checklistToObject(restoredGroup),
    },
  });
  storage.saveState({ selectedId: restoredEpisode.id, episodes: [restoredEpisode] }, options);
  const reloadedRestored = storage.loadState(options).episodes[0];
  const restoredScores = model.getReadinessScores(reloadedRestored);

  assert.equal(reloadedRestored.checklists.productionChecklist["Screen recording plan is clear"].passed, false);
  assert.equal(restoredScores.production, beforeScores.production);
  assert.equal(restoredScores.overall, beforeScores.overall);
});

test("duplication preserves structured checklist state while resetting status", () => {
  const original = model.normalizeEpisode({
    workingTitle: "Original Checklist",
    status: "Editing",
    checklists: {
      publishChecklist: {
        "Final title selected": { passed: true },
      },
    },
  });
  const copy = model.duplicateEpisode(original);

  assert.equal(copy.status, "Idea");
  assert.equal(model.getChecklistSummary(copy, "publishChecklist").passed, 1);
  assert.notEqual(copy.id, original.id);
});

test("copy payloads include integration-ready context", () => {
  const episode = model.createEpisode({
    workingTitle: "Workflow video",
    topic: "Local-first production",
    corePromise: "Build faster packages",
  });

  assert.match(model.buildCopyPayload("linear", episode), /# Workflow video/);
  assert.match(model.buildCopyPayload("codex", episode), /VIDTOOLZ/);
  assert.match(model.buildCopyPayload("hermes", episode), /Readiness/);
  assert.match(model.buildCopyPayload("youtube", episode), /Build faster packages/);
});

test("full markdown package includes readiness checklist states and next action", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "Full Package",
    status: "Packaging",
    targetViewer: "Solo creator",
    viewerProblem: "Packaging is scattered",
    corePromise: "One complete package",
    hook: "Do not shoot until this is clear.",
    titleOptions: "- One\n- Two\n- Three",
    thumbnailConcept: "Before and after board",
    scriptOutline: "- Setup\n- Build\n- Ship",
    productionChecklist: "- Legacy production note",
    editingChecklist: "- Legacy editing note",
    shortsPlan: "- Short one",
    publishChecklist: "- Legacy publish note",
    checklists: {
      packagingGate: {
        "Viewer problem is clear": { passed: true },
      },
    },
  });
  const markdown = model.buildFullEpisodeMarkdownPackage(episode);

  assert.match(markdown, /^# Full Package/);
  assert.match(markdown, /Status: Packaging/);
  assert.match(markdown, /Target viewer: Solo creator/);
  assert.match(markdown, /Packaging readiness: 13%/);
  assert.match(markdown, /- \[x\] Viewer problem is clear/);
  assert.match(markdown, /- \[ \] Target viewer is specific/);
  assert.match(markdown, /## Production Notes\n- Legacy production note/);
  assert.match(markdown, /## Shorts Extraction Plan\n- Short one/);
  assert.match(markdown, /## Next Action/);
});

test("single episode export builders produce the expected package types", () => {
  const fullChecklist = model.CHECKLIST_GROUPS.reduce((result, group) => {
    result[group.key] = model.checklistToObject(group.items.map((label) => ({ label, passed: true })));
    return result;
  }, {});
  const episode = model.normalizeEpisode({
    topic: "Export workflow",
    workingTitle: "Package Export",
    targetViewer: "Solo creator",
    viewerProblem: "Needs reusable packages",
    corePromise: "Export the right package for each tool",
    hook: "The package is the handoff.",
    titleOptions: "- Package Export\n- Export Better\n- One Episode Package",
    thumbnailConcept: "One package split into tools",
    scriptOutline: "- Why\n- Build\n- Use",
    checklists: fullChecklist,
  });

  assert.match(model.buildEpisodeExportPayload("markdown", episode), /# Package Export/);
  assert.match(model.buildEpisodeExportPayload("hermes", episode), /memory update/i);
  assert.match(model.buildEpisodeExportPayload("linear", episode), /## Remaining Checklist/);
  assert.match(model.buildEpisodeExportPayload("production", episode), /# Production Brief/);
  assert.match(model.buildEpisodeExportPayload("youtube", episode), /# YouTube Publish Package/);
  assert.match(model.buildEpisodeExportPayload("codex", episode), /follow-up task/i);
  assert.match(model.buildEpisodeExportPayload("creator-qa-json", episode), /"viewerPayoff"/);
  assert.match(model.buildEpisodeExportPayload("creator-qa-markdown", episode), /# Viewer Payoff/);
});

test("creator qa json export includes expected keys", () => {
  const episode = model.normalizeEpisode({
    topic: "Resolve export workflow",
    workingTitle: "Fix Flat DaVinci Resolve Exports",
    targetViewer: "Resolve editor",
    viewerProblem: "Exports look flat",
    corePromise: "Fix flat exports",
    thumbnailConcept: "Before after export frame",
    hook: "Your export should not look worse than the timeline.",
    scriptOutline: "- Hook\n- Problem\n- Steps\n- Payoff",
    notes: "Check Resolve terms before publish.",
  });
  const payload = model.buildCreatorQaJsonObject(episode);

  model.CREATOR_QA_JSON_KEYS.forEach((key) => assert.ok(Object.hasOwn(payload, key), key));
  assert.equal(payload.title, "Fix Flat DaVinci Resolve Exports");
  assert.equal(payload.thumbnailConcept, "Before after export frame");
  assert.equal(payload.viewerPayoff, "Fix flat exports");
  assert.equal(payload.status, "Idea");
  assert.ok(Array.isArray(payload.factualClaims));
  assert.ok(Array.isArray(payload.sourceNotes));
  assert.ok(Array.isArray(payload.checklist));
  assert.ok(Array.isArray(payload.shortsIdeas));
});

test("creator qa markdown export includes expected sections", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "Creator QA Markdown",
    corePromise: "A usable QA package",
    thumbnailConcept: "QA checklist",
    hook: "Do not publish before QA.",
    scriptOutline: "- Check\n- Fix\n- Rerun",
  });
  const markdown = model.buildCreatorQaMarkdownPackage(episode);

  [
    "# Title",
    "# Thumbnail",
    "# Hook",
    "# Viewer Payoff",
    "# Script",
    "# Factual Claims / Source Notes",
    "# Resolve Terminology Used",
    "# Notes",
  ].forEach((section) => assert.match(markdown, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
});

test("creator qa exports tolerate missing optional fields", () => {
  const episode = model.normalizeEpisode({});
  const payload = model.buildCreatorQaJsonObject(episode);
  const markdown = model.buildCreatorQaMarkdownPackage(episode);

  model.CREATOR_QA_JSON_KEYS.forEach((key) => assert.ok(Object.hasOwn(payload, key), key));
  assert.doesNotThrow(() => JSON.parse(model.buildCreatorQaJsonExport(episode)));
  assert.match(markdown, /# Title/);
  assert.match(markdown, /# Notes/);
});

test("packaging review returns actionable warnings", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "The Best Resolve Workflow",
    titleOptions: "- The Best Resolve Workflow",
    corePromise: "The fastest editing workflow",
    scriptOutline: "- Setup\n- Export",
  });
  const review = model.buildPackagingReview(episode);
  const markdown = model.buildPackagingReviewMarkdown(episode);

  assert.equal(review.ok, false);
  assert.ok(review.warnings.some((warning) => warning.code === "title-options-thin"));
  assert.ok(review.warnings.some((warning) => warning.code === "audience-missing"));
  assert.ok(review.warnings.some((warning) => warning.code === "claims-need-verification"));
  assert.match(markdown, /Action:/);
});

test("structured outline export includes grounding checklist", () => {
  const markdown = model.buildStructuredOutlineMarkdown(
    model.normalizeEpisode({
      workingTitle: "Outline Test",
      format: "newsletter",
      corePromise: "A grounded outline",
    })
  );

  assert.match(markdown, /^# Outline: Outline Test/);
  assert.match(markdown, /Format: newsletter/);
  assert.match(markdown, /## Factual \/ Grounding Checklist/);
  assert.match(markdown, /claims are based/i);
});

function completeChecklistExcept(exceptions = {}) {
  return model.CHECKLIST_GROUPS.reduce((result, group) => {
    result[group.key] = model.checklistToObject(
      group.items.map((label) => ({
        label,
        passed: !(exceptions[group.key] || []).includes(label),
      }))
    );
    return result;
  }, {});
}

function readyScriptEpisode(seed = {}) {
  return model.normalizeEpisode({
    topic: "Task workflow",
    workingTitle: "Task Workflow",
    targetViewer: "Solo creator",
    viewerProblem: "Does not know what to do next",
    corePromise: "A clear next task",
    titleOptions: "- One\n- Two\n- Three",
    thumbnailConcept: "Queue with one task",
    hook: "Do this next.",
    scriptOutline: "- Setup\n- Work\n- Done",
    ...seed,
  });
}

test("next-action generation creates a packaging repair task below 80 percent", () => {
  const episode = readyScriptEpisode({
    status: "Packaging",
    checklists: {
      packagingGate: model.checklistToObject([
        { label: "Viewer problem is clear", passed: true },
      ]),
    },
  });
  const task = model.generateNextActionTask(episode);

  assert.equal(task.type, "packagingBlocked");
  assert.equal(task.estimatedMinutes, 30);
  assert.match(task.taskTitle, /Repair/);
  assert.match(task.sourceBlocker, /Packaging Gate/);
});

test("work block creation stores required defaults on the episode", () => {
  const episode = model.normalizeEpisode({ id: "block-episode", workingTitle: "Block Episode" });
  const updated = model.addWorkBlock(episode, {
    category: "publish",
    objective: "Finalize title and thumbnail promise",
    inputsNeeded: ["Title ideas"],
    steps: ["Pick strongest promise"],
    doneCondition: "Title shortlist is ready.",
  });
  const block = updated.workBlocks[0];

  assert.match(block.id, /^block-/);
  assert.equal(block.episodeId, "block-episode");
  assert.equal(block.category, "publish");
  assert.equal(block.status, "open");
  assert.equal(block.estimatedMinutes, 30);
  assert.deepEqual(block.inputsNeeded, ["Title ideas"]);
  assert.deepEqual(block.steps, ["Pick strongest promise"]);
});

test("starter work block planning creates practical 30-minute blocks", () => {
  const episode = model.normalizeEpisode({ id: "starter-episode", workingTitle: "Starter Episode" });
  const planned = model.addStarterWorkBlocks(episode);

  assert.equal(planned.workBlocks.length, 7);
  assert.ok(planned.workBlocks.every((block) => block.estimatedMinutes === 30));
  assert.ok(planned.workBlocks.some((block) => block.objective === "Clarify premise and audience"));
  assert.ok(planned.workBlocks.some((block) => block.objective === "Prepare Resolve/media checklist"));
  assert.ok(planned.workBlocks.every((block) => block.steps.length > 0));
  assert.ok(planned.workBlocks.every((block) => block.doneCondition));
});

test("starter work block planning does not duplicate existing objectives", () => {
  const episode = model.normalizeEpisode({
    id: "starter-no-duplicate",
    workingTitle: "Starter No Duplicate",
    workBlocks: [
      {
        id: "existing-clarify",
        category: "close-loop",
        objective: "Clarify premise and audience",
        status: "open",
      },
    ],
  });
  const planned = model.addStarterWorkBlocks(episode);

  assert.equal(
    planned.workBlocks.filter((block) => block.objective === "Clarify premise and audience").length,
    1
  );
  assert.equal(planned.workBlocks.length, 7);
});

test("work block queue follows operational priority order", () => {
  const episode = model.normalizeEpisode({
    id: "priority-episode",
    workingTitle: "Priority Episode",
    workBlocks: [
      {
        id: "admin-new",
        category: "admin",
        objective: "Admin task",
        status: "open",
        createdAt: "2026-05-02T10:00:00.000Z",
      },
      {
        id: "publish-new",
        category: "publish",
        objective: "Publish task",
        status: "open",
        createdAt: "2026-05-02T11:00:00.000Z",
      },
      {
        id: "close-old",
        category: "close-loop",
        objective: "Close loop task",
        status: "open",
        createdAt: "2026-05-02T09:00:00.000Z",
      },
    ],
  });
  const queue = model.buildWorkBlockQueue([episode]);

  assert.deepEqual(queue.map((block) => block.id), ["publish-new", "close-old", "admin-new"]);
});

test("work block queue prefers active and older blocks within the same category", () => {
  const episode = model.normalizeEpisode({
    id: "same-category",
    workingTitle: "Same Category",
    workBlocks: [
      {
        id: "open-old",
        category: "system",
        objective: "Open old",
        status: "open",
        createdAt: "2026-05-02T09:00:00.000Z",
      },
      {
        id: "open-new",
        category: "system",
        objective: "Open new",
        status: "open",
        createdAt: "2026-05-02T10:00:00.000Z",
      },
      {
        id: "active-new",
        category: "system",
        objective: "Active new",
        status: "active",
        createdAt: "2026-05-02T11:00:00.000Z",
      },
    ],
  });
  const queue = model.buildWorkBlockQueue([episode]);

  assert.deepEqual(queue.map((block) => block.id), ["active-new", "open-old", "open-new"]);
});

test("starting completing and skipping work blocks updates status timestamps and notes", () => {
  const episode = model.addWorkBlock(model.normalizeEpisode({ id: "status-blocks" }), {
    objective: "Do the block",
  });
  const blockId = episode.workBlocks[0].id;
  const started = model.startWorkBlock(episode, blockId);
  const done = model.completeWorkBlock(started, blockId, "Finished title shortlist");
  const skippedSource = model.addWorkBlock(done, { objective: "Blocked work" });
  const skippedId = skippedSource.workBlocks[1].id;
  const skipped = model.skipWorkBlock(skippedSource, skippedId, "Blocked until footage exists");

  assert.equal(started.workBlocks[0].status, "active");
  assert.equal(done.workBlocks[0].status, "done");
  assert.match(done.workBlocks[0].completedAt, /T/);
  assert.equal(done.workBlocks[0].notes, "Finished title shortlist");
  assert.equal(skipped.workBlocks[1].status, "skipped");
  assert.equal(skipped.workBlocks[1].notes, "Blocked until footage exists");
});

test("work block next ignores done and skipped blocks", () => {
  const episode = model.normalizeEpisode({
    id: "ignore-complete",
    workingTitle: "Ignore Complete",
    workBlocks: [
      { id: "done-block", category: "publish", objective: "Done", status: "done" },
      { id: "skipped-block", category: "publish", objective: "Skipped", status: "skipped" },
      { id: "open-block", category: "system", objective: "Open", status: "open" },
    ],
  });
  const queue = model.buildWorkBlockQueue([episode]);

  assert.deepEqual(queue.map((block) => block.id), ["open-block"]);
  assert.match(model.buildWorkBlockCard(queue[0]), /block done open-block/);
});

test("import and export preserve work blocks", () => {
  const episode = model.addWorkBlock(model.normalizeEpisode({ id: "block-roundtrip", workingTitle: "Block Roundtrip" }), {
    category: "publish",
    objective: "Publish block",
    sourceTool: "test",
  });
  const payload = model.exportEpisodeCollectionJson({ selectedId: episode.id, episodes: [episode] });
  const imported = model.importEpisodeCollectionJson(payload);

  assert.equal(imported.ok, true);
  assert.equal(imported.state.episodes[0].workBlocks.length, 1);
  assert.equal(imported.state.episodes[0].workBlocks[0].objective, "Publish block");
});

test("browser localStorage shaped episode data with work blocks normalizes correctly", () => {
  const result = model.validateImportPayload({
    version: 1,
    selectedId: "browser-blocks",
    episodes: [
      {
        id: "browser-blocks",
        workingTitle: "Browser Blocks",
        workBlocks: [
          {
            id: "browser-block-one",
            category: "publish",
            objective: "Review browser block",
            inputsNeeded: ["Episode plan"],
            steps: ["Open browser UI", "Review block"],
            doneCondition: "Block is visible and editable.",
            status: "active",
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.episodes[0].workBlocks.length, 1);
  assert.equal(result.state.episodes[0].workBlocks[0].status, "active");
  assert.equal(result.state.episodes[0].workBlocks[0].estimatedMinutes, 30);
  assert.deepEqual(result.state.episodes[0].workBlocks[0].inputsNeeded, ["Episode plan"]);
});

test("doctor audit returns ok for clean current-style data", () => {
  const episode = model.addWorkBlock(
    model.normalizeEpisode({
      id: "doctor-clean",
      workingTitle: "Doctor Clean",
      status: "Idea",
      format: "long",
    }),
    {
      category: "publish",
      objective: "Check clean data",
    }
  );
  const report = model.auditEpisodeCollectionJson(
    model.exportEpisodeCollectionJson({ selectedId: episode.id, episodes: [episode] }),
    { storagePath: "/tmp/episodes.json" }
  );

  assert.equal(report.ok, true);
  assert.equal(report.storagePath, "/tmp/episodes.json");
  assert.equal(report.summary.episodes, 1);
  assert.equal(report.summary.workBlocks, 1);
  assert.equal(report.summary.workBlockStatuses.open, 1);
  assert.deepEqual(report.errors, []);
});

test("doctor audit reports duplicate episode ids as errors", () => {
  const report = model.auditEpisodeCollectionJson(
    JSON.stringify({
      schemaVersion: model.EXPORT_SCHEMA_VERSION,
      selectedId: "duplicate",
      episodes: [
        { id: "duplicate", workingTitle: "One", status: "Idea", format: "long" },
        { id: "duplicate", workingTitle: "Two", status: "Idea", format: "long" },
      ],
    })
  );

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((issue) => issue.code === "duplicate-episode-id"));
});

test("doctor audit reports duplicate work block ids as errors", () => {
  const report = model.auditEpisodeCollectionJson(
    JSON.stringify({
      schemaVersion: model.EXPORT_SCHEMA_VERSION,
      episodes: [
        {
          id: "block-dup-episode",
          workingTitle: "Block Dup",
          status: "Idea",
          format: "long",
          workBlocks: [
            { id: "same-block", episodeId: "block-dup-episode", category: "publish", status: "open", objective: "One", estimatedMinutes: 30 },
            { id: "same-block", episodeId: "block-dup-episode", category: "publish", status: "open", objective: "Two", estimatedMinutes: 30 },
          ],
        },
      ],
    })
  );

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((issue) => issue.code === "duplicate-work-block-id"));
});

test("doctor audit reports invalid work block status and category", () => {
  const report = model.auditEpisodeCollectionJson(
    JSON.stringify({
      schemaVersion: model.EXPORT_SCHEMA_VERSION,
      episodes: [
        {
          id: "bad-block-episode",
          workingTitle: "Bad Block",
          status: "Idea",
          format: "long",
          workBlocks: [
            {
              id: "bad-block",
              episodeId: "bad-block-episode",
              category: "random",
              status: "paused",
              objective: "Bad block",
              estimatedMinutes: 0,
            },
          ],
        },
      ],
    })
  );

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((issue) => issue.code === "invalid-work-block-status"));
  assert.ok(report.errors.some((issue) => issue.code === "invalid-work-block-category"));
  assert.ok(report.warnings.some((issue) => issue.code === "invalid-work-block-estimate"));
});

test("doctor audit reports invalid selectedId and missing required episode fields", () => {
  const report = model.auditEpisodeCollectionJson(
    JSON.stringify({
      schemaVersion: model.EXPORT_SCHEMA_VERSION,
      selectedId: "missing",
      episodes: [{ id: "thin-episode" }],
    })
  );

  assert.equal(report.ok, true);
  assert.ok(report.warnings.some((issue) => issue.code === "invalid-selected-id"));
  assert.ok(report.warnings.some((issue) => issue.code === "missing-required-episode-field"));
});

test("doctor audit reports invalid JSON", () => {
  const report = model.auditEpisodeCollectionJson("{nope");

  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, "invalid-json");
  assert.match(report.suggestedFixes[0], /JSON syntax/);
});

test("next-action generation creates a script task when package passes but script is thin", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "Thin Script",
    checklists: completeChecklistExcept(),
  });
  const task = model.generateNextActionTask(episode);

  assert.equal(task.type, "scriptNotReady");
  assert.match(task.reason, /Script readiness/);
  assert.match(task.sourceBlocker, /Topic|Target viewer|Viewer problem|Core promise|title/i);
});

test("next-action generation creates shoot prep editing and publish tasks", () => {
  const shoot = readyScriptEpisode({
    status: "Ready to Shoot",
    checklists: completeChecklistExcept({
      productionChecklist: [
        "Screen recording plan is clear",
        "Talking points are ready",
        "Needed assets are listed",
        "Example footage or project files are ready",
        "Audio setup is checked",
      ],
    }),
  });
  const editing = readyScriptEpisode({
    status: "Editing",
    checklists: completeChecklistExcept({
      editingChecklist: ["Main timeline assembled"],
    }),
  });
  const publish = readyScriptEpisode({
    status: "Ready to Publish",
    checklists: completeChecklistExcept({
      publishChecklist: ["Final title selected"],
    }),
  });

  assert.equal(model.generateNextActionTask(shoot).type, "readyToShoot");
  assert.equal(model.generateNextActionTask(editing).type, "editingIncomplete");
  assert.equal(model.generateNextActionTask(publish).type, "readyToPublish");
});

test("execution queue sorts by practical urgency", () => {
  const queue = model.buildExecutionQueue([
    readyScriptEpisode({
      id: "publish",
      workingTitle: "Publish",
      status: "Ready to Publish",
      checklists: completeChecklistExcept({ publishChecklist: ["Final title selected"] }),
    }),
    readyScriptEpisode({
      id: "package",
      workingTitle: "Package",
      checklists: { packagingGate: {} },
    }),
    model.normalizeEpisode({
      id: "script",
      workingTitle: "Script",
      checklists: completeChecklistExcept(),
    }),
  ]);

  assert.deepEqual(queue.map((task) => task.type), [
    "packagingBlocked",
    "scriptNotReady",
    "readyToPublish",
  ]);
});

test("published and archived complete episodes do not produce blocker tasks", () => {
  const published = readyScriptEpisode({
    status: "Published",
    checklists: completeChecklistExcept(),
  });
  const archived = readyScriptEpisode({
    status: "Archived",
    checklists: completeChecklistExcept(),
  });

  assert.equal(model.generateNextActionTask(published), null);
  assert.equal(model.generateNextActionTask(archived), null);
});

test("old episodes receive nextAction compatibility and can override inferred task", () => {
  const oldEpisode = model.normalizeEpisode({ workingTitle: "Old Task" });
  const override = model.normalizeEpisode({
    workingTitle: "Override Task",
    nextAction: "Record the missing B-roll",
  });
  const task = model.generateNextActionTask(override);

  assert.equal(oldEpisode.nextAction, "");
  assert.equal(task.taskTitle, "Record the missing B-roll");
  assert.equal(task.sourceBlocker, "Manual nextAction override");
});

test("task package copy builders include steps and success criteria", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Copy Task" }));

  assert.match(model.buildTaskPackagePayload("human", task), /## Steps/);
  assert.match(model.buildTaskPackagePayload("hermes", task), /Hermes task package/);
  assert.match(model.buildTaskPackagePayload("linear", task), /## Done When/);
  assert.match(model.buildTaskPackagePayload("codex", task), /30-minute VIDTOOLZ/);
});

test("old episodes receive empty work session history", () => {
  const episode = model.normalizeEpisode({ workingTitle: "Old Session Episode" });

  assert.deepEqual(episode.workSessions, []);
});

test("work session normalization fills required defaults", () => {
  const session = model.normalizeWorkSession({
    taskTitle: "Do the work",
    actualMinutes: "42",
    completedChecklistItems: [{ groupKey: "productionChecklist", item: "Audio setup is checked" }],
  });

  assert.match(session.id, /^session-/);
  assert.equal(session.taskTitle, "Do the work");
  assert.equal(session.estimatedMinutes, 30);
  assert.equal(session.actualMinutes, 42);
  assert.equal(session.completedChecklistItems.length, 1);
});

test("old work sessions remain compatible without start and end timestamps", () => {
  const session = model.normalizeWorkSession({
    taskTitle: "Legacy work",
    createdAt: "2026-04-01T10:00:00.000Z",
  });

  assert.equal(session.createdAt, "2026-04-01T10:00:00.000Z");
  assert.equal(session.startedAt, "");
  assert.equal(session.endedAt, "");
});

test("adding a session stores history updates next action and selected checklist items", () => {
  const episode = readyScriptEpisode({
    checklists: completeChecklistExcept({
      productionChecklist: ["Audio setup is checked"],
    }),
  });
  const updated = model.addWorkSession(episode, {
    taskTitle: "Check audio",
    taskType: "readyToShoot",
    estimatedMinutes: 30,
    actualMinutes: 25,
    result: "Audio chain tested.",
    completedChecklistItems: [{ groupKey: "productionChecklist", item: "Audio setup is checked" }],
    notes: "No blocker.",
    nextActionAfterSession: "Record A-roll",
  });

  assert.equal(updated.workSessions.length, 1);
  assert.equal(updated.workSessions[0].result, "Audio chain tested.");
  assert.equal(updated.nextAction, "Record A-roll");
  assert.equal(updated.checklists.productionChecklist["Audio setup is checked"].passed, true);
});

test("selected checklist updates do not complete unselected items", () => {
  const episode = readyScriptEpisode({
    checklists: completeChecklistExcept({
      editingChecklist: ["Main timeline assembled", "Dead space removed"],
    }),
  });
  const updated = model.updateChecklistItems(episode, [
    { groupKey: "editingChecklist", item: "Main timeline assembled" },
  ]);

  assert.equal(updated.checklists.editingChecklist["Main timeline assembled"].passed, true);
  assert.equal(updated.checklists.editingChecklist["Dead space removed"].passed, false);
});

test("session export payload builders include session progress context", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ workingTitle: "Session Export" }), {
    taskTitle: "Finish edit pass",
    taskType: "editingIncomplete",
    actualMinutes: 31,
    result: "Timeline assembled.",
    completedChecklistItems: [{ groupKey: "editingChecklist", item: "Main timeline assembled" }],
    notes: "Needs captions.",
    nextActionAfterSession: "Add captions",
  });
  const session = episode.workSessions[0];

  assert.match(model.buildSessionExportPayload("hermes", episode, session), /Hermes session update/);
  assert.match(model.buildSessionExportPayload("linear", episode, session), /## Progress/);
  assert.match(model.buildSessionExportPayload("codex", episode, session), /continue a VIDTOOLZ/);
  assert.match(model.buildSessionExportPayload("history", episode, session), /Work Session History/);
});

test("JSON export and import preserve work sessions", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ id: "session-roundtrip" }), {
    taskTitle: "Round trip task",
    result: "Done",
  });
  const payload = model.buildExportPayload({ selectedId: episode.id, episodes: [episode] });
  const imported = model.validateImportPayload(payload);

  assert.equal(imported.ok, true);
  assert.equal(imported.state.episodes[0].workSessions.length, 1);
  assert.equal(imported.state.episodes[0].workSessions[0].taskTitle, "Round trip task");
});

test("completion form data normalization builds session input without completing text-derived checklist items", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Form Data" }));
  const data = model.normalizeCompletionFormData(
    {
      actualMinutes: "37",
      result: "Clarified the promise.",
      blocked: "Thumbnail is still weak.",
      notes: "Need visual comparison.",
      nextActionAfterSession: "Sketch thumbnail",
      completedChecklistItems: [],
    },
    task
  );

  assert.equal(data.taskTitle, task.taskTitle);
  assert.equal(data.actualMinutes, 37);
  assert.match(data.notes, /Still blocked: Thumbnail is still weak/);
  assert.deepEqual(data.completedChecklistItems, []);
});

test("editing a work session updates session fields and next action", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ workingTitle: "Edit Session" }), {
    taskTitle: "Original",
    result: "Old result",
    nextActionAfterSession: "Old next",
  });
  const sessionId = episode.workSessions[0].id;
  const updated = model.editWorkSession(episode, sessionId, {
    result: "New result",
    actualMinutes: 44,
    nextActionAfterSession: "New next",
  });

  assert.equal(updated.workSessions[0].result, "New result");
  assert.equal(updated.workSessions[0].actualMinutes, 44);
  assert.equal(updated.nextAction, "New next");
});

test("deleting a work session removes only that session", () => {
  const first = model.addWorkSession(readyScriptEpisode({ workingTitle: "Delete Session" }), {
    taskTitle: "First",
  });
  const second = model.addWorkSession(first, {
    taskTitle: "Second",
  });
  const deleted = model.deleteWorkSession(second, second.workSessions[0].id);

  assert.equal(deleted.workSessions.length, 1);
  assert.equal(deleted.workSessions[0].taskTitle, "First");
});

test("resume blocker task generation uses still blocked session text", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ workingTitle: "Resume Session" }), {
    taskTitle: "Work",
    notes: "Still blocked: Need cleaner hook\nOther note",
  });
  const task = model.buildResumeBlockerTask(episode, episode.workSessions[0]);

  assert.equal(task.type, "resumeBlocker");
  assert.match(task.taskTitle, /Need cleaner hook/);
  assert.match(task.reason, /still blocked/i);
});

test("repeat task generation uses previous session task title and type", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ workingTitle: "Repeat Session" }), {
    taskTitle: "Tighten hook",
    taskType: "scriptNotReady",
    estimatedMinutes: 25,
  });
  const task = model.buildRepeatTaskFromSession(episode, episode.workSessions[0]);

  assert.equal(task.type, "scriptNotReady");
  assert.equal(task.estimatedMinutes, 25);
  assert.match(task.taskTitle, /Tighten hook/);
});

test("JSON round trip preserves edited work sessions", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ id: "edited-roundtrip" }), {
    taskTitle: "Before edit",
    result: "Before",
  });
  const edited = model.editWorkSession(episode, episode.workSessions[0].id, {
    result: "After",
    actualMinutes: 12,
  });
  const imported = model.validateImportPayload(
    model.buildExportPayload({ selectedId: edited.id, episodes: [edited] })
  );

  assert.equal(imported.ok, true);
  assert.equal(imported.state.episodes[0].workSessions[0].result, "After");
  assert.equal(imported.state.episodes[0].workSessions[0].actualMinutes, 12);
});

test("active session normalization handles old or missing data", () => {
  assert.equal(model.normalizeActiveSession(null), null);
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Active Compat" }));
  const active = model.normalizeActiveSession({ task, elapsedSeconds: "12", isRunning: true }, 1000);

  assert.match(active.id, /^active-/);
  assert.equal(active.task.taskTitle, task.taskTitle);
  assert.equal(active.elapsedSeconds, 12);
  assert.equal(active.isRunning, true);
});

test("starting a session creates one running active session", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Start Active" }));
  const active = model.startActiveSession(task, 1000);

  assert.equal(active.task.id, task.id);
  assert.equal(active.episodeId, task.episodeId);
  assert.equal(active.startedAt, 1000);
  assert.equal(active.isRunning, true);
});

test("active session pause resume and elapsed time are testable", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Timer Active" }));
  const active = model.startActiveSession(task, 1000);
  assert.equal(model.getActiveSessionElapsedSeconds(active, 31000), 30);

  const paused = model.pauseActiveSession(active, 31000);
  assert.equal(paused.elapsedSeconds, 30);
  assert.equal(paused.isRunning, false);
  assert.equal(model.getActiveSessionElapsedSeconds(paused, 91000), 30);

  const resumed = model.resumeActiveSession(paused, 91000);
  assert.equal(model.getActiveSessionElapsedSeconds(resumed, 121000), 60);
});

test("completing an active session can become a work session with elapsed minutes", () => {
  const episode = model.normalizeEpisode({ workingTitle: "Complete Active" });
  const task = model.generateNextActionTask(episode);
  const active = model.startActiveSession(task, 0);
  const completion = model.buildCompletionDataFromActiveSession(
    active,
    { result: "Completed active work." },
    125000
  );
  const updated = model.addWorkSession(episode, completion);

  assert.equal(completion.actualMinutes, 3);
  assert.equal(completion.startedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(completion.endedAt, "1970-01-01T00:02:05.000Z");
  assert.equal(updated.workSessions.length, 1);
  assert.equal(updated.workSessions[0].taskTitle, task.taskTitle);
  assert.equal(updated.workSessions[0].startedAt, "1970-01-01T00:00:00.000Z");
});

test("completed active session persists in history and clears the active draft", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };
  const episode = model.normalizeEpisode({ id: "session-persist", workingTitle: "Session Persist" });
  const state = model.normalizeState({ selectedId: episode.id, episodes: [episode] });
  const task = model.generateNextActionTask(episode);
  const active = model.startActiveSession(task, 0);

  storage.saveState(state, options);
  storage.saveActiveSession(active, options);
  const loadedActive = storage.loadActiveSession(options);
  const completion = model.buildCompletionDataFromActiveSession(
    loadedActive,
    {
      result: "Completed persisted active work.",
      nextActionAfterSession: "Review persisted session history.",
    },
    61000
  );
  const completedEpisode = model.addWorkSession(episode, completion);
  storage.saveState({ selectedId: completedEpisode.id, episodes: [completedEpisode] }, options);
  storage.saveActiveSession(null, options);

  const reloadedState = storage.loadState(options);
  const reloadedActive = storage.loadActiveSession(options);
  const reloadedEpisode = reloadedState.episodes[0];

  assert.equal(reloadedActive, null);
  assert.equal(reloadedEpisode.workSessions.length, 1);
  assert.equal(reloadedEpisode.workSessions[0].taskTitle, task.taskTitle);
  assert.equal(reloadedEpisode.workSessions[0].taskType, task.type);
  assert.equal(reloadedEpisode.workSessions[0].result, "Completed persisted active work.");
  assert.equal(reloadedEpisode.nextAction, "Review persisted session history.");
});

test("active session progress percentage is capped against estimated minutes", () => {
  const task = {
    id: "task-progress",
    episodeId: "episode-progress",
    episodeTitle: "Progress",
    taskTitle: "Timed task",
    type: "manual",
    estimatedMinutes: 30,
  };
  const active = model.startActiveSession(task, 0);

  assert.equal(model.getActiveSessionProgressPercent(active, 15 * 60 * 1000), 50);
  assert.equal(model.getActiveSessionProgressPercent(active, 45 * 60 * 1000), 100);
});

test("backup status normalization accepts missing or invalid input", () => {
  assert.deepEqual(model.normalizeBackupStatus(null), {
    lastExportAt: "",
    lastImportAt: "",
  });
  assert.deepEqual(
    model.normalizeBackupStatus({
      lastExportAt: "2026-04-30T10:00:00.000Z",
      lastImportAt: "not a timestamp",
    }),
    {
      lastExportAt: "2026-04-30T10:00:00.000Z",
      lastImportAt: "",
    }
  );
});

test("backup health recommends export when no export exists", () => {
  const health = model.getBackupHealth({}, new Date("2026-05-01T12:00:00.000Z").getTime());

  assert.equal(health.label, "Never exported");
  assert.equal(health.recommendation, "Export recommended");
  assert.equal(health.hasRecentExport, false);
  assert.equal(health.needsExport, true);
});

test("backup health reports today and day age for recent exports", () => {
  const now = new Date("2026-05-01T12:00:00.000Z").getTime();

  const today = model.getBackupHealth({ lastExportAt: "2026-05-01T08:00:00.000Z" }, now);
  const yesterday = model.getBackupHealth({ lastExportAt: "2026-04-30T08:00:00.000Z" }, now);

  assert.equal(today.label, "Exported today");
  assert.equal(today.hasRecentExport, true);
  assert.equal(today.needsExport, false);
  assert.equal(yesterday.label, "Export is 1 day old");
  assert.equal(yesterday.hasRecentExport, true);
});

test("backup health recommends export when export is stale", () => {
  const now = new Date("2026-05-10T12:00:00.000Z").getTime();
  const health = model.getBackupHealth({ lastExportAt: "2026-05-01T08:00:00.000Z" }, now);

  assert.equal(health.label, "Export is 9 days old");
  assert.equal(health.recommendation, "Export recommended");
  assert.equal(health.hasRecentExport, false);
  assert.equal(health.needsExport, true);
});

test("last export and import timestamp helpers persist to localStorage", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };

  storage.recordBackupTimestamp("export", "2026-04-30T10:00:00.000Z", options);
  storage.recordBackupTimestamp("import", "2026-04-30T11:00:00.000Z", options);
  const status = storage.loadBackupStatus(options);

  assert.equal(status.lastExportAt, "2026-04-30T10:00:00.000Z");
  assert.equal(status.lastImportAt, "2026-04-30T11:00:00.000Z");
});

test("app status counts episodes sessions backup timestamps and active session", () => {
  const now = new Date("2026-05-01T10:01:00.000Z").getTime();
  const episode = model.addWorkSession(model.normalizeEpisode({ workingTitle: "Status Count" }), {
    taskTitle: "Count this",
    result: "Done",
  });
  const task = model.generateNextActionTask(episode);
  const active = model.startActiveSession(task, now - 60000);
  const status = model.getAppStatus(
    { selectedId: episode.id, episodes: [episode] },
    active,
    { lastExportAt: "2026-04-30T10:00:00.000Z" },
    now
  );

  assert.equal(status.totalEpisodes, 1);
  assert.equal(status.totalWorkSessions, 1);
  assert.equal(status.lastExportAt, "2026-04-30T10:00:00.000Z");
  assert.equal(status.backupHealth.label, "Export is 1 day old");
  assert.equal(status.backupHealth.needsExport, false);
  assert.equal(status.activeSession.isActive, true);
  assert.equal(status.activeSession.elapsedSeconds, 60);
});

test("demo episode creation adds realistic sample data without overwriting existing data", () => {
  const existing = model.normalizeEpisode({
    id: "existing-demo",
    workingTitle: "Existing Episode",
  });
  const demo = model.createDemoEpisode([existing]);
  const state = model.normalizeState({
    selectedId: demo.id,
    episodes: [demo, existing],
  });

  assert.equal(state.episodes.length, 2);
  assert.equal(state.episodes[1].id, "existing-demo");
  assert.notEqual(demo.id, existing.id);
  assert.match(demo.workingTitle, /DaVinci Resolve/);
  assert.match(demo.notes, /Demo episode/);
  assert.equal(model.getChecklistSummary(demo, "packagingGate").isComplete, true);
});

test("pipeline counts include every production status", () => {
  const counts = model.getPipelineCounts([
    model.normalizeEpisode({ status: "Idea" }),
    model.normalizeEpisode({ status: "Editing" }),
    model.normalizeEpisode({ status: "Editing" }),
    model.normalizeEpisode({ status: "Published" }),
  ]);

  assert.equal(counts.Idea, 1);
  assert.equal(counts.Editing, 2);
  assert.equal(counts.Published, 1);
  assert.equal(counts.Archived, 0);
  assert.deepEqual(Object.keys(counts), model.STATUSES);
});

test("weekly summary filters sessions from the last 7 days", () => {
  const now = Date.parse("2026-04-30T12:00:00.000Z");
  const episode = model.normalizeEpisode({
    id: "weekly-one",
    workingTitle: "Weekly One",
    workSessions: [
      {
        taskTitle: "Recent ended",
        actualMinutes: 20,
        createdAt: "2026-04-29T09:00:00.000Z",
        endedAt: "2026-04-29T09:20:00.000Z",
      },
      {
        taskTitle: "Old ended",
        actualMinutes: 50,
        createdAt: "2026-04-20T09:00:00.000Z",
        endedAt: "2026-04-20T09:50:00.000Z",
      },
    ],
  });
  const summary = model.getWeeklyWorkSummary([episode], now);

  assert.equal(summary.completedSessions, 1);
  assert.equal(summary.totalFocusedMinutes, 20);
  assert.equal(summary.episodesTouched, 1);
  assert.equal(summary.mostRecentSession.taskTitle, "Recent ended");
});

test("weekly summary counts old sessions by createdAt when endedAt is missing", () => {
  const now = Date.parse("2026-04-30T12:00:00.000Z");
  const episode = model.normalizeEpisode({
    id: "weekly-old-session",
    workingTitle: "Weekly Old Session",
    workSessions: [
      {
        taskTitle: "Legacy session",
        actualMinutes: 15,
        createdAt: "2026-04-29T09:00:00.000Z",
      },
    ],
  });
  const summary = model.getWeeklyWorkSummary([episode], now);

  assert.equal(summary.completedSessions, 1);
  assert.equal(summary.totalFocusedMinutes, 15);
  assert.equal(summary.mostRecentSession.completedAt, "2026-04-29T09:00:00.000Z");
});

test("weekly review generation combines pipeline work blockers publish ranking and next focus", () => {
  const now = Date.parse("2026-04-30T12:00:00.000Z");
  const blocked = model.normalizeEpisode({
    id: "blocked-weekly",
    workingTitle: "Blocked Weekly",
    checklists: { packagingGate: {} },
  });
  const active = model.normalizeEpisode({
    id: "active-weekly",
    workingTitle: "Active Weekly",
    status: "Ready to Publish",
    checklists: completeChecklistExcept({ publishChecklist: ["Final title selected"] }),
    workSessions: [{ taskTitle: "Publish prep", actualMinutes: 30, createdAt: "2026-04-29T10:00:00.000Z" }],
  });
  const review = model.buildWeeklyReview({ selectedId: active.id, episodes: [blocked, active] }, now);

  assert.equal(review.pipelineCounts.Idea, 1);
  assert.equal(review.pipelineCounts["Ready to Publish"], 1);
  assert.equal(review.weeklySummary.completedSessions, 1);
  assert.equal(review.blockedEpisodes[0].id, "blocked-weekly");
  assert.equal(review.closestToPublish[0].id, "active-weekly");
  assert.equal(review.recommendedNextFocusSession.type, "packagingBlocked");
});

test("blocked episode detection names readiness blockers", () => {
  const episode = model.normalizeEpisode({
    id: "blocked-detect",
    workingTitle: "Blocked Detect",
    checklists: { packagingGate: {} },
  });
  const blocked = model.getBlockedEpisodes([episode]);

  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].id, "blocked-detect");
  assert.ok(blocked[0].blockers.some((blocker) => blocker.type === "packaging"));
  assert.ok(blocked[0].blockers.some((blocker) => blocker.type === "script"));
  assert.ok(blocked[0].blockers.some((blocker) => blocker.type === "publish"));
});

test("closest-to-publish ranking favors later pipeline stages", () => {
  const idea = readyScriptEpisode({ id: "idea-rank", workingTitle: "Idea Rank", status: "Idea" });
  const editing = readyScriptEpisode({ id: "editing-rank", workingTitle: "Editing Rank", status: "Editing" });
  const ready = readyScriptEpisode({
    id: "ready-rank",
    workingTitle: "Ready Rank",
    status: "Ready to Publish",
  });
  const ranked = model.getClosestToPublish([idea, editing, ready]);

  assert.deepEqual(ranked.map((episode) => episode.id), ["ready-rank", "editing-rank", "idea-rank"]);
});

test("weekly export builders produce review outputs", () => {
  const now = Date.parse("2026-04-30T12:00:00.000Z");
  const episode = model.normalizeEpisode({
    id: "weekly-export",
    workingTitle: "Weekly Export",
    workSessions: [{ taskTitle: "Review work", actualMinutes: 12, createdAt: "2026-04-29T10:00:00.000Z" }],
  });
  const state = { selectedId: episode.id, episodes: [episode] };

  assert.match(model.buildWeeklyExportPayload("hermes", state, now), /weekly memory update/i);
  assert.match(model.buildWeeklyExportPayload("linear", state, now), /Weekly VIDTOOLZ Progress Summary/);
  assert.match(model.buildWeeklyExportPayload("markdown", state, now), /# Weekly Creator Review/);
  assert.match(model.buildWeeklyCreatorReviewMarkdown(state, now), /Completed sessions: 1/);
});

test("abandoning an active session clears the draft", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Abandon Active" }));
  const active = model.startActiveSession(task, 0);

  assert.ok(active);
  assert.equal(model.abandonActiveSession(active), null);
});

test("state normalization accepts raw episode arrays", () => {
  const state = model.normalizeState({
    episodes: [{ id: "one", workingTitle: "One" }],
    selectedId: "one",
  });

  assert.equal(state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(state.episodes.length, 1);
  assert.equal(state.selectedId, "one");
});

test("export payload includes all stored episode data and metadata", () => {
  const episode = model.normalizeEpisode({
    id: "export-one",
    workingTitle: "Export One",
    status: "Packaging",
  });
  const payload = model.buildExportPayload({
    version: 1,
    selectedId: episode.id,
    episodes: [episode],
  });

  assert.equal(payload.app, "VIDTOOLZ Episode Factory");
  assert.equal(payload.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(payload.storageKey, model.STORAGE_KEY);
  assert.equal(payload.selectedId, episode.id);
  assert.equal(payload.counts.episodes, 1);
  assert.equal(payload.episodes[0].workingTitle, "Export One");
});

test("shared collection JSON helpers round trip new fields and unknown fields", () => {
  const episode = model.normalizeEpisode({
    id: "shared-one",
    workingTitle: "Shared One",
    format: "mixed",
    sourceNotes: "- Verify Resolve version",
    scriptPath: "episodes/shared-one/outline.md",
    description: "A shared storage test.",
    tags: "vidtoolz, resolve",
    externalToolId: "keep-me",
  });
  const json = model.exportEpisodeCollectionJson({ selectedId: episode.id, episodes: [episode] });
  const result = model.importEpisodeCollectionJson(json);

  assert.equal(result.ok, true);
  assert.equal(JSON.parse(json).schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(result.state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(result.state.episodes[0].format, "mixed");
  assert.equal(result.state.episodes[0].sourceNotes, "- Verify Resolve version");
  assert.equal(result.state.episodes[0].scriptPath, "episodes/shared-one/outline.md");
  assert.equal(result.state.episodes[0].description, "A shared storage test.");
  assert.equal(result.state.episodes[0].tags, "vidtoolz, resolve");
  assert.equal(result.state.episodes[0].externalToolId, "keep-me");
});

test("import accepts exported payload and returns replacement state", () => {
  const episode = model.normalizeEpisode({
    id: "import-one",
    workingTitle: "Import One",
    status: "Ready to Shoot",
  });
  const payload = model.buildExportPayload({
    selectedId: episode.id,
    episodes: [episode],
  });
  const result = model.validateImportPayload(payload);

  assert.equal(result.ok, true);
  assert.equal(result.state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(result.state.episodes.length, 1);
  assert.equal(result.state.episodes[0].status, "Ready to Shoot");
  assert.equal(result.state.selectedId, "import-one");
});

test("import accepts legacy raw episode arrays", () => {
  const result = model.validateImportPayload([
    {
      id: "legacy-one",
      workingTitle: "Legacy One",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.state.episodes.length, 1);
  assert.equal(result.state.episodes[0].createdAt, "2026-01-01T00:00:00.000Z");
});

test("import accepts unversioned browser localStorage shaped data", () => {
  const result = model.validateImportPayload({
    version: 1,
    selectedId: "browser-one",
    episodes: [
      {
        id: "browser-one",
        workingTitle: "Browser One",
        format: "newsletter",
        sourceNotes: "- Browser source",
        scriptPath: "episodes/browser-one/outline.md",
        description: "Browser export compatible.",
        tags: "newsletter, vidtoolz",
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(result.state.selectedId, "browser-one");
  assert.equal(result.state.episodes[0].format, "newsletter");
  assert.equal(result.state.episodes[0].sourceNotes, "- Browser source");
  assert.equal(result.state.episodes[0].scriptPath, "episodes/browser-one/outline.md");
  assert.equal(result.state.episodes[0].description, "Browser export compatible.");
  assert.equal(result.state.episodes[0].tags, "newsletter, vidtoolz");
});

test("import rejects invalid JSON and missing episodes", () => {
  const invalidJson = model.parseImportJson("{nope");
  const missingEpisodes = model.validateImportPayload({ prompts: [] });

  assert.equal(invalidJson.ok, false);
  assert.match(invalidJson.error, /valid JSON/);
  assert.equal(missingEpisodes.ok, false);
  assert.match(missingEpisodes.error, /episodes array/);
});

test("import rejects unsupported schema versions with actionable errors", () => {
  const result = model.validateImportPayload({
    schemaVersion: model.EXPORT_SCHEMA_VERSION + 1,
    episodes: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported schemaVersion/);
  assert.match(result.error, new RegExp(String(model.EXPORT_SCHEMA_VERSION)));
});

test("import rejects non-object episode entries", () => {
  const result = model.validateImportPayload({ episodes: ["not an episode"] });

  assert.equal(result.ok, false);
  assert.match(result.error, /every episode/);
});

test("import repairs duplicate episode ids", () => {
  const result = model.validateImportPayload({
    selectedId: "same-id",
    episodes: [
      { id: "same-id", workingTitle: "One" },
      { id: "same-id", workingTitle: "Two" },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.episodes.length, 2);
  assert.notEqual(result.state.episodes[0].id, result.state.episodes[1].id);
  assert.equal(result.state.selectedId, "same-id");
});

test("import preview generation summarizes new matching changed duplicate conflict and sessions", () => {
  const current = {
    selectedId: "same",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same Title", notes: "old" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Current Title" }),
      model.normalizeEpisode({ id: "dupe-current", workingTitle: "Duplicate Title" }),
    ],
  };
  const importedEpisode = model.normalizeEpisode({
    id: "new-one",
    workingTitle: "New One",
    workSessions: [{ id: "session-one", taskTitle: "Imported session" }],
  });
  const imported = {
    selectedId: "new-one",
    episodes: [
      importedEpisode,
      model.normalizeEpisode({ ...current.episodes[0], notes: "new" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Imported Title" }),
      model.normalizeEpisode({ id: "dupe-import", workingTitle: "Duplicate Title" }),
    ],
  };

  const preview = model.buildImportPreview(current, imported);

  assert.equal(preview.counts.currentEpisodes, 3);
  assert.equal(preview.counts.importedEpisodes, 4);
  assert.equal(preview.counts.newEpisodes, 1);
  assert.equal(preview.counts.matchingEpisodes, 1);
  assert.equal(preview.counts.changedMatchingEpisodes, 1);
  assert.equal(preview.counts.conflictingEpisodes, 1);
  assert.equal(preview.counts.possibleDuplicateEpisodes, 1);
  assert.equal(preview.counts.skippedEpisodes, 2);
  assert.equal(preview.counts.importedWorkSessions, 1);
});

test("replace import applies the imported state after preview", () => {
  const current = { selectedId: "old", episodes: [model.normalizeEpisode({ id: "old", workingTitle: "Old" })] };
  const imported = { selectedId: "new", episodes: [model.normalizeEpisode({ id: "new", workingTitle: "New" })] };

  const result = model.applyReplaceImport(current, imported);

  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].id, "new");
  assert.equal(result.selectedId, "new");
});

test("merge new episodes only adds safe new episodes and skips matches conflicts and duplicates", () => {
  const current = {
    selectedId: "same",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Current" }),
      model.normalizeEpisode({ id: "dupe-current", workingTitle: "Duplicate" }),
    ],
  };
  const imported = {
    selectedId: "new",
    episodes: [
      model.normalizeEpisode({ id: "new", workingTitle: "New" }),
      model.normalizeEpisode({ ...current.episodes[0], notes: "changed" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Different" }),
      model.normalizeEpisode({ id: "dupe-import", workingTitle: "Duplicate" }),
    ],
  };

  const result = model.applyMergeNewOnlyImport(current, imported);

  assert.deepEqual(
    result.episodes.map((episode) => episode.id),
    ["same", "conflict", "dupe-current", "new"],
  );
  assert.equal(result.episodes.find((episode) => episode.id === "same").notes, "");
});

test("merge and update matching episodes adds new episodes and updates same-id same-title matches", () => {
  const current = {
    selectedId: "same",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same", notes: "old" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Current", notes: "keep" }),
    ],
  };
  const imported = {
    selectedId: "new",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same", notes: "updated" }),
      model.normalizeEpisode({ id: "new", workingTitle: "New" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Different", notes: "skip" }),
    ],
  };

  const result = model.applyMergeAndUpdateImport(current, imported);

  assert.equal(result.episodes.length, 3);
  assert.equal(result.episodes.find((episode) => episode.id === "same").notes, "updated");
  assert.equal(result.episodes.find((episode) => episode.id === "conflict").notes, "keep");
  assert.equal(result.episodes.find((episode) => episode.id === "new").workingTitle, "New");
});

test("merge and update import commit persists updates additions and unrelated episodes after reload", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };
  const current = model.normalizeState({
    selectedId: "same",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same", notes: "old" }),
      model.normalizeEpisode({ id: "unrelated", workingTitle: "Unrelated", notes: "preserve" }),
    ],
  });
  const importedEpisode = model.normalizeEpisode({
    id: "same",
    workingTitle: "Same",
    notes: "updated",
    workSessions: [{ id: "imported-session", taskTitle: "Imported task", result: "Done" }],
  });
  const importedJson = model.exportEpisodeCollectionJson({
    selectedId: "new",
    episodes: [
      importedEpisode,
      model.normalizeEpisode({ id: "new", workingTitle: "New", notes: "added" }),
    ],
  });

  storage.saveState(current, options);
  const parsedImport = model.importEpisodeCollectionJson(importedJson);
  assert.equal(parsedImport.ok, true);
  const preview = model.buildImportPreview(storage.loadState(options), parsedImport.state);
  const committed = model.applyMergeAndUpdateImport(storage.loadState(options), parsedImport.state);
  storage.saveState(committed, options);
  const reloaded = storage.loadState(options);

  assert.equal(preview.counts.changedMatchingEpisodes, 1);
  assert.equal(preview.counts.newEpisodes, 1);
  assert.equal(reloaded.episodes.length, 3);
  assert.equal(reloaded.episodes.filter((episode) => episode.id === "same").length, 1);
  assert.equal(reloaded.episodes.find((episode) => episode.id === "same").notes, "updated");
  assert.equal(reloaded.episodes.find((episode) => episode.id === "same").workSessions[0].taskTitle, "Imported task");
  assert.equal(reloaded.episodes.find((episode) => episode.id === "unrelated").notes, "preserve");
  assert.equal(reloaded.episodes.find((episode) => episode.id === "new").notes, "added");
});

test("same-id same-title imports are matching episodes", () => {
  const episode = model.normalizeEpisode({ id: "same-id", workingTitle: "Same Title" });
  const preview = model.buildImportPreview({ episodes: [episode] }, { episodes: [episode] });

  assert.equal(preview.counts.matchingEpisodes, 1);
  assert.equal(preview.items[0].type, "match");
});

test("same-id different-title imports are conflicts", () => {
  const preview = model.buildImportPreview(
    { episodes: [model.normalizeEpisode({ id: "same-id", workingTitle: "Current" })] },
    { episodes: [model.normalizeEpisode({ id: "same-id", workingTitle: "Imported" })] },
  );
  const conflicts = model.detectImportConflicts(
    { episodes: [model.normalizeEpisode({ id: "same-id", workingTitle: "Current" })] },
    { episodes: [model.normalizeEpisode({ id: "same-id", workingTitle: "Imported" })] },
  );

  assert.equal(preview.counts.conflictingEpisodes, 1);
  assert.equal(preview.items[0].type, "conflict");
  assert.equal(conflicts.length, 1);
});

test("different-id same-title imports are possible duplicates and skipped by merge modes", () => {
  const current = { episodes: [model.normalizeEpisode({ id: "current", workingTitle: "Same Title" })] };
  const imported = { episodes: [model.normalizeEpisode({ id: "imported", workingTitle: "Same Title" })] };

  const preview = model.buildImportPreview(current, imported);
  const merged = model.applyMergeNewOnlyImport(current, imported);

  assert.equal(preview.counts.possibleDuplicateEpisodes, 1);
  assert.equal(preview.items[0].type, "possible-duplicate");
  assert.equal(merged.episodes.length, 1);
  assert.equal(merged.episodes[0].id, "current");
});

test("merge and update preserves imported work sessions and export fields", () => {
  const current = {
    episodes: [
      model.normalizeEpisode({
        id: "session-episode",
        workingTitle: "Session Episode",
        notes: "old",
        workSessions: [{ id: "old-session", taskTitle: "Old task" }],
      }),
    ],
  };
  const imported = {
    episodes: [
      model.normalizeEpisode({
        id: "session-episode",
        workingTitle: "Session Episode",
        notes: "imported notes",
        readiness: { packaging: 100 },
        checklists: { packagingGate: { "Viewer problem is clear": true } },
        workSessions: [{ id: "new-session", taskTitle: "New task", result: "Done" }],
      }),
    ],
  };

  const result = model.applyMergeAndUpdateImport(current, imported);
  const episode = result.episodes[0];

  assert.equal(episode.notes, "imported notes");
  assert.equal(episode.workSessions.length, 1);
  assert.equal(episode.workSessions[0].taskTitle, "New task");
  assert.equal(model.getGateSummary(episode).passed, 1);
});

test("malformed import rejection still prevents preview planning", () => {
  const result = model.validateImportPayload({ episodes: ["bad"] });

  assert.equal(result.ok, false);
  assert.match(result.error, /every episode/);
});

test("old v1.0 import compatibility keeps exported object and raw array imports working", () => {
  const exported = {
    app: "VIDTOOLZ Episode Factory",
    appVersion: "1.0.0",
    schemaVersion: 1,
    selectedId: "old-export",
    episodes: [{ id: "old-export", workingTitle: "Old Export" }],
  };
  const rawArray = [{ id: "raw-old", workingTitle: "Raw Old" }];

  const exportedResult = model.validateImportPayload(exported);
  const rawResult = model.validateImportPayload(rawArray);

  assert.equal(exportedResult.ok, true);
  assert.equal(exportedResult.state.selectedId, "old-export");
  assert.equal(rawResult.ok, true);
  assert.equal(rawResult.state.episodes[0].workingTitle, "Raw Old");
});

test("package engine normalizes candidate fields and strategic fields", () => {
  const candidate = packageEngine.normalizePackageCandidate(
    {
      package_number: 3,
      score: 101,
      recommendation: "make",
      title: "Package Title",
      thumbnail_concept: "Thumbnail",
      on_thumbnail_text: "TEXT",
      viewer_promise: "Promise",
      target_viewer: "Creator",
      production_difficulty: "high",
      main_risk: "Risk",
      shorts_ideas: ["One", "Two"],
      why_this_matters_now: "Timely",
    },
    2
  );

  assert.equal(candidate.packageNumber, 3);
  assert.equal(candidate.score, 100);
  assert.equal(candidate.recommendation, "Make");
  assert.equal(candidate.proposedTitle, "Package Title");
  assert.equal(candidate.productionDifficulty, "High");
  assert.equal(candidate.shortsIdeas.length, 5);
  assert.equal(candidate.why_this_matters_now, "Timely");
});

test("package engine validates candidate sets", () => {
  const result = packageEngine.validatePackageCandidateSet({
    project: "VIDTOOLZ Package Engine",
    candidates: [{ packageNumber: 1, proposedTitle: "One" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.candidates.length, 1);
  assert.equal(packageEngine.validatePackageCandidateSet({ candidates: [] }).ok, false);
});

test("package engine sorts by score and filters by recommendation", () => {
  const candidates = [
    { packageNumber: 1, score: 50, recommendation: "Reject", proposedTitle: "Low" },
    { packageNumber: 2, score: 95, recommendation: "Make", proposedTitle: "High" },
    { packageNumber: 3, score: 70, recommendation: "Maybe", proposedTitle: "Mid" },
  ];

  assert.deepEqual(
    packageEngine.sortPackageCandidates(candidates).map((candidate) => candidate.packageNumber),
    [2, 3, 1]
  );
  assert.deepEqual(
    packageEngine.filterPackageCandidates(candidates, "Make").map((candidate) => candidate.proposedTitle),
    ["High"]
  );
});

test("package engine exports selected package json and markdown", () => {
  const candidate = packageEngine.normalizePackageCandidate({
    packageNumber: 7,
    score: 88,
    recommendation: "Make",
    proposedTitle: "Selected Package",
    idea: "Review a package.",
    thumbnailImage: "/tmp/selected-package-thumb.png",
    shortsIdeas: ["Short one", "Short two", "Short three", "Short four", "Short five"],
    why_this_fits_vidtoolz: "It fits.",
    suggested_production_approach: "Screen recording.",
  });

  assert.equal(candidate.thumbnailImage, "/tmp/selected-package-thumb.png");
  const json = packageEngine.buildSelectedPackageJson(candidate);
  const markdown = packageEngine.buildSelectedPackageMarkdown(candidate);

  assert.equal(json.package.proposedTitle, "Selected Package");
  assert.match(markdown, /# Selected Package 7: Selected Package/);
  assert.match(markdown, /## Why This Fits Vidtoolz/);
  assert.match(markdown, /## Suggested Production Approach/);
  assert.match(markdown, /Short one/);
});

test("package run helpers build stable folder names and candidate source paths", () => {
  assert.equal(packageRun.slugifyTopic("AI Video Idea Filter"), "ai-video-idea-filter");
  assert.equal(packageRun.buildRunFolderName("AI Video Idea Filter", "2026-05-02"), "2026-05-02-ai-video-idea-filter");
  assert.equal(
    packageRun.candidateSourceFromLocation("?run=2026-05-02-ai-video-idea-filter"),
    "package-runs/2026-05-02-ai-video-idea-filter/package-candidates.json"
  );
  assert.equal(packageRun.candidateSourceFromLocation(""), "package-candidates.json");
});

test("package run generation prompt includes workflow topic schema and guardrails", () => {
  const prompt = packageRun.buildGenerationPrompt({
    topic: "AI video idea filter",
    workflowPath: "/workflow.md",
    workflowText: "# VIDTOOLZ Package Engine\n\nWorkflow body",
  });

  assert.match(prompt, /AI video idea filter/);
  assert.match(prompt, /# VIDTOOLZ Package Engine/);
  assert.match(prompt, /valid JSON only/);
  assert.match(prompt, /exactly 10 ranked YouTube package candidates/);
  assert.match(prompt, /Do not create outlines, scripts, descriptions, chapters, pinned comments, publishing assets/);
  assert.match(prompt, /why_this_matters_now/);
  assert.match(prompt, /package-candidates\.json shape/);
});

test("package run placeholder candidates create 10 inspectable candidates", () => {
  const payload = packageRun.buildPlaceholderCandidates("AI video idea filter");

  assert.equal(payload.topic, "AI video idea filter");
  assert.equal(payload.candidates.length, 10);
  assert.equal(payload.candidates[0].id, "pkg-001");
  assert.equal(payload.candidates[9].packageNumber, 10);
  assert.equal(payload.candidates[0].shortsIdeas.length, 5);
});

test("package run cli argument parsing accepts topic workflow and date", () => {
  const parsed = packageRunScript.parseArgs(["AI", "video", "ideas", "--workflow", "/tmp/workflow.md", "--date", "2026-05-02"]);

  assert.equal(parsed.topic, "AI video ideas");
  assert.equal(parsed.workflowPath, "/tmp/workflow.md");
  assert.equal(parsed.date, "2026-05-02");
});

test("outline prep extracts selected package from exported json shape", () => {
  const selected = packageRun.selectedPackageFromJsonPayload({
    selectedAt: "2026-05-02T00:00:00.000Z",
    package: {
      proposedTitle: "Selected Package",
      idea: "A clear package.",
    },
  });

  assert.equal(selected.proposedTitle, "Selected Package");
  assert.equal(packageRun.selectedPackageFromJsonPayload({ package: {} }), null);
});

test("outline prompt includes selected package workflow structures and guardrails", () => {
  const selectedPackageText = packageRun.selectedPackageToMarkdown({
    packageNumber: 1,
    score: 90,
    recommendation: "Make",
    proposedTitle: "Selected Package",
    idea: "A clear package.",
    viewerPromise: "A practical payoff.",
  });
  const prompt = packageRun.buildOutlinePrompt({
    selectedPackageText,
    workflowText: "# VIDTOOLZ Package Engine\n\nWorkflow body",
    workflowPath: "/workflow.md",
    runId: "2026-05-02-selected-package",
  });

  assert.match(prompt, /Selected Package/);
  assert.match(prompt, /# VIDTOOLZ Package Engine/);
  assert.match(prompt, /exactly three structurally different YouTube script outlines/);
  assert.match(prompt, /Practical tutorial \/ workflow version/);
  assert.match(prompt, /Critical test \/ myth-busting version/);
  assert.match(prompt, /Strategic framework \/ workflow architect version/);
  assert.match(prompt, /Do not write the full script yet/);
  assert.match(prompt, /Do not create descriptions, chapters, pinned comments, Shorts scripts, or publishing assets yet/);
  assert.match(prompt, /Do not change the selected package unless you find a contradiction/);
  assert.match(prompt, /Package Verification Reminder/);
});

test("outline placeholders include the three required outline sections", () => {
  const outlines = packageRun.buildOutlinesPlaceholderMarkdown("run-id");
  const final = packageRun.buildFinalOutlinePlaceholderMarkdown("run-id");

  assert.match(outlines, /Practical tutorial \/ workflow version/);
  assert.match(outlines, /Critical test \/ myth-busting version/);
  assert.match(outlines, /Strategic framework \/ workflow architect version/);
  assert.match(final, /Final Edited Outline/);
});

test("outline cli argument parsing accepts run folder selected and workflow", () => {
  const parsed = packageOutlineScript.parseArgs([
    "package-runs/run-id",
    "--selected",
    "selected-package.json",
    "--workflow",
    "/workflow.md",
  ]);

  assert.equal(parsed.runFolder, "package-runs/run-id");
  assert.equal(parsed.selectedPath, "selected-package.json");
  assert.equal(parsed.workflowPath, "/workflow.md");
});

test("script prep prompt includes package outline and required review sections", () => {
  const selectedPackageText = packageRun.selectedPackageToMarkdown({
    packageNumber: 1,
    score: 90,
    recommendation: "Make",
    proposedTitle: "Selected Package",
    thumbnailConcept: "Before after workflow",
    onThumbnailText: "Stop Guessing",
    viewerPromise: "A practical payoff.",
    shortsIdeas: ["Hook short", "Demo short"],
  });
  const prompt = packageRun.buildScriptPrompt({
    selectedPackageText,
    finalOutlineText: "# Final Outline\n\n- Hook\n- Demo\n- Payoff",
    runId: "2026-05-02-selected-package",
  });

  assert.match(prompt, /Selected Package Summary/);
  assert.match(prompt, /Selected Package/);
  assert.match(prompt, /Final Outline/);
  assert.match(prompt, /Viewer Promise/);
  assert.match(prompt, /Title \/ Thumbnail Assumptions/);
  assert.match(prompt, /Hook Requirements/);
  assert.match(prompt, /Demo Moments/);
  assert.match(prompt, /Visual \/ B-roll Notes/);
  assert.match(prompt, /Retention Beats/);
  assert.match(prompt, /CTA/);
  assert.match(prompt, /Shorts Extraction Ideas/);
  assert.match(prompt, /Packaging still needs verification before finalization/);
  assert.match(prompt, /Do not create episode folders/);
});

test("script prep placeholders create reviewable draft final and production files", () => {
  const structure = packageRun.buildScriptStructureMarkdown({
    runId: "run-id",
    researchGate: {
      sourceFile: "research-pack.md",
      status: "PARTIAL",
      structureStatus: "PARTIAL",
      readyToDraft: false,
      reason: "Research is still partial.",
    },
  });
  const draft = packageRun.buildScriptDraftPlaceholderMarkdown("run-id");
  const final = packageRun.buildFinalScriptPlaceholderMarkdown("run-id");
  const production = packageRun.buildProductionNotesPlaceholderMarkdown("run-id");

  assert.match(structure, /# Script Structure/);
  assert.match(structure, /Script structure status: PARTIAL/);
  assert.match(structure, /Ready to draft: no/);
  assert.match(structure, /## Proof Ladder/);
  assert.match(structure, /## Act Structure/);
  assert.match(structure, /## Beat-by-Beat Outline/);
  assert.match(structure, /## Required Examples \/ Demos \/ Screenshots/);
  assert.match(structure, /## Local Context Inputs/);
  assert.match(structure, /## Viewer Objections to Answer/);
  assert.match(structure, /## Retention Risks/);
  assert.match(structure, /## Unsupported or Risky Claims/);
  assert.match(structure, /## Script-Readiness Gate/);
  assert.match(draft, /# Script Draft/);
  assert.match(draft, /Open Verification Questions/);
  assert.match(final, /# Final Script/);
  assert.match(final, /Final Packaging Check/);
  assert.match(production, /# Production Notes/);
  assert.match(production, /Visual \/ B-roll Notes/);
  assert.match(production, /Shorts Extraction Ideas/);
});

test("script prep cli argument parsing accepts run folder selected and outline", () => {
  const parsed = packageScriptPrepScript.parseArgs([
    "package-runs/run-id",
    "--selected",
    "selected-package.json",
    "--outline",
    "final-outline.md",
  ]);

  assert.equal(parsed.runFolder, "package-runs/run-id");
  assert.equal(parsed.selectedPath, "selected-package.json");
  assert.equal(parsed.outlinePath, "final-outline.md");
});

test("script structure help and script prep help work", () => {
  const structureHelp = captureConsole(() => packageScriptStructureScript.main(["--help"]));
  const scriptPrepHelp = captureConsole(() => packageScriptPrepScript.main(["--help"]));

  assert.equal(structureHelp.result, 0);
  assert.match(structureHelp.stdout.join("\n"), /package-run-script-structure\.js/);
  assert.equal(scriptPrepHelp.result, 0);
  assert.match(scriptPrepHelp.stdout.join("\n"), /package-engine-new-script\.js/);
});

test("script structure research gate parser does not treat partial research as ready", () => {
  const gate = packageScriptStructureScript.parseResearchGateStatus([
    "# Research Pack",
    "",
    "## Research Sufficiency Gate",
    "",
    "- Status: PARTIAL",
    "- Reason: Sources still need review.",
  ].join("\n"));

  assert.equal(gate.status, "PARTIAL");
  assert.equal(gate.structureStatus, "PARTIAL");
  assert.equal(gate.readyToDraft, false);
});

test("script structure research gate parser requires explicit pass for ready to draft", () => {
  const passGate = packageScriptStructureScript.parseResearchGateStatus([
    "# Research Pack",
    "",
    "## Research Sufficiency Gate",
    "",
    "- Status: PASS",
    "- Reason: Mikko approved the research pack.",
  ].join("\n"));
  const manualGate = packageScriptStructureScript.parseResearchGateStatus([
    "# Research Pack",
    "",
    "## Research Sufficiency Gate",
    "",
    "- Status: PARTIAL",
    "- Manual approval: PASS",
  ].join("\n"));

  assert.equal(passGate.structureStatus, "READY TO DRAFT");
  assert.equal(passGate.readyToDraft, true);
  assert.equal(manualGate.structureStatus, "READY TO DRAFT");
  assert.equal(manualGate.readyToDraft, true);
});

test("script structure cli generates only script structure from partial research", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-partial-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-partial");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Partial Research Package",
        viewerPromise: "Needs source review.",
        targetViewer: "Serious solo creator.",
        mainRisk: "Could become generic.",
      },
    })
  );
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    [
      "# Research Pack",
      "",
      "## Core Claim",
      "",
      "A stronger script starts with traceable proof.",
      "",
      "## Viewer Problem",
      "",
      "The creator has a package but no verified proof path.",
      "",
      "## What Must Be Proven",
      "",
      "- The package has enough source support.",
      "- The production proof can be captured honestly.",
      "",
      "## Examples Needed",
      "",
      "- One visible proof example.",
      "",
      "## Objections / Counterarguments",
      "",
      "- The episode may be premature.",
      "",
      "## Production-Relevant Evidence Needed",
      "",
      "- Screen recording of the proof workflow.",
      "",
      "## Research Sufficiency Gate",
      "",
      "- Status: PARTIAL",
      "- Reason: More research needed.",
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Notes\n\nManual package note.\n");
  fs.writeFileSync(path.join(runDir, "script-prompt.md"), "# Script Prompt\n\nDrafting prompt context.\n");
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n1. Hook\n2. Proof\n");

  const output = captureConsole(() => packageScriptStructureScript.main([runDir]));
  const structure = fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8");

  assert.equal(output.result, 0);
  assert.match(structure, /Script structure status: PARTIAL/);
  assert.match(structure, /Ready to draft: no/);
  assert.match(structure, /Selected package: Partial Research Package/);
  [
    /## Proof Ladder/,
    /## Act Structure/,
    /## Beat-by-Beat Outline/,
    /## Required Examples \/ Demos \/ Screenshots/,
    /## Local Context Inputs/,
    /## Viewer Objections to Answer/,
    /## Retention Risks/,
    /## Unsupported or Risky Claims/,
    /## Script-Readiness Gate/,
  ].forEach((pattern) => assert.match(structure, pattern));
  assert.match(structure, /A stronger script starts with traceable proof/);
  assert.match(structure, /The package has enough source support/);
  assert.match(structure, /notes\.md: present - # Notes Manual package note\./);
  assert.match(structure, /script-prompt\.md: present - # Script Prompt Drafting prompt context\./);
  assert.match(structure, /final-outline\.md: present - # Final Outline 1\. Hook 2\. Proof/);
  assert.equal(fs.existsSync(path.join(runDir, "script-draft.md")), false);
  assert.equal(fs.existsSync(path.join(runDir, "final-script.md")), false);
  assert.equal(fs.existsSync(path.join(runDir, "production-notes.md")), false);
});

test("script structure cli marks missing and blocked research as not ready", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-blocked-"));
  const missingDir = path.join(tempRoot, "package-runs", "2026-05-10-missing");
  const blockedDir = path.join(tempRoot, "package-runs", "2026-05-10-blocked");
  fs.mkdirSync(missingDir, { recursive: true });
  fs.mkdirSync(blockedDir, { recursive: true });
  fs.writeFileSync(path.join(missingDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Missing Research" } }));
  fs.writeFileSync(path.join(blockedDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Blocked Research" } }));
  fs.writeFileSync(
    path.join(blockedDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: BLOCKED\n- Reason: No sources.\n"
  );

  assert.equal(packageScriptStructureScript.main([missingDir]), 0);
  assert.equal(packageScriptStructureScript.main([blockedDir]), 0);
  const missing = fs.readFileSync(path.join(missingDir, "script-structure.md"), "utf8");
  const blocked = fs.readFileSync(path.join(blockedDir, "script-structure.md"), "utf8");

  assert.match(missing, /Script structure status: NEEDS RESEARCH/);
  assert.match(missing, /Ready to draft: no/);
  assert.match(missing, /## Proof Ladder/);
  assert.match(missing, /## Script-Readiness Gate/);
  assert.match(blocked, /Research gate status: BLOCKED/);
  assert.match(blocked, /Script structure status: BLOCKED/);
  assert.match(blocked, /Ready to draft: no/);
});

test("script structure cli allows pass research to become ready to draft", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-pass-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-pass");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Pass Research" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PASS\n- Reason: Research approved.\n"
  );

  assert.equal(packageScriptStructureScript.main([runDir]), 0);
  const structure = fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8");

  assert.match(structure, /Script structure status: READY TO DRAFT/);
  assert.match(structure, /Ready to draft: yes/);
});

test("script structure accepts approved research sufficiency review over partial research pack", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-review-pass-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-pass");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Review Pass Research" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: original pack remains partial.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: PASS
- Source references: 2
- Production-proof items: 1
- Objections/counterexamples: 1
- Research approval marker: PASS
`,
    "utf8"
  );

  assert.equal(packageScriptStructureScript.main([runDir]), 0);
  const structure = fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8");

  assert.match(structure, /Script structure status: READY TO DRAFT/);
  assert.match(structure, /Research gate status: PASS/);
  assert.match(structure, /Ready to draft: yes/);
  assert.match(structure, /Research source: research-sufficiency-review\.md/);
});

test("script structure accepts approved research sufficiency review without research pack", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-review-only-pass-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-only-pass");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Review Only Pass Research" } }));
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: PASS
- Source references: 3
- Production-proof items: 1
- Objections/counterexamples: 1
- Research approval marker: PASS
`,
    "utf8"
  );

  assert.equal(packageScriptStructureScript.main([runDir]), 0);
  const structure = fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8");

  assert.match(structure, /Script structure status: READY TO DRAFT/);
  assert.match(structure, /Research gate status: PASS/);
  assert.match(structure, /Ready to draft: yes/);
  assert.match(structure, /Research source: research-sufficiency-review\.md/);
});

test("script structure overwrite replaces stale needs research when approved review appears", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-review-only-overwrite-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-only-overwrite");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Review Only Overwrite" } }));
  const structurePath = path.join(runDir, "script-structure.md");
  fs.writeFileSync(
    structurePath,
    "# Script Structure\n\n- Script structure status: NEEDS RESEARCH\n- Research gate status: MISSING\n- Ready to draft: no\n- Research source: missing\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: PASS
- Source references: 3
- Production-proof items: 1
- Objections/counterexamples: 1
- Research approval marker: PASS
`,
    "utf8"
  );

  const skipped = captureConsole(() => packageScriptStructureScript.main([runDir]));
  assert.equal(skipped.result, 2);
  assert.match(fs.readFileSync(structurePath, "utf8"), /Script structure status: NEEDS RESEARCH/);

  const overwritten = captureConsole(() => packageScriptStructureScript.main([runDir, "--overwrite"]));
  const structure = fs.readFileSync(structurePath, "utf8");

  assert.equal(overwritten.result, 0);
  assert.match(structure, /Script structure status: READY TO DRAFT/);
  assert.match(structure, /Research gate status: PASS/);
  assert.match(structure, /Ready to draft: yes/);
  assert.match(structure, /Research source: research-sufficiency-review\.md/);
});

test("script structure keeps ready-for-review research evidence blocked until approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-review-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-ready");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Review Ready Research" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: awaiting research approval.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: READY FOR RESEARCH REVIEW
- Source references: 2
- Production-proof items: 1
- Objections/counterexamples: 1
- Research approval marker: missing
`,
    "utf8"
  );

  assert.equal(packageScriptStructureScript.main([runDir]), 0);
  const structure = fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8");

  assert.match(structure, /Script structure status: PARTIAL/);
  assert.match(structure, /Research gate status: PARTIAL/);
  assert.match(structure, /Ready to draft: no/);
});

test("script structure keeps partial research pack blocked when sufficiency review is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-review-missing-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-missing");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Missing Review Research" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: still incomplete.\n",
    "utf8"
  );

  assert.equal(packageScriptStructureScript.main([runDir]), 0);
  const structure = fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8");

  assert.match(structure, /Script structure status: PARTIAL/);
  assert.match(structure, /Research gate status: PARTIAL/);
  assert.match(structure, /Ready to draft: no/);
});

test("script structure cli preserves existing structure unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-structure-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-preserve");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Preserve Structure" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PASS\n"
  );
  const structurePath = path.join(runDir, "script-structure.md");
  fs.writeFileSync(structurePath, "# Manual Script Structure\n\nKeep this.\n", "utf8");

  const skipped = captureConsole(() => packageScriptStructureScript.main([runDir]));
  assert.equal(skipped.result, 2);
  assert.equal(fs.readFileSync(structurePath, "utf8"), "# Manual Script Structure\n\nKeep this.\n");

  const overwritten = captureConsole(() => packageScriptStructureScript.main([runDir, "--overwrite"]));
  assert.equal(overwritten.result, 0);
  assert.match(fs.readFileSync(structurePath, "utf8"), /Preserve Structure/);
});

function writeReviewBaseRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Script Review Package",
        viewerPromise: "A reviewed script is safe to take into production planning.",
        targetViewer: "Solo creator",
        viewerProblem: "The script may be under-researched.",
        suggestedProductionApproach: "Show the proof path on screen.",
      },
    })
  );
  if (options.script !== false) {
    fs.writeFileSync(path.join(runDir, options.finalScript ? "final-script.md" : "script-draft.md"), "# Script\n\nHook, proof, payoff.\n");
  }
  if (options.research !== false) {
    fs.writeFileSync(
      path.join(runDir, "research-pack.md"),
      `# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: ${options.researchStatus || "PASS"}\n`
    );
  }
  if (options.structure !== false) {
    fs.writeFileSync(
      path.join(runDir, "script-structure.md"),
      [
        "# Script Structure",
        "",
        `- Script structure status: ${options.structureStatus || "READY TO DRAFT"}`,
        `- Ready to draft: ${options.readyToDraft || "yes"}`,
        "",
      ].join("\n")
    );
  }
  if (options.creatorQaStatus) {
    fs.writeFileSync(path.join(runDir, "creator-qa-report.json"), JSON.stringify({ overall_result: options.creatorQaStatus }));
  }
}

test("script review help works", () => {
  const output = captureConsole(() => packageScriptReviewScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-script-review\.js/);
  assert.match(output.stdout.join("\n"), /--from-review/);
});

test("script review blocks missing script and writes blocked revision plan", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-missing-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-missing");
  writeReviewBaseRun(runDir, { script: false });

  const output = packageScriptReviewScript.main([runDir]);
  const review = fs.readFileSync(path.join(runDir, "script-review.md"), "utf8");
  const plan = fs.readFileSync(path.join(runDir, "script-revision-plan.md"), "utf8");

  assert.equal(output, 0);
  assert.match(review, /Script review status: BLOCKED/);
  assert.match(review, /Production planning ready: no/);
  assert.match(review, /No final-script\.md or script-draft\.md exists/);
  assert.match(plan, /Status: BLOCKED/);
});

test("script review prevents pass for partial research or not-ready structure", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-partial-"));
  const partialDir = path.join(tempRoot, "package-runs", "2026-05-10-partial");
  const notReadyDir = path.join(tempRoot, "package-runs", "2026-05-10-not-ready");
  writeReviewBaseRun(partialDir, { researchStatus: "PARTIAL" });
  writeReviewBaseRun(notReadyDir, { readyToDraft: "no", structureStatus: "PARTIAL" });

  assert.equal(packageScriptReviewScript.main([partialDir]), 0);
  assert.equal(packageScriptReviewScript.main([notReadyDir]), 0);
  const partial = fs.readFileSync(path.join(partialDir, "script-review.md"), "utf8");
  const notReady = fs.readFileSync(path.join(notReadyDir, "script-review.md"), "utf8");

  assert.match(partial, /Script review status: NEEDS REVISION/);
  assert.match(partial, /Research gate is PARTIAL/);
  assert.match(partial, /Production planning ready: no/);
  assert.match(notReady, /Script review status: NEEDS REVISION/);
  assert.match(notReady, /Script structure is PARTIAL/);
  assert.match(notReady, /Production planning ready: no/);
});

test("script review prevents pass for creator qa blocking status", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-qa-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-qa");
  writeReviewBaseRun(runDir, { creatorQaStatus: "NEEDS WORK" });

  assert.equal(packageScriptReviewScript.main([runDir]), 0);
  const review = fs.readFileSync(path.join(runDir, "script-review.md"), "utf8");

  assert.match(review, /Creator QA status is NEEDS WORK/);
  assert.match(review, /Script review status: NEEDS REVISION/);
  assert.match(review, /Production planning ready: no/);
});

test("script review detects unsupported claim and placeholder markers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-unsupported-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-unsupported");
  writeReviewBaseRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "script-draft.md"),
    "# Script\n\nThis is the best workflow and always works.\n\nTODO: add proof.\n\nUnsupported claim: verify before publishing.\n"
  );

  assert.equal(packageScriptReviewScript.main([runDir]), 0);
  const review = fs.readFileSync(path.join(runDir, "script-review.md"), "utf8");
  const plan = fs.readFileSync(path.join(runDir, "script-revision-plan.md"), "utf8");

  assert.match(review, /Script review status: NEEDS REVISION/);
  assert.match(review, /Script still contains placeholder or unfinished drafting markers/);
  assert.match(review, /Script explicitly marks an unsupported claim or evidence gap/);
  assert.match(plan, /READY FOR REVISION/);
  assert.match(plan, /Do not shoot until production planning is explicitly ready/);
});

test("script review allows instructional warnings about unsupported claims", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-instructional-warning-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-instructional-warning");
  writeReviewBaseRun(runDir, { finalScript: true, creatorQaStatus: "PASS" });
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    [
      "# Final Script",
      "",
      "Open with the creator choosing between three packaged ideas.",
      "",
      "Reject or repair the idea when the title sounds broad, the thumbnail is just a slogan, the proof depends on unsupported claims about AI tools, or the script would mostly explain opinions instead of showing a decision process.",
      "",
      "Then show a concrete scorecard and one visible proof example from the workflow.",
    ].join("\n")
  );

  assert.equal(packageScriptReviewScript.main([runDir]), 0);
  const review = fs.readFileSync(path.join(runDir, "script-review.md"), "utf8");

  assert.match(review, /Script review status: PASS/);
  assert.match(review, /Production planning ready: yes/);
  assert.doesNotMatch(review, /Script explicitly marks an unsupported claim or evidence gap/);
});

test("script review reports draft readiness markers separately from unsupported claims", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-draft-marker-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-draft-marker");
  writeReviewBaseRun(runDir, { finalScript: true, creatorQaStatus: "PASS" });
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    [
      "# Final Script",
      "",
      "- Status: Draft repair for Creator QA; not production approved and not ready to shoot.",
      "",
      "Reject or repair the idea when the title sounds broad, the thumbnail is just a slogan, the proof depends on unsupported claims about AI tools, or the script would mostly explain opinions instead of showing a decision process.",
      "",
      "- [ ] Script is ready for production planning.",
    ].join("\n")
  );

  assert.equal(packageScriptReviewScript.main([runDir]), 0);
  const review = fs.readFileSync(path.join(runDir, "script-review.md"), "utf8");

  assert.match(review, /Script review status: NEEDS REVISION/);
  assert.match(review, /Production planning ready: no/);
  assert.match(review, /Script explicitly marks itself as draft, not production approved, or not ready to shoot/);
  assert.doesNotMatch(review, /Script explicitly marks an unsupported claim or evidence gap/);
});

test("script review blocks current-script unsupported evidence markers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-current-unsupported-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-current-unsupported");
  writeReviewBaseRun(runDir, { finalScript: true, creatorQaStatus: "PASS" });
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    [
      "# Final Script",
      "",
      "Open with the creator choosing between three packaged ideas.",
      "",
      "This script evidence is unresolved and needs evidence before production planning.",
      "",
      "Close with the scorecard once the proof is fixed.",
    ].join("\n")
  );

  assert.equal(packageScriptReviewScript.main([runDir]), 0);
  const review = fs.readFileSync(path.join(runDir, "script-review.md"), "utf8");

  assert.match(review, /Script review status: NEEDS REVISION/);
  assert.match(review, /Production planning ready: no/);
  assert.match(review, /Script explicitly marks an unsupported claim or evidence gap/);
});

test("script review passes only when script research structure and qa are clear", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-pass-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-pass");
  writeReviewBaseRun(runDir, { finalScript: true, creatorQaStatus: "PASS" });

  assert.equal(packageScriptReviewScript.main([runDir]), 0);
  const review = fs.readFileSync(path.join(runDir, "script-review.md"), "utf8");
  const plan = fs.readFileSync(path.join(runDir, "script-revision-plan.md"), "utf8");

  assert.match(review, /Script review status: PASS/);
  assert.match(review, /Production planning ready: yes/);
  assert.match(plan, /READY FOR PRODUCTION PLANNING/);
});

test("script review from-review regenerates revision plan only", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-from-review-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-from-review");
  fs.mkdirSync(runDir, { recursive: true });
  const reviewPath = path.join(runDir, "script-review.md");
  const planPath = path.join(runDir, "script-revision-plan.md");
  fs.writeFileSync(
    reviewPath,
    [
      "# Script Review",
      "",
      "- Script review status: NEEDS REVISION",
      "- Production planning ready: no",
      "- Research gate status: PASS",
      "",
      "## Review Verdict",
      "",
      "- Status: NEEDS REVISION",
      "- Reason: Hook needs proof before production planning.",
      "- Required before production planning:",
      "- Add a concrete proof beat to the hook.",
      "",
    ].join("\n")
  );

  const output = captureConsole(() => packageScriptReviewScript.main([runDir, "--from-review"]));
  const review = fs.readFileSync(reviewPath, "utf8");
  const plan = fs.readFileSync(planPath, "utf8");

  assert.equal(output.result, 0);
  assert.equal(review.includes("Hook needs proof before production planning."), true);
  assert.doesNotMatch(output.stdout.join("\n"), /script-review\.md/);
  assert.match(output.stdout.join("\n"), /script-revision-plan\.md/);
  assert.match(plan, /READY FOR REVISION/);
  assert.match(plan, /Add a concrete proof beat to the hook/);
});

test("script review preserves existing artifacts unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-review-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-preserve");
  writeReviewBaseRun(runDir);
  const reviewPath = path.join(runDir, "script-review.md");
  const planPath = path.join(runDir, "script-revision-plan.md");
  fs.writeFileSync(reviewPath, "# Manual Review\n\nKeep this.\n");
  fs.writeFileSync(planPath, "# Manual Plan\n\nKeep this.\n");

  const skipped = captureConsole(() => packageScriptReviewScript.main([runDir]));
  assert.equal(skipped.result, 2);
  assert.equal(fs.readFileSync(reviewPath, "utf8"), "# Manual Review\n\nKeep this.\n");
  assert.equal(fs.readFileSync(planPath, "utf8"), "# Manual Plan\n\nKeep this.\n");

  const overwritten = captureConsole(() => packageScriptReviewScript.main([runDir, "--overwrite"]));
  assert.equal(overwritten.result, 0);
  assert.match(fs.readFileSync(reviewPath, "utf8"), /# Script Review/);
  assert.match(fs.readFileSync(planPath, "utf8"), /# Script Revision Plan/);
});

function writeProductionPlannerBaseRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Production Planner Package",
        viewerPromise: "A reviewed script becomes concrete production work.",
        targetViewer: "Solo creator",
        suggestedProductionApproach: "Screen-record the proof workflow and capture a clean hook.",
      },
    })
  );
  if (options.script !== false) {
    fs.writeFileSync(path.join(runDir, options.draftOnly ? "script-draft.md" : "final-script.md"), "# Final Script\n\nRecord the hook. Show the demo and screen capture the proof workflow.\n");
  }
  if (options.review !== false) {
    fs.writeFileSync(
      path.join(runDir, "script-review.md"),
      [
        "# Script Review",
        "",
        `- Script review status: ${options.reviewStatus || "PASS"}`,
        `- Production planning ready: ${options.productionPlanningReady || "yes"}`,
        "- External APIs called: no",
        "",
      ].join("\n")
    );
  }
  if (options.research !== false) {
    fs.writeFileSync(
      path.join(runDir, "research-pack.md"),
      [
        "# Research Pack",
        "",
        "## Production-Relevant Evidence Needed",
        "",
        "- Screen capture the proof workflow.",
        "",
        "## Research Sufficiency Gate",
        "",
        `- Status: ${options.researchStatus || "PASS"}`,
        options.researchManualApproval ? "- Manual approval: PASS" : "",
        "",
      ].join("\n")
    );
  }
  if (options.structure !== false) {
    fs.writeFileSync(
      path.join(runDir, "script-structure.md"),
      [
        "# Script Structure",
        "",
        `- Script structure status: ${options.structureStatus || "READY TO DRAFT"}`,
        `- Ready to draft: ${options.readyToDraft || "yes"}`,
        options.structureManualApproval ? "- Production planning approval: PASS" : "",
        "",
        "## Required Examples / Demos / Screenshots",
        "",
        "- Demo the idea filter and capture the output screen.",
        "",
      ].join("\n")
    );
  }
}

function writeProductionPlannerResearchEvidence(runDir, options = {}) {
  fs.writeFileSync(
    path.join(runDir, "source-support-map.md"),
    `# Source Support Map

| source/reference | claim supported | evidence type | reliability note | status |
| --- | --- | --- | --- | --- |
| selected-package.json | The selected package and viewer promise are recorded locally. | local artifact | Local run artifact. | review-needed |
| package-candidates.json | The rejected alternatives are available for comparison. | local artifact | Local run artifact. | review-needed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "proof-capture-plan.md"),
    `# Proof Capture Plan

| proof item | what it proves | local capture method | file/app/source | status |
| --- | --- | --- | --- | --- |
| captured-package-filter.png | Shows raw ideas, scorecard, selected package, and rejected generic suggestion. | Screenshot captured locally. | captured-package-filter.png | captured |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-objections.md"),
    `# Research Objections

| objection/counterexample | why it matters | evidence needed | response plan | status |
| --- | --- | --- | --- | --- |
| AI can help expand options even when final strategy remains human-owned. | Prevents an anti-AI strawman. | Compare useful AI option with rejected generic option. | Frame AI as exploration support, not final authority. | review-needed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-evidence.md"),
    `# Research Evidence

Concrete local evidence is listed in the support map and proof plan.

${options.approval ? "Research approval: PASS" : "Research approval: TODO"}
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: ${options.status || "PASS"}
- Source references: 2
- Production-proof items: 1
- Objections/counterexamples: 1
- Research approval marker: ${options.approval ? "PASS" : "missing"}

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
| No blockers detected. | Evidence is ready for review. | Keep sources attached. | closed |
`,
    "utf8"
  );
}

function productionPlanText(runDir) {
  return fs.readFileSync(path.join(runDir, "production-plan.md"), "utf8");
}

test("production planner help works", () => {
  const output = captureConsole(() => packageProductionPlanScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-production-plan\.js/);
});

test("production planner blocks missing script review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-missing-review-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-missing-review");
  writeProductionPlannerBaseRun(runDir, { review: false });

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);

  assert.match(plan, /Shoot-readiness status: NEEDS SCRIPT APPROVAL/);
  assert.match(plan, /script-review\.md is missing/);
  assert.doesNotMatch(plan, /Status: READY TO SHOOT/);
});

test("production planner blocks script review needs revision", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-needs-revision-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-needs-revision");
  writeProductionPlannerBaseRun(runDir, { reviewStatus: "NEEDS REVISION" });

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);

  assert.match(plan, /Script review status: NEEDS REVISION/);
  assert.match(plan, /Shoot-readiness status: NEEDS SCRIPT APPROVAL/);
  assert.match(plan, /Script review status is NEEDS REVISION, not PASS/);
});

test("production planner blocks production planning ready no", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-not-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-not-ready");
  writeProductionPlannerBaseRun(runDir, { productionPlanningReady: "no" });

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);

  assert.match(plan, /Production planning ready from review: no/);
  assert.match(plan, /Shoot-readiness status: BLOCKED/);
  assert.match(plan, /Production planning ready is no/);
});

test("production planner blocks partial research", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-partial-research-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-partial-research");
  writeProductionPlannerBaseRun(runDir, { researchStatus: "PARTIAL" });

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);

  assert.match(plan, /Research gate status: PARTIAL/);
  assert.match(plan, /Shoot-readiness status: BLOCKED/);
  assert.match(plan, /Research gate status is PARTIAL/);
});

test("production planner accepts approved research sufficiency review over partial research pack", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-review-pass-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-pass");
  writeProductionPlannerBaseRun(runDir, { researchStatus: "PARTIAL" });
  writeProductionPlannerResearchEvidence(runDir, { status: "PASS", approval: true });

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);
  const blockers = fs.readFileSync(path.join(runDir, "production-blockers.md"), "utf8");

  assert.match(plan, /Research gate status: PASS/);
  assert.match(plan, /Script structure status: READY TO DRAFT/);
  assert.match(plan, /Shoot-readiness status: READY TO SHOOT/);
  assert.match(plan, /Status: READY TO SHOOT/);
  assert.match(blockers, /\| None\. \|/);
});

test("production planner blocks research evidence that is ready for review but not approved", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-review-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-ready");
  writeProductionPlannerBaseRun(runDir, { researchStatus: "PARTIAL" });
  writeProductionPlannerResearchEvidence(runDir, { status: "READY FOR RESEARCH REVIEW", approval: false });

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);

  assert.match(plan, /Research gate status: READY FOR RESEARCH REVIEW/);
  assert.match(plan, /Shoot-readiness status: BLOCKED/);
  assert.doesNotMatch(plan, /Status: READY TO SHOOT/);
});

test("production planner blocks stale research review pass when evidence inputs are incomplete", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-stale-review-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-stale-review");
  writeProductionPlannerBaseRun(runDir, { researchStatus: "PARTIAL" });
  fs.writeFileSync(
    path.join(runDir, "research-evidence.md"),
    "# Research Evidence\n\nExternal source candidates still need manual verification.\n\nResearch approval: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "source-support-map.md"),
    `# Source Support Map

| source/reference | claim supported | evidence type | reliability note | status |
| --- | --- | --- | --- | --- |
| selected-package.json | Local package decision exists. | local artifact | Local run artifact. | review-needed |
| Manual external source candidate: YouTube Help page to verify later | External guidance might support the premise. | external candidate | Not verified. | to-verify |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "proof-capture-plan.md"),
    `# Proof Capture Plan

| proof item | what it proves | local capture method | file/app/source | status |
| --- | --- | --- | --- | --- |
| Raw AI suggestions vs selected package | Shows the workflow boundary. | Capture later. | local workspace | planned |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-objections.md"),
    `# Research Objections

| objection/counterexample | why it matters | evidence needed | response plan | status |
| --- | --- | --- | --- | --- |
| AI can help expand options while final strategy stays human-owned. | Keeps the argument balanced. | Local comparison. | Frame AI as support. | review-needed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: PASS
- Source references: 2
- Production-proof items: 1
- Objections/counterexamples: 1
- Research approval marker: PASS
`,
    "utf8"
  );

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);

  assert.match(plan, /Research gate status: NEEDS EVIDENCE/);
  assert.match(plan, /Shoot-readiness status: BLOCKED/);
  assert.match(plan, /current research evidence evaluates as NEEDS EVIDENCE/);
  assert.doesNotMatch(plan, /Status: READY TO SHOOT/);
});

test("production planner blocks when no script file exists", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-no-script-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-no-script");
  writeProductionPlannerBaseRun(runDir, { script: false });

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);
  const blockers = fs.readFileSync(path.join(runDir, "production-blockers.md"), "utf8");

  assert.match(plan, /Source script: missing/);
  assert.match(plan, /Shoot-readiness status: BLOCKED/);
  assert.match(blockers, /No final-script\.md or script-draft\.md exists/);
});

test("production planner can mark ready only with explicit pass conditions", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-ready");
  writeProductionPlannerBaseRun(runDir);

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);
  const blockers = fs.readFileSync(path.join(runDir, "production-blockers.md"), "utf8");

  assert.match(plan, /Script review status: PASS/);
  assert.match(plan, /Production planning ready from review: yes/);
  assert.match(plan, /Research gate status: PASS/);
  assert.match(plan, /Script structure status: READY TO DRAFT/);
  assert.match(plan, /Status: READY TO SHOOT/);
  assert.match(blockers, /\| None\. \|/);
});

test("production planner exact manual markers can approve research and structure only", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-manual-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-manual");
  writeProductionPlannerBaseRun(runDir, {
    researchStatus: "PARTIAL",
    researchManualApproval: true,
    structureStatus: "PARTIAL",
    readyToDraft: "no",
    structureManualApproval: true,
  });

  assert.equal(packageProductionPlanScript.main([runDir]), 0);
  const plan = productionPlanText(runDir);

  assert.match(plan, /Research gate status: PARTIAL/);
  assert.match(plan, /Script structure status: PARTIAL/);
  assert.match(plan, /Status: READY TO SHOOT/);
});

test("production planner preserves existing artifacts unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-plan-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-preserve");
  writeProductionPlannerBaseRun(runDir);
  const planPath = path.join(runDir, "production-plan.md");
  const brollPath = path.join(runDir, "b-roll-list.md");
  fs.writeFileSync(planPath, "# Manual Production Plan\n\nKeep this.\n");
  fs.writeFileSync(brollPath, "# Manual B-Roll\n\nKeep this.\n");

  const first = captureConsole(() => packageProductionPlanScript.main([runDir]));
  assert.equal(first.result, 0);
  assert.equal(fs.readFileSync(planPath, "utf8"), "# Manual Production Plan\n\nKeep this.\n");
  assert.equal(fs.readFileSync(brollPath, "utf8"), "# Manual B-Roll\n\nKeep this.\n");
  assert.match(first.stdout.join("\n"), /unchanged: .*production-plan\.md/);
  assert.match(first.stdout.join("\n"), /created: .*shot-list\.md/);

  const overwritten = captureConsole(() => packageProductionPlanScript.main([runDir, "--overwrite"]));
  assert.equal(overwritten.result, 0);
  assert.match(fs.readFileSync(planPath, "utf8"), /# Production Plan/);
  assert.match(fs.readFileSync(brollPath, "utf8"), /# B-Roll List/);
  assert.match(overwritten.stdout.join("\n"), /overwritten: .*production-plan\.md/);
});

test("verify script checks production planner syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-production-plan\.js/);
});

function writeConcreteStage4Planning(runDir, options = {}) {
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    [
      "# Production Plan",
      "",
      "- Shoot-readiness status: READY TO SHOOT",
      "- Production planning ready from review: yes",
      options.approval ? "- Shot/edit plan approval: PASS" : "",
      "",
      "## Production Goal",
      "",
      "- Capture the approved hook, proof workflow, and conclusion from the final script.",
      "",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "shot-list.md"),
    "# Shot List\n\n| shot | reason | priority | status |\n| --- | --- | --- | --- |\n| Hook A-roll | Opens the approved script and frames the viewer problem. | high | ready |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "screen-capture-list.md"),
    "# Screen Capture List\n\n| capture | proof purpose | source/app | status |\n| --- | --- | --- | --- |\n| Package comparison screen | Shows the selected package and rejected generic option. | local browser | ready |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "demo-list.md"),
    "# Demo List\n\n| demo | what it proves | setup needed | status |\n| --- | --- | --- | --- |\n| Run the idea filter | Shows the workflow boundary. | local notes and browser tab | ready |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "b-roll-list.md"),
    "# B-Roll List\n\n| b-roll item | reason | source | status |\n| --- | --- | --- | --- |\n| Timeline overview | Adds pacing between proof beats. | Resolve project | ready |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "graphics-list.md"),
    "# Graphics List\n\n| graphic | clarity purpose | source/input | status |\n| --- | --- | --- | --- |\n| Decision boundary card | Names human-owned decisions. | final script | ready |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "audio-notes.md"),
    "# Audio Notes\n\n## Voiceover Notes\n\n- Record the approved final script with clean room tone and mark retakes by section.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are satisfied. | Keep evidence attached to the run. | closed |\n",
    "utf8"
  );
}

function stage4ReviewText(runDir) {
  return fs.readFileSync(path.join(runDir, "shot-edit-plan-review.md"), "utf8");
}

test("shot/edit plan review help works", () => {
  const output = captureConsole(() => packageShotEditPlanReviewScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-shot-edit-plan-review\.js/);
});

test("shot/edit plan review missing upstream files cannot produce PASS", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-missing-upstream-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-missing-upstream");
  writeProductionPlannerBaseRun(runDir, { script: false });
  writeConcreteStage4Planning(runDir, { approval: true });

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);
  const review = stage4ReviewText(runDir);

  assert.match(review, /Review status: BLOCKED/);
  assert.match(review, /Stage accepted: no/);
  assert.match(review, /final-script\.md is missing/);
  assert.doesNotMatch(review, /Review status: PASS/);
});

test("shot/edit plan review missing planning files cannot produce PASS", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-missing-planning-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-missing-planning");
  writeProductionPlannerBaseRun(runDir);
  writeConcreteStage4Planning(runDir, { approval: true });
  fs.unlinkSync(path.join(runDir, "shot-list.md"));

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);
  const review = stage4ReviewText(runDir);

  assert.match(review, /Review status: NEEDS WORK/);
  assert.match(review, /Stage accepted: no/);
  assert.match(review, /shot-list\.md is missing/);
  assert.doesNotMatch(review, /Review status: PASS/);
});

test("shot/edit plan review placeholder-only planning files cannot produce PASS", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-placeholder-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-placeholder");
  writeProductionPlannerBaseRun(runDir);
  writeConcreteStage4Planning(runDir, { approval: true });
  fs.writeFileSync(path.join(runDir, "demo-list.md"), "# Demo List\n\nTODO\n", "utf8");

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);
  const review = stage4ReviewText(runDir);

  assert.match(review, /Review status: NEEDS WORK/);
  assert.match(review, /demo-list\.md is placeholder-only or too thin/);
  assert.doesNotMatch(review, /Stage accepted: yes/);
});

test("shot/edit plan review preserves manually edited planning artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-preserve");
  writeProductionPlannerBaseRun(runDir);
  writeConcreteStage4Planning(runDir);
  const before = Object.fromEntries(
    packageShotEditPlanReviewScript.PLANNING_FILES.map((filename) => [filename, fs.readFileSync(path.join(runDir, filename), "utf8")])
  );

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);

  packageShotEditPlanReviewScript.PLANNING_FILES.forEach((filename) => {
    assert.equal(fs.readFileSync(path.join(runDir, filename), "utf8"), before[filename]);
  });
});

test("shot/edit plan review requires exact manual approval marker for accepted stage", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-approval-"));
  const readyDir = path.join(tempRoot, "package-runs", "2026-05-10-ready");
  const passDir = path.join(tempRoot, "package-runs", "2026-05-10-pass");
  writeProductionPlannerBaseRun(readyDir);
  writeConcreteStage4Planning(readyDir, { approval: false });
  writeProductionPlannerBaseRun(passDir);
  writeConcreteStage4Planning(passDir, { approval: true });

  assert.equal(packageShotEditPlanReviewScript.main([readyDir]), 0);
  assert.equal(packageShotEditPlanReviewScript.main([passDir]), 0);

  assert.match(stage4ReviewText(readyDir), /Review status: READY FOR HUMAN APPROVAL/);
  assert.match(stage4ReviewText(readyDir), /Stage accepted: no/);
  assert.match(stage4ReviewText(passDir), /Review status: PASS/);
  assert.match(stage4ReviewText(passDir), /Stage accepted: yes/);
});

test("shot/edit plan review accepts approved research sufficiency review without research pack", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-review-research-pass-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-research-pass");
  writeProductionPlannerBaseRun(runDir, { research: false });
  writeProductionPlannerResearchEvidence(runDir, { status: "PASS", approval: true });
  writeConcreteStage4Planning(runDir, { approval: false });

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);
  const review = stage4ReviewText(runDir);

  assert.match(review, /Review status: READY FOR HUMAN APPROVAL/);
  assert.match(review, /Stage accepted: no/);
  assert.match(review, /Research gate status: PASS/);
  assert.doesNotMatch(review, /research-pack\.md is missing/);
  assert.doesNotMatch(review, /Review status: BLOCKED/);
});

test("shot/edit plan review blocks unapproved research sufficiency review without research pack", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-review-research-unapproved-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-research-unapproved");
  writeProductionPlannerBaseRun(runDir, { research: false });
  writeProductionPlannerResearchEvidence(runDir, { status: "READY FOR RESEARCH REVIEW", approval: false });
  writeConcreteStage4Planning(runDir, { approval: true });

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);
  const review = stage4ReviewText(runDir);

  assert.match(review, /Review status: BLOCKED/);
  assert.match(review, /Stage accepted: no/);
  assert.match(review, /Research gate status: READY FOR RESEARCH REVIEW/);
  assert.match(review, /Research gate status is READY FOR RESEARCH REVIEW/);
  assert.doesNotMatch(review, /Review status: PASS/);
});

test("shot/edit plan review still requires manual marker after approved research sufficiency fallback", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-review-research-manual-"));
  const readyDir = path.join(tempRoot, "package-runs", "2026-05-10-review-research-ready");
  const passDir = path.join(tempRoot, "package-runs", "2026-05-10-review-research-pass");
  writeProductionPlannerBaseRun(readyDir, { research: false });
  writeProductionPlannerResearchEvidence(readyDir, { status: "PASS", approval: true });
  writeConcreteStage4Planning(readyDir, { approval: false });
  writeProductionPlannerBaseRun(passDir, { research: false });
  writeProductionPlannerResearchEvidence(passDir, { status: "PASS", approval: true });
  writeConcreteStage4Planning(passDir, { approval: true });

  assert.equal(packageShotEditPlanReviewScript.main([readyDir]), 0);
  assert.equal(packageShotEditPlanReviewScript.main([passDir]), 0);

  assert.match(stage4ReviewText(readyDir), /Review status: READY FOR HUMAN APPROVAL/);
  assert.match(stage4ReviewText(readyDir), /Stage accepted: no/);
  assert.match(stage4ReviewText(readyDir), /Manual approval marker detected: no/);
  assert.match(stage4ReviewText(passDir), /Review status: PASS/);
  assert.match(stage4ReviewText(passDir), /Stage accepted: yes/);
  assert.match(stage4ReviewText(passDir), /Manual approval marker detected: yes/);
});

test("shot/edit plan review ignores upstream manual approval markers for stage acceptance", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-upstream-approval-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-upstream-approval");
  writeProductionPlannerBaseRun(runDir, { structureManualApproval: true });
  writeConcreteStage4Planning(runDir, { approval: false });

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);
  const review = stage4ReviewText(runDir);

  assert.match(review, /Review status: READY FOR HUMAN APPROVAL/);
  assert.match(review, /Stage accepted: no/);
  assert.match(review, /Manual approval marker detected: no/);
  assert.doesNotMatch(review, /Review status: PASS/);
});

test("shot/edit plan review json returns machine-readable status", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-json-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-json");
  writeProductionPlannerBaseRun(runDir);
  writeConcreteStage4Planning(runDir);

  const output = captureConsole(() => packageShotEditPlanReviewScript.main([runDir, "--json"]));
  const payload = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.equal(payload.stage, "script-to-shot-edit-plan");
  assert.equal(payload.externalApisCalled, false);
  assert.equal(payload.reviewStatus, "READY FOR HUMAN APPROVAL");
  assert.equal(payload.stageAccepted, false);
});

test("shot/edit plan review writes only review and enhancement artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-write-scope-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-write-scope");
  writeProductionPlannerBaseRun(runDir);
  writeConcreteStage4Planning(runDir);
  const beforeFiles = new Set(fs.readdirSync(runDir));

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);

  const afterFiles = fs.readdirSync(runDir);
  const added = afterFiles.filter((filename) => !beforeFiles.has(filename)).sort();
  assert.deepEqual(added, ["shot-edit-plan-enhancement-plan.md", "shot-edit-plan-review.md"]);
});

test("shot/edit plan review introduces no external API behavior", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "package-run-shot-edit-plan-review.js"), "utf8");

  assert.doesNotMatch(source, /require\(["']node:https?["']\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /External APIs called: yes/);
});

test("verify script checks shot/edit plan review syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-shot-edit-plan-review\.js/);
});

function writeRoughCutBaseRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Rough Cut Package",
        viewerPromise: "The rough cut clearly proves the workflow.",
        targetViewer: "Solo creator",
      },
    })
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n\nHook, proof, payoff.\n");
  fs.writeFileSync(
    path.join(runDir, "script-review.md"),
    "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n"
  );
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PASS\n"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Ready to draft: yes\n"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    [
      "# Production Plan",
      "",
      "- Shoot-readiness status: " + (options.shootReadiness || "READY TO SHOOT"),
      "- Script review status: PASS",
      "- Research gate status: PASS",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    options.openProductionBlocker
      ? "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| Missing proof shot. | Blocks viewer trust. | Capture it. | open |\n"
      : "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n"
  );
  if (options.watchNotes) {
    fs.writeFileSync(path.join(runDir, "rough-cut-watch-notes.md"), options.watchNotes);
  }
}

function roughCutReviewText(runDir) {
  return fs.readFileSync(path.join(runDir, "rough-cut-review.md"), "utf8");
}

function realWatchNotes(extraSections = "") {
  return [
    "# Rough-Cut Watch Notes",
    "",
    "## Rough-Cut Version Reviewed",
    "",
    "v1",
    "",
    "## Watch Date",
    "",
    "2026-05-11",
    "",
    "## Reviewer",
    "",
    "Mikko",
    "",
    "## First 30 Seconds Notes",
    "",
    "Hook is clear and watchable.",
    "",
    "## Clarity Notes",
    "",
    "The viewer can follow the promise.",
    "",
    "## Pacing Notes",
    "",
    "No major pacing issue detected.",
    "",
    "## Proof / Evidence Notes",
    "",
    "The proof lands clearly enough for a second cut.",
    "",
    extraSections,
  ].join("\n");
}

test("rough cut review help works", () => {
  const output = captureConsole(() => packageRoughCutReviewScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-rough-cut-review\.js/);
});

test("rough cut review creates starter watch notes and blocks when notes are missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-missing-notes-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-missing-notes");
  writeRoughCutBaseRun(runDir);

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const notes = fs.readFileSync(path.join(runDir, "rough-cut-watch-notes.md"), "utf8");
  const review = roughCutReviewText(runDir);

  assert.match(notes, /Status: starter template/);
  assert.match(notes, /## First 30 Seconds Notes/);
  assert.match(review, /Rough-cut version reviewed: Not assessed/);
  assert.match(review, /Watch context: Not assessed\.; reviewer: Not assessed\./);
  assert.match(review, /Rough-cut review status: BLOCKED/);
  assert.match(review, /Second-cut ready: no/);
  assert.match(review, /starter template created/);
  assert.match(review, /Not assessed\. Real rough-cut watch notes are missing or still a starter template\./);
  assert.doesNotMatch(review, /No pickups detected from watch notes\./);
  assert.doesNotMatch(review, /No edit fixes detected from watch notes\./);
  assert.match(
    fs.readFileSync(path.join(runDir, "pickup-list.md"), "utf8"),
    /\| Not assessed\. \| Real rough-cut watch notes are missing or still a starter template\. \| high \| rough-cut-watch-notes\.md \| blocked \|/
  );
  assert.match(
    fs.readFileSync(path.join(runDir, "edit-fix-list.md"), "utf8"),
    /\| Not assessed\. \| Real rough-cut watch notes are missing or still a starter template\. \| Add real watch notes before edit fixes can be assessed\. \| high \| blocked \|/
  );
});

test("rough cut review treats starter watch notes as blocked", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-starter-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-starter");
  writeRoughCutBaseRun(runDir, {
    watchNotes: packageRoughCutReviewScript.buildWatchNotesTemplate("2026-05-10-starter"),
  });

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const review = roughCutReviewText(runDir);
  const pickups = fs.readFileSync(path.join(runDir, "pickup-list.md"), "utf8");
  const fixes = fs.readFileSync(path.join(runDir, "edit-fix-list.md"), "utf8");

  assert.match(review, /Rough-cut review status: BLOCKED/);
  assert.match(review, /starter template or has no real review notes/);
  assert.match(review, /Not assessed\. Real rough-cut watch notes are missing or still a starter template\./);
  assert.doesNotMatch(review, /No pickups detected from watch notes\./);
  assert.doesNotMatch(review, /No edit fixes detected from watch notes\./);
  assert.match(pickups, /Not assessed\./);
  assert.match(pickups, /\| blocked \|/);
  assert.doesNotMatch(pickups, /None\..*closed/);
  assert.match(fixes, /Not assessed\./);
  assert.match(fixes, /\| blocked \|/);
  assert.doesNotMatch(fixes, /None\..*closed/);
});

test("rough cut review real watch notes with no issues can use none closed list rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-no-issues-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-no-issues");
  writeRoughCutBaseRun(runDir, {
    watchNotes: realWatchNotes(),
  });

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const review = roughCutReviewText(runDir);
  const pickups = fs.readFileSync(path.join(runDir, "pickup-list.md"), "utf8");
  const fixes = fs.readFileSync(path.join(runDir, "edit-fix-list.md"), "utf8");

  assert.match(review, /Rough-cut version reviewed: v1/);
  assert.match(review, /Watch context: 2026-05-11; reviewer: Mikko/);
  assert.match(review, /No pickups detected from watch notes\./);
  assert.match(review, /No edit fixes detected from watch notes\./);
  assert.doesNotMatch(review, /Not assessed\. Real rough-cut watch notes are missing or still a starter template\./);
  assert.match(pickups, /\| None\. \| No pickups detected from watch notes\. \| low \| rough-cut-watch-notes\.md \| closed \|/);
  assert.match(fixes, /\| None\. \| No edit fixes detected from watch notes\. \| No fix needed\. \| low \| closed \|/);
  assert.doesNotMatch(pickups, /Not assessed/);
  assert.doesNotMatch(fixes, /Not assessed/);
});

test("rough cut review blocks second cut when production plan is not ready to shoot", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-production-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-production-blocked");
  writeRoughCutBaseRun(runDir, {
    shootReadiness: "BLOCKED",
    watchNotes: `${realWatchNotes()}\n- Rough-cut approval: PASS\n`,
  });

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const review = roughCutReviewText(runDir);

  assert.match(review, /Shoot-readiness status: BLOCKED/);
  assert.match(review, /Rough-cut review status: BLOCKED/);
  assert.match(review, /Second-cut ready: no/);
});

test("rough cut review open production blockers prevent second cut readiness", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-open-blockers-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-open-blockers");
  writeRoughCutBaseRun(runDir, {
    openProductionBlocker: true,
    watchNotes: `${realWatchNotes()}\n- Rough-cut approval: PASS\n`,
  });

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const review = roughCutReviewText(runDir);

  assert.match(review, /Rough-cut review status: BLOCKED/);
  assert.match(review, /production-blockers\.md has open blockers/);
  assert.doesNotMatch(review, /Status: READY FOR SECOND CUT/);
});

test("rough cut review detects pickups needed and writes pickup list entries", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-pickups-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-pickups");
  writeRoughCutBaseRun(runDir, {
    watchNotes: realWatchNotes([
      "## Pickups Needed",
      "",
      "- Retake the hook line with a clearer proof promise.",
      "- Capture missing scorecard close-up.",
      "",
    ].join("\n")),
  });

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const review = roughCutReviewText(runDir);
  const pickups = fs.readFileSync(path.join(runDir, "pickup-list.md"), "utf8");

  assert.match(review, /Rough-cut review status: NEEDS PICKUPS/);
  assert.match(pickups, /Retake the hook line/);
  assert.match(pickups, /Capture missing scorecard close-up/);
  assert.match(pickups, /\| pickup shot\/content \| reason \| priority \| source\/location \| status \|/);
});

test("rough cut review detects edit fixes needed and writes edit fix list entries", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-edit-fixes-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-edit-fixes");
  writeRoughCutBaseRun(runDir, {
    watchNotes: realWatchNotes([
      "## Edit Fixes Needed",
      "",
      "- Tighten the middle proof section by 20 seconds.",
      "- Move the scorecard graphic earlier.",
      "",
    ].join("\n")),
  });

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const review = roughCutReviewText(runDir);
  const fixes = fs.readFileSync(path.join(runDir, "edit-fix-list.md"), "utf8");

  assert.match(review, /Rough-cut review status: NEEDS EDIT FIXES/);
  assert.match(fixes, /Tighten the middle proof section/);
  assert.match(fixes, /Move the scorecard graphic earlier/);
  assert.match(fixes, /\| section\/timecode \| problem \| fix \| priority \| status \|/);
});

test("rough cut review exact approval can mark ready only when other gates allow it", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-ready");
  writeRoughCutBaseRun(runDir, {
    watchNotes: `${realWatchNotes()}\n- Rough-cut approval: PASS\n`,
  });

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const review = roughCutReviewText(runDir);

  assert.match(review, /Rough-cut review status: READY FOR SECOND CUT/);
  assert.match(review, /Second-cut ready: yes/);
  assert.match(review, /Status: READY FOR SECOND CUT/);
});

test("rough cut review preserves existing artifacts unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-preserve");
  writeRoughCutBaseRun(runDir, {
    watchNotes: `${realWatchNotes()}\n- Rough-cut approval: PASS\n`,
  });
  const reviewPath = path.join(runDir, "rough-cut-review.md");
  const pickupPath = path.join(runDir, "pickup-list.md");
  fs.writeFileSync(reviewPath, "# Manual Rough Cut Review\n\nKeep this.\n");
  fs.writeFileSync(pickupPath, "# Manual Pickups\n\nKeep this.\n");

  const first = captureConsole(() => packageRoughCutReviewScript.main([runDir]));
  assert.equal(first.result, 0);
  assert.equal(fs.readFileSync(reviewPath, "utf8"), "# Manual Rough Cut Review\n\nKeep this.\n");
  assert.equal(fs.readFileSync(pickupPath, "utf8"), "# Manual Pickups\n\nKeep this.\n");
  assert.match(first.stdout.join("\n"), /unchanged: .*rough-cut-review\.md/);
  assert.match(first.stdout.join("\n"), /created: .*edit-fix-list\.md/);

  const overwritten = captureConsole(() => packageRoughCutReviewScript.main([runDir, "--overwrite"]));
  assert.equal(overwritten.result, 0);
  assert.match(fs.readFileSync(reviewPath, "utf8"), /# Rough-Cut Review/);
  assert.match(fs.readFileSync(pickupPath, "utf8"), /# Pickup List/);
  assert.match(overwritten.stdout.join("\n"), /overwritten: .*rough-cut-review\.md/);
});

test("verify script checks rough cut review syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-rough-cut-review\.js/);
});

function writeFinalReviewBaseRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "rough-cut-review.md"),
    [
      "# Rough-Cut Review",
      "",
      "- Rough-cut review status: " + (options.roughCutStatus || "READY FOR SECOND CUT"),
      "- Second-cut ready: " + (options.secondCutReady || "yes"),
      "",
      "## Second-Cut Readiness Gate",
      "",
      "- Status: " + (options.roughCutStatus || "READY FOR SECOND CUT"),
      "",
    ].join("\n")
  );
  if (options.finalWatchNotes) {
    fs.writeFileSync(path.join(runDir, "final-watch-notes.md"), options.finalWatchNotes);
  }
  if (options.publishPack !== false) {
    fs.writeFileSync(
      path.join(runDir, "publish-pack.md"),
      options.publishPack ||
        "# Publish Pack\n\n## Title\n\nApproved title\n\n## Description\n\nApproved description.\n\n- Publish pack approval: PASS\n"
    );
  }
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { viewerPromise: "The final video delivers the package promise." } })
  );
}

function finalReviewText(runDir) {
  return fs.readFileSync(path.join(runDir, "final-review.md"), "utf8");
}

function publicationBlockersText(runDir) {
  return fs.readFileSync(path.join(runDir, "publication-blockers.md"), "utf8");
}

function realFinalWatchNotes(extraSections = "") {
  return [
    "# Final-Watch Notes",
    "",
    "## Final Version Reviewed",
    "",
    "final-v1",
    "",
    "## Watch Date",
    "",
    "2026-05-11",
    "",
    "## Reviewer",
    "",
    "Mikko",
    "",
    "## Final-Watch Issues",
    "",
    "None.",
    "",
    "## Publication Blockers",
    "",
    "None.",
    "",
    "## Viewer Promise Delivery",
    "",
    "Promise is delivered clearly.",
    "",
    "## Opening Strength",
    "",
    "Opening is strong enough.",
    "",
    "## Clarity",
    "",
    "Clear.",
    "",
    "## Pacing",
    "",
    "Pacing works.",
    "",
    "## Proof / Evidence",
    "",
    "Proof is visible.",
    "",
    "## Audio Quality",
    "",
    "Audio is clean.",
    "",
    "## Visual Support",
    "",
    "Visuals support the claims.",
    "",
    "## Graphics / Captions",
    "",
    "Graphics are readable.",
    "",
    "## Title / Thumbnail Fit",
    "",
    "Title and thumbnail fit the video.",
    "",
    "## Ethical / Accuracy Risks",
    "",
    "No unresolved accuracy risk.",
    "",
    "## Upload Metadata Readiness",
    "",
    "Publish metadata is ready.",
    "",
    "## Archive Readiness",
    "",
    "Archive notes can be saved.",
    "",
    extraSections,
  ].join("\n");
}

function aliasFinalWatchNotes(extraSections = "") {
  return realFinalWatchNotes(extraSections)
    .replace("## Viewer Promise Delivery", "## Promise Delivery")
    .replace("## Opening Strength", "## Opening")
    .replace("## Audio Quality", "## Audio")
    .replace("## Visual Support", "## Visuals");
}

test("final review help works", () => {
  const output = captureConsole(() => packageFinalReviewScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-final-review\.js/);
});

test("final review blocks when rough cut review is blocked and final notes are missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-final-review-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-final-blocked");
  writeFinalReviewBaseRun(runDir, {
    roughCutStatus: "BLOCKED",
    secondCutReady: "no",
  });

  assert.equal(packageFinalReviewScript.main([runDir]), 0);
  const notes = fs.readFileSync(path.join(runDir, "final-watch-notes.md"), "utf8");
  const review = finalReviewText(runDir);
  const blockers = publicationBlockersText(runDir);

  assert.match(notes, /Status: starter template/);
  assert.match(review, /Final review status: BLOCKED/);
  assert.match(review, /Publish ready: no/);
  assert.match(review, /Final version reviewed: Not assessed/);
  assert.match(review, /Viewer Promise Delivery/);
  assert.match(review, /Upload Metadata Readiness/);
  assert.match(review, /rough-cut-review\.md is BLOCKED, not READY FOR SECOND CUT/);
  assert.match(review, /Not assessed\. Real final-watch notes are missing or still a starter template\./);
  assert.doesNotMatch(review, /No final-watch issues detected/);
  assert.doesNotMatch(review, /Status: PASS/);
  assert.doesNotMatch(review, /Publish ready: yes/);
  assert.match(blockers, /# Publication Blockers/);
  assert.match(blockers, /\| blocker \| why it matters \| required fix \| status \|/);
  assert.match(blockers, /rough-cut-review\.md is BLOCKED, not READY FOR SECOND CUT/);
  assert.match(blockers, /Second-cut ready is no/);
  assert.match(blockers, /final-watch-notes\.md is still a starter template or has no real final-watch notes/);
  assert.match(blockers, /\| blocked \|/);
  assert.doesNotMatch(blockers, /\| None\. \|.*\| closed \|/);
});

test("final review treats starter final-watch notes as not assessed", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-final-review-starter-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-final-starter");
  writeFinalReviewBaseRun(runDir, {
    finalWatchNotes: packageFinalReviewScript.buildFinalWatchNotesTemplate("2026-05-10-final-starter"),
  });

  assert.equal(packageFinalReviewScript.main([runDir]), 0);
  const review = finalReviewText(runDir);
  const blockers = publicationBlockersText(runDir);

  assert.match(review, /Final review status: BLOCKED/);
  assert.match(review, /Not assessed\. Real final-watch notes are missing or still a starter template\./);
  assert.doesNotMatch(review, /No final-watch issues detected/);
  assert.doesNotMatch(review, /Publish ready: yes/);
  assert.match(blockers, /final-watch-notes\.md is still a starter template or has no real final-watch notes/);
  assert.match(blockers, /\| blocked \|/);
  assert.doesNotMatch(blockers, /\| None\. \|.*\| closed \|/);
});

test("final review real notes with no issues still needs exact final approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-final-review-clean-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-final-clean");
  writeFinalReviewBaseRun(runDir, {
    finalWatchNotes: realFinalWatchNotes(),
  });

  assert.equal(packageFinalReviewScript.main([runDir]), 0);
  const review = finalReviewText(runDir);
  const blockers = publicationBlockersText(runDir);

  assert.match(review, /Final review status: NEEDS FINAL FIXES/);
  assert.match(review, /Publish ready: no/);
  assert.match(review, /Status: NEEDS FINAL FIXES/);
  assert.match(review, /No final-watch issues detected from real final-watch notes\./);
  assert.doesNotMatch(review, /Not assessed\. Real final-watch notes are missing or still a starter template\./);
  assert.match(blockers, /Final-review evidence is incomplete/);
  assert.match(blockers, /\| blocked \|/);
});

test("final review accepts legacy final-watch heading aliases", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-final-review-aliases-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-final-aliases");
  writeFinalReviewBaseRun(runDir, {
    finalWatchNotes: `${aliasFinalWatchNotes()}\n- Final approval: PASS\n`,
  });

  assert.equal(packageFinalReviewScript.main([runDir]), 0);
  const review = finalReviewText(runDir);
  const blockers = publicationBlockersText(runDir);

  assert.match(review, /Final review status: PASS/);
  assert.match(review, /Publish ready: yes/);
  assert.match(review, /## Viewer Promise Delivery\n\nPromise is delivered clearly\./);
  assert.match(review, /## Opening Strength\n\nOpening is strong enough\./);
  assert.match(review, /## Audio Quality\n\nAudio is clean\./);
  assert.match(review, /## Visual Support\n\nVisuals support the claims\./);
  assert.doesNotMatch(review, /Not assessed\. Add real final-watch notes/);
  assert.doesNotMatch(blockers, /is not assessed in final-watch-notes\.md/);
});

test("final review blocks exact approval when required final-watch sections are missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-final-review-missing-sections-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-final-missing-sections");
  writeFinalReviewBaseRun(runDir, {
    finalWatchNotes: [
      "# Final-Watch Notes",
      "",
      "## Final Version Reviewed",
      "",
      "final-v1",
      "",
      "## Watch Date",
      "",
      "2026-05-11",
      "",
      "## Reviewer",
      "",
      "Mikko",
      "",
      "## Final-Watch Issues",
      "",
      "None.",
      "",
      "## Publication Blockers",
      "",
      "None.",
      "",
      "- Final approval: PASS",
      "",
    ].join("\n"),
  });

  assert.equal(packageFinalReviewScript.main([runDir]), 0);
  const review = finalReviewText(runDir);
  const blockers = publicationBlockersText(runDir);

  assert.match(review, /Final review status: BLOCKED/);
  assert.match(review, /Publish ready: no/);
  assert.match(review, /Required final-watch sections are not assessed/);
  assert.doesNotMatch(review, /Status: READY TO PUBLISH/);
  assert.match(blockers, /Viewer Promise Delivery is not assessed in final-watch-notes\.md/);
  assert.match(blockers, /Archive Readiness is not assessed in final-watch-notes\.md/);
  assert.match(blockers, /\| blocked \|/);
});

test("final review blocks when publish pack is placeholder draft", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-final-review-publish-draft-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-final-publish-draft");
  writeFinalReviewBaseRun(runDir, {
    finalWatchNotes: `${realFinalWatchNotes()}\n- Final approval: PASS\n`,
    publishPack: "# Publish Pack\n\n## Title\n\nTODO\n\n## Description\n\nDraft placeholder.\n",
  });

  assert.equal(packageFinalReviewScript.main([runDir]), 0);
  const review = finalReviewText(runDir);
  const blockers = publicationBlockersText(runDir);

  assert.match(review, /Final review status: BLOCKED/);
  assert.match(review, /Publish ready: no/);
  assert.match(review, /publish-pack\.md still appears to be placeholder or draft metadata/);
  assert.match(blockers, /placeholder or draft metadata/);
  assert.match(blockers, /\| blocked \|/);
});

test("final review ready to publish requires exact final approval marker", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-final-review-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-final-ready");
  writeFinalReviewBaseRun(runDir, {
    finalWatchNotes: `${realFinalWatchNotes()}\n- Final approval: PASS\n`,
  });

  assert.equal(packageFinalReviewScript.main([runDir]), 0);
  const review = finalReviewText(runDir);
  const blockers = publicationBlockersText(runDir);

  assert.match(review, /Final review status: PASS/);
  assert.match(review, /Publish ready: yes/);
  assert.match(review, /Status: READY TO PUBLISH/);
  assert.match(review, /Final version reviewed: final-v1/);
  assert.match(review, /Watch context: 2026-05-11; reviewer: Mikko/);
  assert.match(blockers, /\| None\. \| All final-review gates passed with real final-watch notes\. \| Keep final approval evidence with the run\. \| closed \|/);
  assert.doesNotMatch(blockers, /\| blocked \|/);
});

test("final review preserves publication blockers unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-final-review-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-final-preserve");
  writeFinalReviewBaseRun(runDir, {
    finalWatchNotes: realFinalWatchNotes(),
  });
  const blockersPath = path.join(runDir, "publication-blockers.md");
  fs.writeFileSync(blockersPath, "# Manual Publication Blockers\n\nKeep this.\n", "utf8");

  const first = captureConsole(() => packageFinalReviewScript.main([runDir]));
  assert.equal(first.result, 0);
  assert.equal(fs.readFileSync(blockersPath, "utf8"), "# Manual Publication Blockers\n\nKeep this.\n");
  assert.match(first.stdout.join("\n"), /unchanged: .*publication-blockers\.md/);

  const overwritten = captureConsole(() => packageFinalReviewScript.main([runDir, "--overwrite"]));
  assert.equal(overwritten.result, 0);
  assert.match(fs.readFileSync(blockersPath, "utf8"), /# Publication Blockers/);
  assert.match(overwritten.stdout.join("\n"), /overwritten: .*publication-blockers\.md/);
});

test("verify script checks final review syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-final-review\.js/);
});

function writeExportChecklistBaseRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  if (options.finalReview !== false) {
    const status = options.finalReviewStatus || "PASS";
    const publishReady = options.publishReady || "yes";
    const gateStatus = options.gateStatus || (status === "PASS" && publishReady === "yes" ? "READY TO PUBLISH" : status);
    fs.writeFileSync(
      path.join(runDir, "final-review.md"),
      [
        "# Final Review",
        "",
        "- Final review status: " + status,
        "- Publish ready: " + publishReady,
        "",
        "## Final Review Gate",
        "",
        "- Status: " + gateStatus,
        "",
      ].join("\n")
    );
  }
  fs.writeFileSync(
    path.join(runDir, "publication-blockers.md"),
    options.openPublicationBlocker
      ? "# Publication Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| Missing export proof. | Blocks upload. | Verify export. | blocked |\n"
      : "# Publication Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Final review gates passed. | Keep evidence. | closed |\n"
  );
}

function writeRealExportArtifacts(runDir) {
  fs.writeFileSync(
    path.join(runDir, "export-checklist.md"),
    [
      "# Export Checklist",
      "",
      "- Final export file: exports/vidtoolz-final-master.mp4",
      "- Codec: H.264",
      "- Container: MP4",
      "- Resolution: 3840x2160",
      "- Frame rate: 30 fps",
      "- Audio settings: AAC 48 kHz stereo",
      "- Captions/subtitles status: Captions reviewed and ready",
      "- Loudness check: -14 LUFS integrated, true peak below -1 dBTP",
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(runDir, "master-file-manifest.md"), "# Master File Manifest\n\n- Master file: exports/vidtoolz-final-master.mp4\n");
  fs.writeFileSync(path.join(runDir, "caption-check.md"), "# Caption Check\n\n- Captions status: Captions reviewed and ready\n");
  fs.writeFileSync(path.join(runDir, "loudness-check.md"), "# Loudness Check\n\n- Loudness result: -14 LUFS integrated\n\nMastering approval: PASS\n");
  fs.writeFileSync(path.join(runDir, "delivery-readiness.md"), "# Delivery Readiness\n\nDelivery approval: PASS\n");
}

function writePlaceholderExportArtifacts(runDir) {
  fs.writeFileSync(path.join(runDir, "export-checklist.md"), "# Export Checklist\n\n- Final export file: TODO\n- Codec: TODO\n");
  fs.writeFileSync(path.join(runDir, "master-file-manifest.md"), "# Master File Manifest\n\n- Master file: placeholder\n");
  fs.writeFileSync(path.join(runDir, "caption-check.md"), "# Caption Check\n\n- Captions status: n/a\n");
  fs.writeFileSync(path.join(runDir, "loudness-check.md"), "# Loudness Check\n\n- Loudness result: TBD\n");
  fs.writeFileSync(path.join(runDir, "delivery-readiness.md"), "# Delivery Readiness\n\nDelivery approval: PASS\n");
}

function exportChecklistText(runDir) {
  return fs.readFileSync(path.join(runDir, "export-checklist.md"), "utf8");
}

test("export checklist help works", () => {
  const output = captureConsole(() => packageExportChecklistScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-export-checklist\.js/);
});

test("export checklist blocks missing final review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-missing-final-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-missing-final");
  writeExportChecklistBaseRun(runDir, { finalReview: false });

  assert.equal(packageExportChecklistScript.main([runDir]), 0);
  const checklist = exportChecklistText(runDir);

  assert.match(checklist, /Export checklist status: BLOCKED/);
  assert.match(checklist, /final-review\.md is missing/);
});

test("export checklist blocks final review blocked", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-final-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-final-blocked");
  writeExportChecklistBaseRun(runDir, { finalReviewStatus: "BLOCKED", publishReady: "no", gateStatus: "BLOCKED" });

  assert.equal(packageExportChecklistScript.main([runDir]), 0);
  assert.match(exportChecklistText(runDir), /Export checklist status: BLOCKED/);
  assert.match(exportChecklistText(runDir), /final-review\.md is BLOCKED/);
});

test("export checklist blocks final review needs final fixes", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-final-fixes-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-final-fixes");
  writeExportChecklistBaseRun(runDir, { finalReviewStatus: "NEEDS FINAL FIXES", publishReady: "no", gateStatus: "NEEDS FINAL FIXES" });

  assert.equal(packageExportChecklistScript.main([runDir]), 0);
  assert.match(exportChecklistText(runDir), /Export checklist status: BLOCKED/);
  assert.match(exportChecklistText(runDir), /NEEDS FINAL FIXES/);
});

test("export checklist blocks open publication blockers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-open-blockers-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-open-blockers");
  writeExportChecklistBaseRun(runDir, { openPublicationBlocker: true });

  assert.equal(packageExportChecklistScript.main([runDir]), 0);
  assert.match(exportChecklistText(runDir), /Export checklist status: BLOCKED/);
  assert.match(exportChecklistText(runDir), /publication-blockers\.md has open or blocked rows/);
});

test("export checklist creates starter artifacts and needs export check after passing final review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-needs-check-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-needs-check");
  writeExportChecklistBaseRun(runDir);

  assert.equal(packageExportChecklistScript.main([runDir]), 0);
  const checklist = exportChecklistText(runDir);

  assert.match(checklist, /Export checklist status: NEEDS EXPORT CHECK/);
  assert.match(checklist, /final export file path\/name is missing/);
  ["master-file-manifest.md", "caption-check.md", "loudness-check.md", "delivery-readiness.md"].forEach((filename) => {
    assert.equal(fs.existsSync(path.join(runDir, filename)), true);
  });
});

test("export checklist does not pass placeholder export metadata", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-placeholder-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-placeholder");
  writeExportChecklistBaseRun(runDir);
  writePlaceholderExportArtifacts(runDir);

  assert.equal(packageExportChecklistScript.main([runDir, "--overwrite"]), 0);
  const checklist = exportChecklistText(runDir);

  assert.match(checklist, /Export checklist status: NEEDS EXPORT CHECK/);
  assert.doesNotMatch(checklist, /READY TO UPLOAD/);
});

test("export checklist can mark ready to upload with real metadata and exact delivery approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-ready");
  writeExportChecklistBaseRun(runDir);
  writeRealExportArtifacts(runDir);

  assert.equal(packageExportChecklistScript.main([runDir, "--overwrite"]), 0);
  const checklist = exportChecklistText(runDir);

  assert.match(checklist, /Export checklist status: READY TO UPLOAD/);
  assert.match(checklist, /Ready to upload: yes/);
  packageExportChecklistScript.TARGET_FILES.forEach((filename) => {
    const artifact = fs.readFileSync(path.join(runDir, filename), "utf8");
    assert.doesNotMatch(artifact, /\bTODO\b/);
    assert.doesNotMatch(artifact, /\|\s*(?:open|blocked)\s*\|/i);
  });
});

test("export checklist preserves existing manual files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-preserve");
  writeExportChecklistBaseRun(runDir);
  const checklistPath = path.join(runDir, "export-checklist.md");
  fs.writeFileSync(checklistPath, "# Manual Export Checklist\n\nKeep this.\n", "utf8");

  const output = captureConsole(() => packageExportChecklistScript.main([runDir]));

  assert.equal(output.result, 0);
  assert.equal(fs.readFileSync(checklistPath, "utf8"), "# Manual Export Checklist\n\nKeep this.\n");
  assert.match(output.stdout.join("\n"), /unchanged: .*export-checklist\.md/);
});

test("export checklist overwrite replaces generated files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-overwrite-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-overwrite");
  writeExportChecklistBaseRun(runDir);
  const manifestPath = path.join(runDir, "master-file-manifest.md");
  fs.writeFileSync(manifestPath, "# Manual Manifest\n\nReplace me.\n", "utf8");

  const output = captureConsole(() => packageExportChecklistScript.main([runDir, "--overwrite"]));

  assert.equal(output.result, 0);
  assert.match(fs.readFileSync(manifestPath, "utf8"), /# Master File Manifest/);
  assert.match(output.stdout.join("\n"), /overwritten: .*master-file-manifest\.md/);
});

test("verify script checks export checklist syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-export-checklist\.js/);
});

function writePublicationMetadataBaseRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  if (options.finalReview !== false) {
    const status = options.finalReviewStatus || "PASS";
    const publishReady = options.publishReady || "yes";
    const gateStatus = options.gateStatus || (status === "PASS" && publishReady === "yes" ? "READY TO PUBLISH" : status);
    fs.writeFileSync(
      path.join(runDir, "final-review.md"),
      [
        "# Final Review",
        "",
        "- Final review status: " + status,
        "- Publish ready: " + publishReady,
        "",
        "## Final Review Gate",
        "",
        "- Status: " + gateStatus,
        "",
      ].join("\n")
    );
  }
  fs.writeFileSync(
    path.join(runDir, "publication-blockers.md"),
    options.openPublicationBlocker
      ? "# Publication Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| Missing metadata proof. | Blocks scheduling. | Fix metadata. | open |\n"
      : "# Publication Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Final review gates passed. | Keep evidence. | closed |\n"
  );
  if (options.exportReady !== false) {
    fs.writeFileSync(path.join(runDir, "delivery-readiness.md"), "# Delivery Readiness\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n");
  }
  if (options.publishPack !== false) {
    fs.writeFileSync(
      path.join(runDir, "publish-pack.md"),
      [
        "# Publish Pack",
        "",
        "- Title: Final VIDTOOLZ Package Run",
        "- Thumbnail path: thumbnails/final-package-run.png",
        "- Description: A practical VIDTOOLZ walkthrough for validating package runs before publishing.",
        "- Chapters: 00:00 Hook; 01:10 Proof; 05:30 Workflow; 09:00 Payoff",
        "- Schedule/release timing: 2026-05-15 16:00 Europe/Helsinki",
        "",
        "Publication metadata approval: PASS",
        "",
      ].join("\n")
    );
  }
}

function writePlaceholderPublishPack(runDir) {
  fs.writeFileSync(
    path.join(runDir, "publish-pack.md"),
    "# Publish Pack\n\n- Title: TODO\n- Thumbnail path: placeholder\n- Description: TBD\n- Chapters: TODO\n- Schedule/release timing: TODO\n"
  );
}

function publishMetadataReviewText(runDir) {
  return fs.readFileSync(path.join(runDir, "publish-metadata-review.md"), "utf8");
}

test("publication metadata help works", () => {
  const output = captureConsole(() => packagePublicationMetadataScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-publication-metadata\.js/);
});

test("publication metadata blocks missing final review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-missing-final-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-missing-final");
  writePublicationMetadataBaseRun(runDir, { finalReview: false });

  assert.equal(packagePublicationMetadataScript.main([runDir]), 0);
  const review = publishMetadataReviewText(runDir);

  assert.match(review, /Publication metadata status: BLOCKED/);
  assert.match(review, /final-review\.md is missing/);
});

test("publication metadata blocks final review not publish ready", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-final-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-final-blocked");
  writePublicationMetadataBaseRun(runDir, { finalReviewStatus: "NEEDS FINAL FIXES", publishReady: "no", gateStatus: "NEEDS FINAL FIXES" });

  assert.equal(packagePublicationMetadataScript.main([runDir]), 0);
  const review = publishMetadataReviewText(runDir);

  assert.match(review, /Publication metadata status: BLOCKED/);
  assert.match(review, /NEEDS FINAL FIXES/);
});

test("publication metadata blocks open publication blockers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-open-blockers-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-open-blockers");
  writePublicationMetadataBaseRun(runDir, { openPublicationBlocker: true });

  assert.equal(packagePublicationMetadataScript.main([runDir]), 0);
  assert.match(publishMetadataReviewText(runDir), /Publication metadata status: BLOCKED/);
  assert.match(publishMetadataReviewText(runDir), /publication-blockers\.md has open or blocked rows/);
});

test("publication metadata missing publish pack needs metadata", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-missing-pack-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-missing-pack");
  writePublicationMetadataBaseRun(runDir, { publishPack: false });

  assert.equal(packagePublicationMetadataScript.main([runDir]), 0);
  const review = publishMetadataReviewText(runDir);

  assert.match(review, /Publication metadata status: NEEDS METADATA/);
  assert.match(review, /publish-pack\.md is missing/);
  ["title-check.md", "thumbnail-check.md", "description-check.md", "chapters-check.md", "schedule-check.md"].forEach((filename) => {
    assert.equal(fs.existsSync(path.join(runDir, filename)), true);
  });
});

test("publication metadata blocks placeholder title description and thumbnail", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-placeholder-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-placeholder");
  writePublicationMetadataBaseRun(runDir);
  writePlaceholderPublishPack(runDir);

  assert.equal(packagePublicationMetadataScript.main([runDir, "--overwrite"]), 0);
  const review = publishMetadataReviewText(runDir);

  assert.match(review, /Publication metadata status: NEEDS METADATA/);
  assert.match(review, /title is missing or placeholder/);
  assert.match(review, /thumbnail path or thumbnail approval is missing or placeholder/);
  assert.match(review, /description is missing or placeholder/);
});

test("publication metadata requires chapters unless waived with reason", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-chapters-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-chapters");
  writePublicationMetadataBaseRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "publish-pack.md"),
    "# Publish Pack\n\n- Title: Final VIDTOOLZ Package Run\n- Thumbnail path: thumbnails/final.png\n- Description: Ready description.\n- Schedule/release timing: 2026-05-15 16:00\n\nPublication metadata approval: PASS\n"
  );

  assert.equal(packagePublicationMetadataScript.main([runDir, "--overwrite"]), 0);
  assert.match(publishMetadataReviewText(runDir), /chapters are missing or not explicitly waived with a reason/);

  fs.writeFileSync(
    path.join(runDir, "publish-pack.md"),
    "# Publish Pack\n\n- Title: Final VIDTOOLZ Package Run\n- Thumbnail path: thumbnails/final.png\n- Description: Ready description.\n- Chapters: not needed - short update under chapter threshold\n- Schedule/release timing: 2026-05-15 16:00\n\nPublication metadata approval: PASS\n"
  );
  assert.equal(packagePublicationMetadataScript.main([runDir, "--overwrite"]), 0);
  assert.doesNotMatch(publishMetadataReviewText(runDir), /chapters are missing or not explicitly waived/);
});

test("publication metadata requires schedule unless deferred with reason", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-schedule-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-schedule");
  writePublicationMetadataBaseRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "publish-pack.md"),
    "# Publish Pack\n\n- Title: Final VIDTOOLZ Package Run\n- Thumbnail path: thumbnails/final.png\n- Description: Ready description.\n- Chapters: 00:00 Hook\n\nPublication metadata approval: PASS\n"
  );

  assert.equal(packagePublicationMetadataScript.main([runDir, "--overwrite"]), 0);
  assert.match(publishMetadataReviewText(runDir), /schedule\/release timing is missing or not explicitly deferred with a reason/);

  fs.writeFileSync(
    path.join(runDir, "publish-pack.md"),
    "# Publish Pack\n\n- Title: Final VIDTOOLZ Package Run\n- Thumbnail path: thumbnails/final.png\n- Description: Ready description.\n- Chapters: 00:00 Hook\n- Schedule/release timing: deferred - waiting for sponsor confirmation\n\nPublication metadata approval: PASS\n"
  );
  assert.equal(packagePublicationMetadataScript.main([runDir, "--overwrite"]), 0);
  assert.doesNotMatch(publishMetadataReviewText(runDir), /schedule\/release timing is missing/);
});

test("publication metadata keeps approval marker separate from schedule evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-schedule-marker-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-schedule-marker");
  writePublicationMetadataBaseRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "publish-pack.md"),
    [
      "# Publish Pack",
      "",
      "- Title: Final VIDTOOLZ Package Run",
      "- Thumbnail path: thumbnails/final.png",
      "- Description: Ready description.",
      "- Chapters: 00:00 Hook",
      "",
      "## Schedule",
      "",
      "2026-05-15 16:00 Europe/Helsinki",
      "",
      "Metadata approval: PASS",
      "",
    ].join("\n")
  );

  assert.equal(packagePublicationMetadataScript.main([runDir, "--overwrite"]), 0);
  const context = packagePublicationMetadataScript.readContext(runDir);

  assert.equal(context.metadata.schedule, "2026-05-15 16:00 Europe/Helsinki");
  assert.equal(context.metadataApproval, true);
  assert.doesNotMatch(context.metadata.schedule, /Metadata approval: PASS/);
});

test("publication metadata renders multiline chapters safely in tables", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-multiline-chapters-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-multiline-chapters");
  writePublicationMetadataBaseRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "publish-pack.md"),
    [
      "# Publish Pack",
      "",
      "- Title: Final VIDTOOLZ Package Run",
      "- Thumbnail path: thumbnails/final.png",
      "- Description: Ready description.",
      "- Schedule/release timing: 2026-05-15 16:00 Europe/Helsinki",
      "",
      "## Chapters",
      "",
      "00:00 Hook",
      "01:00 Proof",
      "02:00 Payoff",
      "",
      "Publication metadata approval: PASS",
      "",
    ].join("\n")
  );

  assert.equal(packagePublicationMetadataScript.main([runDir, "--overwrite"]), 0);
  const review = publishMetadataReviewText(runDir);
  const chaptersCheck = fs.readFileSync(path.join(runDir, "chapters-check.md"), "utf8");

  assert.match(review, /\| Chapters \| 00:00 Hook \/ 01:00 Proof \/ 02:00 Payoff \| closed \|/);
  assert.match(chaptersCheck, /\| Chapters recorded \| 00:00 Hook \/ 01:00 Proof \/ 02:00 Payoff \| closed \|/);
  assert.doesNotMatch(review, /\| Chapters \| 00:00 Hook\r?\n/);
  assert.doesNotMatch(chaptersCheck, /\| Chapters recorded \| 00:00 Hook\r?\n/);
});

test("publication metadata can mark ready to schedule with real metadata and exact approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-ready");
  writePublicationMetadataBaseRun(runDir);

  assert.equal(packagePublicationMetadataScript.main([runDir, "--overwrite"]), 0);
  const review = publishMetadataReviewText(runDir);

  assert.match(review, /Publication metadata status: READY TO SCHEDULE/);
  assert.match(review, /Ready to schedule: yes/);
  packagePublicationMetadataScript.TARGET_FILES.forEach((filename) => {
    const artifact = fs.readFileSync(path.join(runDir, filename), "utf8");
    assert.doesNotMatch(artifact, /\bTODO\b/);
    assert.doesNotMatch(artifact, /\|\s*(?:open|blocked)\s*\|/i);
  });
});

test("publication metadata preserves existing manual artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-preserve");
  writePublicationMetadataBaseRun(runDir);
  const reviewPath = path.join(runDir, "publish-metadata-review.md");
  fs.writeFileSync(reviewPath, "# Manual Metadata Review\n\nKeep this.\n", "utf8");

  const output = captureConsole(() => packagePublicationMetadataScript.main([runDir]));

  assert.equal(output.result, 0);
  assert.equal(fs.readFileSync(reviewPath, "utf8"), "# Manual Metadata Review\n\nKeep this.\n");
  assert.match(output.stdout.join("\n"), /unchanged: .*publish-metadata-review\.md/);
});

test("publication metadata overwrite replaces generated files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-metadata-overwrite-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-metadata-overwrite");
  writePublicationMetadataBaseRun(runDir);
  const titlePath = path.join(runDir, "title-check.md");
  fs.writeFileSync(titlePath, "# Manual Title Check\n\nReplace me.\n", "utf8");

  const output = captureConsole(() => packagePublicationMetadataScript.main([runDir, "--overwrite"]));

  assert.equal(output.result, 0);
  assert.match(fs.readFileSync(titlePath, "utf8"), /# Title Check/);
  assert.match(output.stdout.join("\n"), /overwritten: .*title-check\.md/);
});

test("verify script checks publication metadata syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-publication-metadata\.js/);
});

function writeArchiveBaseRun(runDir, options = {}) {
  writePublicationMetadataBaseRun(runDir, {
    finalReview: options.finalReview,
    finalReviewStatus: options.finalReviewStatus,
    publishReady: options.publishReady,
    gateStatus: options.gateStatus,
    openPublicationBlocker: options.openPublicationBlocker,
    exportReady: options.exportReady,
  });
  if (options.exportReady === false) {
    fs.writeFileSync(path.join(runDir, "delivery-readiness.md"), "# Delivery Readiness\n\n- Export checklist status: NEEDS EXPORT CHECK\n- Ready to upload: no\n");
  }
  if (options.metadataReady !== false) {
    fs.writeFileSync(
      path.join(runDir, "publish-metadata-review.md"),
      "# Publish Metadata Review\n\n- Publication metadata status: READY TO SCHEDULE\n- Ready to schedule: yes\n"
    );
  } else {
    fs.writeFileSync(
      path.join(runDir, "publish-metadata-review.md"),
      "# Publish Metadata Review\n\n- Publication metadata status: NEEDS METADATA\n- Ready to schedule: no\n"
    );
  }
  if (options.publicationEvidence !== false) {
    fs.appendFileSync(path.join(runDir, "publish-pack.md"), "\nPublication status: PUBLISHED\nPublished URL: https://youtube.example/watch?v=vidtoolz\n");
  }
}

function writeArchiveReadyArtifacts(runDir, options = {}) {
  const checksum = options.checksum || "waived - local archive volume is manually verified";
  const manifestLines = [
    "# Archive Manifest",
    "",
    "- Final master export: exports/final-master.mp4",
    "- Source project path: projects/vidtoolz-package-run",
    "- Editing project file: projects/vidtoolz-package-run/project.drp",
    "- Thumbnail file: thumbnails/final.png",
    "- Caption file: captions/final.srt",
    "- Publish metadata: publish-pack.md",
    "- Reusable clips decision: none - no standalone clips identified because the episode depends on full context",
  ];
  if (options.topLevelChecksum !== false) {
    manifestLines.push(`- Checksum/status: ${checksum}`);
  }
  manifestLines.push("", "Archive approval: PASS", "");
  fs.writeFileSync(
    path.join(runDir, "archive-manifest.md"),
    manifestLines.join("\n")
  );
  fs.writeFileSync(
    path.join(runDir, "archive-source-files.md"),
    `# Archive Source Files\n\n| source item | path/reference | why preserve | checksum/status | archive status |\n| --- | --- | --- | --- | --- |\n| editing project | projects/vidtoolz-package-run/project.drp | Preserve edit state. | ${checksum} | closed |\n| project folder | projects/vidtoolz-package-run | Preserve source. | ${checksum} | closed |\n`
  );
  fs.writeFileSync(
    path.join(runDir, "archive-assets-manifest.md"),
    "# Archive Assets Manifest\n\n| asset | source/path | usage in video | rights/provenance note | archive status |\n| --- | --- | --- | --- | --- |\n| thumbnails | thumbnails/final.png | Upload thumbnail. | Original local design. | closed |\n| captions/subtitles | captions/final.srt | Accessibility. | Manual export. | closed |\n"
  );
  fs.writeFileSync(
    path.join(runDir, "archive-export-manifest.md"),
    `# Archive Export Manifest\n\n| export item | path/reference | format/details | checksum/status | archive status |\n| --- | --- | --- | --- | --- |\n| final master export | exports/final-master.mp4 | H.264 MP4 4K | ${checksum} | closed |\n| publish metadata | publish-pack.md | title description chapters schedule | recorded | closed |\n`
  );
  fs.writeFileSync(
    path.join(runDir, "reusable-clips-manifest.md"),
    "# Reusable Clips Manifest\n\n| reusable clip/moment | source/timecode | reuse purpose | rights/context risk | status |\n| --- | --- | --- | --- | --- |\n| none - no standalone clips identified because the episode depends on full context | n/a | archive decision | no reuse risk | closed |\n"
  );
  fs.writeFileSync(
    path.join(runDir, "archive-blockers.md"),
    "# Archive Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Archive readiness gates passed. | Keep archive evidence. | closed |\n"
  );
}

function archiveManifestText(runDir) {
  return fs.readFileSync(path.join(runDir, "archive-manifest.md"), "utf8");
}

test("archive manifest help works", () => {
  const output = captureConsole(() => packageArchiveManifestScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-archive-manifest\.js/);
});

test("archive manifest blocks missing final review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-missing-final-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-missing-final");
  writeArchiveBaseRun(runDir, { finalReview: false });

  assert.equal(packageArchiveManifestScript.main([runDir]), 0);

  assert.match(archiveManifestText(runDir), /Archive manifest status: BLOCKED/);
  assert.match(archiveManifestText(runDir), /final-review\.md is missing/);
});

test("archive manifest blocks final review blocked", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-final-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-final-blocked");
  writeArchiveBaseRun(runDir, { finalReviewStatus: "BLOCKED", publishReady: "no", gateStatus: "BLOCKED" });

  assert.equal(packageArchiveManifestScript.main([runDir]), 0);

  assert.match(archiveManifestText(runDir), /Archive manifest status: BLOCKED/);
  assert.match(archiveManifestText(runDir), /BLOCKED/);
});

test("archive manifest blocks open publication blockers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-open-publication-blockers-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-open-publication-blockers");
  writeArchiveBaseRun(runDir, { openPublicationBlocker: true });

  assert.equal(packageArchiveManifestScript.main([runDir]), 0);

  assert.match(archiveManifestText(runDir), /publication-blockers\.md has open or blocked rows/);
});

test("archive manifest blocks publish metadata not ready when present", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-metadata-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-metadata-blocked");
  writeArchiveBaseRun(runDir, { metadataReady: false });

  assert.equal(packageArchiveManifestScript.main([runDir]), 0);

  assert.match(archiveManifestText(runDir), /publish-metadata-review\.md is NEEDS METADATA/);
});

test("archive manifest blocks export readiness not ready when present", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-export-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-export-blocked");
  writeArchiveBaseRun(runDir, { exportReady: false });

  assert.equal(packageArchiveManifestScript.main([runDir]), 0);

  assert.match(archiveManifestText(runDir), /Export readiness is NEEDS EXPORT CHECK/);
});

test("archive manifest blocks missing publication evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-no-publication-evidence-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-no-publication-evidence");
  writeArchiveBaseRun(runDir, { publicationEvidence: false });

  assert.equal(packageArchiveManifestScript.main([runDir]), 0);

  assert.match(archiveManifestText(runDir), /publication evidence is missing/);
});

test("archive manifest creates starter artifacts and needs archive data", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-needs-data-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-needs-data");
  writeArchiveBaseRun(runDir);

  assert.equal(packageArchiveManifestScript.main([runDir]), 0);
  const manifest = archiveManifestText(runDir);

  assert.match(manifest, /Archive manifest status: NEEDS ARCHIVE DATA/);
  packageArchiveManifestScript.TARGET_FILES.forEach((filename) => {
    assert.equal(fs.existsSync(path.join(runDir, filename)), true);
  });
});

test("archive manifest placeholder archive data does not pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-placeholder-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-placeholder");
  writeArchiveBaseRun(runDir);
  packageArchiveManifestScript.TARGET_FILES.forEach((filename) => fs.writeFileSync(path.join(runDir, filename), `# ${filename}\n\nTODO\n`));
  fs.appendFileSync(path.join(runDir, "archive-manifest.md"), "\nArchive approval: PASS\n");

  assert.equal(packageArchiveManifestScript.main([runDir, "--overwrite"]), 0);

  assert.match(archiveManifestText(runDir), /Archive manifest status: NEEDS ARCHIVE DATA/);
  assert.match(archiveManifestText(runDir), /final export\/master file path is missing/);
});

test("archive approval alone does not override missing required archive data", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-approval-alone-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-approval-alone");
  writeArchiveBaseRun(runDir);
  fs.writeFileSync(path.join(runDir, "archive-manifest.md"), "# Archive Manifest\n\nArchive approval: PASS\n");

  assert.equal(packageArchiveManifestScript.main([runDir, "--overwrite"]), 0);

  assert.match(archiveManifestText(runDir), /Archive manifest status: NEEDS ARCHIVE DATA/);
  assert.match(archiveManifestText(runDir), /source project path is missing/);
});

test("archive manifest can mark ready to archive with real data and exact approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-ready");
  writeArchiveBaseRun(runDir);
  writeArchiveReadyArtifacts(runDir);

  const output = captureConsole(() => packageArchiveManifestScript.main([runDir, "--overwrite"]));
  const manifest = archiveManifestText(runDir);

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /archive manifest: READY TO ARCHIVE/);
  assert.match(manifest, /Archive manifest status: READY TO ARCHIVE/);
  assert.match(manifest, /Ready to archive: yes/);
  packageArchiveManifestScript.TARGET_FILES.forEach((filename) => {
    const artifact = fs.readFileSync(path.join(runDir, filename), "utf8");
    assert.doesNotMatch(artifact, /\bTODO\b/);
    assert.doesNotMatch(artifact, /\|\s*(?:open|blocked)\s*\|/i);
  });
});

test("archive manifest accepts checksum waiver evidence from dedicated tables", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-table-checksum-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-table-checksum");
  writeArchiveBaseRun(runDir);
  writeArchiveReadyArtifacts(runDir, {
    topLevelChecksum: false,
    checksum: "checksum waived - local project archive only",
  });

  const output = captureConsole(() => packageArchiveManifestScript.main([runDir, "--overwrite"]));
  const manifest = archiveManifestText(runDir);

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /archive manifest: READY TO ARCHIVE/);
  assert.match(manifest, /Archive manifest status: READY TO ARCHIVE/);
  assert.match(manifest, /Ready to archive: yes/);
  assert.match(manifest, /checksum waived - local project archive only/);
  packageArchiveManifestScript.TARGET_FILES.forEach((filename) => {
    const artifact = fs.readFileSync(path.join(runDir, filename), "utf8");
    assert.doesNotMatch(artifact, /\bTODO\b/);
    assert.doesNotMatch(artifact, /\|\s*(?:open|blocked)\s*\|/i);
  });
});

test("archive manifest ignores stale generated archive blockers when current inputs are complete", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-stale-generated-blockers-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-stale-generated-blockers");
  writeArchiveBaseRun(runDir);
  writeArchiveReadyArtifacts(runDir, {
    topLevelChecksum: false,
    checksum: "checksum waived - manual file check passed",
  });
  fs.writeFileSync(
    path.join(runDir, "archive-blockers.md"),
    "# Archive Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| publish metadata reference is missing. | Blocks archive readiness. | Record or resolve this archive evidence. | blocked |\n| reusable clips/cutdown decision is missing or not reviewed. | Blocks archive readiness. | Record or resolve this archive evidence. | blocked |\n",
    "utf8"
  );

  const output = captureConsole(() => packageArchiveManifestScript.main([runDir, "--overwrite"]));
  const blockers = fs.readFileSync(path.join(runDir, "archive-blockers.md"), "utf8");

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /archive manifest: READY TO ARCHIVE/);
  assert.match(archiveManifestText(runDir), /Archive manifest status: READY TO ARCHIVE/);
  assert.match(blockers, /\| None\. \| Archive readiness gates passed\. \| Keep archive evidence with the run\. \| closed \|/);
  assert.doesNotMatch(blockers, /Blocks archive readiness/);
  assert.doesNotMatch(blockers, /\|\s*blocked\s*\|/i);
});

test("archive manifest generated fallback rows do not accumulate across overwrite reruns", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-idempotent-fallback-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-idempotent-fallback");
  writeArchiveBaseRun(runDir);

  assert.equal(packageArchiveManifestScript.main([runDir, "--overwrite"]), 0);
  assert.equal(packageArchiveManifestScript.main([runDir, "--overwrite"]), 0);

  const sourceFiles = fs.readFileSync(path.join(runDir, "archive-source-files.md"), "utf8");
  const exportManifest = fs.readFileSync(path.join(runDir, "archive-export-manifest.md"), "utf8");
  const manifest = archiveManifestText(runDir);

  assert.match(manifest, /Archive manifest status: NEEDS ARCHIVE DATA/);
  assert.doesNotMatch(sourceFiles, /Preserve complete episode working folder\. \//);
  assert.doesNotMatch(exportManifest, /See export-checklist\.md or delivery-readiness\.md\. \//);
  assert.doesNotMatch(manifest, /Blocks archive readiness\. \//);
});

test("archive manifest preserves existing artifacts unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-preserve");
  writeArchiveBaseRun(runDir);
  const manifestPath = path.join(runDir, "archive-manifest.md");
  fs.writeFileSync(manifestPath, "# Manual Archive Manifest\n\nKeep this.\n");

  const output = captureConsole(() => packageArchiveManifestScript.main([runDir]));

  assert.equal(output.result, 0);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), "# Manual Archive Manifest\n\nKeep this.\n");
  assert.match(output.stdout.join("\n"), /unchanged: .*archive-manifest\.md/);
});

test("archive manifest overwrite replaces generated artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-archive-overwrite-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-archive-overwrite");
  writeArchiveBaseRun(runDir);
  const sourcePath = path.join(runDir, "archive-source-files.md");
  fs.writeFileSync(sourcePath, "# Manual Source Manifest\n\nReplace me.\n");

  const output = captureConsole(() => packageArchiveManifestScript.main([runDir, "--overwrite"]));

  assert.equal(output.result, 0);
  assert.match(fs.readFileSync(sourcePath, "utf8"), /# Archive Source Files/);
  assert.match(output.stdout.join("\n"), /overwritten: .*archive-source-files\.md/);
});

test("verify script checks archive manifest syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-archive-manifest\.js/);
});

function writeRepurposeBaseRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Repurposing Package",
        viewerPromise: "The viewer can turn one approved episode into useful shorts.",
      },
    })
  );
  if (options.finalReview !== false) {
    fs.writeFileSync(
      path.join(runDir, "final-review.md"),
      [
        "# Final Review",
        "",
        "- Final review status: " + (options.finalReviewStatus || "PASS"),
        "- Publish ready: " + (options.publishReady || "yes"),
        "",
        "## Final Review Gate",
        "",
        "- Status: " + (options.finalReviewStatus || "PASS"),
        "",
      ].join("\n")
    );
  }
  if (options.publicationBlockers !== false) {
    fs.writeFileSync(
      path.join(runDir, "publication-blockers.md"),
      options.openPublicationBlocker
        ? "# Publication Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| Missing final proof. | Blocks clips. | Fix the final proof. | blocked |\n"
        : "# Publication Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | All final-review gates passed with real final-watch notes. | Keep final approval evidence with the run. | closed |\n"
    );
  }
  if (options.source === "none") return;
  if (options.source === "draft") {
    fs.writeFileSync(path.join(runDir, "script-draft.md"), "# Script Draft\n\nThis draft-only source should not approve shorts by itself.\n");
    return;
  }
  if (options.source === "transcript") {
    fs.writeFileSync(
      path.join(runDir, "transcript.md"),
      "# Transcript\n\nThis is a self-contained moment about checking final approval before repurposing clips.\n"
    );
    return;
  }
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    "# Final Script\n\nThis is a self-contained moment about turning an approved long-form video into shorts without losing context.\n"
  );
}

function repurposingPlanText(runDir) {
  return fs.readFileSync(path.join(runDir, "repurposing-plan.md"), "utf8");
}

function shortsCandidatesText(runDir) {
  return fs.readFileSync(path.join(runDir, "shorts-candidates.md"), "utf8");
}

function platformVariantsText(runDir) {
  return fs.readFileSync(path.join(runDir, "platform-variants.md"), "utf8");
}

test("repurposing help works", () => {
  const output = captureConsole(() => packageRepurposeScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-repurpose\.js/);
});

test("repurposing blocks missing final review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-repurpose-missing-final-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-repurpose-missing-final");
  writeRepurposeBaseRun(runDir, { finalReview: false });

  assert.equal(packageRepurposeScript.main([runDir]), 0);
  const plan = repurposingPlanText(runDir);
  const shorts = shortsCandidatesText(runDir);

  assert.match(plan, /Repurposing status: BLOCKED/);
  assert.match(plan, /Ready to cut shorts: no/);
  assert.match(plan, /final-review\.md is missing/);
  assert.match(shorts, /Not assessed/);
  assert.match(shorts, /\| blocked \|/);
});

test("repurposing blocks final review blocked", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-repurpose-final-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-repurpose-final-blocked");
  writeRepurposeBaseRun(runDir, { finalReviewStatus: "BLOCKED", publishReady: "no", openPublicationBlocker: true });

  assert.equal(packageRepurposeScript.main([runDir]), 0);
  const plan = repurposingPlanText(runDir);

  assert.match(plan, /Repurposing status: BLOCKED/);
  assert.match(plan, /Final review status is BLOCKED/);
  assert.match(plan, /Publish ready is no/);
  assert.match(plan, /publication-blockers\.md has open or blocked rows/);
});

test("repurposing blocks publish ready no", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-repurpose-publish-no-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-repurpose-publish-no");
  writeRepurposeBaseRun(runDir, { publishReady: "no" });

  assert.equal(packageRepurposeScript.main([runDir]), 0);
  const plan = repurposingPlanText(runDir);

  assert.match(plan, /Repurposing status: NEEDS FINAL APPROVAL/);
  assert.match(plan, /Publish ready is no/);
  assert.doesNotMatch(plan, /Status: READY TO CUT SHORTS/);
});

test("repurposing blocks open publication blockers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-repurpose-open-blockers-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-repurpose-open-blockers");
  writeRepurposeBaseRun(runDir, { openPublicationBlocker: true });

  assert.equal(packageRepurposeScript.main([runDir]), 0);
  const plan = repurposingPlanText(runDir);

  assert.match(plan, /Repurposing status: NEEDS FINAL APPROVAL/);
  assert.match(plan, /publication-blockers\.md has open or blocked rows/);
});

test("repurposing needs transcript or final script when source is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-repurpose-no-source-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-repurpose-no-source");
  writeRepurposeBaseRun(runDir, { source: "none" });

  assert.equal(packageRepurposeScript.main([runDir]), 0);
  const plan = repurposingPlanText(runDir);

  assert.match(plan, /Repurposing status: NEEDS TRANSCRIPT/);
  assert.match(plan, /transcript\.md or final-script\.md is missing/);
});

test("repurposing draft-only source does not allow ready", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-repurpose-draft-only-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-repurpose-draft-only");
  writeRepurposeBaseRun(runDir, { source: "draft" });

  assert.equal(packageRepurposeScript.main([runDir]), 0);
  const plan = repurposingPlanText(runDir);

  assert.match(plan, /Repurposing status: NEEDS TRANSCRIPT/);
  assert.match(plan, /Only script-draft\.md is available as source material/);
  assert.doesNotMatch(plan, /Status: READY TO CUT SHORTS/);
});

test("repurposing can mark ready only when final gates and source pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-repurpose-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-repurpose-ready");
  writeRepurposeBaseRun(runDir, { source: "transcript" });

  assert.equal(packageRepurposeScript.main([runDir]), 0);
  const plan = repurposingPlanText(runDir);
  const shorts = shortsCandidatesText(runDir);
  const variants = platformVariantsText(runDir);

  assert.match(plan, /Repurposing status: READY TO CUT SHORTS/);
  assert.match(plan, /Ready to cut shorts: yes/);
  assert.match(shorts, /self-contained moment/);
  assert.match(variants, /Status: open/);
});

test("repurposing preserves existing artifacts unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-repurpose-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-repurpose-preserve");
  writeRepurposeBaseRun(runDir);
  const planPath = path.join(runDir, "repurposing-plan.md");
  fs.writeFileSync(planPath, "# Manual Repurposing Plan\n\nKeep this.\n", "utf8");

  const first = captureConsole(() => packageRepurposeScript.main([runDir]));
  assert.equal(first.result, 0);
  assert.equal(fs.readFileSync(planPath, "utf8"), "# Manual Repurposing Plan\n\nKeep this.\n");
  assert.match(first.stdout.join("\n"), /unchanged: .*repurposing-plan\.md/);
  assert.match(first.stdout.join("\n"), /created: .*shorts-candidates\.md/);

  const overwritten = captureConsole(() => packageRepurposeScript.main([runDir, "--overwrite"]));
  assert.equal(overwritten.result, 0);
  assert.match(fs.readFileSync(planPath, "utf8"), /# Repurposing Plan/);
  assert.match(overwritten.stdout.join("\n"), /overwritten: .*repurposing-plan\.md/);
});

test("verify script checks repurposing syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-repurpose\.js/);
});

function writeBrollPromptRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  if (options.script !== false) {
    fs.writeFileSync(
      path.join(runDir, options.draftOnly ? "script-draft.md" : "final-script.md"),
      [
        "# Final Script",
        "",
        "Open with a creator comparing raw AI video ideas against a practical scorecard.",
        "Show how generic suggestions lose against a selected package with proof, specificity, and production constraints.",
        "End with the repeatable workflow that keeps taste and positioning human-owned.",
      ].join("\n"),
      "utf8"
    );
  }
  if (options.scriptReview !== false) {
    fs.writeFileSync(
      path.join(runDir, "script-review.md"),
      `# Script Review\n\n- Script review status: ${options.scriptReviewStatus || "PASS"}\n- Production planning ready: yes\n`,
      "utf8"
    );
  }
  if (options.productionPlan !== false) {
    fs.writeFileSync(
      path.join(runDir, "production-plan.md"),
      `# Production Plan\n\n- Shoot-readiness status: ${options.shootReadiness || "READY TO SHOOT"}\n`,
      "utf8"
    );
  }
  fs.writeFileSync(
    path.join(runDir, "b-roll-list.md"),
    "# B-Roll List\n\n| b-roll item | reason | source | status |\n| --- | --- | --- | --- |\n| Scorecard comparison close-up | Show workflow proof. | local capture | closed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "graphics-list.md"),
    "# Graphics List\n\n| graphic | clarity purpose | source/input | status |\n| --- | --- | --- | --- |\n| Before/after idea filter matrix | Clarify selection logic. | script | closed |\n",
    "utf8"
  );
}

function brollPromptPackText(runDir) {
  return fs.readFileSync(path.join(runDir, "broll-prompt-pack.md"), "utf8");
}

function markdownDataRows(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const rows = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (index > start + 1 && /^#/.test(line)) break;
    if (!line.startsWith("|") || /^\|\s*-/.test(line) || /^\|\s*(?:prompt|scene|query|graphic|risk)\b/i.test(line)) continue;
    rows.push(line);
  }
  return rows;
}

test("broll prompt generator help works", () => {
  const output = captureConsole(() => packageBrollPromptsScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-broll-prompts\.js/);
});

test("broll prompt generator blocks missing script", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-missing-script-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-missing-script");
  writeBrollPromptRun(runDir, { script: false });

  assert.equal(packageBrollPromptsScript.main([runDir]), 0);
  const pack = brollPromptPackText(runDir);

  assert.match(pack, /Visual prompt status: BLOCKED/);
  assert.match(pack, /final-script\.md or script-draft\.md is missing/);
});

test("broll prompt generator blocks missing or non-pass script review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-review-blocked-"));
  const missingRun = path.join(tempRoot, "package-runs", "2026-05-10-broll-missing-review");
  const revisionRun = path.join(tempRoot, "package-runs", "2026-05-10-broll-needs-revision");
  writeBrollPromptRun(missingRun, { scriptReview: false });
  writeBrollPromptRun(revisionRun, { scriptReviewStatus: "NEEDS REVISION" });

  assert.equal(packageBrollPromptsScript.main([missingRun]), 0);
  assert.equal(packageBrollPromptsScript.main([revisionRun]), 0);

  assert.match(brollPromptPackText(missingRun), /script-review\.md is missing/);
  assert.match(brollPromptPackText(revisionRun), /Script review status is NEEDS REVISION, not PASS/);
});

test("broll prompt generator blocks non-ready production plan", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-plan-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-plan-blocked");
  writeBrollPromptRun(runDir, { shootReadiness: "BLOCKED" });

  assert.equal(packageBrollPromptsScript.main([runDir]), 0);

  assert.match(brollPromptPackText(runDir), /Visual prompt status: BLOCKED/);
  assert.match(brollPromptPackText(runDir), /Shoot-readiness status is BLOCKED, not READY TO SHOOT/);
});

test("broll prompt generator creates prompt artifacts from approved script and production plan", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-generate-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-generate");
  writeBrollPromptRun(runDir);

  const output = captureConsole(() => packageBrollPromptsScript.main([runDir]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /visual prompt status: NEEDS REVIEW/);
  packageBrollPromptsScript.TARGET_FILES.forEach((filename) => {
    assert.equal(fs.existsSync(path.join(runDir, filename)), true);
  });
  assert.match(brollPromptPackText(runDir), /Visual prompt status: NEEDS REVIEW/);
  assert.match(fs.readFileSync(path.join(runDir, "visual-scene-prompts.md"), "utf8"), /creator comparing raw AI video ideas/);
  assert.match(fs.readFileSync(path.join(runDir, "graphics-prompt-pack.md"), "utf8"), /Before\/after idea filter matrix/);
});

test("broll prompt generator treats selected package json and markdown as alternate inputs", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-selected-json-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-selected-json");
  writeBrollPromptRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "AI video idea filter" } }),
    "utf8"
  );

  assert.equal(packageBrollPromptsScript.main([runDir]), 0);
  const pack = brollPromptPackText(runDir);

  assert.doesNotMatch(pack, /Missing selected-package\.md/);
  assert.doesNotMatch(pack, /Missing selected-package\.json or selected-package\.md/);
});

test("broll prompt generator filters headers placeholders checkboxes and artifact leaks", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-clean-extraction-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-clean-extraction");
  writeBrollPromptRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "b-roll-list.md"),
    [
      "# B-Roll List",
      "",
      "| b-roll item | reason | source | status |",
      "| --- | --- | --- | --- |",
      "| TODO | TODO | TODO | TODO |",
      "| Generic blocked visual | Blocks output. | planning | blocked |",
      "| Generic open visual | Needs work. | planning | open |",
      "| Scorecard proof over the selected package | Demonstrate the filtering workflow. | local capture | closed |",
      "",
      "- [ ] Title and thumbnail assumptions verified",
      "- final-outline.md: present",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "shot-list.md"),
    [
      "# Shot List",
      "",
      "| shot | reason | priority | status |",
      "| --- | --- | --- | --- |",
      "| shot | reason | priority | status |",
      "| Capture scorecard beside selected package | show workflow proof | high | captured |",
      "| Placeholder shot | TODO | high | blocked |",
      "- [x] final-outline.md: present",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "graphics-list.md"),
    [
      "# Graphics List",
      "",
      "| graphic | clarity purpose | source/input | status |",
      "| --- | --- | --- | --- |",
      "| TODO | TODO | TODO | TODO |",
      "| Before and after package scorecard | Explain the decision criteria. | script | reviewed |",
      "- Status: blocked",
      "- External APIs called: no",
    ].join("\n"),
    "utf8"
  );

  assert.equal(packageBrollPromptsScript.main([runDir, "--overwrite"]), 0);
  const combined = packageBrollPromptsScript.TARGET_FILES.map((filename) => fs.readFileSync(path.join(runDir, filename), "utf8")).join("\n");

  assert.match(combined, /Film a concise visual of Scorecard proof over the selected package/);
  assert.match(combined, /content ideation scorecard/);
  assert.match(combined, /Create a scorecard for Before and after package scorecard/);
  assert.doesNotMatch(combined, /b-roll item \/ reason \/ source \/ status/i);
  assert.doesNotMatch(combined, /\| TODO \|/i);
  assert.doesNotMatch(combined, /Title and thumbnail assumptions verified/i);
  assert.doesNotMatch(combined, /final-outline\.md: present/i);
  assert.doesNotMatch(combined, /External APIs called: no.*\|/i);
});

test("broll prompt generator falls back to script when planning rows are placeholders", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-script-fallback-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-script-fallback");
  writeBrollPromptRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    [
      "# Final Script",
      "",
      "- [ ] Title and thumbnail assumptions verified",
      "final-outline.md: present",
      "Open on a creator sorting raw AI video suggestions into a practical scorecard.",
      "Cut to the scorecard rejecting generic ideas while one specific package stays on screen.",
      "Show the selected package becoming a concrete production plan with proof captures and constraints.",
      "Close on the repeatable workflow: AI expands options, but the creator owns taste and positioning.",
    ].join("\n"),
    "utf8"
  );
  ["b-roll-list.md", "graphics-list.md", "shot-list.md", "screen-capture-list.md"].forEach((filename) => {
    fs.writeFileSync(
      path.join(runDir, filename),
      [
        `# ${filename}`,
        "",
        "| item | reason | source | status |",
        "| --- | --- | --- | --- |",
        "| TODO | TODO | TODO | TODO |",
        "| Placeholder planning row | not assessed | planning | open |",
        "| Blocked planning row | blocked until review | planning | blocked |",
      ].join("\n"),
      "utf8"
    );
  });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "AI video idea filter",
        viewerPromise: "Turn raw AI suggestions into one production-ready video package.",
      },
    }),
    "utf8"
  );

  assert.equal(packageBrollPromptsScript.main([runDir, "--overwrite"]), 0);
  const broll = fs.readFileSync(path.join(runDir, "broll-prompt-pack.md"), "utf8");
  const scenes = fs.readFileSync(path.join(runDir, "visual-scene-prompts.md"), "utf8");
  const stock = fs.readFileSync(path.join(runDir, "stock-search-queries.md"), "utf8");
  const graphics = fs.readFileSync(path.join(runDir, "graphics-prompt-pack.md"), "utf8");
  const combined = [broll, scenes, stock, graphics].join("\n");

  assert.equal(markdownDataRows(broll, "## B-Roll Prompts").length >= 3, true);
  assert.equal(markdownDataRows(scenes, "# Visual Scene Prompts").length >= 3, true);
  assert.equal(markdownDataRows(stock, "# Stock Search Queries").length >= 2, true);
  assert.equal(markdownDataRows(graphics, "# Graphics Prompt Pack").length >= 2, true);
  assert.doesNotMatch(combined, /item \/ reason \/ source \/ status/i);
  assert.doesNotMatch(combined, /\| TODO \|/i);
  assert.doesNotMatch(combined, /Title and thumbnail assumptions verified/i);
  assert.doesNotMatch(combined, /final-outline\.md: present/i);
  markdownDataRows(stock, "# Stock Search Queries").forEach((row) => {
    const query = row.split("|")[1].trim();
    assert.equal(query.split(/\s+/).length <= 6, true);
    assert.doesNotMatch(query, /\.\.\.|[.!?]$/);
  });
});

test("broll prompt generator stock queries are short filler-free phrases", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-stock-clean-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-stock-clean");
  writeBrollPromptRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    [
      "# Final Script",
      "",
      "A serious solo creator experimenting with tools but keeping strategy human-owned.",
      "The video shows planning constraints, a screen recording workflow, and the editing workspace.",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "shot-list.md"),
    [
      "# Shot List",
      "",
      "| shot | reason | priority | status |",
      "| --- | --- | --- | --- |",
      "| TODO | TODO | TODO | TODO |",
      "| Placeholder shot | not assessed | high | open |",
    ].join("\n"),
    "utf8"
  );

  assert.equal(packageBrollPromptsScript.main([runDir, "--overwrite"]), 0);
  const stock = fs.readFileSync(path.join(runDir, "stock-search-queries.md"), "utf8");
  const queries = markdownDataRows(stock, "# Stock Search Queries").map((row) => row.split("|")[1].trim());

  assert.equal(queries.length >= 2, true);
  queries.forEach((query) => {
    assert.equal(query.split(/\s+/).length <= 5, true);
    assert.doesNotMatch(query, /\b(?:but|and|or|without|with|the|a|an|to|of|for|from|into)\b/i);
  });
  assert.match(queries.join("\n"), /solo creator AI workflow|video strategy planning|screen recording workflow|content ideation scorecard|creator editing workspace/);
});

test("broll prompt generator preserves manual files unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-preserve");
  writeBrollPromptRun(runDir);
  const packPath = path.join(runDir, "broll-prompt-pack.md");
  fs.writeFileSync(packPath, "# Manual B-Roll Prompt Pack\n\nKeep this.\n", "utf8");

  const first = captureConsole(() => packageBrollPromptsScript.main([runDir]));
  assert.equal(first.result, 0);
  assert.equal(fs.readFileSync(packPath, "utf8"), "# Manual B-Roll Prompt Pack\n\nKeep this.\n");
  assert.match(first.stdout.join("\n"), /unchanged: .*broll-prompt-pack\.md/);

  const overwritten = captureConsole(() => packageBrollPromptsScript.main([runDir, "--overwrite"]));
  assert.equal(overwritten.result, 0);
  assert.match(fs.readFileSync(packPath, "utf8"), /# B-Roll Prompt Pack/);
  assert.match(overwritten.stdout.join("\n"), /overwritten: .*broll-prompt-pack\.md/);
});

test("broll prompt generator passes only with exact approval and real prompt rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-pass-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-pass");
  writeBrollPromptRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "broll-prompt-pack.md"),
    "# B-Roll Prompt Pack\n\nVisual prompt approval: PASS\n\n| prompt | purpose | status |\n| --- | --- | --- |\n| Capture the scorecard next to selected package. | Show the actual workflow proof. | review-needed |\n",
    "utf8"
  );

  const output = captureConsole(() => packageBrollPromptsScript.main([runDir, "--overwrite"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /visual prompt status: PASS/);
  assert.match(brollPromptPackText(runDir), /Visual prompt status: PASS/);
  assert.match(brollPromptPackText(runDir), /Visual prompt approval: PASS/);
});

test("broll prompt generator does not pass placeholder prompt rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-broll-placeholder-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-broll-placeholder");
  writeBrollPromptRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "broll-prompt-pack.md"),
    "# B-Roll Prompt Pack\n\nVisual prompt approval: PASS\n\n| prompt | purpose | status |\n| --- | --- | --- |\n| TODO | TODO | TODO |\n",
    "utf8"
  );

  const output = captureConsole(() => packageBrollPromptsScript.main([runDir, "--overwrite"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /visual prompt status: NEEDS REVIEW/);
  assert.match(brollPromptPackText(runDir), /Visual prompt status: NEEDS REVIEW/);
  assert.doesNotMatch(brollPromptPackText(runDir), /Visual prompt status: PASS/);
});

test("verify script checks broll prompt generator syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-broll-prompts\.js/);
});

function writeCapturePlanningRun(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  if (options.productionPlan !== false) {
    fs.writeFileSync(
      path.join(runDir, "production-plan.md"),
      [
        "# Production Plan",
        "",
        "- Shoot-readiness status: " + (options.shootReadiness || "READY TO SHOOT"),
        "",
        "## Shoot-Readiness Gate",
        "",
        "- Status: " + (options.shootReadiness || "READY TO SHOOT"),
        "",
      ].join("\n")
    );
  }
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    options.openProductionBlocker
      ? "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| Missing proof capture. | Blocks rough cut. | Capture the proof. | blocked |\n"
      : "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n"
  );
  fs.writeFileSync(
    path.join(runDir, "shot-list.md"),
    "# Shot List\n\n| shot | reason | priority | status |\n| --- | --- | --- | --- |\n| Host intro take captured. | Opens the episode. | high | closed |\n"
  );
  fs.writeFileSync(
    path.join(runDir, "screen-capture-list.md"),
    "# Screen Capture List\n\n| capture | proof purpose | source/app | status |\n| --- | --- | --- | --- |\n| Dashboard proof captured. | Shows the workflow. | browser | closed |\n"
  );
  fs.writeFileSync(
    path.join(runDir, "demo-list.md"),
    "# Demo List\n\n| demo | what it proves | setup needed | status |\n| --- | --- | --- | --- |\n| Filtering demo captured. | Proves the method. | local files | closed |\n"
  );
  fs.writeFileSync(path.join(runDir, "audio-notes.md"), "# Audio Notes\n\n## Mic / Capture Notes\n\n- Use the approved mic setup.\n");
}

function writeReadyCaptureArtifacts(runDir) {
  fs.writeFileSync(
    path.join(runDir, "capture-checklist.md"),
    "# Capture Checklist\n\n- Capture approval: PASS\n\nReal captured material has been reviewed.\n"
  );
  fs.writeFileSync(path.join(runDir, "takes-log.md"), "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Take 1 | Host intro | host-intro.mov | clean | closed |\n");
  fs.writeFileSync(path.join(runDir, "missing-shot-tracker.md"), "# Missing Shot Tracker\n\n| missing shot/content | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | All required shots captured. | Keep files with run. | closed |\n");
  fs.writeFileSync(path.join(runDir, "screen-recording-checklist.md"), "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Dashboard proof | Shows workflow. | dashboard-proof.mp4 | closed |\n");
  fs.writeFileSync(path.join(runDir, "audio-capture-checklist.md"), "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Approved script audio. | voiceover.wav | closed |\n\nAudio capture readiness: PASS\n");
}

function captureChecklistText(runDir) {
  return fs.readFileSync(path.join(runDir, "capture-checklist.md"), "utf8");
}

test("capture checklist help works", () => {
  const output = captureConsole(() => packageCaptureChecklistScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-capture-checklist\.js/);
});

test("capture checklist keeps data rows that begin with capture words", () => {
  const markdown = "# Screen Capture List\n\n| capture | proof purpose | source/app | status |\n| --- | --- | --- | --- |\n| Demo capture | Show workflow proof | browser | closed |\n";

  assert.deepEqual(packageCaptureChecklistScript.tableRows(markdown), ["| Demo capture | Show workflow proof | browser | closed |"]);
  assert.equal(packageCaptureChecklistScript.hasIncompleteRows(markdown), false);
});

test("capture checklist blocks missing production plan", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-missing-plan-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-missing-plan");
  fs.mkdirSync(runDir, { recursive: true });

  assert.equal(packageCaptureChecklistScript.main([runDir]), 0);
  const checklist = captureChecklistText(runDir);

  assert.match(checklist, /Capture checklist status: BLOCKED/);
  assert.match(checklist, /production-plan\.md is missing/);
  assert.equal(fs.existsSync(path.join(runDir, "takes-log.md")), true);
});

test("capture checklist blocks blocked production plan", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-blocked-plan-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-blocked-plan");
  writeCapturePlanningRun(runDir, { shootReadiness: "BLOCKED" });

  assert.equal(packageCaptureChecklistScript.main([runDir]), 0);
  const checklist = captureChecklistText(runDir);

  assert.match(checklist, /Capture checklist status: BLOCKED/);
  assert.match(checklist, /Shoot-readiness status is BLOCKED, not READY TO SHOOT/);
});

test("capture checklist blocks open production blockers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-open-blockers-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-open-blockers");
  writeCapturePlanningRun(runDir, { openProductionBlocker: true });

  assert.equal(packageCaptureChecklistScript.main([runDir]), 0);
  const checklist = captureChecklistText(runDir);

  assert.match(checklist, /Capture checklist status: BLOCKED/);
  assert.match(checklist, /production-blockers\.md has open or blocked rows/);
});

test("capture checklist creates starter artifacts and needs capture when capture artifacts are missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-missing-artifacts-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-missing-artifacts");
  writeCapturePlanningRun(runDir);

  assert.equal(packageCaptureChecklistScript.main([runDir]), 0);
  const checklist = captureChecklistText(runDir);

  assert.match(checklist, /Capture checklist status: NEEDS CAPTURE/);
  assert.match(checklist, /capture execution artifacts are missing/);
  assert.match(checklist, /audio capture checklist lacks an exact capture readiness approval marker/);
  ["takes-log.md", "missing-shot-tracker.md", "screen-recording-checklist.md", "audio-capture-checklist.md"].forEach((filename) => {
    assert.equal(fs.existsSync(path.join(runDir, filename)), true);
  });
});

test("capture checklist preserves existing manual artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-preserve");
  writeCapturePlanningRun(runDir);
  const checklistPath = path.join(runDir, "capture-checklist.md");
  fs.writeFileSync(checklistPath, "# Manual Capture Checklist\n\nKeep this.\n", "utf8");

  const output = captureConsole(() => packageCaptureChecklistScript.main([runDir]));

  assert.equal(output.result, 0);
  assert.equal(fs.readFileSync(checklistPath, "utf8"), "# Manual Capture Checklist\n\nKeep this.\n");
  assert.match(output.stdout.join("\n"), /unchanged: .*capture-checklist\.md/);
});

test("capture checklist can mark ready for rough cut with approved planning and real capture readiness", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-ready");
  writeCapturePlanningRun(runDir);
  fs.writeFileSync(
    path.join(runDir, "screen-capture-list.md"),
    "# Screen Capture List\n\n| capture | proof purpose | source/app | status |\n| --- | --- | --- | --- |\n| Demo capture | Show workflow proof | browser | closed |\n"
  );
  writeReadyCaptureArtifacts(runDir);

  assert.equal(packageCaptureChecklistScript.main([runDir, "--overwrite"]), 0);
  const checklist = captureChecklistText(runDir);

  assert.match(checklist, /Capture checklist status: READY FOR ROUGH CUT/);
  assert.match(checklist, /Ready for rough cut: yes/);
  assert.match(fs.readFileSync(path.join(runDir, "screen-recording-checklist.md"), "utf8"), /Demo capture/);
  packageCaptureChecklistScript.TARGET_FILES.forEach((filename) => {
    const artifact = fs.readFileSync(path.join(runDir, filename), "utf8");
    assert.doesNotMatch(artifact, /\bTODO\b/);
    assert.doesNotMatch(artifact, /\|\s*(?:open|blocked)\s*\|/i);
  });
});

test("capture checklist overwrite replaces generated artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-overwrite-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-overwrite");
  writeCapturePlanningRun(runDir);
  const takesPath = path.join(runDir, "takes-log.md");
  fs.writeFileSync(takesPath, "# Manual Takes Log\n\nReplace me.\n", "utf8");

  const output = captureConsole(() => packageCaptureChecklistScript.main([runDir, "--overwrite"]));

  assert.equal(output.result, 0);
  assert.match(fs.readFileSync(takesPath, "utf8"), /# Takes Log/);
  assert.match(output.stdout.join("\n"), /overwritten: .*takes-log\.md/);
});

test("verify script checks capture checklist syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-capture-checklist\.js/);
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

test("capture evidence review rejects generated checklist files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-generated-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-generated-capture");
  writeCaptureEvidenceFixture(runDir, {
    "takes-log.md": "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Approved hook shot | shot-list.md | Verified in existing capture artifacts. | Generated checklist row. | captured |\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Approved proof screen recording | screen-capture-list.md | Verified in existing capture artifacts. | captured |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Approved script audio. | Verified in existing capture artifacts. | closed |\n\nCapture evidence approval: PASS\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.status, "NEEDS CAPTURE");
  assert.equal(evaluation.realCaptureEvidence, false);
  assert.equal(evaluation.captureEvidenceAccepted, false);
});

test("capture evidence review rejects dummy smoke-test capture rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-dummy-smoke-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-dummy-smoke-capture");
  writeCaptureEvidenceFixture(runDir, {
    "capture-checklist.md":
      "# Capture Checklist\n\n- Capture checklist status: READY FOR HUMAN APPROVAL\n- Ready for rough cut: no\n\nCapture approval: NOT APPROVED\n",
    "takes-log.md":
      "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Take 1 | Screen-recorded comparison. | Verified in existing capture artifacts. | Generated checklist row. | closed |\n| TAKE-001 | shot-list.md smoke-test row | media/test-capture/take-001-hook.mov | Dummy smoke-test A-roll reference. Not real production approval. | captured |\n",
    "screen-recording-checklist.md":
      "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Workflow screen | Capture proof. | Verified in existing capture artifacts. | closed |\n| Screen recording smoke proof 001 | Dummy smoke-test screen recording reference. Not real production approval. | recordings/test-screen-proof-001.mp4 | captured |\n",
    "audio-capture-checklist.md":
      "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Record only approved script sections. | Verified in existing capture artifacts. | closed |\n| Voiceover smoke-test main pass | Dummy smoke-test audio reference. Not real production approval. | audio/test-voiceover-main.wav | recorded |\n\nAudio capture readiness: NOT APPROVED\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.status, "NEEDS CAPTURE");
  assert.equal(evaluation.realCaptureEvidence, false);
  assert.equal(evaluation.screenRecordingsIdentified, false);
  assert.equal(evaluation.audioCapturesIdentified, false);
  assert.equal(evaluation.captureEvidenceAccepted, false);
  assert.equal(evaluation.approvalMarkerDetected, false);
});

test("capture evidence review requires approval after real rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-ready-capture");
  writeCaptureEvidenceFixture(runDir);

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.status, "READY FOR HUMAN APPROVAL");
  assert.equal(evaluation.realCaptureEvidence, true);
  assert.equal(evaluation.approvalMarkerDetected, false);
  assert.equal(evaluation.captureEvidenceAccepted, false);
});

test("capture evidence review recognizes absolute screen recording path with captured review-needed status", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-absolute-screen-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-absolute-screen");
  writeCaptureEvidenceFixture(runDir, {
    "takes-log.md": "# Takes Log\n\nTODO\n",
    "screen-recording-checklist.md":
      "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Scorecard workflow proof | Shows package selection workflow. | /home/vidtoolz/Videos/vidtoolz-captures/2026-05-02-ai-video-idea-filter/2026-05-14 09-33-52.mp4 | captured/review-needed |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\nTODO\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.screenRecordingsIdentified, true);
  assert.equal(evaluation.realCaptureEvidence, false);
  assert.equal(evaluation.status, "NEEDS CAPTURE");
  assert.equal(evaluation.captureEvidenceAccepted, false);
});

test("capture evidence review does not recognize TODO screen recording placeholders", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-todo-screen-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-todo-screen");
  writeCaptureEvidenceFixture(runDir, {
    "takes-log.md": "# Takes Log\n\nTODO\n",
    "screen-recording-checklist.md":
      "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Placeholder screen | TODO | TODO | captured/review-needed |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\nTODO\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.screenRecordingsIdentified, false);
  assert.equal(evaluation.realCaptureEvidence, false);
  assert.equal(evaluation.status, "NEEDS CAPTURE");
});

test("capture evidence review approval marker alone does not pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-approval-only-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-approval-only");
  writeCaptureEvidenceFixture(runDir, {
    "takes-log.md": "# Takes Log\n\nTODO\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\nTODO\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\nCapture evidence approval: PASS\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.status, "NEEDS CAPTURE");
  assert.equal(evaluation.realCaptureEvidence, false);
  assert.equal(evaluation.approvalMarkerDetected, false);
  assert.equal(evaluation.staleApprovalMarkerDetected, true);
});

test("capture evidence review still requires closed missing shots and blockers with full media evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-full-media-open-gates-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-full-media-open-gates");
  writeCaptureEvidenceFixture(runDir, {
    "capture-checklist.md": "# Capture Checklist\n\n| blocker | required fix | status |\n| --- | --- | --- |\n| Check OBS audio sync. | Review before rough cut. | open |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Final script narration. | audio/voiceover.wav | recorded |\n\nCapture evidence approval: PASS\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n\n| missing shot/content | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| Hook reshoot | Needed for edit. | Capture A-roll hook. | open |\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.realCaptureEvidence, true);
  assert.equal(evaluation.missingShotsClosed, false);
  assert.equal(evaluation.captureBlockersResolved, false);
  assert.equal(evaluation.status, "NEEDS CAPTURE");
  assert.equal(evaluation.captureEvidenceAccepted, false);
});

test("capture evidence review does not let old approval marker pass newly added evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-stale-approval-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-stale-approval");
  writeCaptureEvidenceFixture(runDir, {
    "capture-checklist.md": "# Capture Checklist\n\nCapture evidence approval: PASS\n\nOld approval before later evidence intake.\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.status, "READY FOR HUMAN APPROVAL");
  assert.equal(evaluation.realCaptureEvidence, true);
  assert.equal(evaluation.approvalMarkerDetected, false);
  assert.equal(evaluation.staleApprovalMarkerDetected, true);
  assert.match(evaluation.findings.join("\n"), /approval marker must appear after the concrete take, screen, and audio evidence/i);
});

test("capture evidence review approval plus take evidence only does not pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-take-only-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-take-only");
  writeCaptureEvidenceFixture(runDir, {
    "capture-checklist.md": "# Capture Checklist\n\nCapture evidence approval: PASS\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\nTODO\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\nTODO\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.status, "NEEDS CAPTURE");
  assert.equal(evaluation.realCaptureEvidence, false);
  assert.equal(evaluation.screenRecordingsIdentified, false);
  assert.equal(evaluation.audioCapturesIdentified, false);
  assert.equal(evaluation.captureEvidenceAccepted, false);
});

test("capture evidence review approval plus take and screen without audio does not pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-no-audio-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-no-audio");
  writeCaptureEvidenceFixture(runDir, {
    "capture-checklist.md": "# Capture Checklist\n\nCapture evidence approval: PASS\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Audio proof screenshot | audio capture proof image only | screenshot.png | recorded |\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.status, "NEEDS CAPTURE");
  assert.equal(evaluation.realCaptureEvidence, false);
  assert.equal(evaluation.screenRecordingsIdentified, true);
  assert.equal(evaluation.audioCapturesIdentified, false);
  assert.equal(evaluation.captureEvidenceAccepted, false);
});

test("capture evidence review approval plus take and audio without screen does not pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-no-screen-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-no-screen");
  writeCaptureEvidenceFixture(runDir, {
    "capture-checklist.md": "# Capture Checklist\n\nCapture evidence approval: PASS\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Placeholder screen | TODO | audio/voiceover.wav | captured |\n",
  });

  const evaluation = packageCaptureEvidenceReviewScript.evaluateCaptureEvidence(runDir);

  assert.equal(evaluation.status, "NEEDS CAPTURE");
  assert.equal(evaluation.realCaptureEvidence, false);
  assert.equal(evaluation.screenRecordingsIdentified, false);
  assert.equal(evaluation.audioCapturesIdentified, true);
  assert.equal(evaluation.captureEvidenceAccepted, false);
});

test("capture evidence review passes real evidence with exact approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-evidence-pass-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-pass-capture");
  writeCaptureEvidenceFixture(runDir, {
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Final script narration. | audio/voiceover.wav | recorded |\n\nCapture evidence approval: PASS\n",
  });

  const output = captureConsole(() => packageCaptureEvidenceReviewScript.main([runDir]));
  const review = fs.readFileSync(path.join(runDir, "capture-evidence-review.md"), "utf8");

  assert.equal(output.result, 0);
  assert.match(review, /Review status: PASS/);
  assert.match(review, /Capture evidence accepted: yes/);
  assert.match(review, /External APIs called: no/);
  assert.doesNotMatch(review, /Take\/camera\/A-roll evidence is missing/i);
  assert.doesNotMatch(review, /Screen recording evidence is missing/i);
  assert.doesNotMatch(review, /Audio\/A-roll\/voiceover capture evidence is missing/i);
});

test("verify script checks capture evidence review syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-capture-evidence-review\.js/);
});

test("package run evidence lint reports missing run folder read-only", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-lint-missing-"));
  const report = packageRunEvidenceLintScript.lintEvidenceRows("package-runs/missing-run", { repoRoot: tempRoot });

  assert.equal(report.status, "missing-run-folder");
  assert.equal(report.readOnly, true);
  assert.equal(report.externalApisCalled, false);
  assert.equal(report.evidenceRowCount, 0);
  assert.match(report.recommendedNextManualRepairAction, /Restore or create/);
});

test("package run evidence lint handles no evidence files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-lint-empty-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-empty");
  fs.mkdirSync(runDir, { recursive: true });

  const report = packageRunEvidenceLintScript.lintEvidenceRows("package-runs/2026-05-10-empty", { repoRoot: tempRoot });

  assert.equal(report.status, "no-evidence-rows");
  assert.equal(report.evidenceFilesFound.length, 0);
  assert.equal(report.evidenceFilesMissing.length, packageRunEvidenceLintScript.EVIDENCE_FILES.length);
  assert.match(report.recommendedNextManualRepairAction, /Add concrete capture evidence rows/);
});

test("package run evidence lint flags placeholder and TODO rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-lint-placeholder-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-placeholder");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "screen-recording-checklist.md"),
    "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Placeholder screen | TODO | TODO | captured |\n",
    "utf8"
  );

  const report = packageRunEvidenceLintScript.lintEvidenceRows("package-runs/2026-05-10-placeholder", { repoRoot: tempRoot });

  assert.equal(report.evidenceRowCount, 1);
  assert.equal(report.placeholderOrTodoRows.length, 1);
  assert.equal(report.missingMediaReferenceRows.length, 1);
  assert.match(report.recommendedNextManualRepairAction, /Replace TODO\/placeholder/);
});

test("package run evidence lint flags dummy sample test media rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-lint-dummy-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-dummy");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "takes-log.md"),
    "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| TAKE-001 | shot-list.md smoke-test row | media/test-capture/take-001-hook.mov | Dummy smoke-test A-roll reference. | captured |\n",
    "utf8"
  );

  const report = packageRunEvidenceLintScript.lintEvidenceRows("package-runs/2026-05-10-dummy", { repoRoot: tempRoot });

  assert.equal(report.dummySampleTestMediaRows.length, 1);
  assert.equal(report.concreteMediaReferenceCount, 1);
  assert.match(report.recommendedNextManualRepairAction, /dummy\/sample\/test/);
});

test("package run evidence lint recognizes concrete VIDNAS and production media path rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-lint-vidnas-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-vidnas");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "screen-recording-checklist.md"),
    "# Screen Recording Checklist\n\n| screen recording | source category | proof purpose | file/reference | status |\n| --- | --- | --- | --- | --- |\n| Workflow proof | OBS | Shows real workflow. | /mnt/VIDNAS/public/VIDTOOLZ/inbox/from_phone/workflow-proof.mp4 | captured |\n| Local proof | OBS | Shows local workflow. | /home/vidtoolz/Videos/vidtoolz-captures/run/proof.mp4 | captured |\n",
    "utf8"
  );

  const report = packageRunEvidenceLintScript.lintEvidenceRows("package-runs/2026-05-10-vidnas", { repoRoot: tempRoot });

  assert.equal(report.evidenceRowCount, 2);
  assert.equal(report.concreteMediaReferenceCount, 2);
  assert.equal(report.vidnasOrProductionPathRows.length, 2);
  assert.equal(report.missingMediaReferenceRows.length, 0);
});

test("package run evidence lint flags missing source category status and purpose fields", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-lint-missing-fields-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-missing-fields");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "takes-log.md"),
    "# Takes Log\n\n| take | source category | file/reference | status |\n| --- | --- | --- | --- |\n|  |  | media/take-001.mov |  |\n",
    "utf8"
  );

  const report = packageRunEvidenceLintScript.lintEvidenceRows("package-runs/2026-05-10-missing-fields", { repoRoot: tempRoot });

  assert.equal(report.sourceCategoryMissingRows.length, 1);
  assert.equal(report.evidenceTypeOrPurposeMissingRows.length, 1);
  assert.equal(report.statusMissingRows.length, 1);
  assert.match(report.recommendedNextManualRepairAction, /source\/category|evidence purpose\/type|status/);
});

test("package run evidence lint JSON output is parseable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-lint-json-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-json");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Evidence Lint JSON" } }), "utf8");
  fs.writeFileSync(
    path.join(runDir, "audio-capture-checklist.md"),
    "# Audio Capture Checklist\n\n| audio item | source category | capture requirement | file/reference | status |\n| --- | --- | --- | --- | --- |\n| Voiceover | mic | Final narration. | audio/voiceover.wav | recorded |\n",
    "utf8"
  );

  const output = captureConsole(() => packageRunEvidenceLintScript.main([runDir, "--json"]));
  const payload = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.equal(payload.runTitle, "Evidence Lint JSON");
  assert.equal(payload.readOnly, true);
  assert.equal(payload.externalApisCalled, false);
  assert.equal(payload.evidenceRowCount, 1);
  assert.ok(Array.isArray(payload.placeholderOrTodoRows));
  assert.ok(Array.isArray(payload.placeholderTodoRows));
  assert.equal(payload.placeholderTodoRows.length, payload.placeholderOrTodoRows.length);
});

test("verify script checks package run evidence lint syntax", () => {
  const verifyPath = path.join(__dirname, "..", "scripts", "verify.sh");
  const verify = fs.readFileSync(verifyPath, "utf8");

  assert.match(verify, /node --check scripts\/package-run-evidence-lint\.js/);
});

test("script prep cli writes local review artifacts and marks partial research as not ready", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-prep-"));
  const repoRunsDir = path.join(tempRoot, "package-runs");
  const runDir = path.join(repoRunsDir, "2026-05-02-script-prep");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Script Prep Package",
        viewerPromise: "A reviewable script prep workflow.",
      },
    })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n- Hook\n- Demo\n- Payoff\n");
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: Source list is not complete.\n"
  );
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Package Run Notes\n");

  const output = packageScriptPrepScript.main([runDir]);

  assert.equal(output, 0);
  assert.match(fs.readFileSync(path.join(runDir, "script-prompt.md"), "utf8"), /Script Prep Package/);
  assert.match(fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8"), /Script structure status: PARTIAL/);
  assert.match(fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8"), /Ready to draft: no/);
  assert.match(fs.readFileSync(path.join(runDir, "script-draft.md"), "utf8"), /# Script Draft/);
  assert.match(fs.readFileSync(path.join(runDir, "final-script.md"), "utf8"), /# Final Script/);
  assert.match(fs.readFileSync(path.join(runDir, "production-notes.md"), "utf8"), /# Production Notes/);
  assert.match(fs.readFileSync(path.join(runDir, "notes.md"), "utf8"), /## Script Prep/);
});

test("script prep cli marks missing research pack as needs research", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-prep-missing-research-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-script-prep");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Missing Research Package", viewerPromise: "Needs research." } })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n- Hook\n- Demo\n- Payoff\n");
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Package Run Notes\n");

  const output = packageScriptPrepScript.main([runDir]);
  const structure = fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8");

  assert.equal(output, 0);
  assert.match(structure, /Script structure status: NEEDS RESEARCH/);
  assert.match(structure, /research-pack\.md is missing/);
  assert.doesNotMatch(structure, /Script structure status: READY TO DRAFT/);
});

test("script prep cli preserves manually edited script structure", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-prep-preserve-structure-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-script-prep-preserve");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Preserve Script Structure", viewerPromise: "Keep manual structure edits." } })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n- Hook\n- Demo\n- Payoff\n");
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PASS\n"
  );
  const structurePath = path.join(runDir, "script-structure.md");
  fs.writeFileSync(structurePath, "# Manual Script Structure\n\nKeep this human edit.\n", "utf8");

  const output = captureConsole(() => packageScriptPrepScript.main([runDir]));

  assert.equal(output.result, 0);
  assert.equal(fs.readFileSync(structurePath, "utf8"), "# Manual Script Structure\n\nKeep this human edit.\n");
  assert.match(output.stdout.join("\n"), /skipped: .*script-structure\.md/);
  assert.match(fs.readFileSync(path.join(runDir, "script-prompt.md"), "utf8"), /Preserve Script Structure/);
  assert.match(fs.readFileSync(path.join(runDir, "script-draft.md"), "utf8"), /# Script Draft/);
  assert.match(fs.readFileSync(path.join(runDir, "final-script.md"), "utf8"), /# Final Script/);
  assert.match(fs.readFileSync(path.join(runDir, "production-notes.md"), "utf8"), /# Production Notes/);
});

test("production prep builders create the seven required local planning artifacts", () => {
  const context = {
    runId: "run-id",
    selectedPackageText: [
      "# Selected Package: Production Package",
      "",
      "## Thumbnail Concept",
      "",
      "Before after workflow for an AI idea filter",
      "",
      "## Viewer Promise",
      "",
      "A practical payoff for filtering AI-generated video ideas.",
    ].join("\n"),
    finalOutlineText: [
      "# Final Outline",
      "",
      "### Suggested demonstrations or screen recordings",
      "",
      "## Demo",
      "",
      "Show an AI idea filter before and after comparison.",
      "",
      "## Visual / B-roll Notes",
      "",
      "Packaging still needs verification before finalization.",
    ].join("\n"),
    finalScriptText: [
      "# Final Script",
      "",
      "By the end of this video, you will have a practical idea filter.",
      "Record the hook, show the screen demo, then deliver the payoff.",
      "If you want, try this on your next video idea before scripting.",
      "Try the four-part filter before you shoot.",
      "- - Show examples from the AI output.",
      "3. **Before-and-after example**",
      "Ask an AI tool for 10 generic video ideas, then score one weak idea through audience demand, expertise fit, production fit, and better-than-competitors.",
      "Revise the weak AI idea into a stronger package and compare final title plus thumbnail.",
    ].join("\n"),
    productionNotesText: [
      "# Production Notes",
      "",
      "## Shoot List",
      "",
      "## Demo Moments",
      "",
      "## Visual / B-roll Notes",
      "",
      "Capture the UI timeline and score table.",
      "- [ ] Checklist metadata should not become a capture task.",
      "Production Prep v1 generated locally.",
    ].join("\n"),
  };

  const brief = packageRun.buildProductionBriefMarkdown(context);
  const shooting = packageRun.buildShootingPlanMarkdown(context);
  const broll = packageRun.buildBRollListMarkdown(context);
  const graphics = packageRun.buildGraphicsListMarkdown(context);
  const resolve = packageRun.buildResolveEditChecklistMarkdown(context);
  const thumbnail = packageRun.buildThumbnailTitleCheckMarkdown(context);
  const publish = packageRun.buildPublishPackMarkdown(context);
  const section = (markdown, heading) => {
    const marker = `## ${heading}\n`;
    const start = markdown.indexOf(marker);
    if (start === -1) return "";
    const rest = markdown.slice(start + marker.length);
    const next = rest.search(/\n## /);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
  };
  const screenCaptures = section(shooting, "Screen Recording / Demo Captures");
  const requiredBroll = section(broll, "Required B-Roll");

  assert.match(brief, /# Production Brief/);
  assert.match(brief, /Production Package/);
  assert.match(shooting, /# Shooting Plan/);
  assert.match(shooting, /Screen Recording \/ Demo Captures/);
  assert.match(screenCaptures, /Capture AI tool generating 10 generic video ideas\./);
  assert.match(screenCaptures, /Capture the four-part filter as a table: audience demand, expertise fit, production fit, better-than-competitors\./);
  assert.match(screenCaptures, /Capture one weak AI idea being scored through the filter\./);
  assert.match(screenCaptures, /Capture the weak idea being revised into a stronger package\./);
  assert.match(screenCaptures, /Capture final title \+ thumbnail comparison\./);
  assert.doesNotMatch(screenCaptures, /## Shoot List|## Demo Moments|### Suggested demonstrations or screen recordings/);
  assert.doesNotMatch(screenCaptures, /Packaging still needs verification before finalization|Production Prep v1 generated locally|Checklist metadata/);
  assert.doesNotMatch(screenCaptures, /By the end of this video|If you want, try this|Try the four-part filter|- Show examples|Before-and-after example|Record the hook/);
  assert.match(broll, /# B-Roll List/);
  assert.match(requiredBroll, /Capture AI tool generating 10 generic video ideas\./);
  assert.match(requiredBroll, /Capture the four-part filter as a table: audience demand, expertise fit, production fit, better-than-competitors\./);
  assert.match(requiredBroll, /Capture one weak AI idea being scored through the filter\./);
  assert.match(requiredBroll, /Capture the weak idea being revised into a stronger package\./);
  assert.match(requiredBroll, /Capture final title \+ thumbnail comparison\./);
  assert.match(requiredBroll, /Capture the UI timeline/);
  assert.doesNotMatch(requiredBroll, /## Shoot List|## Demo Moments|### Suggested demonstrations or screen recordings|## Visual \/ B-roll Notes/);
  assert.doesNotMatch(requiredBroll, /Packaging still needs verification before finalization|Production Prep v1 generated locally|Checklist metadata/);
  assert.doesNotMatch(requiredBroll, /By the end of this video|If you want, try this|Try the four-part filter|- Show examples|Before-and-after example|Record the hook/);
  assert.match(graphics, /# Graphics List/);
  assert.match(resolve, /# Resolve Edit Checklist/);
  assert.match(thumbnail, /# Thumbnail Title Check/);
  assert.match(thumbnail, /Packaging Gate/);
  assert.match(publish, /# Publish Pack/);
  assert.match(publish, /No Episode Factory episode folder was created automatically/);
});

test("production prep cli argument parsing accepts run folder and explicit inputs", () => {
  const parsed = packageProductionPrepScript.parseArgs([
    "package-runs/run-id",
    "--selected",
    "selected-package.json",
    "--outline",
    "final-outline.md",
    "--script",
    "final-script.md",
    "--notes",
    "production-notes.md",
  ]);

  assert.equal(parsed.runFolder, "package-runs/run-id");
  assert.equal(parsed.selectedPath, "selected-package.json");
  assert.equal(parsed.outlinePath, "final-outline.md");
  assert.equal(parsed.scriptPath, "final-script.md");
  assert.equal(parsed.notesPath, "production-notes.md");
});

test("production prep cli writes seven artifacts and preserves existing human edits", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-prep-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-production-prep");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Production Prep Package",
        thumbnailConcept: "Before after screen",
        viewerPromise: "A practical production plan.",
        shortsIdeas: ["Hook short", "Payoff short"],
      },
    })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n- Show the demo.\n");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n\nRecord the hook and screen demo.\n");
  fs.writeFileSync(path.join(runDir, "production-notes.md"), "# Production Notes\n\nCapture B-roll of the UI table.\n");
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Package Run Notes\n");

  const output = packageProductionPrepScript.main([runDir]);

  assert.equal(output, 0);
  [
    "production-brief.md",
    "shooting-plan.md",
    "b-roll-list.md",
    "graphics-list.md",
    "resolve-edit-checklist.md",
    "thumbnail-title-check.md",
    "publish-pack.md",
  ].forEach((filename) => {
    assert.equal(fs.existsSync(path.join(runDir, filename)), true);
  });
  assert.match(fs.readFileSync(path.join(runDir, "production-brief.md"), "utf8"), /Production Prep Package/);
  assert.match(fs.readFileSync(path.join(runDir, "b-roll-list.md"), "utf8"), /Capture B-roll of the UI table/);
  assert.match(fs.readFileSync(path.join(runDir, "notes.md"), "utf8"), /## Production Prep/);

  fs.writeFileSync(path.join(runDir, "shooting-plan.md"), "# Human Shooting Plan\n\nDo not overwrite.\n");
  const skipped = packageProductionPrepScript.main([runDir]);

  assert.equal(skipped, 2);
  assert.match(fs.readFileSync(path.join(runDir, "shooting-plan.md"), "utf8"), /Do not overwrite/);
});

test("package run creator qa builds package and guards existing artifacts", () => {
  const selected = {
    markdown: packageRun.selectedPackageToMarkdown({
      proposedTitle: "Creator QA Package",
      onThumbnailText: "Check It",
      viewerPromise: "The viewer can verify the package before shooting.",
    }),
    data: {
      proposedTitle: "Creator QA Package",
      onThumbnailText: "Check It",
      viewerPromise: "The viewer can verify the package before shooting.",
      targetViewer: "Solo AI video creator",
      mainRisk: "The demo may imply tool behavior that changes quickly.",
      demoProof: "Show the idea filter rejecting one weak idea and keeping one strong idea.",
    },
  };
  const markdown = packageRunCreatorQaScript.buildCreatorQaPackage({
    selected,
    finalOutlineText: [
      "# Final Outline",
      "",
      "Run: 2026-05-02-qa",
      "Status: Selected final outline for script drafting.",
      "Source Files",
      "- package-runs/2026-05-02-qa/final-outline.md",
      "",
      "## Hook",
      "Outline-only hook should stay out of script.",
      "",
      "## Beat",
      "Outline-only beat.",
    ].join("\n"),
    finalScriptText: [
      "# Final Script",
      "",
      "Run: package-runs/2026-05-02-qa",
      "Status: draft",
      "Source Files",
      "- [ ] Review final-script.md before publishing",
      "Generated workflow instructions for the reviewer.",
      "",
      "## Hook",
      "Stop letting weak AI video ideas reach the shoot list.",
      "",
      "## Problem / Context",
      "Creators waste time shooting ideas that were never strong enough.",
      "",
      "## Promised Outcome",
      "You will have a practical filter for AI video ideas.",
      "",
      "## Steps",
      "Score the promise, proof, and production fit.",
      "",
      "## Demonstration / Proof",
      "Apply the filter to three sample ideas.",
      "",
      "## Recap",
      "Keep only ideas with a clear viewer payoff.",
      "",
      "## CTA",
      "Run the filter before scripting.",
    ].join("\n"),
    productionBriefText: [
      "# Production Brief",
      "",
      "Run: 2026-05-02-qa",
      "Status: Selected final outline for script drafting.",
      "Practical tutorial / workflow version",
      "Production Prep v1 generated locally.",
      "Source Files",
      "Production-only direction should stay out of script.",
      "",
      "- [ ] Check lights.",
    ].join("\n"),
    thumbnailTitleCheckText: "Review final-script.md for claims before publishing.",
    publishPackText: "Status: internal draft\nGenerated workflow/admin notes.",
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-qa-guard-"));
  const topSection = (name) => {
    const marker = `# ${name}\n`;
    const start = markdown.indexOf(marker);
    if (start === -1) return "";
    const rest = markdown.slice(start + marker.length);
    const next = rest.search(/\n# [^#]/);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
  };
  const scriptSection = topSection("Script");
  const notesSection = topSection("Notes");

  assert.match(markdown, /# Title\nCreator QA Package/);
  assert.match(markdown, /# Thumbnail\nCheck It/);
  assert.match(markdown, /# Hook\nStop letting weak AI video ideas reach the shoot list\./);
  assert.match(markdown, /# Viewer Payoff\nThe viewer can verify the package before shooting/);
  assert.match(scriptSection, /## Hook\nStop letting weak AI video ideas reach the shoot list\./);
  assert.match(scriptSection, /## Problem \/ Context\nCreators waste time shooting ideas/);
  assert.match(scriptSection, /## Demonstration \/ Proof\nApply the filter to three sample ideas\./);
  assert.match(scriptSection, /## Call to Action\n\nWatch next: Run the filter before scripting\./);
  assert.doesNotMatch(scriptSection, /## CTA/);
  assert.doesNotMatch(scriptSection, /Outline-only/);
  assert.doesNotMatch(scriptSection, /Production-only/);
  assert.doesNotMatch(scriptSection, /^Run:/m);
  assert.doesNotMatch(scriptSection, /^Status:/m);
  assert.doesNotMatch(scriptSection, /Source Files/);
  assert.doesNotMatch(scriptSection, /\[[ xX]\]/);
  assert.doesNotMatch(scriptSection, /generated workflow instructions/i);
  assert.doesNotMatch(scriptSection, /Review final-script\.md/i);
  assert.match(notesSection, /Source Notes \/ Manual Verification/);
  assert.match(notesSection, /Manual verification: Check cost details, launch timing, benchmark-style numbers, app fit, and speed claims outside this package\./);
  assert.match(notesSection, /Manual verification: Check any AI tool UI behavior shown in screen recordings before publishing\./);
  assert.doesNotMatch(notesSection, /No pricing, release-date, benchmark/);
  assert.deepEqual(packageRunCreatorQaScript.sectionHasCreatorQaCta(scriptSection), true);
  assert.deepEqual(
    packageRunCreatorQaScript.sanitizePackageContent(notesSection)
      .split(/\r?\n/)
      .filter((line) => /pricing|release-date|tool-performance|performance|compatible with|v?\d+\.\d+/.test(line.toLowerCase())),
    []
  );
  assert.match(notesSection, /Thumbnail concept: Check It/);
  assert.match(notesSection, /Target viewer: Solo AI video creator/);
  assert.match(notesSection, /Main risk: The demo may imply tool behavior that changes quickly\./);
  assert.match(notesSection, /Suggested demo\/proof notes: Show the idea filter rejecting one weak idea/);
  assert.doesNotMatch(markdown, /^Run:/m);
  assert.doesNotMatch(markdown, /2026-05-02-qa/);
  assert.doesNotMatch(markdown, /^Status:/m);
  assert.doesNotMatch(markdown, /Source Files/);
  assert.doesNotMatch(markdown, /Production Prep v/);
  assert.match(markdown, /Call to Action/);

  fs.writeFileSync(path.join(tempDir, "creator-qa-package.md"), "Human QA package\n");
  assert.throws(
    () => packageRunCreatorQaScript.assertCanWriteOutputs(tempDir, markdown, false),
    /creator-qa-package\.md already exists/
  );
  assert.doesNotThrow(() => packageRunCreatorQaScript.assertCanWriteOutputs(tempDir, markdown, true));
});

test("package run creator qa cli writes local qa artifacts using creator qa root", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-qa-cli-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-qa");
  const creatorQaRoot = path.join(tempRoot, "creator-qa");
  fs.mkdirSync(path.join(creatorQaRoot, "src", "creator_qa"), { recursive: true });
  fs.writeFileSync(path.join(creatorQaRoot, "src", "creator_qa", "__init__.py"), "");
  fs.writeFileSync(
    path.join(creatorQaRoot, "src", "creator_qa", "cli.py"),
    `import argparse, json, pathlib, sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("input")
    parser.add_argument("--profile")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--report")
    args = parser.parse_args()
    pathlib.Path(args.report).write_text("# Creator QA Report\\n\\nOverall: PASS\\n", encoding="utf-8")
    print(json.dumps({"overall_result": "PASS", "total_score": 35, "profile": args.profile}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
`,
    "utf8"
  );
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Creator QA CLI Package",
        onThumbnailText: "QA Gate",
        viewerPromise: "The viewer gets a checked package.",
      },
    })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n## Hook\nCheck the package.\n");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n\nIn this video you will check the package before shooting.\n");

  const output = packageRunCreatorQaScript.main([runDir, "--creator-qa-root", creatorQaRoot]);
  const report = JSON.parse(fs.readFileSync(path.join(runDir, "creator-qa-report.json"), "utf8"));

  assert.equal(output, 0);
  assert.equal(report.overall_result, "PASS");
  assert.equal(report.profile, "ai_video_breakdown");
  assert.match(fs.readFileSync(path.join(runDir, "creator-qa-package.md"), "utf8"), /Creator QA CLI Package/);
  assert.match(fs.readFileSync(path.join(runDir, "creator-qa-report.md"), "utf8"), /Overall: PASS/);
  assert.equal(packageRunCreatorQaScript.main([runDir, "--creator-qa-root", creatorQaRoot]), 1);
  assert.equal(packageRunCreatorQaScript.main([runDir, "--creator-qa-root", creatorQaRoot, "--force", "--profile", "resolve_tutorial"]), 0);
  const explicitReport = JSON.parse(fs.readFileSync(path.join(runDir, "creator-qa-report.json"), "utf8"));
  assert.equal(explicitReport.profile, "resolve_tutorial");
  assert.equal(packageRunCreatorQaScript.parseArgs(["package-runs/run"]).profile, "ai_video_breakdown");
  assert.equal(packageRunCreatorQaScript.parseArgs(["package-runs/run", "--profile", "resolve_tutorial"]).profile, "resolve_tutorial");
});

test("package run research pack generates a starter pack for a valid run", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-pack-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-pack");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify(
      {
        package: {
          proposedTitle: "Diagnose Resolve Playback Lag Before You Change Settings",
          idea: "Help solo creators diagnose Resolve playback lag with evidence before changing random settings.",
          viewerPromise: "The viewer can identify the likely bottleneck before changing settings.",
          targetViewer: "Serious solo video creators using DaVinci Resolve.",
          viewerProblem:
            "Resolve playback stutters and the creator does not know whether disk, GPU, cache, media, or timeline settings are the real issue.",
          mainRisk: "The video becomes another generic settings checklist without proof.",
          thumbnailConcept: "Resolve timeline beside Task Manager proof signal.",
          audience_demand_rationale: "Creators repeatedly search for Resolve playback lag fixes.",
          suggested_production_approach: "Capture before/after playback and system-monitor evidence.",
        },
      },
      null,
      2
    )
  );

  const output = captureConsole(() => packageResearchPackScript.main([runDir]));
  const packPath = path.join(runDir, "research-pack.md");
  const markdown = fs.readFileSync(packPath, "utf8");

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /created: .*research-pack\.md/);
  assert.match(markdown, /# Research Pack/);
  assert.match(markdown, /Diagnose Resolve Playback Lag Before You Change Settings/);
  assert.match(markdown, /## What Must Be Proven/);
  assert.match(markdown, /## Source List Placeholder/);
  assert.match(markdown, /Status: PARTIAL/);
});

test("package run research pack handles a run with missing package files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-pack-missing-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-missing");
  fs.mkdirSync(runDir, { recursive: true });

  const output = captureConsole(() => packageResearchPackScript.main([runDir]));
  const markdown = fs.readFileSync(path.join(runDir, "research-pack.md"), "utf8");

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /Missing selected package/);
  assert.match(markdown, /Input package: missing/);
  assert.match(markdown, /Status: BLOCKED/);
  assert.match(markdown, /starter template/);
});

test("package run research pack preserves manual edits unless overwrite is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-pack-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-preserve");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Manual Preserve Test", viewerPromise: "Preserve manual edits." } })
  );
  const packPath = path.join(runDir, "research-pack.md");
  fs.writeFileSync(packPath, "# Manual Research Pack\n\nKeep this human edit.\n", "utf8");

  const skipped = captureConsole(() => packageResearchPackScript.main([runDir]));
  assert.equal(skipped.result, 2);
  assert.equal(fs.readFileSync(packPath, "utf8"), "# Manual Research Pack\n\nKeep this human edit.\n");

  const overwritten = captureConsole(() => packageResearchPackScript.main([runDir, "--overwrite"]));
  assert.equal(overwritten.result, 0);
  assert.match(fs.readFileSync(packPath, "utf8"), /Manual Preserve Test/);
});

test("research evidence help works", () => {
  const output = captureConsole(() => packageResearchEvidenceScript.main(["--help"]));
  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-research-evidence\.js/);
  assert.match(output.stdout.join("\n"), /--overwrite/);
  assert.match(output.stdout.join("\n"), /--reset-evidence/);
});

test("research evidence blocks missing selected package", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-missing-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-missing");
  fs.mkdirSync(runDir, { recursive: true });

  const output = captureConsole(() => packageResearchEvidenceScript.main([runDir]));
  const review = fs.readFileSync(path.join(runDir, "research-sufficiency-review.md"), "utf8");

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /research evidence: BLOCKED/);
  assert.match(review, /Research sufficiency status: BLOCKED/);
  assert.match(review, /selected-package\.json or selected-package\.md is missing/);
});

test("research evidence placeholder rows do not pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-placeholder-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-placeholder");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Placeholder Evidence" } }));

  const output = captureConsole(() => packageResearchEvidenceScript.main([runDir]));
  const evaluation = packageResearchEvidenceScript.evaluateResearchEvidence(runDir);

  assert.equal(output.result, 0);
  assert.equal(evaluation.status, "NEEDS EVIDENCE");
  assert.equal(evaluation.sourceCount, 0);
  assert.equal(evaluation.proofCount, 0);
  assert.equal(evaluation.objectionCount, 0);
});

test("research evidence to-verify source rows do not count as concrete sources", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-source-status-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-source-status");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Source Status" } }));
  fs.writeFileSync(
    path.join(runDir, "source-support-map.md"),
    `# Source Support Map

| source/reference | claim supported | evidence type | reliability note | status |
| --- | --- | --- | --- | --- |
| local-notes/package-review.md | Local package decision exists for the episode premise. | local artifact | Human-created run artifact. | review-needed |
| Manual external source candidate: YouTube Creator Academy page to find later | External guidance may support the packaging claim. | external candidate | Not verified yet. | to-verify |
`,
    "utf8"
  );

  const evaluation = packageResearchEvidenceScript.evaluateResearchEvidence(runDir);

  assert.equal(evaluation.sourceCount, 1);
  assert.equal(evaluation.status, "NEEDS EVIDENCE");
});

test("research evidence planned proof rows do not count as concrete proof", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-proof-status-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-proof-status");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Proof Status" } }));
  fs.writeFileSync(
    path.join(runDir, "proof-capture-plan.md"),
    `# Proof Capture Plan

| proof item | what it proves | local capture method | file/app/source | status |
| --- | --- | --- | --- | --- |
| Raw AI suggestions vs selected package | Shows the local selection workflow. | Capture screenshots later. | local package-run workspace | planned |
`,
    "utf8"
  );

  const evaluation = packageResearchEvidenceScript.evaluateResearchEvidence(runDir);

  assert.equal(evaluation.proofCount, 0);
  assert.equal(evaluation.status, "NEEDS EVIDENCE");
});

test("research evidence current real-run pattern remains needs evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-real-pattern-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-real-pattern");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Real Pattern" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: source list is TODO\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-evidence.md"),
    `# Research Evidence

- External source candidates must still be manually verified before being treated as factual support.

- Research approval: TODO
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "source-support-map.md"),
    `# Source Support Map

| source/reference | claim supported | evidence type | reliability note | status |
| --- | --- | --- | --- | --- |
| selected-package.json | The local run selected a package about using AI for faster video ideation while keeping creator judgment in control. | local package record | Concrete local artifact, but it does not verify external audience demand. | review-needed |
| Manual external source candidate: YouTube Creator Academy, YouTube Help, or Creator Insider guidance | Creator-owned packaging and audience judgment should be considered separately from raw idea generation. | external reference candidate | To verify manually before use. | to-verify |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "proof-capture-plan.md"),
    `# Proof Capture Plan

| proof item | what it proves | local capture method | file/app/source | status |
| --- | --- | --- | --- | --- |
| Raw AI suggestions vs package scorecard vs selected package vs rejected generic suggestion | Shows the practical workflow boundary. | Screen-record the local package-run workflow later. | local package-run artifacts and AI ideation workspace | planned |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-objections.md"),
    `# Research Objections

| objection/counterexample | why it matters | evidence needed | response plan | status |
| --- | --- | --- | --- | --- |
| AI can help expand options, reveal angles, and speed up ideation; the issue is outsourcing final strategy, taste, and positioning. | Prevents the episode from becoming an anti-AI strawman. | Local example where AI suggestions include at least one useful angle. | Frame the recommendation as human-owned final judgment after AI-assisted exploration. | review-needed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
| No blockers detected. | Evidence is ready for review. | Keep sources attached. | closed |
`,
    "utf8"
  );

  const evaluation = packageResearchEvidenceScript.evaluateResearchEvidence(runDir);
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir);

  assert.equal(evaluation.sourceCount, 1);
  assert.equal(evaluation.proofCount, 0);
  assert.equal(evaluation.objectionCount, 1);
  assert.equal(evaluation.status, "NEEDS EVIDENCE");
  assert.equal(doctor.lifecycleGate.researchSufficiencyReviewStatus, "NEEDS EVIDENCE");
  assert.match(doctor.nextRecommendedCommand, /package-run-research-evidence\.js/);
  assert.match(doctor.firstBlockerReason, /Research evidence review is NEEDS EVIDENCE/);
});

test("research evidence captured or review-needed proof can be ready without approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-review-proof-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-review-proof");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Review Proof" } }));
  fs.writeFileSync(
    path.join(runDir, "source-support-map.md"),
    `# Source Support Map

| source/reference | claim supported | evidence type | reliability note | status |
| --- | --- | --- | --- | --- |
| selected-package.json | The local package decision exists and names the viewer promise. | local artifact | Local package-run artifact. | review-needed |
| package-candidates.json | The candidate pool contains raw options before selection. | local artifact | Local package-run artifact. | review-needed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "proof-capture-plan.md"),
    `# Proof Capture Plan

| proof item | what it proves | local capture method | file/app/source | status |
| --- | --- | --- | --- | --- |
| captured-ai-idea-comparison.png | Shows raw AI options beside the selected package. | Screenshot captured locally. | captured-ai-idea-comparison.png | captured |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-objections.md"),
    `# Research Objections

| objection/counterexample | why it matters | evidence needed | response plan | status |
| --- | --- | --- | --- | --- |
| AI may surface useful options even if final strategy remains human-owned. | Keeps the argument from becoming anti-AI. | Compare useful AI option with rejected generic option. | Frame AI as exploration support, not final authority. | review-needed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
| No blockers detected. | Evidence is ready for review. | Keep sources attached. | closed |
`,
    "utf8"
  );

  const evaluation = packageResearchEvidenceScript.evaluateResearchEvidence(runDir);

  assert.equal(evaluation.status, "READY FOR RESEARCH REVIEW");
  assert.equal(evaluation.approval, false);
  assert.equal(evaluation.sourceCount, 2);
  assert.equal(evaluation.proofCount, 1);
  assert.equal(evaluation.objectionCount, 1);
});

function writeConcreteResearchEvidence(runDir, approval = "") {
  fs.writeFileSync(
    path.join(runDir, "source-support-map.md"),
    `# Source Support Map

| source/reference | claim supported | evidence type | reliability note | status |
| --- | --- | --- | --- | --- |
| local-notes/resolve-test-log.md | Playback lag diagnosis needs source media and timeline context. | local test note | Human-captured local project observation. | closed |
| docs/creator-comments-summary.md | Solo creators confuse cache, disk, and codec bottlenecks. | local research note | Summarized from local creator notes. | closed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "proof-capture-plan.md"),
    `# Proof Capture Plan

| proof item | what it proves | local capture method | file/app/source | status |
| --- | --- | --- | --- | --- |
| Resolve timeline playback before and after cache toggle | Shows whether the suspected bottleneck changes playback. | Screen-record Resolve timeline and system monitor. | DaVinci Resolve local project | closed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-objections.md"),
    `# Research Objections

| objection/counterexample | why it matters | evidence needed | response plan | status |
| --- | --- | --- | --- | --- |
| Playback lag may be caused by unsupported media rather than settings. | Prevents a misleading one-size-fits-all fix. | Show media info and timeline settings. | Frame script as diagnosis, not universal fix. | closed |
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-evidence.md"),
    `# Research Evidence

Concrete local evidence is listed in the support map and proof plan.

${approval}
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
| No blockers detected. | Evidence is ready for review. | Keep sources attached. | closed |
`,
    "utf8"
  );
}

test("research evidence concrete evidence without approval is ready for review not pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-ready");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Ready Evidence" } }));
  writeConcreteResearchEvidence(runDir);

  const evaluation = packageResearchEvidenceScript.evaluateResearchEvidence(runDir);

  assert.equal(evaluation.status, "READY FOR RESEARCH REVIEW");
  assert.equal(evaluation.approval, false);
  assert.equal(evaluation.sourceCount, 2);
  assert.equal(evaluation.proofCount, 1);
  assert.equal(evaluation.objectionCount, 1);
});

test("research evidence exact approval can pass only with concrete evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-pass-"));
  const passDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-pass");
  const approvalOnlyDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-approval-only");
  fs.mkdirSync(passDir, { recursive: true });
  fs.mkdirSync(approvalOnlyDir, { recursive: true });
  fs.writeFileSync(path.join(passDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Pass Evidence" } }));
  fs.writeFileSync(path.join(approvalOnlyDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Approval Only" } }));
  writeConcreteResearchEvidence(passDir, "Research approval: PASS");
  fs.writeFileSync(path.join(approvalOnlyDir, "research-evidence.md"), "# Evidence\n\nResearch approval: PASS\n", "utf8");

  assert.equal(packageResearchEvidenceScript.evaluateResearchEvidence(passDir).status, "PASS");
  assert.notEqual(packageResearchEvidenceScript.evaluateResearchEvidence(approvalOnlyDir).status, "PASS");
});

test("research evidence preserves existing evidence files even with overwrite", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-preserve-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-preserve");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Preserve Evidence" } }));
  const evidencePath = path.join(runDir, "research-evidence.md");
  fs.writeFileSync(evidencePath, "# Human Evidence\n\nKeep this.\n", "utf8");

  packageResearchEvidenceScript.runResearchEvidence(runDir);
  assert.equal(fs.readFileSync(evidencePath, "utf8"), "# Human Evidence\n\nKeep this.\n");

  packageResearchEvidenceScript.runResearchEvidence(runDir, { overwrite: true });
  assert.equal(fs.readFileSync(evidencePath, "utf8"), "# Human Evidence\n\nKeep this.\n");
});

test("research evidence overwrite preserves concrete evidence and refreshes derived review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-overwrite-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-overwrite");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Overwrite Evidence" } }));
  writeConcreteResearchEvidence(runDir);
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
| stale source blocker | Old generated review should be refreshed. | Re-run the tool. | blocked |
`,
    "utf8"
  );
  const sourceMapBefore = fs.readFileSync(path.join(runDir, "source-support-map.md"), "utf8");
  const proofPlanBefore = fs.readFileSync(path.join(runDir, "proof-capture-plan.md"), "utf8");
  const objectionsBefore = fs.readFileSync(path.join(runDir, "research-objections.md"), "utf8");
  const evidenceBefore = fs.readFileSync(path.join(runDir, "research-evidence.md"), "utf8");

  const result = packageResearchEvidenceScript.runResearchEvidence(runDir, { overwrite: true });
  const review = fs.readFileSync(path.join(runDir, "research-sufficiency-review.md"), "utf8");

  assert.equal(fs.readFileSync(path.join(runDir, "source-support-map.md"), "utf8"), sourceMapBefore);
  assert.equal(fs.readFileSync(path.join(runDir, "proof-capture-plan.md"), "utf8"), proofPlanBefore);
  assert.equal(fs.readFileSync(path.join(runDir, "research-objections.md"), "utf8"), objectionsBefore);
  assert.equal(fs.readFileSync(path.join(runDir, "research-evidence.md"), "utf8"), evidenceBefore);
  assert.equal(result.evaluation.status, "READY FOR RESEARCH REVIEW");
  assert.match(review, /Research sufficiency status: READY FOR RESEARCH REVIEW/);
  assert.doesNotMatch(review, /stale source blocker/);
  assert.match(review, /review-needed/);
});

test("research evidence creates missing evidence files and reset requires explicit flag", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-reset-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-reset");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Reset Evidence" } }));

  packageResearchEvidenceScript.runResearchEvidence(runDir);
  assert.equal(fs.existsSync(path.join(runDir, "research-evidence.md")), true);
  assert.equal(fs.existsSync(path.join(runDir, "source-support-map.md")), true);

  writeConcreteResearchEvidence(runDir);
  packageResearchEvidenceScript.runResearchEvidence(runDir, { overwrite: true });
  assert.match(fs.readFileSync(path.join(runDir, "source-support-map.md"), "utf8"), /local-notes\/resolve-test-log\.md/);

  packageResearchEvidenceScript.runResearchEvidence(runDir, { resetEvidence: true, overwrite: true });
  assert.match(fs.readFileSync(path.join(runDir, "source-support-map.md"), "utf8"), /\| TODO \| TODO \| TODO \| TODO \| open \|/);
});

test("package run doctor routes partial research to research evidence tool", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-doctor-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-doctor");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Doctor Research Route" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: sources missing\n",
    "utf8"
  );
  const before = fs.readdirSync(runDir).sort();

  const report = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(report.lifecycleGate.researchGateStatus, "PARTIAL");
  assert.match(report.nextRecommendedCommand, /package-run-research-evidence\.js/);
  assert.match(report.firstBlockerReason, /Research Sufficiency Gate is PARTIAL/);
});

test("package run doctor routes needs-evidence review back to research evidence intake", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-needs-doctor-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-needs-doctor");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Needs Evidence Route" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: sources missing\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: NEEDS EVIDENCE
- Source references: 0
- Production-proof items: 0
- Objections/counterexamples: 0
- Research approval marker: missing
`,
    "utf8"
  );
  const before = fs.readdirSync(runDir).sort();

  const report = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(report.lifecycleGate.researchGateStatus, "PARTIAL");
  assert.equal(report.lifecycleGate.researchSufficiencyReviewStatus, "NEEDS EVIDENCE");
  assert.equal(report.lifecycleGate.researchSourceReferenceCount, 0);
  assert.match(report.nextRecommendedCommand, /package-run-research-evidence\.js/);
  assert.match(report.firstBlockerReason, /Research evidence review is NEEDS EVIDENCE/);
});

test("package run doctor reports ready research evidence as manual review blocker", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-ready-doctor-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-ready-doctor");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Ready Evidence Route" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: awaiting manual review\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: READY FOR RESEARCH REVIEW
- Source references: 2
- Production-proof items: 1
- Objections/counterexamples: 1
- Research approval marker: missing
`,
    "utf8"
  );
  const before = fs.readdirSync(runDir).sort();

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const run = index.runs[0];
  const report = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(run.lifecycleGate.researchSufficiencyReviewStatus, "READY FOR RESEARCH REVIEW");
  assert.equal(run.lifecycleGate.researchSourceReferenceCount, 2);
  assert.equal(run.lifecycleGate.researchProductionProofCount, 1);
  assert.equal(run.lifecycleGate.researchObjectionCount, 1);
  assert.doesNotMatch(run.nextRecommendedCommand, /package-run-research-evidence\.js/);
  assert.doesNotMatch(report.nextRecommendedCommand, /package-run-research-evidence\.js/);
  assert.match(report.firstBlockerReason, /READY FOR RESEARCH REVIEW/);
  assert.deepEqual(report.missingExpectedArtifacts, [
    "manual research review decision / Research approval: PASS or keep blocked",
  ]);
});

test("package run doctor lets research sufficiency review pass reach script structure blocker", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-research-evidence-pass-doctor-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-evidence-pass-doctor");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Pass Evidence Route" } }));
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: derived review approved\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    `# Research Sufficiency Review

- Research sufficiency status: PASS
- Source references: 2
- Production-proof items: 1
- Objections/counterexamples: 1
- Research approval marker: PASS
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: PARTIAL\n- Ready to draft: no\n",
    "utf8"
  );
  const before = fs.readdirSync(runDir).sort();

  const report = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(report.lifecycleGate.researchGateStatus, "PARTIAL");
  assert.equal(report.lifecycleGate.researchSufficiencyReviewStatus, "PASS");
  assert.match(report.nextRecommendedCommand, /package-run-script-structure\.js/);
  assert.match(report.firstBlockerReason, /Script structure status is PARTIAL/);
  assert.deepEqual(report.missingExpectedArtifacts, [
    "script-structure.md with Script structure status: READY TO DRAFT",
  ]);
});

test("verify script checks research evidence syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/package-run-research-evidence\.js/);
});

test("package runs index classifies workflow status from detected files", () => {
  const files = {};
  packageRunsIndexScript.DETECTED_FILES.forEach((filename) => {
    files[packageRunsIndexScript.fileKey(filename)] = false;
  });

  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Idea run");
  files.selected_package_json = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Package selected");
  files.research_pack = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Research pack ready");
  files.outline_prompt = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Outline prep ready");
  files.final_outline = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Final outline ready");
  files.script_prompt = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Script prep ready");
  files.final_script = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Final script ready");
  files.production_brief = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Production prep ready");
  packageRunsIndexScript.PRODUCTION_ARTIFACTS.forEach((filename) => {
    files[packageRunsIndexScript.fileKey(filename)] = true;
  });
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Ready to shoot");
  assert.equal(packageRunsIndexScript.classifyRunStatus(files, "not run"), "Ready to shoot");
  assert.equal(packageRunsIndexScript.classifyRunStatus(files, "FAIL"), "Production prep ready");
  assert.equal(packageRunsIndexScript.classifyRunStatus(files, "NEEDS WORK"), "Production prep ready");
  assert.equal(packageRunsIndexScript.classifyRunStatus(files, "REVIEW REQUIRED"), "Production prep ready");
  assert.equal(packageRunsIndexScript.workflowBucket("Production prep ready", "FAIL"), "Needs QA repair");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "not run"), "QA not run");
  assert.equal(packageRunsIndexScript.workflowBucket("Package selected"), "Needs research pack");
  assert.equal(packageRunsIndexScript.workflowBucket("Research pack ready"), "Needs outline");
});

test("package runs readiness buckets are conservative for creator qa status", () => {
  const evidenceBlocking = { blocksProductionReady: true };
  const narrowApproval = { blocksProductionReady: true, hasNarrowShootingApproval: true };

  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "PASS"), "Ready to shoot");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "not run"), "QA not run");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "FAIL"), "Needs QA repair");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "NEEDS WORK"), "Needs QA repair");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "REVIEW REQUIRED"), "Needs QA repair");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "PASS", evidenceBlocking), "Needs proof capture");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "not run", narrowApproval), "Narrow shooting approved");
});

test("package runs index reports conservative evidence gate status", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-gate-"));
  const planOnlyDir = path.join(tempRoot, "plan-only");
  const missingDir = path.join(tempRoot, "missing");
  const transcriptDir = path.join(tempRoot, "transcript");
  const capturedDir = path.join(tempRoot, "captured");
  const narrowDir = path.join(tempRoot, "narrow");
  [planOnlyDir, missingDir, transcriptDir, capturedDir, narrowDir].forEach((runDir) => fs.mkdirSync(runDir, { recursive: true }));

  fs.writeFileSync(path.join(planOnlyDir, "capture-verification-note.md"), "# Capture Verification Note\n");

  fs.writeFileSync(path.join(missingDir, "capture-verification-note.md"), "# Capture Verification Note\n");
  fs.writeFileSync(
    path.join(missingDir, "capture-result-note.md"),
    "# Capture Result Note\n\nNo captured output exists.\n"
  );

  fs.writeFileSync(path.join(transcriptDir, "capture-verification-note.md"), "# Capture Verification Note\n");
  fs.writeFileSync(
    path.join(transcriptDir, "capture-result-note.md"),
    "# Capture Result Note\n\nCaptured transcript available in `capture-transcript.md`.\n"
  );
  fs.writeFileSync(path.join(transcriptDir, "capture-transcript.md"), "# Capture Transcript\n");

  fs.writeFileSync(path.join(capturedDir, "capture-verification-note.md"), "# Capture Verification Note\n");
  fs.writeFileSync(
    path.join(capturedDir, "capture-result-note.md"),
    "# Capture Result Note\n\nScreen recording imported as `capture-recording.mp4`.\n"
  );
  fs.writeFileSync(path.join(capturedDir, "capture-recording.mp4"), "fake mp4 placeholder\n");

  fs.writeFileSync(path.join(narrowDir, "capture-verification-note.md"), "# Capture Verification Note\n");
  fs.writeFileSync(
    path.join(narrowDir, "capture-result-note.md"),
    "# Capture Result Note\n\nCaptured transcript available in `capture-transcript.md`.\n"
  );
  fs.writeFileSync(path.join(narrowDir, "capture-transcript.md"), "# Capture Transcript\n");
  fs.writeFileSync(
    path.join(narrowDir, "narrow-shooting-approval.md"),
    "# Narrow Shooting Approval\n\n- Status: approved for narrow shooting only\n\nThis approval does not approve editing, publishing, upload prep, final title, final thumbnail, production readiness, project-state promotion, Hermes brain write, commit, or push.\n"
  );

  assert.deepEqual(packageRunsIndexScript.readEvidenceGate(planOnlyDir), {
    status: "planned proof only",
    warning: "Not production-ready: proof capture missing",
    blocksProductionReady: true,
    hasCapturePlan: true,
    hasCaptureResult: false,
    saysNoCapturedOutput: false,
    hasCaptureTranscript: false,
    hasVisualCapture: false,
    evidenceReferences: [],
    hasNarrowShootingApproval: false,
    approvedActions: [],
    blockedActions: [],
    approvalReference: "",
  });

  const missingGate = packageRunsIndexScript.readEvidenceGate(missingDir);
  assert.equal(missingGate.status, "capture missing");
  assert.equal(missingGate.saysNoCapturedOutput, true);
  assert.equal(missingGate.blocksProductionReady, true);

  const transcriptGate = packageRunsIndexScript.readEvidenceGate(transcriptDir);
  assert.equal(transcriptGate.status, "transcript captured; visual proof missing");
  assert.equal(transcriptGate.hasCaptureTranscript, true);
  assert.equal(transcriptGate.hasVisualCapture, false);
  assert.equal(transcriptGate.blocksProductionReady, true);
  assert.deepEqual(transcriptGate.evidenceReferences, ["capture-transcript.md"]);

  const capturedGate = packageRunsIndexScript.readEvidenceGate(capturedDir);
  assert.equal(capturedGate.status, "proof captured");
  assert.equal(capturedGate.hasVisualCapture, true);
  assert.equal(capturedGate.blocksProductionReady, false);
  assert.deepEqual(capturedGate.evidenceReferences, ["capture-recording.mp4"]);

  const narrowGate = packageRunsIndexScript.readEvidenceGate(narrowDir);
  assert.equal(narrowGate.status, "transcript captured; visual proof missing; narrow shooting approved");
  assert.equal(narrowGate.blocksProductionReady, true);
  assert.equal(narrowGate.hasNarrowShootingApproval, true);
  assert.deepEqual(narrowGate.approvedActions, ["narrow shooting"]);
  assert.deepEqual(narrowGate.blockedActions, [
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
  ]);
  assert.equal(narrowGate.approvalReference, "narrow-shooting-approval.md");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "not run", narrowGate), "Narrow shooting approved");

  assert.equal(
    packageRunsIndexScript.workflowBucket("Ready to shoot", "PASS", transcriptGate),
    "Needs proof capture"
  );
});

test("package runs index scans package-runs folders and writes index json", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-runs-index-"));
  const runsDir = path.join(tempRoot, "package-runs");
  const ideaDir = path.join(runsDir, "2026-05-01-idea");
  const shootDir = path.join(runsDir, "2026-05-02-ready");
  const qaMissingDir = path.join(runsDir, "2026-05-03-qa-missing");
  const qaFailDir = path.join(runsDir, "2026-05-04-qa-fail");
  fs.mkdirSync(ideaDir, { recursive: true });
  fs.mkdirSync(shootDir, { recursive: true });
  fs.mkdirSync(qaMissingDir, { recursive: true });
  fs.mkdirSync(qaFailDir, { recursive: true });
  fs.writeFileSync(path.join(ideaDir, "package-candidates.json"), "{\"candidates\":[]}\n");
  fs.writeFileSync(
    path.join(shootDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Ready Package" } })
  );
  fs.writeFileSync(path.join(shootDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "NEEDS WORK" }));
  fs.writeFileSync(path.join(shootDir, "creator-qa-report.md"), "# Creator QA Report\n");
  [
    "package-candidates.json",
    "outline-prompt.md",
    "final-outline.md",
    "script-prompt.md",
    "final-script.md",
    "production-plan.md",
    "production-blockers.md",
    "shot-edit-plan-review.md",
    "shot-edit-plan-enhancement-plan.md",
    "capture-checklist.md",
    "takes-log.md",
    "missing-shot-tracker.md",
    "screen-recording-checklist.md",
    "audio-capture-checklist.md",
    "rough-cut-watch-notes.md",
    "rough-cut-review.md",
    "pickup-list.md",
    "edit-fix-list.md",
    "final-watch-notes.md",
    "final-review.md",
    "publication-blockers.md",
    "export-checklist.md",
    "master-file-manifest.md",
    "caption-check.md",
    "loudness-check.md",
    "delivery-readiness.md",
    "publish-metadata-review.md",
    "title-check.md",
    "thumbnail-check.md",
    "description-check.md",
    "chapters-check.md",
    "schedule-check.md",
    "archive-manifest.md",
    "archive-source-files.md",
    "archive-assets-manifest.md",
    "archive-export-manifest.md",
    "reusable-clips-manifest.md",
    "archive-blockers.md",
    "production-brief.md",
    "shooting-plan.md",
    "b-roll-list.md",
    "graphics-list.md",
    "resolve-edit-checklist.md",
    "thumbnail-title-check.md",
    "publish-pack.md",
    "repurposing-plan.md",
    "shorts-candidates.md",
    "platform-variants.md",
  ].forEach((filename) => {
    if (filename !== "package-candidates.json") fs.writeFileSync(path.join(shootDir, filename), `${filename}\n`);
    if (filename !== "package-candidates.json") fs.writeFileSync(path.join(qaMissingDir, filename), `${filename}\n`);
    if (filename !== "package-candidates.json") fs.writeFileSync(path.join(qaFailDir, filename), `${filename}\n`);
  });
  fs.writeFileSync(
    path.join(qaFailDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Failed QA Package" } })
  );
  fs.writeFileSync(path.join(qaFailDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "FAIL" }));
  fs.writeFileSync(path.join(qaFailDir, "creator-qa-report.md"), "# Creator QA Report\n\nOverall: FAIL\n");

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const outFile = path.join(tempRoot, "package-runs-index.json");
  const output = packageRunsIndexScript.main(["--runs-dir", runsDir, "--out", outFile]);
  const written = JSON.parse(fs.readFileSync(outFile, "utf8"));

  const byRunId = Object.fromEntries(index.runs.map((run) => [run.runId, run]));

  assert.equal(index.count, 4);
  assert.equal(byRunId["2026-05-02-ready"].status, "Needs production planning");
  assert.equal(byRunId["2026-05-02-ready"].workflowBucket, "Needs QA repair");
  assert.equal(byRunId["2026-05-02-ready"].creatorQaStatus, "NEEDS WORK");
  assert.equal(
    byRunId["2026-05-02-ready"].nextRecommendedCommand,
    "Review Creator QA status NEEDS WORK and repair package/script before shooting."
  );
  assert.equal(byRunId["2026-05-02-ready"].files.creator_qa_report, true);
  assert.equal(byRunId["2026-05-02-ready"].files.creator_qa_report_json, true);
  assert.equal(byRunId["2026-05-02-ready"].files.production_plan, true);
  assert.equal(byRunId["2026-05-02-ready"].files.production_blockers, true);
  assert.equal(byRunId["2026-05-02-ready"].files.shot_edit_plan_review, true);
  assert.equal(byRunId["2026-05-02-ready"].files.shot_edit_plan_enhancement_plan, true);
  assert.equal(byRunId["2026-05-02-ready"].files.capture_checklist, true);
  assert.equal(byRunId["2026-05-02-ready"].files.takes_log, true);
  assert.equal(byRunId["2026-05-02-ready"].files.missing_shot_tracker, true);
  assert.equal(byRunId["2026-05-02-ready"].files.screen_recording_checklist, true);
  assert.equal(byRunId["2026-05-02-ready"].files.audio_capture_checklist, true);
  assert.equal(byRunId["2026-05-02-ready"].files.rough_cut_watch_notes, true);
  assert.equal(byRunId["2026-05-02-ready"].files.rough_cut_review, true);
  assert.equal(byRunId["2026-05-02-ready"].files.pickup_list, true);
  assert.equal(byRunId["2026-05-02-ready"].files.edit_fix_list, true);
  assert.equal(byRunId["2026-05-02-ready"].files.final_watch_notes, true);
  assert.equal(byRunId["2026-05-02-ready"].files.final_review, true);
  assert.equal(byRunId["2026-05-02-ready"].files.publication_blockers, true);
  assert.equal(byRunId["2026-05-02-ready"].files.export_checklist, true);
  assert.equal(byRunId["2026-05-02-ready"].files.master_file_manifest, true);
  assert.equal(byRunId["2026-05-02-ready"].files.caption_check, true);
  assert.equal(byRunId["2026-05-02-ready"].files.loudness_check, true);
  assert.equal(byRunId["2026-05-02-ready"].files.delivery_readiness, true);
  assert.equal(byRunId["2026-05-02-ready"].files.publish_metadata_review, true);
  assert.equal(byRunId["2026-05-02-ready"].files.title_check, true);
  assert.equal(byRunId["2026-05-02-ready"].files.thumbnail_check, true);
  assert.equal(byRunId["2026-05-02-ready"].files.description_check, true);
  assert.equal(byRunId["2026-05-02-ready"].files.chapters_check, true);
  assert.equal(byRunId["2026-05-02-ready"].files.schedule_check, true);
  assert.equal(byRunId["2026-05-02-ready"].files.archive_manifest, true);
  assert.equal(byRunId["2026-05-02-ready"].files.archive_source_files, true);
  assert.equal(byRunId["2026-05-02-ready"].files.archive_assets_manifest, true);
  assert.equal(byRunId["2026-05-02-ready"].files.archive_export_manifest, true);
  assert.equal(byRunId["2026-05-02-ready"].files.reusable_clips_manifest, true);
  assert.equal(byRunId["2026-05-02-ready"].files.archive_blockers, true);
  assert.equal(byRunId["2026-05-02-ready"].files.repurposing_plan, true);
  assert.equal(byRunId["2026-05-02-ready"].files.shorts_candidates, true);
  assert.equal(byRunId["2026-05-02-ready"].files.platform_variants, true);
  assert.equal(byRunId["2026-05-02-ready"].title, "Ready Package");
  assert.equal(byRunId["2026-05-03-qa-missing"].status, "Needs production planning");
  assert.equal(byRunId["2026-05-03-qa-missing"].workflowBucket, "Needs production planning");
  assert.equal(
    byRunId["2026-05-03-qa-missing"].nextRecommendedCommand,
    "node scripts/package-run-production-plan.js package-runs/2026-05-03-qa-missing"
  );
  assert.equal(byRunId["2026-05-04-qa-fail"].status, "Needs production planning");
  assert.equal(byRunId["2026-05-04-qa-fail"].workflowBucket, "Needs QA repair");
  assert.equal(byRunId["2026-05-04-qa-fail"].creatorQaStatus, "FAIL");
  assert.equal(byRunId["2026-05-04-qa-fail"].nextRecommendedCommand, "Review creator-qa-report.md and repair package/script before shooting.");
  assert.equal(byRunId["2026-05-01-idea"].status, "Idea run");
  assert.equal(byRunId["2026-05-01-idea"].creatorQaStatus, "not run");
  assert.equal(byRunId["2026-05-01-idea"].workflowBucket, "Needs package selection");
  assert.equal(written.count, 4);
  assert.equal(written.statuses["Needs production planning"], 3);
  assert.equal(output, 0);
});

test("package run state defaults to active when marker is absent", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-state-default-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-default-active");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Default Active" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "b-roll-list.md"), "# B-Roll List\n", "utf8");
  fs.writeFileSync(path.join(runDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "NEEDS WORK" }), "utf8");

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });

  assert.equal(run.packageRunState.explicit, false);
  assert.equal(run.packageRunState.state, "active");
  assert.equal(run.inactive, false);
  assert.equal(run.status, "Needs production planning");
  assert.equal(run.workflowBucket, "Needs QA repair");
  assert.equal(doctor.workflowBucket, "Needs QA repair");
  assert.deepEqual(doctor.blockingReasons, ["Creator QA status is NEEDS WORK."]);
});

test("package run state superseded removes run from active blocker buckets without approving downstream work", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-state-superseded-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-superseded");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\n- Package run state: superseded\n", "utf8");
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Superseded Run" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "b-roll-list.md"), "# B-Roll List\n", "utf8");
  fs.writeFileSync(path.join(runDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "NEEDS WORK" }), "utf8");
  fs.writeFileSync(path.join(runDir, "capture-checklist.md"), "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n", "utf8");
  fs.writeFileSync(path.join(runDir, "final-review.md"), "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "delivery-readiness.md"), "# Delivery Readiness\n\n- Ready to upload: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "archive-manifest.md"), "# Archive Manifest\n\n- Ready to archive: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "repurposing-plan.md"), "# Repurposing Plan\n\n- Ready to cut shorts: yes\n", "utf8");

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const run = index.runs[0];
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });

  assert.equal(index.activeCount, 0);
  assert.equal(index.inactiveCount, 1);
  assert.deepEqual(index.inactiveRuns, [
    {
      runId: "2026-05-10-superseded",
      path: "package-runs/2026-05-10-superseded",
      state: "superseded",
      status: "Inactive: superseded",
      activeStatus: "Needs production planning",
      activeWorkflowBucket: "Needs QA repair",
    },
  ]);
  assert.equal(run.status, "Inactive: superseded");
  assert.equal(run.activeStatus, "Needs production planning");
  assert.equal(run.workflowBucket, "Inactive: superseded");
  assert.equal(run.activeWorkflowBucket, "Needs QA repair");
  assert.equal(run.overallStatus, "INACTIVE: SUPERSEDED");
  assert.equal(run.firstBlockerReason, "Package run is superseded; inactive diagnostics do not count as active blockers.");
  assert.deepEqual(run.missingExpectedArtifacts, []);
  assert.equal(run.lifecycleGate.effectiveReadiness.captureApproved, false);
  assert.equal(run.lifecycleGate.effectiveReadiness.publishReady, false);
  assert.equal(run.lifecycleGate.effectiveReadiness.readyToUpload, false);
  assert.equal(run.lifecycleGate.effectiveReadiness.readyToArchive, false);
  assert.equal(run.lifecycleGate.effectiveReadiness.readyToCutShorts, false);
  assert.equal(doctor.workflowBucket, "Inactive: superseded");
  assert.equal(doctor.activeWorkflowBucket, "Needs QA repair");
  assert.deepEqual(doctor.blockingReasons, []);
  assert.equal(doctor.effectiveReadiness.captureApproved, false);
  assert.equal(doctor.effectiveReadiness.publishReady, false);
  assert.equal(doctor.effectiveReadiness.readyToUpload, false);
  assert.equal(doctor.effectiveReadiness.readyToArchive, false);
  assert.equal(doctor.effectiveReadiness.readyToCutShorts, false);
});

test("package run state parked removes run from active blocker buckets", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-state-parked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-parked");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\nPackage run state: parked\n", "utf8");
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Parked Run" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "b-roll-list.md"), "# B-Roll List\n", "utf8");
  fs.writeFileSync(path.join(runDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "FAIL" }), "utf8");

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);

  assert.equal(run.packageRunState.state, "parked");
  assert.equal(run.inactive, true);
  assert.equal(run.status, "Inactive: parked");
  assert.equal(run.activeStatus, "Needs production planning");
  assert.equal(run.workflowBucket, "Inactive: parked");
  assert.equal(run.activeWorkflowBucket, "Needs QA repair");
  assert.notEqual(run.workflowBucket, "Needs QA repair");
  assert.equal(run.lifecycleGate.effectiveCaptureApproved, false);
  assert.equal(run.lifecycleGate.effectivePublishReady, false);
  assert.equal(run.lifecycleGate.effectiveReadyToUpload, false);
  assert.equal(run.lifecycleGate.effectiveReadyToArchive, false);
  assert.equal(run.lifecycleGate.effectiveReadyToCutShorts, false);
});

test("inactive package run diagnostics use active lifecycle before readiness override", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-state-active-diagnostics-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-inactive-diagnostics");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\n- Package run state: superseded\n", "utf8");
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Inactive Diagnostics" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n\n## Open Blockers\n\n- None.\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-enhancement-plan.md"), "# Shot/Edit Plan Enhancement Plan\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "capture-checklist.md"),
    "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "takes-log.md"),
    "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| A-roll | shot-list.md | media/a-roll.mov | Reviewed. | captured |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "missing-shot-tracker.md"),
    "# Missing Shot Tracker\n\n| missing shot/content | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Complete. | No fix needed. | closed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "screen-recording-checklist.md"),
    "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Proof | Shows flow. | media/proof.mp4 | captured |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "audio-capture-checklist.md"),
    "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Narration. | audio/voiceover.wav | captured |\n\nAudio capture readiness: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "capture-evidence-review.md"),
    "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Real capture evidence detected: yes\n",
    "utf8"
  );

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);

  assert.equal(run.status, "Inactive: superseded");
  assert.equal(run.workflowBucket, "Inactive: superseded");
  assert.equal(run.activeStatus, "Ready for rough cut");
  assert.equal(run.activeWorkflowBucket, "Needs rough-cut review");
  assert.equal(run.lifecycleGate.hasConcreteCaptureEvidence, true);
  assert.equal(run.lifecycleGate.effectiveReadiness.captureApproved, false);
  assert.equal(run.lifecycleGate.effectiveReadiness.readyForRoughCut, false);
  assert.equal(run.lifecycleGate.effectiveReadiness.publishReady, false);
  assert.match(run.lifecycleGate.effectiveReadiness.overrideReason, /Package run is superseded/);
});

test("unknown package run state is ignored conservatively as active", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-state-unknown-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-unknown-state");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\n- Package run state: finished\n", "utf8");
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Unknown State" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "b-roll-list.md"), "# B-Roll List\n", "utf8");
  fs.writeFileSync(path.join(runDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "NEEDS WORK" }), "utf8");

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);

  assert.equal(run.packageRunState.explicit, false);
  assert.equal(run.packageRunState.state, "active");
  assert.equal(run.packageRunState.isInactive, false);
  assert.match(run.packageRunState.warning, /Unknown package-run state marker ignored/);
  assert.equal(run.workflowBucket, "Needs QA repair");
  assert.equal(run.overallStatus, "BLOCKED");
});

test("current May 2 active package run remains blocked at production planning without a state marker", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const runDir = path.join(repoRoot, "package-runs", "2026-05-02-ai-video-idea-filter");
  if (!fs.existsSync(runDir)) return;

  const run = packageRunsIndexScript.scanRun(runDir, repoRoot);

  assert.equal(fs.existsSync(path.join(runDir, "package-run-state.md")), false);
  assert.equal(run.packageRunState.explicit, false);
  assert.equal(run.inactive, false);
  assert.equal(run.status, "Needs production planning");
  assert.equal(run.workflowBucket, "Needs production planning");
  assert.equal(run.lifecycleGate.rawProductionPlanStatus, "NOT READY TO SHOOT");
  assert.equal(run.lifecycleGate.productionPlanStatus, "NOT READY TO SHOOT");
  assert.equal(run.lifecycleGate.productionPlanningBlocked, true);
  assert.equal(run.lifecycleGate.productionApprovalBlocked, true);
  assert.equal(run.lifecycleGate.captureEvidenceReviewStatus, "BLOCKED");
  assert.equal(run.lifecycleGate.effectiveCaptureApproved, false);
});

test("package runs index follows lifecycle gates in order", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-runs-lifecycle-"));
  const runsDir = path.join(tempRoot, "package-runs");

  function makeRun(runId, files) {
    const runDir = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    Object.entries(files).forEach(([filename, content]) => {
      fs.writeFileSync(path.join(runDir, filename), content, "utf8");
    });
    return runDir;
  }

  function baseFiles(extra = {}) {
    return {
      "selected-package.json": JSON.stringify({ package: { proposedTitle: "Lifecycle Test" } }),
      "final-script.md": "# Final Script\n",
      ...extra,
    };
  }

  const shotEditPlanAccepted = {
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n\n## Open Blockers\n\n- None.\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n\n| priority | artifact | issue | suggested repair | reason |\n| --- | --- | --- | --- | --- |\n| low | planning artifacts | No automatic repair suggested. | Keep the accepted planning scope attached. | Accepted. |\n",
  };
  const captureEvidence = {
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n",
    "takes-log.md": "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Hook A-roll | shot-list.md | media/hook-a-roll.mov | Clean take reviewed. | captured |\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n\n| missing shot/content | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Capture scope complete. | No fix needed. | closed |\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Workflow proof capture | Shows approved proof workflow. | media/workflow-proof.mp4 | captured |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Approved script narration. | audio/voiceover.wav | closed |\n\nAudio capture readiness: PASS\n",
    "capture-evidence-review.md": "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Real capture evidence detected: yes\n",
  };
  const roughCutEvidence = {
    "rough-cut-watch-notes.md":
      "# Rough-Cut Watch Notes\n\nRough cut file media/rough-cut-v1.mp4 was reviewed in a real viewing pass. Pacing is clear, audio is understandable, visual proof appears in the right section, and no pickup or edit-fix issues remain after review.\n",
    "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut review status: READY FOR SECOND CUT\n- Second-cut ready: yes\n",
    "pickup-list.md": "# Pickup List\n",
    "edit-fix-list.md": "# Edit Fix List\n",
  };
  const finalWatchEvidence = {
    "final-watch-notes.md":
      "# Final Watch Notes\n\nFinal export media/final-cut-v1.mp4 reviewed after the completed edit. Viewer promise delivery, opening clarity, pacing, proof, audio, visuals, graphics, title/thumbnail fit, ethical accuracy, and archive readiness were reviewed with no open publication blockers.\n",
    "final-review.md": "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n",
    "publication-blockers.md": "# Publication Blockers\n",
  };
  const exportEvidence = {
    "export-checklist.md": "# Export Checklist\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n\nExport approval: PASS\n",
    "master-file-manifest.md": "# Master File Manifest\n\nFinal export file: exports/final-master.mp4\nCodec: H.264\nResolution: 3840x2160\nChecksum: recorded locally.\n",
    "caption-check.md": "# Caption Check\n\nCaptions reviewed against the final export. Timing and spelling are acceptable for upload.\n",
    "loudness-check.md": "# Loudness Check\n\nIntegrated loudness measured at -14 LUFS on the final master.\n\nMastering approval: PASS\n",
    "delivery-readiness.md": "# Delivery Readiness\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n\nFinal master, captions, loudness, and delivery settings reviewed.\n\nDelivery approval: PASS\n",
  };
  const metadataEvidence = {
    "publish-metadata-review.md":
      "# Publication Metadata Review\n\n- Publication metadata status: READY TO SCHEDULE\n- Ready to schedule: yes\n\nPublication metadata approval: PASS\n",
    "title-check.md": "# Title Check\n\nFinal title: AI Video Proof Plan That Survives Real Production Review\nTitle approval recorded after final metadata review.\n",
    "thumbnail-check.md": "# Thumbnail Check\n\nThumbnail path: thumbnails/final-approved.png\nThumbnail approval recorded after visual inspection.\n",
    "description-check.md": "# Description Check\n\nDescription includes the final promise, proof context, links, and reviewed upload copy.\n",
    "chapters-check.md": "# Chapters Check\n\n00:00 Hook\n01:12 Proof workflow\n04:30 Production boundary\n07:10 Final takeaway\n",
    "schedule-check.md": "# Schedule Check\n\nRelease timing: 2026-05-15 16:00 Europe/Helsinki. Schedule approval recorded.\n",
  };
  const archiveEvidence = {
    "archive-manifest.md": "# Archive Manifest\n\n- Archive manifest status: READY TO ARCHIVE\n- Ready to archive: yes\n\nArchive package includes final export, project file, metadata, captions, and source evidence.\n\nArchive approval: PASS\n",
    "archive-source-files.md": "# Archive Source Files\n\nResolve project, script, captures, screenshots, and metadata source files are listed with local paths.\n",
    "archive-assets-manifest.md": "# Archive Assets Manifest\n\nThumbnail, graphics, b-roll, audio, and caption assets are listed with local paths.\n",
    "archive-export-manifest.md": "# Archive Export Manifest\n\nFinal master export, captions, metadata package, checksum, and delivery copy are recorded.\n",
    "reusable-clips-manifest.md": "# Reusable Clips Manifest\n\nReusable intro, proof workflow, and recap clips are listed with local edit references.\n",
    "archive-blockers.md": "# Archive Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Archive evidence is complete. | No fix needed. | closed |\n",
  };

  makeRun(
    "2026-05-01-production-ready",
    baseFiles({
      "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    })
  );

  makeRun(
    "2026-05-02-capture-ready",
    baseFiles({
      "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
      ...shotEditPlanAccepted,
      ...captureEvidence,
    })
  );

  makeRun(
    "2026-05-03-final-ready",
    baseFiles({
      "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
      ...shotEditPlanAccepted,
      ...captureEvidence,
      ...roughCutEvidence,
      ...finalWatchEvidence,
    })
  );

  makeRun(
    "2026-05-04-export-ready",
    baseFiles({
      "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
      ...shotEditPlanAccepted,
      ...captureEvidence,
      ...roughCutEvidence,
      ...finalWatchEvidence,
      ...exportEvidence,
    })
  );

  makeRun(
    "2026-05-05-metadata-ready",
    baseFiles({
      "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
      ...shotEditPlanAccepted,
      ...captureEvidence,
      ...roughCutEvidence,
      ...finalWatchEvidence,
      ...exportEvidence,
      ...metadataEvidence,
    })
  );

  makeRun(
    "2026-05-06-archive-ready",
    baseFiles({
      "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
      ...shotEditPlanAccepted,
      ...captureEvidence,
      ...roughCutEvidence,
      ...finalWatchEvidence,
      ...exportEvidence,
      ...metadataEvidence,
      ...archiveEvidence,
    })
  );

  makeRun(
    "2026-05-07-upstream-blocked",
    baseFiles({
      "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: BLOCKED\n",
      "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut review status: BLOCKED\n",
      "final-review.md": "# Final Review\n\n- Publish ready: no\n",
      "repurposing-plan.md": "# Repurposing Plan\n\n- Repurposing status: BLOCKED\n",
    })
  );

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const byRunId = Object.fromEntries(index.runs.map((run) => [run.runId, run]));

  assert.equal(byRunId["2026-05-01-production-ready"].status, "Needs shot/edit plan review");
  assert.equal(
    byRunId["2026-05-01-production-ready"].nextRecommendedCommand,
    "node scripts/package-run-shot-edit-plan-review.js package-runs/2026-05-01-production-ready"
  );
  assert.equal(byRunId["2026-05-02-capture-ready"].status, "Ready for rough cut");
  assert.equal(
    byRunId["2026-05-02-capture-ready"].nextRecommendedCommand,
    "node scripts/package-run-rough-cut-review.js package-runs/2026-05-02-capture-ready"
  );
  assert.equal(byRunId["2026-05-03-final-ready"].status, "Ready to publish");
  assert.equal(
    byRunId["2026-05-03-final-ready"].nextRecommendedCommand,
    "node scripts/package-run-export-checklist.js package-runs/2026-05-03-final-ready"
  );
  assert.equal(byRunId["2026-05-04-export-ready"].status, "Ready to upload");
  assert.equal(
    byRunId["2026-05-04-export-ready"].nextRecommendedCommand,
    "node scripts/package-run-publication-metadata.js package-runs/2026-05-04-export-ready"
  );
  assert.equal(byRunId["2026-05-05-metadata-ready"].status, "Ready to schedule");
  assert.equal(
    byRunId["2026-05-05-metadata-ready"].nextRecommendedCommand,
    "node scripts/package-run-archive-manifest.js package-runs/2026-05-05-metadata-ready"
  );
  assert.equal(byRunId["2026-05-06-archive-ready"].status, "Ready to archive");
  assert.equal(
    byRunId["2026-05-06-archive-ready"].nextRecommendedCommand,
    "node scripts/package-run-repurpose.js package-runs/2026-05-06-archive-ready"
  );
  assert.equal(byRunId["2026-05-07-upstream-blocked"].status, "Needs production planning");
  assert.equal(byRunId["2026-05-07-upstream-blocked"].workflowBucket, "Needs production planning");
});

test("package run doctor help works", () => {
  const output = captureConsole(() => packageRunDoctorScript.main(["--help"]));
  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /Package Run Doctor/);
  assert.match(output.stdout.join("\n"), /--json/);
});

test("package run doctor fails clearly for missing run folder", () => {
  const output = captureConsole(() => packageRunDoctorScript.main(["package-runs/not-real"]));
  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /Package run folder not found/);
  assert.match(output.stderr.join("\n"), /Package Run Doctor/);
});

test("package run doctor reports blocked early run without writing artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-doctor-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-doctor-blocked");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Doctor Blocked Test" } }),
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "manual-note.md"), "# Human note\n", "utf8");
  const before = fs.readdirSync(runDir).sort();

  const output = captureConsole(() => packageRunDoctorScript.main([runDir, "--json"]));
  const after = fs.readdirSync(runDir).sort();
  const report = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.deepEqual(after, before);
  assert.equal(report.runId, "2026-05-10-doctor-blocked");
  assert.equal(report.lifecycleStatus, "Package selected");
  assert.equal(report.workflowBucket, "Needs research pack");
  assert.equal(report.creatorQaStatus, "not run");
  assert.equal(report.evidenceGateStatus, "not evaluated");
  assert.deepEqual(report.detectedKnownArtifacts, ["selected-package.json"]);
  assert.deepEqual(report.unknownManualFiles, ["manual-note.md"]);
  assert.deepEqual(report.missingExpectedArtifacts, ["research-pack.md"]);
  assert.match(report.nextRecommendedCommand, /package-run-research-pack\.js/);
  assert.equal(report.readOnly, true);
  assert.equal(report.externalApisCalled, false);
});

test("package run doctor reports lifecycle next command and matching json fields", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-doctor-lifecycle-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-doctor-capture");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Doctor Capture Test" } }),
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "utf8"
  );

  const report = packageRunDoctorScript.buildDoctorReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  const text = packageRunDoctorScript.renderText(report);
  const jsonOutput = captureConsole(() => packageRunDoctorScript.main([runDir, "--json"]));
  const parsed = JSON.parse(jsonOutput.stdout.join("\n"));

  assert.equal(report.lifecycleStatus, "Needs shot/edit plan review");
  assert.equal(report.workflowBucket, "Needs shot/edit plan review");
  assert.equal(report.lifecycleGate.productionPlanStatus, "READY TO SHOOT");
  assert.equal(report.lifecycleGate.hasShotEditPlanReview, false);
  assert.deepEqual(report.missingExpectedArtifacts, ["shot-edit-plan-review.md"]);
  assert.equal(
    report.nextRecommendedCommand,
    "node scripts/package-run-shot-edit-plan-review.js package-runs/2026-05-10-doctor-capture"
  );
  assert.match(text, /Lifecycle status: Needs shot\/edit plan review/);
  assert.equal(jsonOutput.result, 0);
  assert.equal(parsed.lifecycleStatus, report.lifecycleStatus);
  assert.match(parsed.nextRecommendedCommand, /package-run-shot-edit-plan-review\.js/);
  assert.equal(parsed.readOnly, true);
});

test("package runs index requires accepted shot/edit plan review before capture checklist", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-index-gate-"));
  const runsDir = path.join(tempRoot, "package-runs");

  function makeRun(runId, extra = {}) {
    const runDir = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: runId } }), "utf8");
    fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
    fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
    Object.entries(extra).forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));
  }

  makeRun("2026-05-10-no-stage4-review");
  makeRun("2026-05-11-stage4-needs-work", {
    "shot-edit-plan-review.md":
      "# Shot/Edit Plan Review\n\n- Review status: NEEDS WORK\n- Stage accepted: no\n\n## Open Blockers\n\n- shot-list.md still contains TODO markers.\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n",
  });
  makeRun("2026-05-12-stage4-human-approval", {
    "shot-edit-plan-review.md":
      "# Shot/Edit Plan Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Stage accepted: no\n\n## Open Blockers\n\n- No exact Stage 4 manual approval marker was detected.\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n",
  });
  makeRun("2026-05-13-stage4-accepted", {
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n\n## Open Blockers\n\n- None.\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n",
  });

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const byRunId = Object.fromEntries(index.runs.map((run) => [run.runId, run]));

  assert.equal(byRunId["2026-05-10-no-stage4-review"].status, "Needs shot/edit plan review");
  assert.equal(
    byRunId["2026-05-10-no-stage4-review"].nextRecommendedCommand,
    "node scripts/package-run-shot-edit-plan-review.js package-runs/2026-05-10-no-stage4-review"
  );
  assert.equal(byRunId["2026-05-11-stage4-needs-work"].status, "Needs shot/edit plan approval");
  assert.equal(byRunId["2026-05-11-stage4-needs-work"].workflowBucket, "Needs shot/edit plan approval");
  assert.doesNotMatch(byRunId["2026-05-11-stage4-needs-work"].nextRecommendedCommand, /capture-checklist/);
  assert.equal(byRunId["2026-05-12-stage4-human-approval"].status, "Needs shot/edit plan approval");
  assert.equal(byRunId["2026-05-12-stage4-human-approval"].lifecycleGate.shotEditPlanReviewStatus, "READY FOR HUMAN APPROVAL");
  assert.equal(byRunId["2026-05-12-stage4-human-approval"].lifecycleGate.shotEditPlanAccepted, false);
  assert.doesNotMatch(byRunId["2026-05-12-stage4-human-approval"].nextRecommendedCommand, /capture-checklist/);
  assert.equal(byRunId["2026-05-13-stage4-accepted"].status, "Ready for capture checklist");
  assert.equal(
    byRunId["2026-05-13-stage4-accepted"].nextRecommendedCommand,
    "node scripts/package-run-capture-checklist.js package-runs/2026-05-13-stage4-accepted"
  );
});

test("package runs index does not let generated downstream artifacts jump past missing capture evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-downstream-generated-block-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-generated-downstream");
  fs.mkdirSync(runDir, { recursive: true });
  const generatedFiles = {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Generated Downstream" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n",
    "takes-log.md": "# Takes Log\n\nTODO\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n\nTODO\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\nTODO\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\nTODO\n",
    "rough-cut-watch-notes.md": "# Rough-Cut Watch Notes\n\nTODO\n",
    "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut review status: READY FOR SECOND CUT\n- Second-cut ready: yes\n",
    "pickup-list.md": "# Pickup List\n",
    "edit-fix-list.md": "# Edit Fix List\n",
    "final-watch-notes.md": "# Final Watch Notes\n\nTODO\n",
    "final-review.md": "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n",
    "publication-blockers.md": "# Publication Blockers\n",
    "export-checklist.md": "# Export Checklist\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n",
    "master-file-manifest.md": "# Master File Manifest\n\nTODO\n",
    "caption-check.md": "# Caption Check\n\nTODO\n",
    "loudness-check.md": "# Loudness Check\n\nTODO\n",
    "delivery-readiness.md": "# Delivery Readiness\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n",
    "publish-metadata-review.md": "# Publication Metadata Review\n\n- Publication metadata status: READY TO SCHEDULE\n- Ready to schedule: yes\n",
    "title-check.md": "# Title Check\n\nTODO\n",
    "thumbnail-check.md": "# Thumbnail Check\n\nTODO\n",
    "description-check.md": "# Description Check\n\nTODO\n",
    "chapters-check.md": "# Chapters Check\n\nTODO\n",
    "schedule-check.md": "# Schedule Check\n\nTODO\n",
    "archive-manifest.md": "# Archive Manifest\n\n- Archive manifest status: READY TO ARCHIVE\n- Ready to archive: yes\n",
    "archive-source-files.md": "# Archive Source Files\n\nTODO\n",
    "archive-assets-manifest.md": "# Archive Assets Manifest\n\nTODO\n",
    "archive-export-manifest.md": "# Archive Export Manifest\n\nTODO\n",
    "reusable-clips-manifest.md": "# Reusable Clips Manifest\n\nTODO\n",
    "archive-blockers.md": "# Archive Blockers\n\nTODO\n",
  };
  Object.entries(generatedFiles).forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });

  assert.equal(run.status, "Needs capture");
  assert.equal(run.workflowBucket, "Needs capture");
  assert.equal(run.lifecycleGate.shotEditPlanAccepted, true);
  assert.equal(run.lifecycleGate.readyForRoughCut, true);
  assert.equal(run.lifecycleGate.hasConcreteCaptureEvidence, false);
  assert.equal(run.lifecycleGate.effectiveCaptureApproved, false);
  assert.equal(run.lifecycleGate.effectiveReadyForRoughCut, false);
  assert.equal(run.lifecycleGate.effectivePublishReady, false);
  assert.equal(run.lifecycleGate.effectiveReadyToUpload, false);
  assert.equal(run.lifecycleGate.effectiveReadyToSchedule, false);
  assert.notEqual(run.status, "Needs archive data");
  assert.match(doctor.firstBlockerReason, /capture-evidence-review\.md is missing|real capture evidence/);
});

test("conservative workflow invariant stays blocked when paper-ready artifacts lack capture evidence proof", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-conservative-invariant-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-paper-ready-no-proof");
  fs.mkdirSync(runDir, { recursive: true });
  const files = {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Paper Ready Without Proof" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n",
    "takes-log.md": "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Generated hook | shot-list.md | Verified in existing capture artifacts. | Generated row, not durable proof. | captured |\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n\n| missing shot/content | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Generated assertion only. | Human evidence still required. | closed |\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Generated proof screen | screen-capture-list.md | Verified in existing capture artifacts. | captured |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Final script narration. | Verified in existing capture artifacts. | closed |\n\nAudio capture readiness: PASS\n",
    "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut review status: READY FOR SECOND CUT\n- Second-cut ready: yes\n",
    "final-review.md": "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n",
    "export-checklist.md": "# Export Checklist\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n\nExport approval: PASS\n",
    "delivery-readiness.md": "# Delivery Readiness\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n\nDelivery approval: PASS\n",
    "archive-manifest.md": "# Archive Manifest\n\n- Archive manifest status: READY TO ARCHIVE\n- Ready to archive: yes\n\nArchive approval: PASS\n",
  };
  Object.entries(files).forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);
  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });
  const rejectedArtifacts = run.detectedButNotTrustedArtifacts.map((item) => item.artifact);

  assert.equal(run.status, "Needs capture");
  assert.equal(run.workflowBucket, "Needs capture");
  assert.equal(run.overallStatus, "BLOCKED");
  assert.equal(run.lifecycleGate.hasCaptureEvidenceReview, false);
  assert.equal(run.lifecycleGate.hasConcreteCaptureEvidence, false);
  assert.equal(run.lifecycleGate.captureApproved, true);
  assert.equal(run.lifecycleGate.effectiveCaptureApproved, false);
  assert.equal(run.lifecycleGate.effectiveReadyForRoughCut, false);
  assert.equal(run.lifecycleGate.effectivePublishReady, false);
  assert.equal(run.lifecycleGate.effectiveReadyToUpload, false);
  assert.equal(run.lifecycleGate.effectiveReadyToSchedule, false);
  assert.deepEqual(report.missingExpectedArtifacts, ["capture-evidence-review.md"]);
  assert.match(report.firstBlockerReason, /capture-evidence-review\.md is missing/);
  assert.ok(rejectedArtifacts.includes("capture-checklist.md"));
  assert.ok(rejectedArtifacts.includes("rough-cut-review.md"));
  assert.ok(rejectedArtifacts.includes("final-review.md"));
  assert.ok(rejectedArtifacts.includes("export artifacts"));
  assert.ok(rejectedArtifacts.includes("archive artifacts"));
  assert.notEqual(run.status, "Ready to shoot");
  assert.notEqual(run.status, "Ready for rough cut");
  assert.notEqual(run.status, "Ready to upload");
  assert.notEqual(run.status, "Ready to archive");
});

test("effective readiness overrides stale downstream markers when capture evidence review needs capture", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-effective-capture-block-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-effective-capture-block");
  fs.mkdirSync(runDir, { recursive: true });
  const files = {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Effective Capture Block" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n",
    "takes-log.md": "# Takes Log\n\nTODO\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n\nTODO\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\nTODO\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\nTODO\n\nAudio capture readiness: PASS\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: NEEDS CAPTURE\n- Capture evidence accepted: no\n- Real capture evidence detected: no\n- Ready for rough-cut work: no\n\n## Next Safe Action\n\n- Add real capture evidence rows with concrete media references, then rerun this review.\n",
    "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut review status: READY FOR SECOND CUT\n- Second-cut ready: yes\n",
    "final-review.md": "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n",
    "export-checklist.md": "# Export Checklist\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n",
    "delivery-readiness.md": "# Delivery Readiness\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n",
    "publish-metadata-review.md": "# Publication Metadata Review\n\n- Publication metadata status: READY TO SCHEDULE\n- Ready to schedule: yes\n",
  };
  Object.entries(files).forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);
  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });

  assert.equal(run.status, "Needs capture");
  assert.equal(run.overallStatus, "BLOCKED");
  assert.equal(run.lifecycleGate.readyForRoughCut, true);
  assert.equal(run.lifecycleGate.captureApproved, true);
  assert.equal(run.lifecycleGate.publishReady, true);
  assert.equal(run.lifecycleGate.readyToUpload, true);
  assert.equal(run.lifecycleGate.readyToSchedule, true);
  assert.equal(run.lifecycleGate.effectiveCaptureApproved, false);
  assert.equal(run.lifecycleGate.effectiveReadyForRoughCut, false);
  assert.equal(run.lifecycleGate.effectivePublishReady, false);
  assert.equal(run.lifecycleGate.effectiveReadyToUpload, false);
  assert.equal(run.lifecycleGate.effectiveReadyToSchedule, false);
  assert.equal(run.lifecycleGate.effectiveReadiness.downstreamReadinessOverridden, true);
  assert.match(run.lifecycleGate.effectiveReadiness.nextSafeAction, /Add real capture evidence rows/);
  assert.equal(report.effectiveReadiness.captureApproved, false);
  assert.equal(report.effectiveReadiness.readyForRoughCut, false);
  assert.equal(report.effectiveReadiness.publishReady, false);
  assert.equal(report.effectiveReadiness.readyToUpload, false);
  assert.equal(report.effectiveReadiness.readyToSchedule, false);
  assert.match(report.nextSafeAction, /Add real capture evidence rows/);
});

test("package runs index rejects generated capture approvals without real capture rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-generated-capture-approval-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-generated-capture");
  fs.mkdirSync(runDir, { recursive: true });
  [
    ["selected-package.json", JSON.stringify({ package: { proposedTitle: "Generated Capture" } })],
    ["final-script.md", "# Final Script\n"],
    ["production-plan.md", "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n"],
    ["shot-edit-plan-review.md", "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n"],
    ["shot-edit-plan-enhancement-plan.md", "# Shot/Edit Plan Enhancement Plan\n"],
    ["capture-checklist.md", "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n"],
    ["takes-log.md", "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Approved hook shot | shot-list.md | Verified in existing capture artifacts. | Generated checklist row. | captured |\n"],
    ["missing-shot-tracker.md", "# Missing Shot Tracker\n"],
    ["screen-recording-checklist.md", "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Approved proof screen recording | screen-capture-list.md | Verified in existing capture artifacts. | captured |\n"],
    ["audio-capture-checklist.md", "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Approved script audio. | Verified in existing capture artifacts. | closed |\n\nAudio capture readiness: PASS\n"],
  ].forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);

  assert.equal(run.status, "Needs capture");
  assert.equal(run.lifecycleGate.captureApproved, true);
  assert.equal(run.lifecycleGate.hasConcreteCaptureEvidence, false);
});

test("package runs index uses capture evidence review conservatively", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-review-index-"));
  const runsDir = path.join(tempRoot, "package-runs");
  function makeRun(runId, reviewText) {
    const runDir = path.join(runsDir, runId);
    writeCaptureEvidenceFixture(runDir, {
      "selected-package.json": JSON.stringify({ package: { proposedTitle: runId } }),
      "final-script.md": "# Final Script\n",
      "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
      "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Final script narration. | audio/voiceover.wav | recorded |\n\nCapture evidence approval: PASS\n",
      "capture-evidence-review.md": reviewText,
    });
  }
  makeRun(
    "2026-05-10-capture-human",
    "# Capture Evidence Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Capture evidence accepted: no\n- Real capture evidence detected: yes\n"
  );
  makeRun(
    "2026-05-11-capture-pass",
    "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Real capture evidence detected: yes\n"
  );

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const byRunId = Object.fromEntries(index.runs.map((run) => [run.runId, run]));

  assert.equal(byRunId["2026-05-10-capture-human"].status, "Needs capture");
  assert.equal(byRunId["2026-05-10-capture-human"].lifecycleGate.captureEvidenceReviewStatus, "READY FOR HUMAN APPROVAL");
  assert.equal(byRunId["2026-05-10-capture-human"].lifecycleGate.captureEvidenceAccepted, false);
  assert.equal(byRunId["2026-05-10-capture-human"].lifecycleGate.hasConcreteCaptureEvidence, false);
  assert.equal(byRunId["2026-05-10-capture-human"].lifecycleGate.effectiveCaptureApproved, false);
  assert.equal(byRunId["2026-05-10-capture-human"].lifecycleGate.effectiveReadyForRoughCut, false);
  assert.equal(byRunId["2026-05-10-capture-human"].lifecycleGate.effectiveReadiness.downstreamReadinessOverridden, true);
  assert.equal(byRunId["2026-05-11-capture-pass"].status, "Ready for rough cut");
  assert.equal(byRunId["2026-05-11-capture-pass"].lifecycleGate.captureEvidenceAccepted, true);
  assert.equal(byRunId["2026-05-11-capture-pass"].lifecycleGate.hasConcreteCaptureEvidence, true);
  assert.equal(byRunId["2026-05-11-capture-pass"].lifecycleGate.effectiveCaptureApproved, true);
  assert.equal(byRunId["2026-05-11-capture-pass"].lifecycleGate.effectiveReadyForRoughCut, true);
});

test("package runs index rejects generated rough-cut and final reviews without real watch notes", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-generated-watch-notes-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-generated-watch");
  fs.mkdirSync(runDir, { recursive: true });
  const files = {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Generated Watch" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n",
    "takes-log.md": "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Take 01 hook | shot-list.md | media/take-01-hook.mov | Human reviewed captured take. | captured |\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Workflow screen recording | Shows proof workflow. | recordings/workflow-001.mp4 | captured |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Final script narration. | audio/voiceover.wav | recorded |\n\nAudio capture readiness: PASS\n",
    "capture-evidence-review.md": "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Real capture evidence detected: yes\n",
    "rough-cut-watch-notes.md": "# Rough-Cut Watch Notes\n\nPacing and audio notes generated before any rough cut candidate exists.\n",
    "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut review status: READY FOR SECOND CUT\n- Second-cut ready: yes\n",
    "pickup-list.md": "# Pickup List\n",
    "edit-fix-list.md": "# Edit Fix List\n",
    "final-watch-notes.md": "# Final Watch Notes\n\nViewer promise, clarity, pacing, and publish notes generated before a final export candidate exists.\n",
    "final-review.md": "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n",
    "publication-blockers.md": "# Publication Blockers\n",
  };
  Object.entries(files).forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);

  assert.equal(run.status, "Needs rough-cut review");
  assert.equal(run.lifecycleGate.hasConcreteCaptureEvidence, true);
  assert.equal(run.lifecycleGate.hasRealRoughCutEvidence, false);
  assert.equal(run.lifecycleGate.hasRealFinalWatchEvidence, false);
});

test("package run doctor reports blocked actions for downstream export blockers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-export-blocked-actions-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-export-blocked");
  fs.mkdirSync(runDir, { recursive: true });
  const files = {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Export Blocked" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n",
    "takes-log.md": "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Take 01 hook | shot-list.md | media/take-01-hook.mov | Human reviewed captured take. | captured |\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Workflow screen recording | Shows proof workflow. | recordings/workflow-001.mp4 | captured |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Final script narration. | audio/voiceover.wav | recorded |\n\nAudio capture readiness: PASS\n",
    "capture-evidence-review.md": "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Real capture evidence detected: yes\n",
    "rough-cut-watch-notes.md": "# Rough-Cut Watch Notes\n\nRough cut file media/rough-cut-v1.mp4 reviewed in Resolve timeline. Pacing, audio, visuals, and pickup needs were checked by a human.\n",
    "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut review status: READY FOR SECOND CUT\n- Second-cut ready: yes\n",
    "pickup-list.md": "# Pickup List\n",
    "edit-fix-list.md": "# Edit Fix List\n",
    "final-watch-notes.md": "# Final Watch Notes\n\nFinal export media/final-cut-v1.mp4 reviewed. Viewer promise, opening, clarity, pacing, proof, audio, visuals, publish metadata fit, and accuracy were checked.\n",
    "final-review.md": "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n",
    "publication-blockers.md": "# Publication Blockers\n",
    "export-checklist.md": "# Export Checklist\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n",
    "master-file-manifest.md": "# Master File Manifest\n\nTODO\n",
    "caption-check.md": "# Caption Check\n\nTODO\n",
    "loudness-check.md": "# Loudness Check\n\nTODO\n",
    "delivery-readiness.md": "# Delivery Readiness\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n",
  };
  Object.entries(files).forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));

  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });

  assert.equal(report.lifecycleStatus, "Needs export check");
  assert.equal(report.lifecycleGate.hasConcreteExportEvidence, false);
  assert.deepEqual(report.conservativeBlockedActions, ["upload", "publishing", "archive", "Hermes brain write", "project-state promotion"]);
});

test("package run doctor reports shot/edit plan gate fields and conservative blockers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-doctor-gate-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-stage4-doctor");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Stage 4 Doctor" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: NEEDS WORK\n- Stage accepted: no\n\n## Open Blockers\n\n- screen-capture-list.md has TODO rows.\n\n## Next Safe Action\n\n- Edit Stage 4 planning artifacts manually, then rerun this review.\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-enhancement-plan.md"), "# Shot/Edit Plan Enhancement Plan\n", "utf8");

  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });
  const text = packageRunDoctorScript.renderText(report);

  assert.equal(report.lifecycleStatus, "Needs shot/edit plan approval");
  assert.equal(report.lifecycleGate.hasShotEditPlanReview, true);
  assert.equal(report.lifecycleGate.shotEditPlanReviewStatus, "NEEDS WORK");
  assert.equal(report.lifecycleGate.shotEditPlanAccepted, false);
  assert.match(report.lifecycleGate.shotEditPlanBlockers, /screen-capture-list\.md/);
  assert.match(report.firstBlockerReason, /Shot\/edit plan review status is NEEDS WORK/);
  assert.deepEqual(report.missingExpectedArtifacts, ["shot-edit-plan-review.md with Review status: PASS and Stage accepted: yes"]);
  assert.equal(report.conservativeBlockedActions.includes("shooting"), true);
  assert.equal(report.conservativeBlockedActions.includes("project-state promotion"), true);
  assert.match(text, /shotEditPlanReviewStatus: NEEDS WORK/);
  assert.match(text, /Conservative blocked actions:/);
});

test("package run doctor prioritizes Stage 4 planning repair over capture evidence intake", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-doctor-next-action-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-stage4-next-action");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Stage 4 Next Action" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-list.md": "# Shot List\n\nTODO\n",
    "shot-edit-plan-review.md":
      "# Shot/Edit Plan Review\n\n- Review status: NEEDS WORK\n- Stage accepted: no\n\n## Open Blockers\n\n- shot-list.md is placeholder-only or too thin.\n\n## Next Safe Action\n\n- Edit the planning artifacts manually, then run this review again.\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: NEEDS CAPTURE\n- Capture evidence accepted: no\n- Real capture evidence detected: no\n\n## Next Safe Action\n\n- Add real capture evidence rows with concrete media references, then rerun this review.\n",
  });

  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });
  const text = packageRunDoctorScript.renderText(report);

  assert.equal(report.lifecycleStatus, "Needs shot/edit plan approval");
  assert.match(report.firstBlockerReason, /shot-list\.md is placeholder-only or too thin/);
  assert.equal(report.lifecycleGate.shotEditPlanNextSafeAction, "Edit the planning artifacts manually, then run this review again.");
  assert.equal(report.nextSafeAction, "Edit the planning artifacts manually, then run this review again.");
  assert.doesNotMatch(report.nextSafeAction, /capture evidence/i);
  assert.match(text, /Stage 4 next safe action: Edit the planning artifacts manually, then run this review again\./);
});

test("package run doctor does not make capture evidence primary before Stage 4 acceptance", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-doctor-human-review-next-action-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-stage4-human-review-next-action");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Stage 4 Human Review Next Action" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-edit-plan-review.md":
      "# Shot/Edit Plan Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Stage accepted: no\n\n## Open Blockers\n\n- No exact Stage 4 manual approval marker was detected.\n\n## Next Safe Action\n\n- Mikko reviews the concrete shot/edit plan and adds an exact approval marker only if the scope is accepted.\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: NEEDS CAPTURE\n- Capture evidence accepted: no\n- Real capture evidence detected: no\n\n## Next Safe Action\n\n- Add real capture evidence rows with concrete media references, then rerun this review.\n",
  });

  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });

  assert.equal(report.lifecycleStatus, "Needs shot/edit plan approval");
  assert.equal(report.lifecycleGate.shotEditPlanAccepted, false);
  assert.match(report.nextSafeAction, /Mikko reviews the concrete shot\/edit plan/);
  assert.doesNotMatch(report.nextSafeAction, /capture evidence/i);
});

test("package run doctor reports capture evidence gate fields", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-doctor-gate-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-doctor");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Capture Doctor" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Capture evidence accepted: no\n- Real capture evidence detected: yes\n\n## Next Safe Action\n\n- Add Capture evidence approval: PASS after human review.\n",
  });

  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });

  assert.equal(report.lifecycleStatus, "Needs capture");
  assert.equal(report.lifecycleGate.hasCaptureEvidenceReview, true);
  assert.equal(report.lifecycleGate.captureEvidenceReviewStatus, "READY FOR HUMAN APPROVAL");
  assert.equal(report.lifecycleGate.captureEvidenceAccepted, false);
  assert.equal(report.lifecycleGate.captureEvidenceRealEvidence, true);
  assert.match(report.firstBlockerReason, /Capture evidence review status is READY FOR HUMAN APPROVAL/);
  assert.deepEqual(report.missingExpectedArtifacts, ["exact capture approval marker in capture-stage artifact"]);
  assert.match(report.nextSafeAction, /Add Capture evidence approval: PASS after human review/);
  assert.equal(report.conservativeBlockedActions.includes("upload"), true);
});

test("package run doctor overrides stale capture evidence review with current source evaluation", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-doctor-stale-review-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-doctor-stale-review");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Capture Doctor Stale Review" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "capture-checklist.md":
      "# Capture Checklist\n\n- Capture checklist status: READY FOR HUMAN APPROVAL\n- Ready for rough cut: no\n\nCapture approval: NOT APPROVED\n",
    "takes-log.md":
      "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Take 1 | Screen-recorded comparison. | Verified in existing capture artifacts. | Generated checklist row. | closed |\n| TAKE-001 | shot-list.md smoke-test row | media/test-capture/take-001-hook.mov | Dummy smoke-test A-roll reference. Not real production approval. | captured |\n",
    "screen-recording-checklist.md":
      "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Workflow screen | Capture proof. | Verified in existing capture artifacts. | closed |\n| Screen recording smoke proof 001 | Dummy smoke-test screen recording reference. Not real production approval. | recordings/test-screen-proof-001.mp4 | captured |\n",
    "audio-capture-checklist.md":
      "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Record only approved script sections. | Verified in existing capture artifacts. | closed |\n| Voiceover smoke-test main pass | Dummy smoke-test audio reference. Not real production approval. | audio/test-voiceover-main.wav | recorded |\n\nAudio capture readiness: NOT APPROVED\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Capture evidence accepted: no\n- Real capture evidence detected: yes\n\n## Next Safe Action\n\n- Add Capture evidence approval: PASS after human review.\n",
  });

  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });
  const text = packageRunDoctorScript.renderText(report);

  assert.equal(report.lifecycleStatus, "Needs capture");
  assert.equal(report.overallStatus, "BLOCKED");
  assert.equal(report.lifecycleGate.hasCaptureEvidenceReview, true);
  assert.equal(report.lifecycleGate.captureEvidenceReviewStatus, "NEEDS CAPTURE");
  assert.equal(report.lifecycleGate.captureEvidenceAccepted, false);
  assert.equal(report.lifecycleGate.captureEvidenceRealEvidence, false);
  assert.equal(report.lifecycleGate.hasConcreteCaptureEvidence, false);
  assert.equal(report.effectiveReadiness.captureApproved, false);
  assert.equal(report.effectiveReadiness.readyForRoughCut, false);
  assert.match(report.lifecycleGate.captureEvidenceNextSafeAction, /Add real capture evidence rows with concrete media references/);
  assert.match(report.firstBlockerReason, /Capture evidence review status is NEEDS CAPTURE/);
  assert.match(report.missingExpectedArtifacts.join("\n"), /real capture evidence and capture-evidence-review\.md PASS/);
  assert.match(text, /captureEvidenceReviewStatus: NEEDS CAPTURE/);
  assert.match(text, /captureEvidenceRealEvidence: false/);
  assert.doesNotMatch(text, /captureEvidenceReviewStatus: READY FOR HUMAN APPROVAL/);
});

test("package run doctor keeps May 2 stale capture artifacts behind production planning", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-doctor-may2-stale-ordering-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-ai-video-idea-filter");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "May 2 Stale Ordering" } }),
    "final-script.md": "# Final Script\n\nDraft script, not approved for production.\n",
    "production-plan.md":
      "# Production Plan\n\n- Production planning ready from review: no\n- Shoot-readiness status: NOT READY TO SHOOT\n\nCurrent final-script.md is a reviewable draft, not an approved production script.\nMikko production approval has not been given.\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| Mikko production approval has not been given. | Human production approval is required. | Request review after package gates are clean. | open |\n",
    "shot-edit-plan-review.md":
      "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n- Production planning ready: yes\n\n## Open Blockers\n\n- None detected by this local review.\n",
    "capture-checklist.md":
      "# Capture Checklist\n\n- Capture checklist status: READY FOR HUMAN APPROVAL\n- Ready for rough cut: no\n\nCapture approval: NOT APPROVED\n",
    "takes-log.md":
      "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| TAKE-001 | shot-list.md smoke-test row | media/test-capture/take-001-hook.mov | Dummy smoke-test A-roll reference. Not real production approval. | captured |\n",
    "screen-recording-checklist.md":
      "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Screen recording smoke proof 001 | Dummy smoke-test screen recording reference. Not real production approval. | recordings/test-screen-proof-001.mp4 | captured |\n",
    "audio-capture-checklist.md":
      "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover smoke-test main pass | Dummy smoke-test audio reference. Not real production approval. | audio/test-voiceover-main.wav | recorded |\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Capture evidence accepted: no\n- Real capture evidence detected: yes\n",
  });

  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });
  const gap = packageCaptureGapScript.buildCaptureGapReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.overallStatus, "BLOCKED");
  assert.equal(report.currentInferredStage, "Needs production planning");
  assert.equal(report.lifecycleGate.productionPlanStatus, "NOT READY TO SHOOT");
  assert.equal(report.lifecycleGate.productionBlockersOpen, true);
  assert.equal(report.lifecycleGate.productionPlanningBlocked, true);
  assert.equal(report.lifecycleGate.shotEditPlanReviewStatus, "STALE PASS");
  assert.equal(report.lifecycleGate.shotEditPlanAccepted, false);
  assert.equal(report.lifecycleGate.captureEvidenceAccepted, false);
  assert.equal(report.lifecycleGate.captureEvidenceRealEvidence, false);
  assert.match(report.nextSafeAction, /Repair production-plan\.md and resolve open production-blockers\.md/);
  assert.doesNotMatch(report.nextSafeAction, /capture evidence rows/i);
  assert.match(report.firstBlockerReason, /production-blockers\.md has open blockers/);
  assert.equal(gap.overallStatus, "BLOCKED");
  assert.equal(gap.stage4Accepted, false);
  assert.equal(gap.gaps.some((item) => item.area === "production-planning"), true);
  assert.equal(gap.gaps.some((item) => item.area === "real-capture-evidence"), false);
  assert.doesNotMatch(gap.gaps.map((item) => item.safeNextAction).join("\n"), /Add concrete media references|Add real capture evidence rows/i);
});

test("package run lifecycle treats explicit production-not-approved notes as upstream blockers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-doctor-production-approval-conflict-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-ai-video-idea-filter");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "May 2 Production Approval Conflict" } }),
    "final-script.md": "# Final Script\n\nDraft script, not approved for production.\n",
    "notes.md": "# Notes\n\nThis run is not production approved and is not ready to shoot until repo checks and Mikko approval justify it.\n",
    "evidence-chain-summary.md": "# Evidence Chain Summary\n\n- Production approved: no\n- Mikko production approval has not been given.\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: NEEDS CAPTURE\n- Capture evidence accepted: no\n- Real capture evidence detected: no\n\n## Next Safe Action\n\n- Add real capture evidence rows with concrete media references, then rerun this review.\n",
  });

  const run = packageRunsIndexScript.scanRun(runDir, tempRoot);
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });
  const nextAction = packageRunNextActionScript.buildNextActionReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(run.status, "Needs production planning");
  assert.equal(run.lifecycleGate.rawProductionPlanStatus, "READY TO SHOOT");
  assert.equal(run.lifecycleGate.productionPlanStatus, "NOT READY TO SHOOT");
  assert.equal(run.lifecycleGate.productionApprovalBlocked, true);
  assert.equal(run.lifecycleGate.productionPlanningBlocked, true);
  assert.equal(run.lifecycleGate.productionBlockersOpen, true);
  assert.equal(run.lifecycleGate.shotEditPlanReviewStatus, "STALE PASS");
  assert.equal(run.lifecycleGate.shotEditPlanAccepted, false);
  assert.match(run.lifecycleGate.effectiveReadiness.overrideReason, /Production planning is blocked/);
  assert.match(doctor.nextSafeAction, /Repair production-plan\.md and resolve open production-blockers\.md/);
  assert.doesNotMatch(doctor.nextSafeAction, /capture evidence rows/i);
  assert.doesNotMatch(nextAction.nextAction, /capture evidence rows/i);
  assert.doesNotMatch(nextAction.commandToRun, /package-run-capture-evidence-review/);
});

test("production approval repair reporter flags ready plan with explicit not-approved notes", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-repair-conflict-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-ai-video-idea-filter");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Production Approval Conflict" } }),
    "final-script.md": "# Final Script\n",
    "creator-qa-package.md": "# Creator QA Package\n\n- Status: Draft repair for Creator QA; not production approved and not ready to shoot.\n",
    "evidence-chain-summary.md": "# Evidence Chain Summary\n\n- Production approved: no\n- Mikko production approval has not been given.\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: NEEDS CAPTURE\n- Capture evidence accepted: no\n- Real capture evidence detected: no\n",
  });
  const before = fs.readdirSync(runDir).sort();

  const report = packageProductionApprovalRepairScript.buildRepairReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  const text = packageProductionApprovalRepairScript.renderText(report);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(report.readOnly, true);
  assert.equal(report.externalApisCalled, false);
  assert.equal(report.needsRepair, true);
  assert.equal(report.currentEffectiveProductionStatus, "NOT READY TO SHOOT");
  assert.equal(report.rawParsedProductionStatus, "READY TO SHOOT");
  assert.equal(report.productionBlockersAppearClosed, true);
  assert.deepEqual(report.productionApprovalBlockerSources, ["creator-qa-package.md", "evidence-chain-summary.md"]);
  assert.equal(report.staleArtifacts.some((item) => item.artifact === "production-plan.md"), true);
  assert.equal(report.staleArtifacts.some((item) => item.artifact === "production-blockers.md"), true);
  assert.equal(report.staleArtifacts.some((item) => item.artifact === "shot-edit-plan-review.md"), true);
  assert.match(report.exactNextSafeAction, /Repair production-plan\.md and resolve open production-blockers\.md/);
  assert.equal(report.exactApprovalMarkerRequired, "Mikko production approval: PASS");
  assert.equal(report.approvalMarkerMustNotBeAddedByReporter, true);
  assert.match(text, /Reporter action: read-only; marker not added/);
});

test("production approval repair reporter handles clean approved production planning", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-repair-clean-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-clean-approved");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Clean Approved" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
  });

  const report = packageProductionApprovalRepairScript.buildRepairReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.readOnly, true);
  assert.equal(report.externalApisCalled, false);
  assert.equal(report.needsRepair, false);
  assert.equal(report.currentEffectiveProductionStatus, "READY TO SHOOT");
  assert.equal(report.rawParsedProductionStatus, "READY TO SHOOT");
  assert.equal(report.productionBlockersAppearClosed, true);
  assert.deepEqual(report.productionApprovalBlockerSources, []);
  assert.deepEqual(report.staleArtifacts, []);
  assert.deepEqual(report.requiredMikkoReviewItems, []);
});

test("production approval repair reporter reports missing run folder", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-repair-missing-"));

  assert.throws(
    () => packageProductionApprovalRepairScript.buildRepairReport("package-runs/not-real", { repoRoot: tempRoot }),
    /Package run folder not found/
  );

  const output = captureConsole(() => packageProductionApprovalRepairScript.main(["package-runs/not-real", "--json"]));
  const payload = JSON.parse(output.stdout.join("\n"));
  assert.equal(output.result, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.externalApisCalled, false);
  assert.match(payload.error, /Package run folder not found/);
});

test("production approval repair reporter json cli is parseable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-repair-json-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-json");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Repair JSON" } }),
    "final-script.md": "# Final Script\n",
    "evidence-chain-summary.md": "# Evidence Chain Summary\n\n- Production approved: no\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
  });

  const output = captureConsole(() => packageProductionApprovalRepairScript.main([runDir, "--json"]));
  const payload = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.externalApisCalled, false);
  assert.equal(payload.needsRepair, true);
  assert.equal(payload.rawParsedProductionStatus, "READY TO SHOOT");
  assert.equal(payload.currentEffectiveProductionStatus, "NOT READY TO SHOOT");
});

test("production approval review packet reports current May 2 run blocked without capture intake", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const runDir = path.join(repoRoot, "package-runs", "2026-05-02-ai-video-idea-filter");
  if (!fs.existsSync(runDir)) return;

  const packet = packageProductionApprovalReviewScript.buildReviewPacket(path.relative(repoRoot, runDir), { repoRoot });
  const text = packageProductionApprovalReviewScript.renderText(packet);

  assert.equal(packet.readOnly, true);
  assert.equal(packet.externalApisCalled, false);
  assert.equal(packet.currentProductionStatus.effectiveProductionStatus, "NOT READY TO SHOOT");
  assert.equal(packet.currentProductionStatus.productionApprovalBlocked, true);
  assert.equal(packet.currentProductionStatus.productionBlockersOpen, true);
  assert.equal(packet.captureIntakeSuggested, false);
  assert.match(packet.exactNextSafeAction, /Repair production-plan\.md and resolve open production-blockers\.md/);
  assert.doesNotMatch(packet.exactNextSafeAction, /Add real capture evidence rows/i);
  assert.doesNotMatch(text, /package-run-capture-evidence-review/);
});

test("production approval review packet includes KEEP BLOCKED for explicit not-approved evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-review-conflict-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-conflict");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Approval Review Conflict" } }),
    "final-script.md": "# Final Script\n",
    "creator-qa-package.md": "# Creator QA Package\n\n- Status: Draft repair; not production approved and not ready to shoot.\n",
    "selection-rationale-proof.md": "# Selection Rationale Proof\n\nThis is not strong enough to mark production approved or ready-to-shoot.\n",
    "evidence-chain-summary.md": "# Evidence Chain Summary\n\n- Production approved: no\n- Mikko production approval has not been given.\n",
    "notes.md": "# Notes\n\nThis run is not production approved and not ready to shoot.\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
  });

  const packet = packageProductionApprovalReviewScript.buildReviewPacket(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  const keepBlocked = packet.decisionOptions.find((item) => item.option === "KEEP BLOCKED");

  assert.equal(packet.currentProductionStatus.effectiveProductionStatus, "NOT READY TO SHOOT");
  assert.equal(packet.currentProductionStatus.rawParsedProductionStatus, "READY TO SHOOT");
  assert.equal(packet.currentProductionStatus.productionApprovalBlocked, true);
  assert.equal(keepBlocked.available, true);
  assert.equal(packet.blockingSourceFiles.includes("creator-qa-package.md"), true);
  assert.equal(packet.blockingSourceFiles.includes("selection-rationale-proof.md"), true);
  assert.equal(packet.blockingSourceFiles.includes("evidence-chain-summary.md"), true);
  assert.equal(packet.blockingSourceFiles.includes("notes.md"), true);
  assert.equal(packet.staleOrRepairedMarkerDiagnostics.some((item) => item.file === "production-plan.md"), true);
  assert.equal(packet.staleOrRepairedMarkerDiagnostics.some((item) => item.file === "production-blockers.md"), true);
  assert.equal(packet.staleOrRepairedMarkerDiagnostics.some((item) => item.file === "shot-edit-plan-review.md"), true);
});

test("production approval review packet clean approved fixture exposes approve option without adding marker", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-review-clean-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-clean");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Review Clean Approved" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
  });
  const before = fs.readdirSync(runDir).sort();

  const packet = packageProductionApprovalReviewScript.buildReviewPacket(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  const after = fs.readdirSync(runDir).sort();
  const approve = packet.decisionOptions.find((item) => item.option === "APPROVE PRODUCTION");

  assert.deepEqual(after, before);
  assert.equal(packet.currentProductionStatus.effectiveProductionStatus, "READY TO SHOOT");
  assert.equal(packet.currentProductionStatus.productionApprovalBlocked, false);
  assert.equal(packet.currentProductionStatus.productionBlockersOpen, false);
  assert.equal(approve.available, true);
  assert.equal(packet.exactApprovalMarkerRequiredIfApproved, "Mikko production approval: PASS");
  assert.equal(fs.readFileSync(path.join(runDir, "production-plan.md"), "utf8").includes("Mikko production approval: PASS"), false);
});

test("production approval review packet reports missing run folder", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-review-missing-"));

  assert.throws(
    () => packageProductionApprovalReviewScript.buildReviewPacket("package-runs/not-real", { repoRoot: tempRoot }),
    /Package run folder not found/
  );

  const output = captureConsole(() => packageProductionApprovalReviewScript.main(["package-runs/not-real", "--json"]));
  const payload = JSON.parse(output.stdout.join("\n"));
  assert.equal(output.result, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.externalApisCalled, false);
  assert.match(payload.error, /Package run folder not found/);
});

test("production approval review packet json cli is parseable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-review-json-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-json");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Review JSON" } }),
    "final-script.md": "# Final Script\n",
    "evidence-chain-summary.md": "# Evidence Chain Summary\n\n- Production approved: no\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
  });

  const output = captureConsole(() => packageProductionApprovalReviewScript.main([runDir, "--json"]));
  const payload = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.externalApisCalled, false);
  assert.equal(payload.currentProductionStatus.rawParsedProductionStatus, "READY TO SHOOT");
  assert.equal(payload.currentProductionStatus.effectiveProductionStatus, "NOT READY TO SHOOT");
  assert.equal(payload.blockingEvidence[0].file, "evidence-chain-summary.md");
});

test("production approval review packet does not mutate fixture files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-review-readonly-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-readonly");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Review Read Only" } }),
    "final-script.md": "# Final Script\n",
    "evidence-chain-summary.md": "# Evidence Chain Summary\n\n- Production approved: no\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
  });
  const beforeFiles = fs.readdirSync(runDir).sort();
  const beforeContent = Object.fromEntries(beforeFiles.map((filename) => [filename, fs.readFileSync(path.join(runDir, filename), "utf8")]));

  const packet = packageProductionApprovalReviewScript.buildReviewPacket(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  packageProductionApprovalReviewScript.renderText(packet);

  const afterFiles = fs.readdirSync(runDir).sort();
  const afterContent = Object.fromEntries(afterFiles.map((filename) => [filename, fs.readFileSync(path.join(runDir, filename), "utf8")]));
  assert.deepEqual(afterFiles, beforeFiles);
  assert.deepEqual(afterContent, beforeContent);
});

test("capture gap reporter is read-only and separates approval-required capture actions", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-gap-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-gap");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Capture Gap" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Capture evidence accepted: no\n- Real capture evidence detected: yes\n",
  });
  const before = fs.readdirSync(runDir).sort();

  const report = packageCaptureGapScript.buildCaptureGapReport("package-runs/2026-05-10-capture-gap", { repoRoot: tempRoot });
  const after = fs.readdirSync(runDir).sort();
  const text = packageCaptureGapScript.renderText(report);

  assert.deepEqual(after, before);
  assert.equal(report.reviewOnly, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.writesPerformed, false);
  assert.equal(report.externalApisCalled, false);
  assert.equal(report.overallStatus, "BLOCKED");
  assert.equal(report.gaps.some((gap) => gap.area === "capture-approval"), true);
  assert.equal(report.blockedActions.includes("Hermes brain write"), true);
  assert.equal(report.blockedActions.includes("project-state promotion"), true);
  assert.equal(report.approvalRequiredActions.includes("adding capture approval markers"), true);
  assert.deepEqual(
    report.safeInspectionCommands.filter((command) => /package-run-capture-evidence-review/.test(command)),
    []
  );
  assert.match(text, /Package Run Capture Gap/);
  assert.match(text, /Approval-required actions:/);
  assert.match(text, /Blocked actions:\n(?:- .+\n)*- Hermes brain write/);
});

test("capture gap reporter rejects generated and dummy smoke-test capture rows", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-gap-dummy-smoke-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-gap-dummy-smoke");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Capture Gap Dummy Smoke" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "capture-checklist.md":
      "# Capture Checklist\n\n- Capture checklist status: READY FOR HUMAN APPROVAL\n- Ready for rough cut: no\n\nCapture approval: NOT APPROVED\n",
    "takes-log.md":
      "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Take 1 | Screen-recorded comparison. | Verified in existing capture artifacts. | Generated checklist row. | closed |\n| TAKE-001 | shot-list.md smoke-test row | media/test-capture/take-001-hook.mov | Dummy smoke-test A-roll reference. Not real production approval. | captured |\n",
    "screen-recording-checklist.md":
      "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Workflow screen | Capture proof. | Verified in existing capture artifacts. | closed |\n| Screen recording smoke proof 001 | Dummy smoke-test screen recording reference. Not real production approval. | recordings/test-screen-proof-001.mp4 | captured |\n",
    "audio-capture-checklist.md":
      "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Record only approved script sections. | Verified in existing capture artifacts. | closed |\n| Voiceover smoke-test main pass | Dummy smoke-test audio reference. Not real production approval. | audio/test-voiceover-main.wav | recorded |\n\nAudio capture readiness: NOT APPROVED\n",
  });

  const report = packageCaptureGapScript.buildCaptureGapReport("package-runs/2026-05-10-capture-gap-dummy-smoke", { repoRoot: tempRoot });

  assert.equal(report.captureEvidenceStatus, "NEEDS CAPTURE");
  assert.equal(report.realCaptureEvidence, false);
  assert.equal(report.captureEvidenceAccepted, false);
  assert.equal(report.gaps.some((gap) => gap.area === "real-capture-evidence"), true);
  assert.equal(report.gaps.some((gap) => gap.area === "capture-approval"), true);
  assert.equal(report.blockedActions.includes("rough-cut assembly"), true);
});

test("capture gap reporter returns blocked read-only report for missing run directory", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-gap-missing-"));
  const missingRun = path.join(tempRoot, "package-runs", "definitely-missing");

  const report = packageCaptureGapScript.buildCaptureGapReport("package-runs/definitely-missing", { repoRoot: tempRoot });
  const text = packageCaptureGapScript.renderText(report);

  assert.equal(fs.existsSync(missingRun), false);
  assert.equal(report.overallStatus, "BLOCKED");
  assert.equal(report.reviewOnly, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.writesPerformed, false);
  assert.equal(report.externalApisCalled, false);
  assert.equal(report.captureEvidenceAccepted, false);
  assert.equal(
    report.gaps.some(
      (gap) =>
        gap.area === "package-run-folder" &&
        gap.status === "missing-folder" &&
        /Package run folder is missing/.test(gap.reason)
    ),
    true
  );
  assert.equal(report.blockedActions.includes("Hermes brain write"), true);
  assert.equal(report.blockedActions.includes("project-state promotion"), true);
  assert.match(text, /Package run folder is missing/);
  assert.equal(fs.existsSync(missingRun), false);
});

test("capture gap reporter builds json-ready output and help", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-capture-gap-json-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-gap-json");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Capture Gap JSON" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: NEEDS CAPTURE\n- Capture evidence accepted: no\n- Real capture evidence detected: no\n",
  });
  const report = packageCaptureGapScript.buildCaptureGapReport("package-runs/2026-05-10-capture-gap-json", { repoRoot: tempRoot });
  const parsed = JSON.parse(JSON.stringify(report));
  assert.equal(parsed.runId, "2026-05-10-capture-gap-json");
  assert.equal(parsed.reviewOnly, true);
  assert.equal(parsed.writesPerformed, false);
  assert.deepEqual(packageCaptureGapScript.parseArgs(["package-runs/run", "--json"]), {
    runDir: "package-runs/run",
    json: true,
    help: false,
  });
  assert.equal(packageCaptureGapScript.main(["--help"]), 0);
});

function createArtifactHygieneRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-artifact-hygiene-"));
  runGitCommand(tempRoot, ["init", "-b", "main"]);
  runGitCommand(tempRoot, ["config", "user.email", "test@example.invalid"]);
  runGitCommand(tempRoot, ["config", "user.name", "Test User"]);
  const runRel = "package-runs/2026-05-02-ai-video-idea-filter";
  writeTestFile(
    tempRoot,
    `${runRel}/production-plan.md`,
    "# Production Plan\n\n- Shoot-readiness status: NOT READY TO SHOOT\n"
  );
  runGitCommand(tempRoot, ["add", `${runRel}/production-plan.md`]);
  runGitCommand(tempRoot, ["commit", "-m", "baseline"]);
  return { tempRoot, runRel };
}

function classificationByFile(report) {
  return Object.fromEntries(report.classifications.map((item) => [item.file, item]));
}

test("artifact hygiene reporter flags misleading capture approval artifacts", () => {
  const fixture = createArtifactHygieneRepo();
  writeTestFile(
    fixture.tempRoot,
    `${fixture.runRel}/capture-checklist.md`,
    "# Capture Checklist\n\n- Capture checklist status: READY FOR HUMAN APPROVAL\n"
  );
  writeTestFile(
    fixture.tempRoot,
    `${fixture.runRel}/takes-log.md`,
    "# Takes Log\n\n| take | file/reference | status |\n| --- | --- | --- |\n| Hook | Verified in existing capture artifacts. | captured |\n| Smoke test | media/test-capture/take-001-hook.mov | Capture readiness approved. Dummy smoke-test reference. Not real production approval. |\n"
  );
  writeTestFile(
    fixture.tempRoot,
    `${fixture.runRel}/shot-list.md`,
    "# Shot List\n\n| shot | status |\n| --- | --- |\n| Hook screen proof | captured |\n"
  );
  const beforeStatus = runGitCommand(fixture.tempRoot, ["status", "--short"]);

  const report = packageArtifactHygieneScript.buildArtifactHygieneReport(fixture.runRel, { repoRoot: fixture.tempRoot });
  const byFile = classificationByFile(report);
  const afterStatus = runGitCommand(fixture.tempRoot, ["status", "--short"]);

  assert.equal(report.readOnly, true);
  assert.equal(report.writesPerformed, false);
  assert.equal(report.externalApisCalled, false);
  assert.equal(afterStatus, beforeStatus);
  assert.equal(byFile[`${fixture.runRel}/capture-checklist.md`].classification, "dangerous-or-misleading");
  assert.equal(byFile[`${fixture.runRel}/takes-log.md`].classification, "dangerous-or-misleading");
  assert.equal(byFile[`${fixture.runRel}/shot-list.md`].classification, "dangerous-or-misleading");
  assert.deepEqual(report.dangerousFiles.sort(), [
    `${fixture.runRel}/capture-checklist.md`,
    `${fixture.runRel}/shot-list.md`,
    `${fixture.runRel}/takes-log.md`,
  ]);
});

test("artifact hygiene reporter does not flag negative approval wording as dangerous", () => {
  const fixture = createArtifactHygieneRepo();
  [
    [
      "capture-checklist.md",
      "# Capture Checklist\n\n- Capture checklist status: BLOCKED\n- Capture approval: NOT APPROVED\n- Ready for rough cut: no\n- Keep blocked until real production capture exists.\n",
    ],
    [
      "takes-log.md",
      "# Takes Log\n\n| take | file/reference | status |\n| --- | --- | --- |\n| Hook | No accepted capture file yet. | not captured |\n\nDRAFT ONLY. Not accepted, not final.\n",
    ],
  ].forEach(([filename, content]) => writeTestFile(fixture.tempRoot, `${fixture.runRel}/${filename}`, content));

  const report = packageArtifactHygieneScript.buildArtifactHygieneReport(fixture.runRel, { repoRoot: fixture.tempRoot });
  const byFile = classificationByFile(report);

  assert.equal(byFile[`${fixture.runRel}/capture-checklist.md`].classification, "planning-scaffold");
  assert.equal(byFile[`${fixture.runRel}/takes-log.md`].classification, "planning-scaffold");
  assert.equal(report.dangerousFiles.length, 0);
});

test("artifact hygiene reporter classifies premature downstream lifecycle scaffolds", () => {
  const fixture = createArtifactHygieneRepo();
  [
    ["rough-cut-review.md", "# Rough-Cut Review\n\nBlocked draft scaffold. NOT APPROVED. Keep blocked.\n"],
    ["final-review.md", "# Final Review\n\nBlocked draft scaffold. No accepted final cut. Final review status: BLOCKED.\n"],
    ["export-checklist.md", "# Export Checklist\n\nBlocked draft scaffold. Ready to upload: no. DRAFT ONLY.\n"],
    ["publish-metadata-review.md", "# Publication Metadata Review\n\nBlocked draft scaffold. Ready to schedule: no. Not final.\n"],
    ["archive-manifest.md", "# Archive Manifest\n\nBlocked draft scaffold. Ready to archive: no. NOT APPROVED.\n"],
  ].forEach(([filename, content]) => writeTestFile(fixture.tempRoot, `${fixture.runRel}/${filename}`, content));

  const report = packageArtifactHygieneScript.buildArtifactHygieneReport(fixture.runRel, { repoRoot: fixture.tempRoot });
  const byFile = classificationByFile(report);

  assert.equal(report.untrackedPackageRunFileCount, 5);
  assert.equal(byFile[`${fixture.runRel}/rough-cut-review.md`].classification, "downstream-lifecycle-scaffold");
  assert.equal(byFile[`${fixture.runRel}/final-review.md`].classification, "downstream-lifecycle-scaffold");
  assert.equal(byFile[`${fixture.runRel}/export-checklist.md`].classification, "downstream-lifecycle-scaffold");
  assert.equal(byFile[`${fixture.runRel}/publish-metadata-review.md`].classification, "downstream-lifecycle-scaffold");
  assert.equal(byFile[`${fixture.runRel}/archive-manifest.md`].classification, "downstream-lifecycle-scaffold");
  assert.equal(report.dangerousFiles.length, 0);
});

test("artifact hygiene reporter includes matching tmp scripts and parseable json output", () => {
  const fixture = createArtifactHygieneRepo();
  writeTestFile(fixture.tempRoot, `${fixture.runRel}/research-sufficiency-review.md`, "# Research Sufficiency Review\n\nObserved proof notes.\n");
  writeTestFile(fixture.tempRoot, "tmp-may2-cdp-check.js", "console.log('scratch');\n");
  writeTestFile(fixture.tempRoot, "tmp-unrelated-cdp-check.js", "console.log('scratch');\n");
  const beforeStatus = runGitCommand(fixture.tempRoot, ["status", "--short"]);

  const output = childProcess.execFileSync(
    process.execPath,
    [path.join(__dirname, "..", "scripts", "package-run-artifact-hygiene.js"), fixture.runRel, "--json"],
    { cwd: fixture.tempRoot, encoding: "utf8" }
  );
  const afterStatus = runGitCommand(fixture.tempRoot, ["status", "--short"]);
  const report = JSON.parse(output);
  const byFile = classificationByFile(report);

  assert.equal(afterStatus, beforeStatus);
  assert.equal(report.readOnly, true);
  assert.equal(report.writesPerformed, false);
  assert.equal(report.externalApisCalled, false);
  assert.deepEqual(report.tempScripts, ["tmp-may2-cdp-check.js"]);
  assert.equal(byFile["tmp-may2-cdp-check.js"].classification, "scratch-temp");
  assert.equal(byFile[`${fixture.runRel}/research-sufficiency-review.md`].classification, "proof");
  assert.equal(report.untrackedFiles.includes("tmp-unrelated-cdp-check.js"), false);
});

test("artifact hygiene reporter allows research pass marker without production approval", () => {
  const fixture = createArtifactHygieneRepo();
  writeTestFile(
    fixture.tempRoot,
    `${fixture.runRel}/research-sufficiency-review.md`,
    "# Research Sufficiency Review\n\n- Research approval marker: PASS\n- Scope: research only, not production approval.\n"
  );

  const report = packageArtifactHygieneScript.buildArtifactHygieneReport(fixture.runRel, { repoRoot: fixture.tempRoot });
  const byFile = classificationByFile(report);

  assert.equal(byFile[`${fixture.runRel}/research-sufficiency-review.md`].classification, "proof");
  assert.equal(report.dangerousFiles.length, 0);
});

test("artifact hygiene reporter rejects run paths outside package-runs read-only", () => {
  const fixture = createArtifactHygieneRepo();
  writeTestFile(fixture.tempRoot, "notes.md", "# Notes\n");
  const output = captureConsole(() =>
    packageArtifactHygieneScript.main(["notes.md", "--json"])
  );
  const parsed = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 1);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /package-runs/);
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.writesPerformed, false);
  assert.equal(parsed.externalApisCalled, false);
  assert.equal(fs.existsSync(path.join(fixture.tempRoot, "notes.md")), true);
});

test("package run doctor reports requested pipeline stages and overall status", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-doctor-pipeline-"));
  const runsDir = path.join(tempRoot, "package-runs");

  function makeRun(runId, files) {
    const runDir = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    Object.entries(files).forEach(([filename, content]) => fs.writeFileSync(path.join(runDir, filename), content, "utf8"));
    return runDir;
  }

  const selected = { "selected-package.json": JSON.stringify({ package: { proposedTitle: "Pipeline Doctor" } }) };
  const scriptApproved = {
    ...selected,
    "research-pack.md": "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PASS\n",
    "script-structure.md": "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Ready to draft: yes\n",
    "script-review.md": "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n",
    "final-script.md": "# Final Script\n",
  };
  const productionReady = {
    ...scriptApproved,
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
  };
  const shotEditAccepted = {
    "shot-edit-plan-review.md": "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n\n## Open Blockers\n\n- None.\n",
    "shot-edit-plan-enhancement-plan.md": "# Shot/Edit Plan Enhancement Plan\n\n| priority | artifact | issue | suggested repair | reason |\n| --- | --- | --- | --- | --- |\n| low | planning artifacts | No automatic repair suggested. | Keep accepted scope. | Accepted. |\n",
  };
  const realCaptureEvidence = {
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n\nCapture approval: PASS\n",
    "takes-log.md": "# Takes Log\n\n| take | source item | file/reference | quality notes | status |\n| --- | --- | --- | --- | --- |\n| Main proof take | shot-list.md | media/main-proof.mov | Reviewed and usable. | captured |\n",
    "missing-shot-tracker.md": "# Missing Shot Tracker\n\n| missing shot/content | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Capture is complete. | No fix needed. | closed |\n",
    "screen-recording-checklist.md": "# Screen Recording Checklist\n\n| screen recording | proof purpose | file/reference | status |\n| --- | --- | --- | --- |\n| Proof screen recording | Shows workflow output. | media/proof.mp4 | captured |\n",
    "audio-capture-checklist.md": "# Audio Capture Checklist\n\n| audio item | capture requirement | file/reference | status |\n| --- | --- | --- | --- |\n| Voiceover | Final script audio. | audio/voiceover.wav | closed |\n\nAudio capture readiness: PASS\n",
    "capture-evidence-review.md": "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Real capture evidence detected: yes\n",
  };
  const realRoughCutEvidence = {
    "rough-cut-watch-notes.md":
      "# Rough-Cut Watch Notes\n\nRough cut file media/pipeline-rough-cut-v1.mp4 was reviewed in an actual viewing pass. Pacing, visual proof, audio clarity, and edit continuity were reviewed and no pickups or edit fixes remain open.\n",
    "rough-cut-review.md": "# Rough-Cut Review\n\n- Rough-cut review status: READY FOR SECOND CUT\n- Second-cut ready: yes\n",
  };
  const realFinalEvidence = {
    "final-watch-notes.md":
      "# Final Watch Notes\n\nFinal export media/pipeline-final-cut.mp4 reviewed after the completed edit. Viewer promise delivery, opening strength, clarity, pacing, proof, audio quality, visual support, graphics, title fit, accuracy risk, and archive readiness were reviewed.\n",
    "final-review.md": "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n",
    "publication-blockers.md": "# Publication Blockers\n",
  };
  const realExportEvidence = {
    "export-checklist.md": "# Export Checklist\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n\nExport approval: PASS\n",
    "master-file-manifest.md": "# Master File Manifest\n\nFinal master: exports/final.mp4\nCodec: H.264\nResolution: 3840x2160\nChecksum recorded.\n",
    "caption-check.md": "# Caption Check\n\nCaptions reviewed and matched against the final master export.\n",
    "loudness-check.md": "# Loudness Check\n\nFinal master measured at -14 LUFS integrated.\n\nMastering approval: PASS\n",
    "delivery-readiness.md": "# Delivery Readiness\n\n- Export checklist status: READY TO UPLOAD\n- Ready to upload: yes\n\nFinal export package reviewed.\n\nDelivery approval: PASS\n",
  };
  const realMetadataEvidence = {
    "publish-metadata-review.md":
      "# Publication Metadata Review\n\n- Publication metadata status: READY TO SCHEDULE\n- Ready to schedule: yes\n\nPublication metadata approval: PASS\n",
    "title-check.md": "# Title Check\n\nFinal title: Pipeline Doctor Final Title approved for upload metadata.\n",
    "thumbnail-check.md": "# Thumbnail Check\n\nThumbnail path: thumbnails/pipeline-doctor-final.png approved after review.\n",
    "description-check.md": "# Description Check\n\nDescription has final publish copy, proof context, links, and reviewed upload wording.\n",
    "chapters-check.md": "# Chapters Check\n\n00:00 Hook\n01:00 Proof\n03:00 Workflow\n05:00 Close\n",
    "schedule-check.md": "# Schedule Check\n\nRelease timing approved for 2026-05-15 16:00 Europe/Helsinki.\n",
  };
  const realArchiveEvidence = {
    "archive-manifest.md": "# Archive Manifest\n\n- Archive manifest status: READY TO ARCHIVE\n- Ready to archive: yes\n\nArchive contains final export, metadata, captions, source files, and project assets.\n\nArchive approval: PASS\n",
    "archive-source-files.md": "# Archive Source Files\n\nResolve project, script, captures, and metadata source files are listed with local paths.\n",
    "archive-assets-manifest.md": "# Archive Assets Manifest\n\nThumbnail, graphics, captures, b-roll, audio, and caption assets are listed with local paths.\n",
    "archive-export-manifest.md": "# Archive Export Manifest\n\nFinal export, captions, metadata package, and checksum are recorded.\n",
    "reusable-clips-manifest.md": "# Reusable Clips Manifest\n\nReusable proof, intro, and recap clips are listed with edit references.\n",
    "archive-blockers.md": "# Archive Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Archive is complete. | No fix needed. | closed |\n",
  };
  const finalReady = {
    ...productionReady,
    ...shotEditAccepted,
    ...realCaptureEvidence,
    ...realRoughCutEvidence,
    ...realFinalEvidence,
  };
  const exportReady = {
    ...finalReady,
    ...realExportEvidence,
  };
  const metadataReady = {
    ...exportReady,
    ...realMetadataEvidence,
  };
  const archiveReady = {
    ...metadataReady,
    ...realArchiveEvidence,
  };

  const missingResearchDir = makeRun("2026-05-10-missing-research", selected);
  const scriptApprovedDir = makeRun("2026-05-10-script-approved", scriptApproved);
  const productionReadyDir = makeRun("2026-05-10-production-ready", productionReady);
  const finalReadyDir = makeRun("2026-05-10-final-ready", finalReady);
  const exportReadyDir = makeRun("2026-05-10-export-ready", exportReady);
  const metadataReadyDir = makeRun("2026-05-10-metadata-ready", metadataReady);
  const archiveReadyDir = makeRun("2026-05-10-archive-ready", archiveReady);

  const missingResearch = packageRunDoctorScript.buildDoctorReport(missingResearchDir, { repoRoot: tempRoot });
  const scriptApprovedReport = packageRunDoctorScript.buildDoctorReport(scriptApprovedDir, { repoRoot: tempRoot });
  const productionReadyReport = packageRunDoctorScript.buildDoctorReport(productionReadyDir, { repoRoot: tempRoot });
  const finalReadyReport = packageRunDoctorScript.buildDoctorReport(finalReadyDir, { repoRoot: tempRoot });
  const exportReadyReport = packageRunDoctorScript.buildDoctorReport(exportReadyDir, { repoRoot: tempRoot });
  const metadataReadyReport = packageRunDoctorScript.buildDoctorReport(metadataReadyDir, { repoRoot: tempRoot });
  const archiveReadyReport = packageRunDoctorScript.buildDoctorReport(archiveReadyDir, { repoRoot: tempRoot });

  assert.equal(missingResearch.lifecycleStatus, "Package selected");
  assert.equal(missingResearch.overallStatus, "BLOCKED");
  assert.deepEqual(missingResearch.missingExpectedArtifacts, ["research-pack.md"]);

  assert.equal(scriptApprovedReport.lifecycleStatus, "Needs production planning");
  assert.equal(scriptApprovedReport.overallStatus, "BLOCKED");
  assert.match(scriptApprovedReport.nextRecommendedCommand, /package-run-production-plan\.js/);
  assert.equal(scriptApprovedReport.approvalMarkersDetected.includes("Script review status: PASS"), true);

  assert.equal(productionReadyReport.lifecycleStatus, "Needs shot/edit plan review");
  assert.equal(productionReadyReport.overallStatus, "BLOCKED");
  assert.match(productionReadyReport.nextRecommendedCommand, /package-run-shot-edit-plan-review\.js/);

  assert.equal(finalReadyReport.lifecycleStatus, "Ready to publish");
  assert.match(finalReadyReport.nextRecommendedCommand, /package-run-export-checklist\.js/);

  assert.equal(exportReadyReport.lifecycleStatus, "Ready to upload");
  assert.match(exportReadyReport.nextRecommendedCommand, /package-run-publication-metadata\.js/);

  assert.equal(metadataReadyReport.lifecycleStatus, "Ready to schedule");
  assert.match(metadataReadyReport.nextRecommendedCommand, /package-run-archive-manifest\.js/);

  assert.equal(archiveReadyReport.lifecycleStatus, "Ready to archive");
  assert.equal(archiveReadyReport.overallStatus, "COMPLETE ENOUGH FOR HUMAN REVIEW");
  assert.match(archiveReadyReport.nextRecommendedCommand, /package-run-repurpose\.js/);
});

test("package run doctor does not treat placeholder capture artifacts as ready", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-doctor-placeholder-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-placeholder");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Placeholder Doctor" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-enhancement-plan.md"), "# Shot/Edit Plan Enhancement Plan\n", "utf8");
  [
    "capture-checklist.md",
    "takes-log.md",
    "missing-shot-tracker.md",
    "screen-recording-checklist.md",
    "audio-capture-checklist.md",
  ].forEach((filename) => fs.writeFileSync(path.join(runDir, filename), "# Placeholder\n\nTODO\n", "utf8"));

  const report = packageRunDoctorScript.buildDoctorReport(runDir, { repoRoot: tempRoot });

  assert.equal(report.lifecycleStatus, "Needs capture");
  assert.equal(report.overallStatus, "BLOCKED");
  assert.match(report.firstBlockerReason, /capture-evidence-review\.md is missing|Capture checklist status is missing/);
  assert.doesNotMatch(report.nextRecommendedCommand, /rough-cut-review/);
});

test("package run doctor treats current workflow artifacts as known", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-doctor-known-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-doctor-known");
  const knownArtifacts = [
    "script-review.md",
    "script-revision-plan.md",
    "script-draft.md",
    "shot-list.md",
    "screen-capture-list.md",
    "demo-list.md",
    "audio-notes.md",
    "shot-edit-plan-review.md",
    "shot-edit-plan-enhancement-plan.md",
    "production-notes.md",
  ];
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Doctor Known Artifacts Test" } }),
    "utf8"
  );
  knownArtifacts.forEach((filename) => fs.writeFileSync(path.join(runDir, filename), `# ${filename}\n`, "utf8"));
  fs.writeFileSync(path.join(runDir, "manual-note.md"), "# Human note\n", "utf8");

  const before = fs.readdirSync(runDir).sort();
  const report = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  knownArtifacts.forEach((filename) => {
    assert.equal(report.detectedKnownArtifacts.includes(filename), true, `${filename} should be known`);
    assert.equal(report.unknownManualFiles.includes(filename), false, `${filename} should not be unknown`);
  });
  assert.deepEqual(report.unknownManualFiles, ["manual-note.md"]);
});

test("package runs index recommends script review when production plan needs script approval", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-script-approval-next-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-script-approval");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Script Approval Next Command" } }),
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n",
    "utf8"
  );
  const before = fs.readdirSync(runDir).sort();

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const run = index.runs[0];
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(run.status, "Needs production planning");
  assert.equal(run.lifecycleGate.productionPlanStatus, "NEEDS SCRIPT APPROVAL");
  assert.equal(
    run.nextRecommendedCommand,
    "node scripts/package-run-script-review.js package-runs/2026-05-10-script-approval"
  );
  assert.match(doctor.nextRecommendedCommand, /package-run-script-review\.js/);
  assert.match(doctor.firstBlockerReason, /NEEDS SCRIPT APPROVAL/);
});

test("package run doctor reports partial research before downstream production symptoms", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-root-research-blocker-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-root-research");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Root Research Blocker" } }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: source list is TODO\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n",
    "utf8"
  );
  const before = fs.readdirSync(runDir).sort();

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const run = index.runs[0];
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(run.lifecycleGate.researchGateStatus, "PARTIAL");
  assert.equal(run.lifecycleGate.productionPlanStatus, "NEEDS SCRIPT APPROVAL");
  assert.match(run.nextRecommendedCommand, /package-run-research-evidence\.js/);
  assert.match(doctor.nextRecommendedCommand, /package-run-research-evidence\.js/);
  assert.match(doctor.firstBlockerReason, /Research Sufficiency Gate is PARTIAL/);
  assert.deepEqual(doctor.missingExpectedArtifacts, ["research evidence with Research Sufficiency Gate: PASS"]);
});

test("package run doctor reports script structure blocker after research pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-root-structure-blocker-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-root-structure");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Root Structure Blocker" } }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: PARTIAL\n- Ready to draft: no\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n",
    "utf8"
  );
  const before = fs.readdirSync(runDir).sort();

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const run = index.runs[0];
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(run.lifecycleGate.researchGateStatus, "PASS");
  assert.equal(run.lifecycleGate.scriptStructureStatus, "PARTIAL");
  assert.match(run.nextRecommendedCommand, /package-run-script-structure\.js/);
  assert.match(doctor.firstBlockerReason, /Script structure status is PARTIAL/);
  assert.deepEqual(doctor.missingExpectedArtifacts, [
    "script-structure.md with Script structure status: READY TO DRAFT",
  ]);
});

test("package run doctor reports script review blocker after research and structure pass", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-root-review-blocker-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-root-review");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Root Review Blocker" } }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Ready to draft: yes\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-review.md"),
    "# Script Review\n\n- Script review status: NEEDS REVISION\n- Production planning ready: no\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n",
    "utf8"
  );
  const before = fs.readdirSync(runDir).sort();

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const run = index.runs[0];
  const doctor = packageRunDoctorScript.buildDoctorReport(runDir);
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(run.lifecycleGate.scriptReviewStatus, "NEEDS REVISION");
  assert.equal(run.lifecycleGate.productionPlanningReady, false);
  assert.match(run.nextRecommendedCommand, /package-run-script-review\.js/);
  assert.match(doctor.firstBlockerReason, /Script review status is NEEDS REVISION/);
  assert.deepEqual(doctor.missingExpectedArtifacts, [
    "script-review.md with Script review status: PASS and Production planning ready: yes",
  ]);
});

test("verify script checks package run doctor syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/package-run-doctor\.js/);
});

test("verify script checks package run next action syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/package-run-next-action\.js/);
});

test("package run next action reports needs capture truthfully", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-next-action-capture-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-needs-capture");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Needs Capture Test" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-review.md"), "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-enhancement-plan.md"), "# Shot/Edit Plan Enhancement Plan\n", "utf8");
  fs.writeFileSync(path.join(runDir, "capture-checklist.md"), "# Capture Checklist\n\n- Capture checklist status: NEEDS CAPTURE\n- Ready for rough cut: no\n", "utf8");
  fs.writeFileSync(path.join(runDir, "takes-log.md"), "# Takes Log\n\nTODO\n", "utf8");
  fs.writeFileSync(path.join(runDir, "missing-shot-tracker.md"), "# Missing Shot Tracker\n\nTODO\n", "utf8");
  fs.writeFileSync(path.join(runDir, "screen-recording-checklist.md"), "# Screen Recording Checklist\n\nTODO\n", "utf8");
  fs.writeFileSync(path.join(runDir, "audio-capture-checklist.md"), "# Audio Capture Checklist\n\nTODO\n", "utf8");

  const report = packageRunNextActionScript.buildNextActionReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.runTitle, "Needs Capture Test");
  assert.equal(report.currentStage, "Needs capture");
  assert.equal(report.dashboardBucket, "Needs capture");
  assert.equal(report.owner, "Hermes");
  assert.match(report.blockingFacts.join("\n"), /capture-evidence-review\.md is missing|Capture checklist status/);
  assert.match(report.nextAction, /capture evidence|Capture checklist/i);
  assert.match(report.commandToRun, /package-run-capture-evidence-review\.js|manual review/);
  assert.equal(report.readOnly, true);
});

test("package run next action reports needs QA repair", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-next-action-qa-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-needs-qa");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Needs QA Test" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "b-roll-list.md"), "# B-Roll List\n", "utf8");
  fs.writeFileSync(path.join(runDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "NEEDS WORK" }), "utf8");

  const report = packageRunNextActionScript.buildNextActionReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.dashboardBucket, "Needs QA repair");
  assert.equal(report.owner, "Codex");
  assert.match(report.blockingFacts.join("\n"), /Creator QA status is NEEDS WORK/);
  assert.match(report.commandToRun, /Review Creator QA status NEEDS WORK/);
});

test("package run next action reports ready to shoot without approving production", () => {
  const doctorLike = {
    lifecycleStatus: "Ready to shoot",
    nextRecommendedCommand: "",
    firstBlockerReason: "",
  };

  assert.equal(packageRunNextActionScript.actionOwner(doctorLike), "Codex");
  assert.match(packageRunNextActionScript.nextActionText(doctorLike), /next local review command/);
});

test("package run next action reports missing artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-next-action-missing-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-missing");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Missing Artifact Test" } }), "utf8");

  const report = packageRunNextActionScript.buildNextActionReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  const text = packageRunNextActionScript.renderText(report);

  assert.equal(report.currentStage, "Package selected");
  assert.match(report.blockingFacts.join("\n"), /research-pack\.md/);
  assert.match(report.commandToRun, /package-run-research-pack\.js/);
  assert.match(text, /Package Run Next Action/);
});

test("package run next action reports conflicting visual risk artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-next-action-visual-risk-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-visual-risk");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Visual Risk Test" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "visual-risk-check.md"), "# Visual Risk Check\n\n- Status: NEEDS REVIEW\n", "utf8");

  const report = packageRunNextActionScript.buildNextActionReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.visualRiskPresent, true);
  assert.match(report.blockingFacts.join("\n"), /visual-risk-check\.md exists/);
});

test("package run next action json cli is parseable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-next-action-json-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-json");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "JSON Test" } }), "utf8");

  const output = captureConsole(() =>
    packageRunNextActionScript.main([runDir, "--json"])
  );
  const parsed = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.equal(parsed.runTitle, "JSON Test");
  assert.equal(parsed.readOnly, true);
});

test("verify script checks package run capture gap syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/package-run-capture-gap\.js/);
});

test("package runs index recommends deterministic next local commands", () => {
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Package selected", "package-runs/run-id"),
    "node scripts/package-run-research-pack.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Research pack ready", "package-runs/run-id"),
    "node scripts/package-engine-new-outline.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Final outline ready", "package-runs/run-id"),
    "node scripts/package-engine-new-script.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Final script ready", "package-runs/run-id"),
    "node scripts/package-engine-new-production.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "not run"),
    "node scripts/package-run-creator-qa.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "not run", {
      blocksProductionReady: true,
    }),
    "Capture or import durable proof evidence before production approval."
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "not run", {
      blocksProductionReady: true,
      hasNarrowShootingApproval: true,
    }),
    "Shoot only the narrow approved scope; editing, publishing, upload prep, final title, and final thumbnail remain blocked."
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "FAIL"),
    "Review creator-qa-report.md and repair package/script before shooting."
  );
  assert.equal(packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "PASS"), "");
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Needs shot/edit plan review", "package-runs/run-id", "PASS"),
    "node scripts/package-run-shot-edit-plan-review.js package-runs/run-id"
  );
  assert.equal(packageRunsIndexScript.nextRecommendedCommand("Needs shot/edit plan approval", "package-runs/run-id", "PASS"), "");
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "NEEDS WORK"),
    "Review Creator QA status NEEDS WORK and repair package/script before shooting."
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "REVIEW REQUIRED"),
    "Review Creator QA status REVIEW REQUIRED and repair package/script before shooting."
  );
  assert.equal(packageRunsIndexScript.workflowBucket("Script prep ready"), "Needs script");
  assert.equal(packageRunsIndexScript.workflowBucket("Production prep ready"), "Needs production prep");
  assert.equal(packageRunsIndexScript.workflowBucket("Production prep ready", "FAIL"), "Needs QA repair");
  assert.equal(packageRunsIndexScript.workflowBucket("Needs shot/edit plan review"), "Needs shot/edit plan review");
  assert.equal(packageRunsIndexScript.workflowBucket("Needs shot/edit plan approval"), "Needs shot/edit plan approval");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "not run"), "QA not run");
  assert.equal(
    packageRunsIndexScript.workflowBucket("Ready to shoot", "not run", {
      blocksProductionReady: true,
      hasNarrowShootingApproval: true,
    }),
    "Narrow shooting approved"
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

test("package engine server exposes thumbnail candidates with browser-loadable images", () => {
  assert.equal(packageEngineServer.API_PREFIX, "/api/package-engine/thumbnails");
  const candidates = packageEngineServer.createCandidates({
    topic: "AI video idea filter",
    thumbnailConcept: "Creator sorting ideas",
    onThumbnailText: "Stop guessing",
    count: 3,
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].creator, "placeholder-svg");
  assert.match(candidates[0].id, /^ai-video-idea-filter-1$/);
  assert.match(candidates[0].thumbnailImage, /^data:image\/svg\+xml;base64,/);
  assert.match(candidates[0].prompt, /Creator sorting ideas/);
});

test("package engine thumbnail response defaults to placeholder provider", async () => {
  const response = await packageEngineServer.createThumbnailResponse({
    topic: "AI video idea filter",
    thumbnailConcept: "Creator sorting ideas",
    onThumbnailText: "Stop guessing",
    count: 3,
  }, { env: {} });

  assert.equal(response.provider, "placeholder");
  assert.equal(response.model, "local-svg-placeholder");
  assert.equal(response.candidates.length, 3);
  assert.match(response.candidates[0].thumbnailImage, /^data:image\/svg\+xml;base64,/);
});

test("package engine server status reports provider and model without generation", () => {
  const placeholder = packageEngineServer.createStatusResponse({});
  const openai = packageEngineServer.createStatusResponse({
    THUMBNAIL_PROVIDER: "openai",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
  });

  assert.equal(placeholder.ok, true);
  assert.equal(placeholder.thumbnailProvider, "placeholder");
  assert.equal(placeholder.model, "local-svg-placeholder");
  assert.equal(placeholder.api, "/api/package-engine/thumbnails");
  assert.equal(placeholder.captureEvidenceWrite.previewApi, "/api/package-runs/capture-evidence/preview");
  assert.equal(placeholder.captureEvidenceWrite.applyApi, "/api/package-runs/capture-evidence/apply");
  assert.equal(placeholder.captureEvidenceWrite.nonceHeader, "x-vidtoolz-local-write-nonce");
  assert.equal(Boolean(placeholder.captureEvidenceWrite.localWriteNonce), true);
  assert.equal(openai.thumbnailProvider, "openai");
  assert.equal(openai.model, "gpt-image-1");
});

test("package engine capture evidence write nonce and local origin checks are enforced", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const localReq = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };
  const curlReq = {
    headers: {
      host: "localhost:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };

  assert.equal(packageEngineServer.validateLocalWriteRequest(localReq, {}, { port: 8010, writeNonce: nonce }), true);
  assert.equal(packageEngineServer.validateLocalWriteRequest(curlReq, {}, { port: 8010, writeNonce: nonce }), true);
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest({ headers: { host: "127.0.0.1:8010" } }, {}, { port: 8010, writeNonce: nonce }),
    /valid local write nonce/
  );
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest({
      headers: {
        host: "127.0.0.1:8010",
        origin: "https://example.com",
        [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
      },
    }, {}, { port: 8010, writeNonce: nonce }),
    /non-local Origin/
  );
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest({
      headers: {
        host: "example.com:8010",
        origin: "http://127.0.0.1:8010",
        [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
      },
    }, {}, { port: 8010, writeNonce: nonce }),
    /local Host/
  );
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

test("package engine provider config defaults and respects openai mode", () => {
  const defaults = packageEngineServer.providerConfig({});
  const openai = packageEngineServer.providerConfig({
    THUMBNAIL_PROVIDER: "openai",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
  });

  assert.equal(defaults.provider, "placeholder");
  assert.equal(defaults.model, "gpt-image-1");
  assert.equal(openai.provider, "openai");
  assert.equal(openai.model, "gpt-image-1");
});

test("package engine openai thumbnail mode requires an api key", async () => {
  await assert.rejects(
    () => packageEngineServer.createThumbnailResponse({
      topic: "AI video idea filter",
      thumbnailConcept: "Creator sorting ideas",
      onThumbnailText: "Stop guessing",
    }, { env: { THUMBNAIL_PROVIDER: "openai" } }),
    /OPENAI_API_KEY is required when THUMBNAIL_PROVIDER=openai/
  );
});

test("package engine openai prompt builder creates three distinct safe youtube prompts", () => {
  const prompts = packageEngineServer.buildOpenAIThumbnailPrompts({
    topic: "AI video idea filter",
    thumbnailConcept: "Creator comparing video ideas",
    onThumbnailText: "TEST BEFORE YOU SHOOT",
    viewerPromise: "Avoid wasting a week on the wrong video",
    targetViewer: "serious solo creators",
  });

  assert.equal(prompts.length, 3);
  assert.equal(new Set(prompts).size, 3);
  prompts.forEach((prompt) => {
    assert.match(prompt, /16:9 YouTube thumbnail/);
    assert.match(prompt, /No fake logos/);
    assert.match(prompt, /no celebrity or public figure likeness/);
    assert.match(prompt, /TEST BEFORE YOU SHOOT/);
    assert.match(prompt, /serious solo creators/);
  });
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

test("package engine browser code falls back to candidate thumbnail when no generated image exists", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  assert.match(script, /function primaryGeneratedThumbnailImage\(candidate\)/);
  assert.match(script, /function mainThumbnailImage\(candidate\)/);
  assert.match(script, /return primaryGeneratedThumbnailImage\(candidate\) \|\| candidateThumbnailImage\(candidate\);/);
});

test("package engine browser code updates main thumbnail after generation", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  assert.match(script, /let generatedThumbnailsByCandidate = \{\};/);
  assert.match(script, /\[selected\.id\]: normalized/);
  assert.match(script, /const mainImage = mainThumbnailImage\(candidate\);/);
  assert.match(script, /mainImage\s*\?\s*`<img src="\$\{escapeHtml\(mainImage\)\}/);
});

test("package engine browser code updates only the owning card when selecting generated thumbnails", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  assert.match(script, /const owner = candidateSet\.candidates\.find/);
  assert.match(script, /\[owner\.id\]: updated/);
  assert.match(script, /generateMoreThumbnailCandidates\(thumbGenerate\.dataset\.thumbGenerate\)/);
});

test("visible app version and html cache busters use current release", () => {
  const htmlFiles = ["index.html", "package-engine.html", "package-runs-dashboard.html"];
  const expectedCacheBuster = new RegExp(`v=${model.APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

  assert.equal(model.APP_VERSION, "1.7.4");
  htmlFiles.forEach((filename) => {
    const html = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    assert.match(html, expectedCacheBuster);
    assert.doesNotMatch(html, /v=1\.2\.0|v=1\.0\.0|v1\.2\.0|Review UI v1|Dashboard v1/);
  });
});

test("browser entry pages link between episode factory package engine and run dashboard", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const packageEngineHtml = fs.readFileSync(path.join(__dirname, "..", "package-engine.html"), "utf8");
  const dashboardHtml = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.html"), "utf8");

  assert.match(indexHtml, /href="package-engine\.html"/);
  assert.match(indexHtml, /href="package-runs-dashboard\.html"/);
  assert.match(packageEngineHtml, /href="index\.html"/);
  assert.match(packageEngineHtml, /href="package-runs-dashboard\.html"/);
  assert.match(dashboardHtml, /href="index\.html"/);
  assert.match(dashboardHtml, /href="package-engine\.html"/);
});

test("episode factory CLI creates file-backed episodes and reports next task", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const exportFile = path.join(tempDir, "export.json");
  const importFile = path.join(tempDir, "imported.json");

  const created = episodeFactoryCli.main([
    "create",
    "--data",
    dataFile,
    "--title",
    "CLI Episode",
    "--topic",
    "Local workflow",
    "--format",
    "mixed",
    "--audience",
    "Solo creator",
    "--premise",
    "A practical local workflow",
  ]);
  const listed = episodeFactoryCli.main(["list", "--data", dataFile]);
  const next = episodeFactoryCli.main(["next", "--data", dataFile]);
  const review = episodeFactoryCli.main(["check-packaging", "--data", dataFile]);
  const outline = episodeFactoryCli.main([
    "outline",
    "--data",
    dataFile,
    "--episodes-dir",
    path.join(tempDir, "episodes"),
  ]);
  const exported = episodeFactoryCli.main(["export", "--data", dataFile, "--out", exportFile]);
  const exportedPayload = JSON.parse(fs.readFileSync(exportFile, "utf8"));
  const imported = episodeFactoryCli.main(["import", exportFile, "--data", importFile]);
  const importedState = episodeFactoryCli.readState(importFile);
  const state = episodeFactoryCli.readState(dataFile);

  assert.match(created, /Created episode-/);
  assert.match(listed, /CLI Episode/);
  assert.match(listed, /mixed/);
  assert.match(next, /# Repair the episode package|# Complete the script package/);
  assert.match(review, /# Packaging Review: CLI Episode/);
  assert.match(outline, /Wrote .*outline\.md/);
  assert.match(state.episodes[0].scriptPath, /outline\.md/);
  assert.match(exported, /Exported 1 episodes/);
  assert.equal(exportedPayload.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.match(imported, /added 1 new episodes/);
  assert.equal(importedState.episodes.length, 1);
  assert.equal(importedState.episodes[0].format, "mixed");
  assert.match(importedState.episodes[0].scriptPath, /outline\.md/);
});

test("episode factory CLI import merge-new skips existing matches without overwriting", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-import-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const importFile = path.join(tempDir, "import.json");
  const original = model.normalizeEpisode({
    id: "same-cli",
    workingTitle: "Same CLI",
    description: "Keep original.",
  });
  const changed = model.normalizeEpisode({
    ...original,
    description: "Imported change.",
  });

  episodeFactoryCli.writeState(dataFile, { selectedId: original.id, episodes: [original] });
  fs.writeFileSync(importFile, model.exportEpisodeCollectionJson({ selectedId: changed.id, episodes: [changed] }));

  const output = episodeFactoryCli.main(["import", importFile, "--data", dataFile]);
  const state = episodeFactoryCli.readState(dataFile);

  assert.match(output, /added 0 new episodes/);
  assert.match(output, /Skipped 1/);
  assert.equal(state.episodes.length, 1);
  assert.equal(state.episodes[0].description, "Keep original.");
});

test("episode factory CLI init creates valid empty storage", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-init-"));
  const dataFile = path.join(tempDir, "data", "episodes.json");

  const output = episodeFactoryCli.main(["init", "--data", dataFile]);
  const payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const importResult = model.importEpisodeCollectionJson(fs.readFileSync(dataFile, "utf8"));

  assert.match(output, /Initialized Episode Factory CLI storage/);
  assert.equal(payload.app, "VIDTOOLZ Episode Factory");
  assert.equal(payload.appVersion, model.APP_VERSION);
  assert.equal(payload.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(payload.storageKey, model.STORAGE_KEY);
  assert.equal(payload.version, 1);
  assert.equal(payload.selectedId, "");
  assert.deepEqual(payload.episodes, []);
  assert.equal(payload.counts.episodes, 0);
  assert.ok(payload.exportedAt);
  assert.equal(importResult.ok, true);
  assert.equal(importResult.state.episodes.length, 0);
});

test("episode factory CLI init refuses to overwrite existing storage by default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-init-existing-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const episode = model.normalizeEpisode({ id: "keep-me", workingTitle: "Keep Me" });
  episodeFactoryCli.writeState(dataFile, { selectedId: episode.id, episodes: [episode] });
  const before = fs.readFileSync(dataFile, "utf8");

  assert.throws(
    () => episodeFactoryCli.main(["init", "--data", dataFile]),
    /Episode storage already exists/
  );
  assert.equal(fs.readFileSync(dataFile, "utf8"), before);
});

test("episode factory CLI init force overwrites only the intended storage file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-init-force-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const otherFile = path.join(tempDir, "other.json");
  const episode = model.normalizeEpisode({ id: "replace-me", workingTitle: "Replace Me" });
  episodeFactoryCli.writeState(dataFile, { selectedId: episode.id, episodes: [episode] });
  fs.writeFileSync(otherFile, "{\"keep\":true}\n");

  const output = episodeFactoryCli.main(["init", "--data", dataFile, "--force"]);
  const payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));

  assert.match(output, /Reinitialized Episode Factory CLI storage/);
  assert.equal(payload.episodes.length, 0);
  assert.equal(fs.readFileSync(otherFile, "utf8"), "{\"keep\":true}\n");
});

test("episode factory CLI doctor guides first run when default storage is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-first-run-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  const output = episodeFactoryCli.main(["doctor", "--data", dataFile]);
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;

  assert.match(output, /No episode library found yet/);
  assert.match(output, /node scripts\/episode-factory\.js init/);
  assert.doesNotMatch(output, /file-read-failed|Could not read/);
  assert.equal(exitCode, 0);
});

test("episode factory CLI doctor json guides first run when default storage is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-first-run-json-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const output = episodeFactoryCli.main(["doctor", "--data", dataFile, "--json"]);
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.equal(report.initialized, false);
  assert.equal(report.storagePath, dataFile);
  assert.equal(report.summary.episodes, 0);
  assert.equal(report.summary.message, "No episode library found yet.");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.match(report.suggestedFixes.join("\n"), /node scripts\/episode-factory\.js init/);
});

test("episode factory CLI doctor file missing path stays a real error", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-file-missing-"));
  const filePath = path.join(tempDir, "missing.json");
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  const output = episodeFactoryCli.main(["doctor", "--file", filePath, "--json"]);
  const report = JSON.parse(output);
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;

  assert.equal(report.ok, false);
  assert.equal(report.initialized, false);
  assert.equal(report.errors[0].code, "file-read-failed");
  assert.equal(exitCode, 1);
});

test("episode factory CLI doctor passes after init", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-after-init-"));
  const dataFile = path.join(tempDir, "episodes.json");
  episodeFactoryCli.main(["init", "--data", dataFile]);

  const output = episodeFactoryCli.main(["doctor", "--data", dataFile, "--json"]);
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.equal(report.initialized, true);
  assert.equal(report.summary.episodes, 0);
  assert.deepEqual(report.errors, []);
});

test("episode factory CLI init followed by create list and block plan works", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-init-flow-"));
  const dataFile = path.join(tempDir, "episodes.json");

  episodeFactoryCli.main(["init", "--data", dataFile]);
  const created = episodeFactoryCli.main(["create", "--data", dataFile, "--title", "Initialized Flow"]);
  const listed = episodeFactoryCli.main(["list", "--data", dataFile]);
  const planned = episodeFactoryCli.main(["block", "plan", "--data", dataFile, "--episode", "Initialized Flow"]);
  const next = episodeFactoryCli.main(["block", "next", "--data", dataFile]);
  const state = episodeFactoryCli.readState(dataFile);

  assert.match(created, /Created episode-/);
  assert.match(listed, /Initialized Flow/);
  assert.match(planned, /Planned 7 starter blocks/);
  assert.match(next, /block done/);
  assert.equal(state.episodes.length, 1);
  assert.equal(state.episodes[0].workBlocks.length, 7);
});

test("episode factory CLI manages work block lifecycle", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-block-"));
  const dataFile = path.join(tempDir, "episodes.json");
  episodeFactoryCli.main([
    "create",
    "--data",
    dataFile,
    "--title",
    "Block CLI Episode",
    "--topic",
    "Workflow",
  ]);
  const planned = episodeFactoryCli.main(["block", "plan", "--data", dataFile, "--episode", "Block CLI Episode"]);
  const listed = episodeFactoryCli.main(["block", "list", "--data", dataFile]);
  const next = episodeFactoryCli.main(["block", "next", "--data", dataFile]);
  const state = episodeFactoryCli.readState(dataFile);
  const blockId = state.episodes[0].workBlocks[0].id;
  const started = episodeFactoryCli.main(["block", "start", blockId, "--data", dataFile]);
  const done = episodeFactoryCli.main([
    "block",
    "done",
    blockId,
    "--data",
    dataFile,
    "--notes",
    "Finished title shortlist",
  ]);
  const afterDone = episodeFactoryCli.readState(dataFile);
  const secondBlock = afterDone.episodes[0].workBlocks[1].id;
  const skipped = episodeFactoryCli.main([
    "block",
    "skip",
    secondBlock,
    "--data",
    dataFile,
    "--notes",
    "Blocked until footage exists",
  ]);
  const finalState = episodeFactoryCli.readState(dataFile);

  assert.match(planned, /Planned 7 starter blocks/);
  assert.match(listed, /Clarify premise and audience/);
  assert.match(next, /# Write hook and promise|# Review packaging|# Define next publish action/);
  assert.match(next, /block done/);
  assert.match(started, /Started block-/);
  assert.match(done, /Completed block-/);
  assert.match(skipped, /Skipped block-/);
  assert.equal(finalState.episodes[0].workBlocks[0].status, "done");
  assert.equal(finalState.episodes[0].workBlocks[0].notes, "Finished title shortlist");
  assert.equal(finalState.episodes[0].workBlocks[1].status, "skipped");
});

test("episode factory CLI block add fails on invalid episode references", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-block-invalid-"));
  const dataFile = path.join(tempDir, "episodes.json");
  episodeFactoryCli.main(["create", "--data", dataFile, "--title", "Known Episode"]);

  assert.throws(
    () =>
      episodeFactoryCli.main([
        "block",
        "add",
        "--data",
        dataFile,
        "--episode",
        "Missing Episode",
        "--objective",
        "Do work",
      ]),
    /episode not found: Missing Episode/
  );
});

test("episode factory CLI doctor json output is parseable and read only", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const episode = model.addWorkBlock(
    model.normalizeEpisode({
      id: "doctor-cli",
      workingTitle: "Doctor CLI",
      status: "Idea",
      format: "long",
    }),
    { category: "publish", objective: "Check doctor" }
  );
  episodeFactoryCli.writeState(dataFile, { selectedId: episode.id, episodes: [episode] });
  const before = fs.readFileSync(dataFile, "utf8");
  const output = episodeFactoryCli.main(["doctor", "--data", dataFile, "--json"]);
  const after = fs.readFileSync(dataFile, "utf8");
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.equal(report.storagePath, dataFile);
  assert.equal(report.summary.episodes, 1);
  assert.equal(report.summary.workBlocks, 1);
  assert.equal(before, after);
});

test("episode factory CLI doctor file reports invalid JSON without importing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-bad-"));
  const filePath = path.join(tempDir, "bad.json");
  fs.writeFileSync(filePath, "{nope");

  const originalExitCode = process.exitCode;
  process.exitCode = 0;
  const output = episodeFactoryCli.main(["doctor", "--file", filePath, "--json"]);
  const report = JSON.parse(output);
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;

  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, "invalid-json");
  assert.equal(exitCode, 1);
});

test("trailer cue folder names are deterministic and slugged", () => {
  assert.equal(
    trailerCueGenerator.buildCueFolderName("AI Video Workflow Trailer", "2026-05-06"),
    "2026-05-06-ai-video-workflow-trailer"
  );
});

test("trailer cue section and tempo maps cover a two minute trailer", () => {
  const sections = trailerCueGenerator.buildSectionMap();
  const tempoMap = trailerCueGenerator.buildTempoMap();

  assert.equal(sections[0].start, 0);
  assert.equal(sections[sections.length - 1].end, 120);
  assert.equal(sections.length, 8);
  assert.deepEqual(
    tempoMap.map((item) => item.bpm),
    [72, 84, 96, 108, 120, 132, 112, 72]
  );
});

test("trailer cue artifacts include planning files and six midi stems", () => {
  const artifacts = trailerCueGenerator.buildCueArtifacts("Local trailer cue");
  const filenames = Object.keys(artifacts).sort();

  assert.deepEqual(filenames, [
    "climax-hits.mid",
    "drone.mid",
    "final-sting.mid",
    "motif.mid",
    "patch-recommendations.md",
    "pulse.mid",
    "render-checklist.md",
    "resolve-markers.csv",
    "riser.mid",
    "section-map.md",
    "tempo-map.md",
    "test-notes.md",
  ]);
  assert.match(artifacts["section-map.md"], /Length: 02:00/);
  assert.match(artifacts["patch-recommendations.md"], /does not load plugins/);
  assert.match(artifacts["test-notes.md"], /Musical Usability/);
  assert.match(artifacts["test-notes.md"], /Patch Choices/);
  assert.match(artifacts["test-notes.md"], /Section Timing/);
  assert.match(artifacts["test-notes.md"], /Resolve Marker Usefulness/);
  assert.match(artifacts["test-notes.md"], /Final Sting Strength/);
});

test("trailer cue dark fairytale preset changes structure maps and text artifacts", () => {
  const artifacts = trailerCueGenerator.buildCueArtifacts("Red Riding Hood Trailer", {
    preset: "dark-fairytale-trailer",
  });
  const sections = trailerCueGenerator.buildSectionMap({ preset: "dark-fairytale-trailer" });
  const tempoMap = trailerCueGenerator.buildTempoMap({ preset: "dark-fairytale-trailer" });
  const markers = artifacts["resolve-markers.csv"];

  assert.equal(sections[0].name, "Forest whisper");
  assert.equal(sections[5].name, "Teeth in the dark");
  assert.equal(sections[7].name, "Blood moon sting");
  assert.match(sections[1].purpose, /stay on the path/);
  assert.match(sections[4].musicalDirection, /nursery motif/);
  assert.deepEqual(
    tempoMap.map((item) => item.bpm),
    [68, 78, 92, 104, 116, 138, 96, 68]
  );
  assert.match(tempoMap[4].feel, /Grandmother's house/);
  assert.match(markers, /Forest whisper/);
  assert.match(markers, /Blood moon sting.*Red/);
  assert.match(artifacts["patch-recommendations.md"], /wolf breath/);
  assert.match(artifacts["render-checklist.md"], /Red Riding Hood trailer edit/);
  assert.match(artifacts["test-notes.md"], /Does the cue clearly suggest Red Riding Hood/);
});

test("trailer cue dark fairytale preset changes midi ranges and rhythm density", () => {
  const defaultMotif = trailerCueGenerator.buildNotesForPart("motif");
  const presetMotif = trailerCueGenerator.buildNotesForPart("motif", {
    preset: "dark-fairytale-trailer",
  });
  const defaultPulse = trailerCueGenerator.buildNotesForPart("pulse");
  const presetPulse = trailerCueGenerator.buildNotesForPart("pulse", {
    preset: "dark-fairytale-trailer",
  });
  const defaultLowestMotif = Math.min(...defaultMotif.map((note) => note[2]));
  const presetLowestMotif = Math.min(...presetMotif.map((note) => note[2]));

  assert.ok(presetLowestMotif < defaultLowestMotif);
  assert.ok(presetPulse.length > defaultPulse.length);
  assert.notEqual(
    trailerCueGenerator.buildMidiFile("pulse").length,
    trailerCueGenerator.buildMidiFile("pulse", { preset: "dark-fairytale-trailer" }).length
  );
});

test("trailer cue test notes template supports manual validation fields", () => {
  const notes = trailerCueGenerator.buildTestNotesMarkdown("Validation cue");

  assert.match(notes, /DAW:/);
  assert.match(notes, /Omnisphere \/ UVI \/ Arturia \/ other/);
  assert.match(notes, /Rendered Stem Check/);
  assert.match(notes, /Fairlight Assembly Check/);
  assert.match(notes, /Do not connect this generator to a DAW/);
});

test("trailer cue validation docs describe the manual real-world pass without automation", () => {
  const docPath = path.join(__dirname, "..", "docs", "trailer-cue-validation-workflow.md");
  const doc = fs.readFileSync(docPath, "utf8");

  assert.match(doc, /Import `resolve-markers.csv` into Resolve/);
  assert.match(doc, /Import these MIDI files into a DAW as separate tracks/);
  assert.match(doc, /Assign local patches manually/);
  assert.match(doc, /Omnisphere, UVI, Arturia/);
  assert.match(doc, /Render separate audio stems manually/);
  assert.match(doc, /Resolve\/Fairlight/);
  assert.match(doc, /fill `test-notes.md`/i);
  assert.match(doc, /does not call AI APIs/);
  assert.match(doc, /automate DAWs/);
});

test("trailer cue resolve markers use one hour timecode and section rows", () => {
  const csv = trailerCueGenerator.buildResolveMarkerCsv();
  const lines = csv.trim().split("\n");

  assert.equal(lines[0], "Marker Name,Description,Start Timecode,Duration,Color");
  assert.match(lines[1], /^Cold open,Immediate stakes and sonic identity\.,01:00:00:00,00:12,Blue$/);
  assert.match(csv, /Final sting,"End card, logo, or hard stop\.",01:01:56:00,00:04,Red/);
});

test("trailer cue midi files are standard midi buffers with notes", () => {
  const motif = trailerCueGenerator.buildMidiFile("motif");
  const pulse = trailerCueGenerator.buildMidiFile("pulse");

  assert.equal(motif.subarray(0, 4).toString("ascii"), "MThd");
  assert.equal(motif.subarray(14, 18).toString("ascii"), "MTrk");
  assert.ok(motif.length > 80);
  assert.ok(pulse.length > motif.length);
});

test("trailer cue cli help documents supported options and current limits", () => {
  const output = captureConsole(() => trailerCueScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.equal(output.stderr.length, 0);
  assert.match(output.stdout.join("\n"), /Usage: node scripts\/trailer-cue-new\.js "Trailer cue title"/);
  assert.match(output.stdout.join("\n"), /--out <dir>/);
  assert.match(output.stdout.join("\n"), /--date <date>/);
  assert.match(output.stdout.join("\n"), /--preset <preset>/);
  assert.match(output.stdout.join("\n"), /dark-fairytale-trailer/);
  assert.match(output.stdout.join("\n"), /does not call AI APIs/);
});

test("trailer cue cli rejects unsupported presets clearly", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trailer-cue-unknown-"));
  const output = captureConsole(() =>
    trailerCueScript.main([
      "Dark Fairytale Trailer",
      "--out",
      tempDir,
      "--date",
      "2026-05-06",
      "--preset",
      "space-opera-trailer",
    ])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /Unsupported preset: space-opera-trailer/);
  assert.match(output.stderr.join("\n"), /Supported presets: dark-fairytale-trailer/);
  assert.equal(fs.existsSync(path.join(tempDir, "2026-05-06-dark-fairytale-trailer")), false);
});

test("trailer cue cli still rejects unknown options clearly", () => {
  const output = captureConsole(() => trailerCueScript.main(["Cue", "--bogus"]));

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /Unknown option: --bogus/);
  assert.match(output.stderr.join("\n"), /--help/);
});

test("trailer cue cli creates dark fairytale preset cue folders", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trailer-cue-preset-"));
  const output = captureConsole(() =>
    trailerCueScript.main([
      "Red Riding Hood Trailer",
      "--out",
      tempDir,
      "--date",
      "2026-05-06",
      "--preset",
      "dark-fairytale-trailer",
    ])
  );
  const cueDir = path.join(tempDir, "2026-05-06-red-riding-hood-trailer");

  assert.equal(output.result, 0);
  assert.match(fs.readFileSync(path.join(cueDir, "section-map.md"), "utf8"), /Forest whisper/);
  assert.match(fs.readFileSync(path.join(cueDir, "tempo-map.md"), "utf8"), /dark-fairytale-trailer/);
  assert.match(fs.readFileSync(path.join(cueDir, "resolve-markers.csv"), "utf8"), /Blood moon sting/);
});

test("trailer cue script writes cue folders without overwriting changed files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trailer-cue-"));
  const output = captureConsole(() =>
    trailerCueScript.main([
      "Local Trailer Cue",
      "--out",
      tempDir,
      "--date",
      "2026-05-06",
    ])
  );
  const cueDir = path.join(tempDir, "2026-05-06-local-trailer-cue");
  const sectionPath = path.join(cueDir, "section-map.md");

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /Created trailer cue files in:/);
  assert.equal(fs.existsSync(path.join(cueDir, "motif.mid")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "test-notes.md")), true);
  fs.writeFileSync(sectionPath, "human edit", "utf8");
  assert.equal(
    trailerCueScript.main(["Local Trailer Cue", "--out", tempDir, "--date", "2026-05-06"]),
    2
  );
  assert.equal(fs.readFileSync(sectionPath, "utf8"), "human edit");
});

test("proposal loop runner help documents safe modes and required options", () => {
  const output = captureConsole(() => proposalLoopRunner.main(["--help"]));
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 0);
  assert.equal(output.stderr.length, 0);
  assert.match(stdout, /Proposal Loop Runner/);
  assert.match(stdout, /default mode creates the disposable clone, writes the task, runs preflight, and does not run Codex/i);
  assert.match(stdout, /--run-codex/);
  assert.match(stdout, /--repo <real-repo>/);
  assert.match(stdout, /--name <slug>/);
  assert.match(stdout, /--allowed <paths>/);
  assert.match(stdout, /--task <text>/);
  assert.match(stdout, /--task-file <path>/);
  assert.match(stdout, /--force/);
});

test("proposal loop runner rejects missing repo", () => {
  const output = captureConsole(() => proposalLoopRunner.main(["--allowed", "tests/run-tests.js", "--task", "do work"]));

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /--repo is required/);
});

test("proposal loop runner rejects missing allowed scope", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-missing-allowed-");
  const output = captureConsole(() => proposalLoopRunner.main(["--repo", fixture.worktree, "--task", "do work"]));

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /--allowed is required/);
});

test("proposal loop runner rejects missing task input", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-missing-task-");
  const output = captureConsole(() =>
    proposalLoopRunner.main(["--repo", fixture.worktree, "--allowed", "tests/run-tests.js"])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /Provide exactly one of --task or --task-file/);
});

test("proposal loop runner rejects empty task content", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-empty-task-");
  const taskFile = path.join(fixture.tempRoot, "empty-task.md");
  fs.writeFileSync(taskFile, "  \n\t\n", "utf8");
  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task-file",
      taskFile,
    ])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /Task content must not be empty/);
});

test("proposal loop runner rejects unsafe name path traversal", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-unsafe-name-");
  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      "../escape",
    ])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /--name must use only/);
});

test("proposal loop runner default mode creates tmp clone and task file", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-default-create-");
  const name = `runner-default-create-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const taskPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}-task.md`);
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(taskPath, { force: true });

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "Add runner tests",
      "--name",
      name,
    ])
  );

  assert.equal(output.result, 0);
  assert.equal(fs.existsSync(path.join(clonePath, ".git")), true);
  assert.equal(fs.readFileSync(taskPath, "utf8"), "Add runner tests\n");
  assert.match(output.stdout.join("\n"), new RegExp(escapeRegExp(clonePath)));
});

test("proposal loop runner default dry-run writes manifest under /tmp", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-manifest-default-");
  const name = `runner-manifest-default-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const manifestPath = path.join(os.tmpdir(), "vidtoolz-proposal-loop-history", `${name}.json`);
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(manifestPath, { force: true });

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
    ])
  );
  const manifest = readJsonFile(manifestPath);

  assert.equal(output.result, 0);
  assert.equal(fs.existsSync(manifestPath), true);
  assert.equal(proposalLoopGuard.isUnderTmp(manifestPath), true);
  assert.match(output.stdout.join("\n"), new RegExp(escapeRegExp(manifestPath)));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.name, name);
  assert.equal(manifest.repo, path.resolve(fixture.worktree));
  assert.equal(manifest.clonePath, clonePath);
  assert.equal(manifest.taskPath, path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}-task.md`));
  assert.equal(manifest.patchPath, path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.patch`));
  assert.deepEqual(manifest.allowed, ["tests/run-tests.js"]);
  assert.equal(manifest.runCodex, false);
  assert.match(manifest.safetyNote, /did not apply, commit, push, stage, reset, clean, or edit the real repo/);
  assert.doesNotMatch(manifestPath, new RegExp(`^${escapeRegExp(fixture.worktree)}`));
});

test("proposal loop runner dry-run manifest records command-boundary accepted", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-manifest-preflight-");
  const name = `runner-manifest-preflight-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const manifestPath = path.join(os.tmpdir(), "vidtoolz-proposal-loop-history", `${name}.json`);
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(manifestPath, { force: true });

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
    ])
  );
  const manifest = readJsonFile(manifestPath);

  assert.equal(output.result, 0);
  assert.equal(manifest.preflightDecision, "accepted");
  assert.deepEqual(manifest.preflightFailures, []);
  assert.equal(manifest.runnerStatus, "dry-run-complete");
  assert.equal(manifest.finalStatus, "dry-run-complete");
});

test("proposal loop runner default mode prints codex command but does not run Codex", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-no-codex-");
  const name = `runner-no-codex-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  fs.rmSync(clonePath, { recursive: true, force: true });

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
    ])
  );
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 0);
  assert.match(stdout, /codex exec --sandbox danger-full-access --ephemeral -C/);
  assert.match(stdout, /Codex was not run/);
  assert.equal(fs.existsSync(path.join(clonePath, "codex-ran.txt")), false);
});

test("proposal loop runner default mode runs command-boundary preflight", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-preflight-");
  const name = `runner-preflight-${process.pid}`;
  fs.rmSync(path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`), { recursive: true, force: true });

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
    ])
  );

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /Command-boundary decision: accepted/);
});

test("proposal loop runner default mode prints postflight guard command", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-postflight-print-");
  const name = `runner-postflight-print-${process.pid}`;
  fs.rmSync(path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`), { recursive: true, force: true });

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
    ])
  );

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /node scripts\/proposal-loop-guard\.js \\\n  --repo/);
  assert.match(output.stdout.join("\n"), /--worktree/);
  assert.match(output.stdout.join("\n"), /--patch \/tmp\/vidtoolz-proposal-loop-runner-postflight-print-/);
});

test("proposal loop runner default mode prints real-repo apply checklist", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-checklist-");
  const name = `runner-checklist-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const patchPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.patch`);
  const manifestPath = path.join(os.tmpdir(), "vidtoolz-proposal-loop-history", `${name}.json`);
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(manifestPath, { force: true });

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "scripts/proposal-loop-runner.js,tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
    ])
  );
  const stdout = output.stdout.join("\n");

  assert.equal(output.result, 0);
  assert.match(stdout, new RegExp(`cd ${escapeRegExp(fixture.worktree)}`));
  assert.match(stdout, new RegExp(`^# Patch file: ${escapeRegExp(patchPath)}$`, "m"));
  assert.match(stdout, new RegExp(`^# Manifest file: ${escapeRegExp(manifestPath)}$`, "m"));
  assert.match(stdout, new RegExp(`^PATCH=${escapeRegExp(patchPath)}$`, "m"));
  assert.match(stdout, new RegExp(`^MANIFEST=${escapeRegExp(manifestPath)}$`, "m"));
  assert.match(stdout, new RegExp(escapeRegExp(patchPath)));
  assert.match(stdout, new RegExp(escapeRegExp(manifestPath)));
  assert.match(stdout, /git status --short --branch/);
  assert.match(stdout, /git apply --check "\$PATCH"/);
  assert.match(stdout, /git apply "\$PATCH"/);
  assert.doesNotMatch(stdout, /RUN_ID/);
  assert.doesNotMatch(stdout, /PATCH=.*RUN_ID/);
  assert.doesNotMatch(stdout, /MANIFEST=.*RUN_ID/);
  assert.match(stdout, /git diff --stat -- scripts\/proposal-loop-runner\.js tests\/run-tests\.js/);
  assert.match(stdout, /node --check scripts\/proposal-loop-runner\.js/);
  assert.match(stdout, /git add scripts\/proposal-loop-runner\.js tests\/run-tests\.js/);
});

test("proposal loop runner run-codex runs postflight guard and exports accepted patch", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-run-accepted-");
  const name = `runner-run-accepted-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const patchPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.patch`);
  const fakeCodex = path.join(fixture.tempRoot, "fake-codex.js");
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(patchPath, { force: true });
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node\nconst fs=require('fs');const path=require('path');const stdin=fs.readFileSync(0,'utf8');if(!stdin.trim()){console.error('fake Codex expected task content on stdin');process.exit(2);}if(!stdin.includes('do work')){console.error('fake Codex received unexpected stdin');process.exit(3);}const cwd=process.argv[process.argv.indexOf('-C')+1];fs.writeFileSync(path.join(cwd,'tests/run-tests.js'),'allowed runner change\\n','utf8');`,
    "utf8"
  );
  fs.chmodSync(fakeCodex, 0o755);

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
      "--codex-bin",
      fakeCodex,
      "--run-codex",
    ])
  );

  assert.equal(output.result, 0);
  assert.equal(fs.existsSync(patchPath), true);
  assert.match(fs.readFileSync(patchPath, "utf8"), /tests\/run-tests\.js/);
  assert.match(output.stdout.join("\n"), /Decision: accepted-for-review/);
});

test("proposal loop runner accepted run-codex manifest records postflight and patch path", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-manifest-accepted-");
  const name = `runner-manifest-accepted-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const patchPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.patch`);
  const historyDir = path.join(fixture.tempRoot, "history");
  const manifestPath = path.join(historyDir, `${name}.json`);
  const fakeCodex = path.join(fixture.tempRoot, "fake-codex.js");
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(patchPath, { force: true });
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node\nconst fs=require('fs');const path=require('path');const cwd=process.argv[process.argv.indexOf('-C')+1];fs.writeFileSync(path.join(cwd,'tests/run-tests.js'),'allowed manifest change\\n','utf8');`,
    "utf8"
  );
  fs.chmodSync(fakeCodex, 0o755);

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
      "--history-dir",
      historyDir,
      "--codex-bin",
      fakeCodex,
      "--run-codex",
    ])
  );
  const manifest = readJsonFile(manifestPath);

  assert.equal(output.result, 0);
  assert.equal(manifest.runCodex, true);
  assert.equal(manifest.codexBin, fakeCodex);
  assert.equal(manifest.codexStatus.status, 0);
  assert.equal(manifest.postflightDecision, "accepted-for-review");
  assert.equal(manifest.patchWritten, patchPath);
  assert.equal(manifest.runnerStatus, "accepted-for-review");
  assert.equal(manifest.finalStatus, "accepted-for-review");
});

test("proposal loop runner run-codex exports rejected patch for forbidden diff", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-run-rejected-");
  const name = `runner-run-rejected-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const patchPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.patch`);
  const rejectedPatchPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.rejected.patch`);
  const fakeCodex = path.join(fixture.tempRoot, "fake-codex.js");
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(patchPath, { force: true });
  fs.rmSync(rejectedPatchPath, { force: true });
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node\nconst fs=require('fs');const path=require('path');const cwd=process.argv[process.argv.indexOf('-C')+1];fs.mkdirSync(path.join(cwd,'package-runs/2026-05-02-topic'),{recursive:true});fs.writeFileSync(path.join(cwd,'package-runs/2026-05-02-topic/notes.md'),'forbidden runner change\\n','utf8');`,
    "utf8"
  );
  fs.chmodSync(fakeCodex, 0o755);

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
      "--codex-bin",
      fakeCodex,
      "--run-codex",
    ])
  );

  assert.equal(output.result, 1);
  assert.equal(fs.existsSync(patchPath), false);
  assert.equal(fs.existsSync(rejectedPatchPath), true);
  assert.match(fs.readFileSync(rejectedPatchPath, "utf8"), /package-runs\/2026-05-02-topic\/notes\.md/);
  assert.match(output.stdout.join("\n"), /Decision: rejected/);
});

test("proposal loop runner rejected run-codex manifest records decision and reason", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-manifest-rejected-");
  const name = `runner-manifest-rejected-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const patchPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.patch`);
  const rejectedPatchPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.rejected.patch`);
  const historyDir = path.join(fixture.tempRoot, "history");
  const manifestPath = path.join(historyDir, `${name}.json`);
  const fakeCodex = path.join(fixture.tempRoot, "fake-codex.js");
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(patchPath, { force: true });
  fs.rmSync(rejectedPatchPath, { force: true });
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node\nconst fs=require('fs');const path=require('path');const cwd=process.argv[process.argv.indexOf('-C')+1];fs.mkdirSync(path.join(cwd,'package-runs/2026-05-02-topic'),{recursive:true});fs.writeFileSync(path.join(cwd,'package-runs/2026-05-02-topic/notes.md'),'forbidden manifest change\\n','utf8');`,
    "utf8"
  );
  fs.chmodSync(fakeCodex, 0o755);

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
      "--history-dir",
      historyDir,
      "--codex-bin",
      fakeCodex,
      "--run-codex",
    ])
  );
  const manifest = readJsonFile(manifestPath);

  assert.equal(output.result, 1);
  assert.equal(manifest.postflightDecision, "rejected");
  assert.equal(manifest.rejectedPatchWritten, rejectedPatchPath);
  assert.match(manifest.postflightFailures.join("\n"), /outside allowed scope/);
  assert.match(manifest.error, /outside allowed scope/);
  assert.equal(manifest.finalStatus, "rejected");
});

test("proposal loop runner Codex failure manifest records nonzero status", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-manifest-codex-fail-");
  const name = `runner-manifest-codex-fail-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const historyDir = path.join(fixture.tempRoot, "history");
  const manifestPath = path.join(historyDir, `${name}.json`);
  const fakeCodex = path.join(fixture.tempRoot, "fake-codex.js");
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node\nconsole.error('planned Codex failure');process.exit(7);`,
    "utf8"
  );
  fs.chmodSync(fakeCodex, 0o755);

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
      "--history-dir",
      historyDir,
      "--codex-bin",
      fakeCodex,
      "--run-codex",
    ])
  );
  const manifest = readJsonFile(manifestPath);

  assert.equal(output.result, 7);
  assert.equal(manifest.codexStatus.status, 7);
  assert.equal(manifest.runnerStatus, "codex-failed");
  assert.equal(manifest.finalStatus, "failed");
  assert.match(manifest.error, /Codex exited with status 7/);
  assert.equal(Object.hasOwn(manifest, "postflightDecision"), false);
});

test("proposal loop runner rejects non-tmp history dir", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-history-outside-tmp-");
  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      `runner-history-outside-tmp-${process.pid}`,
      "--history-dir",
      "/var/tmp/vidtoolz-proposal-loop-history",
    ])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /--history-dir must be under \/tmp|History directory must be under \/tmp/);
});

test("proposal loop runner manifest writing does not affect real repo status", () => {
  const fixture = createProposalGuardRepo("proposal-loop-runner-real-status-");
  const name = `runner-real-status-${process.pid}`;
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const manifestPath = path.join(os.tmpdir(), "vidtoolz-proposal-loop-history", `${name}.json`);
  fs.rmSync(clonePath, { recursive: true, force: true });
  fs.rmSync(manifestPath, { force: true });
  const beforeStatus = runGitCommand(fixture.worktree, ["status", "--short"]);

  const output = captureConsole(() =>
    proposalLoopRunner.main([
      "--repo",
      fixture.worktree,
      "--allowed",
      "tests/run-tests.js",
      "--task",
      "do work",
      "--name",
      name,
    ])
  );
  const afterStatus = runGitCommand(fixture.worktree, ["status", "--short"]);

  assert.equal(output.result, 0);
  assert.equal(fs.existsSync(manifestPath), true);
  assert.equal(afterStatus, beforeStatus);
});

async function runTests() {
  let passed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`ok - ${item.name}`);
    } catch (error) {
      console.error(`not ok - ${item.name}`);
      console.error(error);
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) {
    console.log(`${passed}/${tests.length} tests passed`);
  }
}

runTests();
