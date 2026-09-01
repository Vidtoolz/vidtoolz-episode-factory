# Final Asset Production

The manual production loop for the 20 final visual assets, with the system
handling every piece of bookkeeping and none of the creative decisions.

```
PROMPT_READY
  → Mikko generates the image in GPT Image (manual)
  → ingest-image      immutable candidate, hashed and beat-bound     GENERATED
  → Mikko selects explicitly                                         SELECTED_IMAGE
  → still beat:  FINAL_ASSET_SELECTED
  → video beat:  I2V_READY → image-bound Kling prompt
                 → Mikko generates the clip in Kling (manual)
                 → ingest-video                                      VIDEO_GENERATED
                 → Mikko selects explicitly                          FINAL_ASSET_SELECTED
```

## The two absolute rules

**GENERATED is not SELECTED.** A technically valid file is a candidate, never a
decision. Ingest always records `selected: false`; selection is a separate call
that requires a named human authority.

**No final I2V authority without a hash-bound selected image.** The Kling
prompt describes one specific image, so it cannot exist before that image is
chosen — and it goes stale the moment a different one is.

## Commands

```bash
final-assets next          --run-id <run>                       # what to do next, prompt included
final-assets prompt        --run-id <run> --beat <beat>
final-assets ingest-image  --run-id <run> --beat <beat> --file <path>
final-assets select-image  --run-id <run> --beat <beat> --candidate <sha|id> --authority "Mikko Pakkala"
final-assets reject        --run-id <run> --beat <beat> --candidate <sha|id> --authority "..." [--note "..."]
final-assets alternate     --run-id <run> --beat <beat> --candidate <sha|id> --authority "..."
final-assets set-role      --run-id <run> --beat <beat> --role <FINAL_STILL_CANDIDATE|FINAL_VIDEO_SOURCE_CANDIDATE> --authority "..."
final-assets kling-prompt  --run-id <run> --beat <beat>
final-assets ingest-video  --run-id <run> --beat <beat> --file <path>
final-assets select-video  --run-id <run> --beat <beat> --candidate <sha|id> --authority "Mikko Pakkala"
final-assets queue | progress | project --run-id <run>
```

Add `--json` for the full machine record. The operator supplies a run, a beat,
a file and a decision — nothing else. Hashes, asset identity, prompt authority,
provenance, beat binding, state transitions and I2V gating are resolved by the
tool. A candidate can be named by asset id, full sha or any unambiguous sha
prefix of 8+ characters.

## What the tool refuses to do

It never calls GPT Image or Kling. It never picks an asset: there is no code
path that selects without a named human authority, and authorities that look
machine-shaped (`MACHINE_SELECTOR`, `machine*`, `auto*`, `agent*`, `tool*`) are
refused outright. It never mutates the lock, the package, the Resolve blueprint
or the approved Draft — the Resolve resolution lands in its own projection
artifact.

## Candidates, rejection and alternates

A beat may hold any number of image and clip candidates, each with immutable
identity and bytes. Dispositions: `CANDIDATE`, `KEEP_AS_ALTERNATE`, `REJECTED`,
`SELECTED`, `SUPERSEDED`. A rejected candidate keeps its bytes and record
forever and can never become current or satisfy completion; a note is optional.
Rejecting every candidate returns the beat to `PROMPT_READY`.

## Re-selection

Choosing a different image supersedes the previous one, archives the current
Kling prompt into `stale_motion_prompts`, marks every clip `SUPERSEDED`, and
clears the clip selection. Nothing is deleted — the historical prompt record
and clip bytes stay readable. The next `kling-prompt` mints
`prompt_version + 1` bound to the new image.

## Role override

The package's 12-still / 8-video split is a recommendation with a stated basis.
`set-role` changes it with a named human authority (recording what was
recommended), and the beat state is re-derived: switching to a video source
un-completes a still beat and unlocks the I2V workflow; switching back lets the
selected image satisfy the beat immediately. Roles never change silently.

## Validation is technical, not creative

Ingest checks existence, decode, format, dimensions and hash stability. An
aspect ratio outside the 9:16 tolerance is recorded as a **warning**, not a
refusal — the edit can reframe, and refusing Mikko's chosen image on arithmetic
would be the tool overruling the human. Identical bytes re-ingested for the
same beat return `ALREADY_REGISTERED`; identical bytes aimed at a different
beat are refused (`FINAL_ASSET_CROSS_BEAT_BINDING`).

## Completion

A still beat completes on a selected image. A video beat needs a selected
image, a current bound prompt and a selected clip; the image remains provenance
on the final video asset. Nothing partial satisfies completion, and no state in
this workflow grants final QC or publication authority — performance, music,
the Resolve edit, QC and publication all remain outside it.
