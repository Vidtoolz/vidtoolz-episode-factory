const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const crypto = require('node:crypto');
const superFocus = require('../super-focus.js');
const superFocusMedia = require('../super-focus-media.js');
const ir = require('../super-focus-image-review.js');

// ── Image Review Workbench ───────────────────────────────────────────────────
// These tests pin the workbench contract:
// (1) the GET is read-only (no queue/project/attempt writes, no spawn, no
//     PRESTO probe) with deterministic candidate ordering and honest counts;
// (2) decisions are HUMAN-ONLY explicit POSTs bound by sha256 to the exact
//     displayed image — a changed file fails closed with 409 image_changed
//     and records nothing; duplicates are idempotent;
// (3) "immediately unlockable" is pinned to the authoritative queue audit:
//     approving the image flips the linked item to safe_to_resume — and the
//     queue STAYS paused; nothing here dispatches, pumps, or resumes.

function mkdirTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', r)); }
function close(server) { return new Promise((r) => server.close(r)); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

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

const WB = '/api/super-focus/image-review-workbench';
const DECIDE = '/api/super-focus/image-review/workbench-decision';
const AUDIT = '/api/super-focus/video-queue-audit';
const VIDEO_SUBDIR = 'mp4-hq-720p';

function imagePath(mediaRoot, id, index) {
  return path.join(mediaRoot, id, 'images', 'flux-local', `flux-${String(index).padStart(3, '0')}.png`);
}
let wroteImageAtMs = 0;
function writeImage(mediaRoot, id, index, bytes) {
  const p = imagePath(mediaRoot, id, index);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  // Force a strictly increasing mtime: a replacement landing in the same
  // rounded ms as the reviewed snapshot would satisfy the cheap mtime probe
  // and hide the byte change from these tests (impossible for real
  // seconds-long generation, but reachable in a fast test loop).
  wroteImageAtMs = Math.max(Date.now(), wroteImageAtMs + 5);
  fs.utimesSync(p, new Date(wroteImageAtMs), new Date(wroteImageAtMs));
  return p;
}
function writeVideo(mediaRoot, id, index, bytes) {
  const p = path.join(mediaRoot, id, 'videos', VIDEO_SUBDIR, `${String(index).padStart(3, '0')}.mp4`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
}
function fileState(p) {
  const st = fs.statSync(p);
  return { mtimeMs: st.mtimeMs, size: st.size, content: fs.readFileSync(p, 'utf8') };
}

// Legacy-shaped fixture mirroring the paused production queue (aba0dc57):
// rows without assignment provenance or reviews, stills on disk, i2v prompts
// saved, a persisted PAUSED queue. Spawn and the PRESTO reachability probe
// throw if ever touched — the workbench must never dispatch anything.
function wbFixture(rowCount = 3, { queued = [] } = {}) {
  const root = mkdirTmp('sf-wb-root-');
  const mediaRoot = mkdirTmp('sf-wb-media-');
  let spawnCalls = 0;
  let reachCalls = 0;
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    spawn: () => { spawnCalls += 1; throw new Error('workbench must never spawn'); },
    productionScript: __filename,
    prestoReachableCheck: async () => { reachCalls += 1; throw new Error('workbench must never probe PRESTO'); },
  });
  const proj = superFocus.createProject({ title: 'WB' }, { root });
  const id = proj.project_id;
  superFocus.saveScript(id, 'Claim one.\nClaim two.', { root });
  superFocus.saveImagePrompts(id, Array.from({ length: rowCount }, (_, i) => `prompt ${i + 1}`), { root });
  const imageBytes = {};
  for (let i = 1; i <= rowCount; i++) {
    imageBytes[i] = Buffer.from(`IMG-${i}`);
    writeImage(mediaRoot, id, i, imageBytes[i]);
    superFocus.setI2vPrompt(id, i, `motion ${i}`, { root });
  }
  const queue = superFocusMedia.readVideoQueue(id, { mediaRoot });
  queue.paused = true;
  queue.paused_at = '2026-07-09T07:51:28.489Z';
  queue.paused_by = 'operator';
  queue.pause_reason = 'fixture pause';
  queued.forEach((index, i) => {
    queue.items.push({
      item_id: `q${index}-fixture-${i}`, index, status: 'queued',
      i2v_hash: superFocusMedia.i2vPromptHash(`motion ${index}`),
      queued_at: `2026-07-08T14:0${i}:00.000Z`, started_at: null, finished_at: null, error: null, output_path: null,
    });
  });
  superFocusMedia.writeVideoQueue(id, queue, { mediaRoot });
  return {
    server, root, mediaRoot, id, imageBytes,
    spawn: () => spawnCalls, reach: () => reachCalls,
    queueFile: path.join(mediaRoot, id, 'video-queue.json'),
    projectFile: path.join(root, id, 'super-focus.json'),
  };
}

