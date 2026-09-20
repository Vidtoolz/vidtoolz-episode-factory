# Qualification gate (v1.18 §A4) and Phase 1 qualification status

Authority (frozen v1.18 @ 5d9dbba7): `ADJUDICATION-FREEZE-CONTRACT.md` §A4 and `TARGET-CONTRACT.json#library/#session/#prohibited_targets`:
qualification host **vidnux**; a **dedicated isolated Resolve session** (separate support/config/cache/log roots, recorded
launch recipe, External Scripting Local); Disk library **`VIDTOOLZ Resolve Qualification v1`** (never `EKA`, `nelja`,
`Local Database`, never PostgreSQL); `accepts_current_open_session_as_target: false`; the adapter MUST refuse when
`GetCurrentDatabase()` is not the configured qualification library. Mikko's 2026-09-20 adjudication makes all of this binding
for `resolve-control` (`docs/resolve-integration/adjudications/2026-09-20-resolve-control-scope/`).

## Programmatic gate (0.1.1)
`--require-library NAME[=ROOT]`: after `scriptapp("Resolve")` and `GetCurrentDatabase()` and **before any project or timeline
read**, the worker refuses `LIBRARY_MISMATCH` unless `DbName == NAME`, `DbType == Disk`, NAME is not a prohibited library and,
when ROOT is given, Resolve's `.dblist` registers NAME at exactly ROOT. `health` reports `probe: LIBRARY_MISMATCH`; the registry
shows state `LIBRARY_MISMATCH`. Strongest identity available through the scripting API is `DbName`+`DbType`; the root
cross-check adds the on-disk registration. The library's `PROVISIONING_RECORD` (`~/outputs/resolve-qualification-library/
PROVISIONING-RECORD.json`, `instance_uuid` `54bf1bdf9dac0c45`; canonical v4 UUID `7bebd326-63b5-4359-8811-23626d862be6` in the
A2 repair evidence) is not observable through the API and is bound by the evidence-set law, not by this worker.

## Environment status observed 2026-09-20
* Library: **exists and is registered** in `.dblist` as `VIDTOOLZ Resolve Qualification v1:/home/vidtoolz/outputs/resolve-qualification-library::::DISK`.
* Qualification project: **none** (`Resolve Projects/Users/guest/Projects/` is empty). Creating one is an operator action
  (`OPERATOR_PROVISIONED_PROJECT`, A3); this component has no write verb and must not create it.
* Isolated session: **cannot be started while the production session runs** — Resolve 21.1.0.14 PID 203012 (`HOME=/home/vidtoolz`,
  `PYSTY UHD` from EKA) holds the Qt single-instance lock (`/tmp/qtsingleapp-DaVinc-*`) and its `fuscript` broker binds
  `0.0.0.0:1144/49152/15000`; a second instance would either fail the singleton or share the broker, so `scriptapp("Resolve")`
  could not be guaranteed to reach the isolated session. `~/bin/resolve-launch` deletes the singleton lock and is prohibited
  by §A4. Establishing isolation therefore requires closing Mikko's production session — an operator decision.
* PRESTO / VIDLAP2: §A4 names vidnux as the only qualification host; no qualification library exists on the Windows hosts, so
  any Resolve read there attaches to a production (EKA) session. Under the adjudication those hosts can only be qualified for
  non-Resolve behaviour (routing, auth, lifetime) until the authority provides a governed multi-host qualification path.

**Consequence:** Phase 1 acceptance qualification (Q1–Q10 against the isolated environment) is BLOCKED pending operator
provisioning of a qualification project and an isolated-session window; the deployed workers run with the library gate ON.
