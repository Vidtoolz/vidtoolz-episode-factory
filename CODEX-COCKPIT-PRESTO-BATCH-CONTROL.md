# Codex Task: Add PRESTO Wan2.2 batch control to cockpit (process-wrapped)

## Goal

Add cockpit endpoints and UI controls that let the operator submit Wan2.2 batches to PRESTO ComfyUI, monitor progress in real-time, view results, and cancel running jobs — all from the production-pipeline.html page. No terminal required.

**Architecture principle:** The cockpit does NOT reimplement the ComfyUI API client in Node.js. It spawns `run-production.py` as a managed child process and reads its artifacts for state. Python remains the single source of truth for the ComfyUI interaction. The cockpit is the process orchestrator.

## Background

`run-production.py` at:
`/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/image-to-video/production/wan22-81f/run-production.py`

Already implements the full batch lifecycle:
- Reads `selected-images.json` from package (via `--package <id>`)
- Loads workflow template, patches per-item (LoadImage, SaveVideo prefix)
- Uploads source image to ComfyUI via multipart /upload/image
- Submits via POST /prompt, polls /history/&#60;prompt_id&#62;
- Downloads output via /view, verifies with ffprobe
- Stages video to VIDNAS package `videos/mp4/&#60;idx&#62;.mp4`
- Updates `completed.txt`, `failed.jsonl`
- Writes per-run logs to `wan22-81f/runs/&#60;run_id&#62;/run.log`

The Python script handles all edge cases: timeouts, connection drops, ffprobe verification, lock files, forbidden-write guards. Do not duplicate this logic in JavaScript.

## Files to change

1. **`vidtoolz-episode-factory/package-engine-server.js`** — add 4 new endpoints + job manager module
2. **`vidtoolz-episode-factory/production-pipeline.html`** — add submit button, live progress panel, results display, cancel button
3. **`vidtoolz-episode-factory/tests/presto-batch-control.test.js`** — new test file (unit tests)
4. **`vidtoolz-episode-factory/tests/run-tests.js`** — register new test file

## Server-side changes (package-engine-server.js)

### New module: PRESTO job manager

Add a `prestoJobManager` object/state near the top of the file:

```javascript
const { spawn } = require('child_process');

const PRESTO_STATE = {
  activeJob: null,
  defaultUrl: 'http://192.168.50.187:8188',
  productionScript: '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/image-to-video/production/wan22-81f/run-production.py',
  runsDir: '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/image-to-video/production/wan22-81f/runs',
};
```

### Endpoint 1: POST /api/presto/submit

Request body: `{ "package_id": "vidtoolz-youtube-ideas-20260611", "comfyui_url": "http://192.168.50.187:8188" }`

Logic:
- Validate package_id exists (same VIDNAS path check as resolve-assembly endpoint)
- Reject if an active job is already running (return 409 with current job info)
- Spawn: `python3 <production_script> --package <package_id> --comfyui-url <url>`
- Store the child process handle, package_id, and startedAt in PRESTO_STATE.activeJob
- Attach stdout/stderr listeners that accumulate output (cap at 100KB)
- On process exit: record exit code, set activeJob.completedAt, do NOT auto-merge — just mark finished
- Return: `{ ok: true, job_started: true, package_id, comfyui_url }`

Response shapes:
```
Success: { ok: true, job_started: true, package_id: "..." }
Already running: { ok: false, error: "Job already active", active: { package_id, startedAt, running_seconds } }
Bad package: { ok: false, error: "Package does not exist: ..." }
Script missing: { ok: false, error: "Production script not found: ..." }
```

### Endpoint 2: GET /api/presto/job-status

Query params: `?package_id=<id>` (optional, for filtering)

Returns the current state of any active or recently completed PRESTO job:

```json
{
  "ok": true,
  "active": {
    "running": true,
    "package_id": "vidtoolz-youtube-ideas-20260611",
    "started_at": "2026-06-13T14:30:00Z",
    "running_seconds": 245,
    "exit_code": null,
    "stdout_tail": "  poll 4: elapsed=40.0s running=1 pending=0 state=running_or_pending",
    "stderr_tail": ""
  },
  "completed": null
}
```

