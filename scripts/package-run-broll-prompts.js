#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-broll-prompts.js";
const BROLL_PROMPT_PACK_FILE = "broll-prompt-pack.md";
const VISUAL_SCENE_PROMPTS_FILE = "visual-scene-prompts.md";
const STOCK_SEARCH_QUERIES_FILE = "stock-search-queries.md";
const GRAPHICS_PROMPT_PACK_FILE = "graphics-prompt-pack.md";
const VISUAL_RISK_CHECK_FILE = "visual-risk-check.md";
const TARGET_FILES = [
  BROLL_PROMPT_PACK_FILE,
  VISUAL_SCENE_PROMPTS_FILE,
  STOCK_SEARCH_QUERIES_FILE,
  GRAPHICS_PROMPT_PACK_FILE,
  VISUAL_RISK_CHECK_FILE,
];

const INPUT_FILES = [
  "final-script.md",
  "script-draft.md",
  "script-structure.md",
  "script-review.md",
  "production-plan.md",
  "shot-list.md",
  "screen-capture-list.md",
  "b-roll-list.md",
  "graphics-list.md",
  ...TARGET_FILES,
];

function usage() {
  return [
    "Usage: node scripts/package-run-broll-prompts.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-broll-prompts.js --help",
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

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function tableCell(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "/")
    .trim();
}

function isAssessedText(value) {
  const text = cleanString(value);
  return Boolean(text) && !/^(?:todo|tbd|placeholder|n\/a|na|none|not applicable|not assessed)$/i.test(text);
}

function hasPlaceholderText(value) {
  return /\b(?:todo|tbd|placeholder|not assessed|not applicable)\b/i.test(String(value || ""));
}

function hasExactVisualPromptApproval(...texts) {
  return texts.some((text) => /^(?:[-*]\s*)?Visual prompt approval:\s*PASS\s*$/im.test(String(text || "")));
}

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .filter((line) => !isTableHeaderRow(line));
}

