#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TOOL_NAME = "script-image-assets-dry-run.js";
const DEFAULT_OUTPUT_ROOT = "/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-image-assets/";
const ARTIFACT_FILENAMES = [
  "script-blocks.json",
  "image-prompts.json",
  "generation-manifest.json",
  "generation-report.md",
];
const DEFAULT_VISUAL_STYLE =
  "Modern cinematic editorial illustration, high detail, practical for YouTube storytelling, serious creator-focused, no fake UI proof, no misleading realism, no copyrighted characters, no recognizable real public figures unless explicitly approved.";
const NEGATIVE_CONSTRAINTS = [
  "no fake UI proof",
  "no misleading realism",
  "no copyrighted characters",
  "no recognizable real public figures unless explicitly approved",
  "no logos unless explicitly approved",
  "no random text artifacts",
  "no watermark",
  "no generated image should be treated as production proof",
];

function usage() {
  return [
    "Usage:",
    `  node scripts/${TOOL_NAME} --input /path/to/script.md [--headline \"Title\"] [--dry-run]`,
    `  node scripts/${TOOL_NAME} --stdin --headline \"Title\" [--dry-run]`,
    `  node scripts/${TOOL_NAME} --input /path/to/script.md --write-artifacts`,
    "",
    "Options:",
    "  --input PATH          Read a markdown script file.",
    "  --stdin               Read pasted script text from stdin.",
    "  --headline TITLE      Use this headline if no title is detected, or to override detection.",
    `  --output-root PATH    Root folder for headline slug folders. Default: ${DEFAULT_OUTPUT_ROOT}`,
    "  --output-folder PATH  Exact approved output folder to preview/write.",
    "  --dry-run             Preview only. This is the default.",
    "  --write-artifacts     Write planning artifacts only. Refuses existing folders/files.",
    "  --help                Show this help.",
    "",
    "Safety:",
    "  This tool never generates images, PNG files, approval markers, ComfyUI calls, or external API calls.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    inputPath: "",
    stdin: false,
    headline: "",
    outputRoot: DEFAULT_OUTPUT_ROOT,
    outputFolder: "",
    writeArtifacts: false,
    dryRun: true,
    help: false,
  };
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--input") {
      options.inputPath = args.shift() || "";
    } else if (arg === "--stdin") {
      options.stdin = true;
    } else if (arg === "--headline") {
      options.headline = args.shift() || "";
    } else if (arg === "--output-root") {
      options.outputRoot = args.shift() || "";
    } else if (arg === "--output-folder") {
      options.outputFolder = args.shift() || "";
    } else if (arg === "--write-artifacts") {
      options.writeArtifacts = true;
      options.dryRun = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
      options.writeArtifacts = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function stripFrontmatter(markdownText) {
  const text = cleanText(markdownText);
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  return text.slice(end + 4).trim();
}

function frontmatterTitle(markdownText) {
  const text = cleanText(markdownText);
  if (!text.startsWith("---\n")) return "";
  const end = text.indexOf("\n---", 4);
  if (end === -1) return "";
  const frontmatter = text.slice(4, end);
  const match = frontmatter.match(/^title:\s*["']?(.+?)["']?\s*$/im);
  return match ? match[1].trim() : "";
}

function detectHeadline(markdownText) {
  const explicitTitle = frontmatterTitle(markdownText);
  if (explicitTitle) return explicitTitle;

  const body = stripFrontmatter(markdownText);
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();

  const firstClearLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && line.length <= 120 && !/^[-*+>]\s/.test(line) && !/[.!?]$/.test(line));
  return firstClearLine || "";
}

function removeDetectedHeadline(markdownText, headline) {
  let body = stripFrontmatter(markdownText);
  if (!headline) return body.trim();
  const escaped = headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  body = body.replace(new RegExp(`^#\\s+${escaped}\\s*$\\n?`, "im"), "");
  body = body.replace(new RegExp(`^${escaped}\\s*$\\n?`, "im"), "");
  return body.trim();
}

function slugifyHeadline(headline) {
  const words = String(headline || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join("_").slice(0, 140) || "Untitled_Script";
}

function splitSentences(text) {
  const normalized = cleanText(text)
    .replace(/\s+/g, " ")
    .replace(/([.!?])\s+(?=[A-Z0-9"“])/g, "$1\n");
  return normalized
    .split("\n")
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildBlocks(text) {
  const sentences = splitSentences(text);
  const blocks = [];
  for (let index = 0; index < sentences.length; index += 3) {
    const chunk = sentences.slice(index, index + 3);
    const blockNumber = blocks.length + 1;
    blocks.push({
      block_id: `block-${String(blockNumber).padStart(3, "0")}`,
      sentence_start: index + 1,
      sentence_end: index + chunk.length,
      text: chunk.join(" "),
    });
  }
  return { sentences, blocks };
}

function excerpt(value, maxLength = 260) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function promptType(promptNumber) {
  return [
    "literal_cinematic_scene",
    "symbolic_editorial_visual_metaphor",
    "practical_youtube_broll_or_explainer_visual",
    "bold_conceptual_thumbnail_style_visual",
  ][promptNumber - 1];
}

function buildPromptForBlock(block, promptNumber) {
  const type = promptType(promptNumber);
  const source = excerpt(block.text);
  const base = {
    block_id: block.block_id,
    prompt_number: promptNumber,
    prompt_id: `${block.block_id}-prompt-${String(promptNumber).padStart(2, "0")}`,
    prompt_type: type,
    text_allowed: false,
    source_text: block.text,
    visual_style: DEFAULT_VISUAL_STYLE,
    negative_constraints: [...NEGATIVE_CONSTRAINTS],
  };

  const variants = {
    literal_cinematic_scene: {
      subject: `A grounded cinematic scene representing this script moment: ${source}`,
      setting: "realistic creator workspace or production environment, not a fake product interface",
      mood: "serious, focused, practical, evidence-aware",
      composition: "clear foreground subject with contextual production details in the background",
      camera_framing: "35mm documentary-style medium shot, practical YouTube storytelling framing",
      lighting: "soft directional cinematic light with restrained contrast",
    },
    symbolic_editorial_visual_metaphor: {
      subject: `An editorial metaphor for the core idea in this script block: ${source}`,
      setting: "minimal cinematic editorial space with symbolic objects, no literal fake evidence",
      mood: "thoughtful, skeptical, high-trust, analytical",
      composition: "one strong symbolic object relationship, uncluttered negative space",
      camera_framing: "slightly wide editorial composition, clean depth and strong silhouette",
      lighting: "controlled studio-editorial lighting with dramatic but believable shadows",
    },
    practical_youtube_broll_or_explainer_visual: {
      subject: `Practical b-roll or explainer visual for this narration: ${source}`,
      setting: "creator desk, camera gear, notes, timeline-like abstract shapes, or production planning materials without readable fake UI",
      mood: "useful, clear, instructional, production-minded",
      composition: "legible visual hierarchy suitable as supporting footage under narration",
      camera_framing: "over-shoulder or tabletop explainer framing, YouTube b-roll ready",
      lighting: "natural practical light with clean highlights and readable details",
    },
    bold_conceptual_thumbnail_style_visual: {
      subject: `A bold conceptual thumbnail-style image expressing this script block: ${source}`,
      setting: "simple high-contrast editorial background, no platform logos, no fake screenshots",
      mood: "urgent but credible, serious creator-focused, not exaggerated clickbait",
      composition: "large simple shapes, one dominant idea, strong contrast, room for optional human-added title text later",
      camera_framing: "tight dramatic composition with clear focal point and strong silhouette",
      lighting: "punchy cinematic key light with controlled shadows",
    },
  };

  const fields = variants[type];
  return {
    ...base,
    ...fields,
    full_prompt: [
      fields.subject,
      `Setting: ${fields.setting}.`,
      `Mood: ${fields.mood}.`,
      `Composition: ${fields.composition}.`,
      `Camera/framing: ${fields.camera_framing}.`,
      `Lighting: ${fields.lighting}.`,
      `Visual style: ${DEFAULT_VISUAL_STYLE}`,
      `Text allowed in image: ${base.text_allowed ? "yes" : "no"}.`,
      `Negative constraints: ${NEGATIVE_CONSTRAINTS.join("; ")}.`,
    ].join(" "),
  };
}

function buildPrompts(blocks) {
  return blocks.flatMap((block) => [1, 2, 3, 4].map((promptNumber) => buildPromptForBlock(block, promptNumber)));
}

function sourceDescriptor(options) {
  if (options.stdin) return { source_type: "pasted_input", source_path: null };
  return { source_type: "markdown_file", source_path: path.resolve(options.inputPath) };
}

function plannedArtifactPaths(outputFolder) {
  return Object.fromEntries(ARTIFACT_FILENAMES.map((filename) => [filename, path.join(outputFolder, filename)]));
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
}

function proposedTimestampedFolder(outputFolder, date = new Date()) {
  return path.join(outputFolder, formatTimestamp(date));
}

function buildManifest({ headline, source, outputFolder, blocks, prompts, now = new Date() }) {
  return {
    headline,
    source,
    output_folder: outputFolder,
    created_timestamp: now.toISOString(),
    image_generation_enabled: false,
    items: prompts.map((prompt) => {
      const block = blocks.find((item) => item.block_id === prompt.block_id);
      return {
        block_id: prompt.block_id,
        original_text_block: block ? block.text : "",
        prompt_number: prompt.prompt_number,
        prompt_id: prompt.prompt_id,
        prompt_type: prompt.prompt_type,
        full_generated_prompt: prompt.full_prompt,
        output_filename: `${prompt.prompt_id}.png`,
        generation_status: "not_started",
        created_timestamp: null,
        error_message: null,
        reviewed_by_mikko: false,
        approved: false,
        selected: false,
        production_ready: false,
      };
    }),
  };
}

function buildReport({ headline, source, outputFolder, blocks, prompts }) {
  const lines = [
    `# ${headline} — Script Image Assets Dry Run`,
    "",
    "Source:",
    `- Type: ${source.source_type}`,
    `- Path: ${source.source_path || "pasted input"}`,
    "",
    "Output folder:",
    outputFolder,
    "",
    "Status:",
    "- Image generation enabled: no",
    `- Blocks: ${blocks.length}`,
    `- Prompts: ${prompts.length}`,
    "- PNG files created: 0",
    "- Reviewed by Mikko: 0",
    "- Approved: 0",
    "- Selected: 0",
    "- Production-ready: 0",
    "",
    "Safety note:",
    "Generated images are candidates only. This Phase 1 dry-run does not generate images and does not mark anything approved, selected, reviewed, or production-ready.",
    "",
    "Blocks and prompts:",
  ];

  blocks.forEach((block) => {
    lines.push("", `## ${block.block_id}`, "", block.text, "");
    prompts
      .filter((prompt) => prompt.block_id === block.block_id)
      .forEach((prompt) => {
        lines.push(`- ${prompt.prompt_id} (${prompt.prompt_type}): ${prompt.full_prompt}`);
      });
  });

  return `${lines.join("\n")}\n`;
}

function buildArtifacts({ headline, bodyText, source, outputFolder, now = new Date() }) {
  const { sentences, blocks } = buildBlocks(bodyText);
  const prompts = buildPrompts(blocks);
  const scriptBlocks = {
    headline,
    source,
    sentence_count: sentences.length,
    block_count: blocks.length,
    blocks,
  };
  const imagePrompts = {
    headline,
    default_visual_style: DEFAULT_VISUAL_STYLE,
    prompts,
  };
  const manifest = buildManifest({ headline, source, outputFolder, blocks, prompts, now });
  const report = buildReport({ headline, source, outputFolder, blocks, prompts, manifest });
  return {
    "script-blocks.json": JSON.stringify(scriptBlocks, null, 2) + "\n",
    "image-prompts.json": JSON.stringify(imagePrompts, null, 2) + "\n",
    "generation-manifest.json": JSON.stringify(manifest, null, 2) + "\n",
    "generation-report.md": report,
    summary: {
      headline,
      outputFolder,
      sentenceCount: sentences.length,
      blockCount: blocks.length,
      promptCount: prompts.length,
    },
  };
}

function checkWriteSafety(outputFolder, artifactPaths) {
  const problems = [];
  if (fs.existsSync(outputFolder)) {
    problems.push(`Target folder already exists: ${outputFolder}`);
  }
  Object.values(artifactPaths).forEach((artifactPath) => {
    if (fs.existsSync(artifactPath)) problems.push(`Artifact already exists: ${artifactPath}`);
  });
  return problems;
}

function writeArtifacts(outputFolder, artifacts) {
  const artifactPaths = plannedArtifactPaths(outputFolder);
  const problems = checkWriteSafety(outputFolder, artifactPaths);
  if (problems.length) {
    const error = new Error(problems.join("\n"));
    error.code = "WRITE_NOT_SAFE";
    throw error;
  }
  fs.mkdirSync(outputFolder, { recursive: true });
  ARTIFACT_FILENAMES.forEach((filename) => {
    fs.writeFileSync(path.join(outputFolder, filename), artifacts[filename], { encoding: "utf8", flag: "wx" });
  });
}

function loadInput(options) {
  if (options.stdin && options.inputPath) throw new Error("Use either --stdin or --input, not both.");
  if (!options.stdin && !options.inputPath) throw new Error("Missing input. Use --input PATH or --stdin.");
  if (!options.outputRoot && !options.outputFolder) throw new Error("Missing output root.");
  if (options.stdin) return fs.readFileSync(0, "utf8");
  if (!fs.existsSync(options.inputPath)) throw new Error(`Input file not found: ${options.inputPath}`);
  return fs.readFileSync(options.inputPath, "utf8");
}

function buildPlan(options, inputText, now = new Date()) {
  const detectedHeadline = detectHeadline(inputText);
  const headline = cleanText(options.headline || detectedHeadline);
  if (!headline) throw new Error("Script headline could not be detected. Re-run with --headline \"Your Title\".");
  const bodyText = removeDetectedHeadline(inputText, headline);
  if (!cleanText(bodyText)) throw new Error("Script body is empty after headline/frontmatter removal.");
  const slug = slugifyHeadline(headline);
  const outputFolder = options.outputFolder ? path.resolve(options.outputFolder) : path.join(path.resolve(options.outputRoot), slug);
  const source = sourceDescriptor(options);
  const artifacts = buildArtifacts({ headline, bodyText, source, outputFolder, now });
  return { headline, slug, outputFolder, source, artifacts };
}

function printPlan(plan, options) {
  const artifactPaths = plannedArtifactPaths(plan.outputFolder);
  console.log(`tool: ${TOOL_NAME}`);
  console.log(`headline: ${plan.headline}`);
  console.log(`folder slug: ${plan.slug}`);
  console.log(`proposed output folder: ${plan.outputFolder}`);
  console.log(`source type: ${plan.source.source_type}`);
  console.log(`source path: ${plan.source.source_path || "pasted input"}`);
  console.log(`sentences: ${plan.artifacts.summary.sentenceCount}`);
  console.log(`blocks: ${plan.artifacts.summary.blockCount}`);
  console.log(`prompts: ${plan.artifacts.summary.promptCount}`);
  console.log("image generation enabled: no");
  console.log("png files created: 0");
  console.log("planned artifacts:");
  ARTIFACT_FILENAMES.forEach((filename) => console.log(`- ${artifactPaths[filename]}`));

  if (fs.existsSync(plan.outputFolder)) {
    console.log("target folder already exists: yes");
    console.log(`proposed timestamped alternative: ${proposedTimestampedFolder(plan.outputFolder)}`);
    console.log("files written: 0");
    return;
  }

  if (!options.writeArtifacts) {
    console.log("mode: dry-run preview only");
    console.log("files written: 0");
  }
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    const inputText = loadInput(options);
    const plan = buildPlan(options, inputText);
    printPlan(plan, options);
    if (options.writeArtifacts) {
      if (fs.existsSync(plan.outputFolder)) {
        console.error(`Refusing to write because target folder exists: ${plan.outputFolder}`);
        console.error(`Proposed timestamped alternative: ${proposedTimestampedFolder(plan.outputFolder)}`);
        return 1;
      }
      writeArtifacts(plan.outputFolder, plan.artifacts);
      console.log("mode: write planning artifacts only");
      ARTIFACT_FILENAMES.forEach((filename) => console.log(`wrote: ${path.join(plan.outputFolder, filename)}`));
    }
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
  DEFAULT_OUTPUT_ROOT,
  ARTIFACT_FILENAMES,
  DEFAULT_VISUAL_STYLE,
  NEGATIVE_CONSTRAINTS,
  usage,
  parseArgs,
  cleanText,
  stripFrontmatter,
  frontmatterTitle,
  detectHeadline,
  removeDetectedHeadline,
  slugifyHeadline,
  splitSentences,
  buildBlocks,
  buildPromptForBlock,
  buildPrompts,
  sourceDescriptor,
  plannedArtifactPaths,
  formatTimestamp,
  proposedTimestampedFolder,
  buildManifest,
  buildReport,
  buildArtifacts,
  checkWriteSafety,
  writeArtifacts,
  loadInput,
  buildPlan,
  main,
};
