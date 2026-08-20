# Operator checklist — journey builder visual acceptance

Everything machine-checkable is done: all 11 canaries import into the real Google Earth
Studio with the exact planned frame count and frame rate, and all 47 framing checkpoints
put their target in shot. The four defects the gate found are fixed and re-observed.

What is left is **your aesthetic verdict** — whether these animations look like the map
videos you intended. That is a judgement call, not a measurement.

## Fastest route (about 10 minutes)

Look at the tracked contact sheets first. They are downsampled captures of the real
application, so they answer most questions without opening a browser:

| sheet | question |
| --- | --- |
| `contact-sheets/canary-A-landmark-orbit.png` | Is a small landmark (Senate Square) well framed and calmly orbited? |
| `contact-sheets/canary-B-city-to-city-16x9.png` | Does Helsinki → Stockholm read as establish → depart → travel → arrive → establish? |
| `contact-sheets/canary-C-multi-stop-16x9.png` | Do all four stops hold up, including the later legs? |
| `contact-sheets/canary-D-scale-contrast-16x9.png` | Landmark vs country vs continent — is each target recognisable? |
| `contact-sheets/aspect-16x9-vs-9x16.png` | Is 9:16 acceptable for the same journey? |
| `contact-sheets/continuation-join.png` | Is E1's last frame the same picture as E2's first frame? |
| `contact-sheets/canary-G-hold-then-orbit-slide.png` | Is the hold→orbit swoop acceptable, or does it need blocking? |
| `contact-sheets/defect-*-before-after.png` | The two framing defects, before and after. |

## If you want to see them move

For any canary, drag its `.esp` onto https://earth.google.com/studio/ (drag-and-drop works;
`File > Import` also works) and press play:

```
package-runs/2026-08-19-earth-studio-journey-visual-acceptance/canaries/<id>/earth-studio/earth-studio.esp
```

Recommended order and what to judge:

1. **`A-landmark-16x9`** (31s) — small-target framing and orbit calmness.
2. **`B-city-to-city-16x9`** (85s) — pacing. Does the departure feel abrupt? Is the
   travel intelligible? Does the arrival settle, or does the orbit start with a jump?
3. **`D-scale-contrast-16x9`** (47s) — is a country and a continent actually readable?
4. **`B-city-to-city-9x16`** (85s) — the Shorts format of the same journey.
5. **`C-multi-stop-16x9`** (192s) — only if the others pass; watch the last leg for drift.
6. **`E1` then `E2`** — play E1 to its last frame, note the picture, then open E2 and look
   at frame 0. They should be the same shot.

## Record your verdict

Fill in `acceptance/visual-observation.json` (created next to this file). One of
`PASS` / `FAIL` / `PASS_WITH_NOTES` per item, plus a sentence where it matters.

Known things that are *deliberate*, not defects — please judge them, don't just flag them:

- **Fly / hover / zoom movements are top-down.** That is what puts the requested place in
  the middle of the frame. Oblique, cinematic looks come from **orbits** (and from the lean
  into an orbit at the end of an arrival), which are the moves that point the camera at the
  target. If you want obliqueness elsewhere, set a tilt in a card's **Advanced** panel — the
  GUI will warn you when a tilt would push the place out of shot.
- **Large targets orbit top-down.** A country cannot be orbited obliquely: the generator
  holds an orbit within 80 km of its target, which is nowhere near far enough.
- **In 9:16 a target wider than tall loses its left and right edges** (see Europe in
  `aspect-16x9-vs-9x16.png`). The framing law guarantees the vertical extent.
- **A hold immediately before an orbit around a different place swoops onto the circle**
  during the first revolution. The GUI now warns and suggests putting a travel movement in
  between.