async function wbGet(server, id, index) {
  return request(server, `${WB}?id=${id}${index != null ? `&index=${index}` : ''}`);
}
async function decide(server, body) {
  return request(server, DECIDE, { method: 'POST', headers: writeHeaders(), body });
}

// ── read-only + no-side-effect contract ──────────────────────────────────────

test('workbench GET: read-only — no nonce needed, no queue/project write, no spawn, no probe, no attempts', async () => {
  const fx = wbFixture(2, { queued: [1] });
  await listen(fx.server);
  try {
    const queueBefore = fileState(fx.queueFile);
    const projBefore = fileState(fx.projectFile);
    const res = await wbGet(fx.server, fx.id); // no nonce header
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.queue.paused, true);
    assert.equal(d.counts.total_candidates, 2);
    assert.deepEqual(fileState(fx.queueFile), queueBefore, 'queue file byte-identical after workbench GET');
    assert.deepEqual(fileState(fx.projectFile), projBefore, 'project file byte-identical after workbench GET');
    assert.equal(fx.spawn(), 0, 'no process spawned');
    assert.equal(fx.reach(), 0, 'no PRESTO probe');
    assert.ok(!fs.existsSync(path.join(fx.mediaRoot, fx.id, 'video-attempts.json')), 'no attempt state created');
    assert.ok(!fs.existsSync(path.join(fx.mediaRoot, fx.id, 'attempts')), 'no staging created');
  } finally { await close(fx.server); }
});

test('workbench GET: unknown project 404s; malformed index fails closed; malformed id rejected before paths', async () => {
  const fx = wbFixture(1, { queued: [1] });
  await listen(fx.server);
  try {
    assert.equal((await request(fx.server, `${WB}?id=no-such-project`)).statusCode, 404);
    assert.equal((await request(fx.server, `${WB}?id=${encodeURIComponent('../escape')}`)).statusCode, 400, 'traversal id rejected');
    assert.equal((await wbGet(fx.server, fx.id, 0)).statusCode, 400);
    assert.equal((await wbGet(fx.server, fx.id, 101)).statusCode, 400);
    assert.equal((await wbGet(fx.server, fx.id, '1.5')).statusCode, 400);
    assert.equal((await wbGet(fx.server, fx.id, 'abc')).statusCode, 400);
    // In-range index that is not a candidate (no image, no review) → 404, not an invented row.
    const fx2 = wbFixture(3, { queued: [] });
    await listen(fx2.server);
    try {
      fs.unlinkSync(imagePath(fx2.mediaRoot, fx2.id, 3));
      assert.equal((await wbGet(fx2.server, fx2.id, 3)).statusCode, 404);
    } finally { await close(fx2.server); }
  } finally { await close(fx.server); }
});

// ── candidate selection, ordering, counts ────────────────────────────────────

