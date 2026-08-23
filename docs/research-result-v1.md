# Research Result V1 — canonical claim-to-evidence artifact (Phase A)

Status: **Phase A complete (contract + validator + fixtures + tests).**
Not yet built: Research Director, Story binding, QC integration, package-run gates.

## Purpose

`research-results.json` is the canonical, versioned bridge between a claim,
its evidence, Research judgment, and later Story usage and QC verification.
Phase A establishes the epistemic contract **without changing any production
workflow**. It is a second knowledge database only in the narrow sense that
Research truth state lives here — it replaces nothing, integrates nothing yet.

## Root shape

```json
{
  "schema_version": 1,
  "artifact_type": "research-results",
  "package_run_id": "...",
  "project_id": "... (optional)",
  "results": []
}
```

The full structural authority is `config/research-result-contract.json`.
The deterministic validator is `scripts/research-result-validator.js`.

## Identity

- Claim identity: `claim_ref` with `namespace`, `canonical_id`, `revision`,
  `alias_ids[]`.
- Canonical namespaces (V1):
  - `vidtoolz-mindmap/canonical-idea` — authority is `canonical_idea_id`;
    `discovery_claim_id` (e.g. `claim-19.23`) is alias only.
  - `vidtoolz-episode-factory/package-run-claim` — `claim-<UUIDv4>`, issued once.
- Identity is **never derived from mutable claim text**.
- Revision behavior: unchanged normalized proposition → same revision.
  Wording/qualification/narrowing/temporal change → new revision + new result.
  Broadening → new revision plus mandatory Research review. Materially
  different proposition → new canonical claim ID. New evidence with unchanged
  proposition → same claim revision, new result revision. An old result never
  authorizes a different claim-text hash.

## Immutable revisions & supersession

- Result entries are immutable; new research appends new results.
- Supersession is explicit via `supersedes_result_id`; `superseded_by` is
  derived, never written into history.
- Positive monotonic revisions, unique result IDs, no supersession cycles,
  same claim lineage only.
- Exactly one valid unsuperseded head per claim. Two unsuperseded VALID heads
  → ambiguity → fail closed (never silently pick latest timestamp).

## Separated judgments (orthogonal states)

Support / freshness / evidence quality / confidence / independence /
contradiction / disagreement / recommendation are independent axes. The exact
enums live in the contract. Confidence is HIGH/MEDIUM/LOW — never numeric.
Qualification uses `qualification_required` + `wording_constraints[]` with
stable `constraint_id` per constraint (`LIMIT_SCOPE`, `RETAIN_QUALIFIER`,
`FORBID_ABSOLUTE`, `REQUIRE_ATTRIBUTION`, `REQUIRE_AS_OF_DATE`).
Disagreement reuses the architecture states (`NONE`, `RESOLVED_BY_CONTRACT`,
`NEEDS_SPECIALIST_REVIEW`, `NEEDS_HUMAN_DECISION`, `BLOCKED`).

## Evidence

Each evidence link requires: `evidence_id`, `source_ref`, `stance`, and a
bounded exact excerpt with `exact_text_sha256`. Stance is exactly `SUPPORTS`,
`CONTRADICTS`, or `CONTEXT_ONLY` — no pseudo-stances. Corpus provenance fields
(`evidence_set_id`, `extracted_idea_id`, `evidence_window_id`, paragraph
start/end, heading context) are preserved when present.

## Source vs container

A source record separates **original identity** (source id, title, normalized
URL, publisher) from **container identity** (container type, relationship,
Google document id, title, URL, retrieved_at, retrieved content hash).
Relationship: `IS_ORIGINAL` / `DERIVED_FROM` / `UNKNOWN`. A Google Doc's title
or owner is not proof of original authorship. Unknown origins are legal and
remain visibly uncertain; they may lower semantic quality later but are
structurally valid. Fabricated original publisher/author/URL is forbidden.

Source classes: `OFFICIAL`, `ACADEMIC`, `REPORTING`, `PRIMARY_OTHER`,
`SECONDARY`, `USER_GENERATED`, `SOCIAL`, `UNKNOWN`. This is classification,
not credibility scoring. The validator never infers truth from class.

