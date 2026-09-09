# M0-PHASES.md — the four M0 phases and what each one may do (v1.7, FROZEN_NOW; none is begun)

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

## v1.7 guarantees per phase

The four phases are unchanged. No phase implies the next. What v1.7 adds is what each phase's artifacts must now
survive, and every one of these is machine-checked in `VALIDATION-REPORT.md`.

| phase | v1.7 additional guarantee |
|---|---|
| M0A PROBE | a frame becomes evidence only through the strict byte-ingestion boundary, and the record carries a strict-parse receipt naming the exact bytes (`RAW-CAPTURE.md`, C16-M2). The capture must carry the identity of the shim pinned by `TRUSTED-SHIM.json`, be serialized under the pinned codec and frame schema, and name a method inside the pinned allowlist (`TRUSTED-SHIM.md`, C16-B3). Frames land in an append-only, content-addressed session whose manifest pins the active authority, registry, matrix, shim, parser and spec (`EVIDENCE-ROOT.md`, C16-M3). Identity passes are validated for receiver-path, handle-token and attempt-id uniqueness before any claim is derived (`IDENTITY-EVIDENCE.md`, C16-M1). |
| M0B REVIEW | the derived artifact a review is written about must be **stored**, resolvable by digest and by record id, belonging to that raw capture, and byte-equal to the recomputation. A review is bound to that exact stored derived digest. Two current reviews of one candidate are a CONFLICT unless one explicitly supersedes the other (`STORED-CHAIN.md`, C16-B4). |
| M0C REFREEZE | exactly one current reviewed refreeze record may promote a candidate, it must promote the exact raw, derived, review and probe id, and it must name the active capability matrix. The promoted matrix row binds the whole chain, including the refreeze block digest, the session and the trusted shim identity. Mikko's approval is still required and has not been given. |
| M0D QUALIFIED READ | qualification is recomputed from the current content of every input on every call. No authority cache is keyed on an object identity, so a warm evaluator can never disagree with a cold one (`AUTHORITY-CACHING.md`, C16-B1), and the active authority must itself name the trusted shim. |

None of this authorizes M0A. No probe has run.
