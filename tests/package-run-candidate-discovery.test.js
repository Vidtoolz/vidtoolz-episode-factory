/**
 * VIDTOOLZ Episode Factory Tests — Package Run Candidate Discovery
 * Tests for: discoverPackageRunCandidates() server function + browser-side discovery in package-engine.js
 */

const {
  assert,
  fs,
  os,
  path,
  http,
  packageEngineServer,
  writeTestFile,
  test,
} = require("./_helpers.js");


// ── Helper: create a temp package-runs root with arbitrary run dirs ─────────

function createDiscoveryRoot(config = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-candidate-discovery-"));
  const runsRoot = path.join(tempRoot, "package-runs");
  fs.mkdirSync(runsRoot, { recursive: true });

  for (const run of config.runs || []) {
    const runDir = path.join(runsRoot, run.id);
    fs.mkdirSync(runDir, { recursive: true });

    if (run.candidates) {
      writeTestFile(tempRoot, `package-runs/${run.id}/package-candidates.json`, JSON.stringify(run.candidates, null, 2));
    }
    if (run.malformedCandidates) {
      writeTestFile(tempRoot, `package-runs/${run.id}/package-candidates.json`, run.malformedCandidates);
    }
    if (run.stateMarkdown) {
      writeTestFile(tempRoot, `package-runs/${run.id}/package-run-state.md`, run.stateMarkdown);
    }
    if (run.selectedPackage) {
      writeTestFile(tempRoot, `package-runs/${run.id}/selected-package.json`, JSON.stringify(run.selectedPackage, null, 2));
    }
  }

  if (config.staleRuns) {
    const staleDir = path.join(runsRoot, "stale-runs");
    fs.mkdirSync(staleDir, { recursive: true });
    for (const run of config.staleRuns) {
      const runDir = path.join(staleDir, run.id);
      fs.mkdirSync(runDir, { recursive: true });
      if (run.candidates) {
        writeTestFile(tempRoot, `package-runs/stale-runs/${run.id}/package-candidates.json`, JSON.stringify(run.candidates, null, 2));
      }
    }
  }

  return tempRoot;
}

function makeCandidates(runId, count) {
  const candidates = [];
  for (let i = 1; i <= count; i++) {
    candidates.push({
      id: `${runId}-pkg-${i}`,
      packageNumber: i,
      score: 90 - i,
      recommendation: i <= 3 ? "Make" : "Maybe",
      proposedTitle: `${runId} Candidate ${i}`,
      viewerPromise: `Promise ${i}`,
      topic: runId,
    });
  }
  return { project: "VIDTOOLZ", topic: runId, candidates };
}


// ── Server-side tests ──────────────────────────────────────────────────────

test("discovery loads candidates from multiple package-runs", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-run-a", candidates: makeCandidates("2026-06-01-run-a", 3) },
      { id: "2026-06-02-run-b", candidates: makeCandidates("2026-06-02-run-b", 5) },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs.length, 2);
  assert.equal(result.totalCandidates, 8);
});

test("discovery groups and tags candidates with their source run id", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-run-a", candidates: makeCandidates("2026-06-01-run-a", 2) },
      { id: "2026-06-02-run-b", candidates: makeCandidates("2026-06-02-run-b", 3) },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  const runA = result.runs.find((r) => r.runId === "2026-06-01-run-a");
  const runB = result.runs.find((r) => r.runId === "2026-06-02-run-b");
  assert.ok(runA, "run-a should be present");
  assert.ok(runB, "run-b should be present");
  assert.equal(runA.candidates.length, 2);
  assert.equal(runB.candidates.length, 3);
  assert.equal(runA.candidateCount, 2);
  assert.equal(runB.candidateCount, 3);
});

test("discovery excludes package-runs/stale-runs directory", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
    ],
    staleRuns: [
      { id: "2026-05-01-stale-run", candidates: makeCandidates("2026-05-01-stale-run", 4) },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].runId, "2026-06-01-active-run");
  assert.ok(!result.runs.find((r) => r.runId === "2026-05-01-stale-run"), "stale-run must not appear");
});

