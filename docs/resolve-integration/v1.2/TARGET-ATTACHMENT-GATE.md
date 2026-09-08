# TARGET-ATTACHMENT-GATE.md (v1.2, FROZEN_NOW)

Schema validity != attachment eligibility. A stored `TARGET-CONTRACT.json` may be valid while ineligible for attachment. States and required evidence (`TARGET-CONTRACT.json.attachment_states`, enforced by `semantic_target_contract`):

| State | Required evidence fields (`attachment_evidence`) | Permits |
|---|---|---|
| `UNPROVISIONED` | none; `library.root_path` and `instance_uuid` MUST be null | nothing |
| `PROVISIONED_NOT_VERIFIED` | `library.root_path`, `library.instance_uuid`, `provisioning.record_sha256` | nothing |
| `ATTACHMENT_READY` | + `session.launch_recipe_sha256`, `host.name_matches_contract`, `bundle.independent_verification_sha256` | M0 `READ_PRIMITIVE_QUALIFICATION_PROBE`, `CONNECT` |
| `ATTACHED_READ_ONLY` | + `observed.database_matches_contract`, `observed.database_not_shared`, `observed.resolve_version_matches_contract` (with `observed.database_name/type`, `observed.resolve_version`) | all M0–M2 read operations; `SetCurrentTimeline` (M2+) |
| `SCRATCH_WRITE_READY` | + `authorization.m3_token_sha256`, `session.exclusive_attestation_sha256`, `capabilities.m0_requalification_sha256` | M3 mutation entries only |

Rules: the observed database MUST equal the qualification library name and MUST NOT be a prohibited library (`EKA`, `EKA192.168.50.199`, `nelja`, `Local Database`); `accepts_current_open_session_as_target` is `false`; a valid target can never mean "whatever session is open". M0 read-only attachment does not require any mutation prerequisite. The qualification library UUID and root path are recorded only at provisioning (required future observations), never fabricated.
