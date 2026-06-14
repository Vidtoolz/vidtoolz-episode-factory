#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ARCHIVE_ROOT = "/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/daily-idea-scout";
const IDEA_COUNT = 15;

const WEIGHTS = {
  niche_fit: 0.20,
  practical_usefulness: 0.20,
  trust_risk: 0.15,
  production_feasibility: 0.15,
  view_potential: 0.15,
  timeliness: 0.15,
};

const SCORE_KEYS = Object.keys(WEIGHTS);

const PROVIDERS = {};

function registerProvider(name, provider) {
  if (!provider || typeof provider.research !== "function" || typeof provider.synthesize !== "function") {
    throw new Error(`Provider ${name} must have research() and synthesize() functions`);
  }
  PROVIDERS[name] = provider;
}

function getProvider(name) {
  if (!PROVIDERS[name]) {
    throw new Error(`Unknown provider: ${name}. Registered: ${Object.keys(PROVIDERS).join(", ") || "none"}`);
  }
  return PROVIDERS[name];
}

function scoreCandidateIdea(raw) {
  if (!raw || !raw.scores) {
    throw new Error("Cannot score idea: missing scores object");
  }
  for (const key of SCORE_KEYS) {
    if (typeof raw.scores[key] !== "number" || raw.scores[key] < 1 || raw.scores[key] > 10) {
      throw new Error(`Invalid score for ${key}: must be 1-10, got ${raw.scores[key]}`);
    }
  }
  const trust_component = 10 - raw.scores.trust_risk;
  const final_score =
    raw.scores.niche_fit * WEIGHTS.niche_fit +
    raw.scores.practical_usefulness * WEIGHTS.practical_usefulness +
    trust_component * WEIGHTS.trust_risk +
    raw.scores.production_feasibility * WEIGHTS.production_feasibility +
    raw.scores.view_potential * WEIGHTS.view_potential +
    raw.scores.timeliness * WEIGHTS.timeliness;

  return {
    ...raw,
    final_score: Math.round(final_score * 100) / 100,
  };
}

function rankIdeas(ideas) {
  if (!Array.isArray(ideas) || ideas.length === 0) {
    throw new Error("rankIdeas requires a non-empty array");
  }
  const scored = ideas.map(scoreCandidateIdea);
  scored.sort((a, b) => b.final_score - a.final_score);
  return scored.map((idea, i) => ({ ...idea, rank: i + 1 }));
}

function validateIdeaShape(idea) {
  if (!idea || typeof idea !== "object") {
    return { valid: false, error: "Idea must be an object" };
  }
  const required = ["title", "description", "thumbnail_prompt", "evidence", "scores", "ranking_rationale"];
  for (const key of required) {
    if (!(key in idea) || idea[key] === null || idea[key] === undefined) {
      return { valid: false, error: `Missing field: ${key}` };
    }
  }
  if (typeof idea.title !== "string" || idea.title.length === 0) {
    return { valid: false, error: "title must be a non-empty string" };
  }
  if (typeof idea.description !== "string" || idea.description.length === 0) {
    return { valid: false, error: "description must be a non-empty string" };
  }
  if (typeof idea.thumbnail_prompt !== "string" || idea.thumbnail_prompt.length === 0) {
    return { valid: false, error: "thumbnail_prompt must be a non-empty string" };
  }
  if (typeof idea.ranking_rationale !== "string" || idea.ranking_rationale.length === 0) {
    return { valid: false, error: "ranking_rationale must be a non-empty string" };
  }
  for (const key of SCORE_KEYS) {
    if (typeof idea.scores[key] !== "number" || idea.scores[key] < 1 || idea.scores[key] > 10) {
      return { valid: false, error: `Invalid score: scores.${key} must be 1-10` };
    }
  }
  if (!Array.isArray(idea.evidence) || idea.evidence.length === 0) {
    return { valid: false, error: "evidence must be a non-empty array" };
  }
  for (let i = 0; i < idea.evidence.length; i++) {
    const ev = idea.evidence[i];
    if (!ev || !ev.type || !ev.title) {
      return { valid: false, error: `evidence[${i}] must have type and title` };
    }
  }
  return { valid: true };
}

