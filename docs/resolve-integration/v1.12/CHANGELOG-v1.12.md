# CHANGELOG — Resolve authority bundle v1.12 (narrowly scoped correction of the v1.11 pre-M0A workflow gap)

- **Parent:** v1.11.0, branch `docs/resolve-authority-freeze-v1.11` @ `5889efa8ed12bd6626c43a657f27ea2367e54d23`, manifest `0c47f0cefdd63b971489a46274e3b782927f2c6ad26e4251de21860abc50c44e`. v1.11 committed its bundle and its DOC-AUTHORITY registration together, so its `semantic_head` is the same commit.
- **This version:** 1.12.0, directory `docs/resolve-integration/v1.12/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** the architectural adjudication of the failed A2 repair. Classification **`AUTHORITY_UNDERSPECIFIED`** — derivation correctness and record-form specification were both **COMPLETE** and demonstrated (17/17 canonical record-form tests, and a correctly minted set derived `ATTACHMENT_READY` under production authority). The failure was **operational authority completeness**: no governed persistence location, no writer, no permission law, no lifecycle and no production constructor for the `resolveEvidenceSet` document. Fixture/runtime parity was false, and that was the only reason A2 could not lawfully reach `ATTACHMENT_READY`.
- **Scope discipline:** only that gap. **No** Store.v5 semantics, Boundary.v1 law, Inventory.v4 law, marker cardinality, mode law, content addressing, cache, schema-registry architecture, trusted shim, strict raw ingestion, exact stored chain, H0, commit authority, precedence, capability matrix or M0B/M0C/M0D phase design is changed. The three record shapes keep their v1.11 fields verbatim; the derivation gains one additive binding and nothing else. No Resolve launched or contacted; no `EKA`; no A1/A2/A3 executed; no M0B; no merge; v1.0–v1.11 bytes untouched; unrelated production and Earth Studio code untouched.

## V112-1 — one governed persistence topology

```
/home/vidtoolz/resolve-qualification-evidence/attachment/<current_session_id>/
    EVIDENCE-SET.json     0600 while writable, 0400 once VERIFIED
    WORKFLOW.json         state, principals, transitions, governed_root, seals
    LOCK                  O_EXCL while a writer holds it
