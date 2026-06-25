/**
 * VIDTOOLZ Visual Beat Map Panel
 * Read-only focused-run view over existing beat-map artifacts.
 * Fetches from /api/package-runs/beat-map?run=<runFolder>.
 */
(function VisualBeatMapPanelModule(globalScope) {
  "use strict";

  const SOURCE_LABELS = {
    "marker-map": "Resolve Marker Map",
    "clip-card": "Media Clip Cards",
    "script-section": "Script Sections",
  };

  const SOURCE_ORDER = ["marker-map", "clip-card", "script-section"];

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function compactText(value, fallback = "") {
    return String(value || fallback || "").trim();
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || source || "Unknown Source";
  }

  function statusClass(value) {
    const status = String(value || "").toLowerCase();
    if (status.includes("real proof")) return "real-proof";
    if (status.includes("do not imply")) return "do-not-imply";
    if (status.includes("illustration")) return "illustration";
    if (status.includes("demonstration")) return "demonstration";
    return "unknown";
  }

  function groupBeats(beats = []) {
    const groups = {};
    SOURCE_ORDER.forEach((source) => {
      groups[source] = [];
    });
    (Array.isArray(beats) ? beats : []).forEach((beat) => {
      const source = beat && beat.source ? beat.source : "unknown";
      if (!groups[source]) groups[source] = [];
      groups[source].push(beat);
    });
    Object.values(groups).forEach((items) => {
      items.sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));
    });
    return groups;
  }

  function renderMeta(label, value) {
    const text = compactText(value);
    if (!text) return "";
    return `<div class="beat-map-meta-row"><span>${escapeHtml(label)}</span><p>${escapeHtml(text)}</p></div>`;
  }

  function renderBeatCard(beat = {}) {
    const source = compactText(beat.source, "unknown");
    const proofStatus = compactText(beat.proofStatus, "not specified");
    const title =
      compactText(beat.narrationCue) ||
      compactText(beat.workingTitle) ||
      compactText(beat.section) ||
      `Beat ${compactText(beat.id, "?")}`;
    const visualJob = compactText(beat.visualJob || beat.insertType || beat.clipType, "No visual job specified");
    const detailRows = [
      renderMeta("Section", beat.section),
      renderMeta("Visual job", visualJob),
      renderMeta("Insert type", beat.insertType),
      renderMeta("Viewer risk", beat.viewerRisk),
      renderMeta("Candidate source", beat.candidateSource),
      renderMeta("Resolve note", beat.resolveNote),
      renderMeta("Edit placement", beat.editPlacement),
      renderMeta("Viewer sees", beat.viewerSees),
      renderMeta("Spoken line", beat.sayLine),
      renderMeta("Capture notes", beat.captureNotes),
      renderMeta("Mikko decision", beat.decisionNeeded),
    ].filter(Boolean);

    return `<article class="beat-map-card beat-map-source-${escapeHtml(source)}">
      <div class="beat-map-card-header">
        <span class="beat-map-id">${escapeHtml(beat.id || "?")}</span>
        <div>
          <p class="beat-map-source-label">${escapeHtml(sourceLabel(source))}</p>
          <h3>${escapeHtml(title)}</h3>
        </div>
        <span class="beat-map-status beat-map-status-${statusClass(proofStatus)}">${escapeHtml(proofStatus)}</span>
      </div>
      <div class="beat-map-card-body">
        ${detailRows.length ? detailRows.join("") : `<p class="muted">No beat details available.</p>`}
      </div>
    </article>`;
  }

  function renderSourceGroup(source, beats = []) {
    if (!beats.length) return "";
    return `<section class="beat-map-source-group" data-beat-source="${escapeHtml(source)}">
      <div class="beat-map-source-header">
        <h3>${escapeHtml(sourceLabel(source))}</h3>
        <span>${beats.length}</span>
      </div>
      <div class="beat-map-list">${beats.map(renderBeatCard).join("")}</div>
    </section>`;
  }

  function renderSourceFlags(sources = {}) {
    const flags = [
      ["markers", "Marker map"],
      ["clipCards", "Clip cards"],
      ["script", "Script"],
    ];
    return `<div class="beat-map-source-flags">
      ${flags
        .map(([key, label]) => `<span class="${sources[key] ? "present" : "missing"}">${escapeHtml(label)}: ${sources[key] ? "present" : "missing"}</span>`)
        .join("")}
    </div>`;
  }

  function renderBeatMapPanel(payload = {}) {
    const beats = Array.isArray(payload.beats) ? payload.beats : [];
    const groups = groupBeats(beats);
    if (!beats.length) {
      return `<div class="visual-beat-map empty">
        <div class="visual-beat-map-header">
          <div>
            <p class="eyebrow">Visual Beat Map</p>
            <h2>No beat map data found</h2>
            <p class="muted">Read-only panel. Add or inspect existing marker map, media plan, or script artifacts for this run.</p>
          </div>
        </div>
        ${renderSourceFlags(payload.sources || {})}
      </div>`;
    }

    const orderedSources = [
      ...SOURCE_ORDER,
      ...Object.keys(groups).filter((source) => !SOURCE_ORDER.includes(source)),
    ];

    return `<div class="visual-beat-map">
      <div class="visual-beat-map-header">
        <div>
          <p class="eyebrow">Visual Beat Map</p>
          <h2>${escapeHtml(payload.runId || "Selected run")}</h2>
          <p class="muted">Read-only timeline from existing package-run artifacts. This panel does not approve or update gates.</p>
        </div>
        <strong>${beats.length} beats</strong>
      </div>
      ${renderSourceFlags(payload.sources || {})}
      <div class="beat-map-groups">
        ${orderedSources.map((source) => renderSourceGroup(source, groups[source] || [])).join("")}
      </div>
    </div>`;
  }

  function mount(container, opts = {}) {
    if (!container) return;
    const runFolder = opts.runFolder || "";
    container.dataset.runFolder = runFolder;
    if (!runFolder) {
      container.innerHTML = `<div class="visual-beat-map empty"><p class="muted">No active run. Select a package run to see its visual beat map.</p></div>`;
      return;
    }
    const apiUrl = opts.apiUrl || `/api/package-runs/beat-map?run=${encodeURIComponent(runFolder)}`;
    container.innerHTML = `<div class="visual-beat-map-loading">Loading visual beat map...</div>`;
    fetch(apiUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((json) => {
        const payload = json.data !== undefined ? json.data : json;
        container.innerHTML = renderBeatMapPanel(payload);
      })
      .catch((error) => {
        container.innerHTML = `<div class="visual-beat-map empty"><p class="muted">Failed to load visual beat map: ${escapeHtml(error.message)}</p></div>`;
      });
  }

  const api = {
    SOURCE_LABELS,
    SOURCE_ORDER,
    escapeHtml,
    statusClass,
    groupBeats,
    renderBeatCard,
    renderBeatMapPanel,
    mount,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.VisualBeatMapPanel = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
