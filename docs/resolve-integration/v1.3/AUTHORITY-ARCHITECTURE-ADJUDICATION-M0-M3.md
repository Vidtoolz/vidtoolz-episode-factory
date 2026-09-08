# Resolve execution authority freeze: adversarial architectural adjudication and M0–M3 qualification design

Date: 2026-09-08. Adjudicator: Claude Code. Inputs: `ADJUDICATION-FREEZE-CONTRACT.md`, `FREEZE-REPORT.md`, canonical bundle `vidtoolz-episode-factory/docs/resolve-integration/v1/` (manifest sha256 `d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821`, re-verified intact at review time), production baseline `f30e4543b0af17d047f803ae9044aef859ef13bc`. Read-only. No repository, bundle, Resolve or shared-library state touched. Hermes' concurrent preservation onto `docs/resolve-authority-freeze-v1` was observed to exist and was not waited on; no finding below depends on its final SHA.

Declared bias: the frozen bundle was authored by this adjudicator. The review below therefore looks hardest at its own choices.

---

## 1. VERDICT (summary; full list in §20)

**RESOLVE AUTHORITY ARCHITECTURE APPROVED FOR M0 QUALIFICATION**, with two MAJOR corrections that MUST land as bundle **v1.1** (a new version, never an in-place edit) before M2 attaches to a real timeline, and one BLOCKER that MUST be resolved before any milestone that consumes drift policy (M6 reconciliation onward). None of them affects M0, which is non-mutating and fully covered by the frozen doctrine, transport and target authority.

---

## 2. Frozen authority sufficiency and authority-leak trace (§1 of the mission)

Authority path traced through the frozen documents:

| Step | Frozen authority | Structural or rhetorical? | Leak assessment |
|---|---|---|---|
| Episode Factory truth | `DOCTRINE.md`; EF schemas (handoff, asset manifest, `draftReview.v2`, revision plan, lock) untouched | Structural: EF validators already refuse non-canonical inputs (proven: prototype handoff rejected) | NO ISSUE |
| Execution request | `TRANSPORT.md`: agents submit *authorized frozen plan ids*; adapter accepts no verbs/paths/scripts | Rhetorical until the adapter exists; the schema `resolveMutationPlan` (provisional) makes it structural by requiring digests of EF sources | NO ISSUE for M0–M2; becomes structural at M2 when the plan validator exists |
| Binding / identity | `IDENTITY-BINDING.md` + provisional `resolveSequenceLineage`, `resolveBindingSet` | Structural rule: `binding_id` allocated from EF lineage + semantic key, never from Resolve ids | NO ISSUE |
| Resolve observation | `resolveSnapshot` (frozen) + `resolveBindingObservation` (provisional, `created_by: VERIFIED_READBACK`) | Structural: observation is a separate object from the binding set; planned rows never gain ids in place | NO ISSUE |
| Mutation plan | provisional `resolveMutationPlan`: binds `h0_payload_sha256`, EF digests, expected old/new, no wildcards | Structural once implemented | NO ISSUE |
| Execution | adapter single writer; denied-call list in `TARGET-CONTRACT.json` | Structural (list is frozen data) | NO ISSUE |
| Verification | `resolveVerificationResult` with `is_human_approval: const false`, `unrelated=[]`, `missing_expected=[]` | Structural | NO ISSUE |
| Journal | `resolveTransactionJournal` hash-chained, intent before mutator | Structural once implemented | NO ISSUE |
| Commit / recovery | `resolveCommitManifest` under EF compare-and-swap; `COMMITTED_RECOVERED` requires EF pins unchanged | Structural | NO ISSUE |
| **Drift → EF** | `SNAPSHOT-CONCURRENCY-RECOVERY.md` and provisional `resolveConflict`: policy enum includes **`IMPORT_OVERRIDE`**; adjudication §5.5 defines **`STALE_ASSET`** as "file sha ≠ planned but equals another ACCEPTED asset for the same beat in a *newer* handoff" | **Rhetorical guard only.** `IMPORT_OVERRIDE` is a path by which a Resolve-observed human edit becomes EF state through adapter policy, not through `draftReview.v2`. The `STALE_ASSET` definition lets a Resolve observation *select* which handoff is "newer", i.e. Resolve state participates in choosing EF's current authority. | **BLOCKER** (for M6+; not for M0–M5). Correction in v1.1: `IMPORT_OVERRIDE` MUST only emit a *proposed* `draftReview.v2` note (unsubmitted, reviewer-attested later) and never a binding/handoff change; `STALE_ASSET` MUST be redefined as "observed sha ≠ the sha the *current EF head binding* expects", with EF's head chosen by EF alone. |
| Marker → review (M9) | adjudication §7 M9: markers → review notes "with `target_domain` captured (marker colour or name token)" | Rhetorical; Codex already warned colour/name cannot infer intent | **MAJOR**: markers MAY pre-fill a *draft* note in the EF review UI; only a human submission through `draft-review-intake.js` creates a note. Record in v1.1. |
| `RESOLVE_MATERIALISED` evidence state | `DOCTRINE.md`: "evidence state, never approval" | Rhetorical until the gate engine consumer is written | MINOR: the state projection MUST carry `authority_scope: RESOLVE_EVIDENCE` and MUST NOT be readable by `package-run-workflow-map.js` as gate evidence. |
| `COMMITTED_RECOVERED` | requires EF pins unchanged | Structural | NO ISSUE |

Conclusion for §1: the doctrine is enforced structurally at every step *except* the two reconciliation-era paths (drift policy and marker ingestion), where the frozen text still permits Resolve observations to become EF truth without an explicit governed handoff. Both are downstream of M5 and are fixable as v1.1 text without touching M0–M2.

