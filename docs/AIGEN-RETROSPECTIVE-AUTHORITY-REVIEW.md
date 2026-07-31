# AIGEN retrospective authority review

The retrospective authority review lets an operator make new, explicit,
hash-bound decisions about preserved AIGEN artifacts whose historical approval
cannot be proven. It never claims those decisions happened during the original
production run, never edits legacy evidence, never launches generation, and
never creates `authority-chain.json`.

## Storage boundary

Legacy package evidence remains under:

```text
<aigen-root>/script-packages/<package-id>/
```

Reconstruction state is additive and separate:

```text
<aigen-root>/authority-review/<package-id>/
  workspace.json
  proposed-assignments.json
  decisions.json
```

`workspace.json` freezes the forensic source, warnings, package inventory, and
the exact artifacts presented for review. `proposed-assignments.json` records
proposals, not approvals. `decisions.json` is an append-only, hash-chained
operator-decision ledger.

Malformed or wrong-shaped review state fails closed. The implementation rejects
truncated JSON, null/array/scalar ledgers, bad hashes, duplicate decision IDs,
duplicate active decisions, invalid supersession, unknown decision types, and
mismatched package IDs. It does not replace corrupt state with an empty ledger.

## Decision authority

Every decision records the package, decision and slot identities, artifact
path/hash, upstream identity/hash, outcome, operator identity, timestamp,
retrospective source label, optional note, superseded decision, tool version,
and append-chain hashes. Assignment decisions additionally preserve the exact
script passage identity.

Outcomes are:

- `approved`
- `rejected`
- `requires_rework`

Changing an outcome appends a new decision that explicitly supersedes the
current decision. Existing records are never rewritten.

Currentness is derived when the workspace is read:

- script bytes invalidate all downstream decisions;
- an assignment change invalidates that slot's prompt, image, I2V, clip, and
  handoff decisions;
- prompt changes invalidate image, I2V, clip, and handoff;
- selected-image byte changes invalidate I2V, clip, and handoff;
- I2V-prompt changes invalidate clip and handoff;
- clip changes or slot-order changes invalidate handoff.

An approval is current only while both its artifact and exact upstream hashes
match and its prerequisite approval is current. Rejections and rework decisions
remain visible as decisions; artifact or upstream byte drift still makes them
stale.

## Script passage identity

Assignments use:

- final-script SHA-256;
- UTF-16 code-unit start and end offsets;
- exact selected text;
- selected-text SHA-256;
- communicative purpose.

Offsets are checked against the exact script and cannot split a Unicode
surrogate pair.

## Package-specific safety rules

For the preserved 2026-06-30 AIGEN package:

- slot 21 displays the original and v2 image separately. Reconstructed image
  and I2V authority binds the exact v2 bytes; the legacy source path remains
  visible as stale evidence.
- slot 22 displays the confirmed semantic mismatch. The selected image, I2V
  prompt, and clip cannot be approved until reconstruction occurs in a separate
  operator-authorized workflow.

Nine current slots cannot make the package globally ready while slot 22 remains
invalid. Even if every review decision later becomes current, binding remains a
separate operator-authorized audit and action.

## Operator entry point

Open:

```text
http://127.0.0.1:8010/aigen-authority-review.html?package=<package-id>
```

Enter a real operator identity. Nothing is preselected. Each decision requires
an explicit button press and confirmation. Begin with the current final script,
then review assignments and downstream stages in the displayed order.
