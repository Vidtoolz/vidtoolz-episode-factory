#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TOOL_NAME = "script-image-assets-review-page.js";
const DEFAULT_INPUT_FOLDER =
  "/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-image-assets/Stop_Planning_AI_Videos_Until_You_Have_A_Proof_Plan";
const DEFAULT_OUTPUT_PATH = path.join(
  process.cwd(),
  "reports",
  "script-image-assets-prompt-review.html"
);
const REQUIRED_FILENAMES = [
  "script-blocks.json",
  "image-prompts.json",
  "generation-manifest.json",
];
const EXPECTED_PROMPTS_PER_BLOCK = 4;

function usage() {
  return [
    "Usage:",
    `  node scripts/${TOOL_NAME} [--input-folder PATH] [--output PATH]`,
    "",
    "Options:",
    `  --input-folder PATH  Folder containing Phase 1 script-image-assets JSON. Default: ${DEFAULT_INPUT_FOLDER}`,
    `  --output PATH        Repo-local standalone HTML report path. Default: ${DEFAULT_OUTPUT_PATH}`,
    "  --help               Show this help.",
    "",
    "Safety:",
    "  This tool reads existing JSON artifacts and writes one local HTML review report.",
    "  It never generates images, PNG files, approval markers, ComfyUI calls, or external API calls.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    inputFolder: DEFAULT_INPUT_FOLDER,
    outputPath: DEFAULT_OUTPUT_PATH,
    help: false,
  };
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--input-folder") {
      options.inputFolder = args.shift() || "";
    } else if (arg === "--output") {
      options.outputPath = args.shift() || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadArtifacts(inputFolder) {
  const folder = path.resolve(inputFolder);
  REQUIRED_FILENAMES.forEach((filename) => {
    const filePath = path.join(folder, filename);
    if (!fs.existsSync(filePath)) throw new Error(`Missing required artifact: ${filePath}`);
  });
  return {
    inputFolder: folder,
    scriptBlocks: readJson(path.join(folder, "script-blocks.json")),
    imagePrompts: readJson(path.join(folder, "image-prompts.json")),
    manifest: readJson(path.join(folder, "generation-manifest.json")),
  };
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null).map(String))];
}

function summarizeManifest(manifest) {
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  return {
    imageGenerationEnabled: manifest.image_generation_enabled === true,
    generationStatuses: uniqueValues(items.map((item) => item.generation_status || "missing")),
    reviewedCount: items.filter((item) => item.reviewed_by_mikko === true).length,
    approvedCount: items.filter((item) => item.approved === true).length,
    selectedCount: items.filter((item) => item.selected === true).length,
    productionReadyCount: items.filter((item) => item.production_ready === true).length,
  };
}

