const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocus = require('../super-focus.js');
const superFocusMedia = require('../super-focus-media.js');

// ── Render-time source-image provenance (generation attempts) ───────────────
// The honesty gap these tests pin down: before the attempts layer, the lane
// never recorded WHICH image bytes were actually uploaded to PRESTO — bytes
// were read at upload time (after dispatch), and completion was attributed by
// file existence per index. Scenarios A–H from the provenance task. Each test
// drives the REAL queue pump / batch / regenerate paths with a deterministic
// fake production process (options.spawn) that mimics run-production.py's
// upload+render locally — no PRESTO, no network, no real generation.

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
function sha256(buf) { return require('crypto').createHash('sha256').update(buf).digest('hex'); }

const VIDEO_SUBDIR = 'mp4-hq-720p'; // PRESTO_PROFILE_OUTPUT_SUBDIRS[DEFAULT_PRESTO_PROFILE]
const SCRIPT = 'One clear claim about tools.\nAnother clear claim about systems.';
const ASSIGN_FIELDS = {
  viewer_task: 'Understand the claim.',
  visual_function: 'clarify',
  assignment: 'Show the claim as one concrete scene.',
  acceptance_criteria: ['Readable in one second'],
  media_type: 'image_to_video',
};
const I2V_ONE = 'Slow deliberate push-in while panels appear one by one.';
const I2V_TWO = 'Steady lateral glide across the workbench surface.';
const IMG_ONE = Buffer.from('IMAGE-I1-BYTES');
const IMG_TWO = Buffer.from('IMAGE-ROW2-BYTES');

function imgPath(mediaRoot, id, index) {
  return path.join(mediaRoot, id, 'images', 'flux-local', `flux-${String(index).padStart(3, '0')}.png`);
}
function writeImage(mediaRoot, id, index, bytes) {
  const p = imgPath(mediaRoot, id, index);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
}
function videoOut(mediaRoot, id, index) {
  return path.join(mediaRoot, id, 'videos', VIDEO_SUBDIR, `${String(index).padStart(3, '0')}.mp4`);
}

// Deterministic fake production process (a real `node -e` child so the job's
// 'close' event drives the pump exactly like a real render). It mimics
// run-production.py: reads selected-images.json, READS THE SELECTED FILE'S
// BYTES (the "upload" — captured to FAKE-uploaded-N.bin so tests can prove
// which bytes PRESTO would have received), then writes the output mp4 derived
// from those bytes. delayMs models the dispatch→upload window of Scenario H.
function fakeProductionSpawn(behavior = {}) {
  const childProcess = require('child_process');
  return function spawn(bin, args, opts) {
    const pkgIdx = (args || []).indexOf('--package');
    const pkgDir = pkgIdx !== -1 ? args[pkgIdx + 1] : null;
    const delayMs = behavior.delayMs || 30;
    const script = `
      const fs = require('fs'); const path = require('path');
      const pkg = ${JSON.stringify(pkgDir)};
      setTimeout(() => {
        try {
          const sel = JSON.parse(fs.readFileSync(path.join(pkg, 'selected-images.json'), 'utf8'));
          for (const s of sel.selections) {
            const bytes = fs.readFileSync(path.join(pkg, s.selected_path)); // the "upload": bytes fix HERE
            fs.writeFileSync(path.join(pkg, 'FAKE-uploaded-' + s.prompt_index + '.bin'), bytes);
            const out = path.join(pkg, 'videos', '${VIDEO_SUBDIR}', String(s.prompt_index).padStart(3, '0') + '.mp4');
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, Buffer.concat([Buffer.from('MP4-FAKE-'), bytes]));
          }
        } catch (e) { process.stderr.write(String(e)); process.exit(1); }
        process.exit(0);
      }, ${delayMs});
    `;
    return childProcess.spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  };
}

async function irPost(server, action, body) {
  return request(server, `/api/super-focus/image-review/${action}`, { method: 'POST', headers: writeHeaders(), body });
}

