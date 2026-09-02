# Earth Studio 2026-08-25 review evidence preservation

This branch is a non-production evidence authority created from `f8eb499d4891ac087bf8986a92f1a7319cae6b2a`. It preserves files that existed only in the dirty live `main` checkout before the parser-bypass equivalence mission. It does not approve or promote the sampled trajectory implementation.

Preserved here:

- seven `package-runs/2026-08-25-earth-studio-*` review families;
- seven associated untracked tests;
- thirteen trajectory, altitude, and height-aware generation/review scripts.

The recorded human evidence is mixed. Calm-motion records say `SMOOTH_BETTER` for four cases, while other review families contain `BOTH_BAD`, partial review, or withheld dispositions. These records therefore remain evidence, not production authority.

Reproduction dependencies are intentionally split by lifecycle:

- dirty planner and height-framing implementation: `archive/earth-studio-dirty-trajectory-2026-09-02`;
- independent journey, camera-quality, and continuity candidates: `wip/earth-studio-independent-candidates-2026-09-02`.

The complete pre-split rollback snapshot is `/home/vidtoolz/episode-factory-preservation/2026-09-02-pre-parser-bypass/`. Its source and snapshot manifests share SHA-256 `af6f990e79c3b97e7cf6b4f6a35515c9b5f418ba4e721e3e9e16fa399e9d11f2`.

No canary was re-pinned and no test expectation was changed while creating this authority.
