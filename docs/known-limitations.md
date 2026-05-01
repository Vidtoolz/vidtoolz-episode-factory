# Known Limitations

Episode Factory v1.2 is intentionally local-first and dependency-free.

## localStorage-Only Storage

Episode data is stored in the current browser profile under `vidtoolz-episode-factory-v1`. Clearing browser storage, changing profiles, or using another browser can make the data unavailable unless a JSON backup exists.

Export JSON backups regularly. The app shows backup health, recommends export when a recent JSON backup is missing, and warns before risky import modes when no recent export exists.

## No Backend

There is no server, account system, sync, collaboration, or cloud backup.

## No API Integrations

Hermes, Linear, GitHub, Codex, and YouTube outputs are copy-only text packages. The app does not call external APIs.

## Import Conflict Resolution Is Manual

JSON import now shows a preview and supports replace, merge-new-only, and merge-and-update modes. Same-id/different-title conflicts and different-id/same-title possible duplicates are shown in the preview and skipped by merge modes. The app does not yet provide per-episode conflict resolution.

## Active Session Not Included In JSON Export

The active focus session draft is stored separately under `vidtoolz-episode-factory-active-session-v1`. It is not included in JSON exports. Complete or abandon an active session before relying on a JSON backup as the full work record.

JSON export shows a warning in the export status when an active focus session exists, but the active draft remains excluded from the backup payload.

## Browser Clipboard Constraints

Copy buttons may fall back to a manual prompt when browser clipboard permissions are blocked. Clipboard behavior is usually more reliable when served from `localhost`.
