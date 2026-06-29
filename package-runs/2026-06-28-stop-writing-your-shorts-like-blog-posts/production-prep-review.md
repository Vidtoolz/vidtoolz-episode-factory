# Production Prep Review

## Verdict

DO NOT APPROVE YET

## Summary

The production-prep set is structurally useful, but it is not ready for `production-plan.md` approval yet. The core package, final outline, graphics notes, Resolve checklist, thumbnail/title direction, and publish pack mostly match the approved final script. The main problem is that the generated `shooting-plan.md` and `b-roll-list.md` include unsupported demo/capture ideas about AI tools, generic video ideas, a four-part filter, and revising weak AI ideas. Those do not come from the approved final script for this run.

## Checked files

- `final-script.md`
- `selected-package.md`
- `final-outline.md`
- `production-brief.md`
- `shooting-plan.md`
- `b-roll-list.md`
- `graphics-list.md`
- `resolve-edit-checklist.md`
- `thumbnail-title-check.md`
- `publish-pack.md`

## What works

- The selected package and final outline are aligned with the approved final script.
- The core production direction is correct: vertical short, presenter-led, 1080x1920, practical visual support.
- The central idea is clear: Shorts should be written as spoken, visual sequences, not blog posts.
- The graphics list is simple but directionally correct: show the writing difference instead of decorating the frame.
- The Resolve checklist is practical and safe as a generic edit checklist.
- Thumbnail/title notes preserve the main package idea: `Stop Writing Your Shorts Like Blog Posts` and `NOT A BLOG POST`.
- The publish pack does not claim the video is complete or ready to upload.

## Problems / risks

- `shooting-plan.md` invents screen-recording/demo requirements that are not in the final script:
  - AI tool generating 10 generic video ideas
  - four-part filter table
  - scoring a weak AI idea
  - revising a weak AI idea into a stronger package
  - final title + thumbnail comparison
- `b-roll-list.md` repeats the same unsupported AI-tool/filter demo items.
- `production-brief.md` uses `Working title: Selected Package` instead of the actual working title.
- `thumbnail-title-check.md` also uses `Working title: Selected Package`.
- Several prep artifacts are generic templates. That is acceptable for a prep draft, but the unsupported demo items would mislead production planning if copied forward.

## Required fixes before production-plan.md

1. Replace unsupported AI-tool/filter demo items in `shooting-plan.md` with visuals that match the final script:
   - dense blog-style Shorts script
   - polishing too many details
   - filming and getting no traction
   - viewers scrolling past
   - crossing out fluff
   - turning paragraphs into punchy spoken beats
   - blog-post versus Short contrast
2. Replace unsupported AI-tool/filter demo items in `b-roll-list.md` with the same script-aligned visual beats.
3. Change `Working title: Selected Package` to `Working title: Stop Writing Your Shorts Like Blog Posts` in production-prep files where it appears.
4. Keep the final script unchanged.
5. Do not create `production-plan.md` until Mikko approves the corrected production prep.

## Suggested Mikko approval wording

“Mikko approves the corrected production prep for `2026-06-28-stop-writing-your-shorts-like-blog-posts` and authorizes creation of `production-plan.md`. Do not start media generation yet.”

## Next safe command after approval

After the fixes above are made and Mikko approves the corrected prep, the likely next command is:

```bash
node scripts/package-run-production-plan.js package-runs/2026-06-28-stop-writing-your-shorts-like-blog-posts
```

Do not run this command until approval is explicit.
