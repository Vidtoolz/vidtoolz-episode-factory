# Height-aware travel-altitude calibration — smooth tilt re-review

This package preserves the reviewed CURRENT/HIGHER_A/HIGHER_B/HIGHER_C altitude ladder, durations, FOV, pan, ground-target path, and geographic endpoints. It supersedes the first height-aware package only for the next human review: Mikko found A/B/C altitude usable but asked for smoother tilt movement. The first package and its review session remain unchanged historical evidence.

Each candidate now uses one quintic movement progress for both log-altitude and tilt. This removes the prior nested tilt ease that compressed most viewing-angle change into a short burst. To preserve subject framing at oblique angles, the physical camera position remains offset behind the unchanged ground-target path by altitude × tan(tilt), and the ESP target effect carries the same target samples.

No production altitude choice and no smooth latitude/longitude trajectory is promoted by this package.
