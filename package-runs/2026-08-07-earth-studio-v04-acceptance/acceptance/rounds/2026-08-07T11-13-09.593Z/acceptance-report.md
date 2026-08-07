# Earth Studio v0.4 acceptance report — 2026-08-07-earth-studio-v04-acceptance

**Verification state: INTERNAL_VERIFIED**

parser/generator/.esp structure verified internally — real Earth Studio import NOT yet observed; camera semantics remain best-effort assumptions

- Planner version: 0.6.0
- Generated at: 2026-08-07T11:13:09.593Z (git 8533c9bfeb47)
- Instruction: `fly to Helsinki in 5 seconds, then fly to Paris at 2 km tilted 35 degrees in 18 seconds, then orbit twice counterclockwise for 24 seconds, then zoom out to space in 12 seconds`
- Aspect: 9:16 (1080x1920) · 1770 frames @ 30 fps
- .esp sha256: `ba56fcc92c98c6c05a11315197bc01067cbfa6b68f4a88bab4dc282f9052e27e`

## Gates
- Internal semantic checks: PASS (31 assertions)
- Real Earth Studio import observation: PENDING — the one manual browser step (see import-checklist.md)
- Real frame export validated: PENDING
- Production frames→MP4 render: PENDING
- Evidence hashes: not written

Internal green is NOT external proof: only the real Earth Studio import
observation and real exported frames advance the state past INTERNAL_VERIFIED.

_Report regenerated 2026-08-07T12:09:50.417Z by scripts/earth-studio-v04-acceptance.js status._