---

## 3. Read vs write boundary audit (§2)

Frozen (FROZEN_NOW) items that implicitly dictate untested mutation behaviour:

| Item | Implicit mutation semantics | Verdict |
|---|---|---|
| `resolveSnapshot.schema.json` items `required`: `media_pool_item_unique_id`, `media_id`, `source_sha256` | Presumes every timeline item has a media-pool item and a hashable source. Generators, Fusion titles, compound clips, adjustment clips and offline media do not. A collector obeying this schema **fails on a real human timeline**, which is exactly what C1/M1 must read. | **MAJOR**: v1.1 MUST make these nullable with an explicit `source_status ∈ {HASHED, UNHASHED_UNOWNED, NO_MEDIA_POOL_ITEM, OFFLINE}`. Hashing unowned media is DEFERRED (locator+size+mtime instead). |
| `CAPABILITIES.json` row "inspect…" status `QUALIFIED_READ` citing `GetSettings`, `GetProperties`, `GetIsTrackLocked` | Every estate driver used the deprecated *singular* forms; the plural forms and the lock getters were never exercised. | **MAJOR**: v1.1 MUST split the row: singular-era calls (`GetItemListInTrack`, `GetStart/End/Duration`, `GetMediaPoolItem`, `GetName`) QUALIFIED_READ; `GetSettings`, `GetProperties`, `GetIsTrackLocked/Enabled`, `GetSourceStartFrame/EndFrame`, `GetUniqueId` NOT_TESTED. M0 resolves them read-only. |
| `TIMEBASE.json.profile_v1.start_frame_offset: 108000` (frozen) | Encodes the assumption that Resolve's `GetStartFrame()` for 01:00:00:00 @ 30 is 108000 and that `recordFrame` is absolute. | MINOR: correct as the *intended* EF value; the frozen text already routes the observed value through `api_mapping` (provisional) and `TIMEBASE_MISMATCH`. v1.1 should label it `intended_start_frame_offset`. |
| `resolveTrackPolicy.v1.json` (frozen) | Fixes V1..V4/A1..A2 role → index. Track *index* addressing assumes `AppendToTimeline.trackIndex` and `GetItemListInTrack(index)` agree and that human-added tracks do not shift indices. | MINOR: track policy is EF-side intent; the Resolve mapping (index stability, `AddTrack` at index) is an M3 probe. Mark the *mapping* provisional in v1.1. |
| `IDENTITY-BINDING.md` marker namespace and "item markers recover identity" | Presumes item markers survive delete+append (they do not; new item) and duplicate (unknown). | NO ISSUE: text already says identity resolves by bound ids within a target epoch; markers are corroboration. Keep. |
| `TARGET-CONTRACT.json` `denied_calls_all_scopes` | A write rule frozen without tests | NO ISSUE: denial needs no test. |
| `CANARY-SOURCE-MANIFEST.json` | Pure observation | NO ISSUE |
| Collision policy | Not frozen anywhere; `CAPABILITIES` row NOT_TESTED | NO ISSUE (correctly provisional) |
| Replacement semantics (TAKE_SWAP vs DELETE_AND_APPEND) | provisional | NO ISSUE |
| Rollback expectations | frozen as "none; recovery reconstructs" | NO ISSUE (correctly negative) |

Boundary verdict: correctly drawn except the two MAJOR items above, both of which over-freeze read-side assumptions.

---

## 4. Identity / binding architecture (§3)

Distinguishing power of the frozen model, by object:

| Object | Distinguished by | Stable? | Provisional dependency |
|---|---|---|---|
| Library | `GetCurrentDatabase()` {DbType, DbName} + external instance UUID (TARGET-CONTRACT) | UUID is external, stable; name is a label | none |
| Project | `Project.GetUniqueId()` + name | id documented; scope untested | M3 probe 5 |
| Timeline | `Timeline.GetUniqueId()` + name; index is NOT identity | id documented; survival across duplicate untested | M3 probe 5 |
| Track | (type, index) + name + lock/enable | index can shift if a human inserts a track; name is mutable | M3 probe (AddTrack at index) |
| Media-pool item | `GetUniqueId()` and `GetMediaId()` (two ids) + source locator + sha256 for adapter-owned media | untested which id is stable across relink | M3 probe 5 |
| Timeline occurrence | `TimelineItem.GetUniqueId()` + (track type, index) + start/end + media-pool item id + item marker customData | id documented, scope untested | M3 probe 5, 6 |
| Repeated occurrence of the same source | item unique id + start frame + item marker (`…:<binding_id>:<occurrence_id>`) | requires item ids to be per-occurrence (expected) | M3 probe 5 |
| Generated (EF) asset | sha256 ∈ EF asset manifest, `ACCEPTED` | stable | none |
| Human-edited/added asset | sha256 ∉ EF manifest, or item not in binding observation → `UNOWNED_CONTENT` | stable | none |
| Replacement candidate | exists only as an EF binding revision (`resolveBindingSet` predecessor chain) | stable | none |

Assumptions that MUST remain provisional until M3: uniqueness scope of `GetUniqueId` (per project? per library?); survival across `DuplicateTimeline`, DRT export/import, `FinalizeTake`, relink; which of `GetUniqueId`/`GetMediaId` is stable for media-pool items; marker customData duplicate behaviour; track index stability.

**Minimum identity tuple to target one occurrence without mutating another (v1):**

```
(library_instance_uuid, project_unique_id, timeline_unique_id, target_epoch,
 track_type, track_index, item_unique_id)
CROSS-CHECKED at pre-write against:
 (observed_start == expected_start, observed_end == expected_end,
  media_pool_item_unique_id == expected, item marker customData == idempotency key)
```