// Full upstream chain for TWO rows: beats → approved assignments → provenance
// prompt rows → stills → approved image reviews → i2v prompts.
async function attemptServer(behavior = {}) {
  const root = mkdirTmp('sf-va-root-');
  const mediaRoot = mkdirTmp('sf-va-media-');
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    spawn: fakeProductionSpawn(behavior),
    productionScript: __filename, // must exist; the fake spawn ignores it
    prestoReachableCheck: behavior.reach || (async () => true),
  });
  await listen(server);
  const proj = superFocus.createProject({ title: 'VA' }, { root });
  const id = proj.project_id;
  superFocus.saveScript(id, SCRIPT, { root });
  const vpPost = (action, body) => request(server, `/api/super-focus/visual-plan/${action}`, { method: 'POST', headers: writeHeaders(), body: Object.assign({ id }, body) });
  await vpPost('create-beats', {});
  let plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
  for (const beat of plan.beats.slice(0, 2)) {
    await vpPost('save-assignment', Object.assign({ beat_id: beat.beat_id }, ASSIGN_FIELDS));
  }
  plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
  for (const assignment of plan.assignments) {
    await vpPost('approve-assignment', { assignment_id: assignment.assignment_id });
  }
  superFocus.fillPromptsFromAssignments(id, [
    { text: 'A concrete scene prompt one.', assignment: plan.assignments[0] },
    { text: 'A concrete scene prompt two.', assignment: plan.assignments[1] },
  ], { root });
  writeImage(mediaRoot, id, 1, IMG_ONE);
  writeImage(mediaRoot, id, 2, IMG_TWO);
  for (const index of [1, 2]) {
    const started = unwrap(await irPost(server, 'start', { id, index }));
    for (const c of started.criteria) {
      await irPost(server, 'set-criterion', { id, index, criterion_hash: c.criterion_hash, result: 'pass' });
    }
    await irPost(server, 'approve', { id, index });
  }
  superFocus.setI2vPrompt(id, 1, I2V_ONE, { root });
  superFocus.setI2vPrompt(id, 2, I2V_TWO, { root });
  return { server, root, mediaRoot, id };
}

function waitFor(cond, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      Promise.resolve().then(cond).then((v) => {
        if (v) return resolve(v);
        if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor timeout'));
        setTimeout(poll, 25);
      }).catch(reject);
    })();
  });
}

function completedAttemptFor(mediaRoot, id, index) {
  const data = superFocusMedia.readVideoAttempts(id, { mediaRoot });
  return Object.values(data.attempts).find((a) => a.index === index && a.status === 'completed') || null;
}

async function queueAndFinish(server, id, mediaRoot, index) {
  const q = await request(server, '/api/super-focus/queue-video', {
    method: 'POST', headers: writeHeaders(), body: { id, index },
  });
  assert.equal(q.statusCode, 200);
  assert.equal(unwrap(q).enqueued, true);
  await waitFor(async () => {
    const s = unwrap(await request(server, `/api/super-focus/video-queue?id=${id}`));
    const item = (s.items || []).filter((it) => it.index === index).pop();
    return item && item.status === 'done';
  });
}

// ── Scenarios A + C + H: bytes swapped inside the dispatch→upload window ────

test('video-attempts: provenance records the exact staged bytes the render uploads, not the mutated canonical (Scenarios A/C/H)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 300 });
  try {
    const swapped = Buffer.from('IMAGE-I2-DIFFERENT');
    const q = await request(server, '/api/super-focus/queue-video', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 1 },
    });
    assert.equal(unwrap(q).enqueued, true);
    // The fake render "uploads" ~300ms after spawn; swap the canonical still
    // NOW — inside the dispatch→upload window that used to be unprovable.
    await new Promise((r) => setTimeout(r, 60));
    writeImage(mediaRoot, id, 1, swapped);
    await waitFor(() => completedAttemptFor(mediaRoot, id, 1));
    const done = completedAttemptFor(mediaRoot, id, 1);
    // The attempt recorded the DISPATCH-staged bytes (I1)...
    assert.equal(done.source.sha256, sha256(IMG_ONE), 'attempt records dispatch-staged bytes');
    assert.notEqual(done.source.sha256, sha256(swapped));
    // ...and the captured "upload" proves the render received exactly those
    // bytes (it read the immutable staged copy, not the mutated canonical).
    const uploaded = fs.readFileSync(path.join(mediaRoot, id, 'FAKE-uploaded-1.bin'));
    assert.equal(sha256(uploaded), done.source.sha256, 'uploaded bytes === staged bytes === recorded hash');
    assert.equal(done.source_verified, true, 'staged copy re-hashed unchanged at completion');
    // The output clip is bound to the attempt BY CONTENT.
    assert.equal(done.output.sha256, sha256(fs.readFileSync(videoOut(mediaRoot, id, 1))));
    // Current row now differs from the render source — derivable, surfaced.
    assert.notEqual(sha256(fs.readFileSync(imgPath(mediaRoot, id, 1))), done.source.sha256);
  } finally { await close(server); }
});

