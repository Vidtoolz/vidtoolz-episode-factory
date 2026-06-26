/**
 * Visual Beat Map Parser Tests
 *
 * Tests for: scripts/visual-beat-map-parser.js
 *
 * Uses inline fixtures (no real package-run files) to keep tests deterministic.
 */

const { assert, fs, os, path, test, writeTestFile } = require("./_helpers.js");
const parser = require("../scripts/visual-beat-map-parser.js");

// ─── Fixtures ───

const MARKER_MAP_FIXTURE = [
  "# Resolve spine-cut marker map — draft only",
  "",
  "## 1. Status",
  "",
  "- Spine test result: works.",
  "",
  "## 3. Marker map",
  "",
  "| Marker ID | Approx section / timestamp | Narration or topic cue | Current viewer risk | Needed insert type | Candidate source | Proof status | Resolve note | Mikko decision needed |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| M01 | Hook / exact timestamp unknown | \"What will this video prove on screen?\" | Opening may stay visually plain | title/card/label | Script hook | demonstration | Add a simple on-screen label | Decide whether the hook label feels useful |",
  "| M02 | Setup / exact timestamp unknown | ChatGPT transcript boundary | Viewer may misunderstand | screen zoom/callout | capture-transcript.md | real proof | Use zoom/callout | Confirm the label wording |",
  "| M03 | Part 4 / exact timestamp unknown | AI suggests; creator decides | Conceptual section | Kling/AI illustration clip | Selected prompt-03 stills | illustration-only | Place as brief atmosphere | Decide whether AI/Kling fits |",
  "",
  "## 4. Minimum viable insert package",
  "",
  "| Insert ID | Why it matters | Can this be handled by editing only? |",
  "| --- | --- | --- |",
  "| I01 | Prevents the prepared weak example from being mistaken | Yes |",
  "| I02 | Makes the proof-plan method visible | Yes |",
].join("\n");

const CLIP_CARD_FIXTURE = [
  "# Operator-Facing Media Creation Plan",
  "",
  "Run: `2026-05-06-ai-video-proof-plan`",
  "",
  "## Clip cards",
  "",
  "### CLIP CARD 01",
  "",
  "- Working title: Opening proof question",
  "- Type: A-roll",
  "- Purpose:",
  "  - Solves the biggest current rough-cut weakness.",
  "- Viewer sees:",
  "  - Presenter on camera.",
  "- I say:",
  "  - A-roll spoken words:",
  "    - \"Before you ask AI to write a script, ask one harder question.\"",
  "- Edit placement:",
  "  - Opening hook / first human-presence insert.",
  "- Capture notes:",
  "  - Duration: 10-15 seconds.",
  "",
  "### CLIP CARD 02",
  "",
  "- Working title: Evidence boundary reset",
  "- Type: A-roll",
  "- Edit placement:",
  "  - Setup section, before or during the first evidence visuals.",
  "",
  "### CLIP CARD 03",
  "",
  "- Working title: Pasted transcript evidence insert",
  "- Type: Screen capture",
  "- Edit placement:",
  "  - Setup section.",
].join("\n");

const SCRIPT_FIXTURE = [
  "# Final Script",
  "",
  "- Run: 2026-05-06-ai-video-proof-plan",
  "",
  "## Working Title",
  "",
  "Stop Planning AI Videos Until You Have a Proof Plan",
  "",
  "## Script",
  "",
  "### Hook",
  "",
  "Before you ask AI to write a script, ask one harder question:",
  "",
  "What will this video prove on screen?",
  "",
  "### Setup",
  "",
  "Here is the working example for this video.",
  "",
  "### Promise",
  "",
  "By the end of this video, you will have a simple proof-plan check.",
  "",
  "### Part 1: Why AI ideas can look more finished than they are",
  "",
  "AI tools can make ideas look organized before the idea has been tested.",
  "",
  "### CTA",
  "",
  "Write the proof moment before the script.",
].join("\n");

// ─── Tests ───

