#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const researchPack = require("./package-run-research-pack.js");
const scriptStructureTool = require("./package-run-script-structure.js");

const TOOL_NAME = "package-run-production-plan.js";
const TARGET_FILES = [
  "production-plan.md",
  "shot-list.md",
  "screen-capture-list.md",
  "demo-list.md",
  "b-roll-list.md",
  "graphics-list.md",
  "audio-notes.md",
  "production-blockers.md",
];

const INPUT_FILES = [
  "script-review.md",
  "script-revision-plan.md",
  "final-script.md",
  "script-draft.md",
  "script-structure.md",
  "research-pack.md",
  "research-sufficiency-review.md",
  "research-evidence.md",
  "source-support-map.md",
  "proof-capture-plan.md",
  "research-objections.md",
  "selected-package.json",
  "selected-package.md",
  "creator-qa-report.json",
  "creator-qa-report.md",
];

function usage() {
  return [
    "Usage: node scripts/package-run-production-plan.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-production-plan.js --help",
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
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*([^\\n\\r]+)`, "im");
  const match = String(markdown || "").match(pattern);
  return match ? cleanString(match[1]) : "";
}

function hasExactApprovalMarker(...texts) {
  return texts.some((text) =>
    /^(?:[-*]\s*)?(?:Manual approval|Production planning approval|Shoot approval):\s*PASS\s*$/im.test(String(text || ""))
  );
}

function findScriptPath(runDir) {
  const finalPath = path.join(runDir, "final-script.md");
  if (fs.existsSync(finalPath)) return finalPath;
  const draftPath = path.join(runDir, "script-draft.md");
  if (fs.existsSync(draftPath)) return draftPath;
  return "";
}

function parseResearchGate(markdown = "") {
  const text = String(markdown || "");
  if (!text) {
    return {
      status: "MISSING",
      approved: false,
      manualApproval: false,
      reason: "research-pack.md is missing.",
    };
  }
  const gateIndex = text.search(/^##\s+Research Sufficiency Gate\s*$/im);
  const gateText = gateIndex === -1 ? text : text.slice(gateIndex);
  const status = (lineValue(gateText, "Status") || "MISSING").toUpperCase();
  const manualApproval = hasExactApprovalMarker(gateText);
  return {
    status,
    approved: status === "PASS" || manualApproval,
    manualApproval,
    reason:
      status === "PASS" || manualApproval
        ? "Research gate has PASS or an exact manual approval marker."
        : `Research gate is ${status}; production planning cannot approve shooting yet.`,
  };
}

function readResearchGate(runDir, researchPackMarkdown = "") {
  const packGate = parseResearchGate(researchPackMarkdown);
  if (packGate.approved) return packGate;

  const reviewPath = scriptStructureTool.findResearchSufficiencyReviewPath(runDir);
  if (reviewPath) {
    const reviewGate = scriptStructureTool.parseResearchSufficiencyReviewStatus(fs.readFileSync(reviewPath, "utf8"), runDir);
    return {
      status: reviewGate.status,
      approved: Boolean(reviewGate.readyToDraft),
      manualApproval: false,
      reason: reviewGate.reason,
      sourceFile: "research-sufficiency-review.md",
    };
  }

  return packGate;
}

function parseScriptStructureGate(markdown = "") {
  const text = String(markdown || "");
  if (!text) {
    return {
      status: "MISSING",
      readyToDraft: false,
      manualApproval: false,
      reason: "script-structure.md is missing.",
    };
  }
  const status = (lineValue(text, "Script structure status") || "MISSING").toUpperCase();
  const readyText = lineValue(text, "Ready to draft").toLowerCase();
  const manualApproval = hasExactApprovalMarker(text);
  const readyToDraft = status === "READY TO DRAFT" || readyText === "yes" || manualApproval;
  return {
    status,
    readyToDraft,
    manualApproval,
    reason: readyToDraft
      ? "Script structure is ready to draft or has an exact manual approval marker."
      : `Script structure is ${status}; production planning cannot approve shooting yet.`,
  };
}

function parseScriptReviewGate(markdown = "") {
  const text = String(markdown || "");
  if (!text) {
    return {
      status: "MISSING",
      productionPlanningReady: false,
      reason: "script-review.md is missing.",
    };
  }
  const status = (lineValue(text, "Script review status") || "MISSING").toUpperCase();
  const productionPlanningReady = lineValue(text, "Production planning ready").toLowerCase() === "yes";
  return {
    status,
    productionPlanningReady,
    reason:
      status === "PASS" && productionPlanningReady
        ? "Script review is PASS and production planning is ready."
        : `Script review status is ${status}; production planning ready is ${productionPlanningReady ? "yes" : "no"}.`,
  };
}

function readJsonSummary(text) {
  try {
    const payload = JSON.parse(text);
    const source = payload && typeof payload === "object" && payload.package ? payload.package : payload;
    if (!source || typeof source !== "object") return "";
    return cleanString(
      source.proposedTitle ||
        source.proposed_title ||
        source.title ||
        source.viewerPromise ||
        source.viewer_promise ||
        source.idea ||
        source.topic
    );
  } catch (_error) {
    return "";
  }
}

function selectedPackageSummary(files) {
  if (files["selected-package.json"]) return readJsonSummary(files["selected-package.json"]) || "Selected package JSON is present.";
  if (files["selected-package.md"]) {
    const heading = files["selected-package.md"]
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith("# "));
    return heading ? heading.replace(/^#\s+/, "").replace(/^Selected Package:\s*/i, "").trim() : "Selected package markdown is present.";
  }
  return "No selected package summary is available.";
}

function sectionText(markdown, heading) {
  return researchPack.sectionText(String(markdown || ""), heading);
}

function relevantLines(text, patterns, limit = 8) {
  const seen = new Set();
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/\[[ xX]\]\s*/, "").trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^do not\b/i.test(line))
    .filter((line) => !/^(status|reason|review note):/i.test(line))
    .filter((line) => !/^required before production planning:?$/i.test(line))
    .filter((line) => !/^proof section$/i.test(line))
    .filter((line) => !/^ready to draft\b/i.test(line))
    .filter((line) => !/^research sufficiency gate\b/i.test(line))
    .filter((line) => !/\bproduction planning cannot be approved\b/i.test(line))
    .filter((line) => !/\bnot approved\b/i.test(line))
    .filter((line) => !/\bexplicitly manually approved\b/i.test(line))
    .filter((line) => patterns.some((pattern) => pattern.test(line)))
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function buildTemplateRows(items, columns, fallbackFirstColumn) {
  const values = items.map(cleanString).filter(Boolean);
  const rows = values.length ? values : [fallbackFirstColumn];
  return rows
    .map((item, index) => {
      const priority = index === 0 ? "high" : "medium";
      if (columns === "shots") return `| ${item} | Supports a visible script beat. | ${priority} | TODO |`;
      if (columns === "captures") return `| ${item} | Proves or documents the on-screen claim. | local app / browser / Resolve | TODO |`;
      if (columns === "demos") return `| ${item} | Shows the viewer the workflow instead of only describing it. | Prepare source files, tabs, and clean state. | TODO |`;
      if (columns === "broll") return `| ${item} | Gives the edit concrete visual proof or pacing support. | Capture locally or use approved project media. | TODO |`;
      if (columns === "graphics") return `| ${item} | Makes the idea easier to scan and remember. | Script, research pack, or captured proof. | TODO |`;
      return `| ${item} | TODO | TODO | TODO |`;
    })
    .join("\n");
}

function readPlannerContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const scriptPath = findScriptPath(runDir);
  const scriptName = scriptPath ? path.basename(scriptPath) : "missing";
  const scriptText = scriptPath ? fs.readFileSync(scriptPath, "utf8") : "";
  const reviewGate = parseScriptReviewGate(files["script-review.md"]);
  const researchGate = readResearchGate(runDir, files["research-pack.md"]);
  const structureGate = parseScriptStructureGate(files["script-structure.md"]);
  const combinedText = [
    files["script-review.md"],
    files["script-revision-plan.md"],
    scriptText,
    files["script-structure.md"],
    files["research-pack.md"],
    files["creator-qa-report.md"],
  ].join("\n");
  const productionText = [
    scriptText,
    files["script-structure.md"],
    files["research-pack.md"],
  ].join("\n");

  return {
    runId: path.basename(runDir),
    files,
    scriptPath,
    scriptName,
    scriptText,
    reviewGate,
    researchGate,
    structureGate,
    selectedSummary: selectedPackageSummary(files),
    combinedText,
    productionText,
  };
}

function determineShootReadiness(context) {
  const blockers = [];
  const nextActions = [];

  if (!context.files["script-review.md"]) {
    blockers.push("script-review.md is missing.");
    nextActions.push("Run script review after the script is ready: node scripts/package-run-script-review.js package-runs/<run-id>");
  } else {
    if (context.reviewGate.status !== "PASS") blockers.push(`Script review status is ${context.reviewGate.status}, not PASS.`);
    if (!context.reviewGate.productionPlanningReady) blockers.push("Production planning ready is no.");
  }

  if (!context.researchGate.approved) {
    blockers.push(`Research gate status is ${context.researchGate.status}. ${context.researchGate.reason || ""}`.trim());
    nextActions.push("Repair or manually approve research with an exact approval marker.");
  }

  if (!context.structureGate.readyToDraft) {
    blockers.push(`Script structure status is ${context.structureGate.status}.`);
    nextActions.push("Repair or manually approve script structure with an exact approval marker.");
  }

  if (!context.scriptPath) {
    blockers.push("No final-script.md or script-draft.md exists.");
    nextActions.push("Create or restore final-script.md or script-draft.md before production planning can approve shooting.");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueNextActions = [...new Set(nextActions)];

  if (!context.scriptPath) {
    return {
      status: "BLOCKED",
      reason: uniqueBlockers.join(" "),
      blockers: uniqueBlockers,
      nextActions: uniqueNextActions,
    };
  }
  if (!context.files["script-review.md"] || context.reviewGate.status !== "PASS") {
    return {
      status: "NEEDS SCRIPT APPROVAL",
      reason: uniqueBlockers.join(" "),
      blockers: uniqueBlockers,
      nextActions: uniqueNextActions,
    };
  }
  if (uniqueBlockers.length) {
    return {
      status: "BLOCKED",
      reason: uniqueBlockers.join(" "),
      blockers: uniqueBlockers,
      nextActions: uniqueNextActions,
    };
  }
  return {
    status: "READY TO SHOOT",
    reason: "Script review, production planning readiness, research gate, script structure, and script file are all approved.",
    blockers: [],
    nextActions: ["Review the generated production lists, then capture only the approved scope."],
  };
}

function inputWarnings(context) {
  const warnings = [];
  INPUT_FILES.forEach((filename) => {
    if (!context.files[filename]) warnings.push(`Missing ${filename}.`);
  });
  if (context.files["script-review.md"] && context.reviewGate.status === "MISSING") {
    warnings.push("script-review.md does not contain an exact Script review status line.");
  }
  if (context.files["script-review.md"] && lineValue(context.files["script-review.md"], "Production planning ready") === "") {
    warnings.push("script-review.md does not contain an exact Production planning ready line.");
  }
  return warnings;
}

function buildProductionPlan(context, readiness) {
  const warnings = inputWarnings(context);
  const requiredShots = relevantLines(context.productionText, [/shot/i, /a-roll/i, /camera/i, /talking/i, /record/i]);
  const captures = relevantLines(context.productionText, [/screen/i, /capture/i, /recording/i, /screenshot/i, /proof/i]);
  const demos = relevantLines(context.productionText, [/demo/i, /example/i, /workflow/i, /show/i, /prove/i]);
  const broll = relevantLines(context.productionText, [/b-roll/i, /visual/i, /timeline/i, /ui/i, /before/i, /after/i]);
  const graphics = relevantLines(context.productionText, [/graphic/i, /diagram/i, /table/i, /score/i, /framework/i, /checklist/i, /thumbnail/i]);
  const props = relevantLines(context.productionText, [/file/i, /app/i, /account/i, /tab/i, /asset/i, /source/i]);
  const risks = [...readiness.blockers, ...relevantLines(context.combinedText, [/risk/i, /blocked/i, /missing/i, /unsupported/i], 6)];

  return `# Production Plan

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Source script: ${context.scriptName}
- Script review status: ${context.reviewGate.status}
- Production planning ready from review: ${context.reviewGate.productionPlanningReady ? "yes" : "no"}
- Research gate status: ${context.researchGate.status}
- Script structure status: ${context.structureGate.status}
- Shoot-readiness status: ${readiness.status}
- External APIs called: no

## Input Warnings

${markdownList(warnings, "None.")}

## Production Goal

- Convert the approved script and review state into concrete VIDTOOLZ production work.
- Package: ${context.selectedSummary}
- Keep production scope local-first and inspectable before shooting.

## Approved / Not Approved Boundary

- Approved boundary: ${readiness.status === "READY TO SHOOT" ? "The planner can be used for shooting preparation." : "Shooting is not approved by this planner."}
- Not approved: rough-cut review, final review, publish pack, archive manifest, Shorts or repurposing plan.
- This tool is a production planning gate and list generator. package-engine-new-production.js remains the broader production prep pack.

## Required Live Shots

${markdownList(requiredShots, "Define A-roll or live camera shots after script approval.")}

## Required Screen Recordings

${markdownList(captures, "Define screen recordings that prove the main claims or workflow steps.")}

## Required Demos

${markdownList(demos, "Define demos from the approved script, research pack, and review notes.")}

## Required B-Roll

${markdownList(broll, "Define supporting UI, timeline, before/after, or workflow visuals.")}

## Required Graphics

${markdownList(graphics, "Define diagrams, labels, tables, scorecards, or clarity graphics.")}

## Audio Capture Plan

- Capture clean voiceover or A-roll audio for the approved script only.
- Record room tone or a short silence sample for repair.
- Mark any line that depends on unresolved research as not recordable.

## Props / Files / Apps / Accounts Needed

${markdownList(props, "List required local files, apps, accounts, tabs, captures, and project assets before shooting.")}

## Production Risks

${markdownList(risks, "No production risks detected by this local planner.")}

## Production Blockers

${markdownList(readiness.blockers, "None.")}

## Shoot-Readiness Gate

- Status: ${readiness.status}
- Reason: ${readiness.reason}
- Next actions:
${markdownList(readiness.nextActions, "Review generated lists before shooting.")}
`;
}

function buildShotList(context) {
  const shots = relevantLines(context.productionText, [/shot/i, /a-roll/i, /camera/i, /talking/i, /record/i]);
  return `# Shot List

| shot | reason | priority | status |
| --- | --- | --- | --- |
${buildTemplateRows(shots, "shots", "TODO: approved hook or explanation shot")}
`;
}

function buildScreenCaptureList(context) {
  const captures = relevantLines(context.productionText, [/screen/i, /capture/i, /recording/i, /screenshot/i, /proof/i]);
  return `# Screen Capture List

| capture | proof purpose | source/app | status |
| --- | --- | --- | --- |
${buildTemplateRows(captures, "captures", "TODO: approved proof screen recording")}
`;
}

function buildDemoList(context) {
  const demos = relevantLines(context.productionText, [/demo/i, /example/i, /workflow/i, /show/i, /prove/i]);
  return `# Demo List

| demo | what it proves | setup needed | status |
| --- | --- | --- | --- |
${buildTemplateRows(demos, "demos", "TODO: approved main demonstration")}
`;
}

function buildBRollList(context) {
  const broll = relevantLines(context.productionText, [/b-roll/i, /visual/i, /timeline/i, /ui/i, /before/i, /after/i]);
  return `# B-Roll List

| b-roll item | reason | source | status |
| --- | --- | --- | --- |
${buildTemplateRows(broll, "broll", "TODO: supporting production b-roll")}
`;
}

function buildGraphicsList(context) {
  const graphics = relevantLines(context.productionText, [/graphic/i, /diagram/i, /table/i, /score/i, /framework/i, /checklist/i, /thumbnail/i]);
  return `# Graphics List

| graphic | clarity purpose | source/input | status |
| --- | --- | --- | --- |
${buildTemplateRows(graphics, "graphics", "TODO: clarity graphic from approved script")}
`;
}

function buildAudioNotes(context, readiness) {
  const voiceover = relevantLines(context.productionText, [/voice/i, /audio/i, /mic/i, /narration/i, /line/i], 6);
  return `# Audio Notes

## Mic / Capture Notes

- Use the normal VIDTOOLZ mic setup.
- Capture a short room tone or silence sample.
- Do not record unresolved or blocked sections as final audio.

## Voiceover Notes

${markdownList(voiceover, "Record voiceover only from the approved script source.")}

## Music / SFX Notes

- Keep music and SFX secondary to proof clarity.
- Mark any transition that needs emphasis after the screen captures are reviewed.

## Risks

${markdownList(readiness.blockers, "No audio-specific blockers detected by this local planner.")}
`;
}

function buildProductionBlockers(context, readiness) {
  return `# Production Blockers

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
${readiness.blockers.length
  ? readiness.blockers
      .map((blocker) => `| ${blocker} | Shooting before this is resolved could create unsupported or wasted footage. | Resolve the gate or add an exact approved marker where allowed. | open |`)
      .join("\n")
  : "| None. | Required gates are currently satisfied. | Keep review evidence with the run. | closed |"}

## Gate Summary

- Script review status: ${context.reviewGate.status}
- Production planning ready from review: ${context.reviewGate.productionPlanningReady ? "yes" : "no"}
- Research gate status: ${context.researchGate.status}
- Script structure status: ${context.structureGate.status}
- Source script: ${context.scriptName}
- Shoot-readiness status: ${readiness.status}
`;
}

function buildOutputs(runDir) {
  const context = readPlannerContext(runDir);
  const readiness = determineShootReadiness(context);
  return {
    context,
    readiness,
    files: [
      ["production-plan.md", buildProductionPlan(context, readiness)],
      ["shot-list.md", buildShotList(context)],
      ["screen-capture-list.md", buildScreenCaptureList(context)],
      ["demo-list.md", buildDemoList(context)],
      ["b-roll-list.md", buildBRollList(context)],
      ["graphics-list.md", buildGraphicsList(context)],
      ["audio-notes.md", buildAudioNotes(context, readiness)],
      ["production-blockers.md", buildProductionBlockers(context, readiness)],
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
  console.log(`production planner: ${outputs.readiness.status}`);
  console.log(`reason: ${outputs.readiness.reason}`);
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
  usage,
  parseArgs,
  lineValue,
  hasExactApprovalMarker,
  findScriptPath,
  parseResearchGate,
  readResearchGate,
  parseScriptStructureGate,
  parseScriptReviewGate,
  readPlannerContext,
  determineShootReadiness,
  buildProductionPlan,
  buildShotList,
  buildScreenCaptureList,
  buildDemoList,
  buildBRollList,
  buildGraphicsList,
  buildAudioNotes,
  buildProductionBlockers,
  buildOutputs,
  writeOutputs,
  main,
};
