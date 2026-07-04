# Mutation Testing Report

## Summary

- **Date/time:** campaign 2026-07-03 20:12 → 2026-07-04 04:14 EEST (evidence timestamps in UTC)
- **Machine:** vidnux (Ubuntu 24.04.4 LTS), user `vidtoolz`, Node v24.17.0, npm 11.13.0
- **Repo:** `/home/vidtoolz/vidtoolz-episode-factory` @ `c576bd9a4ea8057ae41bd2ac9be52e30c9a72784` (main)
- **Baseline test command:** `node tests/run-tests.js` → **1488/1488 passed**, exit 0, 88.0 s. (The task brief said "844 green tests" — that figure is stale; the current suite is 1488.)
- **Tool/method:** custom mutation harness (StrykerJS not usable: the repo is deliberately dependency-free — empty `package.json` deps, no installable tooling permitted — and its custom in-process test runner is trivially replicable per file, which the harness exploits). Isolated detached git worktree; per-mutant test-subset execution via a require-graph mapping.
- **Time budget:** 10 h max; **actual: 8 h 02 m campaign + ~6 min vacuous-check phase + setup ≈ 8.3 h**
- **Modules tested:** **116 of 116 in scope — zero modules skipped for deadline**
- **Mutants:** 11,029 generated → **5,197 executed** (5,475 sampled out by per-module caps, 357 discarded as syntactically invalid before counting)
  - **Killed:** 2,127 · **Timeout:** 11 · **Runtime error:** 14 (all three classes = detected: 2,152)
  - **Survived:** 2,507
  - **No coverage:** 538 (modules with no mapped test files)
  - **Skipped (budget/sampling):** 5,475
  - **Equivalent/likely equivalent:** not auto-classified; ~30 survivors hand-reviewed, 6 judged likely equivalent (section below) and NOT removed from the survived count
- **Overall mutation score (covered code):** **46.2%** (2,152 / 4,659); including no-coverage as undetected: **41.4%**
- **Overall verdict: PARTIAL** — a broad campaign completed with real signal, but the score is weak, several high-risk modules are severely under-tested (media-provenance 16.9%, pipeline-tracker 13.2%, server routes 30.4%), and sampling/attribution limits remain. It is not FAIL only because the single hard-blocking safety gate (`supervised-capture.js` verify path, 61.6%) and the Resolve readiness model (77.8%) — the two places where bad media is actually stopped — show genuine teeth, and the weakest module (`media-provenance`) is *documented* advisory-only. If provenance validation were load-bearing enforcement, this would be a FAIL.

Evidence: `reports/mutation-evidence-20260703-195656/`

## Scope and Method

- **Why not Stryker:** installing dependencies is prohibited in this repo (high-risk boundary) and none exist locally; the suite also uses a bespoke runner (`tests/run-tests.js`, shared registration array, stop-on-first-failure). A custom harness reproduces exactly what Stryker's command runner would do, with better per-module economics.
- **Isolation:** detached git worktree at `/tmp/vidtoolz-mutation-20260703-200114/wt` @ `c576bd9`. All mutation happened there; every mutated file restored from pristine copies after each mutant; worktree `git status` checked clean of tracked modifications after the run. The real repo received only `reports/` artifacts.
- **Scope:** all production JS — repo root `*.js`, `scripts/*.js`, `score-engine/*.js` (~59 k lines, 116 files). Excluded: `tests/`, `node_modules/`, `reports/`, `package-runs/`, docs, HTML pages, fixtures, media, `mission-control/` notes.
- **Operators:** `===/!==`, `==/!=`, `</<=`, `>/>=`, `&&/||`, `true/false` literal flips, `return <expr> → return undefined`, comparison-adjacent numeric boundary (`> 0 → > 1`). String literals, comments, and multiline template-literal interiors masked; every mutant gated by `node --check` (invalid mutants discarded uncounted).
- **Test execution/attribution:** per test file, its `_helpers` destructured bindings and direct requires were resolved to production modules, then closed transitively over the production require graph → `module → test files` map (`module-test-mapping.json`). Mapped files ran individually, cheapest first, stopping at the first kill (killer attributed). Per-file timeout = max(15 s, 3× measured baseline).
- **Limitations (all material ones):**
  1. **Sampling**: modules above their cap were deterministically sampled (`package-engine-server.js`: 332 of 1,871 mutants executed; `package-runs-dashboard.js`: 58 of 1,275). Scores for sampled modules are estimates.
  2. **Heavy-file skip**: `package-runs-dashboard.test.js` (74 s, 174 tests) only ran for narrowly-mapped modules or its own module. **2,256 of the 2,507 survivors never faced it.** Its campaign kill contribution elsewhere was low, but some survivors would plausibly die under it.
  3. Attribution is file-level (the runner has no per-test execution); first-kill attribution biases credit toward cheap files — corrected for the vacuous analysis by the dedicated re-check phase.
  4. Regex literals are not masked, so a few mutants landed inside regexes (still behavior-changing, but noted where relevant).
  5. Equivalent mutants were not auto-detected; hand review covered only top survivors.

