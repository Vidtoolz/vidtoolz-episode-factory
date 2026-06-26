/**
 * VIDTOOLZ Guided Workflow Wizard
 * Reads pipeline status + next-safe-action and presents a single
 * "What to do now" card with step-by-step instructions.
 *
 * Mount: WorkflowWizard.mount(container, { runFolder })
 */
(function WorkflowWizardModule(globalScope) {
  "use strict";

  // Stage-specific guidance — what Mikko should do, what tools to use, what evidence to capture
  const STAGE_GUIDE = [
    {
      key: "idea",
      label: "Idea",
      title: "Define the video idea",
      steps: [
        "Write a one-sentence claim in idea.md",
        "Identify the target audience and platform (YouTube Short)",
        "Note the emotional hook — why someone would share this",
      ],
      tool: "Cockpit: Beginning Triage panel",
      evidence: "idea.md created in package-run folder",
    },
    {
      key: "research",
      label: "Research",
      title: "Gather evidence and sources",
      steps: [
        "Find 2-3 credible sources that support the claim",
        "Capture source URLs and key quotes in research-pack.md",
        "Identify the single strongest example to build the video around",
      ],
      tool: "ChatGPT or Hermes web_search",
      evidence: "research-pack.md with linked sources",
    },
    {
      key: "script",
      label: "Script",
      title: "Write the production script",
      steps: [
        "Draft script following: one claim, one example, one point",
        "Keep it under 250 words (1-3 min vertical 9:16)",
        "Mark [A-ROLL] for presenter segments and [B-ROLL] for generated visuals",
      ],
      tool: "ChatGPT drafting → Mikko editorial review",
      evidence: "script.md with A-roll/B-roll markers",
    },
    {
      key: "claims",
      label: "Claims Check",
      title: "Verify every factual claim",
      steps: [
        "Read through script and list every factual assertion",
        "Cross-check each against the research sources",
        "Flag any unsupported claims for revision or removal",
      ],
      tool: "Manual review with research-pack.md open",
      evidence: "claims-check passed marker in STATUS.md",
    },
    {
      key: "packaging",
      label: "Packaging",
      title: "Create title, thumbnail concept, and package metadata",
      steps: [
        "Write 3-5 title candidates (curiosity-driven, under 60 chars)",
        "Describe thumbnail concept in youtube-package.json",
        "Set target duration, aspect ratio (9:16), and platform",
      ],
      tool: "Cockpit: youtube-package.json editor",
      evidence: "youtube-package.json complete",
    },
    {
      key: "image-prompts",
      label: "Image Prompts",
      title: "Generate image prompts for B-roll backgrounds",
      steps: [
        "Review script B-roll markers",
        "Write FLUX prompts for each visual beat (image-prompts.json)",
        "Each prompt: subject, style, mood, composition for 9:16",
      ],
      tool: "Cockpit: Image Prompts Editor",
      evidence: "image-prompts.json validated",
    },
    {
      key: "image-gen",
      label: "Image Gen",
      title: "Generate FLUX background images",
      steps: [
        "Run FLUX batch generation from image-prompts.json",
        "Target: ~48s per image on vidnux RTX 5070 Ti",
        "Check output: images in package/images/flux-local/",
      ],
      tool: "vidnux ComfyUI (cockpit trigger)",
      evidence: "flux-generation-manifest.json present",
    },
    {
      key: "image-select",
      label: "Image Select",
      title: "Review and select best generated images",
      steps: [
        "Open AIGEN Review View (port 8099)",
        "For each prompt: select the best image or flag for regeneration",
        "Selected images move to staging for Wan2.2 video generation",
      ],
      tool: "AIGEN Review View on port 8099",
      evidence: "Selection confirmed in review-view",
    },
    {
      key: "video-gen",
      label: "Video Gen",
      title: "Generate B-roll video clips",
      steps: [
        "Queue selected images through Wan2.2 I2V on PRESTO (81 frames, ~12 min each)",
        "OR use Kling for specific shots (8s clips)",
        "Rename all outputs to ASCII-safe names (kling-setB2-01.mp4 format)",
      ],
      tool: "PRESTO ComfyUI or Kling web UI",
      evidence: "MP4 files in VIDNAS aigen production lanes",
    },
    {
      key: "a-roll",
      label: "A-Roll Record",
      title: "Record presenter A-roll (talking head)",
      steps: [
        "Set up OBS with green screen, camera, and mic",
        "Record presenter segments matching script A-roll markers",
        "Save to VIDNAS camera_originals, then approve Hermes to move to run folder",
      ],
      tool: "OBS on vidnux → VIDNAS camera_originals",
      evidence: "A-roll MP4 in package-run folder",
    },
    {
      key: "assembly",
      label: "Assembly Edit",
      title: "Assemble video in DaVinci Resolve",
      steps: [
        "Create new Resolve project, import A-roll + B-roll from VIDNAS",
        "Cut A-roll to script timing, place B-roll over marked sections",
        "Fix Kling 1916px height: scale or crop to 1920",
        "Add green screen keying, color match, audio levels",
        "Export H.264 1080x1920 30fps",
      ],
      tool: "DaVinci Resolve on vidnux/PRESTO",
      evidence: "Exported MP4 + rough-cut-watch-notes.md",
    },
    {
      key: "publish-gate",
      label: "Publish Gate",
      title: "Final review and packaging check",
      steps: [
        "Watch the exported video end-to-end",
        "Fill rough-cut-watch-notes.md with timestamps",
        "Run title/thumbnail through packaging gate",
        "Confirm all claims are still supported",
      ],
      tool: "Manual review + cockpit packaging gate",
      evidence: "Watch notes complete, packaging gate passed",
    },
    {
      key: "published",
      label: "Published",
      title: "Upload and publish to YouTube",
      steps: [
        "Upload to YouTube as Short (9:16, under 3 min)",
        "Set title, description, tags from youtube-package.json",
        "Set thumbnail",
        "Record YouTube URL in published-videos.json",
      ],
      tool: "YouTube Studio (Mikko)",
      evidence: "YouTube URL in published-videos.json",
    },
  ];

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function mount(container, opts) {
    if (!container) return;
    opts = opts || {};
    const runFolder = opts.runFolder || "";

    if (!runFolder) {
      container.innerHTML = `
        <div class="workflow-wizard-empty">
          <p class="eyebrow">Guided Workflow</p>
          <h2>No active run</h2>
          <p class="muted">Start or select a package run to see step-by-step guidance.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="workflow-wizard-loading" style="padding:20px;text-align:center;color:var(--muted);">
        Loading workflow guidance...
      </div>
    `;

    // Fetch pipeline status
    fetch(`/api/package-runs/pipeline-status?run=${encodeURIComponent(runFolder)}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const data = json.data !== undefined ? json.data : json;
        renderWizard(container, data, runFolder);
      })
      .catch((err) => {
        container.innerHTML = `
          <div class="workflow-wizard-error" style="padding:20px;color:var(--danger);">
            Failed to load workflow: ${escapeHtml(err.message)}
          </div>
        `;
      });
  }

  function renderWizard(container, data, runFolder) {
    const stages = data.stages || [];
    const currentStage = data.currentStage || 0;
    const guide = STAGE_GUIDE[currentStage] || STAGE_GUIDE[0];
    const nextGuide = STAGE_GUIDE[currentStage + 1];

    // Progress summary
    const completed = stages.filter((s) => s.completed).length;
    const total = stages.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    let html = '<div class="workflow-wizard">';

    // Header with progress
    html += `
      <div class="workflow-wizard-header">
        <div>
          <p class="eyebrow">Guided Workflow</p>
          <h2>${escapeHtml(guide.title)}</h2>
          <p class="muted">Stage ${currentStage + 1} of ${total}: ${escapeHtml(guide.label)}</p>
        </div>
        <div class="workflow-wizard-progress">
          <div class="workflow-progress-ring">
            <svg viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--panel-soft)" stroke-width="2" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--accent)" stroke-width="2"
                stroke-dasharray="${pct}, 100" stroke-dashoffset="25" transform="rotate(-90 18 18)" />
            </svg>
            <span class="workflow-progress-pct">${pct}%</span>
          </div>
        </div>
      </div>
    `;

    // Blocker alert
    if (data.blocker) {
      html += `
        <div class="workflow-wizard-blocker">
          <strong>Blocker detected:</strong> ${escapeHtml(data.blocker)}
        </div>
      `;
    }

    // Current stage steps
    html += '<div class="workflow-wizard-steps">';
    html += '<ol class="workflow-step-list">';
    guide.steps.forEach((step, i) => {
      html += `<li class="workflow-step">
        <span class="workflow-step-num">${i + 1}</span>
        <span class="workflow-step-text">${escapeHtml(step)}</span>
      </li>`;
    });
    html += '</ol>';
    html += '</div>';

    // Tool + evidence
    html += `
      <div class="workflow-wizard-meta">
        <div class="workflow-meta-item">
          <span class="workflow-meta-label">Tool</span>
          <strong>${escapeHtml(guide.tool)}</strong>
        </div>
        <div class="workflow-meta-item">
          <span class="workflow-meta-label">Evidence</span>
          <strong>${escapeHtml(guide.evidence)}</strong>
        </div>
      </div>
    `;

    // Next stage preview
    if (nextGuide) {
      html += `
        <div class="workflow-wizard-next">
          <span class="workflow-next-label">Next:</span>
          <span class="workflow-next-title">${escapeHtml(nextGuide.label)} — ${escapeHtml(nextGuide.title)}</span>
        </div>
      `;
    } else {
      html += `
        <div class="workflow-wizard-next workflow-wizard-done">
          <span>This is the final stage. Complete it to finish the production pipeline.</span>
        </div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;
  }

  globalScope.WorkflowWizard = { mount };
})(window);
