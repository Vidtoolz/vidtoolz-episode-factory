# THREAT-MODEL.md — defensive controls for the qualification pipeline (v1.6, FROZEN_NOW as doctrine)

Defensive only. The subject is our own evidence chain: a compromised or buggy probe tool, a stale or substituted parser, a substituted matrix or manifest, a misused lower-level validator, a swapped snapshot. No offensive technique is described, and no control here is a substitute for Mikko's approval.

| Threat | v1.5 exposure | v1.6 control | Residual |
|---|---|---|---|
| **Probe-tool compromise / bug writes its own success** | the probe wrote the `parse`/`result` block and success was read from it (F15-01, M-RAW) | the capture format has no interpretation field (schema-forbidden); meaning is derived by the reference parser from the immutable capture; every validator recomputes it | a compromised shim can still fabricate a *plausible* `RETURNED` value; that is why review is raw-first, the reviewer is not the operator, and the shim source hash is bound into every capture |
| **Fake evidence injected into an evidence set** | content-addressed but interpretation-trusting | records are content-addressed **and** their meaning is recomputed; a capture whose digest does not re-hash is `MALFORMED`; forbidden fields make it schema-invalid | an attacker with write access to the whole evidence root and the bundle could build a self-consistent set; mitigated by the append-only root, the mirror, git history and independent review |
| **Matrix substitution ("matrix-content forgery")** | `primitive_status` compared references but never proved that the supplied matrix was the active one (F15-02) | `active.capability_matrix_sha256` **is** the canonical content digest; `active_authority_errors` refuses any other object with `CAPABILITY_MATRIX_NOT_ACTIVE`, checked by every authorizing entry point before any stage | the operator must supply the active digest from the frozen manifest, not from the matrix file it is validating |
| **Parser substitution / stale-parser replay** | no parser identity existed | `parser_version` + `parser_sha256` (hash of the parser source) are bound in every review, refreeze, matrix entry and refreeze block; a promotion made under another parser is refused | a parser bug shared by fixtures and implementation; mitigated by independent review of the parser fixtures |
| **Expectation drift (spec edited under an old promotion)** | `expected_type` was a heuristic with no digest (m-TYPE) | `primitive_spec_sha256` is bound in every review, refreeze and matrix entry; changing an expectation invalidates promotions made against the old one; `FROZEN` expectations are refused in this bundle | expectations remain documented hypotheses until M0C |
| **Manifest substitution** | envelope binding to the active manifest | unchanged and extended: every record binds `manifest_sha256` + `authority_version`; a `BUNDLE_VERIFICATION` for another manifest counts only as `historical`; the validator re-mints fixtures against the real manifest sha and proves both directions | host-root compromise is out of scope (mirror + git history detect it) |
| **Lower-level validator misuse (direct commit)** | `schema_validate=None` was the default for the composed path and `commit_eligibility` (F15-04) | the schema validator is a **required** parameter of both authorizing entry points; a call without it refuses instead of reporting the schema stage complete; every per-document helper is `INTERNAL_NON_AUTHORIZING` and refuses partial input; the bypass audit checks names, docstrings, signatures, defaults and behaviour | a caller could still pass a permissive validator; the manifest pins the schemas the validator must load |
| **S1 substitution / ghost applied operation** | declared `applied_operation_ids` were not compared (F15-06) | the journal's single `READBACK_S1` names the S1 object digest and guard; `applied_operation_ids` and `unobserved_domains` are derived and compared with the declaration | verification remains provisional until M3 |
| **Degraded H0 passed off as a write precondition** | the early gate compared only guard digests (F15-03, M-H0) | the `GUARD_SNAPSHOT` record carries the guard object and the provenance map; the evaluator recomputes both digests and proves profile, completeness, qualified provenance, matrix, authority and target **before** any mutator | pre-M3 remains blocked; the rule is a reference implementation, not runtime-qualified |
| **Over-claimed protected surface** | properties were claimed protected but not representable (F15-05) | `PROTECTED_SURFACE_EXCLUSIONS` names item properties, fades, speed, takes, links and unowned media hashes as **not observed, not compared and not covered**; observing them is a snapshot error; every verification result carries `unobserved_domains` | narrower guarantee, honestly stated |
| **Unsafe script execution (MCP or otherwise)** | denied by policy | unchanged policy + the shim refuses `run_script`/`run_script_unsafe`/`execute_python`/`execute_lua`/render tools before invocation, and only `Get*` names on a static 47-method allowlist are callable | policy plus mechanism at the shim; host-level MCP configuration remains an operator matter |

