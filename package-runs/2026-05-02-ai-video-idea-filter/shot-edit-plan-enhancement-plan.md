# Shot/Edit Plan Enhancement Plan

| priority | artifact | issue | suggested repair | reason |
| --- | --- | --- | --- | --- |
| high | production-plan.md | Production approval is blocked upstream. | Keep shoot-readiness as NOT READY TO SHOOT until Mikko explicitly approves production. | Shot/edit planning cannot be accepted while production approval is blocked. |
| high | production-blockers.md | Production blockers must match explicit not-approved evidence. | Keep open blockers for missing Mikko production approval, the prior production-plan conflict, and stale shot/edit acceptance. | Closed blockers would incorrectly imply production readiness. |
| high | shot-edit-plan-review.md | Previous PASS / Stage accepted markers were stale. | Keep Review status BLOCKED and Stage accepted no until production approval is resolved. | Capture evidence intake and shot/edit execution are downstream of production approval. |
