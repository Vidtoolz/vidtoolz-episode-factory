/**
 * VIDTOOLZ Episode Factory — Visual Plan: every beat requires a visual.
 *
 * Proves the canonical domain rule (every standard beat is visual_required,
 * no per-beat visual-requirement decision) and the removal of the beat-row
 * dropdown, WITHOUT weakening review/approval/slot-safety gates.
 *
 * Two layers:
 *  - domain helpers in super-focus-visual-plan.js (defaults, legacy
 *    normalization, generation eligibility, readiness, approval gate);
 *  - rendered DOM: the page's real inline script runs in a tag-aware DOM stub,
 *    proving the disposition <select> is gone from the collapsed row, the
 *    summary no longer shows presenter-only/unresolved, and the expanded
 *    editor still offers Media type / Visual function selects (nothing
 *    unrelated was removed).
 */

const { test, assert, fs, path } = require('./_helpers.js');
const vm = require('node:vm');
const vp = require('../super-focus-visual-plan.js');

const SCRIPT = [
  'More AI tools can make you less productive.',
  'Wan 2.2 renders fast while FLUX makes the plates.',
  'One system beats five tools.',
].join('\n');

function freshPlan() {
  return vp.createBeats(SCRIPT, null, { now: '2026-07-23T00:00:00Z' });
}
function draft(plan, beatId, extra) {
  return vp.saveAssignment(plan, SCRIPT, beatId, Object.assign({
    viewer_task: 'Understand it.', visual_function: 'clarify',
    assignment: 'Show the concept concretely.', acceptance_criteria: ['Reads in one second'],
    media_type: 'image_to_video',
  }, extra || {}), { now: '2026-07-23T00:01:00Z' });
}
// Simulate a LEGACY persisted disposition without the guarded write route.
function forceDisposition(plan, beatId, disposition) {
  return Object.assign({}, plan, {
    beats: plan.beats.map((b) => (b.beat_id === beatId
      ? Object.assign({}, b, { visual_disposition: disposition }) : b)),
  });
}

// ── domain: default + legacy normalization ──────────────────────────────────

test('visual-required: newly created beats are visual_required, never unresolved', () => {
  const plan = freshPlan();
  assert.ok(plan.beats.length >= 3);
  assert.ok(plan.beats.every((b) => b.visual_disposition === 'visual_required'),
    plan.beats.map((b) => b.visual_disposition).join(','));
  assert.ok(!plan.beats.some((b) => b.visual_disposition === 'unresolved'));
});

test('visual-required: recreating beats from the saved script yields generation-eligible beats with no operator decision', () => {
  const plan = freshPlan(); // simulates re-create from saved script
  const sel = vp.selectBeatsForGeneration(plan);
  assert.equal(sel.skipped.length, 0, 'no beat skipped for a requirement decision');
  assert.equal(sel.beats.length, Math.min(plan.beats.length, 3));
});

test('visual-required: legacy `unresolved` beats normalize to visual_required on read and never block generation', () => {
  // Simulate a persisted legacy project: force one beat back to `unresolved`.
  const base = freshPlan();
  const legacy = Object.assign({}, base, {
    beats: base.beats.map((b, i) => (i === 0 ? Object.assign({}, b, { visual_disposition: 'unresolved' }) : b)),
  });
  // Loads without throwing and converges on read.
  const loaded = vp.refreshPlanStaleness(legacy, SCRIPT);
  assert.equal(loaded.beats[0].visual_disposition, 'visual_required');
  // Even the un-normalized legacy plan must not skip the unresolved beat.
  const sel = vp.selectBeatsForGeneration(legacy);
  assert.ok(sel.beats.some((b) => b.beat_id === base.beats[0].beat_id), 'legacy unresolved beat is still eligible');
  assert.equal(sel.skipped.length, 0);
});

test('visual-required: legacy presenter_only beats are preserved on read (not silently rewritten)', () => {
  let plan = freshPlan();
  plan = forceDisposition(plan, plan.beats[0].beat_id, 'presenter_only'); // legacy stored beat
  const loaded = vp.refreshPlanStaleness(plan, SCRIPT);
  assert.equal(loaded.beats.find((b) => b.beat_id === plan.beats[0].beat_id).visual_disposition, 'presenter_only');
  // presenter_only still excluded from generation + counted separately in readiness.
  const sel = vp.selectBeatsForGeneration(plan);
  assert.ok(!sel.beats.some((b) => b.beat_id === plan.beats[0].beat_id));
  const r = vp.computeVisualPlanReadiness(plan, SCRIPT);
  assert.equal(r.presenter_only, 1);
});

// ── domain: slot-safety + approval gate (must not weaken) ───────────────────

