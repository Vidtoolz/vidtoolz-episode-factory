# A4 host/library extension — PRESTO qualification library (2026-09-22)

Governance record in the class of the 2026-09-20 A3 fixture record; additive, outside the frozen v1.20 bundle
(FREEZE-MANIFEST sha `29216e6b…` unchanged). Machine form `A4-PRESTO-PROVISIONING-RECORD.json`, record_id `5098495cda8e997d…`
(recipe `sha256("vidtoolz.resolveEvidenceRecord.v1\n" + canonical body)`, same as A3).

## Question and answer
**Was `VIDTOOLZ Resolve Qualification v1` ever provisioned for PRESTO? — No.** The only provisioning (A2 2026-09-10, A3 2026-09-20)
is host `vidnux`, root `/home/vidtoolz/outputs/resolve-qualification-library`, instance `7bebd326-…`. Frozen §A4 names vidnux as the
qualification host and PRESTO as the human NLE host; the 2026-09-20 doctrine closure states "no qualification library on Windows hosts".
Live confirmation 2026-09-22: PRESTO `dblist.conf` lists only Local Database / EKA / nelja, and the frozen worker (gen 5, exact bytes)
answered `resolve_health` via the real facade with `probe = LIBRARY_MISMATCH` while Resolve 21.1.0.14 (pid 14492) was running.

## Decision (approver: Mikko; basis: 2026-09-22 instruction to define and perform the governed provisioning)
| Field | Value |
|---|---|
| Host | PRESTO (Windows 11, Resolve.exe 21.1.0.14, scripting Local per config.dat) |
| Library | `VIDTOOLZ Resolve Qualification v1`, **Disk**, `C:\Users\presto\.vidtoolz-resolve-qualification\VIDTOOLZ Resolve Qualification v1` |
| Instance UUID | `687c639f-0092-4279-87d3-e7363417c7cd` (new; not the vidnux instance; no fixture bytes copied) |
| Fixture | `VIDTOOLZ_RESOLVE_QUAL_V1_PRESTO` + `__TL_A`, `__TL_B`, 25 fps, 1920×1080, no media |
| Registration | Resolve GUI only (Add Project Library > Disk). `dblist.conf`/`activedb.conf` never authored or copied. |
| Prohibited | EKA, nelja, Local Database, any network library, `SetCurrentDatabase` from any adapter |
| Scope | Hermes read-only facade live qualification on PRESTO. §A4 vidnux Phase 1 qualification unchanged. WRITE AUTHORITY = NONE. |

## Procedure
1. DONE (Claude, 03:19Z): root + tools staged on PRESTO; `PROVISIONING-RECORD.json` (status STAGED_AWAITING_OPERATOR_REGISTRATION) sha256 `d7c66d6c…`; `tools/fp_qual_presto.py` `cc8f74f4…`; `tools/provision_fixture_presto.py` `be3c108c…`.
2. PENDING (Mikko, PRESTO desktop): Project Manager > Add Project Library > Disk, name exactly as above, location = root; select it.
3. PENDING (Claude over `ssh presto`, journaled): `py -3 %USERPROFILE%\.vidtoolz-resolve-qualification\tools\provision_fixture_presto.py` — refuses unless the current database is this Disk library.
4. PENDING: mint the PRESTO `OPERATOR_PROVISIONED_PROJECT` record, set on-disk status PROVISIONED, then run the PRESTO facade lane.

Rollback: delete `%USERPROFILE%\.vidtoolz-resolve-qualification` and remove the library in the GUI.
Evidence: `~/outputs/hermes-resolve-facade-presto-qualification-library-provisioning-2026-09-22/`.