test("parseMarkdownTables extracts header and data rows", () => {
  const text = "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |";
  const tables = parser.parseMarkdownTables(text);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].headers, ["A", "B", "C"]);
  assert.equal(tables[0].rows.length, 2);
  assert.deepEqual(tables[0].rows[0], ["1", "2", "3"]);
  assert.deepEqual(tables[0].rows[1], ["4", "5", "6"]);
});

test("parseMarkdownTables handles multiple tables with non-table text between", () => {
  const text = [
    "# Title",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "Some paragraph text.",
    "",
    "| C | D |",
    "| --- | --- |",
    "| 3 | 4 |",
  ].join("\n");
  const tables = parser.parseMarkdownTables(text);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].headers, ["A", "B"]);
  assert.deepEqual(tables[1].headers, ["C", "D"]);
});

test("parseMarkdownTables returns empty array for text with no tables", () => {
  const tables = parser.parseMarkdownTables("# Just a heading\n\nNo tables here.");
  assert.equal(tables.length, 0);
});

test("tableToObjects converts table to array of objects keyed by header", () => {
  const table = {
    headers: ["Marker ID", "Section", "Proof status"],
    rows: [["M01", "Hook", "demonstration"], ["M02", "Setup", "real proof"]],
  };
  const objs = parser.tableToObjects(table);
  assert.equal(objs.length, 2);
  assert.equal(objs[0]["Marker ID"], "M01");
  assert.equal(objs[0]["Section"], "Hook");
  assert.equal(objs[1]["Proof status"], "real proof");
});

test("parseMarkerMap extracts markers from fixture", () => {
  const beats = parser.parseMarkerMap(MARKER_MAP_FIXTURE);
  assert.equal(beats.length, 3);

  assert.equal(beats[0].id, "M01");
  assert.equal(beats[0].source, "marker-map");
  assert.match(beats[0].section, /Hook/);
  assert.equal(beats[0].insertType, "title/card/label");
  assert.equal(beats[0].proofStatus, "demonstration");

  assert.equal(beats[1].id, "M02");
  assert.equal(beats[1].proofStatus, "real proof");

  assert.equal(beats[2].id, "M03");
  assert.equal(beats[2].insertType, "Kling/AI illustration clip");
  assert.equal(beats[2].proofStatus, "illustration-only");
});

test("parseMarkerMap ignores insert table (no Marker ID column)", () => {
  const beats = parser.parseMarkerMap(MARKER_MAP_FIXTURE);
  // The insert table has Insert ID, not Marker ID — should not produce beats
  const insertBeats = beats.filter((b) => b.id.startsWith("I"));
  assert.equal(insertBeats.length, 0);
});

test("parseMarkerMap returns empty for empty text", () => {
  assert.equal(parser.parseMarkerMap("").length, 0);
  assert.equal(parser.parseMarkerMap(null).length, 0);
  assert.equal(parser.parseMarkerMap(undefined).length, 0);
});

test("parseMarkerMap returns empty for text with no marker table", () => {
  const text = "# No markers here\n\n| Foo | Bar |\n| --- | --- |\n| 1 | 2 |";
  assert.equal(parser.parseMarkerMap(text).length, 0);
});

test("parseClipCards extracts clip cards with fields", () => {
  const beats = parser.parseClipCards(CLIP_CARD_FIXTURE);
  assert.equal(beats.length, 3);

  assert.equal(beats[0].id, "01");
  assert.equal(beats[0].source, "clip-card");
  assert.equal(beats[0].workingTitle, "Opening proof question");
  assert.equal(beats[0].clipType, "A-roll");
  assert.match(beats[0].editPlacement, /Opening hook/);

  assert.equal(beats[1].id, "02");
  assert.equal(beats[1].workingTitle, "Evidence boundary reset");
  assert.equal(beats[1].clipType, "A-roll");

  assert.equal(beats[2].id, "03");
  assert.equal(beats[2].clipType, "Screen capture");
});

test("parseClipCards returns empty for empty text", () => {
  assert.equal(parser.parseClipCards("").length, 0);
  assert.equal(parser.parseClipCards(null).length, 0);
});

