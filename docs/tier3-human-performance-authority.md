# Tier-3 human performance authority

One immutable human capture can be either a `SECTION_TAKE` or a `BATCH_MASTER`.
Both use the same source authority. A performance segment references an exact
interval of the master SHA-256; it is not another recording, and a convenience
render never replaces its source master.

Human origin and capture quality are separate facts. The PRESTO C920 profile is
`REAL_HUMAN_PERFORMANCE` with quality class `PROOF_CAPTURE`; its nominal 30 fps
request is never accepted as measured cadence. A later production-quality
capture can supersede it without rewriting its historical human identity.

`scripts/presenter-source-authority.js` keeps these facts separate:

- captured master bytes and bound capture sidecar;
- technical validity from fresh hash and media probing;
- human review of the exact master set;
- human selection of exact section segments;
- assembly eligibility, which additionally requires complete coverage and
  `CAPTURE_EVENT_BOUND` or `HUMAN_CONFIRMED` timing.

Transcript alignment, VAD and waveform analysis may propose boundaries as
`TRANSCRIPT_ALIGNED_PROVISIONAL` or `MACHINE_INFERRED_PROVISIONAL`. They cannot
become assembly inputs until a human confirms them. No Whisper dependency is
therefore required for source registration, while no missing transcription can
silently turn a guess into authority.

`KEEP ALL` accepts the exact reviewed master bytes as legitimate performance
sources. It does not select every frame, establish section timecodes, approve an
edit, complete Gate 9 or approve Gate 10.

The current Production rough-cut policy remains intentionally `PLANNED`: a
human NLE creates the edit. The Draft assembler may not stand in for it. The
machine-readable interface for a future bounded technical implementation is
`config/production-assembly-handoff-contract.json`; its proposed evidence class
cannot satisfy a human gate.

## First-run cadence finding

The accepted A/T/C masters are variable-rate H.264. Their container stream
headers expose `r_frame_rate=30/1`, while `avg_frame_rate` and frame counts are
about 23.7–24.0 fps. Ten-second decoded samples from all three masters contained
240–241 frames and zero adjacent duplicate frame hashes. The earlier “about 15
unique frames inside 30 fps” result therefore does not describe the accepted
masters after wallclock timestamps and passthrough output were applied. The
bounded classification is **D/F: output-timestamp duplication in the earlier
path plus a lower-than-requested negotiated source cadence**. Genuine C920
1080p30 remains unproven because no post-session DirectShow capability dump or
OBS canary exists. The proof profile consequently records nominal cadence as a
request, never as achieved production quality.