Any component mismatch → `IDENTITY_MISMATCH`/`TARGET_AMBIGUOUS`, no write. Display names never participate in selection; they are recorded for humans only. Until M3 proves item-id scope, the cross-check fields are mandatory, not optional.

---

## 5. Snapshot authority (§4)

**REQUIRED FOR V1 WRITE SAFETY (pre-mutation snapshot MUST capture):**
- library identity (`GetCurrentDatabase`) and external instance UUID; Resolve build string.
- project `GetUniqueId`, name; `GetProjectLastModifiedTime(name)` recorded as a tripwire value (trust determined by M3, see §6).
- timeline `GetUniqueId`, name, `GetStartFrame`, `GetStartTimecode`, `GetEndFrame`, settings subset (`useCustomSettings`, frame rate, width, height), and that it is the *current* timeline.
- track topology: count per type; per track name, `GetIsTrackLocked`, `GetIsTrackEnabled`.
- every item on every track (owned or not): `GetUniqueId`, name, start, end, duration (subframe precision on), source start/end, enabled, media-pool item ids, source locator, `source_status` (hash for adapter-owned media only in v1).
- all markers on timeline and on items: frame, duration, colour, name, note, customData.
- media-pool inventory of the adapter bin (`VIDTOOLZ/<run_id>/`): items, ids, locators, sha256.
- coverage mask with `UNOBSERVABLE_STATE` domains declared.

**USEFUL BUT DEFERRED (v1 does not write to these; observe when cheap, never gate on them):** transform/composite/audio properties, fades, speed, takes list, linked items, unowned-media hashes, grades/Fusion coverage, render settings/queue (separate scope), gallery, nested timelines.

Rule: anything not in the required set MUST be listed in `unobservable_domains` or `deferred_domains` so that "no unrelated change" claims are scoped honestly.

---

## 6. Concurrency model (§5)

**Exclusive session, operationally:** (1) a Resolve process launched by the adapter's recorded recipe with isolated `BMD_RESOLVE_*` support/config/cache/log roots; (2) `GetCurrentDatabase()` equals the qualification library; (3) a single adapter lease file (pid + token + expiry) in EF state, `EPERM` treated as alive; (4) no other API client: adapter records the set of processes holding `fusionscript.so` at lease time and refuses if any unknown one exists (best effort); (5) operator attestation recorded in the journal that no human will use this Resolve GUI during the lease; (6) adapter sets the destination timeline current and re-checks `GetCurrentTimeline().GetUniqueId()` before every mutator; (7) `SetTrackLock(true)` on every destination track *not* being mutated in this transaction, if M3 shows locks do not interfere with the adapter's own appends.

**What still races despite exclusivity:** operator breaks attestation and edits in the GUI; Resolve background tasks (asset map sync, relink, proxy/optimized media, cache) alter observable state; autosave/live save timing; `SetSettings` partial application; API returning False while having mutated; Resolve crash mid-call (observed today: assertion abort).

**Pre-write version token:** `H0 = payload_sha256` of a *stable* canonical snapshot (two equal consecutive complete reads), plus (project id, timeline id, `GetProjectLastModifiedTime` value, current-timeline id). Checked: immediately before the first mutator, and after each declared phase (checkpoint, import, append, marker, save) against the phase's expected delta. Invalidated by any digest difference, any id change, any tripwire change not attributable to the adapter's own last phase, lease expiry, or `AUTHORITY_CHANGED` in EF. **Fail closed:** on any invalidation, no further mutator; journal `CONFLICT` (pre-write) or `RECOVERY_REQUIRED` (mid-transaction); state left in place.

**`GetProjectLastModifiedTime(projectName)` implications:** its signature (a *project name* on `ProjectManager`) suggests it reads the library's stored modification time, i.e. it may change only on save, not on in-memory edits. If so it is a tripwire for *other clients' saved edits*, not for GUI edits in the live session. M3 probe (mandatory before any reliance):

```
P10: read T0 → GUI-free API append → read T1 → AddMarker → T2 → SetClipEnabled → T3 → SaveProject → T4 → wait 65 s idle → T5
     record which steps change the value, its granularity (s? ms?), whether T5==T4, and whether an in-GUI edit (operator, deliberate) changes it before save.
Outcome classes: LIVE_TRIPWIRE (changes on in-memory edits) | SAVE_ONLY_TRIPWIRE | UNUSABLE
```
Until classified, the value is recorded but never trusted.

---

## 7. Manual human-edit protection law (§6)

```
SNAPSHOT        stable read (≤3 pairs) → H0
  CONTINUE: two equal complete reads      RETRY: unequal reads (≤3)      ABORT: incomplete coverage on a required domain (SNAPSHOT_INCOMPLETE)
PLAN            build from EF head + H0
  CONTINUE: all selectors resolve to exactly one occurrence, all expected_old match H0
  CONFLICT: selector matches 0 (TARGET_MISSING) or >1 (TARGET_AMBIGUOUS); expected_old ≠ H0 (STALE_SNAPSHOT); unowned item on a policy track inside the mutation range (UNOWNED_CONTENT); EF pins changed since request (AUTHORITY_CHANGED)
  ABORT: plan digest cannot bind capability version (CAPABILITY_MISMATCH)
PRE-WRITE REVALIDATE   lease valid; current timeline == destination; stable reread == H0; tripwire unchanged; track locks as expected
  CONTINUE: all equal            RETRY: none (a changed world is a conflict, never a retry)
  CONFLICT: any difference (SNAPSHOT_CONFLICT / TIMELINE_CHANGED / TRACK_CHANGED / TRACK_LOCKED / HUMAN_CONFLICT)
MUTATE          one journaled phase at a time; intent fsync'd before the call
  CONTINUE: call returned truthy AND intermediate readback shows exactly the phase's expected delta
  RETRY: only transport-level failure BEFORE the mutator was issued (MCP_TRANSPORT_FAILURE with no intent record)
  ABORT→RECOVERY_REQUIRED: False/nil/timeout/exception (MUTATION_OUTCOME_UNKNOWN), partial delta (WRITE_PARTIAL), unexpected delta (UNEXPECTED_DELTA), Resolve exit (RESOLVE_CRASH)
READBACK VERIFY full S1; comparator
  CONTINUE: added/removed/changed == expected, unrelated == [], missing_expected == []
  ABORT→RECOVERY_REQUIRED: anything else (READBACK_MISMATCH); state preserved, no compensation
COMMIT          SaveProject → saved-state check → EF compare-and-swap on source pins → publish head
  CONTINUE: all succeed → COMMITTED
  CONFLICT: EF pins changed (AUTHORITY_CHANGED) → transaction remains VERIFIED-but-unpublished; destination preserved; human decides
  ABORT→RECOVERY_REQUIRED: save unverified (SAVE_UNVERIFIED)
```

