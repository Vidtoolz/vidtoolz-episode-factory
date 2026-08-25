# Audio Capture Checklist

- Run: 2026-08-25-draft-narration-canary
- Production mode: DRAFT
- Capture class: PROXY (machine-generated) — no human performance and no real capture
- Materializer: draft-proxy-capture-materializer-v1
- Source evidence: DRAFT_SYNTHETIC_NARRATION + PROXY_PRESENTER
- Narration audio: media/draft-narration/narration.wav (f017bca4f4189886…, 74.39s)
- Proxy presenter: media/draft-proxy-presenter/proxy-presenter.mp4 (4c11c4035ab0ac17…, 74.47s)
- Story: 01M0W30GA5ZAXXQPX9SS0R2N29 @ 01M0W30GAA8DFZCTPRXN4Y4DXV

## Draft Proxy Audio

The DRAFT audio source is synthetic narration produced by piper
using the voice en_US-lessac-medium (synthetic proxy narrator (not the presenter)). It is a proxy voice track:
nobody spoke, no microphone was used, and this is not presenter audio, not a
final mix and not publish-ready sound.

| audio item | capture requirement | file/reference | status |
| --- | --- | --- | --- |
| DRAFT_SYNTHETIC narration track | machine-generated speech for the approved script — not recorded presenter audio | media/draft-narration/narration.wav | closed |
| DRAFT_SYNTHETIC per-beat segments (7) | one synthetic render per spoken beat, for edit placement | media/draft-narration | closed |
| Technical validation | 48000 Hz pcm_s24le, 74.39s, hash verified | f017bca4f4189886be3140b5… | closed |
| Human voice capture | not required in DRAFT; a real recording is a PRODUCTION requirement | production mode policy | closed |

No capture readiness approval marker appears in this file by design. A DRAFT is
zero-human, so its capture evidence is machine-verified rather than approved.

<!-- human-notes:start -->

<!-- human-notes:end -->
