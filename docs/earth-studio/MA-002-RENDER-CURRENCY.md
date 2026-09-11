# MA-002: current MP4 authority

MA-002 intentionally replaces MP4-exists readiness in the lane with a shared currency and minimum-validity check. It does not change planning, MA-001 seed resolution, render execution, human acceptance or historical evidence.

`writeJob` writes `shot-plan.json.generated_at` and `job.json.created_at` from the same generation timestamp. The lane's existing freshness authority is `job.created_at`, not job name, slug or planner version. No general render-to-plan hash/manifest exists; the v0.4 proof manifests belong to separate preserved acceptance rounds.

`outputStale(job, mtimeMs)` is shared by frames and MP4: timestamps strictly before plan creation are stale; equality is fresh. Frame detection retains its directory-mtime shortcut and last-frame fallback for in-place re-exports. An MP4 with stale remaining frame output is also withheld, so freshly re-encoding an old frame set cannot make it current.

`renderState` is used by both `status` and `stageToVidnas`. A current MP4 requires:

- A nonempty regular file at the expected render path; symlinks, directories and other file types are not accepted.
- An existing plan and readable job generation timestamp, with neither MP4 nor frame output stale under the shared law.
- Successful local `ffprobe` metadata inspection identifying an MP4 container and a video stream with codec, positive dimensions and positive finite duration.
- An unchanged file identity, size and modification/change timestamps across that inspection.

The metadata probe uses the existing ffmpeg/ffprobe toolchain, takes no shell command, has a three-second timeout and a 256 KiB output limit, and does not decode the video or perform visual QC. Missing tools, I/O failures, malformed metadata or concurrent replacement cannot promote a render. Status probing is synchronous and uncached; a slow probe can delay one request up to its timeout. These operational limits are explicit rather than accepting unchecked media when the tool is unavailable.

The existing `rendered_mp4` nullable path and `rendered_bytes` fields remain compatible: only current output populates them. Additive `render_state` values are `current`, `stale`, `invalid`, `missing`, and `unverified`; `render_reason` explains rejection. `unverified` covers unavailable currency or metadata evidence. Staging rechecks the same authority and refuses non-current output before creating a destination or copying. Existing operator UI and pipeline status consumers already use the nullable path, so they stop offering a stale/invalid render without UI changes. An async render job's `output` remains a destination record, not proof that media is current.

Currency remains the existing filesystem-time policy, not a cryptographic provenance claim. Same-timestamp generations, preserved/forged timestamps, unrelated files that refresh the frame directory, manual edits outside `writeJob`, and copied older content with fresh timestamps cannot be reliably disambiguated by this policy. Equality deliberately retains compatibility with coarse filesystems. A future stronger binding would be a separate versioning change. Likewise, readable video metadata is minimum plausibility, not proof that every frame decodes or matches the intended geography. Direct historical-file access and independent proof reports are not revoked by this status change.

The synthetic regression fixture `tests/fixtures/earth-studio-ma002.mp4` is a one-second, 16×16 black H.264 video, two frames, generated locally (not an Earth Studio calibration asset):

```sh
ffmpeg -v error -f lavfi -i color=c=black:s=16x16:r=2 -t 1 \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart -y earth-studio-ma002.mp4
```

Tests use these fixed bytes rather than running an encoder. They exercise actual `writeJob` regeneration, public lane status and sandbox staging, timestamp boundaries, stale frame consistency, invalid/truncated media, file types, missing authority and probe failures. The FIFO test uses the existing Linux environment's `mkfifo`. The existing staging test now uses valid video instead of fake bytes; no historical oracle fixture changes.

MA-004 (zero-frame plan acceptance) and MA-021 (original oracle-corpus drift) remain open and untouched. No live Earth Studio, original dirty checkout or historical audit/MA-001 evidence is modified.
