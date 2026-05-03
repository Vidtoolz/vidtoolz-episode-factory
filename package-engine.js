(function packageEngineApp() {
  "use strict";

  const model = window.PackageEngineModel;
  const runTools = window.PackageEngineRun;
  const els = {
    status: document.querySelector("#packageStatus"),
    grid: document.querySelector("#packageGrid"),
    sort: document.querySelector("#sortSelect"),
    filter: document.querySelector("#recommendationFilter"),
    count: document.querySelector("#candidateCount"),
    selectedSummary: document.querySelector("#selectedSummary"),
    downloadJson: document.querySelector("#downloadJsonBtn"),
    downloadMarkdown: document.querySelector("#downloadMarkdownBtn"),
  };

  let candidateSet = { project: "VIDTOOLZ Package Engine", generatedAt: "", candidates: [] };
  let candidateSource = "package-candidates.json";
  let selectedId = "";
  let expandedIds = new Set();

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function showStatus(message, type = "") {
    els.status.textContent = message;
    els.status.className = `global-status ${type}`.trim();
  }

  function visibleCandidates() {
    const filtered = model.filterPackageCandidates(candidateSet.candidates, els.filter.value);
    return model.sortPackageCandidates(filtered, els.sort.value);
  }

  function selectedCandidate() {
    return candidateSet.candidates.find((candidate) => candidate.id === selectedId) || null;
  }

  function recommendationClass(value) {
    return `recommendation-${String(value || "Maybe").toLowerCase()}`;
  }

  function renderStrategicDetails(candidate) {
    return model.STRATEGIC_FIELDS.map(
      (field) => `
        <div>
          <h4>${escapeHtml(field.replace(/_/g, " "))}</h4>
          <p>${escapeHtml(candidate[field] || "Not specified.")}</p>
        </div>
      `
    ).join("");
  }

  function renderCard(candidate) {
    const expanded = expandedIds.has(candidate.id);
    const selected = candidate.id === selectedId;
    const shorts = candidate.shortsIdeas
      .filter(Boolean)
      .map((idea) => `<li>${escapeHtml(idea)}</li>`)
      .join("");
    const article = document.createElement("article");
    article.className = selected ? "package-card selected" : "package-card";
    article.innerHTML = `
      <div class="package-card-top">
        <span class="package-number">#${candidate.packageNumber}</span>
        <span class="score-pill">${candidate.score}/100</span>
        <span class="recommendation-pill ${recommendationClass(candidate.recommendation)}">${escapeHtml(candidate.recommendation)}</span>
      </div>
      <h2>${escapeHtml(candidate.proposedTitle || "Untitled package")}</h2>
      <p>${escapeHtml(candidate.idea || "No idea recorded.")}</p>
      <div class="package-card-grid">
        <div><span>Thumbnail</span><strong>${escapeHtml(candidate.thumbnailConcept || "Not specified.")}</strong></div>
        <div><span>On-thumbnail text</span><strong>${escapeHtml(candidate.onThumbnailText || "Not specified.")}</strong></div>
        <div><span>Viewer promise</span><strong>${escapeHtml(candidate.viewerPromise || "Not specified.")}</strong></div>
        <div><span>Target viewer</span><strong>${escapeHtml(candidate.targetViewer || "Not specified.")}</strong></div>
        <div><span>Difficulty</span><strong>${escapeHtml(candidate.productionDifficulty)}</strong></div>
        <div><span>Main risk</span><strong>${escapeHtml(candidate.mainRisk || "Not specified.")}</strong></div>
      </div>
      <div class="shorts-list">
        <h3>Shorts Ideas</h3>
        <ol>${shorts || "<li>Not specified.</li>"}</ol>
      </div>
      <div class="package-actions">
        <button type="button" data-toggle="${escapeHtml(candidate.id)}">${expanded ? "Hide details" : "Expand details"}</button>
        <button class="primary-btn" type="button" data-select="${escapeHtml(candidate.id)}">${selected ? "Winner selected" : "Select winner"}</button>
      </div>
      ${
        expanded
          ? `
            <section class="package-detail">
              <h3>Strategic Rationale</h3>
              <div class="strategic-grid">${renderStrategicDetails(candidate)}</div>
            </section>
          `
          : ""
      }
    `;
    return article;
  }

  function render() {
    const visible = visibleCandidates();
    const selected = selectedCandidate();
    els.count.textContent = `${visible.length} shown / ${candidateSet.candidates.length} total`;
    els.selectedSummary.textContent = selected
      ? `Selected #${selected.packageNumber}: ${selected.proposedTitle}`
      : "No winner selected";
    els.downloadJson.disabled = !selected;
    els.downloadMarkdown.disabled = !selected;
    els.grid.innerHTML = "";
    if (!visible.length) {
      els.grid.innerHTML = `<p class="muted">No candidates match this filter.</p>`;
      return;
    }
    visible.forEach((candidate) => els.grid.append(renderCard(candidate)));
  }

  function downloadTextFile(filename, text, mimeType = "text/plain") {
    const blob = new Blob([`${text}\n`], { type: mimeType });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadSelectedJson() {
    const selected = selectedCandidate();
    if (!selected) return;
    downloadTextFile("selected-package.json", JSON.stringify(model.buildSelectedPackageJson(selected), null, 2), "application/json");
    showStatus("selected-package.json downloaded.", "success");
  }

  function downloadSelectedMarkdown() {
    const selected = selectedCandidate();
    if (!selected) return;
    const filename = "selected-package.md";
    downloadTextFile(filename, model.buildSelectedPackageMarkdown(selected), "text/markdown");
    showStatus(`${filename} downloaded.`, "success");
  }

  function handleGridClick(event) {
    const toggle = event.target.closest("[data-toggle]");
    const select = event.target.closest("[data-select]");
    if (toggle) {
      const id = toggle.dataset.toggle;
      if (expandedIds.has(id)) {
        expandedIds.delete(id);
      } else {
        expandedIds.add(id);
      }
      render();
      return;
    }
    if (select) {
      selectedId = select.dataset.select;
      showStatus("Winning package selected. Export JSON or Markdown when ready.", "success");
      render();
    }
  }

  function loadCandidates() {
    candidateSource = runTools.candidateSourceFromLocation(window.location.search);
    fetch(candidateSource, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${candidateSource} (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        const validation = model.validatePackageCandidateSet(payload);
        if (!validation.ok) throw new Error(validation.error);
        candidateSet = validation.data;
        showStatus(`Loaded ${candidateSet.candidates.length} package candidates from ${candidateSource}.`, "success");
        render();
      })
      .catch((error) => {
        showStatus(error.message, "error");
        els.grid.innerHTML = `<p class="muted">Serve this directory locally and confirm the package candidate JSON exists and is valid.</p>`;
      });
  }

  els.grid.addEventListener("click", handleGridClick);
  els.sort.addEventListener("change", render);
  els.filter.addEventListener("change", render);
  els.downloadJson.addEventListener("click", downloadSelectedJson);
  els.downloadMarkdown.addEventListener("click", downloadSelectedMarkdown);

  loadCandidates();
})();
