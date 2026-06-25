#!/usr/bin/env node
"use strict";

/**
 * Visual Beat Map Parser
 *
 * Read-only parser that extracts beat map data from existing package-run files.
 * Does not mutate any source files.
 *
 * Three data sources, each with a different structure:
 *
 * 1. resolve-spine-cut-marker-map.md  — markdown table with markers (M01..Mnn)
 * 2. media-creation-plan.md           — clip cards (### CLIP CARD NN)
 * 3. final-script.md                  — narrative sections (### Hook, ### Setup, ...)
 *
 * Each source is parsed independently and merged into a unified beat list.
 * Every beat has: id, source, section, narrationCue, visualJob, insertType,
 * proofStatus, clipType, editPlacement, priority.
 *
 * Missing or malformed files produce empty arrays, not errors.
 */

const fs = require("node:fs");
const path = require("node:path");

// ─── Source file names ───

const SOURCE_FILES = {
  markers: "resolve-spine-cut-marker-map.md",
  clipCards: "media-creation-plan.md",
  script: "final-script.md",
};

// ─── Markdown table parser ───

/**
 * Parse a markdown table into rows of objects.
 * Handles the header separator row (---|---|---).
 * Returns array of { headers: string[], rows: string[][] } for each table found.
 */
function parseMarkdownTables(text) {
  const lines = text.split("\n");
  const tables = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trimStart().startsWith("|") && line.trimEnd().endsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1) // drop empty first/last from leading/trailing |
        .map((c) => c.trim());

      // Is this a separator row? (all cells are --- or :--: etc.)
      const isSeparator = cells.every(
        (c) => /^[-:]+$/.test(c.replace(/\s/g, "")) && c.includes("-")
      );

      if (isSeparator) {
        // The previous line was the header; current table already has headers
        continue;
      }

      if (current === null) {
        // Start new table — this is the header row
        current = { headers: cells, rows: [] };
      } else {
        current.rows.push(cells);
      }
    } else {
      if (current !== null) {
        tables.push(current);
        current = null;
      }
    }
  }

  if (current !== null) {
    tables.push(current);
  }

  return tables;
}

/**
 * Convert a parsed table into array of objects keyed by header.
 */
function tableToObjects(table) {
  return table.rows.map((row) => {
    const obj = {};
    table.headers.forEach((header, i) => {
      obj[header] = row[i] || "";
    });
    return obj;
  });
}

// ─── Marker map parser (resolve-spine-cut-marker-map.md) ───

/**
 * Parse the marker map file into beat objects.
 * Expects a markdown table with columns including "Marker ID".
 * Returns beats sorted by marker ID.
 */
function parseMarkerMap(text) {
  if (!text || !text.trim()) return [];

  const tables = parseMarkdownTables(text);
  const beats = [];

  for (const table of tables) {
    const hasMarkerId = table.headers.some((h) =>
      /marker\s*id/i.test(h)
    );
    if (!hasMarkerId) continue;

    const objs = tableToObjects(table);
    for (const row of objs) {
      const id = getFieldValue(row, /marker\s*id/i);
      if (!id) continue;

      beats.push({
        id,
        source: "marker-map",
        sourceFile: SOURCE_FILES.markers,
        section: getFieldValue(row, /section|timestamp/i),
        narrationCue: getFieldValue(row, /narration|topic\s*cue/i),
        visualJob: getFieldValue(row, /needed\s*insert\s*type|insert\s*type/i),
        insertType: getFieldValue(row, /needed\s*insert\s*type|insert\s*type/i),
        proofStatus: getFieldValue(row, /proof\s*status/i),
        viewerRisk: getFieldValue(row, /viewer\s*risk/i),
        candidateSource: getFieldValue(row, /candidate\s*source/i),
        resolveNote: getFieldValue(row, /resolve\s*note/i),
        decisionNeeded: getFieldValue(row, /mikko.*decision|decision.*needed/i),
        priority: normalizePriority(id),
      });
    }
  }

  return beats;
}

// ─── Clip card parser (media-creation-plan.md) ───

/**
 * Parse media-creation-plan.md into beat objects.
 * Expects "### CLIP CARD NN" sections with "- Working title:", "- Type:", etc.
 */
