const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocus = require('../super-focus.js');
const superFocusMedia = require('../super-focus-media.js');

// ---- helpers (established endpoint-test pattern) ----
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

const SCRIPT = 'One clear claim about tools.\nAnother clear claim about systems.';
const ASSIGN_FIELDS = {
  viewer_task: 'Understand the claim.',
  visual_function: 'clarify',
  assignment: 'Show the claim as one concrete scene.',
  acceptance_criteria: ['Readable in one second', 'Lower-right stays quiet'],
  media_type: 'image_to_video',
};
const I2V_TEXT = 'Slow deliberate push-in while panels appear one by one.';
const VIDEO_SUBDIR = 'mp4-hq-720p'; // PRESTO_PROFILE_OUTPUT_SUBDIRS[DEFAULT_PRESTO_PROFILE]

// Tiny deterministic fixtures — arbitrary bytes; nothing decodes them and no
// generation service is ever involved.
function writeImageFixture(mediaRoot, projectId, index, bytes) {
  const dir = path.join(mediaRoot, projectId, 'images', 'flux-local');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `flux-${String(index).padStart(3, '0')}.png`), bytes);
}
function writeVideoFixture(mediaRoot, projectId, index, bytes) {
  const dir = path.join(mediaRoot, projectId, 'videos', VIDEO_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${String(index).padStart(3, '0')}.mp4`);
  fs.writeFileSync(p, bytes);
  return p;
}

async function irPost(server, action, body) {
  return request(server, `/api/super-focus/image-review/${action}`, { method: 'POST', headers: writeHeaders(), body });
}
async function vrPost(server, action, body) {
  return request(server, `/api/super-focus/video-review/${action}`, { method: 'POST', headers: writeHeaders(), body });
}
async function vrGet(server, id) {
  return unwrap(await request(server, `/api/super-focus/video-review?id=${id}`));
}

// Full upstream chain: approved assignment -> provenance prompt row ->
// approved image review -> i2v prompt -> video fixture + generation provenance.
async function videoReviewServer() {
  const root = mkdirTmp('sf-vr-root-');
  const mediaRoot = mkdirTmp('sf-vr-media-');
  const server = packageEngineServer.createServer({ superFocusRoot: root, superFocusMediaRoot: mediaRoot });
  await listen(server);
  const proj = superFocus.createProject({ title: 'VR Routes' }, { root });
  const id = proj.project_id;
  superFocus.saveScript(id, SCRIPT, { root });
  const vpPost = (action, body) => request(server, `/api/super-focus/visual-plan/${action}`, { method: 'POST', headers: writeHeaders(), body: Object.assign({ id }, body) });
  await vpPost('create-beats', {});
  let plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
  const beat = plan.beats[0];
  await vpPost('save-assignment', Object.assign({ beat_id: beat.beat_id }, ASSIGN_FIELDS));
  plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
  const assignment = plan.assignments[0];
  await vpPost('approve-assignment', { assignment_id: assignment.assignment_id });
  superFocus.fillPromptsFromAssignments(id, [{ text: 'A concrete scene prompt.', assignment }], { root });
  writeImageFixture(mediaRoot, id, 1, Buffer.from('image-bytes-1'));
  // Approve the image review (upstream currency).
  const started = unwrap(await irPost(server, 'start', { id, index: 1 }));
  for (const c of started.criteria) {
    await irPost(server, 'set-criterion', { id, index: 1, criterion_hash: c.criterion_hash, result: 'pass' });
  }
  await irPost(server, 'approve', { id, index: 1 });
  // I2V prompt + video fixture + generation provenance (committed lane API).
  superFocus.setI2vPrompt(id, 1, I2V_TEXT, { root });
  writeVideoFixture(mediaRoot, id, 1, Buffer.from('video-bytes-ORIGINAL'));
  superFocusMedia.writeVideoProvenance(id, { 1: { i2v_hash: superFocusMedia.i2vPromptHash(I2V_TEXT) } }, { mediaRoot });
  return { server, root, mediaRoot, id, assignment, beat, vpPost };
}

async function fullApproveVideo(server, id) {
  const started = unwrap(await vrPost(server, 'start', { id, index: 1 }));
  for (const c of started.criteria) {
    await vrPost(server, 'set-criterion', { id, index: 1, criterion_hash: c.criterion_hash, result: 'pass' });
  }
  await vrPost(server, 'set-usable-range', { id, index: 1, usable_range: { full_clip: true } });
  return unwrap(await vrPost(server, 'approve', { id, index: 1 }));
}

// ---- security ----

test('video-review routes: nonce required; unknown action 404; bad id/index rejected; notes inert', async () => {
  const { server, id } = await videoReviewServer();
  try {
    const bare = await request(server, '/api/super-focus/video-review/start', { method: 'POST', body: { id, index: 1 } });
    assert.equal(bare.statusCode, 403);
    assert.equal((await vrPost(server, 'transcode', { id, index: 1 })).statusCode, 404);
    assert.equal((await vrPost(server, 'start', { id: '../escape', index: 1 })).statusCode, 400);
    assert.equal((await vrPost(server, 'start', { id, index: 42 })).statusCode, 404);
    await vrPost(server, 'start', { id, index: 1 });
    const notes = await vrPost(server, 'save-notes', { id, index: 1, notes: '<script>alert(1)</script> ok' });
    assert.equal(notes.statusCode, 200);
    assert.ok(unwrap(notes).review.operator_notes.includes('<script>'));
  } finally { await close(server); }
});

// ---- lifecycle through routes ----

test('video-review routes: full chain — start, criteria, range, approve; edit-eligible only then', async () => {
  const { server, id } = await videoReviewServer();
  try {
    let g = await vrGet(server, id);
    let row = g.reviews.find((r) => r.index === 1);
    assert.equal(row.video_exists, true);
    assert.equal(row.image_review_status, 'approved');
    assert.equal(row.effective_status, 'not_reviewed');
    assert.equal(row.edit.eligible, false);
    assert.match(row.edit.reasons.join('|'), /review not started/i);
    const started = unwrap(await vrPost(server, 'start', { id, index: 1 }));
    assert.equal(started.effective_status, 'in_review');
    assert.ok(started.criteria.length >= 15, 'assignment + motion + technical criteria');
    // Approve blocked until everything reviewed + range set.
    assert.equal((await vrPost(server, 'approve', { id, index: 1 })).statusCode, 409);
    const done = await fullApproveVideo(server, id);
    assert.equal(done.effective_status, 'approved');
    assert.equal(done.edit.eligible, true);
    g = await vrGet(server, id);
    assert.equal(g.readiness.ready_for_edit, 1);
  } finally { await close(server); }
});

test('video-review routes: usable range validates against browser-observed duration', async () => {
  const { server, id } = await videoReviewServer();
  try {
    await vrPost(server, 'start', { id, index: 1 });
    const bad = await vrPost(server, 'set-usable-range', { id, index: 1, usable_range: { start_seconds: 1, end_seconds: 99 }, observed_duration_seconds: 5.0 });
    assert.equal(bad.statusCode, 400);
    const nan = await vrPost(server, 'set-usable-range', { id, index: 1, usable_range: { start_seconds: 'x', end_seconds: 2 } });
    assert.equal(nan.statusCode, 400);
    const ok = await vrPost(server, 'set-usable-range', { id, index: 1, usable_range: { start_seconds: 0.4, end_seconds: 4.6 }, observed_duration_seconds: 5.0 });
    assert.equal(ok.statusCode, 200);
    assert.equal(unwrap(ok).review.usable_range.duration_seconds, 5);
  } finally { await close(server); }
});

test('video-review routes: fail blocks approve; override needs reason and records; reject preserves file', async () => {
  const { server, mediaRoot, id } = await videoReviewServer();
  try {
    const started = unwrap(await vrPost(server, 'start', { id, index: 1 }));
    const [c1, ...rest] = started.criteria;
    await vrPost(server, 'set-criterion', { id, index: 1, criterion_hash: c1.criterion_hash, result: 'fail', note: 'melted frame' });
    for (const c of rest) await vrPost(server, 'set-criterion', { id, index: 1, criterion_hash: c.criterion_hash, result: 'pass' });
    await vrPost(server, 'set-usable-range', { id, index: 1, usable_range: { start_seconds: 1, end_seconds: 4 }, observed_duration_seconds: 5 });
    assert.equal((await vrPost(server, 'approve', { id, index: 1 })).statusCode, 409);
    assert.equal((await vrPost(server, 'approve-override', { id, index: 1, reason: '' })).statusCode, 400);
    const over = unwrap(await vrPost(server, 'approve-override', { id, index: 1, reason: 'Range excludes the melted frame.' }));
    assert.equal(over.review.override, true);
    assert.deepEqual(over.review.overridden_criteria, [c1.criterion_hash]);
    await vrPost(server, 'revoke', { id, index: 1 });
    const rej = unwrap(await vrPost(server, 'reject', { id, index: 1, reason: 'not good enough' }));
    assert.equal(rej.effective_status, 'rejected');
    const clip = path.join(mediaRoot, id, 'videos', VIDEO_SUBDIR, '001.mp4');
    assert.ok(fs.existsSync(clip), 'rejected clip preserved on disk');
    assert.equal(rej.edit.eligible, false);
  } finally { await close(server); }
});

// ---- staleness through routes ----

test('video-review routes: video byte replacement invalidates; identical restoration resolves', async () => {
  const { server, mediaRoot, id } = await videoReviewServer();
  try {
    await fullApproveVideo(server, id);
    writeVideoFixture(mediaRoot, id, 1, Buffer.from('video-bytes-DIFFERENT'));
    let row = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'review_required');
    assert.ok(row.mismatches.includes('video_changed'));
    assert.equal(row.usable_range_current, false, 'range stales with bytes');
    assert.equal(row.edit.eligible, false);
    writeVideoFixture(mediaRoot, id, 1, Buffer.from('video-bytes-ORIGINAL'));
    row = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'approved', 'byte-identical restore resolves by real hash');
    assert.equal(row.edit.eligible, true);
  } finally { await close(server); }
});

test('video-review routes: i2v prompt edit → historical approval, prompt_mismatch, blocked eligibility', async () => {
  const { server, root, id } = await videoReviewServer();
  try {
    await fullApproveVideo(server, id);
    superFocus.setI2vPrompt(id, 1, 'A completely different camera move.', { root });
    const row = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'review_required');
    assert.ok(row.mismatches.includes('prompt_mismatch'));
    assert.match(row.reasons.join('|'), /historical, not current/);
    assert.equal(row.edit.eligible, false);
    assert.ok(row.review, 'review record preserved, not cleared');
    // Restore the identical text → currentness resolves.
    superFocus.setI2vPrompt(id, 1, I2V_TEXT, { root });
    const row2 = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row2.effective_status, 'approved');
  } finally { await close(server); }
});

test('video-review routes: image approval revoked blocks edit eligibility, video approval stays recorded', async () => {
  const { server, id } = await videoReviewServer();
  try {
    await fullApproveVideo(server, id);
    await irPost(server, 'revoke', { id, index: 1 }); // upstream image approval revoked
    const row = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'approved', 'video review record intact');
    assert.equal(row.edit.eligible, false);
    assert.match(row.edit.reasons.join('|'), /Source image is no longer approved/);
  } finally { await close(server); }
});

test('video-review routes: assignment edit stales; byte-identical revert resolves', async () => {
  const { server, id, beat, vpPost } = await videoReviewServer();
  try {
    await fullApproveVideo(server, id);
    const plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const a = plan.assignments[0];
    await vpPost('revoke-assignment', { assignment_id: a.assignment_id });
    await vpPost('save-assignment', Object.assign({ id, beat_id: beat.beat_id }, ASSIGN_FIELDS, { assignment: 'Different scene.' }));
    let row = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'review_required');
    await vpPost('save-assignment', Object.assign({ id, beat_id: beat.beat_id }, ASSIGN_FIELDS));
    row = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'approved');
  } finally { await close(server); }
});

// ---- stable identity ----

test('video-review routes: slot refill does not inherit approval; reused filename with new bytes stays blocked', async () => {
  const { server, mediaRoot, id } = await videoReviewServer();
  try {
    await fullApproveVideo(server, id);
    // Clear the prompt slot, refill at the same index — same video filename.
    await request(server, '/api/super-focus/image-prompt', { method: 'POST', headers: writeHeaders(), body: { id, index: 1, text: '' } });
    await request(server, '/api/super-focus/image-prompt', { method: 'POST', headers: writeHeaders(), body: { id, index: 1, text: 'Brand new prompt, same slot.' } });
    let row = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.notEqual(row.effective_status, 'approved', 'refilled slot must not inherit video approval');
    // Different bytes under the SAME filename never inherit approval either.
    writeVideoFixture(mediaRoot, id, 1, Buffer.from('video-bytes-IMPOSTOR'));
    row = (await vrGet(server, id)).reviews.find((r) => r.index === 1);
    assert.notEqual(row.effective_status, 'approved');
  } finally { await close(server); }
});

test('video-review routes: legacy clip (no provenance) is unknown_legacy; compatibility labeled, not approval', async () => {
  const { server, root, mediaRoot, id } = await videoReviewServer();
  try {
    superFocus.saveImagePrompt(id, 2, 'Legacy prompt with no provenance.', { root });
    superFocus.setI2vPrompt(id, 2, 'legacy motion', { root });
    writeImageFixture(mediaRoot, id, 2, Buffer.from('legacy-image'));
    writeVideoFixture(mediaRoot, id, 2, Buffer.from('legacy-video'));
    const row = (await vrGet(server, id)).reviews.find((r) => r.index === 2);
    assert.equal(row.effective_status, 'unknown_legacy');
    assert.equal(row.edit.eligible, true);
    assert.equal(row.edit.compatibility, true);
    assert.match(row.edit.reasons[0], /not an approval/);
  } finally { await close(server); }
});

// ---- no PRESTO / no generation from review actions ----

test('video-review routes: review actions never start jobs or contact PRESTO', async () => {
  const { server, id } = await videoReviewServer();
  try {
    await fullApproveVideo(server, id);
    const vs = unwrap(await request(server, `/api/super-focus/videos-status?id=${id}`));
    const ist = unwrap(await request(server, `/api/super-focus/images-status?id=${id}`));
    assert.ok(!(vs.job || {}).active, 'no video job');
    assert.ok(!(ist.job || {}).active, 'no image job');
  } finally { await close(server); }
});
