# SCHEMA-REGISTRY.md — who owns the validator (v1.7, FROZEN_NOW)

Correction of Codex v1.6 BLOCKER **C16-B2**: *caller-supplied schema-validator trust allows permissive or wrong
validators to authorize invalid artifacts.*

## What went wrong in v1.6

v1.5 was corrected by making the schema validator a **required** parameter of the composed transaction validators,
then named `validate_transaction_set` / `commit_eligibility`, so that no default could make schema enforcement
optional. (Classification since v1.15, corrected here under V115-B1: the AUTHORIZING pair is
`validate_transaction_set_authorizing` / `commit_eligibility_authorizing`; it is the **legacy bare-evidence pair**
`validate_transaction_set` / `commit_eligibility` that is `PROVISIONAL_UNTIL_M3` and non-authorizing. The canonical
map is `AUTHORITY-FUNCTION-CLASSES.json`.) That closed the wrong half of the
problem. Requiring the caller to pass a validator still leaves the caller choosing the law. Codex demonstrated four
callbacks that authorized a commit manifest carrying an unapproved authority extension:

| injected validator | what it did |
|---|---|
| always-empty | reported no errors for anything |
| partial | validated snapshots honestly and skipped the commit manifest |
| permissive schema | validated every document against `{"type": "object"}` |
| always-true | returned a truthy non-list, which the composed path treated as no errors |

An authorizing function that accepts the definition of validity from its caller is not authorizing anything.

## The v1.7 law

1. **The authority owns the law; the caller supplies artifacts.** `validate_transaction_set_authorizing` and
   `commit_eligibility_authorizing` — and equally their PROVISIONAL_UNTIL_M3 non-authorizing counterparts
   have no validator parameter. They resolve schemas internally through `internal_schema_errors(schema_id, doc)`.
2. **Refusal by name.** Any extra positional argument, and any keyword naming a validator, schema, registry or
   override, is refused with `CALLER_SUPPLIED_VALIDATOR_REFUSED` and the commit stays INELIGIBLE. Nothing is silently
   ignored: a reviewer reading the error sees exactly which argument was rejected.
3. **`SCHEMA-REGISTRY.json` is a pinned trust root.** It maps `(authority_version, artifact_schema_id)` to the exact
   schema file, its sha256 and its byte count, and closes over its own digest. `schema_registry()` re-verifies, on
   every resolution: its own digest, that it is pinned for this exact authority version, that the pinned schema count
   matches, and that every listed file's bytes and byte count match. One changed byte in one schema file makes the
   whole registry untrusted and nothing can be validated at all.
4. **An unknown artifact schema id is a refusal.** `SCHEMA_NOT_REGISTERED`, never a pass. There is no fallback
   validator and no permissive default.
5. **No schema engine means no authorization.** If `jsonschema` cannot be imported, `schema_registry()` raises
   `SCHEMA_ENGINE_UNAVAILABLE` and the composed path refuses. Absence of enforcement is never treated as enforcement.
6. **Historical schemas validate historical artifacts only.** `historical_schema_errors(authority_version, ...)` loads
   the registry of an older bundle, verifies the historical schema's bytes against that registry, and validates
   against it. It is INTERNAL_NON_AUTHORIZING, the active path never calls it, and its result can never authorize
   anything under the active authority.
7. **The diagnostic seam is not on the authorizing surface.** `validate_transaction_set_diagnostic(..., callback)`
   exists for schema-authoring work and reviewer harnesses. It is listed under `internal_non_authorizing`, it stamps
   every result `INTERNAL_NON_AUTHORIZING`, and it deliberately returns no `eligible` key and no stage list a caller
   could mistake for an authorization.
8. **The registry is bound to the bundle.** `FREEZE-MANIFEST.json` pins `SCHEMA-REGISTRY.json` by sha256 and byte
   count like every other file, so a registry substituted with the bundle in place is a manifest failure as well as a
   trust-root failure.

## Reading the registry

```
{
  "schema": "vidtoolz.resolveSchemaRegistry.v1",
  "authority_version": "1.7.0",
  "schema_count": <n>,
  "schemas": { "<artifact schema id>": {"path": "schemas/....schema.json", "sha256": "...", "byte_count": <n>} },
  "schema_registry_sha256": "<digest of everything above>"
}
```

The artifact schema id is the schema file's path under `schemas/` without the `.schema.json` suffix, so
`provisional/resolveCommitManifest` names `schemas/provisional/resolveCommitManifest.schema.json`. Those ids are the
only names the authorizing path accepts.

## What this does not claim

The registry proves that the bytes validated against are the bytes this bundle froze. It does not prove that those
schemas are *correct*, and a schema-valid document is still not authorized to mutate anything.
