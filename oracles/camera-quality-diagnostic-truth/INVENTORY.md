# Production geographic diagnostic inventory

Production authority inspected: `00bba82faa1a31f3db3d16c68c991765ae1b6d3a`.

| Diagnostic | Production function | Production formula / representation | Wrapped-safe | Spherical | Feeds |
| --- | --- | --- | --- | --- | --- |
| track finiteness / duplicates | `cameraTracks`, `trackReport` | encoded scalar values and raw deltas | no geography | no | FAIL / report |
| travel coherence | `coherenceReport` | sign reversals of raw normalized lat/lng key values | no | no | FAIL |
| orbit radius / breathing | `orbitPhases`, `orbitReport`, `radiusAndTargetDefects` | `dx=Δlng·111320·cos(centerLat)`, `dy=Δlat·111320` | no | no | WARN at 2%; FAIL at 4% |
| target drift / acquisition aim | same | planar `atan2(dx,dy)` versus pan | no | no | WARN at 2°; FAIL at 5° |
| dead orbit displacement | `deadOrbitReport` | maximum planar offset from segment start plus altitude | no | no | FAIL below 5 m |
| dead fly displacement | `deadMovementReport` | planar endpoint displacement | no | no | FAIL below 25 m |
| zoom intent | `deadMovementReport` | relative altitude change | not applicable | no | FAIL/WARN |
| orbit exit alignment | `orbitReport` | destination selection uses planar displacement; bearing uses spherical trigonometry | selection no; bearing periodic | partial | WARN above 60° |
| heading reversal / pulses | `headingDefects` | shared angular unwrapping, time derivatives | yes | angular | FAIL |
| travel trajectory reversal | `trajectoryDefects` | longitude unwrapped, then per-axis scalar reversals | yes for seam | no path metric | FAIL |
| boundary direction / velocity | `boundaryContinuityDefects` | shared playback trace: longitude unwrap, haversine, initial bearing | yes | yes | FAIL/WARN |
| endpoint easing | `endpointEasingDefects` | transition handles | not applicable | no | FAIL |
| altitude / tilt pumps | `scalarPumpDefects` | scalar reversals | not applicable | no | FAIL |
| roll | `rollReport` | decoded rotation Z | not applicable | no | FAIL |

The deterministic false-positive surface is therefore concentrated in
`orbitPhases` and the planar displacement checks. Some planar dead-movement
checks are more likely to mask a real dead shot at the seam than fabricate one.
The oracle keeps both directions visible: false positives must disappear and
true failure controls must remain.