function rowCells(row) {
  return String(row || "")
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isTableHeaderRow(row) {
  const headerLabels = new Set([
    "prompt",
    "purpose",
    "status",
    "scene",
    "query",
    "usage guard",
    "graphic",
    "clarity purpose",
    "risk",
    "mitigation",
    "b-roll item",
    "reason",
    "source",
    "shot",
    "priority",
    "capture",
    "proof purpose",
    "source/app",
    "source/input",
  ]);
  const cells = rowCells(row).map((cell) => cell.toLowerCase());
  return cells.length > 1 && cells.every((cell) => headerLabels.has(cell));
}

function hasRealPromptRows(...texts) {
  return texts.some((text) =>
    tableRows(text).some((row) => {
      const cells = rowCells(row);
      const status = cells[cells.length - 1] || "";
      const evidence = cells.slice(0, -1).join(" ");
      return isAssessedText(evidence) && !hasPlaceholderText(evidence) && !/^(?:todo|open|blocked)$/i.test(status);
    })
  );
}

function sourceScript(files) {
  if (files["final-script.md"]) return { file: "final-script.md", text: files["final-script.md"] };
  if (files["script-draft.md"]) return { file: "script-draft.md", text: files["script-draft.md"] };
  return { file: "missing", text: "" };
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const script = sourceScript(files);
  const scriptReviewStatus = (lineValue(files["script-review.md"], "Script review status") || "MISSING").toUpperCase();
  const shootReadinessStatus = files["production-plan.md"]
    ? (lineValue(files["production-plan.md"], "Shoot-readiness status") || lineValue(files["production-plan.md"], "Status") || "MISSING").toUpperCase()
    : "MISSING";
  const targetTexts = TARGET_FILES.map((filename) => files[filename]);
  return {
    runId: path.basename(runDir),
    files,
    script,
    scriptReviewStatus,
    shootReadinessStatus,
    visualPromptApproval: hasExactVisualPromptApproval(...targetTexts),
    realPromptRows: hasRealPromptRows(...targetTexts),
  };
}

function determineStatus(context) {
  const blockers = [];
  const nextActions = [];
  if (!context.script.text) {
    blockers.push("final-script.md or script-draft.md is missing.");
    nextActions.push("Add an approved script before generating visual prompts.");
  }
  if (!context.files["script-review.md"]) {
    blockers.push("script-review.md is missing.");
    nextActions.push("Run script review before generating visual prompts.");
  } else if (context.scriptReviewStatus !== "PASS") {
    blockers.push(`Script review status is ${context.scriptReviewStatus}, not PASS.`);
    nextActions.push("Resolve script review before generating visual prompts.");
  }
  if (context.files["production-plan.md"] && context.shootReadinessStatus !== "READY TO SHOOT") {
    blockers.push(`Shoot-readiness status is ${context.shootReadinessStatus}, not READY TO SHOOT.`);
    nextActions.push("Resolve production planning before generating visual prompts.");
  }

  if (blockers.length) {
    return {
      status: "BLOCKED",
      reason: [...new Set(blockers)].join(" "),
      blockers: [...new Set(blockers)],
      nextActions: [...new Set(nextActions)],
    };
  }

  if (context.visualPromptApproval && context.realPromptRows) {
    return {
      status: "PASS",
      reason: "Exact visual prompt approval marker is present and real prompt rows exist.",
      blockers: [],
      nextActions: ["Use approved prompt artifacts only as reviewable briefs; this tool does not generate or download assets."],
    };
  }

  return {
    status: "NEEDS REVIEW",
    reason: context.visualPromptApproval
      ? "Visual prompt approval marker is present, but real prompt rows were not detected."
      : "Visual prompts need human review and exact Visual prompt approval: PASS before they pass.",
    blockers: context.visualPromptApproval ? ["Real non-placeholder visual prompt rows are missing."] : [],
    nextActions: ["Review visual prompts for accuracy, rights, taste, and production feasibility before approval."],
  };
}

function inputWarnings(context) {
  return INPUT_FILES.filter((filename) => !context.files[filename]).map((filename) => `Missing ${filename}.`);
}

function isCleanSourceLine(line) {
  const text = cleanString(line);
  return (
    text.length >= 28 &&
    !hasPlaceholderText(text) &&
    !/^\[[ xX]\]\s+/.test(text) &&
    !/^\|/.test(text) &&
    !/^(?:run|tool|status|source script|script review status|shoot-readiness status|external apis called|visual prompt approval|final-outline\.md|script-prompt\.md|script-draft\.md|final-script\.md|production-notes\.md)\s*:/i.test(text) &&
    !/\.md:\s*(?:present|missing|created|not present)/i.test(text)
  );
}

function tidySourceLine(line) {
  return cleanString(
    String(line || "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
  );
}

function extractLines(text, limit = 8) {
  const seen = new Set();
  return String(text || "")
    .split(/\r?\n/)
    .map(tidySourceLine)
    .filter(isCleanSourceLine)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function isReadyPlanningStatus(status) {
  return /^(?:closed|captured|reviewed|ready|approved|complete|done)$/i.test(cleanString(status));
}

function cleanPlanningItem(value) {
  const text = tableCell(value)
    .replace(/\s+\/\s*(?:closed|captured|reviewed|ready|approved|complete|done)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!isCleanSourceLine(text)) return "";
  if (/^(?:source|reason|status|b-roll item|shot|capture|graphic|clarity purpose|proof purpose)$/i.test(text)) return "";
  return text;
}

function planningRows(markdown = "") {
  return tableRows(markdown)
    .map(rowCells)
    .filter((cells) => cells.length >= 2)
    .filter((cells) => isReadyPlanningStatus(cells[cells.length - 1]))
    .map((cells) => cleanPlanningItem(cells[0]))
    .filter(Boolean);
}

function uniqueValues(values, limit = 6) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const cleaned = cleanPlanningItem(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });
  return result.slice(0, limit);
}

function planningLines(context, filename, fallbackPatterns, limit = 6) {
  const rows = uniqueValues(planningRows(context.files[filename]), limit);
  if (rows.length) return rows;
  const lines = uniqueValues(extractLines(context.files[filename], limit), limit);
  if (lines.length) return lines;
  const combined = fallbackPatterns.map((pattern) => extractLines(context.script.text).find((line) => pattern.test(line))).filter(Boolean);
  return combined.length ? uniqueValues(combined, limit) : extractLines(context.script.text, limit);
}

function conciseBrief(line, maxLength = 96) {
  const text = cleanPlanningItem(line).replace(/\.$/, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function stockQuery(line) {
  const text = conciseBrief(line, 70)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(?:show|capture|record|the|and|with|against|into|from|that|this|how)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || "creator workflow proof";
}

function promptStatus(verdict) {
  return verdict.status === "PASS" ? "closed" : verdict.status === "BLOCKED" ? "blocked" : "review-needed";
}

function promptRows(context, verdict) {
  if (verdict.status === "BLOCKED") {
    return "| Not assessed. | Approved script and planning gates are required before visual prompts can be assessed. | blocked |";
  }
  const lines = planningLines(context, "b-roll-list.md", [/visual|show|proof|example|scene/i]);
  return lines
    .map((line) => `| Film a concise visual of ${tableCell(conciseBrief(line))}. | Show the viewer the concrete idea without inventing evidence. | ${promptStatus(verdict)} |`)
    .join("\n");
}

function visualSceneRows(context, verdict) {
  if (verdict.status === "BLOCKED") {
    return "| Not assessed. | Missing approved source material. | Keep blocked until script review passes. | blocked |";
  }
  const lines = extractLines(context.script.text, 6);
  return lines
    .map((line) => `| ${tableCell(conciseBrief(line, 72))} | Practical VIDTOOLZ production workspace scene showing ${tableCell(conciseBrief(line, 90))}; natural screen-light, no fake product claims. | ${promptStatus(verdict)} |`)
    .join("\n");
}

function stockQueryRows(context, verdict) {
  if (verdict.status === "BLOCKED") {
    return "| Not assessed. | Missing approved source material. | blocked |";
  }
  const lines = planningLines(context, "shot-list.md", [/workflow|creator|editing|screen|planning/i]);
  return lines
    .map((line) => `| ${tableCell(stockQuery(line))} | Use only rights-clear stock or locally captured footage. | ${promptStatus(verdict)} |`)
    .join("\n");
}

function graphicsRows(context, verdict) {
  if (verdict.status === "BLOCKED") {
    return "| Not assessed. | Missing approved source material. | blocked |";
  }
  const lines = planningLines(context, "graphics-list.md", [/score|matrix|framework|steps|before|after/i]);
  return lines
    .map((line) => `| Create an explanatory graphic for ${tableCell(conciseBrief(line))}. | Clarify the argument without adding unsupported claims. | ${promptStatus(verdict)} |`)
    .join("\n");
}

function buildBrollPromptPack(context, verdict) {
  return `# B-Roll Prompt Pack

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Source script: ${context.script.file}
- Script review status: ${context.scriptReviewStatus}
- Shoot-readiness status: ${context.files["production-plan.md"] ? context.shootReadinessStatus : "not checked; production-plan.md missing"}
- Visual prompt status: ${verdict.status}
- Visual prompt approval: ${context.visualPromptApproval ? "PASS" : "missing"}
- External APIs called: no

## Input Warnings

${markdownList(inputWarnings(context), "None.")}

## Boundary

- This tool writes reviewable local prompt briefs only.
- It does not call external APIs, generate images or videos, download assets, upload, publish, archive, schedule, or inspect media files.

## B-Roll Prompts

| prompt | purpose | status |
| --- | --- | --- |
${promptRows(context, verdict)}

## Visual Prompt Gate

- Status: ${verdict.status}
- Reason: ${verdict.reason}
- Next actions:
${markdownList(verdict.nextActions, "Review visual prompts manually.")}
`;
}

function buildVisualScenePrompts(context, verdict) {
  return `# Visual Scene Prompts

| scene | prompt | status |
| --- | --- | --- |
${visualSceneRows(context, verdict)}
`;
}

function buildStockSearchQueries(context, verdict) {
  return `# Stock Search Queries

| query | usage guard | status |
| --- | --- | --- |
${stockQueryRows(context, verdict)}
`;
}

function buildGraphicsPromptPack(context, verdict) {
  return `# Graphics Prompt Pack

| graphic | clarity purpose | status |
| --- | --- | --- |
${graphicsRows(context, verdict)}
`;
}

function buildVisualRiskCheck(context, verdict) {
  const status = promptStatus(verdict);
  const risks = verdict.status === "BLOCKED"
    ? ["Not assessed until script review passes and a script exists."]
    : [
        "Do not imply external evidence has been verified unless the source artifact proves it.",
        "Do not use stock visuals that misrepresent the actual workflow or tool output.",
        "Do not create graphics that add unsupported numerical claims.",
      ];
  return `# Visual Risk Check

- Visual prompt status: ${verdict.status}
- External APIs called: no

| risk | mitigation | status |
| --- | --- | --- |
${risks.map((risk) => `| ${tableCell(risk)} | Human review before asset creation or stock search. | ${status} |`).join("\n")}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const verdict = determineStatus(context);
  return {
    context,
    verdict,
    files: [
      [BROLL_PROMPT_PACK_FILE, buildBrollPromptPack(context, verdict)],
      [VISUAL_SCENE_PROMPTS_FILE, buildVisualScenePrompts(context, verdict)],
      [STOCK_SEARCH_QUERIES_FILE, buildStockSearchQueries(context, verdict)],
      [GRAPHICS_PROMPT_PACK_FILE, buildGraphicsPromptPack(context, verdict)],
      [VISUAL_RISK_CHECK_FILE, buildVisualRiskCheck(context, verdict)],
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
  console.log(`visual prompt status: ${outputs.verdict.status}`);
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
  usage,
  parseArgs,
  isAssessedText,
  hasExactVisualPromptApproval,
  tableRows,
  planningRows,
  hasRealPromptRows,
  sourceScript,
  readContext,
  determineStatus,
  buildBrollPromptPack,
  buildOutputs,
  writeOutputs,
  main,
};