function parseClipCards(text) {
  if (!text || !text.trim()) return [];

  const lines = text.split("\n");
  const beats = [];
  let currentCard = null;
  let currentField = null;
  let fieldBuffer = [];

  function flushField() {
    if (currentCard && currentField) {
      const value = fieldBuffer.join(" ").trim();
      if (value) {
        currentCard[currentField] = value;
      }
      currentField = null;
      fieldBuffer = [];
    }
  }

  function flushCard() {
    flushField();
    if (currentCard && currentCard.id) {
      beats.push(currentCard);
    }
    currentCard = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const clipMatch = line.match(/^###\s+CLIP\s+CARD\s+(\S+)/i);

    if (clipMatch) {
      flushCard();
      currentCard = {
        id: clipMatch[1].padStart(2, "0"),
        source: "clip-card",
        sourceFile: SOURCE_FILES.clipCards,
        section: "",
        narrationCue: "",
        visualJob: "",
        insertType: "",
        proofStatus: "",
        clipType: "",
        editPlacement: "",
        priority: normalizePriority(clipMatch[1]),
      };
      continue;
    }

    if (currentCard === null) continue;

    // Check for continuation lines (indented sub-bullets or indented text)
    // These belong to the current field, not a new field
    if (currentField && /^\s+[-\s]/.test(line)) {
      const text = line.replace(/^\s+[-\s]+/, "").trim();
      if (text) fieldBuffer.push(text);
      continue;
    }

    // A new top-level field starts with "- " at column 0
    if (!line.startsWith("- ")) continue;

    flushField();

    const fieldMatch = line.match(/^-\s+([^:]+):\s*(.*)$/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1].trim().toLowerCase();
      const fieldValue = fieldMatch[2].trim();

      currentField = mapClipCardField(fieldName);
      fieldBuffer = fieldValue ? [fieldValue] : [];
    }
  }

  flushCard();

  // Map clip card beats to unified schema
  return beats.map((beat) => ({
    id: beat.id,
    source: "clip-card",
    sourceFile: SOURCE_FILES.clipCards,
    section: beat.editPlacement || "",
    narrationCue: beat.workingTitle || "",
    visualJob: beat.clipType || "",
    insertType: beat.clipType || "",
    proofStatus: "",
    clipType: beat.clipType || "",
    editPlacement: beat.editPlacement || "",
    workingTitle: beat.workingTitle || "",
    viewerSees: beat.viewerSees || "",
    sayLine: beat.sayLine || "",
    captureNotes: beat.captureNotes || "",
    priority: beat.priority,
  }));
}

/**
 * Map raw clip card field names to unified schema field names.
 */
function mapClipCardField(rawName) {
  const name = rawName.toLowerCase().trim();
  if (name === "working title") return "workingTitle";
  if (name === "type") return "clipType";
  if (name === "edit placement") return "editPlacement";
  if (name === "viewer sees") return "viewerSees";
  if (name === "i say") return "sayLine";
  if (name === "capture notes") return "captureNotes";
  if (name === "visual action") return "visualAction";
  if (name === "purpose") return "purpose";
  if (name === "good enough when") return "goodEnoughWhen";
  if (name === "redo if") return "redoIf";
  return null;
}

// ─── Script section parser (final-script.md) ───

/**
 * Parse final-script.md into beat objects.
 * Each "### SectionName" heading becomes a beat.
 * The content between headings is captured as the narrationCue (first paragraph).
 */
