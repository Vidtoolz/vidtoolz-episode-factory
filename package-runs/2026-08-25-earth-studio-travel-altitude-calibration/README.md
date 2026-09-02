# Travel altitude calibration

**SUPERSEDED_FOR_HUMAN_ALTITUDE_REVIEW.** These fixed-tilt projects remain historical technical evidence. Mikko's final altitude choice must use `package-runs/2026-08-25-earth-studio-travel-altitude-height-aware/`, where viewing angle is derived continuously from altitude.

Production-neutral human calibration. Earth Studio's grouped position is a coupled 3D spline: changing altitude values changed geographic playback even with untouched lat/lng bytes. For a valid controlled comparison, every calibration choice—including CURRENT—uses the same ungrouped rendering of the production CURRENT lat/lng tracks. The production source artifact remains read-only. Real scene-model validation requires every candidate's sampled geographic path to equal the calibration CURRENT path.

Every choice preserves latitude, longitude, duration, tilt, pan, FOV, and endpoints. HIGHER candidates change only the altitude leaf and project label relative to calibration CURRENT. The envelope is local framing → smooth climb before lateral travel begins → stable cruise through the last positional keyframe → smooth descent after geographic arrival → local destination framing. Candidates target 0.8, 0.4, and 0.2 mean frame-widths of ground per second. No candidate is a production decision.
