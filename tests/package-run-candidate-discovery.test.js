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
  packageEngine,
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

function postJson(port, route, payload, headers = {}) {
  const bodyStr = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: {
          host: "127.0.0.1:8010",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      }
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
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

test("mergeCandidateEdits only persists whitelisted candidate fields", () => {
  const candidate = packageEngine.normalizePackageCandidate({
    id: "pkg-001",
    packageNumber: 1,
    proposedTitle: "Original",
    score: 50,
    recommendation: "Maybe",
  });
  const updated = packageEngine.mergeCandidateEdits(candidate, {
    id: "evil-id",
    packageNumber: 99,
    proposedTitle: "Updated",
    score: 101,
    recommendation: "Make",
    _runId: "not-persisted",
  });
  assert.equal(updated.id, "pkg-001");
  assert.equal(updated.packageNumber, 1);
  assert.equal(updated.proposedTitle, "Updated");
  assert.equal(updated.score, 100);
  assert.equal(updated.recommendation, "Make");
  assert.equal(updated._runId, undefined);
});

test("buildReReviewPrompt asks for JSON-only review fields for one candidate", () => {
  const prompt = packageEngine.buildReReviewPrompt({
    id: "pkg-001",
    packageNumber: 1,
    proposedTitle: "Edited Candidate",
    score: 42,
    recommendation: "Maybe",
  });
  assert.match(prompt, /valid JSON only/);
  assert.match(prompt, /Edited Candidate/);
  assert.match(prompt, /score/);
  assert.match(prompt, /recommendation/);
});

test("updatePackageRunCandidate persists whitelisted edits to package-candidates.json", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-edit-run", candidates: makeCandidates("2026-06-01-edit-run", 2) },
    ],
  });
  const result = packageEngineServer.updatePackageRunCandidate({
    runId: "2026-06-01-edit-run",
    candidateId: "2026-06-01-edit-run-pkg-1",
    fields: {
      proposedTitle: "Edited Title",
      score: 96,
      recommendation: "Make",
      id: "ignored",
    },
  }, { root: tempRoot });
  assert.equal(result.candidate.proposedTitle, "Edited Title");
  assert.equal(result.candidate.score, 96);
  assert.equal(result.candidate.id, "2026-06-01-edit-run-pkg-1");
  const saved = JSON.parse(fs.readFileSync(path.join(tempRoot, "package-runs", "2026-06-01-edit-run", "package-candidates.json"), "utf8"));
  assert.equal(saved.candidates[0].proposedTitle, "Edited Title");
  assert.equal(saved.candidates[0].id, "2026-06-01-edit-run-pkg-1");
});

test("softDeletePackageRunCandidate moves candidate into removedCandidates", () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-delete-run", candidates: makeCandidates("2026-06-01-delete-run", 2) },
    ],
  });
  const result = packageEngineServer.softDeletePackageRunCandidate({
    runId: "2026-06-01-delete-run",
    candidateId: "2026-06-01-delete-run-pkg-1",
  }, { root: tempRoot });
  assert.equal(result.candidateId, "2026-06-01-delete-run-pkg-1");
  const saved = JSON.parse(fs.readFileSync(path.join(tempRoot, "package-runs", "2026-06-01-delete-run", "package-candidates.json"), "utf8"));
  assert.equal(saved.candidates.length, 1);
  assert.equal(saved.removedCandidates.length, 1);
  assert.equal(saved.removedCandidates[0].candidate.id, "2026-06-01-delete-run-pkg-1");
  assert.ok(saved.removedCandidates[0].removedAt);
});

