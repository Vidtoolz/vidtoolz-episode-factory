# Package Run Doctor

`scripts/package-run-doctor.js` is a read-only local inspector for one VIDTOOLZ
package run folder. It does not generate workflow artifacts and does not change
the run.

## Usage

```sh
node scripts/package-run-doctor.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-doctor.js package-runs/YYYY-MM-DD-topic-slug --json
node scripts/package-run-doctor.js --help
```

For a shorter single-action view:

```sh
node scripts/package-run-next-action.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-next-action.js package-runs/YYYY-MM-DD-topic-slug --json
```

The next-action command reuses the doctor/index classification. It does not
mark runs ready, approve production, or write package-run files.

## What It Reports

The doctor reuses the package-runs index lifecycle logic and prints:

- run id and path
- workflow bucket
- current inferred stage
- lifecycle status
- overall status: `BLOCKED`, `NEEDS WORK`, `READY FOR NEXT STAGE`, or
  `COMPLETE ENOUGH FOR HUMAN REVIEW`
- Creator QA status
- Evidence Gate status
- blocking reasons
- lifecycle gate summary
- existing approval markers detected from local gate outputs
- detected known artifacts
- missing expected artifact for the current stage
- unknown/manual files
- exact next recommended command when one is deterministic
- first blocker reason when the local gate state makes it clear
- `read-only: yes`
- `external APIs called: no`

JSON mode is intended for future dashboard or Mission Control use. Text mode is
for quick terminal inspection.

## Safety Boundary

The doctor is read-only. It does not create, modify, move, delete, stage,
commit, push, clean, archive, upload, publish, call external APIs, update
Hermes, update project state, or create scheduled jobs.

It uses existing gate outputs rather than inventing readiness. Placeholder
content such as TODO, n/a, none, not applicable, or not assessed only counts as
ready when an upstream tool has already converted it into an explicit passing
gate state.

Unknown/manual files are listed separately. Their presence is not treated as an
error.

When `production-plan.md` exists but says `Shoot-readiness status: NEEDS SCRIPT
APPROVAL`, the next command points back to `package-run-script-review.js`
instead of rerunning production planning. The production plan is already telling
the workflow that the first blocker is upstream script review/revision.

For research evidence, Doctor distinguishes evidence intake from human review:

- `NEEDS EVIDENCE` in `research-sufficiency-review.md` routes back to
  `package-run-research-evidence.js`.
- `READY FOR RESEARCH REVIEW` means evidence is gathered but not approved; the
  next action is manual research review, not rerunning evidence intake.
- `PASS` requires exact research approval and lets downstream script-structure
  or script-review blockers surface.

## Finish Test

```sh
node scripts/package-run-doctor.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-doctor.js package-runs/YYYY-MM-DD-topic-slug --json
```

The JSON output should parse cleanly and include the same core lifecycle fields
as the text output.
