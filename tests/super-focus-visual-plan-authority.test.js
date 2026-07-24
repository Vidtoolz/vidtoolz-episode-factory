const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocus = require('../super-focus.js');
const vp = require('../super-focus-visual-plan.js');
const superFocusMedia = require('../super-focus-media.js');

// Visual Plan authority + unlinked-prompt recovery + image-dispatch pre-flight.
//
// Covers the production-governance invariant: when a Visual Plan exists, new
// main image prompts originate from approved assignments; script-wide
// generation is an explicit legacy exception; existing unlinked prompts stay
// historically truthful (never relinked, overwritten, or silently deleted).

function mkRoot(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'sf-vpa-test-')); }
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
  acceptance_criteria: ['One creator figure is visibly surrounded by many panels', 'Composition fills the full 9:16 frame'],
  media_type: 'image_to_video',
};

function fakePromptFetch() {
  return async (url, opts) => {
    const body = String((opts && opts.body) || '');
    const content = body.includes('not an image prompt')
      ? JSON.stringify(FAKE_ASSIGNMENT)
      : (body.includes('strict JSON')
        ? JSON.stringify(['A vast grey studio desk buried under translucent panels, vertical 9:16.', 'A single glowing cable connecting five dark machines, vertical 9:16.'])
        : 'A grey Nordic studio desk overwhelmed by translucent floating interface panels, vertical composition.');
    return { ok: true, json: async () => ({ message: { content } }) };
  };
}

async function projectServer(fetchImpl, extraOptions = {}) {
  const root = mkRoot();
  const mediaRoot = mkRoot('sf-vpa-media-');
  const server = packageEngineServer.createServer(Object.assign(
    { superFocusRoot: root, superFocusMediaRoot: mediaRoot },
    fetchImpl ? { fetchImpl } : {},
    extraOptions
  ));
  await listen(server);
  const created = superFocus.createProject({ title: 'Authority Test' }, { root });
  superFocus.saveScript(created.project_id, SCRIPT, { root });
  return { server, root, mediaRoot, id: created.project_id };
}

async function vpAction(server, action, body) {
  return request(server, `/api/super-focus/visual-plan/${action}`, {
    method: 'POST', headers: writeHeaders(), body,
  });
}

