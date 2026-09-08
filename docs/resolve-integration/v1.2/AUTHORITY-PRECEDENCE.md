# AUTHORITY-PRECEDENCE.md (v1.2, FROZEN_NOW)

Machine form: `AUTHORITY-PRECEDENCE.json`. Law: when two frozen statements conflict, the entry here decides. A HISTORICAL document is never an implementation authority. Implementers read `MILESTONES.md`, `PERMISSIONS.json`, `ELIGIBILITY.md`, `TARGET-ATTACHMENT-GATE.md`, `SNAPSHOT-COMPLETENESS.md`, `GUARD-AUTHORITY.md`, `CANONICALIZATION.md`, `DRIFT-POLICY.md`, `REVIEW-MARKER-POLICY.md` and the schemas; they do not need to guess.

## Documents

| Path | Status | Reason |
|---|---|---|
| `README.md` | STILL_ACTIVE | current |
| `AUTHORIZATION-2026-09-08.md` | STILL_ACTIVE | current |
| `DOCTRINE.md` | STILL_ACTIVE | current |
| `TRANSPORT.md` | STILL_ACTIVE | current |
| `ELIGIBILITY.md` | STILL_ACTIVE | current |
| `TARGET-ATTACHMENT-GATE.md` | STILL_ACTIVE | current |
| `SNAPSHOT-COMPLETENESS.md` | STILL_ACTIVE | current |
| `GUARD-AUTHORITY.md` | STILL_ACTIVE | current |
| `CANONICALIZATION.md` | STILL_ACTIVE | current |
| `IDENTITY-BINDING.md` | STILL_ACTIVE | current |
| `SNAPSHOT-CONCURRENCY-RECOVERY.md` | STILL_ACTIVE | current |
| `DRIFT-POLICY.md` | STILL_ACTIVE | current |
| `REVIEW-MARKER-POLICY.md` | STILL_ACTIVE | current |
| `SEMANTIC-VALIDATION.md` | STILL_ACTIVE | current |
| `CANARIES.md` | STILL_ACTIVE | current |
| `MILESTONES.md` | STILL_ACTIVE | current |
| `M3-MATRIX.md` | STILL_ACTIVE | current |
| `SCORECRAFT-EXTRACTION.md` | STILL_ACTIVE | current |
| `CLIENT-VERSION-INVENTORY.md` | STILL_ACTIVE | current |
| `PROVISIONAL.md` | STILL_ACTIVE | current |
| `AUTHORITY-PRECEDENCE.md` | STILL_ACTIVE | current |
| `CHANGELOG-v1.2.md` | STILL_ACTIVE | current |
| `FINDING-RESOLUTION-MATRIX-v1.2.md` | STILL_ACTIVE | current |
| `VALIDATION-REPORT.md` | STILL_ACTIVE | generated report; not normative |
| `CHANGELOG-v1.1.md` | HISTORICAL | v1.1 history |
| `FINDING-RESOLUTION-MATRIX.md` | HISTORICAL | v1.1 finding map; v1.2 map is FINDING-RESOLUTION-MATRIX-v1.2.md |
| `ADJUDICATION-FREEZE-CONTRACT.md` | HISTORICAL | 2026-09-08 three-way adjudication; input to v1.0; several sections superseded (see superseded_statements) |
| `AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md` | HISTORICAL | input to v1.1; M0 definition and marker wording superseded |

## Superseded statements

| Id | Old authority | New authority | Status | Effective | Reason |
|---|---|---|---|---|---|
| S1 | ADJUDICATION-FREEZE-CONTRACT.md#10 (M0: 'any Resolve call beyond --dump-tools' forbidden; M0 = static inventory only) | `MILESTONES.md#M0` | SUPERSEDED | 1.1.0 | v1.1/v1.2 M0 is a read-only connection/observation milestone gated by TARGET-ATTACHMENT-GATE.md and ELIGIBILITY.md; the static inventory became bundle v1.0 itself |
| S2 | ADJUDICATION-FREEZE-CONTRACT.md#5.2, #6 (payload_sha256 / 'H0 = payload digest' as the version token) | `GUARD-AUTHORITY.md` | SUPERSEDED | 1.1.0 | composite guard digest (model A) is the version token; payload digest proves content only |
| S3 | ADJUDICATION-FREEZE-CONTRACT.md#5.2 snapshot context wording ('target_contract_digest', 'target epoch' inside snapshot envelope hash) | `schemas/resolveSnapshot.schema.json; SNAPSHOT-COMPLETENESS.md` | SUPERSEDED | 1.2.0 | v1.2 snapshot carries coverage profile, per-field observation status, guard digest and hash domains |
| S4 | ADJUDICATION-FREEZE-CONTRACT.md#7, #10, #16 (milestone table and refreeze wording; v1.1 M3-MATRIX '18 probes') | `MILESTONES.md; M3-MATRIX.md; M3-PROBES.json` | SUPERSEDED | 1.2.0 | v1.2 milestone boundaries are machine-checked against PERMISSIONS.json (MILESTONE-MATRIX.json); M3 has 19 probes P1-P19 and P0 is an M0 preflight |
| S5 | ADJUDICATION-FREEZE-CONTRACT.md#7 M9 row and AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md ('markers -> review notes with target_domain from colour/name') | `REVIEW-MARKER-POLICY.md` | SUPERSEDED | 1.1.0 | markers locate candidates only; dispositions require human attestation |
| S6 | ADJUDICATION-FREEZE-CONTRACT.md#5.5 and v1.0 SNAPSHOT-CONCURRENCY-RECOVERY.md drift table (IMPORT_OVERRIDE; STALE_ASSET vs 'newer handoff') | `DRIFT-POLICY.md; schemas/provisional/resolveConflict.schema.json` | SUPERSEDED | 1.1.0 | PROPOSE_REVIEW_NOTE; STALE_ASSET vs EF canonical head |
| S7 | v1.1 PERMISSIONS.json entries with prose 'evidence_prerequisite' only | `PERMISSIONS.json; ELIGIBILITY.md; tools/authority_lib.py#evaluate_eligibility` | SUPERSEDED | 1.2.0 | declaration vs eligibility split; machine-evaluable prerequisites |
| S8 | v1.1 CAPABILITIES.json rows with evidence_class QUALIFIED_READ citing scripts | `CAPABILITIES.json#evidence_records` | SUPERSEDED | 1.2.0 | no exact evidence exists on 21.1.0 build 14; rows downgraded |
| S9 | v1.1 CANONICALIZATION.md marker sort key (object_address, frame, custom_data, name, color) | `CANONICALIZATION.md#3` | SUPERSEDED | 1.2.0 | total order incl. duration and note; (object_address, frame) collision rejection |
| S10 | v1.1 SCORECRAFT-EXTRACTION.md ('guards exist only in the hardlink fixture') | `SCORECRAFT-EXTRACTION.md` | SUPERSEDED | 1.2.0 | guards also exist in scorecraft-resolve-driver.py and scorecraft-resolve-production-fixture.py; production driver still lacks one |

Retired terms (must not appear in STILL_ACTIVE documents except the exempt list): `IMPORT_OVERRIDE`, `--dump-tools`, `18 probes`, `resolveSnapshot.v1.1`, `canonicalization_version: 1.1`, `QUALIFIED_READ (inspect row)`.
