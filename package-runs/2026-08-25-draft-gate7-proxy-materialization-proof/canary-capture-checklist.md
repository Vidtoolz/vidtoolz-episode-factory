# Capture Checklist

- Run: 2026-08-25-draft-narration-canary
- Production mode: DRAFT
- Capture class: PROXY (machine-generated) — no human performance and no real capture
- Materializer: draft-proxy-capture-materializer-v1
- Source evidence: DRAFT_SYNTHETIC_NARRATION + PROXY_PRESENTER
- Narration audio: media/draft-narration/narration.wav (f017bca4f4189886…, 74.39s)
- Proxy presenter: media/draft-proxy-presenter/proxy-presenter.mp4 (4c11c4035ab0ac17…, 74.47s)
- Story: 01M0W30GA5ZAXXQPX9SS0R2N29 @ 01M0W30GAA8DFZCTPRXN4Y4DXV

- Shoot-readiness status: READY TO SHOOT
- Capture checklist status: READY FOR ROUGH CUT
- Ready for rough cut: yes
- External APIs called: no

## Draft Proxy Capture

This run is a zero-human DRAFT. Capture readiness here means machine-generated
proxy media exists and verifies. It does NOT mean anyone recorded anything.

| item | source | priority | status |
| --- | --- | --- | --- |
| DRAFT_SYNTHETIC narration rendered for every spoken beat | DRAFT_SYNTHETIC_NARRATION | high | closed |
| PROXY_GENERATED proxy presenter rendered for every spoken beat | PROXY_PRESENTER | high | closed |
| Proxy beat coverage complete (7/7) | proxy presenter manifest | high | closed |
| Proxy presenter aligned to narration (delta 0.081479s within 0.2833s) | proxy presenter manifest | high | closed |
| Media bytes verified by hash and probe | technical validation in both evidence records | high | closed |
| Human presenter capture NOT required in DRAFT | production mode policy | high | closed |

Narration provider: piper 1.7.0 (voice en_US-lessac-medium, synthetic proxy narrator (not the presenter)).
Proxy presenter renderer: ffmpeg-stickman v1 (STICK_FIGURE_SILHOUETTE, motion DETERMINISTIC_IDLE_SINE, lip sync NONE).

<!-- human-notes:start -->

<!-- human-notes:end -->
