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

  // ── Project lifecycle picker (archive / restore / permanent delete) ───────
  // Extends the Open-a-Project view with two modes (normal + archived) and
  // per-row lifecycle actions. Same discipline as above: injected api + fake
  // document for unit tests, textContent for all user-controlled text, and a
  // shared sequence token so a stale list response (either mode) can never
  // repaint over a newer one — e.g. resurrect a just-archived project into the
  // normal list. The server stays authoritative: every refresh refetches BOTH
  // lists in one snapshot.

  var ARCHIVED_LIST_STATE_TEXT = {
    loading: 'Loading archived projects…',
    error: 'Could not load archived projects. Choose "Archived Projects" again to retry.',
    loaded_empty: 'No archived projects.'
  };

  // Build one project row with Open + lifecycle actions. The immutable
  // project_id is captured per row (closures act on the exact id, never a
  // shared mutable variable), so duplicate display titles stay unambiguous.
  // handlers: { onOpen, onArchive, onDelete } (normal) / { onOpen, onRestore,
  // onDelete } (archived) — each receives (project_id, projectSummary).
  function renderLifecycleRows(doc, listEl, projects, mode, handlers) {
    if (!listEl) return { rendered: 0, skipped: 0 };
    listEl.innerHTML = '';
    var archived = mode === 'archived';
    var h = handlers || {};
    var rendered = 0, skipped = 0;
    (projects || []).forEach(function (p) {
      if (!isValidProject(p)) { skipped += 1; return; }
      var pid = p.project_id;                       // immutable id for this row's closures
      var li = doc.createElement('li');
      var left = doc.createElement('div');
      var title = doc.createElement('div');
      title.textContent = (p.title && String(p.title).trim()) ? p.title : '(untitled)';
      title.style.fontWeight = '600';
      var meta = doc.createElement('div');
      meta.className = 'meta';
      meta.textContent = pid + ' · stage: ' + (p.stage || 'unknown') + ' · updated ' + String(p.updated_at || '').slice(0, 16).replace('T', ' ');
      left.appendChild(title); left.appendChild(meta);
      var actions = doc.createElement('div');
      actions.className = 'proj-actions';
      function actionBtn(label, cls, fn) {
        var b = doc.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.addEventListener('click', function () { if (fn) fn(pid, p); });
        actions.appendChild(b);
        return b;
      }
      actionBtn('Open', 'btn primary', h.onOpen);
      if (archived) actionBtn('Restore', 'btn', h.onRestore);
      else actionBtn('Archive', 'btn', h.onArchive);
      actionBtn('Delete', 'btn danger', h.onDelete);
      li.appendChild(left); li.appendChild(actions);
      listEl.appendChild(li);
      rendered += 1;
    });
    return { rendered: rendered, skipped: skipped };
  }

  // Apply one list state to the picker DOM for the given mode (normal vs
  // archived wording differs; behaviour is identical).
  function applyPickerState(doc, els, state, projects, mode, handlers) {
    els = els || {};
    if (state === 'loaded_nonempty') {
      renderLifecycleRows(doc, els.listEl, projects, mode, handlers);
    } else if (els.listEl) {
      els.listEl.innerHTML = '';
    }
    var el = els.emptyEl;
    if (!el) return;
    var textMap = mode === 'archived' ? ARCHIVED_LIST_STATE_TEXT : LIST_STATE_TEXT;
    el.setAttribute('data-state', state);
    if (state === 'loaded_nonempty') { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = textMap[state] || '';
    el.classList.remove('hidden');
  }

  // Picker controller: owns the current mode and one shared sequence across
  // BOTH lists. refresh() fetches the normal and archived lists together (one
  // authoritative snapshot — a lifecycle change refreshes both, so the moved
  // project appears in exactly one list). A superseded response is dropped
  // whole: it can neither repaint the visible list nor update the count.
  // deps: apiGet, unwrap, projectsApi, archivedProjectsApi,
  //       onRender(mode, state, projects, archivedCount)
  function makePickerController(deps) {
    var seq = 0;
    var mode = 'active';
    function fetchList(api) {
      return Promise.resolve()
        .then(function () { return deps.apiGet(api); })
        .then(function (res) { return resolveListOutcome(res, deps.unwrap); })
        .catch(function () { return { state: 'error' }; });
    }
    function refresh() {
      var mySeq = ++seq;
      var myMode = mode;
      if (deps.onRender) deps.onRender(myMode, 'loading', null, null);
      return Promise.all([fetchList(deps.projectsApi), fetchList(deps.archivedProjectsApi)])
        .then(function (outcomes) {
          if (mySeq !== seq) return;                 // superseded — drop whole snapshot
          var active = outcomes[0], archived = outcomes[1];
          var archivedCount = archived.state === 'error' ? null : (archived.projects || []).length;
          var visible = (mode === 'archived') ? archived : active;
          if (deps.onRender) deps.onRender(mode, visible.state, visible.projects || null, archivedCount);
        });
    }
    function setMode(next) {
      mode = next === 'archived' ? 'archived' : 'active';
      return refresh();
    }
    return {
      refresh: refresh,
      setMode: setMode,
      getMode: function () { return mode; }
    };
  }

  // ── Lifecycle confirmation controller ─────────────────────────────────────
  // One inline confirmation panel serves Archive (single explicit confirm —
  // reversible) and Delete (typed "DELETE" gate — permanent). Restore is not
  // confirmed here (non-destructive; it runs directly with a busy state).
  // The panel never closes on failure: the error stays visible with the same
  // project context so the operator can retry or cancel. While a request is in
  // flight the confirm button is disabled — repeated clicks send one request.
  var DELETE_CONFIRM_TOKEN = 'DELETE';

  function deleteConfirmReady(value) {
    return String(value || '') === DELETE_CONFIRM_TOKEN;
  }

  var CONFIRM_COPY = {
    archive: {
      heading: function (t) { return 'Archive “' + t + '”?'; },
      message: 'The project will be removed from the normal project list but preserved in Archived Projects. It can be opened or restored later. Its generated media stays where it is.',
      confirmLabel: 'Archive Project',
      busyLabel: 'Archiving…'
    },
    delete: {
      heading: function (t) { return 'Permanently delete “' + t + '”?'; },
      message: 'This permanently removes the Super Focus project and the files inside its project directory. Generated media referenced outside the project directory (e.g. on VIDNAS) is NOT deleted. This action cannot be undone.',
      confirmLabel: 'Permanently Delete',
      busyLabel: 'Deleting…'
    }
  };

  // deps: els { panel, title, meta, message, inputWrap, input, error,
  //             confirmBtn, cancelBtn }, request(action, projectId) -> Promise
  //       of {ok, status, body}, onDone(action, projectId, res), createErrorMessage
  // All labels/text go through textContent (titles stay escaped).
  function makeLifecycleConfirmController(deps) {
    var els = deps.els || {};
    var state = { action: null, projectId: null, busy: false };

    function setError(msg) { if (els.error) els.error.textContent = msg || ''; }

    function updateConfirmEnabled() {
      if (!els.confirmBtn) return;
      if (state.busy) { els.confirmBtn.disabled = true; return; }
      if (state.action === 'delete') {
        els.confirmBtn.disabled = !deleteConfirmReady(els.input ? els.input.value : '');
      } else {
        els.confirmBtn.disabled = false;
      }
    }

    function open(action, project) {
      var copy = CONFIRM_COPY[action];
      if (!copy || !project || !project.project_id) return;
      state.action = action;
      state.projectId = project.project_id;   // immutable id — never the display title
      state.busy = false;
      var displayTitle = (project.title && String(project.title).trim()) ? project.title : '(untitled)';
      if (els.title) els.title.textContent = copy.heading(displayTitle);
      if (els.meta) els.meta.textContent = 'Project id: ' + project.project_id;
      if (els.message) els.message.textContent = copy.message;
      if (els.confirmBtn) els.confirmBtn.textContent = copy.confirmLabel;
      if (els.input) els.input.value = '';
      if (els.inputWrap) els.inputWrap.classList.toggle('hidden', action !== 'delete');
      // Archive is reversible — visually secondary. Only permanent deletion
      // gets the destructive treatment.
      if (els.panel) els.panel.classList.toggle('danger-mode', action === 'delete');
      if (els.confirmBtn && els.confirmBtn.classList) els.confirmBtn.classList.toggle('danger', action === 'delete');
      setError('');
      updateConfirmEnabled();
      if (els.panel) els.panel.classList.remove('hidden');
    }

    function close() {
      if (state.busy) return false;           // never close mid-request
      state.action = null;
      state.projectId = null;
      if (els.input) els.input.value = '';
      setError('');
      if (els.panel) els.panel.classList.add('hidden');
      return true;
    }

    function confirm() {
      if (state.busy || !state.action || !state.projectId) return Promise.resolve();
      if (state.action === 'delete' && !deleteConfirmReady(els.input ? els.input.value : '')) {
        return Promise.resolve();             // Enter cannot trigger an invalid deletion
      }
      var action = state.action;
      var projectId = state.projectId;
      var copy = CONFIRM_COPY[action];
      state.busy = true;
      setError('');
      if (els.confirmBtn) { els.confirmBtn.disabled = true; els.confirmBtn.textContent = copy.busyLabel; }
      if (els.cancelBtn) els.cancelBtn.disabled = true;
      return Promise.resolve()
        .then(function () { return deps.request(action, projectId); })
        .catch(function () { return { ok: false, status: 0, body: { error: 'request failed — check the cockpit service and try again' } }; })
        .then(function (res) {
          state.busy = false;
          if (els.confirmBtn) els.confirmBtn.textContent = copy.confirmLabel;
          if (els.cancelBtn) els.cancelBtn.disabled = false;
          if (!res || !res.ok) {
            // Keep the panel open with full context; operator can retry or cancel.
            setError('Could not ' + action + ' project: ' + (deps.createErrorMessage || createErrorMessage)(res));
            updateConfirmEnabled();
            return;
          }
          close();
          if (deps.onDone) deps.onDone(action, projectId, res);
        });
    }

    return {
      open: open,
      close: close,
      confirm: confirm,
      updateConfirmEnabled: updateConfirmEnabled,
      isBusy: function () { return state.busy; },
      current: function () { return { action: state.action, projectId: state.projectId }; }
    };
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
    LIST_STATE_TEXT: LIST_STATE_TEXT,
    ARCHIVED_LIST_STATE_TEXT: ARCHIVED_LIST_STATE_TEXT,
    DELETE_CONFIRM_TOKEN: DELETE_CONFIRM_TOKEN,
    deleteConfirmReady: deleteConfirmReady,
    renderLifecycleRows: renderLifecycleRows,
    applyPickerState: applyPickerState,
    makePickerController: makePickerController,
    makeLifecycleConfirmController: makeLifecycleConfirmController
  };
});
