const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");
const childProcess = require("node:child_process");

const packageRunsIndex = require("../scripts/package-runs-index.js");
const packageRunWorkflowMap = require("../scripts/package-run-workflow-map.js");
const stageProjection = require("../scripts/workflow-stage-projection.js");

// ── fixture helpers ────────────────────────────────────────────────────────

function makeRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, "package-runs"), { recursive: true });
  return root;
}

function makeDir(root, name, files = {}) {
  const dir = path.join(root, "package-runs", name);
  fs.mkdirSync(dir, { recursive: true });
  Object.entries(files).forEach(([file, content]) => {
    fs.writeFileSync(path.join(dir, file), content, "utf8");
  });
  return dir;
}

const PROOF_DIR = { "README.md": "architecture proof evidence\n" };
const GENUINE_IDENTITY = { "package-candidates.json": JSON.stringify({ topic: "genuine", candidates: [] }) };

// ── IX1: zero genuine runs — the "0 vs directory count" case ──────────────

test("IX1: proof/canary-only tree indexes ZERO runs with exact exclusion reporting", () => {
  const root = makeRoot("ix-zero-");
  makeDir(root, "2026-08-25-alpha-proof", PROOF_DIR);
  makeDir(root, "2026-08-25-beta-proof", PROOF_DIR);
  makeDir(root, "2026-08-25-canary-one", PROOF_DIR);
  makeDir(root, "2026-08-19-gamma-acceptance", PROOF_DIR);
  makeDir(root, "2026-08-12-legacy-mystery", PROOF_DIR);
  const index = packageRunsIndex.buildPackageRunsIndex({ repoRoot: root });
  assert.equal(index.count, 0, "no genuine identity files means zero indexed runs");
  assert.equal(index.scope.directoriesScanned, 5);
  assert.equal(index.scope.genuineRuns, 0);
  assert.equal(index.scope.excluded.proof, 2);
  assert.equal(index.scope.excluded.canary, 1);
  assert.equal(index.scope.excluded.acceptance, 1);
  assert.equal(index.scope.excluded.legacyUnknown, 1);
  assert.deepEqual(index.runs, []);
  // The misleading diagnosis is now structurally impossible: the report names
  // both numbers and says which one the index counts.
  assert.equal(index.scope.directoriesScanned !== index.count, true);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX2: one genuine run ───────────────────────────────────────────────────

test("IX2: one correctly identified bounded run is indexed; proof packages excluded", () => {
  const root = makeRoot("ix-one-");
  makeDir(root, "2026-08-25-genuine-run", GENUINE_IDENTITY);
  makeDir(root, "2026-08-25-another-proof", PROOF_DIR);
  const index = packageRunsIndex.buildPackageRunsIndex({ repoRoot: root });
  assert.equal(index.count, 1);
  assert.equal(index.runs[0].runId, "2026-08-25-genuine-run");
  assert.equal(index.runs[0].path, "package-runs/2026-08-25-genuine-run");
  assert.equal(index.scope.excluded.proof, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX3: mixed tree — exact classification ─────────────────────────────────

test("IX3: mixed tree classifies genuine/proof/canary/acceptance/malformed/legacy exactly", () => {
  const root = makeRoot("ix-mixed-");
  makeDir(root, "2026-08-25-real-production", GENUINE_IDENTITY);
  makeDir(root, "2026-08-25-workflow-proof", PROOF_DIR);
  makeDir(root, "2026-08-19-earth-studio-director-acceptance", PROOF_DIR);
  makeDir(root, "2026-08-25-state-canary", PROOF_DIR);
  makeDir(root, "malformed Directory With Spaces", PROOF_DIR);
  makeDir(root, "2026-08-12-earth-studio-legacy", PROOF_DIR);
  // A proof-named directory that ALSO carries canonical identity is a genuine
  // run: identity always wins over naming classification.
  makeDir(root, "2026-08-25-proof-with-identity", {
    ...PROOF_DIR,
    "package-candidates.json": JSON.stringify({ topic: "identity-wins", candidates: [] }),
  });
  const index = packageRunsIndex.buildPackageRunsIndex({ repoRoot: root });
  assert.equal(index.count, 2);
  assert.deepEqual(index.runs.map((run) => run.runId).sort(), [
    "2026-08-25-proof-with-identity",
    "2026-08-25-real-production",
  ]);
  assert.equal(index.scope.directoriesScanned, 7);
  assert.equal(index.scope.excluded.proof, 1);
  assert.equal(index.scope.excluded.canary, 1);
  assert.equal(index.scope.excluded.acceptance, 1);
  assert.equal(index.scope.excluded.legacyUnknown, 2);
  const classifications = Object.fromEntries(
    index.scope.excludedDirectories.map((entry) => [entry.name, entry.classification])
  );
  assert.equal(classifications["2026-08-25-workflow-proof"], "PROOF_PACKAGE");
  assert.equal(classifications["2026-08-19-earth-studio-director-acceptance"], "ACCEPTANCE_PACKAGE");
  assert.equal(classifications["2026-08-25-state-canary"], "CANARY_PACKAGE");
  assert.equal(classifications["malformed Directory With Spaces"], "LEGACY_UNKNOWN");
  assert.equal(classifications["2026-08-12-earth-studio-legacy"], "LEGACY_UNKNOWN");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX4: stale index rebuild surfaces a real run ───────────────────────────

test("IX4: rebuild repairs an index that is missing a genuine run", () => {
  const root = makeRoot("ix-stale-");
  makeDir(root, "2026-08-25-genuine-run", GENUINE_IDENTITY);
  // Stale durable index: valid JSON, zero entries.
  fs.writeFileSync(path.join(root, "package-runs-index.json"), JSON.stringify({ count: 0, runs: [] }), "utf8");
  const before = packageRunsIndex.checkPackageRunsIndex({ repoRoot: root });
  assert.equal(before.ok, false);
  assert.ok(before.defects.some((d) => d.code === "INDEX_RUN_ABSENT"));
  const rebuilt = packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root });
  assert.equal(rebuilt.count, 1);
  const after = packageRunsIndex.checkPackageRunsIndex({ repoRoot: root });
  assert.equal(after.ok, true, JSON.stringify(after.defects));
  assert.equal(after.indexedCount, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX5: ghost entries removed by rebuild ──────────────────────────────────

test("IX5: rebuild removes ghost entries whose runs no longer exist", () => {
  const root = makeRoot("ix-ghost-");
  makeDir(root, "2026-08-25-survivor", GENUINE_IDENTITY);
  const ghost = { runId: "2026-08-01-deleted-run", path: "package-runs/2026-08-01-deleted-run", status: "ghost" };
  fs.writeFileSync(path.join(root, "package-runs-index.json"), JSON.stringify({ count: 2, runs: [ghost] }), "utf8");
  const before = packageRunsIndex.checkPackageRunsIndex({ repoRoot: root });
  assert.equal(before.ok, false);
  assert.ok(before.defects.some((d) => d.code === "INDEX_GHOST_ENTRY" && d.run_id === "2026-08-01-deleted-run"));
  assert.ok(before.defects.some((d) => d.code === "INDEX_RUN_ABSENT" && d.run_id === "2026-08-25-survivor"));
  packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root });
  const after = packageRunsIndex.checkPackageRunsIndex({ repoRoot: root });
  assert.equal(after.ok, true, JSON.stringify(after.defects));
  assert.deepEqual(after.defects, []);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX6: corrupt index — canonical filesystem intact, rebuild regenerates ──

test("IX6: corrupt index never breaks access to runs; rebuild regenerates", () => {
  const root = makeRoot("ix-corrupt-");
  makeDir(root, "2026-08-25-genuine-run", GENUINE_IDENTITY);
  fs.writeFileSync(path.join(root, "package-runs-index.json"), "{ this is not json !!!", "utf8");
  const report = packageRunsIndex.checkPackageRunsIndex({ repoRoot: root });
  assert.equal(report.ok, false);
  assert.ok(report.defects.some((d) => d.code === "INDEX_CORRUPT"));
  // Canonical run evidence is untouched by the corruption.
  assert.equal(packageRunsIndex.isPackageRunDir(path.join(root, "package-runs", "2026-08-25-genuine-run")), true);
  const rebuilt = packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root });
  assert.equal(rebuilt.count, 1);
  assert.equal(packageRunsIndex.checkPackageRunsIndex({ repoRoot: root }).ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX7: deleted index — non-authority proof ───────────────────────────────

test("IX7: deleting the index destroys no production state; rebuild recreates it", () => {
  const root = makeRoot("ix-deleted-");
  makeDir(root, "2026-08-25-genuine-run", GENUINE_IDENTITY);
  packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root });
  fs.unlinkSync(path.join(root, "package-runs-index.json"));
  const report = packageRunsIndex.checkPackageRunsIndex({ repoRoot: root });
  assert.equal(report.ok, false);
  assert.ok(report.defects.some((d) => d.code === "INDEX_MISSING"));
  // The run remains fully usable without its index.
  assert.equal(packageRunsIndex.isPackageRunDir(path.join(root, "package-runs", "2026-08-25-genuine-run")), true);
  const rebuilt = packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root });
  assert.equal(rebuilt.count, 1);
  assert.equal(packageRunsIndex.checkPackageRunsIndex({ repoRoot: root }).ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX8: real bounded new-run path creates run + projection + index entry ──

test("IX8: real new-run creation registers the run in the index immediately", () => {
  // Isolated root with the real scripts (repoRoot is derived from the
  // script's own location), so the genuine creation path — including the
  // index refresh hook — runs without touching the real repository.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ix-newrun-"));
  const sourceRoot = path.resolve(__dirname, "..");
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.cpSync(path.join(sourceRoot, "scripts"), path.join(root, "scripts"), { recursive: true });
  for (const file of ["package-engine-run.js", "workflow-path.js"]) {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file));
  }
  for (const file of ["agent-registry.json", "agent-contract.json"]) {
    fs.copyFileSync(path.join(sourceRoot, "config", file), path.join(root, "config", file));
  }
  fs.mkdirSync(path.join(root, "package-runs"), { recursive: true });
  const workflowFile = path.join(root, "workflow-fixture.md");
  fs.writeFileSync(workflowFile, "# Workflow fixture\n", "utf8");

  const result = childProcess.spawnSync(process.execPath, [
    path.join(root, "scripts", "package-engine-new-run.js"),
    "index authority canary",
    "--workflow", workflowFile,
    "--date", "2026-08-25",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const entries = fs.readdirSync(path.join(root, "package-runs"));
  assert.equal(entries.length, 1);
  const runId = entries[0];
  assert.match(runId, /^2026-08-25-index-authority-canary/);
  // Canonical run + durable projection both exist.
  assert.ok(fs.existsSync(path.join(root, "package-runs", runId, "package-candidates.json")));
  assert.ok(fs.existsSync(path.join(root, "package-runs", runId, "package-run-state.md")));
  // The index reflects the run immediately (safe refresh hook).
  const index = JSON.parse(fs.readFileSync(path.join(root, "package-runs-index.json"), "utf8"));
  assert.equal(index.count, 1);
  assert.equal(index.runs[0].runId, runId);
  assert.equal(index.authority, "DERIVED_DISCOVERY_INDEX");
  assert.match(String(result.stdout), /package-runs-index\.json refreshed/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX9: index write failure never blocks canonical run creation ───────────

test("IX9: a failing index write leaves the canonical run fully created", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ix-failwrite-"));
  const sourceRoot = path.resolve(__dirname, "..");
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.cpSync(path.join(sourceRoot, "scripts"), path.join(root, "scripts"), { recursive: true });
  for (const file of ["package-engine-run.js", "workflow-path.js"]) {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file));
  }
  for (const file of ["agent-registry.json", "agent-contract.json"]) {
    fs.copyFileSync(path.join(sourceRoot, "config", file), path.join(root, "config", file));
  }
  fs.mkdirSync(path.join(root, "package-runs"), { recursive: true });
  // Make the index path unwritable: a directory occupies it.
  fs.mkdirSync(path.join(root, "package-runs-index.json"), { recursive: true });
  const workflowFile = path.join(root, "workflow-fixture.md");
  fs.writeFileSync(workflowFile, "# Workflow fixture\n", "utf8");

  const result = childProcess.spawnSync(process.execPath, [
    path.join(root, "scripts", "package-engine-new-run.js"),
    "index failure canary",
    "--workflow", workflowFile,
    "--date", "2026-08-25",
  ], { encoding: "utf8" });
  // Canonical creation succeeds; the index problem is a warning, never a failure.
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(String(result.stdout), /index refresh deferred/);
  const entries = fs.readdirSync(path.join(root, "package-runs"));
  assert.equal(entries.length, 1);
  assert.ok(fs.existsSync(path.join(root, "package-runs", entries[0], "package-run-state.md")));
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX10: path safety ──────────────────────────────────────────────────────

test("IX10: rebuild and check refuse traversal outside the repository root, but honor an explicit isolated runs-dir", () => {
  const root = makeRoot("ix-safety-");
  assert.throws(
    () => packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root, runsDir: "../escape" }),
    /outside the repository root/
  );
  assert.throws(
    () => packageRunsIndex.checkPackageRunsIndex({ repoRoot: root, runsDir: "../escape" }),
    /outside the repository root/
  );
  assert.throws(
    () => packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root, outFile: "../escape-index.json" }),
    /outside the repository root/
  );
  // Explicit runsDir is the documented isolated-test route: main() and the
  // existing index tests use absolute scratch roots via --runs-dir, so an
  // explicit directory is permitted while implicit traversal is refused.
  const isolated = makeRoot("ix-safety-iso-");
  makeDir(isolated, "2026-08-25-iso-run", GENUINE_IDENTITY);
  const viaExplicit = packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root, runsDir: path.join(isolated, "package-runs"), outFile: path.join(isolated, "package-runs-index.json") });
  assert.equal(viaExplicit.count, 1);
  fs.rmSync(isolated, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX11: deterministic ordering ───────────────────────────────────────────

test("IX11: runs are always serialized in stable runId-descending order", () => {
  const root = makeRoot("ix-order-");
  for (const id of ["2026-08-01-alpha", "2026-08-25-zulu", "2026-08-13-mike"]) {
    makeDir(root, id, GENUINE_IDENTITY);
  }
  const first = packageRunsIndex.buildPackageRunsIndex({ repoRoot: root });
  const second = packageRunsIndex.buildPackageRunsIndex({ repoRoot: root });
  assert.deepEqual(first.runs.map((run) => run.runId), [
    "2026-08-25-zulu",
    "2026-08-13-mike",
    "2026-08-01-alpha",
  ]);
  assert.deepEqual(first.runs.map((run) => run.runId), second.runs.map((run) => run.runId));
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX12: rebuild idempotency ──────────────────────────────────────────────

test("IX12: two rebuilds over unchanged source produce the same substantive index", () => {
  const root = makeRoot("ix-idempotent-");
  makeDir(root, "2026-08-25-genuine-run", GENUINE_IDENTITY);
  makeDir(root, "2026-08-25-proof", PROOF_DIR);
  const first = packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root });
  const second = packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root });
  assert.equal(first.sourceDigest, second.sourceDigest);
  assert.notEqual(first.generatedAt, "", "generatedAt exists but is excluded from the digest");
  assert.equal(packageRunsIndex.checkPackageRunsIndex({ repoRoot: root }).ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX13: lifecycle consistency — index agrees with the canonical engine ──

test("IX13: index lifecycle fields agree with the canonical 14-gate engine, never with forged markdown", () => {
  const root = makeRoot("ix-lifecycle-");
  const runDir = makeDir(root, "2026-08-25-genuine-run", {
    ...GENUINE_IDENTITY,
    "selected-package.json": JSON.stringify({ package: { proposedTitle: "Lifecycle" } }),
  });
  fs.writeFileSync(path.join(runDir, "research-pack.md"), "# Research Pack\n\n- Status: PASS\n", "utf8");
  // A forged projection claiming COMPLETE must not leak into the index view.
  fs.writeFileSync(
    path.join(runDir, "package-run-state.md"),
    "# Package Run State\n\n- Package run state: active\n\n## Projection status: COMPLETE\n\nGates complete: 14/14\n",
    "utf8"
  );
  const index = packageRunsIndex.buildPackageRunsIndex({ repoRoot: root });
  const entry = index.runs[0];
  // Canonical truth comes from the 14-gate engine over evidence files.
  const map = packageRunWorkflowMap.buildWorkflowMap(entry.path, { repoRoot: root });
  const gate = stageProjection.currentCanonicalGate(map.gates);
  assert.equal(entry.status, "Research pack ready");
  assert.ok(!/complete/i.test(entry.status), "forged COMPLETE markdown must not surface as index status");
  assert.equal(entry.lifecycleGate.researchGateStatus, "PASS");
  // The index surfaces the human marker state but never treats it as lifecycle authority.
  assert.equal(entry.packageRunState.state, "active");
  // The canonical engine sits at script-structure; the shared projection maps it.
  assert.equal(gate.id, "script-structure");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX14: --check never mutates ────────────────────────────────────────────

test("IX14: checkPackageRunsIndex is strictly read-only", () => {
  const root = makeRoot("ix-readonly-");
  makeDir(root, "2026-08-25-genuine-run", GENUINE_IDENTITY);
  packageRunsIndex.rebuildPackageRunsIndex({ repoRoot: root });
  const indexPath = path.join(root, "package-runs-index.json");
  const bytesBefore = fs.readFileSync(indexPath);
  const mtimeBefore = fs.statSync(indexPath).mtimeMs;
  const runDir = path.join(root, "package-runs", "2026-08-25-genuine-run");
  const runBytes = fs.readdirSync(runDir).map((name) => [name, fs.readFileSync(path.join(runDir, name), "utf8")]);
  packageRunsIndex.checkPackageRunsIndex({ repoRoot: root });
  assert.ok(fs.readFileSync(indexPath).equals(bytesBefore), "index bytes changed by a read-only check");
  assert.equal(fs.statSync(indexPath).mtimeMs, mtimeBefore, "index mtime changed by a read-only check");
  for (const [name, content] of runBytes) {
    assert.equal(fs.readFileSync(path.join(runDir, name), "utf8"), content, `run file ${name} changed by check`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// ── IX15: authority metadata + proof-package self-exclusion ────────────────

test("IX15: the index declares derived non-authority and the mission proof package stays excluded", () => {
  const root = makeRoot("ix-authority-");
  makeDir(root, "2026-08-25-genuine-run", GENUINE_IDENTITY);
  const index = packageRunsIndex.buildPackageRunsIndex({ repoRoot: root });
  assert.equal(index.schema, "vidtoolz.packageRunsIndex.v1");
  assert.equal(index.authority, "DERIVED_DISCOVERY_INDEX");
  // The index exports no lifecycle-authority surface: it cannot approve,
  // advance gates, or write QC dispositions.
  assert.equal(typeof packageRunsIndex.approveGate, "undefined");
  assert.equal(typeof packageRunsIndex.advanceGate, "undefined");
  assert.equal(typeof packageRunsIndex.writeQcDisposition, "undefined");
  // The proof package for this mission carries no identity files, so it is
  // excluded by isPackageRunDir and cannot change the count it is testing.
  const sourceRoot = path.resolve(__dirname, "..");
  const proofDir = path.join(sourceRoot, "package-runs", "2026-08-25-package-runs-index-proof");
  if (fs.existsSync(proofDir)) {
    assert.equal(packageRunsIndex.isPackageRunDir(proofDir), false, "proof package must never be indexed as a run");
  }
  fs.rmSync(root, { recursive: true, force: true });
});
