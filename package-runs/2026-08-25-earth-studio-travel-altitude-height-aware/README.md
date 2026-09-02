# Height-aware travel-altitude calibration

This package supersedes the fixed-45° package for human altitude review without invalidating its technical evidence. It keeps the same CURRENT/HIGHER_A/HIGHER_B/HIGHER_C altitude ladder, durations, FOV, pan, ground-target path, and geographic endpoints. Each candidate now derives Earth Studio numeric tilt directly from its own altitude envelope: local/oblique → climb and progressively top-down → stable high cruise → descend and progressively local/oblique. To preserve subject framing at oblique angles, the physical camera position is offset behind that unchanged ground-target path by altitude × tan(tilt), and the ESP target effect carries the same target samples.

No production altitude choice and no smooth latitude/longitude trajectory is promoted by this package.
