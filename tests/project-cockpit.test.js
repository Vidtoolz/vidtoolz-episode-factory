/**
 * VIDTOOLZ Episode Factory Tests — Cockpit IA: project state resolver,
 * next-task engine, GUI action registry, and project discovery.
 *
 * The resolver is deterministic + file-driven; these build temp packages that
 * represent each pipeline stage and assert the resolved stage, the chosen next
 * task, and that every task maps to a safe GUI action (never a shell command).
 */

const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");

const { resolveProjectState, STAGES } = require("../project-state-resolver.js");
const { chooseNextTask } = require("../next-task-engine.js");
const { REGISTRY, resolveAction } = require("../project-action-registry.js");
const { listProjects, summarizeProject } = require("../project-discovery.js");

// Build a temp package whose files represent a given pipeline position.
function makePkg(spec = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-"));
  const pkg = path.join(root, spec.id || "demo-pkg");
  fs.mkdirSync(pkg, { recursive: true });
  const w = (rel, content) => {
    const full = path.join(pkg, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  if (spec.metadata) w("selected-package.json", JSON.stringify({ package: { proposedTitle: spec.title || "Demo Title" } }));
  if (spec.script) w("script/script-final.md", "# Script\n" + "x".repeat(200));
  if (spec.imagePrompts) w("image-prompts.json", JSON.stringify({ image_prompts: Array.from({ length: spec.imagePrompts }, (_, i) => ({ index: i + 1, prompt: "p" })) }));
  if (spec.images) {
    w("flux-generation-manifest.json", JSON.stringify({ workflow: "flux-gguf-1080x1920", items: Array.from({ length: spec.images }, (_, i) => ({ prompt_index: i + 1, status: "complete", output_path: `images/flux-local/flux-00${i + 1}.png` })) }));
  }
  if (spec.selected) w("selected-images.json", JSON.stringify({ selections: Array.from({ length: spec.selected }, (_, i) => ({ prompt_index: i + 1, selected_path: `images/flux-local/flux-00${i + 1}.png` })) }));
  if (spec.i2v) w("video-prompts.json", JSON.stringify({ prompts: Array.from({ length: spec.i2v }, (_, i) => ({ prompt_index: i + 1, prompt: "motion" })) }));
  if (spec.videos) for (let i = 1; i <= spec.videos; i++) w(`videos/mp4/00${i}.mp4`, "VID");
  if (spec.handoff) w("resolve-handoff/media-manifest.json", JSON.stringify({ clips: [] }));
  if (spec.status) w("project-status.json", JSON.stringify({ status: spec.status }));
  return { root, pkg };
}

function nextOf(spec) {
  const { pkg } = makePkg(spec);
  const state = resolveProjectState(pkg);
  return { state, task: chooseNextTask(state) };
}

// ── Resolver + next-task scenarios ─────────────────────────────────────────

const SCENARIOS = [
  ["idea only (empty package)", {}, "idea", "complete_project_setup"],
  ["metadata, no script", { metadata: true }, "script", "write_script"],
  ["script, no image prompts", { metadata: true, script: true }, "image_prompts", "generate_image_prompts"],
  ["image prompts, no images", { metadata: true, script: true, imagePrompts: 25 }, "image_generation", "submit_image_generation"],
  ["images, no selection", { metadata: true, script: true, imagePrompts: 25, images: 25 }, "image_review", "select_images"],
  ["selection, no I2V", { metadata: true, script: true, imagePrompts: 25, images: 25, selected: 5 }, "i2v_prompts", "generate_i2v_prompts"],
  ["I2V, no videos", { metadata: true, script: true, imagePrompts: 25, images: 25, selected: 5, i2v: 5 }, "video_generation", "submit_video_generation"],
  ["videos, no handoff", { metadata: true, script: true, imagePrompts: 25, images: 25, selected: 5, i2v: 5, videos: 5 }, "video_review", "prepare_resolve_handoff"],
  ["handoff exists", { metadata: true, script: true, imagePrompts: 25, images: 25, selected: 5, i2v: 5, videos: 5, handoff: true }, "resolve_handoff", "edit_in_resolve"],
];

for (const [name, spec, expectStage, expectTask] of SCENARIOS) {
  test(`cockpit next-task: ${name} -> ${expectStage}/${expectTask}`, () => {
    const { state, task } = nextOf(spec);
    assert.equal(state.stage, expectStage, `stage for ${name}`);
    assert.equal(task.id, expectTask, `task for ${name}`);
    assert.ok(task.why && task.why.length > 0, "task has a reason");
    assert.ok(task.primary_action && task.primary_action.can_run_in_gui, "task has a GUI action");
  });
}

test("cockpit next-task: parked project -> unpark", () => {
  const { task } = nextOf({ metadata: true, script: true, status: "parked" });
  assert.equal(task.id, "unpark_project");
});

test("cockpit next-task: archived/published is done", () => {
  assert.equal(nextOf({ metadata: true, status: "archived" }).task.done, true);
  assert.equal(nextOf({ metadata: true, status: "published" }).task.done, true);
});

test("cockpit: alternate import action offered when images/videos missing", () => {
  const imgStage = nextOf({ metadata: true, script: true, imagePrompts: 25 });
  assert.equal(imgStage.task.alternate_action.id, "import_manual_images");
  const vidStage = nextOf({ metadata: true, script: true, imagePrompts: 25, images: 25, selected: 5, i2v: 5 });
  assert.equal(vidStage.task.alternate_action.id, "import_manual_videos");
});

test("cockpit: data-gap warning when later artifacts exist but metadata missing", () => {
  // handoff + videos but no selected-package.json/manifest -> warning, still edit_in_resolve.
  const { state, task } = nextOf({ script: true, imagePrompts: 5, images: 5, selected: 5, videos: 5, handoff: true });
  assert.equal(task.id, "edit_in_resolve");
  assert.ok(state.warnings.some((w) => /metadata/i.test(w)), "metadata gap warned");
});

// ── Pathway: short/1-day vertical vs long-form/multi-week ──────────────────

test("pathway: unmarked aigen package defaults to short vertical, honestly sourced", () => {
  const { state } = nextOf({ metadata: true, script: true });
  assert.equal(state.pathway.key, "vertical");
  assert.equal(state.pathway.source, "default");
  assert.equal(state.pathway.is_default, true);
  assert.ok(state.pathway.label && state.pathway.tempo, "pathway has operator label + tempo");
  assert.ok(state.pathway.tempo_hint.length > 0, "pathway explains its tempo");
});

test("pathway: explicit long-form manifest marker wins over the lane default", () => {
  const { pkg } = makePkg({ metadata: true });
  fs.writeFileSync(path.join(pkg, "manifest.json"), JSON.stringify({ package_name: "LF", workflow_path: "horizontal" }));
  const state = resolveProjectState(pkg);
  assert.equal(state.pathway.key, "horizontal");
  assert.equal(state.pathway.source, "manifest");
  assert.equal(state.pathway.is_default, false);
});

test("pathway: selected-package videoFormat 'long' resolves to long-form", () => {
  const { pkg } = makePkg({});
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "T", videoFormat: "long" } }));
  const state = resolveProjectState(pkg);
  assert.equal(state.pathway.key, "horizontal");
  assert.equal(state.pathway.source, "selected-package");
});

