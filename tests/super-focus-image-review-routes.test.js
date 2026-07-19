const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocus = require('../super-focus.js');
const ir = require('../super-focus-image-review.js');

// ---- helpers (mirror the established endpoint-test pattern) ----
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

// Fixture "image": arbitrary bytes — no generation service is ever involved.
function writeImageFixture(mediaRoot, projectId, index, bytes) {
  const dir = path.join(mediaRoot, projectId, 'images', 'flux-local');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `flux-${String(index).padStart(3, '0')}.png`), bytes);
}

async function reviewServer() {
  const root = mkdirTmp('sf-ir-root-');
  const mediaRoot = mkdirTmp('sf-ir-media-');
  const server = packageEngineServer.createServer({ superFocusRoot: root, superFocusMediaRoot: mediaRoot });
  await listen(server);
  const proj = superFocus.createProject({ title: 'IR Routes' }, { root });
  const id = proj.project_id;
  superFocus.saveScript(id, SCRIPT, { root });
  // Visual plan: beats + one approved assignment on beat 1.
  const vpPost = (action, body) => request(server, `/api/super-focus/visual-plan/${action}`, { method: 'POST', headers: writeHeaders(), body: Object.assign({ id }, body) });
  await vpPost('create-beats', {});
  let plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
  const beat = plan.beats[0];
  await vpPost('save-assignment', Object.assign({ beat_id: beat.beat_id }, ASSIGN_FIELDS));
  plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
  const assignment = plan.assignments[0];
  await vpPost('approve-assignment', { assignment_id: assignment.assignment_id });
  // Prompt row 1 carries assignment provenance (hand-attach via slot save +
  // provenance fill to avoid any model dependency in this fixture).
  const { placed } = { placed: null }; void placed;
  superFocus.fillPromptsFromAssignments(id, [{ text: 'A concrete scene prompt.', assignment }], { root });
  // Row 2: legacy prompt with no provenance.
  superFocus.saveImagePrompt(id, 2, 'A legacy prompt with no provenance.', { root });
  return { server, root, mediaRoot, id, assignment, beat, vpPost };
}

async function irPost(server, action, body) {
  return request(server, `/api/super-focus/image-review/${action}`, { method: 'POST', headers: writeHeaders(), body });
}
async function irGet(server, id) {
  return unwrap(await request(server, `/api/super-focus/image-review?id=${id}`));
}
async function fullApprove(server, id) {
  const started = unwrap(await irPost(server, 'start', { id, index: 1 }));
  for (const c of started.criteria) {
    await irPost(server, 'set-criterion', { id, index: 1, criterion_hash: c.criterion_hash, result: 'pass' });
  }
  return unwrap(await irPost(server, 'approve', { id, index: 1 }));
}

// ---- security ----

test('image-review routes: nonce required, unknown action 404, bad id/index rejected', async () => {
  const { server, mediaRoot, id } = await reviewServer();
  try {
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-1'));
    const bare = await request(server, '/api/super-focus/image-review/start', { method: 'POST', body: { id, index: 1 } });
    assert.equal(bare.statusCode, 403);
    assert.equal((await irPost(server, 'do-anything', { id, index: 1 })).statusCode, 404);
    assert.equal((await irPost(server, 'start', { id: '../escape', index: 1 })).statusCode, 400);
    assert.equal((await irPost(server, 'start', { id, index: 99 })).statusCode, 404);
    // Script content in notes stays inert data.
    await irPost(server, 'start', { id, index: 1 });
    const notes = await irPost(server, 'save-notes', { id, index: 1, notes: '<script>alert(1)</script> fine otherwise' });
    assert.equal(notes.statusCode, 200);
    assert.ok(unwrap(notes).review.operator_notes.includes('<script>'));
  } finally { await close(server); }
});

// ---- lifecycle through routes ----

