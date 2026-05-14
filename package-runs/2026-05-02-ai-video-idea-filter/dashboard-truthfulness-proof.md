# Dashboard truthfulness proof

Run: 2026-05-02-ai-video-idea-filter
Working title: Stop Letting AI Choose Your Video Strategy

## Exact commands run

```sh
node scripts/package-runs-index.js
node scripts/package-run-doctor.js package-runs/2026-05-02-ai-video-idea-filter
./scripts/verify.sh
```

The command outputs were captured for review in temporary shell output files:

- `/tmp/may2-index.txt`
- `/tmp/may2-doctor.txt`
- `/tmp/may2-verify.txt`

## package-runs-index result

Result: pass.

Observed output:

```text
Wrote package-runs-index.json
Indexed 3 package runs.
```

The rebuilt `package-runs-index.json` contains the May 2 run with:

- `runId`: `2026-05-02-ai-video-idea-filter`
- `title`: `Stop Letting AI Choose Your Video Strategy`
- `status`: `Needs capture`
- `workflowBucket`: `Needs QA repair`
- `creatorQaStatus`: `FAIL`
- `evidenceGate.status`: `not evaluated`
- `overallStatus`: `BLOCKED`
- `firstBlockerReason`: `Creator QA status is FAIL.`
- `nextRecommendedCommand`: `Review creator-qa-report.md and repair package/script before shooting.`
- `missingExpectedArtifacts`: `exact capture approval marker in capture-stage artifact`

Effective readiness in the index:

- `captureApproved`: `false`
- `readyForRoughCut`: `false`
- `publishReady`: `false`
- `readyToUpload`: `false`
- `readyToSchedule`: `false`
- `readyToArchive`: `false`
- `readyToCutShorts`: `false`
- `downstreamReadinessOverridden`: `true`
- `overrideReason`: `Capture evidence review status is READY FOR HUMAN APPROVAL; Capture evidence accepted is no. Raw downstream readiness markers are stale diagnostics until concrete capture evidence is accepted.`

## package-run-doctor result

Result: pass as a diagnostic command; the run itself remains blocked.

Observed doctor output for this run:

```text
Workflow bucket: Needs QA repair
Current inferred stage: Needs capture
Lifecycle status: Needs capture
Overall status: BLOCKED
Creator QA status: FAIL
Evidence gate status: not evaluated
First blocker: Creator QA status is FAIL.
Next safe action: Review the capture evidence manually and add an exact capture approval marker if accepted.
Next command: Review creator-qa-report.md and repair package/script before shooting.
```

The doctor also reported:

```text
Effective readiness:
- captureApproved: false
- readyForRoughCut: false
- publishReady: false
- readyToUpload: false
- readyToSchedule: false
- readyToArchive: false
- readyToCutShorts: false
- downstreamReadinessOverridden: true
- overrideReason: Capture evidence review status is READY FOR HUMAN APPROVAL; Capture evidence accepted is no. Raw downstream readiness markers are stale diagnostics until concrete capture evidence is accepted.
```

Blocking reasons:

- Creator QA status is FAIL.
- Exact capture-stage approval marker is missing from the capture-stage artifact.

Conservative blocked actions reported by doctor:

- upload
- publishing
- archive
- Hermes brain write
- project-state promotion

## verify.sh result

Result: pass.

Observed final test line from `/tmp/may2-verify.txt`:

```text
418/418 tests passed
```

The verify output also includes dashboard-specific tests passing:

```text
ok - package runs dashboard normalizes filters and renders run cards
ok - package runs dashboard renders lifecycle gate review data
ok - package runs dashboard formats capture evidence intake rows
ok - package runs dashboard flags missing capture evidence intake fields
ok - package runs dashboard browser write path requests local write config
ok - package runs dashboard renders safely with missing lifecycle fields
ok - package runs dashboard renders a safe markdown preview subset
```

## Dashboard bucket/status

Repo-supported dashboard model source: `package-runs-index.json`.

Current May 2 dashboard/model state:

- Dashboard workflow bucket: `Needs QA repair`
- Run status/current inferred stage: `Needs capture`
- Overall status: `BLOCKED`
- Creator QA: `FAIL`
- Evidence gate: `not evaluated`
- Effective ready-to-shoot/readiness state: no; downstream readiness is overridden.

## Truthfulness check

The dashboard/index model does not falsely promote the May 2 run to ready-to-shoot or production-approved.

It truthfully preserves the stronger blockers even though raw/stale downstream markers exist in individual artifacts:

- `production-plan.md` contains `READY TO SHOOT`, but dashboard/doctor do not treat it as authoritative.
- Capture-stage artifacts contain raw rough-cut/readiness markers, but effective readiness is overridden because capture evidence is not accepted.
- Creator QA is `FAIL`, which forces the dashboard bucket to `Needs QA repair`.

## Conclusion

Pass. The dashboard/index/doctor/verify chain reports the May 2 run truthfully as blocked: dashboard bucket `Needs QA repair`, stage `Needs capture`, overall status `BLOCKED`, Creator QA `FAIL`, and no effective ready-to-shoot state.
