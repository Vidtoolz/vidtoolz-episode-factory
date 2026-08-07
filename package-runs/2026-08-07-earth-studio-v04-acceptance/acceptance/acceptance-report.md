# Earth Studio v0.4 acceptance report — 2026-08-07-earth-studio-v04-acceptance

**Verification state: INTERNAL_VERIFIED**

parser/generator/.esp structure verified internally — real Earth Studio import NOT yet observed; camera semantics remain best-effort assumptions

- Planner version: 0.5.0
- Generated at: 2026-08-07T10:58:28.577Z (git 3938b8c13699)
- Instruction: `fly to Helsinki in 3 seconds, then fly to Paris at 2 km tilted 35 degrees in 5 seconds, then orbit twice counterclockwise for 8 seconds, then zoom out to space in 6 seconds`
- Aspect: 9:16 (1080x1920) · 660 frames @ 30 fps
- .esp sha256: `4502fa863667003dba73087b523a57356d6a9ed7e5fb6b393140b980538aaa5e`

## Gates
- Internal semantic checks: PASS (31 assertions)
- Real Earth Studio import observation: PENDING — the one manual browser step (see import-checklist.md)
- Real frame export validated: PENDING
- Production frames→MP4 render: PENDING
- Evidence hashes: not written

Internal green is NOT external proof: only the real Earth Studio import
observation and real exported frames advance the state past INTERNAL_VERIFIED.

_Report regenerated 2026-08-07T10:58:28.618Z by scripts/earth-studio-v04-acceptance.js status._
