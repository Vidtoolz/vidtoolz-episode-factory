const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocus = require('../super-focus.js');

// Kanban ↔ EF identity bridge tests. The Kanban HTTP boundary is stubbed with
// an in-memory fake (same shapes as the real server: GET /api/state →
// { revision, cards }, PATCH /api/cards/:id with revision check); Super Focus
// state uses temp roots. No real network, no real Kanban server.

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

// In-memory Kanban stub matching the real server's API surface:
//   GET /api/state          -> { revision, cards }
//   PATCH /api/cards/:id    -> revision-checked metadata/title/notes update
// options.failFirstPatchWith409: first PATCH rejects stale_revision once.
// options.alwaysFailPatch: { statusCode, message, code } every PATCH rejects.
function makeKanbanStub(cards, options = {}) {
  const state = {
    revision: 7,
    cards: cards.map((c) => ({
      ...c,
      id: c.id,
      title: c.title || 'Card',
      stage: c.stage || 'idea_claim',
      metadata: Object.assign({}, c.metadata || {}),
    })),
  };
  const calls = [];
  let firstPatchFailed = false;
  const fn = async (method, p, body) => {
    calls.push({ method, path: p, body });
    if (method === 'GET' && p === '/api/state') {
      return { revision: state.revision, cards: state.cards };
    }
    const m = /^\/api\/cards\/([^/]+)$/.exec(p);
    if (method === 'PATCH' && m) {
      if (options.failFirstPatchWith409 && !firstPatchFailed) {
        firstPatchFailed = true;
        const e = new Error('The board changed after this client loaded it.');
        e.statusCode = 409;
        e.code = 'stale_revision';
        throw e;
      }
      if (options.alwaysFailPatch) {
        const e = new Error(options.alwaysFailPatch.message || 'Kanban write failed.');
        e.statusCode = options.alwaysFailPatch.statusCode || 500;
        e.code = options.alwaysFailPatch.code || null;
        throw e;
      }
      const id = decodeURIComponent(m[1]);
      const card = state.cards.find((c) => c.id === id);
      if (!card) {
        const e = new Error(`No card with id "${id}".`);
        e.statusCode = 404;
        e.code = 'card_not_found';
        throw e;
      }
      if (!body || !Number.isInteger(body.revision) || body.revision !== state.revision) {
        const e = new Error('The board changed after this client loaded it.');
        e.statusCode = 409;
        e.code = 'stale_revision';
        throw e;
      }
      if (body.metadata !== undefined) card.metadata = body.metadata;
      state.revision += 1;
      return { card };
    }
    const e = new Error('Unknown API endpoint.');
    e.statusCode = 404;
    e.code = 'not_found';
    throw e;
  };
  return { fn, state, calls };
}

async function bridgeServer(stub) {
  const root = mkdirTmp('kanban-bridge-root-');
  const mediaRoot = mkdirTmp('kanban-bridge-media-');
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    kanbanRequest: stub.fn,
  });
  await listen(server);
  return { server, root, mediaRoot };
}

function link(server, body) {
  return request(server, '/api/super-focus/bridge/link', {
    method: 'POST',
    headers: writeHeaders(),
    body,
  });
}

// ── Happy paths ───────────────────────────────────────────────────────────