test('workbench candidates: buckets, deterministic order, filters-by-fact, and counts', async () => {
  // r1 queued+unreviewed(legacy), r2 queued+approved-current, r3 queued+stale
  // approval (bytes changed), r4 queued+rejected-current, r5 non-queued
  // unreviewed, r6 queued+video already exists.
  const fx = wbFixture(6, { queued: [1, 2, 3, 4, 6] });
  await listen(fx.server);
  try {
    const h = (i) => sha256(fx.imageBytes[i]);
    assert.equal((await decide(fx.server, { id: fx.id, index: 2, decision: 'approve', expected_image_hash: h(2) })).statusCode, 200);
    assert.equal((await decide(fx.server, { id: fx.id, index: 3, decision: 'approve', expected_image_hash: h(3) })).statusCode, 200);
    writeImage(fx.mediaRoot, fx.id, 3, Buffer.from('IMG-3-REPLACED')); // stale the approval
    assert.equal((await decide(fx.server, { id: fx.id, index: 4, decision: 'reject', expected_image_hash: h(4), reason: 'weak' })).statusCode, 200);
    writeVideo(fx.mediaRoot, fx.id, 6, Buffer.from('CLIP-6'));
    const d = unwrap(await wbGet(fx.server, fx.id));
    const byIndex = {};
    d.candidates.forEach((c) => { byIndex[c.index] = c; });
    // 1. unreviewed queue-linked appears in Needs decision.
    assert.equal(byIndex[1].needs_decision, true);
    assert.equal(byIndex[1].bucket, 1);
    // 2. current approved does not need a decision.
    assert.equal(byIndex[2].needs_decision, false);
    assert.equal(byIndex[2].effective_status, 'approved');
    assert.equal(byIndex[2].bucket, 4);
    // 3. stale approval does.
    assert.equal(byIndex[3].needs_decision, true);
    assert.equal(byIndex[3].effective_status, 'review_required');
    assert.equal(byIndex[3].bucket, 2);
    // 4. rejected-and-current is a made decision: excluded from Needs, present for the Rejected filter.
    assert.equal(byIndex[4].needs_decision, false);
    assert.equal(byIndex[4].effective_status, 'rejected');
    // 5. non-queued image excluded from Queue-linked facts.
    assert.equal(byIndex[5].queue_linked, false);
    assert.equal(byIndex[5].bucket, 3);
    // 6. deterministic order: bucket asc then index asc; two GETs identical.
    assert.deepEqual(d.candidates.map((c) => c.index), [1, 6, 3, 5, 2, 4]);
    const again = unwrap(await wbGet(fx.server, fx.id));
    assert.deepEqual(again.candidates, d.candidates, 'stable across polls with unchanged state');
    // 7. immediately-unlockable: r1 yes; r6 (video exists → already_satisfied) no; r3 stale approval yes after re-review… no — approval is not the ONLY gate for r3? it is: re-approval unlocks. r3 disposition:
    assert.equal(byIndex[1].unlockable, true);
    assert.equal(byIndex[6].unlockable, false, 'already-satisfied item cannot be unlocked by approval');
    assert.equal(byIndex[3].unlockable, true, 'stale approval: re-approval is the remaining review gate');
    assert.equal(d.counts.immediately_unlockable, 2);
    // 8. already-satisfied disposition represented.
    assert.equal(byIndex[6].disposition, 'already_satisfied');
    assert.equal(byIndex[6].video_exists, true);
    // Counts.
    assert.equal(d.counts.total_candidates, 6);
    assert.equal(d.counts.needs_decision, 4, 'r1, r3 (stale), r5, r6 — a slot with an existing video still needs its image decision');
    assert.equal(d.counts.unreviewed, 3, 'r1 + r5 + r6 legacy');
    assert.equal(d.counts.stale, 1);
    assert.equal(d.counts.rejected, 1);
    assert.equal(d.counts.approved, 1);
    assert.equal(d.counts.queue_linked, 5);
  } finally { await close(fx.server); }
});

