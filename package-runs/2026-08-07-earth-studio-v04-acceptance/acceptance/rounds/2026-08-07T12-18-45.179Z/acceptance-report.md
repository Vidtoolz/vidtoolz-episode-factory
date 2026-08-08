# Earth Studio v0.4 acceptance report — 2026-08-07-earth-studio-v04-acceptance

**Verification state: EARTH_STUDIO_IMPORT_VERIFIED**

real frame export not validated; production render not run; hashes.sha256 not written

- Planner version: 0.6.1
- Generated at: 2026-08-07T12:18:45.179Z (git 2bd6d93694a6)
- Instruction: `fly to Helsinki in 5 seconds, then fly to Paris at 2 km tilted 35 degrees in 18 seconds, then orbit twice counterclockwise for 36 seconds, then zoom out to space in 12 seconds`
- Aspect: 9:16 (1080x1920) · 2130 frames @ 30 fps
- .esp sha256: `fb9d9134d98e5ea844d57291e41dec7bd065b9463341419e21eb995e1fa5be0b`

## Gates
- Internal semantic checks: PASS (31 assertions)
- Real Earth Studio import observation: ACCEPTED
- Real frame export validated: PENDING
- Production frames→MP4 render: PENDING
- Evidence hashes: not written

Internal green is NOT external proof: only the real Earth Studio import
observation and real exported frames advance the state past INTERNAL_VERIFIED.

_Report regenerated 2026-08-07T12:27:57.746Z by scripts/earth-studio-v04-acceptance.js status._
