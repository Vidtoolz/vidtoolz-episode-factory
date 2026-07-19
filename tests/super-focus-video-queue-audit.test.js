const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocus = require('../super-focus.js');
const superFocusMedia = require('../super-focus-media.js');

// ── Read-only video queue audit ──────────────────────────────────────────────
// The safe inspection path for a paused queue. These tests pin two contracts:
// (1) classification is honest per disposition, (2) the audit has ZERO side
// effects — no pump, no reconcile, no queue rewrite, no attempt creation, no
// PRESTO reachability probe, no spawn. Fixtures freeze the queue by pausing
// it (pause is the production shape being audited: aba0dc57).

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
function writeHeaders() {
  const h = { host: '127.0.0.1:8010' };
  h[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce();
  return h;
}
function unwrap(res) { return res.body && res.body.data ? res.body.data : res.body; }

const VIDEO_SUBDIR = 'mp4-hq-720p';
const AUDIT = '/api/super-focus/video-queue-audit';

function writeImage(mediaRoot, id, index, bytes) {
  const p = path.join(mediaRoot, id, 'images', 'flux-local', `flux-${String(index).padStart(3, '0')}.png`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
}
function writeVideo(mediaRoot, id, index, bytes) {
  const p = path.join(mediaRoot, id, 'videos', VIDEO_SUBDIR, `${String(index).padStart(3, '0')}.mp4`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
}

// Legacy-shaped fixture (mirrors the real paused production queue): rows with
// NO assignment provenance and NO image reviews (=> unknown_legacy under the
// gate), stills on disk, i2v prompts saved, a persisted paused queue written
// through the real writer. Guards prove nothing can dispatch: spawn and the
// reachability probe both throw if ever touched.
function auditFixture(rowCount = 3) {
  const root = mkdirTmp('sf-qa-root-');
  const mediaRoot = mkdirTmp('sf-qa-media-');
  let spawnCalls = 0;
  let reachCalls = 0;
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    spawn: () => { spawnCalls += 1; throw new Error('audit must never spawn'); },
    productionScript: __filename,
    prestoReachableCheck: async () => { reachCalls += 1; throw new Error('audit must never probe PRESTO'); },
  });
  const proj = superFocus.createProject({ title: 'QA' }, { root });
  const id = proj.project_id;
  superFocus.saveScript(id, 'Claim one.\nClaim two.', { root });
  superFocus.saveImagePrompts(id, Array.from({ length: rowCount }, (_, i) => `prompt ${i + 1}`), { root });
  for (let i = 1; i <= rowCount; i++) {
    writeImage(mediaRoot, id, i, Buffer.from(`IMG-${i}`));
    superFocus.setI2vPrompt(id, i, `motion ${i}`, { root });
  }
  const queue = superFocusMedia.readVideoQueue(id, { mediaRoot });
  queue.paused = true;
  queue.paused_at = '2026-07-09T07:51:28.489Z';
  queue.paused_by = 'operator';
  queue.pause_reason = 'fixture pause';
  for (let i = 1; i <= rowCount; i++) {
    queue.items.push({
      item_id: `q${i}-fixture-${i}`, index: i, status: 'queued',
      i2v_hash: superFocusMedia.i2vPromptHash(`motion ${i}`),
      queued_at: `2026-07-08T14:0${i}:00.000Z`, started_at: null, finished_at: null, error: null, output_path: null,
    });
  }
  superFocusMedia.writeVideoQueue(id, queue, { mediaRoot });
  return { server, root, mediaRoot, id, spawn: () => spawnCalls, reach: () => reachCalls };
}

function queueFileState(mediaRoot, id) {
  const p = path.join(mediaRoot, id, 'video-queue.json');
  const st = fs.statSync(p);
  return { mtimeMs: st.mtimeMs, size: st.size, content: fs.readFileSync(p, 'utf8') };
}

// ── read-only + no-side-effect contract ──────────────────────────────────────

test('queue-audit: GET needs no nonce and never pumps, spawns, probes, writes, or creates attempts', async () => {
  const fx = auditFixture(2);
  await listen(fx.server);
  try {
    const before = queueFileState(fx.mediaRoot, fx.id);
    const res = await request(fx.server, `${AUDIT}?id=${fx.id}`); // no nonce header
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.paused, true);
    assert.equal(d.live_count, 2);
    const after = queueFileState(fx.mediaRoot, fx.id);
    assert.deepEqual(after, before, 'queue file byte-identical after audit');
    assert.equal(fx.spawn(), 0, 'no process spawned');
    assert.equal(fx.reach(), 0, 'no PRESTO probe');
    assert.ok(!fs.existsSync(path.join(fx.mediaRoot, fx.id, 'video-attempts.json')), 'no attempt state created');
    assert.ok(!fs.existsSync(path.join(fx.mediaRoot, fx.id, 'attempts')), 'no staging created');
    assert.equal(d.policy, 'report_only');
  } finally { await close(fx.server); }
});

