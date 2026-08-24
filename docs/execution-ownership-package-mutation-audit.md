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

The canonical package-run archive route (`POST /api/package-runs/archive` → `archivePackageRun()`) is the only production path in `package-engine-server.js` that renames an entire package-run directory. It refuses before relocating media or run bytes when a runner/ledger lock, Operator Action Ledger history, execution-ownership history, bounded manual work, or successor/resumption history exists. V1 also refuses a run that returned to AUTOMATION after any takeover: historical ownership is not considered disposable merely because its current owner is AUTOMATION.

Before a clean run moves, the route appends a reservation to the repository-level hash-chained anchor at `state/execution-ownership-authority/anchor.json`. After the rename it appends completion. The textual run ID is permanently reserved; recreating it cannot yield virgin AUTOMATION. Ownership transitions also bind a run-incarnation marker to this anchor, so moving the entire live directory and recreating the same run ID fails with `OWNERSHIP_RUN_INCARNATION_MISMATCH` even when both run-local ownership and ledger files moved together.

Audited whole-run operations:

- archive: implemented and anchored as above;
- restore: no canonical package-run restore route exists;
- purge/delete: no destructive whole-run route exists; the UI “Delete” operation is archive;
- import/copy: no canonical route installs a copied directory as an existing run identity;
- stale-run purge: no production route exists;
- Super Focus deletion/archival: operates in `super-focus-projects/`, not the package-run ownership namespace.

Other `package-engine-server.js` rename/remove operations are bounded artifact writes, media supersession, or lifecycle operations outside `package-runs/<run-id>/agents`; they do not move or delete this ownership namespace. A future whole-run move, purge, restore, import, or run-ID reuse route must consult the repository anchor and implement explicit incarnation reconciliation. Path resemblance or a stale-runs directory scan is insufficient.