When job has finished:
```json
{
  "ok": true,
  "active": null,
  "completed": {
    "package_id": "vidtoolz-youtube-ideas-20260611",
    "started_at": "...",
    "completed_at": "...",
    "exit_code": 0,
    "running_seconds": 1823,
    "stdout_tail": "  Video 5/5 completed..."
  }
}
```

When no job:
```json
{ "ok": true, "active": null, "completed": null }
```

Implementation:
- If PRESTO_STATE.activeJob exists and process is still alive: return active state with stdout/stderr tail (last 4KB each)
- If process has exited but completed_at was set within last 10 minutes: return completed state
- If process has exited longer ago: clear PRESTO_STATE.activeJob, return null for both
- Calculate running_seconds from startedAt

### Endpoint 3: POST /api/presto/cancel

Request body: `{}` (no args needed, or optional `{ "reason": "..." }`)

- If no active job: return `{ ok: false, error: "No active job" }`
- Send SIGTERM to the child process
- Wait up to 5 seconds for graceful exit
- If still alive, send SIGKILL
- Set activeJob.exit_code and activeJob.completedAt
- Return: `{ ok: true, cancelled: true, exit_code: <code or null> }`

### Endpoint 4: GET /api/presto/results

Query params: `?package_id=<id>` (required)

Returns the current per-item results for a package by reading `completed.txt` and `failed.jsonl` from the Wan2.2 lane:

```json
{
  "ok": true,
  "package_id": "vidtoolz-youtube-ideas-20260611",
  "completed": ["selected-img-001", "selected-img-002", "selected-img-003"],
  "completed_count": 3,
  "failed": [
    { "label": "selected-img-004", "run_id": "...", "error": "timeout", "timestamp": "..." }
  ],
  "failed_count": 1,
  "recent_runs": [
    { "run_id": "2026-06-13-143022-selected-img-001-abc12345", "label": "selected-img-001", "status": "verified", "verified": true }
  ]
}
```

Implementation:
- Read `{LANE_DIR}/completed.txt` — one label per line
- Read `{LANE_DIR}/failed.jsonl` — one JSON object per line (may have fields: label, run_id, error, exit_code, timestamp)
- Read run log files from `{LANE_DIR}/runs/` — sort by mtime descending, take last 20
- For each run: parse run.log JSON, extract status, verified_count, prompt_id

## Client-side changes (production-pipeline.html)

### Add to each package card — PRESTO control section

After the existing "Create Resolve Assembly" button, add a new section:

**Submit button:**
- Text: "Submit N to PRESTO" (where N = wan_pending count)
- Disabled when: wan_pending === 0, or PRESTO not reachable, or active job running
- Enabled when: wan_pending > 0 and presto.reachable and no active job
- On click: POST /api/presto/submit with package_id and default comfyui_url
- Shows loading spinner while request is in flight

**Live progress panel (hidden until job starts, shown when active):**
- Shows: "Submitting to PRESTO..." header
- Current status line (from stdout_tail, last line)
- Elapsed time (updates every 5 seconds via polling)
- Cancel button (POST /api/presto/cancel)
- Auto-refreshes every 5 seconds while job is active
- When job completes: shows success/failure summary with exit code

**Results panel (always visible when completed_count > 0):**
- Green badges for completed items: "✅ selected-img-001" etc.
- Red badges for failed items: "❌ selected-img-004 (timeout)"
- Count: "3/5 completed, 1 failed"

### JavaScript polling logic

```javascript
let prestoPollInterval = null;

function startPrestoPolling() {
  if (prestoPollInterval) clearInterval(prestoPollInterval);
  prestoPollInterval = setInterval(async () => {
    const resp = await fetch('/api/presto/job-status');
    const data = await resp.json();
    updatePrestoProgressUI(data);
    if (!data.active) {
      clearInterval(prestoPollInterval);
      prestoPollInterval = null;
      refreshPipelineStatus(); // refresh the whole page
    }
  }, 5000);
}
```

### CSS additions

