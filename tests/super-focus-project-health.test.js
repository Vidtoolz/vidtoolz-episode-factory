/**
 * VIDTOOLZ Episode Factory Tests — Super Focus project health & recovery summary.
 *
 * Domain tests exercise super-focus-project-health.js directly against temp
 * state + media roots. They verify the truthfulness contract: facts come from
 * canonical state + cheap disk evidence, staleness is surfaced (never hidden),
 * legacy unknown provenance is NOT mass-flagged, readiness is not inferred from
 * downstream artifacts alone, corrupt projects surface as unreadable rows, and
 * the read path performs zero writes.
 */

const { test, assert, fs, os, path } = require("./_helpers.js");
const superFocus = require("../super-focus.js");
const superFocusMedia = require("../super-focus-media.js");
const health = require("../super-focus-project-health.js");

function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "sf-health-state-")); }
function mkMedia() { return fs.mkdtempSync(path.join(os.tmpdir(), "sf-health-media-")); }

function writeImage(mediaRoot, id, idx, bytes) {
  const dir = path.join(mediaRoot, id, "images", "flux-local");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, superFocusMedia.imageFileName(idx));
  fs.writeFileSync(p, bytes || `img-${idx}`);
  return p;
}
function writeVideo(mediaRoot, id, idx, bytes) {
  const dir = path.join(mediaRoot, id, "videos", "mp4");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, superFocusMedia.videoFileName(idx));
  fs.writeFileSync(p, bytes || `vid-${idx}`);
  return p;
}

// A project with a script and N image prompts, each optionally given an i2v prompt.
function seedProject(sfRoot, title, prompts, i2vTexts) {
  const opt = { root: sfRoot };
  const p = superFocus.createProject({ title }, opt);
  superFocus.saveScript(p.project_id, "The script body for " + title, opt);
  if (prompts && prompts.length) {
    superFocus.saveImagePrompts(p.project_id, prompts, opt);
    (i2vTexts || []).forEach((t, i) => { if (t) superFocus.setI2vPrompt(p.project_id, i + 1, t, opt); });
  }
  return p.project_id;
}

// ── Pure deriveHealth: classification & conservative language ───────────────

test("health: a title-only project is In progress with the forward next action (write script)", () => {
  const st = superFocus.emptyState({ project_id: "x-1", title: "Draft" });
  const facts = health.gatherEvidence("x-1", st, {}); // no media root → media unavailable
  const h = health.deriveHealth(st, facts, "active");
  assert.equal(h.health_state, "in_progress");
  assert.equal(h.readable, true);
  assert.match(h.next_safe_action, /Write the script/);
  assert.equal(facts.media_available, false);
});

test("health: archived lifecycle is labelled Archived and never mislabelled active", () => {
  const st = superFocus.emptyState({ project_id: "x-2", title: "Old" });
  st.script = "body";
  const facts = health.gatherEvidence("x-2", st, {});
  const h = health.deriveHealth(st, facts, "archived");
  assert.equal(h.health_state, "archived");
  assert.equal(h.lifecycle, "archived");
  assert.match(h.next_safe_action, /Archived/);
  assert.match(h.summary_line, /^Archived/);
});

test("health: readiness is NOT inferred from downstream artifacts alone (video files without upstream)", () => {
  // Videos "present" but there are zero eligible rows (no image prompts / i2v) →
  // must never be Healthy purely because files exist somewhere.
  const st = superFocus.emptyState({ project_id: "x-3", title: "T" });
  st.script = "body";
  const facts = {
    title_saved: true, script_saved: true, script_eval_status: "none",
    image_prompt_count: 0, infographic_prompt_count: 0, i2v_prompt_count: 0,
    media_available: true, image_count: 0, missing_file_image_count: 0, stale_image_count: 0,
    video_total: 0, video_count: 0, failed_video_count: 0, stale_video_count: 0,
    unknown_provenance_video_count: 5, queue_state: "none", busy: false,
  };
  const h = health.deriveHealth(st, facts, "active");
  assert.notEqual(h.health_state, "healthy");
  assert.equal(h.health_state, "in_progress");
});

test("health: next-safe-action language stays conservative when media is unavailable", () => {
  const st = superFocus.emptyState({ project_id: "x-4", title: "T" });
  st.script = "body";
  st.image_prompts = [{ index: 1, text: "a prompt", status: "saved" }];
  const facts = health.gatherEvidence("x-4", st, {}); // no media root
  const h = health.deriveHealth(st, facts, "active");
  assert.equal(facts.media_available, false);
  // Must not assert image/video counts it could not read.
  assert.doesNotMatch(h.next_safe_action, /remaining B-roll images/);
  assert.match(h.next_safe_action, /media evidence is unavailable|open it/i);
});

// ── computeProjectHealth against disk ───────────────────────────────────────