test('kanban bridge: fresh link creates project, links both sides, preserves card metadata', async () => {
  const stub = makeKanbanStub([{ id: 'card-1', title: 'Video idea', metadata: { claimId: 'claim-9' } }]);
  const { server, root } = await bridgeServer(stub);
  try {
    const res = await link(server, { kanban_card_id: 'card-1', title: 'My Video' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    const data = unwrap(res);
    assert.equal(data.linked, 'created');
    assert.equal(data.kanban_card_id, 'card-1');
    assert.ok(data.project_id, 'project_id returned');
    // EF side points at the card.
    const project = superFocus.loadProject(data.project_id, { root });
    assert.equal(project.kanban_card_id, 'card-1');
    assert.equal(project.title, 'My Video');
    // Kanban side points at the project; existing metadata keys preserved.
    const card = stub.state.cards.find((c) => c.id === 'card-1');
    assert.equal(card.metadata.ef_project_id, data.project_id);
    assert.equal(card.metadata.claimId, 'claim-9');
    // The PATCH carried the client's known revision.
    const patch = stub.calls.find((c) => c.method === 'PATCH');
    assert.equal(patch.body.revision, 7);
  } finally {
    await close(server);
  }
});

test('kanban bridge: authoritative Mindmap source survives project creation and reload', async () => {
  const stub = makeKanbanStub([{
    id: 'card-source', title: 'Sourced idea', sourceApp: 'vidtoolz-mindmap',
    sourceType: 'mindmap', sourceId: 'claim-1.2', metadata: {
      claimId: '1.2', topicId: 'topic-042', categoryId: 'cat-01', sourceScriptLabel: 'A', sourceScriptHash: 'a'.repeat(40),
      editorial: { source: 'mindmap', narrative_spine: 'contradiction_diagnosis_reframe_action' },
    },
  }]);
  const { server, root } = await bridgeServer(stub);
  try {
    const data = unwrap(await link(server, { kanban_card_id: 'card-source', title: 'Sourced idea' }));
    const project = superFocus.loadProject(data.project_id, { root });
    assert.deepEqual(project.editorial_source, {
      system: 'mindmap', kind: 'claim', source_id: 'claim-1.2', claim_id: '1.2',
      topic_id: 'topic-042', category_id: 'cat-01', source_script_label: 'A', source_script_hash: 'a'.repeat(40), status: 'verified',
      editorial: { source: 'mindmap', narrative_spine: 'contradiction_diagnosis_reframe_action' },
    });
  } finally {
    await close(server);
  }
});

test('kanban bridge: contradictory durable source fails closed and preserves the original', async () => {
  const root = mkdirTmp('kanban-bridge-root-');
  const mediaRoot = mkdirTmp('kanban-bridge-media-');
  const project = superFocus.createProject({ title: 'Existing' }, { root });
  superFocus.setKanbanCardId(project.project_id, 'card-1', { root });
  superFocus.setEditorialSource(project.project_id, {
    system: 'mindmap', kind: 'claim', source_id: 'claim-A', claim_id: 'A', status: 'verified',
  }, { root });
  const stub = makeKanbanStub([{
    id: 'card-1', sourceApp: 'vidtoolz-mindmap', sourceType: 'mindmap', sourceId: 'claim-B',
    metadata: { ef_project_id: project.project_id, claimId: 'B' },
  }]);
  const server = packageEngineServer.createServer({ superFocusRoot: root, superFocusMediaRoot: mediaRoot, kanbanRequest: stub.fn });
  await listen(server);
  try {
    const response = await link(server, { kanban_card_id: 'card-1' });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, 'editorial_source_conflict');
    assert.equal(superFocus.loadProject(project.project_id, { root }).editorial_source.source_id, 'claim-A');
    assert.equal(stub.calls.filter((call) => call.method === 'PATCH').length, 0);
  } finally {
    await close(server);
  }
});

test('kanban bridge: contradictory explicit editorial taxonomy cannot overwrite project provenance', () => {
  const root = mkdirTmp('kanban-bridge-root-');
  const project = superFocus.createProject({ title: 'Editorial conflict' }, { root });
  superFocus.setEditorialSource(project.project_id, {
    system: 'mindmap', kind: 'claim', source_id: 'claim-A', status: 'verified',
    editorial: { source: 'mindmap', narrative_spine: 'contradiction_diagnosis_reframe_action' },
  }, { root });
  assert.throws(() => superFocus.setEditorialSource(project.project_id, {
    system: 'mindmap', kind: 'claim', source_id: 'claim-A', status: 'verified',
    editorial: { source: 'mindmap', narrative_spine: 'mistake_consequence_root_cause_better_system' },
  }, { root }), (error) => error.statusCode === 409 && error.code === 'editorial_source_conflict');
  assert.equal(superFocus.loadProject(project.project_id, { root }).editorial_source.editorial.narrative_spine,
    'contradiction_diagnosis_reframe_action');
});

test('kanban bridge: repeat link is idempotent — same project, no duplicate', async () => {
  const stub = makeKanbanStub([{ id: 'card-1', metadata: {} }]);
  const { server, root } = await bridgeServer(stub);
  try {
    const first = unwrap(await link(server, { kanban_card_id: 'card-1', title: 'My Video' }));
    const second = unwrap(await link(server, { kanban_card_id: 'card-1', title: 'My Video' }));
    assert.equal(first.linked, 'created');
    assert.equal(second.linked, 'existing');
    assert.equal(second.project_id, first.project_id);
    assert.equal(superFocus.listProjects({ root }).length, 1);
  } finally {
    await close(server);
  }
});

test('kanban bridge: card already linked and consistent returns existing, no create', async () => {
  const root = mkdirTmp('kanban-bridge-root-');
  const mediaRoot = mkdirTmp('kanban-bridge-media-');
  const proj = superFocus.createProject({ title: 'Existing' }, { root });
  superFocus.setKanbanCardId(proj.project_id, 'card-1', { root });
  const stub = makeKanbanStub([{ id: 'card-1', metadata: { ef_project_id: proj.project_id } }]);
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    kanbanRequest: stub.fn,
  });
  await listen(server);
  try {
    const res = await link(server, { kanban_card_id: 'card-1' });
    assert.equal(res.statusCode, 200);
    const data = unwrap(res);
    assert.equal(data.linked, 'existing');
    assert.equal(data.project_id, proj.project_id);
    assert.equal(superFocus.listProjects({ root }).length, 1);
  } finally {
    await close(server);
  }
});

