# Package-Runs Index Authority Proof — 2026-08-25

PROOF PACKAGE — architecture/test evidence only. This directory carries no
package-run identity file (`isPackageRunDir` = false), so the index never
counts it. It cannot change the count it is testing.

## Verdict

PACKAGE-RUN INDEX VERIFIED — ZERO WAS CORRECT AT BASELINE, FRESHNESS REPAIRED.

The 2026-08-25 baseline (`count: 0` while ~67 directories existed) was NOT a
stale index. Zero directories carried canonical package-run identity
(`isPackageRunDir`: at least one DETECTED_FILES entry), so indexing zero was
correct. The defect was diagnostic: operators compared the raw directory
count against the indexed run count, which are different facts.

## Index authority contract (proven)

```
filesystem package-run evidence
        ↓
package-run scanner (scripts/package-runs-index.js buildPackageRunsIndex)
        ↓
package-runs-index.json   (rebuildable, disposable, non-authoritative)
```

The index never establishes canonical gate, completion, approval, QC
disposition, package-run state authority, or agent readiness. On any
disagreement, canonical package evidence wins and the index is rebuilt.
Deleting the index destroys no production state (IX7, canary step 7).

## Baseline (live, 2026-08-25 ~10:30 EEST)

- directories under package-runs/: 67 (later 71 via concurrent sibling work)
- isPackageRunDir TRUE: 0 at mission start → `count: 0` CORRECT
- durable index and in-memory rebuild agreed: count 0
- freshness reported "fresh" — the reader contract never claimed staleness

## Live classification after repair (node scripts/package-runs-index.js --check)

- directories scanned: 71
- genuine package runs: 1
  (`2026-08-25-lifecycle-integration-canary-canary-not-for-publication`,
  created by a concurrent lifecycle-integration canary at 10:16 EEST; it is
  the sole directory with identity files and it is parked)
- excluded: 12 proof, 3 canary, 5 acceptance, 50 legacy/unknown
- ghost entry `2099-02-02-integration-test-run` detected by --check
  (INDEX_GHOST_ENTRY) and removed by the atomic rebuild

## Artifacts

- `index-canary-summary.json` — isolated canary (scratch root under
  os.tmpdir(); real tree touched read-only only): empty root → 0; proof-only
  → 0; genuine run → 1; second proof → still 1; forged ghost detected;
  rebuild removes ghost; delete index → runs usable, INDEX_MISSING reported;
  rebuild restores; canonical evidence sha256 unchanged through all steps;
  sourceDigest deterministic.
- Reproducibility: `node scripts/package-runs-index-canary.js --emit <dir>`

## What changed

1. `scripts/package-runs-index.js`: INDEX AUTHORITY CONTRACT header;
   INDEX_SCOPE classification (GENUINE/PROOF/CANARY/ACCEPTANCE/LEGACY);
   scope metadata (directoriesScanned, genuineRuns, excluded counts);
   `rebuildPackageRunsIndex` — the single canonical rebuild, atomic write via
   the repository helper (temp+fsync+rename), path-safety guards;
   `checkPackageRunsIndex` — read-only: MISSING/CORRUPT/GHOST/ABSENT/STALE;
   `sourceDigest` (volatile timestamps excluded); `--check`/`--rebuild` CLI.
2. `scripts/package-engine-new-run.js`: safe index refresh after canonical
   creation; failure warns and never blocks run creation (IX8/IX9).
3. `docs/DOC-AUTHORITY.md`: index declared derived/non-authoritative;
   directory-count ≠ run-count distinction documented.
4. `scripts/verify.sh`: node --check for the canary script.
5. `tests/package-runs-index-authority.test.js` IX1–IX15 (registered in
   tests/run-tests.js via additive index-only hunk).

## Promotion NOT_PERFORMED

No registry field, lifecycle field, or authority boundary was changed. This
package is implementation evidence for Mikko's review.
