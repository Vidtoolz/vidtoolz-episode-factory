const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");

const projection = require("../scripts/package-run-state-projection.js");
const operations = require("../scripts/package-run-state-operations.js");
const packageRunWorkflowMap = require("../scripts/package-run-workflow-map.js");

// Canonical gate evidence formats (package-runs-index.js readLifecycleGate).
const RESEARCH_PACK_PASS = "# Research Pack\n\n- Status: PASS\n";
const SCRIPT_STRUCTURE_READY = "# Script Structure\n\n- Script structure status: READY TO DRAFT\n- Ready to draft: yes\n";
const SCRIPT_REVIEW_PASS = "# Script Review\n\n- Script review status: PASS\n- Production planning ready: yes\n";
const PRODUCTION_PLAN_READY = "# Production Plan\n\n- Shoot-readiness status: READY TO SHOOT\n";

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeRun(root, runId, files = {}) {
  const runDir = path.join(root, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  Object.entries(files).forEach(([name, content]) => {
    fs.writeFileSync(path.join(runDir, name), content, "utf8");
  });
  return runDir;
}

// ── 1. Projection creation / gate transitions / blockers / human review ────

test("PR1: new run — projection is created with ACTIVE status and package-selection gate", () => {
  const root = makeRoot("prs-create-");
  const runId = "2026-08-25-state-authority-canary";
  makeRun(root, runId, {
    "package-candidates.json": JSON.stringify({ topic: "canary", candidates: [] }),
  });

  const result = operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  assert.equal(result.ok, true);
  assert.equal(result.action, "create");
  assert.equal(result.path, `package-runs/${runId}/package-run-state.md`);
  assert.equal(result.authority_source, "14-gate workflow authority");

  const text = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  const proj = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(proj.state, "ACTIVE");
  assert.equal(proj.is_package_run, true);
  assert.equal(proj.current_gate, "package-selection");
  assert.match(text, /Projection status: ACTIVE/);
  assert.match(text, /Authority source: 14-gate workflow authority/);
  assert.match(text, /Package run state: active/);
  assert.match(text, /Workflow path: horizontal/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR2: gate transition — projection updates after canonical evidence appears", () => {
  const root = makeRoot("prs-transition-");
  const runId = "2026-08-25-state-transition-canary";
  const runDir = makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Transition" } }),
  });
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const before = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(before.current_gate, "research");

  // Canonical gate evidence advances the gate — the projection follows.
  fs.writeFileSync(path.join(runDir, "research-pack.md"), RESEARCH_PACK_PASS, "utf8");
  const after = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(after.gates.find((g) => g.id === "research").status, "complete");
  assert.notEqual(after.canonical_digest, before.canonical_digest);

  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const text = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.match(text, /research .* complete|research.*complete/i);
  assert.equal(projection.digestFromText(text), after.canonical_digest);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR3: blocker — projection shows BLOCKED when the current gate cannot complete", () => {
  const root = makeRoot("prs-blocked-");
  const runId = "2026-08-25-state-blocked-canary";
  makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Blocked" } }),
    "research-pack.md": "# Research Pack\n\n- Status: INCOMPLETE\n",
  });
  const proj = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(proj.state, "BLOCKED");
  assert.ok(proj.blocker.length > 0, "blocker must be surfaced");
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const text = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  assert.match(text, /Projection status: BLOCKED/);
  assert.match(text, /Blocker:/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR4: human review — projection flags human authority when approval is required", () => {
  const root = makeRoot("prs-human-");
  const runId = "2026-08-25-state-human-canary";
  makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Human" } }),
    "research-pack.md": RESEARCH_PACK_PASS,
    "script-structure.md": SCRIPT_STRUCTURE_READY,
    "script-review.md": SCRIPT_REVIEW_PASS,
    "production-plan.md": PRODUCTION_PLAN_READY,
  });
  const proj = projection.buildProjection({ repoRoot: root, runId });
  // production-plan / shot-edit gates are human-gated in the canonical model.
  assert.ok(proj.gates_complete >= 4, `expected >=4 complete gates, got ${proj.gates_complete}`);
  assert.equal(proj.human_authority_required, true);
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const text = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  assert.match(text, /Human authority required: yes/);
  assert.match(text, /Pending human decision:/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR5: completion — markers alone never earn COMPLETE without concrete capture evidence", () => {
  const root = makeRoot("prs-complete-");
  const runId = "2026-08-25-state-complete-canary";
  // Every review marker below says PASS/APPROVED. The canonical engine still
  // refuses COMPLETE because scripts/package-run-capture-evidence-review.js
  // finds no concrete capture artifacts (takes, screen recording, audio). That
  // refusal is the system working: the projection reports canonical truth, it
  // does not upgrade markers into completion.
  const runDir = makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Complete" } }),
    "research-pack.md": RESEARCH_PACK_PASS,
    "script-structure.md": SCRIPT_STRUCTURE_READY,
    "script-review.md": SCRIPT_REVIEW_PASS,
    "production-plan.md": PRODUCTION_PLAN_READY,
    "shot-edit-plan-review.md": "# Shot Edit Plan Review\n\n- Review status: PASS\n- Stage accepted: yes\n",
    "capture-checklist.md": "# Capture Checklist\n\n- Capture checklist status: COMPLETE\n- Manual approval: APPROVED\n- Ready for rough cut: yes\n",
    "capture-evidence-review.md": "# Capture Evidence Review\n\n- Review status: PASS\n- Capture evidence accepted: yes\n- Real capture evidence detected: yes\n",
    "rough-cut-watch-notes.md": "# Rough Cut Watch Notes\n\n- Timestamp: 00:00-02:00 watched in full\n- Observation: pacing holds\n",
    "rough-cut-review.md": "# Rough Cut Review\n\n- Rough-cut review status: PASS\n- Second-cut ready: yes\n",
    "final-watch-notes.md": "# Final Watch Notes\n\n- Timestamp: 00:00-02:00 watched in full\n- Observation: final cut verified\n",
    "final-review.md": "# Final Review\n\n- Final review status: PASS\n- Publish ready: yes\n",
    "export-checklist.md": "# Export Checklist\n\n- Manual approval: APPROVED\n- Export approval: APPROVED\n- Upload approval: APPROVED\n",
    "master-file-manifest.md": "# Master File Manifest\n\n- File: final.mp4\n- Duration: 2:00\n",
    "caption-check.md": "# Caption Check\n\n- Captions verified: yes\n",
    "loudness-check.md": "# Loudness Check\n\n- Mastering approval: APPROVED\n- Loudness: -14 LUFS\n",
    "delivery-readiness.md": "# Delivery Readiness\n\n- Delivery approval: APPROVED\n",
    "publish-metadata-review.md": "# Publish Metadata Review\n\n- Metadata approval: APPROVED\n- Manual approval: APPROVED\n",
    "title-check.md": "# Title Check\n\n- Title verified: yes\n",
    "thumbnail-check.md": "# Thumbnail Check\n\n- Thumbnail verified: yes\n",
    "description-check.md": "# Description Check\n\n- Description verified: yes\n",
    "chapters-check.md": "# Chapters Check\n\n- Chapters verified: yes\n",
    "schedule-check.md": "# Schedule Check\n\n- Schedule verified: yes\n",
    "archive-manifest.md": "# Archive Manifest\n\n- Archive approval: APPROVED\n- Manual archive approval: APPROVED\n",
    "archive-source-files.md": "# Archive Source Files\n\n- source-a.txt\n",
    "archive-assets-manifest.md": "# Archive Assets Manifest\n\n- asset-a.png\n",
    "archive-export-manifest.md": "# Archive Export Manifest\n\n- export-a.mp4\n",
    "reusable-clips-manifest.md": "# Reusable Clips Manifest\n\n- clip-a.mp4\n",
    "archive-blockers.md": "# Archive Blockers\n\n- none\n",
    "repurposing-plan.md": "# Repurposing Plan\n\n- shorts: 2\n",
  });
  void runDir;
  const proj = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(proj.state, "BLOCKED", "canonical refuses completion without concrete capture evidence");
  assert.match(proj.blocker || "", /Capture evidence/i);
  assert.ok(projection.PROJECTION_STATES.includes("COMPLETE"), "COMPLETE remains a reachable projection state");

  // COMPLETE is still covered, from an all-complete canonical gate map rather
  // than from fabricated evidence.
  const allComplete = {
    gates: packageRunWorkflowMap.GATE_DEFINITIONS.map((gate) => ({ id: gate.id, status: "complete" })),
    currentBlocker: "",
  };
  assert.equal(projection.deriveProjectionState(allComplete), "COMPLETE");
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR6: idempotent reprojection — same canonical evidence yields identical canonical body", () => {
  const root = makeRoot("prs-idempotent-");
  const runId = "2026-08-25-state-idempotent-canary";
  makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Idempotent" } }),
    "research-pack.md": RESEARCH_PACK_PASS,
  });
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations", generatedAt: "2026-08-25T00:00:00.000Z" });
  const first = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations", generatedAt: "2026-08-25T01:00:00.000Z" });
  const second = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  assert.equal(operations.canonicalBody(first), operations.canonicalBody(second));
  assert.equal(projection.digestFromText(first), projection.digestFromText(second));
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR7: atomic write — a failed writer leaves no partial projection", () => {
  const root = makeRoot("prs-atomic-");
  const runId = "2026-08-25-state-atomic-canary";
  const runDir = makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Atomic" } }),
  });
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const before = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");

  // Simulate a crash mid-write: the atomic writer refuses after nothing is
  // committed; the canonical projection on disk must remain intact.
  assert.throws(
    () => operations.writeRunState({
      repoRoot: root, runId, actor: "production_operations",
      atomicWriter: () => { throw new Error("simulated disk failure"); },
    }),
    /simulated disk failure/
  );
  const after = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.equal(after, before, "failed write must not corrupt the existing projection");
  const tmpLeftovers = fs.readdirSync(runDir).filter((name) => name.includes(".tmp-"));
  assert.deepEqual(tmpLeftovers, [], "no partial temp files may survive a failed atomic write");
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR8: rebuild — deleting the projection and regenerating recreates equivalent content", () => {
  const root = makeRoot("prs-rebuild-");
  const runId = "2026-08-25-state-rebuild-canary";
  const runDir = makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Rebuild" } }),
    "research-pack.md": RESEARCH_PACK_PASS,
  });
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations", generatedAt: "2026-08-25T00:00:00.000Z" });
  const original = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");

  fs.unlinkSync(path.join(runDir, "package-run-state.md"));
  const result = operations.rebuildRunState({ repoRoot: root, runId, actor: "production_operations", generatedAt: "2026-08-25T02:00:00.000Z" });
  assert.equal(result.action, "create");
  const rebuilt = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.equal(operations.canonicalBody(original), operations.canonicalBody(rebuilt));
  // Rebuild must NOT depend on the old markdown contents — it derives from
  // canonical evidence. Corrupt the file first, then rebuild again.
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "garbage injected by a specialist\n", "utf8");
  operations.rebuildRunState({ repoRoot: root, runId, actor: "production_operations" });
  const recovered = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.match(recovered, /Projection status:/);
  assert.ok(!recovered.includes("garbage injected"), "rebuild must restore canonical truth");
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR9: staleness — evidence change without refresh is detected as RUN_STATE_PROJECTION_DRIFT", () => {
  const root = makeRoot("prs-stale-");
  const runId = "2026-08-25-state-stale-canary";
  const runDir = makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Stale" } }),
  });
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  // Canonical evidence advances; projection not refreshed.
  fs.writeFileSync(path.join(runDir, "research-pack.md"), RESEARCH_PACK_PASS, "utf8");
  const report = operations.checkRunState({ repoRoot: root, runId });
  assert.equal(report.ok, false);
  assert.equal(report.projection_stale, true);
  assert.ok(report.defects.some((d) => d.code === "RUN_STATE_PROJECTION_DRIFT"), JSON.stringify(report.defects));
  // Refresh resolves the drift.
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const healed = operations.checkRunState({ repoRoot: root, runId });
  assert.equal(healed.ok, true, JSON.stringify(healed.defects));
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 3. Write authority / specialist self-promotion / path safety ───────────

