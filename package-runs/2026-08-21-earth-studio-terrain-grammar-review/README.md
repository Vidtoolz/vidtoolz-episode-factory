# Earth Studio terrain-grammar visual calibration

Production grammar and the accepted morphology tilt table are unchanged. This package compares the exact current auto-directed shot with an experiment-only target-locked terrain-form orbit.

- Eight locally supported subjects; two treatments each; 16 importable ESPs.
- CURRENT is generated from the exact natural prompt through the live Director.
- TERRAIN FORM uses the same prompt and accepted morphology tilt. Region fixtures are deliberately bounded to a district-scale local inspection and labelled as stress tests.
- There is no OBLIQUE REVEAL candidate: the engine has no existing target-locked oblique reveal primitive. Calling fly_low a reveal would be dishonest because it points past the target.
- Identical CURRENT/TERRAIN FORM bytes on compact subjects are retained as controls showing that production already selects terrain form there.

Run:

```bash
node scripts/earth-studio-terrain-grammar-review.js
```

Workflow: subject → candidate shots → winner → optional note → next. Choices are persisted to `review-session.json`.

Judge geographic comprehension, relief, scale, whether the movement feels earned, restraint, and whether you would use the treatment in a finished VIDTOOLZ map video. For region-scale TERRAIN FORM candidates, judge the local inspection honestly: it is deliberately not presented as a view of the entire range or region.

## Operator-authority audit

Explicit pull-back, no-orbit, hover, and locate/context instructions remain authoritative in production. One existing gap is now explicit: `Orbit the Grand Canyon.` is parsed as an explicit slow orbit, but the current region-scale hard guard leaves it with no at-location beat. This package does not change that production behavior. Its TERRAIN FORM candidate uses an experiment-only district framing so Mikko can judge the treatment before a later mission decides how explicit region-orbit feasibility should be represented.

## Real Earth Studio validation

- 16/16 ESPs imported successfully in the authenticated application.
- 32 screenshots were captured: opening and midpoint for every candidate. The Alps and Himalayas CURRENT frame-zero canvases remained blank in headless capture; their midpoint evidence is valid and the interactive controller imports the full live projects.
- Duration, frame rate, authored tilt, finite scene-model state, and zero roll passed 16/16.
- Terminal pan remained monotonic 16/16.
- Physical bearing remained monotonic 16/16 under the strict 0.00001° diagnostic after each sampled rendered frame received the normal Earth Studio visual settle. A faster preliminary readback produced a transient Fuji value; it did not reproduce under the authoritative settled probe and is not camera evidence.