// Build a plan with one saved (draft) assignment on the first beat.
async function planWithDraft(server, id) {
  await vpAction(server, 'create-beats', { id });
  const res = await request(server, `/api/super-focus/visual-plan?id=${id}`);
  const plan = unwrap(res).visual_plan;
  await vpAction(server, 'save-assignment', Object.assign({ id, beat_id: plan.beats[0].beat_id }, FAKE_ASSIGNMENT));
  const after = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`));
  return after.visual_plan;
}

// ── pure domain: provenance + integrity ─────────────────────────────────────

function purePlanWith(statuses) {
  let plan = vp.createBeats(SCRIPT, null, { now: '2026-07-24T00:00:00Z' });
  statuses.forEach((status, i) => {
    if (!status) return;
    plan = vp.saveAssignment(plan, SCRIPT, plan.beats[i].beat_id, FAKE_ASSIGNMENT, { now: '2026-07-24T00:01:00Z' });
    if (status === 'approved') {
      plan = vp.approveAssignment(plan, SCRIPT, vp.assignmentForBeat(plan, plan.beats[i].beat_id).assignment_id);
    }
  });
  return plan;
}

test('authority: classifyPromptProvenance separates linked / legacy / missing', () => {
  const plan = purePlanWith(['approved']);
  const aid = plan.assignments[0].assignment_id;
  assert.equal(vp.classifyPromptProvenance({ index: 1, text: 'x', assignment_id: aid }, plan), 'assignment_linked');
  assert.equal(vp.classifyPromptProvenance({ index: 2, text: 'x' }, plan), 'script_wide_legacy');
  assert.equal(vp.classifyPromptProvenance({ index: 3, text: 'x', assignment_id: 'assignment-gone' }, plan), 'assignment_missing');
  // No plan at all: provenance-carrying rows are malformed, plain rows legacy.
  assert.equal(vp.classifyPromptProvenance({ index: 4, text: 'x', assignment_id: aid }, null), 'assignment_missing');
  assert.equal(vp.classifyPromptProvenance({ index: 5, text: '' }, plan), null, 'empty rows have no provenance state');
});

test('authority: computePlanIntegrity counts linked/unlinked/malformed/empty/needing/blocked', () => {
  const plan = purePlanWith(['approved', 'approved']);
  const linkedId = plan.assignments[0].assignment_id;
  // 100-slot set: 1 linked (assignment 0), 98 unlinked, 1 malformed = full.
  const rows = [{ index: 1, text: 'linked', assignment_id: linkedId }];
  for (let i = 2; i <= 99; i += 1) rows.push({ index: i, text: `legacy ${i}` });
  rows.push({ index: 100, text: 'orphan', assignment_id: 'assignment-gone' });
  const I = vp.computePlanIntegrity(plan, rows, 100);
  assert.equal(I.plan_exists, true);
  assert.equal(I.linked_prompts, 1);
  assert.equal(I.unlinked_prompts, 98);
  assert.equal(I.malformed_provenance, 1);
  assert.equal(I.empty_slots, 0);
  assert.equal(I.approved_assignments, 2);
  // Assignment 1 has a prompt; assignment 2 (approved, image-lane) still needs one.
  assert.equal(I.approved_needing_prompts, 1);
  assert.equal(I.blocked_by_capacity, 1, 'full capacity blocks the needed prompt');
  // The live-project shape: 0 linked · 100 unlinked · 0 empty · N awaiting approval.
  const draftPlan = purePlanWith(['draft']);
  const allLegacy = [];
  for (let i = 1; i <= 100; i += 1) allLegacy.push({ index: i, text: `legacy ${i}` });
  const J = vp.computePlanIntegrity(draftPlan, allLegacy, 100);
  assert.equal(J.linked_prompts, 0);
  assert.equal(J.unlinked_prompts, 100);
  assert.equal(J.empty_slots, 0);
  assert.equal(J.draft_assignments, 1);
  // No plan: metrics still honest.
  const K = vp.computePlanIntegrity(null, allLegacy.slice(0, 10), 100);
  assert.equal(K.plan_exists, false);
  assert.equal(K.unlinked_prompts, 10);
  assert.equal(K.empty_slots, 90);
  assert.equal(K.approved_needing_prompts, 0);
});

// ── pure domain: duplicate-subject advisory ─────────────────────────────────

test('advisory: similar subject/action with the same function warns; materially different jobs do not', () => {
  let plan = vp.createBeats(SCRIPT, null, { now: '2026-07-24T00:00:00Z' });
  const b = plan.beats;
  plan = vp.saveAssignment(plan, SCRIPT, b[0].beat_id, {
    viewer_task: 'See the editing desk drowning in tools.',
    visual_function: 'clarify',
    assignment: 'A cluttered editing desk buried under many glowing software panels.',
    acceptance_criteria: ['ok'], media_type: 'generated_still',
  });
  plan = vp.saveAssignment(plan, SCRIPT, b[1].beat_id, {
    viewer_task: 'See the editing desk drowning in tools again.',
    visual_function: 'clarify',
    assignment: 'The cluttered editing desk buried under glowing software panels everywhere.',
    acceptance_criteria: ['ok'], media_type: 'generated_still',
  });
  plan = vp.saveAssignment(plan, SCRIPT, b[2].beat_id, {
    viewer_task: 'Feel the calm of a single unified pipeline.',
    visual_function: 'establish_mood',
    assignment: 'One serene minimal desk with a single dark machine and empty space.',
    acceptance_criteria: ['ok'], media_type: 'generated_still',
  });
  const advisories = vp.findDuplicateSubjectAdvisories(plan);
  assert.equal(advisories.length, 1, 'exactly the near-duplicate pair warns');
  assert.deepEqual(advisories[0].beat_orders.slice().sort(), [1, 2]);
  assert.ok(advisories[0].similarity >= 0.5);
  assert.match(advisories[0].reason, /same visual function|similar viewer tasks/i);
  // Rejected assignments never participate.
  const rejected = vp.rejectAssignment(plan, SCRIPT, vp.assignmentForBeat(plan, b[1].beat_id).assignment_id);
  assert.equal(vp.findDuplicateSubjectAdvisories(rejected).length, 0);
  // Warning-only: approval of a flagged assignment still works.
  const approved = vp.approveAssignment(plan, SCRIPT, vp.assignmentForBeat(plan, b[0].beat_id).assignment_id);
  assert.equal(vp.assignmentForBeat(approved, b[0].beat_id).status, 'approved');
});

// ── pure domain: assignment-generation criteria constraints ────────────────

test('assignment request: acceptance criteria must be image-observable; text/presenter criteria forbidden', () => {
  const plan = purePlanWith([]);
  const req = vp.buildAssignmentRequest(SCRIPT, plan, plan.beats[0]);
  assert.match(req.user, /FORBIDDEN: readable text, rendered words, labels, captions, typography, lettering, or logos/i);
  assert.match(req.user, /FORBIDDEN: presenter placement, empty presenter space, green-screen layout/i);
  assert.match(req.user, /FORBIDDEN: subjective claims with no observable visual test/i);
  assert.match(req.user, /ALLOWED: visible, reviewable evidence/i);
  // Full-screen 9:16 composition rule retained.
  assert.match(req.user, /full-screen 9:16/i);
  assert.match(req.user, /Do not reserve space for a presenter/i);
});

// ── pure domain: unlinked-prompt selection + snapshot-first clearing ────────

test('recovery: selectClearableUnlinkedPrompts refuses linked and protected rows, reports missing indexes', () => {
  const state = {
    image_prompts: [
      { index: 1, text: 'legacy one' },
      { index: 2, text: 'linked', assignment_id: 'assignment-a' },
      { index: 3, text: 'legacy three' },
      { index: 4, text: '' },
    ],
  };
  const all = superFocus.selectClearableUnlinkedPrompts(state, null);
  assert.deepEqual(all.eligible.map((r) => r.index), [1, 3]);
  assert.deepEqual(all.refused.map((r) => r.index), [2]);
  assert.match(all.refused[0].reason, /assignment-linked/i);
  assert.deepEqual(all.missing, []);
  const sel = superFocus.selectClearableUnlinkedPrompts(state, [1, 2, 4, 9], { protected: { 1: 'live queue item' } });
  assert.deepEqual(sel.eligible.map((r) => r.index), [], 'selected 1 protected, 2 linked, 4 empty, 9 absent');
  assert.deepEqual(sel.missing, [4, 9], 'empty and absent slots are reported, not silently ignored');
  assert.equal(sel.refused.find((r) => r.index === 1).reason, 'live queue item');
});

test('recovery: clearUnlinkedImagePrompts writes a restorable snapshot BEFORE clearing, preserves linked rows', () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: 'Recovery' }, { root });
  const id = created.project_id;
  superFocus.saveScript(id, SCRIPT, { root });
  superFocus.saveImagePrompts(id, ['legacy one', 'legacy two', 'legacy three'], { root });
  // Hand-stamp assignment provenance on row 2 (the linked survivor).
  const dir = path.join(root, id);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'super-focus.json'), 'utf8'));
  state.image_prompts[1].assignment_id = 'assignment-keep';
  state.image_prompts[1].assignment_hash = 'h';
  fs.writeFileSync(path.join(dir, 'super-focus.json'), JSON.stringify(state, null, 2));
  const result = superFocus.clearUnlinkedImagePrompts(id, [1, 3], {
    root,
    artifacts: [{ index: 1, has_image: true, has_video: false }],
  });
  assert.deepEqual(result.cleared_indexes, [1, 3]);
  // The snapshot exists, inside the project, and is restorable by hand.
  assert.ok(result.snapshot_path.startsWith(path.join(dir, 'recovery') + path.sep));
  const snap = JSON.parse(fs.readFileSync(result.snapshot_path, 'utf8'));
  assert.equal(snap.kind, 'unlinked-prompt-recovery-snapshot');
  assert.equal(snap.project_id, id);
  assert.equal(snap.cleared_count, 2);
  assert.deepEqual(snap.cleared_indexes, [1, 3]);
  assert.deepEqual(snap.rows.map((r) => r.text), ['legacy one', 'legacy three']);
  assert.ok(snap.created_at, 'timestamped');
  assert.equal(snap.artifacts[0].has_image, true);
  // Only the confirmed unlinked rows were removed; the linked row survives whole.
  const after = superFocus.loadProject(id, { root });
  assert.deepEqual(after.image_prompts.map((r) => r.index), [2]);
  assert.equal(after.image_prompts[0].assignment_id, 'assignment-keep');
  // Zero-eligible and unknown-index calls refuse without mutating.
  assert.throws(() => superFocus.clearUnlinkedImagePrompts(id, [2], { root }), /No eligible unlinked prompts/);
  assert.throws(() => superFocus.clearUnlinkedImagePrompts(id, [77], { root }), /No prompt at index/);
  assert.deepEqual(superFocus.loadProject(id, { root }).image_prompts.map((r) => r.index), [2]);
});

// ── routes: script-wide legacy gate ─────────────────────────────────────────

test('authority routes: a plan with assignments gates script-wide generation behind legacy_override', async () => {
  const { server, root, id } = await projectServer(fakePromptFetch());
  try {
    await planWithDraft(server, id);
    // Both script-wide routes refuse without the override…
    const gen = await request(server, '/api/super-focus/generate-image-prompts', {
      method: 'POST', headers: writeHeaders(), body: { id, count: 2 },
    });
    assert.equal(gen.statusCode, 409);
    assert.match(gen.body.error || '', /Visual Plan/i);
    assert.match(gen.body.error || '', /legacy_override/);
    assert.match(gen.body.error || '', /will NOT be linked to beats or assignments/i);
    assert.match(gen.body.error || '', /capacity needed by approved assignments/i);
    const topup = await request(server, '/api/super-focus/generate-remaining-image-prompts', {
      method: 'POST', headers: writeHeaders(), body: { id },
    });
    assert.equal(topup.statusCode, 409);
    assert.match(topup.body.error || '', /legacy_override/);
    // …and the refusal mutated nothing (cancellation = zero mutation).
    assert.deepEqual(superFocus.loadProject(id, { root }).image_prompts, []);
    // With the explicit override, generation proceeds and produces UNLINKED rows.
    const forced = await request(server, '/api/super-focus/generate-remaining-image-prompts', {
      method: 'POST', headers: writeHeaders(), body: { id, legacy_override: true },
    });
    assert.equal(forced.statusCode, 200);
    const rows = superFocus.loadProject(id, { root }).image_prompts;
    assert.ok(rows.length >= 1);
    rows.forEach((r) => {
      assert.equal(r.assignment_id, undefined, 'legacy generation never infers assignment provenance');
      assert.equal(r.prompt_source, undefined);
    });
  } finally { await close(server); }
});

test('authority routes: no-plan and empty-plan projects keep normal script-wide behavior', async () => {
  const { server, id } = await projectServer(fakePromptFetch());
  try {
    // No plan at all.
    const gen = await request(server, '/api/super-focus/generate-image-prompts', {
      method: 'POST', headers: writeHeaders(), body: { id, count: 2 },
    });
    assert.equal(gen.statusCode, 200, 'no plan → no gate');
    // A plan with beats but zero assignments does not gate either.
    await vpAction(server, 'create-beats', { id });
    const topup = await request(server, '/api/super-focus/generate-remaining-image-prompts', {
      method: 'POST', headers: writeHeaders(), body: { id },
    });
    assert.equal(topup.statusCode, 200, 'plan without assignments → no gate');
  } finally { await close(server); }
});

test('authority routes: visual-plan GET carries integrity + advisories; readiness GET carries integrity', async () => {
  const { server, id } = await projectServer(fakePromptFetch());
  try {
    await planWithDraft(server, id);
    const full = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`));
    assert.ok(full.integrity, 'integrity present');
    assert.equal(full.integrity.total_assignments, 1);
    assert.equal(full.integrity.draft_assignments, 1);
    assert.equal(full.integrity.linked_prompts, 0);
    assert.equal(full.integrity.empty_slots, full.integrity.capacity);
    assert.ok(Array.isArray(full.duplicate_subject_advisories));
    const readiness = unwrap(await request(server, `/api/super-focus/visual-plan/readiness?id=${id}`));
    assert.ok(readiness.integrity, 'readiness endpoint also carries integrity');
  } finally { await close(server); }
});