// ── Scenario B: prompt drift after dispatch never rewrites the attempt ──────

test('video-attempts: i2v text edited after dispatch never rewrites the attempt prompt provenance (Scenario B)', async () => {
  const { server, root, mediaRoot, id } = await attemptServer({ delayMs: 250 });
  try {
    const q = await request(server, '/api/super-focus/queue-video', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 1 },
    });
    assert.equal(unwrap(q).enqueued, true);
    await new Promise((r) => setTimeout(r, 50));
    superFocus.setI2vPrompt(id, 1, 'A COMPLETELY different motion.', { root });
    await waitFor(() => completedAttemptFor(mediaRoot, id, 1));
    const done = completedAttemptFor(mediaRoot, id, 1);
    assert.equal(done.i2v.text, I2V_ONE, 'attempt keeps the dispatched prompt verbatim');
    assert.equal(done.i2v.canonical_hash, superFocusMedia.i2vPromptHash(I2V_ONE));
    assert.equal(done.i2v.sha256, sha256(Buffer.from(I2V_ONE)));
    assert.notEqual(done.i2v.canonical_hash, superFocusMedia.i2vPromptHash('A COMPLETELY different motion.'));
  } finally { await close(server); }
});

// ── Scenario D: sequential slots complete without cross-attribution ─────────

test('video-attempts: two queued slots complete with distinct attempts and per-slot sources (Scenario D)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    await queueAndFinish(server, id, mediaRoot, 1);
    await queueAndFinish(server, id, mediaRoot, 2);
    const a1 = completedAttemptFor(mediaRoot, id, 1);
    const a2 = completedAttemptFor(mediaRoot, id, 2);
    assert.ok(a1 && a2 && a1.attempt_id !== a2.attempt_id);
    assert.equal(a1.source.sha256, sha256(IMG_ONE));
    assert.equal(a2.source.sha256, sha256(IMG_TWO));
    assert.equal(a1.output.sha256, sha256(fs.readFileSync(videoOut(mediaRoot, id, 1))));
    assert.equal(a2.output.sha256, sha256(fs.readFileSync(videoOut(mediaRoot, id, 2))));
    assert.equal(a1.i2v.canonical_hash, superFocusMedia.i2vPromptHash(I2V_ONE));
    assert.equal(a2.i2v.canonical_hash, superFocusMedia.i2vPromptHash(I2V_TWO));
  } finally { await close(server); }
});

// ── Scenarios E/F: retry identity + completion ownership refusals ───────────

test('video-attempts: regenerate mints a new attempt; a non-active attempt refuses completion (Scenarios E/F)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    await queueAndFinish(server, id, mediaRoot, 1);
    const a1 = completedAttemptFor(mediaRoot, id, 1);
    const rq = await request(server, '/api/super-focus/regenerate-video', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 1 },
    });
    assert.equal(rq.statusCode, 200);
    await waitFor(() => {
      const data = superFocusMedia.readVideoAttempts(id, { mediaRoot });
      return Object.values(data.attempts).some((a) => a.index === 1 && a.attempt_id !== a1.attempt_id && a.status !== 'dispatched');
    });
    const data = superFocusMedia.readVideoAttempts(id, { mediaRoot });
    const all1 = Object.values(data.attempts).filter((a) => a.index === 1);
    assert.ok(all1.length >= 2, 'retry created a distinct attempt identity');
    assert.equal(data.attempts[a1.attempt_id].source.sha256, a1.source.sha256, 'historical attempt provenance untouched');
    // Completion ownership: the earlier attempt is no longer the slot's active
    // dispatched attempt — completing it must refuse and record the refusal.
    const refused = superFocusMedia.completeVideoAttempt(id, a1.attempt_id, { mediaRoot });
    assert.equal(refused.completed, false);
    assert.match(refused.reason, /already|not the active attempt/i);
    const after = superFocusMedia.readVideoAttempts(id, { mediaRoot });
    assert.ok((after.attempts[a1.attempt_id].events || []).some((e) => e.event === 'completion_ignored'), 'refusal recorded as an event');
  } finally { await close(server); }
});

