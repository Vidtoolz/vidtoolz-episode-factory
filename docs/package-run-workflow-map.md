# Package Run Workflow Map

`scripts/package-run-workflow-map.js` is a read-only JSON reporter for one
VIDTOOLZ package run. It does not create workflow artifacts, update approval
markers, move media, call external APIs, touch Git, or change package-run state.

## Usage

```sh
node scripts/package-run-workflow-map.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-workflow-map.js --help
```

The command always prints JSON. On errors it still prints a parseable JSON
object with `ok: false`.

## Output

The map includes:

- `gates`: ordered lifecycle gates with expected, existing, and missing
  artifacts for each gate
- `expectedArtifacts`: the current stage's expected artifacts from Doctor
- `existingArtifacts`: known local artifacts detected by Doctor
- `missingArtifacts`: current missing artifacts from Doctor
- `currentBlocker`: the first blocker reason from Doctor
- `nextSafeHumanAction`: the Next Action Authority route, including actor,
  mode, approval requirement, and any confirmed read-only command
- `blockedActions`: conservative downstream actions that remain unsafe
- `safety`: read-only guarantees

Artifact existence is not treated as proof of readiness. The command composes
the existing package-runs index, Package Run Doctor, and Next Action Authority
so evidence and approval boundaries stay conservative.

## Finish Test

```sh
node scripts/package-run-workflow-map.js package-runs/YYYY-MM-DD-topic-slug
./scripts/verify.sh
```
