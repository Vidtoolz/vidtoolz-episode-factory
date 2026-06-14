/**
 * VIDTOOLZ Episode Factory Tests — Proposal Loop
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: proposal loop guard and runner scripts
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