Human-edit law: any item, marker, track state or setting present in S0 that is not in the plan's declared effect set is *protected*; a difference in protected state at any checkpoint is `HUMAN_CONFLICT` and blocks; the adapter never moves, deletes, relinks, re-enables or re-times protected state, in transaction or in recovery. There is no best-effort branch.

---

## 8. Timebase authority (§7)

Consistency check: EF integer-ms exact tiling; `output_fps 30` in two handoff fields; `CEIL_BOUNDARY_V1` B(m) = ceil(m·30/1000); 21 boundaries → 6756 frames = approved MP4 frame count; renderer (`Math.ceil`) and composition compiler (`CEIL_EVENT_MS_TO_FIRST_FRAME_AT_OR_AFTER`) agree. **Consistent.**

M3 must observe: `recordFrame` origin (absolute incl. offset vs timeline-relative); `endFrame` inclusive/exclusive; still duration on append; source duration reported for a 1- and 2-frame clip; `GetStartFrame()` for 01:00:00:00 @ 30 (expect 108000) and `GetStartTimecode()`; drop-frame flag off; whether `timelineFrameRate: "30"` round-trips as `30` and not `29.97`; subframe precision output type.

Scope decision: **keep `CEIL_BOUNDARY_V1` scoped strictly to profile v1 (30/1 NDF, 01:00:00:00, 1080×1920, 48 kHz).** Generalization to other rates, drop-frame, or mixed-rate sources requires a new profile with its own fixtures and M3-class evidence. Narrow authority is correct with the evidence available.

---

## 9. Transport responsibility table (§8)

| Concern | EPISODE FACTORY | EXECUTION ADAPTER | MCP SERVER (typed VIDTOOLZ facade) | RESOLVE | HERMES / AGENT | MIKKO |
|---|---|---|---|---|---|---|
| Production truth | OWNS | reads pins, never writes truth | none | none | none | final creative authority |
| Target identity | stores binding/observation | resolves within target epoch | passes plan ids only | exposes ids | none | approves target contract |
| Mutation policy | frozen plan schema, denied list | enforces | none | none | proposes plans | activates scopes |
| Conflict resolution | records conflicts/drift | detects, fails closed | reports | none | escalates | decides |
| Rollback doctrine | journal/commit manifest | checkpoint + recovery | none | none | none | approves compensation plans |
| Creative decisions | `draftReview.v2` | none | none | none | none | OWNS |
| Transport | — | local RPC/CLI | OWNS (stdio/HTTP, async transaction ids) | — | caller | — |
| Capability discovery | `CAPABILITIES.json` | enforces version | exposes read-only | — | reads | — |
| Invoking approved operations | authorizes | executes | invokes by plan digest | executes API | requests | authorizes |
| Read-only inspection | — | collector | exposes | API | consumes | — |
| Evidence delivery | stores | produces | transports | — | consumes | reviews |

The MCP server MUST NOT hold Resolve credentials or library configuration, MUST NOT translate free text into operations, and MUST NOT expose `run_script*`. The vendor MCP server is confined to a separately authorized scratch-exploration scope.

---

## 10. Scorecraft disposition (§9)

| Pattern / component | Disposition | Reason |
|---|---|---|
| Explicit target contract (`normalizeTarget`) | PRESERVE (as concept; generalize fields) | correct shape |
| Duplicate-first destination timeline | REQUIRE_M3_PROOF | id survival across `DuplicateTimeline` unknown |
| sha256 source identity, absolute-path/no-symlink rule | PRESERVE | correct |
| Namespaced marker customData | PRESERVE (own namespace) | correct; keep `scorecraft:cue:v1:` separate |
| Preflight → apply → verify shape | PRESERVE | correct |
| Apply opt-in gate (`EXPERIMENTAL_MANUAL_RESOLVE_ASSEMBLY`) | PRESERVE the *principle* (explicit scope gate), REWRITE as `resolvePermissions` scope | env-var opt-in is too weak for production |
| Driver timeout (120 s sync) | REJECT | unknown outcome ≠ failure; needs durable job + readback |
| Evidence lifetime (`finally rmSync(root)`) | REJECT | deletes evidence on unknown outcome |
| Database/library guard | REWRITE (guard exists only in hardlink fixture) | mandatory in every path |
| Readback (`clip_readback`, rounding, two tracks) | REWRITE | incomplete, lossy |
| Timeline targeting by name + index | REWRITE to id tuple (§4) | names/indices unstable |
| Temporary files | REWRITE to durable job directories | recovery needs them |
| Rollback/recovery (`source_timeline_untouched: true` assertion) | REJECT as proof; REWRITE as readback | assertion ≠ evidence |
| P7/P8 gate scripts (isolated `-nogui` Resolve) | REQUIRE_M3_PROOF (harness shape PRESERVE) | never recorded as passed |
| Hardlink verifier isolation (`BMD_RESOLVE_*` roots, empty-library guard, prefix guard) | PRESERVE | the best pattern in the estate |

