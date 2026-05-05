(function packageRunsDashboard(globalScope) {
  "use strict";

  const STATUS_ORDER = [
    "Idea run",
    "Package selected",
    "Outline prep ready",
    "Final outline ready",
    "Script prep ready",
    "Final script ready",
    "Production prep ready",
    "Ready to shoot",
  ];

  const FILE_LABELS = [
    ["package_candidates", "Candidates"],
    ["selected_package_json", "Selected JSON"],
    ["selected_package_md", "Selected MD"],
    ["outline_prompt", "Outline prompt"],
    ["final_outline", "Final outline"],
    ["script_prompt", "Script prompt"],
    ["final_script", "Final script"],
    ["production_brief", "Production brief"],
    ["shooting_plan", "Shooting plan"],
    ["b_roll_list", "B-roll list"],
    ["graphics_list", "Graphics list"],
    ["resolve_edit_checklist", "Resolve checklist"],
    ["thumbnail_title_check", "Thumbnail/title"],
    ["publish_pack", "Publish pack"],
  ];

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusRank(status) {
    const index = STATUS_ORDER.indexOf(status);
    return index === -1 ? -1 : index;
  }

  function normalizeIndex(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const runs = Array.isArray(source.runs) ? source.runs : [];
    return {
      project: source.project || "VIDTOOLZ Package Runs",
      generatedAt: source.generatedAt || "",
      runsDir: source.runsDir || "package-runs",
      count: Number.isFinite(source.count) ? source.count : runs.length,
      statuses: source.statuses && typeof source.statuses === "object" ? source.statuses : {},
      runs: runs.map((run) => ({
        runId: String(run.runId || ""),
        path: String(run.path || ""),
        title: String(run.title || ""),
        status: String(run.status || "Idea run"),
        nextExpectedFile: String(run.nextExpectedFile || ""),
        updatedAt: String(run.updatedAt || ""),
        files: run.files && typeof run.files === "object" ? run.files : {},
      })),
    };
  }

  function filterAndSortRuns(runs, statusFilter = "All", sortMode = "run-desc") {
    const filtered = statusFilter === "All" ? [...runs] : runs.filter((run) => run.status === statusFilter);
    return filtered.sort((a, b) => {
      if (sortMode === "run-asc") return a.runId.localeCompare(b.runId);
      if (sortMode === "status") return statusRank(a.status) - statusRank(b.status) || b.runId.localeCompare(a.runId);
      return b.runId.localeCompare(a.runId);
    });
  }

  function statusClass(status) {
    return `run-status-${String(status || "idea").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function renderFilePills(files = {}) {
    return FILE_LABELS.map(([key, label]) => {
      const present = Boolean(files[key]);
      return `<span class="run-file-pill ${present ? "present" : "missing"}">${present ? "yes" : "no"} ${escapeHtml(label)}</span>`;
    }).join("");
  }

  function renderRunCard(run) {
    const title = run.title || run.runId;
    const next = run.nextExpectedFile ? `<p class="muted">Next: ${escapeHtml(run.nextExpectedFile)}</p>` : `<p class="muted">Next: shoot the video.</p>`;
    const updated = run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "No tracked files yet";
    const runHref = run.path ? `${run.path}/` : "#";
    return `
      <article class="package-run-card">
        <div class="package-card-top">
          <span class="package-number">${escapeHtml(run.runId)}</span>
          <span class="run-status-pill ${statusClass(run.status)}">${escapeHtml(run.status)}</span>
        </div>
        <h2>${escapeHtml(title)}</h2>
        ${next}
        <div class="package-card-grid">
          <div><span>Updated</span><strong>${escapeHtml(updated)}</strong></div>
          <div><span>Folder</span><strong><a href="${escapeHtml(runHref)}">${escapeHtml(run.path || run.runId)}</a></strong></div>
        </div>
        <div class="run-file-grid">${renderFilePills(run.files)}</div>
      </article>
    `;
  }

  function renderStats(index) {
    return STATUS_ORDER.map((status) => {
      const count = index.statuses[status] || 0;
      return `<div><span>${escapeHtml(status)}</span><strong>${count}</strong></div>`;
    }).join("");
  }

  function createBrowserApp(doc = globalScope.document) {
    const els = {
      status: doc.querySelector("#packageRunsStatus"),
      grid: doc.querySelector("#packageRunsGrid"),
      stats: doc.querySelector("#packageRunsStats"),
      summary: doc.querySelector("#packageRunsSummary"),
      statusFilter: doc.querySelector("#runStatusFilter"),
      sort: doc.querySelector("#runSortSelect"),
    };
    let index = normalizeIndex({});

    function showStatus(message, type = "") {
      els.status.textContent = message;
      els.status.className = `global-status ${type}`.trim();
    }

    function populateStatusFilter() {
      STATUS_ORDER.forEach((status) => {
        const option = doc.createElement("option");
        option.value = status;
        option.textContent = status;
        els.statusFilter.append(option);
      });
    }

    function render() {
      const visible = filterAndSortRuns(index.runs, els.statusFilter.value, els.sort.value);
      els.summary.innerHTML = `<span>${visible.length} shown / ${index.runs.length} total</span><strong>${escapeHtml(index.generatedAt || "No index loaded")}</strong>`;
      els.stats.innerHTML = renderStats(index);
      els.grid.innerHTML = visible.length
        ? visible.map(renderRunCard).join("")
        : `<p class="muted">No package runs match this filter.</p>`;
    }

    function load() {
      fetch("package-runs-index.json", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error(`Could not load package-runs-index.json (${response.status})`);
          return response.json();
        })
        .then((payload) => {
          index = normalizeIndex(payload);
          showStatus(`Loaded ${index.runs.length} package runs from package-runs-index.json.`, "success");
          render();
        })
        .catch((error) => {
          showStatus(error.message, "error");
          els.grid.innerHTML = `<p class="muted">Run <code>node scripts/package-runs-index.js</code>, then serve this directory locally.</p>`;
        });
    }

    populateStatusFilter();
    els.statusFilter.addEventListener("change", render);
    els.sort.addEventListener("change", render);

    return { load, render };
  }

  const api = {
    STATUS_ORDER,
    FILE_LABELS,
    escapeHtml,
    statusRank,
    normalizeIndex,
    filterAndSortRuns,
    statusClass,
    renderFilePills,
    renderRunCard,
    renderStats,
    createBrowserApp,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.PackageRunsDashboard = api;
    createBrowserApp().load();
  }
})(typeof window !== "undefined" ? window : globalThis);