test("discovery excludes parked runs by default", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
      {
        id: "2026-06-02-parked-run",
        candidates: makeCandidates("2026-06-02-parked-run", 3),
        stateMarkdown: "State: parked\n",
      },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].runId, "2026-06-01-active-run");
});

test("discovery excludes superseded runs by default", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
      {
        id: "2026-06-02-superseded-run",
        candidates: makeCandidates("2026-06-02-superseded-run", 3),
        stateMarkdown: "State: superseded\n",
      },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].runId, "2026-06-01-active-run");
});

test("discovery excludes runs with 'Run disposition: abandoned' by default", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
      {
        id: "2026-06-02-abandoned-run",
        candidates: makeCandidates("2026-06-02-abandoned-run", 3),
        stateMarkdown: "# Package Run State\n\nRun disposition: abandoned\n",
      },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].runId, "2026-06-01-active-run");
});

test("discovery includes parked runs when includeParked is true", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
      {
        id: "2026-06-02-parked-run",
        candidates: makeCandidates("2026-06-02-parked-run", 3),
        stateMarkdown: "State: parked\n",
      },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot, includeParked: true });
  assert.equal(result.runs.length, 2);
  const parked = result.runs.find((r) => r.runId === "2026-06-02-parked-run");
  assert.ok(parked, "parked run should be included");
  assert.equal(parked.state, "parked");
});

test("discovery includes superseded runs when includeSuperseded is true", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
      {
        id: "2026-06-02-superseded-run",
        candidates: makeCandidates("2026-06-02-superseded-run", 3),
        stateMarkdown: "State: superseded\n",
      },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot, includeSuperseded: true });
  assert.equal(result.runs.length, 2);
  const superseded = result.runs.find((r) => r.runId === "2026-06-02-superseded-run");
  assert.ok(superseded, "superseded run should be included");
});

test("discovery includes abandoned runs when includeAbandoned is true", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
      {
        id: "2026-06-02-abandoned-run",
        candidates: makeCandidates("2026-06-02-abandoned-run", 3),
        stateMarkdown: "# Package Run State\n\nRun disposition: abandoned\n",
      },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot, includeAbandoned: true });
  assert.equal(result.runs.length, 2);
  const abandoned = result.runs.find((r) => r.runId === "2026-06-02-abandoned-run");
  assert.ok(abandoned, "abandoned run should be included");
});

test("discovery does not error when package-candidates.json is missing", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-run-with-candidates", candidates: makeCandidates("2026-06-01-run-with-candidates", 2) },
      { id: "2026-06-02-run-without-candidates" },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  // Run without candidates is simply skipped, not included
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].runId, "2026-06-01-run-with-candidates");
  assert.equal(result.totalCandidates, 2);
});

test("discovery does not error on malformed package-candidates.json and reports safely", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-good-run", candidates: makeCandidates("2026-06-01-good-run", 2) },
      {
        id: "2026-06-02-malformed-run",
        malformedCandidates: "{ this is not valid json,,, }",
      },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs.length, 2);
  const malformed = result.runs.find((r) => r.runId === "2026-06-02-malformed-run");
  assert.ok(malformed, "malformed run should still be listed");
  assert.equal(malformed.malformed, true);
  assert.equal(malformed.candidateCount, 0);
  assert.equal(malformed.candidates.length, 0);
  const good = result.runs.find((r) => r.runId === "2026-06-01-good-run");
  assert.equal(good.candidates.length, 2);
});