test("health: healthy active project — all eligible clips rendered and current", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Complete", ["p1", "p2"], ["motion 1", "motion 2"]);
  // Images for both prompts, videos for both, provenance matching current i2v.
  writeImage(mediaRoot, id, 1); writeImage(mediaRoot, id, 2);
  writeVideo(mediaRoot, id, 1); writeVideo(mediaRoot, id, 2);
  superFocusMedia.writeVideoProvenance(id, {
    1: { i2v_hash: superFocusMedia.i2vPromptHash("motion 1") },
    2: { i2v_hash: superFocusMedia.i2vPromptHash("motion 2") },
  }, { mediaRoot });
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.health_state, "healthy");
  assert.equal(h.facts.image_count, 2);
  assert.equal(h.facts.video_count, 2);
  assert.equal(h.facts.stale_video_count, 0);
  assert.match(h.next_safe_action, /Resolve handoff/);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: missing script → In progress, next action is write the script", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const p = superFocus.createProject({ title: "No script yet" }, { root: sfRoot });
  const h = health.computeProjectHealth(p.project_id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.script_saved, false);
  assert.match(h.next_safe_action, /Write the script/);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: image prompts present but images missing → generate remaining images", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Prompts only", ["p1", "p2"], []);
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.image_prompt_count, 2);
  assert.equal(h.facts.image_count, 0);
  assert.equal(h.health_state, "in_progress");
  assert.match(h.next_safe_action, /remaining B-roll images/);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: images present but no i2v prompts → write motion prompts", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Images done", ["p1", "p2"], []);
  writeImage(mediaRoot, id, 1); writeImage(mediaRoot, id, 2);
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.image_count, 2);
  assert.equal(h.facts.i2v_prompt_count, 0);
  assert.match(h.next_safe_action, /motion prompts/i);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: eligible rows with videos still needed → queue remaining clips", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Half rendered", ["p1", "p2"], ["m1", "m2"]);
  writeImage(mediaRoot, id, 1); writeImage(mediaRoot, id, 2);
  writeVideo(mediaRoot, id, 1); // only clip 1 rendered
  superFocusMedia.writeVideoProvenance(id, { 1: { i2v_hash: superFocusMedia.i2vPromptHash("m1") } }, { mediaRoot });
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.video_total, 2);
  assert.equal(h.facts.video_count, 1);
  assert.match(h.next_safe_action, /Queue the remaining/);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: a changed image prompt marks the image stale → Needs review", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const opt = { root: sfRoot };
  const p = superFocus.createProject({ title: "Stale image" }, opt);
  superFocus.saveScript(p.project_id, "body", opt);
  superFocus.saveImagePrompts(p.project_id, ["original prompt"], opt);
  writeImage(mediaRoot, p.project_id, 1);
  // Regenerate the set with DIFFERENT text at the same index → image_stale.
  superFocus.saveImagePrompts(p.project_id, ["a completely different prompt"], opt);
  const h = health.computeProjectHealth(p.project_id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.stale_image_count, 1);
  assert.equal(h.health_state, "needs_review");
  assert.match(h.next_safe_action, /images flagged stale/);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: an i2v text change after render flags the video stale → Needs review", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Stale video", ["p1"], ["current motion text"]);
  writeImage(mediaRoot, id, 1); writeVideo(mediaRoot, id, 1);
  // Provenance recorded against OLD text; current i2v differs → i2v_text_changed.
  superFocusMedia.writeVideoProvenance(id, { 1: { i2v_hash: superFocusMedia.i2vPromptHash("old different text") } }, { mediaRoot });
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.stale_video_count, 1);
  assert.equal(h.health_state, "needs_review");
  assert.match(h.next_safe_action, /clips flagged stale/);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: legacy video with unknown provenance is reported unknown, NOT flagged stale", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Legacy", ["p1"], ["motion"]);
  writeImage(mediaRoot, id, 1); writeVideo(mediaRoot, id, 1);
  // No provenance written → unknown, conservatively unflagged.
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.stale_video_count, 0);
  assert.equal(h.facts.unknown_provenance_video_count, 1);
  // Complete + current with a known-good chain → healthy (unknown-provenance is
  // allowed but not stale). It carries the unknown count for transparency.
  assert.equal(h.facts.video_count, 1);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: a failed render is Recovery needed", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Failed", ["p1"], ["motion"]);
  writeImage(mediaRoot, id, 1);
  superFocusMedia.writeVideoQueue(id, { version: 1, paused: false, items: [{ index: 1, status: "failed" }] }, { mediaRoot });
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.failed_video_count, 1);
  assert.equal(h.health_state, "recovery_needed");
  assert.match(h.next_safe_action, /failed or interrupted renders/);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: an active queue is reported; a paused queue with live items is Blocked", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Queued", ["p1"], ["motion"]);
  writeImage(mediaRoot, id, 1);
  superFocusMedia.writeVideoQueue(id, { version: 1, paused: false, items: [{ index: 1, status: "queued" }] }, { mediaRoot });
  let h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.queue_state, "active");
  assert.equal(h.health_state, "in_progress");
  superFocusMedia.writeVideoQueue(id, { version: 1, paused: true, items: [{ index: 1, status: "queued" }] }, { mediaRoot });
  h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.queue_state, "paused");
  assert.equal(h.health_state, "blocked");
  assert.match(h.next_safe_action, /queue is paused/i);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: a running queue item is reported busy without being mislabelled failed", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Running", ["p1"], ["motion"]);
  writeImage(mediaRoot, id, 1);
  superFocusMedia.writeVideoQueue(id, { version: 1, paused: false, items: [{ index: 1, status: "running" }] }, { mediaRoot });
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.busy, true);
  assert.equal(h.facts.queue_state, "active");
  assert.equal(h.facts.failed_video_count, 0);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: corrupt project JSON surfaces as unreadable via the aggregate, not omitted", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Corrupt", ["p1"], []);
  // Corrupt the state file (truncated JSON).
  fs.writeFileSync(path.join(sfRoot, id, superFocus.STATE_FILENAME), "{ not valid json", "utf8");
  // Single compute throws a controlled 422.
  assert.throws(() => health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot }), (e) => e.statusCode === 422);
  // Aggregate surfaces it as an unreadable row (never dropped).
  const agg = health.listProjectsHealth({ sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(agg.active.length, 1);
  assert.equal(agg.active[0].readable, false);
  assert.equal(agg.active[0].health_state, "unreadable");
  assert.match(agg.active[0].summary_line, /could not be read/i);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: a missing project id is a 404; an invalid id is a 400", () => {
  const sfRoot = mkRoot();
  assert.throws(() => health.computeProjectHealth("does-not-exist", { sfRoot }), (e) => e.statusCode === 404);
  assert.throws(() => health.computeProjectHealth("../escape", { sfRoot }), (e) => e.statusCode === 400);
  assert.throws(() => health.computeProjectHealth("Bad_Id", { sfRoot }), (e) => e.statusCode === 400);
  fs.rmSync(sfRoot, { recursive: true, force: true });
});