function parseScriptSections(text) {
  if (!text || !text.trim()) return [];

  const lines = text.split("\n");
  const beats = [];
  let currentSection = null;
  let contentBuffer = [];
  let sectionIndex = 0;

  function flushSection() {
    if (currentSection) {
      const fullContent = contentBuffer.join("\n").trim();
      const firstParagraph = fullContent
        .split("\n\n")[0]
        .replace(/^[-\s]+/, "")
        .trim();

      beats.push({
        id: `S${String(sectionIndex).padStart(2, "0")}`,
        source: "script-section",
        sourceFile: SOURCE_FILES.script,
        section: currentSection,
        narrationCue: firstParagraph.slice(0, 200),
        visualJob: inferVisualJobFromSection(currentSection),
        insertType: "",
        proofStatus: "",
        clipType: "",
        editPlacement: currentSection,
        priority: normalizePriority(`S${sectionIndex}`),
        fullText: fullContent,
      });
    }
    currentSection = null;
    contentBuffer = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sectionMatch = line.match(/^###\s+(.+)$/);

    if (sectionMatch) {
      flushSection();
      sectionIndex++;
      currentSection = sectionMatch[1].trim();
      contentBuffer = [];
    } else if (currentSection) {
      contentBuffer.push(line);
    }
  }

  flushSection();

  return beats;
}

/**
 * Infer a visual job from a script section name.
 */
function inferVisualJobFromSection(sectionName) {
  const name = sectionName.toLowerCase();
  if (name.includes("hook")) return "hook";
  if (name.includes("setup")) return "visual metaphor";
  if (name.includes("promise")) return "concrete example";
  if (name.includes("part 1")) return "process explanation";
  if (name.includes("part 2")) return "comparison";
  if (name.includes("part 3")) return "proof or reference";
  if (name.includes("part 4")) return "transition";
  if (name.includes("recap")) return "recap";
  if (name.includes("cta")) return "resolution";
  return "";
}

// ─── Unified parser ───

/**
 * Parse all beat map sources from a run directory.
 * Returns { beats, sources } where:
 *   - beats: merged array of beat objects from all sources
 *   - sources: { markers: boolean, clipCards: boolean, script: boolean }
 *
 * Missing files are silently skipped (source flag = false, no beats from that source).
 */
function parseBeatMap(runDir) {
  const sources = { markers: false, clipCards: false, script: false };
  const beats = [];

  if (!runDir || typeof runDir !== "string" || !dirExistsSafe(runDir)) {
    return { beats, sources };
  }

  // Parse marker map
  const markerPath = path.join(runDir, SOURCE_FILES.markers);
  if (fileExistsSafe(markerPath)) {
    sources.markers = true;
    try {
      const text = fs.readFileSync(markerPath, "utf8");
      beats.push(...parseMarkerMap(text));
    } catch (_e) {
      // Silently skip unreadable files
    }
  }

  // Parse clip cards
  const clipCardPath = path.join(runDir, SOURCE_FILES.clipCards);
  if (fileExistsSafe(clipCardPath)) {
    sources.clipCards = true;
    try {
      const text = fs.readFileSync(clipCardPath, "utf8");
      beats.push(...parseClipCards(text));
    } catch (_e) {
      // Silently skip
    }
  }

  // Parse script sections
  const scriptPath = path.join(runDir, SOURCE_FILES.script);
  if (fileExistsSafe(scriptPath)) {
    sources.script = true;
    try {
      const text = fs.readFileSync(scriptPath, "utf8");
      beats.push(...parseScriptSections(text));
    } catch (_e) {
      // Silently skip
    }
  }

  return { beats, sources };
}

// ─── Utilities ───

function fileExistsSafe(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (_e) {
    return false;
  }
}

function dirExistsSafe(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch (_e) {
    return false;
  }
}

function getFieldValue(obj, pattern) {
  for (const key of Object.keys(obj)) {
    if (pattern.test(key)) return obj[key];
  }
  return "";
}

function normalizePriority(id) {
  // Extract numeric part for sorting
  const match = String(id).match(/(\d+)/);
  if (match) return parseInt(match[1], 10);
  return 999;
}

/**
 * Group beats by source for rendering.
 */
function groupBeatsBySource(beats) {
  const groups = { "marker-map": [], "clip-card": [], "script-section": [] };
  for (const beat of beats) {
    if (groups[beat.source]) {
      groups[beat.source].push(beat);
    }
  }
  return groups;
}

/**
 * Find related beats across sources by matching section names.
 * Returns a map of section -> { marker, clipCard, scriptSection }.
 */
function crossReferenceBeats(beats) {
  const refs = new Map();

  for (const beat of beats) {
    const section = (beat.section || "").toLowerCase().trim();
    if (!section) continue;

    if (!refs.has(section)) {
      refs.set(section, { marker: null, clipCard: null, scriptSection: null });
    }
    const entry = refs.get(section);

    if (beat.source === "marker-map") entry.marker = beat;
    if (beat.source === "clip-card") entry.clipCard = beat;
    if (beat.source === "script-section") entry.scriptSection = beat;
  }

  return refs;
}

// ─── CLI ───

function usage() {
  return `Visual Beat Map Parser

Usage:
  node scripts/visual-beat-map-parser.js <run-dir>
  node scripts/visual-beat-map-parser.js <run-dir> --json
  node scripts/visual-beat-map-parser.js --help

Read-only parser. Does not modify any source files.`;
}

function main(argv = []) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }

  const runDir = argv.find((a) => !a.startsWith("-"));
  if (!runDir) {
    console.error("Error: run directory required");
    console.error(usage());
    return 1;
  }

  if (!dirExistsSafe(runDir)) {
    console.error(`Error: directory not found: ${runDir}`);
    return 1;
  }

  const { beats, sources } = parseBeatMap(runDir);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ beats, sources }, null, 2));
  } else {
    const grouped = groupBeatsBySource(beats);
    console.log(`Visual Beat Map: ${runDir}`);
    console.log(
      `Sources: markers=${sources.markers}, clipCards=${sources.clipCards}, script=${sources.script}`
    );
    console.log(`Total beats: ${beats.length}`);
    console.log("");

    if (grouped["marker-map"].length) {
      console.log(`Marker Map (${grouped["marker-map"].length} beats):`);
      for (const b of grouped["marker-map"]) {
        console.log(`  ${b.id} | ${b.section} | ${b.insertType} | ${b.proofStatus}`);
      }
      console.log("");
    }

    if (grouped["clip-card"].length) {
      console.log(`Clip Cards (${grouped["clip-card"].length} beats):`);
      for (const b of grouped["clip-card"]) {
        console.log(`  ${b.id} | ${b.clipType} | ${b.workingTitle}`);
      }
      console.log("");
    }

    if (grouped["script-section"].length) {
      console.log(`Script Sections (${grouped["script-section"].length} beats):`);
      for (const b of grouped["script-section"]) {
        console.log(`  ${b.id} | ${b.section} | ${b.visualJob}`);
      }
    }
  }

  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  SOURCE_FILES,
  parseMarkdownTables,
  tableToObjects,
  parseMarkerMap,
  parseClipCards,
  parseScriptSections,
  parseBeatMap,
  groupBeatsBySource,
  crossReferenceBeats,
  normalizePriority,
  inferVisualJobFromSection,
  fileExistsSafe,
  dirExistsSafe,
  usage,
  main,
};
