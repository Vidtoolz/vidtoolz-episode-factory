/**
 * VIDTOOLZ Episode Factory Tests — Package Run Scripts
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: scripts/package-engine-*.js and package-run-*.js
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
  packageNewsletterScript,
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

function writeManualVerticalStage4Run(runDir, options = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "package-run-state.md"),
    "# Package Run State\n\nPackage run state: active\n\nWorkflow path: vertical\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "selected-package.md"),
    "# Selected Package\n\n- Status: Manual Mikko-approved package selection for production prep.\n- Proposed title: Stop Writing Your Shorts Like Blog Posts\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "final-outline.md"),
    "# Final Outline\n\n- Source of truth: final-script.md\n- Target format: vertical short, 1080x1920\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    "# Final Script\n\nStop writing Shorts like blog posts. Write like a person speaking to scrolling viewers.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-prep-review-2.md"),
    "# Production Prep Review 2\n\n## Verdict\n\nAPPROVE FOR PRODUCTION PLAN\n\n## Required fixes before production-plan.md\n\nnone\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    [
      "# Production Plan",
      "",
      `- Shoot-readiness status: ${options.shootReadiness || "READY TO SHOOT"}`,
      "- Status: READY TO SHOOT",
      "- Media generation started: no",
      options.approval ? "- Shot/edit plan approval: PASS" : "",
      "",
      "## Production Scope",
      "",
      "Presenter-led vertical short with abstract visuals, kinetic typography, and blog-post versus Short contrast.",
      "",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "shot-list.md"),
    "# Shot List\n\n| shot | reason | priority | status |\n| --- | --- | --- | --- |\n| Presenter A-roll: full approved final script. | Carries the spoken vertical Short. | high | planned |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "screen-capture-list.md"),
    "# Screen Capture List\n\nNo required screen captures for this production plan. The approved final script does not require tool demos or browser recordings.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "demo-list.md"),
    "# Demo List\n\n| demo | what it proves | setup needed | status |\n| --- | --- | --- | --- |\n| Dense blog-style script vs punchy Shorts beats. | Shows the approved writing contrast. | Designed graphic. | planned |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "b-roll-list.md"),
    "# B-Roll List\n\n| b-roll item | reason | source | status |\n| --- | --- | --- | --- |\n| Blog post vs Short contrast card. | Clarifies the central production rule. | Designed graphic. | planned |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "graphics-list.md"),
    "# Graphics List\n\n| graphic | clarity purpose | source/input | status |\n| --- | --- | --- | --- |\n| BLOG POST vs SHORT labels. | Makes the contrast readable on mobile. | final outline | planned |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "audio-notes.md"),
    "# Audio Notes\n\nRecord clean A-roll or voiceover from final-script.md only. Keep delivery conversational and capture room tone.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Mikko approved the repaired production prep packet for production-plan creation. | Keep review evidence with the run. | closed |\n",
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

test("shot/edit plan review accepts manual vertical production-prep chain without legacy upstream artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-vertical-manual-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-06-28-stop-writing-your-shorts-like-blog-posts");
  writeManualVerticalStage4Run(runDir, { approval: false });

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);
  const review = stage4ReviewText(runDir);

  assert.match(review, /Review status: READY FOR HUMAN APPROVAL/);
  assert.match(review, /Stage accepted: no/);
  assert.match(review, /Manual vertical prep chain accepted: yes/);
  assert.match(review, /final-outline\.md/);
  assert.match(review, /production-prep-review-2\.md/);
  assert.match(review, /Manual vertical production-prep chain accepted/);
  assert.doesNotMatch(review, /script-review\.md is missing/);
  assert.doesNotMatch(review, /script-structure\.md is missing/);
  assert.doesNotMatch(review, /Research gate status is MISSING/);
});

test("shot/edit plan review blocks manual vertical chain when production plan is not ready", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-stage4-vertical-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-06-28-stop-writing-your-shorts-like-blog-posts");
  writeManualVerticalStage4Run(runDir, { shootReadiness: "NEEDS SCRIPT APPROVAL", approval: true });

  assert.equal(packageShotEditPlanReviewScript.main([runDir]), 0);
  const review = stage4ReviewText(runDir);

  assert.match(review, /Review status: BLOCKED/);
  assert.match(review, /Stage accepted: no/);
  assert.match(review, /Manual vertical prep chain accepted: no/);
  assert.match(review, /Shoot-readiness status is NEEDS SCRIPT APPROVAL, not READY TO SHOOT/);
  assert.doesNotMatch(review, /Review status: PASS/);
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

test("rough cut review reads watch context from list-item fields when section headings are absent", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-rough-cut-list-item-fields-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-list-item-fields");
  writeRoughCutBaseRun(runDir, {
    watchNotes: [
      "# Rough-Cut Watch Notes",
      "",
      "- Run: 2026-05-10-list-item-fields",
      "- Reviewed file: media/02-main-redo-full.mp4",
      "- Reviewed file type: screen redo capture / rough-cut candidate",
      "- Watch date: 2026-05-17",
      "- Reviewer: Mikko",
      "- External APIs called: no",
      "",
      "## First 30 Seconds Notes",
      "",
      "Opening is acceptable.",
      "",
      "## Clarity Notes",
      "",
      "The message is understandable.",
      "",
      "## Pacing Notes",
      "",
      "Pacing is acceptable.",
      "",
      "## Proof / Evidence Notes",
      "",
      "Proof/evidence is acceptable for this stage.",
      "",
      "## Missing Visuals",
      "",
      "Presenter is not seen, only heard.",
      "",
      "## Pickups Needed",
      "",
      "Maybe add closeups and AI-generated B-roll.",
      "",
      "## Edit Fixes Needed",
      "",
      "No edit fixes noted.",
      "",
      "## Second-Cut Recommendation",
      "",
      "Move to second-cut work by adding clips.",
      "",
      "## Manual Rough-Cut Approval Marker",
      "",
      "Rough-cut approval: NEEDS PICKUPS",
      "",
    ].join("\n"),
  });

  assert.equal(packageRoughCutReviewScript.main([runDir]), 0);
  const review = roughCutReviewText(runDir);

  assert.match(review, /Rough-cut version reviewed: media[/]02-main-redo-full[.]mp4/);
  assert.match(review, /Watch context: 2026-05-17; reviewer: Mikko/);
  assert.doesNotMatch(review, /Rough-cut version reviewed: Not assessed/);
  assert.doesNotMatch(review, /Watch context: Not assessed/);
  assert.match(review, /Rough-cut review status: NEEDS PICKUPS/);
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
  assert.match(first.stdout.join("\n"), /skipped: .*rough-cut-review\.md/);
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
  assert.match(first.stdout.join("\n"), /skipped: .*publication-blockers\.md/);

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

test("package runs index ignores non-run container folders", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-runs-index-containers-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Active Run" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/stale-runs/2026-05-09-parked/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Archived Nested Run" } })
  );

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });

  assert.equal(index.count, 1);
  assert.equal(index.activeCount, 1);
  assert.deepEqual(index.runs.map((run) => run.path), ["package-runs/2026-05-10-active"]);
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

test("fixture package-run state selects May 6 and parks older May 2 runs", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-state-may6-fixture-"));
  const activeRel = "package-runs/2026-05-06-ai-video-proof-plan";
  const parkedNextRel = "package-runs/2026-05-02-next-vidtoolz-video";
  const parkedIdeaFilterRel = "package-runs/2026-05-02-ai-video-idea-filter";

  writeTestFile(repoRoot, `${activeRel}/selected-package.json`, JSON.stringify({ package: { proposedTitle: "May 6 Active" } }));
  writeTestFile(repoRoot, `${activeRel}/final-script.md`, "# Final Script\n");
  writeTestFile(repoRoot, `${activeRel}/production-plan.md`, "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n");
  [parkedNextRel, parkedIdeaFilterRel].forEach((runRel) => {
    writeTestFile(
      repoRoot,
      `${runRel}/package-run-state.md`,
      "# Package Run State\n\nPackage run state: parked\n\nReason: Fixture parked run.\n"
    );
    writeTestFile(repoRoot, `${runRel}/selected-package.json`, JSON.stringify({ package: { proposedTitle: path.basename(runRel) } }));
    writeTestFile(repoRoot, `${runRel}/final-script.md`, "# Final Script\n");
  });

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot, runsDir: "package-runs" });
  writeTestFile(repoRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const activeRun = packageRunsIndexScript.scanRun(path.join(repoRoot, activeRel), repoRoot);
  const parkedNextRun = packageRunsIndexScript.scanRun(path.join(repoRoot, parkedNextRel), repoRoot);
  const parkedIdeaFilterRun = packageRunsIndexScript.scanRun(path.join(repoRoot, parkedIdeaFilterRel), repoRoot);
  const activeAudit = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot });
  const inactiveByPath = Object.fromEntries(activeAudit.inactiveRuns.map((run) => [run.path, run]));

  assert.equal(activeRun.path, activeRel);
  assert.equal(activeRun.packageRunState.explicit, false);
  assert.equal(activeRun.inactive, false);
  assert.equal(activeAudit.ok, true);
  assert.equal(activeAudit.selectedActiveRun, activeRel);
  assert.deepEqual(activeAudit.candidateActiveRuns.map((run) => run.path), [activeRel]);

  assert.equal(parkedNextRun.packageRunState.state, "parked");
  assert.equal(parkedNextRun.inactive, true);
  assert.equal(parkedNextRun.status, "Inactive: parked");
  assert.equal(parkedNextRun.workflowBucket, "Inactive: parked");
  assert.equal(inactiveByPath[parkedNextRel].state, "parked");
  assert.equal(inactiveByPath[parkedNextRel].inactive, true);

  assert.equal(parkedIdeaFilterRun.packageRunState.state, "parked");
  assert.equal(parkedIdeaFilterRun.inactive, true);
  assert.equal(parkedIdeaFilterRun.status, "Inactive: parked");
  assert.equal(parkedIdeaFilterRun.workflowBucket, "Inactive: parked");
  assert.equal(inactiveByPath[parkedIdeaFilterRel].state, "parked");
  assert.equal(inactiveByPath[parkedIdeaFilterRel].inactive, true);
});

test("active state audit degrades read-only when package-runs-index is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-missing-index-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Missing Index Active" } })
  );

  const report = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot: tempRoot });

  assert.equal(report.ok, false);
  assert.equal(report.readOnly, true);
  assert.equal(report.externalApisCalled, false);
  assert.equal(report.sourceIndex.ok, false);
  assert.match(report.sourceIndex.error, /package-runs-index\.json not found/);
});

test("active state audit selects exactly one active run", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-one-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Only Active" } })
  );
  // A confidently-active run carries an explicit active marker; without it the
  // audit reports UNKNOWN state and recommends adding a marker (see the
  // missing-state test below).
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/package-run-state.md",
    "# Package Run State\n\nPackage run state: active\n"
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-09-parked/package-run-state.md",
    "# Package Run State\n\nPackage run state: parked\n"
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const report = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot: tempRoot });

  assert.equal(report.ok, true);
  assert.equal(report.ambiguity, false);
  assert.equal(report.selectedActiveRun, "package-runs/2026-05-10-active");
  assert.equal(report.candidateActiveRuns.length, 1);
  assert.equal(report.candidateActiveRuns[0].safeRecommendedAction, "keep active");
  assert.equal(report.inactiveRuns.length, 1);
});

test("active state audit ignores non-run container folders", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-containers-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Only Active" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/stale-runs/2026-05-09-old/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Nested Old Run" } })
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const report = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot: tempRoot });

  assert.equal(report.ok, true);
  assert.equal(report.ambiguity, false);
  assert.equal(report.packageRunsDirectory.count, 1);
  assert.deepEqual(report.candidateActiveRuns.map((run) => run.path), ["package-runs/2026-05-10-active"]);
});

test("active state audit reports multiple active runs as ambiguous", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-many-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active-a/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Active A" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active-a/package-run-state.md",
    "# Package Run State\n\nPackage run state: active\n"
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-09-active-b/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Active B" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-09-active-b/package-run-state.md",
    "# Package Run State\n\nPackage run state: active\n"
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const report = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot: tempRoot });

  assert.equal(report.ok, false);
  assert.equal(report.ambiguity, true);
  assert.equal(report.selectedActiveRun, "");
  assert.equal(report.candidateActiveRuns.length, 2);
  assert.equal(
    report.exactNextSafeAction,
    "Review package-run state markers and choose exactly one active run before package-run-specific cockpit panels can make decisions."
  );
  assert.equal(report.candidateActiveRuns.every((run) => run.safeRecommendedAction === "review manually"), true);
});

test("active state audit reports no active runs", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-none-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-parked/package-run-state.md",
    "# Package Run State\n\nPackage run state: parked\n"
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-09-superseded/package-run-state.md",
    "# Package Run State\n\nPackage run state: superseded\n"
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const report = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot: tempRoot });

  assert.equal(report.ok, false);
  assert.equal(report.ambiguity, false);
  assert.equal(report.candidateActiveRuns.length, 0);
  assert.equal(report.selectedActiveRun, "");
  assert.equal(report.exactNextSafeAction, "Mark exactly one package run active or configure an explicit active run.");
});

test("active state audit flags a run with artifacts but no state marker as UNKNOWN, not silently active", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-unknown-"));
  // Real run dir (has a detected artifact) but NO package-run-state.md marker.
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-no-state/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "No State Marker" } })
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const report = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot: tempRoot });

  // Loud, not silent: surfaced as invalid/unknown state with a withhold-guidance signal.
  assert.equal(report.invalidState, true);
  assert.equal(report.guidanceWithheld, true);
  assert.equal(report.unknownStateRuns.length, 1);
  assert.equal(report.unknownStateRuns[0].path, "package-runs/2026-05-10-no-state");
  assert.equal(report.unknownStateRuns[0].safeRecommendedAction, "add explicit package-run-state.md marker");
  assert.equal(report.exactNextSafeAction, packageRunActiveStateAuditScript.MISSING_STATE_NEXT_ACTION);
  assert.ok(report.warnings.some((w) => /no explicit package-run-state\.md marker/i.test(w)));
});

test("active state audit: missing state combined with an explicit active run withholds guidance", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-mixed-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Explicit Active" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/package-run-state.md",
    "# Package Run State\n\nPackage run state: active\n"
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-09-no-state/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "No State" } })
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const report = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot: tempRoot });

  // Two active candidates -> ambiguity; the no-state one is also flagged UNKNOWN.
  assert.equal(report.guidanceWithheld, true);
  assert.equal(report.invalidState, true);
  assert.ok(report.unknownStateRuns.some((run) => run.path === "package-runs/2026-05-09-no-state"));
});

test("package-run-state guard detects a run dir with artifacts but no state marker", () => {
  // Fixture-based guard (no dependency on production package-runs state): a
  // directory that is a package run (has a detected artifact) must declare its
  // state, so the cockpit is never fed UNKNOWN state. Container dirs (no detected
  // files) are not flagged.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-state-guard-"));
  const runsDir = path.join(tempRoot, "package-runs");
  writeTestFile(tempRoot, "package-runs/2026-05-10-has-state/selected-package.json", "{}\n");
  writeTestFile(tempRoot, "package-runs/2026-05-10-has-state/package-run-state.md", "# Package Run State\n\nPackage run state: active\n");
  writeTestFile(tempRoot, "package-runs/2026-05-09-no-state/selected-package.json", "{}\n");
  fs.mkdirSync(path.join(runsDir, "stale-runs"), { recursive: true }); // container dir, no detected files

  const offenders = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name))
    .filter((dir) => packageRunsIndexScript.isPackageRunDir(dir))
    .filter((dir) => !fs.existsSync(path.join(dir, "package-run-state.md")))
    .map((dir) => path.basename(dir));

  assert.deepEqual(offenders, ["2026-05-09-no-state"]);
});

test("docs authority check passes and catches hardcoded counts / stale phrases", () => {
  const docsCheck = require("../scripts/docs-authority-check.js");

  // Repo currently passes: canonical files exist and authoritative docs are clean.
  const result = docsCheck.check();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.missingCanonical, []);

  // The scanner detects both a hardcoded count and the known-stale phrase.
  const offenses = docsCheck.scanText(
    ["Tests: 1203/1203 passing", "We had 844 tests here", "no counts on this line"].join("\n")
  );
  assert.ok(offenses.length >= 2);
  assert.ok(offenses.some((o) => o.kind === "hardcoded-test-count"));
  assert.ok(offenses.some((o) => o.kind === "stale-phrase"));

  // The cleaned-up phrasing we use in authoritative docs is NOT flagged.
  assert.equal(docsCheck.scanText("Tests: run `scripts/verify.sh` for the current count.").length, 0);
});

test("canonical production spec exists and stays in sync with pipeline-tracker.js", () => {
  const gen = require("../scripts/generate-production-spec.js");
  const tracker = require("../pipeline-tracker.js");

  // Issue C: the referenced canonical spec must actually exist on disk.
  assert.ok(fs.existsSync(gen.SPEC_MD_PATH), "VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md must exist");
  assert.ok(fs.existsSync(gen.STAGES_JSON_PATH), "config/production-stages.json must exist");

  // The runtime source of truth is the tracker, with 13 canonical stages.
  assert.equal(tracker.STAGES.length, 13);

  // Generated artifacts must match what the tracker would produce right now.
  const result = gen.checkArtifacts();
  assert.equal(result.ok, true, `production spec drifted: ${result.drifted.join(", ")}`);

  // The spec must name the runtime source and warn against manual edits.
  const specText = fs.readFileSync(gen.SPEC_MD_PATH, "utf8");
  assert.match(specText, /source-derived/i);
  assert.match(specText, /pipeline-tracker\.js/);
});

test("system registry loads, validates, and records verified ports with sources", () => {
  const systemRegistry = require("../scripts/system-registry.js");
  const registry = systemRegistry.loadRegistry();

  assert.equal(registry.generated_or_verified, "verified");
  assert.ok(Array.isArray(registry.components) && registry.components.length >= 3);
  // Every component must carry an evidence source — no memory-only facts.
  registry.components.forEach((component) => {
    assert.ok(component.id && component.name, "component needs id and name");
    assert.ok(component.source, `component ${component.id} must cite a source`);
  });
  const byId = Object.fromEntries(registry.components.map((c) => [c.id, c]));
  assert.equal(byId.cockpit.port, 8010);
  assert.equal(byId["presto-comfyui"].host, "192.168.50.187");
  assert.equal(byId["presto-comfyui"].port, 8188);
});

test("cockpit orientation reports a single clean active run with operator fields", () => {
  const packageEngineServer = require("../package-engine-server.js");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-orientation-one-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-06-28-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Active Orientation" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-06-28-active/package-run-state.md",
    "# Package Run State\n\nPackage run state: active\n"
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const o = packageEngineServer.buildCockpitOrientation({ repoRoot: tempRoot });

  assert.equal(o.mode, "Operator Clarity / Production");
  assert.equal(o.activeRun, "2026-06-28-active");
  assert.equal(o.activeRunPath, "package-runs/2026-06-28-active/");
  assert.ok(o.currentGate);
  assert.ok(o.aiSafeAction);
  assert.ok(Array.isArray(o.outOfScope) && o.outOfScope.length > 0);
  assert.ok(o.indexFreshness && typeof o.indexFreshness.state === "string");
});

test("cockpit orientation returns AMBIGUOUS and withholds guidance when active state is unclear", () => {
  const packageEngineServer = require("../package-engine-server.js");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-orientation-ambiguous-"));
  // Run with artifacts but no explicit state marker -> UNKNOWN -> withhold guidance.
  writeTestFile(
    tempRoot,
    "package-runs/2026-06-28-no-state/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "No State" } })
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const o = packageEngineServer.buildCockpitOrientation({ repoRoot: tempRoot });

  assert.equal(o.mode, "AMBIGUOUS");
  assert.equal(o.guidanceWithheld, true);
  assert.equal(o.activeRun, "");
  assert.ok(o.nextValidAction);
});

test("orientation bar renders compact canonical fields and an ambiguous state", () => {
  const orientationBar = require("../orientation-bar.js");
  assert.equal(typeof orientationBar.render, "function");
  assert.equal(typeof orientationBar.mount, "function");

  const normal = {};
  orientationBar.render(normal, {
    mode: "Operator Clarity / Production",
    activeRun: "2026-06-28-stop-writing-your-shorts-like-blog-posts",
    currentGate: "Needs capture",
    nextValidAction: "Add real capture evidence",
    indexFreshness: { state: "fresh" },
  });
  assert.match(normal.innerHTML, /Canonical production state/);
  assert.match(normal.innerHTML, /Active:/);
  assert.match(normal.innerHTML, /2026-06-28-stop-writing-your-shorts-like-blog-posts/);
  assert.match(normal.innerHTML, /Needs capture/);
  assert.match(normal.innerHTML, /fresh/);

  const ambiguous = {};
  orientationBar.render(ambiguous, { mode: "AMBIGUOUS" });
  assert.match(ambiguous.innerHTML, /ambiguous/i);
  assert.match(ambiguous.innerHTML, /withheld/i);
});

test("orientation bar source is read-only, reads the canonical API, and fails gracefully", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "orientation-bar.js"), "utf8");
  assert.match(src, /\/api\/cockpit-orientation/);
  assert.match(src, /AMBIGUOUS/);
  assert.match(src, /unavailable/i); // graceful failure path
  assert.match(src, /canonicalOrientationStrip/); // auto-mount target
});

test("package-runs-dashboard includes the canonical orientation strip and shared script", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.html"), "utf8");
  assert.match(html, /id="canonicalOrientationStrip"/);
  assert.match(html, /orientation-bar\.js/);
});

test("index freshness reports missing, fresh, and stale states", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "index-freshness-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Freshness" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/package-run-state.md",
    "# Package Run State\n\nPackage run state: active\n"
  );

  // No index file yet -> missing.
  const missing = packageRunsIndexScript.indexFreshness({ repoRoot: tempRoot });
  assert.equal(missing.state, "missing");
  assert.equal(missing.stale, true);

  // Build + write the index -> fresh.
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));
  const fresh = packageRunsIndexScript.indexFreshness({ repoRoot: tempRoot });
  assert.equal(fresh.state, "fresh");
  assert.equal(fresh.stale, false);

  // Make a run file newer than the index's generatedAt -> stale.
  const future = new Date(Date.now() + 3600 * 1000);
  fs.utimesSync(path.join(tempRoot, "package-runs/2026-05-10-active/package-run-state.md"), future, future);
  const stale = packageRunsIndexScript.indexFreshness({ repoRoot: tempRoot });
  assert.equal(stale.state, "stale");
  assert.equal(stale.stale, true);
  assert.match(stale.message, /rebuild/i);
});

test("active state audit json cli is parseable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-json-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "JSON Active" } })
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const output = captureConsole(() => packageRunActiveStateAuditScript.main(["--json"], { repoRoot: tempRoot }));
  const payload = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.equal(payload.name, "package_run_active_state_audit");
  assert.equal(payload.ok, true);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.externalApisCalled, false);
  assert.equal(payload.selectedActiveRun, "package-runs/2026-05-10-active");
});

test("active state audit help output documents read-only usage", () => {
  const output = captureConsole(() => packageRunActiveStateAuditScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /Package Run Active State Audit/);
  assert.match(output.stdout.join("\n"), /--json/);
  assert.match(output.stdout.join("\n"), /Read-only local audit/);
});

test("active state audit does not mutate package-run fixture files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-active-audit-readonly-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Read Only Active" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-09-parked/package-run-state.md",
    "# Package Run State\n\nPackage run state: parked\n"
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));
  const runFiles = [
    "package-runs/2026-05-10-active/selected-package.json",
    "package-runs/2026-05-09-parked/package-run-state.md",
  ];
  const before = Object.fromEntries(runFiles.map((filename) => [filename, fs.readFileSync(path.join(tempRoot, filename), "utf8")]));

  const report = packageRunActiveStateAuditScript.buildActiveStateAudit({ repoRoot: tempRoot });
  packageRunActiveStateAuditScript.renderText(report);
  captureConsole(() => packageRunActiveStateAuditScript.main(["--json"], { repoRoot: tempRoot }));

  const after = Object.fromEntries(runFiles.map((filename) => [filename, fs.readFileSync(path.join(tempRoot, filename), "utf8")]));
  assert.deepEqual(after, before);
});

test("package run state proposal reports fixture single-active state read-only", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-state-proposal-may6-fixture-"));
  const activeRel = "package-runs/2026-05-06-ai-video-proof-plan";
  const parkedNextRel = "package-runs/2026-05-02-next-vidtoolz-video";
  const parkedIdeaFilterRel = "package-runs/2026-05-02-ai-video-idea-filter";
  writeTestFile(repoRoot, `${activeRel}/selected-package.json`, JSON.stringify({ package: { proposedTitle: "May 6 Active" } }));
  writeTestFile(repoRoot, `${activeRel}/final-script.md`, "# Final Script\n");
  writeTestFile(repoRoot, `${activeRel}/production-plan.md`, "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n");
  [parkedNextRel, parkedIdeaFilterRel].forEach((runRel) => {
    writeTestFile(
      repoRoot,
      `${runRel}/package-run-state.md`,
      "# Package Run State\n\nPackage run state: parked\n\nReason: Fixture parked run.\n"
    );
    writeTestFile(repoRoot, `${runRel}/selected-package.json`, JSON.stringify({ package: { proposedTitle: path.basename(runRel) } }));
    writeTestFile(repoRoot, `${runRel}/final-script.md`, "# Final Script\n");
  });
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot, runsDir: "package-runs" });
  writeTestFile(repoRoot, "package-runs-index.json", JSON.stringify(index, null, 2));
  const packet = packageRunStateProposalScript.buildStateProposal({ repoRoot });

  assert.equal(packet.name, "package_run_state_proposal");
  assert.equal(packet.ok, true);
  assert.equal(packet.ambiguity, false);
  assert.equal(packet.selectedActiveRun, activeRel);
  assert.equal(packet.safety.readOnly, true);
  assert.equal(packet.safety.packageRunFilesWritten, false);
  assert.equal(packet.safety.packageRunsIndexUpdated, false);
  assert.equal(packet.safety.gitActionsPerformed, false);
  assert.equal(packet.proposals.length, 1);
  assert.equal(packet.proposals[0].path, activeRel);
  assert.equal(packet.proposals[0].proposedState, "keep-active");
  assert.equal(packet.proposals.some((item) => item.blockedActions.includes("capture intake")), true);
  assert.equal(packet.proposals.some((item) => /approve-production|ready-to-shoot|publish|archive/.test(item.proposedState)), false);
  assert.equal(
    packet.exactNextSafeAction,
    "Review this proposal, then explicitly choose which single package run remains active before package-run-specific cockpit panels make decisions."
  );
});

test("package run state proposal json cli is parseable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-state-proposal-json-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Proposal JSON Active" } })
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const output = captureConsole(() => packageRunStateProposalScript.main(["--json"], { repoRoot: tempRoot }));
  const payload = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.equal(payload.name, "package_run_state_proposal");
  assert.equal(payload.ok, true);
  assert.equal(payload.selectedActiveRun, "package-runs/2026-05-10-active");
  assert.equal(payload.proposals.length, 1);
  assert.equal(payload.proposals[0].proposedState, "keep-active");
});

test("package run state proposal degrades safely when no active candidates exist", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-state-proposal-none-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-parked/package-run-state.md",
    "# Package Run State\n\nPackage run state: parked\n"
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const packet = packageRunStateProposalScript.buildStateProposal({ repoRoot: tempRoot });
  const text = packageRunStateProposalScript.renderText(packet);

  assert.equal(packet.ok, false);
  assert.equal(packet.ambiguity, false);
  assert.equal(packet.selectedActiveRun, "");
  assert.deepEqual(packet.proposals, []);
  assert.match(text, /No active package-run candidates were found/);
});

test("package run state proposal keeps single active run active", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-state-proposal-one-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Proposal One Active" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-09-parked/package-run-state.md",
    "# Package Run State\n\nPackage run state: parked\n"
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const packet = packageRunStateProposalScript.buildStateProposal({ repoRoot: tempRoot });

  assert.equal(packet.ok, true);
  assert.equal(packet.selectedActiveRun, "package-runs/2026-05-10-active");
  assert.equal(packet.proposals.length, 1);
  assert.equal(packet.proposals[0].proposedState, "keep-active");
  assert.equal(packet.proposals[0].requiredHumanReview, true);
});

test("package run state proposal safety fields stay read-only", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-state-proposal-safety-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Proposal Safety" } })
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));

  const packet = packageRunStateProposalScript.buildStateProposal({ repoRoot: tempRoot });

  assert.equal(packet.safety.readOnly, true);
  assert.equal(packet.safety.externalApisCalled, false);
  assert.equal(packet.safety.packageRunFilesWritten, false);
  assert.equal(packet.safety.packageRunsIndexUpdated, false);
  assert.equal(packet.safety.approvalMarkersAdded, false);
  assert.equal(packet.safety.gitActionsPerformed, false);
  assert.equal(packet.safety.mediaMutated, false);
  assert.equal(packet.safety.hermesOrProjectStateUpdated, false);
  assert.equal(packet.safety.scheduledJobsCreated, false);
});

test("package run state proposal does not create or modify files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-state-proposal-readonly-"));
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-10-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Proposal Read Only" } })
  );
  writeTestFile(
    tempRoot,
    "package-runs/2026-05-09-active/selected-package.json",
    JSON.stringify({ package: { proposedTitle: "Proposal Older Active" } })
  );
  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  writeTestFile(tempRoot, "package-runs-index.json", JSON.stringify(index, null, 2));
  const files = [
    "package-runs-index.json",
    "package-runs/2026-05-10-active/selected-package.json",
    "package-runs/2026-05-09-active/selected-package.json",
  ];
  const before = Object.fromEntries(files.map((filename) => [filename, fs.readFileSync(path.join(tempRoot, filename), "utf8")]));
  const beforeRunEntries = fs.readdirSync(path.join(tempRoot, "package-runs")).sort();

  const packet = packageRunStateProposalScript.buildStateProposal({ repoRoot: tempRoot });
  packageRunStateProposalScript.renderText(packet);
  captureConsole(() => packageRunStateProposalScript.main(["--json"], { repoRoot: tempRoot }));

  const after = Object.fromEntries(files.map((filename) => [filename, fs.readFileSync(path.join(tempRoot, filename), "utf8")]));
  const afterRunEntries = fs.readdirSync(path.join(tempRoot, "package-runs")).sort();
  assert.deepEqual(after, before);
  assert.deepEqual(afterRunEntries, beforeRunEntries);
  assert.equal(fs.existsSync(path.join(tempRoot, "package-runs/2026-05-10-active/package-run-state.md")), false);
  assert.equal(packet.proposals.length, 2);
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

test("doctor operator guidance gives plain-language meaning and AI-safe action per status", () => {
  const capture = packageRunDoctorScript.operatorGuidanceForRun({
    status: "Needs capture",
    nextRecommendedCommand: "node scripts/package-run-capture-evidence-review.js package-runs/x",
  });
  assert.match(capture.productionMeaning, /no real recorded media/i);
  assert.match(capture.nextHumanAction, /record/i);
  assert.match(capture.aiSafeAction, /must not mark this gate approved/i);
  assert.equal(capture.nextCommand, "node scripts/package-run-capture-evidence-review.js package-runs/x");

  const inactive = packageRunDoctorScript.operatorGuidanceForRun({
    status: "Needs capture",
    packageRunState: { isInactive: true, state: "parked" },
  });
  assert.match(inactive.productionMeaning, /parked/i);
  assert.match(inactive.aiSafeAction, /do not reactivate/i);
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

test("production approval review packet reports clear production and capture gates blocked at rough-cut review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-review-rough-cut-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-06-ai-video-proof-plan");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "May 6 Proof Plan Fixture" } }),
    "final-script.md": "# Final Script\n\nApproved final script fixture.\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Manual approval marker detected: yes\n- Ready for rough-cut work: yes\n- Real capture evidence detected: yes\n",
    "rough-cut-review.md":
      "# Rough-Cut Review\n\n- Rough-cut notes source: created starter template\n- Rough-cut review status: BLOCKED\n- Second-cut ready: no\n\n## Second-Cut Readiness Gate\n\n- Status: BLOCKED\n- Reason: rough-cut-watch-notes.md was missing; starter template created.\n",
  });

  const runPath = path.relative(tempRoot, runDir);
  const packet = packageProductionApprovalReviewScript.buildReviewPacket(runPath, { repoRoot: tempRoot });
  const doctor = packageRunDoctorScript.buildDoctorReport(runPath, { repoRoot: tempRoot });
  const text = packageProductionApprovalReviewScript.renderText(packet);

  assert.equal(packet.runId, "2026-05-06-ai-video-proof-plan");
  assert.equal(packet.readOnly, true);
  assert.equal(packet.externalApisCalled, false);
  assert.equal(packet.captureIntakeSuggested, false);
  assert.equal(packet.exactNextSafeAction, "Production approval gate is clear; downstream gates now apply.");
  assert.doesNotMatch(packet.exactNextSafeAction, /Repair production-plan\.md and request Mikko production approval/);
  assert.doesNotMatch(packet.exactNextSafeAction, /Review the capture evidence manually/);
  assert.match(text, /Capture evidence status: PASS/);
  assert.match(text, /Capture evidence accepted: yes/);
  assert.equal(packet.currentProductionStatus.effectiveProductionStatus, "READY TO SHOOT");
  assert.equal(packet.currentProductionStatus.productionApprovalBlocked, false);
  assert.equal(packet.currentProductionStatus.productionBlockersOpen, false);
  assert.equal(packet.currentProductionStatus.captureEvidenceStatus, "PASS");
  assert.equal(packet.currentProductionStatus.captureEvidenceAccepted, true);
  assert.equal(doctor.currentInferredStage, "Needs rough-cut review");
  assert.equal(doctor.lifecycleGate.captureEvidenceReviewStatus, "PASS");
  assert.equal(doctor.lifecycleGate.captureEvidenceAccepted, true);
  assert.equal(doctor.lifecycleGate.roughCutStatus, "BLOCKED");
  assert.equal(doctor.missingExpectedArtifacts.includes("rough-cut-watch-notes.md with real notes"), true);
  assert.match(doctor.blockingReasons.join("\n"), /Rough-cut review status is BLOCKED, not READY FOR SECOND CUT/);
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

test("production approval review packet does not show stale production-planning fallback after capture evidence is clear", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-approval-review-clear-capture-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-review-clear-capture");
  writeCaptureEvidenceFixture(runDir, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Review Clear Capture" } }),
    "final-script.md": "# Final Script\n",
    "production-plan.md": "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "production-blockers.md":
      "# Production Blockers\n\n| blocker | why it matters | required fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "capture-evidence-review.md":
      "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Manual approval marker detected: yes\n- Ready for rough-cut work: yes\n- Real capture evidence detected: yes\n",
  });

  const packet = packageProductionApprovalReviewScript.buildReviewPacket(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(packet.currentProductionStatus.effectiveProductionStatus, "READY TO SHOOT");
  assert.equal(packet.currentProductionStatus.productionApprovalBlocked, false);
  assert.equal(packet.currentProductionStatus.productionBlockersOpen, false);
  assert.equal(packet.currentProductionStatus.captureEvidenceStatus, "PASS");
  assert.equal(packet.currentProductionStatus.captureEvidenceAccepted, true);
  assert.equal(packet.exactNextSafeAction, "Production approval gate is clear; downstream gates now apply.");
  assert.doesNotMatch(packet.exactNextSafeAction, /Repair production-plan\.md and request Mikko production approval/);
  assert.doesNotMatch(packet.exactNextSafeAction, /capture evidence intake/);
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
  assert.equal(payload.jsonContract.productionStatusContainer, "currentProductionStatus");
  assert.deepEqual(payload.jsonContract.productionStatusFields, [
    "effectiveProductionStatus",
    "rawParsedProductionStatus",
    "productionApprovalBlocked",
    "productionBlockersOpen",
    "shotEditPlanStatus",
    "captureEvidenceStatus",
    "captureEvidenceAccepted",
  ]);
  assert.equal(typeof payload.currentProductionStatus, "object");
  assert.equal(Object.hasOwn(payload.currentProductionStatus, "effectiveProductionStatus"), true);
  assert.equal(Object.hasOwn(payload.currentProductionStatus, "rawParsedProductionStatus"), true);
  assert.equal(Object.hasOwn(payload.currentProductionStatus, "productionApprovalBlocked"), true);
  assert.equal(Object.hasOwn(payload.currentProductionStatus, "productionBlockersOpen"), true);
  assert.equal(Object.hasOwn(payload.currentProductionStatus, "shotEditPlanStatus"), true);
  assert.equal(Object.hasOwn(payload.currentProductionStatus, "captureEvidenceStatus"), true);
  assert.equal(Object.hasOwn(payload.currentProductionStatus, "captureEvidenceAccepted"), true);
  assert.equal(payload.currentProductionStatus.rawParsedProductionStatus, "READY TO SHOOT");
  assert.equal(payload.currentProductionStatus.effectiveProductionStatus, "NOT READY TO SHOOT");
  assert.equal(payload.currentProductionStatus.productionApprovalBlocked, true);
  assert.equal(payload.currentProductionStatus.productionBlockersOpen, true);
  assert.equal(payload.currentProductionStatus.shotEditPlanStatus, "STALE PASS");
  assert.equal(payload.currentProductionStatus.captureEvidenceStatus, "READY FOR ROUGH CUT");
  assert.equal(payload.currentProductionStatus.captureEvidenceAccepted, false);
  assert.equal(Object.hasOwn(payload, "effectiveProductionStatus"), false);
  assert.equal(Object.hasOwn(payload, "rawParsedProductionStatus"), false);
  assert.equal(Object.hasOwn(payload, "productionApprovalBlocked"), false);
  assert.equal(Object.hasOwn(payload, "productionBlockersOpen"), false);
  assert.equal(Object.hasOwn(payload, "shotEditPlanStatus"), false);
  assert.equal(Object.hasOwn(payload, "captureEvidenceStatus"), false);
  assert.equal(Object.hasOwn(payload, "captureEvidenceAccepted"), false);
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

test("verify script checks package run next action authority syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/package-run-next-action-authority\.js/);
});

test("package run next action authority keeps blocked runs out of production routing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-blocked-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-blocked");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Blocked Authority" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n",
    "utf8"
  );

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.currentStage, "Needs production planning");
  assert.equal(report.sourceSignals.workflow.overallStatus, "BLOCKED");
  assert.doesNotMatch(report.nextSafeAction.label, /shoot|edit|publish|ready-to-shoot/i);
  assert.doesNotMatch(report.nextSafeAction.suggestedCommand, /shoot|edit|publish/i);
  assert.notEqual(report.nextSafeAction.mode, "read-only");
  assert.equal(report.blockedActions.includes("shooting"), true);
  assert.equal(report.blockedActions.includes("editing"), true);
  assert.equal(report.blockedActions.includes("publishing"), true);
});

test("package run next action authority routes Creator QA fail to repair review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-qa-fail-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-qa-fail");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "QA Fail Authority" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "FAIL" }), "utf8");

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.workflowBucket, "Needs QA repair");
  assert.equal(report.nextSafeAction.actor, "codex");
  assert.equal(report.nextSafeAction.mode, "draft-only");
  assert.match(report.nextSafeAction.label, /Creator QA repair brief.*FAIL/);
  assert.doesNotMatch(report.nextSafeAction.label, /production|shoot/i);
  assert.equal(report.blockedActions.includes("shooting"), true);
});

test("package run next action authority routes missing capture proof to evidence work", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-capture-proof-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-proof");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Capture Proof Authority" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-review.md"), "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "capture-checklist.md"), "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n- Ready for rough cut: yes\n", "utf8");
  fs.writeFileSync(path.join(runDir, "takes-log.md"), "# Takes Log\n\nTODO\n", "utf8");
  fs.writeFileSync(path.join(runDir, "missing-shot-tracker.md"), "# Missing Shot Tracker\n\nTODO\n", "utf8");
  fs.writeFileSync(path.join(runDir, "screen-recording-checklist.md"), "# Screen Recording Checklist\n\nTODO\n", "utf8");
  fs.writeFileSync(path.join(runDir, "audio-capture-checklist.md"), "# Audio Capture Checklist\n\nTODO\n", "utf8");

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.currentStage, "Needs capture");
  assert.match(report.nextSafeAction.label, /capture evidence|real media proof/i);
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.doesNotMatch(report.nextSafeAction.label, /ready-to-shoot/i);
  assert.equal(report.sourceSignals.captureEvidence.hasConcreteCaptureEvidence, false);
  assert.equal(report.blockedActions.includes("ready-to-shoot"), true);
});

test("package run next action authority blocks durable actions instead of making them next", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-durable-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-durable");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Durable Authority" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Stage accepted: no\n\n## Next Safe Action\n\n- Mikko reviews Stage 4 planning and decides whether to approve.\n",
    "utf8"
  );

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.nextSafeAction.actor, "mikko");
  assert.equal(report.nextSafeAction.mode, "approval-required");
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.equal(report.humanApprovalRequired, true);
  assert.equal(report.blockedActions.includes("production approval"), true);
  assert.equal(report.blockedActions.includes("package-run artifact mutation"), true);
});

test("package run next action authority prioritizes research needs evidence before production repair", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-research-needs-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-needs");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Research Needs" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PARTIAL\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    "# Research Sufficiency Review\n\n- Research sufficiency status: NEEDS EVIDENCE\n- Source references: 0\n- Production-proof items: 0\n- Objections/counterexamples: 0\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| upstream | required | repair | open |\n",
    "utf8"
  );

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.match(report.sourceSignals.doctor.firstBlockerReason, /Research evidence review is NEEDS EVIDENCE/i);
  assert.match(report.nextSafeAction.label, /research evidence and research sufficiency/i);
  assert.doesNotMatch(report.nextSafeAction.label, /production-plan repair brief/i);
  assert.equal(report.nextSafeAction.mode, "draft-only");
  assert.equal(report.nextSafeAction.suggestedCommand, "");
});

test("package run next action authority prioritizes partial research before production repair", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-research-partial-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-partial");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Research Partial" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PARTIAL\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n", "utf8");

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.match(report.nextSafeAction.label, /research evidence and research sufficiency/i);
  assert.doesNotMatch(report.nextSafeAction.label, /production-plan repair brief/i);
  assert.equal(report.nextSafeAction.suggestedCommand, "");
});

test("package run next action authority routes ready research review to Mikko approval decision", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-research-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-research-ready");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Research Ready" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PARTIAL\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "source-support-map.md"),
    "# Source Support Map\n\n| source/reference | claim supported | evidence type | reliability note | status |\n| --- | --- | --- | --- | --- |\n| source-a.md | Claim A is supported. | Local source note | Concrete local reference. | review-needed |\n| source-b.md | Claim B is supported. | Local source note | Concrete local reference. | review-needed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "proof-capture-plan.md"),
    "# Proof Capture Plan\n\n| proof item | what it proves | local capture method | file/app/source | status |\n| --- | --- | --- | --- | --- |\n| Proof table | Shows the claim can be inspected. | Capture local table and notes. | proof.md | review-needed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-objections.md"),
    "# Research Objections\n\n| objection/counterexample | why it matters | evidence needed | response plan | status |\n| --- | --- | --- | --- | --- |\n| Counterexample | Prevents overclaiming. | Compare local notes. | Keep blocked until reviewed. | review-needed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    "# Research Sufficiency Review\n\n- Research sufficiency status: READY FOR RESEARCH REVIEW\n- Research approval marker: missing\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n", "utf8");

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.match(report.sourceSignals.doctor.firstBlockerReason, /READY FOR RESEARCH REVIEW/i);
  assert.equal(report.nextSafeAction.actor, "mikko");
  assert.equal(report.nextSafeAction.mode, "approval-required");
  assert.equal(
    report.nextSafeAction.label,
    "Review research evidence and decide whether to approve, request changes, or keep blocked before script structure or production planning."
  );
  assert.doesNotMatch(report.nextSafeAction.label, /repair brief/i);
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.equal(report.nextSafeAction.writesDurableState, true);
  assert.equal(report.nextSafeAction.humanApprovalRequired, true);
  assert.equal(report.humanApprovalRequired, true);
  assert.equal(report.blockedActions.includes("production approval"), true);
  assert.equal(report.blockedActions.includes("mark ready-to-shoot"), true);
  assert.equal(report.blockedActions.includes("shooting"), true);
  assert.equal(report.blockedActions.includes("editing"), true);
  assert.equal(report.blockedActions.includes("publishing"), true);
  assert.equal(report.blockedActions.includes("package-run artifact mutation"), true);
  assert.equal(report.blockedActions.includes("media move"), true);
  assert.equal(report.blockedActions.includes("scheduled job"), true);
  assert.equal(report.blockedActions.includes("commit"), true);
  assert.equal(report.blockedActions.includes("push"), true);
});

test("package run next action authority prioritizes missing or partial script structure before production repair", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-structure-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-structure");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Structure Missing" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PASS\n", "utf8");
  fs.writeFileSync(path.join(runDir, "research-sufficiency-review.md"), "# Research Sufficiency Review\n\n- Research sufficiency status: PASS\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n", "utf8");

  const missingReport = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  assert.match(missingReport.nextSafeAction.label, /script-structure repair brief/i);
  assert.doesNotMatch(missingReport.nextSafeAction.label, /production-plan repair brief/i);
  assert.equal(missingReport.nextSafeAction.suggestedCommand, "");

  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: PARTIAL\n- Ready to draft: no\n",
    "utf8"
  );
  const partialReport = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  assert.match(partialReport.nextSafeAction.label, /script-structure repair brief/i);
  assert.doesNotMatch(partialReport.nextSafeAction.label, /production-plan repair brief/i);
  assert.equal(partialReport.nextSafeAction.suggestedCommand, "");
});

test("package run next action authority prioritizes script review needs revision before production repair", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-script-review-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-script-review");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Script Review" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PASS\n", "utf8");
  fs.writeFileSync(path.join(runDir, "research-sufficiency-review.md"), "# Research Sufficiency Review\n\n- Research sufficiency status: PASS\n", "utf8");
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
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n", "utf8");

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.match(report.nextSafeAction.label, /script review and script revision repair brief/i);
  assert.doesNotMatch(report.nextSafeAction.label, /production-plan repair brief/i);
  assert.equal(report.nextSafeAction.mode, "draft-only");
  assert.equal(report.nextSafeAction.suggestedCommand, "");
});

test("package run next action authority routes research and script pass to production planning repair", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-production-repair-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-production-repair");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Production Repair" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PARTIAL\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    "# Research Sufficiency Review\n\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Research gate status: PASS\n- Ready to draft: yes\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "script-review.md"),
    "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n- Research gate status: PASS\n- Script structure status: READY TO DRAFT\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| stale plan | script gates changed | repair production plan | open |\n",
    "utf8"
  );

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.nextSafeAction.actor, "codex");
  assert.equal(report.nextSafeAction.mode, "draft-only");
  assert.equal(
    report.nextSafeAction.label,
    "Prepare a production-planning repair brief now that research and script review gates pass."
  );
  assert.doesNotMatch(report.nextSafeAction.label, /research evidence and research sufficiency repair/i);
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.equal(report.nextSafeAction.writesDurableState, false);
  assert.equal(report.nextSafeAction.humanApprovalRequired, false);
  assert.equal(report.blockedActions.includes("production approval"), true);
  assert.equal(report.blockedActions.includes("mark ready-to-shoot"), true);
  assert.equal(report.blockedActions.includes("shooting"), true);
  assert.equal(report.blockedActions.includes("capture approval"), true);
  assert.equal(report.blockedActions.includes("final title lock"), true);
  assert.equal(report.blockedActions.includes("final thumbnail lock"), true);
  assert.equal(report.blockedActions.includes("package-run artifact mutation"), true);
});

test("package run next action authority routes existing production repair brief to Mikko decision", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-production-brief-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-production-brief");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Production Brief" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PARTIAL\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    "# Research Sufficiency Review\n\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Research gate status: PASS\n- Ready to draft: yes\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "script-review.md"),
    "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n- Research gate status: PASS\n- Script structure status: READY TO DRAFT\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: NEEDS SCRIPT APPROVAL\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| stale plan | script gates changed | repair production plan | open |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-planning-repair-brief.md"),
    "# Production-Planning Repair Brief\n\nDraft only. Mikko must decide whether to rerun planning artifacts.\n",
    "utf8"
  );

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.nextSafeAction.actor, "mikko");
  assert.equal(report.nextSafeAction.mode, "approval-required");
  assert.equal(
    report.nextSafeAction.label,
    "Review the production-planning repair brief and decide whether to rerun production planning artifacts."
  );
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.equal(report.nextSafeAction.writesDurableState, true);
  assert.equal(report.nextSafeAction.humanApprovalRequired, true);
  assert.equal(report.humanApprovalRequired, true);
  assert.equal(report.blockedActions.includes("production approval"), true);
  assert.equal(report.blockedActions.includes("mark ready-to-shoot"), true);
  assert.equal(report.blockedActions.includes("capture approval"), true);
  assert.equal(report.blockedActions.includes("final title lock"), true);
  assert.equal(report.blockedActions.includes("final thumbnail lock"), true);
  assert.equal(report.blockedActions.includes("media move"), true);
  assert.equal(report.blockedActions.includes("commit"), true);
  assert.equal(report.blockedActions.includes("push"), true);
});

test("package run next action authority routes refreshed production plan to shot edit review", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-shot-edit-review-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-shot-edit-review");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Shot Edit Review" } }), "utf8");
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    "# Research Sufficiency Review\n\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Research gate status: PASS\n- Ready to draft: yes\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "script-review.md"),
    "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n- Research gate status: PASS\n- Script structure status: READY TO DRAFT\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-planning-repair-brief.md"),
    "# Production-Planning Repair Brief\n\nAlready reviewed for rerun.\n",
    "utf8"
  );

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.currentStage, "Needs shot/edit plan review");
  assert.equal(report.nextSafeAction.actor, "codex");
  assert.equal(report.nextSafeAction.mode, "draft-only");
  assert.equal(report.nextSafeAction.label, "Prepare a shot/edit plan review brief before capture evidence intake.");
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.equal(report.nextSafeAction.writesDurableState, false);
  assert.equal(report.nextSafeAction.humanApprovalRequired, false);
  assert.doesNotMatch(report.nextSafeAction.label, /production-planning repair brief|production planning artifacts/i);
  assert.equal(report.sourceSignals.captureEvidence.captureEvidenceAccepted, false);
  assert.equal(report.blockedActions.includes("production approval"), true);
  assert.equal(report.blockedActions.includes("mark ready-to-shoot"), true);
  assert.equal(report.blockedActions.includes("capture approval"), true);
  assert.equal(report.blockedActions.includes("shooting"), true);
  assert.equal(report.blockedActions.includes("editing"), true);
  assert.equal(report.blockedActions.includes("publishing"), true);
  assert.equal(report.blockedActions.includes("final title lock"), true);
  assert.equal(report.blockedActions.includes("final thumbnail lock"), true);
  assert.equal(report.blockedActions.includes("media move"), true);
  assert.equal(report.blockedActions.includes("commit"), true);
  assert.equal(report.blockedActions.includes("push"), true);
});

test("package run next action authority routes shot edit needs work to planning repair", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-shot-edit-needs-work-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-shot-edit-needs-work");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Shot Edit Needs Work" } }), "utf8");
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    "# Research Sufficiency Review\n\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Research gate status: PASS\n- Ready to draft: yes\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "script-review.md"),
    "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n- Research gate status: PASS\n- Script structure status: READY TO DRAFT\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "shot-list.md"), "# Shot List\n\nTODO\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: NEEDS WORK\n- Stage accepted: no\n\n## Open Blockers\n\n- shot-list.md is placeholder-only or too thin.\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-enhancement-plan.md"), "# Shot/Edit Plan Enhancement Plan\n", "utf8");

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.currentStage, "Needs shot/edit plan approval");
  assert.equal(report.nextSafeAction.actor, "codex");
  assert.equal(report.nextSafeAction.mode, "draft-only");
  assert.equal(
    report.nextSafeAction.label,
    "Prepare a shot/edit planning repair brief for the thin shot-list before capture evidence intake."
  );
  assert.match(report.nextSafeAction.label, /thin shot-list/);
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.equal(report.nextSafeAction.writesDurableState, false);
  assert.equal(report.nextSafeAction.humanApprovalRequired, false);
  assert.doesNotMatch(report.nextSafeAction.label, /Needs inspection before production routing/);
  assert.equal(report.blockedActions.includes("production approval"), true);
  assert.equal(report.blockedActions.includes("mark ready-to-shoot"), true);
  assert.equal(report.blockedActions.includes("capture approval"), true);
  assert.equal(report.blockedActions.includes("final title lock"), true);
  assert.equal(report.blockedActions.includes("final thumbnail lock"), true);
  assert.equal(report.blockedActions.includes("shooting"), true);
  assert.equal(report.blockedActions.includes("editing"), true);
  assert.equal(report.blockedActions.includes("publishing"), true);
});

test("package run next action authority routes accepted Stage 4 with missing capture checklist to draft preparation", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-capture-checklist-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-capture-checklist");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Capture Checklist" } }), "utf8");
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    "# Research Sufficiency Review\n\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Research gate status: PASS\n- Ready to draft: yes\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "script-review.md"),
    "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n- Research gate status: PASS\n- Script structure status: READY TO DRAFT\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n\n## Open Blockers\n\n- None.\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "shot-edit-plan-enhancement-plan.md"), "# Shot/Edit Plan Enhancement Plan\n", "utf8");

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.currentStage, "Ready for capture checklist");
  assert.equal(report.sourceSignals.doctor.firstBlockerReason, "Missing expected artifact: capture-checklist.md.");
  assert.equal(report.nextSafeAction.actor, "codex");
  assert.equal(report.nextSafeAction.mode, "draft-only");
  assert.equal(
    report.nextSafeAction.label,
    "Prepare capture checklist artifacts after Stage 4 acceptance; do not approve capture."
  );
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.doesNotMatch(report.nextSafeAction.suggestedCommand, /package-run-capture-checklist\.js/);
  assert.equal(report.nextSafeAction.writesDurableState, false);
  assert.equal(report.nextSafeAction.humanApprovalRequired, false);
  assert.equal(report.effectiveReadiness.captureApproved, false);
  assert.equal(report.effectiveReadiness.readyForRoughCut, false);
  assert.equal(report.effectiveReadiness.publishReady, false);
  assert.equal(report.blockedActions.includes("capture approval"), true);
  assert.equal(report.blockedActions.includes("shooting"), true);
  assert.equal(report.blockedActions.includes("editing"), true);
  assert.equal(report.blockedActions.includes("publishing"), true);
  assert.equal(report.blockedActions.includes("final title lock"), true);
  assert.equal(report.blockedActions.includes("final thumbnail lock"), true);
  assert.equal(report.blockedActions.includes("media move"), true);
  assert.equal(report.blockedActions.includes("commit"), true);
  assert.equal(report.blockedActions.includes("push"), true);
});

test("package run next action authority requires accepted shot edit stage before capture routing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-shot-edit-before-capture-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-shot-edit-before-capture");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Shot Edit Before Capture" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: NEEDS WORK\n- Stage accepted: no\n\n## Open Blockers\n\n- shot-list.md is placeholder-only or too thin.\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "capture-checklist.md"), "# Capture Checklist\n\n- Capture checklist status: READY FOR ROUGH CUT\n", "utf8");

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.currentStage, "Needs shot/edit plan approval");
  assert.equal(report.nextSafeAction.label, "Prepare a shot/edit planning repair brief for the thin shot-list before capture evidence intake.");
  assert.doesNotMatch(report.nextSafeAction.label, /capture evidence repair|capture proof|rough-cut/i);
  assert.equal(report.sourceSignals.captureEvidence.captureEvidenceAccepted, false);
});

test("package run next action authority routes shot edit human review to Mikko", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-shot-edit-human-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-shot-edit-human");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Shot Edit Human" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "production-plan.md"), "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "shot-edit-plan-review.md"),
    "# Shot/Edit Plan Review\n\n- Review status: READY FOR HUMAN APPROVAL\n- Stage accepted: no\n",
    "utf8"
  );

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.equal(report.nextSafeAction.actor, "mikko");
  assert.equal(report.nextSafeAction.mode, "approval-required");
  assert.match(report.nextSafeAction.label, /Review shot\/edit plan review/i);
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.equal(report.nextSafeAction.humanApprovalRequired, true);
  assert.equal(report.blockedActions.includes("capture approval"), true);
  assert.equal(report.blockedActions.includes("shooting"), true);
});

test("package run next action authority routes open production blockers to production planning repair", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-production-blockers-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-production-blockers");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Production Blockers" } }), "utf8");
  fs.writeFileSync(
    path.join(runDir, "research-sufficiency-review.md"),
    "# Research Sufficiency Review\n\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "script-structure.md"),
    "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Research gate status: PASS\n- Ready to draft: yes\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "script-review.md"),
    "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n- Research gate status: PASS\n- Script structure status: READY TO DRAFT\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "production-blockers.md"),
    "# Production Blockers\n\n| blocker | why | fix | status |\n| --- | --- | --- | --- |\n| unresolved approval boundary | prevents production readiness | repair plan | open |\n",
    "utf8"
  );

  const report = packageRunNextActionAuthorityScript.buildAuthorityReport(path.relative(tempRoot, runDir), { repoRoot: tempRoot });

  assert.match(report.nextSafeAction.label, /production-planning repair brief/);
  assert.doesNotMatch(report.nextSafeAction.label, /research evidence and research sufficiency repair/i);
  assert.equal(report.nextSafeAction.mode, "draft-only");
  assert.equal(report.nextSafeAction.suggestedCommand, "");
  assert.equal(report.nextSafeAction.writesDurableState, false);
  assert.equal(report.blockedActions.includes("production approval"), true);
  assert.equal(report.blockedActions.includes("mark ready-to-shoot"), true);
  assert.equal(report.blockedActions.includes("capture approval"), true);
  assert.equal(report.blockedActions.includes("final title lock"), true);
  assert.equal(report.blockedActions.includes("final thumbnail lock"), true);
});

test("package run next action authority json cli is stable and parseable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-authority-json-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-authority-json");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Authority JSON" } }), "utf8");

  const output = captureConsole(() => packageRunNextActionAuthorityScript.main([runDir, "--json"]));
  const parsed = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 0);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.runId, "2026-05-10-authority-json");
  assert.equal(parsed.title, "Authority JSON");
  assert.equal(typeof parsed.nextSafeAction.actor, "string");
  assert.equal(Object.hasOwn(parsed.nextSafeAction, "writesDurableState"), true);
  assert.equal(Array.isArray(parsed.blockedActions), true);
  assert.equal(typeof parsed.sourceSignals.packageRunIndex.matchedRun.status, "string");
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.externalApisCalled, false);
  [
    "runId",
    "title",
    "workflowBucket",
    "currentStage",
    "effectiveReadiness",
    "nextSafeAction",
    "blockedActions",
    "humanApprovalRequired",
    "safetyNote",
    "sourceSignals",
    "readOnly",
    "externalApisCalled",
  ].forEach((key) => assert.equal(Object.hasOwn(parsed, key), true, `${key} should be present`));
});

test("package run next action authority error json includes ok false", () => {
  const output = captureConsole(() => packageRunNextActionAuthorityScript.main(["package-runs/not-real", "--json"]));
  const parsed = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 1);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.externalApisCalled, false);
  assert.match(parsed.error, /Package run folder not found/);
});

test("package run next action authority does not classify mutating labels as read-only", () => {
  [
    "Repair production-plan.md",
    "Update package-run-state.md",
    "Edit capture evidence rows",
    "Resolve production-blockers.md",
    "Write approval marker",
    "Mark ready-to-shoot",
    "Approve production",
    "Move media files",
    "Create scheduled job",
  ].forEach((label) => {
    const action = packageRunNextActionAuthorityScript.enforceSemanticSafety({
      actor: "codex",
      mode: "read-only",
      label,
      suggestedCommand: "",
      writesDurableState: false,
      humanApprovalRequired: false,
    });
    assert.notEqual(action.mode, "read-only", label);
  });
});

test("package run next action authority treats capture evidence review as mutating", () => {
  const command = "node scripts/package-run-capture-evidence-review.js package-runs/run-a";

  assert.equal(packageRunNextActionAuthorityScript.isConfirmedReadOnlyCommand(command), false);
  assert.equal(packageRunNextActionAuthorityScript.writesDurableState(command), true);

  const action = packageRunNextActionAuthorityScript.enforceSemanticSafety({
    actor: "hermes",
    mode: "read-only",
    label: "Run capture evidence review.",
    suggestedCommand: command,
    writesDurableState: false,
    humanApprovalRequired: false,
  });

  assert.equal(action.mode, "approval-required");
  assert.equal(action.suggestedCommand, "");
  assert.equal(action.writesDurableState, true);
  assert.equal(action.humanApprovalRequired, true);
});

test("package run next action authority read-only commands use explicit allowlist", () => {
  assert.equal(
    packageRunNextActionAuthorityScript.isConfirmedReadOnlyCommand("node scripts/package-run-doctor.js package-runs/run-a --json"),
    true
  );
  assert.equal(
    packageRunNextActionAuthorityScript.isConfirmedReadOnlyCommand("node scripts/package-run-evidence-lint.js package-runs/run-a"),
    true
  );
  assert.equal(
    packageRunNextActionAuthorityScript.isConfirmedReadOnlyCommand("node scripts/package-run-capture-evidence-review.js package-runs/run-a"),
    false
  );
  assert.equal(
    packageRunNextActionAuthorityScript.isConfirmedReadOnlyCommand("node scripts/package-run-production-plan.js package-runs/run-a"),
    false
  );
  assert.equal(
    packageRunNextActionAuthorityScript.isConfirmedReadOnlyCommand("node scripts/package-run-research-evidence.js package-runs/run-a"),
    false
  );
  assert.equal(
    packageRunNextActionAuthorityScript.isConfirmedReadOnlyCommand("node scripts/package-run-script-structure.js package-runs/run-a"),
    false
  );
  assert.equal(
    packageRunNextActionAuthorityScript.isConfirmedReadOnlyCommand("node scripts/package-run-script-review.js package-runs/run-a"),
    false
  );
});

test("package run workflow map outputs current gate artifacts without writing package-run state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-workflow-map-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-workflow-map");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Workflow Map Test" } }),
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "manual-note.md"), "# Manual note\n", "utf8");
  const before = fs.readdirSync(runDir).sort();

  const report = packageRunWorkflowMapScript.buildWorkflowMap(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  const output = captureConsole(() => packageRunWorkflowMapScript.main([runDir], { repoRoot: tempRoot }));
  const parsed = JSON.parse(output.stdout.join("\n"));
  const after = fs.readdirSync(runDir).sort();

  assert.deepEqual(after, before);
  assert.equal(output.result, 0);
  assert.equal(parsed.ok, true);
  assert.equal(report.schema, "vidtoolz.packageRunWorkflowMap.v1");
  assert.equal(report.runId, "2026-05-10-workflow-map");
  assert.equal(report.title, "Workflow Map Test");
  assert.equal(report.currentStage, "Package selected");
  assert.match(report.currentBlocker, /research-pack\.md/);
  assert.deepEqual(report.existingArtifacts, ["selected-package.json"]);
  assert.deepEqual(report.missingArtifacts, ["research-pack.md"]);
  assert.equal(report.safety.readOnly, true);
  assert.equal(report.safety.packageRunFilesWritten, false);
  assert.equal(report.safety.approvalMarkersAdded, false);
  assert.equal(report.safety.gitActionsPerformed, false);
  assert.equal(report.safety.mediaMutated, false);

  const packageGate = report.gates.find((gate) => gate.id === "package-selection");
  const researchGate = report.gates.find((gate) => gate.id === "research");
  assert.equal(packageGate.status, "complete");
  assert.deepEqual(packageGate.expectedArtifacts, ["selected-package.json or selected-package.md"]);
  assert.deepEqual(packageGate.existingArtifacts, ["selected-package.json"]);
  assert.equal(researchGate.status, "current-blocked");
  assert.deepEqual(researchGate.missingArtifacts, [
    "research-pack.md",
    "research-evidence.md or source-support-map.md or proof-capture-plan.md or research-objections.md",
  ]);
  assert.equal(typeof report.nextSafeHumanAction.label, "string");
});

test("package run workflow map separates existing artifacts from blocked gate readiness", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-workflow-map-stage4-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-workflow-map-stage4");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Stage 4 Map" } }), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "production-plan.md"),
    "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n",
    "utf8"
  );

  const report = packageRunWorkflowMapScript.buildWorkflowMap(path.relative(tempRoot, runDir), { repoRoot: tempRoot });
  const productionGate = report.gates.find((gate) => gate.id === "production-plan");
  const shotEditGate = report.gates.find((gate) => gate.id === "shot-edit-plan-review");

  assert.equal(report.currentStage, "Needs shot/edit plan review");
  assert.match(report.currentBlocker, /shot-edit-plan-review\.md is missing/);
  assert.deepEqual(report.missingArtifacts, ["shot-edit-plan-review.md"]);
  assert.equal(productionGate.status, "complete");
  assert.deepEqual(productionGate.existingArtifacts, ["production-plan.md"]);
  assert.equal(shotEditGate.status, "current-blocked");
  assert.deepEqual(shotEditGate.missingArtifacts, ["shot-edit-plan-review.md"]);
  assert.equal(report.nextSafeHumanAction.writesDurableState, false);
  assert.equal(report.safety.hermesOrProjectStateUpdated, false);
});

test("package run workflow map error json is parseable", () => {
  const output = captureConsole(() => packageRunWorkflowMapScript.main(["package-runs/not-real"]));
  const parsed = JSON.parse(output.stdout.join("\n"));

  assert.equal(output.result, 1);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.externalApisCalled, false);
  assert.match(parsed.error, /Package run folder not found/);
});

test("verify script checks package run workflow map syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/package-run-workflow-map\.js/);
});

test("verify script checks package run capture gap syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/package-run-capture-gap\.js/);
});

test("next safe action helper is read-only and reports selected stills without Kling videos", () => {
  const fixture = createNextSafeActionFixture();
  const beforeManifest = fs.readFileSync(fixture.manifestPath, "utf8");
  const report = packageRunNextSafeActionScript.buildNextSafeAction(fixture.runId, { repoRoot: fixture.tempRoot });
  const afterManifest = fs.readFileSync(fixture.manifestPath, "utf8");

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.facts.externalApisCalled, false);
  assert.equal(report.facts.writesPackageRunState, false);
  assert.equal(report.facts.writesManifest, false);
  assert.equal(report.facts.writesMedia, false);
  assert.equal(beforeManifest, afterManifest);
  assert.equal(fs.existsSync(path.join(fixture.runDir, "package-run-state.md")), false);
  assert.equal(report.stage, "Capture / b-roll candidate creation");
  assert.match(report.nextHumanAction, /Create Kling b-roll candidates/);
  assert.match(report.nextHumanAction, /move MP4s to the approved VIDNAS folder/);
  assert.match(report.blockedUntil, /Kling video candidates exist on VIDNAS/);
  assert.equal(report.facts.selectedStillCount, 3);
  assert.equal(report.facts.approvedCount, 0);
  assert.equal(report.facts.productionReadyCount, 0);
});

test("next safe action helper sends Kling videos without Resolve evidence to timeline testing", () => {
  const fixture = createNextSafeActionFixture({ klingVideos: true });
  const report = packageRunNextSafeActionScript.buildNextSafeAction(fixture.runId, { repoRoot: fixture.tempRoot });

  assert.equal(report.stage, "Resolve timeline test");
  assert.match(report.nextHumanAction, /DaVinci Resolve/);
  assert.match(report.nextHumanAction, /test whether the motion works in the timeline/);
  assert.equal(report.facts.klingVideoCount, 1);
  assert.equal(report.facts.resolveTestRecorded, false);
});

test("next safe action helper guides a brand-new run to package selection without readiness language", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-safe-action-missing-"));
  const runId = "2026-05-06-ai-video-proof-plan";
  fs.mkdirSync(path.join(tempRoot, "package-runs", runId), { recursive: true });
  const report = packageRunNextSafeActionScript.buildNextSafeAction(runId, { repoRoot: tempRoot });
  const actionText = [report.stage, report.nextHumanAction, report.blockedUntil].join(" ");

  // A run with no artifacts is at the front of the pipeline, not "blocked on a
  // missing image-gen manifest". It must point to package selection (Step 1),
  // never to image prompts / B-roll generation.
  assert.equal(report.stage, "Package selection");
  assert.match(report.nextHumanAction, /package candidates/i);
  assert.match(report.blockedUntil, /selected-package\.json exists/i);
  assert.doesNotMatch(actionText, /generation-manifest/i);
  assert.doesNotMatch(actionText, /production-ready/i);
  assert.doesNotMatch(actionText, /ready to publish/i);
  assert.doesNotMatch(actionText, /publish ready/i);
});

test("next safe action helper walks the front half by artifact (selected -> outline -> script -> image prompts)", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-safe-action-front-"));
  const runId = "2026-05-06-ai-video-proof-plan";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const stageOf = () => packageRunNextSafeActionScript.buildNextSafeAction(runId, { repoRoot: tempRoot }).stage;

  fs.writeFileSync(path.join(runDir, "selected-package.json"), "{}\n", "utf8");
  assert.equal(stageOf(), "Research and outline");

  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Outline\n", "utf8");
  assert.equal(stageOf(), "Script");

  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Script\n", "utf8");
  assert.equal(stageOf(), "Claims check, packaging, image prompts");
});

test("next safe action helper defers to the package-run lifecycle when selected-package.md exists without JSON", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-safe-action-md-"));
  const runId = "2026-06-28-stop-writing-your-shorts-like-blog-posts";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  // Lifecycle / vertical run shape: markdown package selection plus later
  // artifacts, but NO selected-package.json. This is exactly the run that used
  // to be misreported as "Package selection" because the front-half tree only
  // looked for selected-package.json.
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\nPackage run state: active\n", "utf8");
  fs.writeFileSync(path.join(runDir, "selected-package.md"), "# Selected Package\n\n- Proposed title: Stop Writing Your Shorts Like Blog Posts\n", "utf8");
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n", "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n", "utf8");

  const report = packageRunNextSafeActionScript.buildNextSafeAction(runId, { repoRoot: tempRoot });

  // Must NOT regress to package selection, and must be flagged as lifecycle-managed
  // (i.e. delegated to the doctor) rather than re-derived by the AIGEN front-half.
  assert.notEqual(report.stage, "Package selection");
  assert.equal(report.lifecycleManaged, true);
  assert.doesNotMatch(
    [report.stage, report.nextHumanAction, report.blockedUntil].join(" "),
    /selected-package\.json exists/i
  );
});

test("next safe action helper hands off to image generation once image-prompts.json exists", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "next-safe-action-handoff-"));
  const runId = "2026-05-06-ai-video-proof-plan";
  const runDir = path.join(tempRoot, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "selected-package.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Outline\n", "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Script\n", "utf8");
  fs.writeFileSync(path.join(runDir, "image-prompts.json"), "[]\n", "utf8");

  const report = packageRunNextSafeActionScript.buildNextSafeAction(runId, { repoRoot: tempRoot });
  // image-prompts.json present but no manifest yet -> back-half entry message.
  assert.match(report.blockedUntil, /generation-manifest\.json is readable/i);
});

test("next safe action helper forbids approval publish and production_ready automation", () => {
  const fixture = createNextSafeActionFixture({ klingVideos: true });
  const report = packageRunNextSafeActionScript.buildNextSafeAction(fixture.runId, { repoRoot: fixture.tempRoot });
  const forbidden = report.forbiddenActions.join("\n");

  assert.match(forbidden, /mark approved/);
  assert.match(forbidden, /mark production_ready/);
  assert.match(forbidden, /publish/);
  assert.match(forbidden, /operate Kling automatically/);
  assert.match(forbidden, /operate Resolve automatically/);
});

test("verify script checks package run next safe action syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/package-run-next-safe-action\.js/);
});

test("next task classifier does not recommend completed prompt basis work", () => {
  const fixture = createNextTaskClassifierFixture();
  const report = nextTaskClassifierScript.buildReport({
    repoRoot: fixture.tempRoot,
    agentBusRoot: fixture.agentBusRoot,
  });

  assert.equal(report.knownWork.codexPromptBasisDone, true);
  assert.doesNotMatch(report.recommendedNextAction, /prompt[- ]basis/i);
  assert.match(report.whatNotToDoYet.join("\n"), /prompt-basis work; it already exists/);
});

test("next task classifier keeps NEEDS PICKUPS out of second-cut ready state", () => {
  const fixture = createNextTaskClassifierFixture();
  const report = nextTaskClassifierScript.buildReport({
    repoRoot: fixture.tempRoot,
    agentBusRoot: fixture.agentBusRoot,
  });
  const output = nextTaskClassifierScript.renderMarkdown(report);

  assert.equal(report.activeRun.roughCutStatus, "NEEDS PICKUPS");
  assert.equal(report.activeRun.secondCutReady, false);
  assert.equal(report.nextActionType, "manual production");
  assert.match(report.recommendedNextAction, /manual Resolve pickup\/edit\/watchdown work/);
  assert.doesNotMatch(report.recommendedNextAction, /second-cut approval/i);
  assert.match(output, /Second-cut ready: no/);
});

test("next task classifier reports untracked artifacts without mutating them", () => {
  const fixture = createNextTaskClassifierFixture();
  const untrackedPath = path.join(fixture.tempRoot, "reports", "local-untracked-report.md");
  const before = fs.existsSync(untrackedPath);
  const report = nextTaskClassifierScript.buildReport({
    repoRoot: fixture.tempRoot,
    agentBusRoot: fixture.agentBusRoot,
  });
  const after = fs.existsSync(untrackedPath);

  assert.equal(before, true);
  assert.equal(after, true);
  assert.equal(report.untrackedWarning.count, 1);
  assert.deepEqual(report.repoStatus.untrackedPaths, ["reports/local-untracked-report.md"]);
});

test("next task classifier output includes what not to do yet", () => {
  const fixture = createNextTaskClassifierFixture();
  const report = nextTaskClassifierScript.buildReport({
    repoRoot: fixture.tempRoot,
    agentBusRoot: fixture.agentBusRoot,
  });
  const output = nextTaskClassifierScript.renderMarkdown(report);

  assert.match(output, /## What Not To Do Yet/);
  assert.match(output, /Do not recommend second-cut approval while rough-cut status is NEEDS PICKUPS/);
});

test("verify script checks next task classifier syntax", () => {
  const verify = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify.sh"), "utf8");
  assert.match(verify, /node --check scripts\/next-task-classifier\.js/);
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

test("rough cut review stdout parser reports result fields", () => {
  const parsed = packageEngineServer.parseRoughCutReviewStdout([
    "rough-cut review: NEEDS PICKUPS",
    "second-cut ready: no",
    "reason: Watch notes list pickups needed.",
    "unchanged: package-runs/2026-05-17-run/rough-cut-review.md",
    "created: package-runs/2026-05-17-run/pickup-list.md",
    "overwritten: package-runs/2026-05-17-run/edit-fix-list.md",
  ].join("\n"));

  assert.equal(parsed.roughCutReviewStatus, "NEEDS PICKUPS");
  assert.equal(parsed.secondCutReady, false);
  assert.equal(parsed.reason, "Watch notes list pickups needed.");
  assert.equal(parsed.pickupListStatus, "created");
  assert.equal(parsed.editFixListStatus, "overwritten");
});

test("episode factory normalizeViewMode defaults invalid values to focused", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const match = source.match(/function normalizeViewMode\(mode\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "normalizeViewMode function should exist");
  const normalizeViewMode = new Function("mode", match[1]);

  assert.equal(normalizeViewMode(), "focused");
  assert.equal(normalizeViewMode("unexpected"), "focused");
  assert.equal(normalizeViewMode("focused"), "focused");
  assert.equal(normalizeViewMode("full"), "full");
});

test("episode factory focused view defers full dashboard and admin groups", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

  assert.match(html, /data-view-group="weekly" data-view-default="full"/);
  assert.match(html, /data-view-group="board" data-view-default="full"/);
  assert.match(html, /data-view-group="diagnostics" data-view-default="full"/);
  assert.match(html, /data-view-group="exports" data-view-default="full"/);
  assert.match(html, /data-view-group="admin" data-view-default="full"/);
  assert.match(html, /data-view-group="queue" data-view-default="focused"/);
  assert.match(html, /data-view-group="detail" data-view-default="focused"/);
  assert.match(css, /body\[data-episode-view-mode="focused"\] \[data-view-default="full"\] \{\s*display: none;/);
  assert.match(css, /body\[data-episode-view-mode="focused"\] #appStatus\[data-view-warning="true"\] \{\s*display: grid;/);
});

test("script image assets dry run default output root matches approved VIDNAS path", () => {
  assert.equal(
    scriptImageAssetsDryRunScript.DEFAULT_OUTPUT_ROOT,
    "/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-image-assets/"
  );
});

test("script image assets dry run detects markdown headline and builds 3-sentence blocks", () => {
  const input = [
    "---",
    "title: Stop Planning AI Videos Until You Have a Proof Plan",
    "---",
    "",
    "This is sentence one.",
    "This is sentence two.",
    "This is sentence three.",
    "This is sentence four.",
    "This is sentence five.",
  ].join("\n");
  const plan = scriptImageAssetsDryRunScript.buildPlan(
    {
      stdin: true,
      inputPath: "",
      headline: "",
      outputRoot: path.join(os.tmpdir(), "script-image-assets-test-root"),
      outputFolder: "",
    },
    input,
    new Date("2026-05-20T12:00:00Z")
  );
  const blocks = JSON.parse(plan.artifacts["script-blocks.json"]);
  const prompts = JSON.parse(plan.artifacts["image-prompts.json"]);
  const manifest = JSON.parse(plan.artifacts["generation-manifest.json"]);

  assert.equal(plan.headline, "Stop Planning AI Videos Until You Have a Proof Plan");
  assert.equal(plan.slug, "Stop_Planning_AI_Videos_Until_You_Have_A_Proof_Plan");
  assert.equal(blocks.sentence_count, 5);
  assert.equal(blocks.block_count, 2);
  assert.equal(blocks.blocks[0].block_id, "block-001");
  assert.equal(blocks.blocks[1].block_id, "block-002");
  assert.equal(prompts.prompts.length, 8);
  assert.equal(manifest.image_generation_enabled, false);
  assert.equal(manifest.items[0].output_filename, "block-001-prompt-01.png");
  assert.equal(manifest.items[0].generation_status, "not_started");
  assert.equal(manifest.items[0].reviewed_by_mikko, false);
  assert.equal(manifest.items[0].approved, false);
  assert.equal(manifest.items[0].selected, false);
  assert.equal(manifest.items[0].production_ready, false);
});

test("script image assets dry run prefers working title and script body over Episode Factory metadata", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "script-image-assets-episode-factory-"));
  const outputRoot = path.join(tempRoot, "assets");
  const input = [
    "# Final Script",
    "",
    "Run: 2026-05-06-ai-video-proof-plan",
    "Status: Revised script ready for review.",
    "Source: package-run metadata.",
    "",
    "## Working Title",
    "",
    "Stop Planning AI Videos Until You Have a Proof Plan",
    "",
    "## Script",
    "",
    "### Hook",
    "",
    "Most AI video projects fail before generation starts.",
    "The problem is not the model.",
    "The problem is that nobody decided what proof the video needs.",
    "",
    "### Main",
    "",
    "A proof plan turns vague production into a testable workflow.",
  ].join("\n");

  const plan = scriptImageAssetsDryRunScript.buildPlan(
    {
      stdin: true,
      inputPath: "",
      headline: "",
      outputRoot,
      outputFolder: "",
    },
    input,
    new Date("2026-05-20T12:00:00Z")
  );
  const blocks = JSON.parse(plan.artifacts["script-blocks.json"]);

  assert.equal(plan.headline, "Stop Planning AI Videos Until You Have a Proof Plan");
  assert.equal(plan.slug, "Stop_Planning_AI_Videos_Until_You_Have_A_Proof_Plan");
  assert.equal(blocks.sentence_count, 4);
  assert.equal(blocks.blocks[0].text, "Most AI video projects fail before generation starts. The problem is not the model. The problem is that nobody decided what proof the video needs.");
  assert.equal(blocks.blocks[0].text.includes("Run:"), false);
  assert.equal(blocks.blocks[0].text.includes("Status:"), false);
  assert.equal(blocks.blocks[0].text.includes("Source:"), false);
  assert.equal(blocks.blocks[0].text.includes("Hook"), false);
  assert.equal(blocks.blocks[0].text.includes("Main"), false);
  assert.equal(fs.existsSync(plan.outputFolder), false);
});

test("script image assets dry run explicit headline overrides detected title while script body extraction remains", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "script-image-assets-explicit-headline-"));
  const outputRoot = path.join(tempRoot, "assets");
  const input = [
    "# Final Script",
    "",
    "## Working Title",
    "Detected Working Title",
    "",
    "## Script",
    "",
    "### Hook",
    "Actual sentence one.",
    "Actual sentence two.",
    "Actual sentence three.",
  ].join("\n");

  const plan = scriptImageAssetsDryRunScript.buildPlan(
    {
      stdin: true,
      inputPath: "",
      headline: "Explicit Operator Title",
      outputRoot,
      outputFolder: "",
    },
    input,
    new Date("2026-05-20T12:00:00Z")
  );
  const blocks = JSON.parse(plan.artifacts["script-blocks.json"]);

  assert.equal(plan.headline, "Explicit Operator Title");
  assert.equal(plan.slug, "Explicit_Operator_Title");
  assert.equal(blocks.blocks[0].text, "Actual sentence one. Actual sentence two. Actual sentence three.");
  assert.equal(blocks.blocks[0].text.includes("Detected Working Title"), false);
  assert.equal(fs.existsSync(plan.outputFolder), false);
});

test("script image assets dry run script section stops before higher-level following headings", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "script-image-assets-section-boundary-"));
  const outputRoot = path.join(tempRoot, "assets");
  const input = [
    "# Final Script",
    "",
    "## Working Title",
    "Boundary Test Title",
    "",
    "## Script",
    "",
    "Script sentence one.",
    "Script sentence two.",
    "Script sentence three.",
    "",
    "# Appendix",
    "",
    "Appendix sentence should not become narration.",
  ].join("\n");

  const plan = scriptImageAssetsDryRunScript.buildPlan(
    {
      stdin: true,
      inputPath: "",
      headline: "",
      outputRoot,
      outputFolder: "",
    },
    input,
    new Date("2026-05-20T12:00:00Z")
  );
  const blocks = JSON.parse(plan.artifacts["script-blocks.json"]);

  assert.equal(blocks.sentence_count, 3);
  assert.equal(blocks.blocks[0].text, "Script sentence one. Script sentence two. Script sentence three.");
  assert.equal(blocks.blocks[0].text.includes("Appendix"), false);
  assert.equal(fs.existsSync(plan.outputFolder), false);
});

test("script image assets dry run previews without writing files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "script-image-assets-dry-run-preview-"));
  const outputRoot = path.join(tempRoot, "assets");
  const input = "One sentence. Two sentence. Three sentence. Four sentence.";
  const plan = scriptImageAssetsDryRunScript.buildPlan(
    {
      stdin: true,
      inputPath: "",
      headline: "Dry Run Preview",
      outputRoot,
      outputFolder: "",
    },
    input,
    new Date("2026-05-20T12:00:00Z")
  );

  assert.equal(plan.artifacts.summary.blockCount, 2);
  assert.equal(plan.artifacts.summary.promptCount, 8);
  assert.equal(fs.existsSync(path.join(outputRoot, "Dry_Run_Preview")), false);
});

test("script image assets artifact writing uses tmp root and refuses overwrite", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "script-image-assets-write-"));
  const outputRoot = path.join(tempRoot, "assets");
  const outputFolder = path.join(outputRoot, "Safe_Test_Headline");
  const input = "One sentence. Two sentence. Three sentence. Four sentence.";
  const plan = scriptImageAssetsDryRunScript.buildPlan(
    {
      stdin: true,
      inputPath: "",
      headline: "Safe Test Headline",
      outputRoot,
      outputFolder: "",
    },
    input,
    new Date("2026-05-20T12:00:00Z")
  );

  scriptImageAssetsDryRunScript.writeArtifacts(plan.outputFolder, plan.artifacts);

  assert.equal(fs.existsSync(outputFolder), true);
  scriptImageAssetsDryRunScript.ARTIFACT_FILENAMES.forEach((filename) => {
    assert.equal(fs.existsSync(path.join(outputFolder, filename)), true);
  });
  assert.throws(
    () => scriptImageAssetsDryRunScript.writeArtifacts(plan.outputFolder, plan.artifacts),
    /Target folder already exists/
  );
  assert.equal(fs.existsSync(path.join(outputFolder, "block-001-prompt-01.png")), false);
});

test("script image assets review page builds read-only prompt review data", () => {
  const artifacts = {
    inputFolder: "/tmp/script-image-assets-review-fixture",
    scriptBlocks: {
      headline: "Review Headline",
      source: { source_type: "markdown_file", source_path: "/tmp/final-script.md" },
      block_count: 1,
      blocks: [
        {
          block_id: "block-001",
          sentence_start: 1,
          sentence_end: 3,
          text: "Block text for review.",
        },
      ],
    },
    imagePrompts: {
      headline: "Review Headline",
      prompts: [1, 2, 3, 4].map((promptNumber) => ({
        block_id: "block-001",
        prompt_number: promptNumber,
        prompt_id: `block-001-prompt-0${promptNumber}`,
        prompt_type: `type-${promptNumber}`,
        full_prompt: `Full prompt ${promptNumber} <candidate>`,
      })),
    },
    manifest: {
      image_generation_enabled: false,
      items: [1, 2, 3, 4].map((promptNumber) => ({
        prompt_id: `block-001-prompt-0${promptNumber}`,
        generation_status: "not_started",
        reviewed_by_mikko: false,
        approved: false,
        selected: false,
        production_ready: false,
      })),
    },
  };

  const data = scriptImageAssetsReviewPageScript.buildReviewData(artifacts);
  const html = scriptImageAssetsReviewPageScript.renderHtml(data);

  assert.equal(data.headline, "Review Headline");
  assert.equal(data.blockCount, 1);
  assert.equal(data.promptCount, 4);
  assert.equal(data.expectedPromptCount, 4);
  assert.equal(data.manifestSummary.imageGenerationEnabled, false);
  assert.deepEqual(data.manifestSummary.generationStatuses, ["not_started"]);
  assert.deepEqual(data.warnings, []);
  assert.match(html, /All prompts shown here are candidates only/);
  assert.match(html, /manifest: not_started/);
  assert.match(html, /Full prompt 1 &lt;candidate&gt;/);
  assert.doesNotMatch(html, /<candidate>/);
});

test("script image assets review page writes standalone html without touching input artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "script-image-assets-review-page-"));
  const inputFolder = path.join(tempRoot, "input");
  const outputPath = path.join(tempRoot, "report", "review.html");
  fs.mkdirSync(inputFolder, { recursive: true });
  writeTestFile(
    inputFolder,
    "script-blocks.json",
    JSON.stringify({
      headline: "Standalone Review",
      source: { source_type: "markdown_file", source_path: "/tmp/source.md" },
      block_count: 1,
      blocks: [{ block_id: "block-001", sentence_start: 1, sentence_end: 1, text: "One block." }],
    })
  );
  writeTestFile(
    inputFolder,
    "image-prompts.json",
    JSON.stringify({
      headline: "Standalone Review",
      prompts: [1, 2, 3, 4].map((promptNumber) => ({
        block_id: "block-001",
        prompt_number: promptNumber,
        prompt_id: `block-001-prompt-0${promptNumber}`,
        prompt_type: `type-${promptNumber}`,
        full_prompt: `Prompt ${promptNumber}`,
      })),
    })
  );
  writeTestFile(
    inputFolder,
    "generation-manifest.json",
    JSON.stringify({
      image_generation_enabled: false,
      items: [1, 2, 3, 4].map((promptNumber) => ({
        prompt_id: `block-001-prompt-0${promptNumber}`,
        generation_status: "not_started",
        reviewed_by_mikko: false,
        approved: false,
        selected: false,
        production_ready: false,
      })),
    })
  );
  const beforeManifest = fs.readFileSync(path.join(inputFolder, "generation-manifest.json"), "utf8");

  const output = captureConsole(() =>
    scriptImageAssetsReviewPageScript.main(["--input-folder", inputFolder, "--output", outputPath])
  );

  assert.equal(output.result, 0);
  assert.equal(fs.existsSync(outputPath), true);
  assert.match(fs.readFileSync(outputPath, "utf8"), /Standalone Review/);
  assert.equal(fs.readFileSync(path.join(inputFolder, "generation-manifest.json"), "utf8"), beforeManifest);
  assert.equal(fs.existsSync(path.join(inputFolder, "block-001-prompt-01.png")), false);
});

function writeNewsletterRun(runDir, { full = true } = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  if (full) {
    fs.writeFileSync(
      path.join(runDir, "publish-pack.md"),
      [
        "# Publish Pack",
        "",
        "- Final title: Fix Flat DaVinci Resolve Exports",
        "- Description: Stop your exports looking washed out by checking color management first.",
        "- Newsletter CTA: Reply with the camera format you shoot on.",
        "- YouTube URL: https://youtu.be/abc123",
        "- Lead magnet: https://vidtoolz.example/checklist",
        "",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(runDir, "repurposing-plan.md"),
      [
        "# Repurposing Plan",
        "",
        "## YouTube Community or Newsletter Teaser",
        "",
        "This month I finally fixed the flat-export problem and it took one setting.",
        "",
      ].join("\n")
    );
  }
}

test("newsletter help works", () => {
  const output = captureConsole(() => packageNewsletterScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /package-run-newsletter\.js/);
});

test("newsletter drafts a ready issue from package fields without external APIs", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-newsletter-ready-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-newsletter-ready");
  writeNewsletterRun(runDir, { full: true });

  assert.equal(packageNewsletterScript.main([runDir]), 0);

  const draft = fs.readFileSync(path.join(runDir, "newsletter-draft.md"), "utf8");
  const review = fs.readFileSync(path.join(runDir, "newsletter-review.md"), "utf8");

  assert.match(review, /Status: DRAFT READY/);
  assert.match(review, /Draftable: yes/);
  assert.match(draft, /Fix Flat DaVinci Resolve Exports/);
  assert.match(draft, /finally fixed the flat-export problem/);
  assert.match(draft, /https:\/\/youtu\.be\/abc123/);
  assert.doesNotMatch(draft, /\{\{VIDEO_URL\}\}/);
  // Copy-only boundary: both artifacts must declare no external API use.
  assert.match(draft, /External APIs called: no/);
  assert.match(review, /does not call the Kit API/);
});

test("newsletter reports NEEDS CONTENT and a video-url placeholder for an empty run", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-newsletter-empty-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-newsletter-empty");
  writeNewsletterRun(runDir, { full: false });

  assert.equal(packageNewsletterScript.main([runDir]), 0);

  const draft = fs.readFileSync(path.join(runDir, "newsletter-draft.md"), "utf8");
  const review = fs.readFileSync(path.join(runDir, "newsletter-review.md"), "utf8");

  assert.match(review, /Status: NEEDS CONTENT/);
  assert.match(review, /Draftable: no/);
  assert.match(review, /title is missing/);
  assert.match(draft, /TODO: subject line/);
  assert.match(draft, /\{\{VIDEO_URL\}\}/);
});

test("newsletter writes are idempotent without overwrite", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-newsletter-idem-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-10-newsletter-idem");
  writeNewsletterRun(runDir, { full: true });

  assert.equal(packageNewsletterScript.main([runDir]), 0);
  const firstDraft = fs.readFileSync(path.join(runDir, "newsletter-draft.md"), "utf8");

  const second = captureConsole(() => packageNewsletterScript.main([runDir]));
  assert.equal(second.result, 0);
  assert.match(second.stdout.join("\n"), /unchanged: .*newsletter-draft\.md/);
  assert.equal(fs.readFileSync(path.join(runDir, "newsletter-draft.md"), "utf8"), firstDraft);
});

test("newsletter reads the real publish-pack format and does not leak the next heading into empty fields", () => {
  // Mirrors the real publish-pack.md shape: backtick-wrapped "Working title",
  // an EMPTY "Pinned comment:" immediately followed by a "## Chapters" heading.
  // The same-line extractor must read the title and leave the empty field empty
  // (not capture "## Chapters").
  const publishPack = [
    "# Publish Pack",
    "",
    "## Video Metadata Draft",
    "",
    "- Working title: `Stop Planning AI Videos Until You Have a Proof Plan`",
    "- Description draft:",
    "- Pinned comment:",
    "",
    "## Chapters",
    "",
    "00:00 Hook",
  ].join("\n");

  const fields = packageNewsletterScript.readNewsletterFields({ "publish-pack.md": publishPack });

  assert.equal(fields.title, "Stop Planning AI Videos Until You Have a Proof Plan");
  assert.equal(fields.pinnedComment, "");
  assert.equal(fields.description, "");
});
