# Data Model

Episode Factory stores one state object in browser `localStorage` under:

```text
vidtoolz-episode-factory-v1
```

The active focus session draft is stored separately under:

```text
vidtoolz-episode-factory-active-session-v1
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
  appVersion: "0.6.0",
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