test('kanban bridge: EF-side link is honored when the card lost its half', async () => {
  const root = mkdirTmp('kanban-bridge-root-');
  const mediaRoot = mkdirTmp('kanban-bridge-media-');
  const proj = superFocus.createProject({ title: 'EF side only' }, { root });
  superFocus.setKanbanCardId(proj.project_id, 'card-1', { root });
  const stub = makeKanbanStub([{ id: 'card-1', metadata: {} }]);
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    kanbanRequest: stub.fn,
  });
  await listen(server);
  try {
    const res = await link(server, { kanban_card_id: 'card-1' });
    assert.equal(res.statusCode, 200);
    const data = unwrap(res);
    assert.equal(data.linked, 'existing');
    assert.equal(data.project_id, proj.project_id);
    assert.equal(superFocus.listProjects({ root }).length, 1);
    const card = stub.state.cards.find((c) => c.id === 'card-1');
    assert.equal(card.metadata.ef_project_id, proj.project_id);
  } finally {
    await close(server);
  }
});

test('kanban bridge: card linked but EF half missing heals the EF side', async () => {
  const root = mkdirTmp('kanban-bridge-root-');
  const mediaRoot = mkdirTmp('kanban-bridge-media-');
  const proj = superFocus.createProject({ title: 'Unhealed' }, { root });
  assert.equal(superFocus.loadProject(proj.project_id, { root }).kanban_card_id, null);
  const stub = makeKanbanStub([{ id: 'card-1', metadata: { ef_project_id: proj.project_id } }]);
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    kanbanRequest: stub.fn,
  });
  await listen(server);
  try {
    const res = await link(server, { kanban_card_id: 'card-1' });
    assert.equal(res.statusCode, 200);
    const data = unwrap(res);
    assert.equal(data.linked, 'existing');
    assert.equal(data.project_id, proj.project_id);
    assert.equal(superFocus.loadProject(proj.project_id, { root }).kanban_card_id, 'card-1');
  } finally {
    await close(server);
  }
});

