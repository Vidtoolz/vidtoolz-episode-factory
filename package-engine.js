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
    runFilter: document.querySelector("#runFilterSelect"),
    search: document.querySelector("#candidateSearch"),
    count: document.querySelector("#candidateCount"),
    selectedSummary: document.querySelector("#selectedSummary"),
    downloadJson: document.querySelector("#downloadJsonBtn"),
    downloadMarkdown: document.querySelector("#downloadMarkdownBtn"),
    generateThumbnails: document.querySelector("#generateThumbnailsBtn"),
    generatedThumbnailPanel: document.querySelector("#generatedThumbnailPanel"),
    confirmPanel: document.querySelector("#confirmPanel"),
    confirmTitle: document.querySelector("#confirmTitle"),
    confirmRunId: document.querySelector("#confirmRunId"),
    confirmModeText: document.querySelector("#confirmModeText"),
    confirmSaveBtn: document.querySelector("#confirmSaveBtn"),
    cancelConfirmBtn: document.querySelector("#cancelConfirmBtn"),
    confirmStatus: document.querySelector("#confirmStatus"),
    nextStepsPanel: document.querySelector("#nextStepsPanel"),
    nextStepsContent: document.querySelector("#nextStepsContent"),
  };

  let candidateSet = { candidates: [] };
  let candidateSource = "package-candidates.json";
  // Persisted vs pending selection state are tracked separately:
  // - persistedSelectedId: the candidate ID read from selected-package.json on disk.
  // - pendingSelectedId: a candidate the user clicked but has not yet saved.
  let persistedSelectedId = "";
  let pendingSelectedId = "";
  let expandedIds = new Set();
  let editingIds = new Set();
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
  let discoveredRuns = [];
  let discoveredActiveRunId = "";
  let runFilterMode = "all";
  let searchQuery = "";

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
    let candidates = candidateSet.candidates;

    // Apply run filter if we have discovered runs
    if (discoveredRuns.length && runFilterMode !== "all") {
      let visibleRunIds;
      if (runFilterMode === "active") {
        visibleRunIds = discoveredActiveRunId ? [discoveredActiveRunId] : [];
      } else if (runFilterMode === "recent") {
        // Recent = most recent 3 runs (sorted by name = date prefix descending)
        visibleRunIds = discoveredRuns
          .map((r) => r.runId)
          .sort()
          .reverse()
          .slice(0, 3);
      } else {
        visibleRunIds = null;
      }
      if (visibleRunIds) {
        candidates = candidates.filter((c) => {
          const runId = c._runId || candidateSet._runId || "";
          return visibleRunIds.includes(runId);
        });
      }
    }

    // Apply search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      candidates = candidates.filter((c) => {
        const title = String(c.proposedTitle || c.proposed_title || c.title || "").toLowerCase();
        const promise = String(c.viewerPromise || c.viewer_promise || "").toLowerCase();
        const topic = String(c.topic || "").toLowerCase();
        return title.includes(q) || promise.includes(q) || topic.includes(q);
      });
    }

    const filtered = model.filterPackageCandidates(candidates, els.filter.value);
    const sorted = model.sortPackageCandidates(filtered, els.sort.value);

    // normalizePackageCandidate strips _runId, so reattach it onto each rendered
    // candidate from the originals — cards show which project a pick saves into (F4).
    const runIdById = new Map();
    for (const c of candidateSet.candidates) {
      if (c.id) runIdById.set(c.id, c._runId || candidateSet._runId || "");
    }
    sorted.forEach((c) => {
      c._runId = runIdById.get(c.id) || candidateSet._runId || "";
    });

    // Group active run first, preserving model sort order within each group.
    if (discoveredRuns.length > 1 && discoveredActiveRunId) {
      const active = sorted.filter((c) => c._runId === discoveredActiveRunId);
      const others = sorted.filter((c) => c._runId !== discoveredActiveRunId);
      return active.concat(others);
    }

    return sorted;
  }

  function currentSelectedId() {
    return pendingSelectedId || persistedSelectedId || "";
  }

  function selectedCandidate() {
    const id = pendingSelectedId || persistedSelectedId || "";
    return candidateSet.candidates.find((candidate) => candidate.id === id) || null;
  }

  function selectPackageFocusCandidate(candidates = [], selectedCandidateId = "", allCandidates = candidates) {
    const visible = Array.isArray(candidates) ? candidates : [];
    const all = Array.isArray(allCandidates) ? allCandidates : visible;
    const selected = all.find((candidate) => candidate.id === selectedCandidateId) || visible.find((candidate) => candidate.id === selectedCandidateId) || null;
    const recommended = visible.find((candidate) => candidate.recommendation === "Make") || visible[0] || null;
    return selected || recommended;
  }

  function buildPackageFocusModel(candidates = visibleCandidates(), selectedCandidateId = currentSelectedId()) {
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
      creator: "local-placeholder",
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
                <span class="thumbnail-candidate-creator">Creator: ${escapeHtml(item.creator || "local-placeholder")}</span>
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
    const providerNote =
      "Local placeholder SVG previews. VIDTOOLZ does not use OpenAI for image generation; real images come from the local vidnux ComfyUI / FLUX path. These are not final YouTube thumbnails.";
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
        if (errorCode === "openai_image_disabled") {
          message = serverMessage || "OpenAI image generation is disabled. VIDTOOLZ uses the local vidnux ComfyUI / FLUX path for images.";
        } else if (errorCode === "no_usable_candidates") {
          message = "Thumbnail generation completed but returned no usable image candidates.";
        }
        throw new Error(message);
      }
      const unwrapped = normalizePayload(payload);
      generatedThumbnailProvider = String(unwrapped.provider || "placeholder");
      generatedThumbnailModel = String(unwrapped.model || "");
      const additions = Array.isArray(unwrapped.candidates) ? unwrapped.candidates : [];
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

  function renderCandidateEditField(candidate, name, label, multiline = true) {
    const value = name === "shortsIdeas" ? (candidate.shortsIdeas || []).filter(Boolean).join("\n") : candidate[name] || "";
    const field = multiline
      ? `<textarea name="${escapeHtml(name)}" rows="3">${escapeHtml(value)}</textarea>`
      : `<input name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
    return `<label><span>${escapeHtml(label)}</span>${field}</label>`;
  }

  function renderCandidateEditForm(candidate) {
    return `
      <form class="candidate-edit-form" data-candidate-edit-form="${escapeHtml(candidate.id)}">
        <div class="candidate-edit-grid">
          ${renderCandidateEditField(candidate, "proposedTitle", "Title", false)}
          ${renderCandidateEditField(candidate, "score", "Score", false)}
          <label>
            <span>Recommendation</span>
            <select name="recommendation">
              ${model.RECOMMENDATIONS.map((item) => `<option value="${escapeHtml(item)}" ${candidate.recommendation === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Difficulty</span>
            <select name="productionDifficulty">
              ${model.DIFFICULTIES.map((item) => `<option value="${escapeHtml(item)}" ${candidate.productionDifficulty === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
            </select>
          </label>
          ${renderCandidateEditField(candidate, "idea", "Idea")}
          ${renderCandidateEditField(candidate, "thumbnailConcept", "Thumbnail concept")}
          ${renderCandidateEditField(candidate, "onThumbnailText", "On-thumbnail text", false)}
          ${renderCandidateEditField(candidate, "thumbnailImage", "Thumbnail image path", false)}
          ${renderCandidateEditField(candidate, "viewerPromise", "Viewer promise")}
          ${renderCandidateEditField(candidate, "targetViewer", "Target viewer")}
          ${renderCandidateEditField(candidate, "mainRisk", "Main risk")}
          ${renderCandidateEditField(candidate, "shortsIdeas", "Shorts ideas")}
          ${model.STRATEGIC_FIELDS.map((field) => renderCandidateEditField(candidate, field, field.replace(/_/g, " "))).join("")}
        </div>
        <div class="package-actions">
          <button type="submit" class="primary-btn">Save edits</button>
          <button type="button" data-edit-cancel="${escapeHtml(candidate.id)}">Cancel</button>
        </div>
      </form>
    `;
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
        <span class="lifecycle-badge">Review workspace</span>
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
    const editing = editingIds.has(candidate.id);
    const isPersistedWinner = candidate.id === persistedSelectedId;
    const isPendingSelection = candidate.id === pendingSelectedId;
    const shorts = candidate.shortsIdeas
      .filter(Boolean)
      .map((idea) => `<li>${escapeHtml(idea)}</li>`)
      .join("");
    const article = document.createElement("article");
    article.className = isPersistedWinner
      ? "package-card selected"
      : isPendingSelection
      ? "package-card pending"
      : "package-card";
    const selectLabel = isPersistedWinner
      ? "Winner selected"
      : isPendingSelection
      ? "Pending selection"
      : "Select winner";
    // The persisted winner has no data-select target — it cannot be re-selected.
    const selectAttr = isPersistedWinner ? "" : ` data-select="${escapeHtml(candidate.id)}"`;
    const mainImage = mainThumbnailImage(candidate);
    article.innerHTML = `
      <div class="package-card-top">
        <span class="package-number">#${candidate.packageNumber}</span>
        <span class="score-pill">${candidate.score}/100</span>
        <span class="recommendation-pill recommendation-${String(candidate.recommendation || "Maybe").toLowerCase()}">${escapeHtml(candidate.recommendation)}</span>
      </div>
      <h2>${escapeHtml(candidate.proposedTitle || "Untitled package")}</h2>
      ${candidate._runId ? `<p class="package-run-origin" style="margin:2px 0 6px;font-size:12px;color:var(--muted,#8b949e);">Selecting this saves into project <strong>${escapeHtml(candidate._runId)}</strong></p>` : ""}
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
        <button type="button" data-edit="${escapeHtml(candidate.id)}">Edit</button>
        <button type="button" data-rereview="${escapeHtml(candidate.id)}">Re-review</button>
        <button type="button" data-delete="${escapeHtml(candidate.id)}">Delete</button>
        <button class="primary-btn" type="button"${selectAttr}>${selectLabel}</button>
      </div>
      ${editing ? renderCandidateEditForm(candidate) : ""}
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
    const persisted = candidateSet.candidates.find((candidate) => candidate.id === persistedSelectedId) || null;
    const pending = pendingSelectedId
      ? candidateSet.candidates.find((candidate) => candidate.id === pendingSelectedId) || null
      : null;
    let summary;
    if (persisted) {
      summary = `Winner: #${persisted.packageNumber}: ${persisted.proposedTitle}`;
      if (pending && pending.id !== persisted.id) {
        summary += ` · Pending: #${pending.packageNumber}: ${pending.proposedTitle}`;
      }
    } else if (pending) {
      summary = `Pending: #${pending.packageNumber}: ${pending.proposedTitle}`;
    } else {
      summary = "No winner selected";
    }
    els.selectedSummary.textContent = summary;
    els.downloadJson.disabled = !selected;
    els.downloadMarkdown.disabled = !selected;
    els.generateThumbnails.disabled = isGeneratingThumbnails || !visible.length;
    els.generateThumbnails.textContent = isGeneratingThumbnails ? "Generating thumbnails…" : "Generate thumbnail candidates";
    renderGeneratedThumbnailPanel();
    renderPackageFocusPanel();
    setPackageEngineViewMode(packageEngineViewMode, { persist: false });
    els.grid.innerHTML = "";
    if (!visible.length) {
      if (!candidateSet.candidates.length) {
        els.grid.innerHTML = `<div class="empty-state"><p class="muted">No package candidates found.</p><p class="muted">Package Engine scans all <code>package-runs/</code> directories for <code>package-candidates.json</code> files on load. Ensure at least one run has candidates, or use manual import to paste candidates directly.</p></div>`;
      } else {
        els.grid.innerHTML = `<p class="muted">No candidates match the current filter. Try changing the run filter, clearing search, or switching recommendation to "All".</p>`;
      }
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
    const edit = event.target.closest("[data-edit]");
    const editCancel = event.target.closest("[data-edit-cancel]");
    const rereview = event.target.closest("[data-rereview]");
    const deleteBtn = event.target.closest("[data-delete]");
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
    if (edit) {
      editingIds.add(edit.dataset.edit);
      render();
      return;
    }
    if (editCancel) {
      editingIds.delete(editCancel.dataset.editCancel);
      render();
      return;
    }
    if (rereview) {
      reReviewCandidate(rereview.dataset.rereview);
      return;
    }
    if (deleteBtn) {
      deleteCandidate(deleteBtn.dataset.delete);
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
      pendingSelectedId = select.dataset.select;
      showStatus("Pending selection. Review the confirmation panel below.", "success");
      render();
      showConfirmPanel();
    }
  }

  function candidateById(candidateId) {
    return candidateSet.candidates.find((candidate) => candidate.id === candidateId) || null;
  }

  function updateCandidateInMemory(updatedCandidate) {
    const existing = candidateById(updatedCandidate.id);
    const metadata = existing
      ? {
          _runId: existing._runId,
          _runState: existing._runState,
          _hasSelectedPackage: existing._hasSelectedPackage,
        }
      : {};
    candidateSet.candidates = candidateSet.candidates.map((candidate) =>
      candidate.id === updatedCandidate.id ? { ...updatedCandidate, ...metadata } : candidate
    );
  }

  function postCandidateUpdate(candidate, fields) {
    if (!localWriteNonce) {
      showStatus("Cannot save: local write nonce is missing. Refresh the page to retry.", "error");
      return Promise.reject(new Error("Missing local write nonce."));
    }
    const runId = candidate._runId || candidateSet._runId || "";
    if (!runId) {
      showStatus("Cannot save: candidate has no source run.", "error");
      return Promise.reject(new Error("Missing run ID."));
    }
    return fetch("/api/package-runs/candidates/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", [nonceHeader]: localWriteNonce },
      body: JSON.stringify({ runId, candidateId: candidate.id, fields, localWriteNonce }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data: normalizePayload(data) })))
      .then(({ ok, data }) => {
        if (!ok || !data || data.ok === false) throw new Error((data && data.error) || "Candidate update failed.");
        updateCandidateInMemory(data.candidate);
        editingIds.delete(candidate.id);
        showStatus("Candidate saved to package-candidates.json.", "success");
        render();
        return data.candidate;
      });
  }

  function handleGridSubmit(event) {
    const form = event.target.closest("[data-candidate-edit-form]");
    if (!form) return;
    event.preventDefault();
    const candidate = candidateById(form.dataset.candidateEditForm);
    if (!candidate) return;
    const data = new FormData(form);
    const fields = {};
    for (const field of model.editableCandidateFields()) {
      if (!data.has(field)) continue;
      fields[field] = field === "shortsIdeas"
        ? String(data.get(field) || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
        : String(data.get(field) || "");
    }
    postCandidateUpdate(candidate, fields).catch((error) => showStatus(error.message, "error"));
  }

  function deleteCandidate(candidateId) {
    const candidate = candidateById(candidateId);
    if (!candidate) return;
    if (!localWriteNonce) {
      showStatus("Cannot delete: local write nonce is missing. Refresh the page to retry.", "error");
      return;
    }
    const runId = candidate._runId || candidateSet._runId || "";
    if (!runId) {
      showStatus("Cannot delete: candidate has no source run.", "error");
      return;
    }
    if (!window.confirm(`Soft-delete candidate #${candidate.packageNumber}: ${candidate.proposedTitle || candidate.id}?`)) return;
    fetch("/api/package-runs/candidates/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", [nonceHeader]: localWriteNonce },
      body: JSON.stringify({ runId, candidateId: candidate.id, localWriteNonce }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data: normalizePayload(data) })))
      .then(({ ok, data }) => {
        if (!ok || !data || data.ok === false) throw new Error((data && data.error) || "Candidate delete failed.");
        candidateSet.candidates = candidateSet.candidates.filter((item) => item.id !== candidate.id);
        editingIds.delete(candidate.id);
        expandedIds.delete(candidate.id);
        if (pendingSelectedId === candidate.id) pendingSelectedId = "";
        showStatus("Candidate soft-deleted in package-candidates.json.", "success");
        render();
      })
      .catch((error) => showStatus(error.message, "error"));
  }

  function reReviewCandidate(candidateId) {
    const candidate = candidateById(candidateId);
    if (!candidate) return;
    const promptText = model.buildReReviewPrompt(candidate);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(promptText).catch(() => {});
    }
    const pasted = window.prompt("Re-review prompt copied. Paste the returned JSON here:");
    if (!pasted) {
      showStatus("Re-review prompt copied. No pasted JSON applied.", "");
      return;
    }
    let fields;
    try {
      fields = JSON.parse(pasted);
    } catch (error) {
      showStatus("Pasted re-review result is not valid JSON.", "error");
      return;
    }
    postCandidateUpdate(candidate, fields).catch((error) => showStatus(error.message, "error"));
  }

  function showConfirmPanel() {
    const selected = selectedCandidate();
    if (!selected) return;
    // Prefer the candidate's own run ID (from server-side discovery), fall back to URL ?run=...
    const runId = selected._runId || new URLSearchParams(window.location.search).get("run") || "";
    els.confirmTitle.textContent = selected.proposedTitle || selected.idea || "Untitled";
    if (els.confirmRunId) els.confirmRunId.textContent = runId || "unknown";

    if (!runId) {
      // No run ID anywhere — still show the panel, skip the existing-file check, warn the user.
      els.confirmPanel.classList.remove("hidden");
      els.nextStepsPanel.classList.add("hidden");
      els.confirmStatus.textContent = "Warning: no run ID found for this candidate.";
      els.confirmStatus.className = "confirm-status error";
      return;
    }

    // Hide the panel during the async existing-file check so the user cannot
    // confirm before the CREATE/REPLACE mode is determined.
    els.confirmPanel.classList.add("hidden");
    els.confirmStatus.textContent = "Checking for existing selection...";
    els.confirmStatus.className = "confirm-status";

    // Check if this run already has a saved selected-package.json so the panel can
    // distinguish CREATE (no file yet) from REPLACE (a different selection is on disk).
    fetch(`package-runs/${runId}/selected-package.json`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((existing) => {
        if (existing) {
          const existingPkg = existing.package || existing;
          const existingId = (existingPkg && existingPkg.id) || existing.id || "";
          // If the user is reviewing the candidate already persisted on disk, just show
          // its saved next-steps state instead of offering to overwrite it.
          if (existingId && existingId === currentSelectedId()) {
            showNextSteps(runId, existingPkg, true);
            return;
          }
          // Otherwise saving would REPLACE a different on-disk selection — require explicit replace.
          setConfirmPanelMode("replace", existingPkg);
          return;
        }
        setConfirmPanelMode("create", null);
      })
      .catch(() => {
        setConfirmPanelMode("create", null);
      });
  }

  function setConfirmPanelMode(mode, existingPkg) {
    els.confirmPanel.classList.remove("hidden");
    els.nextStepsPanel.classList.add("hidden");
    els.confirmStatus.textContent = "";
    els.confirmStatus.className = "confirm-status";
    if (mode === "replace") {
      const existingTitle = existingPkg
        ? existingPkg.proposedTitle || existingPkg.proposed_title || existingPkg.title || "Untitled"
        : "Untitled";
      els.confirmPanel.classList.add("confirm-replace");
      if (els.confirmModeText) {
        els.confirmModeText.textContent = `This will REPLACE the existing selected-package.json (currently: ${existingTitle}).`;
        els.confirmModeText.className = "confirm-mode-text replace";
      }
      els.confirmSaveBtn.textContent = "Replace Selection";
    } else {
      els.confirmPanel.classList.remove("confirm-replace");
      if (els.confirmModeText) {
        els.confirmModeText.textContent = "This will CREATE a new selected-package.json.";
        els.confirmModeText.className = "confirm-mode-text create";
      }
      els.confirmSaveBtn.textContent = "Confirm and Save";
    }
  }

  function handleConfirmSave() {
    const selected = selectedCandidate();
    if (!selected) return;
    // Prefer the candidate's own run ID (from server-side discovery), fall back to URL ?run=...
    const runId = selected._runId || new URLSearchParams(window.location.search).get("run") || "";
    if (!runId) {
      els.confirmStatus.textContent = "No run ID found. Select a candidate with a run ID or use ?run=<runId> in the URL.";
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
        // Stamp the workflow path chosen at the start (new-video-build) onto the run.
        workflowPath: (function () { try { return localStorage.getItem("vidtoolz-workflow-path-v1") || ""; } catch (e) { return ""; } })(),
        localWriteNonce,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Save failed");
        els.confirmStatus.textContent = "Saved.";
        els.confirmStatus.className = "confirm-status success";
        els.confirmPanel.classList.add("hidden");
        // Promote the saved candidate to the persisted winner and clear the pending state
        // so the card and Stage 1 panel both reflect what is now on disk.
        persistedSelectedId = selected.id;
        pendingSelectedId = "";
        render();
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
          <button type="button" id="copyPromptBtn" class="btn-copy">Copy to Clipboard</button>
          <button type="button" id="openChatGptBtn" class="btn-external">Open ChatGPT</button>
          <button type="button" id="openClaudeBtn" class="btn-external">Open Claude</button>
          <button type="button" id="downloadPromptBtn" class="btn-secondary">Download as .md</button>
          <button type="button" id="openRunFolderBtn" class="btn-secondary">Open Run Folder</button>
        </div>
        <p class="confirm-status" id="promptCopyStatus" role="status"></p>
        <pre id="outlinePromptText" class="prompt-text"></pre>
        <textarea id="outlinePromptFallback" class="prompt-text hidden" rows="10" readonly></textarea>
        <div class="outline-result-box">
          <h4>Paste the generated outlines</h4>
          <p class="muted">Run the prompt in Hermes/ChatGPT, then paste the three outline options below and save them straight into the run folder as <code>final-outline.md</code> — no manual file editing.</p>
          <textarea id="outlineResultInput" class="prompt-text" rows="14" placeholder="Paste the outline options returned by Hermes / ChatGPT here…"></textarea>
          <div class="prompt-actions">
            <button type="button" id="saveFinalOutlineBtn" class="primary-btn">Save as final-outline.md</button>
          </div>
          <p class="confirm-status" id="saveFinalOutlineStatus" role="status"></p>
        </div>
        <p style="margin-top: 0.75rem;">
          <a class="nav-link-button btn-primary" href="package-runs-dashboard.html?run=${encodeURIComponent(runSlug)}">Next: Go to Dashboard</a>
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
      genBtn.onclick = () => {
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
            // Wire up copy/download/open buttons
            const copyBtn = document.querySelector("#copyPromptBtn");
            const chatGptBtn = document.querySelector("#openChatGptBtn");
            const claudeBtn = document.querySelector("#openClaudeBtn");
            const dlBtn = document.querySelector("#downloadPromptBtn");
            const copyStatus = document.querySelector("#promptCopyStatus");
            const fallbackText = document.querySelector("#outlinePromptFallback");
            const copyPrompt = () => copyTextWithFeedback(data.outlinePrompt || "", copyBtn, copyStatus, fallbackText);
            if (copyBtn) {
              copyBtn.addEventListener("click", copyPrompt);
            }
            if (chatGptBtn) {
              chatGptBtn.addEventListener("click", () => {
                copyPrompt();
                window.open("https://chatgpt.com/", "_blank", "noopener");
              });
            }
            if (claudeBtn) {
              claudeBtn.addEventListener("click", () => {
                copyPrompt();
                window.open("https://claude.ai/", "_blank", "noopener");
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
      };
    }

    // Wire up the "Open Run Folder" button. It opens the run folder via the
    // existing /api/package-runs/open endpoint — it never writes any files.
    const openFolderBtn = document.querySelector("#openRunFolderBtn");
    if (openFolderBtn) {
      openFolderBtn.addEventListener("click", () => {
        // Resolve run ID using the same priority as the save path:
        // 1. Prefer selected candidate _runId
        // 2. Fall back to URL ?run=...
        // 3. Fall back to persisted selected package run if available
        const selected = selectedCandidate();
        const urlRunId = new URLSearchParams(window.location.search).get("run") || "";
        const resolvedRunId = (selected && selected._runId) || urlRunId || "";
        if (!resolvedRunId) {
          // Try persisted: find the run that has the selected package
          const persistedRun = discoveredRuns.find((run) => run && run.hasSelectedPackage === true);
          if (persistedRun && persistedRun.runId) {
            openRunFolder(persistedRun.runId, openFolderBtn);
          } else {
            openFolderBtn.disabled = true;
            openFolderBtn.textContent = "No run folder available";
          }
          return;
        }
        openRunFolder(resolvedRunId, openFolderBtn);
      });
    }

    // Wire up the "Save as final-outline.md" button. It writes the pasted
    // outline text into the run's final-outline.md via the nonce-gated
    // save-outline endpoint, replacing the old manual file-editing step.
    const saveOutlineBtn = document.querySelector("#saveFinalOutlineBtn");
    const saveOutlineStatus = document.querySelector("#saveFinalOutlineStatus");
    const outlineResultInput = document.querySelector("#outlineResultInput");
    if (saveOutlineBtn && outlineResultInput) {
      saveOutlineBtn.addEventListener("click", () => {
        const content = outlineResultInput.value.trim();
        if (!content) {
          saveOutlineStatus.textContent = "Paste the generated outline text before saving.";
          saveOutlineStatus.className = "confirm-status error";
          return;
        }
        if (!localWriteNonce) {
          saveOutlineStatus.textContent = "Cannot save: local write nonce is missing. Refresh the page to retry.";
          saveOutlineStatus.className = "confirm-status error";
          return;
        }
        saveOutlineBtn.disabled = true;
        saveOutlineStatus.textContent = "Saving…";
        saveOutlineStatus.className = "confirm-status";
        fetch("/api/package-engine/save-outline", {
          method: "POST",
          headers: { "Content-Type": "application/json", [nonceHeader]: localWriteNonce },
          body: JSON.stringify({ runId: runSlug, content, localWriteNonce }),
        })
          .then((r) => r.json().then((data) => ({ ok: r.ok, data: normalizePayload(data) })))
          .then(({ ok, data }) => {
            if (!ok || !data || data.ok === false) throw new Error((data && data.error) || "Save failed.");
            saveOutlineStatus.textContent = `Saved ${data.path || "final-outline.md"}. Next stage (Script) is unblocked.`;
            saveOutlineStatus.className = "confirm-status success";
            saveOutlineBtn.disabled = false;
          })
          .catch((err) => {
            saveOutlineStatus.textContent = err.message;
            saveOutlineStatus.className = "confirm-status error";
            saveOutlineBtn.disabled = false;
          });
      });
    }
  }

  function copyTextWithFeedback(text, btn, status, fallbackText) {
    const original = btn ? btn.textContent : "";
    function showCopied(message) {
      if (btn) {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = original || "Copy to Clipboard";
          btn.classList.remove("copied");
        }, 2000);
      }
      if (status) {
        status.textContent = message || "Text copied to clipboard. Paste into ChatGPT with Ctrl+V.";
        status.className = "confirm-status success";
      }
    }
    function showFallback() {
      if (fallbackText) {
        fallbackText.value = text || "";
        fallbackText.classList.remove("hidden");
        fallbackText.focus();
        fallbackText.select();
      }
      if (status) {
        status.textContent = "Clipboard unavailable. Press Ctrl+C to copy the selected text.";
        status.className = "confirm-status error";
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text || "").then(() => showCopied(), showFallback);
      return;
    }
    showFallback();
  }

  function openRunFolder(runId, btn) {
    if (!localWriteNonce) {
      btn.textContent = "No run folder available";
      btn.disabled = true;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Opening...";
    fetch("/api/package-runs/open", {
      method: "POST",
      headers: { "Content-Type": "application/json", [nonceHeader]: localWriteNonce },
      body: JSON.stringify({ runId, localWriteNonce }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data: normalizePayload(data) })))
      .then(({ ok, data }) => {
        if (ok && data && data.ok !== false) {
          btn.disabled = false;
          btn.textContent = "Open Run Folder";
        } else {
          btn.disabled = false;
          btn.textContent = "Open Run Folder";
          const status = document.querySelector("#outlineGenStatus");
          if (status) {
            status.textContent = (data && data.error) || "Could not open run folder.";
            status.className = "confirm-status error";
          }
        }
      })
      .catch(() => {
        btn.disabled = false;
        btn.textContent = "Open Run Folder";
      });
  }

  function loadDiscoveredCandidates() {
    const api = "/api/package-runs/candidates?includeParked=true";
    return fetch(api, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Discovery API returned ${response.status}`);
        return response.json();
      })
      .then((rawJson) => {
        const payload = normalizePayload(rawJson);
        if (!payload || !Array.isArray(payload.runs)) {
          throw new Error("Discovery API returned unexpected format");
        }
        discoveredRuns = payload.runs || [];
        discoveredActiveRunId = payload.activeRunId || "";

        // Aggregate all candidates from all discovered runs
        const allCandidates = [];
        for (const run of discoveredRuns) {
          const runCandidates = Array.isArray(run.candidates) ? run.candidates : [];
          for (const c of runCandidates) {
            // Tag each candidate with its run ID for filtering
            if (!c._runId) c._runId = run.runId;
            if (!c._runState) c._runState = run.state;
            if (!c._hasSelectedPackage) c._hasSelectedPackage = run.hasSelectedPackage;
            allCandidates.push(c);
          }
        }

        if (allCandidates.length === 0) {
          throw new Error("No candidates found in any package-run directory.");
        }

        // Build a combined candidateSet that looks like what validatePackageCandidateSet expects
        candidateSet = {
          candidates: allCandidates,
          _runId: discoveredActiveRunId || (discoveredRuns[0] && discoveredRuns[0].runId) || "",
        };
        candidateSource = `discovered (${discoveredRuns.length} runs, ${allCandidates.length} candidates)`;

        // Default to all runs so nothing is hidden on initial load
        if (els.runFilter) {
          runFilterMode = "all";
          els.runFilter.value = "all";
        }

        showStatus(
          `Loaded ${allCandidates.length} candidates from ${discoveredRuns.length} run(s)${discoveredActiveRunId ? " — active: " + discoveredActiveRunId : ""}.`,
          "success"
        );
        render();
        // Read-only: mark the candidate already persisted on disk as the winner. No writes.
        return loadPersistedSelectedId().then(() => true);
      })
      .catch((error) => {
        // Discovery failed — fall back to static file load
        showStatus(`Discovery unavailable: ${error.message}. Falling back to static file.`, "");
        return false;
      });
  }

  function loadPersistedSelectedId() {
    // Read-only: fetch selected-package.json for runs that report hasSelectedPackage and mark
    // that candidate as the persisted winner. Must not write, save, or confirm anything.
    const runsWithSelection = discoveredRuns.filter((run) => run && run.hasSelectedPackage === true);
    if (!runsWithSelection.length) return Promise.resolve();
    // Prefer the active run if it has a selection, otherwise use the first one found.
    const active = runsWithSelection.find((run) => run.runId === discoveredActiveRunId);
    const target = active || runsWithSelection[0];
    if (!target || !target.runId) return Promise.resolve();
    return fetch(`package-runs/${target.runId}/selected-package.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((rawJson) => {
        if (!rawJson) return;
        const data = normalizePayload(rawJson);
        const pkg = (data && data.package) || data || {};
        const persistedId = pkg.id || data.id || "";
        if (persistedId) {
          persistedSelectedId = persistedId;
          render();
        }
      })
      .catch(() => {});
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
  els.grid.addEventListener("submit", handleGridSubmit);
  els.sort.addEventListener("change", render);
  els.filter.addEventListener("change", render);
  if (els.runFilter) {
    els.runFilter.addEventListener("change", () => {
      runFilterMode = els.runFilter.value;
      render();
    });
  }
  if (els.search) {
    els.search.addEventListener("input", () => {
      searchQuery = els.search.value.trim();
      render();
    });
  }
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
  loadThumbnailGenerationConfig().finally(() => {
    loadDiscoveredCandidates().then((discovered) => {
      if (!discovered) loadCandidates();
    });
  });
})();
