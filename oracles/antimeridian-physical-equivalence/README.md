# Antimeridian Physical-Equivalence Oracle V2

This frozen oracle replaces the historical wrapped-seam model. It treats longitude as a continuous physical coordinate that Earth Studio may import beyond ±180°. The historical high-latitude oracle at `c604b2cfa467630f6b0fb8747e2c34204e5d04c0` remains immutable.

## Doctrine

- A seam trajectory is compared with the same planner-authored trajectory translated away from the seam, then translated back by a constant longitude offset.
- The decoded 3-D camera position at every rendered frame must differ by no more than 0.2 m. Altitude participates in the distance.
- At every targeted authoritative camera state, heading error must not exceed `atan2(0.2 m, state radius) + 0.000001°`.
- Timestamp topology and easing on latitude, longitude, altitude, pan (`rotationX`), and tilt (`rotationY`) must equal the translated non-seam twin. Serializer-created longitude seam pairs and pan keys are failures.
- The corpus covers ±180°, clockwise and counterclockwise half/full/double commands (±180°, ±360°, ±720°), short and long radii, 85°/89° latitude, a pole-enclosing finite case, a zero-radius spin, fly-to acquisition, and seeded continuation acquisition.
- The unsuppressed diagnostic at production `c115ce4` is run over identical candidate output. Removing `HEADING_SPEED_PULSE` or `HEADING_REVERSAL` findings is diagnostic suppression and fails.
- The complete camera-quality source file must remain byte-identical to the diagnostic-truth authority. Threshold changes and seam exceptions therefore cannot make this oracle green.
- `HARD_START` is not waived at seam openings. It disappears only when the serializer-created seam topology disappears.
- Adding 360° to an incoming pan representative must not move the ring. This guards the architectural rule `PAN NO LONGER DEFINES RING POSITION`.
- Initial and final camera coordinates exposed through shot-plan/continuation APIs remain canonically wrapped even though `.esp` longitude may be continuous and unwrapped.

The positive control is not a repair candidate. It is a test adapter: it takes the independently planned non-seam twin and emits the longitude-translated values unchanged, including values outside ±180°. This establishes that the comparator accepts the authorized physical representation without changing planner-authored topology or easing. It contains no serializer implementation.

`fixtures/automated/` freezes every continuous control and translated twin. `fixtures/fixture-index.json` freezes their hashes. `real-import-evidence.json` separately records the completed authenticated Earth Studio observations and states which hostile cases remain repository-only fixtures. The two evidence classes are deliberately not conflated.

The red/green controls are:

- production `c115ce4`: red on heading and seam physical semantics;
- heading authority `cad68e9`: heading fixed, seam physical semantics red;
- first serializer attempt `bbf88d2`: seam physical semantics, added pan topology, opening, and diagnostic suppression red;
- frozen historical Model A fixture: real linked interpolation and opening red;
- independent continuous-unwrapped control: green.

The historical oracle at `c604b2c...` is **VALID FOR OLD CONTRACT** and MUST NOT be changed. Oracle v2 supersedes it only for antimeridian physical-equivalence semantics; it does not erase historical failures or evidence.

## Commands

Run all frozen red/green controls:

```sh
node oracles/antimeridian-physical-equivalence/oracle.test.js
```

Adjudicate a ref. A compliant ref exits 0; a noncompliant ref exits 1 and still prints the complete JSON report:

```sh
node oracles/antimeridian-physical-equivalence/run.js . <git-ref> > /tmp/antimeridian-v2.json
```

Run the independent compliant control directly:

```sh
node oracles/antimeridian-physical-equivalence/run.js . compliant-continuous-unwrapped
```

## Boundary

This is engineering test evidence only. It does not approve an Earth Studio render, shooting, editing, publishing, package-run promotion, or any other durable workflow state. Actual Earth Studio import observations supplied by adjudication establish that continuous unwrapped longitude is accepted; this repository oracle does not reproduce browser import verification.
