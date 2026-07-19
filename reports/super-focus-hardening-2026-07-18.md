# Super Focus — fix & fine-tune pass (2026-07-18)

Scope: full review of the Super Focus module (`super-focus.html`, `super-focus.js`,
`super-focus-media.js`, `super-focus-prompts.js`, `super-focus-router.js`,
`super-focus-project-io.js`) plus all `/api/super-focus/*` server handlers in
`package-engine-server.js`. Verification: `./scripts/verify.sh` → 1937/1937 tests
passed (14 new tests added in this pass). All changes are LOCAL/uncommitted.

## Fixed in this pass

1. **Regenerate could strand a slot empty (image + video).** Both regenerate
   handlers archived the existing asset and only then dispatched the replacement
   job; a dispatch failure (lock lost during the ~4s reachability probe — e.g. a
   status-poll pump starting a queued render — or a missing dispatch script) left
   the slot with no asset and no restore. Fix: new `restoreArchivedImage`/
   `restoreArchivedVideo` in `super-focus-media.js` (extracted from
   `resolveRegenerated`'s restore path); both handlers now restore the archived
   file on any dispatch failure and annotate the superseded ledger.
2. **Running job's input files could be rewritten by a refused request.**
   `generate-images` / `generate-videos` materialized `image-prompts.json` /
   `selected-images.json` + `video-prompts.json` *before* the busy-lock 409, so a
   second click during a run clobbered the running job's inputs. Both routes now
   refuse before materializing.
3. **Pause contract gaps.** `generate-videos` re-checks the pause flag after the
   awaited PRESTO probe (a pause landing during the probe now wins);
   `regenerate-video` (which also starts a render) now refuses with 409 while the
   queue is paused.
4. **Media file routes could hang a response / crash an embedding process.** The
   PNG/MP4 streams (`/api/super-focus/image`, `/video` full + range) had no
   stream `error` handler; a file archived mid-request or a NAS read error threw
   an uncaught error and left the browser request hanging. All three streams now
   destroy the response on error (same pattern as the static-file server).
5. **Stale media previews after regenerate + per-poll churn.**
   `reconcileImages`/`reconcileVideos` now expose `mtime_ms` per row.
   `super-focus.html` uses it as the cache key: image thumbs rebuild only when
   the row actually changed (previously every 3s poll rebuilt every thumbnail
   and — with `Cache-Control: no-store` — re-downloaded every done PNG), video
   previews rebuild when the clip file changes (previously a regenerated clip
   kept showing the old preview; the URL had no cache-buster at all), and a
   preview whose clip was archived (regenerate/clear) is removed instead of
   showing a clip that is no longer there.
6. **Ollama model probe false-ready.** `probeOllamaTags` matched on base name
   only, so `qwen3:8b` installed reported configured `qwen3:14b` as ready and
   generation later failed as an opaque 502. A configured tag now requires an
   exact match; a tagless configured name still accepts any installed tag.
7. **Frontend robustness.** `loadProject`, title/script save, both status
   pollers, and both cancel buttons now catch network-level failures (no more
   unhandled rejections every poll tick during a server restart; honest "Save
   failed"/"Cancel failed" feedback). The new "Continue" section was added to
   `SECTION_KEYS`, so its collapsed state is restored/reset per project instead
   of leaking from one open project into the next.

## Known open findings (deliberately not changed — need Mikko's call)

- **Sync NAS I/O on the event loop in polling paths.** Every images/videos
  status poll runs up to ~hundreds of `statSync`/`existsSync` calls against
  `SUPER_FOCUS_MEDIA_ROOT` (VIDNAS). A stalled mount wedges every route on
  :8010. Fix would be async fs or a worker; architectural, not slice-sized.
- **State-changing GETs.** `GET videos-status` / `GET video-queue` drive the
  queue pump (writes `video-queue.json`, can spawn a PRESTO render for queued
  items) and `GET ollama-benchmark` runs real GPU generations — all outside the
  nonce/Origin write gate. Moving the pump off GET changes the "queue drains
  while the page polls" behavior, so it needs a design decision.
- **Orphaned image after slot clear + refill.** Clearing a prompt slot keeps its
  PNG on disk; a later top-up refills the index with new text and the old image
  is reported `done` for it (and blocks generation) with no mismatch flag.
- **Monolithic prompt generation.** `generate-image-prompts` and
  `generate-remaining-image-prompts` issue one Ollama call for up to 100 prompts
  against a 120s timeout; the infographic route is chunked with partial saves —
  the image routes should be migrated to the same pattern.
- **Cancel buttons are global.** `images-cancel`/`videos-cancel` kill whatever
  FLUX/PRESTO job is running, project id unchecked (`stop-current` has the safe
  `activeIsThis` pattern).
- **`generate-missing-i2v-prompts`** can hold one HTTP response open for up to
  100 serial PRESTO Ollama calls; per-row saves survive, but the response can
  outlive browser timeouts.
- **Minor:** queue items never pruned from `video-queue.json` (grows across
  requeues); `i2v_hash` stored on queue items but never read (implied staleness
  check missing); `latestSupersededHash` export unused; small response-shape
  inconsistencies (`effective_limit` null vs number, count rejected vs clamped,
  `videos-status` lacks a `failed` count).