## v1.7 additions: the attack classes Codex demonstrated against v1.6

| # | attack | v1.6 outcome | v1.7 control | residual |
|---|---|---|---|---|
| T-C1 | qualify a chain, then edit the raw capture, spec, review, refreeze, matrix, stored derived result, host or build **in place** | the warm process kept answering QUALIFIED_CALLABLE while a cold process refused | every authority cache key is a content digest plus the authority version; no identity-keyed cache exists; warm equals cold for every mutation in the suite | proven for this reference implementation only; a second evaluator must re-derive it |
| T-C2 | monkeypatch the reference parser after the identity has been computed | the old parser hash kept being served | parser identity is memoized under a content key over the live parser code objects | a caller who replaces the whole module is outside this boundary |
| T-C3 | pass an always-true, always-empty, partial or permissive schema validator into the authorizing path | an invalid commit manifest was authorized | there is no validator parameter; schemas come from the pinned registry; any such argument is refused by name | the registry proves which bytes are validated against, not that those schemas are correct |
| T-C4 | substitute a stale schema from an older bundle | accepted | the registry is pinned per authority version and re-verified per resolution; historical registries validate historical artifacts only | historical registries are trusted only as far as the older bundle's own manifest |
| T-C5 | claim any capture-shim sha256 | promoted | `TRUSTED-SHIM.json` pins the one shim and is re-verified against its source; a mismatch is the fatal class `SHIM_UNTRUSTED`; the active authority names the trusted shim | the trust root proves identity, never that the shim ran or that the value is true |
| T-C6 | invoke a getter outside the probe allowlist | recorded and derivable | the allowlist is owned by the read-primitive authority, pinned by the trust root, and a capture outside it is refused | a shim that lies about the method it called is bounded only by the review of the raw frame |
| T-C7 | promote a chain whose stored derived artifact is absent, or belongs to another raw capture | accepted on the recomputation | the exact stored artifact must resolve by digest and by record id and belong to that raw capture | none known |
| T-C8 | present two current reviews, or two current reviewed refreeze records, and let iteration order decide | an arbitrary winner | explicit `supersedes` or CONFLICT; order never decides | a reviewer must still resolve the conflict deliberately |
| T-C9 | feed a raw frame with a duplicate JSON key, malformed UTF-8, trailing bytes, a control character, an invalid number, a non-finite constant, an oversized body or an unknown schema version | the parsed-object API could not see any of it | one strict byte-ingestion boundary with a closed refusal vocabulary and a strict-parse receipt on every record | a frame that is well formed and false is an M0B review question, not a parse question |
| T-C10 | overwrite, replace, re-attempt, traverse out of, symlink out of, or write after finalizing an evidence session | the layout was prose; nothing enforced it | an executable append-only store with create-exclusive writes, content addressing the store computes itself, attempt-id uniqueness, finalization and full re-verification | file-system-level attacks by a privileged local user are out of scope; the store detects them after the fact rather than preventing them |
| T-C11 | present an evidence session pinned to another authority, matrix, shim, parser or spec | not checked | `session_manifest_errors` refuses, and qualification refuses the evidence set | none known |

### Residual risks unchanged from v1.6

No probe has run; no capture in this bundle describes real Resolve behaviour; every expectation in the primitive spec
is a documented hypothesis; M0C requires a human approval that has not been given; and a second implementation in
another language has not been written, so canonicalization, ingestion and storage conformance is demonstrated for one
implementation only.

## v1.8 additions: the evidence-store attack classes Codex demonstrated against v1.7

