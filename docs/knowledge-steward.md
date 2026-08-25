# Knowledge Steward — non-agent proposal role

Knowledge Steward turns production evidence and approved lessons into
structured, reviewable proposals for durable Hermes knowledge. It never mutates
canonical knowledge.

Module: `scripts/knowledge-steward.js`. It is a **library**, not an agent.

## It is not the 13th agent

The canonical production architecture is exactly **12 registered agents**.
Knowledge Steward is a *build-order support role 6*, not agent #6. Any
description calling it "agent #6" is wrong.

`config/agent-contract.json` carries it as a **top-level key, deliberately not
in `role_roster`**, with `is_specialist: false` and `is_heavyweight_agent:
false`. `scripts/agent-contract-validator.js` enforces this from three
directions, and all three are regression-tested:

- registering it in `config/agent-registry.json` is a hard error
  (*"knowledge_steward is a non-specialist contract role and must never be
  registered as an agent"*)
- adding it to `role_roster` breaks `canonical_role_count: 12`
- it sits in `nonAgentRoles` alongside `hermes`

Consequently it has **no `AGENT_ID`, no lifecycle block, no
`implementation_state`, no autonomous dispatch, and no runner CLI entry**. It
cannot be dispatched through `scripts/agent-run.js`, which resolves agents only
from `registry.agents`. This mirrors the other non-agent role library,
`scripts/hermes-escalation.js`.

None of that is a gap to be closed. It is the design.

## Authority: propose, never apply

```
production evidence
  → Knowledge Steward proposal
  → Mikko review
  → sanctioned Hermes-side canonical writer   (does not exist yet)
  → canonical brain
```

This library ends at *proposal ready for human review*.

**It owns:** identifying candidate durable knowledge, classifying authority,
comparing against supplied canonical state, detecting duplicates, conflicts and
supersession, packaging evidence and provenance, binding a human approval, and
rendering an operator-readable review artifact.

**It does not own:** applying anything, research, creative decisions, QC
verdicts, production-state transitions, agent enablement, human approval, or
rewriting history.

## The canonical store stays Hermes-side

Canonical durable knowledge lives in `hermes-organiser/brain/` — a **separate
repository**, whose writer is the Hermes-side / `project-memory-system`
mechanism, and whose README states *"No automatic writes into Hermes
internals."*

This library therefore:

- has **no brain writer** and no filesystem reach outside this repository
- **never reads the brain** either. Canonical state is supplied by the caller as
  an explicit snapshot; without one the proposal records
  `CANONICAL_STATE_UNAVAILABLE_FOR_COMPARISON` and demands stronger human review
  rather than guessing
- creates **no second knowledge store**. Proposals are governance evidence and
  every artifact is stamped `NOT_CANONICAL_KNOWLEDGE`

## Actions

`inspect_candidate`, `create_proposal`, `validate_proposal`, `status`.

There is deliberately **no apply action**, and no `applyKnowledge`,
`writeBrain`, `commitProposal`, hidden CLI flag or environment-variable bypass.
That absence is asserted by test, not merely documented.

## Knowledge classes

| Class | Rule |
| --- | --- |
| `HUMAN_DOCTRINE` | always requires Mikko's explicit approval |
| `AGENT_GOVERNANCE` | reference/documentation only — never mutates registry or contract |
| `RESEARCH_CLAIM` | provenance and sources required |
| `DETERMINISTIC_SYSTEM_FACT` | deterministic proof required |
| `PROJECT_KNOWLEDGE` | durable project fact |
| `HISTORICAL_RECORD` | immutable; superseded, never rewritten |
| `TEMPORARY_RUNTIME_STATE` | `NO_DURABLE_VALUE` — operational state is not knowledge |

Authority classes: `HUMAN_VERDICT`, `DETERMINISTIC_PROOF`,
`SPECIALIST_CONCLUSION`, `UNVERIFIED`. A specialist conclusion never becomes
human doctrine.

## Dispositions

`NO_DURABLE_VALUE`, `PROPOSAL_READY`, `HUMAN_REVIEW_REQUIRED`,
`CONFLICT_REQUIRES_HUMAN_REVIEW`, `POSSIBLE_DUPLICATE_REQUIRES_REVIEW`,
`DUPLICATE_NO_CHANGE`, `APPROVED_AWAITING_CANONICAL_WRITER`, `BLOCKED`.

`APPROVED_AWAITING_CANONICAL_WRITER` is the terminal state of an approved
proposal. Even then `applied` stays `false`: application belongs to the future
Hermes-side writer.

## Comparison is deterministic, never semantic

The steward cannot read meaning and never pretends to.

- **Duplicates** are textual: normalized whitespace and case. An exact match at
  the target reference is `EXACT_DUPLICATE`; the same statement stored under a
  *different* reference is `POSSIBLE_DUPLICATE` for a human to resolve. Semantic
  similarity is never inferred and never auto-merged.
- **Conflicts** are structural, not semantic: `add` targeting a reference that
  already holds a different active statement. The artifact says explicitly that
  the steward *cannot determine whether the statements agree, contradict, or
  supersede* — a human decides, and no winner is chosen.
- **Supersession** references its predecessor, preserves it, and sets
  `rewrites_history: false`.

## Human approval binding

An approval binds the exact `proposal_digest_sha256`, target namespace and
operation. Change the proposal and the approval goes `STALE`. A generic
"Mikko approved knowledge updates" never binds. The substantive digest excludes
`created_at`, so identical inputs yield an identical digest.

Finalized proposals are immutable: re-persisting identical content is
idempotent, and differing content under the same id is refused — make a
revision instead.

## Write safety

Proposals are written atomically under exactly one allowlisted root:
`governance/knowledge-proposals/<proposal_id>/` containing `proposal.json` and
`REVIEW.md`. Proposal ids are id-validated so no traversal or nesting can escape
that root. Source artifacts may only be read from inside this repository and are
hash-verified; a mismatch, an unreadable file or a traversal attempt blocks the
proposal.

## Hermes integration surface

```js
const ks = require('./scripts/knowledge-steward.js');

const proposal = ks.createKnowledgeProposal(
  { candidate, canonical_snapshot, approval },   // snapshot + approval optional
  { repoRoot, now, revision },
);
ks.writeProposal(proposal, { repoRoot });        // governance artifact only
ks.bindApproval(proposal, approval);             // returns a NEW proposal
ks.supportProjection(proposals);                 // support role, not an agent row
```

`createKnowledgeProposal` is pure apart from hash-verifying declared sources. It
has no runtime dependency on Hermes internals.

## Future approved-write bridge — not implemented

A bridge from `APPROVED_AWAITING_CANONICAL_WRITER` to the canonical brain is a
**separate task requiring explicit authority**. It is documented here only so
the boundary is unambiguous. It would require:

- explicit Mikko authorization for cross-repo write access
- binding to the exact `proposal_digest_sha256`, target and operation
- ownership by the **Hermes-side** canonical writer, not by Episode Factory
- an agreed cross-repo path contract
- append/supersede semantics that never rewrite history
- a durable audit record of every applied mutation

Until that exists, an approved proposal simply waits. That is the correct state.
