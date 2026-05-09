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
    generateThumbnails: document.querySelector("#generateThumbnailsBtn"),
  };

  let candidateSet = { candidates: [] };
  let candidateSource = "package-candidates.json";
  let selectedId = "";
  let expandedIds = new Set();
  let thumbnailCandidates = [];
  let thumbnailGenerationCount = 0;
  let isGeneratingThumbnails = false;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function candidateThumbnailImage(candidate) {
    return candidate.thumbnailImage || candidate.thumbnail_image || candidate.thumbnailImagePath || candidate.thumbnail_image_path || "";
  }

  function thumbnailCandidateImage(item) {
    return item.thumbnailImage || item.thumbnail_image || item.thumbnailImagePath || item.thumbnail_image_path || "";
  }

  function buildThumbnailCandidates(candidate) {
    const base = candidateThumbnailImage(candidate);
    const prompts = [
      candidate.thumbnailConcept || candidate.proposedTitle || candidate.idea || "Thumbnail concept",
      candidate.onThumbnailText || candidate.viewerPromise || "Attention-grabbing thumbnail text",
      candidate.targetViewer || candidate.mainRisk || "Creator audience thumbnail",
    ];
    return prompts.map((prompt, index) => ({
      id: `${candidate.id}-thumb-${thumbnailGenerationCount + index + 1}`,
      label: `Thumbnail ${index + 1}`,
      prompt,
      creator: "gpt-image-2",
      selected: index === 0,
      thumbnailImage: base && index === 0 ? base : "",
    }));
  }

  function currentThumbnailCandidates(candidate) {
    if (thumbnailCandidates.length) return thumbnailCandidates;
    if (!candidate) return [];
    return buildThumbnailCandidates(candidate);
  }

  function renderThumbnailCandidateStrip(candidate) {
    const items = currentThumbnailCandidates(candidate);
    const loading = isGeneratingThumbnails
      ? `
        <div class="thumbnail-loading" role="status" aria-live="polite">
          <span class="thumbnail-spinner" aria-hidden="true"></span>
          <span>Generating image previews...</span>
        </div>
        <div class="thumbnail-loading-strip" aria-hidden="true">
          <div class="thumbnail-skeleton-card"><span></span><strong></strong><em></em></div>
          <div class="thumbnail-skeleton-card"><span></span><strong></strong><em></em></div>
          <div class="thumbnail-skeleton-card"><span></span><strong></strong><em></em></div>
        </div>
      `
      : "";
    if (!items.length) {
      return loading || `<p class="muted">No thumbnail candidates yet.</p>`;
    }
    return `
      ${loading}
      <div class="thumbnail-candidate-strip">
        ${items
          .map((item) => {
            const image = thumbnailCandidateImage(item);
            return `
              <button type="button" class="thumbnail-candidate ${item.selected ? "selected" : ""}" data-thumb-select="${escapeHtml(item.id)}" ${isGeneratingThumbnails ? "disabled" : ""}>
                <span class="thumbnail-candidate-label">${escapeHtml(item.label)}</span>
                <span class="thumbnail-candidate-creator">Creator: ${escapeHtml(item.creator || "gpt-image-2")}</span>
                <span class="thumbnail-candidate-image">
                  ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.label)}" />` : `<span class="thumbnail-placeholder">Pending image</span>`}
                </span>
                <span class="thumbnail-candidate-prompt">${escapeHtml(item.prompt || "No prompt set.")}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function thumbnailGenerationTarget(candidateId = "") {
    if (candidateId) {
      return candidateSet.candidates.find((candidate) => candidate.id === candidateId) || null;
    }
    return selectedCandidate() || visibleCandidates()[0] || null;
  }

  async function generateMoreThumbnailCandidates(candidateId = "") {
    if (isGeneratingThumbnails) return;
    const selected = thumbnailGenerationTarget(candidateId);
    if (!selected) {
      showStatus("No package candidate is available for thumbnail generation.", "error");
      return;
    }
    isGeneratingThumbnails = true;
    showStatus("Generating thumbnail candidates…", "");
    render();
    try {
      const response = await fetch("/api/package-engine/thumbnails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: selected.proposedTitle || selected.idea || selected.thumbnailConcept || "VIDTOOLZ thumbnail",
          thumbnailConcept: selected.thumbnailConcept || "",
          onThumbnailText: selected.onThumbnailText || "",
          viewerPromise: selected.viewerPromise || "",
          targetViewer: selected.targetViewer || "",
          creator: "gpt-image-2",
          count: 3,
        }),
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 501) {
          throw new Error("Thumbnail generation endpoint is unavailable. Start the app with ./scripts/serve-local.sh instead of python3 -m http.server 8010.");
        }
        throw new Error(`Thumbnail generation failed (${response.status})`);
      }
      const payload = await response.json();
      const additions = Array.isArray(payload.candidates) ? payload.candidates : [];
      const normalized = additions.map((item, index) => ({
        id: String(item.id || `${selected.id}-thumb-${thumbnailGenerationCount + index + 1}`),
        label: String(item.label || `Thumbnail ${thumbnailGenerationCount + index + 1}`),
        prompt: String(item.prompt || selected.thumbnailConcept || selected.proposedTitle || selected.idea || "Thumbnail concept"),
        creator: String(item.creator || "gpt-image-2"),
        selected: index === 0,
        thumbnailImage: String(item.thumbnailImage || item.thumbnail_image || item.thumbnailImagePath || item.thumbnail_image_path || ""),
      }));
      if (normalized.length) {
        thumbnailCandidates = normalized;
        thumbnailGenerationCount += normalized.length;
        render();
        showStatus("Thumbnail candidates generated.", "success");
      } else {
        throw new Error("Thumbnail generation returned no candidates.");
      }
    } catch (error) {
      const message = error && error.message && error.message !== "Failed to fetch"
        ? error.message
        : "Thumbnail generation failed. Check that ./scripts/serve-local.sh is running.";
      showStatus(message, "error");
    } finally {
      isGeneratingThumbnails = false;
      render();
    }
  }

  function renderStrategicDetails(candidate) {
    return model.STRATEGIC_FIELDS
      .map((field) => `<div><span>${escapeHtml(field.replace(/_/g, " "))}</span><strong>${escapeHtml(candidate[field] || "Not specified.")}</strong></div>`)
      .join("");
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
        <span class="recommendation-pill recommendation-${String(candidate.recommendation || "Maybe").toLowerCase()}">${escapeHtml(candidate.recommendation)}</span>
      </div>
      <h2>${escapeHtml(candidate.proposedTitle || "Untitled package")}</h2>
      <p>${escapeHtml(candidate.idea || "No idea recorded.")}</p>
      <div class="package-thumbnail-preview">
        <span>Thumbnail image</span>
        ${
          candidateThumbnailImage(candidate)
            ? `<img src="${escapeHtml(candidateThumbnailImage(candidate))}" alt="Thumbnail for ${escapeHtml(candidate.proposedTitle || "package")}" />`
            : `<div class="thumbnail-placeholder">${escapeHtml(candidate.thumbnailConcept || "No thumbnail image linked yet.")}</div>`
        }
      </div>
      <div class="thumbnail-candidates-section">
        <div class="thumbnail-candidates-header">
          <h3>Thumbnail candidates</h3>
          <button type="button" class="secondary-btn" data-thumb-generate="${escapeHtml(candidate.id)}" ${isGeneratingThumbnails ? "disabled" : ""}>${isGeneratingThumbnails ? "Generating thumbnails…" : "Generate 3 more"}</button>
        </div>
        ${renderThumbnailCandidateStrip(candidate)}
      </div>
      <div class="package-card-grid">
        <div><span>Thumbnail concept</span><strong>${escapeHtml(candidate.thumbnailConcept || "Not specified.")}</strong></div>
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
    if (selected && !thumbnailCandidates.length) {
      thumbnailCandidates = buildThumbnailCandidates(selected).slice(0, 3);
    }
    els.count.textContent = `${visible.length} shown / ${candidateSet.candidates.length} total`;
    els.selectedSummary.textContent = selected
      ? `Selected #${selected.packageNumber}: ${selected.proposedTitle}`
      : "No winner selected";
    els.downloadJson.disabled = !selected;
    els.downloadMarkdown.disabled = !selected;
    els.generateThumbnails.disabled = isGeneratingThumbnails || !visible.length;
    els.generateThumbnails.textContent = isGeneratingThumbnails ? "Generating thumbnails…" : "Generate thumbnail candidates";
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
    const thumbnailImage = selected.thumbnailImage || selected.thumbnail_image || selected.thumbnailImagePath || selected.thumbnail_image_path || "";
    downloadTextFile("selected-package.json", JSON.stringify(model.buildSelectedPackageJson(selected, { thumbnailImage, thumbnailCandidates }), null, 2), "application/json");
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
    const thumbSelect = event.target.closest("[data-thumb-select]");
    const thumbGenerate = event.target.closest("[data-thumb-generate]");
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
    if (thumbSelect) {
      const id = thumbSelect.dataset.thumbSelect;
      thumbnailCandidates = thumbnailCandidates.map((item) => ({ ...item, selected: item.id === id }));
      render();
      return;
    }
    if (thumbGenerate) {
      generateMoreThumbnailCandidates(thumbGenerate.dataset.thumbGenerate);
      return;
    }
    if (select) {
      selectedId = select.dataset.select;
      thumbnailCandidates = selectedCandidate() ? buildThumbnailCandidates(selectedCandidate()).slice(0, 3) : thumbnailCandidates;
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
        thumbnailCandidates = candidateSet.candidates.length ? buildThumbnailCandidates(candidateSet.candidates[0]).slice(0, 3) : [];
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
  els.generateThumbnails.addEventListener("click", () => generateMoreThumbnailCandidates());

  loadCandidates();
})();