## Independence

Each source carries `independence_group` + `independence_basis`. Same original
publication, dataset, press release, interview/event, or syndicated chain →
same group. Different URLs or publishers do not automatically prove
independence. Unknown-origin containers for one claim are grouped
conservatively unless Research establishes otherwise. The validator recomputes:

```
independent_support_count =
  count(unique independence_group) over valid evidence where stance == SUPPORTS
```

`CONTRADICTS` and `CONTEXT_ONLY` never increase it.

## Temporal / freshness

Classes: `CURRENT_FACT`, `HISTORICAL_FACT`, `EVERGREEN_FACT`, `UNCLASSIFIED`.
- `CURRENT_FACT`: requires ISO `as_of` + policy (`MAX_AGE_DAYS` integer or
  `REVIEW_BY` ISO date); supporting evidence must carry retrieval dates.
- `HISTORICAL_FACT`: requires effective/event date; source age alone never
  stales it.
- `EVERGREEN_FACT`: no arbitrary expiry; content/fingerprint changes can still
  trigger revalidation.
- `UNCLASSIFIED`: legal during incomplete Research but cannot authorize normal
  downstream QC use. A Google Doc modification date is never an event date.

## Staleness

States: `VALID`, `STALE`, `INVALID`, `SUPERSEDED`. Reason codes include
`SOURCE_CONTENT_CHANGED`, `SOURCE_INACCESSIBLE`, `CURRENT_FACT_EXPIRED`,
`CLAIM_TEXT_CHANGED`, `RESULT_SUPERSEDED`, `SCRIPT_ASSERTION_CHANGED`,
`SOURCE_FINGERPRINT_CHANGED`, `CONTAINER_CONTENT_CHANGED`,
`EVIDENCE_EXCERPT_MISMATCH`, `RESULT_DIGEST_MISMATCH`,
`SOURCE_REFERENCE_MISSING`, `HUMAN_EXCEPTION_STALE`. `INVALID` = mechanical
integrity broken. `STALE` = historically auditable but not valid for new
authorization. `SUPERSEDED` = replaced by a later result. History is never
deleted because authority expired.

## Canonical digest

SHA-256 over compact canonical UTF-8 JSON. Recursively sorted object keys;
authoritative arrays (aliases, sources, evidence, constraints, provenance
inputs) sorted deterministically. Includes root version/type, package-run ID,
optional project ID, and the complete result minus its digest field.
Excludes the digest itself, Markdown projections, UI-only timestamps,
aggregate file ordering, and later human-exception artifacts. Key order and
array normalization do not change the digest; any meaningful semantic mutation
does.

## Human exception (data model only — Phase A)

A human exception may later authorize exact editorial use despite Research
status. It binds to: exact claim, exact result ID/revision/digest, exact script
use, exact script hash, exact assertion binding, reason, acknowledged risk.
Approval uses the canonical artifact approval binding
(`scripts/agent-contract-validator.js verifyApprovalBinding`). An exception
never rewrites the Research verdict, cannot repair corrupt evidence or missing
provenance, and cannot transform unsupported into supported. No production QC
integration yet.

## Future integration (Phase B — not live)

Story binding and QC verification will consume `research-results.json` to
compare script wording against `wording_constraints` and to verify that any
human exception still binds to the exact current result/script digests.
Nothing in Phase A changes package-run behavior, Script Builder, Mindmap, QC,
Story Editor, or Research Director.

## Markdown backward compatibility

Narrative Markdown projections may accompany the artifact for human reading,
but the canonical truth is the JSON plus digests; Markdown is excluded from
the digest by definition.

## Validator non-goals (hard boundary)

The validator does not judge: truth, source credibility, semantic support,
scientific/political correctness, epistemic independence, argument quality,
formulation equivalence, or editorial risk. It checks structure, identity,
integrity, freshness arithmetic, judgment consistency, and current-authority
resolution. **Truth stays with Research judgment (later) and Mikko's human
authority.**