test('authority routes: from-assignments writes linked prompts; integrity reflects them; stale messages recompute', async () => {
  const { server, root, id } = await projectServer(fakePromptFetch());
  try {
    const plan = await planWithDraft(server, id);
    await vpAction(server, 'approve-assignment', { id, assignment_id: plan.assignments[0].assignment_id });
    const res = await request(server, '/api/super-focus/image-prompts/from-assignments', {
      method: 'POST', headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.placed.length, 1);
    const row = superFocus.loadProject(id, { root }).image_prompts[0];
    assert.equal(row.prompt_source, 'assignment');
    assert.ok(row.assignment_id && row.assignment_hash && row.beat_id && row.prompt_hash);
    const I = unwrap(await request(server, `/api/super-focus/visual-plan?id=${id}`)).integrity;
    assert.equal(I.linked_prompts, 1);
    assert.equal(I.unlinked_prompts, 0);
    assert.equal(I.approved_needing_prompts, 0, 'the approved assignment is satisfied');
  } finally { await close(server); }
});

// ── routes: recovery preview + commit ───────────────────────────────────────

// A stranded-style project: linked row 1, unlinked rows 2..N, optional artifacts.
async function strandedProject(fetchImpl, unlinkedCount) {
  const ctx = await projectServer(fetchImpl);
  const plan = await planWithDraft(ctx.server, ctx.id);
  await vpAction(ctx.server, 'approve-assignment', { id: ctx.id, assignment_id: plan.assignments[0].assignment_id });
  await request(ctx.server, '/api/super-focus/image-prompts/from-assignments', {
    method: 'POST', headers: writeHeaders(), body: { id: ctx.id },
  });
  // Fill unlinked prompts through the per-row save (no provenance stamped).
  for (let i = 2; i <= unlinkedCount + 1; i += 1) {
    await request(ctx.server, '/api/super-focus/image-prompt', {
      method: 'POST', headers: writeHeaders(), body: { id: ctx.id, index: i, text: `legacy prompt ${i}` },
    });
  }
  return ctx;
}

test('recovery routes: preview reports eligibility, refusals, artifacts, and capacity consequence', async () => {
  const ctx = await strandedProject(fakePromptFetch(), 3);
  const { server, id, mediaRoot } = ctx;
  try {
    // Give row 3 a generated image on disk and row 4 a live queue item.
    const mediaDir = path.join(mediaRoot, id);
    fs.mkdirSync(path.join(mediaDir, 'images', 'flux-local'), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'images', 'flux-local', 'flux-003.png'), 'png-bytes');
    fs.writeFileSync(path.join(mediaDir, 'video-queue.json'), JSON.stringify({ items: [{ index: 4, status: 'queued' }] }));
    const p = unwrap(await request(server, `/api/super-focus/image-prompts/clear-unlinked-preview?id=${id}`));
    assert.deepEqual(p.eligible_indexes, [2, 3], 'row 1 linked, row 4 queue-protected');
    assert.equal(p.refused.length, 2);
    assert.ok(p.refused.some((r) => r.index === 1 && /assignment-linked/i.test(r.reason)));
    assert.ok(p.refused.some((r) => r.index === 4 && /queue/i.test(r.reason)));
    assert.equal(p.artifacts.images, 1, 'row 3 has a generated image');
    assert.equal(p.requires_artifact_acknowledgement, true);
    assert.equal(p.eligible.find((r) => r.index === 3).has_image, true);
    assert.equal(p.empty_slots_after, p.empty_slots_now + 2);
    // Selected-subset preview.
    const sel = unwrap(await request(server, `/api/super-focus/image-prompts/clear-unlinked-preview?id=${id}&indexes=2`));
    assert.deepEqual(sel.eligible_indexes, [2]);
    assert.equal(sel.requires_artifact_acknowledgement, false);
  } finally { await close(server); }
});

