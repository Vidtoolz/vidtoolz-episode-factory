# MA-021 — Oracle authority: what is frozen, what is evidence, what is drift

**Status:** materialized under AUTH-3 as documentation + evidence only. No corpus byte is changed by this
branch, because the committed corpus at its base already **is** the canonical frozen authority.
**Original worktree is NOT corrected until AUTH-4.** The drifted working copy in the contaminated checkout
remains untouched, and AUTH-3 does not create, reset, clean or restore anything there.

## Authority statements

1. **`f30e4543` = the frozen planner authority.** `earth-studio-job-planner.js` at `f30e4543` is git blob
   `0756764b…` / sha256 `a9098560…`, and the same blob is present at the freeze commit `091476bf`. It is the
   identity the frozen oracle actually measured.
2. **`091476bf` = the freeze commit.** It froze `corpus.json`, the fixtures, the REPORT and the harness as
   authority (2026-09-08 16:20 +03:00) and is an ancestor of HEAD `3592641e`.
3. **Canonical corpus = blob `064ff86cc3f0b5f0ba178f0801fe4438d2caf4e6`** (sha256
   `59747708886d954a8ba8690c92a1b6f14ef650865eb9d6cc3a44c6217007b53e`, 111,987 bytes), byte-identical at
   `091476bf`, at `c621d0f3`, at authoritative HEAD `3592641e` and in the index.
4. **Dirty corpus = blob `d79dfdbb43000aa9abe6bd2e5a841d190b9b8f0e`** (sha256 `ec9db10a…`, 111,987 bytes),
   present only in the original dirty worktree. Its drift is exactly three metadata leaf substitutions:
   `/started_at` (`2026-09-08T13:50:57.908Z` → canonical `2026-09-08T12:42:30.024Z`),
   `/source_hashes/earth-studio-job-planner.js` (`b5626854…` → `a9098560…`) and
   `/browser_invariant/bundle_identity/earth-studio-job-planner.js` (same substitution).
   The payload, the 199 case summaries and the discovery order are unchanged.
5. **199 plans = frozen inputs.** All 199 `shot-plan.json` blobs match the frozen manifest; aggregate
   `4ed24afc306b657fa5ac1eefae1d3442f263aef011112d1766706f53056cfc04`. No regeneration, no re-pin.
6. **209 observations = derived working evidence, NOT canonical.** They are hash-identical to the archived
   correction run, are regenerated per run, and are never promoted to authority by recency or by volume.
7. **Archived correction observations = preserved derived evidence**
   (`outputs/earth-studio-m1-correction-2026-09-08/oracle-observations/{baseline,candidate}`), retained as
   the independent counterpart of the working observations.

## Coherence law

`baseline_commit` label, `source_hashes.earth-studio-job-planner.js`, `browser_invariant.bundle_identity.
earth-studio-job-planner.js` and the freeze commit must **all name one identity**: `f30e4543` / `a9098560…`
inside freeze `091476bf`. Any manifest mixing identities is drift, never authority.

## Forbidden planner hashes

`b5626854…` (`4593b38e`, M1 seam extraction), `1ff78ab1…` (HEAD, current production),
`d628ade5…` (`c621d0f3`). None of these may be presented as the frozen oracle identity.

## Why this branch changes no corpus byte

The authoritative branch already contains the canonical blob, so AUTH-3 has nothing to repair in the
repository. The three-field patch is preserved here as evidence of the *dirty* path
(dirty → canonical), not as a change to be applied to the branch. Applying it to the original checkout is
AUTH-4, and only after explicit authorization.

## Follow-ups (recorded, not fixed here)

- **MA-021-FU-1** — the M1 self-baseline writer can recreate this drift on any future run; evidence lives
  outside `package-runs/2026-09-08-*` precisely because that writer `rmSync`s its own directory. Recorded
  in `FOLLOW-UP-MA-021-FU-1.json`.
- **MA-021-FU-2** — MA-002 timestamp/current-render timing residual (map-animator lane).
- **MA-021-FU-3** — cross-gate append-only hash-bound receipts.
