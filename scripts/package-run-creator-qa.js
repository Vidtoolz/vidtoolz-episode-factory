#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const outlineScript = require("./package-engine-new-outline.js");

const DEFAULT_CREATOR_QA_ROOT = "/home/vidtoolz/vidtoolz-creator-qa";
const DEFAULT_PROFILE = "ai_video_breakdown";
const QA_OUTPUT_FILES = ["creator-qa-package.md", "creator-qa-report.md", "creator-qa-report.json"];

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    runFolder: "",
    force: false,
    profile: DEFAULT_PROFILE,
    creatorQaRoot: DEFAULT_CREATOR_QA_ROOT,
  };
  while (args.length) {
    const item = args.shift();
    if (item === "--force") {
      result.force = true;
    } else if (item === "--profile") {
      result.profile = args.shift() || result.profile;
    } else if (item === "--creator-qa-root") {
      result.creatorQaRoot = args.shift() || result.creatorQaRoot;
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }
  return result;
}

function readOptionalFile(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function selectedPackageData(selectedPath) {
  const text = fs.readFileSync(selectedPath, "utf8");
  if (!selectedPath.endsWith(".json")) return { markdown: outlineScript.readSelectedPackage(selectedPath), data: {} };
  const payload = JSON.parse(text);
  const source = payload && typeof payload === "object" && payload.package ? payload.package : payload;
  return { markdown: outlineScript.readSelectedPackage(selectedPath), data: source && typeof source === "object" ? source : {} };
}

function firstUsefulLine(text) {
  return cleanString(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim())
    .find((line) => line && !/^run:|^status:/i.test(line)) || "";
}

function extractMarkdownSection(markdown, headingText) {
  const wanted = String(headingText || "").trim().toLowerCase();
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let capture = false;
  let captureLevel = 0;
  const section = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const label = heading[2].replace(/#+\s*$/g, "").trim().toLowerCase();
      if (capture && level <= captureLevel) break;
      if (!capture && label === wanted) {
        capture = true;
        captureLevel = level;
        continue;
      }
    }
    if (capture) section.push(line);
  }

  return sanitizePackageContent(section.join("\n"));
}

function isInternalPackageLine(line) {
  const value = String(line || "").trim();
  if (!value) return false;
  return (
    /^run:/i.test(value) ||
    /^status:/i.test(value) ||
    /^source files:?$/i.test(value) ||
    /^[-*]\s+\[[ xX]\]/.test(value) ||
    /generated workflow instructions/i.test(value) ||
    /review\s+final-script\.md/i.test(value)
  );
}

