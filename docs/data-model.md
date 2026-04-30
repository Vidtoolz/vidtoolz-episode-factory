# Data Model

Episode Factory stores one state object in browser `localStorage` under:

```text
vidtoolz-episode-factory-v1
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
  productionChecklist: "",
  editingChecklist: "",
  shortsPlan: "",
  publishChecklist: "",
  notes: "",
  packagingGate: {
    "Viewer and problem are specific": { passed: false }
  }
}
```

Legacy date aliases `created_at` and `updated_at` are accepted during normalization and converted to `createdAt` and `updatedAt`.

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
  appVersion: "0.1.0",
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