| # | attack | v1.7 outcome | v1.8 control | residual |
|---|---|---|---|---|
| T-E1 | finalize a valid session, then plant an unexpected file in the session ROOT (Codex STORE-14) | ignored; `verify()` returned clean | closed-world inventory; any unknown entry is `UNEXPECTED_ENTRY` and the session state becomes `INVALID` | the store detects, it does not prevent |
| T-E2 | plant an unexpected file inside a layer, a shard directory or the attempts index | caught only incidentally, mis-labelled `PARTIAL_RECORD` | `UNEXPECTED_ENTRY` with the correct code | none known |
| T-E3 | plant an unexpected directory, at root or nested | ignored entirely | directories are part of the expected set; unknown ones are refused | none known |
| T-E4 | add an extra, correctly content-addressed RAW or DERIVED record after finalization | accepted as a well-formed record | not in the inventory, so `UNEXPECTED_ENTRY` | none known |
| T-E5 | alter, delete or rename a stored record after finalization | alteration and deletion were caught; a rename produced a confusing partial result | `EVIDENCE_REPLACED`, `RECORD_MISSING`, and a rename is reported as both | none known |
| T-E6 | alter the finalization receipt or the hash manifest | caught | `INVENTORY_TAMPERED`, including a receipt that no longer names the inventory | none known |
| T-E7 | `EvidenceRoot.add_derived("../../x")` and the same shape on `add_capture`, `add_review`, `add_refreeze` | wrote outside the evidence root | the API is removed; the canonical store refuses the identifier before any write, and the validator proves no file appears outside the session root | none known |
| T-E8 | absolute path, separator injection, dot, empty, over-long or encoded identifier on any store entry point | the legacy surface accepted several | one logical-name gate plus a resolved-path containment proof on all eight entry points | none known |
| T-E9 | symlink planted inside a session, or a symlinked session name | not checked at verification | `SYMLINK_REJECTED` at creation and at verification; the tree walk never follows links | a symlink created between verification and use is outside this boundary |
| T-E10 | FIFO, socket or device planted inside a session | not checked | `FILE_TYPE_REJECTED` | none known |
| T-E11 | two competing storage authorities disagreeing about validity | both existed | exactly one module is `EVIDENCE_STORE_AUTHORIZING`, asserted by a static audit | a future adapter must not add a second |

### Residual risks unchanged from v1.7

No probe has run; no capture describes real Resolve behaviour; every primitive expectation is a documented hypothesis;
M0C requires a human approval that has not been given; and no second implementation exists in another language.

## v1.9 additions: the evidence-store attack classes Codex demonstrated against v1.8

| # | attack | v1.8 outcome | v1.9 control | residual |
|---|---|---|---|---|
| T-S1 | create, finalize and verify a session through a **symlinked evidence root** | accepted; the symlink was resolved away before any check | `lstat` first, no `realpath` on the trust path, `ROOT_SYMLINK_REFUSED` at create, open and list | a root replaced between two operations is detected by device+inode, not prevented |
| T-S2 | symlinked **session directory** entry | internal symlinks were rejected but the session entry itself was not | `SESSION_SYMLINK_REFUSED` before the entry is used | none known |
| T-S3 | replace an established root with a symlink or another directory between operations | undetected | `ROOT_SYMLINK_REFUSED` / `ROOT_REPLACED` on the next operation | inode reuse is explicitly not claimed to be detected |
| T-S4 | **rename a finalized session directory** | verified clean | `SESSION_PATH_MISMATCH` and `SESSION_IDENTITY_MISMATCH`; state becomes INVALID | none known |
| T-S5 | copy a finalized session, or its inventory, marker, manifest or one record, into another session | inventory/marker/manifest copies were caught by digest; a record copy and a whole-session copy were not | session identity is bound into manifest, inventory and marker, and every record key is bound to the session | none known |
| T-S6 | move a valid record into another **layer** | undetected | the record key recomputes from (session, layer, logical identity, content), so `LAYER_IDENTITY_MISMATCH` | none known |
| T-S7 | rebind a stored record to another **logical identity** in the inventory | undetected | `LOGICAL_IDENTITY_MISMATCH` | none known |
| T-S8 | reuse an attempt id in another layer or under another logical identity | accepted; produced a second distinct record | `ATTEMPT_ID_CROSS_LAYER`, `ATTEMPT_ID_CROSS_IDENTITY` | none known |
| T-S9 | duplicate attempt tuple keys or duplicate inventory paths | silently overwritten in a map | validated from a list first: `ATTEMPT_TUPLE_DUPLICATE`, `INVENTORY_DUPLICATE_KEY` | none known |
| T-S10 | `chmod` a record, a directory, the manifest, the inventory or the finalization marker after finalization | undetected | canonical modes frozen in the inventory, `MODE_MISMATCH` | POSIX only; mode is detected, not prevented |
| T-S11 | replace a regular file with a FIFO, socket or device at a governed path | caught only as a type rejection, with no frozen expectation | file type is frozen per entry and reconciled | none known |
| T-S12 | tamper with a record's internal session id | undetected | `INTERNAL_IDENTITY_MISMATCH` | a record with no internal identity records `null`, and a later appearance is itself a change |