test('video-attempts: a cancelled attempt never completes even when its output file appears later (Scenario E)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    // Build a dispatched attempt directly at the module layer, cancel it, then
    // make its output appear — the exact late-completion shape.
    const row = { index: 1, i2v_prompt: { text: I2V_ONE }, assignment_id: null };
    const attempt = superFocusMedia.createVideoAttempt(id, row, { mediaRoot, subdir: VIDEO_SUBDIR });
    superFocusMedia.markVideoAttempt(id, attempt.attempt_id, 'cancelled', 'stopped_by_operator', { mediaRoot });
    const out = videoOut(mediaRoot, id, 1);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from('LATE-FILE'));
    const result = superFocusMedia.completeVideoAttempt(id, attempt.attempt_id, { mediaRoot });
    assert.equal(result.completed, false);
    assert.match(result.reason, /already cancelled/i);
    const data = superFocusMedia.readVideoAttempts(id, { mediaRoot });
    assert.equal(data.attempts[attempt.attempt_id].status, 'cancelled');
    assert.equal(data.attempts[attempt.attempt_id].output, null, 'no output provenance invented for a cancelled attempt');
  } finally { await close(server); }
});

test('video-attempts: a new dispatch supersedes the previous dispatched attempt for the slot', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    const row = { index: 1, i2v_prompt: { text: I2V_ONE }, assignment_id: null };
    const first = superFocusMedia.createVideoAttempt(id, row, { mediaRoot, subdir: VIDEO_SUBDIR });
    const second = superFocusMedia.createVideoAttempt(id, row, { mediaRoot, subdir: VIDEO_SUBDIR });
    const data = superFocusMedia.readVideoAttempts(id, { mediaRoot });
    assert.equal(data.attempts[first.attempt_id].status, 'superseded');
    assert.equal(data.attempts[second.attempt_id].status, 'dispatched');
    assert.equal(data.active['1'], second.attempt_id);
    // The superseded attempt refuses completion even with an output present.
    const out = videoOut(mediaRoot, id, 1);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from('SOME-CLIP'));
    const refused = superFocusMedia.completeVideoAttempt(id, first.attempt_id, { mediaRoot });
    assert.equal(refused.completed, false);
  } finally { await close(server); }
});

// ── Scenario G: source missing before dispatch ───────────────────────────────

test('video-attempts: missing source before dispatch fails honestly with no invented attempt (Scenario G)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    fs.unlinkSync(imgPath(mediaRoot, id, 1));
    const q = unwrap(await request(server, '/api/super-focus/queue-video', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 1 },
    }));
    assert.equal(q.enqueued, false, 'prereq gate refuses before any dispatch');
    const data = superFocusMedia.readVideoAttempts(id, { mediaRoot });
    assert.ok(!Object.values(data.attempts).some((a) => a.index === 1), 'no attempt record invented');
    // Direct staging failure (the race shape: still vanishes AFTER eligibility)
    // throws — the callers translate that into an honest failed dispatch.
    assert.throws(() => superFocusMedia.createVideoAttempt(id, { index: 1, i2v_prompt: { text: I2V_ONE } }, { mediaRoot, subdir: VIDEO_SUBDIR }));
  } finally { await close(server); }
});

// ── Video Review integration + legacy ────────────────────────────────────────

test('video-attempts: review GET exposes render provenance for attempt-backed clips, null for legacy, and derives current-row drift', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    // Legacy: a clip on disk for row 2 with NO attempt record.
    const legacyOut = videoOut(mediaRoot, id, 2);
    fs.mkdirSync(path.dirname(legacyOut), { recursive: true });
    fs.writeFileSync(legacyOut, Buffer.from('LEGACY-CLIP'));
    // Attempt-backed: row 1 through the real pump.
    await queueAndFinish(server, id, mediaRoot, 1);
    const g = unwrap(await request(server, `/api/super-focus/video-review?id=${id}`));
    const r1 = g.reviews.find((r) => r.index === 1);
    const r2 = g.reviews.find((r) => r.index === 2);
    assert.ok(r1.render_provenance, 'attempt-backed clip exposes render provenance');
    assert.equal(r1.render_provenance.source_sha256, sha256(IMG_ONE));
    assert.equal(r1.render_provenance.source_verified, true);
    assert.equal(r1.render_provenance.source_matches_current_row, true);
    assert.equal(r1.render_provenance.i2v_canonical_hash, superFocusMedia.i2vPromptHash(I2V_ONE));
    assert.equal(r2.render_provenance, null, 'legacy clip: provenance null — never invented');
    // Drift the CURRENT still for row 1: render provenance pins the change.
    writeImage(mediaRoot, id, 1, Buffer.from('NEWER-IMAGE-BYTES'));
    const g2 = unwrap(await request(server, `/api/super-focus/video-review?id=${id}`));
    const r1b = g2.reviews.find((r) => r.index === 1);
    assert.equal(r1b.render_provenance.source_matches_current_row, false, 'current row no longer matches the render source');
    assert.equal(r1b.render_provenance.source_sha256, sha256(IMG_ONE), 'recorded render source unchanged by the drift');
  } finally { await close(server); }
});

