# Earth Studio v0.4 acceptance report — 2026-08-07-earth-studio-v04-acceptance

**Verification state: INTERNAL_VERIFIED**

parser/generator/.esp structure verified internally — real Earth Studio import NOT yet observed; camera semantics remain best-effort assumptions

- Planner version: 0.9.3
- Generated at: 2026-08-08T09:18:08.979Z (git 6a48cfc760c7)
- Instruction: `fly to Helsinki in 5 seconds, then fly to Paris at 2 km tilted 35 degrees in 18 seconds, then orbit twice counterclockwise for 36 seconds, then zoom out to space in 12 seconds`
- Aspect: 9:16 (1080x1920) · 2130 frames @ 30 fps
- .esp sha256: `7754a178b63c60a9f7ccdf3c5313200501a0ac6463016b850fe628da667c3e41`

## Gates
- Internal semantic checks: PASS (33 assertions)
- Real Earth Studio import observation: PENDING — the one manual browser step (see import-checklist.md)
- Real frame export validated: PENDING
- Production frames→MP4 render: PENDING
- Evidence hashes: not written

Internal green is NOT external proof: only the real Earth Studio import
observation and real exported frames advance the state past INTERNAL_VERIFIED.

_Report regenerated 2026-08-10T05:31:05.847Z by scripts/earth-studio-v04-acceptance.js status._
