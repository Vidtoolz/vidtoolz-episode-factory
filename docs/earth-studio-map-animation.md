# Earth Studio map-animation tool

An optional per-project tool to produce Google Earth Studio map fly-overs, operable from the
cockpit GUI and run entirely on **vidnux** (no PRESTO required).

## What it automates (and the one thing it can't)
Google Earth Studio is a **browser-only** Google product with **no API / no headless mode**, so the
frame export itself is always a manual in-browser step. Everything around it is automated here:

1. **Plan** — a plain-language sentence → camera shot plan + keyframes.
   `earth-studio-job-planner.js` (v0.9.4): actions `hover`, `fly_to`, `orbit`, `zoom_in`, `zoom_out`
   with per-segment modifiers — duration (`for 5 seconds`, `for 2 minutes`), altitude (`at 800m`, `from space`,
   `low`, `high`), tilt (`top-down`, `tilted 30 degrees`, `toward the horizon`), and orbit amount +
   direction (`twice`, `180 degrees`, `counterclockwise`). Segments chain with `then`; a segment
   without a location reuses the previous one, and a missing duration gets a **magnitude-scaled**
   default — flight distance (~150 km/s cruise, capped 4–25 s), orbit revolutions (10 s each),
   zoom altitude ratio (log-scaled 3–12 s) — recorded as a note, never silently. Explicit
   durations always win, but physically absurd speeds draw advisory pacing notes (real Earth
   Studio playback of acceptance round 2 was "too fast to be intelligible"). 180+-place worldwide gazetteer with aliases (`NYC`,
   `Everest`), diacritic/punctuation-tolerant lookup, per-place default altitudes for landmarks,
   and terrain floors (`min_altitude_m`) so zooms over high ground never target below the surface.
   Explicit `lat,lng` coordinates still reach anywhere offline (no geocoding API). Aspect ratios:
   `16:9` (default), `9:16` (Shorts — the GUI default), `1:1`.
2. **`.esp` generation** — an importable Earth Studio project with camera position + rotation
   keyframes from a camera state machine: real circular orbits (position samples around the
   target, heading facing center, cumulative pan across consecutive orbits), smoothstep-eased
   zooms, a cinematic altitude arc on flights longer than ~30 km, an establishing start state for
   the first segment (a zoom-in begins wide, a fly-to begins high), and per-action camera tilt.
   Planner-derived `zoom out to space` moves apply a high-altitude composition constraint based
   on Earth's apparent angular radius and Earth Studio's default 20° field of view. The upper
   globe limb stays inside a conservative vertical safe envelope as altitude increases; an
   explicit operator-authored tilt remains authoritative and is never silently constrained.
   Since v0.5 the serialization follows the **real reverse-engineered Earth Studio project format**
   (modelVersion 17, per `mkatzef/google-studio-utils`): keyframe times as duration fractions,
   normalized values (`minValueRange` offsets, altitude × 1.5356706349899208e-08, tilt ÷ 180), and
   rotationX = pan / rotationY = tilt — real Earth Studio **refused** the earlier v0.4 from-scratch
   guess (acceptance round 1, 2026-08-07, evidence archived in the acceptance package).
   **Caveat:** Earth Studio can't be import-tested headlessly, so confirm the generated
   `earth-studio.esp` with one manual import; `shot-plan.json` / `route.kml` are reliable manual
   fallbacks.
3. **Open Earth Studio**, import the `.esp`, render/export the image sequence into the run's
   `earth-studio/frames/` (the manual step).
4. **Frames → MP4** — `ffmpeg` on vidnux assembles the exported frames into an MP4.
5. **Stage** — copy the MP4 to the VIDNAS sandbox (`…/99_SANDBOX/earth-studio-pilot/`); never
   approved media.

## Map cinematography — the Director (why a movement is chosen)

`earth-studio-director.js` (`director_version 1`) sits ABOVE the journey builder. The
journey model knows how camera movements work; the Director knows what they mean:

```text
story / geographic intent
  -> shot purpose            (what this shot is FOR)
  -> directorial decision    (scored, explainable)
  -> movement / template / framing / angle / duration
  -> journey model           [existing]
  -> planner + serializer    [existing, proven, byte-frozen]
```

