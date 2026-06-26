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
const INPUT_FILES = [
  "final-watch-notes.md",
  "rough-cut-review.md",
  "publish-pack.md",
  "selected-package.json",
  "selected-package.md",
  "thumbnail-title-check.md",
];
const REQUIRED_FINAL_WATCH_SECTIONS = [
  { label: "Final Version Reviewed", headings: ["Final Version Reviewed"] },
  { label: "Watch Date", headings: ["Watch Date"] },
  { label: "Reviewer", headings: ["Reviewer"] },
  { label: "Viewer Promise Delivery", headings: ["Viewer Promise Delivery", "Promise Delivery"] },
  { label: "Opening Strength", headings: ["Opening Strength", "Opening"] },
  { label: "Clarity", headings: ["Clarity"] },
  { label: "Pacing", headings: ["Pacing"] },
  { label: "Proof / Evidence", headings: ["Proof / Evidence"] },
  { label: "Audio Quality", headings: ["Audio Quality", "Audio"] },
  { label: "Visual Support", headings: ["Visual Support", "Visuals"] },
  { label: "Graphics / Captions", headings: ["Graphics / Captions"] },
  { label: "Title / Thumbnail Fit", headings: ["Title / Thumbnail Fit"] },
  { label: "Ethical / Accuracy Risks", headings: ["Ethical / Accuracy Risks"] },
  { label: "Upload Metadata Readiness", headings: ["Upload Metadata Readiness"] },
  { label: "Archive Readiness", headings: ["Archive Readiness"] },
];

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

function sectionTextAny(markdown, headings) {
  const labels = Array.isArray(headings) ? headings : [headings];
  for (const heading of labels) {
    const text = cleanString(sectionText(markdown, heading));
    if (text) return text;
  }
  return "";
}

function normalizeLine(line) {
  return cleanString(String(line || "").replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/\[[ xX]\]\s*/, ""));
}

function isAssessedText(value) {
  const text = cleanString(value);
  return Boolean(text) && !/^(todo|tbd|placeholder|n\/a|none|not applicable)$/i.test(text);
}