Smallest Scorecraft influence on the canonical adapter: the isolated-launch environment block, the library/empty-library/prefix guards, the streaming sha256 helper, the explicit-target *shape*, and the marker-namespace idea. Roughly sixty lines of reference, re-derived under the new contracts. Everything else is re-specified from the frozen bundle. Lineage is not authority.

---

## 11. Quarantine architecture (§10)

Findings (verified): the production baseline `f30e454` never tracked `scripts/autonomous-visual-draft/` or `scripts/visual-director/` (both were untracked), so a clean branch from the baseline is prototype-free by construction; the quarantine on that branch is therefore *additive* (add `experiments/quarantine-2026-09-08/` with its README and manifests). The canonical validator rejects the prototype handoff. No production code loads `scripts/` by directory glob (all `readdirSync` targets are asset/run/composition dirs). Test discovery is an explicit require list. No env var other than `VIDTOOLZ_EXPERIMENTAL_INSPECTOR` (referenced only inside the quarantine). The `~/bin` launcher is a stub.

Residual collision channels and what Hermes/Codex MUST prove on the clean freeze branch:
1. `grep -r vidtoolz.directedDraftAssemblyHandoff.v1` matches only `config/directed-draft-assembly-handoff-schema.json` and `scripts/directed-draft-assembly-handoff.js` (plus documentation prose).
2. `grep -r 'scripts/autonomous-visual-draft\|scripts/visual-director'` matches only the quarantine README/manifest and historical evidence files.
3. `node tests/run-tests.js` does not require anything under `experiments/`; `scripts/verify.sh` passes on the branch (its side effects confined as documented).
4. `docs/DOC-AUTHORITY.md` carries the bundle row and `node scripts/docs-authority-check.js` passes.
5. `package-runs-index.json` references to the 2026-08-30 canary *run* are a legitimate run identity, not the prototype; leave them.
6. No systemd user unit, cron, desktop entry or `~/bin` script starts `directed-draft-inspector-server.js`; port 8095 not listening.
7. The quarantined inspector server exits 3 without the opt-in env var; `HUMAN-EDITORIAL-VERDICTS.json` files are not read by any production module.
8. Hash inventory of `experiments/quarantine-2026-09-08/` equals `QUARANTINE-MANIFEST.json` (`quarantined_sha256` per file).
9. The bundle's 34 files re-hash to `FREEZE-MANIFEST.json` and the manifest itself to `d9cd5478…8821` on the clean branch.

---

## 12. M0 contract (non-mutating)

**Goal:** prove the adapter can *see* Resolve correctly on the adjudicated host without writing anything, and resolve every read-side NOT_TESTED row.
**Entry:** bundle v1 preserved on the clean branch (Hermes) and independently hash-verified; Mikko's provisioning authorization for library `VIDTOOLZ Resolve Qualification v1` and the isolated session; PRESTO/VIDLAP2 versions recorded or explicitly deferred.
**Inputs:** TARGET-CONTRACT.json (fill root path, instance UUID, launch recipe hash → bundle v1.1), CAPABILITIES.json v1.
**Work allowed:** launch the isolated qualification Resolve (recipe recorded); connect via `DaVinciResolveScript`; `GetVersionString`, `GetCurrentDatabase`, project enumeration; create **nothing** (an operator-created empty scratch project is acceptable and recorded as human-provisioned); enumerate timelines/tracks/items of the operator-provided scratch project and, separately, of a `.drp` *copy* of a real Mikko project imported by the operator into the qualification library (never `EKA`); capture snapshots under the collector; observe `GetStartFrame`/`GetStartTimecode`/`GetSettings` on a 01:00:00:00 @ 30 timeline the operator created by hand; exercise plural read calls; record `GetProjectLastModifiedTime` values across idle time only.
**Outputs (artifacts):** `M0-EVIDENCE/` with `connection.json` (build, database, library UUID), `launch-recipe.sh` + sha256, `snapshots/*.json` (≥2 consecutive per target, digests equal), `capabilities-v2-read-rows.json` (each read row → QUALIFIED_READ or FAILED with evidence), `timebase-observation.json` (start frame/TC/fps readback vs profile v1), `journal.jsonl` of every API call (read-only), `M0-REPORT.md`.
**Acceptance gates:** zero mutator calls in the journal (allowlist: only getters, `SetCurrentTimeline` if needed for reading, no Save); two consecutive snapshots equal for each target; collector completes on the human-project copy without schema failure (this is what forces the v1.1 nullable fields); `GetStartFrame()==108000` on the hand-made timeline or `TIMEBASE_MISMATCH` recorded; every read row resolved.
**Forbidden:** `SaveProject`, `CreateEmptyTimeline`, `ImportMedia`, any marker, any settings write, `EKA`, Mikko's Local Database, Mikko's live session.

---

## 13. M1 contract (offline + read-only)

