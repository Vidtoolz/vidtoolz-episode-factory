# Research Result V1

Research Result V1 is the canonical machine-readable bridge from a stable factual claim to bounded evidence and a recorded Research judgment. Phase A defines and validates `research-results.json`; it does not write package-run artifacts, integrate Story or QC, or build the Research Director.

## Authority boundary

The validator owns deterministic mechanics: schema, IDs, hashes, reference resolution, freshness arithmetic, source/container shape, independence-count arithmetic, supersession, append-only comparison, human-exception binding, and exact constraint IDs. It never decides truth, credibility, semantic support, scientific or political correctness, epistemic independence, argument quality, wording equivalence, or whether an editorial risk should be accepted.

Research supplies the semantic judgment fields. Mikko retains final human authority. A valid citation is not proof of support, an `OFFICIAL` source is not automatically true, and a `SOCIAL` source is not automatically false.

## Artifact and identity

The package-run artifact is an aggregate:

```json
{
  "schema_version": 1,
  "artifact_type": "research-results",
  "package_run_id": "...",
  "project_id": "... optional ...",
  "results": []
}
```

Every result has a UUIDv4-shaped `research-result-...` ID and a positive `result_revision`. Mindmap claims use `vidtoolz-mindmap/canonical-idea` with production-form `canon_gd_v10_<20 hex>` identity; discovery claim IDs remain aliases. Package-local claims use an assigned `claim-<UUIDv4>` and are never derived from prose.

Claim and result revisions are distinct. New evidence for unchanged normalized claim text retains `claim_ref.revision` and increments `result_revision`. Changed evaluated text requires a higher claim revision and a new result. The validator does not infer whether two propositions are semantically equivalent or materially different, so those editorial identity decisions remain Research/human work and downstream use fails closed on mechanical hash mismatch.

## Orthogonal judgment

Research records separate `support_status`, `freshness_status_at_review`, `evidence_quality`, categorical `confidence`, `independence_status`, `contradiction_status`, `disagreement_state`, and `recommendation`. Qualification is separate again: `qualification_required` and stable wording-constraint IDs. This preserves combinations such as partial support, weak evidence, and required qualification without flattening them into one status.

## Validation is not authorization

`validateAggregate()` returns `validation_ok`, `authorization_ok`, `result_state`, `reason_codes`, per-result reports, and current heads. The compatibility `ok` field aliases `authorization_ok`; it never means merely “JSON parsed.”

A structurally intact stale record remains auditable and may have `validation_ok: true`, but `authorization_ok` is always false for `STALE`, `INVALID`, `SUPERSEDED`, ambiguous current heads, `UNCLASSIFIED` claims, blocking disagreement, or a recommendation of `RESEARCH_MORE`, `DO_NOT_USE`, or `ESCALATE`.

## Evidence and provenance

Each evidence link contains a unique `evidence_id`, resolvable `source_ref`, one exact stance (`SUPPORTS`, `CONTRADICTS`, or `CONTEXT_ONLY`), bounded exact excerpt text, and the SHA-256 of those exact bytes. Corpus-derived records preserve `evidence_set_id`, `extracted_idea_id`, `evidence_window_id`, paragraph range, and heading context as an all-or-none group. Evidence IDs and window IDs cannot be counted twice.

The result stores bounded excerpts, not whole documents. This keeps regression fixtures portable while preserving exact auditability if an external corpus moves.

## Original source and container

An original publication is separate from its container. A Google Doc can be a corpus container without being the original source. Containers require stable identity, type, relationship, title, retrieval time, and retrieved-content hash; Google Docs additionally require `google_document_id` and the canonical `src_gdoc_<document-id>` identity. Optional source fingerprints enable later drift comparison.

`OFFICIAL`, `ACADEMIC`, `REPORTING`, and `PRIMARY_OTHER` require established original identity (`source_id`, title, URL, publisher). If origin is genuinely unknown, `original_source` remains `null` and the source must not falsely claim one of those authoritative classes. `UNKNOWN` is legal and honest.

## Independence

Research assigns `independence_group` and explains `independence_basis`. Different URLs, publishers, or Google Docs do not mechanically prove independence. `independent_support_count` is recomputed from unique groups referenced by `SUPPORTS` evidence only. Ten republications of one original assertion therefore count as one group.

## Temporal classes and staleness

`CURRENT_FACT` requires `as_of` and either `MAX_AGE_DAYS` or `REVIEW_BY`; its supporting source containers require `retrieved_at`. `HISTORICAL_FACT` requires `effective_date` and does not expire merely because its source is old. `EVERGREEN_FACT` has no arbitrary age expiry. `UNCLASSIFIED` may represent incomplete work but cannot authorize use.

Offline `current_sources` snapshots can deterministically report accessibility and current content/fingerprint hashes. The validator can enforce `SOURCE_CONTENT_CHANGED`, `SOURCE_FINGERPRINT_CHANGED`, `CONTAINER_CONTENT_CHANGED`, `SOURCE_INACCESSIBLE`, and `CURRENT_FACT_EXPIRED` without network access. Integrity errors such as detached excerpts, missing sources, or digest mismatch are `INVALID`; changed observations that require revalidation are `STALE`; replaced historical results are `SUPERSEDED`.

## Digest, supersession, and append-only history

The per-result digest is SHA-256 over compact UTF-8 JSON after recursively sorting object keys and deterministically ordering authoritative arrays. Its projection includes root version/type/package identity and the complete result except `result_digest_sha256`. Semantic mutation changes the digest; unrelated aggregate additions do not.

Superseding results point backward with `supersedes_result_id`, remain in the same claim lineage, and use a strictly larger result revision. Cycles and multiple valid unsuperseded heads fail closed. Old entries are not given a mutable `superseded_by` field.

`validateAppendOnly(previousAggregate, candidateAggregate)` accepts preserved canonical historical projections plus appended valid results. It rejects deletion, mutation, reused IDs with new meaning, and changed aggregate identity.

## Human exception and future Story constraints

`validateHumanException()` validates a separate `research-human-exception` artifact bound to the exact claim, result ID/revision/digest, script version/hash, binding ID, assertion hash, and canonical approval binding. `exceptionApprovalBytes()` produces the canonical approval projection without `approval_binding`, avoiding recursive self-hashing. Exact bindings are `VALID`; result, script, assertion, or exception-byte drift is `STALE`; malformed data or an attempt to repair invalid Research provenance is `INVALID`. Phase A records no human approval, and TEST fixtures use `TEST_HUMAN` only. An exception never rewrites the underlying Research verdict.

`validateConstraintSatisfaction()` is Phase A groundwork only. It compares required Research constraint IDs with explicitly supplied satisfied IDs and the exact result digest. It does not inspect story prose. Story integration remains Phase B.

## Compatibility and non-goals

Existing `research-pack.md`, `research-evidence.md`, `source-support-map.md`, `proof-capture-plan.md`, `research-objections.md`, and `research-sufficiency-review.md` remain untouched. Phase A neither replaces nor generates them. Package-run gates, Script Builder, Story, QC, and Research Director are unchanged.

Run the complete standalone regression suite with:

```bash
node tests/research-result-validator.test.js
```

Run syntax validation with:

```bash
node --check scripts/research-result-validator.js
```