test('recovery routes: commit demands matching confirm_count and artifact acknowledgement; snapshot + integrity returned', async () => {
  const ctx = await strandedProject(fakePromptFetch(), 3);
  const { server, root, id, mediaRoot } = ctx;
  try {
    const mediaDir = path.join(mediaRoot, id);
    fs.mkdirSync(path.join(mediaDir, 'images', 'flux-local'), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'images', 'flux-local', 'flux-002.png'), 'png-bytes');
    // Wrong confirm_count → 409, zero mutation.
    const wrong = await request(server, '/api/super-focus/image-prompts/clear-unlinked', {
      method: 'POST', headers: writeHeaders(), body: { id, confirm_count: 1 },
    });
    assert.equal(wrong.statusCode, 409);
    assert.match(wrong.body.error, /does not match/i);
    // Missing artifact acknowledgement → 409, zero mutation, files untouched.
    const noAck = await request(server, '/api/super-focus/image-prompts/clear-unlinked', {
      method: 'POST', headers: writeHeaders(), body: { id, confirm_count: 3 },
    });
    assert.equal(noAck.statusCode, 409);
    assert.match(noAck.body.error, /acknowledge_artifacts/);
    assert.equal(superFocus.loadProject(id, { root }).image_prompts.length, 4);
    // Proper commit clears only unlinked rows; media file survives; snapshot recorded.
    const ok = await request(server, '/api/super-focus/image-prompts/clear-unlinked', {
      method: 'POST', headers: writeHeaders(), body: { id, confirm_count: 3, acknowledge_artifacts: true },
    });
    assert.equal(ok.statusCode, 200);
    const d = unwrap(ok);
    assert.deepEqual(d.cleared_indexes, [2, 3, 4]);
    assert.ok(fs.existsSync(d.snapshot_path), 'recovery snapshot on disk');
    const snap = JSON.parse(fs.readFileSync(d.snapshot_path, 'utf8'));
    assert.equal(snap.cleared_count, 3);
    assert.ok(snap.rows.every((r) => !r.assignment_id));
    assert.ok(fs.existsSync(path.join(mediaDir, 'images', 'flux-local', 'flux-002.png')), 'generated image never deleted');
    const after = superFocus.loadProject(id, { root });
    assert.deepEqual(after.image_prompts.map((r) => r.index), [1]);
    assert.ok(after.image_prompts[0].assignment_id, 'linked prompt survives');
    assert.equal(d.integrity.unlinked_prompts, 0);
    assert.equal(d.integrity.linked_prompts, 1);
    // Fill-only-empty still holds afterwards: from-assignments writes into gaps
    // without touching the survivor (nothing eligible here → skipped, no overwrite).
    const again = unwrap(await request(server, '/api/super-focus/image-prompts/from-assignments', {
      method: 'POST', headers: writeHeaders(), body: { id },
    }));
    assert.equal(again.placed.length, 0);
    assert.ok(again.skipped.some((s) => /Prompt already exists/i.test(s.reason)));
  } finally { await close(server); }
});

