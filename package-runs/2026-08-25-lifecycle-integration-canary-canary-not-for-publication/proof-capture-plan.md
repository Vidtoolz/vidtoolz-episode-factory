# Proof Capture Plan

CANARY — NOT FOR PUBLICATION. Proof items are captured locally from this run.

| proof item | what it proves | local capture method | file/app/source | status |
| --- | --- | --- | --- | --- |
| Gate transition timeline for this run | One genuine run crosses real gate boundaries | sample every surface after each transition | package-runs/2026-08-25-real-lifecycle-integration-proof/ | closed |
| package-run-state.md canonical digest per gate | Durable projection tracks canonical state | node scripts/package-run-state-operations.js --run <run> --check | this run's package-run-state.md | closed |
| Projection forgery rejection | Manual projection edits cannot advance production | corrupt digest, run --check, then --rebuild | negative canary: drift detected, canonical unchanged, rebuild repaired | closed |
