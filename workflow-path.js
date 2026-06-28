/**
 * VIDTOOLZ Workflow Path model (shared by browser + server).
 *
 * Splits the production workflow into two paths chosen at the very beginning:
 *   - "vertical"   : Shorts-style, 9:16 (1080x1920), max ~3 min, simplified linear flow.
 *   - "horizontal" : long-form, 16:9 (1920x1080), ~3-30 min, full production system.
 *
 * The path is stored per-run as a "Workflow path:" marker in package-run-state.md
 * and (pre-run) in localStorage. Unset always resolves to "horizontal" so existing
 * long-form runs are unaffected.
 */
(function workflowPathModule(globalScope) {
  "use strict";

  // localStorage key for the pre-run choice (before a package run exists).
  const WORKFLOW_PATH_STORAGE_KEY = "vidtoolz-workflow-path-v1";
  // The "Key: value" line written into package-run-state.md.
  const WORKFLOW_PATH_MARKER = "Workflow path";

  const WORKFLOW_PATHS = {
    vertical: {
      key: "vertical",
      label: "Vertical video / Short",
      orientation: "vertical",
      width: 1080,
      height: 1920,
      resolution: "1080x1920",
      aspectRatio: "9:16",
      maxDurationMinutes: 3,
      // The simplified, linear Shorts path — no research/claim/packaging/proof.
      stages: [
        { key: "topic", label: "Topic" },
        { key: "script", label: "Choose from 3 scripts" },
        { key: "final-script", label: "Save final script" },
        { key: "image-prompts", label: "Image prompts + images" },
        { key: "i2v-prompts", label: "Image-to-video prompts" },
        { key: "presto", label: "Send to PRESTO" },
        { key: "view-videos", label: "View generated videos" },
        { key: "manual-edit", label: "Record + edit in Resolve (manual)" },
      ],
    },
    horizontal: {
      key: "horizontal",
      label: "Horizontal video / long-form",
      orientation: "horizontal",
      width: 1920,
      height: 1080,
      resolution: "1920x1080",
      aspectRatio: "16:9",
      maxDurationMinutes: 30,
      // Long-form uses the full existing pipeline; stages are defined elsewhere
      // (pipeline-tracker.js / new-video-build.html) and intentionally not duplicated here.
      stages: null,
    },
  };

  const DEFAULT_WORKFLOW_PATH = "horizontal";

  function normalizeWorkflowPath(value) {
    const v = String(value == null ? "" : value).trim().toLowerCase();
    if (v === "vertical" || v === "short" || v === "shorts" || v === "9:16") return "vertical";
    if (v === "horizontal" || v === "long-form" || v === "longform" || v === "16:9") return "horizontal";
    return DEFAULT_WORKFLOW_PATH;
  }

  function workflowPathInfo(value) {
    return WORKFLOW_PATHS[normalizeWorkflowPath(value)];
  }

  function isVertical(value) {
    return normalizeWorkflowPath(value) === "vertical";
  }

  // Parse the "Workflow path:" marker from package-run-state.md text. Default horizontal.
  function readWorkflowPathFromState(markdown) {
    const text = String(markdown || "");
    const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${WORKFLOW_PATH_MARKER}\\s*:\\s*(.+?)\\s*$`, "im");
    const match = text.match(pattern);
    return normalizeWorkflowPath(match ? match[1] : "");
  }

  const api = {
    WORKFLOW_PATH_STORAGE_KEY,
    WORKFLOW_PATH_MARKER,
    WORKFLOW_PATHS,
    DEFAULT_WORKFLOW_PATH,
    normalizeWorkflowPath,
    workflowPathInfo,
    isVertical,
    readWorkflowPathFromState,
  };

  globalScope.WorkflowPath = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