## Module Mutation Scores

Score = (killed+timeout+error) / (that + survived), covered mutants only. Full 116-row table: `report-tables.md` in the evidence dir. Key rows — all 18 designated high-risk modules plus the worst and best of the rest:

| Module | Mutants (gen) | Executed | Killed | Survived | Timeout | Error | No Coverage | Skipped (sampled) | Mutation Score | Risk |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| media-provenance.js | 118 | 118 | 20 | 98 | 0 | 0 | 0 | 0 | **16.9%** | HIGH — media validation |
| pipeline-tracker.js | 40 | 38 | 4 | 33 | 0 | 1 | 0 | 0 | **13.2%** | HIGH — canonical stage model |
| project-action-registry.js | 22 | 22 | 5 | 17 | 0 | 0 | 0 | 0 | **22.7%** | HIGH — GUI action safety |
| package-engine-server.js | 1,871 | 332 | 99 | 231 | 0 | 2 | 0 | 1,521 | **30.4%** | HIGH — all routes (sampled) |
| scripts/supervised-capture.js (CLI) | 76 | 76 | 22 | 53 | 1 | 0 | 0 | 0 | 30.3% | HIGH |
| manual-media-import.js | 23 | 21 | 7 | 13 | 0 | 1 | 0 | 0 | **38.1%** | HIGH — import lane |
| package-engine-run.js | 108 | 101 | 37 | 63 | 0 | 1 | 0 | 0 | 37.6% | HIGH |
| project-state-resolver.js | 67 | 67 | 31 | 36 | 0 | 0 | 0 | 0 | 46.3% | HIGH — stage inference |
| package-engine-model.js | 67 | 67 | 33 | 33 | 0 | 1 | 0 | 0 | 50.7% | HIGH |
| next-task-engine.js | 24 | 24 | 13 | 11 | 0 | 0 | 0 | 0 | 54.2% | HIGH |
| supervised-capture.js (verify gate) | 165 | 138 | 84 | 53 | 1 | 0 | 0 | 15 | **61.6%** | HIGH — ffprobe hard-block |
| media-routing.js | 30 | 30 | 19 | 11 | 0 | 0 | 0 | 0 | 63.3% | HIGH — hard routing |
| package-media-index.js | 23 | 22 | 14 | 8 | 0 | 0 | 0 | 0 | 63.6% | HIGH — provenance index |
| resolve-handoff-readiness.js | 27 | 27 | 21 | 6 | 0 | 0 | 0 | 0 | **77.8%** | HIGH — handoff gate model |
| scripts/resolve-handoff.js | 21 | 21 | 0 | 0 | 0 | 0 | **21** | 0 | n/a — **no coverage** | HIGH |
| scripts/import-manual-videos.js | 34 | 34 | 0 | 0 | 0 | 0 | **34** | 0 | n/a — **no coverage** | HIGH |
| scripts/import-manual-images.js | 17 | 17 | 0 | 0 | 0 | 0 | **17** | 0 | n/a — **no coverage** | HIGH |
| scripts/index-package-media.js | 12 | 12 | 0 | 0 | 0 | 0 | **12** | 0 | n/a — **no coverage** | HIGH |
| scripts/package-runs-dashboard-launch.js | 21 | 20 | 0 | 20 | 0 | 0 | 0 | 0 | 0.0% | low |
| scripts/package-run-next-safe-action.js | 42 | 41 | 2 | 39 | 0 | 0 | 0 | 0 | 4.9% | medium — canonical next-action |
| package-run-artifact-panel.js | 58 | 54 | 3 | 51 | 0 | 0 | 0 | 0 | 5.6% | low-medium |
| package-runs-dashboard.js | 1,275 | 58 | 10 | 48 | 0 | 0 | 0 | 1,215 | 17.2% (sampled) | medium |
| … 92 further modules … | | | | | | | | | see report-tables.md | |
| best-scoring tested modules (episode-model, storage-adapter, score-schemas etc.) | | | | | | | | | 70–95% | |

