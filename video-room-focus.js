/*
  Video Room Focus Module
  Provides focused, actionable workspace for individual video projects.
  Hides noise, shows only what matters for the current run.
*/
window.VideoRoomFocus = (function () {
  const FOCUS_MODE = "video-room-focus";

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function enterFocusMode(run) {
    if (!run) return;

    // Add focus class to body
    document.body.classList.add(FOCUS_MODE);

    // Update URL hash for deep linking
    window.location.hash = `#video-room/${run.runId}`;

    // Hide non-essential panels
    hidePanels([
      "systemAvailabilityPanel",
      "capabilityInventoryPanel",
      "pipelineTrackerPanel",
      "visualBeatMapPanel",
      "frictionLogPanel",
      "workflowWizardPanel",
      "mediaGalleryPanel",
    ]);

    // Show only video room and next action
    showPanels(["videoRoomPanel", "runActionPanel"]);

    // Scroll video room into view
    const videoRoom = document.getElementById("videoRoomPanel");
    if (videoRoom) {
      videoRoom.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function exitFocusMode() {
    document.body.classList.remove(FOCUS_MODE);
    window.location.hash = "";

    // Restore all panels
    showPanels([
      "systemAvailabilityPanel",
      "capabilityInventoryPanel",
      "pipelineTrackerPanel",
      "visualBeatMapPanel",
      "frictionLogPanel",
      "workflowWizardPanel",
      "mediaGalleryPanel",
    ]);
  }

  function hidePanels(panelIds) {
    panelIds.forEach((id) => {
      const panel = document.getElementById(id);
      if (panel) panel.style.display = "none";
    });
  }

  function showPanels(panelIds) {
    panelIds.forEach((id) => {
      const panel = document.getElementById(id);
      if (panel) panel.style.display = "";
    });
  }

  function buildActionCard(run) {
    if (!run) return "";

    const status = run.status || "Unknown";
    const bucket = run.workflowBucket || "";
    const nextCmd = run.nextRecommendedCommand || "";
    const nextFile = run.nextExpectedFile || "";
    const missing = run.missingExpectedArtifacts || [];
    const blocked = run.conservativeBlockedActions || [];

    // Determine action type based on status
    let actionType = "manual-review";
    let actionLabel = "Manual review required";
    let actionDescription = "Inspect current gate and artifacts.";
    let isBlocking = false;
    let command = nextCmd;

    // Creator QA blocking
    if (run.creatorQaStatus && run.creatorQaStatus !== "PASS" && run.creatorQaStatus !== "not run") {
      actionType = "creator-qa";
      actionLabel = "Creator QA required";
      actionDescription = "Review creator-qa-report.md and repair package/script before shooting.";
      command = `node scripts/package-run-creator-qa.js package-runs/${run.runId}`;
      isBlocking = true;
    }
    // Research not done
    else if (status.includes("Research pack") || missing.includes("research-pack.md")) {
      actionType = "research";
      actionLabel = "Generate research pack";
      actionDescription = "Build research evidence for the video topic.";
      command = nextCmd || `node scripts/package-run-research-pack.js package-runs/${run.runId}`;
    }
    // Outline not done
    else if (status.includes("Outline") || missing.includes("final-outline.md")) {
      actionType = "outline";
      actionLabel = "Generate outline";
      actionDescription = "Create video structure and flow.";
      command = nextCmd || `node scripts/package-engine-new-outline.js package-runs/${run.runId}`;
    }
    // Script not done
    else if (status.includes("Script") || missing.includes("final-script.md")) {
      actionType = "script";
      actionLabel = "Generate script";
      actionDescription = "Write the full video script.";
      command = nextCmd || `node scripts/package-run-script.js package-runs/${run.runId}`;
    }
    // Production prep
    else if (status.includes("Production prep") || status.includes("Needs production")) {
      actionType = "production-prep";
      actionLabel = "Production preparation";
      actionDescription = "Complete production brief and planning.";
      command = nextCmd || "Review production-brief.md and production-plan.md";
    }
    // Ready to shoot
    else if (status === "Ready to shoot") {
      actionType = "shoot";
      actionLabel = "Ready to shoot";
      actionDescription = "Run creator QA check, then capture the video.";
      command = `node scripts/package-run-creator-qa.js package-runs/${run.runId}`;
    }
    // Has expected file
    else if (nextFile) {
      actionType = "next-artifact";
      actionLabel = "Next artifact";
      actionDescription = `Add ${nextFile} to move forward.`;
      command = nextCmd || `Create ${nextFile}`;
    }

    return `
      <div class="run-action-card" data-action-type="${escapeHtml(actionType)}">
        <div class="run-action-header">
          <h3>${escapeHtml(actionLabel)}</h3>
          ${isBlocking ? '<span class="blocking-badge">BLOCKING</span>' : ""}
        </div>


        <div class="run-action-description">
          ${escapeHtml(actionDescription)}
        </div>
        ${
          command
            ? `
          <div class="run-action-command">
            <code>${escapeHtml(command)}</code>
            <button type="button" class="copy-command-btn" data-command="${escapeHtml(command)}">Copy</button>
          </div>
        `
            : ""
        }
        ${
          missing.length > 0
            ? `
          <div class="run-action-missing">
            <strong>Missing artifacts:</strong>

              ${missing.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}

          </div>
        `
            : ""
        }
        ${
          blocked.length > 0
            ? `
          <div class="run-action-blocked">
            <strong>Blocked actions:</strong>

              ${blocked.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}

          </div>
        `
            : ""
        }
        <div class="run-action-footer">
          <button type="button" class="exit-focus-btn">Exit Video Room</button>
        </div>
      </div>
    `;
  }

  function renderRunActionPanel(run) {
    const panel = document.getElementById("runActionPanel");
    const content = document.getElementById("runActionContent");

    if (!panel || !content) return;

    const html = buildActionCard(run);
    content.innerHTML = html;
    panel.classList.remove("hidden");

    // Wire up copy button
    const copyBtn = content.querySelector(".copy-command-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const command = copyBtn.dataset.command;
        try {
          await navigator.clipboard.writeText(command);
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });
    }

    // Wire up exit button
    const exitBtn = content.querySelector(".exit-focus-btn");
    if (exitBtn) {
      exitBtn.addEventListener("click", exitFocusMode);
    }
  }

  function init() {
    // Check URL hash for deep linking
    const hash = window.location.hash;
    if (hash && hash.includes("#video-room/")) {
      const runId = hash.replace("#video-room/", "");
      // Run listing will handle focusing when it loads
      return runId;
    }
    return null;
  }

  return {
    enterFocusMode,
    exitFocusMode,
    buildActionCard,
    renderRunActionPanel,
    init,
  };
})();
