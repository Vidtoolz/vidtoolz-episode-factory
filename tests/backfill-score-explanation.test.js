/**
 * VIDTOOLZ Episode Factory Tests — backfill score_explanation onto older
 * promoted projects (non-destructive, never invented).
 */

const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");

const { backfillProject } = require("../scripts/backfill-score-explanation.js");

// Build a temp aigen root with a user-topic run + a promoted project whose
// marker lacks score_explanation. opts.withArchive=false omits the source run.
function makeEnv(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-"));
  const aigenRoot = path.join(root, "aigen");
  const packagesRoot = path.join(aigenRoot, "script-packages");
  const date = "2026-06-30";
  const runId = "seed-20260630";
  const pkgId = "demo-proj";
  fs.mkdirSync(path.join(packagesRoot, pkgId), { recursive: true });

  if (opts.withArchive !== false) {
    const ideaDir = path.join(aigenRoot, "topic-idea-scout", date, runId);
    fs.mkdirSync(ideaDir, { recursive: true });
    const idea = opts.idea || { title: "Demo", premise: "P.", score: 8, rationale: "Strong because X.", audience_fit: "Serious solo creators", production_fit: "A-roll + screen rec", proof_plan: "Show a real example" };
    fs.writeFileSync(path.join(ideaDir, "ideas.json"), JSON.stringify({ kind: "user_seeded_topic_scout", date, run_id: runId, seed_topic: "demo seed", ideas: [{ title: "other" }, { title: "other2" }, idea] }));
  }
  const marker = Object.assign({
    source: "user_topic_scout", idea_uid: `topic:${date}:${runId}:2`, title: "Demo",
    premise: "P.", score: 8, promoted_at: "T", date, index: 2, run_id: runId, seed_topic: "demo seed",
  }, opts.markerExtra || {});
  fs.writeFileSync(path.join(packagesRoot, pkgId, "promoted-from-idea.json"), JSON.stringify(marker));
  return { root, aigenRoot, packagesRoot, pkgId, markerPath: path.join(packagesRoot, pkgId, "promoted-from-idea.json") };
}

test("backfill: writes score_explanation from the source archive (real fields, not invented)", () => {
  const env = makeEnv();
  const r = backfillProject({ projectId: env.pkgId, aigenRoot: env.aigenRoot, packagesRoot: env.packagesRoot });
  assert.equal(r.status, "backfilled");
  assert.equal(r.score_explanation.available, true);
  assert.ok(r.fields_used.includes("rationale"));
  const marker = JSON.parse(fs.readFileSync(env.markerPath, "utf8"));
  assert.ok(marker.score_explanation && marker.score_explanation.available === true);
  // existing fields preserved
  assert.equal(marker.score, 8);
  assert.equal(marker.seed_topic, "demo seed");
});

test("backfill: --dry-run writes nothing", () => {
  const env = makeEnv();
  const before = fs.readFileSync(env.markerPath, "utf8");
  const r = backfillProject({ projectId: env.pkgId, aigenRoot: env.aigenRoot, packagesRoot: env.packagesRoot, dryRun: true });
  assert.equal(r.status, "backfilled");
  assert.equal(r.dry_run, true);
  assert.equal(fs.readFileSync(env.markerPath, "utf8"), before); // unchanged
});

test("backfill: missing source archive reports safely, no mutation", () => {
  const env = makeEnv({ withArchive: false });
  const before = fs.readFileSync(env.markerPath, "utf8");
  const r = backfillProject({ projectId: env.pkgId, aigenRoot: env.aigenRoot, packagesRoot: env.packagesRoot });
  assert.equal(r.ok, false);
  assert.equal(r.status, "no_archive");
  assert.equal(fs.readFileSync(env.markerPath, "utf8"), before);
});

test("backfill: insufficient source data is not invented", () => {
  const env = makeEnv({ idea: { title: "Bare", premise: "P.", score: 5 } }); // no rationale/fits
  const r = backfillProject({ projectId: env.pkgId, aigenRoot: env.aigenRoot, packagesRoot: env.packagesRoot });
  assert.equal(r.ok, false);
  assert.equal(r.status, "insufficient");
});

test("backfill: existing score_explanation is preserved (no overwrite without --force)", () => {
  const env = makeEnv({ markerExtra: { score_explanation: { summary: "kept", available: true } } });
  const r = backfillProject({ projectId: env.pkgId, aigenRoot: env.aigenRoot, packagesRoot: env.packagesRoot });
  assert.equal(r.status, "already");
  const marker = JSON.parse(fs.readFileSync(env.markerPath, "utf8"));
  assert.equal(marker.score_explanation.summary, "kept");
  // --force rebuilds from archive
  const r2 = backfillProject({ projectId: env.pkgId, aigenRoot: env.aigenRoot, packagesRoot: env.packagesRoot, force: true });
  assert.equal(r2.status, "backfilled");
});

test("backfill: path-traversal / bad project id rejected", () => {
  const env = makeEnv();
  for (const bad of ["../../etc", "../sibling", "bad/slash", "..", "x/../y"]) {
    const r = backfillProject({ projectId: bad, aigenRoot: env.aigenRoot, packagesRoot: env.packagesRoot });
    assert.equal(r.ok, false, `${bad} should be rejected`);
    assert.equal(r.status, "invalid");
  }
});

test("backfill: not-a-promoted-project reports cleanly", () => {
  const env = makeEnv();
  fs.mkdirSync(path.join(env.packagesRoot, "plain-pkg"), { recursive: true });
  const r = backfillProject({ projectId: "plain-pkg", aigenRoot: env.aigenRoot, packagesRoot: env.packagesRoot });
  assert.equal(r.status, "not_promoted");
});
