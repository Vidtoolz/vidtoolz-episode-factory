# Trailer Cue Validation Workflow

This is the manual real-world test pass for Trailer Cue Generator v1. It verifies whether the generated maps and MIDI stems are musically useful in an actual production chain.

This workflow is local-first. It does not call AI APIs, automate DAWs, automate Omnisphere, UVI, Arturia, Resolve, or Fairlight, generate audio inside the generator, or publish anything.

## Done Means

- A trailer cue folder exists locally.
- All six MIDI stems import into a DAW as separate tracks.
- Human-selected Omnisphere, UVI, Arturia, or other local patches are assigned manually.
- Audio stems are rendered manually from the DAW.
- Stems are assembled manually in Resolve/Fairlight against a 2-minute trailer timeline.
- `test-notes.md` is filled with musical usability, patch choices, section timing, Resolve marker usefulness, and final sting strength notes.

## Manual Test Pass

1. Generate a cue folder:

```sh
node scripts/trailer-cue-new.js "Trailer validation pass"
```

2. Open the generated folder under `trailer-cues/`.
3. Review `section-map.md`, `tempo-map.md`, `patch-recommendations.md`, and `render-checklist.md`.
4. Import `resolve-markers.csv` into Resolve, or recreate the markers manually if CSV import does not fit the project.
5. Import these MIDI files into a DAW as separate tracks:

```text
motif.mid
drone.mid
pulse.mid
riser.mid
climax-hits.mid
final-sting.mid
```

6. Assign local patches manually. Use Omnisphere, UVI, Arturia, or other installed instruments as appropriate.
7. Render separate audio stems manually from the DAW.
8. Assemble the rendered stems manually in Resolve/Fairlight against the trailer timeline.
9. Check section timing against markers and edit points.
10. Check whether the cue leaves room for dialogue, effects, and end-card readability.
11. Fill `test-notes.md` in the cue folder.

## What To Record

In `test-notes.md`, record:

- Musical usability: whether the MIDI material is useful, too sparse, too busy, or structurally wrong.
- Patch choices: exact instrument and patch choices for motif, drone, pulse, riser, climax hits, and final sting.
- Section timing: whether each section starts and ends where the trailer edit needs it.
- Resolve marker usefulness: whether marker names, colors, timecodes, and durations helped the edit.
- Final sting strength: whether the ending hit is strong enough, too large, too long, or too weak.

## Failure Conditions

- MIDI stems do not import cleanly.
- Section timing does not fit a 2-minute trailer structure.
- Resolve markers are misleading or not useful.
- Patch recommendations are too vague to guide manual sound design.
- Final sting does not work under an end card or logo.
- The workflow requires DAW/plugin automation to be usable.

## Follow-Up

If the validation pass exposes a problem, edit the deterministic generator or documentation and rerun:

```sh
./scripts/verify.sh
```