**No-coverage modules** (every mutant unkillable because no test file maps to them): the four HIGH-risk CLI wrappers above plus `app.js`, `clipboard.js`, `friction-log.js`, `job-progress.js`, `media-gallery.js`, `package-engine.js`, `project-client.js`, `resolve-readiness-panel.js`, `run-listing.js`, `video-room-focus.js`, `workflow-wizard.js`, `scripts/browser-workflow-smoke.js`, `scripts/daily-idea-scout-launch.js`. Most are browser-side modules (testable only via DOM harness), but the four CLI wrappers guard production gates and are plain Node.

## Highest-Risk Surviving Mutants

| Rank | Module | Line | Mutation | Survived Because | Production Risk | Suggested Test |
|---:|---|---:|---|---|---|---|
| 1 | media-provenance.js | 35 | PNG magic-byte check `===`→`!==` (and 6 sibling mutants on the same line) | No test asserts parsed image dimensions from real PNG bytes through the import path | Image dimension validation silently dead → wrong-size/corrupt static cards import with zero warnings | Unit test: `readPngSize`/`validateImage` on a real 1080×1920 PNG asserts `{width:1080,height:1920}` and warning behavior for wrong sizes |
| 2 | resolve-handoff-readiness.js | 38 | `completed >= selections && pending === 0 && failed === 0` → `\|\|` | Tests cover ready/missing but not the mixed state (some completed AND some failed) | Readiness model can report clips "ready" with failed clips present — cockpit green-lights a broken handoff | Case: 2 selections, 1 completed + 1 failed → expect `partial`, not `ready` |
| 3 | manual-media-import.js | 73 | sha256 read loop `> 0` → `> 1` | No import test hashes a file whose final chunk is exactly 1 byte | Digest silently wrong for files with size ≡ 1 (mod 8 MiB) → dedup/provenance integrity hole | Hash a file of size 8 MiB+1 and compare against `crypto` reference |
| 4 | package-engine-server.js | 799 | active-state parse `bodyActive = /active/ && !/parked\|superseded/` → `\|\|` | Only the happy parse is asserted | A parked/superseded run can classify as active → wrong run drives the cockpit | Test `package-run-state.md` containing both "active" and "parked" → expect not-active |
| 5 | pipeline-tracker.js | 62, 71 | `map[status] !== undefined ? … : 0` → `===` / `return undefined` | Stage/gate → index mapping unasserted for known values | Canonical 13-stage tracker renders wrong stage position — the operator's primary orientation | Assert `statusToIndex`/`gateToStage` for every canonical key |
| 6 | project-state-resolver.js | 41 | evidence file `size >= minBytes` → `>` / `return false`→`true` | Stage inference tested at coarse level only | Stage resolution flips on boundary-size artifacts → wrong next-task | Boundary test: file exactly `minBytes` counts as evidence |
| 7 | manual-media-import.js | 56 | `!existsSync(dir) \|\| !isDirectory()` → `&&` | Missing-dir error path asserted, file-not-dir path never | `resolvePackageDir` accepts a *file* as a package dir → import writes into nonsense paths | Test `--package` pointing at a file → expect statusCode 404 |
| 8 | supervised-capture.js | 24–97 | 12 × PROFILES `audio:`/`fullDisplay:`/`primary:` boolean flips | Profile constants never asserted | Capture profiles could silently swap audio/display behavior — wrong A-roll capture configuration | Snapshot-assert the three PROFILES objects' audio/display fields |
| 9 | scripts/package-run-next-safe-action.js | (39 survivors) | 39 of 41 mutants survive (4.9%) | Only 2 mutants killed — the canonical "what do I do next" CLI is near-unverified | This script backs `/api/cockpit-orientation` — the cockpit's primary answer | Golden-file tests: given fixture run states, assert emitted next action |
| 10 | package-engine-server.js | 466–469 | MIME map `ext === '.json'`/`'.webp'` flips (asset serving) + escapeHtml regex mutants (505) | Asset content-type and HTML escaping unasserted | Wrong MIME on cockpit assets; escaping regressions | Extend the new aigen-assets tests with content-type asserts |

