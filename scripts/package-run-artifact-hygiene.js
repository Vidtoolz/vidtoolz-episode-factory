#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  return `Package Run Artifact Hygiene

Usage:
  node scripts/package-run-artifact-hygiene.js package-runs/YYYY-MM-DD-topic-slug
  node scripts/package-run-artifact-hygiene.js package-runs/YYYY-MM-DD-topic-slug --json
  node scripts/package-run-artifact-hygiene.js --help

Read-only local inspection for untracked package-run artifacts. No files are
created, modified, staged, deleted, moved, committed, pushed, uploaded, archived,
published, or sent to external APIs.`;
}

function parseArgs(argv = []) {
  const result = {
    runDir: "",
    json: false,
    help: false,
  };
  argv.forEach((arg) => {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--json") result.json = true;
    else if (!result.runDir) result.runDir = arg;
  });
  return result;
}

function normalizeRelative(filePath = "") {
  return String(filePath || "").replace(/\\/g, "/");
}

function runGit(repoRoot, args) {
  return childProcess.execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listUntracked(repoRoot, pathspec = "") {
  const args = ["ls-files", "--others", "--exclude-standard"];
  if (pathspec) args.push("--", pathspec);
  return runGit(repoRoot, args)
    .split(/\r?\n/)
    .map((line) => normalizeRelative(line.trim()))
    .filter(Boolean)
    .sort();
}

function readIfFile(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function getRunState(repoRoot, runRel) {
  const productionPlan = readIfFile(path.join(repoRoot, runRel, "production-plan.md"));
  const captureReview = readIfFile(path.join(repoRoot, runRel, "capture-evidence-review.md"));
  const notReadyToShoot = /Shoot-readiness status:\s*NOT READY TO SHOOT/i.test(productionPlan) || /NOT READY TO SHOOT/i.test(productionPlan);
  const readyToShoot = /Shoot-readiness status:\s*READY TO SHOOT/i.test(productionPlan) && !notReadyToShoot;
  const captureAccepted =
    /Capture evidence accepted:\s*yes/i.test(captureReview) ||
    /captureEvidenceAccepted:\s*true/i.test(captureReview) ||
    /CAPTURE EVIDENCE ACCEPTED/i.test(captureReview);
  return {
    readyToShoot,
    notReadyToShoot,
    captureEvidenceAccepted: captureAccepted,
  };
}

function includesTmpMatch(fileRel, runId) {
  const base = path.basename(fileRel).toLowerCase();
  const slug = String(runId || "").toLowerCase();
  return (
    /^tmp[-_].*\.(js|mjs|cjs|sh|log|txt|md)$/.test(base) &&
    (base.includes(slug) || base.includes("may2") || base.includes("may-2"))
  );
}

function isPackageRunPath(repoRoot, runDirInput) {
  const runAbs = path.resolve(repoRoot, runDirInput || "");
  const packageRunsAbs = path.resolve(repoRoot, "package-runs");
  return runAbs.startsWith(`${packageRunsAbs}${path.sep}`);
}

function hasNegativeBlockingLanguage(content) {
  return /NOT APPROVED|\bno\b|BLOCKED|DRAFT ONLY|not accepted|not final|no accepted final cut|keep blocked|accepted:\s*no|approved:\s*no|ready(?: for [^:\n]+)?:\s*no|publish ready:\s*no|ready to upload:\s*no|ready to schedule:\s*no|ready to archive:\s*no/i.test(
    String(content || "")
  );
}

function hasDummyEvidenceReference(content) {
  return /dummy|smoke-test|test-capture|test-screen|test-voiceover|Verified in existing capture artifacts|media\/test-|recordings\/test-|audio\/test-|generated evidence|generated checklist row/i.test(
    String(content || "")
  );
}

function isCaptureOrReadinessContext(filename, content) {
  const name = path.basename(filename).toLowerCase();
  return /capture|takes-log|shot-list|screen-recording|audio|evidence|readiness/.test(name) || /capture|captured|readiness|evidence/i.test(content);
}

function hasDirectPositiveProductionClaim(content) {
  return /READY FOR HUMAN APPROVAL|READY FOR ROUGH CUT|READY TO UPLOAD|READY TO PUBLISH|READY TO SCHEDULE|READY TO ARCHIVE|READY TO CUT SHORTS|Capture readiness approved|Capture approval:\s*PASS|Production approval:\s*PASS|Mikko production approval:\s*yes|Capture evidence accepted:\s*yes|Publish ready:\s*yes|Ready to upload:\s*yes|Ready to schedule:\s*yes|Ready to archive:\s*yes/i.test(
    String(content || "")
  );
}

function hasMisleadingMarker(filename, content, runState) {
  const text = String(content || "");
  const lowerName = path.basename(filename).toLowerCase();
  const dummyMarker = hasDummyEvidenceReference(text);
  const captureContext = isCaptureOrReadinessContext(lowerName, text);
  const negativeBlocking = hasNegativeBlockingLanguage(text);

  if (lowerName === "capture-checklist.md" && /READY FOR HUMAN APPROVAL/i.test(text) && !runState.readyToShoot) return true;
  if (lowerName === "takes-log.md" && /Capture readiness approved|Verified in existing capture artifacts/i.test(text) && dummyMarker) return true;
  if (lowerName === "shot-list.md" && /\bcaptured\b/i.test(text) && !runState.captureEvidenceAccepted) return true;
  if (dummyMarker && captureContext) return true;
  if (hasDirectPositiveProductionClaim(text) && !negativeBlocking && (!runState.readyToShoot || !runState.captureEvidenceAccepted)) return true;
  return false;
}

function classifyPath(fileRel, content, runState, options = {}) {
  const filename = path.basename(fileRel).toLowerCase();
  const text = String(content || "");
  const isTemp = Boolean(options.tempScript);

  if (isTemp) {
    return {
      classification: "scratch-temp",
      reason: "Temporary browser/CDP or scratch helper script matched the run slug or May2/may2.",
      recommendedAction: "hold untracked",
    };
  }

  if (hasMisleadingMarker(filename, text, runState)) {
    return {
      classification: "dangerous-or-misleading",
      reason: "Contains a direct positive capture/readiness claim or dummy/generated capture evidence while shoot readiness or accepted capture evidence is not proven.",
      recommendedAction: "review",
    };
  }

  if (/proof|evidence-chain|evidence-review|dashboard-proof|browser-proof|qa-proof|source-support|sufficiency-review/.test(filename)) {
    return {
      classification: "proof",
      reason: "Documents observed proof, QA/research support, dashboard state, or evidence-chain review.",
      recommendedAction: "review",
    };
  }

  if (/rough-cut|final-review|final-watch|export|publish|publication|archive|repurposing|shorts|schedule|delivery|loudness|caption|chapter|pickup|edit-fix|platform-variant|master-file|reusable-clips/.test(filename)) {
    return {
      classification: "downstream-lifecycle-scaffold",
      reason: "Downstream lifecycle artifact exists before upstream gates and accepted capture evidence are proven.",
      recommendedAction: "hold untracked",
    };
  }

  if (/script|selected-package|publish-pack|thumbnail|title|notes|production-plan|creator-qa/.test(filename)) {
    return {
      classification: "draft-package",
      reason: "Package, script, title, thumbnail, QA, or production-planning draft artifact.",
      recommendedAction: "review",
    };
  }

  if (/plan|checklist|shot-list|takes-log|capture|screen-recording|audio|missing-shot|broll|graphics|visual|demo|stock-search|blocker|prompt/.test(filename)) {
    return {
      classification: "planning-scaffold",
      reason: "Planning scaffold that may be useful later but does not prove current readiness.",
      recommendedAction: "hold untracked",
    };
  }

  return {
    classification: "planning-scaffold",
    reason: "Untracked run artifact with no concrete proof or downstream approval signal detected.",
    recommendedAction: "hold untracked",
  };
}

function buildArtifactHygieneReport(runDirInput, options = {}) {
  if (!runDirInput) throw new Error("Package run folder is required.");
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  if (!isPackageRunPath(repoRoot, runDirInput)) throw new Error("Package run folder must resolve under package-runs/.");
  const runRel = normalizeRelative(path.relative(repoRoot, path.resolve(repoRoot, runDirInput)));
  const runId = path.basename(runRel);
  const runState = getRunState(repoRoot, runRel);
  const untrackedFiles = listUntracked(repoRoot, runRel);
  const allUntracked = listUntracked(repoRoot);
  const tempScripts = allUntracked.filter((fileRel) => !fileRel.startsWith(`${runRel}/`) && includesTmpMatch(fileRel, runId));

  const classify = (fileRel, tempScript = false) => {
    const content = readIfFile(path.join(repoRoot, fileRel));
    const result = classifyPath(fileRel, content, runState, { tempScript });
    return {
      file: fileRel,
      classification: result.classification,
      reason: result.reason,
      recommendedAction: result.recommendedAction,
    };
  };

  const classifications = [...untrackedFiles.map((fileRel) => classify(fileRel)), ...tempScripts.map((fileRel) => classify(fileRel, true))];
  const dangerousFiles = classifications.filter((item) => item.classification === "dangerous-or-misleading").map((item) => item.file);

  return {
    runId,
    path: runRel,
    readOnly: true,
    writesPerformed: false,
    externalApisCalled: false,
    untrackedFiles,
    tempScripts,
    untrackedPackageRunFileCount: untrackedFiles.length,
    untrackedTempScriptCount: tempScripts.length,
    classifications,
    dangerousFiles,
    recommendedActions: classifications.map((item) => ({
      file: item.file,
      action: item.recommendedAction,
      reason: item.reason,
    })),
    safety: [
      "read-only: yes",
      "writes performed: no",
      "external APIs called: no",
      "no git add, commit, push, delete, move, clean, reset, approval marker, Hermes update, or project-state update performed",
    ],
  };
}

function renderText(report) {
  const lines = [];
  lines.push("Package Run Artifact Hygiene");
  lines.push(`Run: ${report.runId}`);
  lines.push(`Path: ${report.path}`);
  lines.push(`Untracked package-run files: ${report.untrackedPackageRunFileCount}`);
  lines.push(`Untracked temp scripts: ${report.untrackedTempScriptCount}`);
  lines.push("");
  lines.push("Files:");
  if (report.classifications.length) {
    report.classifications.forEach((item) => {
      lines.push(`- ${item.file} -> ${item.classification} -> ${item.reason}`);
      lines.push(`  Recommended action: ${item.recommendedAction}`);
    });
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Dangerous or misleading files:");
  if (report.dangerousFiles.length) report.dangerousFiles.forEach((file) => lines.push(`- ${file}`));
  else lines.push("- none");
  lines.push("");
  lines.push("Safety:");
  report.safety.forEach((item) => lines.push(`- ${item}`));
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    const report = buildArtifactHygieneReport(options.runDir);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(renderText(report));
    return 0;
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            error: error.message,
            readOnly: true,
            writesPerformed: false,
            externalApisCalled: false,
          },
          null,
          2
        )
      );
    }
    else {
      console.error(error.message);
      console.error("");
      console.error(usage());
    }
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  usage,
  parseArgs,
  buildArtifactHygieneReport,
  renderText,
  main,
};
