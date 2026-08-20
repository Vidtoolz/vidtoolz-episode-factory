# Earth Studio DIRECTOR acceptance (2026-08-19)

The journey builder knew HOW camera movements work. This gate is about whether the
system now knows WHY a filmmaker would choose one — and whether the result looks
intentionally directed rather than like a demonstration of available Earth Studio moves.

Eight canaries, each built by `earth-studio-director.js` from a story intent, each
recording the decision it made and why (`earth-studio/direction.json`).

| canary | the directorial question it answers |
| --- | --- |
| `DIRECTOR-A-landmark-subject` | Does a small 3D subject get an inspection move, and only that? |
| `DIRECTOR-B-city-to-city-hero` | Are departure, travel, arrival and inspection distinguishable? |
| `DIRECTOR-B2-same-geography-route-story` | Does the SAME geography with a different intent get different direction? |
| `DIRECTOR-D-scale-reveal` | Does a nested scale story widen progressively and stop short of the planet? |
| `DIRECTOR-ROUTE-restraint` | Does restraint stop a flourish appearing at every stop? |
| `DIRECTOR-HERO-landmark-reveal` | Is a spiral reserved for a genuine hero reveal? |
| `DIRECTOR-GLOBAL-network` | Is the planet used only when the story is genuinely global? |
| `DIRECTOR-TERRAIN-mountain` | Does a terrain story get an oblique treatment, not a flat map view? |

## The pair that matters most

`DIRECTOR-B` and `DIRECTOR-B2` are **the same two cities**. B directs Stockholm as the
primary subject: Helsinki is established plainly, the leg is shaped (pull back, cruise,
descend) because the arrival is part of the story, and Stockholm is orbited — **66 s**.
B2 directs the identical geography as a ferry route: both places are route points, the
leg is a single direct flight, nothing is orbited — **15 s**. Same map, different film.

## Defects real Earth Studio imports found (both fixed, both re-observed)

1. **Ceremony out of proportion to geography.** `DIRECTOR-HERO` chose a cinematic
   departure for the 4 km Paris → Eiffel Tower hop, climbing to 104 km to travel four
   kilometres. Fixed: a ceremonial travel style is penalised on legs under 50 km.
2. **A justified globe shot that was not actually planetary.** `DIRECTOR-GLOBAL` ended at
   156 km because a pull-back only shifts one scale step. Fixed: the widening step carries
   the globe framing explicitly — now verified at 36,132 km, whole Earth inside the frame.

See `contact-sheets/defects-found-by-real-import.png`. Round 1 evidence is under
`rounds/round1-prefix/`.

## Real-import status

Three representative canaries were imported into the **real authenticated Google Earth
Studio** via `scripts/earth-studio-journey-import-gate.js --gate <this dir>`; each opened
with the exact planned frame count and frame rate. Highlights viewed:

- the hero spiral **lands** with the Eiffel Tower centred and dominating a 9:16 frame
- the globe shot is a genuine whole-planet view centred on the final stop
- the route story stays flat and brief, with no flourish anywhere

## Layout

- `canaries/<id>/earth-studio/` — the job as the GUI writes it, plus `direction.json`
  (purpose, why, alternatives, rarity, emphasis and the plain-language explanation)
- `canary-manifest.json` — ids, aspects, durations, `.esp` sha256, globe decision
- `expected-decisions.json` — the **pinned** directorial decisions; a regression test
  fails if the Director starts choosing differently
- `contact-sheets/` — tracked visual evidence
- `observations/`, `rounds/` — raw per-frame captures, local-only, pinned in
  `SHA256SUMS-raw-captures.txt`
- `operator-review.md` — the short human review set

## Regenerating

```bash
node scripts/earth-studio-director-canaries.js
node scripts/earth-studio-journey-import-gate.js --gate package-runs/2026-08-19-earth-studio-director-acceptance --all
```
