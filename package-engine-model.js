(function packageEngineModel(globalScope) {
  "use strict";

  const RECOMMENDATIONS = ["Make", "Maybe", "Reject"];
  const DIFFICULTIES = ["Low", "Medium", "High"];
  const STRATEGIC_FIELDS = [
    "why_this_matters_now",
    "why_this_stays_relevant",
    "why_this_fits_vidtoolz",
    "why_vidtoolz_can_make_it_better",
    "audience_demand_rationale",
    "suggested_production_approach",
  ];

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function cleanScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function normalizeRecommendation(value) {
    const text = cleanString(value).toLowerCase();
    return RECOMMENDATIONS.find((item) => item.toLowerCase() === text) || "Maybe";
  }

  function normalizeDifficulty(value) {
    const text = cleanString(value).toLowerCase();
    return DIFFICULTIES.find((item) => item.toLowerCase() === text) || "Medium";
  }

  function normalizeShortsIdeas(value) {
    const source = Array.isArray(value) ? value : [];
    const cleaned = source.map(cleanString).filter(Boolean).slice(0, 5);
    while (cleaned.length < 5) {
      cleaned.push("");
    }
    return cleaned;
  }

  function normalizePackageCandidate(input = {}, index = 0) {
    const source = input && typeof input === "object" ? input : {};
    const number = Number(source.packageNumber || source.package_number || index + 1);
    const candidate = {
      id: cleanString(source.id) || `pkg-${String(index + 1).padStart(3, "0")}`,
      packageNumber: Number.isFinite(number) && number > 0 ? Math.round(number) : index + 1,
      score: cleanScore(source.score),
      recommendation: normalizeRecommendation(source.recommendation),
      proposedTitle: cleanString(source.proposedTitle || source.proposed_title || source.title),
      idea: cleanString(source.idea),
      thumbnailConcept: cleanString(source.thumbnailConcept || source.thumbnail_concept),
      onThumbnailText: cleanString(source.onThumbnailText || source.on_thumbnail_text || source.thumbnailText),
      thumbnailImage: cleanString(source.thumbnailImage || source.thumbnail_image || source.thumbnailImagePath || source.thumbnail_image_path),
      viewerPromise: cleanString(source.viewerPromise || source.viewer_promise),
      targetViewer: cleanString(source.targetViewer || source.target_viewer),
      productionDifficulty: normalizeDifficulty(source.productionDifficulty || source.production_difficulty),
      mainRisk: cleanString(source.mainRisk || source.main_risk),
      shortsIdeas: normalizeShortsIdeas(source.shortsIdeas || source.shorts_ideas),
    };

    STRATEGIC_FIELDS.forEach((field) => {
      candidate[field] = cleanString(source[field]);
    });

    return candidate;
  }

  function normalizePackageCandidateSet(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const candidates = Array.isArray(source.candidates) ? source.candidates : Array.isArray(input) ? input : [];
    return {
      project: cleanString(source.project) || "VIDTOOLZ Package Engine",
      generatedAt: cleanString(source.generatedAt || source.generated_at),
      candidates: candidates.map(normalizePackageCandidate),
    };
  }

  function validatePackageCandidateSet(input = {}) {
    const normalized = normalizePackageCandidateSet(input);
    if (!normalized.candidates.length) {
      return { ok: false, error: "package-candidates.json must contain at least one candidate.", data: normalized };
    }
    const missingTitle = normalized.candidates.find((candidate) => !candidate.proposedTitle);
    if (missingTitle) {
      return { ok: false, error: `Candidate ${missingTitle.packageNumber} is missing proposedTitle.`, data: normalized };
    }
    return { ok: true, error: "", data: normalized };
  }

  function sortPackageCandidates(candidates = [], mode = "score-desc") {
    const sorted = (Array.isArray(candidates) ? candidates : []).map(normalizePackageCandidate);
    if (mode === "score-asc") {
      return sorted.sort((a, b) => a.score - b.score || a.packageNumber - b.packageNumber);
    }
    if (mode === "number") {
      return sorted.sort((a, b) => a.packageNumber - b.packageNumber);
    }
    return sorted.sort((a, b) => b.score - a.score || a.packageNumber - b.packageNumber);
  }

  function filterPackageCandidates(candidates = [], recommendation = "All") {
    const filter = cleanString(recommendation);
    if (!filter || filter === "All") return (Array.isArray(candidates) ? candidates : []).map(normalizePackageCandidate);
    const normalizedFilter = normalizeRecommendation(filter);
    return (Array.isArray(candidates) ? candidates : [])
      .map(normalizePackageCandidate)
      .filter((candidate) => candidate.recommendation === normalizedFilter);
  }

  function buildSelectedPackageJson(candidate, options = {}) {
    const normalized = normalizePackageCandidate(candidate);
    const source = options && typeof options === "object" ? options : {};
    const thumbnailImage = cleanString(source.thumbnailImage || normalized.thumbnailImage);
    const thumbnailCandidates = Array.isArray(source.thumbnailCandidates)
      ? source.thumbnailCandidates.map((item) => {
          if (!item || typeof item !== "object") return null;
          return {
            id: cleanString(item.id),
            label: cleanString(item.label),
            thumbnailImage: cleanString(item.thumbnailImage || item.thumbnail_image || item.thumbnailImagePath || item.thumbnail_image_path),
            prompt: cleanString(item.prompt),
            selected: Boolean(item.selected),
            creator: cleanString(item.creator),
          };
        }).filter(Boolean)
      : [];
    return {
      selectedAt: new Date().toISOString(),
      package: {
        ...normalized,
        thumbnailImage,
        thumbnailCandidates,
      },
    };
  }

  function labelFromSnake(value) {
    return value
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function markdownList(items = []) {
    const usable = items.map(cleanString).filter(Boolean);
    return usable.length ? usable.map((item) => `- ${item}`).join("\n") : "- Not specified.";
  }

  function buildSelectedPackageMarkdown(candidate) {
    const normalized = normalizePackageCandidate(candidate);
    const strategic = STRATEGIC_FIELDS.map(
      (field) => `## ${labelFromSnake(field)}\n\n${normalized[field] || "Not specified."}`
    ).join("\n\n");
    return `# Selected Package ${normalized.packageNumber}: ${normalized.proposedTitle || "Untitled package"}

- Score: ${normalized.score}/100
- Recommendation: ${normalized.recommendation}
- Production difficulty: ${normalized.productionDifficulty}

## Idea

${normalized.idea || "Not specified."}

## Thumbnail Concept

${normalized.thumbnailConcept || "Not specified."}

## On-Thumbnail Text

${normalized.onThumbnailText || "Not specified."}

## Viewer Promise

${normalized.viewerPromise || "Not specified."}

## Target Viewer

${normalized.targetViewer || "Not specified."}

## Main Risk

${normalized.mainRisk || "Not specified."}

## Shorts Ideas

${markdownList(normalized.shortsIdeas)}

${strategic}
`;
  }

  const api = {
    RECOMMENDATIONS,
    DIFFICULTIES,
    STRATEGIC_FIELDS,
    normalizePackageCandidate,
    normalizePackageCandidateSet,
    validatePackageCandidateSet,
    sortPackageCandidates,
    filterPackageCandidates,
    buildSelectedPackageJson,
    buildSelectedPackageMarkdown,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.PackageEngineModel = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