function missingRequiredFinalWatchSections(markdown = "") {
  return REQUIRED_FINAL_WATCH_SECTIONS.filter((section) => !isAssessedText(sectionTextAny(markdown, section.headings))).map(
    (section) => section.label
  );
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

## Viewer Promise Delivery

TODO

## Opening Strength

TODO

## Clarity

TODO

## Pacing

TODO

## Proof / Evidence

TODO

## Audio Quality

TODO

## Visual Support

TODO

## Graphics / Captions

TODO

## Title / Thumbnail Fit

TODO

## Ethical / Accuracy Risks

TODO

## Upload Metadata Readiness

TODO

## Archive Readiness

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

function selectedPackageSummary(files) {
  const jsonText = files["selected-package.json"];
  if (jsonText) {
    try {
      const payload = JSON.parse(jsonText);
      const source = payload && typeof payload === "object" && payload.package ? payload.package : payload;
      return cleanString(source.viewerPromise || source.viewer_promise || source.proposedTitle || source.proposed_title || source.title || source.idea) ||
        "Selected package JSON is present.";
    } catch (_error) {
      return "Selected package JSON is present but could not be summarized.";
    }
  }
  const markdown = files["selected-package.md"];
  if (markdown) {
    const promise = lineValue(markdown, "Viewer promise") || lineValue(markdown, "Package promise");
    if (promise) return promise;
    const heading = markdown.split(/\r?\n/).find((line) => line.trim().startsWith("# "));
    return heading ? heading.replace(/^#\s+/, "").replace(/^Selected Package:\s*/i, "").trim() : "Selected package markdown is present.";
  }
  return "No selected package summary is available.";
}

function parsePublishPack(markdown = "") {
  const text = String(markdown || "");
  if (!text) {
    return {
      status: "MISSING",
      blocksPublication: true,
      reason: "publish-pack.md is missing; upload metadata readiness cannot be approved.",
    };
  }
  const placeholder = /\b(TODO|TBD|placeholder|not drafted yet|draft)\b/i.test(text);
  const approval = /^(?:[-*]\s*)?(?:Publish pack approval|Upload metadata approval|Publication metadata approval):\s*PASS\s*$/im.test(text);
  if (placeholder && !approval) {
    return {
      status: "DRAFT",
      blocksPublication: true,
      reason: "publish-pack.md still appears to be placeholder or draft metadata.",
    };
  }
  return {
    status: approval ? "APPROVED" : "PRESENT",
    blocksPublication: false,
    reason: approval ? "Publish pack has an exact approval marker." : "publish-pack.md is present with no placeholder markers detected.",
  };
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const roughCutReviewText = files["rough-cut-review.md"];
  const finalWatchNotesWereMissing = !readOptionalFile(runDir, FINAL_WATCH_NOTES_FILE);
  const finalWatchNotesText =
    files[FINAL_WATCH_NOTES_FILE] || buildFinalWatchNotesTemplate(path.basename(runDir));
  const roughCut = parseRoughCutReview(roughCutReviewText);
  const finalIssues = sectionItems(finalWatchNotesText, ["Final-Watch Issues", "Publication Blockers"]);
  const publishPack = parsePublishPack(files["publish-pack.md"]);
  const missingRequiredSections = missingRequiredFinalWatchSections(finalWatchNotesText);

  return {
    runId: path.basename(runDir),
    files,
    roughCut,
    publishPack,
    finalWatchNotesWereMissing,
    finalWatchNotesText,
    finalWatchNotesAreStarter: isStarterFinalWatchNotes(finalWatchNotesText),
    finalIssues,
    missingRequiredSections,
    selectedSummary: selectedPackageSummary(files),
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
  if (context.missingRequiredSections.length) {
    blockers.push(`Required final-watch sections are not assessed: ${context.missingRequiredSections.join(", ")}.`);
    nextActions.push("Complete every required final-watch section with real non-placeholder notes.");
  }
  if (context.publishPack.blocksPublication) {
    blockers.push(context.publishPack.reason);
    nextActions.push("Replace placeholder publish metadata and approve the publish pack before publication.");
  }

  if (blockers.length) {
    return {
      status: "BLOCKED",
      publishReady: false,
      reason: [...new Set(blockers)].join(" "),
      nextActions: [...new Set(nextActions)],
    };
  }

  if (context.explicitApproval && !context.finalWatchNotesAreStarter && !context.finalIssues.length) {
    return {
      status: "PASS",
      publishReady: true,
      reason: context.explicitApproval
        ? "Exact final-watch approval marker is present and upstream gates allow final review."
        : "Real final-watch notes exist, no final-watch issues were detected, and upstream gates allow final review.",
      nextActions: ["Proceed only within the approved publish scope."],
    };
  }

  if (!context.finalWatchNotesAreStarter && !context.finalIssues.length) {
    return {
      status: "NEEDS FINAL FIXES",
      publishReady: false,
      reason: "Real final-watch notes exist and no issues were detected, but an exact final approval marker is required before publication readiness.",
      nextActions: ["Add exact Final approval: PASS only after the human final-watch gate approves publication."],
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

function assessedSection(notes, headings, fallback) {
  const text = cleanString(sectionTextAny(notes, headings));
  if (!isAssessedText(text)) return fallback;
  return text;
}

function buildFinalReview(context, verdict) {
  const notes = context.finalWatchNotesText;
  const finalGateStatus = verdict.publishReady ? "READY TO PUBLISH" : verdict.status === "NEEDS FINAL FIXES" ? "NEEDS FINAL FIXES" : "BLOCKED";
  return `# Final Review

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Rough-cut review status: ${context.roughCut.status}
- Second-cut ready: ${context.roughCut.secondCutReady}
- Final-watch notes source: ${context.finalWatchNotesWereMissing ? "created starter template" : FINAL_WATCH_NOTES_FILE}
- Final version reviewed: ${assessedSection(notes, ["Final Version Reviewed"], "Not assessed.")}
- Watch context: ${assessedSection(notes, ["Watch Date"], "Not assessed.")}; reviewer: ${assessedSection(notes, ["Reviewer"], "Not assessed.")}
- Package promise: ${context.selectedSummary}
- Publish pack status: ${context.publishPack.status}
- Final review status: ${verdict.status}
- Publish ready: ${verdict.publishReady ? "yes" : "no"}
- External APIs called: no

## Input Warnings

${markdownList(
  [
    context.roughCut.allowsFinalReview ? "" : context.roughCut.reason,
    context.finalWatchNotesAreStarter ? "Final-watch notes are starter/template notes, not real review evidence." : "",
    context.publishPack.blocksPublication ? context.publishPack.reason : "",
    context.publishPack.status === "MISSING" ? context.publishPack.reason : "",
  ],
  "None."
)}

## Review Boundary

- This tool reviews manual final-watch notes and upstream rough-cut review status.
- It does not analyze video files, publish, upload, archive, create scheduled jobs, or call external APIs.

## Final-Watch Issues

${finalIssueList(context)}

## Viewer Promise Delivery

${assessedSection(notes, ["Viewer Promise Delivery", "Promise Delivery"], "- Not assessed. Add real final-watch notes.")}

## Opening Strength

${assessedSection(notes, ["Opening Strength", "Opening"], "- Not assessed. Add real final-watch notes.")}

## Clarity

${assessedSection(notes, ["Clarity"], "- Not assessed. Add real final-watch notes.")}

## Pacing

${assessedSection(notes, ["Pacing"], "- Not assessed. Add real final-watch notes.")}

## Proof / Evidence

${assessedSection(notes, ["Proof / Evidence"], "- Not assessed. Add real final-watch notes.")}

## Audio Quality

${assessedSection(notes, ["Audio Quality", "Audio"], "- Not assessed. Add real final-watch notes.")}

## Visual Support

${assessedSection(notes, ["Visual Support", "Visuals"], "- Not assessed. Add real final-watch notes.")}

## Graphics / Captions

${assessedSection(notes, ["Graphics / Captions"], "- Not assessed. Add real final-watch notes.")}

## Title / Thumbnail Fit

${assessedSection(notes, ["Title / Thumbnail Fit"], "- Not assessed. Add real final-watch notes.")}

## Ethical / Accuracy Risks

${assessedSection(notes, ["Ethical / Accuracy Risks"], "- Not assessed. Add real final-watch notes.")}

## Upload Metadata Readiness

${assessedSection(notes, ["Upload Metadata Readiness"], `- ${context.publishPack.reason}`)}

## Archive Readiness

${assessedSection(notes, ["Archive Readiness"], "- Not assessed. Add real final-watch notes.")}

## Publication Blockers

${finalIssueList(context)}

## Final Review Gate

- Status: ${finalGateStatus}
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
  if (context.publishPack.blocksPublication) {
    rows.push([
      context.publishPack.reason,
      "Publication readiness requires non-placeholder upload metadata.",
      "Repair publish-pack.md and add an exact approval marker when reviewed.",
      "blocked",
    ]);
  }
  context.missingRequiredSections.forEach((section) => {
    rows.push([
      `${section} is not assessed in final-watch-notes.md`,
      "READY TO PUBLISH requires real non-placeholder final-watch assessment for every required section.",
      `Complete the ${section} section with real final-watch notes.`,
      "blocked",
    ]);
  });
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
    return [filename, "skipped"];
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
  REQUIRED_FINAL_WATCH_SECTIONS,
  FINAL_WATCH_NOTES_FILE,
  FINAL_REVIEW_FILE,
  PUBLICATION_BLOCKERS_FILE,
  usage,
  parseArgs,
  buildFinalWatchNotesTemplate,
  sectionTextAny,
  isAssessedText,
  missingRequiredFinalWatchSections,
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
