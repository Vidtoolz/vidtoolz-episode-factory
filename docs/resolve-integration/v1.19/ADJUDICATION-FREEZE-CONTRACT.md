# VIDTOOLZ Resolve Execution Subsystem — three-way adjudication and candidate freeze contract

Date: 2026-09-08. Adjudicator: Claude Code. Status: **CANDIDATE FREEZE CONTRACT v0.1 — NOT FROZEN.** No production repository, Resolve project, database, remote host or shared library was modified. Read-only evidence only (file reads, sha256, ffprobe of a preserved MP4, arithmetic).

Inputs: Claude review (`REVIEW.md`, sha256 `123da15c…361f`), Hermes verification (`HERMES-INDEPENDENT-VERIFICATION.md`), Codex review (`~/outputs/codex-resolve-integration-review-2026-09-08/REVIEW.md`). Every collision below was re-checked against primary sources; where a reviewer (including Claude) was wrong, this document says so.

---

## 1. Adjudication verdict

**READY TO FREEZE WITH SPECIFIED CORRECTIONS**, scoped as follows:

- **Freeze now (authority layer):** A1 doctrine amendment, A2 quarantine inventory, A3 transport responsibilities, A4 host/library, A5 implementation lineage, the timebase law (§7), the canonical canary authority (§9), the static capability matrix (§4, documented rows), the concurrency guarantee statement (§6), and the milestone gates (§10).
- **Freeze after M3 only (empirical layer):** the mutation-capable schemas (§5) and the capability rows marked NOT_TESTED. They are drafted here so that M3 has exact questions to answer, and they MUST be re-frozen with M3 evidence before M4.

Corrections that this adjudication imposes on the reviews:
1. Claude's "no FPS in the handoff" is **wrong**; the canonical handoff carries `timeline.timebase.output_fps: 30` and `editor.output.fps: 30`. What is missing is the Resolve frame/timecode mapping.
2. Claude's half-up rounding is **rejected**; the canonical renderer and composition compiler already use ceil ("first frame at or after"), and the approved MP4 has 6756 frames, which only ceil reproduces.
3. Claude's and Hermes' "one open away from a one-way library upgrade" is **retracted as certainty**; see Collision C. The operational prohibition stands on other grounds.
4. Hermes' "Scorecraft is production-proven" is **overstated**; the apply path is an explicitly experimental opt-in, has a 120 s synchronous timeout with evidence deletion, no library guard in the production driver, and no recorded real-Resolve gate result.
5. Claude's ".dblist is user read/write" is **wrong**; mode is 0666.
6. Codex's snapshot/journal design is adopted in substance; its schema count is reduced to the set required before mutation, and its milestone reorder (conflict and crash recovery before full materialization) is adopted.

---

## 2. Collision table

| Collision | Claude | Hermes | Codex | Primary evidence | Adjudicated decision |
|---|---|---|---|---|---|
| **A — snapshot hash as revision; concurrency** | Content hash of readback snapshot = synthetic revision; guard re-snapshot before apply; destination-timeline-only writes eliminate GUI race | Approved Claude's model | Hash is an observation token, not CAS; `AppendToTimeline` targets the *current* timeline so the destination must be made current and is GUI-visible; needs an exclusively controlled session | Stub `:1900-1901` "Appends … in the current timeline"; no revision/CAS/event/undo API (grep); today's log shows project-level collaboration locks (`Lock project 1082f8ac…`) which are cross-client only; `SetTrackLock/GetIsTrackLocked` exist (`:2176-2179`, API-honoured? NOT_TESTED); `GetProjectLastModifiedTime` exists (`:1678`, advisory) | **Codex.** Doctrine = `BEST_EFFORT_OPTIMISTIC_CONCURRENCY` + `EXCLUSIVE_SESSION_REQUIRED_FOR_WRITES`. Snapshot hash is the guard token, not a lock. See §6 for exact semantics. |
| **B — FPS / timebase** | Directed Draft is integer ms with no fps and no start TC | "no FPS field in handoff" (repeated Claude) | Handoff has `output_fps: 30`, `frame_rounding: CANONICAL_RENDERER`, `editor.output.fps: 30`; lacks Resolve frame/TC mapping; law must be ceil (`CEIL_BOUNDARY_V1`) | Preserved r2 handoff `timeline.timebase = {unit: MILLISECOND, output_fps: 30, frame_rounding: CANONICAL_RENDERER}`; `editor.output.fps: 30`; `directed-draft-assembly-handoff.js:363`; renderer `production-assembly-renderer.js:607` uses `Math.ceil` for insert boundaries; composition `production-assembly-composition.js:53,127` `CEIL_EVENT_MS_TO_FIRST_FRAME_AT_OR_AFTER`; approved MP4 ffprobe `nb_read_frames 6756`, `225.200000 s`; ceil(225183·30/1000)=6756, half-up=6755 | **Codex.** FPS source = handoff `timeline.timebase.output_fps` cross-checked against `editor.output.fps`. Law = CEIL_BOUNDARY_V1. Start TC and start-frame offset are new contract fields (not in handoff). Full table in §7. |
| **C — network library upgrade** | EKA at 18.1.0.004, client 21.1, "first open triggers one-way upgrade" | Confirmed Claude | Schema evidence is a June probe quoting older logs; vendor ReadMe distinguishes library compatibility from project incompatibility; upgrade-on-open not established | **New today:** `ResolveDebug.txt` 2026-09-08 14:20:39 "Project library [EKA192.168.50.199] current version <18.1.0.004>"; 14:26:39 "Current project library changed to (EKA : Network)"; 14:26:41 "Loading project (PYSTY UHD) from project library (EKA192.168.50.199)"; no upgrade/migration line after; `/opt/resolve/docs/ReadMe.html`: "we have taken efforts to keep the project libraries compatible with DaVinci Resolve 20.3.2 … individual projects created or opened in 21.1 will no longer be accessible in 20.3.2. We recommend a full project library backup as well as individual project backups before opening projects in 21.1." | **Codex, with sharpened facts.** FACT: EKA reports 18.1.0.004; Mikko already connected 21.1 to EKA and opened `PYSTY UHD` from it today; no library upgrade event is logged. FACT (vendor): projects opened in 21.1 become inaccessible to 20.3.2 clients. RISK: other clients (PRESTO, vidlap2) of unknown version; shared human state; collaboration locks; no adapter guard exists in any driver except the hardlink fixture. UNPROVEN: that connecting or opening upgrades the library schema; the evidence now leans against it. DECISION: `NETWORK_LIBRARY_PROHIBITED_DURING_QUALIFICATION`, justified by shared human state and project-level irreversibility, **not** by library upgrade. |
| **D — Scorecraft maturity** | "Already implements the adapter pattern; generalise it" | "Production-proven, canary-tested … near-complete general safety layer" | Apply is `EXPERIMENTAL_MANUAL_RESOLVE_ASSEMBLY` opt-in; snapshot covers two audio tracks; no library guard; 120 s timeout deletes temp evidence | `score-lane.js:3950-3962` (403 unless opted in; "never reached by any approval path"); `:3836-3862` `timeout: 120000` + `finally rmSync(root)`; production driver has no `GetCurrentDatabase` (only `scorecraft-resolve-hardlink-fixture.py:72-73`); driver readback rounds `GetStart` and reads only the two declared audio tracks; P7/P8 gate scripts spawn an isolated `-nogui` Resolve with temp roots, but **no recorded P7/P8 result exists under `~/outputs`** | **Codex.** Scorecraft is a `QUALIFIED_PATTERN` for target/preflight/readback/comparator and `EXPERIMENTAL` for apply. Per-component classification in §8. It is the lineage, not a ready core. |
| **E — canary authority** | 2026-08-31 successor, 20 beats, 225 183 ms, JSON in preservation | Same | Same, plus 22/22 media hashes and MP4 hash verified; live paths unusable | Re-verified here: handoff file sha `b675b8f3…df66`, digest `3fd9bdd8…bf69`; MP4 `b5ba7bc0…5348`, 6756 frames; 22/22 media (20 stills + narration `9586e030…465c` + music `172d57ce…552c`) match preserved bytes after live→preserved path remap; review `mikko-r2-draft-approved` KEEP, 0 notes, subject `output_sha256` = MP4 hash; lock `final-production-lock-…-r2-f72ba0a7faf3d164` digest `2ab1fdc9…9401` | **Unanimous, now pinned.** Exact authority in §9. Topic 06 is a negative fixture only. |
| Credential file mode | "user read/write" | "plaintext confirmed" | "observed 0666" | `stat`: `.dblist` and `.activedb` are mode **666** | **Codex.** World-readable and writable. Remediation is a separate approved estate change; qualification config MUST NOT copy these files. |
| `SetCurrentDatabase` semantics | "closes open project without saving" | same | "closes any open project" is documented; "without saving" is not | `README.txt:146` | **Codex.** Denied in all production classes regardless; do not assert either save behaviour. |
| Mechanical repair scope | `STALE_ASSET`/`MISSING_ASSET` auto-repairable | same | Missing path may be a mount loss; a different asset may be human choice; no class-name repair | Estate history: VIDNAS-down wedges (memory `ef-cockpit-vidnas-down-wedge`) | **Codex.** Repair requires exact observed cause + current EF authority + explicit plan; never by class alone. |
| Human-drift distinction | Session ownership | same | same, plus explicit `UNOBSERVABLE_STATE` | — | **Unanimous**, with Codex's coverage mask. |
| Marker namespace | `vidtoolz:beat:v1:` | same | `vidtoolz:resolve:binding:v1:` + target epoch + binding id + occurrence id; do not claim all `vidtoolz:` | Scorecraft owns `scorecraft:cue:v1:` | **Codex.** Namespace frozen as `vidtoolz:resolve:binding:v1:`. |
| CUT mechanics | disable default, ripple explicit | same | CUT must follow the canonical revision plan (section re-tiling) → rebuild destination | `draft-revision-successor.js:323-368` `retileSection` | **Codex.** CUT = successor handoff → rebuild destination timeline. DISABLE is a preview aid, not CUT. |

