# Five-Gate Dry Run — High-Priority Fixes (2026-07-03)

Follow-up to `reports/friction-log.md` (dry run 2026-07-03, verdict PARTIAL).
Machine vidnux, repo `/home/vidtoolz/vidtoolz-episode-factory`, base commit
`7173b7adfa23d2d84bafd37ae442fbb0a7837476` (main). Both High-priority defects
fixed; Medium items deliberately untouched.

## Defect 1 — Manual video import failed on >2 GiB camera originals

- **Observed:** `node scripts/import-manual-videos.js --dry-run` on the 2.81 GB
  A-roll exited 1 with `Error: File size (2811261433) is greater than 2 GiB`
  before any validation ran (`five-gate-dry-run-evidence-20260703-175510/gate2-import-aroll-dryrun.log`).
- **Root cause:** `sha256File` in `manual-media-import.js` hashed via
  `hash.update(fs.readFileSync(filePath))` — Node buffers the whole file and
  throws `ERR_FS_FILE_TOO_LARGE` above the 2 GiB buffer cap. Any realistic 4K
  camera original exceeds it.
- **Fix:** chunked hashing — `fs.openSync` + an 8 MiB `fs.readSync` loop feeding
  `crypto.createHash('sha256')`. Constant memory, identical hex digest, same
  synchronous signature (the whole import call chain is sync, so async
  `createReadStream` piping would have forced an API ripple through the CLI and
  server for no behavioral gain; the chunked read is the streaming equivalent
  in sync form). Missing/unreadable files still throw (ENOENT/EACCES), as before.
- **Proof on the real input** (evidence: `reports/five-gate-dry-run-fixes-evidence-20260703-185721/`):
  - Dry-run: exit 0, file scanned + validated with the expected 4 advisory
    warnings (4K, landscape, 59.986 fps, HEVC) — `aroll-import-dryrun.log`.
  - Real import: exit 0 in 4 s (source pages cached), 2.7 G landed in
    `videos/manual-external/ip17 what is hermes.MP4` — `aroll-import-real.log`.
  - Digest integrity at >2 GiB: manifest sha256
    `566a4f0b…326279` equals `sha256sum` of the VIDNAS source — `aroll-sha256-crosscheck.txt` (MATCH).

## Defect 2 — Media index double-listed manual imports as WAN/PRESTO renders

- **Observed:** `gate1-media-index.json` listed the same manual video twice:
  once correctly (`manual_external / unknown_manual`) and once as
  `wan22-local / comfyui_wan22 / presto / local` — a provenance-doctrine violation.
- **Root cause:** `collectLocalVideos()` in `package-media-index.js` swept every
  `videos/<variant>/` directory and stamped the WAN/PRESTO provenance block
  unconditionally. `videos/manual-external/` is the manual-import destination
  (`manual-media-import.js` KINDS), not a generation lane, and its entries were
  already added with true provenance by `collectExternal()`.
- **Fix:** `collectLocalVideos` now skips the `manual-external` folder
  (`MANUAL_EXTERNAL_VIDEO_VARIANT` constant with an explanatory comment).
  Generated lanes (`mp4`, `mp4-hq-720p`, future WAN variants) classify exactly
  as before; Resolve handoff staging (`packageStagedWanStatus`) reads variant
  folders independently and is unaffected; the media gallery badge logic keyed
  on `manual-external` paths is unaffected.
- **Proof:** `media-index-after-fix.json` — 3 videos, each listed exactly once:
  WAN clip `videos/mp4/001.mp4` still `comfyui_wan22 / local`; screen recording
  and A-roll both `manual_external / unknown_manual`. Counts:
  `videos_total 3, videos_local 1, videos_external 2`.
- **Provenance distinguishability now:** FLUX local image (`local/flux/vidnux`),
  WAN/PRESTO clip (`local/comfyui_wan22/presto` + `video_variant`), manual
  static card (`manual_external`, image, `gpt-manual` or provider), manual
  video (`manual_external` + provider). Supervised captures live outside
  packages (capture + sidecar under `~/Videos/vidtoolz-captures/`) and are
  identifiable by the `VT_capture_*` naming convention. **Known remaining
  conflation:** a manual A-roll and a manual screen recording carry identical
  provenance fields — distinguishing them would need an import-time role flag
  (schema addition), deliberately not added under the minimal-change rule.
  Flagging for the Medium-items pass.

## Files changed

| File | Why |
|---|---|
| `manual-media-import.js` | `sha256File` rewritten to chunked hashing (+9 lines, comment included) |
| `package-media-index.js` | `MANUAL_EXTERNAL_VIDEO_VARIANT` constant + skip in `collectLocalVideos` (+7 lines) |
| `tests/media-routing.test.js` | two new targeted tests (below) + `crypto`/`sha256File` imports |

No schema changes. No changes to Resolve handoff, media routing, server routes,
or gallery code. `git diff --stat`: 3 files, +79/−2.

## Tests added

1. **`sha256File hashes in chunks: same digest, multi-chunk safe, no whole-file readFileSync`** —
   8 MiB + 3 B file (crosses a chunk boundary with unaligned tail) digest equals
   `crypto` reference; `fs.readFileSync` poisoned for the target file to prove
   the buffering path is gone (this is the exact call that threw at 2 GiB);
   missing file still throws ENOENT. A multi-gigabyte fixture is deliberately
   not in git — the real 2.81 GB proof ran against the VIDNAS A-roll (above).
2. **`buildPackageMediaIndex: manual video imports are not double-listed as WAN/PRESTO renders`** —
   package with a WAN clip in `videos/mp4/` and a manual import in
   `videos/manual-external/`: manual entry appears exactly once with
   `manual_external/unknown_manual`; WAN clip still `comfyui_wan22/presto`;
   counts `total 2 / local 1 / external 1`.

## Commands run and results

- `node tests/run-tests.js` — **1485/1485 passed** (both new tests `ok`)
- `./scripts/verify.sh` — **exit 0**: 1485/1485, syntax checks, canonical-spec
  drift guard, doc-authority guard all green
- A-roll retry (exact previously-failing command, quoted path): dry-run exit 0,
  real import exit 0, sha256 cross-check MATCH — evidence in
  `reports/five-gate-dry-run-fixes-evidence-20260703-185721/`
- `node scripts/index-package-media.js --json` on the dry-run package — exit 0,
  no double-listing (`media-index-after-fix.json`)

## Verdicts

- **>2 GiB A-roll import: FIXED** — proven on the real 2.81 GB camera original,
  digest verified against `sha256sum`.
- **Manual-import provenance: FIXED** — manual imports classify only as
  `manual_external`; WAN/PRESTO classification intact; no double-listing.

## Deliberately deferred (Medium, from the friction log)

1. Normalization/format validation remains advisory-only end to end.
2. Visual-stack lock API (`selected-images.json`) still only addresses
   flux-local images; manual lanes cannot be locked.
3. No lock CLI, no capture `--duration`, no one-command dry-run orchestrator.
4. (Noted above) no import-time role tag to separate manual A-roll from manual
   screen recording; `variant: klingai-manual` label on `unknown_manual` video
   imports is a pre-existing cosmetic oddity left untouched.

Not committed — awaiting Mikko's review.
