#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const INPUT_DIR = path.join("inputs", "oneof10");
const TEMPLATE_PATH = path.join(INPUT_DIR, "manual-oneof10-template.csv");
const TEMPLATE_CONTENT = `Title,Channel,Views,Age,URL,1of10 score
Example AI video workflow title,Example Channel,250000,3 months,https://www.youtube.com/watch?v=example,4x baseline
`;
const GENERIC_WARNING_PATTERN = /\b(?:top\s*10\s+tools|best\s+ai\s+tools|replaces\s+all\s+creators|no\s+humans\s+needed|fake\s+proof|deepfake\s+proof)\b/i;

function clean(value = "") {
  return String(value || "").trim();
}

function parseArgs(argv = []) {
  const result = {
    command: "",
    inputPath: "",
    overwrite: false,
    open: false,
    runScout: false,
    help: false,
  };
  const args = [...argv];
  result.command = args.shift() || "";
  while (args.length) {
    const item = args.shift();
    if (item === "--overwrite") result.overwrite = true;
    else if (item === "--open") result.open = true;
    else if (item === "--run-scout") result.runScout = true;
    else if (item === "--help" || item === "-h") result.help = true;
    else if (!result.inputPath) result.inputPath = item;
  }
  return result;
}

function usage() {
  return `Usage:
  node scripts/oneof10-input-helper.js template [--open] [--overwrite]
  node scripts/oneof10-input-helper.js validate inputs/oneof10/manual-oneof10-template.csv [--run-scout]
  node scripts/oneof10-input-helper.js run inputs/oneof10/manual-oneof10-template.csv [--open]
  node scripts/oneof10-input-helper.js clean inputs/oneof10/manual-oneof10-template.csv

Local helper only. Does not scrape 1of10, store browser data, or make network calls.`;
}

function parseCsvLine(line = "") {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(text = "") {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map(clean);
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    return {
      lineNumber: index + 2,
      cells,
      values: headers.reduce((result, header, cellIndex) => {
        result[normalizeHeader(header)] = clean(cells[cellIndex]);
        return result;
      }, {}),
    };
  });
  return { headers, rows };
}

function normalizeHeader(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseViews(value = "") {
  const text = clean(value).toLowerCase().replace(/,/g, "");
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmb])?$/);
  if (!match) return 0;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (match[2] === "b") return Math.round(base * 1000000000);
  if (match[2] === "m") return Math.round(base * 1000000);
  if (match[2] === "k") return Math.round(base * 1000);
  return Math.round(base);
}

function validateCsvText(text = "") {
  const parsed = parseCsv(text);
  const missingTitleRows = [];
  const invalidViewsRows = [];
  const genericWarningRows = [];
  let validRows = 0;

  parsed.rows.forEach((row) => {
    const title = clean(row.values.title);
    const viewsText = clean(row.values.views);
    const views = parseViews(viewsText);
    if (!title) missingTitleRows.push(row.lineNumber);
    if (!views) invalidViewsRows.push(row.lineNumber);
    if (GENERIC_WARNING_PATTERN.test(title)) genericWarningRows.push({ lineNumber: row.lineNumber, title });
    if (title && views) validRows += 1;
  });

  return {
    totalDataRows: parsed.rows.length,
    validRows,
    missingTitleRows,
    invalidViewsRows,
    genericWarningRows,
    pass: validRows >= 10,
    status: validRows >= 10 ? "PASS" : "NEEDS MORE ROWS",
  };
}

function validateCsvFile(filePath) {
  return validateCsvText(fs.readFileSync(filePath, "utf8"));
}

