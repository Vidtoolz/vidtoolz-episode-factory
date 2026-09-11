# MA-021 oracle evidence (AUTH-3)

This directory records the MA-021 oracle authority reconciliation: which Earth Studio oracle objects are
canonical, which are merely working evidence, and why the committed corpus already *is* the frozen
authority — so that no source repair is required on the authoritative branch, and nothing here touches the
contaminated original worktree (that remains AUTH-4).

Provenance chain: `091476bf` froze the M1 self-baseline (corpus, fixtures, REPORT, harness) with the
`f30e4543` planner identity (`a9098560…`); the frozen corpus blob `064ff86c…` (sha256 `59747708…`,
111,987 bytes) is byte-identical at `091476bf`, `c621d0f3`, authoritative HEAD `3592641e` and the index;
the working copy in the original dirty worktree drifted to `d79dfdbb…` (sha256 `ec9db10a…`) through exactly
three metadata leaf substitutions (`/started_at`, `/source_hashes/earth-studio-job-planner.js`,
`/browser_invariant/bundle_identity/earth-studio-job-planner.js`) while the 199 plans, 209 observations and
motion config stayed identical. 199/199 plan blobs match the frozen aggregate `4ed24afc…`; 209/209
observations are hash-identical to the archived correction run and are treated as derived evidence, never
promoted to authority. No replay was performed and no corpus byte was changed by AUTH-3.

Root cause of the drift is tracked as MA-021-FU-1 (the self-baseline writer can recreate it): see
`FOLLOW-UP-MA-021-FU-1.json`. It is recorded, not fixed, under AUTH-3.
