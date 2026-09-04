# DaVinci Resolve safety oracle

Human editorial activity has priority. `process exists` and `window exists` are inadequate. Resolve capture requires the exact idle process/window/session plus project id, timeline id, and playhead frame; no modal, playback, render, background task, obscuration, or human input inside the safety window.

Stage 7 V1 permits only `OBSERVE_WINDOW` and `CAPTURE_PIXELS`. It must not launch Resolve, open/switch projects or timelines, seek, edit, render, dismiss dialogs, or steal focus. Such a need requires an explicit separately qualified control contract and human authority. Critical tests cover every listed state and reject any editorial mutation operation.