test('visual-required: generate-missing fills only beats without assignments; never overwrites', () => {
  let plan = freshPlan();
  plan = draft(plan, plan.beats[0].beat_id); // beat0 now has a draft assignment
  const sel = vp.selectBeatsForGeneration(plan);
  assert.ok(!sel.beats.some((b) => b.beat_id === plan.beats[0].beat_id), 'existing assignment not regenerated');
  assert.ok(sel.skipped.some((s) => s.beat_id === plan.beats[0].beat_id && /already exists/i.test(s.reason)));
  assert.ok(sel.beats.some((b) => b.beat_id === plan.beats[1].beat_id), 'beat without assignment is eligible');
});

test('visual-required: prompt creation still requires an APPROVED assignment', () => {
  let plan = freshPlan();
  plan = draft(plan, plan.beats[0].beat_id); // draft, not approved
  let sel = vp.selectAssignmentsForPromptCreation(plan, []);
  assert.ok(!sel.eligible.some((e) => e.beat.beat_id === plan.beats[0].beat_id), 'draft assignment cannot create a prompt');
  assert.ok(sel.skipped.some((s) => /not approved yet/i.test(s.reason)));
  // Approve → now eligible.
  const aid = vp.assignmentForBeat(plan, plan.beats[0].beat_id).assignment_id;
  plan = vp.approveAssignment(plan, SCRIPT, aid);
  sel = vp.selectAssignmentsForPromptCreation(plan, []);
  assert.ok(sel.eligible.some((e) => e.beat.beat_id === plan.beats[0].beat_id), 'approved assignment may create a prompt');
});

// ── domain: readiness next-action reflects real state, not "unresolved" ─────

test('visual-required: next action names assignment work, not a visual-requirement decision', () => {
  const r = vp.computeVisualPlanReadiness(freshPlan(), SCRIPT);
  assert.match(r.next_action, /Generate assignments for \d+ beats? with no assignment yet/);
  assert.doesNotMatch(r.next_action, /unresolved/i);
});

// ── the retained write route enforces the invariant ────────────────────────

test('visual-required: setBeatDisposition cannot newly write any non-visual_required disposition', () => {
  const plan = freshPlan();
  const beatId = plan.beats[0].beat_id;
  // Every obsolete dropdown-era value is rejected with a clear 400 compat error
  // (presenter_only / reuse_previous exclude a beat; visual_optional / text_graphic
  // are simply no longer selectable — the route may only assert visual_required).
  for (const bad of ['presenter_only', 'reuse_previous', 'visual_optional', 'text_graphic']) {
    assert.throws(
      () => vp.setBeatDisposition(plan, SCRIPT, beatId, bad),
      (e) => e.statusCode === 400 && /every beat requires a visual/i.test(e.message),
      `${bad} must be rejected`,
    );
  }
  // Legacy `unresolved` is accepted and normalized to visual_required (cannot newly write unresolved).
  const norm = vp.setBeatDisposition(plan, SCRIPT, beatId, 'unresolved');
  assert.equal(norm.beats.find((b) => b.beat_id === beatId).visual_disposition, 'visual_required');
  // The one permitted write, visual_required, results in visual_required.
  const ok = vp.setBeatDisposition(plan, SCRIPT, beatId, 'visual_required');
  assert.equal(ok.beats.find((b) => b.beat_id === beatId).visual_disposition, 'visual_required');
  // Truly invalid input still fails enum validation.
  assert.throws(() => vp.setBeatDisposition(plan, SCRIPT, beatId, 'sideways'), /visual_disposition/);
  // No accepted outcome leaves a beat excluded from assignment generation.
  assert.equal(vp.selectBeatsForGeneration(ok).skipped.length, 0);
});

test('visual-required: assignment-level media_type presenter_only is a separate concept, unaffected', () => {
  let plan = freshPlan();
  // A visual assignment may still declare media_type presenter_only (an editorial
  // media choice) — the disposition invariant does not touch media_type.
  plan = vp.saveAssignment(plan, SCRIPT, plan.beats[0].beat_id, {
    viewer_task: 'It.', visual_function: 'clarify', assignment: 'A talking-head moment.',
    acceptance_criteria: ['ok'], media_type: 'presenter_only',
  }, { now: '2026-07-23T00:02:00Z' });
  const a = vp.assignmentForBeat(plan, plan.beats[0].beat_id);
  assert.equal(a.media_type, 'presenter_only', 'assignment media_type preserved');
  // The beat itself still requires a visual (disposition unchanged).
  assert.equal(plan.beats[0].visual_disposition, 'visual_required');
});

// ── rendered DOM: tag-aware stub running the page's real inline script ──────

