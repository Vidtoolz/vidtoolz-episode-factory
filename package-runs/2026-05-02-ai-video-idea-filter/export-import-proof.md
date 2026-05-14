# Export/import proof

Run: 2026-05-02-ai-video-idea-filter
Working title: Stop Letting AI Choose Your Video Strategy

## Browser actions

1. Opened `http://127.0.0.1:8010/index.html`.
2. Confirmed the main Episode Factory app loaded.
3. Confirmed `Export JSON` and `Import JSON` controls were visible.
4. Triggered `Export JSON` and captured the generated JSON blob in the browser context.
5. Wrote the captured export fixture to disk for review.
6. Fed the captured JSON back into the app through the hidden JSON file input.
7. Confirmed the import preview opened.
8. Confirmed import modes were visible.
9. Selected `merge-update` mode.
10. Canceled the import instead of confirming, to avoid changing local episode data.
11. Reloaded the app and confirmed the import preview was no longer open and controls were still visible.

## Export proof

- Export control visible: `True`
- Export control text: `Export JSON`
- Export status after click: `Exported 1 episodes.`
- Captured export MIME type: `application/json`
- Exported file path: `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/vidtoolz-episode-factory-captured-export.json`

## Import preview proof

- Import control visible: `True`
- Import control text: `Import JSON`
- Imported file path used: `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/vidtoolz-episode-factory-captured-export.json`
- Preview visible: `True`
- Preview status: `Import preview ready. Choose a mode and confirm to change local data.`
- Preview text excerpt:

```text
Import Preview

Review the JSON file before changing local episode data.

Current episodes
1
Imported episodes
1
New episodes
0
Matching episodes
1
Changed matches
0
Duplicates/conflicts
0
Skipped in merge
0
Imported work sessions
0
Conflicts and possible duplicates
No conflicts or possible duplicates found.
Changed matching episodes
No changed matching episodes found.
Import mode
Merge new episodes only
Merge and update matching episodes
Replace library
Confirm import
Cancel
```

## Merge/update mode proof

Modes visible in preview:

- `merge-new` checked initially: `True`
- `merge-update` checked initially: `False`
- `replace` checked initially: `False`

Modes after selecting merge/update:

- `merge-new` checked: `False`
- `merge-update` checked: `True`
- `replace` checked: `False`


## Reload/persistence check

- Import was canceled; no confirm/import write was performed.
- After cancel preview visible: `False`
- After cancel status: `Import canceled. Local data was not changed.`
- After reload preview visible: `False`
- After reload export visible: `True`
- After reload import visible: `True`

## Screenshots/logs actually captured

- Initial app screenshot: `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/episode-factory-export-import-initial.png`
- Import preview screenshot: `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/episode-factory-import-preview.png`
- Merge/update mode screenshot: `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/episode-factory-import-merge-update-mode.png`
- Observation log: `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/browser-export-import-observations.json`

## Readiness/approval safety

- The export/import flow did not mark the May 2 package run approved.
- The import preview included no package-run evidence acceptance or production approval action.
- Ready-to-shoot text exists in the generic Episode Factory board UI, but this browser action did not change the May 2 package-run evidence gate.
- The import was canceled, not confirmed.

## Conclusion

Partial pass. Export control was visible and produced usable JSON; import preview opened; merge/update mode was visible and selectable; cancel/reload behavior was checked. This proof does not move the May 2 package run to approved or ready-to-shoot.