test('video-attempts: review started on an attempt-backed clip binds to the render-time source hash', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    await queueAndFinish(server, id, mediaRoot, 1);
    const vrPost = (action, body) => request(server, `/api/super-focus/video-review/${action}`, { method: 'POST', headers: writeHeaders(), body });
    const started = await vrPost('start', { id, index: 1 });
    assert.equal(started.statusCode, 200);
    for (const c of unwrap(started).criteria) {
      await vrPost('set-criterion', { id, index: 1, criterion_hash: c.criterion_hash, result: 'pass' });
    }
    await vrPost('set-usable-range', { id, index: 1, usable_range: { full_clip: true } });
    const approved = await vrPost('approve', { id, index: 1 });
    assert.equal(approved.statusCode, 200);
    let g = unwrap(await request(server, `/api/super-focus/video-review?id=${id}`));
    let r1 = g.reviews.find((r) => r.index === 1);
    assert.equal(r1.review.reviewed_source_binding, 'render_time');
    assert.equal(r1.review.reviewed_source_image_hash, sha256(IMG_ONE), 'review bound to the bytes that produced the clip');
    assert.equal(r1.review.reviewed_render_attempt_id, completedAttemptFor(mediaRoot, id, 1).attempt_id);
    assert.equal(r1.effective_status, 'approved');
    // Now drift the still: render binding surfaces the drift with the
    // render-specific reason copy (the review compares against the bytes
    // that produced the clip, not whatever the reviewer last looked at).
    writeImage(mediaRoot, id, 1, Buffer.from('DRIFTED-AFTER-APPROVAL'));
    g = unwrap(await request(server, `/api/super-focus/video-review?id=${id}`));
    r1 = g.reviews.find((r) => r.index === 1);
    assert.equal(r1.effective_status, 'review_required');
    assert.ok(r1.mismatches.indexOf('source_mismatch') !== -1, 'drift surfaces as source_mismatch under render binding');
    assert.ok(r1.reasons.some((m) => /differs from the image that produced this video/.test(m)), 'render-binding reason copy');
    // And a review started AFTER a pre-existing drift is blocked upstream by
    // image-review staleness (defense in depth): the image gate 409s approval.
    const reApproved = await vrPost('approve', { id, index: 1 });
    assert.equal(reApproved.statusCode, 409, 'stale upstream state cannot be converted into approval');
  } finally { await close(server); }
});

test('video-attempts: review on a legacy clip keeps review-time binding (unchanged behavior)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    const legacyOut = videoOut(mediaRoot, id, 2);
    fs.mkdirSync(path.dirname(legacyOut), { recursive: true });
    fs.writeFileSync(legacyOut, Buffer.from('LEGACY-CLIP'));
    const started = await request(server, '/api/super-focus/video-review/start', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 2 },
    });
    assert.equal(started.statusCode, 200);
    const g = unwrap(await request(server, `/api/super-focus/video-review?id=${id}`));
    const r2 = g.reviews.find((r) => r.index === 2);
    assert.equal(r2.review.reviewed_source_binding, 'review_time');
    assert.equal(r2.review.reviewed_source_image_hash, sha256(IMG_TWO), 'legacy binding: current image at review time');
    assert.equal(r2.review.reviewed_render_attempt_id, null);
  } finally { await close(server); }
});

// ── Lazy-hash economics + persistence shape ──────────────────────────────────

test('video-attempts: routine reads resolve by mtime+size probe (metadata persisted; no hash needed when unchanged)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    await queueAndFinish(server, id, mediaRoot, 1);
    const done = completedAttemptFor(mediaRoot, id, 1);
    assert.ok(Number.isFinite(done.output.mtime_ms) && Number.isFinite(done.output.size), 'probe metadata persisted on the attempt');
    // A probe-only lookup (no hash functions supplied) must resolve the clip.
    const st = fs.statSync(videoOut(mediaRoot, id, 1));
    const prov = superFocusMedia.videoRenderProvenance(id, 1, {
      mediaRoot, videoMtimeMs: Math.round(st.mtimeMs), videoSize: st.size,
    });
    assert.ok(prov && prov.attempt_id === done.attempt_id, 'mtime+size probe alone attributes the clip');
    // Content lookup still works when the probe diverges (touched file).
    const bytes = fs.readFileSync(videoOut(mediaRoot, id, 1));
    const prov2 = superFocusMedia.videoRenderProvenance(id, 1, {
      mediaRoot, videoMtimeMs: 0, videoSize: st.size, hashVideo: () => sha256(bytes),
    });
    assert.ok(prov2 && prov2.attempt_id === done.attempt_id, 'content hash attributes a probe-diverged clip');
  } finally { await close(server); }
});

