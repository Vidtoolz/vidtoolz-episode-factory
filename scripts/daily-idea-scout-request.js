#!/usr/bin/env node
"use strict";

// Daily Idea Scout — research-request generator (human-in-the-loop).
//
// This does NOT research the web or call any LLM. It emits a dated brief that
// the operator runs in their OWN web/LLM session, then pastes the result back
// through the existing MANUAL provider. That keeps generation human-supervised
// and the scout free of live web/LLM/API calls (per the repo's "no hidden
// automation / no automated topic generation" boundary).
//
// Flow:
//   1. node scripts/daily-idea-scout-request.js [--date=YYYY-MM-DD] [--out=PATH]
//   2. Operator does the research + synthesis externally, fills the format below.
//   3. node scripts/daily-idea-scout-launch.js --provider=manual --input=<file> --dry-run
//   4. ...then drop --dry-run to archive.

const fs = require("node:fs");
const path = require("node:path");
const scout = require("./daily-idea-scout.js");

const SEARCH_THEMES = [
  "Trending YouTube topics in video production / editing",
  "AI video tool + model updates (FLUX, Wan2.2, Kling, Runway, DaVinci Neural Engine)",
  "DaVinci Resolve workflows, new features, and recurring pain points",
  "Solo-creator production systems and workflow gaps",
  "Trust / disclosure / proof issues in AI-assisted video",
];

function todayHelsinki() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function buildResearchRequest(dateStr) {
  const date = dateStr || todayHelsinki();
  const count = scout.IDEA_COUNT;
  const scoreKeys = scout.SCORE_KEYS;
  const scoreLines = scoreKeys.map((k) => `  - ${k}: <1-10>`).join("\n");

  return `# Daily Idea Scout — research request (${date})

**Human-in-the-loop.** This brief is for you to run in your own web/LLM session.
The scout itself makes no web or LLM calls. When you have results, save them as a
\`.md\` (or \`.json\`) file and feed them back through the manual provider.

## 1. Research themes (search these)

${SEARCH_THEMES.map((t) => `- ${t}`).join("\n")}

Gather 20–30 raw signals (titles, one-line summaries, an evidence URL, and how
recent/strong each signal is). Then synthesize them down to **exactly ${count}**
candidate video ideas.

## 2. Return format (paste your ${count} ideas in EXACTLY this Markdown shape)

Rules the manual provider enforces:
- **Exactly ${count} ideas**, each as a \`## \` heading (plain title — no leading numbers).
- Every idea needs: Description, Thumbnail Prompt, at least one Evidence row, all
  six Scores (each **1–10**), and a Ranking Rationale.
- \`trust_risk\` is the RAW risk (higher = riskier); the scout inverts it when scoring.
- Evidence rows are \`type | title | url | note\` (url and note optional).

\`\`\`markdown
## A punchy, searchable video title (40–60 chars)
Description: 150-ish words — hook, main points, the on-screen proof, the takeaway.
Thumbnail Prompt: detailed FLUX visual description — composition, text overlay, mood, no fake-proof.
Evidence:
- trend | What you observed | https://source.example | why it matters
- trust_issue | A second signal | https://source.example | optional note
Scores:
${scoreLines}
Ranking Rationale: one sentence on why this idea scores high.
\`\`\`

Repeat that block **${count} times**.

> Tip: a fenced \`\`\`json\`\`\` block of \`{ "ideas": [ ... ] }\` is also accepted if you
> prefer JSON — same fields (title, description, thumbnail_prompt, evidence[], scores{}, ranking_rationale).

## 3. Feed it back

\`\`\`bash
# validate without writing anything:
node scripts/daily-idea-scout-launch.js --provider=manual --input=<your-file>.md --dry-run
# then archive for the day:
node scripts/daily-idea-scout-launch.js --provider=manual --input=<your-file>.md --date=${date}
\`\`\`

Thumbnails stay \`pending\` — generation is deferred until a real manual run has
validated the archive schema. Nothing here is approved or published automatically.
`;
}

function parseArgs(argv) {
  const opts = { out: null };
  for (const arg of argv) {
    if (arg.startsWith("--date=")) opts.date = arg.slice(7);
    else if (arg.startsWith("--out=")) opts.out = arg.slice(6);
    else if (arg === "-h" || arg === "--help") opts.help = true;
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(
      "Usage: node scripts/daily-idea-scout-request.js [--date=YYYY-MM-DD] [--out=PATH]\n" +
      "Emits the daily human-in-the-loop research brief. Prints to stdout unless --out is given.\n"
    );
    return 0;
  }
  const md = buildResearchRequest(opts.date);
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(path.resolve(opts.out), md);
    process.stdout.write(`Research request written to ${path.resolve(opts.out)}\n`);
  } else {
    process.stdout.write(md);
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { SEARCH_THEMES, buildResearchRequest, todayHelsinki };
