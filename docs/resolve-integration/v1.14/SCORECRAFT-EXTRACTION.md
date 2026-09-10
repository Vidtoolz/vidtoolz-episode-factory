# Implementation lineage — Scorecraft extraction map v1.6 (FROZEN_NOW)

Active extraction targets are the **v1.6** authorities (`resolveTargetContract.v1.8`, `resolveSnapshot.v1.8`, `TARGET-ATTACHMENT-GATE.md`, `ELIGIBILITY.md`, `SEMANTIC-VALIDATION.md`). References to earlier schema versions in `../v1/`, `../v1.1/`, `../v1.2/`, `../v1.3/`, `../v1.4/`, `../v1.5/` are historical only.

Corrected to reflect verified evidence (2026-09-08). Scorecraft is **lineage/pattern, not canonical adapter**. Nothing here modifies Scorecraft.

Verified facts:
- Apply is an explicit experimental opt-in (`score-lane.js:3950-3962`, HTTP 403 unless `experimental_manual_resolve_assembly:true` or `SCORECRAFT_ENABLE_RESOLVE_ASSEMBLY=1`; "never reached by any approval path").
- **The production driver (`scripts/scorecraft-resolve-production-driver.py`) has no library/database guard.** Database guards DO exist in `scripts/scorecraft-resolve-driver.py:64-67` (P7 driver: Disk + "Local Database"), `scripts/scorecraft-resolve-production-fixture.py:70-71` (Disk + "Local Database" + database-list check) and `scripts/scorecraft-resolve-hardlink-fixture.py:72-73` (Disk + "Local Database" + empty library + `VIDTOOLZ_RESOLVE_HARDLINK_GATE_` prefix). The one path that would touch production audio (the production driver) is the one without the guard; none of the existing guards checks the canonical qualification library, so none is the required guard.
- The lane transport uses a 120 s synchronous timeout and `finally fs.rmSync(root)` (`score-lane.js:3836-3862`). **A timeout does not prove that no mutation happened**; deleting the temp root on exit deletes the only evidence of an unknown outcome. Both are unsafe lineage.
- The driver saves the project as part of apply **before** any external verification; `source_timeline_untouched: true` is an assertion the driver emits, not a readback proof.
- Readback rounds `GetStart`, reads only the two declared audio tracks, defaults speed to 100 and uses deprecated singular property calls.
- P7/P8 real-Resolve gate scripts (isolated `-nogui`) exist but no recorded pass exists under `~/outputs`.

| Component | Class | Disposition |
|---|---|---|
| explicit target contract shape (`normalizeTarget`) | QUALIFIED_PATTERN | PRESERVE as concept → `resolveTargetContract.v1.8` (attachment state derived from envelope-bound, current evidence against the active manifest, not declared) |
| duplicate-first destination timeline | pattern | REQUIRE_M3_PROOF (P6 id survival) |
| sha256 source identity; absolute-path/no-symlink | QUALIFIED_PATTERN | PRESERVE |
| namespaced marker customData | QUALIFIED_PATTERN | PRESERVE (own namespace `vidtoolz:resolve:binding:v1:`; `scorecraft:cue:v1:` stays Scorecraft's) |
| preflight → apply → verify shape | QUALIFIED_PATTERN | PRESERVE |
| apply opt-in gate | pattern | PRESERVE the principle; REWRITE as `PERMISSIONS.json` scopes (env-var opt-in is too weak) |
| 120 s synchronous driver timeout | unsafe | REJECT |
| `finally rmSync` temp evidence deletion | unsafe | REJECT; durable job directories, cleanup only after COMMITTED |
| database/library guard | present in P7 driver and fixtures, absent in production driver | REWRITE as mandatory in every path against the qualification library (`TARGET-ATTACHMENT-GATE.md`), not "Local Database" |
| readback | EXPERIMENTAL | REWRITE for `resolveSnapshot.v1.8` (all tracks, provenance variants, observation status on every timeline/project/track/item field, field provenance (`method_provenance`), unique occurrence identity, failure ledger, no rounding, plural APIs) |
| timeline targeting by name/index | unsafe | REWRITE to the identity tuple (`IDENTITY-BINDING.md`) |
| SaveProject before external verification | unsafe | REJECT; save only after `VERIFIED` (`SNAPSHOT-CONCURRENCY-RECOVERY.md`) |
| `source_timeline_untouched` assertion | unsafe | REJECT as proof; replace by the derived S0→S1 delta over the protected surface (`verify_transaction`, committed only via `commit_eligibility`) |
| P7/P8 isolated `-nogui` harness | EXPERIMENTAL | REQUIRE_M3_PROOF (P10); harness shape may be reused |
| hardlink verifier isolation + guards | QUALIFIED_PATTERN (real evidence) | PRESERVE |
| `draft-review-intake.js`, `draft-revision-plan.js`, `package-run-workflow-map.js` | canonical EF | REUSE_AS_IS; no parallel review engine |

Smallest influence on the canonical adapter: the isolated-launch environment block, the library/empty-library/prefix guards, the streaming sha256 helper, the explicit-target shape and the marker-namespace idea (~60 lines of reference). Everything else is re-specified from this bundle.
