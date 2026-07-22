const { test, assert, fs, path } = require('./_helpers.js');
const vm = require('node:vm');

// ── Full-resolution media viewer: close behavior ─────────────────────────────
// Root cause pinned here (2026-07-20): the #mediaViewer markup sits AFTER the
// page's inline script, so the old immediate wiring IIFE ran while
// getElementById('mediaViewerClose') was still null and silently skipped every
// chrome listener — a visibly dead ✕ Close / backdrop. The fix defers wiring
// to DOMContentLoaded. These tests execute the page's REAL inline script in a
// minimal DOM stub that reproduces the true parse order (script evaluated
// first, viewer nodes created only afterwards), then drive the recorded
// listeners like a browser would. No network stub is ever called: opening and
// closing the viewer must not touch any endpoint (no decisions, no queue, no
// generation).

const HTML = fs.readFileSync(path.join(__dirname, '..', 'super-focus.html'), 'utf8');

// The single inline <script> (the one without src=).
function inlineScript() {
  const m = HTML.match(/<script>\n([\s\S]*?)\n {2}<\/script>/);
  assert.ok(m, 'inline script found');
  return m[1];
}

// ── minimal DOM stub ─────────────────────────────────────────────────────────

function makeElement(doc, id) {
  const classes = new Set(id === 'mediaViewer' ? ['hidden'] : []);
  const el = {
    id: id || '',
    ownerDoc: doc,
    children: [],
    parentNode: null,
    listeners: {}, // type -> [fn]
    style: {},
    dataset: {},
    attributes: {},
    className: '',
    textContent: '',
    value: '',
    disabled: false,
    checked: false,
    hidden: false,
    focusCalls: 0,
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !classes.has(c) : Boolean(force);
        if (want) classes.add(c); else classes.delete(c);
        return want;
      },
    },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const l = el.listeners[type] || [];
      const i = l.indexOf(fn);
      if (i !== -1) l.splice(i, 1);
    },
    listenerCount(type) { return (el.listeners[type] || []).length; },
    dispatch(type, extra) {
      const ev = Object.assign({
        type, target: el, currentTarget: el,
        preventDefault() {}, stopPropagation() {},
      }, extra || {});
      (el.listeners[type] || []).slice().forEach((fn) => fn(ev));
      return ev;
    },
    click() { el.dispatch('click'); },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) { const i = el.children.indexOf(child); if (i !== -1) el.children.splice(i, 1); return child; },
    insertBefore(child) { el.children.unshift(child); return child; },
    setAttribute(k, v) { el.attributes[k] = String(v); },
    getAttribute(k) { return k in el.attributes ? el.attributes[k] : null; },
    removeAttribute(k) { delete el.attributes[k]; },
    hasAttribute(k) { return k in el.attributes; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() { el.focusCalls += 1; doc.activeElement = el; },
    blur() {},
    scrollIntoView() {},
    load() {},
    pause() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
  };
  return el;
}

function makeDom() {
  const doc = {
    readyState: 'loading',
    elements: new Map(),
    listeners: {},
    activeElement: null,
  };
  doc.getElementById = (id) => {
    if (!doc.elements.has(id)) doc.elements.set(id, makeElement(doc, id));
    return doc.elements.get(id);
  };
  doc.createElement = () => makeElement(doc, '');
  doc.createTextNode = (t) => ({ textContent: String(t) });
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
  doc.removeEventListener = (type, fn) => {
    const l = doc.listeners[type] || [];
    const i = l.indexOf(fn);
    if (i !== -1) l.splice(i, 1);
  };
  doc.dispatch = (type, extra) => {
    const ev = Object.assign({ type, target: doc, preventDefault() {}, stopPropagation() {} }, extra || {});
    (doc.listeners[type] || []).slice().forEach((fn) => fn(ev));
    return ev;
  };
  doc.listenerCount = (type) => (doc.listeners[type] || []).length;
  doc.body = makeElement(doc, '__body__');
  return doc;
}

