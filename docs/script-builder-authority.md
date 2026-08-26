# Script Builder authority dependency

Episode Factory consumes Script Builder's story-version implementation at runtime. Script Builder remains the sole authority for version loading, append-only lineage, canonical content hashing, and version diffs; Episode Factory stores references and verifies the explicit `vidtoolz-script-builder/story-version-authority/v1` contract.

`config/script-builder-authority.json` pins the compatible private repository commit, records its dedicated remote CI ref, and hashes the authority files Episode Factory executes. `./scripts/verify.sh` runs `scripts/verify-dependencies.js` first, so an absent, incomplete, or incompatible checkout fails at the dependency boundary rather than inside a downstream test.

Resolution order is deliberately small:

1. an explicit function/CLI root;
2. `VIDTOOLZ_SCRIPT_BUILDER_ROOT`;
3. a `vidtoolz-script-builder` checkout beside this repository;
4. the historical local-development path as a final compatibility fallback.

An explicit path never falls through to another checkout when it is wrong.

For reproducible local verification, check out the commit named by the lock file and run:

```sh
VIDTOOLZ_SCRIPT_BUILDER_ROOT=/absolute/path/to/pinned/vidtoolz-script-builder ./scripts/verify.sh
```

GitHub's canonical promotion job runs only on trusted pushes to `main`. It checks out that exact private commit with the repository secret `SCRIPT_BUILDER_DEPLOY_KEY`, which must contain a read-only deploy private key registered only on `Vidtoolz/vidtoolz-script-builder`. The checkout does not persist credentials. Pull-request workflows receive no private credential and run clearly labelled public source checks; they are not the canonical promotion gate. The workflow intentionally does not use `pull_request_target`.