test('queue-audit: unknown project 404s honestly; empty queue reports zero live items', async () => {
  const fx = auditFixture(1);
  await listen(fx.server);
  try {
    const missing = await request(fx.server, `${AUDIT}?id=no-such-project`);
    assert.equal(missing.statusCode, 404);
    // Fresh project with no queue file at all.
    const p2 = superFocus.createProject({ title: 'QA empty' }, { root: fx.root });
    const empty = unwrap(await request(fx.server, `${AUDIT}?id=${p2.project_id}`));
    assert.equal(empty.queue_count, 0);
    assert.equal(empty.live_count, 0);
    assert.deepEqual(empty.summary, {});
    assert.equal(empty.estimated_runtime_seconds, 0);
  } finally { await close(fx.server); }
});

// ── dispositions ─────────────────────────────────────────────────────────────

test('queue-audit: legacy rows classify as legacy_compatibility (dispatchable, approval unproven), never safe_to_resume', async () => {
  const fx = auditFixture(2);
  await listen(fx.server);
  try {
    const d = unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`));
    assert.equal(d.summary.legacy_compatibility, 2);
    assert.ok(!d.summary.safe_to_resume);
    for (const it of d.items) {
      assert.equal(it.disposition, 'legacy_compatibility');
      assert.equal(it.image_review_status, 'unknown_legacy');
      assert.equal(it.would_dispatch_on_resume, true);
      assert.equal(it.estimated_seconds, d.seconds_per_clip);
    }
    assert.equal(d.estimated_runtime_seconds, 2 * d.seconds_per_clip);
  } finally { await close(fx.server); }
});

test('queue-audit: already-satisfied, missing-source, missing-prompt, stale-prompt, invalid-identity each classify distinctly', async () => {
  const fx = auditFixture(3);
  await listen(fx.server);
  try {
    const { root, mediaRoot, id } = fx;
    // item 1 → already_satisfied (clip on disk)
    writeVideo(mediaRoot, id, 1, Buffer.from('CLIP'));
    // item 2 → stale_prompt (text edited after enqueue)
    superFocus.setI2vPrompt(id, 2, 'a completely different motion', { root });
    // item 3 → missing_source (still removed)
    fs.rmSync(path.join(mediaRoot, id, 'images', 'flux-local', 'flux-003.png'));
    // extra queued items: one for a row that never existed, one duplicate of 2
    const queue = superFocusMedia.readVideoQueue(id, { mediaRoot });
    queue.items.push({ item_id: 'q99-ghost', index: 99, status: 'queued', i2v_hash: 'aaaaaaaaaaaaaaaa', queued_at: '2026-07-08T15:00:00.000Z' });
    queue.items.push({ item_id: 'q2-dup', index: 2, status: 'queued', i2v_hash: superFocusMedia.i2vPromptHash('motion 2'), queued_at: '2026-07-08T15:01:00.000Z' });
    superFocusMedia.writeVideoQueue(id, queue, { mediaRoot });
    const d = unwrap(await request(fx.server, `${AUDIT}?id=${id}`));
    const by = {};
    d.items.forEach((it) => { by[it.item_id] = it; });
    assert.equal(by['q1-fixture-1'].disposition, 'already_satisfied');
    assert.equal(by['q1-fixture-1'].would_dispatch_on_resume, false);
    assert.equal(by['q2-fixture-2'].disposition, 'stale_prompt');
    assert.notEqual(by['q2-fixture-2'].i2v_hash_queued, by['q2-fixture-2'].i2v_hash_current);
    assert.equal(by['q2-fixture-2'].would_dispatch_on_resume, true, 'stale prompt still dispatches — with CURRENT text');
    assert.equal(by['q3-fixture-3'].disposition, 'missing_source');
    assert.equal(by['q99-ghost'].disposition, 'invalid_identity');
    assert.equal(by['q2-dup'].disposition, 'duplicate_queue_item');
    // missing_prompt: clear row 2's prompt and re-audit (dup item now missing_prompt too)
    superFocus.clearI2vPrompt(id, 2, { root });
    const d2 = unwrap(await request(fx.server, `${AUDIT}?id=${id}`));
    const it2 = d2.items.find((it) => it.item_id === 'q2-fixture-2');
    assert.equal(it2.disposition, 'missing_prompt');
  } finally { await close(fx.server); }
});

test('queue-audit: revoked/unfinished image review classifies as source_unapproved; real approval yields safe_to_resume', async () => {
  const fx = auditFixture(1);
  await listen(fx.server);
  try {
    const { id } = fx;
    // Starting a review creates a review object, so the legacy branch no
    // longer applies and the gate judges the review state directly.
    const started = await request(fx.server, '/api/super-focus/image-review/start', { method: 'POST', headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(started.statusCode, 200);
    const d = unwrap(await request(fx.server, `${AUDIT}?id=${id}`));
    assert.equal(d.items[0].disposition, 'source_unapproved');
    assert.match(d.items[0].reasons[0], /review not finished|not started|not approved/i);
    assert.equal(d.items[0].would_dispatch_on_resume, false);
    // Approve → safe_to_resume (a REAL approval, not compatibility).
    for (const c of unwrap(started).criteria) {
      await request(fx.server, '/api/super-focus/image-review/set-criterion', { method: 'POST', headers: writeHeaders(), body: { id, index: 1, criterion_hash: c.criterion_hash, result: 'pass' } });
    }
    const approved = await request(fx.server, '/api/super-focus/image-review/approve', { method: 'POST', headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(approved.statusCode, 200);
    const d2 = unwrap(await request(fx.server, `${AUDIT}?id=${id}`));
    assert.equal(d2.items[0].disposition, 'safe_to_resume');
    assert.equal(d2.summary.safe_to_resume, 1);
  } finally { await close(fx.server); }
});

test('queue-audit: a dispatched attempt owning the slot classifies as active_attempt_exists', async () => {
  const fx = auditFixture(1);
  await listen(fx.server);
  try {
    const row = { index: 1, i2v_prompt: { text: 'motion 1' }, assignment_id: null };
    superFocusMedia.createVideoAttempt(fx.id, row, { mediaRoot: fx.mediaRoot, subdir: VIDEO_SUBDIR });
    const d = unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`));
    assert.equal(d.items[0].disposition, 'active_attempt_exists');
    assert.equal(d.items[0].active_attempt.status, 'dispatched');
    assert.equal(d.items[0].would_dispatch_on_resume, false);
  } finally { await close(fx.server); }
});

