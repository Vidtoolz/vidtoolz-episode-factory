# VIDTOOLZ Launch Map

## Main entry point

### VIDTOOLZ Production Center

Opens:

* Creator Cockpit
* Production Mission Control
* Production Day

Use when:

* Starting a real production session
* Checking current video state
* Planning next action

Technical note:
Uses `/home/vidtoolz/bin/open-vidtoolz-production-center`, which starts the Episode Factory server before opening pages.

## Core views

### VIDTOOLZ Creator Cockpit

Purpose:
"What do I need now?" Active production focus view.

Opens:
`package-runs-dashboard.html` on port 8010.

Safe opening:
Desktop shortcut or:
`/home/vidtoolz/bin/open-episode-factory-page package-runs-dashboard.html 8010`

Unsafe opening:
Direct `xdg-open` URL only works if server is already running.

### VIDTOOLZ Production Mission Control

Purpose:
Visual video state: active, published, parked, approved ideas.

Opens:
`mission-control.html` on port 8010.

Safe opening:
Use Production Center or:
`/home/vidtoolz/bin/open-episode-factory-page mission-control.html 8010`

Unsafe opening:
Direct `xdg-open` URL only works if server is already running.

### VIDTOOLZ Production Day

Purpose:
Timed production day tracker with trust checklist.

Opens:
`production-day-dashboard.html` on port 8010.

Use when:
Starting a real production block, capture/edit/review day, or structured work session.

Safe opening:
Desktop shortcut, Production Center, or:
`/home/vidtoolz/bin/open-episode-factory-page production-day-dashboard.html 8010`

### VIDTOOLZ Package Engine

Purpose:
Package creation, review, thumbnail generation.

Port:
8020.

Opening behavior:
The active desktop shortcut uses `/home/vidtoolz/bin/open-package-engine-openai`. That launcher starts the Package Engine server on port 8020 with the OpenAI thumbnail provider when needed, then opens `package-engine.html`.

## System views

### Hermes System Dashboard

Purpose:
Hermes operational health, gateway, git repos, local models.

Port:
8765.

Note:
This is system/infrastructure, not video production state. The active shortcut uses `/home/vidtoolz/bin/open-hermes-dashboard`, which attempts to start Hermes Mission Control if port 8765 is not already listening.

### Hermes Learning Loop

Purpose:
Learning loop review.

Opening behavior:
The active shortcut uses `/home/vidtoolz/bin/open-hermes-dashboard http://127.0.0.1:8765/learning-loop`.

## Capture tools

### START CAPTURE

Purpose:
Start supervised OBS capture.

### STOP CAPTURE

Purpose:
Stop capture and verify.

## Editing tools

### DaVinci Resolve

Custom launcher:
`/home/vidtoolz/bin/resolve-launch`

System launcher:
`/opt/resolve/bin/resolve %u`

Keep both unless Mikko later decides to simplify.

## Rule

Do not rely on direct `http://127.0.0.1:8010/...` URLs from a cold start.
Use launcher scripts or desktop shortcuts that start the server first.
