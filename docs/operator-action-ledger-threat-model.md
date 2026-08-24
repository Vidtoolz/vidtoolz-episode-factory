# Operator Action Ledger threat model

The Operator Action Ledger is a local, append-only, SHA-256 hash chain. It detects accidental corruption, deletion, reordering, and ordinary partial-write failures. Execution-ownership records cross-check their referenced ledger actions, so a broken state/ledger relationship fails closed during normal control and runner operations.

This is tamper evidence, not an external trust anchor. An adversary with arbitrary write access to the local repository can rewrite the ledger, ownership state, and hashes together. The chain does not provide signatures, remote attestation, or cryptographic proof of a human identity.

Actor identity is limited to the local OS user in a same-host, nonce-gated cockpit context. Records correctly state `authenticated: false` until a real authentication mechanism exists. Clients cannot choose an arbitrary actor identity; the trusted server derives it from the local process context.

The ledger records operator controls only. It cannot create, replace, or satisfy a human approval binding. Approval authority remains in the separate byte- and scope-bound approval system.

Future hardening may externally anchor selected ledger heads, for example in an independently protected store or a signed release record. Such anchoring is not part of the current security claim.
