// Regression test for the Stage 2 outline prompt nonce wiring bug (2026-06-26).
// Bug: package-engine.js loadThumbnailGenerationConfig() fetched the status
// endpoint but read payload.localWriteNonce directly off the raw { ok, data }
// wrapper without normalizing first. The nonce was always empty, so the
// "Generate Outline Prompt" POST was rejected with 403:
// "Capture evidence write API requires a valid local write nonce."
//
// Also covers: outline prompt response handler must normalize before reading
// outlinePrompt field, and must guard against missing nonce before POST.
//
// These tests verify:
// 1. Server-side: outline prompt generation without a nonce is rejected with 403
// 2. Server-side: outline prompt generation with a valid nonce in the header succeeds
// 3. Server-side: outline prompt generation with a valid nonce in the body succeeds
// 4. Server-side: outline prompt generation with a wrong nonce is rejected with 403
// 5. Frontend: package-engine.js defines normalizePayload to unwrap { ok, data }
// 6. Frontend: loadThumbnailGenerationConfig normalizes before reading nonce fields
// 7. Frontend: generate outline button sends [nonceHeader]: localWriteNonce on POST
// 8. Frontend: generate outline button guards against missing nonce before POST
// 9. Frontend: outline prompt response handler normalizes before reading outlinePrompt

const {
  assert,
  fs,
  path,
  packageEngineServer,
  test,
} = require("./_helpers.js");

// ── Server-side: nonce gate on POST /api/package-engine/generate-outline-prompt ──

test("outline prompt generation without a nonce is rejected with 403", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
    },
  };
  // No nonce in header, no nonce in body — the bug condition.
  const payload = { runId: "test-run" };
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce }),
    /valid local write nonce/,
  );
});

test("outline prompt generation with a valid nonce in the header succeeds", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };
  const payload = { runId: "test-run" };
  const result = packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce });
  assert.equal(result, true);
});

test("outline prompt generation with a valid nonce in the body succeeds", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
    },
  };
  const payload = { runId: "test-run", localWriteNonce: nonce };
  const result = packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce });
  assert.equal(result, true);
});

test("outline prompt generation with a wrong nonce is rejected with 403", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: "wrong-nonce-value",
    },
  };
  const payload = { runId: "test-run", localWriteNonce: "also-wrong" };
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce }),
    /valid local write nonce/,
  );
});

// ── Frontend: package-engine.js nonce wiring ──

function readPackageEngineJs() {
  return fs.readFileSync(
    path.join(__dirname, "..", "package-engine.js"),
    "utf8",
  );
}

test("package-engine.js defines normalizePayload to unwrap { ok, data } responses", () => {
  const js = readPackageEngineJs();
  assert.match(js, /function normalizePayload\s*\(/);
  assert.match(js, /json\.data/);
});

test("package-engine.js loadThumbnailGenerationConfig normalizes the status response before reading nonce fields", () => {
  const js = readPackageEngineJs();
  // Must call normalizePayload on the fetched JSON before reading nonce fields.
  assert.match(js, /const payload = normalizePayload\(rawJson\)[\s\S]*?payload\.localWriteNonce/);
  assert.match(js, /payload\.nonceHeader/);
});

test("package-engine.js generate outline button sends the configured nonce header on POST", () => {
  const js = readPackageEngineJs();
  // The POST must include the nonce header dynamically (not hardcoded).
  assert.match(js, /\[nonceHeader\]:\s*localWriteNonce/);
  // Must also include the nonce in the body (shorthand or explicit).
  assert.match(js, /runId:\s*runSlug,\s*localWriteNonce\b/);
});

test("package-engine.js generate outline button guards against missing nonce before POST", () => {
  const js = readPackageEngineJs();
  // If the nonce never loaded, show a clear error instead of sending a doomed POST.
  assert.match(js, /if\s*\(\s*!localWriteNonce\s*\)/);
  assert.match(js, /nonce is missing/);
});

test("package-engine.js outline prompt response handler normalizes before reading outlinePrompt", () => {
  const js = readPackageEngineJs();
  // The response handler must normalize the JSON before reading .outlinePrompt.
  assert.match(js, /const data = normalizePayload\(json\)[\s\S]*?data\.outlinePrompt/);
});
