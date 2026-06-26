(function packageEngineRun(globalScope) {
  "use strict";

  const DEFAULT_WORKFLOW_PATH = "/home/vidtoolz/hermes-organiser/brain/workflows/vidtoolz-package-engine.md";
  const RUNS_DIR = "package-runs";

  const CANDIDATE_SCHEMA_EXAMPLE = {
    project: "VIDTOOLZ Package Engine",
    generatedAt: "ISO-8601 timestamp",
    candidates: [
      {
        id: "pkg-001",
        packageNumber: 1,
        score: 0,
        recommendation: "Make | Maybe | Reject",
        proposedTitle: "",
        idea: "",
        thumbnailConcept: "",
        onThumbnailText: "",
        thumbnailImage: "",
        viewerPromise: "",
        targetViewer: "",
        productionDifficulty: "Low | Medium | High",
        mainRisk: "",
        shortsIdeas: ["", "", "", "", ""],
        why_this_matters_now: "",
        why_this_stays_relevant: "",
        why_this_fits_vidtoolz: "",
        why_vidtoolz_can_make_it_better: "",
        audience_demand_rationale: "",
        suggested_production_approach: "",
      },
    ],
  };

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function slugifyTopic(value) {
    const slug = cleanString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "untitled-package-run";
  }

  function dateString(date = new Date()) {
    if (typeof date === "string") {
      const match = date.match(/^(\d{4}-\d{2}-\d{2})/);
      if (match) return match[1];
      // Fall through to Date parsing for invalid strings
    }
    const parsed = new Date(date);
    return isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
  }

  function buildRunFolderName(topic, date = new Date()) {
    return `${dateString(date)}-${slugifyTopic(topic)}`;
  }

  function buildCandidateSchemaExample() {
    return JSON.parse(JSON.stringify(CANDIDATE_SCHEMA_EXAMPLE));
  }

  function buildPlaceholderCandidate(index) {
    return {
      id: `pkg-${String(index + 1).padStart(3, "0")}`,
      packageNumber: index + 1,
      score: 0,
      recommendation: "Maybe",
      proposedTitle: "",
      idea: "",
      thumbnailConcept: "",
      onThumbnailText: "",
      thumbnailImage: "",
      viewerPromise: "",
      targetViewer: "",
      productionDifficulty: "Medium",
      mainRisk: "",
      shortsIdeas: ["", "", "", "", ""],
      why_this_matters_now: "",
      why_this_stays_relevant: "",
      why_this_fits_vidtoolz: "",
      why_vidtoolz_can_make_it_better: "",
      audience_demand_rationale: "",
      suggested_production_approach: "",
    };
  }

  function buildPlaceholderCandidates(topic) {
    return {
      project: "VIDTOOLZ Package Engine",
      topic: cleanString(topic),
      generatedAt: "",
      candidates: Array.from({ length: 10 }, (_unused, index) => buildPlaceholderCandidate(index)),
    };
  }

  function buildGenerationPrompt({ topic, workflowText, workflowPath = DEFAULT_WORKFLOW_PATH }) {
    const focus = cleanString(topic) || "VIDTOOLZ next video package session";
    const workflow = cleanString(workflowText);
    const schema = JSON.stringify(buildCandidateSchemaExample(), null, 2);
    return `# VIDTOOLZ Package Engine Generation Prompt

Topic / session focus:

${focus}

Source workflow file:

${workflowPath}

## Instructions

Use the Hermes workflow below as the source instruction for this package generation session.

Generate exactly 10 ranked YouTube package candidates for VIDTOOLZ.

Output valid JSON only. Do not wrap the JSON in Markdown fences. Do not include commentary before or after the JSON.

If valid JSON cannot be produced, explain the problem instead of inventing invalid structure.

Do not create outlines, scripts, descriptions, chapters, pinned comments, publishing assets, or episode folders yet.

The output must match this package-candidates.json shape:

${schema}

Important output rules:
- Use exactly 10 objects in the candidates array.
- Use recommendation values only: Make, Maybe, Reject.
- Use productionDifficulty values only: Low, Medium, High.
- Score must be an integer from 0 to 100.
- shortsIdeas must contain exactly five strings.
- Fill every strategic field.
- Prefer specific, practical packages over broad generic ideas.
- Be critical. Reject weak ideas instead of flattering them.

## Hermes Workflow Content

${workflow}
`;
  }

  function buildNotesMarkdown(topic, runId, workflowPath = DEFAULT_WORKFLOW_PATH) {
    return `# Package Run Notes

- Run: ${runId}
- Topic / focus: ${cleanString(topic) || "Not specified."}
- Workflow source: ${workflowPath}

## Steps

1. Open generation-prompt.md.
2. Paste it into Hermes or ChatGPT.
3. Save the returned valid JSON as package-candidates.json in this folder.
4. Open the browser review UI with the run parameter.
5. Select one winning package.
6. Download selected-package.json or selected-package.md.

## Notes

- Do not create outlines or scripts until a winning package is selected.
- Do not create an Episode Factory episode automatically in v1.
`;
  }

  function selectedPackageFromJsonPayload(payload = {}) {
    const source = payload && typeof payload === "object" ? payload : {};
    const candidate = source.package && typeof source.package === "object" ? source.package : source;
    if (!candidate || typeof candidate !== "object") return null;
    const title = cleanString(candidate.proposedTitle || candidate.proposed_title || candidate.title);
    if (!title) return null;
    return candidate;
  }

  function selectedPackageMarkdownToText(markdown) {
    return cleanString(markdown);
  }

  function selectedPackageToMarkdown(packageData = {}) {
    const source = packageData && typeof packageData === "object" ? packageData : {};
    const lines = [
      `# Selected Package: ${cleanString(source.proposedTitle || source.proposed_title || source.title) || "Untitled package"}`,
      "",
      `- Package number: ${source.packageNumber || source.package_number || ""}`,
      `- Score: ${source.score === undefined ? "" : source.score}/100`,
      `- Recommendation: ${cleanString(source.recommendation)}`,
      `- Production difficulty: ${cleanString(source.productionDifficulty || source.production_difficulty)}`,
      "",
      "## Idea",
      "",
      cleanString(source.idea) || "Not specified.",
      "",
      "## Thumbnail Concept",
      "",
      cleanString(source.thumbnailConcept || source.thumbnail_concept) || "Not specified.",
      "",
      "## On-Thumbnail Text",
      "",
      cleanString(source.onThumbnailText || source.on_thumbnail_text || source.thumbnailText) || "Not specified.",
      "",
      "## Viewer Promise",
      "",
      cleanString(source.viewerPromise || source.viewer_promise) || "Not specified.",
      "",
      "## Target Viewer",
      "",
      cleanString(source.targetViewer || source.target_viewer) || "Not specified.",
      "",
      "## Main Risk",
      "",
      cleanString(source.mainRisk || source.main_risk) || "Not specified.",
    ];

    [
      "why_this_matters_now",
      "why_this_stays_relevant",
      "why_this_fits_vidtoolz",
      "why_vidtoolz_can_make_it_better",
      "audience_demand_rationale",
      "suggested_production_approach",
    ].forEach((field) => {
      lines.push("", `## ${field.replace(/_/g, " ")}`, "", cleanString(source[field]) || "Not specified.");
    });

    const shorts = Array.isArray(source.shortsIdeas) ? source.shortsIdeas
      : Array.isArray(source.shorts_ideas) ? source.shorts_ideas
      : [];
    lines.push("", "## Shorts Ideas", "");
    if (shorts.length) {
      shorts.slice(0, 5).forEach((item, index) => lines.push(`${index + 1}. ${cleanString(item)}`));
    } else {
      lines.push("1. Not specified.");
    }
    return `${lines.join("\n")}\n`;
  }

  function buildOutlinePrompt({ selectedPackageText, workflowText, workflowPath = DEFAULT_WORKFLOW_PATH, runId = "" }) {
    const selected = cleanString(selectedPackageText);
    const workflow = cleanString(workflowText);
    return `# VIDTOOLZ Package Engine Outline Prompt

Run:

${cleanString(runId) || "Not specified."}

Source workflow file:

${workflowPath}

## Task

Use the selected package and Hermes workflow below to generate exactly three structurally different YouTube script outlines for VIDTOOLZ.

The three outlines must be:

1. Practical tutorial / workflow version
2. Critical test / myth-busting version
3. Strategic framework / workflow architect version

Do not write the full script yet.
Do not create descriptions, chapters, pinned comments, Shorts scripts, or publishing assets yet.
Do not change the selected package unless you find a contradiction. If there is a contradiction, explain the issue first and then provide the closest safe outline options.

## VIDTOOLZ Positioning And Guardrails

- VIDTOOLZ = practical video creation in the AI era.
- Audience: serious solo creators adapting to AI.
- Tone: practical teacher with critical tester instincts.
- Avoid generic AI hype, shallow reaction content, and "make money with AI" framing.
- Judge AI/video tools by actual production usefulness.
- Keep the lasting value grounded in durable production principles.

## Package Verification Reminder

Before outlining, check:
- Can a non-expert understand the promise in three seconds?
- Does the title create a specific curiosity gap?
- Does the thumbnail concept communicate without needing the title?
- Is the promise practical rather than vague?
- Can VIDTOOLZ credibly make this better than generic AI/video channels?
- Can the first 30 seconds prove value quickly?
- Does the topic help serious solo creators adapt to AI?
- Does the idea have potential beyond one temporary trend?

If the package fails this gate, say so clearly before the outlines.

## Expected Outline Output Format

Use this format for each of the three outlines:

### Outline [number]: [Structure name]

**Thesis / angle:**

**Opening hook:**

**Viewer problem:**

**Promise setup:**

**Section-by-section structure:**
1.
2.
3.

**Suggested demonstrations or screen recordings:**

**Key production principle:**

**AI/tool evaluation moments:**

**Retention risks:**

**Ending / payoff:**

**Possible Shorts moments:**
1.
2.
3.
4.
5.

**Why this structure is strongest:**

**Why this structure is weakest:**

## Selected Package

${selected}

## Hermes Workflow Content

${workflow}
`;
  }

  function buildOutlinesPlaceholderMarkdown(runId = "") {
    return `# Outline Options

- Run: ${cleanString(runId) || "Not specified."}
- Status: Paste the generated three-outline response here.

## Outline 1: Practical tutorial / workflow version

Not generated yet.

## Outline 2: Critical test / myth-busting version

Not generated yet.

## Outline 3: Strategic framework / workflow architect version

Not generated yet.
`;
  }

  function buildFinalOutlinePlaceholderMarkdown(runId = "") {
    return `# Final Outline

- Run: ${cleanString(runId) || "Not specified."}
- Status: Choose or edit one outline here after reviewing outlines.md.

## Selected Structure

Not selected yet.

## Final Edited Outline

Not written yet.
`;
  }

  function buildScriptPrompt({ selectedPackageText, finalOutlineText, runId = "" }) {
    const selected = cleanString(selectedPackageText);
    const outline = cleanString(finalOutlineText);
    return `# VIDTOOLZ Package Engine Script Prep Prompt

Run:

${cleanString(runId) || "Not specified."}

## Task

Use the selected package summary and final outline below to prepare a reviewable VIDTOOLZ script draft.

Do not finalize packaging yet.
Do not create episode folders, descriptions, chapters, pinned comments, publishing assets, or production files.

## Packaging Verification Warning

Packaging still needs verification before finalization. Before treating this script as final, re-check the title, thumbnail, viewer promise, first-30-seconds proof, and factual claims against the Package Engine gate.

## Selected Package Summary

${selected || "Not specified."}

## Final Outline

${outline || "Not specified."}

## Viewer Promise

Restate the exact viewer promise in one concrete sentence before drafting. If the promise is unclear, flag it before writing the draft.

## Title / Thumbnail Assumptions

- Working title:
- Thumbnail concept:
- On-thumbnail text:
- Assumptions that must be verified:

## Hook Requirements

- Open with a specific viewer problem or stakes.
- Prove practical value quickly in the first 30 seconds.
- Avoid generic AI hype and broad creator advice.
- Make the viewer understand why this video is worth continuing.

## Demo Moments

List the screen recordings, tool tests, before/after moments, or practical demonstrations the script needs.

## Visual / B-roll Notes

Name useful screen captures, UI states, timeline shots, comparison frames, diagrams, or supporting visuals.

## Retention Beats

Add clear retention beats for the opening, each major section, and the ending payoff.

## CTA

Use one grounded CTA that fits the video promise. Do not interrupt the useful part of the video.

## Shorts Extraction Ideas

Identify five Shorts candidates from the strongest hook, demo, contrast, mistake, or payoff moments.

## Expected Script Draft Output

Write a reviewable draft with:

1. Hook
2. Promise setup
3. Main sections from the final outline
4. Demo and visual callouts inline
5. Retention beats inline
6. Ending payoff
7. CTA
8. Shorts extraction candidates
9. Open packaging or factual verification questions
`;
  }

  function firstFilled(...values) {
    return values.map(cleanString).find(Boolean) || "";
  }

  function textOrPlaceholder(value) {
    return cleanString(value) || "Not specified yet.";
  }

  function bulletBlock(value) {
    const text = cleanString(value);
    if (!text) return "- Not specified yet.";
    if (/^\s*[-*]\s+/m.test(text)) return text;
    return text
      .split(/\r?\n/)
      .map(cleanString)
      .filter(Boolean)
      .map((line) => `- ${line}`)
      .join("\n");
  }

  function indentedBlock(value) {
    const text = cleanString(value);
    if (!text) return "  - Not specified yet.";
    return text
      .split(/\r?\n/)
      .map(cleanString)
      .filter(Boolean)
      .map((line) => `  ${line}`)
      .join("\n");
  }

  function buildScriptStructureMarkdown({
    runId = "",
    researchGate = {},
    selectedPackageTitle = "",
    selectedPackageSource = "",
    packageData = {},
    researchSections = {},
    supplementalInputs = [],
  }) {
    const gate = researchGate && typeof researchGate === "object" ? researchGate : {};
    const pkg = packageData && typeof packageData === "object" ? packageData : {};
    const research = researchSections && typeof researchSections === "object" ? researchSections : {};
    const status = cleanString(gate.structureStatus) || "NEEDS RESEARCH";
    const gateStatus = cleanString(gate.status) || "missing";
    const reason = cleanString(gate.reason) || "Research sufficiency has not been approved.";
    const source = cleanString(gate.sourceFile) || "research-pack.md";
    const approval = gate.readyToDraft ? "yes" : "no";
    const title = firstFilled(selectedPackageTitle, pkg.proposedTitle, pkg.title);
    const packageSource = cleanString(selectedPackageSource) || "missing";
    const coreClaim = firstFilled(research.coreClaim, pkg.viewerPromise, pkg.idea);
    const targetViewer = firstFilled(research.targetViewer, pkg.targetViewer);
    const viewerProblem = firstFilled(research.viewerProblem, pkg.viewerProblem);
    const centralThesis = firstFilled(research.coreClaim, pkg.idea, pkg.viewerPromise);
    const productionApproach = firstFilled(pkg.suggestedProductionApproach, research.productionEvidenceNeeded);
    const supplementalLines = Array.isArray(supplementalInputs)
      ? supplementalInputs.map((input) => {
          const filename = cleanString(input && input.filename) || "unknown";
          const inputStatus = cleanString(input && input.status) || "missing";
          const excerpt = cleanString(input && input.excerpt);
          return `- ${filename}: ${inputStatus}${excerpt ? ` - ${excerpt}` : ""}`;
        })
      : [];
    const nextActions =
      status === "READY TO DRAFT"
        ? "- Draft from this structure, while keeping proof and source claims traceable.\n- Keep unresolved claims marked during drafting."
        : "- Resolve the research sufficiency gate before treating this as ready to draft.\n- Fill missing proof, examples, and source support.\n- Add explicit manual PASS only after review.";

    return `# Script Structure

- Run: ${cleanString(runId) || "Not specified."}
- Script structure status: ${status}
- Research gate status: ${gateStatus}
- Ready to draft: ${approval}
- Research source: ${source}
- Selected package: ${title || "Not specified yet."}
- Selected package source: ${packageSource}

## Research Gate Interpretation

${reason}

## Local Context Inputs

${supplementalLines.length ? supplementalLines.join("\n") : "- notes.md: missing\n- script-prompt.md: missing\n- final-outline.md: missing"}

## Drafting Boundary

- READY TO DRAFT requires an explicit research sufficiency PASS or equivalent manual approval marker.
- research-pack.md existing is not enough by itself.
- PARTIAL, BLOCKED, missing, or unreadable research gates must be treated as needing research.

## Working Title

${textOrPlaceholder(title)}

## Package Promise

${textOrPlaceholder(firstFilled(pkg.viewerPromise, research.coreClaim))}

## Target Viewer

${textOrPlaceholder(targetViewer)}

## Viewer Problem

${textOrPlaceholder(viewerProblem)}

## Central Thesis

${textOrPlaceholder(centralThesis)}

## What Must Be Proven

${bulletBlock(research.whatMustBeProven || coreClaim)}

## Proof Ladder

- Baseline claim to prove: ${textOrPlaceholder(coreClaim)}
- Viewer-visible proof needed: ${textOrPlaceholder(productionApproach)}
- Example support needed:
${indentedBlock(research.examplesNeeded)}
- Missing proof to resolve:
${indentedBlock(research.missingFacts)}

## Cold Open

- Start with the concrete viewer problem: ${textOrPlaceholder(viewerProblem)}
- Preview the proof object or test: ${textOrPlaceholder(productionApproach)}
- Avoid claiming the episode is ready to draft unless the research gate is PASS.

## Act Structure

### Act 1: setup / problem

- Establish who this is for: ${textOrPlaceholder(targetViewer)}
- Name the practical problem: ${textOrPlaceholder(viewerProblem)}
- State the thesis without overstating proof: ${textOrPlaceholder(centralThesis)}

### Act 2: evidence / examples

- Use examples or demos from the research pack:
${indentedBlock(research.examplesNeeded)}
- Show production-relevant evidence:
${indentedBlock(research.productionEvidenceNeeded)}
- Identify missing or weak evidence before drafting claims.

### Act 3: judgment / workflow / payoff

- Turn the evidence into a practical judgment or workflow.
- Pay off the promise: ${textOrPlaceholder(firstFilled(pkg.viewerPromise, research.coreClaim))}
- State remaining uncertainty if the research gate is not PASS.

## Beat-by-Beat Outline

1. Cold open: name the viewer problem and stakes.
2. Promise: state what the viewer should understand or be able to do.
3. Context: explain why this matters for the target viewer.
4. Evidence: show the strongest example, demo, screenshot, or source.
5. Contrast: show the weak example, objection, or failure mode.
6. Workflow: turn the evidence into a practical VIDTOOLZ method.
7. Judgment: explain what to do, what not to do, and where uncertainty remains.
8. Payoff: restate the practical outcome and next step.

## Required Examples / Demos / Screenshots

${bulletBlock(firstFilled(research.examplesNeeded, research.productionEvidenceNeeded, pkg.suggestedProductionApproach))}

## Viewer Objections to Answer

${bulletBlock(firstFilled(research.objections, pkg.mainRisk))}

## Retention Risks

- The video becomes generic if it does not show concrete examples or proof.
- The claim may feel unsupported if source gaps remain visible.
- The opening may feel abstract if the viewer problem is not shown quickly.
- Main package risk: ${textOrPlaceholder(pkg.mainRisk)}

## Unsupported or Risky Claims

${bulletBlock(firstFilled(research.missingFacts, pkg.mainRisk))}

## Ending / Payoff

- Return to the package promise: ${textOrPlaceholder(firstFilled(pkg.viewerPromise, research.coreClaim))}
- Show what the viewer should now decide, test, or change.
- If research is not PASS, end with the remaining proof question instead of overstating certainty.

## Script-Readiness Gate

- Status: ${status}
- Reason: ${reason}
- Ready to draft: ${approval}
- Next actions:
${indentedBlock(nextActions)}
`;
  }

  function buildScriptDraftPlaceholderMarkdown(runId = "") {
    return `# Script Draft

- Run: ${cleanString(runId) || "Not specified."}
- Status: Paste or write the first reviewable script draft here.

## Viewer Promise

Not drafted yet.

## Hook

Not drafted yet.

## Script Body

Not drafted yet.

## Demo / Visual Callouts

- Not drafted yet.

## Retention Beats

- Not drafted yet.

## CTA

Not drafted yet.

## Shorts Extraction Candidates

1. Not drafted yet.
2. Not drafted yet.
3. Not drafted yet.
4. Not drafted yet.
5. Not drafted yet.

## Open Verification Questions

- Packaging still needs verification before finalization.
`;
  }

  function buildFinalScriptPlaceholderMarkdown(runId = "") {
    return `# Final Script

- Run: ${cleanString(runId) || "Not specified."}
- Status: Edit the approved script draft here after review.

## Final Packaging Check

- [ ] Title and thumbnail assumptions verified.
- [ ] Viewer promise is specific and practical.
- [ ] Hook proves value quickly.
- [ ] Factual claims and tool behavior checked.
- [ ] Script is ready for production planning.

## Final Script

Not finalized yet.
`;
  }

  function buildProductionNotesPlaceholderMarkdown(runId = "") {
    return `# Production Notes

- Run: ${cleanString(runId) || "Not specified."}
- Status: Fill this during script review and pre-production.

## Shoot List

- Not prepared yet.

## Demo Moments

- Not prepared yet.

## Visual / B-roll Notes

- Not prepared yet.

## Retention Beats

- Not prepared yet.

## Shorts Extraction Ideas

1. Not prepared yet.
2. Not prepared yet.
3. Not prepared yet.
4. Not prepared yet.
5. Not prepared yet.

## Packaging Verification

- Packaging still needs verification before finalization.
`;
  }

  function productionContext(input = {}) {
    return {
      runId: cleanString(input.runId) || "Not specified.",
      selectedPackageText: cleanString(input.selectedPackageText) || "Not specified.",
      finalOutlineText: cleanString(input.finalOutlineText) || "Not specified.",
      finalScriptText: cleanString(input.finalScriptText) || "Not specified.",
      productionNotesText: cleanString(input.productionNotesText) || "No production-notes.md found.",
    };
  }

  function markdownTitle(markdown, fallback = "Untitled package") {
    const text = cleanString(markdown);
    const heading = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("# "));
    if (!heading) return fallback;
    return heading.replace(/^#\s+/, "").replace(/^Selected Package:\s*/i, "").trim() || fallback;
  }

  function extractRelevantLines(text, patterns, limit = 12) {
    const source = cleanString(text);
    if (!source) return [];
    const seen = new Set();
    const matches = [];
    source.split(/\r?\n/).forEach((line) => {
      const cleaned = line.replace(/^[-*]\s+/, "").trim();
      if (!cleaned || cleaned.length < 4 || cleaned.length > 220) return;
      if (!isUsableProductionTaskLine(cleaned)) return;
      if (!patterns.some((pattern) => pattern.test(cleaned))) return;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      matches.push(cleaned);
    });
    return matches.slice(0, limit);
  }

  function isUsableProductionTaskLine(line) {
    const cleaned = cleanString(line);
    const lower = cleaned.toLowerCase();
    if (!cleaned) return false;
    if (/^[-–]\s+/.test(cleaned)) return false;
    if (/^#{1,6}\s+/.test(cleaned)) return false;
    if (/^[-*]?\s*\[[ xX]\]/.test(cleaned)) return false;
    if (/^source files:?$/i.test(cleaned)) return false;
    if (/^run:|^status:/i.test(cleaned)) return false;
    if (/^\d+\.\s+\*\*[^*]+\*\*\s*$/i.test(cleaned)) return false;
    if (/not prepared yet|not specified|fill this|paste the generated/i.test(cleaned)) return false;
    if (/packaging still needs verification|before finalization/i.test(cleaned)) return false;
    if (/production prep v\d|generated locally|review before|review final/i.test(cleaned)) return false;
    if (/suggested demonstrations or screen recordings|visual\s*\/\s*b-roll notes|shoot list|demo moments/i.test(cleaned)) return false;
    if (/add exact screen recordings|add concrete screen captures/i.test(cleaned)) return false;
    if (/^[-*]?\s*(hook|promise setup|demo explanations|ending payoff|cta)$/i.test(cleaned)) return false;
    if (/workflow source|package verification reminder|expected outline output format/i.test(lower)) return false;
    return true;
  }

  function isConcreteCaptureTaskLine(line) {
    const cleaned = cleanString(line);
    const lower = cleaned.toLowerCase();
    if (!isUsableProductionTaskLine(cleaned)) return false;
    if (/^by the end\b|^you (will|can|should)\b|^you'll\b|^so you can\b/.test(lower)) return false;
    if (/^if you want\b|^try\b|subscribe|comment|like|download|grab|watch next/.test(lower)) return false;
    if (/^ask whether\b|^ask:\b|^the point is\b|^remember\b|^in short\b/.test(lower)) return false;
    if (/^\d+\.\s+/.test(cleaned)) return false;
    if (/^[-–]\s+/.test(cleaned)) return false;
    if (/^record the hook\b/.test(lower)) return false;
    return /\b(capture|screen recording|show on screen|table|comparison|before\/after|before and after|demo|visual|b-roll|screen capture)\b/.test(lower);
  }

  const AI_IDEA_FILTER_CAPTURE_TASKS = [
    "Capture AI tool generating 10 generic video ideas.",
    "Capture the four-part filter as a table: audience demand, expertise fit, production fit, better-than-competitors.",
    "Capture one weak AI idea being scored through the filter.",
    "Capture the weak idea being revised into a stronger package.",
    "Capture final title + thumbnail comparison.",
  ];

  function isAiIdeaFilterWorkflow(context = {}) {
    const text = [
      context.selectedPackageText,
      context.finalOutlineText,
      context.finalScriptText,
      context.productionNotesText,
    ].join("\n").toLowerCase();
    return (
      /\bai\b/.test(text) &&
      (/idea filter/.test(text) ||
        /generic video ideas/.test(text) ||
        /audience demand/.test(text) ||
        /expertise fit/.test(text) ||
        /production fit/.test(text) ||
        /better-than-competitors/.test(text))
    );
  }

  function mergeCaptureTasks(primaryTasks, extractedTasks, limit = 12) {
    const seen = new Set();
    return [...primaryTasks, ...extractedTasks]
      .map(cleanString)
      .filter(Boolean)
      .filter(isConcreteCaptureTaskLine)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  function markdownBulletList(items, fallback) {
    const cleanItems = Array.isArray(items) ? items.map(cleanString).filter(Boolean) : [];
    if (!cleanItems.length) return `- ${fallback}`;
    return cleanItems.map((item) => `- ${item}`).join("\n");
  }

  function buildProductionBriefMarkdown(input = {}) {
    const context = productionContext(input);
    const title = markdownTitle(context.selectedPackageText);
    const demoLines = extractRelevantLines(`${context.finalOutlineText}\n${context.finalScriptText}\n${context.productionNotesText}`, [
      /demo/i,
      /screen/i,
      /record/i,
      /show/i,
      /before/i,
      /after/i,
    ]);
    return `# Production Brief

- Run: ${context.runId}
- Working title: ${title}
- Status: Production Prep v1 generated locally. Review before shooting.

## Production Goal

Turn the approved final outline and final script into a practical YouTube shoot, edit, thumbnail, and publish package without creating an Episode Factory episode yet.

## Source Files

- selected-package.json or selected-package.md
- final-outline.md
- final-script.md
- production-notes.md if present

## Package Snapshot

${context.selectedPackageText}

## Production Approach

${markdownBulletList(demoLines, "Review final-outline.md, final-script.md, and production-notes.md, then define the concrete shoot and demo approach.")}

## Must-Prove Moments

- [ ] First 30 seconds proves the viewer promise quickly.
- [ ] Main demo or example is visible, concrete, and not just described.
- [ ] Title and thumbnail are still aligned with the final script.
- [ ] Claims that depend on current tool behavior have been checked manually.
- [ ] The ending delivers the promised practical payoff.

## Open Production Risks

- [ ] Any abstract section has a visual, demo, comparison, or concrete example.
- [ ] Any required screen recording can be captured cleanly.
- [ ] Any missing asset is named before editing starts.
`;
  }

  function buildShootingPlanMarkdown(input = {}) {
    const context = productionContext(input);
    const shootLines = extractRelevantLines(`${context.finalScriptText}\n${context.productionNotesText}`, [
      /shoot/i,
      /record/i,
      /camera/i,
      /a-roll/i,
      /voice/i,
      /screen/i,
      /demo/i,
    ]);
    const captureTasks = mergeCaptureTasks(isAiIdeaFilterWorkflow(context) ? AI_IDEA_FILTER_CAPTURE_TASKS : [], shootLines);
    return `# Shooting Plan

- Run: ${context.runId}
- Status: Production Prep v1 generated locally. Edit before recording.

## Pre-Shoot Setup

- [ ] Confirm final-script.md is the approved script.
- [ ] Confirm final-outline.md still matches the final script.
- [ ] Check microphone, screen recording settings, and project files.
- [ ] Prepare any browser tabs, app states, or sample files needed for demos.

## A-Roll / Voice Recording

- [ ] Hook
- [ ] Promise setup
- [ ] Section intros and transitions
- [ ] Demo explanations
- [ ] Ending payoff
- [ ] CTA

## Screen Recording / Demo Captures

${markdownBulletList(captureTasks, "Record the main screen demo, one concrete example, and a final comparison frame from the approved script.")}

## Pickup List

- [ ] Retake unclear hook line.
- [ ] Retake any section where the visual does not match the narration.
- [ ] Capture one clean thumbnail frame or source frame.
- [ ] Capture safety room tone or clean narration patch if needed.
`;
  }

  function buildBRollListMarkdown(input = {}) {
    const context = productionContext(input);
    const visualLines = extractRelevantLines(`${context.finalOutlineText}\n${context.finalScriptText}\n${context.productionNotesText}`, [
      /b-roll/i,
      /visual/i,
      /screen/i,
      /timeline/i,
      /ui/i,
      /comparison/i,
      /before/i,
      /after/i,
      /example/i,
    ]);
    const captureTasks = mergeCaptureTasks(isAiIdeaFilterWorkflow(context) ? AI_IDEA_FILTER_CAPTURE_TASKS : [], visualLines);
    return `# B-Roll List

- Run: ${context.runId}
- Status: Production Prep v1 generated locally.

## Required B-Roll

${markdownBulletList(captureTasks, "Capture the main visual example, comparison frame, and supporting screen states named by the approved script.")}

## Coverage Checklist

- [ ] Hook visual support
- [ ] Problem example
- [ ] Main demo or workflow
- [ ] Before/after or contrast moment
- [ ] Proof of final result
- [ ] Ending payoff visual

## Capture Notes

- [ ] Use readable zoom levels.
- [ ] Avoid private data and irrelevant browser clutter.
- [ ] Keep cursor movement deliberate.
- [ ] Name captured files clearly before editing.
`;
  }

  function buildGraphicsListMarkdown(input = {}) {
    const context = productionContext(input);
    const graphicsLines = extractRelevantLines(`${context.finalOutlineText}\n${context.finalScriptText}\n${context.productionNotesText}`, [
      /graphic/i,
      /diagram/i,
      /table/i,
      /score/i,
      /framework/i,
      /checklist/i,
      /title card/i,
      /lower third/i,
      /thumbnail/i,
    ]);
    return `# Graphics List

- Run: ${context.runId}
- Status: Production Prep v1 generated locally.

## Required Graphics

${markdownBulletList(graphicsLines, "Add diagrams, tables, labels, scorecards, lower thirds, and title cards needed by the edit.")}

## Standard Graphics Checklist

- [ ] Opening title or promise card if useful
- [ ] Section labels
- [ ] Framework or checklist graphic
- [ ] Before/after labels
- [ ] Key mistake or warning callout
- [ ] Final takeaway card

## Design Guardrails

- [ ] Text is readable on mobile.
- [ ] Graphics support the point instead of restating the full narration.
- [ ] Visual language matches VIDTOOLZ: practical, clean, non-hype.
`;
  }

  function buildResolveEditChecklistMarkdown(input = {}) {
    const context = productionContext(input);
    return `# Resolve Edit Checklist

- Run: ${context.runId}
- Status: Production Prep v1 generated locally.

## Ingest

- [ ] Create Resolve project.
- [ ] Import A-roll, screen recordings, B-roll, graphics, music, and thumbnail source frames.
- [ ] Rename bins clearly.
- [ ] Sync or align audio if needed.

## Rough Cut

- [ ] Build hook and first 30 seconds first.
- [ ] Remove weak setup and repeated points.
- [ ] Place demo footage where the script promises proof.
- [ ] Check pacing at each section transition.

## Visual Pass

- [ ] Add B-roll from b-roll-list.md.
- [ ] Add graphics from graphics-list.md.
- [ ] Add readable zooms or callouts for UI details.
- [ ] Check that visuals do not contradict narration.

## Audio / Color

- [ ] Dialogue is clear and consistent.
- [ ] Music, if used, stays below narration.
- [ ] Screen recordings and camera footage look consistent enough.
- [ ] Loudness and export settings are checked.

## Final Watchdown

- [ ] Viewer promise is delivered.
- [ ] Title and thumbnail still match the final video.
- [ ] No private data, dead air, or broken visual references remain.
- [ ] Export filename and version are clear.
`;
  }

  function buildThumbnailTitleCheckMarkdown(input = {}) {
    const context = productionContext(input);
    const title = markdownTitle(context.selectedPackageText);
    const thumbnailLines = extractRelevantLines(context.selectedPackageText, [/thumbnail/i, /title/i, /promise/i, /viewer/i, /risk/i], 10);
    return `# Thumbnail Title Check

- Run: ${context.runId}
- Working title: ${title}
- Status: Production Prep v1 generated locally.

## Source Package Signals

${markdownBulletList(thumbnailLines, "Review selected-package.json or selected-package.md for title, thumbnail, viewer promise, and main risk.")}

## Packaging Gate

- [ ] Title creates a specific curiosity gap.
- [ ] Thumbnail communicates the idea without needing the title.
- [ ] On-thumbnail text is short enough to read on mobile.
- [ ] Viewer promise is practical and specific.
- [ ] First 30 seconds proves the title/thumbnail promise.
- [ ] Final edit still matches the package.

## Working Options

1. Title:
   Thumbnail text:
   Thumbnail image:
2. Title:
   Thumbnail text:
   Thumbnail image:
3. Title:
   Thumbnail text:
   Thumbnail image:
`;
  }

  function buildPublishPackMarkdown(input = {}) {
    const context = productionContext(input);
    const shortsLines = extractRelevantLines(`${context.selectedPackageText}\n${context.finalScriptText}\n${context.productionNotesText}`, [
      /short/i,
      /hook/i,
      /mistake/i,
      /payoff/i,
      /before/i,
      /after/i,
    ]);
    return `# Publish Pack

- Run: ${context.runId}
- Status: Production Prep v1 generated locally. Fill after final edit.

## Video Metadata Draft

- Final title:
- Alternate title:
- Thumbnail file:
- Export file:
- Description draft:
- Pinned comment:

## Chapters

00:00 Hook

## Shorts Candidates

${markdownBulletList(shortsLines, "Add five Shorts candidates from the hook, strongest demo, mistake, contrast, or payoff moment.")}

## Publish Checklist

- [ ] Final export watched once before upload.
- [ ] Title and thumbnail checked against final edit.
- [ ] Description includes the practical viewer payoff.
- [ ] Chapters are accurate.
- [ ] Pinned comment is useful and not generic.
- [ ] Shorts candidates are named for later extraction.
- [ ] No Episode Factory episode folder was created automatically by this prep step.
`;
  }

  function candidateSourceFromRun(runId) {
    const cleaned = slugifyTopic(runId);
    return `${RUNS_DIR}/${cleaned}/package-candidates.json`;
  }

  function candidateSourceFromLocation(search) {
    const params = new URLSearchParams(search || "");
    const run = cleanString(params.get("run"));
    return run ? candidateSourceFromRun(run) : "package-candidates.json";
  }

  const api = {
    DEFAULT_WORKFLOW_PATH,
    RUNS_DIR,
    slugifyTopic,
    buildRunFolderName,
    buildCandidateSchemaExample,
    buildPlaceholderCandidates,
    buildGenerationPrompt,
    buildNotesMarkdown,
    selectedPackageFromJsonPayload,
    selectedPackageMarkdownToText,
    selectedPackageToMarkdown,
    buildOutlinePrompt,
    buildOutlinesPlaceholderMarkdown,
    buildFinalOutlinePlaceholderMarkdown,
    buildScriptPrompt,
    buildScriptStructureMarkdown,
    buildScriptDraftPlaceholderMarkdown,
    buildFinalScriptPlaceholderMarkdown,
    buildProductionNotesPlaceholderMarkdown,
    isUsableProductionTaskLine,
    isConcreteCaptureTaskLine,
    isAiIdeaFilterWorkflow,
    mergeCaptureTasks,
    buildProductionBriefMarkdown,
    buildShootingPlanMarkdown,
    buildBRollListMarkdown,
    buildGraphicsListMarkdown,
    buildResolveEditChecklistMarkdown,
    buildThumbnailTitleCheckMarkdown,
    buildPublishPackMarkdown,
    candidateSourceFromRun,
    candidateSourceFromLocation,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.PackageEngineRun = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
