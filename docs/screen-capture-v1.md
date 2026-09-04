# Screen Capture V1 / Stage 7 — authentic software evidence (fresh rebuild, 2026-09-04)

Stage 7 is an **execution authority**, not a planner: the Visual Director decides a beat is
`SCREEN_CAPTURE`; Stage 7 turns a `CaptureSpec V1` into provenance-bound, privacy-safe,
mobile-readable evidence — or a typed failure that routes back for re-disposition. It never
decides what to show, never draws or retypes evidence, never captures a whole desktop, and never
substitutes a source.

```
Visual Director SCREEN_CAPTURE decision
 → CaptureSpec V1 (screen-capture/contract.js, fail-closed)
 → policy gate (config/screen-capture-policy.json; default: everything OFF)
 → transient spool attempt (screen-capture/spool.js, 0700, create-once, never reused)
 → bounded source adapter (screen-capture/adapters/*)
 → privacy BLOCK gate (screen-capture/privacy.js — secrets block; never redact-and-continue)
 → evidence finalizer (screen-capture/evidence-store.js — create-once raw, signed receipt)
 → presentation derivative 1080×1920 (screen-capture/presentation.js — measured, declared)
 → independent QC (screen-capture/qc.js — computed checks over finalized artifacts)
 → oracle-shaped evidence bundle + `vidtoolz.screenCaptureAssetHandoff.v1` (screen-capture/runner.js)
 → Directed Draft / Episode Factory (Track V2, visual source class AUTHENTIC_UI_PROOF)
```

## Contract

Records are the public `vidtoolz.capture-spec.v1`, `vidtoolz.capture-evidence.v1` and
`vidtoolz.capture-failure.v1` shapes frozen by the independent acceptance oracle
(`codex/screen-capture-v1-acceptance-oracle-20260904`, `dc525e05…`), with byte-identical canonical
JSON digests. `scripts/screen-capture-oracle-conformance.js` validates records this code actually
produces against the frozen oracle and runs its harness unchanged. Beat identity is bound in the
Episode Factory asset handoff (the oracle records are strict and carry no beat field); the handoff's
`evidence_digest_sha256` equals the oracle bundle's handoff digest.

Destinations: the frozen contract requires raw and presentation at the exact CaptureSpec
`output` (`<root>/<relative_dir>/<raw_name|presentation_name>`). The requester gives each attempt or
presentation revision its own `relative_dir` (`<capture_id>/attempt-0001`), so the Codex identity
concept (`<capture_id>/attempt-NNNN/…`) is preserved and nothing is ever re-written. The manifest also
records the content address `<capture_id>/<attempt>/raw/<sha256>.<ext>`.

## Source classes

| Class | Status | Authority |
|---|---|---|
| TERMINAL | implemented, gated | read-only templates + structured argv (`spawn`, `shell:false`, bounded env, timeout); raw = exact stdout bytes (TEXT) whose hash is the process receipt's `stdout_sha256`; nonce must appear in the output; git templates re-verify HEAD/branch/worktree right before execution |
| FILE_OR_CODE | implemented, gated | approved repository root, regular non-symlink file, file hash, HEAD/branch/worktree state, bounded line range, protected context lines; raw = exact selected text |
| BROWSER | implemented, gated | isolated headless Chrome (temp profile) over CDP, cache disabled, redirect chain, final URL ∈ {requested, authorized}, sign-in detection → AUTH_REQUIRED, error/404 pages fail, selector visibility ≥400 px², state nonce in page text; readability by an authentic narrower viewport, never by cropping the target |
| DAVINCI_RESOLVE | implemented, gated OFF | observation-only; needs a deployed read-only state provider + pixel source on PRESTO, exact project/timeline/playhead/page, not playing/rendering/busy, no modal, focus on target, PRESTO UUID hash + console session binding, 60 s double-sampled human-idle lease re-checked before pixels; unknown blocks |
| DESKTOP_APPLICATION | **not an authority** | always `SOURCE_UNAVAILABLE`; no fallback display; cannot be enabled by configuration |

## Privacy

`screen-capture/privacy.js` scans every text surface of the transient capture (transcript, file
range, page text/title/URL, tokens). Any finding → `CAPTURE_BLOCKED_SENSITIVE_DATA`: spool bytes are
discarded, nothing is finalized or rendered, and only a non-sensitive blocked receipt (detector,
categories, offsets, lengths) is persisted. Bias is towards blocking: prose resembling a credential
assignment blocks too.

## Trust anchor

The finalizer creates files once (`wx`, fsync, readback hash, 0444, sealed 0555 directory), signs an
Ed25519 receipt with a finalizer-only key, journals finalizations and exposes no update/delete API.
`describeProtection()` states honestly which class is in force: while capture and finalizer run under
the same Unix identity the class is `SAME_AUTHORITY_SOFTWARE_ONLY` (`production_qualified_store:
false` in every handoff). Production requires `deploy/screen-capture` (identities
`vidtoolz-capture` / `vidtoolz-evidence`, `/var/lib/vidtoolz-evidence`, hardened units), after which
the same-authority rewrite test must be re-run as the capture identity. `~/outputs`, VIDNAS Public
and same-account Git are not evidence authorities.

## Presentation and QC

The derivative is rendered by headless Chrome from the finalized raw only: TEXT raws are typeset
(exact bytes, ≥32 px monospace, line numbers for files), PNG raws are scaled (crop+zoom only with
declared retained context, zoom ≤ 4×). Header/footer annotations carry data-bound identity and
provenance outside the evidence box. Geometry is measured from the DOM and recorded in a transformation
manifest bound to raw and output hashes. A range that cannot be shown at ≥32 px fails typed
(`PRESENTATION_FAILED`) — the raw stays finalized. Independent QC re-derives every claim from the
finalized artifacts (hashes, receipt signature, PNG structure and pixels, safe margins, text size,
privacy re-scan, evidence facts, provenance digests); nothing is hardcoded.

## Frozen five human-KEEP beats

`screen-capture/frozen-beats.js` carries the oracle's five beats with plan hashes and the exact
source authority each needs. Today none of those authorities is deployed (Resolve provider, approved
stall-log source, authenticated GitHub evidence identity, append-only routing receipts, mapped review
console), so each resolves to a typed unavailable/replan record — never a fixture or substitute.

## Operating

- Policy/activation: `config/screen-capture-policy.json` (feature flag + per-class gates). Default OFF.
- Run one spec: `node scripts/screen-capture-run.js --spec <file> [--beat B03_04 --episode EP03 --run <run_id>]`.
- Canaries + beat disposition: `node scripts/screen-capture-canaries.js --out <dir>`.
- Frozen-oracle conformance: `node scripts/screen-capture-oracle-conformance.js --out <dir>`.
- Tests: `tests/screen-capture-v1.test.js` (part of `scripts/verify.sh`).
- Runtime state lives under `media/screen-capture/` (ignored) until the deployment step moves it.
