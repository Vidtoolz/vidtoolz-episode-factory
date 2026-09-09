# M0-PHASES.md — the four M0 phases and what each one may do (v1.6, FROZEN_NOW; none is begun)

`authority_lib.M0_PHASES`; the phase list is also declared in `READ-PRIMITIVES.json` under the probe operation. **No phase implies the next.** Each needs its own entry evidence, and M0C additionally needs Mikko's approval.

| Phase | May do | Requires (entry) | Produces | Exit |
|---|---|---|---|---|
| **M0A PROBE** | only `READ_PRIMITIVE_QUALIFICATION_PROBE`: call the 47 allowlisted getters through the capture shim in one isolated read-only session | Mikko's instruction to begin M0A; derived state ≥ `ATTACHMENT_READY` against the **exact** active manifest; `READ_ONLY_JOURNAL` open; contract host/library/uuid/root | one `RAW_CAPABILITY_CAPTURE` per getter attempt, one `CONNECTION_OBSERVATION`, the identity read passes, opaque stream digests, an append-only finalized evidence root | every allowlisted getter attempted and captured (including `TIMEOUT` / `ATTRIBUTE_MISSING` / `UNSERIALIZABLE`), identity passes recorded, root finalized and hashed. **No classification, no review, no promotion.** |
| **M0B REVIEW** | nothing against Resolve — offline only | M0A exit | recomputed derived results (cache), one `REVIEW_DECISION` per capture by a reviewer who is not the operator, `IDENTITY_*_OBSERVATION` records | every capture decided (`ACCEPT` only over recomputed `SUCCESS`). **Review is not qualification and grants no read.** |
| **M0C REFREEZE** | nothing against Resolve | M0B exit **and Mikko's explicit approval** | a successor bundle (new version, new manifest) whose `CAPABILITIES.json` promotes exactly the reviewed digests, plus a `REFREEZE_RECORD` naming parent and successor matrix content digests, parser, spec, probe/session, environment and approver | the successor bundle validates and is committed; its matrix content digest becomes the active capability authority |
| **M0D QUALIFIED READ** | ordinary read operations whose primitives derive `QUALIFIED_CALLABLE` (`CONNECT`, `TIMEBASE_OBSERVE`, full `SNAPSHOT_CAPTURE`) | M0C exit under the new active authority | qualified snapshots whose OBSERVED fields cite the promoted captures (`QUALIFIED_OBSERVATION` provenance) | M0 exit evidence (`MILESTONES.md`) |

## Boundaries that hold at every phase

- Zero `QUALIFIED_READ` rows exist in this bundle, so before M0C the callable set is empty: `CONNECT` and `TIMEBASE_OBSERVE` are ineligible and `SNAPSHOT_CAPTURE` may only produce the degraded pre-qualification capture of `SNAPSHOT-COMPLETENESS.md`, which is never a plan H0 or S1.
- No mutator, `SaveProject`, `CreateEmptyTimeline`, `ImportMedia`, marker or setting write is permitted anywhere in M0.
- A `FATAL_TARGET_FAILURE`-family derivation (`BINDING_MISMATCH`) stops the run and makes the session's derived attachment state `CONFLICT`.
- Nothing in M0 authorizes M1, M2 or M3, and no M0 result is human approval of any gate or publication.
