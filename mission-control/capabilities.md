# VIDTOOLZ Capabilities

A markdown overview of the VIDTOOLZ production system — what it can do, what runs, and what's available. Intended for human orientation and AI tool context. UI decision deferred until the right shape is clearer.

**Last updated:** 2026-06-03

---

## Production system

| Capability | Status | Location |
|---|---|---|
| Short-form video production (proven pattern) | Active — 1 published | Outside Episode Factory (changed-plan workflow) |
| Episode Factory package-run pipeline | Operational | `vidtoolz-episode-factory/` |
| Package Engine (run creation, thumbnail gen) | Operational | Port 8010, package-engine.html |
| Creator Cockpit (active run focus) | Operational | Port 8010, package-runs-dashboard.html |
| Mission Control (production overview) | Operational | Port 8010, mission-control.html |
| Production Day Dashboard | Operational | Port 8010, production-day-dashboard.html |

## Proven production pattern

- One claim, one concrete real-life example, one clear point
- 1–3 minutes, vertical 9:16
- "Explain to a friend" tone with humour
- Green-screen talking-head + GPT images → Kling video backgrounds
- Published reference: "Stop chasing AI tools. Do this instead."

## Episode Factory pipeline stages

1. Idea scoring and filtering
2. Package-run creation (Package Engine)
3. Script drafting and QA
4. Capture preparation (shot lists, checklists)
5. Media capture (camera, screen recording, audio)
6. Evidence review
7. Rough cut → watch notes → fix list → second cut
8. Publish pack (metadata, thumbnail, export)
9. Publish readiness gate
10. Archive as complete

## Supporting infrastructure

| Component | Status | Location |
|---|---|---|
| vidnux (production PC) | Operational | Local |
| VIDNAS Public (shared media storage) | Operational | SMB mount /mnt/vidnas_public/ |
| ROJEKTI (Resolve Project Server) | Operational | rojekti.local |
| PRESTO (Resolve client) | Operational | Remote |
| Hermes (organiser/agent layer) | Operational | Hermes profile |
| GitHub (version control, CI) | Operational | `vidtoolz-episode-factory` repo |

## Active runs

| Run | Status | Package-run? |
|---|---|---|
| "AI Replace Editors Is the Wrong Question" | Active, no package-run yet | No |
| "Stop chasing AI tools" | Published | No (changed-plan workflow) |

## Parked runs

| Run | Status |
|---|---|
| 2026-05-06-ai-video-proof-plan | Superseded by published short |
| 2026-05-02-ai-video-idea-filter | Parked behind active run |
| 2026-05-02-next-vidtoolz-video | Parked, no topic selected |