/**
 * VIDTOOLZ Episode Factory Tests — Visual Beat Map Panel
 */

const { assert, test } = require("./_helpers.js");
const visualBeatMapPanel = require("../visual-beat-map-panel.js");

test("visual beat map panel groups beats by source and priority", () => {
  const groups = visualBeatMapPanel.groupBeats([
    { id: "C02", source: "clip-card", priority: 20 },
    { id: "M02", source: "marker-map", priority: 2 },
    { id: "M01", source: "marker-map", priority: 1 },
    { id: "S01", source: "script-section", priority: 10 },
  ]);

  assert.deepEqual(groups["marker-map"].map((beat) => beat.id), ["M01", "M02"]);
  assert.deepEqual(groups["clip-card"].map((beat) => beat.id), ["C02"]);
  assert.deepEqual(groups["script-section"].map((beat) => beat.id), ["S01"]);
});

test("visual beat map panel renders source groups, beat fields, and read-only copy", () => {
  const html = visualBeatMapPanel.renderBeatMapPanel({
    runId: "2026-05-06-ai-video-proof-plan",
    sources: { markers: true, clipCards: true, script: true },
    beats: [
      {
        id: "M01",
        source: "marker-map",
        priority: 1,
        section: "Hook / first 30 seconds",
        narrationCue: "What will this video prove on screen?",
        proofStatus: "Demonstration only",
        insertType: "Label",
        viewerRisk: "Opening may stay visually plain.",
        resolveNote: "Add simple on-screen label.",
        decisionNeeded: "Mikko decides whether label is useful.",
      },
      {
        id: "CC01",
        source: "clip-card",
        priority: 2,
        workingTitle: "Desktop proof insert",
        proofStatus: "Real proof",
        editPlacement: "After hook.",
      },
    ],
  });

  assert.match(html, /Visual Beat Map/);
  assert.match(html, /2026-05-06-ai-video-proof-plan/);
  assert.match(html, /2 beats/);
  assert.match(html, /Read-only timeline/);
  assert.match(html, /Resolve Marker Map/);
  assert.match(html, /Media Clip Cards/);
  assert.match(html, /M01/);
  assert.match(html, /What will this video prove on screen\?/);
  assert.match(html, /Mikko decides whether label is useful\./);
  assert.match(html, /Desktop proof insert/);
});

test("visual beat map panel renders empty state with source flags", () => {
  const html = visualBeatMapPanel.renderBeatMapPanel({
    runId: "empty-run",
    sources: { markers: false, clipCards: true, script: false },
    beats: [],
  });

  assert.match(html, /No beat map data found/);
  assert.match(html, /Marker map: missing/);
  assert.match(html, /Clip cards: present/);
  assert.match(html, /Script: missing/);
});

test("visual beat map panel maps proof statuses to stable classes", () => {
  assert.equal(visualBeatMapPanel.statusClass("Real proof captured"), "real-proof");
  assert.equal(visualBeatMapPanel.statusClass("Do not imply this happened"), "do-not-imply");
  assert.equal(visualBeatMapPanel.statusClass("Illustration-only support"), "illustration");
  assert.equal(visualBeatMapPanel.statusClass("Demonstration"), "demonstration");
  assert.equal(visualBeatMapPanel.statusClass(""), "unknown");
});

test("visual beat map panel escapes beat card content", () => {
  const html = visualBeatMapPanel.renderBeatCard({
    id: "M<script>",
    source: "marker-map",
    narrationCue: "<img src=x onerror=alert(1)>",
    proofStatus: "Real proof",
    viewerRisk: "A & B",
  });

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /M&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /A &amp; B/);
});
