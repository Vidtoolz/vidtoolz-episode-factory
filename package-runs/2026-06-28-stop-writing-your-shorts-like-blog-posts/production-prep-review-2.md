# Production Prep Review 2

## Verdict

APPROVE FOR PRODUCTION PLAN

## What was fixed

- Removed unsupported `AI tool generating 10 generic video ideas` capture from `shooting-plan.md` and `b-roll-list.md`.
- Removed unsupported four-part filter table capture from `shooting-plan.md` and `b-roll-list.md`.
- Removed unsupported weak-AI-idea scoring and revision captures from `shooting-plan.md` and `b-roll-list.md`.
- Removed unsupported final title + thumbnail comparison capture from `shooting-plan.md` and `b-roll-list.md`.
- Replaced those items with script-supported production elements:
  - presenter A-roll
  - dense blog-style Shorts script visual
  - over-polished script detail visual
  - viewer scrolling past a text-heavy Short
  - fluff removal visual
  - blog post vs Short contrast card
  - tight vertical beat sequence / timeline visual
- Changed `Working title: Selected Package` to `Working title: Stop Writing Your Shorts Like Blog Posts` in the relevant prep files.
- Removed generic tool-demo/screen-capture assumptions from `production-brief.md`.
- Adjusted `resolve-edit-checklist.md` to reference A-roll, B-roll, graphics, typography, contrast cards, and visual support instead of screen recordings, demo footage, and UI zooms.

## Remaining risks

- The approved final script is short, so the edit must carry the idea with pacing, visuals, and performance rather than adding new claims.
- Visual support must stay simple and readable on mobile.
- Mikko still needs to approve the repaired production prep before `production-plan.md` is created.

## Required fixes before production-plan.md

none

## Suggested Mikko approval wording

“Mikko approves the repaired production prep for `2026-06-28-stop-writing-your-shorts-like-blog-posts` and authorizes creation of `production-plan.md`. Do not start media generation yet.”

## Next safe command after approval

```bash
node scripts/package-run-production-plan.js package-runs/2026-06-28-stop-writing-your-shorts-like-blog-posts
```

Do not run this command until Mikko gives explicit approval.
