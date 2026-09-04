# Qualification gates

All twelve gates are mandatory for production. Any critical red or any gate failure blocks qualification.

1. **G1 CaptureSpec schema** — exact fail-closed V1 validation and bounded destinations.
2. **G2 source authenticity** — real current source, exact identity/state, no synthetic substitution.
3. **G3 evidence intent** — all required facts/context visibly prove the requested claim.
4. **G4 provenance integrity** — CaptureSpec/source/raw/presentation/adapter/session/QC/handoff chain intact.
5. **G5 privacy/secret safety** — scans clear; V1 secrets block; redaction is authorized/traceable.
6. **G6 bounded execution** — no shell, traversal, broad RPA, unbounded motion, or unsafe concurrency.
7. **G7 raw immutability** — separate authentic raw retained and hash-stable.
8. **G8 presentation integrity** — derivative operations declared and semantically faithful.
9. **G9 mobile readability** — safe-area and independent legibility constraints pass.
10. **G10 application safety** — desktop/Resolve exact state; human activity wins; observation-only V1.
11. **G11 structured failure** — typed fail/replan/escalate; no hidden representation fallback.
12. **G12 Episode Factory handoff** — independent QC PASS and exact evidence digest/source class.

Qualification also requires real trials for every implemented adapter, the five frozen expected beats, deterministic static-state equivalence, concurrency/serialization proof, restart-safe artifact finalization, and evidence that the candidate cannot bypass these records via an alternate success path.
