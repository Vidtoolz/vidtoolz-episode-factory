# QC Director V1

QC Director is the independent production-quality authority in the 12-agent
architecture. It inspects a candidate production artifact together with the
durable evidence produced **about** that artifact, applies the applicable
deterministic and specialist checks, and issues a QC disposition. It detects,
blocks and explains. It never fixes, regenerates, or chooses aesthetics.

Canonical module: `scripts/qc-director.js` (agent id `qc_director`).

## Independence model

The system preserves **creator ≠ validator**. A department does not become its
own final quality authority merely because it emits internal checks.

- Camera Director directs camera work → QC judges the resulting camera evidence.
- Editor edits → QC judges export and edit integrity.
- Generation Supervisor generates → QC judges generation readiness and defects.

QC consumes each department's *durable result*. It never imports or re-runs a
producing module, and never recomputes a producer's work. A task whose
`subject.producing_agent` is `qc_director` is refused at the input boundary
with `QC_INDEPENDENCE_VIOLATION`.

QC does not replace Mikko's creative authority.

## Authority

**QC owns:** independent cross-cutting pass/fail, evidence completeness,
technical and policy conformance, provenance and lineage integrity,
export/delivery validation.

**QC does not own:** repair, regeneration, rewriting, aesthetic selection, or
any part of Mikko's authority. QC never records or implies human approval.

## Input contract

```jsonc
{
  "task_id": "qc-0001",
  "assignment": { "action": "inspect_artifact" },   // or "status"
  "package_run_id": "<run-id>",
  "gate": "rough-cut-review",                        // one of the 14 canonical gates
  "subject": {
    "artifact_id": "...", "artifact_type": "...", "producing_agent": "editor",
    "artifact_path": "...", "artifact_sha256": "...",
    "version_id": "...", "predecessor_version_id": "..."
  },
  "evidence": [{
    "evidence_id": "...",
    "kind": "CAMERA_QUALITY|GENERATION_RESULT|EDIT_QC_HANDOFF|AUDIO_RENDER|STORY_VALIDATION",
    "evidence_class": "DETERMINISTIC|SPECIALIST|HUMAN|UNVERIFIED",
    "produced_by": "...",
    "path": "...", "sha256": "...",                  // or inline "payload"
    "binds_to": { "artifact_id": "...", "artifact_sha256": "...", "version_id": "..." }
  }],
  "required_evidence": ["EDIT_QC_HANDOFF"],
  "human_authority": { /* approval_binding, consumed never authored */ }
}
```

Unknown fields are rejected. Every path must resolve inside the repository and
be a regular file; traversal and absolute escapes are typed input errors.

## Output contract

The result carries `schema_version`, `qc_director_version`, `agent_id`,
`task_id`, `package_run_id`, `gate`, `subject`, `observed` (artifact hash and
size as actually read), `evidence` (per-item binding and summary — raw payloads
are never echoed), `evidence_coverage` (`required` / `satisfied` / `missing`),
`checks`, `blockers`, `defects`, `warnings`, `human_authority`, `disposition`,
`reason`, `next_gate_allowed`, `aesthetic_authority`, `inspected_at`,
`qc_result_digest_sha256`, `events`, `handoff` and `control_room`.

`qc_result_digest_sha256` hashes a canonical body that **excludes** timestamps
and events, so re-running QC over identical immutable inputs yields the same
digest.

## Dispositions

| Disposition | Meaning | Next gate |
| --- | --- | --- |
| `PASS` | all applicable evidence present, bound and clean | allowed |
| `PASS_WITH_WARNINGS` | warnings recorded, no blocking defect | allowed |
| `HUMAN_REVIEW_REQUIRED` | technical gates pass, a human decision is owed | blocked |
| `FAIL` | a hard defect, or a valid human rejection | blocked |
| `BLOCKED` | QC cannot trust what it is looking at | blocked |

Precedence is deterministic: integrity blockers → valid human rejection → hard
defects → missing human authority → warnings → clean.

Attention never escalates to `DECISION`; per registry doctrine QC fails closed
instead.

## Defect model

Each finding is structured, never prose:

```jsonc
{ "code": "...", "severity": "BLOCKER|ERROR|WARNING|INFO", "source": "<department>",
  "artifact_id": "...", "explanation": "...", "evidence_ref": "...",
  "affected_gate": "...", "auto_repairable": false, "human_judgment_required": false }
```

## Evidence authority

QC does not treat all evidence equally:

