const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocusMedia = require('../super-focus-media.js');

// VIDNAS availability guard (2026-08-03 cockpit-wedge class). Super Focus
// media routes do sync fs work against the media root; on vidnux that root is
// a CIFS mount under /mnt, and a dropped mount wedges the event loop for the
// full mount timeout per request. The guard probes the mount (bounded async
// stat + down-latch) before dispatch: down -> fail fast 503, healthy/local ->
// unchanged. These tests pin that contract with injectable stat/clock so no
// real mount is involved.

function mkdirTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', r)); }
function close(server) { return new Promise((r) => server.close(r)); }
function request(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : '';
  const headers = Object.assign(
    body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    options.headers || {}
  );
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: address.port, path: pathname,
      method: options.method || 'GET', headers,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (c) => { raw += c; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) { /* text */ }
        resolve({ statusCode: response.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── probeMount unit contract ────────────────────────────────────────────────

test('probeMount skips non-/mnt roots (local checkout is never probed)', async () => {
  const res = await superFocusMedia.probeMount('/tmp/local-media-root');
  assert.equal(res.ok, true);
  assert.equal(res.skipped, true);
});

test('probeMount resolves ok for a healthy /mnt root', async () => {
  superFocusMedia.resetMountLatch();
  const stat = async () => ({ isDirectory: () => true });
  const res = await superFocusMedia.probeMount('/mnt/vidnas_public/VIDTOOLZ', { stat });
  assert.equal(res.ok, true);
});

test('probeMount rejects with 503 and latches when the mount stat fails', async () => {
  superFocusMedia.resetMountLatch();
  const stat = async () => { const e = new Error('hang'); e.code = 'EIO'; throw e; };
  await assert.rejects(
    () => superFocusMedia.probeMount('/mnt/vidnas_public/VIDTOOLZ', { stat }),
    (err) => { assert.equal(err.statusCode, 503); return true; }
  );
  // Inside the down-latch window, a SECOND probe must fail fast WITHOUT
  // calling stat again (no re-paying the timeout / no wedge).
  let statCalls = 0;
  const countingStat = async () => { statCalls += 1; return { isDirectory: () => true }; };
  await assert.rejects(
    () => superFocusMedia.probeMount('/mnt/vidnas_public/VIDTOOLZ', { stat: countingStat }),
    (err) => { assert.equal(err.statusCode, 503); return true; }
  );
  assert.equal(statCalls, 0, 'latched-down probe must not re-stat');
  superFocusMedia.resetMountLatch();
});

test('probeMount rejects with 503 when the probe times out', async () => {
  superFocusMedia.resetMountLatch();
  // A stat that never settles simulates the wedged CIFS mount.
  const stat = () => new Promise(() => {});
  await assert.rejects(
    () => superFocusMedia.probeMount('/mnt/vidnas_public/VIDTOOLZ', { stat, timeoutMs: 50 }),
    (err) => { assert.equal(err.statusCode, 503); return true; }
  );
  superFocusMedia.resetMountLatch();
});

// ── route-level contract ────────────────────────────────────────────────────

test('media route with a dead /mnt root fails fast 503, local route still works', async () => {
  const root = mkdirTmp('sf-guard-root-');
  // Point the media root at a /mnt path so the guard engages; the path does
  // not exist, so fs.promises.stat rejects -> probe latches down -> 503.
  const deadMediaRoot = '/mnt/vidtoolz-test-dead-mount- does-not-exist';
  superFocusMedia.resetMountLatch();
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: deadMediaRoot,
  });
  await listen(server);
  try {
    // A guarded media route (videos-status is in SUPER_FOCUS_MEDIA_ROUTE_PATHS).
    const mediaRes = await request(server, '/api/super-focus/videos-status?projectId=guard-probe');
    assert.equal(mediaRes.statusCode, 503, 'media route must fail fast 503 on dead mount');

    // A local-only route (not in the media set) must NOT be gated by the dead
    // mount. projects-list does no media fs work and should respond normally
    // (200 or a handler-level status, but never the 503 guard short-circuit).
    const localRes = await request(server, '/api/super-focus/projects');
    assert.notEqual(localRes.statusCode, 503, 'local-only route must not be gated by the media guard');
  } finally {
    superFocusMedia.resetMountLatch();
    await close(server);
  }
});

test('media route with a healthy local media root is unaffected by the guard', async () => {
  const root = mkdirTmp('sf-guard-root-');
  const mediaRoot = mkdirTmp('sf-guard-media-'); // local tmp -> probe skipped
  superFocusMedia.resetMountLatch();
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
  });
  await listen(server);
  try {
    const res = await request(server, '/api/super-focus/videos-status?projectId=guard-healthy');
    // Local root: guard skips the probe, request dispatches to the handler.
    // Whatever the handler returns for a missing project, it must not be the
    // guard's 503 short-circuit.
    assert.notEqual(res.statusCode, 503, 'healthy local media root must not trip the guard');
  } finally {
    superFocusMedia.resetMountLatch();
    await close(server);
  }
});