test('workbench unlockable is pinned to the audit: approval flips the linked item to safe_to_resume; a stale-prompt item is not unlockable', async () => {
  const fx = wbFixture(2, { queued: [1, 2] });
  await listen(fx.server);
  try {
    // Drift item 2's queued i2v hash → audit stale_prompt precedence.
    superFocus.setI2vPrompt(fx.id, 2, 'motion 2 CHANGED', { root: fx.root });
    let d = unwrap(await wbGet(fx.server, fx.id));
    const c2 = d.candidates.find((c) => c.index === 2);
    assert.equal(c2.disposition, 'stale_prompt');
    assert.equal(c2.unlockable, false, 'approval alone would not clear a stale queued prompt');
    const c1 = d.candidates.find((c) => c.index === 1);
    assert.equal(c1.unlockable, true);
    // Approve #1 through the workbench, then re-audit: safe_to_resume.
    const r = await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: sha256(fx.imageBytes[1]) });
    assert.equal(r.statusCode, 200);
    const audit = unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`));
    const item1 = audit.items.find((it) => it.index === 1);
    assert.equal(item1.disposition, 'safe_to_resume', 'unlockable definition = audit safe_to_resume after approval');
    assert.equal(audit.paused, true, 'approval never resumes the queue');
  } finally { await close(fx.server); }
});

test('workbench: structural duplicate flags are surfaced without replacing the disposition; recommendation stays advisory', async () => {
  const fx = wbFixture(1, { queued: [1, 1] });
  await listen(fx.server);
  try {
    const d = unwrap(await wbGet(fx.server, fx.id));
    const c1 = d.candidates.find((c) => c.index === 1);
    assert.deepEqual(c1.structural_flags, ['duplicate_queue_item']);
    assert.equal(c1.disposition, 'legacy_compatibility', 'first live item keeps its own disposition');
    assert.equal(d.queue.structural.duplicate_group_count, 1);
    // Selected detail carries both queue items with their own dispositions.
    const sel = d.selected;
    assert.equal(sel.queue_items.length, 2);
    assert.equal(sel.queue_items[1].disposition, 'duplicate_queue_item');
    assert.ok(sel.queue_items[0].recommended_action, 'per-item advisory action present');
    assert.ok(d.queue.recommendation && d.queue.recommendation.choice, 'project recommendation is a field, not an action');
  } finally { await close(fx.server); }
});

// ── consequence preview ──────────────────────────────────────────────────────

test('workbench consequence: paused stays paused; blocked items are not described ready; already-satisfied never implies rendering; non-queued says so', async () => {
  const fx = wbFixture(4, { queued: [1, 2, 3] });
  await listen(fx.server);
  try {
    superFocus.setI2vPrompt(fx.id, 2, 'motion 2 CHANGED', { root: fx.root }); // stale_prompt
    writeVideo(fx.mediaRoot, fx.id, 3, Buffer.from('CLIP-3')); // already_satisfied
    const sel1 = unwrap(await wbGet(fx.server, fx.id, 1)).selected;
    assert.match(sel1.consequence.approve.join(' '), /would clear the image-review gate/);
    assert.match(sel1.consequence.approve.join(' '), /queue remains paused/i, 'approval preview says the queue stays paused');
    assert.equal(sel1.consequence.queue_paused, true);
    const sel2 = unwrap(await wbGet(fx.server, fx.id, 2)).selected;
    assert.match(sel2.consequence.approve.join(' '), /would not make queue item .* ready/i, 'stale prompt blocks readiness claims');
    const sel3 = unwrap(await wbGet(fx.server, fx.id, 3)).selected;
    assert.match(sel3.consequence.approve.join(' '), /already exists — on resume it is skipped\. Approval will not dispatch or overwrite it/i);
    const sel4 = unwrap(await wbGet(fx.server, fx.id, 4)).selected;
    assert.match(sel4.consequence.approve.join(' '), /not linked to a live queued video item/i);
    // Rejection consequence never regenerates.
    assert.match(sel1.consequence.reject.join(' '), /nothing is regenerated automatically/i);
  } finally { await close(fx.server); }
});

// ── decision binding (hash-bound, atomic, idempotent) ────────────────────────

test('workbench decision: security and validation fail closed', async () => {
  const fx = wbFixture(1, { queued: [1] });
  await listen(fx.server);
  try {
    const good = sha256(fx.imageBytes[1]);
    // No nonce → 403 and nothing recorded.
    const bare = await request(fx.server, DECIDE, { method: 'POST', body: { id: fx.id, index: 1, decision: 'approve', expected_image_hash: good } });
    assert.equal(bare.statusCode, 403);
    // Malformed project id → 400 before any path construction.
    assert.equal((await decide(fx.server, { id: '../escape', index: 1, decision: 'approve', expected_image_hash: good })).statusCode, 400);
    // Malformed index values → 400 (never rounded into a real slot).
    for (const idx of [1.5, '1', -1, 0, 101, null]) {
      assert.equal((await decide(fx.server, { id: fx.id, index: idx, decision: 'approve', expected_image_hash: good })).statusCode, 400, `index ${JSON.stringify(idx)} fails closed`);
    }
    // Malformed decision / hash → 400.
    assert.equal((await decide(fx.server, { id: fx.id, index: 1, decision: 'bless', expected_image_hash: good })).statusCode, 400);
    assert.equal((await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: 'short' })).statusCode, 400);
    assert.equal((await decide(fx.server, { id: fx.id, index: 1, decision: 'approve' })).statusCode, 400);
    // Nothing was recorded by any of the failures.
    const st = superFocus.loadProject(fx.id, { root: fx.root });
    assert.equal(st.image_prompts.find((r) => r.index === 1).image_review, undefined);
  } finally { await close(fx.server); }
});

test('workbench decision: approve binds to the exact displayed bytes; replacement image fails closed; duplicate is idempotent; slots are isolated', async () => {
  const fx = wbFixture(2, { queued: [1, 2] });
  await listen(fx.server);
  try {
    const shown = sha256(fx.imageBytes[1]);
    // 10/11. Image replaced after the workbench displayed it → 409 image_changed, nothing recorded.
    writeImage(fx.mediaRoot, fx.id, 1, Buffer.from('IMG-1-REPLACED'));
    const conflict = await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: shown });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, 'image_changed');
    assert.equal(conflict.body.current_image_hash, sha256(Buffer.from('IMG-1-REPLACED')));
    let st = superFocus.loadProject(fx.id, { root: fx.root });
    assert.equal(st.image_prompts.find((r) => r.index === 1).image_review, undefined, 'failed decision leaves no review');
    // 9. Approving the CURRENT bytes succeeds and records the exact hash.
    const current = sha256(Buffer.from('IMG-1-REPLACED'));
    const ok = await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: current });
    assert.equal(ok.statusCode, 200);
    const d = unwrap(ok);
    assert.equal(d.effective_status, 'approved');
    assert.equal(d.review.reviewed_image_hash, current);
    assert.equal(d.review.reviewed_by, 'operator');
    assert.equal(d.gate.eligible, true);
    // 12. Duplicate approve → 200 unchanged, same reviewed_at.
    const dup = await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: current });
    assert.equal(dup.statusCode, 200);
    assert.equal(unwrap(dup).unchanged, true);
    assert.equal(unwrap(dup).review.reviewed_at, d.review.reviewed_at, 'idempotent: no re-stamp');
    // 11 again. Approval must NOT transfer to yet another replacement.
    writeImage(fx.mediaRoot, fx.id, 1, Buffer.from('IMG-1-THIRD'));
    const wb = unwrap(await wbGet(fx.server, fx.id, 1));
    assert.equal(wb.selected.effective_status, 'review_required', 'stale immediately visible');
    const late = await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: current });
    assert.equal(late.statusCode, 409, 'old hash refused after replacement');
    // 13. Slot isolation: slot 2 untouched throughout.
    st = superFocus.loadProject(fx.id, { root: fx.root });
    assert.equal(st.image_prompts.find((r) => r.index === 2).image_review, undefined);
  } finally { await close(fx.server); }
});

test('workbench decision: reject and revoke behave, are idempotent, and never touch the image file or queue', async () => {
  const fx = wbFixture(1, { queued: [1] });
  await listen(fx.server);
  try {
    const h = sha256(fx.imageBytes[1]);
    const queueBefore = fileState(fx.queueFile);
    // Reject with a reason; image preserved on disk (never auto-regenerated / cleared).
    const rej = await decide(fx.server, { id: fx.id, index: 1, decision: 'reject', expected_image_hash: h, reason: 'Not the claim.' });
    assert.equal(rej.statusCode, 200);
    assert.equal(unwrap(rej).effective_status, 'rejected');
    assert.equal(unwrap(rej).review.operator_notes, 'Not the claim.');
    assert.ok(fs.existsSync(imagePath(fx.mediaRoot, fx.id, 1)), 'image preserved');
    assert.equal(fs.readFileSync(imagePath(fx.mediaRoot, fx.id, 1)).toString(), 'IMG-1', 'image bytes untouched');
    // Duplicate reject → idempotent.
    const dup = await decide(fx.server, { id: fx.id, index: 1, decision: 'reject', expected_image_hash: h });
    assert.equal(dup.statusCode, 200);
    assert.equal(unwrap(dup).unchanged, true);
    // Approve over a rejection is an explicit reversal (same exact bytes).
    const ap = await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: h });
    assert.equal(ap.statusCode, 200);
    assert.equal(unwrap(ap).effective_status, 'approved');
    // Revoke removes gate satisfaction; duplicate revoke is a no-op 200.
    const rv = await decide(fx.server, { id: fx.id, index: 1, decision: 'revoke', expected_image_hash: h });
    assert.equal(rv.statusCode, 200);
    assert.equal(unwrap(rv).effective_status, 'in_review');
    assert.equal(unwrap(rv).gate.eligible, false, 'revocation removes the gate satisfaction');
    const rv2 = await decide(fx.server, { id: fx.id, index: 1, decision: 'revoke', expected_image_hash: h });
    assert.equal(rv2.statusCode, 200);
    assert.equal(unwrap(rv2).unchanged, true);
    // Queue file byte-identical through every decision; still paused; no attempts; no spawn/probe.
    assert.deepEqual(fileState(fx.queueFile), queueBefore, 'decisions never mutate the queue');
    assert.equal(unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`)).paused, true);
    assert.ok(!fs.existsSync(path.join(fx.mediaRoot, fx.id, 'video-attempts.json')), 'no attempt created');
    assert.equal(fx.spawn(), 0);
    assert.equal(fx.reach(), 0);
  } finally { await close(fx.server); }
});

