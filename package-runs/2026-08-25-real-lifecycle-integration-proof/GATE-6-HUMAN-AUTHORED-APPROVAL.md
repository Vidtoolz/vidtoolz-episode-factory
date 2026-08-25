# Gate 6 Planning Provenance Modes

How `shot-edit-plan-review` decides whether a human approval is real.

## The rule

The security rule was never "planning must come from an agent". It is:

> Mikko's approval must always be bound to exactly what Mikko reviewed.

Which artifact carries that binding depends on who authored the plan. Both modes
are equally strict; neither accepts a bare marker.

## What went wrong before, twice

**Round one.** A line reading `Shot/edit plan approval: PASS` anywhere in a
planning artifact completed the gate. Approve plan r1, change the plan, and the
gate still passed over content nobody reviewed.

**Round two.** Binding every approval to a visual-plan digest fixed that, and
took a legitimate capability with it: a planning package Mikko wrote by hand has
no plan digest, so it could not be approved at all. Two pre-existing tests
encoded that capability and had to be rewritten to assert the refusal.

This restores the capability without restoring the hole.

## The two modes

| | AGENT_GENERATED | HUMAN_AUTHORED |
| --- | --- | --- |
| declared by | `visual-plan-materialization.json` | `human-planning-approval.json` |
| authority basis | `visual-plan.json` | the five governed artifacts themselves |
| approval binds to | the visual-plan digest | a deterministic snapshot digest |
| marker field | `Approved plan digest: <sha256>` | `Approved planning snapshot: <sha256>` |
| artifacts verified by | re-deriving them from the plan | re-hashing them from disk |

The marker fields are deliberately different names. A plan digest can never
satisfy the human path and a snapshot digest can never satisfy the agent path —
tested in both directions.

## Mode is declared, never inferred

```
both declared, no recorded supersession  -> PLANNING_AUTHORITY_AMBIGUOUS
agent declared                           -> AGENT_GENERATED
human declared (active record)           -> HUMAN_AUTHORED
neither declared                         -> APPROVED_PLAN_DIGEST_UNKNOWN
```

The presence of a `visual-plan.json` never flips a package that declared human
authorship, and its absence never declares human authorship. There is no branch
anywhere that reads "a marker exists, therefore PASS".

## The human snapshot

`buildHumanPlanningApprovalSnapshot(runDir)` digests, in this fixed order:

```
snapshot schema
gate id
run id
shot-list.md:<machine_sha256>
screen-capture-list.md:<machine_sha256>
demo-list.md:<machine_sha256>
b-roll-list.md:<machine_sha256>
graphics-list.md:<machine_sha256>
```

Governed: exactly those five files. Ordering is fixed by the governed list, not
by a directory listing. Excluded: modification times, generation timestamps, the
sanctioned human-notes region, and every file outside the governed set — so an
unrelated file, or a later `takes-log.md`, cannot move the digest.

`machine_sha256` covers the machine-owned body only. That is what keeps a note
added after approval from reading as tampering, exactly as on the agent path. It
also means the notes region cannot be used to smuggle governed content: the
digest simply does not see it.

## Preparing a review is not approving it

```
node scripts/package-run-human-planning-approval.js package-runs/<run>
```

Writes the record with `approval: null` and prints the digest. It says "this is
the content currently awaiting review". Only Mikko's marker completes the gate:

```
Shot/edit plan approval: PASS
- Approved planning snapshot: <digest printed above>
```

Any of the three existing verdict phrasings works (`Manual approval`,
`Production planning approval`, `Shot/edit plan approval`).

## Switching authority — explicit in both directions

**Agent → human:** `--supersede-agent`. The record notes what it took over. The
agent approval does **not** transfer; the gate returns to
`READY FOR HUMAN APPROVAL` until Mikko approves the manual set.

**Human → agent:** `--retire`. Materializing an agent plan into a run with an
active human record is refused (`PLANNING_AUTHORITY_AMBIGUOUS`) — and
`replaceApproved` is deliberately not an escape, because it permits replacing an
approved *plan*, not seizing authority from the human path. After retirement the
agent path governs again and needs its own bound approval.

The retired record is kept as evidence of what was once reviewed, but it stops
governing. Without that, releasing authority would leave a human approval quietly
covering machine-generated content — a real defect found and fixed during this
work.

## Reason codes

| code | verdict | who acts |
| --- | --- | --- |
| `APPROVED_PLAN_SUPERSEDED` | READY FOR HUMAN APPROVAL | Mikko re-approves |
| `APPROVED_PLAN_DIGEST_UNKNOWN` | READY FOR HUMAN APPROVAL | Mikko approves with a binding |
| `APPROVED_PLAN_ARTIFACT_DRIFT` | NEEDS WORK | re-materialize |
| `APPROVED_PLAN_MATERIALIZATION_DRIFT` | NEEDS WORK | repair provenance |
| `HUMAN_PLAN_APPROVAL_SUPERSEDED` | READY FOR HUMAN APPROVAL | Mikko re-approves |
| `HUMAN_PLAN_APPROVAL_DIGEST_UNKNOWN` | READY FOR HUMAN APPROVAL | Mikko approves with a binding |
| `HUMAN_PLAN_ARTIFACT_DRIFT` | NEEDS WORK | re-record the snapshot |
| `PLANNING_AUTHORITY_AMBIGUOUS` | NEEDS WORK | decide who owns the plan |

Codes split by who must act: a missing or outdated human decision goes back to
the human; inconsistent machine state is repaired first.

## Quality bar is identical in both modes

Human-authored does not mean lower quality. The same ladder applies — no TODO
scaffolding, concrete content, no open blocker rows, valid deliberate-none
semantics, all required files present. Binding is orthogonal to quality: a
beautifully bound approval over placeholder artifacts is still `NEEDS WORK`.

## Regression

Changing approved content reopens the gate in **both** modes. The 14-gate engine
recomputes completion from evidence, so gate 6 un-completes, the run returns from
`capture-checklist` to `shot-edit-plan-review` at 5/14, and package-run-state,
tracker and control room follow with no drift.

## The invariant

Every gate-6 `PASS` carries either a valid plan-digest binding or a valid
human-snapshot binding. There is no third path, and no marker-only path.

## Status

The retained canary remains `AGENT_GENERATED`, approved, and at gate 7. The
human-authored path is proven in isolated fixtures labelled `TEST_ONLY`; no real
Mikko verdict was fabricated for any of them.
