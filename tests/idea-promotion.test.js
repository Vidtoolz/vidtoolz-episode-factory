/**
 * VIDTOOLZ Episode Factory Tests — Idea triage + promote-to-project, and the
 * shared-nav closure pass.
 *
 * Idea triage is stored in a non-destructive per-date sidecar (the validated
 * ideas.json is never rewritten). Promotion creates a convention-compatible
 * script-package the project state resolver can read, and is idempotent.
 */

const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");

const ideaPromotion = require("../idea-promotion.js");
const { resolveProjectState } = require("../project-state-resolver.js");
const { chooseNextTask } = require("../next-task-engine.js");
const { summarizeProject } = require("../project-discovery.js");

// Build a temp archive root with one date of ideas (mirrors ideas.json shape).
function makeArchive(date = "2026-06-30", ideas) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "idea-prom-"));
  const archiveRoot = path.join(root, "daily-idea-scout");
  const scriptPackagesRoot = path.join(root, "script-packages");
  fs.mkdirSync(path.join(archiveRoot, date), { recursive: true });
  fs.mkdirSync(scriptPackagesRoot, { recursive: true });
  const list = ideas || [
    { title: "Stop Stacking AI Tools. Build Gates.", description: "Creators pile up AI tools. The win is gates. Here's how.", thumbnail_prompt: "x", evidence: [{ type: "a", title: "b" }], scores: {}, final_score: 8.4, rank: 1 },
    { title: "Second Idea Title", description: "Another premise sentence here.", thumbnail_prompt: "y", evidence: [{ type: "a", title: "b" }], scores: {}, final_score: 7.1, rank: 2 },
  ];
  fs.writeFileSync(path.join(archiveRoot, date, "ideas.json"), JSON.stringify({ date, generated_at: "t", provider: "manual", ideas: list }));
  return { root, archiveRoot, scriptPackagesRoot, date };
}

// ── Idea triage status ──────────────────────────────────────────────────────

test("idea status: approve/reject/park/unpark write a non-destructive sidecar", () => {
  const a = makeArchive();
  const ideasBefore = fs.readFileSync(path.join(a.archiveRoot, a.date, "ideas.json"), "utf8");
  for (const status of ["approved", "rejected", "parked", "new"]) {
    const r = ideaPromotion.setIdeaStatus({ archiveRoot: a.archiveRoot, date: a.date, index: 0, status, now: "T" });
    assert.equal(r.status, status);
  }
  // ideas.json is untouched; status lives in the sidecar.
  assert.equal(fs.readFileSync(path.join(a.archiveRoot, a.date, "ideas.json"), "utf8"), ideasBefore);
  const triage = ideaPromotion.readTriage(a.archiveRoot, a.date);
  assert.equal(triage["0"].status, "new");
  assert.equal(triage["0"].title, "Stop Stacking AI Tools. Build Gates.");
});

test("idea status: invalid status -> 400, invalid index -> 404", () => {
  const a = makeArchive();
  assert.throws(() => ideaPromotion.setIdeaStatus({ archiveRoot: a.archiveRoot, date: a.date, index: 0, status: "bogus" }), (e) => e.statusCode === 400);
  assert.throws(() => ideaPromotion.setIdeaStatus({ archiveRoot: a.archiveRoot, date: a.date, index: 99, status: "approved" }), (e) => e.statusCode === 404);
});

test("idea status: invalid date -> 400", () => {
  const a = makeArchive();
  assert.throws(() => ideaPromotion.getIdea(a.archiveRoot, "not-a-date", 0), (e) => e.statusCode === 400);
});

// ── Promotion ───────────────────────────────────────────────────────────────

