# Terrain complete-pose acceptance oracle

This frozen oracle separates complete 3-D terrain pose acceptance from the
planner that produces a pose. It is an acceptance and regression instrument;
it does not change production geometry, application state, package-run
evidence, approval state, or publishing readiness.

The RED baseline is production
`7b63c6b430f964087665a6c9a4626b79e42bcad9`. The prior measurement authority
`78ab128faa823da3fcdc612f115ff4f8618961f9` was read only. The GREEN control is
an independent mathematical reference implemented in `comparator.js`.

## Run

```sh
node oracles/terrain-complete-pose-acceptance/run.js --control=both
node oracles/terrain-complete-pose-acceptance/oracle.test.js
```

The default dual control exits successfully only when production is RED and
the compliant reference is GREEN. Individual controls can be selected:

```sh
node oracles/terrain-complete-pose-acceptance/run.js --control=production --expect=RED
node oracles/terrain-complete-pose-acceptance/run.js --control=reference --expect=GREEN
```

To judge a future checked-out candidate, run the production adapter with
`--expect=GREEN`. `--write-results` is freeze-time only and overwrites the
local frozen result; do not use it after the oracle has been frozen.

## Authority contract

For each declared terrain focal point, authority is ordered as follows:

1. The focal point owns latitude, longitude, `target_elevation_m`,
   `target_anchor_kind`, `target_anchor_source`, and
   `target_anchor_confidence`.
2. The calibrated footprint owns the ground radius `r`.
3. Terrain morphology owns the preferred rake `theta`.
4. Camera altitude is derived, never inherited from an incoming or gazetteer
   camera altitude: `A = z_t + r / tan(theta)`.

The preferred rakes are frozen at sharp peak 74°, volcanic cone 45°, canyon
74°, fjord channel 65°, and generic terrain 65°.

`min_altitude_m` is a safety constraint, not target authority. When the normal
derived altitude is legal, the preferred rake and radius are unchanged. When
it is below the floor, the camera altitude is clamped to the floor and the
highest legal rake is derived as
`atan2(r, min_altitude_m - target_elevation_m)`. Target elevation and radius
remain unchanged.

## Exact optical measurement

`comparator.js` imports no production module. It converts geodetic camera and
target coordinates to WGS84 ECEF, constructs the Earth Studio optical ray from
local ENU pan and tilt, and evaluates:

```text
angle(optical_ray_ecef, normalize(target_ecef - camera_ecef))
```

Tilt is measured from local nadir (`0°` is straight down); pan is clockwise
from local north. The error is reported both in degrees off optical center and
as a fraction of the 20° vertical field of view. The acceptance limits are
0.1° and 0.005 vertical-FOV units. Ground footprint is independently measured
as a wrap-safe great-circle radius on a 6,371,000 m sphere. This makes
longitude values separated by any whole number of 360° physically equivalent.

The altitude equation is the declared composition rule. The exact WGS84 ray
test remains independent of that equation and catches coordinate, heading,
tilt, curvature, elevation, and serialization mistakes. The corpus radii are
small enough that the authorized spherical-footprint/altitude construction is
within the frozen optical-center tolerance under exact WGS84 measurement.

## Corpus and focal-point semantics

| Case | Focal-point anchor | Elevation | Radius | Preferred rake |
| --- | --- | ---: | ---: | ---: |
| Matterhorn | summit | 4,478 m | 20,004.943 m | 74° |
| Mount Fuji | summit | 3,776 m | 16,927.259 m | 45° |
| Geirangerfjord | waterline | 0 m | 7,694.209 m | 65° |
| Grand Canyon | interior/POI surface | 1,200 m | 12,310.734 m | 74° |
| Generic terrain | surface POI | 850 m | 9,233.051 m | 65° |

The Grand Canyon anchor deliberately names an interior surface. A rim point is
not an equivalent substitute. Its 1,200 m elevation is a frozen acceptance
corpus value, not a general claim that the canyon has one elevation.

The separate safety canary uses a 4,000 m surface target, 5,000 m radius, 74°
preferred rake, and 7,000 m camera safety floor. Its preferred solution would
be below the floor, so the accepted result holds the target and radius, sets
camera altitude to 7,000 m, and reduces tilt to approximately 59.036243°.

## Staged boundary and retained authorities

At a staged travel/zoom-to-orbit handoff, the incoming terminal camera must be
the orbit's complete pose on the shared frame. The comparison includes
physical position, altitude, pan, and tilt; a plan that merely makes segment
frame numbers adjacent does not pass. An incoming/gazetteer altitude cannot
override the complete-pose solution.

The production control also protects the already-frozen strengths from
`cad68e9` and `7b63c6b`:

- signed orbit authority for ±180°, ±360°, and ±720°;
- zero-radius 360° spin without ground movement;
- finite physical revolution around a pole-enclosing ring;
- camera-to-subject heading at authored orbit states;
- antimeridian equivalence to a longitude-translated non-seam twin, with the
  same key topology and continuous longitude beyond ±180°;
- exact continuation camera inheritance with canonical public longitude;
- bounded orbit-radius breathing and aim residual through playback.

These checks must remain green even while the complete-pose baseline is RED.

## Frozen control result

Production has four real terrain cases and 68 complete-pose checks: 36 pass
and 32 fail. Each case fails explicit focal elevation/anchor metadata, derived
camera altitude, exact optical-center error, normalized FOV error, and staged
boundary position. The true WGS84 optical errors at the staged boundary are
approximately 10.141° (Matterhorn), 39.100° (Fuji), 7.007° (Geirangerfjord),
and 3.106° (Grand Canyon). All 12 retained motion checks pass.

The compliant reference has six cases (the five morphology cases plus the
safety-floor conflict) and passes all 102 checks.

`control-results.json` contains the full per-check measurements. `manifest.json`
binds the oracle inputs, code, tests, documentation, and frozen result by
SHA-256. The manifest's own SHA-256 is reported with the frozen commit.
