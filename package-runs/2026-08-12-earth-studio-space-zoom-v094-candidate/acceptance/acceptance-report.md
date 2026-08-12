# Earth Studio v0.4 acceptance report — 2026-08-07-earth-studio-v04-acceptance

**Verification state: EARTH_STUDIO_IMPORT_VERIFIED**

real frame export not validated; production render not run

- Planner version: 0.9.4
- Generated at: 2026-08-12T03:42:20.516Z (git 1f04979ef9c4)
- Instruction: `fly to Helsinki in 5 seconds, then fly to Paris at 2 km tilted 35 degrees in 18 seconds, then orbit twice counterclockwise for 36 seconds, then zoom out to space in 12 seconds`
- Aspect: 9:16 (1080x1920) · 2130 frames @ 30 fps
- .esp sha256: `d732a6169edacbfbf6129740c4007478ba5131f74c91713658926255604c4bf6`

## Gates
- Internal semantic checks: PASS (33 assertions)
- Real Earth Studio import observation: ACCEPTED
- Real frame export validated: PENDING
- Production frames→MP4 render: PENDING
- Evidence hashes: VERIFIED

Internal green is NOT external proof: only the real Earth Studio import
observation and real exported frames advance the state past INTERNAL_VERIFIED.

_Report regenerated 2026-08-12T03:52:07.478Z by scripts/earth-studio-v04-acceptance.js status._
