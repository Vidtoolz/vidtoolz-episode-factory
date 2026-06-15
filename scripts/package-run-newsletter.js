#!/usr/bin/env node
"use strict";

// Copy-only newsletter draft generator for a package run.
//
// Mirrors package-run-publication-metadata.js: it reads existing run artifacts
// and emits markdown the operator pastes into Kit by hand. It does NOT call the
// Kit API (or any external API), does not send, schedule, publish, or create
// scheduled jobs. This is the email-side repurposing asset for a video — the
// missing rented-attention -> owned-list step — kept human-in-the-loop per the
// repo's "no hidden automation / copy-only publishing" boundary.

const fs = require("node:fs");
const path = require("node:path");

const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-newsletter.js";
const NEWSLETTER_DRAFT_FILE = "newsletter-draft.md";
const NEWSLETTER_REVIEW_FILE = "newsletter-review.md";
const TARGET_FILES = [NEWSLETTER_DRAFT_FILE, NEWSLETTER_REVIEW_FILE];

const INPUT_FILES = [
  "publish-pack.md",
  "repurposing-plan.md",
  "publish-metadata-review.md",
  "title-check.md",
  "description-check.md",
  "final-review.md",
  "final-script.md",
  "script-draft.md",
];

function usage() {
  return [
    "Usage: node scripts/package-run-newsletter.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-newsletter.js --help",
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

function unwrap(value) {
  return cleanString(value).replace(/^[`'"]+|[`'"]+$/g, "").trim();
}

function lineValue(markdown, label) {
  // Same-line only. The shared productionPlan.lineValue uses `\s*` after the
  // colon, which crosses newlines — so an EMPTY "Label:" field captures the next
  // non-blank line (e.g. an empty "Pinned comment:" grabbing "## Chapters" from
  // a real publish-pack). For copy-only drafting the value must be on the
  // label's own line, so we restrict the gap after the colon to spaces/tabs.
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${escaped}:[ \\t]*([^\\r\\n]+)`, "im");
  const match = String(markdown || "").match(pattern);
  return match ? unwrap(match[1]) : "";
}

function sectionText(markdown, heading) {
  return researchPack.sectionText(String(markdown || ""), heading);
}

function isAssessedText(value) {
  const text = cleanString(value);
  return Boolean(text) && !/^(?:todo|tbd|placeholder|n\/a|na|none|not applicable|not assessed)$/i.test(text);
}

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function firstAssessedValue(files, labels) {
  for (const text of Object.values(files)) {
    for (const label of labels) {
      const value = lineValue(text, label);
      if (isAssessedText(value)) return cleanString(value);
    }
  }
  return "";
}

function firstAssessedSection(files, headings) {
  for (const text of Object.values(files)) {
    for (const heading of headings) {
      const value = sectionText(text, heading);
      if (isAssessedText(value)) return cleanString(value);
    }
  }
  return "";
}

function readNewsletterFields(files) {
  return {
    title: firstAssessedValue(files, ["Final title", "Working title", "Alternate title", "Title", "Video title"]),
    description: firstAssessedValue(files, ["Description draft", "Description", "Video description", "YouTube description"])
      || firstAssessedSection(files, ["Description", "YouTube description"]),
    teaser: firstAssessedSection(files, ["YouTube Community or Newsletter Teaser", "Newsletter teaser", "Newsletter angle", "Email-only insight"]),
    longFormPromise: firstAssessedValue(files, ["Long-form promise", "Promised outcome", "Viewer payoff"]),
    newsletterCta: firstAssessedValue(files, ["Newsletter CTA"]),
    videoUrl: firstAssessedValue(files, ["YouTube URL", "Video URL", "Watch URL", "Published URL", "Video link"]),
    leadMagnet: firstAssessedValue(files, ["Lead magnet", "Download", "Free download"]),
    pinnedComment: firstAssessedValue(files, ["Pinned comment"]),
  };
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  return {
    runId: path.basename(runDir),
    files,
    fields: readNewsletterFields(files),
  };
}

function determineReadiness(context) {
  const { fields } = context;
  const blockers = [];
  if (!fields.title) blockers.push("title is missing or placeholder (no subject line can be formed).");
  if (!fields.teaser && !fields.description && !fields.longFormPromise) {
    blockers.push("no newsletter teaser, description, or long-form promise to draft a body from.");
  }

  const todos = [];
  if (!fields.videoUrl) todos.push("video URL is unknown — fill {{VIDEO_URL}} once the video is published.");
  if (!fields.teaser) todos.push("no pre-written newsletter teaser found (run repurpose first for a better body).");
  if (!fields.leadMagnet) todos.push("no lead magnet / download set — add one or remove the Download block.");
  if (!fields.newsletterCta) todos.push("no newsletter CTA found — confirm the closing call-to-action.");

  if (blockers.length) {
    return { status: "NEEDS CONTENT", draftable: false, blockers, todos };
  }
  return { status: "DRAFT READY", draftable: true, blockers: [], todos };
}

function or(value, placeholder) {
  return isAssessedText(value) ? cleanString(value) : placeholder;
}

function buildNewsletterDraft(context, readiness) {
  const { runId, fields } = context;
  const subject = or(fields.title, "TODO: subject line");
  const bodyHook = or(fields.teaser || fields.longFormPromise || fields.description, "TODO: one-sentence hook for this issue.");
  const lesson = or(fields.description || fields.pinnedComment, "TODO: one practical lesson from making this video.");
  const videoLink = isAssessedText(fields.videoUrl) ? cleanString(fields.videoUrl) : "{{VIDEO_URL}}";
  const cta = or(fields.newsletterCta, "Reply and tell me what you're working on — I read every message.");
  const downloadBlock = isAssessedText(fields.leadMagnet)
    ? `## Download\n\n${cleanString(fields.leadMagnet)}`
    : "## Download\n\nTODO: lead magnet link, or delete this block.";

  return `# Newsletter Draft

> DRAFT — copy-only. Review and complete every TODO, then paste into Kit by hand.
> This file was generated from package fields; it is not sent, scheduled, or published.

- Run: ${runId}
- Tool: ${TOOL_NAME}
- Status: ${readiness.status}
- External APIs called: no

## Subject

${subject}

## Body

${bodyHook}

## Watch the video

- ${videoLink}

## What I learned

${lesson}

## Tool / workflow note

TODO: one specific tool, system, or workflow improvement from this video.

${downloadBlock}

## Closing

${cta}
`;
}

function buildNewsletterReview(context, readiness) {
  const { runId, fields } = context;
  const missingInputs = INPUT_FILES.filter((filename) => !context.files[filename]).map((filename) => `Missing ${filename}.`);
  return `# Newsletter Review

- Run: ${runId}
- Tool: ${TOOL_NAME}
- Status: ${readiness.status}
- Draftable: ${readiness.draftable ? "yes" : "no"}
- External APIs called: no

## Boundary

- This tool drafts newsletter copy from recorded package fields only.
- It does not call the Kit API (or any API), send, schedule, publish, or create scheduled jobs.
- Paste the draft into Kit through a separate human action after completing TODOs.

## Source Fields Found

- Title: ${or(fields.title, "TODO")}
- Teaser source: ${or(fields.teaser ? "newsletter teaser" : fields.longFormPromise ? "long-form promise" : fields.description ? "description" : "", "none")}
- Video URL: ${or(fields.videoUrl, "unknown (placeholder used)")}
- Lead magnet: ${or(fields.leadMagnet, "none")}
- Newsletter CTA: ${or(fields.newsletterCta, "default used")}

## Content Blockers

${markdownList(readiness.blockers, "None.")}

## TODOs Before Paste

${markdownList(readiness.todos, "None.")}

## Input Warnings

${markdownList(missingInputs, "None.")}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const readiness = determineReadiness(context);
  return {
    context,
    readiness,
    files: [
      [NEWSLETTER_DRAFT_FILE, buildNewsletterDraft(context, readiness)],
      [NEWSLETTER_REVIEW_FILE, buildNewsletterReview(context, readiness)],
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
  console.log(`newsletter draft: ${outputs.readiness.status}`);
  console.log(`draftable: ${outputs.readiness.draftable ? "yes" : "no"}`);
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
  readNewsletterFields,
  readContext,
  determineReadiness,
  buildNewsletterDraft,
  buildNewsletterReview,
  buildOutputs,
  writeOutputs,
  main,
};
