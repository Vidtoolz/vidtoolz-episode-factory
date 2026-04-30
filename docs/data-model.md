# Data Model

Episode Factory stores one state object in browser `localStorage` under:

```text
vidtoolz-episode-factory-v1
```

The active focus session draft is stored separately under:

```text
vidtoolz-episode-factory-active-session-v1
```

Backup visibility metadata is stored separately under:

```text
vidtoolz-episode-factory-backup-status-v1
```

## State Object

```js
{
  version: 1,
  selectedId: "episode-id",
  episodes: []
}
```

- `version`: local state schema version.
- `selectedId`: the episode currently open in the detail pane.
- `episodes`: array of episode objects.

## Episode Object

Each episode is normalized by `episode-model.js`.

```js
{
  id: "episode-...",
  status: "Idea",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:00.000Z",
  version: 1,
  topic: "",
  workingTitle: "",
  targetViewer: "",
  viewerProblem: "",
  corePromise: "",
  titleOptions: "",
  thumbnailConcept: "",
  hook: "",
  scriptOutline: "",
  nextAction: "",
  workSessions: [],
  productionChecklist: "",
  editingChecklist: "",
  shortsPlan: "",
  publishChecklist: "",
  notes: "",
  checklists: {
    packagingGate: {
      "Viewer problem is clear": { passed: false }
    },
    productionChecklist: {},
    editingChecklist: {},
    shortsChecklist: {},
    publishChecklist: {}
  },
  packagingGate: {
    "Viewer problem is clear": { passed: false }
  }
}
```

Legacy date aliases `created_at` and `updated_at` are accepted during normalization and converted to `createdAt` and `updatedAt`.

The legacy text fields `productionChecklist`, `editingChecklist`, `shortsPlan`, and `publishChecklist` are preserved for v0.1 compatibility. The v0.2 UI uses the structured `checklists` object instead.

`nextAction` is an optional user override for the generated task title. Empty old episodes normalize to `nextAction: ""`.

`workSessions` stores completed execution history. Empty old episodes normalize to `workSessions: []`.

## Work Session Object

```js
{
  id: "session-...",
  createdAt: "2026-04-30T00:00:00.000Z",
  startedAt: "2026-04-30T11:00:00.000Z",
  endedAt: "2026-04-30T11:28:00.000Z",
  taskTitle: "Repair the episode package",
  taskType: "packagingBlocked",
  estimatedMinutes: 30,
  actualMinutes: 28,
  result: "Clarified promise and title options.",
  completedChecklistItems: [
    { groupKey: "packagingGate", item: "Core promise is concrete" }
  ],
  notes: "Still blocked: thumbnail needs a stronger visual.",
  nextActionAfterSession: "Sketch two thumbnail concepts"
}
```

Work sessions are stored on the episode so JSON export/import keeps execution history with the episode package.

Checklist items listed in `completedChecklistItems` are marked complete only when the user selects them during task completion.

`startedAt` and `endedAt` are optional ISO timestamp strings. Old work sessions that do not have these fields normalize to empty strings, so legacy backups remain valid. Completing an active focus session records `startedAt` from the active session draft and `endedAt` from the completion time. Completing a queue task without an active focus session records `endedAt` when possible and leaves `startedAt` empty.

`packagingGate` remains as a top-level alias of `checklists.packagingGate` for compatibility with v0.1 data and copy/export flows.

## Checklist Object

Each checklist group stores item labels as object keys. Each value has a `passed` boolean:

```js
checklists: {
  productionChecklist: {
    "Screen recording plan is clear": { passed: true },
    "Talking points are ready": { passed: false }
  }
}
```

The checklist groups are:

- `packagingGate`
- `productionChecklist`
- `editingChecklist`
- `shortsChecklist`
- `publishChecklist`

When old episodes are loaded, normalization adds every checklist group with default items and `passed: false` unless compatible structured state already exists.

## Readiness Scores

Readiness scores are calculated in `episode-model.js` and are not stored as separate source-of-truth fields.

- `packaging`: percentage of Packaging Gate items passed.
- `script`: percentage of required script/package fields that have usable content.
- `production`: average of Production Checklist, Editing Checklist, and Shorts Extraction Checklist completion.
- `publish`: percentage of Publish Checklist items passed.
- `overall`: average of packaging, script, production, and publish scores.

Scores are rounded integers from `0` to `100`.

