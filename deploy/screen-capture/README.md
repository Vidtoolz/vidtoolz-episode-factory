# Screen Capture V1 — deployment package (identity-separated trust anchor)

Status: **NOT APPLIED**. This directory is the exact deployment step the Codex
production-readiness audit (2026-09-04) requires before Stage 7 may be activated.
Applying it needs root on `vidnux` and Mikko's explicit authorization. Until it
is applied, the finalizer reports `trust_anchor_class: SAME_AUTHORITY_SOFTWARE_ONLY`
and every asset handoff carries `production_qualified_store: false`.

## What it establishes

| Identity | Role | Must NOT have |
|---|---|---|
| `vidtoolz-capture` | capture worker (adapters, spool, privacy scan, presentation) | sudo, docker group, login shell, broad home write, any write to the evidence store |
| `vidtoolz-evidence` | finalizer (create-once store, signing key, receipts, journald) | browser/desktop/shell authority, any update/delete API |
| `vidtoolz` | Episode Factory requester/consumer | write/delete on protected raw, access to the finalizer key |

Filesystem:

```
/var/lib/vidtoolz-evidence/            0750 vidtoolz-evidence:vidtoolz-evidence-readers   protected raw + manifests + receipts
/var/lib/vidtoolz-evidence/keys/       0700 vidtoolz-evidence                                Ed25519 finalizer key (0600)
/run/vidtoolz-capture/spool/           0700 vidtoolz-capture  (tmpfs)                        transient spool, privacy scan before archival
/var/lib/vidtoolz-capture/profiles/    0700 vidtoolz-capture                                 isolated browser profiles
```

`install.sh` is idempotent, refuses to run without root, creates the users and
directories, generates the key as `vidtoolz-evidence`, installs the hardened
systemd units (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
`PrivateTmp`, `PrivateDevices`, read-only paths, no docker socket) and enables
journald receipts. It does not start captures and does not change
`config/screen-capture-policy.json` (activation stays a reviewed config change).

## Post-deployment verification (independent)

1. `scripts/screen-capture-oracle-conformance.js` executed as `vidtoolz-capture`
   with the production policy pointing at `/var/lib/vidtoolz-evidence`.
2. The same-authority rewrite test (`tests/screen-capture-v1.test.js`,
   "finalizer" case) executed as `vidtoolz-capture`: overwrite/delete/replace/
   alter must fail with `EACCES` **and** `chmod` on store paths must fail
   (different owner) — the check the software-only mode cannot provide.
3. `describeProtection()` must report `IDENTITY_SEPARATED_FINALIZER`.
4. Optional second layer (recommended before long-term reliance): server-side
   VIDNAS snapshots/versioning under a credential `vidtoolz` cannot administer.

## Not covered by this package

Removing `vidtoolz` from the `docker` group (host-root-equivalent bypass) is a
separate administrative decision; see the Codex audit §6.