test("candidate update rejects path traversal run ids", () => {
  assert.throws(
    () => packageEngineServer.updatePackageRunCandidate({
      runId: "../escape",
      candidateId: "pkg-001",
      fields: { proposedTitle: "Nope" },
    }),
    /Invalid package-run id/
  );
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

test("candidate update API rejects POST without nonce", async () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-route-run", candidates: makeCandidates("2026-06-01-route-run", 1) },
    ],
  });
  const server = packageEngineServer.createServer({ root: tempRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/package-runs/candidates/update", {
      runId: "2026-06-01-route-run",
      candidateId: "2026-06-01-route-run-pkg-1",
      fields: { proposedTitle: "Should Not Save" },
    });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("candidate update API returns 404 for missing candidate", async () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-route-run", candidates: makeCandidates("2026-06-01-route-run", 1) },
    ],
  });
  const server = packageEngineServer.createServer({ root: tempRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/package-runs/candidates/update", {
      runId: "2026-06-01-route-run",
      candidateId: "missing-candidate",
      fields: { proposedTitle: "Should Not Save" },
      localWriteNonce: packageEngineServer.localWriteNonce(),
    }, {
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
    });
    assert.equal(res.status, 404);
    assert.match(res.body.error, /Candidate not found/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("candidate delete API soft-deletes with valid nonce", async () => {
  const tempRoot = createDiscoveryRoot({
    runs: [
      { id: "2026-06-01-route-delete-run", candidates: makeCandidates("2026-06-01-route-delete-run", 2) },
    ],
  });
  const server = packageEngineServer.createServer({ root: tempRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/package-runs/candidates/delete", {
      runId: "2026-06-01-route-delete-run",
      candidateId: "2026-06-01-route-delete-run-pkg-1",
      localWriteNonce: packageEngineServer.localWriteNonce(),
    }, {
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const saved = JSON.parse(fs.readFileSync(path.join(tempRoot, "package-runs", "2026-06-01-route-delete-run", "package-candidates.json"), "utf8"));
    assert.equal(saved.candidates.length, 1);
    assert.equal(saved.removedCandidates.length, 1);
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

test("package-engine.js loads parked package runs by default", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function loadDiscoveredCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "loadDiscoveredCandidates function should exist");
  assert.match(fnMatch[1], /includeParked=true/);
});

test("package-engine.js wires candidate edit delete and re-review actions", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  assert.match(source, /data-edit=/);
  assert.match(source, /data-delete=/);
  assert.match(source, /data-rereview=/);
  assert.match(source, /\/api\/package-runs\/candidates\/update/);
  assert.match(source, /\/api\/package-runs\/candidates\/delete/);
  assert.match(source, /buildReReviewPrompt/);
  assert.match(source, /els\.grid\.addEventListener\("submit", handleGridSubmit\)/);
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

// ── Confirm/Save run-id resolution tests (candidate._runId over URL ?run) ───

test("discovered candidate with _runId saves without URL ?run — handleConfirmSave prefers _runId", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function handleConfirmSave\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "handleConfirmSave function should exist");
  const body = fnMatch[1];
  // runId must be resolved from the candidate's own _runId first, then URL fallback.
  assert.match(body, /selected\._runId\s*\|\|\s*new URLSearchParams/);
});

test("URL ?run remains supported as fallback in handleConfirmSave", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function handleConfirmSave\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  // URLSearchParams must still be read as the fallback source for run.
  assert.match(body, /new URLSearchParams\(window\.location\.search\)\.get\(["']run["']\)/);
});

test("missing both _runId and URL run blocks before POST with a clear error", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function handleConfirmSave\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  // The blocking guard must check for a missing runId and emit a clear, actionable error.
  assert.match(body, /if\s*\(\s*!runId\s*\)/);
  assert.match(body, /No run ID found\. Select a candidate with a run ID or use \?run=<runId> in the URL\./);
  // The guard must return before reaching the POST (the error branch ends in return).
  const guardIndex = body.indexOf("No run ID found");
  const postIndex = body.indexOf("/api/package-engine/save-selected");
  assert.ok(guardIndex !== -1 && postIndex !== -1 && guardIndex < postIndex,
    "the missing-runId guard must precede the save-selected POST");
});

test("showConfirmPanel also resolves _runId before URL and shows the target run", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function showConfirmPanel\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "showConfirmPanel function should exist");
  const body = fnMatch[1];
  assert.match(body, /selected\._runId\s*\|\|\s*new URLSearchParams/);
  // The resolved run id must be surfaced into the confirm panel.
  assert.match(body, /els\.confirmRunId/);
});

test("package-engine.html confirm-box displays the target run id element", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.html"), "utf8");
  assert.match(source, /id=["']confirmRunId["']/);
});

test("existing selected-package.json is not overwritten without explicit confirm — showConfirmPanel checks first", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function showConfirmPanel\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  // Must fetch the existing selected-package.json and, when present, route to showNextSteps
  // (the "already saved" path) instead of showing the save button.
  assert.match(body, /selected-package\.json/);
  assert.match(body, /if\s*\(\s*existing\s*\)\s*\{[\s\S]*?showNextSteps\([^)]*true\)/);
});

test("no files are written on page load — loadDiscoveredCandidates does not save or confirm", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function loadDiscoveredCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  // The page-load function must not POST a selection nor invoke the save handler.
  assert.doesNotMatch(body, /save-selected/, "page load must not POST save-selected");
  assert.doesNotMatch(body, /handleConfirmSave/, "page load must not call handleConfirmSave");
});