**Goal:** executable contracts. **Entry:** M0 passed; bundle v1.1 issued (corrections from §2–§3).
**Work:** Node canonicalization reproducing all six golden vectors byte-for-byte; executable validators for every frozen schema; timebase implementation reproducing the 21-boundary fixture (6756 frames) and the divergence cases; `resolveBindingSet` generation from the pinned canary handoff (dry-run, no Resolve) with binding ids from a synthetic sequence lineage; occurrence identity resolver over M0 snapshots (given a snapshot and a binding set, resolve 0/1/many; must return `TARGET_MISSING` for every row against an empty timeline and `IDENTITY_AMBIGUOUS` when fed a synthetic duplicate-marker snapshot); read-only mechanical QC over snapshots (duration, coverage, track topology vs policy); journal + recovery state machine implemented against fixtures with fault injection (no Resolve).
**Exit criteria:** vectors and fixtures pass in CI; binding set for the canary has 20 `BEAT_LAYER` + 2 `PROGRAMME_AUDIO` rows with exact planned frames from the fixture table; identity resolver behaves as specified on ≥3 synthetic snapshots; recovery state machine reaches a terminal state for every injected fault in fixtures; no Resolve call other than re-reading M0 targets.

---

## 14. M2 contract (final pre-mutation)

**Goal:** everything about a mutation except the mutation. **Entry:** M1 exit.
**Work:** attach the collector to the qualification session (still read-only); Canary C1 (readback determinism) against the operator's scratch project and the human-project copy; build a full `resolveMutationPlan` for one synthetic binding against a real H0 (dry-run flag), with expected old/new, allowed created, declared side effects; deterministic diff of two real snapshots differing by an operator-made change (operator adds a clip by hand between reads) → comparator must report exactly that item as `unrelated` and classify `HUMAN_CONFLICT`; conflict detection: plan built against H0, operator edits, pre-write revalidate must report `SNAPSHOT_CONFLICT` with zero mutator calls; journal PREPARED records written and *never executed* (dry-run); recovery planner run over a synthetic partial-journal fixture producing the correct terminal classification.
**What can be proven without writes:** snapshot determinism; canonicalization stability across runs; identity resolution against real ids; plan construction and digesting; comparator correctness on real human-made deltas; pre-write revalidation as a detector; journal durability and fsync ordering (dry-run); recovery classification logic; permission denial paths (denied calls refused before dispatch). **What cannot:** any API mutation semantics (all remain NOT_TESTED into M3).
**Exit criteria:** C1 pass; comparator detects the operator's change with `unrelated ≠ []` and `HUMAN_CONFLICT`; revalidate detects the change with zero writes; dry-run plan validates against the provisional schema; journal fixtures pass durability tests.

---

## 15. M3 scratch qualification matrix (first mutation-capable)

Constraints: adjudicated host vidnux; qualification library only; disposable `VIDTOOLZ_RESOLVE_QUAL_V1_M3_*` projects; synthetic media (1-, 2-, 30-frame clips; 1080×1920 stills); no canary media; no `EKA`; every probe journaled (PREPARED before call), snapshotted before/after, `SaveProject` only where the probe says.

| # | Probe | INPUT | ACTION | EXPECTED OBSERVATION | FAILURE SIGNAL | EVIDENCE | UNLOCKS |
|---|---|---|---|---|---|---|---|
| 1 | AppendToTimeline current-timeline | two timelines A,B; B current | append to "A" without switching | item lands on **B** (documented) | lands on A, or both | S0/S1 of A and B | `resolveMutationPlan.selector.timeline` rule: adapter MUST set current and verify |
| 2 | recordFrame origin | timeline 01:00:00:00 @30 | append at recordFrame=108000 and at 0 | `GetStart()` reveals origin; one lands at head | neither at head; refusal | S1, journal | `TIMEBASE.api_mapping.record_frame_origin` |
| 3 | endFrame inclusivity | 30-frame clip | append startFrame 0 endFrame 9 and 10 | `GetDuration()` 10 or 11 | inconsistent | S1 | `api_mapping.end_frame_convention`, `bindingSet.planned.*_exclusive` semantics |
| 4 | still duration | 1080×1920 PNG | append with endFrame N | duration N (or N+1) | fixed 5 s or refusal | S1 | still policy in `bindingSet.source` |
| 5 | collision | occupied [a,b) on V1 | append overlapping | overwrite/refuse/shift/new track (record which) | any silent overwrite of unowned item → COLLISION policy = refuse | S0/S1 | `COLLISION` taxonomy; plan precondition "interval empty" |
| 6 | GetUniqueId survival | items with recorded ids | DuplicateTimeline; Export DRT + Import; delete+append; AddTake→FinalizeTake | matrix of survive/change | ids reused across items (not unique) → BLOCKER | id tables | `resolveBindingObservation`, checkpoint schema, TAKE_SWAP class |
| 7 | marker limits | customData 64/256/1024/4096 B; duplicate customData ×2 | AddMarker; GetMarkerByCustomData; DeleteMarkerByCustomData | limits; which duplicate is returned/deleted | truncation, silent drop | S1 | marker namespace length; `MARKER_COLLISION` |
| 8 | SetSettings failure modes | valid dict + one invalid key | SetSettings; GetSettings | False + earlier keys applied (README) | all-or-nothing, or True with rejects | S1 | plan phase "settings" expected-delta rule |
| 9 | track lock behaviour | V1 locked | append to V1 via API; GUI edit attempt by operator | API refused? GUI blocked? | API bypasses lock | S1 | `TRACK_LOCKED` taxonomy; exclusivity mitigation |
| 10 | -nogui mutation | isolated `-nogui` session | probes 1–4, 7, 12 | identical outcomes to GUI session | refusal/no-op | journals | whether M4–M8 may run headless |
| 11 | duplicate naming | existing timeline "X" | CreateEmptyTimeline("X") | nil | second "X" created | S1 | `TARGET_AMBIGUOUS` prevention; naming rule |
| 12 | last-modified tripwire | see §6 P10 | reads around append/marker/enable/save/idle | classification LIVE / SAVE_ONLY / UNUSABLE | erratic | value log | tripwire trust level in `resolveSnapshot` |
| 13 | replace occurrence | item X (owned) | DeleteClips([X],false) → Append new | new id; neighbours unchanged; markers as expected | neighbours shifted | S0/S1 + comparator | DELETE_AND_APPEND class; recovery window doc |
| 14 | disable occurrence | item X | SetClipEnabled(false) → readback → true | enabled flag toggles; nothing else | position change | S1 | DISABLE class |
| 15 | identity drift | project/timeline ids | rename project, rename timeline, SaveProject, reopen | ids stable across rename/reopen | ids change → BLOCKER for epoch model | id tables | target epoch rules |
| 16 | failure recovery | kill adapter after PREPARED, after append-before-marker, after marker, after save | restart | terminal states NOT_APPLIED / COMMITTED_RECOVERED / ORPHANED_* correct | double-apply, lost evidence | journals + S1 | `resolveTransactionJournal`, `resolveCommitManifest` |
| 17 | readback verification | any probe | comparator over S0→S1 | `unrelated=[]`, expected present | unrelated ≠ [] on a controlled probe | verification results | `resolveVerificationResult` |
| 18 | Resolve crash mid-call | kill Resolve during append | restart Resolve + adapter | RECOVERY_REQUIRED → terminal | fabricated success | journal | `RESOLVE_CRASH` handling |

