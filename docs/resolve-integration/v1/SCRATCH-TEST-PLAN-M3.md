# M3 scratch qualification plan (M0 preparation; PROVISIONAL until executed; NO execution authorized by this document)

Target: the provisioned `VIDTOOLZ Resolve Qualification v1` disk library (TARGET-CONTRACT.json), a disposable project `VIDTOOLZ_RESOLVE_QUAL_V1_M3_<date>`, synthetic media only (1-, 2-, 30-frame generated clips and 1080x1920 stills; never canary media until M8). Every probe records: API call, arguments, return value, immediate readback, and a snapshot digest. Each answer re-freezes the corresponding CAPABILITIES.json row (v2) and TIMEBASE.json api_mapping.

| # | Question (CAPABILITIES row) | Probe | Pass criterion / record |
|---|---|---|---|
| 1 | recordFrame origin | create timeline start TC 01:00:00:00; `GetStartFrame()`; append clip with recordFrame = GetStartFrame() and = 0; read `GetStart()` | record which origin `GetStart` and `recordFrame` use; assert `GetStartFrame()==108000` |
| 2 | endFrame convention | append 1-frame and 2-frame source clips with `startFrame/endFrame` variants; read `GetDuration()`, `GetSourceStartFrame/EndFrame` | inclusive vs exclusive; record mapping |
| 3 | still duration control | append a still with `startFrame=0,endFrame=N`; read duration | exact frame count on append? |
| 4 | occupied-interval collision | append onto an occupied range on the same track | overwrite / refuse / shift / new track? record exactly |
| 5 | GetUniqueId scope and survival | record ids; `DuplicateTimeline`; `Export(EXPORT_DRT)` + `ImportTimelineFromFile`; delete+append; `AddTake`/`SelectTakeByIndex`/`FinalizeTake` | which ids survive which operation |
| 6 | marker customData | `AddMarker` with 64/256/1024/4096-byte customData; two markers same customData; `GetMarkerByCustomData`; item vs timeline marker frame semantics | limits; duplicates; frameId semantics |
| 7 | SetSettings (plural) | `SetSettings({useCustomSettings:'1', timelineResolutionWidth:'1080', timelineResolutionHeight:'1920', timelineFrameRate:'30'})` then `GetSettings()`; include one invalid key | accepted keys; False semantics (README.md:243) |
| 8 | CreateEmptyTimeline duplicate name | create twice | nil on duplicate under 21.1? |
| 9 | SetTrackLock vs API | lock V1; attempt `AppendToTimeline` to V1; `GetIsTrackLocked` | does lock block API append? |
| 10 | GetProjectLastModifiedTime | read before/after append, marker, save | changes per mutation? granularity |
| 11 | -nogui non-render mutation | isolated `-nogui` session (Scorecraft P7/P8 harness shape); run probes 1-7 | if all pass, M4-M8 may run -nogui; render still needs GUI |
| 12 | DeleteClips(false) then Append | replace one item; readback | crash-window behaviour; ids |
| 13 | SetClipEnabled | disable/enable; readback | preview aid works; not CUT |
| 14 | GetClipProperty vs plural | `GetClipProperty()` and `GetProperties()` | which survive at runtime |
| 15 | SaveProject verification | mutate, `SaveProject`, reopen project, snapshot | saved-state verification method |

Forbidden during M3: canary media; network library; Mikko's Local Database; any non-prefixed project; `SetCurrentDatabase`; ripple delete; `ReplaceClip`.
