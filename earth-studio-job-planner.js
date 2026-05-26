(function earthStudioJobPlanner(globalScope) {
  "use strict";

  const DEFAULT_OUTPUT_DIR = "/home/vidtoolz/Videos/vidtoolz-earth-studio-jobs";
  const VERSION = "0.1.0";
  const FRAME_RATE = 30;
  const EXPECTED_FILES = [
    "README.md",
    "shot-plan.json",
    "shot-plan.md",
    "route.kml",
    "earth-studio-build-checklist.md",
  ];

  const LOCATION_FIXTURES = {
    "midtown manhattan": {
      name: "Midtown Manhattan",
      latitude: 40.7549,
      longitude: -73.984,
    },
    "downtown boston": {
      name: "Downtown Boston",
      latitude: 42.3555,
      longitude: -71.0565,
    },
  };

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function slugify(value) {
    const slug = cleanString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "earth-studio-job";
  }

  function normalizeLocationName(value) {
    return cleanString(value)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  }

  function resolveLocation(value) {
    const key = normalizeLocationName(value);
    if (!key || !LOCATION_FIXTURES[key]) return null;
    return { ...LOCATION_FIXTURES[key] };
  }

  function splitSegments(description) {
    return cleanString(description)
      .split(/\bthen\b|[,.]/i)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function extractDurationSeconds(text) {
    const match = cleanString(text).match(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|sec|s)\b/i);
    if (!match) return null;
    const duration = Number(match[1]);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  function removeDurationPhrase(text) {
    return cleanString(text)
      .replace(/\b(?:for|in)?\s*\d+(?:\.\d+)?\s*(?:seconds?|secs?|sec|s)\b/i, "")
      .trim();
  }

  function detectAction(text) {
    const lower = cleanString(text).toLowerCase();
    if (/\borbit(?:s|ing)?\b/.test(lower)) {
      return {
        action: "orbit",
        resolutionStatus: "manual_review",
        warning: "orbit is not supported by the v1 planner and must be planned manually.",
      };
    }
    if (/\b(?:hover|hovers|hold|stays over)\b/.test(lower)) {
      return { action: "hover", resolutionStatus: "parsed" };
    }
    if (/\b(?:move to|moves to|fly to|flies to|travel to)\b/.test(lower)) {
      return { action: "fly_to", resolutionStatus: "parsed" };
    }
    return {
      action: "unresolved",
      resolutionStatus: "manual_review",
      warning: "missing or unsupported camera action.",
    };
  }

  function extractLocationPhrase(text, action) {
    const withoutDuration = removeDurationPhrase(text);
    let match = null;
    if (action === "hover") {
      match = withoutDuration.match(/\b(?:hover|hovers|hold|stays over)\s+(?:over\s+|at\s+)?(.+)$/i);
    } else if (action === "fly_to") {
      match = withoutDuration.match(/\b(?:move to|moves to|fly to|flies to|travel to)\s+(.+)$/i);
    } else if (action === "orbit") {
      match = withoutDuration.match(/\borbit(?:s|ing)?\s+(?:around\s+|over\s+|at\s+)?(.+)$/i);
    }
    return match ? cleanString(match[1]) : "";
  }

  function frameForSeconds(seconds, frameRate = FRAME_RATE) {
    return Math.round(seconds * frameRate);
  }

  function parseSegment(text, segmentId, currentSeconds, frameRate = FRAME_RATE) {
    const warnings = [];
    const durationSeconds = extractDurationSeconds(text);
    const actionInfo = detectAction(text);
    if (actionInfo.warning) warnings.push(actionInfo.warning);
    if (durationSeconds === null) warnings.push("missing duration.");

    const locationPhrase = extractLocationPhrase(text, actionInfo.action);
    if (!locationPhrase) warnings.push("missing location.");
    const location = resolveLocation(locationPhrase);
    if (locationPhrase && !location) warnings.push(`unknown location fixture: ${locationPhrase}`);

    const startSeconds = currentSeconds;
    const effectiveDuration = durationSeconds || 0;
    const endSeconds = startSeconds + effectiveDuration;
    const hasManualWarning = warnings.length > 0 || actionInfo.resolutionStatus === "manual_review";

    return {
      segment: {
        segment_id: segmentId,
        source_text: cleanString(text),
        action: actionInfo.action === "orbit" ? "manual_review" : actionInfo.action,
        requested_action: actionInfo.action,
        location_name: location ? location.name : locationPhrase || "",
        location,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        duration_seconds: effectiveDuration,
        start_frame: frameForSeconds(startSeconds, frameRate),
        end_frame: frameForSeconds(endSeconds, frameRate),
        resolution_status: hasManualWarning ? "manual_review" : "resolved",
        warnings,
      },
      nextSeconds: endSeconds,
      warnings,
    };
  }

  function parseDescription(description, options = {}) {
    const frameRate = options.frameRate || FRAME_RATE;
    const parts = splitSegments(description);
    const warnings = [];
    const segments = [];
    let currentSeconds = 0;

    if (!parts.length) warnings.push("description did not contain any parseable segments.");

    parts.forEach((part, index) => {
      const parsed = parseSegment(part, index + 1, currentSeconds, frameRate);
      segments.push(parsed.segment);
      warnings.push(...parsed.warnings.map((warning) => `segment ${index + 1}: ${warning}`));
      currentSeconds = parsed.nextSeconds;
    });

    return {
      source_description: cleanString(description),
      parser_strategy: "offline_regex_with_manual_review_fallback",
      frame_rate: frameRate,
      frame_convention: {
        start_frame: "inclusive",
        end_frame: "exclusive",
      },
      total_duration_seconds: currentSeconds,
      total_frames: frameForSeconds(currentSeconds, frameRate),
      segments,
      unresolved_items: segments
        .filter((segment) => segment.resolution_status !== "resolved")
        .map((segment) => ({
          segment_id: segment.segment_id,
          source_text: segment.source_text,
          warnings: [...segment.warnings],
        })),
      warnings,
    };
  }

  function uniqueResolvedLocations(segments) {
    const locations = new Map();
    segments.forEach((segment) => {
      if (segment.location && segment.location.name) locations.set(segment.location.name, segment.location);
    });
    return Array.from(locations.values()).map((location) => ({
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      resolution_status: "resolved_fixture",
    }));
  }

  function buildShotPlan(jobName, description, generatedAt = new Date().toISOString()) {
    const parsed = parseDescription(description);
    return {
      job_name: cleanString(jobName) || "Earth_Studio_Job",
      version: VERSION,
      generated_at: generatedAt,
      source_description: parsed.source_description,
      parser_strategy: parsed.parser_strategy,
      frame_rate: parsed.frame_rate,
      frame_convention: parsed.frame_convention,
      total_duration_seconds: parsed.total_duration_seconds,
      total_frames: parsed.total_frames,
      locations: uniqueResolvedLocations(parsed.segments),
      segments: parsed.segments,
      unresolved_items: parsed.unresolved_items,
      manual_earth_studio_steps: [
        "Open Google Earth Studio manually.",
        "Create or open the project manually; this planner does not log in, automate a browser, or control Earth Studio.",
        "Use shot-plan.json coordinates as manual camera/search references.",
        "Use route.kml only as a placemark/path reference asset.",
        "Manually create, review, and adjust all camera keyframes.",
        "Render manually only after Mikko reviews the camera move.",
      ],
      warnings: [
        "KML is a reference asset only and does not create a finished Google Earth Studio camera animation.",
        "Placemark use as camera targets is unverified in v1; manually search or set camera targets from shot-plan.json if needed.",
        "This planner does not render video, manipulate .esp files, control Google Earth Studio, or approve footage.",
        "Technical planning artifacts are not creative approval, rights clearance, or package-run evidence approval.",
        ...parsed.warnings,
      ],
    };
  }

  function buildReadme(plan) {
    return `# ${plan.job_name}

Local Google Earth Studio planning artifacts for a supervised manual build.

## Purpose

This folder converts a constrained text description into reviewable planning files for Google Earth Studio. It is for planning only.

## Not For

- Google login
- Browser automation
- Earth Studio control
- Render automation
- .esp file manipulation
- Approval markers
- Package-run state

## Manual Use

1. Review \`shot-plan.json\` and \`shot-plan.md\`.
2. Open Google Earth Studio manually.
3. Search or enter coordinates manually from \`shot-plan.json\`.
4. Optionally import or reference \`route.kml\` as placemark/path context.
5. Manually create and review all camera keyframes.

KML is a reference asset only. It does not create a finished Google Earth Studio camera animation.
`;
  }

  function buildShotPlanMarkdown(plan) {
    const rows = plan.segments
      .map((segment) =>
        `| ${segment.segment_id} | ${segment.action} | ${segment.location_name || "manual review"} | ${segment.start_seconds}-${segment.end_seconds}s | ${segment.start_frame} | ${segment.end_frame} | ${segment.resolution_status} |`
      )
      .join("\n");
    const locations = plan.locations.length
      ? plan.locations.map((location) => `- ${location.name}: ${location.latitude}, ${location.longitude}`).join("\n")
      : "- none resolved";
    const unresolved = plan.unresolved_items.length
      ? plan.unresolved_items
          .map((item) => `- Segment ${item.segment_id}: ${item.warnings.join("; ")}`)
          .join("\n")
      : "- none";

    return `# Shot Plan: ${plan.job_name}

Total duration: ${plan.total_duration_seconds} seconds
Frame rate: ${plan.frame_rate} fps
Total frames: ${plan.total_frames}
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---|
${rows}

## Locations

${locations}

## Unresolved Warnings

${unresolved}

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in \`shot-plan.json\` for search or camera target reference.
- Use \`route.kml\` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
`;
  }

  function escapeXml(value) {
    return cleanString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function kmlCoordinate(location) {
    return `${location.longitude},${location.latitude},0`;
  }

  function buildKml(plan) {
    const placemarks = plan.locations
      .map(
        (location) => `    <Placemark>
      <name>${escapeXml(location.name)}</name>
      <Point><coordinates>${kmlCoordinate(location)}</coordinates></Point>
    </Placemark>`
      )
      .join("\n");
    const pathCoordinates = plan.segments
      .filter((segment) => segment.location)
      .map((segment) => kmlCoordinate(segment.location))
      .join("\n        ");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(plan.job_name)} route reference</name>
    <description>KML reference asset only. This does not create a finished Google Earth Studio camera animation.</description>
${placemarks}
    <Placemark>
      <name>${escapeXml(plan.job_name)} route path reference</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
        ${pathCoordinates}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`;
  }

  function buildChecklist(plan) {
    return `# Earth Studio Build Checklist

## Before Building

- [ ] Review \`shot-plan.json\`.
- [ ] Confirm all unresolved/manual-review warnings are acceptable or repaired manually.
- [ ] Confirm Downtown Boston coordinates are latitude 42.3555, longitude -71.0565.

## Manual Google Earth Studio Build

- [ ] Open Google Earth Studio manually.
- [ ] Create or open the project manually.
- [ ] Use coordinates from \`shot-plan.json\` for manual search/camera references.
- [ ] Treat \`route.kml\` as placemark/path reference only.
- [ ] Manually create keyframes for each segment.
- [ ] Confirm frame boundaries use start_frame inclusive and end_frame exclusive.

## Safety Boundary

- [ ] No Google login automation was used.
- [ ] No browser automation was used.
- [ ] No render automation was used.
- [ ] No .esp manipulation was used.
- [ ] No package-run state or approval markers were written.

This checklist is technical planning support only. It is not creative approval, rights clearance, render approval, or package-run evidence approval.
`;
  }

  function buildArtifacts(jobName, description, generatedAt) {
    const plan = buildShotPlan(jobName, description, generatedAt);
    return {
      "README.md": buildReadme(plan),
      "shot-plan.json": `${JSON.stringify(plan, null, 2)}\n`,
      "shot-plan.md": buildShotPlanMarkdown(plan),
      "route.kml": buildKml(plan),
      "earth-studio-build-checklist.md": buildChecklist(plan),
    };
  }

  function expectedFiles() {
    return [...EXPECTED_FILES];
  }

  function validateShotPlanPayload(payload) {
    const errors = [];
    [
      "job_name",
      "version",
      "generated_at",
      "source_description",
      "parser_strategy",
      "frame_rate",
      "frame_convention",
      "total_duration_seconds",
      "total_frames",
      "locations",
      "segments",
      "unresolved_items",
      "manual_earth_studio_steps",
      "warnings",
    ].forEach((key) => {
      if (!Object.hasOwn(payload || {}, key)) errors.push(`missing shot-plan field: ${key}`);
    });
    if (payload && payload.frame_rate !== FRAME_RATE) errors.push("frame_rate must be 30");
    if (payload && payload.frame_convention) {
      if (payload.frame_convention.start_frame !== "inclusive") errors.push("start_frame convention must be inclusive");
      if (payload.frame_convention.end_frame !== "exclusive") errors.push("end_frame convention must be exclusive");
    }
    if (!Array.isArray(payload && payload.segments) || payload.segments.length === 0) errors.push("segments must be populated");
    (payload && payload.segments || []).forEach((segment, index) => {
      ["segment_id", "action", "start_seconds", "end_seconds", "duration_seconds", "start_frame", "end_frame", "resolution_status"].forEach((key) => {
        if (!Object.hasOwn(segment, key)) errors.push(`segment ${index + 1} missing ${key}`);
      });
      if (segment.end_frame < segment.start_frame) errors.push(`segment ${index + 1} has invalid frame boundary`);
    });
    const downtown = (payload && payload.locations || []).find((location) => location.name === "Downtown Boston");
    if (downtown && (downtown.latitude !== 42.3555 || downtown.longitude !== -71.0565)) {
      errors.push("Downtown Boston coordinates must be 42.3555, -71.0565");
    }
    return errors;
  }

  const api = {
    DEFAULT_OUTPUT_DIR,
    VERSION,
    FRAME_RATE,
    LOCATION_FIXTURES,
    splitSegments,
    extractDurationSeconds,
    detectAction,
    extractLocationPhrase,
    resolveLocation,
    parseDescription,
    buildShotPlan,
    buildArtifacts,
    buildKml,
    buildShotPlanMarkdown,
    expectedFiles,
    validateShotPlanPayload,
    slugify,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.EarthStudioJobPlanner = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
