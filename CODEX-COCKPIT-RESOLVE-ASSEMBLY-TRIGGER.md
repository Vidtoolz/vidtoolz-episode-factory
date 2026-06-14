# Codex Task: Add Resolve assembly trigger button to production pipeline page

## Goal

Add a one-click button on the existing `/production-pipeline.html` page that triggers the Resolve assembly handoff for a specific package. This closes the last friction point: when all Wan videos are staged, you click one button and `assembly-plan.md`/`.csv`/`media-manifest.json` are generated in `<package>/resolve-handoff/`. No terminal. No copy-paste commands.

## Background

The script that generates these files already exists:
```bash
python3 /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/scripts/topic-to-package.py resolve-assembly-handoff --package /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/<package_id>
```

It reads:
- `<package>/comfyui-handoff/handoff-selected-images.json` (selected FLUX images with prompt_index)
- `<package>/script/script-final.md` (final script for context)
- `<package>/staged-videos/*.mp4` (or `videos/mp4/*.mp4`) and extracts technical metadata

It writes:
- `<package>/resolve-handoff/assembly-plan.md` — human-readable markdown with usage instructions and clip list
- `<package>/resolve-handoff/assembly-plan.csv` — machine-readable CSV with order, prompt_index, video relative path, source image, script beat, prompt text, codec, dimensions, fps, frames, duration, size
- `<package>/resolve-handoff/media-manifest.json` — JSON with absolute/relative paths, usage notes (timeline: vertical 1080x1920, primary_layer: talking head, clip_role: B-roll candidates)

The `package-control/server.py` already lists this as a "next safe action" when `WAN_VIDEOS_STAGED` is true.

## Changes

### 1. Add API endpoint `POST /api/aigen/resolve-assembly/create`

Add to `/home/vidtoolz/vidtoolz-episode-factory/package-engine-server.js`:

```javascript
const AIGEN_RESOLVE_ASSEMBLY_API = '/api/aigen/resolve-assembly/create';
```

Handler:
```javascript
async function handleAigenResolveAssemblyCreate(req, res) {
  // Parse JSON body: { "package_id": "vidtoolz-youtube-ideas-20260611" }
  // Validate package_id exists in VIDNAS script-packages/
  // Run: python3 VIDNAS_AIGEN_ROOT/scripts/topic-to-package.py resolve-assembly-handoff --package <absolute_package_dir>
  // Capture stdout/stderr
  // On success: return { ok: true, files: ["assembly-plan.md", "assembly-plan.csv", "media-manifest.json"] }
  // On failure: return { ok: false, error: stderr, exit_code: N }
}
```

Wire the route in the server:
```javascript
if (req.method === 'POST' && url.pathname === AIGEN_RESOLVE_ASSEMBLY_API) {
  return handleAigenResolveAssemblyCreate(req, res);
}
```

**Important**: Use `child_process.spawn` (not `execSync`) to avoid blocking the event loop. Return immediately with a status message while the script runs, or wait for completion (your choice — the script takes <2 seconds).

### 2. Add button to `production-pipeline.html`

For each package card, add a "Create Resolve Assembly" button that is:
- **Disabled** if `wan_pending > 0` or `wan_failed > 0` (not all videos staged yet)
- **Disabled** if `resolve_handoff_ready` is already true (files exist, no need to regenerate — unless `--force` is supported)
- **Enabled** if `wan_pending === 0` and `wan_failed === 0` and `resolve_handoff_ready === false`

Button click:
```javascript
async function createResolveAssembly(packageId) {
  const res = await fetch('/api/aigen/resolve-assembly/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package_id: packageId })
  });
  const data = await res.json();
  if (data.ok) {
    alert('Resolve assembly handoff created:\n' + data.files.join('\n'));
  } else {
    alert('Failed: ' + data.error);
  }
}
```

Add a link below the button to open the generated files (if they exist):
```html
<a href="/mnt/vidnas_public/.../resolve-handoff/assembly-plan.md" target="_blank">Open assembly-plan.md</a>
```

But since the server only serves from `/home/vidtoolz/vidtoolz-episode-factory`, you cannot directly link to VIDNAS files. Instead, add a second API endpoint `GET /api/aigen/resolve-assembly/file?package=<id>&name=assembly-plan.md` that reads the file from VIDNAS and streams it back. Or, simpler: just show a success message with the absolute path, and the user opens it in their editor.

### 3. Update `/api/aigen/production-pipeline/status` response