It never serializes anything. It produces journey-model decisions and an explanation.
Fully deterministic: the same structured intent always gives the same direction, with no
randomness, no clock and no LLM in the decision path.

**Vocabularies.** 15 shot purposes (ORIENT, LOCATE, ESTABLISH, TRAVEL, ARRIVE, INSPECT,
REVEAL, COMPARE, RELATE, SHOW_ROUTE, SHOW_SCALE, SHOW_TERRAIN, EMPHASIZE, TRANSITION,
CONCLUDE), each declaring what the viewer should understand and which angle it wants;
9 location roles (STARTING_CONTEXT, PRIMARY_SUBJECT, DESTINATION, WAYPOINT,
COMPARISON_LOCATION, ROUTE_POINT, GEOGRAPHIC_CONTEXT, SCALE_REFERENCE, FINAL_REVEAL);
4 importance levels (LOW / NORMAL / HIGH / HERO); editorial rarity (COMMON / SELECTIVE /
SPECIAL) as a prior, not a hard limit.

**Camera grammar.** Every move the generator genuinely produces carries its directorial
semantics — what it communicates, what it is good for, when to avoid it, its useful scale
range, its angle, its rarity and its teaching text. That covers the five proven primitives
as exposed by the journey catalogue, the four travel shapes, the five import-verified
native Quick Start templates, and the whole-globe view.

**Scoring.** A choice is never one `if`. Candidates are scored on purpose fit, scale fit,
subject fit, earned importance, angle fit (including whether the generator can actually
deliver that angle), continuity, dwell economy, minus repetition, spectacle, restraint and
geographic-confusion penalties. Every component records why it contributed, so a
recommendation is inspectable and a rejection always has a reason.

**The globe rule.** `long distance` and `global scale is narratively important` are treated
as different things. A whole-planet shot needs one of seven declared narrative reasons
(GLOBAL_CONTEXT, INTERCONTINENTAL_SCALE, WORLDWIDE_PHENOMENON, PLANETARY_COMPARISON,
GLOBAL_NETWORK, GLOBAL_ORIGIN, GLOBAL_CONCLUSION). Distance alone never qualifies — a
7,800 km Helsinki-Tokyo flight still gets no globe. The distance test only works the other
way: a declared reason that needs intercontinental span is refused on a journey too small
for the planet to read.

**Restraint.** A sequence earns a small flourish budget from how many places genuinely
matter (`1 + highs + heroes*2`, capped) and spends it; selective moves cost 1, special
moves 2. Once spent, they are actively discouraged. Repetition is penalised adjacently and
cumulatively, so a special move that appears constantly stops being recommended.

**Duration.** The journey model's magnitude-scaled, playback-validated duration stays the
physical baseline. The Director only supplies a narrative `emphasis` multiplier over it
(clamped 0.75-1.4, averaged rather than multiplied so three factors cannot triple a shot).

**Auto-Direct.** Free text is reduced to structured intent by deterministic keyword
extraction over the planner's own gazetteer — it can only name places the generator knows,
and it never invents a global reason from distance language. Once structured, direction is
reproducible.

## Camera journey builder (the default way to build a move)

`earth-studio-journey.js` (`journey_version 1`) is a GUI-facing layer **over** the planner above.
It owns no Earth Studio semantics: a journey compiles to the planner's own description grammar,
and the keyframe engine / easing profile / `.esp` serializer then run completely unchanged. Every
compile is verified by re-parsing it and checking each segment against the intent
(`verifyCompilation`), so a grammar drift fails loudly instead of producing a different animation.

```text
journey  ->  canonical description string  ->  parseDescription / buildShotPlan  ->  buildEsp
                (planner grammar)                    (byte-frozen)                (import-verified)
```

**Shape.** An ordered route, not a fixed start+destination pair:

```text
journey
  start              { location | previous ending camera, framing, camera overrides }
  start_movements[]  movements performed AT the start
  legs[]
    destination      { location, framing, camera overrides }
    travel[]         movements that get the camera from the previous stop to this one
    movements[]      movements performed AT this destination
```

