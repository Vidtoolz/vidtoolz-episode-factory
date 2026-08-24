# Manual Edit Recovery V1

Manual Edit Recovery V1 restores the immediately previous trusted artifact revision while an exact task work unit remains HUMAN-owned. It is a pre-resumption recovery mechanism, not Git rollback, arbitrary file restoration, approval, or successor-task reversal.

## Generic control-plane responsibility

The generic layer owns exact run/agent/task/invocation identity, HUMAN-ownership checks, content-addressed revision storage, stack-like latest-edit recovery, preview/apply freshness, atomic restoration, Operator Action Ledger records, ownership revision advancement, and the `human_change_preview` presentation envelope.

The client never selects a file path or supplies restore bytes. A restore source must be the immutable takeover baseline or an applied edit revision linked by the exact operator ledger. Revert remains HUMAN-owned, creates no approval, does not return to automation, and never resurrects a stale approval.

## Specialist responsibility

Each supported specialist supplies its own recovery validator. It decides whether trusted historical bytes still satisfy artifact structure, upstream dependency freshness, lineage, gate consequences, and specialist authority. Generic recovery does not understand Visual Plan fields.

Visual Planning is the reference adapter. It validates the restored Visual Plan and current Story binding without changing the existing `VISUAL_PLAN_SUCCESSOR_V1` return contract or expanding editable fields.

## Human preview contract

`human_change_preview` is presentation metadata over authoritative results. It contains a title, summary, bounded before/after fields, system-managed changes, stale consequences, warnings, a next action, and optional technical details. It contains no hidden reasoning and grants no authority. Typed validator results remain authoritative and inspectable under technical details.