test("promote: creates a resolvable project with a sensible first task", () => {
  const a = makeArchive();
  const r = ideaPromotion.promoteIdea({ archiveRoot: a.archiveRoot, scriptPackagesRoot: a.scriptPackagesRoot, date: a.date, index: 0, now: "T" });
  assert.equal(r.created, true);
  assert.equal(r.project_id, "stop-stacking-ai-tools-build-gates-20260630");

  const pkgDir = path.join(a.scriptPackagesRoot, r.project_id);
  assert.ok(fs.existsSync(path.join(pkgDir, "selected-package.json")));
  assert.ok(fs.existsSync(path.join(pkgDir, "manifest.json")));
  assert.ok(fs.existsSync(path.join(pkgDir, "promoted-from-idea.json")));

  const state = resolveProjectState(pkgDir);
  assert.equal(state.title, "Stop Stacking AI Tools. Build Gates.");
  assert.equal(state.has_metadata, true);
  const next = chooseNextTask(state);
  assert.equal(next.id, "write_script");
  assert.ok(next.primary_action.can_run_in_gui);
});

test("promote: idempotent — second promote returns the same project, no duplicate", () => {
  const a = makeArchive();
  const r1 = ideaPromotion.promoteIdea({ archiveRoot: a.archiveRoot, scriptPackagesRoot: a.scriptPackagesRoot, date: a.date, index: 0, now: "T" });
  const r2 = ideaPromotion.promoteIdea({ archiveRoot: a.archiveRoot, scriptPackagesRoot: a.scriptPackagesRoot, date: a.date, index: 0, now: "T" });
  assert.equal(r1.project_id, r2.project_id);
  assert.equal(r2.created, false);
  assert.equal(r2.already_promoted, true);
  assert.equal(fs.readdirSync(a.scriptPackagesRoot).length, 1);
});

test("promote: records project id in the idea triage sidecar", () => {
  const a = makeArchive();
  const r = ideaPromotion.promoteIdea({ archiveRoot: a.archiveRoot, scriptPackagesRoot: a.scriptPackagesRoot, date: a.date, index: 0, now: "T" });
  const triage = ideaPromotion.readTriage(a.archiveRoot, a.date);
  assert.equal(triage["0"].status, "promoted");
  assert.equal(triage["0"].project_id, r.project_id);
});

test("promote: project-id collision for same title/different idea is handled", () => {
  const a = makeArchive("2026-06-30", [
    { title: "Same Title", description: "First.", thumbnail_prompt: "x", evidence: [{ type: "a", title: "b" }], scores: {}, final_score: 8, rank: 1 },
    { title: "Same Title", description: "Second.", thumbnail_prompt: "x", evidence: [{ type: "a", title: "b" }], scores: {}, final_score: 7, rank: 2 },
  ]);
  const r1 = ideaPromotion.promoteIdea({ archiveRoot: a.archiveRoot, scriptPackagesRoot: a.scriptPackagesRoot, date: a.date, index: 0, now: "T" });
  const r2 = ideaPromotion.promoteIdea({ archiveRoot: a.archiveRoot, scriptPackagesRoot: a.scriptPackagesRoot, date: a.date, index: 1, now: "T" });
  assert.notEqual(r1.project_id, r2.project_id);
  assert.equal(fs.readdirSync(a.scriptPackagesRoot).length, 2);
});

test("promote: promoted project is discoverable with source=daily_idea_scout", () => {
  const a = makeArchive();
  const r = ideaPromotion.promoteIdea({ archiveRoot: a.archiveRoot, scriptPackagesRoot: a.scriptPackagesRoot, date: a.date, index: 0, now: "T" });
  const summary = summarizeProject(path.join(a.scriptPackagesRoot, r.project_id));
  assert.equal(summary.source, "daily_idea_scout");
  assert.equal(summary.title, "Stop Stacking AI Tools. Build Gates.");
  assert.equal(summary.next_task.id, "write_script");
});

// ── Provenance surfacing ────────────────────────────────────────────────────

test("provenance: promoted project state carries daily_idea_scout provenance", () => {
  const a = makeArchive();
  const r = ideaPromotion.promoteIdea({ archiveRoot: a.archiveRoot, scriptPackagesRoot: a.scriptPackagesRoot, date: a.date, index: 0, now: "T" });
  const state = resolveProjectState(path.join(a.scriptPackagesRoot, r.project_id));
  assert.equal(state.provenance.source, "daily_idea_scout");
  assert.equal(state.provenance.idea_date, "2026-06-30");
  assert.equal(state.provenance.idea_index, 0);
  assert.ok(state.provenance.premise.length > 0);
});