test("PR10: write authority — specialists cannot write package-run state", () => {
  const root = makeRoot("prs-authority-");
  const runId = "2026-08-25-state-authority-guard";
  makeRun(root, runId, { "package-candidates.json": JSON.stringify({ topic: "x", candidates: [] }) });
  for (const actor of ["story_editor", "editor", "qc_director", "generation_supervisor", "hermes", ""]) {
    assert.throws(
      () => operations.writeRunState({ repoRoot: root, runId, actor }),
      (error) => error.code === "RUN_STATE_WRITE_REFUSED",
      `actor ${actor || "(empty)"} must be refused`
    );
  }
  assert.ok(!fs.existsSync(path.join(root, "package-runs", runId, "package-run-state.md")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR11: specialist self-promotion — injected canonical state is refused", () => {
  const root = makeRoot("prs-inject-");
  const runId = "2026-08-25-state-inject-canary";
  makeRun(root, runId, { "package-candidates.json": JSON.stringify({ topic: "x", candidates: [] }) });
  // A specialist cannot smuggle a pre-built workflow map, override, or gate.
  assert.throws(() => projection.buildProjection({ repoRoot: root, runId, map: { gates: [] } }), (e) => e.code === "CANONICAL_OVERRIDE_REFUSED");
  assert.throws(() => projection.buildProjection({ repoRoot: root, runId, canonical_override: "final-review" }), (e) => e.code === "CANONICAL_OVERRIDE_REFUSED");
  assert.throws(() => projection.buildProjection({ repoRoot: root, runId, current_gate: "final-review" }), (e) => e.code === "CANONICAL_OVERRIDE_REFUSED");
  // And manual markdown edits never advance canonical state.
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const filePath = path.join(root, "package-runs", runId, "package-run-state.md");
  fs.writeFileSync(filePath, "# Package Run State\n\n- Package run state: active\n\n## Projection status: COMPLETE\n\nGates complete: 14/14\n", "utf8");
  const proj = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(proj.state, "ACTIVE", "hand-edited markdown must not change canonical state");
  assert.equal(proj.gates_complete, 0);
  // Next regeneration restores canonical truth.
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const restored = fs.readFileSync(filePath, "utf8");
  assert.match(restored, /Projection status: ACTIVE/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR12: path safety — invalid ids and out-of-package-runs targets are refused", () => {
  const root = makeRoot("prs-path-");
  fs.mkdirSync(path.join(root, "package-runs"), { recursive: true });
  for (const bad of ["../escape", "..%2Fescape", "no-date-prefix", "2026-08-25-CAPS", "2026-08-25-"]) {
    assert.throws(() => projection.safeRunId(bad), (e) => e.code === "RUN_ID_INVALID", `id ${bad} must be refused`);
  }
  assert.throws(
    () => operations.writeRunState({ repoRoot: root, runId: "2026-08-25-valid-id", runDir: path.join(root, "elsewhere"), actor: "production_operations" }),
    (e) => e.code === "RUN_DIR_OUTSIDE_PACKAGE_RUNS"
  );
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 4. Tracker demotion / one-way authority / split-brain ──────────────────

test("PR13: tracker is a display projection — no tracker input advances canonical state", () => {
  const root = makeRoot("prs-tracker-");
  const runId = "2026-08-25-state-tracker-canary";
  makeRun(root, runId, { "package-candidates.json": JSON.stringify({ topic: "x", candidates: [] }) });
  // Tracker snapshot claiming published (stage 12) while canonical evidence is empty.
  const proj = projection.buildProjection({ repoRoot: root, runId });
  const verdict = projection.trackerDivergence(proj, { currentStage: 12 });
  assert.equal(verdict.code, "RUN_STATE_PROJECTION_DRIFT");
  assert.match(verdict.detail, /Canonical 14-gate state wins/);
  // Canonical gate is unchanged by the tracker claim.
  const after = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(after.state, proj.state);
  assert.equal(after.current_gate, proj.current_gate);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR14: 14→tracker mapping — deterministic gate→stage projection, no inverse authority", () => {
  const map = projection.GATE_TO_TRACKER_STAGE;
  assert.equal(Object.keys(map).length, 14, "every canonical gate maps to exactly one display stage");
  assert.equal(map["package-selection"], 0);
  assert.equal(map["research"], 1);
  // script-review.md sits in the tracker's own "Claims Check" evidence set
  // (alongside source-support-map.md), not its "Script" set — so the shared
  // mapping projects this gate to claims(3). Reconciled with the tracker clamp.
  assert.equal(map["script-review"], 3);
  assert.equal(map["capture-evidence"], 9);
  assert.equal(map["rough-cut-review"], 10);
  assert.equal(map["export-check"], 11);
  assert.equal(map["archive"], 12);
  // Determinism and refusal of unknown gates.
  assert.equal(projection.gateToTrackerStage("research"), 1);
  assert.equal(projection.gateToTrackerStage("research"), 1);
  // An unknown gate yields null, never a silent stage 0: "canonical state
  // unknown" and "canonical state is the first stage" are different facts.
  assert.equal(projection.gateToTrackerStage("not-a-gate"), null);
  // The inverse is not exposed as an authority function — the module exports
  // no trackerStage→gate writer.
  assert.equal(typeof projection.trackerStageToGate, "undefined");
  assert.equal(typeof projection.advanceCanonicalGate, "undefined");
});

test("PR15: split-brain detection — canonical vs projection vs tracker divergence surfaced", () => {
  const root = makeRoot("prs-splitbrain-");
  const runId = "2026-08-25-state-splitbrain-canary";
  const runDir = makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Split" } }),
  });
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  // Diverge the durable projection by hand (stale prior gate claim).
  const filePath = path.join(runDir, "package-run-state.md");
  fs.writeFileSync(path.join(runDir, "research-pack.md"), RESEARCH_PACK_PASS, "utf8");
  const report = operations.checkRunState({
    repoRoot: root,
    runId,
    trackerSnapshot: { currentStage: 12 },
  });
  assert.equal(report.ok, false);
  const codes = report.defects.map((d) => d.code);
  assert.ok(codes.includes("RUN_STATE_PROJECTION_DRIFT"), `drift expected, got ${codes.join(",")}`);
  // Canonical state itself is never corrupted by the divergence.
  const proj = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(proj.gates.find((g) => g.id === "research").status, "complete");
  // Recovery: refresh the projection; drift clears (tracker lag may remain as display defect).
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const healed = operations.checkRunState({ repoRoot: root, runId });
  assert.equal(healed.projection_stale, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR16: consistency — canonical gate, projection file, and control-room workflow map agree", () => {
  const root = makeRoot("prs-consistency-");
  const runId = "2026-08-25-state-consistency-canary";
  makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Consistent" } }),
    "research-pack.md": RESEARCH_PACK_PASS,
  });
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  // Control-room source: the canonical workflow map (same engine the cockpit uses).
  const map = packageRunWorkflowMap.buildWorkflowMap(path.join("package-runs", runId), { repoRoot: root });
  // Built with the file context, exactly as checkRunState does in production —
  // otherwise the projection carries no marker state to compare the file against.
  const fileForProjection = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  const proj = projection.buildProjection({ repoRoot: root, runId, existingText: fileForProjection });
  assert.equal(proj.canonical_digest, projection.canonicalDigest(map));
  assert.equal(proj.current_gate, projection.currentGateIdFromMap(map));
  const fileText = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  const report = projection.consistencyReport({ projection: proj, fileText });
  assert.equal(report.ok, true, JSON.stringify(report.defects));
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 5. UNKNOWN legacy / marker preservation / demotion contract ────────────

test("PR17: unknown legacy — directory without package-run identity is UNKNOWN_LEGACY, never guessed", () => {
  const root = makeRoot("prs-unknown-");
  const runId = "2026-08-25-state-unknown-canary";
  makeRun(root, runId, { "random-note.md": "not canonical evidence\n" });
  const proj = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(proj.state, "UNKNOWN_LEGACY");
  assert.equal(proj.current_gate, "");
  assert.equal(proj.is_package_run, false);
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const text = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  assert.match(text, /Projection status: UNKNOWN_LEGACY/);
  assert.match(text, /do not guess run state/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR18: marker preservation — human marker lines survive refresh and rebuild", () => {
  const root = makeRoot("prs-marker-");
  const runId = "2026-08-25-state-marker-canary";
  const runDir = makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Marker" } }),
  });
  // Mikko parks the run via the human-owned marker.
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n\n- Package run state: parked\n- Workflow path: vertical\n", "utf8");
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const text = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.match(text, /Package run state: parked/);
  assert.match(text, /Workflow path: vertical/);
  const proj = projection.buildProjection({ repoRoot: root, runId, existingText: text });
  assert.equal(proj.state, "PARKED");
  operations.rebuildRunState({ repoRoot: root, runId, actor: "production_operations" });
  const rebuilt = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.match(rebuilt, /Package run state: parked/);
  assert.match(rebuilt, /Workflow path: vertical/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR19: tracker demotion — tracker header declares display projection, no write authority", () => {
  const trackerSource = fs.readFileSync(path.join(__dirname, "..", "pipeline-tracker.js"), "utf8");
  assert.match(trackerSource, /DISPLAY PROJECTION/);
  assert.match(trackerSource, /never advances or redefines/);
  assert.ok(!/RUNTIME SOURCE OF TRUTH/.test(trackerSource), "tracker must no longer claim runtime source-of-truth authority");
  const tracker = require("../pipeline-tracker.js");
  // The tracker exposes rendering + advisory mappings only; it has no function
  // that mutates canonical gate state.
  assert.equal(typeof tracker.mount, "function");
  assert.equal(typeof tracker.render, "function");
  assert.equal(typeof tracker.statusToStage, "function");
  assert.equal(typeof tracker.advanceCanonicalState, "undefined");
  assert.equal(typeof tracker.setCanonicalGate, "undefined");
});

test("PR20: projection module is side-effect-free and read-only", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "scripts", "package-run-state-projection.js"), "utf8");
  assert.ok(text.includes("VIDTOOLZ script safety"));
  assert.match(text, /Read\/write behavior:\s*READ-ONLY/);
  const forbidden = /\bfs\.(?:writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync|createWriteStream)\s*\(/g;
  assert.deepEqual(text.match(forbidden) || [], [], "projection library must contain no filesystem write calls");
});

test("PR21: operations module declares MUTATES package-run-state.md ONLY and bounds its writes", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "scripts", "package-run-state-operations.js"), "utf8");
  assert.ok(text.includes("VIDTOOLZ script safety"));
  assert.match(text, /MUTATES package-run-state\.md ONLY/);
  assert.match(text, /never mutates canonical gate evidence/);
  assert.deepEqual(operations.AUTHORIZED_WRITERS, ["production_operations"]);
});

