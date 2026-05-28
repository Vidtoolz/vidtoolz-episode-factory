#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const DEFAULT_QUOTA_BUDGET = 650;
const DEFAULT_MAX_SEARCH_CALLS = 6;
const HARD_SEARCH_CALL_LIMIT = 8;
const REPORT_DIR = path.join("reports", "topic-scout");
const DEMO_LABEL = "DEMO / FIXTURE DATA — NOT LIVE YOUTUBE DATA";

const FORMATS = new Set(["Production Note", "Current Signal → Production Rule", "Micro Workflow Teardown"]);

const DEFAULT_PATTERNS = [
  {
    id: "ai-video-proof-boundary",
    query: "AI video proof boundary creator workflow",
    topicTitle: "AI video proof boundaries for creators",
    briefDescription: "A one-rule video on separating AI illustration from evidence in short-form production.",
    vidtoolzSpecificAngle: "Show a simple label decision tree for AI visuals in a VIDTOOLZ micro-video.",
    recommendedFormat: "Production Note",
    trustRisk: "medium",
    productionDifficulty: "low",
    suggestedTitle: "Do Not Let AI B-Roll Pretend To Be Proof",
    thumbnailText: "NOT PROOF",
    requiredVisuals: ["Mikko on camera", "one AI illustration labeled clearly", "one real screen recording or checklist", "final rule card"],
    whatMustNotBeImplied: "Do not imply an AI-generated visual proves a real-world product result, event, or user outcome.",
    scores: { trust: 92, authority: 88, usefulness: 90, feasibility: 92, view: 72 },
  },
  {
    id: "green-screen-ai-background",
    query: "green screen AI background video production workflow",
    topicTitle: "Green screen plus AI background without misleading viewers",
    briefDescription: "A practical rule for using AI backgrounds as setting, not proof.",
    vidtoolzSpecificAngle: "Show Mikko on green screen, then label the AI-generated background as production design.",
    recommendedFormat: "Micro Workflow Teardown",
    trustRisk: "medium",
    productionDifficulty: "medium",
    suggestedTitle: "The Safe Way To Use AI Backgrounds",
    thumbnailText: "AI SET?",
    requiredVisuals: ["green screen setup", "AI-generated background label", "before/after composite", "rule card"],
    whatMustNotBeImplied: "Do not imply Mikko visited a real location or captured real evidence if the background is generated.",
    scores: { trust: 88, authority: 84, usefulness: 86, feasibility: 78, view: 76 },
  },
  {
    id: "screen-recording-as-evidence",
    query: "screen recording evidence tutorial creator workflow",
    topicTitle: "Screen recording as the proof layer",
    briefDescription: "A short workflow teardown showing when real screen capture should replace decorative AI visuals.",
    vidtoolzSpecificAngle: "Compare a fake-looking visual plan with one actual screen recording and a claim boundary.",
    recommendedFormat: "Micro Workflow Teardown",
    trustRisk: "low",
    productionDifficulty: "low",
    suggestedTitle: "Use Screen Recording When Proof Matters",
    thumbnailText: "SHOW IT",
    requiredVisuals: ["real screen recording", "claim map card", "talking head", "proof boundary overlay"],
    whatMustNotBeImplied: "Do not imply the screen recording proves claims that are not visible in the capture.",
    scores: { trust: 95, authority: 90, usefulness: 88, feasibility: 90, view: 68 },
  },
  {
    id: "ai-tool-update-production-rule",
    query: "AI video tool update creator workflow rule",
    topicTitle: "Turn AI tool updates into durable production rules",
    briefDescription: "A current-signal video that avoids feature hype by extracting one reusable production rule.",
    vidtoolzSpecificAngle: "Use one tool-update headline as a hook, then pivot to a rule for deciding whether to test it.",
    recommendedFormat: "Current Signal → Production Rule",
    trustRisk: "medium",
    productionDifficulty: "low",
    suggestedTitle: "Do Not Chase Every AI Video Update",
    thumbnailText: "TEST FIRST",
    requiredVisuals: ["news headline excerpt", "Mikko on camera", "test checklist card", "one tool UI screen if available"],
    whatMustNotBeImplied: "Do not claim the tool update works for production unless Mikko has tested it or the video labels it as untested.",
    scores: { trust: 86, authority: 86, usefulness: 89, feasibility: 88, view: 82 },
  },
  {
    id: "captions-accessibility-trust",
    query: "captions accessibility video creator retention tutorial",
    topicTitle: "Captions as trust and clarity infrastructure",
    briefDescription: "A production note connecting caption accuracy to credibility, not only retention.",
    vidtoolzSpecificAngle: "Show one caption error that changes meaning, then a simple review rule.",
    recommendedFormat: "Production Note",
    trustRisk: "low",
    productionDifficulty: "low",
    suggestedTitle: "Bad Captions Can Break Trust",
    thumbnailText: "CHECK WORDS",
    requiredVisuals: ["caption before/after", "audio waveform or timeline", "talking head", "rule card"],
    whatMustNotBeImplied: "Do not imply captions alone verify claims or replace source evidence.",
    scores: { trust: 94, authority: 82, usefulness: 86, feasibility: 94, view: 64 },
  },
  {
    id: "vertical-video-hook-ethics",
    query: "shorts hook retention editing tutorial creators",
    topicTitle: "Short-form hooks without misleading the viewer",
    briefDescription: "A one-rule video about strong openings that do not overclaim the result.",
    vidtoolzSpecificAngle: "Rewrite one hype hook into a credible production promise.",
    recommendedFormat: "Production Note",
    trustRisk: "low",
    productionDifficulty: "low",
    suggestedTitle: "Make The Hook Strong, Not Misleading",
    thumbnailText: "FAIR HOOK",
    requiredVisuals: ["two hook text cards", "Mikko on camera", "timeline cut points", "rule card"],
    whatMustNotBeImplied: "Do not imply a guaranteed outcome, secret method, or universal rule from one example.",
    scores: { trust: 93, authority: 84, usefulness: 88, feasibility: 95, view: 78 },
  },
  {
    id: "ai-broll-labeling",
    query: "AI b-roll video editing creator workflow labels",
    topicTitle: "Labeling AI B-roll in creator videos",
    briefDescription: "A clear labeling rule for AI-generated supporting visuals.",
    vidtoolzSpecificAngle: "Create a small visual-role taxonomy: evidence, illustration, decoration, simulation, fiction.",
    recommendedFormat: "Production Note",
    trustRisk: "medium",
    productionDifficulty: "low",
    suggestedTitle: "Label AI B-Roll Before It Confuses People",
    thumbnailText: "LABEL IT",
    requiredVisuals: ["AI illustration", "label reference card", "real screen example", "Mikko on camera"],
    whatMustNotBeImplied: "Do not let AI B-roll appear to document a real event, interface, person, or result.",
    scores: { trust: 91, authority: 88, usefulness: 87, feasibility: 92, view: 74 },
  },
  {
    id: "one-day-video-scope",
    query: "one day video production workflow solo creator",
    topicTitle: "Scope control for one-day micro-video production",
    briefDescription: "A workflow teardown of how to keep a short video to one concept and one rule.",
    vidtoolzSpecificAngle: "Use the Production Day Dashboard idea as a manual checklist, not an automation pitch.",
    recommendedFormat: "Micro Workflow Teardown",
    trustRisk: "low",
    productionDifficulty: "low",
    suggestedTitle: "One Video In One Day Needs One Rule",
    thumbnailText: "ONE RULE",
    requiredVisuals: ["production checklist", "timer or timeline card", "Mikko on camera", "edit timeline"],
    whatMustNotBeImplied: "Do not imply the dashboard approves, publishes, or automates production work.",
    scores: { trust: 94, authority: 89, usefulness: 92, feasibility: 94, view: 70 },
  },
  {
    id: "synthetic-media-disclosure",
    query: "synthetic media disclosure creator video AI",
    topicTitle: "Synthetic media disclosure for small creator videos",
    briefDescription: "A practical rule for deciding when an AI disclosure belongs on screen.",
    vidtoolzSpecificAngle: "Show a disclosure decision: label it, replace it, or cut it.",
    recommendedFormat: "Current Signal → Production Rule",
    trustRisk: "medium",
    productionDifficulty: "low",
    suggestedTitle: "When Should You Disclose AI Visuals?",
    thumbnailText: "DISCLOSE?",
    requiredVisuals: ["AI visual role card", "disclosure decision tree", "talking head", "final cut rule"],
    whatMustNotBeImplied: "Do not imply legal compliance advice; frame it as creator trust practice unless legal sources are shown.",
    scores: { trust: 90, authority: 86, usefulness: 88, feasibility: 88, view: 78 },
  },
  {
    id: "workflow-before-tools",
    query: "creator workflow before tools AI video production",
    topicTitle: "Workflow before tools in AI-assisted video",
    briefDescription: "A production rule that prevents tool lists from replacing actual proof and production decisions.",
    vidtoolzSpecificAngle: "Tear down a generic AI-tool list and rebuild it as a workflow decision.",
    recommendedFormat: "Micro Workflow Teardown",
    trustRisk: "low",
    productionDifficulty: "low",
    suggestedTitle: "Stop Starting With The Tool List",
    thumbnailText: "WORKFLOW FIRST",
    requiredVisuals: ["generic list crossed out", "workflow map", "Mikko on camera", "one screen capture"],
    whatMustNotBeImplied: "Do not claim specific tools are best without testing, criteria, and disclosed limits.",
    scores: { trust: 93, authority: 91, usefulness: 90, feasibility: 91, view: 75 },
  },
  {
    id: "editing-proof-gap",
    query: "video editing proof before after tutorial creator workflow",
    topicTitle: "The edit decision that creates a proof gap",
    briefDescription: "A short teardown of how an edit can make a claim look stronger than the evidence.",
    vidtoolzSpecificAngle: "Show before/after timeline framing and the proof boundary that should stay visible.",
    recommendedFormat: "Micro Workflow Teardown",
    trustRisk: "medium",
    productionDifficulty: "medium",
    suggestedTitle: "Your Edit Can Accidentally Overclaim",
    thumbnailText: "PROOF GAP",
    requiredVisuals: ["timeline example", "before/after card", "claim boundary label", "Mikko on camera"],
    whatMustNotBeImplied: "Do not imply the example proves a broad trend; keep it to the shown edit decision.",
    scores: { trust: 89, authority: 89, usefulness: 86, feasibility: 80, view: 70 },
  },
  {
    id: "top-ten-ai-tools",
    query: "top 10 AI video tools creators",
    topicTitle: "Top 10 AI video tools",
    briefDescription: "A generic tool-list topic that should be rejected for VIDTOOLZ v0.1.",
    vidtoolzSpecificAngle: "Reject unless converted into a tested workflow rule.",
    recommendedFormat: "Production Note",
    trustRisk: "high",
    productionDifficulty: "high",
    suggestedTitle: "Top 10 AI Video Tools",
    thumbnailText: "10 TOOLS",
    requiredVisuals: ["tool logos"],
    whatMustNotBeImplied: "Do not imply untested tools are recommended.",
    scores: { trust: 35, authority: 30, usefulness: 45, feasibility: 35, view: 85 },
  },
];

