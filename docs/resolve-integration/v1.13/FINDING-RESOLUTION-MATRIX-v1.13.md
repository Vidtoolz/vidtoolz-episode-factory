# FINDING RESOLUTION MATRIX — Codex's v1.12 runtime-parity failure answered in v1.13

Machine form: `FINDING-RESOLUTION-MATRIX-v1.13.json`. `validate_v1_13.py` reads it, requires exactly the one id
below, and fails unless every validation section it names exists and passes. Earlier matrices — including
`FINDING-RESOLUTION-MATRIX-v1.12.json` — are retained unchanged as history and re-run as v1.13 regressions.

Input of record: Hermes's v1.12 operational review PASS on the intended path, and Codex's v1.12 result — intake PASS,
semantic delta PASS, **runtime-parity oracle FAIL**, `WORKFLOW_CONTRADICTORY`.

| id | severity | defect | v1.13 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| V112-RP1 | BLOCKER | production APIs and CLIs accepted arbitrary **and symlinked** evidence roots, and a complete workflow under such a root derived `ATTACHMENT_READY`, contradicting the frozen one-root law | one frozen `GOVERNED_ATTACHMENT_ROOT`; a resolver that takes no argument; no root parameter on any authorizing function or CLI; `--root` renamed `--library-root`; lstat-first root and session entry trust with `realpath` only as a later alias check and no `.resolve()` anywhere; the location re-checked on every authorizing load; the authorizing derivation requiring the frozen `authority_root` and `written_under_production_root`; scratch roots moved to an `INTERNAL_NON_AUTHORIZING` testkit unreachable from either CLI | `root-law`, `root-parity`, `root-property`, `root-static` | pre-M0A workflow (governed evidence-set location) |

## Preserved and re-run

Principal roles, A2V semantics, the `OPEN → PREPARED → VERIFIED` lifecycle, the `_authorize` choke point,
record-type permissions, the write-after-VERIFIED refusal, the TOCTOU binding, all three record constructors,
`make_record` / `record_id` / the envelope law, the `BUNDLE_VERIFICATION` content, the checked-file law, the principal
registry, Store.v5 (`evidence_store.py` differs by **one comment line** — the validator's filename — and by nothing else; every semantic constant is identical), cache, shim, strict ingestion, H0, commit
authority, precedence, the capability matrix and M0B/M0C/M0D.

## What is still not closed

- The frozen attachment root does not exist on this host yet; the production path refuses `ROOT_NOT_FOUND` until an
  operator creates it as a `0700` directory. That is deliberate.
- A principal remains a role-bound operational label, not an authenticated identity (`THREAT-MODEL.md`).
- Deliberate device and inode reuse under the governed root is not claimed to be detected, and this is not a
  time-of-check/time-of-use guarantee for the filesystem beneath the checks.
- `SCHEMA-VALID != AUTHORIZED TO MUTATE`. No probe has run and no Resolve was contacted.
