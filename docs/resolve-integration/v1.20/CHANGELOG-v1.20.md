# v1.20 changes

Successor of the accepted v1.19 authority (5efbcae6, manifest 06811f07b422d1cdf30ae6c076bae2bc0b598fc3ac464a0e180a8553a76a2848; human acceptance recorded 2026-09-20). Adds the independently freeze-review-approved Resolve Control Plane Phase 1 as the accepted READ-ONLY control substrate (implementation 77c26103, pinned in PHASE1-SOURCE-PIN.json; qualification carried forward by identity in PHASE1-QUALIFICATION-RECORD.json), binds the qualification-library observations in TARGET-CONTRACT.json, states the protocol-closed semantics of the vendor scripting port, records the 2026-09-20 live multi-client observations, and freezes the bounded P3 items with closure gates (KNOWN-LIMITATIONS-PHASE1.md).

Added: three-host read-only control plane doctrine (CONTROL-PLANE.md), explicit-target/no-fallback law, per-host local workers, authenticated vrc.v1 protocol, worker/Resolve/project/timeline identity model, qualification-library gate, durable replay protection, saturation observability, bounded session lifetime, structured journaling.

Not added: Hermes integration (facade ABSENT), persistent workers, any Resolve write capability, write lease, production write qualification. WRITE AUTHORITY = NONE. All v1.19 repairs (V118-M1..M4, N1..N3) are retained and regression-tested. Implementation-author candidate; independent review required.
