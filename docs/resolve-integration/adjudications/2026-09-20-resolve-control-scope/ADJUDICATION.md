# Human scope adjudication — `resolve-control` is inside the v1.18 Resolve integration authority (2026-09-20)

Recorded from Mikko's written adjudication of 2026-09-20 (chat, relayed in the mission "GOVERNED SCOPE ADJUDICATION → P2
REPAIR → DOCTRINE-COMPLIANT REQUALIFICATION"). Substance recorded; not reinterpreted. This is a human authorization /
adjudication record in the same class as `v1.18/AUTHORIZATION-2026-09-08.md`. It is placed **outside** the frozen v1.18
bundle so that no frozen byte changes (FREEZE-MANIFEST.json sha256 `80b108e4e142841af38827d3b6170c1260c543740f21b03ebb3d934278723ae9`
is unchanged by this commit). Incorporating it into the next frozen bundle is a separate governed release step.

## Decision (Mikko)

**YES — `resolve-control` is within the governed scope of the frozen Resolve integration authority (v1.18 @ 5d9dbba7).**

1. `resolve-control` is a **governed implementation layer** of the same Resolve integration — not an independent or
   parallel safety/control architecture, and not a competing authority.
2. **§A4** (`ADJUDICATION-FREEZE-CONTRACT.md` "A4 — HOST / LIBRARY"; `TARGET-CONTRACT.json#prohibited_targets`,
   `#library`, `#session`) **applies to the qualification of `resolve-control`**: qualification host vidnux; dedicated
   isolated qualification session; disk library `VIDTOOLZ Resolve Qualification v1`; `EKA` is
   `NETWORK_LIBRARY_PROHIBITED_DURING_QUALIFICATION`; `accepts_current_open_session_as_target: false`.
3. **§A5** ("A parallel safety/control implementation is prohibited; one shared core with two adapters") **applies**:
   it prohibits an independently *authoritative* competing Resolve safety/control path; it does **not** prohibit a
   subordinate implementation that conforms to the same authority. `resolve-control` is permitted only as such a
   subordinate implementation/extension beneath v1.18.
4. Existing v1.18 safety doctrine remains superior wherever Phase 1 does not explicitly provide stronger governed semantics.
5. `WRITE AUTHORITY = NONE` is unchanged. No Phase 1 result authorizes automated Resolve mutation.
6. The Phase 1 read-only Q1–Q10 run of 2026-09-20 against `PYSTY UHD` / `iphone prores` in `EKA`
   (`~/outputs/resolve-three-worker-control-plane-2026-09-20/`, manifest `d0204d3e…`) is classified
   **HISTORICAL ENGINEERING EVIDENCE — NOT ACCEPTANCE QUALIFICATION**. It is preserved with its provenance, not deleted,
   not relabelled compliant, and **not accepted as authority-compliant qualification**. No retroactive exemption is created.
7. Phase 1 acceptance/freeze requires qualification in the mandated isolated qualification session against the approved
   disk qualification library. §A4 is not weakened by this record.

## Provenance

| Item | Value |
|---|---|
| Candidate adjudicated | `vidtoolz-episode-factory` branch `claude/resolve-control-plane-phase1-20260920`, commit `b8be09ff0edf7c278c882bdfb4354a15447f90ae` (`resolve-control-plane phase1 0.1.0`, protocol `vrc.v1`) |
| Base authority | `5d9dbba7` (`docs/resolve-authority-freeze-v1.18`); FREEZE-MANIFEST.json `80b108e4…`; ADJUDICATION-FREEZE-CONTRACT.md `e84534a6c1ecd4b78a53ea9507a7556142dda04c2abf8242e955aafc026ffb7f`; TARGET-CONTRACT.json `841b34a51d787b0cecb375ecaf9b620baea70bda734c0f211241689c70e8912e` |
| Independent review that raised the question | `~/outputs/resolve-control-plane-phase1-independent-review-2026-09-20/` manifest `62a973cc9873285037d52d780ab5fa94a6aeb19e0b0884d0d415ac4002c733b3` (verdict DOCTRINE BLOCKED; findings D-01, D-02) |
| Decided by | Mikko (human evaluator and approval gate) |
| Recorded by | Claude Code, 2026-09-20 |

Machine form: `ADJUDICATION.json` (same directory).