// ── routes: image-dispatch pre-flight (comfy CLI) ───────────────────────────

test('dispatch: fluxDispatchPath repairs a minimal service PATH with ~/.local/bin (idempotent)', () => {
  const bare = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  const repaired = packageEngineServer.fluxDispatchPath(bare);
  const localBin = path.join(os.homedir(), '.local', 'bin');
  assert.ok(repaired.split(path.delimiter).includes(localBin), 'repaired PATH resolves the comfy CLI dir');
  const twice = packageEngineServer.fluxDispatchPath(repaired);
  assert.equal(
    twice.split(path.delimiter).filter((d) => d === localBin).length, 1,
    'no duplicate entries on repeated repair'
  );
});

test('dispatch: a missing comfy CLI is a clear 503 blocked state, not a spawned doomed job', async () => {
  const { server, id } = await projectServer(fakePromptFetch(), {
    superFocusVidnuxComfyReachable: true, // ComfyUI HTTP is up…
    comfyCliCheck: () => false,           // …but the CLI cannot be resolved
    spawn: () => { throw new Error('spawn must never be reached when the CLI is missing'); },
    fluxScript: __filename, // exists on disk, so only the CLI gate can refuse
  });
  try {
    await request(server, '/api/super-focus/image-prompt', {
      method: 'POST', headers: writeHeaders(), body: { id, index: 1, text: 'a prompt' },
    });
    const res = await request(server, '/api/super-focus/generate-images', {
      method: 'POST', headers: writeHeaders(), body: { id, limit: 1 },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /Text-to-image lane blocked/i);
    assert.match(res.body.error, /comfy/);
    assert.match(res.body.error, /vidnux/);
    assert.doesNotMatch(res.body.error, /Ollama/i, 'Ollama is never offered as an image substitute');
  } finally { await close(server); }
});

test('dispatch: startFluxPackageJob pre-flights the CLI too (aigen lane)', () => {
  assert.throws(
    () => packageEngineServer.startFluxPackageJob({ package_id: 'pkg-x' }, {
      comfyCliCheck: () => false,
      fluxScript: __filename, // exists; validation passes to the CLI gate
      pythonBin: 'python3',
    }),
    (e) => e.statusCode === 503 && /Text-to-image lane blocked/i.test(e.message)
  );
});

test('dispatch: provider status separates lanes and reports the CLI blocker without an Ollama image fallback', async () => {
  const status = await packageEngineServer.superFocusProviderStatus({
    comfyCliCheck: () => false,
    comfyuiReachableCheck: async () => true,
    localOllamaProbe: async () => ({ reachable: true, model_ready: true, models: [] }),
    prestoOllamaProbe: async () => ({ reachable: false, model_ready: false, models: [] }),
    superFocusLocalBusy: false,
    superFocusPrestoBusy: false,
  });
  assert.ok(status.lanes, 'lane-separated readiness present');
  const t2i = status.lanes.text_to_image_generation;
  assert.equal(t2i.host, 'vidnux');
  assert.equal(t2i.locality, 'local');
  assert.equal(t2i.status, 'blocked_cli_missing');
  assert.match(t2i.blocking_reason, /comfy/);
  assert.match(t2i.note, /No Ollama fallback exists for images/i);
  const text = status.lanes.text_generation;
  assert.equal(text.engine, 'ollama');
  assert.match(text.note, /Never generates images/i);
  const i2v = status.lanes.image_to_video_generation;
  assert.equal(i2v.host, 'presto');
  assert.equal(i2v.engine, 'comfyui_wan22');
});

// ── UI contract (string-level) ──────────────────────────────────────────────

const HTML = fs.readFileSync(path.join(__dirname, '..', 'super-focus.html'), 'utf8');

test('authority ui: legacy override, recovery action, provenance badges, and integrity strip are wired', () => {
  assert.match(HTML, /Use script-wide legacy generation/);
  assert.match(HTML, /Clear unlinked prompts and generate from approved assignments/);
  // Override confirmation covers the required consequences.
  assert.match(HTML, /will NOT be linked to beats or assignments/);
  assert.match(HTML, /will NOT inherit viewer tasks/);
  assert.match(HTML, /will NOT inherit acceptance criteria/);
  assert.match(HTML, /cannot satisfy Visual Plan provenance/);
  assert.match(HTML, /may occupy capacity needed by approved assignments/);
  // Provenance states rendered per row.
  assert.match(HTML, /Assignment-linked/);
  assert.match(HTML, /Script-wide legacy/);
  assert.match(HTML, /Assignment missing/);
  assert.match(HTML, /does not satisfy the Visual Plan gate/i);
  // Integrity strip + capacity-blocked explanation.
  assert.match(HTML, /imgp-integrity/);
  assert.match(HTML, /blocked_by_capacity/);
  assert.match(HTML, /all ' \+ I\.capacity \+ ' slots are occupied/);
  // Stale transient messages cleared on project switch.
  assert.match(HTML, /setStatus\(vpStatusEl\(\), ''\)/);
  // Recovery flow is staged with explicit cancellation paths.
  assert.match(HTML, /Cancelled — nothing changed\./);
  assert.match(HTML, /Separate acknowledgement required/);
  assert.match(HTML, /clear-unlinked-preview/);
  // No collapsed quick-approve remains; approval text lives in the editor path.
  assert.doesNotMatch(HTML, /quickApprove/);
});

test('authority ui: dynamic assignment-batch label replaces the constant "(3)"', () => {
  assert.doesNotMatch(HTML, /Generate missing assignments \(3\)/);
  assert.match(HTML, /Generate missing assignments — next 3 of /);
  assert.match(HTML, /Generate missing assignments — final /);
});

// ── fail-closed recovery: corrupt queue / unreadable media ─────────────────
// Regression coverage for the pre-commit review finding (2026-07-24): the
// recovery workflow must NEVER fail open when the protection signals it
// depends on are unreadable. A corrupt video-queue.json is not "no queue".

test('media: readVideoQueue distinguishes an absent queue from a corrupt one', () => {
  const root = mkRoot('sf-vpa-media-corrupt-');
  const id = 'corrupt-queue-project';
  // Absent queue file → empty queue (unchanged legacy behavior; ~190 callers rely on it).
  const absent = superFocusMedia.readVideoQueue(id, { mediaRoot: root });
  assert.deepEqual(absent.items, []);
  // Corrupt queue file → coded error, never a silent empty queue.
  const mediaDir = superFocusMedia.mediaDirFor(id, { mediaRoot: root });
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, 'video-queue.json'), '{ not valid json', 'utf8');
  assert.throws(
    () => superFocusMedia.readVideoQueue(id, { mediaRoot: root }),
    (e) => e.code === 'video_queue_unreadable' && e.statusCode === 409 && /unreadable/i.test(e.message)
  );
  // Valid queue file still parses normally.
  fs.writeFileSync(path.join(mediaDir, 'video-queue.json'), JSON.stringify({ version: 1, items: [{ item_id: 'q1', index: 3, status: 'queued' }] }), 'utf8');
  const ok = superFocusMedia.readVideoQueue(id, { mediaRoot: root });
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].index, 3);
});

