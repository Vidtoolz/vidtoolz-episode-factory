# Earth Studio boundary-continuity calibration

Authenticated Google Earth Studio was sampled on every frame from B−30 through B+30 around nine authored primitive boundaries. The production evaluator remains deterministic and offline.

## Result

- Cases: 9
- Classifications: MODEL_FALSE_POSITIVE=3, INSUFFICIENT_AUTHORITY=2, TRUE_SEAM=1, INTENTIONAL_TRANSITION=3
- Confirmed hard signature: moving→moving ground-vector snap above 30° with authored linear boundary evidence and non-zero speed on both sides.
- Scalar custom-handle discontinuities remain advisory when real playback spreads the transition progressively.
- Movement→hold direction is ignored after speed reaches zero.

The confirmed production seam is `DIRN17-ROTTERDAM-ORBIT-TRAVEL`: 73.12° real one-frame redirection, predicted offline at 72.55°. No production camera generation was changed here.