test("pathway: project-status.json override beats every other marker", () => {
  const { pkg } = makePkg({ metadata: true });
  fs.writeFileSync(path.join(pkg, "manifest.json"), JSON.stringify({ package_name: "X", workflow_path: "horizontal" }));
  fs.writeFileSync(path.join(pkg, "project-status.json"), JSON.stringify({ status: "active", workflow_path: "short" }));
  const state = resolveProjectState(pkg);
  assert.equal(state.pathway.key, "vertical");
  assert.equal(state.pathway.source, "project-status");
});

test("pathway: an unrecognized marker value never silently relabels the pathway", () => {
  // workflow-path.js normalizes unknown values to horizontal (package-runs
  // legacy default); the project resolver must NOT — a typo falls through to
  // the honest lane default instead of becoming long-form.
  const { pkg } = makePkg({ metadata: true });
  fs.writeFileSync(path.join(pkg, "manifest.json"), JSON.stringify({ package_name: "X", workflow_path: "banana" }));
  const state = resolveProjectState(pkg);
  assert.equal(state.pathway.key, "vertical");
  assert.equal(state.pathway.source, "default");
});

test("pathway: focus, workspace, and board views all render the pathway", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const focus = read("project-focus.html");
  assert.ok(focus.includes('id="fx-path"'), "focus view has the pathway chip element");
  assert.ok(/s\.pathway/.test(focus), "focus view reads state.pathway");
  const workspace = read("project-workspace.html");
  assert.ok(/s\.pathway/.test(workspace), "workspace reads state.pathway");
  assert.ok(workspace.includes("tempo_hint"), "workspace shows the tempo guidance");
  assert.ok(workspace.includes("path-vertical") && workspace.includes("path-horizontal"), "workspace styles both pathways");
  const board = read("projects.html");
  assert.ok(/p\.pathway/.test(board), "projects board reads project pathway");
  assert.ok(board.includes("path-vertical") && board.includes("path-horizontal"), "board styles both pathways");
});