test("parseClipCards handles clip card with no fields", () => {
  const text = "### CLIP CARD 01\n\nSome text without fields\n";
  const beats = parser.parseClipCards(text);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].id, "01");
  assert.equal(beats[0].workingTitle, "");
});

test("parseScriptSections extracts sections from fixture", () => {
  const beats = parser.parseScriptSections(SCRIPT_FIXTURE);
  assert.equal(beats.length, 5);

  assert.equal(beats[0].id, "S01");
  assert.equal(beats[0].source, "script-section");
  assert.equal(beats[0].section, "Hook");
  assert.match(beats[0].narrationCue, /Before you ask AI/);

  assert.equal(beats[1].id, "S02");
  assert.equal(beats[1].section, "Setup");

  assert.equal(beats[2].id, "S03");
  assert.equal(beats[2].section, "Promise");

  assert.equal(beats[3].id, "S04");
  assert.match(beats[3].section, /Part 1/);

  assert.equal(beats[4].id, "S05");
  assert.equal(beats[4].section, "CTA");
});

test("parseScriptSections returns empty for text with no ### headings", () => {
  const text = "# Title\n\nNo sections here.\n\nJust paragraphs.";
  assert.equal(parser.parseScriptSections(text).length, 0);
});

test("parseScriptSections returns empty for empty text", () => {
  assert.equal(parser.parseScriptSections("").length, 0);
  assert.equal(parser.parseScriptSections(null).length, 0);
});

test("inferVisualJobFromSection maps known section names", () => {
  assert.equal(parser.inferVisualJobFromSection("Hook"), "hook");
  assert.equal(parser.inferVisualJobFromSection("Setup"), "visual metaphor");
  assert.equal(parser.inferVisualJobFromSection("Promise"), "concrete example");
  assert.equal(parser.inferVisualJobFromSection("Recap"), "recap");
  assert.equal(parser.inferVisualJobFromSection("CTA"), "resolution");
});

test("inferVisualJobFromSection returns empty for unknown sections", () => {
  assert.equal(parser.inferVisualJobFromSection("Unknown Section"), "");
});

test("normalizePriority extracts numeric priority from IDs", () => {
  assert.equal(parser.normalizePriority("M01"), 1);
  assert.equal(parser.normalizePriority("M13"), 13);
  assert.equal(parser.normalizePriority("01"), 1);
  assert.equal(parser.normalizePriority("S05"), 5);
  assert.equal(parser.normalizePriority("no-number"), 999);
});

test("parseBeatMap merges all three sources from a run directory", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beat-map-test-"));
  const runDir = path.join(tmpRoot, "test-run");
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(
    path.join(runDir, "resolve-spine-cut-marker-map.md"),
    MARKER_MAP_FIXTURE,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "media-creation-plan.md"),
    CLIP_CARD_FIXTURE,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    SCRIPT_FIXTURE,
    "utf8"
  );

  const result = parser.parseBeatMap(runDir);

  assert.equal(result.sources.markers, true);
  assert.equal(result.sources.clipCards, true);
  assert.equal(result.sources.script, true);

  // 3 markers + 3 clip cards + 5 script sections = 11 beats
  assert.equal(result.beats.length, 11);

  const markerBeats = result.beats.filter((b) => b.source === "marker-map");
  assert.equal(markerBeats.length, 3);

  const clipBeats = result.beats.filter((b) => b.source === "clip-card");
  assert.equal(clipBeats.length, 3);

  const scriptBeats = result.beats.filter((b) => b.source === "script-section");
  assert.equal(scriptBeats.length, 5);
});

test("parseBeatMap handles missing source files gracefully", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beat-map-test-"));
  const runDir = path.join(tmpRoot, "empty-run");
  fs.mkdirSync(runDir, { recursive: true });

  const result = parser.parseBeatMap(runDir);

  assert.equal(result.sources.markers, false);
  assert.equal(result.sources.clipCards, false);
  assert.equal(result.sources.script, false);
  assert.equal(result.beats.length, 0);
});

