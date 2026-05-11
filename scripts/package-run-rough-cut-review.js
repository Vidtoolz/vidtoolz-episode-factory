#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-rough-cut-review.js";
const WATCH_NOTES_FILE = "rough-cut-watch-notes.md";
const REVIEW_FILE = "rough-cut-review.md";
const PICKUP_LIST_FILE = "pickup-list.md";
const EDIT_FIX_LIST_FILE = "edit-fix-list.md";
const TARGET_FILES = [WATCH_NOTES_FILE, REVIEW_FILE, PICKUP_LIST_FILE, EDIT_FIX_LIST_FILE];

const INPUT_FILES = [
  "rough-cut-watch-notes.md",
  "production-plan.md",
  "production-blockers.md",
  "shot-list.md",
  "screen-capture-list.md",
  "demo-list.md",
  "b-roll-list.md",
  "graphics-list.md",
  "audio-notes.md",
  "script-review.md",
  "script-revision-plan.md",
  "final-script.md",
  "script-draft.md",
  "script-structure.md",
  "research-pack.md",
  "selected-package.json",
  "selected-package.md",
  "creator-qa-report.json",
  "creator-qa-report.md",
];

function usage() {
  return [
    "Usage: node scripts/package-run-rough-cut-review.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-rough-cut-review.js --help",
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

function hasExactApprovalMarker(...texts) {
  return texts.some((text) =>
    /^(?:[-*]\s*)?(?:Manual approval|Rough-cut approval|Second-cut approval):\s*PASS\s*$/im.test(String(text || ""))
  );
}

function buildWatchNotesTemplate(runId) {
  return `# Rough-Cut Watch Notes

- Run: ${runId}
- Tool: ${TOOL_NAME}
- Status: starter template
- External APIs called: no

## Rough-Cut Version Reviewed

TODO

## Watch Date

TODO

## Reviewer

TODO

## First 30 Seconds Notes

TODO

## Clarity Notes

TODO

## Pacing Notes

TODO

## Proof / Evidence Notes

TODO

## Missing Visuals

TODO

## Audio Problems

TODO

## Graphics Problems

TODO

## Confusing Sections

TODO

## Sections to Cut / Tighten

TODO

## Pickups Needed

TODO

## Edit Fixes Needed

TODO

## Second-Cut Recommendation

TODO

## Manual Rough-Cut Approval Marker

Leave blank unless approved after a real watch.

`;
}

function normalizeLine(line) {
  return cleanString(String(line || "").replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/\[[ xX]\]\s*/, ""));
}

function sectionText(markdown, heading) {
  return researchPack.sectionText(String(markdown || ""), heading);
}

function sectionItems(markdown, headings) {
  const values = [];
  headings.forEach((heading) => {
    const body = sectionText(markdown, heading);
    body.split(/\r?\n/).forEach((line) => {
      const item = normalizeLine(line);
      if (!item) return;
      if (/^(todo|n\/a|none|no|no pickups|no edit fixes|not applicable|leave blank)/i.test(item)) return;
      values.push(item);
    });
  });
  return [...new Set(values)];
}

function isStarterWatchNotes(markdown = "") {
  const text = String(markdown || "");
  if (!text) return true;
  if (/^(?:[-*]\s*)?Status:\s*starter template\s*$/im.test(text)) return true;
  const relevant = [
    "Rough-Cut Version Reviewed",
    "Watch Date",
    "Reviewer",
    "First 30 Seconds Notes",
    "Clarity Notes",
    "Pacing Notes",
    "Proof / Evidence Notes",
    "Missing Visuals",
    "Audio Problems",
    "Graphics Problems",
    "Confusing Sections",
    "Sections to Cut / Tighten",
    "Pickups Needed",
    "Edit Fixes Needed",
    "Second-Cut Recommendation",
  ].flatMap((heading) => sectionItems(text, [heading]));
  return relevant.length === 0 && !hasExactApprovalMarker(text);
}

function parseProductionPlanStatus(markdown = "") {
  const text = String(markdown || "");
  if (!text) {
    return {
      productionPlanStatus: "MISSING",
      shootReadinessStatus: "MISSING",
      allowsRoughCutReview: false,
      reason: "production-plan.md is missing.",
    };
  }
  const shootReadinessStatus = (lineValue(text, "Shoot-readiness status") || lineValue(text, "Status") || "MISSING").toUpperCase();
  const manualApproval = hasExactApprovalMarker(text);
  return {
    productionPlanStatus: "present",
    shootReadinessStatus,
    allowsRoughCutReview: shootReadinessStatus === "READY TO SHOOT" || manualApproval,
    reason:
      shootReadinessStatus === "READY TO SHOOT" || manualApproval
        ? "Production plan allows rough-cut review."
        : `Production plan shoot-readiness is ${shootReadinessStatus}, not READY TO SHOOT.`,
  };
}

function hasOpenProductionBlockers(markdown = "") {
  const text = String(markdown || "");
  if (!text) return false;
  return /\|\s*[^|\n]+\s*\|[^|\n]*\|[^|\n]*\|\s*open\s*\|/i.test(text) || /^\s*(?:[-*]\s*)?Status:\s*open\s*$/im.test(text);
}

function fallbackSelectedPackageSummary(files) {
  const jsonText = files["selected-package.json"];
  if (jsonText) {
    try {
      const payload = JSON.parse(jsonText);
      const source = payload && typeof payload === "object" && payload.package ? payload.package : payload;
      return cleanString(source.proposedTitle || source.proposed_title || source.title || source.viewerPromise || source.viewer_promise || source.idea) || "Selected package JSON is present.";
    } catch (_error) {
      return "Selected package JSON is present but could not be summarized.";
    }
  }
  const markdown = files["selected-package.md"];
  if (markdown) {
    const heading = markdown.split(/\r?\n/).find((line) => line.trim().startsWith("# "));
    return heading ? heading.replace(/^#\s+/, "").replace(/^Selected Package:\s*/i, "").trim() : "Selected package markdown is present.";
  }
  return "No selected package summary is available.";
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const watchNotesWereMissing = !files[WATCH_NOTES_FILE];
  const watchNotesText = files[WATCH_NOTES_FILE] || buildWatchNotesTemplate(path.basename(runDir));
  files[WATCH_NOTES_FILE] = watchNotesText;
  const productionGate = parseProductionPlanStatus(files["production-plan.md"]);
  const scriptReviewStatus = (lineValue(files["script-review.md"], "Script review status") || "MISSING").toUpperCase();
  const researchGateStatus = (lineValue(files["research-pack.md"], "Status") || "MISSING").toUpperCase();
  const pickups = sectionItems(watchNotesText, ["Pickups Needed", "Missing Visuals"]);
  const editFixes = sectionItems(watchNotesText, [
    "Edit Fixes Needed",
    "Sections to Cut / Tighten",
    "Confusing Sections",
    "Audio Problems",
    "Graphics Problems",
  ]);

  return {
    runId: path.basename(runDir),
    files,
    watchNotesWereMissing,
    watchNotesText,
    watchNotesSource: watchNotesWereMissing ? "created starter template" : WATCH_NOTES_FILE,
    watchNotesAreStarter: isStarterWatchNotes(watchNotesText),
    productionGate,
    hasOpenProductionBlockers: hasOpenProductionBlockers(files["production-blockers.md"]),
    scriptReviewStatus,
    researchGateStatus,
    selectedSummary: fallbackSelectedPackageSummary(files),
    pickups,
    editFixes,
    explicitApproval: hasExactApprovalMarker(watchNotesText, files["production-plan.md"]),
  };
}

function determineReviewStatus(context) {
  const blockers = [];
  const nextActions = [];

  if (context.watchNotesWereMissing) {
    blockers.push("rough-cut-watch-notes.md was missing; starter template created.");
    nextActions.push("Watch the rough cut and replace TODO fields with real notes.");
  } else if (context.watchNotesAreStarter) {
    blockers.push("rough-cut-watch-notes.md is still a starter template or has no real review notes.");
    nextActions.push("Replace starter placeholders with real watch notes.");
  }

  if (!context.productionGate.allowsRoughCutReview) {
    blockers.push(context.productionGate.reason);
    nextActions.push("Resolve production-plan.md shoot-readiness before second-cut approval.");
  }

  if (context.hasOpenProductionBlockers) {
    blockers.push("production-blockers.md has open blockers.");
    nextActions.push("Resolve open production blockers before second-cut approval.");
  }

  if (context.pickups.length) {
    nextActions.push("Capture or script the listed pickups.");
  }
  if (context.editFixes.length) {
    nextActions.push("Apply the listed edit fixes and rewatch.");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueNextActions = [...new Set(nextActions)];

  if (uniqueBlockers.length) {
    return {
      status: "BLOCKED",
      secondCutReady: false,
      reason: uniqueBlockers.join(" "),
      blockers: uniqueBlockers,
      nextActions: uniqueNextActions,
    };
  }

  if (context.pickups.length) {
    return {
      status: "NEEDS PICKUPS",
      secondCutReady: false,
      reason: "Watch notes list pickups needed.",
      blockers: context.pickups,
      nextActions: uniqueNextActions,
    };
  }

  if (context.editFixes.length) {
    return {
      status: "NEEDS EDIT FIXES",
      secondCutReady: false,
      reason: "Watch notes list edit fixes needed.",
      blockers: context.editFixes,
      nextActions: uniqueNextActions,
    };
  }

  if (context.explicitApproval || (!context.watchNotesAreStarter && !context.pickups.length && !context.editFixes.length)) {
    return {
      status: "READY FOR SECOND CUT",
      secondCutReady: true,
      reason: context.explicitApproval
        ? "Exact rough-cut or second-cut approval marker is present and upstream gates allow review."
        : "Real watch notes exist, no pickups or edit fixes were detected, and upstream gates allow review.",
      blockers: [],
      nextActions: ["Proceed to the second cut using the reviewed scope."],
    };
  }

  return {
    status: "BLOCKED",
    secondCutReady: false,
    reason: "Rough-cut review evidence is insufficient.",
    blockers: ["Rough-cut review evidence is insufficient."],
    nextActions: ["Add real watch notes or an exact approval marker after review."],
  };
}

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function reviewIssueList(items, fallback, context) {
  if ((context.watchNotesWereMissing || context.watchNotesAreStarter) && !items.length) {
    return "- Not assessed. Real rough-cut watch notes are missing or still a starter template.";
  }
  return markdownList(items, fallback);
}

function inputWarnings(context) {
  const warnings = [];
  INPUT_FILES.forEach((filename) => {
    if (!context.files[filename]) warnings.push(`Missing ${filename}.`);
  });
  if (context.watchNotesAreStarter) warnings.push("Rough-cut watch notes are starter/template notes, not real review evidence.");
  if (!context.productionGate.allowsRoughCutReview) warnings.push(context.productionGate.reason);
  if (context.hasOpenProductionBlockers) warnings.push("Open production blockers detected.");
  return warnings;
}

function buildReview(context, verdict) {
  const notes = context.watchNotesText;
  const assessedValue = (value) => {
    const text = cleanString(value);
    if (!text || /^(todo|n\/a|none|not applicable)$/i.test(text)) return "Not assessed.";
    return text;
  };
  const versionReviewed = assessedValue(sectionText(notes, "Rough-Cut Version Reviewed"));
  const watchDate = assessedValue(sectionText(notes, "Watch Date"));
  const reviewer = assessedValue(sectionText(notes, "Reviewer"));
  return `# Rough-Cut Review

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Rough-cut notes source: ${context.watchNotesSource}
- Rough-cut version reviewed: ${versionReviewed}
- Watch context: ${watchDate}; reviewer: ${reviewer}
- Production plan status: ${context.productionGate.productionPlanStatus}
- Shoot-readiness status: ${context.productionGate.shootReadinessStatus}
- Script review status: ${context.scriptReviewStatus}
- Research gate status: ${context.researchGateStatus}
- Rough-cut review status: ${verdict.status}
- Second-cut ready: ${verdict.secondCutReady ? "yes" : "no"}
- External APIs called: no

## Input Warnings

${markdownList(inputWarnings(context), "None.")}

## Review Boundary

- This tool reviews manual rough-cut watch notes and local package artifacts.
- It does not analyze video files, create final review, create publish artifacts, create archive manifests, create Shorts plans, or create new production plan artifacts.

## Package Promise Check

- Package: ${context.selectedSummary}
- Check whether the rough cut delivers the viewer promise clearly enough for a second cut.

## First 30 Seconds Diagnosis

${sectionText(notes, "First 30 Seconds Notes") || "- TODO: watch and document hook performance."}

## Clarity Diagnosis

${sectionText(notes, "Clarity Notes") || "- TODO: document clarity issues or confirm none."}

## Pacing Diagnosis

${sectionText(notes, "Pacing Notes") || "- TODO: document slow, repeated, or rushed sections."}

## Proof / Evidence Diagnosis

${sectionText(notes, "Proof / Evidence Notes") || "- TODO: document whether proof lands for the viewer."}

## Missing Shots / Assets

${sectionText(notes, "Missing Visuals") || "- TODO: list missing visuals, shots, screen captures, or assets."}

## Audio Problems

${sectionText(notes, "Audio Problems") || "- TODO: list unclear, noisy, clipped, or missing audio."}

## Graphics Problems

${sectionText(notes, "Graphics Problems") || "- TODO: list unclear, unreadable, mistimed, or missing graphics."}

## Viewer Confusion Points

${sectionText(notes, "Confusing Sections") || "- TODO: list moments where the viewer may lose the thread."}

## Sections to Cut or Tighten

${sectionText(notes, "Sections to Cut / Tighten") || "- TODO: list cuts, trims, or reordered sections."}

## Pickups Needed

${reviewIssueList(context.pickups, "No pickups detected from watch notes.", context)}

## Edit Fixes Needed

${reviewIssueList(context.editFixes, "No edit fixes detected from watch notes.", context)}

## Second-Cut Readiness Gate

- Status: ${verdict.status}
- Reason: ${verdict.reason}
- Next actions:
${markdownList(verdict.nextActions, "Proceed to second cut.")}
`;
}

function tableRows(items, columns, context) {
  const values = items.map(cleanString).filter(Boolean);
  const watchNotesBlocked = context.watchNotesWereMissing || context.watchNotesAreStarter;
  if (!values.length) {
    if (watchNotesBlocked && columns === "pickup") {
      return "| Not assessed. | Real rough-cut watch notes are missing or still a starter template. | high | rough-cut-watch-notes.md | blocked |";
    }
    if (watchNotesBlocked) {
      return "| Not assessed. | Real rough-cut watch notes are missing or still a starter template. | Add real watch notes before edit fixes can be assessed. | high | blocked |";
    }
    if (columns === "pickup") return "| None. | No pickups detected from watch notes. | low | rough-cut-watch-notes.md | closed |";
    return "| None. | No edit fixes detected from watch notes. | No fix needed. | low | closed |";
  }
  return values
    .map((item, index) => {
      const priority = index === 0 ? "high" : "medium";
      if (columns === "pickup") return `| ${item} | Needed to repair rough-cut viewer experience. | ${priority} | rough-cut-watch-notes.md | open |`;
      return `| rough cut | ${item} | Repair this before the second cut. | ${priority} | open |`;
    })
    .join("\n");
}

function buildPickupList(context) {
  return `# Pickup List

| pickup shot/content | reason | priority | source/location | status |
| --- | --- | --- | --- | --- |
${tableRows(context.pickups, "pickup", context)}
`;
}

function buildEditFixList(context) {
  return `# Edit Fix List

| section/timecode | problem | fix | priority | status |
| --- | --- | --- | --- | --- |
${tableRows(context.editFixes, "edit", context)}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const verdict = determineReviewStatus(context);
  return {
    context,
    verdict,
    files: [
      [WATCH_NOTES_FILE, context.files[WATCH_NOTES_FILE]],
      [REVIEW_FILE, buildReview(context, verdict)],
      [PICKUP_LIST_FILE, buildPickupList(context)],
      [EDIT_FIX_LIST_FILE, buildEditFixList(context)],
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
  console.log(`rough-cut review: ${outputs.verdict.status}`);
  console.log(`second-cut ready: ${outputs.verdict.secondCutReady ? "yes" : "no"}`);
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
  INPUT_FILES,
  WATCH_NOTES_FILE,
  REVIEW_FILE,
  PICKUP_LIST_FILE,
  EDIT_FIX_LIST_FILE,
  usage,
  parseArgs,
  hasExactApprovalMarker,
  buildWatchNotesTemplate,
  sectionItems,
  isStarterWatchNotes,
  parseProductionPlanStatus,
  hasOpenProductionBlockers,
  readContext,
  determineReviewStatus,
  buildReview,
  buildPickupList,
  buildEditFixList,
  buildOutputs,
  writeOutputs,
  main,
};
