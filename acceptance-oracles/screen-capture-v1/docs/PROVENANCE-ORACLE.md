# Provenance oracle

Each accepted bundle binds the exact CaptureSpec digest, capture id, source-state receipt, machine/session, adapter id/version, times, declared operations, raw SHA-256, presentation SHA-256, privacy record, evidence-intent record, independent-QC digest, and Episode Factory handoff digest.

The harness detects raw, presentation, manifest, source, session, adapter, QC, and handoff inconsistencies. Production must store raw and manifests in access-controlled immutable or append-only storage; a hash re-authored together with every compromised record is not an external trust anchor. Candidate qualification must demonstrate that only the capture authority can finalize provenance and that presentation/QC cannot overwrite raw/source receipts.
