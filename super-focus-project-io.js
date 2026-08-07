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

  // ── Project health decoration (read-only summary) ─────────────────────────
  // Compact, honest per-row health surfaced from the aggregate health endpoint.
  // Every value goes through textContent (no markup). Rendering NEVER dispatches
  // a mutation — it only reads a health object already fetched read-only. Status
  // is carried by TEXT (health_label + labelled facts), never colour alone.

  // Human labels for the fact keys shown in the expandable details panel. Order
  // matters: this is the disclosure order.
  var HEALTH_FACT_ROWS = [
    ['stage_label', 'Stage'],
    ['image_prompt_count', 'Image prompts'],
    ['i2v_prompt_count', 'Motion prompts'],
    ['image_count', 'Images on disk'],
    ['video_count', 'Videos on disk'],
    ['stale_image_count', 'Stale images'],
    ['stale_video_count', 'Stale videos'],
    ['failed_video_count', 'Failed / interrupted videos'],
    ['unknown_provenance_video_count', 'Clips of unknown provenance'],
    ['queue_state', 'Video queue']
  ];

  // Value formatter: null/undefined → "unknown" (never fabricated as 0). This is
  // the UI half of the truthfulness contract — a count we could not read is
  // shown as unknown, not zero.
  function healthFactValue(facts, key) {
    if (key === 'stage_label') return facts && facts.stage_label ? facts.stage_label : '—';
    if (key === 'queue_state') {
      var q = facts && facts.queue_state;
      if (!q || q === 'unknown') return 'unknown';
      return q === 'none' ? 'idle' : q;
    }
    var v = facts ? facts[key] : null;
    if (v == null) return 'unknown';
    return String(v);
  }

  // Attach the compact summary line + an accessible, collapsible details panel
  // to one already-built row. `left` gets the one-liner; the row gets a separate
  // health block (as its own child so lifecycle action buttons are untouched).
  function attachHealthToRow(doc, li, left, health) {
    if (!health) return;
    var summary = doc.createElement('div');
    summary.className = 'sf-health-summary';
    summary.setAttribute('data-health-state', health.health_state || '');
    var badge = doc.createElement('span');
    badge.className = 'sf-health-badge';
    badge.textContent = health.health_label || '';
    var line = doc.createElement('span');
    line.className = 'sf-health-line';
    line.textContent = health.summary_line ? (' ' + health.summary_line) : '';
    summary.appendChild(badge); summary.appendChild(line);
    left.appendChild(summary);

    var next = doc.createElement('div');
    next.className = 'sf-health-next';
    next.textContent = 'Next: ' + (health.next_safe_action || '');
    left.appendChild(next);

    // Details: readable rows only (an unreadable row carries no facts).
    if (!health.facts) return;
    var block = doc.createElement('div');
    block.className = 'sf-health-block';
    var toggle = doc.createElement('button');
    toggle.className = 'btn sf-health-toggle';
    toggle.setAttribute('type', 'button');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Details';
    var panel = doc.createElement('div');
    panel.className = 'sf-health-details';
    panel.classList.add('hidden');
    HEALTH_FACT_ROWS.forEach(function (row) {
      var r = doc.createElement('div');
      r.className = 'sf-health-detail-row';
      var k = doc.createElement('span'); k.className = 'sf-health-detail-key'; k.textContent = row[1] + ': ';
      var val = doc.createElement('span'); val.className = 'sf-health-detail-val'; val.textContent = healthFactValue(health.facts, row[0]);
      r.appendChild(k); r.appendChild(val);
      panel.appendChild(r);
    });
    if (!health.facts.media_available) {
      var note = doc.createElement('div');
      note.className = 'sf-health-detail-note';
      note.textContent = 'Media evidence unavailable — open the project for per-asset status.';
      panel.appendChild(note);
    }
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      panel.classList.toggle('hidden', open);
    });
    block.appendChild(toggle); block.appendChild(panel);
    // Appended inside `left` (not the row) so the flex row stays [left, actions]
    // — lifecycle buttons and their positions are untouched.
    left.appendChild(block);
  }

  // An unreadable/corrupt project row: surfaced with a clear recovery message,
  // never silently omitted, never auto-repaired. Only safe recovery actions are
  // offered (Delete, and Restore when archived) — no Open (it cannot be read).
  function renderUnreadableRow(doc, listEl, entry, mode, handlers) {
    var h = handlers || {};
    var pid = entry.project_id;
    var summary = { project_id: pid, title: '' };
    var li = doc.createElement('li');
    li.className = 'sf-health-unreadable';
    var left = doc.createElement('div');
    var title = doc.createElement('div');
    title.textContent = pid;
    title.style.fontWeight = '600';
    var meta = doc.createElement('div');
    meta.className = 'meta';
    meta.textContent = entry.summary_line || 'Project state could not be read. Recovery inspection required.';
    left.appendChild(title); left.appendChild(meta);
    var next = doc.createElement('div');
    next.className = 'sf-health-next';
    next.textContent = 'Next: ' + (entry.next_safe_action || '');
    left.appendChild(next);
    var actions = doc.createElement('div');
    actions.className = 'proj-actions';
    function actionBtn(label, cls, fn) {
      var b = doc.createElement('button');
      b.className = cls; b.textContent = label;
      b.addEventListener('click', function () { if (fn) fn(pid, summary); });
      actions.appendChild(b);
    }
    if (mode === 'archived') actionBtn('Restore', 'btn', h.onRestore);
    actionBtn('Delete', 'btn danger', h.onDelete);
    li.appendChild(left); li.appendChild(actions);
    listEl.appendChild(li);
  }

  // Build one project row with Open + lifecycle actions. The immutable
  // project_id is captured per row (closures act on the exact id, never a
  // shared mutable variable), so duplicate display titles stay unambiguous.
  // handlers: { onOpen, onArchive, onDelete } (normal) / { onOpen, onRestore,
  // onDelete } (archived) — each receives (project_id, projectSummary).
  // healthList (optional): the aggregate health entries for THIS mode. Readable
  // entries decorate their matching row (by project_id); unreadable entries not
  // present in `projects` are appended as recovery rows (corrupt projects are
  // never dropped).
  function renderLifecycleRows(doc, listEl, projects, mode, handlers, healthList) {
    if (!listEl) return { rendered: 0, skipped: 0 };
    listEl.innerHTML = '';
    var archived = mode === 'archived';
    var h = handlers || {};
    var healthById = {};
    (Array.isArray(healthList) ? healthList : []).forEach(function (e) {
      if (e && typeof e.project_id === 'string') healthById[e.project_id] = e;
    });
    var seen = {};
    var rendered = 0, skipped = 0;
    (projects || []).forEach(function (p) {
      if (!isValidProject(p)) { skipped += 1; return; }
      var pid = p.project_id;                       // immutable id for this row's closures
      seen[pid] = true;
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
      // Decorate with health only if a readable entry exists for this project.
      var hEntry = healthById[pid];
      if (hEntry && hEntry.readable !== false) attachHealthToRow(doc, li, left, hEntry);
      listEl.appendChild(li);
      rendered += 1;
    });
    // Append corrupt/unreadable projects that never made it into `projects`.
    var unreadable = 0;
    Object.keys(healthById).forEach(function (pid) {
      var e = healthById[pid];
      if (e && e.readable === false && !seen[pid]) { renderUnreadableRow(doc, listEl, e, mode, h); unreadable += 1; }
    });
    return { rendered: rendered, skipped: skipped, unreadable: unreadable };
  }

  // Apply one list state to the picker DOM for the given mode (normal vs
  // archived wording differs; behaviour is identical). healthList (optional):
  // the aggregate health entries for this mode, used to decorate rows and to
  // surface corrupt projects. When a mode has ONLY unreadable projects, the
  // list is still populated with recovery rows even though `state` is empty.
  function applyPickerState(doc, els, state, projects, mode, handlers, healthList) {
    els = els || {};
    var unreadableHere = (Array.isArray(healthList) ? healthList : [])
      .filter(function (e) { return e && e.readable === false; }).length;
    if (state === 'loaded_nonempty' || unreadableHere > 0) {
      renderLifecycleRows(doc, els.listEl, projects, mode, handlers, healthList);
    } else if (els.listEl) {
      els.listEl.innerHTML = '';
    }
    // A mode that is "empty" only because its sole projects are corrupt must not
    // show the reassuring "no projects" line — the recovery rows are the truth.
    if (state !== 'loaded_nonempty' && unreadableHere > 0) {
      var el0 = els.emptyEl;
      if (el0) { el0.setAttribute('data-state', state); el0.classList.add('hidden'); el0.textContent = ''; }
      return;
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
  //       healthApi (optional), onRender(mode, state, projects, archivedCount, healthList)
  // When healthApi is set, refresh() also fetches the read-only aggregate health
  // ({ active, archived }) in the SAME snapshot and passes the current mode's
  // entries as healthList. Health is best-effort: a failed/absent health fetch
  // degrades to null (rows render without summaries) and never blocks the lists.
  function makePickerController(deps) {
    var seq = 0;
    var mode = 'active';
    function fetchList(api) {
      return Promise.resolve()
        .then(function () { return deps.apiGet(api); })
        .then(function (res) { return resolveListOutcome(res, deps.unwrap); })
        .catch(function () { return { state: 'error' }; });
    }
    function fetchHealth() {
      if (!deps.healthApi) return Promise.resolve(null);
      return Promise.resolve()
        .then(function () { return deps.apiGet(deps.healthApi); })
        .then(function (res) {
          if (!res || !res.ok) return null;
          var body = deps.unwrap ? deps.unwrap(res.body) : res.body;
          return body && typeof body === 'object' ? body : null;
        })
        .catch(function () { return null; });
    }
    function refresh() {
      var mySeq = ++seq;
      var myMode = mode;
      if (deps.onRender) deps.onRender(myMode, 'loading', null, null, null);
      return Promise.all([fetchList(deps.projectsApi), fetchList(deps.archivedProjectsApi), fetchHealth()])
        .then(function (outcomes) {
          if (mySeq !== seq) return;                 // superseded — drop whole snapshot
          var active = outcomes[0], archived = outcomes[1], health = outcomes[2];
          var archivedCount = archived.state === 'error' ? null : (archived.projects || []).length;
          var visible = (mode === 'archived') ? archived : active;
          var healthList = health ? (mode === 'archived' ? health.archived : health.active) : null;
          if (deps.onRender) deps.onRender(mode, visible.state, visible.projects || null, archivedCount, healthList || null);
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
    makeLifecycleConfirmController: makeLifecycleConfirmController,
    attachHealthToRow: attachHealthToRow,
    renderUnreadableRow: renderUnreadableRow,
    healthFactValue: healthFactValue,
    HEALTH_FACT_ROWS: HEALTH_FACT_ROWS
  };
});
