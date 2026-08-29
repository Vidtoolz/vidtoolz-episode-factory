# Canonical CURRENT human-authority store

This directory is the repo-pinned default root of the canonical current
human-authority estate consumed by `scripts/creative-director.js`
(`resolveCurrentHumanAuthority`). Deployments may relocate it with the trusted
deployment variable `VIDTOOLZ_HUMAN_AUTHORITY_STORE`; it is never a caller,
task, or API field.

## Layout and head semantics

```
human-authority-store/
  <subject_id>/                 one directory per project/episode subject
    <authority_id>.json         one append-only record per human decision set
```

- The SUBJECT is the project/episode identity bound inside the canonical
  Creative Direction: the Script Builder `project_id` for a CANONICAL_STORY,
  the Discovery `canonical_idea_id` for a CANDIDATE_SCRIPT. Callers never name
  an authority id or version — only the direction's own subject locates records.
- Each record is `{ "authority_id": "<file basename>", "version": <positive
  integer>, "human_constraints": [ ... creative-direction constraint objects ] }`.
- The CURRENT HEAD is the record with the unique highest `version`. A duplicate
  highest version, an unreadable record, an unenforceable constraint, or an
  unresolvable store fails CLOSED (`CURRENT_HUMAN_AUTHORITY_UNAVAILABLE`).
- A subject directory that does not exist (or is empty) resolves to an explicit
  EMPTY head: the store's answer that no human decision has been recorded for
  that subject. That is head resolution, never a fallback.
- Records are append-only history: a newer human decision is a NEW record with
  a higher version, never an edit of an old one.

Mikko records decisions here (or the tooling he approves does). Agents treat
this estate as durable human state: read-only without explicit approval.
