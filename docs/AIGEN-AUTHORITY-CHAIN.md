# AIGEN content authority

The AIGEN package lane treats the approved final script as structural authority. Derived files are usable only when `authority-chain.json` binds their exact bytes to the current upstream bytes. File existence, timestamps, counts, and paths are not authority.

The chain is:

`script/script-final.md` → `image-prompts.json` → `selected-images.json` plus selected image bytes → `video-prompts.json` → per-slot rendered video bytes → `resolve-handoff/media-manifest.json`

Controlled Cockpit writes record each transition. Replacing the final script, prompt set, selection, I2V prompt set, or clip invalidates downstream authority without deleting the old evidence. FLUX and PRESTO dispatches refuse stale or unbound inputs before service probing or process spawn. Resolve handoff creation refuses clips that are not bound to the current selection and I2V prompt authority.

## Inspect a package

Inspection is read-only:

```sh
node scripts/aigen-authority-chain.js inspect --package PACKAGE_ID --json
```

`first_invalid` identifies the earliest unbound, stale, corrupt, or missing stage. Cockpit’s project-state API exposes the same condition in `state.authority` and blocks the next task.

## Legacy package recovery

A package created before this contract is deliberately `unbound`; it is not silently grandfathered in. Review the current final script, prompts, selected images, I2V prompts, rendered clips, and Resolve handoff first. If they are one coherent chain, bind only through the stage actually reviewed:

```sh
node scripts/aigen-authority-chain.js bind-current \
  --package PACKAGE_ID \
  --through resolve_handoff \
  --confirm-current-chain \
  --json
```

If the handoff does not record `video_variant`, also pass `--video-variant NAME`.

`bind-current` writes only `authority-chain.json`. It does not render, queue, stage, replace, delete, publish, call an external service, or change project status. The confirmation flag is an operator approval gate, not a convenience switch: never use it merely to clear a blocker.

Binding through several stages is transactional for the ledger. If any requested stage cannot be proven, the command restores the pre-command `authority-chain.json` byte-for-byte (or removes the newly created ledger) and returns an error.

## Corrupt ledger recovery

Malformed `authority-chain.json` fails closed and is never normalized to an empty ledger or overwritten by a controlled writer. Preserve the corrupt file as incident evidence, compare it with a trusted backup, and repair it explicitly before any new authority transition. Do not delete it to make the package appear new.