test('video-attempts: foreign clip bytes are never attributed (content binding)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    await queueAndFinish(server, id, mediaRoot, 1);
    // Replace the clip with foreign bytes: no attempt owns them → null.
    fs.writeFileSync(videoOut(mediaRoot, id, 1), Buffer.from('FOREIGN-REPLACEMENT'));
    const st = fs.statSync(videoOut(mediaRoot, id, 1));
    const prov = superFocusMedia.videoRenderProvenance(id, 1, {
      mediaRoot, videoMtimeMs: Math.round(st.mtimeMs), videoSize: st.size,
      hashVideo: () => sha256(Buffer.from('FOREIGN-REPLACEMENT')),
    });
    assert.equal(prov, null, 'a swapped-in clip gets NO provenance — never invented');
    // And the review GET degrades to the legacy shape for that row.
    const g = unwrap(await request(server, `/api/super-focus/video-review?id=${id}`));
    assert.equal(g.reviews.find((r) => r.index === 1).render_provenance, null);
  } finally { await close(server); }
});

test('video-attempts: batch generate-videos records one attempt per row with staged sources', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    const resp = await request(server, '/api/super-focus/generate-videos', {
      method: 'POST', headers: writeHeaders(), body: { id },
    });
    assert.equal(resp.statusCode, 200);
    await waitFor(() => completedAttemptFor(mediaRoot, id, 1) && completedAttemptFor(mediaRoot, id, 2));
    const a1 = completedAttemptFor(mediaRoot, id, 1);
    const a2 = completedAttemptFor(mediaRoot, id, 2);
    assert.equal(a1.source.sha256, sha256(IMG_ONE));
    assert.equal(a2.source.sha256, sha256(IMG_TWO));
    assert.equal(a1.source_verified, true);
    assert.equal(a2.source_verified, true);
    // Both uploads read the staged copies.
    assert.equal(sha256(fs.readFileSync(path.join(mediaRoot, id, 'FAKE-uploaded-1.bin'))), sha256(IMG_ONE));
    assert.equal(sha256(fs.readFileSync(path.join(mediaRoot, id, 'FAKE-uploaded-2.bin'))), sha256(IMG_TWO));
  } finally { await close(server); }
});

// ── UI wiring (static page assertions) ───────────────────────────────────────

test('video-attempts: super-focus.html surfaces the three render-source states (proven / changed / unknown)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'super-focus.html'), 'utf8');
  assert.ok(page.includes('render_provenance'), 'page consumes render provenance');
  assert.ok(page.includes('Render source: proven'), 'proven state copy');
  assert.ok(page.includes('differs from the image that produced this clip'), 'changed-since-render state copy');
  assert.ok(page.includes('Render source: unknown — no render-time record'), 'legacy unknown state copy');
  assert.ok(page.includes('Source image changed since this clip was rendered'), 'pre-review drift head warning');
});

test('video-attempts: attempt-storage UI is read-only — GET only, no nonce, textContent rendering', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'super-focus.html'), 'utf8');
  assert.ok(page.includes('id="vidattempts-report"'), 'report button present');
  assert.ok(page.includes('id="vidattempts-out"'), 'output panel present');
  const start = page.indexOf("getElementById('vidattempts-report').addEventListener");
  assert.ok(start !== -1, 'button is wired');
  const end = page.indexOf('---- Step 6', start);
  const slice = page.slice(start, end === -1 ? start + 4000 : end);
  assert.ok(slice.includes("'/api/super-focus/attempt-storage?id='"), 'wired to the audit GET');
  assert.ok(!/apiPost|method:\s*'POST'|localWriteNonce/.test(slice), 'no writes, no nonce — read-only');
  assert.ok(!/innerHTML/.test(slice), 'renders via textContent only');
  assert.ok(slice.includes('nothing is ever deleted here'), 'report-only copy');
});

test('video-attempts: docs describe attempts, staged sources, and completion ownership', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'super-focus.md'), 'utf8');
  assert.ok(doc.includes('video-attempts.json'));
  assert.ok(/attempts\/<attempt_id>\//.test(doc));
  assert.ok(doc.includes('Completion ownership'));
  assert.ok(doc.includes('reviewed_source_binding'));
});

