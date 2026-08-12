# Earth Studio v0.9.4 hover real-import acceptance

Dedicated production-planner fixture for real Google Earth Studio observation
of a carried-over camera hold.

- Input: `fly to Paris at 1500 meters tilted 45 degrees in 6 seconds, then hover for 6 seconds, then fly to London at 1800 meters tilted 35 degrees in 6 seconds`
- Hover interval: frames 180-360 at 30 FPS
- Project: 540 frames, 1080x1920 (9:16)
- Planner: v0.9.4 at git `a455e1a106e4a14f1ad873165dc5b4ae0c3ace86`
- `.esp` SHA-256: `360e9ab184672abcc5a773650807a7e5ac8248c838de12aedbea5454f98dffce`

`acceptance/internal-verification.json` is machine evidence. Real application
observation belongs in `acceptance/import-observation.json`; it must not be
inferred from the generated file.
