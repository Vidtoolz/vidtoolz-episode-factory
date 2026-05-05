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

  const WORKFLOW_FILTERS = [
    "Needs QA repair",
    "Needs package selection",
    "Needs outline",
    "Needs script",
    "Needs production prep",
    "QA not run",
    "Ready to shoot",
  ];

  const FILE_LABELS = [
    ["package_candidates", "package-candidates.json", "Candidates"],
    ["selected_package_json", "selected-package.json", "Selected JSON"],
    ["selected_package_md", "selected-package.md", "Selected MD"],
    ["outline_prompt", "outline-prompt.md", "Outline prompt"],
    ["final_outline", "final-outline.md", "Final outline"],
    ["script_prompt", "script-prompt.md", "Script prompt"],
    ["final_script", "final-script.md", "Final script"],
    ["production_brief", "production-brief.md", "Production brief"],
    ["shooting_plan", "shooting-plan.md", "Shooting plan"],
    ["b_roll_list", "b-roll-list.md", "B-roll list"],
    ["graphics_list", "graphics-list.md", "Graphics list"],
    ["resolve_edit_checklist", "resolve-edit-checklist.md", "Resolve checklist"],
    ["thumbnail_title_check", "thumbnail-title-check.md", "Thumbnail/title"],
    ["publish_pack", "publish-pack.md", "Publish pack"],
    ["creator_qa_package", "creator-qa-package.md", "Creator QA package"],
    ["creator_qa_report", "creator-qa-report.md", "Creator QA report"],
    ["creator_qa_report_json", "creator-qa-report.json", "Creator QA JSON"],
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
      runs: runs.map((run) => {
        const status = String(run.status || "Idea run");
        const creatorQaStatus = String(run.creatorQaStatus || "not run");
        const qaFailed = creatorQaStatus.toUpperCase() === "FAIL";
        const qaNotRun = creatorQaStatus.toLowerCase() === "not run";
        const workflowBucket =
          qaFailed || (status === "Ready to shoot" && qaNotRun)
            ? workflowBucketForStatus(status, creatorQaStatus)
            : String(run.workflowBucket || workflowBucketForStatus(status, creatorQaStatus));
        let nextRecommendedCommand = String(run.nextRecommendedCommand || "");
        if (!nextRecommendedCommand && qaFailed) {
          nextRecommendedCommand = "Review creator-qa-report.md and repair package/script before shooting.";
        } else if (!nextRecommendedCommand && status === "Ready to shoot" && qaNotRun) {
          nextRecommendedCommand = `node scripts/package-run-creator-qa.js ${run.path || "package-runs/YYYY-MM-DD-topic-slug"}`;
        }
        return {
          runId: String(run.runId || ""),
          path: String(run.path || ""),
          title: String(run.title || ""),
          status,
          creatorQaStatus,
          workflowBucket,
          nextExpectedFile: String(run.nextExpectedFile || ""),
          nextRecommendedCommand,
          updatedAt: String(run.updatedAt || ""),
          files: run.files && typeof run.files === "object" ? run.files : {},
        };
      }),
    };
  }

  function filterAndSortRuns(runs, statusFilter = "All", sortMode = "run-desc") {
    const filtered =
      statusFilter === "All"
        ? [...runs]
        : WORKFLOW_FILTERS.includes(statusFilter)
          ? runs.filter((run) => run.workflowBucket === statusFilter)
          : runs.filter((run) => run.workflowBucket === statusFilter || run.status === statusFilter);
    return filtered.sort((a, b) => {
      if (sortMode === "run-asc") return a.runId.localeCompare(b.runId);
      if (sortMode === "status") return statusRank(a.status) - statusRank(b.status) || b.runId.localeCompare(a.runId);
      return b.runId.localeCompare(a.runId);
    });
  }

  function statusClass(status) {
    return `run-status-${String(status || "idea").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function workflowBucketForStatus(status, creatorQaStatus = "not run") {
    const qaStatus = String(creatorQaStatus || "");
    if (qaStatus.toUpperCase() === "FAIL") return "Needs QA repair";
    if (status === "Ready to shoot" && qaStatus.toLowerCase() === "not run") return "QA not run";
    const bucketByStatus = {
      "Idea run": "Needs package selection",
      "Package selected": "Needs outline",
      "Outline prep ready": "Needs outline",
      "Final outline ready": "Needs script",
      "Script prep ready": "Needs script",
      "Final script ready": "Needs production prep",
      "Production prep ready": "Needs production prep",
      "Ready to shoot": "Ready to shoot",
    };
    return bucketByStatus[status] || "Needs package selection";
  }

  function fileHref(run, filename) {
    const base = run.path ? run.path.replace(/\/+$/g, "") : "";
    return base ? `${base}/${filename}` : filename;
  }

  function artifactLabelForFilename(filename) {
    const match = FILE_LABELS.find(([_key, file]) => file === filename);
    return match ? match[2] : filename;
  }

  function renderFilePills(run) {
    const files = run.files || {};
    return FILE_LABELS.map(([key, filename, label]) => {
      const present = Boolean(files[key]);
      if (!present) {
        return `<span class="run-file-pill missing">no ${escapeHtml(label)}</span>`;
      }
      const href = fileHref(run, filename);
      return `<a class="run-file-pill present" href="${escapeHtml(href)}" data-preview-artifact="${escapeHtml(href)}" data-artifact-title="${escapeHtml(label)}" data-run-id="${escapeHtml(run.runId)}">preview ${escapeHtml(label)}</a>`;
    }).join("");
  }

  function flushParagraph(lines, output) {
    if (!lines.length) return;
    output.push(`<p>${lines.join(" ")}</p>`);
    lines.length = 0;
  }

  function flushList(items, output) {
    if (!items.length) return;
    output.push(`<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    items.length = 0;
  }

  function renderInlineMarkdown(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const output = [];
    const paragraph = [];
    const listItems = [];
    let inCode = false;
    let codeLines = [];

    lines.forEach((line) => {
      if (/^```/.test(line.trim())) {
        if (inCode) {
          output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          codeLines = [];
          inCode = false;
        } else {
          flushParagraph(paragraph, output);
          flushList(listItems, output);
          inCode = true;
        }
        return;
      }

      if (inCode) {
        codeLines.push(line);
        return;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph(paragraph, output);
        flushList(listItems, output);
        const level = Math.min(heading[1].length, 4);
        output.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`);
        return;
      }

      const checkbox = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (checkbox) {
        flushParagraph(paragraph, output);
        const checked = checkbox[1].toLowerCase() === "x";
        listItems.push(`<label class="preview-checkbox"><input type="checkbox" disabled ${checked ? "checked" : ""} /> <span>${renderInlineMarkdown(checkbox[2].trim())}</span></label>`);
        return;
      }

      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        flushParagraph(paragraph, output);
        listItems.push(renderInlineMarkdown(bullet[1].trim()));
        return;
      }

      if (!line.trim()) {
        flushParagraph(paragraph, output);
        flushList(listItems, output);
        return;
      }

      flushList(listItems, output);
      paragraph.push(renderInlineMarkdown(line.trim()));
    });

    if (inCode) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    flushParagraph(paragraph, output);
    flushList(listItems, output);
    return output.join("\n") || "<p>No previewable content.</p>";
  }

  function renderNextCommand(run) {
    if (!run.nextRecommendedCommand) {
      return `<div class="run-command done"><span>Next command</span><code>${run.status === "Ready to shoot" ? "Shoot the video." : "Manual review or file edit needed."}</code></div>`;
    }
    const blocking = run.workflowBucket === "Needs QA repair" ? " blocking" : "";
    return `<div class="run-command${blocking}"><span>Next command</span><code>${escapeHtml(run.nextRecommendedCommand)}</code></div>`;
  }

  function creatorQaClass(status) {
    return `creator-qa-${String(status || "not-run").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function renderCreatorQaStatus(run) {
    const status = run.creatorQaStatus || "not run";
    const qaFailed = String(status).toUpperCase() === "FAIL";
    const qaNotRun = String(status).toLowerCase() === "not run";
    const reportHref = run.files && run.files.creator_qa_report ? fileHref(run, "creator-qa-report.md") : "";
    const reportLink = reportHref
      ? `<a href="${escapeHtml(reportHref)}" data-preview-artifact="${escapeHtml(reportHref)}" data-artifact-title="Creator QA report" data-run-id="${escapeHtml(run.runId)}">preview report</a>`
      : "";
    let note = "Run Creator QA before shooting or publishing.";
    if (qaFailed) {
      note = reportLink
        ? `Blocking: ${reportLink} and repair package/script before shooting.`
        : "Blocking: repair package/script before shooting.";
    } else if (reportLink) {
      note = reportLink;
    } else if (qaNotRun) {
      note = "QA not run. Run Creator QA before shooting or publishing.";
    }
    const label = qaFailed ? "Creator QA blocker" : "Creator QA";
    return `<div class="creator-qa-status ${creatorQaClass(status)}"><span>${label}</span><strong>${escapeHtml(status)}</strong><small>${note}</small></div>`;
  }

  function renderRunCard(run) {
    const title = run.title || run.runId;
    const next = run.nextExpectedFile ? `<p class="muted">Next: ${escapeHtml(run.nextExpectedFile)}</p>` : `<p class="muted">Next: shoot the video.</p>`;
    const updated = run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "No tracked files yet";
    const runHref = run.path ? `${run.path}/` : "#";
    const cardClass = run.workflowBucket === "Needs QA repair" ? "package-run-card qa-blocked" : "package-run-card";
    return `
      <article class="${cardClass}">
        <div class="package-card-top">
          <span class="package-number">${escapeHtml(run.runId)}</span>
          <span class="run-status-pill ${statusClass(run.status)}">${escapeHtml(run.status)}</span>
          <span class="run-status-pill ${statusClass(run.workflowBucket)}">${escapeHtml(run.workflowBucket)}</span>
        </div>
        <h2>${escapeHtml(title)}</h2>
        ${next}
        ${renderCreatorQaStatus(run)}
        ${renderNextCommand(run)}
        <div class="package-card-grid">
          <div><span>Updated</span><strong>${escapeHtml(updated)}</strong></div>
          <div><span>Folder</span><strong><a href="${escapeHtml(runHref)}">${escapeHtml(run.path || run.runId)}</a></strong></div>
        </div>
        <div class="run-file-grid">${renderFilePills(run)}</div>
      </article>
    `;
  }

  function renderStats(index) {
    return STATUS_ORDER.map((status) => {
      const count = index.statuses[status] || 0;
      return `<div><span>${escapeHtml(status)}</span><strong>${count}</strong></div>`;
    }).join("");
  }

  function renderWorkflowStats(runs) {
    const counts = WORKFLOW_FILTERS.reduce((result, label) => {
      result[label] = 0;
      return result;
    }, {});
    runs.forEach((run) => {
      const bucket = run.workflowBucket || workflowBucketForStatus(run.status, run.creatorQaStatus);
      counts[bucket] = (counts[bucket] || 0) + 1;
    });
    return WORKFLOW_FILTERS.map((label) => `<div><span>${escapeHtml(label)}</span><strong>${counts[label] || 0}</strong></div>`).join("");
  }

  function createBrowserApp(doc = globalScope.document) {
    const els = {
      status: doc.querySelector("#packageRunsStatus"),
      grid: doc.querySelector("#packageRunsGrid"),
      stats: doc.querySelector("#packageRunsStats"),
      summary: doc.querySelector("#packageRunsSummary"),
      statusFilter: doc.querySelector("#runStatusFilter"),
      sort: doc.querySelector("#runSortSelect"),
      previewPanel: doc.querySelector("#artifactPreviewPanel"),
      previewTitle: doc.querySelector("#artifactPreviewTitle"),
      previewMeta: doc.querySelector("#artifactPreviewMeta"),
      previewContent: doc.querySelector("#artifactPreviewContent"),
      rawLink: doc.querySelector("#artifactRawLink"),
      closePreview: doc.querySelector("#artifactPreviewClose"),
    };
    let index = normalizeIndex({});

    function showStatus(message, type = "") {
      els.status.textContent = message;
      els.status.className = `global-status ${type}`.trim();
    }

    function render() {
      const visible = filterAndSortRuns(index.runs, els.statusFilter.value, els.sort.value);
      els.summary.innerHTML = `<span>${visible.length} shown / ${index.runs.length} total</span><strong>${escapeHtml(index.generatedAt || "No index loaded")}</strong>`;
      els.stats.innerHTML = renderWorkflowStats(index.runs);
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

    function showPreviewLoading(href, title, runId) {
      els.previewPanel.classList.remove("hidden");
      els.previewTitle.textContent = title || artifactLabelForFilename(href.split("/").pop());
      els.previewMeta.textContent = runId ? `${runId} · ${href}` : href;
      els.rawLink.href = href;
      els.previewContent.innerHTML = `<p class="muted">Loading ${escapeHtml(href)}...</p>`;
      els.previewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function showPreviewError(href, error) {
      els.previewContent.innerHTML = `<p class="muted">Could not load ${escapeHtml(href)}. ${escapeHtml(error.message)} The file may require serving this repo root with <code>python3 -m http.server 8010</code>.</p>`;
    }

    function previewArtifact(link) {
      const href = link.getAttribute("href");
      const title = link.dataset.artifactTitle || artifactLabelForFilename(href.split("/").pop());
      const runId = link.dataset.runId || "";
      showPreviewLoading(href, title, runId);
      fetch(href, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}.`);
          return response.text();
        })
        .then((text) => {
          els.previewContent.innerHTML = renderMarkdown(text);
        })
        .catch((error) => showPreviewError(href, error));
    }

    function handleGridClick(event) {
      const link = event.target.closest("[data-preview-artifact]");
      if (!link) return;
      event.preventDefault();
      previewArtifact(link);
    }

    els.statusFilter.addEventListener("change", render);
    els.sort.addEventListener("change", render);
    els.grid.addEventListener("click", handleGridClick);
    els.closePreview.addEventListener("click", () => {
      els.previewPanel.classList.add("hidden");
    });

    return { load, render, previewArtifact };
  }

  const api = {
    STATUS_ORDER,
    WORKFLOW_FILTERS,
    FILE_LABELS,
    escapeHtml,
    statusRank,
    normalizeIndex,
    filterAndSortRuns,
    statusClass,
    workflowBucketForStatus,
    fileHref,
    artifactLabelForFilename,
    renderFilePills,
    renderMarkdown,
    renderNextCommand,
    renderCreatorQaStatus,
    renderRunCard,
    renderStats,
    renderWorkflowStats,
    createBrowserApp,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.PackageRunsDashboard = api;
    createBrowserApp().load();
  }
})(typeof window !== "undefined" ? window : globalThis);
