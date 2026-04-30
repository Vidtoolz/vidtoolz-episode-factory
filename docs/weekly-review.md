# Weekly Review Dashboard

The Weekly Review dashboard is for deciding what changed this week and what to do next.

It is derived from local episode data. It does not create new records, call external tools, or change JSON export/import behavior.

## What It Shows

- Pipeline counts for every episode status.
- Completed work sessions from the last 7 days.
- Total focused minutes from those sessions.
- Number of episodes touched by those sessions.
- Most recent completed session.
- Active episodes blocked by readiness thresholds.
- Active episodes closest to publish.
- One recommended next focus session from the existing Execution Queue priority.

## Weekly Session Counting

A work session counts for the week when its completion timestamp is within the last 7 days.

The completion timestamp is:

1. `endedAt` when present.
2. `createdAt` when `endedAt` is missing.

This keeps older v0.5-v0.7 work sessions useful in weekly review.

## Blocked Episodes

An active episode appears as blocked when one or more readiness scores are below the dashboard threshold:

- Packaging below 80%.
- Script below 80%.
- Production below 80%.
- Publish below 100%.

Published and archived episodes are excluded.

## Closest To Publish

Closest-to-publish ranking excludes published and archived episodes. It sorts by production stage first, then publish, production, script, packaging, and overall readiness.

This means a `Ready to Publish` episode appears above an `Editing` episode, and ties are broken by readiness.

## Copy Outputs

The dashboard can copy:

- Hermes weekly memory update.
- Linear weekly progress summary.
- Creator review markdown.

These are clipboard-only text outputs. They do not call Hermes, Linear, GitHub, or any external API.

## Suggested Use

1. Review pipeline counts to see where work is piling up.
2. Check weekly work to confirm what actually moved.
3. Scan blocked episodes for the weakest constraint.
4. Check closest-to-publish before starting a new idea.
5. Start the recommended focus session or copy a weekly summary for external notes.