// ── Action registry: safe GUI actions only, no shell ────────────────────────

test("action registry: every action is a safe GUI open/post (no shell)", () => {
  for (const id of Object.keys(REGISTRY)) {
    const a = resolveAction(id, "demo-pkg");
    assert.ok(a, `action resolves for ${id}`);
    assert.equal(a.can_run_in_gui, true, `${id} runs in GUI`);
    assert.ok(a.type === "open" || a.type === "post", `${id} is open|post`);
    if (a.type === "post") {
      assert.ok(a.endpoint.startsWith("/api/"), `${id} posts to an /api/ endpoint`);
      assert.equal(a.body.package_id, "demo-pkg", `${id} carries package id`);
    } else {
      assert.ok(/\.html\?/.test(a.href), `${id} opens an in-GUI page`);
    }
    // No field should smell like a shell command.
    assert.ok(!JSON.stringify(a).match(/\b(bash|sh -c|node scripts\/|rm -rf|exec)\b/), `${id} has no shell command`);
  }
});

// ── Discovery ───────────────────────────────────────────────────────────────

test("discovery: lists packages with stage/next-task and flags diagnostics", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-"));
  const mk = (id, spec) => {
    const d = path.join(root, id);
    fs.mkdirSync(d, { recursive: true });
    if (spec.metadata) fs.writeFileSync(path.join(d, "selected-package.json"), JSON.stringify({ package: { proposedTitle: spec.title } }));
    if (spec.script) { fs.mkdirSync(path.join(d, "script"), { recursive: true }); fs.writeFileSync(path.join(d, "script", "script-final.md"), "x".repeat(200)); }
  };
  mk("real-project-a", { metadata: true, title: "Real A", script: true });
  mk("_smoke-test-thing", { metadata: true, title: "Smoke" });
  const out = listProjects({ packagesRoot: root });
  assert.equal(out.count, 2);
  assert.equal(out.real_count, 1);
  const real = out.projects.find((p) => p.project_id === "real-project-a");
  assert.equal(real.title, "Real A");
  assert.equal(real.next_task.id, "generate_image_prompts");
  assert.equal(real.pathway.key, "vertical", "board summaries carry the pathway");
  const smoke = out.projects.find((p) => p.project_id === "_smoke-test-thing");
  assert.equal(smoke.diagnostic, true);
});

