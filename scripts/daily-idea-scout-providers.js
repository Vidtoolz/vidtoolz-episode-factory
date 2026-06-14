#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RESEARCH_FIXTURE = [
  {
    title: "Your Edit Can Accidentally Overclaim",
    description: "A short teardown of how an edit decision can make a claim look stronger than the evidence. Show a before/after timeline frame, explain the proof gap, and give one simple rule: if the visual implies a result you cannot prove, cut closer to show the boundary. Works for solo creators because it costs nothing and takes 10 seconds.",
    thumbnail_prompt: "Split screen thumbnail showing two video timeline frames. Left side shows a tight crop implying proof, right side shows a wider frame revealing the uncertainty gap. Bold text overlay: 'PROOF GAP'. Dark background, high contrast, professional video editor aesthetic. Clean composition, no clutter.",
    evidence: [
      {
        type: "creator_pain",
        title: "Reddit r/VideoEditing discussion on misleading before/after",
        url: "https://reddit.com/r/VideoEditing/...",
        note: "Recurring question about when color grading or crop becomes dishonest"
      },
      {
        type: "trust_issue",
        title: "YouTube comments criticizing tutorial thumbnails that overclaim",
        url: "https://youtube.com/watch?v=...",
        note: "Viewers notice when thumbnail promises more than video delivers"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 9,
      trust_risk: 2,
      production_feasibility: 9,
      view_potential: 7,
      timeliness: 7
    },
    thumbnail_status: "pending",
    ranking_rationale: "High trust value, durable topic, low production cost. Not trending but always relevant for creators building long-term credibility."
  },
  {
    title: "One Video In One Day Needs One Rule",
    description: "A workflow teardown showing how scope control enables solo creators to ship a video in one day. The rule: one concept, one proof, one call to action. Show a real production timeline from concept to export. This is not about speed for its own sake, but about reducing decision fatigue that kills completion rates.",
    thumbnail_prompt: "Single creator at editing desk with a large clock overlay showing 24 hours. Minimalist desk setup, laptop screen visible. Text overlay: '1 DAY = 1 RULE'. Warm lighting, realistic workspace, not staged. Vertical composition optimized for Shorts thumbnail.",
    evidence: [
      {
        type: "platform_trend",
        title: "YouTube algorithm favoring consistent upload cadence for Shorts",
        url: "https://creatorinsider.youtube.com/...",
        note: "Creators who ship weekly see better recommendation rates"
      },
      {
        type: "creator_pain",
        title: "Creator survey: 60% of videos never finished due to scope creep",
        url: "https://creator.tools/survey-2024",
        note: "Decision fatigue is the #1 reason videos stall in production"
      }
    ],
    scores: {
      niche_fit: 10,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 8,
      timeliness: 8
    },
    thumbnail_status: "pending",
    ranking_rationale: "Perfect VIDTOOLZ niche fit. Solves real pain, low trust risk, and addresses the production system thinking angle. Timely because algorithm changes reward consistency."
  },
  {
    title: "Stop Starting With The Tool List",
    description: "A current-signal video that tears down a generic AI-tool list and rebuilds it as a workflow decision. The lesson: tools are outputs of a workflow question, not inputs. Show a real production problem, the decision process that led to tool selection, and why starting with tools leads to fragile workflows.",
    thumbnail_prompt: "Workflow diagram on whiteboard with a red X over a list of AI tool logos. Creator pointing to the workflow decision point. Text overlay: 'WORKFLOW FIRST'. Clean, educational style, not clickbait. Professional but approachable tone.",
    evidence: [
      {
        type: "market_trend",
        title: "Proliferation of 'Top 10 AI Tools' videos with declining retention",
        url: "https://youtube.com/trends/...",
        note: "Audience fatigue with tool-list content that lacks workflow context"
      },
      {
        type: "creator_insight",
        title: "Film Booth channel analysis: workflow videos outperform tool reviews",
        url: "https://filmbooth.io/...",
        note: "Teaching the decision process builds more authority than reviewing the tool"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 8,
      timeliness: 9
    },
    thumbnail_status: "pending",
    ranking_rationale: "High differentiation from generic AI-tool-list videos. Builds authority, addresses a real audience-fatigue pattern, and is highly relevant to VIDTOOLZ positioning."
  },
  {
    title: "Bad Captions Can Break Trust",
    description: "A production note connecting caption accuracy to credibility. Show one caption error that changes meaning, then a 30-second review rule. Auto-captions are fast but unchecked captions signal carelessness. This matters more for Shorts where captions are always-on. Not about perfection, about not accidentally lying.",
    thumbnail_prompt: "Large inaccurate caption text over a speaker's face, with one word highlighted in red showing the error. Clean background, professional lighting. Text overlay: 'CHECK WORDS'. Educational documentary style, not flashy. Vertical format with safe margins for Shorts caption placement.",
    evidence: [
      {
        type: "platform_change",
        title: "YouTube Shorts auto-caption quality improvements but still error-prone",
        url: "https://blog.youtube/...",
        note: "Auto-captions are better but not reliable enough for professional content"
      },
      {
        type: "accessibility_trend",
        title: "Growing audience expectation for accurate captions as accessibility standard",
        url: "https://a11y-report.org/...",
        note: "Viewers notice caption errors and associate them with overall quality"
      }
    ],
    scores: {
      niche_fit: 8,
      practical_usefulness: 8,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 6,
      timeliness: 7
    },
    thumbnail_status: "pending",
    ranking_rationale: "Practical, low-risk, but moderate view potential. Good evergreen content for the channel library. Addresses accessibility without performative activism."
  },
  {
    title: "Do Not Let AI B-Roll Pretend To Be Proof",
    description: "A one-rule video on separating AI illustration from evidence in short-form production. Show a label decision tree: Is this proof of a real result, or AI visualization of a concept? If the viewer might think it's proof, label it. Use one AI illustration labeled clearly, one real screen recording, and a final rule card.",
    thumbnail_prompt: "Split image: left shows a clearly labeled 'AI ILLUSTRATION' image, right shows a real screen recording with 'PROOF' label. Dark background with bright labels. Text overlay: 'NOT PROOF'. Clean, professional, no misleading visual. Suitable for both landscape and vertical formats.",
    evidence: [
      {
        type: "trust_issue",
        title: "Growing criticism of creators using AI images as if they were real photos",
        url: "https://twitter.com/creator-threads/...",
        note: "Audience skepticism increasing when AI images are presented without disclosure"
      },
      {
        type: "regulatory_trend",
        title: "FTC and YouTube disclosure guidelines being clarified for synthetic media",
        url: "https://ftc.gov/...",
        note: "Guidelines are still soft but moving toward mandatory disclosure"
      }
    ],
    scores: {
      niche_fit: 10,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 8,
      timeliness: 9
    },
    thumbnail_status: "pending",
    ranking_rationale: "Core VIDTOOLZ topic. High trust value, addresses real audience skepticism, and positions the channel as the authority on AI-assisted production ethics."
  },
  {
    title: "When Should You Disclose AI Visuals?",
    description: "A current-signal video translating AI disclosure guidelines into a creator decision tree. Show three cases: label it, replace it, or cut it. Frame as creator-trust practice, not legal advice. Use one AI visual role card, one disclosure decision tree, and a final cut rule. Timeliness from recent platform policy updates.",
    thumbnail_prompt: "Decision tree diagram on clean background with three branches: 'LABEL IT', 'REPLACE IT', 'CUT IT'. Creator pointing to the tree. Text overlay: 'DISCLOSE?'. Educational infographic style, clear at small sizes. Professional but not sterile.",
    evidence: [
      {
        type: "platform_change",
        title: "YouTube AI disclosure requirements updated for 2025",
        url: "https://support.google.com/youtube/...",
        note: "Creators now have clearer guidelines on when disclosure is required"
      },
      {
        type: "audience_sentiment",
        title: "Survey: 72% of viewers prefer disclosed AI content over hidden AI content",
        url: "https://creator-survey.com/...",
        note: "Transparency builds trust even when the audience doesn't care about the specific tool"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 9,
      trust_risk: 2,
      production_feasibility: 8,
      view_potential: 8,
      timeliness: 10
    },
    thumbnail_status: "pending",
    ranking_rationale: "Very timely due to recent platform updates. High practical value and low trust risk. Good for positioning VIDTOOLZ as the go-to resource for AI-disclosure decisions."
  },
  {
    title: "Label AI B-Roll Before It Confuses People",
    description: "A clear labeling rule for AI-generated supporting visuals. Create a visual-role taxonomy: evidence, illustration, decoration, simulation, fiction. Show one AI illustration with its label, one real example, and a reference card. The point is not to shame AI use but to prevent accidental confusion between what's real and what's generated.",
    thumbnail_prompt: "Reference card showing five AI visual role labels: EVIDENCE, ILLUSTRATION, DECORATION, SIMULATION, FICTION. Each with a simple icon. Clean card design on neutral background. Text overlay: 'LABEL IT'. Organized, professional, like a production cheat sheet.",
    evidence: [
      {
        type: "creator_pain",
        title: "Creators asking how to label AI content without looking 'fake'",
        url: "https://reddit.com/r/AIVideo/...",
        note: "Many creators avoid labeling because they fear it undermines credibility"
      },
      {
        type: "production_pattern",
        title: "Top-performing educational channels already label AI B-roll",
        url: "https://youtube.com/analysis/...",
        note: "Vox, Veritasium, and others label synthesized visuals without losing authority"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 7,
      timeliness: 8
    },
    thumbnail_status: "pending",
    ranking_rationale: "Strong niche fit and practical value. Addresses real creator anxiety. Slightly less view potential than the disclosure video but still a solid library piece."
  },
  {
    title: "Make The Hook Strong, Not Misleading",
    description: "A one-rule video about strong openings that do not overclaim the result. Rewrite one hype hook into a credible production promise. Show two hook text cards, the timeline cut points, and a rule: the hook must be true within the first 30 seconds, not just in the video summary.",
    thumbnail_prompt: "Two text cards side by side: one with exaggerated clickbait text crossed out in red, one with a revised honest-but-compelling hook. Creator in frame between them. Text overlay: 'FAIR HOOK'. Educational style, bright and clean, suitable for Shorts thumbnail.",
    evidence: [
      {
        type: "platform_algorithm",
        title: "YouTube retention data: misleading hooks cause early drop-off",
        url: "https://creatoracademy.youtube.com/...",
        note: "Viewers who feel tricked in the first 5 seconds leave immediately"
      },
      {
        type: "creator_pattern",
        title: "Thomas Flight hook-writing process: 'promise what you deliver'",
        url: "https://thomasflight.io/...",
        note: "Successful creators write hooks that match the delivery within the first 30 seconds"
      }
    ],
    scores: {
      niche_fit: 8,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 7,
      timeliness: 6
    },
    thumbnail_status: "pending",
    ranking_rationale: "Practical and durable, but not highly timely. Still valuable as a library piece and a good complement to the AI-disclosure content."
  },
  {
    title: "The Safe Way To Use AI Backgrounds",
    description: "A practical rule for using AI backgrounds as setting, not proof. Show Mikko on green screen, then label the AI-generated background as production design, not location footage. The lesson: AI backgrounds are fine when the viewer knows they're design, not documentation.",
    thumbnail_prompt: "Composite image showing a creator in front of a clearly AI-generated landscape background. A label reads 'AI SET — NOT REAL LOCATION'. Clean, educational composition. Professional but fun. Text overlay: 'AI SET?'. Vertical format with space for Shorts UI elements.",
    evidence: [
      {
        type: "creator_technique",
        title: "Growing number of creators using green screen + AI backgrounds for cost savings",
        url: "https://youtube.com/trends/...",
        note: "Practical technique that saves travel costs but needs trust management"
      },
      {
        type: "trust_issue",
        title: "Viewer backlash when creators present AI locations as real",
        url: "https://twitter.com/...",
        note: "Multiple viral callouts of creators pretending AI backgrounds were real travel"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 8,
      trust_risk: 2,
      production_feasibility: 7,
      view_potential: 8,
      timeliness: 7
    },
    thumbnail_status: "pending",
    ranking_rationale: "Practical technique with clear trust guidance. Moderate production difficulty due to green screen setup, but high value for solo creators. Good for building the VIDTOOLZ AI-production series."
  },
  {
    title: "Use Screen Recording When Proof Matters",
    description: "A short workflow teardown showing when real screen capture should replace decorative AI visuals. Compare a fake-looking visual plan with one actual screen recording and a claim boundary. The rule: if your claim is about something the viewer can see on their own screen, record it. If it's a concept, an AI illustration with a label is fine.",
    thumbnail_prompt: "Screen recording with a mouse cursor overlaid on a software interface. Text overlay: 'SHOW IT'. Clean screenshot, high readability at small sizes. Professional educational style. Not cluttered, not flashy. Suitable for vertical Shorts format.",
    evidence: [
      {
        type: "production_pattern",
        title: "Educational channels that use real screen recordings have higher perceived credibility",
        url: "https://youtube-creator-research.com/...",
        note: "Viewers trust creators who show the actual interface they're discussing"
      },
      {
        type: "ai_limitation",
        title: "AI-generated UI screenshots are immediately recognizable as fake by tech-savvy viewers",
        url: "https://hacker-news.com/...",
        note: "AI struggles with accurate UI text and layout, creating instant credibility loss"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 7,
      timeliness: 7
    },
    thumbnail_status: "pending",
    ranking_rationale: "Strong practical rule, very low trust risk, and directly complements the AI-disclosure series. Good for building a coherent content library."
  },
  {
    title: "Do Not Chase Every AI Video Update",
    description: "A current-signal video that turns a tool-update headline into a reusable production rule. Show one tool-update headline as a hook, then pivot to a test checklist: does this update solve a problem I already have, can I test it in one day, and will it improve my output or just change my process?",
    thumbnail_prompt: "News headline about a new AI tool with a 'TEST FIRST' checklist overlay. Creator in frame holding up the checklist. Clean, professional, not clickbait. Text overlay: 'TEST FIRST'. Educational and grounded, contrasting with typical AI-hype thumbnails.",
    evidence: [
      {
        type: "market_trend",
        title: "Fatigue with constant AI tool announcements causing creator paralysis",
        url: "https://creator-fatigue-survey.com/...",
        note: "Creators report spending more time watching tool demos than making videos"
      },
      {
        type: "production_rule",
        title: "Successful creators test tools on real projects, not on hype",
        url: "https://youtube.com/interview/...",
        note: "Top creators have a filter for which tools are worth testing"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 8,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 8,
      timeliness: 9
    },
    thumbnail_status: "pending",
    ranking_rationale: "Highly timely and addresses real creator fatigue. Builds authority by positioning VIDTOOLZ as the voice of reason against AI hype. Strong complement to the workflow-first video."
  },
  {
    title: "DaVinci Resolve 20 — What Changed For Shorts Creators",
    description: "A specific workflow teardown of Resolve 20 features relevant to vertical short-form video. Screen-record the new vertical timeline preset, the enhanced auto-reframe, and the improved caption export. Test each on a real project and report what actually helps versus what looks good in demos.",
    thumbnail_prompt: "DaVinci Resolve interface vertical layout with new features highlighted. Clean screenshot with cursor and annotations. Text overlay: 'RESOLVE 20'. Professional, educational, not gimmicky. Vertical aspect showing vertical video production workflow.",
    evidence: [
      {
        type: "tool_release",
        title: "DaVinci Resolve 20 released with vertical video workflow improvements",
        url: "https://blackmagicdesign.com/...",
        note: "New vertical timeline preset, auto-reframe, and caption export improvements"
      },
      {
        type: "creator_demand",
        title: "High demand for Resolve tutorials specific to Shorts workflow",
        url: "https://youtube.com/search/...",
        note: "Existing tutorials are mostly for long-form horizontal video"
      }
    ],
    scores: {
      niche_fit: 10,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 7,
      view_potential: 9,
      timeliness: 10
    },
    thumbnail_status: "pending",
    ranking_rationale: "Perfect niche fit, highly timely, and high view potential. Slightly lower production feasibility due to needing access to Resolve 20, but high value for the VIDTOOLZ audience."
  },
  {
    title: "Why Your AI Workflow Is Fragile",
    description: "A systems-thinking video about production resilience with AI tools. Show a workflow that breaks when one AI service changes pricing or shuts down, then a more resilient version that uses local fallbacks. The lesson: any AI tool in your primary pipeline should have a 30-minute manual alternative.",
    thumbnail_prompt: "Broken chain illustration with AI tool icons, showing where the pipeline fails. A 'FALLBACK' label pointing to a manual step. Text overlay: 'FRAGILE?'. Clean diagram style, professional, educational. Suitable for both landscape and vertical formats.",
    evidence: [
      {
        type: "market_event",
        title: "Multiple AI services have changed pricing or shut down in the last year",
        url: "https://ai-shutdown-tracker.com/...",
        note: "Creators who depended on specific tools had to rebuild workflows overnight"
      },
      {
        type: "production_pattern",
        title: "Resilient creators have local alternatives for critical pipeline steps",
        url: "https://creator-resilience-research.com/...",
        note: "The common pattern is having one AI option and one manual option for each critical step"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 8,
      trust_risk: 1,
      production_feasibility: 8,
      view_potential: 7,
      timeliness: 8
    },
    thumbnail_status: "pending",
    ranking_rationale: "Strong systems-thinking content that differentiates VIDTOOLZ from tool-enthusiast channels. Addresses real creator pain around service dependency. Good for building long-term authority."
  },
  {
    title: "One Rule For AI-Assisted Batching",
    description: "A micro-workflow video about using AI to batch-produce content without losing quality control. The rule: AI can generate drafts, but human judgment must approve each piece before it goes to the next stage. Show a batching workflow where AI does the first pass, and the creator reviews before committing to production.",
    thumbnail_prompt: "Workflow diagram showing AI draft arrow going through a human review gate before moving to production. Clean process diagram style. Text overlay: 'BATCH SMART'. Professional and educational. Suitable for vertical Shorts format.",
    evidence: [
      {
        type: "production_technique",
        title: "Creator productivity: batching content production for consistent upload schedules",
        url: "https://creator-productivity.com/...",
        note: "Batching is essential for consistent content but quality control is the common failure point"
      },
      {
        type: "ai_pattern",
        title: "AI-assisted workflows that skip human review produce lower audience satisfaction",
        url: "https://ai-quality-research.com/...",
        note: "The human-in-the-loop pattern is what separates professional AI use from amateur use"
      }
    ],
    scores: {
      niche_fit: 9,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 7,
      timeliness: 7
    },
    thumbnail_status: "pending",
    ranking_rationale: "Practical workflow content with strong niche fit. Complements the other systems-thinking pieces. Good for building a coherent content library around AI-assisted production."
  },
  {
    title: "The Editing Pattern That Kills Watch Time",
    description: "A rhythm and pacing video about the common edit that causes viewers to drop off. Show a before/after timeline with cut points annotated. Explain the pattern: holding on a static frame after the information has been delivered. The fix: cut 1-2 seconds earlier than feels comfortable, especially for talking-head segments.",
    thumbnail_prompt: "Video timeline with cut points marked. An arrow shows where the edit should have been cut earlier. Text overlay: 'CUT EARLIER'. Clean editing interface screenshot, professional and educational. Vertical format optimized for Shorts thumbnail.",
    evidence: [
      {
        type: "platform_algorithm",
        title: "YouTube retention graphs show drop-offs correlated with static frames",
        url: "https://creatoracademy.youtube.com/...",
        note: "Audience retention data publicly visible in YouTube Studio"
      },
      {
        type: "editing_pattern",
        title: "Professional editors cut 1-2 seconds earlier than beginners",
        url: "https://editing-craft-study.com/...",
        note: "The most common beginner mistake is holding shots too long after the point has been made"
      }
    ],
    scores: {
      niche_fit: 8,
      practical_usefulness: 9,
      trust_risk: 1,
      production_feasibility: 9,
      view_potential: 8,
      timeliness: 6
    },
    thumbnail_status: "pending",
    ranking_rationale: "Good practical editing content with high usefulness and view potential. Not highly timely but durable as a library piece. Complements the broader VIDTOOLZ editing-workflow content."
  }
];

function createFixtureProvider() {
  return {
    research: function (options) {
      return RESEARCH_FIXTURE.slice(0, 15);
    },
    synthesize: function (rawIdeas) {
      return rawIdeas.map(function (item) {
        return { ...item };
      });
    },
  };
}

function normalizeManualIdea(idea, index) {
  if (!idea || typeof idea !== "object" || Array.isArray(idea)) {
    throw new Error(`Manual idea ${index + 1} must be an object`);
  }
  return {
    ...idea,
    title: stringField(idea, "title", index),
    description: stringField(idea, "description", index),
    thumbnail_prompt: stringField(idea, "thumbnail_prompt", index),
    evidence: normalizeEvidence(idea.evidence, index),
    scores: normalizeScores(idea.scores, index),
    ranking_rationale: stringField(idea, "ranking_rationale", index),
    thumbnail_status: typeof idea.thumbnail_status === "string" && idea.thumbnail_status.trim() ? idea.thumbnail_status.trim() : "pending",
  };
}

function stringField(idea, key, index) {
  if (typeof idea[key] !== "string" || !idea[key].trim()) {
    throw new Error(`Manual idea ${index + 1} missing non-empty ${key}`);
  }
  return idea[key].trim();
}

function normalizeEvidence(evidence, ideaIndex) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error(`Manual idea ${ideaIndex + 1} must include at least one evidence record`);
  }
  return evidence.map(function (item, evidenceIndex) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Manual idea ${ideaIndex + 1} evidence ${evidenceIndex + 1} must be an object`);
    }
    if (typeof item.type !== "string" || !item.type.trim()) {
      throw new Error(`Manual idea ${ideaIndex + 1} evidence ${evidenceIndex + 1} missing type`);
    }
    if (typeof item.title !== "string" || !item.title.trim()) {
      throw new Error(`Manual idea ${ideaIndex + 1} evidence ${evidenceIndex + 1} missing title`);
    }
    return {
      ...item,
      type: item.type.trim(),
      title: item.title.trim(),
      url: typeof item.url === "string" ? item.url.trim() : item.url,
      note: typeof item.note === "string" ? item.note.trim() : item.note,
    };
  });
}

function normalizeScores(scores, ideaIndex) {
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
    throw new Error(`Manual idea ${ideaIndex + 1} missing scores object`);
  }
  const normalized = {};
  for (const key of ["niche_fit", "practical_usefulness", "trust_risk", "production_feasibility", "view_potential", "timeliness"]) {
    const value = typeof scores[key] === "string" ? Number(scores[key]) : scores[key];
    if (!Number.isFinite(value)) {
      throw new Error(`Manual idea ${ideaIndex + 1} invalid score ${key}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeManualIdeas(value) {
  const ideas = Array.isArray(value) ? value : value && Array.isArray(value.ideas) ? value.ideas : null;
  if (!ideas) {
    throw new Error("Manual input must be an array of ideas or an object with an ideas array");
  }
  return ideas.map(normalizeManualIdea);
}

function parseManualJson(content, inputPath) {
  try {
    return normalizeManualIdeas(JSON.parse(content));
  } catch (err) {
    throw new Error(`Invalid manual JSON input ${inputPath}: ${err.message}`);
  }
}

function parseManualMarkdown(content, inputPath) {
  const fencedJson = content.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson) {
    return parseManualJson(fencedJson[1], inputPath);
  }

  const sections = splitMarkdownIdeaSections(content);
  if (sections.length === 0) {
    throw new Error(`Invalid manual Markdown input ${inputPath}: expected idea sections starting with "## " or a fenced json block`);
  }
  return sections.map(parseMarkdownIdeaSection).map(normalizeManualIdea);
}

function splitMarkdownIdeaSections(content) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1].replace(/^#?\d+\s*[-.)]\s*/, "").trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function parseMarkdownIdeaSection(section) {
  const fields = { title: section.title, evidence: [], scores: {} };
  let active = "description";
  const description = [];
  const evidence = [];
  const rationale = [];
  const thumbnail = [];

  for (const rawLine of section.lines) {
    const line = rawLine.trim();
    if (/^description\s*:/i.test(line)) {
      active = "description";
      const value = afterColon(line);
      if (value) description.push(value);
      continue;
    }
    if (/^thumbnail_prompt\s*:/i.test(line) || /^thumbnail prompt\s*:/i.test(line)) {
      active = "thumbnail";
      const value = afterColon(line);
      if (value) thumbnail.push(value);
      continue;
    }
    if (/^ranking_rationale\s*:/i.test(line) || /^ranking rationale\s*:/i.test(line)) {
      active = "rationale";
      const value = afterColon(line);
      if (value) rationale.push(value);
      continue;
    }
    if (/^evidence\s*:/i.test(line)) {
      active = "evidence";
      continue;
    }
    if (/^scores\s*:/i.test(line)) {
      active = "scores";
      continue;
    }
    if (!line) continue;

    if (active === "scores") {
      const score = line.replace(/^[-*]\s*/, "").match(/^([a-z_]+)\s*:\s*(\d+(?:\.\d+)?)$/i);
      if (score) fields.scores[score[1].toLowerCase()] = Number(score[2]);
      continue;
    }
    if (active === "evidence") {
      if (/^[-*]\s+/.test(line)) evidence.push(parseMarkdownEvidence(line.replace(/^[-*]\s+/, "")));
      continue;
    }
    if (active === "thumbnail") thumbnail.push(line);
    if (active === "rationale") rationale.push(line);
    if (active === "description") description.push(line);
  }

  fields.description = description.join(" ").trim();
  fields.thumbnail_prompt = thumbnail.join(" ").trim();
  fields.ranking_rationale = rationale.join(" ").trim();
  fields.evidence = evidence;
  return fields;
}

function afterColon(line) {
  return line.slice(line.indexOf(":") + 1).trim();
}

function parseMarkdownEvidence(line) {
  const parts = line.split("|").map((part) => part.trim());
  if (parts.length >= 2) {
    const evidence = { type: parts[0], title: parts[1] };
    if (parts[2]) evidence.url = parts[2];
    if (parts[3]) evidence.note = parts.slice(3).join(" | ");
    return evidence;
  }
  const match = line.match(/^([^:]+):\s*(.+)$/);
  if (match) return { type: match[1].trim(), title: match[2].trim() };
  return { type: "manual", title: line };
}

function readManualInputFile(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Manual provider requires --input=PATH pointing to a local Markdown or JSON file");
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Manual input file does not exist: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Manual input path is not a file: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, "utf8");
  if (!content.trim()) {
    throw new Error(`Manual input file is empty: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".json") return parseManualJson(content, resolved);
  if (ext === ".md" || ext === ".markdown") return parseManualMarkdown(content, resolved);
  throw new Error(`Unsupported manual input file type: ${ext || "(none)"}. Use .md, .markdown, or .json`);
}

function createManualProvider() {
  return {
    research: function (options) {
      return readManualInputFile(options && options.inputPath);
    },
    synthesize: function (research) {
      return research.map(function (item) {
        return { ...item };
      });
    },
  };
}

module.exports = {
  RESEARCH_FIXTURE,
  createFixtureProvider,
  createManualProvider,
  parseManualMarkdown,
  parseManualJson,
  readManualInputFile,
};
