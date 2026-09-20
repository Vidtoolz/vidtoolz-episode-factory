# A3 — qualification fixture provisioning record (2026-09-20)

Governance record in the class of `v1.18/AUTHORIZATION-2026-09-08.md` and the 2026-09-20 scope adjudication; placed outside the frozen v1.18 bundle (FREEZE-MANIFEST sha `80b108e4…` unchanged). Machine form: `A3-PROVISIONING-RECORD.json` (record_type `OPERATOR_PROVISIONED_PROJECT`, LIBRARY-level envelope per TARGET-ATTACHMENT-GATE.md §1).

| Field | Value |
|---|---|
| Authority parent | v1.18 @ 5d9dbba7; scope adjudication 91bf571e (resolve-control inside v1.18, §A4 applies) |
| Library | `VIDTOOLZ Resolve Qualification v1`, **Disk**, `/home/vidtoolz/outputs/resolve-qualification-library` (dev 66312 / inode 93061382) |
| Canonical library UUID | `7bebd326-63b5-4359-8811-23626d862be6` (A2 repair session a2-repair-20260910-093844, FINALIZED) |
| Legacy UUID | `54bf1bdf9dac0c45` (on-disk PROVISIONING-RECORD.json, 2026-09-10T09:14:47Z) — **superseded**; same physical library (same root, device, inode) |
| Qualification project | `VIDTOOLZ_RESOLVE_QUAL_V1_PHASE1` — UUID `7ac4210e-5ada-46a3-9821-831bfa83a4cc` (created 2026-09-20T16:39:49Z) |
| Timelines | `…__TL_A` `933dc179-ba37-4f3f-b3cf-8b0304544f20`; `…__TL_B` `43868e12-b3f5-4e7e-a0db-069c2b7e0998` (empty; 25 fps; 1920×1080) |
| Fixture fingerprint (before) | `30cfabdd0401275750eb4f468a57b538000aa03cd825698570a8831e08d9dec7` (spec vidtoolz.qualFixtureFingerprint.v1) |
| Isolation rule | vidnux only; dedicated session via `/opt/resolve/bin/resolve` with BMD_RESOLVE_* isolated roots registering only this library; production session closed; no lock deletion; Local scripting |
| EKA | prohibited and not registered in the qualification session |
| Candidate under qualification | `77c26103` (`resolve-control-plane phase1 0.1.1`, worker `371caf131e5d21cd…`); WRITE AUTHORITY = NONE |
| Post-state | fixture preserved as the repeatable governed fixture; no further mutation |

Evidence: `~/outputs/resolve-control-plane-phase1-a4-qualification-2026-09-20/run4/` (provisioning-journal.jsonl, FIXTURE-FINGERPRINT-BEFORE.json, evidence/1x-*).