Add `resolve_handoff_ready` and `resolve_handoff_count` to each package entry:
```javascript
const resolveHandoffDir = path.join(VIDNAS_SCRIPT_PACKAGES, pkgId, 'resolve-handoff');
const resolveFiles = ['assembly-plan.md', 'assembly-plan.csv', 'media-manifest.json'];
const resolveHandoffCount = resolveFiles.filter(f => fs.existsSync(path.join(resolveHandoffDir, f))).length;
const resolveHandoffReady = resolveHandoffCount === resolveFiles.length;
```

Include in response:
```json
{
  "id": "vidtoolz-youtube-ideas-20260611",
  ...
  "wan_completed": 5,
  "wan_pending": 0,
  "wan_failed": 0,
  "resolve_handoff_ready": true,
  "resolve_handoff_count": 3
}
```

### 4. Tests

Add to `/home/vidtoolz/vidtoolz-episode-factory/tests/aigen-resolve-assembly.test.js`:

```javascript
const { test, createAigenFixture, packageEngineServer } = require('./helpers');

test('POST /api/aigen/resolve-assembly/create with valid package_id succeeds', async () => {
  const { aigenRoot, packageId } = createAigenFixture(); // creates mock package with FLUX + Wan + script
  const { port } = await packageEngineServer();
  
  const res = await fetch(`http://localhost:${port}/api/aigen/resolve-assembly/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package_id: packageId })
  });
  const data = await res.json();
  
  assert(data.ok === true, `Expected ok=true, got ${JSON.stringify(data)}`);
  assert(data.files.length === 3, 'Expected 3 files');
  assert(data.files.includes('assembly-plan.md'));
  assert(data.files.includes('assembly-plan.csv'));
  assert(data.files.includes('media-manifest.json'));
});

test('POST /api/aigen/resolve-assembly/create with invalid package_id fails', async () => {
  const { port } = await packageEngineServer();
  
  const res = await fetch(`http://localhost:${port}/api/aigen/resolve-assembly/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package_id: 'nonexistent-package' })
  });
  const data = await res.json();
  
  assert(data.ok === false, 'Expected ok=false');
  assert(data.error.includes('does not exist') || data.error.includes('not found'));
});

test('GET /api/aigen/production-pipeline/status includes resolve_handoff_ready field', async () => {
  const { aigenRoot, packageId } = createAigenFixture();
  const { port } = await packageEngineServer();
  
  const res = await fetch(`http://localhost:${port}/api/aigen/production-pipeline/status`);
  const data = await res.json();
  
  const pkg = data.packages.find(p => p.id === packageId);
  assert(pkg !== undefined, 'Package not found in status');
  assert('resolve_handoff_ready' in pkg, 'Missing resolve_handoff_ready field');
  assert(typeof pkg.resolve_handoff_ready === 'boolean');
});
```

## Acceptance tests

1. **Server running:**
   ```bash
   cd /home/vidtoolz/vidtoolz-episode-factory
   ./node_modules/.bin/nodemon package-engine-server.js | head -20  # watch startup logs
   ```

2. **Status endpoint shows new field:**
   ```bash
   curl -s http://localhost:8010/api/aigen/production-pipeline/status | jq '.packages[] | {id, resolve_handoff_ready, resolve_handoff_count}'
   ```
   Expected: `vidtoolz-youtube-ideas-20260611` shows `resolve_handoff_ready: true, resolve_handoff_count: 3`

3. **Trigger endpoint (re-create even if exists):**
   ```bash
   curl -s -X POST http://localhost:8010/api/aigen/resolve-assembly/create \
     -H 'Content-Type: application/json' \
     -d '{"package_id":"vidtoolz-youtube-ideas-20260611"}' | jq .
   ```
   Expected: `{ "ok": true, "files": ["assembly-plan.md", "assembly-plan.csv", "media-manifest.json"] }`

4. **Page shows button state:**
   Open `http://localhost:8010/production-pipeline.html`. The `vidtoolz-youtube-ideas-20260611` card should show a disabled button (because `resolve_handoff_ready === true` — already created). A package with `wan_pending: 0, resolve_handoff_ready: false` should show an enabled button.

5. **Invalid package_id:**
   ```bash
   curl -s -X POST http://localhost:8010/api/aigen/resolve-assembly/create \
     -H 'Content-Type: application/json' \
     -d '{"package_id":"fake-pkg"}' | jq .
   ```
   Expected: `{ "ok": false, "error": "..." }`

## Summary

- **Files changed:** `package-engine-server.js`, `production-pipeline.html`, `tests/aigen-resolve-assembly.test.js`
- **API endpoints added:** `POST /api/aigen/resolve-assembly/create`, updated `GET /api/aigen/production-pipeline/status` response schema
- **User action:** Click button → script runs → files generated → success message
- **No new Python dependencies** — uses existing `scripts/topic-to-package.py`
- **No VIDNAS writes except the 3 handoff files** — script handles safe_write logic