## Untested / Weak Code Paths

1. **`media-provenance.js` — the entire validation layer (16.9%).** PNG header parsing, resolution/vertical/fps/codec warning rules: 98 survivors. Tests exercise imports but assert provenance fields, not validation outcomes (the one warning assert uses a fixture that warns for other reasons). Impact: the "advisory" layer the five-gate dry run flagged is not just advisory — it is effectively unverified. Recommended: table-driven unit tests over `validateImage`/`validateVideo`/`readPngSize`.
2. **Manual import CLI wrappers (`scripts/import-manual-*.js`, `scripts/resolve-handoff.js`, `scripts/index-package-media.js`) — zero coverage.** The gate *logic* they call is tested via modules, but arg parsing, exit codes, and output formatting (what the operator actually sees) are not. A `--dry-run`-based CLI smoke test each would cover them.
3. **`pipeline-tracker.js` (13.2%)** — the source of truth for the canonical spec renders stages with almost no behavioral assertions (the drift guard checks the *generated doc*, not the mapping functions).
4. **`scripts/package-run-next-safe-action.js` (4.9%)** and `package-run-artifact-panel.js` (5.6%) — canonical next-action authority and artifact panel logic are nearly assertion-free.
5. **Server route internals (30.4% on a 332-mutant sample)** — helpers like front-matter parsing, MIME inference, active-state detection survive freely; route-level tests assert top-level status/shape but not branch behavior.

## Zero-Kill / Vacuous Test Candidates

Attribution level: **test file** (the runner cannot execute individual tests). Campaign counts corrected by a dedicated re-check: each zero-kill file was re-run *alone* against 12 mutants that other files killed inside its mapped modules (`vacuous-check.json`).