// ── Dispatch races around the awaited PRESTO reach probe ─────────────────────
// The regenerate route awaits the reachability probe AFTER its pause and
// PRESTO-lock checks. Anything landing inside that await window (a poll-driven
// queue dispatch grabbing the lock, or an operator pause) must WIN — regenerate
// must re-check afterwards, exactly like batch generation does. Without the
// recheck, regenerate rewrites selected-images.json underneath a render that
// just started (corrupting its launch inputs) or starts a render while paused.

test('video-attempts: regenerate landing in the reach window never rewrites a running render’s launch inputs', async () => {
  let releaseReach;
  const gate = new Promise((r) => { releaseReach = r; });
  let reachCalls = 0;
  const reach = async () => {
    reachCalls += 1;
    if (reachCalls === 1) await gate; // first caller (the regenerate) stalls in the window
    return true;
  };
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 900, reach });
  try {
    // (1) Regenerate row 2 enters its reach await (lock free at its checks).
    const regenPromise = request(server, '/api/super-focus/regenerate-video', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 2 },
    });
    await waitFor(() => reachCalls >= 1);
    // (2) A queue dispatch for row 1 grabs the PRESTO lock inside the window.
    const q = await request(server, '/api/super-focus/queue-video', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 1 },
    });
    assert.equal(unwrap(q).enqueued, true);
    await waitFor(() => {
      const queue = superFocusMedia.readVideoQueue(id, { mediaRoot });
      return queue.items.some((it) => it.index === 1 && it.status === 'running');
    });
    const runningAttempt = Object.values(superFocusMedia.readVideoAttempts(id, { mediaRoot }).attempts)
      .find((a) => a.index === 1 && a.status === 'dispatched');
    assert.ok(runningAttempt, 'row 1 render dispatched with its attempt');
    // (3) Release the regenerate: it must refuse — the lock is held.
    releaseReach();
    const regen = await regenPromise;
    assert.equal(regen.statusCode, 409, 'regenerate refuses after the window');
    // (4) The running render's launch inputs were NOT rewritten...
    const sel = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, 'selected-images.json'), 'utf8'));
    assert.equal(sel.selections.length, 1);
    assert.equal(sel.selections[0].prompt_index, 1, 'selected-images.json still belongs to the running render');
    assert.equal(sel.selections[0].selected_path, runningAttempt.source.staged_rel, 'still points at the running attempt’s staged source');
    // ...and no attempt was minted (then cancelled) for the refused regenerate.
    const attempts = superFocusMedia.readVideoAttempts(id, { mediaRoot });
    assert.ok(!Object.values(attempts.attempts).some((a) => a.index === 2), 'no attempt churn for the refused regenerate');
    // Let the real render finish so the shared PRESTO lock is clean.
    await waitFor(() => {
      const queue = superFocusMedia.readVideoQueue(id, { mediaRoot });
      return queue.items.some((it) => it.index === 1 && it.status === 'done');
    }, 10000);
  } finally { await close(server); }
});

test('video-attempts: a pause landing in the regenerate reach window wins — no render starts while paused', async () => {
  let releaseReach;
  const gate = new Promise((r) => { releaseReach = r; });
  let reachCalls = 0;
  const reach = async () => {
    reachCalls += 1;
    if (reachCalls === 1) await gate;
    return true;
  };
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40, reach });
  try {
    const regenPromise = request(server, '/api/super-focus/regenerate-video', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 1 },
    });
    await waitFor(() => reachCalls >= 1);
    const paused = await request(server, '/api/super-focus/video-queue/pause', {
      method: 'POST', headers: writeHeaders(), body: { id, reason: 'operator pause during reach window' },
    });
    assert.equal(paused.statusCode, 200);
    releaseReach();
    const regen = await regenPromise;
    assert.equal(regen.statusCode, 409, 'pause wins over an in-flight regenerate');
    // The global job slot may hold a COMPLETED record from an earlier test;
    // the pause contract is about a RUNNING render for this project.
    const aj = packageEngineServer.PRESTO_STATE.activeJob;
    assert.ok(!aj || aj.completedAt || aj.packageId !== id, 'no render was started while paused');
    const attempts = superFocusMedia.readVideoAttempts(id, { mediaRoot });
    assert.deepEqual(attempts.attempts, {}, 'no attempt minted for the refused regenerate');
  } finally { await close(server); }
});