test("multi-run fixture: selecting candidate from run B writes only to run B", async () => {
  // The save-selected endpoint writes under the server module ROOT/package-runs.
  // Create two isolated, test-prefixed run dirs there, POST a save for run-b, and
  // verify the write lands only in run-b — run-a must remain untouched. Clean up after.
  const realRunsRoot = path.join(__dirname, "..", "package-runs");
  const stamp = `${process.pid}`;
  const runAId = `2026-01-01-test-save-run-a-${stamp}`;
  const runBId = `2026-01-02-test-save-run-b-${stamp}`;
  const runADir = path.join(realRunsRoot, runAId);
  const runBDir = path.join(realRunsRoot, runBId);
  fs.mkdirSync(runADir, { recursive: true });
  fs.mkdirSync(runBDir, { recursive: true });

  const server = packageEngineServer.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const selectedPackage = {
      selectedAt: "2026-06-26T00:00:00.000Z",
      package: { proposedTitle: "Run B Winner", packageNumber: 2, score: 88 },
    };
    const bodyStr = JSON.stringify({
      runId: runBId,
      selectedPackage,
      localWriteNonce: packageEngineServer.localWriteNonce(),
    });
    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/package-engine/save-selected",
          method: "POST",
          headers: {
            host: "127.0.0.1:8010",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(bodyStr),
            [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        }
      );
      req.on("error", reject);
      req.write(bodyStr);
      req.end();
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    // selected-package.json written to run-b only
    assert.ok(fs.existsSync(path.join(runBDir, "selected-package.json")), "run-b must have selected-package.json");
    assert.ok(!fs.existsSync(path.join(runADir, "selected-package.json")), "run-a must NOT have selected-package.json");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runADir, { recursive: true, force: true });
    fs.rmSync(runBDir, { recursive: true, force: true });
  }
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


// ── Bug 2: persisted vs pending selection state ─────────────────────────────

test("Bug2 #1: existing selected-package.json marks only that candidate as persisted winner", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  // A dedicated persistedSelectedId state variable must exist, separate from pending.
  assert.match(source, /let persistedSelectedId\s*=/);
  // It must be set from the on-disk selected-package.json (data.package.id or data.id).
  const fnMatch = source.match(/function loadPersistedSelectedId\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "loadPersistedSelectedId function should exist");
  const body = fnMatch[1];
  assert.match(body, /selected-package\.json/);
  assert.match(body, /persistedSelectedId\s*=/);
  assert.match(body, /pkg\.id\s*\|\|\s*data\.id/);
  // loadDiscoveredCandidates must invoke it after building candidates.
  const discMatch = source.match(/function loadDiscoveredCandidates\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(discMatch);
  assert.match(discMatch[1], /loadPersistedSelectedId\(\)/);
});