// Evaluate the page's inline script against the stub, recording every network
// attempt. Returns the sandbox (page functions become its properties).
function loadPage() {
  const doc = makeDom();
  const fetchCalls = [];
  const sandbox = {
    document: doc,
    window: {
      location: { search: '', href: 'http://127.0.0.1:8010/super-focus.html' },
      scrollY: 0, pageYOffset: 0,
      scrollTo() {},
      addEventListener() {},
      prompt() { return null; },
      open() { throw new Error('window.open must not be called by the viewer'); },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    fetch(url) { fetchCalls.push(String(url)); return new Promise(() => {}); }, // record + never resolve
    setInterval() { return 0; }, clearInterval() {}, setTimeout(fn) { return 0; }, clearTimeout() {},
    alert() {}, confirm() { return false; },
    console, URLSearchParams, Promise, Object, Array, JSON, Math, Number, String, Boolean, Date, RegExp, Error,
    KeyboardEvent: function () {},
    // The external project-io script is not under test; a no-op stand-in
    // keeps the page's graceful "failed to load" warning out of test output.
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
  sandbox.__fetchCalls = fetchCalls;
  return sandbox;
}

// Simulate the browser finishing the parse: the viewer nodes now exist and
// DOMContentLoaded fires. (getElementById auto-creates stubs, so "existing"
// means: wiring that runs NOW can see them.)
function domReady(sandbox) {
  sandbox.document.readyState = 'interactive';
  sandbox.document.dispatch('DOMContentLoaded');
}

function viewerHidden(sandbox) {
  return sandbox.document.getElementById('mediaViewer').classList.contains('hidden');
}
function openViewer(sandbox, trigger) {
  sandbox.openMediaViewer({ mode: 'image', url: '/api/super-focus/image?id=x&index=1', label: 'Test image', trigger });
}

// ── root cause + required behaviors ──────────────────────────────────────────

test('media viewer: chrome wiring waits for the DOM (parse-order root cause pinned)', () => {
  const sb = loadPage();
  const closeBtn = sb.document.getElementById('mediaViewerClose');
  const backdrop = sb.document.getElementById('mediaViewerBackdrop');
  // Before DOMContentLoaded (the old broken window): nothing wired yet —
  // this is exactly when the removed immediate IIFE used to run and bail.
  assert.equal(closeBtn.listenerCount('click'), 0, 'script eval alone must not have (and cannot) wire the chrome');
  domReady(sb);
  assert.equal(closeBtn.listenerCount('click'), 1, 'close button wired exactly once at DOMContentLoaded');
  assert.equal(backdrop.listenerCount('click'), 1, 'backdrop wired exactly once');
});

test('media viewer: ✕ Close click closes immediately and returns focus to the trigger; one click never reopens', () => {
  const sb = loadPage();
  domReady(sb);
  const trigger = sb.document.createElement();
  openViewer(sb, trigger);
  assert.equal(viewerHidden(sb), false, 'viewer open');
  const closeBtn = sb.document.getElementById('mediaViewerClose');
  closeBtn.click();
  assert.equal(viewerHidden(sb), true, 'close button click closes the viewer');
  assert.equal(trigger.focusCalls, 1, 'focus returned to the exact opening trigger');
  // One click cannot close-and-reopen: fire every remaining click listener
  // on the button again — the viewer stays closed (closeMediaViewer no-ops).
  closeBtn.click();
  assert.equal(viewerHidden(sb), true, 'stays closed');
});

test('media viewer: Escape closes; backdrop click closes; content click does not', () => {
  const sb = loadPage();
  domReady(sb);
  openViewer(sb);
  // Escape arrives on the document (capture handler registered at open).
  sb.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(viewerHidden(sb), true, 'Escape closes');
  // Backdrop click (target === backdrop) closes.
  openViewer(sb);
  const backdrop = sb.document.getElementById('mediaViewerBackdrop');
  backdrop.click();
  assert.equal(viewerHidden(sb), true, 'backdrop click closes');
  // A click on the content/window must not close: the content nodes carry no
  // close listener at all, and a bubbled click whose target is NOT the
  // backdrop is explicitly ignored by the backdrop handler.
  openViewer(sb);
  const content = sb.document.getElementById('mediaViewerContent');
  assert.equal(content.listenerCount('click'), 0, 'content has no click handler');
  const windowEl = sb.document.getElementById('mediaViewerWindow');
  assert.equal(windowEl.listenerCount('click'), 0, 'dialog window has no click handler');
  backdrop.dispatch('click', { target: content }); // bubbled click, non-backdrop target
  assert.equal(viewerHidden(sb), false, 'content click leaves the viewer open');
  sb.closeMediaViewer();
});

test('media viewer: repeated open/close cycles accumulate no duplicate listeners and call no endpoint', () => {
  const sb = loadPage();
  domReady(sb);
  const closeBtn = sb.document.getElementById('mediaViewerClose');
  const baselineDocKeydown = sb.document.listenerCount('keydown');
  for (let i = 0; i < 5; i++) {
    openViewer(sb);
    assert.equal(sb.document.listenerCount('keydown'), baselineDocKeydown + 1, 'exactly one keydown handler while open');
    closeBtn.click();
    assert.equal(viewerHidden(sb), true);
    assert.equal(sb.document.listenerCount('keydown'), baselineDocKeydown, 'keydown handler removed on close');
    assert.equal(closeBtn.listenerCount('click'), 1, 'close wiring never duplicated');
  }
  // Nothing network-shaped happened: no review decision, no queue resume/pump,
  // no generation, no PRESTO — the page made zero fetch calls in total.
  assert.deepEqual(sb.__fetchCalls, [], 'open/close cycles never call any endpoint');
});

test('media viewer: workbench full-res button and ordinary media-row triggers both drive the shared viewer', () => {
  const sb = loadPage();
  domReady(sb);
  // Ordinary row trigger (the real builder used by image/video rows).
  const child = sb.document.createElement();
  const t = sb.buildMediaTrigger(child, { mode: 'image', url: '/api/super-focus/image?id=x&index=2', label: 'Row image', ariaLabel: 'Open image 2' });
  assert.equal(t.getAttribute('role'), 'button');
  assert.equal(t.getAttribute('tabindex'), '0');
  t.click();
  assert.equal(viewerHidden(sb), false, 'row trigger opens the viewer');
  sb.document.getElementById('mediaViewerClose').click();
  assert.equal(viewerHidden(sb), true);
  assert.equal(t.focusCalls, 1, 'focus returns to the row trigger');
  // Workbench path: the fullres onclick passes the button itself as trigger
  // (behavioral equivalent; the exact wiring string is asserted in the
  // workbench UI test).
  const fullresBtn = sb.document.getElementById('wb-fullres');
  sb.openMediaViewer({ mode: 'image', url: '/api/super-focus/image?id=x&index=3', label: 'WB image', trigger: fullresBtn });
  assert.equal(viewerHidden(sb), false);
  sb.document.getElementById('mediaViewerClose').click();
  assert.equal(viewerHidden(sb), true);
  assert.equal(fullresBtn.focusCalls >= 1, true, 'focus returns to the workbench button');
  assert.deepEqual(sb.__fetchCalls, [], 'no endpoint called from either path');
});

// ── static markup guarantees ─────────────────────────────────────────────────

test('media viewer: close button is type="button", outside any form, with no inline JS handlers', () => {
  assert.match(HTML, /<button type="button" id="mediaViewerClose"/, 'explicit type=button (never submits)');
  assert.ok(!/<form[\s>]/.test(HTML), 'page has no form to submit implicitly');
  assert.ok(!/onclick=/.test(HTML), 'no inline JS attributes anywhere on the page');
  // The deferred wiring is present and guarded for both parse states.
  assert.match(HTML, /if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', wireMediaViewerChrome\);/);
  assert.match(HTML, /else wireMediaViewerChrome\(\);/);
});