| Test File | Attribution Level | Related Module(s) | Mutants Assigned (campaign runs) | Mutants Killed | Category | Suggested Follow-up |
|---|---|---|---:|---:|---|---|
| resolve-ready-gallery.test.js | file | server gallery route | 2,457 | 0 (re-check 0/12) | zero-kill/vacuous candidate | Its asserts likely check HTML text presence only; add behavioral asserts |
| topic-scout-nonce.test.js | file | server nonce boundary | 2,452 | 0 (0/12) | zero-kill candidate (narrow-purpose caveat) | Nonce-rejection logic mutants may not have been in the server sample; add a direct `validateLocalWriteRequest` unit test |
| outline-prompt-nonce.test.js | file | server nonce boundary | 2,452 | 0 (0/12) | zero-kill candidate (same caveat) | as above |
| friction-log-nonce.test.js | file | server nonce boundary | 1,894 | 0 (0/12) | zero-kill candidate (same caveat) | as above |
| quick-action-endpoints.test.js | file | server quick actions | 2,452 | 0 (0/12) | zero-kill/vacuous candidate | Verify it asserts response *content*, not just status 200 |
| video-prompts.test.js | file | video-prompts route | 2,069 | 0 (0/12) | zero-kill/vacuous candidate | Suspicious given the route has real logic; likely killed-first by cheaper files in campaign, but 0/12 in re-check too — review asserts |
| aigen-resolve-assembly.test.js | file | resolve assembly | 1,894 | 0 (0/12) | zero-kill/vacuous candidate | **Highest concern**: this suite guards the assembly hard-block; its kills are fully shadowed by other files AND it killed nothing alone in the sample — re-check with assembly-module-only mutants |
| aigen-production-pipeline.test.js | file | production pipeline routes | 1,894 | 0 (0/12) | zero-kill/vacuous candidate | as above |
| image-prompts-action.test.js | file | image-prompts action | 18 | 0 in campaign, **3/4 in re-check** | **no-mutant-opportunity (ordering bias — has teeth)** | none needed |
| 13 browser-side modules' hypothetical tests | — | app.js, media-gallery.js, … | 0 | — | no-mutant-opportunity (no tests exist) | DOM-harness coverage decision |
| remaining 41 test files | file | various | various | ≥1 kill each | not vacuous | — |

Caveat honestly stated: the 12-mutant re-check samples were drawn across each file's full mapped-module set (49 modules for server-coupled files), so a narrowly-scoped test can legitimately score 0/12 if none of the sampled mutants touch its specific target lines. The three nonce tests likely fall in that bucket; the two aigen pipeline/assembly files and resolve-ready-gallery are stronger vacuous signals because their subject modules contributed many sampled mutants.

## Timeouts / Tooling Failures

| Module | Mutant / Command | Failure Type | Exact Message | Impact |
|---|---|---|---|---|
| various (11 mutants) | mutated loop conditions (e.g. `readSync … > 0` → infinite loop variants) | timeout (per-file budget, SIGKILL) | `ETIMEDOUT` from spawnSync | Counted as detected (a hung suite is a detection) |
| various (14 mutants) | module-load-time mutations | runtime error (crash before assertions) | require-time TypeError/ReferenceError | Counted as detected, reported separately from assertion kills |
| — | Stryker | not attempted | dependency install prohibited in this repo | Custom harness used instead |
| 357 mutants | regex-generated syntax breakage | discarded pre-run by `node --check` | — | Not counted in any score |

## Equivalent / Likely Equivalent Mutants

Hand-reviewed sample of survivors judged likely equivalent (left in the survived count; listed for honesty):

| Module | Line | Mutation | Why Likely Equivalent |
|---|---:|---|---|
| package-engine-server.js | 220 | `OLLAMA_TIMEOUT_MS > 0` → `>= 0` boundary | Env unset in tests → both branches yield default |
| package-engine-server.js | 695 | `rmSync(dest, {force: true})` → `false` | Differs only when dest missing; tested flows always have dest |
| manual-media-import.js | 138 | `options.now \|\| new Date().toISOString()` → `&&` | Tests always pass `now`; behavior differs only in untested default branch (arguably a real gap, borderline) |
| supervised-capture.js | 103 | `return date.toISOString()` → `undefined` in a label helper | Output used only in display strings tests don't assert |
| several | — | `\|\|` fallbacks on optional display strings (`prompt_text \|\| ''`) | Affects only cosmetic defaults given tested inputs |

The dominance of `or-flip` (220) and `and-flip` (108) among priority-module survivors is partly this fallback pattern — but the hand review found the majority are *real* untested branches, not equivalents.

## Recommendations

