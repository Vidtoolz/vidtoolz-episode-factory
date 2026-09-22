# A4 host/library extension — VIDLAP2 qualification library (2026-09-22)

Additive governance record beside the frozen v1.20 bundle (manifest `29216e6b…` unchanged), same class and shape as
`2026-09-22-a4-presto-qualification-library`. Machine form `A4-VIDLAP2-PROVISIONING-RECORD.json`, record_id `04eb949676f947b4…`.

**Finding:** `VIDTOOLZ Resolve Qualification v1` was never provisioned for VIDLAP2 (§A4/A3 vidnux-only; VIDLAP2 `dblist.conf` lists only
Local Database, EKA, nelja on 2026-09-22).

**Decision (approver Mikko; basis: R7 instruction):** VIDLAP2 (hostname VIDLAP2, user mjp77, ED25519 host key CCko0i…, machine GUID 40086c1a…)
becomes an additional qualification host for the Hermes read-only facade live qualification, with ONE local Disk library
`VIDTOOLZ Resolve Qualification v1` at `C:\Users\mjp77\.vidtoolz-resolve-qualification\VIDTOOLZ Resolve Qualification v1`, instance
`b714a6ea-6dbf-42a6-905c-87afab6e5df3` (new; not vidnux 7bebd326, not PRESTO 687c639f), and ONE fixture `VIDTOOLZ_RESOLVE_QUAL_V1_VIDLAP2`
with two empty timelines (fresh UUIDs). Bounded provisioning writes only (project, 4 settings, 2 timelines, current timeline, save), journaled.
Not authorized: production writes, EKA/nelja/Local Database contact, Hermes write capability, persistent workers, Network scripting,
copying any other host's fixture or UUIDs, authoring `dblist.conf`/`activedb.conf`, any change to frozen v1.20 or to §A4's vidnux host.

Procedure: 1 DONE staging (record c90e57de…, tools f33303d8… / 3208276b…, remote == local) · 2 PENDING Mikko GUI registration + selection ·
3 PENDING worker-proven library identity → journaled fixture tool → independent fingerprint · 4 PENDING OPERATOR_PROVISIONED_PROJECT record,
status PROVISIONED, read-only facade lane, host record. Rollback: delete the staged folder, remove the GUI entry, revert this record.