test('media: readVideoQueue shape table — every non-readable variant refuses, every readable variant parses', () => {
  const root = mkRoot('sf-vpa-media-shapes-');
  const id = 'shape-table-project';
  const mediaDir = superFocusMedia.mediaDirFor(id, { mediaRoot: root });
  fs.mkdirSync(mediaDir, { recursive: true });
  const queueFile = path.join(mediaDir, 'video-queue.json');

  // Every queue-file shape is either READABLE (returns a queue) or REFUSES
  // (throws video_queue_unreadable 409) — nothing in between, nothing coerced.
  const refuseShapes = [
    ['unparseable JSON', '{ broken'],
    ['non-object root (array)', JSON.stringify([{ index: 1 }])],
    ['non-object root (string)', JSON.stringify('queued')],
    ['present null items', JSON.stringify({ version: 1, items: null })],
    ['object-shaped items', JSON.stringify({ version: 1, items: { 0: { index: 1, status: 'queued' } } })],
    ['scalar items', JSON.stringify({ version: 1, items: 42 })],
    ['string items', JSON.stringify({ version: 1, items: 'queued' })],
    ['array-of-junk items', JSON.stringify({ version: 1, items: ['queued', 42, null] })],
    ['array with one junk entry', JSON.stringify({ version: 1, items: [{ index: 1, status: 'queued' }, 'queued'] })],
  ];
  for (const [label, content] of refuseShapes) {
    fs.writeFileSync(queueFile, content, 'utf8');
    assert.throws(
      () => superFocusMedia.readVideoQueue(id, { mediaRoot: root }),
      (e) => e.code === 'video_queue_unreadable' && e.statusCode === 409,
      `shape must refuse: ${label}`
    );
  }

  const readableShapes = [
    ['absent file', null, 0],
    ['valid empty queue', JSON.stringify({ version: 1, items: [] }), 0],
    ['missing items field (legacy)', JSON.stringify({ version: 1 }), 0],
    ['valid queue with items', JSON.stringify({ version: 1, items: [{ index: 1, status: 'queued' }] }), 1],
  ];
  for (const [label, content, expectedItems] of readableShapes) {
    if (content === null) { try { fs.unlinkSync(queueFile); } catch (_) { /* absent */ } }
    else fs.writeFileSync(queueFile, content, 'utf8');
    const q = superFocusMedia.readVideoQueue(id, { mediaRoot: root });
    assert.ok(q && Array.isArray(q.items), `shape must read: ${label}`);
    assert.equal(q.items.length, expectedItems, `shape reads correct items: ${label}`);
  }
});

