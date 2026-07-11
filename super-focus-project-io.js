/*
  Super Focus — honest project I/O feedback (usability Slice A).

  Owns two behaviours for super-focus.html, factored out so they are unit
  testable in Node with a fake document + injected api functions (no jsdom):

  1. Create project: an in-flight guard (one action → at most one project),
     an accessible pending state, authoritative-success validation (never
     navigate on a non-2xx / {ok:false} / malformed / id-less response), honest
     failure feedback, and button restoration for retry.

  2. Open list: explicit loading / loaded_empty / loaded_nonempty / error
     states. A network, HTTP, or parse failure is shown as an unavailable
     state — NEVER as the authoritative "no projects" empty message. One
     request at a time; a superseded (older) response cannot overwrite newer
     state.

  Read-only against the API: only the endpoints super-focus.html already calls
  (GET/POST /api/super-focus/projects) are used, with the page's own nonce'd
  apiPost. No new capability, no state-format change. All user-controlled text
  is inserted via textContent (never innerHTML).
*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SuperFocusProjectIO = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Prefer a safe server-provided message; fall back to a stable local string.
  // Never surface stack traces / paths / internals (alert renders plain text).
  function createErrorMessage(res) {
    var msg = res && res.body && res.body.error;
    if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 200);
    return 'unexpected error';
  }

  function isValidProject(proj) {
    return Boolean(proj && typeof proj.project_id === 'string' && proj.project_id.trim());
  }

  // Pure: classify a raw list response. A malformed top-level response (no
  // projects array) is an error, not an authoritative empty result.
  function resolveListOutcome(res, unwrap) {
    if (!res || !res.ok) return { state: 'error' };
    var body = unwrap ? unwrap(res.body) : (res.body || null);
    var projects = body && body.projects;
    if (!Array.isArray(projects)) return { state: 'error' };
    if (projects.length === 0) return { state: 'loaded_empty', projects: [] };
    return { state: 'loaded_nonempty', projects: projects };
  }

  // Create controller.
  // deps: apiPost, unwrap, projectsApi, onPending, onRestore, onSuccess, onError
  function makeCreateController(deps) {
    var inFlight = false;
    function run() {
      if (inFlight) return Promise.resolve();          // guard: double-click / click+Enter
      inFlight = true;
      if (deps.onPending) deps.onPending();
      return Promise.resolve()
        .then(function () { return deps.apiPost(deps.projectsApi, { title: '' }); })
        .then(function (res) {
          if (!res || !res.ok) {
            // A stale backend already shows its own banner; don't stack an alert.
            if (!(res && res.staleBackend) && deps.onError) {
              deps.onError('Could not create project: ' + createErrorMessage(res));
            }
            return;
          }
          var body = deps.unwrap ? deps.unwrap(res.body) : res.body;
          var proj = body && body.project;
          if (!isValidProject(proj)) {                 // malformed success is NOT success
            if (deps.onError) deps.onError('Could not create project: unexpected server response.');
            return;
          }
          if (deps.onSuccess) deps.onSuccess(proj);    // navigate only after authoritative success
        })
        .catch(function () {
          if (deps.onError) deps.onError('Could not create project. Please try again.');
        })
        .then(function () {                            // finally: always clear pending + restore
          inFlight = false;
          if (deps.onRestore) deps.onRestore();
        });
    }
    return { run: run, isInFlight: function () { return inFlight; } };
  }

  // Open/list controller.
  // deps: apiGet, unwrap, projectsApi, onState(state, projects)
  function makeOpenController(deps) {
    var inFlight = false;
    var seq = 0;
    function run() {
      if (inFlight) return Promise.resolve();          // one request at a time
      inFlight = true;
      var mySeq = ++seq;
      if (deps.onState) deps.onState('loading', null);
      return Promise.resolve()
        .then(function () { return deps.apiGet(deps.projectsApi); })
        .then(function (res) {
          if (mySeq !== seq) return;                   // superseded by a newer run
          var outcome = resolveListOutcome(res, deps.unwrap);
          if (deps.onState) deps.onState(outcome.state, outcome.projects || null);
        })
        .catch(function () {
          if (mySeq !== seq) return;
          if (deps.onState) deps.onState('error', null);
        })
        .then(function () {
          if (mySeq === seq) inFlight = false;
        });
    }
    return { run: run, isInFlight: function () { return inFlight; } };
  }

  var LIST_STATE_TEXT = {
    loading: 'Loading projects…',
    error: 'Could not load projects. Choose "Open an existing video project" again to retry.',
    loaded_empty: 'No Super Focus projects yet. Go back and create one.'
  };

  // Render the single status line (#proj-empty) for a list state. The empty
  // wording is used ONLY for loaded_empty; loaded_nonempty hides the line.
  function renderListState(doc, el, state) {
    if (!el) return;
    el.setAttribute('data-state', state);
    if (state === 'loaded_nonempty') { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = LIST_STATE_TEXT[state] || '';
    el.classList.remove('hidden');
  }

  // Build the <li> rows via createElement/textContent (titles stay escaped).
  // A record without a valid project_id is skipped (cannot open); the rest
  // still render. Returns {rendered, skipped}.
  function renderProjectList(doc, listEl, projects, onOpen) {
    if (!listEl) return { rendered: 0, skipped: 0 };
    listEl.innerHTML = '';
    var rendered = 0, skipped = 0;
    (projects || []).forEach(function (p) {
      if (!isValidProject(p)) { skipped += 1; return; }
      var li = doc.createElement('li');
      var left = doc.createElement('div');
      var title = doc.createElement('div');
      title.textContent = (p.title && String(p.title).trim()) ? p.title : '(untitled)';
      title.style.fontWeight = '600';
      var meta = doc.createElement('div');
      meta.className = 'meta';
      meta.textContent = 'stage: ' + (p.stage || 'unknown') + ' · updated ' + String(p.updated_at || '').slice(0, 16).replace('T', ' ');
      left.appendChild(title); left.appendChild(meta);
      var btn = doc.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Open →';
      btn.addEventListener('click', function () { onOpen(p.project_id); });
      li.appendChild(left); li.appendChild(btn);
      listEl.appendChild(li);
      rendered += 1;
    });
    return { rendered: rendered, skipped: skipped };
  }

  // Apply a resolved list state to the DOM. For any non-populated state the
  // list is cleared first, so a failed refresh never leaves a prior list shown
  // as though it were current.
  function applyListState(doc, els, state, projects, onOpen) {
    els = els || {};
    if (state === 'loaded_nonempty') {
      renderProjectList(doc, els.listEl, projects, onOpen);
    } else if (els.listEl) {
      els.listEl.innerHTML = '';
    }
    renderListState(doc, els.emptyEl, state);
  }

  return {
    createErrorMessage: createErrorMessage,
    isValidProject: isValidProject,
    resolveListOutcome: resolveListOutcome,
    makeCreateController: makeCreateController,
    makeOpenController: makeOpenController,
    renderListState: renderListState,
    renderProjectList: renderProjectList,
    applyListState: applyListState,
    LIST_STATE_TEXT: LIST_STATE_TEXT
  };
});
