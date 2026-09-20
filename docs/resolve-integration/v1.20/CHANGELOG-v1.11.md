# CHANGELOG — Resolve authority bundle v1.11 (extremely narrow correction of v1.10)

- **Parent:** v1.10.0, branch `docs/resolve-authority-freeze-v1.10` @ `9c6643430d2dc66741afe9852668d8e6e19c0630`, manifest `46491cee979dc59a306993de8cc66308884967dca46304168096f935939f6156`. v1.10 committed its bundle and its DOC-AUTHORITY registration together, so its `semantic_head` is the same commit.
- **This version:** 1.11.0, directory `docs/resolve-integration/v1.11/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** Codex's independent v1.10 result — the supplied suite 1911/1911 twice and deterministic — with exactly four release-relevant findings remaining: **F110-A** the boundary receipt contains normative fields that can be consistently rewritten and still authorize (BLOCKER), **F110-B** the inventory contains six normative header/path fields that are not independently compared, and an extra semantic header field survives (BLOCKER), **F110-C** attempt marker/record reconciliation checks semantic derivation but not exact one-to-one cardinality (BLOCKER), **F110-D** several public authority-bearing read/model methods do not perform the required boundary recheck first (MERGE MAJOR / M0A MAJOR).
- **Scope discipline:** only those four findings and their versioning, documentation and test consequences. Nothing that passed v1.10's independent review was redesigned: cache, schema-registry architecture, trusted-shim authority, exact stored-chain logic, strict raw ingestion, receiver identity, H0, commit authority, precedence, matrix architecture, mode law, record-key law, root/session inode checks and the M0 phase design are untouched. `expected_model()` is consumed, not redesigned. No Resolve launched or contacted; no `EKA`; no M0; no M0A probe executed; no merge; v1.0–v1.10 bytes untouched; unrelated production and Earth Studio code untouched.

All four were reproduced against the frozen v1.10 bundle at `9c66434` before anything was changed, and F110-D was
broader than reported: `manifest_sha256()`, `identity_errors()`, `scan_tree()` and `authority_errors()` were unchecked
public surfaces too, and `finalization_marker()` masked the boundary violation the same way `inventory()` did.

## F110-A — every normative boundary field is reconciled outside the receipt

`BOUNDARY_PROVENANCE` classifies all thirteen `BOUNDARY.json` fields with **exactly one** of
`DERIVED_FROM_FILESYSTEM`, `DERIVED_FROM_SESSION_AUTHORITY`, `FROZEN_CONSTANT` or
`INFORMATIONAL_NON_AUTHORIZING`; there is no ambiguous category, and the table is asserted complete against
`BOUNDARY_FIELDS`. `_boundary_receipt()` compares the four `FROZEN_CONSTANT` fields — `schema`,
`evidence_store_version`, `authority_version`, `platform_scope` — against `BOUNDARY_FROZEN_CONSTANTS`, applies a
structural type law to every remaining field, and enforces the L5 internal coherence `session_id == session_basename`.
`check_boundary()` keeps the already-passing filesystem reconciliation of root path/device/inode and session
basename/device/inode against a fresh `lstat`. Rewriting any normative field and recomputing `boundary_sha256` now
refuses in the frozen `BOUNDARY` precedence class.

`boundary_sha256` remains **byte integrity over the stored receipt** and is explicitly not semantic truth:
authorization requires the stored receipt **and** independent reconciliation.

## created_at — the deliberate decision: INFORMATIONAL_NON_AUTHORIZING

`created_at` is classified `INFORMATIONAL_NON_AUTHORIZING` (option A). This store governs no independent
creation-event authority: it deliberately records no timestamp, owner or inode age as governed metadata, so there is
nothing outside the receipt to attest it, and comparing it to the session manifest's `created_at` would compare two
caller-supplied values written by the same call in the same trust domain — the self-assertion F110-A objects to.
Consequences, all explicit and published: it is type-checked (string or null) but never authorizing; it is excluded
from `boundary_identity()` and therefore from the session identity tuple; it stays inside `boundary_sha256`, so an
**unrecomputed** edit is still caught as byte tampering; and a **consistent** rewrite of it does **not** refuse. No
claim that every `BOUNDARY` field is normative survives in v1.11.

## F110-B — the exact inventory vocabulary, and the six missing comparisons

`INVENTORY_FIELDS` freezes the exact top-level inventory vocabulary, compared before any field is interpreted: a
missing normative field, an unknown extra semantic field or a wrong type is `INVENTORY_FIELD_SET_INVALID`, and a
duplicate top-level key is already refused by `authority_lib.strict_loads` at the parse boundary. All six previously
self-asserted fields are recomputed and compared for exact equality — `record_count` and `attempt_count` from the
`RECORD` and `ATTEMPT_MARKER` entries of the independent `expected_model()`, `entry_count` from the size of the
governed entry set, `total_bytes` from the byte-count sum over the frozen `TOTAL_BYTES_SCOPE`, and `self_path` and
`finalized_marker_path` from the frozen `INVENTORY_FILE` and `FINALIZED_FILE` store-layout constants. `expected_model()`
is consumed, never redesigned. Semantic extension is now a schema version, not an extra key.

## F110-C — the bijection has exact cardinality in both directions

`expected_model()` computes the set of valid markers claiming each authoritative record: zero is `ORPHANED_RECORD`
(retained) and more than one is `MARKER_CARDINALITY_VIOLATION`, so a persisted many-to-one state is refused by ACTIVE
integrity, `session_state()`, `finalize()`, `verify_summary()` and every write, all of which consume the same model.
`_put()` refuses the second attempt id **before anything is persisted**. With cardinality one, a record's `attempt_ids`
and `attempt_keys` are exactly one value each. Every already-passing attempt law is retained unchanged.

## F110-D — boundary dominance on every public authority surface

`PUBLIC_AUTHORITY_METHODS` is an explicit inventory built by discovery and asserted complete against
`dir(EvidenceStore)`. Every authority-bearing member checks the persisted boundary first: members that return data
raise, members whose contract is a refusal list or a state label report the boundary refusal first in their own
vocabulary. The previously unchecked internals became private — `_boundary_receipt`, `_scan_tree`, `_manifest`,
`_manifest_sha256`, `_inventory`, `_finalization_marker`, `_identity_errors`, `_finalized` — with checked public
wrappers, because `check_boundary()` is built from them. `ERROR_PRECEDENCE` freezes
`BOUNDARY > SESSION_STATE > MODEL > READ`, so `inventory()` answers the boundary refusal and no longer masks it with
`SESSION_NOT_FINALIZED`.

## Deliberately out of scope

Codex marked filesystem normalization **PARTIAL** (raw `os.close` and walk-iteration coverage). That was not one of
the four release findings, and v1.11 does **not** broaden into a filesystem wrapper rewrite. The 13-label frozen
`FS_*` vocabulary, the mapped errno conditions, the `TypeError`/programming-error distinction and `fs()`'s
normalization behaviour are retained and re-run unchanged; no new raw filesystem call was introduced by the changed
code. The item is left for separate adjudication.

## Version decisions (no mechanical bumps)

The rule applied throughout: **a version identifier moves only when the contract it names actually changed.** A
version *pin value* carried inside a document is not a contract change, because `SCHEMA-REGISTRY.json` binds
`(authority_version, schema id) -> exact schema bytes`, so one id can pin different values in different bundles. This
is the rule v1.10 itself used for `resolveSchemaRegistry.v1` and `resolveTrustedCaptureShim.v1`, whose consts moved
from `1.9.0` to `1.10.0` under unchanged ids.

| Identifier | v1.10 | v1.11 | Why |
|---|---|---|---|
| `AUTHORITY_VERSION` | `1.10.0` | **`1.11.0`** | This *is* the bundle version, and F110-A requires the receipt's `authority_version` to be compared to the exact active Resolve authority version. |
| `EVIDENCE_STORE_VERSION` | `…EvidenceStore.v4` | **`…EvidenceStore.v5`** | The store **law** changed: marker cardinality is a new refusal, the boundary constants are now reconciled, the inventory vocabulary is closed and boundary dominance is enforced. A v4 receipt therefore deliberately does not authorize under v1.11. |
| `EVIDENCE_INVENTORY_SCHEMA` | `…Inventory.v3` | **`…Inventory.v4`** | The inventory's accepted-instance set changed: a superset of the field vocabulary was accepted in v3 and is refused in v4. Its hash domain moves with it and `…Inventory.v3` is unregistered. |
| `EVIDENCE_BOUNDARY_SCHEMA` | `…Boundary.v1` | `…Boundary.v1` (unchanged) | The receipt's field set, types and required set are identical. Only the verifier was incomplete, and the provenance classification is published without altering which receipts are structurally well formed. |
| `EVIDENCE_SESSION_SCHEMA` | `…Session.v4` | `…Session.v4` (unchanged) | The session-manifest field set and types are unchanged; only the version pin values it carries move. |
| `EVIDENCE_FINALIZATION_SCHEMA` | `…Finalization.v2` | `…Finalization.v2` (unchanged) | The nine normative finalization fields all passed v1.10 review; no marker-format redesign was required, so no consequential bump. |
| `resolveInventoryFieldProvenance` | `…v1.10` | **`…v1.11`** | Its **field contract** changed: it now requires the boundary provenance table, the exact field-set vocabularies, the `created_at` law, the public authority surface, the error precedence and the verifier binding. |
| every other schema `$id` | `…v1.10` / `…v1.1` / `…v1` | unchanged | Only version *pin values* inside them moved (`authority_version` const `1.10.0` → `1.11.0`, document `version` `1.10.0` → `1.11.0` and its pattern, the store-version const in `resolveTrustedCaptureShim`). No field, type or required-set changed, so no id moves. |

## Also changed

- `tools/evidence_store.py` — the primary semantic implementation: `BOUNDARY_PROVENANCE`, `BOUNDARY_FROZEN_CONSTANTS`, `CREATED_AT_CLASSIFICATION`, `INVENTORY_FIELDS`/`INVENTORY_FIELD_SET`, `FINALIZATION_FIELDS`, `TOTAL_BYTES_SCOPE`, `PUBLIC_AUTHORITY_METHODS` and its four sub-tuples, `PUBLIC_NON_AUTHORITY`, `ERROR_PRECEDENCE` and `ERROR_PRECEDENCE_CLASS`; laws L14 (closed vocabulary) and L15 (boundary dominance); two new closed refusal codes `INVENTORY_FIELD_SET_INVALID` and `MARKER_CARDINALITY_VIOLATION`.
- `tools/authority_lib.py` — `AUTHORITY_VERSION` 1.11.0, the store and inventory version constants, the inventory hash domain, and the lineage law pinned to the v1.10 parent.
- `INVENTORY-FIELD-PROVENANCE.json` — now **derived from** the executable authority, so the document can never again publish a derivation the verifier does not perform. Adds `boundary_fields`, `boundary_sources`, `boundary_frozen_constants`, `boundary_digest_law`, `created_at_classification`, `created_at_law`, `inventory_field_set`, `finalization_field_set`, `field_set_law`, `total_bytes_scope(_law)`, `public_authority_methods`, `boundary_dominance_law`, `error_precedence(_classes,_law)`, `marker_cardinality_law` and `verifier_binding`.
- `M0A-BINDING-VALUES.json` — the attempt-tuple law now states the bijection and the second-write refusal; adds `boundary_recheck_law`, `inventory_field_vocabulary`, `inventory_field_set_law`, `public_authority_surface`, `error_precedence` and `created_at_classification`.
- `FINDING-RESOLUTION-MATRIX-v1.11.json` / `.md` — the ACTIVE matrix; v1.10's becomes inherited history.
- `EVIDENCE-ROOT.md` — the v1.11 section.
- `AUTHORITY-PRECEDENCE.json` / `.md` — supersessions S52–S55.
- `tools/validate_v1_11.py`, `tools/build_v1_11.py`, `tools/build_manifest.py` — renamed from the v1.10 tools; the four new attack sections, the property suites, the lineage pins and the M0A/provenance generation.

## What this does not do

Nothing here authorizes a run. `SCHEMA-VALID != AUTHORIZED TO MUTATE`. Passing 2007/2007 proves internal consistency
of these documents and that the four reproduced attacks are refused; it is not evidence that any Resolve read or write
works. v1.11 is a CANDIDATE for independent review.
