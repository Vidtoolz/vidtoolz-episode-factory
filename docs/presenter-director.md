# Presenter Director — ENABLED

Presenter Director exists to make the human performance better prepared, not to
replace it. Enabled 2026-08-25 by explicit authorization from Mikko, recorded in
`governance/presenter-director-enablement.json`.

## Authorized

- prepare the approved script for delivery
- surface existing performance/delivery guidance
- evaluate recording readiness
- direct the supervised presenter-capture session
- register/consume canonical presenter-take information through the proven path
- inspect verified takes
- propose and rank best-take candidates (advisory)
- identify missing or failed takes, and request another take when evidence supports it
- hand verified capture state downstream

## Human-only, and mechanically enforced

| Act | Who |
|---|---|
| The performance | Mikko. No agent, no proxy, no synthesis. |
| Take selection | a verified human via `createHumanSelection` |
| Approval | the lifecycle gates |

`verifierValid` refuses a selector of type `AGENT`, and refuses any agent id
posing as `HUMAN` even when that id is allow-listed. The invariant is asserted
across *every* enabled agent, not just this one: none may call
`createHumanSelection`, and none may construct a `HUMAN` verifier identity.

Presenter Director may say how a line could land better and which take it would
recommend. It may never change the line, decide a factual deviation is
acceptable, or pick the take.

## Actions

`prepare_delivery`, `log_takes`, `evaluate_takes`, `status`. Selection is not in
the surface at all — asking for it returns `RUNNER_ACTION_UNSUPPORTED` before the
module is even loaded.

`prepare_delivery` and `evaluate_takes` call a model; `status` and the preflight
refusals do not. The production-path proof
(`scripts/presenter-director-proof-v2.js`) drives the model-free paths through
the real runner, because a model adapter cannot cross the runner's process
boundary; `tests/presenter-director.test.js` covers the model-bearing paths
in-process with an injected adapter. Neither substitutes for the other.

## READY_FOR_HUMAN_PERFORMANCE is a successful endpoint

```
PRODUCTION run -> machine preparation -> READY_FOR_HUMAN_PERFORMANCE -> STOP
                                          media_recorded: false
                                          takes_registered: 0
                                          next_authority: Mikko
```

This is not a blocker and must never be reported as one. It means everything a
machine can do is done and the only remaining step belongs to a person. The state
is owned by `scripts/production-capture-readiness.js` and consumed — never
restated — by the capture adapter and by this specialist.

## One defect found during enablement

Presenter Director was the only specialist that never emitted
`operational_rationale`. The canonical runner requires one on every REVIEW or
DECISION outcome, so each of its refusals — an unapproved script, a stale Story,
a Research return — was semantically correct and undispatchable. The 91
in-process tests never caught it because they do not run the envelope validator.
It was repaired before the flip, not waived: human authorization does not
override a broken technical prerequisite.