// ── Attempt storage audit (report-only) ──────────────────────────────────────

test('video-attempts: storage audit reports statuses, bytes, evidence locks, and cleanup candidates without writing', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    await queueAndFinish(server, id, mediaRoot, 1);
    const completed = completedAttemptFor(mediaRoot, id, 1);
    // A terminal non-completed attempt with staging on disk → cleanup candidate.
    const row2 = { index: 2, i2v_prompt: { text: I2V_TWO }, assignment_id: null };
    const ghost = superFocusMedia.createVideoAttempt(id, row2, { mediaRoot, subdir: VIDEO_SUBDIR });
    superFocusMedia.markVideoAttempt(id, ghost.attempt_id, 'cancelled', 'stopped_by_operator', { mediaRoot });
    // An orphan staging dir (no record) and a record with missing staging.
    fs.mkdirSync(path.join(mediaRoot, id, 'attempts', 'att-orphan-dir'), { recursive: true });
    const victim = superFocusMedia.createVideoAttempt(id, row2, { mediaRoot, subdir: VIDEO_SUBDIR });
    superFocusMedia.markVideoAttempt(id, victim.attempt_id, 'failed', 'render_failed', { mediaRoot });
    fs.rmSync(path.join(mediaRoot, id, victim.source.staged_rel));
    const before = fs.statSync(path.join(mediaRoot, id, 'video-attempts.json')).mtimeMs;
    const report = unwrap(await request(server, `/api/super-focus/attempt-storage?id=${id}`));
    assert.equal(report.policy, 'report_only');
    assert.equal(report.record_count, 3);
    assert.equal(report.by_status.completed, 1);
    assert.equal(report.by_status.cancelled, 1);
    assert.equal(report.by_status.failed, 1);
    assert.ok(report.evidence_locked.includes(completed.attempt_id), 'completed attempt is evidence-locked');
    assert.deepEqual(report.integrity.orphan_dirs, ['att-orphan-dir']);
    assert.deepEqual(report.integrity.missing_staged, [victim.attempt_id]);
    assert.equal(report.cleanup_candidates.length, 1, 'only the cancelled attempt with staging on disk is a candidate');
    assert.equal(report.cleanup_candidates[0].attempt_id, ghost.attempt_id);
    assert.ok(report.cleanup_candidate_bytes > 0);
    assert.ok(report.staged.bytes_on_disk >= report.cleanup_candidate_bytes);
    // Report-only: the audit wrote nothing and deleted nothing.
    assert.equal(fs.statSync(path.join(mediaRoot, id, 'video-attempts.json')).mtimeMs, before, 'audit never writes the attempts file');
    assert.ok(fs.existsSync(path.join(mediaRoot, id, ghost.source.staged_rel)), 'candidate staging is NOT deleted');
  } finally { await close(server); }
});

test('video-attempts: storage audit locks staging referenced by a review render binding', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    await queueAndFinish(server, id, mediaRoot, 1);
    const completed = completedAttemptFor(mediaRoot, id, 1);
    const vrPost = (action, body) => request(server, `/api/super-focus/video-review/${action}`, { method: 'POST', headers: writeHeaders(), body });
    const started = await vrPost('start', { id, index: 1 });
    assert.equal(started.statusCode, 200);
    const report = unwrap(await request(server, `/api/super-focus/attempt-storage?id=${id}`));
    assert.ok(report.evidence_locked.includes(completed.attempt_id), 'review-bound attempt is evidence-locked');
    assert.equal(report.cleanup_candidates.length, 0);
    // Unknown project → 404, not an empty report.
    const missing = await request(server, '/api/super-focus/attempt-storage?id=no-such-project');
    assert.equal(missing.statusCode, 404);
  } finally { await close(server); }
});

test('video-attempts: corrupt video-attempts.json reads as empty (unknown, never a crash or invented provenance)', async () => {
  const { server, mediaRoot, id } = await attemptServer({ delayMs: 40 });
  try {
    await queueAndFinish(server, id, mediaRoot, 1);
    fs.writeFileSync(path.join(mediaRoot, id, 'video-attempts.json'), '{ not json');
    const data = superFocusMedia.readVideoAttempts(id, { mediaRoot });
    assert.deepEqual(data, { version: 1, active: {}, attempts: {} });
    const g = unwrap(await request(server, `/api/super-focus/video-review?id=${id}`));
    assert.equal(g.reviews.find((r) => r.index === 1).render_provenance, null, 'unreadable provenance = unknown, not invented');
  } finally { await close(server); }
});