```

Path derived from the session id alone; directory `0700`. Every write is an atomic sibling-temp + `fsync` +
`os.replace` under an O_EXCL lock recording the holder's principal and pid, released in a `finally`. `WORKFLOW.json`
records `governed_root` and `session_id`, and loading refuses `SET_LOCATION_MISMATCH` when the derived path is not
where the document was found — so a **copied or moved document is not authority**. A session id must be a safe
basename, so the path law cannot be escaped. `/tmp`, arbitrary user paths, Store.v5 session roots and any EKA or
shared network path are forbidden as production locations.

**The two container models are deliberately not merged.** Store.v5 carries raw M0A capture evidence and session
integrity; the `resolveEvidenceSet` document carries attachment and provisioning authority. `evidence_authoring.py`
never creates, opens, finalizes or reads a Store.v5 session, and `current_session_id` remains a **label naming the
Resolve session under evaluation** — never a Store.v5 session id, and no Store.v5 session-manifest field belongs in
an attachment record. v1.12 freezes the **bridge**, not a merger.

## V112-2 — the document lifecycle

`OPEN → PREPARED → VERIFIED`. Writes are granted by `(state, role)`:

| state | PREPARER may write | VERIFIER may write |
|---|---|---|
| `OPEN` | `PROVISIONING_RECORD`, `LAUNCH_RECIPE`, `READ_ONLY_JOURNAL` | — |
| `PREPARED` | — | `BUNDLE_VERIFICATION` |
| `VERIFIED` | — | — |

`VERIFIED` grants **nothing to any role**, so there is no append-after-finalization path and no successor-document
mechanism is required. `mark_prepared()` requires exactly one provisioning record and one launch recipe and seals
`prepared_content_sha256` over both record ids; `add_bundle_verification()` seals `evidence_set_sha256` over the whole
document and re-checks it on every load. The governed derivation entry point additionally refuses a document whose
`evaluated_at` is older than `MAX_OBSERVATION_AGE_S` or more than 60 s in the future (`SET_STALE`) — a **workflow**
law on the governed container; `authority_lib`'s derivation, which has no concept of a governed document, is untouched
by it.

## V112-3 — principals, roles and write grants

A principal is a role-bound label `<ROLE>:<actor>`, registered in `PRINCIPALS.json`:

```
PREPARER : PREPARER:hermes-m0a-driver, PREPARER:mikko-operator
VERIFIER : VERIFIER:codex-independent
APPROVER : APPROVER:mikko
```

**No ACTOR may hold two roles** (`role_separation_errors()` asserted empty), so independence is not defeatable by
relabelling. Each writing entry point stamps the principal for the **one** role it implements and routes through a
single `_authorize` choke point, so a preparer cannot author a bundle verification and a verifier cannot author a
preparer record. Envelope fields are derived from the target contract, the active authority, the provisioning record
and the document; a caller may supply only `sequence` and `captured_at` and is refused `FORBIDDEN_ENVELOPE_INPUT`
otherwise — which closes the v1.11 `resolve_version` trap by construction, since the constructor derives the computed
form `21.1.0.0014`.

**Stated honestly:** a principal is an **operational label, not an authenticated identity**. There is no key, no
signature and no certificate. What the law buys is that a caller cannot invent two labels inside one record and that
no actor id holds two roles. A human who runs both tools is still one human; that residual risk is recorded in
`THREAT-MODEL.md`, not closed, and only Mikko's approval and git history stand behind it.

## V112-4 — BUNDLE_VERIFICATION write authority, and runtime parity

`tools/a2_verify.py` is the **one** production path that authors a `BUNDLE_VERIFICATION`. The action is named **A2V**
and governed as a **distinct human authorization** — not part of A2, not A1, not M0B. It requires a registered
`VERIFIER` principal of a different actor than the preparer and a document in `PREPARED`.

Everything the record asserts is computed **by the verifier**: the manifest digest from this bundle's own
`FREEZE-MANIFEST.json`, the nine target-contract pinned file digests hashed from disk, the exact provisioning and
launch record ids read from the document, and the preparer principal read from the workflow transitions.
`add_bundle_verification` takes **no** caller-supplied result, principal pair, record ids or digest map.

The body gains `verification_result` (**only `PASS` satisfies the gate**; a `FAIL` record is written for audit and
refused), `verifier_principal`, `preparer_principal`, `verified_provisioning_id`, `verified_launch_recipe_id` and
`pinned_file_digests`. The v1.11 fields are retained verbatim.

`derive_attachment_state` binds all of it — result `PASS`, both principals registered under exactly their role and of
distinct actors, the named provisioning record equal to the one that resolved, the digest map equal to the contract's
own pinned set, and the named launch recipe equal to the one that resolves for the session. Because a `record_id` is a
content digest, **editing a verified preparer record breaks the binding**, which is the TOCTOU law.

## Derivation change — and the proof that nothing else moved

One additive change: four conditions appended to the `BUNDLE_VERIFICATION` filter and one launch-recipe binding check.
No gate was removed, no state was added, no ordering rule changed. Every v1.11 attachment fixture is re-run: the
positive sets still derive `ATTACHMENT_READY` / `ATTACHED_READ_ONLY`, and every v1.11 negative case still fails for
its original reason. The `ready-self-verified-bundle` fixture was strengthened so that self-verification now collapses
**both** the free-text pair and the registered principals to the preparer.

## Fixture/runtime parity — the test v1.11 lacked

The mandatory positive end-to-end runs with **production tools only, no fixture synthesis**: adopt → provisioning →
launch → prepare → independent verify → `ATTACHMENT_READY`, exit 0, also driven through both CLIs. Twenty-eight
negative end-to-end cases, none of which may derive `ATTACHMENT_READY`. A parity test asserts the **production record
field sets are identical to the fixture field sets** for all four record types, so no positive authority state is
reachable from a shape production cannot build. `fixture_evidence.Mint` now mints the same field set the production
constructor emits, using the same registered principals and the same contract pinned-file digest set.

## Version decisions

| identifier | v1.11 | v1.12 | why |
|---|---|---|---|
| `AUTHORITY_VERSION` | `1.11.0` | **`1.12.0`** | the bundle version |
| `resolveEvidenceSet` | `…v1.10` | **`…v1.12`** | the `BUNDLE_VERIFICATION` body contract changed, so the accepted instance set changed |
| `RECORD_TYPE_VERSION` | `"1.10"` | `"1.10"` (unchanged) | the **envelope** law is unchanged; only one record body grew. Regressing this to `"1.6"` was a named v1.11 trap and is not regressed. |
| `EVIDENCE_STORE_VERSION` | `…Store.v5` | `…Store.v5` (unchanged) | Store.v5 semantics are protected and untouched |
| `Boundary.v1` / `Inventory.v4` / `Finalization.v2` | — | unchanged | protected |
| new: `resolvePrincipalRegistry.v1`, `resolveEvidenceSetWorkflow.v1` | — | added | new artifacts, first version |
| every other schema `$id` | — | unchanged | only version pin values inside them moved |

## Also changed

- **new** `tools/evidence_authoring.py` — the production authoring authority: governed persistence, lifecycle, principal and grant enforcement, and the constructors. Every record routes through `authority_lib.make_record` and `envelope_errors`; there is no body-only path.
- **new** `tools/a2_prepare.py` — the preparer CLI: `adopt` (non-destructive adoption of the already-provisioned library), `prepare`, `status`.
- **new** `tools/a2_verify.py` — the A2V verifier CLI: `check` (dry run) and `verify`.
- **new** `PRINCIPALS.json`, `EVIDENCE-SET-WORKFLOW.json`, `schemas/resolvePrincipalRegistry.schema.json`, `schemas/resolveEvidenceSetWorkflow.schema.json`, `FINDING-RESOLUTION-MATRIX-v1.12.json` / `.md`.
- `tools/authority_lib.py` — `AUTHORITY_VERSION` 1.12.0; the principal registry, write grants, lifecycle grants and their helpers; the additive `BUNDLE_VERIFICATION` binding; the six new authoring entry points added to the **authorizing** surface (unlike v1.11's fixture-only minter); lineage pinned to the v1.11 parent.
- `THREAT-MODEL.md`, `AUTHORITY-PRECEDENCE.json` / `.md` (supersessions S56–S59), `M0A-BINDING-VALUES.json` (27 new bindings), `EVIDENCE-ROOT.md` unchanged.

## What this does not do

Nothing here authorizes a run. `SCHEMA-VALID != AUTHORIZED TO MUTATE`. No Resolve was launched or contacted, no
`EKA`, no A1/A2/A3 executed, no M0B begun. A2 and A2V each still require Mikko's own explicit approval. v1.12 is a
CANDIDATE for independent review.