const DEFAULT_YOUTUBE_FIXTURE = {
  mode: "fixture",
  videos: DEFAULT_PATTERNS.flatMap((pattern, index) => {
    if (pattern.id === "top-ten-ai-tools") return [];
    const baseViews = 42000 + index * 13000;
    return [
      {
        id: `${pattern.id}-a`,
        topicPattern: pattern.id,
        title: `${pattern.topicTitle}: creator workflow example`,
        channel: index % 2 === 0 ? "Creator Workflow Lab" : "Practical Video Notes",
        views: baseViews,
        publishedAt: `2025-${String((index % 9) + 1).padStart(2, "0")}-12`,
        url: `https://www.youtube.com/watch?v=${pattern.id.replace(/-/g, "")}a`,
      },
      {
        id: `${pattern.id}-b`,
        topicPattern: pattern.id,
        title: `${pattern.topicTitle}: editing and trust lesson`,
        channel: index % 2 === 0 ? "Video Systems Review" : "Solo Creator Studio",
        views: baseViews + 28500,
        publishedAt: `2024-${String((index % 8) + 3).padStart(2, "0")}-20`,
        url: `https://www.youtube.com/watch?v=${pattern.id.replace(/-/g, "")}b`,
      },
    ];
  }),
};

const DEFAULT_NEWS_FIXTURE = {
  mode: "fixture",
  items: [
    {
      id: "ai-disclosure-rules",
      title: "Platforms and regulators continue tightening expectations around synthetic media disclosure",
      source: "Fixture Global Media Policy Digest",
      publishedAt: "2026-05-21",
      tags: ["ai", "disclosure", "synthetic media", "trust", "labels"],
      summary: "Synthetic media policy remains a current attention signal for creators using AI-generated visuals.",
    },
    {
      id: "ai-video-tools-accelerate",
      title: "AI video tools are shipping faster, but creators still need reliable production tests",
      source: "Fixture Creator Tech Briefing",
      publishedAt: "2026-05-23",
      tags: ["ai", "video tools", "workflow", "production"],
      summary: "Fast AI tool updates create pressure to react before creators have tested production reliability.",
    },
    {
      id: "accessibility-captioning",
      title: "Accessibility and caption quality stay visible in platform and creator discussions",
      source: "Fixture Digital Accessibility Roundup",
      publishedAt: "2026-05-19",
      tags: ["captions", "accessibility", "trust", "short-form"],
      summary: "Caption accuracy is a current trust and usability issue, not just a retention tactic.",
    },
    {
      id: "short-form-attention",
      title: "Short-form platforms continue rewarding fast hooks while audiences complain about misleading framing",
      source: "Fixture Attention Economy Monitor",
      publishedAt: "2026-05-20",
      tags: ["short-form", "hooks", "attention", "trust"],
      summary: "Hook pressure creates a relevant opening for VIDTOOLZ to discuss credibility-preserving structure.",
    },
    {
      id: "solo-creator-efficiency",
      title: "Solo creators seek smaller repeatable workflows as production stacks become more complex",
      source: "Fixture Creator Operations Note",
      publishedAt: "2026-05-22",
      tags: ["workflow", "solo creator", "production", "editing"],
      summary: "Tool complexity makes simple one-day production constraints more useful.",
    },
  ],
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv = []) {
  const result = {
    liveYoutube: false,
    liveRss: false,
    youtubeFixture: "",
    newsFixture: "",
    output: true,
    json: false,
    generatedAt: "",
    quotaBudget: Number(process.env.TOPIC_SCOUT_QUOTA_BUDGET || DEFAULT_QUOTA_BUDGET),
    maxSearchCalls: DEFAULT_MAX_SEARCH_CALLS,
    allowMoreSearches: false,
    allowPagination: false,
    reportDir: REPORT_DIR,
    help: false,
  };

  const args = [...argv];
  while (args.length) {
    const item = args.shift();
    if (item === "--live-youtube") result.liveYoutube = true;
    else if (item === "--live-rss") result.liveRss = true;
    else if (item === "--youtube-fixture") result.youtubeFixture = args.shift() || "";
    else if (item === "--news-fixture") result.newsFixture = args.shift() || "";
    else if (item === "--no-output" || item === "--dry-run") result.output = false;
    else if (item === "--json") result.json = true;
    else if (item === "--generated-at") result.generatedAt = args.shift() || "";
    else if (item === "--quota-budget") result.quotaBudget = Number(args.shift() || DEFAULT_QUOTA_BUDGET);
    else if (item === "--max-search-calls") result.maxSearchCalls = Number(args.shift() || DEFAULT_MAX_SEARCH_CALLS);
    else if (item === "--allow-more-searches") result.allowMoreSearches = true;
    else if (item === "--allow-pagination") result.allowPagination = true;
    else if (item === "--report-dir") result.reportDir = args.shift() || REPORT_DIR;
    else if (item === "--help" || item === "-h") result.help = true;
  }
  return result;
}