test("discovery: archived projects are flagged and counted as not-current (still listed for recovery)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-arch-"));
  const mk = (id, spec) => {
    const d = path.join(root, id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "selected-package.json"), JSON.stringify({ package: { proposedTitle: spec.title } }));
    if (spec.archived) fs.writeFileSync(path.join(d, "project-status.json"), JSON.stringify({ status: "archived", archived_at: "2026-06-30T00:00:00Z" }));
  };
  mk("active-one", { title: "Active One" });
  mk("archived-one", { title: "Archived One", archived: true });

  const out = listProjects({ packagesRoot: root });
  assert.equal(out.count, 2);
  assert.equal(out.real_count, 2);       // both are real (non-diagnostic)
  assert.equal(out.archived_count, 1);   // one archived
  assert.equal(out.current_count, 1);    // only the active one is "current"

  const archived = out.projects.find((p) => p.project_id === "archived-one");
  assert.equal(archived.status, "archived");
  assert.equal(archived.archived, true); // flagged so the board can hide it by default
  // Still listed (recoverable via the API / archived filter), not dropped.
  assert.ok(out.projects.some((p) => p.project_id === "archived-one"));
});

// ── Backward compatibility ──────────────────────────────────────────────────

test("resolver: legacy package with only manifest.json resolves without throwing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-"));
  const pkg = path.join(root, "legacy-pkg");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "manifest.json"), JSON.stringify({ package_name: "Legacy", package_state: "active" }));
  const state = resolveProjectState(pkg);
  assert.equal(state.has_metadata, true);
  assert.equal(state.stage, "script"); // metadata but no script
  assert.ok(STAGES.includes(state.stage));
});

test("resolver: missing package throws 404", () => {
  assert.throws(() => resolveProjectState("/no/such/package"), (e) => e.statusCode === 404);
});

test("resolver: exposes the handoff's recorded video variant (null for legacy manifests)", () => {
  // Legacy manifest without variant fields → null, never a crash.
  const legacy = makePkg({ metadata: true, script: true, handoff: true });
  const legacyState = resolveProjectState(legacy.pkg);
  assert.equal(legacyState.has_resolve_handoff, true);
  assert.equal(legacyState.handoff_video_variant, null);

  // Variant-recording manifest (written by the variant-aware assembler) → surfaced.
  const hq = makePkg({ metadata: true, script: true });
  fs.mkdirSync(path.join(hq.pkg, "resolve-handoff"), { recursive: true });
  fs.writeFileSync(
    path.join(hq.pkg, "resolve-handoff", "media-manifest.json"),
    JSON.stringify({ video_variant: "mp4-hq-720p", video_source_folder: "videos/mp4-hq-720p", clips: [] })
  );
  const hqState = resolveProjectState(hq.pkg);
  assert.equal(hqState.has_resolve_handoff, true);
  assert.equal(hqState.handoff_video_variant, "mp4-hq-720p");
  assert.equal(hqState.stage, "resolve_handoff");
});

test("state resolver: script evidence respects the exact minimum-size boundary", () => {
  // Mutation audit survivors (project-state-resolver.js:41): flipping
  // `size >= minBytes` to `>` (or the catch's `return false` to `true`)
  // survived — the evidence-size boundary and the missing-file path were
  // unasserted. Pin both: exactly 40 bytes counts, 39 does not, absent stays idea.
  const at = (pkg) => STAGES.indexOf(resolveProjectState(pkg).stage);
  const mk = (bytes) => {
    const { pkg } = makePkg({});
    if (bytes !== null) {
      fs.mkdirSync(path.join(pkg, "script"), { recursive: true });
      fs.writeFileSync(path.join(pkg, "script", "script-final.md"), "x".repeat(bytes));
    }
    return pkg;
  };
  const stageAt40 = at(mk(40));
  const stageAt39 = at(mk(39));
  const stageAbsent = at(mk(null));
  assert.ok(stageAt40 > stageAt39, "a 40-byte final script must count as script evidence; 39 bytes must not");
  assert.equal(stageAt39, stageAbsent, "a sub-minimum script must resolve like a missing script");
});