test("health: the read path performs zero writes (state + media roots byte-identical after)", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "Immutable", ["p1", "p2"], ["m1", "m2"]);
  writeImage(mediaRoot, id, 1); writeImage(mediaRoot, id, 2);
  writeVideo(mediaRoot, id, 1);
  superFocusMedia.writeVideoQueue(id, { version: 1, paused: false, items: [{ index: 2, status: "queued" }] }, { mediaRoot });
  const before = snapshotTree(sfRoot).concat(snapshotTree(mediaRoot));
  health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  health.listProjectsHealth({ sfRoot, sfMediaRoot: mediaRoot });
  const after = snapshotTree(sfRoot).concat(snapshotTree(mediaRoot));
  assert.deepEqual(after, before);
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: aggregate listing preserves newest-first ordering (mirrors listProjects)", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const opt = { root: sfRoot };
  const a = superFocus.createProject({ title: "Older" }, opt);
  // Force distinct updated_at ordering by editing the second later.
  const b = superFocus.createProject({ title: "Newer" }, opt);
  superFocus.saveScript(b.project_id, "later edit", opt);
  const agg = health.listProjectsHealth({ sfRoot, sfMediaRoot: mediaRoot });
  const listOrder = superFocus.listProjects(opt).map((p) => p.project_id);
  const healthOrder = agg.active.map((p) => p.project_id);
  assert.deepEqual(healthOrder, listOrder);
  assert.equal(healthOrder[0], b.project_id); // newest first
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: archived aggregate rows keep lifecycle 'archived' and cannot be mislabelled active", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "To archive", ["p1"], []);
  superFocus.archiveProject(id, { root: sfRoot });
  const agg = health.listProjectsHealth({ sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(agg.active.length, 0);
  assert.equal(agg.archived.length, 1);
  assert.equal(agg.archived[0].lifecycle, "archived");
  assert.equal(agg.archived[0].health_state, "archived");
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: missing manifest / absent media dir is a verifiable zero, not unknown", () => {
  const sfRoot = mkRoot(); const mediaRoot = mkMedia();
  const id = seedProject(sfRoot, "No media dir", ["p1"], []);
  // Media root exists (configured) but this project's dir was never created.
  const h = health.computeProjectHealth(id, { sfRoot, sfMediaRoot: mediaRoot });
  assert.equal(h.facts.media_available, true);
  assert.equal(h.facts.image_count, 0); // verifiable zero
  fs.rmSync(sfRoot, { recursive: true, force: true }); fs.rmSync(mediaRoot, { recursive: true, force: true });
});

test("health: an unconfigured media root leaves disk facts UNKNOWN (null), not zero", () => {
  const sfRoot = mkRoot();
  const id = seedProject(sfRoot, "No media root", ["p1"], []);
  const h = health.computeProjectHealth(id, { sfRoot }); // no sfMediaRoot
  assert.equal(h.facts.media_available, false);
  assert.equal(h.facts.image_count, null);
  assert.equal(h.facts.video_count, null);
  fs.rmSync(sfRoot, { recursive: true, force: true });
});

// Deep-in-root helper: sorted list of "relpath:size:mtimeMs" for every file.
function snapshotTree(root) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else { const s = fs.statSync(full); out.push(`${path.relative(root, full)}:${s.size}:${Math.round(s.mtimeMs)}`); }
    }
  }
  walk(root);
  return out.sort();
}
