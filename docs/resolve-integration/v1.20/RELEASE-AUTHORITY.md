# v1.20 release authority

This is an implementation-author candidate. Exactly one structured Resolve current selector lives in DOC-AUTHORITY.md, and all current normative prose must agree. The current manifest is referenced by path rather than digest there; its external pin binds the final document bytes. The parent is the accepted v1.19 authority (5efbcae6); v1.18 and v1.19 are immutable history.

Finalize registration, generate machine artifacts, verify source-bound reference metadata, publish inventory, build manifest, validate, rebuild manifest, validate again, and require byte equality. A failed check never authorizes a run.

Artifact inclusion is parent-universe plus explicit successor artifacts (CONTROL-PLANE.md, KNOWN-LIMITATIONS-PHASE1.md, LINEAGE.md, PHASE1-SOURCE-PIN.json, PHASE1-QUALIFICATION-RECORD.json), checked against actual membership and registration. Symbol extraction retains explicit module identity; bare references require document context.

Required validation IDs are frozen separately from the executing check list. Omitting any mandatory check fails exact set parity.

No receipt, root, workflow, evidence carrier or transaction semantics are changed. No write authority, Hermes integration or operational authorization is implied. WRITE AUTHORITY = NONE.

Validator operating constraint (F-120-04): run at most one Resolve authority validator per host at a time while the governed self-test evidence root (/home/vidtoolz/resolve-qualification-evidence/attachment) is shared. The positive-control sections create transient, uniquely named self-test sessions there through tools/evidence_authoring_testkit.py and remove only those; pre-existing governed production sessions are never adopted, overwritten or removed. Concurrent validator execution is unsupported: it trips the testkit leftover assertion (a visible FAIL, never a silent pass) and, when the root is absent, two validators can race over creating and removing the whole tree. Validation also requires the repository checkout with resolve-control/** present (section phase1-pin).

Release-identity law (v1.20 repair, F-120-01/02/03/05/06): every external pin is re-verified by path, sha256 and byte count and every ancestor digest must be pinned; the manifest rule text, the DOC-AUTHORITY selector, TARGET-CONTRACT.json, MILESTONES.md and every release-metadata record must name the same authority version; every inherited finding matrix must equal the accepted parent frozen copy except for its authority_version stamp and the parent matrix must still enumerate the accepted parent findings; every top-level JSON member must validate against the schema it declares or carry an explicit NO_REGISTERED_SCHEMA reason in the manifest; resolve-control/** must equal PHASE1-SOURCE-PIN.json. The manifest build refuses to write when its own pins or version statements fail these laws.