test('workbench decision: revoked approval makes the queued item source_unapproved at audit (dispatch-gate honesty)', async () => {
  const fx = wbFixture(1, { queued: [1] });
  await listen(fx.server);
  try {
    const h = sha256(fx.imageBytes[1]);
    await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: h });
    assert.equal(unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`)).items[0].disposition, 'safe_to_resume');
    await decide(fx.server, { id: fx.id, index: 1, decision: 'revoke', expected_image_hash: h });
    assert.equal(unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`)).items[0].disposition, 'source_unapproved');
    // Re-approval of the same exact bytes restores current approval (19/20).
    const re = await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: h });
    assert.equal(unwrap(re).effective_status, 'approved');
    assert.equal(unwrap(await request(fx.server, `${AUDIT}?id=${fx.id}`)).items[0].disposition, 'safe_to_resume');
  } finally { await close(fx.server); }
});

test('workbench decision: a row with undecided acceptance criteria cannot be one-click approved (blockers hold, nothing persisted)', async () => {
  // Assignment-backed row: criteria must be decided in the image row review;
  // the workbench decision fails closed with the blockers and writes nothing.
  const fx = wbFixture(1, { queued: [] });
  await listen(fx.server);
  try {
    const vpPost = (action, body) => request(fx.server, `/api/super-focus/visual-plan/${action}`, { method: 'POST', headers: writeHeaders(), body: Object.assign({ id: fx.id }, body) });
    await vpPost('create-beats', {});
    let plan = unwrap(await request(fx.server, `/api/super-focus/visual-plan?id=${fx.id}`)).visual_plan;
    const beat = plan.beats[0];
    await vpPost('save-assignment', {
      beat_id: beat.beat_id,
      viewer_task: 'Understand the claim.',
      visual_function: 'clarify',
      assignment: 'Show the claim as one concrete scene.',
      acceptance_criteria: ['Readable in one second'],
      media_type: 'image_to_video',
    });
    plan = unwrap(await request(fx.server, `/api/super-focus/visual-plan?id=${fx.id}`)).visual_plan;
    await vpPost('approve-assignment', { assignment_id: plan.assignments[0].assignment_id });
    superFocus.fillPromptsFromAssignments(fx.id, [{ text: 'A provenance-backed prompt.', assignment: plan.assignments[0] }], { root: fx.root });
    // The fill lands in the first empty slot AFTER the fixture's existing rows.
    const st = superFocus.loadProject(fx.id, { root: fx.root });
    const row = st.image_prompts.find((r) => r.assignment_id === plan.assignments[0].assignment_id);
    const bytes = Buffer.from('IMG-PROV');
    writeImage(fx.mediaRoot, fx.id, row.index, bytes);
    const blocked = await decide(fx.server, { id: fx.id, index: row.index, decision: 'approve', expected_image_hash: sha256(bytes) });
    assert.equal(blocked.statusCode, 409);
    assert.match(blocked.body.error, /criterion\(s\) still unreviewed/);
    const after = superFocus.loadProject(fx.id, { root: fx.root });
    assert.equal(after.image_prompts.find((r) => r.index === row.index).image_review, undefined, 'blocked composed decision persists nothing');
    // Workbench surfaces the criteria + assignment context for the operator.
    const sel = unwrap(await wbGet(fx.server, fx.id, row.index)).selected;
    assert.equal(sel.assignment.assignment_id, plan.assignments[0].assignment_id);
    assert.equal(sel.criteria.length, 1);
    assert.ok(sel.beat_text, 'script beat text shown when a plan exists');
  } finally { await close(fx.server); }
});

