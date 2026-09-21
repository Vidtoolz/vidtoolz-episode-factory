# KNOWN-LIMITATIONS-PHASE1.md — bounded P3 items carried into v1.20 with closure gates (FROZEN_NOW)

None of these items blocks the read-only substrate. Each names the gate before which it must be closed.

| ID | Item | Closure gate |
|---|---|---|
| F-07 | `timeline_name` lookup returns the first match when names are duplicated; timeline UUID is authoritative and available | BEFORE WRITE CAPABILITY (writes must require durable identity) |
| F-08 | registry keys differing only by case collapse silently; corrupt registry / missing key file surface as unstructured errors | BEFORE HERMES FACADE |
| F-09 | replies are not independently signed (integrity boundary = loopback + SSH + authenticated request) | BEFORE WRITE CAPABILITY |
| F-10 | a test hook (`VRC_FAKE_RESOLVE` environment variable) remains in the production worker module | BEFORE PERSISTENT WORKER DEPLOYMENT |
| F-11 | Windows workers run in the operator's Administrator context; `worker.key` relies on the inherited profile ACL (SYSTEM/Administrators/user) | BEFORE PERSISTENT WORKER DEPLOYMENT |
| F-12 | documentation drift between Phase 1 prose and implementation | CLOSED in v1.20 (CONTROL-PLANE.md written from the pinned source) |
| R-01 | run-4 §4 precondition captured as narrative plus corroborating files rather than one dedicated evidence file | CLOSED by hash-pinned evidence index (PHASE1-QUALIFICATION-RECORD.json) |
| R-02 | A3 record and launch recipe are in the adjudications record class, not minted through the evidence store | DOCUMENTED (evidence class declared in PHASE1-QUALIFICATION-RECORD.json); minting canonical records remains a follow-up BEFORE WRITE CAPABILITY |
| R-03 | port-1144 wording: Local scripting refuses remote sessions at protocol layer while vendor sockets may stay bound | CLOSED in v1.20 (TARGET-CONTRACT session semantics + CONTROL-PLANE.md §1) |
| R-04 | worker reads live configuration paths (registry, `.dblist`, preference file) rather than the isolated session's roots | DOCUMENTED (CONTROL-PLANE.md §8); stronger pinning BEFORE WRITE CAPABILITY |
| R-05 | qualification fixture keeps derived playback fps 24 / monitor format "HD 1080p 24" although timeline fps is 25 | RECORDED as fixture observation; no effect on read-only qualification; do not alter the fixture |
| R19-F1 | the v1.18 rejection findings and the v1.19 repairs were authored by the same agent | CLOSED: independently re-derived (v1.19 review, manifest b9247a55…) |
| R19-F2 | v1.19 self-labelled "CURRENT — implementation-author candidate" | CLOSED: v1.20 registers 1.19.0 HISTORICAL — ACCEPTED; SUPERSEDED |
| R19-F3 | stale inherited prose (README "correction of v1.5", build-log label) | CLOSED in v1.20 README; build log label corrected in v1.20 tooling |
| R19-F4 | TARGET-CONTRACT library observations were null; fixtures use placeholder root/UUID | CLOSED: real observations bound in v1.20 TARGET-CONTRACT; fixture placeholders remain fixture-only |
| R19-F5 | silence on the 2026-09-20 live multi-client findings | CLOSED: CONTROL-PLANE.md §10, TRANSPORT.md / SNAPSHOT-CONCURRENCY-RECOVERY.md v1.20 observations |
| F-120-04 | self-test seam removed the whole qualification tree when the root had been absent at entry, deleting any other writer's later session (escalated to P2 by the 2026-09-21 re-review) | CLOSED in the final repair: own-session-only ownership with run-unique ids, no whole-tree removal, symlink- and exception-safe cleanup; section `selftest-ownership` incl. the pre-repair behaviour as a regression fixture |
| F-120-09 | frozen VALIDATION-REPORT.md carried environment-bound values (temp-root path, raw inventory total_bytes), so validation rewrote a frozen file across scratch environments | CLOSED in the final repair: boundary-aware environment scrub (<TMPDIR>, <REPO>; canonical roots never rewritten, the working directory never read), scrub before truncation, outcome-only inventory detail, section `report-determinism`; byte-identical under short/medium/long roots, temp directories and working directories |
| F-120-06 | `PHASE1-QUALIFICATION-RECORD.json` and the acceptance record have no registered schema (the source pin is now schema-registered and machine-verified by section `phase1-pin`) | explicit `NO_REGISTERED_SCHEMA:` reason in `FREEZE-MANIFEST.json`; schema registration in a later candidate |
| F-120-07 | inherited author evidence (`AUTHOR-REGRESSION-RESULTS.json`, `V117-REPRODUCTION.json`) carries v1.19 metadata while classed NORMATIVE in the manifest | DOCUMENTED provenance: generated under authority 1.19.0, registered GENERATED_EVIDENCE in `AUTHORITY-PRECEDENCE.json`; the manifest `qualification_note` states it; bytes unchanged |
| F-120-08 | bundle construction by unchecked string replacement (two replacements missed, one rename disabled) produced F-120-01..03 | CLOSED for the three affected values, now derived structurally (resolved parent file, canonical version constant, frozen parent bytes); author-side construction tooling remains outside this authority |

The three P2 findings of the v1.20 independent review (F-120-01 parent-pin byte count, F-120-02 manifest rule version, F-120-03 stale inherited v1.19 matrix) are CLOSED at generator level, and the two P2 findings of the second re-review (F-120-04 evidence non-interference, F-120-09 authority determinism) are CLOSED in the final repair; see `FINDING-RESOLUTION-MATRIX-v1.20.md` and `CHANGELOG-v1.20.md`.

Persistent worker deployment remains blocked by F-10/F-11; Hermes facade remains a later gate; write capability remains a
later, separately qualified programme (M3+ provisional design only).
