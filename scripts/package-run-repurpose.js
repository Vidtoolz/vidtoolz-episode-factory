#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-repurpose.js";
const REPURPOSING_PLAN_FILE = "repurposing-plan.md";
const SHORTS_CANDIDATES_FILE = "shorts-candidates.md";
const PLATFORM_VARIANTS_FILE = "platform-variants.md";
const TARGET_FILES = [REPURPOSING_PLAN_FILE, SHORTS_CANDIDATES_FILE, PLATFORM_VARIANTS_FILE];

const INPUT_FILES = [
  "final-review.md",
  "final-watch-notes.md",
  "publication-blockers.md",
  "publish-pack.md",
  "final-script.md",
  "transcript.md",
  "script-draft.md",
  "script-review.md",
  "script-revision-plan.md",
  "rough-cut-review.md",
  "rough-cut-watch-notes.md",
  "pickup-list.md",
  "edit-fix-list.md",
  "production-plan.md",
  "selected-package.json",
  "selected-package.md",
  "research-pack.md",
  "thumbnail-title-check.md",
];

function usage() {
  return [
    "Usage: node scripts/package-run-repurpose.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-repurpose.js --help",
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

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function hasExactApprovalMarker(...texts) {
  return texts.some((text) =>
    /^(?:[-*]\s*)?(?:Manual approval|Repurposing approval|Shorts approval):\s*PASS\s*$/im.test(String(text || ""))
  );
}

function hasOpenPublicationBlockers(markdown = "") {
  const text = String(markdown || "");
  if (!text) return false;
  return /\|\s*[^|\n]+\s*\|[^|\n]*\|[^|\n]*\|\s*(?:open|blocked)\s*\|/i.test(text);
}

function fallbackSelectedPackageSummary(files) {
  const jsonText = files["selected-package.json"];
  if (jsonText) {
    try {
      const payload = JSON.parse(jsonText);
      const source = payload && typeof payload === "object" && payload.package ? payload.package : payload;
      return (
        cleanString(source.proposedTitle || source.proposed_title || source.title || source.viewerPromise || source.viewer_promise || source.idea) ||
        "Selected package JSON is present."
      );
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

function sourceMaterial(files) {
  if (files["transcript.md"]) return { file: "transcript.md", type: "transcript", text: files["transcript.md"], acceptable: true };
  if (files["final-script.md"]) return { file: "final-script.md", type: "final script", text: files["final-script.md"], acceptable: true };
  if (files["script-draft.md"]) return { file: "script-draft.md", type: "script draft", text: files["script-draft.md"], acceptable: false };
  return { file: "missing", type: "missing", text: "", acceptable: false };
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const manualApproval = hasExactApprovalMarker(...Object.values(files));
  const finalReviewText = files["final-review.md"];
  const finalReviewStatus = (lineValue(finalReviewText, "Final review status") || "MISSING").toUpperCase();
  const publishReady = (lineValue(finalReviewText, "Publish ready") || "no").toLowerCase();
  const source = sourceMaterial(files);
  return {
    runId: path.basename(runDir),
    files,
    manualApproval,
    finalReviewStatus,
    publishReady,
    publicationBlockersOpen: hasOpenPublicationBlockers(files["publication-blockers.md"]),
    source,
    selectedSummary: fallbackSelectedPackageSummary(files),
  };
}

function determineRepurposingStatus(context) {
  const blockers = [];
  const nextActions = [];

  if (!context.files["final-review.md"]) {
    blockers.push("final-review.md is missing.");
    nextActions.push("Run final review before repurposing.");
  } else if (context.finalReviewStatus === "BLOCKED") {
    blockers.push("Final review status is BLOCKED.");
    nextActions.push("Resolve final-review.md before repurposing.");
  } else if (context.finalReviewStatus !== "PASS" && !context.manualApproval) {
    blockers.push(`Final review status is ${context.finalReviewStatus}, not PASS.`);
    nextActions.push("Add final approval or exact manual repurposing approval.");
  }

  if (context.publishReady !== "yes" && !context.manualApproval) {
    blockers.push(`Publish ready is ${context.publishReady}.`);
    nextActions.push("Resolve publish readiness before cutting shorts.");
  }

  if (context.publicationBlockersOpen) {
    blockers.push("publication-blockers.md has open or blocked rows.");
    nextActions.push("Resolve publication blockers before repurposing.");
  }

  if (context.source.type === "missing") {
    blockers.push("transcript.md or final-script.md is missing.");
    nextActions.push("Add transcript.md or final-script.md before extracting shorts.");
  } else if (!context.source.acceptable && !context.manualApproval) {
    blockers.push("Only script-draft.md is available as source material.");
    nextActions.push("Add transcript.md or final-script.md, or add exact repurposing approval.");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueNextActions = [...new Set(nextActions)];

  if (uniqueBlockers.length) {
    const needsTranscriptOnly =
      uniqueBlockers.length === 1 &&
      (uniqueBlockers[0] === "transcript.md or final-script.md is missing." || uniqueBlockers[0] === "Only script-draft.md is available as source material.");
    return {
      status: needsTranscriptOnly ? "NEEDS TRANSCRIPT" : context.finalReviewStatus === "BLOCKED" || !context.files["final-review.md"] ? "BLOCKED" : "NEEDS FINAL APPROVAL",
      readyToCutShorts: false,
      reason: uniqueBlockers.join(" "),
      blockers: uniqueBlockers,
      nextActions: uniqueNextActions,
    };
  }

  return {
    status: "READY TO CUT SHORTS",
    readyToCutShorts: true,
    reason: context.manualApproval
      ? "Exact repurposing approval marker is present and blocking gates are clear."
      : "Final review passed, publish readiness is yes, publication blockers are clear, and source material exists.",
    blockers: [],
    nextActions: ["Cut shorts only from self-contained moments that preserve the long-form context."],
  };
}

function inputWarnings(context) {
  return INPUT_FILES.filter((filename) => !context.files[filename]).map((filename) => `Missing ${filename}.`);
}

function extractCandidateLines(sourceText) {
  return String(sourceText || "")
    .split(/\r?\n/)
    .map((line) => cleanString(line.replace(/^#+\s*/, "").replace(/^\s*(?:[-*]|\d+\.)\s+/, "")))
    .filter((line) => line.length >= 35 && !/^(todo|status:|run:|tool:)/i.test(line))
    .slice(0, 5);
}

function candidateRows(context, verdict) {
  if (!verdict.readyToCutShorts) {
    return "| Not assessed. | Not assessed until final review, publication blockers, and source material pass. | Real source review is required before candidates can be selected. | Add final approval and source material. | Not assessed. | high | high | blocked |";
  }
  const candidates = extractCandidateLines(context.source.text);
  if (!candidates.length) {
    return "| Candidate extraction needs manual review. | transcript.md or final-script.md | Source exists but no obvious standalone moment was detected deterministically. | Manually mark a self-contained clip. | Use one clear takeaway. | medium | high | open |";
  }
  return candidates
    .map((line, index) => {
      const hook = line.length > 80 ? `${line.slice(0, 77)}...` : line;
      return `| ${hook} | ${context.source.file} | Self-contained claim or teaching moment from approved long-form source. | Cut to one idea with setup, proof, and payoff. | ${hook} | medium | ${index === 0 ? "high" : "medium"} | open |`;
    })
    .join("\n");
}

function buildShortsCandidates(context, verdict) {
  return `# Shorts Candidates

| candidate title/hook | source section/timecode | why it works standalone | required edit | caption/on-screen text idea | misleading-context risk | priority | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
${candidateRows(context, verdict)}
`;
}

function platformStatus(verdict) {
  return verdict.readyToCutShorts ? "open" : "blocked";
}

function platformLine(verdict, platform) {
  if (!verdict.readyToCutShorts) {
    return `- Status: blocked\n- Format notes: Not assessed until final review, publication blockers, and source material pass.\n- CTA notes: Do not post ${platform} variants yet.`;
  }
  return `- Status: open\n- Format notes: Cut from one approved, self-contained source moment.\n- CTA notes: Point viewers back to the long-form episode for full context.`;
}

function buildPlatformVariants(context, verdict) {
  return `# Platform Variants

## YouTube Shorts

${platformLine(verdict, "YouTube Shorts")}

## TikTok / Reels

${platformLine(verdict, "TikTok / Reels")}

## LinkedIn / Professional Clip

${platformLine(verdict, "LinkedIn")}

## YouTube Community or Newsletter Teaser

${platformLine(verdict, "community/newsletter")}

## Title / Caption Variants

- Status: ${platformStatus(verdict)}
- Long-form promise: ${context.selectedSummary}
- Variant notes: ${verdict.readyToCutShorts ? "Draft captions after selecting the exact clip." : "Blocked until repurposing gate passes."}

## Format Notes

- Status: ${platformStatus(verdict)}
- Keep each clip self-contained and avoid claims that need missing context.

## CTA Notes

- Status: ${platformStatus(verdict)}
- Use a context-preserving CTA back to the full episode only after the gate passes.
`;
}

function buildRepurposingPlan(context, verdict) {
  return `# Repurposing Plan

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Source material: ${context.source.file}
- Final review status: ${context.finalReviewStatus}
- Ready to publish: ${context.publishReady}
- Publication blockers status: ${context.publicationBlockersOpen ? "open/blocked" : context.files["publication-blockers.md"] ? "clear" : "missing"}
- Repurposing status: ${verdict.status}
- Ready to cut shorts: ${verdict.readyToCutShorts ? "yes" : "no"}
- External APIs called: no

## Input Warnings

${markdownList(inputWarnings(context), "None.")}

## Repurposing Boundary

- This tool plans shorts and platform variants from local artifacts only.
- It does not create final review, publish packs, archive manifests, rough-cut review artifacts, production plan artifacts, video edits, uploads, scheduled jobs, or external API calls.

## Long-Form Promise

- ${context.selectedSummary}

## Source Material Status

- Source: ${context.source.file}
- Source type: ${context.source.type}
- Source acceptable for repurposing: ${context.source.acceptable || context.manualApproval ? "yes" : "no"}

## Candidate Extraction Rules

- Use only self-contained moments from approved long-form source material.
- Preserve the setup, proof, and payoff needed to avoid misleading context.
- Do not cut clips from draft-only source unless exact manual approval is present.

## Shorts Strategy

- Extract one clear viewer problem, proof moment, or tactical takeaway per short.
- Favor moments that can stand alone without needing the whole episode.

## Platform Variant Strategy

- Adapt framing and CTA per platform after a candidate is selected.
- Keep technical claims consistent with the approved long-form source.

## Context / Misleading-Risk Guard

- Do not imply the full episode has final approval while final review or publication blockers are unresolved.
- Avoid clips that remove limitations, caveats, or proof context.

## Required Source Assets

- transcript.md or final-script.md
- final-review.md
- publication-blockers.md

## Repurposing Blockers

${markdownList(verdict.blockers, "No repurposing blockers detected.")}

## Repurposing Gate

- Status: ${verdict.status}
- Reason: ${verdict.reason}
- Next actions:
${markdownList(verdict.nextActions, "Proceed to cut shorts.")}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const verdict = determineRepurposingStatus(context);
  return {
    context,
    verdict,
    files: [
      [REPURPOSING_PLAN_FILE, buildRepurposingPlan(context, verdict)],
      [SHORTS_CANDIDATES_FILE, buildShortsCandidates(context, verdict)],
      [PLATFORM_VARIANTS_FILE, buildPlatformVariants(context, verdict)],
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
  console.log(`repurposing: ${outputs.verdict.status}`);
  console.log(`ready to cut shorts: ${outputs.verdict.readyToCutShorts ? "yes" : "no"}`);
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
  REPURPOSING_PLAN_FILE,
  SHORTS_CANDIDATES_FILE,
  PLATFORM_VARIANTS_FILE,
  usage,
  parseArgs,
  hasExactApprovalMarker,
  hasOpenPublicationBlockers,
  readContext,
  determineRepurposingStatus,
  buildRepurposingPlan,
  buildShortsCandidates,
  buildPlatformVariants,
  buildOutputs,
  writeOutputs,
  main,
};
