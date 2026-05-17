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
      ${status.productionGps ? renderProductionGps(status.productionGps) : ""}
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
      mikkoConsoleStatus: doc.querySelector("#mikkoConsoleStatus"),
      mikkoConsoleContent: doc.querySelector("#mikkoConsoleContent"),
    };
    let index = normalizeIndex({});
    let localWriteConfig = null;
    let localWriteConfigPromise = null;

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
          loadLocalWriteConfig().then(loadMikkoInputConsole).catch(() => loadMikkoInputConsole());
        })
        .catch((error) => {
          showStatus(error.message, "error");
          els.grid.innerHTML = `<p class="muted">Run <code>node scripts/package-runs-index.js</code>, then serve this directory locally.</p>`;
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
      const statusApi =
        localWriteConfig && localWriteConfig.roughCutInputConsole
          ? localWriteConfig.roughCutInputConsole.statusApi
          : "/api/package-runs/rough-cut/status";
      return fetch(statusApi, { cache: "no-store" })
        .then((response) => response.json().then((payload) => {
          if (!response.ok) throw new Error(payload.error || `Rough-cut console unavailable (${response.status}).`);
          return payload;
        }))
        .then((payload) => {
          els.mikkoConsoleContent.innerHTML = renderMikkoInputConsole(payload);
          setMikkoConsoleStatus(payload.runId || "Active run loaded", "success");
        })
        .catch((error) => {
          els.mikkoConsoleContent.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
          setMikkoConsoleStatus("Unavailable", "error");
        });
    }

    function loadLocalWriteConfig() {
      if (localWriteConfigPromise) return localWriteConfigPromise;
      localWriteConfigPromise = fetch("/api/package-engine/status", { cache: "no-store" })
        .then((response) => response.json().then((payload) => {
          if (!response.ok) throw new Error(payload.error || `Local write config unavailable (${response.status}).`);
          if (!payload.captureEvidenceWrite || !payload.captureEvidenceWrite.localWriteNonce) {
            throw new Error("Local write config unavailable. Copy buttons still work.");
          }
          localWriteConfig = {
            ...payload.captureEvidenceWrite,
            roughCutInputConsole: payload.roughCutInputConsole || {},
          };
          return localWriteConfig;
        }))
        .catch((error) => {
          localWriteConfig = null;
          localWriteConfigPromise = null;
          throw error;
        });
      return localWriteConfigPromise;
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

    function handleGridClick(event) {
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
        .then((response) => response.json().then((payload) => {
          if (!response.ok) throw new Error(payload.error || `Preview failed (${response.status}).`);
          return payload;
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
        .then((response) => response.json().then((payload) => {
          if (!response.ok) throw new Error(payload.error || `Apply failed (${response.status}).`);
          return payload;
        }))
        .then((payload) => {
          const commands = (payload.nextCommands || []).join(" then ");
          container.dataset.capturePreviewToken = "";
          setCaptureWriteStatus(
            container,
            `Applied locally to ${payload.written.join(", ")}. Capture is not approved. Next: ${commands}`,
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
          setRoughCutStatus(container, `Review complete: ${payload.review.roughCutReviewStatus || "unknown"}.`, "valid");
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
        .then((payload) => setPickupPlanStatus(panel, payload.warning || `Saved: ${payload.written.join(", ")}`, "valid"))
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
          setSecondCutCandidateStatus(panel, payload.warning || `Saved: ${payload.written.join(", ")}`, "valid");
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
        .then((payload) => setSecondCutHumanReviewStatus(panel, payload.warning || `Second-cut review: ${payload.review.status}`, "valid"))
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
        .then((payload) => setFinalWatchStatus(panel, payload.warning || `Saved: ${payload.written.join(", ")}`, "valid"))
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
        .then((payload) => setFinalWatchStatus(panel, payload.warning || `Final review: ${payload.review.status}`, "valid"))
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
        .then((payload) => setExportDeliveryStatus(panel, payload.warning || `Saved: ${payload.written.join(", ")}`, "valid"))
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
          setExportDeliveryStatus(panel, payload.warning || `Saved: ${payload.written.join(", ")}`, "valid");
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
        .then((payload) => setExportDeliveryStatus(panel, payload.warning || `Export checklist: ${payload.review.status}`, "valid"))
        .catch((error) => setExportDeliveryStatus(panel, error.message, "missing"))
        .finally(() => {
          button.disabled = false;
        });
    }

    function handleGridInput(event) {
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
    els.closePreview.addEventListener("click", () => {
      els.previewPanel.classList.add("hidden");
    });

    return { load, render, previewArtifact, updateCaptureIntake, loadMikkoInputConsole };
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
    renderProductionGps,
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
    createBrowserApp,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.PackageRunsDashboard = api;
    createBrowserApp().load();
  }
})(typeof window !== "undefined" ? window : globalThis);
