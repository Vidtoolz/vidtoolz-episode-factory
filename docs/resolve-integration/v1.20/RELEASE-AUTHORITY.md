# v1.20 release authority

This is an implementation-author candidate. Exactly one structured Resolve current selector lives in DOC-AUTHORITY.md, and all current normative prose must agree. The current manifest is referenced by path rather than digest there; its external pin binds the final document bytes. The parent is the accepted v1.19 authority (5efbcae6); v1.18 and v1.19 are immutable history.

Finalize registration, generate machine artifacts, verify source-bound reference metadata, publish inventory, build manifest, validate, rebuild manifest, validate again, and require byte equality. A failed check never authorizes a run.

Artifact inclusion is parent-universe plus explicit successor artifacts (CONTROL-PLANE.md, KNOWN-LIMITATIONS-PHASE1.md, LINEAGE.md, PHASE1-SOURCE-PIN.json, PHASE1-QUALIFICATION-RECORD.json), checked against actual membership and registration. Symbol extraction retains explicit module identity; bare references require document context.

Required validation IDs are frozen separately from the executing check list. Omitting any mandatory check fails exact set parity.

No receipt, root, workflow, evidence carrier or transaction semantics are changed. No write authority, Hermes integration or operational authorization is implied. WRITE AUTHORITY = NONE.