test("parseBeatMap handles partial sources (only script)", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beat-map-test-"));
  const runDir = path.join(tmpRoot, "partial-run");
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    SCRIPT_FIXTURE,
    "utf8"
  );

  const result = parser.parseBeatMap(runDir);

  assert.equal(result.sources.markers, false);
  assert.equal(result.sources.clipCards, false);
  assert.equal(result.sources.script, true);
  assert.equal(result.beats.length, 5);
});

test("parseBeatMap returns empty for null/undefined/nonexistent paths", () => {
  assert.equal(parser.parseBeatMap(null).beats.length, 0);
  assert.equal(parser.parseBeatMap(undefined).beats.length, 0);
  assert.equal(parser.parseBeatMap("").beats.length, 0);
  assert.equal(parser.parseBeatMap("/nonexistent/path").beats.length, 0);
});

test("groupBeatsBySource groups beats by their source field", () => {
  const beats = [
    { id: "M01", source: "marker-map" },
    { id: "M02", source: "marker-map" },
    { id: "01", source: "clip-card" },
    { id: "S01", source: "script-section" },
    { id: "S02", source: "script-section" },
  ];

  const groups = parser.groupBeatsBySource(beats);
  assert.equal(groups["marker-map"].length, 2);
  assert.equal(groups["clip-card"].length, 1);
  assert.equal(groups["script-section"].length, 2);
});

test("groupBeatsBySource handles empty input", () => {
  const groups = parser.groupBeatsBySource([]);
  assert.equal(groups["marker-map"].length, 0);
  assert.equal(groups["clip-card"].length, 0);
  assert.equal(groups["script-section"].length, 0);
});

test("crossReferenceBeats links beats by matching section names", () => {
  const beats = [
    { id: "M01", source: "marker-map", section: "Hook" },
    { id: "S01", source: "script-section", section: "Hook" },
    { id: "01", source: "clip-card", section: "Opening hook" },
  ];

  const refs = parser.crossReferenceBeats(beats);
  assert.equal(refs.size, 2);

  const hookEntry = refs.get("hook");
  assert.ok(hookEntry);
  assert.equal(hookEntry.marker.id, "M01");
  assert.equal(hookEntry.scriptSection.id, "S01");
  assert.equal(hookEntry.clipCard, null);
});

test("crossReferenceBeats handles beats with no section", () => {
  const beats = [
    { id: "M01", source: "marker-map", section: "" },
    { id: "M02", source: "marker-map", section: null },
  ];

  const refs = parser.crossReferenceBeats(beats);
  assert.equal(refs.size, 0);
});

test("crossReferenceBeats handles empty input", () => {
  const refs = parser.crossReferenceBeats([]);
  assert.equal(refs.size, 0);
});

test("parser CLI --help returns 0 and shows usage", () => {
  const { captureConsole } = require("./_helpers.js");
  const output = captureConsole(() => parser.main(["--help"]));
  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /Visual Beat Map Parser/);
});

test("parser CLI --json outputs valid JSON with beats and sources", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beat-map-cli-"));
  const runDir = path.join(tmpRoot, "test-run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    SCRIPT_FIXTURE,
    "utf8"
  );

  const { captureConsole } = require("./_helpers.js");
  const output = captureConsole(() => parser.main([runDir, "--json"]));

  const parsed = JSON.parse(output.stdout.join("\n"));
  assert.ok(parsed.beats);
  assert.ok(parsed.sources);
  assert.equal(parsed.sources.script, true);
  assert.equal(parsed.beats.length, 5);
});

test("parser CLI text output shows beat summary", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beat-map-cli-"));
  const runDir = path.join(tmpRoot, "test-run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "final-script.md"),
    SCRIPT_FIXTURE,
    "utf8"
  );

  const { captureConsole } = require("./_helpers.js");
  const output = captureConsole(() => parser.main([runDir]));

  assert.match(output.stdout.join("\n"), /Total beats: 5/);
  assert.match(output.stdout.join("\n"), /Script Sections/);
});

test("parser CLI returns 1 for missing directory argument", () => {
  const { captureConsole } = require("./_helpers.js");
  const output = captureConsole(() => parser.main([]));
  assert.equal(output.result, 1);
});
