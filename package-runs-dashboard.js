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
  ];

  const FILE_LABELS = [
    ["package_candidates", "package-candidates.json", "Candidates"],
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
        const workflowBucket =
          qaBlocking ||
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
          creatorQaStatus,
          evidenceGate,
          lifecycleGate,
          workflowBucket,
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
          loadLocalWriteConfig().catch(() => {});
        })
        .catch((error) => {
          showStatus(error.message, "error");
          els.grid.innerHTML = `<p class="muted">Run <code>node scripts/package-runs-index.js</code>, then serve this directory locally.</p>`;
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
          localWriteConfig = payload.captureEvidenceWrite;
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

    function handleGridInput(event) {
      const input = event.target.closest("[data-capture-field]");
      if (!input) return;
      const container = input.closest("[data-capture-intake]");
      if (container) updateCaptureIntake(container);
    }

    els.statusFilter.addEventListener("change", render);
    els.sort.addEventListener("change", render);
    els.grid.addEventListener("click", handleGridClick);
    els.grid.addEventListener("input", handleGridInput);
    els.closePreview.addEventListener("click", () => {
      els.previewPanel.classList.add("hidden");
    });

    return { load, render, previewArtifact, updateCaptureIntake };
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
