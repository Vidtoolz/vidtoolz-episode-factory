# Read-only capabilities (Phase 1 allowlist)

| op | Resolve calls | returns (`result`) |
|---|---|---|
| `health` | snapshot (tolerates Resolve absent) | `{}` or `{"note":"RESOLVE_UNAVAILABLE"}` with `resolve.available=false` |
| `identify` | snapshot | `{}` — identity lives in the envelope (`worker`, `resolve`, `project`, `timeline`) |
| `get_current_project` | `GetProjectManager().GetCurrentProject()`, `GetCurrentDatabase()` | `{}` + `project` block; `PROJECT_NOT_OPEN` if none |
| `get_current_timeline` | `GetCurrentTimeline()` | `{}` + `timeline` block; `TIMELINE_NOT_FOUND` if none |
| `list_timelines` | `GetTimelineByIndex(1..n)` → name/uuid/start/end/index | `{"timelines":[...]}` |
| `get_project_settings` | `Project.GetSetting()` | `{"settings":{...}}` |
| `get_timeline_settings` | `find by timeline_uuid`/`timeline_name`, `GetSetting()`, `GetTrackCount`, `GetMarkers` (count) | `{"timeline","settings","tracks","marker_count"}` |
| `get_media_pool_summary` | root folder clip count, first-level bins: name/clips/`GetIsFolderStale()` | `{"root_clips","bins":[...]}` |
| `get_project_fingerprint` | settings fps/w/h + identity | `{"core":{...},"fingerprint":"<sha256>"}` |

Every op also returns the fresh identity blocks. All calls are getters; none call `Set*`, `Save*`, `Import*`, `Append*`,
`Create*`, `Delete*`, `Quit`, render or export APIs. Explicitly **not** offered: project switching (`LoadProject`), opening
timelines (`SetCurrentTimeline` mutates the collaborative session), `pinghosts`, raw API passthrough.