test("discovery detects selected-package.json read-only without overwriting it", () => {
  const selectedContent = {
    selectedAt: "2026-06-01T00:00:00.000Z",
    package: { proposedTitle: "Already Selected", packageNumber: 1 },
  };
  const tempRoot = createDiscoveryRoot({
    runs: [
      {
        id: "2026-06-01-run-with-selection",
        candidates: makeCandidates("2026-06-01-run-with-selection", 3),
        selectedPackage: selectedContent,
      },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs[0].hasSelectedPackage, true);

  // Verify the file was not modified
  const after = JSON.parse(fs.readFileSync(
    path.join(tempRoot, "package-runs", "2026-06-01-run-with-selection", "selected-package.json"),
    "utf8"
  ));
  assert.deepEqual(after, selectedContent);
});

test("discovery reports hasSelectedPackage=false when no selected-package.json exists", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-run-no-selection", candidates: makeCandidates("2026-06-01-run-no-selection", 2) },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs[0].hasSelectedPackage, false);
});

test("discovery performs no writes on GET — no files created or modified", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
    ],
  });
  const runDir = path.join(tempRoot, "package-runs", "2026-06-01-active-run");

  // Snapshot all files and their mtimes before discovery
  const before = {};
  function snapshot(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        snapshot(full);
      } else {
        const stat = fs.statSync(full);
        before[full] = { mtimeMs: stat.mtimeMs, size: stat.size };
      }
    }
  }
  snapshot(runDir);

  packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });

  // Verify no files changed and no new files were created
  snapshot(runDir);
  for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
    const full = path.join(runDir, entry.name);
    if (entry.isDirectory()) continue;
    const stat = fs.statSync(full);
    const beforeState = before[full];
    assert.ok(beforeState, `file ${entry.name} existed before (no new files created)`);
    assert.equal(stat.mtimeMs, beforeState.mtimeMs, `file ${entry.name} mtime unchanged (no writes)`);
    assert.equal(stat.size, beforeState.size, `file ${entry.name} size unchanged (no writes)`);
  }
});

test("discovery returns empty result when package-runs directory does not exist", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-empty-root-"));
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs.length, 0);
  assert.equal(result.totalCandidates, 0);
  assert.equal(result.activeRunId, "");
});

test("discovery identifies active run id from explicit state", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      {
        id: "2026-06-01-active-run",
        candidates: makeCandidates("2026-06-01-active-run", 2),
        stateMarkdown: "State: active\n",
      },
      { id: "2026-06-02-other-run", candidates: makeCandidates("2026-06-02-other-run", 3) },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.activeRunId, "2026-06-01-active-run");
});

