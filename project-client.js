/*
 * Shared browser client for the single-project workspace + focus mode.
 * Fetches normalized project state and renders SAFE GUI actions:
 *   - "open" actions are links to in-GUI pages
 *   - "post" actions call existing nonce-gated endpoints (with optional dry-run)
 * There is no "run shell command" path. After a successful mutating action the
 * caller re-resolves project state so the next task advances automatically.
 */
function ProjectClient() {
  let nonce = '';
  let nonceHeader = 'x-vidtoolz-local-write-nonce';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureNonce() {
    if (nonce) return Promise.resolve(nonce);
    return fetch('/api/package-engine/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const p = (body && body.data) ? body.data : body;
        if (p && p.localWriteNonce) { nonce = p.localWriteNonce; nonceHeader = p.nonceHeader || nonceHeader; }
        return nonce;
      })
      .catch(() => '');
  }

  function fetchState(id) {
    return fetch('/api/project-state?package=' + encodeURIComponent(id), { cache: 'no-store' })
      .then((r) => r.json().then((b) => (r.ok ? b : Promise.reject(new Error((b && b.error) || 'server error')))))
      .then((body) => (body && body.data) ? body.data : body);
  }

  function postAction(action, dry) {
    return ensureNonce().then((n) => {
      const headers = { 'Content-Type': 'application/json' };
      headers[nonceHeader] = n;
      const payload = Object.assign({}, action.body || {}, { localWriteNonce: n });
      if (dry) payload.dry_run = true;
      return fetch(action.endpoint, { method: action.method || 'POST', headers, body: JSON.stringify(payload) })
        .then((r) => r.json().then((b) => (r.ok ? b : Promise.reject(new Error((b && b.error) || ('HTTP ' + r.status))))));
    });
  }

  function actionButton(action, onDone, resultEl) {
    if (!action) return '';
    if (action.type === 'open') {
      return '<a class="btn btn-go" href="' + esc(action.href) + '">' + esc(action.label) + ' →</a>';
    }
    // post action: rendered as live buttons wired after insertion
    return '<span data-post="' + esc(action.id) + '"></span>';
  }

  // Render the task's primary (and alternate) action into a container.
  function renderAction(container, task, onDone, resultEl) {
    if (!container) return;
    if (task.blocked) {
      container.innerHTML = '<div class="warn blk">⛔ Blocked: ' + esc(task.blocked_reason || 'a required local service is unavailable.') + '</div>';
      appendEvidence(container, task);
      return;
    }
    const actions = [task.primary_action, task.alternate_action].filter(Boolean);
    container.innerHTML = actions.map((a) => actionButton(a)).join(' ');
    appendEvidence(container, task);
    // Wire post buttons.
    actions.filter((a) => a.type === 'post').forEach((a) => {
      const slot = container.querySelector('[data-post="' + cssEscape(a.id) + '"]');
      if (!slot) return;
      const wrap = document.createElement('span');
      if (a.dry_run) {
        const dry = mkBtn('btn btn-dry', 'Dry run');
        dry.onclick = () => run(a, true, resultEl, onDone, [dry, runBtn]);
        wrap.appendChild(dry);
      }
      const runBtn = mkBtn('btn btn-go', a.label);
      runBtn.onclick = () => run(a, false, resultEl, onDone, [runBtn]);
      wrap.appendChild(runBtn);
      slot.replaceWith(wrap);
    });
  }

  function appendEvidence(container, task) {
    if (task.completion_evidence && task.completion_evidence.length) {
      const ev = document.createElement('div');
      ev.className = 'meta';
      ev.style.marginTop = '10px';
      ev.innerHTML = '<b>Done when:</b> ' + task.completion_evidence.map(esc).join(' · ');
      container.appendChild(ev);
    }
    if (task.note) {
      const n = document.createElement('div');
      n.className = 'meta'; n.style.marginTop = '6px'; n.style.fontStyle = 'italic';
      n.textContent = task.note;
      container.appendChild(n);
    }
  }

  function run(action, dry, resultEl, onDone, btns) {
    btns.forEach((b) => { b.disabled = true; });
    if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = (dry ? 'Dry run…' : 'Running…'); }
    postAction(action, dry)
      .then((body) => {
        const r = (body && body.data) ? body.data : body;
        if (resultEl) resultEl.textContent = (dry ? 'DRY RUN — ' : 'DONE — ') + summarize(r);
        btns.forEach((b) => { b.disabled = false; });
        if (!dry && typeof onDone === 'function') setTimeout(onDone, 600);
      })
      .catch((e) => {
        if (resultEl) resultEl.textContent = 'Error: ' + (e.message || e);
        btns.forEach((b) => { b.disabled = false; });
      });
  }

  function summarize(r) {
    if (!r || typeof r !== 'object') return String(r);
    if (typeof r.imported !== 'undefined' || typeof r.wouldImport !== 'undefined') {
      const n = (r.wouldImport || r.imported || []).length;
      return `${n} file(s), ${(r.duplicates || []).length} duplicate(s), ${r.warningsCount || 0} warning(s).`;
    }
    if (r.status) return `status → ${r.status}.`;
    if (r.job_id || r.job_started) return 'job started.';
    if (r.created || r.files) return 'handoff created.';
    return JSON.stringify(r).slice(0, 200);
  }

  function mkBtn(cls, label) { const b = document.createElement('button'); b.className = cls; b.type = 'button'; b.textContent = label; return b; }
  function cssEscape(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

  return { esc, fetchState, renderAction, postAction };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ProjectClient };
