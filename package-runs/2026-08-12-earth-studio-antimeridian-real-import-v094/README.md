# Earth Studio v0.9.4 antimeridian real-import acceptance

Dedicated production-planner fixture for real Google Earth Studio observation
of an eastward short-arc crossing through +180/-180 longitude.

- Input: `fly to 20,170 at 500 km tilted 30 degrees in 4 seconds, then fly to 20,-170 at 500 km tilted 30 degrees in 18 seconds, then hover for 2 seconds`
- Crossing movement: frames 120-660; seam pair at frames 390/391
- Project: 720 frames, 1080x1920 (9:16)
- Planner: v0.9.4 at git `a455e1a106e4a14f1ad873165dc5b4ae0c3ace86`
- `.esp` SHA-256: `d93376594e5cfdf995513f090a442404714adf7d7f81c1ce6d799dcc826f63c9`

`acceptance/internal-verification.json` is machine evidence. Physical Camera
continuity across the imported seam must be observed in real Earth Studio.