function sanitizePackageContent(markdown) {
  return String(markdown || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !isInternalPackageLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function demoteMarkdownHeadings(markdown) {
  return String(markdown || "").replace(/^#(\s+)/gm, "##$1");
}

function sectionHasCreatorQaCta(text) {
  return /\b(subscribe|comment|like|download|grab|watch next)\b/i.test(String(text || ""));
}

function normalizeCtaHeading(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const heading = lines[index].match(/^(#{2,6})\s+CTA\s*$/i);
    if (!heading) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const level = heading[1].length;
    const body = [];
    index += 1;
    while (index < lines.length) {
      const nextHeading = lines[index].match(/^(#{2,6})\s+.+$/);
      if (nextHeading && nextHeading[1].length <= level) break;
      body.push(lines[index]);
      index += 1;
    }

    const bodyText = body.join("\n").trim();
    output.push(`${heading[1]} Call to Action`);
    if (bodyText) {
      output.push("");
      output.push(sectionHasCreatorQaCta(bodyText) ? bodyText : `Watch next: ${bodyText}`);
    }
  }
  return output.join("\n");
}

function cleanNoteValue(value) {
  const text = sanitizePackageContent(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim())
    .filter((line) => line)
    .filter((line) => !/package-runs\/|^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/i.test(line))
    .filter((line) => !/production prep v|source files|generated workflow|workflow version/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 260 ? `${text.slice(0, 257).trim()}...` : text;
}

function dataValue(source, keys) {
  const found = keys.find((key) => cleanString(source[key]));
  return found ? cleanString(source[found]) : "";
}

function markdownField(markdown, labels) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim();
    const match = cleaned.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    if (labels.some((item) => item.toLowerCase() === label)) return match[2].trim();
  }
  return "";
}

function contextValue(selected, label, dataKeys, markdownLabels, fallbackTexts = []) {
  const source = selected.data || {};
  return cleanNoteValue(
    dataValue(source, dataKeys) ||
      markdownField(selected.markdown, markdownLabels) ||
      fallbackTexts.find((item) => cleanNoteValue(item)) ||
      ""
  );
}

function buildNotes(input = {}) {
  const selected = input.selected || { markdown: "", data: {} };
  const notes = [
    "## Source Notes / Manual Verification",
    "- Manual verification: Check cost details, launch timing, benchmark-style numbers, app fit, and speed claims outside this package.",
    "- Manual verification: Check any AI tool UI behavior shown in screen recordings before publishing.",
  ];
  const optional = [
    [
      "Thumbnail concept",
      contextValue(
        selected,
        "Thumbnail concept",
        ["thumbnailConcept", "thumbnail_concept", "thumbnailText", "thumbnail_text", "onThumbnailText", "on_thumbnail_text"],
        ["Thumbnail concept", "Thumbnail", "On-thumbnail text"]
      ),
    ],
    [
      "Target viewer",
      contextValue(selected, "Target viewer", ["targetViewer", "target_viewer", "viewer", "audience"], ["Target viewer", "Viewer", "Audience"]),
    ],
    [
      "Main risk",
      contextValue(
        selected,
        "Main risk",
        ["mainRisk", "main_risk", "risk", "risks", "strategicRisk", "strategic_risk", "whyItMightFail", "why_it_might_fail"],
        ["Main risk", "Risk", "Strategic risk", "Why it might fail"]
      ),
    ],
    [
      "Suggested demo/proof notes",
      contextValue(
        selected,
        "Suggested demo/proof notes",
        ["demoProof", "demo_proof", "proofPlan", "proof_plan", "suggestedDemo", "suggested_demo", "demoNotes", "demo_notes"],
        ["Suggested demo/proof notes", "Demo proof", "Proof plan", "Suggested demo", "Demo notes"],
        [extractMarkdownSection(input.finalScriptText || "", "Demonstration / Proof")]
      ),
    ],
  ].filter(([_label, value]) => value);

  optional.forEach(([label, value]) => notes.push(`- ${label}: ${value}`));
  return notes.join("\n");
}

function titleFromSelected(selected) {
  const source = selected.data || {};
  const fromData = cleanString(source.proposedTitle || source.proposed_title || source.title);
  if (fromData) return fromData;
  const heading = selected.markdown.split(/\r?\n/).find((line) => line.startsWith("# "));
  return heading ? heading.replace(/^#\s+/, "").replace(/^Selected Package:\s*/i, "").trim() : "Untitled package run";
}

function thumbnailFromSelected(selected) {
  const source = selected.data || {};
  return cleanString(source.onThumbnailText || source.on_thumbnail_text || source.thumbnailText || source.thumbnailConcept || source.thumbnail_concept) || "Not specified.";
}

function payoffFromSelected(selected) {
  const source = selected.data || {};
  return cleanString(source.viewerPromise || source.viewer_promise || source.promise) || "By the end, the viewer should receive the practical payoff promised by the package.";
}

function buildCreatorQaPackage(input = {}) {
  const selected = input.selected || { markdown: "", data: {} };
  const finalOutlineText = cleanString(input.finalOutlineText);
  const finalScriptText = cleanString(input.finalScriptText);
  const productionBriefText = cleanString(input.productionBriefText);
  const thumbnailTitleCheckText = cleanString(input.thumbnailTitleCheckText);
  const publishPackText = cleanString(input.publishPackText);
  const scriptText = normalizeCtaHeading(demoteMarkdownHeadings(sanitizePackageContent(finalScriptText))) || "Not provided.";
  const hook = extractMarkdownSection(finalScriptText, "Hook") || firstUsefulLine(scriptText) || payoffFromSelected(selected);
  const notes = buildNotes({
    selected,
    finalOutlineText,
    finalScriptText,
    productionBriefText,
    thumbnailTitleCheckText,
    publishPackText,
  });

  return `# Title
${titleFromSelected(selected)}

# Thumbnail
${thumbnailFromSelected(selected)}

# Hook
${hook}

# Viewer Payoff
${payoffFromSelected(selected)}

# Script
${scriptText}

# Notes
${notes}
`;
}

function assertCanWriteOutputs(runDir, packageMarkdown, force = false) {
  if (force) return;
  const packagePath = path.join(runDir, "creator-qa-package.md");
  if (fs.existsSync(packagePath) && fs.readFileSync(packagePath, "utf8") !== packageMarkdown) {
    throw new Error("creator-qa-package.md already exists with different content. Use --force to replace QA artifacts.");
  }
  ["creator-qa-report.md", "creator-qa-report.json"].forEach((filename) => {
    if (fs.existsSync(path.join(runDir, filename))) {
      throw new Error(`${filename} already exists. Use --force to replace QA artifacts.`);
    }
  });
}

function runCreatorQa({ creatorQaRoot, packagePath, reportPath, profile }) {
  const root = path.resolve(creatorQaRoot || DEFAULT_CREATOR_QA_ROOT);
  if (!fs.existsSync(path.join(root, "src", "creator_qa", "cli.py"))) {
    throw new Error(`Creator QA CLI not found at: ${root}`);
  }
  const env = { ...process.env, PYTHONPATH: path.join(root, "src") };
  const result = spawnSync(
    "python3",
    ["-m", "creator_qa.cli", "check", packagePath, "--profile", profile || DEFAULT_PROFILE, "--json", "--report", reportPath],
    { cwd: root, env, encoding: "utf8" }
  );
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) {
    throw new Error(result.stderr || `Creator QA exited with status ${result.status}`);
  }
  const stdout = cleanString(result.stdout);
  if (!stdout) throw new Error("Creator QA did not return JSON output.");
  JSON.parse(stdout);
  return { status: result.status, stdout, stderr: result.stderr || "" };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.runFolder) {
    console.error("Usage: node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-topic-slug [--profile ai_video_breakdown] [--force]");
    return 1;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const runDir = path.resolve(repoRoot, options.runFolder);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    console.error(`Run folder not found: ${runDir}`);
    return 1;
  }

  try {
    const selectedPath = outlineScript.findSelectedPackagePath(runDir);
    if (!selectedPath || !fs.existsSync(selectedPath)) {
      throw new Error(`No selected package found. Expected selected-package.json or selected-package.md in: ${runDir}`);
    }

    const packageMarkdown = buildCreatorQaPackage({
      selected: selectedPackageData(selectedPath),
      finalOutlineText: readOptionalFile(runDir, "final-outline.md"),
      finalScriptText: readOptionalFile(runDir, "final-script.md"),
      productionBriefText: readOptionalFile(runDir, "production-brief.md"),
      thumbnailTitleCheckText: readOptionalFile(runDir, "thumbnail-title-check.md"),
      publishPackText: readOptionalFile(runDir, "publish-pack.md"),
    });

    assertCanWriteOutputs(runDir, packageMarkdown, options.force);
    const packagePath = path.join(runDir, "creator-qa-package.md");
    const reportPath = path.join(runDir, "creator-qa-report.md");
    const jsonPath = path.join(runDir, "creator-qa-report.json");
    fs.writeFileSync(packagePath, packageMarkdown, "utf8");
    const result = runCreatorQa({ creatorQaRoot: options.creatorQaRoot, packagePath, reportPath, profile: options.profile });
    fs.writeFileSync(jsonPath, `${result.stdout}\n`, "utf8");

    const payload = JSON.parse(result.stdout);
    const relativeRunDir = path.relative(repoRoot, runDir);
    console.log(`Creator QA completed for: ${relativeRunDir}`);
    console.log(`Creator QA result: ${payload.overall_result || "UNKNOWN"}`);
    QA_OUTPUT_FILES.forEach((filename) => console.log(`${relativeRunDir}/${filename}`));
    return result.status;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  DEFAULT_CREATOR_QA_ROOT,
  DEFAULT_PROFILE,
  QA_OUTPUT_FILES,
  parseArgs,
  selectedPackageData,
  extractMarkdownSection,
  sanitizePackageContent,
  demoteMarkdownHeadings,
  sectionHasCreatorQaCta,
  normalizeCtaHeading,
  buildNotes,
  buildCreatorQaPackage,
  assertCanWriteOutputs,
  runCreatorQa,
  main,
};