test("PR22: owner readiness — gate owners are represented truthfully, never substituted", () => {
  const root = makeRoot("prs-owner-");
  const runId = "2026-08-25-state-owner-canary";
  makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Owner" } }),
  });
  const proj = projection.buildProjection({ repoRoot: root, runId });
  assert.equal(proj.expected_owner, "research_director");
  assert.equal(proj.owner_readiness.kind, "agent");
  assert.equal(proj.owner_readiness.implementation_state, "IMPLEMENTATION_PROVEN");
  // Capture-checklist gate names presenter_director. Commit 029c407 enabled
  // that existing role through the registry + contract coupling, so the
  // projection must report it as dispatchable, not preserve the older disabled
  // state or silently substitute another agent.
  const capGate = "capture-checklist";
  assert.equal(projection.GATE_OWNERS[capGate], "presenter_director");
  const readiness = projection.readOwnerReadiness(path.resolve(__dirname, ".."), "presenter_director");
  assert.equal(readiness.implementation_state, "IMPLEMENTATION_PROVEN");
  assert.equal(readiness.dispatch_enabled, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR23: QC Director durable output is consumed read-only into the projection", () => {
  const root = makeRoot("prs-qc-");
  const runId = "2026-08-25-state-qc-canary";
  const runDir = makeRun(root, runId, {
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "QC" } }),
  });
  const qcDir = path.join(runDir, "agents", "qc_director", "qc-task-01");
  fs.mkdirSync(qcDir, { recursive: true });
  fs.writeFileSync(path.join(qcDir, "result.json"), JSON.stringify({
    schema_version: 1, agent_id: "qc_director", task_id: "qc-task-01", state: "COMPLETE",
    disposition: "PASS_WITH_FINDINGS", blockers: [], defects: [{ code: "X" }],
    human_authority: "mikko", next_gate_allowed: false, inspected_at: "2026-08-25T08:00:00.000Z",
  }), "utf8");
  const proj = projection.buildProjection({ repoRoot: root, runId });
  assert.ok(proj.qc_disposition, "QC disposition must be consumed");
  assert.equal(proj.qc_disposition.disposition, "PASS_WITH_FINDINGS");
  assert.equal(proj.qc_disposition.defect_count, 1);
  assert.equal(proj.qc_disposition.next_gate_allowed, false);
  // Canonical gate state is unaffected by the QC record (read-only consumption).
  assert.equal(proj.current_gate, "research");
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  const text = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.match(text, /Latest QC disposition: PASS_WITH_FINDINGS/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR24: new-run lifecycle — creation writes the durable projection immediately", () => {
  // Simulates the package-engine-new-run.js creation sequence end to end in an
  // isolated root: new runs must never be UNKNOWN.
  const root = makeRoot("prs-newrun-");
  const runId = "2026-08-25-state-newrun-canary";
  const runDir = makeRun(root, runId, {});
  fs.writeFileSync(path.join(runDir, "generation-prompt.md"), "# prompt\n", "utf8");
  fs.writeFileSync(path.join(runDir, "package-candidates.json"), JSON.stringify({ topic: "new", candidates: [] }), "utf8");
  const result = operations.writeRunState({ repoRoot: root, runId, actor: "production_operations", workflowPath: "vertical" });
  assert.equal(result.action, "create");
  const text = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.match(text, /Workflow path: vertical/);
  assert.match(text, /Projection status: ACTIVE/);
  const check = operations.checkRunState({ repoRoot: root, runId });
  assert.equal(check.ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR25: forged projection grammar without a generated body is not preserved as human content", () => {
  // A hand-written file carrying marker lines PLUS forged projection claims
  // ("## Projection status: COMPLETE") but NO generated-body comment must not
  // have its forged body preserved on rebuild: only the heading and the two
  // marker lines are human authority. Otherwise a specialist could plant a
  // fake COMPLETE claim that survives every rebuild.
  const root = makeRoot("prs-forge-");
  const runId = "2026-08-25-state-forge-canary";
  const runDir = makeRun(root, runId, {
    "package-candidates.json": JSON.stringify({ topic: "forge", candidates: [] }),
  });
  fs.writeFileSync(
    path.join(runDir, "package-run-state.md"),
    "# Package Run State\n\n- Package run state: active\n- Workflow path: horizontal\n\n## Projection status: COMPLETE\n\nGates complete: 14/14\n",
    "utf8"
  );
  operations.rebuildRunState({ repoRoot: root, runId, actor: "production_operations" });
  const rebuilt = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
  assert.ok(!/Projection status: COMPLETE/.test(rebuilt), "forged COMPLETE claim must not survive rebuild");
  assert.ok(!/Gates complete: 14\/14/.test(rebuilt), "forged gate count must not survive rebuild");
  assert.match(rebuilt, /Package run state: active/);
  assert.match(rebuilt, /Workflow path: horizontal/);
  assert.match(rebuilt, /Projection status: ACTIVE/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("PR26: rebuild never duplicates the marker block, even across repeated rebuilds", () => {
  // The generated body re-renders marker lines of its own, so a rebuild that
  // scans past the generated-body comment plants duplicate markers in the
  // human block. Exactly one marker block must survive any number of rebuilds.
  const root = makeRoot("prs-nodup-");
  const runId = "2026-08-25-state-nodup-canary";
  makeRun(root, runId, {
    "package-candidates.json": JSON.stringify({ topic: "nodup", candidates: [] }),
  });
  operations.writeRunState({ repoRoot: root, runId, actor: "production_operations" });
  operations.rebuildRunState({ repoRoot: root, runId, actor: "production_operations" });
  operations.rebuildRunState({ repoRoot: root, runId, actor: "production_operations" });
  const text = fs.readFileSync(path.join(root, "package-runs", runId, "package-run-state.md"), "utf8");
  const humanRegion = text.split("<!-- GENERATED PROJECTION")[0];
  assert.equal((humanRegion.match(/^- Package run state:/gm) || []).length, 1, "marker block duplicated in the human region");
  assert.equal((humanRegion.match(/^- Workflow path:/gm) || []).length, 1, "workflow path duplicated in the human region");
  assert.equal((humanRegion.match(/^#\s+Package Run State/gm) || []).length, 1, "heading duplicated");
  fs.rmSync(root, { recursive: true, force: true });
});
