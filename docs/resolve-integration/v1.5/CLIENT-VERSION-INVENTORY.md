# Resolve client-version inventory (required before shared-library qualification, M10.5)

| Host | Role | Resolve version | Evidence | Status |
|---|---|---|---|---|
| vidnux (192.168.50.32 per today's collaboration log) | automation/qualification host | DaVinci Resolve **Studio 21.1.0 build 14**, Linux, permanent RLM licence | `~/.local/share/DaVinciResolve/configs/.version` (`Resolve.Version=21.1.0`); `logs/ResolveDebug.txt` 2026-09-08 "Running DaVinci Resolve Studio v21.1.0.0014"; `/opt/resolve/.license/` | VERIFIED 2026-09-08 |
| PRESTO (192.168.50.187, Windows 11, RTX 4090) | named "primary NLE" in `~/outputs/authentic-screen-capture-execution-v1-2026-09-04/DAVINCI-RESOLVE-CAPTURE-BOUNDARY.md` | **UNKNOWN** | no local evidence found (grep of Mission Control docs/data, wiki, memory, ROJEKTI handoff doc) | UNVERIFIED — requires SSH/SCP inventory (high-risk boundary, separate approval) or Mikko reading Help › About |
| VIDLAP2 (192.168.50.233, Windows laptop) | occasional edit client per `docs/ROJEKTI-RESOLVE-HANDOFF.md` | **UNKNOWN** | none | UNVERIFIED — same |
| ROJEKTI (192.168.50.199) | project server: PostgreSQL 13.23 (today's log), libraries `EKA` (version string 18.1.0.004 at connect 2026-09-08 14:20) and `nelja` | n/a (server) | `ResolveDebug.txt`; `~/resolve-backups/` (latest observed 2026-08-13) | server facts VERIFIED; backup freshness NOT current |

Compatibility implications (vendor `/opt/resolve/docs/ReadMe.html`): 21.1 keeps project libraries compatible with 20.3.2; projects created or opened in 21.1 become inaccessible to 20.3.2. **Today (2026-09-08 14:26) `PYSTY UHD` was opened from `EKA` in 21.1 on vidnux.** If PRESTO or VIDLAP2 run < 21.1, that project may no longer open there. Recommended before anyone else opens shared projects: record each client's exact version and, per vendor advice, take a full library backup plus per-project backups.
