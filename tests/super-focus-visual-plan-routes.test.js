const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocus = require('../super-focus.js');
const vp = require('../super-focus-visual-plan.js');

// ---- local helpers (mirror tests/super-focus.test.js patterns) ----
function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sf-vp-test-')); }
function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

function request(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : '';
  const baseHeaders = body
    ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    : {};
  const headers = { ...baseHeaders, ...(options.headers || {}) };
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
        try { parsed = JSON.parse(raw); } catch (_) { /* raw stays text */ }
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

const SCRIPT = [
  'More AI tools can make you less productive. Every tool adds an interface.',
  'Wan 2.2 renders fast. FLUX.1 makes the plates. DaVinci 21.0.2 is stable.',
  'One system beats five tools.',
].join('\n');

const FAKE_ASSIGNMENT = {
  viewer_task: 'Understand that more tools add coordination overhead.',
  visual_function: 'clarify',
  assignment: 'Show one creator inside an expanding web of tool panels.',
  acceptance_criteria: ['Readable in one second', 'Lower-right stays quiet'],
  media_type: 'image_to_video',
};

// Fake Ollama: answers visual-assignment requests with structured JSON and
// prompt-from-assignment requests with plain prompt text.
function smartFakeFetch() {
  return async (url, opts) => {
    const body = String((opts && opts.body) || '');
    const content = body.includes('not an image prompt')
      ? JSON.stringify(FAKE_ASSIGNMENT)
      : 'A grey Nordic studio desk overwhelmed by translucent floating interface panels, vertical composition.';
    return { ok: true, json: async () => ({ message: { content } }) };
  };
}
function brokenFakeFetch() {
  return async () => ({ ok: true, json: async () => ({ message: { content: 'not json at all' } }) });
}

async function projectServer(fetchImpl, { script = SCRIPT } = {}) {
  const root = mkRoot();
  const server = packageEngineServer.createServer(fetchImpl
    ? { superFocusRoot: root, fetchImpl } : { superFocusRoot: root });
  await listen(server);
  const created = superFocus.createProject({ title: 'VP Test' }, { root });
  if (script != null) superFocus.saveScript(created.project_id, script, { root });
  return { server, root, id: created.project_id };
}

async function post(server, action, body) {
  return request(server, `/api/super-focus/visual-plan/${action}`, {
    method: 'POST', headers: writeHeaders(), body,
  });
}

// ---- security ----

test('vp-routes: all mutations are nonce-gated; unknown action is 404; bad id rejected', async () => {
  const { server, id } = await projectServer(null);
  try {
    const bare = await request(server, '/api/super-focus/visual-plan/create-beats', {
      method: 'POST', body: { id },
    });
    assert.equal(bare.statusCode, 403, 'no nonce → 403');
    const unknown = await post(server, 'do-something-else', { id });
    assert.equal(unknown.statusCode, 404);
    const badId = await post(server, 'create-beats', { id: '../escape' });
    assert.equal(badId.statusCode, 400);
  } finally { await close(server); }
});

// ---- create-beats / GET / legacy ----

test('vp-routes: legacy project opens with visual_plan null and honest readiness', async () => {
  const { server, id } = await projectServer(null);
  try {
    const res = await request(server, `/api/super-focus/visual-plan?id=${id}`);
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.visual_plan, null);
    assert.equal(d.readiness.exists, false);
    assert.match(d.readiness.next_action, /Create beats/);
  } finally { await close(server); }
});

test('vp-routes: create-beats uses the SAVED script and keeps versions whole', async () => {
  const { server, id, root } = await projectServer(null);
  try {
    const res = await post(server, 'create-beats', { id });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.ok(d.visual_plan.beats.length >= 3);
    const texts = d.visual_plan.beats.map((b) => b.script_text);
    assert.ok(texts.some((t) => t.includes('Wan 2.2 renders fast.')));
    // Persisted: reload from disk.
    const state = superFocus.loadProject(id, { root });
    assert.ok(state.visual_plan && state.visual_plan.beats.length === d.visual_plan.beats.length);
    // Empty saved script → 400 (unsaved textarea can never reach the server).
    superFocus.saveScript(id, '', { root });
    const empty = await post(server, 'create-beats', { id, replace: true });
    assert.equal(empty.statusCode, 400);
  } finally { await close(server); }
});