// ── freshness (current contract) ─────────────────────────────────────────────

test('workbench freshness: prompt edits do NOT invalidate approval (documented contract); assignment edits DO; image bytes DO', async () => {
  const fx = wbFixture(1, { queued: [1] });
  await listen(fx.server);
  try {
    const h = sha256(fx.imageBytes[1]);
    await decide(fx.server, { id: fx.id, index: 1, decision: 'approve', expected_image_hash: h });
    // Prompt text change: review stays current (the review judges image vs criteria).
    superFocus.saveImagePrompt(fx.id, 1, 'prompt 1 EDITED', { root: fx.root });
    let sel = unwrap(await wbGet(fx.server, fx.id, 1)).selected;
    assert.equal(sel.effective_status, 'approved', 'prompt edits do not stale the review (documented decision)');
    // Image byte change → review_required with the honest reason.
    writeImage(fx.mediaRoot, fx.id, 1, Buffer.from('IMG-1-NEW'));
    sel = unwrap(await wbGet(fx.server, fx.id, 1)).selected;
    assert.equal(sel.effective_status, 'review_required');
    assert.match(sel.reasons.join(' '), /image bytes changed/i);
    assert.equal(sel.gate.eligible, false, 'stale approval never satisfies the dispatch gate');
  } finally { await close(fx.server); }
});