test("provenance: legacy script package reports source=package and renders cleanly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prov-legacy-"));
  const pkg = path.join(root, "legacy");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Legacy" } }));
  const state = resolveProjectState(pkg);
  assert.equal(state.provenance.source, "package");
});

test("provenance: malformed promoted-from-idea.json does not break resolution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prov-bad-"));
  const pkg = path.join(root, "broken");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Broken" } }));
  fs.writeFileSync(path.join(pkg, "promoted-from-idea.json"), "{ this is not json");
  const state = resolveProjectState(pkg); // must not throw
  assert.equal(state.provenance.source, "package");
  assert.equal(state.title, "Broken");
});

test("provenance UI: workspace renders a promoted-from-idea panel; focus shows compact source", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const ws = fs.readFileSync(path.join(repoRoot, "project-workspace.html"), "utf8");
  assert.match(ws, /Promoted from idea/);
  assert.match(ws, /function provenanceCard/);
  const focus = fs.readFileSync(path.join(repoRoot, "project-focus.html"), "utf8");
  assert.match(focus, /Daily Idea Scout idea/);
});

// ── Shared navigation ───────────────────────────────────────────────────────

// The nav is now a single shared component (ef-nav.js) injected into a mount, not
// hardcoded per page. Representative pages must mount + load it, and the shared
// component must still expose Projects and Ideas (now under "More"), so those
// destinations remain reachable from the nav.
test("shared nav: representative pages mount the shared component, which exposes Projects and Ideas", () => {
  const repoRoot = path.resolve(__dirname, "..");
  for (const page of ["index.html", "package-runs-dashboard.html", "production-pipeline.html", "daily-idea-scout.html", "resume.html"]) {
    const html = fs.readFileSync(path.join(repoRoot, page), "utf8");
    assert.match(html, /<nav class="ef-nav" data-ef-nav><\/nav>/, `${page} has the shared nav mount`);
    assert.match(html, /<script src="ef-nav\.js"><\/script>/, `${page} loads the shared nav component`);
  }
  const nav = fs.readFileSync(path.join(repoRoot, "ef-nav.js"), "utf8");
  assert.match(nav, /projects\.html/, "shared nav exposes Projects");
  assert.match(nav, /daily-idea-scout\.html/, "shared nav exposes Ideas");
  assert.match(nav, /super-focus\.html/, "shared nav makes Super Focus a primary link");
});

// ── Backward compatibility ──────────────────────────────────────────────────

test("backward compat: a media-rich existing-style package still resolves", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compat-"));
  const pkg = path.join(root, "vidtoolz-existing");
  fs.mkdirSync(path.join(pkg, "images", "flux-local"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "videos", "mp4"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Existing" } }));
  fs.mkdirSync(path.join(pkg, "script"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "script", "script-final.md"), "x".repeat(200));
  fs.writeFileSync(path.join(pkg, "flux-generation-manifest.json"), JSON.stringify({ items: [{ prompt_index: 1, status: "complete", output_path: "images/flux-local/flux-001.png" }] }));
  fs.writeFileSync(path.join(pkg, "selected-images.json"), JSON.stringify({ selections: [{ prompt_index: 1, selected_path: "images/flux-local/flux-001.png" }] }));
  fs.writeFileSync(path.join(pkg, "videos", "mp4", "001.mp4"), "VID");
  fs.mkdirSync(path.join(pkg, "resolve-handoff"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "resolve-handoff", "media-manifest.json"), JSON.stringify({ clips: [] }));
  const state = resolveProjectState(pkg);
  assert.equal(state.stage, "resolve_handoff");
  assert.equal(chooseNextTask(state).id, "edit_in_resolve");
});
