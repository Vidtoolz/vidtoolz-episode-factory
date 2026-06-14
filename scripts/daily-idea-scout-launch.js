#!/usr/bin/env node
"use strict";

const { runDailyScout } = require("./daily-idea-scout.js");
const { createFixtureProvider, createManualProvider } = require("./daily-idea-scout-providers.js");
const scout = require("./daily-idea-scout.js");

scout.registerProvider("fixture", createFixtureProvider());
scout.registerProvider("manual", createManualProvider());

const args = process.argv.slice(2);
const options = {
  provider: "fixture",
  dryRun: false,
  force: false,
  archiveRoot: undefined,
};

for (const arg of args) {
  if (arg === "--help" || arg === "-h") {
    console.log("Daily Idea Scout — VIDTOOLZ daily candidate idea discovery");
    console.log("");
    console.log("Usage: node daily-idea-scout-launch.js [options]");
    console.log("");
    console.log("Options:");
    console.log("  --date=YYYY-MM-DD        Target date (default: today in Europe/Helsinki)");
    console.log("  --provider=NAME          Research provider: fixture | manual (default: fixture)");
    console.log("  --input=PATH             Manual provider input file (.md or .json)");
    console.log("  --dry-run                Compute results but write no files");
    console.log("  --force                  Overwrite existing archive for this date");
    console.log("  --archive-root=PATH      Override archive root directory");
    console.log("  -h, --help               Show this help message");
    console.log("");
    console.log("Examples:");
    console.log("  node scripts/daily-idea-scout-launch.js                   # Run for today");
    console.log("  node scripts/daily-idea-scout-launch.js --dry-run          # Dry run");
    console.log("  node scripts/daily-idea-scout-launch.js --date=2026-06-14  # Specific date");
    console.log("  node scripts/daily-idea-scout-launch.js --provider=manual --input=research.md");
    console.log("  node scripts/daily-idea-scout-launch.js --force            # Overwrite today");
    process.exit(0);
  }
  if (arg.startsWith("--date=")) options.date = arg.slice(7);
  if (arg.startsWith("--provider=")) options.provider = arg.slice(11);
  if (arg.startsWith("--input=")) options.inputPath = arg.slice(8);
  if (arg === "--dry-run") options.dryRun = true;
  if (arg === "--force") options.force = true;
  if (arg.startsWith("--archive-root=")) options.archiveRoot = arg.slice(15);
}

const todayStr = new Date().toLocaleDateString("en-CA", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

if (!options.date) {
  options.date = todayStr;
}

console.log(`Daily Idea Scout — ${options.date}`);
console.log(`Provider: ${options.provider}`);
console.log(`Mode: ${options.dryRun ? "DRY RUN" : options.force ? "FORCE OVERWRITE" : "NORMAL"}`);
console.log("---");

try {
  const result = runDailyScout(options);

  if (!result.ok) {
    console.error(`\nFAILED: ${result.error}`);
    if (result.logs) {
      for (const [name, content] of Object.entries(result.logs)) {
        console.log(`\n--- ${name}.log ---`);
        console.log(content);
      }
    }
    process.exit(1);
  }

  console.log(result.message);

  if (result.dryRun) {
    console.log(`\nTop 5 candidate ideas (dry run):`);
    const ideas = result.dailyRun.ideas.slice(0, 5);
    for (const idea of ideas) {
      console.log(`  #${idea.rank}: ${idea.title} (score: ${idea.final_score})`);
      console.log(`    ${idea.ranking_rationale}`);
    }
    console.log(`\nFull results available in process output. No files were written.`);
  } else {
    console.log(`\nTop 5 candidate ideas:`);
    const ideas = result.dailyRun.ideas.slice(0, 5);
    for (const idea of ideas) {
      console.log(`  #${idea.rank}: ${idea.title} (score: ${idea.final_score})`);
    }
    console.log(`\nFull report: ${result.archiveDir}/report.md`);
    console.log(`Structured data: ${result.archiveDir}/ideas.json`);
  }

  process.exit(0);
} catch (err) {
  console.error(`\nUnexpected error: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(2);
}
