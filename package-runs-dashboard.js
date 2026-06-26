(function packageRunsDashboard(globalScope) {
  "use strict";

  const STATUS_ORDER = [
    "Idea run",
    "Package selected",
    "Research pack ready",
    "Outline prep ready",
    "Final outline ready",
    "Script prep ready",
    "Final script ready",
    "Production prep ready",
    "Ready to shoot",
    "Needs production planning",
    "Needs shot/edit plan review",
    "Needs shot/edit plan approval",
    "Ready for capture checklist",
    "Needs capture",
    "Ready for rough cut",
    "Needs rough-cut review",
    "Ready for second cut",
    "Needs final review",
    "Ready to publish",
    "Needs export check",
    "Ready to upload",
    "Needs publication metadata",
    "Ready to schedule",
    "Needs archive data",
    "Ready to archive",
    "Needs repurposing approval",
    "Ready to cut shorts",
  ];

  const WORKFLOW_FILTERS = [
    "Needs QA repair",
    "Needs proof capture",
    "Narrow shooting approved",
    "Needs package selection",
    "Needs research pack",
    "Needs outline",
    "Needs script",
    "Needs production prep",
    "Needs production planning",
    "Needs shot/edit plan review",
    "Needs shot/edit plan approval",
    "Needs capture checklist",
    "Needs capture",
    "Needs rough-cut review",
    "Needs final review",
    "Needs export check",
    "Needs publication metadata",
    "Needs archive manifest",
    "Needs repurposing approval",
    "QA not run",
    "Ready to shoot",
    "Ready to archive",
    "Ready to cut shorts",
    "Inactive: parked",
    "Inactive: superseded",
  ];

  const PRODUCTION_BUCKETS = [
    "In Production",
    "At Review",
    "Blocked / Needs Action",
    "Inactive / Archived",
  ];

  const REVIEW_WORKFLOW_BUCKETS = [
    "Needs shot/edit plan review",
    "Needs shot/edit plan approval",
    "Needs rough-cut review",
    "Needs final review",
    "Needs export check",
    "Needs publication metadata",
    "Needs repurposing approval",
    "Needs archive manifest",
  ];

  const BLOCKED_WORKFLOW_BUCKETS = [
    "Needs QA repair",
    "Needs proof capture",
  ];

  function productionBucketForRun(run) {
    if (!run) return "In Production";
    if (run.inactive || String(run.workflowBucket || "").startsWith("Inactive:")) {
      return "Inactive / Archived";
    }
    if (BLOCKED_WORKFLOW_BUCKETS.includes(run.workflowBucket)) {
      return "Blocked / Needs Action";
    }
    if (REVIEW_WORKFLOW_BUCKETS.includes(run.workflowBucket)) {
      return "At Review";
    }
    return "In Production";
  }

  function groupRunsByProductionBucket(runs) {
    const buckets = PRODUCTION_BUCKETS.reduce((result, label) => {
      result[label] = [];
      return result;
    }, {});
    (runs || []).forEach((run) => {
      const bucket = productionBucketForRun(run);
      buckets[bucket].push(run);
    });
    return buckets;
  }

  const BEGINNING_TRIAGE_STORAGE_KEY = "vidtoolz-beginning-triage-v1";
  const EPISODE_FACTORY_STORAGE_KEY = "vidtoolz-episode-factory-v1";
  const DASHBOARD_GROUPS = [
    "diagnostics",
    "active-package-run",
    "beginning-triage",
    "capture-rough-cut",
    "final-export",
    "historical-package-runs",
  ];
  const BEGINNING_TRIAGE_STEPS = [
    { id: "not_started", label: "Not started" },
    { id: "topic", label: "Topic Research" },
    { id: "candidates", label: "Candidate Angles" },
    { id: "rough_idea", label: "Rough Idea" },
    { id: "packaging", label: "Packaging Drafts" },
    { id: "claim", label: "Claim Triage" },
    { id: "usefulness", label: "Usefulness Triage" },
    { id: "proof", label: "Proof Triage" },
    { id: "decision", label: "Decision" },
    { id: "next_action", label: "Next action" },
  ];
  const BEGINNING_TRIAGE_PHASES = [
    { id: "discover", label: "Discover direction", stages: ["not_started", "topic", "candidates"] },
    { id: "shape", label: "Shape the promise", stages: ["rough_idea", "packaging"] },
    { id: "validate", label: "Validate with proof", stages: ["claim", "usefulness", "proof", "decision", "next_action"] },
  ];
  const BEGINNING_TRIAGE_BLOCKED_ACTIONS = [
    "No full script",
    "No B-roll generation",
    "No Resolve work",
    "No production-ready status",
    "No publish-ready status",
    "No final title approval",
    "No final thumbnail approval",
    "No package-run promotion unless Mikko explicitly approves later",
  ];

  const FILE_LABELS = [
    ["package_candidates", "package-candidates.json", "Candidates"],
    ["package_run_state", "package-run-state.md", "Run state"],
    ["selected_package_json", "selected-package.json", "Selected JSON"],
    ["selected_package_md", "selected-package.md", "Selected MD"],
    ["research_pack", "research-pack.md", "Research pack"],
    ["outline_prompt", "outline-prompt.md", "Outline prompt"],
    ["final_outline", "final-outline.md", "Final outline"],
    ["script_prompt", "script-prompt.md", "Script prompt"],
    ["script_structure", "script-structure.md", "Script structure"],
    ["final_script", "final-script.md", "Final script"],
    ["production_plan", "production-plan.md", "Production plan"],
    ["production_blockers", "production-blockers.md", "Production blockers"],
    ["shot_edit_plan_review", "shot-edit-plan-review.md", "Shot/edit review"],
    ["shot_edit_plan_enhancement_plan", "shot-edit-plan-enhancement-plan.md", "Shot/edit fixes"],
    ["capture_checklist", "capture-checklist.md", "Capture checklist"],
    ["takes_log", "takes-log.md", "Takes log"],
    ["missing_shot_tracker", "missing-shot-tracker.md", "Missing shots"],
    ["screen_recording_checklist", "screen-recording-checklist.md", "Screen recording"],
    ["audio_capture_checklist", "audio-capture-checklist.md", "Audio capture"],
    ["capture_evidence_review", "capture-evidence-review.md", "Capture evidence review"],
    ["rough_cut_watch_notes", "rough-cut-watch-notes.md", "Rough-cut notes"],
    ["rough_cut_review", "rough-cut-review.md", "Rough-cut review"],
    ["pickup_list", "pickup-list.md", "Pickup list"],
    ["edit_fix_list", "edit-fix-list.md", "Edit fixes"],
    ["final_watch_notes", "final-watch-notes.md", "Final-watch notes"],
    ["final_review", "final-review.md", "Final review"],
    ["publication_blockers", "publication-blockers.md", "Publication blockers"],
    ["export_checklist", "export-checklist.md", "Export checklist"],
    ["master_file_manifest", "master-file-manifest.md", "Master manifest"],
    ["caption_check", "caption-check.md", "Caption check"],
    ["loudness_check", "loudness-check.md", "Loudness check"],
    ["delivery_readiness", "delivery-readiness.md", "Delivery readiness"],
    ["publish_metadata_review", "publish-metadata-review.md", "Metadata review"],
    ["title_check", "title-check.md", "Title check"],
    ["thumbnail_check", "thumbnail-check.md", "Thumbnail check"],
    ["description_check", "description-check.md", "Description check"],
    ["chapters_check", "chapters-check.md", "Chapters check"],
    ["schedule_check", "schedule-check.md", "Schedule check"],
    ["archive_manifest", "archive-manifest.md", "Archive manifest"],
    ["archive_source_files", "archive-source-files.md", "Archive sources"],
    ["archive_assets_manifest", "archive-assets-manifest.md", "Archive assets"],
    ["archive_export_manifest", "archive-export-manifest.md", "Archive exports"],
    ["reusable_clips_manifest", "reusable-clips-manifest.md", "Reusable clips"],
    ["archive_blockers", "archive-blockers.md", "Archive blockers"],
    ["capture_verification_note", "capture-verification-note.md", "Capture plan"],
    ["capture_result_note", "capture-result-note.md", "Capture result"],
    ["capture_transcript", "capture-transcript.md", "Capture transcript"],
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
    ["repurposing_plan", "repurposing-plan.md", "Repurposing plan"],
    ["shorts_candidates", "shorts-candidates.md", "Shorts candidates"],
    ["platform_variants", "platform-variants.md", "Platform variants"],
  ];

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizePayload(json) {
    if (json && typeof json === "object" && json.ok && json.data) return json.data;
    return json;
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
        const creatorQaStatus = normalizeCreatorQaStatus(run.creatorQaStatus || "not run");
        const qaBlocking = isCreatorQaBlocking(creatorQaStatus);
        const qaNotRun = creatorQaStatus === "not run";
        const evidenceGate = normalizeEvidenceGate(run.evidenceGate);
        const lifecycleGate = normalizeLifecycleGate(run.lifecycleGate);
        const packageRunState =
          run.packageRunState && typeof run.packageRunState === "object"
            ? {
                markerFile: String(run.packageRunState.markerFile || ""),
                raw: String(run.packageRunState.raw || ""),
                state: String(run.packageRunState.state || "active"),
                explicit: Boolean(run.packageRunState.explicit),
                isInactive: Boolean(run.packageRunState.isInactive),
                warning: String(run.packageRunState.warning || ""),
              }
            : {
                markerFile: "",
                raw: "",
                state: "active",
                explicit: false,
                isInactive: Boolean(run.inactive),
                warning: "",
              };
        const workflowBucket =
          packageRunState.isInactive
            ? String(run.workflowBucket || `Inactive: ${packageRunState.state}`)
            : qaBlocking ||
                (status === "Ready to shoot" &&
                  (qaNotRun || evidenceGate.blocksProductionReady || evidenceGate.hasNarrowShootingApproval))
              ? workflowBucketForStatus(status, creatorQaStatus, evidenceGate)
              : String(run.workflowBucket || workflowBucketForStatus(status, creatorQaStatus, evidenceGate));
        let nextRecommendedCommand = String(run.nextRecommendedCommand || "");
        if (!nextRecommendedCommand && qaBlocking) {
          nextRecommendedCommand =
            creatorQaStatus === "FAIL"
              ? "Review creator-qa-report.md and repair package/script before shooting."
              : `Review Creator QA status ${creatorQaStatus} and repair package/script before shooting.`;
        } else if (!nextRecommendedCommand && status === "Ready to shoot" && evidenceGate.hasNarrowShootingApproval) {
          nextRecommendedCommand =
            "Shoot only the narrow approved scope; editing, publishing, upload prep, final title, and final thumbnail remain blocked.";
        } else if (!nextRecommendedCommand && status === "Ready to shoot" && evidenceGate.blocksProductionReady) {
          nextRecommendedCommand = "Capture or import durable proof evidence before production approval.";
        } else if (!nextRecommendedCommand && status === "Ready to shoot" && qaNotRun) {
          nextRecommendedCommand = `node scripts/package-run-creator-qa.js ${run.path || "package-runs/YYYY-MM-DD-topic-slug"}`;
        }
        return {
          runId: String(run.runId || ""),
          path: String(run.path || ""),
          title: String(run.title || ""),
          status,
          activeStatus: String(run.activeStatus || ""),
          creatorQaStatus,
          evidenceGate,
          lifecycleGate,
          workflowBucket,
          activeWorkflowBucket: String(run.activeWorkflowBucket || ""),
          packageRunState,
          inactive: Boolean(run.inactive || packageRunState.isInactive),
          overallStatus: String(run.overallStatus || (/^Ready\b/.test(status) ? "READY FOR NEXT STAGE" : /^Needs\b/.test(status) ? "BLOCKED" : "NEEDS WORK")),
          firstBlockerReason: String(run.firstBlockerReason || ""),
          missingExpectedArtifacts: normalizeStringArray(run.missingExpectedArtifacts),
          conservativeBlockedActions: normalizeStringArray(run.conservativeBlockedActions),
          detectedButNotTrustedArtifacts: normalizeDetectedButNotTrusted(run.detectedButNotTrustedArtifacts),
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

  function normalizeCreatorQaStatus(value = "not run") {
    const status = String(value || "").trim().toUpperCase().replace(/_/g, " ");
    if (!status) return "not run";
    if (status === "NOT RUN") return "not run";
    if (status === "PASS") return "PASS";
    if (status === "FAIL") return "FAIL";
    if (status === "NEEDS WORK") return "NEEDS WORK";
    return status;
  }

  function isCreatorQaBlocking(creatorQaStatus = "not run") {
    const status = normalizeCreatorQaStatus(creatorQaStatus);
    return status !== "PASS" && status !== "not run";
  }

  function normalizeEvidenceGate(evidenceGate) {
    const source = evidenceGate && typeof evidenceGate === "object" ? evidenceGate : {};
    return {
      status: String(source.status || "not evaluated"),
      warning: String(source.warning || ""),
      blocksProductionReady: Boolean(source.blocksProductionReady),
      hasCapturePlan: Boolean(source.hasCapturePlan),
      hasCaptureResult: Boolean(source.hasCaptureResult),
      saysNoCapturedOutput: Boolean(source.saysNoCapturedOutput),
      hasCaptureTranscript: Boolean(source.hasCaptureTranscript),
      hasVisualCapture: Boolean(source.hasVisualCapture),
      evidenceReferences: Array.isArray(source.evidenceReferences) ? source.evidenceReferences.map(String) : [],
      hasNarrowShootingApproval: Boolean(source.hasNarrowShootingApproval),
      approvedActions: Array.isArray(source.approvedActions) ? source.approvedActions.map(String) : [],
      blockedActions: Array.isArray(source.blockedActions) ? source.blockedActions.map(String) : [],
      approvalReference: String(source.approvalReference || ""),
    };
  }

  function normalizeLifecycleGate(lifecycleGate) {
    const source = lifecycleGate && typeof lifecycleGate === "object" ? lifecycleGate : {};
    const effectiveReadiness = normalizeEffectiveReadiness(source.effectiveReadiness || source);
    return {
      hasShotEditPlanReview: Boolean(source.hasShotEditPlanReview),
      shotEditPlanReviewStatus: String(source.shotEditPlanReviewStatus || ""),
      shotEditPlanAccepted: Boolean(source.shotEditPlanAccepted),
      shotEditPlanBlockers: String(source.shotEditPlanBlockers || ""),
      shotEditPlanNextSafeAction: String(source.shotEditPlanNextSafeAction || ""),
      hasCaptureEvidenceReview: Boolean(source.hasCaptureEvidenceReview),
      captureEvidenceReviewStatus: String(source.captureEvidenceReviewStatus || ""),
      captureEvidenceAccepted: Boolean(source.captureEvidenceAccepted),
      captureEvidenceRealEvidence: Boolean(source.captureEvidenceRealEvidence),
      captureEvidenceNextSafeAction: String(source.captureEvidenceNextSafeAction || ""),
      captureEvidenceBlockers: String(source.captureEvidenceBlockers || ""),
      hasConcreteCaptureEvidence: Boolean(source.hasConcreteCaptureEvidence),
      effectiveReadiness,
      effectiveCaptureApproved: Boolean(source.effectiveCaptureApproved || effectiveReadiness.captureApproved),
      effectiveReadyForRoughCut: Boolean(source.effectiveReadyForRoughCut || effectiveReadiness.readyForRoughCut),
      effectivePublishReady: Boolean(source.effectivePublishReady || effectiveReadiness.publishReady),
      effectiveReadyToUpload: Boolean(source.effectiveReadyToUpload || effectiveReadiness.readyToUpload),
      effectiveReadyToSchedule: Boolean(source.effectiveReadyToSchedule || effectiveReadiness.readyToSchedule),
      effectiveReadyToArchive: Boolean(source.effectiveReadyToArchive || effectiveReadiness.readyToArchive),
      effectiveReadyToCutShorts: Boolean(source.effectiveReadyToCutShorts || effectiveReadiness.readyToCutShorts),
      hasRealRoughCutEvidence: Boolean(source.hasRealRoughCutEvidence),
      hasRealFinalWatchEvidence: Boolean(source.hasRealFinalWatchEvidence),
      hasConcreteExportEvidence: Boolean(source.hasConcreteExportEvidence),
      hasConcretePublicationMetadata: Boolean(source.hasConcretePublicationMetadata),
      hasConcreteArchiveEvidence: Boolean(source.hasConcreteArchiveEvidence),
    };
  }

  function normalizeEffectiveReadiness(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      captureApproved: Boolean(source.captureApproved),
      readyForRoughCut: Boolean(source.readyForRoughCut),
      publishReady: Boolean(source.publishReady),
      readyToUpload: Boolean(source.readyToUpload),
      readyToSchedule: Boolean(source.readyToSchedule),
      readyToArchive: Boolean(source.readyToArchive),
      readyToCutShorts: Boolean(source.readyToCutShorts),
      downstreamReadinessOverridden: Boolean(source.downstreamReadinessOverridden),
      overrideReason: String(source.overrideReason || ""),
      nextSafeAction: String(source.nextSafeAction || ""),
      rawMarkers: normalizeStringArray(source.rawMarkers),
    };
  }

  function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item || "")).filter(Boolean) : [];
  }

  function normalizeDetectedButNotTrusted(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (typeof item === "string") return { artifact: item, reason: "Not trusted as proof." };
        const source = item && typeof item === "object" ? item : {};
        return {
          artifact: String(source.artifact || ""),
          reason: String(source.reason || "Not trusted as proof."),
        };
      })
      .filter((item) => item.artifact);
  }

  function workflowBucketForStatus(status, creatorQaStatus = "not run", evidenceGate = {}) {
    const qaStatus = normalizeCreatorQaStatus(creatorQaStatus);
    if (isCreatorQaBlocking(qaStatus)) return "Needs QA repair";
    if (status === "Ready to shoot" && evidenceGate.hasNarrowShootingApproval) return "Narrow shooting approved";
    if (status === "Ready to shoot" && evidenceGate.blocksProductionReady) return "Needs proof capture";
    if (status === "Ready to shoot" && qaStatus === "not run") return "QA not run";
    const bucketByStatus = {
      "Idea run": "Needs package selection",
      "Package selected": "Needs research pack",
      "Research pack ready": "Needs outline",
      "Outline prep ready": "Needs outline",
      "Final outline ready": "Needs script",
      "Script prep ready": "Needs script",
      "Final script ready": "Needs production prep",
      "Production prep ready": "Needs production prep",
      "Ready to shoot": "Ready to shoot",
      "Needs production planning": "Needs production planning",
      "Needs shot/edit plan review": "Needs shot/edit plan review",
      "Needs shot/edit plan approval": "Needs shot/edit plan approval",
      "Ready for capture checklist": "Needs capture checklist",
      "Needs capture": "Needs capture",
      "Ready for rough cut": "Needs rough-cut review",
      "Needs rough-cut review": "Needs rough-cut review",
      "Ready for second cut": "Needs final review",
      "Needs final review": "Needs final review",
      "Ready to publish": "Needs export check",
      "Needs export check": "Needs export check",
      "Ready to upload": "Needs publication metadata",
      "Needs publication metadata": "Needs publication metadata",
      "Ready to schedule": "Needs archive manifest",
      "Needs archive data": "Needs archive manifest",
      "Ready to archive": "Ready to archive",
      "Needs repurposing approval": "Needs repurposing approval",
      "Ready to cut shorts": "Ready to cut shorts",
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
    const blocking = run.workflowBucket === "Needs QA repair" || run.workflowBucket === "Needs proof capture" ? " blocking" : "";
    return `<div class="run-command${blocking}"><span>Next command</span><code>${escapeHtml(run.nextRecommendedCommand)}</code></div>`;
  }

  function creatorQaClass(status) {
    const normalized = normalizeCreatorQaStatus(status);
    if (isCreatorQaBlocking(normalized) && normalized !== "FAIL" && normalized !== "NEEDS WORK") {
      return "creator-qa-blocking";
    }
    return `creator-qa-${String(normalized || "not-run").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function renderCreatorQaStatus(run) {
    const status = normalizeCreatorQaStatus(run.creatorQaStatus || "not run");
    const qaBlocking = isCreatorQaBlocking(status);
    const qaNotRun = status === "not run";
    const reportHref = run.files && run.files.creator_qa_report ? fileHref(run, "creator-qa-report.md") : "";
    const reportLink = reportHref
      ? `<a href="${escapeHtml(reportHref)}" data-preview-artifact="${escapeHtml(reportHref)}" data-artifact-title="Creator QA report" data-run-id="${escapeHtml(run.runId)}">preview report</a>`
      : "";
    let note = "Run Creator QA before shooting or publishing.";
    if (qaBlocking) {
      note = reportLink
        ? `Blocking: ${reportLink} and repair package/script before shooting.`
        : "Blocking: repair package/script before shooting.";
    } else if (reportLink) {
      note = reportLink;
    } else if (qaNotRun) {
      note = "QA not run. Run Creator QA before shooting or publishing.";
    }
    const label = qaBlocking ? "Creator QA blocker" : "Creator QA";
    return `<div class="creator-qa-status ${creatorQaClass(status)}"><span>${label}</span><strong>${escapeHtml(status)}</strong><small>${note}</small></div>`;
  }

  function evidenceGateClass(status) {
    return `evidence-gate-${String(status || "not-evaluated").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function renderEvidenceGate(run) {
    const gate = normalizeEvidenceGate(run.evidenceGate);
    const references = gate.evidenceReferences.length
      ? `Evidence refs: ${gate.evidenceReferences.map(escapeHtml).join(", ")}`
      : "No capture transcript, screenshot, or recording reference detected.";
    const note = gate.warning || references;
    const label = gate.blocksProductionReady ? "Evidence Gate blocker" : "Evidence Gate";
    return `<div class="evidence-gate-status ${evidenceGateClass(gate.status)}"><span>${label}</span><strong>${escapeHtml(gate.status)}</strong><small>${note}</small>${gate.warning ? `<small>${references}</small>` : ""}</div>`;
  }

  function lifecycleReviewClass(run) {
    const status = run.lifecycleGate.shotEditPlanReviewStatus || run.status || "";
    if (run.overallStatus === "BLOCKED" || status === "BLOCKED" || status === "NEEDS WORK") return "lifecycle-blocked";
    if (status === "READY FOR HUMAN APPROVAL" || !run.lifecycleGate.shotEditPlanAccepted) return "lifecycle-human";
    if (status === "PASS" && run.lifecycleGate.shotEditPlanAccepted) return "lifecycle-pass";
    return "lifecycle-neutral";
  }

  function renderStatusBadge(value, fallback = "not evaluated") {
    const label = String(value || fallback);
    const className = `lifecycle-badge lifecycle-badge-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    return `<span class="${className}">${escapeHtml(label)}</span>`;
  }

  function renderCompactList(items, emptyLabel, className = "") {
    const normalized = normalizeStringArray(items);
    if (!normalized.length) return `<p class="muted">${escapeHtml(emptyLabel)}</p>`;
    return `<ul class="${className}">${normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function renderDetectedButNotTrusted(run) {
    const items = normalizeDetectedButNotTrusted(run.detectedButNotTrustedArtifacts);
    if (!items.length) {
      return `<div class="lifecycle-subsection"><h4>Detected but not trusted yet</h4><p class="muted">No detected downstream artifacts are currently being rejected as proof.</p></div>`;
    }
    return `<div class="lifecycle-subsection lifecycle-not-trusted"><h4>Detected but not trusted yet</h4><ul>${items
      .map((item) => {
        const label = /missing evidence/i.test(item.reason) ? "Missing evidence" : "Not trusted as proof";
        return `<li><strong>${escapeHtml(item.artifact)}</strong>${renderStatusBadge(label)}<small>${escapeHtml(item.reason)}</small></li>`;
      })
      .join("")}</ul></div>`;
  }

  function captureEvidenceStarterMarkdown(run) {
    const runId = run.runId || "YYYY-MM-DD-topic-slug";
    return `# Manual Capture Evidence Rows For ${runId}

Paste and edit these rows in the matching capture artifacts after real capture work exists.

takes-log.md:
| Take 01 - captured section name | shot-list.md item | media/take-01-section-name.mov | Human-reviewed usable take; note timestamp or issue. | captured |

screen-recording-checklist.md:
| Screen recording - workflow proof | proof purpose | recordings/workflow-proof-001.mp4 | captured |

audio-capture-checklist.md:
| Voiceover or A-roll audio | final-script.md section | audio/voiceover-main.wav | recorded |

missing-shot-tracker.md:
| None. | Required capture scope reviewed. | No fix needed. | closed |

Approval marker, only after human review:
Capture evidence approval: PASS`;
  }

  function markdownCell(value = "") {
    return String(value || "").trim().replace(/\r?\n/g, " ").replace(/\|/g, "/").replace(/\s+/g, " ");
  }

  function captureEvidenceInputDefaults() {
    return {
      takeName: "",
      takeSource: "",
      takeReference: "",
      takeNotes: "",
      screenName: "",
      screenPurpose: "",
      screenReference: "",
      audioItem: "",
      audioRequirement: "",
      audioReference: "",
    };
  }

  function missingRequiredCaptureFields(values = {}) {
    const fields = [];
    if (!markdownCell(values.takeName)) fields.push("take name");
    if (!markdownCell(values.takeReference)) fields.push("take media reference");
    if (!markdownCell(values.screenName)) fields.push("screen recording name");
    if (!markdownCell(values.screenReference)) fields.push("screen recording file/reference");
    if (!markdownCell(values.audioItem)) fields.push("audio item");
    if (!markdownCell(values.audioReference)) fields.push("audio file/reference");
    return fields;
  }

  function formatCaptureEvidenceRows(values = {}) {
    const input = { ...captureEvidenceInputDefaults(), ...values };
    const missing = missingRequiredCaptureFields(input);
    const takeSource = markdownCell(input.takeSource) || "shot-list.md";
    const takeNotes = markdownCell(input.takeNotes) || "Human-reviewed captured take; add quality notes, timestamp, or issue.";
    const screenPurpose = markdownCell(input.screenPurpose) || "Capture proof for the approved production plan.";
    const audioRequirement = markdownCell(input.audioRequirement) || "Final script narration or A-roll audio.";
    return {
      valid: missing.length === 0,
      missing,
      takesLog: missing.length
        ? `Missing required fields for real evidence: ${missing.join(", ")}. Add concrete media references before pasting.`
        : `| ${markdownCell(input.takeName)} | ${takeSource} | ${markdownCell(input.takeReference)} | ${takeNotes} | captured |`,
      screenRecordingChecklist: missing.length
        ? `Missing required fields for real evidence: ${missing.join(", ")}. Add a concrete screen recording file/reference before pasting.`
        : `| ${markdownCell(input.screenName)} | ${screenPurpose} | ${markdownCell(input.screenReference)} | captured |`,
      audioCaptureChecklist: missing.length
        ? `Missing required fields for real evidence: ${missing.join(", ")}. Add a concrete audio file/reference before pasting.`
        : `| ${markdownCell(input.audioItem)} | ${audioRequirement} | ${markdownCell(input.audioReference)} | recorded |`,
      approvalMarker: "Capture evidence approval: PASS",
    };
  }

  function renderCaptureInput(name, label, placeholder, required = false) {
    return `<label class="capture-intake-field">
      <span>${escapeHtml(label)}${required ? " *" : ""}</span>
      <input type="text" data-capture-field="${escapeHtml(name)}" placeholder="${escapeHtml(placeholder)}" />
    </label>`;
  }

  function renderCopyTarget(label, target, value) {
    return `<div class="capture-copy-target">
      <div class="capture-copy-header">
        <strong>${escapeHtml(label)}</strong>
        <button type="button" data-copy-capture-row="${escapeHtml(target)}">Copy</button>
      </div>
      <textarea readonly rows="3" data-capture-output="${escapeHtml(target)}">${escapeHtml(value)}</textarea>
    </div>`;
  }

  function renderCaptureEvidenceIntake(run) {
    const rows = formatCaptureEvidenceRows(captureEvidenceInputDefaults());
    return `<details class="capture-evidence-intake" data-capture-intake data-run-id="${escapeHtml(run.runId)}" open>
      <summary>Capture Evidence Intake</summary>
      <p class="muted">Generated rows do not approve capture. Preview before writing, then apply only after checking the exact Markdown. Copy buttons remain available for manual paste.</p>
      <div class="capture-intake-grid">
        <fieldset>
          <legend>Takes / A-roll / camera capture</legend>
          ${renderCaptureInput("takeName", "Take identifier", "Take 01 - hook A-roll", true)}
          ${renderCaptureInput("takeSource", "Source item", "shot-list.md hook row")}
          ${renderCaptureInput("takeReference", "Media filename/path", "media/take-01-hook-2026-05-12.mov", true)}
          ${renderCaptureInput("takeNotes", "Quality notes", "usable take, 00:00-00:42, clean audio")}
        </fieldset>
        <fieldset>
          <legend>Screen recording capture</legend>
          ${renderCaptureInput("screenName", "Recording name", "Screen recording - workflow proof", true)}
          ${renderCaptureInput("screenPurpose", "Proof purpose", "shows approved workflow result")}
          ${renderCaptureInput("screenReference", "Recording filename/path", "recordings/workflow-proof-001.mp4", true)}
        </fieldset>
        <fieldset>
          <legend>Audio / voiceover capture</legend>
          ${renderCaptureInput("audioItem", "Audio item", "Voiceover main pass", true)}
          ${renderCaptureInput("audioRequirement", "Capture requirement", "final-script.md sections 1-4")}
          ${renderCaptureInput("audioReference", "Audio filename/path", "audio/voiceover-main.wav", true)}
        </fieldset>
      </div>
      <div class="capture-intake-validation" data-capture-validation>${escapeHtml(rows.takesLog)}</div>
      <div class="capture-copy-grid">
        ${renderCopyTarget("takes-log.md row", "takesLog", rows.takesLog)}
        ${renderCopyTarget("screen-recording-checklist.md row", "screenRecordingChecklist", rows.screenRecordingChecklist)}
        ${renderCopyTarget("audio-capture-checklist.md row", "audioCaptureChecklist", rows.audioCaptureChecklist)}
      </div>
      <div class="capture-write-panel" data-capture-write-panel>
        <h5>Local write preview</h5>
        <p class="muted">Local-only write path. Preview performs no file writes. Apply updates only the marked intake section in the three approved capture files and writes an audit log in this run folder.</p>
        <div class="capture-write-actions">
          <button type="button" data-capture-preview>Preview write</button>
          <button type="button" data-capture-apply disabled>Apply to run files</button>
        </div>
        <div class="capture-write-status" data-capture-write-status>Preview required before Apply is enabled.</div>
        <textarea readonly rows="12" class="capture-write-preview" data-capture-write-preview placeholder="Preview will show the exact Markdown sections before writing."></textarea>
      </div>
      <div class="capture-approval-helper">
        <h5>Approval marker after human review</h5>
        <p class="muted">This marker is required for PASS, but it is not enough without real evidence rows.</p>
        ${renderCopyTarget("approval marker", "approvalMarker", rows.approvalMarker)}
      </div>
    </details>`;
  }

  function renderCaptureEvidencePanel(run) {
    const gate = run.lifecycleGate || normalizeLifecycleGate({});
    const effective = gate.effectiveReadiness || normalizeEffectiveReadiness({});
    const status = gate.hasCaptureEvidenceReview ? gate.captureEvidenceReviewStatus || "not evaluated" : "missing review";
    const realEvidence = gate.captureEvidenceRealEvidence || gate.hasConcreteCaptureEvidence;
    const accepted = effective.captureApproved;
    const nextSafeAction =
      effective.nextSafeAction ||
      gate.captureEvidenceNextSafeAction ||
      (accepted
        ? "Ready for rough cut only after approval; downstream review gates still apply."
        : "Real evidence required: add concrete capture rows, then run capture evidence review.");
    const missingEvidence = [];
    if (!realEvidence) missingEvidence.push("Concrete media references in takes, screen recordings, or audio capture rows.");
    if (!gate.hasCaptureEvidenceReview) missingEvidence.push("capture-evidence-review.md");
    if (gate.hasCaptureEvidenceReview && !accepted) missingEvidence.push("Exact capture-stage approval marker after human review.");
    return `<div class="capture-evidence-panel">
      <div class="lifecycle-review-header">
        <div>
          <h4>Capture Evidence</h4>
          <p>${renderStatusBadge(realEvidence ? "Ready for rough cut only after approval" : "Real evidence required")}</p>
        </div>
        ${renderStatusBadge(status)}
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Effective capture approved</span><strong>${accepted ? "yes" : "no"}</strong>${!accepted ? `<small>${renderStatusBadge("Human approval required")}</small>` : ""}</div>
        <div><span>Effective ready for rough cut</span><strong>${effective.readyForRoughCut ? "yes" : "no"}</strong>${!effective.readyForRoughCut ? `<small>${renderStatusBadge("Blocked")}</small>` : ""}</div>
        <div><span>Real capture evidence detected</span><strong>${realEvidence ? "yes" : "no"}</strong>${!realEvidence ? `<small>${renderStatusBadge("Missing evidence")}</small>` : ""}</div>
        <div><span>Missing capture evidence</span>${renderCompactList(missingEvidence, "No missing capture evidence reported.", "lifecycle-missing-list")}</div>
        <div><span>Missing shots / blockers</span><strong>${escapeHtml(gate.captureEvidenceBlockers || "No capture evidence blocker detail reported.")}</strong></div>
        ${
          effective.downstreamReadinessOverridden
            ? `<div><span>Raw readiness overridden</span><strong>yes</strong><small>${escapeHtml(effective.overrideReason)}</small></div>`
            : ""
        }
      </div>
      <div class="lifecycle-subsection">
        <h4>Next safe action</h4>
        <p>${escapeHtml(nextSafeAction)}</p>
      </div>
      <details class="capture-evidence-helper">
        <summary>Copyable Markdown helper</summary>
        <textarea readonly rows="12">${escapeHtml(captureEvidenceStarterMarkdown(run))}</textarea>
      </details>
      ${renderCaptureEvidenceIntake(run)}
    </div>`;
  }

  function roughCutInputDefaults() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      reviewedFilePath: "",
      reviewedFileType: "rough-cut candidate",
      watchDate: today,
      reviewer: "Mikko",
      first30SecondsNotes: "",
      clarityNotes: "",
      pacingNotes: "",
      proofEvidenceNotes: "",
      missingVisuals: "",
      audioProblems: "",
      graphicsProblems: "",
      confusingSections: "",
      sectionsToCutTighten: "",
      pickupsNeeded: "",
      editFixesNeeded: "",
      secondCutRecommendation: "",
      roughCutApprovalMarker: "NOT GIVEN",
    };
  }

  function renderRoughCutTextInput(name, label, value = "", required = false) {
    return `<label class="rough-cut-field">
      <span>${escapeHtml(label)}${required ? " *" : ""}</span>
      <input type="text" data-rough-cut-field="${escapeHtml(name)}" value="${escapeHtml(value)}" />
    </label>`;
  }

  function renderRoughCutTextarea(name, label, required = false) {
    return `<label class="rough-cut-field rough-cut-field-wide">
      <span>${escapeHtml(label)}${required ? " *" : ""}</span>
      <textarea rows="4" data-rough-cut-field="${escapeHtml(name)}"></textarea>
    </label>`;
  }

  function renderRoughCutApprovalSelect() {
    return `<label class="rough-cut-field">
      <span>Rough-cut approval marker *</span>
      <select data-rough-cut-field="roughCutApprovalMarker">
        <option value="NOT GIVEN">NOT GIVEN</option>
        <option value="NEEDS PICKUPS">NEEDS PICKUPS</option>
        <option value="NEEDS EDIT FIXES">NEEDS EDIT FIXES</option>
        <option value="PASS">PASS</option>
      </select>
    </label>`;
  }

  function renderRoughCutResult(result) {
    if (!result || !result.review) return "";
    const review = result.review || {};
    return `<div class="rough-cut-result">
      <h4>Review Result</h4>
      <div class="lifecycle-review-grid">
        <div><span>Rough-cut review status</span><strong>${escapeHtml(review.roughCutReviewStatus || "unknown")}</strong></div>
        <div><span>Second-cut ready</span><strong>${review.secondCutReady ? "yes" : "no"}</strong></div>
        <div><span>Reason</span><strong>${escapeHtml(review.reason || "No reason returned.")}</strong></div>
        <div><span>Pickup list status</span><strong>${escapeHtml(review.pickupListStatus || "not reported")}</strong></div>
        <div><span>Edit fix list status</span><strong>${escapeHtml(review.editFixListStatus || "not reported")}</strong></div>
      </div>
      <details>
        <summary>Command output</summary>
        <pre><code>${escapeHtml(result.stdout || result.stderr || "No output.")}</code></pre>
      </details>
    </div>`;
  }

  function beginningTriageInitialState() {
    return {
      stage: "not_started",
      decision: "",
      selectedCandidate: "",
      selectedPackage: "",
      status: "Not started",
      fields: {
        topicArea: "",
        audienceGuess: "",
        topicWhyNow: "",
        mikkoSuspects: "",
        possibleProof: "",
        candidate1Title: "",
        candidate1Problem: "",
        candidate1Care: "",
        candidate1Claim: "",
        candidate1Proof: "",
        candidate1Packaging: "",
        candidate1Risk: "",
        candidate1Fit: "",
        candidate2Title: "",
        candidate2Problem: "",
        candidate2Care: "",
        candidate2Claim: "",
        candidate2Proof: "",
        candidate2Packaging: "",
        candidate2Risk: "",
        candidate2Fit: "",
        candidate3Title: "",
        candidate3Problem: "",
        candidate3Care: "",
        candidate3Claim: "",
        candidate3Proof: "",
        candidate3Packaging: "",
        candidate3Risk: "",
        candidate3Fit: "",
        rawIdea: "",
        researchChange: "",
        chosenDirectionReason: "",
        package1Title: "",
        package1ThumbnailConcept: "",
        package1ThumbnailText: "",
        package1VisualHook: "",
        package1Promise: "",
        package1ClickReason: "",
        package1Risk: "",
        package2Title: "",
        package2ThumbnailConcept: "",
        package2ThumbnailText: "",
        package2VisualHook: "",
        package2Promise: "",
        package2ClickReason: "",
        package2Risk: "",
        package3Title: "",
        package3ThumbnailConcept: "",
        package3ThumbnailText: "",
        package3VisualHook: "",
        package3Promise: "",
        package3ClickReason: "",
        package3Risk: "",
        bestClaim: "",
        claimOptionA: "",
        claimOptionB: "",
        claimOptionC: "",
        whyCare: "",
        viewerDecision: "",
        creatorMistake: "",
        authorityBasis: "",
        minimumViableProof: "",
        mainOverclaimRisk: "",
        claimMapClaim: "",
        proofNeeded: "",
        existingProof: "",
        proofGap: "",
        visualEvidence: "",
        forbiddenUnlessProven: "",
        nextThirtyMinuteAction: "",
        nextActionNote: "",
      },
    };
  }

  function normalizeBeginningTriageState(source = {}) {
    const initial = beginningTriageInitialState();
    const state = source && typeof source === "object" ? source : {};
    const fields = state.fields && typeof state.fields === "object" ? state.fields : {};
    const sourceStage = state.stage === "idea" ? "topic" : state.stage;
    const stage = BEGINNING_TRIAGE_STEPS.some((step) => step.id === sourceStage) ? sourceStage : initial.stage;
    const step = BEGINNING_TRIAGE_STEPS.find((item) => item.id === stage) || BEGINNING_TRIAGE_STEPS[0];
    return {
      ...initial,
      ...state,
      stage,
      decision: String(state.decision || ""),
      selectedCandidate: String(state.selectedCandidate || ""),
      selectedPackage: String(state.selectedPackage || ""),
      status: String(state.status || (stage === "not_started" ? "Not started" : step.label)),
      fields: Object.fromEntries(Object.entries(initial.fields).map(([key, value]) => [key, String(fields[key] || value)])),
    };
  }

  function beginningTriageStepIndex(stage) {
    const index = BEGINNING_TRIAGE_STEPS.findIndex((step) => step.id === stage);
    return index >= 0 ? index : 0;
  }

  function beginningTriagePhaseIndex(stage) {
    const index = BEGINNING_TRIAGE_PHASES.findIndex((phase) => phase.stages.includes(stage));
    return index >= 0 ? index : 0;
  }

  function beginningTriageStepLabel(stage) {
    const step = BEGINNING_TRIAGE_STEPS.find((item) => item.id === stage);
    return step ? step.label : "Not started";
  }

  function beginningTriageStatusLabel(state) {
    if (state.stage === "not_started") return "Not started";
    if (state.stage === "next_action" && state.decision === "Continue") return "Proof Candidate";
    if (state.decision === "Pause") return "Paused";
    if (state.decision === "Reject") return "Rejected";
    if (state.decision === "Rework") return "Rework needed";
    const phase = beginningTriagePhaseIndex(state.stage);
    if (phase === 0) return "Discovering direction";
    if (phase === 1) return "Shaping promise";
    return "Validating proof";
  }

  function renderBeginningTriageStepper(state) {
    const current = beginningTriagePhaseIndex(state.stage);
    return `<div class="beginning-progress-wrap">
      <ol class="beginning-triage-stepper" aria-label="Beginning triage phases">
        ${BEGINNING_TRIAGE_PHASES.map((phase, index) => `<li class="${index < current ? "complete" : index === current ? "current" : "future"}">
          <span>${index + 1}</span><strong>${escapeHtml(phase.label)}</strong>
        </li>`).join("")}
      </ol>
      <p class="beginning-current-step">Current step: ${escapeHtml(beginningTriageStepLabel(state.stage))}</p>
    </div>`;
  }

  function renderBeginningTriageSummaryCards(state) {
    const fields = state.fields || {};
    const selectedCandidateTitle = fields[`candidate${state.selectedCandidate || "1"}Title`] || "";
    const selectedPackageTitle = fields[`package${state.selectedPackage || "1"}Title`] || "";
    const cards = [];
    if (state.selectedCandidate || selectedCandidateTitle) {
      cards.push(`<article class="beginning-summary-card">
        <span>Selected candidate</span>
        <strong>${escapeHtml(selectedCandidateTitle || `Candidate ${state.selectedCandidate}`)}</strong>
        <small>${escapeHtml(fields[`candidate${state.selectedCandidate || "1"}Claim`] || "Claim not captured yet.")}</small>
      </article>`);
    }
    if (fields.rawIdea) {
      cards.push(`<article class="beginning-summary-card">
        <span>Rough idea</span>
        <strong>${escapeHtml(fields.rawIdea)}</strong>
      </article>`);
    }
    if (state.selectedPackage || selectedPackageTitle) {
      cards.push(`<article class="beginning-summary-card">
        <span>Selected package</span>
        <strong>${escapeHtml(selectedPackageTitle || `Package ${state.selectedPackage}`)}</strong>
        <small>${escapeHtml(fields[`package${state.selectedPackage || "1"}Promise`] || "Promise not captured yet.")}</small>
      </article>`);
    }
    if (fields.bestClaim || fields.proofGap) {
      cards.push(`<article class="beginning-summary-card">
        <span>Claim/proof status</span>
        <strong>${escapeHtml(fields.bestClaim || "Claim not written yet.")}</strong>
        <small>${escapeHtml(fields.proofGap || "Proof gap not mapped yet.")}</small>
      </article>`);
    }
    return cards.length ? `<section class="beginning-summary-strip" aria-label="Completed beginning triage selections">${cards.join("")}</section>` : "";
  }

  function renderBeginningTopAction(state) {
    if (state.stage === "not_started") return `<button type="button" class="primary-action" data-beginning-action="start">Start</button>`;
    if (state.stage === "topic") return `<button type="button" class="primary-action" data-beginning-action="research">Research the topic</button>`;
    if (state.stage === "candidates") return `<span class="beginning-next-label">Next: select a candidate or research again.</span>`;
    if (state.stage === "rough_idea") return `<button type="button" class="primary-action" data-beginning-action="goto" data-beginning-target="packaging">Continue to packaging</button>`;
    if (state.stage === "packaging") return `<span class="beginning-next-label">Next: select a planning package.</span>`;
    if (state.stage === "claim") return `<button type="button" class="primary-action" data-beginning-action="goto" data-beginning-target="usefulness">Continue to Usefulness Triage</button>`;
    if (state.stage === "usefulness") return `<button type="button" class="primary-action" data-beginning-action="goto" data-beginning-target="proof">Continue to Proof Triage</button>`;
    if (state.stage === "proof") return `<button type="button" class="primary-action" data-beginning-action="goto" data-beginning-target="decision">Proof path exists / continue</button>`;
    if (state.stage === "decision") return `<span class="beginning-next-label">Next: choose Continue, Rework, Pause, or Reject.</span>`;
    return `<span class="beginning-next-label">Next: write one 30-minute action.</span>`;
  }

  function renderBeginningHelp(summary, body) {
    return `<details class="beginning-help">
      <summary>${escapeHtml(summary)}</summary>
      <div>${body}</div>
    </details>`;
  }

  function renderBeginningActiveCard(title, decisionNow, body, controls = "", helper = "") {
    return `<section class="beginning-active-card" aria-label="${escapeHtml(title)}">
      <div class="beginning-active-header">
        <div>
          <p class="eyebrow">Active Card</p>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(decisionNow)}</p>
        </div>
      </div>
      ${helper}
      ${body}
      ${controls}
    </section>`;
  }

  function renderBeginningUpcoming(stage) {
    const current = beginningTriageStepIndex(stage);
    const upcoming = BEGINNING_TRIAGE_STEPS.slice(current + 1, current + 4);
    return upcoming.length ? `<section class="beginning-upcoming" aria-label="Upcoming beginning triage steps">
      <span>Upcoming</span>
      ${upcoming.map((step) => `<small>${escapeHtml(step.label)}</small>`).join("")}
    </section>` : "";
  }

  function renderBeginningTriageField(fields, key, label, placeholder = "", ownership = "input") {
    const ownerClass = ownership === "paste" ? "field-ownership--paste" : "field-ownership--input";
    const ownerLabel = ownership === "paste" ? "Paste from research" : "Your input";
    return `<label class="beginning-triage-field">
      <span>${escapeHtml(label)}</span>
      <small class="field-ownership ${ownerClass}">${ownerLabel}</small>
      <textarea rows="3" data-beginning-field="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(fields[key] || "")}</textarea>
    </label>`;
  }

  function buildBeginningResearchHandoffPrompt(topicArea = "") {
    const topic = String(topicArea || "").trim() || "[topic area]";
    return `Research this VIDTOOLZ topic for serious creators: ${topic}.
Return 3 alternative but equally promising video candidate angles. For each, include core viewer problem, why serious creators should care, potential claim, proof path, packaging potential, overclaim risk, and VIDTOOLZ fit. Do not claim anything as proven without evidence.`;
  }

  function renderBeginningCandidateCard(fields, index, selectedCandidate = "") {
    const selected = selectedCandidate === String(index);
    return `<article class="beginning-candidate-card${selected ? " selected" : ""}">
      <div class="beginning-card-heading">
        <strong>${escapeHtml(fields[`candidate${index}Title`] || `Candidate ${index}`)}</strong>
        ${selected ? renderStatusBadge("selected") : ""}
      </div>
      ${renderBeginningTriageField(fields, `candidate${index}Title`, "Angle name", "", "paste")}
      ${renderBeginningTriageField(fields, `candidate${index}Problem`, "Viewer problem", "", "paste")}
      ${renderBeginningTriageField(fields, `candidate${index}Claim`, "Potential claim", "", "paste")}
      ${renderBeginningTriageField(fields, `candidate${index}Proof`, "Proof path", "", "paste")}
      ${renderBeginningTriageField(fields, `candidate${index}Risk`, "Risk", "", "paste")}
      <details class="beginning-card-notes">
        <summary>More notes</summary>
        ${renderBeginningTriageField(fields, `candidate${index}Care`, "Why serious creators should care", "", "paste")}
        ${renderBeginningTriageField(fields, `candidate${index}Packaging`, "Packaging potential", "", "paste")}
        ${renderBeginningTriageField(fields, `candidate${index}Fit`, "VIDTOOLZ fit", "", "paste")}
      </details>
      <button type="button" class="primary-action" data-beginning-action="select-candidate" data-beginning-candidate="${index}">Select this candidate</button>
    </article>`;
  }

  function renderBeginningPackageCard(fields, index, selectedPackage = "") {
    const selected = selectedPackage === String(index);
    return `<article class="beginning-package-card${selected ? " selected" : ""}">
      <div class="beginning-card-heading">
        <strong>${escapeHtml(fields[`package${index}Title`] || `Package ${index}`)}</strong>
        ${selected ? renderStatusBadge("selected planning package") : ""}
      </div>
      ${renderBeginningTriageField(fields, `package${index}Title`, "Title")}
      ${renderBeginningTriageField(fields, `package${index}ThumbnailText`, "Thumbnail text, 0-4 words")}
      ${renderBeginningTriageField(fields, `package${index}VisualHook`, "Visual hook")}
      ${renderBeginningTriageField(fields, `package${index}Promise`, "Promise")}
      ${renderBeginningTriageField(fields, `package${index}Risk`, "Truthfulness risk")}
      <details class="beginning-card-notes">
        <summary>More notes</summary>
        ${renderBeginningTriageField(fields, `package${index}ThumbnailConcept`, "Thumbnail concept")}
        ${renderBeginningTriageField(fields, `package${index}ClickReason`, "Why this might earn a click")}
      </details>
      <button type="button" class="primary-action" data-beginning-action="select-package" data-beginning-package="${index}">Select this package</button>
    </article>`;
  }

  function beginningTriageGuidance(title, goal, mikkoNeeds, allowedActions = []) {
    return renderBeginningHelp(
      "Step guidance",
      `<div class="beginning-triage-guidance">
        <div><h3>Current step</h3><p>${escapeHtml(title)}</p></div>
        <div><h3>Goal</h3><p>${escapeHtml(goal)}</p></div>
        <div><h3>What Mikko needs to do right now</h3><p>${escapeHtml(mikkoNeeds)}</p></div>
        <div><h3>Current allowed actions</h3>${renderCompactList(allowedActions, "Write, pause, go back, or reject.")}</div>
      </div>`
    );
  }

  function renderBeginningTriageBoundary() {
    return `<details class="beginning-triage-boundary">
      <summary>Boundaries</summary>
      ${renderCompactList(BEGINNING_TRIAGE_BLOCKED_ACTIONS, "No blocked actions listed.")}
      <p>This is an operator guidance UI, not an approval system. This has not created or promoted a package run.</p>
    </details>`;
  }

  function renderBeginningTriageControls(buttons = []) {
    return `<div class="beginning-triage-controls">
      ${buttons.map((button, index) => `<button type="button" class="${index === 0 ? "primary-action" : "quiet-action"}" data-beginning-action="${escapeHtml(button.action)}"${button.target ? ` data-beginning-target="${escapeHtml(button.target)}"` : ""}${button.decision ? ` data-beginning-decision="${escapeHtml(button.decision)}"` : ""}>${escapeHtml(button.label)}</button>`).join("")}
    </div>`;
  }

  function renderBeginningTriageClaimMap(fields) {
    return `<div class="beginning-claim-map" role="table" aria-label="Claim map">
      <div role="row" class="beginning-claim-map-header">
        <span>Claim</span><span>Proof needed</span><span>Existing proof</span><span>Proof gap</span><span>Visual evidence</span><span>Forbidden unless proven</span>
      </div>
      <div role="row" class="beginning-claim-map-row">
        <textarea data-beginning-field="claimMapClaim" aria-label="Claim">${escapeHtml(fields.claimMapClaim)}</textarea>
        <textarea data-beginning-field="proofNeeded" aria-label="Proof needed">${escapeHtml(fields.proofNeeded)}</textarea>
        <textarea data-beginning-field="existingProof" aria-label="Existing proof">${escapeHtml(fields.existingProof)}</textarea>
        <textarea data-beginning-field="proofGap" aria-label="Proof gap">${escapeHtml(fields.proofGap)}</textarea>
        <textarea data-beginning-field="visualEvidence" aria-label="Visual evidence">${escapeHtml(fields.visualEvidence)}</textarea>
        <textarea data-beginning-field="forbiddenUnlessProven" aria-label="Forbidden unless proven">${escapeHtml(fields.forbiddenUnlessProven)}</textarea>
      </div>
    </div>`;
  }

  function renderBeginningTriageStage(state) {
    const fields = state.fields;
    if (state.stage === "not_started") {
      return `<div class="beginning-triage-start">
        <h2>Status: Not started</h2>
        <p>Start begins research-first idea triage and does not create a package run. It helps move from topic to three candidate angles, a two-sentence rough idea, planning title-thumbnail package, claim, proof gap, decision, and one next 30-minute action.</p>
        <button type="button" class="primary-action" data-beginning-action="start">Start</button>
      </div>`;
    }
    if (state.stage === "topic") {
      return `${beginningTriageGuidance("Topic Research", "Find a promising direction before asking Mikko to write a rough idea.", "Enter a topic, trigger the research handoff, compare three candidates, and choose or repeat.", ["describe topic area", "request research handoff", "pause", "reject"])}
      <div class="beginning-triage-intro">This is research-first idea triage. The dashboard does not perform live web research. It creates a clear research request and a paste area for user-pasted or research-handoff results.</div>
      <div class="beginning-triage-fields">
        ${renderBeginningTriageField(fields, "topicArea", "Topic area / problem space", "Example: creator workflow mistakes in AI video production")}
        ${renderBeginningTriageField(fields, "audienceGuess", "Audience guess", "Who might care before we know the angle")}
        ${renderBeginningTriageField(fields, "topicWhyNow", "Why this topic matters now")}
        ${renderBeginningTriageField(fields, "mikkoSuspects", "What Mikko already suspects")}
        ${renderBeginningTriageField(fields, "possibleProof", "What kind of proof might exist")}
      </div>
      <section class="beginning-handoff-panel">
        <h3>Research handoff request</h3>
        <p>Use this request with a separate research workflow, then paste three alternative but equally promising candidate video angles in the next step. These are user-pasted/research-handoff results, not browser-generated web research.</p>
        <textarea readonly rows="5" data-beginning-handoff-prompt>${escapeHtml(buildBeginningResearchHandoffPrompt(fields.topicArea))}</textarea>
      </section>
      ${renderBeginningTriageControls([{ action: "research", target: "candidates", label: "Research the topic" }, { action: "pause", label: "Pause" }, { action: "reject", label: "Reject" }])}`;
    }
    if (state.stage === "candidates") {
      return `${beginningTriageGuidance("3 Video Candidate Angles", "Compare three researched directions before shaping a rough idea.", "Paste or enter three candidate angles from research handoff results, then select one or research again.", ["paste candidate angles", "select this candidate", "research again", "pause", "reject"])}
      <div class="beginning-triage-intro">Candidate angles here are user-pasted/research-handoff results. The browser did not perform web search.</div>
      <div class="beginning-candidate-grid">
        ${[1, 2, 3].map((index) => renderBeginningCandidateCard(fields, index, state.selectedCandidate)).join("")}
      </div>
      ${renderBeginningTriageControls([{ action: "goto", target: "topic", label: "Research again" }, { action: "pause", label: "Pause" }, { action: "reject", label: "Reject" }])}`;
    }
    if (state.stage === "rough_idea") {
      return `${beginningTriageGuidance("Two-sentence Rough Idea", "Turn the selected research candidate into Mikko's own rough idea.", "Write the idea plainly in roughly two sentences. It does not need to be polished.", ["write rough idea", "go back to candidates", "research again", "pause", "reject"])}
      <div class="beginning-selected-summary"><strong>Selected research candidate:</strong> ${escapeHtml(fields[`candidate${state.selectedCandidate || "1"}Title`] || `Candidate ${state.selectedCandidate || "not selected"}`)}</div>
      <div class="beginning-triage-fields">
        ${renderBeginningTriageField(fields, "rawIdea", "Rough idea, approximately two sentences")}
        ${renderBeginningTriageField(fields, "researchChange", "What changed after research")}
        ${renderBeginningTriageField(fields, "chosenDirectionReason", "Why this is the chosen direction")}
      </div>
      ${renderBeginningTriageControls([{ action: "goto", target: "packaging", label: "Continue to YouTube Packaging Drafts" }, { action: "goto", target: "candidates", label: "Back to candidates" }, { action: "goto", target: "topic", label: "Research again" }, { action: "pause", label: "Pause" }, { action: "reject", label: "Reject" }])}`;
    }
    if (state.stage === "packaging") {
      return `${beginningTriageGuidance("YouTube Packaging Drafts", "Explore title-thumbnail combinations before claim/proof triage.", "Create or paste planning title-thumbnail candidates, redo until one is strong enough, then select it.", ["generate title + thumbnail package", "select this package", "generate more / redo packaging", "rework rough idea", "pause", "reject"])}
      <div class="beginning-triage-intro">This is planning packaging, not final approval. The dashboard does not create actual thumbnail images or pretend to generate with an external model.</div>
      <section class="beginning-handoff-panel">
        <h3>Packaging guidance</h3>
        ${renderCompactList(["Title should be one idea only.", "Thumbnail should be one visual idea.", "Title and thumbnail must not merely repeat each other.", "Packaging may be more exciting than the raw topic, but not more exciting than the actual video value.", "Final title, final thumbnail, and publishing approval remain blocked."], "No packaging guidance.")}
      </section>
      <div class="beginning-package-grid">
        ${[1, 2, 3].map((index) => renderBeginningPackageCard(fields, index, state.selectedPackage)).join("")}
      </div>
      ${renderBeginningTriageControls([{ action: "package", label: "Generate title + thumbnail package" }, { action: "package", label: "Generate more / redo packaging" }, { action: "goto", target: "rough_idea", label: "Rework rough idea" }, { action: "pause", label: "Pause" }, { action: "reject", label: "Reject" }])}`;
    }
    if (state.stage === "claim") {
      return `${beginningTriageGuidance("Claim Triage", "Turn the packaged rough idea into a testable useful claim.", "Write the best current claim and optional alternatives. Do not assume the first claim is correct.", ["draft a claim", "compare claim options", "mark no strong claim yet", "go back to packaging", "pause", "reject"])}
      <div class="beginning-selected-summary"><strong>Selected planning package:</strong> ${escapeHtml(fields[`package${state.selectedPackage || "1"}Title`] || `Package ${state.selectedPackage || "not selected"}`)}. Claim/proof triage is locked until a planning package is selected.</div>
      <div class="beginning-triage-format">Good format: <code>Serious creators should understand/change/avoid ___ because ___.</code></div>
      <div class="beginning-triage-fields">
        ${renderBeginningTriageField(fields, "bestClaim", "Best current claim", "Serious creators should... because...")}
        ${renderBeginningTriageField(fields, "claimOptionA", "Optional claim option A")}
        ${renderBeginningTriageField(fields, "claimOptionB", "Optional claim option B")}
        ${renderBeginningTriageField(fields, "claimOptionC", "Optional claim option C")}
      </div>
      ${renderBeginningTriageControls([{ action: "goto", target: "packaging", label: "Back to packaging" }, { action: "goto", target: "usefulness", label: "Continue to Usefulness Triage" }, { action: "rework", label: "Mark no strong claim yet / rework" }, { action: "pause", label: "Pause" }, { action: "reject", label: "Reject" }])}`;
    }
    if (state.stage === "usefulness") {
      return `${beginningTriageGuidance("Usefulness Triage", "Check whether serious creators have a real reason to care.", "Name the viewer decision, avoided mistake, and Mikko authority basis.", ["describe usefulness", "choose authority basis", "rework", "pause", "reject"])}
      <div class="beginning-authority-examples"><strong>Authority basis examples:</strong> Built system; Tested failure; Editor judgment; Systems operator view; Practical creator view.</div>
      <div class="beginning-triage-fields">
        ${renderBeginningTriageField(fields, "whyCare", "Why serious creators should care")}
        ${renderBeginningTriageField(fields, "viewerDecision", "What viewer decision this helps")}
        ${renderBeginningTriageField(fields, "creatorMistake", "What creator mistake this helps avoid")}
        ${renderBeginningTriageField(fields, "authorityBasis", "Mikko authority basis")}
      </div>
      ${renderBeginningTriageControls([{ action: "goto", target: "claim", label: "Back to claim" }, { action: "goto", target: "packaging", label: "Back to packaging" }, { action: "goto", target: "proof", label: "Continue to Proof Triage" }, { action: "rework", label: "Rework" }, { action: "pause", label: "Pause" }, { action: "reject", label: "Reject" }])}`;
    }
    if (state.stage === "proof") {
      return `${beginningTriageGuidance("Proof Triage", "Check whether the claim can be backed by real evidence.", "Map the claim to proof needed, existing proof, proof gap, and what cannot be claimed yet.", ["map proof", "inspect existing proof", "decide proof capture is needed", "rework claim", "pause", "reject"])}
      <div class="beginning-triage-format">Generated B-roll or conceptual graphics may explain the idea, but cannot carry proof unless the video is specifically about generated media.</div>
      <div class="beginning-triage-fields">
        ${renderBeginningTriageField(fields, "minimumViableProof", "Minimum viable proof")}
        ${renderBeginningTriageField(fields, "mainOverclaimRisk", "Main overclaim risk")}
      </div>
      ${renderBeginningTriageClaimMap(fields)}
      ${renderBeginningTriageControls([{ action: "goto", target: "usefulness", label: "Back to usefulness" }, { action: "goto", target: "decision", label: "Proof path exists / continue to Decision" }, { action: "pause", label: "Need to inspect existing proof" }, { action: "pause", label: "Need to capture proof" }, { action: "goto", target: "claim", label: "Rework claim" }, { action: "goto", target: "packaging", label: "Back to packaging" }, { action: "pause", label: "Pause" }, { action: "reject", label: "Reject" }])}`;
    }
    if (state.stage === "decision") {
      return `${beginningTriageGuidance("Decision", "Make an explicit decision. No ambiguous maybe.", "Choose Continue, Rework, Pause, or Reject.", ["continue", "rework", "pause", "reject"])}
      <div class="beginning-decision-grid">
        <div><strong>Continue</strong><p>Topic, rough idea, packaging, claim, and proof path are strong enough for another serious work block.</p></div>
        <div><strong>Rework</strong><p>Idea has value but angle/package/claim/proof is weak.</p></div>
        <div><strong>Pause</strong><p>Possibly useful, but not now.</p></div>
        <div><strong>Reject</strong><p>Not VIDTOOLZ-fit, not packageable, or not provable enough.</p></div>
      </div>
      ${renderBeginningTriageControls([{ action: "goto", target: "proof", label: "Back" }, { action: "decide", decision: "Continue", label: "Continue" }, { action: "decide", decision: "Rework", label: "Rework" }, { action: "decide", decision: "Pause", label: "Pause" }, { action: "decide", decision: "Reject", label: "Reject" }])}`;
    }
    return `${beginningTriageGuidance("Next 30-minute action", "Choose one small next action after the decision.", "Write exactly one useful 30-minute action and optional note.", ["record next action", "go back to decision", "pause locally"])}
    <div class="beginning-triage-fields">
      ${renderBeginningTriageField(fields, "nextThirtyMinuteAction", "Next 30-minute action", "Inspect one existing artifact.")}
      ${renderBeginningTriageField(fields, "nextActionNote", "Optional note")}
    </div>
    <div class="beginning-examples-grid">
      <div><h3>Good example actions</h3>${renderCompactList(["Inspect one existing artifact.", "Research one missing proof source.", "Record one proof clip.", "Compare two workflows.", "Write one claim map.", "Find one real creator mistake.", "Rework title-thumbnail promise.", "Reject unless concrete proof can be found."], "No examples.")}</div>
      <div><h3>Blocked examples</h3>${renderCompactList(["Write full script.", "Generate B-roll.", "Open Resolve.", "Create production plan.", "Mark production ready."], "No blocked examples.")}</div>
    </div>
    <div class="beginning-final-state">
      <strong>Current state: ${escapeHtml(state.decision === "Continue" ? "Proof Candidate" : `Idea Candidate: ${(state.decision || "paused").toLowerCase()}`)}</strong>
      <p>Selected research candidate: ${escapeHtml(fields[`candidate${state.selectedCandidate || "1"}Title`] || `Candidate ${state.selectedCandidate || "not selected"}`)}</p>
      <p>Two-sentence rough idea: ${escapeHtml(fields.rawIdea || "Not written yet.")}</p>
      <p>Selected planning title-thumbnail package: ${escapeHtml(fields[`package${state.selectedPackage || "1"}Title`] || `Package ${state.selectedPackage || "not selected"}`)}</p>
      <p>Decision: ${escapeHtml(state.decision || "Pause")}</p>
      <p>Next 30-minute action: ${escapeHtml(fields.nextThirtyMinuteAction || "Not chosen yet.")}</p>
      <p>Boundary note: "This has not created or promoted a package run."</p>
    </div>
    ${renderBeginningTriageControls([{ action: "goto", target: "decision", label: "Back" }, { action: "pause", label: "Save/pause locally" }])}`;
  }

  function renderBeginningTriageCockpit(rawState = {}) {
    const state = normalizeBeginningTriageState(rawState);
    return `<div class="beginning-triage-card" data-beginning-triage data-stage="${escapeHtml(state.stage)}">
      <div class="beginning-triage-header">
        <div>
          <p class="eyebrow">Beginning Triage</p>
          <h2>Beginning Triage</h2>
          ${renderStatusBadge(beginningTriageStatusLabel(state))}
          <p class="muted">Browser-local triage only. Does not create or promote a package run.</p>
        </div>
        <div class="beginning-header-actions">
          ${renderBeginningTopAction(state)}
          <button type="button" class="quiet-action" data-beginning-action="reset">Reset triage draft</button>
        </div>
      </div>
      ${renderBeginningTriageStepper(state)}
      ${renderBeginningTriageSummaryCards(state)}
      <section class="beginning-active-card" aria-label="Current beginning triage card">
        <div class="beginning-active-header">
          <div>
            <p class="eyebrow">Now</p>
            <h3>${escapeHtml(beginningTriageStepLabel(state.stage))}</h3>
            <p>${escapeHtml(state.stage === "not_started" ? "Start a browser-local triage draft." : "Make the current decision, then move one step forward or loop back.")}</p>
          </div>
        </div>
        ${renderBeginningTriageStage(state)}
      </section>
      ${renderBeginningUpcoming(state.stage)}
      ${renderBeginningTriageBoundary()}
      <p class="beginning-triage-storage">Stored only in <code>${BEGINNING_TRIAGE_STORAGE_KEY}</code>. Existing <code>${EPISODE_FACTORY_STORAGE_KEY}</code> data is not read or modified.</p>
    </div>`;
  }

  function renderActiveRunSummary(summary = {}) {
    const state = summary.packageRunState || {};
    return `<section class="active-run-summary">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Active Run</p>
          <h3>${escapeHtml(summary.runId || "unknown")}</h3>
        </div>
        ${renderStatusBadge(summary.overallStatus || "unknown")}
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Lifecycle stage</span><strong>${escapeHtml(summary.currentLifecycleStage || "unknown")}</strong></div>
        <div><span>Run state</span><strong>${escapeHtml(state.state || "active")}</strong><small>${state.explicit ? "explicit marker" : "inferred"}</small></div>
        <div><span>Current blocker</span><strong>${escapeHtml(summary.currentBlocker || "No blocker reported.")}</strong></div>
        <div><span>Exact next safe action</span><strong>${escapeHtml(summary.exactNextSafeAction || "Review current gate.")}</strong></div>
        <div><span>Dashboard index updated</span><strong>${summary.dashboardIndexUpdated ? "yes" : "no"}</strong><small>${escapeHtml(summary.dashboardIndexReason || "")}</small></div>
      </div>
    </section>`;
  }

  function gateClass(status = "") {
    return `gate-${String(status || "not-started").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function renderGateTimeline(gates = []) {
    const items = Array.isArray(gates) ? gates : [];
    return `<section class="gate-timeline" aria-label="Visual gate timeline">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Lifecycle Gates</p>
          <h3>Visual Gate Timeline</h3>
        </div>
      </div>
      <div class="gate-timeline-grid">
        ${items.map((gate) => `<article class="gate-card ${gateClass(gate.status)}">
          <div class="gate-card-top">
            <strong>${escapeHtml(gate.label)}</strong>
            ${renderStatusBadge(gate.status || "NOT STARTED")}
          </div>
          <p>${escapeHtml(gate.reason || "No reason reported.")}</p>
          <small>${escapeHtml(gate.artifactPath || "No artifact path.")}</small>
          <small>${escapeHtml(gate.allowedNextAction || "No action available.")}</small>
        </article>`).join("")}
      </div>
    </section>`;
  }

  function renderProductionTimelineCockpit(payload = {}) {
    const currentWork = payload.currentWork || {};
    const lifecycle = Array.isArray(payload.lifecycle) ? payload.lifecycle : [];
    const blockedActions = Array.isArray(payload.blockedActions) ? payload.blockedActions : [];
    const nextSteps = Array.isArray(currentWork.nextSteps) ? currentWork.nextSteps : [];
    const list = (items, fallback) => `<ul>${(Array.isArray(items) && items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    const activeLabel = [currentWork.activeStage, currentWork.activeTask].filter(Boolean).join(" — ") || "No active task reported.";
    const lifecycleItems = lifecycle.length ? lifecycle : [
      { label: "Current run", status: "current", detail: "No lifecycle timeline supplied.", artifactPath: "dashboard input" },
    ];

    return `<section class="production-timeline-cockpit" aria-label="Production Timeline Cockpit">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Operator Cockpit</p>
          <h3>Production Timeline Cockpit</h3>
        </div>
        ${renderStatusBadge(currentWork.status || "read-only")}
      </div>
      <div class="human-review-required">
        <strong>Evidence logging only</strong>
        <p>This cockpit is read-only orientation. It does not approve assets, mark production_ready, mark publish_ready, operate Kling, move media, or update package-run state.</p>
      </div>
      <div class="current-work-timeline">
        <h4>Detailed Current-Work Timeline</h4>
        <div class="current-work-grid">
          <article class="timeline-step gate-card gate-completed">
            <span>Latest completed</span>
            <strong>${escapeHtml(currentWork.latestCompleted || "No completed work reported.")}</strong>
          </article>
          <article class="timeline-step gate-card gate-current">
            <span>Active now</span>
            <strong>${escapeHtml(activeLabel)}</strong>
          </article>
          <article class="timeline-step gate-card gate-blocked">
            <span>Blocked by</span>
            <strong>${escapeHtml(currentWork.blocker || "No blocker reported.")}</strong>
          </article>
          <article class="timeline-step gate-card gate-next">
            <span>Immediate next action</span>
            <strong>${escapeHtml(currentWork.immediateNextAction || "Review the active stage and record evidence only.")}</strong>
          </article>
        </div>
        <div class="gps-split">
          <div><h5>Next few steps</h5>${list(nextSteps, "Record the next verified evidence item without changing approval state.")}</div>
          <div><h5>Blocked actions</h5>${list(blockedActions, "Do not approve, publish, operate tools automatically, or move media from this cockpit.")}</div>
        </div>
      </div>
      <div class="gps-timeline">
        <h4>Full Process Mini Timeline</h4>
        <div class="gate-timeline-grid">
          ${lifecycleItems.map((gate) => `<article class="gate-card ${gateClass(gate.status)} ${gate.current ? "gate-current" : ""}">
            <div class="gate-card-top"><strong>${escapeHtml(gate.label || "Unnamed stage")}</strong>${renderStatusBadge(gate.status || "future")}</div>
            <p>${escapeHtml(gate.detail || gate.reason || "No detail reported.")}</p>
            <small>${escapeHtml(gate.artifactPath || "No artifact path.")}</small>
          </article>`).join("")}
        </div>
      </div>
    </section>`;
  }

  function renderRoughCutResultCard(status = {}) {
    const result = status.roughCutResult || {};
    const candidate = status.roughCutCandidate || {};
    const warning = status.staleDerivedArtifactWarning || {};
    const staleWarning = result.derivedArtifactStale || warning.stale
      ? `<div class="stale-derived-warning">
        <strong>Derived rough-cut review artifact may be stale</strong>
        <p>${escapeHtml(warning.currentWatchNotes || `Current watch notes say ${result.currentWatchNotesMarker || result.approvalMarker || "NOT GIVEN"}`)}</p>
        <p>${escapeHtml(result.staleReason || warning.reason || "Regenerate derived rough-cut review artifacts from current watch notes.")}</p>
        <small>Writes only <code>rough-cut-review.md</code>, <code>pickup-list.md</code>, and <code>edit-fix-list.md</code>. It will not edit <code>rough-cut-watch-notes.md</code>, approve rough cut, mark second-cut ready, or update package-runs-index.json.</small>
        <button type="button" data-regenerate-rough-cut-derived>Regenerate rough-cut review artifacts</button>
      </div>`
      : "";
    return `<section class="rough-cut-result-card">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Rough Cut</p>
          <h3>Latest Review Result</h3>
        </div>
        ${renderStatusBadge(result.roughCutReviewStatus || "NOT STARTED")}
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Rough-cut status</span><strong>${escapeHtml(result.roughCutReviewStatus || "unknown")}</strong></div>
        <div><span>Second-cut ready</span><strong>${result.secondCutReady ? "yes" : "no"}</strong></div>
        <div><span>Reason</span><strong>${escapeHtml(result.reason || "No reason reported.")}</strong></div>
        <div><span>Reviewed file path</span><strong>${escapeHtml(result.reviewedFilePath || candidate.path || "No reviewed file detected.")}</strong></div>
        <div><span>Approval marker</span><strong>${escapeHtml(result.approvalMarker || "NOT GIVEN")}</strong></div>
        <div><span>Pickup-list status</span><strong>${escapeHtml(result.pickupListStatus || "missing")}</strong></div>
        <div><span>Edit-fix-list status</span><strong>${escapeHtml(result.editFixListStatus || "missing")}</strong></div>
      </div>
      ${staleWarning}
    </section>`;
  }

  function renderPickupPlanGui() {
    return `<section class="pickup-plan-panel" data-pickup-plan>
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Pickup Plan</p>
          <h3>Structured Pickup Items</h3>
        </div>
        <button type="button" data-add-pickup-item>Add item</button>
      </div>
      <p class="muted">Writes only <code>pickup-list.md</code> and <code>edit-fix-list.md</code>. It will not approve rough cut, mark second-cut ready, update package-runs-index.json, or perform Git actions.</p>
      <div class="pickup-table" data-pickup-items>
        ${renderPickupItemRow(0)}
      </div>
      <div class="rough-cut-actions">
        <button type="button" data-save-pickup-plan>Save pickup plan</button>
        <span data-pickup-plan-status class="capture-write-status">Generated suggestions stay proposed until Mikko accepts them.</span>
      </div>
    </section>`;
  }

  function renderPickupItemRow(index) {
    return `<div class="pickup-item-row" data-pickup-item>
      <label><span>Item title</span><input type="text" data-pickup-field="title" placeholder="Add closeup after intro" /></label>
      <label><span>Type</span><select data-pickup-field="type">
        <option>presenter closeup</option><option>AI B-roll</option><option>screen zoom</option><option>graphic</option><option>edit-only fix</option><option>other</option>
      </select></label>
      <label><span>Required</span><select data-pickup-field="required"><option>yes</option><option>no</option></select></label>
      <label><span>Source</span><select data-pickup-field="source"><option>existing material</option><option>new recording</option><option>AI generation</option><option>editing only</option></select></label>
      <label><span>Purpose</span><select data-pickup-field="purpose"><option>clarify message</option><option>add human presence</option><option>visual variety</option><option>proof support</option><option>pacing</option><option>other</option></select></label>
      <label><span>Status</span><select data-pickup-field="status"><option>proposed</option><option>accepted</option><option>rejected</option><option>done</option></select></label>
      <label class="pickup-notes"><span>Notes</span><textarea rows="2" data-pickup-field="notes"></textarea></label>
      <button type="button" data-remove-pickup-item ${index === 0 ? "disabled" : ""}>Remove</button>
    </div>`;
  }

  function renderMediaPanel(status = {}) {
    const rows = Array.isArray(status.mediaRows) ? status.mediaRows : [];
    return `<section class="media-panel">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Media</p>
          <h3>Active-Run Media</h3>
        </div>
      </div>
      <div class="media-row-list">
        ${rows.length ? rows.map((row) => `<div class="media-row">
          <div><strong>${escapeHtml(row.path)}</strong><small>${escapeHtml(row.type)} · ${escapeHtml(row.status)}</small></div>
          <button type="button" data-open-media="${escapeHtml(row.path)}" ${row.openAllowed ? "" : "disabled"}>Open</button>
        </div>`).join("") : `<p class="muted">No active-run media detected.</p>`}
      </div>
    </section>`;
  }

  function renderProductionGps(gps = {}) {
    const summary = gps.summary || {};
    const timeline = Array.isArray(gps.gateTimeline) ? gps.gateTimeline : [];
    const trail = gps.artifactTrail && Array.isArray(gps.artifactTrail.items) ? gps.artifactTrail.items : [];
    const humanGate = gps.humanGate || {};
    const blocked = Array.isArray(gps.blockedActions) ? gps.blockedActions : [];
    const stale = Array.isArray(gps.staleWarnings) ? gps.staleWarnings : [];
    const list = (items, fallback) => `<ul>${(Array.isArray(items) && items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    return `<section class="production-gps" aria-label="VIDTOOLZ Production GPS">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Production GPS</p>
          <h3>Gate Cockpit v2</h3>
        </div>
        ${renderStatusBadge(summary.gateStatus || "unknown")}
      </div>
      <div class="gps-current-location">
        <h4>Current location</h4>
        <p>${escapeHtml(summary.currentLocation || "Package Run -> current gate unknown")}</p>
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Run</span><strong>${escapeHtml(summary.runId || "unknown")}</strong><small>${escapeHtml(summary.title || "")}</small></div>
        <div><span>State</span><strong>${escapeHtml(summary.stateLabel || "unknown")}</strong></div>
        <div><span>Current stage</span><strong>${escapeHtml(summary.currentInferredStage || "unknown")}</strong></div>
        <div><span>Current gate</span><strong>${escapeHtml(summary.currentGate || "unknown")}</strong></div>
        <div><span>Next safe action</span><strong>${escapeHtml(summary.nextSafeAction || "Inspect current gate.")}</strong></div>
        <div><span>Human decision</span><strong>${escapeHtml(summary.requiredHumanDecision || "No decision reported.")}</strong></div>
        <div><span>Latest artifact</span><strong>${escapeHtml(summary.latestRelevantArtifact || "none")}</strong></div>
        <div><span>Missing expected artifact</span><strong>${escapeHtml(summary.missingExpectedArtifact || "none reported")}</strong></div>
        <div><span>AI may act</span><strong>${summary.aiMayAct ? "yes" : "no"}</strong></div>
        <div><span>Mikko approval required</span><strong>${summary.mikkoApprovalRequired ? "yes" : "no"}</strong></div>
      </div>
      <div class="gps-timeline">
        <h4>Gate Timeline</h4>
        <div class="gate-timeline-grid">
          ${timeline.map((gate) => `<article class="gate-card ${gateClass(gate.status)} ${gate.current ? "gate-current" : ""}">
            <div class="gate-card-top"><strong>${escapeHtml(gate.label)}</strong>${renderStatusBadge(gate.status || "not reached")}</div>
            <p>${escapeHtml(gate.reason || "No reason reported.")}</p>
            <small>${escapeHtml(gate.artifactPath || "No artifact path.")}</small>
          </article>`).join("")}
        </div>
      </div>
      <div class="human-gate-panel">
        <h4>${escapeHtml(humanGate.title || "Human Gate Required")}</h4>
        <p>${escapeHtml(humanGate.decision || "Mikko must review the current gate before approval.")}</p>
        <p><strong>Review artifact:</strong> ${escapeHtml(humanGate.reviewArtifact || "not reported")}</p>
        <p><strong>Do not approve yet:</strong> ${escapeHtml(humanGate.doNotApproveYet || "Do not infer approval from generated artifacts.")}</p>
        <div class="gps-split">
          <div><h5>AI allowed</h5>${list(humanGate.aiAllowed, "inspect files")}</div>
          <div><h5>AI blocked</h5>${list(humanGate.aiBlocked, "approve or update state")}</div>
        </div>
      </div>
      <div class="artifact-trail">
        <h4>Artifact Trail</h4>
        <table>
          <thead><tr><th>Artifact</th><th>Status</th><th>Type</th><th>Readiness</th><th>Approval marker</th><th>Regenerate</th><th>Review</th></tr></thead>
          <tbody>
            ${trail.map((item) => `<tr>
              <td>${escapeHtml(item.path || "")}</td>
              <td>${item.exists ? "exists" : "missing"}</td>
              <td>${escapeHtml(item.kind || "unclear")}</td>
              <td>${item.canChangeReadiness ? "can change readiness" : "diagnostic only"}</td>
              <td>${item.containsApprovalMarker ? "yes" : "no"}</td>
              <td>${item.safeToRegenerate ? "safe derived" : "no"}</td>
              <td>${item.requiresHumanReview ? "human review" : "not required"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="blocked-actions-panel">
        <h4>Blocked Actions</h4>
        ${list(blocked, "No blocked actions reported.")}
      </div>
      ${stale.length ? `<div class="stale-derived-warning">
        ${stale.map((item) => `<strong>${escapeHtml(item.title || "Stale artifact warning")}</strong><p>${escapeHtml(item.detail || "")}</p>`).join("")}
      </div>` : ""}
    </section>`;
  }

  function renderSecondCutNextActionPacket(packet = {}) {
    const facts = Array.isArray(packet.artifactBackedFacts) ? packet.artifactBackedFacts : [];
    const artifacts = Array.isArray(packet.supportingArtifacts) ? packet.supportingArtifacts : [];
    const groupedPaths = Array.isArray(packet.groupedMediaSourcePaths) ? packet.groupedMediaSourcePaths : [];
    const sourceFreshness = Array.isArray(packet.sourceFreshnessWarnings) ? packet.sourceFreshnessWarnings : [];
    const guidance = packet.inferredGuidance || {};
    const guidanceChecks = Array.isArray(guidance.checks) ? guidance.checks : [];
    const hasWarning = sourceFreshness.some((item) => !/no source freshness warning/i.test(String(item || "")));
    const list = (items, fallback) => `<ul>${(Array.isArray(items) && items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    const compactArtifactList = artifacts.map((item) => `${item.filename || "unknown"}: ${item.status || (item.exists ? "present" : "missing")}`);
    return `<section class="second-cut-next-action-packet" aria-label="Second-cut next action packet">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Second Cut</p>
          <h3>Next Action Packet</h3>
        </div>
        ${renderStatusBadge(packet.currentRoughCutStatus || "missing")}
      </div>
      <div class="human-review-required">
        <strong>${packet.secondCutReady ? "Human review still required" : "Not second-cut ready"}</strong>
        <p>${escapeHtml(packet.currentBlocker || "Current blocker is missing; inspect source artifacts before acting.")}</p>
      </div>
      <div class="artifact-trail">
        <h4>Artifact-backed facts</h4>
        <p class="muted">Facts below come from existing package-run artifacts or read-only discovery.</p>
        <table>
          <thead><tr><th>Fact</th><th>Value</th><th>Source</th></tr></thead>
          <tbody>
            ${facts.length ? facts.map((item) => `<tr>
              <td>${escapeHtml(item.label || "unknown")}</td>
              <td>${escapeHtml(item.value || "missing")}</td>
              <td>${escapeHtml(item.source || "missing")}</td>
            </tr>`).join("") : `<tr><td colspan="3">missing</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="gps-split">
        <div><h4>Exact pickup needs</h4>${list(packet.exactPickupNeeds, "missing")}</div>
        <div><h4>Edit fixes</h4>${list(packet.editFixes, "missing or none listed")}</div>
      </div>
      <div class="human-review-required">
        <h4>${escapeHtml(guidance.label || "Dashboard-inferred guidance")}</h4>
        <p class="muted">${escapeHtml(guidance.source || "Derived by the dashboard; not quoted from a source artifact.")}</p>
        <p><strong>Next visible action:</strong> ${escapeHtml(guidance.nextVisibleAction || "Review the active rough-cut/second-cut gate manually.")}</p>
        ${list(guidanceChecks, "Keep approval blocked until Mikko reviews the second-cut candidate.")}
      </div>
      <div class="artifact-trail">
        <h4>Grouped media/source paths</h4>
        <p class="muted">Grouped to avoid treating every discovered path as the same kind of candidate.</p>
        <table>
          <thead><tr><th>Group</th><th>Source</th><th>Paths</th></tr></thead>
          <tbody>
            ${groupedPaths.length ? groupedPaths.map((group) => `<tr>
              <td>${escapeHtml(group.label || "other referenced paths")}</td>
              <td>${escapeHtml(group.source || "missing")}</td>
              <td>${list(group.paths, "missing")}</td>
            </tr>`).join("") : `<tr><td colspan="3">missing</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="blocked-actions-panel">
        <h4>Blocked approvals / forbidden actions</h4>
        ${list(packet.mustNotApproveYet, "second-cut ready, final review, publish, upload, archive, state promotion")}
      </div>
      <div><h4>Source artifact status</h4>${list(compactArtifactList, "missing")}</div>
      <div class="${hasWarning ? "stale-derived-warning" : "human-review-required"}">
        <strong>Source freshness</strong>
        ${list(sourceFreshness, "No source freshness warning detected.")}
      </div>
      <p class="muted">Read-only packet. It does not write package-run files, update package-runs-index.json, add approval markers, move media, commit, push, or update Hermes brain.</p>
    </section>`;
  }

  function renderSecondCutInspector(inspector = {}) {
    const candidates = Array.isArray(inspector.candidates) ? inspector.candidates : [];
    const pickupMedia = Array.isArray(inspector.pickupMedia) ? inspector.pickupMedia : [];
    const requirements = inspector.pickupRequirements || {};
    const checklist = Array.isArray(inspector.placementChecklist) ? inspector.placementChecklist : [];
    const warnings = Array.isArray(inspector.warnings) ? inspector.warnings : [];
    const list = (items, fallback) => `<ul>${(Array.isArray(items) && items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    const mediaCell = (item) => [
      item.duration ? `${item.duration}s` : "duration unavailable",
      item.codec || "codec unavailable",
      item.resolution || "resolution unavailable",
      item.frameRate ? `${item.frameRate} fps` : "fps unavailable",
      item.audioStreamPresent || item.audioPresent ? "audio yes" : "audio no/unknown",
    ].join(" · ");
    return `<section class="second-cut-inspector" aria-label="Second-Cut Candidate Inspector">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Second Cut</p>
          <h3>Second-Cut Candidate Inspector</h3>
        </div>
        ${renderStatusBadge(inspector.candidateStatus || "unknown")}
      </div>
      <div class="human-review-required">
        <strong>Human review required</strong>
        <p>${escapeHtml(inspector.nextSafeAction || "Inspect the candidate and pickup placement before any approval.")}</p>
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Current gate</span><strong>${escapeHtml(inspector.currentGate || "unknown")}</strong></div>
        <div><span>Rough-cut status</span><strong>${escapeHtml(inspector.roughCutStatus || "unknown")}</strong></div>
        <div><span>Second-cut ready</span><strong>${inspector.secondCutReady ? "yes" : "no"}</strong></div>
        <div><span>Candidate status</span><strong>${escapeHtml(inspector.candidateStatus || "unknown")}</strong></div>
        <div><span>Pickup-list status</span><strong>${escapeHtml(requirements.pickupListStatus || "missing")}</strong></div>
        <div><span>Edit-fix-list status</span><strong>${escapeHtml(requirements.editFixListStatus || "missing")}</strong></div>
        <div><span>Source watch-note marker</span><strong>${escapeHtml(requirements.sourceWatchNoteMarker || "NOT GIVEN")}</strong></div>
        <div><span>Human gate required</span><strong>${inspector.humanGateRequired ? "yes" : "no"}</strong></div>
      </div>
      <div class="inspector-table-block">
        <h4>Candidate Files</h4>
        <table>
          <thead><tr><th>File</th><th>Role</th><th>Confidence</th><th>Metadata</th><th>Modified</th></tr></thead>
          <tbody>
            ${candidates.length ? candidates.map((item) => `<tr>
              <td>${escapeHtml(item.path || item.filename || "")}</td>
              <td>${escapeHtml(item.likelyRole || "unknown")}</td>
              <td>${escapeHtml(item.confidence || "low")}</td>
              <td>${escapeHtml(mediaCell(item))}</td>
              <td>${escapeHtml(item.modifiedTime || "")}</td>
            </tr>`).join("") : `<tr><td colspan="5">Second-cut candidate not found.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="inspector-table-block">
        <h4>Pickup Media</h4>
        <table>
          <thead><tr><th>File</th><th>Category</th><th>Usable status</th><th>Metadata</th><th>Review</th></tr></thead>
          <tbody>
            ${pickupMedia.length ? pickupMedia.map((item) => `<tr>
              <td>${escapeHtml(item.path || item.filename || "")}</td>
              <td>${escapeHtml(item.likelyCategory || "unknown")}</td>
              <td>${escapeHtml(item.usableStatus || "not inspected")}</td>
              <td>${escapeHtml(mediaCell(item))}</td>
              <td>${item.humanReviewRequired ? "human review required" : "not reported"}</td>
            </tr>`).join("") : `<tr><td colspan="5">No pickup media found.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="gps-split">
        <div>
          <h4>Placement Review Checklist</h4>
          ${list(checklist, "No placement checks reported.")}
        </div>
        <div>
          <h4>Blocked Actions</h4>
          ${list(inspector.blockedActions, "No blocked actions reported.")}
        </div>
      </div>
      <div class="gps-split">
        <div><h4>AI allowed</h4>${list(inspector.aiAllowed, "inspect file metadata")}</div>
        <div><h4>AI blocked</h4>${list(inspector.aiBlocked, "approve or update state")}</div>
      </div>
      ${warnings.length ? `<div class="stale-derived-warning"><h4>Warnings</h4>${list(warnings, "No warnings.")}</div>` : ""}
    </section>`;
  }

  function renderSecondCutRegistrationPreflight(preflight = {}) {
    const list = (items, fallback) => `<ul>${(Array.isArray(items) && items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    const downstream = preflight.downstreamStatus || {};
    const stepItems = preflight.humanReviewStatus === "ready_for_second_cut"
      ? [
          "Proceed to final candidate/final review preparation.",
          "Final/export/publish/archive remain separate gates.",
        ]
      : preflight.humanReviewStatus === "needs_more_pickups"
        ? ["Return to pickup/edit work."]
        : preflight.humanReviewStatus === "needs_edit_fixes"
          ? ["Return to edit fixes."]
          : preflight.registeredCandidateStatus === "registered"
            ? [
                "Inspect candidate metadata.",
                "Mikko watches full candidate.",
                "Record Second-Cut Human Review notes.",
                "Choose marker only after watching.",
              ]
            : [
                "Export second-cut candidate from Resolve.",
                "Paste/export path into Second-Cut Candidate Registration.",
                "Save/register candidate for human review.",
                "Do not approve it yet.",
              ];
    return `<section class="second-cut-preflight" aria-label="Second-Cut Registration Preflight">
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Gate Clarity</p>
          <h3>Second-Cut Registration Preflight</h3>
        </div>
        ${renderStatusBadge(preflight.humanReviewStatus || "not_started")}
      </div>
      <div class="human-review-required">
        <strong>Registration is not approval.</strong>
        <p>Human review is still required. Second-cut ready is not granted by file existence. Final/export/publish/archive remain blocked.</p>
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Expected export folder</span><strong>${escapeHtml(preflight.expectedCandidateFolder || "unknown")}</strong></div>
        <div><span>Suggested export filename</span><strong>${escapeHtml(preflight.expectedCandidateFilename || "unknown")}</strong></div>
        <div><span>Candidate path entered</span><strong>${escapeHtml(preflight.enteredCandidatePathStatus || "missing")}</strong><small>Candidate exported means a file exists.</small></div>
        <div><span>Candidate registered</span><strong>${escapeHtml(preflight.registeredCandidateStatus || "unknown")}</strong><small>Candidate registered means second-cut-candidate.md records a file for review.</small></div>
        <div><span>Registered candidate file</span><strong>${escapeHtml(preflight.candidateFileStatus || "unknown")}</strong></div>
        <div><span>Inspection</span><strong>${escapeHtml(preflight.inspectionStatus || "unknown")}</strong></div>
        <div><span>Human review</span><strong>${escapeHtml(preflight.humanReviewStatus || "not_started")}</strong><small>Human review pending means Mikko has not recorded second-cut watch notes yet.</small></div>
        <div><span>Second-cut approval</span><strong>${preflight.secondCutReady ? "READY FOR SECOND CUT" : "not granted"}</strong><small>Second-cut approval not granted means READY FOR SECOND CUT has not been explicitly selected by Mikko.</small></div>
        <div><span>Final review</span><strong>${escapeHtml(downstream.finalReview || "blocked")}</strong></div>
        <div><span>Export/delivery</span><strong>${escapeHtml(downstream.exportDelivery || "blocked")}</strong></div>
        <div><span>Publish/archive</span><strong>${escapeHtml(`${downstream.publishMetadata || "blocked"} / ${downstream.archive || "blocked"}`)}</strong><small>Downstream gates blocked means final/export/publish/archive cannot advance yet.</small></div>
      </div>
      <div class="human-review-required">
        <strong>Next safe action</strong>
        <p>${escapeHtml(preflight.nextSafeAction || "Export and register a second-cut candidate before any approval.")}</p>
      </div>
      <div class="gps-split">
        <div><h4>Step-by-step</h4>${list(stepItems, "Export and register the candidate for human review.")}</div>
        <div><h4>Warnings</h4>${list(preflight.warnings, "No preflight warnings reported.")}</div>
      </div>
      <div class="gps-split">
        <div><h4>AI allowed</h4>${list(preflight.aiAllowed, "inspect metadata")}</div>
        <div><h4>AI blocked</h4>${list(preflight.aiBlocked, "approve or update state")}</div>
      </div>
    </section>`;
  }

  function renderSecondCutCandidateRegistration(status = {}) {
    const runId = status.runId || "";
    return `<section class="second-cut-registration" data-second-cut-registration>
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Review-Needed Intake</p>
          <h3>Register Second-Cut Candidate</h3>
        </div>
        ${renderStatusBadge("human review only")}
      </div>
      <p class="muted">This records a candidate for human review. It does not approve rough cut or mark second-cut ready.</p>
      <div class="lifecycle-review-grid">
        <div><span>Run</span><strong>${escapeHtml(runId || "unknown")}</strong></div>
        <div><span>Allowed write</span><strong>second-cut-candidate.md</strong><small>No package-run state, index, review notes, or media files are updated.</small></div>
      </div>
      <label class="rough-cut-field rough-cut-field-wide">
        <span>Second-cut candidate video path</span>
        <input type="text" data-second-cut-candidate-path placeholder="/absolute/path/to/second-cut-candidate.mp4" />
      </label>
      <label class="rough-cut-field rough-cut-field-wide">
        <span>Registration notes</span>
        <textarea rows="2" data-second-cut-candidate-notes placeholder="Optional export or Resolve timeline notes."></textarea>
      </label>
      <div class="rough-cut-actions">
        <button type="button" data-preview-second-cut-candidate>Preview registration</button>
        <button type="button" data-apply-second-cut-candidate disabled>Save review-needed artifact</button>
        <span data-second-cut-candidate-status class="capture-write-status">Preview validates the file and writes nothing.</span>
      </div>
      <div class="second-cut-candidate-metadata" data-second-cut-candidate-metadata></div>
      <textarea readonly rows="14" class="capture-write-preview" data-second-cut-candidate-preview placeholder="Preview will show the exact managed Markdown section before writing."></textarea>
    </section>`;
  }

  function renderSecondCutHumanReview(status = {}) {
    const runId = status.runId || "";
    const inspector = status.secondCutInspector || {};
    const candidate = inspector.registeredCandidate || {};
    const list = (items, fallback) => `<ul>${(Array.isArray(items) && items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    return `<section class="second-cut-human-review" data-second-cut-human-review>
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Human Gate</p>
          <h3>Second-Cut Human Review</h3>
        </div>
        ${renderStatusBadge(inspector.secondCutReviewStatus || "NEEDS HUMAN REVIEW")}
      </div>
      <div class="human-review-required">
        <strong>Mikko decision required</strong>
        <p>AI can parse notes and regenerate the derived review, but cannot choose READY FOR SECOND CUT.</p>
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Run</span><strong>${escapeHtml(runId || "unknown")}</strong></div>
        <div><span>Registered candidate</span><strong>${escapeHtml(candidate.path || "No registered candidate detected.")}</strong></div>
        <div><span>Candidate status</span><strong>${escapeHtml(inspector.candidateStatus || "unknown")}</strong></div>
        <div><span>Watch notes</span><strong>${inspector.secondCutWatchNotesExists ? "exists" : "missing"}</strong></div>
        <div><span>Derived review</span><strong>${inspector.secondCutReviewExists ? "exists" : "missing"}</strong></div>
        <div><span>Second-cut ready</span><strong>${inspector.secondCutReady ? "yes" : "no"}</strong></div>
      </div>
      <p class="muted">Allowed decision markers: NEEDS MORE PICKUPS, NEEDS EDIT FIXES, READY FOR SECOND CUT.</p>
      <div class="rough-cut-form-grid">
        ${renderRoughCutTextInput("candidatePath", "Candidate file reviewed", candidate.path || "", true).replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextInput("watchDate", "Watch date", new Date().toISOString().slice(0, 10), true).replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextInput("reviewer", "Reviewer", "Mikko", true).replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextarea("openingNotes", "Opening / viewer promise notes").replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextarea("pickupPlacementNotes", "Pickup placement notes").replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextarea("screenOnlyStretchNotes", "Screen-only stretch notes").replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextarea("pacingClarityNotes", "Pacing / clarity notes").replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextarea("visualTrustDisclosureNotes", "Visual trust / disclosure notes").replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextarea("privacySensitiveNotes", "Privacy / sensitive detail notes").replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextarea("remainingPickupsNotes", "Remaining pickups needed").replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        ${renderRoughCutTextarea("remainingEditFixesNotes", "Remaining edit fixes needed").replace(/data-rough-cut-field/g, "data-second-cut-review-field")}
        <label class="rough-cut-field">
          <span>Second-cut review marker *</span>
          <select data-second-cut-review-field="decisionMarker">
            <option value="NEEDS MORE PICKUPS">NEEDS MORE PICKUPS</option>
            <option value="NEEDS EDIT FIXES">NEEDS EDIT FIXES</option>
            <option value="READY FOR SECOND CUT">READY FOR SECOND CUT</option>
          </select>
          <small>This is the human approval marker. Do not use unless Mikko has watched the full second-cut candidate.</small>
        </label>
      </div>
      <div class="rough-cut-actions">
        <button type="button" data-save-second-cut-watch-notes>Save second-cut watch notes</button>
        <button type="button" data-regenerate-second-cut-review ${inspector.secondCutWatchNotesExists ? "" : "disabled"}>Regenerate derived second-cut review</button>
        <span data-second-cut-review-status class="capture-write-status">Writes only second-cut-watch-notes.md or second-cut-review.md.</span>
      </div>
      <div class="gps-split">
        <div><h4>AI allowed</h4>${list(["prepare review checklist", "parse notes", "regenerate derived review", "inspect candidate metadata"], "inspect candidate metadata")}</div>
        <div><h4>AI blocked</h4>${list(["choose READY FOR SECOND CUT", "approve final review", "publish/upload/archive", "update state/index", "move/delete media"], "approve or update state")}</div>
      </div>
      <div class="blocked-actions-panel"><h4>Blocked Actions</h4>${list(inspector.blockedActions, "mark second-cut ready remains blocked until exact human marker and derived review.")}</div>
    </section>`;
  }

  function renderFinalCandidateReview(status = {}) {
    const runId = status.runId || "";
    const finalPanel = status.finalReviewConsole || (status.productionGps && status.productionGps.finalReviewConsole) || {};
    const list = (items, fallback) => `<ul>${(Array.isArray(items) && items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    return `<section class="final-watch-review" data-final-watch-review>
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Human Final Gate</p>
          <h3>Final Candidate / Final Watch Review</h3>
        </div>
        ${renderStatusBadge(finalPanel.finalReviewStatus || "NEEDS HUMAN REVIEW")}
      </div>
      <div class="human-review-required">
        <strong>Mikko final decision required</strong>
        <p>This records and derives final-watch review state. It does not upload, publish, archive, or update package-run state.</p>
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Run</span><strong>${escapeHtml(runId || "unknown")}</strong></div>
        <div><span>Second-cut status</span><strong>${escapeHtml(finalPanel.secondCutReviewStatus || "unknown")}</strong></div>
        <div><span>Second-cut ready</span><strong>${finalPanel.secondCutReady ? "yes" : "no"}</strong></div>
        <div><span>Final candidate</span><strong>${escapeHtml(finalPanel.finalCandidatePath || "not registered")}</strong></div>
        <div><span>Final-watch notes</span><strong>${finalPanel.finalWatchNotesExists ? "exists" : "missing"}</strong></div>
        <div><span>Derived final review</span><strong>${finalPanel.finalReviewExists ? "exists" : "missing"}</strong></div>
        <div><span>Publish ready</span><strong>${finalPanel.publishReady ? "yes" : "no"}</strong></div>
        <div><span>Human gate required</span><strong>${finalPanel.humanGateRequired === false ? "no" : "yes"}</strong></div>
      </div>
      <p class="muted">Allowed final decision markers: NEEDS FINAL FIXES, PASS. PASS is a human final approval marker.</p>
      <div class="rough-cut-form-grid">
        <label class="rough-cut-field rough-cut-field-wide">
          <span>Final candidate video path</span>
          <input type="text" data-final-candidate-path value="${escapeHtml(finalPanel.finalCandidatePath || "")}" placeholder="/absolute/path/to/final-candidate.mp4" />
          <small>Preview validates this path and writes nothing. Save writes only final-candidate.md.</small>
        </label>
        <label class="rough-cut-field rough-cut-field-wide">
          <span>Final candidate notes</span>
          <textarea rows="2" data-final-candidate-notes placeholder="Optional export or Resolve timeline notes."></textarea>
        </label>
        ${renderRoughCutTextInput("candidatePath", "Final candidate reviewed", finalPanel.finalCandidatePath || "", true).replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextInput("watchDate", "Watch date", new Date().toISOString().slice(0, 10), true).replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextInput("reviewer", "Reviewer", "Mikko", true).replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("viewerPromiseDelivery", "Viewer promise delivery").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("openingStrength", "Opening strength").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("clarity", "Clarity").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("pacing", "Pacing").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("proofEvidence", "Proof / evidence").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("audioQuality", "Audio quality").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("visualSupport", "Visual support").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("graphicsCaptions", "Graphics / captions").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("titleThumbnailFit", "Title / thumbnail fit").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("ethicalAccuracyRisks", "Ethical / accuracy risks").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("uploadMetadataReadiness", "Upload metadata readiness").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("archiveReadiness", "Archive readiness").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        ${renderRoughCutTextarea("remainingFinalFixes", "Remaining final fixes").replace(/data-rough-cut-field/g, "data-final-watch-field")}
        <label class="rough-cut-field">
          <span>Final decision marker *</span>
          <select data-final-watch-field="decisionMarker">
            <option value="NEEDS FINAL FIXES">NEEDS FINAL FIXES</option>
            <option value="PASS">PASS</option>
          </select>
          <small>This is the human final approval marker. Do not use unless Mikko has watched the full final candidate.</small>
        </label>
      </div>
      <div class="rough-cut-actions">
        <button type="button" data-preview-final-candidate>Preview final candidate</button>
        <button type="button" data-apply-final-candidate disabled>Save final-candidate.md</button>
        <button type="button" data-save-final-watch-notes>Save final-watch notes</button>
        <button type="button" data-regenerate-final-review ${finalPanel.finalWatchNotesExists ? "" : "disabled"}>Regenerate derived final review</button>
        <span data-final-watch-status class="capture-write-status">Writes only final-candidate.md, final-watch-notes.md, or final-review.md.</span>
      </div>
      <div data-final-candidate-metadata></div>
      <textarea readonly rows="10" class="capture-write-preview" data-final-candidate-preview placeholder="Final candidate preview will show the exact managed Markdown before writing."></textarea>
      ${finalPanel.warnings && finalPanel.warnings.length ? `<div class="stale-derived-warning"><h4>Warnings</h4>${list(finalPanel.warnings, "No warnings.")}</div>` : ""}
      <div class="gps-split">
        <div><h4>AI allowed</h4>${list(finalPanel.aiAllowed, "inspect file metadata")}</div>
        <div><h4>AI blocked</h4>${list(finalPanel.aiBlocked, "approve publishing or update state")}</div>
      </div>
      <div class="blocked-actions-panel"><h4>Blocked Actions</h4>${list(finalPanel.blockedActions, "publish/upload/archive remain blocked until separate gates pass.")}</div>
    </section>`;
  }

  function renderExportDeliveryReadiness(status = {}) {
    const runId = status.runId || "";
    const panel = status.exportDeliveryConsole || (status.productionGps && status.productionGps.exportDeliveryConsole) || {};
    const list = (items, fallback) => `<ul>${(Array.isArray(items) && items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    return `<section class="export-delivery-readiness" data-export-delivery-readiness>
      <div class="mikko-console-header">
        <div>
          <p class="eyebrow">Delivery Gate</p>
          <h3>Export / Delivery Readiness</h3>
        </div>
        ${renderStatusBadge(panel.exportReadinessStatus || "NEEDS EXPORT CHECK")}
      </div>
      <div class="human-review-required">
        <strong>Human delivery approval required</strong>
        <p>Master export existence and metadata do not approve upload. Delivery PASS must be explicit from Mikko.</p>
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Run</span><strong>${escapeHtml(runId || "unknown")}</strong></div>
        <div><span>Final review</span><strong>${escapeHtml(panel.finalReviewStatus || "unknown")}</strong></div>
        <div><span>Publish ready from final review</span><strong>${panel.publishReady ? "yes" : "no"}</strong></div>
        <div><span>Master file</span><strong>${escapeHtml(panel.masterFilePath || "not registered")}</strong></div>
        <div><span>Export checklist</span><strong>${panel.exportChecklistExists ? "exists" : "missing"}</strong></div>
        <div><span>Loudness check</span><strong>${panel.loudnessCheckExists ? "exists" : "missing"}</strong></div>
        <div><span>Caption check</span><strong>${panel.captionCheckExists ? "exists" : "missing"}</strong></div>
        <div><span>Ready to upload</span><strong>${panel.readyToUpload ? "yes" : "no"}</strong></div>
      </div>
      <div class="rough-cut-form-grid">
        <label class="rough-cut-field rough-cut-field-wide">
          <span>Master/export file path</span>
          <input type="text" data-export-master-path value="${escapeHtml(panel.masterFilePath || "")}" placeholder="/absolute/path/to/final-master.mp4" />
          <small>Preview validates this path and writes nothing. Save writes only master-file-manifest.md.</small>
        </label>
        <label class="rough-cut-field">
          <span>Target platform</span>
          <input type="text" data-delivery-field="intendedPlatform" value="YouTube" />
        </label>
        <label class="rough-cut-field">
          <span>Export preset/profile</span>
          <input type="text" data-export-master-preset data-delivery-field="exportPreset" placeholder="Resolve export preset/profile" />
        </label>
        ${renderRoughCutTextarea("containerCodecConfirmation", "Container / codec confirmation").replace(/data-rough-cut-field/g, "data-delivery-field")}
        ${renderRoughCutTextarea("resolutionConfirmation", "Resolution confirmation").replace(/data-rough-cut-field/g, "data-delivery-field")}
        ${renderRoughCutTextarea("frameRateConfirmation", "Frame rate confirmation").replace(/data-rough-cut-field/g, "data-delivery-field")}
        ${renderRoughCutTextarea("audioSettingsConfirmation", "Audio settings confirmation").replace(/data-rough-cut-field/g, "data-delivery-field")}
        ${renderRoughCutTextarea("loudnessStatus", "Loudness status").replace(/data-rough-cut-field/g, "data-delivery-field")}
        ${renderRoughCutTextarea("captionsStatus", "Captions / subtitles status").replace(/data-rough-cut-field/g, "data-delivery-field")}
        ${renderRoughCutTextarea("qcNotes", "QC notes").replace(/data-rough-cut-field/g, "data-delivery-field")}
        <label class="rough-cut-field">
          <span>Delivery decision marker *</span>
          <select data-delivery-field="decisionMarker">
            <option value="NEEDS EXPORT CHECK">NEEDS EXPORT CHECK</option>
            <option value="PASS">PASS</option>
          </select>
          <small>This is the human delivery approval marker. Do not use unless Mikko has checked the exported master file.</small>
        </label>
      </div>
      <div class="rough-cut-actions">
        <button type="button" data-preview-export-master>Preview master registration</button>
        <button type="button" data-apply-export-master disabled>Save master-file-manifest.md</button>
        <button type="button" data-save-delivery-readiness>Save delivery checks</button>
        <button type="button" data-regenerate-export-checklist ${panel.deliveryReadinessExists ? "" : "disabled"}>Regenerate export-checklist.md</button>
        <span data-export-delivery-status class="capture-write-status">Writes only export/delivery artifacts. It does not upload or publish.</span>
      </div>
      <div data-export-master-metadata></div>
      <textarea readonly rows="10" class="capture-write-preview" data-export-master-preview placeholder="Master manifest preview will show the exact managed Markdown before writing."></textarea>
      ${panel.warnings && panel.warnings.length ? `<div class="stale-derived-warning"><h4>Warnings</h4>${list(panel.warnings, "No warnings.")}</div>` : ""}
      <div class="gps-split">
        <div><h4>AI allowed</h4>${list(panel.aiAllowed, "inspect file metadata")}</div>
        <div><h4>AI blocked</h4>${list(panel.aiBlocked, "upload, publish, schedule, archive, or update state")}</div>
      </div>
      <div class="blocked-actions-panel"><h4>Blocked Actions</h4>${list(panel.blockedActions, "upload/publish/archive remain blocked until separate gates pass.")}</div>
    </section>`;
  }

  function renderMikkoInputConsole(status = {}, result = null) {
    const runId = status.runId || "";
    const candidate = status.roughCutCandidate || {};
    const defaults = roughCutInputDefaults();
    const reviewedPath = candidate.path || "";
    return `<div class="mikko-console-run" data-rough-cut-console data-run-id="${escapeHtml(runId)}">
      ${status.productionTimelineCockpit ? renderProductionTimelineCockpit(status.productionTimelineCockpit) : ""}
      ${status.productionGps ? renderProductionGps(status.productionGps) : ""}
      ${status.secondCutNextActionPacket ? renderSecondCutNextActionPacket(status.secondCutNextActionPacket) : ""}
      ${status.secondCutInspector ? renderSecondCutInspector(status.secondCutInspector) : ""}
      ${status.secondCutCandidatePreflight ? renderSecondCutRegistrationPreflight(status.secondCutCandidatePreflight) : ""}
      ${renderSecondCutCandidateRegistration(status)}
      ${renderSecondCutHumanReview(status)}
      ${renderFinalCandidateReview(status)}
      ${renderExportDeliveryReadiness(status)}
      ${renderActiveRunSummary(status.activeRunSummary || {
        runId,
        currentLifecycleStage: status.currentInferredStage,
        overallStatus: status.overallStatus,
        currentBlocker: status.firstBlockerReason,
        exactNextSafeAction: status.exactNextSafeAction || status.nextRecommendedCommand,
        packageRunState: {},
        dashboardIndexUpdated: false,
      })}
      ${renderGateTimeline(status.gateTimeline || [])}
      ${renderRoughCutResultCard(status)}
      ${renderPickupPlanGui()}
      ${renderMediaPanel(status)}
      <div class="lifecycle-review-grid">
        <div><span>Active package run</span><strong>${escapeHtml(runId || "not found")}</strong></div>
        <div><span>Current lifecycle stage</span><strong>${escapeHtml(status.currentInferredStage || status.lifecycleStatus || "unknown")}</strong></div>
        <div><span>Overall status</span><strong>${escapeHtml(status.overallStatus || "unknown")}</strong></div>
        <div><span>Current blocker</span><strong>${escapeHtml(status.firstBlockerReason || "No blocker reported.")}</strong></div>
        <div><span>Rough-cut candidate</span><strong>${escapeHtml(reviewedPath || "No candidate detected yet.")}</strong><small>${escapeHtml(candidate.source || "")}</small></div>
        <div><span>Next command</span><code>${escapeHtml(status.nextRecommendedCommand || "No command reported.")}</code></div>
      </div>
      <div class="rough-cut-actions">
        <button type="button" data-open-rough-cut ${reviewedPath ? "" : "disabled"}>Open in VLC</button>
        <span data-rough-cut-status class="capture-write-status">Save writes only rough-cut-watch-notes.md.</span>
      </div>
      <form class="rough-cut-form">
        <div class="rough-cut-form-grid">
          ${renderRoughCutTextInput("reviewedFilePath", "Reviewed file path", reviewedPath, true)}
          ${renderRoughCutTextInput("reviewedFileType", "Reviewed file type", defaults.reviewedFileType, true)}
          ${renderRoughCutTextInput("watchDate", "Watch date", defaults.watchDate, true)}
          ${renderRoughCutTextInput("reviewer", "Reviewer", defaults.reviewer, true)}
          ${renderRoughCutTextarea("first30SecondsNotes", "First 30 seconds notes", true)}
          ${renderRoughCutTextarea("clarityNotes", "Clarity notes", true)}
          ${renderRoughCutTextarea("pacingNotes", "Pacing notes", true)}
          ${renderRoughCutTextarea("proofEvidenceNotes", "Proof/evidence notes", true)}
          ${renderRoughCutTextarea("missingVisuals", "Missing visuals")}
          ${renderRoughCutTextarea("audioProblems", "Audio problems")}
          ${renderRoughCutTextarea("graphicsProblems", "Graphics problems")}
          ${renderRoughCutTextarea("confusingSections", "Confusing sections")}
          ${renderRoughCutTextarea("sectionsToCutTighten", "Sections to cut/tighten")}
          ${renderRoughCutTextarea("pickupsNeeded", "Pickups needed")}
          ${renderRoughCutTextarea("editFixesNeeded", "Edit fixes needed")}
          ${renderRoughCutTextarea("secondCutRecommendation", "Second-cut recommendation", true)}
          ${renderRoughCutApprovalSelect()}
        </div>
        <div class="rough-cut-actions">
          <button type="button" data-save-rough-cut-notes>Save watch notes</button>
          <button type="button" data-run-rough-cut-review disabled>Run rough-cut review</button>
        </div>
      </form>
      <p class="muted">PASS is written only when selected. Other marker values keep rough cut unapproved.</p>
      <div data-rough-cut-result>${renderRoughCutResult(result)}</div>
    </div>`;
  }

  function renderLifecycleReviewPanel(run) {
    const gate = run.lifecycleGate || normalizeLifecycleGate({});
    const effective = gate.effectiveReadiness || normalizeEffectiveReadiness({});
    const stage4Status = gate.hasShotEditPlanReview ? gate.shotEditPlanReviewStatus || "not evaluated" : "missing review";
    const approvalLabel = gate.shotEditPlanAccepted ? "yes" : "no";
    const nextSafeAction =
      gate.shotEditPlanNextSafeAction ||
      (gate.shotEditPlanAccepted ? "Continue to the next proven lifecycle gate." : "Human approval required before capture.");
    const firstBlocker = run.firstBlockerReason || "No blocker reported by the index.";
    const missing = run.missingExpectedArtifacts.length ? run.missingExpectedArtifacts : run.nextExpectedFile ? [run.nextExpectedFile] : [];
    return `<section class="lifecycle-review-panel ${lifecycleReviewClass(run)}" aria-label="Lifecycle review for ${escapeHtml(run.runId)}">
      <div class="lifecycle-review-header">
        <div>
          <h3>Lifecycle Review</h3>
          <p>Current inferred stage: <strong>${escapeHtml(run.status)}</strong></p>
        </div>
        ${renderStatusBadge(run.overallStatus || "NEEDS WORK")}
      </div>
      <div class="lifecycle-review-grid">
        <div><span>Workflow bucket</span><strong>${escapeHtml(run.workflowBucket)}</strong></div>
        <div><span>Stage 4 review status</span><strong>${renderStatusBadge(stage4Status)}</strong></div>
        <div><span>Stage 4 accepted</span><strong>${escapeHtml(approvalLabel)}</strong>${!gate.shotEditPlanAccepted ? `<small>${renderStatusBadge("Human approval required")}</small>` : ""}</div>
        <div><span>Stage 4 next safe action</span><strong>${escapeHtml(nextSafeAction)}</strong></div>
      </div>
      <div class="lifecycle-subsection">
        <h4>Effective readiness</h4>
        <div class="lifecycle-review-grid">
          <div><span>Capture approved</span><strong>${effective.captureApproved ? "yes" : "no"}</strong></div>
          <div><span>Ready for rough cut</span><strong>${effective.readyForRoughCut ? "yes" : "no"}</strong></div>
          <div><span>Publish ready</span><strong>${effective.publishReady ? "yes" : "no"}</strong></div>
          <div><span>Upload ready</span><strong>${effective.readyToUpload ? "yes" : "no"}</strong></div>
          <div><span>Schedule ready</span><strong>${effective.readyToSchedule ? "yes" : "no"}</strong></div>
        </div>
        ${
          effective.downstreamReadinessOverridden
            ? `<p>${renderStatusBadge("Raw downstream markers overridden")} ${escapeHtml(effective.overrideReason)}</p>`
            : ""
        }
      </div>
      <div class="lifecycle-subsection">
        <h4>First blocker</h4>
        <p>${escapeHtml(firstBlocker)}</p>
      </div>
      <div class="lifecycle-subsection">
        <h4>Next recommended command</h4>
        <code>${escapeHtml(run.nextRecommendedCommand || "Manual review or file edit needed.")}</code>
      </div>
      ${renderCaptureEvidencePanel(run)}
      <div class="lifecycle-review-columns">
        <div class="lifecycle-subsection">
          <h4>Conservative blocked actions</h4>
          ${renderCompactList(run.conservativeBlockedActions, "No conservative blocked actions reported.", "lifecycle-action-list")}
        </div>
        <div class="lifecycle-subsection">
          <h4>Missing expected artifacts</h4>
          ${renderCompactList(missing, "No missing expected artifacts reported.", "lifecycle-missing-list")}
        </div>
      </div>
      ${renderDetectedButNotTrusted(run)}
    </section>`;
  }

  function renderRunCard(run) {
    const title = run.title || run.runId;
    const next = run.nextExpectedFile ? `<p class="muted">Next: ${escapeHtml(run.nextExpectedFile)}</p>` : `<p class="muted">Next: shoot the video.</p>`;
    const updated = run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "No tracked files yet";
    const runHref = run.path ? `${run.path}/` : "#";
    const cardClass =
      run.workflowBucket === "Needs QA repair" || run.workflowBucket === "Needs proof capture"
        ? "package-run-card qa-blocked"
        : "package-run-card";
    return `
      <article class="${cardClass}">
        <div class="package-card-top">
          <span class="package-number">${escapeHtml(run.runId)}</span>
          <span class="run-status-pill ${statusClass(run.status)}">${escapeHtml(run.status)}</span>
          <span class="run-status-pill ${statusClass(run.workflowBucket)}">${escapeHtml(run.workflowBucket)}</span>
          ${
            run.packageRunState && run.packageRunState.explicit
              ? `<span class="run-status-pill ${statusClass(`state-${run.packageRunState.state}`)}">State: ${escapeHtml(run.packageRunState.state)}</span>`
              : ""
          }
        </div>
        <h2>${escapeHtml(title)}</h2>
        ${next}
        ${renderCreatorQaStatus(run)}
        ${renderEvidenceGate(run)}
        ${renderLifecycleReviewPanel(run)}
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

  function renderCompactPipelineStrip(run) {
    const rank = statusRank(run.status);
    const total = STATUS_ORDER.length;
    const pct = rank >= 0 ? Math.round(((rank + 1) / total) * 100) : 0;
    const bucket = run.workflowBucket || "Unknown";
    const blocker = run.firstBlockerReason
      ? `<span class="compact-strip-blocker" title="${escapeHtml(run.firstBlockerReason)}">${escapeHtml(run.firstBlockerReason)}</span>`
      : "";
    return `<div class="compact-pipeline-strip">
      <div class="compact-pipeline-bar"><div class="compact-pipeline-fill" style="width:${pct}%"></div></div>
      <span class="compact-pipeline-bucket">${escapeHtml(bucket)}</span>
      ${blocker}
    </div>`;
  }


  function assetPresent(files = {}, keys = []) {
    return keys.some((key) => Boolean(files[key]));
  }

  function countPresent(files = {}, keys = []) {
    return keys.reduce((count, key) => count + (files[key] ? 1 : 0), 0);
  }

  const VIDEO_ASSET_LANES = [
    {
      key: "script",
      label: "Script",
      keys: ["script_structure", "script_draft", "final_script", "script"],
      href: "final-script.md",
      missing: "No script artifact detected",
    },
    {
      key: "titles",
      label: "Title candidates",
      keys: ["thumbnail_title_check", "title_check", "selected_package_md", "selected_package_json"],
      href: "thumbnail-title-check.md",
      missing: "No title candidate artifact detected",
    },
    {
      key: "descriptions",
      label: "Description candidates",
      keys: ["publish_pack", "description_check", "publish_metadata_review"],
      href: "publish-pack.md",
      missing: "No description/metadata artifact detected",
    },
    {
      key: "thumbnails",
      label: "Thumbnail candidates",
      keys: ["thumbnail_mockup", "thumbnail_title_check", "thumbnail_check"],
      href: "thumbnail-mockup.svg",
      missing: "No thumbnail candidate artifact detected",
    },
    {
      key: "imagePrompts",
      label: "Image prompts",
      keys: ["image_prompts", "graphics_list", "b_roll_list"],
      href: "image-prompts.json",
      missing: "No image-prompt manifest detected",
    },
    {
      key: "generatedImages",
      label: "Generated images",
      keys: ["thumbnail_mockup", "selected_images"],
      href: "selected-images.json",
      missing: "No generated-image manifest detected",
    },
    {
      key: "selectedImages",
      label: "Selected images",
      keys: ["selected_images"],
      href: "selected-images.json",
      missing: "No selected-images.json detected",
    },
    {
      key: "videoPrompts",
      label: "Video prompts",
      keys: ["video_prompts", "visual_prompt_set"],
      href: "video-prompts.json",
      missing: "No video-prompt manifest detected",
    },
    {
      key: "generatedVideo",
      label: "Generated video clips",
      keys: ["gate_5_assembly_manifest"],
      href: "gate-5-assembly-manifest.md",
      missing: "No generated-video manifest detected",
    },
    {
      key: "hyperframes",
      label: "Hyperframes scenes/renders",
      keys: ["hyperframes"],
      href: "hyperframes.json",
      missing: "Lane visible; no Hyperframes manifest detected",
      lane: "Hyperframes",
    },
    {
      key: "remotion",
      label: "Remotion compositions/renders",
      keys: ["remotion_renders"],
      href: "remotion-renders.json",
      missing: "Lane visible; no Remotion manifest detected",
      lane: "Remotion",
    },
    {
      key: "resolve",
      label: "Resolve handoff",
      keys: ["resolve_edit_checklist", "gate_5_assembly_manifest"],
      href: "resolve-edit-checklist.md",
      missing: "No Resolve handoff artifact detected",
    },
    {
      key: "publish",
      label: "Publish state",
      keys: ["final_review", "export_checklist", "publish_metadata_review", "publish_pack"],
      href: "publish-pack.md",
      missing: "Publish gate not reached",
    },
    {
      key: "friction",
      label: "Friction log",
      keys: ["friction_log"],
      href: "FRICTION-LOG.json",
      missing: "No friction log detected",
    },
  ];

  function buildProductionAssetLedger(run = {}) {
    const files = run.files || {};
    return VIDEO_ASSET_LANES.map((lane) => {
      const count = countPresent(files, lane.keys);
      const available = count > 0;
      return {
        key: lane.key,
        label: lane.label,
        count,
        status: available ? "available" : "missing",
        href: run.path ? `${run.path}/${lane.href}` : "#",
        runId: run.runId || "",
        assetPath: lane.href,
        detail: available ? `${count} tracked artifact${count === 1 ? "" : "s"}` : lane.missing,
        lane: lane.lane || "",
      };
    });
  }

  function renderAssetLedger(ledger = [], options = {}) {
    const compact = Boolean(options.compact);
    const items = (Array.isArray(ledger) ? ledger : []).map((item) => {
      const statusClassName = item.status === "available" ? "asset-lane-available" : "asset-lane-missing";
      const href = item.status === "available" ? item.href : "#";
      const openAttrs = item.status === "available" ? ` data-open-package-folder="${escapeHtml(item.runId || "")}" data-open-asset-path="${escapeHtml(item.assetPath || "")}"` : "";
      const linkAttrs = item.status === "available" ? `href="${escapeHtml(href)}"` : `href="#" aria-disabled="true"`;
      return `<a class="asset-lane ${statusClassName}" ${linkAttrs}${openAttrs} data-asset-lane="${escapeHtml(item.key)}" title="Open containing folder in the OS file manager">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.status === "available" ? String(item.count) : "missing")}</strong>
        ${compact ? "" : `<small>${escapeHtml(item.detail)}</small>`}
      </a>`;
    }).join("");
    return `<div class="asset-ledger ${compact ? "asset-ledger-compact" : ""}">${items}</div>`;
  }

  function thumbnailCandidateSources(run = {}) {
    const base = run.path || "";
    if (!base) return [];
    return ["thumbnail-mockup.svg", "thumbnail-mockup.png", "thumbnail-mockup.jpg", "thumbnail-mockup.jpeg"].map((name) => `${base}/${name}`);
  }

  function renderVideoThumbnail(run = {}) {
    const sources = thumbnailCandidateSources(run);
    const fallback = `<div class="video-thumb-fallback"><span>No thumbnail preview</span></div>`;
    if (!sources.length) return `<div class="video-thumb">${fallback}</div>`;
    return `<div class="video-thumb">
      <img src="${escapeHtml(sources[0])}" alt="${escapeHtml(run.title || run.runId || "Video thumbnail")}" loading="lazy" onerror="this.hidden=true; this.nextElementSibling.hidden=false" />
      <div class="video-thumb-fallback" hidden><span>No thumbnail preview</span></div>
    </div>`;
  }

  function runConceptDescription(run = {}) {
    if (run.firstBlockerReason) return run.firstBlockerReason;
    if (run.nextRecommendedCommand) return run.nextRecommendedCommand;
    if (run.nextExpectedFile) return `Next expected artifact: ${run.nextExpectedFile}.`;
    return "No concept summary is available in the package-run index yet.";
  }

  function hyperframesAvailabilityLabel(availability = null) {
    if (!availability) return { status: "unknown", detail: "Availability probe has not loaded yet." };
    if (availability.available) {
      return {
        status: "installed",
        detail: availability.version ? `Available via ${availability.command} (${availability.version})` : `Available via ${availability.command}`,
      };
    }
    return {
      status: "not installed",
      detail: availability.error || `Unavailable via ${availability.command || "npx --no-install hyperframes --help"}`,
    };
  }

  function hyperframesLaneMessage(status) {
    const messages = {
      no_directory: "No hyperframes directory exists for this package-run.",
      no_compositions: "hyperframes/ exists, but no HTML compositions were found.",
      not_rendered: "Compositions exist, but no MP4 renders are complete.",
      rendering: "A render is marked in progress.",
      failed: "At least one HyperFrames render failed.",
      rendered: "At least one HyperFrames composition has been rendered.",
      unknown: "HyperFrames lane status has not loaded yet.",
    };
    return messages[status] || messages.unknown;
  }

  function renderHyperframesLane(run = {}, fallback = {}) {
    const data = run.hyperframes || null;
    const availability = hyperframesAvailabilityLabel(data ? data.availability : null);
    const lane = data && data.lane ? data.lane : { status: "unknown", compositionsCount: fallback.count || 0 };
    const compositions = data && data.manifest && Array.isArray(data.manifest.compositions) ? data.manifest.compositions : [];
    const compositionRows = compositions.length
      ? compositions.map((item) => {
          const output = item.status === "rendered" && item.rendered_mp4
            ? `<small>Output: <code>${escapeHtml(item.rendered_mp4)}</code></small>`
            : "";
          const renderedAt = item.last_rendered_at ? `<small>Rendered: ${escapeHtml(item.last_rendered_at)}</small>` : "";
          const error = item.last_error ? `<small class="motion-lane-error">Error: ${escapeHtml(item.last_error)}</small>` : "";
          const actionLabel = item.status === "rendered" ? "Render again" : item.status === "failed" ? "Retry render" : "Render MP4";
          return `<li class="hyperframes-composition hyperframes-status-${escapeHtml(item.status)}">
            <div>
              <strong>${escapeHtml(item.title || item.id)}</strong>
              <span>${escapeHtml(item.status || "not_rendered")}</span>
              ${output}
              ${renderedAt}
              ${error}
            </div>
            <div class="hyperframes-actions">
              <a href="${escapeHtml(item.preview_url)}" target="_blank" rel="noopener">Preview</a>
              <button type="button" data-hyperframes-render="${escapeHtml(item.id)}" data-run-id="${escapeHtml(run.runId || "")}">${escapeHtml(actionLabel)}</button>
            </div>
          </li>`;
        }).join("")
      : `<li class="hyperframes-composition-empty">${escapeHtml(hyperframesLaneMessage(lane.status))}</li>`;
    return `<div class="motion-lane-card hyperframes-lane-card" data-hyperframes-run="${escapeHtml(run.runId || "")}">
      <p class="eyebrow">HyperFrames</p>
      <h3>Agent-native motion graphics</h3>
      <p>${escapeHtml(hyperframesLaneMessage(lane.status))}</p>
      <div class="hyperframes-summary">
        <span>Availability: <strong>${escapeHtml(availability.status)}</strong></span>
        <span>Compositions: <strong>${escapeHtml(String(lane.compositionsCount || compositions.length || 0))}</strong></span>
      </div>
      <small>${escapeHtml(availability.detail)}</small>
      ${data && data.lane && data.lane.manifestError ? `<small class="motion-lane-error">Manifest error: ${escapeHtml(data.lane.manifestError)}</small>` : ""}
      <ul class="hyperframes-composition-list">${compositionRows}</ul>
    </div>`;
  }

  function renderVideoProjectRoom(run = null) {
    if (!run) {
      return `<div class="video-room-empty"><p class="eyebrow">Video Room</p><h2>Select a video project</h2><p class="muted">No package-run is focused.</p></div>`;
    }
    const ledger = buildProductionAssetLedger(run);
    const hyperframes = ledger.find((item) => item.key === "hyperframes") || {};
    const remotion = ledger.find((item) => item.key === "remotion") || {};
    
    // Build enhanced next action content
    const status = run.status || "Unknown";
    const nextCmd = run.nextRecommendedCommand || "";
    const missing = run.missingExpectedArtifacts || [];
    const blocked = run.conservativeBlockedActions || [];
    
    let actionTitle = "Next Step";
    let actionDescription = "Review current status and artifacts.";
    let command = nextCmd;
    
    // Determine action type and human-readable description
    if (run.creatorQaStatus && run.creatorQaStatus !== "PASS" && run.creatorQaStatus !== "not run") {
      actionTitle = "Creator QA Required";
      actionDescription = "Run the creator QA check to validate your script and package before proceeding to production.";
      command = command || `node scripts/package-run-creator-qa.js package-runs/${run.runId}`;
    } else if (status.includes("Research")) {
      actionTitle = "Research Phase";
      actionDescription = "Build the research foundation for this video topic.";
      command = command || `node scripts/package-run-research-pack.js package-runs/${run.runId}`;
    } else if (status.includes("Outline")) {
      actionTitle = "Create Outline";
      actionDescription = "Generate the video structure and flow.";
      command = command || `node scripts/package-engine-new-outline.js package-runs/${run.runId}`;
    } else if (status.includes("Script")) {
      actionTitle = "Write Script";
      actionDescription = "Create the full video script.";
      command = command || `node scripts/package-run-script.js package-runs/${run.runId}`;
    } else if (status === "Ready to shoot" || status.includes("Production")) {
      actionTitle = "Production Check";
      actionDescription = "Verify all production requirements are met before capturing video.";
      command = command || `node scripts/package-run-creator-qa.js package-runs/${run.runId}`;
    } else if (command) {
      actionTitle = "Next Action";
      actionDescription = "Execute the following command to move this project forward.";
    }
    
    return `<div class="video-room">
      <div class="video-room-header">
        ${renderVideoThumbnail(run)}
        <div>
          <p class="eyebrow">Individual Video View · Video Production Room</p>
          <h2>${escapeHtml(run.title || run.runId)}</h2>
          <p>${escapeHtml(runConceptDescription(run))}</p>
          <div class="video-room-badges">
            <span class="run-status-pill ${statusClass(run.status)}">${escapeHtml(run.status || "unknown")}</span>
            <span class="run-status-pill ${statusClass(run.workflowBucket)}">${escapeHtml(run.workflowBucket || "unknown")}</span>
            <span class="run-status-pill ${run.overallStatus === "BLOCKED" ? "run-status-needs-qa-repair" : ""}">${escapeHtml(run.overallStatus || "unknown")}</span>
          </div>
        </div>
      </div>
      
      ${command ? `
      <div class="video-room-next-enhanced">
        <h3>${escapeHtml(actionTitle)}</h3>
        <div class="next-action-description">${escapeHtml(actionDescription)}</div>
        <div class="next-action-command">
          <code>${escapeHtml(command)}</code>
          <button type="button" class="copy-btn" data-copy-command="${escapeHtml(command)}" onclick="navigator.clipboard.writeText(this.dataset.copyCommand); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy Command', 2000)">Copy Command</button>
        </div>
        ${missing.length > 0 ? `
        <div class="missing-artifacts">
          <strong>Missing Before This Step</strong>
          <ul>
            ${missing.slice(0, 5).map(item => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
        ` : ""}
      </div>
      ` : `
      <div class="video-room-manual-note">
        <strong>Manual Review Required</strong>
        <p>This project needs human judgment to determine the next step. Review the current status, artifacts, and blockers below to decide how to proceed.</p>
      </div>
      `}
      
      <section class="video-room-section">
        <h3>Production Assets</h3>
        ${renderAssetLedger(ledger)}
      </section>
      <section class="video-room-motion-lanes">
        <p class="video-room-lane-note muted">Motion lanes — read-only orientation. Render jobs are visible here; production approval and media moves happen outside this view.</p>
        ${renderHyperframesLane(run, hyperframes)}
        <div class="motion-lane-card">
          <p class="eyebrow">Remotion</p>
          <h3>Reusable React-template video lane</h3>
          <p>${escapeHtml(remotion.detail || "Lane visible; no Remotion manifest detected")}</p>
          <ul>
            <li>Use for branded intros/outros, recurring Shorts templates, title cards, caption packages, and promo renders.</li>
            <li>Composition ID, template name, props source, preview, render path, provenance, and approval should become visible here as manifests are added.</li>
          </ul>
        </div>
      </section>
    </div>`;
  }

  function buildSystemAvailability(index = {}, config = {}) {
    const normalized = normalizeIndex(index);
    const hasRuns = normalized.runs.length > 0;
    const active = normalized.runs.find((run) => run.packageRunState && run.packageRunState.state === "active") || normalized.runs[0];
    const hyperframesAvailability = hyperframesAvailabilityLabel(config.hyperframesAvailability || (config.hyperframes && config.hyperframes.availability) || null);
    return [
      { name: "Cockpit server", status: "online", detail: "Dashboard loaded in browser" },
      { name: "Package path", status: hasRuns ? "available" : "missing", detail: hasRuns ? `${normalized.runs.length} indexed video project${normalized.runs.length === 1 ? "" : "s"}` : "package-runs-index.json has no runs" },
      { name: "Active video project", status: active ? "available" : "missing", detail: active ? active.runId : "No focused run" },
      { name: "Local FLUX ComfyUI", status: "probe via job monitor", detail: "Active FLUX jobs are shown in Render Jobs" },
      { name: "PRESTO / Wan2.2", status: "probe via job monitor", detail: "Active Wan2.2 jobs are shown in Render Jobs" },
      { name: "HyperFrames", status: hyperframesAvailability.status, detail: hyperframesAvailability.detail },
      { name: "Remotion", status: "lane visible", detail: "Template/render automation not enabled in this slice" },
      { name: "Resolve handoff", status: active && assetPresent(active.files, ["resolve_edit_checklist", "gate_5_assembly_manifest"]) ? "available" : "missing", detail: active ? "Derived from focused run artifacts" : "No run selected" },
      { name: "Package validation", status: "available", detail: "Use ./scripts/verify.sh before treating changes as complete" },
    ];
  }

  function renderSystemAvailabilityPanel(index = {}, config = {}) {
    const rows = buildSystemAvailability(index, config).map((item) => `<div class="system-status-row system-status-${escapeHtml(item.status.replace(/[^a-z0-9]+/gi, "-").toLowerCase())}">
      <span>${escapeHtml(item.name)}</span>
      <strong>${escapeHtml(item.status)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </div>`).join("");
    return `<div class="system-availability-card">
      <div>
        <p class="eyebrow">System Status</p>
        <h2>Production System Availability</h2>
        <p class="muted">Read-only availability map. Job details stay in the Render Jobs monitor.</p>
      </div>
      <div class="system-status-grid">${rows}</div>
    </div>`;
  }

  function capabilityInventoryItems() {
    return [
      { name: "Episode Factory Cockpit", category: "cockpit", location: "vidnux", status: "used", integration: "first-class", use: "Package-run visibility, gates, next action" },
      { name: "FLUX ComfyUI", category: "image generation", location: "vidnux", status: "used", integration: "job monitor", use: "Image generation from package prompts" },
      { name: "PRESTO Wan2.2", category: "video generation", location: "PRESTO", status: "used", integration: "job monitor", use: "Image-to-video generation" },
      { name: "Hyperframes", category: "motion graphics", location: "local/browser", status: "visible stub", integration: "planned first-class lane", use: "HTML/CSS/JS explainer scenes and motion cards" },
      { name: "Remotion", category: "template video", location: "local", status: "visible stub", integration: "planned first-class lane", use: "Reusable branded templates and batch renders" },
      { name: "DaVinci Resolve", category: "edit/finish", location: "ROJEKTI / local", status: "manual", integration: "handoff only", use: "Final edit, review, delivery" },
      { name: "VIDNAS", category: "storage", location: "NAS", status: "used", integration: "asset paths", use: "Shared media, generated assets, handoff paths" },
    ];
  }

  function renderCapabilityInventoryPanel() {
    const rows = capabilityInventoryItems().map((item) => `<article class="capability-card capability-${escapeHtml(item.status.replace(/[^a-z0-9]+/gi, "-").toLowerCase())}">
      <div><span>${escapeHtml(item.category)}</span><strong>${escapeHtml(item.name)}</strong></div>
      <p>${escapeHtml(item.use)}</p>
      <small>${escapeHtml(item.location)} · ${escapeHtml(item.status)} · ${escapeHtml(item.integration)}</small>
    </article>`).join("");
    return `<div class="capability-inventory-card">
      <div>
        <p class="eyebrow">Capability Inventory</p>
        <h2>Visible Production Lanes</h2>
        <p class="muted">Used, planned, manual, and stubbed capabilities are visible so tools do not become hidden scripts.</p>
      </div>
      <div class="capability-grid">${rows}</div>
    </div>`;
  }

  function renderProductionCard(run) {
    const title = run.title || run.runId;
    const updated = run.updatedAt ? new Date(run.updatedAt).toLocaleDateString() : "No tracked files";
    const runHref = run.path ? `${run.path}/` : "#";
    const bucket = productionBucketForRun(run);
    const bucketClass = bucket.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
    const ledger = buildProductionAssetLedger(run);
    return `<article class="production-card production-bucket-${bucketClass}" data-run-id="${escapeHtml(run.runId)}">
      <div class="production-card-layout">
        ${renderVideoThumbnail(run)}
        <div class="production-card-main">
          <div class="production-card-top">
            <span class="package-number">${escapeHtml(run.runId)}</span>
            <span class="run-status-pill ${statusClass(run.status)}">${escapeHtml(run.status)}</span>
          </div>
          <h3>${escapeHtml(title)}</h3>
          <p class="production-card-concept">${escapeHtml(runConceptDescription(run))}</p>
          ${renderCompactPipelineStrip(run)}
        </div>
      </div>
      <div class="production-card-next">
        <span>Next</span>
        <strong>${escapeHtml(run.nextRecommendedCommand || run.nextExpectedFile || "Manual review required")}</strong>
      </div>
      ${renderAssetLedger(ledger, { compact: true })}
      <div class="production-card-meta">
        <span>Updated: ${escapeHtml(updated)}</span>
        <a href="${escapeHtml(runHref)}" class="nav-link-button" data-open-package-folder="${escapeHtml(run.runId)}">Open folder</a>
      </div>
      <button type="button" class="focus-run-btn" data-focus-run="${escapeHtml(run.runId)}">Focus this run / Open video room</button>
    </article>`;
  }

  function renderProductionsOverview(runs) {
    const buckets = groupRunsByProductionBucket(runs);
    const sections = PRODUCTION_BUCKETS.filter((label) => buckets[label].length > 0);
    if (sections.length === 0) {
      return `<p class="muted">No package runs found. Run <code>node scripts/package-runs-index.js</code> to generate the index.</p>`;
    }
    return sections.map((label) => {
      const bucketRuns = buckets[label];
      const bucketClass = label.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
      return `<section class="production-bucket production-bucket-${bucketClass}" data-production-bucket="${escapeHtml(label)}">
        <div class="production-bucket-header">
          <h3>${escapeHtml(label)}</h3>
          <span class="production-bucket-count">${bucketRuns.length}</span>
        </div>
        <div class="production-bucket-grid">${bucketRuns.map(renderProductionCard).join("")}</div>
      </section>`;
    }).join("");
  }

  function focusRunFolderForRun(run = {}, runId = "") {
    return (run && run.runId) || runId || "";
  }

  function normalizeNextSafeAction(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const facts = source.facts && typeof source.facts === "object" ? source.facts : {};
    return {
      ok: source.ok !== false,
      readOnly: source.readOnly !== false,
      activeRun: String(source.activeRun || ""),
      activeRunPath: String(source.activeRunPath || ""),
      stage: String(source.stage || "Blocked / evidence missing"),
      nextHumanAction: String(source.nextHumanAction || "Stop and inspect missing evidence before doing production work."),
      nextAiAction: String(source.nextAiAction || "Prepare handoffs, inspect files, summarize status, or create read-only reports. Do not approve assets."),
      blockedUntil: String(source.blockedUntil || "Required evidence is present and reviewed by Mikko."),
      allowedActions: normalizeStringArray(source.allowedActions),
      forbiddenActions: normalizeStringArray(source.forbiddenActions),
      evidence: Array.isArray(source.evidence)
        ? source.evidence.map((item) => {
            const evidence = item && typeof item === "object" ? item : {};
            return {
              label: String(evidence.label || "evidence"),
              path: String(evidence.path || ""),
              href: String(evidence.href || evidence.path || ""),
              exists: Boolean(evidence.exists),
              kind: String(evidence.kind || ""),
            };
          })
        : [],
      facts: {
        selectedStatus: String(facts.selectedStatus || "selected: 0 / reviewed: 0 / approved: 0 / production_ready: 0"),
        selectedStillCount: Number.isFinite(facts.selectedStillCount) ? facts.selectedStillCount : 0,
        reviewedPrompt03Count: Number.isFinite(facts.reviewedPrompt03Count) ? facts.reviewedPrompt03Count : 0,
        approvedCount: Number.isFinite(facts.approvedCount) ? facts.approvedCount : 0,
        productionReadyCount: Number.isFinite(facts.productionReadyCount) ? facts.productionReadyCount : 0,
        expectedKlingVideoFilenames: normalizeStringArray(facts.expectedKlingVideoFilenames),
        klingVideoCount: Number.isFinite(facts.klingVideoCount) ? facts.klingVideoCount : 0,
        klingVideos: normalizeStringArray(facts.klingVideos),
        resolveTestRecorded: Boolean(facts.resolveTestRecorded),
      },
    };
  }

  function renderEvidenceLinks(evidence = []) {
    const items = evidence.length ? evidence : [{ label: "No evidence paths reported", path: "", href: "", exists: false }];
    return `<ul class="next-safe-evidence-list">${items.map((item) => {
      const state = item.exists ? "present" : "missing";
      const label = `${item.label} (${state})`;
      if (item.href && !/^\//.test(item.href)) {
        return `<li><a href="${escapeHtml(item.href)}" data-preview-artifact="${escapeHtml(item.href)}" data-artifact-title="${escapeHtml(item.label)}" data-run-id="${escapeHtml(item.label)}">${escapeHtml(label)}</a><code>${escapeHtml(item.path)}</code></li>`;
      }
      return `<li><span>${escapeHtml(label)}</span><code>${escapeHtml(item.path || "missing")}</code></li>`;
    }).join("")}</ul>`;
  }

  function renderNextSafeActionPanel(payload) {
    const panel = normalizeNextSafeAction(payload);
    const safeReadOnly = panel.readOnly ? "Read-only local inspection" : "Not read-only";
    return `<div class="next-safe-action-card" data-next-safe-action>
      <div class="next-safe-action-header">
        <div>
          <p class="eyebrow">NEXT SAFE ACTION</p>
          <h2>${escapeHtml(panel.stage)}</h2>
          <p class="muted">Active run: <code>${escapeHtml(panel.activeRun || "unknown")}</code></p>
        </div>
        <span class="lifecycle-badge ${panel.readOnly ? "success" : "error"}">${escapeHtml(safeReadOnly)}</span>
      </div>
      <div class="next-safe-action-main">
        <section>
          <h3>HUMAN NEXT</h3>
          <p>${escapeHtml(panel.nextHumanAction)}</p>
        </section>
        <section>
          <h3>AI MAY DO</h3>
          <p>${escapeHtml(panel.nextAiAction)}</p>
        </section>
        <section>
          <h3>BLOCKED UNTIL</h3>
          <p>${escapeHtml(panel.blockedUntil)}</p>
        </section>
      </div>
      <div class="next-safe-action-status" aria-label="Selected reviewed approved production_ready distinction">
        <div><span>selected</span><strong>${panel.facts.selectedStillCount}</strong></div>
        <div><span>reviewed</span><strong>${panel.facts.reviewedPrompt03Count}</strong></div>
        <div><span>approved</span><strong>${panel.facts.approvedCount}</strong></div>
        <div><span>production_ready</span><strong>${panel.facts.productionReadyCount}</strong></div>
        <div><span>Kling MP4s</span><strong>${panel.facts.klingVideoCount}</strong></div>
        <div><span>Resolve test</span><strong>${panel.facts.resolveTestRecorded ? "recorded" : "missing"}</strong></div>
      </div>
      <div class="next-safe-action-lists">
        <section>
          <h3>Allowed actions</h3>
          ${renderCompactList(panel.allowedActions, "No allowed actions reported.")}
        </section>
        <section class="next-safe-danger">
          <h3>DO NOT DO</h3>
          ${renderCompactList(panel.forbiddenActions, "No forbidden actions reported.")}
        </section>
      </div>
      <section class="next-safe-evidence">
        <h3>Evidence / source files</h3>
        ${renderEvidenceLinks(panel.evidence)}
      </section>
    </div>`;
  }

  function findActiveRunFromIndex(indexPayload = {}, activeRunId = "") {
    const normalized = normalizeIndex(indexPayload);
    if (activeRunId) {
      const match = normalized.runs.find((run) => run.runId === activeRunId);
      if (match) return match;
    }
    const activeRuns = normalized.runs.filter((run) => !run.inactive);
    return activeRuns.length === 1 ? activeRuns[0] : null;
  }

  function uniqueStrings(values = []) {
    return [...new Set(normalizeStringArray(values))];
  }

  function compactCreatorList(items = [], limit = 4) {
    const normalized = uniqueStrings(items).filter(Boolean);
    if (normalized.length <= limit) return normalized;
    return [...normalized.slice(0, limit), `${normalized.length - limit} more in diagnostics.`];
  }

  function buildSecondCutReadinessModel(activeRun = null, panel = {}) {
    if (!activeRun) {
      return {
        status: "needs review",
        className: "needs-review",
        blockingReason: "No active package-run source is loaded in the Creator Cockpit.",
        requiredHumanAction: "Open diagnostics and confirm the active run before doing second-cut work.",
        sourceArtifact: "package-runs-index.json",
        warning: "AI cannot approve second-cut readiness.",
      };
    }

    const lifecycleGate = normalizeLifecycleGate(activeRun.lifecycleGate);
    const roughCutStatus = String(lifecycleGate.roughCutStatus || activeRun.status || "unknown");
    const secondCutReady = Boolean(lifecycleGate.secondCutReady);
    const hasRealRoughCutEvidence = Boolean(lifecycleGate.hasRealRoughCutEvidence);
    const sourceArtifacts = [];
    if (activeRun.files && activeRun.files.rough_cut_review) sourceArtifacts.push("rough-cut-review.md");
    if (activeRun.files && activeRun.files.rough_cut_watch_notes) sourceArtifacts.push("rough-cut-watch-notes.md");
    if (activeRun.files && activeRun.files.pickup_list) sourceArtifacts.push("pickup-list.md");
    if (activeRun.files && activeRun.files.edit_fix_list) sourceArtifacts.push("edit-fix-list.md");
    const sourceArtifact = sourceArtifacts.length ? `${sourceArtifacts.join(", ")} via package-runs-index.json` : "package-runs-index.json";

    if (!hasRealRoughCutEvidence) {
      return {
        status: "blocked",
        className: "blocked",
        blockingReason: "Real rough-cut watch evidence is missing or not trusted.",
        requiredHumanAction: "Record or inspect concrete rough-cut watch notes before any second-cut readiness decision.",
        sourceArtifact,
        warning: "AI cannot approve second-cut readiness.",
      };
    }

    if (/NEEDS PICKUPS|NEEDS EDIT FIXES|BLOCKED/i.test(roughCutStatus) || activeRun.overallStatus === "BLOCKED") {
      return {
        status: "blocked",
        className: "blocked",
        blockingReason:
          activeRun.firstBlockerReason ||
          `Rough-cut review status is ${roughCutStatus}, not READY FOR SECOND CUT.`,
        requiredHumanAction:
          roughCutStatus === "NEEDS PICKUPS"
            ? "Resolve or explicitly reject the pickup items, then regenerate/review the rough-cut status."
            : roughCutStatus === "NEEDS EDIT FIXES"
              ? "Complete the edit fixes, then regenerate/review the rough-cut status."
              : panel.nextHumanAction || "Resolve the rough-cut blocker before second-cut approval.",
        sourceArtifact,
        warning: "AI cannot approve second-cut readiness.",
      };
    }

    if (roughCutStatus === "READY FOR SECOND CUT" || secondCutReady) {
      return {
        status: "human approval required",
        className: "human-approval",
        blockingReason: "Rough-cut artifacts indicate second-cut readiness, but this dashboard is not an approval authority.",
        requiredHumanAction: "Mikko must review the relevant candidate/artifacts and explicitly choose the next gate.",
        sourceArtifact,
        warning: "AI cannot approve second-cut readiness or downstream final review.",
      };
    }

    return {
      status: "needs review",
      className: "needs-review",
      blockingReason: `Rough-cut status is ${roughCutStatus}; second-cut readiness is not established.`,
      requiredHumanAction: panel.nextHumanAction || "Review the rough-cut gate and record the required human decision.",
      sourceArtifact,
      warning: "AI cannot approve second-cut readiness.",
    };
  }

  function buildCreatorCockpitPayload(payload = {}, options = {}) {
    const panel = normalizeNextSafeAction(payload);
    const beginningState = normalizeBeginningTriageState(options.beginningState || {});
    const indexPayload = options.index || {};
    const index = normalizeIndex(indexPayload);
    const activeRun = findActiveRunFromIndex(index, panel.activeRun);
    const hasActiveRun = Boolean(panel.activeRun);
    const hasBeginningDraft = beginningState.stage !== "not_started";
    const sourceStatus = hasActiveRun ? "available" : activeRun ? "partial" : hasBeginningDraft ? "partial" : "needs-review";
    const canonicalNow = hasActiveRun
      ? panel.stage
      : activeRun
        ? activeRun.status
        : hasBeginningDraft
          ? beginningTriageStatusLabel(beginningState)
          : "Beginning triage available";
    const nextAction = hasActiveRun
      ? panel.nextHumanAction
      : hasBeginningDraft && beginningState.fields.nextThirtyMinuteAction
        ? beginningState.fields.nextThirtyMinuteAction
        : activeRun
          ? activeRun.nextRecommendedCommand || "Review diagnostics before choosing package-run work."
          : "Use Beginning Triage to discover a direction, shape the promise, then validate the proof gap.";
    const proof = [];
    const missingProof = [];
    const visibleEvidenceCount = panel.evidence.filter((item) => item.exists).length;
    const missingEvidenceCount = panel.evidence.filter((item) => !item.exists).length;
    panel.evidence.forEach((item) => {
      if (!item.exists) missingProof.push(`${item.label}: missing. See diagnostics for path/source detail.`);
    });
    if (visibleEvidenceCount) {
      proof.push(`${visibleEvidenceCount} source areas visible or detected. Source details stay in diagnostics; detected is not accepted.`);
    }
    if (missingEvidenceCount) {
      missingProof.push(`${missingEvidenceCount} source areas missing or not visible. See diagnostics for exact paths.`);
    }
    if (panel.facts.selectedStillCount || panel.facts.reviewedPrompt03Count) {
      proof.push(`${panel.facts.selectedStillCount} selected stills and ${panel.facts.reviewedPrompt03Count} reviewed prompt-03 items detected.`);
    }
    if (panel.facts.klingVideoCount) {
      proof.push(`${panel.facts.klingVideoCount} Kling MP4 candidate${panel.facts.klingVideoCount === 1 ? "" : "s"} detected.`);
    } else if (hasActiveRun) {
      missingProof.push("Kling MP4 candidates are missing.");
    }
    if (panel.facts.resolveTestRecorded) {
      proof.push("Resolve timeline test evidence is recorded.");
    } else if (hasActiveRun) {
      missingProof.push("Resolve timeline test evidence is missing.");
    }
    if (activeRun) {
      const evidenceGate = normalizeEvidenceGate(activeRun.evidenceGate);
      const lifecycleGate = normalizeLifecycleGate(activeRun.lifecycleGate);
      if (evidenceGate.evidenceReferences.length) {
        proof.push(`${evidenceGate.evidenceReferences.length} index evidence reference${evidenceGate.evidenceReferences.length === 1 ? "" : "s"} detected; references are diagnostic until the proper gate accepts them.`);
      }
      if (lifecycleGate.captureEvidenceRealEvidence) {
        proof.push("Lifecycle diagnostics report real capture evidence detected; the cockpit does not create approval.");
      }
      if (activeRun.nextExpectedFile) missingProof.push(`Index missing/next expected: ${activeRun.nextExpectedFile}.`);
      activeRun.missingExpectedArtifacts.forEach((item) => missingProof.push(`Missing expected artifact: ${item}.`));
      if (evidenceGate.warning) missingProof.push("Evidence gate warning present; review diagnostics before readiness claims.");
    }
    if (!proof.length) proof.push("No proof source is currently visible in the cockpit payload.");
    if (!missingProof.length) missingProof.push(panel.blockedUntil || "No missing proof detail reported; review diagnostics before claiming readiness.");

    const blockedActions = uniqueStrings([
      ...panel.forbiddenActions,
      ...(activeRun ? activeRun.conservativeBlockedActions : []),
      "mark publish_ready",
      "upload",
      "archive",
      "update Hermes memory",
      "update project-state notes",
    ]);
    const mikkoMust = hasActiveRun
      ? [
          panel.nextHumanAction,
          `Confirm blocked-until condition manually: ${panel.blockedUntil}`,
          "Make any approval or readiness decision outside the read-only cockpit after reviewing proof.",
        ]
      : [
          "Choose the next creator-owned direction or active package-run before downstream work.",
          "Keep approvals and readiness decisions outside the read-only cockpit.",
        ];
    const reconciliation = [];
    if (activeRun && panel.stage && activeRun.status && panel.stage !== activeRun.status) {
      reconciliation.push(`Lifecycle index says ${activeRun.status}; cockpit uses next-safe-action as Now. Lifecycle is diagnostic and package-runs-index.json may lag.`);
    }
    if (activeRun && activeRun.workflowBucket && activeRun.workflowBucket !== activeRun.status) {
      reconciliation.push(`Workflow bucket says ${activeRun.workflowBucket}; lower dashboard panels remain diagnostics, not competing creator truth.`);
    }
    if (!hasActiveRun && !activeRun) {
      reconciliation.push("Next-safe-action source is unavailable; cockpit stays conservative and does not invent readiness.");
    }

    return {
      readOnly: panel.readOnly,
      sourceStatus,
      runId: panel.activeRun || (activeRun ? activeRun.runId : ""),
      runPath: panel.activeRunPath || (activeRun ? activeRun.path : ""),
      now: {
        label: canonicalNow || "Needs review",
        source: hasActiveRun ? "next-safe-action" : activeRun ? "package-runs-index" : hasBeginningDraft ? "beginning-triage" : "fallback",
        reconciliation,
      },
      nextThirtyMinuteAction: {
        text: nextAction || "Review diagnostics before acting.",
        doneCondition: panel.blockedUntil || "Mikko has reviewed the relevant proof and missing proof.",
      },
      proof: compactCreatorList(proof, 3),
      missingProof: compactCreatorList(missingProof, 4),
      aiMay: compactCreatorList([panel.nextAiAction, ...panel.allowedActions], 4),
      mikkoMust: compactCreatorList(mikkoMust, 3),
      blockedActions: compactCreatorList(blockedActions, 6),
      beginningState,
      activeRunFocus: hasActiveRun,
      hasBeginningDraft,
      secondCutReadiness: buildSecondCutReadinessModel(activeRun, panel),
    };
  }

  function renderCreatorCockpitList(items, emptyLabel) {
    return renderCompactList(items, emptyLabel, "creator-cockpit-list");
  }

  function renderCreatorCockpit(cockpit = {}) {
    const model = cockpit && typeof cockpit === "object" ? cockpit : buildCreatorCockpitPayload();
    const secondCutReadiness = model.secondCutReadiness || buildSecondCutReadinessModel(null, {});
    const readOnlyLabel = model.readOnly === false ? "Source not read-only" : "Read-only cockpit";
    const runMeta = model.runId ? `Active run: ${escapeHtml(model.runId)}` : "No active package-run source loaded.";
    return `<div id="currentFocusContent" class="current-focus-content creator-cockpit-content" data-current-focus-result data-creator-cockpit data-active-run-focus="${model.activeRunFocus ? "true" : "false"}">
      <div class="creator-cockpit-status">
        <span class="lifecycle-badge ${model.readOnly === false ? "error" : "success"}">${escapeHtml(readOnlyLabel)}</span>
        <span>${escapeHtml(runMeta)}</span>
        <span>Detected sources are diagnostics until a proper gate accepts them.</span>
      </div>
      <section class="creator-cockpit-section creator-cockpit-now" aria-label="Now">
        <span>Now</span>
        <strong>${escapeHtml(model.now.label || "Needs review")}</strong>
        <p>Canonical source: ${escapeHtml(model.now.source || "fallback")}.</p>
        ${model.now.reconciliation.length ? `<div class="creator-cockpit-reconciliation">${renderCreatorCockpitList(model.now.reconciliation, "No source conflict reported.")}</div>` : ""}
      </section>
      <section class="creator-cockpit-section creator-cockpit-next" aria-label="Next 30-minute action">
        <span>Next 30-minute action</span>
        <strong>${escapeHtml(model.nextThirtyMinuteAction.text)}</strong>
        <p>Done when: ${escapeHtml(model.nextThirtyMinuteAction.doneCondition)}</p>
      </section>
      <section class="creator-cockpit-section creator-cockpit-second-cut ${escapeHtml(secondCutReadiness.className)}" aria-label="Second-cut readiness">
        <span>Second-cut readiness</span>
        <strong>${escapeHtml(secondCutReadiness.status)}</strong>
        <p><b>Blocking reason:</b> ${escapeHtml(secondCutReadiness.blockingReason)}</p>
        <p><b>Required human action:</b> ${escapeHtml(secondCutReadiness.requiredHumanAction)}</p>
        <p><b>Source:</b> ${escapeHtml(secondCutReadiness.sourceArtifact)}</p>
        <p>${escapeHtml(secondCutReadiness.warning)}</p>
      </section>
      <section class="creator-cockpit-section" aria-label="Proof">
        <span>Proof</span>
        ${renderCreatorCockpitList(model.proof, "No visible proof source reported.")}
      </section>
      <section class="creator-cockpit-section" aria-label="Missing proof">
        <span>Missing proof</span>
        ${renderCreatorCockpitList(model.missingProof, "No missing proof reported; verify diagnostics before claiming readiness.")}
      </section>
      <section class="creator-cockpit-section" aria-label="AI may">
        <span>AI may</span>
        ${renderCreatorCockpitList(model.aiMay, "Inspect files and summarize status only.")}
      </section>
      <section class="creator-cockpit-section" aria-label="Mikko must">
        <span>Mikko must</span>
        ${renderCreatorCockpitList(model.mikkoMust, "Choose the next accountable creator action.")}
      </section>
      <section class="creator-cockpit-section creator-cockpit-blocked" aria-label="Blocked actions">
        <span>Blocked actions</span>
        ${renderCreatorCockpitList(model.blockedActions, "No blocked actions reported; stay conservative.")}
      </section>
      <div class="creator-cockpit-actions">
        <button type="button" data-dashboard-action="open-diagnostics">Open diagnostics</button>
        ${model.hasBeginningDraft ? `<button type="button" data-dashboard-action="open-beginning-triage">Open Beginning Triage</button>` : ""}
      </div>
      ${
        model.hasBeginningDraft && model.activeRunFocus
          ? `<p class="muted">Beginning triage draft exists, but active package-run focus remains primary.</p>`
          : ""
      }
    </div>`;
  }

  function normalizeEvidenceIntake(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const fields = source.fields && typeof source.fields === "object" ? source.fields : {};
    return {
      ok: source.ok !== false,
      readOnly: source.readOnly !== false,
      saveMode: String(source.saveMode || "preview-only"),
      runId: String(source.runId || ""),
      runPath: String(source.runPath || ""),
      evidenceStatus: String(source.evidenceStatus || "Evidence status unavailable"),
      nextEvidenceAction: String(source.nextEvidenceAction || "Record concrete media evidence and keep approval separate."),
      labels: normalizeStringArray(source.labels),
      existingRows: Array.isArray(source.existingRows)
        ? source.existingRows.map((row) => normalizeEvidenceIntakeRow(row))
        : [],
      existingRowCount: Number.isFinite(source.existingRowCount) ? source.existingRowCount : 0,
      fields: {
        mediaTypes: normalizeStringArray(fields.mediaTypes),
        sourceCategories: normalizeStringArray(fields.sourceCategories),
        statuses: normalizeStringArray(fields.statuses),
      },
      allowedWriteFiles: normalizeStringArray(source.allowedWriteFiles),
      forbiddenActions: normalizeStringArray(source.forbiddenActions),
    };
  }

  function normalizeEvidenceIntakeRow(row = {}) {
    const source = row && typeof row === "object" ? row : {};
    return {
      media_path: String(source.media_path || ""),
      media_type: String(source.media_type || ""),
      source_category: String(source.source_category || ""),
      proof_purpose: String(source.proof_purpose || ""),
      related_script_block_or_section: String(source.related_script_block_or_section || ""),
      status: String(source.status || ""),
      resolve_tested: String(source.resolve_tested || "no"),
      notes: String(source.notes || ""),
      artifact: String(source.artifact || ""),
      line: Number.isFinite(source.line) ? source.line : 0,
      existsOnDisk: Boolean(source.existsOnDisk),
      evidenceOnly: source.evidenceOnly !== false,
    };
  }

  function renderEvidenceOptions(options = [], selected = "") {
    return options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
  }

  function evidenceRowLabel(row) {
    if (row.status === "missing") return "MISSING FILE";
    if (row.status === "tested_in_resolve" && row.resolve_tested !== "yes") return "NEEDS RESOLVE TEST";
    if (row.status === "usable") return "USABLE CANDIDATE";
    if (row.status === "exists_on_vidnas" || row.status === "imported_to_resolve") return "EVIDENCE ONLY";
    return "NOT APPROVED";
  }

  function renderEvidenceRows(rows = []) {
    if (!rows.length) return `<p class="muted">No existing evidence rows were found in the capture artifacts.</p>`;
    return `<div class="evidence-row-table" role="table" aria-label="Existing evidence rows">
      <div class="evidence-row-header" role="row">
        <span>File</span><span>Type</span><span>Purpose</span><span>Status</span><span>Resolve</span>
      </div>
      ${rows.slice(0, 24).map((row) => `<div class="evidence-row" role="row">
        <code>${escapeHtml(row.media_path || "no media path")}</code>
        <span>${escapeHtml(row.media_type || "other")}</span>
        <span>${escapeHtml(row.proof_purpose || "No proof purpose recorded.")}<small>${escapeHtml(row.artifact ? `${row.artifact}:${row.line || ""}` : row.notes)}</small></span>
        <strong>${escapeHtml(evidenceRowLabel(row))}</strong>
        <span>${escapeHtml(row.resolve_tested === "yes" ? "tested" : "not tested")}</span>
      </div>`).join("")}
    </div>`;
  }

  function renderEvidenceIntakePanel(payload) {
    const panel = normalizeEvidenceIntake(payload);
    const mediaTypes = panel.fields.mediaTypes.length ? panel.fields.mediaTypes : [
      "screen_capture",
      "camera_capture",
      "audio_capture",
      "generated_still",
      "generated_video",
      "kling_candidate",
      "resolve_timeline_test",
      "export_candidate",
      "other",
    ];
    const sourceCategories = panel.fields.sourceCategories.length ? panel.fields.sourceCategories : [
      "A-roll",
      "B-roll",
      "screen proof",
      "generated asset",
      "Resolve test",
      "audio",
      "export",
      "other",
    ];
    const statuses = panel.fields.statuses.length ? panel.fields.statuses : [
      "planned",
      "exists_on_vidnas",
      "imported_to_resolve",
      "tested_in_resolve",
      "usable",
      "rejected",
      "missing",
    ];
    return `<div class="evidence-intake-card" data-evidence-intake data-run-id="${escapeHtml(panel.runId)}">
      <div class="evidence-intake-header">
        <div>
          <p class="eyebrow">Evidence Intake</p>
          <h2>${escapeHtml(panel.evidenceStatus)}</h2>
          <p class="muted">Active run: <code>${escapeHtml(panel.runId || "unknown")}</code></p>
        </div>
        <div class="evidence-intake-labels">
          ${(panel.labels.length ? panel.labels : ["EVIDENCE ONLY", "NOT APPROVED", "NOT PRODUCTION READY"]).map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
        </div>
      </div>
      <div class="evidence-intake-next">
        <h3>Next evidence action</h3>
        <p>${escapeHtml(panel.nextEvidenceAction)}</p>
      </div>
      <section>
        <h3>What media evidence exists?</h3>
        ${renderEvidenceRows(panel.existingRows)}
      </section>
      <section class="evidence-add-row">
        <h3>Add evidence row</h3>
        <div class="evidence-form-grid">
          <label><span>media_path *</span><input type="text" data-evidence-field="media_path" placeholder="/mnt/vidnas_public/.../kling-video-candidates/block-024-prompt-03-kling-01.mp4" /></label>
          <label><span>media_type *</span><select data-evidence-field="media_type">${renderEvidenceOptions(mediaTypes, "kling_candidate")}</select></label>
          <label><span>source_category</span><select data-evidence-field="source_category">${renderEvidenceOptions(sourceCategories, "generated asset")}</select></label>
          <label><span>status *</span><select data-evidence-field="status">${renderEvidenceOptions(statuses, "exists_on_vidnas")}</select></label>
          <label><span>resolve_tested</span><select data-evidence-field="resolve_tested"><option value="no">no</option><option value="yes">yes</option></select></label>
          <label><span>related section</span><input type="text" data-evidence-field="related_script_block_or_section" placeholder="block-024 or hook" /></label>
          <label class="evidence-field-wide"><span>proof_purpose *</span><input type="text" data-evidence-field="proof_purpose" placeholder="What this media proves or supports in the edit" /></label>
          <label class="evidence-field-wide"><span>notes</span><input type="text" data-evidence-field="notes" placeholder="Resolve timeline notes, missing context, or why this remains a candidate" /></label>
        </div>
        <div class="evidence-write-actions">
          <button type="button" data-evidence-preview>Preview evidence intake</button>
          <button type="button" data-evidence-save disabled>Save evidence intake draft</button>
        </div>
        <div class="evidence-write-status" data-evidence-status>Preview validates without writing. Save writes only <code>${escapeHtml((panel.allowedWriteFiles || []).join(", ") || "capture-evidence-intake-log.md")}</code>.</div>
        <textarea readonly rows="12" class="capture-write-preview" data-evidence-preview-output placeholder="Preview will show the exact evidence-only draft before writing."></textarea>
      </section>
      <section class="evidence-boundary">
        <h3>DO NOT DO</h3>
        ${renderCompactList(panel.forbiddenActions, "No forbidden actions reported.")}
      </section>
    </div>`;
  }

  function renderCurrentFocus(payload = {}, options = {}) {
    return renderCreatorCockpit(buildCreatorCockpitPayload(payload, options));
  }

  function renderBeginningDraftReminder(state, activeRunFocus = false) {
    const fields = state.fields || {};
    const selectedCandidate = state.selectedCandidate ? fields[`candidate${state.selectedCandidate}Title`] || `Candidate ${state.selectedCandidate}` : "";
    const selectedPackage = state.selectedPackage ? fields[`package${state.selectedPackage}Title`] || `Package ${state.selectedPackage}` : "";
    const nextAction = fields.nextThirtyMinuteAction || (state.stage === "next_action" ? "Next 30-minute action not captured yet." : "");
    return `<div class="current-focus-card beginning-draft-reminder">
      <span>Beginning triage draft in progress</span>
      <strong>${escapeHtml(beginningTriageStatusLabel(state))}</strong>
      <p>Stage: ${escapeHtml(beginningTriageStepLabel(state.stage))}</p>
      ${fields.topicArea ? `<p>Topic/problem space: ${escapeHtml(fields.topicArea)}</p>` : ""}
      ${selectedCandidate ? `<p>Selected candidate: ${escapeHtml(selectedCandidate)}</p>` : ""}
      ${selectedPackage ? `<p>Selected package: ${escapeHtml(selectedPackage)}</p>` : ""}
      ${nextAction ? `<p>Next action: ${escapeHtml(nextAction)}</p>` : ""}
      <button type="button" data-dashboard-action="open-beginning-triage">Open Beginning Triage</button>
      ${activeRunFocus ? "<p>Active package-run focus remains primary.</p>" : ""}
    </div>`;
  }

  function normalizeDashboardMode(mode = "focus") {
    return mode === "full" ? "full" : "focus";
  }

  function dashboardFocusGroup(activeRunFocus = false) {
    return activeRunFocus ? "active-package-run" : "beginning-triage";
  }

  function dashboardGroupOpenState(mode = "focus", activeRunFocus = false) {
    const normalizedMode = normalizeDashboardMode(mode);
    return Object.fromEntries(DASHBOARD_GROUPS.map((group) => [group, normalizedMode === "full"]));
  }

  function createBrowserApp(doc = globalScope.document) {
    const els = {
      status: doc.querySelector("#packageRunsStatus"),
      dashboard: doc.querySelector(".package-runs-dashboard"),
      currentFocusPanel: doc.querySelector("#currentFocusPanel"),
      currentFocusContent: doc.querySelector("#currentFocusContent"),
      beginningTriagePanel: doc.querySelector("#beginningTriageCockpit"),
      diagnosticsGroup: doc.querySelector("[data-dashboard-group='diagnostics']"),
      beginningGroup: doc.querySelector("[data-dashboard-group='beginning-triage']"),
      activePackageGroup: doc.querySelector("[data-dashboard-group='active-package-run']"),
      nextSafeActionPanel: doc.querySelector("#nextSafeActionPanel"),
      evidenceIntakePanel: doc.querySelector("#evidenceIntakePanel"),
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
      mikkoConsoleStatus: doc.querySelector("#mikkoConsoleStatus"),
      mikkoConsoleContent: doc.querySelector("#mikkoConsoleContent"),
      productionsOverview: doc.querySelector("#productionsOverview"),
      videoRoomPanel: doc.querySelector("#videoRoomPanel"),
      systemAvailabilityPanel: doc.querySelector("#systemAvailabilityPanel"),
      capabilityInventoryPanel: doc.querySelector("#capabilityInventoryPanel"),
    };
    let index = normalizeIndex({});
    let localWriteConfig = null;
    let localWriteConfigPromise = null;
    let dashboardMode = "focus";
    let selectedRunId = null;

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
      if (els.productionsOverview) {
        els.productionsOverview.innerHTML = renderProductionsOverview(index.runs);
      }
      const focusedRun = index.runs.find((run) => run.runId === selectedRunId) || findActiveRunFromIndex(index, "") || index.runs[0] || null;
      if (els.videoRoomPanel) {
        els.videoRoomPanel.innerHTML = renderVideoProjectRoom(focusedRun);
      }
      if (els.systemAvailabilityPanel) {
        els.systemAvailabilityPanel.innerHTML = renderSystemAvailabilityPanel(index, localWriteConfig || {});
      }
      if (els.capabilityInventoryPanel) {
        els.capabilityInventoryPanel.innerHTML = renderCapabilityInventoryPanel();
      }
    }

    function focusRun(runId) {
      if (!runId) return;
      const run = index.runs.find((r) => r.runId === runId);
      const runFolder = focusRunFolderForRun(run, runId);
      setFocusedRun(runId);
      if (els.videoRoomPanel) {
        els.videoRoomPanel.innerHTML = renderVideoProjectRoom(run || null);
      }
      loadHyperframesLane(runId);
      loadPipelinePanels(runFolder);
      if (els.dashboard) {
        els.dashboard.scrollTop = 0;
      }
      const focusBtn = doc.querySelector(`[data-focus-run="${runId}"]`);
      if (focusBtn) {
        doc.querySelectorAll(".production-card").forEach((card) => card.classList.remove("production-card-focused"));
        const card = focusBtn.closest(".production-card");
        if (card) card.classList.add("production-card-focused");
      }
    }

    function storageAvailable() {
      return Boolean(globalScope.localStorage && globalScope.localStorage.getItem && globalScope.localStorage.setItem);
    }

    function readBeginningTriageState() {
      if (!storageAvailable()) return beginningTriageInitialState();
      try {
        const raw = globalScope.localStorage.getItem(BEGINNING_TRIAGE_STORAGE_KEY);
        return raw ? normalizeBeginningTriageState(JSON.parse(raw)) : beginningTriageInitialState();
      } catch (_error) {
        return beginningTriageInitialState();
      }
    }

    function saveBeginningTriageState(state) {
      const normalized = normalizeBeginningTriageState(state);
      if (storageAvailable()) {
        globalScope.localStorage.setItem(BEGINNING_TRIAGE_STORAGE_KEY, JSON.stringify(normalized));
      }
      return normalized;
    }

    function renderBeginningTriageFromStorage() {
      if (!els.beginningTriagePanel) return;
      const state = readBeginningTriageState();
      els.beginningTriagePanel.innerHTML = renderBeginningTriageCockpit(state);
      renderCurrentFocusFallback(state);
    }

    function renderCurrentFocusFallback(state = readBeginningTriageState()) {
      if (!els.currentFocusContent || els.currentFocusContent.dataset.activeRunFocus === "true") return;
      els.currentFocusContent.outerHTML = renderCurrentFocus({}, { beginningState: state });
      els.currentFocusContent = doc.querySelector("#currentFocusContent") || doc.querySelector("[data-current-focus-result]");
    }

    function normalizeDashboardMode(mode) {
      return mode === "full" ? "full" : "focus";
    }

    function setDashboardMode(mode = "focus") {
      const nextMode = normalizeDashboardMode(mode);
      dashboardMode = nextMode;
      if (els.dashboard) els.dashboard.dataset.dashboardMode = nextMode;
      doc.querySelectorAll("[data-dashboard-mode-button]").forEach((button) => {
        const active = button.dataset.dashboardModeButton === nextMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      const activeRunFocus = activeRunId && (dashboardMode === "focus" || focusModeOverride);
      const openState = dashboardGroupOpenState(nextMode, activeRunFocus);
      doc.querySelectorAll("[data-dashboard-group]").forEach((group) => {
        const groupName = group.dataset.dashboardGroup;
        group.open = Boolean(openState[groupName]);
      });
    }

    function setFocusedRun(runId) {
      activeRunId = runId;
      focusModeOverride = true;
      if (els.dashboard) els.dashboard.dataset.focusedRun = runId || "false";
      if (runId && dashboardMode === "focus") {
        setDashboardMode("focus");
      }
      requestAnimationFrame(() => {
        if (els.videoRoomPanel) {
          els.videoRoomPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }

    function clearFocusedRun() {
      activeRunId = "";
      focusModeOverride = false;
      if (els.dashboard) els.dashboard.dataset.focusedRun = "false";
      setDashboardMode(dashboardMode);
    }

    function beginningTriageStateFromDom(container) {
      const state = readBeginningTriageState();
      container.querySelectorAll("[data-beginning-field]").forEach((field) => {
        state.fields[field.dataset.beginningField] = field.value;
      });
      return normalizeBeginningTriageState(state);
    }

    function flashBeginningTriageSaved() {
      if (!els.beginningTriagePanel) return;
      const card = els.beginningTriagePanel.querySelector(".beginning-triage-card");
      if (!card) return;
      const toast = globalScope.document.createElement("div");
      toast.className = "beginning-triage-toast";
      toast.textContent = "Saved";
      card.insertBefore(toast, card.firstChild);
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 850);
    }

    function updateBeginningTriageStage(container, stage, extra = {}) {
      const state = normalizeBeginningTriageState({ ...beginningTriageStateFromDom(container), ...extra, stage });
      const step = BEGINNING_TRIAGE_STEPS.find((item) => item.id === state.stage);
      state.status = state.stage === "not_started" ? "Not started" : step ? step.label : state.status;
      saveBeginningTriageState(state);
      renderBeginningTriageFromStorage();
      flashBeginningTriageSaved();
    }

    function updateBeginningTriageDraft(event) {
      const field = event.target.closest("[data-beginning-field]");
      if (!field || !els.beginningTriagePanel) return;
      const state = saveBeginningTriageState(beginningTriageStateFromDom(els.beginningTriagePanel));
      if (field.dataset.beginningField === "topicArea") {
        const prompt = els.beginningTriagePanel.querySelector("[data-beginning-handoff-prompt]");
        if (prompt) prompt.value = buildBeginningResearchHandoffPrompt(state.fields.topicArea);
      }
      renderCurrentFocusFallback(state);
    }

    function handleCurrentFocusClick(event) {
      const button = event.target.closest("[data-dashboard-action]");
      if (!button) return;
      if (button.dataset.dashboardAction === "open-beginning-triage") {
        event.preventDefault();
        if (els.beginningGroup) els.beginningGroup.open = true;
      }
      if (button.dataset.dashboardAction === "open-diagnostics") {
        event.preventDefault();
        if (els.diagnosticsGroup) els.diagnosticsGroup.open = true;
      }
    }

    function handleBeginningTriageClick(event) {
      const button = event.target.closest("[data-beginning-action]");
      if (!button || !els.beginningTriagePanel) return;
      event.preventDefault();
      const action = button.dataset.beginningAction;
      if (action === "reset") {
        const ok =
          !globalScope.confirm ||
          globalScope.confirm("Reset the beginning triage draft? This clears only vidtoolz-beginning-triage-v1.");
        if (ok) {
          if (storageAvailable() && globalScope.localStorage.removeItem) {
            globalScope.localStorage.removeItem(BEGINNING_TRIAGE_STORAGE_KEY);
          }
          renderBeginningTriageFromStorage();
        }
        return;
      }
      if (action === "start") {
        updateBeginningTriageStage(els.beginningTriagePanel, "topic", {
          decision: "",
          selectedCandidate: "",
          selectedPackage: "",
          status: "Topic Research",
        });
        return;
      }
      if (action === "research") {
        updateBeginningTriageStage(els.beginningTriagePanel, "candidates", { status: "Candidate Angles" });
        return;
      }
      if (action === "package") {
        updateBeginningTriageStage(els.beginningTriagePanel, "packaging", { status: "Packaging Drafts" });
        return;
      }
      if (action === "select-candidate") {
        updateBeginningTriageStage(els.beginningTriagePanel, "rough_idea", {
          selectedCandidate: button.dataset.beginningCandidate || "",
          status: "Rough Idea",
        });
        return;
      }
      if (action === "select-package") {
        updateBeginningTriageStage(els.beginningTriagePanel, "claim", {
          selectedPackage: button.dataset.beginningPackage || "",
          status: "Claim Triage",
        });
        return;
      }
      if (action === "goto") {
        updateBeginningTriageStage(els.beginningTriagePanel, button.dataset.beginningTarget || "idea");
        return;
      }
      if (action === "decide") {
        updateBeginningTriageStage(els.beginningTriagePanel, "next_action", {
          decision: button.dataset.beginningDecision || "",
          status: "Next action",
        });
        return;
      }
      if (action === "pause" || action === "rework" || action === "reject") {
        const decision = action === "pause" ? "Pause" : action === "rework" ? "Rework" : "Reject";
        updateBeginningTriageStage(els.beginningTriagePanel, "next_action", {
          decision,
          status: "Next action",
        });
      }
    }

    function loadPipelinePanels(activeRun) {
      // Pipeline Tracker
      const trackerContainer = doc.querySelector("#pipelineTrackerContainer");
      if (trackerContainer && globalScope.PipelineTracker) {
        if (activeRun) {
          globalScope.PipelineTracker.mount(trackerContainer, { runFolder: activeRun });
        } else {
          trackerContainer.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px;">No active run detected. Start or select a package run to see pipeline progress.</div>`;
        }
      }

      // Visual Beat Map
      const beatMapContainer = doc.querySelector("#visualBeatMapContainer");
      if (beatMapContainer && globalScope.VisualBeatMapPanel) {
        if (activeRun) {
          globalScope.VisualBeatMapPanel.mount(beatMapContainer, { runFolder: activeRun });
        } else {
          beatMapContainer.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px;">No active run. Select a package run to see its visual beat map.</div>`;
        }
      }

      // Media Gallery
      const galleryContainer = doc.querySelector("#mediaGalleryContainer");
      if (galleryContainer && globalScope.MediaGallery) {
        if (activeRun) {
          globalScope.MediaGallery.mount(galleryContainer, { runFolder: activeRun });
        } else {
          galleryContainer.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px;">No active run. Media gallery shows when a run is active.</div>`;
        }
      }

      // Friction Log
      const frictionContainer = doc.querySelector("#frictionLogPanel");
      if (frictionContainer && globalScope.FrictionLog) {
        if (activeRun) {
          globalScope.FrictionLog.mount(frictionContainer, { runFolder: activeRun });
        } else {
          frictionContainer.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px;">No active run. Friction log activates when a run is in progress.</div>`;
        }
      }

      // Workflow Wizard
      const wizardContainer = doc.querySelector("#workflowWizardContainer");
      if (wizardContainer && globalScope.WorkflowWizard) {
        if (activeRun) {
          globalScope.WorkflowWizard.mount(wizardContainer, { runFolder: activeRun });
        } else {
          wizardContainer.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px;">No active run. Start or select a package run for guided workflow.</div>`;
        }
      }

      // Job Progress (polls independently, no activeRun dependency)
      const jobProgressContainer = doc.querySelector("#jobProgressPanel");
      if (jobProgressContainer && globalScope.JobProgress) {
        globalScope.JobProgress.mount(jobProgressContainer);
      }
    }

    function renderIndexLoadingSkeleton() {
      const card = `<div class="skeleton-card"><div class="skeleton-line"></div><div class="skeleton-line medium"></div><div class="skeleton-line short"></div></div>`;
      return card + card + card;
    }

    function renderPanelLoadingSkeleton() {
      return `<div class="skeleton-card"><div class="skeleton-line"></div><div class="skeleton-line medium"></div></div>`;
    }

    function renderFetchError(message, retryAction) {
      return `<div class="fetch-error-recovery"><p class="fetch-error-msg">${escapeHtml(message)}</p><button type="button" class="retry-btn" data-retry-load="${escapeHtml(retryAction)}">Retry</button></div>`;
    }

    function apiFetch(url, options) {
      return fetch(url, options).then((response) =>
        response.json().then((json) => {
          if (!response.ok) {
            throw new Error(json.error || `Request failed (${response.status})`);
          }
          return json.data !== undefined ? json.data : json;
        })
      );
    }

    function load() {
      renderBeginningTriageFromStorage();
      if (els.grid) els.grid.innerHTML = renderIndexLoadingSkeleton();
      showStatus("Loading package runs…", "");
      const warningTimeout = setTimeout(() => {
        showStatus("Taking longer than expected — check if the local server is running…", "");
      }, 8000);
      fetch("package-runs-index.json", { cache: "no-store" })
        .then((response) => {
          clearTimeout(warningTimeout);
          if (!response.ok) throw new Error(`Could not load package-runs-index.json (${response.status})`);
          return response.json();
        })
        .then((payload) => {
          index = normalizeIndex(payload);
          showStatus(`Loaded ${index.runs.length} package runs from package-runs-index.json.`, "success");
          render();
          loadLocalWriteConfig()
            .then(() => Promise.all([loadHyperframesLane(currentFocusedRun() ? currentFocusedRun().runId : ""), loadNextSafeActionPanel(), loadEvidenceIntakePanel(), loadMikkoInputConsole()]))
            .catch(() => Promise.all([loadNextSafeActionPanel(), loadEvidenceIntakePanel(), loadMikkoInputConsole()]));
        })
        .catch((error) => {
          clearTimeout(warningTimeout);
          showStatus(error.message, "error");
          els.grid.innerHTML = `<p class="muted">Run <code>node scripts/package-runs-index.js</code>, then serve this directory locally.</p>${renderFetchError(error.message, "index")}`;
        });
    }

    function loadEvidenceIntakePanel() {
      if (!els.evidenceIntakePanel) return Promise.resolve();
      els.evidenceIntakePanel.innerHTML = renderPanelLoadingSkeleton();
      const statusApi =
        localWriteConfig && localWriteConfig.evidenceIntakeStatusApi
          ? localWriteConfig.evidenceIntakeStatusApi
          : "/api/package-runs/evidence-intake/status";
      return apiFetch(statusApi, { cache: "no-store" })
        .then((payload) => {
          els.evidenceIntakePanel.innerHTML = renderEvidenceIntakePanel(payload);
        })
        .catch((error) => {
          els.evidenceIntakePanel.innerHTML = `<div class="evidence-intake-card"><p class="eyebrow">Evidence Intake</p><h2>Unavailable</h2><p class="muted">${escapeHtml(error.message)}</p>${renderFetchError(error.message, "evidence-intake")}</div>`;
        });
    }

    function loadNextSafeActionPanel() {
      if (!els.nextSafeActionPanel) return Promise.resolve();
      els.nextSafeActionPanel.innerHTML = renderPanelLoadingSkeleton();
      const nextSafeActionApi =
        localWriteConfig && localWriteConfig.roughCutInputConsole && localWriteConfig.roughCutInputConsole.nextSafeActionApi
          ? localWriteConfig.roughCutInputConsole.nextSafeActionApi
          : "/api/package-runs/next-safe-action";
      return apiFetch(nextSafeActionApi, { cache: "no-store" })
        .then((payload) => {
          els.nextSafeActionPanel.innerHTML = renderNextSafeActionPanel(payload);
          if (els.currentFocusContent) {
            els.currentFocusContent.outerHTML = renderCurrentFocus(payload, { beginningState: readBeginningTriageState(), index });
            els.currentFocusContent = doc.querySelector("#currentFocusContent");
            if (els.currentFocusContent) els.currentFocusContent.dataset.activeRunFocus = payload && payload.activeRun ? "true" : "false";
          }
          setDashboardMode(dashboardMode);
          loadPipelinePanels(payload && payload.activeRun ? payload.activeRun : "");
        })
        .catch((error) => {
          els.nextSafeActionPanel.innerHTML = `<div class="next-safe-action-card"><p class="eyebrow">NEXT SAFE ACTION</p><h2>Unavailable</h2><p class="muted">${escapeHtml(error.message)}</p>${renderFetchError(error.message, "next-safe-action")}</div>`;
        });
    }

    function setMikkoConsoleStatus(message, type = "") {
      if (!els.mikkoConsoleStatus) return;
      els.mikkoConsoleStatus.textContent = message;
      els.mikkoConsoleStatus.className = `lifecycle-badge ${type}`.trim();
    }

    function loadMikkoInputConsole() {
      if (!els.mikkoConsoleContent) return Promise.resolve();
      setMikkoConsoleStatus("Loading active run");
      els.mikkoConsoleContent.innerHTML = renderPanelLoadingSkeleton();
      const statusApi =
        localWriteConfig && localWriteConfig.roughCutInputConsole
          ? localWriteConfig.roughCutInputConsole.statusApi
          : "/api/package-runs/rough-cut/status";
      return apiFetch(statusApi, { cache: "no-store" })
        .then((payload) => {
          els.mikkoConsoleContent.innerHTML = renderMikkoInputConsole(payload);
          setMikkoConsoleStatus(payload.runId || "Active run loaded", "success");
        })
        .catch((error) => {
          els.mikkoConsoleContent.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>${renderFetchError(error.message, "mikko-console")}`;
          setMikkoConsoleStatus("Unavailable", "error");
        });
    }

    function loadLocalWriteConfig() {
      if (localWriteConfigPromise) return localWriteConfigPromise;
      localWriteConfigPromise = apiFetch("/api/package-engine/status", { cache: "no-store" })
        .then((payload) => {
          if (!payload.captureEvidenceWrite || !payload.captureEvidenceWrite.localWriteNonce) {
            throw new Error("Local write config unavailable. Copy buttons still work.");
          }
          localWriteConfig = {
            ...payload.captureEvidenceWrite,
            packageRunOpen: payload.packageRunOpen || {},
            hyperframes: payload.hyperframes || {},
            hyperframesAvailability: payload.hyperframes ? payload.hyperframes.availability : null,
            roughCutInputConsole: payload.roughCutInputConsole || {},
          };
          if (els.systemAvailabilityPanel) {
            els.systemAvailabilityPanel.innerHTML = renderSystemAvailabilityPanel(index, localWriteConfig);
          }
          return localWriteConfig;
        })
        .catch((error) => {
          localWriteConfig = null;
          localWriteConfigPromise = null;
          throw error;
        });
      return localWriteConfigPromise;
    }

    function currentFocusedRun() {
      return index.runs.find((run) => run.runId === selectedRunId) || findActiveRunFromIndex(index, "") || index.runs[0] || null;
    }

    function loadHyperframesLane(runId) {
      const run = index.runs.find((item) => item.runId === runId) || currentFocusedRun();
      if (!run || !run.runId || !els.videoRoomPanel) return Promise.resolve(null);
      return loadLocalWriteConfig()
        .then(() => {
          const hyperframesConfig = localWriteConfig && localWriteConfig.hyperframes ? localWriteConfig.hyperframes : {};
          const statusApi = hyperframesConfig.statusApi || "/api/hyperframes/status";
          return fetch(`${statusApi}?runId=${encodeURIComponent(run.runId)}`, { cache: "no-store" });
        })
        .then((response) => response.json().then((payload) => {
          if (!response.ok) throw new Error(payload.error || `HyperFrames status unavailable (${response.status}).`);
          run.hyperframes = payload;
          els.videoRoomPanel.innerHTML = renderVideoProjectRoom(run);
          return payload;
        }))
        .catch((error) => {
          run.hyperframes = {
            availability: localWriteConfig ? localWriteConfig.hyperframesAvailability : null,
            lane: { status: "unknown", compositionsCount: 0, manifestError: error.message },
            manifest: { compositions: [] },
          };
          els.videoRoomPanel.innerHTML = renderVideoProjectRoom(run);
          return null;
        });
    }

    function renderHyperframesComposition(button) {
      const runId = button.dataset.runId || "";
      const id = button.dataset.hyperframesRender || "";
      if (!runId || !id) return Promise.reject(new Error("HyperFrames render target is missing."));
      button.disabled = true;
      button.textContent = "Rendering...";
      return loadLocalWriteConfig()
        .then(() => {
          const hyperframesConfig = localWriteConfig && localWriteConfig.hyperframes ? localWriteConfig.hyperframes : {};
          const renderApi = hyperframesConfig.renderApi || "/api/hyperframes/render";
          const nonceHeader = hyperframesConfig.nonceHeader || localWriteConfig.nonceHeader || "x-vidtoolz-local-write-nonce";
          const localWriteNonce = hyperframesConfig.localWriteNonce || localWriteConfig.localWriteNonce || "";
          return fetch(renderApi, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              [nonceHeader]: localWriteNonce,
            },
            body: JSON.stringify({ runId, id, localWriteNonce }),
          });
        })
        .then((response) => response.json().then((payload) => {
          if (!response.ok) throw new Error(payload.error || `HyperFrames render failed (${response.status}).`);
          showStatus(`Rendered HyperFrames composition ${id}: ${payload.rendered_mp4}`, "success");
          return loadHyperframesLane(runId);
        }))
        .catch((error) => {
          showStatus(error.message, "error");
          return loadHyperframesLane(runId);
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
      els.previewContent.innerHTML = `<p class="muted">Could not load ${escapeHtml(href)}. ${escapeHtml(error.message)} The file may require serving this repo root with the local app server: <code>./scripts/serve-local.sh</code>.</p>`;
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

    function openPackageFolder(link) {
      const runId = link.dataset.openPackageFolder || "";
      const assetPath = link.dataset.openAssetPath || "";
      if (!runId) return Promise.reject(new Error("Package-run id is missing."));
      return loadLocalWriteConfig().then(() => {
        const openConfig = (localWriteConfig && localWriteConfig.packageRunOpen) || {};
        const openApi = openConfig.openApi || "/api/package-runs/open";
        const nonceHeader = openConfig.nonceHeader || localWriteConfig.nonceHeader || "x-vidtoolz-local-write-nonce";
        const localWriteNonce = openConfig.localWriteNonce || localWriteConfig.localWriteNonce || "";
        return fetch(openApi, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [nonceHeader]: localWriteNonce,
          },
          body: JSON.stringify({ runId, assetPath, localWriteNonce }),
        });
      }).then((response) => response.json().then((payload) => {
        if (!response.ok) throw new Error(payload.error || `Open folder failed (${response.status}).`);
        showStatus(`Opened OS folder: ${payload.opened}`, "success");
        return payload;
      }));
    }

    function handleGridClick(event) {
      const retryBtn = event.target.closest("[data-retry-load]");
      if (retryBtn) {
        event.preventDefault();
        const target = retryBtn.dataset.retryLoad;
        if (target === "index") load();
        else if (target === "evidence-intake") loadEvidenceIntakePanel();
        else if (target === "next-safe-action") loadNextSafeActionPanel();
        else if (target === "mikko-console") loadMikkoInputConsole();
        return;
      }
      const osFolder = event.target.closest("[data-open-package-folder]");
      if (osFolder) {
        event.preventDefault();
        openPackageFolder(osFolder).catch((error) => {
          showStatus(`${error.message} Falling back to browser folder view.`, "error");
          const href = osFolder.getAttribute("href");
          if (href && href !== "#") window.location.href = href;
        });
        return;
      }
      const evidencePreview = event.target.closest("[data-evidence-preview]");
      if (evidencePreview) {
        event.preventDefault();
        previewEvidenceIntake(evidencePreview);
        return;
      }
      const evidenceSave = event.target.closest("[data-evidence-save]");
      if (evidenceSave) {
        event.preventDefault();
        saveEvidenceIntake(evidenceSave);
        return;
      }
      const previewButton = event.target.closest("[data-capture-preview]");
      if (previewButton) {
        event.preventDefault();
        previewCaptureWrite(previewButton);
        return;
      }
      const applyButton = event.target.closest("[data-capture-apply]");
      if (applyButton) {
        event.preventDefault();
        applyCaptureWrite(applyButton);
        return;
      }
      const copyButton = event.target.closest("[data-copy-capture-row]");
      if (copyButton) {
        event.preventDefault();
        copyCaptureRow(copyButton);
        return;
      }
      const saveRoughCut = event.target.closest("[data-save-rough-cut-notes]");
      if (saveRoughCut) {
        event.preventDefault();
        saveRoughCutNotes(saveRoughCut);
        return;
      }
      const runRoughCut = event.target.closest("[data-run-rough-cut-review]");
      if (runRoughCut) {
        event.preventDefault();
        runRoughCutReview(runRoughCut);
        return;
      }
      const regenerateRoughCut = event.target.closest("[data-regenerate-rough-cut-derived]");
      if (regenerateRoughCut) {
        event.preventDefault();
        regenerateRoughCutDerived(regenerateRoughCut);
        return;
      }
      const openRoughCut = event.target.closest("[data-open-rough-cut]");
      if (openRoughCut) {
        event.preventDefault();
        openRoughCutVideo(openRoughCut);
        return;
      }
      const openMedia = event.target.closest("[data-open-media]");
      if (openMedia) {
        event.preventDefault();
        openMediaPath(openMedia);
        return;
      }
      const addPickup = event.target.closest("[data-add-pickup-item]");
      if (addPickup) {
        event.preventDefault();
        addPickupItem(addPickup);
        return;
      }
      const removePickup = event.target.closest("[data-remove-pickup-item]");
      if (removePickup) {
        event.preventDefault();
        removePickupItem(removePickup);
        return;
      }
      const savePickup = event.target.closest("[data-save-pickup-plan]");
      if (savePickup) {
        event.preventDefault();
        savePickupPlan(savePickup);
        return;
      }
      const previewSecondCutCandidate = event.target.closest("[data-preview-second-cut-candidate]");
      if (previewSecondCutCandidate) {
        event.preventDefault();
        previewSecondCutCandidateRegistration(previewSecondCutCandidate);
        return;
      }
      const applySecondCutCandidate = event.target.closest("[data-apply-second-cut-candidate]");
      if (applySecondCutCandidate) {
        event.preventDefault();
        applySecondCutCandidateRegistration(applySecondCutCandidate);
        return;
      }
      const saveSecondCutWatchNotes = event.target.closest("[data-save-second-cut-watch-notes]");
      if (saveSecondCutWatchNotes) {
        event.preventDefault();
        saveSecondCutHumanReviewNotes(saveSecondCutWatchNotes);
        return;
      }
      const regenerateSecondCutReview = event.target.closest("[data-regenerate-second-cut-review]");
      if (regenerateSecondCutReview) {
        event.preventDefault();
        regenerateSecondCutReviewDerived(regenerateSecondCutReview);
        return;
      }
      const previewFinalCandidate = event.target.closest("[data-preview-final-candidate]");
      if (previewFinalCandidate) {
        event.preventDefault();
        previewFinalCandidateRegistration(previewFinalCandidate);
        return;
      }
      const applyFinalCandidate = event.target.closest("[data-apply-final-candidate]");
      if (applyFinalCandidate) {
        event.preventDefault();
        applyFinalCandidateRegistration(applyFinalCandidate);
        return;
      }
      const saveFinalWatch = event.target.closest("[data-save-final-watch-notes]");
      if (saveFinalWatch) {
        event.preventDefault();
        saveFinalWatchNotes(saveFinalWatch);
        return;
      }
      const regenerateFinalReview = event.target.closest("[data-regenerate-final-review]");
      if (regenerateFinalReview) {
        event.preventDefault();
        regenerateFinalReviewDerived(regenerateFinalReview);
        return;
      }
      const previewExportMaster = event.target.closest("[data-preview-export-master]");
      if (previewExportMaster) {
        event.preventDefault();
        previewExportMasterRegistration(previewExportMaster);
        return;
      }
      const applyExportMaster = event.target.closest("[data-apply-export-master]");
      if (applyExportMaster) {
        event.preventDefault();
        applyExportMasterRegistration(applyExportMaster);
        return;
      }
      const saveDelivery = event.target.closest("[data-save-delivery-readiness]");
      if (saveDelivery) {
        event.preventDefault();
        saveDeliveryReadiness(saveDelivery);
        return;
      }
      const regenerateExport = event.target.closest("[data-regenerate-export-checklist]");
      if (regenerateExport) {
        event.preventDefault();
        regenerateExportChecklist(regenerateExport);
        return;
      }
      const link = event.target.closest("[data-preview-artifact]");
      if (!link) return;
      event.preventDefault();
      previewArtifact(link);
    }

    function captureValues(container) {
      const values = captureEvidenceInputDefaults();
      container.querySelectorAll("[data-capture-field]").forEach((input) => {
        values[input.dataset.captureField] = input.value;
      });
      return values;
    }

    function resetCaptureWriteState(container, message = "Preview required before Apply is enabled.") {
      container.dataset.capturePreviewToken = "";
      const applyButton = container.querySelector("[data-capture-apply]");
      if (applyButton) applyButton.disabled = true;
      const status = container.querySelector("[data-capture-write-status]");
      if (status) {
        status.textContent = message;
        status.className = "capture-write-status";
      }
    }

    function updateCaptureIntake(container) {
      const rows = formatCaptureEvidenceRows(captureValues(container));
      const validation = container.querySelector("[data-capture-validation]");
      if (validation) {
        validation.textContent = rows.valid
          ? "Rows include required concrete evidence fields. Paste them manually, rerun review, then approve only after human review."
          : `Missing required fields for real evidence: ${rows.missing.join(", ")}.`;
        validation.className = `capture-intake-validation ${rows.valid ? "valid" : "missing"}`;
      }
      Object.entries(rows).forEach(([key, value]) => {
        const output = container.querySelector(`[data-capture-output="${key}"]`);
        if (output) output.value = Array.isArray(value) ? value.join(", ") : String(value);
      });
      resetCaptureWriteState(container);
    }

    function captureWritePayload(container) {
      return {
        runId: container.dataset.runId || "",
        fields: captureValues(container),
        targets: ["takes-log.md", "screen-recording-checklist.md", "audio-capture-checklist.md"],
        localWriteNonce: localWriteConfig ? localWriteConfig.localWriteNonce : "",
      };
    }

    function renderCaptureWritePreview(response) {
      const sections = response.sections || {};
      return (response.targets || Object.keys(sections)).map((target) => [
        `## ${target}`,
        "",
        sections[target] || "",
      ].join("\n")).join("\n");
    }

    function setCaptureWriteStatus(container, message, type = "") {
      const status = container.querySelector("[data-capture-write-status]");
      if (status) {
        status.textContent = message;
        status.className = `capture-write-status ${type}`.trim();
      }
    }

    function evidenceIntakeValues(container) {
      const row = {};
      container.querySelectorAll("[data-evidence-field]").forEach((input) => {
        row[input.dataset.evidenceField] = input.value;
      });
      return [row];
    }

    function evidenceIntakePayload(container) {
      return {
        runId: container.dataset.runId || "",
        rows: evidenceIntakeValues(container),
        localWriteNonce: localWriteConfig ? localWriteConfig.localWriteNonce : "",
      };
    }

    function setEvidenceIntakeStatus(container, message, type = "") {
      const status = container.querySelector("[data-evidence-status]");
      if (status) {
        status.textContent = message;
        status.className = `evidence-write-status ${type}`.trim();
      }
    }

    function resetEvidenceIntakeState(container, message = "Preview required before Save is enabled.") {
      container.dataset.evidencePreviewToken = "";
      const saveButton = container.querySelector("[data-evidence-save]");
      if (saveButton) saveButton.disabled = true;
      setEvidenceIntakeStatus(container, message);
    }

    function renderEvidencePreviewPayload(payload) {
      const lines = [];
      if ((payload.warnings || []).length) {
        lines.push("Warnings:", ...payload.warnings.map((warning) => `- ${warning}`), "");
      }
      if ((payload.errors || []).length) {
        lines.push("Errors:", ...payload.errors.map((error) => `- ${error}`), "");
      }
      lines.push(payload.draftMarkdown || "");
      return lines.join("\n");
    }

    function previewEvidenceIntake(button) {
      const container = button.closest("[data-evidence-intake]");
      if (!container) return;
      const previewOutput = container.querySelector("[data-evidence-preview-output]");
      const saveButton = container.querySelector("[data-evidence-save]");
      button.disabled = true;
      setEvidenceIntakeStatus(container, "Previewing evidence-only draft. No files are being written.", "pending");
      loadLocalWriteConfig()
        .then((config) => fetch(config.evidenceIntakePreviewApi || "/api/package-runs/evidence-intake/preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [config.nonceHeader || "x-vidtoolz-local-write-nonce"]: config.localWriteNonce,
          },
          body: JSON.stringify(evidenceIntakePayload(container)),
        }))
        .then((response) => response.json().then((json) => {
          if (!response.ok) {
            const error = new Error(json.error || `Evidence intake preview failed (${response.status}).`);
            error.payload = json;
            throw error;
          }
          return normalizePayload(json);
        }))
        .then((payload) => {
          container.dataset.evidencePreviewToken = payload.previewToken || "";
          if (previewOutput) previewOutput.value = renderEvidencePreviewPayload(payload);
          if (saveButton) saveButton.disabled = !payload.previewToken;
          const warningText = (payload.warnings || []).length ? ` Warnings: ${payload.warnings.length}.` : "";
          setEvidenceIntakeStatus(container, `Preview ready.${warningText} Save writes only ${payload.targetFile || "capture-evidence-intake-log.md"}.`, "valid");
        })
        .catch((error) => {
          const payload = error.payload || {};
          resetEvidenceIntakeState(container, error.message);
          if (previewOutput) previewOutput.value = renderEvidencePreviewPayload(payload);
        })
        .finally(() => {
          button.disabled = false;
        });
    }

    function saveEvidenceIntake(button) {
      const container = button.closest("[data-evidence-intake]");
      if (!container) return;
      const previewToken = container.dataset.evidencePreviewToken || "";
      if (!previewToken) {
        resetEvidenceIntakeState(container);
        return;
      }
      button.disabled = true;
      setEvidenceIntakeStatus(container, "Saving evidence-only draft to the approved audit log.", "pending");
      loadLocalWriteConfig()
        .then((config) => fetch(config.evidenceIntakeSaveApi || "/api/package-runs/evidence-intake/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [config.nonceHeader || "x-vidtoolz-local-write-nonce"]: config.localWriteNonce,
          },
          body: JSON.stringify({
            ...evidenceIntakePayload(container),
            previewToken,
            confirmSave: true,
          }),
        }))
        .then((response) => response.json().then((json) => {
          if (!response.ok) throw new Error(json.error || `Evidence intake save failed (${response.status}).`);
          return normalizePayload(json);
        }))
        .then((payload) => {
          container.dataset.evidencePreviewToken = "";
          setEvidenceIntakeStatus(container, payload.warning || `Saved: ${(payload.written || []).join(", ")}`, "valid");
          button.disabled = true;
        })
        .catch((error) => {
          setEvidenceIntakeStatus(container, error.message, "missing");
          button.disabled = false;
        });
    }

    function previewCaptureWrite(button) {
      const container = button.closest("[data-capture-intake]");
      if (!container) return;
      updateCaptureIntake(container);
      const preview = container.querySelector("[data-capture-write-preview]");
      const applyButton = container.querySelector("[data-capture-apply]");
      button.disabled = true;
      setCaptureWriteStatus(container, "Previewing exact Markdown. No files are being written.", "pending");
      loadLocalWriteConfig()
        .then((config) => fetch(config.previewApi || "/api/package-runs/capture-evidence/preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [config.nonceHeader || "x-vidtoolz-local-write-nonce"]: config.localWriteNonce,
          },
          body: JSON.stringify(captureWritePayload(container)),
        }))
        .then((response) => response.json().then((json) => {
          if (!response.ok) throw new Error(json.error || `Preview failed (${response.status}).`);
          return normalizePayload(json);
        }))
        .then((payload) => {
          container.dataset.capturePreviewToken = payload.previewToken || "";
          if (preview) preview.value = renderCaptureWritePreview(payload);
          if (applyButton) applyButton.disabled = !payload.previewToken;
          setCaptureWriteStatus(container, "Preview ready. Review the Markdown before applying. Applying does not approve capture evidence.", "valid");
        })
        .catch((error) => {
          resetCaptureWriteState(container, error.message);
          if (preview) preview.value = "";
        })
        .finally(() => {
          button.disabled = false;
        });
    }

    function applyCaptureWrite(button) {
      const container = button.closest("[data-capture-intake]");
      if (!container) return;
      const previewToken = container.dataset.capturePreviewToken || "";
      if (!previewToken) {
        resetCaptureWriteState(container, "Preview required before Apply is enabled.");
        return;
      }
      button.disabled = true;
      setCaptureWriteStatus(container, "Applying marked sections to local run files.", "pending");
      loadLocalWriteConfig()
        .then((config) => fetch(config.applyApi || "/api/package-runs/capture-evidence/apply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [config.nonceHeader || "x-vidtoolz-local-write-nonce"]: config.localWriteNonce,
          },
          body: JSON.stringify({
            ...captureWritePayload(container),
            previewToken,
            confirmApply: true,
          }),
        }))
        .then((response) => response.json().then((json) => {
          if (!response.ok) throw new Error(json.error || `Apply failed (${response.status}).`);
          return normalizePayload(json);
        }))
        .then((payload) => {
          container.dataset.capturePreviewToken = "";
          setCaptureWriteStatus(
            container,
            `Applied locally to ${(payload?.written || []).join(", ")}${payload?.written?.length ? ". " : " (no files). "}Capture is not approved. Next: ${(payload?.nextCommands || []).join(" then ")}`,
            "valid"
          );
          button.disabled = true;
        })
        .catch((error) => {
          setCaptureWriteStatus(container, error.message, "missing");
          button.disabled = false;
        });
    }

    function copyText(text) {
      if (globalScope.navigator && globalScope.navigator.clipboard && globalScope.navigator.clipboard.writeText) {
        return globalScope.navigator.clipboard.writeText(text);
      }
      return Promise.reject(new Error("Clipboard API unavailable."));
    }

    function copyCaptureRow(button) {
      const container = button.closest("[data-capture-intake]");
      if (!container) return;
      updateCaptureIntake(container);
      const target = button.dataset.copyCaptureRow;
      const output = container.querySelector(`[data-capture-output="${target}"]`);
      const text = output ? output.value : "";
      copyText(text)
        .then(() => {
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 1200);
        })
        .catch(() => {
          button.textContent = "Select text";
          if (output) output.focus();
        });
    }

    function roughCutValues(container) {
      const values = roughCutInputDefaults();
      container.querySelectorAll("[data-rough-cut-field]").forEach((input) => {
        values[input.dataset.roughCutField] = input.value;
      });
      return values;
    }

    function setRoughCutStatus(container, message, type = "") {
      const status = container.querySelector("[data-rough-cut-status]");
      if (status) {
        status.textContent = message;
        status.className = `capture-write-status ${type}`.trim();
      }
    }

    function roughCutApiConfig() {
      const config = localWriteConfig && localWriteConfig.roughCutInputConsole ? localWriteConfig.roughCutInputConsole : {};
      return {
        saveApi: config.saveApi || "/api/package-runs/rough-cut/watch-notes",
        reviewApi: config.reviewApi || "/api/package-runs/rough-cut/review",
        regenerateDerivedApi: config.regenerateDerivedApi || "/api/package-runs/rough-cut/regenerate-derived",
        openApi: config.openApi || "/api/package-runs/rough-cut/open",
        pickupPlanSaveApi: config.pickupPlanSaveApi || "/api/package-runs/pickup-plan/save",
        secondCutCandidatePreviewApi: config.secondCutCandidatePreviewApi || "/api/package-runs/second-cut-candidate/preview",
        secondCutCandidateApplyApi: config.secondCutCandidateApplyApi || "/api/package-runs/second-cut-candidate/apply",
        secondCutWatchNotesSaveApi: config.secondCutWatchNotesSaveApi || "/api/package-runs/second-cut-watch-notes/save",
        secondCutReviewRegenerateApi: config.secondCutReviewRegenerateApi || "/api/package-runs/second-cut-review/regenerate-derived",
        finalCandidatePreviewApi: config.finalCandidatePreviewApi || "/api/package-runs/final-candidate/preview",
        finalCandidateApplyApi: config.finalCandidateApplyApi || "/api/package-runs/final-candidate/apply",
        finalWatchNotesSaveApi: config.finalWatchNotesSaveApi || "/api/package-runs/final-watch-notes/save",
        finalReviewRegenerateApi: config.finalReviewRegenerateApi || "/api/package-runs/final-review/regenerate-derived",
        exportMasterPreviewApi: config.exportMasterPreviewApi || "/api/package-runs/export-master/preview",
        exportMasterApplyApi: config.exportMasterApplyApi || "/api/package-runs/export-master/apply",
        deliveryReadinessSaveApi: config.deliveryReadinessSaveApi || "/api/package-runs/delivery-readiness/save",
        exportChecklistRegenerateApi: config.exportChecklistRegenerateApi || "/api/package-runs/export-checklist/regenerate-derived",
        nonceHeader: config.nonceHeader || "x-vidtoolz-local-write-nonce",
        localWriteNonce: config.localWriteNonce || (localWriteConfig ? localWriteConfig.localWriteNonce : ""),
      };
    }

    function roughCutRequest(api, body) {
      return loadLocalWriteConfig().then(() => {
        const config = roughCutApiConfig();
        return fetch(api(config), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [config.nonceHeader]: config.localWriteNonce,
          },
          body: JSON.stringify({ ...body, localWriteNonce: config.localWriteNonce }),
        });
      }).then((response) => response.json().then((payload) => {
        if (!response.ok) throw new Error(payload.error || `Rough-cut request failed (${response.status}).`);
        return payload;
      }));
    }

    function saveRoughCutNotes(button) {
      const container = button.closest("[data-rough-cut-console]");
      if (!container) return;
      button.disabled = true;
      setRoughCutStatus(container, "Saving rough-cut-watch-notes.md.", "pending");
      roughCutRequest((config) => config.saveApi, {
        runId: container.dataset.runId || "",
        fields: roughCutValues(container),
      })
        .then((payload) => {
          setRoughCutStatus(container, payload.warning || "Watch notes saved.", "valid");
          const runButton = container.querySelector("[data-run-rough-cut-review]");
          if (runButton) runButton.disabled = false;
        })
        .catch((error) => setRoughCutStatus(container, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function runRoughCutReview(button) {
      const container = button.closest("[data-rough-cut-console]");
      if (!container) return;
      button.disabled = true;
      setRoughCutStatus(container, "Running rough-cut review script.", "pending");
      roughCutRequest((config) => config.reviewApi, {
        runId: container.dataset.runId || "",
      })
        .then((payload) => {
          setRoughCutStatus(container, `Review complete: ${payload?.review?.roughCutReviewStatus || "unknown"}.`, "valid");
          const result = container.querySelector("[data-rough-cut-result]");
          if (result) result.innerHTML = renderRoughCutResult(payload);
        })
        .catch((error) => setRoughCutStatus(container, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function regenerateRoughCutDerived(button) {
      const container = button.closest("[data-rough-cut-console]");
      if (!container) return;
      button.disabled = true;
      setRoughCutStatus(container, "Regenerating derived rough-cut review artifacts only.", "pending");
      roughCutRequest((config) => config.regenerateDerivedApi, {
        runId: container.dataset.runId || "",
      })
        .then((payload) => {
          setRoughCutStatus(container, payload.warning || "Derived rough-cut artifacts regenerated.", "valid");
          const result = container.querySelector("[data-rough-cut-result]");
          if (result) result.innerHTML = renderRoughCutResult(payload);
        })
        .catch((error) => setRoughCutStatus(container, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function openRoughCutVideo(button) {
      const container = button.closest("[data-rough-cut-console]");
      if (!container) return;
      const values = roughCutValues(container);
      setRoughCutStatus(container, "Opening video in VLC.", "pending");
      roughCutRequest((config) => config.openApi, {
        runId: container.dataset.runId || "",
        filePath: values.reviewedFilePath,
      })
        .then((payload) => setRoughCutStatus(container, `Opened: ${payload.opened}`, "valid"))
        .catch((error) => setRoughCutStatus(container, error.message, "missing"));
    }

    function openMediaPath(button) {
      const container = button.closest("[data-rough-cut-console]");
      if (!container) return;
      setRoughCutStatus(container, "Opening media.", "pending");
      roughCutRequest((config) => config.openApi, {
        runId: container.dataset.runId || "",
        filePath: button.dataset.openMedia || "",
      })
        .then((payload) => setRoughCutStatus(container, `Opened: ${payload.opened}`, "valid"))
        .catch((error) => setRoughCutStatus(container, error.message, "missing"));
    }

    function pickupPlanStatusElement(container) {
      return container.querySelector("[data-pickup-plan-status]");
    }

    function setPickupPlanStatus(container, message, type = "") {
      const status = pickupPlanStatusElement(container);
      if (status) {
        status.textContent = message;
        status.className = `capture-write-status ${type}`.trim();
      }
    }

    function addPickupItem(button) {
      const panel = button.closest("[data-pickup-plan]");
      const list = panel ? panel.querySelector("[data-pickup-items]") : null;
      if (!list) return;
      list.insertAdjacentHTML("beforeend", renderPickupItemRow(list.querySelectorAll("[data-pickup-item]").length));
      setPickupPlanStatus(panel, "New item added as proposed until Mikko changes status.", "pending");
    }

    function removePickupItem(button) {
      const row = button.closest("[data-pickup-item]");
      const panel = button.closest("[data-pickup-plan]");
      if (row && !button.disabled) row.remove();
      if (panel) setPickupPlanStatus(panel, "Item removed locally. Save to write pickup files.", "pending");
    }

    function pickupPlanItems(panel) {
      return Array.from(panel.querySelectorAll("[data-pickup-item]")).map((row) => {
        const item = {};
        row.querySelectorAll("[data-pickup-field]").forEach((field) => {
          item[field.dataset.pickupField] = field.value;
        });
        return item;
      });
    }

    function savePickupPlan(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = button.closest("[data-pickup-plan]");
      if (!consoleEl || !panel) return;
      button.disabled = true;
      setPickupPlanStatus(panel, "Saving pickup-list.md and edit-fix-list.md only.", "pending");
      roughCutRequest((config) => config.pickupPlanSaveApi, {
        runId: consoleEl.dataset.runId || "",
        items: pickupPlanItems(panel),
      })
        .then((payload) => setPickupPlanStatus(panel, payload?.warning || `Saved: ${(payload?.written || []).join(", ")}`, "valid"))
        .catch((error) => setPickupPlanStatus(panel, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function secondCutCandidatePanel(button) {
      return button.closest("[data-second-cut-registration]");
    }

    function setSecondCutCandidateStatus(panel, message, type = "") {
      const status = panel ? panel.querySelector("[data-second-cut-candidate-status]") : null;
      if (status) {
        status.textContent = message;
        status.className = `capture-write-status ${type}`.trim();
      }
    }

    function secondCutCandidatePayload(consoleEl, panel) {
      return {
        runId: consoleEl.dataset.runId || "",
        candidatePath: panel.querySelector("[data-second-cut-candidate-path]")?.value || "",
        notes: panel.querySelector("[data-second-cut-candidate-notes]")?.value || "",
      };
    }

    function renderSecondCutCandidateMetadata(payload = {}) {
      const metadata = payload.metadata || {};
      const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
      return `<div class="lifecycle-review-grid">
        <div><span>Duration</span><strong>${escapeHtml(metadata.duration || "unavailable")}</strong></div>
        <div><span>Resolution</span><strong>${escapeHtml(metadata.resolution || "unavailable")}</strong></div>
        <div><span>Codec</span><strong>${escapeHtml(metadata.codec || "unavailable")}</strong></div>
        <div><span>Audio present</span><strong>${metadata.audioStreamPresent ? "yes" : "no/unknown"}</strong></div>
        <div><span>Size</span><strong>${escapeHtml(String(metadata.size || "unknown"))}</strong></div>
        <div><span>Modified</span><strong>${escapeHtml(metadata.modifiedTime || "unknown")}</strong></div>
      </div>${warnings.length ? `<div class="stale-derived-warning"><h4>Warnings</h4>${renderCompactList(warnings, "No warnings.")}</div>` : ""}`;
    }

    function previewSecondCutCandidateRegistration(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = secondCutCandidatePanel(button);
      if (!consoleEl || !panel) return;
      const preview = panel.querySelector("[data-second-cut-candidate-preview]");
      const applyButton = panel.querySelector("[data-apply-second-cut-candidate]");
      const metadata = panel.querySelector("[data-second-cut-candidate-metadata]");
      button.disabled = true;
      if (applyButton) applyButton.disabled = true;
      setSecondCutCandidateStatus(panel, "Previewing candidate registration. No files are being written.", "pending");
      roughCutRequest((config) => config.secondCutCandidatePreviewApi, secondCutCandidatePayload(consoleEl, panel))
        .then((payload) => {
          panel.dataset.secondCutCandidatePreviewValid = "yes";
          if (preview) preview.value = payload.artifactPreview || "";
          if (metadata) metadata.innerHTML = renderSecondCutCandidateMetadata(payload);
          if (applyButton) applyButton.disabled = false;
          setSecondCutCandidateStatus(panel, "Preview ready. Save writes only second-cut-candidate.md and does not approve anything.", "valid");
        })
        .catch((error) => {
          panel.dataset.secondCutCandidatePreviewValid = "";
          if (preview) preview.value = "";
          if (metadata) metadata.innerHTML = "";
          setSecondCutCandidateStatus(panel, error.message, "missing");
        })
        .finally(() => {
          button.disabled = false;
        });
    }

    function applySecondCutCandidateRegistration(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = secondCutCandidatePanel(button);
      if (!consoleEl || !panel) return;
      if (panel.dataset.secondCutCandidatePreviewValid !== "yes") {
        setSecondCutCandidateStatus(panel, "Preview required before saving second-cut-candidate.md.", "missing");
        return;
      }
      button.disabled = true;
      setSecondCutCandidateStatus(panel, "Saving second-cut-candidate.md only.", "pending");
      roughCutRequest((config) => config.secondCutCandidateApplyApi, secondCutCandidatePayload(consoleEl, panel))
        .then((payload) => {
          panel.dataset.secondCutCandidatePreviewValid = "";
          setSecondCutCandidateStatus(panel, payload?.warning || `Saved: ${(payload?.written || []).join(", ")}`, "valid");
        })
        .catch((error) => {
          setSecondCutCandidateStatus(panel, error.message, "missing");
          button.disabled = false;
        });
    }

    function secondCutHumanReviewPanel(button) {
      return button.closest("[data-second-cut-human-review]");
    }

    function setSecondCutHumanReviewStatus(panel, message, type = "") {
      const status = panel ? panel.querySelector("[data-second-cut-review-status]") : null;
      if (status) {
        status.textContent = message;
        status.className = `capture-write-status ${type}`.trim();
      }
    }

    function secondCutHumanReviewFields(panel) {
      const fields = {};
      panel.querySelectorAll("[data-second-cut-review-field]").forEach((field) => {
        fields[field.dataset.secondCutReviewField] = field.value;
      });
      return fields;
    }

    function saveSecondCutHumanReviewNotes(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = secondCutHumanReviewPanel(button);
      if (!consoleEl || !panel) return;
      button.disabled = true;
      setSecondCutHumanReviewStatus(panel, "Saving second-cut-watch-notes.md only.", "pending");
      roughCutRequest((config) => config.secondCutWatchNotesSaveApi, {
        runId: consoleEl.dataset.runId || "",
        fields: secondCutHumanReviewFields(panel),
      })
        .then((payload) => {
          setSecondCutHumanReviewStatus(panel, payload.warning || "Second-cut watch notes saved.", "valid");
          const regen = panel.querySelector("[data-regenerate-second-cut-review]");
          if (regen) regen.disabled = false;
        })
        .catch((error) => setSecondCutHumanReviewStatus(panel, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function regenerateSecondCutReviewDerived(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = secondCutHumanReviewPanel(button);
      if (!consoleEl || !panel) return;
      button.disabled = true;
      setSecondCutHumanReviewStatus(panel, "Regenerating second-cut-review.md only.", "pending");
      roughCutRequest((config) => config.secondCutReviewRegenerateApi, {
        runId: consoleEl.dataset.runId || "",
      })
        .then((payload) => setSecondCutHumanReviewStatus(panel, payload?.warning || `Second-cut review: ${payload?.review?.status || "unknown"}`, "valid"))
        .catch((error) => setSecondCutHumanReviewStatus(panel, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function finalWatchPanel(button) {
      return button.closest("[data-final-watch-review]");
    }

    function setFinalWatchStatus(panel, message, type = "") {
      const status = panel ? panel.querySelector("[data-final-watch-status]") : null;
      if (status) {
        status.textContent = message;
        status.className = `capture-write-status ${type}`.trim();
      }
    }

    function finalCandidatePayload(consoleEl, panel) {
      return {
        runId: consoleEl.dataset.runId || "",
        candidatePath: panel.querySelector("[data-final-candidate-path]")?.value || "",
        notes: panel.querySelector("[data-final-candidate-notes]")?.value || "",
      };
    }

    function finalWatchFields(panel) {
      const fields = {};
      panel.querySelectorAll("[data-final-watch-field]").forEach((field) => {
        fields[field.dataset.finalWatchField] = field.value;
      });
      return fields;
    }

    function previewFinalCandidateRegistration(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = finalWatchPanel(button);
      if (!consoleEl || !panel) return;
      const preview = panel.querySelector("[data-final-candidate-preview]");
      const applyButton = panel.querySelector("[data-apply-final-candidate]");
      const metadata = panel.querySelector("[data-final-candidate-metadata]");
      button.disabled = true;
      if (applyButton) applyButton.disabled = true;
      setFinalWatchStatus(panel, "Previewing final candidate registration. No files are being written.", "pending");
      roughCutRequest((config) => config.finalCandidatePreviewApi, finalCandidatePayload(consoleEl, panel))
        .then((payload) => {
          panel.dataset.finalCandidatePreviewValid = "yes";
          if (preview) preview.value = payload.artifactPreview || "";
          if (metadata) metadata.innerHTML = renderSecondCutCandidateMetadata(payload);
          if (applyButton && payload.upstream && payload.upstream.secondCutReady) applyButton.disabled = false;
          setFinalWatchStatus(panel, "Preview ready. Save writes only final-candidate.md and does not approve publishing.", "valid");
        })
        .catch((error) => {
          panel.dataset.finalCandidatePreviewValid = "";
          if (preview) preview.value = "";
          if (metadata) metadata.innerHTML = "";
          setFinalWatchStatus(panel, error.message, "missing");
        })
        .finally(() => {
          button.disabled = false;
        });
    }

    function applyFinalCandidateRegistration(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = finalWatchPanel(button);
      if (!consoleEl || !panel) return;
      if (panel.dataset.finalCandidatePreviewValid !== "yes") {
        setFinalWatchStatus(panel, "Preview required before saving final-candidate.md.", "missing");
        return;
      }
      button.disabled = true;
      setFinalWatchStatus(panel, "Saving final-candidate.md only.", "pending");
      roughCutRequest((config) => config.finalCandidateApplyApi, finalCandidatePayload(consoleEl, panel))
        .then((payload) => setFinalWatchStatus(panel, payload?.warning || `Saved: ${(payload?.written || []).join(", ")}`, "valid"))
        .catch((error) => {
          setFinalWatchStatus(panel, error.message, "missing");
          button.disabled = false;
        });
    }

    function saveFinalWatchNotes(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = finalWatchPanel(button);
      if (!consoleEl || !panel) return;
      button.disabled = true;
      setFinalWatchStatus(panel, "Saving final-watch-notes.md only.", "pending");
      roughCutRequest((config) => config.finalWatchNotesSaveApi, {
        runId: consoleEl.dataset.runId || "",
        fields: finalWatchFields(panel),
      })
        .then((payload) => {
          setFinalWatchStatus(panel, payload.warning || "Final-watch notes saved.", "valid");
          const regen = panel.querySelector("[data-regenerate-final-review]");
          if (regen) regen.disabled = false;
        })
        .catch((error) => setFinalWatchStatus(panel, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function regenerateFinalReviewDerived(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = finalWatchPanel(button);
      if (!consoleEl || !panel) return;
      button.disabled = true;
      setFinalWatchStatus(panel, "Regenerating final-review.md only.", "pending");
      roughCutRequest((config) => config.finalReviewRegenerateApi, {
        runId: consoleEl.dataset.runId || "",
      })
        .then((payload) => setFinalWatchStatus(panel, payload?.warning || `Final review: ${payload?.review?.status || "unknown"}`, "valid"))
        .catch((error) => setFinalWatchStatus(panel, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function exportDeliveryPanel(button) {
      return button.closest("[data-export-delivery-readiness]");
    }

    function setExportDeliveryStatus(panel, message, type = "") {
      const status = panel ? panel.querySelector("[data-export-delivery-status]") : null;
      if (status) {
        status.textContent = message;
        status.className = `capture-write-status ${type}`.trim();
      }
    }

    function exportMasterPayload(consoleEl, panel) {
      return {
        runId: consoleEl.dataset.runId || "",
        masterFilePath: panel.querySelector("[data-export-master-path]")?.value || "",
        exportPreset: panel.querySelector("[data-export-master-preset]")?.value || "",
      };
    }

    function deliveryReadinessFields(panel) {
      const fields = {
        masterFilePath: panel.querySelector("[data-export-master-path]")?.value || "",
      };
      panel.querySelectorAll("[data-delivery-field]").forEach((field) => {
        fields[field.dataset.deliveryField] = field.value;
      });
      return fields;
    }

    function previewExportMasterRegistration(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = exportDeliveryPanel(button);
      if (!consoleEl || !panel) return;
      const preview = panel.querySelector("[data-export-master-preview]");
      const applyButton = panel.querySelector("[data-apply-export-master]");
      const metadata = panel.querySelector("[data-export-master-metadata]");
      button.disabled = true;
      if (applyButton) applyButton.disabled = true;
      setExportDeliveryStatus(panel, "Previewing master-file manifest. No files are being written.", "pending");
      roughCutRequest((config) => config.exportMasterPreviewApi, exportMasterPayload(consoleEl, panel))
        .then((payload) => {
          panel.dataset.exportMasterPreviewValid = "yes";
          if (preview) preview.value = payload.artifactPreview || "";
          if (metadata) metadata.innerHTML = renderSecondCutCandidateMetadata(payload);
          if (applyButton && payload.upstream && payload.upstream.publishReady) applyButton.disabled = false;
          setExportDeliveryStatus(panel, "Preview ready. Save writes only master-file-manifest.md.", "valid");
        })
        .catch((error) => {
          panel.dataset.exportMasterPreviewValid = "";
          if (preview) preview.value = "";
          if (metadata) metadata.innerHTML = "";
          setExportDeliveryStatus(panel, error.message, "missing");
        })
        .finally(() => {
          button.disabled = false;
        });
    }

    function applyExportMasterRegistration(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = exportDeliveryPanel(button);
      if (!consoleEl || !panel) return;
      if (panel.dataset.exportMasterPreviewValid !== "yes") {
        setExportDeliveryStatus(panel, "Preview required before saving master-file-manifest.md.", "missing");
        return;
      }
      button.disabled = true;
      setExportDeliveryStatus(panel, "Saving master-file-manifest.md only.", "pending");
      roughCutRequest((config) => config.exportMasterApplyApi, exportMasterPayload(consoleEl, panel))
        .then((payload) => setExportDeliveryStatus(panel, payload?.warning || `Saved: ${(payload?.written || []).join(", ")}`, "valid"))
        .catch((error) => {
          setExportDeliveryStatus(panel, error.message, "missing");
          button.disabled = false;
        });
    }

    function saveDeliveryReadiness(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = exportDeliveryPanel(button);
      if (!consoleEl || !panel) return;
      button.disabled = true;
      setExportDeliveryStatus(panel, "Saving delivery artifacts only.", "pending");
      roughCutRequest((config) => config.deliveryReadinessSaveApi, {
        runId: consoleEl.dataset.runId || "",
        fields: deliveryReadinessFields(panel),
      })
        .then((payload) => {
          setExportDeliveryStatus(panel, payload?.warning || `Saved: ${(payload?.written || []).join(", ")}`, "valid");
          const regen = panel.querySelector("[data-regenerate-export-checklist]");
          if (regen) regen.disabled = false;
        })
        .catch((error) => setExportDeliveryStatus(panel, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function regenerateExportChecklist(button) {
      const consoleEl = button.closest("[data-rough-cut-console]");
      const panel = exportDeliveryPanel(button);
      if (!consoleEl || !panel) return;
      button.disabled = true;
      setExportDeliveryStatus(panel, "Regenerating export-checklist.md only.", "pending");
      roughCutRequest((config) => config.exportChecklistRegenerateApi, {
        runId: consoleEl.dataset.runId || "",
      })
        .then((payload) => setExportDeliveryStatus(panel, payload?.warning || `Export checklist: ${payload?.review?.status || "unknown"}`, "valid"))
        .catch((error) => setExportDeliveryStatus(panel, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function handleGridInput(event) {
      const evidenceInput = event.target.closest("[data-evidence-field]");
      if (evidenceInput) {
        const container = evidenceInput.closest("[data-evidence-intake]");
        if (container) resetEvidenceIntakeState(container, "Preview validates without writing. Save writes only the evidence intake audit log.");
        return;
      }
      const input = event.target.closest("[data-capture-field]");
      if (input) {
        const container = input.closest("[data-capture-intake]");
        if (container) updateCaptureIntake(container);
        return;
      }
      const secondCutInput = event.target.closest("[data-second-cut-candidate-path], [data-second-cut-candidate-notes]");
      if (secondCutInput) {
        const panel = secondCutInput.closest("[data-second-cut-registration]");
        if (panel) {
          panel.dataset.secondCutCandidatePreviewValid = "";
          const applyButton = panel.querySelector("[data-apply-second-cut-candidate]");
          if (applyButton) applyButton.disabled = true;
          setSecondCutCandidateStatus(panel, "Preview required before saving second-cut-candidate.md.");
        }
      }
      const finalInput = event.target.closest("[data-final-candidate-path], [data-final-candidate-notes]");
      if (finalInput) {
        const panel = finalInput.closest("[data-final-watch-review]");
        if (panel) {
          panel.dataset.finalCandidatePreviewValid = "";
          const applyButton = panel.querySelector("[data-apply-final-candidate]");
          if (applyButton) applyButton.disabled = true;
          setFinalWatchStatus(panel, "Preview required before saving final-candidate.md.");
        }
      }
      const exportInput = event.target.closest("[data-export-master-path], [data-export-master-preset]");
      if (exportInput) {
        const panel = exportInput.closest("[data-export-delivery-readiness]");
        if (panel) {
          panel.dataset.exportMasterPreviewValid = "";
          const applyButton = panel.querySelector("[data-apply-export-master]");
          if (applyButton) applyButton.disabled = true;
          setExportDeliveryStatus(panel, "Preview required before saving master-file-manifest.md.");
        }
      }
    }

    els.statusFilter.addEventListener("change", render);
    els.sort.addEventListener("change", render);
    els.grid.addEventListener("click", handleGridClick);
    els.grid.addEventListener("input", handleGridInput);
    if (els.mikkoConsoleContent) els.mikkoConsoleContent.addEventListener("click", handleGridClick);
    if (els.nextSafeActionPanel) els.nextSafeActionPanel.addEventListener("click", handleGridClick);
    if (els.evidenceIntakePanel) {
      els.evidenceIntakePanel.addEventListener("click", handleGridClick);
      els.evidenceIntakePanel.addEventListener("input", handleGridInput);
    }
    if (els.beginningTriagePanel) {
      els.beginningTriagePanel.addEventListener("click", handleBeginningTriageClick);
      els.beginningTriagePanel.addEventListener("input", updateBeginningTriageDraft);
    }
    doc.querySelectorAll("[data-dashboard-mode-button]").forEach((button) => {
      button.addEventListener("click", () => setDashboardMode(button.dataset.dashboardModeButton));
    });
    if (els.currentFocusPanel) els.currentFocusPanel.addEventListener("click", handleCurrentFocusClick);
    if (els.productionsOverview) {
      els.productionsOverview.addEventListener("click", (event) => {
        const button = event.target.closest("[data-focus-run]");
        if (!button) return;
        event.preventDefault();
        focusRun(button.dataset.focusRun);
      });
    }
    if (els.videoRoomPanel) {
      els.videoRoomPanel.addEventListener("click", (event) => {
        const button = event.target.closest("[data-hyperframes-render]");
        if (!button) return;
        event.preventDefault();
        renderHyperframesComposition(button);
      });
    }
    els.closePreview.addEventListener("click", () => {
      els.previewPanel.classList.add("hidden");
    });

    const galleryRefreshBtn = doc.querySelector("#mediaGalleryRefresh");
    if (galleryRefreshBtn) {
      galleryRefreshBtn.addEventListener("click", () => {
        const galleryContainer = doc.querySelector("#mediaGalleryContainer");
        if (galleryContainer && globalScope.MediaGallery && galleryContainer.dataset.runFolder) {
          globalScope.MediaGallery.mount(galleryContainer, { runFolder: galleryContainer.dataset.runFolder });
        }
      });
    }

    setDashboardMode("focus");

    // Auto-focus run if ?run= parameter is present
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const runId = urlParams.get('run');
      if (runId && index?.runs?.some(r => r.runId === runId)) {
        focusRun(runId);
      }
    } catch (_) {}

    return {
      load,
      render,
      previewArtifact,
      updateCaptureIntake,
      loadMikkoInputConsole,
      loadNextSafeActionPanel,
      loadEvidenceIntakePanel,
      renderBeginningTriageFromStorage,
      readBeginningTriageState,
      setDashboardMode,
      focusRun,
    };
  }

  const api = {
    STATUS_ORDER,
    WORKFLOW_FILTERS,
    BEGINNING_TRIAGE_STORAGE_KEY,
    EPISODE_FACTORY_STORAGE_KEY,
    BEGINNING_TRIAGE_STEPS,
    FILE_LABELS,
    escapeHtml,
    statusRank,
    normalizeIndex,
    filterAndSortRuns,
    statusClass,
    normalizeCreatorQaStatus,
    isCreatorQaBlocking,
    normalizeEvidenceGate,
    normalizeLifecycleGate,
    normalizeDetectedButNotTrusted,
    workflowBucketForStatus,
    fileHref,
    artifactLabelForFilename,
    renderFilePills,
    renderMarkdown,
    renderNextCommand,
    renderCreatorQaStatus,
    evidenceGateClass,
    renderEvidenceGate,
    renderStatusBadge,
    renderDetectedButNotTrusted,
    captureEvidenceStarterMarkdown,
    markdownCell,
    captureEvidenceInputDefaults,
    missingRequiredCaptureFields,
    formatCaptureEvidenceRows,
    renderCaptureEvidenceIntake,
    renderCaptureEvidencePanel,
    roughCutInputDefaults,
    renderActiveRunSummary,
    renderGateTimeline,
    renderProductionTimelineCockpit,
    renderProductionGps,
    renderSecondCutNextActionPacket,
    renderSecondCutInspector,
    renderSecondCutRegistrationPreflight,
    renderSecondCutCandidateRegistration,
    renderSecondCutHumanReview,
    renderFinalCandidateReview,
    renderExportDeliveryReadiness,
    renderRoughCutResultCard,
    renderPickupPlanGui,
    renderMediaPanel,
    renderMikkoInputConsole,
    renderRoughCutResult,
    renderLifecycleReviewPanel,
    renderRunCard,
    renderStats,
    renderWorkflowStats,
    renderCompactPipelineStrip,
    buildProductionAssetLedger,
    renderAssetLedger,
    renderVideoThumbnail,
    runConceptDescription,
    hyperframesAvailabilityLabel,
    renderHyperframesLane,
    renderVideoProjectRoom,
    buildSystemAvailability,
    renderSystemAvailabilityPanel,
    capabilityInventoryItems,
    renderCapabilityInventoryPanel,
    renderProductionCard,
    renderProductionsOverview,
    focusRunFolderForRun,
    PRODUCTION_BUCKETS,
    productionBucketForRun,
    groupRunsByProductionBucket,
    normalizeNextSafeAction,
    renderNextSafeActionPanel,
    findActiveRunFromIndex,
    buildSecondCutReadinessModel,
    buildCreatorCockpitPayload,
    renderCreatorCockpit,
    normalizeEvidenceIntake,
    normalizeEvidenceIntakeRow,
    renderEvidenceRows,
    renderEvidenceIntakePanel,
    renderCurrentFocus,
    normalizeDashboardMode,
    dashboardGroupOpenState,
    beginningTriageInitialState,
    normalizeBeginningTriageState,
    buildBeginningResearchHandoffPrompt,
    renderBeginningTriageStepper,
    renderBeginningTriageClaimMap,
    renderBeginningTriageCockpit,
    createBrowserApp,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.PackageRunsDashboard = api;
    createBrowserApp().load();
  }
})(typeof window !== "undefined" ? window : globalThis);
