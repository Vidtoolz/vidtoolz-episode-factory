// Regression test for the topic-scout nonce wiring bug (2026-06-26).
// Bug: topic-scout.html loadNonce() fetched /api/package-engine/status but read
// data.localWriteNonce directly off the raw JSON, without normalizing the
// { ok: true, data: { ... } } wrapper that sendJSON() adds. So localWriteNonce
// was always '' and the POST to /api/topic-scout/submit was rejected with 403:
// "Capture evidence write API requires a valid local write nonce."
// Fix: loadNonce() now normalizes the response with normalizePayload() before
// reading localWriteNonce/nonceHeader — same pattern as image-selector.html
// and production-pipeline.html.
//
// These tests verify:
// 1. Server-side: topic-scout submit without a nonce is rejected with 403
// 2. Server-side: topic-scout submit with a valid nonce in the header succeeds
// 3. Frontend:    topic-scout.html normalizes the wrapped status response before
//    reading the nonce fields and sends the nonce header on POST

const {
  assert,
  fs,
  path,
  packageEngineServer,
  test,
} = require("./_helpers.js");

// ── Server-side: nonce gate on POST /api/topic-scout/submit ──

test("topic-scout submit without a nonce is rejected with 403", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
    },
  };
  // No nonce in header, no nonce in body — the bug condition.
  const payload = { runId: "test-run", topicText: "A genuine topic about AI video production" };
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce }),
    /valid local write nonce/,
  );
});

test("topic-scout submit with a valid nonce in the header succeeds", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };
  const payload = { runId: "test-run", topicText: "A genuine topic about AI video production" };
  const result = packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce });
  assert.equal(result, true);
});

test("topic-scout submit with a valid nonce in the body succeeds", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
    },
  };
  const payload = { runId: "test-run", topicText: "A genuine topic", localWriteNonce: nonce };
  const result = packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce });
  assert.equal(result, true);
});

test("topic-scout submit with a wrong nonce is rejected with 403", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: "wrong-nonce-value",
    },
  };
  const payload = { runId: "test-run", topicText: "A genuine topic", localWriteNonce: "also-wrong" };
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce }),
    /valid local write nonce/,
  );
});

// ── Frontend: topic-scout.html nonce wiring ──

function readTopicScoutHtml() {
  return fs.readFileSync(
    path.join(__dirname, "..", "topic-scout.html"),
    "utf8",
  );
}

test("topic-scout.html defines normalizePayload to unwrap { ok, data } responses", () => {
  const html = readTopicScoutHtml();
  assert.match(html, /function normalizePayload\s*\(/);
  assert.match(html, /json\.data/);
});

test("topic-scout.html loadNonce normalizes the status response before reading nonce fields", () => {
  const html = readTopicScoutHtml();
  // loadNonce must call normalizePayload on the fetched JSON, then read from payload.
  assert.match(html, /normalizePayload\(await res\.json\(\)\)[\s\S]*?payload\.localWriteNonce/);
  assert.match(html, /payload\.nonceHeader/);
  // Must NOT read localWriteNonce directly off the raw response (the old bug).
  assert.doesNotMatch(html, /data\.localWriteNonce\s*=/);
});

test("topic-scout.html submitTopic sends the configured nonce header on POST", () => {
  const html = readTopicScoutHtml();
  // The POST must include the nonce header dynamically (not hardcoded).
  assert.match(html, /\[nonceHeader\]:\s*localWriteNonce/);
  // Must also include the nonce in the body as a fallback.
  assert.match(html, /localWriteNonce:\s*localWriteNonce/);
});

test("topic-scout.html submitTopic guards against missing nonce before POST", () => {
  const html = readTopicScoutHtml();
  // If the nonce never loaded, show a clear error instead of sending a doomed POST.
  assert.match(html, /if\s*\(\s*!localWriteNonce\s*\)/);
  assert.match(html, /nonce is missing/);
});

test("topic-scout.html submitTopic normalizes the response before reading duplicate/review fields", () => {
  const html = readTopicScoutHtml();
  // submitTopic must normalize the JSON before reading .duplicate or .review.
  assert.match(html, /const result = normalizePayload\(json\)[\s\S]*?result\.duplicate/);
  assert.doesNotMatch(html, /data\.duplicate/);
});

test("topic-scout.html submitTopic calls renderReviewInline to show criteria after submission", () => {
  const html = readTopicScoutHtml();
  assert.match(html, /renderReviewInline\s*\(/);
});

test("topic-scout.html renderReviewInline renders each criterion with pass/fail and detail", () => {
  const html = readTopicScoutHtml();
  assert.match(html, /function renderReviewInline/);
  assert.match(html, /review\.checks/);
  assert.match(html, /c\.passed.*review-check-pass|review-check-pass.*c\.passed/);
  assert.match(html, /c\.criterion/);
  assert.match(html, /c\.detail/);
  assert.match(html, /review\.recommendation/);
  assert.match(html, /review\.passedCount.*review\.totalCount/);
});

test("topic-scout.html loadSubmittedTopics normalizes the list response before reading topics", () => {
  const html = readTopicScoutHtml();
  assert.match(html, /normalizePayload\(await res\.json\(\)\)[\s\S]*?payload\.topics/);
  assert.doesNotMatch(html, /data\.topics\b/);
});
