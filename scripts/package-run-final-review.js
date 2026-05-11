#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-final-review.js";
const FINAL_WATCH_NOTES_FILE = "final-watch-notes.md";
const FINAL_REVIEW_FILE = "final-review.md";
const PUBLICATION_BLOCKERS_FILE = "publication-blockers.md";
const TARGET_FILES = [FINAL_WATCH_NOTES_FILE, FINAL_REVIEW_FILE, PUBLICATION_BLOCKERS_FILE];

function usage() {
  return [
    "Usage: node scripts/package-run-final-review.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-final-review.js --help",
  ].join("\n");
}

function parseArgs(argv) {
  const args = [...argv];
  const result = { runFolder: "", overwrite: false, help: false };
  while (args.length) {
    const item = args.shift();
    if (item === "--overwrite" || item === "--force") {
      result.overwrite = true;
    } else if (item === "--help" || item === "-h") {
      result.help = true;
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }
  return result;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalFile(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function lineValue(markdown, label) {
  return productionPlan.lineValue(markdown, label);
}

function sectionText(markdown, heading) {
  return researchPack.sectionText(String(markdown || ""), heading);
}

function normalizeLine(line) {
  return cleanString(String(line || "").replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/\[[ xX]\]\s*/, ""));
}

function sectionItems(markdown, headings) {
  const values = [];
  headings.forEach((heading) => {
    const body = sectionText(markdown, heading);
    body.split(/\r?\n/).forEach((line) => {
      const item = normalizeLine(line);
      if (!item) return;
      if (/^(todo|n\/a|none|no|not applicable|leave blank)/i.test(item)) return;
      values.push(item);
    });
  });
  return [...new Set(values)];
}

function hasExactApprovalMarker(...texts) {
  return texts.some((text) =>
    /^(?:[-*]\s*)?(?:Manual approval|Final-watch approval|Final approval):\s*PASS\s*$/im.test(String(text || ""))
  );
}

function buildFinalWatchNotesTemplate(runId) {
  return `# Final-Watch Notes

- Run: ${runId}
- Tool: ${TOOL_NAME}
- Status: starter template
- External APIs called: no

## Final Version Reviewed

TODO

## Watch Date

TODO

## Reviewer

TODO

## Final-Watch Issues

TODO

## Publication Blockers

TODO

## Final Approval Marker

Leave blank unless approved after a real final watch.

`;
}

function isStarterFinalWatchNotes(markdown = "") {
  const text = String(markdown || "");
  if (!text) return true;
  if (/^(?:[-*]\s*)?Status:\s*starter template\s*$/im.test(text)) return true;
  const relevant = ["Final Version Reviewed", "Watch Date", "Reviewer", "Final-Watch Issues", "Publication Blockers"].flatMap((heading) =>
    sectionItems(text, [heading])
  );
  return relevant.length === 0 && !hasExactApprovalMarker(text);
}

function parseRoughCutReview(markdown = "") {
  const text = String(markdown || "");
  if (!text) {
    return {
      status: "MISSING",
      secondCutReady: "no",
      allowsFinalReview: false,
      reason: "rough-cut-review.md is missing.",
    };
  }
  const status = (lineValue(text, "Rough-cut review status") || lineValue(text, "Status") || "MISSING").toUpperCase();
  const secondCutReady = (lineValue(text, "Second-cut ready") || "no").toLowerCase();
  const allowsFinalReview = status === "READY FOR SECOND CUT" && secondCutReady === "yes";
  return {
    status,
    secondCutReady,
    allowsFinalReview,
    reason: allowsFinalReview ? "Rough-cut review allows final review." : `rough-cut-review.md is ${status}, not READY FOR SECOND CUT.`,
  };
}

function readContext(runDir) {
  const roughCutReviewText = readOptionalFile(runDir, "rough-cut-review.md");
  const finalWatchNotesWereMissing = !readOptionalFile(runDir, FINAL_WATCH_NOTES_FILE);
  const finalWatchNotesText =
    readOptionalFile(runDir, FINAL_WATCH_NOTES_FILE) || buildFinalWatchNotesTemplate(path.basename(runDir));
  const roughCut = parseRoughCutReview(roughCutReviewText);
  const finalIssues = sectionItems(finalWatchNotesText, ["Final-Watch Issues", "Publication Blockers"]);

  return {
    runId: path.basename(runDir),
    roughCut,
    finalWatchNotesWereMissing,
    finalWatchNotesText,
    finalWatchNotesAreStarter: isStarterFinalWatchNotes(finalWatchNotesText),
    finalIssues,
    explicitApproval: hasExactApprovalMarker(finalWatchNotesText),
  };
}

function determineFinalReviewStatus(context) {
  const blockers = [];
  const nextActions = [];

  if (!context.roughCut.allowsFinalReview) {
    blockers.push(context.roughCut.reason);
    nextActions.push("Resolve rough-cut review before final review.");
  }
  if (context.finalWatchNotesWereMissing) {
    blockers.push("final-watch-notes.md was missing; starter template created.");
    nextActions.push("Watch the final cut and replace TODO fields with real notes.");
  } else if (context.finalWatchNotesAreStarter) {
    blockers.push("final-watch-notes.md is still a starter template or has no real final-watch notes.");
    nextActions.push("Replace starter placeholders with real final-watch notes.");
  }
  if (context.finalIssues.length) {
    blockers.push("Final-watch notes list unresolved issues.");
    nextActions.push("Resolve listed final-watch issues and review again.");
  }

  if (blockers.length) {
    return {
      status: "BLOCKED",
      publishReady: false,
      reason: [...new Set(blockers)].join(" "),
      nextActions: [...new Set(nextActions)],
    };
  }

  if (context.explicitApproval || (!context.finalWatchNotesAreStarter && !context.finalIssues.length)) {
    return {
      status: "PASS",
      publishReady: true,
      reason: context.explicitApproval
        ? "Exact final-watch approval marker is present and upstream gates allow final review."
        : "Real final-watch notes exist, no final-watch issues were detected, and upstream gates allow final review.",
      nextActions: ["Proceed only within the approved publish scope."],
    };
  }

  return {
    status: "BLOCKED",
    publishReady: false,
    reason: "Final-watch review evidence is insufficient.",
    nextActions: ["Add real final-watch notes after review."],
  };
}

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function finalIssueList(context) {
  if ((context.finalWatchNotesWereMissing || context.finalWatchNotesAreStarter) && !context.finalIssues.length) {
    return "- Not assessed. Real final-watch notes are missing or still a starter template.";
  }
  return markdownList(context.finalIssues, "No final-watch issues detected from real final-watch notes.");
}

function buildFinalReview(context, verdict) {
  return `# Final Review

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Rough-cut review status: ${context.roughCut.status}
- Second-cut ready: ${context.roughCut.secondCutReady}
- Final-watch notes source: ${context.finalWatchNotesWereMissing ? "created starter template" : FINAL_WATCH_NOTES_FILE}
- Final review status: ${verdict.status}
- Publish ready: ${verdict.publishReady ? "yes" : "no"}
- External APIs called: no

## Input Warnings

${markdownList(
  [
    context.roughCut.allowsFinalReview ? "" : context.roughCut.reason,
    context.finalWatchNotesAreStarter ? "Final-watch notes are starter/template notes, not real review evidence." : "",
  ],
  "None."
)}

## Review Boundary

- This tool reviews manual final-watch notes and upstream rough-cut review status.
- It does not analyze video files, publish, upload, archive, create scheduled jobs, or call external APIs.

## Final-Watch Issues

${finalIssueList(context)}

## Publication Blockers

${finalIssueList(context)}

## Final Review Gate

- Status: ${verdict.status}
- Reason: ${verdict.reason}
- Next actions:
${markdownList(verdict.nextActions, "Proceed only within the approved publish scope.")}
`;
}

function publicationBlockerRows(context, verdict) {
  const rows = [];
  if (context.roughCut.status !== "READY FOR SECOND CUT") {
    rows.push([
      `rough-cut-review.md is ${context.roughCut.status}, not READY FOR SECOND CUT`,
      "Final review cannot approve publication while rough-cut review is blocked.",
      "Resolve rough-cut review and regenerate final review.",
      "blocked",
    ]);
  }
  if (context.roughCut.secondCutReady !== "yes") {
    rows.push([
      `Second-cut ready is ${context.roughCut.secondCutReady}`,
      "Publication review requires a second-cut-ready upstream state.",
      "Complete second-cut readiness before final review.",
      "blocked",
    ]);
  }
  if (context.finalWatchNotesWereMissing || context.finalWatchNotesAreStarter) {
    rows.push([
      "final-watch-notes.md is still a starter template or has no real final-watch notes",
      "Final-watch issues are not assessed without real notes.",
      "Add real final-watch notes before publication blockers can be assessed.",
      "blocked",
    ]);
  }
  context.finalIssues.forEach((issue) => {
    rows.push([
      issue,
      "Final-watch notes list this as an unresolved publication issue.",
      "Resolve the issue and re-run final review.",
      "open",
    ]);
  });
  if (!rows.length && verdict.publishReady) {
    rows.push([
      "None.",
      "All final-review gates passed with real final-watch notes.",
      "Keep final approval evidence with the run.",
      "closed",
    ]);
  }
  if (!rows.length) {
    rows.push([
      "Not assessed.",
      "Final-review evidence is incomplete.",
      "Add real final-watch notes and re-run final review.",
      "blocked",
    ]);
  }
  return rows
    .map((row) => `| ${row.map((value) => String(value).replace(/\|/g, "/")).join(" | ")} |`)
    .join("\n");
}

function buildPublicationBlockers(context, verdict) {
  return `# Publication Blockers

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
${publicationBlockerRows(context, verdict)}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const verdict = determineFinalReviewStatus(context);
  return {
    context,
    verdict,
    files: [
      [FINAL_WATCH_NOTES_FILE, context.finalWatchNotesText],
      [FINAL_REVIEW_FILE, buildFinalReview(context, verdict)],
      [PUBLICATION_BLOCKERS_FILE, buildPublicationBlockers(context, verdict)],
    ],
  };
}

function writeOutputs(runDir, outputs, overwrite = false) {
  return outputs.files.map(([filename, content]) => {
    const filePath = path.join(runDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf8");
      return [filename, "created"];
    }
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing === content) return [filename, "unchanged"];
    if (overwrite) {
      fs.writeFileSync(filePath, content, "utf8");
      return [filename, "overwritten"];
    }
    return [filename, "unchanged"];
  });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.runFolder) {
    console.error(usage());
    return 1;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const runDir = researchPack.resolveRunDir(repoRoot, options.runFolder);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    console.error(`Run folder not found: ${runDir}`);
    return 1;
  }

  const outputs = buildOutputs(runDir);
  const results = writeOutputs(runDir, outputs, options.overwrite);
  const relativeRunDir = path.relative(repoRoot, runDir).replace(/\\/g, "/");
  console.log(`final review: ${outputs.verdict.status}`);
  console.log(`publish ready: ${outputs.verdict.publishReady ? "yes" : "no"}`);
  console.log(`reason: ${outputs.verdict.reason}`);
  results.forEach(([filename, status]) => {
    console.log(`${status}: ${relativeRunDir}/${filename}`);
  });
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  TOOL_NAME,
  TARGET_FILES,
  FINAL_WATCH_NOTES_FILE,
  FINAL_REVIEW_FILE,
  PUBLICATION_BLOCKERS_FILE,
  usage,
  parseArgs,
  buildFinalWatchNotesTemplate,
  isStarterFinalWatchNotes,
  parseRoughCutReview,
  readContext,
  determineFinalReviewStatus,
  buildFinalReview,
  buildPublicationBlockers,
  buildOutputs,
  writeOutputs,
  main,
};