// ── Pump image-review gate (resume safety) ───────────────────────────────────
// The enqueue, batch, and regenerate paths all refuse rows the image-review
// gate rejects — but an item already IN the queue used to dispatch anyway
// when the queue resumed, even if its image's approval had been revoked in
// the meantime. The pump must re-check the gate at dispatch time: gate-refused
// items become 'skipped_review' (explicit, requeue-able), and NEVER spawn.

test('queue-audit: pump skips (never dispatches) a queued item whose image review no longer clears the gate', async () => {
  const fx = auditFixture(2);
  await listen(fx.server);
  try {
    const { root, mediaRoot, id } = fx;
    // Row 1's image goes into review (in_review → gate refuses). Row 2 stays
    // legacy-eligible so the pump has a following item to prove it moves on.
    const started = await request(fx.server, '/api/super-focus/image-review/start', { method: 'POST', headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(started.statusCode, 200);
    // Resume the queue (the fixture pauses it); the resume route pumps.
    const resumed = await request(fx.server, '/api/super-focus/video-queue/resume', { method: 'POST', headers: writeHeaders(), body: { id } });
    assert.equal(resumed.statusCode, 200);
    await new Promise((r) => setTimeout(r, 100));
    const queue = superFocusMedia.readVideoQueue(id, { mediaRoot });
    const item1 = queue.items.find((it) => it.index === 1);
    assert.equal(item1.status, 'skipped_review', 'gate-refused item is skipped explicitly, not dispatched');
    assert.match(item1.error, /not cleared by review/i);
    // The guard spawn throws if ever called; row 2 (legacy-eligible) should
    // have been ATTEMPTED next — its dispatch fails on the throwing spawn,
    // which is exactly the proof the pump moved past row 1 to a legal row.
    assert.equal(queue.items.find((it) => it.index === 2).status !== 'skipped_review', true);
    void root;
  } finally { await close(fx.server); }
});

// ── Advisory recommendations (never executed) ────────────────────────────────

test('queue-audit: every item carries a recommended_action and the project gets an advisory recommendation', async () => {
  const fx = auditFixture(2);
  await listen(fx.server);
  try {
    const { root, mediaRoot, id } = fx;
    writeVideo(mediaRoot, id, 1, Buffer.from('CLIP')); // item 1 → already_satisfied
    const d = unwrap(await request(fx.server, `${AUDIT}?id=${id}`));
    const by = {};
    d.items.forEach((it) => { by[it.index] = it; });
    assert.equal(by[1].recommended_action, 'remove_later_as_already_satisfied');
    assert.equal(by[2].recommended_action, 'review_image_first', 'legacy compatibility → review the image first');
    assert.equal(d.recommendation.choice, 'retain_safe_subset_later');
    assert.match(d.recommendation.reason, /separate them before any resume/);
    // All-legacy queue → keep_paused with review-first guidance.
    fs.rmSync(path.join(mediaRoot, id, 'videos', VIDEO_SUBDIR, '001.mp4'));
    const d2 = unwrap(await request(fx.server, `${AUDIT}?id=${id}`));
    assert.equal(d2.recommendation.choice, 'keep_paused');
    assert.match(d2.recommendation.reason, /Review the images first/);
    // Fully approved queue → resume_as_is_later.
    for (const index of [1, 2]) {
      const started = unwrap(await request(fx.server, '/api/super-focus/image-review/start', { method: 'POST', headers: writeHeaders(), body: { id, index } }));
      for (const c of started.criteria) {
        await request(fx.server, '/api/super-focus/image-review/set-criterion', { method: 'POST', headers: writeHeaders(), body: { id, index, criterion_hash: c.criterion_hash, result: 'pass' } });
      }
      await request(fx.server, '/api/super-focus/image-review/approve', { method: 'POST', headers: writeHeaders(), body: { id, index } });
    }
    const d3 = unwrap(await request(fx.server, `${AUDIT}?id=${id}`));
    assert.equal(d3.summary.safe_to_resume, 2);
    assert.equal(d3.recommendation.choice, 'resume_as_is_later');
    d3.items.forEach((it) => assert.equal(it.recommended_action, 'keep_queued'));
    void root;
  } finally { await close(fx.server); }
});

test('queue-audit: path-traversal project ids are rejected, never resolved', async () => {
  const fx = auditFixture(1);
  await listen(fx.server);
  try {
    for (const evil of ['../../etc', '..%2F..%2Fetc', 'a/../b', '..']) {
      const res = await request(fx.server, `${AUDIT}?id=${encodeURIComponent(evil)}`);
      assert.ok(res.statusCode === 404 || res.statusCode === 400, `${evil} → ${res.statusCode} (refused)`);
    }
  } finally { await close(fx.server); }
});

// ── UI + docs wiring (static assertions) ─────────────────────────────────────

test('queue-audit: GUI is read-only — GET only, no nonce, no apiPost, textContent rendering, explicit no-mutation copy', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'super-focus.html'), 'utf8');
  assert.ok(page.includes('id="vidqueue-audit"'), 'audit button present');
  assert.ok(page.includes('id="vidqueue-audit-out"'), 'output panel present');
  const start = page.indexOf("getElementById('vidqueue-audit').addEventListener");
  assert.ok(start !== -1, 'button is wired');
  const end = page.indexOf('---- Step 6', start);
  const slice = page.slice(start, end === -1 ? start + 5000 : end);
  assert.ok(slice.includes("'/api/super-focus/video-queue-audit?id='"), 'wired to the audit GET');
  assert.ok(!/apiPost|method:\s*'POST'|localWriteNonce|setInterval/.test(slice), 'no writes, no nonce, no polling');
  assert.ok(!/innerHTML/.test(slice), 'renders via textContent only');
  assert.ok(slice.includes('nothing was resumed, cancelled, deleted, or dispatched'), 'explicit read-only copy');
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'super-focus.md'), 'utf8');
  assert.ok(doc.includes('video-queue-audit'), 'docs cover the audit route');
  assert.ok(doc.includes('skipped_review'), 'docs cover the dispatch-time gate');
});

