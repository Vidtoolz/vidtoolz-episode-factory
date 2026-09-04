# Failure classification

| Class | Examples | Required behavior |
|---|---|---|
| SPEC_REJECTED | unsafe/ambiguous/unknown CaptureSpec | no source action; typed rejection |
| SOURCE_PREFLIGHT_FAILED | auth, app, repo, machine, session, human activity, Resolve state | no mutation; retry only after new state/authority |
| CAPTURE_FAILED | process/browser/media capture error | no substitute artifact; `FAIL_AND_REPLAN` |
| PRIVACY_BLOCKED | secret/personal-data policy finding | quarantine as policy requires; never hand off |
| INTEGRITY_FAILED | corrupt/missing/hash/path/provenance mismatch | reject and preserve evidence for audit |
| EVIDENCE_INSUFFICIENT | file technically valid but required claim/facts/context absent | Visual Director replan or human escalation |
| QC_BLOCKED | independent evaluator not PASS | no Episode Factory readiness |

Every failure binds the exact CaptureSpec, stage, stable code, detail, `fallback_created:false`, `replan_required:true`, and escalation owner. Silent Blender/UI/terminal/cached-image fallback is critical failure.