**Movements** all map to one of the five proven primitives. At a location: Hold, Slow Orbit, Orbit,
Double Orbit, Half Orbit, Push In, Pull Back, Reveal, Spiral In, Spiral Out. In travel: Fly To,
Cruise, Fly High, Low Approach, Pull Back, Climb Out, Descend, Pause. Travel styles (Direct,
Cinematic, High Transit, Low Approach, Custom) are presets that populate the travel step list, so a
preset and a hand-built travel produce the same kind of data. A Hold deliberately emits neither
altitude nor tilt, because an explicit value would turn the planner's camera **hold** into a move.

**Auto-framing.** Camera distance follows how big the target is, via a plain optical identity —
`altitude = span × cos(tilt) / (2·tan(FOV/2))`, with Earth Studio's documented default 20° FOV (our
`.esp` never keyframes `fov`, so that default really holds). The scale ladder runs landmark (500 m
span) → neighborhood → district → city (12 km) → metro → region → country (1300 km) →
sub-continental → continent (5000 km) → globe (Earth's diameter). The law is cross-checked against
the hand-validated gazetteer: at the landmark span it returns the same ~1000 m the verified Eiffel
Tower entry uses. Scale comes from the gazetteer's own `scale` field, an explicit override table, the
inverse of the law applied to a place's hand-calibrated altitude, or keyword cues for unknown
names; an explicit `lat,lng` carries no size information and says so. **AUTO keeps a place's
hand-calibrated gazetteer altitude** (verified framing wins, and leaving it implicit preserves the
exact proven planner path); a manual scale or a manual altitude overrides it.

**Which movements can frame their target — the real-import rule.** The generator positions a
fly / hover / zoom camera at the target's OWN coordinates and then tilts it, so the target sits at
nadir while the view axis points `tilt` degrees away: the target is `sin(tilt)/tan(FOV/2)`
half-frames off centre, which is 4.9 at the planner's default 60° orbit tilt. Real Google Earth
Studio imports (2026-08-19 gate) showed exactly that — a Stockholm descent rendered as open sea, a
country hold as horizon-only, a continent hold as a **fully black frame**. An ORBIT is different: the
engine puts the camera on a ring of `altitude·tan(tilt)` and points it back at the centre, so the
target is dead-centre at any tilt.

The journey layer therefore derives tilt per movement:

- **orbits** keep the oblique default (visually accepted at tilt 60 for a landmark), *unless* the
  ring they need exceeds the generator's 80 km ring cap — past that the camera cannot be placed
  facing the target at all, so the orbit goes top-down (the planner's documented top-down orbit
  look, a spin in place). That threshold falls between city and metro framing.
- a **fly / zoom that lands on a following orbit's ring entry** adopts that orbit's tilt, keeping
  the v0.8 zero-slide boundary continuous.
- every other **target-centred movement is top-down**, because only a top-down camera actually
  centres the place the framing law computed a span for.
- an orbit never *inherits* a flattened tilt through carry-over, so picking "Orbit" cannot silently
  become a zero-radius spin.
- an **explicit operator tilt stays authoritative** and is never silently clamped — the GUI warns
  instead, naming the place that will not be visible.

Consequence worth knowing: oblique, cinematic looks come from orbits and from the lean into an
orbit; flights and holds are map-like top-down shots. In 9:16 the guaranteed extent is vertical, so
a target much wider than tall loses its left and right edges (documented with evidence in the gate).

**One coherent trajectory.** A map animation follows a single deliberate path; wobble is
prohibited by default. Journey-built jobs therefore carry a `plan.motion_policy` that the keyframe
engine honours (freeform jobs do not, which is what keeps the byte-frozen path byte-frozen):

- the long-flight **arc bump** is suppressed — a flight no longer rises and falls inside one leg,
  which is where the visible wobble came from;
- interior keyframes that are equal to both neighbours are **dropped** — a keyframe that changes
  nothing is removed rather than shipped;
- **every onset of motion is eased.** A channel that starts moving gets a real departure ease and one
  that stops gets a gentle arrival; boundaries where motion continues ease across the join instead of
  cornering. Nothing starts or changes direction linearly.

**Motivated tilt.** Tilt is not decoration: it changes only because the shot that follows needs it.
A descent into a destination stays level and the camera leans over only as the circling shot begins,
at no more than `ORBIT_ENTRY_TILT_MAX_RATE_DEG_PER_S` (12°/s), so the lean reads as entering the
orbit rather than as an unexplained drift during the descent.

**Legibility over the ground.** Crossing long distances close to the ground is unreadable — the
image changes faster than a viewer can place it. Transit altitude is therefore chosen from a screen-
speed budget: ground speed measured in **frame-widths per second**, capped at
`READABLE_SCREEN_SPEED_FW_PER_S` (1.0), with route framing as a ceiling rather than a target. The
limit is bracketed by real playback verdicts — 0.80 fw/s accepted, 3.29 fw/s reported unreadable. A
climb demanded purely by legibility is marked `functional`, so it does not spend the flourish budget
that governs ceremony.

**Circle an endpoint; spiral only what has none.** A spiral keeps closing in rather than settling on
anything, so it is refused at an arrival: a subject the camera travelled *to* is circled instead.
Importance buys a longer, slower circle, not a second revolution — the dwell reward saturates, so a
hero landmark gets one generous orbit rather than two. Terrain reads as terrain only from a grazing
angle, so a `SHOW_TERRAIN` orbit rakes at `TERRAIN_OBLIQUE_TILT_DEG` (72°) where a city hero sits at
the accepted 60°.

**Calm pacing.** Suggested durations are the planner's magnitude-scaled `defaultDuration()` — the
law real Earth Studio playback validated across acceptance rounds 2–4 — multiplied by a pace
preset: **Calm ×1.35 (the default)**, Relaxed ×1.15, Standard ×1.0 (the validated baseline), Quick
×0.8. Each card shows the suggested range, and an explicit duration always wins. A flight that
opens a journey is an establishing dive, so its suggestion is distance-independent, matching the
generator's own rule.

**Continuation.** Every generated job writes `continuation-state.json`: the camera state the
animation ENDS on, derived by running the same keyframe engine that writes the `.esp`
(`planner.finalCameraState`). It contains only the five values Earth Studio actually keyframes —
longitude, latitude, altitude, `rotationX` (pan) and `rotationY` (tilt). `rotationZ` (roll) and
`fov` are never keyframed by this generator, so they are not part of a camera state and are not
invented. A `camera` block is kept deliberately distinct from `target` (the semantic place the
animation was looking at): after an orbit those are different points. Feeding a state back in
(`journey.start.source = "continuation"`, or `POST /api/earth-studio/plan` with a journey carrying
one) seeds `plan.initial_camera`, and animation B's frame-0 keyframes equal animation A's closing
values exactly. `pan_deg` is the engine's accumulated heading (values past 360° are legitimate — an
`.esp` pan track normalizes against its own min/max), with `heading_deg` as the wrapped angle for
humans.