test('queue-audit: hostile pause-reason text is rendered inert (textContent, not markup)', async () => {
  const fx = auditFixture(1);
  await listen(fx.server);
  try {
    const queue = superFocusMedia.readVideoQueue(fx.id, { mediaRoot: fx.mediaRoot });
    queue.pause_reason = '<img src=x onerror=alert(1)>';
    superFocusMedia.writeVideoQueue(fx.id, queue, { mediaRoot: fx.mediaRoot });
    const d = unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`));
    // The API returns the raw string (JSON is inert); the GUI contract above
    // pins textContent-only rendering, so markup can never execute.
    assert.equal(d.pause.pause_reason, '<img src=x onerror=alert(1)>');
  } finally { await close(fx.server); }
});

test('queue-audit: ordering is queue order, history excludes terminal items, output stays bounded and deterministic', async () => {
  const fx = auditFixture(3);
  await listen(fx.server);
  try {
    const queue = superFocusMedia.readVideoQueue(fx.id, { mediaRoot: fx.mediaRoot });
    queue.items.unshift({ item_id: 'q0-done', index: 1, status: 'done', queued_at: '2026-07-08T13:00:00.000Z', output_path: 'videos/mp4-hq-720p/001.mp4' });
    queue.items.push({ item_id: 'q0-failed', index: 2, status: 'failed', queued_at: '2026-07-08T13:01:00.000Z' });
    superFocusMedia.writeVideoQueue(fx.id, queue, { mediaRoot: fx.mediaRoot });
    const a = unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`));
    const b = unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`));
    assert.deepEqual(a, b, 'deterministic across identical reads');
    assert.equal(a.queue_count, 5);
    assert.equal(a.live_count, 3);
    assert.deepEqual(a.history, { done: 1, failed: 1 });
    assert.deepEqual(a.items.map((i) => i.item_id), ['q1-fixture-1', 'q2-fixture-2', 'q3-fixture-3'], 'queue order preserved');
    assert.deepEqual(a.items.map((i) => i.position), [2, 3, 4], 'positions are queue-file positions');
    assert.equal(a.oldest_queued_at, '2026-07-08T14:01:00.000Z');
    assert.ok(JSON.stringify(a).length < 64 * 1024, 'bounded output for a small queue');
  } finally { await close(fx.server); }
});