function csvEscape(value = "") {
  const text = clean(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function cleanCsvFile(filePath) {
  const parsed = parseCsv(fs.readFileSync(filePath, "utf8"));
  const outputPath = filePath.replace(/\.csv$/i, "") + ".cleaned.csv";
  const lines = [
    parsed.headers.map(csvEscape).join(","),
    ...parsed.rows.map((row) => parsed.headers.map((_header, index) => csvEscape(row.cells[index] || "")).join(",")),
  ];
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
  return outputPath;
}

function createTemplate(options = {}) {
  const repoRoot = path.resolve(__dirname, "..");
  const templatePath = path.join(repoRoot, TEMPLATE_PATH);
  fs.mkdirSync(path.dirname(templatePath), { recursive: true });
  let action = "exists";
  if (!fs.existsSync(templatePath) || options.overwrite) {
    fs.writeFileSync(templatePath, TEMPLATE_CONTENT, "utf8");
    action = fs.existsSync(templatePath) && options.overwrite ? "written" : "created";
  }
  return { templatePath, action };
}

function openPath(filePath) {
  childProcess.spawnSync("xdg-open", [filePath], {
    stdio: "ignore",
    detached: true,
  });
}

function runTopicScout(inputPath, options = {}) {
  const validation = validateCsvFile(inputPath);
  if (!validation.pass) return { exitCode: 1, validation, skipped: true };
  const repoRoot = path.resolve(__dirname, "..");
  const before = latestReportPath(repoRoot);
  const result = childProcess.spawnSync(process.execPath, ["scripts/topic-scout.js", "--oneof10-input", inputPath], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const latest = latestReportPath(repoRoot) || before;
  if (options.open && latest) openPath(latest);
  return { exitCode: result.status || 0, stdout: result.stdout, stderr: result.stderr, validation, latestReportPath: latest };
}

function latestReportPath(repoRoot = path.resolve(__dirname, "..")) {
  const reportDir = path.join(repoRoot, "reports", "topic-scout");
  if (!fs.existsSync(reportDir)) return "";
  const files = fs
    .readdirSync(reportDir)
    .filter((file) => /^topic-scout-\d{8}-\d{4}\.md$/.test(file))
    .map((file) => path.join(reportDir, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || "";
}

function printValidation(report) {
  console.log(`Status: ${report.status}`);
  console.log(`Total data rows: ${report.totalDataRows}`);
  console.log(`Valid rows: ${report.validRows}/10`);
  if (report.missingTitleRows.length) console.log(`Rows missing Title: ${report.missingTitleRows.join(", ")}`);
  if (report.invalidViewsRows.length) console.log(`Rows missing/invalid Views: ${report.invalidViewsRows.join(", ")}`);
  if (report.genericWarningRows.length) {
    console.log("Generic/hype rows likely to be rejected:");
    report.genericWarningRows.forEach((row) => console.log(`- Row ${row.lineNumber}: ${row.title}`));
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.command) {
    console.log(usage());
    return 0;
  }

  if (options.command === "template") {
    const result = createTemplate(options);
    console.log(`Template path: ${result.templatePath}`);
    console.log(`Template status: ${result.action}`);
    console.log("Fill at least 10 rows with Title and Views. Optional useful columns: Channel, Age, URL, 1of10 score.");
    console.log(`Validate with: node scripts/oneof10-input-helper.js validate ${TEMPLATE_PATH}`);
    if (options.open) openPath(result.templatePath);
    return 0;
  }

  if (!options.inputPath) {
    console.error(`Missing input path.\n${usage()}`);
    return 1;
  }

  if (options.command === "validate") {
    const report = validateCsvFile(options.inputPath);
    printValidation(report);
    if (options.runScout && report.pass) {
      const runResult = runTopicScout(options.inputPath);
      if (runResult.latestReportPath) console.log(`Latest report: ${runResult.latestReportPath}`);
      return runResult.exitCode;
    }
    if (options.runScout && !report.pass) console.log("Topic Scout not run because fewer than 10 valid rows exist.");
    return report.pass ? 0 : 1;
  }

  if (options.command === "run") {
    const result = runTopicScout(options.inputPath, options);
    printValidation(result.validation);
    if (result.skipped) {
      console.log("Topic Scout not run because fewer than 10 valid rows exist.");
      return 1;
    }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.latestReportPath) console.log(`Latest report: ${result.latestReportPath}`);
    return result.exitCode;
  }

  if (options.command === "clean") {
    const outputPath = cleanCsvFile(options.inputPath);
    console.log(`Cleaned copy: ${outputPath}`);
    console.log("Original file unchanged.");
    return 0;
  }

  console.error(`Unknown command: ${options.command}\n${usage()}`);
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  GENERIC_WARNING_PATTERN,
  TEMPLATE_CONTENT,
  TEMPLATE_PATH,
  cleanCsvFile,
  createTemplate,
  csvEscape,
  main,
  parseArgs,
  parseCsv,
  parseCsvLine,
  parseViews,
  runTopicScout,
  validateCsvFile,
  validateCsvText,
};
