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
    if (typeof date === "string") return date.slice(0, 10);
    return date.toISOString().slice(0, 10);
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

    const shorts = Array.isArray(source.shortsIdeas || source.shorts_ideas) ? source.shortsIdeas || source.shorts_ideas : [];
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
    candidateSourceFromRun,
    candidateSourceFromLocation,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.PackageEngineRun = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
