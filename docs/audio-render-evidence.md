# AUDIO_RENDER Evidence Authority

AUDIO_RENDER means exactly:

> a real rendered audio asset from the authorized music lane exists, is
> technically valid, and is bound to exact bytes with complete render
> provenance.

Concretely the evidence attests, all fail-closed:

1. a Scorecraft `music-candidate.json` record produced by the
   music_generation lane exists, status `completed`
2. its `production.wav` is present, non-empty, decodable (ffprobe), and its
   bytes hash to the record's `output_sha256`
3. provenance is complete: generation_job_id, workflow_hash, brief_hash
4. measured duration matches the record's own ffprobe measurement within
   0.5s tolerance

Producer:
**sound_music_director** — the department that owns audio direction and the
candidate records this evidence attests. The render itself is infrastructure
(music_generation lane); the attester is deterministic
(`producer_type: deterministic_attestation`, module
`scripts/audio-render-evidence.js`). No agent invocation is fabricated; QC
remediation routes failures to the department per `REMEDIATION_OWNER`.

Generated at lifecycle point:
after a music candidate is rendered and technically clean — i.e. when a
package run's soundtrack asset exists. For the retained lifecycle canary
(gate 7, capture phase) AUDIO_RENDER is not yet legitimately applicable:
program audio for that run comes from real presenter capture, not the music
lane. The bounded canary `2026-08-25-audio-render-evidence-canary` carries
the production proof instead (honest applicability per mission §39).

QC consumes:
`audioAdapter` in `scripts/qc-director.js` — schema_version 1, state
`PRODUCTION_READY`, `production_mix_sha256` present, positive duration.
Binding: artifact_id + artifact_sha256 + version_id. Stale bytes fail
closed (`QC_EVIDENCE_STALE`).

What AUDIO_RENDER is NOT:

- not the final program mix (dialogue + music). No program-mix render path
  exists yet; when one lands it needs its own evidence kind, not a reuse of
  this one.
- not aesthetic judgment and not human music approval. A candidate's human
  verdict (`use` / `reject` / unreviewed) is recorded truthfully;
  AWAITING_HUMAN_REVIEW never becomes APPROVED here. Mikko's Scorecraft
  two-step gate remains the only music approval authority.
- not Scorecraft planning output. Cue sheets / MIDI / sketches never satisfy
  render evidence — only a completed candidate record with decodable audio.

Mode dependency (flagged, not implemented): if run-level modes (DRAFT /
REVIEW / PRODUCTION) land, DRAFT synthetic voice + temporary music may
warrant relaxed AUDIO_RENDER expectations while PRODUCTION may require the
real presenter mix. This contract assumes the music lane's production
render; revisit when the mode contract exists.