const HTML = fs.readFileSync(path.join(__dirname, '..', 'super-focus.html'), 'utf8');
function inlineScript() {
  const m = HTML.match(/<script>\n([\s\S]*?)\n {2}<\/script>/);
  assert.ok(m, 'inline script found');
  return m[1];
}

function makeElement(doc, id, tag) {
  const classes = new Set();
  const el = {
    id: id || '', tagName: (tag || '').toUpperCase(), ownerDoc: doc,
    children: [], parentNode: null, listeners: {}, style: {}, dataset: {},
    attributes: {}, className: '', textContent: '', title: '', value: '',
    rows: 0, type: '', placeholder: '', disabled: false, selected: false, hidden: false,
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => { const w = force === undefined ? !classes.has(c) : Boolean(force); if (w) classes.add(c); else classes.delete(c); return w; },
    },
    set innerHTML(v) { if (v === '') this.children.length = 0; },
    get innerHTML() { return ''; },
    addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i !== -1) el.children.splice(i, 1); return c; },
    insertBefore(c) { el.children.unshift(c); return c; },
    setAttribute(k, v) { el.attributes[k] = String(v); },
    getAttribute(k) { return k in el.attributes ? el.attributes[k] : null; },
    removeAttribute(k) { delete el.attributes[k]; },
    hasAttribute(k) { return k in el.attributes; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, scrollIntoView() {}, click() {},
  };
  return el;
}

function makeDom() {
  const doc = { readyState: 'loading', elements: new Map(), listeners: {}, activeElement: null };
  doc.getElementById = (id) => { if (!doc.elements.has(id)) doc.elements.set(id, makeElement(doc, id)); return doc.elements.get(id); };
  doc.createElement = (tag) => makeElement(doc, '', tag);
  doc.createTextNode = (t) => ({ textContent: String(t) });
  doc.querySelector = () => null; doc.querySelectorAll = () => [];
  doc.addEventListener = (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };
  doc.removeEventListener = () => {};
  doc.dispatch = (t, extra) => { (doc.listeners[t] || []).slice().forEach((fn) => fn(Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, extra || {}))); };
  doc.body = makeElement(doc, '__body__');
  return doc;
}

