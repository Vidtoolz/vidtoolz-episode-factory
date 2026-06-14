#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function validatePublishedVideos(repoRoot = path.resolve(__dirname, "..")) {
  const registryPath = path.join(repoRoot, "published-videos.json");
  const errors = [];

  if (!fs.existsSync(registryPath)) {
    return {
      ok: false,
      errors: ["published-videos.json is missing."],
      registryPath,
      count: 0,
    };
  }

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      errors: [`published-videos.json is invalid JSON: ${error.message}`],
      registryPath,
      count: 0,
    };
  }

  if (!Array.isArray(entries)) {
    errors.push("published-videos.json must contain an array.");
    entries = [];
  }

  const seenTitles = new Set();
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`Entry ${index + 1} must be an object.`);
      return;
    }

    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const date = typeof entry.date === "string" ? entry.date.trim() : "";

    if (!title) errors.push(`Entry ${index + 1} is missing required title.`);
    if (!date) errors.push(`Entry ${index + 1} is missing required date.`);
    if (title) {
      const key = title.toLowerCase();
      if (seenTitles.has(key)) errors.push(`Duplicate published video title: ${title}`);
      seenTitles.add(key);
    }

    for (const [field, value] of Object.entries(entry)) {
      if (typeof value === "string" && /(?:^|\/)package-runs\/|package-run slug|runSlug|run_slug/i.test(value)) {
        errors.push(`Entry ${index + 1} field "${field}" references package-run state or slugs.`);
      }
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    registryPath,
    count: entries.length,
  };
}

function main() {
  const report = validatePublishedVideos(process.cwd());
  if (!report.ok) {
    report.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
    return;
  }
  console.log(`published-videos.json ok (${report.count} entries)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  validatePublishedVideos,
};