test('image-review routes: start requires a real image (409); GET reflects effective states', async () => {
  const { server, mediaRoot, id } = await reviewServer();
  try {
    const blocked = await irPost(server, 'start', { id, index: 1 });
    assert.equal(blocked.statusCode, 409, 'no image on disk yet');
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-1'));
    writeImageFixture(mediaRoot, id, 2, Buffer.from('png-bytes-2'));
    const started = await irPost(server, 'start', { id, index: 1 });
    assert.equal(started.statusCode, 200);
    const d = unwrap(started);
    assert.equal(d.effective_status, 'in_review');
    assert.equal(d.criteria.length, 2);
    const g = await irGet(server, id);
    const row1 = g.reviews.find((r) => r.index === 1);
    const row2 = g.reviews.find((r) => r.index === 2);
    assert.equal(row1.effective_status, 'in_review');
    assert.equal(row2.effective_status, 'unknown_legacy', 'legacy row is unknown, not failed');
    assert.equal(row2.gate.eligible, true, 'legacy compatibility mode');
    assert.match(row2.gate.reason, /Legacy/);
  } finally { await close(server); }
});

test('image-review routes: criteria gate approval; fail blocks; override needs reason; reject preserves', async () => {
  const { server, mediaRoot, id } = await reviewServer();
  try {
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-1'));
    const started = unwrap(await irPost(server, 'start', { id, index: 1 }));
    const [c1, c2] = started.criteria;
    // Bad enum + unknown criterion hash rejected.
    assert.equal((await irPost(server, 'set-criterion', { id, index: 1, criterion_hash: c1.criterion_hash, result: 'meh' })).statusCode, 400);
    assert.equal((await irPost(server, 'set-criterion', { id, index: 1, criterion_hash: 'a'.repeat(64), result: 'pass' })).statusCode, 409);
    // Unreviewed criteria block approve.
    assert.equal((await irPost(server, 'approve', { id, index: 1 })).statusCode, 409);
    await irPost(server, 'set-criterion', { id, index: 1, criterion_hash: c1.criterion_hash, result: 'fail', note: 'busy corner' });
    await irPost(server, 'set-criterion', { id, index: 1, criterion_hash: c2.criterion_hash, result: 'pass' });
    assert.equal((await irPost(server, 'approve', { id, index: 1 })).statusCode, 409, 'fail blocks normal approve');
    assert.equal((await irPost(server, 'approve-override', { id, index: 1, reason: '' })).statusCode, 400);
    const over = unwrap(await irPost(server, 'approve-override', { id, index: 1, reason: 'Corner acceptable for this beat.' }));
    assert.equal(over.effective_status, 'approved');
    assert.equal(over.review.override, true);
    // Revoke → reject → image and results preserved on disk + in state.
    await irPost(server, 'revoke', { id, index: 1 });
    const rejected = unwrap(await irPost(server, 'reject', { id, index: 1, reason: 'Not communicating the claim.' }));
    assert.equal(rejected.effective_status, 'rejected');
    assert.ok(fs.existsSync(path.join(mediaRoot, id, 'images', 'flux-local', 'flux-001.png')), 'image preserved');
    assert.equal(rejected.review.criteria.find((c) => c.criterion_hash === c1.criterion_hash).result, 'fail');
  } finally { await close(server); }
});

// ---- staleness through routes ----

test('image-review routes: image byte change → review_required; byte-identical restore → approved', async () => {
  const { server, mediaRoot, id } = await reviewServer();
  try {
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-original'));
    await fullApprove(server, id);
    // Replace bytes → stale.
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-DIFFERENT'));
    let g = await irGet(server, id);
    let row = g.reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'review_required');
    assert.equal(row.gate.eligible, false);
    assert.match(row.gate.reason, /stale/i);
    // Restore identical bytes → approval current again (hash-proven).
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-original'));
    g = await irGet(server, id);
    row = g.reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'approved');
    assert.equal(row.gate.eligible, true);
  } finally { await close(server); }
});

