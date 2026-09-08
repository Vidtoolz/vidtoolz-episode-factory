# TARGET-ATTACHMENT-GATE.md (v1.3, FROZEN_NOW)

Schema validity != attachment eligibility. **Attachment state is derived, never declared.** `TARGET-CONTRACT.json` carries no `attachment_state` field (`attachment_state_is_declared: false`; the schema rejects the field). The state is a pure function `derive_attachment_state(target_contract, evidence_set)` in `tools/authority_lib.py` over content-addressed evidence records (`schemas/resolveEvidenceSet.schema.json`). Required records per state (`TARGET-CONTRACT.json.attachment_states`):

| State | Proven by | Permits |
|---|---|---|
| `UNPROVISIONED` | no valid `PROVISIONING_RECORD` for the contract host+library (record must have `library_kind: Disk`, absolute traversal-free `root_path`, UUID `instance_uuid`, `provisioned_by`); or the contract library name is prohibited | nothing |
| `PROVISIONED_NOT_VERIFIED` | valid `PROVISIONING_RECORD`; launch recipe or bundle verification missing/invalid | nothing |
| `ATTACHMENT_READY` | + `LAUNCH_RECIPE` for the host with `recipe_sha256`, `resolve_version == 21.1.0.0014`, `resolve_binary_sha256 == TARGET-CONTRACT pin of /opt/resolve/bin/resolve`, `external_scripting_preference: Local`; + `BUNDLE_VERIFICATION` with `authority_version 1.3.0`, `manifest_sha256`, `verifier != prepared_by` | M0 `READ_PRIMITIVE_QUALIFICATION_PROBE` (SESSION scope) |
| `ATTACHED_READ_ONLY` | + latest `CONNECTION_OBSERVATION` for the host: `db_type Disk`, `db_name == contract library` (never a prohibited name), `product`/`resolve_version` equal to the contract, `root_path` equal to the provisioning root. Any mismatch keeps `ATTACHMENT_READY` and records `OBSERVED_TARGET_MISMATCH` (which also fails `LIBRARY_MATCHES_CONTRACT`) | all M0–M2 read operations (subject to their target requirement and primitive qualification); `SetCurrentTimeline` (M2+) |
| `SCRATCH_WRITE_READY` | + `M3_AUTHORIZATION` (scope `SCRATCH_QUALIFICATION_LIBRARY`, approver, authority 1.3.0), `EXCLUSIVE_SESSION_ATTESTATION`, `REFREEZE_RECORD` (`kind M0_READ_REQUALIFICATION`, `reviewed: true`) | M3 mutation entries only |

Rules: `accepts_current_open_session_as_target` is `false`; a valid target never means "whatever session is open". The intended target is the contract; the actual target is the connection observation; the two are compared mechanically. The qualification library UUID and root path exist only in a provisioning record (required future observation), never in the contract, never fabricated. `.dblist`/`.activedb` are never copied. No shared or production scope exists.

Project and timeline are **not** attachment state: they are operation-level target requirements (`ELIGIBILITY.md`) proven by `PROJECT_BINDING_OBSERVATION` / `TIMELINE_BINDING_OBSERVATION` records for the expected names; write-capable operations additionally need `OBSERVED` unique ids in those records.

Fixtures: `fixtures/evidence/*.json` (empty, provisioned-only, provisioned-bad-uuid, ready, ready-wrong-binary-pin, ready-self-verified-bundle, ready-bundle-verified-for-v1.2-only, attached, attached-eka-observed, attached-local-database-observed, attached-version-mismatch, attached-wrong-host, attached-tampered-record, write-ready-*). Validator section `attachment-derived` pins the derived state of each.
