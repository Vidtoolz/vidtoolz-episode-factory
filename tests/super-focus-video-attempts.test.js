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
    prestoReachableCheck: async () => true,
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
