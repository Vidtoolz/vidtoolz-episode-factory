// Regression test for the friction-log nonce bug (2026-06-22).
// Bug: friction-log.js save() was POSTing to /api/package-runs/friction-log/save
// without fetching /api/package-engine/status first, so the request had no
// local-write nonce and the server rejected it with 403.
// Fix: friction-log.js now calls loadLocalWriteConfig() which fetches the nonce
// from /api/package-engine/status and includes it in both the header and body.
//
// These tests verify the server-side nonce gate that blocked the buggy save:
// 1. validateLocalWriteRequest rejects without a nonce (the 403 the bug caused)
// 2. validateLocalWriteRequest accepts with a nonce in the header (the fix path)
// 3. validateLocalWriteRequest accepts with a nonce in the body (alternate path)
// 4. createStatusResponse exposes localWriteNonce + nonceHeader (the fetch endpoint)
// 5. isAllowedLocalHost rejects non-local hosts (another 403 cause)

const {
  assert,
  packageEngineServer,
  test,
} = require("./_helpers.js");

test("validateLocalWriteRequest rejects a friction log save without a nonce with 403", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
    },
  };
  // No nonce in header, no nonce in body — this is what the bug looked like.
  const payload = { runFolder: "test-run", entries: [] };
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce }),
    /valid local write nonce/,
  );
});

test("validateLocalWriteRequest accepts a friction log save with a nonce in the header", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };
  const payload = { runFolder: "test-run", entries: [], localWriteNonce: nonce };
  const result = packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce });
  assert.equal(result, true);
});

test("validateLocalWriteRequest accepts a friction log save with a nonce only in the body", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      // No nonce header — but nonce is in the body.
    },
  };
  const payload = { runFolder: "test-run", entries: [], localWriteNonce: nonce };
  const result = packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce });
  assert.equal(result, true);
});

test("validateLocalWriteRequest rejects a friction log save with a wrong nonce with 403", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: "wrong-nonce-value",
    },
  };
  const payload = { runFolder: "test-run", entries: [], localWriteNonce: "also-wrong" };
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce }),
    /valid local write nonce/,
  );
});

test("validateLocalWriteRequest rejects a non-local host with 403", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "evil.example.com:8010",
      origin: "http://evil.example.com:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };
  const payload = { runFolder: "test-run", entries: [], localWriteNonce: nonce };
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce }),
    /local Host header/,
  );
});

test("validateLocalWriteRequest rejects a non-local origin with 403", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const req = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://evil.example.com:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };
  const payload = { runFolder: "test-run", entries: [], localWriteNonce: nonce };
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest(req, payload, { port: 8010, writeNonce: nonce }),
    /non-local Origin/,
  );
});

test("createStatusResponse exposes localWriteNonce and nonceHeader for the browser fetch path", () => {
  const status = packageEngineServer.createStatusResponse();
  assert.equal(typeof status.localWriteNonce, "string");
  assert.ok(status.localWriteNonce.length > 0, "localWriteNonce should not be empty");
  assert.equal(status.nonceHeader, packageEngineServer.LOCAL_WRITE_NONCE_HEADER);
  assert.equal(status.nonceHeader, "x-vidtoolz-local-write-nonce");
});

test("LOCAL_WRITE_NONCE_HEADER is the expected header name", () => {
  assert.equal(packageEngineServer.LOCAL_WRITE_NONCE_HEADER, "x-vidtoolz-local-write-nonce");
});

test("localWriteNonce returns the same nonce as createStatusResponse", () => {
  const directNonce = packageEngineServer.localWriteNonce();
  const statusNonce = packageEngineServer.createStatusResponse().localWriteNonce;
  assert.equal(directNonce, statusNonce);
});