- **DETERMINISTIC** — schema/hash validators, camera-quality measurements,
  artifact existence and byte identity, lineage checks.
- **SPECIALIST** — a department's own evaluation of its output.
- **HUMAN** — a durable approval binding carrying artifact path, hash, commit,
  approver, timestamp and canonical scope.
- **UNVERIFIED** — claims without durable evidence. These carry no authority.

## Fail-closed rules

QC never fabricates a PASS.

- **No hidden pass.** Absence of a known defect is not proof of quality if the
  required evidence was never produced → `QC_REQUIRED_EVIDENCE_MISSING`.
- **Unbound evidence** that does not name the artifact it describes is refused.
- **Staleness** is decided by artifact hash and version lineage, never by file
  modification time → `QC_EVIDENCE_STALE`.
- **Unsupported schema or evidence kind** blocks rather than being guessed at.
- **Malformed, unreadable or hash-mismatched** artifacts and evidence block.
- **Invalid or stale human authority** blocks; it never degrades to "approved".

## Human-review fence

QC may establish technical validity, artifact integrity, schema validity,
continuity, provenance, required-evidence presence and contract compliance.

QC must never claim something is beautiful, cinematic, funny, emotionally
effective, or tasteful. Those dimensions are declared in
`aesthetic_authority.fenced_dimensions`, `aesthetic_authority.claimed` is
`false` in every disposition, and the owner is recorded as `mikko`.

The camera-quality artifact states its own scope — machine continuity and
serialization checks, explicitly not an aesthetic approval — so a
`PASS_FOR_HUMAN_REVIEW` verdict yields `HUMAN_REVIEW_REQUIRED`, never a gate
promotion. Gates that depend on human creative authority
(`rough-cut-review`, `final-review`, `publication-metadata`) require a valid
approval binding in the matching canonical scope before QC will pass them.

## Mutation safety

QC reads, evaluates and persists a result. It never modifies the artifact it
inspects, the evidence it consumes, or the task it was given. This is asserted
by hash comparison before and after in both the unit suite and the
production-path proof.

## Gate integration

QC uses the authoritative 14-gate model
(`scripts/package-run-workflow-map.js` → `GATE_DEFINITIONS`) exclusively, and
never the legacy 21-stage pipeline tracker. QC needs the gate identities only,
so the list is frozen in the module and a test asserts equality with the
authoritative definitions — drift is a test failure, not a silent divergence.

Only `PASS` and `PASS_WITH_WARNINGS` set `next_gate_allowed`. QC does not
advance state itself; Production Operations owns run-state, and QC reports a
missing run-state authority rather than writing one.

## Routing

- `PASS` / `PASS_WITH_WARNINGS` → `production_operations` to advance the gate.
- `FAIL` → the producing department (remediation owner). QC never repairs.
- `HUMAN_REVIEW_REQUIRED` → `mikko`, named explicitly.
- `BLOCKED` → `production_operations` to restore evidence integrity.

## Invocation

```sh
# canonical production dispatch
node scripts/agent-run.js --agent qc_director --run-id <run-id> --task <qc-task.json>

# direct CLI (same lifecycle gate applies)
node scripts/qc-director.js --task <qc-task.json> [--out result.json]
```

## Proof and dispatch state

Implementation readiness is proven by
`package-runs/2026-08-25-qc-director-proof-v2/` against
`docs/implementation-promotion-criteria.md` (10/10). The proof exercises the
canonical dispatch chain through `scripts/agent-run.js` against an isolated
root whose fixture registry carries `IMPLEMENTATION_PROVEN`; the live registry
is never modified by the proof.

Before promotion, every production path — canonical runner, direct CLI and
operator retry preview — refused with `BLOCKED_IMPLEMENTATION_NOT_PROVEN` even
though the module existed; that baseline is preserved verbatim in
`pre-promotion-dispatch-refusal.json`, because the point it proves is that the
fail-closed registry, not module absence, is what withholds dispatch.

`implementation_state` is now `IMPLEMENTATION_PROVEN`, promoted by Mikko's
explicit human authorization and recorded in
`governance/qc-director-implementation-promotion.json`. That promotion changed
one readiness field and created no approval, aesthetic, publication or takeover
authority. Post-promotion live dispatch through the real production path is
recorded in `post-promotion-live-dispatch.json`.

Camera Director remains `CANDIDATE` and Presenter/Creative Director remain
`DISABLED`; this promotion covers QC Director only.