test('image-review routes: assignment edit → review_required; byte-identical revert → approved', async () => {
  const { server, mediaRoot, id, beat, vpPost } = await reviewServer();
  try {
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-1'));
    await fullApprove(server, id);
    const plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const a = plan.assignments[0];
    await vpPost('revoke-assignment', { assignment_id: a.assignment_id });
    await vpPost('save-assignment', Object.assign({ beat_id: beat.beat_id }, ASSIGN_FIELDS, { assignment: 'A different scene.' }));
    let row = (await irGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'review_required');
    assert.match(row.reasons.join('|'), /assignment changed/i);
    await vpPost('save-assignment', Object.assign({ beat_id: beat.beat_id }, ASSIGN_FIELDS));
    row = (await irGet(server, id)).reviews.find((r) => r.index === 1);
    assert.equal(row.effective_status, 'approved', 'byte-identical assignment restores currentness');
  } finally { await close(server); }
});

test('image-review routes: criterion edit reopens only that criterion via reopen', async () => {
  const { server, mediaRoot, id, beat, vpPost } = await reviewServer();
  try {
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-1'));
    await fullApprove(server, id);
    const plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    await vpPost('revoke-assignment', { assignment_id: plan.assignments[0].assignment_id });
    await vpPost('save-assignment', Object.assign({ beat_id: beat.beat_id }, ASSIGN_FIELDS, {
      acceptance_criteria: ['Readable in one second', 'Lower-right is COMPLETELY empty'],
    }));
    await vpPost('approve-assignment', { assignment_id: plan.assignments[0].assignment_id });
    const reopened = unwrap(await irPost(server, 'reopen', { id, index: 1 }));
    const kept = reopened.review.criteria.find((c) => c.criterion_text === 'Readable in one second');
    const fresh = reopened.review.criteria.find((c) => /COMPLETELY empty/.test(c.criterion_text));
    assert.equal(kept.result, 'pass', 'unchanged criterion decision carried');
    assert.equal(fresh.result, 'unreviewed', 'changed criterion restarts');
  } finally { await close(server); }
});

// ---- stable identity ----

test('image-review routes: slot refill does not inherit approval; re-anchor keeps binding', async () => {
  const { server, root, mediaRoot, id } = await reviewServer();
  try {
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-1'));
    await fullApprove(server, id);
    // Clear the prompt slot (drops the row), then refill the same index.
    await request(server, '/api/super-focus/image-prompt', { method: 'POST', headers: writeHeaders(), body: { id, index: 1, text: '' } });
    await request(server, '/api/super-focus/image-prompt', { method: 'POST', headers: writeHeaders(), body: { id, index: 1, text: 'A brand new unrelated prompt.' } });
    const row = (await irGet(server, id)).reviews.find((r) => r.index === 1);
    assert.notEqual(row.effective_status, 'approved', 'refilled slot must not inherit approval');
    // Re-anchor the plan after a script shift: review binding is by
    // assignment_id + hashes, so an approved review elsewhere stays put.
    superFocus.saveScript(id, `New opening line.\n${SCRIPT}`, { root });
    const re = await request(server, '/api/super-focus/visual-plan/reanchor', { method: 'POST', headers: writeHeaders(), body: { id } });
    assert.equal(re.statusCode, 200);
  } finally { await close(server); }
});

// ---- I2V gate through video routes ----

