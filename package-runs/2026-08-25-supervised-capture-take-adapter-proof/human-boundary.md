# The human boundary

Everything a machine can do before a presenter performance now happens, and it
stops in exactly the right place.

```
PRODUCTION run declared
  -> script bound, recording units built        machine
  -> capture destination + profile verified     machine
  -> supervised capture tooling verified        machine
  -> READY_FOR_HUMAN_PERFORMANCE                machine  <-- stops here
  -------------------------------------------------------------------
  -> Mikko records the real presenter take      HUMAN — nothing else can do this
  -------------------------------------------------------------------
  -> capture bytes verified                     machine
  -> take registered, exact identity bound      machine
  -> presenter source becomes canonical         machine
  -> REAL_PRESENTER_AUDIO_MISSING clears        machine
  -> next blocker: EDIT_PLAN_MISSING            machine
```

`READY_FOR_HUMAN_PERFORMANCE` means the machine is ready and **nothing has been
recorded**: `media_recorded: false`, `takes_registered: 0`. It must never read as
capture complete, and the tests assert it cannot.

## Four acts, kept separate

| Act | Owner | Where |
|---|---|---|
| Verification | capture subsystem | `supervised-capture.js` — are these bytes a valid recording? |
| **Registration** | capture subsystem (deterministic) | **the adapter — is this recording a take of this unit, in this run?** |
| Selection | a verified human (Mikko) | `createHumanSelection`; agents are refused |
| Approval | the lifecycle gates | unchanged |

The adapter performs exactly one. It registers every valid take and chooses
none — craft judgement belongs to `presenter_director` (still DISABLED pending
Mikko's explicit enablement) and the choice belongs to Mikko.

## What is still outstanding after a take is registered

Registration is not the end of the presenter lane. With a genuine human
selection in place the Editor handoff still reported
`TRANSCRIPT_OR_HUMAN_FIDELITY_REQUIRED` and `FIDELITY_UNRESOLVED`. A take has to
be transcribed and its fidelity resolved before the Editor can use it. The
adapter fabricates none of that.