function loadPage() {
  const doc = makeDom();
  const sandbox = {
    document: doc,
    window: { location: { search: '', href: 'http://127.0.0.1:8010/super-focus.html' }, scrollY: 0, pageYOffset: 0, scrollTo() {}, addEventListener() {}, prompt() { return null; }, open() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    fetch() { return new Promise(() => {}); },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    alert() {}, confirm() { return false; },
    console, URLSearchParams, Promise, Object, Array, JSON, Math, Number, String, Boolean, Date, RegExp, Error,
    KeyboardEvent: function () {},
    SuperFocusProjectIO: {
      makeCreateController() { return { submit() {}, bind() {} }; },
      makeOpenController() { return { open() {}, refresh() {}, bind() {} }; },
      makePickerController() { return { refresh() { return Promise.resolve(); }, setMode() { return Promise.resolve(); }, getMode() { return 'active'; } }; },
      makeLifecycleConfirmController() { return { open() {}, close() { return true; }, confirm() { return Promise.resolve(); }, updateConfirmEnabled() {}, isBusy() { return false; }, current() { return { action: null, projectId: null }; } }; },
      applyPickerState() {},
    },
  };
  sandbox.window.document = doc;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(inlineScript(), sandbox, { filename: 'super-focus-inline.js' });
  return sandbox;
}

function selectsIn(el, acc) {
  acc = acc || [];
  (el.children || []).forEach((c) => { if (c && c.tagName === 'SELECT') acc.push(c); selectsIn(c, acc); });
  return acc;
}
function chipTexts(chips) { return (chips.children || []).map((c) => c.textContent); }

// A rendered plan: beat0 approved, beat1 draft (needs review), beat2 no assignment.
function renderedSandbox(expandFirst) {
  let plan = freshPlan();
  plan = draft(plan, plan.beats[0].beat_id);
  plan = vp.approveAssignment(plan, SCRIPT, vp.assignmentForBeat(plan, plan.beats[0].beat_id).assignment_id);
  plan = draft(plan, plan.beats[1].beat_id);
  const readiness = vp.computeVisualPlanReadiness(plan, SCRIPT);
  const sb = loadPage();
  assert.ok(sb.VP && typeof sb.renderVisualPlan === 'function', 'page exposes VP + renderVisualPlan');
  sb.VP.plan = plan;
  sb.VP.readiness = readiness;
  sb.VP.expanded = expandFirst ? { [plan.beats[0].beat_id]: true } : {};
  sb.renderVisualPlan();
  return { sb, plan, readiness };
}

test('visual-required (DOM): the collapsed beat row renders NO visual-requirement dropdown', () => {
  const { sb, plan } = renderedSandbox();
  const list = sb.document.getElementById('vp-list');
  assert.equal(list.children.length, plan.beats.length, 'one row per beat');
  const selects = selectsIn(list);
  assert.equal(selects.length, 0, 'collapsed rows contain no <select> at all (disposition dropdown removed)');
});

test('visual-required (DOM): the summary shows actionable state, not presenter-only / unresolved requirement counts', () => {
  const { sb } = renderedSandbox();
  const texts = chipTexts(sb.document.getElementById('vp-chips'));
  const joined = texts.join(' | ');
  assert.ok(texts.some((t) => /3 beats/.test(t)));
  assert.ok(texts.some((t) => /1\/3 approved/.test(t)));
  assert.ok(texts.some((t) => /1 without assignment/.test(t)));
  assert.doesNotMatch(joined, /presenter-only/i);
  assert.doesNotMatch(joined, /unresolved/i);
  // Redundant-status cleanup: the draft count lives ONLY in the single
  // "Next:" element — there is no separate "N to review" chip duplicating it,
  // and zero-count chips (e.g. "0 rejected") are dropped entirely.
  assert.doesNotMatch(joined, /to review/);
  assert.doesNotMatch(joined, /0 rejected/);
  assert.ok(texts.some((t) => /^Next: Generate assignments for 1 beat with no assignment yet$/.test(t)), joined);
});

test('visual-required (DOM): collapsed rows have NO one-click Approve; approval lives only inside the expanded editor', () => {
  const collapsed = renderedSandbox(false);
  const collapsedButtons = [];
  (function walk(el) {
    (el.children || []).forEach((c) => { if (c && c.tagName === 'BUTTON') collapsedButtons.push(c.textContent); walk(c); });
  }(collapsed.sb.document.getElementById('vp-list')));
  assert.ok(!collapsedButtons.includes('Approve'), 'no Approve button on any collapsed row');
  // Expanding beat 1 (the draft) exposes Approve inside the editor, where the
  // script beat, viewer task, function, assignment, criteria, and media type
  // are all visible.
  const { sb, plan } = (function () {
    let p = freshPlan();
    p = draft(p, p.beats[0].beat_id);
    const r = vp.computeVisualPlanReadiness(p, SCRIPT);
    const s = loadPage();
    s.VP.plan = p; s.VP.readiness = r;
    s.VP.expanded = {}; s.VP.expanded[p.beats[0].beat_id] = true;
    s.renderVisualPlan();
    return { sb: s, plan: p };
  }());
  const expandedButtons = [];
  (function walk(el) {
    (el.children || []).forEach((c) => { if (c && c.tagName === 'BUTTON') expandedButtons.push(c.textContent); walk(c); });
  }(sb.document.getElementById('vp-list')));
  assert.ok(expandedButtons.includes('Approve'), 'Approve available inside the open editor');
  assert.ok(plan.assignments.length === 1);
});

test('visual-required (DOM): row hierarchy — script excerpt primary, assignment subordinate; batch label is live', () => {
  const { sb, plan } = renderedSandbox();
  const list = sb.document.getElementById('vp-list');
  const firstRow = list.children[0];
  let primary = null; let sub = null;
  (function walk(el) {
    (el.children || []).forEach((c) => {
      if (c && /vp-script-primary/.test(c.className || '')) primary = c;
      if (c && /vp-assign-sub/.test(c.className || '')) sub = c;
      walk(c);
    });
  }(firstRow));
  assert.ok(primary, 'primary script line rendered');
  const beat = plan.beats[0];
  assert.ok(beat.script_text.startsWith(primary.textContent.replace(/…$/, '')), 'primary text is the script excerpt');
  assert.ok(primary.textContent.length <= 91, 'visual truncation at ~90 chars');
  assert.ok(sub, 'assignment rendered as subordinate line');
  assert.match(sub.textContent, /^Visual: /);
  // Live batch label: 1 beat uncovered -> "final 1".
  const genBtn = sb.document.getElementById('vp-generate');
  assert.equal(genBtn.textContent, 'Generate missing assignments — final 1');
});

test('visual-required (DOM): expanding a beat still offers Media type + Visual function selects (no unrelated dropdown removed)', () => {
  const { sb } = renderedSandbox(true);
  const selects = selectsIn(sb.document.getElementById('vp-list'));
  const labels = selects.map((s) => s.getAttribute('aria-label'));
  assert.ok(labels.includes('Media type'), 'media-type select preserved');
  assert.ok(labels.includes('Visual function'), 'visual-function select preserved');
  assert.ok(!labels.includes('Visual disposition'), 'no visual-requirement dropdown anywhere');
});
