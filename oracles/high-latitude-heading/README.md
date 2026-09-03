# Independent high-latitude heading oracle

This oracle freezes the physical horizontal heading contract for Earth Studio orbit geometry. It is intentionally red on production for high-latitude target bearing and acquisition-to-sweep scalar continuity. It does not implement or transport a repair.

## Run

```bash
node oracles/high-latitude-heading/oracle.test.js /home/vidtoolz/vidtoolz-episode-factory c115ce471084175285cbf3440506373264081c79 production
node oracles/high-latitude-heading/run.js /home/vidtoolz/vidtoolz-episode-factory <candidate-sha>
node oracles/high-latitude-heading/oracle.test.js /home/vidtoolz/vidtoolz-episode-factory <candidate-sha> repaired
```

The runner loads exact Git objects into a temporary module directory. It never edits the source under test.

## Authority

For a non-zero-radius targeted orbit, horizontal pan is the local spherical bearing from the actual camera position to the declared subject. The scalar representative is chosen continuously relative to the previous pan, except that intentional revolutions remain accumulated where the target-bearing field itself has that winding.

At zero radius camera and subject coincide, so bearing is undefined. The declared spin/pan sweep remains authoritative.

At or around a pole, local target bearing remains authoritative wherever camera and target are distinct. If the ring encloses the pole, target-facing pan may have a different winding number from the position orbit; position sweep, not an artificial off-target pan sweep, proves the revolution.

## Precision

The per-case heading allowance is derived from six-decimal geographic serialization rather than chosen as a style threshold:

`atan2(0.2 m, physical radius) + 0.000001°`

ENU and spherical-bearing references must agree within `1e-9°`.

See [INVENTORY.md](INVENTORY.md) for the forward and inverse production sites.
