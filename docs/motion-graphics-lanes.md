# Motion graphics lanes — Remotion & HyperFrames

The cockpit exposes two branded-motion render lanes. Both render only to sandbox /
candidate locations — never to approved media.

## Remotion (brandkit) lane
- Server module: `remotion-lane.js`; endpoints `/api/remotion/status|render|job-status|cancel`
  (render + cancel are nonce-gated). UI lane lives on `production-pipeline.html`.
- Renders run the existing `vidtoolz-brandkit-remotion` npm scripts (allowlisted targets only)
  and write to `…/99_SANDBOX/remotion-brandkit-pilot/`. The brandkit's own
  `assertSafeRenderOutput` refuses approved-media writes.
- Requires `vidtoolz-brandkit-remotion` to be installed (its `node_modules` present).

## HyperFrames lane
- Server endpoints `/api/hyperframes/status|preview|render`; UI lane in the dashboard video room.
- Renders run the `hyperframes` CLI: `hyperframes render <projectDir> -c compositions/<id>.html -o renders/<id>.mp4`.
  Each run's `hyperframes/` folder is the project dir (it carries an `index.html` marker plus a
  `hyperframes.json` manifest of compositions). Output MP4s land in the run's `hyperframes/renders/`
  (gitignored).

### Dependency note: `hyperframes` is a GLOBAL npm install
- HyperFrames is installed **globally** (`npm install -g hyperframes`), NOT in this repo's
  `package.json`. This is deliberate: the Episode Factory is dependency-free (no `node_modules`),
  and `hyperframes` pulls a heavy native tree (`puppeteer-core`, `@puppeteer/browsers`,
  `onnxruntime-node`, `sharp`, `esbuild`). Keeping it global preserves the dependency-free app.
- The server probes it with `npx --no-install hyperframes --help`, which resolves the global
  binary on PATH. If the availability check goes red, reinstall: `npm install -g hyperframes`.
- Rendering uses the **system Chrome** (`/usr/bin/google-chrome`) via `hyperframes browser ensure`
  — no separate browser download/cache is added to the repo.

### Out-of-box demo
`package-runs/2026-06-27-hyperframes-sample/` ships a sample composition (a vertical VIDTOOLZ
intro) so the HyperFrames lane has something to show immediately. Focus that run in the dashboard
(or the productions board) to see the composition with a **Render MP4** button. The sample is
source-only — rendered MP4s and logs are gitignored.
