# Git evidence oracle

Git evidence uses real isolated repositories and exact read-only templates for status/log/diff. Identity comprises approved repository id/root, full HEAD, symbolic branch or explicit `DETACHED`, and SHA-256 of `git status --porcelain=v1 --branch`. Process output is separately hashed and the source-state nonce must be visible.

The harness distinguishes same-looking repositories, wrong root/id, branch switch, HEAD change, dirty state, detached HEAD, and stale previous output. A declaration is insufficient: the validator queries the live repository and rejects a state change after request.
