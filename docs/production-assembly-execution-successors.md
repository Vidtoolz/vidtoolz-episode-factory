# Production Assembly execution successors

Production Assembly separates the immutable semantic render plan from a
concrete renderer invocation. `plan_digest_sha256` is computed from the plan
before `ffmpeg_invocation` is attached. Release, handoff, timeline, narration,
assets, music, composition, reveal, typography and output requirements are
therefore semantic authority; the serialized FFmpeg argv is execution
authority.

An existing completed render is never retried through this mechanism. A failed
or conclusively incomplete frozen invocation may receive an immutable execution
successor only when the semantic projection and digest are exactly unchanged
and every changed path is within the explicit `ffmpeg_invocation` allowlist.
There is no caller-supplied command, filtergraph, force flag or ignore-conflict
option.

Each successor records its failed predecessor, semantic digest, renderer source
digests, serializer version, invocation digest and the typed reason
`EXECUTION_SERIALIZATION_REPAIR`. Its plan, descriptor, failure receipt,
manifest, evidence and completion are write-once. Staging is attempt-specific;
the production output remains reserved. An atomic execution-head record makes
the same retry idempotent and binds any successful completion to the exact
attempt.

Semantic drift, a live predecessor, a completed predecessor, modified lineage,
an unauthorized changed field, or a second ambiguous active successor all fail
closed. Historical failed plans are never deleted or rewritten.
