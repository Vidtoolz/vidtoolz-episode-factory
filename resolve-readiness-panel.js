/**
 * VIDTOOLZ "Ready for Resolve" panel (B2-A)
 *
 * Read-only, advisory checklist answering ONE question: is the SYSTEM side of this
 * run finished, so it can be handed to DaVinci Resolve? It stops at the handoff
 * boundary — it never tracks editing, export, or publishing (Mikko's domain).
 *
 * Fetches GET /api/package-runs/resolve-readiness?run=<runFolder>&package=<packageId>.
 * The package id is read from the per-run key the Shorts cockpit stores
 * (vidtoolz-shorts-package-id::<runId>); a small input lets the operator set/override it.
 */
(function ResolveReadinessModule(globalScope) {
  "use strict";

  const doc = globalScope.document;
  let containerEl = null;
  let currentRun = "";

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function pkgKey(runFolder) {
    return runFolder ? "vidtoolz-shorts-package-id::" + runFolder : "";
  }

  function readStoredPackageId(runFolder) {
    try {
      const key = pkgKey(runFolder);
      return key ? (globalScope.localStorage.getItem(key) || "") : "";
    } catch (_e) {
      return "";
    }
  }

  function storePackageId(runFolder, value) {
    try {
      const key = pkgKey(runFolder);
      if (!key) return;
      if (value) globalScope.localStorage.setItem(key, value);
      else globalScope.localStorage.removeItem(key);
    } catch (_e) {
      // localStorage unavailable — non-fatal; the field still drives this fetch.
    }
  }

  const STATUS_GLYPH = { ready: "✓", partial: "◐", missing: "▢", unknown: "?" };

  function renderItem(item) {
    const glyph = STATUS_GLYPH[item.status] || "▢";
    return `
      <li class="rr-item rr-${escapeHtml(item.status)}">
        <span class="rr-glyph" aria-hidden="true">${glyph}</span>
        <span class="rr-label">${escapeHtml(item.label)}</span>
        <span class="rr-detail">${escapeHtml(item.detail || "")}</span>
      </li>`;
  }

  function render(data, packageId) {
    if (!containerEl) return;
    const items = (data && Array.isArray(data.items)) ? data.items : [];
    const verdictClass = data && data.ready ? "rr-ready" : "rr-not-ready";
    const verdictText = data && data.ready ? "Ready for Resolve" : "Not yet ready for Resolve";
    containerEl.innerHTML = `
      <div class="resolve-readiness-panel ${verdictClass}">
        <div class="rr-header">
          <h2>Ready for Resolve?</h2>
          <span class="rr-badge">${escapeHtml(verdictText)}</span>
        </div>
        <p class="muted rr-scope">System-side completeness only. Editing, export, and publishing stay in Resolve — this checklist stops at the handoff.</p>
        <ul class="rr-list">${items.map(renderItem).join("")}</ul>
        <p class="rr-next"><strong>Next:</strong> ${escapeHtml((data && data.nextAction) || "")}</p>
        <div class="rr-pkg">
          <label>aigen package id
            <input type="text" id="rrPackageId" value="${escapeHtml(packageId || "")}" placeholder="link this run's package to check media" />
          </label>
          <button type="button" id="rrRefresh" class="primary-btn">Check</button>
        </div>
      </div>`;
    const input = containerEl.querySelector("#rrPackageId");
    const btn = containerEl.querySelector("#rrRefresh");
    if (btn && input) {
      btn.addEventListener("click", function () {
        const value = input.value.trim();
        storePackageId(currentRun, value);
        load();
      });
    }
  }

  function renderError(message) {
    if (!containerEl) return;
    containerEl.innerHTML = `<div class="resolve-readiness-panel"><div style="color:var(--muted);font-size:13px;padding:8px;">Ready-for-Resolve check unavailable: ${escapeHtml(message)}</div></div>`;
  }

  function load() {
    if (!currentRun) return;
    const packageId = readStoredPackageId(currentRun);
    const qs = "?run=" + encodeURIComponent(currentRun) + (packageId ? "&package=" + encodeURIComponent(packageId) : "");
    globalScope.fetch("/api/package-runs/resolve-readiness" + qs)
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        if (payload && payload.ok) render(payload.data, packageId);
        else renderError((payload && payload.error) || "unexpected response");
      })
      .catch(function (err) { renderError((err && err.message) || "request failed"); });
  }

  /**
   * Mount the panel into a container.
   * @param {HTMLElement} container
   * @param {Object} opts - { runFolder }
   */
  function mount(container, opts) {
    if (!container) return;
    containerEl = container;
    currentRun = (opts && opts.runFolder) || "";
    container.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px;">Checking Resolve readiness…</div>`;
    load();
  }

  globalScope.ResolveReadiness = { mount: mount };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { mount: mount };
  }
})(typeof window !== "undefined" ? window : this);