// ---- generation slot safety through the route ----

test('vp-routes: generate-assignments fills only missing beats; failures persist nothing', async () => {
  const { server, id } = await projectServer(smartFakeFetch());
  try {
    await post(server, 'create-beats', { id });
    const gen = await post(server, 'generate-assignments', { id, batch: 2 });
    assert.equal(gen.statusCode, 200);
    const d = unwrap(gen);
    assert.equal(d.generated.length, 2);
    assert.equal(d.failures.length, 0);
    const drafted = d.visual_plan.assignments;
    assert.equal(drafted.length, 2);
    drafted.forEach((a) => {
      assert.equal(a.status, 'draft');
      assert.equal(a.created_by, 'local-model');
      assert.match(a.assignment_hash, /^[a-f0-9]{64}$/);
    });
    // Second run: previously generated beats are skipped, remaining beat fills.
    const gen2 = await post(server, 'generate-assignments', { id });
    const d2 = unwrap(gen2);
    assert.ok(d2.skipped.some((s) => /already exists/.test(s.reason)));
    const texts1 = drafted.map((a) => a.assignment).join('|');
    d2.visual_plan.assignments.slice(0, 2).forEach((a) => {
      assert.ok(texts1.includes(a.assignment), 'existing drafts unchanged');
    });
  } finally { await close(server); }
});

test('vp-routes: malformed model output fails that beat only, persists nothing for it', async () => {
  const { server, id } = await projectServer(brokenFakeFetch());
  try {
    await post(server, 'create-beats', { id });
    const gen = await post(server, 'generate-assignments', { id, batch: 1 });
    assert.equal(gen.statusCode, 200);
    const d = unwrap(gen);
    assert.equal(d.generated.length, 0);
    assert.equal(d.failures.length, 1);
    assert.equal(d.visual_plan.assignments.length, 0, 'nothing persisted');
  } finally { await close(server); }
});

// ---- approval workflow through routes ----

test('vp-routes: save/approve/revoke/reject/clear round trip', async () => {
  const { server, id } = await projectServer(null);
  try {
    await post(server, 'create-beats', { id });
    const plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const beat = plan.beats[0];
    const saved = unwrap(await post(server, 'save-assignment', Object.assign({ id, beat_id: beat.beat_id }, FAKE_ASSIGNMENT)));
    const a = saved.visual_plan.assignments[0];
    assert.equal(a.status, 'draft');
    assert.equal(a.created_by, 'operator');
    const approved = unwrap(await post(server, 'approve-assignment', { id, assignment_id: a.assignment_id }));
    assert.equal(approved.visual_plan.assignments[0].status, 'approved');
    // Approved cannot be edited through the route.
    const editBlocked = await post(server, 'save-assignment', Object.assign({ id, beat_id: beat.beat_id }, FAKE_ASSIGNMENT, { assignment: 'sneaky' }));
    assert.equal(editBlocked.statusCode, 409);
    const revoked = unwrap(await post(server, 'revoke-assignment', { id, assignment_id: a.assignment_id }));
    assert.equal(revoked.visual_plan.assignments[0].status, 'draft');
    const rejected = unwrap(await post(server, 'reject-assignment', { id, assignment_id: a.assignment_id }));
    assert.equal(rejected.visual_plan.assignments[0].status, 'rejected');
    const clearBlocked = await post(server, 'clear-assignment', { id, assignment_id: a.assignment_id });
    assert.equal(clearBlocked.statusCode, 409, 'rejected needs explicit confirmation');
    const cleared = unwrap(await post(server, 'clear-assignment', { id, assignment_id: a.assignment_id, confirm_rejected: true }));
    assert.equal(cleared.visual_plan.assignments.length, 0);
  } finally { await close(server); }
});

// ---- the approval gate + provenance ----