function usage() {
  return `Usage:
  node scripts/topic-scout.js
  node scripts/topic-scout.js --youtube-fixture path/to/youtube.json --news-fixture path/to/news.json
  YOUTUBE_API_KEY=... node scripts/topic-scout.js --live-youtube

Default mode is offline fixture mode and makes no network calls.
Live YouTube mode requires --live-youtube and YOUTUBE_API_KEY.
Reports are written only under reports/topic-scout/ unless --report-dir is supplied.`;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadInputData(options = {}) {
  return {
    youtube: options.youtubeFixture ? readJsonFile(options.youtubeFixture) : DEFAULT_YOUTUBE_FIXTURE,
    news: options.newsFixture ? readJsonFile(options.newsFixture) : DEFAULT_NEWS_FIXTURE,
  };
}

function ageText(publishedAt, generatedAt) {
  const published = new Date(publishedAt);
  const generated = new Date(generatedAt);
  if (Number.isNaN(published.getTime()) || Number.isNaN(generated.getTime())) return "unknown age";
  const days = Math.max(0, Math.floor((generated - published) / (24 * 60 * 60 * 1000)));
  if (days < 45) return `${days} days old`;
  const months = Math.floor(days / 30);
  if (months < 18) return `${months} months old`;
  return `${Math.floor(months / 12)} years old`;
}

function formatViews(views) {
  const number = Number(views || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "0";
}

function groupVideosByPattern(videos = []) {
  const groups = new Map();
  videos.forEach((video) => {
    const key = cleanString(video.topicPattern);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(video);
  });
  return groups;
}

function matchNews(pattern, newsItems = []) {
  const haystack = `${pattern.topicTitle} ${pattern.briefDescription} ${pattern.query}`.toLowerCase();
  let best = null;
  let bestScore = 0;
  newsItems.forEach((item) => {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const score = tags.reduce((sum, tag) => (haystack.includes(cleanString(tag).toLowerCase()) ? sum + 1 : sum), 0);
    const broadScore = /trust|proof|ai|workflow|production|editing|captions|short-form/.test(
      `${tags.join(" ")} ${item.title}`.toLowerCase()
    )
      ? 1
      : 0;
    const total = score + broadScore;
    if (total > bestScore) {
      best = item;
      bestScore = total;
    }
  });
  return best;
}

function rejectionReasons(pattern, videos, newsItem) {
  const text = `${pattern.topicTitle} ${pattern.briefDescription} ${pattern.suggestedTitle}`.toLowerCase();
  const reasons = [];
  if (/top\s*10|best\s+\d+\s+tools|tool list|tools list/.test(text)) reasons.push("generic top-10-tool topic");
  if (/replaces all creators|replace creators|no humans needed/.test(text)) reasons.push("AI replacement hype");
  if (/fake proof|pretend proof/.test(text)) reasons.push("fake proof topic");
  if (!Array.isArray(videos) || videos.length < 2) reasons.push("fewer than two supporting YouTube examples");
  if (!newsItem) reasons.push("no logical current/global news hook");
  if (pattern.productionDifficulty === "high") reasons.push("too much production for one-day micro-video");
  if (pattern.trustRisk === "high") reasons.push("high trust risk for v0.1 scout recommendation");
  return reasons;
}

function weightedScore(scores = {}, weights) {
  const total =
    Number(scores.trust || 0) * weights.trust +
    Number(scores.authority || 0) * weights.authority +
    Number(scores.usefulness || 0) * weights.usefulness +
    Number(scores.feasibility || 0) * weights.feasibility +
    Number(scores.view || 0) * weights.view;
  return Math.round(total);
}

function buildCandidate(pattern, videos, newsItem, generatedAt) {
  const sortedVideos = [...videos].sort((a, b) => Number(b.views || 0) - Number(a.views || 0)).slice(0, 3);
  const examples = sortedVideos.map((video) => ({
    title: cleanString(video.title),
    views: Number(video.views || 0),
    channel: cleanString(video.channel),
    age: ageText(video.publishedAt, generatedAt),
    date: cleanString(video.publishedAt),
    url: cleanString(video.url),
  }));
  const viewTotal = examples.reduce((sum, item) => sum + item.views, 0);
  const newsHook = `${newsItem.title} (${newsItem.source}, ${newsItem.publishedAt})`;
  const synthesis = `The YouTube examples show existing audience interest in ${pattern.topicTitle.toLowerCase()}. The current signal is not treated as proof; it is a timely reason to explain one durable production rule for creators.`;
  const trustWarning =
    pattern.trustRisk === "low"
      ? "Keep the claim scoped to the shown workflow and visible evidence."
      : "Use labels and proof boundaries so AI visuals or current-event hooks do not imply evidence they cannot provide.";
  const scoreBreakdown = {
    "trust and credibility": pattern.scores.trust,
    "authority-building": pattern.scores.authority,
    "practical usefulness": pattern.scores.usefulness,
    "production feasibility": pattern.scores.feasibility,
    "view potential": pattern.scores.view,
  };

  return {
    topicTitle: pattern.topicTitle,
    briefDescription: pattern.briefDescription,
    youtubeEvidenceSummary: `${examples.length} fixture-backed YouTube examples, ${formatViews(viewTotal)} combined views. Pattern: ${pattern.query}.`,
    exampleSuccessfulVideos: examples,
    currentGlobalNewsHook: newsHook,
    logicalSynthesis: synthesis,
    vidtoolzSpecificAngle: pattern.vidtoolzSpecificAngle,
    recommendedFormat: FORMATS.has(pattern.recommendedFormat) ? pattern.recommendedFormat : "Production Note",
    trustRisk: pattern.trustRisk,
    productionDifficulty: pattern.productionDifficulty,
    suggestedTitle: pattern.suggestedTitle,
    thumbnailText: pattern.thumbnailText,
    requiredVisuals: pattern.requiredVisuals,
    whatMustNotBeImplied: pattern.whatMustNotBeImplied,
    scoreBreakdown,
    finalWeightedScore: weightedScore(pattern.scores, {
      trust: 0.3,
      authority: 0.25,
      usefulness: 0.2,
      feasibility: 0.15,
      view: 0.1,
    }),
    growthWeightedScore: weightedScore(pattern.scores, {
      trust: 0.2,
      authority: 0.2,
      usefulness: 0.2,
      feasibility: 0.15,
      view: 0.25,
    }),
    evidenceAndInference: {
      observedYoutubeEvidence: examples.map((item) => `${item.title} — ${formatViews(item.views)} views — ${item.channel} — ${item.age}`),
      currentNewsHookEvidence: `${newsItem.title}. Fixture summary: ${newsItem.summary}`,
      synthesisInference: synthesis,
      trustWarning,
      productionRecommendation: `Make this as a ${pattern.recommendedFormat} with one practical rule and visible labels where needed.`,
    },
  };
}

function synthesizeReport(input = {}, options = {}) {
  const generatedAt = cleanString(options.generatedAt) || new Date().toISOString();
  const youtube = input.youtube || DEFAULT_YOUTUBE_FIXTURE;
  const news = input.news || DEFAULT_NEWS_FIXTURE;
  const videosByPattern = groupVideosByPattern(youtube.videos || []);
  const candidates = [];
  const rejected = [];

  DEFAULT_PATTERNS.forEach((pattern) => {
    const videos = videosByPattern.get(pattern.id) || [];
    const newsItem = matchNews(pattern, news.items || []);
    const reasons = rejectionReasons(pattern, videos, newsItem);
    if (reasons.length) {
      rejected.push({ topicTitle: pattern.topicTitle, reasons });
      return;
    }
    candidates.push(buildCandidate(pattern, videos, newsItem, generatedAt));
  });

  candidates.sort((a, b) => b.finalWeightedScore - a.finalWeightedScore);
  const supportedCandidates = candidates.slice(0, 10);
  const status = supportedCandidates.length === 10 ? "complete" : "insufficient-evidence";

  return {
    tool: "VIDTOOLZ Topic Scout + News Synthesizer",
    version: "0.1",
    generatedAt,
    mode: youtube.mode === "live" ? "LIVE YOUTUBE DATA" : DEMO_LABEL,
    networkCallsMade: youtube.mode === "live" ? "youtube only when explicitly requested" : "none",
    status,
    supportedCandidateCount: supportedCandidates.length,
    requiredCandidateCount: 10,
    evidenceBoundary:
      "YouTube performance examples and news hooks are observed inputs. The VIDTOOLZ angle, synthesis, score, and production recommendation are inference.",
    missingEvidence:
      status === "complete"
        ? []
        : ["Need at least 10 non-rejected topic patterns with two YouTube examples and one logical news hook each."],
    candidates: status === "complete" ? supportedCandidates : [],
    rejectedCandidates: rejected,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# VIDTOOLZ Topic Scout + News Synthesizer",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Network calls made: ${report.networkCallsMade}`,
    `- Status: ${report.status}`,
    `- Supported candidates: ${report.supportedCandidateCount}/${report.requiredCandidateCount}`,
    "",
    "## Evidence Boundary",
    "",
    report.evidenceBoundary,
    "",
  ];

  if (report.status !== "complete") {
    lines.push("## Insufficient Evidence", "");
    report.missingEvidence.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  lines.push("## Candidates", "");
  report.candidates.forEach((candidate, index) => {
    lines.push(`### ${index + 1}. ${candidate.topicTitle}`, "");
    lines.push(`- Brief description: ${candidate.briefDescription}`);
    lines.push(`- YouTube evidence summary: ${candidate.youtubeEvidenceSummary}`);
    lines.push(`- Current/global news hook: ${candidate.currentGlobalNewsHook}`);
    lines.push(`- Recommended format: ${candidate.recommendedFormat}`);
    lines.push(`- Trust risk: ${candidate.trustRisk}`);
    lines.push(`- Production difficulty: ${candidate.productionDifficulty}`);
    lines.push(`- Suggested title: ${candidate.suggestedTitle}`);
    lines.push(`- Thumbnail text: ${candidate.thumbnailText}`);
    lines.push(`- Final weighted score: ${candidate.finalWeightedScore}`);
    lines.push(`- Growth-weighted score: ${candidate.growthWeightedScore}`);
    lines.push("");
    lines.push("Observed YouTube evidence:");
    candidate.exampleSuccessfulVideos.forEach((video) => {
      lines.push(`- ${video.title} — ${formatViews(video.views)} views — ${video.channel} — ${video.age} — ${video.url}`);
    });
    lines.push("");
    lines.push("Current/news hook evidence:");
    lines.push(`- ${candidate.evidenceAndInference.currentNewsHookEvidence}`);
    lines.push("");
    lines.push("Synthesis/inference:");
    lines.push(`- ${candidate.logicalSynthesis}`);
    lines.push("");
    lines.push("Trust warning:");
    lines.push(`- ${candidate.evidenceAndInference.trustWarning}`);
    lines.push("");
    lines.push("Production recommendation:");
    lines.push(`- ${candidate.evidenceAndInference.productionRecommendation}`);
    lines.push("");
    lines.push("Required visuals:");
    candidate.requiredVisuals.forEach((visual) => lines.push(`- ${visual}`));
    lines.push("");
    lines.push("What must not be implied:");
    lines.push(`- ${candidate.whatMustNotBeImplied}`);
    lines.push("");
  });

  lines.push("## Rejected / Flagged", "");
  if (!report.rejectedCandidates.length) {
    lines.push("- None.");
  } else {
    report.rejectedCandidates.forEach((item) => {
      lines.push(`- ${item.topicTitle}: ${item.reasons.join("; ")}`);
    });
  }
  lines.push("");
  lines.push("## Safety Boundary", "");
  lines.push("- This report does not create package runs, update approvals, publish content, or update Hermes memory.");
  lines.push("- Do not present synthesis as fact. Treat each topic as a candidate requiring Mikko review.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function reportStamp(generatedAt) {
  const date = new Date(generatedAt);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return safe.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
}

function writeReports(report, options = {}) {
  const repoRoot = path.resolve(__dirname, "..");
  const reportDir = path.resolve(repoRoot, options.reportDir || REPORT_DIR);
  const allowedRoot = path.resolve(repoRoot, "reports", "topic-scout");
  if (reportDir !== allowedRoot && !reportDir.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside reports/topic-scout: ${reportDir}`);
  }
  fs.mkdirSync(reportDir, { recursive: true });
  const base = `topic-scout-${reportStamp(report.generatedAt)}`;
  const jsonPath = path.join(reportDir, `${base}.json`);
  const markdownPath = path.join(reportDir, `${base}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function estimateYoutubeQuota(searchCalls, videoListCalls) {
  return searchCalls * 100 + videoListCalls;
}

function validateLiveYoutubeOptions(options = {}, env = process.env) {
  if (!options.liveYoutube) return { ok: true, plannedSearchCalls: 0, estimatedQuota: 0 };
  if (!env.YOUTUBE_API_KEY) {
    return { ok: false, error: "Live YouTube mode requires both --live-youtube and YOUTUBE_API_KEY. No live call was made." };
  }
  const plannedSearchCalls = Number(options.maxSearchCalls || DEFAULT_MAX_SEARCH_CALLS);
  if (!options.allowMoreSearches && plannedSearchCalls > HARD_SEARCH_CALL_LIMIT) {
    return { ok: false, error: `Quota guard blocked ${plannedSearchCalls} search.list calls. Use ${HARD_SEARCH_CALL_LIMIT} or fewer unless explicitly overriding.` };
  }
  const estimatedVideoIds = plannedSearchCalls * 5;
  const estimatedVideoListCalls = Math.max(1, Math.ceil(estimatedVideoIds / 50));
  const estimatedQuota = estimateYoutubeQuota(plannedSearchCalls, estimatedVideoListCalls);
  const budget = Number(options.quotaBudget || DEFAULT_QUOTA_BUDGET);
  if (estimatedQuota > budget) {
    return { ok: false, error: `Estimated YouTube quota ${estimatedQuota} exceeds budget ${budget}. No live call was made.`, plannedSearchCalls, estimatedQuota };
  }
  return { ok: true, plannedSearchCalls, estimatedQuota };
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 180)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

async function fetchLiveYoutubeData(options = {}, env = process.env) {
  const validation = validateLiveYoutubeOptions(options, env);
  if (!validation.ok) throw new Error(validation.error);
  const apiKey = env.YOUTUBE_API_KEY;
  const patterns = DEFAULT_PATTERNS.filter((pattern) => pattern.id !== "top-ten-ai-tools").slice(0, validation.plannedSearchCalls);
  const searchItems = [];
  for (const pattern of patterns) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "5");
    url.searchParams.set("q", pattern.query);
    const payload = await requestJson(url.toString());
    (payload.items || []).forEach((item) => searchItems.push({ ...item, topicPattern: pattern.id }));
  }
  const ids = searchItems.map((item) => item.id && item.id.videoId).filter(Boolean).slice(0, 50);
  if (!ids.length) return { mode: "live", videos: [] };
  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("key", apiKey);
  videosUrl.searchParams.set("part", "snippet,statistics");
  videosUrl.searchParams.set("id", ids.join(","));
  const videoPayload = await requestJson(videosUrl.toString());
  const patternById = new Map(searchItems.map((item) => [item.id.videoId, item.topicPattern]));
  return {
    mode: "live",
    videos: (videoPayload.items || []).map((item) => ({
      id: item.id,
      topicPattern: patternById.get(item.id),
      title: item.snippet && item.snippet.title,
      channel: item.snippet && item.snippet.channelTitle,
      views: Number(item.statistics && item.statistics.viewCount ? item.statistics.viewCount : 0),
      publishedAt: item.snippet && item.snippet.publishedAt ? item.snippet.publishedAt.slice(0, 10) : "",
      url: `https://www.youtube.com/watch?v=${item.id}`,
    })),
  };
}

async function run(options = {}, env = process.env) {
  const generatedAt = cleanString(options.generatedAt) || new Date().toISOString();
  let input = loadInputData(options);
  if (options.liveYoutube) {
    const validation = validateLiveYoutubeOptions(options, env);
    if (!validation.ok) {
      return { exitCode: 1, error: validation.error };
    }
    input = { ...input, youtube: await fetchLiveYoutubeData(options, env) };
  }
  if (options.liveRss) {
    return { exitCode: 1, error: "Live RSS is not implemented in v0.1. Use --news-fixture or default fixture data." };
  }
  const report = synthesizeReport(input, { generatedAt });
  const written = options.output === false ? null : writeReports(report, options);
  return { exitCode: 0, report, written };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    const result = await run(options, env);
    if (result.error) {
      console.error(result.error);
      return result.exitCode || 1;
    }
    if (options.json) {
      console.log(JSON.stringify(result.report, null, 2));
    } else {
      console.log(`${result.report.tool} v${result.report.version}`);
      console.log(`Mode: ${result.report.mode}`);
      console.log(`Status: ${result.report.status}`);
      console.log(`Supported candidates: ${result.report.supportedCandidateCount}/${result.report.requiredCandidateCount}`);
      if (result.written) {
        console.log(`JSON report: ${path.relative(path.resolve(__dirname, ".."), result.written.jsonPath)}`);
        console.log(`Markdown report: ${path.relative(path.resolve(__dirname, ".."), result.written.markdownPath)}`);
      }
    }
    return result.exitCode;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  DEFAULT_NEWS_FIXTURE,
  DEFAULT_PATTERNS,
  DEFAULT_YOUTUBE_FIXTURE,
  DEMO_LABEL,
  estimateYoutubeQuota,
  loadInputData,
  main,
  parseArgs,
  rejectionReasons,
  renderMarkdown,
  run,
  synthesizeReport,
  validateLiveYoutubeOptions,
  weightedScore,
  writeReports,
};
