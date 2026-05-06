# Trailer Cue Generator v1.1

Trailer Cue Generator v1.1 creates a local, deterministic prep folder for a 2-minute VIDTOOLZ trailer cue.

It does not call AI APIs, generate audio, control DaVinci Resolve, control a DAW, load plugins, or render stems. It writes inspectable planning files and simple MIDI files that can be imported manually.

## Create A Cue Folder

```sh
node scripts/trailer-cue-new.js "AI video workflow trailer"
```

This creates:

```text
trailer-cues/YYYY-MM-DD-ai-video-workflow-trailer/
```

Use a fixed date when you need deterministic folder names in tests or repeatable local runs:

```sh
node scripts/trailer-cue-new.js "AI video workflow trailer" --date 2026-05-06
```

Use the initial v1.1 preset for a Red Riding Hood / dark fairytale trailer cue:

```sh
node scripts/trailer-cue-new.js "Red Riding Hood trailer" --preset dark-fairytale-trailer
```

Use `--out` to choose a different output root:

```sh
node scripts/trailer-cue-new.js "AI video workflow trailer" --out /tmp/trailer-cues
```

Show supported CLI usage:

```sh
node scripts/trailer-cue-new.js --help
```

Current supported options are `--out`, `--date`, `--preset`, and `--help`. Supported presets:

- `dark-fairytale-trailer`: changes the generic cue into a Red Riding Hood / dark fairytale trailer structure with darker section names, story-specific marker labels, dark fairytale patch recommendations, validation prompts, lower MIDI ranges, and denser chase rhythm.

Unsupported presets fail with a clear error and no cue folder is created.

## Generated Files

- `section-map.md`: 02:00 trailer structure with section purpose and musical direction.
- `tempo-map.md`: deterministic tempo ramp for the cue.
- `resolve-markers.csv`: marker rows for manual Resolve import or manual marker recreation.
- `patch-recommendations.md`: suggested sound sources for later human sound design.
- `render-checklist.md`: review checklist before any later audio bounce.
- `test-notes.md`: manual validation template for musical usability, patch choices, timing, marker usefulness, and final sting strength.
- `motif.mid`: sparse identity notes and payoff return.
- `drone.mid`: long low support notes.
- `pulse.mid`: deterministic trailer pulse pattern.
- `riser.mid`: tonal riser notes for the build and climax.
- `climax-hits.mid`: impact hit timing.
- `final-sting.mid`: short ending gesture.

## Design Limits

- MIDI files contain note, tempo, time-signature, track-name, and program-change events only.
- Patch names are recommendations in Markdown, not plugin commands.
- Resolve markers are CSV text only; the script does not connect to Resolve.
- Existing files are not overwritten if their content differs. The CLI reports those as `skipped` and exits with code `2`.

## Manual Validation

Run a real-world validation pass before treating the generator as musically proven:

1. Generate a cue folder.
2. Import the six MIDI stems into a DAW as separate tracks.
3. Assign Omnisphere, UVI, Arturia, or other local patches manually.
4. Render stems manually from the DAW.
5. Assemble stems manually in Resolve/Fairlight against a 2-minute trailer timeline.
6. Fill `test-notes.md` in the generated cue folder.

See [trailer-cue-validation-workflow.md](trailer-cue-validation-workflow.md) for the full manual test pass.

## Verification

Run:

```sh
./scripts/verify.sh
```

The test suite checks deterministic folder naming, artifact coverage, section and tempo shape, marker CSV output, MIDI headers, and safe-write behavior.
