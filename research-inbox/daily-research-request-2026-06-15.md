# Daily Idea Scout — research request (2026-06-15)

**Human-in-the-loop.** This brief is for you to run in your own web/LLM session.
The scout itself makes no web or LLM calls. When you have results, save them as a
`.md` (or `.json`) file and feed them back through the manual provider.

## 1. Research themes (search these)

- Trending YouTube topics in video production / editing
- AI video tool + model updates (FLUX, Wan2.2, Kling, Runway, DaVinci Neural Engine)
- DaVinci Resolve workflows, new features, and recurring pain points
- Solo-creator production systems and workflow gaps
- Trust / disclosure / proof issues in AI-assisted video

Gather 20–30 raw signals (titles, one-line summaries, an evidence URL, and how
recent/strong each signal is). Then synthesize them down to **exactly 15**
candidate video ideas.

## 2. Return format (paste your 15 ideas in EXACTLY this Markdown shape)

Rules the manual provider enforces:
- **Exactly 15 ideas**, each as a `## ` heading (plain title — no leading numbers).
- Every idea needs: Description, Thumbnail Prompt, at least one Evidence row, all
  six Scores (each **1–10**), and a Ranking Rationale.
- `trust_risk` is the RAW risk (higher = riskier); the scout inverts it when scoring.
- Evidence rows are `type | title | url | note` (url and note optional).

```markdown
## A punchy, searchable video title (40–60 chars)
Description: 150-ish words — hook, main points, the on-screen proof, the takeaway.
Thumbnail Prompt: detailed FLUX visual description — composition, text overlay, mood, no fake-proof.
Evidence:
- trend | What you observed | https://source.example | why it matters
- trust_issue | A second signal | https://source.example | optional note
Scores:
  - niche_fit: <1-10>
  - practical_usefulness: <1-10>
  - trust_risk: <1-10>
  - production_feasibility: <1-10>
  - view_potential: <1-10>
  - timeliness: <1-10>
Ranking Rationale: one sentence on why this idea scores high.
```

Repeat that block **15 times**.

> Tip: a fenced ```json``` block of `{ "ideas": [ ... ] }` is also accepted if you
> prefer JSON — same fields (title, description, thumbnail_prompt, evidence[], scores{}, ranking_rationale).

## 3. Feed it back

```bash
# validate without writing anything:
node scripts/daily-idea-scout-launch.js --provider=manual --input=<your-file>.md --dry-run
# then archive for the day:
node scripts/daily-idea-scout-launch.js --provider=manual --input=<your-file>.md --date=2026-06-15
```

Thumbnails stay `pending` — generation is deferred until a real manual run has
validated the archive schema. Nothing here is approved or published automatically.
