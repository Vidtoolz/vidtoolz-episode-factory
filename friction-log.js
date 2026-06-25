/**
 * VIDTOOLZ Friction Log UI
 * Structured capture of friction during production runs.
 * Fetches from /api/package-runs/friction-log?run=<runFolder>
 * Saves to /api/package-runs/friction-log/save
 */
(function FrictionLogModule(globalScope) {
  "use strict";

  let currentRun = "";
  let entries = [];
  let lastSavedEntries = [];
  let containerEl = null;
  let localWriteConfig = null;
  let localWriteConfigPromise = null;
  let saveError = "";

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function timestamp() {
    return new Date().toISOString();
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
           d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  const STAGE_OPTIONS = [
    "Idea", "Research", "Script", "Claims", "Packaging",
    "Image Prompts", "Image Gen", "Image Select", "Video Gen",
    "A-Roll", "Assembly", "Publish Gate", "Published",
    "General",
  ];

  const SEVERITY_OPTIONS = ["low", "medium", "high"];

  /**
   * Mount friction log into a container.
   * @param {HTMLElement} container
   * @param {Object} opts - { runFolder }
   */
  function mount(container, opts) {
    if (!container) return;
    containerEl = container;
    currentRun = (opts && opts.runFolder) || "";

    container.innerHTML = `
      <div class="friction-log-panel">
        <div class="friction-log-header">
          <span class="friction-log-title">Friction Log</span>
          <span class="friction-log-count" id="frictionCount">0 entries</span>
        </div>
        <div class="friction-entry-form">
          <input type="text" id="frictionText" placeholder="What went wrong or was slow?" />
          <select id="frictionStage">
            ${STAGE_OPTIONS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
          </select>
          <select id="frictionSeverity">
            ${SEVERITY_OPTIONS.map(s => `<option value="${s}" ${s === "medium" ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <button type="button" class="primary-btn" id="frictionAddBtn">Add Entry</button>
        </div>
        <div class="friction-entries" id="frictionEntries">
          <div style="color:var(--muted);font-size:13px;padding:8px;">Loading...</div>
        </div>
      </div>
    `;

    // Wire up form
    const addBtn = container.querySelector("#frictionAddBtn");
    const textInput = container.querySelector("#frictionText");

    addBtn.addEventListener("click", addEntry);
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addEntry();
      }
    });

    load();
  }

  function loadLocalWriteConfig() {
    if (localWriteConfigPromise) return localWriteConfigPromise;
    localWriteConfigPromise = fetch("/api/package-engine/status", { cache: "no-store" })
      .then((response) => response.json().then((json) => {
        if (!response.ok) throw new Error(json.error || `Local write config unavailable (${response.status})`);
        const payload = json.data !== undefined ? json.data : json;
        if (!payload.localWriteNonce || !payload.nonceHeader) {
          throw new Error("Local write config missing nonce.");
        }
        localWriteConfig = {
          nonceHeader: payload.nonceHeader,
          localWriteNonce: payload.localWriteNonce,
        };
        return localWriteConfig;
      }))
      .catch((error) => {
        localWriteConfig = null;
        localWriteConfigPromise = null;
        throw error;
      });
    return localWriteConfigPromise;
  }

  function load() {
    if (!currentRun) return;
    fetch(`/api/package-runs/friction-log?run=${encodeURIComponent(currentRun)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        const data = json.data !== undefined ? json.data : json;
        entries = data.entries || [];
        lastSavedEntries = entries.map((entry) => ({ ...entry }));
        saveError = "";
        render();
      })
      .catch(() => {
        entries = [];
        render();
      });
  }

  function addEntry() {
    const text = containerEl.querySelector("#frictionText").value.trim();
    const stage = containerEl.querySelector("#frictionStage").value;
    const severity = containerEl.querySelector("#frictionSeverity").value;

    if (!text) return;

    entries.push({
      id: `fl-${Date.now()}`,
      text,
      stage,
      severity,
      timestamp: timestamp(),
      resolved: false,
    });

    containerEl.querySelector("#frictionText").value = "";
    save();
  }

  function toggleResolve(id) {
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      entry.resolved = !entry.resolved;
      save();
    }
  }

  function removeEntry(id) {
    entries = entries.filter((e) => e.id !== id);
    save();
  }

  function setSaving(disabled) {
    if (!containerEl) return;
    containerEl.querySelectorAll("#frictionAddBtn, button[data-action]").forEach((button) => {
      button.disabled = disabled;
    });
  }

  function save(retried) {
    setSaving(true);
    saveError = "";
    return loadLocalWriteConfig()
      .then((config) => fetch("/api/package-runs/friction-log/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [config.nonceHeader]: config.localWriteNonce,
        },
        body: JSON.stringify({
          runFolder: currentRun,
          entries,
          localWriteNonce: config.localWriteNonce,
        }),
      }))
      .then((response) => response.json().then((payload) => {
        if (!response.ok) {
          const error = new Error(payload.error || `Friction log save failed (${response.status})`);
          error.status = response.status;
          throw error;
        }
        return payload;
      }))
      .then(() => {
        lastSavedEntries = entries.map((entry) => ({ ...entry }));
        setSaving(false);
        render();
      })
      .catch((error) => {
        if (error && error.status === 403 && !retried) {
          localWriteConfig = null;
          localWriteConfigPromise = null;
          return save(true);
        }
        saveError = error && error.message ? error.message : "Friction log save failed.";
        entries = lastSavedEntries.map((entry) => ({ ...entry }));
        setSaving(false);
        render();
      });
  }

  function render() {
    if (!containerEl) return;
    const entriesEl = containerEl.querySelector("#frictionEntries");
    const countEl = containerEl.querySelector("#frictionCount");

    if (countEl) {
      const unresolved = entries.filter((e) => !e.resolved).length;
      countEl.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}${unresolved > 0 ? ` (${unresolved} open)` : ""}`;
    }

    const errorHtml = saveError
      ? `<div class="friction-save-error" style="color:var(--danger);font-size:13px;padding:8px;border:1px solid var(--danger);border-radius:4px;margin:8px 0;">${escapeHtml(saveError)}</div>`
      : "";

    if (!entries.length) {
      entriesEl.innerHTML = `
        ${errorHtml}
        <div style="color:var(--muted);font-size:13px;padding:12px;text-align:center;">
          No friction logged yet. Add entries as you encounter issues during production.
        </div>
      `;
      return;
    }

    entriesEl.innerHTML = errorHtml + entries
      .slice()
      .reverse()
      .map((entry) => {
        const severityClass = `friction-entry-severity-${entry.severity || "low"}`;
        return `
          <div class="friction-entry ${entry.resolved ? "resolved" : ""}">
            <div>
              <div class="friction-entry-meta">
                <span class="friction-entry-stage">${escapeHtml(entry.stage || "General")}</span>
                <span class="${severityClass}">${escapeHtml(entry.severity || "low")}</span>
                <span>${escapeHtml(formatTime(entry.timestamp))}</span>
              </div>
              <div class="friction-entry-text">${escapeHtml(entry.text)}</div>
            </div>
            <div class="friction-entry-actions">
              <button type="button" data-action="toggle" data-id="${escapeHtml(entry.id)}">${entry.resolved ? "Reopen" : "Resolve"}</button>
              <button type="button" class="danger-btn" data-action="remove" data-id="${escapeHtml(entry.id)}">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");

    // Wire up action buttons
    entriesEl.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === "toggle") toggleResolve(id);
        if (action === "remove") removeEntry(id);
      });
    });
  }

  globalScope.FrictionLog = {
    mount,
    load,
  };
})(window);