function buildReviewData(artifacts) {
  const blocks = Array.isArray(artifacts.scriptBlocks.blocks) ? artifacts.scriptBlocks.blocks : [];
  const prompts = Array.isArray(artifacts.imagePrompts.prompts) ? artifacts.imagePrompts.prompts : [];
  const manifestItems = Array.isArray(artifacts.manifest.items) ? artifacts.manifest.items : [];
  const manifestByPromptId = new Map(manifestItems.map((item) => [item.prompt_id, item]));
  const promptGroups = new Map();

  prompts.forEach((prompt) => {
    if (!promptGroups.has(prompt.block_id)) promptGroups.set(prompt.block_id, []);
    promptGroups.get(prompt.block_id).push(prompt);
  });

  const blocksWithPrompts = blocks.map((block) => {
    const blockPrompts = (promptGroups.get(block.block_id) || []).sort(
      (a, b) => Number(a.prompt_number || 0) - Number(b.prompt_number || 0)
    );
    return {
      ...block,
      prompts: blockPrompts.map((prompt) => ({
        ...prompt,
        manifest: manifestByPromptId.get(prompt.prompt_id) || null,
      })),
    };
  });

  const promptCount = prompts.length;
  const blockCount = blocks.length;
  const manifestSummary = summarizeManifest(artifacts.manifest);
  const warnings = [];
  if (artifacts.manifest.image_generation_enabled !== false) {
    warnings.push("Manifest does not explicitly disable image generation.");
  }
  if (blockCount !== artifacts.scriptBlocks.block_count) {
    warnings.push(`Block array count ${blockCount} does not match script-blocks block_count ${artifacts.scriptBlocks.block_count}.`);
  }
  if (promptCount !== blockCount * EXPECTED_PROMPTS_PER_BLOCK) {
    warnings.push(`Prompt count ${promptCount} does not match expected ${blockCount * EXPECTED_PROMPTS_PER_BLOCK}.`);
  }
  blocksWithPrompts.forEach((block) => {
    if (block.prompts.length !== EXPECTED_PROMPTS_PER_BLOCK) {
      warnings.push(`${block.block_id} has ${block.prompts.length} prompts instead of ${EXPECTED_PROMPTS_PER_BLOCK}.`);
    }
  });

  return {
    headline: artifacts.scriptBlocks.headline || artifacts.imagePrompts.headline || "Untitled prompt review",
    source: artifacts.scriptBlocks.source || {},
    inputFolder: artifacts.inputFolder,
    blockCount,
    promptCount,
    expectedPromptCount: blockCount * EXPECTED_PROMPTS_PER_BLOCK,
    manifestSummary,
    warnings,
    blocks: blocksWithPrompts,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBoolean(value) {
  return value ? "yes" : "no";
}

function renderPrompt(prompt) {
  const manifest = prompt.manifest || {};
  const status = manifest.generation_status || "missing manifest item";
  return [
    '<section class="prompt">',
    '<div class="prompt-meta">',
    `<span>${escapeHtml(prompt.prompt_id)}</span>`,
    `<span>${escapeHtml(prompt.prompt_type)}</span>`,
    `<span>manifest: ${escapeHtml(status)}</span>`,
    `<span>reviewed: ${escapeHtml(formatBoolean(manifest.reviewed_by_mikko === true))}</span>`,
    `<span>approved: ${escapeHtml(formatBoolean(manifest.approved === true))}</span>`,
    `<span>selected: ${escapeHtml(formatBoolean(manifest.selected === true))}</span>`,
    `<span>production ready: ${escapeHtml(formatBoolean(manifest.production_ready === true))}</span>`,
    "</div>",
    `<p class="prompt-text">${escapeHtml(prompt.full_prompt || "")}</p>`,
    "</section>",
  ].join("\n");
}

function renderHtml(data) {
  const statusText = data.manifestSummary.generationStatuses.length
    ? data.manifestSummary.generationStatuses.join(", ")
    : "missing";
  const warnings = data.warnings.length
    ? data.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("\n")
    : "<li>No structural warnings found in the loaded JSON artifacts.</li>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.headline)} - Prompt Review</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --surface: #ffffff;
      --ink: #14171f;
      --muted: #5a6475;
      --line: #d9dee8;
      --accent: #0f766e;
      --warn-bg: #fff8df;
      --warn-line: #d6a700;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      padding: 32px min(5vw, 56px);
      background: #17202f;
      color: #fff;
    }
    h1 {
      margin: 0 0 14px;
      max-width: 1120px;
      font-size: clamp(2rem, 4vw, 3.8rem);
      line-height: 1.05;
      letter-spacing: 0;
    }
    h2, h3 { letter-spacing: 0; }
    main {
      width: min(1320px, calc(100% - 32px));
      margin: 24px auto 48px;
    }
    .warning {
      margin: 0 0 22px;
      padding: 16px 18px;
      border: 1px solid var(--warn-line);
      background: var(--warn-bg);
      font-weight: 700;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 0 0 22px;
    }
    .stat, .panel, .block {
      border: 1px solid var(--line);
      background: var(--surface);
      border-radius: 8px;
    }
    .stat {
      padding: 14px 16px;
      min-height: 88px;
    }
    .stat strong {
      display: block;
      font-size: 1.65rem;
      line-height: 1.1;
    }
    .stat span, .meta, .prompt-meta {
      color: var(--muted);
      font-size: 0.9rem;
    }
    .panel {
      padding: 18px;
      margin-bottom: 22px;
    }
    .panel h2, .block h2 {
      margin: 0 0 12px;
      font-size: 1.2rem;
    }
    .panel ul {
      margin: 0;
      padding-left: 20px;
    }
    .block {
      margin: 0 0 18px;
      overflow: hidden;
    }
    .block-header {
      padding: 18px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfe;
    }
    .block-text {
      margin: 0;
      max-width: 1000px;
      font-size: 1.02rem;
    }
    .prompts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 0;
    }
    .prompt {
      padding: 16px;
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      min-width: 0;
    }
    .prompt-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .prompt-meta span {
      display: inline-block;
      padding: 3px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #f7f9fc;
    }
    .prompt-text {
      margin: 0;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    a {
      color: var(--accent);
    }
  </style>
</head>
<body>
  <header>
    <p class="meta">Read-only Phase 1 script-image-assets prompt review</p>
    <h1>${escapeHtml(data.headline)}</h1>
    <p class="meta">Source: ${escapeHtml(data.source.source_path || data.source.source_type || "unknown")}</p>
  </header>
  <main>
    <p class="warning">All prompts shown here are candidates only. This report is not approval, selection, production readiness, visual proof, or permission to generate images.</p>
    <section class="stats" aria-label="Artifact counts">
      <div class="stat"><strong>${escapeHtml(data.blockCount)}</strong><span>script blocks</span></div>
      <div class="stat"><strong>${escapeHtml(data.promptCount)}</strong><span>prompts</span></div>
      <div class="stat"><strong>${escapeHtml(data.expectedPromptCount)}</strong><span>expected prompts</span></div>
      <div class="stat"><strong>${escapeHtml(statusText)}</strong><span>manifest generation status</span></div>
      <div class="stat"><strong>${escapeHtml(formatBoolean(data.manifestSummary.imageGenerationEnabled))}</strong><span>image generation enabled</span></div>
      <div class="stat"><strong>${escapeHtml(data.manifestSummary.approvedCount)}</strong><span>approved prompts</span></div>
    </section>
    <section class="panel">
      <h2>Manifest Status</h2>
      <ul>
        <li>Input folder: <code>${escapeHtml(data.inputFolder)}</code></li>
        <li>Reviewed by Mikko: ${escapeHtml(data.manifestSummary.reviewedCount)}</li>
        <li>Selected: ${escapeHtml(data.manifestSummary.selectedCount)}</li>
        <li>Production ready: ${escapeHtml(data.manifestSummary.productionReadyCount)}</li>
        ${warnings}
      </ul>
    </section>
    ${data.blocks
      .map(
        (block) => `<article class="block">
      <div class="block-header">
        <h2>${escapeHtml(block.block_id)} <span class="meta">sentences ${escapeHtml(block.sentence_start)}-${escapeHtml(block.sentence_end)}</span></h2>
        <p class="block-text">${escapeHtml(block.text)}</p>
      </div>
      <div class="prompts">
        ${block.prompts.map(renderPrompt).join("\n")}
      </div>
    </article>`
      )
      .join("\n")}
  </main>
</body>
</html>
`;
}

function writeReport(outputPath, html) {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, html, "utf8");
  return resolved;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    if (!options.inputFolder) throw new Error("Missing --input-folder value.");
    if (!options.outputPath) throw new Error("Missing --output value.");

    const artifacts = loadArtifacts(options.inputFolder);
    const data = buildReviewData(artifacts);
    const outputPath = writeReport(options.outputPath, renderHtml(data));
    console.log(`tool: ${TOOL_NAME}`);
    console.log(`input folder: ${artifacts.inputFolder}`);
    console.log(`output: ${outputPath}`);
    console.log(`headline: ${data.headline}`);
    console.log(`blocks: ${data.blockCount}`);
    console.log(`prompts: ${data.promptCount}`);
    console.log(`manifest generation statuses: ${data.manifestSummary.generationStatuses.join(", ") || "missing"}`);
    console.log("image generation enabled: no action taken");
    console.log("png files created: 0");
    console.log("approval markers changed: 0");
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  TOOL_NAME,
  DEFAULT_INPUT_FOLDER,
  DEFAULT_OUTPUT_PATH,
  REQUIRED_FILENAMES,
  EXPECTED_PROMPTS_PER_BLOCK,
  usage,
  parseArgs,
  loadArtifacts,
  summarizeManifest,
  buildReviewData,
  escapeHtml,
  renderHtml,
  writeReport,
  main,
};