---

## 3. Eight authority decisions

### A1 — DOCTRINE

**Existing doctrine (exact, verified):** `config/gate-mode-policy.json` gate 9 DRAFT boundary "no Resolve project is created, opened, or controlled"; PRODUCTION blocker "Resolve automation is deliberately out of scope"; `docs/draft-assembly.md:379-383, 429`; `scripts/final-production-package.js:447` `edit_mode: 'MANUAL — this blueprint organises Mikko's Resolve edit; it does not drive automated editing'` (asserted by test FPL18); memory `workflow-resolve-handoff-boundary` ("systems → Resolve, then wait"); gate `READY_FOR_MANUAL_RESOLVE_EDIT` is terminal before human NLE work.

**Amendment (adopts Codex wording with Hermes' gate addition):**

> Episode Factory remains the canonical authority for approved production intent, source identities, assets, review decisions and workflow gates. The default workflow continues to stop at "ready for Resolve". An explicitly enabled scope `RESOLVE_QUALIFICATION` MAY project a pinned canonical Directed Draft into an adapter-owned destination timeline in an approved isolated local project library. After the qualification gates in this contract pass and Mikko records a separate activation decision, scope `DIRECTED_DRAFT_MATERIALIZATION` MAY perform only the allow-listed materialization and revision operations named by a frozen mutation plan. Each Resolve mutation MUST have an explicit target, observed-state preflight, durable intent journal, guarded apply, readback, exact expected-delta verification and recoverable external publication. Unattributed or human changes MUST be preserved and MUST block incompatible writes. No Resolve result or mechanical QC result constitutes human review, final-edit completion, gate approval or publication authority. Existing `vidtoolz.finalResolveBlueprint.v1` artifacts and historical locks remain immutable and `MANUAL`. Shared-library writes, final editorial automation, delivery and publishing remain disabled unless separately authorized under their own qualified scope. Final creative authority remains with Mikko.

**Scope of permitted automation:** readback and snapshot (any qualified target); materialization of accepted assets onto adapter-owned destination timelines; revision re-materialization driven by canonical `vidtoolz.draftReview.v2` → `vidtoolz.draftRevisionPlan.v1` → successor handoff. **Prohibited:** editing Mikko's timelines, publishing, delivery render before M11, library switching, library upgrade, any operation outside a frozen plan.

**Gate impact:** retain `READY_FOR_MANUAL_RESOLVE_EDIT`; add `RESOLVE_MATERIALISED` as an *evidence* state on the adapter destination, never as approval. Gate policy MUST be versioned, not edited in place. Register `docs/resolve-integration/v1/DOCTRINE.md` in `docs/DOC-AUTHORITY.md`.

### A2 — PROTOTYPE QUARANTINE

**Conflicting artifacts (verified):** `scripts/autonomous-visual-draft/` (8 files: `run-topic06-canary.js`, `run-autonomous-draft-suite.js`, `run-activation-smoke-test.js`, `run-6-script-batch.js`, `run-small-batch.js`, `run-10-episode-pilot.js`, `run-full-video-drafts.js`, `directed-draft-inspector-server.js`); `scripts/visual-director/` (`visual-function-authority.js`, `visual-disposition-authority.js`, `blender-suitability-policy.js`, `blender-visual-mapper.js`, `blender-qc-runner.js`, `run-integration-suite.js`, `test_continuity_evolution.py`); output roots `~/outputs/live-autonomous-directed-draft-topic-06-2026-09-04/`, `controlled-autonomous-visual-generation-v1-2026-09-04/`, `autonomous-visual-draft-v1-production-activation-2026-09-04/`, `autonomous-directed-draft-small-batch-2026-09-04/`, `autonomous-directed-draft-10-episode-pilot-2026-09-04/`, `autonomous-directed-draft-6-scripts-2026-09-05/`, `draft-videos-6-scripts-2026-09-05/`.

**Defects:** four producers emit `schema: "vidtoolz.directedDraftAssemblyHandoff.v1"` with a non-canonical shape (fails canonical validator with `HANDOFF_UNKNOWN_FIELD: episode_id`); invented track layout `V1_PRESENTER_A_ROLL / V2_EXPLAINER_VISUALS / A1_NARRATION`; `HUMAN-EDITORIAL-VERDICTS.json` review store bypassing `vidtoolz.draftReview.v2`; `vidtoolz.directedDraftTimeline.v1` defined only by prototype code in seconds.

**Disposition (normative):**
- Both source trees MUST be moved out of `scripts/` to `experiments/` (or a branch) with a hash inventory. A `.gitignore` or directory move alone is insufficient; a **quarantine finish test** MUST show: canonical validators reject a representative prototype handoff; no production entry point, test discovery, service or scheduled task invokes them; the review-write endpoint is disabled or isolated.
- The prototype's schema id MUST be renamed to an explicit experimental id (`vidtoolz.experimental.autonomousDirectedDraftHandoff.v1`). Renaming does not canonicalize contents.
- `HUMAN-EDITORIAL-VERDICTS.json` MUST be preserved read-only as source evidence; any genuine human decision in it MAY be re-attested into `vidtoolz.draftReview.v2` only by the reviewer with exact draft hash and domain; nothing is inferred.
- `visual-function-authority.js` / `visual-disposition-authority.js` are `PRESERVE_REFERENCE`; adoption only through versioned canonical policy. `blender-qc-runner.js` counts spec primitives, not scene truth; its `qc_passed` flag MUST NOT authorize an asset.
- Prohibited from becoming authoritative: any prototype handoff, timeline JSON, EDL markdown, track breakdown, visual plan, QC receipt or review verdict. Topic 06 is a negative fixture only.
- Quarantine evidence (`QUARANTINE-MANIFEST.json`) MUST be frozen before any mutation implementation.

### A3 — TRANSPORT

| Layer | Responsibilities (MUST) | Prohibited (MUST NOT) |
|---|---|---|
| **AGENT** (Hermes, Codex, Claude) | Propose plans from canonical EF state; request inspections; submit *authorized* frozen plan ids; read transactions and drift reports; escalate to Mikko | Emit Resolve verbs; emit Python; hold Resolve credentials; treat any Resolve state as approval |
| **MCP** (agent boundary only) | A typed VIDTOOLZ facade over the adapter service: `inspect_target`, `propose_plan`, `submit_authorized_plan`, `read_transaction`, `reconcile_incomplete`. Asynchronous: returns transaction ids; caller disconnect never triggers replay | Expose `run_script`, `run_script_unsafe`, `execute_python`, `execute_lua`, raw LUT/library/admin tools in production. The official Blackmagic server MAY be used only in a separately authorized scratch-exploration scope |
| **VIDTOOLZ RESOLVE ADAPTER** (Node service + Python worker, single writer, durable jobs) | Authority checks against EF pins; canonicalization and hashing; plan freezing; journal (PREPARED before any mutator); target lease; preflight; guarded apply; readback; expected-delta verification; publication under EF compare-and-swap; conflict/recovery state machine | Accept script strings, free-form paths or raw verbs; operate without a frozen plan digest; write outside declared destination and owned objects |
| **RESOLVE SCRIPTING API** (`DaVinciResolveScript` via `/opt/resolve/bin/ResolvePython` 3.14 or external interpreter with `RESOLVE_SCRIPT_API`/`RESOLVE_SCRIPT_LIB`) | Bounded, typed observations and single mutators; every call's result captured; `False`/`nil`/timeout treated as `MUTATION_OUTCOME_UNKNOWN` pending readback | Be assumed atomic, undoable or transactional |
| **DAVINCI RESOLVE 21.1 Studio** | Execution environment; authoritative only for what Mikko did inside it | Be treated as production truth |

Decision: the deterministic adapter calls the scripting API directly. MCP is a protocol, not a nondeterminism source; the objection to the vendor server is responsibility (raw script execution bypasses VIDTOOLZ governance) and its 60 s per-call ceiling, not MCP itself.

### A4 — HOST / LIBRARY

- **Qualification host:** `vidnux`, DaVinci Resolve **Studio 21.1.0 build 14** (permanent RLM licence). Build, stub, README and MCP-bundle hashes MUST be pinned (Codex reviewed-byte pins are acceptable starting values).
- **Session:** a dedicated interactive qualification Resolve session with isolated support/config/cache/log roots (pattern: `verify-scorecraft-resolve-hardlink.js:80-86`), one recorded launch recipe. `~/bin/resolve-launch` MUST NOT be adopted unchanged (it deletes Resolve singleton lock files). External scripting preference `Local`; no network port 1144 exposure. Whether `-nogui` sessions can perform non-render mutations is NOT_TESTED here and is an M3 question (Scorecraft's P7/P8 gates assume yes).
- **Library:** a newly provisioned disk library `VIDTOOLZ Resolve Qualification v1`, recorded by root path and an external library-instance UUID. The user's existing "Local Database" MUST NOT be used merely because it is local. `.activedb`, `.dblist` (mode 0666, plaintext credential) MUST NOT be copied into qualification configuration.
- **Network production library `EKA` on ROJEKTI (192.168.50.199):** `NETWORK_LIBRARY_PROHIBITED_DURING_QUALIFICATION`. Known: version string 18.1.0.004 at connect today; already accessed from 21.1 today, and project `PYSTY UHD` opened from it in 21.1 (vendor: now inaccessible to 20.3.2 clients); collaboration project locks are in use. Unknown: client versions on PRESTO and vidlap2; whether any library-level change occurred. The adapter MUST refuse when `GetCurrentDatabase()` is not the configured qualification library. `SetCurrentDatabase` is denied in every class.
- **Conditions before network-library qualification (M10.5):** authorized server/client version inventory; fresh complete pg_dump of `EKA` and `nelja` plus config (`~/resolve-backups/` latest observed 2026-08-13 is not current); offline restore to a separate server/library; compatibility test with each real client version; operator-approved window; explicit rollback boundary. The milestone MAY conclude NO_UPGRADE_NEEDED or NO-GO.
- **Production topology:** vidnux is the automation worker; PRESTO remains the human NLE host per estate docs (version unverified). Promotion to a human host is explicit and version-checked; never an implicit overwrite.

### A5 — IMPLEMENTATION LINEAGE

Scorecraft is the lineage. A parallel safety/control implementation is **prohibited**; one shared core with two adapters (Scorecraft, Episode Factory). Exact per-module dispositions in §8. Scorecraft's existing production behaviour MUST NOT be migrated as collateral work in the first read-only slice; existing exports remain compatibility facades until contract tests pass.

### A6 — IDENTITY + TIMEBASE

Canonical relationship (no `episode_id` exists; do not invent one upstream):

```
run_id + story pin {project_id, version_id, content_hash}
  └ sequence_lineage_id                (new, Resolve-integration state only; links initial handoff + explicit successors)
      └ handoff_id (immutable, content-addressed) / revision
          ├ beat_id (composition beat, e.g. draft-still-007) → layer_id → binding_id → occurrence[]
          └ programme/section audio role (NARRATION, MUSIC) → binding_id → occurrence[]
binding revision → accepted asset {asset_id, sha256} | selected take | recipe → planned half-open record range
occurrence (observed) → target epoch + project_unique_id + timeline_unique_id + item_unique_id + media_pool_item ids + source sha
```

Rules (MUST): `binding_id` is allocated from `sequence_lineage_id` + semantic scope/key and survives asset replacement and handoff revision; it MUST NOT embed asset sha, handoff digest, array index, time position or `final_beat_id`. `final_beat_id` (`final-visual-NNN`) is positional and MUST NOT be used as identity. A layer MAY produce zero, one or many occurrences; zero requires explicit `NO_TIMELINE_ITEM` with reason. Narration and music are programme/section-scope bindings, not per-beat copies. Marker namespace `vidtoolz:resolve:binding:v1:<target_epoch>:<binding_id>:<occurrence_id>`; the adapter owns only that prefix, never all `vidtoolz:` and never `scorecraft:cue:v1:`. Identity resolution: bound ids within the target epoch, cross-checked with occurrence metadata and observed source/range; source sha is corroboration only; ambiguity → `IDENTITY_AMBIGUOUS`, preserve all candidates.

Timebase: §7 is normative.

### A7 — SNAPSHOT / CONCURRENCY / RECOVERY

Normative statements are in §5 (schemas) and §6 (guarantee). Summary: canonical snapshot with a coverage mask and `UNOBSERVABLE_STATE`; canonicalization = validated UTF-8 JSON, sorted keys by code point, schema-defined array order, tagged exact rationals for non-integers, no tolerance before hashing; payload digest is the guard token; stable collection = two equal consecutive complete snapshots (≤3 pairs); transaction = PREPARED journal → lease → stable reread == H0 → checkpoint → exact target guard → bounded operation → intermediate readback → full S1 → expected-delta comparator (`unrelated=[]`, `missing_expected=[]` mandatory) → SaveProject → saved-state verification → VERIFIED → publication under EF compare-and-swap → COMMITTED. Recovery reconciles observations and never blindly replays. Terminal states: `COMMITTED`, `COMMITTED_RECOVERED`, `NOT_APPLIED`, `CONFLICT`, `ORPHANED_PARTIAL`, `ORPHANED_AMBIGUOUS`.

### A8 — CAPABILITY MATRIX

§4 is normative. Every row marked NOT_TESTED that an M4+ operation depends on MUST be empirically resolved in M3 on the qualification library and the matrix re-frozen before M4. A documented signature is never a live PASS.


---

## 4. Capability matrix — Resolve 21.1 Studio build 14 (evidence-backed)

Legend: DOCUMENTED = signature in `DaVinciResolveScript.pyi` / `README.md`; ESTATE = exercised by an estate script against a real Resolve (FRB, Scorecraft hardlink fixture, resolve-hermes); NOT_TESTED = must be resolved in M3. Class vocabulary is the one requested.

| Required operation | Class | Primitive(s) | Evidence | M3 question |
|---|---|---|---|---|
| Inspect project/timelines/tracks/items/settings | DIRECT_API | `GetCurrentProject`, `GetTimelineByIndex/Count`, `GetTrackCount`, `GetItemListInTrack`, `GetSettings`, `GetProperties`, `GetStart/GetEnd/GetDuration(subframe)`, `GetSourceStartFrame/EndFrame`, `GetIsTrackLocked/Enabled` | ESTATE (resolve-hermes, Scorecraft) | none |
| Object identity | DIRECT_API | `GetUniqueId` on Project/MediaPool/Folder/MediaPoolItem/Timeline/TimelineItem; `MediaPoolItem.GetMediaId`; `GetLinkedItems`; `GetTakeByIndex` | DOCUMENTED | scope of uniqueness; survival across `DuplicateTimeline`, DRT export/import, `FinalizeTake`, delete+append |
| Machine metadata | DIRECT_API | `AddMarker(frameId,color,name,note,duration,customData)`, `GetMarkerByCustomData`, `UpdateMarkerCustomData`, `DeleteMarkerByCustomData` on Timeline/TimelineItem/MediaPoolItem; `MediaPoolItem.SetMetadata({…})` | DOCUMENTED (`README.txt:315-325`) | customData length limits; behaviour on duplicate customData; marker frameId semantics (timeline offset vs absolute) |
| Create timeline with canonical settings | DIRECT_API | `CreateEmptyTimeline`, `AddTrack`, `SetSettings({useCustomSettings:'1', timelineResolutionWidth/Height, timelineFrameRate…})`, `SetStartTimecode` | ESTATE (FRB used deprecated singular form) | plural `SetSettings` acceptance; partial-failure semantics (README.md:243: earlier settings kept on False); `CreateEmptyTimeline` returns nil on duplicate name (FRB) |
| Import media into controlled bin | DIRECT_API | `ImportMedia([{FilePath…}])`, `AddSubFolder`, `SetCurrentFolder`, `SetMetadata` | ESTATE (hardlink fixture used deprecated list form) | duplicate-import behaviour; symlink/hardlink handling |
| Exact placement with source range | DIRECT_API | `AppendToTimeline([{mediaPoolItem, startFrame, endFrame, mediaType, trackIndex, recordFrame}])` — **targets the current timeline** | DOCUMENTED; ESTATE for `recordFrame = GetStartFrame()` (hardlink fixture) | `recordFrame` origin (absolute incl. start TC offset: INFERRED); `endFrame` inclusive/exclusive; still-image duration control; collision with occupied interval; mixed source fps |
| Move / trim / slip / nudge existing item in place | UNSUPPORTED | none (`MoveClips` moves bin contents; `SetStartTimecode` is timeline-level) | stub grep | — |
| Equivalent move/trim of an owned simple item | DELETE_AND_APPEND | `DeleteClips([item], false)` then `AppendToTimeline` | DOCUMENTED | non-atomic; crash between calls is a first-class recovery case |
| Replace one occurrence's media, keep item | TAKE_SWAP | `AddTake`, `SelectTakeByIndex`, `FinalizeTake` | DOCUMENTED | item id survival; source bounds after finalize |
| Replace one occurrence by new occurrence | DELETE_AND_APPEND | as above | DOCUMENTED | same |
| Replace underlying media-pool file | UNSAFE (denied initially) | `ReplaceClip`, `ReplaceClipPreserveSubClip`, `RelinkClips` — global to all uses of the pool item | DOCUMENTED | — |
| Temporarily hide an item | DISABLE | `SetClipEnabled(false)` | DOCUMENTED | none |
| Close gap by deletion | RIPPLE_DELETE (disabled initially) | `DeleteClips([items], true)` | DOCUMENTED | downstream/linked scope; must enumerate every shift before enablement |
| Canonical CUT / section re-tile / script retime | REBUILD_DESTINATION_TIMELINE | successor handoff → new destination timeline; old destination preserved | EF `retileSection` | none (EF-side) |
| KEEP | COMPOSED_API_OPERATION (zero mutation) | verify binding; no promotion of absent feedback | EF intake | none |
| CHANGE / REWRITE | COMPOSED_API_OPERATION | canonical review → revision plan → successor → bindings → TAKE_SWAP / DELETE_AND_APPEND / REBUILD | EF revision authority | none beyond primitives above |
| Transform / crop / composite / audio properties | DIRECT_API | `SetProperties({Pan, Tilt, ZoomX, ZoomY…})`, `GetProperties` (singular forms deprecated, absent from stub) | DOCUMENTED | property whitelist, units, defaults, readback equality |
| Speed, fades, transitions | DIRECT_API | `SetSpeed`, `SetFades`, `AddTransition` | DOCUMENTED | ripple/handle effects |
| Titles / Fusion graphics | COMPOSED_API_OPERATION (deferred) | `InsertFusionTitleIntoTimeline`, `ImportFusionComp`; FRB `.setting` templates | ESTATE (FRB): insert duration = 5 s user preference, not scriptable; new `.setting` needs restart; `ExtentSet` quirk | accept pre-rendered registered graphics initially |
| Audio tracks, mapping, normalization | DIRECT_API (disabled beyond append) | `AddTrack('audio')`, mediaType 2 append, `SetAudioMapping`, `NormalizeAudioLevel` | DOCUMENTED | none for M4–M8 |
| Subtitles / AI tools | DIRECT_API (disabled) | `CreateSubtitlesFromAudio` etc.; Studio + Extras, fail soft False | DOCUMENTED | — |
| Checkpoint | COMPOSED_API_OPERATION | `DuplicateTimeline(name)` + `Timeline.Export(EXPORT_DRT)` + `SaveProject` + external manifest | DOCUMENTED | id survival across duplicate; DRT re-import creates new ids (expected) |
| Undo / rollback | UNSUPPORTED | none | stub grep | — |
| Revision counter / change events / CAS | UNSUPPORTED | none; `GetProjectLastModifiedTime(projectName)` is advisory | stub `:1678` | whether last-modified changes on every mutation (tripwire value) |
| Track locking as GUI-edit mitigation | DIRECT_API (NOT_TESTED effect) | `SetTrackLock`, `GetIsTrackLocked` | stub `:2176-2179` | does a locked track reject API appends? does GUI lock block accidental edits on destination tracks? |
| Cross-client project lock | OBSERVED (product behaviour) | project-server collaboration lock (`Lock project <uuid>` in today's log) | ESTATE log | granularity = project; not usable as item-level guard |
| Render / delivery | COMPOSED_API_OPERATION (M11) | `LoadRenderPreset`, `SetRenderSettings`, `AddRenderJob` → jobId, `StartRendering`, `GetRenderJobStatus`, `IsRenderingInProgress` | ESTATE (FRB): live GUI required (`-nogui` cannot queue), target must be a media-storage location, fails if frames exist | none before M11 |
| Playback control | UNSUPPORTED | `SetCurrentTimecode` is seek; no play/stop; estate uses `xdotool` | ESTATE | not used in production integration |
| Library switch / load other project / close project | UNSAFE (denied) | `SetCurrentDatabase` (closes open project), `LoadProject`, `CloseProject` | `README.txt:146` | — |
| Non-render mutation under `-nogui` | NOT_TESTED | Scorecraft P7/P8 gates assume `-nogui` supports append/duplicate/markers; no recorded result | gate scripts exist | resolve in M3 (decides whether qualification needs a GUI session for M4–M8) |

Coverage caveat (normative): grades, plugin/Fusion graphs, caches, nested timelines and keyframe curves are not fully serializable through the API. Snapshots MUST carry `UNOBSERVABLE_STATE` domains; "zero unintended change" MUST only be claimed within actual coverage. Initial mutation scope = simple owned media placements and whitelisted static properties in an isolated project.

---

## 5. Canonical schema set

All `vidtoolz.*.v1`, JSON Schema validators with enums, required fields and `additionalProperties: false`, canonicalized and digested by **one** specification with cross-language (Node/Python) golden vectors. Reduced from Codex's fourteen to the set required before each stage.

**Required before M2 (read-only) and M3:**

| Schema | Purpose | Notes |
|---|---|---|
| `vidtoolz.resolveTargetContract.v1` | host, build hashes, library instance UUID + root path, project/timeline epoch binding, session exclusivity rules, launcher recipe hash | replaces Scorecraft `normalizeTarget` shape, generalized |
| `vidtoolz.resolveTimebase.v1` | §7 | pinned per binding set |
| `vidtoolz.resolveTrackPolicy.v1` | layer type/z → track role/index; audio roles; owned marker prefix | the canonical track layout does not exist today |
| `vidtoolz.resolveSnapshot.v1` | canonical readback envelope + hashed payload + coverage mask + `UNOBSERVABLE_STATE` | §6 |
| `vidtoolz.resolveCanonicalization.v1` (spec + fixtures) | sorting, number encoding, exclusions | golden vectors |
| `vidtoolz.resolveCanarySourceManifest.v1` | §9 relocation manifest | frozen before M2 attaches to the canary |

**Required before M4 (first mutation):**

| Schema | Purpose |
|---|---|
| `vidtoolz.resolveSequenceLineage.v1` | initial handoff + explicit successor links; allocates stable `binding_id`s |
| `vidtoolz.resolveBindingSet.v1` | immutable rows: scope (`BEAT_LAYER`, `SECTION_AUDIO`, `PROGRAMME_AUDIO`), key, disposition, accepted asset sha, planned half-open record range, track role, recipe pins, occurrence specs; publication = new revision |
| `vidtoolz.resolveBindingObservation.v1` | binding-set digest + snapshot digest → target epoch + occurrences (item/pool ids, source sha, takes, marker, observed range); created only by verified readback |
| `vidtoolz.resolveMutationPlan.v1` | plan digest binds target epoch, source/handoff/binding digests, H0, capability/collector/timebase versions, permission, lease; ordered operations with selectors, expected old/new values or creation template, allowed created/deleted occurrences, declared side effects; **no wildcards** |
| `vidtoolz.resolveVerificationResult.v1` | comparator output: added/removed/changed fields, creation identity map, `missing_expected[]`, `unrelated[]`; explicit non-approval semantics |
| `vidtoolz.resolveConflict.v1` | typed codes (§6) with target/transaction, object/field, expected/observed evidence, non-mutating next action; drift classes for human edits |
| `vidtoolz.resolveTransactionJournal.v1` | append-only hash-chained records; durable intent before each API call; results/readbacks; checkpoint paths + hashes; publication record; terminal states |
| `vidtoolz.resolveCommitManifest.v1` | atomically published head naming immutable observation/binding-revision/receipt objects; readers derive success from it, never from a loose status file |
| `vidtoolz.resolveCheckpoint.v1` | duplicated timeline id + DRT path + hashes + pre-state digest |

**Required before M11/M12:** `vidtoolz.resolveRenderEvidence.v1`, `vidtoolz.resolvePermissions.v1` (verb classes × scope dimension × hard-denied set).

`vidtoolz.finalResolveBlueprint.v1` is not edited and not a mutation target. `vidtoolz.directedDraftTimeline.v1` (prototype-only) is retired.

---

## 6. Concurrency guarantee (exact)

**Doctrine name:** `BEST_EFFORT_OPTIMISTIC_CONCURRENCY` with `EXCLUSIVE_SESSION_REQUIRED_FOR_WRITES`.

**What Resolve provides (verified):** no revision counter, no compare-and-swap, no change events, no undo, no timeline lock API; project-level collaboration locks across clients on the project server (observed in today's log, granularity = whole project); `SetTrackLock` exists (effect on API writes NOT_TESTED); `GetProjectLastModifiedTime` exists (advisory tripwire). `AppendToTimeline` operates on the *current* timeline, so the adapter must make its destination current and that timeline is therefore visible and editable in the GUI during the transaction.

**Guarantees the architecture DOES provide:**
1. Any change within snapshot coverage between H0 (plan basis) and the pre-apply stable reread is detected and results in `SNAPSHOT_CONFLICT` with zero mutators invoked.
2. Any change within coverage between consecutive declared phases (checkpoint, import, append, marker, save) is detected by the intermediate readback and blocks remaining calls.
3. After apply, the full S1 comparator detects every unexpected post-condition within coverage (`UNEXPECTED_DELTA`) and every missing intended effect (`EXPECTED_DELTA_MISSING`); on either, the transaction does not commit and the state is preserved.
4. The adapter never writes to a non-destination timeline, an unowned object, or outside a frozen plan; it never writes after a detected conflict; it never deletes or moves human changes during recovery.
5. Two VIDTOOLZ workers cannot both hold the target lease (`LEASE_BUSY`).
6. Every outcome, including `False`, `nil` and timeout, is followed by readback and enters the same reconciliation path (`MUTATION_OUTCOME_UNKNOWN` → terminal state).

**What it CANNOT guarantee (must be stated wherever the system reports success):**
1. Prevention of a GUI or other-client edit in the window between the last read and a mutator call, or between mutator calls. This is the residual race. A concurrent human edit during an active transaction is a `CONFLICT` / unsupported state, detected after the fact at the earliest readback, not prevented.
2. Detection of changes outside snapshot coverage (`UNOBSERVABLE_STATE` domains: grades, Fusion graphs, caches, nested timelines, keyframe curves).
3. Atomicity of composed operations (delete+append, take swap, import+append+marker) or of Resolve mutation + SaveProject + external publication.
4. Rollback. Recovery reconstructs from checkpoint and journal; nothing is undone.
5. ABA changes (edit then exact revert) between reads.

**Operational rule (MUST):** writes require an operator-granted exclusive session: no simultaneous GUI editing of the destination project, no competing raw API clients, destination tracks locked via `SetTrackLock` once M3 shows locks do not block the adapter's own appends (else omitted), `GetProjectLastModifiedTime` recorded before and after as a tripwire. If exclusivity cannot be established, writes are NO-GO regardless of hash equality. Stable collection = two consecutive equal complete snapshots (≤3 pairs) before H0 is accepted.

**Conflict codes (frozen):** `TARGET_MISMATCH`, `LIBRARY_NOT_QUALIFIED`, `SESSION_NOT_EXCLUSIVE`, `LEASE_BUSY`, `CAPABILITY_MISMATCH`, `SNAPSHOT_UNSTABLE`, `SNAPSHOT_INCOMPLETE`, `SNAPSHOT_CONFLICT`, `AUTHORITY_CHANGED`, `TIMEBASE_MISMATCH`, `TIMEBASE_UNRESOLVED`, `TIMEBASE_COLLAPSED_INTERVAL`, `IDENTITY_AMBIGUOUS`, `IDENTITY_EPOCH_CHANGED`, `UNOWNED_CONTENT`, `MARKER_COLLISION`, `MEDIA_CHANGED`, `MEDIA_UNAVAILABLE`, `UNOBSERVABLE_STATE`, `EXPECTED_DELTA_MISSING`, `UNEXPECTED_DELTA`, `SAVE_UNVERIFIED`, `MUTATION_OUTCOME_UNKNOWN`, `RECOVERY_REQUIRED`, `JOURNAL_CORRUPT`. Drift classes for reconciliation: `NO_DRIFT`, `EXPECTED_HUMAN_OVERRIDE`, `STALE_ASSET`, `MISSING_ASSET`, `POSITION_DRIFT`, `DURATION_DRIFT`, `UNKNOWN_TIMELINE_ITEM`, `POLICY_VIOLATION`. A conflict or drift is never permission to repair.

**Transaction and recovery (frozen state machine):** `PREPARED` (journal, fsync, before any mutator) → `LEASED` → `PREFLIGHT_OK` (stable reread == H0) → `CHECKPOINTED` → per-operation `APPLIED_n` with intermediate readback → `READBACK_S1` → `VERIFIED` → `SAVED` → `PUBLISHED` (EF compare-and-swap on source pins; a new review/handoff during execution → `AUTHORITY_CHANGED`) → `COMMITTED`. Restart reconciles observations: S0 exact → `NOT_APPLIED`; exact intended S1 + persistence verified + EF pins unchanged → `COMMITTED_RECOVERED` (publish once); anything else → `ORPHANED_PARTIAL` or `ORPHANED_AMBIGUOUS` (preserve destination, journal, checkpoint; block further mutation pending explicit reconciliation). Never replay an append because a marker is missing; never clean up orphaned objects automatically.

---

## 7. Timebase law (normative)

**Authoritative FPS source:** handoff `timeline.timebase.output_fps`, cross-checked equal to `editor.output.fps`; mismatch or absence of both → `TIMEBASE_UNRESOLVED` (no 30 fps fallback for an unrelated draft). `frame_rounding: CANONICAL_RENDERER` is insufficient as a Resolve rule and is mapped by this law, not rewritten in historical JSON.

**Qualified profile v1:** `fps = 30/1`, non-drop, `timeline_start_timecode = "01:00:00:00"`, `start_frame_offset O = 108000`, progressive 1080×1920, audio 48 000 Hz. Any other rate, drop-frame, or geometry requires its own explicitly qualified profile; a decimal "29.97" MUST map to `30000/1001`, never an arbitrary approximation.

**Conversion law `CEIL_BOUNDARY_V1`:** a boundary is owned by the first output frame whose presentation time is at or after the authored millisecond. For non-negative integer `m` and reduced `p/q`:

```
den            = 1000 · q
B(m)           = floor((m·p + den − 1) / den)            # exact integer ceil(m·p/den)
absolute(m)    = O + B(m)
interval [a,b) → [O + B(a), O + B(b))                    # half-open in frames
duration       = B(b) − B(a)
```

Boundaries are converted independently and shared; durations are differences. Coincident boundaries share one frame and the later interval owns it. Reject negative times, invalid ranges, overflow, and required intervals that quantize to zero frames (`TIMEBASE_COLLAPSED_INTERVAL`). Rationale: this is the law the canonical renderer already applies to inserts (`production-assembly-renderer.js:607` `Math.ceil`) and the composition compiler to reveals (`CEIL_EVENT_MS_TO_FIRST_FRAME_AT_OR_AFTER`), and it reproduces the approved MP4 (6756 frames). Half-up would give 6755 and can place a boundary before its authored time.

**Tolerance:** planned-vs-observed placement and duration in frames is **exact (0)**. Quantization delays a boundary by `0 ≤ e < 1000·q/p` ms (< 33.34 ms at 30 fps); this is a property of the law, not an after-apply allowance. Programme video duration is `B(end_ms)`; the tail is extended by holding the final visual and silence only (17 ms for the canary), never by time-stretching narration. Audio boundaries at 48 kHz map exactly to `48·m` samples and are verified separately.

**Timecode:** NDF ordinal `O = (3600h + 60min + s)·N + f`. Drop-frame is a future profile only. `GetStartFrame()` and `GetStartTimecode()` MUST agree with the profile at M3, else `TIMEBASE_MISMATCH`.

**Source media:** source in/out are distinct from record frames; still duration is declared. Same-rate CFR only in v1; 25→30 or VFR sources require a registered deterministic conform derivative (sha-pinned, real-time duration preserved). `endFrame` inclusivity is adapter-versioned and tested in M3 on 1- and 2-frame clips.

**Legacy drafts:** use the pinned handoff's two fps fields when consistent; create an external immutable projection contract rather than editing historical JSON.

**Worked examples (30/1, O = 108000), verified by integer arithmetic:**

| ms | B(m) ceil | half-up | absolute | note |
|---|---|---|---|---|
| 0 | 0 | 0 | 108000 | |
| 16 | 1 | 0 | 108001 | law diverges from half-up |
| 17 | 1 | 1 | 108001 | |
| 33 | 1 | 1 | 108001 | |
| 34 | 2 | 1 | 108002 | |
| 1000 | 30 | 30 | 108030 | |
| 11555 | 347 | 347 | 108347 | canary beat 1 end |
| 23110 | 694 | 693 | 108694 | |
| 225183 | 6756 | 6755 | 114756 | canary programme end; matches MP4 |

**Canary boundary table (all 21 boundaries, ceil):** 0, 11555→347, 23110→694, 39110→1174, 55110→1654, 64110→1924, 73110→2194, 90110→2704, 107110→3214, 129340→3881, 151570→4548, 158840→4766, 166110→4984, 172110→5164, 178110→5344, 188605→5659, 199100→5973, 208000→6240, 210000→6300, 212000→6360, 225183→6756. Beat durations in frames: 347, 347, 480, 480, 270, 270, 510, 510, 667, 667, 218, 218, 180, 180, 315, 314, 267, 60, 60, 396; sum 6756. Half-up differs on 15 of 21 boundaries. These MUST be frozen as fixtures.

---

## 8. Scorecraft generalization plan

Status classification (evidence in Collision D). No component is `PRODUCTION_PROVEN` for Resolve mutation.

| Component | Class | Action |
|---|---|---|
| `score-engine/resolve-production-integration.js` `normalizeTarget`, plan identity/precondition, conflict planning | QUALIFIED_PATTERN → **GENERALIZE** | becomes `resolveTargetContract.v1` + plan precondition core; add host/library instance/session/coverage |
| same: `expectedProductionMarkers`, music/narration recognition | QUALIFIED_PATTERN → **REUSE_AS_IS** (Scorecraft adapter only) | audio-only semantics stay in the Scorecraft adapter; namespace `scorecraft:cue:v1:` stays owned by it |
| same: `validateProductionTimelineEvidence` | QUALIFIED_PATTERN → **WRAP** | preserve lane contract; run the general protected-state comparator alongside |
| `score-engine/resolve-timeline-evidence.js` | QUALIFIED_PATTERN → **REUSE_AS_IS** for its fixture; **EXTRACT** validation primitives later | not a general snapshot (drops ids, paths, timestamps) |
| `scripts/scorecraft-resolve-production-driver.py`: connection, `exact_target`, bounded enumeration, streaming sha256, absolute-path/no-symlink rule | QUALIFIED_PATTERN → **EXTRACT** into `runtime/api_21_1.py` | add library/session guards (the production driver has none), coverage bounds treated as incomplete not truncated |
| same: `readback`, `rational_rate`, `clip_readback` | EXPERIMENTAL → **REWRITE** for the general snapshot | reads two audio tracks only, rounds `GetStart`, omits ids/source ranges/effects, defaults speed 100, deprecated properties |
| same: `apply_plan`, marker edits, import | EXPERIMENTAL → **GENERALIZE** | keep duplicate-first; add journal, protected-source comparison, per-operation expected effects, plural 21.1 APIs; `source_timeline_untouched: true` is an assertion until replaced by readback proof |
| `score-engine/score-lane.js` preflight/apply/`recordProductionEvidence`, `EXPERIMENTAL_MANUAL_RESOLVE_ASSEMBLY` gate | EXPERIMENTAL → **WRAP** | lane keeps editorial authority and its gate; service owns job lifecycle |
| `score-lane.js` `runResolveProductionDriver` (120 s sync timeout, `finally rmSync`) | **DO_NOT_REUSE** as recovery mechanism | unknown outcomes need durable job directories, not deleted evidence |
| `scripts/final-production-lock.js` `canonicalize/digest` | QUALIFIED_PATTERN → **WRAP** | one canonicalization spec with cross-language golden vectors |
| `writeJsonAtomic` (handoff), `atomicJson` (agent-run) | QUALIFIED_PATTERN → **WRAP** | file-level only; add journal/commit-manifest protocol and durability tests |
| `scripts/operator-action-ledger.js` | QUALIFIED_PATTERN → **GENERALIZE** | actor validation + hash-linked events for Resolve transactions |
| `scripts/verify-scorecraft-resolve-hardlink.js` + `scorecraft-resolve-hardlink-fixture.py` | QUALIFIED_PATTERN (real, evidenced) → **EXTRACT** | isolated BMD profile launch, local-library assertion, empty-library guard, `VIDTOOLZ_` prefix guard |
| `scripts/verify-scorecraft-resolve-{real,production}.js` (P7/P8 gates, isolated `-nogui` Resolve) | EXPERIMENTAL (no recorded pass) → **EXTRACT** the harness shape; **re-run in M3** to answer the `-nogui` question | |
| `resolve-hermes/*.py` | QUALIFIED_PATTERN (read-only) → **WRAP** | connection/status; add build/target validation |
| FRB `resolve-render-validate.py` | PRESERVE_REFERENCE; **DO_NOT_REUSE** its automatic library switch | render lessons only |
| `draft-review-intake.js`, `draft-revision-plan.js`, `draft-revision-successor.js`, `package-run-workflow-map.js` | canonical → **REUSE_AS_IS** | no parallel KEEP/CHANGE/CUT/REWRITE engine |

**Layout (inside Episode Factory; not a new repository yet):**

```
resolve-core/
  contracts/            versioned JSON schemas + golden canonicalization/timebase fixtures
  canonicalize.js identity.js snapshot.js preflight.js mutation-plan.js verification.js conflict.js journal.js checkpoint.js service.js
  runtime/              Python: api_21_1.py (bounded typed calls), inspect.py, execute.py
resolve-adapters/
  scorecraft.js         existing policy/compatibility bridge; existing exports remain facades
  episode-factory.js    handoff → bindings → track policy; canonical review routing
```

Node owns canonicalization, authority checks and durable transaction state; Python owns bounded vendor API access and returns typed observations. Journal acknowledgment precedes each mutator call. The runtime is never an arbitrary script endpoint.


---

## 9. Canonical canary authority (immutable evidence, re-verified 2026-09-08)

**Run:** `2026-08-31-claude-real-20-bespoke-still-draft-successor`. **Preserved root (authoritative bytes):** `/home/vidtoolz/episode-factory-preservation/2026-09-02-pre-parser-bypass/live-untracked-originals/package-runs/2026-08-31-claude-real-20-bespoke-still-draft-successor/`. The live `package-runs/<run>/` holds media only and its declared paths are not usable authority by assumption; a relocation manifest (`vidtoolz.resolveCanarySourceManifest.v1`) MUST pin original locator → preserved locator → sha256 before M2 attaches. None of the three preservation copies becomes a new canonical head.

| Artifact | Identity |
|---|---|
| Handoff file | `media/directed-draft-assembly/directed-draft-handoff-3fd9bdd875c9eb489abf7779.json`, 60 673 bytes, sha256 `b675b8f33acfa0134d70c5205d66984e981b2b069fd35eb81071319b2eebdf66` |
| Handoff identity | `handoff_id directed-draft-handoff-3fd9bdd875c9eb489abf7779`, `revision 2`, `handoff_digest_sha256 3fd9bdd875c9eb489abf77797613abbc2616eef36073503742ebc9fd80f5bf69`; predecessor `directed-draft-handoff-cfd418bd4f1aa4b65ab5ddfc` (digest `cfd418bd…36c6`) |
| Story pin | project `01M0QR9DGP5RRFTPVDA7WQP2XM`, version `01M11CW0YTA8DJMXXZFYJQ6GG6`, content hash `f384d5cd6c74d40e702fc1cc5994fe48fafdc6c3d2dd4e4c45eff09c2061718e`, script sha256 `22ef594f…392ee`, approval `approved` |
| Timebase in handoff | `timeline.timebase {unit MILLISECOND, output_fps 30, frame_rounding CANONICAL_RENDERER}`; `editor.output {1080×1920, fps 30, libx264/aac 48 kHz stereo}`; `duration_ms 225183`; 11 narration sections; 20 composition beats `draft-still-001..020`, 1 layer each (`FULL_CANVAS_VISUAL`, z 0, asset_id = beat_id) |
| Media | 20 stills (all `IMAGE`, 1080×1920, role `DRAFT_BESPOKE_STILL`, `ACCEPTED`) + narration `media/draft-inputs/narration.wav` sha256 `9586e030ffff3d3c7aa877d7e587d13187feddb31abc8f531153c963ca8d465c` (225 183 ms) + music sha256 `172d57ce571cfd29c58a16837d5834e1401a122b7e05e09b88318159328b552c` (237 016 ms): **22/22 hashes match preserved bytes** after live→preserved path remap |
| Asset manifest | `draft-bespoke-asset-manifest.json`, `vidtoolz.productionAssemblyAssetManifest.v1`, 20 assets, sha256 `79ebc228…4aac` |
| Composition | `draft-bespoke-composition.json`, sha256 `81e4bd70…0229` |
| Approved comparison artifact | `media/directed-draft-assembly/directed-draft-r2.mp4`, 19 272 011 bytes, sha256 `b5ba7bc097ce450714afef5a8f38ad82d64010b2e1129d01766e9cd80a515348`; ffprobe 1080×1920, 30/1, **6756 frames, 225.200 s**; render manifest sha `07b1a28b…dfdc`, render plan sha `1d831ae1…f903` |
| Human review | `draft-review/mikko-r2-draft-approved.json`, `vidtoolz.draftReview.v2`, verdict **KEEP**, 0 notes, reviewer HUMAN Mikko Pakkala, `review_subject.output_sha256` = the MP4 hash, `review_subject.handoff_id` = the handoff id; binding digest `5a89364e…ce9f`, submission digest `232dba31…75cc`; sha256 `c1875cb8…2957` |
| Lock | `final-production-lock.json`, `vidtoolz.finalProductionLock.v1`, `lock_id final-production-lock-2026-08-31-claude-real-20-bespoke-still-draft-successor-r2-f72ba0a7faf3d164`, `lock_digest_sha256 2ab1fdc92a5db076ad8ad70844b0544511f0da1932d03b62b5eb480f8af99401`; sha256 `cafe0ec8…0bdd` |
| Blueprint (MANUAL, not a target) | `final-production/final-resolve-blueprint.json`, `vidtoolz.finalResolveBlueprint.v1`, `edit_mode MANUAL`, output 1080×1920 @ 30; sha256 `1eb5d964…f903` |
| Frame-rate authority | handoff `output_fps 30` = `editor.output.fps 30` = MP4 `30/1` = blueprint `fps 30` |

This adjudication grants no new gate approval. Topic 06 (`~/outputs/live-autonomous-directed-draft-topic-06-2026-09-04/`) is a negative fixture (schema collision, missing media) only. A small synthetic fixture (1–3 beats) precedes the 20-beat canary in M3–M4 and is explicitly synthetic.

---

## 10. Corrected milestone plan

Sequence change forced by evidence: conflict and crash-recovery qualification (M6, M7) move **before** full 20-beat materialization, because a full materialization is ~42 mutations and must not be the first place a torn transaction is discovered. Every milestone: entry gate → allowed work → acceptance evidence → forbidden work.

| M | Name | Entry gate | Allowed work | Acceptance evidence | Forbidden |
|---|---|---|---|---|---|
| **M0** | Estate + capability inventory | this adjudication accepted | pin vendor build/doc/stub/MCP hashes; static capability matrix (§4); dated estate facts; NOT_TESTED list | `CAPABILITIES.json` with DOCUMENTED / ESTATE / NOT_TESTED per row; no row upgraded without evidence | any Resolve call beyond `--dump-tools`; any mutation |
| **M0.5** | Authority freeze | M0 | A1 doctrine text approved by Mikko; A2 quarantine inventory + finish test defined; A4 host/library/session/launcher; A3 transport; A5 lineage; §9 relocation manifest | `FREEZE-MANIFEST.json` v1 with hashes and approver | quarantine moves executed without approval; schema promotion |
| **M1** | Contract freeze (offline) | M0.5 | schemas in §5 (pre-M2 set + drafts of pre-M4 set), canonicalization spec + cross-language golden vectors, timebase fixtures (§7 table), journal/recovery state machine, expected-delta language | validators executable; golden vectors pass in Node and Python; timebase fixtures pass | any Resolve connection |
| **M2** | Read-only collector + dry-run | M1; quarantine finish test passed | `resolve-core/snapshot` against offline fixtures and an authorized attach to the provisioned qualification session; dry-run plan for the canary (bindings, boundary table, predicted items) | Canary **C1**; dry-run plan predicts 20 video + 2 audio occurrences and 6756 frames | any mutator, including `SaveProject`, checkpoint, import |
| **M3** | Scratch primitive qualification | M2; separately authorized disposable project in the qualification library | resolve every NOT_TESTED row: `GetStart`/`recordFrame` origin, `endFrame` inclusivity, still duration, collision behaviour, id survival (duplicate / DRT / take / delete+append), marker customData limits and duplicates, `SetSettings` partial failure, `SetTrackLock` effect on API appends, `-nogui` non-render mutation, `CreateEmptyTimeline` duplicate name, `GetProjectLastModifiedTime` behaviour | re-frozen `CAPABILITIES.json` v2 and re-frozen timebase mapping; each answer with readback evidence | touching any non-disposable project; network library |
| **M4** | One binding mutation | M3; pre-M4 schemas frozen | PREPARED → lease → preflight → checkpoint → import → append → marker → readback → verify → save → publish for one still on a synthetic fixture | Canary **C2** (single occurrence) + idempotent second request = 0 operations | multi-beat; review semantics; ripple delete; ReplaceClip |
| **M5** | Exact expected-delta replacement | M4 | TAKE_SWAP and DELETE_AND_APPEND on the one binding; protected-state proof | Canary **C3** | ripple; multi-binding |
| **M6** | Concurrency qualification | M5 | Canary **C6** cases: unowned item edit, marker note/colour, track lock, owned position/property, target switch, second worker, unstable snapshot, EF authority change | all cases terminal `CONFLICT` or `LEASE_BUSY`, zero mutators after detection, post-state equals the interfering state Hx | writes without exclusive session |
| **M7** | Crash / transaction recovery | M6 | Canary **C7** fault matrix at every phase boundary (after PREPARED, checkpoint, import, delete, append-before-marker, marker, readback, save, VERIFIED, receipt, head); Canary **C8**; worker and Resolve restarts | every injection → one auditable terminal state; repeated restart idempotent; no replay, no cleanup, no lost evidence | — |
| **M8** | Deterministic materialization | M7 | one layer → all 20 layers + programme narration + music on the pinned canary; render via Quick Export or manual render; frozen comparison profile against the approved MP4 | Canary **C2** full: 20 + 2 occurrences, exact boundary table, 6756 frames, idempotent re-run, all markers, render comparison within the frozen perceptual profile (positions exact regardless) | prototype authority; network library |
| **M9** | Canonical review semantics | M8 | markers → `vidtoolz.draftReview.v2` notes **with domain**; `draft-revision-plan.js` → successor handoff → new binding revision → re-materialize changed bindings only (CHANGE = TAKE_SWAP / DELETE_AND_APPEND; CUT / REWRITE = REBUILD_DESTINATION_TIMELINE) | Canary **C4** (human drift preserved; incompatible apply refused) + successor materialization proofs | disabling as CUT; ripple as CUT; parallel review store |
| **M10** | Mechanical QC + safe repair | M9 | snapshot-based QC (duration, placement, media, geometry, audio presence, coverage, `UNOBSERVABLE_STATE` declared); repair only with exact observed cause + current EF authority + explicit plan | Canary **C5** | repair by class name; position/duration/unknown-item repair |
| **M10.5** | Shared-library qualification | M10; Mikko's explicit authorization | client/server inventory; fresh complete backup; offline restore; compatibility per real client; concurrency with collaboration locks; rollback boundary | evidence set; decision may be NO_UPGRADE_NEEDED or NO-GO | opening/upgrading EKA as a "test" |
| **M11** | Delivery / render qualification | M10 (library independent) | separate `RESOLVE_RENDER` permission; live GUI session; media-storage target; durable job ids; ffprobe + hash of outputs → `resolveRenderEvidence.v1` | render evidence for the canary; no publish | upload/publish; render into non-isolated paths |
| **M12** | Bounded production canary | M10.5 (if network) or local staging library; Mikko activation decision | one real run, supervised, `DIRECTED_DRAFT_MATERIALIZATION` scope only | full journal + commit manifest + human review record | unattended runs |
| **M13** | Production rollout | M12 | activation by scope; frozen build/host/library; monitoring; stop/recovery procedure; small supervised batches | rollout record | expansion without evidence |

---

## 11. Freeze checklist (immutable and fingerprinted before M2, and before any mutation-capable work)

Proposed bundle `docs/resolve-integration/v1/` (creating it is an approved repository change, not part of this adjudication) with `FREEZE-MANIFEST.json` listing sha256 + approver + version; the manifest digest recorded externally; status/version set before hashing; any semantic amendment = new version.

**Before M2:**
1. `DOCTRINE.md` — A1 text, scope, gate impact, DOC-AUTHORITY registration. Approver: Mikko.
2. `QUARANTINE-MANIFEST.json` — A2 inventory, dispositions, finish-test results.
3. `TARGET-CONTRACT.json` — A4 host, build/doc/stub/MCP hashes (start from Codex's reviewed-byte pins), library instance UUID + root, session exclusivity rules, launcher recipe hash, external-scripting preference.
4. `TRANSPORT.md` — A3 responsibility table; denied tools list.
5. `SCORECRAFT-EXTRACTION.md` — §8 table and boundary.
6. `CAPABILITIES.json` v1 — §4 with evidence class per row.
7. `TIMEBASE.json` + `fixtures/timebase/` — §7 law, profile v1, 21-boundary canary table, divergence cases (16, 34, 225183 ms).
8. `CANARY-SOURCE-MANIFEST.json` — §9 identities and relocation map.
9. `CANONICALIZATION.md` + `fixtures/canonicalization/` — cross-language golden vectors.
10. `schemas/` pre-M2 set: `resolveTargetContract`, `resolveTimebase`, `resolveTrackPolicy`, `resolveSnapshot`, `resolveCanarySourceManifest`.
11. `CANARIES.md` — C1–C8 with exact PASS/FAIL (this document §10 and the three reviews' canary sections reconciled).
12. `MILESTONES.md` — §10.
13. `PERMISSIONS.json` draft — verb classes × scope (`SCRATCH_QUALIFICATION_LIBRARY` | `LOCAL_STAGING_LIBRARY` | `PRODUCTION_LIBRARY`) × hard-denied set (`SetCurrentDatabase`, `CloseProject`, `ImportProject`, `DeleteTimelines` on non-owned, `ReplaceClip`, `run_script*`, `execute_*`).

**Before M4 (after M3 evidence):**
14. `CAPABILITIES.json` v2 with every M4-dependent NOT_TESTED row resolved.
15. `TIMEBASE.json` v2 with the API-to-frame mapping (`recordFrame` origin, `endFrame` convention) proven.
16. `schemas/` pre-M4 set: `resolveSequenceLineage`, `resolveBindingSet`, `resolveBindingObservation`, `resolveMutationPlan`, `resolveVerificationResult`, `resolveConflict`, `resolveTransactionJournal`, `resolveCommitManifest`, `resolveCheckpoint`.
17. `RECOVERY.md` — state machine, persistence ordering, orphan retention, fault matrix.
18. Marker namespace and idempotency rule text.

---

## 12. GO / NO-GO

**GO immediately after this adjudication is accepted (no Resolve mutation, no production repository change):**
- Mikko's decisions: A1 doctrine text; A4 host/library/session; authorization to provision the qualification library and session (a separate operator action).
- M0: static inventory and `CAPABILITIES.json` v1 under `~/outputs/` or a reviewable branch.
- M0.5 preparation: quarantine inventory and finish-test design; the moves themselves wait for approval.
- M1 offline work: schemas, canonicalization spec, golden vectors, timebase fixtures, canary relocation manifest — under `~/outputs/` or a branch, not merged.
- Continued read-only inspection of vendor docs and estate.

**NO-GO until the "before M2" freeze items are hashed and approved:**
- Any Resolve write (including `SaveProject`, `DuplicateTimeline`, import, checkpoint).
- Attaching to Mikko's live Resolve session or his Local Database; any use of `EKA`.
- Executing quarantine moves/deletions; editing production code to adopt the proposal; changing gate policy.
- Enabling any MCP script tool; copying `.dblist`/`.activedb`; changing file permissions or credentials (separate approved estate change).
- Using Topic 06 or any prototype artifact as authority.

**NO-GO until M3 evidence re-freezes capabilities and timebase:** M4 and every later mutation milestone.

**NO-GO until their own scopes are authorized:** shared-library access (M10.5), delivery render (M11), production activation (M12–M13).

**Facts established today that change operating assumptions:** Mikko's Resolve 21.1 on vidnux already connected to `EKA` and opened `PYSTY UHD` from it at 14:26 today; per the vendor note that project is now inaccessible to 20.3.2 clients. Client versions on PRESTO and vidlap2 should be inventoried before anyone else opens shared projects. Today's Resolve session also ended with an assertion abort in the log; session stability is an operational risk for any long transaction and argues for small, journaled operations.
