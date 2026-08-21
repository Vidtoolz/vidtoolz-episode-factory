# Earth Studio terrain-tilt visual calibration

This package is a controlled, experiment-only review of the current 72° SHOW_TERRAIN camera treatment. Production policy is unchanged.

- Subjects: Matterhorn, Mount Fuji, Grand Canyon, Geirangerfjord.
- Candidate tilts: 45°, 55°, 65°, 72° CURRENT, 74°.
- The requested 78° stress candidate was replaced by 74° because preserving Matterhorn's current orbit radius at 78° would violate its 5,500 m terrain safety floor.
- For each subject, target, ground radius, start bearing, direction, 180° span, 30 s duration, easing, frame rate, heading policy, and live keyframe density are fixed. Altitude is the physically coupled variable and is recorded explicitly.
- Technical checks are not aesthetic approval. Mikko decides the useful tilt after real Earth Studio playback.

## Real Earth Studio gate

- 20/20 candidates imported into the authenticated Google Earth Studio application.
- Scene-model readback confirmed 900 frames at 30 fps, exact authored tilt, zero roll, stable altitude, and no terminal pan or physical path reversal in every candidate.
- `screenshots/` contains frame 0, quarter-orbit, and midpoint captures for each candidate (60 images total).
- `real-earth-studio/summary.json` is the machine-readable import summary; the per-candidate files retain opening and terminal scene-model traces.
- These facts establish technical review readiness only. They do not choose or approve an angle.

Run the review with:

```bash
node scripts/earth-studio-terrain-tilt-review.js
```

Workflow: choose subject → play angles → select winner → optional note → next. Choices are written to `review-session.json`; the template remains untouched.
