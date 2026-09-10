# CHANGELOG — Resolve authority bundle v1.15 (narrowly scoped correction of Codex's six v1.14 release findings)

- **Parent:** v1.14.0, branch `docs/resolve-authority-freeze-v1.14` @ `b61f248238ec7ed60deca79aa9728ec0cde86edd`, manifest `0d4fc9915923d17ef6ec469cc01fb164b4d2ee1001fc7983d557bf4c9d9032b8`. Grandparent v1.13.0 @ `65895c6dedceadff012a08c1bafcdf9e92b65221`, manifest `436e12c8616ea6704fef2dbd0e14517cf33092aec1a7ff064dd4b10fb3dad573`.
- **This version:** 1.15.0, directory `docs/resolve-integration/v1.15/`, own `FREEZE-MANIFEST.json`.
- **Input of record:** Codex's v1.14 forensic adjudication and its blocking-findings extraction — **four BLOCKERs (`V114-B1`…`V114-B4`), one MERGE MAJOR (`V114-M1`), one MINOR (`V114-N1`)**, authority completeness `WORKFLOW_CONTRADICTORY`. Hermes's root-existence sensitivity was classified `REVIEW_ENVIRONMENT_EFFECT`, not a defect.
- **Scope discipline:** those six findings and their direct consequences only. The v1.12 workflow architecture, the v1.13 governed-root law, Store.v5, the role model, A2V, the lifecycle, the record constructors, BUNDLE semantics, the checked-file law, writer locking, H0, the commit stage architecture, the schema-registry architecture, the trusted shim, raw ingestion, the exact stored chain, precedence, the capability matrix, M0B/M0C/M0D and unrelated pre-M3 transaction design are all untouched. `tools/evidence_store.py` differs from v1.14 by **exactly one comment line** (the validator's filename, carried by the tool rename). No Resolve launched or contacted; no `EKA`; no A1/A2/A2V/A3 executed; no merge; v1.0–v1.14 bytes untouched; unrelated production and Earth Studio code untouched.

## The one law v1.15 installs

> **THE EXACT BYTES VALIDATED AS GOVERNED EVIDENCE ARE THE EXACT BYTES CONSUMED BY AUTHORIZING DERIVATION.**

Everything below is that sentence applied to the four places v1.14 left it unenforced.

## V114-B1 — validation applied to bytes, authorization consumed an object

v1.14's carrier stored the parsed evidence set in an ordinary writable slot. The live-provenance check reopened and
hashed the canonical `EVIDENCE-SET.json` against the recorded digest — and then the authorizing derivation consumed
`governed.evidence_set`, with nothing binding that object to the bytes just checked.

Reproduced against the frozen v1.14 bundle at `b61f2482`, in its sharpest form: author two governed sessions, A
fully verified (`ATTACHMENT_READY`) and B prepared only (`PROVISIONED_NOT_VERIFIED`); load B; assign A's evidence
set to B's carrier; derive.

```
governed_provenance_errors(B)         ->  []                       (receipt, digest and live file all valid)
derive_attachment_state_authorizing   ->  ATTACHMENT_READY  authorizing=true
    session_id reported: A            document_path: B's canonical path        receipt: B's own
```

A **false `ATTACHMENT_READY` under valid governed provenance**, for a document whose real state was
`PROVISIONED_NOT_VERIFIED`. The tell — an A-shaped `session_id` beside a B-shaped `document_path` — is now
impossible.

**The correction.** The carrier holds the validated **bytes** and no parsed object:

- `__slots__` no longer contains `evidence_set`; it contains `document_bytes` plus ten provenance fields.
- The carrier is **frozen**: `__setattr__` and `__delattr__` refuse with `GOVERNED_EVIDENCE_INVALID`.
- `evidence_set` is a read-only **property** that strict-parses `document_bytes` afresh on every access and returns
  a new object, so mutating what a caller received changes nothing any authorizing path will ever see.
- `__copy__`, `__deepcopy__` and `__reduce__` refuse: provenance cannot be cloned out of the loader.
- `evidence_snapshot_digest(es)` — a new registered domain `vidtoolz.resolveEvidenceSetSnapshot.v1` — is the
  canonical digest of the **parsed** content, recorded on the carrier and bound into the location receipt.

And there is now exactly one way to obtain semantic evidence on an authorizing path,
`authority_lib.governed_consume(governed, active)`, which on **every** call: validates the carrier structurally;
revalidates the whole live location; re-reads **both** authority files no-follow; requires the live digests to equal
the minted ones **and** the carrier's own bytes to digest identically; strict-parses those exact bytes;
schema-validates the parse; requires its snapshot digest to equal the one bound into the receipt; re-checks the
self-location, production-root and sealed-digest claims; recomputes the receipt — and **returns** the semantic
object. The authorizing entry points consume that return value. `governed.evidence_set` appears in none of them.

## V114-B2 — diagnostic eligibility reached commit authority

`commit_eligibility` and `validate_transaction_set` were on v1.14's authorizing surface while still consuming a bare
evidence dict. Codex's reproduction, re-run here and pinned as a control: the complete
`linked-set-committed-consistent` fixture supplied as a raw dict completes all twelve stages and returns
`eligible: true`. v1.14 had recorded that path as a *residual*; Codex was right that it is a BLOCKER, because the
final decision it produces is a commit decision.

**The correction**, without reopening commit architecture:

| function | v1.14 | v1.15 |
|---|---|---|
| `validate_transaction_set_authorizing(ts, …, governed, active)` | — | **AUTHORIZING**; requires a `GovernedEvidenceSet`, consumes the bytes-bound snapshot, refuses `GOVERNED_EVIDENCE_REQUIRED` before any stage |
| `commit_eligibility_authorizing(ts, …, governed, active)` | — | **THE ONE authorizing commit path**; returns `authorizing` and the location receipt beside `eligible` |
| `validate_transaction_set`, `commit_eligibility` | AUTHORIZING | **PROVISIONAL_UNTIL_M3 / NON-AUTHORIZING** — a fourth surface class, `provisional_until_m3_non_authorizing`. Behaviour unchanged; every inherited transaction regression still runs against them |
| `semantic_mutation_plan` | called the diagnostic eligibility | still `INTERNAL_NON_AUTHORIZING`, but chooses its eligibility law **by type**: governed carrier → `evaluate_eligibility_authorizing`, bare dict → the diagnostic gate. Never a caller-supplied callback, which would be the C16-B2 defect class |

The twelve stages, their order, the internally pinned schemas, S0/S1, journal, delta, effects, verification,
conflicts and H0 are unchanged. v1.15 adds a provenance gate **in front of** them and changes no stage law — asserted
by a test that runs both validators over the same legitimate governed carrier and requires **identical** stage
errors.

## V114-B3 — the active authority still named the demoted functions

v1.14 demoted two functions in code and left four current artifacts pointing at them: `TARGET-CONTRACT.json`
(`attachment_derivation`), `PERMISSIONS.json` (the eligibility law), `TARGET-ATTACHMENT-GATE.md` and
`ELIGIBILITY.md`. A consumer following the active contract selected the diagnostic function and recreated raw
evidence consumption. Codex declined to pick a winner between two mutually current artifacts and treated the
contradiction itself as blocking — correctly.

**The correction.** All four now designate the authorizing entry points; the diagnostic pair appears only *as*
diagnostic, and in `TARGET-CONTRACT.json` in its own field
(`attachment_derivation_diagnostic_non_authorizing`), pinned by the schema so the classification cannot drift back.
`AUTHORITY-PRECEDENCE.json` carries a blanket clause: where an earlier statement names one of the four bare-evidence
functions as the authority of its era, that name now reads as its authorizing counterpart. A static audit scans
**every current artifact**, machine and prose — 50+ documents, not the four Codex happened to find — and requires
that no current artifact names a demoted function except explicitly as demoted.

## V114-B4 — `WORKFLOW.json` was authority-bearing and unprotected

The root, the session directory and `EVIDENCE-SET.json` were all lstat-classified. `WORKFLOW.json` — which carries
the session identity, the governed root, the production-root claim, the lifecycle state and the digest sealed at
`VERIFIED`, all of which participate in provenance minting — was checked for existence and then opened through
`strict_load`. Reproduced against v1.14: a symlink to a foreign file **outside** the governed root was followed and
the loader minted a `GovernedEvidenceSet` from it. Two further consequences the report did not name, found here: a
**FIFO at that path blocked the authority forever**, and a **directory raised a raw `IsADirectoryError`**.

**The correction.** One authority-file law, `governed_file_errors` + `read_governed_file`, applied to **both** files
by both the core and the authoring wrapper: lstat the entry first; refuse a symlink (`*_SYMLINK_REFUSED`); require a
regular file (`*_NOT_A_REGULAR_FILE`, so a FIFO, socket, device or directory is never opened); check the alias; then
open with `O_NOFOLLOW | O_NONBLOCK` and re-verify the **open file** by `fstat` for device and inode, so an entry
swapped between check and open is refused. `WORKFLOW.json`'s bytes are digested, bound into the location receipt, and
re-checked on every authorizing call, so a post-handoff replacement is caught. The wrapper's `_load` was corrected
too: a defence the core performs and the wrapper does not is the same asymmetry, mirrored.

## V114-M1 — a malformed carrier leaked a raw exception

`object.__new__(GovernedEvidenceSet)` passes `isinstance` with no slots set; v1.14's provenance check dereferenced
`.session_id` and leaked `AttributeError` out of both public authorizing boundaries. **The correction:**
`governed_structure_errors` validates the type and every field with defaults **before** any dereference, and runs
first inside `governed_consume`. `object.__new__`, a subclass, missing slots, `None` slots, wrong-typed slots, a
malformed receipt, and copy/deepcopy/pickle attempts all fail closed as `GOVERNED_EVIDENCE_INVALID` at all three
public authorizing boundaries. Only malformed **authority input** is normalised: a genuine programming error — a
wrong-arity call, an unserialisable value — still raises, preserving the v1.10 distinction, and that is asserted.

## V114-N1 — the closed hash-domain list was not closed

`CANONICALIZATION.md` omitted `vidtoolz.resolveLocationReceipt.v1`. Checking exhaustively rather than only the named
omission found the gap was wider: two evidence-store domains were recorded at superseded versions and five more were
absent, while the document claimed a closed list. **The correction:** the list now names every registered domain,
including the new snapshot domain, with what each binds — and section `hash-domain-parity` compares it with
`authority_lib.HASH_DOMAINS` **exactly, in both directions**, so the omission cannot recur.

## The reviewer-environment effect (not an authority change)

Hermes created the frozen governed root between two validation runs, so v1.14's positive control — which ran only
when the root was absent — silently skipped, and root-absence assertions failed. Codex classified this
`REVIEW_ENVIRONMENT_EFFECT`. **Production authority is unchanged: the root is still not configurable and the
resolver still takes no argument.** What changed is how the suite obtains a session:
`evidence_authoring_testkit.governed_selftest_session(name)` (INTERNAL_NON_AUTHORIZING) creates and removes the whole
tree when the root is absent, and creates and removes exactly one uniquely named session directory when it is
present — refusing to adopt an existing one, and asserting on exit that it removed its own and nobody else's. Two
inherited root-law assertions were restated so they hold in both environments.

## New names and refusal codes

`EVIDENCE_SNAPSHOT_DOMAIN`, `evidence_snapshot_digest()`, `canonical_workflow_path()`, `governed_file_errors()`,
`read_governed_file()`, `governed_structure_errors()`, `governed_consume()`, `_governed_document_claims()`,
`validate_transaction_set_authorizing()`, `commit_eligibility_authorizing()`, and the carrier's
`document_bytes` / `workflow_path` / `workflow_sha256` / `evidence_snapshot_digest` fields.

Added to the frozen `LOCATION_ERRORS`: `WORKFLOW_NOT_FOUND`, `WORKFLOW_SYMLINK_REFUSED`,
`WORKFLOW_NOT_A_REGULAR_FILE`, `WORKFLOW_NOT_AT_CANONICAL_PATH`, `GOVERNED_EVIDENCE_INVALID`,
`GOVERNED_EVIDENCE_REQUIRED`, `EVIDENCE_SNAPSHOT_MISMATCH`. The authoring layer relabels the file codes into its own
vocabulary.

## Preserved, and re-run as regressions

Everything v1.14 got right: the authorizing/diagnostic type separation, the refusal of raw dicts, precomputed states,
lookalike namespaces and wrong types, live receipt revalidation, the no-attachment-state eligibility signature, and
the `LOCATION → ATTACHMENT → ELIGIBILITY` precedence. All of v1.13's root law and all of v1.12's workflow. Store.v5,
cache, schema registry, validator-injection protection, trusted shim, strict ingestion, exact stored chain, receiver
identity, H0, precedence, the capability matrix and M0B/M0C/M0D.

## Version decisions

| identifier | v1.14 | v1.15 | why |
|---|---|---|---|
| `AUTHORITY_VERSION` | `1.14.0` | **`1.15.0`** | the bundle version |
| `AUTHORITY_SURFACE` | 3 keys | **4 keys** | two more functions are demoted; the surface must say so in machine form |
| `HASH_DOMAINS` | 32 | **33** (+ `vidtoolz.resolveEvidenceSetSnapshot.v1`) | a new digest with a new meaning |
| `GovernedEvidenceSet` | writable slots, parsed object | **frozen, byte-bound** | V114-B1 |
| `LOCATION_ERRORS` | 17 | **24** | the seven codes above |
| `resolveEvidenceSet` | `…v1.12` | `…v1.12` (unchanged) | no record shape, body or accepted instance changed |
| `RECORD_TYPE_VERSION` | `"1.10"` | `"1.10"` (unchanged) | envelope law untouched |
| `EVIDENCE_STORE_VERSION` | `…Store.v5` | `…Store.v5` (unchanged) | no semantic change; one comment line differs |
| every other schema `$id` | — | unchanged | only version pin values moved |

## Also changed

- `tools/authority_lib.py` — the byte-bound carrier, `governed_consume`, the authority-file law, the structural
  validator, the authorizing transaction/commit pair, the fourth surface class, and lineage pinned to the v1.14 parent.
- `tools/evidence_authoring.py` — `_load` reads both authority files through the core file law; the file refusal codes.
- `tools/evidence_authoring_testkit.py` — the `governed_selftest_session` seam (INTERNAL_NON_AUTHORIZING).
- `TARGET-CONTRACT.json`, `PERMISSIONS.json`, `TARGET-ATTACHMENT-GATE.md`, `ELIGIBILITY.md` — V114-B3.
- `CANONICALIZATION.md` — V114-N1.
- `EVIDENCE-SET-WORKFLOW.json` — the consumed-evidence, authority-file, malformed-carrier and transaction laws.
- `M0A-BINDING-VALUES.json` — 10 new bindings (112 total) and the v1.15 package requirement.
- `FINDING-RESOLUTION-MATRIX-v1.15.json` / `.md`, `AUTHORITY-PRECEDENCE.json` / `.md` (S62), `THREAT-MODEL.md`.

## What this does not do

Nothing here authorizes a run. `SCHEMA-VALID != AUTHORIZED TO MUTATE`. The authorizing transaction path has no
positive control yet, because no production path authors M3 write evidence — it is proved fail-closed and proved to
apply the ordinary pre-M3 stage laws once provenance passes, and its first true positive belongs to the milestone
that freezes write evidence. The location receipt is not a cryptographic location proof, none of this is a TOCTOU
guarantee, and an actor with write access to governed evidence, to this bundle's code, or to the running interpreter
is outside the boundary — see `THREAT-MODEL.md`. A2 and A2V each still require Mikko's own explicit approval. v1.15
is a CANDIDATE for independent review.
