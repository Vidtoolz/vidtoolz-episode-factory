#!/usr/bin/env node
"use strict";

// Generates the canonical, source-derived production-stage artifacts from the
// ONE runtime source of truth: pipeline-tracker.js (STAGES / VERTICAL_STAGES).
// pipeline-tracker.js is a browser module loaded by the cockpit pages and the
// repo has no build step, so the tracker stays the runtime source and these
// artifacts are generated from it (Option 2). Run with no args to (re)write the
// artifacts; run with --check to fail if they have drifted from the tracker.
//
//   node scripts/generate-production-spec.js          # write artifacts
//   node scripts/generate-production-spec.js --check   # verify, exit 1 on drift

const fs = require("node:fs");
const path = require("node:path");

const tracker = require("../pipeline-tracker.js");

const REPO_ROOT = path.join(__dirname, "..");
const STAGES_JSON_PATH = path.join(REPO_ROOT, "config", "production-stages.json");
const SPEC_MD_PATH = path.join(REPO_ROOT, "VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md");
const RUNTIME_SOURCE = "pipeline-tracker.js (STAGES / VERTICAL_STAGES)";
const REGEN_COMMAND = "node scripts/generate-production-spec.js";

function buildStagesJson() {
  return {
    generated_or_source_derived: "source-derived",
    do_not_edit_manually: true,
    runtime_source: RUNTIME_SOURCE,
    regenerate_with: REGEN_COMMAND,
    horizontalStages: tracker.STAGES,
    verticalStages: tracker.VERTICAL_STAGES,
  };
}

function stageTable(stages) {
  const rows = stages.map((stage) => `| ${stage.id + 1} | \`${stage.key}\` | ${stage.label} | ${stage.short} |`);
  return ["| # | key | label | short |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

function buildSpecMarkdown() {
  return [
    "# VIDTOOLZ Canonical Production Spec",
    "",
    "> **This file is source-derived. Do not edit manually.**",
    `> Runtime source of truth: \`${RUNTIME_SOURCE}\`.`,
    `> Regenerate with: \`${REGEN_COMMAND}\`.`,
    "> A drift check (`--check`) runs in the test suite, so this file cannot silently fall out of sync with the tracker.",
    "",
    "This is the one operator-facing production stage model. The cockpit pipeline",
    "tracker renders exactly these stages, so what you see in the cockpit and what",
    "this spec says are the same thing.",
    "",
    "## Horizontal pipeline (default, 13 stages)",
    "",
    stageTable(tracker.STAGES),
    "",
    "## Vertical / Shorts pipeline (shorter path)",
    "",
    "The vertical path intentionally drops research/claims/packaging.",
    "",
    stageTable(tracker.VERTICAL_STAGES),
    "",
    "## Relationship to other docs",
    "",
    "- `USAGE-GUIDE.md` describes the same 13-stage model in operator language.",
    "- `docs/video-production-engine-stage-model.md` is a **historical** 7-stage description; treat it as a snapshot that maps onto this model, not a competing model.",
    "- `docs/package-run-state-machine.md` is an **internal/detailed reference** for the conservative package-run state machine (finer-grained gate evidence rules). It maps onto this 13-stage model and is not a separate operator model.",
    "- For per-run diagnostics use `node scripts/package-run-doctor.js <run>`; for the active run and next action use `node scripts/package-run-next-safe-action.js`.",
    "",
  ].join("\n");
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function generate() {
  return {
    [STAGES_JSON_PATH]: `${JSON.stringify(buildStagesJson(), null, 2)}\n`,
    [SPEC_MD_PATH]: buildSpecMarkdown(),
  };
}

function writeArtifacts() {
  const artifacts = generate();
  fs.mkdirSync(path.dirname(STAGES_JSON_PATH), { recursive: true });
  Object.entries(artifacts).forEach(([filePath, content]) => fs.writeFileSync(filePath, content, "utf8"));
  return Object.keys(artifacts).map((filePath) => path.relative(REPO_ROOT, filePath));
}

function checkArtifacts() {
  const artifacts = generate();
  const drifted = Object.entries(artifacts)
    .filter(([filePath, content]) => readIfExists(filePath) !== content)
    .map(([filePath]) => path.relative(REPO_ROOT, filePath));
  return { ok: drifted.length === 0, drifted };
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes("--check")) {
    const result = checkArtifacts();
    if (result.ok) {
      console.log("Canonical production spec is in sync with pipeline-tracker.js.");
      return 0;
    }
    console.error(`Canonical production spec is OUT OF SYNC. Regenerate with: ${REGEN_COMMAND}`);
    result.drifted.forEach((filePath) => console.error(`- ${filePath}`));
    return 1;
  }
  const written = writeArtifacts();
  console.log("Wrote canonical production spec from pipeline-tracker.js:");
  written.forEach((filePath) => console.log(`- ${filePath}`));
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  STAGES_JSON_PATH,
  SPEC_MD_PATH,
  RUNTIME_SOURCE,
  buildStagesJson,
  buildSpecMarkdown,
  generate,
  writeArtifacts,
  checkArtifacts,
  main,
};
