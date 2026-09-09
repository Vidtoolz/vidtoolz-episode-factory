# PRIMITIVE-SPEC.md — the versioned expectation authority for the 47 read primitives (v1.6, FROZEN_NOW as a hypothesis set)

Machine form: `READ-PRIMITIVES.json.logical_operations.READ_PRIMITIVE_QUALIFICATION_PROBE.primitives[*]`, digested as `READ-PRIMITIVES.json#primitive_spec_sha256 = digest(sorted specs, vidtoolz.resolvePrimitiveSpec.v1)`.

## Per-primitive fields

| Field | Meaning |
|---|---|
| `method` | exact getter name; an argument-bearing variant (`GetStart(True)`) is a separate primitive |
| `receiver` | object class the call is made on (`Resolve`, `ProjectManager`, `Project`, `MediaPool`, `Folder`, `Timeline`, `TimelineItem`, `MediaPoolItem`) |
| `arg_types` | ordered broad codec types of the documented argument tuple (`str`, `int`, `bool`, `float`) |
| `nullable` | whether `None` is a documented legitimate return |
| `expected_type` | documented broad codec type of the return (`str`, `int`, `bool`, `float`, `list`, `dict`, `object`) |
| `shape_rule` | `NONE` (any value of the type, including empty) or `NON_EMPTY` |
| `completeness` | `COMPLETE` (a truncated/elided value cannot be `SUCCESS`) or `PARTIAL_OK` |
| `expectation_status` | `DOCUMENTED_HYPOTHESIS` → `PROBE_VALIDATED` → `FROZEN` |
| `expectation_source` | where the documented expectation comes from |

## Law

**Every expectation in v1.6 is `DOCUMENTED_HYPOTHESIS`.** It comes from the DaVinci Resolve 21.1 scripting README and the `DaVinciResolveScript` stub, not from an observation on this host. The reference parser classifies a capture *against the hypothesis*; a `SUCCESS` classification against a hypothesis is **not** a qualification, and `READ-PRIMITIVES.json#primitive_spec_law.frozen_allowed` is `false`, so no primitive may claim `FROZEN` in this bundle (the validator refuses it).

`PROBE_VALIDATED` may be set only in a reviewed refreeze (M0C) that promotes captures which re-parse to `SUCCESS` under that exact spec, and `FROZEN` only when a later authority version accepts the expectation as settled. Correcting an expectation is a spec change: it changes `primitive_spec_sha256`, therefore every derived digest, therefore every review and refreeze bound to it. That is deliberate — an expectation cannot be edited under a promotion made against the old one (this is the mechanism that replaces v1.5's heuristic `expected_type`, Claude m-TYPE).

Empty containers are handled by `shape_rule`, not by prose: `GetMarkers`, `GetItemListInTrack` and `GetProjectListInCurrentFolder` are `NONE`, so an empty timeline is a legitimate `SUCCESS` observation with `facts.length: 0` — the emptiness is a fact, never "a failure" and never "a success with an empty list" written by the probe.