test("discovery API route returns wrapped { ok, data } response", async () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-api-run", candidates: makeCandidates("2026-06-01-api-run", 2) },
    ],
  });
  const server = packageEngineServer.createServer({ root: tempRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/package-runs/candidates`, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }).on("error", reject);
    });
    assert.equal(body.status, 200);
    const parsed = JSON.parse(body.body);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.data, "response should have data field");
    assert.equal(parsed.data.runs.length, 1);
    assert.equal(parsed.data.runs[0].runId, "2026-06-01-api-run");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("discovery API route supports includeParked query param", async () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-active-run", candidates: makeCandidates("2026-06-01-active-run", 2) },
      {
        id: "2026-06-02-parked-run",
        candidates: makeCandidates("2026-06-02-parked-run", 3),
        stateMarkdown: "State: parked\n",
      },
    ],
  });
  const server = packageEngineServer.createServer({ root: tempRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const withoutParam = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/package-runs/candidates`, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve(JSON.parse(data)));
      }).on("error", reject);
    });
    assert.equal(withoutParam.data.runs.length, 1);

    const withParam = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/package-runs/candidates?includeParked=true`, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve(JSON.parse(data)));
      }).on("error", reject);
    });
    assert.equal(withParam.data.runs.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


// ── Browser-side source-level tests ────────────────────────────────────────

test("package-engine.js calls /api/package-runs/candidates on load via loadDiscoveredCandidates", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  assert.match(source, /function loadDiscoveredCandidates\s*\(/);
  assert.match(source, /\/api\/package-runs\/candidates/);
  assert.match(source, /loadDiscoveredCandidates\(\)\.then\(\(discovered\)/);
});

test("package-engine.js normalizes discovery response with normalizePayload before reading runs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  // The loadDiscoveredCandidates function must call normalizePayload on the raw JSON
  const fnMatch = source.match(/function loadDiscoveredCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "loadDiscoveredCandidates function should exist");
  assert.match(fnMatch[1], /normalizePayload\(rawJson\)/);
  assert.match(fnMatch[1], /payload\.runs/);
});

test("package-engine.js tags candidates with _runId source metadata", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function loadDiscoveredCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  assert.match(fnMatch[1], /c\._runId\s*=\s*run\.runId/);
});

test("package-engine.js defaults runFilterMode to all (not active)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  // The variable default must be "all" so all runs are visible on initial load
  assert.match(source, /let runFilterMode\s*=\s*["']all["']/);
  // loadDiscoveredCandidates must also set the filter to "all" (not "active")
  const fnMatch = source.match(/function loadDiscoveredCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  assert.match(fnMatch[1], /runFilterMode\s*=\s*["']all["']/);
  assert.match(fnMatch[1], /els\.runFilter\.value\s*=\s*["']all["']/);
});

test("package-engine.js recent/all/search filters exist in visibleCandidates", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function visibleCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "visibleCandidates function should exist");
  const body = fnMatch[1];
  // Run filter modes
  assert.match(body, /runFilterMode\s*===\s*["']active["']/);
  assert.match(body, /runFilterMode\s*===\s*["']recent["']/);
  assert.match(body, /runFilterMode\s*!==\s*["']all["']/);
  // Search filter
  assert.match(body, /searchQuery/);
  assert.match(body, /\.toLowerCase\(\)/);
  assert.match(body, /\.includes\(q\)/);
});

test("package-engine.js search filters without mutating candidate state", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function visibleCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  // Search must use filter (not splice/splice) and must not assign to candidateSet
  assert.match(body, /candidates\.filter\(/);
  assert.doesNotMatch(body, /candidateSet\.candidates\s*=/);
});

test("package-engine.js falls back to static loadCandidates when discovery fails", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  assert.match(source, /if\s*\(\s*!discovered\s*\)\s*loadCandidates\(\)/);
});

test("package-engine.js empty state distinguishes no candidates from filter mismatch", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function render\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "render function should exist");
  const body = fnMatch[1];
  // Must check candidateSet.candidates.length to distinguish "no candidates" from "filter matched nothing"
  assert.match(body, /!candidateSet\.candidates\.length/);
  assert.match(body, /No package candidates found/);
  assert.match(body, /No candidates match the current filter/);
});

test("package-engine.html includes run filter select and search input controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.html"), "utf8");
  assert.match(source, /id=["']runFilterSelect["']/);
  assert.match(source, /id=["']candidateSearch["']/);
  assert.match(source, /<option value=["']active["']>Active run<\/option>/);
  assert.match(source, /<option value=["']recent["']>Recent runs<\/option>/);
  assert.match(source, /<option value=["']all["']\s+selected>All runs<\/option>/);
});

test("package-engine.js wires run filter and search event listeners", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  assert.match(source, /els\.runFilter\.addEventListener\(["']change["']/);
  assert.match(source, /els\.search\.addEventListener\(["']input["']/);
});


// ── Multi-run discovery + default-all filter tests ─────────────────────────

test("backend: 3 eligible runs × 10 candidates returns 30 total candidates", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-run-a", candidates: makeCandidates("2026-06-01-run-a", 10) },
      { id: "2026-06-02-run-b", candidates: makeCandidates("2026-06-02-run-b", 10) },
      { id: "2026-06-03-run-c", candidates: makeCandidates("2026-06-03-run-c", 10) },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  assert.equal(result.runs.length, 3);
  assert.equal(result.totalCandidates, 30);
  for (const run of result.runs) {
    assert.equal(run.candidateCount, 10);
    assert.equal(run.candidates.length, 10);
  }
});

test("backend: discovery returns all candidates aggregated across runs", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-run-a", candidates: makeCandidates("2026-06-01-run-a", 10) },
      { id: "2026-06-02-run-b", candidates: makeCandidates("2026-06-02-run-b", 10) },
      { id: "2026-06-03-run-c", candidates: makeCandidates("2026-06-03-run-c", 10) },
    ],
  });
  const result = packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });
  const allCandidates = result.runs.flatMap((r) => r.candidates);
  assert.equal(allCandidates.length, 30);
  // Each candidate must carry its source runId
  for (const c of allCandidates) {
    assert.ok(c._runId, `candidate ${c.id} must have _runId`);
  }
  const runIds = new Set(allCandidates.map((c) => c._runId));
  assert.equal(runIds.size, 3);
});

test("browser: visibleCandidates does not cap or slice discovered candidates", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function visibleCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "visibleCandidates function should exist");
  const body = fnMatch[1];
  // Must NOT splice candidates
  assert.doesNotMatch(body, /candidates\.splice\(/, "visibleCandidates must not splice candidates");
  // Must NOT slice the candidates array (slice on run IDs for "recent" is OK)
  assert.doesNotMatch(body, /candidates\.slice\(/, "visibleCandidates must not slice the candidates array");
  // Must NOT splice candidateSet
  assert.doesNotMatch(body, /candidateSet\.candidates\.splice/, "must not splice candidateSet");
  // Must return all sorted candidates (not a capped subset)
  assert.match(body, /return\s+sorted|return\s+active\.concat\(others\)/);
});

test("browser: visibleCandidates groups active run first when multiple runs discovered", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function visibleCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  // Must check discoveredRuns.length > 1 before grouping
  assert.match(body, /discoveredRuns\.length\s*>\s*1/);
  // Must filter into active and others, then concat
  assert.match(body, /active\.concat\(others\)/);
});

test("browser: active filter reduces to active run candidates only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function visibleCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  // When runFilterMode === "active", only candidates from discoveredActiveRunId are visible
  assert.match(body, /runFilterMode\s*===\s*["']active["']/);
  assert.match(body, /discoveredActiveRunId\s*\?\s*\[discoveredActiveRunId\]/);
});

test("browser: static fallback loadCandidates still exists for discovery failure", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  assert.match(source, /function loadCandidates\(\)/);
  assert.match(source, /if\s*\(\s*!discovered\s*\)\s*loadCandidates\(\)/);
});

test("browser: no file writes on page load — loadDiscoveredCandidates uses GET only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function loadDiscoveredCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  // Must use fetch (GET — no method specified, or method: GET)
  assert.match(body, /fetch\(/);
  // Must NOT use POST, PUT, DELETE, or PATCH
  assert.doesNotMatch(body, /method:\s*["']POST["']/, "must not POST");
  assert.doesNotMatch(body, /method:\s*["']PUT["']/, "must not PUT");
  assert.doesNotMatch(body, /method:\s*["']DELETE["']/, "must not DELETE");
  assert.doesNotMatch(body, /method:\s*["']PATCH["']/, "must not PATCH");
});

test("backend: no writes occur during multi-run discovery (3 runs × 10 candidates)", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-run-a", candidates: makeCandidates("2026-06-01-run-a", 10) },
      { id: "2026-06-02-run-b", candidates: makeCandidates("2026-06-02-run-b", 10) },
      { id: "2026-06-03-run-c", candidates: makeCandidates("2026-06-03-run-c", 10) },
    ],
  });
  // Snapshot all files before
  const before = {};
  function snapshot(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        snapshot(full);
      } else {
        const stat = fs.statSync(full);
        before[full] = { mtimeMs: stat.mtimeMs, size: stat.size };
      }
    }
  }
  snapshot(tempRoot);

  packageEngineServer.discoverPackageRunCandidates({ root: tempRoot });

  // Verify no files changed
  const errors = [];
  function verify(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        verify(full);
      } else {
        const stat = fs.statSync(full);
        const b = before[full];
        if (!b) {
          errors.push(`new file created: ${full}`);
        } else if (stat.mtimeMs !== b.mtimeMs || stat.size !== b.size) {
          errors.push(`file modified: ${full}`);
        }
      }
    }
  }
  verify(tempRoot);
  assert.equal(errors.length, 0, `no writes expected, but: ${errors.join("; ")}`);
});