function validateDailyRunShape(run) {
  if (!run || typeof run !== "object") {
    return { valid: false, error: "Daily run must be an object" };
  }
  if (!run.date || typeof run.date !== "string") {
    return { valid: false, error: "Missing or invalid date" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(run.date)) {
    return { valid: false, error: `date must be YYYY-MM-DD format, got: ${run.date}` };
  }
  if (!run.generated_at || typeof run.generated_at !== "string") {
    return { valid: false, error: "Missing or invalid generated_at" };
  }
  if (!run.provider || typeof run.provider !== "string") {
    return { valid: false, error: "Missing or invalid provider" };
  }
  if (!Array.isArray(run.ideas) || run.ideas.length !== IDEA_COUNT) {
    return { valid: false, error: `Expected ${IDEA_COUNT} ideas, got ${run.ideas ? run.ideas.length : 0}` };
  }
  for (let i = 0; i < run.ideas.length; i++) {
    const v = validateIdeaShape(run.ideas[i]);
    if (!v.valid) {
      return { valid: false, error: `Idea ${i + 1}: ${v.error}` };
    }
  }
  return { valid: true };
}

function resolveArchivePath(archiveRoot, dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  const resolved = path.resolve(archiveRoot, dateStr);
  const normalizedArchive = path.resolve(archiveRoot);
  if (!resolved.startsWith(normalizedArchive + path.sep) && resolved !== normalizedArchive) {
    throw new Error(`Path traversal detected: ${dateStr}`);
  }
  return resolved;
}

function archiveExists(archiveRoot, dateStr) {
  const jsonPath = path.join(resolveArchivePath(archiveRoot, dateStr), "ideas.json");
  return fs.existsSync(jsonPath);
}

function writeArchive(archiveRoot, dateStr, dailyRun, options = {}) {
  const { force = false } = options;
  const dir = resolveArchivePath(archiveRoot, dateStr);

  if (archiveExists(archiveRoot, dateStr) && !force) {
    throw new Error(`Archive already exists for ${dateStr}. Use --force to overwrite.`);
  }

  fs.mkdirSync(path.join(dir, "thumbnails"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });

  const runToWrite = { ...dailyRun };
  delete runToWrite.logs;
  delete runToWrite.thumbnail_status;

  const thumbnailStatuses = dailyRun.ideas.map((idea) => ({
    rank: idea.rank,
    title: idea.title,
    status: idea.thumbnail_status || "pending",
  }));

  fs.writeFileSync(path.join(dir, "ideas.json"), JSON.stringify({
    ...runToWrite,
    thumbnail_statuses: thumbnailStatuses,
  }, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), generateReport(dailyRun));

  if (dailyRun.logs && typeof dailyRun.logs === "object") {
    for (const [name, content] of Object.entries(dailyRun.logs)) {
      if (typeof content === "string") {
        fs.writeFileSync(path.join(dir, "logs", `${name}.log`), content);
      }
    }
  }

  return { dir, ideasPath: path.join(dir, "ideas.json"), reportPath: path.join(dir, "report.md") };
}

function readArchive(archiveRoot, dateStr) {
  const jsonPath = path.join(resolveArchivePath(archiveRoot, dateStr), "ideas.json");
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (e) {
    throw new Error(`Failed to read archive for ${dateStr}: ${e.message}`);
  }
}

function listArchiveDates(archiveRoot) {
  if (!fs.existsSync(archiveRoot)) return [];
  try {
    return fs.readdirSync(archiveRoot)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .filter((d) => fs.existsSync(path.join(archiveRoot, d, "ideas.json")))
      .sort()
      .reverse();
  } catch (e) {
    return [];
  }
}

function generateReport(dailyRun) {
  let md = `# Daily Candidate Ideas — ${dailyRun.date}\n\n`;
  md += `Generated: ${dailyRun.generated_at}\n`;
  md += `Provider: ${dailyRun.provider}\n`;
  md += `Ideas: ${dailyRun.ideas.length}\n\n`;
  md += `---\n\n`;

  for (const idea of dailyRun.ideas) {
    md += `## #${idea.rank} — ${idea.title}\n\n`;
    md += `**Score: ${idea.final_score || "N/A"}**\n\n`;
    md += `${idea.description}\n\n`;
    md += `### Scores\n\n`;
    md += `| Dimension | Score |\n`;
    md += `|-----------|-------|\n`;
    for (const key of SCORE_KEYS) {
      md += `| ${key} | ${idea.scores[key]}/10 |\n`;
    }
    md += `\n### Evidence\n\n`;
    for (const ev of idea.evidence) {
      md += `- **${ev.type}**: ${ev.title}`;
      if (ev.url) md += ` ([source](${ev.url}))`;
      if (ev.note) md += ` — ${ev.note}`;
      md += `\n`;
    }
    md += `\n### Thumbnail Prompt\n\n`;
    md += `${idea.thumbnail_prompt}\n\n`;
    md += `### Ranking Rationale\n\n`;
    md += `${idea.ranking_rationale}\n\n`;
    md += `### Thumbnail Status\n\n`;
    md += `${idea.thumbnail_status || "pending"}\n\n`;
    md += `---\n\n`;
  }

  return md;
}

function runDailyScout(options = {}) {
  const {
    date,
    provider = "fixture",
    force = false,
    dryRun = false,
    archiveRoot = DEFAULT_ARCHIVE_ROOT,
    inputPath,
  } = options;

  const dateStr = date || new Date().toISOString().slice(0, 10);
  const prov = getProvider(provider);
  const logs = {};

  logs.research = `[${new Date().toISOString()}] Starting research with provider: ${provider}\n`;
  let research;
  try {
    research = prov.research({ date: dateStr, inputPath });
  } catch (e) {
    logs.research += `[${new Date().toISOString()}] ERROR: ${e.message}\n`;
    return {
      ok: false,
      error: `Research failed: ${e.message}`,
      logs,
    };
  }

  if (!Array.isArray(research) || research.length === 0) {
    logs.research += `[${new Date().toISOString()}] ERROR: research returned empty or non-array\n`;
    return {
      ok: false,
      error: "Research returned empty results",
      logs,
    };
  }

  logs.research += `[${new Date().toISOString()}] Research complete: ${research.length} raw ideas\n`;

  logs.scoring = `[${new Date().toISOString()}] Synthesizing and scoring ${research.length} ideas\n`;
  let synthesized;
  try {
    synthesized = prov.synthesize(research);
  } catch (e) {
    logs.scoring += `[${new Date().toISOString()}] ERROR: ${e.message}\n`;
    return {
      ok: false,
      error: `Synthesis failed: ${e.message}`,
      logs,
    };
  }

  let ranked;
  try {
    ranked = rankIdeas(synthesized);
  } catch (e) {
    logs.scoring += `[${new Date().toISOString()}] ERROR: ranking failed: ${e.message}\n`;
    return {
      ok: false,
      error: `Ranking failed: ${e.message}`,
      logs,
    };
  }

  logs.scoring += `[${new Date().toISOString()}] Ranking complete\n`;
  for (const idea of ranked) {
    logs.scoring += `  #${idea.rank}: ${idea.title} (score: ${idea.final_score})\n`;
  }

  const dailyRun = {
    date: dateStr,
    generated_at: new Date().toISOString(),
    provider,
    ideas: ranked,
    logs,
  };

  const validation = validateDailyRunShape(dailyRun);
  if (!validation.valid) {
    logs.scoring += `[${new Date().toISOString()}] VALIDATION ERROR: ${validation.error}\n`;
    return {
      ok: false,
      error: `Validation failed: ${validation.error}`,
      logs,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      dailyRun,
      archivePath: resolveArchivePath(archiveRoot, dateStr),
      message: `Dry run complete. Would write archive to ${resolveArchivePath(archiveRoot, dateStr)}`,
    };
  }

  let archiveResult;
  try {
    archiveResult = writeArchive(archiveRoot, dateStr, dailyRun, { force });
  } catch (e) {
    return {
      ok: false,
      error: `Archive write failed: ${e.message}`,
      logs,
    };
  }

  return {
    ok: true,
    dryRun: false,
    dailyRun,
    archiveDir: archiveResult.dir,
    message: `Archive written to ${archiveResult.dir}`,
  };
}

module.exports = {
  DEFAULT_ARCHIVE_ROOT,
  IDEA_COUNT,
  WEIGHTS,
  SCORE_KEYS,
  registerProvider,
  getProvider,
  scoreCandidateIdea,
  rankIdeas,
  validateIdeaShape,
  validateDailyRunShape,
  resolveArchivePath,
  archiveExists,
  writeArchive,
  readArchive,
  listArchiveDates,
  generateReport,
  runDailyScout,
};