### Residual risks unchanged from v1.8

No probe has run; no capture describes real Resolve behaviour; every primitive expectation is a documented hypothesis;
M0C requires a human approval that has not been given; and no second implementation exists in another language.

## v1.10 additions: the evidence-store attack classes Codex demonstrated against v1.9

| # | attack | v1.9 outcome | v1.10 control | residual |
|---|---|---|---|---|
| T-B1 | replace a finalized session directory with another directory of the same basename and content | verified clean | persisted boundary receipt binds the session device and inode; `SESSION_BOUNDARY_CHANGED` | inode reuse not claimed |
| T-B2 | copy a whole session under a second root and open it there | verified clean | root path, device and inode are bound into the session identity; `ROOT_IDENTITY_MISMATCH` | none known |
| T-B3 | mutate or delete the boundary receipt | no receipt existed | self-digesting receipt; `BOUNDARY_RECEIPT_INVALID` / `BOUNDARY_RECEIPT_MISSING` | none known |
| T-B4 | mutate the finalization marker's store or authority version | ignored | every normative marker field derived and compared | none known |
| T-B5 | make an inventory field disagree with reality while keeping its self-digest valid | partly accepted | the model is recomputed from independent sources; the inventory is only ever compared | none known |
| T-B6 | duplicate a directory entry, or give a directory a conflicting kind or mode | partly accepted | directory kinds and modes derived from path law; duplicates refused before indexing | none known |
| T-B7 | plant a foreign attempt marker into an ACTIVE session | write, finalize and verify all succeeded | marker/record bijection; `FOREIGN_ATTEMPT_MARKER` blocks the next write | none known |
| T-B8 | reuse one attempt id under two identities on disk | attempt-key check passed, attempt-id check did not | attempt ids unique in addition to attempt keys | none known |
| T-B9 | plant a record with no marker | accepted | `ORPHANED_RECORD` | none known |
| T-B10 | chmod the session directory | ignored | the session directory is inside mode authority | POSIX only, detection not prevention |
| T-B11 | chmod anything while ACTIVE, then continue | accepted, and the session still finalized | modes enforced continuously; the next operation refuses and finalization is blocked | none known |
| T-B12 | trigger EACCES, ELOOP, ENAMETOOLONG or a vanished session on the public path | a raw `PermissionError` escaped | one `fs()` boundary and frozen `FS_*` classes | genuine programming defects still raise, deliberately |

### Residual risks unchanged from v1.9

No probe has run; no capture describes real Resolve behaviour; every primitive expectation is a documented hypothesis;
M0C requires a human approval that has not been given; and no second implementation exists in another language.

## v1.12: the pre-M0A workflow, and what role separation does and does not buy

v1.11's `verifier != prepared_by` was a lexical inequality between two caller-supplied free-text strings. The row
"Fake evidence injected into an evidence set" above already stated the residual honestly: a self-consistent set is
buildable by anyone with write access, mitigated by process, not mechanism. v1.12 does not change that conclusion —
it narrows what "process" has to carry.

