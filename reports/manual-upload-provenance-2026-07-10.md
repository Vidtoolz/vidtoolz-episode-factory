# Manual Upload Provenance & Storage Classification (Backlog B4) — 2026-07-10

Correct the false provenance of operator-supplied ("manual") image uploads:
they were stored under `images/flux-local/` and could be represented as
FLUX-generated. The server now stores them under a truthful namespace and all
classification is driven by explicit metadata, not the directory name.

## Baseline

- Branch `fix/manual-upload-provenance` from `main` @ `e394631` (PR #16 + #17 merged).
- Tests at start: `1810/1810`; `verify.sh` exit 0; working tree clean; unrelated
  stash preserved.

## Source-flow matrix (image entry / provenance-consuming paths inspected)

| Route / op | Caller | Old destination | Old metadata | Old provenance | Corrected |
| --- | --- | --- | --- | --- | --- |
| `uploadAigenImage` (`POST /api/aigen/upload-image`) | image-selector.html, shorts-workflow.html | `images/flux-local/flux-NNN.png` | sidecar `manual_external` but at a flux path | **false (location claims FLUX)** | stores `images/manual-upload/manual-NNN.png`, sidecar `source_type: manual_upload` |
| `writeSelectedImages` (`/api/aigen/selected-images`) | image-selector.html | hard-coded `flux-local/flux-NNN.png` | `selected_source` from sidecar hit | selection path always flux-local | resolves slot from EITHER namespace; truthful `selected_path` + `source_type` |
| `listFluxImages` (`/api/aigen/flux-images/<id>`) | image-selector.html | flux-local only | none | uploads appeared as flux | lists both namespaces, each with `source_type` |
| `buildPackageMediaIndex` (`/api/…/media-index`) | index consumers | local vs external | `generation_mode` | ok in metadata | adds explicit `source_type` per image |
| `media-gallery.js classifyMedia` | package-runs gallery | — | ignored server metadata | **inferred FLUX from path** | prefers explicit `source_type`/`generation_mode`; path only as legacy fallback |
| `media-provenance.inferProvenance` | (no callers) | — | path/hint | would claim FLUX from `flux-local` | left as legacy-only helper; runtime uses evidence-based `classifyImageSource` |
| CLI `importManualMedia` | scripts | `images/gpt-manual/` | manual provenance | already truthful | unchanged |

## Authoritative provenance contract

`package-media-index.classifyImageSource(relPath, evidence)` is the single source
of truth. **Source types:** `generated`, `manual_upload`, `legacy_unknown`.
**Precedence (fallback order):**
1. explicit sidecar record for the exact path → its `source_type` (or
   `manual_external`/`unknown` → `manual_upload`; `local` → `generated`);
2. membership in the FLUX generation manifest → `generated` (proven);
3. a file under `images/manual-upload/` → `manual_upload`;
4. otherwise (bare `flux-local/` file, no evidence) → `legacy_unknown`.

It NEVER infers `generated` purely from the `flux-local/` directory name (a manual
upload historically lived there), and never "upgrades" a legacy asset without
evidence. `buildImageEvidence()` reads the flux manifest + sidecar once. Provider
is reference-only; the server owns `source_type` — a client `provider: flux-local`
is coerced away and can never claim generated provenance.

## Storage namespace

New manual uploads: `images/manual-upload/manual-NNN.png` (slot-indexed, sanitized,
path-contained). FLUX output stays at `images/flux-local/flux-NNN.png`. Legacy
manual uploads remain at their recorded `flux-local/` path and stay readable and
selectable via their sidecar record. No legacy file is moved on read/startup.

## Changes (per surface)

- **uploadAigenImage** — prior: wrote `flux-local/flux-NNN.png`, occupancy checked
  only that path. New: writes the manual-upload namespace; occupancy is
  cross-namespace (rejects a slot occupied by generated FLUX, legacy manual, or a
  prior upload) with `409 MEDIA_SLOT_OCCUPIED` unless `confirm_replace`; on replace
  archives the prior occupant (any namespace) to `images/superseded/` and records
  its provenance in sidecar `superseded[]` history (never deleted); atomic tmp+rename;
  on provenance-write failure it removes ONLY the newly staged file; structured
  codes (`INVALID_SLOT`, `UNSUPPORTED_MEDIA_TYPE` 415, `MEDIA_TOO_LARGE` 413,
  `MEDIA_SLOT_OCCUPIED` 409, `PATH_OUTSIDE_PROJECT`, `UPLOAD_WRITE_FAILED`,
  `PROVENANCE_WRITE_FAILED`, `MALFORMED_UPLOAD`). Tests: workflow-path + manual-upload-provenance.
- **writeSelectedImages** — resolves each slot from either namespace and emits
  truthful `source_type` / `selected_source` / `selected_path` / `generator` /
  `provenance`; legacy flux-local selections keep their path. Downstream (PRESTO
  B2 eligibility, run-production.py) already consumes `selected_path`
  namespace-agnostically, so a manual upload's real path flows truthfully.
- **listFluxImages** — surfaces both namespaces (uploads still appear in the
  selector), each tagged `source_type`.
- **package-media-index** — index entries carry `source_type`; new
  `classifyImageSource` / `buildImageEvidence` / `sidecarSourceType` / `sourceLabel`.
- **media-gallery.js** — `classifyMedia` prefers explicit provenance; path/name
  heuristics only when no metadata (legacy). XSS-safe lightbox unchanged.
- **image-selector.html** — per-image truthful source label; upload button
  relabeled "Upload manual image" (was "Upload as flux image").

## Legacy fallback rules

Legacy `flux-local/` file: flux-manifest entry → `generated`; sidecar manual entry
→ `manual_upload`; neither → `legacy_unknown` (surfaced as "Legacy · source
unknown", not an error). Reading a legacy project never rewrites its manifests
(asserted by test).

## Downstream consumers

`selected-images.json` now carries truthful `source_type`/provenance, so handoff
and review consumers receive honest origin. Regeneration semantics unchanged and
source-aware: FLUX regeneration is the FLUX path; a manual upload is replaced only
by an explicit upload (never auto-"regenerated" as FLUX); `legacy_unknown` is never
assigned a generator. No rendering/routing behavior changed (no incorrect routing
existed — provenance was a classification/label problem).

## Migration policy

**No data migration.** Full backward compatibility is provided by the runtime
classifier, so no mutation tool was built (Phase 8). A READ-ONLY audit script
(`scripts/manual-upload-provenance-audit.js`) reports the classification of a
caller-specified package (dry-run only; no `--apply`; never moves/deletes;
idempotent). **No production migration was run.**

## Tests

`tests/manual-upload-provenance.test.js` (17) + updated/added upload tests in
`tests/workflow-path.test.js`: provenance precedence + legacy_unknown + no-rewrite;
storage namespace + legacy readability/selectability + both-namespace listing;
cross-namespace occupancy + non-destructive replacement + superseded history +
client-provider-claim rejection; API 400/404/413/415 + `MEDIA_SLOT_OCCUPIED`;
read-only audit (dry-run, no apply, idempotent); UI label/classification assertions.

## Verification

- `./scripts/verify.sh` → exit 0, **`1829/1829 tests passed`**, canonical-spec in
  sync, doc-authority passed.
- Browser workflow smoke → exit 0, `{"ok": true, …}`.
- `git diff --check` → clean.
- Fixture-only live smoke (ephemeral server + temp fixture, zero production
  impact): upload → 200 `source_type: manual_upload` at
  `images/manual-upload/manual-001.png`; occupied → `409 MEDIA_SLOT_OCCUPIED`;
  nonexistent project → 404; file stored under manual-upload, never flux-local.

## Safety

No real FLUX/PRESTO/Wan2.2/ComfyUI generation; no cloud; no real project media
moved/deleted/overwritten; no production migration; no queue state changed; unrelated
stash intact; Hermes Mission Control and brain untouched. B1 and B3 remain
unimplemented.

## Remaining limitations

- Legacy `flux-local/` files with neither manifest nor sidecar evidence are
  reported `legacy_unknown` by design (cannot be proven); the read-only audit
  surfaces them for any future, separately-authorized cleanup.
- The external `run-production.py` consumes `selected_path` by contract; a manual
  upload's path now truthfully points at `images/manual-upload/` (internally
  namespace-agnostic; not exercised against a real render in this task).
