#!/usr/bin/env node
"use strict";

// Lightweight doc-hygiene guard (Issues E/H). It does NOT rewrite docs. It fails
// when:
//   1. a canonical file referenced as authoritative is missing (guards Issue C),
//   2. an AUTHORITATIVE operator doc reintroduces a hardcoded test count, or
//   3. a known-stale phrase reappears in an authoritative doc.
// Historical docs are allowed to contain old counts/phrases (they are snapshots),
// so the hard-fail scan is scoped to the small authoritative set. Use --report to
// list hardcoded counts across all docs for information (never fails).

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");

// Files that must exist because docs/source treat them as canonical.
const CANONICAL_FILES = [
  "VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md",
  "config/production-stages.json",
  "config/system-registry.json",
  "docs/DOC-AUTHORITY.md",
];

// Docs that must reflect current truth (no hardcoded counts, no stale phrases).
// CLAUDE.md is included so future agent sessions never read a stale hardcoded
// test count as fact (it must say "run scripts/verify.sh for the current count").
const AUTHORITATIVE_DOCS = ["USAGE-GUIDE.md", "docs/COCKPIT-CROSS-REFERENCE.md", "docs/DOC-AUTHORITY.md", "CLAUDE.md"];

const STALE_PHRASES = ["844 tests"];
// Hardcoded test counts like "844 tests" or "1203/1203 passing".
const HARDCODED_COUNT_RE = /\b\d{2,4}\s*\/\s*\d{2,4}\s+(?:tests|passing)|\b\d{3,4}\s+tests\b/i;

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function scanText(text, relPath = "(text)") {
  const offenses = [];
  String(text || "").split(/\r?\n/).forEach((line, index) => {
    const lineNo = index + 1;
    if (HARDCODED_COUNT_RE.test(line)) {
      offenses.push({ doc: relPath, line: lineNo, kind: "hardcoded-test-count", text: line.trim() });
    }
    STALE_PHRASES.forEach((phrase) => {
      if (line.includes(phrase)) {
        offenses.push({ doc: relPath, line: lineNo, kind: "stale-phrase", text: line.trim() });
      }
    });
  });
  return offenses;
}

function scanDocForOffenses(relPath) {
  const text = readIfExists(path.join(REPO_ROOT, relPath));
  if (text === null) return [];
  return scanText(text, relPath);
}

function listAllDocs() {
  const docs = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) docs.push(path.relative(REPO_ROOT, full));
    });
  };
  walk(path.join(REPO_ROOT, "docs"));
  ["USAGE-GUIDE.md", "README.md"].forEach((name) => {
    if (fs.existsSync(path.join(REPO_ROOT, name))) docs.push(name);
  });
  return docs;
}

function check() {
  const missingCanonical = CANONICAL_FILES.filter((rel) => !fs.existsSync(path.join(REPO_ROOT, rel)));
  const offenses = AUTHORITATIVE_DOCS.flatMap(scanDocForOffenses);
  return { ok: missingCanonical.length === 0 && offenses.length === 0, missingCanonical, offenses };
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes("--report")) {
    const all = listAllDocs().flatMap(scanDocForOffenses);
    console.log(`Hardcoded counts / stale phrases across docs (informational): ${all.length}`);
    all.forEach((o) => console.log(`- ${o.doc}:${o.line} [${o.kind}] ${o.text}`));
    return 0;
  }
  const result = check();
  if (result.ok) {
    console.log("Doc authority check passed: canonical files present; authoritative docs have no hardcoded counts or stale phrases.");
    return 0;
  }
  if (result.missingCanonical.length) {
    console.error("Missing canonical files referenced as authoritative:");
    result.missingCanonical.forEach((rel) => console.error(`- ${rel}`));
  }
  if (result.offenses.length) {
    console.error("Authoritative docs contain hardcoded counts or stale phrases:");
    result.offenses.forEach((o) => console.error(`- ${o.doc}:${o.line} [${o.kind}] ${o.text}`));
  }
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { CANONICAL_FILES, AUTHORITATIVE_DOCS, STALE_PHRASES, scanText, scanDocForOffenses, listAllDocs, check, main };
