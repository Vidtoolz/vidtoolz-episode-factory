/**
 * VIDTOOLZ Visual Pipeline Tracker
 * Shows the 13-stage canonical production pipeline with progress per video.
 * Any page can include this and call PipelineTracker.mount(container, data).
 *
 * This file's STAGES / VERTICAL_STAGES arrays are the RUNTIME SOURCE OF TRUTH
 * for the production stage model. config/production-stages.json and
 * VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md are generated FROM here via
 * `node scripts/generate-production-spec.js` (a drift check runs in the tests).
 * Edit stages here, then regenerate — do not edit the generated artifacts.
 */
(function PipelineTrackerModule(globalScope) {
  "use strict";

  const STAGES = [
    { id: 0,  key: "idea",         label: "Idea",          short: "Idea" },
    { id: 1,  key: "research",      label: "Research",       short: "Research" },
    { id: 2,  key: "script",        label: "Script",         short: "Script" },
    { id: 3,  key: "claims",        label: "Claims Check",   short: "Claims" },
    { id: 4,  key: "packaging",     label: "Packaging",      short: "Package" },
    { id: 5,  key: "image-prompts", label: "Image Prompts",  short: "Prompts" },
    { id: 6,  key: "image-gen",     label: "Image Gen",      short: "Images" },
    { id: 7,  key: "image-select",  label: "Image Select",   short: "Select" },
    { id: 8,  key: "video-gen",     label: "Video Gen",      short: "Wan/Kling" },
    { id: 9,  key: "a-roll",        label: "A-Roll Record",  short: "A-Roll" },
    { id: 10, key: "assembly",      label: "Assembly Edit",  short: "Assemble" },
    { id: 11, key: "publish-gate",  label: "Publish Gate",   short: "Gate" },
    { id: 12, key: "published",     label: "Published",      short: "Done" },
  ];

  // Vertical / Shorts path is intentionally shorter: no research/claims/packaging.
  const VERTICAL_STAGES = [
    { id: 0, key: "idea",          label: "Topic",          short: "Topic" },
    { id: 1, key: "script",        label: "Script",         short: "Script" },
    { id: 2, key: "image-prompts", label: "Image Prompts",  short: "Prompts" },
    { id: 3, key: "image-gen",     label: "Image Gen",      short: "Images" },
    { id: 4, key: "image-select",  label: "Image Select",   short: "Select" },
    { id: 5, key: "i2v-prompts",   label: "I2V Prompts",    short: "I2V" },
    { id: 6, key: "video-gen",     label: "Video Gen",      short: "PRESTO" },
    { id: 7, key: "view",          label: "View + Resolve", short: "View" },
  ];

  function stagesForPath(workflowPath) {
    return String(workflowPath || "") === "vertical" ? VERTICAL_STAGES : STAGES;
  }

  /**
   * Map Episode Factory statuses to pipeline stages.
   * The Episode Factory uses a simpler 8-status model; we map to 13 stages.
   */
  function statusToStage(status) {
    const map = {
      "Idea": 0,
      "Packaging": 4,
      "Script": 2,
      "Ready to Shoot": 9,
      "Editing": 10,
      "Ready to Publish": 11,
      "Published": 12,
      "Archived": 12,
    };
    return map[status] !== undefined ? map[status] : 0;
  }

  /**
   * Map a package-run gate number to pipeline stages.
   * Package runs use gates 0-5; we map to 13 stages.
   */
  function gateToStage(gate) {
    const map = { 0: 0, 1: 2, 2: 4, 3: 6, 4: 8, 5: 10 };
    return map[gate] !== undefined ? map[gate] : 0;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stagesArrayToMap(stageList = []) {
    const result = {};
    (Array.isArray(stageList) ? stageList : []).forEach((stage) => {
      if (!stage || !stage.key) return;
      let status = "pending";
      if (stage.blocked) status = "blocked";
      else if (stage.active) status = "active";
      else if (stage.completed) status = "completed";
      result[stage.key] = { status, note: stage.note || "" };
    });
    return result;
  }

  function normalizeData(data = {}) {
    return {
      ...data,
      stages: Array.isArray(data.stages) ? stagesArrayToMap(data.stages) : (data.stages || {}),
    };
  }

  function render(container, data = {}) {
    if (!container) return;
    data = normalizeData(data);
    const currentStage = data.currentStage !== undefined ? data.currentStage : 0;
    const blockedStage = data.blockedStage || null;
    const stages = data.stages || {};

    const stageList = stagesForPath(data.workflowPath);

    let html = '<div class="pipeline-tracker" role="navigation" aria-label="Production pipeline progress">';

    stageList.forEach((stage) => {
      let stageClass = "";
      let stageStatus = "pending";

      if (stage.id < currentStage) {
        stageClass = "completed";
        stageStatus = "completed";
      } else if (stage.id === currentStage) {
        if (blockedStage === stage.id) {
          stageClass = "blocked";
          stageStatus = "blocked";
        } else {
          stageClass = "active";
          stageStatus = "active";
        }
      }

      // Check for stage-specific overrides
      const stageData = stages[stage.key];
      if (stageData) {
        if (stageData.status === "completed") stageClass = "completed";
        if (stageData.status === "active") stageClass = "active";
        if (stageData.status === "blocked") stageClass = "blocked";
      }

      const icon = stageClass === "completed" ? "✓" : (stage.id + 1);
      html += `<div class="pipeline-stage ${stageClass}" data-stage="${stage.id}" data-key="${stage.key}" title="${escapeHtml(stage.label)}">`;
      html += `<div class="pipeline-dot">${icon}</div>`;
      html += `<div class="pipeline-label">${escapeHtml(stage.short)}</div>`;
      html += `</div>`;
    });

    html += "</div>";

    // Add stage detail if provided
    if (data.title || data.subtitle) {
      html = `<div class="pipeline-tracker-info" style="margin-bottom:8px;">
        ${data.title ? `<div style="font-size:15px;font-weight:700;color:var(--text);">${escapeHtml(data.title)}</div>` : ""}
        ${data.subtitle ? `<div style="font-size:12px;color:var(--muted);">${escapeHtml(data.subtitle)}</div>` : ""}
      </div>` + html;
    }

    // Add next action if provided
    if (data.nextAction) {
      html += `<div style="margin-top:10px;padding:10px 14px;background:rgba(var(--accent-rgb),0.06);border:1px solid rgba(var(--accent-rgb),0.22);border-radius:6px;font-size:13px;">
        <strong style="color:var(--accent);">Next:</strong> ${escapeHtml(data.nextAction)}
      </div>`;
    }

    // Add blocker if provided
    if (data.blocker) {
      html += `<div style="margin-top:8px;padding:10px 14px;background:rgba(248,81,73,0.06);border:1px solid rgba(248,81,73,0.22);border-radius:6px;font-size:13px;">
        <strong style="color:var(--danger);">Blocker:</strong> ${escapeHtml(data.blocker)}
      </div>`;
    }

    container.innerHTML = html;
    return container;
  }

  /**
   * Mount a pipeline tracker into a container element.
   * @param {HTMLElement} container
   * @param {Object} data - { title, currentStage, blockedStage, stages, runFolder }
   */
  function mount(container, data = {}) {
    if (!container) return;
    if (data.runFolder && data.currentStage === undefined && typeof fetch === "function") {
      const runFolder = data.runFolder;
      container.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px;">Loading pipeline status...</div>`;
      fetch(`/api/package-runs/pipeline-status?run=${encodeURIComponent(runFolder)}`, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error(`Pipeline status unavailable (${response.status})`);
          return response.json();
        })
        .then((json) => {
          const payload = json.data !== undefined ? json.data : json;
          render(container, {
            ...payload,
            title: data.title || runFolder,
            subtitle: data.subtitle || "Live package-run pipeline status",
          });
        })
        .catch((error) => {
          container.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:8px;">${escapeHtml(error.message)}</div>`;
        });
      return container;
    }
    return render(container, data);
  }

  /**
   * Get the 13 canonical stages (for reference or custom rendering).
   */
  function getStages() {
    return STAGES.slice();
  }

  globalScope.PipelineTracker = {
    mount,
    render,
    getStages,
    statusToStage,
    gateToStage,
    stagesArrayToMap,
    normalizeData,
    stagesForPath,
    STAGES,
    VERTICAL_STAGES,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.PipelineTracker;
  }
})(typeof window !== "undefined" ? window : globalThis);
