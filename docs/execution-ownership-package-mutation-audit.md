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
