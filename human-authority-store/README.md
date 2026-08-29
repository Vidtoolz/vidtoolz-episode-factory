# Canonical CURRENT human-authority store

This directory is the repo-pinned default root of the canonical current
human-authority estate consumed by `scripts/creative-director.js`
(`resolveCurrentHumanAuthority`) and written ONLY by the trusted writer
(`recordHumanAuthoritySuccessor`). Deployments may relocate it with the trusted
deployment variable `VIDTOOLZ_HUMAN_AUTHORITY_STORE`; it is never a caller,
task, or API field.

## Layout

```
human-authority-store/
  <subject_id>.head.json        DURABLE current-head declaration (one per subject)
  <subject_id>/                 one directory per project/episode subject
    ha-<version>.json           one append-only, subject-bound record per decision
```

- The SUBJECT is the project/episode identity bound inside the canonical
  Creative Direction: the Script Builder `project_id` for a CANONICAL_STORY,
  the Discovery `canonical_idea_id` for a CANDIDATE_SCRIPT. Callers never name
  an authority id or version — only the direction's own subject locates records.

## Record contract (`vidtoolz.humanAuthorityRecord.v1`)

Each record internally binds the exact subject it governs:
`{ schema, subject_id, authority_id, version, previous_authority_id,
created_at, created_by, human_constraints[], record_digest_sha256 }` — the
digest covers schema, subject, id, version, lineage, provenance, and the full
constraint content. Copying record bytes under another subject's directory is
therefore powerless (`HUMAN_AUTHORITY_SUBJECT_BINDING_MISMATCH`); editing any
field breaks the digest (`CURRENT_HUMAN_AUTHORITY_INTEGRITY`).

## Durable current head (`vidtoolz.humanAuthorityHead.v1`)

`<subject_id>.head.json` declares `{ schema, subject_id, current_authority_id,
current_version, current_record_digest_sha256, previous_authority_id,
updated_at, head_digest_sha256 }`. Readers resolve the DECLARED head only:

- The current head is NEVER computed as "highest version file present".
- Deleting or corrupting the declared head record (or the head declaration, or
  either half of the estate) fails CLOSED — an older record never silently
  regains authority. Deletion of current authority is authority LOSS.
- A subject with NO estate at all (no head declaration and no record
  directory) resolves to an explicit EMPTY head: the store's answer that no
  human decision was ever recorded.

## Writing decisions

Only the trusted writer advances the head, and only in a deployment that
configures `VIDTOOLZ_HUMAN_AUTHORITY_WRITER_IDENTITY` (Mikko's
decision-recording tooling). The writer derives id (`ha-<version>`), version
(strictly head+1), lineage, and digests itself; a caller supplies only the
`human_constraints` content. There is no delete and no path that moves the
head backward.

**Returning to an older policy is a NEW decision:** if Mikko wants constraints
he once had, the writer records a NEW successor restating them (e.g. HA-4 with
HA-1's content). That is new authority — a historical record is never
resurrected by removal of its successors.

Agents treat this estate as durable human state: read-only without explicit
approval.