## Execution Queue Tasks

Queue tasks are generated from episode data and are not stored as separate records.

```js
{
  id: "episode-id-packagingBlocked",
  type: "packagingBlocked",
  priority: 10,
  taskTitle: "Repair the episode package",
  episodeId: "episode-id",
  episodeTitle: "Episode title",
  status: "Packaging",
  reason: "Packaging readiness is 25%.",
  estimatedMinutes: 30,
  concreteSteps: [],
  successCriteria: [],
  sourceBlocker: "Packaging Gate: Viewer problem is clear"
}
```

Task types sort in this order:

1. `packagingBlocked`
2. `scriptNotReady`
3. `readyToShoot`
4. `editingIncomplete`
5. `readyToPublish`
6. `maintenance`

## Active Session Draft

Active sessions are app-level drafts, not episode records, and are not included in episode JSON export.

```js
{
  id: "active-...",
  task: {},
  episodeId: "episode-id",
  startedAt: 1760000000000,
  updatedAt: 1760000000000,
  elapsedSeconds: 0,
  isRunning: true
}
```

When completed, the active draft is converted into a normal `workSessions` entry on the episode and the active session key is cleared.

Active session progress is computed, not stored. It is the elapsed seconds divided by `task.estimatedMinutes * 60`, rounded to an integer and capped at `100`.

## Backup Status

Backup status is local browser metadata:

```js
{
  lastExportAt: "2026-04-30T12:00:00.000Z",
  lastImportAt: "2026-04-30T12:10:00.000Z"
}
```

The fields normalize to empty strings when missing or invalid. Export updates `lastExportAt`; import updates `lastImportAt`. This metadata is not part of the episode JSON export and does not affect import validation.

## App Status

The app status display is derived from state, active session draft, and backup status:

- Total episodes: `state.episodes.length`
- Total work sessions: sum of each episode's `workSessions.length`
- Last JSON export: `backupStatus.lastExportAt`
- Last JSON import: `backupStatus.lastImportAt`
- Active session: none, paused, or running with the current task title

## Weekly Review

Weekly review data is derived from the normalized state and is not stored separately.

```js
{
  generatedAt: "2026-04-30T12:00:00.000Z",
  pipelineCounts: {
    Idea: 1,
    Packaging: 0,
    Script: 0,
    "Ready to Shoot": 0,
    Editing: 1,
    "Ready to Publish": 1,
    Published: 0,
    Archived: 0
  },
  weeklySummary: {
    completedSessions: 2,
    totalFocusedMinutes: 58,
    episodesTouched: 2,
    touchedEpisodes: [],
    mostRecentSession: {},
    sessions: []
  },
  blockedEpisodes: [],
  closestToPublish: [],
  recommendedNextFocusSession: {}
}
```

`pipelineCounts` includes every status even when its count is zero.

`weeklySummary` uses work sessions completed in the last 7 days. A session's completion date is `endedAt` when present, otherwise `createdAt` for compatibility with old sessions.

`blockedEpisodes` includes active episodes whose readiness is below the dashboard thresholds:

- packaging below `80`
- script below `80`
- production below `80`
- publish below `100`

Published and archived episodes are excluded from blocked and closest-to-publish lists.

`closestToPublish` ranks active episodes by pipeline stage first, then publish, production, script, packaging, and overall readiness.

`recommendedNextFocusSession` is the first item from the existing Execution Queue sort order.

## Status Flow

Episodes use these statuses:

1. Idea
2. Packaging
3. Script
4. Ready to Shoot
5. Editing
6. Ready to Publish
7. Published
8. Archived

The board groups episodes by status. Status changes are saved immediately to `localStorage`.

## JSON Export

Export creates a JSON object with metadata plus the normalized state:

```js
{
  app: "VIDTOOLZ Episode Factory",
  appVersion: "0.9.0",
  schemaVersion: 1,
  storageKey: "vidtoolz-episode-factory-v1",
  exportedAt: "...",
  version: 1,
  selectedId: "...",
  counts: { episodes: 1 },
  episodes: []
}
```

## JSON Import

Import accepts:

- The exported object shape above.
- A compatible object with an `episodes` array.
- A raw array of episode objects for simple legacy backups.

Import validation happens before replacement. If validation fails, the current local data is left unchanged. If validation succeeds, the full current local episode library is replaced.