test('recovery fails closed: a queue with malformed items shape refuses preview AND clear', async () => {
  const { server, root, mediaRoot, id } = await projectServer(fakePromptFetch());
  try {
    await request(server, '/api/super-focus/generate-image-prompts', {
      method: 'POST', headers: writeHeaders(), body: { id, count: 2 },
    });
    const mediaDir = superFocusMedia.mediaDirFor(id, { mediaRoot });
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'video-queue.json'),
      JSON.stringify({ version: 1, items: { 0: { index: 1, status: 'queued' } } }), 'utf8');
    const preview = await request(server, `/api/super-focus/image-prompts/clear-unlinked-preview?id=${id}`);
    assert.equal(preview.statusCode, 409, 'preview refuses on malformed queue items');
    assert.match(preview.raw, /video.queue/i);
    const commit = await request(server, '/api/super-focus/image-prompts/clear-unlinked', {
      method: 'POST', headers: writeHeaders(),
      body: { id, indexes: [1, 2], confirm_count: 2 },
    });
    assert.equal(commit.statusCode, 409, 'clear refuses on malformed queue items');
    const state = superFocus.loadProject(id, { root });
    assert.equal(state.image_prompts.filter((r) => r && r.text && r.text.trim()).length, 2, 'prompts untouched');
  } finally { await close(server); }
});