Every probe MUST record INPUT/ACTION/OBSERVATION/EVIDENCE in a `probe-<n>.json` under the M3 evidence package; a probe with an unexpected observation does not "fail M3", it *characterizes* the capability; only silent-mutation observations (5, 9, 13 neighbours) are BLOCKERs for the affected class.

---

## 16. M3 refreeze law

A row or schema moves `PROVISIONAL_UNTIL_M3` / `NOT_TESTED` → `FROZEN` / `QUALIFIED` only when **all** hold: (a) real scratch evidence exists as a `probe-<n>.json` with S0/S1 digests and journal; (b) expected and actual observations match, or the schema is amended to the actual behaviour and re-versioned; (c) failure behaviour is characterized (what False/nil/timeout/partial looks like for that call); (d) concurrency implications are recorded (which phases it spans; whether it is observable mid-call); (e) a readback/verification path exists that detects its effect; (f) recovery semantics for a crash inside it are written and fault-tested (probe 16 covers it). The refreeze is a **new bundle version** (v2.0.0) with its own manifest and approval. Documentation alone never qualifies anything; an ESTATE citation from a script that used deprecated forms does not qualify the plural form.

---

## 17. Long-transaction risk and V1 transaction granularity (§16)

Evidence: today's Resolve session ended with an assertion abort in `ResolveDebug.txt`. Design consequences: **one transaction = one binding occurrence** (import media if absent → append → item marker → timeline marker → readback → save → commit), ≤ 4 mutators per transaction; full snapshot between transactions; checkpoint (`DuplicateTimeline` + DRT export) once per batch of ≤ 10 transactions and before any DELETE; `SaveProject` at the end of every transaction; durable evidence (journal, snapshots, plan) written before any temp cleanup, and temp cleanup only after COMMITTED; restart resumes from the journal head by observation, never by replay; idempotency by marker customData so a re-submitted transaction is a no-op. Materializing the 20-beat canary is therefore ≈ 22 transactions in ≥ 3 batches, not one 42-call transaction.

---

## 18. Client version compatibility (§17)

Known: vidnux Studio 21.1.0 b14; PRESTO and VIDLAP2 unknown; `PYSTY UHD` opened from `EKA` in 21.1 today. Vendor statement: libraries stay compatible with 20.3.2; **projects opened in 21.1 become inaccessible to 20.3.2**. This is project-level, not library-level. Before any shared-library qualification (M10.5) MUST be known: exact Resolve version on every client that opens `EKA` (PRESTO, VIDLAP2, any other); which projects have been opened in 21.1 (at least `PYSTY UHD`; others unknown; `.recentprojects` on each client helps); whether Mikko's primary edit host can still open them (if PRESTO < 21.1, an operational incident already exists independent of this subsystem); backup freshness for `EKA` and `nelja` (latest observed 2026-08-13) and a restore test; a single-version policy decision (all clients on 21.1, or 21.1 confined to vidnux); collaboration-lock behaviour between vidnux and PRESTO on the same project. Recommendation: inventory PRESTO now, before the next human edit session.

---

## 19. Canonical failure taxonomy (§18)

| Code | Meaning | Retryable? | Behaviour |
|---|---|---|---|
| IDENTITY_MISMATCH | tuple component ≠ expected (project/timeline/item id) | no | fail closed before write |
| STALE_SNAPSHOT | plan H0 ≠ current stable digest | no (re-plan from a new snapshot is a *new* transaction) | fail closed |
| TIMELINE_CHANGED | timeline-level state (start, settings, end) differs | no | fail closed |
| TRACK_CHANGED | topology/lock/enable differs | no | fail closed |
| TARGET_MISSING | selector resolves to 0 | no | fail closed; report |
| TARGET_AMBIGUOUS | selector resolves to >1 | no | fail closed; preserve candidates |
| TRACK_LOCKED | destination track locked (human) | no | fail closed; HUMAN_CONFLICT |
| COLLISION | planned interval occupied | no | fail closed |
| API_REJECTED | call returned False/nil with no observable effect (readback == S0) | yes, once, same transaction, after re-validate | then fail closed |
| WRITE_PARTIAL | readback shows subset of expected delta | no | RECOVERY_REQUIRED, ORPHANED_PARTIAL |
| READBACK_MISMATCH | S1 ≠ expected (unrelated ≠ [] or missing expected) | no | RECOVERY_REQUIRED |
| RESOLVE_CRASH | process exit mid-transaction | no | RECOVERY_REQUIRED after Resolve restart; observation-based |
| MCP_TRANSPORT_FAILURE | facade/transport error | yes, if no PREPARED intent for a mutator exists; otherwise treat as MUTATION_OUTCOME_UNKNOWN | — |
| ADAPTER_FAILURE | adapter exception | no automatic retry; RECOVERY_REQUIRED if any intent was journaled | — |
| RECOVERY_REQUIRED | transaction not terminal | not a retry; run reconciliation | terminal via observation |
| HUMAN_CONFLICT | protected state changed by a human | no | preserve; request reconciliation |
| MUTATION_OUTCOME_UNKNOWN | timeout/exception after intent | no | readback → classify |
| AUTHORITY_CHANGED | EF pins changed | no | hold VERIFIED-unpublished; human decides |