**Validation** speaks operator language, not schema language — "Destination 2 has a travel movement
but no destination location", "This movement is set to 0 seconds, so it would never play",
"Place names must be a single plain name — write \"Helsinki\", not \"Helsinki, Finland\"" (a comma
would be read as a second movement). An invalid journey is refused with HTTP 400 and nothing is
written.

## GUI
`project-earth-studio.html?id=<project>` (launched from the Production Pipeline lane, workspace,
or media kit) is the guided workspace. **Operator instructions:**
`docs/earth-studio-user-guide.md` (short step-by-step for daily use). Step 1 has two modes:

**Journey builder (default).** The animation is a visible sequence of blocks — start location →
movement at start → travel → destination → movement at destination → more destinations — each an
editable card with the common choices shown as selectable cards rather than dropdowns, and altitude
/ tilt / orbit direction / revolutions behind a per-card **Advanced** disclosure. Alongside it:
an always-live **estimated video length** with a per-movement breakdown, a compact route timeline,
a plain-language journey summary ("Start over Helsinki with a city framing at 25.5 km. Slowly orbit
Helsinki for 31 seconds. …"), and the compiled planner instruction behind a disclosure. Destinations
reorder with ↑/↓. Validation problems are listed in operator language and disable **Generate**
until they are fixed.

**Freeform description.** The original description textarea, unchanged: one-click preset moves,
a searchable known-place list, a live parse preview with altitude/tilt per segment, an offline SVG
camera ground-track map, and the native Quick Start template selector. Projects created before the
journey builder open in this mode so their own description stays authoritative.

Then **Generate plan + .esp**, **Open Earth Studio**, **Render frames → MP4**,
**Stage MP4 → VIDNAS**, and finally **Continue into the next animation** — which shows the ending
camera state, exports it as a file, or loads it straight back into the journey builder as the
starting camera. Status shows plan/.esp presence, exported frame count, and the rendered MP4.
Aspect selector: 9:16 Shorts default.

Headless-Chrome coverage for the journey builder: `node scripts/earth-studio-journey-browser-smoke.js`
(31 checks — block sequence, auto-framing, live estimate, add/reorder destinations, pacing,
validation gating, a real generate through the API, and the continuation hand-off).

Real-application coverage: `node scripts/earth-studio-journey-canaries.js` writes the canary set and
`node scripts/earth-studio-journey-import-gate.js --all` imports each one into the **real
authenticated Google Earth Studio**, verifies the project against the plan, scrubs every movement
boundary and captures the rendered frame. The 2026-08-19 gate that established this lives in
`package-runs/2026-08-19-earth-studio-journey-visual-acceptance/` (11 canaries, 101 frames, four
framing/model defects found and fixed); the operator's aesthetic verdict is the one remaining step
(`operator-checklist.md`).

## Per-run layout
`<aigen package>/earth-studio/`: `shot-plan.json`, `earth-studio.esp`, `route.kml`,
`shot-plan.md`, `earth-studio-build-checklist.md`, `job.json`, `continuation-state.json`
(the ending camera state — written for every job), `frames/` (your export), `renders/<job>.mp4`.
Journey-built jobs additionally get `journey.json` (the editable journey, reloaded by the GUI) and
`journey-summary.md`. A freeform job's `job.json` gains no `journey` key, so its field set is
unchanged apart from the `continuation_state` pointer.

## Endpoints (all nonce-gated except the GETs)
`GET /api/earth-studio/status?project id=` · `GET /api/earth-studio/job-status` ·
`POST /api/earth-studio/plan` · `POST /api/earth-studio/render` ·
`POST /api/earth-studio/cancel` · `POST /api/earth-studio/stage`

## Boundaries
Runs locally on vidnux; uses system `ffmpeg`. Does not log into Google, automate the Earth Studio
browser, advance package-run state, or write approved media. PRESTO is not contacted.

## Verification states — internal green is NOT external proof
Everything above proves the tool against **our own model** of Earth Studio, and the core camera
semantics have since been **externally validated in real Google Earth Studio** (acceptance rounds
1–4, 2026-08-07): the `.esp` format imports (round 2), duration/9:16 dimensions are honored, the
frames→MP4 render seam works on a real export (round 3), and rotationX = pan / rotationY =
tilt-from-nadir, target-facing orbits, accumulated revolutions, and **counterclockwise = pan
decreasing (on-screen direction confirmed by the operator, round 4)** all behaved as generated.
Later PRESTO real-import rounds confirmed the v0.9 motion-profile v4 easing/settle-hold,
the v0.8 fly→orbit ring-entry geometry, the corrected v0.9.4 space-zoom composition,
the carried-over hover hold, and the adjacent-keyframe antimeridian seam. The dedicated
hover and antimeridian fixtures are preserved under `package-runs/2026-08-12-earth-studio-*`.
`scripts/earth-studio-v04-acceptance.js` formalizes the canonical acceptance state machine:

- **INTERNAL_VERIFIED** — parser/generator/renderer tests pass and the pre-import semantic
  assertions pass (29 checks: 9:16 dimensions, real Helsinki→Paris distance, cinematic arc,
  spatial orbit at the intended radius with target-facing heading, −720° accumulated pan,
  eased anchored zoom, continuity). Earth Studio has seen nothing.
- **EARTH_STUDIO_IMPORT_VERIFIED** — the real browser import happened and the structured human
  observation record (`acceptance/import-observation.json`) accepts flight, orbit (direction,
  target-facing, 2 revolutions), zoom, tilt, and 9:16. Real frames/render may still be pending.
- **END_TO_END_VERIFIED** — plus a validated real Earth Studio frame export rendered to MP4
  through the production lane path, ffprobe-checked, with every artifact SHA-256-pinned in
  `acceptance/hashes.sha256`.

Failure states: `INTERNAL_CHECKS_FAILED`, `IMPORT_DISCREPANCY_REPORTED` (observed Earth Studio
behavior wins — diagnose narrowly, add a regression test, fix, regenerate a NEW proof round;
never edit evidence in place).

### Current Earth Studio evidence matrix (2026-08-12)

| Behavior | Internal verification | Real Earth Studio |
| --- | --- | --- |
| Fly arrival | PASS | PASS |
| Fly → orbit | PASS | PASS |
| Orbit continuity | PASS | PASS |
| Motion-profile v4 | PASS | PASS |
| Space zoom composition v0.9.4 | PASS | PASS |
| Hover hold | PASS | PASS |
| Antimeridian crossing | PASS | PASS |

The v0.9.3 space-zoom failure remains preserved as a rejected real-import
observation. Planner v0.9.4 and its separately hashed corrected import remain the
accepted replacement; later hover/antimeridian evidence does not rewrite that history.

## v0.4 acceptance procedure
Canonical fixture: `package-runs/2026-08-07-earth-studio-v04-acceptance/` — instruction
`fly to Helsinki in 3 seconds, then fly to Paris at 2 km tilted 35 degrees, then orbit twice
counterclockwise for 8 seconds, then zoom out to space in 6 seconds`, 9:16, 660 frames @ 30 fps.

```bash
node scripts/earth-studio-v04-acceptance.js generate   # (already committed)
node scripts/earth-studio-v04-acceptance.js check      # 29 pre-import assertions
# … the ONE manual step: acceptance/import-checklist.md (real Earth Studio) …
node scripts/earth-studio-v04-acceptance.js ingest-observation
node scripts/earth-studio-v04-acceptance.js validate-frames
node scripts/earth-studio-v04-acceptance.js render     # production lane path + ffprobe
node scripts/earth-studio-v04-acceptance.js hash
node scripts/earth-studio-v04-acceptance.js status     # writes acceptance-report.md
```

Frame exports (`earth-studio/frames/`) and the rendered MP4 stay untracked (`.gitignore`);
`acceptance/hashes.sha256` pins their integrity.

## Historical London fixture
`package-runs/2026-06-27-london-proof/` predates the v0.4 camera engine, records the **earlier**
generator's output, and must stay byte-identical (sha256
`33eab695b82e60fefd6d52aa8c06ddcd630aa92c3d10a9aba9a0433eed9d58d6`, regression-tested). It is NOT
evidence that the rewritten v0.4 engine has been accepted by Earth Studio; the acceptance tool
hard-refuses to operate on it.

> Revived 2026-07-02 from branch `earth-studio-map-lane` and retargeted to the projects lane: artifacts now live in the aigen script-package (`<package>/earth-studio/`), the GUI project picker defaults to the active project, and shot-plan validation is generic (no fixture-specific coordinate checks).

> v0.4 (2026-08-07): vibe grammar (location carry-over, per-action default durations, altitude/tilt/orbit modifiers), ~150-place gazetteer with aliases and terrain floors, cinematic keyframe engine (real orbits, eased zooms, flight arcs, cumulative pan — fixes the orbit-after-orbit and first-segment-zoom static bugs), aspect ratios incl. 9:16 Shorts, GUI presets + place search + ground-track map, CLI `--aspect`. Old shot plans without an `aspect` field still validate; the module default stays 16:9 so pre-v0.4 artifacts (incl. the pinned London proof) are unaffected.