test('workbench freshness: assignment change marks the review stale (assignment-backed rows)', async () => {
  const fx = wbFixture(1, { queued: [] });
  await listen(fx.server);
  try {
    const vpPost = (action, body) => request(fx.server, `/api/super-focus/visual-plan/${action}`, { method: 'POST', headers: writeHeaders(), body: Object.assign({ id: fx.id }, body) });
    await vpPost('create-beats', {});
    let plan = unwrap(await request(fx.server, `/api/super-focus/visual-plan?id=${fx.id}`)).visual_plan;
    const beat = plan.beats[0];
    const fields = {
      beat_id: beat.beat_id, viewer_task: 'See it.', visual_function: 'clarify',
      assignment: 'One concrete scene.', acceptance_criteria: ['Readable in one second'], media_type: 'image_to_video',
    };
    await vpPost('save-assignment', fields);
    plan = unwrap(await request(fx.server, `/api/super-focus/visual-plan?id=${fx.id}`)).visual_plan;
    const assignment = plan.assignments[0];
    await vpPost('approve-assignment', { assignment_id: assignment.assignment_id });
    superFocus.fillPromptsFromAssignments(fx.id, [{ text: 'Provenance prompt.', assignment }], { root: fx.root });
    const st = superFocus.loadProject(fx.id, { root: fx.root });
    const row = st.image_prompts.find((r) => r.assignment_id === assignment.assignment_id);
    const bytes = Buffer.from('IMG-A');
    writeImage(fx.mediaRoot, fx.id, row.index, bytes);
    // Full approve through the existing row flow (criteria then approve).
    const irPost = (action, body) => request(fx.server, `/api/super-focus/image-review/${action}`, { method: 'POST', headers: writeHeaders(), body: Object.assign({ id: fx.id }, body) });
    const started = unwrap(await irPost('start', { index: row.index }));
    for (const c of started.criteria) {
      await irPost('set-criterion', { index: row.index, criterion_hash: c.criterion_hash, result: 'pass' });
    }
    assert.equal((await irPost('approve', { index: row.index })).statusCode, 200);
    // Edit the assignment → workbench shows review_required for that row.
    await vpPost('revoke-assignment', { assignment_id: assignment.assignment_id });
    await vpPost('save-assignment', Object.assign({}, fields, { assignment: 'A DIFFERENT scene.' }));
    const sel = unwrap(await wbGet(fx.server, fx.id, row.index)).selected;
    assert.equal(sel.effective_status, 'review_required');
    assert.match(sel.reasons.join(' '), /assignment changed/i);
  } finally { await close(fx.server); }
});

// ── UI wiring (the workbench page contract) ──────────────────────────────────

