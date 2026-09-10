
# FINDING RESOLUTION MATRIX — Codex v1.7 adjudication answered in v1.8

The machine-readable form is `FINDING-RESOLUTION-MATRIX-v1.8.json`. `validate_v1_8.py` reads it, requires exactly the
two ids below, and fails unless every validation section they name exists and passes. The v1.6 matrix is retained
unchanged as `FINDING-RESOLUTION-MATRIX-v1.7.json`; its corrections are re-run as v1.8 regressions.

| id | severity | Codex finding | v1.8 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| ES-1 | BLOCKER | the normative verifier ignores unexpected files placed in a finalized session root (attack STORE-14) | finalization records the complete allowed inventory of every governed file and directory; verification compares EXPECTED against ACTUAL and requires missing == 0, unexpected == 0, changed == 0 | `evidence-closed-world`: pinned STORE-14 plus unexpected nested file, shard file, directory, nested directory, attempts entry, extra RAW record, extra DERIVED record, altered record, deleted record, renamed record, altered inventory, altered receipt, symlink, symlinked directory, FIFO | evidence store (closed-world verification) |
| ES-2 | BLOCKER | a competing `EvidenceRoot` surface in the capture shim accepts traversal and lacks the normative guarantees | `EvidenceRoot` removed; one `EVIDENCE_STORE_AUTHORIZING` module; write API takes layer, attempt id, logical identity and content, never a path; logical-name gate plus resolved-path containment | `evidence-single-authority` (static audit) and `evidence-traversal` (twenty identifier shapes against eight entry points, proving nothing appears outside the session root) | evidence store (path law) / authority surface |

## Gate consequences

Codex held MERGE and blocked M0A on this defect class alone. v1.8 closes both findings. The gates remain Codex's and
Mikko's to move; nothing in this bundle advances them.

## What is still not closed

- No probe has run, no evidence root exists, and the store has only been exercised against temporary directories.
- The store detects post-finalization tampering; it does not prevent it at the operating-system level.
- Every primitive expectation remains `DOCUMENTED_HYPOTHESIS`.
- The residual risks named in `THREAT-MODEL.md` remain open.
