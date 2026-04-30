# Known Limitations

Episode Factory v1.0 is intentionally local-first and dependency-free.

## localStorage-Only Storage

Episode data is stored in the current browser profile under `vidtoolz-episode-factory-v1`. Clearing browser storage, changing profiles, or using another browser can make the data unavailable unless a JSON backup exists.

Export JSON backups regularly.

## No Backend

There is no server, account system, sync, collaboration, or cloud backup.

## No API Integrations

Hermes, Linear, GitHub, Codex, and YouTube outputs are copy-only text packages. The app does not call external APIs.

## Import Replaces The Full Library

JSON import validates the selected file, then replaces the current local episode library. There is no merge or preview flow in v1.0.

## Active Session Not Included In JSON Export

The active focus session draft is stored separately under `vidtoolz-episode-factory-active-session-v1`. It is not included in JSON exports. Complete or abandon an active session before relying on a JSON backup as the full work record.

## Browser Clipboard Constraints

Copy buttons may fall back to a manual prompt when browser clipboard permissions are blocked. Clipboard behavior is usually more reliable when served from `localhost`.