| attack | v1.11 | v1.12 control | residual, stated |
|---|---|---|---|
| one actor supplies two labels and satisfies independence | accepted: any non-empty string differing from `prepared_by` passed | principals are role-bound labels from a frozen registry; each tool stamps the principal for the ONE role it implements; no ACTOR appears in two roles; the derivation requires both principals registered under exactly their role and of **distinct actors** | **a human who runs both tools is still one human.** Nothing here authenticates anyone. Only Mikko's approval and git history stand behind the claim that two actors were involved. |
| preparer edits a verified input afterwards | undetectable at the gate | the bundle names the exact `record_id`s it verified; a `record_id` is a content digest, so the binding breaks; `prepared_content_sha256` and `evidence_set_sha256` are sealed and re-checked | an actor who rewrites the document **and** the workflow seal together defeats the seals; the derivation binding still refuses because the bundle's named ids no longer match |
| preparer writes its own bundle verification | nothing prevented it | `WRITE_GRANTS` gives the PREPARER no `BUNDLE_VERIFICATION`, and `add_bundle_verification` refuses a non-VERIFIER principal | as above: role labels, not identities |
| verifier trusts a preparer-supplied digest list | possible: the record had no digest fields at all | the verifier hashes the nine contract-pinned files itself; `add_bundle_verification` accepts no digest map, result, principal pair or record ids from its caller | the verifier trusts its own filesystem; a compromised host defeats it |
| document copied or moved to gain authority | no location law existed | `WORKFLOW.json` records `governed_root` and `session_id`; a load from anywhere else is `SET_LOCATION_MISMATCH` | an actor who edits `WORKFLOW.json` to match the new location defeats the check; the git-tracked bundle and the operator's own root remain the anchor |
| two writers race on one document | no exclusion existed | O_EXCL `LOCK` in the document directory recording the holder's principal and pid, released in a `finally` | single-host only. No distributed locking is claimed, and a killed process leaves a stale lock that an operator must remove. |
| stale document derives current authority | `evaluated_at` bound only observation freshness | the governed derivation entry point refuses a document older than `MAX_OBSERVATION_AGE_S` or more than 60 s in the future | the clock is the host's |

**What v1.12 explicitly does not claim.** No cryptographic identity, no signature, no certificate, no key custody, no
authenticated channel, no protection against an actor with write access to both the document and its workflow state,
and no protection against a compromised host. The goal was controlled operational role separation with an auditable
trail, not identity infrastructure, and the frozen registry is a list of labels a human is accountable for.

## v1.13: the governed evidence-set location

v1.12's persistence row claimed "a document copied or moved to gain authority" was controlled by the self-location
check. Codex's runtime-parity oracle showed the control was hollow: because every authorizing function and both CLIs
accepted a caller-supplied root, an attacker did not need to move a document at all — they could simply *author* one
somewhere else and it derived `ATTACHMENT_READY`. A test convenience on the authorizing surface defeated the law it
was supposed to live under.

| attack | v1.12 | v1.13 control | residual, stated |
|---|---|---|---|
| author a complete workflow under an arbitrary root | **accepted, derived ATTACHMENT_READY** | no authorizing function or CLI takes a root of any name; the resolver takes no argument; the authorizing derivation requires the frozen `authority_root` and `written_under_production_root` | an actor who edits both the document and its workflow state can forge those fields; the location check then still refuses because the directory is not the canonical one |
| author under a **symlinked** root | **accepted, derived ATTACHMENT_READY**: `abspath` was applied and the entry never classified | the root entry is classified by `lstat` before anything is resolved; a symlink is `ROOT_SYMLINK_REFUSED`; `realpath` is consulted only afterwards as an alias check; the module contains no `.resolve()` | a root replaced between the check and the write is not prevented, only detected on the next load — this is not a TOCTOU guarantee for the filesystem beneath the checks |
| symlink the session directory after creation | not checked | `SESSION_SYMLINK_REFUSED` on every authorizing load, including verify and derive | as above |
| relocate a valid document to /tmp, a sibling root or another user path | self-location check only, and reachable roots made it moot | refused `SET_LOCATION_MISMATCH`, and the authorizing derive refuses anything not at the canonical path | an actor with write access to both files can rewrite the recorded location; the canonical-path comparison still refuses |
| traverse out of the governed root through the session id | safe-basename law | unchanged law, now with an explicit 18-shape reject list and 40 seeded property cases | none known |
| use the test override in production | the override *was* the production parameter | scratch roots live in an `INTERNAL_NON_AUTHORIZING` module neither CLI imports, which refuses to sandbox the frozen root and whose documents the authorizing derivation refuses | a developer who edits the authoring module's private `_SANDBOX_ROOT` in a checkout is outside this boundary; git history is the control |

**What v1.13 does not claim.** No protection against an actor with write access to both the evidence-set document and
its workflow state, no TOCTOU guarantee against a root or session directory replaced between a check and a
subsequent write, no protection against a compromised host, and no cryptographic binding of location. The governed
root must be created by an operator as a `0700` directory before anything can be authored; until then the production
path refuses `ROOT_NOT_FOUND`, which is deliberate.

