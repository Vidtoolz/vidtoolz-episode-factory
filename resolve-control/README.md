# resolve-control — VIDTOOLZ Resolve three-host worker control plane, Phase 1 (READ ONLY)

Version: `resolve-control-plane phase1 0.1.0` · protocol `vrc.v1` · parent authority: Resolve authority v1.18 @ 5d9dbba7 (branch `docs/resolve-authority-freeze-v1.18`).

One loopback-only worker per Resolve host (PRESTO, VIDLAP2, vidnux). Each worker attaches to **its own** Resolve via
`scriptapp("Resolve")` with no host argument. Resolve External Scripting stays **Local** on every host. A caller on
vidnux (`python3 -m vrc <op> --target <host>`) reaches a Windows worker only through an SSH-session-bound loopback
forward; nothing listens on a LAN interface. Every command names its target explicitly; there is no default host and no
fallback. Only read-only operations exist; write-class names are refused with `READ_ONLY_MODE` before any Resolve call.

**Phase 1 grants no write authority.** `mode: READ_ONLY`, `write_authority: NONE`, `write_lease: null` in every response.

Layout: `worker/resolve_worker.py` (stdlib-only, deployed per host) · `vrc/` (registry, protocol, transport, client,
journal, tunnel, CLI) · `tests/` (unit + FakeResolve integration + static gates) · `docs/`.

Run tests: `python3 -m unittest resolve-control/tests/test_phase1.py`. Operate: see `docs/OPERATIONS.md`.
