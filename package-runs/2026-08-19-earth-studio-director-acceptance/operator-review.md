# Director review — watch four, answer one question

The question is not "does it import" (it does, verified) and not "are the moves correct"
(tests cover that). It is:

> Does this look like someone intentionally directed it?

## Watch these four, in this order

**They are already open in the visible Earth Studio browser, one tab each, labelled
1–4, each parked at frame 0 and stopped.** Click a tab and press play. Nothing to
import, nothing to find on disk.

**1. `DIRECTOR-B2-same-geography-route-story` — 29 s**
Helsinki → Stockholm as a ferry route. Flat, brief, no flourish. Nothing is orbited.
*Re-check from your last round:* the switch from the dolly-out into the sideways
crossing should now read as one continuous move, not two moves butted together.

**2. `DIRECTOR-B-city-to-city-hero` — 68 s**
The *same two cities*, directed with Stockholm as the subject. Departure is shaped, the
arrival settles, Stockholm is inspected.
*Re-check:* the camera should stay level all the way down into Stockholm and lean over
only in the last few seconds, as the circling shot begins — no tilt during the descent
itself.

→ **The key judgement:** do 1 and 2 feel like two different films of the same map?

**3. `DIRECTOR-HERO-landmark-reveal` — 70 s, 9:16**
Locate Paris, then **circle** the Eiffel Tower. A spiral was considered and ruled out:
the tower is the endpoint the camera travelled to, and a spiral is an open-ended move
that keeps closing in rather than settling on anything.
*Re-check:* the tower should stay the centre of a steady ring, at one height.

**4. `DIRECTOR-GLOBAL-network` — 175 s**
Shanghai → Amsterdam → Los Angeles, closing on the whole planet. Route points get nothing;
the globe appears only because the story is a global network. Does the planet feel motivated?
*Re-check:* the opening should ease into motion rather than snap into it, and each
change of move should ease across the join.

## What to record

One line per item in `acceptance/director-observation.json`, plus the overall verdict:

- **"This now feels intentionally directed."** or
- **"No, it still feels mechanically generated."** — and if so, which shot gave it away.

## Deliberate choices, so you judge them rather than flag them

- **Flights and holds are top-down.** That is what puts the requested place in the middle
  of frame. Oblique looks come from orbits and from the lean into an orbit.
- **Nothing is orbited on a route.** Restraint is the point, not an omission.
- **An arrival is circled, never spiralled.** A spiral now only survives where the shot
  has no specific endpoint; every canary that travels *to* a subject circles it instead.
- **The planet appears exactly once**, in the one story that is genuinely global.
- **A hero subject gets one circle, not two.** Importance buys a longer, slower circle;
  it no longer buys a second revolution.
- **The Matterhorn is raked at 72°, a city hero at 60°.** Terrain reads as terrain only
  from a lower, more grazing angle.

## Measured before handing it to you

Across all eight canaries, taken from the generated `.esp` files:

- **0** keyframes that change nothing (redundant interior keyframes).
- **0** direction reversals inside a movement — the only reversals are a circle's own
  curvature and the deliberate changes of direction between moves.
- **Every** onset of motion is eased; none start linearly.
- **Worst ground crossing is 0.80 frame-widths/second** (the Helsinki→Stockholm cruise
  in #2), under the 1.0 legibility limit and equal to the speed you already accepted.
- **Tilt into a circle never exceeds 12°/s**, and holds flat until then.
- **Orbit rings hold their radius to ±3.6%** at constant altitude — circles, not spirals
  (altitude drift 0.00% across every orbit).