## v1.14: the authorizing location check

v1.13's table above is accurate about the authoring layer and inaccurate about the authority. Codex's independent
harness on v1.13 called `authority_lib.derive_attachment_state()` and `authority_lib.evaluate_eligibility()`
directly — the two functions the v1.13 authority surface itself declared AUTHORIZING — and handed them a sandbox
evidence set the wrapper had just refused with `NOT_PRODUCTION_ROOT`. They returned `ATTACHMENT_READY` and
`eligible: true`. Every control in the v1.13 row was real, and every one of them sat on a layer an attacker did not
have to use. **A defence that only the outer layer performs is not a property of the authority; it is a property of
that layer.**

| attack | v1.13 | v1.14 control | residual, stated |
|---|---|---|---|
| call the authorizing core derivation directly with a forbidden-location evidence set | **accepted, returned ATTACHMENT_READY** | `derive_attachment_state_authorizing` accepts only a `GovernedEvidenceSet` and re-verifies its receipt against the filesystem first; the old function is DIAGNOSTIC / NON_AUTHORIZING and returns no receipt | a caller may still run the diagnostic function; its result carries no receipt and no authorizing flag, and nothing on the authorizing path will accept it |
| call the authorizing eligibility gate directly with the same evidence | **accepted, returned eligible=true** | `evaluate_eligibility_authorizing` is fail-closed: absent or invalid location provenance yields `eligible: false` with reason code `LOCATION_AUTHORITY_INVALID` before any policy work | the diagnostic eligibility remains callable for fixtures and bring-up, and the M3 composed path still consumes it (below) |
| bootstrap eligibility from a precomputed attachment state | a caller-computed state was accepted as an input | there is no state parameter anywhere on the authorizing surface; the state is recomputed inside the gate from the governed document | none known for M0A |
| fabricate the provenance object | nothing to fabricate — a bare dict was enough | `GovernedEvidenceSet.__init__` refuses without a module-private token, the class has `__slots__` and no instance dict, and every authorizing entry point re-derives the receipt rather than trusting the field | an attacker who can edit the loaded module in place is outside this boundary; git history is the control |
| replay a previously valid provenance object | not applicable | the receipt is recomputed on every authorizing call from the live document digest, the canonical path, the frozen root, the authority version and the active manifest, so a document changed underneath a held object is refused | possession of the object plus the ability to restore the exact prior bytes is indistinguishable from the honest case, by design |
| reach an authorizing answer through the testkit | the testkit's document was refused by the wrapper only | the testkit reaches the diagnostic derivation only; its document cannot construct a `GovernedEvidenceSet`, because the core resolver has no override of any kind | as v1.13: a developer editing the private sandbox field in a checkout is outside this boundary |
| relocate identical bytes and re-derive | the wrapper compared paths | a relocation cannot be expressed against the core at all: the loader takes only a session id and derives the path itself | none known |

**The one honest residual in v1.14.** The diagnostic `evaluate_eligibility` is still called inside the core by
`semantic_mutation_plan`, which is declared INTERNAL_NON_AUTHORIZING and is reached only from
`validate_transaction_set`, the M3 composed path. That path is `PROVISIONAL_UNTIL_M3` and cannot yield M0A probe
eligibility: it refuses without a mutation plan and a complete `S0_REQUIRED_PROFILE` snapshot, neither of which an M0
read primitive has, and the M0A probe request is not a mutation plan. Pre-M3 transaction authority is deliberately
outside v1.14's scope, so the plan-time eligibility call is **recorded here as a scoped residual and left for the
milestone that actually freezes write authority**, rather than being rewritten under a correction that is meant to be
narrow.

**What v1.14 does not claim.** It does not claim a cryptographic location proof: the location receipt is a digest
over facts the core reads from the filesystem, so it binds a decision to a place, and forging it would require making
those facts true. It does not claim a TOCTOU guarantee — a directory replaced between the receipt and a later read is
detected on the next authorizing call, not prevented. It does not claim protection against an actor with write access
to the bundle's own code, against a compromised host, or against an operator who authors and verifies as one human
(the v1.12 residual stands: a human who runs both tools is still one human). And it does not claim that the
diagnostic functions are unreachable — only that they are not authority, which the authority surface now states in
machine form.