test('image-review routes: video dispatch gate — unreviewed blocked, approved allowed, legacy compatible', async () => {
  const { server, root, mediaRoot, id } = await reviewServer();
  try {
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-1'));
    writeImageFixture(mediaRoot, id, 2, Buffer.from('png-bytes-2'));
    superFocus.setI2vPrompt(id, 1, 'Slow deliberate motion.', { root });
    superFocus.setI2vPrompt(id, 2, 'Slow deliberate motion too.', { root });
    // Row 1 (provenance, unreviewed) → queue-video refuses with reason; row 2 (legacy) → passes the gate.
    const q1 = unwrap(await request(server, '/api/super-focus/queue-video', { method: 'POST', headers: writeHeaders(), body: { id, index: 1 } }));
    assert.equal(q1.enqueued, false);
    assert.match(q1.skipped[0].reason, /review not started/i);
    // Reject row 1 → still blocked, different reason.
    await irPost(server, 'start', { id, index: 1 });
    await irPost(server, 'reject', { id, index: 1, reason: 'no' });
    const q2 = unwrap(await request(server, '/api/super-focus/queue-video', { method: 'POST', headers: writeHeaders(), body: { id, index: 1 } }));
    assert.equal(q2.enqueued, false);
    assert.match(q2.skipped[0].reason, /rejected/i);
    // Approve row 1 → the GATE passes (dispatch itself is not exercised here:
    // no generation may run in tests; gate truth comes from the GET).
    await irPost(server, 'reopen', { id, index: 1 });
    const started = (await irGet(server, id)).reviews.find((r) => r.index === 1);
    for (const c of started.criteria) {
      await irPost(server, 'set-criterion', { id, index: 1, criterion_hash: c.criterion_hash, result: 'pass' });
    }
    await irPost(server, 'approve', { id, index: 1 });
    const g = await irGet(server, id);
    assert.equal(g.reviews.find((r) => r.index === 1).gate.eligible, true);
    assert.equal(g.reviews.find((r) => r.index === 2).gate.eligible, true, 'legacy row compatible');
    assert.equal(g.readiness.ready_for_i2v, 2);
  } finally { await close(server); }
});

// ---- readiness ----

test('image-review routes: readiness counts + next action never suggest video for unapproved', async () => {
  const { server, mediaRoot, id } = await reviewServer();
  try {
    writeImageFixture(mediaRoot, id, 1, Buffer.from('png-bytes-1'));
    const g = await irGet(server, id);
    assert.equal(g.readiness.images_present, 1);
    assert.equal(g.readiness.images_not_reviewed, 1);
    assert.match(g.readiness.next_action, /Review image 1/);
    assert.ok(!/video/i.test(g.readiness.blockers.join('|')));
  } finally { await close(server); }
});

// ---- UI wiring (static page assertions) ----

test('image-review UI: review block wired safely into image rows', async () => {
  const { server } = await reviewServer();
  try {
    const res = await request(server, '/super-focus.html');
    assert.equal(res.statusCode, 200);
    assert.match(res.raw, /IREV_API = '\/api\/super-focus\/image-review'/);
    assert.match(res.raw, /function buildReviewBlock\(/);
    assert.match(res.raw, /function decorateImageReviews\(/);
    // Safe DOM: criterion + notes text rendered via textContent, never innerHTML.
    assert.match(res.raw, /t\.className = 'ctext'; t\.textContent = c\.criterion_text/);
    const irevSection = res.raw.slice(
      res.raw.indexOf('---- Image review (evidence'),
      res.raw.indexOf("document.getElementById('vp-create-beats').addEventListener")
    );
    assert.ok(irevSection.length > 1000, 'review section found');
    assert.ok(!irevSection.includes('.innerHTML'), 'no innerHTML at all in the review UI section');
    // Human-readable badges incl. legacy wording; override visually distinct + confirmed.
    assert.match(res.raw, /Legacy — review provenance unknown/);
    assert.match(res.raw, /Approve with override…/);
    assert.match(res.raw, /recorded as an override/);
    // Presenter-safe overlay is a toggleable review aid.
    assert.match(res.raw, /Show presenter-safe area/);
    assert.match(res.raw, /irev-overlay/);
    // Normal approve disabled while blockers exist.
    assert.match(res.raw, /ap\.disabled = !canApprove/);
  } finally { await close(server); }
});
