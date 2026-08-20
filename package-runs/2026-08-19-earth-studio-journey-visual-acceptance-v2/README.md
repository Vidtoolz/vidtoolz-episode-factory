# Fresh current-creator evaluation set v2

Created from blank journey definitions on 2026-08-19T14:00:00.000Z using the current Journey Creator model and production lane. Seven projects cover local, city, regional, long-distance/orbit, multi-destination, and exact continuation behavior. Automated reports are technical gates only; Mikko's visual judgment remains blank in the checklist.

- Projects: 7
- Source: current `earth-studio-journey.js` + `earth-studio-lane.js`
- Checklist: `operator-checklist.md`
- Legacy inventory: `legacy-samples-retirement.md`

## Automated review preparation

From `/home/vidtoolz` run:

```bash
node scripts/earth-studio-visual-review.js
```

The launcher opens the authenticated Earth Studio context, prepares A, verifies
the imported duration/project identity/timeline frame 0/no blocking errors, and
prints `READY_TO_PLAY`. It never starts playback. Use the local controller URL
printed by the launcher for **Previous**, **Prepare/Open**, **Next**, and optional
human notes/decision entry.