// ── Conflicts and broken links ────────────────────────────────────────────

test('kanban bridge: missing kanban_card_id is a 400', async () => {
  const stub = makeKanbanStub([{ id: 'card-1' }]);
  const { server } = await bridgeServer(stub);
  try {
    const res = await link(server, { title: 'No card id' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'kanban_card_id_required');
    assert.equal(stub.calls.filter((c) => c.method === 'PATCH').length, 0);
  } finally {
    await close(server);
  }
});

test('kanban bridge: unknown card is a 404 kanban_card_not_found', async () => {
  const stub = makeKanbanStub([{ id: 'card-1' }]);
  const { server } = await bridgeServer(stub);
  try {
    const res = await link(server, { kanban_card_id: 'no-such-card' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'kanban_card_not_found');
  } finally {
    await close(server);
  }
});

test('kanban bridge: mismatched bilateral link is a 409 integrity conflict, nothing changed', async () => {
  const root = mkdirTmp('kanban-bridge-root-');
  const mediaRoot = mkdirTmp('kanban-bridge-media-');
  const projA = superFocus.createProject({ title: 'Project A' }, { root });
  superFocus.setKanbanCardId(projA.project_id, 'card-B', { root });
  const stub = makeKanbanStub([{ id: 'card-1', metadata: { ef_project_id: projA.project_id, claimId: 'c1' } }]);
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    kanbanRequest: stub.fn,
  });
  await listen(server);
  try {
    const res = await link(server, { kanban_card_id: 'card-1' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'kanban_bridge_conflict');
    // No repair, no PATCH: both sides untouched.
    assert.equal(stub.calls.filter((c) => c.method === 'PATCH').length, 0);
    assert.equal(superFocus.loadProject(projA.project_id, { root }).kanban_card_id, 'card-B');
    const card = stub.state.cards.find((c) => c.id === 'card-1');
    assert.equal(card.metadata.claimId, 'c1');
  } finally {
    await close(server);
  }
});

test('kanban bridge: card referencing a missing EF project is a 409 broken_link, no auto-create', async () => {
  const stub = makeKanbanStub([{ id: 'card-1', metadata: { ef_project_id: 'ghost-project' } }]);
  const { server, root } = await bridgeServer(stub);
  try {
    const res = await link(server, { kanban_card_id: 'card-1' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'broken_link');
    assert.match(res.body.error, /ghost-project/);
    assert.equal(superFocus.listProjects({ root }).length, 0);
  } finally {
    await close(server);
  }
});

// ── Kanban write retry and rollback ───────────────────────────────────────

test('kanban bridge: Kanban PATCH 409 stale revision retries once and succeeds', async () => {
  const stub = makeKanbanStub([{ id: 'card-1', metadata: {} }], { failFirstPatchWith409: true });
  const { server, root } = await bridgeServer(stub);
  try {
    const res = await link(server, { kanban_card_id: 'card-1', title: 'Retry me' });
    assert.equal(res.statusCode, 200);
    const data = unwrap(res);
    assert.equal(data.linked, 'created');
    // Two PATCHes (first failed, retry succeeded) and a second state fetch.
    assert.equal(stub.calls.filter((c) => c.method === 'PATCH').length, 2);
    assert.ok(stub.calls.filter((c) => c.method === 'GET').length >= 2);
    const card = stub.state.cards.find((c) => c.id === 'card-1');
    assert.equal(card.metadata.ef_project_id, data.project_id);
    assert.equal(superFocus.loadProject(data.project_id, { root }).kanban_card_id, 'card-1');
  } finally {
    await close(server);
  }
});

test('kanban bridge: persistent Kanban failure after a fresh create rolls the new project back', async () => {
  const stub = makeKanbanStub([{ id: 'card-1', metadata: {} }], {
    alwaysFailPatch: { statusCode: 500, message: 'disk full', code: 'write_failed' },
  });
  const { server, root } = await bridgeServer(stub);
  try {
    const res = await link(server, { kanban_card_id: 'card-1', title: 'Doomed' });
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /rolled back/);
    // No half-linked new project left behind.
    assert.equal(superFocus.listProjects({ root }).length, 0);
    const leftover = fs.readdirSync(root).filter((name) => superFocus.PROJECT_ID_RE.test(name));
    assert.deepEqual(leftover, []);
  } finally {
    await close(server);
  }
});

test('kanban bridge: Kanban failure on a pre-existing link never rolls the project back', async () => {
  const root = mkdirTmp('kanban-bridge-root-');
  const mediaRoot = mkdirTmp('kanban-bridge-media-');
  const proj = superFocus.createProject({ title: 'Pre-existing' }, { root });
  superFocus.setKanbanCardId(proj.project_id, 'card-1', { root });
  const stub = makeKanbanStub([{ id: 'card-1', metadata: {} }], {
    alwaysFailPatch: { statusCode: 500, message: 'disk full', code: 'write_failed' },
  });
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    kanbanRequest: stub.fn,
  });
  await listen(server);
  try {
    const res = await link(server, { kanban_card_id: 'card-1' });
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /left unchanged/);
    // Project survives with its link intact.
    assert.equal(superFocus.loadProject(proj.project_id, { root }).kanban_card_id, 'card-1');
    assert.equal(superFocus.listProjects({ root }).length, 1);
  } finally {
    await close(server);
  }
});

