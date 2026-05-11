# Package Run Research Evidence

`scripts/package-run-research-evidence.js` is a local-first intake tool for
human-provided evidence that supports a package run's research pack.

It does not search the web, call YouTube APIs, invent sources, rewrite
`research-pack.md`, upload, publish, archive, commit, push, update Hermes,
update project state, or create scheduled jobs.

## Usage

```sh
node scripts/package-run-research-evidence.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-research-evidence.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-research-evidence.js package-runs/YYYY-MM-DD-topic-slug --reset-evidence
node scripts/package-run-research-evidence.js --help
```

## Generated Artifacts

- `research-evidence.md`
- `source-support-map.md`
- `proof-capture-plan.md`
- `research-objections.md`
- `research-sufficiency-review.md`

The four evidence input files are treated as human-editable evidence and are
preserved by default:

- `research-evidence.md`
- `source-support-map.md`
- `proof-capture-plan.md`
- `research-objections.md`

`--overwrite` refreshes only the derived review output,
`research-sufficiency-review.md`. It does not wipe manually gathered evidence.

`--reset-evidence` is the explicit destructive starter reset for the evidence
input files. Use it only when you intentionally want to replace the evidence
inputs with starter TODO templates.

## Gate Logic

The tool reports:

- `BLOCKED` when no selected package exists.
- `NEEDS EVIDENCE` when source, proof, objection, or approval evidence is
  missing, placeholder, TODO, vague, or blocked. Doctor should route this back
  to the evidence intake tool.
- `READY FOR RESEARCH REVIEW` when concrete source support, local proof, and
  objections exist, but exact research approval is missing. This is a human
  review state, not production approval, and Doctor should not loop back to
  evidence intake unless evidence becomes incomplete again.
- `PASS` only when exact approval exists and the evidence is complete.

`PASS` requires:

- `Research approval: PASS` or `Manual research approval: PASS`
- at least 2 concrete source references
- at least 1 local production-proof item
- at least 1 objection or counterexample
- no open or blocked rows in `research-sufficiency-review.md`

The tool records evidence readiness. A human still needs to decide whether to
update `research-pack.md` or move the approval marker into the research pack's
Research Sufficiency Gate for downstream script-structure approval.
