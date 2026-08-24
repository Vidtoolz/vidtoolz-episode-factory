# Execution ownership and package mutation scope

Execution ownership is intentionally scoped to one exact package run, agent, and immutable task work unit. The protected artifact is the byte-bound artifact extracted by the canonical agent runner. A takeover creates a separate bounded manual working copy under that exact identity; it does not make the package run globally human-owned.

The following mutation paths have canonical work-unit identity and enforce the ownership/resumption fence:

- canonical agent runner dispatch and new attempts;
- direct executable agent dispatch;
- RETRY apply-time dispatch;
- takeover and return control operations;
- successor-task creation and successor runner dispatch;
- writes to the bounded manual artifact copy.

Package-engine routes that mutate run-level production files, media, watch notes, generated review documents, or external worker jobs do not currently carry a canonical agent/task/artifact identity. They are not inferred from filenames and are not made takeover-eligible. A HUMAN or SUSPENDED ownership record therefore cannot be used to claim control of those unrelated run-level files, and the takeover UI remains hidden.

Before any legacy package mutation route becomes eligible for manual takeover, it must supply and validate an exact run ID, agent ID, task ID, and byte-bound artifact identity. Path resemblance alone is insufficient. Routes that cannot establish that relationship remain outside this ownership contract rather than receiving a global or guessed fence.

## Package-run relocation and deletion audit

The canonical package-run archive route is the only production path in `package-engine-server.js` that renames an entire package-run directory. It now refuses before relocating media or run bytes when a runner/ledger lock, Operator Action Ledger history, execution-ownership history, bounded manual work, or successor/resumption history exists. This preserves the canonical run-ID address of every ownership fence.

Other `package-engine-server.js` rename/remove operations are bounded artifact writes, media supersession, or Super Focus lifecycle operations outside `package-runs/<run-id>/agents`; they do not move or delete this ownership namespace. A future whole-run move, purge, restore, or run-ID reuse route must call the same archive-authority inspection or establish a separately verifiable canonical tombstone before mutation.