test("Bug2 #2: clicking another candidate sets pending (not persisted) and renderCard distinguishes them", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const clickMatch = source.match(/function handleGridClick\(event\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(clickMatch, "handleGridClick function should exist");
  const clickBody = clickMatch[1];
  // The select branch must set pendingSelectedId, NOT persistedSelectedId or a legacy selectedId.
  assert.match(clickBody, /pendingSelectedId\s*=\s*select\.dataset\.select/);
  assert.doesNotMatch(clickBody, /persistedSelectedId\s*=\s*select\.dataset\.select/);
  assert.doesNotMatch(clickBody, /\bselectedId\s*=\s*select\.dataset\.select/);
  // renderCard must distinguish a persisted winner from a pending selection.
  const cardMatch = source.match(/function renderCard\(candidate\)\s*\{([\s\S]*?)\n    return article;/);
  assert.ok(cardMatch, "renderCard function should exist");
  const cardBody = cardMatch[1];
  assert.match(cardBody, /isPersistedWinner\s*=\s*candidate\.id\s*===\s*persistedSelectedId/);
  assert.match(cardBody, /isPendingSelection\s*=\s*candidate\.id\s*===\s*pendingSelectedId/);
});

test("Bug2 #3: confirm save with existing selected-package.json requires explicit replace", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function showConfirmPanel\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "showConfirmPanel function should exist");
  const body = fnMatch[1];
  // Must fetch the existing file and route to a replace mode when a different selection exists.
  assert.match(body, /selected-package\.json/);
  assert.match(body, /setConfirmPanelMode\(["']replace["']/);
  assert.match(body, /setConfirmPanelMode\(["']create["']/);
  // The replace mode must change the save button label and the mode text.
  const modeMatch = source.match(/function setConfirmPanelMode\(mode, existingPkg\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(modeMatch, "setConfirmPanelMode function should exist");
  const modeBody = modeMatch[1];
  assert.match(modeBody, /Replace Selection/);
  assert.match(modeBody, /Confirm and Save/);
  assert.match(modeBody, /els\.confirmModeText/);
});

test("Bug2 #4: after successful save, persistedSelectedId is set and pendingSelectedId cleared", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function handleConfirmSave\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "handleConfirmSave function should exist");
  const body = fnMatch[1];
  assert.match(body, /persistedSelectedId\s*=\s*selected\.id/);
  assert.match(body, /pendingSelectedId\s*=\s*""/);
  // The persisted update must occur in the save success path (before showNextSteps).
  const persistIndex = body.indexOf("persistedSelectedId = selected.id");
  const nextStepsIndex = body.indexOf("showNextSteps(runId, selected, false)");
  assert.ok(persistIndex !== -1 && nextStepsIndex !== -1 && persistIndex < nextStepsIndex,
    "persistedSelectedId must be updated before showNextSteps in the success path");
});

test("Bug2 #5: generate-outline-prompt POST sends only runId and localWriteNonce (reads from disk)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function showNextSteps\(runId, selected, alreadySaved\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "showNextSteps function should exist");
  const body = fnMatch[1];
  // The outline-prompt POST body must carry only runId + localWriteNonce, not candidate data.
  assert.match(body, /generate-outline-prompt/);
  assert.match(body, /body:\s*JSON\.stringify\(\{\s*runId:\s*runSlug,\s*localWriteNonce\s*\}\)/);
  const postSlice = body.slice(body.indexOf("generate-outline-prompt"));
  assert.doesNotMatch(postSlice, /selectedPackage/);
  assert.doesNotMatch(postSlice, /candidate:/);
});

test("Bug2 #4b: saving a new selection overwrites an existing selected-package.json", async () => {
  const realRunsRoot = path.join(__dirname, "..", "package-runs");
  const stamp = `${process.pid}`;
  const runId = `2026-01-03-test-replace-selection-${stamp}`;
  const runDir = path.join(realRunsRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  // Seed an existing selected-package.json with an OLD candidate.
  const existing = {
    selectedAt: "2026-06-25T00:00:00.000Z",
    package: { id: "old-candidate", proposedTitle: "Old Winner", packageNumber: 1, score: 70 },
  };
  fs.writeFileSync(path.join(runDir, "selected-package.json"), JSON.stringify(existing, null, 2), "utf8");

  const server = packageEngineServer.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const selectedPackage = {
      selectedAt: "2026-06-26T00:00:00.000Z",
      package: { id: "new-candidate", proposedTitle: "New Winner", packageNumber: 2, score: 95 },
    };
    const bodyStr = JSON.stringify({
      runId,
      selectedPackage,
      localWriteNonce: packageEngineServer.localWriteNonce(),
    });
    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/package-engine/save-selected",
          method: "POST",
          headers: {
            host: "127.0.0.1:8010",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(bodyStr),
            [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        }
      );
      req.on("error", reject);
      req.write(bodyStr);
      req.end();
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    const saved = JSON.parse(fs.readFileSync(path.join(runDir, "selected-package.json"), "utf8"));
    const savedPkg = saved.package || saved;
    assert.equal(savedPkg.id, "new-candidate", "file must hold the new candidate");
    assert.equal(savedPkg.proposedTitle, "New Winner");
    // The old data must be gone.
    assert.notEqual(savedPkg.id, "old-candidate");
    const raw = fs.readFileSync(path.join(runDir, "selected-package.json"), "utf8");
    assert.doesNotMatch(raw, /Old Winner/, "old selection must be overwritten");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

// ── "Open Run Folder" button in Stage 2 outline handoff panel ───────────────
// The button opens the run folder via the existing /api/package-runs/open
// endpoint. It must never write outline files. Server-side path traversal and
// package-runs/ confinement are covered in package-runs-dashboard.test.js
// (the resolvePackageRunOpenTarget / resolvePackageRunDir tests, ~lines 268
// and 295) so they are not duplicated here.

test("Open Run Folder button exists in the Stage 2 outline handoff panel", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function showNextSteps\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "showNextSteps function should exist");
  const body = fnMatch[1];
  assert.match(body, /id="openRunFolderBtn"/, "button must have id openRunFolderBtn");
  assert.match(body, /Open Run Folder/, "button must show 'Open Run Folder' text");
  // The button must sit inside the .prompt-actions div, after downloadPromptBtn.
  const actionsMatch = body.match(/<div class="prompt-actions">([\s\S]*?)<\/div>/);
  assert.ok(actionsMatch, "prompt-actions div should exist");
  assert.match(actionsMatch[1], /downloadPromptBtn[\s\S]*openRunFolderBtn/, "Open Run Folder must come after Download as .md inside prompt-actions");
});

test("Open Run Folder prefers selected candidate _runId when available", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function showNextSteps\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  assert.match(fnMatch[1], /selected\._runId/, "run id resolution must prefer selected._runId");
});

test("Open Run Folder falls back to URL ?run=... when no candidate runId", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function showNextSteps\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  assert.match(fnMatch[1], /URLSearchParams[\s\S]*\.get\(["']run["']\)/, "must read run id from URL ?run= param");
});

test("Open Run Folder disables and shows error text when no run id exists", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function showNextSteps\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch);
  const body = fnMatch[1];
  assert.match(body, /"No run folder available"/, "must show 'No run folder available' as disabled text");
  assert.match(body, /disabled\s*=\s*true/, "must disable the button when no run id is found");
});

test("openRunFolder helper performs no outline file writes", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const fnMatch = source.match(/function openRunFolder\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "openRunFolder function should exist");
  const body = fnMatch[1];
  // The button only opens the folder — it must never write outline files.
  assert.match(body, /\/api\/package-runs\/open/, "must call the open endpoint");
  assert.doesNotMatch(body, /outlines\.md|final-outline\.md|writeFile|saveFile/, "must not write any outline files");
});