test('vp-routes: prompts only from approved assignments; skips reasoned; rows carry provenance; no overwrite', async () => {
  const { server, id, root } = await projectServer(smartFakeFetch());
  try {
    await post(server, 'create-beats', { id });
    let plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const [b1, b2, b3] = plan.beats;
    // b1: approved; b2: draft; b3: presenter-only.
    await post(server, 'save-assignment', Object.assign({ id, beat_id: b1.beat_id }, FAKE_ASSIGNMENT));
    plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const a1 = plan.assignments.find((a) => a.beat_id === b1.beat_id);
    await post(server, 'approve-assignment', { id, assignment_id: a1.assignment_id });
    await post(server, 'save-assignment', Object.assign({ id, beat_id: b2.beat_id }, FAKE_ASSIGNMENT, { assignment: 'Draft only.' }));
    await post(server, 'set-disposition', { id, beat_id: b3.beat_id, disposition: 'presenter_only' });

    const res = await request(server, '/api/super-focus/image-prompts/from-assignments', {
      method: 'POST', headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.placed.length, 1);
    const reasons = d.skipped.map((s) => s.reason).join('|');
    assert.match(reasons, /not approved yet/);
    assert.match(reasons, /Presenter only/);
    const row = d.image_prompts.find((r) => r.assignment_id === a1.assignment_id);
    assert.ok(row, 'prompt row carries assignment_id');
    assert.equal(row.assignment_hash, a1.assignment_hash);
    assert.equal(row.prompt_source, 'assignment');
    assert.match(row.prompt_hash, /^[a-f0-9]{64}$/);
    assert.equal(row.beat_id, b1.beat_id);

    // Running again does not duplicate or overwrite.
    const res2 = await request(server, '/api/super-focus/image-prompts/from-assignments', {
      method: 'POST', headers: writeHeaders(), body: { id },
    });
    const d2 = unwrap(res2);
    assert.equal(d2.placed.length, 0);
    assert.ok(d2.skipped.some((s) => /Prompt already exists/.test(s.reason)));
    const state = superFocus.loadProject(id, { root });
    assert.equal(state.image_prompts.filter((r) => r.assignment_id === a1.assignment_id).length, 1);
  } finally { await close(server); }
});

test('vp-routes: assignment edit marks the prompt stale; byte-identical revert clears it', async () => {
  const { server, id, root } = await projectServer(smartFakeFetch());
  try {
    await post(server, 'create-beats', { id });
    let plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const beat = plan.beats[0];
    await post(server, 'save-assignment', Object.assign({ id, beat_id: beat.beat_id }, FAKE_ASSIGNMENT));
    plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const a = plan.assignments[0];
    await post(server, 'approve-assignment', { id, assignment_id: a.assignment_id });
    await request(server, '/api/super-focus/image-prompts/from-assignments', {
      method: 'POST', headers: writeHeaders(), body: { id },
    });
    // Edit the assignment (revoke → save different content).
    await post(server, 'revoke-assignment', { id, assignment_id: a.assignment_id });
    await post(server, 'save-assignment', Object.assign({ id, beat_id: beat.beat_id }, FAKE_ASSIGNMENT, { assignment: 'A different visual job.' }));
    let state = superFocus.loadProject(id, { root });
    let row = state.image_prompts.find((r) => r.assignment_id === a.assignment_id);
    assert.equal(row.assignment_stale, true, 'edited assignment flags the prompt');
    assert.ok(row.text && row.text.trim(), 'prompt is preserved, not deleted');
    // Revert to byte-identical content → flag clears.
    await post(server, 'save-assignment', Object.assign({ id, beat_id: beat.beat_id }, FAKE_ASSIGNMENT));
    state = superFocus.loadProject(id, { root });
    row = state.image_prompts.find((r) => r.assignment_id === a.assignment_id);
    assert.ok(!row.assignment_stale, 'identical content resolves staleness by hash');
  } finally { await close(server); }
});

// ---- script-change staleness through routes ----

test('vp-routes: script change stales the plan, blocks mutation routes, reanchor recovers', async () => {
  const { server, id, root } = await projectServer(null);
  try {
    await post(server, 'create-beats', { id });
    superFocus.saveScript(id, `A new opening line.\n${SCRIPT}`, { root });
    const res = await request(server, `/api/super-focus/visual-plan?id=${id}`);
    const d = unwrap(res);
    assert.equal(d.visual_plan.stale, true);
    assert.match(d.readiness.next_action, /Re-anchor/);
    const plan = d.visual_plan;
    const blocked = await post(server, 'save-assignment', Object.assign({ id, beat_id: plan.beats[0].beat_id }, FAKE_ASSIGNMENT));
    assert.equal(blocked.statusCode, 409, 'mutations blocked on a stale plan');
    const re = await post(server, 'reanchor', { id });
    assert.equal(re.statusCode, 200);
    const rd = unwrap(re);
    assert.equal(rd.visual_plan.stale, false, 'all beats matched → fresh');
    rd.visual_plan.beats.forEach((b) => {
      assert.equal(`A new opening line.\n${SCRIPT}`.slice(b.start_char, b.end_char), b.script_text);
    });
  } finally { await close(server); }
});

// ---- readiness route ----

test('vp-routes: readiness endpoint reports counts and blockers', async () => {
  const { server, id } = await projectServer(null);
  try {
    await post(server, 'create-beats', { id });
    const res = await request(server, `/api/super-focus/visual-plan/readiness?id=${id}`);
    assert.equal(res.statusCode, 200);
    const r = unwrap(res).readiness;
    assert.equal(r.exists, true);
    assert.equal(r.ready, false);
    assert.ok(r.uncovered_beats > 0);
    assert.ok(Array.isArray(r.blockers) && r.blockers.length > 0);
  } finally { await close(server); }
});

// ---- HTML safety at the model boundary ----

test('vp-routes: script/HTML content in assignment fields is stored inert (no execution surface)', async () => {
  const { server, id, root } = await projectServer(null);
  try {
    await post(server, 'create-beats', { id });
    const plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const payload = Object.assign({ id, beat_id: plan.beats[0].beat_id }, FAKE_ASSIGNMENT, {
      assignment: '<script>alert(1)</script> Show the thing.',
      operator_notes: '"><img src=x onerror=alert(1)>',
    });
    const res = await post(server, 'save-assignment', payload);
    assert.equal(res.statusCode, 200);
    const state = superFocus.loadProject(id, { root });
    const a = state.visual_plan.assignments[0];
    // Stored verbatim as data (bounded string), never interpreted; the UI
    // renders via textContent (covered by the UI wiring test).
    assert.ok(a.assignment.includes('<script>'));
    assert.ok(vp.assignmentContentHash(a) === a.assignment_hash);
  } finally { await close(server); }
});

test('vp-routes: hand-editing a provenance prompt row keeps the assignment link and refreshes prompt_hash', async () => {
  const { server, id, root } = await projectServer(smartFakeFetch());
  try {
    await post(server, 'create-beats', { id });
    let plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    const beat = plan.beats[0];
    await post(server, 'save-assignment', Object.assign({ id, beat_id: beat.beat_id }, FAKE_ASSIGNMENT));
    plan = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).visual_plan;
    await post(server, 'approve-assignment', { id, assignment_id: plan.assignments[0].assignment_id });
    await request(server, '/api/super-focus/image-prompts/from-assignments', {
      method: 'POST', headers: writeHeaders(), body: { id },
    });
    let state = superFocus.loadProject(id, { root });
    const row = state.image_prompts.find((r) => r.assignment_id);
    const oldPromptHash = row.prompt_hash;
    // Operator hand-edits the prompt text through the normal per-row save.
    await request(server, '/api/super-focus/image-prompt', {
      method: 'POST', headers: writeHeaders(),
      body: { id, index: row.index, text: 'Hand-tuned prompt text, vertical.' },
    });
    state = superFocus.loadProject(id, { root });
    const edited = state.image_prompts.find((r) => r.index === row.index);
    assert.equal(edited.assignment_id, row.assignment_id, 'upstream link survives a hand edit');
    assert.equal(edited.assignment_hash, row.assignment_hash);
    assert.notEqual(edited.prompt_hash, oldPromptHash, 'prompt_hash follows the current text');
    assert.equal(edited.prompt_hash, superFocus.generatedPromptHash('Hand-tuned prompt text, vertical.'));
  } finally { await close(server); }
});
