# Creator QA rerun proof

Run: 2026-05-02-ai-video-idea-filter
Working title: Stop Letting AI Choose Your Video Strategy

## Exact commands run

Requested command attempted first:

```sh
node scripts/package-run-creator-qa.js package-runs/2026-05-02-ai-video-idea-filter --overwrite
```

Result: the script does not support `--overwrite`; it refused to replace existing QA artifacts and printed `creator-qa-report.md already exists. Use --force to replace QA artifacts.`

Actual rerun command:

```sh
node scripts/package-run-creator-qa.js package-runs/2026-05-02-ai-video-idea-filter --force
```

Inspection command:

```sh
sed -n '1,300p' package-runs/2026-05-02-ai-video-idea-filter/creator-qa-report.md
```

Note: the repo generated `creator-qa-report.md` and `creator-qa-report.json`; no `creator-qa.md` file exists for this run.

## Result

- Overall result: FAIL
- Score: 25/35
- Profile: ai_video_breakdown
- Checked package: Stop Letting AI Choose Your Video Strategy

## Category scores

- Expected package structure: 5/5
- YouTube title clarity: 4/5
- Thumbnail / title promise alignment: 4/5
- Viewer payoff: 3/5
- Script structure: 0/5
- Factual-claim risk: 4/5
- Resolve terminology accuracy: 5/5

## Failed checks

- Title does not state a clear viewer benefit.
- Thumbnail has no concrete visual promise.
- Viewer payoff is missing or unclear.
- Script is too thin for the ai_video_breakdown profile.
- Missing script structure part: hook.
- Missing script structure part: problem/context.
- Missing script structure part: promised outcome.
- Missing script structure part: demonstration/proof.
- Missing script structure part: recap or takeaway.
- Missing script structure part: call to action.


## Warnings

- Risky factual claims detected; source notes are present.

## Whether prior proof improved QA enough

No. Browser/manual proof, export/import proof, and selection rationale proof existed before this QA rerun, but Creator QA still failed with score 25/35. The strongest blocker is script structure: the generated QA report says the script is too thin and missing hook, context, promised outcome, demonstration/proof, recap/takeaway, and call to action.

## Conclusion

Fail. Creator QA was rerun with the repo-supported replacement flag and still failed. This prevents any ready-to-shoot or production-approved claim.