// ── super-focus.js unit surface ───────────────────────────────────────────

test('setKanbanCardId refuses re-linking to a different card with 409', () => {
  const root = mkdirTmp('kanban-bridge-unit-');
  const proj = superFocus.createProject({ title: 'Unit' }, { root });
  superFocus.setKanbanCardId(proj.project_id, 'card-1', { root });
  assert.throws(
    () => superFocus.setKanbanCardId(proj.project_id, 'card-2', { root }),
    (error) => error.statusCode === 409 && /different Kanban card/.test(error.message)
  );
  // Re-setting the SAME card id is idempotent and does not throw.
  const state = superFocus.setKanbanCardId(proj.project_id, 'card-1', { root });
  assert.equal(state.kanban_card_id, 'card-1');
});

test('findProjectByKanbanCardId matches only kanban_card_id and skips corrupt entries', () => {
  const root = mkdirTmp('kanban-bridge-unit-');
  const proj = superFocus.createProject({ title: 'card-1 title lookalike' }, { root });
  const other = superFocus.createProject({ title: 'Other' }, { root });
  superFocus.setKanbanCardId(other.project_id, 'card-1', { root });
  // Corrupt sibling entry must not break the scan.
  const corruptDir = path.join(root, 'corrupt-project');
  fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(path.join(corruptDir, superFocus.STATE_FILENAME), '{not json', 'utf8');
  // Matches the linked project, never the title lookalike.
  assert.equal(superFocus.findProjectByKanbanCardId('card-1', { root }), other.project_id);
  assert.equal(superFocus.findProjectByKanbanCardId('card-unknown', { root }), null);
  assert.equal(superFocus.findProjectByKanbanCardId('', { root }), null);
  assert.equal(superFocus.findProjectByKanbanCardId(null, { root }), null);
  void proj;
});

test('old projects without kanban_card_id still load with it normalized to null', () => {
  const root = mkdirTmp('kanban-bridge-unit-');
  const proj = superFocus.createProject({ title: 'Legacy' }, { root });
  const file = path.join(root, proj.project_id, superFocus.STATE_FILENAME);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete state.kanban_card_id;
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  const loaded = superFocus.loadProject(proj.project_id, { root });
  assert.equal(loaded.kanban_card_id, null);
  // And a legacy project can be linked normally afterwards.
  const linked = superFocus.setKanbanCardId(proj.project_id, 'card-1', { root });
  assert.equal(linked.kanban_card_id, 'card-1');
});