Only `API_REJECTED` (with proven no-op) and pre-intent `MCP_TRANSPORT_FAILURE` are retryable, and only within bounded counts. Everything else fails closed.

---

## 20. Authority state machine (V1)

```
REQUESTED
 → AUTHORITY_VALIDATED      (EF pins, permission class, scope; else REJECTED_AUTHORITY)
 → HOST_VALIDATED           (host, build pins, library UUID, lease; else REJECTED_HOST / LEASE_BUSY)
 → PROJECT_BOUND            (project unique id + name; else IDENTITY_MISMATCH)
 → TIMELINE_BOUND           (destination timeline id, current; else IDENTITY_MISMATCH)
 → SNAPSHOT_CAPTURED        (stable H0; else SNAPSHOT_UNSTABLE/INCOMPLETE → ABORTED)
 → PLAN_BUILT               (digest binds H0 + EF digests; else CAPABILITY_MISMATCH / TARGET_* → CONFLICT)
 → PREWRITE_REVALIDATED     (== H0, tripwire, locks, current timeline; else CONFLICT)
 → MUTATION_AUTHORIZED      ★ unavailable until M3 refreeze (bundle v2) and Mikko's activation; before that the machine terminates here as DRY_RUN_COMPLETE
 → MUTATION_STARTED         (per phase: PREPARED → APPLIED_n with intermediate readback; deviations → RECOVERY_REQUIRED)
 → READBACK_VERIFIED        (S1 comparator; else RECOVERY_REQUIRED)
 → SAVED                    (SaveProject + saved-state check; else SAVE_UNVERIFIED → RECOVERY_REQUIRED)
 → COMMITTED                (EF compare-and-swap publish; AUTHORITY_CHANGED → VERIFIED_UNPUBLISHED)
Branches: CONFLICT (pre-write, zero mutators) · ABORTED (pre-write, adapter-side) · RECOVERY_REQUIRED → {NOT_APPLIED | COMMITTED_RECOVERED | ORPHANED_PARTIAL | ORPHANED_AMBIGUOUS} · VERIFIED_UNPUBLISHED (human decision)
```

---

## 21. Findings register

**BLOCKER (before M6 reconciliation and before any drift-policy code; not blocking M0–M5):**
- B1. `IMPORT_OVERRIDE` drift policy and the `STALE_ASSET` definition allow Resolve observations to become EF truth or to select EF's current handoff. Fix in bundle v1.1: `IMPORT_OVERRIDE` → produces only an unsubmitted `draftReview.v2` proposal; `STALE_ASSET` → "observed ≠ current EF head binding expectation", head chosen by EF alone.

**MAJOR (fix in bundle v1.1 before M2; M0 may proceed and will supply the evidence):**
- M1. `resolveSnapshot` requires `media_pool_item_unique_id`, `media_id`, `source_sha256` per item; real human timelines contain generators/titles/compound clips/offline media → collector fails. Make nullable with `source_status`.
- M2. `CAPABILITIES.json` "inspect" row over-claims `QUALIFIED_READ` for plural `GetSettings/GetProperties`, `GetIsTrackLocked/Enabled`, `GetSourceStart/EndFrame`, `GetUniqueId`; estate evidence used deprecated singular forms. Split the row; M0 resolves it.
- M3. Marker → review-note ingestion (M9 text) must be human-attested; markers pre-fill drafts only.

**MINOR:** label `start_frame_offset` as intended; mark track-policy Resolve mapping provisional; `RESOLVE_MATERIALISED` projection must be unreadable as gate evidence; add `deferred_domains` alongside `unobservable_domains` in the snapshot coverage mask.

---

## 22. Next recommended engineering sequence

1. Hermes: finish preservation on `docs/resolve-authority-freeze-v1`; independent re-hash (34 files, 5 pins, manifest `d9cd5478…8821`); quarantine proofs of §11 on that branch; report.
2. Mikko: decide the commit; authorize provisioning of `VIDTOOLZ Resolve Qualification v1` and the isolated session; obtain PRESTO/VIDLAP2 versions (Help › About) or authorize an SSH inventory.
3. Bundle **v1.1** (new version, new manifest, Mikko approval): B1, M1, M2, M3 and the MINORs above; fill TARGET-CONTRACT provisional fields at provisioning.
4. **M0** (read-only) per §12 → `M0-EVIDENCE/`, `CAPABILITIES.json` v2 read rows.
5. **M1** (offline) per §13.
6. **M2** (read-only attach, dry-run plan, conflict/comparator detection) per §14.
7. **M3** scratch matrix per §15 → bundle **v2.0.0** refreeze per §16 → only then `MUTATION_AUTHORIZED` becomes reachable, and only with Mikko's separate activation.

---

**RESOLVE AUTHORITY ARCHITECTURE APPROVED FOR M0 QUALIFICATION**
