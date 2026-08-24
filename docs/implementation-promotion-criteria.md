# Implementation Promotion Criteria — CANDIDATE → IMPLEMENTATION_PROVEN

Authoritative contract for promoting any specialist implementation from proof
candidate to production-dispatchable. Mirrors the registry lifecycle model
(`config/agent-registry.json` → `lifecycle_model`); readiness and doctrine are
distinct, and this document defines the readiness side.

**Proof readiness ≠ promotion.** Satisfying every criterion below produces a
technical recommendation. The flip itself is always Mikko's explicit human
decision and is recorded separately from any proof package.

## Requirements (machine-checkable unless noted)

1. **Side-effect-free import** — `require()` of the module writes nothing,
   executes nothing, and dispatches nothing. Proven by importing under a
   pristine tmp directory and asserting no filesystem writes.
2. **Canonical envelope valid** — every success/block/escalation output,
   including the `control_room` projection, passes
   `scripts/agent-run.js → validateEnvelope()` as executed by the canonical
   runner. Manual key assertions do not substitute.
3. **CANDIDATE refusal proven on every production path** — canonical runner
   resolve, operator retry preview, and direct CLI all refuse with
   `BLOCKED_IMPLEMENTATION_NOT_PROVEN` while `implementation_state = CANDIDATE`.
4. **Production-path canary proven without permanent promotion** — the
   canonical dispatch chain (resolve → readiness → module load → task
   validation → run → envelope validation → result writing → invocation
   completion) executes end-to-end against an **isolated test-root registry**
   whose entry carries `IMPLEMENTATION_PROVEN`. The live production registry
   is not modified at any point, even temporarily.
5. **Authority-negative tests** — adversarial cases: approval metadata
   injection, creative-blocker conversion attempts, self-routing, operator
   action fields, invalid attention, missing rationale, broken control_room
   projection, disabled-role routing. Each must be refused with a typed error.
6. **Real/reachable task cases** — at minimum: INFORMATION status, REVIEW
   network/model endpoint, REVIEW compute/resource lane, DECISION
   human-sensitive storage/recovery, creative out-of-mandate refusal.
   Human-routing cases must assert `next_owner === 'mikko'` explicitly, never
   inferred from attention alone.
7. **Deterministic evidence package** — durable package-run directory binding
   implementation commit, runner/dispatch commit, registry snapshot
   (`CANDIDATE`), case outputs, hashes, reproducibility commands, verdict.
8. **Canonical test registration** — suite registered in `tests/run-tests.js`
   and passing under `./scripts/verify.sh` alongside peer implementations.
9. **No unresolved HIGH/MEDIUM implementation defects** — including envelope,
   rationale, routing, and boundary defects found by audit.
10. **Human promotion decision** — after all of the above, Mikko flips the
    registry field. Agents and Hermes never record or imply this decision.

## Versioning

- v1 — 2026-08-24 — initial criteria (this document), authored alongside the
  Production Operations V2 production-path proof.