Use existing styles.css patterns. Add minimal new CSS:
- `.presto-progress` — background, padding, border-radius matching existing cards
- `.presto-stdout` — monospace, dark background, max-height 200px, overflow-y scroll
- `.presto-badge` — reusing existing badge patterns (green for completed, red for failed)
- `.btn-presto-submit` — reusing existing button patterns, disabled state for grey
- `.btn-presto-cancel` — secondary/red variant

## Tests (tests/presto-batch-control.test.js)

### Unit tests (no real ComfyUI, mock the spawn):

1. **Submit — validation**
   - Missing package_id → 400
   - Non-existent package_id → 400 with error message
   - Missing production script path → verify graceful handling

2. **Submit — active job guard**
   - Mock an active job in PRESTO_STATE → subsequent submit returns 409

3. **Job status — no job**
   - PRESTO_STATE.activeJob = null → returns { active: null, completed: null }

4. **Job status — active job**
   - Mock active job with mock process → returns running=true with elapsed seconds

5. **Cancel — no job**
   - PRESTO_STATE.activeJob = null → returns { ok: false, error: "No active job" }

6. **Cancel — active job**
   - Mock active job → sends SIGTERM, returns ok: true

7. **Results — valid package**
   - Create temp files (completed.txt, failed.jsonl) → returns correct counts and arrays

8. **Results — missing package**
   - Returns ok: false with error

### Integration note
Mark tests that need real spawn vs mock spawn. For the mock tests, create a test helper:
```javascript
function mockPrestoJobManager() {
  // Override PRESTO_STATE for testing
}
```

## Test runner update (tests/run-tests.js)

Add `'tests/presto-batch-control.test.js'` to the test file list.

## Verification steps

After implementation:

1. **Syntax check:**
```bash
node --check package-engine-server.js
```

2. **Unit tests:**
```bash
npm test
```

3. **Restart server:**
```bash
~/.local/share/hermes/bin/vidtoolz-episode-factory-server --daemon
```

4. **Page loads:**
```bash
curl -sI http://localhost:8010/production-pipeline.html
```

5. **Job status (no job):**
```bash
curl -s http://localhost:8010/api/presto/job-status
```
Expected: `{ ok: true, active: null, completed: null }`

6. **Results for real package:**
```bash
curl -s "http://localhost:8010/api/presto/results?package_id=vidtoolz-youtube-ideas-20260611"
```
Expected: completed and failed arrays from the actual Wan2.2 lane state.

7. **Submit (dry verify only — do NOT actually submit a real Wan job):**
```bash
curl -s -X POST http://localhost:8010/api/presto/submit \
  -H 'Content-Type: application/json' \
  -d '{"package_id":"vidtoolz-youtube-ideas-20260611","comfyui_url":"http://127.0.0.1:19999"}'
```
This uses a bogus URL so the Python script will fail at the ComfyUI reachability check, which tests the submit→spawn→fail→report lifecycle WITHOUT actually running Wan jobs. Expected: job starts, then exits with non-zero code after Python reports ComfyUI unreachable.

8. **Page UI:** Open http://localhost:8010/production-pipeline.html in browser, verify:
   - "Submit to PRESTO" button visible on packages with wan_pending > 0
   - Button is enabled (since presto.reachable is true)
   - Clicking shows the live progress panel
   - Failed job (from step 7) shows exit code and error message

## Constraints

- Do NOT start a real Wan2.2 job during verification — use a bogus ComfyUI URL or a package with no pending items
- Do NOT modify run-production.py — the Python script is the source of truth
- Do NOT add auto-polling on page load — the user clicks submit when ready
- Do NOT auto-retry failed jobs — operator decides what to retry
- Do NOT add background/scheduled job management — this is on-demand operator-triggered only
- Keep stdout/stderr capture capped at 100KB per job to prevent memory leaks
- The child process must inherit the parent's PATH so `python3` resolves correctly

## What this does NOT do

- Reimplement ComfyUI API logic in Node.js
- Manage job queues or batch scheduling
- Auto-advance to next pipeline step when Wan completes
- Touch FLUX (vidnux local) ComfyUI — that is a separate future task
- Modify the Python production scripts in any way