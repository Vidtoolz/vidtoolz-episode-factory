# Resolve execution subsystem — doctrine amendment v1 (FROZEN_NOW; approved by Mikko 2026-09-08)

## Superseded text (exact, still true outside the opted-in scope)
- `config/gate-mode-policy.json` gate 9 DRAFT boundary: "no Resolve project is created, opened, or controlled"; PRODUCTION blocker: "Resolve automation is deliberately out of scope".
- `docs/draft-assembly.md:379-383, 429`: "Resolve automation is deliberately out of scope … No Resolve project is created, opened, or controlled."
- `scripts/final-production-package.js:447`: `edit_mode: 'MANUAL — this blueprint organises Mikko's Resolve edit; it does not drive automated editing'` (test FPL18).
- Memory `workflow-resolve-handoff-boundary`: systems → Resolve, then wait.

These remain in force for every workflow that has not explicitly opted into the Resolve execution subsystem. The gate policy is NOT edited in this freeze; a versioned gate-policy change is M-later work with its own approval.

## Amendment (normative)
Episode Factory remains the canonical authority for approved production intent, source identities, assets, review decisions and workflow gates. The default workflow continues to stop at "ready for Resolve". An explicitly enabled scope `RESOLVE_QUALIFICATION` MAY project a pinned canonical Directed Draft into an adapter-owned destination timeline in an approved isolated local project library. After the qualification gates in the adjudication contract pass and Mikko records a separate activation decision, scope `DIRECTED_DRAFT_MATERIALIZATION` MAY perform only the allow-listed materialization and revision operations named by a frozen mutation plan. Each Resolve mutation MUST have an explicit target, observed-state preflight, durable intent journal, guarded apply, readback, exact expected-delta verification and recoverable external publication. Unattributed or human changes MUST be preserved and MUST block incompatible writes. No Resolve result or mechanical QC result constitutes human review, final-edit completion, gate approval or publication authority. Existing `vidtoolz.finalResolveBlueprint.v1` artifacts and historical locks remain immutable and `MANUAL`. Shared-library writes, final editorial automation, delivery and publishing remain disabled unless separately authorized under their own qualified scope. **Final creative authority remains with Mikko.**

## Permitted scope (deterministic, per Mikko)
inspection · Directed Draft materialization · controlled revision (canonical review → revision plan → successor) · mechanical QC · deterministic repair where separately qualified · delivery/render where separately qualified.

## Prohibited regardless of scope
editing Mikko's timelines; publishing; library switching (`SetCurrentDatabase`), library upgrade, `CloseProject`, `ImportProject`; any operation outside a frozen plan; `run_script`/`run_script_unsafe`/`execute_python`/`execute_lua` in production; treating any Resolve state or MCP result as approval.

## Gate impact
`READY_FOR_MANUAL_RESOLVE_EDIT` retained. `RESOLVE_MATERIALISED` is an evidence state on the adapter-owned destination, never an approval. Doc authority: this file, registered in `docs/DOC-AUTHORITY.md`; disagreement between this file and code is resolved by the frozen `FREEZE-MANIFEST.json` version, not by silent edit.