1. **Strengthen first (highest value per hour):** table-driven unit tests for `media-provenance.js` (would kill ~90 mutants), the `resolve-handoff-readiness.js` mixed-state case, and the `manual-media-import.js` boundary/dir-validation cases. These sit directly on the media-integrity path.
2. **Add golden-file tests for `pipeline-tracker.js` mappings and `scripts/package-run-next-safe-action.js`** — the two canonical "where am I / what next" authorities are nearly unverified.
3. **Review the 8 zero-kill test files** — especially `aigen-resolve-assembly.test.js` and `resolve-ready-gallery.test.js`; they may assert presence rather than behavior.
4. **CLI smoke tests** for the four no-coverage gate wrappers (`import-manual-*`, `resolve-handoff`, `index-package-media`).
5. **Nightly job:** yes, but as a *subset* — the harness at ~8 h for a sampled full sweep is overnight-only; a 30-minute smoke config (priority modules, cap 25) would fit nightly and catch regressions in exactly the weak areas above. The harness (`mutation-harness.js`, workspace copy archived in evidence) is reusable as-is.
6. **Overall judgment of the suite:** not shallow theater — 1488 tests genuinely kill 46% of covered mutants, and the hard gates (capture verify 61.6%, handoff readiness 77.8%, media routing 63.3%) are the best-covered spots, which is the right shape. But breadth is thin: validation internals, canonical mappings, and CLI surfaces pass green while being largely unverified.

## Appendix: Raw Commands

All from `/home/vidtoolz/vidtoolz-episode-factory` unless noted. `<EV>` = `reports/mutation-evidence-20260703-195656`, `<WS>` = `/tmp/vidtoolz-mutation-20260703-200114`.

| Command | Exit | Runtime | Evidence |
|---|---|---|---|
| env/git/node verification | 0 | — | report header |
| `node tests/run-tests.js` (baseline) | 0 | 88.0 s | `<EV>/baseline-tests.log` |
| Stryker/parser availability checks (`node_modules`, npx cache) | 0 | — | none installed; decision recorded above |
| `git worktree add --detach <WS>/wt c576bd9` | 0 | — | isolation |
| per-file baseline timing (50 files, all pass) | 0 | 87.4 s total | `<EV>/test-file-times.json` |
| harness smoke (3-min deadline) | 0 | 3 m | validated loop + restore |
| `node mutation-harness.js --evidence <EV> --deadline-epoch <+9 h>` (background) | 0 | **8 h 01 m 43 s** | `<EV>/campaign.log`, `<EV>/mutation-results.json` (12 MB), `<EV>/module-test-mapping.json` |
| `node vacuous-phase.js <EV>` | 0 | ~6 m | `<EV>/vacuous-check.json` |
| result aggregation (python) | 0 | — | `<EV>/report-tables.md` |
| `git worktree remove --force <WS>/wt` (cleanup, after this report) | — | — | — |

Two setup mishaps were corrected before the campaign (documented for reproducibility): a first workspace built with `git archive` lacked `.git` and one dashboard test requires git (switched to a detached worktree); and an initial timing run wrote to a wrong path due to a shell-cwd reset (rerun with absolute paths).

## Appendix: Generated Artifacts

- `reports/mutation.md` (this report)
- `<EV>/baseline-tests.log`, `<EV>/test-file-times.json`
- `<EV>/mutation-results.json` — every executed mutant with file/line/op/original excerpt/verdict/killer
- `<EV>/module-test-mapping.json`, `<EV>/campaign.log`, `<EV>/vacuous-check.json`, `<EV>/report-tables.md`
- Harness scripts (`mutation-harness.js`, `mutation-mini-runner.js`, `vacuous-phase.js`) — lived in the temp worktree; copies preserved at `<EV>/harness/` for reuse
- Temp workspace `<WS>` — removed after report completion

## Appendix: Git State

- **Before:** clean tree @ `c576bd9`; untracked: `reports/cockpit-visual-verify-evidence-20260703-191903/`
- **After:** identical, plus untracked `reports/mutation.md` and `reports/mutation-evidence-20260703-195656/`
- **`git diff --stat`:** empty — **zero tracked files changed; no source, test, or package files modified**
- **Untracked created:** the two report paths above only