test('workbench UI: view, explicit decision buttons, hash-bound approve, conflict handling, safe rendering', async () => {
  const fx = wbFixture(1);
  await listen(fx.server);
  try {
    const res = await request(fx.server, '/super-focus.html');
    assert.equal(res.statusCode, 200);
    const html = res.raw;
    // 35. View + primary controls render.
    assert.match(html, /id="view-workbench"/);
    for (const id of ['wb-approve', 'wb-reject', 'wb-revoke', 'wb-skip', 'wb-prev', 'wb-next', 'wb-fullres', 'wb-filter', 'wb-refresh']) {
      assert.ok(html.includes(`id="${id}"`), `${id} present`);
    }
    // Approve/Reject name the exact slot.
    assert.match(html, /'Approve image #' \+ s\.index/);
    assert.match(html, /'Reject image #' \+ s\.index/);
    // 36. The decision payload carries the displayed hash.
    assert.match(html, /expected_image_hash: s\.image\.sha256/);
    // 37. Conflict response handled explicitly.
    assert.match(html, /res\.body\.code === 'image_changed'/);
    assert.match(html, /no decision was recorded/i);
    // 38. Successful decision advances to the next unresolved candidate.
    assert.match(html, /function wbAdvanceAfter\(/);
    // 39. Filter is state that survives refreshes.
    assert.match(html, /WB\.filter = wbEl\('wb-filter'\)\.value/);
    // 40. Full-resolution viewing is the shared viewer, never a decision.
    assert.match(html, /fullresBtn\.onclick = function \(\) \{ openMediaViewer\(mvOpts\); \};/);
    // 41/42. Untrusted text goes through textContent; no innerHTML in the block.
    const wbBlock = html.slice(html.indexOf('---- Image Review Workbench'), html.indexOf('initCollapsibleSections();'));
    assert.ok(wbBlock.length > 1000, 'workbench block found');
    assert.ok(!wbBlock.includes('.innerHTML'), 'no innerHTML anywhere in the workbench block');
    assert.match(wbBlock, /v\.className = 'wb-v'; v\.textContent = value;/);
    // 44. No-candidates state never offers resume; the whole block never calls the resume API.
    assert.ok(!wbBlock.includes('VIDEO_QUEUE_RESUME_API'), 'workbench cannot resume the queue');
    assert.match(wbBlock, /resuming eligible items is a separate action/i);
    // No batch/auto approval anywhere in the block: the only decision entry
    // points are the three explicit buttons wired to wbDecide.
    assert.equal((wbBlock.match(/wbDecide\('/g) || []).length, 3, 'exactly approve/reject/revoke call wbDecide');
    assert.ok(!/setInterval/.test(wbBlock), 'no background polling loop in the workbench');
    // 43. Narrow viewport keeps the decision controls usable (stacked layout).
    assert.match(html, /@media \(max-width: 720px\)[\s\S]{0,200}\.wb-main \{ flex-direction: column; \}/);
    // Entry points from the images + videos sections.
    assert.match(html, /id="wb-open-images"/);
    assert.match(html, /id="wb-open-videos"/);
    // The workbench view participates in show().
    assert.match(html, /\['landing', 'open', 'project', 'workbench'\]/);
  } finally { await close(fx.server); }
});

// ── domain helpers ───────────────────────────────────────────────────────────

test('workbench domain: bucket + needs-decision helpers are pure and total', () => {
  assert.equal(ir.workbenchNeedsDecision('not_reviewed'), true);
  assert.equal(ir.workbenchNeedsDecision('unknown_legacy'), true);
  assert.equal(ir.workbenchNeedsDecision('in_review'), true);
  assert.equal(ir.workbenchNeedsDecision('review_required'), true);
  assert.equal(ir.workbenchNeedsDecision('approved'), false);
  assert.equal(ir.workbenchNeedsDecision('rejected'), false);
  assert.equal(ir.workbenchBucket({ effective_status: 'unknown_legacy', queue_linked: true }), 1);
  assert.equal(ir.workbenchBucket({ effective_status: 'review_required', queue_linked: true }), 2);
  assert.equal(ir.workbenchBucket({ effective_status: 'not_reviewed', queue_linked: false }), 3);
  assert.equal(ir.workbenchBucket({ effective_status: 'approved', queue_linked: true }), 4);
  assert.equal(ir.workbenchBucket({ effective_status: 'rejected', queue_linked: false }), 4);
});