test('recovery fails closed: a corrupt video queue refuses preview AND clear (never fails open)', async () => {
  const { server, root, mediaRoot, id } = await projectServer(fakePromptFetch());
  try {
    // Two script-wide legacy prompts, no plan → both would be clearable.
    await request(server, '/api/super-focus/generate-image-prompts', {
      method: 'POST', headers: writeHeaders(), body: { id, count: 2 },
    });
    // Corrupt the video queue AFTER prompts exist.
    const mediaDir = superFocusMedia.mediaDirFor(id, { mediaRoot });
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'video-queue.json'), '{ broken json', 'utf8');
    // Preview must refuse — it cannot prove no live queue item guards a row.
    const preview = await request(server, `/api/super-focus/image-prompts/clear-unlinked-preview?id=${id}`);
    assert.equal(preview.statusCode, 409, 'preview refuses when the queue cannot be read');
    assert.match(preview.raw, /video.queue/i);
    // Commit must refuse too — never "treat unreadable as no protection".
    const commit = await request(server, '/api/super-focus/image-prompts/clear-unlinked', {
      method: 'POST', headers: writeHeaders(),
      body: { id, indexes: [1, 2], confirm_count: 2 },
    });
    assert.equal(commit.statusCode, 409, 'clear refuses when the queue cannot be read');
    // Nothing was cleared.
    const state = superFocus.loadProject(id, { root });
    assert.equal(state.image_prompts.filter((r) => r && r.text && r.text.trim()).length, 2, 'prompts untouched on refused clear');
    // No recovery snapshot written for a refused operation.
    const recoveryDir = path.join(root, id, 'recovery');
    assert.equal(fs.existsSync(recoveryDir), false, 'no snapshot for a refused clear');
  } finally { await close(server); }
});

test('recovery fails closed: a corrupt queue surfaced through reconcileVideos is not swallowed as "no artifacts"', async () => {
  // reconcileVideos internally calls readVideoQueue; a corrupt queue makes it
  // throw. The preview must not catch that and proceed as if no artifacts
  // exist — that would bypass the artifact-acknowledgement gate.
  const { server, root, mediaRoot, id } = await projectServer(fakePromptFetch());
  try {
    await request(server, '/api/super-focus/generate-image-prompts', {
      method: 'POST', headers: writeHeaders(), body: { id, count: 1 },
    });
    const mediaDir = superFocusMedia.mediaDirFor(id, { mediaRoot });
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'video-queue.json'), '{ broken', 'utf8');
    const preview = await request(server, `/api/super-focus/image-prompts/clear-unlinked-preview?id=${id}`);
    assert.equal(preview.statusCode, 409, 'preview refuses when reconcile cannot establish artifact truth');
    assert.match(preview.raw, /video.queue|unreadable/i);
    const state = superFocus.loadProject(id, { root });
    assert.equal(state.image_prompts.filter((r) => r && r.text && r.text.trim()).length, 1, 'prompt untouched');
  } finally { await close(server); }
});
