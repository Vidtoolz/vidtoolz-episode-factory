(function packageEngineApp() {
  "use strict";

  const model = window.PackageEngineModel;
  const runTools = window.PackageEngineRun;
  const STATUS_API = "/api/package-engine/status";
  const DEFAULT_THUMBNAIL_API = "/api/package-engine/thumbnails";
  const DEFAULT_THUMBNAIL_REQUEST_TIMEOUT_MS = 130000;
  const THUMBNAIL_FRONTEND_TIMEOUT_HEADROOM_MS = 10000;
  const PACKAGE_ENGINE_VIEW_MODE_KEY = "vidtoolz-package-engine-view-mode-v1";
  const els = {
    workspace: document.querySelector(".package-engine-workspace"),
    packageFocusPanel: document.querySelector("#packageFocusPanel"),
    status: document.querySelector("#packageStatus"),
    grid: document.querySelector("#packageGrid"),
    sort: document.querySelector("#sortSelect"),
    filter: document.querySelector("#recommendationFilter"),
    count: document.querySelector("#candidateCount"),
    selectedSummary: document.querySelector("#selectedSummary"),
    downloadJson: document.querySelector("#downloadJsonBtn"),
    downloadMarkdown: document.querySelector("#downloadMarkdownBtn"),
    generateThumbnails: document.querySelector("#generateThumbnailsBtn"),
    generatedThumbnailPanel: document.querySelector("#generatedThumbnailPanel"),
    confirmPanel: document.querySelector("#confirmPanel"),
    confirmTitle: document.querySelector("#confirmTitle"),
    confirmSaveBtn: document.querySelector("#confirmSaveBtn"),
    cancelConfirmBtn: document.querySelector("#cancelConfirmBtn"),
    confirmStatus: document.querySelector("#confirmStatus"),
    nextStepsPanel: document.querySelector("#nextStepsPanel"),
    nextStepsContent: document.querySelector("#nextStepsContent"),
  };

  let candidateSet = { candidates: [] };
  let candidateSource = "package-candidates.json";
  let selectedId = "";
  let expandedIds = new Set();
  let thumbnailCandidates = [];
  let generatedThumbnailsByCandidate = {};
  let generatedThumbnailCandidates = [];
  let generatedThumbnailError = "";
  let generatedThumbnailProvider = "placeholder";
  let generatedThumbnailModel = "local-svg-placeholder";
  let thumbnailGenerationApi = DEFAULT_THUMBNAIL_API;
  let localWriteNonce = "";
  let nonceHeader = "x-vidtoolz-local-write-nonce";
  let thumbnailRequestTimeoutMs = DEFAULT_THUMBNAIL_REQUEST_TIMEOUT_MS;
  let thumbnailGenerationCount = 0;
  let isGeneratingThumbnails = false;
  let packageEngineViewMode = "focused";

  function normalizePayload(json) {
    if (json && typeof json === "object" && json.ok && json.data) return json.data;
    return json;
  }

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
    els.status.dataset.viewWarning = type === "error" ? "true" : "false";
  }

  function normalizePackageEngineViewMode(mode) {
    return mode === "full" ? "full" : "focused";
  }

  function readPackageEngineViewMode() {
    try {
      return normalizePackageEngineViewMode(window.localStorage && window.localStorage.getItem(PACKAGE_ENGINE_VIEW_MODE_KEY));
    } catch (_error) {
      return "focused";
    }
  }

  function savePackageEngineViewMode(mode) {
    const normalized = normalizePackageEngineViewMode(mode);
    try {
      if (window.localStorage) window.localStorage.setItem(PACKAGE_ENGINE_VIEW_MODE_KEY, normalized);
    } catch (_error) {
      return normalized;
    }
    return normalized;
  }

  function setPackageEngineViewMode(mode, options = {}) {
    packageEngineViewMode = normalizePackageEngineViewMode(mode);
    if (options.persist !== false) savePackageEngineViewMode(packageEngineViewMode);
    if (els.workspace) els.workspace.dataset.viewMode = packageEngineViewMode;
    document.body.dataset.packageEngineViewMode = packageEngineViewMode;
    document.querySelectorAll("[data-package-engine-view-mode-button]").forEach((button) => {
      const active = button.dataset.packageEngineViewModeButton === packageEngineViewMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function visibleCandidates() {
    const filtered = model.filterPackageCandidates(candidateSet.candidates, els.filter.value);
    return model.sortPackageCandidates(filtered, els.sort.value);
  }

  function selectedCandidate() {
    return candidateSet.candidates.find((candidate) => candidate.id === selectedId) || null;
  }

  function selectPackageFocusCandidate(candidates = [], selectedCandidateId = "", allCandidates = candidates) {
    const visible = Array.isArray(candidates) ? candidates : [];
    const all = Array.isArray(allCandidates) ? allCandidates : visible;
    const selected = all.find((candidate) => candidate.id === selectedCandidateId) || visible.find((candidate) => candidate.id === selectedCandidateId) || null;
    const recommended = visible.find((candidate) => candidate.recommendation === "Make") || visible[0] || null;
    return selected || recommended;
  }

  function buildPackageFocusModel(candidates = visibleCandidates(), selectedCandidateId = selectedId) {
    const visible = Array.isArray(candidates) ? candidates : [];
    const candidate = selectPackageFocusCandidate(visible, selectedCandidateId, candidateSet.candidates);
    const selected = Boolean(candidate && candidate.id === selectedCandidateId);
    const source = selected ? "selected" : candidate ? "recommended visible" : "none";
    const nextPackagingAction = candidate
      ? selected
        ? "Review the title, promise, thumbnail idea, and risk before using the existing explicit export controls."
        : "Inspect this candidate, compare it against the visible alternatives, then select only if it earns the packaging choice."
      : "Load package candidates before making a packaging decision.";
    return {
      candidate,
      source,
      selected,
      nextPackagingAction,
      boundary: "Browser selection only. Not approval. Not package-run state. Not exported unless Mikko uses the existing explicit download controls.",
    };
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
    if (!candidate) return [];
    const generated = generatedThumbnailsByCandidate[candidate.id] || [];
    if (generated.length) return generated;
    return [];
  }

  function primaryGeneratedThumbnail(candidate) {
    const generated = generatedThumbnailsByCandidate[candidate.id] || [];
    return generated.find((item) => item.selected && thumbnailCandidateImage(item)) || generated.find((item) => thumbnailCandidateImage(item)) || null;
  }

  function primaryGeneratedThumbnailImage(candidate) {
    const primary = primaryGeneratedThumbnail(candidate);
    return primary ? thumbnailCandidateImage(primary) : "";
  }

  function mainThumbnailImage(candidate) {
    return primaryGeneratedThumbnailImage(candidate) || candidateThumbnailImage(candidate);
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

  function renderGeneratedThumbnailPanel() {
    if (!els.generatedThumbnailPanel) return;
    if (!isGeneratingThumbnails && !generatedThumbnailCandidates.length && !generatedThumbnailError) {
      els.generatedThumbnailPanel.classList.add("hidden");
      els.generatedThumbnailPanel.innerHTML = "";
      els.generatedThumbnailPanel.dataset.viewWarning = "false";
      return;
    }

    els.generatedThumbnailPanel.classList.remove("hidden");
    els.generatedThumbnailPanel.dataset.viewWarning = generatedThumbnailError ? "true" : "false";
    if (isGeneratingThumbnails) {
      els.generatedThumbnailPanel.innerHTML = `
        <div class="generated-thumbnail-header">
          <div>
            <h2>Generating thumbnail candidates...</h2>
            <p>Calling the configured thumbnail-generation provider for the selected package.</p>
          </div>
          <span class="thumbnail-spinner" aria-hidden="true"></span>
        </div>
        <div class="generated-thumbnail-grid" aria-hidden="true">
          <div class="thumbnail-skeleton-card"><span></span><strong></strong><em></em></div>
          <div class="thumbnail-skeleton-card"><span></span><strong></strong><em></em></div>
          <div class="thumbnail-skeleton-card"><span></span><strong></strong><em></em></div>
        </div>
      `;
      return;
    }

    const error = generatedThumbnailError
      ? `<p class="generated-thumbnail-error">${escapeHtml(generatedThumbnailError)}</p>`
      : "";
    if (generatedThumbnailError && !generatedThumbnailCandidates.length) {
      els.generatedThumbnailPanel.innerHTML = `
        <div class="generated-thumbnail-header">
          <div>
            <h2>Thumbnail generation failed</h2>
            <p>The configured thumbnail backend did not return usable candidates.</p>
          </div>
        </div>
        ${error}
      `;
      return;
    }
    const providerNote = generatedThumbnailProvider === "openai"
      ? `Externally generated thumbnail drafts from ${generatedThumbnailModel || "OpenAI"}.`
      : "Local placeholder SVG previews for now; these are not final AI or YouTube thumbnails.";
    const items = generatedThumbnailCandidates
      .map((item) => {
        const image = thumbnailCandidateImage(item);
        return `
          <article class="generated-thumbnail-card">
            ${
              image
                ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.label || "Generated thumbnail candidate")}" />`
                : `<div class="generated-thumbnail-missing">Missing image data</div>`
            }
            <h3>${escapeHtml(item.label || "Generated thumbnail")}</h3>
            <span class="generated-thumbnail-creator">${escapeHtml(item.creator || generatedThumbnailModel || generatedThumbnailProvider)}</span>
            <p>${escapeHtml(item.prompt || "No prompt returned.")}</p>
          </article>
        `;
      })
      .join("");

    els.generatedThumbnailPanel.innerHTML = `
      <div class="generated-thumbnail-header">
        <div>
          <h2>Generated thumbnail candidates</h2>
          <p>${escapeHtml(providerNote)}</p>
        </div>
      </div>
      ${error}
      <div class="generated-thumbnail-grid">${items}</div>
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
    generatedThumbnailError = "";
    showStatus("Generating thumbnail candidates…", "");
    render();
    try {
      const fetchOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json", [nonceHeader]: localWriteNonce },
        body: JSON.stringify({
          topic: selected.proposedTitle || selected.idea || selected.thumbnailConcept || "VIDTOOLZ thumbnail",
          thumbnailConcept: selected.thumbnailConcept || "",
          onThumbnailText: selected.onThumbnailText || "",
          viewerPromise: selected.viewerPromise || "",
          targetViewer: selected.targetViewer || "",
          count: 3,
        }),
      };
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        fetchOptions.signal = AbortSignal.timeout(thumbnailRequestTimeoutMs);
      }
      const response = await fetch(thumbnailGenerationApi, {
        ...fetchOptions,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404 || response.status === 501) {
          throw new Error("Thumbnail generation endpoint is unavailable. Start the app with ./scripts/serve-local.sh instead of python3 -m http.server 8010.");
        }
        const errorCode = payload && payload.errorCode ? String(payload.errorCode) : "";
        const serverMessage = payload && payload.error ? String(payload.error) : "";
        let message = serverMessage || `Thumbnail generation failed (${response.status})`;
        if (errorCode === "openai_timeout") {
          message = `${serverMessage || "OpenAI image generation timed out."} Backend timeout: ${payload.timeoutMs || "unknown"} ms. Try again, lower image settings, or increase OPENAI_IMAGE_TIMEOUT_MS.`;
        } else if (errorCode === "missing_api_key") {
          message = "OpenAI thumbnail generation is configured, but OPENAI_API_KEY is missing.";
        } else if (errorCode === "openai_provider_error" || errorCode === "openai_request_failed") {
          message = `OpenAI thumbnail provider error: ${serverMessage || `HTTP ${response.status}`}`;
        } else if (errorCode === "no_usable_candidates") {
          message = "Thumbnail generation completed but returned no usable image candidates.";
        }
        throw new Error(message);
      }
      generatedThumbnailProvider = String(payload.provider || "placeholder");
      generatedThumbnailModel = String(payload.model || "");
      const additions = Array.isArray(payload.candidates) ? payload.candidates : [];
      const normalized = additions.map((item, index) => ({
        id: String(item.id || `${selected.id}-thumb-${thumbnailGenerationCount + index + 1}`),
        label: String(item.label || `Thumbnail ${thumbnailGenerationCount + index + 1}`),
        prompt: String(item.prompt || selected.thumbnailConcept || selected.proposedTitle || selected.idea || "Thumbnail concept"),
        creator: String(item.creator || generatedThumbnailModel || generatedThumbnailProvider),
        selected: index === 0,
        thumbnailImage: String(item.thumbnailImage || item.thumbnail_image || item.thumbnailImagePath || item.thumbnail_image_path || ""),
      }));
      if (normalized.length) {
        generatedThumbnailsByCandidate = {
          ...generatedThumbnailsByCandidate,
          [selected.id]: normalized,
        };
        generatedThumbnailCandidates = normalized;
        thumbnailCandidates = normalized;
        thumbnailGenerationCount += normalized.length;
        if (!normalized.some((item) => thumbnailCandidateImage(item))) {
          generatedThumbnailError = "Thumbnail generation returned candidates, but none included image data.";
          showStatus(generatedThumbnailError, "error");
          return;
        }
        render();
        showStatus("Thumbnail candidates generated.", "success");
      } else {
        throw new Error("Thumbnail generation returned no candidates.");
      }
    } catch (error) {
      const timedOut = error && (error.name === "AbortError" || error.name === "TimeoutError");
      const message = timedOut
        ? `Frontend request timed out after ${Math.ceil(thumbnailRequestTimeoutMs / 1000)} seconds before the backend returned. Check server logs or increase the exposed thumbnail timeout.`
        : error && error.message && error.message !== "Failed to fetch"
        ? error.message
        : "Thumbnail generation failed. Check that ./scripts/serve-local.sh is running.";
      generatedThumbnailError = message;
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

  function renderPackageFocusPanel() {
    if (!els.packageFocusPanel) return;
    const focus = buildPackageFocusModel();
    const candidate = focus.candidate;
    const title = candidate ? candidate.proposedTitle || candidate.idea || "Untitled package candidate" : "No package candidate loaded";
    const candidateLabel = candidate
      ? `${focus.selected ? "Selected package candidate" : "Strongest visible candidate"} #${candidate.packageNumber || "?"}`
      : "Load candidates";
    const scoreText = candidate ? `${candidate.score || 0}/100 · ${candidate.recommendation || "No recommendation"}` : "No score";
    const promise = candidate ? candidate.viewerPromise || "Viewer promise not specified." : "Load candidates to inspect the viewer promise.";
    const thumbnail = candidate ? candidate.thumbnailConcept || "Thumbnail concept not specified." : "No thumbnail concept loaded.";
    const risk = candidate ? candidate.mainRisk || "Main risk not specified." : "No risk source loaded.";

    els.packageFocusPanel.innerHTML = `
      <div class="package-focus-header">
        <div>
          <p class="eyebrow">Package Focus</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="muted">${escapeHtml(candidateLabel)} · ${escapeHtml(scoreText)}</p>
        </div>
        <span class="lifecycle-badge">Read-only summary</span>
      </div>
      <div class="package-focus-grid">
        <section class="package-focus-card package-focus-now" aria-label="Current package candidate">
          <span>Reviewing now</span>
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(focus.source)}</p>
        </section>
        <section class="package-focus-card" aria-label="Viewer promise">
          <span>Viewer promise</span>
          <strong>${escapeHtml(promise)}</strong>
        </section>
        <section class="package-focus-card" aria-label="Thumbnail concept">
          <span>Thumbnail concept</span>
          <strong>${escapeHtml(thumbnail)}</strong>
        </section>
        <section class="package-focus-card package-focus-risk" aria-label="Main risk">
          <span>Main risk / concern</span>
          <strong>${escapeHtml(risk)}</strong>
        </section>
        <section class="package-focus-card" aria-label="Next packaging action">
          <span>Next packaging action</span>
          <strong>${escapeHtml(focus.nextPackagingAction)}</strong>
        </section>
        <section class="package-focus-card package-focus-boundary" aria-label="Selection boundary">
          <span>Boundary</span>
          <strong>${escapeHtml(focus.boundary)}</strong>
        </section>
      </div>
    `;
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
    const mainImage = mainThumbnailImage(candidate);
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
          mainImage
            ? `<img src="${escapeHtml(mainImage)}" alt="Thumbnail for ${escapeHtml(candidate.proposedTitle || "package")}" />`
            : `<div class="thumbnail-placeholder">${escapeHtml(candidate.thumbnailConcept || "No thumbnail image linked yet.")}</div>`
        }
      </div>
      <div class="thumbnail-candidates-section" data-view-group="thumbnail-work" data-view-default="full">
        <div class="thumbnail-candidates-header">
          <h3>Thumbnail candidates</h3>
          <button type="button" class="secondary-btn" data-thumb-generate="${escapeHtml(candidate.id)}" ${isGeneratingThumbnails ? "disabled" : ""}>${isGeneratingThumbnails ? "Generating thumbnails…" : "Generate 3 more"}</button>
        </div>
        ${renderThumbnailCandidateStrip(candidate)}
      </div>
      <div class="package-card-grid" data-view-group="metadata" data-view-default="full">
        <div><span>Thumbnail concept</span><strong>${escapeHtml(candidate.thumbnailConcept || "Not specified.")}</strong></div>
        <div><span>On-thumbnail text</span><strong>${escapeHtml(candidate.onThumbnailText || "Not specified.")}</strong></div>
        <div><span>Viewer promise</span><strong>${escapeHtml(candidate.viewerPromise || "Not specified.")}</strong></div>
        <div><span>Target viewer</span><strong>${escapeHtml(candidate.targetViewer || "Not specified.")}</strong></div>
        <div><span>Difficulty</span><strong>${escapeHtml(candidate.productionDifficulty)}</strong></div>
        <div><span>Main risk</span><strong>${escapeHtml(candidate.mainRisk || "Not specified.")}</strong></div>
      </div>
      <div class="shorts-list" data-view-group="metadata" data-view-default="full">
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
            <section class="package-detail" data-view-group="metadata" data-view-default="full">
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
    els.generateThumbnails.disabled = isGeneratingThumbnails || !visible.length;
    els.generateThumbnails.textContent = isGeneratingThumbnails ? "Generating thumbnails…" : "Generate thumbnail candidates";
    renderGeneratedThumbnailPanel();
    renderPackageFocusPanel();
    setPackageEngineViewMode(packageEngineViewMode, { persist: false });
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
    const selectedThumbnailCandidates = generatedThumbnailsByCandidate[selected.id] || thumbnailCandidates;
    const thumbnailImage = primaryGeneratedThumbnailImage(selected) || selected.thumbnailImage || selected.thumbnail_image || selected.thumbnailImagePath || selected.thumbnail_image_path || "";
    downloadTextFile("selected-package.json", JSON.stringify(model.buildSelectedPackageJson(selected, { thumbnailImage, thumbnailCandidates: selectedThumbnailCandidates }), null, 2), "application/json");
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
      const owner = candidateSet.candidates.find((candidate) =>
        (generatedThumbnailsByCandidate[candidate.id] || []).some((item) => item.id === id)
      );
      if (owner) {
        const updated = (generatedThumbnailsByCandidate[owner.id] || []).map((item) => ({ ...item, selected: item.id === id }));
        generatedThumbnailsByCandidate = {
          ...generatedThumbnailsByCandidate,
          [owner.id]: updated,
        };
        thumbnailCandidates = updated;
        generatedThumbnailCandidates = updated;
      } else {
        thumbnailCandidates = thumbnailCandidates.map((item) => ({ ...item, selected: item.id === id }));
      }
      render();
      return;
    }
    if (thumbGenerate) {
      generateMoreThumbnailCandidates(thumbGenerate.dataset.thumbGenerate);
      return;
    }
    if (select) {
      selectedId = select.dataset.select;
      showStatus("Winner selected. Review the confirmation panel below.", "success");
      render();
      showConfirmPanel();
    }
  }

  function showConfirmPanel() {
    const selected = selectedCandidate();
    if (!selected) return;
    // Check if this run already has a saved selected-package.json
    const runId = new URLSearchParams(window.location.search).get("run") || "";
    fetch(`package-runs/${runId}/selected-package.json`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((existing) => {
        if (existing) {
          showNextSteps(runId, existing.package || existing, true);
          return;
        }
        els.confirmTitle.textContent = selected.proposedTitle || selected.idea || "Untitled";
        els.confirmPanel.classList.remove("hidden");
        els.nextStepsPanel.classList.add("hidden");
        els.confirmStatus.textContent = "";
        els.confirmStatus.className = "confirm-status";
      })
      .catch(() => {
        els.confirmTitle.textContent = selected.proposedTitle || selected.idea || "Untitled";
        els.confirmPanel.classList.remove("hidden");
      });
  }

  function handleConfirmSave() {
    const selected = selectedCandidate();
    if (!selected) return;
    const runId = new URLSearchParams(window.location.search).get("run") || "";
    if (!runId) {
      els.confirmStatus.textContent = "No run ID in URL.";
      els.confirmStatus.className = "confirm-status error";
      return;
    }
    const btn = els.confirmSaveBtn;
    btn.disabled = true;
    els.confirmStatus.textContent = "Saving...";
    els.confirmStatus.className = "confirm-status";

    const selectedThumbnailCandidates = generatedThumbnailsByCandidate[selected.id] || thumbnailCandidates;
    const thumbnailImage = primaryGeneratedThumbnailImage(selected) || selected.thumbnailImage || selected.thumbnail_image || selected.thumbnailImagePath || selected.thumbnail_image_path || "";
    const selectedPackage = model.buildSelectedPackageJson(selected, { thumbnailImage, thumbnailCandidates: selectedThumbnailCandidates });

    fetch("/api/package-engine/save-selected", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [nonceHeader]: localWriteNonce,
      },
      body: JSON.stringify({
        runId,
        selectedPackage,
        localWriteNonce,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Save failed");
        els.confirmStatus.textContent = "Saved.";
        els.confirmStatus.className = "confirm-status success";
        els.confirmPanel.classList.add("hidden");
        showNextSteps(runId, selected, false);
      })
      .catch((err) => {
        els.confirmStatus.textContent = err.message;
        els.confirmStatus.className = "confirm-status error";
        btn.disabled = false;
      });
  }

  function showNextSteps(runId, selected, alreadySaved) {
    els.confirmPanel.classList.add("hidden");
    els.nextStepsPanel.classList.remove("hidden");
    const title = selected.proposedTitle || selected.proposed_title || selected.title || "your topic";
    const runSlug = runId;
    els.nextStepsContent.innerHTML = `
      <div class="stage-progress">
        <span class="stage-done">✓ Stage 1: Topic Selection</span>
        <span class="stage-arrow">→</span>
        <span class="stage-current">Stage 2: Outline</span>
        <span class="stage-arrow">→</span>
        <span class="stage-future">3: Script</span>
        <span class="stage-arrow">→</span>
        <span class="stage-future">4: Shot Plan</span>
        <span class="stage-arrow">→</span>
        <span class="stage-future">5: Edit</span>
        <span class="stage-arrow">→</span>
        <span class="stage-future">6: Packaging</span>
        <span class="stage-arrow">→</span>
        <span class="stage-future">7: Publish</span>
      </div>

      <p>Selected: <strong>${escapeHtml(title)}</strong></p>
      <p class="muted">Saved to: <code>package-runs/${escapeHtml(runSlug)}/selected-package.json</code></p>

      <div class="next-action-box">
        <p class="next-action-label">Next action: Generate outline prompt</p>
        <p class="muted">The system will generate <code>outline-prompt.md</code> from your selected topic. One click — no manual file editing.</p>
        <button type="button" class="primary-btn" id="generateOutlineBtn">Generate Outline Prompt</button>
        <span class="confirm-status" id="outlineGenStatus"></span>
      </div>

      <div id="outlinePromptBox" class="outline-prompt-box hidden">
        <h3>Outline Prompt — Ready to Use</h3>
        <p class="muted">Copy this prompt and paste it into Hermes or ChatGPT. It contains your selected topic, VIDTOOLZ guardrails, and instructions to generate 3 outline options.</p>
        <div class="prompt-actions">
          <button type="button" id="copyPromptBtn">Copy to Clipboard</button>
          <button type="button" id="downloadPromptBtn">Download as .md</button>
        </div>
        <pre id="outlinePromptText" class="prompt-text"></pre>
        <p class="muted" style="margin-top: 0.75rem;">
          After pasting into Hermes/ChatGPT, save the 3 outline options as <code>outlines.md</code> in the run folder. Then pick one and save it as <code>final-outline.md</code>.
        </p>
      </div>

      ${alreadySaved ? '<p class="muted" style="margin-top: 0.5rem;">This selection was already saved.</p>' : ''}
    `;
    els.nextStepsPanel.scrollIntoView({ behavior: "smooth", block: "start" });

    // Wire up the generate button
    const genBtn = document.querySelector("#generateOutlineBtn");
    const genStatus = document.querySelector("#outlineGenStatus");
    const promptBox = document.querySelector("#outlinePromptBox");
    const promptText = document.querySelector("#outlinePromptText");

    if (genBtn) {
      genBtn.addEventListener("click", () => {
        if (!localWriteNonce) {
          genStatus.textContent = "Cannot generate: local write nonce is missing. Refresh the page to retry.";
          genStatus.className = "confirm-status error";
          return;
        }
        genBtn.disabled = true;
        genStatus.textContent = "Generating...";
        genStatus.className = "confirm-status";

        fetch("/api/package-engine/generate-outline-prompt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [nonceHeader]: localWriteNonce,
          },
          body: JSON.stringify({ runId: runSlug, localWriteNonce }),
        })
          .then((r) => r.json())
          .then((json) => {
            if (!json.ok) throw new Error(json.error || "Generation failed");
            const data = normalizePayload(json);
            genStatus.textContent = "Done — outline-prompt.md saved to run folder.";
            genStatus.className = "confirm-status success";
            promptBox.classList.remove("hidden");
            promptText.textContent = data.outlinePrompt || "(empty)";
            // Wire up copy/download buttons
            const copyBtn = document.querySelector("#copyPromptBtn");
            const dlBtn = document.querySelector("#downloadPromptBtn");
            if (copyBtn) {
              copyBtn.addEventListener("click", () => {
                navigator.clipboard.writeText(data.outlinePrompt || "").then(() => {
                  copyBtn.textContent = "Copied!";
                  setTimeout(() => { copyBtn.textContent = "Copy to Clipboard"; }, 2000);
                });
              });
            }
            if (dlBtn) {
              dlBtn.addEventListener("click", () => {
                const blob = new Blob([data.outlinePrompt || ""], { type: "text/markdown" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "outline-prompt.md";
                a.click();
              });
            }
          })
          .catch((err) => {
            genStatus.textContent = err.message;
            genStatus.className = "confirm-status error";
            genBtn.disabled = false;
          });
      });
    }
  }

  function loadCandidates() {
    candidateSource = runTools.candidateSourceFromLocation(window.location.search) || "package-candidates.json";
    const sources = [candidateSource, "package-candidates.json", "./package-candidates.json", "/package-candidates.json"].filter((v,i,a)=>a.indexOf(v)===i);
    const tryLoad = async () => {
      let lastError = null;
      for (const source of sources) {
        try {
          const response = await fetch(source, { cache: "no-store" });
          if (!response.ok) throw new Error(`Could not load ${source} (${response.status})`);
          const payload = await response.json();
          const validation = model.validatePackageCandidateSet(payload);
          if (!validation.ok) throw new Error(validation.error);
          candidateSource = source;
          candidateSet = validation.data;
          showStatus(`Loaded ${candidateSet.candidates.length} package candidates from ${candidateSource}.`, "success");
          render();
          return;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("Could not load package candidates.");
    };
    tryLoad()
      .catch((error) => {
        showStatus(error.message, "error");
        els.grid.innerHTML = `<p class="muted">Serve this directory locally and confirm the package candidate JSON exists and is valid.</p>`;
      });
  }

  function loadThumbnailGenerationConfig() {
    return fetch(STATUS_API, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((rawJson) => {
        const payload = normalizePayload(rawJson);
        if (payload && payload.api) {
          thumbnailGenerationApi = String(payload.api);
        }
        if (payload && payload.localWriteNonce) {
          localWriteNonce = String(payload.localWriteNonce);
        }
        if (payload && payload.nonceHeader) {
          nonceHeader = String(payload.nonceHeader);
        }
        if (payload && payload.thumbnailProvider) {
          generatedThumbnailProvider = String(payload.thumbnailProvider);
        }
        if (payload && payload.model) {
          generatedThumbnailModel = String(payload.model);
        }
        if (payload && Number(payload.timeoutMs) > 0) {
          thumbnailRequestTimeoutMs = Number(payload.timeoutMs) + THUMBNAIL_FRONTEND_TIMEOUT_HEADROOM_MS;
        } else {
          thumbnailRequestTimeoutMs = DEFAULT_THUMBNAIL_REQUEST_TIMEOUT_MS;
        }
      })
      .catch(() => {
        thumbnailGenerationApi = DEFAULT_THUMBNAIL_API;
        thumbnailRequestTimeoutMs = DEFAULT_THUMBNAIL_REQUEST_TIMEOUT_MS;
      });
  }

  els.grid.addEventListener("click", handleGridClick);
  els.sort.addEventListener("change", render);
  els.filter.addEventListener("change", render);
  els.downloadJson.addEventListener("click", downloadSelectedJson);
  els.downloadMarkdown.addEventListener("click", downloadSelectedMarkdown);
  els.generateThumbnails.addEventListener("click", () => generateMoreThumbnailCandidates());
  els.confirmSaveBtn.addEventListener("click", handleConfirmSave);
  els.cancelConfirmBtn.addEventListener("click", () => {
    els.confirmPanel.classList.add("hidden");
  });
  document.querySelectorAll("[data-package-engine-view-mode-button]").forEach((button) => {
    button.addEventListener("click", () => setPackageEngineViewMode(button.dataset.packageEngineViewModeButton));
  });

  window.PackageEngineViewMode = {
    key: PACKAGE_ENGINE_VIEW_MODE_KEY,
    normalizePackageEngineViewMode,
    readPackageEngineViewMode,
    savePackageEngineViewMode,
    setPackageEngineViewMode,
    buildPackageFocusModel,
    selectPackageFocusCandidate,
  };

  packageEngineViewMode = readPackageEngineViewMode();
  setPackageEngineViewMode(packageEngineViewMode, { persist: false });
  loadThumbnailGenerationConfig().finally(loadCandidates);
})();
